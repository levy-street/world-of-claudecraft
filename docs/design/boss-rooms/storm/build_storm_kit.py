"""The TEMPEST VHAROK room kit: a summit under a storm that never ends.

  blender --background --python docs/design/boss-rooms/storm/build_storm_kit.py [-- --preview]

Writes storm_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: Vharok telegraphs in bright CIRCLES on the floor.
The cyan here is a hairline inside split stone and a spark at a rod's tip, always
upright and above the ground; nothing in the kit is a lit ring or disc.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

GRANITE = (0.78, 0.81, 0.88)
GRANITE_DARK = (0.6, 0.63, 0.72)
GRANITE_DEEP = (0.43, 0.46, 0.55)
COPPER = (0.6, 0.47, 0.35)
VERDIGRIS = (0.46, 0.78, 0.68)
IRON = (0.5, 0.52, 0.58)
IRON_DARK = (0.36, 0.38, 0.44)
BONE = (0.84, 0.82, 0.73)
BONE_OLD = (0.66, 0.65, 0.58)
CLOTH = (0.3, 0.52, 0.8)
CLOTH_DARK = (0.22, 0.38, 0.62)
TRIM = (0.86, 0.74, 0.4)
WOOD = (0.5, 0.42, 0.36)
SCORCH = (0.16, 0.16, 0.2)
ARC = (0.6, 1.0, 1.0)
ARC_DIM = (0.3, 0.72, 0.82)
COLD = (0.02, 0.05, 0.07)


def piece(name):
    return Piece(name, warm=COLD)


def chain_run(p, a, b, size=0.6, color=IRON_DARK, sag=0.0):
    """Chain from a to b, sagging a little: slabs turned a quarter each."""
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2 - Vector((0, 0, sag))
    count = max(3, int((b - a).length / (size * 0.72)))
    points = p.bezier(a, mid, b, steps=count)
    for i in range(count):
        here_, there = points[i], points[i + 1]
        along = there - here_
        pitch = math.atan2(math.hypot(along.x, along.y), along.z)
        yaw = math.atan2(along.y, along.x) - math.pi / 2
        start = p.mark()
        p.box((0, 0, 0), (size * 0.5, size * 0.2, size), color, yaw=(math.pi / 2) * (i % 2), bevel=size * 0.05)
        p.turn(start, Matrix.Translation((here_ + there) / 2) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'X'))


def anchor_ring(p, at, r=0.6):
    p.box((at[0], at[1], at[2] + 0.15), (1.4, 1.4, 0.3), GRANITE_DEEP, bevel=0.08)
    p.ring((at[0], at[1], at[2] + 0.3 + r * 0.7), r, 0.16, IRON, segments=8)


def crack(p, x, y, z0, z1, width=0.14, tone=ARC_DIM, wander=0.35):
    """A lightning crack up a front face: a jagged run of thin lit bars."""
    steps = max(2, int((z1 - z0) / 1.1))
    px = x
    for i in range(steps):
        nx = x + (p.rng.random() - 0.5) * 2 * wander
        za, zb = z0 + (z1 - z0) * i / steps, z0 + (z1 - z0) * (i + 1) / steps
        length = math.hypot(nx - px, zb - za)
        p.box(((px + nx) / 2, y, (za + zb) / 2), (width, 0.08, length * 1.04), tone, mat=GLOW, roll=math.atan2(nx - px, zb - za))
        px = nx


def torn_cloth(p, x0, z_top, width, drops, y=0.0, pitch=0.12):
    """Cloth hung from a yard, in strips of unequal length, the wind in it."""
    n = len(drops)
    for i, length in enumerate(drops):
        x = x0 + (i + 0.5) * width / n
        p.box((x, y - 0.06 * i, z_top - length / 2), (width / n * 0.96, 0.07, length), CLOTH if i % 2 == 0 else CLOTH_DARK,
              pitch=pitch + 0.05 * i, taper=0.55 if i % 2 else 0.85)


def bolt(p, a, b, width=0.16, tone=ARC, kinks=4, wander=0.6):
    """A frozen fork of lightning from a to b: a jagged run of thin lit bars, any way up."""
    a, b = Vector(a), Vector(b)
    points = [a]
    for i in range(1, kinks):
        t = i / kinks
        points.append(a.lerp(b, t) + Vector(((p.rng.random() - 0.5) * 2 * wander, 0, (p.rng.random() - 0.5) * wander)))
    points.append(b)
    for here_, there in zip(points, points[1:]):
        along = there - here_
        p.box((here_ + there) / 2, (width, 0.1, along.length * 1.05), tone, mat=GLOW, roll=math.atan2(along.x, along.z))


def coil(p, at, r, rings, rise=0.62, shrink=0.86):
    """Stacked copper rings, each smaller than the one under it: a storm conductor's coil."""
    z = at[2]
    for i in range(rings):
        p.prism((at[0], at[1], z), 10, r, r, rise * 0.45, COPPER if i % 2 == 0 else VERDIGRIS)
        z += rise
        r *= shrink
    return z


