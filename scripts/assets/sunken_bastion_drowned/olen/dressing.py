"""Olen's hard dressing: the longsword (its brass hilt and its blade, built in the
sword's own frame and set in the right fist on the never-keyed Weapon bone), the
great tower shield in the left fist on its own Shield bone (the board, its brass sigil,
the barnacles crusting its foot and edges, the weed hanging off it), and the sea
light in the shadow of the brim."""
import math
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


def build_sword(workdir, k=1.0):
    F, H = A.build_sword(0.0042 * k)
    M = A.axe_matrix()
    return [_rigid_pair(F, 'SwordHilt', M, 'brass', 'Weapon', 1000, workdir),
            _rigid_pair(H, 'SwordBlade', M, 'steel', 'Weapon', 1400, workdir)]


def build_shield(workdir, k=1.0):
    M = A.shield_matrix()
    pairs = [_rigid_pair(A.build_shield(0.0065 * k), 'Shield', M, 'plate', 'Shield', 3000, workdir),
             _rigid_pair(A.build_shield_sigil(0.0045 * k), 'ShieldSigil', M, 'brass', 'Shield', 1600, workdir)]
    # barnacles crusting the foot of the board and climbing its edges
    rng = np.random.default_rng(77)
    G = Field((-A.SHIELD_W - 0.12, A.SHIELD_FOOT - 0.15, -0.3), (A.SHIELD_W + 0.12, A.SHIELD_TOP + 0.1, 0.2),
              0.0045 * k)
    placed = 0
    while placed < 34:
        y = A.SHIELD_FOOT + 0.1 + rng.uniform(0, 1) ** 1.8 * 1.7
        edge = rng.uniform(0, 1) < 0.45
        hw = float(A._shield_hw(y)) - 0.05
        x = (hw - rng.uniform(0, 0.12)) * (1 if rng.uniform() < 0.5 else -1) if edge else rng.uniform(-hw, hw)
        if abs(x) < 0.38 and -0.85 < y < 0.75:
            continue                                         # keep the sigil clear
        rr = rng.uniform(0.03, 0.065) * (1.25 if y < A.SHIELD_FOOT + 0.45 else 1.0)
        p = A._on_board(x, y, 0.015)
        A.barnacle(G, p, np.array((0.0, 0.0, 1.0)), rr, rr * rng.uniform(0.8, 1.3), rng)
        placed += 1
    pairs.append(_rigid_pair(G, 'BarnShield', M, 'barnacle', 'Shield', 1400, workdir))
    # weed hanging off the foot
    W = Field((-A.SHIELD_W - 0.1, A.SHIELD_FOOT - 0.75, -0.15), (A.SHIELD_W + 0.1, A.SHIELD_FOOT + 0.3, 0.15),
              0.005 * k)
    for x0, L_ in ((-0.3, 0.5), (-0.12, 0.38), (0.08, 0.6), (0.27, 0.42)):
        y0 = A.SHIELD_FOOT + 0.12 * min(1.0, abs(x0) / A.SHIELD_W) + 0.04
        pts = [A._on_board(x0 + 0.03 * math.sin(t * 5 + x0 * 9), y0 - L_ * t, 0.03 + 0.04 * t) for t in np.linspace(0, 1, 7)]
        A.ribbon(W, pts, [np.array((0.0, 0.0, 1.0))] * len(pts), 0.045, 0.009, rng)
    pairs.append(_rigid_pair(W, 'KelpShield', M, 'kelp', 'Shield', 700, workdir))
    return pairs


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.004, 0))
        p.sphere(c, (A.EYE_R * 1.05, A.EYE_R * 0.8, A.EYE_R * 0.85), seg=10, rings=6)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_sword(workdir, k) + build_shield(workdir, k) + build_eyes()
