from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import time


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "tmp"
OUT_FILE = OUT_DIR / "latest-diagnostics.json"
PORT = 18765


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_POST(self):
        if self.path != "/loudease":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        OUT_DIR.mkdir(exist_ok=True)
        payload["_receivedAt"] = int(time.time() * 1000)
        OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()

    def log_message(self, format, *args):
        return


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Listening on http://127.0.0.1:{PORT}/loudease")
    print(f"Writing {OUT_FILE}")
    server.serve_forever()


if __name__ == "__main__":
    main()
