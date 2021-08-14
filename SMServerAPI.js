const https = require('https');
const fetch = require('node-fetch');
const fs = require('fs');
const { URLSearchParams } = require('url');
const ConversionDatabase = require('./conversionDatabase.js');
const LogLib = require("./Log.js");
const FormData = require('form-data');
const SettingsManager = require("./settingsManager.js");
// Log.setSender("SMServerAPI.js");

// const SERVER_IP = "192.168.1.33";
// var SERVER_IP = SettingsManager.readSetting("SMSERVER_IP");
// const SERVER_PORT = "8741";
// const SERVER_PASSWORD = "toor";


process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
//TODO: WHY IS WEBSOCKET ATTACHMENTS NOT WORKING???
//TODO: Auto-authenticate if a request fails due to no authentication
async function SMServerFetch(path, indata, emptyResponseIsOk) {
    var SERVER_IP = await SettingsManager.readSetting("SMSERVER_IP");
    var SERVER_PORT = await SettingsManager.readSetting("SMSERVER_PORT");
    var SERVER_PASSWORD = await SettingsManager.readSetting("SMSERVER_PASSWORD");
    var Log = new LogLib.Log("SMServerAPI.js","SMServerFetch");
    //TODO: DEAL WITH RESPONSE CODES AS OUTLINED IN SMSERVER API
    //TODO: HANDLE ECONNRESET: Error: socket hang up

    //TODO: Check if SMServer certificate stays the same across installs?
    //Not sure if the Node version on Cydia supports fetch, so we're writing our own fetch function!
    //TODO: If we get ECONNRESET, wait and try again

    path += "?";
    for (property in indata) {
        if (indata.hasOwnProperty(property)) {
            path += property + "=" + encodeURIComponent(indata[property]) + "&";
            // console.log(property);
        }
    }
    path = path.slice(0, -1); //Removes the "&" from the end

    var makeRequest = function(path) {
        return new Promise((resCb, rejCb) => {
            Log.v("Making request to "+path);
            var options = {
              host: SERVER_IP,
              port: SERVER_PORT,
              path: path
            };

            callback = function(response) {
                var str = '';

                //another chunk of data has been received, so append it to `str`
                response.on('data', function (chunk) {
                    str += chunk;
                });

                //the whole response has been received, so we just print it out here
                response.on('end', function () {
                    Log.v("Request finished successfully, parsing...");
                    var responseIsEmpty = (str == "" || str == undefined);
                    // Log.w("Response is empty: "+responseIsEmpty);
                    if (emptyResponseIsOk && responseIsEmpty) {
                        resCb({});
                        return; //Stops evaluating errors
                    } else {
                        try {
                            var parsed = JSON.parse(str);
                            resCb(parsed);
                        } catch (err) {
                            Log.e("Couldn't parse JSON: "+str);
                            //TODO: Test what happens if the password is wrong and handle that error
                            rejCb("Error: Couldn't parse JSON: "+parsed);
                        }
                    }
                });
            }


            //There's no way SMServer has a signed certificate, so this is used to disable certificate checking.
            //SMServer doesn't work on HTTP for some reason, so we must deal with its self-signed cert.
            //This would be really dangerous, but seeing as we're only talking to localhost there's not much that can MITM this.

            var req = https.request(options, callback);
            req.end();
            req.on('error', function(e) {
                if (emptyResponseIsOk) {
                    //do nothing
                } else {
                    rejCb(e);
                }
            });
        });
    }

    var response = null;
    var requestSuccessful = false;
    for (var i = 0; i < 5; i++) {
        try {
            var response_try = await makeRequest(path);
            response = response_try;
            requestSuccessful = true;
            break;
        } catch (err) {
            if (err.code == "ECONNREFUSED") {
                Log.w("Connection to "+SERVER_IP+" was refused. SMServer could be busy or offline. Retrying in 5s...")
            } else {
                Log.e(err+". Retrying in 5s...");
            }
        }
    }
    if (!requestSuccessful) {
        Log.e("Request was unsuccessful after trying multiple times. See above warning for details");
        throw "Request unsuccessful";
    }
    // return await makeRequest(path);
    return response;
}

// async function SMServerFetchFile(attachment_data, indata) {
//
// }

async function SMServerFetchPost(path, indata) {
    var SERVER_IP = await SettingsManager.readSetting("SMSERVER_IP");
    var SERVER_PORT = await SettingsManager.readSetting("SMSERVER_PORT");
    var SERVER_PASSWORD = await SettingsManager.readSetting("SMSERVER_PASSWORD");

    var Log = new LogLib.Log("SMServerAPI.js","SMServerFetchPost");
    //Data must be sent in as MULTIPART/FORM-DATA
    //Encode everything with encodeURIComponent, so spaces replace with %20
    return new Promise((resCb, rejCb) => {

        var options = {
          host: SERVER_IP, //TODO: Make this a constant? It might end up being localhost, though
          port: SERVER_PORT,
          path: path
        };

        const params = new URLSearchParams();

        for (property in indata) {
            if (indata.hasOwnProperty(property)) {
                // formData[property] = encodeURIComponent(indata[property]);
                params.append(property, encodeURIComponent(indata[property])); //DOES THIS NEED TO BE URI ENCODED???
            }
        }
        Log.v("Sending a post request to "+path);
        fetch('https://'+SERVER_IP+':'+SERVER_PORT+path, {method: 'POST', body: params}).then(res => res.text()).then(text => console.log(text));
        //TODO: DEAL WITH HTTP ERROR CODES
    });
}

//TODO: Auto-configure SMServer to use a password that works with AirBridge by digging through the files?
//  What about people who want to use SMServer's web interface too?

exports.fetch = fetch;
exports.SMServerFetch = SMServerFetch;



var authenticated = false;

exports.authenticate = async function() {
    var Log = new LogLib.Log("SMServerAPI.js","authenticate");
    Log.v("Authenticating to SMServer");
    //TODO: Make a big scene if authentication doesn't work out
    //Such as if SMServer is unreachable
    var password = await SettingsManager.readSetting("SMSERVER_PASSWORD");
    authenticated = await SMServerFetch("/requests", {password: password});
    if (authenticated == false) {
        Log.e("SMServer authentication failed. Check your SMServer password.");
    }
    return authenticated;

    //TODO: Load PFX certificate if possible.
    //
}

var fsAccessPromise = function(path) {
    return new Promise(function(resolve, reject) {
        fs.access(path, resolve);
    });
}

var fsCreateDirPromise = function(path) {
    return new Promise(function(resolve, reject) {
        fs.mkdir(path, resolve);
    });
}

