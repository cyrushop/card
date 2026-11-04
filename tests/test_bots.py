"""Run: python3 -I tests/test_bots.py

Synthetic HTML only. The fixtures follow the layout the bots expect; they are
not copies of the live sites.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bot"))
import scrape_cards  # noqa: E402
import scrape_decks  # noqa: E402
import scrape_prices  # noqa: E402

CARDLIST = """
<html><body>
<form><select name="series" id="series">
  <option value="">全部</option>
  <option value="554110">擴充包【OP-10】</option>
  <option value="554108">擴充包【OP-08】</option>
  <option value="554201">額外補充包【EB-02】</option>
  <option value="554205">特殊補充包 &lt;br class="spInline"&gt;ONE PIECE Heroines Edition【EB-05】</option>
  <option value="554901">推廣卡</option>
</select></form>
<div class="resultCol">
<dl class="modalCol" id="OP10-001">
  <dt><div class="infoCol"><span>OP10-001</span> | <span>L</span> | <span>LEADER</span></div>
      <div class="cardName">斯摩格</div></dt>
  <dd><div class="frontCol"><img class="lazy" data-src="../images/cardlist/card/OP10-001.png?250101" src="data:image/gif;base64,R0"></div>
    <div class="backCol">
      <div class="col2"><div class="cost"><h3>生命值</h3>4</div>
        <div class="attribute"><h3>屬性</h3><img src="x.png" alt="斬"><i>斬</i></div></div>
      <div class="col2"><div class="power"><h3>力量值</h3>5000</div><div class="counter"><h3>反擊值</h3>-</div></div>
      <div class="col2"><div class="color"><h3>顏色</h3>紅/綠</div><div class="block"><h3>擴張記號</h3>3</div></div>
      <div class="feature"><h3>特征</h3>龐克哈薩特/海軍</div>
      <div class="text"><h3>效果</h3>【對方回合中】自己擁有《海軍》或《龐克哈薩特》特徵的角色卡全數力量值+1000。<br>【啟動主要】【每回合1次】若場上有自己力量值7000以上的角色卡時，將最多2張自己的咚!!卡置為活動狀態。</div>
      <div class="getInfo"><h3>獲取方法</h3>王族血脈【OP-10】</div>
    </div></dd>
</dl>
<dl class="modalCol" id="OP08-002_p1">
  <dt><div class="infoCol"><span>OP08-002</span> | <span>SR</span> | <span>CHARACTER</span></div>
      <div class="cardName">卡路</div></dt>
  <dd><div class="frontCol"><img src="/images/cardlist/card/OP08-002_p1.png"></div>
    <div class="backCol">
      <div class="cost"><h3>費用</h3>3</div>
      <div class="power"><h3>力量</h3>4,000</div><div class="counter"><h3>反擊</h3>1000</div>
      <div class="color"><h3>顏色</h3>紅</div>
      <div class="trigger"><h3>觸發</h3>登場</div>
      <div class="getInfo"><h3>入手情報</h3>擴充包【OP-08】</div>
    </div></dd>
