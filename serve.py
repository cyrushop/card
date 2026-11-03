#!/usr/bin/env python3
"""Local server for the OPCG collection app.

    python3 serve.py            # then open http://localhost:8765
    python3 serve.py --port 9000
    python3 serve.py --lan --pin 4321   # also open it from your phone on the same Wi-Fi

* Serves the app (app) and the bot output (data).
* Saves your collection to data/collection.json (with a dated backup per day),
  so it survives clearing the browser.
* Lets the app's 設定 tab run the card bot and the deck bot.

Standard library only. Listens on 127.0.0.1 only, unless you pass --lan.
"""
import argparse
import hmac
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
STATE = os.path.join(DATA, "collection.json")
BOTS = {
    "cards": [os.path.join(ROOT, "bot", "scrape_cards.py")],
    "cards-images": [os.path.join(ROOT, "bot", "scrape_cards.py"), "--images"],
    "update": [os.path.join(ROOT, "bot", "scrape_cards.py"), "--images"],  # new series, new cards, new/changed images
    "decks": [os.path.join(ROOT, "bot", "scrape_decks.py")],
    "prices": [os.path.join(ROOT, "bot", "scrape_prices.py")],
}
PIN = None  # set by --pin

LOGIN = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OPCG 卡庫</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;margin:0">
<form method="post" action="/login"><p>輸入 PIN</p><input name="pin" type="password" inputmode="numeric" autofocus
style="font-size:20px;padding:8px"> <button style="font-size:18px;padding:8px 14px">進入</button>%s</form></body>"""

state_lock = threading.Lock()
jobs = {}  # name -> {"running", "log", "code", "started"}
lock = threading.Lock()


def run_bot(name):
    with lock:
        if jobs.get(name, {}).get("running"):
            return False
        jobs[name] = {"running": True, "log": "", "code": None, "started": time.time()}

    def work():
        proc = subprocess.Popen([sys.executable, "-u", "-I"] + BOTS[name], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        for line in proc.stdout:
            with lock:
                jobs[name]["log"] = (jobs[name]["log"] + line)[-20000:]
        code = proc.wait()
        with lock:
            jobs[name].update(running=False, code=code)

    threading.Thread(target=work, daemon=True).start()
    return True


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # quieter console
        if args and "/api/" in str(args[0]):
            return
        super().log_message(fmt, *args)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if self.path.startswith("/data/") and not self.path.startswith("/data/images/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _authed(self):
        if not PIN:
            return True
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "opcg_pin" and hmac.compare_digest(v, PIN):
                return True
        return False

    def _login_page(self, msg=""):
        body = (LOGIN % msg).encode("utf-8")
        self.send_response(401 if self.path.startswith("/api/") else 200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._authed():
            return self._login_page()
        if self.path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/app/")
            self.end_headers()
            return
        if self.path.startswith("/data/raw") or self.path.startswith("/bot"):
            self.send_error(404)
            return
        if self.path == "/api/state":
            if os.path.exists(STATE):
                with open(STATE, encoding="utf-8") as f:
                    return self._json({"ok": True, "state": json.load(f)})
            return self._json({"ok": True, "state": None})
        if self.path == "/api/bot":
            with lock:
                return self._json({"ok": True, "jobs": jobs})
        return super().do_GET()

    def do_PUT(self):
        if not self._authed():
            return self._login_page()
        if self.path != "/api/state":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            state = json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            return self._json({"ok": False, "error": "bad json"}, 400)
        with state_lock:
            return self._save_state(state)

    def _save_state(self, state):
        current = None
        if os.path.exists(STATE):
            with open(STATE, encoding="utf-8") as f:
                current = json.load(f)
        cur_rev = (current or {}).get("rev") or 0
        if current is not None and (state.get("rev") or 0) != cur_rev:
            # Another device saved first: send its copy back instead of overwriting it.
            return self._json({"ok": False, "conflict": True, "state": current}, 409)
        state["rev"] = cur_rev + 1
        os.makedirs(DATA, exist_ok=True)
        backup = os.path.join(DATA, "backups", time.strftime("collection-%Y-%m-%d.json"))
        if os.path.exists(STATE) and not os.path.exists(backup):
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            shutil.copyfile(STATE, backup)
        tmp = STATE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(tmp, STATE)
        return self._json({"ok": True, "rev": state["rev"]})

    def do_POST(self):
        if self.path == "/login" and PIN:
            n = int(self.headers.get("Content-Length") or 0)
            pin = (parse_qs(self.rfile.read(n).decode("utf-8")).get("pin") or [""])[0]
            if not hmac.compare_digest(pin, PIN):
                time.sleep(1)
                return self._login_page("<p style='color:#c0392b'>PIN 不正確</p>")
            self.send_response(303)
            self.send_header("Set-Cookie", f"opcg_pin={PIN}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly")
            self.send_header("Location", "/app/")
            self.end_headers()
            return None
        if not self._authed():
            return self._login_page()
        if self.path.startswith("/api/bot/"):
            name = self.path.rsplit("/", 1)[1]
            if name not in BOTS:
                return self.send_error(404)
            started = run_bot(name)
            return self._json({"ok": True, "started": started})
        return self.send_error(404)


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 80))  # no packet is sent; picks the LAN interface
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(i for i in ips if not i.startswith("127."))


def main():
    global PIN
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="also listen on your home network (for your phone)")
    ap.add_argument("--pin", help="PIN asked on first visit (strongly advised with --lan)")
    args = ap.parse_args()
    PIN = args.pin or None
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    srv = ThreadingHTTPServer((host, args.port), Handler)
    print(f"OPCG app: http://localhost:{args.port}   (Ctrl+C to stop)")
    if args.lan:
        for ip in lan_ips():
            print(f"  phone (same Wi-Fi): http://{ip}:{args.port}")
        if not PIN:
            print("  ! no --pin: anyone on this Wi-Fi can open and change your collection")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
