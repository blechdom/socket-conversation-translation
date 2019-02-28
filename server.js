
const EventEmitter = require('events');
class MessageEmitter extends EventEmitter {}
const messageEmitter = new MessageEmitter();
const userListEmitter = new MessageEmitter();

const io = require("socket.io");
const SocketServer = io.listen(8082);

var _ = require('lodash');
var util = require('util');
var fs = require('fs');

var call_array = [];
var user_array = [];
var sttLanguageCode = '';
var translateLanguageCode = '';
var ttsLanguageCode = '';

const STREAMING_LIMIT = 55000;
let recognizeStream = null;
let restartTimeoutId;
var audioStreamCall = null;

const speech = require('@google-cloud/speech');
const {Translate} = require('@google-cloud/translate');
const textToSpeech = require('@google-cloud/text-to-speech');

const speechClient = new speech.SpeechClient();
const translate = new Translate();
const ttsClient = new textToSpeech.TextToSpeechClient();

var voiceList = {};

SocketServer.on("connection", function(socket) {

  socket.on('binaryStream', function(data) {

    if(recognizeStream!=null) {
      recognizeStream.write(data);
    }

  });
  socket.on('getVoiceList', function(data) {
    console.log("getting voice list");
    async function getList(){
      const [result] = await ttsClient.listVoices({});
      voiceList = result.voices;
      //console.log("result: " + JSON.stringify(result));
      voiceList.sort(function(a, b) {
        var textA = a.name.toUpperCase();
        var textB = b.name.toUpperCase();
        return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
      });
    //  callback(null, {voicelist: JSON.stringify(voiceList)});
      socket.emit('voicelist', JSON.stringify(voiceList));

    }
    getList();
  });
  socket.on('joinChat', function(data) {
    async function doJoinChat() {
      var username = data.username;
      var requestID = Math.random().toString(36).substr(2, 9);
      var languageName = data.languageName;

      user_array.push({
        userid: requestID,
        username: username,
        languagename: languageName
      });

      var joinMessage = {
        message: username + " joined the conversation",
        messageID: requestID,
        messageLangCode: 'en',
        senderID: requestID,
        senderName: username,
        messageType: "update"
      };

      console.log(username + " joined the conversation with ID: " + requestID);

      console.log("number joined: " + user_array.length);

      messageEmitter.on('chatMessage', function(chatMessage) {

        //translate chatMessage Here
        async function runTranslation() {
          ttsLanguageCode = data.translateLanguageCode; //en-EN-standard-B
          translateLanguageCode = ttsLanguageCode.substring(0, 2); //en
          sttLanguageCode = ttsLanguageCode.substring(0, 5); //en-US

          console.log('translating into: ' + ttsLanguageCode);
          var request = {
            // Select the language and SSML Voice Gender (optional)
            voice: {languageCode: ttsLanguageCode, ssmlGender: 'NEUTRAL'},
            // Select the type of audio encoding
            audioConfig: {audioEncoding: 'MP3'},
          };
          var target = translateLanguageCode;
          var text = chatMessage.message;
          let [translations] = await translate.translate(text, target);
          translations = Array.isArray(translations) ? translations : [translations];
          var translation_concatenated = "";
          translations.forEach((translation, i) => {
            translation_concatenated += translation + " ";
          });
          // Construct the request
          request.input= {text: translation_concatenated};
          console.log('tts config: ' + JSON.stringify(request));
          async function tts(){
            const [response] = await ttsClient.synthesizeSpeech(request);

            const writeFile = util.promisify(fs.writeFile);
            await writeFile('audio/' + chatMessage.messageID + '_' + requestID[0] + '.mp3', response.audioContent, 'binary');
            console.log('Audio content written to file: ' + chatMessage.messageID + '_' + requestID[0] + '.mp3');


            var messageObject = {
              receiverid: requestID,
              senderid: chatMessage.senderID,
              sendername: chatMessage.senderName,
              message: translation_concatenated,
              messageid: chatMessage.messageID,
              users: user_array,
              messagetype: chatMessage.messageType
            };
            socket.emit('receiveMessage', messageObject);
            console.log(`${target}) ${translation_concatenated}`);
          }
          tts();
        }
        runTranslation();
      });
      messageEmitter.emit('chatMessage', joinMessage);
    }
    doJoinChat();
  });
  socket.on('sendMessage', function(data) {

      var newMessage = data.message;
      var senderID = data.senderid;
      var senderName = data.sendername;
      var messageID = Math.random().toString(36).substr(2, 9);
      var chatMessage = {
        message: newMessage,
        messageID: messageID,
        senderID: senderID,
        senderName: senderName,
        messageType: "message"
      };
      console.log("message received: " + JSON.stringify(chatMessage));
      try {
        messageEmitter.emit('chatMessage', chatMessage);
      } catch(err) {
        console.error('caught while emitting:', err.message);
      }
      socket.emit("messageStatus", {status: "message-received"});
      //callback(null, {status: "message-received"});

  });
});

