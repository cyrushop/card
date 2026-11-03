# OPCG 卡庫（One Piece Card Game 收藏及牌組銷售）

記錄開箱所得的卡，對照比賽牌組清單，找出哪副牌組已齊卡可以組建；組好後預留所需的卡，售出後自動從卡庫扣除。

## Mac：按兩下即可使用

1. 下載：https://github.com/cyrushop/card/archive/refs/heads/main.zip ，按兩下解壓（會得到 `card-main` 資料夾）。
   （亦可在「終端機」執行以下指令，下載後的檔案不會觸發 macOS 的安全提示，並會直接開啟程式。再次執行即可更新，卡庫資料不會被覆蓋。）

   ```bash
   cd ~ && curl -fL -o card.zip https://github.com/cyrushop/card/archive/refs/heads/main.zip && unzip -q -o card.zip && chmod +x card-main/*.command && open card-main/OPCG-Start.command
   ```

2. 開啟解壓後的 `card-main` 資料夾，按兩下 **`OPCG-Start.command`**。
   * 首次使用時會詢問是否下載所有系列的卡表，按 Enter 即開始（約 1–2 分鐘）。所有系列都會顯示，庫存數量由你自行在程式內填寫。卡圖直接由官方網站顯示；如要把卡圖儲存至本機，可在「設定」按「檢查新系列及卡圖」。
   * 完成後會自動以瀏覽器開啟 http://localhost:8765 。
   * 使用完畢，關閉 Terminal 視窗即可停止。
3. 如要同時以手機使用（同一個 Wi-Fi）：按兩下 **`OPCG-Phone.command`**，首次使用時設定 PIN，然後以手機開啟畫面上顯示的網址。

首次按兩下時，Mac 可能顯示「無法打開，因為來自未識別的開發者」：
* macOS 14 或更早版本：在 Finder 對檔案按右鍵 → **打開** → **打開**。
* macOS 15（Sequoia）或更新版本：先按「完成」，再到 **系統設定 → 私隱與保安**，捲至最底按「**仍要打開**」，然後再按兩下檔案。

如沒有出現「仍要打開」按鈕：開啟「終端機」，輸入 `xattr -dr com.apple.quarantine `（末尾有空格），把整個解壓後的資料夾拖入視窗，按 Enter，然後再按兩下檔案。此指令只是告訴 Mac 此資料夾由你自行下載。

按兩下沒有反應或顯示沒有權限：開啟「終端機」，輸入 `chmod +x `（末尾有空格），把兩個 `.command` 檔拖入視窗，按 Enter。

如電腦未安裝 Python，啟動檔會請 Mac 安裝「Command Line Developer Tools」（內含 Python 3），安裝後再按兩下即可。如 BOT 顯示 `CERTIFICATE_VERIFY_FAILED`：到「應用程式 → Python 3.x」按兩下 `Install Certificates.command`。

## 其他電腦：快速開始

需要 Python 3.9 或以上版本（無須安裝其他套件）。

```bash
python3 serve.py
```

開啟 http://localhost:8765 → 「設定」→ 按 **檢查新系列及卡圖**、**更新牌組清單** 及 **更新價格**。

### 以手機查看及搜尋

電腦與手機須連接同一個 Wi-Fi：

```bash
python3 serve.py --lan --pin 4321
```

Terminal 會顯示 `http://192.168.x.x:8765`，以手機開啟並輸入 PIN。手機與電腦共用同一份資料；如兩部裝置幾乎同時修改，較後儲存的一方會收到提示並載入最新版本，不會互相覆蓋。手機版卡庫可按「篩選」展開篩選欄。

亦可直接在 Terminal 執行 BOT：

```bash
python3 bot/scrape_cards.py --images
```

```bash
python3 bot/scrape_decks.py
```

不啟動 `serve.py` 亦可直接開啟 `app/index.html`，但資料只會儲存於瀏覽器（請記得在「設定」匯出備份）。

## 網上版本（Google Cloud，只限自己使用）

可部署到 Google Cloud Run，以 Google 帳戶登入後在任何地方使用，其他人無法進入。資料保存在 Cloud Storage。步驟、費用及注意事項見 [deploy/README.md](deploy/README.md)。

