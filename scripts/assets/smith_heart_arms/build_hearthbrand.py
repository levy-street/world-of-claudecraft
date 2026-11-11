"""Hearthbrand: the Guardian of the Heat's molten blade (Smith's Heart).

A broad blade of cooled magma crust whose edges still run molten, cracked across both faces by a
branching net of ember veins, its spine broken into jagged obsidian teeth. The guard is a block of
black iron swept up into two horns dripping with melt round a magma heart; the grip is charred
leather between iron collars, and the pommel a cooling droplet of magma held in iron claws.

Melt and embers sit inside the skin's emissive window (hue 8 to 52, saturation >= 0.7,
lightness >= 0.45); the crust and iron are kept near-black, the obsidian unsaturated.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_hearthbrand.py -- public/models/weapons/hearthbrand.glb [out.blend]
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from heart_kit import HeartForge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = HeartForge('hearthbrand', {
    'crust': ((0.15, 0.09, 0.075), 0.85, 0.0),
    'crust_dark': ((0.075, 0.05, 0.045), 0.9, 0.0),
    'obsidian': ((0.07, 0.06, 0.075), 0.15, 0.3),
    'iron': ((0.24, 0.21, 0.2), 0.45, 0.9),
    'iron_dark': ((0.1, 0.09, 0.09), 0.55, 0.9),
    'leather': ((0.2, 0.08, 0.05), 0.75, 0.0),
    'leather_dark': ((0.09, 0.035, 0.025), 0.8, 0.0),
    'melt': ((1.0, 0.42, 0.06), 0.4, 0.0),
    'melt_hot': ((1.0, 0.84, 0.4), 0.4, 0.0),
    'ember': ((1.0, 0.3, 0.04), 0.5, 0.0),
}, glow=('melt', 'ember'), no_bump=('leather',))

Z0, Z1 = 0.24, 1.62


def half_w(t):
    # a broad blade that swells a little past the ricasso and ends in a clipped point
    w = 0.11 + 0.03 * math.sin(math.pi * min(1.0, t / 0.75))
    if t > 0.8:
        w *= max(0.0, (1 - t) / 0.2) ** 0.65
    return w


def right_w(t):
    # the spine side (+X) runs straight and is clipped harder toward the point
    w = 0.11 + 0.022 * math.sin(math.pi * min(1.0, t / 0.75))
    if t > 0.72:
        w *= max(0.0, (1 - t) / 0.28) ** 1.1
    return w


def thick(t):
    return 0.036 * (1 - 0.68 * t)


F.blade(Z0, Z1, half_w, thick, 56, 'melt', 'crust', right_w=right_w)


# the ember veins: a seam up the heart of each face that branches out toward both edges
def vein_strip(side, pts, w0, mat, extra):
    for (xa, za, wa), (xb, zb, wb) in zip(pts, pts[1:]):
        ta, tb = (za - Z0) / (Z1 - Z0), (zb - Z0) / (Z1 - Z0)
        la, lb = thick(ta) + 0.0016 + extra, thick(tb) + 0.0016 + extra
        q = [F.V((xa - w0 * wa, side * la, za)), F.V((xa + w0 * wa, side * la, za)),
             F.V((xb + w0 * wb, side * lb, zb)), F.V((xb - w0 * wb, side * lb, zb))]
        F.face(q if side > 0 else list(reversed(q)), mat)


for side in (1, -1):
    rng = random.Random(11 if side > 0 else 23)
    seam = []
    n = 30
    for k in range(n + 1):
        t = 0.04 + 0.74 * k / n
        x = 0.014 * math.sin(k * 2.3) + 0.009 * math.sin(k * 5.1 + 1)
        seam.append((x, Z0 + (Z1 - Z0) * t, 1 - 0.55 * t))
    vein_strip(side, seam, 0.016, 'ember', 0.0)
    vein_strip(side, seam, 0.006, 'melt_hot', 0.0011)
    # branches: crooked cracks that fork toward the edges
    for k in range(2, n - 2, 3):
        xa, za, _ = seam[k]
        t = (za - Z0) / (Z1 - Z0)
        d = 1 if (k // 3) % 2 else -1
        reach = (right_w(t) if d > 0 else half_w(t)) * rng.uniform(0.6, 0.92)
        pts = [(xa, za, 1.0)]
        steps = 4
        for j in range(1, steps + 1):
            f = j / steps
            pts.append((xa + d * reach * f, za + 0.05 * f + rng.uniform(-0.012, 0.012), 1 - 0.8 * f))
        vein_strip(side, pts, 0.008, 'ember', 0.0006)
        # a twig off the branch
        mx, mz, _ = pts[2]
        twig = [(mx, mz, 0.7), (mx + d * reach * 0.25, mz - 0.035, 0.25)]
        vein_strip(side, twig, 0.006, 'ember', 0.0006)

# the spine: jagged obsidian teeth along the +X edge
for k in range(7):
    t = 0.16 + k * 0.085
    z = Z0 + (Z1 - Z0) * t
    x = right_w(t)
    ln = 0.05 + 0.02 * (k % 2)
    F.shard((x - 0.012, 0, z - 0.02), (x + ln * 0.7, 0, z + ln), 0.022, 'obsidian', sides=4,
            mats=['obsidian', 'obsidian'])

# the ricasso: a block of black iron
F.loft([F.ring(0.2, 0.15, 0.055, 8, rot=math.pi / 8), F.ring(0.28, 0.135, 0.05, 8, rot=math.pi / 8),
        F.ring(0.31, 0.11, 0.042, 8, rot=math.pi / 8)], 'iron', mats=['iron', 'iron_dark'])

# the guard: an iron block swept into two horns dripping melt, round a magma heart
GZ = 0.13
F.block((0, 0, GZ), (0.2, 0.1, 0.12), 'iron', bevel=0.02)
for s in (1, -1):
    horn = [Vector((s * 0.08, 0, GZ)), Vector((s * 0.18, 0, GZ + 0.01)), Vector((s * 0.27, 0, GZ + 0.06)),
            Vector((s * 0.32, 0, GZ + 0.15)), Vector((s * 0.31, 0, GZ + 0.25)), Vector((s * 0.27, 0, GZ + 0.31))]
    F.path_tube(horn, [0.05, 0.048, 0.04, 0.03, 0.02, 0.006], 'iron', sides=8,
                mats=['iron', 'iron', 'iron_dark', 'iron_dark', 'obsidian'])
    # melt running in a groove along the horn's inner curve
    groove = [p + Vector((-s * 0.012, 0, 0.03)) for p in horn[1:5]]
    F.path_tube(groove, [0.016, 0.014, 0.011, 0.006], 'melt', sides=5)
    # drips of melt hanging off the horn
    for j, p in enumerate(horn[1:4]):
        F.crystal(p + Vector((0, 0, -0.04)), p + Vector((0, 0, -0.1 - 0.03 * j)), 0.012, 'melt', sides=5,
                  seed=80 + j, mats=['melt', 'melt_hot'])
for side in (1, -1):
    F.torus((0, side * 0.052, GZ), (0, 1, 0), 0.06, 0.013, 'iron_dark', seg=16, sides=6)
    F.gem((0, side * 0.05, GZ), 0.055, 0.04, 'ember', sides=10, axis=(0, -side, 0), crown=0.5)
    F.gem((0, side * 0.062, GZ), 0.024, 0.012, 'melt_hot', sides=8, axis=(0, -side, 0), crown=0.9)

# grip: charred leather between iron collars
F.loft([F.ring(-0.29, 0.034, 0.032, 10), F.ring(0.07, 0.031, 0.029, 10)], 'leather', smooth=True)
for k in range(9):
    F.torus((0, 0, -0.27 + k * 0.04), (0.28, 0, 1), 0.033, 0.006, 'leather_dark', seg=12, sides=5)
F.ring_band(0.06, 0.042, 0.04, 0.03, 'iron', sides=10, flare=0.12)
F.ring_band(-0.3, 0.044, 0.042, 0.03, 'iron', sides=10, flare=0.12)
# the pommel: a droplet of magma held in three iron claws
F.crystal((0, 0, -0.32), (0, 0, -0.395), 0.034, 'ember', sides=8, seed=5, mats=['ember', 'melt_hot'])
for k in range(3):
    a = 2 * math.pi * k / 3
    d = Vector((math.cos(a), math.sin(a), 0))
    F.path_tube([Vector((0, 0, -0.305)) + d * 0.02, Vector((0, 0, -0.33)) + d * 0.045,
                 Vector((0, 0, -0.37)) + d * 0.04, Vector((0, 0, -0.39)) + d * 0.018],
                [0.012, 0.011, 0.008, 0.003], 'iron', sides=5)

F.finish(OUT, BLEND)
