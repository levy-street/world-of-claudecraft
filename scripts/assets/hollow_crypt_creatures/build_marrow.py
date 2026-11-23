"""Build Sexton Marrow, the Hollow Crypt's first boss, from code.

  blender -b --factory-startup --python build_marrow.py -- <out.glb> [kit options]

The creature lives in `marrow/` (anatomy, dressing, shading, clips); the sculpt,
rig, pose language, clip writer and bake are the Sunken Bastion's sculpt kit
(`../sunken_bastion_drowned/kit`, unchanged). Kit options (`build_core.py`):
--bake N, --nobake, --k K (voxel multiplier, 1.6 for quick looks), --clips A,B,
--blend path, --tex dir, --stats path, --work dir (scratch for the VDB files).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'marrow'))
sys.path.insert(1, os.path.abspath(os.path.join(HERE, '..', 'sunken_bastion_drowned', 'kit')))
import anatomy as A  # noqa: E402,F401
import dressing as D  # noqa: E402
import shading as SH  # noqa: E402
import clips as C  # noqa: E402
import build_core  # noqa: E402

build_core.run(A, D, SH, C)