</dl>
<dl class="modalCol" id="notacard"><dt></dt></dl>
</div></body></html>
"""

DECK_INDEX = """
<html><body><h1>Deck List</h1>
<a href="/deck-list/japan-op-12-decks/">JP OP12</a>
<a href="https://onepiecetopdecks.com/deck-list/english-op-11/">EN OP11</a>
<a href="https://onepiecetopdecks.com/deck-list/">self</a>
<a href="https://other.example/deck-list/x">offsite</a>
<a href="/about/">about</a>
</body></html>
"""

DECK_PAGE = """
<html><body><h1>Japan OP-12 Decks</h1>
<table>
<tr><td>1st Place</td><td><a href="https://onepiecetopdecks.com/deckgen/?dn=Red%20Zoro&amp;au=Taro&amp;date=2026-10-01&amp;pl=1st&amp;dg=1nOP08-001a4nOP08-002a4nOP08-003a4nOP08-004a4nOP08-005a4nOP08-006">Red Zoro</a></td></tr>
<tr><td>2nd</td><td><a href="/deck-list/japan-eb05op18-deck-list-heroines-and-the-dominance-of-god/deckgen/?dn=RG%20Luffy&amp;date=11/1/2026&amp;cn=JP&amp;au=Shishi&amp;pl=2nd%20(7-1)&amp;tn=ShopEvent&amp;hs=DragonTail%20Cup&amp;dg=1nOP13-001a4nOP13-016a4nST30-004a2nPRB02-003a4nEB05-001a4nOP07-022a3nOP06-033a4nEB01-013a4nOP14-031a4nOP12-023a4nST32-002a4nOP13-031a3nOP17-022a2nOP01-055a2nOP08-036a2nOP10-040&amp;cs=213">RG Luffy</a></td></tr>
<tr><td>Dup</td><td><a href="/deckgen/?dg=4nOP08-002a1nOP08-001a4nOP08-003a4nOP08-004a4nOP08-005a4nOP08-006">same</a></td></tr>
</table>
<h2>Blue Doffy (text list)</h2>
<p>1xOP10-002<br>4xOP10-010<br>4xOP10-011<br>4xOP10-012<br>4xOP10-013<br>4xOP10-014<br>4xOP10-015<br>
4xOP10-016<br>4xOP10-017<br>4xOP10-018<br>4xOP10-019<br>4xOP10-020<br>4xOP10-021<br>2xOP10-022</p>
<p>Other words</p>
</body></html>
"""


YUYU = """
<html><body>
<div id="cardlist-SR" class="py-4 cards-list"><h3><span>SR</span></h3><div class="row">
 <div class="col-md"><div class="card-product position-relative mt-4">
   <a href="https://yuyu-tei.jp/sell/opc/card/op08/10031"><img class="card img-fluid" alt="OP08-106 SR ナミ" src="x.jpg"></a>
   <span class="d-block border p-1 text-center my-2">OP08-106</span>
   <a href="https://yuyu-tei.jp/sell/opc/card/op08/10031"><h4 class="text-primary fw-bold">ナミ</h4></a>
   <div class="d-flex"><strong class="d-block text-end">320 円</strong><label>在庫 : 5 点</label></div>
 </div></div>
 <div class="col-md"><div class="card-product">
   <a href="/sell/opc/card/op08/10040"><img alt="OP08-079 SR カイドウ"></a>
   <span>OP08-079</span><h4>カイドウ</h4>
   <div><del><strong>120 円</strong></del> <strong class="text-danger">80 円</strong><label>在庫 : 0 点</label></div>
 </div></div>
</div></div>
<div id="cardlist-P-SR"><h3><span>P-SR</span></h3><div class="row">
 <div class="col-md"><div class="card-product">
   <a href="/sell/opc/card/op08/10200"><img alt="OP08-106 P-SR ナミ(パラレル)"></a>
   <span>OP08-106</span><h4>ナミ(パラレル)</h4><strong>4,980 円</strong>
 </div></div>
 <div class="col-md"><div class="card-product">
   <a href="/sell/opc/card/op08/10201"><img alt="OP08-106 SP ナミ(スーパーパラレル)"></a>
   <span>OP08-106</span><h4>ナミ(スーパーパラレル)</h4><strong>129,800 円</strong>
 </div></div>
 <div class="col-md"><div class="card-product">
   <span>ST01-012</span><h4>ルフィ</h4><strong>1,500 円</strong>
 </div></div>
