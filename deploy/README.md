# 網上版本：Google Cloud Run（只限自己使用）

部署後可在任何地方以電腦或手機開啟本程式，但只有你指定的 Google 帳戶能進入。

## 架構

| 部分 | 用途 |
|---|---|
| **Cloud Run** | 執行 `serve.py --cloud`（程式及 BOT）。最多 1 個執行個體，閒置時自動停止。 |
| **Identity-Aware Proxy（IAP）** | 在進入程式前要求以 Google 帳戶登入，只放行指定帳戶。 |
| **Cloud Storage bucket** | 掛載為 `/data`，保存卡表、卡圖、價格及你的卡庫（`collection.json` 及每日備份）。 |

程式本身亦會再次檢查 IAP 傳來的帳戶電郵（`ALLOWED_EMAILS`），即使設定出錯，其他帳戶也無法讀取資料。若沒有設定任何存取限制，`serve.py --cloud` 會拒絕啟動。

## 事前準備

1. 一個已啟用帳單的 Google Cloud 專案（記下專案 ID）。
2. 在 Mac 安裝 Google Cloud CLI：https://cloud.google.com/sdk/docs/install ，然後登入：

   ```bash
   gcloud auth login
   ```

3. **帳戶類型（重要）**：IAP 預設只接受與專案屬於**同一個 Google Workspace 機構**的帳戶。
   * 如專案建立在你公司的 Google Workspace 機構之下，而你用公司帳戶登入，可直接使用。
   * 如使用個人 Gmail 帳戶，或專案不屬於任何機構，需要另外設定 OAuth 用戶端，詳見 Google 文件：https://cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run 。

## 部署

在儲存庫根目錄執行（把專案 ID 及電郵換成你自己的）：

```bash
PROJECT=你的專案ID EMAIL=你的電郵 ./deploy/deploy.sh
```

可選設定：`REGION`（預設 `asia-east2` 香港）、`SERVICE`（預設 `opcg`）、`BUCKET`（預設 `專案ID-opcg-data`）。允許多個帳戶時，以逗號分隔電郵。

完成後會顯示網址（`https://opcg-….run.app`）。以指定帳戶登入 Google 後開啟，再到「設定」按「檢查新系列及卡圖」下載卡表。

**更新程式**：取得新版本後再執行同一條指令即可，資料保存在 bucket 內，不受影響。

## 把電腦上的卡庫搬到網上版本

方法一（建議）：在電腦版「設定」按「匯出備份（JSON）」，然後在網上版「設定」按「匯入備份」。

方法二：直接上載資料檔（BUCKET 換成你的 bucket 名稱）：

```bash
gcloud storage cp data/collection.json gs://BUCKET/collection.json
```

## 使用時須注意

* **BOT 需要保持頁面開啟**：Cloud Run 在沒有請求約 15 分鐘後可能停止執行個體。執行「檢查新系列及卡圖」時，程式每 1.5 秒查詢一次進度，只要頁面保持開啟，BOT 便會繼續執行。首次下載全部卡圖約需 30–60 分鐘（估計）。
* **只有一個執行個體**：設定為最多 1 個，以免多個執行個體同時寫入資料。
* **Cloud Storage 掛載**並非完整的檔案系統（例如沒有檔案鎖），但本程式只由一個執行個體寫入，不受影響。

## 費用（估計，請以 Google 官方價目為準）

個人使用的流量很小，費用主要來自：
* Cloud Run：只在執行個體運行時收費（閒置後停止）。價目：https://cloud.google.com/run/pricing
* Cloud Storage：卡圖約數百 MB。價目：https://cloud.google.com/storage/pricing
* Cloud Build／Artifact Registry：每次部署建置一次映像檔。

建議在 Google Cloud Console 的「帳單」設定預算提醒。

## 停用或刪除

```bash
gcloud run services delete opcg --region asia-east2
```

刪除服務不會刪除 bucket 內的資料。如確定不再需要，可再刪除 bucket：`gcloud storage rm -r gs://BUCKET`（無法復原）。
