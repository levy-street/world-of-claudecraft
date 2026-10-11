"""The HOARFROST WARDEN room kit: a fortress throne hall frozen in time.

  blender --background --python docs/design/boss-rooms/frost/build_frost_kit.py [-- --preview]

Writes frost_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: nothing here is a thick, lone, vertical pillar of
ice, which is what the Ice Age cover pillars are. Decorative ice is low and wide
(the soldiers' blocks), small and clustered (the icicles, which only hang from
walls), or plainly masonry (the ruin). Glow is a slit in the throne, never a ring.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix  # noqa: E402

STONE = (0.5, 0.56, 0.66)
STONE_DARK = (0.36, 0.41, 0.5)
STONE_DEEP = (0.26, 0.3, 0.38)
ICE = (0.66, 0.86, 0.96)
ICE_DEEP = (0.42, 0.64, 0.82)
FROST = (0.92, 0.96, 1.0)
IRON = (0.4, 0.43, 0.5)
IRON_DARK = (0.25, 0.28, 0.34)
CLOTH = (0.5, 0.3, 0.38)
CLOTH_DARK = (0.36, 0.22, 0.3)
TRIM = (0.66, 0.6, 0.42)
SHADE = (0.13, 0.17, 0.25)
WOOD = (0.36, 0.32, 0.32)
RIME = (0.6, 0.95, 1.0)
RIME_DIM = (0.3, 0.6, 0.72)
COLD = (0.02, 0.06, 0.09)


def piece(name):
    return Piece(name, warm=COLD)


def icicle(p, at, r, length, lean=(0.0, 0.0), tone=ICE):
    p.spike(at, r, -length, tone, sides=5, lean=lean, phase=p.rng.random() * 3)


def icicles(p, x0, x1, y, z, count, longest, r=0.22):
    for i in range(count):
        t = (i + 0.5) / count
        x = x0 + (x1 - x0) * t + (p.rng.random() - 0.5) * 0.3
        length = longest * (0.35 + 0.65 * p.rng.random())
        icicle(p, (x, y + (p.rng.random() - 0.5) * 0.25, z), r * (0.6 + 0.6 * p.rng.random()), length,
               tone=ICE if i % 3 else ICE_DEEP)


def frost(p, center, size, yaw=0.0):
    """A cap of rime on top of something: a thin, bright, slightly oversized slab."""
    p.box(center, size, FROST, bevel=min(size) * 0.3, yaw=yaw)


def sword(p, at, length, yaw, roll, tone=IRON):
    start = p.mark()
    p.box((0, 0, length / 2), (0.22, 0.06, length), tone, taper=0.5)
    p.box((0, 0, length + 0.04), (0.8, 0.12, 0.12), IRON_DARK)
    p.box((0, 0, length + 0.4), (0.12, 0.1, 0.6), WOOD)
    p.turn(start, Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(roll, 4, 'Y'))


def spear(p, at, length, yaw, roll):
    start = p.mark()
    p.prism((0, 0, 0), 5, 0.07, 0.06, length, WOOD)
    p.spike((0, 0, length), 0.16, 0.7, IRON, sides=4)
    p.turn(start, Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(roll, 4, 'Y'))


# --------------------------------------------------------------------- hero
def frozen_throne():
    """A colossal throne cut into the end wall, abandoned to the ice. Back at y = +4."""
    p = piece('Kit_FrozenThrone')
    # Broad steps up to the dais of the throne.
    for i, (w, d, h) in enumerate(((26, 9, 0.9), (21, 7, 0.9), (16, 5.2, 0.9))):
        p.box((0, 0.8 + i * 0.95, 0.45 + i * 0.9), (w, d, h), STONE if i % 2 == 0 else STONE_DARK, bevel=0.12)
        frost(p, (-w * 0.28, -d / 2 + 1.2 + i * 0.95, 0.92 + i * 0.9), (w * 0.3, 0.9, 0.12))
        frost(p, (w * 0.33, -d / 2 + 1.0 + i * 0.95, 0.92 + i * 0.9), (w * 0.18, 0.7, 0.12))
    # The seat, its arms, and the tall back.
    p.box((0, 1.6, 4.0), (7.6, 4.6, 2.6), STONE_DARK, bevel=0.15)
    frost(p, (0, 1.0, 5.36), (6.4, 3.0, 0.16))
    for side in (-1, 1):
        p.box((side * 4.6, 1.6, 5.0), (1.8, 5.0, 4.6), STONE, bevel=0.15)
        p.box((side * 4.6, -0.6, 7.7), (2.2, 1.4, 0.9), STONE_DARK, bevel=0.12)
        frost(p, (side * 4.6, 1.2, 7.4), (1.9, 4.2, 0.16))
        icicles(p, side * 3.8, side * 5.4, -1.2, 7.3, 5, 1.8)
    p.box((0, 3.4, 10.5), (9.0, 1.6, 12.0), STONE, bevel=0.2, taper=0.78)
    p.box((0, 2.5, 10.0), (5.0, 0.4, 8.0), STONE_DEEP, bevel=0.1, taper=0.8)
    # The cold light in the split stone of the back: a slit, never a ring.
    p.box((0, 2.24, 10.2), (0.5, 0.2, 6.4), RIME, mat=GLOW, taper=0.4)
    for side in (-1, 1):
        p.box((side * 1.3, 2.26, 8.6), (0.22, 0.16, 2.6), RIME_DIM, mat=GLOW, roll=side * 0.35)
    # The crest over it, broken: one horn whole, one snapped, its piece fallen on a step.
    p.box((0, 3.4, 17.2), (6.4, 1.4, 1.6), STONE_DARK, bevel=0.15)
    p.box((-3.6, 3.4, 18.6), (1.5, 1.2, 4.4), STONE, roll=0.5, taper=0.35, bevel=0.1)
    p.box((3.2, 3.4, 17.9), (1.5, 1.2, 2.2), STONE, roll=-0.5, bevel=0.1)
    p.box((7.6, -1.6, 1.5), (1.4, 1.1, 2.6), STONE, roll=1.35, yaw=0.5, taper=0.4, bevel=0.1)
    p.prism((0, 2.6, 16.6), 6, 1.5, 1.5, 0.5, STONE_DEEP, axis='Y')
    p.prism((0, 2.5, 16.6), 6, 0.8, 0.8, 0.5, ICE_DEEP, axis='Y')
    frost(p, (0, 3.2, 18.05), (6.0, 1.5, 0.2))
    icicles(p, -4.2, 4.2, 2.5, 16.4, 9, 3.4, r=0.32)
    # Pylons beside it, half eaten by the ice that came down the wall.
    for side in (-1, 1):
        p.box((side * 10.6, 3.0, 6.5), (3.0, 3.0, 13.0), STONE_DARK, bevel=0.2, taper=0.85)
        p.box((side * 10.6, 3.0, 13.4), (3.8, 3.6, 1.0), STONE, bevel=0.15)
        frost(p, (side * 10.6, 2.8, 13.98), (3.6, 3.2, 0.2))
        icicles(p, side * 9.0, side * 12.2, 1.3, 12.9, 6, 2.6, r=0.28)
        # The ice itself: low, wide, faceted sheets leaning on the pylon, not pillars.
        for k, (dx, w, h) in enumerate(((2.6, 3.6, 6.0), (4.6, 3.0, 4.0), (6.2, 2.4, 2.4))):
            p.box((side * (10.6 + dx), 3.2 - k * 0.5, h / 2), (w, 2.6, h), ICE if k % 2 == 0 else ICE_DEEP,
                  taper=0.55, yaw=side * 0.2 * k, roll=side * 0.12, bevel=0.2)
            frost(p, (side * (10.6 + dx), 3.2 - k * 0.5, h + 0.05), (w * 0.6, 1.6, 0.16))
    return p


# ------------------------------------------------------------------- props
def frozen_soldier():
    """A warrior caught in a low, wide block of ice, half his shape standing proud of it."""
    p = piece('Kit_FrozenSoldier')
    start = p.mark()
    p.box((0, 0.5, 1.7), (3.0, 2.0, 3.4), ICE, taper=0.8, bevel=0.22)
    p.box((-1.5, 0.7, 1.0), (1.4, 1.6, 2.0), ICE_DEEP, taper=0.6, yaw=0.3, bevel=0.15)
    p.box((1.45, 0.4, 0.75), (1.2, 1.5, 1.5), ICE_DEEP, taper=0.6, yaw=-0.35, bevel=0.15)
    # The man: legs, body, helm, a raised shield arm, in the dark of deep ice.
    for side in (-1, 1):
        p.box((side * 0.3, -0.5, 0.75), (0.4, 0.22, 1.4), SHADE)
    p.box((0, -0.52, 1.95), (1.05, 0.24, 1.15), SHADE, taper=1.15)
    p.box((0, -0.5, 2.78), (0.5, 0.24, 0.52), SHADE, bevel=0.06)
    p.spike((0, -0.5, 3.0), 0.2, 0.4, SHADE, sides=4)
    p.box((-0.78, -0.56, 1.95), (0.85, 0.16, 1.2), SHADE, bevel=0.1)
    p.box((0.72, -0.5, 2.2), (0.3, 0.2, 0.9), SHADE, roll=-0.5)
    p.box((1.0, -0.5, 1.9), (0.09, 0.12, 3.0), SHADE)
    frost(p, (0, 0.4, 3.42), (2.2, 1.6, 0.2))
    frost(p, (-1.5, 0.7, 2.0), (1.0, 1.1, 0.14))
    p.turn(start, Matrix.Rotation(0.06, 4, 'Y'))
    p.box((0, 0.5, 0.12), (4.4, 3.0, 0.24), FROST, bevel=0.1)
    return p


def frozen_banner():
    """An old war banner, stiff with frost, on a stone foot."""
    p = piece('Kit_FrozenBanner')
    p.box((0, 0, 0.3), (1.5, 1.5, 0.6), STONE_DARK, bevel=0.1, taper=0.8)
    p.prism((0, 0, 0.5), 6, 0.16, 0.13, 8.2, IRON_DARK)
    p.spike((0, 0, 8.7), 0.28, 0.9, IRON, sides=4)
    p.box((0.9, 0, 8.0), (2.4, 0.16, 0.16), IRON_DARK)
    # The cloth, frozen mid-billow: three stiff panels, the last in tatters.
    p.box((1.0, -0.06, 7.0), (1.9, 0.08, 1.9), CLOTH, pitch=0.08)
    p.box((1.0, -0.2, 5.3), (1.9, 0.08, 1.7), CLOTH_DARK, pitch=0.18)
    p.box((1.0, -0.28, 6.1), (0.7, 0.1, 0.7), TRIM, roll=math.pi / 4, pitch=0.12)
    for i, (x, length) in enumerate(((0.3, 1.5), (0.95, 0.8), (1.6, 1.25))):
        p.box((x, -0.36, 4.5 - length / 2), (0.56, 0.08, length), CLOTH if i % 2 else CLOTH_DARK, taper=0.5, pitch=0.22)
    frost(p, (0.9, 0, 8.14), (2.5, 0.3, 0.12))
    icicles(p, 0.1, 1.9, -0.05, 7.9, 5, 0.8, r=0.1)
    frost(p, (0, 0, 0.64), (1.3, 1.3, 0.12))
    return p


def dead_brazier():
    """A brazier no one has lit in an age: snow in the bowl, ice off the rim."""
    p = piece('Kit_DeadBrazier')
    for k in range(3):
        a = k * math.tau / 3 + 0.5
        p.sweep(p.bezier((math.cos(a) * 1.0, math.sin(a) * 1.0, 0), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.2),
                         (math.cos(a) * 0.7, math.sin(a) * 0.7, 2.4), steps=4), 0.1, 0.1, IRON_DARK, sides=4)
    p.prism((0, 0, 2.3), 8, 0.7, 1.35, 0.85, IRON)
    p.prism((0, 0, 3.15), 8, 1.42, 1.42, 0.14, IRON_DARK)
    p.rock((0, 0, 3.3), (2.3, 2.3, 0.9), FROST, jitter=0.1)
    p.rock((0.3, -0.2, 3.62), (0.34, 0.3, 0.2), RIME_DIM, jitter=0.1, mat=GLOW)
    for k in range(7):
        a = k * math.tau / 7
        icicle(p, (math.cos(a) * 1.36, math.sin(a) * 1.36, 3.18), 0.11, 0.5 + 0.7 * p.rng.random())
    p.rock((0.2, 0.1, 0.1), (2.6, 2.4, 0.5), FROST, jitter=0.12)
    return p


def embedded_weapons():
    """Where the hall's guard fell: blades, spears and a shield standing in the snow."""
    p = piece('Kit_EmbeddedWeapons')
    p.rock((0, 0.2, 0.15), (5.0, 3.4, 0.9), FROST, jitter=0.12)
    p.rock((1.2, 0.6, 0.3), (2.2, 1.8, 0.8), FROST, jitter=0.12)
    sword(p, (-1.2, -0.2, 0.1), 2.3, 0.4, 0.22)
    sword(p, (0.2, 0.5, 0.1), 2.7, -0.6, -0.12, IRON_DARK)
    sword(p, (1.7, -0.5, 0.0), 1.9, 1.2, 0.35)
    spear(p, (-0.4, 0.9, 0.0), 5.2, 0.2, -0.2)
    spear(p, (1.1, 0.9, 0.0), 4.6, -0.3, 0.3)
    start = p.mark()
    p.prism((0, 0, 0), 8, 1.0, 0.85, 0.16, STONE_DARK, axis='Y')
    p.prism((0, -0.08, 0), 8, 0.3, 0.2, 0.18, TRIM, axis='Y')
    p.turn(start, Matrix.Translation((-2.0, 0.5, 0.75)) @ Matrix.Rotation(0.5, 4, 'Z') @ Matrix.Rotation(0.45, 4, 'X'))
    frost(p, (-2.0, 0.62, 1.55), (1.3, 0.4, 0.14), yaw=0.5)
    return p


