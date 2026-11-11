"""Seamcaller: the Hammer Council's two-handed maul (Smith's Heart).

A great head hewn from one block of banded quarry stone, its ends flared into octagonal striking
faces rimmed in heavy gold round a burning amber boss. Gold bands gird the block and sweep up into
two crest wings over the crown, rune glyphs cut into both cheeks burn gold, a cluster of amber
seam-crystal sprouts from the crown with a splinter of it hanging free above, and the basalt haft
is bound in gold, runed along its upper reach, with a wrapped grip and a stone-knuckle pommel.

Gold runes and amber crystal sit inside the skin's emissive window (hue 30 to 55, saturation
>= 0.8, lightness >= 0.55); the gold metal is kept darker and greyer so it stays metal.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_seamcaller.py -- public/models/weapons/seamcaller_maul.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from heart_kit import HeartForge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = HeartForge('seamcaller_maul', {
    'stone': ((0.56, 0.42, 0.27), 0.86, 0.0),
    'stone_dark': ((0.32, 0.23, 0.15), 0.9, 0.0),
    'stone_pale': ((0.7, 0.56, 0.38), 0.8, 0.0),
    'gold': ((0.78, 0.5, 0.1), 0.34, 0.65),
    'gold_dark': ((0.38, 0.22, 0.06), 0.42, 0.65),
    'basalt': ((0.20, 0.17, 0.155), 0.7, 0.0),
    'leather': ((0.36, 0.18, 0.08), 0.75, 0.0),
    'leather_dark': ((0.19, 0.09, 0.045), 0.8, 0.0),
    'rune': ((1.0, 0.82, 0.32), 0.5, 0.0),
    'amber': ((1.0, 0.62, 0.14), 0.35, 0.0),
    'amber_hot': ((1.0, 0.92, 0.58), 0.35, 0.0),
}, glow=('rune', 'amber'), no_bump=('gold', 'leather'))

HZ = 1.02          # head centre height
HX = 0.34          # half length of the block (to the striking faces)
HY, HH = 0.2, 0.25  # half depth, half height of the block
OCT = [2 * math.pi * k / 8 + math.pi / 8 for k in range(8)]


def x_rings(s, stations):
    """Octagonal rings round the X axis at (x, radius) stations, wound outward along s."""
    rings = [[Vector((s * x, math.cos(t) * r * 0.9, HZ + math.sin(t) * r)) for t in OCT]
             for x, r in stations]
    return [list(reversed(rg)) for rg in rings] if s < 0 else rings


# -- the head -------------------------------------------------------------------------------
F.block((0, 0, HZ), (2 * HX, 2 * HY, 2 * HH), 'stone', bevel=0.05, segs=2)
# quarry strata: darker courses banding the block, a little proud
for dz in (-0.12, 0.13):
    F.block((0, 0, HZ + dz), (2 * HX - 0.06, 2 * HY + 0.012, 0.03), 'stone_dark', bevel=0.008)

for s in (1, -1):
    # the striking end: a stepped octagonal stone flare
    F.loft(x_rings(s, [(HX - 0.03, 0.25), (HX + 0.03, 0.29), (HX + 0.1, 0.305), (HX + 0.14, 0.3),
                       (HX + 0.16, 0.27)]), 'stone_pale',
           mats=['stone_dark', 'stone_pale', 'stone_pale', 'stone_dark'])
    # heavy gold rim, inner bezel and the burning boss
    F.torus((s * (HX + 0.12), 0, HZ), (1, 0, 0), 0.296, 0.03, 'gold', seg=24, sides=6)
    F.torus((s * (HX + 0.165), 0, HZ), (1, 0, 0), 0.16, 0.022, 'gold', seg=20, sides=6)
    F.loft(x_rings(s, [(HX + 0.155, 0.15), (HX + 0.175, 0.13)]), 'gold_dark')
    F.gem((s * (HX + 0.17), 0, HZ), 0.13, 0.06, 'amber', sides=8, axis=(-s, 0, 0), crown=0.55)
    F.gem((s * (HX + 0.19), 0, HZ), 0.055, 0.03, 'amber_hot', sides=8, axis=(-s, 0, 0), crown=0.9)
    # a gold cross-bracket over the boss, four arms to the rim
    for k in range(4):
        a = k * math.pi / 2
        d = Vector((0, math.cos(a), math.sin(a)))
        F.path_tube([Vector((s * (HX + 0.175), 0, HZ)) + d * 0.12, Vector((s * (HX + 0.165), 0, HZ)) + d * 0.2,
                     Vector((s * (HX + 0.13), 0, HZ)) + d * 0.29], [0.022, 0.02, 0.016], 'gold', sides=6)
    # eight gold studs on the rim
    for k in range(8):
        a = OCT[k]
        F.rock((s * (HX + 0.13), math.cos(a) * 0.27, HZ + math.sin(a) * 0.3), 0.024, 'gold', 40 + k,
               rough=0.04, subdiv=1)
    # the gold band girding the block near each end
    F.block((s * (HX - 0.075), 0, HZ), (0.075, 2 * HY + 0.04, 2 * HH + 0.04), 'gold', bevel=0.012)
    F.block((s * (HX - 0.075), 0, HZ), (0.095, 2 * HY + 0.012, 2 * HH + 0.012), 'gold_dark', bevel=0.004)
    # the crest wing: the band sweeps up over the crown in a gold blade that curls outward
    wing = [(0.0, 0.0), (0.05, 0.0), (0.075, 0.07), (0.09, 0.16), (0.13, 0.24), (0.2, 0.3),
            (0.17, 0.32), (0.1, 0.27), (0.04, 0.2), (0.0, 0.11), (-0.02, 0.05)]
    pts = [(s * (HX - 0.12 + x * 1.35), HZ + HH - 0.02 + z * 1.3) for x, z in wing]
    if s < 0:
        pts = list(reversed(pts))
    F.plate(pts, 0.0, 0.075, 'gold', 'gold_dark')
    # a stone keel down the middle of each wing, so it reads from the side as well as the front
    keel = [(s * (HX - 0.12 + x * 1.2), HZ + HH - 0.01 + z * 1.15) for x, z in wing[1:8]]
    F.path_tube([(x, 0, z) for x, z in keel], [0.03, 0.03, 0.026, 0.022, 0.016, 0.01, 0.004], 'gold_dark', sides=6)
    # and a rune burning in each wing
    F.glyph((s * (HX - 0.06), 0.039, HZ + HH + 0.15), (1, 0, 0), (0, 0, 1), 0.07, 'rune', 500 + (s > 0),
            lift=0.002, normal=(0, 1, 0), width=0.2)
    F.glyph((s * (HX - 0.06), -0.039, HZ + HH + 0.15), (1, 0, 0), (0, 0, 1), 0.07, 'rune', 502 + (s > 0),
            lift=0.002, normal=(0, -1, 0), width=0.2)
    # a short gold spike under each band
    F.shard((s * (HX - 0.075), 0, HZ - HH - 0.01), (s * (HX - 0.04), 0, HZ - HH - 0.13), 0.035, 'gold',
            sides=6)

# rune glyphs cut into both cheeks between the bands, in a gold frame
for side in (1, -1):
    yf = side * (HY + 0.002)
    for k, x in enumerate((-0.13, 0.0, 0.13)):
        F.glyph((x, yf, HZ + 0.005), (1, 0, 0), (0, 0, 1), 0.115, 'rune', 100 + k + (0 if side > 0 else 7),
                lift=0.005, normal=(0, side, 0), width=0.2)
    F.block((0, yf, HZ + 0.1), (0.44, 0.02, 0.022), 'gold', bevel=0.005)
    F.block((0, yf, HZ - 0.09), (0.44, 0.02, 0.022), 'gold', bevel=0.005)

# hewn chips: knocked-off chunks along the crown and lower edges so the block reads quarried
for k, (x, y, z) in enumerate([(0.14, 0.17, 0.22), (-0.16, -0.17, 0.21), (0.05, -0.18, -0.23),
                               (-0.08, 0.18, -0.22), (0.17, -0.12, -0.23), (-0.18, 0.12, 0.23)]):
    F.rock((x, y, HZ + z), 0.055, 'stone_dark' if k % 2 else 'stone', 7 + k, squash=(1.3, 0.8, 0.7),
           rough=0.32)

# the crown: a gold socket with amber seam-crystal sprouting from it
F.loft([F.ring(HZ + HH - 0.01, 0.12, 0.1, 10), F.ring(HZ + HH + 0.05, 0.135, 0.11, 10),
        F.ring(HZ + HH + 0.075, 0.11, 0.09, 10)], 'gold', mats=['gold_dark', 'gold'])
for k, (base, tip, r) in enumerate([
        ((0, 0, HZ + HH + 0.05), (0.0, 0.0, HZ + HH + 0.4), 0.065),
        ((0.05, 0.02, HZ + HH + 0.05), (0.17, 0.05, HZ + HH + 0.27), 0.04),
        ((-0.05, -0.02, HZ + HH + 0.05), (-0.18, -0.04, HZ + HH + 0.29), 0.042),
        ((0.02, -0.05, HZ + HH + 0.05), (0.07, -0.16, HZ + HH + 0.23), 0.034),
        ((-0.02, 0.05, HZ + HH + 0.05), (-0.06, 0.16, HZ + HH + 0.24), 0.032)]):
    F.crystal(base, tip, r, 'amber', sides=6, seed=k, mats=['amber', 'amber_hot'])
# a splinter of the seam hanging free above the crown (the head's floating part): a double point
F.crystal((0, 0, HZ + HH + 0.55), (0, 0, HZ + HH + 0.72), 0.045, 'amber', sides=6, seed=9,
          mats=['amber', 'amber_hot'])
F.crystal((0, 0, HZ + HH + 0.55), (0, 0, HZ + HH + 0.47), 0.045, 'amber', sides=6, seed=9,
          mats=['amber', 'amber_hot'])

# underneath: a gold socket where the haft enters, with langets running down it
F.loft([F.ring(HZ - HH + 0.02, 0.12, 0.1, 8, rot=math.pi / 8),
        F.ring(HZ - HH - 0.06, 0.09, 0.08, 8, rot=math.pi / 8),
        F.ring(HZ - HH - 0.13, 0.06, 0.06, 8, rot=math.pi / 8)], 'gold', mats=['gold', 'gold_dark'])
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    d = Vector((math.cos(a), math.sin(a), 0))
    F.path_tube([d * 0.055 + Vector((0, 0, HZ - HH - 0.08)), d * 0.062 + Vector((0, 0, HZ - HH - 0.24)),
                 d * 0.052 + Vector((0, 0, HZ - HH - 0.4)), d * 0.046 + Vector((0, 0, HZ - HH - 0.47))],
                [0.017, 0.015, 0.011, 0.003], 'gold', sides=5, flat=0.55)

# -- the haft -------------------------------------------------------------------------------
F.loft([F.ring(-0.5, 0.044, 0.044, 8, rot=math.pi / 8), F.ring(HZ - HH - 0.1, 0.042, 0.042, 8, rot=math.pi / 8)],
       'basalt')
for z in (0.27, 0.47):
    F.ring_band(z, 0.052, 0.052, 0.035, 'gold', sides=10, flare=0.1)
# runes up the upper haft
for k, z in enumerate((0.37, 0.57)):
    for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
        n = Vector((math.cos(a), math.sin(a), 0))
        F.glyph(Vector((0, 0, z)) + n * 0.044, Vector((-math.sin(a), math.cos(a), 0)), (0, 0, 1), 0.05,
                'rune', 300 + k * 4 + int(a * 2), lift=0.002, normal=n, width=0.22)
# the grip: wrapped leather between gold collars
F.loft([F.ring(-0.44, 0.05, 0.05, 10), F.ring(0.18, 0.048, 0.048, 10)], 'leather', smooth=True)
for k in range(15):
    F.torus((0, 0, -0.42 + k * 0.042), (0.3, 0, 1), 0.05, 0.0075, 'leather_dark', seg=12, sides=5)
F.ring_band(0.195, 0.058, 0.058, 0.04, 'gold', sides=10, flare=0.12)
F.ring_band(-0.455, 0.058, 0.058, 0.04, 'gold', sides=10, flare=0.12)
# the pommel: a gold-capped knuckle of stone round two amber eyes
F.loft([F.ring(-0.48, 0.052, 0.052, 8), F.ring(-0.52, 0.08, 0.08, 8), F.ring(-0.56, 0.07, 0.07, 8)],
       'gold', mats=['gold', 'gold_dark'])
F.rock((0, 0, -0.61), 0.08, 'stone', 77, squash=(1, 1, 0.9), rough=0.2)
for s in (1, -1):
    F.gem((s * 0.07, 0, -0.61), 0.034, 0.02, 'amber', sides=6, axis=(-s, 0, 0), crown=0.6)
F.shard((0, 0, -0.66), (0, 0, -0.74), 0.04, 'gold', sides=6)

F.finish(OUT, BLEND)
