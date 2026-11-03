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

## 事前準備

1. 一個已啟用帳單的 Google Cloud 專案（記下專案 ID）。
2. 在 Mac 安裝 Google Cloud CLI：https://cloud.google.com/sdk/docs/install ，然後登入：

   ```bash
   gcloud auth login
   ```

3. **帳戶類型**：
   * **個人 Google 帳戶（預設）**：IAP 對沒有機構的專案需要自訂 OAuth 用戶端。最簡單的做法是在 Cloud Console 啟用 IAP，Console 會自動建立該用戶端。部署腳本會在最後提示你在 Console 完成這一步（約 1 分鐘）。
   * **Google Workspace 機構內的帳戶**：加上 `IAP_SETUP=gcloud`，全部由腳本自動完成。
   * 參考：https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run

## 部署

在儲存庫根目錄執行（把專案 ID 及電郵換成你自己的）：

```bash
PROJECT=你的專案ID EMAIL=你的Gmail ./deploy/deploy.sh
```

可選設定：`REGION`（預設 `asia-east2` 香港）、`SERVICE`（預設 `opcg`）、`BUCKET`（預設 `專案ID-opcg-data`）、`SCHEDULE`（自動更新檢查時間，預設每日凌晨 4 時）、`IAP_SETUP`（預設 `console`）。允許多個帳戶時，以逗號分隔電郵。

腳本步驟：

1. 啟用所需服務；
2. 建立私人 Cloud Storage bucket；
3. 建立服務帳戶，只授權讀寫該 bucket；
4. 建置並部署 Cloud Run 服務（此時任何人都無法進入）；
5. 建立自動更新工作及每日排程；
6. **（個人帳戶）提示你在 Cloud Console 啟用 IAP**：開啟 Cloud Run → 服務 `opcg` →「安全性」→ 選擇需要驗證並勾選「Identity-Aware Proxy (IAP)」→ 儲存，然後回到終端機按 Enter；
7. 把你的電郵加入 IAP 允許名單。

完成後會顯示網址（`https://opcg-….run.app`）。以指定帳戶登入 Google 後開啟，再到「設定」按「檢查新系列及卡圖」下載卡表。

**更新程式**：取得新版本後再執行同一條指令即可，資料保存在 bucket 內，不受影響。

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

* **手動按下的 BOT 需要保持頁面開啟**：Cloud Run 在沒有請求約 15 分鐘後可能停止執行個體。手動執行「檢查新系列及卡圖」時，程式每 1.5 秒查詢一次進度，只要頁面保持開啟，BOT 便會繼續執行。首次下載全部卡圖約需 30–60 分鐘（估計）。自動更新由獨立的 Cloud Run 工作執行（上限 3 小時），不受此限制。
* **只有一個執行個體**：設定為最多 1 個，以免多個執行個體同時寫入資料。
* **Cloud Storage 掛載**並非完整的檔案系統（例如沒有檔案鎖）。你的卡庫（`collection.json`）只由網上服務寫入；自動更新工作只會寫入卡表、卡圖、價格及更新記錄，兩者不會同時寫入你的卡庫。建議避免在自動更新時間（預設凌晨 4 時）同時手動按更新。

## 費用（估計，請以 Google 官方價目為準）

個人使用的流量很小，費用主要來自：
* Cloud Run：只在執行個體運行時收費（閒置後停止）。價目：https://cloud.google.com/run/pricing
* Cloud Storage：卡圖約數百 MB。價目：https://cloud.google.com/storage/pricing
* Cloud Build／Artifact Registry：每次部署建置一次映像檔。
* Cloud Scheduler 及 Cloud Run 工作：每日一次；選「手動」時工作只執行數秒。價目：https://cloud.google.com/scheduler/pricing

建議在 Google Cloud Console 的「帳單」設定預算提醒。

## 停用或刪除

```bash
gcloud scheduler jobs delete opcg-daily --location asia-east2
gcloud run jobs delete opcg-update --region asia-east2
gcloud run services delete opcg --region asia-east2
```

刪除服務不會刪除 bucket 內的資料。如確定不再需要，可再刪除 bucket：`gcloud storage rm -r gs://BUCKET`（無法復原）。
