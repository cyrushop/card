#!/bin/bash
# 把 OPCG 卡庫部署到 Google Cloud Run，只限指定的 Google 帳戶使用。
# 用法（在儲存庫根目錄執行）：
#   PROJECT=my-project EMAIL=me@gmail.com ./deploy/deploy.sh
# 可選：
#   REGION     預設 asia-east2（香港）
#   SERVICE    預設 opcg
#   BUCKET     預設 PROJECT-opcg-data
#   IAP_SETUP  console（預設，個人 Google 帳戶：需要一個自訂 OAuth 用戶端，腳本會提示你在 Console 建立）
#              gcloud （Google Workspace 機構內的帳戶：Google 管理的用戶端已足夠，全部自動完成）
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
# Deploying from source builds with the Compute Engine default service account. Newer projects no
# longer give it broad rights, so the build cannot read the uploaded source ("does not have
# storage.objects.get access") until it has the Cloud Run Builder role.
# https://cloud.google.com/run/docs/deploying-source-code
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$BUILD_SA" \
  --role=roles/run.builder --condition=None >/dev/null
if ! gcloud run services describe "$SERVICE" --region "$REGION" >/dev/null 2>&1; then
  # A new grant takes a couple of minutes to apply; only the first deploy has to wait for it.
  echo "已授權建置用的服務帳戶（Cloud Run Builder）。首次部署，等候 90 秒讓權限生效…"
  sleep 90
fi

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
# --no-allow-unauthenticated：只有經 IAP 登入的帳戶才可進入。
# --iap：直接在 Cloud Run 啟用 IAP（個人帳戶亦可用；但個人帳戶還需要第 6 步的自訂 OAuth 用戶端）。
# --max-instances 1：只有一個執行個體寫入資料，避免互相覆蓋。
# --no-cpu-throttling：回應後仍保留 CPU，讓手動按下的 BOT 可在背景執行。
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --iap \
  --service-account "$SA" \
  --execution-environment gen2 \
  --min-instances 0 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi --timeout 300 \
  "${VOLUME_FLAGS[@]}" \
  --set-env-vars "^;^OPCG_DATA=/data;ALLOWED_EMAILS=$EMAIL"
IMAGE="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(spec.template.spec.containers[0].image)')"

# Each deploy stores a new container image (about 0.1-0.2 GB). Keep the latest 2 and let Artifact
# Registry delete older ones, so storage stays within the free 0.5 GB.
POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<'EOF'
[
 {"name": "keep-latest-2", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
 {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "1d"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location "$REGION" \
  --policy "$POLICY_FILE" --no-dry-run >/dev/null \
  || echo "（未能設定自動清理舊映像檔；不影響使用，只是舊版本會佔用 Artifact Registry 空間。）"
rm -f "$POLICY_FILE"

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

step "6/7 讓 IAP 可以呼叫此服務"
gcloud services identity create --service=iap.googleapis.com --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT" >/dev/null \
  || echo "（未能建立 IAP 服務代理，請把畫面訊息交給 Claude。）"
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" \
  --role=roles/run.invoker >/dev/null

if [ "$IAP_SETUP" = console ]; then
  # Personal accounts: the Google-managed OAuth client only lets in users of an organization, so
  # without a custom client IAP shows "You don't have access" to everyone, even allowed users.
  CLIENT_ID="$(gcloud iap settings get --project="$PROJECT" \
    --format='value(accessSettings.oauthSettings.clientId)' 2>/dev/null || true)"
  if [ -n "$CLIENT_ID" ]; then
    echo "已設定自訂 OAuth 用戶端（$CLIENT_ID）。"
  else
    cat <<EOF

個人 Google 帳戶需要一個自訂 OAuth 用戶端，否則 IAP 會對所有人顯示「You don't have access」。
請在瀏覽器完成（詳見 deploy/README.md「個人帳戶：自訂 OAuth 用戶端」）：
  1. https://console.cloud.google.com/auth/overview?project=${PROJECT}
     → 開始使用：應用程式名稱 OPCG、支援電郵、目標對象選「外部」→ 建立。
  2. 目標對象 → 測試使用者 → 新增 ${EMAIL}。
  3. 用戶端 → 建立用戶端 → 網頁應用程式 → 建立，記下用戶端 ID 及密鑰；
     再編輯該用戶端，在「已授權的重新導向 URI」加入：
     https://iap.googleapis.com/v1/oauth/clientIds/用戶端ID:handleRedirect

EOF
    printf '貼上用戶端 ID（直接按 Enter 可略過，稍後再設定）：'
    read -r CLIENT_ID
    if [ -n "$CLIENT_ID" ]; then
      printf '貼上用戶端密鑰（輸入時不會顯示）：'
      read -rs CLIENT_SECRET
      echo
      SETTINGS_FILE="$(mktemp)"
      printf 'access_settings:\n  oauth_settings:\n    client_id: %s\n    client_secret: %s\n' \
        "$CLIENT_ID" "$CLIENT_SECRET" > "$SETTINGS_FILE"
      gcloud iap settings set "$SETTINGS_FILE" --project="$PROJECT" >/dev/null \
        && echo "IAP 已改用自訂 OAuth 用戶端。" \
        || echo "未能設定 OAuth 用戶端，請把畫面訊息交給 Claude。"
      rm -f "$SETTINGS_FILE"
    else
      echo "已略過。設定前，網上版會顯示「You don't have access」。"
    fi
  fi
fi

step "7/7 只允許指定帳戶通過 IAP"
if grant_access; then
  echo "允許名單："
  gcloud iap web get-iam-policy --region="$REGION" --resource-type=cloud-run --service="$SERVICE" \
    --flatten='bindings[].members' --format='value(bindings.members)' | sed 's/^/  /'
  printf '\n完成。約 5 分鐘後，請以 %s 登入 Google 後開啟（建議先用無痕視窗）：\n  %s\n' "$EMAIL" "$URL"
else
  echo "未能加入允許名單。請在服務的「安全性」分頁 → IAP → 新增主體：${EMAIL}，角色選「IAP-secured Web App User」。"
  echo "網址：$URL"
fi
cat <<EOF

首次使用：在 Google 的伺服器上下載卡表、卡圖及價格（約 2 小時，不用保持頁面開啟）：
  gcloud run jobs execute ${JOB} --region ${REGION} --args="-I,bot/auto_update.py,--force"
之後如要每日自動更新，在程式「設定 → 更新方式」選「自動」。
EOF
