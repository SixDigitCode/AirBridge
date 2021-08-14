const EncryptionLib = require('./encryption_test.js');
function AirUnpacker(inbuffer) {
    //Turns a buffer into something like a readable stream.

    this.buffer = inbuffer;
    this.readerIndex = 0;
    //readVariableLengthData (reads length and then the data)
    this.getBuffer = function() {
        return this.buffer;
    }
    this.setReaderIndex = function(newIndex) {
        this.readerIndex = newIndex;
    }
    this.readInt = function() {
        var readedInt = this.buffer.readUInt32BE(this.readerIndex);
        this.readerIndex += 4;
        return readedInt;
    }
    this.unpackInt = this.readInt;
    this.readArrayHeader = this.readInt;
    this.unpackArrayHeader = this.readArrayHeader;
    this.readLong = function() { //THE FOLLOWING IS UNTESTED
        var readedLong = this.buffer.readBigUInt64BE(this.readerIndex);
        this.readerIndex += 8;
        return Number(readedLong);
    }
    this.unpackLong = this.readLong;
    this.readShort = function() { //THE FOLLOWING IS UNTESTED
        var readedShort = this.buffer.readUInt16BE(this.readerIndex);
        this.readerIndex += 2;
        return readedShort;
    }
    this.unpackShort = this.readShort;
    //TODO: ADD READ BOOLEAN
    this.readBoolean = function() {
        // var readedBool = this.buffer.slice(readerIndex, readerIndex + 1);
        // readerIndex += 1;
        var readedBoolAsInt = this.buffer.readInt8(this.readerIndex);
        //Booleans are stored in a whole byte. We pretend it's an integer and check if it's 1 or 0
        this.readerIndex += 1;
        return (readedBoolAsInt == 1) ? true : false; //Returns true if the int is 1, otherwise returns false.
    }
    this.unpackBoolean = this.readBoolean;
    this.readUTF8StringArray = function() { //THE FOLLOWING IS UNTESTED
        var arrayLength = this.readInt();
        var finalarr = [];
        for (var i = 0; i < arrayLength; i++) {
            var item = this.readVariableLengthUTF8String();
            finalarr.push(item);
        }
        return finalarr;
    }
    this.unpackUTF8StringArray = this.readUTF8StringArray;
    this.readUtf8String = function(length) {
        var outputstr = this.buffer.toString('utf8',this.readerIndex, this.readerIndex + length);
        this.readerIndex += length;
        return outputstr;
    }
    this.unpackUtf8String = this.readUtf8String;
    //TODO: Sort out the UTF8 string madness (Utf8 vs UTF8 vs just string)
    this.readVariableLengthUTF8String = function() {
        //Assumes there's an int length and the data immediately after
        var length = this.readInt();
        return this.readUtf8String(length);
    }
    this.unpackVariableLengthUTF8String = this.readVariableLengthUTF8String;
    this.readString = this.readVariableLengthUTF8String;
    this.unpackString = this.readVariableLengthUTF8String;
    this.readBytes = function(length) {
        var outputBuffer = this.buffer.slice(this.readerIndex, this.readerIndex + length);
        this.readerIndex += length;
        return outputBuffer;
    };
    this.unpackBytes = this.readBytes;
    this.readPayload = function() {
        var length = this.readInt();
        return this.readBytes(length);
    };
    this.unpackPayload = this.readPayload;
    this.readBytesToEnd = function() { //THE FOLLOWING IS UNTESTED
        var outputBuffer = this.buffer.slice(this.readerIndex, this.buffer.length);
        this.readerIndex = this.buffer.length;
        return outputBuffer;
    }
    this.unpackBytesToEnd = this.readBytesToEnd;
    this.readVariableLengthData = function() { //Change this to readVariableLengthBuffer?
        var length = this.readInt();
        return this.readBytes(length);
    }
    this.unpackVariableLengthData = this.readVariableLengthData;
    this.decryptRestOfData = async function() {
        var salt = this.readBytes(EncryptionLib.SALT_LENGTH);
        var iv = this.readBytes(EncryptionLib.IV_LENGTH);
        var encrypted = this.readBytesToEnd();
        var decryptedData = await EncryptionLib.decryptWithSaltIVAndData(salt, iv, encrypted);
        return Buffer.from(decryptedData);
    }
    //TODO: Function to read the rest of the data?
    //TODO: Maybe build decryption into AirUnpacker?
}
//TODO: When packing a conversation and including the latest_text, make sure to deal with it if it's null!
//  Maybe add a function that auto-puts something like "Unknown" if the value is null
module.exports = AirUnpacker;
