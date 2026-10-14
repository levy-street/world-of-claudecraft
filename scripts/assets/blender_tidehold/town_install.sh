#!/bin/zsh
# Build + install the Tidehold town kit (bl_town.py): headless Blender export
# -> public/models/tidehold (meshopt, KTX2) incl. the Edit-pieces twins, then
# collision overrides, prefab pieces, SIZE/AUTHORED, interior reveal volumes
# (town_install.mjs), the media manifest and the generated tables.
# PIECES="house_a tavern" narrows the build.
set -e
cd "$(dirname "$0")/../../.."
ALL=(house_a house_b house_c house_d house_e tavern tavern_b smithy market hall shop_a shop_b bank)
WANT=(${=PIECES:-$ALL})
# the window-box plants (the undergrowth kit's, decoded for Blender)
node scripts/assets/blender_tidehold/town_flowers.mjs
BLOG=tmp/asset_src/tidehold_town/blender.log
mkdir -p tmp/asset_src/tidehold_town
TOWN_EXPORT=1 PIECES=${(j:,:)WANT} /Applications/Blender.app/Contents/MacOS/Blender -b \
  --python scripts/assets/blender_tidehold/bl_town.py > $BLOG 2>&1 || true
grep -E "tris=|exported|lod |slid|dropped|Traceback|Error:" $BLOG | grep -v tripo_addon || true
# a Blender traceback must stop the install: the steps below would otherwise
# ship the PREVIOUS run's exports as if they were this one's
if grep -q "Traceback" $BLOG; then
  grep -A12 "Traceback" $BLOG | head -30
  echo "town_install: the Blender export failed (full log: $BLOG)"
  exit 1
fi
# only the buildings asked for: build_assets converts EVERY item of a spec, and
# the KTX2 pass below only compresses WANT, so a PIECES subset used to leave
# every other building's GLB rebuilt as webp
SPEC=tmp/asset_src/tidehold_town/spec.$$.json
node -e '
const [src, out, ...want] = process.argv.slice(1);
const spec = JSON.parse(require("fs").readFileSync(src, "utf8"));
spec.items = spec.items.filter((it) => want.some((n) => new RegExp(`/${n}(\\.parts|\\.lod)?\\.glb$`).test(it.out)));
require("fs").writeFileSync(out, JSON.stringify(spec));
' scripts/assets/specs/tidehold_town.json $SPEC $WANT
node scripts/assets/build_assets.mjs $SPEC 2>&1 | grep -E "tidehold/" | sed 's/^ *//'
rm -f $SPEC
# build_assets writes webp; shipped GLBs must be KTX2 (tests/glb_texture_compression)
PATH="$HOME/.local/ktx-software/bin:$PATH"
FILES=()
for n in $WANT; do FILES+=(public/models/tidehold/$n.glb public/models/tidehold/$n.parts.glb public/models/tidehold/$n.lod.glb); done
if command -v ktx >/dev/null; then
  node scripts/assets/compress_glb_textures.mjs $FILES 2>&1 | tail -1
else
  echo "WARN: ktx not on PATH: the town GLBs stay webp (tests/glb_texture_compression goes red)"
fi
node scripts/assets/blender_tidehold/town_install.mjs $WANT
node scripts/gen_prefab_pieces.mjs
node scripts/build_media_manifest.mjs generate 2>&1 | tail -1
node scripts/gen_asset_catalog.mjs > /dev/null
node scripts/gen_collision_overrides.mjs
