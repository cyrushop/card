"""Run: python3 -I tests/test_serve.py

Starts the server on a free local port with a temporary data folder and checks
what it serves and who it lets in.
"""
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import serve  # noqa: E402


class ServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        serve.DATA = cls.tmp.name
        serve.STATE = os.path.join(cls.tmp.name, "collection.json")
        os.makedirs(os.path.join(cls.tmp.name, "images"))
        os.makedirs(os.path.join(cls.tmp.name, "raw"))
        for name, text in [("cards.js", "window.OPCG_CARDS = {};"), ("pin.txt", "1234"),
                           ("images/OP01-001.png", "png"), ("images/manifest.json", "{}"), ("raw/1.html", "<html>")]:
            with open(os.path.join(cls.tmp.name, name), "w") as f:
                f.write(text)
        quiet = type("QuietHandler", (serve.Handler,), {"log_message": lambda *a: None})
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), quiet)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def setUp(self):
        serve.configure()  # open access unless a test sets otherwise

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        c.request(method, path, body=data, headers=headers or {})
        r = c.getresponse()
        out = (r.status, r.read().decode("utf-8", "replace"), dict(r.getheaders()))
        c.close()
        return out


class Files(ServerCase):
    def test_only_app_and_public_data_are_served(self):
        allowed = ["/app/", "/app/app.js", "/app/engine.js", "/data/cards.js", "/data/images/OP01-001.png"]
        blocked = ["/serve.py", "/bot/net.py", "/tests/test_serve.py", "/README.md", "/data/pin.txt",
                   "/data/collection.json", "/data/images/manifest.json", "/data/raw/1.html",
                   "/app/../serve.py", "/app/%2e%2e/serve.py", "/data/../serve.py", "/.git/config"]
        for p in allowed:
            self.assertEqual(self.req("GET", p)[0], 200, p)
        for p in blocked:
            self.assertEqual(self.req("GET", p)[0], 404, p)
        self.assertEqual(self.req("GET", "/")[0], 302)

    def test_state_and_conflict(self):
        s, body, _ = self.req("PUT", "/api/state", {"owned": {"OP01-001": 2}})
        self.assertEqual(s, 200)
        rev = json.loads(body)["rev"]
        self.assertEqual(json.loads(self.req("GET", "/api/state")[1])["state"]["owned"], {"OP01-001": 2})
        # A second device still on the old revision gets the newer copy back instead of overwriting it.
        s, body, _ = self.req("PUT", "/api/state", {"owned": {}, "rev": rev - 1})
        self.assertEqual(s, 409)
        self.assertEqual(json.loads(body)["state"]["owned"], {"OP01-001": 2})


class GoogleAccounts(ServerCase):
    def test_iap_email_must_be_allowed(self):
        serve.configure(emails="Me@Example.com, partner@example.com")
        self.assertEqual(self.req("GET", "/app/")[0], 403)
        ok = {"X-Goog-Authenticated-User-Email": "accounts.google.com:me@example.com"}
        self.assertEqual(self.req("GET", "/app/", headers=ok)[0], 200)
        self.assertEqual(self.req("GET", "/api/state", headers=ok)[0], 200)
        other = {"X-Goog-Authenticated-User-Email": "accounts.google.com:someone@else.com"}
        for method, path in [("GET", "/app/"), ("GET", "/api/state"), ("PUT", "/api/state"), ("POST", "/api/bot/update")]:
            self.assertEqual(self.req(method, path, b"{}", other)[0], 403, path)
        self.assertEqual(serve.iap_email("accounts.google.com:A@B.com"), "a@b.com")


class Pin(ServerCase):
    def test_pin_login(self):
        serve.configure(pin="4321")
        s, body, _ = self.req("GET", "/app/")
        self.assertEqual(s, 200)
        self.assertIn("輸入 PIN", body)
        self.assertEqual(self.req("GET", "/api/state")[0], 401)
        form = {"Content-Type": "application/x-www-form-urlencoded"}
        self.assertIn("PIN 不正確", self.req("POST", "/login", b"pin=0000", form)[1])
        s, _, h = self.req("POST", "/login", b"pin=4321", form)
        self.assertEqual(s, 303)
        cookie = h["Set-Cookie"].split(";")[0]
        self.assertEqual(self.req("GET", "/api/state", headers={"Cookie": cookie})[0], 200)
        self.assertNotIn("Secure", h["Set-Cookie"])
        s, _, h = self.req("POST", "/login", b"pin=4321", dict(form, **{"X-Forwarded-Proto": "https"}))
        self.assertIn("Secure", h["Set-Cookie"])


class CloudMode(unittest.TestCase):
    def test_refuses_to_start_without_access_control(self):
        saved = {k: os.environ.pop(k, None) for k in ("ALLOWED_EMAILS", "OPCG_PIN")}
        try:
            self.assertEqual(serve.main(["--cloud"]), 2)
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v
            serve.configure()


if __name__ == "__main__":
    unittest.main(verbosity=2)
