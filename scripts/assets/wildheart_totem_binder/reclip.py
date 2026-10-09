"""Re-key some clips on a built creature .blend without re-sculpting or re-baking.

  blender -b x.blend --python reclip.py -- <builder_dir> <Clip,Clip|all> <out_raw.glb>

The named actions are deleted and authored again by the creature's clips.py with
the current kit; the .blend is saved in place and the raw GLB re-exported.
"""
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import anatomy as A  # noqa: E402
if '--variant' in argv:
    A.set_variant(argv[argv.index('--variant') + 1])
import build_core  # noqa: E402
import clips as C  # noqa: E402
import rig as R  # noqa: E402

arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
names = [n for n, *_ in C.CATALOG] if argv[1] == 'all' else argv[1].split(',')
for n in names:
    if n in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[n])
made = C.make_clips(arm, names)
print('RECLIPPED', made)
R.set_action(arm, bpy.data.actions['Idle'])
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
build_core.export(argv[2], arm)
R.set_action(arm, bpy.data.actions['Idle'])
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('RECLIP_DONE')
