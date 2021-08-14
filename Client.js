const crypto = require('crypto');
const AirUnpacker = require('./AirUnpacker.js');
const AirPacker = require('./AirPacker.js');
const ByteBuffer = require('byte-buffer');
const EncryptionLib = require('./encryption_test.js');
const ConversionDatabase = require('./conversionDatabase.js');
const SMServerAPI = require("./SMServerAPI.js");
const SMServerWebsocket = require("./SMServerWebsocket.js");
const CommConst = require("./CommConst.js");
const LogLib = require("./Log.js");
const Zlib = require('zlib');
// Log.setSender("Client.js");
const {v4: uuidv4}  = require('uuid');
const fs = require('fs');


const MESSAGE_QUERY_INTERVAL = 30 * 1000; //Double-checks messages every 30s. This is an insurance policy as the websocket can sometimes disconnect and messages can get lost

//TODO: Only use ONE SMServerAPI--it's re-generating a request every time it is require()d
//TODO: Handle promise rejections gracefully (Log.e or something)

/*
BIG TODOLIST:
Maybe add an option to autoconfigure SMServer?
Maybe customize the device name to include the iPhone name instead of just "AirBridge"?

*/


//TODO: Looks like the new update to SMServer will have an "addresses" list with contact addresses in it
function Client(connection) {
    var Log = new LogLib.Log("Client.js","Client");
    this.transmissionCheck = null;
    this.authenticated = false;
    this.connection = connection;

    this.clientName = "Not authenticated";
    this.platformName = "unknown";
    this.installationId = "unknown";

    this.clientLastSeenTime = 9999999999999; //Timestamp of last time_upper sent to the client
    this.messageRefreshInterval = null;

    this.receivedDataLength = null; //null if we don't have the complete length received yet. Does not include the 5 extra bytes for the message header
    this.receivedData = new ByteBuffer();

    this.fileToSend = new ByteBuffer();
    this.filenameToSend = "unknown";

    this.batteryLevel = 100;
    this.isCharging = true;

    var globalThis = this; //TODO: Make this less hacky

    this.websocketMessageListener = null;

    this.setupTransmissionCheck = function() {
        var Log = new LogLib.Log("Client.js","setupTransmissionCheck");
        var message = new AirPacker();

        message.writeInt(CommConst.nhtInformation); //nhtInformation (Message type)
        message.writeInt(CommConst.mmCommunicationsVersion); //mmCommunicationsVersion (AirMessage protocol version)
        message.writeInt(CommConst.mmCommunicationsSubVersion); //mmCommunicationsSubVersion (AirMessage protocol subversion)

        message.writeBoolean(true); //Transmission check required

        Log.i("Setting up transmission check");
        this.transmissionCheck = crypto.randomBytes(32);
        Log.vv("Transmission check: "+this.transmissionCheck.toString('hex'));
        message.writeVariableLengthBuffer(this.transmissionCheck); //Writes the length and the transmission check

        message.writeHeader();

        return message;

    }.bind(this)

    var onConnData = function(d) {
        //TODO: GIFs sent from GBoard show up as two messages when sending
        var Log = new LogLib.Log("Client.js","onConnData");
        Log.i("New raw connection data from client (length of "+d.length+")");
        //TODO: Add a timeout to data if it gets interrupted
        var data = d;

        //Add the data to the receivedData buffer
        Log.v("Adding received data to bytebuffer");
        this.receivedData.append(data.length);
        this.receivedData.write(data);



        //If we can't obtain an int length yet
        if (this.receivedData.length < 4) {
            //Data has been added to receivedData, but there still isn't enough for a length integer
            Log.v("We don't have a complete tramsission length (the length int hasn't fully transmitted). Stop and wait for more data.");
            return;
        }


        //If the length int IS complete and wasn't before
        if (this.receivedData.length >= 4 && this.receivedDataLength == null) {
            //Set the receivedDataLength to the int sent from the client
            var tmpbuffer = Buffer.from(this.receivedData.buffer);

            this.receivedDataLength = tmpbuffer.readUInt32BE(0);
            Log.v("Got expected length of received data: "+this.receivedDataLength);
            //this.buffer.readUInt32BE(this.readerIndex);
        }

        //If the length of receivedData is the right one
        //NOTE: receivedDataLength only includes the length of the content, not the length or encryption header (which is 5 bytes)
        if (this.receivedDataLength !== null && this.receivedData.length >= (this.receivedDataLength + 5)) { //Checks to see if we have all the data
            //Save the bytebuffer into another variable and clear receivedData. Set the length to null.
            Log.v("Length meets our expectations. Got data in full!");
            Log.blankLine();
            Log.i("Got a complete transmission from client.");
            var dataInFull = this.receivedData.raw;
            //SAVE THE BYTEBUFFER SOMEWHERE HERE
            this.receivedData = new ByteBuffer();
            this.receivedDataLength = null;
            //Run whatever code we need as we've finally gotten all the data!
            processCompleteIncomingTransmission(Buffer.from(dataInFull));
        }
    }.bind(this)
    var onConnClose = function() {
        var Log = new LogLib.Log("Client.js","onConnClose");
        Log.w('connection from '+remoteAddress+' closed');
        clearInterval(globalThis.messageRefreshInterval); //Stops checking for new messages
    }.bind(this);
    var onConnError = function(err) {
        var Log = new LogLib.Log("Client.js","onConnError");
        Log.e('Connection '+remoteAddress+' error: '+err.message);
    }.bind(this);

    var remoteAddress = this.connection.remoteAddress + ':' + this.connection.remotePort;
    Log.i('new client connection from '+remoteAddress);
    this.connection.on('data', onConnData.bind(this));
    this.connection.on('end', (data) => {
        Log.w("Connection ended: "+data);
    });
    this.connection.on('close', onConnClose);
    this.connection.on('error', onConnError);

    //MAYBE: Handle messages to the AirBridge bot separately in a separate library

    var processCompleteIncomingTransmission = async function(message) {
        var Log = new LogLib.Log("Client.js","processCompleteIncomingTransmission");
        Log.i("Processing incoming transmission");
        var unpacker = new AirUnpacker(message);
        var messageLength = unpacker.readInt();
        Log.v("Message length: "+messageLength);
        var encryptionStatus = unpacker.readBoolean();
        Log.v("Encryption status: "+encryptionStatus);
        if (encryptionStatus == 1) {
            Log.v("Message is encrypted, send to decryptAndProcess() function");
            decryptAndProcess(unpacker);
        } else {
            Log.v("Message is not encrypted, processing...");
            var messageType = unpacker.readInt(); //nhtInformation
            Log.v("Message type: "+messageType);
            //Is nhtInformation a vaoid thing to receive?
            if (messageType == CommConst.nhtAuthentication) { //nhtAuthentication: The client wants to authenticate
                Log.v("Client authentication message received. Processing...");
                processNhtAuthentication(unpacker);
            }  else if (messageType == CommConst.nhtPing) {
                Log.i("Client ping message received. Sending pong");
                var responsePacker = new AirPacker();
                Log.v("Packing int (message type): nhtPong: "+CommConst.nhtPong);
                responsePacker.packInt(CommConst.nhtPong);
                Log.v("Writing header (unencrypted)");
                responsePacker.writeHeader(false);
                Log.i("Sending pong message");
                globalThis.connection.write(responsePacker.getBuffer());
            }
            //TODO: Implement nhtClose
        }
    }.bind(this);
    //TODO: Maybe shut down stuff like event handlers once connection is closed?

    var processNhtAuthentication = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtAuthentication");
        Log.i("Processing nhtAuthentication");
        //nhtAuthetication is technically an "unencrypted" message as it contains some unencrypted data.
        //This data is assumed to be missing the initial length int, encryption boolean, and message type.

        //Therefore, it is not decrypted before being sent to this function.
        //This function's job is to decrypt this thing (if possible). If it can't, it'll return false and the client will get yelled at for having the wrong password

        var decryptionFailed = false;
        try {
            var encryptedBlockLength = unpacker.readInt();
            Log.v("Length of encrypted block: "+encryptedBlockLength);
            var decryptedData = await unpacker.decryptRestOfData();
            Log.vv("Decrypted data: "+decryptedData.toString("hex"));
            var decryptedUnpacker = new AirUnpacker(decryptedData);
            Log.v("Data was decrypted! Checking if decryption was correct");

            var transmissionCheck = decryptedUnpacker.readVariableLengthData();
            Log.v("Transmission check: "+transmissionCheck.toString("hex"));
            var installationId = decryptedUnpacker.readVariableLengthUTF8String();
            Log.v("Installation ID: "+installationId);
            var clientName = decryptedUnpacker.readVariableLengthUTF8String();
            Log.v("Client name: "+clientName);
            var platformName = decryptedUnpacker.readVariableLengthUTF8String();
            Log.v("Platform name: "+platformName);
        } catch (err) {
            Log.w("Decryption failed (possibly a wrong password): "+err);
            decryptionFailed = true;
        }

        //TODO: Properly use .bind() and get rid of globalThis
        if (decryptionFailed || Buffer.compare(transmissionCheck, globalThis.transmissionCheck) != 0) {
            //Ope, somebody has the wrong password. Or maybe the transmission check was wrong.
            Log.e(clientName+" on "+platformName+" most likely tried to log in with the wrong password");
            globalThis.transmissionCheck = null; //Reset the transmission check

            var messagePacker = new AirPacker();
            Log.v("Packing int (message type): nhtAuthetication: "+CommConst.nhtAuthentication);
            messagePacker.writeInt(CommConst.nhtAuthetication); //nhtAuthentication is the message type
            Log.v("Packing int (authentication status): Unauthorized: 1");
            messagePacker.writeInt(CommConst.nstAuthenticationUnauthorized); //Authentication is unauthorized (wrong password)
            Log.v("Packing unencrypted header");
            messagePacker.writeHeader(false); //Write the header, this message isn't encrypted
            Log.i("Sending client the authentication error message");
            globalThis.connection.write(messagePacker.getBuffer());
            return;

        }
        Log.i("Decryption successful!");
        Log.i(clientName+" on "+platformName+" successfully authenticated to the server");
        globalThis.authenticated = true;
        globalThis.clientName = clientName;
        globalThis.platformName = platformName;
        globalThis.installationId = installationId;


        responsePacker = new AirPacker();
        Log.i("Sending nhtAuthentication response to client");
        Log.v("Packing int (message type): nhtAuthentication: "+CommConst.nhtAuthentication);
        responsePacker.writeInt(CommConst.nhtAuthentication); //Message type is nhtAuthentication
        Log.v("Packing int (authentication status): nstAuthenticationOK: "+CommConst.nstAuthenticationOK)
        responsePacker.writeInt(CommConst.nstAuthenticationOK); //Authentication status is nstAuthenticationOK
        Log.v("Packing string (installation ID): "+ConversionDatabase.getInstallationID());
        responsePacker.writeString(ConversionDatabase.getInstallationID()); //Installation GUID
        //This installation-specific UUID is stored inside the ConversionDatabase, and is randomly generated if missing

        Log.v("Packing string (device name): AirBridge");
        responsePacker.writeString("AirBridge"); //Device name.
        Log.v("Packing string (system version): 10.15.7");
        responsePacker.writeString("10.15.7"); //Mac system version. AirBridge pretends that it is macOS Catalina (10.15.17)
        Log.v("Packing string (AirMessage client version): 3.0.1");
        responsePacker.writeString("3.0.1"); //AirMessage server software version (3.2)

        Log.v("Encrypting message");
        var encryptedWithHeader = await responsePacker.encryptAndWriteHeader();
        Log.v("Sending encrypted message to client");
        globalThis.connection.write(encryptedWithHeader); //Sends the data to the client

        //Sets up event listeners for websocket pushes
        this.websocketMessageListenerSMServer = SMServerWebsocket.addEventListener("message", handleWebsocketMessage);
        this.websocketMessageListenerSMServer = SMServerWebsocket.addEventListener("read", handleMessageActivityStatus);
    }.bind(this);

    //DOES THE CLIENT EXPECT THE LATEST DATABASE ENTRY ID?? Looks like it doesn't I don't think

    //Sends nhtIDUpdate (211) as int
    //  Pack int: CommConst.nhtIDUpdate
    //  Pack long: ID (Is this a ROWID?)
    //  Send the message
    //Sends the ID as a long

    var decryptAndProcess = async function (unpacker) {
        var Log = new LogLib.Log("Client.js","decryptAndProcess");

        Log.i("Decrypting message and processing...");

        if (!globalThis.authenticated) {
            Log.e("Not decrypting message because client isn't authenticated!");
            return;
        }

        var decrypted = await unpacker.decryptRestOfData();
        var decryptedunpacker = new AirUnpacker(decrypted);

        var messageType = decryptedunpacker.readInt();
        //TODO: ADD TRY/CATCH TO ALL OF THESE
        try {
            Log.i("Message NHT type: "+messageType); //TODO: Say Nht type here
            // case CommConst.nhtTimeRetrieval -> handleMessageTimeRetrieval(client, unpacker); //201
            if (messageType == CommConst.nhtTimeRetrieval) {
                processNhtTimeRetrieval(decryptedunpacker);
            }
            // case CommConst.nhtIDRetrieval -> handleMessageIDRetrieval(client, unpacker);
            else if (messageType == CommConst.nhtIDRetrieval) {
                processNhtIdRetrieval(decryptedunpacker);
            }
            // case CommConst.nhtMassRetrieval -> handleMessageMassRetrieval(client, unpacker);
            else if (messageType == CommConst.nhtMassRetrieval) {
                processNhtMassRetrieval(decryptedunpacker);
            }
            // case CommConst.nhtConversationUpdate -> handleMessageConversationUpdate(client, unpacker);
            else if (messageType == CommConst.nhtConversationUpdate) {
                processNhtConversationUpdate(decryptedunpacker);
            }
            // case CommConst.nhtAttachmentReq -> handleMessageAttachmentRequest(client, unpacker);
            else if (messageType == CommConst.nhtAttachmentReq) {
                processNhtAttachmentRequest(decryptedunpacker);
            }
            //
            // case CommConst.nhtLiteConversationRetrieval -> handleMessageLiteConversationRetrieval(client, unpacker)
            else if (messageType == CommConst.nhtLiteConversationRetrieval) {
                processNhtLiteConversationRetrieval(decryptedunpacker);
                //TODO: What is different about lite retrieval
            }
            // case CommConst.nhtLiteThreadRetrieval -> handleMessageLiteThreadRetrieval(client, unpacker);
            else if (messageType == CommConst.nhtLiteThreadRetrieval) {
                processNhtLiteThreadRetrieval(decryptedunpacker);
            }
            //
            // case CommConst.nhtCreateChat -> handleMessageCreateChat(client, unpacker);
            else if (messageType == CommConst.nhtCreateChat) {
                processNhtCreateChat(decryptedunpacker);
            }
            // case CommConst.nhtSendTextExisting -> handleMessageSendTextExisting(client, unpacker);
            else if (messageType == CommConst.nhtSendTextExisting) {
                processNhtSendTextExisting(decryptedunpacker);
            }
            // case CommConst.nhtSendTextNew -> handleMessageSendTextNew(client, unpacker);
            else if (messageType == CommConst.nhtSendTextNew) {
                processNhtSendTextNew(decryptedunpacker);
            }
            // case CommConst.nhtSendFileExisting -> handleMessageSendFileExisting(client, unpacker);
            else if (messageType == CommConst.nhtSendFileExisting) {
                processNhtSendFileExisting(decryptedunpacker);
            }
            // case CommConst.nhtSendFileNew -> handleMessageSendFileNew(client, unpacker);
            else if (messageType == CommConst.nhtSendFileNew) {
                processNhtSendFileNew(decryptedunpacker);
            }
            else {
                Log.e("ERROR: Unknown NHT type: "+messageType);
            }
        } catch (err) {
            Log.e("Error processing message: "+err);
        }
    }.bind(this);

    //TODO: Use lite conversation retrieval
    var handleWebsocketMessage = async function(messages) {
        // console.log(messages);
        var Log = new LogLib.Log("Client.js", "handleWebsocketMessage");
        Log.i("Handling message from websocket");
        // messages = SMServerAPI.fixFormattingForMultipleMessages(messages);
        var stacked = await SMServerAPI.stackTapbacks(messages, handleOrphanedTapbacks);
        if (stacked.length == 0) {
            return; //Must have been an orphaned tapback, as those are handled separately in the handleOrphanedTapbacks function
        }
        console.log(stacked);
        Log.v("Setting last-seen message time to "+stacked[0].unixdate);
        // globalThis.clientLastSeenTime = ConversionDatabase.convertAppleDateToUnixTimestamp(messages[0]);
        globalThis.clientLastSeenTime = stacked[0].unixdate;

        var responsePacker = new AirPacker();
        await responsePacker.packAllMessagesFromSMServer(stacked);
        var encrypted = await responsePacker.encryptAndWriteHeader();
        Log.i("Encrypted, sending message to client...");
        globalThis.connection.write(encrypted);
    }.bind(this);
    //TODO: Get stickers working, not just as attachments
    var sendInfoMessageToClient = async function(message_text) {
        var Log = new LogLib.Log("Client.js","sendInfoMessageToClient");
        Log.i("Sending informational message to client: "+message_text);
        var responsePacker = new AirPacker();
        Log.v("Packing synthesized message from AirBridge");
        responsePacker.packAllMessagesFromSMServer([{
            subject: '',
            is_from_me: false,
            text: message_text,
            cache_has_attachments: false,
            associated_message_type: 0,
            date_read: 0,
            service: 'iMessage',
            associated_message_guid: '',
            id: 'AirBridge',
            item_type: 0,
            group_action_type: 0,
            date: ConversionDatabase.convertUnixTimestampToAppleDate(Date.now()),
            guid: uuidv4(),
            conversation_id: 'AirBridge',
            ROWID: ConversionDatabase.getInfoMessageROWID(),
            balloon_bundle_id: '',
            tapbacks: []
        }]);
        Log.v("Encrypting message");
        var encrypted = await responsePacker.encryptAndWriteHeader();
        Log.v("Sending message");
        globalThis.connection.write(encrypted);
    }.bind(this);

    //TODO: On run, send a ping to all clients. Not sure how to do this

    var processNhtSendTextNew = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtSendTextNew");
        var start_time = Date.now();
        Log.i("Processing nhtSendTextNew");
        var requestID = unpacker.unpackShort(); //Request ID to avoid collisions
        Log.v("Request ID: "+requestID);
        // String[] members = new String[unpacker.unpackArrayHeader()]; //The members of the chat to send the message to
        var members = unpacker.unpackUTF8StringArray();
        Log.v("Members: "+members);
        // for(int i = 0; i < members.length; i++) members[i] = unpacker.unpackString();
        var service = unpacker.readVariableLengthUTF8String();
        Log.v("Service: "+service);
        // String service = unpacker.unpackString(); //The service of the chat
        var message = unpacker.readVariableLengthUTF8String();
        Log.v("Message: "+message);
		// String message = unpacker.unpackString(); //The message to send
        var responsePacker = new AirPacker();

        Log.v("Packing int nhtSendResult: "+CommConst.nhtSendResult);
        responsePacker.packInt(CommConst.nhtSendResult);

        Log.v("Packing short requestID: "+requestID);
        responsePacker.packShort(requestID);
        if (members.length > 1) {
            sendInfoMessageToClient("Sorry, AirBridge doesn't support the creation of group chats (yet)");
            Log.w("User tried to create a group chat, which isn't supported yet");
            Log.v("Packing error type: "+CommConst.nstSendResultScriptError);
            responsePacker.packInt(CommConst.nstSendResultScriptError);
            Log.v("Packing error message: AirBridge doesn't support group creation at the moment :(");
            responsePacker.packNullableString("AirBridge doesn't support group creation at the moment :(");
        } else {
            Log.v("User isn't trying to create a group chat, proceeding");
            Log.v("Packing error type: 0");
            responsePacker.packInt(0);
            Log.v("Packing error message: null");
            responsePacker.packNullableString(null);

            var recipient = members[0];
            if (ConversionDatabase.isPhoneNumber(recipient)) {
                Log.v("Fromatting phone number: "+recipient);
                recipient = ConversionDatabase.getInternationalPhoneNumberFormat(recipient);
                Log.v("Filtered to "+recipient);
                //This makes sure the phone number is in the correct format.
            }

            //TODO: Get the phone number format right here
            Log.v("Sending text message \""+message+"\" to chat "+members[0]+" via SMServerAPI");
            SMServerAPI.sendTextMessage(message, members[0]).then(() => {
                Log.v("Text message callback reached, setting timeout for 400ms");

                //TODO: Maybe wait until the websocket registers?
                //I think this is outdated as it will update when the websocket fires
                // setTimeout(function() {
                //     Log.v("Timeout complete, sending messages after "+start_time+" to client");
                //     // updateClientWithRecentMessages();
                //     sendLastMessageFromConversationToClient(members[0], start_time);
                //     //This happens once SMServer sends the message
                // }, 400); //TODO: FIIIIX THIS??
            });
        }
        Log.v("Encrypting response");
        var encrypted = await responsePacker.encryptAndWriteHeader();
        Log.i("Sending nhtSendResult to client");
        globalThis.connection.write(encrypted);

    }.bind(this);

    var processNhtSendFileNew = async function(unpacker) {
        //TODO: add a waitForNextMessageFromClient() function that is awaitable? Use websockets?
        //  Use it to wait for the next message from client

        //NEXT STEPS: TODO: Figure out how to send a file here, like nhtFileExisting
    }.bind(this);

    //sendTextExisting or createChat
    var processNhtCreateChat = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtCreateChat");
        Log.i("Processing nhtCreateChat");
        //Nothing is actually created, as conversation creation is handled automatically
        //when a message is sent. Groups, however, present a challenge.

        // short requestID = unpacker.unpackShort(); //The request ID to avoid collisions
        var requestID = unpacker.unpackShort();
        Log.v("Request ID: "+requestID);
        // String[] chatMembers = new String[unpacker.unpackArrayHeader()]; //The members of this conversation
        var chatMembers = unpacker.unpackUTF8StringArray();
        Log.v("Chat members: "+chatMembers);
        // for(int i = 0; i < chatMembers.length; i++) chatMembers[i] = unpacker.unpackString();
		// String service = unpacker.unpackString(); //The service of this conversation
        var service = unpacker.unpackString();
        Log.v("Service: "+service);
        //
		// //Creating the chat
		// Constants.Tuple<Integer, String> result = AppleScriptManager.createChat(chatMembers, service);
        //
		// //Sending a response
		// sendMessageRequestResponse(client, CommConst.nhtCreateChat, requestID, result.item1, result.item2);

        var responsePacker = new AirPacker();

        // packer.packInt(header);
        Log.v("Packing int nhtCreateChat: "+CommConst.nhtCreateChat);
        responsePacker.packInt(CommConst.nhtCreateChat);
		// packer.packShort(requestID);
        Log.v("Packing short requestID: "+requestID);
        responsePacker.packShort(requestID);
		// packer.packInt(resultCode); //Result code
        if (chatMembers.length > 1) {
            Log.w("Client tried to create a group chat, which isn't supported right now :(");
            Log.v("Sending info message to client: Sorry, AirBridge doesn't support creating group chats (yet)");
            sendInfoMessageToClient("Sorry, AirBridge doesn't support creating group chats (yet)");
            Log.v("Packing int (error type): nstSendResultScriptError: "+CommConst.nstSendResultScriptError)
            responsePacker.packInt(CommConst.nstSendResultScriptError); //AirBridge doesn't support creating group chats (yet)
            Log.v("Packing nullable string (error details): AirBridge doesn't support creating group chats (yet)");
            responsePacker.packNullableString("AirBridge doesn't support creating group chats (yet)");

        } else {
            Log.v("Packing int: error type: "+0);
            responsePacker.packInt(0);
            Log.v("Packing nullable string (error details): null");
            responsePacker.packNullableString(null);
        }
		// packer.packNullableString(details);
        //
		// dataProxy.sendMessage(client, packer.toByteArray(), true);
        Log.v("Encrypting response");
        var encrypted = await responsePacker.encryptAndWriteHeader();
        Log.i("Sending nhtCreateChat result to client");
        globalThis.connection.write(encrypted);
        //
		// return true;




        //Error codes:
        // public static final int nstCreateChatOK = 0;
	    // public static final int nstCreateChatScriptError = 1; //Some unknown AppleScript error
	    // public static final int nstCreateChatBadRequest = 2; //Invalid data received
	    // public static final int nstCreateChatUnauthorized = 3; //System rejected request to send message
    }.bind(this);

    var processNhtMassRetrieval = async function(unpacker) { //MassRetrievalANCHOR
        var Log = new LogLib.Log("Client.js","processNhtMassRetrieval");
        Log.i("Processing nhtMassRetrieval");
        var requestID = unpacker.unpackShort();
        Log.v("Request ID: "+requestID);
        var filterMessagesByDate = unpacker.unpackBoolean();
        Log.v("Filter messages by date: "+filterMessagesByDate);
        var timeSinceMessages = 0; //Unix timestamp as the earliest date to download messages from
        if (filterMessagesByDate) {
            timeSinceMessages = unpacker.unpackLong();
        }
        Log.v("Find message since time: "+timeSinceMessages);

        var downloadAttachments = unpacker.unpackBoolean();
        Log.v("Download attachments: "+downloadAttachments);

        var restrictAttachmentsDate = false; //The following will be updated if downloadAttachments == true
        var timeSinceAttachments = -1;
        var restrictAttachmentsSize = false;
        var attachmentsSizeLimit = -1;
        var attachmentFilterWhitelist = null; //Only download attachment files if on this list
        var attachmentFilterBlacklist = null; //Don't download attachment files if they're on this list
        var attachmentFilterDLOther = false; //Download attachment files if they're not on either list. (catch-all)

        if (downloadAttachments) {
            restrictAttachmentsDate = unpacker.unpackBoolean();
            if (restrictAttachmentsDate) {
                timeSinceAttachments = unpacker.unpackLong();
            }

            restrictAttachmentsSize = unpacker.unpackBoolean();
            if (restrictAttachmentsSize) {
                attachmentsSizeLimit = unpacker.unpackLong();
            }

            attachmentFilterWhitelist = unpacker.readUTF8StringArray();
            attachmentFilterBlacklist = unpacker.readUTF8StringArray();
            attachmentFilterDLOther = unpacker.unpackBoolean();
        }
        Log.v("Restrict attachments by date: "+restrictAttachmentsDate);
        Log.v("Find attachments since time: "+timeSinceAttachments);
        Log.v("Restrict attachments by size: "+restrictAttachmentsSize);
        Log.v("Attachment size limit: "+attachmentsSizeLimit);
        Log.v("Attachment filter whitelist: "+attachmentFilterWhitelist);
        Log.v("Attachment filter blacklist: "+attachmentFilterBlacklist);
        Log.v("Download attachments not on the above whitelist: "+attachmentFilterDLOther);

        // return;

        //sets up a MassRetrievalRequest.,
        //  MassRetrievalRequest adds a conversationInfo instance to the conversationInfoList
        //  Filter messages based on given restrictions if necessary (could do this before, using prefiltering in the SMServerAPI)
        //  sendMassRetrievalInitial()
        //  Packet index = 1
        //  Read message data chunk by chunk
        //      I think chunk sizes are just on an as-needed basis
        //      sendMassRetrievalMessages with the request ID, the packet index

        // var conversations = await SMServerAPI.getConversationsAfterTime(timeSinceMessages);
        // var conversations = await SMServerAPI.getAllConversations(); //Should this be time-restricted like above?
        var conversations = await SMServerAPI.getConversationsAfterTime(timeSinceMessages);
        Log.v("Getting all conversations from SMServer");
        Log.vv(JSON.stringify(conversations));
        // SMServer.getMessagesForOneConversationWhileConditionIsTrue(conversations, (message) => {
        //     //compare function
        // }, onChunkFromSMServer);

        //sendMassRetrievalInitial:
        //  Pack int: nhtMassRetrieval
        //  Pack short: Request ID
        //  Pack int: 0 (request index)
        //  Pack array header: Length of conversations
        //  For each conversation:
        //      writeObject() for the conversation
        //  Pack int: Message count
        //  Send the message

        //We need to get all the messages first as the client wants to know how many there are

        globalThis.clientLastSeenTime = Date.now(); //The client will be caught up to all messages before the current time

        var all_messages = [];
        Log.v("Looping through conversations");
        for (var i = 0; i < conversations.length; i++) {
            Log.v("Getting messages for "+conversations[i]+", filtered by time");
            var conv_messages = await SMServerAPI.getMessagesForOneConversationWhileConditionIsTrue(conversations[i].chat_identifier, (message) => {
                var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date);
                return unixstamp >= timeSinceMessages;
            });
            Log.v("Got messages for "+conversations[i].id+", adding to all_messages array");
            Log.vv("Messages: "+JSON.stringify(conv_messages));
            all_messages = all_messages.concat(conv_messages);
        }
        Log.v("Loop complete, got messages for every conversation");
        // all_messages = [{
        //     group_action_type: 0,
        //     balloon_bundle_id: '',
        //     date_read: 645402658616994000,
        //     associated_message_guid: '',
        //     item_type: 0,
        //     cache_has_attachments: false,
        //     associated_message_type: 0,
        //     text: 'Test test',
        //     id: 'name@example.com',
        //     guid: '1C2D60C6-379D-4EEB-9B0F-B1C75BC6ABDF',
        //     service: 'iMessage',
        //     is_from_me: false,
        //     subject: 'Pop pop!',
        //     ROWID: 2,
        //     date: 645402655814933000,
        //     tapbacks: [],
        //     conversation_id: "name@example.com"
        // }];


        Log.i("Packing conversations for nhtMassRetrieval");
        var initialPacker = new AirPacker();
        Log.v("Packing int (message type): nhtMassRetrieval: "+CommConst.nhtMassRetrieval);
        initialPacker.packInt(CommConst.nhtMassRetrieval);
        Log.v("Packing int (request ID): "+requestID);
        initialPacker.packShort(requestID);
        Log.v("Packing int (request index): "+0); //Always going to be the first one, as it's the initial
        initialPacker.packInt(0); //Request index (xmass retrieval message 0, 1, 2, etc)
        Log.v("Packing array header (number of conversations): "+conversations.length);
        initialPacker.packArrayHeader(conversations.length);
        for (var i = 0; i < conversations.length; i++) {
            Log.v("Packing one conversation from SMServer: "+JSON.stringify(conversations[i]));
            initialPacker.packOneConversationFromSMServer(conversations[i]);
        }
        //Pack int: Message count
        Log.v("Packing number of messages: "+all_messages.length);
        initialPacker.packInt(all_messages.length);
        //Send the message
        Log.v("Encrypting initialPacker");
        var encrypted = await initialPacker.encryptAndWriteHeader();
        Log.i("Initial nhtMassRetrieval response finished and encrypted, sending");
        globalThis.connection.write(encrypted);

        console.log(all_messages);
        all_messages = await SMServerAPI.stackTapbacks(all_messages, handleOrphanedTapbacks);


        var sendMessageChunk = async function(messages, packet_index) { //This is the callback that runs on each chunk
            var Log = new LogLib.Log("Client.js","processNhtMassRetrieval>sendMessageChunk");
            Log.i("Sending message chunk "+packet_index);
            Log.v("Stacking tapbacks");
            // var messagesWithTapbacks = await SMServerAPI.stackTapbacks(messages, handleOrphanedTapbacks);
            var messagesWithTapbacks = messages;
            //CHANGED: This is now handled above so we don't get orphaned tapbacks
            var chunkPacker = new AirPacker();
        //          Pack int: nhtMassRetrieval
            Log.v("Packing int (message type): nhtMassRetrieval: "+CommConst.nhtMassRetrieval);
            chunkPacker.packInt(CommConst.nhtMassRetrieval);
        //          Pack short: Request ID
            Log.v("Packing short (Request ID): "+requestID);
            chunkPacker.packShort(requestID);
            Log.v("Packing int (packet index): "+packet_index);
            chunkPacker.packInt(packet_index); //Forgot about this

        //          Pack array header: Number of conversation items
            Log.v("Packing array header (number of messages): "+messagesWithTapbacks.length);
            chunkPacker.packArrayHeader(messagesWithTapbacks.length);
        //          For each conversation item, writeObject() for it
            for (var i = 0; i < messagesWithTapbacks.length; i++) {
                Log.vv("Packing message: "+JSON.stringify(messagesWithTapbacks[i]));
                await chunkPacker.packMessageDataFromSMServer(messagesWithTapbacks[i]);
            }
        //          Send the message
            Log.v("Encrypting message");
            var encrypted = await chunkPacker.encryptAndWriteHeader();
            Log.i("Sending encrypted message chunk to client");
            globalThis.connection.write(encrypted);
        };

        var chunk_size = 60;
        var packetIndex = 1;
        Log.v("Looping through messages and sending chunks");
        for (var i = 0; i < all_messages.length; i += chunk_size) {
            //TODO: Deal with orphaned tapbacks between loop cycles
            var chunk = all_messages.slice(i, i + chunk_size);
            Log.vv("Chunk: "+JSON.stringify(chunk));
            Log.v("Sending chunk");
            await sendMessageChunk(chunk, packetIndex);
            Log.v("Sent chunk");
            packetIndex++;
            //TODO: Does this need to be awaited? Can we send them all at once instead of sequentially?
        }
        if (downloadAttachments) {
            await SMServerAPI.ensureAttachmentFoldersExist();
            // console.log(all_messages);
            var attachment_message_candidates = all_messages.filter((item) => {
                var unixstamp = ConversionDatabase.convertAppleDateToUnixTimestamp(item.date);
                return (unixstamp >= timeSinceAttachments);
            });

            var attachments = SMServerAPI.extractAttachmentInfoFromMessages(attachment_message_candidates);

            attachments = SMServerAPI.filterAttachments(attachments);

            for (var i = 0; i < attachments.length; i++) {
                // console.log(attachments[i]);



                //continue the sending of the attachment
                var mime_type_parts = attachments[i].mime_type.split("/");
                var attachmentIsAllowed = attachmentFilterDLOther;

                for (var j = 0; j < attachmentFilterWhitelist.length; j++) {
                    // console.log(attachmentFilterWhitelist[i]);
                    var whitelist_mime_type_parts = attachmentFilterWhitelist[j].split("/");
                    if (whitelist_mime_type_parts[0] == mime_type_parts[0] && (whitelist_mime_type_parts[1] == mime_type_parts[1] || whitelist_mime_type_parts[1] == "*")) {
                        //Makes sure the first part "image" or "application" and second parts "rtf" or "pdf" both match. The second part can also be an asterisk (*)
                        attachmentIsAllowed = true;
                    }
                }

                for (var j = 0; j < attachmentFilterBlacklist.length; j++) {
                    var whitelist_mime_type_parts = attachmentFilterBlacklist[j].split("/");
                    if (whitelist_mime_type_parts[0] == mime_type_parts[0] && (whitelist_mime_type_parts[1] == mime_type_parts[1] || whitelist_mime_type_parts[1] == "*")) {
                        //Makes sure the first part "image" or "application" and second parts "rtf" or "pdf" both match. The second part can also be an asterisk (*)
                        attachmentIsAllowed = false;
                    }
                }

                if (attachmentIsAllowed) { //TODO: What if the attachment was sent from AirBridge--AirBridge doesn't send MIME types. Does iMessage add them?

                    var localpath = await SMServerAPI.downloadAttachmentIfNecessary(attachments[i]);
                    var promiseStats = function(filename) {
                        return new Promise((resCb, rejCb) => {
                            fs.stat(filename, (err, stats) => {
                                if (err) {
                                    rejCb(err);
                                } else {
                                    resCb(stats);
                                }
                            });
                        });
                    }
                    var stats = await promiseStats(localpath);
                    var fileLength = stats.size;

                    if (attachmentsSizeLimit == -1 || fileLength < attachmentsSizeLimit) {
                        Log.v("Attachment "+attachments[i].filename+" is allowed because its mime type "+attachments[i].mime_type+" matches and so does the date");

                        await globalThis.sendMassRetrievalFileFromFileID(requestID, attachments[i].filename);
                        // break;
                    } else {
                        Log.v("Attachment "+attachments[i].filename+" is allowed because its size is too large");
                    }

                } else {
                    Log.v("Attachment "+attachments[i].filename+" is not allowed because its mime type "+attachments[i].mime_type+" does not match");
                }


            }
        }


        //  Asynchronous at same time as message retrieval: onAttachmentChunkLoaded
        //      First run = request index = 0
        //      Filter by date, size, etc
        //      Run sendMassRetrievalFileChunk with request ID, request index, filename, isLast, guid, data, length
        //      Request index ++

        //  Once done with everything, sendMessageHeaderOnly() with nhtMassRetrievalFinish (encrypted)


        //  TODO: Cancel if the connection has closed?

        //sendMassRetrievalMessages:
        //  Pack int: nhtMassRetrieval
        //  Pack short: request ID
        //  Pack int: packetIndex
        //  Pack array header: Number of conversationitems in the list
        //  For each conversationItem, writeObject() for it
        //  Send the message

        //sendMassRetrievalFileChunk (send this for each attachment. Send the request ID and index along with filename)
        //  Pack int: nhtMassRetrievalFile
        //  Pack short: request ID
        //  Pack int: request index
        //  If the request index == 0, pack a string: filename
        //  Pack boolean: Is this the last chunk?
        //  Pack string: GUID of file
        //  Pack payload: Chunk of data, of the length that the client asked for earlier
        //  Send the message

        //This is the final piece--just letting the client know that the process is complete
        Log.i("Messages and attachments finished sending, waiting 5000ms to send finish message");
        setTimeout(async function() { //Waits to make sure the client got all the messages (sending this too early causes an error)
            Log.i("Sending mass retrieval finish message");
            var finalResponsePacker = new AirPacker();
            Log.v("Packing int (message type): nhtMassRetrievalFinish: "+CommConst.nhtMassRetrievalFinish);
            finalResponsePacker.packInt(CommConst.nhtMassRetrievalFinish);
            Log.v("Encrypting");
            var encrypted = await finalResponsePacker.encryptAndWriteHeader();
            Log.v("Sending encrypted nhtMassRetrievalFinish message. Mass retrieval is complete!!!");
            globalThis.connection.write(encrypted);
        }, 5000);

    }.bind(this);

    //Looks like each time the server returns the list of messages, the client tacks them on the end
    var sendLastMessageFromConversationToClient = async function(conversation_id, start_time) {

        globalThis.clientLastSeenTime = Date.now();

        var Log = new LogLib.Log("Client.js","sendLastMessageFromConversationToClient");
        Log.i("Sending last few messages to client after "+start_time);
        Log.v("Getting last few messages from SMServer");
        var lastMessages = await SMServerAPI.getLastMessageFromConversation(conversation_id, start_time);
        Log.vv("Messages from time frame: "+JSON.stringify(lastMessages));
        Log.v("Stacking tapbacks");
        lastMessages = await SMServerAPI.stackTapbacks(lastMessages, handleOrphanedTapbacks);
        var responsePacker = new AirPacker();
        Log.v("Packing last "+lastMessages.length+" messages from SMServer: ");
        await responsePacker.packAllMessagesFromSMServer(lastMessages);
        Log.v("Encrypting messages from SMServer");
        var encryptedWithHeader = await responsePacker.encryptAndWriteHeader();
        Log.i("Message encrypted, sending");
        globalThis.connection.write(encryptedWithHeader);
    }.bind(this);

    var handleOrphanedTapbacks = async function (tapback_messages) {
        var Log = new LogLib.Log("Client.js","handleOrphanedTapbacks");
        if (tapback_messages.length == 0) {
            return; //Nothing to do here
        }

        Log.i("Handling "+tapback_messages.length+" orphaned tapbacks");
        Log.vv(JSON.stringify(tapback_messages));
        var responsePacker = new AirPacker();
        //Pack int: nhtModifierUpdate
        Log.v("Packing int (message type): nhtModifierUpdate: "+CommConst.nhtModifierUpdate);
        responsePacker.packInt(CommConst.nhtModifierUpdate);
        //For each tapback
        Log.v("Packing array header (number of tapbacks): "+tapback_messages.length);
        responsePacker.packArrayHeader(tapback_messages.length);
        //Pack the TapbackModifierInfo
        for (var i = 0; i < tapback_messages.length; i++) {
            Log.v("Packing tapback "+i);
            responsePacker.packTapback(tapback_messages[i]);
        }
        //  Pack the item type:
        //  Pack a string: The message GUID
        //  Pack the message index (0, 1, 2, etc. This is the p:0/whatever)
        //  Pack a nullable string: Sender
        //  Pack boolean: isAddition
        //  Pack int: Tapback type
        Log.v("Encrypting response");
        var encrypted = await responsePacker.encryptAndWriteHeader();
        //Send the message
        Log.i("Sent encrypted response to client");
        globalThis.connection.write(encrypted);
    }.bind(this);

    var handleMessageActivityStatus = async function(update) {
        var Log = new LogLib.Log("Client.js","handleMessageActivityStatus");
        Log.v(JSON.stringify(update));
        var updates = [update];
        // if (messages.length == 0) {
        //     return; //Nothing to do here
        // }

        var targetGUID = update.guid;
        var message = null;
        // await SMServerAPI.getAllMessagesWhileConditionIsTrue;
        // NEXT STEPS: Search for and find the target message GUID and get the date read

        var message = await SMServerAPI.findMessageByGUID(update.guid);
        console.log(message);
        // Then send it to the client via AirPacker.packActivityStatus()

        Log.i("Handling "+updates.length+" activity status (read) updates");
        var responsePacker = new AirPacker();
        //Pack int: nhtModifierUpdate
        Log.v("Packing int (message type): nhtModifierUpdate: "+CommConst.nhtModifierUpdate);
        responsePacker.packInt(CommConst.nhtModifierUpdate);
        //For each tapback
        Log.v("Packing array header (number of activity status updates): "+updates.length);
        responsePacker.packArrayHeader(updates.length);
        //Pack the TapbackModifierInfo
        for (var i = 0; i < updates.length; i++) {
            Log.v("Packing tapback "+i);
            responsePacker.packActivityStatus(message);
        }
        //  Pack the item type:
        //  Pack a string: The message GUID
        //  Pack the message index (0, 1, 2, etc. This is the p:0/whatever)
        //  Pack a nullable string: Sender
        //  Pack boolean: isAddition
        //  Pack int: Tapback type
        Log.v("Encrypting response");
        var encrypted = await responsePacker.encryptAndWriteHeader();
        //Send the message
        Log.i("Sent encrypted response to client");
        globalThis.connection.write(encrypted);
    }.bind(this);

    var processNhtTimeRetrieval = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtTimeRetrieval");
        Log.i("Processing nhtTimeRetrieval");
        var timeLower = unpacker.readLong();
        Log.v("Time lower bound: "+timeLower+" ("+new Date(timeLower)+")");

        var timeUpper = unpacker.readLong();
        Log.v("Time upper bound: "+timeUpper+" ("+new Date(timeUpper)+")");

        globalThis.clientLastSeenTime = timeUpper;

        Log.v("Getting messages from time interval and stacking tapbacks");
        var messages = await SMServerAPI.getAllMessagesFromSpecifiedTimeInterval(timeLower, timeUpper);
        messages = await SMServerAPI.stackTapbacks(messages, handleOrphanedTapbacks);
        Log.vv("Messages with stacked tapbacks: "+messages);

        Log.v("Filtering messages by timeLower");
        messages.filter(item => ConversionDatabase.convertAppleDateToUnixTimestamp(item.date) > timeLower);
        //TODO: WHAT DOES THIS DOO?
        //TODO: Should this be timeUpper?

        //TODO: Implement nhtModifierUpdate for orphaned tapbacks
        //      Maybe use a callback that passes in orphaned tapbacks?
        // messages = [{
        //     "group_action_type": 0,
        //     "id": "name@example.com",
        //     "associated_message_type": 0,
        //     "item_type": 0,
        //     "ROWID": 181,
        //     "balloon_bundle_id": "",
        //     "is_from_me": true,
        //     "associated_message_guid": "",
        //     "text": "test with attachments",
        //     "guid": "27454179-A3FD-4CFD-8A00-6C51F5D06764",
        //     "service": "iMessage",
        //     "attachments": [
        //         {
        //             "mime_type": "image/jpeg",
        //             "filename": "Attachments/0e/14/9F7813EE-27F9-4B6C-B065-97EB93EB1B45/64707785579__167BE7D7-C297-41ED-9BC3-7FD702817586.JPG"
        //         }
        //     ],
        //     "cache_has_attachments": true,
        //     "date_read": 0,
        //     "date": 647077862428000000,
        //     "subject": "Suuubject",
        //     "conversation_id": "name@example.com",
        //     "tapbacks": [{
        //         "associated_message_type": 2004,
        //         "associated_message_guid": 'p:0/688FB450-C715-4914-9D2F-A73F6FDB7BE7'
        //      //Sender is null if it's the user sending the tapback
        //     }]
        // }];

        var responsePacker = new AirPacker();

        Log.v("Packing messages from SMServer");
        await responsePacker.packAllMessagesFromSMServer(messages);

        Log.v("Encrypting the responsePacker");
        var encryptedWithHeader = await responsePacker.encryptAndWriteHeader();
        Log.i("Sending encrypted data");
        globalThis.connection.write(encryptedWithHeader);


        //Are these sorted by conversation? Or are they all just plopped on top?
        //I think these are just the top-level conversations, messages are handled separately (I think in MessageInfo)
        //TODO: What about renaming chats??

        //  If result.isolatedModifies is not empty:
        //      ConnectionManager.getCommunicationsManager().sendModifierUpdate(request.connection, result.isolatedModifiers);


        //TODO: Sort out unavailable conversations (line 380ish in DatabaseManager)

        //this happens for each conversation. Is this for time retrieval or conversation retrieval???

        //Conversation object packing order:
        //packString: Conversation GUID
        //packBoolean: is it available? (true usually)
        //If it's available:
        //  pack a String conversationService: chat.service_name (probably iMessage or SMS or MMS?)
        //  pack a NullableString (name): conversationTitle
        //  pack an array header (members.length)
        //  For each member, pack a String of the member (what is this?):
        //      For each conversation member, get handle.id (I think contacts are synced separately, should program to not do anything on AirBridge)


        //If it's a group (chat... ID or whatever) then handle that separately
        //Otherwise look up the identifier and include that
        //a
    }.bind(this);

    var processNhtIdRetrieval = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtIdRetrieval");
        //TODO: Is this the ROWID/Server ID?
        var idSince = unpacker.unpackLong(); //It's a long, so probably ROWID?
        var timeLower = unpacker.unpackLong();
        var timeUpper = unpacker.unpackLong();
        //TODO: IMPLEMENT THIS!!

        // globalThis.clientLastSeenTime = timeUpper;

        //TODO: Implement this by checking ROWID with getAllMessagesWhileConditionIsTrue

        //Sends a CustomRetrievalRequest
        //Sends a ReadReceiptRequest
    }.bind(this);

    var processNhtConversationUpdate = async function(unpacker) { //see handleMessageConversationUpdate
        var Log = new LogLib.Log("Client.js","processNhtConversationUpdate");
        //Length of chat GUIDs = unpack an array header
        var numChatIDs = unpacker.readArrayHeader();
        //For i until the length of the chat GUIDs, unpack a string. That's the chat GUID
        var chatIDs = [];
        //Could we use unpacker.readUTF8StringArray()?
        for (var i = 0; i < numChatIDs; i++) {
            var id = unpacker.readVariableLengthUTF8String();
            chatIDs.push(id);
        }

        var conversations = await SMServerAPI.searchForMultipleConversations(chatIDs);

        conversations.push({
              chat_identifier: 'AirBridge',
              relative_time: '18:00',
              has_unread: false,
              display_name: 'AirBridge Notifications',
              pinned: false,
              is_group: false,
              time_marker: ConversionDatabase.convertUnixTimestampToAppleDate(Date.now()),
              addresses: 'AirBridge',
              latest_text: 'Reply', //TODO: Implement this
        });

        var responsePacker = new AirPacker();

        responsePacker.packConversationDataFromSMServer(conversations);

        var encryptedWithHeader = await responsePacker.encryptAndWriteHeader();
        globalThis.connection.write(encryptedWithHeader);

        //This deals with the ConversationInfoRequest -> fulfillConversationRequest() in DatabaseManager
        //Uses Blocks.ConversationInfo

        //Pack nhtConversationUpdate as int
        //Pack array header of the length of conversations presented
        //For each conversation, write the conversation block.

        //The format looks like this:

        //For each conversation info:
        //Pack the conversation GUID as a string (this could also be the regular identifier)
        //Pack the availability as a boolean (true if it exists, false if it's deleted I think)
        //If it's available:
        //  Pack a string: Service (WHAT FORMAT IS THIS IN? "iMessage" or "SMS" or something else?)
        //  Pack a nullable string: Group name
        //  Pack an array header: Length of members
        //  For each member:
        //      Pack a string of the member (I think, code doesn't explicitly mention GUIDs)
        //          Not sure if SMServer supports this. Worst case scenario = scan the chat for members?


        //Can we use /requests?search to search for the ID on hand? See if the one we want (with the correct chat ID) exists in the list. WHAT TO DO IF IT DOESN'T EXIST IN THE LIST


    }.bind(this);

    var processNhtLiteConversationRetrieval = async function(unpacker) {
        //Get all conversations!
        var conversations = await SMServerAPI.getAllConversations();

        conversations.push({
              chat_identifier: 'AirBridge',
              relative_time: '18:00',
              has_unread: false,
              display_name: 'AirBridge Notifications',
              pinned: false,
              is_group: false,
              time_marker: ConversionDatabase.convertUnixTimestampToAppleDate(Date.now()), //TODO: Change this
              addresses: 'AirBridge',
              latest_text: 'AirBridge Status Updates',
        });

        //sendLiteConversationInfo
        var responsePacker = new AirPacker();
        //Pack int: nhtLiteConversationRetrieval
        responsePacker.packInt(CommConst.nhtLiteConversationRetrieval);
        //Pack array header: Number of conversations
        responsePacker.packArrayHeader(conversations.length);
        //For each conversation, writeObject() for LiteConversationInfo
        for (var i = 0; i < converastions.length; i++) {
            responsePacker.packOneLiteConversationFromSMServer(conversations[i]);
        }

        //Encrypt and send
        var encrypted = await responsePacker.encryptAndWriteHeader();
        globalThis.connection.write(encrypted);
    }.bind(this);

    //TODO: Maintain a queue of outgoing messages--keep resending until a time-to-live counter hits zero?

    //TODO: Text the AirBridge to change account photo? What if not implemented by SMServer?

    //TODO: What about attachments sent to a conversation?
    var processNhtAttachmentRequest = async function(unpacker) {
        await SMServerAPI.ensureAttachmentFoldersExist();
        var Log = new LogLib.Log("Client.js","processNhtAttachmentRequest");
        Log.i("Processing attachment request!");
        //For testing, download the file to the computer that is the server.
        //Otherwise, forward it straight on from the iPhone storage.

        var requestID = unpacker.unpackShort();
        Log.v("Request ID: "+requestID);
        var chunkSize = unpacker.unpackInt(); //Size of the chunks to be used when slicing up the attachment I guess
        Log.v("Chunk size: "+chunkSize);
        var fileID = unpacker.unpackString(); //GUID of the file to download. Maybe try
        Log.v("File ID: "+fileID);
            //File ID, while technically supposed to be a GUID, is really just the SMServer path
        //Pack int: nhtAttachmentReqConfirm
        //Pack short: Request ID

        var readFilePromise = function(file) {
          return new Promise(function(ok, notOk) {
            fs.readFile(file, function(err, data) {
                if (err) {
                  notOk(err)
                } else {
                  ok(data)
                }
            });
        });
      };


        var localFilePath = await SMServerAPI.downloadAttachmentIfNecessary({"filename":fileID});
            //downloadAttachmentIfNecessary expects an SMServer file format, which is why the above JSON exists

        var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function
        fileData = Zlib.deflateSync(fileData);

        Log.v("Local file path: "+localFilePath);

        Log.i("Packing initial response to the file request");
        var firstResponse = new AirPacker(); //Tells the client we got the request
        Log.v("Packing int (nhtAttachmentReqConfirm): "+CommConst.nhtAttachmentReqConfirm);
        firstResponse.packInt(CommConst.nhtAttachmentReqConfirm);
        Log.v("Packing short (request ID): "+requestID);
        firstResponse.packShort(requestID);
        Log.v("Encrypting and sending");
        var encrypted = await firstResponse.encryptAndWriteHeader();
        globalThis.connection.write(encrypted);

        globalThis.sendFile(fileData, requestID, fileID);


        //TODO: If not found, pack nstAttachmentReqNotFound into the error message
        //TODO: If the path isn't valid or can't read the file, pack nstAttachmentReqNotSaved
        //TODO: If the file is unreadable, pack nstAttachmentReqUnreadable

        //If it didn't work:
        //  Pack int (header): nhtAttachmentReqFail
        //  Pack short (request ID)
        //  Pack int (result code): this is the nstAttachmentReqNotFound/etc thing above
        //  Pack nullable string (details)


        //TODO: Convert the following into its own function?

        //Then we get passed along to fulfillFileRequest
        //Check if the file exists and is accessible (we've made sure this is already true)
        //Set request index to 0
        // var requestIndex = 0;
        // var sliceStart = 0;
        // //Get file length in bytes
        // var stats = fs.statSync(localFilePath); //TODO: Don't use sync, as it blocks the process!
        // //TODO: FIIIIIIX THIS AND USE ASYNC INSTEAD!!!
        // var fileLength = stats.size; //File size in bytes
        //
        // //TODO: Is it possible to do this in chunks?
        // // var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function
        //
        //
        // var isLast = false;
        // while (!isLast) {
        //     Log.v("Preparing to send file chunk");
        //     isLast = isLast || ((sliceStart + chunkSize) >= (fileLength - 1));
        //     Log.i("Will read to "+(sliceStart + chunkSize)+" vs "+(fileLength - 1));
        //     Log.i("Is last? "+isLast);
        //     //If we're reading right up to the last byte, we have the last
        //
        //     //0123456789 01
        //     //Run sendFileChunk() as many times as it takes.
        //     //  Pack int: nhtAttachmentReq
        //     //  Pack short: requestID
        //     //  Pack short: requestIndex (Is this the chunk index or starting position?) (i.e. chunk #1, #2, #3 OR position 100, 200, or 300?)
        //         //Given that it's a short and shorts have a limit of 65000 or so, there can be larger files than 65000 bytes so I assume it's chunk #1, #2, #3, etc
        //         //Update: yeah it increments by one
        //     //  If the requestIndex is 0
        //     //      Pack long: File length (in bytes I assume)
        //     //  Pack boolean: isLast (if this is the last chunk)
        //     //  Pack string: File GUID (could this be the path instead?)
        //     //  Pack payload: Bytes of the file, sliced into whatever chunk we want
        //
        //     var fileChunkResponsePacker = new AirPacker();
        //     //Use chunkSize
        //     fileChunkResponsePacker.packInt(CommConst.nhtAttachmentReq); //nhtAttachmentReq
        //     //TODO: Make a CommConst file?
        //     fileChunkResponsePacker.packShort(requestID);
        //     Log.i("Packing request index: "+requestIndex);
        //     fileChunkResponsePacker.packInt(requestIndex);
        //     if (requestIndex == 0) {
        //         fileChunkResponsePacker.packLong(fileLength); //In bytes I think
        //     }
        //     Log.v("Packing boolean (is last): "+isLast);
        //     fileChunkResponsePacker.packBoolean(isLast);
        //     fileChunkResponsePacker.packString(fileID); //Should be a GUID but whatever
        //     //TODO: Check if the file guid is right
        //     //TODO: Investigate this ^^^^^
        //     // var sliceEnd = Math.min(sliceStart + chunkSize, fileLength - 1)
        //     var sliceEnd = Math.min(sliceStart + chunkSize, fileLength)
        //     Log.i("Slicing from "+sliceStart+" to "+sliceEnd);
        //     var chunkData = fileData.slice(sliceStart, sliceEnd);
        //     // chunkData = Zlib.deflateSync(chunkData); //TODO: FIX THIS! IS IT DEFLATESYNC OR DEFLATERAWSYNC?
        //     // chunkData = Zlib.deflateRawSync(chunkData);
        //     console.log(chunkData);
        //     fileChunkResponsePacker.packPayload(chunkData);
        //
        //     // ConversionDatabase.printUint8Array(fileChunkResponsePacker.getBuffer());
        //     var encrypted = await fileChunkResponsePacker.encryptAndWriteHeader();
        //
        //     globalThis.connection.write(encrypted);
        //     Log.v("File chunk sent");
        //
        //     sliceStart += chunkSize;
        //
        //     requestIndex++;
        //
        //     //TODO: Maybe add a delay?
        // }

    }.bind(this);

    // this.sendFileFromID = async (localFilePath, requestID, fileID) => {
    this.sendFileFromID = async function(requestID, fileID) {
        await SMServerAPI.ensureAttachmentFoldersExist();
        var Log = new LogLib.Log("Client.js", "sendFileFromID");
        Log.v("File ID: "+fileID);
        var readFilePromise = function(file) {
            return new Promise(function(ok, notOk) {
                fs.readFile(file, function(err, data) {
                    if (err) {
                        notOk(err)
                    } else {
                        ok(data)
                    }
                })
            })
        };

        var localFilePath = await SMServerAPI.downloadAttachmentIfNecessary({"filename":fileID});
        Log.v("Local path: "+localFilePath);
        var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function
        Log.v("File data length: "+fileData.length);
        fileData = Zlib.deflateSync(fileData);
        await this.sendFile(fileData, requestID, fileID);
    }.bind(this);

    this.sendFile = async function(fileData, requestID, fileID) {
        var Log = new LogLib.Log("Client.js", "sendFile");
        Log.v("====RUNNING NEW SENDFILE FUNCTION");
        var chunkSize = 1024 * 1024; //I assumed this is what it is, as that's what it appears to be in the official AM server code
        var requestIndex = 0;
        var sliceStart = 0;
        //Get file length in bytes
        // var stats = await ConversionDatabase.promiseStats(localFilePath); //TODO: Don't use sync, as it blocks the process!
        //TODO: FIIIIIIX THIS AND USE ASYNC INSTEAD!!!
        // var fileLength = stats.size; //File size in bytes
        var fileLength = fileData.length;

        //TODO: Is it possible to do this in chunks?
        // var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function


        var isLast = false;
        while (!isLast) {
            Log.v("Preparing to send file chunk");
            isLast = isLast || ((sliceStart + chunkSize) >= (fileLength - 1));
            Log.i("Will read to "+(sliceStart + chunkSize)+" vs "+(fileLength - 1));
            Log.i("Is last? "+isLast);
            //If we're reading right up to the last byte, we have the last

            //0123456789 01
            //Run sendFileChunk() as many times as it takes.
            //  Pack int: nhtAttachmentReq
            //  Pack short: requestID
            //  Pack short: requestIndex (Is this the chunk index or starting position?) (i.e. chunk #1, #2, #3 OR position 100, 200, or 300?)
                //Given that it's a short and shorts have a limit of 65000 or so, there can be larger files than 65000 bytes so I assume it's chunk #1, #2, #3, etc
                //Update: yeah it increments by one
            //  If the requestIndex is 0
            //      Pack long: File length (in bytes I assume)
            //  Pack boolean: isLast (if this is the last chunk)
            //  Pack string: File GUID (could this be the path instead?)
            //  Pack payload: Bytes of the file, sliced into whatever chunk we want

            var fileChunkResponsePacker = new AirPacker();
            //Use chunkSize
            fileChunkResponsePacker.packInt(CommConst.nhtAttachmentReq); //nhtAttachmentReq
            //TODO: Make a CommConst file?
            fileChunkResponsePacker.packShort(requestID);
            Log.i("Packing request index: "+requestIndex);
            fileChunkResponsePacker.packInt(requestIndex);
            if (requestIndex == 0) {
                fileChunkResponsePacker.packLong(fileLength); //In bytes I think
            }
            Log.v("Packing boolean (is last): "+isLast);
            fileChunkResponsePacker.packBoolean(isLast);
            fileChunkResponsePacker.packString(fileID); //Should be a GUID but whatever
            //TODO: Check if the file guid is right
            //TODO: Investigate this ^^^^^
            // var sliceEnd = Math.min(sliceStart + chunkSize, fileLength - 1)
            var sliceEnd = Math.min(sliceStart + chunkSize, fileLength)
            Log.i("Slicing from "+sliceStart+" to "+sliceEnd);
            var chunkData = fileData.slice(sliceStart, sliceEnd);
            // chunkData = Zlib.deflateSync(chunkData); //TODO: FIX THIS! IS IT DEFLATESYNC OR DEFLATERAWSYNC?
            // chunkData = Zlib.deflateRawSync(chunkData);
            // console.log(chunkData);
            fileChunkResponsePacker.packPayload(chunkData);

            // ConversionDatabase.printUint8Array(fileChunkResponsePacker.getBuffer());
            var encrypted = await fileChunkResponsePacker.encryptAndWriteHeader();

            globalThis.connection.write(encrypted);
            Log.v("File chunk sent");

            sliceStart += chunkSize;

            requestIndex++;
        }
        return true;
    }.bind(this);

    this.sendMassRetrievalFileFromFileID = async function(requestID, fileID) {
        await SMServerAPI.ensureAttachmentFoldersExist();
        var Log = new LogLib.Log("Client.js", "sendFileFromID");
        Log.v("File ID: "+fileID);
        var readFilePromise = function(file) {
            return new Promise(function(ok, notOk) {
                fs.readFile(file, function(err, data) {
                    if (err) {
                        notOk(err)
                    } else {
                        ok(data)
                    }
                })
            })
        };

        var localFilePath = await SMServerAPI.downloadAttachmentIfNecessary({"filename":fileID});
        Log.v("Local path: "+localFilePath);
        var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function
        Log.v("File data length: "+fileData.length);
        fileData = Zlib.deflateSync(fileData);
        await this.sendMassRetrievalFileData(fileData, requestID, fileID);
    }.bind(this);
    //TODO: Set timeout for incoming transmissions (i.e. when we have part of a message but not all of it)

    this.sendMassRetrievalFileData = async function(fileData, requestID, fileID) { //TODO: Make this less copy/pastey
        var Log = new LogLib.Log("Client.js", "sendFile");
        Log.v("====RUNNING NEW SENDFILE FUNCTION");
        var chunkSize = 1024 * 1024; //I assumed this is what it is, as that's what it appears to be in the official AM server code
        //Maybe check this
        var requestIndex = 0;
        var sliceStart = 0;
        //Get file length in bytes
        // var stats = await ConversionDatabase.promiseStats(localFilePath); //TODO: Don't use sync, as it blocks the process!
        //TODO: FIIIIIIX THIS AND USE ASYNC INSTEAD!!!
        // var fileLength = stats.size; //File size in bytes
        var fileLength = fileData.length;

        //TODO: Is it possible to do this in chunks?
        // var fileData = await readFilePromise(localFilePath); //Synchronous is OK because it's in an async function


        var isLast = false;
        while (!isLast) {
            Log.v("Preparing to send file chunk");
            isLast = isLast || ((sliceStart + chunkSize) >= (fileLength - 1));
            Log.i("Will read to "+(sliceStart + chunkSize)+" vs "+(fileLength - 1));
            Log.i("Is last? "+isLast);
            //If we're reading right up to the last byte, we have the last

            //0123456789 01
            //Run sendFileChunk() as many times as it takes.
            //  Pack int: nhtAttachmentReq
            //  Pack short: requestID
            //  Pack short: requestIndex (Is this the chunk index or starting position?) (i.e. chunk #1, #2, #3 OR position 100, 200, or 300?)
                //Given that it's a short and shorts have a limit of 65000 or so, there can be larger files than 65000 bytes so I assume it's chunk #1, #2, #3, etc
                //Update: yeah it increments by one
            //  If the requestIndex is 0
            //      Pack long: File length (in bytes I assume)
            //  Pack boolean: isLast (if this is the last chunk)
            //  Pack string: File GUID (could this be the path instead?)
            //  Pack payload: Bytes of the file, sliced into whatever chunk we want

            var fileChunkResponsePacker = new AirPacker();
            //Use chunkSize
            fileChunkResponsePacker.packInt(CommConst.nhtMassRetrievalFile); //nhtAttachmentReq
            //TODO: Make a CommConst file?
            fileChunkResponsePacker.packShort(requestID);
            Log.i("Packing request index: "+requestIndex);
            fileChunkResponsePacker.packInt(requestIndex);
            if (requestIndex == 0) {
                // fileChunkResponsePacker.packLong(fileLength); //In bytes I think
                fileChunkResponsePacker.packString(fileID.match(/\/([^\/]+)$/)[1]);
            }
            //TODO: If you wait to download messages in settings, the main screen might end up empty if you don't look at it before the transfer is complete. Is this a bug to be reported?
            Log.v("Packing boolean (is last): "+isLast);
            fileChunkResponsePacker.packBoolean(isLast);
            fileChunkResponsePacker.packString(fileID); //Should be a GUID but whatever
            //TODO: Check if the file guid is right
            //TODO: Investigate this ^^^^^
            // var sliceEnd = Math.min(sliceStart + chunkSize, fileLength - 1)
            var sliceEnd = Math.min(sliceStart + chunkSize, fileLength)
            Log.i("Slicing from "+sliceStart+" to "+sliceEnd);
            var chunkData = fileData.slice(sliceStart, sliceEnd);
            // chunkData = Zlib.deflateSync(chunkData); //TODO: FIX THIS! IS IT DEFLATESYNC OR DEFLATERAWSYNC?
            // chunkData = Zlib.deflateRawSync(chunkData);
            // console.log(chunkData);
            fileChunkResponsePacker.packPayload(chunkData);

            // ConversionDatabase.printUint8Array(fileChunkResponsePacker.getBuffer());
            var encrypted = await fileChunkResponsePacker.encryptAndWriteHeader();

            globalThis.connection.write(encrypted);
            Log.v("File chunk sent");

            sliceStart += chunkSize;

            requestIndex++;
        }
        return true;
    }.bind(this);

    var processSlashCommand = async function(message_data) {
        var Log = new LogLib.Log("Client.js", "processSlashCommand");
        /*
        message_data is in this format:
        {
            "requestID": 123,
            "chatID": "name@example.com",
            "message": "Message text wahoo!",
        }

        */

        //NEXT STEPS: TODO: Add a settings library that manages the settings text file (i.e. for encryption/etc)

        var commandFailed = false; //TODO: AirBridge notifications show up in the wrong order?
        if (message_data.message.startsWith("/tapback")) { //TODO: Wrap this in a try/catch
            //TODO: Add support for images/most recent image? How to target images? Re-sending the attachment doesn't sound very useful
            var messageElements = message_data.message.match(/\/tapback ([^ ]+) (.+)/);
            console.log(messageElements);
            var tapbackType = messageElements[1];
            Log.v("Tapback type (as received from client): "+tapbackType);
            var tapbackCode = 0;
            //TODO: Add support for raw codes (i.e. /tapback 2 Message or whatever)
            //set tapbackType
            //Match the tapbackType with a regex to get a tapback code (0, 1, 2, 3...5). If that doesn't work, yell at the client that the message is wrong.
            //   /💖|💞|💔|🖤|💚|💓|💘|💙|💜|🤍|💗|🤎|💕|💛|💟|💝|🧡|❤️|lov|hea/
            if (/💖|💞|💔|🖤|💚|💓|💘|💙|💜|🤍|💗|🤎|💕|💛|💟|💝|🧡|❤️|lov|hea/.test(tapbackType)) {
                tapbackCode = 0; //heart
            }
            //   /👎|👎🏻|👎🏼|👎🏾|👎🏽|👎🏿|down|dislik/
            else if (/👎|👎🏻|👎🏼|👎🏾|👎🏽|👎🏿|down|dislik/.test(tapbackType)) {
                tapbackCode = 2; //Thumbs down is two (this comes before as "lik" will also match for "dislik", so "dislik" is matched first)
            }
            //   /👍|👍🏽|👍🏿|👍🏻|👍🏾|👍🏼|up|lik/
            else if ( /👍|👍🏽|👍🏿|👍🏻|👍🏾|👍🏼|up|lik/.test(tapbackType)) {
                tapbackCode = 1;
            }
            //   /🤣|😂|😹|😆|lau|ha|lol/
            else if (/🤣|😂|😹|😆|lau|ha|lol/.test(tapbackType)) {
                tapbackCode = 3;
            }
            //   /‼️|❗|❕|⁉️|!|emph|excl/
            else if (/\‼️|❗|❕|\!|emph|excl/.test(tapbackType)) {
                tapbackCode = 4;
            }
            //   /❓|❔|?|ques|what/
            else if (/❓|❔|\?|ques|what/.test(tapbackType)) {
                tapbackCode = 5;
            } else {
                commandFailed = true;
                sendInfoMessageToClient(`Sorry, the tapback type (${tapbackType}) was not recognized.
Make sure your tapback type doesn't have a space in it, and format the command like this:
/tapback heart Message text here
Examples of valid tapback types:

Heart: 💖, 💕, heart, love, loved
Thumbs up: 👍, thumbs_up, like, liked
Thumbs down: 👎, thumbs_down, dislike, disliked
Laugh: 🤣, 😂, 😆, laughed, laughed_at, haha, lol
Emphasis: ‼️, ❗, ❕, !, emphasis, emphasized, exclamation
Question: ❓, ❔, ?, question_mark, question, what`);
            }

            //NEXT STEPS TODO: Periodically check in with the SMServer (given the last seen message time) to make sure we didn't miss anything (i.e. if the websocket goes down)

            //TODO: Add contact syncing?

            Log.v("Parsed tapback code as "+tapbackCode);
            //TODO: Handle errors

            var result = SMServerAPI.sendTapbackGivenMessageText(messageElements[2].trim(), message_data.chatID, tapbackCode);
            if (result == false) {
                commandFailed = true;
                sendInfoMessageToClient("Couldn't find a message ("+messageElements[2]+") to send a tapback to");
            }

            //TODO: Maybe add

            //TODO: Match "thumbs up" if it's two words?
            //Otherwise remove the tapback? What are the codes for removal?
            //TODO: Send info message to client if they got it wrong (with tips on how to format reactions)


        }


        //TODO: Maybe roll this into its own function?
        Log.v("Writing response");
        var resPacker = new AirPacker();
        //Pack an int (header) Nht value: nhtSendResult
        Log.v("Packing int (message type): nhtSendResult: "+CommConst.nhtSendResult);
        resPacker.writeInt(400); //nhtSendResult
        //Pack a short (request ID)
        Log.v("Packing short (request ID): "+message_data.requestID);
        resPacker.writeShort(message_data.requestID);

        //Pack an int (result code) //result.item1
        //      nstSendResultOK or nstSendResultScriptError
        if (commandFailed) {
            Log.v("Packing int (error code): "+CommConst.nstSendResultScriptError);
            resPacker.writeInt(CommConst.nstSendResultScriptError);
            Log.v("Packing nullable string (error description): null");
            resPacker.writeNullableString("Slash command failed. See AirBridge notification for details.");
        } else {
            Log.v("Packing int (error code): 0");
            resPacker.writeInt(0); //Result code: success!
            Log.v("Packing nullable string (error description): null");
            resPacker.writeNullableString(null);
        }

        //Pack a nullable string (details) WHAT IS THIS result.item2
        //      This is hardcoded as null if nstSendResultOK, otherwise an error description

        var encrypted = await resPacker.encryptAndWriteHeader();
        //TODO: Make all writeInt(), writeString(), etc into packInt(), packString(), etc

        Log.i("Packing response, sending to client");
        globalThis.connection.write(encrypted);
        //NEXT STEPS TODO: Send read receipt updates??

        //TODO: Tutorial on how to set up picture sharing? (i.e. sync contacts from Google and update picture on iCloud)
        if (!commandFailed) {
            // setTimeout(async () => {
                // Log.i("Sending informational message to client: "+message_data.text);
                var responsePacker = new AirPacker();
                //TODO: Maybe store these? Does it matter?
                Log.v("Packing synthesized message from AirBridge");
                responsePacker.packAllMessagesFromSMServer([{
                    subject: '',
                    is_from_me: true,
                    text: message_data.message,
                    cache_has_attachments: false,
                    associated_message_type: 0,
                    date_read: 0,
                    service: 'iMessage',
                    associated_message_guid: '',
                    id: '',
                    item_type: 0,
                    group_action_type: 0,
                    date: ConversionDatabase.convertUnixTimestampToAppleDate(Date.now()),
                    // guid: '74BD893A-E4EA-4AF0-9701-94C6E5427F27',
                    guid: uuidv4(),
                    conversation_id: message_data.chatID,
                    ROWID: 13, //TODO: FIGURE OUT THE ROWID OF THIS SIMULATED MESSAGE
                    balloon_bundle_id: '',
                    tapbacks: []
                }]);
                Log.v("Encrypting message");
                var encrypted = await responsePacker.encryptAndWriteHeader();
                Log.v("Sending message");
                globalThis.connection.write(encrypted);
            // }, 100);
        }
    }.bind(this);

    //NEXT STEPS: TODO: Send text along with attachment messages (make sure this works)

    var processNhtSendTextExisting = async function(unpacker) {
        var Log = new LogLib.Log("Client.js","processNhtSendTextExisting");
        Log.i("Processing nhtSendTextExisting");
        var start_time = Date.now();
        //TODO: Does this end up sending duplicates?
        var requestID = unpacker.readShort();
        Log.v("Request ID: "+requestID);
        var chatID = unpacker.readVariableLengthUTF8String();
        Log.v("Chat ID: "+chatID);
        var message = unpacker.readVariableLengthUTF8String();
        Log.v("Message: "+message);
        //ASK: What about the subject line? Can you send a message with it?
        Log.v("Sending text message via SMServerAPI");
        //TODO: Handle /tapback messages here
        if (message.startsWith("/")) { //TODO: Add a user command to enable slash commands
            processSlashCommand({requestID: requestID, chatID: chatID, message: message});
            return;
        }

        await SMServerAPI.sendTextMessage(message, chatID); //TODO: Handle errors from this
        Log.v("Sent");

        //Send response: nhtSendResult
        //If the client isn't connected, don't do anything.
        Log.v("Writing response");
        var resPacker = new AirPacker();
        //Pack an int (header) Nht value: nhtSendResult
        Log.v("Packing int (message type): nhtSendResult: "+CommConst.nhtSendResult);
        resPacker.writeInt(400); //nhtSendResult
        //Pack a short (request ID)
        Log.v("Packing short (request ID): "+requestID);
        resPacker.writeShort(requestID);

        //Pack an int (result code) //result.item1
        //      nstSendResultOK or nstSendResultScriptError
        Log.v("Packing int (error code): 0");
        resPacker.writeInt(0); //Result code: success!

        //Pack a nullable string (details) WHAT IS THIS result.item2
        //      This is hardcoded as null if nstSendResultOK, otherwise an error description
        Log.v("Packing nullable string (error description): null");
        resPacker.writeNullableString(null);

        var encrypted = await resPacker.encryptAndWriteHeader();
        //TODO: Make all writeInt(), writeString(), etc into packInt(), packString(), etc

        Log.i("Packing response, sending to client");
        globalThis.connection.write(encrypted);

        // Log.v("Waiting 400ms to send last messages from conversation to client");

        //TODO: Do we not need this anymore if we are using websockets?

        // setTimeout(function() {
        //     // updateClientWithRecentMessages();
        //     Log.v("Sending last message from conversation to client");
        //     sendLastMessageFromConversationToClient(chatID, start_time);
        //     //This happens once SMServer sends the message
        // }, 400); //TODO: Run this once the message is sent instead of blindly waiting (keep checking the last message every so often)

        //TODO: Run the above code once the send request returns 200? Otherwise return something else

    }.bind(this);
    //TODO: On websocket new message, store the client last seen date to prevent double messages
    //TODO: Implement ROWID-based checks!!!!


    //NEXT STEPS: Implement #tapback messages

    var processNhtSendFileExisting = async function(unpacker) {
        //TODO: Figure out if the entire file is being transmitted correctly (looks like it isn't)
        await SMServerAPI.ensureAttachmentFoldersExist();
        //TODO: Large video files send accurately, but don't get returned.
        Log.i("Got nhtSendFileExisting");
        var requestID = unpacker.unpackShort();
        Log.v("Request ID: "+requestID);
        var requestIndex = unpacker.unpackInt();
        Log.v("Request index: "+requestIndex);
        var isLast = unpacker.unpackBoolean(); //Is this the last chunk?
        Log.v("Is this the last chunk: "+isLast);
        var chatID = unpacker.unpackString();
        Log.v("Chat ID: "+chatID);

        var compressedBytes = unpacker.unpackPayload(); //TODO: Implement this in AirUnpacker

        Log.v("Got "+compressedBytes.length+" bytes of payload");

        var filename = null;
        if (requestIndex == 0) {
            filename = unpacker.unpackString();
            Log.v("Got filename: "+filename);
            globalThis.filenameToSend = filename;
            globalThis.fileToSend = new ByteBuffer();
        }


        globalThis.fileToSend.append(compressedBytes.length);
        globalThis.fileToSend.write(compressedBytes);
        //TODO: Is nhtSendFileNew implemented?
        //TODO: Maybe give this a unique identifier instead of relying on the filename??

        if (isLast) {
            Log.v("Got the last attachment piece. Decompressing file...");
            var compressedDataInFull = globalThis.fileToSend.buffer; //This is an ArrayBuffer
            //Maybe save to a file?
            var uncompressedData = Zlib.inflateSync(compressedDataInFull);
            // Zlib.Inflate(compressedDataInFull, (err, uncompressedData) => {
                //TODO: What about sending large attachments (upwards of ~75MB?)
            Log.v("Decompressed file (length is "+uncompressedData.length+")");
            // fs.writeFileSync("./sentimg.jpg", uncompressedData);
            Log.v("File name is "+globalThis.filenameToSend);
            SMServerAPI.sendFile(globalThis.filenameToSend, uncompressedData, chatID);


            Log.v("Writing response");
            var resPacker = new AirPacker();
            //Pack an int (header) Nht value: nhtSendResult
            Log.v("Packing int (message type): nhtSendResult: "+CommConst.nhtSendResult);
            resPacker.writeInt(400); //nhtSendResult
            //Pack a short (request ID)
            Log.v("Packing short (request ID): "+requestID);
            resPacker.writeShort(requestID);

            //Pack an int (result code) //result.item1
            //      nstSendResultOK or nstSendResultScriptError
            Log.v("Packing int (error code): 0");
            resPacker.writeInt(0); //Result code: success!

            //Pack a nullable string (details) WHAT IS THIS result.item2
            //      This is hardcoded as null if nstSendResultOK, otherwise an error description
            Log.v("Packing nullable string (error description): null");
            resPacker.writeNullableString(null);

            var encrypted = await resPacker.encryptAndWriteHeader();
            //TODO: Make all writeInt(), writeString(), etc into packInt(), packString(), etc

            Log.i("Packing response, sending to client");
            globalThis.connection.write(encrypted);
            // });
        }

        //TODO: Apparently the client wants display names all the time, even for personal chats


        //TODO: Add this to a global bytebuffer or something. Deflate compress it when we got isLast

        // Log.v("Filename: "+globalThis.filename);

        //Send to addFileFragment
    }.bind(this);

    //TODO: lite message retrieval test with Electron client!!

    //TODO: handleMessageIDRetrieval

    //TODO: If messages change, is it pushed to the client or does client have to request it???


    //Todo: Send a "nah bro your password is crap" message

    //NEXT STEPS: Implement ID-based checks using getMessagesForOneConversationWhileConditionIsTrue

    //The following code runs as soon as the connection is initiated
    if (this.authenticated == false) {
        //If we're not authenticated when the connection starts, setup and send the transmission check
        this.connection.write(this.setupTransmissionCheck().getBuffer());

        //Set interval to auto-query SMServerAPI for changes (every 5s or so)
        //TODO: A getAllMessagesFromSpecifiedTimeInterval function with smaller chunk size? Or does the conversation search already take care of it?
        globalThis.messageRefreshInterval = setInterval(async function() {
            //This is used as an insurance policy. If a message is missed from the websocket, it will be caught in this interval.
            //Sometimes the websocket disconnects, and messages can get missed in that window. This interval makes sure the client has seen every message.
            var Log = new LogLib.Log("Client.js", "messageRefreshInterval");
            Log.i("Checking for new messages after "+globalThis.clientLastSeenTime);
            //Check if there are any new messages after globalThis.clientLastSeenTime
            var messages = await SMServerAPI.getAllMessagesFromSpecifiedTimeInterval(globalThis.clientLastSeenTime + 1, 999999999999999999); //The +1 is so we don't get double messages
            messages = await SMServerAPI.stackTapbacks(messages);
            if (messages.length > 0) {
                Log.i("Message was found that client hasn't seen and wasn't caught by websocket, sending message to client");
                Log.v("Client last seen time is now "+messages[0].unixdate);
                globalThis.clientLastSeenTime = messages[0].unixdate;
                var responsePacker = new AirPacker();
                await responsePacker.packAllMessagesFromSMServer(messages);
                var encrypted = await responsePacker.encryptAndWriteHeader();
                Log.i("Encrypted, sending message to client");
                globalThis.connection.write(encrypted);
            }

            // var Log = new LogLib.Log("Client.js", "handleWebsocketMessage");
            // Log.i("Handling message from websocket");
            // //TODO: HANDLE ORPHANED TAPBACKS!!!
            // var stacked = SMServerAPI.stackTapbacks(messages, handleOrphanedTapbacks);
            // if (stacked.length == 0) {
            //     return; //Must have been an orphaned tapback, as those are handled separately
            // }
            //
            // Log.v("Setting last-seen message time to "+ConversionDatabase.convertAppleDateToUnixTimestamp(messages[0]));
            // globalThis.clientLastSeenTime = ConversionDatabase.convertAppleDateToUnixTimestamp(messages[0]);
            //
            // var responsePacker = new AirPacker();
            // await responsePacker.packAllMessagesFromSMServer(messages);
            // var encrypted = await responsePacker.encryptAndWriteHeader();
            // Log.i("Encrypted, sending message to client...");
            // globalThis.connection.write(encrypted);
            //If there are, create a packer and packAllMessagesFromSMServer
            //Reset the clientLastSeenTime to Date.now()
            //ORPHANED TAPBACKS TOO
        }.bind(this), MESSAGE_QUERY_INTERVAL);

    }

}

module.exports = Client;
