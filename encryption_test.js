const crypto = require('crypto');
var ByteBuffer = require('byte-buffer');
const SettingsManager = require("./settingsManager.js");
const LogLib = require("./Log.js");

const SALT_LENGTH = 8; //8-byte salt
const IV_LENGTH = 12; //12-byte IV
const KEY_LENGTH = 16; //The encryption uses a 16-byte key
const AUTHTAG_LENGTH = 16;
const KEY_ITERATIONS = 10000;

const KEY_DIGEST = 'sha256';
const ENCRYPTION_ALGORITHM = 'aes-128-gcm';

exports.SALT_LENGTH = SALT_LENGTH;
exports.IV_LENGTH = IV_LENGTH;
exports.SKEY_LENGTH = KEY_LENGTH;

//TODO: What about crashes when the password is wrong?


//TODO: Add error handling and retrying for "Unsupported state or unable to authenticate data"

function decryptThisAlreadyDangit(message) {
    //The incoming message should have the salt, iv, and encrypted message (encrypted message = ciphertext stuck with authTag) all stuck together.
    //The following variables slice apart the message into its respective components
    var salt = message.slice(0, SALT_LENGTH);
    var iv = message.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    var encrypted = message.slice(SALT_LENGTH + IV_LENGTH, message.length);
    //What message is sent back if the password is wrong?
    return decryptWithSaltIVAndData(salt, iv, encrypted); //This returns a Promise
}


function decryptWithSaltIVAndData(salt, iv, encryptedWithAuthTag) {
    var Log = new LogLib.Log("encryption_test.js", "decryptWithSaltIVAndData");
    return new Promise(async (resCb, rejCb) => {
        var password = await SettingsManager.readSetting("AIRMESSAGE_PASSWORD");

        var encrypted = encryptedWithAuthTag.slice(0, encryptedWithAuthTag.length - AUTHTAG_LENGTH);
        var authTag = encryptedWithAuthTag.slice(encryptedWithAuthTag.length - AUTHTAG_LENGTH, encryptedWithAuthTag.length);
        //For more info on the authTag business, check out the encryption function for more details.
        //The authTag is the last 16 byes of the encrypted message

        crypto.pbkdf2(password, salt, KEY_ITERATIONS, KEY_LENGTH, KEY_DIGEST, (err, derivedKey) => {
            // This gets us the key. It's a symmetric key, so used for both encryption and decryption
            // This converts the user-supplied AirMessage password into the key that was used to encrypt the message

            var decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv); //Create a cipher with the key and iv
            decipher.setAuthTag(authTag); //The infamous authTag. See the encrypt function for more info


            var decrypted = new ByteBuffer(); //Creates a byte buffer to add the encrypted data to.

            var decryptedchunk = decipher.update(encrypted); //This pipes our encrypted data into the cipher and gets the decrypted data.
            decrypted.append(decryptedchunk.length); //Allocates space for the decrypted chunk in the byte buffer
            decrypted.write(decryptedchunk); //Writes the decrypted data to the byte buffer
            try {
                decipher.final(); //Finishes the encryption. Some encryption methods put some extra stuff at the end, but
                                //GCM doesn't, so cipher.final() just returns an empty buffer every time.
                //TODO: Add error handling to this where it tries to decrypt again
            } catch (err) {
                Log.w(err);
            }

            resCb(decrypted.raw); //Returns the decrypted data
        });
    });
}

function encrypt(data) {
    // This drove me crazy for a solid week, so I'm letting you know what the heck this is doing
    // So you hopefully don't have to deal with the same crap I did:
    //
    // So GCM encryption is weird. In addition to requiring the salt, IV, and encrypted data, it
    // also likes to have something called an authTag. This is basically a checksum that's signed
    // by the encryption key (I think). It's not strictly necessary to decrypt the data, but many
    // programming languages (ex. Java) expect it in order to decrypt anything at all.
    //
    // So, the decryption should work fine if you only care about the encrypted data and pay no
    // attention to the authTag. HOWEVER, if you try to encrypt data without including the authTag
    // at the end (it's usually 16 bytes), many other programming languages (cough cough, Java) that
    // expect the authTag will get real mad and crash. Node for some reason doesn't include it by
    // default at the end of the encrypted data, so you need to call cipher.getAuthTag() and stick
    // the buffer to the end manually. If you don't do this, you'll spend a week wondering why other
    // languages output encrypted data that's 16 bytes longer.


    return new Promise(async(resCb, rejCb) => {
        var password = await SettingsManager.readSetting("AIRMESSAGE_PASSWORD");

        var salt = crypto.randomBytes(SALT_LENGTH); //Generates a random 8-byte salt used to derive the key from the password

        crypto.pbkdf2(password, salt, KEY_ITERATIONS, KEY_LENGTH, KEY_DIGEST, (err, derivedKey) => {
            // This gets us the key. It's a symmetric key, so used for both encryption and decryption
            // This converts the user-supplied AirMessage password into the key that was used to encrypt the message

            var iv = crypto.randomBytes(IV_LENGTH); //Generate 12 bytes of secure random noise for the initialization vector

            var cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, derivedKey, iv); //Create a cipher with the key and iv

            // cipher.setAutoPadding(true);

            var encrypted = new ByteBuffer(); //Creates a byte buffer to add the encrypted data to.

            var encryptedchunk = cipher.update(data); //This pipes our unencrypted data into the cipher and gets the encrypted data.
            encrypted.append(encryptedchunk.length); //Allocates space for the encrypted chunk in the byte buffer
            encrypted.write(encryptedchunk); //Writes the encrypted data to the byte buffer

            cipher.final(); //Finishes the encryption. Some encryption methods have some extra stuff at the end, but
                            //GCM doesn't, so cipher.final() just returns an empty buffer every time.

            var authTag = cipher.getAuthTag(); //Gets the infamous authTag. Should be 16 bytes every time.

            encrypted.append(authTag.length); //Allocates space for the AuthTag. Should always be 16 bytes
            encrypted.write(authTag); //Writes the authTag right up next to the encrypted data.

            resCb([salt, iv, encrypted.raw]);
        });
    });
}

// decryptThisAlreadyDangit(message).then((data) => {
//     testbuf = new Buffer(data);
//     console.log(testbuf.toString('hex').match(/../g).join(' '));
// });

exports.decryptThisAlreadyDangit = decryptThisAlreadyDangit;
exports.decryptWithSaltIVAndData = decryptWithSaltIVAndData;
exports.encrypt = encrypt;

// (async function() {
//
//     console.log("encrypting");
//     var encrypted = await encrypt(dataToEncrypt);
//     console.log("going to print encrypted");
//     console.log(encrypted);
//     console.log("decrypting");
//     var decrypted = await decryptWithSaltIVAndData(encrypted[0], encrypted[1], encrypted[2]);
//     //You can also run decryptThisAlreadyDangit(message) if it contains the salt and IV
//     console.log(decrypted);
//
//
// })();
