const CACHE_NAME = 'ai-chat-v8-local-provider-proxy';

const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

const LOCAL_PROVIDER_PATCH = `
/* WordLens Local Provider 3 patch. */
(() => {
  const defaults = {
    llmBase: '/local-api',
    llmModel: 'Hy-MT2-1.8B-2Bit',
    ttsBase: '/local-api',
    ttsApiKey: '123',
    ttsVoice: 'expr-voice-4-m'
  };

  const getCfg = (key) => localStorage.getItem(key) || defaults[key];
  const setCfg = (key, value) => localStorage.setItem(key, (value ?? '').toString().trim());
  const provider3Enabled = (app) => app && app.chatProvider === 'openrouter';
  const tts3Enabled = (app) => app && app.ttsProvider === 'elevenlabs';

  const localCompletion = async (messages, extra = {}) => {
    const base = getCfg('llmBase').replace(/\\/$/, '');
    const model = getCfg('llmModel') || defaults.llmModel;
    const response = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ model, messages }, extra))
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('Local Provider 3 API Error: ' + response.status + ', ' + errorText);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const localTTS = async (text) => {
    const base = getCfg('ttsBase').replace(/\\/$/, '');
    const response = await fetch(base + '/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (getCfg('ttsApiKey') || defaults.ttsApiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'kitten-tts-mini-0.8',
        input: text,
        voice: getCfg('ttsVoice') || defaults.ttsVoice,
        response_format: 'wav'
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('Local TTS API Error: ' + response.status + ', ' + errorText);
    }
    return await response.blob();
  };

  const getHistory = (app) => {
    const chat = app.chats.find(c => c.id === app.currentChatId);
    if (!chat) throw new Error('Chat not found');
    return chat.messages
      .filter(msg => msg.role !== 'system')
      .slice(-10)
      .map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content }));
  };

  const normalizeDictionaryResult = (rawText) => {
    const tryParse = (value) => {
      if (!value) return null;
      const fence = String.fromCharCode(96);
      const normalized = value.toString().trim()
        .replace(/^\\uFEFF/, '')
        .replace(new RegExp('^' + fence + '{3}(?:json)?\\\\s*', 'i'), '')
        .replace(new RegExp('\\\\s*' + fence + '{3}$', 'i'), '')
        .replace(/,(\\s*[}\\]])/g, '$1');
      try { return JSON.parse(normalized); } catch (_) { return null; }
    };
    const extract = (value) => {
      if (!value) return null;
      const start = value.indexOf('{');
      const end = value.lastIndexOf('}');
      return (start >= 0 && end > start) ? value.slice(start, end + 1) : null;
    };
    const hasArabic = (s) => /[\\u0600-\\u06FF]/.test(s);
    const normalizeList = (value) => {
      const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,\\n]/g) : []);
      return list.map(v => (v ?? '').toString().trim())
        .filter(Boolean)
        .map(v => v.replace(/^["'\\s]+|["'\\s]+$/g, ''))
        .filter(v => /[A-Za-z]/.test(v) && !hasArabic(v));
    };
    const parsed = tryParse(rawText) || tryParse(extract(rawText));
    if (!parsed || !Array.isArray(parsed.meanings)) return null;
    const meanings = parsed.meanings
      .map(m => ({ text: (m?.text ?? '').toString().trim(), type: (m?.type ?? '').toString().trim() }))
      .filter(m => m.text);
    if (!meanings.length) return null;
    return { meanings, synonyms: normalizeList(parsed.synonyms), antonyms: normalizeList(parsed.antonyms) };
  };

  const saveLocalSettings = () => {
    const fields = {
      llmBase: document.getElementById('local-llm-base-url'),
      llmModel: document.getElementById('local-llm-model'),
      ttsBase: document.getElementById('local-tts-base-url'),
      ttsApiKey: document.getElementById('local-tts-api-key'),
      ttsVoice: document.getElementById('local-tts-voice')
    };
    Object.entries(fields).forEach(([key, element]) => { if (element) setCfg(key, element.value); });
  };

  if (typeof AIChatApp !== 'undefined') {
    const originalShowSettings = AIChatApp.prototype.showSettingsModal;
    AIChatApp.prototype.showSettingsModal = function() {
      originalShowSettings.call(this);
      const fill = (id, key) => { const el = document.getElementById(id); if (el) el.value = getCfg(key); };
      fill('local-llm-base-url', 'llmBase');
      fill('local-llm-model', 'llmModel');
      fill('local-tts-base-url', 'ttsBase');
      fill('local-tts-api-key', 'ttsApiKey');
      fill('local-tts-voice', 'ttsVoice');
    };

    const originalSaveSettings = AIChatApp.prototype.saveSettings;
    AIChatApp.prototype.saveSettings = function() {
      saveLocalSettings();
      originalSaveSettings.call(this);
    };

    AIChatApp.prototype.callOpenRouterChatAPI = async function(message) {
      if (!provider3Enabled(this)) throw new Error('Provider 3 is not selected.');
      const history = getHistory(this);
      const content = await localCompletion(history.concat([{ role: 'user', content: message }]));
      if (!content) throw new Error('Local Provider 3 returned an empty response.');
      return content;
    };

    AIChatApp.prototype.translateText = async function(text) {
      if (this.chatProvider === 'avalai' && this.AVALAI_API_KEY) return this.translateTextAvalai(text);
      if (this.chatProvider === 'openrouter') return this.translateTextOpenRouter(text);
      return this.translateTextGemini(text);
    };

    AIChatApp.prototype.translateTextOpenRouter = async function(text) {
      const prompt = 'Translate this text to Persian/Farsi. Provide only the translation without any additional explanation: "' + text + '"';
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

      const prompt = 'You are an expert English-Persian dictionary. Analyze the word "' + word + '" comprehensively.\\n' +
        'Return ONLY valid JSON with this exact structure:\\n' +
        '{"meanings":[{"text":"Persian meaning","type":"Persian part of speech"}],"synonyms":["English word"],"antonyms":["English word"]}\\n' +
        'Requirements: meanings in Persian/Farsi; synonyms and antonyms in English only; no markdown; provide several common meanings and useful synonyms/antonyms.';

      try {
        const raw = await localCompletion([{ role: 'user', content: prompt }], { temperature: 0.2 });
        const result = normalizeDictionaryResult(raw);
        if (!result) return { meanings: [{ text: 'Failed to parse local model response.', type: 'Error' }], synonyms: [], antonyms: [] };
        await this.db.set('word_meanings', { word: lowerWord, value: result }).catch(() => {});
        return result;
      } catch (error) {
        console.error('Local Provider 3 dictionary error:', error);
        return { meanings: [{ text: 'Local Provider 3 error: ' + error.message, type: 'Error' }], synonyms: [], antonyms: [] };
      }
    };

    const originalPlayTextToSpeech = AIChatApp.prototype.playTextToSpeech;
    AIChatApp.prototype.playTextToSpeech = async function(text, button, progressBar, messageId) {
      if (!tts3Enabled(this)) return originalPlayTextToSpeech.call(this, text, button, progressBar, messageId);
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        return;
      }
      try {
        const cachedAudio = await this.db.get('audio_cache', text);
        if (cachedAudio && cachedAudio.value) {
          await this.playAudio(cachedAudio.value, button, progressBar);
          return;
        }
      } catch (error) {
        console.error('Local TTS cache error:', error);
      }
      if (button) {
        button.disabled = true;
        button.classList.add('playing');
      }
      try {
        const audioBlob = await localTTS(text);
        await this.playAudio(audioBlob, button, progressBar);
        await this.db.set('audio_cache', { text: text, value: audioBlob }).catch(() => {});
      } catch (error) {
        if (button) {
          button.classList.remove('playing');
          button.disabled = false;
        }
        if (progressBar) this.updateProgress(progressBar, 0);
        this.showToast('Failed to generate speech with Local Provider 3: ' + error.message, 'error');
      }
    };
  }

  if (typeof AdvancedTTSPlayer !== 'undefined') {
    const originalGenerateFullAudio = AdvancedTTSPlayer.prototype.generateFullAudio;
    AdvancedTTSPlayer.prototype.generateFullAudio = async function(text) {
      if (!tts3Enabled(this.app)) return originalGenerateFullAudio.call(this, text);
      try {
        const cacheKey = 'full_' + text;
        const cachedAudio = await this.app.db.get('audio_cache', cacheKey);
        if (cachedAudio && cachedAudio.value) return cachedAudio.value;
        const audioBlob = await localTTS(text);
        if (audioBlob) await this.app.db.set('audio_cache', { text: cacheKey, value: audioBlob }).catch(() => {});
        return audioBlob;
      } catch (error) {
        console.error('Local Provider 3 advanced TTS error:', error);
        return null;
      }
    };

    AdvancedTTSPlayer.prototype.generateElevenLabsTTS = async function(text) {
      return await localTTS(text);
    };
  }

  window.addEventListener('DOMContentLoaded', () => {
    const chatOption = document.querySelector('#chat-provider-select option[value="openrouter"]');
    if (chatOption) chatOption.textContent = 'Provider 3 — Local LLM';
    const ttsOption = document.querySelector('#tts-provider-select option[value="elevenlabs"]');
    if (ttsOption) ttsOption.textContent = 'Provider 3 — Local TTS';

    const testButton = document.getElementById('local-provider-test');
    const status = document.getElementById('local-provider-status');
    if (testButton) {
      testButton.addEventListener('click', async () => {
        if (status) status.textContent = 'Testing...';
        try {
          const health = await fetch('/local-api/health', { cache: 'no-store' });
          const data = await health.json();
          if (!health.ok || data.status !== 'ok') throw new Error(data.message || 'Local services are unavailable.');
          if (status) status.textContent = 'OK — Local LLM and TTS are reachable.';
        } catch (error) {
          if (status) status.textContent = 'Error: ' + error.message;
        }
      });
    }
  }, { once: true });
})();
`;

