"""Throwaway UI prototype: Python standard library only; no backend or writes."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, default=8120)
parser.add_argument("--bind", default="127.0.0.1")
args = parser.parse_args()
directory = Path(__file__).resolve().parent
server = ThreadingHTTPServer(
    (args.bind, args.port), partial(SimpleHTTPRequestHandler, directory=str(directory))
)
print(f"scene-craft UI prototype: http://{args.bind}:{args.port}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
