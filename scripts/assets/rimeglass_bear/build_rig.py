"""Build the Rimeglass Bear on the wolf rig: register its skeleton, then run the
wolf rig's own build (rig, weights, every carried clip, raw GLB export).

  blender -b --factory-startup --python scripts/assets/rimeglass_bear/build_rig.py -- \\
      --model rimeglass_bear --body tmp/rimeglass_bear/bear_body.glb \\
      --ref tmp/wolf_rig/wolf_basic_view.glb --out tmp/rimeglass_bear/bear_raw.glb \\
      --blend tmp/rimeglass_bear/bear.blend
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'wolf_rig'))
sys.path.insert(0, HERE)
import anatomy  # noqa: E402
from bear_anatomy import RIMEGLASS_BEAR  # noqa: E402

anatomy.MODELS['rimeglass_bear'] = RIMEGLASS_BEAR
import build  # noqa: E402,F401  (runs the build on import)
