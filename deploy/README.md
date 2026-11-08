# 網上版本：Google Cloud Run（只限自己使用）

部署後可在任何地方以電腦或手機開啟本程式，但只有你指定的 Google 帳戶能進入。

## 架構

| 部分 | 用途 |
|---|---|
| **Cloud Run** | 執行 `serve.py --cloud`（程式及 BOT）。最多 1 個執行個體，閒置時自動停止。 |
| **Identity-Aware Proxy（IAP）** | 在進入程式前要求以 Google 帳戶登入，只放行指定帳戶。 |
| **Cloud Storage bucket** | 掛載為 `/data`，保存卡表、卡圖、價格及你的卡庫（`collection.json` 及每日備份）。 |
| **Cloud Run 工作 + Cloud Scheduler** | 每日凌晨 4 時（香港時間）執行一次自動更新檢查。在程式「設定 → 更新方式」選「手動」時，工作會立即結束，不作任何更新。 |

程式本身亦會再次檢查 IAP 傳來的帳戶電郵（`ALLOWED_EMAILS`），即使設定出錯，其他帳戶也無法讀取資料。若沒有設定任何存取限制，`serve.py --cloud` 會拒絕啟動。

網上版的卡圖會壓縮為 400 像素寬的 WebP（約為原圖的五分之一），以減少儲存空間及網絡流量；瀏覽器會把卡圖保留一星期，不會每次重新下載。電腦版仍使用原圖。

## 事前準備

1. 一個已啟用帳單的 Google Cloud 專案（記下專案 ID）。建議在「帳單 → 預算與快訊」設定每月預算提醒（例如 US$5）。
2. 開啟 **Cloud Shell**：https://shell.cloud.google.com 。這是瀏覽器內的終端機，已安裝 gcloud、git 及 Python，並以你的 Google 帳戶登入，不需在電腦安裝任何東西。（亦可在 Mac 安裝 Google Cloud CLI：https://cloud.google.com/sdk/docs/install ，然後執行 `gcloud auth login`。）
3. **帳戶類型**：
   * **個人 Google 帳戶（預設，`IAP_SETUP=console`）**：專案沒有「機構」，Google 管理的 OAuth 用戶端只讓機構內的使用者進入，所以需要一個**自訂 OAuth 用戶端**（見下文）。部署腳本會在第 6 步提示你。
   * **Google Workspace 機構內的帳戶**：加上 `IAP_SETUP=gcloud`，全部由腳本自動完成。
   * 參考：https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run

## 部署

在 Cloud Shell 執行（把專案 ID 換成你自己的；`EMAIL` 會自動使用 Cloud Shell 登入的帳戶）：

```bash
git clone https://github.com/cyrushop/card.git && cd card
```

```bash
PROJECT=你的專案ID EMAIL=$(gcloud config get-value account) ./deploy/deploy.sh
```

可選設定：`REGION`（預設 `asia-east2` 香港）、`SERVICE`（預設 `opcg`）、`BUCKET`（預設 `專案ID-opcg-data`）、`SCHEDULE`（自動更新檢查時間，預設每日凌晨 4 時）、`IAP_SETUP`（預設 `console`）。允許多個帳戶時，以逗號分隔電郵。

腳本步驟：

1. 啟用所需服務，並授權建置用的服務帳戶（Cloud Run Builder）；首次部署會等候 90 秒讓權限生效；
2. 建立私人 Cloud Storage bucket；
3. 建立服務帳戶，只授權讀寫該 bucket；
4. 建置並部署 Cloud Run 服務，同時啟用 IAP；設定 Artifact Registry 只保留最近 2 個程式映像檔；
5. 建立自動更新工作及每日排程；
6. 讓 IAP 可以呼叫此服務；**（個人帳戶）**如未設定自訂 OAuth 用戶端，會提示你建立，然後要求貼上用戶端 ID 及密鑰（密鑰輸入時不會顯示；直接按 Enter 可略過）；
7. 把你的電郵加入 IAP 允許名單，並顯示名單。

腳本只在第 6 步要求輸入。**等候輸入時，不要貼上其他指令**，否則該指令會被當作輸入。

