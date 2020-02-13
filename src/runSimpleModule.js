const app = require('express')();
const WebSocket = require('ws');
const { WsHelper } = require('./WsHelper');

let clientNumber = 0;

const makeAwaitableFlag = () => {
    let resolve;
    const flag = new Promise((res, _) => {
        resolve = res;
    });
    flag.resolve = resolve;

    flag.resolved = false;
    flag.finally(() => {
        flag.resolved = true;
    });
    return flag;
};

const runSimpleModule = (moduleConf) => {
    app.set('port', moduleConf.port);
    app.use(require('body-parser').json());

    if (!moduleConf.validate) {
        moduleConf.validate = () => { };
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

        let wsHelper;
        const webSocketConnectionEnded = makeAwaitableFlag();

        const getMessagePredecessors = async msg =>
            await Promise.all(msg.predecessors.map(type => wsHelper.receive(type)));

        try {
            const ws = new WebSocket(req.body.webSocketUrl);
            wsHelper = new WsHelper(ws);

            ws.on('close', (...reason) => {
                console.log(`${actClient} - end ${reason}`);
                webSocketConnectionEnded.resolve();
            });

            await moduleConf.validate(req);
            const promiseMeInit = wsHelper.receive('init');
            res.send(okResponse);

            await promiseMeInit;
        } catch (err) {
            console.log(`${actClient} - returning http err ${err.message}`)
            res.status(500).send(err.message);
            return;
        }

        console.log(`${actClient} - ${moduleConf.name}: Got init`);

        const preparedFuns = await Promise.all(
            moduleConf.messages.map(msg => msg.fun(req.body.realmConf))
        );

        const currMsgPreds = moduleConf.messages.map(getMessagePredecessors);
        await wsHelper.send('ready');

        while (!webSocketConnectionEnded.resolved) {
            await Promise.race([
                webSocketConnectionEnded,
                Promise.all(
                    currMsgPreds.map(async (messagePredecessors, i) => {
                        const msg = moduleConf.messages[i];
                        const params = await messagePredecessors;
                        currMsgPreds[i] = getMessagePredecessors(msg);
                        wsHelper.send(msg.name, await preparedFuns[i](params));
                    })
                )
            ]);
        }
        console.log(`${actClient} - iteration loop ended`);
    });

    const http = require('http').Server(app);
    app.listen(app.get('port'));
};

module.exports = runSimpleModule;