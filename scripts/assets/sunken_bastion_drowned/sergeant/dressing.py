"""The Sergeant's hard dressing: the boarding axe (its ash haft and its iron,
sculpted in the axe's own frame, then set in the right fist on the never-keyed Weapon
bone) and the sea light in the barbute's slit and its mouth slot (flat glow)."""
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


def build_axe(workdir, k=1.0):
    F, H = A.build_axe(0.0042 * k)
    M = A.axe_matrix()
    return [_rigid_pair(F, 'AxeHaft', M, 'wood', 'Weapon', 700, workdir),
            _rigid_pair(H, 'AxeHead', M, 'steel', 'Weapon', 1600, workdir)]


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.002, 0))
        p.sphere(c, (A.EYE_R * 0.9, A.EYE_R * 0.75, A.EYE_R * 0.8), seg=10, rings=6)
    # sea light deep in the open throat
    p.sphere(A.MOUTH + np.array((0, 0.045, 0.0)), (0.03, 0.02, 0.018), seg=8, rings=5)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_axe(workdir, k) + build_eyes()