const LOCAL_SETTINGS_HTML = `
<div class="setting-section" id="local-provider-settings">
  <p><b>Provider 3 — Local</b></p>
  <small style="color:#666;display:block;margin-bottom:8px;">LLM and TTS run locally. No OpenRouter or ElevenLabs key is used for Provider 3.</small>
  <label style="display:block;margin:6px 0 4px;">Local LLM Base URL</label>
  <input type="text" id="local-llm-base-url" placeholder="/local-api" value="/local-api">
  <label style="display:block;margin:8px 0 4px;">Local LLM Model</label>
  <input type="text" id="local-llm-model" placeholder="Hy-MT2-1.8B-2Bit" value="Hy-MT2-1.8B-2Bit">
  <label style="display:block;margin:8px 0 4px;">Local TTS Base URL</label>
  <input type="text" id="local-tts-base-url" placeholder="/local-api" value="/local-api">
  <label style="display:block;margin:8px 0 4px;">Local TTS API Key</label>
  <input type="password" id="local-tts-api-key" placeholder="123" value="123">
  <label style="display:block;margin:8px 0 4px;">Local TTS Voice</label>
  <input type="text" id="local-tts-voice" placeholder="expr-voice-4-m" value="expr-voice-4-m">
  <button type="button" id="local-provider-test" class="btn-secondary" style="margin-top:10px;">Test Local LLM + TTS</button>
  <div id="local-provider-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
</div>`;

function injectLocalSettings(html) {
  if (html.includes('id="local-provider-settings"')) return html;
  const marker = '<div class="setting-section">\\n          <p>Text-to-Speech Provider:</p>';
  return html.replace(marker, LOCAL_SETTINGS_HTML + '\\n        ' + marker);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith((async () => {
      const response = await fetch(event.request, { cache: 'no-store' });
      const text = await response.text();
      return new Response(injectLocalSettings(text), {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers)
      });
    })());
    return;
  }

  if (event.request.method === 'GET' && url.pathname === '/app.js') {
    event.respondWith((async () => {
      const response = await fetch(event.request, { cache: 'no-store' });
      const source = await response.text();
      const patched = source + '\\n\\n' + LOCAL_PROVIDER_PATCH + '\\n';
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers({
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store'
        })
      });
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return fetch(event.request);
  })());
});