# --------------------------------------------------------------------- hero
def lightning_spire():
    """The Great Lightning Spire: a storm tower split to its core by an age of strikes,
    crowned with a copper coil that holds a captive bolt, the ruin of its hall round
    its feet. Back at y = +4."""
    p = piece('Kit_LightningSpire')
    for i, (w, d, h) in enumerate(((21, 10, 1.1), (16, 8, 1.1), (11.5, 6, 1.2))):
        p.box((0, 0.6, 0.55 + i * 1.1), (w, d, h), GRANITE if i % 2 == 0 else GRANITE_DARK, bevel=0.16)
    # The tower: two halves of one great stone, the light of the storm in the split.
    for side in (-1, 1):
        p.box((side * 2.35, 1.6, 13.4), (3.9, 5.2, 20.0), GRANITE if side < 0 else GRANITE_DARK, taper=0.6, roll=-side * 0.03, bevel=0.3)
        p.box((side * 5.2, 2.2, 7.0), (2.4, 3.4, 8.0), GRANITE_DARK if side < 0 else GRANITE_DEEP, taper=0.4, roll=-side * 0.2, bevel=0.25)
        p.box((side * 1.0, -0.9, 9.6), (0.7, 0.5, 12.0), GRANITE_DEEP, taper=0.5)
    p.box((0, -0.6, 10.2), (1.0, 0.3, 13.2), ARC, mat=GLOW, taper=0.35)
    p.box((0, -0.7, 10.2), (0.36, 0.3, 12.4), (0.9, 1.0, 1.0), mat=GLOW, taper=0.3)
    bolt(p, (-0.4, -1.12, 12.0), (-3.2, -1.12, 16.4), width=0.18, tone=ARC_DIM, kinks=3)
    bolt(p, (0.4, -1.12, 8.0), (3.4, -1.12, 11.6), width=0.18, tone=ARC_DIM, kinks=3)
    # Bands of copper hold the halves together.
    for z, w in ((5.4, 9.0), (11.0, 7.6), (16.6, 6.4)):
        p.box((0, 1.6, z), (w, 5.6, 0.7), COPPER if z != 11.0 else VERDIGRIS, bevel=0.08)
        for side in (-1, 1):
            p.prism((side * (w / 2 - 0.5), -1.25, z), 6, 0.3, 0.2, 0.25, IRON_DARK, axis='Y')
    # The crown: a coil of copper, a mast, and the bolt it caught.
    p.box((0, 1.6, 23.7), (5.6, 5.0, 0.9), GRANITE_DEEP, bevel=0.15)
    top = coil(p, (0, 1.6, 24.2), 3.6, 5, rise=0.95, shrink=0.8)
    p.prism((0, 1.6, top), 8, 0.5, 0.3, 4.6, COPPER)
    orb = (0, 1.6, top + 5.6)
    for k in range(4):
        a = k * math.tau / 4 + 0.6
        tip = (math.cos(a) * 2.2, 1.6 + math.sin(a) * 2.2, top + 5.0)
        p.sweep(p.bezier((math.cos(a) * 1.2, 1.6 + math.sin(a) * 1.2, top - 0.4), (math.cos(a) * 3.4, 1.6 + math.sin(a) * 3.4, top + 1.6), tip, steps=5),
                0.26, 0.08, VERDIGRIS if k % 2 else COPPER, sides=5)
        bolt(p, orb, (tip[0], 0.9, tip[2]), width=0.13, tone=ARC_DIM, kinks=3, wander=0.4)
    p.rock(orb, (2.0, 2.0, 2.2), ARC, jitter=0.1, subdivisions=2, mat=GLOW)
    p.rock(orb, (1.1, 1.1, 1.2), (0.92, 1.0, 1.0), jitter=0.06, mat=GLOW)
    # Its hall: on the left a span still stands to the tower, on the right it has fallen.
    for side, h in ((-1, 11.0), (1, 6.5)):
        p.box((side * 14.0, 2.6, h / 2), (3.6, 3.4, h), GRANITE_DARK, taper=0.88, bevel=0.2)
        p.box((side * 14.0, 2.6, h + 0.35), (4.4, 4.0, 0.9), GRANITE, bevel=0.14, roll=0.0 if side < 0 else 0.2)
        p.box((side * 14.0, 0.82, h * 0.5), (2.4, 0.2, 0.6), VERDIGRIS)
        p.prism((side * 14.0, 2.6, h + 0.8), 8, 0.22, 0.12, 3.4, COPPER)
        p.rock((side * 14.0, 2.6, h + 4.5), (0.6, 0.6, 0.7), ARC, jitter=0.1, mat=GLOW)
    p.ring((-9.0, 2.6, 11.0), 4.4, 1.1, GRANITE, segments=14, arc=(0.0, math.pi), width=2.2)
    p.ring((9.0, 2.6, 6.5), 4.4, 1.1, GRANITE_DARK, segments=14, arc=(0.0, 0.9), width=2.2)
    for x, y, z, w, yaw, roll in ((8.0, -2.8, 0.8, 3.4, 0.5, 0.2), (4.6, -3.8, 0.55, 2.2, -0.4, -0.1), (-7.4, -3.4, 0.6, 2.6, 0.9, 0.12),
                                  (11.6, -1.0, 0.7, 2.8, 0.2, 0.3), (16.6, -2.2, 0.6, 2.2, -0.6, 0.15)):
        p.box((x, y, z), (w, w * 0.7, 1.2), GRANITE_DEEP if w < 2.4 else GRANITE, yaw=yaw, roll=roll, bevel=0.15)
    # Grounded: heavy chain from the copper down to ringbolts set in the floor.
    for side in (-1, 1):
        chain_run(p, (side * 3.4, -0.6, 16.4), (side * 10.0, -3.4, 0.9), size=1.0, sag=2.4)
        anchor_ring(p, (side * 10.2, -3.5, 0.0), r=0.8)
    return p


