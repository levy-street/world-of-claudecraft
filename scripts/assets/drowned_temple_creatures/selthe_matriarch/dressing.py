"""Selthe's dressing: the crescent crown and its strings of pearls (the
siren's, grander), pearls set through her hair, the pearl collar, the girdle
where her skin turns to scale, the fan's silver rays (thick as organ pipes at
the root, a pearl at each tip), and the golden Great Conch on its gold chain
(Conch; the same conch left glowing on the floor when she dies, ConchFree)."""
import math

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf


def _pair(part):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def _onto(F, p, lift):
    q = np.asarray(p, float)[None, :]
    for _ in range(5):
        d = F.sample(q)
        n = F.gradient(q)
        q = q - n * d[:, None]
    return (q + F.gradient(q) * lift)[0]


def build_crown(Fh):
    sil = K.Part('Crown', 'silver', bone='Head')
    pearls = K.Part('CrownPearls', 'pearl', bone='Head')
    band = []
    for i in range(25):
        th = math.radians(-105 + 210 * i / 24)
        p = A.HEAD_C + A.HEAD_SCALE * np.array((0.17 * math.sin(th), -0.2 * math.cos(th),
                                                0.11 - 0.06 * (1 - math.cos(th))))
        band.append(_onto(Fh, p, 0.06))
    sil.tube(band, 0.013, sides=6)
    # a tall crescent and two lesser ones
    for dx, rr, lift in ((0.0, 0.1, 0.12), (0.12, 0.055, 0.07), (-0.12, 0.055, 0.07)):
        c = _onto(Fh, A.HEAD_C + A.HEAD_SCALE * np.array((dx, -0.19, 0.14)), 0.075)
        arc, rad = [], []
        for i in range(17):
            a = math.radians(195 + 150 * i / 16)
            arc.append(c + np.array((rr * math.cos(a), -0.006, rr * math.sin(a) + lift)))
            rad.append(0.005 + rr * 0.24 * math.sin(math.pi * i / 16))
        sil.tube(arc, rad, sides=6, up=(0, -1, 0))
        pearls.sphere(c + np.array((0, -0.012, lift * 0.7)), (rr * 0.33,) * 3, seg=12, rings=8)
    for u, n in ((0.22, 7), (0.29, 6), (0.71, 6), (0.78, 7)):
        k = int(round(u * 24))
        top = band[k]
        side = 1.0 if top[0] > 0 else -1.0
        for i in range(n):
            q = top + np.array((side * 0.006 * i, -0.004 * i, -0.036 * (i + 1)))
            q = _onto(Fh, q, 0.02)
            pearls.sphere(q, (0.014, 0.014, 0.014), seg=8, rings=5)
    # pearls threaded through the hair at the back of the head
    rng = np.random.default_rng(4)
    for i in range(14):
        th = rng.uniform(-2.4, 2.4)
        z = rng.uniform(4.5, 4.75)
        q = _onto(Fh, A.hs((0.15 * math.sin(th), 0.04 + 0.18 * math.cos(th), z)), 0.07)
        pearls.sphere(q, (0.02, 0.02, 0.02), seg=8, rings=5)
    return [_pair(sil), _pair(pearls)]


def build_collar(Fb):
    pearls = K.Part('Collar', 'pearl', bone='Spine2')
    for row in range(2):
        for i in range(19):
            u = -1 + 2 * i / 18
            sag = 0.15 + 0.07 * row
            p = np.array((0.13 * u, -0.02 - sag * (1 - u * u), 3.9 - (0.16 + 0.08 * row) * (1 - u * u) ** 1.2))
            if abs(u) > 0.98:
                p[1] = 0.04
            pearls.sphere(_onto(Fb, p, 0.014), (0.016, 0.016, 0.016), seg=8, rings=5)
    return [_pair(pearls)]


def build_girdle(Ft):
    pearls = K.Part('Girdle', 'pearl', bone='Hips')
    for row, (z0, rr) in enumerate(((2.96, 0.02), (2.86, 0.017))):
        for i in range(32):
            a = 2 * math.pi * i / 32
            p = np.array((0.27 * math.sin(a), 0.04 - 0.22 * math.cos(a), z0 - 0.05 * (0.5 + 0.5 * math.cos(a))))
            pearls.sphere(_onto(Ft, p, rr * 0.8), (rr, rr, rr), seg=8, rings=5)
    return [_pair(pearls)]


def build_rays():
    """The fan's rays: silver spines thick as organ pipes at the root,
    tapering, a flared rim and a pearl at every tip."""
    out = []
    for i, a in enumerate(A.FAN_ANG):
        bone = f'Fan{i}'
        L = A.fan_len(a)
        d = A.fan_dir(a)
        o = A.FAN_O + d * 0.18
        sil = K.Part(f'Ray{i}', 'ray', bone=bone)
        ts = np.linspace(0, 1, 12)
        pts = [o + d * (L - 0.18) * t for t in ts]
        rad = [0.06 * (1 - t) + 0.016 for t in ts]
        sil.tube(pts, rad, sides=8)
        tip = A.FAN_O + d * L
        sil.torus(tip - d * 0.04, tuple(d), 0.036, 0.012, seg=12, sides=5)
        out.append(_pair(sil))
        p = K.Part(f'RayPearl{i}', 'glow_pearl', bone=bone)
        p.sphere(tip + d * 0.02, (0.05, 0.05, 0.05), seg=10, rings=6)
        out.append(_pair(p))
    return out


def _sculpt(F, name, mat, bone, M, target, workdir, paint=None):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    if paint is not None:
        paint(hi)
    hi.data.transform(Matrix(M.tolist()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = K.duplicate(hi, name)
    tris = K.triangles(lo)
    if tris > target:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    for nm in [a.name for a in lo.data.attributes if a.name.startswith('Reg')]:
        lo.data.attributes.remove(lo.data.attributes[nm])
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = 'rigid'
    return hi, lo


def build_conch(workdir, k=1.0):
    F = A.build_conch(0.006 * k)
    M = A.conch_matrix()
    held = _sculpt(F, 'GreatConch', 'gold', 'Conch', M, 2400, workdir, paint=A.conch_paint)
    F2 = A.build_conch(0.006 * k)
    left = _sculpt(F2, 'GreatConchLeft', 'gold', 'ConchFree', M, 1600, workdir, paint=A.conch_paint)
    chain = K.Part('ConchChain', 'gold_chain', bone='Spine2')
    pts = []
    for i in range(21):
        u = -1 + 2 * i / 20
        pts.append(np.array((0.14 * u, -0.05 - 0.22 * (1 - u * u), 3.92 - 0.42 * (1 - u * u) ** 1.1)))
    chain.tube(pts, 0.011, sides=6)
    return [held, left, _pair(chain)]


def build(sculpts):
    import sys
    by = {s.name: s.F for s in sculpts}
    argv = sys.argv[sys.argv.index('--') + 1:]
    k = float(argv[argv.index('--k') + 1]) if '--k' in argv else 1.0
    workdir = argv[argv.index('--work') + 1] if '--work' in argv else None
    return (build_crown(by['Head']) + build_collar(by['Body']) + build_girdle(by['Tail']) + build_rays()
            + build_conch(workdir, k))
