const config = require('../args/config.json');
global.floGlobals = require('../public/floGlobals');
require('./set_globals');
require('./lib');
require('./floCrypto');
require('./floBlockchainAPI');

const Database = require("./database");
const App = require('./app');
const floGlobals = require('../public/floGlobals');
const PORT = config['port'];

module.exports = function startServer(public_dir) {
    try {
        var _tmp = require('../args/keys.json');
        _tmp = floCrypto.retrieveShamirSecret(_tmp);
        var _pass = process.env.password;
        _tmp = Crypto.AES.decrypt(_tmp, _pass);
        if (floCrypto.verifyPrivKey(_tmp, floGlobals.adminID)) {
            global.myPrivKey = _tmp;
            global.myPubKey = floCrypto.getPubKeyHex(global.myPrivKey);
            global.myFloID = floCrypto.getFloID(global.myPubKey);
        } else {
            console.error('Loaded wrong private key!');
            process.exit(1);
        }
    } catch (error) {
        console.error('Unable to load private key!');
        process.exit(1);
    }

    global.PUBLIC_DIR = public_dir;
    console.debug(PUBLIC_DIR, global.myFloID);

    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(DB => {
        const app = App(config['secret'], DB);
        app.listen(PORT, () => console.log(`Server Running at port ${PORT}`));
    });
};