"""Re-author every clip on an already built .blend and re-export (no re-sculpt, no
re-bake). Authoring aid for clip-only fixes.

  blender -b gorgebloom.blend --python reclip.py -- <out.glb | -> [--save] [--clips A,B]
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402
import clips as C  # noqa: E402
import rig as R  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
only = argv[argv.index('--clips') + 1].split(',') if '--clips' in argv else None
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.startswith('Gorgebloom'))
for a in list(bpy.data.actions):
    if only is None or a.name in only:
        bpy.data.actions.remove(a)
names = C.make_clips(arm, only)
print('RECLIPPED', names)
if out != '-':
    build.export(out, arm)
if '--save' in argv:
    R.set_action(arm, bpy.data.actions['Idle'])
    bpy.ops.wm.save_mainfile()
print('RECLIP_DONE')
