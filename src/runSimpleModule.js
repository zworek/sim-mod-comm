const app = require('express')();
const WebSocket = require('ws');
const { WsHelper } = require('./WsHelper');

const runSimpleModule = (moduleConf) => {
    app.set('port', moduleConf.port);
    app.use(require('body-parser').json());

    const okResponse = {
        name: moduleConf.name,
        messages: moduleConf.messages.map(({ name, predecessors }) => ({ name, predecessors }))
    };

    app.get('/', (req, res) => {
        console.log(`${moduleConf.name}: Somebody checked my index`);
        res.send(`${moduleConf.name} says hello`);
    });
    app.post('/invitation', async (req, res) => {
        console.log(`${moduleConf.name}: Got some invitation`, req.body.webSocketUrl);

        const ws = new WebSocket(req.body.webSocketUrl);
        const wsHelper = new WsHelper(ws);

        wsHelper.subscribe('init', async () => {
            console.log(`${moduleConf.name}: Got init`);
            await Promise.all(moduleConf.messages.map(async msg => {
                msg.preparedFun = await msg.fun(req.body.realmConf);
            }));
            await wsHelper.send('ready');

            while (true) {
                await Promise.all(moduleConf.messages.map(async msg => {
                    const params = await Promise.all(msg.predecessors.map(type => wsHelper.receive(type)));
                    wsHelper.send(msg.name, await msg.preparedFun(params));
                }));
            }
        });

        res.send(okResponse);
    });

    const http = require('http').Server(app);
    app.listen(app.get('port'));
};

module.exports = runSimpleModule;