var ensureFolderExists = async function(path) {
    var folderAccess = await fsAccessPromise(path);
    if (folderAccess) {
        if (folderAccess.code == 'ENOENT') {
            //Create the file
            await fsCreateDirPromise(path);
        } else {
            Log.w("Couldn't access "+path+" folder: "+JSON.stringify(folderAccess));
        }
    }
    return path;
}

exports.ensureAttachmentFoldersExist = async function() {
    var Log = LogLib.Log("SMServerAPI.js", "ensureAttachmentFoldersExist");

    await ensureFolderExists("./attachment_cache");
    await ensureFolderExists("./sent_attachment_cache");
}

exports.downloadAttachmentIfNecessary = async function(attachment_info) {
    var Log = new LogLib.Log("SMServerAPI.js", "downloadAttachmentIfNecessary");
    var SERVER_IP = await SettingsManager.readSetting("SMSERVER_IP");
    var SERVER_PORT = await SettingsManager.readSetting("SMSERVER_PORT");
    var SERVER_PASSWORD = await SettingsManager.readSetting("SMSERVER_PASSWORD");
    await exports.ensureAttachmentFoldersExist();
    //https://192.168.1.46:8741/data?path=Attachments/03/03/8398059F-C566-4721-A387-1A63546C0D2C/64642773570__2531BEFC-FD22-4C4C-B5E8-554CF87FC3F1.JPG
    //TODO: Check if SMServer certificate stays the same across installs?
    //Not sure if the Node version on Cydia supports fetch, so we're writing our own fetch function!
    //TODO: If we get ECONNRESET, wait and try again
    //TODO: Functionify this, instead of sharing code between SMServerFetch and SMServerFetchFile

    //TODO: Keep track of downloaded attachments in conversionDatabase

    //TODO: If the attachment path exists, don't redownload it

    // console.log("filename:"+attachment_info.filename);
    console.log("Looking up "+attachment_info.filename);


    //TODO: NEXT STEPS: Create the attachment_cache and sent_attachment_cache folders if they don't exist
    var savedFilePathIfExists = ConversionDatabase.checkIfAttachmentAlreadySaved(attachment_info.filename);
    Log.v("Saved file path (if the file exists): "+savedFilePathIfExists);

    if (savedFilePathIfExists) { //This is undefined if it doesn't exist
        //Check if the file exists. (If it doesn't, redownload it)
        Log.v("File exists, returning with path "+savedFilePathIfExists);
        if (fs.existsSync("./attachment_cache/"+savedFilePathIfExists)) {
            Log.v("Saved file exists! Using path of existing file.");
            return "./attachment_cache/"+savedFilePathIfExists;
        } else {
            Log.w("Looks like the saved attachment was deleted. Re-downloading...");
        }
    }

    // const downloadedPath = await async function(url) {
    var savePath = "./attachment_cache/"+ConversionDatabase.getAttachmentSavePath(attachment_info.filename);
    Log.v("Will download file to "+savePath+". Fetching...");

    // var fetchTimeout = setTimeout()

    const res = await fetch("https://"+SERVER_IP+":"+SERVER_PORT+"/data?path="+encodeURIComponent(attachment_info.filename));
    Log.v("Data fetched, sending to fileStream");
    //TODO: Add indata conversion and put that in the fetch function
    const fileStream = fs.createWriteStream(savePath);
    var downloadedPath = await new Promise((resolve, reject) => { //before it was just "await new Promise..."
        Log.v("Downloading file from SMServer:"+attachment_info.filename);
        //TODO: Error handling if SMServer goes down or whatever
        res.body.pipe(fileStream); //We need this!
        res.body.on("error", (info) => {
            Log.e("Error downloading file: "+info);
            rejCb(info);
        });
        // fileStream.on("finish", resolve);
        fileStream.on("finish", () => {
            Log.v("File downloaded and saved to "+savePath);
            resolve(savePath); //this sets downloadedPath above
        });
    });
    // };

    return downloadedPath;
}
//TODO: Whenever messages are downloaded, keep track of attachment paths!!
//TODO: Only download attachments if the script is not running on the iPhone

//TODO: When filtering messages, remove zero-width spaces
//TODO: Create a function that makes each message unique by inserting zero-width spaces
//      Only really need to do this for messages sent from AM, as those are the only ones without GUIDs


exports.sendTextMessage = async function(text, chatid) { //TODO: Figure out how to upload photos and send them.
    var Log = new LogLib.Log("SMServerAPI.js","sendTextMessage");
    //Chatid can also be a phone number, but NEEDS to be in international format (ex. +11234567890)
    Log.v("Sending text message to "+chatid);
    if (!authenticated) {
        Log.e("Cannot send text messages due to not being authenticated with SMServer");
        throw 'Error: Cannot send text message due to not being authenticated with SMServer'
        return;
    }
    //data should look something like this:
    // {
    //     text: "This is the body of the text message",
    //     subject: "Subject line",
    //     chat: "1234567890", //Chat ID
    //     photos: "/var/mobile/Media/whatever.png", //Photo path on the phone
    //     attachments: 123 //Somehow files are sent here. I assume it's using the regular path?
    // }
    // text = '​😀​'; //Has the fancy unicode zero-width space
    Log.v("Sending "+text+" to "+chatid);
    SMServerFetchPost('/send', {
        text: text,
        subject: "",
        chat: chatid
    });
    // console.log("\n\n\n\nMESSAGE SENTtTT");
    //TODO: ADD A CRAP TON OF ERROR HANDLING
}

exports.sendTapbackGivenMessageText = async function(messageText, chatID, tapbackCode) { //TODO: Are chat IDs required?
    var Log = new LogLib.Log("SMServerAPI.js","sendTapbackWithMessageText");

    //We need to get an associated message GUID
    // var searchResults = (await SMServerFetch("/requests", {search: messageText, search_case: false, search_gaps: false, search_group: "time"})).matches.texts;
    var i = 95; //TODO: Make a function to get a chunk of messages from SMServer
    var targetMessage = null;
    var searchResults = await exports.getMessagesForOneConversationWhileConditionIsTrue(chatID, (message) => {
        // console.log(message.text);
        i -= 1;
        if (i < 0) {
            // console.log("I is 0, returning");
            return false;
        }
        var messageIsNotTapback = (message.associated_message_guid == "" || message.associated_message_guid == undefined);
        // if (message.text.indexOf(messageText) > -1 && messageIsNotTapback) {
        if (message.text.trim() === messageText.trim() && messageIsNotTapback) {
            //TODO: Get rid of newlines in the message text we're matching against.

            //TODO: Maybe
            targetMessage = message;
            return false;
        }
        return true;
    });

    //TODO: If user wants to remove a tapback, stack tapbacks and find the one the user sent (is_from_me: true) and get the type. Remove it first.
    //  Also do this if a tapback exists??

    //TODO: (Test with iPhone 4--why is the tapback sent a bunch of times?)

    if (targetMessage == null) {
        return false; //TODO: Handle this error if the message wasn't found
    }

    // searchResults.filter((message) => {
    //     return (message.)
    // })

    console.log(targetMessage);
    await exports.sendTapback(tapbackCode, targetMessage.guid, false);
    // exports.sendTapback(mostRecentResult)
    //TODO: Wait, search doesn't return a GUID!!

}

