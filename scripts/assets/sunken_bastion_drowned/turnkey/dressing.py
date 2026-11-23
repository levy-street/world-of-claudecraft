"""The Turnkey's hard dressing: the great ring of keys (built in the weapon frame,
set in the right fist on the never-keyed Weapon bone), the gaol's lantern twice
(at the hip on LanternB, in the left fist on LanternH; the clips show one), and
the sea light in the hood's eye holes."""
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


def build_keys(workdir, k=1.0):
    """The ring: a heavy iron hoop on a short grip bar, a dozen big keys threaded on
    it fanning out round the lower arc, rust-pitted."""
    F = Field((-0.25, -0.6, -0.25), (0.25, 0.6, 1.3), 0.004 * k)
    c, R_ = A.RING_C, A.RING_R
    F.add(RoundCone((0.0, 0.0, -0.14), (0.0, 0.0, c[2] - R_ + 0.02), 0.04, 0.035), 0.01)
    F.add(sdf.Torus(tuple(c), (1.0, 0.0, 0.0), R_, 0.03), 0.01)
    rng = np.random.default_rng(31)
    for i in range(12):
        a = -1.1 + 2.2 * i / 11 + rng.uniform(-0.05, 0.05)       # round the far arc of the ring
        p = c + np.array((0.0, R_ * math.sin(a), R_ * math.cos(a)))
        out = np.array((0.0, math.sin(a), math.cos(a)))
        L_ = rng.uniform(0.22, 0.34)
        F.add(sdf.Torus(tuple(p + out * 0.04), (1.0, 0.0, 0.0), 0.045, 0.012), 0.004)            # the bow
        tip = p + out * (0.08 + L_)
        F.add(RoundCone(tuple(p + out * 0.08), tuple(tip), 0.016, 0.014), 0.004)                 # the shank
        side = np.array((1.0, 0.0, 0.0)) * (1 if i % 2 else -1)
        F.add(RoundBox(tuple(tip - out * 0.05 + side * 0.035), (0.035, 0.01, 0.045), radius=0.006), 0.004)  # the bit
    return [_rigid_pair(F, 'KeyRing', A.axe_matrix(), 'steel', 'Weapon', 2400, workdir)]


def build_lanterns(workdir, k=1.0):
    """The gaol lantern: an iron cage of four posts, a peaked cap and a bail, the
    sea-light flame inside a cracked glass; one at the hip and one in the fist."""
    out = []
    for name, bone, centre, down in (('LanternBelt', 'LanternB', A.LANTERN_HIP, np.array((0.0, 0.0, -1.0))),
                                     ('LanternHand', 'LanternH', A.GRIP_L + A._dl2 * 0.36, A.unit(A._dl2))):
        up = -down
        fwd = A.unit(np.cross(up, (1.0, 0.0, 0.0))) if abs(up[0]) < 0.9 else A.unit(np.cross(up, (0.0, 1.0, 0.0)))
        side = A.unit(np.cross(fwd, up))
        p = K.Part(name, 'steel', bone=bone)
        h = 0.36
        base = centre - up * h * 0.5
        top = centre + up * h * 0.5
        for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            off = side * 0.12 * sx + fwd * 0.12 * sy
            p.tube([tuple(base + off), tuple(top + off)], [0.016, 0.016], sides=5)
        p.box(tuple(base - up * 0.02), (0.15, 0.15, 0.025))
        p.tube([tuple(top), tuple(top + up * 0.12)], [0.15, 0.03], sides=8)
        p.torus(tuple(top + up * 0.2), tuple(side), 0.07, 0.012, seg=10, sides=5)
        o = p.to_object()
        out.append((K.duplicate(o, o.name + '_hi'), o))
        g = K.Part(name + 'Flame', 'glow_lantern', bone=bone)
        g.sphere(tuple(centre), (0.09, 0.09, 0.13), seg=10, rings=6)
        go = g.to_object()
        out.append((K.duplicate(go, go.name + '_hi'), go))
    return out


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
    return build_keys(workdir, k) + build_lanterns(workdir, k) + build_eyes()
