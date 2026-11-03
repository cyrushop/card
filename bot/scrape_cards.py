#!/usr/bin/env python3
"""Card-list bot: reads the official One Piece Card Game (Asia, Traditional
Chinese) card list and writes data/cards.json + cards.js for the app.

    python3 bot/scrape_cards.py                 # every series, image links only
    python3 bot/scrape_cards.py --images        # also download card images
    python3 bot/scrape_cards.py --series OP08,OP09,EB02
    python3 bot/scrape_cards.py --list-series   # show the series the site offers

Standard library only. Waits about 1 s between requests.
"""
import argparse
import json
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import htmldom  # noqa: E402
import net  # noqa: E402

BASE = "https://asia-tc.onepiece-cardgame.com/cardlist/"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.environ.get("OPCG_DATA") or os.path.join(HERE, "..", "data"))

SET_RE = re.compile(r"\b(OP|ST|EB|PRB)\s*-?\s*(\d{2})\b", re.I)
ID_RE = re.compile(r"^((?:OP|ST|EB|PRB)\d{2}|P)-\d{3}", re.I)

CATEGORY = [
    ("LEADER", ("LEADER", "領航", "領袖", "隊長")),
    ("CHARACTER", ("CHARACTER", "角色")),
    ("EVENT", ("EVENT", "事件")),
    ("STAGE", ("STAGE", "場地", "舞台")),
    ("DON", ("DON",)),
]


def norm_category(raw):
    up = (raw or "").upper()
    for key, words in CATEGORY:
        if any(w in up for w in words):
            return key
    return up or ""


def set_code(label):
    """'【OP-08】...' -> 'OP08'. Returns '' for promos and anything unknown."""
    m = SET_RE.search(label or "")
    return f"{m.group(1).upper()}{m.group(2)}" if m else ""


# ---------------------------------------------------------------- parsing
def parse_series(html):
    """Options of the series drop-down: [{'value','label','code'}]."""
    root = htmldom.parse(html)
    sel = root.find("select", pred=lambda n: n.attrs.get("name") == "series"
                    or n.attrs.get("id") == "series")
    out = []
    for opt in (sel.find_all("option") if sel else []):
        value = (opt.attrs.get("value") or "").strip()
        # The site writes some names with an escaped line break, e.g. '特殊補充包 <br class="spInline">ONE PIECE ...'.
        label = htmldom.clean(re.sub(r"<[^>]*>", " ", opt.text()))
        if value and value.isdigit():
            out.append({"value": value, "label": label, "code": set_code(label)})
    return out


def _field(card, cls):
    node = card.find(cls=cls)
    if node is None:
        return None
    parts = []
    for c in node.children:
        if isinstance(c, str):
            parts.append(c)
        elif c.tag == "h3":
            continue
        elif c.tag == "img" and c.attrs.get("alt"):
            parts.append(c.attrs["alt"] + " ")
        elif c.tag == "br":
            parts.append("\n")
        else:
            parts.append(c.text())
    return htmldom.clean("".join(parts))


def _heading(card, cls):
    node = card.find(cls=cls)
    h = node.find("h3") if node else None
    return htmldom.clean(h.text()) if h else ""


def _num(s):
    s = (s or "").replace(",", "").strip()
    m = re.search(r"-?\d+", s)
    return int(m.group(0)) if m else None


