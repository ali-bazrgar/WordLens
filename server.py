from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

PORT = 8000
LLM_BASE = "http://127.0.0.1:1234"
TTS_BASE = "http://127.0.0.1:4321"


class WordLensHandler(SimpleHTTPRequestHandler):
    """Static file server plus same-origin local AI/TTS reverse proxy."""

    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _proxy(self, upstream_url, body=None):
        headers = {}
        for name in ("Content-Type", "Authorization", "Accept"):
            value = self.headers.get(name)
            if value:
                headers[name] = value

        request = Request(
            upstream_url,
            data=body,
            headers=headers,
            method=self.command,
        )

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
            payload = json.dumps({
                "error": {
                    "message": f"Local upstream unavailable: {exc}"
                }
            }).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/local-api/models":
            self._proxy(f"{LLM_BASE}/v1/models")
            return

        if self.path == "/local-api/health":
            try:
                with urlopen(f"{LLM_BASE}/v1/models", timeout=10) as llm_response:
                    llm_data = json.loads(llm_response.read().decode("utf-8"))
                with urlopen(f"{TTS_BASE}/health", timeout=10) as tts_response:
                    tts_data = json.loads(tts_response.read().decode("utf-8"))
                payload = json.dumps({
                    "status": "ok",
                    "llm": llm_data,
                    "tts": tts_data,
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as exc:
                payload = json.dumps({
                    "status": "error",
                    "message": str(exc),
                }).encode("utf-8")
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

        if self.path == "/local-api/chat/completions":
            self._proxy(f"{LLM_BASE}/v1/chat/completions", body)
            return

        if self.path == "/local-api/audio/speech":
            self._proxy(f"{TTS_BASE}/v1/audio/speech", body)
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
    print(f"LLM:      {LLM_BASE}/v1")
    print(f"TTS:      {TTS_BASE}")
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
