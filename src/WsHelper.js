const { EventBus } = require("./EventBus");
const VERBOSE = !true;

// Handles ACK for us
class WsHelper {
    constructor(ws) {
        this.ws = ws;

        this.currentMessageId = 0;
        this.waitingAcks = new Map();

        this.subId = 0;
        this.globalSubscriptions = new Map();
        this.specificSubs = new EventBus();

        VERBOSE && ws.on("close", () => { console.log("wsHelper-close") });

        ws.on('message', message => {
            const data = JSON.parse(message);

            VERBOSE && console.log("wsHelper-got:", data);

            if (data.type === "ACK") {
                this.waitingAcks.get(data.id)();
                this.waitingAcks.delete(data.id);
                return;
            }
            ws.send(JSON.stringify({ type: "ACK", id: data.id }));

            this.globalSubscriptions.forEach(subCallback => subCallback(data));

            this.specificSubs.publish(data.type, data.msg);
        });
    }

    send(type, msg) {
        if (type === "ACK") {
            throw new Error("ACK type is restricted for protocol use");
        }

        VERBOSE && console.log("wsHelper-send:", { type, msg, id: this.currentMessageId });
        return new Promise((resolve, reject) => {
            this.waitingAcks.set(this.currentMessageId, resolve);
            this.ws.send(JSON.stringify({ type, msg, id: this.currentMessageId++ }));
        });
    }

    receive(type) {
        return new Promise((resolve, reject) => {
            const { unsubscribe } = this.subscribe(type, msg => {
                resolve(msg);
                unsubscribe();
            });
        });
    }

    subscribeAll(callback) {
        const id = this.subId++;
        this.globalSubscriptions.set(id, callback);

        return {
            unsubscribe: () => {
                this.globalSubscriptions.delete(id);
            }
        }
    }

    subscribe(type, callback) {
        return this.specificSubs.subscribe(type, callback);
    }
};

module.exports = { WsHelper };