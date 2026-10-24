/* WordLens local-provider runtime. Loaded explicitly by index.html. */
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    apiMode: 'proxy',
    llmBase: 'http://127.0.0.1:8080',
    llmModel: 'hy-mt2-1.8b-en-fa',
    llmApiKey: '',
    ttsBase: 'http://127.0.0.1:8082',
    ttsApiKey: '',
    ttsModel: 'pocket-tts',
    ttsVoice: 'clone',
    ttsFormat: 'wav',
    sttProvider: 'openai-compatible',
    sttBase: 'http://127.0.0.1:8767',
    sttApiKey: '',
    sttModel: 'whisper-1',
    sttLanguage: 'en'
  });

  const LEGACY_DEFAULTS = Object.freeze({
    llmModel: { 'Hy-MT2-1.8B-2Bit': DEFAULTS.llmModel },
    ttsBase: { 'http://127.0.0.1:4321': DEFAULTS.ttsBase, 'http://127.0.0.1:4321/v1': DEFAULTS.ttsBase },
    ttsModel: { 'kitten-tts-mini-0.8': DEFAULTS.ttsModel },
    ttsVoice: { 'expr-voice-4-m': DEFAULTS.ttsVoice },
    ttsApiKey: { '123': '' },
    sttBase: { '': DEFAULTS.sttBase }
  });

  const getCfg = (key) => {
    const stored = localStorage.getItem('wordlens_local_' + key);
    if (stored !== null) {
      const value = stored.toString().trim();
      if (value === '/local-api' && ['llmBase', 'ttsBase', 'sttBase'].includes(key)) {
        const fallback = (DEFAULTS[key] ?? '').toString().trim();
        setCfg(key, fallback);
        return fallback;
      }
      const legacy = LEGACY_DEFAULTS[key];
      if (legacy && Object.prototype.hasOwnProperty.call(legacy, value)) {
        const migrated = legacy[value];
        setCfg(key, migrated);
        return migrated;
      }
      return value;
    }
    if (key === 'sttProvider' && localStorage.getItem('avalai_api_key')) return 'avalai';
    return (DEFAULTS[key] ?? '').toString().trim();
  };

  const setCfg = (key, value) => {
    localStorage.setItem('wordlens_local_' + key, (value ?? '').toString().trim());
  };

  // One-time migration from WordLens' former initial Provider 1 defaults.
  // Keep an explicitly selected Provider 2 or Provider 3 unchanged.
  const PROVIDER_DEFAULTS_VERSION = 'wordlens_provider3_defaults_v1';
  if (localStorage.getItem(PROVIDER_DEFAULTS_VERSION) !== '1') {
    if (!localStorage.getItem('chat_provider') || localStorage.getItem('chat_provider') === 'gemini') {
      localStorage.setItem('chat_provider', 'openrouter');
    }
    if (!localStorage.getItem('tts_provider') || localStorage.getItem('tts_provider') === 'gemini') {
      localStorage.setItem('tts_provider', 'elevenlabs');
    }
    localStorage.setItem(PROVIDER_DEFAULTS_VERSION, '1');
  }

  const normalizeBase = (value) => (value || '').trim().replace(/\/+$/, '');

  const withDeadline = async (promise, milliseconds, message) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), milliseconds);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  // Accept either a server root URL or an already-versioned /v1 URL.
  // The same-origin /local-api proxy has its own route and must not gain /v1.
  const normalizeApiBase = (value) => {
    const base = normalizeBase(value);
    if (!base || /\/local-api$/i.test(base) || /\/v1$/i.test(base)) return base;
    return base + '/v1';
  };

  // Detect WordLens opened from another device over a private LAN.
  const isLanHostedClient = () => {
    const hostname = String(window.location?.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || ['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      const octets = hostname.split('.').map(Number);
      if (octets.some(part => part < 0 || part > 255)) return false;
      const [a, b] = octets;
      return a === 10 || (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
    }
    return hostname.endsWith('.local') || /^(?:fc|fd)[0-9a-f:]*$/i.test(hostname) ||
      /^fe80:/i.test(hostname);
  };
  // Respect the user's connection-mode selection. Proxy is the easiest LAN setup,
  // while Direct remains available for environments where the proxy cannot be used.
  const usesProxy = () => getCfg('apiMode') !== 'direct';

  const makeLanServiceUrl = (value) => {
    const raw = normalizeBase(value);
    if (!isLanHostedClient() || !raw) return raw;
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);
      const octets = host.split('.').map(Number);
      const validIpv4 = octets.length === 4 && octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255);
      const privateIpv4 = validIpv4 && (
        octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 169 && octets[1] === 254)
      );
      // All local AI services in this setup live on the same PC as WordLens.
      // Replace stale loopback/private-IP values with the host from this page URL;
      // this also adapts if the PC gets a different DHCP address.
      if (loopback || privateIpv4) {
        url.hostname = window.location.hostname;
        return url.toString().replace(/\/$/, '');
      }
    } catch (_) {}
    return raw;
  };
  // Migrate old loopback values once even if the Direct-mode settings panel is
  // not opened before starting a chat on the phone.
  if (isLanHostedClient() && getCfg('apiMode') === 'direct') {
    ['llmBase', 'ttsBase', 'sttBase'].forEach(key => {
      const current = getCfg(key);
      const accessible = makeLanServiceUrl(current);
      if (accessible && accessible !== current) setCfg(key, accessible);
    });
  }

  const fetchWithNetworkDiagnostics = async (url, options, label) => {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const target = /^https?:\/\//i.test(String(url))
        ? String(url)
        : new URL(String(url), window.location.href).href;
      const detail = error?.message || String(error);
      if (isLanHostedClient() && String(url).startsWith('/local-api/')) {
        throw new Error(
          label + ': cannot reach the WordLens proxy at ' + target +
          '. Check that the phone and PC are on the same Wi-Fi, the PC address has not changed, ' +
          'and Windows Firewall allows inbound TCP port 8000. Browser detail: ' + detail
        );
      }
      throw new Error(
        label + ': network request failed for ' + target +
        '. Check service availability and, in Direct mode, CORS/HTTPS restrictions. Browser detail: ' + detail
      );
    }
  };

  const requestBase = (key) => {
    if (usesProxy()) return '/local-api';
    const configured = getCfg(key);
    if (!configured) throw new Error('Set the ' + key.replace(/([A-Z])/g, ' $1') + ' Base URL in Settings → Provider 3 — API Connections.');
    return normalizeApiBase(configured);
  };

  const syncProxyConfig = async () => {
    if (getCfg('apiMode') === 'direct') return { skipped: true, reason: 'direct-mode' };
    // Proxy upstream URLs belong to the host machine and cannot be changed
    // from a phone or another LAN client.
    if (isLanHostedClient()) return { skipped: true, reason: 'lan-client' };
    const response = await fetch('/local-api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ llm_base: getCfg('llmBase'), tts_base: getCfg('ttsBase'), stt_base: getCfg('sttBase') }),
      cache: 'no-store'
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error('Could not save API addresses to the local proxy (' + response.status + '). Run WordLens at http://127.0.0.1:8000 or switch to Direct mode. ' + detail);
    }
    return response.json();
  };

  const loadProxyConfig = async (fields) => {
    if (!usesProxy()) return;
    try {
      const response = await fetch('/local-api/config', { cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      const mapping = { llmBase: 'llm_base', ttsBase: 'tts_base', sttBase: 'stt_base' };
      Object.entries(mapping).forEach(([key, name]) => {
        if (typeof config[name] !== 'string') return;
        setCfg(key, config[name]);
        if (fields[key]) fields[key].value = config[name];
      });
    } catch (error) {
      console.debug('Local proxy configuration is unavailable:', error);
    }
  };

  const localCompletion = async (messages, extra = {}, options = {}) => {
    const base = requestBase('llmBase');
    const model = getCfg('llmModel') || DEFAULTS.llmModel;
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const apiKey = getCfg('llmApiKey');
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const parentSignal = options?.signal;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
    const relayAbort = () => controller.abort();
    if (parentSignal?.aborted) relayAbort();
    else parentSignal?.addEventListener('abort', relayAbort, { once: true });
    let response;
    let responseText;
    try {
      response = await fetchWithNetworkDiagnostics(base + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, ...extra }),
        signal: controller.signal,
        cache: 'no-store'
      }, 'LLM');
      responseText = await response.text();
    } catch (error) {
      if (parentSignal?.aborted) {
        const cancelled = new Error('Realtime LLM request cancelled.');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      if (timedOut) {
        throw new Error('LLM request or response timed out after 180 seconds. Check that the local model server is responsive and not occupied by another job.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', relayAbort);
    }
    if (!response.ok) {
      throw new Error('OpenAI-compatible LLM API error: ' + response.status + ', ' + responseText);
    }
    let data;
    try { data = JSON.parse(responseText); }
    catch (_) { throw new Error('LLM server returned invalid JSON instead of a chat completion.'); }
    const rawContent = data?.choices?.[0]?.message?.content;
    const content = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent)
      ? rawContent.map(part => typeof part === 'string' ? part : (part?.text || '')).join('') : '';
    if (!content.trim()) throw new Error('OpenAI-compatible LLM returned an empty response.');
    return content;
  };

  const localTTS = async (text, options = {}) => {
    const signal = options?.signal;
    const base = requestBase('ttsBase');
    const headers = { 'Content-Type': 'application/json', 'Accept': 'audio/*, application/octet-stream' };
    const apiKey = getCfg('ttsApiKey');
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const payload = {
      model: getCfg('ttsModel') || DEFAULTS.ttsModel,
      input: String(text ?? ''),
      voice: getCfg('ttsVoice') || DEFAULTS.ttsVoice,
      response_format: getCfg('ttsFormat') || DEFAULTS.ttsFormat
    };
    const response = await fetchWithNetworkDiagnostics(base + '/audio/speech', {
      method: 'POST', headers, body: JSON.stringify(payload), signal
    }, 'TTS');
    if (response.ok) {
      const blob = await response.blob();
      if (!blob.size) throw new Error('Pocket TTS returned an empty audio file.');
      return blob;
    }
    const errorText = await response.text();
    if (signal?.aborted) {
      const cancelled = new Error('Realtime TTS request cancelled.');
      cancelled.name = 'AbortError';
      throw cancelled;
    }

    // Official Kyutai Pocket TTS exposes POST /tts as multipart/form-data,
    // while OpenAI-compatible wrappers expose /v1/audio/speech. Support both.
    const tryNativePocketTTS = [400, 404, 405, 415, 422, 501].includes(response.status);
    if (!tryNativePocketTTS) {
      throw new Error('Pocket TTS API error: ' + response.status + ', ' + errorText);
    }
    const nativeRoot = usesProxy()
      ? '/local-api'
      : normalizeBase(getCfg('ttsBase')).replace(/\/v1$/i, '');
    const nativeForm = new FormData();
    nativeForm.append('text', String(text ?? ''));
    const voice = getCfg('ttsVoice') || 'clone';
    // Native Pocket TTS gets its clone from the server's configured default voice.
    // Built-in/URL voices are passed explicitly; arbitrary labels such as "clone"
    // are IDs for OpenAI-compatible wrappers, not valid native voice URLs.
    const nativeVoiceNames = new Set([
      'alba','anna','azelma','bill_boerst','caro_davy','charles','cosette','eponine',
      'eve','fantine','george','jane','javert','jean','marius','mary','michael','paul',
      'peter_yearsley','stuart_bell','vera','giovanni','lola','juergen','rafael','estelle'
    ]);
    if (/^(https?:\/\/|hf:\/\/)/i.test(voice) || nativeVoiceNames.has(voice.toLowerCase())) {
      nativeForm.append('voice_url', voice);
    }
    const nativeHeaders = { 'Accept': 'audio/wav, audio/*, application/octet-stream' };
    if (apiKey) nativeHeaders.Authorization = 'Bearer ' + apiKey;
    const nativeResponse = await fetchWithNetworkDiagnostics(nativeRoot + '/tts', {
      method: 'POST', headers: nativeHeaders, body: nativeForm, signal
    }, 'Native TTS');
    if (!nativeResponse.ok) {
      const nativeError = await nativeResponse.text();
      throw new Error(
        'Pocket TTS failed on /v1/audio/speech (' + response.status + ': ' + errorText +
        ') and native /tts (' + nativeResponse.status + ': ' + nativeError + '). ' +
        'For the native endpoint, configure the cloned voice as the Pocket TTS server default.'
      );
    }
    const blob = await nativeResponse.blob();
    if (!blob.size) throw new Error('Pocket TTS native /tts returned an empty audio file.');
    return blob;
  };

  // Normalize browser microphone captures to the format most local Whisper servers accept.
  const toMonoWav16k = async (audioBlob) => {
    if (/^audio\/(?:x-)?wav(?:;|$)/i.test(audioBlob.type || '')) return audioBlob;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioContextClass || !OfflineContextClass) return audioBlob;

    const context = new AudioContextClass();
    try {
      const decoded = await withDeadline(
        context.decodeAudioData(await audioBlob.arrayBuffer()),
        30000,
        'Decoding microphone audio took longer than 30 seconds. Try a shorter recording or a supported Chrome browser.'
      );
      const sampleRate = 16000;
      const frameCount = Math.max(1, Math.ceil(decoded.duration * sampleRate));
      const offline = new OfflineContextClass(1, frameCount, sampleRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await withDeadline(
        offline.startRendering(),
        30000,
        'Audio resampling took longer than 30 seconds. Try a shorter recording.'
      );
      const samples = rendered.getChannelData(0);
      const wavBuffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(wavBuffer);
      const writeText = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
      };
      writeText(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeText(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      }
      return new Blob([wavBuffer], { type: 'audio/wav' });
    } catch (error) {
      throw new Error('Could not convert microphone audio to WAV for local STT: ' + (error?.message || String(error)));
    } finally {
      if (context.state !== 'closed') await context.close().catch(() => {});
    }
  };

  const localSTT = async (audioBlob, app) => {
    if (!(audioBlob instanceof Blob) || audioBlob.size === 0) throw new Error('No recorded audio was captured.');
    const provider = getCfg('sttProvider');
    const isAvalai = provider === 'avalai';
    const base = isAvalai ? 'https://api.avalai.ir/v1' : requestBase('sttBase');
    const apiKey = isAvalai ? (app?.AVALAI_API_KEY || '') : getCfg('sttApiKey');
    if (isAvalai && !apiKey) throw new Error('Avalai STT is selected but its API key is not set in Settings.');

    // Convert browser MediaRecorder WebM/Opus to WAV for local whisper.cpp.
    const uploadBlob = isAvalai ? audioBlob : await toMonoWav16k(audioBlob);
    const mimeType = (uploadBlob.type || '').toLowerCase();
    const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm';
    const language = getCfg('sttLanguage');
    const headers = { 'Accept': 'application/json, text/plain, */*' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const createForm = (includeModel) => {
      const form = new FormData();
      form.append('file', uploadBlob, 'recording.' + extension);
      if (includeModel) form.append('model', getCfg('sttModel') || 'whisper-1');
      if (language && language.toLowerCase() !== 'auto') form.append('language', language);
      form.append('response_format', 'json');
      return form;
    };

    // Keep the timer alive until both HTTP headers and the full response body have
    // arrived. A timeout that ends at response headers can still leave text() hung.
    const send = async (url, includeModel = true) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetchWithNetworkDiagnostics(url, {
          method: 'POST',
          headers,
          body: createForm(includeModel),
          signal: controller.signal,
          cache: 'no-store'
        }, 'STT transcription');
        const bodyText = await response.text();
        if (controller.signal.aborted) {
          throw new Error('STT response timed out after 60 seconds. Check the whisper.cpp server and whether it is processing another request.');
        }
        return { response, bodyText };
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw new Error('STT request or response timed out after 60 seconds. Check that whisper.cpp is running, reachable, and not busy with another request.');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    const NON_SPEECH_TRANSCRIPTS = new Set([
      'blank audio','blank audio detected','blank_audio','silence','silent','no speech','inaudible',
      'unintelligible','unintelligible speech','keyboard','keyboard typing','keyboard clicking',
      'typing','typing sound','sound of typing','sound of keyboard','the sound of typing',
      'the sound of a keyboard','cough','coughing','a cough','someone coughing','sigh','sighing',
      'laugh','laughing','laughter','breathing','heavy breathing','background noise','noise',
      'static','music','applause','footsteps','door closing','door opening','beeping','beep',
      'صدای کیبورد','کیبورد','سرفه','صدای سرفه','سکوت','صدای پس زمینه','صدای پس‌زمینه'
    ]);
    const isNonSpeechTranscript = (value) => {
      const normalized = String(value ?? '').toLowerCase().normalize('NFKC')
        .replace(/[\[\](){}]/g, ' ')
        .replace(/[_\-–—]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ').trim();
      if (!normalized) return true;
      if (NON_SPEECH_TRANSCRIPTS.has(normalized)) return true;
      return /^(?:(?:(?:the|a|some|someone|there is|you can hear) )?(?:(?:sound|audio) of )?)?(?:a )?(?:blank audio|silence|no speech|background noise|keyboard(?: typing| clicking| sounds?)?(?: on (?:a )?keyboard)?|typing(?: on (?:a )?keyboard)?(?: sound)?|cough(?:ing)?|someone coughing|sigh(?:ing)?|laugh(?:ing|ter)?|heavy breathing|static|applause|footsteps|beep(?:ing)?)(?: sound| sounds| noise| is audible| in the background)?$/.test(normalized)
        || /^(?:blank audio\s*){2,}$/.test(normalized)
        || /^(?:صدای )?(?:کیبورد|سرفه|سرفه کردن|سکوت|نویز)(?: کردن)?$/.test(normalized)
        || /^(?:صدای کیبورد|صدای سرفه|صدای تایپ|تایپ کردن)$/.test(normalized);
    };
    const readTranscript = (responseText) => {
      let data;
      try { data = JSON.parse(String(responseText ?? '').trim()); }
      catch (_) { data = { text: String(responseText ?? '') }; }
      const transcript = typeof data?.text === 'string' ? data.text
        : typeof data?.transcription === 'string' ? data.transcription
        : typeof data?.result?.text === 'string' ? data.result.text
        : Array.isArray(data?.segments) ? data.segments.map(part => part?.text || '').join(' ')
        : '';
      const cleanTranscript = transcript.trim();
      if (!cleanTranscript || isNonSpeechTranscript(cleanTranscript)) return '';
      const scoredSegments = Array.isArray(data?.segments)
        ? data.segments.filter(segment => Number.isFinite(Number(segment?.no_speech_prob))) : [];
      if (scoredSegments.length && scoredSegments.every(segment => Number(segment.no_speech_prob) >= 0.78)) return '';
      return cleanTranscript;
    };

    let nativeError = '';
    let nativeFatal = false;
    // Local whisper.cpp serves /inference natively; hit it first to avoid waiting
    // on a non-existent OpenAI route. Other compatible servers fall back below.
    if (!isAvalai) {
      const nativeRoot = usesProxy()
        ? '/local-api'
        : normalizeBase(getCfg('sttBase')).replace(/\/v1$/i, '');
      try {
        const native = await send(nativeRoot + '/inference', false);
        if (native.response.ok) {
          try { return readTranscript(native.bodyText); }
          catch (error) { nativeError = error.message; }
        } else {
          nativeError = 'whisper.cpp /inference returned HTTP ' + native.response.status + ': ' + native.bodyText.slice(0, 700);
          nativeFatal = [401, 403, 502, 503, 504].includes(native.response.status);
        }
      } catch (error) {
        nativeError = error.message || String(error);
        // Do not start a second long inference if the first endpoint timed out.
        if (/timed out after 60 seconds/i.test(nativeError)) throw error;
      }
      if (nativeFatal) {
        throw new Error('The local STT service could not process /inference. ' + nativeError +
          ' Check the STT Base URL, server logs and firewall before retrying.');
      }
    }

    try {
      const compatible = await send(base + '/audio/transcriptions', true);
      if (compatible.response.ok) {
        try { return readTranscript(compatible.bodyText); }
        catch (error) {
          throw new Error('OpenAI-compatible STT endpoint returned HTTP ' + compatible.response.status +
            ' but no usable transcript. ' + error.message + (nativeError ? ' Native endpoint: ' + nativeError : ''));
        }
      }
      throw new Error('OpenAI-compatible STT returned HTTP ' + compatible.response.status + ': ' + compatible.bodyText.slice(0, 1000));
    } catch (error) {
      const detail = error?.message || String(error);
      throw new Error('Transcription failed. ' + (nativeError ? 'Native /inference: ' + nativeError + ' | ' : '') + detail);
    }
  };

  const playLocalBlob = async (app, audioBlob, button, progressBar, spokenText = '') => {
    if (!audioBlob || !audioBlob.size) throw new Error('Empty local audio blob.');

    const text = String(spokenText ?? '').trim();
    const tokenCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.playbackRate = tokenCount > 0 && tokenCount <= 2 && text.length <= 64 ? 0.78 : 1;
    try { audio.preservesPitch = true; } catch (_) {}
    try { audio.webkitPreservesPitch = true; } catch (_) {}

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
      <p><b>Provider 3 — API Connections</b></p>
      <small style="color:#666;display:block;margin-bottom:8px;">Enter each API's real upstream address below. Local proxy mode (recommended) saves these addresses on this computer and avoids browser CORS. Direct mode calls the URLs from your browser and requires CORS support.</small>
      <div id="local-lan-config-note" style="display:none;margin:8px 0;padding:10px;border-radius:8px;background:rgba(0,136,204,0.08);font-size:12px;"></div>
      <label style="display:block;margin:8px 0 4px;">Connection Mode</label>
      <select id="local-api-mode" class="settings-select">
        <option value="proxy">Local proxy — recommended</option>
        <option value="direct">Direct API — CORS required</option>
      </select>
      <p style="margin:14px 0 4px;font-weight:700;">1. LLM — Chat, translation and dictionary</p>
      <label style="display:block;margin:6px 0 4px;">LLM Base URL</label>
      <input type="text" id="local-llm-base-url" placeholder="http://127.0.0.1:8080 or .../v1">
      <small style="color:#666;display:block;margin-top:4px;">Upstream address sent to <code>/v1/chat/completions</code>. Server root and URLs ending in <code>/v1</code> are both accepted.</small>
      <label style="display:block;margin:8px 0 4px;">LLM Model</label>
      <input type="text" id="local-llm-model" placeholder="Model ID from /v1/models">
      <label style="display:block;margin:8px 0 4px;">LLM API Key (optional)</label>
      <input type="password" id="local-llm-api-key" placeholder="Bearer token, if required">
      <p style="margin:14px 0 4px;font-weight:700;">2. TTS — Spoken replies</p>
      <label style="display:block;margin:8px 0 4px;">TTS Base URL</label>
      <input type="text" id="local-tts-base-url" placeholder="http://127.0.0.1:PORT or .../v1">
      <small style="color:#666;display:block;margin-top:4px;">Uses the OpenAI-compatible <code>/v1/audio/speech</code> route first, then the native Pocket TTS <code>/tts</code> route when needed.</small>
      <label style="display:block;margin:8px 0 4px;">TTS Model</label>
      <input type="text" id="local-tts-model" placeholder="pocket-tts">
      <label style="display:block;margin:8px 0 4px;">TTS API Key (optional)</label>
      <input type="password" id="local-tts-api-key" placeholder="Bearer token, if required">
      <label style="display:block;margin:8px 0 4px;">TTS Voice</label>
      <input type="text" id="local-tts-voice" placeholder="clone">
      <label style="display:block;margin:8px 0 4px;">TTS Response Format</label>
      <input type="text" id="local-tts-format" placeholder="wav">
      <p style="margin:14px 0 4px;font-weight:700;">3. STT — Transcription and live conversation</p>
      <label style="display:block;margin:8px 0 4px;">STT Provider</label>
      <select id="local-stt-provider" class="settings-select"><option value="openai-compatible">OpenAI-compatible STT (local)</option><option value="avalai">Avalai Whisper API</option></select>
      <label style="display:block;margin:8px 0 4px;">STT API Base URL</label>
      <input type="text" id="local-stt-base-url" placeholder="http://127.0.0.1:PORT or .../v1">
      <small style="color:#666;display:block;margin-top:4px;">Uses <code>/v1/audio/transcriptions</code> first and can fall back to whisper.cpp <code>/inference</code>. Browser recordings are normalized to 16 kHz mono WAV for local STT.</small>
      <label style="display:block;margin:8px 0 4px;">STT API Key (optional for local endpoints)</label>
      <input type="password" id="local-stt-api-key" placeholder="Bearer token, if required">
      <label style="display:block;margin:8px 0 4px;">STT Model</label>
      <input type="text" id="local-stt-model" placeholder="whisper-1">
      <label style="display:block;margin:8px 0 4px;">STT Language</label>
      <input type="text" id="local-stt-language" placeholder="en, fa, or auto">
      <div class="modal-buttons" style="margin-top:10px;">
        <button type="button" id="local-provider-test" class="btn-secondary">Test LLM + TTS</button>
        <button type="button" id="local-stt-test" class="btn-secondary">Test STT (4-second sample)</button>
      </div>
      <div id="local-provider-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    `;
    scroll.appendChild(section);

    const apiModeField = document.getElementById('local-api-mode');
    apiModeField.value = getCfg('apiMode');
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

    const fields = {
      apiMode: apiModeField,
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
    const lanNote = document.getElementById('local-lan-config-note');
    const updateLanModeUi = () => {
      if (isLanHostedClient()) {
        const direct = apiModeField.value === 'direct';
        ['llmBase', 'ttsBase', 'sttBase'].forEach(key => {
          if (!fields[key]) return;
          fields[key].disabled = !direct;
          if (direct) {
            const accessible = makeLanServiceUrl(fields[key].value);
            if (accessible !== fields[key].value) fields[key].value = accessible;
          }
        });
        if (lanNote) {
          lanNote.style.display = 'block';
          lanNote.textContent = direct
            ? 'Direct mode sends requests from this phone to the API services directly. Loopback URLs are changed to this PC’s LAN address when possible. The model services must listen on the LAN and permit browser CORS; Windows Firewall must allow their ports.'
            : 'Proxy mode routes requests through this WordLens server. API Base URLs are controlled by the PC running server.py and are read-only on this phone. If the proxy itself is unreachable, select Direct mode and configure the service URLs for the PC’s LAN address.';
        }
      }
    };
    updateLanModeUi();
    loadProxyConfig(fields).then(updateLanModeUi);
    apiModeField.addEventListener('change', () => {
      setCfg('apiMode', apiModeField.value);
      if (apiModeField.value === 'direct') {
        ['llmBase', 'ttsBase', 'sttBase'].forEach(key => {
          if (fields[key]) {
            fields[key].value = makeLanServiceUrl(fields[key].value);
            setCfg(key, fields[key].value);
          }
        });
      }
      updateLanModeUi();
      const status = document.getElementById('local-provider-status');
      status.textContent = apiModeField.value === 'proxy'
        ? 'Local proxy mode routes API calls through server.py on the host PC.'
        : 'Direct mode calls APIs from this browser. On a phone, use the PC’s LAN IP (not 127.0.0.1) and enable CORS on the APIs.';
    });

    document.getElementById('local-provider-test').addEventListener('click', async () => {
      const status = document.getElementById('local-provider-status');
      Object.entries(fields).forEach(([key, element]) => { if (element) setCfg(key, element.value); });
      status.textContent = isLanHostedClient() && usesProxy() ? 'Testing through this PC’s local proxy…' : 'Testing direct LLM + TTS connections…';
      try {
        const proxySync = await syncProxyConfig();
        const llmSample = await localCompletion([{ role: 'user', content: 'Reply with exactly OK.' }], { temperature: 0, max_tokens: 8 });
        const ttsSample = await localTTS('Hello, this is a local text to speech test.');
        if (!(ttsSample instanceof Blob) || ttsSample.size === 0) throw new Error('TTS synthesis returned no audio.');
        const sttHint = getCfg('sttProvider') === 'avalai' ? 'Avalai STT key is checked when recording.' : (!getCfg('sttBase') ? 'Enter the actual STT Base URL before transcribing.' : 'STT is tested on the first recording.');
        const lanHint = proxySync?.reason === 'lan-client' && usesProxy()
          ? ' Server URLs remain controlled by the PC; this phone uses its proxy.'
          : proxySync?.reason === 'direct-mode' && isLanHostedClient()
            ? ' Direct mode requires the API services to accept LAN requests and browser CORS.'
            : '';
        status.textContent = 'OK — LLM replied “' + llmSample.slice(0,60) + '”; TTS returned ' + Math.round(ttsSample.size/1024) + ' KB audio. ' + sttHint + lanHint;
      } catch (error) { status.textContent = 'Error: ' + error.message; console.error('Local Provider 3 test failed:', error); }
    });

    const sttTestButton = document.getElementById('local-stt-test');
    sttTestButton?.addEventListener('click', async () => {
      const status = document.getElementById('local-provider-status');
      const fields = {
        apiMode: document.getElementById('local-api-mode'),
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
      Object.entries(fields).forEach(([key, element]) => { if (element) setCfg(key, element.value); });
      let stream = null;
      sttTestButton.disabled = true;
      try {
        const proxySync = await syncProxyConfig();
        if (getCfg('sttProvider') !== 'avalai' && !usesProxy() && !getCfg('sttBase')) {
          throw new Error('Enter the STT Base URL first.');
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
          throw new Error('Microphone recording requires HTTPS or localhost in a supported browser.');
        }
        status.textContent = 'Recording for 4 seconds. Speak a short test sentence now…';
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const recorder = makeRealtimeRecorder(stream);
        const chunks = [];
        const stopped = new Promise((resolve, reject) => {
          recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
          recorder.onerror = event => reject(event.error || new Error('Microphone recorder failed.'));
          recorder.onstop = resolve;
          recorder.start(200);
          setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 4000);
        });
        await stopped;
        const sample = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
        const transcript = await localSTT(sample, window.WORDLENS_APP || null);
        const lanHint = proxySync?.reason === 'lan-client' ? ' (through this PC’s local proxy)' : '';
        status.textContent = 'STT OK — recognized: ' + transcript + lanHint;
      } catch (error) {
        status.textContent = 'STT test failed: ' + error.message;
        console.error('STT connection test failed:', error);
      } finally {
        if (stream) stream.getTracks().forEach(track => track.stop());
        sttTestButton.disabled = false;
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
    AIChatApp.prototype.saveSettings = async function() {
      const fields = {
        apiMode: document.getElementById('local-api-mode'),
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
      Object.entries(fields).forEach(([key, element]) => { if (element) setCfg(key, element.value); });
      let proxyError = null;
      let proxySync = null;
      try { proxySync = await syncProxyConfig(); } catch (error) { proxyError = error; console.error('API proxy settings could not be saved:', error); }
      originalSaveSettings.call(this);
      if (proxySync?.reason === 'lan-client' && getCfg('apiMode') === 'proxy') {
        this.showToast('Device settings saved. In proxy mode, server addresses are read-only from the phone; change them on the PC running WordLens.', 'warning');
      } else if (proxySync?.reason === 'direct-mode' && isLanHostedClient()) {
        this.showToast('Direct mode saved. Make sure the API URLs use the PC’s LAN address and the API servers allow CORS.', 'warning');
      } else if (proxyError && getCfg('apiMode') === 'proxy') {
        this.showToast('Browser settings saved, but local API addresses were not updated. Open WordLens on the PC at http://127.0.0.1:8000. ' + proxyError.message, 'warning');
      } else {
        this.showToast('API connection settings saved.', 'success');
      }
    };

    AIChatApp.prototype.callOpenRouterChatAPI = async function(message, chatIdOrOptions = this.currentChatId, requestOptions = {}) {
      // The chat UI passes a chat ID, while the realtime voice path passes { signal }.
      // Keep both call styles working and never treat an options object as a chat ID.
      let chatId = chatIdOrOptions;
      if (chatIdOrOptions && typeof chatIdOrOptions === 'object') {
        requestOptions = chatIdOrOptions;
        chatId = this.currentChatId;
      }
      if (!chatId) chatId = this.currentChatId;
      if (this.chatProvider !== 'openrouter') throw new Error('Provider 3 is not selected.');
      const chat = this.chats.find(c => c.id === chatId);
      if (!chat) throw new Error('Chat not found');

      const history = this.getConversationHistory(chat, message).map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: String(msg.content ?? '')
      }));
      const systemPrompt = typeof this.getEffectiveSystemInstructions === 'function'
        ? this.getEffectiveSystemInstructions()
        : [
            'Answer the current request directly. Do not identify yourself as WordLens or introduce yourself unless explicitly asked.',
            'Follow the user’s saved Custom Instructions when available. Use valid CommonMark Markdown for structured answers and never duplicate heading markers.'
          ].join('\n');
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: String(message ?? '') }
      ];
      return localCompletion(messages, { temperature: 0.7, max_tokens: 8192 }, requestOptions);
    };

    AIChatApp.prototype.translateTextOpenRouter = async function(text, options = {}) {
      const sourceText = String(text ?? '').trim();
      const previous = String(options.previousTranslation ?? '').trim();
      const retryInstruction = options.forceAlternative
        ? 'The previous attempt repeated the same wording. Produce a genuinely different but accurate Persian/Farsi translation.'
        : 'This is a fresh translation attempt. Use natural wording and do not repeat the prior translation verbatim.';
      const prompt = options.refresh
        ? [
            'Translate the following source text into natural, accurate Persian/Farsi.',
            'Return only the translation, without explanation, quotation marks, or commentary.',
            retryInstruction,
            previous ? `Previous translation to avoid repeating: "${previous}"` : '',
            `Source text: "${sourceText}"`,
            `Request reference: ${options.requestId || Date.now()}`
          ].filter(Boolean).join('\n')
        : `Translate this text to Persian/Farsi. Provide only the translation without any additional explanation: "${sourceText}"`;
      try {
        return await localCompletion(
          [{ role: 'user', content: prompt }],
          { temperature: options.forceAlternative ? 0.95 : options.refresh ? 0.8 : 0.2 }
        );
      } catch (error) {
        console.error('Local Provider 3 translation error:', error);
        throw new Error('Local translation failed: ' + (error?.message || String(error)));
      }
    };

    AIChatApp.prototype.getWordMeaningOpenRouter = async function(word, { forceRefresh = false } = {}) {
      const lowerWord = String(word ?? '').toLowerCase().trim();
      if (!lowerWord) {
        return { meanings: [{ text: 'No word selected.', type: 'Error' }], synonyms: [], antonyms: [] };
      }

      const normalizeWordList = (value) => {
        const items = Array.isArray(value)
          ? value
          : typeof value === 'string' ? value.split(/[,;\n]/g) : [];
        const seen = new Set();
        return items
          .map(item => String(item ?? '').trim().replace(/^["'\s]+|["'\s]+$/g, ''))
          .filter(item => /^[A-Za-z][A-Za-z\s'-]*$/.test(item))
          .filter(item => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 3);
      };

      const normalizeMeaningResult = (object) => {
        if (!object || typeof object !== 'object' || !Array.isArray(object.meanings)) return null;
        const meanings = object.meanings
          .map(item => {
            if (typeof item === 'string') return { text: item.trim(), type: '' };
            return {
              text: String(item?.text ?? item?.meaning ?? '').trim(),
              type: String(item?.type ?? item?.part_of_speech ?? '').trim()
            };
          })
          .filter(item => item.text && item.type.toLowerCase() !== 'error')
          .filter(item => !/^(?:local provider 3 error|failed to parse meaning|request failed)/i.test(item.text))
          .slice(0, 5);
        if (!meanings.length) return null;
        return {
          meanings,
          synonyms: normalizeWordList(object.synonyms),
          antonyms: normalizeWordList(object.antonyms)
        };
      };

      const parseJsonObject = (raw) => {
        const text = String(raw ?? '').trim()
          .replace(/^\uFEFF/, '')
          .replace(/^\`\`\`(?:json)?\s*/i, '')
          .replace(/\s*\`\`\`\s*$/i, '')
          .replace(/,(\s*[}\]])/g, '$1');
        const candidates = [text];
        // Recover the first balanced JSON object while respecting quoted braces.
        for (let start = 0; start < text.length; start++) {
          if (text[start] !== '{') continue;
          let depth = 0;
          let inString = false;
          let escaped = false;
          for (let i = start; i < text.length; i++) {
            const char = text[i];
            if (inString) {
              if (escaped) escaped = false;
              else if (char === '\\') escaped = true;
              else if (char === '"') inString = false;
              continue;
            }
            if (char === '"') inString = true;
            else if (char === '{') depth++;
            else if (char === '}') {
              depth--;
              if (depth === 0) {
                candidates.push(text.slice(start, i + 1).replace(/,(\s*[}\]])/g, '$1'));
                break;
              }
            }
          }
        }
        let firstParsed = null;
        for (const candidate of candidates) {
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.meanings)) return parsed;
            if (!firstParsed) firstParsed = parsed;
          } catch (_) {}
        }
        return firstParsed;
      };

      try {
        // Read cache for ordinary lookups; on refresh, retain it only as a comparison
        // reference so an explicit click never returns the old answer without a new request.
        let previousCachedResult = null;
        try {
          const cached = await this.db.get('word_meanings', lowerWord);
          previousCachedResult = normalizeMeaningResult(cached?.value);
          if (previousCachedResult && !forceRefresh) {
            await this.db.set('word_meanings', { word: lowerWord, value: previousCachedResult }).catch(() => {});
            return previousCachedResult;
          }
        } catch (error) {
          console.debug('Local dictionary cache read failed:', error);
        }

        const wordJson = JSON.stringify(String(word));
        const prompt =
          'You are a precise English-to-Persian learner dictionary. Analyze only the English word or short expression below.\n' +
          'WORD: ' + wordJson + '\n\n' +
          (forceRefresh
            ? 'REFRESH MODE: Re-evaluate this word in a fresh independent pass. Provide a genuinely useful alternative set/order of accurate Persian glosses when possible. Do not copy the previous result verbatim, but do not invent or distort meanings merely to make the answer different.\n' +
              'PREVIOUS RESULT (comparison reference only): ' + JSON.stringify(previousCachedResult || null) + '\n\n'
            : '') +
          'Return one JSON object only, with exactly these keys and no other text:\n' +
          '{"meanings":[{"text":"معنی فارسی","type":"اسم/فعل/صفت/قید/حرف اضافه/حرف ربط/حرف ندا"},{"text":"معنی فارسی دوم","type":"نوع کلمه"}],"synonyms":["English synonym"],"antonyms":["English antonym"]}\n\n' +
          'Rules (must follow):\n' +
          '- meanings must contain 1 to 5 items, sorted from the most common/current meaning to less common meanings.\n' +
          '- Each meaning.text must be Persian/Farsi. Do not write English explanations in meanings.\n' +
          '- Each meaning.type must be a short Persian part-of-speech label.\n' +
          '- synonyms must contain at most 3 distinct English words or short English phrases, closest matches first.\n' +
          '- antonyms must contain at most 3 distinct English words or short English phrases, strongest opposites first. If none exists, use [].\n' +
          '- Synonyms and antonyms must use Latin/English letters only; never put Persian words there.\n' +
          '- Use JSON double quotes, valid escaping, arrays, commas and closing braces. No trailing commas, Markdown, code fences, comments or prose.';

        const jsonOptions = {
          temperature: forceRefresh ? 0.7 : 0,
          max_tokens: 320,
          response_format: { type: 'json_object' }
        };
        let raw;
        try {
          raw = await localCompletion([{ role: 'user', content: prompt }], jsonOptions);
        } catch (error) {
          // Some OpenAI-compatible servers/models do not implement response_format.
          if (!/response.?format|json.?object|unsupported|unknown.*parameter|invalid.*parameter/i.test(error.message || '')) {
            throw error;
          }
          raw = await localCompletion([{ role: 'user', content: prompt }], {
            temperature: 0,
            max_tokens: 320
          });
        }

        let result = normalizeMeaningResult(parseJsonObject(raw));
        if (!result) {
          const repairPrompt =
            'Correct the output below into valid JSON matching the schema and constraints. ' +
            'Return ONLY JSON. meanings: 1-5 Persian translations ordered most common first. ' +
            'synonyms: at most 3 English-only items. antonyms: at most 3 English-only items. ' +
            'Required keys: meanings (array of objects with text and type), synonyms (array), antonyms (array).\n' +
            'WORD: ' + wordJson + '\nINVALID OUTPUT:\n' + String(raw).slice(0, 1800);
          const repair = await localCompletion([{ role: 'user', content: repairPrompt }], {
            temperature: 0,
            max_tokens: 320,
            response_format: { type: 'json_object' }
          }).catch(async error => {
            if (!/response.?format|json.?object|unsupported|unknown.*parameter|invalid.*parameter/i.test(error.message || '')) throw error;
            return localCompletion([{ role: 'user', content: repairPrompt }], { temperature: 0, max_tokens: 320 });
          });
          result = normalizeMeaningResult(parseJsonObject(repair));
        }

        const meaningSignature = value => JSON.stringify({
          meanings: (value?.meanings || []).map(item => String(item?.text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')),
          synonyms: (value?.synonyms || []).map(item => String(item ?? '').trim().toLowerCase()),
          antonyms: (value?.antonyms || []).map(item => String(item ?? '').trim().toLowerCase())
        });

        // Some local models tend to repeat deterministic JSON. If a refresh is
        // equivalent to the cached result, make one stronger alternative attempt.
        if (
          forceRefresh && previousCachedResult && result &&
          meaningSignature(result) === meaningSignature(previousCachedResult)
        ) {
          const alternativePrompt = [
            'Perform a second independent dictionary pass for this exact English word.',
            'Return only valid JSON with meanings (1-5 Persian glosses), synonyms (0-3 English items), and antonyms (0-3 English items).',
            'Keep every entry accurate. Prefer another common Persian wording or a different helpful ordering instead of copying the prior entry.',
            'WORD: ' + wordJson,
            'PREVIOUS RESULT TO AVOID COPYING VERBATIM: ' + JSON.stringify(previousCachedResult)
          ].join('\n');
          let alternativeRaw = '';
          try {
            alternativeRaw = await localCompletion([{ role: 'user', content: alternativePrompt }], {
              temperature: 0.85, max_tokens: 320, response_format: { type: 'json_object' }
            });
          } catch (alternativeError) {
            if (/response.?format|json.?object|unsupported|unknown.*parameter|invalid.*parameter/i.test(alternativeError.message || '')) {
              alternativeRaw = await localCompletion([{ role: 'user', content: alternativePrompt }], {
                temperature: 0.85, max_tokens: 320
              }).catch(error => {
                console.warn('Alternative meaning refresh retry failed:', error);
                return '';
              });
            } else {
              console.warn('Alternative meaning refresh retry failed:', alternativeError);
            }
          }
          const alternativeResult = normalizeMeaningResult(parseJsonObject(alternativeRaw));
          if (alternativeResult && meaningSignature(alternativeResult) !== meaningSignature(previousCachedResult)) {
            result = alternativeResult;
          }
        }

        if (!result) {
          console.error('Local dictionary model returned invalid JSON:', String(raw).slice(0, 1200));
          return {
            meanings: [{ text: 'مدل خروجی معتبری تولید نکرد. دوباره روی کلمه کلیک کن.', type: 'خطا' }],
            synonyms: [],
            antonyms: []
          };
        }
        await this.db.set('word_meanings', { word: lowerWord, value: result }).catch(error => {
          console.debug('Local dictionary cache write failed:', error);
        });
        return result;
      } catch (error) {
        console.error('Local Provider 3 dictionary error:', error);
        return {
          meanings: [{ text: 'خطا در دریافت معنی: ' + (error?.message || String(error)), type: 'خطا' }],
          synonyms: [],
          antonyms: []
        };
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
        await playLocalBlob(this, audioBlob, button, progressBar, text);
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
    // The speaker button below chat messages and document pages uses
    // AdvancedTTSPlayer.generateFullAudio(), not AIChatApp.playTextToSpeech().
    // The original method checks for a cloud API key and silently returns null,
    // which made local Pocket TTS fail even when the service was reachable.
    const originalAdvancedGenerateFullAudio = AdvancedTTSPlayer.prototype.generateFullAudio;
    if (typeof originalAdvancedGenerateFullAudio === 'function') {
      AdvancedTTSPlayer.prototype.generateFullAudio = async function(text) {
        if (this.app?.ttsProvider !== 'elevenlabs') {
          return originalAdvancedGenerateFullAudio.call(this, text);
        }

        const model = getCfg('ttsModel') || DEFAULTS.ttsModel;
        const voice = getCfg('ttsVoice') || DEFAULTS.ttsVoice;
        // Versioned cache key prevents legacy/cloud audio cached under full_<text>
        // from being used when the selected provider is Pocket TTS.
        const cacheKey = 'full_local_pocket_tts_' + model + '_' + voice + '_' + String(text ?? '');
        try {
          const cachedAudio = await this.app.db.get('audio_cache', cacheKey);
          if (cachedAudio?.value instanceof Blob && cachedAudio.value.size > 0) {
            return cachedAudio.value;
          }
        } catch (error) {
          console.debug('Pocket TTS audio cache read failed; synthesizing fresh audio:', error);
        }

        const audioBlob = await localTTS(text);
        if (!(audioBlob instanceof Blob) || audioBlob.size === 0) {
          throw new Error('Pocket TTS returned no audio data.');
        }
        await this.app.db.set('audio_cache', { text: cacheKey, value: audioBlob })
          .catch(error => console.debug('Pocket TTS audio cache write failed:', error));
        return audioBlob;
      };
    }

    // The original player method also requires an ElevenLabs key. For Provider 3,
    // bypass that cloud-only path for simple message/sentence playback as well.
    const originalAdvancedPlayTextToSpeech = AdvancedTTSPlayer.prototype.playTextToSpeech;
    if (typeof originalAdvancedPlayTextToSpeech === 'function') {
      AdvancedTTSPlayer.prototype.playTextToSpeech = async function(text, button, progressBar, messageId) {
        if (this.app?.ttsProvider === 'elevenlabs') {
          try {
            const audioBlob = await localTTS(text);
            await playLocalBlob(this.app, audioBlob, button, progressBar, text);
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
  const beginRealtimeSegmentRecorder = (app, session, now, initialVoiceMs = 0) => {
    const recorder = makeRealtimeRecorder(session.stream);
    const capture = { id: (session.captureSequence = (session.captureSequence || 0) + 1), chunks: [], voiceActiveMs: initialVoiceMs, discarded: false };
    recorder.wordLensCapture = capture;
    session.recorder = recorder;
    session.speechStartedAt = now;
    session.lastVoiceAt = now;
    session.voiceActiveMs = initialVoiceMs;
    recorder.ondataavailable = event => {
      if (event.data?.size && !capture.discarded) capture.chunks.push(event.data);
    };
    recorder.onerror = event => {
      console.error('Realtime recorder error:', event.error || event);
      realtimeSetStatus(app, 'Microphone capture error. Stop and restart if it continues.', 'error');
    };
    recorder.onstop = () => {
      if (session.recorder === recorder) session.recorder = null;
      if (!session.active || capture.discarded) return;
      if (capture.voiceActiveMs < 240) {
        if (['recording', 'processing'].includes(session.state)) {
          session.state = 'listening';
          realtimeSetStatus(app, 'Listening — ignoring a short noise.', 'listening');
        }
        return;
      }
      const blob = new Blob(capture.chunks, { type: recorder.mimeType || capture.chunks[0]?.type || 'audio/webm' });
      if (!blob.size) {
        session.state = 'listening';
        realtimeSetStatus(app, 'Listening — no usable audio captured.', 'listening');
        return;
      }
      session.state = 'processing';
      realtimeSetStatus(app, 'Transcribing your turn…', 'processing');
      app.processRealtimeAudio(blob, session, capture.id);
    };
    recorder.start(100);
    return recorder;
  };
  const makeAbortError = (message = 'Realtime operation cancelled.') => {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  };
  const playRealtimeAudio = async (blob, session, options = {}) => {
    const signal = options?.signal;
    const isCancelled = () => !session?.active || session.interruptedTurn || signal?.aborted;
    const assertActive = () => { if (isCancelled()) throw makeAbortError(); };
    if (!blob || !blob.size) throw new Error('TTS returned an empty audio file.');
    assertActive();

    const context = session?.audioContext;
    if (context && context.state !== 'closed' && typeof context.decodeAudioData === 'function') {
      try {
        await context.resume();
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        assertActive();
        const source = context.createBufferSource();
        source.buffer = decoded;
        source.connect(context.destination);
        session.audio = source;
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = error => {
            if (settled) return;
            settled = true;
            source.onended = null;
            if (session.audio === source) session.audio = null;
            if (session.audioStop === stop) session.audioStop = null;
            if (error) reject(error); else resolve();
          };
          const stop = () => {
            if (settled) return;
            try { source.stop(); } catch (_) {}
            finish();
          };
          source.onended = () => finish();
          session.audioStop = stop;
          try {
            assertActive();
            source.start(0);
          } catch (error) { finish(error); }
        });
        return;
      } catch (error) {
        if (isCancelled()) {
          if (session.audioStop) session.audioStop();
          session.audio = null;
          session.audioStop = null;
          throw error?.name === 'AbortError' ? error : makeAbortError();
        }
        if (session.audio) session.audio = null;
        if (session.audioStop) session.audioStop();
        session.audioStop = null;
        console.debug('Web Audio playback unavailable; falling back to a media element:', error);
      }
    }

    assertActive();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    session.audio = audio;
    try {
      const ended = new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          audio.removeEventListener('ended', onEnded);
          audio.removeEventListener('error', onError);
          if (session.audioStop === stop) session.audioStop = null;
          if (error) reject(error); else resolve();
        };
        const onEnded = () => finish();
        const onError = () => finish(new Error('The browser could not play the TTS audio.'));
        const stop = () => {
          try { audio.pause(); audio.currentTime = 0; } catch (_) {}
          finish();
        };
        session.audioStop = stop;
        audio.addEventListener('ended', onEnded, { once: true });
        audio.addEventListener('error', onError, { once: true });
      });
      assertActive();
      await audio.play();
      await ended;
    } finally {
      if (session.audio === audio) session.audio = null;
      if (session.audioStop) session.audioStop();
      URL.revokeObjectURL(url);
    }
  };

  if (typeof AIChatApp !== 'undefined') {
    ['callGeminiChatAPI','callAvalaiChatAPI','callOpenRouterChatAPI'].forEach(methodName=>{
      const originalMethod=AIChatApp.prototype[methodName]; if(typeof originalMethod!=='function')return;
      AIChatApp.prototype[methodName]=async function(...args){
        const message=args[0];
        const chat=this.chats?.find(item=>item.id===this.currentChatId), last=chat?.messages?.[chat.messages.length-1];
        const matches=!!(last&&last.role==='user'&&String(last.content??'')===String(message??'')); if(matches)chat.messages.pop();
        try{return await originalMethod.apply(this,args);}finally{if(matches)chat.messages.push(last);}
      };
    });
    AIChatApp.prototype.transcribeAudio=async function(audioBlob){
      const previousPlaceholder=this.messageInput?.placeholder||'Type a message...';
      if(this.messageInput){this.messageInput.placeholder='Transcribing audio…';this.messageInput.disabled=true;}
      try {
        // Use the same bounded request/response handling for both local whisper.cpp
        // and Avalai; the legacy app method has no network deadline and can hang.
        const transcript=await localSTT(audioBlob,this);
        if(this.messageInput){
          this.messageInput.value=transcript;
          this.adjustTextareaHeight();
          this.messageInput.focus();
        }
      } catch(error) {
        console.error('STT transcription error:',error);
        this.showToast('Transcription failed: '+error.message,'error');
      } finally {
        if(this.messageInput){
          this.messageInput.placeholder=previousPlaceholder;
          this.messageInput.disabled=false;
        }
      }
    };
    const originalBindEvents=AIChatApp.prototype.bindEvents;
    AIChatApp.prototype.bindEvents=function(){originalBindEvents.call(this);window.WORDLENS_APP=this;this.realtimeBtn=document.getElementById('realtime-btn');this.realtimeStatus=document.getElementById('realtime-status');this.realtimeSession=null;this.realtimeStarting=false;
      this.realtimeBtn?.addEventListener('click',()=>{if(this.realtimeSession)this.stopRealtimeConversation();else this.startRealtimeConversation();});
    };
    AIChatApp.prototype.validateRealtimeConfiguration = async function() {
      if (!usesProxy()) {
        if (!getCfg('llmBase')) throw new Error('Set the LLM Base URL under Settings → Provider 3 — API Connections.');
        if (!getCfg('ttsBase')) throw new Error('Set the TTS Base URL under Settings → Provider 3 — API Connections.');
        if (getCfg('sttProvider') === 'avalai') {
          if (!this.AVALAI_API_KEY) throw new Error('Avalai STT is selected, but its API key is not set in Settings.');
        } else if (!getCfg('sttBase')) throw new Error('Set the STT Base URL under Settings → Provider 3 — API Connections.');
        return;
      }
      let response;
      try { response = await fetch('/local-api/config', { cache: 'no-store' }); }
      catch (_) { throw new Error('The local API proxy is not reachable. Run python server.py and open http://127.0.0.1:8000, or switch Connection Mode to Direct.'); }
      if (!response.ok) throw new Error('The local proxy is not available at this page origin. Run WordLens using server.py or switch Connection Mode to Direct.');
      const config = await response.json();
      if (getCfg('sttProvider') !== 'avalai' && !String(config.stt_base || '').trim()) {
        throw new Error('STT address is missing. Open Settings → Provider 3 — API Connections, enter the STT Base URL, then Save Settings.');
      }
      const healthResponse = await fetch('/local-api/health', { cache: 'no-store' });
      if (!healthResponse.ok) throw new Error('Local LLM/TTS health check failed. Verify their Base URLs and make sure both servers are running.');
      const health = await healthResponse.json();
      if (health.status !== 'ok') throw new Error('Local proxy could not reach the configured LLM/TTS servers: ' + (health.message || 'unknown upstream error'));
    };

    AIChatApp.prototype.startRealtimeConversation=async function(){
      if(this.realtimeStarting||this.realtimeSession)return;
      if(!this.currentChatId){this.showToast('Open or create a chat before starting a live conversation.','warning');return;}
      if(this.isLoading){this.showToast('Wait for the current response to finish before starting live conversation.','warning');return;}
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){this.showToast('Microphone capture requires a supported browser over HTTPS or localhost.','error');return;}
      this.realtimeStarting=true;if(this.realtimeBtn)this.realtimeBtn.disabled=true;
      realtimeSetStatus(this,'Checking API connections…','processing');
      try { await this.validateRealtimeConfiguration(); }
      catch (error) {
        if(this.realtimeBtn)this.realtimeBtn.disabled=false;
        realtimeSetStatus(this,error.message,'error');
        this.showToast(error.message,'error');
        this.realtimeStarting=false;
        return;
      }
      realtimeSetStatus(this,'Requesting microphone access…','processing');
      let stream=null,audioContext=null;
      try{
        stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
        const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Web Audio is not supported by this browser.');
        audioContext=new Context();await audioContext.resume();const analyser=audioContext.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0.15;
        const source=audioContext.createMediaStreamSource(stream);source.connect(analyser);
        const session={active:true,stream,audioContext,analyser,source,frameId:0,recorder:null,chunks:[],state:'listening',noiseFloor:0.002,threshold:0.012,speechStartedAt:0,lastVoiceAt:0,voiceActiveMs:0,lastVADFrameAt:0,audio:null,audioStop:null,turnController:null,turnSettled:Promise.resolve(),resolveTurnSettled:null,interruptedTurn:false,captureSequence:0,bargeCandidateAt:0,bargeLastEnergyAt:0,bargeResumeState:'',bargeCooldownUntil:0,bargeThreshold:0,bargeCandidatePromise:null,resolveBargeCandidate:null};
        this.realtimeSession=session;
        if(this.realtimeBtn){this.realtimeBtn.disabled=false;this.realtimeBtn.classList.add('active');this.realtimeBtn.setAttribute('aria-pressed','true');this.realtimeBtn.title='Stop live conversation';this.realtimeBtn.setAttribute('aria-label','Stop live conversation');}
        if(this.voiceBtn)this.voiceBtn.disabled=true;realtimeSetStatus(this,'Listening — speak naturally, then pause briefly when you finish a turn.','listening');this.tickRealtimeConversation(session);
      }catch(error){console.error('Failed to start live conversation:',error);if(stream)stream.getTracks().forEach(track=>track.stop());if(audioContext&&audioContext.state!=='closed')audioContext.close().catch(()=>{});
        if(this.realtimeBtn)this.realtimeBtn.disabled=false;realtimeSetStatus(this,'Could not start microphone: '+error.message,'error');this.showToast('Live conversation could not start: '+error.message,'error');
      }finally{this.realtimeStarting=false;}
    };
    AIChatApp.prototype.stopRealtimeConversation=function(){
      const session=this.realtimeSession;if(!session)return;session.active=false;if(session.frameId)cancelAnimationFrame(session.frameId);
      if(session.resolveBargeCandidate){const resolveCandidate=session.resolveBargeCandidate;session.resolveBargeCandidate=null;session.bargeCandidatePromise=null;resolveCandidate(true);}
      if(session.turnController&&!session.turnController.signal.aborted)session.turnController.abort();
      if(session.resolveTurnSettled){const resolveTurn=session.resolveTurnSettled;session.resolveTurnSettled=null;resolveTurn();}
      if(session.recorder&&session.recorder.state!=='inactive'){try{session.recorder.stop();}catch(_){}}
      if(session.audio){try{session.audio.pause();session.audio.currentTime=0;}catch(_){}if(session.audioStop)session.audioStop();}
      if(session.stream)session.stream.getTracks().forEach(track=>track.stop());if(session.audioContext&&session.audioContext.state!=='closed')session.audioContext.close().catch(()=>{});
      this.realtimeSession=null;if(this.realtimeBtn){this.realtimeBtn.disabled=false;this.realtimeBtn.classList.remove('active');this.realtimeBtn.setAttribute('aria-pressed','false');this.realtimeBtn.title='Start live conversation';this.realtimeBtn.setAttribute('aria-label','Start live conversation');}
      if(this.voiceBtn)this.voiceBtn.disabled=false;realtimeSetStatus(this,'Live conversation stopped.','idle');
    };
    AIChatApp.prototype.tickRealtimeConversation=function(session){
      if(!session?.active||this.realtimeSession!==session)return;
      try{
        const samples=new Float32Array(session.analyser.fftSize);
        session.analyser.getFloatTimeDomainData(samples);
        let squares=0, crossings=0;
        for(let i=0;i<samples.length;i++){
          squares+=samples[i]*samples[i];
          if(i>0&&((samples[i]>=0)!==(samples[i-1]>=0)))crossings++;
        }
        const rms=Math.sqrt(squares/samples.length),now=performance.now();
        const frameDelta=Math.min(40,Math.max(0,now-(session.lastVADFrameAt||now)));
        session.lastVADFrameAt=now;
        const zeroCrossingRate=crossings/Math.max(1,samples.length);

        const assistantState=this.isLoading&&['thinking','synthesizing','speaking'].includes(session.state);
        if(assistantState&&now>=session.bargeCooldownUntil){
          const bargeThreshold=session.state==='speaking'
            ? Math.max(0.032,session.threshold*2.4,session.noiseFloor*9)
            : Math.max(0.018,session.threshold*1.5,session.noiseFloor*6);
          if(rms>bargeThreshold){
            if(session.state!=='barge-candidate'){
              session.bargeResumeState=session.state;
              session.bargeCandidateAt=now;
              session.bargeLastEnergyAt=now;
              session.bargeThreshold=bargeThreshold;
              beginRealtimeSegmentRecorder(this,session,now,0);
              session.bargeCandidatePromise=new Promise(resolve=>{session.resolveBargeCandidate=resolve;});
              session.state='barge-candidate';
              realtimeSetStatus(this,'Listening for your interruption…','processing');
            }else{
              session.bargeLastEnergyAt=now;
              if(zeroCrossingRate<0.30&&session.recorder?.wordLensCapture){
                session.recorder.wordLensCapture.voiceActiveMs+=frameDelta;
              }
            }
          }
        }else if(session.state==='barge-candidate'){
          const threshold=session.bargeThreshold||Math.max(0.028,session.threshold*2.2);
          if(rms>threshold){
            session.bargeLastEnergyAt=now;
            session.lastVoiceAt=now;
            if(zeroCrossingRate<0.30&&session.recorder?.wordLensCapture){
              session.recorder.wordLensCapture.voiceActiveMs+=frameDelta;
            }
          }
          const candidateAge=now-session.bargeCandidateAt;
          const quietGap=now-session.bargeLastEnergyAt;
          const activeVoiceMs=session.recorder?.wordLensCapture?.voiceActiveMs||0;
          if(candidateAge>=340&&activeVoiceMs>=250&&quietGap<=120){
            session.state='recording';
            session.interruptedTurn=true;
            session.bargeCandidateAt=0;
            const resolveCandidate=session.resolveBargeCandidate;
            session.resolveBargeCandidate=null;session.bargeCandidatePromise=null;
            if(resolveCandidate)resolveCandidate(true);
            if(session.turnController&&!session.turnController.signal.aborted)session.turnController.abort();
            if(session.audioStop)session.audioStop();
            realtimeSetStatus(this,'Interrupted — recording your turn…','recording');
          }else if(quietGap>180||candidateAge>1000){
            const recorder=session.recorder;
            if(recorder&&recorder.state!=='inactive'){
              if(recorder.wordLensCapture)recorder.wordLensCapture.discarded=true;
              session.recorder=null;
              try{recorder.stop();}catch(_){}
            }
            session.state=session.bargeResumeState||'listening';
            session.bargeCandidateAt=0;
            session.bargeLastEnergyAt=0;
            session.bargeCooldownUntil=now+180;
            const resolveCandidate=session.resolveBargeCandidate;
            session.resolveBargeCandidate=null;session.bargeCandidatePromise=null;
            if(resolveCandidate)resolveCandidate(false);
            if(session.state==='speaking')realtimeSetStatus(this,'Speaking — talk to interrupt.','speaking');
            else realtimeSetStatus(this,session.state==='thinking'?'Thinking…':'Preparing speech…','processing');
          }
        }else if(session.state==='listening'&&!this.isLoading){
          session.noiseFloor=rms<session.noiseFloor*3?session.noiseFloor*0.96+rms*0.04:session.noiseFloor;
          session.threshold=Math.max(0.012,session.noiseFloor*3.2);
          if(rms>session.threshold){
            try{
              beginRealtimeSegmentRecorder(this,session,now,0);
              session.state='recording';
              realtimeSetStatus(this,'Recording your turn… pause when you finish speaking.','recording');
            }catch(error){
              console.error('Could not start realtime audio segment:',error);
              realtimeSetStatus(this,'Microphone recording failed: '+error.message,'error');
            }
          }
        }else if(session.state==='recording'){
          if(rms>session.threshold){
            session.lastVoiceAt=now;
            if(session.recorder?.wordLensCapture)session.recorder.wordLensCapture.voiceActiveMs+=frameDelta;
          }
          const duration=now-session.speechStartedAt;
          if((duration>650&&now-session.lastVoiceAt>850)||duration>18000){
            session.state='processing';
            realtimeSetStatus(this,'Transcribing your turn…','processing');
            const recorder=session.recorder;
            if(recorder&&recorder.state!=='inactive')recorder.stop();
          }
        }
      }catch(error){console.error('Realtime voice activity detection error:',error);}
      if(session.active)session.frameId=requestAnimationFrame(()=>this.tickRealtimeConversation(session));
    };
    AIChatApp.prototype.processRealtimeAudio=async function(audioBlob,session,captureId){
      let failed=false;
      try{
        // Do not start STT/another model job until the interrupted LLM/TTS
        // turn has unwound and released the shared loading lock.
        if(session.interruptedTurn&&session.turnSettled)await session.turnSettled;
        if(!session.active||this.realtimeSession!==session)return;
        realtimeSetStatus(this,'Transcribing your turn…','processing');
        const transcript=await localSTT(audioBlob,this);
        if(!session.active||this.realtimeSession!==session)return;
        if(!transcript){
          session.interruptedTurn=false;
          return;
        }
        session.interruptedTurn=false;
        await this.processRealtimeTurn(transcript,session);
      }catch(error){
        failed=true;
        if(error?.name==='AbortError'&&(!session.active||session.interruptedTurn))return;
        console.error('Realtime STT/turn processing failed:',error);
        if(session.active){realtimeSetStatus(this,'Voice turn failed: '+error.message,'error');this.showToast('Live conversation error: '+error.message,'error');}
      }finally{
        if(session.active&&this.realtimeSession===session&&session.state==='processing'&&(!captureId||session.captureSequence===captureId)){
          session.state='listening';
          if(session.lastError){realtimeSetStatus(this,session.lastError,'error');session.lastError='';}
          else if(!failed)realtimeSetStatus(this,'Listening — speak when ready.','listening');
        }
      }
    };
    AIChatApp.prototype.processRealtimeTurn=async function(transcript,session){
      if(!this.currentChatId||!session.active||this.realtimeSession!==session||this.isLoading)return;
      const controller=new AbortController();
      session.turnController=controller;
      let resolveTurn;
      const turnSettled=new Promise(resolve=>{resolveTurn=resolve;});
      session.turnSettled=turnSettled;
      session.resolveTurnSettled=resolveTurn;
      this.addMessage('user',transcript);
      const loadingWrapper=document.createElement('div');
      loadingWrapper.className='message-wrapper ai';
      const loadingDiv=document.createElement('div');
      loadingDiv.className='message ai';
      loadingDiv.innerHTML='<div class="typing-indicator"><span></span><span></span><span></span></div>';
      loadingWrapper.appendChild(loadingDiv);
      this.messagesDiv.appendChild(loadingWrapper);
      this.scrollToBottom();
      this.isLoading=true;
      try{
        session.state='thinking';
        realtimeSetStatus(this,'Thinking… speak any time to interrupt.','processing');
        const answer=this.chatProvider==='openrouter'
          ? await this.callOpenRouterChatAPI(transcript,{signal:controller.signal})
          : await this.callChatAPI(transcript);
        if(session.state==='barge-candidate'&&session.bargeCandidatePromise)await session.bargeCandidatePromise;
        if(!session.active||controller.signal.aborted||session.interruptedTurn){loadingWrapper.remove();return;}
        loadingWrapper.remove();
        this.addMessage('ai',answer);

        const chat=this.chats.find(item=>item.id===this.currentChatId);
        const assistantMessage=chat?.messages?.[chat.messages.length-1];
        const assistantMessageId=assistantMessage?.role==='ai'?assistantMessage.id:null;
        const assistantMessageElement=assistantMessageId?document.getElementById(assistantMessageId):null;
        const visibleMessage=assistantMessageElement?.querySelector('.message');
        const speechText=String(visibleMessage
          ? (typeof visibleMessage.innerText==='string'?visibleMessage.innerText:visibleMessage.textContent)
          : answer).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')
          .split('\n').map(line=>line.replace(/[ \t]+$/g,'')).join('\n')
          .replace(/\n{3,}/g,'\n\n').trim();
        if(chat&&chat.messages.length===2&&!String(chat.title||'').includes('(Imported)')){
          chat.title=transcript.substring(0,30)+(transcript.length>30?'...':'');
          this.saveChats();
          this.renderChatList();
          this.chatTitle.textContent=chat.title;
        }

        if(session.active&&this.realtimeSession===session&&answer.trim()){
          session.state='synthesizing';
          realtimeSetStatus(this,'Preparing speech… you can interrupt.','processing');
          const audioBlob=await localTTS(speechText,{signal:controller.signal});
          if(!audioBlob||!audioBlob.size)throw new Error('TTS returned an empty audio file.');

          // Store the exact live-generated audio under the cache keys used by
          // both the standard player and the local TTS adapter. Clicking the
          // speaker later will replay this Blob instead of synthesizing again.
          const model=getCfg('ttsModel')||DEFAULTS.ttsModel;
          const voice=getCfg('ttsVoice')||DEFAULTS.ttsVoice;
          const cacheEntries=[
            {text:'full_'+speechText,value:audioBlob},
            {text:'full_local_pocket_tts_'+model+'_'+voice+'_'+String(speechText??''),value:audioBlob}
          ];
          await Promise.all(cacheEntries.map(entry=>this.db.set('audio_cache',entry).catch(error=>{
            console.debug('Live TTS audio cache write failed:',error);
          })));

          if(session.state==='barge-candidate'&&session.bargeCandidatePromise)await session.bargeCandidatePromise;
          if(!session.active||controller.signal.aborted||session.interruptedTurn)return;

          session.state='speaking';
          realtimeSetStatus(this,'Speaking — talk to interrupt.','speaking');

          const messageWrapper=assistantMessageId?document.getElementById(assistantMessageId):null;
          const audioControls=messageWrapper?.querySelector('.audio-controls-container');
          if(messageWrapper&&audioControls&&typeof AdvancedTTSPlayer!=='undefined'){
            // Stop any other active player before connecting the live response.
            this.activeTTSPlayers.forEach((otherPlayer,otherId)=>{
              if(otherId!==assistantMessageId&&otherPlayer){
                otherPlayer.cleanup();
                this.activeTTSPlayers.delete(otherId);
              }
            });
            const player=new AdvancedTTSPlayer(this);
            this.activeTTSPlayers.set(assistantMessageId,player);
            await player.playMessage(answer,assistantMessageId,audioControls,{
              audioBlob,
              realtimeSession:session
            });
            // Only the initial live playback participates in barge-in detection.
            // Later speaker-button replays keep the same audio and normal controls.
            player.realtimeSession=null;
            if(!session.active||controller.signal.aborted||session.interruptedTurn)return;
          }else{
            // Defensive fallback if the message/player UI could not be created.
            await playRealtimeAudio(audioBlob,session,{signal:controller.signal});
          }
        }
      }catch(error){
        loadingWrapper.remove();
        if((controller.signal.aborted||error?.name==='AbortError')&&(!session.active||session.interruptedTurn)){
          // Expected cancellation: the user interrupted or stopped the session.
        }else{
          console.error('Realtime LLM/TTS error:',error);
          this.addMessage('ai','Error: '+error.message);
          session.lastError='LLM/TTS error: '+error.message;
          if(session.active){realtimeSetStatus(this,session.lastError,'error');this.showToast(session.lastError,'error');}
        }
      }finally{
        if(session.turnController===controller)session.turnController=null;
        this.isLoading=false;
        if(session.active&&this.realtimeSession===session&&!['recording','barge-candidate','processing'].includes(session.state)){
          session.state='listening';
          if(session.lastError){realtimeSetStatus(this,session.lastError,'error');session.lastError='';}
          else realtimeSetStatus(this,'Listening — speak when ready.','listening');
        }
        if(session.resolveTurnSettled===resolveTurn)session.resolveTurnSettled=null;
        resolveTurn();
        if(this._sendQueuedAfterCurrent&&this.messageInput?.value.trim()&&this.currentChatId){
          this._sendQueuedAfterCurrent=false;
          setTimeout(()=>this.sendMessage(),0);
        }
      }
    };
    const originalSendMessage=AIChatApp.prototype.sendMessage;
    AIChatApp.prototype.sendMessage=function(){if(this.realtimeSession)this.stopRealtimeConversation();return originalSendMessage.call(this);};
  }
  window.addEventListener('DOMContentLoaded', injectLocalSettings, { once: true });
})();
