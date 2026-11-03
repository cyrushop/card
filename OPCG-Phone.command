#!/bin/bash
# OPCG 卡庫 — 與手機一同使用（同一個 Wi-Fi）。在 Finder 按兩下即可。
# 首次使用時須設定 PIN，手機開啟時需輸入。PIN 儲存於 data/pin.txt。

cd "$(dirname "$0")" || exit 1
PORT=8765

PY=""
for p in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$p"; break
  fi
done
if [ -z "$PY" ]; then
  echo "找不到 Python 3（需要 3.9 或以上版本）。請先按兩下 OPCG-Start.command，它會說明安裝方法。"
  printf '按 Enter 關閉…'; read -r _; exit 1
fi

if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "OPCG 卡庫已在另一個視窗執行。請先關閉該視窗，再按兩下此檔案。"
  printf '按 Enter 關閉…'; read -r _; exit 1
fi

mkdir -p data
if [ ! -s data/pin.txt ]; then
  printf '設定手機使用的 PIN（4–8 位數字）：'
  read -r PIN
  while ! [[ "$PIN" =~ ^[0-9]{4,8}$ ]]; do printf 'PIN 必須為 4–8 位數字，請重新輸入：'; read -r PIN; done
  printf '%s' "$PIN" > data/pin.txt
  chmod 600 data/pin.txt
fi
PIN="$(cat data/pin.txt)"

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
printf '\n\033[1m手機（同一個 Wi-Fi）請開啟：http://%s:%s\033[0m\n' "${IP:-本機 IP}" "$PORT"
echo "PIN：$PIN   （如要更改 PIN：刪除 data/pin.txt 後再按兩下此檔案）"
echo "如 Mac 詢問「是否允許 Python 接受連入連線」，請按「允許」。"
echo "停止：關閉此視窗，或按 Control + C。"
echo

"$PY" -u serve.py --port "$PORT" --lan --pin "$PIN" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM HUP EXIT
sleep 1
open "http://localhost:$PORT"
wait $SERVER
