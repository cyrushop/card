#!/bin/bash
# 把 OPCG 卡庫部署到 Google Cloud Run，只限指定的 Google 帳戶使用。
# 用法（在儲存庫根目錄執行）：
#   PROJECT=my-project EMAIL=me@gmail.com ./deploy/deploy.sh
# 可選：
#   REGION     預設 asia-east2（香港）
#   SERVICE    預設 opcg
#   BUCKET     預設 PROJECT-opcg-data
#   IAP_SETUP  console（預設，個人 Google 帳戶適用：最後在 Cloud Console 按幾下啟用 IAP）
#              gcloud （Google Workspace 機構內的帳戶：全部自動完成）
#   SCHEDULE   自動更新檢查時間（cron 格式，香港時間），預設 "0 4 * * *"（每日凌晨 4 時）
# 重複執行即可更新程式；資料保存在 Cloud Storage，不受影響。
set -euo pipefail

: "${PROJECT:?請設定 PROJECT（Google Cloud 專案 ID）}"
: "${EMAIL:?請設定 EMAIL（可使用本程式的 Google 帳戶，多個以逗號分隔）}"
REGION="${REGION:-asia-east2}"
SERVICE="${SERVICE:-opcg}"
BUCKET="${BUCKET:-${PROJECT}-opcg-data}"
IAP_SETUP="${IAP_SETUP:-console}"
SCHEDULE="${SCHEDULE:-0 4 * * *}"
JOB="${SERVICE}-update"
SA_NAME="${SERVICE}-run"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
case "$IAP_SETUP" in console|gcloud) ;; *) echo "IAP_SETUP 只可以是 console 或 gcloud" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
VOLUME_FLAGS=(--add-volume "name=data,type=cloud-storage,bucket=$BUCKET" --add-volume-mount "volume=data,mount-path=/data")

step "1/7 設定專案及啟用所需服務"
gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com iap.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com cloudscheduler.googleapis.com
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

step "2/7 建立資料用的 Cloud Storage bucket：gs://$BUCKET"
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention
fi

step "3/7 建立服務帳戶並授權讀寫 bucket"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="OPCG Cloud Run"
fi
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin >/dev/null

step "4/7 建置並部署 Cloud Run 服務（需數分鐘）"
# --no-allow-unauthenticated：未啟用 IAP 前，任何人（包括你）都無法進入。
# --max-instances 1：只有一個執行個體寫入資料，避免互相覆蓋。
# --no-cpu-throttling：回應後仍保留 CPU，讓手動按下的 BOT 可在背景執行。
IAP_FLAG=()
[ "$IAP_SETUP" = gcloud ] && IAP_FLAG=(--iap)
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --no-allow-unauthenticated \
  ${IAP_FLAG[@]+"${IAP_FLAG[@]}"} \
  --service-account "$SA" \
  --execution-environment gen2 \
  --min-instances 0 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi --timeout 300 \
  "${VOLUME_FLAGS[@]}" \
  --set-env-vars "^;^OPCG_DATA=/data;ALLOWED_EMAILS=$EMAIL"
IMAGE="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"

step "5/7 自動更新：Cloud Run 工作及每日排程"
# 工作每次執行 bot/auto_update.py：在程式「設定 → 更新方式」選了「自動」才會更新，選「手動」則立即結束。
gcloud run jobs deploy "$JOB" \
  --image "$IMAGE" \
  --region "$REGION" \
  --service-account "$SA" \
  --command python3 --args="-I,bot/auto_update.py" \
  --task-timeout 3h --max-retries 0 --cpu 1 --memory 1Gi \
  "${VOLUME_FLAGS[@]}" \
  --set-env-vars OPCG_DATA=/data
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member="serviceAccount:$SA" --role=roles/run.invoker >/dev/null
SCHED_ARGS=(--location "$REGION" --schedule "$SCHEDULE" --time-zone "Asia/Hong_Kong"
  --uri "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run"
  --http-method POST --oauth-service-account-email "$SA")
if gcloud scheduler jobs describe "${SERVICE}-daily" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${SERVICE}-daily" "${SCHED_ARGS[@]}"
else
  gcloud scheduler jobs create http "${SERVICE}-daily" "${SCHED_ARGS[@]}"
fi

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
grant_access() {
  IFS=',' read -ra EMAILS <<< "$EMAIL"
  for e in "${EMAILS[@]}"; do
    gcloud iap web add-iam-policy-binding --member="user:${e// /}" --role=roles/iap.httpsResourceAccessor \
      --region="$REGION" --resource-type=cloud-run --service="$SERVICE" >/dev/null
  done
}

if [ "$IAP_SETUP" = gcloud ]; then
  step "6/7 讓 IAP 可以呼叫此服務"
  gcloud services identity create --service=iap.googleapis.com --project="$PROJECT" \
    || gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT" \
    || echo "（未能自動建立 IAP 服務代理；如下一步失敗，請在 Cloud Console 的 Cloud Run → 安全性 中重新啟用 IAP。）"
  gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
    --role=roles/run.invoker >/dev/null
  step "7/7 只允許指定帳戶通過 IAP"
  grant_access
  printf '\n完成。請以 %s 登入 Google 後開啟：\n  %s\n' "$EMAIL" "$URL"
else
  step "6/7 在 Cloud Console 啟用 IAP（個人 Google 帳戶需要這一步）"
  cat <<EOF
服務已部署，但目前任何人都無法進入（包括你）。請在瀏覽器完成以下步驟：
  1. 開啟 https://console.cloud.google.com/run?project=${PROJECT} ，按服務「${SERVICE}」。
  2. 到「安全性」分頁，在「驗證」選擇需要驗證，並勾選「Identity-Aware Proxy (IAP)」，然後儲存。
     （Console 會自動建立個人帳戶所需的 OAuth 用戶端。）
完成後按 Enter，本腳本會把 ${EMAIL} 加入允許名單。
EOF
  read -r _
  step "7/7 只允許指定帳戶通過 IAP"
  if grant_access; then
    printf '\n完成。請以 %s 登入 Google 後開啟：\n  %s\n' "$EMAIL" "$URL"
  else
    echo "未能加入允許名單。請在服務的「安全性」分頁 → IAP → 新增主體：${EMAIL}，角色選「IAP-secured Web App User」。"
    echo "網址：$URL"
  fi
fi
echo "首次開啟後，請到「設定」按「檢查新系列及卡圖」下載卡表；如要自動更新，在「設定 → 更新方式」選「自動」。"
