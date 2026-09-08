"""Development-only static server for the browser edition.

Serves the browser-edition/ directory as plain static files with the MIME
types the app needs (notably application/wasm for sql.js). The production
target is GitHub Pages (or any static host); this is only a local convenience.

Usage:
    python3 browser-edition/serve.py [--port 8012]
"""
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import mimetypes

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")

root = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=root, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--port", type=int, default=8012)
    args = parser.parse_args()
    print(f"Serving browser-edition/ at http://127.0.0.1:{args.port}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()