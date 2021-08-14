exports.mmCommunicationsVersion = 5;
exports.mmCommunicationsSubVersion = 3;

//NHT - Net header type
exports.nhtClose = 0;
exports.nhtPing = 1;
exports.nhtPong = 2;

exports.nhtInformation = 100;
exports.nhtAuthentication = 101;

exports.nhtMessageUpdate = 200;
exports.nhtTimeRetrieval = 201;
exports.nhtIDRetrieval = 202;
exports.nhtMassRetrieval = 203;
exports.nhtMassRetrievalFile = 204;
exports.nhtMassRetrievalFinish = 205;
exports.nhtConversationUpdate = 206;
exports.nhtModifierUpdate = 207;
exports.nhtAttachmentReq = 208;
exports.nhtAttachmentReqConfirm = 209;
exports.nhtAttachmentReqFail = 210;
exports.nhtIDUpdate = 211;

exports.nhtLiteConversationRetrieval = 300;
exports.nhtLiteThreadRetrieval = 301;

exports.nhtSendResult = 400;
exports.nhtSendTextExisting = 401;
exports.nhtSendTextNew = 402;
exports.nhtSendFileExisting = 403;
exports.nhtSendFileNew = 404;
exports.nhtCreateChat = 405;

exports.hashAlgorithm = "MD5";

//NST - Net subtype
exports.nstAuthenticationOK = 0;
exports.nstAuthenticationUnauthorized = 1;
exports.nstAuthenticationBadRequest = 2;

exports.nstSendResultOK = 0;
exports.nstSendResultScriptError = 1; //Some unknown AppleScript error
exports.nstSendResultBadRequest = 2; //Invalid data received
exports.nstSendResultUnauthorized = 3; //System rejected request to send message
exports.nstSendResultNoConversation = 4; //A valid conversation wasn't found
exports.nstSendResultRequestTimeout = 5; //File data blocks stopped being received

exports.nstAttachmentReqNotFound = 1; //File GUID not found
exports.nstAttachmentReqNotSaved = 2; //File (on disk) not found
exports.nstAttachmentReqUnreadable = 3; //No access to file
exports.nstAttachmentReqIO = 4; //IO error

exports.nstCreateChatOK = 0;
exports.nstCreateChatScriptError = 1; //Some unknown AppleScript error
exports.nstCreateChatBadRequest = 2; //Invalid data received
exports.nstCreateChatUnauthorized = 3; //System rejected request to send message

//Timeouts
exports.handshakeTimeout = 10 * 1000; //10 seconds
exports.pingTimeout = 30 * 1000; //30 seconds
exports.keepAliveMillis = 30 * 60 * 1000; //30 minutes

exports.maxPacketAllocation = 50 * 1024 * 1024; //50 MB

exports.transmissionCheckLength = 32;

//TODO: Separate JS file for AirBridge bot?
exports.introMessage = `Hey there!
Thanks for using AirBridge. This isn't a "real" iMessage chat--instead, it's a bot that helps you manage your AirBridge server. You can talk to me using commands that start with hashtags--such as #status. You can get a list of available commands by sending #help.

AirBridge will let you know right here if there are any server issues, but you can always disable this by sending #notifications.`;

exports.helpMessage = `Here are the available commands you can use:
#help: Displays this screen
#notifications on/off: Enables/disables server notifications (errors/etc)
#remote: Get a link to remote control your iPhone
#settings: Adjust settings
#tapback type message: Lets you send a tapback (this command is usable in any chat). Send #help tapbacks to learn more.`;

exports.helpTapbackMessage = `
`;

exports.settingsMessage = `
`;