完成後會顯示網址（`https://opcg-….run.app`）及首次下載的指令。約 5 分鐘後（權限生效），以指定帳戶登入 Google 後開啟。

### 首次下載卡表、卡圖及價格

在 Google 的伺服器上執行，約 2 小時，不需保持頁面或 Cloud Shell 開啟：

```bash
gcloud run jobs execute opcg-update --region asia-east2 --args="-I,bot/auto_update.py,--force"
```

查看進度（卡圖數目，全部約 5,000 張）：

```bash
gcloud storage ls gs://你的專案ID-opcg-data/images/ | wc -l
```

查看是否完成（`COMPLETE` 顯示 `1 / 1`）：

```bash
gcloud run jobs executions list --job opcg-update --region asia-east2
```

### 個人帳戶：自訂 OAuth 用戶端

只需做一次（之後重新部署不用再做）：

1. 開啟 `https://console.cloud.google.com/auth/overview?project=你的專案ID` → 「開始使用」：應用程式名稱（例如 `OPCG`）、使用者支援電郵、**目標對象選「外部」**、聯絡電郵 → 建立。
2. 「目標對象」→「測試使用者」→ 新增你的 Gmail。
3. 「用戶端」→「建立用戶端」→ 應用程式類型選「網頁應用程式」→ 建立。記下**用戶端 ID** 及**用戶端密鑰**。
4. 編輯該用戶端，在「已授權的重新導向 URI」加入（把 `用戶端ID` 換成上一步的 ID）：

   ```
   https://iap.googleapis.com/v1/oauth/clientIds/用戶端ID:handleRedirect
   ```

5. 回到部署腳本第 6 步貼上用戶端 ID 及密鑰。如已略過，可手動設定（把兩個值換成你的）：

   ```bash
   printf 'access_settings:\n  oauth_settings:\n    client_id: 用戶端ID\n    client_secret: 用戶端密鑰\n' > ~/iap_settings.yaml && gcloud iap settings set ~/iap_settings.yaml --project=你的專案ID
   ```

### 無法進入時

| 看到的畫面 | 原因 | 處理 |
|---|---|---|
| `Error: Forbidden … does not have permission to get URL` | IAP 未啟用，請求直接被 Cloud Run 拒絕 | `gcloud run services update opcg --region asia-east2 --iap` |
| Google 登入後顯示 `You don't have access` | 未設定自訂 OAuth 用戶端（個人帳戶），或帳戶不在允許名單 | 先按上文設定自訂 OAuth 用戶端；再以 `gcloud iap web get-iam-policy --region=asia-east2 --resource-type=cloud-run --service=opcg` 檢查名單 |
| `You do not currently have an active account selected` | Cloud Shell 重新連線後未選帳戶 | `gcloud config set account 你的Gmail` |

權限更改後約需數分鐘生效。測試時請開新的無痕視窗，只輸入網址本身（不要重新載入帶 `?gcp-iap-mode=…` 的舊網址）。

**更新程式**：在 Cloud Shell 的 `card` 資料夾執行 `git pull`，再執行同一條部署指令即可，資料保存在 bucket 內，不受影響。

## 自動部署（合併後由 GitHub 部署）

設定後，`main` 有新程式並通過自動測試，GitHub 便會自動部署網上服務及更新工作，不用再在 Cloud Shell 執行部署指令。GitHub 以短期憑證登入（Workload Identity Federation），**不會建立或儲存任何金鑰**，而且 Google 只接受來自 `cyrushop/card` 的 `main` 分支的請求。

1. 在 Cloud Shell 的 `card` 資料夾執行一次（需先完成過一次 `deploy/deploy.sh`）：

   ```bash
   git pull origin main && PROJECT=你的專案ID ./deploy/setup-github-deploy.sh
   ```

2. 腳本最後會顯示 4 行設定（專案 ID、專案編號、地區、服務名稱，不是密碼）。把它們加入程式庫的 `deploy/github-deploy.env`（可交給 Claude 開 PR），合併後即啟用。