exports.sendTapback = async function(tapbackType, associated_message_guid, remove_tap) { //TODO: Need a remove option?
    await SMServerFetch("/send", {tapback: tapbackType, tap_guid: associated_message_guid, remove_tap: remove_tap}, true);
}

//TODO: Message does not show up when sending a video from other device

//TODO: What about message text???
exports.sendFile = async function(fileName, fileData, chatid, text) {
    var SERVER_IP = await SettingsManager.readSetting("SMSERVER_IP");
    var SERVER_PORT = await SettingsManager.readSetting("SMSERVER_PORT");
    var SERVER_PASSWORD = await SettingsManager.readSetting("SMSERVER_PASSWORD");
    await exports.ensureAttachmentFoldersExist();

    var Log = new LogLib.Log("SMServerAPI.js","sendFile");
    //TODO: Large files fail!!!!!!!!!!!!!!!!!
    // Log.w("File size is "+fileData.length+" bytes");

    //This is 1.96 MB

    //TODO: Implement message text

    // TODO: Figure out why file-receiving isn't working for pushing nhtMessageUpdate, but it works on message sync!!
    // fs.writeFileSync("test.png", fileData);

    // fileData = fs.readFileSync("C:/Users/aweso/Downloads/pcpartpicker.com_list_.png");
    //TODO: What about multiple attachments??
    var Log = new LogLib.Log("SMServerAPI.js","sendTextMessage");
    //Chatid can also be a phone number, but NEEDS to be in international format (ex. +11234567890)
    Log.v("Sending file to "+chatid);
    if (!authenticated) {
        Log.e("Cannot send text messages due to not being authenticated with SMServer");
        throw 'Error: Cannot send text message due to not being authenticated with SMServer'
        return;
    }

    var form = new FormData();
    var buffer = fileData;

    form.append('attachments', buffer, {
        // contentType: 'image/png',
        // contentType: 'application/octet-stream',
        name: 'file',
        filename: fileName
    });
    form.append('chat', chatid);
    // form.append('text', 'Heyyy this is a test yo');
    //data should look something like this:
    // {
    //     text: "This is the body of the text message",
    //     subject: "Subject line",
    //     chat: "1234567890", //Chat ID
    //     photos: "/var/mobile/Media/whatever.png", //Photo path on the phone
    //     attachments: 123 //Somehow files are sent here. I assume it's using the regular path?
    // }
    Log.v("Sending file to "+chatid);
    // SMServerFetchPost('/send', {
    //     text: text,
    //     subject: "",
    //     chat: chatid
    // });

//TODO: Roll this into SMServerFetchPost (i.e. make SMServerFetchPost work with files too?)
    return new Promise((resCb, rejCb) => {

        // var form = new FormData();
        // form.append('attachments', fileData, {knownLength: fileData.length});
        path = "/send";

        var options = {
          host: SERVER_IP, //TODO: Make this a constant? It might end up being localhost, though
          port: SERVER_PORT,
          path: path
          // attachments: [fileData]
        };

        var file = [fileName, fileData, 'image/png']; //TODO: Find the MIME type

        console.log(options);

        const params = new URLSearchParams();

        // indata = {
        //     "chat": chatid,
        //     "text": "Heyy, this a file test is",
        //     "attachments": [fileData]
        // }
        //
        // for (property in indata) {
        //     if (indata.hasOwnProperty(property)) {
        //         // formData[property] = encodeURIComponent(indata[property]);
        //         params.append(property, encodeURIComponent(indata[property])); //DOES THIS NEED TO BE URI ENCODED???
        //     }
        // }
        Log.v("Sending a post request to "+path);
        //TODO: Does this need a "Content-length" attr in the headers: {} part next to method: 'POST', ???
        fetch('https://'+SERVER_IP+':'+SERVER_PORT+path, {method: 'POST', body: form}).then(res => res.text()).then(text => console.log(text));
        //TODO: DEAL WITH HTTP ERROR CODES
    });

    //TODO: Slice up the file data and send it in multiple passes so SMServer doesn't get confused?
}

exports.getListOfChats = async function(num_chats) {
    var Log = new LogLib.Log("SMServerAPI.js","getListOfChats");
    Log.v("Getting list of chats");
    if (num_chats == undefined) {
        var num_chats = 99999; //Number of chats to search through. Needs to be something ridiculously large.
    }
    var data = await SMServerFetch("/requests", { chats: num_chats });
    Log.vv(JSON.stringify(data));
    // console.log(data);
    return data;
}

//TODO: On first connect, assign GUIDs for every conversation?

//TODO: Add a getAllMessagesWhileConditionIsTrue() method that takes a compare
//function and keeps downloading older and older messages until it is satisfied or
//runs out of messages? Useful for finding time_lower and tracing tapbacks to their
//original message

//TODO: Add a function that formats an SMServer message correctly--takes in an existing message from SMServer and adds "conversation_id" and "tapbacks":[]

//TODO: Keep track of last client request upper bound and check for new messages and push them?

