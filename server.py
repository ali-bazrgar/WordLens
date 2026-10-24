from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

PORT = int(os.environ.get("WORDLENS_PORT", "8000"))
LLM_BASE = os.environ.get("WORDLENS_LLM_BASE", "http://127.0.0.1:1234").rstrip("/")
TTS_BASE = os.environ.get("WORDLENS_TTS_BASE", "http://127.0.0.1:4321").rstrip("/")
# Leave empty until the local OpenAI-compatible STT endpoint is known.
STT_BASE = os.environ.get("WORDLENS_STT_BASE", "").rstrip("/")


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

    def _send_json_error(self, status, message):
        payload = json.dumps({"error": {"message": message}}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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

        if clean_path == "/local-api/chat/completions":
            self._proxy(openai_endpoint(LLM_BASE, "/chat/completions"), body)
            return

        if clean_path == "/local-api/audio/speech":
            self._proxy(openai_endpoint(TTS_BASE, "/audio/speech"), body)
            return

        if clean_path == "/local-api/audio/transcriptions":
            if not STT_BASE:
                self._send_json_error(503, "STT upstream is not configured. Set WORDLENS_STT_BASE to your OpenAI-compatible STT API base URL, then restart server.py.")
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
    print(f"STT:      {openai_endpoint(STT_BASE, '/audio/transcriptions') if STT_BASE else 'not configured (WORDLENS_STT_BASE is empty)'}")
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