之後：
* 每次合併到 `main` 並通過測試，便會自動部署（GitHub →「Actions」→「deploy」可看記錄）。
* 手動執行：GitHub →「Actions」→「deploy」→「Run workflow」：`deploy` 重新部署；`update` 立即執行一次完整更新（卡表、卡圖、價格）。
* 存取設定（IAP、允許名單、OAuth 用戶端）、儲存空間及排程不會被自動部署改動；要改動這些，仍使用 `deploy/deploy.sh`。

部署帳戶 `github-deploy` 的權限：Cloud Run Source Developer、Cloud Run Developer、Service Usage Consumer、Logs Viewer，以及可以代表服務帳戶及建置帳戶執行（Service Account User）。

## 把電腦上的卡庫搬到網上版本

方法一（建議）：在電腦版「設定」按「匯出備份（JSON）」，然後在網上版「設定」按「匯入備份」。

方法二：直接上載資料檔（BUCKET 換成你的 bucket 名稱）：

```bash
gcloud storage cp data/collection.json gs://BUCKET/collection.json
```

## 手動或自動更新

在程式「設定 → 更新方式」選擇：

* **手動**（預設）：只在你按「檢查新系列及卡圖」、「更新價格」等按鈕時更新。
* **自動**：選擇要更新的項目（卡表及卡圖、價格、熱門牌組）及頻率（每日或每週）。網上版本由 Cloud Scheduler 每日凌晨 4 時啟動檢查，到期的項目便會更新，無須開啟頁面；結果顯示於同一頁的「最近一次更新」。電腦版本則在程式開啟期間每 30 分鐘檢查一次。

## 使用時須注意

* **手動按下的 BOT 需要保持頁面開啟**：Cloud Run 在沒有請求約 15 分鐘後可能停止執行個體。手動執行「檢查新系列及卡圖」時，程式每 1.5 秒查詢一次進度，只要頁面保持開啟，BOT 便會繼續執行。下載大量卡圖時，請改用上文「首次下載」的工作指令（上限 3 小時，不受此限制）。
* **只有一個執行個體**：設定為最多 1 個，以免多個執行個體同時寫入資料。
* **Cloud Storage 掛載**並非完整的檔案系統（例如沒有檔案鎖）。你的卡庫（`collection.json`）只由網上服務寫入；自動更新工作只會寫入卡表、卡圖、價格及更新記錄，兩者不會同時寫入你的卡庫。建議避免在自動更新時間（預設凌晨 4 時）同時手動按更新。
* **由舊版升級**：首次在新版執行卡圖更新時，已下載的原圖會在伺服器上直接轉為 WebP 並刪除原圖，不會重新下載。

## 費用（估計，請以 Google 官方價目及你的帳單為準）

個人使用的流量很小。以下為估計，並非保證：

| 項目 | 估計 |
|---|---|
| Cloud Storage | 壓縮後卡圖約 0.2–0.3 GB，每月約 US$0.01 |
| Cloud Run 服務 | 每月首 240,000 vCPU 秒及 450,000 GiB 秒免費；每日使用約 1 小時應在免費範圍內 |
| Cloud Run 工作 | 每日自動更新數分鐘，約 US$0–0.4 |
| 網絡流量 | 首 1 GiB 免費，之後亞洲約 US$0.12/GiB；壓縮及瀏覽器快取後通常很少 |
| Artifact Registry | 只保留最近 2 個映像檔，通常在免費 0.5 GB 內 |
| Cloud Build、IAP、Cloud Scheduler | 個人使用通常不收費 |

價目：
https://cloud.google.com/run/pricing ・ https://cloud.google.com/storage/pricing ・ https://cloud.google.com/vpc/network-pricing ・ https://cloud.google.com/artifact-registry/pricing ・ https://cloud.google.com/build/pricing ・ https://cloud.google.com/iap/pricing ・ https://cloud.google.com/scheduler/pricing

## 停用或刪除

```bash
gcloud scheduler jobs delete opcg-daily --location asia-east2
gcloud run jobs delete opcg-update --region asia-east2
gcloud run services delete opcg --region asia-east2
```

刪除服務不會刪除 bucket 內的資料。如確定不再需要，可再刪除 bucket：`gcloud storage rm -r gs://BUCKET`（無法復原）。