exports.getMessagesForOneConversationWhileConditionIsTrue = async function(conversation, pre_filter_fn, chunk_callback) {
    var Log = new LogLib.Log("SMServerAPI.js","getMessagesForOneConversationWhileConditionIsTrue");
    Log.v("Getting messages for one conversation while condition is true: "+conversation);
    //TODO: Add a callback argument that returns data as it is available, instead of waiting for it all to finish

    //This function continuously gets messages from SMServer until pre_filter_fn returns false.
    //Postfiltering is done by the parent function

    //TODO: Check for duplicates!


    //THE FOLLOWING IS UNTESTED
    //time_lower and time_upper are both in UNIX seconds
    var messages = [];
    var filtered_messages = [];
    var offset = 0; //How far back to start retrieving messages
    var chunkSize = 100;

    var continueLoop = true;
    //So if we don't get all
    while (continueLoop) {
        var results = await SMServerFetch("/requests", {messages: conversation, num_messages: 100, read_messages: false, messages_offset: offset});
        Log.v("Got "+chunkSize+" results from SMServer, checking to see if they all meet the criteria");
        // if (results.texts.length == 0) { //results.texts[results.texts.length - 1] was failing here
        //     break; //If this request batch returns an empty list (i.e. exactly 100 messages in a chat), the loop ends as we're at the end.
        // }

        // messages = results.texts.concat(messages); //Adds the results
        offset += chunkSize;
        // console.log("\n");
        // console.log(results);
        // var timeOfEarliestMessage = ConversionDatabase.convertAppleDateToUnixTimestamp(results.texts[results.texts.length - 1].date);

        //Filtering is now integrated into this loop
        //This loop performs pre_filter_fn on the results SMServer has returned (for this chunk only).
        //If pre_filter_fn returns false for any function in the chunk we just received,
        var chunk_messages = [];
        Log.v("Testing each message against the compare callback function");
        for (var i = 0; i < results.texts.length; i++) {
            var current_message = results.texts[i];
            if (pre_filter_fn(current_message)) {
                current_message.conversation_id = conversation;
                chunk_messages.push(current_message);
            } else {
                // console.log("Prefilter function returned false!");
                Log.v("Prefilter function returned false, end of conditional search!");
                continueLoop = false;
                break; //Stops counting messages after pre_filter_fn returns false
            }
        }
        messages = messages.concat(chunk_messages);

        if (chunk_callback) { //chunk_callback could be undefined
            chunk_callback(chunk_messages);
        }

        if (results.texts.length < chunkSize) { //This happens if we are at the very beginning of the conversation and have downloaded all messages.
            Log.v("Found end of conversation, stopping the loop");
            // console.log("Results length is less than our chunk size");
            continueLoop = false;
        }

        // console.log("Length of results is "+results.length+" vs "+chunkSize);

    }
    //TODO: What if we have an orphaned tapback at the beginning of the message query?
    //TODO: Maybe return the prefiltered list, as that can be useful to check if a tapback on an older message
    //      was added at the very end.
    // console.log("Does htis work at all?????????????????????");
    //Now do filtering so only the messages within the specified time frame exactly get returned
    // var filtered = messages.filter((item) => {
    //     //return true if it should be kept
    //     var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
    //     console.log("Filterring!");
    //     if (unixstamp >= time_lower && unixstamp <= time_upper) {
    //         console.log(item.text+" matches the requirements!");
    //     } else {
    //         console.log(item.text+": "+new Date(unixstamp * 1000)+" is not in the correct timeframe")
    //     }
    //     return unixstamp >= time_lower && unixstamp <= time_upper;
    // });

    //TODO: Filter out tapbacks, digital touch, etc, and maybe associate with their parent messages in the future (instead of individual messages)
    //Anything with no text and no subject, or an associated_message_guid, or a balloon_bundle_id
    // console.log("messages: "+messages);
    messages = exports.fixFormattingForMultipleMessages(messages, conversation);

    return messages;


}

exports.getAllMessagesWhileConditionIsTrue = async function(pre_filter_fn, chunk_callback) {
    var Log = new LogLib.Log("SMServerAPI.js","getMessagesForAllConversationsWhileConditionIsTrue");
    Log.v("Getting all messages while condition is true");
    //TODO: Add a callback argument that returns data as it is available, instead of waiting for it all to finish

    //This function continuously gets messages from SMServer until pre_filter_fn returns false.
    //Postfiltering is done by the parent function

    //TODO: Check for duplicates!

    var conversations_json = await exports.getAllConversations();
    var conversations = [];
    for (var i = 0; i < conversations_json.length; i++) {
        conversations.push(conversations_json[i].chat_identifier);
    }

    //THE FOLLOWING IS UNTESTED
    //time_lower and time_upper are both in UNIX seconds
    var messages = [];
    var filtered_messages = [];
    var offset = 0; //How far back to start retrieving messages
    var chunkSize = 100;

    var continueLoop = true;
    //So if we don't get all
    while (continueLoop) {
        var results = await SMServerFetch("/requests", {messages: conversations.join(","), num_messages: 100, read_messages: false, messages_offset: offset});
        Log.v("Got "+chunkSize+" results from SMServer, checking to see if they all meet the criteria");
        // if (results.texts.length == 0) { //results.texts[results.texts.length - 1] was failing here
        //     break; //If this request batch returns an empty list (i.e. exactly 100 messages in a chat), the loop ends as we're at the end.
        // }

        // messages = results.texts.concat(messages); //Adds the results
        offset += chunkSize;
        // console.log("\n");
        // console.log(results);
        // var timeOfEarliestMessage = ConversionDatabase.convertAppleDateToUnixTimestamp(results.texts[results.texts.length - 1].date);

        //Filtering is now integrated into this loop
        //This loop performs pre_filter_fn on the results SMServer has returned (for this chunk only).
        //If pre_filter_fn returns false for any function in the chunk we just received,
        var chunk_messages = [];
        Log.v("Testing each message against the compare callback function");
        for (var i = 0; i < results.texts.length; i++) {
            var current_message = results.texts[i];
            if (pre_filter_fn(current_message)) {
                current_message.conversation_id = "AirBridge"; //Not from AirBridge, but this is just to give it a conversation to attach to
                                                               //This method shouldn't be used if you need the conversation ID (IDs are not added
                                                               //from /requests?messages, so the best we can do is loop through each conversation and
                                                               //add the data after the fact.) This function ignores conversation IDs but pretends that
                                                               //these messages are from AirBridge so if they get inadvertently sent to the client the client
                                                               //doesn't freak out if the conversation wasn't found.
                chunk_messages.push(current_message);
            } else {
                // console.log("Prefilter function returned false!");
                Log.v("Prefilter function returned false, end of conditional search!");
                continueLoop = false;
                break; //Stops counting messages after pre_filter_fn returns false
            }
        }
        messages = messages.concat(chunk_messages);

        if (chunk_callback) { //chunk_callback could be undefined
            chunk_callback(chunk_messages);
        }

        if (results.texts.length < chunkSize) { //This happens if we are at the very beginning of the conversation and have downloaded all messages.
            Log.v("Found end of conversation, stopping the loop");
            // console.log("Results length is less than our chunk size");
            continueLoop = false;
        }

        // console.log("Length of results is "+results.length+" vs "+chunkSize);

    }
    //TODO: What if we have an orphaned tapback at the beginning of the message query?
    //TODO: Maybe return the prefiltered list, as that can be useful to check if a tapback on an older message
    //      was added at the very end.
    // console.log("Does htis work at all?????????????????????");
    //Now do filtering so only the messages within the specified time frame exactly get returned
    // var filtered = messages.filter((item) => {
    //     //return true if it should be kept
    //     var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
    //     console.log("Filterring!");
    //     if (unixstamp >= time_lower && unixstamp <= time_upper) {
    //         console.log(item.text+" matches the requirements!");
    //     } else {
    //         console.log(item.text+": "+new Date(unixstamp * 1000)+" is not in the correct timeframe")
    //     }
    //     return unixstamp >= time_lower && unixstamp <= time_upper;
    // });

    //TODO: Filter out tapbacks, digital touch, etc, and maybe associate with their parent messages in the future (instead of individual messages)
    //Anything with no text and no subject, or an associated_message_guid, or a balloon_bundle_id
    // console.log("messages: "+messages);

    // messages = exports.fixFormattingForMultipleMessages(messages, conversation);
    //TODO: Does this need to be broken down with extra data (i.e. conversationID) added?

    return messages;


}

