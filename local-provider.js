/*
 * WordLens - Local Provider 3 configuration.
 *
 * The browser uses same-origin /local-api endpoints exposed by server.py.
 * This avoids CORS and HTTPS -> HTTP mixed-content problems while keeping
 * llama.cpp and KittenTTS bound to the local machine.
 */
window.WORDLENS_LOCAL_PROVIDER = Object.freeze({
  llmBaseURL: '/local-api',
  model: 'Hy-MT2-1.8B-2Bit',
  ttsBaseURL: '/local-api',
  ttsApiKey: '123',
  ttsVoice: 'expr-voice-4-m'
});