def wall_icicles():
    """Small icicles in a crowd, hung from a lip of frost on the wall. Origin at the lip."""
    p = piece('Kit_WallIcicles')
    p.box((0, 0.4, 0.1), (5.2, 1.2, 0.5), FROST, bevel=0.18)
    p.box((-1.6, 0.5, 0.5), (2.2, 1.0, 0.5), FROST, bevel=0.18)
    icicles(p, -2.4, 2.4, 0.0, 0.0, 11, 2.6, r=0.2)
    icicles(p, -2.0, 2.0, 0.5, 0.0, 8, 1.6, r=0.16)
    return p


def frozen_ruin():
    """Masonry the ice is taking: a run of broken wall, a fallen drum of column."""
    p = piece('Kit_FrozenRuin')
    for i, (x, w, h) in enumerate(((-2.6, 2.4, 4.6), (-0.4, 2.2, 3.2), (1.7, 2.2, 1.8))):
        p.box((x, 0.8, h / 2), (w, 1.5, h), STONE if i % 2 == 0 else STONE_DARK, bevel=0.12)
        frost(p, (x, 0.7, h + 0.06), (w * 0.9, 1.4, 0.18))
    p.box((-2.6, 0.02, 3.1), (1.2, 0.2, 1.8), STONE_DEEP, bevel=0.05)
    p.prism((2.4, -1.2, 0.7), 8, 0.7, 0.7, 2.2, STONE, axis='X', phase=0.3)
    p.prism((-0.2, -1.6, 0.0), 8, 0.78, 0.74, 0.7, STONE_DARK)
    frost(p, (-0.2, -1.6, 0.74), (1.1, 1.1, 0.12))
    p.box((-3.7, 0.6, 1.3), (1.6, 2.0, 2.6), ICE_DEEP, taper=0.5, yaw=0.3, bevel=0.2)
    p.box((0.7, 1.0, 0.9), (1.6, 1.4, 1.8), ICE, taper=0.5, yaw=-0.3, bevel=0.2)
    icicles(p, -3.4, -1.6, 0.0, 4.5, 5, 1.2, r=0.13)
    return p


BUILDERS = (frozen_throne, frozen_soldier, frozen_banner, dead_brazier, embedded_weapons, wall_icicles, frozen_ruin)

if __name__ == '__main__':
    parts = build_kit('FrostKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'frost_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_FrozenThrone': (0, 10, 0, 0), 'Kit_FrozenSoldier': (-20, -2, 0, 0.3), 'Kit_FrozenBanner': (-13, -5, 0, 0),
            'Kit_DeadBrazier': (-6, -7, 0, 0), 'Kit_EmbeddedWeapons': (2, -7, 0, 0), 'Kit_WallIcicles': (10, -5, 7, 0),
            'Kit_FrozenRuin': (19, -3, 0, -0.3),
        }, os.path.join(here(__file__), 'frost_kit.png'), background=(0.05, 0.07, 0.1))
