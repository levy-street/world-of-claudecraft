"""Build the Glimmerscale Lurker (the Drowned Temple mantis shrimp) from code.

  blender -b --factory-startup --python build.py -- <out.glb> [kit options]

Options (build_core.py): --k voxel multiplier, --bake N, --nobake, --clips A,B,
--blend path, --tex dir, --stats path, --work dir.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy as A  # noqa: E402
import dressing as D  # noqa: E402
import shading as SH  # noqa: E402
import clips as C  # noqa: E402
import build_core  # noqa: E402

build_core.run(A, D, SH, C)
