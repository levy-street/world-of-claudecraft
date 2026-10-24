"""The Watchman's hard dressing: the halberd and its torn pennon (sculpted in their
own frame, set in the right fist on the never-keyed Weapon bone), the watch
lantern at his left hip (an iron cage round a glass that still holds sea light),
and the sea-light eyes (flat glow)."""
import os

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf
from sdf import Field


def _decimate_pair(hi, name, target):
    lo = K.duplicate(hi, name)
    tris = K.triangles(lo)
    if tris > target:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    return lo


def _rigid_pair(F, name, M, mat, bone, target, workdir):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    hi.data.transform(Matrix(M.tolist()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = _decimate_pair(hi, name, target)
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = 'rigid'
    return hi, lo


def build_halberd(workdir, k=1.0):
    M = A.halberd_matrix()
    return [_rigid_pair(A.build_halberd(0.0045 * k), 'Halberd', M, 'steel', 'Weapon', 4000, workdir),
            _rigid_pair(A.build_pennon(0.0045 * k), 'Pennon', M, 'cloth', 'Weapon', 1200, workdir)]


LANTERN = np.array((0.56, -0.12, 2.28))


def build_lantern(workdir, k=1.0):
    """The watch lantern hung from the belt at the left hip: a square iron cage with a
    pierced cap and a ring, its glass still glowing with sea light."""
    c = LANTERN
    cage = K.Part('LanternCage', 'plate', bone='Hips')
    for sx in (-1, 1):
        for sy in (-1, 1):
            cage.tube([c + np.array((0.07 * sx, 0.07 * sy, -0.13)), c + np.array((0.07 * sx, 0.07 * sy, 0.11))],
                      0.012, sides=5)
    cage.box(c + np.array((0, 0, -0.14)), (0.09, 0.09, 0.02))
    cage.sphere(c + np.array((0, 0, 0.14)), (0.09, 0.09, 0.05), seg=10, rings=5)
    cage.torus(c + np.array((0, 0, 0.22)), (0, 1, 0), 0.04, 0.01, seg=10, sides=5)
    cage.tube([c + np.array((0, 0, 0.26)), c + np.array((-0.03, 0.0, 0.36))], 0.01, sides=5)
    o = cage.to_object()
    glass = K.Part('LanternGlass', 'glow_lantern', bone='Hips')
    glass.sphere(c + np.array((0, 0, -0.01)), (0.055, 0.055, 0.09), seg=10, rings=6)
    g = glass.to_object()
    return [(K.duplicate(o, o.name + '_hi'), o), (K.duplicate(g, g.name + '_hi'), g)]


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.002, 0))
        p.sphere(c + np.array((0, -0.006, 0)), (A.EYE_R * 1.05, A.EYE_R * 0.85, A.EYE_R * 0.95), seg=10, rings=6)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_halberd(workdir, k) + build_lantern(workdir, k) + build_eyes()
