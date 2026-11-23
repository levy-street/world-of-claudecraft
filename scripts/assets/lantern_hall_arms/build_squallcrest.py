"""Squallcrest: Lantern Hall's sea-storm sword appearance.

A long, ornate blade of sea-blue steel whose edges run bright as a breaking wave, a channel of
storm-light up its heart with a forked bolt sealed in it, a gilt wave cresting over the
ricasso, a dorsal fin sweeping back down one edge, a crossguard of two gilt breakers curling over a storm pearl
with fins rising between them, a navy grip in gilt wire and a gilt sea-shell pommel.

The storm is painted inside the skin's emissive window (hue 180 to 215, saturation >= 0.6,
lightness >= 0.45): the channel, the bolt, the pearl and the bright edges. The gilt and the
blue steel stay outside it.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_arms/build_squallcrest.py -- public/models/weapons/squallcrest.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_kit import Forge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = Forge('squallcrest', {
    'steel': ((0.36, 0.47, 0.60), 0.28, 0.9),
    'edge': ((0.80, 0.93, 1.0), 0.18, 0.6),
    'storm': ((0.30, 0.82, 1.0), 0.4, 0.0),
    'bolt': ((0.72, 0.96, 1.0), 0.4, 0.0),
    'gold': ((0.66, 0.46, 0.14), 0.26, 1.0),
    'gold_dark': ((0.40, 0.26, 0.07), 0.36, 1.0),
    'fin': ((0.12, 0.30, 0.55), 0.3, 0.7),
    'navy': ((0.03, 0.07, 0.20), 0.7, 0.0),
}, no_grain=('storm', 'bolt', 'edge'), no_bump=('storm', 'bolt', 'navy'))

Z0, Z1 = 0.30, 1.62


def half_w(t):
    # a slim waist above the guard, a swell in the upper third like a wave about to break,
    # then a long point
    w = 0.1 + 0.035 * math.sin(math.pi * min(1.0, t / 0.8)) ** 1.6
    if t > 0.78:
        w *= max(0.0, (1 - t) / 0.22) ** 0.7
    return w


def thick(t):
    return 0.03 * (1 - 0.7 * t)


F.blade(Z0, Z1, half_w, thick, 44, 'edge', 'steel')


# the storm channel: a glowing fuller with a forked bolt sealed in it, both faces
def channel(side):
    n = 24
    zs = [Z0 + (Z1 - Z0) * (0.1 + 0.66 * k / n) for k in range(n + 1)]

    def t_of(z):
        return (z - Z0) / (Z1 - Z0)

    def lift(z, extra):
        return side * (thick(t_of(z)) + extra)

    for za, zb in zip(zs, zs[1:]):
        wa = 0.032 * (1 - 0.5 * t_of(za))
        wb = 0.032 * (1 - 0.5 * t_of(zb))
        for scale, mat, extra in ((1.35, 'gold_dark', 0.0008), (1.0, 'storm', 0.0016)):
            q = [F.V((-wa * scale, lift(za, extra), za)), F.V((wa * scale, lift(za, extra), za)),
                 F.V((wb * scale, lift(zb, extra), zb)), F.V((-wb * scale, lift(zb, extra), zb))]
            F.face(q if side > 0 else list(reversed(q)), mat)
    # the bolt: a zigzag of white-cyan down the channel
    pts = []
    for k in range(n + 1):
        x = (0.017 if k % 2 else -0.017) * (1 - 0.5 * k / n)
        pts.append((x, zs[k]))
    for (xa, za), (xb, zb) in zip(pts, pts[1:]):
        w = 0.0045
        q = [F.V((xa - w, lift(za, 0.0026), za)), F.V((xa + w, lift(za, 0.0026), za)),
             F.V((xb + w, lift(zb, 0.0026), zb)), F.V((xb - w, lift(zb, 0.0026), zb))]
        F.face(q if side > 0 else list(reversed(q)), 'bolt')


channel(1)
channel(-1)


# the langet: a gilt wave cresting over the blade root, three crests, the middle one highest
CREST = [(0.15, 0.26), (0.165, 0.33), (0.15, 0.39), (0.115, 0.425), (0.08, 0.42), (0.105, 0.39),
         (0.1, 0.36), (0.07, 0.37), (0.045, 0.43), (0.025, 0.5), (0.0, 0.58)]
outline = CREST + [(-x, z) for x, z in reversed(CREST[:-1])]
outline = list(reversed(outline))
F.plate(outline, 0.0, 0.074, 'gold', 'gold_dark')
# a storm stone set in the langet's face, both sides
for side in (1, -1):
    F.gem((0, side * 0.035, 0.35), 0.034, 0.02, 'storm', sides=8, axis=(0, -side, 0), crown=0.7)


# fins sweeping back down the right edge above the guard, like a fish's spines
def dorsal():
    """One fin along the right edge: a membrane between four spines, its scallops sweeping back
    toward the guard like a fish's dorsal fin."""
    za, zb = 0.46, 0.92
    base = []
    for k in range(13):
        z = zb - (zb - za) * k / 12
        base.append((half_w((z - Z0) / (Z1 - Z0)) - 0.012, z))
    outer = []
    spines = 4
    for k in range(spines):
        z_top = zb - (zb - za) * k / spines
        z_bot = zb - (zb - za) * (k + 1) / spines
        reach = 0.1 - 0.012 * k
        w_top = half_w((z_top - Z0) / (Z1 - Z0))
        w_bot = half_w((z_bot - Z0) / (Z1 - Z0))
        # each spine juts out and back down, the membrane scallops in toward the next
        outer.append((w_top + reach, z_top - 0.05))
        outer.append((w_top + reach * 0.75, z_top - 0.075))
        outer.append((w_bot + reach * 0.25, z_bot + 0.02))
    pts = base + list(reversed(outer))
    F.plate(pts, 0.0, 0.018, 'fin', 'gold')
    # the spines themselves, gilt rods along each fin ray
    for k in range(spines):
        z_top = zb - (zb - za) * k / spines
        reach = 0.1 - 0.012 * k
        w_top = half_w((z_top - Z0) / (Z1 - Z0))
        F.tube((w_top - 0.01, 0, z_top), (w_top + reach, 0, z_top - 0.05), 0.008, 'gold', sides=5, r2=0.003)


