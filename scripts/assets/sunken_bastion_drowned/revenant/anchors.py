"""Print the Revenant's effect anchors (ModelPoint side/up/fwd) half a second into
Idle, as the renderer measures it, plus the raw bounding height.

  blender -b <x.blend> --python anchors.py -- <builder dir>
"""
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, argv[0])
sys.path.insert(1, argv[0] + '/../kit')
import anatomy as A  # noqa: E402

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
act = bpy.data.actions['Idle']
import rig as R  # noqa: E402
R.set_action(arm, act)
f0 = act.frame_range[0]
f = f0 + 0.5 * scene.render.fps
scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in scene.objects:
    if o.type == 'MESH' and o.parent == arm and not o.name.endswith('_hi') and not o.hide_render:
        ev = o.evaluated_get(dg)
        co = np.array([(o.matrix_world @ v.co)[:] for v in ev.data.vertices])
        pts.append(co)
P = np.concatenate(pts)
minz = P[:, 2].min()
print('RAW_HEIGHT', round(float(P[:, 2].max() - minz), 3), 'MINZ', round(float(minz), 3))


def posed(bone, p):
    pb = arm.pose.bones[bone]
    M = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()
    return M @ Vector(p)


def show(name, bone, p):
    w = posed(bone, p)
    print('ANCHOR', name, '{ side: %.2f, up: %.2f, fwd: %.2f }' % (w.x, w.z - minz, -w.y))


brim = A._Brim(A.HELM_C, A.BRIM_IN, A.BRIM_OUT, A.BRIM_LIFT, 0.026)
for nm, a in (('brimL', 0.0), ('brimR', math.pi), ('brimBack', math.pi / 2 + 0.5)):
    ro = brim.outer(a)
    zs, _ = brim.profile(a, 1.0)
    rest = A.HELM_C + np.array((ro * math.cos(a), ro * math.sin(a), zs))
    show(nm, 'Head', tuple(A.head_map(rest)))
B = A.buckler_matrix()
show('buckler', 'L_Forearm', tuple((B @ np.array((0, A.BUCKLER_R, 0, 1)))[:3]))
C = A.cutlass_matrix()
show('blade', 'Weapon', tuple((C @ np.array((0.05, 0, A.GUARD_T + A.BLADE_LEN * 0.92, 1)))[:3]))
show('chest', 'Spine2', (0.0, -0.45, 3.1))
show('eyes', 'Head', tuple(A.head_map(np.array((0.0, -0.2, 4.205)))))
