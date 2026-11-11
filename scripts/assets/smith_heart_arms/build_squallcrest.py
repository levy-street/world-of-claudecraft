"""Squallcrest: the Guardian of the Breath's storm blade (Smith's Heart).

A long storm-steel blade with edges that burn lightning-bright, a raised silver channel up each
face holding a forked bolt, three wind fins hooked back off its spine edge like gusts frozen in
steel, and a guard that is an open silver halo round a storm-eye gem, swept back in two gale
vanes. Two splinters of the blade hover free beside the halo; the grip is storm-blue leather
under silver wire, the pommel a small halo round a second eye.

Lightning sits inside the skin's emissive window (hue 180 to 215, saturation >= 0.6,
lightness >= 0.55); the steel is kept dark and grey, the silver pale and unsaturated.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_squallcrest.py -- public/models/weapons/squallcrest.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from heart_kit import HeartForge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = HeartForge('squallcrest', {
    'steel': ((0.23, 0.27, 0.33), 0.32, 0.9),
    'steel_dark': ((0.11, 0.13, 0.17), 0.4, 0.9),
    'silver': ((0.78, 0.8, 0.84), 0.22, 1.0),
    'silver_dark': ((0.42, 0.45, 0.5), 0.3, 1.0),
    'leather': ((0.1, 0.15, 0.27), 0.75, 0.0),
    'leather_dark': ((0.05, 0.07, 0.13), 0.8, 0.0),
    'edge': ((0.5, 0.88, 1.0), 0.3, 0.0),
    'bolt': ((0.55, 0.93, 1.0), 0.3, 0.0),
    'bolt_hot': ((0.86, 0.98, 1.0), 0.3, 0.0),
    'storm': ((0.3, 0.72, 1.0), 0.25, 0.0),
}, glow=('edge', 'bolt', 'storm'), no_bump=('silver', 'leather'))

Z0, Z1 = 0.24, 1.62


def half_w(t):
    # a long leaf: narrow at the ricasso, fullest past mid-blade, then a long point
    w = 0.072 + 0.034 * math.sin(math.pi * min(1.0, t / 0.8)) ** 0.8
    if t > 0.74:
        w *= max(0.0, (1 - t) / 0.26) ** 0.8
    return w


def thick(t):
    return 0.03 * (1 - 0.7 * t)


F.blade(Z0, Z1, half_w, thick, 48, 'edge', 'steel')

# the storm channel: a raised silver rail each side of a forked bolt, up both faces
for side in (1, -1):
    def lift(t, extra=0.0):
        return thick(t) + 0.0018 + extra
    rails = [(k / 30) for k in range(31)]
    for sx in (1, -1):
        for ta, tb in zip(rails, rails[1:]):
            if tb > 0.78:
                break
            xa = sx * half_w(ta) * 0.38
            xb = sx * half_w(tb) * 0.38
            za, zb = Z0 + (Z1 - Z0) * ta, Z0 + (Z1 - Z0) * tb
            w = 0.006
            q = [F.V((xa - w, side * lift(ta, 0.0025), za)), F.V((xa + w, side * lift(ta, 0.0025), za)),
                 F.V((xb + w, side * lift(tb, 0.0025), zb)), F.V((xb - w, side * lift(tb, 0.0025), zb))]
            F.face(q if side > 0 else list(reversed(q)), 'silver')
    # the forked bolt: a zigzag down the channel with two forks off it
    zig = [(0.0, 0.05), (0.018, 0.15), (-0.016, 0.24), (0.02, 0.34), (-0.012, 0.44), (0.016, 0.53),
           (-0.01, 0.62), (0.0, 0.72)]
    for (xa, ta), (xb, tb) in zip(zig, zig[1:]):
        za, zb = Z0 + (Z1 - Z0) * ta, Z0 + (Z1 - Z0) * tb
        for w, mat, extra in ((0.011, 'bolt', 0.0), (0.0045, 'bolt_hot', 0.0012)):
            q = [F.V((xa - w, side * lift(ta, extra), za)), F.V((xa + w, side * lift(ta, extra), za)),
                 F.V((xb + w, side * lift(tb, extra), zb)), F.V((xb - w, side * lift(tb, extra), zb))]
            F.face(q if side > 0 else list(reversed(q)), mat)
    for (xa, ta), dx in (((0.018, 0.15), 0.03), ((-0.012, 0.44), -0.028)):
        za = Z0 + (Z1 - Z0) * ta
        q = [F.V((xa, side * lift(ta, 0.0006), za - 0.006)), F.V((xa, side * lift(ta, 0.0006), za + 0.006)),
             F.V((xa + dx, side * lift(ta, 0.0006), za + 0.07)), F.V((xa + dx * 0.9, side * lift(ta, 0.0006), za + 0.06))]
        F.face(q if side * (1 if dx > 0 else -1) > 0 else list(reversed(q)), 'bolt')

# three wind fins swept back off the spine edge (the -X edge), raked like gusts caught in steel,
# each rooted along the edge so it grows out of the blade
for k, t in enumerate((0.2, 0.38, 0.56)):
    z = Z0 + (Z1 - Z0) * t
    x0 = -half_w(t) + 0.02
    sc = 1.0 - 0.14 * k
    fin = [(0.0, 0.065), (-0.045, 0.045), (-0.095, -0.005), (-0.14, -0.1), (-0.105, -0.08),
           (-0.068, -0.07), (-0.03, -0.075), (0.0, -0.07)]
    pts = [(x0 + x * sc, z + zz * sc) for x, zz in fin]
    F.plate(list(reversed(pts)), 0.0, 0.018, 'silver', 'silver_dark')
    # a lit line down the fin's leading edge
    lead = [(x0 + x * sc * 0.92, z + zz * sc * 0.92 - 0.012) for x, zz in fin[:4]]
    lead += [(x0 + x * sc * 0.72, z + zz * sc * 0.72 - 0.012) for x, zz in reversed(fin[1:4])]
    F.plate(list(reversed(lead)), 0.0, 0.021, 'edge', 'edge')

# the ricasso collar
F.loft([F.ring(0.2, 0.1, 0.04, 8, rot=math.pi / 8), F.ring(0.26, 0.085, 0.036, 8, rot=math.pi / 8),
        F.ring(0.28, 0.07, 0.03, 8, rot=math.pi / 8)], 'silver', mats=['silver', 'silver_dark'])

# the guard: an open silver halo round the storm-eye, two gale vanes swept back from it
GZ = 0.1
F.torus((0, 0, GZ), (0, 1, 0), 0.135, 0.022, 'silver', seg=28, sides=8)
F.torus((0, 0, GZ), (0, 1, 0), 0.105, 0.012, 'silver_dark', seg=24, sides=6)
for side in (1, -1):
    F.gem((0, side * 0.018, GZ), 0.09, 0.05, 'storm', sides=12, axis=(0, -side, 0), crown=0.5)
    F.gem((0, side * 0.03, GZ), 0.036, 0.016, 'bolt_hot', sides=8, axis=(0, -side, 0), crown=0.9)
# spokes: the halo hangs on the ricasso and the grip
F.path_tube([(0, 0, 0.2), (0, 0, GZ + 0.135)], 0.02, 'silver', sides=6)
F.path_tube([(0, 0, GZ - 0.135), (0, 0, 0.0)], 0.022, 'silver', sides=6)
for s in (1, -1):
    # a gale vane: three feathered gusts swept back from the halo toward the pommel
    vane = [(0.12, 0.04), (0.2, 0.08), (0.29, 0.11), (0.38, 0.1), (0.45, 0.05), (0.47, -0.01),
            (0.42, 0.01), (0.39, -0.05), (0.33, -0.1), (0.36, -0.03), (0.3, -0.02), (0.27, -0.09),
            (0.21, -0.14), (0.23, -0.06), (0.17, -0.04), (0.13, -0.05)]
    pts = [(s * x, GZ + z) for x, z in vane]
    if s < 0:
        pts = list(reversed(pts))
    F.plate(pts, 0.0, 0.03, 'silver', 'silver_dark')
    inner = [(s * (0.14 + (x - 0.14) * 0.86), GZ + z * 0.55 + 0.012) for x, z in vane[1:5]]
    inner += [(s * (0.14 + (x - 0.14) * 0.7), GZ + z * 0.3 + 0.006) for x, z in reversed(vane[1:5])]
    if s < 0:
        inner = list(reversed(inner))
    F.plate(inner, 0.0, 0.034, 'edge', 'edge')
    # a splinter of the blade hovering free beside the halo (the floating part): a curved crescent
    cres = []
    for k in range(9):
        t = k / 8
        cres.append((s * (0.2 + 0.06 * math.sin(t * math.pi)), GZ + 0.18 + 0.26 * t))
    for k in range(8, -1, -1):
        t = k / 8
        cres.append((s * (0.2 + 0.06 * math.sin(t * math.pi) - 0.035 * math.sin(t * math.pi) ** 0.6), GZ + 0.18 + 0.26 * t))
    if s > 0:
        cres = list(reversed(cres))
    F.plate(cres, 0.0, 0.014, 'edge', 'silver')

# grip and pommel: storm-blue leather under silver wire, a small halo round a second eye
F.loft([F.ring(-0.27, 0.031, 0.029, 10), F.ring(0.0, 0.029, 0.027, 10)], 'leather', smooth=True)
for k in range(7):
    F.torus((0, 0, -0.25 + k * 0.035), (0.3, 0, 1), 0.031, 0.0055, 'silver_dark', seg=12, sides=5)
F.ring_band(0.0, 0.036, 0.034, 0.025, 'silver', sides=10, flare=0.1)
F.ring_band(-0.28, 0.038, 0.036, 0.025, 'silver', sides=10, flare=0.1)
F.torus((0, 0, -0.33), (0, 1, 0), 0.045, 0.011, 'silver', seg=16, sides=6)
for side in (1, -1):
    F.gem((0, side * 0.008, -0.33), 0.032, 0.016, 'storm', sides=8, axis=(0, -side, 0), crown=0.6)
F.shard((0, 0, -0.375), (0, 0, -0.39), 0.012, 'silver', sides=6)

F.finish(OUT, BLEND)
