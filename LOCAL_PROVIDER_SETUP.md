# WordLens — OpenAI-compatible local providers

Provider 3 supports configurable OpenAI-compatible endpoints for LLM, TTS, and STT.

## Browser settings

In **Settings → Provider 3 — OpenAI-compatible APIs**, enter the following same-origin proxy base URLs:
- LLM Base URL: `/local-api`
- TTS Base URL: `/local-api`
- STT Base URL: `/local-api`

Set model IDs, optional bearer tokens, TTS voice/format and STT language to match the services you run. A direct API base URL can also be entered in settings, but it must allow browser CORS; for hosted HTTPS pages, prefer the same-origin proxy.

## Configure the server proxy

The proxy reads these environment variables. Base URLs may include `/v1` or omit it:
- `WORDLENS_LLM_BASE`: defaults to `http://127.0.0.1:1234`
- `WORDLENS_TTS_BASE`: defaults to `http://127.0.0.1:4321`
- `WORDLENS_STT_BASE`: required for local OpenAI-compatible transcription; empty by default because the STT service port depends on the installation
- `WORDLENS_PORT`: web server port, defaults to `8000`

Example PowerShell setup. Replace the TTS and STT ports with the actual ports used by your running local services, then launch WordLens in this same terminal:

```powershell
$env:WORDLENS_LLM_BASE = "http://127.0.0.1:8080/v1"
$env:WORDLENS_TTS_BASE = "http://127.0.0.1:YOUR_TTS_PORT/v1"
$env:WORDLENS_STT_BASE = "http://127.0.0.1:YOUR_STT_PORT/v1"
python server.py
```

The same-origin proxy routes:
- `GET /local-api/models` → LLM `/v1/models`
- `POST /local-api/chat/completions` → LLM `/v1/chat/completions`
- `POST /local-api/audio/speech` → TTS `/v1/audio/speech`
- `POST /local-api/audio/transcriptions` → STT `/v1/audio/transcriptions`

Transcription sends multipart form data with `file`, `model`, optional `language`, and `response_format=json`. Speech synthesis sends `model`, `input`, `voice`, and `response_format`. OpenAI-compatible providers sometimes vary in supported model IDs and formats, so use the values accepted by the endpoint you actually run.

## Live conversation

In the chat composer, the original microphone button remains one-shot voice input and inserts a transcript in the message field. The new headset button toggles hands-free turn-taking: it detects speech and pauses, transcribes the turn, sends it to the selected chat provider, speaks the answer through the configured TTS endpoint, then resumes listening.

Open or create a chat first, allow microphone access, and use HTTPS or localhost for microphone capture. This is VAD-based STT → LLM → TTS turn-taking, not a single duplex audio-model/WebRTC session.

If local transcription returns HTTP 503, `WORDLENS_STT_BASE` is unset in the terminal that launched `server.py`. Set it to the actual base URL of your working OpenAI-compatible STT service and restart the server.
