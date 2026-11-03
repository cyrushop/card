#!/usr/bin/env python3
"""Build a single-file demo of the app with made-up sample data.

    python3 tools/build_demo.py out/opcg-demo.html

The demo shows the design without any scraped data: card art is a drawn
placeholder, names/effects/prices are samples, and changes stay in the
viewer's browser. Two things are real: the RG Luffy deck list (a public
onepiecetopdecks link) and the OP10-001 Smoker text from the official
Asia card list.
"""
import json
import os
import random
import re
import sys
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.normpath(os.path.join(HERE, "..", "app"))

HEX = {"紅": "#c8323a", "綠": "#23935a", "藍": "#2a63c9", "紫": "#7d45c4", "黑": "#2c2c2e", "黃": "#d2a414"}
COLS = list(HEX)
RG_LUFFY = ("https://onepiecetopdecks.com/deck-list/japan-eb05op18-deck-list-heroines-and-the-dominance-of-god/deckgen/"
            "?dn=RG%20Luffy&date=11/1/2026&cn=JP&au=Shishi&pl=2nd%20(7-1)&tn=ShopEvent&hs=DragonTail%20Cup"
            "&dg=1nOP13-001a4nOP13-016a4nST30-004a2nPRB02-003a4nEB05-001a4nOP07-022a3nOP06-033a4nEB01-013"
            "a4nOP14-031a4nOP12-023a4nST32-002a4nOP13-031a3nOP17-022a2nOP01-055a2nOP08-036a2nOP10-040&cs=213")
SMOKER_TEXT = ("【對方回合中】自己擁有《海軍》或《龐克哈薩特》特徵的角色卡全數力量值+1000。\n"
               "【啟動主要】【每回合1次】若場上有自己力量值7000以上的角色卡時，將最多2張自己的咚!!卡置為活動狀態。")
EFFECTS = [
    "【登場時】從自己的牌組上方查看5張卡，展示最多1張《草帽一夥》特徵的卡加入手牌。其餘以任意順序放回牌組下方。",
    "【阻擋者】(對方攻擊時，可將此卡置為休息狀態，將被攻擊對象變更為此卡。)",
    "【啟動主要】【每回合1次】咚!!−1：直到回合結束為止，此角色卡力量值+2000。",
    "【攻擊時】咚!!×1：選擇對方最多1張費用4以下的角色卡，KO該卡。",
    "【速攻】(此卡可在登場的回合進行攻擊。)",
    "【被KO時】抽1張卡。",
    "【主要】選擇自己最多1張領航或角色卡，直到回合結束為止力量值+3000。",
]
TRIGGER = "【觸發】發動此卡的【主要】效果。"


def card_svg(cid, colors, rarity, cost, power, alt):
    a = HEX[colors[0]]
    b = HEX[colors[-1]]
    gold = '<rect x="6" y="6" width="288" height="407" rx="12" fill="none" stroke="#f4d36b" stroke-width="5"/>' if alt else ""
    top = f'<circle cx="38" cy="40" r="22" fill="#fff" opacity=".92"/><text x="38" y="48" font-size="24" font-weight="700" text-anchor="middle" fill="{a}">{cost}</text>' if cost is not None else ""
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 419">'
           f'<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>'
           f'<rect width="300" height="419" rx="16" fill="url(#g)"/>'
           f'<rect x="16" y="70" width="268" height="230" rx="10" fill="#fff" opacity=".16"/>'
           f'<path d="M60 270 C110 170 190 170 240 270" stroke="#fff" stroke-opacity=".35" stroke-width="10" fill="none"/>'
           f'<circle cx="150" cy="160" r="46" fill="#fff" opacity=".22"/>'
           f'{top}<text x="282" y="50" font-size="26" font-weight="800" text-anchor="end" fill="#fff">{power or ""}</text>'
           f'<rect x="16" y="318" width="268" height="84" rx="10" fill="#000" opacity=".35"/>'
           f'<text x="150" y="356" font-size="27" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">{cid.split("_")[0]}</text>'
           f'<text x="150" y="388" font-size="17" text-anchor="middle" fill="#fff" opacity=".85" font-family="sans-serif">{rarity}{" · 平行" if alt else ""} · SAMPLE</text>'
           f'{gold}</svg>')
    return "data:image/svg+xml," + quote(svg)


