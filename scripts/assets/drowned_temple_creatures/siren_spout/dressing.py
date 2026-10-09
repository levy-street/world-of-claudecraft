"""The Siren's hard dressing and props: the silver crescent crown and its
strings of pearls over her brow and temples, the pearl collar and moon
pendant, the girdle of pearls where her skin turns to scale, the coral staff
(a sculpt riding the never-keyed Weapon bone) with its moon pearl and the
flare that lights it for Brine Lash (Flare), the three bubbles of tide that
leave her waterspout when she sings Call the Tide (Bubble0-2), and the pool
of foam she falls into when she dies (Pool)."""
import math

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf


def _pair(part, attrs=None):
    o = part.to_object()
    if attrs is not None:
        attrs(o)
    hi = K.duplicate(o, o.name + '_hi')
    for nm in [a.name for a in o.data.attributes if a.name.startswith('Reg')]:
        o.data.attributes.remove(o.data.attributes[nm])
    return (hi, o)


def _onto(F, p, lift):
    q = np.asarray(p, float)[None, :]
    for _ in range(5):
        d = F.sample(q)
        n = F.gradient(q)
        q = q - n * d[:, None]
    return (q + F.gradient(q) * lift)[0]


def build_crown(Fh):
    """A silver band along the hairline, a tall crescent (horns up) on the brow,
    and strings of pearls hanging from the band: short over the brow, long
    down the temples to the cheekbones, framing the face."""
    sil = K.Part('Crown', 'silver', bone='Head')
    pearls = K.Part('CrownPearls', 'pearl', bone='Head')
    band = []
    for i in range(25):
        th = math.radians(-105 + 210 * i / 24)
        p = A.HEAD_C + A.HEAD_SCALE * np.array((0.17 * math.sin(th), -0.2 * math.cos(th),
                                                0.11 - 0.06 * (1 - math.cos(th))))
        band.append(_onto(Fh, p, 0.06))
    sil.tube(band, 0.011, sides=6)
    c = _onto(Fh, A.HEAD_C + A.HEAD_SCALE * np.array((0.0, -0.2, 0.14)), 0.075)
    arc, rad = [], []
    for i in range(17):
        a = math.radians(195 + 150 * i / 16)
        arc.append(c + np.array((0.075 * math.cos(a), -0.006, 0.075 * math.sin(a) + 0.085)))
        rad.append(0.005 + 0.017 * math.sin(math.pi * i / 16))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    pearls.sphere(c + np.array((0, -0.012, 0.06)), (0.026, 0.026, 0.026), seg=12, rings=8)
    # the strings: long ones down the temples to the cheekbones, framing the
    # face, and one short drop under the crescent
    for u, n in ((0.24, 6), (0.3, 5), (0.7, 5), (0.76, 6)):
        k = int(round(u * 24))
        top = band[k]
        side = 1.0 if top[0] > 0 else -1.0
        for i in range(n):
            q = top + np.array((side * 0.006 * i, -0.004 * i, -0.036 * (i + 1)))
            q = _onto(Fh, q, 0.02)
            pearls.sphere(q, (0.014, 0.014, 0.014), seg=8, rings=5)
    for i in range(2):
        q = _onto(Fh, band[12] + np.array((0, 0, -0.032 * (i + 1))), 0.016)
        pearls.sphere(q, (0.013 - 0.002 * i,) * 3, seg=8, rings=5)
    return [_pair(sil), _pair(pearls)]


def build_collar(Fb):
    """A collar of pearls round the base of the neck, a silver crescent and a
    pearl at the top of the bodice."""
    sil = K.Part('Pendant', 'silver', bone='Spine2')
    pearls = K.Part('Collar', 'pearl', bone='Spine2')
    for i in range(19):
        u = -1 + 2 * i / 18
        p = np.array((0.13 * u, -0.02 - 0.15 * (1 - u * u), 3.9 - 0.16 * (1 - u * u) ** 1.2))
        if abs(u) > 0.98:
            p[1] = 0.04
        pearls.sphere(_onto(Fb, p, 0.014), (0.016, 0.016, 0.016), seg=8, rings=5)
    c = np.array((0.0, -0.21, 3.68))
    c = _onto(Fb, c, 0.03)
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(c + np.array((0.05 * math.cos(a), 0.0, 0.05 * math.sin(a) + 0.014)))
        rad.append(0.004 + 0.011 * math.sin(math.pi * i / 12))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    pearls.sphere(c + np.array((0, -0.006, -0.008)), (0.032, 0.032, 0.032), seg=12, rings=8)
    return [_pair(sil), _pair(pearls)]


