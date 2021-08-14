const fs = require('fs');
const LogLib = require("./Log.js");
exports.readSettingsFile = function() {
    return new Promise(function(resolve, reject) {
        fs.readFile('./settings.txt', 'utf8', (err, data) => { //Should this be UTF8?
            // console.log(data);
            resolve(data);
        })
    });
}

exports.readSetting = async function(setting_name) {
    var Log = new LogLib.Log("settingsManager.js", "readSetting");
    var fileData = await exports.readSettingsFile();
    var fileLines = fileData.split("\n");
    for (var i = 0; i < fileLines.length; i++) {
        var parts = fileLines[i].match(/^([^=]+)=(.*)/);
        if (parts[1] == setting_name) {
            return parts[2];
        }
    }

    Log.e("Setting doesn't exist in settings.txt: "+setting_name);
    // return false;
}

//TODO: Maybe reset settings if they don't exist or are in the wrong format?
