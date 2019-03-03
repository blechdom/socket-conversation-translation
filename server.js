const io = require("socket.io");
const SocketServer = io.listen(8082);

var util = require('util');
var fs = require('fs');

const speech = require('@google-cloud/speech');
const {Translate} = require('@google-cloud/translate');
const textToSpeech = require('@google-cloud/text-to-speech');

const STREAMING_LIMIT = 55000;

let recognizeStream = null;
let restartTimeoutId;

const speechClient = new speech.SpeechClient();
const translate = new Translate();
const ttsClient = new textToSpeech.TextToSpeechClient();

var user_array = [];
var voiceList = {};

SocketServer.on("connection", function(socket) {

  socket.on('getVoiceList', function(data) {

    async function getList(){
      const [result] = await ttsClient.listVoices({});
      voiceList = result.voices;

      voiceList.sort(function(a, b) {
        var textA = a.name.toUpperCase();
        var textB = b.name.toUpperCase();
        return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
      });

      socket.emit('voicelist', JSON.stringify(voiceList));
    }
    getList();
  });

  socket.on('joinChat', function(data) {
    var uniqueUser = true;

    for(var i = 0; i < user_array.length; i++) {
      if(user_array[i].userid == socket.id) {
          uniqueUser = false;
      }
    }
    if(uniqueUser){
      user_array.push({
        userid: socket.id,
        username: data.username,
        languagename: data.languageName,
        ttsLanguageCode: data.translateLanguageCode
      });

      var joinMessage = {
        message: data.username + " joined the conversation",
        messageID: socket.id,
        senderID: socket.id,
        senderName: data.username,
        messageType: "update"
      };

      console.log(data.username + " joined the conversation with ID: " + socket.id);

      translateAndSendMessage(joinMessage);
    }

  });

  socket.on('sendMessage', function(data) {
      console.log("message socket id is: " + socket.id);
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
      console.log("message received from client: " + JSON.stringify(chatMessage));
      try {
        translateAndSendMessage(chatMessage);
      } catch(err) {
        console.error('caught while emitting:', err.message);
      }
      socket.emit("messageStatus", {status: "message-received"});
  });

  socket.on("startStreaming", function(data){
    startStreaming(data.sttlanguagecode);
  });

  socket.on('binaryStream', function(data) {
    if(recognizeStream!=null) {
      recognizeStream.write(data);
    }
  });

  socket.on("stopStreaming", function(data){
    clearTimeout(restartTimeoutId);
    stopStreaming();
  });

  socket.on("playAudioFile", function(data){

      console.log("playing audio file");
      var filename = "audio/" + data.audiofilename;

      const audioFile = fs.readFileSync(filename);
      const imgBase64 = new Buffer.from(audioFile).toString('base64');

      socket.emit('audiodata', imgBase64);
  });

  socket.on("leaveChat", function(data){

      var senderID = data.senderid;
      var username = data.username;

      for(var i = 0; i < user_array.length; i++) {
        if(user_array[i].userid == senderID) {
            user_array.splice(i, 1);
            break;
        }
      }
      console.log(username + " has left the conversation, " + user_array.length + " remain.");
      var leaveMessage = username + " has left the conversation.";
      var chatMessage = {
        message: leaveMessage,
        messageID: senderID,
        senderID: senderID,
        senderName: username,
        messageType: "update"
      };
      try {
        translateAndSendMessage(chatMessage);
      } catch(err) {
        console.error('caught while emitting:', err.message);
      }

  });

  async function translateAndSendMessage(chatMessage){

    for(var i=0; i<user_array.length; i++){

      var currentUser = user_array[i];

      if(chatMessage.senderID!=currentUser.userid){
        var currentUser = user_array[i];
        var ttsLanguageCode = currentUser.ttsLanguageCode; //en-EN-standard-B
        var translateLanguageCode = ttsLanguageCode.substring(0, 2); //en
        var sttLanguageCode = ttsLanguageCode.substring(0, 5); //en-US

        console.log('translating into: ' + ttsLanguageCode + "for: " + currentUser.username);

        var target = translateLanguageCode;
        var text = chatMessage.message;
        let [translations] = await translate.translate(text, target);
        translations = Array.isArray(translations) ? translations : [translations];
        var translation_concatenated = "";
        translations.forEach((translation, i) => {
          translation_concatenated += translation + " ";
        });
        chatMessage.message = translation_concatenated;

        if(chatMessage.messageType!="update"){

          var ttsRequest = {
            voice: {languageCode: ttsLanguageCode, ssmlGender: 'NEUTRAL'},
            audioConfig: {audioEncoding: 'MP3'},
            input: {text: translation_concatenated}
          };

          ttsWriteAudio(ttsRequest, chatMessage, currentUser);
        }
        else {
          sendTranslatedText(chatMessage, currentUser);
        }
      }
      else {
        sendTranslatedText(chatMessage, currentUser);
      }
    }
  }

  async function ttsWriteAudio(request, chatMessage, currentUser){

      const [response] = await ttsClient.synthesizeSpeech(request);
      const writeFile = util.promisify(fs.writeFile);
      await writeFile('audio/' + chatMessage.messageID + '_' + currentUser.userid + '.mp3', response.audioContent, 'binary');
      console.log('Audio content written to file: ' + chatMessage.messageID + '_' + currentUser.userid + '.mp3');
      sendTranslatedText(chatMessage, currentUser);
  }

  function sendTranslatedText(chatMessage, currentUser) {
    var messageObject = {
      receiverid: currentUser.userid,
      senderid: chatMessage.senderID,
      sendername: chatMessage.senderName,
      message: chatMessage.message,
      messageid: chatMessage.messageID,
      users: user_array,
      messagetype: chatMessage.messageType
    };
    //console.log("current USER: " + JSON.stringify(currentUser, null, 4));
    if(socket.id==currentUser.userid){
      socket.emit("receiveMessage", messageObject);
    }
    else {
      socket.broadcast.to(currentUser.userid).emit('receiveMessage', messageObject);
    }

  //  socket.broadcast.to(currentUser.userid).emit('receiveMessage', messageObject);
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

    recognizeStream = speechClient
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
          var transcriptObject = {
            transcript: data.results[0].alternatives[0].transcript,
            isfinal: data.results[0].isFinal
          };
          socket.emit("getTranscript", transcriptObject);
        }
      });
      socket.emit("getTranscript",
        { isstatus: "Streaming server successfully started" }
      );

      restartTimeoutId = setTimeout(restartStreaming, STREAMING_LIMIT);
  }

  function stopStreaming(){
    recognizeStream = null;
  }

  function restartStreaming(){
    stopStreaming();
    startStreaming();
  }
});

function getServer() {
  console.log("Conversation Translation Server Started");
  return server;
}

if (require.main === module) {
  var server = getServer();
}

exports.getServer = getServer;
