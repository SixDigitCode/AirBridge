const {v4: uuidv4}  = require('uuid');
const LogLib = require("./Log.js");
const fs = require('fs');

function getKeyFromValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

//TODO: Create the file if it doesn't exist!!! Add a getFileDataOrCreateIfItDoesNotExist() function?

function getDatabase() {
    try {
        var data = fs.readFileSync("./conversionDatabase.json");
        var jsondata = JSON.parse(data);
        return jsondata;
    } catch (err) {
        Log.e("CRITICAL ERROR: conversionDatabase has been corrupted and isn't valid JSON!")
        //TODO: Send to client (as text) here?
    }
}

function updateDatabase(newDatabase) {
    try {
        fs.writeFileSync("./conversionDatabase.json", JSON.stringify(newDatabase));
    } catch (err) {
        Log.e("ERROR: Could not write to conversionDatabase: "+err);
    }
}

function resetDatabase() {
    var emptyDb = {
        "installationId": "",
        "conversationIdToUUIDConversionTable": {},
        "savedAttachmentPaths": {},
        "infoMessageROWID": 1000000
    }
    updateDatabase(emptyDb);
}

// exports.chatIDToGUID = function(chatID) {
//     var db = getDatabase();
//
//     if (chatID in db.conversationIdToUUIDConversionTable) {
//         return db.conversationIdToUUIDConversionTable[chatID];
//     } else {
//         var newUUID = uuidv4();
//         db.conversationIdToUUIDConversionTable[chatID] = newUUID;
//         updateDatabase(db);
//         return newUUID;
//         // return "";
//     }
// }
//
// exports.saveGUIDAssociation = function(chatID, chatUUID) {
//     var db = getDatabase();
//     if (chatID in db.conversationIdToUUIDConversionTable && dv.conversationIdToUUIDConversionTable[chatID] == chatUUID) {
//         return; //Do nothing, as the UUID already exists in the database and matches what we're trying to set
//     } else {
//         // var newUUID = uuidv4();
//         db.conversationIdToUUIDConversionTable[chatID] = chatUUID;
//         updateDatabase(db);
//         // return newUUID;
//     }
// }
//
// exports.ensureUUIDExists = function(chatID) {
//     var db = getDatabase();
//     if (chatID in db.conversationIdToUUIDConversionTable) {
//         return; //Do nothing, as the UUID already exists in the database
//     } else {
//         var newUUID = uuidv4();
//         db.conversationIdToUUIDConversionTable[chatID] = newUUID;
//         updateDatabase(db);
//         // return newUUID;
//     }
// }
//
// exports.UUIDToChatID = function(chatUUID) {
//     //If it doesn't exist, complain because have nothing!
//     var db = getDatabase();
//     var chatID = getKeyFromValue(db.conversationIdToUUIDConversionTable, chatUUID);
//     if (chatID == undefined) {
//         Log.e("ERROR: Couldn't reverse GUID to Chat ID as the chat ID doesn't exist");
//     }
//     return chatID; //Undefined if it doesn't exist
// }

exports.getInstallationID = function() {
    var db = getDatabase();
    if (db.installationId == "") {
        db.installationId = uuidv4();
        updateDatabase(db);
    }
    return db.installationId;
}

exports.convertAppleDateToUnixTimestamp = function(date) {
    return Math.floor(((date / 1000000000) + 978307200) * 1000); //Returns a timestamp in UNIX milliseconds.
    //TODO: Convert this to milliseconds and make EVERYTHING be done in milliseconds
}

exports.convertUnixTimestampToAppleDate = function(date) {
    return Math.floor(((date / 1000) - 978307200) * 1000000000); //Takes a timestamp in UNIX milliseconds
}

exports.getUint8ArrayAsPrettyString = function(inarr) {
    var data = JSON.parse(JSON.stringify(inarr));
    var maxindex = 0;
    for (property in data) {
        if (data.hasOwnProperty(property)) {
            if (Number(property) > maxindex) {
                maxindex = Number(property);
            }
        }
    }

    var finalarr = [];

    for (var i = 0; i <= maxindex; i++) {
        finalarr.push(data[i]);
    }
    //   >  XXX,
    finalstr = "";
    for (var i = 0; i < finalarr.length; i++) {
        if (i % 4 == 0) {
            finalstr += "\n.";
        }

        var numSpaces = 1;
        var stringified = finalarr[i].toString();
        numSpaces += (3 - stringified.length); //Adds appropriate padding
        for (var j = 0; j < numSpaces; j++) {
            finalstr += " ";
        }

        finalstr += stringified + ",";
    }

    return finalstr;
}

