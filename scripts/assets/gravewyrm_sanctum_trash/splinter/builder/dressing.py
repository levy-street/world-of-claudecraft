"""The Glacier Splinter's ice: every piece a sharp-faceted convex chunk (a jittered
box or prism closed by a convex hull, flat shaded), rigid on its own bone; plus the
heart crystal glowing in the core's window and the rune-slit eye."""
import math

import bmesh
import bpy
import numpy as np

import anatomy as A
import mesh_kit as K
from biped import lerp, unit

RNG = np.random.default_rng(41)


def _frame(axis, up=(0.0, -1.0, 0.0)):
    z = unit(axis)
    x = np.cross(up, z)
    if np.linalg.norm(x) < 1e-3:
        x = np.cross((1.0, 0, 0), z)
    x = unit(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def chunk(bm, c, R, half, n_extra=10, jitter=0.3, taper=0.0, point=0.0, seed=None):
    """A faceted chunk: the 8 corners of a box (each pulled in at random), a few
    points on its faces and an optional point at +Z, closed by a convex hull."""
    rng = np.random.default_rng(seed) if seed is not None else RNG
    hx, hy, hz = half
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                t = 1 - taper if sz > 0 else 1.0
                p = np.array((sx * hx * t, sy * hy * t, sz * hz)) * (1 - rng.uniform(0, jitter, 3))
                pts.append(p)
    for _ in range(n_extra):
        ax = rng.integers(3)
        p = rng.uniform(-1, 1, 3) * np.array((hx, hy, hz))
        p[ax] = math.copysign(np.array((hx, hy, hz))[ax] * rng.uniform(0.85, 1.05), p[ax])
        pts.append(p)
    if point:
        pts.append(np.array((rng.normal(0, hx * 0.15), rng.normal(0, hy * 0.15), hz + point)))
    verts = [bm.verts.new(tuple(np.asarray(c) + R @ p)) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=verts)
    drop = {}
    for v in list(res['geom_interior']) + list(res['geom_unused']):
        if isinstance(v, bmesh.types.BMVert) and v.is_valid:
            drop[id(v)] = v
    if drop:
        bmesh.ops.delete(bm, geom=list(drop.values()), context='VERTS')


def crystal(bm, base, tip, r, n=6, seed=None):
    """A long crystal from base to tip: a jittered n-sided prism with a pointed top."""
    rng = np.random.default_rng(seed) if seed is not None else RNG
    base, tip = np.asarray(base, float), np.asarray(tip, float)
    ax = tip - base
    L = np.linalg.norm(ax)
    R = _frame(ax)
    pts = []
    rot = rng.uniform(0, 6.28)
    for i in range(n):
        a = rot + 2 * math.pi * i / n + rng.normal(0, 0.12)
        rr = r * rng.uniform(0.82, 1.08)
        pts.append(np.array((math.cos(a) * rr, math.sin(a) * rr, -0.02 * L)))
        pts.append(np.array((math.cos(a) * rr * 0.92, math.sin(a) * rr * 0.92, L * rng.uniform(0.62, 0.78))))
    pts.append(np.array((rng.normal(0, r * 0.15), rng.normal(0, r * 0.15), L)))
    verts = [bm.verts.new(tuple(base + R @ p)) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=verts)
    drop = {}
    for v in list(res['geom_interior']) + list(res['geom_unused']):
        if isinstance(v, bmesh.types.BMVert) and v.is_valid:
            drop[id(v)] = v
    if drop:
        bmesh.ops.delete(bm, geom=list(drop.values()), context='VERTS')


def piece(name, bone, build):
    p = K.Part(name, 'ice', bone=bone, smooth=False)
    build(p.bm)
    o = p.to_object()
    return K.duplicate(o, o.name + '_hi'), o


def _m(p, s):
    return np.array((p[0] * s, p[1], p[2]), float)


def build_ice():
    out = []
    rx = lambda a: np.array(((1, 0, 0), (0, math.cos(a), -math.sin(a)), (0, math.sin(a), math.cos(a))))  # noqa: E731
    rz = lambda a: np.array(((math.cos(a), -math.sin(a), 0), (math.sin(a), math.cos(a), 0), (0, 0, 1)))  # noqa: E731
    I = np.eye(3)

    def pelvis(bm):
        chunk(bm, (0.3, -0.12, 2.22), rz(0.3) @ rx(-0.1), (0.34, 0.3, 0.34), point=0.0, seed=1)
        chunk(bm, (-0.3, -0.12, 2.22), rz(-0.3) @ rx(-0.1), (0.34, 0.3, 0.34), seed=2)
        chunk(bm, (0.0, 0.28, 2.28), I, (0.5, 0.2, 0.32), seed=3)
    out.append(piece('IcePelvis', 'Hips', pelvis))

    def belly(bm):
        for s, sd in ((1, 4), (-1, 5)):
            chunk(bm, (0.3 * s, -0.28, 2.92), rz(0.25 * s), (0.27, 0.24, 0.34), seed=sd)
            chunk(bm, (0.5 * s, 0.05, 2.88), rz(0.6 * s), (0.14, 0.24, 0.28), seed=sd + 10)
        chunk(bm, (0.0, 0.3, 2.92), I, (0.44, 0.18, 0.3), seed=6)
    out.append(piece('IceBelly', 'Spine1', belly))

    def chest(bm):
        for s, sd in ((1, 7), (-1, 8)):
            chunk(bm, (0.42 * s, -0.34, 3.62), rz(0.35 * s) @ rx(0.12), (0.4, 0.27, 0.48), seed=sd, taper=0.15)
            chunk(bm, (0.74 * s, 0.0, 3.5), rz(0.7 * s), (0.26, 0.36, 0.42), seed=sd + 20)
        chunk(bm, (0.0, 0.32, 3.66), I, (0.72, 0.3, 0.52), seed=9)
        chunk(bm, (0.0, -0.2, 4.08), rx(0.4), (0.22, 0.14, 0.12), seed=10)
    out.append(piece('IceChest', 'Spine2', chest))

    def neck(bm):
        chunk(bm, (0.0, -0.06, 4.24), I, (0.16, 0.16, 0.1), seed=11)
    out.append(piece('IceNeck', 'Neck', neck))

    def head(bm):
        chunk(bm, (0.0, -0.22, 4.6), rx(0.15), (0.3, 0.3, 0.3), seed=12, taper=0.2)
        crystal(bm, (0.0, -0.1, 4.75), (0.0, 0.22, 5.3), 0.11, seed=13)
        crystal(bm, (0.16, -0.12, 4.7), (0.42, 0.1, 5.08), 0.08, seed=14)
        crystal(bm, (-0.16, -0.12, 4.7), (-0.42, 0.1, 5.08), 0.08, seed=15)
        chunk(bm, (0.0, -0.4, 4.38), rx(-0.3), (0.24, 0.12, 0.09), seed=16)          # the jaw-shard
    out.append(piece('IceHead', 'Head', head))

    for s in (1, -1):
        sh, el, wr = _m(A.SHOULDER, s), _m(A.ELBOW, s), _m(A.WRIST, s)
        hp, kn, an = _m(A.HIP, s), _m(A.KNEE, s), _m(A.ANKLE, s)
        side = 'L_' if s > 0 else 'R_'
        sd = 100 if s > 0 else 200

        def shoulder(bm, sh=sh, s=s, sd=sd):
            chunk(bm, sh + np.array((0.0, 0.0, 0.12)), rz(0.4 * s), (0.46, 0.44, 0.34), seed=sd + 1, taper=0.25)
        out.append(piece(side + 'IceShoulder', side + 'Clavicle', shoulder))

        def upper(bm, sh=sh, el=el, sd=sd):
            R = _frame(el - sh)
            chunk(bm, lerp(sh, el, 0.48) + np.array((0, -0.12, 0)), R, (0.24, 0.2, 0.34), seed=sd + 2)
            chunk(bm, lerp(sh, el, 0.52) + np.array((0, 0.13, 0)), R, (0.22, 0.2, 0.3), seed=sd + 3)
        out.append(piece(side + 'IceUpperArm', side + 'UpperArm', upper))

        def fore(bm, el=el, wr=wr, sd=sd):
            R = _frame(wr - el)
            chunk(bm, lerp(el, wr, 0.55), R, (0.33, 0.31, 0.46), seed=sd + 4, taper=-0.25)
        out.append(piece(side + 'IceForearm', side + 'Forearm', fore))

        def fist(bm, wr=wr, s=s, sd=sd):
            w, down, width, palm = A.hand_frame(s)
            R = np.stack([width, palm, down], axis=1)
            chunk(bm, wr + down * 0.32, R, (0.36, 0.33, 0.33), seed=sd + 5)
            for j, off in enumerate((-0.14, 0.0, 0.14)):
                base = wr + down * 0.45 + width * off - palm * 0.1
                crystal(bm, base, base + down * 0.42 - palm * 0.16 + width * off * 0.5, 0.11, n=5, seed=sd + 6 + j)
        out.append(piece(side + 'IceFist', side + 'Hand', fist))

        def thigh(bm, hp=hp, kn=kn, sd=sd):
            R = _frame(kn - hp)
            chunk(bm, lerp(hp, kn, 0.45), R, (0.37, 0.36, 0.42), seed=sd + 10)
        out.append(piece(side + 'IceThigh', side + 'Thigh', thigh))

        def shin(bm, kn=kn, an=an, sd=sd):
            R = _frame(an - kn)
            chunk(bm, lerp(kn, an, 0.52), R, (0.32, 0.31, 0.36), seed=sd + 11, taper=-0.15)
            crystal(bm, kn + np.array((0, -0.12, -0.05)), kn + np.array((0, -0.38, 0.22)), 0.07, n=5, seed=sd + 12)
        out.append(piece(side + 'IceShin', side + 'Shin', shin))

        def foot(bm, an=an, s=s, sd=sd):
            chunk(bm, _m((0.56, -0.14, 0.2), s), I, (0.3, 0.36, 0.18), seed=sd + 13, taper=0.2)
        out.append(piece(side + 'IceFoot', side + 'Foot', foot))

        def toes(bm, s=s, sd=sd):
            chunk(bm, _m((0.56, -0.52, 0.13), s), I, (0.2, 0.14, 0.1), seed=sd + 14, taper=0.3)
        out.append(piece(side + 'IceToes', side + 'Toes', toes))
    for name, (par, a, b) in A.SPIKES.items():
        for s in ((1, -1) if name.startswith('L_') else (1,)):
            nm = name if s > 0 else 'R_' + name[2:]
            a2, b2 = _m(a, s), _m(b, s)
            sd = sum(ord(ch) * (i + 1) for i, ch in enumerate(nm)) % 1000

            def spike(bm, a2=a2, b2=b2, sd=sd):
                crystal(bm, a2, b2, 0.16 * np.linalg.norm(b2 - a2) / 1.0 + 0.04, n=6, seed=sd)
                side_ = unit(np.cross(b2 - a2, (0, 1.0, 0)))
                crystal(bm, lerp(a2, b2, 0.15), lerp(a2, b2, 0.55) + side_ * 0.2, 0.07, n=5, seed=sd + 1)
            out.append(piece('Ice' + nm.replace('_', ''), nm, spike))
    return out


def build_glow():
    out = []
    p = K.Part('HeartCrystal', 'glow_core', bone='Core', smooth=False)
    c = A.CORE_C + np.array((0, -0.2, 0))
    crystal(p.bm, c - np.array((0, 0, 0.16)), c + np.array((0, 0, 0.18)), 0.1, n=6, seed=77)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    e = K.Part('EyeSlit', 'glow_core', bone='Head', smooth=False)
    for s in (1, -1):
        e.box((0.08 * s, -0.4, 4.6), (0.06, 0.03, 0.018), rot=None)
    o = e.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    return build_ice() + build_glow()
