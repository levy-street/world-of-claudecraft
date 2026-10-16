"""Re-author every clip on an already baked .blend and re-export (no re-sculpt, no
re-bake). Authoring aid for clip-only fixes.

  blender -b great_jaguar.blend --python reclip.py -- <out.glb> [--save]
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
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.endswith('Rig'))
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
names = C.make_clips(arm)
print('RECLIPPED', names)
build.export(out, arm)
if '--save' in argv:
    R.set_action(arm, bpy.data.actions['Idle'])
    bpy.ops.wm.save_mainfile()
print('RECLIP_DONE')
