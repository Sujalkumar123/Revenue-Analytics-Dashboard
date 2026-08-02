"""Dev server for the Revenue Analytics frontend.

Run:  py -3 frontend/serve.py        then open http://localhost:8000/

Serves this directory (frontend/) — index.html, css/, js/ and the local
data/ ledger — with no-cache headers so edits show up on a plain refresh
(the stock http.server caches aggressively, which silently serves stale
CSS and JS). This is a static-file dev server only; once the backend/
Zoho Books integration exists, data/ will be served by that API instead
and this file will just serve the static frontend assets.
"""
import http.server
import socketserver
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # keep the console quiet except for errors
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("", PORT), Handler) as httpd:
        print(f"Revenue Analytics  ->  http://localhost:{PORT}/")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
