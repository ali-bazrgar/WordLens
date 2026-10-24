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
- **TTS Base URL**: API root for speech generation; enter the actual port of your TTS server.
- **STT Base URL**: API root for transcription; enter the actual port of your STT server. It is intentionally blank by default because the correct port depends on your running STT service.
- **TTS model/voice/format** and **STT model/language** must match the specific servers. `en`, `fa`, and `auto` are typical language choices; only use values supported by your STT endpoint.

## Direct API mode

Choose **Direct API — CORS required** if the app is served somewhere other than the local `server.py` proxy. The browser calls the configured base URLs itself, so each endpoint must permit cross-origin requests. When the page is hosted on HTTPS, the browser may also block plain-HTTP local endpoints; use WordLens via `http://127.0.0.1:8000` for the recommended local setup.

## API routes provided by the local proxy

- `GET /local-api/config` — read the currently configured upstream URLs.
- `POST /local-api/config` — save upstream URLs (loopback clients only).
- `GET /local-api/models` → LLM `/v1/models`.
- `POST /local-api/chat/completions` → LLM `/v1/chat/completions`.
- `POST /local-api/audio/speech` → TTS `/v1/audio/speech`.
- `POST /local-api/audio/transcriptions` → STT `/v1/audio/transcriptions`.
- `GET /local-api/health` — checks LLM/TTS reachability and reports whether STT is configured.

## Live voice conversation

The headset button next to the original microphone button toggles hands-free, pause-detected turn-taking: microphone → STT → the selected chat LLM → TTS playback → listen again. The original microphone button still records a one-shot clip and inserts its transcript in the message field.

Open or create a chat first, allow microphone access, and use HTTPS or localhost. Before opening the microphone, Live Conversation checks the local proxy, LLM/TTS health, and whether an STT URL is configured; it displays a specific error rather than silently appearing not to work.

If the button is visible but not responding, hard-refresh the page and check that `local-provider-runtime.js` is loaded successfully in the browser's Network panel. The page loads this file explicitly; the Python server no longer appends it to `app.js`, which prevents missing or duplicate event bindings.

One caveat: this is automatic turn-taking over three OpenAI-compatible APIs, not a single native duplex audio/WebRTC model. STT/TTS services may vary in their supported model IDs, formats and response behavior.
