# Build Tidehold town pieces LIVE in the open Blender GUI (over the MCP
# bridge), so the work is watchable. Edit PIECES, then:
#   python3 ~/.claude/tools/blender_bridge.py run scripts/assets/blender_tidehold/town_gui.py
import os
# Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
ROOT = REPO_ROOT
GUI = True
PIECES = 'house_a,house_b,house_c,house_d,house_e,shop_a,shop_b,tavern,tavern_b,smithy,market,hall'
exec(open(ROOT + '/scripts/assets/blender_tidehold/bl_town.py').read())
