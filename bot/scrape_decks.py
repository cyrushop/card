#!/usr/bin/env python3
"""Deck-list bot: reads tournament deck lists from onepiecetopdecks.com and
writes data/decks.json + decks.js for the app.

    python3 bot/scrape_decks.py                  # deck-list index + the pages it links
    python3 bot/scrape_decks.py --max-pages 10
    python3 bot/scrape_decks.py --url https://onepiecetopdecks.com/deck-list/<page>/

It recognises two ways a deck is written on a page:
  * deck-builder links whose query string has dg=1nOP08-001a4nOP08-002a...
    (with dn=deck name, au=author, date=M/D/YYYY, pl=placement, hs=event,
    tn=event type, cn=country when present), e.g.
    /deck-list/<page>/deckgen/?dn=RG%20Luffy&date=11/1/2026&cn=JP&au=Shishi
    &pl=2nd%20(7-1)&tn=ShopEvent&hs=DragonTail%20Cup&dg=1nOP13-001a4nOP13-016a...
  * plain text lists, one card per line: "4xOP08-002" / "4 OP08-002" / "OP08-002 x4"

Standard library only. Waits about 1 s between requests.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import parse_qs, unquote, urljoin, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import htmldom  # noqa: E402
import net  # noqa: E402

START = "https://onepiecetopdecks.com/deck-list/"
HOST = "onepiecetopdecks.com"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(HERE, "..", "data"))

CARD = r"(?:(?:OP|ST|EB|PRB)\d{2}|P)-\d{3}"
DG_RE = re.compile(r"(\d+)n(" + CARD + r")", re.I)
LINE_RE = re.compile(r"^\s*(\d{1,2})\s*[x×*]?\s*(" + CARD + r")\b", re.I)
LINE_RE2 = re.compile(r"^\s*(" + CARD + r")\s*[x×*]\s*(\d{1,2})\b", re.I)


def parse_dg(dg):
    """'1nOP08-001a4nOP08-002' -> [{'id','count'}] (merged, order kept)."""
    seen = {}
    for count, cid in DG_RE.findall(dg or ""):
        cid = cid.upper()
        seen[cid] = seen.get(cid, 0) + int(count)
    return [{"id": k, "count": v} for k, v in seen.items()]


def deck_key(entries):
    sig = ",".join(f"{e['count']}x{e['id']}" for e in sorted(entries, key=lambda e: e["id"]))
    return hashlib.sha1(sig.encode()).hexdigest()[:12]


def _leader(entries):
    # The leader is written first with a count of 1 in both formats.
    return entries[0]["id"] if entries and entries[0]["count"] == 1 else ""


def iso_date(s):
    """'11/1/2026' (M/D/YYYY, as the site writes it) -> '2026-11-01'."""
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", s or "")
    return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else (s or "")


def _first(qs, *keys):
    for k in keys:
        v = qs.get(k)
        if v and v[0].strip():
            return unquote(v[0]).strip()
    return ""


def _context(node):
    """Text of the table row / list item / paragraph the link sits in."""
    n = node
    while n is not None and n.tag not in ("tr", "li", "p", "div", "#root"):
        n = n.parent
    return htmldom.clean(n.text()).replace("\n", " ")[:200] if n is not None and n.tag != "#root" else ""


def parse_decks(html, page_url):
    root = htmldom.parse(html)
    page_title = ""
    t = root.find("h1") or root.find("title")
    if t is not None:
        page_title = htmldom.clean(t.text())
    decks = []

    # 1) deck-builder links (any attribute that carries dg=...)
    for node in root.iter():
        for attr in ("href", "src", "data-href", "data-src"):
            val = node.attrs.get(attr) or ""
            if "dg=" not in val:
                continue
            qs = parse_qs(urlparse(urljoin(page_url, val.replace("&amp;", "&"))).query)
            entries = parse_dg(_first(qs, "dg"))
            if len(entries) < 5:
                continue
            ctx = _context(node)
            decks.append({
                "name": _first(qs, "dn") or htmldom.clean(node.text()) or ctx[:80] or page_title,
                "author": _first(qs, "au"),
                "date": iso_date(_first(qs, "date")),
                "placement": _first(qs, "pl"),
                "event": _first(qs, "hs", "tn"),
                "eventType": _first(qs, "tn"),
                "country": _first(qs, "cn"),
                "context": ctx,
                "page": page_title,
                "url": page_url,
                "entries": entries,
            })

    # 2) plain text lists
    lines = root.text().split("\n")
    block, label = [], ""
    for line in lines + ["--end--"]:
        if not line.strip():
            continue  # blank lines do not end a list
        m = LINE_RE.match(line)
        m2 = None if m else LINE_RE2.match(line)
        if m or m2:
            cnt, cid = (m.group(1), m.group(2)) if m else (m2.group(2), m2.group(1))
            block.append({"id": cid.upper(), "count": int(cnt)})
            continue
        if sum(e["count"] for e in block) >= 40:
            merged = {}
            for e in block:
                merged[e["id"]] = merged.get(e["id"], 0) + e["count"]
            entries = [{"id": k, "count": v} for k, v in merged.items()]
            decks.append({"name": label or page_title, "author": "", "date": "", "placement": "",
                          "event": "", "country": "", "context": label, "page": page_title,
                          "url": page_url, "entries": entries})
        block = []
        label = htmldom.clean(line)[:120]
    return decks


def parse_links(html, page_url):
    """Deck-list pages linked from an index page (same site, under /deck-list/)."""
    root = htmldom.parse(html)
    out, seen = [], set()
    for a in root.find_all("a"):
        href = a.attrs.get("href") or ""
        url = urljoin(page_url, href).split("#")[0]
        u = urlparse(url)
        if u.netloc.replace("www.", "") != HOST or "/deck-list/" not in u.path:
            continue
        if url.rstrip("/") == page_url.rstrip("/") or "dg=" in url or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "title": htmldom.clean(a.text())})
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", action="append", default=[], help="extra deck-list page(s) to read")
    ap.add_argument("--max-pages", type=int, default=30, help="linked pages to follow (default 30)")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    ap.add_argument("--save-html", action="store_true", help="keep raw pages in data/raw (for debugging)")
    args = ap.parse_args(argv)

    pages = [START] + args.url
    print(f"Reading {START}")
    index = net.get(START, delay=0)
    links = parse_links(index, START)
    print(f"  {len(links)} linked deck-list pages")
    pages += [l["url"] for l in links[: args.max_pages]]

    decks, seen = [], set()
    for n, url in enumerate(dict.fromkeys(pages), 1):
        try:
            html = index if url == START else net.get(url, delay=args.delay)
        except RuntimeError as e:
            print(f"  ! {e}", file=sys.stderr)
            continue
        if args.save_html:
            raw = os.path.join(DATA, "raw")
            os.makedirs(raw, exist_ok=True)
            with open(os.path.join(raw, f"decks-{n}.html"), "w", encoding="utf-8") as f:
                f.write(html)
        found = 0
        for d in parse_decks(html, url):
            key = deck_key(d["entries"])
            if key in seen:
                continue
            seen.add(key)
            d["id"] = "m-" + key
            d["leader"] = _leader(d["entries"])
            decks.append(d)
            found += 1
        print(f"[{n}] {url}  -> {found} decks")

    os.makedirs(DATA, exist_ok=True)
    payload = {"source": START, "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "decks": decks}
    with open(os.path.join(DATA, "decks.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    with open(os.path.join(DATA, "decks.js"), "w", encoding="utf-8") as f:
        f.write("window.OPCG_DECKS = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {len(decks)} decks to {DATA}/decks.json and decks.js")
    if not decks:
        print("No decks found. Run with --save-html and check data/raw/.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:  # network problems: one clear line instead of a traceback
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
