"""DON!! cards.

The official card list (asia-tc.onepiece-cardgame.com) has no DON!! cards, so the DON series
comes from Yuyu-tei's ドン!!カード page, which lists every DON!! card with its picture and price:
    https://yuyu-tei.jp/sell/opc/s/don
Each card gets the number DON-001, DON-002 ... from Yuyu-tei's own number (10001 -> DON-001), so a
card keeps its number when new DON!! cards are added. Standard library only.
"""
import re
from urllib.parse import urljoin

import htmldom

URL = "https://yuyu-tei.jp/sell/opc/s/don"
SERIES = {"value": "don", "code": "DON", "label": "DON!!卡"}
IMAGE = "https://card.yuyu-tei.jp/opc/front/don/{no}.jpg"  # the large picture of the card page
LINK_RE = re.compile(r"/sell/opc/card/don/(\d+)")
YEN_RE = re.compile(r"([\d,]+)\s*円")
STOCK_RE = re.compile(r"在庫\s*[:：]?\s*(\d+)")


def card_id(no):
    """Yuyu-tei number -> card number: '10001' -> 'DON-001'."""
    n = int(no)
    return f"DON-{n - 10000 if n > 10000 else n:03d}"


def short_name(name):
    """What tells the cards apart: 'ドン!!カード(ルフィモチーフ)' -> 'ルフィモチーフ',
    'ドン!!カード(箔押し)(金文字白背景/白背景裏面)' -> '箔押し / 金文字白背景/白背景裏面'."""
    rest = re.sub(r"^\s*ドン!!カード\s*", "", name or "").strip()
    if rest.startswith(("(", "（")) and rest.endswith((")", "）")):
        rest = re.sub(r"[)）]\s*[(（]", " / ", rest[1:-1])
    return rest.strip() or (name or "").strip()


def _price(box):
    for node in box.find_all(pred=lambda n: n.tag in ("strong", "b", "span", "p")):
        anc, struck = node, False
        while anc is not None and anc is not box:
            if anc.tag in ("del", "s", "strike"):
                struck = True
                break
            anc = anc.parent
        m = None if struck else YEN_RE.search(node.text())
        if m:
            return int(m.group(1).replace(",", ""))
    return None


def parse(html, page_url=URL):
    """Every DON!! card on the page: [{'id','no','name','nameJa','jpy','stock','url','image'}]."""
    root = htmldom.parse(html)
    out, seen = [], set()
    for a in root.find_all("a"):
        m = LINK_RE.search(a.attrs.get("href") or "")
        head = a.find("h4") if m else None
        if head is None or m.group(1) in seen:
            continue
        box = a.parent
        for _ in range(4):
            if box is None or "円" in box.text():
                break
            box = box.parent
        if box is None or "円" not in box.text():
            continue
        no = m.group(1)
        seen.add(no)
        full = htmldom.clean(head.text())
        text = box.text()
        stock = STOCK_RE.search(text)
        out.append({
            "id": card_id(no),
            "no": no,
            "name": short_name(full),
            "nameJa": full,
            "jpy": _price(box),
            "stock": int(stock.group(1)) if stock else (0 if "×" in text or "売り切れ" in text else None),
            "url": urljoin(page_url, a.attrs["href"]),
            "image": IMAGE.format(no=no),
        })
    out.sort(key=lambda r: r["id"])
    return out


def cards(rows):
    """Card-list entries for the app, in the same shape as the official cards."""
    return [{
        "id": r["id"],
        "baseId": r["id"],
        "name": f"DON!!（{r['name']}）",
        "nameJa": r["nameJa"],
        "rarity": "DON",
        "category": "DON",
        "categoryRaw": "DON!!",
        "cost": None, "life": None, "power": None, "counter": None,
        "color": "", "colors": [], "attribute": "", "feature": "", "text": "", "trigger": "", "block": "",
        "getInfo": "",
        "image": r["image"],
        "set": "DON",
        "series": [dict(SERIES)],
        "source": r["url"],
    } for r in rows]


def prices(rows):
    """Card number -> price row, as the price bot stores them."""
    return {r["id"]: {"jpy": r["jpy"], "stock": r["stock"], "name": r["nameJa"], "rarity": "DON", "url": r["url"]}
            for r in rows if r["jpy"] is not None}
