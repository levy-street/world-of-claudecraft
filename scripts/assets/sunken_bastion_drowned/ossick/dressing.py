"""Ossick's hard dressing: the cudgel (its oak and its iron, built in the weapon frame
and set in the right fist on the never-keyed Weapon bone), the ship's anchor twice
(slung on his back on AnchorB, its own mesh `OssickAnchorBack` so the renderer can
hide it while his thrown anchor lies on a victim; in the left fist on AnchorH),
the shackle pair twice (at the hip on ShackleB, in the left fist on ShackleH), the
cudgel's twin thrust through his belt (CudgelB, while both fists heave the
shackles; the clips show one of each), and the sea light behind the brank."""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf
from sdf import Field, RoundBox, RoundCone


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


def build_cudgel(workdir, k=1.0):
    F, H = A.build_cudgel(0.0045 * k)
    M = A.axe_matrix()
    Mb = A.cudgel_matrix_hip()
    return [_rigid_pair(F, 'CudgelWood', M, 'wood', 'Weapon', 1500, workdir),
            _rigid_pair(H, 'CudgelIron', M, 'steel', 'Weapon', 2000, workdir),
            _rigid_pair(F, 'CudgelBeltWood', Mb, 'wood', 'CudgelB', 900, workdir),
            _rigid_pair(H, 'CudgelBeltIron', Mb, 'steel', 'CudgelB', 1200, workdir)]


def build_anchors(workdir, k=1.0):
    G = A.anchor_shape(0.0055 * k)
    back = _rigid_pair(G, 'AnchorBack', A.anchor_matrix_back(), 'anchor', 'AnchorB', 2600, workdir)
    back[1]['separate'] = 'OssickAnchorBack'
    hand = _rigid_pair(G, 'AnchorHand', A.anchor_matrix_hand(), 'anchor', 'AnchorH', 2600, workdir)
    return [back, hand]


def build_shackles(workdir, k=1.0):
    return [_rigid_pair(A.shackle_shape(0.004 * k), 'ShackleHip', A.shackle_matrix_hip(), 'steel', 'ShackleB', 1200,
                        workdir),
            _rigid_pair(A.shackle_shape(0.004 * k, held=True), 'ShackleHand', A.shackle_matrix_hand(), 'steel',
                        'ShackleH', 1200, workdir)]


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.002, 0))
        p.sphere(c, (A.EYE_R * 1.0, A.EYE_R * 0.8, A.EYE_R * 0.85), seg=10, rings=6)
    # sea light deep in the open throat, round the iron bit
    p.sphere(A.MOUTH + np.array((0, 0.045, 0.0)), (0.034, 0.022, 0.02), seg=8, rings=5)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_cudgel(workdir, k) + build_anchors(workdir, k) + build_shackles(workdir, k) + build_eyes()
