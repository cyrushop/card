#!/bin/bash
# OPCG 卡庫 — Mac 啟動檔。在 Finder 按兩下即可。
# 啟動本機伺服器，然後以瀏覽器開啟 http://localhost:8765
# 停止：關閉此 Terminal 視窗，或按 Control + C。

cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://localhost:$PORT"

say_line() { printf '\n\033[1m%s\033[0m\n' "$1"; }
pause_exit() { printf '\n按 Enter 關閉…'; read -r _; exit "${1:-1}"; }

# 1. Python 3.9 或以上
PY=""
for p in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$p"; break
  fi
done
if [ -z "$PY" ]; then
  say_line "找不到 Python 3（需要 3.9 或以上版本）。"
  echo "Mac 會彈出視窗詢問是否安裝「Command Line Developer Tools」，請按「安裝」，完成後再按兩下此檔案。"
  echo "（亦可在 https://www.python.org/downloads/macos/ 下載安裝。）"
  xcode-select --install >/dev/null 2>&1
  pause_exit 1
fi
echo "使用中：$("$PY" --version 2>&1)（$PY）"

# 2. 已在執行？直接開啟瀏覽器
if curl -s -o /dev/null --max-time 2 "$URL/app/"; then
  say_line "OPCG 卡庫已在執行，正在開啟瀏覽器。"
  open "$URL"
  exit 0
fi

# 3. 首次使用：下載所有系列的卡表（卡圖直接由官方網站顯示）
if [ ! -f data/cards.json ]; then
  say_line "首次使用：尚未有卡表。"
  printf '現在下載所有系列的卡表（約 1–2 分鐘）？ [Y/n] '
  read -r ans
  if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
    "$PY" -u bot/scrape_cards.py --save-html
    if [ $? -ne 0 ]; then
      say_line "卡表 BOT 出錯。請把上方訊息及 data/raw/ 內的檔案提供給 Claude。"
      printf '仍要開啟 App？ [Y/n] '; read -r ans2
      if [ "$ans2" = "n" ] || [ "$ans2" = "N" ]; then pause_exit 1; fi
    else
      echo "卡圖會直接由官方網站顯示。如要把卡圖儲存至本機（離線亦可查看，約 30–60 分鐘）：開啟 App →「設定」→「檢查新系列及卡圖」。"
    fi
  fi
fi

# 4. 啟動伺服器及瀏覽器
say_line "正在啟動 OPCG 卡庫：$URL"
"$PY" -u serve.py --port "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; exit 0' INT TERM HUP EXIT
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 1 "$URL/app/" && break
  sleep 0.3
done
open "$URL"
echo
echo "瀏覽器沒有自動開啟？請自行開啟：$URL"
echo "停止：關閉此視窗，或按 Control + C。"
wait $SERVER
