"""The Duskwick Staff: Lantern Hall's shadow staff appearance.

A shaft of two black-wood strands twisted round each other, bound in dark iron, an iron spike at
its foot, and at its crown a tall open iron lantern whose wick burns with a violet dusk-flame: a
cage of six iron ribs, a pair of horns curling up from its roof round a
spire, and short chains swinging from its floor.

The dusk-flame is painted inside the skin's emissive window (hue 260 to 300, saturation >= 0.6,
lightness >= 0.45): the flame, its hot heart, the studs and the shaft's seam. The
iron and the wood stay far below it.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_arms/build_duskwick_staff.py -- public/models/weapons/duskwick_staff.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_kit import Forge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = Forge('duskwick_staff', {
    'ebony': ((0.10, 0.08, 0.11), 0.55, 0.0),
    'ebony_dark': ((0.05, 0.04, 0.06), 0.6, 0.0),
    'iron': ((0.32, 0.30, 0.36), 0.34, 0.95),
    'iron_dark': ((0.11, 0.10, 0.13), 0.48, 0.9),
    'flame': ((0.62, 0.28, 1.0), 0.5, 0.0),
    'flame_hot': ((0.84, 0.68, 1.0), 0.5, 0.0),
}, no_grain=('flame',), no_bump=('flame',))

# the shaft: two strands twisting round each other, a violet seam glowing in the gap
for phase in (0.0, math.pi):
    pts = [(math.cos(phase + k * 0.3) * 0.018, math.sin(phase + k * 0.3) * 0.018, -0.84 + k * 0.0245)
           for k in range(71)]
    F.path_tube(pts, 0.024, 'ebony', sides=8)
F.loft([F.ring(-0.84, 0.012, 0.012, 6), F.ring(0.88, 0.012, 0.012, 6)], 'flame')
# iron bands, each with a violet stud
for z in (-0.74, -0.1, 0.12, 0.6):
    F.loft([F.ring(z - 0.025, 0.046, 0.046, 8), F.ring(z, 0.052, 0.052, 8), F.ring(z + 0.025, 0.046, 0.046, 8)],
           'iron', mats=['iron', 'iron_dark'])
    for k in range(4):
        a = 2 * math.pi * k / 4
        F.gem((math.cos(a) * 0.05, math.sin(a) * 0.05, z), 0.01, 0.006, 'flame', sides=5,
              axis=(-math.cos(a), -math.sin(a), 0))
# the foot: an iron spike
F.loft([F.ring(-0.86, 0.04, 0.04, 6), F.ring(-0.83, 0.036, 0.036, 6)], 'iron')
F.shard((0, 0, -0.86), (0, 0, -0.91), 0.035, 'iron_dark', sides=6, taper=0.9)

# the lantern: a floor, an open cage of six ribs (the flame shows between them), a pyramid roof
L0, L1 = 0.93, 1.25
R = 0.14
F.loft([F.ring(0.86, 0.04, 0.04, 6, rot=math.pi / 6), F.ring(0.92, 0.09, 0.09, 6, rot=math.pi / 6),
        F.ring(L0, R + 0.02, R + 0.02, 6, rot=math.pi / 6)], 'iron', mats=['iron', 'iron_dark'])
# the cage ribs at the corners, and a mid-band
for k in range(6):
    a = 2 * math.pi * k / 6 + math.pi / 6
    F.tube((math.cos(a) * (R + 0.006), math.sin(a) * (R + 0.006), L0),
           (math.cos(a) * (R + 0.006), math.sin(a) * (R + 0.006), L1), 0.011, 'iron', sides=5)
F.loft([F.ring(L0 + 0.12, R + 0.012, R + 0.012, 6, rot=math.pi / 6),
        F.ring(L0 + 0.14, R + 0.012, R + 0.012, 6, rot=math.pi / 6)], 'iron_dark', cap0=False, cap1=False)
# roof and finial spire
F.loft([F.ring(L1, R + 0.03, R + 0.03, 6, rot=math.pi / 6), F.ring(L1 + 0.02, R + 0.03, R + 0.03, 6, rot=math.pi / 6),
        F.ring(L1 + 0.1, 0.035, 0.035, 6, rot=math.pi / 6)], 'iron', mats=['iron_dark', 'iron'])
F.shard((0, 0, L1 + 0.09), (0, 0, 1.45), 0.025, 'iron_dark', sides=6, taper=0.7)
F.gem((0, 0, L1 + 0.15), 0.022, 0.03, 'flame_hot', sides=6, axis=(0, 0, 1), crown=1.0)

# the horns: a pair rising from the roof's eaves, curling out and back in like a crescent moon
for sgn in (1, -1):
    pts, radii = [], []
    n = 20
    for k in range(n + 1):
        u = k / n
        ang = math.pi * 0.95 * u
        x = sgn * (R + 0.02 + 0.17 * math.sin(ang) - 0.06 * u)
        z = L1 - 0.03 + 0.2 * (1 - math.cos(ang)) * 0.5 + 0.06 * u
        pts.append((x, 0, z))
        radii.append(0.034 * (1 - 0.85 * u) + 0.004)
    F.path_tube(pts, radii, 'iron', sides=7, mats=['iron' if k % 4 else 'iron_dark' for k in range(n)])

# the dusk-flame on its wick: tongues of violet round a white-violet heart
F.tube((0, 0, L0), (0, 0, L0 + 0.04), 0.008, 'iron_dark', sides=5)
F.shard((0, 0, L0 + 0.03), (0, 0, L0 + 0.27), 0.075, 'flame', sides=7, taper=0.9, twist=0.4)
F.shard((0, 0, L0 + 0.045), (0, 0, L0 + 0.19), 0.03, 'flame_hot', sides=6, taper=1.0)
for k in range(3):
    a = 2 * math.pi * k / 3
    d = Vector((math.cos(a), math.sin(a), 0))
    base = Vector((0, 0, L0 + 0.05)) + d * 0.03
    F.path_tube([base, base + d * 0.05 + Vector((0, 0, 0.08)), base + d * 0.025 + Vector((0, 0, 0.16))],
                [0.03, 0.02, 0.003], 'flame', sides=5)

# chains swinging from the lantern's floor: three short strands of iron links
for k in range(3):
    a = 2 * math.pi * k / 3 + math.pi / 3
    x, y = math.cos(a) * 0.1, math.sin(a) * 0.1
    for j in range(4):
        axis = (math.cos(a), math.sin(a), 0) if j % 2 else (-math.sin(a), math.cos(a), 0)
        F.torus((x, y, 0.9 - j * 0.032), axis, 0.014, 0.004, 'iron', seg=8, sides=4)
    F.gem((x, y, 0.9 - 4 * 0.032), 0.014, 0.03, 'flame', sides=5)

F.finish(OUT, BLEND)
