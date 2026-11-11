"""The Heartmeld Staff: the Masterless Strength's staff of the four elements (Smith's Heart).

Model id `duskwick_staff` (the id is frozen; the look and name are the raid's). A haft of dark
forge-bronze set with courses of pale quarry stone and gold rings rises to a great upright gold
ring, the Anvil's halo. Four sockets on the ring hold the four veins of the Heart: quarry amber at
the crown, the Breath's pale gale-green to the right, the Quench's frost-blue below, the Heat's
fire to the left. Inside the ring an anvil-shaped heart of gold holds a white-gold core, four gold
rays strike out between the sockets, and a gold spike crowns it all.

Every gem sits inside the skin's one wide emissive window (hue 8 to 215, saturation >= 0.7,
lightness >= 0.5); the bronze, the gold and the stone are kept too dark or too grey to enter it.
The four gems light in turn through the VFX (src/render/weapon_vfx.ts), not the texture.

  blender --background --factory-startup --python \
      scripts/assets/smith_heart_arms/build_heartmeld_staff.py -- public/models/weapons/duskwick_staff.glb [out.blend]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from heart_kit import HeartForge, Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

F = HeartForge('duskwick_staff', {
    'bronze': ((0.3, 0.2, 0.12), 0.4, 0.95),
    'bronze_dark': ((0.14, 0.09, 0.06), 0.5, 0.9),
    'gold': ((0.78, 0.5, 0.1), 0.34, 0.65),
    'gold_dark': ((0.38, 0.22, 0.06), 0.42, 0.65),
    'stone': ((0.7, 0.64, 0.55), 0.85, 0.0),
    'leather': ((0.24, 0.12, 0.07), 0.75, 0.0),
    'gem_stone': ((1.0, 0.62, 0.1), 0.3, 0.0),
    'gem_wind': ((0.2, 0.95, 0.6), 0.3, 0.0),
    'gem_frost': ((0.15, 0.6, 1.0), 0.2, 0.0),
    'gem_fire': ((1.0, 0.3, 0.04), 0.3, 0.0),
    'gem_core': ((1.0, 0.94, 0.7), 0.3, 0.0),
}, glow=('gem_',), no_bump=('gold', 'leather'))

FOOT = -0.91
RZ = 0.918    # ring centre height (before the head is sized up round it)
R = 0.2       # ring radius

# -- haft -----------------------------------------------------------------------------------
F.loft([F.ring(FOOT + 0.12, 0.032, 0.032, 8, rot=math.pi / 8), F.ring(0.53, 0.036, 0.036, 8, rot=math.pi / 8)],
       'bronze')
# courses of pale quarry stone set into it
for z in (-0.6, -0.3, 0.3):
    F.loft([F.ring(z - 0.05, 0.04, 0.04, 8), F.ring(z - 0.03, 0.05, 0.05, 8), F.ring(z + 0.03, 0.05, 0.05, 8),
            F.ring(z + 0.05, 0.04, 0.04, 8)], 'stone')
    F.ring_band(z - 0.06, 0.046, 0.046, 0.02, 'gold', sides=10, flare=0.1)
    F.ring_band(z + 0.06, 0.046, 0.046, 0.02, 'gold', sides=10, flare=0.1)
# four slim element lines spiralling up the upper haft (each in its gem's colour)
for k, mat in enumerate(('gem_stone', 'gem_wind', 'gem_frost', 'gem_fire')):
    pts = []
    for j in range(24):
        t = j / 23
        z = 0.37 + 0.13 * t
        a = k * math.pi / 2 + t * math.pi
        pts.append((math.cos(a) * 0.037, math.sin(a) * 0.037, z))
    F.path_tube(pts, 0.005, mat, sides=4)
# grip
F.loft([F.ring(-0.12, 0.038, 0.038, 10), F.ring(0.16, 0.038, 0.038, 10)], 'leather', smooth=True)
for k in range(6):
    F.torus((0, 0, -0.1 + k * 0.048), (0.3, 0, 1), 0.039, 0.006, 'bronze_dark', seg=12, sides=5)
F.ring_band(-0.13, 0.046, 0.046, 0.025, 'gold', sides=10, flare=0.1)
F.ring_band(0.17, 0.046, 0.046, 0.025, 'gold', sides=10, flare=0.1)
# foot: a gold ferrule and a little stone knuckle
F.loft([F.ring(FOOT + 0.14, 0.034, 0.034, 8), F.ring(FOOT + 0.08, 0.05, 0.05, 8), F.ring(FOOT + 0.04, 0.04, 0.04, 8)],
       'gold', mats=['gold', 'gold_dark'])
F.shard((0, 0, FOOT + 0.05), (0, 0, FOOT), 0.03, 'gold_dark', sides=6)

# -- the head -------------------------------------------------------------------------------
# modelled at hand scale round the ring centre, then sized up as a whole to a heroic head
HEAD = F.mark()
# the neck: a gold socket flaring up into two cradle arms that hold the ring from below
F.loft([F.ring(RZ - 0.3, 0.036, 0.036, 8), F.ring(RZ - 0.25, 0.06, 0.055, 8), F.ring(RZ - 0.22, 0.05, 0.045, 8)],
       'gold', mats=['gold', 'gold_dark'])
for s in (1, -1):
    F.path_tube([(s * 0.02, 0, RZ - 0.23), (s * 0.08, 0, RZ - 0.235), (s * 0.13, 0, RZ - 0.2),
                 (s * 0.15, 0, RZ - 0.15)], [0.026, 0.022, 0.019, 0.015], 'gold', sides=6)
# the halo: a heavy ring with a raised inner lip
F.torus((0, 0, RZ), (0, 1, 0), R, 0.034, 'gold', seg=40, sides=8)
F.torus((0, 0, RZ), (0, 1, 0), R - 0.04, 0.012, 'gold_dark', seg=36, sides=6)
for side in (1, -1):
    F.torus((0, side * 0.026, RZ), (0, 1, 0), R + 0.005, 0.01, 'gold_dark', seg=40, sides=6)

# the four sockets on the diagonals, in the order they light: quarry amber (upper left), the
# gale (upper right), frost (lower right), fire (lower left)
SOCKETS = [(135, 'gem_stone'), (45, 'gem_wind'), (-45, 'gem_frost'), (-135, 'gem_fire')]
for deg, mat in SOCKETS:
    a = math.radians(deg)
    out = Vector((math.cos(a), 0, math.sin(a)))
    c = Vector((0, 0, RZ)) + out * R
    tang = Vector((-out.z, 0, out.x))
    # a gold bezel standing out of the ring, set with the gem on both faces
    F.path_tube([c - Vector((0, 0.05, 0)), c - Vector((0, 0.04, 0)), c + Vector((0, 0.04, 0)),
                 c + Vector((0, 0.05, 0))], [0.05, 0.068, 0.068, 0.05], 'gold', sides=12)
    for side in (1, -1):
        F.gem(tuple(c + Vector((0, side * 0.045, 0))), 0.058, 0.035, mat, sides=8, axis=(0, -side, 0), crown=0.55)
    # each element's own crest out past the bezel
    if mat == 'gem_stone':      # hewn amber crystals
        for j, dt in enumerate((-0.025, 0.0, 0.025)):
            F.crystal(c + out * 0.05 + tang * dt, c + out * (0.12 + 0.04 * (j == 1)) + tang * dt * 1.8, 0.022, mat,
                      sides=6, seed=1 + j, mats=[mat, 'gem_core'])
    elif mat == 'gem_wind':     # two curls of gale
        for j, dt in enumerate((-0.02, 0.025)):
            sg = 1 if j else -1
            F.path_tube([c + out * 0.06 + tang * dt, c + out * 0.1 + tang * (dt + sg * 0.03),
                         c + out * 0.14 + tang * (dt + sg * 0.01), c + out * 0.13 + tang * (dt - sg * 0.03),
                         c + out * 0.1 + tang * (dt - sg * 0.02)], [0.016, 0.014, 0.011, 0.008, 0.003], mat, sides=6)
    elif mat == 'gem_frost':    # a cluster of icicles
        for j, dt in enumerate((-0.03, 0.0, 0.03)):
            F.crystal(c + out * 0.05 + tang * dt, c + out * (0.12 + 0.04 * (j == 1)) + tang * dt * 1.4,
                      0.016, mat, sides=5, seed=10 + j, mats=[mat, 'gem_core'])
    else:                       # three tongues of flame
        for j, dt in enumerate((-0.03, 0.0, 0.03)):
            F.path_tube([c + out * 0.05 + tang * dt, c + out * 0.09 + tang * (dt * 1.5 + 0.02),
                         c + out * (0.14 + 0.03 * (j == 1)) + tang * (dt * 1.2 + 0.045)],
                        [0.016, 0.011, 0.002], mat, sides=5)
# gold rays striking out left and right, a crowning spike above
for x in (1, -1):
    F.shard((x * (R + 0.02), 0, RZ), (x * (R + 0.13), 0, RZ), 0.03, 'gold', sides=4, mats=['gold', 'gold_dark'])
F.shard((0, 0, RZ + R + 0.02), (0, 0, RZ + R + 0.2), 0.034, 'gold', sides=4, mats=['gold', 'gold_dark'])
F.rock((0, 0, RZ + R + 0.02), 0.04, 'gold_dark', 3, rough=0.05)
# the anvil heart inside the ring, holding the white-gold core
F.block((0, 0, RZ - 0.06), (0.17, 0.07, 0.045), 'gold', bevel=0.012)
F.block((0, 0, RZ - 0.105), (0.08, 0.055, 0.05), 'gold_dark', bevel=0.008)
F.block((0, 0, RZ - 0.14), (0.13, 0.065, 0.03), 'gold', bevel=0.008)
F.path_tube([(0.085, 0, RZ - 0.06), (0.12, 0, RZ - 0.055), (0.15, 0, RZ - 0.065)], [0.022, 0.015, 0.003], 'gold',
            sides=6)
F.path_tube([(0, 0, RZ - 0.15), (0, 0, RZ - R)], 0.016, 'gold_dark', sides=6)
for side in (1, -1):
    F.gem((0, side * 0.03, RZ + 0.03), 0.06, 0.035, 'gem_core', sides=10, axis=(0, -side, 0), crown=0.6)
F.torus((0, 0, RZ + 0.03), (0, 1, 0), 0.06, 0.012, 'gold', seg=18, sides=6)
F.scale_since(HEAD, (0, 0, RZ), 1.38, 1.38)

F.finish(OUT, BLEND)
