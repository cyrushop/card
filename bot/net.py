"""Polite HTTP helper for the bots (standard library only)."""
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 opcg-collection-bot")

_last = [0.0]


def get(url, delay=1.0, binary=False, retries=3, referer=None):
    """GET a URL, waiting `delay` seconds between requests to the same bot run."""
    wait = delay - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    headers = {"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}
    if referer:
        headers["Referer"] = referer
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                _last[0] = time.time()
                if binary:
                    return data
                charset = r.headers.get_content_charset() or "utf-8"
                return data.decode(charset, errors="replace")
        except Exception as e:  # network errors: back off and retry
            if "CERTIFICATE_VERIFY_FAILED" in str(e):
                raise RuntimeError(
                    f"GET {url} failed: this Python cannot check HTTPS certificates.\n"
                    "  On a Mac with Python from python.org, open Finder > Applications > Python 3.x\n"
                    "  and double-click 'Install Certificates.command', then run the bot again.") from e
            err = e
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {err}")