def parse_cards(html, page_url, series=None):
    """All cards on one card-list page."""
    root = htmldom.parse(html)
    cards = []
    for dl in root.find_all(cls="modalCol"):
        info = dl.find(cls="infoCol")
        spans = [htmldom.clean(s.text()) for s in (info.find_all("span") if info else [])]
        cid = (dl.attrs.get("id") or (spans[0] if spans else "")).strip()
        if not ID_RE.match(cid):
            continue
        name_node = dl.find(cls="cardName")
        img = None
        front = dl.find(cls="frontCol") or dl
        im = front.find("img")
        if im is not None:
            src = im.attrs.get("data-src") or im.attrs.get("src") or ""
            if src and not src.startswith("data:"):
                img = urljoin(page_url, src)

        cat_raw = spans[2] if len(spans) > 2 else ""
        category = norm_category(cat_raw)
        cost_val = _num(_field(dl, "cost"))
        life = None
        if category == "LEADER" or "生命" in _heading(dl, "cost") or "Life" in _heading(dl, "cost"):
            life, cost_val = cost_val, None

        color = _field(dl, "color") or ""
        card = {
            "id": cid,
            "baseId": cid.split("_")[0],
            "name": htmldom.clean(name_node.text()) if name_node else "",
            "rarity": spans[1] if len(spans) > 1 else "",
            "category": category,
            "categoryRaw": cat_raw,
            "cost": cost_val,
            "life": life,
            "power": _num(_field(dl, "power")),
            "counter": _num(_field(dl, "counter")),
            "color": color,
            "colors": [c for c in re.split(r"[/／、,\s]+", color) if c],
            "attribute": _field(dl, "attribute") or "",
            "feature": _field(dl, "feature") or "",
            "text": _field(dl, "text") or "",
            "trigger": _field(dl, "trigger") or "",
            "block": _field(dl, "block") or "",
            "getInfo": _field(dl, "getInfo") or "",
            "image": img,
            "series": [series] if series else [],
        }
        card["set"] = set_code(card["getInfo"]) or (series and series.get("code")) or ""
        cards.append(card)
    return cards


# ------------------------------------------------------------------- main
def pick_series(all_series, wanted):
    if not wanted or wanted.lower() == "all":
        return all_series
    keys = {w.strip().upper().replace("-", "") for w in wanted.split(",") if w.strip()}
    return [s for s in all_series if s["value"] in keys or s["code"] in keys]