exports.stackTapbacks = async function(messages, orphanedTapbackCallback) {

    var Log = new LogLib.Log("SMServerAPI.js","stackTapbacks");
    Log.v("Stacking tapbacks");
    Log.v("Original message count: "+messages.length);
    //TODO: Add a callback for orphaned tapbacks, so we can run nhtModifierUpdate later.

    //It is assumed the messages are ordered chronologically--i.e. newest message is at index 0
    //WE NEED DATA FOR ALL OF THE FOLLOWING
    //              For each tapback, writeObject() for the TapbackModifierInfo item
    //                  [Pack the sueprclass ModifierInfo]
    //                      Pack a string: Item type (for StickerModifierInfo this is 1)
    //                      Pack a string: message (Is this the GUID? Or just the message text?)
    //                  Pack string: messageIndex (ROWID??? But it's a string)
    //                  Pack mullable string: Sender (null if me)
    //                  Pack boolean: isAddition (if the tapback was added or removed)
    //                  Pack int: Tapback type (DOUBLE CHECK THE NUMBERS)

    //We need to include messageIndex, Sender, isAddition, and tapback type.
    var textMessages = [];
    var orphanedTapbacks = [];
    for (var i = (messages.length - 1); i >= 0; i--) { //Loops from oldest to newest message
        // console.log(messages[i]);
        if (messages[i].associated_message_guid == "") {
            messages[i].tapbacks = [];
            textMessages.unshift(messages[i]); //Adds to the beginning of the textMessages array to keep the output chronological
        } else if (!messages[i].cache_has_attachments) { //If it has an associated message GUID and attachments, it must be a sticker. We only want tapbacks
            // console.log("Found a tapback! "+messages[i].text+" associated with "+messages[i].associated_message_guid);

            // if (messages[i].associated_message_type >= 3000 && messages[i].associated_message_type <= 4000) { //If the tapback has been removed
            //     //Okay, this will take some explanation. SMServer only shows you the tapbacks that currently
            //     //apply to messages. So if I like your text and then change it to a dislike, SMServer will only
            //     //keep track of the dislike and the like will vanish from the database. If you remove a tapback
            //     //(removed tapbacks have an associated_message_type of 3000 to 3005) then that will be the only
            //     //tapback saved from that person as it's the only one that applies right now. Therefore, if the
            //     //tapback has an associated_message_type of 300x, that means there are no active tapbacks from
            //     //this person. So we skip adding it to the database.
            //     continue;
            // } //AirMessage asks for isAddition, so I guess I should pass along 300x values?

            var parts = messages[i].associated_message_guid.split("/");
            var targetedMessageGUID = parts[1];
            //TODO: How to find tapback type? p:0/ is always at the beginning
            //p:0 indicates the part number (i.e. if message is sent with attachment or whatever I think)


            /*
            {
                text: 'Emphasized “Subjectline This is the body of the text message”',
                date: 645406250523999900,
                balloon_bundle_id: '',
                ROWID: 10,
                group_action_type: 0,
                associated_message_guid: 'p:0/688FB450-C715-4914-9D2F-A73F6FDB7BE7',
                id: 'name@example.com',
                cache_has_attachments: false,
                guid: 'C5552DE4-3A88-4D63-9AD2-A11A23202C58',
                service: 'iMessage',
                is_from_me: true,
                subject: '',
                associated_message_type: 2004,
                item_type: 0,
                date_read: 0,
                conversation_id: 'name@example.com'
            }
            */

            var tapbackIsOrphaned = true;
            for (var j = 0; j < textMessages.length; j++) {
                //Loops through the text messages we have so far, looking for one that matches
                //We are looping through the messages array backwards, so every message older
                //than the current one is already in the textMessages array
                if (targetedMessageGUID == textMessages[j].guid) {


                    //associated_message_type:
                    //  2000: Loved
                    //  2001: Liked
                    //  2002: Disliked
                    //  2003: Laughed
                    //  2004: Emphasized
                    //  2005: Questioned
                    //  300x: Removed tapback
                    textMessages[j].tapbacks.push(messages[i]);

                    tapbackIsOrphaned = false;
                    break;
                }
                //break in here
            }

            if (tapbackIsOrphaned) {
                // console.log("[WARN] Orphaned tapback associated with: "+targetedMessageGUID+": "+messages[i].text);
                // if (orphanedTapbackCallback) { //This could be undefined
                //     orphanedTapbackCallback(messages[i]);
                // }
                orphanedTapbacks.push(messages[i]);
            }
            //Yell that there's an orphaned tapback
        }
    }
    Log.v("Tapback stacking completed with "+textMessages.length+" messages left and "+orphanedTapbacks.length+" orphaned tapbacks");
    //TODO: Check if removing tapbacks works as expected
    if (orphanedTapbackCallback) {//This could be Undefined
        orphanedTapbackCallback(orphanedTapbacks);
    }

    return textMessages;
}

exports.fixMessageFormat = function(message, conversation_id) { //Adds some useful data to messages as they're returned from SMServer (note: tapbacks aren't included)
    message.unixdate = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date);
    message.conversation_id = conversation_id;
    return message;
}

exports.fixFormattingForMultipleMessages = function(messages, conversation_id) {
    var fixed = [];
    for (var i = 0; i < messages.length; i++) {
        fixed.push(exports.fixMessageFormat(messages[i], conversation_id));
    }
    // console.log(fixed);
    return fixed;
}