exports.printUint8Array = function(inarr) {
    console.log(exports.getUint8ArrayAsPrettyString(inarr));
}

//TODO: Keep track of attachment paths when conversations are dumped
//TODO: Keep track of downloaded attachments
exports.getAttachmentSavePath = function(smserver_filename) {
    var Log = new LogLib.Log("conversionDatabase.js", "getAttachmentSavePath");
    //Here is where the server should keep track of which attachments live where
    //Let's keep the filename the same to make things easy.
    //Filename example: "Attachments/32/02/26ADB495-9E1C-44F2-B0E6-176A737D7F45/jpeg-image-JgOYM9.jpeg"
    //Filename example: "Attachments/33/03/6DA2243B-E98C-4B97-8104-E02882B9F2F5/64707007403__6AF2C454-0578-4355-ADD1-CE6E25FEBA27.JPG"
    //Mapping example: "Attachments/32/02/26ADB495-9E1C-44F2-B0E6-176A737D7F45/jpeg-image-JgOYM9.jpeg": "/e4b3df3f-de31-4bf5-adfd-93bee41ff0e8.JPG"

    //savedAttachmentPaths
    Log.v("Getting attachment save path for "+smserver_filename);
    var db = getDatabase();
    //uuidv4()
    var attachmentPath = exports.checkIfAttachmentAlreadySaved(smserver_filename);
    if (attachmentPath) { //attachmentPath is undefined if it doesn't exist
        Log.v("Attachment path exists: "+attachmentPath);
        return attachmentPath;
    }
    var fileExtension = smserver_filename.match(/(\.[^\/]+)$/)[1]; //Slices out the file extension (ex. ".jpeg" or ".JPG" or ".mp4" or whatever)
        //For security reasons (mainly directory traversal), no slashes are allowed in the extension (so ../index as the filename would would return nothing for the extension. ../index.js would return ".js")
    var filenameToSave = uuidv4() + fileExtension;
    db.savedAttachmentPaths[smserver_filename] = filenameToSave;
    updateDatabase(db);
    return filenameToSave;
}
//TODO: Do attachment GUIDs matter?
exports.checkIfAttachmentAlreadySaved = function(smserver_filename) {
    var db = getDatabase();
    return db.savedAttachmentPaths[smserver_filename]; //Undefined if it doesn't exist, otherwise it's the filename
}

exports.isPhoneNumber = function(identifier) {
    //Code to check if an identifier is a phone number or email
    return (identifier.indexOf("@") == -1); //If an email @ is nowhere to be found, it's assumed to be a phone number
}

exports.getInternationalPhoneNumberFormat = function(phone_number) {
    //TODO: Set the "default" country code in the settings?
    //Samples:
    //+44 7911 123456
    //(123) 456-7890
    //1234567890
    //123-456-7890
    //11234567890 (Includes country code without the plus. I'm disregarding this one as that makes it way more complex)

    //How this works:
    //This basically disregards any punctuation and sticks the numbers
    //all together in a line. Country code is added if there's no plus (+) present.

    var intlFormat = "";
    if (phone_number.indexOf("+") > -1) {
        intlFormat += "+"; //Country number is taken care of later.
    } else {
        intlFormat += "+1"; //TODO: Replace this with the country code in settings
    }

    for (var i = 0; i < phone_number.length; i++) {
        if (/^\d$/.test(phone_number.charAt(i))) { //If the current index is a number
            //Add it to the international format string
            intlFormat += phone_number.charAt(i);
        }
    }
    return intlFormat;
}

exports.getInfoMessageROWID = function() {
    var db = getDatabase();
    if (db.infoMessageROWID == undefined || Number(db.infoMessageROWID) == NaN) {
        db.infoMessageROWID = 999999; //I hope this fits in a long
    } else {
        db.infoMessageROWID = db.infoMessageROWID + 1;
    }
    updateDatabase(db);
    return db.infoMessageROWID;
}

exports.promiseStats = function(filename) {
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
