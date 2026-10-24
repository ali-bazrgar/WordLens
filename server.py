from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import ipaddress
from urllib.parse import urlparse

PORT = int(os.environ.get("WORDLENS_PORT", "8000"))
LLM_BASE = os.environ.get("WORDLENS_LLM_BASE", "http://127.0.0.1:8080").rstrip("/")
TTS_BASE = os.environ.get("WORDLENS_TTS_BASE", "http://127.0.0.1:8082").rstrip("/")
# Local whisper.cpp OpenAI-compatible STT endpoint.
STT_BASE = os.environ.get("WORDLENS_STT_BASE", "http://127.0.0.1:8767").rstrip("/")
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".wordlens")
CONFIG_FILE = os.path.join(CONFIG_DIR, "local-provider-config.json")


def _validate_upstream_url(value, allow_empty=False):
    value = str(value or "").strip().rstrip("/")
    if not value and allow_empty:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or not parsed.netloc:
        raise ValueError("Use a complete http:// or https:// API base URL.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("API base URLs must not contain credentials, query strings, or fragments.")
    if len(value) > 1000:
        raise ValueError("API base URL is too long.")
    return value


def _load_saved_config():
    global LLM_BASE, TTS_BASE, STT_BASE
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as config_file:
            config = json.load(config_file)
        LLM_BASE = _validate_upstream_url(config.get("llm_base", LLM_BASE))
        saved_tts = str(config.get("tts_base", TTS_BASE) or "").rstrip("/")
        # Migrate the previous built-in default so old local settings cannot
        # silently keep routing Pocket TTS requests to port 4321.
        if saved_tts in ("http://127.0.0.1:4321", "http://127.0.0.1:4321/v1"):
            saved_tts = TTS_BASE
        TTS_BASE = _validate_upstream_url(saved_tts or TTS_BASE)
        saved_stt = str(config.get("stt_base", STT_BASE) or "").strip().rstrip("/")
        # An empty STT address was the previous default; use the configured local Whisper endpoint.
        STT_BASE = _validate_upstream_url(saved_stt or STT_BASE, allow_empty=True)
    except FileNotFoundError:
        pass
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Warning: ignoring saved WordLens API configuration: {exc}")


_load_saved_config()


def openai_endpoint(base, path):
    """Join an OpenAI-compatible endpoint whether base includes /v1 or not."""
    clean = (base or "").rstrip("/")
    if not clean:
        raise ValueError("API base URL is not configured")
    return f"{clean}{path}" if clean.endswith("/v1") else f"{clean}/v1{path}"


def service_root(base):
    clean = (base or "").rstrip("/")
    return clean[:-3] if clean.endswith("/v1") else clean


class WordLensHandler(SimpleHTTPRequestHandler):
    """Static file server plus same-origin local AI/TTS reverse proxy."""

    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json_error(self, status, message):
        self._send_json(status, {"error": {"message": message}})

    def _is_loopback_client(self):
        try:
            address = ipaddress.ip_address(self.client_address[0])
            return address.is_loopback or (
                getattr(address, "ipv4_mapped", None) is not None
                and address.ipv4_mapped.is_loopback
            )
        except ValueError:
            return False

    def _serve_proxy_config(self, body=None):
        global LLM_BASE, TTS_BASE, STT_BASE

        # Remote devices on the LAN need to read the upstream addresses so the
        # mobile UI can verify proxy mode. These values contain no API secrets.
        # Only loopback clients may write/update the host machine's configuration.
        if self.command == "GET":
            self._send_json(200, {"llm_base": LLM_BASE, "tts_base": TTS_BASE, "stt_base": STT_BASE})
            return

        if not self._is_loopback_client():
            self._send_json_error(403, "API configuration may only be changed from this computer (localhost).")
            return

        try:
            config = json.loads((body or b"{}").decode("utf-8"))
            llm_base = _validate_upstream_url(config.get("llm_base", LLM_BASE))
            tts_base = _validate_upstream_url(config.get("tts_base", TTS_BASE))
            stt_base = _validate_upstream_url(config.get("stt_base", STT_BASE), allow_empty=True)
            os.makedirs(CONFIG_DIR, exist_ok=True)
            temp_path = CONFIG_FILE + ".tmp"
            with open(temp_path, "w", encoding="utf-8") as config_file:
                json.dump({"llm_base": llm_base, "tts_base": tts_base, "stt_base": stt_base}, config_file, indent=2)
            os.replace(temp_path, CONFIG_FILE)
            LLM_BASE, TTS_BASE, STT_BASE = llm_base, tts_base, stt_base
            self._send_json(200, {"status": "ok", "llm_base": LLM_BASE, "tts_base": TTS_BASE, "stt_base": STT_BASE})
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, OSError) as exc:
            self._send_json_error(400, str(exc))

    def _proxy(self, upstream_url, body=None):
        headers = {}
        for name in ("Content-Type", "Authorization", "Accept"):
            value = self.headers.get(name)
            if value:
                headers[name] = value

        request = Request(upstream_url, data=body, headers=headers, method=self.command)

        try:
            with urlopen(request, timeout=300) as response:
                data = response.read()
                self.send_response(response.status)
                content_type = response.headers.get("Content-Type")
                if content_type:
                    self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except HTTPError as exc:
            data = exc.read()
            content_type = exc.headers.get("Content-Type", "application/json")
            self.send_response(exc.code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (URLError, TimeoutError, OSError) as exc:
            payload = json.dumps({"error": {"message": f"Local upstream unavailable: {exc}"}}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _serve_app_js(self):
        """Serve app.js unchanged; local-provider-runtime.js is loaded explicitly by index.html."""
        app_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.js")
        try:
            with open(app_path, "r", encoding="utf-8") as app_file:
                payload = app_file.read().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(payload)
        except OSError as exc:
            payload = json.dumps({"error": {"message": f"Failed to serve app.js: {exc}"}}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        clean_path = self.path.split("?", 1)[0]

        if clean_path == "/app.js":
            self._serve_app_js()
            return

        if clean_path == "/local-api/config":
            self._serve_proxy_config()
            return

        if clean_path == "/local-api/models":
            self._proxy(openai_endpoint(LLM_BASE, "/models"))
            return

        if clean_path == "/local-api/health":
            try:
                with urlopen(openai_endpoint(LLM_BASE, "/models"), timeout=10) as llm_response:
                    llm_data = json.loads(llm_response.read().decode("utf-8"))
                with urlopen(f"{service_root(TTS_BASE)}/health", timeout=10) as tts_response:
                    tts_data = json.loads(tts_response.read().decode("utf-8"))
                payload = json.dumps({
                    "status": "ok",
                    "llm": llm_data,
                    "tts": tts_data,
                    "stt_configured": bool(STT_BASE)
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as exc:
                payload = json.dumps({"status": "error", "message": str(exc)}).encode("utf-8")
                self.send_response(502)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            return

        super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(content_length) if content_length else b""
        clean_path = self.path.split("?", 1)[0]

        if clean_path == "/local-api/config":
            self._serve_proxy_config(body)
            return

        if clean_path == "/local-api/chat/completions":
            self._proxy(openai_endpoint(LLM_BASE, "/chat/completions"), body)
            return

        if clean_path == "/local-api/tts":
            # Native Kyutai Pocket-TTS accepts multipart/form-data at /tts.
            self._proxy(f"{service_root(TTS_BASE)}/tts", body)
            return

        if clean_path == "/local-api/audio/speech":
            self._proxy(openai_endpoint(TTS_BASE, "/audio/speech"), body)
            return

        if clean_path == "/local-api/inference":
            if not STT_BASE:
                self._send_json_error(503, "STT upstream is not configured. Enter the STT Base URL in Settings > Provider 3 > API Connections and save, or set WORDLENS_STT_BASE before starting server.py.")
                return
            self._proxy(f"{service_root(STT_BASE)}/inference", body)
            return

        if clean_path == "/local-api/audio/transcriptions":
            if not STT_BASE:
                self._send_json_error(503, "STT upstream is not configured. Enter the STT Base URL in Settings > Provider 3 > API Connections and save, or set WORDLENS_STT_BASE before starting server.py.")
                return
            self._proxy(openai_endpoint(STT_BASE, "/audio/transcriptions"), body)
            return

        self.send_response(404)
        payload = b'{"error":{"message":"Not found"}}'
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), WordLensHandler)
    print("==========================================")
    print("            WordLens Server")
    print("==========================================")
    print(f"Web:      http://0.0.0.0:{PORT}")
    print(f"LLM:      {openai_endpoint(LLM_BASE, '/models')}")
    print(f"TTS:      {openai_endpoint(TTS_BASE, '/audio/speech')}")
    print(f"STT:      {openai_endpoint(STT_BASE, '/audio/transcriptions') if STT_BASE else 'not configured (set it in WordLens Settings or WORDLENS_STT_BASE)'}")
    print("Local API: /local-api/*")
    print("==========================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
