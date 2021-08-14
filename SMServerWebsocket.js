var WebSocketClient = require('websocket').client;
const LogLib = require("./Log.js");
var Log = new LogLib.Log("SMServerWebsocket.js", "SMServerWebsocket.js");

const SMServerAPI = require("./SMServerAPI.js");
const SettingsManager = require("./settingsManager.js");

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

//TODO: Maybe auto-convert

var eventListeners = {
    "message": [],
    "read": [],
    "battery_level": [],
    "battery_charging": []
}

var client = new WebSocketClient();

var websocketIsOpen = false;

client.on('connectFailed', function(error) {
    console.log('Connect Error: ' + error.toString());
});

client.on('connect', function(connection) {
    websocketIsOpen = true;
    Log.g('SMServer WebSocket Client Connected');
    connection.on('error', function(error) {
        // console.log("Connection Error: " + error.toString());
        Log.e("Websocket connection error: "+error.toString());
        //Should we set websocketIsOpen to false here??
    });
    connection.on('close', function() {
        //TODO: Detect if the connection is closed due to no password and run the SMServerAPI.authenticate()

        SMServerAPI.authenticate(); //TODO: Is this too spammy?
        // console.log('Connection Closed');

        Log.w("Websocket connection closed");
        websocketIsOpen = false;
    });
    connection.on('message', function(message) {
        // console.log("Got a message");
        if (message.type === 'utf8') {
            // Log.i("New message via websocket "+message.utf8Data);
            //TODO: What about many battery messages?
            //TODO: Yell at client if the battery is low
            // console.log("Received: '" + message.utf8Data + "'");
            var message_parts = message.utf8Data.match(/^(\w+)\:(.*)/s); //Regex to separate the message type (before and after the colon :)
            // console.log(message_parts);
            var message_type = message_parts[1];
            var message_data = message_parts[2];
            // Log.v("Message type is "+message_type);
            if (message_type == "text") {
                Log.i("New text message via websocket!");
                // console.log(message_data);
                var jsondata = JSON.parse(message_data).text;
                // console.log(jsondata);
                // console.log(jsondata.guid+": "+jsondata.text);

                //TODO: If it's a link, refresh all recent messages as I'm not sure if the link gets returned with the websocket
                jsondata.conversation_id = jsondata.chat_identifier;
                jsondata.tapbacks = [];
                var messages = [jsondata];
                SMServerAPI.fixFormattingForMultipleMessages(messages, jsondata.chat_identifier); //Maybe fix it for just the one?
                // Log.v("Sending event 'message' with text contents");

                // console.log(messages);
                sendEvent("message",messages);

                //>>>TODO: Stack tapbacks?? By default everywhere??
                //TODO: Also add conversation_id: it's chat_identifier
            } else if (message_type == "read") {
                // Log.i(">>>>>>>>>>>>>>>>>>>>New read update via websocket!");
            //read:{"date":"17:19","guid":"EEDA85EA-0E74-4C93-BF55-204124F97F80"}
                var jsondata = JSON.parse(message_data);
                sendEvent("read", jsondata);
            } else if (message_type == "battery") {
                if (Number(message_data) !== NaN) {
                    sendEvent("battery_level", Number(message_data));
                } else {
                    sendEvent("battery_charging", message_data == "charging")
                }
            }

            //i.e. also include 'battery:unplugged' and 'battery:12.3456789'
        }
        return false;
    });

    //TODO: Wait, it sends messages while you're typing?
    //It includes text but gives it to you before you finish typing


    // function sendNumber() {
    //     if (connection.connected) {
    //         var number = Math.round(Math.random() * 0xFFFFFF);
    //         connection.sendUTF(number.toString());
    //         setTimeout(sendNumber, 1000);
    //     }
    // }
    // sendNumber();
});

function sendEvent(eventType, data) {
    for (var i = 0; i < eventListeners[eventType].length; i++) {
        console.log("Sending to listener: "+data);
        eventListeners[eventType][i].callback(data);
    }
}

exports.addEventListener = function(eventType, callback) {
    if (eventListeners.hasOwnProperty(eventType)) {
        //Add the event
        var eventID = Math.random();
        eventListeners[eventType].push({
            "id": eventID,
            "callback": callback
        });
        return eventID;
    } else {
        Log.w("Event "+eventType+" does not exist!");
    }
}

exports.removeEventListener = function(eventID) {
    for (eventType in eventListeners) {
        if (eventListeners.hasOwnProperty(eventType)) {
            //Loops through each event handler in each event
            for (var i = 0; i < eventListeners[eventType].length; i++) {
                if (eventListeners[eventType][i].id == eventID) {
                    eventListeners[eventType].splice(i, 1);
                    //Searches for the event and removes it
                    return;
                }
            }
        }
    }
    Log.w("Couldn't remove event "+eventID+" as it wasn't found in the event handlers list.");
}

// client.connect('ws://192.168.1.38:8740/', 'echo-protocol'); //TODO: Set this IP address according to user settings
 //TODO: Set this IP address according to user settings
//TODO: Continuously try to reconnect if the connection drops
setInterval(async() => {
    if (!websocketIsOpen) {
        var SERVER_IP = await SettingsManager.readSetting("SMSERVER_IP");
        var SERVER_WS_PORT = await SettingsManager.readSetting("SMSERVER_WEBSOCKET_PORT")
        Log.i("Trying to reconnect to websocket...");
        // client.connect('wss://192.168.1.38:8740/');
        client.connect('wss://'+SERVER_IP+":"+SERVER_WS_PORT+"/");
    }
}, 1000);

//TODO: Keep the connection alive
Log.i("Started listening to websocket");

//TODO: Maybe authenticate via SMServerAPI?
