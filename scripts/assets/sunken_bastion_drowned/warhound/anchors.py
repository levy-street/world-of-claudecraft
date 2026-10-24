"""Print the Warhound's effect anchors (ModelPoint side/up/fwd) half a second into
Idle, as the renderer measures it, plus the raw bounding height.

  blender -b <x.blend> --python anchors.py
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as R  # noqa: E402

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
act = bpy.data.actions['Idle']
R.set_action(arm, act)
f = act.frame_range[0] + 0.5 * R.FPS
scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in scene.objects:
    if o.type == 'MESH' and o.parent == arm and not o.hide_render:
        ev = o.evaluated_get(dg)
        pts.append(np.array([(o.matrix_world @ v.co)[:] for v in ev.data.vertices]))
P = np.concatenate(pts)
minz = float(P[:, 2].min())
print('RAW_HEIGHT', round(float(P[:, 2].max() - minz), 3), 'MINZ', round(minz, 3))


def show(name, w):
    print('ANCHOR', name, '{ side: %.2f, up: %.2f, fwd: %.2f }' % (w.x, w.z - minz, -w.y))


pb = arm.pose.bones
mw = arm.matrix_world
show('jaw', mw @ pb['Jaw'].tail)
show('nose', mw @ pb['Head'].tail)
show('ring', mw @ pb['Charm1'].head)
show('chain', mw @ pb['Charm2'].tail)
show('chest', mw @ ((pb['Spine3'].head + pb['Spine2'].head) * 0.5) + Vector((0, 0, -0.35)))
show('eyes', mw @ (pb['Head'].head * 0.4 + pb['Head'].tail * 0.6) + Vector((0, 0, 0.18)))
show('belly', mw @ pb['Belly'].tail)