def build_girdle(Ft):
    """Two strings of pearls round her hips where the skin turns to scale, and a
    crescent at the front with three short drops."""
    pearls = K.Part('Girdle', 'pearl', bone='Hips')
    sil = K.Part('GirdleMoon', 'silver', bone='Hips')
    for row, (z0, dip, rr) in enumerate(((2.96, 0.05, 0.02), (2.86, 0.12, 0.017))):
        n = 30
        for i in range(n):
            a = 2 * math.pi * i / n
            z = z0 - dip * (0.5 + 0.5 * math.cos(a))
            r = float(A._tail_radius(z))
            p = np.array((r * math.sin(a), A._tail_centre(z) - r * 0.8 * math.cos(a), z))
            pearls.sphere(_onto(Ft, p, rr * 0.8), (rr, rr, rr), seg=8, rings=5)
    c = _onto(Ft, np.array((0.0, -0.3, 2.74)), 0.03)
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(c + np.array((0.06 * math.cos(a), -0.004, 0.06 * math.sin(a) + 0.02)))
        rad.append(0.005 + 0.012 * math.sin(math.pi * i / 12))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    for i, dx in enumerate((-0.05, 0.0, 0.05)):
        for j in range(2 + (i == 1)):
            q = c + np.array((dx, -0.01, -0.05 - 0.04 * j))
            pearls.sphere(_onto(Ft, q, 0.02), (0.015, 0.015, 0.015), seg=8, rings=5)
    return [_pair(pearls), _pair(sil)]


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


def build_staff(workdir, k=1.0):
    F = A.build_staff(0.006 * k)
    staff = _sculpt(F, 'Staff', 'coral', 'Weapon', A.staff_matrix(), 2600, workdir, paint=A.staff_paint)
    pearl = K.Part('MoonPearl', 'glow_pearl', bone='Weapon')
    c = A.staff_point((0, 0, A.PEARL_Z))
    pearl.sphere(c, (A.PEARL_R, A.PEARL_R, A.PEARL_R), seg=20, rings=12)
    flare = K.Part('PearlFlare', 'glow_flare', bone='Flare')
    flare.sphere(c, (0.26, 0.26, 0.26), seg=16, rings=10)
    ax = np.array(A.WEAPON_AXIS)
    flare.torus(c, tuple(ax), 0.36, 0.02, seg=28, sides=5)
    return [staff, _pair(pearl), _pair(flare)]


def build_bubbles():
    out = []
    for i, b in enumerate(A.BUBBLES):
        p = K.Part(f'TideBubble{i}', 'glow_bubble', bone=f'Bubble{i}')
        p.sphere(b + np.array((0, 0, 0.1)), (0.2, 0.2, 0.2), seg=16, rings=10)
        ring = K.Part(f'TideBubbleMoon{i}', 'glow_flare', bone=f'Bubble{i}')
        ring.torus(b + np.array((0, 0, 0.1)), (0, 1, 0), 0.1, 0.014, seg=18, sides=4)
        out += [_pair(p), _pair(ring)]
    return out


def build_pool():
    c = A.POOL_AT
    pool = K.Part('DeathPool', 'glow_pool', bone='Pool')
    pool.sphere(c + np.array((0, 0, 0.012)), (1.25, 1.15, 0.014), seg=28, rings=6)
    rim = K.Part('DeathFoam', 'glow_foam', bone='Pool')
    rim.torus(c + np.array((0, 0, 0.025)), (0, 0, 1), 1.15, 0.035, seg=40, sides=5, squash=(1.0, 0.92))
    rng = np.random.default_rng(21)
    for i in range(22):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.2, 1.3)
        rr = rng.uniform(0.03, 0.07)
        rim.sphere(c + np.array((math.cos(a) * r, math.sin(a) * r * 0.92, rr * 0.6)), (rr, rr, rr * 0.7), seg=7,
                   rings=4)
    return [_pair(pool), _pair(rim)]


def build(sculpts):
    by = {s.name: s.F for s in sculpts}
    workdir = getattr(build, 'workdir', None)
    import sys
    argv = sys.argv[sys.argv.index('--') + 1:]
    k = 1.0
    if '--k' in argv:
        k = float(argv[argv.index('--k') + 1])
    if '--work' in argv:
        workdir = argv[argv.index('--work') + 1]
    return (build_crown(by['Head']) + build_collar(by['Body']) + build_girdle(by['Tail'])
            + build_staff(workdir, k) + build_bubbles() + build_pool())
