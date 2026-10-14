#!/bin/zsh
# Build + install the Deepglass arena kit v2 (bl_dg_arena.py): headless Blender
# export -> public/models/deepglass (meshopt, KTX2), media manifest, asset
# catalogue, authored collision (pins src/render/asset_scale.ts from the
# sidecars), generated overrides. PIECES="gatehouse floor" narrows the build.
set -e
cd "$(dirname "$0")/../../.."
ARENA_EXPORT=1 ${=PIECES:+PIECES=$PIECES} /Applications/Blender.app/Contents/MacOS/Blender -b \
  --python scripts/assets/deepglass/bl_dg_arena.py 2>&1 | grep -E "^(arena|bell)|collision|exported|ERROR|Traceback" || true
# the north bridge wears the same tiling set (dg_bridge.py, collision unchanged)
if [ -z "$PIECES" ] || [ -n "$BRIDGE" ]; then
  for v in deck lamp pylon; do
    BRIDGE_VARIANT=$v /Applications/Blender.app/Contents/MacOS/Blender -b \
      --python scripts/assets/deepglass/dg_bridge.py 2>&1 | grep -E "exported|ERROR|Traceback" || true
  done
  node scripts/assets/build_assets.mjs scripts/assets/specs/deepglass_bridge.json 2>&1 | grep -E "bridge_[a-z]+\.glb" | sed 's/^ *//'
fi
node scripts/assets/build_assets.mjs scripts/assets/specs/deepglass_arena.json 2>&1 | grep -E "(arena|bell)_[a-z_]+\.glb" | sed 's/^ *//'
# build_assets writes webp textures; shipped GLBs must be KTX2
# (tests/glb_texture_compression). Needs the KTX-Software `ktx` tool on PATH.
PATH="$HOME/.local/ktx-software/bin:$PATH"
if command -v ktx >/dev/null; then
  node scripts/assets/compress_glb_textures.mjs public/models/deepglass/arena_*.glb public/models/deepglass/bell_frame.glb \
    public/models/deepglass/bridge_*.glb 2>&1 | tail -1
else
  echo "WARN: ktx not on PATH: the arena GLBs stay webp (tests/glb_texture_compression goes red)"
fi
node scripts/build_media_manifest.mjs generate 2>&1 | tail -1
node scripts/gen_asset_catalog.mjs > /dev/null
node scripts/assets/deepglass/install_authored.mjs --pin 2>&1 | grep -E "arena|installed"
node scripts/gen_collision_overrides.mjs