def download_images(cards, delay):
    """Download images that are missing, or whose address on the site changed
    (the site adds a version like ?250101 when it replaces an image).
    images/manifest.json remembers which address each local file came from."""
    img_dir = os.path.join(DATA, "images")
    os.makedirs(img_dir, exist_ok=True)
    manifest_path = os.path.join(img_dir, "manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        manifest = {}
    new = changed = 0
    todo = [c for c in cards if c.get("image")]
    for i, c in enumerate(todo):
        fname = image_name(c)
        path = os.path.join(img_dir, fname)
        have = os.path.exists(path) and os.path.getsize(path) > 0
        if have and manifest.get(c["id"], c["image"]) == c["image"]:
            manifest.setdefault(c["id"], c["image"])
            continue
        try:
            data = net.get(c["image"], delay=delay, binary=True, referer=BASE)
            with open(path, "wb") as f:
                f.write(data)
            manifest[c["id"]] = c["image"]
            changed += have
            new += not have
        except Exception as e:
            print(f"  ! image {c['id']}: {e}", file=sys.stderr)
        if (new + changed) and (new + changed) % 50 == 0:
            print(f"  images: {new} new, {changed} updated ({i + 1}/{len(todo)} checked)")
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    print(f"Images: {new} new, {changed} updated, in {img_dir}")
    return new, changed


def image_name(card):
    ext = os.path.splitext(urlparse(card.get("image") or "").path)[1] or ".png"
    return re.sub(r"[^A-Za-z0-9_\-]", "_", card["id"]) + ext


def attach_local_images(cards):
    """Point cards at images already downloaded on an earlier run."""
    img_dir = os.path.join(DATA, "images")
    for c in cards:
        if c.get("image") and os.path.exists(os.path.join(img_dir, image_name(c))):
            c["localImage"] = "../data/images/" + image_name(c)


def merge_existing(cards, series):
    """Keep cards from series that were not re-scraped this run."""
    path = os.path.join(DATA, "cards.json")
    if not os.path.exists(path):
        return cards, series
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        return cards, series
    new_ids = {c["id"] for c in cards}
    new_series = {s["value"] for s in series}
    kept = [c for c in old.get("cards", []) if c["id"] not in new_ids]
    kept_series = [s for s in old.get("series", []) if s["value"] not in new_series]
    return kept + cards, kept_series + series


def write_output(cards, series, last_update=None):
    os.makedirs(DATA, exist_ok=True)
    payload = {
        "source": BASE,
        "scrapedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "series": series,
        "lastUpdate": last_update or {},
        "cards": cards,
    }
    with open(os.path.join(DATA, "cards.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    with open(os.path.join(DATA, "cards.js"), "w", encoding="utf-8") as f:
        f.write("window.OPCG_CARDS = ")
        json.dump(payload, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {len(cards)} cards to {DATA}/cards.json and cards.js")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--series", default="all",
                    help="'all' (default) or a comma list of set codes / series ids, e.g. OP08,OP09,554110")
    ap.add_argument("--images", action="store_true", help="download card images to data/images")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests (default 1)")
    ap.add_argument("--list-series", action="store_true", help="print the site's series and exit")
    ap.add_argument("--fresh", action="store_true",
                    help="replace cards.json instead of merging with series scraped earlier")
    ap.add_argument("--save-html", action="store_true", help="keep raw pages in data/raw (for debugging)")
    args = ap.parse_args(argv)

    print(f"Reading series list from {BASE}")
    first = net.get(BASE, delay=0)
    all_series = parse_series(first)
    if not all_series:
        print("Could not find the series drop-down. The page layout may have changed.", file=sys.stderr)
        return 2
    if args.list_series:
        for s in all_series:
            print(f"{s['value']:>8}  {s['code'] or '-':6}  {s['label']}")
        return 0

    chosen = pick_series(all_series, args.series)
    if not chosen:
        print(f"No series matches {args.series!r}. Use --list-series.", file=sys.stderr)
        return 2

    by_id = {}
    order = []
    for n, s in enumerate(chosen, 1):
        url = f"{BASE}?series={s['value']}"
        print(f"[{n}/{len(chosen)}] {s['label']}")
        html = net.get(url, delay=args.delay)
        if args.save_html:
            raw = os.path.join(DATA, "raw")
            os.makedirs(raw, exist_ok=True)
            with open(os.path.join(raw, f"{s['value']}.html"), "w", encoding="utf-8") as f:
                f.write(html)
        cards = parse_cards(html, url, {"value": s["value"], "code": s["code"], "label": s["label"]})
        if not cards:
            print("  ! no cards found on this page (layout change?)", file=sys.stderr)
        for c in cards:
            if c["id"] in by_id:  # reprint: remember every series it appears in
                by_id[c["id"]]["series"].extend(c["series"])
            else:
                by_id[c["id"]] = c
                order.append(c["id"])
        print(f"  {len(cards)} cards")

    old = _load_existing()
    old_ids = {c["id"] for c in old.get("cards", [])}
    old_series = {x["value"] for x in old.get("series", [])}

    cards = [by_id[i] for i in order]
    series = chosen
    if not args.fresh:
        cards, series = merge_existing(cards, chosen)
    images = download_images(cards, args.delay / 4) if args.images else None
    attach_local_images(cards)

    new_series = [x for x in chosen if x["value"] not in old_series] if old_ids else []
    new_ids = [c["id"] for c in cards if c["id"] not in old_ids] if old_ids else []
    summary = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "newSeries": [{"code": x["code"], "label": x["label"]} for x in new_series],
        "newCards": new_ids[:2000],
        "newImages": images[0] if images else 0,
        "updatedImages": images[1] if images else 0,
    }
    write_output(cards, series, summary)
    print("\n更新結果：")
    print("  新系列：" + ("、".join(x["label"] for x in new_series) if new_series else "沒有"))
    print(f"  新卡：{len(new_ids)} 張" if old_ids else f"  卡表：{len(cards)} 張（第一次下載）")
    if images:
        print(f"  卡圖：新下載 {images[0]} 張，更新 {images[1]} 張")
    return 0


def _load_existing():
    try:
        with open(os.path.join(DATA, "cards.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:  # network problems: one clear line instead of a traceback
        print(f"\nError: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
