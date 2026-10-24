"""Moonspawn: skeleton and sculpts (rest pose), in yards.

A spirit of the Drowned Moon that Ysolei calls out of the flooded shore: a
lizard of living tide on four legs, its body clear moonlit water with silver
light running through it, a great crescent of nacre rising along its back
like a sail and another set on its head like a mask, its jaws long and lined
with glassy teeth, its tail trailing water.

Axes: yards, +Z up, faces -Y, its left is +X. The crescent's horns about 2.5
up; about 4.2 long.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere, rot_matrix

NAME = 'Moonspawn'
PREFIX = 'moonspawn'

CHEST = (np.array((0.0, -0.35, 0.82)), np.array((0.0, -0.95, 0.95)))
PELVIS = (np.array((0.0, -0.35, 0.82)), np.array((0.0, 0.5, 0.78)))
NECK = (np.array((0.0, -0.95, 0.95)), np.array((0.0, -1.35, 1.12)))
HEAD = (np.array((0.0, -1.35, 1.12)), np.array((0.0, -1.95, 1.02)))
JAW = (np.array((0.0, -1.45, 1.0)), np.array((0.0, -1.95, 0.88)))
TAIL = [np.array(p) for p in ((0.0, 0.5, 0.78), (0.0, 1.1, 0.62), (0.0, 1.65, 0.42), (0.0, 2.15, 0.26), (0.0, 2.6, 0.16))]
FRONT = (np.array((0.36, -0.8, 0.82)), np.array((0.86, -0.88, 0.7)), np.array((0.98, -0.98, 0.08)),
         np.array((1.08, -1.24, 0.04)))
BACK = (np.array((0.36, 0.42, 0.78)), np.array((0.88, 0.36, 0.66)), np.array((1.0, 0.56, 0.08)),
        np.array((1.12, 0.3, 0.04)))
POOL_AT = np.array((0.0, -0.3, 0.0))
BAKE_CAGE, BAKE_RAY = 0.02, 0.08


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.5)),
        ('Chest', 'Root', tuple(CHEST[0]), tuple(CHEST[1])),
        ('Pelvis', 'Root', tuple(PELVIS[0]), tuple(PELVIS[1])),
        ('Neck', 'Chest', tuple(NECK[0]), tuple(NECK[1])),
        ('Head', 'Neck', tuple(HEAD[0]), tuple(HEAD[1])),
        ('Jaw', 'Head', tuple(JAW[0]), tuple(JAW[1])),
        ('Pool', 'Root', tuple(POOL_AT), tuple(POOL_AT + np.array((0, 0, 0.4)))),
    ]
    prev = 'Pelvis'
    for i in range(4):
        out.append((f'Tail{i + 1}', prev, tuple(TAIL[i]), tuple(TAIL[i + 1])))
        prev = f'Tail{i + 1}'
    for nm, parent, pts in (('Front', 'Chest', FRONT), ('Back', 'Pelvis', BACK)):
        prev = parent
        for j, part in enumerate(('Up', 'Low', 'Foot')):
            b = f'L_{nm}{part}'
            out.append((b, prev, tuple(pts[j]), tuple(pts[j + 1])))
            prev = b
    out2 = []
    for name, parent, h, t in out:
        out2.append((name, parent, tuple(float(x) for x in h), tuple(float(x) for x in t)))
        if name.startswith('L_'):
            tp = 'R_' + parent[2:] if parent.startswith('L_') else parent
            out2.append(('R_' + name[2:], tp, (-h[0], h[1], h[2]), (-t[0], t[1], t[2])))
    return out2


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = ()
LIMBS = ()
HELPERS = {}
ROLL_LIMIT = {}
LEFT_ARM = ()
FINGERS = ()
FINGER_FAN = {}
SOLE_Z = 0.04
GROUND = -9.0
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {}
POP_SKIP = ('Tail', 'Pool')
TREMOR_KEYS = ('Chest', 'Neck', 'Head')
AIM_LIMITS = {}
HIDDEN = {'Pool': 0.0}
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
TAIL_CHAIN = [f'Tail{i}' for i in range(1, 5)]


def hand_frame(side=1):
    raise NotImplementedError


def _chains():
    from rig import Chain
    return [Chain(TAIL_CHAIN, 'Pelvis', gravity=0.2, stiff=0.25, damp=0.2, drag=1.0)]


class _Lazy(list):
    def __iter__(self):
        if not len(self):
            self.extend(_chains())
        return list.__iter__(self)

    def __bool__(self):
        return True


CHAINS = _Lazy()


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def build_body(voxel):
    F = Field((-1.1, -2.3, -0.1), (1.1, 2.8, 1.9), voxel)
    noise = Noise(3)
    F.add(Ellipsoid((0, -0.62, 0.86), (0.56, 0.6, 0.34), rot_matrix(rx=0.15), bone='Chest'), 0.16)
    F.add(Ellipsoid((0, 0.12, 0.78), (0.5, 0.6, 0.3), bone='Pelvis'), 0.16)
    F.add(RoundCone(NECK[0], NECK[1], 0.3, 0.22, bone='Neck'), 0.1)
    # the head: long, flat and broad, a lizard's, the jaw on its own bone
    F.add(Ellipsoid((0, -1.56, 1.1), (0.3, 0.44, 0.15), rot_matrix(rx=0.12), bone='Head'), 0.08)
    F.add(Ellipsoid((0, -1.62, 0.96), (0.26, 0.38, 0.09), rot_matrix(rx=0.18), bone='Jaw'), 0.06)
    F.sub(Ellipsoid((0, -1.7, 1.02), (0.2, 0.32, 0.035)), 0.02)
    for s in (1, -1):
        F.add(Sphere(_m((0.2, -1.42, 1.18), s), 0.09, bone='Head'), 0.04)
    for i in range(4):
        F.add(RoundCone(TAIL[i], TAIL[i + 1], 0.3 - 0.065 * i, 0.235 - 0.06 * i, bone=f'Tail{i + 1}'), 0.08)
    for s in (1, -1):
        for nm, pts, rr in (('Front', FRONT, (0.17, 0.14, 0.11)), ('Back', BACK, (0.2, 0.16, 0.12))):
            pts = [_m(p, s) for p in pts]
            side = 'L_' if s > 0 else 'R_'
            F.add(RoundCone(pts[0], pts[1], rr[0], rr[1], bone=f'{side}{nm}Up'), 0.06)
            F.add(RoundCone(pts[1], pts[2], rr[1], rr[2], bone=f'{side}{nm}Low'), 0.05)
            F.add(Ellipsoid((pts[2] + pts[3]) * 0.5, (0.15, 0.2, 0.05), bone=f'{side}{nm}Foot'), 0.04)
            for k in (-1, 0, 1):
                tip = pts[3] + np.array((s * 0.09 * k, -0.1, 0.0))
                F.add(RoundCone(pts[2] + np.array((s * 0.03 * k, -0.04, 0.02)), tip, 0.035, 0.012,
                                bone=f'{side}{nm}Foot'), 0.02)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=3), band=0.05)
    return F


def body_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    _write(obj, {'RegZ': np.clip(P[:, 2] / 1.5, 0, 1), 'RegMouth': np.clip(
        1 - np.linalg.norm((P - np.array((0, -1.72, 1.02))) / np.array((0.18, 0.32, 0.06)), axis=1), 0, 1)})


def build_crescents(voxel):
    """Two crescents of nacre: a great one rising along its back like a sail,
    horns up fore and aft, and a smaller one on its brow like a mask."""
    F = Field((-0.5, -2.2, 0.5), (0.5, 1.6, 2.6), voxel)

    def crescent(c, R, r_in, off, th, z_up=True):
        # in the y-z plane: a disc of radius R minus a disc of radius r_in shifted by `off`
        def f(X_, Y_, Z_):
            dy, dz = Y_ - c[1], Z_ - c[2]
            d1 = np.sqrt(dy * dy + dz * dz) - R
            d2 = np.sqrt(dy * dy + (dz - off) ** 2) - r_in
            d = np.maximum(d1, -d2)
            return np.maximum(d, np.abs(X_ - c[0]) - th * (1 - np.clip(np.abs(dy) / R, 0, 1) * 0.6))
        return f
    sail = crescent(np.array((0.0, -0.15, 0.62)), 1.12, 1.02, -0.36, 0.07)
    X_, Y_, Z_ = np.meshgrid(*F.axes, indexing='ij')
    d = sail(X_, Y_, Z_)
    d = np.maximum(d, 0.72 - Z_)
    # the brow crest: a crescent in the head's front plane, horns up
    c = np.array((0.0, -1.5, 1.36))
    dx, dz = X_ - c[0], Z_ - c[2]
    d1 = np.sqrt(dx * dx + dz * dz) - 0.3
    d2 = np.sqrt(dx * dx + (dz - 0.13) ** 2) - 0.26
    crest = np.maximum(np.maximum(d1, -d2), np.abs(Y_ - c[1]) - 0.05)
    F.d = np.minimum(d, crest).astype(np.float32)
    noise = Noise(9)
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 10, Y_ * 10, Z_ * 10, octaves=2), band=0.03)
    return F


def crescent_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Chest', 'Pelvis', 'Head']
    W = np.zeros((len(P), 3))
    head = (P[:, 1] < -1.1).astype(float)
    t = np.clip((P[:, 1] + 0.6) / 1.2, 0, 1)
    W[:, 0] = (1 - head) * (1 - t)
    W[:, 1] = (1 - head) * t
    W[:, 2] = head
    W = R.relax(W, E, iters=2)
    R.write_groups(obj, names, R.cap4(W))


def crescent_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    _write(obj, {'RegEdge': np.clip((np.abs(P[:, 0]) - 0.02) / 0.03, 0, 1)})


def fields(k=1.0):
    from build_core import Sculpt
    return [Sculpt('Body', build_body(0.012 * k), 'tide', 7000, tau=0.06, paint=body_paint),
            Sculpt('Crescents', build_crescents(0.01 * k), 'nacre', 3000, binding='own', weigh=crescent_weights,
                   paint=crescent_paint)]


_ = (X, sdf, math)
