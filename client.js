window.onload = function(){

  var messageInput = document.getElementById('message-input');
  var messageSend = document.getElementById('message-send');
  var messageHistory = document.getElementById('message-history');
  var usernameInput = document.getElementById('username-input');
  var joinButton = document.getElementById('join-btn');
  var joinDiv = document.getElementById('join-div');
  var chatDiv = document.getElementById('chat-div');
  var usernameList = document.getElementById('username-list');
  var startStreamingButton = document.getElementById('start-streaming');
  var microphoneIcon = document.getElementById('microphone-icon');
  var voiceListSelect = document.getElementById("voice-list-select-div");
  var joinBottomDiv = document.getElementById("join-bottom-div");

  var languageName = '';
  var joinBool = true;
  var audioObject = {};
  var lotsOfListeners = {};
  var mySTTLang = '';

  var socket = io("http://localhost:8082");

  chatDiv.style.visibility = "hidden";
  joinDiv.style.visibility = "visible";
  joinBottomDiv.style.visibility = "hidden";

  var receiverID = '';
  var usernames = [];
  var myUsername = '';
  //var langCode = "en-US";
  var recordingStatus = false;
  var AudioContext; // = window.AudioContext || window.webkitAudioContext;
  var context;

  const { JoinChatRequest,
          JoinChatResponse,
          SendMessageRequest,
          SendMessageResponse,
          LeaveChatRequest,
          LeaveChatResponse,
          AudioStreamRequest,
          AudioStreamResponse,
          PlayAudioFileRequest,
          PlayAudioFileResponse,
          StopStreamRequest,
          StopStreamResponse,
          VoiceListRequest,
          VoiceListResponse
        } = require('./conversation_translation_pb.js');

  const {TranslateChatClient} = require('./conversation_translation_grpc_web_pb.js');

  var client = new TranslateChatClient('http://' + window.location.hostname + ':8080', null, null);

  var voiceListRequest = new VoiceListRequest();
  voiceListRequest.setLoaded(true);

  client.getVoiceList(voiceListRequest, {}, (err, response) => {
    
    var voicelist = JSON.parse(response.getVoicelist());

    var voiceListOptions = '';

    for (var i=0; i<voicelist.length; i++) {

      var voice = voicelist[i];

      languageName = voice.languageCodes;

      languageName = convertLanguageCodes(voice.languageCodes[0]);

      var selected = '';
      if (voice.name=="en-US-Wavenet-C") {
        selected = ' selected';
      }

      voiceListOptions += '<option value=' + voice.name + selected + '>' + languageName + ': ' + voice.name + ' (' + voice.ssmlGender + ')</option>';

    }
    voiceListSelect.innerHTML = '<select class="shadow-sm form-control" id="LanguageVoiceSelect">' + voiceListOptions + '</select>';
    joinBottomDiv.style.visibility = "visible";
  });

  joinButton.onclick = function(){

    //context = new AudioContext();
    myUsername = usernameInput.value;
    var languageVoiceSelect = document.getElementById('LanguageVoiceSelect');

    var translateLang = languageVoiceSelect.value;
    mySTTLang = translateLang.substring(0, 5);
    var myLanguageName = convertLanguageCodes(translateLang.substring(0, 5));

    if(myUsername&&translateLang){

      var joinChatRequest = new JoinChatRequest();

      joinChatRequest.setUsername(myUsername);
      joinChatRequest.setTranslatelanguagecode(translateLang);
      joinChatRequest.setLanguagename(myLanguageName);


      var chatStream = client.joinChat(joinChatRequest, {});

      joinDiv.innerHTML = "";
      chatDiv.style.visibility = "visible";
      joinBool = false;

      chatStream.on('data', (response) => {

        receiverID = response.getReceiverid();
        senderID = response.getSenderid();
        var senderName = response.getSendername();
        var messageType = response.getMessagetype();
        var newMessage = response.getMessage();
        var newMessageID = response.getMessageid();
        var messageAudio = newMessageID + '_' + receiverID + '.mp3';

        usernames = response.getUsersList();

        var formattedMessage = "";
        if(messageType==="update"){
          messageHistory.innerHTML = '<div class="update_chat rotate"><p class="update_chat">' + newMessage + '</p></div>' + messageHistory.innerHTML;
        }
        else if(messageType=="error"){
          messageHistory.innerHTML = '<div class="update_chat danger rotate"><p class="update_chat">ERROR: ' + newMessage + '</p></div>' + messageHistory.innerHTML;
        }
        else if(receiverID===senderID){
          messageHistory.innerHTML = '<div class="outgoing_msg rotate"><div class="sent_msg"><p>' + newMessage + '</p></div><div></div></div>' + messageHistory.innerHTML;
        }
        else {
          messageHistory.innerHTML = '<div class="incoming_msg rotate"><div class="received_msg"><div class="received_withd_msg"><p><b>' + senderName + ':</b> ' + newMessage + '</p></div></div></div>' + messageHistory.innerHTML;
          createEventListener(newMessageID, messageAudio);
        }

        messageInput.value = "";
        usernameList.innerHTML = "";

        for (var i=0; i< usernames.length; i++){
          var user = usernames[i];
          var activeChatDiv = '<div class="chat_list">';
          if(senderID===user.getUserid()){
            	activeChatDiv = '<div class="chat_list active_chat">';
          }
          usernameList.innerHTML += activeChatDiv + '<div class="chat_people"><div class="chat_ib"><h5>' + user.getUsername() + '</h5><p>' + user.getLanguagename() + '</div></div></div>';
        }

      });
    }
    else {
      alert("Incomplete Join Information, please enter username and select all three language codes!");
    }
  }

  addEventListener("keyup", function(event) {
    if (event.keyCode === 13) {
      if (joinBool) {
        joinButton.click();
      }
      else {
      //  messageSend.click();
      }
    }
  });


  messageSend.onclick = function() {
    if(messageInput.value){
      var request = new SendMessageRequest();
      request.setMessage(messageInput.value);
      request.setSenderid(receiverID);
      request.setSendername(myUsername);

      client.sendMessage(request, {}, (err, response) => {

      });
      concatText = '';
      newText = '';
      messageInput.value = '';
      //if (recordingStatus) { stopStreaming(); }
    }
    else {
      alert("no message input");
    }
  }
  startStreamingButton.onclick = function() {
    if(!recordingStatus){
      startStreaming();
    }
    else {
      stopStreaming();
    }
  }
  let bufferSize = 2048,
  	processor,
  	input,
  	globalStream;

  let	streamStreaming = false;
  var concatText = '';
  var newText = '';

  const constraints = {
  	audio: true,
  	video: false
  };

  function initRecording() {
  	streamStreaming = true;

    AudioContext = window.AudioContext || window.webkitAudioContext;
    context = new AudioContext();

    var request = new AudioStreamRequest();

    request.setStart(true);
    request.setSttlanguagecode(mySTTLang);

    var stream = client.transcribeAudioStream(request, {});
    messageInput.value = "";
    concatText = "";
    newText = "";
    stream.on('data', (response) => {
      newText = response.getTranscript();
      messageInput.value = concatText + newText;
      if (response.getIsfinal()){
        messageSend.click();
        concatText += " " + newText;
      }
      newText = '';
    });

  	processor = context.createScriptProcessor(bufferSize, 1, 1);
  	processor.connect(context.destination);
  	context.resume();

  	var handleSuccess = function (stream) {
  		globalStream = stream;
  		input = context.createMediaStreamSource(stream);
  		input.connect(processor);

  		processor.onaudioprocess = function (e) {
  			microphoneProcess(e);
  		};
  	};

  	navigator.mediaDevices.getUserMedia(constraints)
  		.then(handleSuccess);
  }

  function microphoneProcess(e) {
  	var left = e.inputBuffer.getChannelData(0);
  	var left16 = downsampleBuffer(left, 44100, 16000);
  	socket.emit('binaryStream', left16);
  }

  function startStreaming() {
    recordingStatus = true;
    microphoneIcon.setAttribute("class", "icon-flash");
    microphoneIcon.style.color = "LimeGreen";
    messageInput.innerHTML = "";
  	initRecording();
  }

  function stopStreaming() {
  	streamStreaming = false;
    recordingStatus = false;
    microphoneIcon.removeAttribute("class", "icon-flash");
    microphoneIcon.style.color = "DodgerBlue";

  	let track = globalStream.getTracks()[0];
  	track.stop();
    if(input){
      input.disconnect(processor);
    	processor.disconnect(context.destination);
    	context.close().then(function () {
    		input = null;
    		processor = null;
    		context = null;
    		AudioContext = null;
    	});
    }
    var request = new StopStreamRequest();

    request.setStop(true);

    client.stopAudioStream(request, {}, (err, response) => {

    });
  }
  var downsampleBuffer = function (buffer, sampleRate, outSampleRate) {
      if (outSampleRate == sampleRate) {
          return buffer;
      }
      if (outSampleRate > sampleRate) {
          throw "downsampling rate show be smaller than original sample rate";
      }
      var sampleRateRatio = sampleRate / outSampleRate;
      var newLength = Math.round(buffer.length / sampleRateRatio);
      var result = new Int16Array(newLength);
      var offsetResult = 0;
      var offsetBuffer = 0;
      while (offsetResult < result.length) {
          var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
          var accum = 0, count = 0;
          for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
              accum += buffer[i];
              count++;
          }

          result[offsetResult] = Math.min(1, accum / count)*0x7FFF;
          offsetResult++;
          offsetBuffer = nextOffsetBuffer;
      }
      return result.buffer;
  }
  function createEventListener (newMessageID, audioName) {
    //const element = document.querySelector(`[data-id="${ audioName }"]`)
    var source = null;
    var audioBuffer = null;
    if (context) {
      context.close().then(function () {
        //input = null;
        //processor = null;
        //context = null;
        //AudioContext = null;
      });
    }

    AudioContext = window.AudioContext || window.webkitAudioContext;
    context = new AudioContext();

    var playAudioRequest = new PlayAudioFileRequest();
    playAudioRequest.setAudiofilename(audioName);
    var playStream = client.playAudioFile(playAudioRequest, {});

    var base64_mp3 = '';

    playStream.on('data', (response) => {

      base64_mp3 += response.getAudiodata_asB64();

    });
    playStream.on('status', function(status) {
      if (status.code===0){
        playAudioBuffer(base64_mp3);
      }
    });
  }
  function playAudioBuffer(base64_mp3){
    var audioFromString = base64ToBuffer(base64_mp3);


    context.decodeAudioData(audioFromString, function (buffer) {
        audioBuffer = buffer;
        source = context.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = false;
        source.connect(context.destination);
        source.start(0); // Play immediately.
    }, function (e) {
        console.log('Error decoding file', e);
    });

  }
  var base64ToBuffer = function (buffer) {
    var binary = window.atob(buffer);
    var buffer = new ArrayBuffer(binary.length);
    var bytes = new Uint8Array(buffer);
    for (var i = 0; i < buffer.byteLength; i++) {
        bytes[i] = binary.charCodeAt(i) & 0xFF;
    }
    return buffer;
  };
  window.addEventListener('beforeunload', function(event) {
    if (streamStreaming) {
      stopStreaming();
    }
    var request = new LeaveChatRequest();
    request.setSenderid(receiverID);
    request.setUsername(myUsername);
    client.leaveChat(request, {}, (err, response) => {
    });
  });
};

