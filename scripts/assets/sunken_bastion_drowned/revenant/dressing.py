"""The Revenant's hard dressing: the cutlass (sculpted in its own frame, then set in
the right fist on the never-keyed Weapon bone), the buckler strapped to the left
forearm (barnacled, rigid on the forearm), and the sea-light eyes (flat glow)."""
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


def build_cutlass(workdir, k=1.0):
    return [_rigid_pair(A.build_cutlass(0.0042 * k), 'Cutlass', A.cutlass_matrix(), 'steel', 'Weapon', 1400, workdir)]


def build_buckler(workdir, k=1.0):
    F = A.build_buckler(0.0045 * k)
    pairs = [_rigid_pair(F, 'Buckler', A.buckler_matrix(), 'plate', 'L_Forearm', 1500, workdir)]
    # barnacles on its face, in the buckler's own frame
    rng = np.random.default_rng(77)
    G = Field((-0.42, -0.42, -0.05), (0.42, 0.42, 0.25), 0.004 * k)
    for _ in range(10):
        a = rng.uniform(0, np.pi * 2)
        r = A.BUCKLER_R * np.sqrt(rng.uniform(0.25, 0.85))
        if rng.random() < 0.6:
            a = rng.uniform(2.2, 4.0)                       # crowded toward one side
        x, y = r * np.cos(a), r * np.sin(a)
        z = -0.75 + np.sqrt(max(0.0, 0.82 ** 2 - x * x - y * y)) + 0.015
        n = A.unit(np.array((x, y, z + 0.75)))
        rr = rng.uniform(0.04, 0.065)
        A.barnacle(G, np.array((x, y, z)), n, rr, rr * rng.uniform(0.8, 1.3), rng)
    pairs.append(_rigid_pair(G, 'BarnBuckler', A.buckler_matrix(), 'barnacle', 'L_Forearm', 900, workdir))
    return pairs


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
    return build_cutlass(workdir, k) + build_buckler(workdir, k) + build_eyes()
