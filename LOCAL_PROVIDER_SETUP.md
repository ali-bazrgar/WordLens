# Local Provider 3

Provider 3 can use the local llama.cpp server.

LLM endpoint:
- `http://192.168.88.1:1234/v1`
- Model: `Hy-MT2-1.8B-2Bit`

TTS endpoint:
- `http://192.168.88.1:4321`
- Bearer token: `123`

The MikroTik address assumes TCP port 1234 is forwarded to the laptop's llama-server and TCP port 4321 is forwarded to the laptop's TTS server. For direct LAN testing, replace `192.168.88.1` with the laptop's LAN IP.

`local-provider.js` contains these values in one isolated configuration object so existing Provider 1/2 logic is not altered by configuration alone.
