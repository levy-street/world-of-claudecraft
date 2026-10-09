"""Build Knight-Commander Olen from code.

  blender -b --factory-startup --python build.py -- <out.glb> [kit options]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.abspath(os.path.join(HERE, '..', 'kit')))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
import anatomy as A  # noqa: E402
if '--variant' in argv:
    A.set_variant(argv[argv.index('--variant') + 1])
import dressing as D  # noqa: E402
import shading as SH  # noqa: E402
import clips as C  # noqa: E402
import build_core  # noqa: E402

build_core.run(A, D, SH, C)