//TOOD: Add a function for getting all attachment info from messages (maybe auto-)
exports.extractAttachmentInfoFromMessages = function(messages) {
    var attachments = [];
    for (var i = 0; i < messages.length; i++) {
        if (messages[i].attachments) { //If the attachments exist
            attachments = attachments.concat(messages[i].attachments);
        }
    }
    return attachments;
}

exports.filterAttachments = function(attachments) {
    //TODO: Filter out attachments with no extension??
    var filtered = [];
    for (var i = 0; i < attachments.length; i++) {
        if (attachments[i].filename.endsWith("unknown") || attachments[i].filename.endsWith(".pluginPayloadAttachment")) {
            //Don't add it to the filtered list
        } else {
            filtered.push(attachments[i]);
        }
    }
    return filtered;
}



//TODO: Auto-add necessary data (ex. conversation_id, unix_date, etc but not tapbacks) when data is returned from SMServer? or for getAllMessagesWhileConditionIsTrue?
//  I'm thinking about doing this

exports.getAllMessagesFromSpecifiedTimeInterval = async function(time_lower, time_upper) { //I'm assuming these are in unix timestamps? Or Apple's format maybe?
    //TODO: Use websockets for new messages!
    //TODO: Send client a message when the iphone runs low on battery?
    var Log = new LogLib.Log("SMServerAPI.js","getAllMessagesFromSpecifiedTimeInterval");
    Log.v("Getting all messages from time "+time_lower+" to "+time_upper);
    //time_lower and time_upper are both in UNIX milliseconds

    //Looks like there isn't an easy way to find messages from X time to Y time
    //We'll probably end up having to get the most recent 200 messages or so and see if we need to go back.
    // var results = await SMServerFetch("/requests");
    Log.v("Getting list of conversations after "+time_lower);
    var conversations = await exports.getConversationsAfterTime(time_lower);
    // console.log(conversations);
    // var conversation_ids = [];
    // for (var i = 0; i < conversations.length; i++) {
    //     conversation_ids.push(conversations[i].chat_identifier);
    // }
    // console.log("Got conversation IDs: "+conversation_ids);
    //SMServer lets us query multiple converations at once, as long as each ID is separated with commas

    //TODO: Sort these into their own conversations and label with the ID, as we'll need that later!
    // var messages = [];
    // for (var i = 0; i < conversations.length; i++) {
    //     var messagesFromConversation = await exports.getMessagesFromOneConversationFromTimeInterval(conversations[i].chat_identifier, time_lower, time_upper);
    //     //This adds a conversation_id to each message so AirPacker doesn't have to scramble to find it.
    //     //For some reason the conversation ID isn't included in the results, so we have to query each conversation individually
    //
    //     for (var j = 0; j < messagesFromConversation.length; j++) {
    //         var message = messagesFromConversation[j];
    //         // console.log(message);
    //         // console.log(i+" / "+conversations.length)
    //         // console.log(conversations[i]);
    //         message.conversation_id = conversations[i].chat_identifier;
    //         messages.push(message);
    //     }
    // }
    //THIS WAS CHANGED AND IS UNTESTED
    Log.v("Getting messages for each conversation");
    var messages = [];
    for (var i = 0; i < conversations.length; i++) {
        Log.v("Getting messages after "+time_lower+" for conversation "+conversations[i]);
        var conv_messages = await exports.getMessagesForOneConversationWhileConditionIsTrue(conversations[i].chat_identifier, (message) => {
            //This is our compare function. Nifty!
            var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date);
            // return unixstamp >= time_lower && unixstamp <= time_upper;
            return unixstamp >= time_lower;
            //TODO: This was changed as any conversations with messages both ahead of and behind time_upper
            //      would cause messages to be missed, because as as soon as the first (newest) message was seen,
            //      the function would stop
        });
        Log.v("Found "+conv_messages.length+" messages from conversation "+conversations[i]);
        // console.log(conv_messages);
        for (var j = 0; j < conv_messages.length; j++) {
            var message = conv_messages[j];
            message.conversation_id = conversations[i].chat_identifier; //This makes it easier to pass messages to the client later, as each message says which conversation it came from.
            messages.push(message);
        }
    }
    // console.log("all messages: "+messages);

    Log.v("Filtering out messages after "+time_upper+". Current message count is "+messages.length);
    var filtered = messages.filter((item) => {
        //return true if it should be kept
        var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
        // console.log("Filterring!");
        // if (unixstamp >= time_lower && unixstamp <= time_upper) {
        //     console.log(item.text+" matches the requirements!");
        // } else {
        //     console.log(item.text+": "+new Date(unixstamp)+" is not in the correct timeframe")
        // }
        return unixstamp >= time_lower && unixstamp <= time_upper;
    });
    //>>> FUTURE TODO: Put this into Promise.all() to be asynchronous and better!
    Log.v("Messages filtered. Message count is now "+messages.length);

    // console.log(allMessagesFromTime);
    Log.v("Message time retrieval finished");
    // messages = exports.fixFormattingForMultipleMessages(messages);

    return messages;
    //join with commas
}

//NOTE: When installing on an iPhone, Python is required for byte-buffer to work

//TODO: requests?search seems to include a chat_identifier field--use that instead of looping through each conversation?


//TODO: Is getting from time interval used anymore (newer method = while condition is true)?

