"""The Scaleguard's hard dressing: the halberd (sculpted in its own frame, set in the
right fist on the never-keyed Weapon bone) and the eyes (flat glow)."""
import os

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf


def build_halberd(workdir, k=1.0):
    F = A.build_halberd(0.0055 * k)
    hi = sdf.to_mesh(F, 'Halberd_hi', bpy, workdir=workdir)
    me = hi.data
    attr = me.attributes.new('RegWood', 'FLOAT', 'POINT')
    vals = []
    for v in me.vertices:
        r = (v.co.x ** 2 + v.co.y ** 2) ** 0.5
        wood = r < 0.052 and -A.HAFT_BELOW + 0.1 < v.co.z < A.HAFT_ABOVE - 0.32
        vals.append(1.0 if wood else 0.0)
    attr.data.foreach_set('value', vals)
    me.transform(Matrix(A.halberd_matrix().tolist()))
    for p in me.polygons:
        p.use_smooth = True
    lo = K.duplicate(hi, 'Halberd')
    tris = K.triangles(lo)
    if tris > 1800:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = 1800 / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    lo.data.attributes.remove(lo.data.attributes['RegWood'])
    for o in (hi, lo):
        o['mat'] = 'steel'
        o['bone'] = 'Weapon'
        o['binding'] = 'rigid'
    return [(hi, lo)]


def build_eyes():
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.004, 0))
        p.sphere(c, (A.EYE_R * 0.95, A.EYE_R * 0.8, A.EYE_R * 0.7), seg=10, rings=6)
    o = p.to_object()
    return [(K.duplicate(o, o.name + '_hi'), o)]


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    return build_halberd(workdir) + build_eyes()
