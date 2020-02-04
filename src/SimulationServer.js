const axios = require('axios');
const uuid = require('uuid/v4');

const { WsHelper } = require("./WsHelper");
const { EventBus } = require("./EventBus");

// TODO: Validate modules dependencies
//        Check for cycles, and decide what to do with them.. maybe they are ok?
//        Check that all dependencies are fulfilled

class SimulationServer {
    constructor({ wss, moduleConfigs, realmConfig, webSocketUrl, timeOutInMs = 35 * 1000 }) {
        this.wss = wss;
        this.moduleConfigs = moduleConfigs;
        this.realmConfig = realmConfig;
        this.webSocketUrl = webSocketUrl;
        this.timeOutInMs = timeOutInMs;

        this.eventBus = new EventBus();
    }

    async connectModules() {
        this.connections = await this._inviteAndGetWsConnections();

        const toBeReadyList = [];

        this.wshs = this.connections.map(({ ws, response }) => {
            console.log("Got websocket and response", response);

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

                console.log(`inviter accepting ${actInvitation.name} (${currentId})`)
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
                    return { response: httpResponse.data, ws };
                })
                .catch(err => {
                    new Error(`Module ${name} denied invitation: ${err.message}`);
                });
        }));
    }

};

module.exports = SimulationServer;