//This is for logging, and easy setup to output to a file.
Reset = "\x1b[0m"
Bright = "\x1b[1m"
Dim = "\x1b[2m"
Underscore = "\x1b[4m"
Blink = "\x1b[5m"
Reverse = "\x1b[7m"
Hidden = "\x1b[8m"

FgBlack = "\x1b[30m"
FgRed = "\x1b[31m"
FgGreen = "\x1b[32m"
FgYellow = "\x1b[33m"
FgBlue = "\x1b[34m"
FgMagenta = "\x1b[35m"
FgCyan = "\x1b[36m"
FgWhite = "\x1b[37m"

BgBlack = "\x1b[40m"
BgRed = "\x1b[41m"
BgGreen = "\x1b[42m"
BgYellow = "\x1b[43m"
BgBlue = "\x1b[44m"
BgMagenta = "\x1b[45m"
BgCyan = "\x1b[46m"
BgWhite = "\x1b[47m"

//TODO: Log.Good which only gives very high-level info (i.e. one message per client request)

exports.Log = function(jsfile, sender, indentationLevel) {
    // var sender = "[Unknown]";
    // exports.setSender = function(sender) {
        // sender = "["+sender+"]";
    // }
    this.sender = "["+jsfile+"] ["+sender+"]";
    this.indentation = "";
    //TODO: Pad the sender string to make them all the same length?
    if (indentationLevel) {
        for (var i = 0; i < indentationLevel; i++) {
            this.indentation += "   ";
        }
    }

    this.g = function(message) {
        console.log(FgGreen+this.indentation+"[ Ok ] "+this.sender+" "+message+Reset);
    }
    this.good = this.g;
    this.i = function(message) {
        console.log(FgCyan+this.indentation+"[Info] "+this.sender+" "+message+Reset);
    }
    this.info = this.i;
    this.w = function(message) {
        console.log(FgYellow+this.indentation+"[Warn] "+this.sender+" "+message+Reset);
    }
    this.warning = this.w;
    this.e = function(message) {
        console.log(FgRed+this.indentation+"[Err ] "+this.sender+" "+message+Reset);
    }
    this.error = this.e;
    this.v = function(message) {
        console.log(this.indentation+"[Verb] "+this.sender+" "+message+Reset);
    }
    this.verbose = this.v;
    this.vv = function(message) {
        //Super-verbose logging. Used to dump data returned from SMServer and raw bytes sent to the client
        //TODO: Maybe introduce a VVV and use that to dump data, use VV for packer logging
        //  Maybe add a Log.packer(...) function?
        console.log(this.indentation+"[Verb] "+this.sender+" "+message+Reset);
    }
    this.verbosev = this.vv;
    this.blankLine = function() {
        console.log("\n");
    }
    this.p = function(message) {
        console.log(FgMagenta+this.indentation+"[Pakr] "+this.sender+" "+message+Reset);
    }
    this.packer = this.p;
}

//TODO: Connection management logs?

//TODO: Include log sender? Initialize at the top of each JS file!
//TODO: Include function name?

//TODO: Separate settings for what to output vs what to save to a file--i.e. output info messages but save verbose to a file?
