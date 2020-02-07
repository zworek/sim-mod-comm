const app = require('express')();
const WebSocket = require('ws');
const { WsHelper } = require('./WsHelper');

let clientNumber = 0;

const runSimpleModule = (moduleConf) => {
    app.set('port', moduleConf.port);
    app.use(require('body-parser').json());

    if(!moduleConf.validate) {
        moduleConf.validate = () => {};
    }

    const okResponse = {
        name: moduleConf.name,
        messages: moduleConf.messages.map(({ name, predecessors }) => ({ name, predecessors }))
    };

    app.get('/', (req, res) => {
        console.log(`${moduleConf.name}: Somebody checked my index`);
        res.send(`${moduleConf.name} says hello`);
    });
    app.post('/invitation', async (req, res) => {
        const actClient = clientNumber++;

        console.log(`${actClient} - ${moduleConf.name}: Got some invitation`, req.body.webSocketUrl);
        try {
            const ws = new WebSocket(req.body.webSocketUrl);
            const wsHelper = new WsHelper(ws);

            let runSmoothly = true;
            ws.on("error", (err) => {
                console.log(`${actClient} - ${err.message}`);
                runSmoothly = false;
            });

            await moduleConf.validate(req);

            wsHelper.subscribe('init', async () => {
                console.log(`${actClient} - ${moduleConf.name}: Got init`);
                const preparedFuns = await Promise.all(
                    moduleConf.messages.map(msg => msg.fun(req.body.realmConf))
                );
                await wsHelper.send('ready');

                while (runSmoothly) {
                    await Promise.all(
                        moduleConf.messages.map(async (msg, i) => {
                            const params = await Promise.all(
                                msg.predecessors.map(type => wsHelper.receive(type))
                            );
                            wsHelper.send(msg.name, await preparedFuns[i](params));
                        })
                    );
                }
            });
            res.send(okResponse);
        } catch (err) {
            console.log(`${actClient} - returning http err ${err.message}`)
            res.status(500).send(err.message);
        }
    });

    const http = require('http').Server(app);
    app.listen(app.get('port'));
};

module.exports = runSimpleModule;