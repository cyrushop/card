#!/usr/bin/env python3
"""Server for the OPCG collection app.

    python3 serve.py                    # this computer only: http://localhost:8765
    python3 serve.py --port 9000
    python3 serve.py --lan --pin 4321   # also from a phone on the same Wi-Fi
    python3 serve.py --cloud            # online (Cloud Run): see deploy/README.md

* Serves the app (app/) and the bot output (data/).
* Saves the collection to data/collection.json (with a dated backup per day).
* Lets the app's Settings page run the bots, and (computer version) runs the
  automatic updates chosen in Settings every 30 minutes while it is open.

Settings from the environment (used by --cloud):
    OPCG_DATA        folder for data (default: ./data). On Cloud Run: a mounted
                     Cloud Storage bucket, e.g. /data.
    ALLOWED_EMAILS   comma list of Google accounts allowed in. Checked against the
                     header Identity-Aware Proxy (IAP) adds to every request.
    OPCG_PIN         PIN asked on first visit (same as --pin).
    PORT             port to listen on (Cloud Run sets it).

Standard library only.
"""
import argparse
import hmac
import json
import os
import posixpath
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(ROOT, "data"))
STATE = os.path.join(DATA, "collection.json")
BOTS = {
    "cards": [os.path.join(ROOT, "bot", "scrape_cards.py")],
    "cards-images": [os.path.join(ROOT, "bot", "scrape_cards.py"), "--images"],
    "update": [os.path.join(ROOT, "bot", "scrape_cards.py"), "--images"],  # new series, new cards, new/changed images
    "decks": [os.path.join(ROOT, "bot", "scrape_decks.py")],
    "prices": [os.path.join(ROOT, "bot", "scrape_prices.py")],
    "auto": [os.path.join(ROOT, "bot", "auto_update.py"), "--force"],     # 「立即執行一次」
    "auto-check": [os.path.join(ROOT, "bot", "auto_update.py")],          # scheduled check: runs only what is due
}
AUTO_CHECK_EVERY = 30 * 60  # seconds, computer version only (online: Cloud Scheduler)
# Files under data/ the browser may load. Everything else there (collection.json,
# backups, raw pages, the PIN) is only reachable through the API.
PUBLIC_DATA = {"cards.js", "cards.json", "decks.js", "decks.json", "prices.js", "prices.json"}
IAP_EMAIL_HEADER = "X-Goog-Authenticated-User-Email"