def build_data():
    rnd = random.Random(8)
    cards, prices, series = [], {}, []
    luffy_ids = [m for m in re.findall(r"\d+n([A-Z]+\d*-\d{3})", RG_LUFFY)]
    sets = [("OP08", 60), ("OP09", 60), ("OP10", 60), ("EB02", 30), ("OP13", 40), ("ST21", 17)]
    rar_cycle = ["C", "C", "UC", "C", "R", "UC", "C", "SR", "UC", "R"]
    want = {i: True for i in luffy_ids}
    all_ids = []
    for code, n in sets:
        series.append({"value": code, "code": code, "label": f"示範系列【{code[:2]}-{code[2:]}】"})
        all_ids += [f"{code}-{i:03d}" for i in range(1, n + 1)]
    all_ids += [i for i in luffy_ids if i not in all_ids]
    for idx, cid in enumerate(all_ids):
        code, num = cid.split("-")
        num = int(num)
        lead = num <= 3 or cid in ("OP13-001",)
        rarity = "L" if lead else ("SEC" if num in (118, 119, 60) else rar_cycle[num % 10])
        dual = lead and num % 2 == 1
        c1 = COLS[(num // 9 + len(code)) % 6]
        c2 = COLS[(num // 9 + len(code) + 1) % 6]
        colors = [c1, c2] if dual else [c1]
        if cid in want or cid == "OP13-001":
            colors = ["紅", "綠"] if lead else [["紅", "綠"][idx % 2]]
        cat = "LEADER" if lead else ("EVENT" if num % 11 == 0 else ("STAGE" if num % 29 == 0 else "CHARACTER"))
        cost = None if lead else (num % 8) + 1
        power = 5000 if lead else (None if cat != "CHARACTER" else 1000 * ((num % 9) + 1))
        variants = [cid] + ([cid + "_p1"] if rarity in ("SR", "SEC", "L") else []) + ([cid + "_p2"] if rarity == "SEC" else [])
        for v in variants:
            alt = v != cid
            c = {
                "id": v, "baseId": cid, "name": f"示範角色 {code}-{num:03d}", "rarity": rarity, "category": cat,
                "cost": cost, "life": (5 if dual else 4) if lead else None, "power": power,
                "counter": None if lead or cat != "CHARACTER" else (2000 if num % 7 == 0 else 1000 if num % 2 else None),
                "color": "/".join(colors), "colors": colors, "attribute": ["打", "斬", "特", "射", "知"][num % 5],
                "feature": ["草帽一夥", "海軍", "超新星", "四皇/紅髮海賊團", "王下七武海"][num % 5], "block": "3",
                "text": EFFECTS[num % len(EFFECTS)] + ("\n" + EFFECTS[(num + 3) % len(EFFECTS)] if num % 3 == 0 else ""),
                "trigger": TRIGGER if cat == "EVENT" else "", "set": code, "series": [{"code": code}],
                "getInfo": f"示範系列【{code[:2]}-{code[2:]}】",
                "image": card_svg(v, colors, rarity, None if lead else cost, power, alt),
            }
            cards.append(c)
            base_jpy = {"C": 30, "UC": 50, "R": 120, "SR": 600, "SEC": 3800, "L": 300}[rarity] * (1 + (num % 5) * .4)
            if alt:
                base_jpy *= 18 if v.endswith("_p1") else 160
            hist, val = [], base_jpy * rnd.uniform(.7, 1.3)
            for d in ["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-10-27", "2026-11-03"]:
                val = max(10, val * rnd.uniform(.85, 1.18))
                hist.append([d, int(round(val, -1))])
            prices[v] = {"jpy": hist[-1][1], "stock": rnd.choice([0, 1, 2, 4, 8]), "name": c["name"], "rarity": rarity,
                         "url": "https://yuyu-tei.jp/sell/opc/s/search?search_word=" + cid, "history": hist}
    smoker = next(c for c in cards if c["id"] == "OP10-001")
    smoker.update({"name": "斯摩格", "life": 4, "power": 5000, "colors": ["紅", "綠"], "color": "紅/綠", "attribute": "斬",
                   "feature": "龐克哈薩特/海軍", "text": SMOKER_TEXT, "getInfo": "王族血脈【OP-10】", "rarity": "L",
                   "image": card_svg("OP10-001", ["紅", "綠"], "L", None, 5000, False)})
    return cards, prices, series, luffy_ids


def pick(cards, code, leader, n_four=12, n_two=1, skip=0):
    """Main-deck cards from one set whose colour matches the leader."""
    lc = set(next(c for c in cards if c["id"] == leader)["colors"])
    pool = [c["id"] for c in cards if c["id"] == c["baseId"] and c["set"] == code and c["category"] != "LEADER"
            and lc & set(c["colors"])][skip:]
    return ([{"id": leader, "count": 1}] + [{"id": i, "count": 4} for i in pool[:n_four]]
            + [{"id": i, "count": 2} for i in pool[n_four:n_four + n_two]])


def build_state(cards):
    rnd = random.Random(3)
    owned = {}
    for c in cards:
        if c["id"].startswith(("OP08", "OP09", "OP10")) and c["id"] == c["baseId"]:
            r = rnd.random()
            if r < .78:
                owned[c["id"]] = rnd.choice([1, 1, 2, 2, 3, 4, 4, 5, 6])
        elif c["id"] != c["baseId"] and rnd.random() < .25:
            owned[c["id"]] = 1
    for cid in ["OP08-036", "OP10-040", "OP13-016", "OP13-031", "EB05-001"]:
        owned[cid] = owned.get(cid, 0) + 2
    luffy = {"id": "demo-luffy", "name": "RG Luffy", "entries": [], "status": "plan", "price": 680, "createdAt": "2026-11-02T10:00:00Z",
             "author": "Shishi", "date": "2026-11-01", "placement": "2nd (7-1)", "event": "DragonTail Cup", "eventType": "ShopEvent",
             "country": "JP", "from": RG_LUFFY}
    for n, cid in re.findall(r"(\d+)n([A-Z]+\d*-\d{3})", RG_LUFFY):
        luffy["entries"].append({"id": cid, "count": int(n)})
    smoker = {"id": "demo-smoker", "name": "紅綠 斯摩格", "status": "built", "price": 520, "createdAt": "2026-10-20T10:00:00Z",
              "entries": pick(cards, "OP10", "OP10-001")}
    sold = {"id": "demo-sold", "name": "OP09 示範牌組", "status": "sold", "price": 450, "soldPrice": 480, "costAtSale": 392.5,
            "soldAt": "2026-10-28T12:00:00Z", "createdAt": "2026-10-10T10:00:00Z",
            "entries": pick(cards, "OP09", "OP09-001")}
    log = [{"id": i, "at": 1793600000000 - k * 60000} for k, i in enumerate(
        ["OP10-060_p1", "OP10-045", "OP10-033", "OP10-012", "OP10-060", "OP10-007", "OP10-021", "OP10-003", "OP10-050", "OP10-029"])]
    for e in log:
        owned[e["id"]] = owned.get(e["id"], 0) + 1
    return {"version": 1, "owned": owned, "decks": [luffy, smoker, sold],
            "manualPrices": {"OP10-060_p1": {"hkd": 1850, "at": "2026-11-02", "history": [["2026-10-20", 1600], ["2026-11-02", 1850]]}},
            "openLog": log, "settings": {"includeParallels": False, "quickSet": "OP10", "rate": "", "factor": 1, "valuableMin": 50, "showEffects": True}}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "opcg-demo.html"
    cards, prices, series, luffy_ids = build_data()
    state = build_state(cards)
    meta = [{"id": "m-luffy", "name": "RG Luffy", "leader": "OP13-001", "author": "Shishi", "date": "2026-11-01", "placement": "2nd (7-1)",
             "event": "DragonTail Cup", "eventType": "ShopEvent", "country": "JP", "url": RG_LUFFY,
             "entries": [{"id": c, "count": int(n)} for n, c in re.findall(r"(\d+)n([A-Z]+\d*-\d{3})", RG_LUFFY)]}]
    for k, (code, lead) in enumerate([("OP10", "OP10-002"), ("OP09", "OP09-003"), ("OP08", "OP08-001"), ("EB02", "EB02-001")]):
        ents = pick(cards, code, lead, skip=k)
        meta.append({"id": f"m-{code}", "name": f"示範 {code} 牌組", "leader": lead, "author": "Sample", "date": f"2026-10-{20 + k}",
                     "placement": ["1st", "Top 4", "3rd", "Top 8"][k], "event": "Sample Cup", "country": "JP", "url": "https://onepiecetopdecks.com/deck-list/", "entries": ents})
    read = lambda n: open(os.path.join(APP, n), encoding="utf-8").read()
    html = read("index.html")
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    body = re.sub(r"<!--.*?-->\s*", "", body, flags=re.S)
    body = re.sub(r'<script src="[^"]+"></script>\s*', "", body)
    data = {
        "OPCG_DEMO": True,
        "OPCG_CARDS": {"source": "sample", "scrapedAt": "2026-11-03T12:00", "series": series, "cards": cards,
                       "lastUpdate": {"at": "2026-11-03T12:00:00+0000", "newSeries": [{"code": "OP13", "label": "示範系列【OP-13】"}],
                                      "newCards": [c["id"] for c in cards if c["id"].startswith("OP13-")], "newImages": 40, "updatedImages": 3}},
        "OPCG_DECKS": {"source": "https://onepiecetopdecks.com/deck-list/", "scrapedAt": "2026-11-03T12:00", "decks": meta},
        "OPCG_PRICES": {"source": "sample", "fetchedAt": "2026-11-03T12:00", "currency": "JPY", "jpyToHkd": 0.049, "prices": prices},
        "OPCG_DEMO_STATE": state,
    }
    js_data = "\n".join(f"window.{k} = {json.dumps(v, ensure_ascii=False)};" for k, v in data.items())
    page = (
        '<title>OPCG 卡庫</title>\n<meta name="theme-color" content="#c8102e">\n'
        f"<style>\n{read('style.css')}\n</style>\n{body}\n"
        f"<script>\n{js_data}\n</script>\n<script>\n{read('engine.js')}\n</script>\n<script>\n{read('app.js')}\n</script>\n"
    )
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"Wrote {out} ({len(page) // 1024} KB, {len(cards)} sample cards)")


if __name__ == "__main__":
    main()