dorsal()


# the guard: two gilt breakers curling up and over, fins rising between, a storm pearl in the heart
def breaker(sgn):
    pts, radii = [], []
    n = 28
    for k in range(n + 1):
        t = k / n
        if t < 0.55:
            u = t / 0.55
            x = 0.06 + 0.3 * u
            z = 0.16 + 0.05 * math.sin(u * math.pi * 0.5) - 0.03 * u
        else:
            u = (t - 0.55) / 0.45
            ang = -math.pi * 0.5 + u * math.pi * 1.55
            r = 0.11 * (1 - 0.6 * u)
            x = 0.36 + math.cos(ang) * r
            z = 0.29 + math.sin(ang) * r
        pts.append((sgn * x, 0, z))
        radii.append(0.06 * (1 - 0.6 * t) + 0.012)
    F.path_tube(pts, radii, 'gold', sides=10, flat=0.75)
    # the foam: a fan of three short fins rising from the breaker's back
    for k, (x, z, h) in enumerate(((0.15, 0.2, 0.2), (0.22, 0.2, 0.16), (0.29, 0.2, 0.12))):
        outline = [(x - 0.035, z), (x + 0.03, z), (x + 0.06, z + h * 0.6), (x + 0.05, z + h),
                   (x + 0.0, z + h * 0.5)]
        pts2 = [(sgn * px, pz) for px, pz in outline]
        if sgn < 0:
            pts2 = list(reversed(pts2))
        F.plate(pts2, 0.0, 0.014, 'fin', 'gold_dark')


breaker(1)
breaker(-1)
F.path_tube([(0, -0.05, 0.16), (0, -0.044, 0.16), (0, 0.044, 0.16), (0, 0.05, 0.16)],
            [0.07, 0.085, 0.085, 0.07], 'gold_dark', sides=16, smooth=True)
F.loft([F.ring(0.22, 0.11, 0.045, 8, rot=math.pi / 8), F.ring(0.3, 0.1, 0.04, 8, rot=math.pi / 8)], 'gold')
for side in (1, -1):
    F.torus((0, side * 0.044, 0.16), (0, 1, 0), 0.072, 0.012, 'gold', seg=18, sides=6)
    F.gem((0, side * 0.04, 0.16), 0.06, 0.05, 'storm', sides=12, axis=(0, -side, 0), crown=0.6)
    F.gem((0, side * 0.055, 0.16), 0.024, 0.012, 'bolt', sides=8, axis=(0, -side, 0), crown=0.9)

# grip: navy wrap under a gilt wire spiral
F.loft([F.ring(-0.29, 0.032, 0.03, 10), F.ring(0.08, 0.03, 0.028, 10)], 'navy', smooth=True)
spiral = [(math.cos(k * 0.5) * 0.034, math.sin(k * 0.5) * 0.032, -0.28 + k * 0.0075) for k in range(46)]
F.path_tube(spiral, 0.0045, 'gold', sides=5)
F.loft([F.ring(0.06, 0.045, 0.042, 10), F.ring(0.09, 0.05, 0.046, 10)], 'gold')
F.loft([F.ring(-0.31, 0.042, 0.04, 10), F.ring(-0.285, 0.038, 0.036, 10)], 'gold')


# pommel: a gilt sea shell, a spiral coiling down to a point
def shell():
    pts, radii = [], []
    n = 30
    for k in range(n + 1):
        t = k / n
        ang = t * math.pi * 3.2
        r = 0.05 * (1 - 0.8 * t)
        pts.append((math.cos(ang) * r * 0.7, math.sin(ang) * r * 0.7, -0.32 - 0.09 * t))
        radii.append(0.058 * (1 - 0.85 * t) + 0.004)
    F.path_tube(pts, radii, 'gold', sides=8, mats=['gold' if k % 3 else 'gold_dark' for k in range(n)])


shell()
F.finish(OUT, BLEND)
