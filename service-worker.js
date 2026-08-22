const CACHE_NAME = 'ai-chat-v5-local-provider-proxy';
const LOCAL_DEFAULTS = {
  llmBase: '/local-api',
  llmModel: 'Hy-MT2-1.8B-2Bit',
  ttsBase: '/local-api',
  ttsApiKey: '123',
  ttsVoice: 'expr-voice-4-m'
};

const STATIC_ASSETS = [
  '/',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

const LOCAL_PROVIDER_PATCH = `
/* WordLens Local Provider 3 patch.
 * Loaded after the original app.js so existing providers and data logic remain intact.
 */
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
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        ...extra
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local Provider 3 API Error: ${response.status}, ${errorText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const localTTS = async (text) => {
    const base = getCfg('ttsBase').replace(/\\/$/, '');
    const response = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getCfg('ttsApiKey') || defaults.ttsApiKey}`,
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
      throw new Error(`Local TTS API Error: ${response.status}, ${errorText}`);
    }
    return await response.blob();
  };

  const getHistory = (app) => {
    const chat = app.chats.find(c => c.id === app.currentChatId);
    if (!chat) throw new Error('Chat not found');
    return chat.messages
      .filter(msg => msg.role !== 'system')
      .slice(-10)
      .map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));
  };

  const normalizeDictionaryResult = (rawText) => {
    const tryParse = (value) => {
      if (!value) return null;
      const normalized = value.toString().trim()
        .replace(/^\\uFEFF/, '')
        .replace(/^```(?:json)?\\s*/i, '')
        .replace(/\\s*```\\s*$/i, '')
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
      const list = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/[,\\n]/g) : []);
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

    return {
      meanings,
      synonyms: normalizeList(parsed.synonyms),
      antonyms: normalizeList(parsed.antonyms)
    };
  };

  const saveLocalSettings = () => {
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
  };

  // Persist the current local-provider values while preserving the application's original settings logic.
  if (typeof AIChatApp !== 'undefined') {
    const originalShowSettings = AIChatApp.prototype.showSettingsModal;
    AIChatApp.prototype.showSettingsModal = function() {
      originalShowSettings.call(this);
      const setValue = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.value = getCfg(key);
      };
      setValue('local-llm-base-url', 'llmBase');
      setValue('local-llm-model', 'llmModel');
      setValue('local-tts-base-url', 'ttsBase');
      setValue('local-tts-api-key', 'ttsApiKey');
      setValue('local-tts-voice', 'ttsVoice');
    };

    const originalSaveSettings = AIChatApp.prototype.saveSettings;
    AIChatApp.prototype.saveSettings = function() {
      saveLocalSettings();
      originalSaveSettings.call(this);
      // Provider 3 is intentionally the local provider in this version.
      if (this.chatProvider === 'openrouter') {
        this.showToast('Provider 3: Local LLM settings saved.', 'success');
      }
      if (this.ttsProvider === 'elevenlabs') {
        this.showToast('Provider 3: Local TTS settings saved.', 'success');
      }
    };

    AIChatApp.prototype.callOpenRouterChatAPI = async function(message) {
      if (!provider3Enabled(this)) throw new Error('Provider 3 is not selected.');
      const history = getHistory(this);
      const content = await localCompletion([...history, { role: 'user', content: message }]);
      if (!content) throw new Error('Local Provider 3 returned an empty response.');
      return content;
    };

    AIChatApp.prototype.translateTextOpenRouter = async function(text) {
      if (!provider3Enabled(this)) return 'Provider 3 is not selected.';
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

      const prompt = `You are an expert English-Persian dictionary. Analyze the word "${word}" comprehensively.
Return ONLY valid JSON with this exact structure:
{
  "meanings": [{"text":"Persian meaning","type":"Persian part of speech"}],
  "synonyms": ["English word"],
  "antonyms": ["English word"]
}
Requirements: meanings in Persian/Farsi; synonyms and antonyms in English only; no markdown; provide several common meanings and useful synonyms/antonyms.`;

      try {
        const raw = await localCompletion([{ role: 'user', content: prompt }], { temperature: 0.2 });
        const result = normalizeDictionaryResult(raw);
        if (!result) return { meanings: [{ text: 'Failed to parse local model response.', type: 'Error' }], synonyms: [], antonyms: [] };
        await this.db.set('word_meanings', { word: lowerWord, value: result }).catch(() => {});
        return result;
      } catch (error) {
        console.error('Local Provider 3 dictionary error:', error);
        return { meanings: [{ text: `Local Provider 3 error: ${error.message}`, type: 'Error' }], synonyms: [], antonyms: [] };
      }
    };

    AIChatApp.prototype.playWithElevenLabsTTS = async function(text, button, progressBar) {
      button.disabled = true;
      button.classList.add('playing');
      if (progressBar) this.updateProgress(progressBar, 0);
      try {
        const audioBlob = await localTTS(text);
        await this.playAudio(audioBlob, button, progressBar);
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
    const originalGenerateEleven = AdvancedTTSPlayer.prototype.generateElevenLabsTTS;
    AdvancedTTSPlayer.prototype.generateElevenLabsTTS = async function(text) {
      try {
        return await localTTS(text);
      } catch (error) {
        console.error('Local Provider 3 advanced TTS error:', error);
        // Keep the original provider path available only if the user changes the implementation later.
        throw error;
      }
    };
  }

  // Change Provider 3 labels while preserving the original internal value for backwards compatibility.
  window.addEventListener('DOMContentLoaded', () => {
    const chatOption = document.querySelector('#chat-provider-select option[value="openrouter"]');
    if (chatOption) chatOption.textContent = 'Provider 3 — Local LLM';
    const ttsOption = document.querySelector('#tts-provider-select option[value="elevenlabs"]');
    if (ttsOption) ttsOption.textContent = 'Provider 3 — Local TTS';
  }, { once: true });

  console.log('[WordLens] Local Provider 3 patch loaded:', {
    llm: `${getCfg('llmBase')}/${getCfg('llmModel')}`,
    tts: `${getCfg('ttsBase')} (${getCfg('ttsVoice')})`
  });
})();
`;

const LOCAL_SETTINGS_HTML = `
<div class="setting-section" id="local-provider-settings">
  <p><b>Provider 3 — Local</b></p>
  <small style="color:#666;display:block;margin-bottom:8px;">Provider 3 uses your local llama.cpp LLM and KittenTTS through the WordLens local proxy. No OpenRouter API key is required.</small>
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
  if (!html.includes('id="local-provider-settings"')) {
    const marker = '<div class="setting-section">\n          <p>Text-to-Speech Provider:</p>';
    html = html.replace(marker, LOCAL_SETTINGS_HTML + '\n        ' + marker);
  }
  return html;
}

function injectLocalAppScript(html) {
  // app.js is still the original file; the service worker patches it before it reaches the browser.
  return html;
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
      const injected = injectLocalSettings(text);
      return new Response(injected, {
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
      const patched = `${source}\n\n${LOCAL_PROVIDER_PATCH}\n`;
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

  // Never rewrite local proxy requests. The WordLens server handles these same-origin.
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return fetch(event.request);
  })());
});
