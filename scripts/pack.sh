#!/usr/bin/env bash
set -euo pipefail

# Packs exactly what a browser loads (the manifest, icons and src) into dist/Ledger_v<version>.zip,
# with the version read from the manifest.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/extension/manifest.json'))['version'])")"
OUT="$ROOT/dist"
mkdir -p "$OUT"
rm -f "$OUT/Ledger_v$VERSION.zip"
cd "$ROOT/extension"
zip -r "$OUT/Ledger_v$VERSION.zip" manifest.json icons src >/dev/null
echo "packed $OUT/Ledger_v$VERSION.zip"
unzip -l "$OUT/Ledger_v$VERSION.zip" | tail -3