# ------------------------------------------------------------------- props
def split_menhir():
    """A standing stone the lightning keeps finding: split, scorched, the storm still in the wound."""
    p = piece('Kit_SplitMenhir')
    p.rock((0, 0.3, 0.35), (4.4, 3.2, 1.3), GRANITE_DEEP, jitter=0.18)
    p.box((-0.95, 0.2, 3.6), (1.9, 1.8, 7.2), GRANITE, taper=0.6, roll=-0.08, bevel=0.22)
    p.box((0.95, 0.2, 3.0), (1.8, 1.7, 6.0), GRANITE_DARK, taper=0.5, roll=0.11, bevel=0.22)
    p.box((0.02, -0.2, 2.9), (0.5, 0.9, 5.2), ARC, mat=GLOW, taper=0.3)
    bolt(p, (-0.3, -0.76, 4.2), (-1.5, -0.76, 6.2), width=0.11, tone=ARC_DIM, kinks=3, wander=0.3)
    bolt(p, (0.3, -0.72, 3.0), (1.4, -0.72, 4.6), width=0.11, tone=ARC_DIM, kinks=3, wander=0.3)
    p.box((-1.0, -0.72, 1.4), (1.2, 0.1, 1.6), SCORCH, roll=-0.08)
    p.box((0.95, -0.66, 1.2), (1.0, 0.1, 1.3), SCORCH, roll=0.11)
    p.box((-0.95, 0.2, 5.4), (1.7, 1.75, 0.3), VERDIGRIS, roll=-0.08)
    return p


