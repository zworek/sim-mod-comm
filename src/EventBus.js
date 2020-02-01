class EventBus {
    constructor() {
        this.currentId = 0;
        this.subscriptions = new Map();
    }

    subscribe(name, callback) {
        let nameSubs = this.subscriptions.get(name);
        if (!nameSubs) {
            nameSubs = new Map();
            this.subscriptions.set(name, nameSubs);
        }

        const id = this.currentId++;
        nameSubs.set(id, callback);

        return {
            unsubscribe: () => {
                nameSubs.delete(id)
                if (nameSubs.size === 0) {
                    this.subscriptions.delete(name);
                }
            }
        };
    }

    publish(name, message) {
        const nameSubs = this.subscriptions.get(name);
        if (!nameSubs) {
            return;
        }

        nameSubs.forEach(subCallback => subCallback(message));
    }
}

module.exports = { EventBus };