"""The Boneguard's hard dressing: the sword (sculpted in its own frame, then set in
the right fist on the never-keyed Weapon bone) and the eyes (flat glow)."""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf


def _decimate_pair(hi, name, target):
    lo = K.duplicate(hi, name)
    tris = K.triangles(lo)
    if tris > target:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    return lo


def build_sword(workdir, k=1.0):
    F = A.build_sword(0.0045 * k)
    hi = sdf.to_mesh(F, 'Sword_hi', bpy, workdir=workdir)
    # the Smith's rune runs up the ricasso: an attribute the steel shader lights
    me = hi.data
    attr = me.attributes.new('RegRune', 'FLOAT', 'POINT')
    vals = []
    for v in me.vertices:
        z = v.co.z
        x = v.co.x
        on = A.GUARD_T + 0.14 < z < A.GUARD_T + 0.58 and abs(x) < 0.035
        stroke = on and (abs(x) < 0.01 or abs((z - A.GUARD_T - 0.2) % 0.13 - 0.065) < 0.012)
        vals.append(1.0 if stroke else 0.0)
    attr.data.foreach_set('value', vals)
    M = Matrix(A.sword_matrix().tolist())
    me.transform(M)
    for p in me.polygons:
        p.use_smooth = True
    lo = _decimate_pair(hi, 'Sword', 1500)
    if 'RegRune' in lo.data.attributes:
        lo.data.attributes.remove(lo.data.attributes['RegRune'])
    for o in (hi, lo):
        o['mat'] = 'steel'
        o['bone'] = 'Weapon'
        o['binding'] = 'rigid'
    return [(hi, lo)]


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.004, 0))
        p.sphere(c, (A.EYE_R * 0.9, A.EYE_R * 0.75, A.EYE_R * 0.8), seg=10, rings=6)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    import os
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    return build_sword(workdir) + build_eyes()