def lightning_rod():
    """A storm conductor: a copper coil on a drum of stone, a caught spark held at its head."""
    p = piece('Kit_LightningRod')
    p.prism((0, 0, 0), 8, 1.7, 1.45, 1.0, GRANITE_DARK, phase=0.3)
    p.prism((0, 0, 1.0), 8, 1.2, 1.05, 0.7, GRANITE)
    p.prism((0, 0, 1.7), 8, 0.42, 0.3, 5.4, COPPER)
    coil(p, (0, 0, 2.3), 1.3, 5, rise=0.78, shrink=0.84)
    p.prism((0, 0, 7.0), 8, 0.3, 0.8, 0.5, VERDIGRIS)
    for k in range(3):
        a = k * math.tau / 3 + 0.5
        p.sweep(p.bezier((math.cos(a) * 0.6, math.sin(a) * 0.6, 7.3), (math.cos(a) * 1.4, math.sin(a) * 1.4, 7.8),
                         (math.cos(a) * 1.0, math.sin(a) * 1.0, 9.0), steps=4), 0.13, 0.05, COPPER, sides=4)
    p.rock((0, 0, 8.4), (1.0, 1.0, 1.1), ARC, jitter=0.1, subdivisions=2, mat=GLOW)
    p.rock((0, 0, 8.4), (0.55, 0.55, 0.6), (0.92, 1.0, 1.0), jitter=0.06, mat=GLOW)
    bolt(p, (0.2, -0.5, 8.2), (0.9, -0.9, 6.0), width=0.08, tone=ARC_DIM, kinks=3, wander=0.3)
    return p


def torn_banner():
    """A war banner the wind has been at for years, the storm's mark still on it. It rocks on its pole."""
    p = piece('Kit_TornBanner')
    p.rock((0, 0, 0.25), (2.0, 1.8, 1.0), GRANITE_DEEP, jitter=0.18)
    start = p.mark()
    p.prism((0, 0, 0), 6, 0.2, 0.15, 10.4, WOOD)
    p.spike((0, 0, 10.4), 0.32, 1.0, COPPER, sides=4)
    p.box((1.9, 0, 9.6), (4.2, 0.18, 0.18), WOOD)
    torn_cloth(p, 0.1, 9.5, 3.8, (5.4, 3.2, 4.6, 2.4, 3.8))
    # The storm's mark, in gold: a bolt.
    for x, z, angle in ((1.7, 8.4, 0.55), (2.1, 7.6, -0.55), (1.8, 6.8, 0.55)):
        p.box((x, -0.2, z), (0.28, 0.08, 1.2), TRIM, roll=angle, pitch=0.14)
    p.turn(start, Matrix.Rotation(0.07, 4, 'Y'))
    return p