PIN = None             # set by --pin / OPCG_PIN
ALLOWED_EMAILS = set()  # set from ALLOWED_EMAILS
CLOUD = False          # set by --cloud

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
        env = dict(os.environ, OPCG_DATA=DATA)
        proc = subprocess.Popen([sys.executable, "-u", "-I"] + BOTS[name], cwd=ROOT, env=env,
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


def auto_check_loop():
    """Computer version: while the app is open, run the updates that are due."""
    time.sleep(120)
    while True:
        with lock:
            busy = any(j.get("running") for j in jobs.values())
        if not busy:
            run_bot("auto-check")
        time.sleep(AUTO_CHECK_EVERY)


def iap_email(header_value):
    """'accounts.google.com:me@example.com' -> 'me@example.com'."""
    v = (header_value or "").strip()
    return v.split(":", 1)[1].lower() if ":" in v else v.lower()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # quieter console
        if args and "/api/" in str(args[0]):
            return
        super().log_message(fmt, *args)

    # ---------------------------------------------------------- files
    def _route(self):
        """'app' / 'data' / None for the request path, plus the safe relative part."""
        path = posixpath.normpath(unquote(urlsplit(self.path).path))
        parts = [p for p in path.split("/") if p]
        if not parts or ".." in parts:
            return None, ""
        if parts[0] == "app":
            return "app", "/".join(parts[1:])
        if parts[0] == "data":
            rest = parts[1:]
            if len(rest) == 1 and rest[0] in PUBLIC_DATA:
                return "data", rest[0]
            if len(rest) == 2 and rest[0] == "images" and rest[1] != "manifest.json":
                return "data", "/".join(rest)
        return None, ""

    def translate_path(self, path):
        area, rel = self._route()
        if area == "app":
            return os.path.join(ROOT, "app", *rel.split("/")) if rel else os.path.join(ROOT, "app") + os.sep
        if area == "data":
            return os.path.join(DATA, *rel.split("/"))
        return os.path.join(ROOT, "__not_served__")

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
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    # ----------------------------------------------------------- auth
    def _email_ok(self):
        if not ALLOWED_EMAILS:
            return True
        return iap_email(self.headers.get(IAP_EMAIL_HEADER)) in ALLOWED_EMAILS

    def _pin_ok(self):
        if not PIN:
            return True
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "opcg_pin" and hmac.compare_digest(v, PIN):
                return True
        return False

    def _deny(self):
        """False when the request may go on; otherwise the refusal has been sent."""
        if not self._email_ok():
            self.send_error(403, "This Google account is not allowed")
            return True
        if not self._pin_ok():
            self._login_page()
            return True
        return False

    def _login_page(self, msg=""):
        body = (LOGIN % msg).encode("utf-8")
        self.send_response(401 if self.path.startswith("/api/") else 200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -------------------------------------------------------- methods
    def do_HEAD(self):
        if self._deny():
            return
        if self._route()[0] is None:
            return self.send_error(404)
        return super().do_HEAD()

    def do_GET(self):
        if self._deny():
            return
        if self.path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/app/")
            self.end_headers()
            return
        if self.path == "/api/state":
            if os.path.exists(STATE):
                with open(STATE, encoding="utf-8") as f:
                    return self._json({"ok": True, "state": json.load(f)})
            return self._json({"ok": True, "state": None})
        if self.path == "/api/bot":
            with lock:
                return self._json({"ok": True, "jobs": jobs})
        if self.path == "/api/auto":
            try:
                with open(os.path.join(DATA, "auto-update.json"), encoding="utf-8") as f:
                    status = json.load(f)
            except (OSError, ValueError):
                status = {}
            return self._json({"ok": True, "cloud": CLOUD, "status": status})
        if self._route()[0] is None:
            return self.send_error(404)
        return super().do_GET()

    def do_PUT(self):
        if self._deny():
            return
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
            if not self._email_ok():
                return self.send_error(403, "This Google account is not allowed")
            n = int(self.headers.get("Content-Length") or 0)
            pin = (parse_qs(self.rfile.read(n).decode("utf-8")).get("pin") or [""])[0]
            if not hmac.compare_digest(pin, PIN):
                time.sleep(1)
                return self._login_page("<p style='color:#c0392b'>PIN 不正確</p>")
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            self.send_response(303)
            self.send_header("Set-Cookie", f"opcg_pin={PIN}; Path=/; Max-Age=31536000; SameSite=Strict; HttpOnly{secure}")
            self.send_header("Location", "/app/")
            self.end_headers()
            return None
        if self._deny():
            return
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


def configure(pin=None, emails=None):
    global PIN, ALLOWED_EMAILS
    PIN = pin or None
    ALLOWED_EMAILS = {e.strip().lower() for e in (emails or "").split(",") if e.strip()}


def main(argv=None):
    global CLOUD
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, help="port (default 8765, or $PORT with --cloud)")
    ap.add_argument("--lan", action="store_true", help="also listen on your home network (for your phone)")
    ap.add_argument("--pin", help="PIN asked on first visit (strongly advised with --lan)")
    ap.add_argument("--cloud", action="store_true",
                    help="online mode: listen on all interfaces at $PORT; needs ALLOWED_EMAILS or a PIN")
    args = ap.parse_args(argv)
    configure(args.pin or os.environ.get("OPCG_PIN"), os.environ.get("ALLOWED_EMAILS"))
    if args.cloud and not (ALLOWED_EMAILS or PIN):
        print("Refusing to start: --cloud needs ALLOWED_EMAILS (with IAP) or OPCG_PIN, "
              "otherwise anyone with the address could open your collection.", file=sys.stderr)
        return 2
    CLOUD = bool(args.cloud)
    port = args.port or (int(os.environ.get("PORT", "8080")) if args.cloud else 8765)
    host = "0.0.0.0" if (args.lan or args.cloud) else "127.0.0.1"
    os.makedirs(DATA, exist_ok=True)
    srv = ThreadingHTTPServer((host, port), Handler)
    print(f"OPCG app: http://localhost:{port}   data: {DATA}   (Ctrl+C to stop)")
    if ALLOWED_EMAILS:
        print("  allowed Google accounts: " + ", ".join(sorted(ALLOWED_EMAILS)))
    if not CLOUD:
        threading.Thread(target=auto_check_loop, daemon=True).start()
    if args.lan:
        for ip in lan_ips():
            print(f"  phone (same Wi-Fi): http://{ip}:{port}")
        if not PIN:
            print("  ! no --pin: anyone on this Wi-Fi can open and change your collection")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
