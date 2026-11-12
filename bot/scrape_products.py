#!/usr/bin/env python3
"""Release-date bot: reads the official product list (Asia, Traditional Chinese) and writes
data/products.json + products.js, so the app can show when new series come out and remind
you to add them once they have.

    python3 bot/scrape_products.py

Reads the boosters and decks lists of https://asia-tc.onepiece-cardgame.com/products/ .
Standard library only. Waits about 1 s between requests.
"""
import argparse
import html
import json
import os
import re
import sys
import time
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import net  # noqa: E402

BASE = "https://asia-tc.onepiece-cardgame.com/products/"
LISTS = ["?subcategory=boosters&page=1", "?subcategory=decks&page=1"]
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(HERE, "..", "data"))

ITEM_RE = re.compile(r'<li class="linkListColBox"[^>]*data-cat="([^"]*)"[^>]*>\s*<a href="([^"]+)"(.*?)</a>', re.S)
TITLE_RE = re.compile(r'<h4 class="linkListColTitle">(.*?)</h4>', re.S)
DATE_RE = re.compile(r'<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"')
CODE_RE = re.compile(r"【([A-Z]+)-(\d{2})】")


def parse(page, page_url=BASE):
    """Products on a list page: [{'code','tag','title','kind','date','url'}].
    Only those named with a series code (【OP-18】, 【ST-37】, 【PEB-01】 ...): they bring new cards."""
    out = []
    for kind, href, body in ITEM_RE.findall(page):
        t = TITLE_RE.search(body)
        title = html.unescape(re.sub(r"<[^>]+>", "", t.group(1))).strip() if t else ""
        m = CODE_RE.search(title)
        if not m:
            continue
        d = DATE_RE.search(body)
        out.append({
            "code": m.group(1) + m.group(2),
            "tag": m.group(0),
            "title": title,
            "kind": kind,
            "date": d.group(1) if d else "",
            "url": urljoin(page_url, html.unescape(href)),
        })
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    args = ap.parse_args(argv)
    found = {}
    for q in LISTS:
        url = urljoin(BASE, q)
        print(f"Reading {url}")
        for p in parse(net.get(url, delay=args.delay), url):
            found.setdefault(p["code"], p)
    if not found:
        print("No products found. The page layout may have changed.", file=sys.stderr)
        return 1
    items = sorted(found.values(), key=lambda p: (p["date"], p["code"]), reverse=True)
    payload = {"source": BASE, "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "products": items}
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "products.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    with open(os.path.join(DATA, "products.js"), "w", encoding="utf-8") as f:
        f.write("window.OPCG_PRODUCTS = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    today = time.strftime("%Y-%m-%d")
    soon = [p for p in items if p["date"] > today]
    print("更新結果：")
    print("  即將推出：" + ("、".join(f"{p['code']}（{p['date']}）" for p in sorted(soon, key=lambda p: p["date"])) or "沒有"))
    print(f"  共 {len(items)} 款產品")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:  # network problems: one clear line instead of a traceback
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
