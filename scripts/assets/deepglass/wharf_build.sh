#!/bin/zsh
# Build the Warden wharf kit headless (dg_wharf.py). PREVIEW=1 (default) renders
# Cycles camera shots only; PREVIEW=0 also exports each GLB + collision sidecar
# into tmp/asset_src/deepglass/. Choose pieces with PIECES="deck quay ...".
cd "$(dirname "$0")/../../.."
for p in ${=PIECES:-deck deck_rail deck_rails quay quay_rail quay_wide quay_wide_rail berth bastion bastion_open stairs crane mast lamp bollard rail shed}; do
  WHARF_PIECE=$p PREVIEW=${PREVIEW:-1} /Applications/Blender.app/Contents/MacOS/Blender -b \
    --python scripts/assets/deepglass/dg_wharf.py > tmp/asset_src/deepglass/wharf_${p}_run.log 2>&1
  grep -E "^piece|ERROR|exported" tmp/asset_src/deepglass/wharf_${p}_run.log | head -3
  grep -A12 "Traceback" tmp/asset_src/deepglass/wharf_${p}_run.log | head -14
done