// exports.getMessagesFromOneConversationFromTimeInterval = async function (conversation_id, time_lower, time_upper) {
//     //TODO: Is this ever used?
//     var Log = new LogLib.Log("SMServerAPI.js","getMessagesFromOneConversationFromTimeInterval");
//     Log.v("Getting messages from conversation "+conversation_id+" from "+time_lower+" to "+time_upper);
//     //TODO: Check for duplicates!
//
//
//     //THE FOLLOWING IS UNTESTED
//     //time_lower and time_upper are both in UNIX seconds
//     // console.log("function ran");
//     var timeOfEarliestMessage = 9999999999999999999;
//     var messages = [];
//     var offset = 0; //How far back to start retrieving messages
//     var chunkSize = 100;
//     //So if we don't get all
//
//     // //TODO: Rewrite this using getMessagesForOneConversationWhileConditionIsTrue?
//     // while (timeOfEarliestMessage >= time_lower) {
//     //     var results = await SMServerFetch("/requests", {messages: conversation_id, num_messages: 100, read_messages: false, messages_offset: offset});
//     //     if (results.texts.length == 0) { //results.texts[results.texts.length - 1] was failing here
//     //         break;
//     //     }
//     //     messages = results.texts.concat(messages); //Adds the results
//     //     offset += chunkSize;
//     //     // console.log("\n");
//     //     // console.log(results);
//     //     var timeOfEarliestMessage = ConversionDatabase.convertAppleDateToUnixTimestamp(results.texts[results.texts.length - 1].date);
//     //
//     //     // console.log("Length of results is "+results.length+" vs "+chunkSize);
//     //     if (results.texts.length < chunkSize) {
//     //         // console.log("Results length is less than our chunk size");
//     //         break; //This happens if we are at the very beginning of the conversation.
//     //     }
//     // }
//     var messages = await exports.getMessagesForOneConversationWhileConditionIsTrue(conversation_id, (item) => {
//         var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
//         return unixstamp >= time_lower;
//     }); //TODO: Automatically stack tapbacks inside getMessagesForOneConversationWhileConditionIsTrue()?
//
//     Log.v("Got "+messages.length+" messages from conversation during time interval");
//
//     // console.log("Does htis work at all?????????????????????");
//     //Now do filtering so only the messages within the specified time frame exactly get returned
//     var filtered = messages.filter((item) => {
//         //return true if it should be kept
//         var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
//         console.log("Filterring!");
//         if (unixstamp >= time_lower && unixstamp <= time_upper) {
//             console.log(item.text+" matches the requirements!");
//         } else {
//             console.log(item.text+": "+new Date(unixstamp)+" is not in the correct timeframe")
//         }
//         return unixstamp >= time_lower && unixstamp <= time_upper;
//     });
//
//     //TODO: Filter out tapbacks, digital touch, etc, and maybe associate with their parent messages in the future (instead of individual messages)
//     //Anything with no text and no subject, or an associated_message_guid, or a balloon_bundle_id
//
//     return filtered;
// }

exports.getLastMessageFromConversation = async function (conversation_id, start_time) {
    var Log = new LogLib.Log("SMServerAPI.js","getLastMessageFromConversation");
    Log.v("Getting last messages from conversation "+conversation_id+" (after "+start_time+")")
    // console.log("convo id: ");
    // console.log(conversation_id);

    //TODO: Maybe log all messages from after the message is sent, to avoid them getting lost?
    Log.v("Fetching results");
    var results = (await SMServerFetch("/requests", {messages: conversation_id, num_messages: 4, read_messages: false, messages_offset: 0})).texts; //TODO: Should this use getAllMessagesWhileConditionIsTrue?
    Log.vv(JSON.stringify(results));
    var results_filtered = [];
    Log.v("Got "+results.length+" results. Filtering...");
    for (var i = 0; i < results.length; i++) {
        var unixsenddate = ConversionDatabase.convertAppleDateToUnixTimestamp(results[i].date);
        if (unixsenddate > start_time) {
            var result = results[i]; //TODO: Integrate conversation IDing into fetch (or a fetch wrapper) instead of having to deal with it each time
            result.conversation_id = conversation_id;
            results_filtered.push(result);
        }
    }
    Log.v("Finished getting last messages (filtered length is "+results_filtered.length+") from conversation");
    results_filtered = exports.fixFormattingForMultipleMessages(results_filtered, conversation_id);

    return results_filtered;
}

exports.getActualLastMessageFromConversation = async function(conversation_id) {
    var Log = new LogLib.Log("SMServerAPI.js","getActualLastMessageFromConversation");
    Log.v("Getting actual last message from conversation "+conversation_id+" (after "+start_time+")")
    // console.log("convo id: ");
    // console.log(conversation_id);

    //TODO: Maybe log all messages from after the message is sent, to avoid them getting lost?
    Log.v("Fetching results");
    var results = (await SMServerFetch("/requests", {messages: conversation_id, num_messages: 1, read_messages: false, messages_offset: 0})).texts; //TODO: Should this use getAllMessagesWhileConditionIsTrue?

    //TODO: Add conversion step that:
    //  Converts date into UNIX milliseconds timestamp
    //  Adds the conversation_id field (double-check the actual name (is it conversation_id?) as I'm not sure I remember correctly)
    //  (possibly) stacks tapbacks

    Log.vv(JSON.stringify(results));
    Log.v("Finished getting last message from "+conversation_id);
    results = exports.fixFormattingForMultipleMessages(results, conversation_id);

    return results[0];
}

//TODO: Figure out which sent messages are which (i.e. duplicates) by forcing each message to
//be unique. If a message is sent that exactly matches a message from before, add an invisible
//unicode character to tell it apart.

exports.getAllConversations = async function() {
    var Log = new LogLib.Log("SMServerAPI.js","getAllConversations");
    Log.v("Fetching all conversations");
    //TODO: What to do about SMServer returning 'ECONNRESET'?
    var loopFinished = false;
    var offset = 0;
    var chunkSize = 100;
    var conversations = [];

    while (!loopFinished) {
        Log.v("Fetching "+chunkSize+" conversations");
        var results = await SMServerFetch("/requests", {chats: chunkSize, chats_offset: offset})
        // console.log(results.chats.length);
        if (results.chats.length < chunkSize) {
            loopFinished = true;
        }
        // for (var i = 0; i < results.chats.length; i++) {
        //     //AirMessage needs UUIDs for each conversation, but SMServer only gives us GUIDs for
        //     //individual messages. ConversionDatabase is used to randomly generate UUIDS and match
        //     //them with the chat ID format from SMServer, for easy conversion.
        //     // ConversionDatabase.saveGUIDAssociation(results.chats[i].chat_identifier);
        //     ConversionDatabase.ensureUUIDExists(results.chats[i].chat_identifier);
        // }
        conversations = results.chats.concat(conversations); //Adds the results to the end of the conversations array
        offset += chunkSize;
    }
    Log.v("Fetching all conversations finished, "+conversations.length+" conversations found");
    return conversations;
}

exports.getConversationsAfterTime = async function(time_lower) { //time lower is in UNIX seconds
    var Log = new LogLib.Log("SMServerAPI.js","getConversationsAfterTime");
    Log.v("Getting all conversations after time "+time_lower);
    //We only care if the newest message is newer than time_lower
    //Accesses list of all conversations
    // console.log("time_lower: "+time_lower);
    var conversations = await exports.getAllConversations();
    Log.v("Got all conversations. Filtering by time of last message...");

    //TODO: Convert all of this to use the message.unixstamp property instead of using the ConversionDatabase every time

    //TODO: Continuously fetch until we don't need to fetch anymore instead of fetching ALL the conversations, which might be unnecessary
    var filtered = conversations.filter((item) => {
        // console.log(item.time_marker);
        var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.time_marker);
        // console.log(unixstamp);
        //time_marker is the date the last text was sent, in Apple's time format.
        //If the last message was sent before the time_lower date, we throw it out.
        //If the last message was sent after the time_upper date, we don't know if
        //      there are other messages in there during the window so we add the
        //      conversation just to be safe.
        // console.log(unixstamp+" vs "+time_lower);
        // console.log(unixstamp >= time_lower);
        // console.log("Cutoff: "+new Date(time_lower));
        // console.log(item.display_name+": "+new Date(unixstamp)+": Is above cutoff? "+(unixstamp >= time_lower));
        return unixstamp >= time_lower;
    });
    Log.v("Conversation fetch finished");
    return filtered;
}

