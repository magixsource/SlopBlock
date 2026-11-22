#!/usr/bin/env bash
set -euo pipefail

# 从项目根目录打包出可直接「加载已解压的扩展程序」的 ZIP。
# 注意：现代 Chrome 只接受 Chrome Web Store 签名的 CRX，自制 CRX 无法被普通用户安装，
# 所以这里输出 ZIP 而不是 CRX。
cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")"
OUTPUT="SlopBlock-${VERSION}.zip"
rm -f "$OUTPUT"

zip -r -q "$OUTPUT" \
  manifest.json \
  background_script.js \
  popup.html popup.js \
  options.html options.js \
  INSTALL.txt \
  js/slopblock.js \
  data/data.json \
  images/icon_16.png images/icon_32.png images/icon_48.png images/icon_128.png \
  -x '*.DS_Store'

echo "Built $OUTPUT"
