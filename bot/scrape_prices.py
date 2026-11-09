#!/usr/bin/env python3
"""Price bot: reads single-card sell prices (JPY) from Yuyu-tei and the
JPY -> HKD rate, and writes data/prices.json + prices.js for the app.

    python3 bot/scrape_prices.py                 # sets you own or use in your decks
    python3 bot/scrape_prices.py --sets OP08,OP09,EB02
    python3 bot/scrape_prices.py --sets all      # every set in cards.json
    python3 bot/scrape_prices.py --rate 0.049    # fix the JPY->HKD rate yourself

Yuyu-tei sells Japanese cards. Your Asia (Traditional Chinese) cards often
trade at a different level, so the app has a price factor in 設定.

Parallels: Yuyu-tei lists the normal card and its parallels under the same
card number. With the official card list (data/cards.json) the bot matches them
to that series' official ids: the normal one to OP08-001 and the parallels,
cheapest first, to the series' parallel ids in order (a reprint such as
OP11-022 inside EB05 goes to its official OP11-022_p2). The order between two
parallels of the same card is still a best guess; check expensive cards and set
a manual price in the app if needed.

Standard library only. Waits about 1 s between requests.
"""
import argparse
import json
import os
import re
import sys
import time
from urllib.parse import urljoin

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import don  # noqa: E402
import htmldom  # noqa: E402
import net  # noqa: E402

SHOP = "https://yuyu-tei.jp/sell/opc/s/{code}"
SEARCH = "https://yuyu-tei.jp/sell/opc/s/search?search_word={q}"
FX_URL = "https://open.er-api.com/v6/latest/JPY"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(HERE, "..", "data"))
DEFAULT_RATE = 0.049  # JPY -> HKD, mid-August 2026; the bot refreshes it

ID_RE = re.compile(r"^\s*((?:OP|ST|EB|PRB)\d{2}|P)-(\d{3})\s*$", re.I)
ID_IN_TEXT = re.compile(r"((?:OP|ST|EB|PRB)\d{2}|P)-(\d{3})", re.I)
YEN_RE = re.compile(r"([\d,]+)\s*円")
STOCK_RE = re.compile(r"在庫\s*[:：]?\s*(\d+)")
PARALLEL_WORDS = ("パラレル", "スーパー", "漫画", "マンガ", "コミパラ", "MANGA", "PARALLEL", "ゴールド")
HISTORY_DAYS = 180


def is_parallel(rarity, name):
    r = (rarity or "").upper()
    if r.startswith("P-") or r.endswith("-P") or r in ("SP", "SPC", "SP-CARD", "TR"):
        return True
    text = f"{rarity} {name}".upper()
    return any(w.upper() in text for w in PARALLEL_WORDS)


def _price(container):
    """First yen amount in the box that is not a struck-out old price."""
    for strong in container.find_all(pred=lambda n: n.tag in ("strong", "b", "span", "p", "div")):
        if strong.find(pred=lambda n: n.tag in ("strong", "div", "p")):
            continue  # only leaf-ish nodes
        anc, struck = strong, False
        while anc is not None and anc is not container:
            if anc.tag in ("del", "s", "strike"):
                struck = True
                break
            anc = anc.parent
        if struck:
            continue
        m = YEN_RE.search(strong.text())
        if m:
            return int(m.group(1).replace(",", ""))
    m = YEN_RE.search(container.text())
    return int(m.group(1).replace(",", "")) if m else None


def _rarity(container, cid):
    # The card picture's alt text reads "EB05-014 P-SR しらほし(パラレル)". On the live site each box
    # starts with a favourite-star icon, so look for the image that names the card, not the first one.
    for img in container.find_all("img"):
        m = re.search(re.escape(cid) + r"\s+(\S+)", img.attrs.get("alt") or "", re.I)
        if m:
            return m.group(1)
    n = container
    while n is not None:
        i = (n.attrs.get("id") or "") if hasattr(n, "attrs") else ""
        if i.startswith("cardlist-"):
            return i[len("cardlist-"):]
        n = n.parent
    return ""


