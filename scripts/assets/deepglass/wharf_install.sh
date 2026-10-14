#!/bin/zsh
# Optimise + install the Warden wharf kit and the galleon: GLBs -> public/models/deepglass
# (KTX2), media manifest, asset catalogue, voxel bake, authored collision (pins
# src/render/asset_scale.ts from the build sidecars), generated overrides.
set -e
cd "$(dirname "$0")/../../.."
node scripts/assets/build_assets.mjs scripts/assets/specs/deepglass_wharf.json 2>&1 | grep -E "wharf_[a-z_]+\.glb" | sed 's/^ *//'
# build_assets writes webp textures; shipped GLBs must be KTX2
# (tests/glb_texture_compression). Needs the KTX-Software `ktx` tool on PATH.
PATH="$HOME/.local/ktx-software/bin:$PATH"
if command -v ktx >/dev/null; then
  node scripts/assets/compress_glb_textures.mjs public/models/deepglass/wharf_*.glb 2>&1 | tail -1
else
  echo "WARN: ktx not on PATH: the wharf GLBs stay webp (tests/glb_texture_compression goes red)"
fi
node scripts/build_media_manifest.mjs generate 2>&1 | tail -1
node scripts/gen_asset_catalog.mjs > /dev/null
node scripts/assets/bake_collision.mjs > /dev/null 2>&1
node scripts/assets/deepglass/install_authored.mjs --pin 2>&1 | grep -E "wharf|installed"
node scripts/gen_collision_overrides.mjs
