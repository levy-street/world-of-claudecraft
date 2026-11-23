"""Hearthbrand: Lantern Hall's fire sword appearance.

A broad flame-waved blade of blackened steel whose edges run forge-hot, a molten seam branching
up both faces, a crossguard of dark bronze swept up into twin tongues of flame round a burning
round stone, an oxblood grip between bronze bands and a pommel that ends in a flame of its own.

Fire is painted inside the skin's emissive window (hue 8 to 52, saturation >= 0.8, lightness
>= 0.5); the bronze is kept dark enough to stay metal.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_arms/build_hearthbrand.py -- public/models/weapons/hearthbrand.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_kit import Forge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = Forge('hearthbrand', {
    'char': ((0.15, 0.14, 0.15), 0.42, 0.85),
    'char_dark': ((0.08, 0.075, 0.08), 0.55, 0.8),
    'heat': ((1.0, 0.38, 0.06), 0.5, 0.0),
    'fire': ((1.0, 0.5, 0.1), 0.5, 0.0),
    'fire_hot': ((1.0, 0.86, 0.50), 0.5, 0.0),
    'bronze': ((0.50, 0.31, 0.13), 0.3, 1.0),
    'bronze_dark': ((0.22, 0.13, 0.06), 0.42, 1.0),
    'leather': ((0.26, 0.05, 0.04), 0.7, 0.0),
    'leather_dark': ((0.13, 0.025, 0.02), 0.75, 0.0),
}, no_grain=('heat', 'fire'), no_bump=('heat', 'fire', 'leather'))

Z0, Z1 = 0.25, 1.62
WAVES = 4.5


def base_w(t):
    w = 0.125 + 0.02 * math.sin(math.pi * min(1.0, t * 1.4))
    if t > 0.8:
        w *= max(0.0, (1 - t) / 0.2) ** 0.75
    return w


def half_w(t):
    # the flamberge wave: strongest mid-blade, calm at the ricasso and the point
    env = math.sin(math.pi * min(1.0, t / 0.86)) ** 0.7
    return base_w(t) + 0.024 * env * math.sin(t * WAVES * 2 * math.pi)


def right_w(t):
    env = math.sin(math.pi * min(1.0, t / 0.86)) ** 0.7
    return base_w(t) + 0.024 * env * math.sin(t * WAVES * 2 * math.pi + math.pi)


def thick(t):
    return 0.034 * (1 - 0.72 * t)


F.blade(Z0, Z1, half_w, thick, 56, 'heat', 'char', right_w=right_w)


# the molten seam: a jagged crack up the middle of each face with short branches off it
def seam(side):
    pts = []
    n = 26
    for k in range(n + 1):
        t = 0.06 + 0.72 * k / n
        x = 0.012 * math.sin(k * 2.7) + 0.008 * math.sin(k * 5.3)
        pts.append((x, Z0 + (Z1 - Z0) * t, t))

    def lift(t):
        return thick(t) + 0.0016

    for (xa, za, ta), (xb, zb, tb) in zip(pts, pts[1:]):
        for wa, mat, extra in ((0.016, 'fire', 0.0), (0.006, 'fire_hot', 0.0012)):
            wa_a = wa * (1 - 0.6 * ta)
            wa_b = wa * (1 - 0.6 * tb)
            q = [F.V((xa - wa_a, side * (lift(ta) + extra), za)), F.V((xa + wa_a, side * (lift(ta) + extra), za)),
                 F.V((xb + wa_b, side * (lift(tb) + extra), zb)), F.V((xb - wa_b, side * (lift(tb) + extra), zb))]
            F.face(q if side > 0 else list(reversed(q)), mat)
    # branches: little cracks running out toward the waves' crests
    for k in range(3, n - 2, 4):
        xa, za, ta = pts[k]
        dirx = 1 if k % 8 == 3 else -1
        xb = xa + dirx * base_w(ta) * 0.55
        zb = za + 0.05
        w = 0.005
        q = [F.V((xa, side * (lift(ta) + 0.0008), za - w)), F.V((xa, side * (lift(ta) + 0.0008), za + w)),
             F.V((xb, side * (lift(ta) + 0.0008), zb + w * 0.3)), F.V((xb, side * (lift(ta) + 0.0008), zb - w * 0.3))]
        F.face(q if side * dirx > 0 else list(reversed(q)), 'fire')


seam(1)
seam(-1)

# the ricasso: a dark bronze collar over the blade root, its face set with a flame mark
F.loft([F.ring(0.22, 0.15, 0.05, 8, rot=math.pi / 8), F.ring(0.3, 0.13, 0.045, 8, rot=math.pi / 8),
        F.ring(0.33, 0.1, 0.04, 8, rot=math.pi / 8)], 'bronze', mats=['bronze', 'bronze_dark'])


# the guard: twin tongues of flame each side, swept up from a round burning stone
def wing(sgn):
    # three tongues of flame licking up and out, the outermost the longest
    outline = [(0.07, 0.07), (0.16, 0.075), (0.26, 0.11), (0.35, 0.18), (0.42, 0.27), (0.47, 0.38),
               (0.48, 0.50), (0.42, 0.40), (0.37, 0.33), (0.36, 0.42), (0.33, 0.52), (0.30, 0.40),
               (0.26, 0.31), (0.24, 0.38), (0.21, 0.46), (0.19, 0.35), (0.14, 0.26), (0.07, 0.21)]
    pts = [(sgn * x, z) for x, z in outline]
    if sgn < 0:
        pts = list(reversed(pts))
    F.plate(pts, 0.0, 0.05, 'bronze', 'bronze_dark')
    # the fire inlaid in each tongue: the outline drawn in toward the wing's heart, a slightly
    # thicker plate so it shows through both faces and leaves a bronze rim
    cx, cz = 0.25, 0.2
    inner = [(cx + (x - cx) * 0.74, cz + (z - cz) * 0.74) for x, z in outline[1:-1]]
    ip = [(sgn * x, z) for x, z in inner]
    if sgn < 0:
        ip = list(reversed(ip))
    F.plate(ip, 0.0, 0.056, 'fire', 'fire')


wing(1)
wing(-1)
# the guard: a round bronze housing lying across the blade, the stone set in both faces
F.path_tube([(0, -0.052, 0.15), (0, -0.045, 0.15), (0, 0.045, 0.15), (0, 0.052, 0.15)],
            [0.085, 0.1, 0.1, 0.085], 'bronze_dark', sides=16, smooth=True)
F.loft([F.ring(0.04, 0.07, 0.05, 8, rot=math.pi / 8), F.ring(0.08, 0.06, 0.045, 8, rot=math.pi / 8)], 'bronze_dark')
for side in (1, -1):
    F.torus((0, side * 0.05, 0.15), (0, 1, 0), 0.085, 0.014, 'bronze', seg=18, sides=6)
    F.gem((0, side * 0.045, 0.15), 0.068, 0.05, 'fire', sides=12, axis=(0, -side, 0), crown=0.5)
    F.gem((0, side * 0.058, 0.15), 0.028, 0.012, 'fire_hot', sides=8, axis=(0, -side, 0), crown=0.9)

# grip and pommel: oxblood leather in a raised wrap, bronze bands, a burning finial
F.loft([F.ring(-0.29, 0.034, 0.032, 10), F.ring(0.07, 0.031, 0.029, 10)], 'leather', smooth=True)
for k in range(9):
    F.torus((0, 0, -0.27 + k * 0.04), (0.28, 0, 1), 0.033, 0.006, 'leather_dark', seg=12, sides=5)
F.loft([F.ring(0.045, 0.045, 0.043, 10), F.ring(0.075, 0.05, 0.047, 10)], 'bronze')
F.loft([F.ring(-0.3, 0.044, 0.042, 10), F.ring(-0.28, 0.04, 0.038, 10)], 'bronze')
F.loft([F.ring(-0.3, 0.04, 0.04, 8), F.ring(-0.32, 0.062, 0.062, 8), F.ring(-0.345, 0.055, 0.055, 8),
        F.ring(-0.36, 0.03, 0.03, 8)], 'bronze', mats=['bronze', 'bronze_dark', 'bronze'])
# the pommel's flame: three curling tongues round a hot core
F.shard((0, 0, -0.35), (0, 0, -0.395), 0.03, 'fire_hot', sides=6)
for k in range(3):
    a = 2 * math.pi * k / 3
    d = Vector((math.cos(a), math.sin(a), 0))
    pts = [Vector((0, 0, -0.34)) + d * 0.03, Vector((0, 0, -0.36)) + d * 0.055,
           Vector((0, 0, -0.385)) + d * 0.05, Vector((0, 0, -0.395)) + d * 0.025]
    F.path_tube(pts, [0.012, 0.011, 0.008, 0.003], 'fire', sides=5)

F.finish(OUT, BLEND)
