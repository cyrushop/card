# Used by OPCG-Start.command and OPCG-Phone.command (Mac).
# Card pictures: with Pillow installed, the app saves them as small WebP files, about a fifth of
# the size (all pictures: about 1.1 GB as originals, about 0.2 GB compressed). Asked once.
offer_pillow() {
  local py="$1"
  "$py" -c 'import PIL.Image' >/dev/null 2>&1 && return 0
  [ -f data/.no-pillow ] && return 0
  mkdir -p data
  printf '\n安裝 Pillow（約 10 MB），把卡圖壓縮至約五分之一（全部卡圖原圖約 1.1 GB，壓縮後約 0.2 GB）？ [Y/n] '
  read -r ans
  if [ "$ans" = "n" ] || [ "$ans" = "N" ]; then
    touch data/.no-pillow
    echo "已略過，卡圖會以原圖保存。以後不會再問；如要再安裝，刪除 data/.no-pillow 後再開啟程式。"
    return 0
  fi
  if "$py" -m pip install --user --quiet --disable-pip-version-check pillow && "$py" -c 'import PIL.Image' >/dev/null 2>&1; then
    echo "已安裝 Pillow。到「設定」按一次「檢查新系列及卡圖」，已下載的卡圖會就地轉為壓縮版本，不用重新下載。"
  else
    touch data/.no-pillow
    echo "未能安裝 Pillow，卡圖會以原圖保存，程式照常使用。"
    echo "如你的 Python 由 Homebrew 安裝，可在終端機執行：brew install pillow"
    echo "安裝後刪除 data/.no-pillow，再開啟程式。"
  fi
}
