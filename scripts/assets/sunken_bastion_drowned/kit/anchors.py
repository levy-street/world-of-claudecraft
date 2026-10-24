"""Print a drowned biped's effect anchors (the game's ModelPoint side/up/fwd) half a
second into Idle, as the renderer measures it, plus the raw bounding height.

  blender -b <x.blend> --python anchors.py -- <builder dir> [Clip:t ...]

Extra Clip:t arguments print the anchors again at that time of that clip (over the
Idle floor), e.g. the arbalest's muzzle at the loose.

The creature's anatomy module lists them in ANCHORS = {name: (bone, rest point)};
rest points are in the rest armature space (the head ones already grown by
head_map when the creature has one).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))
import anatomy as A  # noqa: E402
import rig as R  # noqa: E402

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
R.set_action(arm, bpy.data.actions['Idle'])
act = bpy.data.actions['Idle']
f = act.frame_range[0] + 0.5 * scene.render.fps
scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in scene.objects:
    if o.type == 'MESH' and o.parent == arm and not o.name.endswith('_hi') and not o.hide_render:
        ev = o.evaluated_get(dg)
        pts.append(np.array([(o.matrix_world @ v.co)[:] for v in ev.data.vertices]))
P = np.concatenate(pts)
minz = float(P[:, 2].min())
print('RAW_HEIGHT', round(float(P[:, 2].max() - minz), 3), 'MINZ', round(minz, 3))


def posed(bone, p):
    pb = arm.pose.bones[bone]
    M = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()
    return M @ Vector(tuple(float(x) for x in p))


for name, (bone, p) in getattr(A, 'ANCHORS', {}).items():
    w = posed(bone, p)
    print('ANCHOR', name, '{ side: %.2f, up: %.2f, fwd: %.2f }' % (w.x, w.z - minz, -w.y))


for spec in argv[1:]:
    clip, t = spec.split(':')
    R.set_action(arm, bpy.data.actions[clip])
    f = bpy.data.actions[clip].frame_range[0] + float(t) * scene.render.fps
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    for name, (bone, p) in getattr(A, 'ANCHORS', {}).items():
        w = posed(bone, p)
        print('ANCHOR@' + spec, name, '{ side: %.2f, up: %.2f, fwd: %.2f }' % (w.x, w.z - minz, -w.y))
