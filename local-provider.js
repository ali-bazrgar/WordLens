/*
 * WordLens - Local Provider 3
 *
 * This file intentionally does not modify or replace existing provider logic.
 * It exposes the local llama.cpp endpoint and model configuration so the
 * application can use a LAN/MikroTik endpoint without hard-coding OpenRouter.
 */

window.WORDLENS_LOCAL_PROVIDER = Object.freeze({
  // Use the MikroTik address when port-forwarding 1234 to the laptop.
  // For direct LAN testing, use: http://<LAPTOP-IP>:1234/v1
  baseURL: 'http://192.168.88.1:1234/v1',
  model: 'Hy-MT2-1.8B-2Bit',
  apiKey: '',
  ttsBaseURL: 'http://192.168.88.1:4321',
  ttsApiKey: '123'
});
