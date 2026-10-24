"""The Rimelight Staff: Lantern Hall's frost staff appearance.

A long pale shaft bound in silver and wound with a spiral of rime, an ice spike at its foot, and
at its crown a silver claw of four curling prongs holding a great glowing crystal of cold light,
ringed by a crown of ice shards flaring up and out, three small crystals hanging in the air
around the light and icicles dripping from the collar.

The cold light is painted inside the skin's emissive window (hue 175 to 215, saturation >= 0.5,
lightness >= 0.55): the core crystal, the floating crystals and the rime's veins. The ice
shards are kept just under the saturation floor so they read as ice, not lamps.

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_arms/build_rimelight_staff.py -- public/models/weapons/rimelight_staff.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arms_kit import Forge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = Forge('rimelight_staff', {
    'wood': ((0.46, 0.50, 0.56), 0.6, 0.0),
    'wood_dark': ((0.30, 0.34, 0.40), 0.65, 0.0),
    'silver': ((0.74, 0.77, 0.81), 0.24, 1.0),
    'silver_dark': ((0.44, 0.47, 0.52), 0.3, 1.0),
    'ice': ((0.60, 0.74, 0.86), 0.12, 0.0),
    'ice_deep': ((0.36, 0.52, 0.68), 0.12, 0.0),
    'core': ((0.42, 0.88, 1.0), 0.2, 0.0),
    'core_hot': ((0.80, 0.97, 1.0), 0.2, 0.0),
}, no_grain=('ice', 'core'), no_bump=('ice', 'core'))

SHAFT0, SHAFT1 = -0.84, 0.86

# the shaft, a little thicker under the hand and at the collar
F.loft([F.ring(SHAFT0, 0.03, 0.03, 10), F.ring(-0.2, 0.034, 0.034, 10), F.ring(0.3, 0.033, 0.033, 10),
        F.ring(SHAFT1, 0.038, 0.038, 10)], 'wood', smooth=True)
# the rime: a frosted spiral wound up the shaft with a glowing vein along it
spiral = [(math.cos(k * 0.42) * 0.036, math.sin(k * 0.42) * 0.036, -0.7 + k * 0.0196) for k in range(80)]
F.path_tube(spiral, 0.009, 'ice', sides=6)
spiral_v = [(math.cos(k * 0.42) * 0.044, math.sin(k * 0.42) * 0.044, -0.7 + k * 0.0196) for k in range(0, 80, 2)]
F.path_tube(spiral_v, 0.0035, 'core', sides=4)
# silver bands: under the hand, mid-shaft and below the collar
for z in (-0.72, -0.08, 0.1, 0.56):
    F.loft([F.ring(z - 0.02, 0.042, 0.042, 12), F.ring(z, 0.048, 0.048, 12), F.ring(z + 0.02, 0.042, 0.042, 12)],
           'silver', smooth=True, mats=['silver', 'silver_dark'])
# the foot: a silver ferrule and an ice spike
F.loft([F.ring(-0.86, 0.04, 0.04, 8), F.ring(-0.82, 0.036, 0.036, 8)], 'silver')
F.loft([F.ring(-0.86, 0.034, 0.034, 6), F.ring(-0.875, 0.045, 0.045, 6)], 'silver_dark')
F.shard((0, 0, -0.875), (0, 0, -0.91), 0.04, 'ice', sides=6, taper=0.9)

# The head is authored about a collar at z 1.08 and grown by HS about it, set down at HZ: a
# big crown on a staff whose shaft ends lower, so the silhouette reads from far off.
HS, HZ = 1.55, 0.9


def H(x, y, z):
    return Vector((x * HS, y * HS, HZ + (z - 1.08) * HS))


# the collar: a silver cup the head grows out of
collar = [(0.98, 0.04 / HS), (1.04, 0.07), (1.08, 0.085), (1.1, 0.07)]
F.loft([[H(*p) for p in F.ring(z, r, r, 12)] for z, r in collar], 'silver', smooth=True,
       mats=['silver', 'silver_dark', 'silver'])
# icicles dripping from the collar's lip
for k in range(9):
    a = 2 * math.pi * k / 9 + 0.2
    r = 0.075
    length = 0.06 + 0.05 * ((k * 7) % 4) / 3
    F.shard(H(math.cos(a) * r, math.sin(a) * r, 1.05), H(math.cos(a) * r * 0.95, math.sin(a) * r * 0.95, 1.05 - length),
            0.011 * HS, 'ice', sides=5)

# the crown of ice shards flaring up and out of the collar, alternating long and short
for k in range(8):
    a = 2 * math.pi * k / 8
    long_ = k % 2 == 0
    length = 0.3 if long_ else 0.19
    lean = 0.5 if long_ else 0.72
    d = Vector((math.cos(a) * math.sin(lean), math.sin(a) * math.sin(lean), math.cos(lean)))
    base = H(math.cos(a) * 0.06, math.sin(a) * 0.06, 1.08)
    F.shard(base, base + d * length * HS, (0.034 if long_ else 0.026) * HS, 'ice', sides=6, taper=0.8, twist=0.3)
    F.shard(base + d * 0.03, base + d * length * HS * 0.7, 0.012 * HS, 'ice_deep', sides=5, taper=0.8)

# the claw: four silver prongs curling up and in around the light
for k in range(4):
    a = 2 * math.pi * k / 4 + math.pi / 4
    pts = []
    for s in range(12):
        t = s / 11
        r = 0.07 + 0.06 * math.sin(math.pi * t * 0.85) - 0.07 * t * t
        z = 1.09 + 0.32 * t
        pts.append(H(math.cos(a) * r, math.sin(a) * r, z))
    F.path_tube(pts, [(0.016 * (1 - 0.6 * s / 11) + 0.004) * HS for s in range(12)], 'silver', sides=6)

# the light: a great crystal, a hotter heart inside it
F.shard(H(0, 0, 1.08), H(0, 0, 1.42), 0.075 * HS, 'core', sides=6, taper=1.0)
F.shard(H(0, 0, 1.12), H(0, 0, 1.0), 0.07 * HS, 'core', sides=6, taper=1.0)
F.shard(H(0, 0, 1.15), H(0, 0, 1.34), 0.03 * HS, 'core_hot', sides=6, taper=1.0)
# three small crystals hanging in the air around it
for k in range(3):
    a = 2 * math.pi * k / 3 + 0.5
    c = H(math.cos(a) * 0.17, math.sin(a) * 0.17, 1.3 + 0.03 * k)
    F.shard(c - Vector((0, 0, 0.05)), c + Vector((0, 0, 0.07)), 0.026, 'core', sides=5, taper=1.0)
    F.shard(c - Vector((0, 0, 0.045)), c - Vector((0, 0, 0.1)), 0.026, 'core', sides=5, taper=1.0)

F.finish(OUT, BLEND)
