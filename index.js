const net = require('net');
const Client = require('./Client.js');
const LogLib = require("./Log.js");
var Log = new LogLib.Log("index.js", "index.js");
const SettingsManager = require("./settingsManager.js");
const SMServerAPI = require("./SMServerAPI.js");

// var AIRMESSAGE_PORT = SettingsManager.readSetting("AIRMESSAGE_PORT");

//FUTURE TODO: Integrate VNC for GamePigeon, etc
//FUTURE TODO: When texting the server, send "Remote" to get a remote control link
SMServerAPI.ensureAttachmentFoldersExist(); //A little race condition but it probably doesn't matter
SettingsManager.readSetting("AIRMESSAGE_PORT").then((port) => {
    var server = net.createServer();
    server.on('connection', handleConnection);
    server.listen(port, function() {
        Log.i('server listening to '+ JSON.stringify(server.address()));
    });
    var clients = [];
    function handleConnection(conn) {
        clients.push(new Client(conn));
    }
});