```bash
PROJECT=你的專案ID EMAIL=你的Gmail ./deploy/deploy.sh
```

## 功能

| 分頁 | 用途 |
|---|---|
| 主頁 | 智能搜尋；我的卡、總值（可按眼睛圖示隱藏）、系列收集、牌組摘要；全部系列的進度圈（新系列標示「新」）；「檢查新系列及卡圖」按鈕；最近加入、我的牌組、最高價的卡。 |
| 卡庫 | 所有卡（附圖），可用智能搜尋及按系列、顏色、類別、稀有度、擁有狀況篩選，以 +/− 修改數量。未擁有的卡以淡色顯示，新卡標示「新」。 |
| 系列 | 按補充包、特殊補充包、高級補充包、起始牌組、推廣卡分類，所有系列均會顯示，每個系列附完成度圈。進入後可查看各稀有度的擁有數量（例如 SR 4/10）、只顯示缺卡、複製缺卡清單，並可選擇連同平行版一併計算。**批量輸入**：每張卡一個數字欄，按 Enter / Tab / ↓ 移至下一張，按 ↑ 返回上一張，輸入即時儲存，是填寫整個系列庫存最快的方法。**按稀有度批量設定**：例如開箱後把該系列所有 C「每款加 2 張」，再篩選 C 逐張修正；可撤銷。 |
| 開箱 | 選擇預設系列（例如 OP08），輸入 `45` 再按 Enter 即為 OP08-045 加一張；`45p1` 為平行版。可撤銷。亦可一次貼上多行，例如 `OP08-001 x2`。 |
| 熱門牌組 | onepiecetopdecks 的比賽牌組，按「最齊卡優先」排序，顯示欠多少張及欠哪些卡，一按即可加入我的牌組。 |
| 我的牌組 | 計劃中 → 已組好（預留卡，其他牌組不會再計算這些卡）→ 已售出（從卡庫扣除，記錄售價及收入）。顯示牌組市值、補齊所需金額及預計盈虧；售出時記錄當時市值以計算總盈虧。可編輯，並檢查規則（1 張領航卡、50 張、每款最多 4 張、顏色）。設有合併補卡清單。 |
| 高價卡 | 單價 HK$50（可調整）或以上的卡：單價、數量、總值、7 日升跌、悠々亭連結。可逐張輸入手動價格。顯示整個卡庫的總值（可隱藏），可匯出 CSV。 |
| 設定 | 執行 BOT；**更新方式（手動／自動，可選項目及每日／每週）**；匯率及價格係數；牌組是否計入平行版；匯出／匯入 JSON 備份；匯出 CSV。 |

### 檢查新系列及卡圖

在主頁或「設定」按 **檢查新系列及卡圖**（需以 `OPCG-Start.command` 或 `serve.py` 開啟本程式）：

* 重新讀取官方卡表的所有系列，找出新系列及新卡；
* 只下載新增的卡圖，以及官方網站已更換的卡圖（以圖片地址的版本號判斷）；
* 完成後主頁會顯示「最近更新」摘要，新系列及新卡會標示「新」，在搜尋輸入 `新` 即可列出新卡。

首次下載全部卡圖約需 30–60 分鐘，之後通常只需數分鐘。

### 選擇牌組並組建

1. 在 https://onepiecetopdecks.com/deck-list/ 選好想組建的牌組。
2. 複製其 deckgen 連結（`.../deckgen/?dn=RG%20Luffy&...&dg=1nOP13-001a4nOP13-016...`）或「Decklist in text」（`1xOP13-001` …）。
3. 貼到「我的牌組」頂部的匯入欄（或直接貼到主頁搜尋欄）。可一次貼上多條連結，每行一條。
4. 牌組名稱、名次、比賽、作者及日期會自動讀入，並即時顯示已有多少張、欠哪些卡及補齊所需金額。
5. 按「顯示中文效果」：每張卡下方會顯示官方中文效果（來自 asia-tc.onepiece-cardgame.com），【登場時】【啟動主要】【每回合1次】等關鍵字會以顏色標示。

熱門牌組經常使用 OP01、ST、PRB、EB 等舊系列的卡，因此卡表 BOT 預設會讀取所有系列。

### 智能搜尋