def parse_shop(html, page_url):
    """Every card box on a Yuyu-tei list page: [{'cardNo','name','rarity','jpy','stock','url'}]."""
    root = htmldom.parse(html)
    out, seen = [], set()
    for node in root.iter():
        own = "".join(c for c in node.children if isinstance(c, str))
        m = ID_RE.match(own)
        if not m:
            continue
        cid = f"{m.group(1).upper()}-{m.group(2)}"
        box = node.parent
        for _ in range(6):
            if box is None or "円" in box.text():
                break
            box = box.parent
        if box is None or id(box) in seen or "円" not in box.text():
            continue
        seen.add(id(box))
        head = box.find("h4") or box.find("h5") or box.find("h3")
        name = htmldom.clean(head.text()) if head is not None else ""
        link = box.find("a", pred=lambda n: "/card/" in (n.attrs.get("href") or ""))
        text = box.text()
        stock = STOCK_RE.search(text)
        out.append({
            "cardNo": cid,
            "name": name,
            "rarity": _rarity(box, cid),
            "jpy": _price(box),
            "stock": int(stock.group(1)) if stock else (0 if "×" in text or "売り切れ" in text else None),
            "url": urljoin(page_url, link.attrs["href"]) if link is not None else SEARCH.format(q=cid),
        })
    return out


def _suffix_no(cid):
    m = re.search(r"_[pr](\d+)$", cid)
    return int(m.group(1)) if m else 0


def _is_reprint(cid):
    """'OP06-047_r1': the same picture reprinted in a later series."""
    return re.search(r"_r\d+$", cid) is not None


def _sp_class(rarity):
    """'SP' for SP cards (official 'SP卡', Yuyu-tei 'SP'), else 'P' for other parallels."""
    r = (rarity or "").upper()
    return "SP" if r.startswith("SP") else "P"


def official_versions(cards, code):
    """Card number -> [(official id, official rarity)] for one series, sorted by suffix, e.g. for EB05:
    'EB05-055' -> [('EB05-055', 'SR'), ('EB05-055_p1', 'SR'), ...] and
    'OP11-022' -> [('OP11-022_p2', 'L')] (a parallel reprint that keeps its old number)."""
    out = {}
    for c in cards:
        if c["id"].split("-")[0] == code or any((s or {}).get("code") == code for s in c.get("series", [])):
            out.setdefault(c["baseId"], []).append((c["id"], c.get("rarity") or ""))
    for v in out.values():
        v.sort(key=lambda x: (_is_reprint(x[0]), _suffix_no(x[0])))
    return out


def map_ids(rows, page_set, official=None):
    """Give each shop row the id it has in the official card list.

    With `official` (from official_versions), per card number:
      * the normal version goes to the base number when the series has it, otherwise to a
        same-picture reprint id (_r1 ...) of that series;
      * parallels are matched by kind first: Yuyu-tei 'SP' rows only to official SP cards
        ('SP卡'), other parallels only to the other official parallel ids; within a kind,
        cheapest first to the lowest suffix (_p1 before _p2 ...).
      Rows with no official slot of their kind are left out rather than given to the wrong card.
    Without it: a best guess of base, _p1, _p2 ... in price order."""
    groups = {}
    for r in rows:
        if r["jpy"] is None:
            continue
        own_set = r["cardNo"].split("-")[0]
        if page_set and own_set != page_set:
            r = dict(r, foreign=True)
        groups.setdefault(r["cardNo"], []).append(r)
    out = {}
    for no, items in groups.items():
        known = (official or {}).get(no)
        home = items if known else ([r for r in items if not r.get("foreign")] or items)
        normal = sorted((r for r in home if not is_parallel(r["rarity"], r["name"])), key=lambda r: r["jpy"])
        para = sorted((r for r in home if is_parallel(r["rarity"], r["name"])), key=lambda r: r["jpy"])
        if known:
            ids = [i for i, _ in known]
            if normal:
                if no in ids:
                    out[no] = dict(normal[0], foreign=False)
                else:
                    for cid, r in zip([i for i in ids if _is_reprint(i)], normal):
                        out[cid] = dict(r, foreign=False)
            slots = [(i, rar) for i, rar in known if i != no and not _is_reprint(i)]
            for kind in ("P", "SP"):
                kind_ids = [i for i, rar in slots if _sp_class(rar) == kind]
                kind_rows = [r for r in para if _sp_class(r["rarity"]) == kind]
                for cid, r in zip(kind_ids, kind_rows):
                    out[cid] = dict(r, foreign=False)
            continue
        if normal:
            out[no] = normal[0]
        for i, r in enumerate(para, 1):
            out[f"{no}_p{i}"] = r
    return out


