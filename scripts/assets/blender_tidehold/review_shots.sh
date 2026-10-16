#!/bin/bash
# Render the standard review set for one or more Tidehold buildings.
#
#   scripts/assets/blender_tidehold/review_shots.sh <tag> <glb-dir> <out-dir> <name> [name ...]
#
# e.g.  scripts/assets/blender_tidehold/review_shots.sh after public/models/tidehold /tmp/shots tavern_b house_d
#       scripts/assets/blender_tidehold/review_shots.sh before "$BACKUP"     /tmp/shots tavern_b house_d
#
# Blender must be open with the BlenderMCP server started (sidebar N ->
# BlenderMCP -> Connect); the bridge is ~/.claude/tools/blender_bridge.py.
# Run from the repo root.
set -euo pipefail

TAG="$1"; SRCDIR="$2"; OUT="$3"; shift 3
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="$OUT/_bl"
mkdir -p "$WORK" "$OUT"

# Blender's glTF importer refuses EXT_meshopt_compression and
# KHR_texture_basisu and cannot read EXT_texture_webp: round-trip first.
for n in "$@"; do
  node "$HERE/strip_for_blender.mjs" "$SRCDIR/$n.glb" "$WORK/$n.glb" >/dev/null
done

NAMES=$(printf "'%s'," "$@")
{
  echo "BL_HELPERS = '$HERE/bl_helpers.py'"
  echo "REPO_ROOT = '$REPO'"
  echo "SRC = '$WORK'"
  echo "OUT = '$OUT'"
  echo "TAG = '$TAG'"
  echo "NAMES = [${NAMES%,}]"
  cat "$HERE/review_shots.py"
} > "$WORK/_run.py"

python3 ~/.claude/tools/blender_bridge.py run "$WORK/_run.py" 2>&1 | grep -vE 'INFO:|WARNING:'