</div></div>
</body></html>
"""


class CardBot(unittest.TestCase):
    def test_series(self):
        s = scrape_cards.parse_series(CARDLIST)
        self.assertEqual([x["value"] for x in s], ["554110", "554108", "554201", "554205", "554901"])
        self.assertEqual([x["code"] for x in s], ["OP10", "OP08", "EB02", "EB05", ""])
        # As on the live site (Nov 2026): an escaped <br> inside the option text is removed.
        self.assertEqual(s[3]["label"], "特殊補充包 ONE PIECE Heroines Edition【EB-05】")
        self.assertEqual([x["value"] for x in scrape_cards.pick_series(s, "op08,554201")], ["554108", "554201"])

    def test_cards(self):
        url = "https://asia-tc.onepiece-cardgame.com/cardlist/?series=554108"
        cards = scrape_cards.parse_cards(CARDLIST, url, {"value": "554110", "code": "OP10"})
        self.assertEqual([c["id"] for c in cards], ["OP10-001", "OP08-002_p1"])
        lead, char = cards
        # Field labels as shown on the official Asia (Traditional Chinese) card page.
        self.assertEqual(lead["name"], "斯摩格")
        self.assertEqual((lead["rarity"], lead["category"]), ("L", "LEADER"))
        self.assertEqual((lead["life"], lead["cost"], lead["power"], lead["counter"]), (4, None, 5000, None))
        self.assertEqual(lead["colors"], ["紅", "綠"])
        self.assertEqual(lead["block"], "3")
        self.assertEqual(lead["feature"], "龐克哈薩特/海軍")
        self.assertEqual(lead["image"], "https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP10-001.png?250101")
        self.assertTrue(lead["text"].startswith("【對方回合中】自己擁有《海軍》"))
        self.assertIn("\n【啟動主要】【每回合1次】", lead["text"])
        self.assertTrue(lead["attribute"].startswith("斬"))
        self.assertEqual(lead["getInfo"], "王族血脈【OP-10】")
        self.assertEqual(lead["set"], "OP10")
        self.assertEqual(char["baseId"], "OP08-002")
        self.assertEqual(char["rarity"], "SR")
        self.assertEqual((char["cost"], char["power"], char["counter"]), (3, 4000, 1000))
        self.assertEqual(char["trigger"], "登場")
        self.assertEqual(char["image"], "https://asia-tc.onepiece-cardgame.com/images/cardlist/card/OP08-002_p1.png")


class DeckBot(unittest.TestCase):
    def test_links(self):
        links = scrape_decks.parse_links(DECK_INDEX, scrape_decks.START)
        self.assertEqual([l["url"] for l in links], [
            "https://onepiecetopdecks.com/deck-list/japan-op-12-decks/",
            "https://onepiecetopdecks.com/deck-list/english-op-11/",
        ])

    def test_decks(self):
        decks = scrape_decks.parse_decks(DECK_PAGE, "https://onepiecetopdecks.com/deck-list/japan-op-12-decks/")
        self.assertEqual(len(decks), 4)  # three links (two are the same deck) + one text list
        a = decks[0]
        self.assertEqual(a["name"], "Red Zoro")
        self.assertEqual((a["author"], a["date"], a["placement"]), ("Taro", "2026-10-01", "1st"))
        self.assertEqual(a["entries"][0], {"id": "OP08-001", "count": 1})
        self.assertEqual(sum(e["count"] for e in a["entries"]), 21)
        luffy = decks[1]  # the real link format from the site (Nov 2026)
        self.assertEqual((luffy["name"], luffy["author"], luffy["date"], luffy["placement"], luffy["event"], luffy["eventType"], luffy["country"]),
                         ("RG Luffy", "Shishi", "2026-11-01", "2nd (7-1)", "DragonTail Cup", "ShopEvent", "JP"))
        self.assertEqual(len(luffy["entries"]), 16)
        self.assertEqual(sum(e["count"] for e in luffy["entries"]), 51)
        self.assertEqual(scrape_decks._leader(luffy["entries"]), "OP13-001")
        self.assertEqual(scrape_decks.deck_key(a["entries"]), scrape_decks.deck_key(decks[2]["entries"]))
        t = decks[3]
        self.assertEqual(t["name"], "Blue Doffy (text list)")
        self.assertEqual(sum(e["count"] for e in t["entries"]), 51)
        self.assertEqual(scrape_decks._leader(t["entries"]), "OP10-002")


class PriceBot(unittest.TestCase):
    def test_parse_and_map(self):
        url = "https://yuyu-tei.jp/sell/opc/s/op08"
        rows = scrape_prices.parse_shop(YUYU, url)
        self.assertEqual(len(rows), 5)
        nami = rows[0]
        self.assertEqual((nami["cardNo"], nami["name"], nami["rarity"], nami["jpy"], nami["stock"]),
                         ("OP08-106", "ナミ", "SR", 320, 5))
        self.assertEqual(rows[1]["jpy"], 80, "struck-out old price is skipped")
        self.assertEqual(rows[1]["url"], "https://yuyu-tei.jp/sell/opc/card/op08/10040")
        ids = scrape_prices.map_ids(rows, "OP08")
        self.assertEqual(ids["OP08-106"]["jpy"], 320)
        self.assertEqual(ids["OP08-106_p1"]["jpy"], 4980)
        self.assertEqual(ids["OP08-106_p2"]["jpy"], 129800)
        # A reprint listed on another set's page (here in a parallel section) is kept but
        # marked foreign, so the card's own set page wins when both are read.
        self.assertEqual(ids["ST01-012_p1"]["jpy"], 1500)
        self.assertTrue(ids["ST01-012_p1"].get("foreign"))

    def test_merge_history(self):
        old = {"prices": {"OP08-106": {"jpy": 300, "history": [["2026-10-01", 300], ["2026-11-03", 310]]}}}
        new = {"OP08-106": {"jpy": 320, "stock": 1, "name": "ナミ", "rarity": "SR", "url": "u"}}
        p = scrape_prices.merge(old, new, "2026-11-03")
        self.assertEqual(p["OP08-106"]["history"], [["2026-10-01", 300], ["2026-11-03", 320]])
        self.assertEqual(p["OP08-106"]["jpy"], 320)

    def test_parallel_words(self):
        self.assertTrue(scrape_prices.is_parallel("P-SEC", ""))
        self.assertTrue(scrape_prices.is_parallel("SR", "ナミ(パラレル)"))
        self.assertFalse(scrape_prices.is_parallel("SEC", "ゴール・D・ロジャー"))
        self.assertFalse(scrape_prices.is_parallel("L", "ルフィ"))


# Layout as on the live Yuyu-tei page (Nov 2026): every box starts with a favourite-star image,
# the card picture's alt text carries number and rarity, and a newer series can list a parallel
# reprint that keeps an old number (OP11-022 inside EB05).
YUYU_LIVE = """
<div class="col-md"><div class="card-product position-relative mt-4">
 <div class="starbtn"><img src="star.svg" alt="Star" class="star"/></div>
 <a href="https://yuyu-tei.jp/sell/opc/card/eb05/10019"><img src="x.jpg" alt="EB05-014 SR しらほし" class="card"/></a>
 <span class="d-block">EB05-014</span><h4>しらほし</h4><strong class="d-block text-end">280 円</strong><label>在庫 : 9 点</label></div></div>