def fetch_rate():
    try:
        j = json.loads(net.get(FX_URL, delay=0))
        rate = float(j["rates"]["HKD"])
        return rate if 0.01 < rate < 0.2 else None
    except Exception as e:
        print(f"  ! exchange rate: {e}", file=sys.stderr)
        return None


def _load(name):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def wanted_sets(arg):
    cards = (_load("cards.json") or {}).get("cards", [])
    all_sets = sorted({(c.get("set") or c["id"].split("-")[0]).upper() for c in cards} - {"P", ""})
    if arg and arg.lower() == "all":
        return all_sets
    if arg and arg.lower() != "auto":
        return [s.strip().upper().replace("-", "") for s in arg.split(",") if s.strip()]
    state = _load("collection.json") or {}
    ids = set(state.get("owned", {}))
    for d in state.get("decks", []):
        if d.get("status") != "sold":
            ids.update(e["id"] for e in d.get("entries", []))
    sets = sorted({i.split("-")[0].upper() for i in ids} - {"P"})
    return sets or all_sets


def merge(old, new, today):
    prices = (old or {}).get("prices", {})
    for cid, r in new.items():
        prev = prices.get(cid, {})
        hist = [h for h in prev.get("history", []) if h[0] != today]
        hist.append([today, r["jpy"]])
        prices[cid] = {k: r[k] for k in ("jpy", "stock", "name", "rarity", "url")}
        prices[cid]["history"] = hist[-HISTORY_DAYS:]
    return prices


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sets", default="auto", help="'auto' (default: sets you own / use), 'all', or e.g. OP08,EB02")
    ap.add_argument("--rate", type=float, help="JPY -> HKD rate to use instead of fetching it")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    ap.add_argument("--save-html", action="store_true", help="keep raw pages in data/raw (for debugging)")
    args = ap.parse_args(argv)

    old = _load("prices.json") or {}
    rate = args.rate or fetch_rate() or old.get("jpyToHkd") or DEFAULT_RATE
    print(f"JPY -> HKD rate: {rate}")

    sets = wanted_sets(args.sets)
    if not sets:
        print("No sets to read. Run scrape_cards.py first or pass --sets OP08,OP09.", file=sys.stderr)
        return 2

    cards = (_load("cards.json") or {}).get("cards", [])
    if not cards:
        print("  (no cards.json: parallels are matched by price order only; run scrape_cards.py first for exact ids)")
    found = {}
    for n, code in enumerate(sets, 1):
        url = SHOP.format(code=code.lower())
        try:
            html = net.get(url, delay=args.delay)
        except RuntimeError as e:
            print(f"[{n}/{len(sets)}] {code}: {e}", file=sys.stderr)
            continue
        if args.save_html:
            raw = os.path.join(DATA, "raw")
            os.makedirs(raw, exist_ok=True)
            with open(os.path.join(raw, f"yuyutei-{code}.html"), "w", encoding="utf-8") as f:
                f.write(html)
        if code == "DON":  # DON!! cards: Yuyu-tei's own page, already numbered DON-001 ...
            mapped = don.prices(don.parse(html, url))
        else:
            mapped = map_ids(parse_shop(html, url), code, official_versions(cards, code) if cards else None)
        for cid, r in mapped.items():
            if cid not in found or (found[cid].get("foreign") and not r.get("foreign")):
                found[cid] = r
        print(f"[{n}/{len(sets)}] {code}: {len(mapped)} prices")

    today = time.strftime("%Y-%m-%d")
    payload = {
        "source": "https://yuyu-tei.jp/sell/opc/",
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "currency": "JPY",
        "jpyToHkd": rate,
        "prices": merge(old, found, today),
    }
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "prices.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    with open(os.path.join(DATA, "prices.js"), "w", encoding="utf-8") as f:
        f.write("window.OPCG_PRICES = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {len(found)} new prices ({len(payload['prices'])} total) to {DATA}/prices.json")
    if not found:
        print("No prices found. Run with --save-html and check data/raw/.", file=sys.stderr)
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