exports.findMessageByGUID = async function(message_guid) {
    var Log = new LogLib.Log("SMServerAPI.js", "findMessageByGUID");
    var associatedMessage = null;
    await exports.getAllMessagesWhileConditionIsTrue((message) => {
        if (message.guid == message_guid) {
            // console.log("Found message!");
            // console.log(message);
            Log.v("Found message that matches GUID: "+message.text);
            associatedMessage = message;
            return false;
        } else {
            return true;
        }
    });
    return associatedMessage;
}

//TODO: Find out if group chat name changed or not

//How to find the users in a group? Worst case scenario = guess based on who sent what
// exports.getMessagesFromSpecifiedChats = async function(chat_identifiers) {
//     var Log = new LogLib.Log("SMServerAPI.js","getMessagesFromSpecifiedChats");
//     //TODO: Add support for tapbacks and other messages where the text is ''
//     //associated_message_guid is not '' when it is a tapback
//
//     //TODO: Add array support for chat_identifiers
//     //WHY DOES THIS FAIL SOMETIMES?
//
//     var results = await SMServerFetch("/requests", {messages: chat_identifiers, num_message: 100, read_messages: false});
//     //TODO: Looks like tapbacks are included. How do we filter them out?
//     return results;
// }

//TODO: ID retrieval?

//Sending a first-time text message requires something to send!
//TODO: Add contact sending with /requests?name=name@example.com ?

// exports.searchForOneConversation = async function(conversation_id) {
//     var results = await SMServerFetch("/requests", {search: conversation_id});
//     return results;
// }
// exports.searchForOneConversation = async function(chat_identifier) {
//
//
//
//     //chat_identifiers should be an array
//
//     // var conversations = exports.getAllConversations();
//     //
//     // var filtered_conversations = [];
//     //
//     // for (var i = 0; i < conversations.length; i++) {
//     //     if (conersations[i].chat_identifier in chat_identifiers) {
//     //         filtered_conversations.push(conversations[i]);
//     //     }
//     // }
//
//     var results = await SMServerFetch("/requests", {match: chat_identifier, match_type: "chat"});
//     var finalresults = [];
//     for (var i = 0; i < results.matches.length; i++) {
//         if (results.matches[i].chat_id == chat_identifier) {
//             finalresults.push(results.matches[i]);
//         }
//     }
//     if (finalresults.length > 1) {
//         console.log("Got too many conversation items back from SMServer! "+JSON.stringify(finalresults));
//     }
//     return finalresults[0];
//     /*
//         Returns something like:
//         [
//             {
//                 "display_name": "Firstame ",
//                 "chat_id": "+11234567890"
//             }
//         ]
//
//     */
// }

exports.searchForMultipleConversations = async function(chat_identifiers) {
    var Log = new LogLib.Log("SMServerAPI.js","searchForMultipleConversations");
    var conversations = await exports.getAllConversations();
    //TODO: Promise.all() this! Maybe write a custom function that retries errors too, like the dreaded ECONNRESET?
    var filtered_conversations = [];

    for (var i = 0; i < conversations.length; i++) {
        // console.log(conversations[i]);
        if (chat_identifiers.indexOf(conversations[i].chat_identifier) > -1) {
            filtered_conversations.push(conversations[i]);
        }
    }

    //TODO: Set availability as true or false depending on if there is a chat Fidentifier missing in the returned conversations list
    return filtered_conversations;
}


//TODO: Set up a function that the client runs (with the last known time_lower) that constantly checks and waits for new messages.
//      Then resCb the promise as soon as it's done. It's up to Client.js to await this and put it in a forever loop.
//      What about client-originated requests? If everything is all good, they shouldn't matter (bc the client would already be up to date).
//      If the client disconnects, THE LOOP SHOULD STOP RUNNING.




//What do we need?
//  Chat identifier
//  Conversation display name (if group)
//  Members

async function dostuff() {
    console.log("\n\n\n");
    await exports.authenticate();

    setInterval(exports.authenticate, 500 * 1000); //Every 500 seconds (8.3ish minutes) it re-authenticates with SMServer, just to be safe
    //TODO: Continuously try to authenticate if it fails, send the client a message that SMServer isn't connecting


    // exports.sendTextMessage(1,2,3);
    // exports.getAllMessagesFromSpecifiedTime(1,2);
    // console.log(await exports.getListOfChats());
    //chat16846957693768777
    // console.log(await exports.getMessagesFromSpecifiedChats("chat16846957693768777"));
    // console.log(JSON.stringify(await exports.getMessagesFromSpecifiedChats("name@example.com")));
    // console.log(await exports.getMessagesFromSpecifiedChats("name@example.com"));
    // var results = await exports.getMessagesFromSpecifiedChats("name@example.com");
    // console.log(JSON.stringify(results, null, 4));
    // console.log(await exports.getConversationsAfterTime(1623964100.4529998));

    // console.log(await exports.getAllConversations());
    // console.log(await exports.getAllMessagesFromSpecifiedTimeInterval(1623963720, 1623964920));
    // console.log(await exports.getAllMessagesFromSpecifiedTimeInterval(0, 999999999999999999));
    // var messages = await exports.getAllMessagesFromSpecifiedTimeInterval(0, 9999999999999999);
    // console.log(messages);
    // console.log(JSON.stringify(await exports.stackTapbacks(messages), null, 4));

    // 645656520000000000 in apple time
    // console.log(JSON.stringify(await exports.searchForMultipleConversations(['+12068514105', 'name@example.com']), null, 4));
    // console.log(JSON.stringify(await exports.sendTextMessage('This is another automated message test', 'name@example.com')));
    // console.log(await exports.downloadAttachmentIfNecessary({
    //     "mime_type": "image'jpeg",
    //     "filename": "Attachments/33/03/6DA2243B-E98C-4B97-8104-E02882B9F2F5/64707007403__6AF2C454-0578-4355-ADD1-CE6E25FEBA27.JPG"
    // }));
    // console.log(await exports.getLastMessageFromConversation("name@example.com",0));
}

//TODO: How to send delivery updates?
dostuff();
