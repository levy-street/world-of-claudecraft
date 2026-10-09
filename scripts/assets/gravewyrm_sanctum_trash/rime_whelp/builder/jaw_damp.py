"""Close the whelp's gape on a baked .blend: every clip's Jaw rotation is eased
toward rest by a factor, so the opened mouth never stretches the lip seam into a
dark slab (the young head has no modelled mouth cavity). Re-exports the raw GLB.

  blender -b rime_whelp.blend --python jaw_damp.py -- <factor> <out_raw.glb> [--save]
"""
import os
import sys

import bpy
from mathutils import Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
k, out = float(argv[0]), argv[1]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
path = 'pose.bones["Jaw"].rotation_quaternion'
done = 0
for act in bpy.data.actions:
    curves = {}
    for fc in build.R.fcurves(act):
        if fc.data_path == path:
            curves[fc.array_index] = fc
    if len(curves) != 4:
        continue
    n = len(curves[0].keyframe_points)
    for i in range(n):
        q = Quaternion([curves[c].keyframe_points[i].co[1] for c in range(4)])
        q2 = Quaternion((1, 0, 0, 0)).slerp(q, k)
        for c in range(4):
            kp = curves[c].keyframe_points[i]
            d = q2[c] - kp.co[1]
            kp.co[1] = q2[c]
            kp.handle_left[1] += d
            kp.handle_right[1] += d
    for c in range(4):
        curves[c].update()
    done += 1
print('JAW_DAMPED', done, 'actions by', k, flush=True)
build.export(out, arm)
if '--save' in argv:
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.ops.wm.save_mainfile()
print('JAW_DONE', flush=True)
