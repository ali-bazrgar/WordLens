# WordLens — API Connections and Live Conversation

WordLens supports OpenAI-compatible LLM, TTS and STT endpoints. API URLs are editable in **Settings → Provider 3 — API Connections**.

## Recommended setup: local proxy

1. Start the local services you want to use.
2. In the WordLens project folder, run `python server.py`.
3. Open `http://127.0.0.1:8000` in your browser. Do not open `index.html` with `file://` when using the local proxy.
4. Open **Settings → Provider 3 — API Connections**. Keep **Connection Mode** set to **Local proxy — recommended**.
5. Enter each service's actual API Base URL, model ID, and optional API key. A Base URL may end at the server root or include `/v1`; WordLens normalizes both formats.
6. Click **Test LLM + TTS connections**, then **Save Settings**.

In Local proxy mode, the URL fields represent the real upstream service URLs. When saved, WordLens sends them to the local proxy at `/local-api/config`. The configuration is persisted in `%USERPROFILE%\\.wordlens\\local-provider-config.json` on Windows (or `~/.wordlens/local-provider-config.json` on Linux/macOS), so you do not need to edit `server.py` or guess a service port. Only requests from the same computer can change this configuration. Saved UI settings take precedence over environment-variable defaults.

### Base URL meaning

- **LLM Base URL**: API root for chat completions; e.g. `http://127.0.0.1:8080` or `http://127.0.0.1:8080/v1`.
- **TTS Base URL**: `http://127.0.0.1:8082` by default; Pocket TTS is called through `/v1/audio/speech` when OpenAI-compatible, with a native `/tts` fallback.
- **STT Base URL**: `http://127.0.0.1:8767` by default; change it if your local Whisper server uses a different port.
- **TTS model/voice/format** and **STT model/language** must match the specific servers. `en`, `fa`, and `auto` are typical language choices; only use values supported by your STT endpoint.

For local `whisper.cpp`, WordLens converts browser microphone audio to 16 kHz mono WAV and calls the native `/inference` route first; OpenAI-compatible `/v1/audio/transcriptions` is the fallback. Both request and response-body reads are bounded by a timeout, and audio conversion has its own deadline, so the UI should return an actionable error rather than remain on `Transcribing…` indefinitely. Set the STT Base URL to the server root or its `/v1` API root; do not append `/audio/transcriptions` or `/inference` yourself.

### Pocket TTS compatibility

WordLens now defaults Provider 3 to model `pocket-tts` and voice `clone`. It tries the OpenAI-compatible `/v1/audio/speech` endpoint first. If the endpoint is unavailable or rejects that request format, it retries the native Kyutai Pocket TTS `/tts` endpoint using multipart form data. The native endpoint uses the voice configured as the Pocket TTS server's default; set that default to your cloned voice. The API key is blank by default for local servers. Legacy defaults (`4321`, `kitten-tts-mini-0.8`, the previous voice, and the former first-provider startup defaults) are migrated automatically; explicitly selected Provider 2 or Provider 3 preferences are preserved.

## Direct API mode

Choose **Direct API — CORS required** if the app is served somewhere other than the local `server.py` proxy. The browser calls the configured base URLs itself, so each endpoint must permit cross-origin requests. When the page is hosted on HTTPS, the browser may also block plain-HTTP local endpoints; use WordLens via `http://127.0.0.1:8000` for the recommended local setup.

## API routes provided by the local proxy

- `GET /local-api/config` — read the currently configured upstream URLs.
- `POST /local-api/config` — save upstream URLs (loopback clients only).
- `GET /local-api/models` → LLM `/v1/models`.
- `POST /local-api/chat/completions` → LLM `/v1/chat/completions`.
- `POST /local-api/audio/speech` → TTS `/v1/audio/speech`.
- `POST /local-api/audio/transcriptions` → STT `/v1/audio/transcriptions`.
- `POST /local-api/inference` → STT native `/inference` (used as a compatibility fallback for `whisper.cpp`).
- `GET /local-api/health` — checks LLM/TTS reachability and reports whether STT is configured.

## Live voice conversation

The headset button next to the original microphone button toggles hands-free, pause-detected turn-taking: microphone → STT → the selected chat LLM → TTS playback → listen again. The original microphone button still records a one-shot clip and inserts its transcript in the message field.

Open or create a chat first and allow microphone access. Browsers require a secure context for microphone capture. Prefer HTTPS with a trusted certificate; for a temporary local-LAN test in Chrome, the private IP origin may need to be explicitly treated as secure in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, followed by a browser relaunch. This flag relaxes security protections and should only be used for your trusted local WordLens server.

When WordLens is opened from a private LAN address (for example, `http://192.168.x.x:8000`), **Local proxy** mode sends API requests through that host's `/local-api` proxy. The upstream LLM/TTS/STT Base URLs are controlled by the PC running `server.py` and are read-only on a remote phone in this mode.

The **Direct API** option remains available on phones if the local proxy cannot be reached. In Direct mode, the browser calls the API services itself, so each service must listen for LAN connections, allow browser CORS, and be permitted through Windows Firewall. WordLens derives the host address from the page URL and rewrites stale loopback/private-IP Base URLs to that current host where possible; it does not scan the network or configure the model servers/firewall automatically. If all models run on the same PC, Local proxy is preferred because it needs no per-service CORS setup.

Before opening the microphone, Live Conversation checks the local proxy, LLM/TTS health, and whether an STT URL is configured; transcription errors identify the failed request and include LAN connectivity guidance when applicable.

If the button is visible but not responding, hard-refresh the page and check that `local-provider-runtime.js` is loaded successfully in the browser's Network panel. The page loads this file explicitly; the Python server no longer appends it to `app.js`, which prevents missing or duplicate event bindings.

One caveat: this is automatic turn-taking over three OpenAI-compatible APIs, not a single native duplex audio/WebRTC model. STT/TTS services may vary in their supported model IDs, formats and response behavior.

## Troubleshooting mobile and slow requests

- If sending a chat message while another response is generating, the typed message is queued and sent after the current request finishes rather than discarded.
- Local LLM responses have a 180-second deadline. Local STT tries `/inference` first and falls back to `/v1/audio/transcriptions`; a stalled STT request/response is stopped after 60 seconds. If that timeout occurs repeatedly, check the WordLens terminal for an upstream error and test `http://127.0.0.1:8767/health` or the server's documented health route on the PC.
- If Local proxy fails from the phone even though the page loads, confirm the PC and phone are on the same Wi-Fi and allow inbound TCP 8000 in Windows Firewall. Since requests are same-origin, browser CORS is not required for Local proxy mode.