function doTranscribeAudioStream(call) {
  audioStreamCall = call;
  startStreaming(call.request.sttlanguagecode);
}

function startStreaming(sttLanguage) {
  var request = {
      config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: sttLanguage,
      },
      interimResults: true
  };

  recognizeStream = speech
    .streamingRecognize(request)
    .on('error', (error) => {
      console.error;
    })
    .on('data', (data) => {
      if (data.results[0] && data.results[0].alternatives[0]){
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(data.results[0].alternatives[0].transcript);
        if (data.results[0].isFinal) process.stdout.write('\n');
        audioStreamCall.write({
          transcript: data.results[0].alternatives[0].transcript,
          isfinal: data.results[0].isFinal
        });
      }
    });
    audioStreamCall.write({
      isstatus: "Streaming server successfully started"
    });
    restartTimeoutId = setTimeout(restartStreaming, STREAMING_LIMIT);
}

function doStopAudioStream(call, callback) {
  clearTimeout(restartTimeoutId);
  audioStreamCall.end();
  stopStreaming();
  callback(null, {message: 'Server has successfully stopped streaming'});
}

function stopStreaming(){
  recognizeStream = null;
}

function restartStreaming(){
  stopStreaming();
  startStreaming();
}

function doPlayAudioFile(call) {
  console.log("playing audio file");
  var filename = "audio/" + call.request.audiofilename;

  let readStream = fs.createReadStream(filename);
  let chunks = [];
  var packages = 0;
  totalBytes = 0;

  readStream.on('error', err => {
      // handle error
      // File could not be read
      throw err;
  });

  readStream.on('data', chunk => {

    //console.log("chunk: " + chunk);
      call.write({
        audiodata: chunk
      });
  });
  // File is done being read
  readStream.on('close', () => {
      call.end();
      // Create a buffer of the image from the stream
      console.log("file send complete");
  });

}

function doLeaveChat(call, callback) {
  var senderID = call.request.senderid;
  var username = call.request.username;

  for(var i = 0; i < user_array.length; i++) {
    if(user_array[i].userid == senderID) {
        user_array.splice(i, 1);
        break;
    }
  }
  var leaveMessage = username + " has left the conversation.";
  var chatMessage = {
    message: leaveMessage,
    messageID: senderID,
    senderID: senderID,
    senderName: username,
    messageType: "update"
  };
  console.log("leave message received: " + JSON.stringify(chatMessage));
  try {
    messageEmitter.emit('chatMessage', chatMessage);
  } catch(err) {
    console.error('caught while emitting:', err.message);
  }
  callback(null, {status: "message-received"});
}

function getServer() {
  //var server = new grpc.Server();
  //console.log("getting server");
  //server.addService(translate_chat.TranslateChat.service, {
  //  getVoiceList: doGetVoiceList,
  //  joinChat: doJoinChat,
  //  sendMessage: doSendMessage,
  //  leaveChat: doLeaveChat,
  //  transcribeAudioStream: doTranscribeAudioStream,
  //  playAudioFile: doPlayAudioFile,
  //  stopAudioStream: doStopAudioStream
  //});
  console.log("Chat Server Started");
  return server;
}

if (require.main === module) {
  var server = getServer();
  //server.bind('0.0.0.0:9090', grpc.ServerCredentials.createInsecure());
  //server.start();
}

exports.getServer = getServer;