def bone_cluster():
    """What is left of something very large that came up here to die."""
    p = piece('Kit_BoneCluster')
    for x, top, tone in ((-2.2, 5.2, BONE), (-0.6, 6.0, BONE_OLD), (1.0, 5.6, BONE), (2.6, 4.4, BONE_OLD)):
        p.sweep(p.bezier((x, 1.2, 0.0), (x + 0.1, 2.2, top * 0.8), (x + 0.3, -1.0, top), steps=6), 0.34, 0.1, tone, sides=5, squash=0.7)
    for k in range(5):
        p.prism((-2.8 + k * 1.4, 1.4, 0.45), 6, 0.55, 0.5, 0.9, BONE_OLD if k % 2 else BONE, axis='X')
        p.box((-2.4 + k * 1.4, 1.4, 1.2), (0.25, 0.3, 0.8), BONE, taper=0.5)
    p.sweep([(-3.6, -1.4, 0.3), (-0.2, -1.9, 0.35)], 0.3, 0.26, BONE, sides=6)
    for x in (-3.7, -0.1):
        p.rock((x, -1.45 if x < -1 else -1.9, 0.35), (0.85, 0.7, 0.6), BONE_OLD, jitter=0.12)
    p.rock((3.2, -0.8, 0.2), (1.4, 1.2, 0.7), GRANITE_DEEP, jitter=0.2)
    return p


def grounding_chain():
    """A heavy chain from a bolt high on the wall to a ringbolt in the floor. Origin at the wall's foot."""
    p = piece('Kit_GroundingChain')
    p.box((0, 0.6, 7.6), (1.2, 1.0, 1.2), IRON, bevel=0.1)
    chain_run(p, (0, 0.2, 7.4), (0, -4.6, 0.8), size=0.78, sag=1.6)
    anchor_ring(p, (0, -4.8, 0.0), r=0.62)
    p.box((0, 0.4, 3.6), (1.0, 0.5, 0.5), VERDIGRIS)
    return p


def storm_shrine():
    """A wayside shrine to the storm, unroofed by it."""
    p = piece('Kit_StormShrine')
    p.box((0, 0.4, 0.3), (5.0, 3.4, 0.6), GRANITE_DARK, bevel=0.1)
    for side, h in ((-1, 4.4), (1, 2.6)):
        p.box((side * 1.9, 0.8, 0.6 + h / 2), (0.9, 0.9, h), GRANITE, bevel=0.1)
    p.box((-0.6, 0.8, 5.3), (3.6, 1.6, 0.5), COPPER, roll=-0.22, bevel=0.05)
    p.box((2.6, -0.9, 0.85), (2.2, 1.2, 0.3), VERDIGRIS, yaw=0.5, roll=0.3, bevel=0.05)
    p.box((0, 1.0, 1.6), (1.6, 0.8, 2.0), GRANITE_DEEP, bevel=0.1)
    crack(p, 0.0, 0.58, 0.8, 2.5, width=0.1, tone=ARC_DIM, wander=0.25)
    p.prism((0, -0.3, 0.6), 8, 0.4, 0.7, 0.45, COPPER)
    p.rock((0, -0.3, 1.1), (0.3, 0.3, 0.26), ARC_DIM, jitter=0.1, mat=GLOW)
    p.box((1.9, 0.8, 3.5), (0.7, 0.7, 0.6), GRANITE_DARK, roll=0.3, bevel=0.1)
    return p


BUILDERS = (lightning_spire, split_menhir, lightning_rod, torn_banner, bone_cluster, grounding_chain, storm_shrine)

if __name__ == '__main__':
    parts = build_kit('StormKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'storm_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_LightningSpire': (0, 12, 0, 0), 'Kit_SplitMenhir': (-20, -2, 0, 0.3), 'Kit_LightningRod': (-13, -5, 0, 0),
            'Kit_TornBanner': (-7, -7, 0, 0), 'Kit_BoneCluster': (1, -7, 0, 0), 'Kit_GroundingChain': (10, -2, 0, 0),
            'Kit_StormShrine': (19, -3, 0, -0.3),
        }, os.path.join(here(__file__), 'storm_kit.png'), background=(0.06, 0.065, 0.075))
