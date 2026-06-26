#!/bin/sh
set -e
cd "$(dirname "$0")/.."
OUT="verifyfill.zip"
rm -f "$OUT"
zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  otp-parser.js \
  link-parser.js \
  overlay.css \
  popup.html \
  popup.js \
  popup.css \
  icons
echo "Created $OUT"
