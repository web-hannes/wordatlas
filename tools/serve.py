"""Local dev server for docs/ that tells the browser not to cache, so edits and rebuilt data show up on reload."""

import http.server
import sys
from functools import partial
from pathlib import Path


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = Path(__file__).resolve().parent.parent / "docs"
print(f"Serving {root} at http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), partial(NoCache, directory=str(root))).serve_forever()
