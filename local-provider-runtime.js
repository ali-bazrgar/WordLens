/* WordLens Local Provider 3 runtime. Loaded by server.py by appending this file to app.js. */
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    llmBase: '/local-api',
    llmModel: 'Hy-MT2-1.8B-2Bit',
    ttsBase: '/local-api',
    ttsApiKey: '123',
    ttsVoice: 'expr-voice-4-m'
  });

  const getCfg = (key) => {
    const value = localStorage.getItem(`wordlens_local_${key}`);
    return (value ?? DEFAULTS[key] ?? '').toString().trim();
  };

  const setCfg = (key, value) => {
    localStorage.setItem(`wordlens_local_${key}`, (value ?? '').toString().trim());
  };

  const normalizeBase = (value) => (value || '').replace(/\/$/, '');

  const localCompletion = async (messages, extra = {}) => {
    const base = normalizeBase(getCfg('llmBase')) || DEFAULTS.llmBase;
    const model = getCfg('llmModel') || DEFAULTS.llmModel;
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, ...extra })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local Provider 3 API Error: ${response.status}, ${errorText}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Local Provider 3 returned an empty response.');
    return content;
  };

  const localTTS = async (text) => {
    const base = normalizeBase(getCfg('ttsBase')) || DEFAULTS.ttsBase;
    const response = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getCfg('ttsApiKey') || DEFAULTS.ttsApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'kitten-tts-mini-0.8',
        input: String(text ?? ''),
        voice: getCfg('ttsVoice') || DEFAULTS.ttsVoice,
        response_format: 'wav'
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local TTS API Error: ${response.status}, ${errorText}`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('Local TTS returned an empty audio file.');
    return blob;
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
      <p><b>Provider 3 — Local</b></p>
      <small style="color:#666;display:block;margin-bottom:8px;">Local LLM and TTS. No OpenRouter or ElevenLabs key is used.</small>
      <label style="display:block;margin:6px 0 4px;">Local LLM Base URL</label>
      <input type="text" id="local-llm-base-url" placeholder="/local-api">
      <label style="display:block;margin:8px 0 4px;">Local LLM Model</label>
      <input type="text" id="local-llm-model" placeholder="Hy-MT2-1.8B-2Bit">
      <label style="display:block;margin:8px 0 4px;">Local TTS Base URL</label>
      <input type="text" id="local-tts-base-url" placeholder="/local-api">
      <label style="display:block;margin:8px 0 4px;">Local TTS API Key</label>
      <input type="password" id="local-tts-api-key" placeholder="123">
      <label style="display:block;margin:8px 0 4px;">Local TTS Voice</label>
      <input type="text" id="local-tts-voice" placeholder="expr-voice-4-m">
      <button type="button" id="local-provider-test" class="btn-secondary" style="margin-top:10px;">Test Local LLM + TTS</button>
      <div id="local-provider-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    `;
    scroll.appendChild(section);

    document.getElementById('local-llm-base-url').value = getCfg('llmBase');
    document.getElementById('local-llm-model').value = getCfg('llmModel');
    document.getElementById('local-tts-base-url').value = getCfg('ttsBase');
    document.getElementById('local-tts-api-key').value = getCfg('ttsApiKey');
    document.getElementById('local-tts-voice').value = getCfg('ttsVoice');

    document.getElementById('local-provider-test').addEventListener('click', async () => {
      const status = document.getElementById('local-provider-status');
      status.textContent = 'Testing...';
      try {
        const llmResponse = await fetch(`${normalizeBase(getCfg('llmBase') || DEFAULTS.llmBase)}/models`, { cache: 'no-store' });
        if (!llmResponse.ok) throw new Error(`LLM endpoint returned ${llmResponse.status}`);
        const llmData = await llmResponse.json();
        if (!Array.isArray(llmData?.data)) throw new Error('Invalid LLM response.');

        const ttsResponse = await fetch(`${normalizeBase(getCfg('ttsBase') || DEFAULTS.ttsBase)}/health`, { cache: 'no-store' });
        if (!ttsResponse.ok) throw new Error(`TTS health returned ${ttsResponse.status}`);
        const ttsData = await ttsResponse.json();
        if (ttsData?.status !== 'ok' || ttsData?.model_loaded !== true) {
          throw new Error(ttsData?.load_error || 'TTS model is not loaded.');
        }

        // Test actual synthesis, not only /health.
        const sample = await localTTS('Hello, this is a local text to speech test.');
        if (!(sample instanceof Blob) || sample.size === 0) throw new Error('TTS synthesis returned no audio.');

        status.textContent = `OK — Local LLM and TTS synthesis are working (${Math.round(sample.size / 1024)} KB WAV).`;
      } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error('Local Provider 3 test failed:', error);
      }
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
        ttsBase: document.getElementById('local-tts-base-url'),
        ttsApiKey: document.getElementById('local-tts-api-key'),
        ttsVoice: document.getElementById('local-tts-voice')
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

  window.addEventListener('DOMContentLoaded', injectLocalSettings, { once: true });
})();
