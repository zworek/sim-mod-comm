const axios = require('axios');
const uuid = require('uuid/v4');

const { WsHelper } = require("./WsHelper");
const { EventBus } = require("./EventBus");

class SimulationServer {
    constructor({ wss, moduleConfigs, realmConfig, webSocketUrl, serverProducedMessages, timeOutInMs = 35 * 1000 }) {
        this.wss = wss;
        this.moduleConfigs = moduleConfigs;
        this.realmConfig = realmConfig;
        this.webSocketUrl = webSocketUrl;
        this.timeOutInMs = timeOutInMs;
        this.serverProducedMessages = serverProducedMessages;

        this.eventBus = new EventBus();
    }

    validateModulesMessages(modulesMessages) {
        // validate name uniqueness
        let uniqueMessages = [];
        for (let serverMsg of this.serverProducedMessages) {
            if (uniqueMessages.find(({ name }) => name === serverMsg)) {
                throw new Error("serverProducedMessaegs shouldn't contain duplicates!");
            } else {
                uniqueMessages.push({ name: serverMsg, requires: [] });
            }
        }
        for (let msg of modulesMessages) {
            if (uniqueMessages.find(({ name }) => name === msg.name)) {
                throw new Error(`Modules try to spawn ${msg.name} twice!`);
            } else {
                uniqueMessages.push({ name: msg.name, requires: [...msg.predecessors] });
            }
        }

        // validate cousality
        while (uniqueMessages.length > 0) {
            const fullfilledMsg = uniqueMessages.find(msg => msg.requires.length === 0);
            if (!fullfilledMsg) {
                throw new Error(
                    `Couldn't resolve predecessors of those messages\n` +
                    JSON.stringify(uniqueMessages)
                );
            }

            // remove fulfilled msg from array
            uniqueMessages = uniqueMessages.filter(msg => msg !== fullfilledMsg);

            // resolve requirements of other msgs that required this one
            uniqueMessages.forEach(msg => {
                msg.requires = msg.requires.filter(req => req != fullfilledMsg.name);
            });
        }

        console.log("\nSuccesfully validated modules messages\n");
    };

    async connectModules() {
        this.connections = await this._inviteAndGetWsConnections();

        this.validateModulesMessages([].concat(...this.connections.map(({ response }) => response.messages)));

        const toBeReadyList = [];

        this.wshs = this.connections.map(({ ws, response }) => {
            const wsHelper = new WsHelper(ws);

            const allPredecessors = [...new Set(
                [].concat(...response.messages.map(x => x.predecessors))
            )];
            allPredecessors.forEach(type => {
                this.eventBus.subscribe(type, (msg) => {
                    wsHelper.send(type, msg);
                });
            });
            wsHelper.subscribeAll(({ type, msg }) => {
                this.eventBus.publish(type, msg);
            });

            toBeReadyList.push(wsHelper.receive("ready"));
            wsHelper.send('init');
            return wsHelper;
        });

        await Promise.all(toBeReadyList);
    }

    promiseMeModulesResponses() {
        return Promise.all([].concat(...this.connections.map((conn, i) =>
            conn.response.messages.map(async message => ({
                name: message.name,
                value: await this.wshs[i].receive(message.name)
            }))
        )));
    }

    _inviteAndGetWsConnections() {
        const pendingInvitations = new Map();

        this.wss.on('connection', function connection(ws, req) {
            const currentId = req.url.substring(1, 37); // got rid of inital slash and possible later params
            const actInvitation = pendingInvitations.get(currentId);
            if (actInvitation) {
                actInvitation.resolve(ws);

                pendingInvitations.delete(currentId);
            } else {
                ws.send(`Currently not invited ${currentId}`);
                ws.terminate();
                console.log(`inviter denying ${currentId}`)
            }
        });

        return Promise.all(this.moduleConfigs.map(mod => {
            const name = mod.name;
            const currentId = uuid();
            const httpResponse = axios.post(mod.url, {
                webSocketUrl: `${this.webSocketUrl}${currentId}`,
                realmConf: this.realmConfig
            });

            const webSocketConnection = new Promise((resolve, reject) => {
                setTimeout(reject.bind(null, new Error("invitation timeout")), this.timeOutInMs);
                pendingInvitations.set(currentId, { resolve, name });
            });

            return httpResponse
                .then(async httpResponse => {
                    const ws = await webSocketConnection;
                    console.log(
                        `\nWS-connection established with ${mod.name}, http response:\n`,
                        httpResponse.data
                    );
                    return { response: httpResponse.data, ws };
                })
                .catch(err => {
                    new Error(`Module ${name} denied invitation: ${err.message}`);
                });
        }));
    }

};

module.exports = SimulationServer;