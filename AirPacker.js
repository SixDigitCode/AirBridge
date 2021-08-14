const ByteBuffer = require('byte-buffer');
const EncryptionLib = require('./encryption_test.js');
const ConversionDatabase = require('./conversionDatabase.js');
const SMServerAPI = require("./SMServerAPI.js");
const CommConst = require('./CommConst.js');
const LogLib = require('./Log.js');
const crypto = require('crypto');
const fs = require('fs');

//TODO: Maybe convert this to use Uint8Array, because byte-buffer isn't installing on iOS

function AirPacker(initial_buffer) { //Maybe later add bytes to pass into beginning?
    if (initial_buffer) {
        // this.bytebuffer = new ByteBuffer(Buffer.from(initial_buffer));
        //TODO: This creates insanely long buffers (8000+ bytes) and I HAVE NO IDEA WHY
        this.bytebuffer = new ByteBuffer();
        this.bytebuffer.append(initial_buffer.length);
        this.bytebuffer.write(initial_buffer);
    } else {
        this.bytebuffer = new ByteBuffer();
    }



    this.writeInt = function(int_to_write) {
        this.bytebuffer.append(4); //4-byte int
        this.bytebuffer.writeUnsignedInt(int_to_write); //I think it's supposed to be unsigned?
    }

    this.packInt = this.writeInt;

    this.writeShort = function(short_to_write) {
        this.bytebuffer.append(2); //2-byte short
        this.bytebuffer.writeShort(short_to_write); //SHOULD THIS BE SIGNED??
    }

    this.packShort = this.writeShort;

    this.writeLong = function(long_to_write) { //THE FOLLOWING IS UNTESTED
        // let b = new ArrayBuffer(8); //64bit Long ints are 8 bytes long
        // new DataView(b).setUint32(0, num);
        // return Array.from(new Uint8Array(b));
        // var b = new Buffer(8);
        var b = Buffer.alloc(8);
        b.writeBigUInt64BE(BigInt(long_to_write), 0);
        this.bytebuffer.append(8);
        this.bytebuffer.write(b);
    }

    this.packLong = this.writeLong;

    this.writeArrayHeader = function(array_length) {
        this.writeInt(array_length);
    }

    this.packArrayHeader = this.writeArrayHeader;

    this.writeBoolean = function(bool_to_write) {
        this.bytebuffer.append(1);
        this.bytebuffer.writeByte(bool_to_write ? 1 : 0);
    }

    this.packBoolean = this.writeBoolean;

    this.writeVariableLengthBuffer = function(buffer_to_write) {
        this.writeInt(buffer_to_write.length);
        this.bytebuffer.append(buffer_to_write.length);
        this.bytebuffer.write(buffer_to_write);
    }

    this.packVariableLengthBuffer = this.writeVariableLengthBuffer;

    this.writeString = function(string_to_write) {
        var tmpbuf = Buffer.from(string_to_write, 'utf8');
        this.writeInt(tmpbuf.length);
        this.bytebuffer.append(tmpbuf.length);
        this.bytebuffer.write(tmpbuf);
    }

    this.packString = this.writeString;

    this.writeNullableString = function(string_to_write) {
        if (string_to_write == null || string_to_write == "") {
            this.writeBoolean(false);
        } else {
            this.writeBoolean(true);
            this.writeString(string_to_write);
        }
    }
    this.packNullableString = this.writeNullableString;

    this.write = function(buffer_to_write) {
        this.bytebuffer.append(buffer_to_write.length);
        this.bytebuffer.write(buffer_to_write);
    }

    this.pack = this.write;

    this.writePayload = function(payload_to_write) {
        this.writeInt(payload_to_write.length);
        this.write(payload_to_write);
    };

    this.packPayload = this.writePayload;

    this.writeNullablePayload = function(buffer_to_write) {
        if (buffer_to_write == null) {
            this.packBoolean(false);
        } else {
            this.packBoolean(true);
            this.writePayload(buffer_to_write);
        }
    }

    this.packNullablePayload = this.writeNullablePayload;

    this.getBuffer = function() {
        //return this.bytebuffer.buffer;
        return this.bytebuffer.raw;
    }

    this.writeHeader = function(encrypted) {
        //This assumes the rest of the data has already been encrypted if necessary
        var bytebufferLength = this.bytebuffer.length;

        this.bytebuffer.prepend(5); //Prepends 5 bytes
        this.bytebuffer.index = 0; //Sets the read point to the beginning
        this.bytebuffer.writeUnsignedInt(bytebufferLength);
        this.bytebuffer.writeByte(encrypted ? 1 : 0);
    }

    this.packHeader = this.writeHeader;

    this.encryptAndWriteHeader = function() {
        // console.log(JSON.stringify(this.bytebuffer.raw));
        // console.log("Encrypting the following data and writing header:");
        // ConversionDatabase.printUint8Array(this.bytebuffer.raw);
        return new Promise((resCb, rejCb) => {
            EncryptionLib.encrypt(Buffer.from(this.bytebuffer.raw)).then((data) => {
                var salt = data[0];
                var iv = data[1];
                var encrypted = data[2];

                var tmppacker = new AirPacker();

                tmppacker.write(salt);
                tmppacker.write(iv);
                tmppacker.write(encrypted);

                tmppacker.writeHeader(true);

                resCb(tmppacker.getBuffer());
            });
        });
    }

    this.packMessageUpdateHeader = function(num_messages) {
        //packInt (header = nhtMessageUpdate = 200)
        this.packInt(CommConst.nhtMessageUpdate); //The message type is nhtMessageUpdate
        // console.log("Message type: 200 (nhtMessageUpdate)");
        //packArrayHeader (length of the list of messages)
        this.packArrayHeader(num_messages); //Number of items in the list to return
        // console.log("Number of messages: "+num_messages);
        //Write the data for each object
        //Send the message
    }

    this.packConversationItem = function(itemType, serverID, guid, chatGuid, date) {
        //Item type is 0 for a message, 1 for a group action, and 2 for a chat renaming
        this.packInt(itemType);

        this.packLong(serverID);
        this.packString(guid);
        this.packString(chatGuid);
    }

    this.packAllMessagesFromSMServer = async function(messages) {
        // console.log("packing "+messages.length+" messages");

        // console.log("Packing messages");
        // console.log(messages);



        // var numMessages = 0;
        // for (var i = 0; i < messages.length; i++) { //This counts the messages. This is necessary since some messages returned by SMServer are tapbacks and aren't counted in the same way
        //     let message = messages[i];
        //     let isEmpty = (message.text == "" && message.subject == "") || message.attachments; //Is only empty if attachments don't exist
        //     isEmpty = false;
        //     let isTapback = message.associated_message_guid !== "";
        //     let isRichLink = message.balloon_bundle_id == "com.apple.messages.URLBalloonProvider";
        //     //It looks like rich links still have text as the link, so we process them as usual (there's some extra data but we can ignore that)
        //     let isDigitalTouch = message.balloon_bundle_id == "com.apple.messages.DigitalTouchBalloonProvider";
        //     if (!isEmpty && !isTapback && !isDigitalTouch) {
        //         numMessages++;
        //     }
        // }

        var numMessages = messages.length; //The messages are assumed to be tapback-stacked
        //TODO: What about messages that are empty?

        // console.log("Number of messages: "+numMessages);
        this.packMessageUpdateHeader(numMessages);


        for (var i = 0; i < messages.length; i++) {
            // let message = messages[i];
            // // console.log(message.text);
            // let isEmpty = (message.text == "" && message.subject == "") && message.attachments; //Is only empty if attachments don't exist
            // isEmpty = false;
            // let isTapback = message.associated_message_guid !== "";
            // let isRichLink = message.balloon_bundle_id == "com.apple.messages.URLBalloonProvider";
            // //It looks like rich links still have text as the link, so we process them as usual (there's some extra data but we can ignore that)
            // let isDigitalTouch = message.balloon_bundle_id == "com.apple.messages.DigitalTouchBalloonProvider";


            // if (!isEmpty && !isTapback && !isDigitalTouch) {
                // console.log("Actually packing data");
                await this.packMessageDataFromSMServer(messages[i]);
            // }

        }
    }


    //TODO: Write methods that take in data from the SMServer and spit out AM-compatible data
    this.packMessageDataFromSMServer = async function(message) { //THE FOLLOWING IS UNTESTED
        let Log = new LogLib.Log("AirPacker.js","packMessageDataFromSMServer", 1);
        Log.p("Packing one message from SMServer");
        //ConversationID will be converted to GUID later
        //TODO: Find out how to get all tapbacks for a message. Maybe get all messages after it and check which ones match?
        //TODO: GUIDs vs UUIDs can have conversion issues. If there are problems, CHECK THIS!!
        //TODO: Add a "Hey, X person sent a digital touch message but it can't be viewed from AirBridge"
        //TODO: Add logging here
        // console.log("Packing "+message.text);

        // message = {
        //     subject: '',
        //     is_from_me: true,
        //     text: 'Sample group',
        //     cache_has_attachments: false,
        //     associated_message_type: 0,
        //     date_read: 0,
        //     service: 'iMessage',
        //     associated_message_guid: '',
        //     id: '',
        //     item_type: 0,
        //     group_action_type: 0,
        //     date: 645656436981000000,
        //     guid: '74BD893A-E4EA-4AF0-9701-94C6E5427F27',
        //     conversation_id: 'chat16846957693768777',
        //     ROWID: 13,
        //     balloon_bundle_id: '',
        //     tapbacks: []
        // };

        /*
        Message sent to me:
        {
            group_action_type: 0,
            balloon_bundle_id: '',
            date_read: 645402658616994000,
            associated_message_guid: '',
            item_type: 0,
            cache_has_attachments: false,
            associated_message_type: 0,
            text: 'Test test',
            id: 'name@example.com',
            guid: '1C2D60C6-379D-4EEB-9B0F-B1C75BC6ABDF',
            service: 'iMessage',
            is_from_me: false,
            subject: '',
            ROWID: 2,
            date: 645402655814933000
        }


        {
            guid: 'B3A3116C-407D-4A11-9105-DFCF9D1B9AEE',
            group_action_type: 0,
            balloon_bundle_id: '',
            text: 'Comment here!!',
            service: 'iMessage',
            associated_message_guid: '',
            item_type: 0,
            cache_has_attachments: true,
            date_read: 0,
            is_from_me: true,
            date: 645658188233000100,
            id: 'name@example.com',
            ROWID: 21,
            subject: '',
            associated_message_type: 0,
            attachments: [
            {
              filename: 'Attachments/fc/12/F74A4A4B-5BF8-49BA-86B1-81FAAF71294C/tmp.gif',
              mime_type: 'image/gif'
            }
            ]
        }

        */
        Log.p("Packing int (item type): 0 (message)");
        this.packInt(0); //itemType is a message, so it's 0
        // console.log("itemType: 0");
        //              Long: Server ID (MAYBE, SEEMS STRANGE TO SEND THE SERVER ID SO MANY TIMES)
        Log.p("Packing int (Server ID/ROWID): "+message.ROWID);
        this.packLong(message.ROWID); //CHANGE: Server ID: WHAT IS THIS
        // console.log("Server ID: "+message.ROWID);
        //This is the number of the message, ascending order chronologically.
        //TODO: Figure out how to create a database of message IDs to server IDs. Maybe get all the messages from the conversation and create a message GUID-to-server-ID table?
        //  This could also be a ROWID!!
        //Does this need to be unique across conversations?
        //              String: GUID of message (I THINK)
        Log.p("Packing string (message GUID): "+message.guid.toUpperCase());
        this.packString(message.guid.toUpperCase());
        // console.log("Message GUID: "+message.guid.toLowerCase());
        //              String: GUID of conversation (PRETTY SURE)
        Log.p("Packing string (conversation ID): "+message.conversation_id);
        this.packString(message.conversation_id);
        // console.log("packed convo id");

        // console.log("Conversation ID: "+message.conversation_id);
        //TODO: Change this to the regular chat ID, as it doesn't have to be in GUID format
        //On a Mac, each conversation has a GUID. On SMServer, each conversation has an ID but it isn't in
        //GUID format. Therefore, ConversionDatabase keeps track of which SMServer IDs match with which GUIDs,
        //and it (randomly) generates missing GUIDs as needed.
        //Update: Apparently AirMessage doesn't care if it's a GUID or not--it just has to be a unique string

        //Maybe we keep a conversion table for Conversation IDs --> generated GUIDs? (i.e. create GUIDs if they're not known)
        //              Long: Date of message (I THINK IN UNIX TIME)
        var timestamp = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date);
        //AirMessage expects the timestamp in milliseconds (I think)
        Log.p("Packing long (message timestamp): "+timestamp);
        this.packLong(timestamp);
        // console.log("Unix timestamp: "+timestamp+" ("+new Date(timestamp * 1000)+")")
        //          THE FOLLOWING ASSUMES A MESSAGE INFO (SUBCLASS OF CONVERSATIONITEM)
        //              Writes the information in writeObject for superclass ConversationItem() (i.e. it adds the above data under "THE FOLLOWING ASSUMES A CONVERSATION ITEM" to the beginning)
        //              Nullable string: Message text

        Log.p("Packing nullable string (message text): "+message.text);
        this.writeNullableString(message.text);
        // console.log("Text: "+message.text);
        //              Nullable string: Subject line text
        // console.log("text written.");
        // console.log(this.getBuffer());
        Log.p("Packing nullable string (message subject): "+message.subject);
        this.writeNullableString(message.subject);
        // console.log("Subject: "+message.subject);
        //              Nullable string: Sender (NOT SURE WHAT FORMAT THIS IS IN--IS IT A PHONE NUMBER OR EMAIL OR ID OR WHATEVER)
        //              Does it even matter? Not sure if the client does any parsing or just displays it
        // console.log("packing sender");
        // console.log("\nHERE IS THE DATA SO FAR");
        // ConversionDatabase.printUint8Array(this.getBuffer());
        if (message.is_from_me) {
            Log.p("Packing nullable string (sender): "+null);
            this.writeNullableString(null);
            // console.log("Sender: Me");
        } else {

            Log.p("Packing nullable string (sender): "+message.id);
            this.writeNullableString(message.id); //Sender. WHAT FORMAT SHOULD THIS BE IN??? Any format is ok, just be consistent
            // console.log("Sender: "+message.id);
        }
        //WHAT ABOUT MESSAGES SENT FROM ME AS THOSE HAVE NO SENDER LISTED
        //              Array header (just an int): Length of the list of attachments
        // this.writeArrayHeader(0); //0 attachments for now. FIX THIS BEFORE RELEASE
        // console.log("Number of attachments: 0 (hardwired for now)");
        var attachments = message.attachments || [];

        attachments = this.filterAttachments(attachments);
        // var attachments = [];
        // attachments = [];
        // attachments = [{
        //     filename: 'Attachments/fc/12/F74A4A4B-5BF8-49BA-86B1-81FAAF71294C/tmp.gif',
        //     mime_type: 'image/jpeg'
        // }];

        //TODO: Why does message syncing with AttachmentInfo have issues?
        //Ohh, maybe it's because there are no attachments next??

        //TODO: Maybe check for read receipts? idk
        Log.p("Packing array header (number of attachments): "+attachments.length);
        this.writeArrayHeader(attachments.length);
        // console.log("\n\n\n\n================================\n\n\n")
        for (var i = 0; i < attachments.length; i++) {
            await this.packAttachmentInfo(attachments[i]);

        //
        }
        //              For each attachment, writeObject() for the AttachmentInfo item
        //                  TODO: FIND OUT WHAT THIS IS
        //                  Pack the attachment GUID as string
        //                  Pack the attachment name as string (filename I presume)
        //                  Pack the attachment type as nullable string (is this a MIME type?)
        //                  Pack the size as a long (in bytes I assume)
        //                  Pack the checksum as a nullable payload
        //                  Pack the sort (what is this?) as a long
        Log.p("Packing array header (number of stickers): "+0);
        this.writeArrayHeader(0); //0 stickers for now. FIX THIS BEFORE RELEASE
        // console.log("Number of stickers: 0 (hardwired for now)");
        // var stickers = message.attachments || [];
        // this.writeArrayHeader(attachments.length);
        // for (var i = 0; i < attachments.length; i++) {
        //     //TODO: IMPLEMENT WRITEOBJECT() FOR STICKERMODIFIERINFO
        // }
        //              For each sticker, writeObject() for the StickerModifierInfo item
        //                  TODO: FIND OUT WHAT THIS IS
        //                  [Pack the sueprclass ModifierInfo]
        //                      Pack an int: Item type (for StickerModifierInfo this is 1)
        //                      Pack a string: message (Is this the GUID?)
        //                  Pack int: messageIndex (WHAT IS THIS? ROWID?)
        //                  Pack string: fileGUID
        //                  Pack nullable string: Sender (null if me)
        //                  Pack long: Date (unix millis)
        //                  Pack payload: Data (Sticker file data I presume?)
        //                  Pack string: Type (MIME?)
        // console.log("packing tapbacks: "+message.tapbacks.length);


        Log.p("Packing array header (number of tapbacks): "+message.tapbacks.length);
        this.writeArrayHeader(message.tapbacks.length); //0 tapbacks for now. FIX THIS BEFORE RELEASE
        for (var i = 0; i < message.tapbacks.length; i++) {
            this.packTapback(message.tapbacks[i]);
            // this.writeBoolean(true); //isAddition = true
            // this.writeInt(0); //Tapback type: heart (0)
        }
        // console.log("Number of tapbacks: 0 (hardwired for now)");
        // var tapbacks = message.attachments || [];
        // this.writeArrayHeader(attachments.length);
        // for (var i = 0; i < attachments.length; i++) {
        //     //TODO: IMPLEMENT WRITEOBJECT() FOR TAPBACKMODIFIERINFO
        // }
        //              For each tapback, writeObject() for the TapbackModifierInfo item
        //                  TODO: FIND OUT WHAT THIS IS
        //                  [Pack the sueprclass ModifierInfo]
        //                      Pack an int: Item type (for TapbackModifierInfo this is 2)
        //                      Pack a string: message (Is this the GUID?)
        //                  Pack int: messageIndex
        //                  Pack mullable string: Sender (null if me)
        //                  Pack boolean: isAddition (if the tapback was added or removed)
        //                  Pack int: Tapback type (DOUBLE CHECK THE NUMBERS)
        //              Nullable string: sendEffect WHAT IS THIS
        Log.p("Packing nullable string (message effect): "+null);
        this.writeNullableString(null); //Message effects aren't supported by SMServer
        // console.log("Message effects: null (it doesn't look like these are supported by SMServer)");
        //              Int: stateCode WHAT IS THIS
        //State codes:
        //  Idle: 0
        //  Sent: 1,
        //  Delivered: 2,
        //  Read: 3
        //TODO: FIGURE OUT IF SMSERVER TELLS US IF IT IS READ OR DELIVERED OR NOT
        console.log(message.date_read);
        if (message.date_read == 0) {
            Log.p("Packing int (message status): 1 (sent)");
            this.writeInt(1); //Sent
            // console.log("Message status: \"delivered\"");
        } else {
            Log.p("Packing int (message status): 3 (read)");
            this.writeInt(3); //Read
            // console.log("Message status: read");
        }

        //              Int: errorCode WHAT IS THIS

        //Error codes:
        //  OK: 0
        //  Unknown error code: 1,
        //  Network error: 2,
        //  Not registered with iMessage: 3
        Log.p("Packing int (error code): 0");
        this.writeInt(0);
        // console.log("Error code: 0 (no errors, hardwired)");


        // console.log(this.getBuffer());
        //              Long: dateRead: (unix I'm assuming) timestamp the message was read. Is it 0 if it isn't read??
        var date_read = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date_read);
        Log.p("Packing long (date read): "+date_read);
        this.writeLong(date_read);

    }

    this.packTapback = function(tapback_message) {
        var Log = new LogLib.Log("AirPacker.js","packTapback",2);
        //TODO: Add error handling and make this thing return a buffer so we
        //can call this.write() if it succeeded
        Log.p("Packing tapback");
      // {
      //   cache_has_attachments: false,
      //   associated_message_guid: 'p:0/89A7BFE0-D485-41D9-9322-A988BF0CB837',
      //   date_read: 0,
      //   item_type: 0,
      //   ROWID: 212,
      //   is_from_me: true,
      //   id: 'name@example.com',
      //   date: 647399835374000100,
      //   associated_message_type: 2000,
      //   balloon_bundle_id: '',
      //   guid: '005D9ACD-1B0A-4AE6-A7F7-C2BCBC210531',
      //   service: 'iMessage',
      //   text: 'Loved “Message here”',
      //   subject: '',
      //   group_action_type: 0,
      //   conversation_id: 'name@example.com'
      // }


        //TODO: Implement try/catch for this block
        //TODO: Make sure data is in correct format--if it isn't, skip
        // console.log("Found a tapback: "+message.tapbacks[i].associated_message_type);
        Log.p("Packing int (item type): 2");
        this.packInt(2); //Item type is TapbackModifierInfo
        // this.packString(message.tapbacks[i].text); //Message (WHAT IS THIS?)
        // this.packString(message.tapbacks[i].text);
        // this.packString("test");
        Log.p("Packing string (associated message GUID): "+tapback_message.associated_message_guid.split("/")[1]);
        this.packString(tapback_message.associated_message_guid.split("/")[1]); //This is confirmed the GUID
        //TODO: Add AirMessage network protocol docs

        //associated_message_guid: 'p:0/688FB450-C715-4914-9D2F-A73F6FDB7BE7'
        // Log.p("Packing string (message index): "+tapback_message.associated_message_guid.match(/^p\:(\d+)/)[1]);
        var messageIndex = Number(tapback_message.associated_message_guid.match(/^p\:(\d+)/)[1]); //Usually 0, but 1, 2, etc for attachments
        //Slices out the message index from the associated message GUID
        //i.e. 'p:0/688FB450-C715-4914-9D2F-A73F6FDB7BE7' would become 0, and
        //     'p:1/688FB450-C715-4914-9D2F-A73F6FDB7BE7' would become 1

        // this.packInt(message.ROWID); //Is this the messageIndex??
        Log.p("Packing string (message index): "+messageIndex);
        this.packInt(messageIndex); //messageIndex: What is this???
                         //0 for the message, a higher number for attachments
        //Does the Mac return every tapback ever? Is this why this is needed?
        if (tapback_message.is_from_me) {
            Log.p("Packing nullable string (sender): "+null);
            this.writeNullableString(null);
        } else {
            Log.p("Packing nullable string (sender): "+tapback_message.id);
            this.writeNullableString(tapback_message.id);
        }
        // this.writeNullableString(null); //Sender: Me!


        if (tapback_message.associated_message_type >= 3000 && tapback_message.associated_message_type <= 3005) {
            Log.p("Packing boolean (is tapback an addition): "+false);
            this.writeBoolean(false); //isAddition = false, because the tapback was removed.
            Log.p("Packing int (tapback type): "+(tapback_message.associated_message_type - 3000));
            this.writeInt(tapback_message.associated_message_type - 3000);
            //The 200x/300x parts are not sent as the int--only the tapback type (0-5)
        } else {
            Log.p("Packing boolean (is tapback an addition): "+true);
            this.writeBoolean(true);
            Log.p("Packing int (tapback type): "+(tapback_message.associated_message_type - 2000));
            this.writeInt(tapback_message.associated_message_type - 2000);
        }
    }
    this.packActivityStatus = function(message) {
        console.log(message);
        var Log = new LogLib.Log("AirPacker.js", "packActivityStatus", 2);
        //Write data for modifierinfo:
        //Int: item type (0)

        Log.p("Packing int (item type): 0 (activityStatusModifierInfo)")
        this.packInt(0); //Item type: activityStatusModifierInfo
        //String: Message ID
        Log.p("Packing string (message GUID): "+message.guid);
        this.packString(message.guid);
        //Pack int: State

        Log.p("Packing int (activity state): 3 (read)"); //TODO: Does this need to be more abstract--i.e. is packActivityStatus being called for more than just read receipts?
        this.packInt(3);
        //Pack long: Date read
        var date_read = ConversionDatabase.convertAppleDateToUnixTimestamp(message.date_read);
        Log.p("Packing long (date read): "+date_read);
        this.packLong(date_read);

        // Log.p("Packing long (date read): "+)
    }

    this.filterAttachments = function(attachments) {
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

    this.packAttachmentInfo = async function(attachment_info) {
        //TODO: Don't pack pluginPayloadAttachment!!!!!
        let Log = new LogLib.Log("AirPacker.js","packAttachmentInfo", 2);
    //     //TODO: IMPLEMENT WRITEOBJECT() FOR ATTACHMENTINFO
    //     //String: GUID of attachment
        var localpath = await SMServerAPI.downloadAttachmentIfNecessary(attachment_info);
        Log.p("Packing attachment "+localpath);
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
        Log.p("Attachment downloaded to "+localpath);

        var stats = await promiseStats(localpath); //TODO: Don't use sync, as it blocks the process!
        var fileLength = stats.size;

        // console.log(attachments[i].filename);
        // this.writeString(attachments[i].filename); //The filename, works as an ID
        // console.log("5a0fc282-d5f4-4de7-9179-0a268a6ad441");
        // this.writeString("5a0fc282-d5f4-4de7-9179-0a268a6ad441");
        Log.p("Packing string (attachment ID): "+attachment_info.filename);
        this.writeString(attachment_info.filename);

        //TODO: Should this be a GUID?
    //     //String: Name of attachment
        Log.p("Packing string (attachment name): "+attachment_info.filename.match(/\/([^\/]+)$/)[1]);
        this.writeString(attachment_info.filename.match(/\/([^\/]+)$/)[1]); //Parses out the filename

    //     //Nullable string: Type of attachment (WHAT IS THIS)
        Log.p("Packing nullable string (type): "+attachment_info.mime_type);
        this.writeNullableString(attachment_info.mime_type); //Assuming this is a mime type
        //When is type null?

    //     //Long: Attachment size (In bytes I assume)
        Log.p("Packing long (file size): "+fileLength);
        this.writeLong(fileLength);
    //     //Nullable payload: Checksum (I'm pretty sure this is hashAlgorithm in CommConst, which is MD5)
        var promiseMd5 = function(filepath) {
            return new Promise((resCb, rejCb) => {
                var md5sum = crypto.createHash('md5');
                var s = fs.ReadStream(filepath);
                s.on('data', function(d) {
                    md5sum.update(d);
                });
                s.on('end', function() {
                    var d = md5sum.digest();
                    resCb(d);
                });
            });
        }
        var md5 = await promiseMd5(localpath);
        Log.p("Packing nullable payload (hash): "+md5.toString('hex'));
        this.writeNullablePayload(md5);
        //Not a string, it's a payload

    //     //Long: sort (WHAT IS THIS)
    //ASK ABOUT THIS
        // this.writeLong(message.ROWID);
        Log.p("Packing long (sort): "+1);
        this.writeLong(1); //sort (???) Is this the message index?
    }

    //TODO: Ask SMServer to deal with send errors

    this.packConversationUpdateHeader = function(num_conversations) {
        this.packInt(206); //Message type: nhtConversationUpdate
        this.packInt(num_conversations); //Number of conversations
    }

    this.packConversationDataFromSMServer = function(conversations) {
        this.packConversationUpdateHeader(conversations.length);
        for (var i = 0; i < conversations.length; i++) {
            this.packOneConversationFromSMServer(conversations[i]);
        }
    }

    this.packOneConversationFromSMServer = function(conversation) { //Packs a ConversationItem
        /*
          {
            chat_identifier: 'name@example.com',
            relative_time: '18:00',
            has_unread: false,
            display_name: 'Me Lastname',
            pinned: false,
            is_group: false,
            time_marker: 646275652160000100,
            addresses: 'name@example.com',
            latest_text: 'Reply',

            --members: ['firstlast@example.com']  //NOT IMPLEMENTED YET, POSSIBLY IN THE FUTURE BY SMSERVER
          }
        */
        this.writeString(conversation.chat_identifier); //GUID, but can really be whatever ID you want as long as it's consistent
        this.writeBoolean(true); //Availability. WHEN SHOULD THIS BE FALSE???
        // if (conversation.display_name == conversation.chat_identifier) {
        this.writeString("iMessage"); //Service. THIS VALUE IS ASSUMED
        if (conversation.chat_identifier.startsWith("chat")) { //Only group chats start with "chat" as in "chat12345678909876"
            this.writeNullableString(conversation.display_name); //Packs the group name
        } else {
            this.writeNullableString(conversation.display_name); //There is no group name if the title matches the chat ID.
            //TODO: CHANGE THIS BECAUSE THE DISPLAY NAME CAN EQUAL THE CONTACT NAME.
            //MAYBE DO SOME CONTACT CHECKING?
        }
        this.writeInt(1); //Number of members TODO: FIX THIS
        this.writeString(conversation.chat_identifier); //Member #1

    } //TODO: Skip pluginPayloadAttachment in packMessageDataFromSMServer

    this.packOneLiteConversationFromSMServer = async function(conversation) {
        var lastMessage = await SMServerAPI.getActualLastMessageFromConversation(conversation.chat_identifier);

        this.writeString(conversation.chat_identifier); //GUID, but can really be whatever ID you want as long as it's consistent
        this.writeString("iMessage"); //Service. THIS VALUE IS ASSUMED
        if (conversation.chat_identifier.startsWith("chat")) { //Only group chats start with "chat" as in "chat12345678909876"
            this.writeNullableString(conversation.display_name); //Packs the group name
        } else {
            this.writeNullableString(null); //There is no group name if the title matches the chat ID. This is because
                                            //single-person chat names use names from the user's contact list
            //TODO: CHANGE THIS BECAUSE THE DISPLAY NAME CAN EQUAL THE CONTACT NAME.
            //MAYBE DO SOME CONTACT CHECKING?
        }
        this.writeArrayHeader(1); //Number of members TODO: FIX THIS
        this.writeString(conversation.chat_identifier); //Member #1
        this.writeLong(ConversionDatabase.convertAppleDateToUnixTimestamp(conversation.time_market)) //Long: preview date
        //Nullable string: Preview sender
        if (lastMessage.is_from_me) {
            this.packNullableString(null);
        } else {
            this.packNullableString(conversation.chat_identifier);
        }
        //Nullable string: Preview text
        this.packNullableString(conversation.latest_text);
        //Nullable string: Preview send style (Is this a message effect??)
        this.packNullableString(null); //THIS VALUE IS ASSUMED
        this.packArrayHeader(0); //TODO: FIX THIS AND MAKE IT USE REAL ATTACHMENTS
        //If there are attachments,
        //  Pack array header: num of attachments
        //  Pack string: Attachment (Is this the GUID?)
        //Otherwise,
        //  Pack array header: 0
    }

    this.packGroupActionInfo = function() { //NEEDS PARAMETERS
        //serverId, guid, chatGuid, date, agent, other, groupActionType
        this.packInt(0); //itemType is a message, so it's 0
        //              Long: Server ID (MAYBE, SEEMS STRANGE TO SEND THE SERVER ID SO MANY TIMES)
        this.packLong(123456); //CHANGE: Server ID: WHAT IS THIS
        //              String: GUID of message (I THINK)
        this.packString(message.guid.toLowerCase());
        //              String: GUID of conversation (PRETTY SURE)
        this.packString("7305c786-46c6-43c2-9496-721d70e838e2"); //CHANGE: Conversation GUID (I THINK)
        //Maybe we keep a conversion table for Conversation IDs --> generated GUIDs? (i.e. create GUIDs if they're not known)
        //              Long: Date of message (I THINK IN UNIX TIME)
        this.packLong(date);
        //TODO: Merge the above into its own function?



    }

    //TODO: Pack attachmentInfo and pack attachment!!


}
//TODO: Handle group join/leave

module.exports = AirPacker;
