"""The Rimelight Staff: the Guardian of the Quench's frost staff (Smith's Heart).

A pale silver shaft wound with a ridge of hoarfrost and broken out in ice crystal growths, bound
in silver collars. At its crown four silver tines curl up out of a frost-rimmed collar to cage a
great crystal of cold light, a crown of ice shards fans out round it, icicles hang from the
collar, and a splinter of ice hovers free above the point. The foot is a silver ferrule ending in
an ice spike.

The ice that burns sits inside the skin's emissive window (hue 175 to 215, saturation >= 0.5,
lightness >= 0.55); the silver and the hoarfrost are kept unsaturated so they stay metal and rime.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_rimelight_staff.py -- public/models/weapons/rimelight_staff.glb [out.blend]
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

F = HeartForge('rimelight_staff', {
    'silver': ((0.74, 0.78, 0.84), 0.22, 1.0),
    'silver_dark': ((0.38, 0.42, 0.5), 0.3, 1.0),
    'shaft': ((0.52, 0.58, 0.68), 0.35, 0.85),
    'rime': ((0.88, 0.9, 0.93), 0.65, 0.0),
    'ice': ((0.36, 0.8, 1.0), 0.12, 0.0),
    'ice_pale': ((0.6, 0.88, 1.0), 0.12, 0.0),
    'ice_hot': ((0.88, 0.98, 1.0), 0.1, 0.0),
    'leather': ((0.16, 0.2, 0.3), 0.75, 0.0),
}, glow=('ice',), no_bump=('silver', 'rime', 'leather'))

FOOT, TOP = -0.91, 1.47
HC = 1.16  # crystal heart height

# -- shaft ----------------------------------------------------------------------------------
F.loft([F.ring(FOOT + 0.14, 0.03, 0.03, 8), F.ring(0.6, 0.033, 0.033, 8), F.ring(0.92, 0.036, 0.036, 8)],
       'shaft', smooth=True)
# the hoarfrost ridge winding up it
pts, radii = [], []
for k in range(80):
    t = k / 79
    z = FOOT + 0.2 + (0.88 - FOOT - 0.2) * t
    a = t * 6 * math.pi
    pts.append((math.cos(a) * 0.034, math.sin(a) * 0.034, z))
    radii.append(0.009 + 0.004 * math.sin(t * 40))
F.path_tube(pts, radii, 'rime', sides=5)
# ice crystal growths breaking out of the shaft
rng = random.Random(4)
for k, z in enumerate((-0.45, -0.1, 0.35, 0.62)):
    for j in range(3):
        a = rng.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), 0))
        base = Vector((0, 0, z + rng.uniform(-0.03, 0.03))) + d * 0.028
        tip = base + d * rng.uniform(0.05, 0.08) + Vector((0, 0, rng.uniform(0.03, 0.08)))
        F.crystal(base, tip, rng.uniform(0.012, 0.018), 'ice_pale', sides=5, seed=k * 3 + j,
                  mats=['ice_pale', 'ice_hot'])
# silver collars and the grip
for z in (-0.6, 0.2, 0.55):
    F.ring_band(z, 0.042, 0.042, 0.03, 'silver', sides=10, flare=0.12)
F.loft([F.ring(-0.12, 0.038, 0.038, 10), F.ring(0.14, 0.038, 0.038, 10)], 'leather', smooth=True)
for k in range(6):
    F.torus((0, 0, -0.1 + k * 0.045), (0.3, 0, 1), 0.039, 0.006, 'silver_dark', seg=12, sides=5)
# the foot: a silver ferrule and an ice spike
F.loft([F.ring(FOOT + 0.16, 0.034, 0.034, 8), F.ring(FOOT + 0.1, 0.044, 0.044, 8),
        F.ring(FOOT + 0.06, 0.036, 0.036, 8)], 'silver', mats=['silver', 'silver_dark'])
F.crystal((0, 0, FOOT + 0.07), (0, 0, FOOT), 0.028, 'ice_pale', sides=6, seed=21, mats=['ice_pale', 'ice_hot'])

# -- the crown ------------------------------------------------------------------------------
CROWN = F.mark()
# a frost-rimmed collar
F.loft([F.ring(0.9, 0.04, 0.04, 10), F.ring(0.96, 0.075, 0.075, 10), F.ring(1.0, 0.085, 0.085, 10),
        F.ring(1.02, 0.07, 0.07, 10)], 'silver', mats=['silver', 'silver_dark', 'silver'])
F.torus((0, 0, 0.985), (0, 0, 1), 0.085, 0.016, 'rime', seg=16, sides=6)
# icicles hanging from it
for k in range(8):
    a = 2 * math.pi * k / 8 + 0.2
    d = Vector((math.cos(a), math.sin(a), 0))
    ln = 0.06 + 0.05 * ((k * 5) % 3) / 2
    F.crystal(Vector((0, 0, 0.965)) + d * 0.072, Vector((0, 0, 0.965 - ln)) + d * 0.068, 0.012, 'ice_pale',
              sides=5, seed=30 + k, mats=['ice_pale', 'ice_hot'])
# four silver tines curling up out of the collar to cage the crystal
for k in range(4):
    a = 2 * math.pi * k / 4 + math.pi / 4
    d = Vector((math.cos(a), math.sin(a), 0))
    path = [Vector((0, 0, 1.0)) + d * 0.06, Vector((0, 0, 1.06)) + d * 0.13, Vector((0, 0, 1.14)) + d * 0.155,
            Vector((0, 0, 1.24)) + d * 0.14, Vector((0, 0, 1.31)) + d * 0.1, Vector((0, 0, 1.35)) + d * 0.06,
            Vector((0, 0, 1.345)) + d * 0.035]
    F.path_tube(path, [0.022, 0.02, 0.018, 0.016, 0.013, 0.009, 0.004], 'silver', sides=6)
    # a barb of ice on each tine's shoulder
    F.crystal(Vector((0, 0, 1.13)) + d * 0.16, Vector((0, 0, 1.2)) + d * 0.25, 0.018, 'ice_pale', sides=5,
              seed=50 + k, mats=['ice_pale', 'ice_hot'])
# the great crystal of cold light
F.crystal((0, 0, 1.0), (0, 0, TOP - 0.17), 0.085, 'ice', sides=6, seed=1, mats=['ice', 'ice_hot'], waist=1.18)
F.crystal((0, 0, 1.06), (0, 0, 0.98), 0.07, 'ice', sides=6, seed=1)
# the crown of ice shards fanning out round it
for k in range(7):
    a = 2 * math.pi * k / 7 + 0.4
    d = Vector((math.cos(a), math.sin(a), 0))
    ln = 0.16 + 0.07 * (k % 3) / 2
    base = Vector((0, 0, 1.03)) + d * 0.05
    tip = base + d * (ln * 0.75) + Vector((0, 0, ln))
    F.crystal(base, tip, 0.03, 'ice_pale', sides=6, seed=60 + k, mats=['ice_pale', 'ice_hot'])
# the whole crown is modelled at hand scale, then sized up to a heroic head
F.scale_since(CROWN, (0, 0, 0.9), 1.55, 1.12)
# a splinter of ice hovering free above the point (the floating part): a double point
F.crystal((0, 0, TOP - 0.03), (0, 0, TOP + 0.0), 0.03, 'ice_pale', sides=6, seed=70, mats=['ice_pale', 'ice_hot'])
F.crystal((0, 0, TOP - 0.03), (0, 0, TOP - 0.075), 0.03, 'ice_pale', sides=6, seed=70)

F.finish(OUT, BLEND)