<div class="col-md"><div class="card-product position-relative mt-4">
 <div class="starbtn"><img src="star.svg" alt="Star" class="star"/></div>
 <a href="https://yuyu-tei.jp/sell/opc/card/eb05/10021"><img src="x.jpg" alt="EB05-014 P-SR しらほし(パラレル)(スーパーパラレル）" class="card"/></a>
 <span class="d-block">EB05-014</span><h4>しらほし(パラレル)(スーパーパラレル）</h4><strong class="d-block text-end">79,800 円</strong><label>在庫 : 0 点</label></div></div>
<div class="col-md"><div class="card-product position-relative mt-4">
 <div class="starbtn"><img src="star.svg" alt="Star" class="star"/></div>
 <a href="https://yuyu-tei.jp/sell/opc/card/eb05/10020"><img src="x.jpg" alt="EB05-014 P-SR しらほし(パラレル)" class="card"/></a>
 <span class="d-block">EB05-014</span><h4>しらほし(パラレル)</h4><strong class="d-block text-end">1,480 円</strong><label>在庫 : 6 点</label></div></div>
<div class="col-md"><div class="card-product position-relative mt-4">
 <div class="starbtn"><img src="star.svg" alt="Star" class="star"/></div>
 <a href="https://yuyu-tei.jp/sell/opc/card/eb05/10090"><img src="x.jpg" alt="OP11-022 P-L しらほし(パラレル)" class="card"/></a>
 <span class="d-block">OP11-022</span><h4>しらほし(パラレル)</h4><strong class="d-block text-end">4,980 円</strong><label>在庫 : 2 点</label></div></div>
"""
OFFICIAL_EB05 = [  # from the official card list: ids that belong to series EB05
    {"id": "EB05-014", "baseId": "EB05-014", "rarity": "SR", "series": [{"code": "EB05"}]},
    {"id": "EB05-014_p1", "baseId": "EB05-014", "rarity": "SR", "series": [{"code": "EB05"}]},
    {"id": "EB05-014_p2", "baseId": "EB05-014", "rarity": "SR", "series": [{"code": "EB05"}]},
    {"id": "OP11-022_p2", "baseId": "OP11-022", "rarity": "L", "series": [{"code": "EB05"}]},
    {"id": "OP11-022", "baseId": "OP11-022", "rarity": "L", "series": [{"code": "OP11"}]},
    {"id": "OP11-022_p1", "baseId": "OP11-022", "rarity": "L", "series": [{"code": "OP11"}]},
]


class PriceBotLiveLayout(unittest.TestCase):
    def test_rarity_from_the_card_picture_not_the_star_icon(self):
        rows = scrape_prices.parse_shop(YUYU_LIVE, "https://yuyu-tei.jp/sell/opc/s/eb05")
        self.assertEqual([r["rarity"] for r in rows], ["SR", "P-SR", "P-SR", "P-L"])

    def test_matches_official_ids_including_reprints(self):
        rows = scrape_prices.parse_shop(YUYU_LIVE, "https://yuyu-tei.jp/sell/opc/s/eb05")
        official = scrape_prices.official_versions(OFFICIAL_EB05, "EB05")
        self.assertEqual(official["OP11-022"], [("OP11-022_p2", "L")])  # only the EB05 reprint, not OP11's own cards
        ids = scrape_prices.map_ids(rows, "EB05", official)
        self.assertEqual({k: v["jpy"] for k, v in ids.items()},
                         {"EB05-014": 280, "EB05-014_p1": 1480, "EB05-014_p2": 79800, "OP11-022_p2": 4980})
        # Without the official list the reprint would be guessed as OP11-022_p1, which is a different card.
        self.assertIn("OP11-022_p1", scrape_prices.map_ids(rows, "EB05"))


    def box(self, no, rarity, name, jpy):
        return (f'<div class="card-product"><div class="starbtn"><img alt="Star"/></div><img alt="{no} {rarity} {name}"/>'
                f'<span>{no}</span><h4>{name}</h4><strong>{jpy:,} 円</strong></div>')

    def test_sp_cards_kept_apart_from_other_parallels(self):
        # Live case OP09-004 (Shanks): official _p1/_p2 are SR parallels and _p3 is an SP card.
        # By price alone the SP card (¥14,800) landed on _p1.
        html = (self.box("OP09-004", "SR", "シャンクス", 120) + self.box("OP09-004", "P-SR", "シャンクス(パラレル)", 22800)
                + self.box("OP09-004", "SP", "シャンクス(パラレル)", 14800)
                + self.box("OP09-004", "P-SR", "シャンクス(パラレル)(スーパーパラレル)", 148000))
        official = scrape_prices.official_versions([
            {"id": "OP09-004", "baseId": "OP09-004", "rarity": "SR", "series": [{"code": "OP09"}]},
            {"id": "OP09-004_p1", "baseId": "OP09-004", "rarity": "SR", "series": [{"code": "OP09"}]},
            {"id": "OP09-004_p2", "baseId": "OP09-004", "rarity": "SR", "series": [{"code": "OP09"}]},
            {"id": "OP09-004_p3", "baseId": "OP09-004", "rarity": "SP卡", "series": [{"code": "OP09"}]},
        ], "OP09")
        ids = scrape_prices.map_ids(scrape_prices.parse_shop(html, "https://yuyu-tei.jp/sell/opc/s/op09"), "OP09", official)
        self.assertEqual({k: v["jpy"] for k, v in ids.items()},
                         {"OP09-004": 120, "OP09-004_p1": 22800, "OP09-004_p2": 148000, "OP09-004_p3": 14800})

    def test_same_picture_reprint_and_no_wrong_slot(self):
        # Live case: Pudding OP06-047 reprinted in PRB02 is officially OP06-047_r1 (R) plus an SP card _p3.
        html = (self.box("OP06-047", "R", "シャーロット・プリン", 300)
                + self.box("OP06-047", "SP", "シャーロット・プリン(パラレル)(PRB2)", 5980)
                + self.box("OP06-047", "P-R", "シャーロット・プリン(パラレル)", 900))  # no official P-R slot in PRB02
        official = scrape_prices.official_versions([
            {"id": "OP06-047", "baseId": "OP06-047", "rarity": "R", "series": [{"code": "OP06"}]},
            {"id": "OP06-047_r1", "baseId": "OP06-047", "rarity": "R", "series": [{"code": "PRB02"}]},
            {"id": "OP06-047_p3", "baseId": "OP06-047", "rarity": "SP卡", "series": [{"code": "PRB02"}]},
        ], "PRB02")
        ids = scrape_prices.map_ids(scrape_prices.parse_shop(html, "https://yuyu-tei.jp/sell/opc/s/prb02"), "PRB02", official)
        self.assertEqual({k: v["jpy"] for k, v in ids.items()}, {"OP06-047_r1": 300, "OP06-047_p3": 5980})


class CardUpdate(unittest.TestCase):
    """The update button: new series, new cards and replaced images are found; nothing else is downloaded again."""

    def run_bot(self, pages):
        import tempfile, json as _json
        calls = []

        def fake_get(url, delay=1.0, binary=False, retries=3, referer=None):
            calls.append(url)
            if binary:
                return b"PNG:" + url.encode()
            return pages[url.split("?series=")[1] if "?series=" in url else ""]
        scrape_cards.net.get = fake_get
        scrape_cards.main(["--images", "--delay", "0"])
        with open(os.path.join(scrape_cards.DATA, "cards.json"), encoding="utf-8") as f:
            return _json.load(f), [u for u in calls if "/images/" in u]

    def card(self, cid, img):
        return (f'<dl class="modalCol" id="{cid}"><dt><div class="infoCol"><span>{cid}</span> | <span>C</span> | <span>CHARACTER</span></div>'
                f'<div class="cardName">n</div></dt><dd><div class="frontCol"><img data-src="../images/cardlist/card/{img}"></div></dd></dl>')

    def test_update_flow(self):
        import tempfile
        saved_get, saved_data = scrape_cards.net.get, scrape_cards.DATA
        try:
            with tempfile.TemporaryDirectory() as tmp:
                scrape_cards.DATA = tmp
                sel = lambda opts: '<select name="series">' + "".join(f'<option value="{v}">【{c}】</option>' for v, c in opts) + "</select>"
                pages = {"": sel([("1", "OP-01")]), "1": self.card("OP01-001", "OP01-001.png?1") + self.card("OP01-002", "OP01-002.png?1")}
                data, imgs = self.run_bot(pages)
                self.assertEqual(len(imgs), 2)
                self.assertEqual(data["lastUpdate"]["newSeries"], [])  # first download: nothing is "new"

                # Same site again: nothing downloaded.
                data, imgs = self.run_bot(pages)
                self.assertEqual(imgs, [])

                # A new series appears and one image is replaced (new ?version).
                pages = {"": sel([("1", "OP-01"), ("2", "OP-02")]),
                         "1": self.card("OP01-001", "OP01-001.png?2") + self.card("OP01-002", "OP01-002.png?1"),
                         "2": self.card("OP02-001", "OP02-001.png?1")}
                data, imgs = self.run_bot(pages)
                self.assertEqual(sorted(u.rsplit("/", 1)[1] for u in imgs), ["OP01-001.png?2", "OP02-001.png?1"])
                self.assertEqual([x["code"] for x in data["lastUpdate"]["newSeries"]], ["OP02"])
                self.assertEqual(data["lastUpdate"]["newCards"], ["OP02-001"])
                self.assertEqual((data["lastUpdate"]["newImages"], data["lastUpdate"]["updatedImages"]), (1, 1))
                self.assertTrue(all(c.get("localImage") for c in data["cards"]))
        finally:
            scrape_cards.net.get, scrape_cards.DATA = saved_get, saved_data


if __name__ == "__main__":
    unittest.main(verbosity=2)