function convertLanguageCodes(languageCode) {
  var languageName;
  switch (languageCode) {
    case 'da-DK':
      languageName = "Danish";
      break;
    case 'de-DE':
      languageName = "German";
      break;
    case 'en-AU':
      languageName = "English (Australia)"
      break;
    case 'en-GB':
      languageName = "English (United Kingdom)"
      break;
    case 'en-US':
      languageName = "English (United States)";
      break;
    case 'es-ES':
      languageName = "Spanish";
      break;
    case 'fr-CA':
      languageName = "French (Canada)";
      break;
    case 'fr-FR':
      languageName = "French";
      break;
    case 'it-IT':
      languageName = "Italian"
      break;
    case 'ja-JP':
      languageName = "Japanese"
      break;
    case 'ko-KR':
      languageName = "Korean";
      break;
    case 'nl-NL':
      languageName = "Dutch"
      break;
    case 'pl-PL':
      languageName = "Polish";
      break;
    case 'pt-BR':
      languageName = "Portugese (Brazil)";
      break;
    case 'pt-PT':
      languageName = "Portugese"
      break;
    case 'ru-RU':
      languageName = "Russian";
      break;
    case 'sk-SK':
      languageName = "Slovak (Slovakia)";
      break;
    case 'sv-SE':
      languageName = "Swedish";
      break;
    case 'tr-TR':
      languageName = "Turkish"
      break;
    case 'uk-UA':
      languageName = "Ukrainian (Ukraine)"
      break;
    default:
      languageName = languageCode;
  }
  return languageName;
}
