#!/bin/bash
# 只需執行一次：讓 GitHub（cyrushop/card 的 main 分支）可以自動部署到你的 Google Cloud 專案。
# 不會建立或下載任何金鑰：GitHub 每次部署時以短期憑證登入（Workload Identity Federation），
# 而且只接受來自指定程式庫 main 分支的請求。
#
# 用法（在 Cloud Shell 的 card 資料夾執行，先完成過一次 deploy/deploy.sh）：
#   PROJECT=card-513703 ./deploy/setup-github-deploy.sh
# 可選：REPO（預設 cyrushop/card）、REGION（預設 asia-east2）、SERVICE（預設 opcg）
set -euo pipefail

: "${PROJECT:?請設定 PROJECT（Google Cloud 專案 ID）}"
REPO="${REPO:-cyrushop/card}"
REGION="${REGION:-asia-east2}"
SERVICE="${SERVICE:-opcg}"
POOL="github"
PROVIDER="card-repo"
SA_NAME="github-deploy"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
RUN_SA="${SERVICE}-run@${PROJECT}.iam.gserviceaccount.com"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
# Google limits some of these calls to one a minute per project: wait and try again instead of stopping.
retry() {
  local n out
  for n in 1 2 3 4; do
    if out="$("$@" 2>&1)"; then return 0; fi
    if [[ "$out" == *RATE_LIMIT_EXCEEDED* || "$out" == *RESOURCE_EXHAUSTED* ]] && [ "$n" -lt 4 ]; then
      echo "  （Google 每分鐘限額，65 秒後重試：第 $n 次）"; sleep 65; continue
    fi
    echo "$out" >&2; return 1
  done
}

step "1/5 設定專案及啟用所需服務"
gcloud config set project "$PROJECT" >/dev/null
retry gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com
NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud run services describe "$SERVICE" --region "$REGION" >/dev/null \
  || { echo "找不到 Cloud Run 服務 ${SERVICE}：請先執行一次 deploy/deploy.sh。" >&2; exit 2; }

step "2/5 建立部署專用帳戶：$SA"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || retry gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deploy (${REPO})"

step "3/5 只給部署所需的權限"
# Deploy from source (upload, build, roll out), update and run the update job, read build logs.
for role in roles/run.sourceDeveloper roles/run.developer roles/serviceusage.serviceUsageConsumer roles/logging.viewer; do
  retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None
done
# Act as the service's own account, and as the account Cloud Build builds with.
for target in "$RUN_SA" "${NUM}-compute@developer.gserviceaccount.com"; do
  retry gcloud iam service-accounts add-iam-policy-binding "$target" \
    --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
done

step "4/5 只信任 ${REPO} 的 main 分支"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || retry gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" >/dev/null 2>&1 \
  || retry gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global \
    --workload-identity-pool="$POOL" --display-name="${REPO}" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${REPO}' && assertion.ref=='refs/heads/main'"
retry gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}"

step "5/5 完成"
cat <<EOF
GitHub 自動部署已在 Google Cloud 設定好。最後一步：把以下內容交給 Claude（不是密碼，可以公開），
Claude 會把它加入程式庫的 deploy/github-deploy.env，合併後自動部署便會啟用：

GCP_PROJECT=${PROJECT}
GCP_PROJECT_NUMBER=${NUM}
GCP_REGION=${REGION}
GCP_SERVICE=${SERVICE}
EOF