以空格或逗號分隔，可混合使用（在程式內按搜尋欄旁的 **?** 圖示亦可查看）：

| 寫法 | 意思 |
|---|---|
| `OP08` / `EB02` / `PRB01` | 系列 |
| `c5`、`c3-5` | 費用（領航卡為生命值） |
| `p6000`、`p5000-7000` | 力量值 |
| `k1000` | 反擊值 |
| `SR` / `SEC` / `L` … | 稀有度 |
| `紅` / `red` … | 顏色（輸入兩個即為雙色） |
| `領航` / `角色` / `事件` / `場地` | 類別 |
| `有` / `未有` | 已擁有／未擁有 |
| `平行` | 只顯示平行版 |
| `新` | 最近一次更新的新卡 |
| 其他字詞 | 名稱、卡號、特徵、效果 |

例如：`路飛 OP08 c5 p6000`、`紅 事件 未有`、`草帽 SR 有`。

### 卡的詳細頁

按任何卡圖：大圖、平行版切換、費用／力量值／反擊值／顏色／屬性、價格及走勢圖、手動價格、各版本數量 +/−、效果文字（【登場時】等關鍵字以顏色標示），以及用於哪副牌組。

### 手機

畫面闊度小於 640px 時使用底部導覽列：主頁 · 系列 · ＋開箱 · 牌組 · 更多（卡庫、高價卡、熱門牌組、設定）。

## BOT

| BOT | 來源 | 輸出 |
|---|---|---|
| `bot/scrape_cards.py` | https://asia-tc.onepiece-cardgame.com/cardlist/（每個系列一頁） | `data/cards.json`、`data/cards.js`、`data/images/` |
| `bot/scrape_decks.py` | https://onepiecetopdecks.com/deck-list/ 及其連結的牌組清單頁 | `data/decks.json`、`data/decks.js` |
| `bot/scrape_prices.py` | https://yuyu-tei.jp/sell/opc/s/op08 等（悠々亭日版單卡售價）及 https://open.er-api.com 匯率 | `data/prices.json`、`data/prices.js`（保留 180 日價格歷史） |

常用選項：

* `scrape_cards.py --list-series`：列出網站上的所有系列
* `scrape_cards.py --series OP08,OP09,EB02`：只更新指定系列（會與先前結果合併）
* `scrape_cards.py --images`：下載新增或已更換的卡圖
* `scrape_decks.py --max-pages 10` / `--url <頁面>`
* `scrape_prices.py`：預設只讀取你擁有的卡及你的牌組所用到的系列；`--sets all` 讀取全部，`--sets OP08,OP09` 指定系列，`--rate 0.049` 自訂匯率
* 三個 BOT 均有 `--save-html` 選項。如網站改版導致讀取失敗，可用 `data/raw/` 內的 HTML 修正解析程式。

BOT 每次請求之間會等候 1 秒。

## 價格計算方法

* **自動價格** = 悠々亭日版售價（JPY）× 匯率（JPY→HKD）× 係數。係數預設為 1，可在「設定」修改，例如亞洲中文版行情較低時可設為 0.8。
* **手動價格**（HK$）永遠優先。在「高價卡」或卡的詳細頁輸入；清空即改回自動價格。
* 平行版：悠々亭以同一卡號列出普通版及平行版，BOT 把普通版對應至 `OP08-001`，平行版按價格由低至高對應至 `_p1`、`_p2`。**此對應屬推測**，高價卡請自行核對，如有錯誤請輸入手動價格。
* 牌組市值以普通版價格計算。

## 資料

`data/`（卡表、卡圖、你的卡庫 `collection.json`、每日備份）已列入 git-ignore，**不會**上傳至 GitHub。卡圖及卡牌文字的版權屬 Bandai，請只作個人使用。

## 測試

```bash
node tests/engine.test.js
```

```bash
python3 -I tests/test_bots.py
```

```bash
python3 -I tests/test_serve.py
```

```bash
python3 -I tests/test_auto_update.py
```

```bash
python3 -I tests/test_demo.py
```

測試只使用自製的 HTML 及數據。每次推送或開 Pull Request 時，GitHub Actions 會自動執行以上測試（Python 3.9 及 3.12），並建置容器映像檔，確認未獲授權的帳戶無法進入。
