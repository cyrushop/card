#!/bin/bash
# 把 OPCG 卡庫部署到 Google Cloud Run，只限指定的 Google 帳戶使用。
# 用法（在儲存庫根目錄執行）：
#   PROJECT=my-project EMAIL=me@example.com ./deploy/deploy.sh
# 可選：REGION（預設 asia-east2 香港）、SERVICE（預設 opcg）、BUCKET（預設 PROJECT-opcg-data）
# 重複執行即可更新程式；資料保存在 Cloud Storage，不受影響。
set -euo pipefail

: "${PROJECT:?請設定 PROJECT（Google Cloud 專案 ID）}"
: "${EMAIL:?請設定 EMAIL（可使用本程式的 Google 帳戶，多個以逗號分隔）}"
REGION="${REGION:-asia-east2}"
SERVICE="${SERVICE:-opcg}"
BUCKET="${BUCKET:-${PROJECT}-opcg-data}"
SA_NAME="${SERVICE}-run"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

cd "$(dirname "$0")/.."
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "1/6 設定專案及啟用所需服務"
gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com iap.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

step "2/6 建立資料用的 Cloud Storage bucket：gs://$BUCKET"
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention
fi

step "3/6 建立服務帳戶並授權讀寫 bucket"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="OPCG Cloud Run"
fi
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin >/dev/null

step "4/6 建置並部署 Cloud Run 服務（需數分鐘）"
# --max-instances 1：只有一個執行個體寫入資料，避免互相覆蓋。
# --no-cpu-throttling：回應後仍保留 CPU，讓 BOT 可在背景執行。
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --iap \
  --service-account "$SA" \
  --execution-environment gen2 \
  --min-instances 0 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi --timeout 300 \
  --add-volume name=data,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount volume=data,mount-path=/data \
  --set-env-vars "^@^OPCG_DATA=/data@ALLOWED_EMAILS=$EMAIL"

step "5/6 讓 IAP 可以呼叫此服務"
gcloud services identity create --service=iap.googleapis.com --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT" >/dev/null 2>&1 \
  || echo "（未能自動建立 IAP 服務代理；如下一步失敗，請在 Cloud Console 的 Cloud Run → 安全性 中重新啟用 IAP。）"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
  --role=roles/run.invoker >/dev/null

step "6/6 只允許指定帳戶通過 IAP"
IFS=',' read -ra EMAILS <<< "$EMAIL"
for e in "${EMAILS[@]}"; do
  gcloud iap web add-iam-policy-binding --member="user:${e// /}" --role=roles/iap.httpsResourceAccessor \
    --region="$REGION" --resource-type=cloud-run --service="$SERVICE" >/dev/null
done

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
printf '\n完成。請以 %s 登入 Google 後開啟：\n  %s\n' "$EMAIL" "$URL"
echo "首次開啟後，請到「設定」按「檢查新系列及卡圖」下載卡表。"
