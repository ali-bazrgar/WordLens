/* WordLens Local Provider 3 runtime. Loaded by server.py by appending this file to app.js. */
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    llmBase: '/local-api',
    llmModel: 'Hy-MT2-1.8B-2Bit',
    llmApiKey: '',
    ttsBase: '/local-api',
    ttsApiKey: '123',
    ttsModel: 'kitten-tts-mini-0.8',
    ttsVoice: 'expr-voice-4-m',
    ttsFormat: 'wav',
    sttProvider: 'openai-compatible',
    sttBase: '/local-api',
    sttApiKey: '',
    sttModel: 'whisper-1',
    sttLanguage: 'en'
  });

  const getCfg = (key) => {
    const stored = localStorage.getItem('wordlens_local_' + key);
    if (stored !== null) return stored.toString().trim();
    if (key === 'sttProvider' && localStorage.getItem('avalai_api_key')) return 'avalai';
    return (DEFAULTS[key] ?? '').toString().trim();
  };

  const setCfg = (key, value) => {
    localStorage.setItem('wordlens_local_' + key, (value ?? '').toString().trim());
  };

  const normalizeBase = (value) => (value || '').trim().replace(/\/+$/, '');


  const localCompletion = async (messages, extra = {}) => {
    const base = normalizeBase(getCfg('llmBase')) || DEFAULTS.llmBase;
    const model = getCfg('llmModel') || DEFAULTS.llmModel;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const apiKey = getCfg('llmApiKey');
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const response = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, messages, ...extra }) });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('OpenAI-compatible LLM API error: ' + response.status + ', ' + errorText);
    }
    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent)
      ? rawContent.map(part => typeof part === 'string' ? part : (part?.text || '')).join('') : '';
    if (!content.trim()) throw new Error('OpenAI-compatible LLM returned an empty response.');
    return content;
  };

  const localTTS = async (text) => {
    const base = normalizeBase(getCfg('ttsBase')) || DEFAULTS.ttsBase;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'audio/*, application/octet-stream' };
    const apiKey = getCfg('ttsApiKey');
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const response = await fetch(base + '/audio/speech', {
      method: 'POST', headers,
      body: JSON.stringify({ model: getCfg('ttsModel') || DEFAULTS.ttsModel, input: String(text ?? ''), voice: getCfg('ttsVoice') || DEFAULTS.ttsVoice, response_format: getCfg('ttsFormat') || DEFAULTS.ttsFormat })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('OpenAI-compatible TTS API error: ' + response.status + ', ' + errorText);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('OpenAI-compatible TTS returned an empty audio file.');
    return blob;
  };

  const localSTT = async (audioBlob, app) => {
    if (!(audioBlob instanceof Blob) || audioBlob.size === 0) throw new Error('No recorded audio was captured.');
    const provider = getCfg('sttProvider');
    const isAvalai = provider === 'avalai';
    const base = isAvalai ? 'https://api.avalai.ir/v1' : (normalizeBase(getCfg('sttBase')) || DEFAULTS.sttBase);
    const apiKey = isAvalai ? (app?.AVALAI_API_KEY || '') : getCfg('sttApiKey');
    if (isAvalai && !apiKey) throw new Error('Avalai STT is selected but its API key is not set in Settings.');
    const formData = new FormData();
    const mimeType = (audioBlob.type || '').toLowerCase();
    const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : (mimeType.includes('mp4') ? 'm4a' : 'webm');
    formData.append('file', audioBlob, 'recording.' + extension);
    formData.append('model', getCfg('sttModel') || 'whisper-1');
    const language = getCfg('sttLanguage');
    if (language && language.toLowerCase() !== 'auto') formData.append('language', language);
    formData.append('response_format', 'json');
    const headers = { 'Accept': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const response = await fetch(base + '/audio/transcriptions', { method: 'POST', headers, body: formData });
    if (!response.ok) { const errorText = await response.text(); throw new Error('OpenAI-compatible STT API error: ' + response.status + ', ' + errorText); }
    const data = await response.json();
    const transcript = typeof data?.text === 'string' ? data.text : typeof data?.transcription === 'string' ? data.transcription : typeof data?.result?.text === 'string' ? data.result.text : '';
    if (!transcript.trim()) throw new Error('STT API returned an empty transcript.');
    return transcript.trim();
  };

  const playLocalBlob = async (app, audioBlob, button, progressBar) => {
    if (!audioBlob || !audioBlob.size) throw new Error('Empty local audio blob.');

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    if (button) {
      button.disabled = true;
      button.classList.add('playing');
    }
    if (progressBar && app?.updateProgress) app.updateProgress(progressBar, 0);

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(audioUrl);
        if (button) {
          button.disabled = false;
          button.classList.remove('playing');
        }
      };

      audio.addEventListener('loadedmetadata', () => {
        if (progressBar && app?.updateProgress && Number.isFinite(audio.duration) && audio.duration > 0) {
          app.updateProgress(progressBar, 0);
        }
      }, { once: true });

      audio.addEventListener('timeupdate', () => {
        if (progressBar && app?.updateProgress && audio.duration > 0) {
          app.updateProgress(progressBar, (audio.currentTime / audio.duration) * 100);
        }
      });

      audio.addEventListener('ended', () => {
        cleanup();
        if (progressBar && app?.updateProgress) app.updateProgress(progressBar, 100);
        resolve();
      }, { once: true });

      audio.addEventListener('error', () => {
        const detail = audio.error ? `code=${audio.error.code}` : 'unknown audio error';
        cleanup();
        reject(new Error(`Browser could not play local WAV (${detail}).`));
      }, { once: true });

      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  };

  const injectLocalSettings = () => {
    const modal = document.getElementById('settings-modal');
    if (!modal || document.getElementById('local-provider-settings')) return;

    const scroll = modal.querySelector('.modal-scroll');
    if (!scroll) return;

    const section = document.createElement('div');
    section.className = 'setting-section';
    section.id = 'local-provider-settings';
    section.innerHTML = `
      <p><b>Provider 3 — OpenAI-compatible APIs</b></p>
      <small style="color:#666;display:block;margin-bottom:8px;">Configure LLM, TTS and STT endpoints. Use /local-api for the same-origin proxy, or a direct base URL ending in /v1.</small>
      <label style="display:block;margin:6px 0 4px;">LLM API Base URL</label>
      <input type="text" id="local-llm-base-url" placeholder="/local-api or http://127.0.0.1:8080/v1">
      <label style="display:block;margin:8px 0 4px;">LLM Model</label>
      <input type="text" id="local-llm-model" placeholder="Model ID from /v1/models">
      <label style="display:block;margin:8px 0 4px;">LLM API Key (optional)</label>
      <input type="password" id="local-llm-api-key" placeholder="Bearer token, if required">
      <label style="display:block;margin:8px 0 4px;">TTS API Base URL</label>
      <input type="text" id="local-tts-base-url" placeholder="/local-api or http://127.0.0.1:PORT/v1">
      <label style="display:block;margin:8px 0 4px;">TTS Model</label>
      <input type="text" id="local-tts-model" placeholder="kitten-tts-mini-0.8">
      <label style="display:block;margin:8px 0 4px;">TTS API Key (optional)</label>
      <input type="password" id="local-tts-api-key" placeholder="Bearer token, if required">
      <label style="display:block;margin:8px 0 4px;">TTS Voice</label>
      <input type="text" id="local-tts-voice" placeholder="expr-voice-4-m">
      <label style="display:block;margin:8px 0 4px;">TTS Response Format</label>
      <input type="text" id="local-tts-format" placeholder="wav">
      <label style="display:block;margin:8px 0 4px;">STT Provider</label>
      <select id="local-stt-provider" class="settings-select"><option value="openai-compatible">OpenAI-compatible STT (local)</option><option value="avalai">Avalai Whisper API</option></select>
      <label style="display:block;margin:8px 0 4px;">STT API Base URL</label>
      <input type="text" id="local-stt-base-url" placeholder="/local-api or http://127.0.0.1:PORT/v1">
      <small style="color:#666;display:block;margin-top:4px;">For /local-api, set WORDLENS_STT_BASE before starting server.py. Use the actual port of your STT service.</small>
      <label style="display:block;margin:8px 0 4px;">STT API Key (optional for local endpoints)</label>
      <input type="password" id="local-stt-api-key" placeholder="Bearer token, if required">
      <label style="display:block;margin:8px 0 4px;">STT Model</label>
      <input type="text" id="local-stt-model" placeholder="whisper-1">
      <label style="display:block;margin:8px 0 4px;">STT Language</label>
      <input type="text" id="local-stt-language" placeholder="en, fa, or auto">
      <button type="button" id="local-provider-test" class="btn-secondary" style="margin-top:10px;">Test Local LLM + TTS</button>
      <div id="local-provider-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    `;
    scroll.appendChild(section);

    document.getElementById('local-llm-base-url').value = getCfg('llmBase');
    document.getElementById('local-llm-model').value = getCfg('llmModel');
    document.getElementById('local-llm-api-key').value = getCfg('llmApiKey');
    document.getElementById('local-tts-base-url').value = getCfg('ttsBase');
    document.getElementById('local-tts-model').value = getCfg('ttsModel');
    document.getElementById('local-tts-api-key').value = getCfg('ttsApiKey');
    document.getElementById('local-tts-voice').value = getCfg('ttsVoice');
    document.getElementById('local-tts-format').value = getCfg('ttsFormat');
    document.getElementById('local-stt-provider').value = getCfg('sttProvider');
    document.getElementById('local-stt-base-url').value = getCfg('sttBase');
    document.getElementById('local-stt-api-key').value = getCfg('sttApiKey');
    document.getElementById('local-stt-model').value = getCfg('sttModel');
    document.getElementById('local-stt-language').value = getCfg('sttLanguage');

    document.getElementById('local-provider-test').addEventListener('click', async () => {
      const status = document.getElementById('local-provider-status');
      const fields = { llmBase: document.getElementById('local-llm-base-url'), llmModel: document.getElementById('local-llm-model'), llmApiKey: document.getElementById('local-llm-api-key'), ttsBase: document.getElementById('local-tts-base-url'), ttsModel: document.getElementById('local-tts-model'), ttsApiKey: document.getElementById('local-tts-api-key'), ttsVoice: document.getElementById('local-tts-voice'), ttsFormat: document.getElementById('local-tts-format'), sttProvider: document.getElementById('local-stt-provider'), sttBase: document.getElementById('local-stt-base-url'), sttApiKey: document.getElementById('local-stt-api-key'), sttModel: document.getElementById('local-stt-model'), sttLanguage: document.getElementById('local-stt-language') };
      Object.entries(fields).forEach(([key, element]) => { if (element) setCfg(key, element.value); });
      status.textContent = 'Testing configured OpenAI-compatible LLM and TTS endpoints…';
      try {
        const llmSample = await localCompletion([{ role: 'user', content: 'Reply with exactly OK.' }], { temperature: 0, max_tokens: 8 });
        const ttsSample = await localTTS('Hello, this is a local text to speech test.');
        if (!(ttsSample instanceof Blob) || ttsSample.size === 0) throw new Error('TTS synthesis returned no audio.');
        const sttHint = getCfg('sttProvider') === 'avalai' ? 'Avalai STT selected; it is tested when you record.' : 'STT is tested on the first recording.';
        status.textContent = 'OK — LLM replied “' + llmSample.slice(0,60) + '”; TTS returned ' + Math.round(ttsSample.size/1024) + ' KB audio. ' + sttHint;
      } catch (error) { status.textContent = 'Error: ' + error.message; console.error('Local Provider 3 test failed:', error); }
    });
  };

  if (typeof AIChatApp !== 'undefined') {
    const originalShowSettingsModal = AIChatApp.prototype.showSettingsModal;
    AIChatApp.prototype.showSettingsModal = function() {
      injectLocalSettings();
      const chatSelect = document.getElementById('chat-provider-select');
      const ttsSelect = document.getElementById('tts-provider-select');
      if (chatSelect) {
        const option = chatSelect.querySelector('option[value="openrouter"]');
        if (option) option.textContent = 'Provider 3 — Local LLM';
      }
      if (ttsSelect) {
        const option = ttsSelect.querySelector('option[value="elevenlabs"]');
        if (option) option.textContent = 'Provider 3 — Local TTS';
      }
      originalShowSettingsModal.call(this);
      injectLocalSettings();
    };

    const originalSaveSettings = AIChatApp.prototype.saveSettings;
    AIChatApp.prototype.saveSettings = function() {
      const fields = {
        llmBase: document.getElementById('local-llm-base-url'),
        llmModel: document.getElementById('local-llm-model'),
        llmApiKey: document.getElementById('local-llm-api-key'),
        ttsBase: document.getElementById('local-tts-base-url'),
        ttsModel: document.getElementById('local-tts-model'),
        ttsApiKey: document.getElementById('local-tts-api-key'),
        ttsVoice: document.getElementById('local-tts-voice'),
        ttsFormat: document.getElementById('local-tts-format'),
        sttProvider: document.getElementById('local-stt-provider'),
        sttBase: document.getElementById('local-stt-base-url'),
        sttApiKey: document.getElementById('local-stt-api-key'),
        sttModel: document.getElementById('local-stt-model'),
        sttLanguage: document.getElementById('local-stt-language')
      };
      Object.entries(fields).forEach(([key, element]) => {
        if (element) setCfg(key, element.value);
      });
      originalSaveSettings.call(this);
    };

    AIChatApp.prototype.callOpenRouterChatAPI = async function(message) {
      if (this.chatProvider !== 'openrouter') throw new Error('Provider 3 is not selected.');
      const chat = this.chats.find(c => c.id === this.currentChatId);
      if (!chat) throw new Error('Chat not found');
      const history = chat.messages
        .filter(msg => msg.role !== 'system')
        .slice(-10)
        .map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content }));
      return localCompletion(history.concat([{ role: 'user', content: message }]));
    };

    AIChatApp.prototype.translateTextOpenRouter = async function(text) {
      const prompt = `Translate this text to Persian/Farsi. Provide only the translation without any additional explanation: "${text}"`;
      try {
        return await localCompletion([{ role: 'user', content: prompt }], { temperature: 0.2 });
      } catch (error) {
        console.error('Local Provider 3 translation error:', error);
        return 'Translation failed';
      }
    };

    AIChatApp.prototype.getWordMeaningOpenRouter = async function(word) {
      const lowerWord = word.toLowerCase().trim();
      try {
        const cached = await this.db.get('word_meanings', lowerWord);
        if (cached) return cached.value;
      } catch (error) {
        console.error('Local dictionary cache error:', error);
      }
      const prompt = `You are an expert English-Persian dictionary. Analyze the word "${word}" comprehensively.\nReturn ONLY valid JSON with this exact structure:\n{"meanings":[{"text":"Persian meaning","type":"Persian part of speech"}],"synonyms":["English word"],"antonyms":["English word"]}\nRequirements: meanings in Persian/Farsi; synonyms and antonyms in English only; no markdown; provide several common meanings and useful synonyms/antonyms.`;
      try {
        const raw = await localCompletion([{ role: 'user', content: prompt }], { temperature: 0.2 });
        const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').replace(/,(\s*[}\]])/g, '$1');
        const parsed = JSON.parse(normalized);
        if (!Array.isArray(parsed.meanings)) throw new Error('Invalid dictionary JSON.');
        const result = {
          meanings: parsed.meanings.map(m => ({ text: String(m?.text ?? '').trim(), type: String(m?.type ?? '').trim() })).filter(m => m.text),
          synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms.map(String).filter(v => /[A-Za-z]/.test(v) && !/[\u0600-\u06FF]/.test(v)) : [],
          antonyms: Array.isArray(parsed.antonyms) ? parsed.antonyms.map(String).filter(v => /[A-Za-z]/.test(v) && !/[\u0600-\u06FF]/.test(v)) : []
        };
        if (!result.meanings.length) throw new Error('No meanings returned.');
        await this.db.set('word_meanings', { word: lowerWord, value: result }).catch(() => {});
        return result;
      } catch (error) {
        console.error('Local Provider 3 dictionary error:', error);
        return { meanings: [{ text: `Local Provider 3 error: ${error.message}`, type: 'Error' }], synonyms: [], antonyms: [] };
      }
    };

    // The original app only routes to ElevenLabs when an ElevenLabs API key
    // exists. Provider 3 Local must bypass that unrelated requirement.
    const originalPlayTextToSpeech = AIChatApp.prototype.playTextToSpeech;
    AIChatApp.prototype.playTextToSpeech = async function(text, button, progressBar, messageId) {
      if (this.ttsProvider === 'elevenlabs') {
        try {
          await this.playWithElevenLabsTTS(text, button, progressBar);
        } catch (error) {
          console.error('Local Provider 3 TTS routing error:', error);
          this.showToast(`Local TTS failed: ${error.message}`, 'error');
        }
        return;
      }
      return originalPlayTextToSpeech.call(this, text, button, progressBar, messageId);
    };

    AIChatApp.prototype.playWithElevenLabsTTS = async function(text, button, progressBar) {
      if (!button) return;
      button.disabled = true;
      button.classList.add('playing');
      if (progressBar) this.updateProgress(progressBar, 0);
      try {
        const audioBlob = await localTTS(text);
        await playLocalBlob(this, audioBlob, button, progressBar);
        await this.db.set('audio_cache', { text, value: audioBlob }).catch(() => {});
      } catch (error) {
        console.error('Local Provider 3 TTS Error:', error);
        button.classList.remove('playing');
        button.disabled = false;
        if (progressBar) this.updateProgress(progressBar, 0);
        this.showToast(`Failed to generate speech with Local Provider 3: ${error.message}`, 'error');
      }
    };
  }

  if (typeof AdvancedTTSPlayer !== 'undefined') {
    // Advanced player previously required an ElevenLabs API key before it
    // called generateElevenLabsTTS(). Replace that branch for local Provider 3.
    const originalAdvancedPlayTextToSpeech = AdvancedTTSPlayer.prototype.playTextToSpeech;
    if (typeof originalAdvancedPlayTextToSpeech === 'function') {
      AdvancedTTSPlayer.prototype.playTextToSpeech = async function(text, button, progressBar, messageId) {
        if (this.app?.ttsProvider === 'elevenlabs') {
          try {
            const audioBlob = await localTTS(text);
            await playLocalBlob(this.app, audioBlob, button, progressBar);
            await this.app.db.set('audio_cache', { text, value: audioBlob }).catch(() => {});
          } catch (error) {
            console.error('Local Provider 3 Advanced TTS Error:', error);
            if (button) {
              button.classList.remove('playing');
              button.disabled = false;
            }
            this.app.showToast(`Failed to generate speech with Local Provider 3: ${error.message}`, 'error');
          }
          return;
        }
        return originalAdvancedPlayTextToSpeech.call(this, text, button, progressBar, messageId);
      };
    }

    AdvancedTTSPlayer.prototype.generateElevenLabsTTS = async function(text) {
      return localTTS(text);
    };
  }

  const realtimeSetStatus = (app, message, state) => {
    const element = app?.realtimeStatus || document.getElementById('realtime-status');
    if (!element) return; element.textContent = message; element.dataset.state = state || 'idle'; element.classList.remove('hidden');
  };
  const makeRealtimeRecorder = stream => {
    const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus']; let selected = '';
    for (const type of types) { try { if (MediaRecorder.isTypeSupported(type)) { selected = type; break; } } catch (_) {} }
    return selected ? new MediaRecorder(stream,{mimeType:selected}) : new MediaRecorder(stream);
  };
  const playRealtimeAudio = async (blob, session) => {
    if (!blob || !blob.size) throw new Error('TTS returned an empty audio file.');
    const url=URL.createObjectURL(blob), audio=new Audio(url); session.audio=audio;
    try {
      const ended=new Promise((resolve,reject)=>{ let settled=false; const finish=error=>{ if(settled)return;settled=true;audio.removeEventListener('ended',onEnded);audio.removeEventListener('error',onError);session.audioStop=null;if(error)reject(error);else resolve(); };
        const onEnded=()=>finish(), onError=()=>finish(new Error('The browser could not play the TTS audio.')); session.audioStop=()=>finish();
        audio.addEventListener('ended',onEnded,{once:true});audio.addEventListener('error',onError,{once:true}); });
      await audio.play(); await ended;
    } finally { if(session.audio===audio)session.audio=null;if(session.audioStop)session.audioStop();URL.revokeObjectURL(url); }
  };

  if (typeof AIChatApp !== 'undefined') {
    ['callGeminiChatAPI','callAvalaiChatAPI','callOpenRouterChatAPI'].forEach(methodName=>{
      const originalMethod=AIChatApp.prototype[methodName]; if(typeof originalMethod!=='function')return;
      AIChatApp.prototype[methodName]=async function(message){
        const chat=this.chats?.find(item=>item.id===this.currentChatId), last=chat?.messages?.[chat.messages.length-1];
        const matches=!!(last&&last.role==='user'&&String(last.content??'')===String(message??'')); if(matches)chat.messages.pop();
        try{return await originalMethod.call(this,message);}finally{if(matches)chat.messages.push(last);}
      };
    });
    const originalTranscribeAudio=AIChatApp.prototype.transcribeAudio;
    AIChatApp.prototype.transcribeAudio=async function(audioBlob){
      if(getCfg('sttProvider')==='avalai')return originalTranscribeAudio.call(this,audioBlob);
      const previousPlaceholder=this.messageInput?.placeholder||'Type a message...';
      if(this.messageInput){this.messageInput.placeholder='Transcribing audio…';this.messageInput.disabled=true;}
      try{const transcript=await localSTT(audioBlob,this);if(this.messageInput){this.messageInput.value=transcript;this.adjustTextareaHeight();this.messageInput.focus();}}
      catch(error){console.error('OpenAI-compatible STT error:',error);this.showToast('Transcription failed: '+error.message,'error');}
      finally{if(this.messageInput){this.messageInput.placeholder=previousPlaceholder;this.messageInput.disabled=false;}}
    };
    const originalBindEvents=AIChatApp.prototype.bindEvents;
    AIChatApp.prototype.bindEvents=function(){originalBindEvents.call(this);this.realtimeBtn=document.getElementById('realtime-btn');this.realtimeStatus=document.getElementById('realtime-status');this.realtimeSession=null;this.realtimeStarting=false;
      this.realtimeBtn?.addEventListener('click',()=>{if(this.realtimeSession)this.stopRealtimeConversation();else this.startRealtimeConversation();});
    };
    AIChatApp.prototype.startRealtimeConversation=async function(){
      if(this.realtimeStarting||this.realtimeSession)return;
      if(!this.currentChatId){this.showToast('Open or create a chat before starting a live conversation.','warning');return;}
      if(this.isLoading){this.showToast('Wait for the current response to finish before starting live conversation.','warning');return;}
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){this.showToast('Microphone capture requires a supported browser over HTTPS or localhost.','error');return;}
      this.realtimeStarting=true;if(this.realtimeBtn)this.realtimeBtn.disabled=true;realtimeSetStatus(this,'Requesting microphone access…','processing');
      let stream=null,audioContext=null;
      try{
        stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
        const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Web Audio is not supported by this browser.');
        audioContext=new Context();await audioContext.resume();const analyser=audioContext.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0.15;
        const source=audioContext.createMediaStreamSource(stream);source.connect(analyser);
        const session={active:true,stream,audioContext,analyser,source,frameId:0,recorder:null,chunks:[],state:'listening',noiseFloor:0.002,threshold:0.012,speechStartedAt:0,lastVoiceAt:0,audio:null,audioStop:null};
        this.realtimeSession=session;
        if(this.realtimeBtn){this.realtimeBtn.disabled=false;this.realtimeBtn.classList.add('active');this.realtimeBtn.setAttribute('aria-pressed','true');this.realtimeBtn.title='Stop live conversation';this.realtimeBtn.setAttribute('aria-label','Stop live conversation');}
        if(this.voiceBtn)this.voiceBtn.disabled=true;realtimeSetStatus(this,'Listening — speak naturally, then pause briefly when you finish a turn.','listening');this.tickRealtimeConversation(session);
      }catch(error){console.error('Failed to start live conversation:',error);if(stream)stream.getTracks().forEach(track=>track.stop());if(audioContext&&audioContext.state!=='closed')audioContext.close().catch(()=>{});
        if(this.realtimeBtn)this.realtimeBtn.disabled=false;realtimeSetStatus(this,'Could not start microphone: '+error.message,'error');this.showToast('Live conversation could not start: '+error.message,'error');
      }finally{this.realtimeStarting=false;}
    };
    AIChatApp.prototype.stopRealtimeConversation=function(){
      const session=this.realtimeSession;if(!session)return;session.active=false;if(session.frameId)cancelAnimationFrame(session.frameId);
      if(session.recorder&&session.recorder.state!=='inactive'){try{session.recorder.stop();}catch(_){}}
      if(session.audio){try{session.audio.pause();session.audio.currentTime=0;}catch(_){}if(session.audioStop)session.audioStop();}
      if(session.stream)session.stream.getTracks().forEach(track=>track.stop());if(session.audioContext&&session.audioContext.state!=='closed')session.audioContext.close().catch(()=>{});
      this.realtimeSession=null;if(this.realtimeBtn){this.realtimeBtn.disabled=false;this.realtimeBtn.classList.remove('active');this.realtimeBtn.setAttribute('aria-pressed','false');this.realtimeBtn.title='Start live conversation';this.realtimeBtn.setAttribute('aria-label','Start live conversation');}
      if(this.voiceBtn)this.voiceBtn.disabled=false;realtimeSetStatus(this,'Live conversation stopped.','idle');
    };
    AIChatApp.prototype.tickRealtimeConversation=function(session){
      if(!session?.active||this.realtimeSession!==session)return;
      try{
        const samples=new Float32Array(session.analyser.fftSize);session.analyser.getFloatTimeDomainData(samples);let squares=0;
        for(let i=0;i<samples.length;i++)squares+=samples[i]*samples[i];const rms=Math.sqrt(squares/samples.length),now=performance.now();
        if(session.state==='listening'&&!this.isLoading){
          session.noiseFloor=rms<session.noiseFloor*3?session.noiseFloor*0.96+rms*0.04:session.noiseFloor;session.threshold=Math.max(0.012,session.noiseFloor*3.2);
          if(rms>session.threshold){
            try{
              const recorder=makeRealtimeRecorder(session.stream);session.recorder=recorder;session.chunks=[];session.speechStartedAt=now;session.lastVoiceAt=now;
              recorder.ondataavailable=event=>{if(event.data?.size)session.chunks.push(event.data);};
              recorder.onerror=event=>{console.error('Realtime recorder error:',event.error||event);realtimeSetStatus(this,'Microphone capture error. Stop and restart if it continues.','error');};
              recorder.onstop=()=>{const chunks=session.chunks.slice();session.chunks=[];if(session.recorder===recorder)session.recorder=null;if(!session.active)return;
                const blob=new Blob(chunks,{type:recorder.mimeType||chunks[0]?.type||'audio/webm'});if(!blob.size){session.state='listening';realtimeSetStatus(this,'No audio captured; listening again…','listening');return;}
                session.state='processing';this.processRealtimeAudio(blob,session);};
              recorder.start(250);session.state='recording';realtimeSetStatus(this,'Recording your turn… pause when you finish speaking.','recording');
            }catch(error){console.error('Could not start realtime audio segment:',error);realtimeSetStatus(this,'Microphone recording failed: '+error.message,'error');}
          }
        }else if(session.state==='recording'){
          if(rms>session.threshold)session.lastVoiceAt=now;const duration=now-session.speechStartedAt;
          if((duration>650&&now-session.lastVoiceAt>850)||duration>18000){session.state='processing';realtimeSetStatus(this,'Transcribing your turn…','processing');const recorder=session.recorder;if(recorder&&recorder.state!=='inactive')recorder.stop();}
        }
      }catch(error){console.error('Realtime voice activity detection error:',error);}
      if(session.active)session.frameId=requestAnimationFrame(()=>this.tickRealtimeConversation(session));
    };
    AIChatApp.prototype.processRealtimeAudio=async function(audioBlob,session){
      let failed=false;
      try{realtimeSetStatus(this,'Transcribing your turn…','processing');const transcript=await localSTT(audioBlob,this);if(!session.active||this.realtimeSession!==session||!transcript)return;await this.processRealtimeTurn(transcript,session);}
      catch(error){failed=true;console.error('Realtime STT/turn processing failed:',error);if(session.active){realtimeSetStatus(this,'Voice turn failed: '+error.message,'error');this.showToast('Live conversation error: '+error.message,'error');}}
      finally{if(session.active&&this.realtimeSession===session){session.state='listening';if(session.lastError){realtimeSetStatus(this,session.lastError,'error');session.lastError='';}else if(!failed)realtimeSetStatus(this,'Listening — speak when ready.','listening');}}
    };
    AIChatApp.prototype.processRealtimeTurn=async function(transcript,session){
      if(!this.currentChatId||!session.active||this.realtimeSession!==session||this.isLoading)return;
      this.addMessage('user',transcript);const loadingWrapper=document.createElement('div');loadingWrapper.className='message-wrapper ai';
      const loadingDiv=document.createElement('div');loadingDiv.className='message ai';loadingDiv.innerHTML='<div class="typing-indicator"><span></span><span></span><span></span></div>';
      loadingWrapper.appendChild(loadingDiv);this.messagesDiv.appendChild(loadingWrapper);this.scrollToBottom();this.isLoading=true;
      try{
        realtimeSetStatus(this,'Thinking…','processing');const answer=await this.callChatAPI(transcript);loadingWrapper.remove();this.addMessage('ai',answer);
        const chat=this.chats.find(item=>item.id===this.currentChatId);
        if(chat&&chat.messages.length===2&&!String(chat.title||'').includes('(Imported)')){chat.title=transcript.substring(0,30)+(transcript.length>30?'...':'');this.saveChats();this.renderChatList();this.chatTitle.textContent=chat.title;}
        if(session.active&&this.realtimeSession===session&&answer.trim()){realtimeSetStatus(this,'Speaking…','speaking');
          try{const audioBlob=await localTTS(answer);if(session.active&&this.realtimeSession===session)await playRealtimeAudio(audioBlob,session);}
          catch(ttsError){console.error('Realtime TTS error:',ttsError);session.lastError='Reply is in chat, but speech failed: '+ttsError.message;if(session.active){realtimeSetStatus(this,session.lastError,'error');this.showToast('Live TTS failed: '+ttsError.message,'error');}}
        }
      }catch(error){loadingWrapper.remove();console.error('Realtime LLM error:',error);this.addMessage('ai','Error: '+error.message);session.lastError='LLM error: '+error.message;if(session.active){realtimeSetStatus(this,session.lastError,'error');this.showToast(session.lastError,'error');}}
      finally{this.isLoading=false;}
    };
    const originalSendMessage=AIChatApp.prototype.sendMessage;
    AIChatApp.prototype.sendMessage=function(){if(this.realtimeSession)this.stopRealtimeConversation();return originalSendMessage.call(this);};
  }
  window.addEventListener('DOMContentLoaded', injectLocalSettings, { once: true });
})();
