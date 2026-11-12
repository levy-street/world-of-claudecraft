"""The Rimelight Staff: the Guardian of the Quench's frost staff (Smith's Heart).

A blue-steel shaft wound with a double helix of silver filigree, bound in layered silver collars
set with small frost gems. Its crown is a heroic frost head: four silver crescent blades sweep up
out of a frost-rimmed collar to cradle a great crystal of cold light, four fine tines clasp the
crystal's neck, a ring of smaller crystals breaks out round its root and icicles hang beneath the
collar. Every crystal is cut in courses from deep blue at its root to white-hot at its point, so
the head reads as light gathering inside the ice. A splinter of ice hovers free above the point,
and the foot is a silver ferrule ending in an ice spike.

The ice that burns sits inside the skin's emissive window (hue 175 to 215, saturation >= 0.5,
lightness >= 0.55); the deep root courses sit below that lightness, and the silver, the steel
and the hoarfrost are kept unsaturated, so they stay metal and rime.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_rimelight_staff.py -- public/models/weapons/rimelight_staff.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from heart_kit import HeartForge, Vector, rot_z  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = HeartForge('rimelight_staff', {
    'silver': ((0.78, 0.82, 0.88), 0.2, 1.0),
    'silver_dark': ((0.3, 0.34, 0.43), 0.3, 1.0),
    'steel': ((0.2, 0.27, 0.38), 0.32, 0.9),
    'rime': ((0.86, 0.89, 0.93), 0.6, 0.0),
    'ice_deep': ((0.1, 0.3, 0.6), 0.1, 0.0),
    'ice': ((0.3, 0.76, 1.0), 0.1, 0.0),
    'ice_pale': ((0.6, 0.9, 1.0), 0.1, 0.0),
    'ice_hot': ((0.9, 0.99, 1.0), 0.08, 0.0),
    'leather': ((0.12, 0.15, 0.24), 0.75, 0.0),
}, glow=('ice',), no_bump=('silver', 'rime', 'leather'))

ICE = ['ice_deep', 'ice', 'ice_pale', 'ice_hot']
ICE_SMALL = ['ice', 'ice_pale', 'ice_hot']
FOOT, TOP = -0.91, 1.47

# -- shaft ----------------------------------------------------------------------------------
F.loft([F.ring(FOOT + 0.14, 0.033, 0.033, 10), F.ring(0.3, 0.036, 0.036, 10),
        F.ring(0.92, 0.04, 0.04, 10)], 'steel', smooth=True)
# a double helix of silver filigree winding up the upper shaft and down to the foot
for phase in (0.0, math.pi):
    for z0, z1, turns in ((0.24, 0.88, 3.0), (FOOT + 0.22, -0.16, 2.5)):
        pts = []
        for k in range(60):
            t = k / 59
            a = phase + t * turns * 2 * math.pi
            pts.append((math.cos(a) * 0.039, math.sin(a) * 0.039, z0 + (z1 - z0) * t))
        F.path_tube(pts, 0.0055, 'silver', sides=5)
# layered silver collars, the high one set with frost gems
for z, big in ((-0.6, False), (0.2, False), (0.55, True)):
    r = 0.046 if big else 0.043
    F.ring_band(z, r, r, 0.04 if big else 0.03, 'silver', sides=12, flare=0.16)
    F.torus((0, 0, z - 0.024), (0, 0, 1), r * 0.98, 0.006, 'silver_dark', seg=16, sides=5)
    F.torus((0, 0, z + 0.024), (0, 0, 1), r * 0.98, 0.006, 'silver_dark', seg=16, sides=5)
    if big:
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            d = Vector((math.cos(a), math.sin(a), 0))
            F.gem(Vector((0, 0, z)) + d * (r * 1.12), 0.014, 0.008, 'ice', sides=6, axis=-d, crown=0.6)
# the grip: wrapped leather between the collars, crossed with silver cord
F.loft([F.ring(-0.12, 0.039, 0.039, 10), F.ring(0.16, 0.039, 0.039, 10)], 'leather', smooth=True)
for k in range(7):
    F.torus((0, 0, -0.1 + k * 0.04), (0.3, 0, 1), 0.0395, 0.0055, 'silver_dark', seg=12, sides=5)
# a clutch of ice breaking out under the high collar
for k in range(3):
    a = k * 2 * math.pi / 3 + 0.5
    d = Vector((math.cos(a), math.sin(a), 0))
    base = Vector((0, 0, 0.5)) + d * 0.035
    F.crystal_banded(base, base + d * 0.06 + Vector((0, 0, -0.07)), 0.013, ICE_SMALL, sides=5,
                     seed=80 + k, bands=2)
# the foot: a silver ferrule and an ice spike
F.loft([F.ring(FOOT + 0.16, 0.035, 0.035, 10), F.ring(FOOT + 0.11, 0.047, 0.047, 10),
        F.ring(FOOT + 0.06, 0.038, 0.038, 10)], 'silver', mats=['silver', 'silver_dark'])
F.crystal_banded((0, 0, FOOT + 0.07), (0, 0, FOOT), 0.03, ICE_SMALL, sides=6, seed=21, bands=2)

# -- the crown ------------------------------------------------------------------------------
CROWN = F.mark()
# a frost-rimmed collar, stepped, its lip set with frost gems
F.loft([F.ring(0.9, 0.041, 0.041, 12), F.ring(0.94, 0.06, 0.06, 12), F.ring(0.97, 0.085, 0.085, 12),
        F.ring(1.0, 0.09, 0.09, 12), F.ring(1.02, 0.072, 0.072, 12)], 'silver',
       mats=['silver_dark', 'silver', 'silver_dark', 'silver'])
F.torus((0, 0, 0.985), (0, 0, 1), 0.09, 0.015, 'rime', seg=20, sides=6)
for k in range(8):
    a = 2 * math.pi * k / 8
    d = Vector((math.cos(a), math.sin(a), 0))
    F.gem(Vector((0, 0, 0.962)) + d * 0.074, 0.011, 0.007, 'ice', sides=6, axis=-d, crown=0.6)
# icicles hanging beneath it
for k in range(10):
    a = 2 * math.pi * k / 10 + 0.15
    d = Vector((math.cos(a), math.sin(a), 0))
    ln = 0.05 + 0.05 * ((k * 7) % 4) / 3
    F.crystal_banded(Vector((0, 0, 0.94)) + d * 0.06, Vector((0, 0, 0.94 - ln)) + d * 0.056, 0.011,
                     ICE_SMALL, sides=5, seed=30 + k, bands=2)
# four silver crescent blades sweeping up to cradle the crystal (the head's silhouette)
BLADE = [(0.045, 0.99), (0.1, 1.0), (0.155, 1.05), (0.19, 1.12), (0.2, 1.2), (0.185, 1.27),
         (0.15, 1.33), (0.105, 1.37), (0.075, 1.385), (0.095, 1.345), (0.125, 1.29),
         (0.14, 1.22), (0.135, 1.15), (0.11, 1.09), (0.07, 1.05), (0.04, 1.035)]
for k in range(4):
    R = rot_z(k * 90)
    F.plate(BLADE, 0.0, 0.022, 'silver', 'silver_dark', rot=R)
    d = R @ Vector((1, 0, 0))
    # a frost barb on each blade's shoulder, and a gem each side where it leaves the collar
    F.crystal_banded(Vector((0, 0, 1.15)) + d * 0.19, Vector((0, 0, 1.22)) + d * 0.29, 0.017,
                     ICE_SMALL, sides=5, seed=50 + k, bands=2)
    for s in (1, -1):
        F.gem(Vector((0, 0, 1.06)) + d * 0.12 + R @ Vector((0, s * 0.012, 0)), 0.014, 0.007, 'ice',
              sides=6, axis=R @ Vector((0, -s, 0)), crown=0.6)
# four fine tines between the blades, clasping the crystal's neck
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    d = Vector((math.cos(a), math.sin(a), 0))
    path = [Vector((0, 0, 1.0)) + d * 0.07, Vector((0, 0, 1.08)) + d * 0.12, Vector((0, 0, 1.17)) + d * 0.125,
            Vector((0, 0, 1.25)) + d * 0.095, Vector((0, 0, 1.3)) + d * 0.06, Vector((0, 0, 1.315)) + d * 0.04]
    F.path_tube(path, [0.014, 0.013, 0.011, 0.009, 0.007, 0.004], 'silver', sides=6)
# the great crystal of cold light, cut deep to hot
F.crystal_banded((0, 0, 0.99), (0, 0, TOP - 0.11), 0.095, ICE, sides=6, seed=1, waist=1.22, bands=5)
F.crystal_banded((0, 0, 1.05), (0, 0, 0.97), 0.08, ['ice_deep', 'ice'], sides=6, seed=1, bands=1)
# a ring of smaller crystals breaking out round its root, leaning outward
for k in range(6):
    a = 2 * math.pi * k / 6 + math.pi / 6
    d = Vector((math.cos(a), math.sin(a), 0))
    ln = 0.17 + 0.06 * (k % 3) / 2
    base = Vector((0, 0, 1.02)) + d * 0.05
    F.crystal_banded(base, base + d * (ln * 0.75) + Vector((0, 0, ln)), 0.03, ICE, sides=6,
                     seed=60 + k, bands=3)
# the whole crown is modelled at hand scale, then sized up to a heroic head
F.scale_since(CROWN, (0, 0, 0.9), 1.55, 1.12)
# a splinter of ice hovering free above the point (the floating part): a double point
F.crystal_banded((0, 0, TOP - 0.02), (0, 0, TOP + 0.015), 0.028, ICE_SMALL, sides=6, seed=70, bands=2)
F.crystal_banded((0, 0, TOP - 0.02), (0, 0, TOP - 0.05), 0.028, ICE_SMALL, sides=6, seed=70, bands=2)

F.finish(OUT, BLEND)
