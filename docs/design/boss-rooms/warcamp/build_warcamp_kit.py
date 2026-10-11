"""The WARLORD GRASK room kit: a war camp dug into the hoard.

  blender --background --python docs/design/boss-rooms/warcamp/build_warcamp_kit.py [-- --preview]

Writes warcamp_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: Grask's boulders roll the length of the room, so
everything here is wall furniture. Nothing in the kit is round and boulder-sized,
nothing is grey rolling-stone coloured at that scale, and the only fire is small
and sits in a pit against the wall.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix  # noqa: E402

TIMBER = (0.56, 0.41, 0.28)
TIMBER_DARK = (0.4, 0.3, 0.22)
TIMBER_PALE = (0.72, 0.58, 0.4)
IRON = (0.4, 0.38, 0.38)
IRON_DARK = (0.26, 0.25, 0.26)
HIDE = (0.74, 0.58, 0.4)
HIDE_DARK = (0.55, 0.4, 0.28)
RED = (0.7, 0.22, 0.17)
RED_DARK = (0.48, 0.16, 0.14)
BONE = (0.86, 0.82, 0.7)
BONE_OLD = (0.68, 0.64, 0.54)
SOCKET = (0.12, 0.09, 0.08)
STONE = (0.5, 0.45, 0.4)
ASH = (0.2, 0.18, 0.17)
ROPE = (0.62, 0.5, 0.33)
FIRE = (1.0, 0.55, 0.16)
FIRE_CORE = (1.0, 0.82, 0.4)
WARM = (0.1, 0.05, 0.0)


def piece(name):
    return Piece(name, warm=WARM)


def log(p, at, r, height, tone=TIMBER, lean=(0.0, 0.0), point=True):
    """A palisade stake: a rough log, hewn to a point, its cut wood paler."""
    p.prism(at, 6, r, r * 0.9, height, tone, lean=lean, phase=p.rng.random())
    if point:
        p.spike((at[0] + lean[0], at[1] + lean[1], at[2] + height), r * 0.9, r * 2.4, TIMBER_PALE, sides=6)


def stakes(p, x0, x1, y, height, r=0.55, tone=TIMBER):
    count = max(1, round((x1 - x0) / (r * 1.8)))
    for i in range(count):
        x = x0 + (i + 0.5) * (x1 - x0) / count
        h = height * (0.9 + 0.2 * p.rng.random())
        log(p, (x, y + (p.rng.random() - 0.5) * 0.2, 0), r * (0.9 + 0.2 * p.rng.random()), h,
            tone if i % 3 else TIMBER_DARK, lean=((p.rng.random() - 0.5) * 0.3, 0))


def skull(p, at, s=1.0, yaw=0.0, horns=False):
    start = p.mark()
    p.rock((0, 0, 0), (0.62 * s, 0.7 * s, 0.6 * s), BONE, jitter=0.08)
    p.box((0, -0.26 * s, -0.3 * s), (0.4 * s, 0.34 * s, 0.26 * s), BONE_OLD, taper=0.8)
    for side in (-1, 1):
        p.box((side * 0.14 * s, -0.31 * s, 0.02), (0.15 * s, 0.1 * s, 0.15 * s), SOCKET)
        if horns:
            p.sweep(p.bezier((side * 0.26 * s, 0, 0.1 * s), (side * 0.8 * s, 0, 0.2 * s), (side * 0.9 * s, -0.1 * s, 0.8 * s), steps=4),
                    0.11 * s, 0.03 * s, BONE_OLD, sides=4)
    p.turn(start, Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z'))


def banner(p, x, z_top, width, length, y=0.0, emblem=True):
    p.box((x, y, z_top - length * 0.42), (width, 0.1, length * 0.84), RED, pitch=0.04)
    for i in range(3):
        drop = length * (0.3 if i == 1 else 0.2)
        p.box((x + (i - 1) * width / 3, y - 0.03, z_top - length * 0.84 - drop / 2), (width / 3 * 0.94, 0.1, drop), RED_DARK if i % 2 else RED, taper=0.3)
    if emblem:
        # Grask's mark: a crude fist of three black bars over a bar.
        for i in range(3):
            p.box((x + (i - 1) * width * 0.2, y - 0.08, z_top - length * 0.34), (width * 0.12, 0.06, length * 0.3), SOCKET)
        p.box((x, y - 0.08, z_top - length * 0.58), (width * 0.62, 0.06, length * 0.1), SOCKET)


def flames(p, at, r, height):
    for k in range(5):
        a = k * math.tau / 5
        p.spike((at[0] + math.cos(a) * r * 0.5, at[1] + math.sin(a) * r * 0.5, at[2]), r * 0.5, height * (0.6 + 0.4 * (k % 2)), FIRE,
                sides=4, mat=GLOW, lean=(math.cos(a) * 0.1, math.sin(a) * 0.1))
    p.spike(at, r * 0.55, height * 1.15, FIRE_CORE, sides=4, mat=GLOW)


# --------------------------------------------------------------------- hero
def warlord_gate():
    """The Warlord Gate: a palisade across the end of the room, a gate no one is let
    through, his banner over it, his trophies on it. Back at y = +3."""
    p = piece('Kit_WarlordGate')
    stakes(p, -18, -5.6, 1.6, 9.0, r=0.7)
    stakes(p, 5.6, 18, 1.6, 9.0, r=0.7)
    for side in (-1, 1):
        p.box((side * 11.8, 0.85, 5.2), (12.6, 0.4, 0.6), TIMBER_DARK, roll=side * 0.03)
        p.box((side * 11.8, 0.85, 2.4), (12.6, 0.4, 0.6), TIMBER_DARK, roll=-side * 0.02)
    # The gate: two great leaves of plank, banded in iron, barred.
    for side in (-1, 1):
        log(p, (side * 5.4, 1.2, 0), 0.95, 12.6, TIMBER_DARK, point=False)
        p.box((side * 5.4, 1.2, 12.9), (2.4, 2.4, 0.7), IRON_DARK, bevel=0.1)
        for k in range(4):
            p.box((side * (0.65 + k * 1.2), 1.0, 5.0), (1.14, 0.5, 10.0), TIMBER if (k + (side > 0)) % 2 else TIMBER_DARK, bevel=0.05)
        for z in (2.0, 5.2, 8.4):
            p.box((side * 2.5, 0.7, z), (4.9, 0.16, 0.6), IRON, bevel=0.04)
            for k in range(3):
                p.prism((side * (0.9 + k * 1.6), 0.6, z), 5, 0.16, 0.08, 0.14, IRON_DARK, axis='Y')
    p.box((0, 0.5, 3.6), (8.6, 0.5, 0.7), TIMBER_PALE, bevel=0.08, roll=0.02)
    p.box((0, 1.2, 11.2), (12.4, 1.4, 1.5), TIMBER_DARK, bevel=0.12)
    # His banner, and what he hangs beside it.
    p.box((0, 0.3, 17.4), (8.4, 0.3, 0.34), TIMBER)
    for side in (-1, 1):
        p.box((side * 3.9, 0.3, 14.6), (0.34, 0.34, 6.0), TIMBER_DARK)
    banner(p, 0, 17.2, 6.4, 8.6, y=0.1)
    skull(p, (0, 0.2, 12.4), 2.2, horns=True)
    for side in (-1, 1):
        skull(p, (side * 5.4, 0.4, 13.7), 1.2)
        skull(p, (side * 8.6, 1.0, 10.4), 0.9, yaw=side * 0.3)
        skull(p, (side * 13.0, 1.0, 10.1), 0.8, yaw=-side * 0.2)
    # Rough watch stands either side, a fire basket on each.
    for side in (-1, 1):
        for dx, dy in ((-1.6, -1.6), (1.6, -1.6), (-1.6, 1.0), (1.6, 1.0)):
            log(p, (side * 14.2 + dx, dy, 0), 0.34, 9.6, TIMBER_DARK, lean=(-dx * 0.12, -dy * 0.08), point=False)
        p.box((side * 14.2, -0.3, 9.7), (4.6, 4.0, 0.4), TIMBER, bevel=0.06)
        p.box((side * 14.2, -2.2, 10.7), (4.6, 0.24, 1.2), TIMBER_DARK)
        for k in range(4):
            p.box((side * 14.2 - 1.8 + k * 1.2, -2.3, 10.6), (0.9, 0.14, 1.9), HIDE_DARK if k % 2 else HIDE, taper=0.7)
        p.prism((side * 14.2, 0.2, 10.0), 6, 0.5, 0.85, 0.9, IRON_DARK)
        flames(p, (side * 14.2, 0.2, 10.8), 0.7, 1.6)
        p.box((side * 16.0, -1.0, 4.8), (0.3, 0.3, 10.0), TIMBER_DARK, roll=side * 0.32)
    return p


# ------------------------------------------------------------------- props
def palisade():
    """A run of stakes, braced from behind, a shield hung on it."""
    p = piece('Kit_Palisade')
    stakes(p, -3.4, 3.4, 0.6, 5.6, r=0.5)
    p.box((0, 0.1, 3.2), (6.9, 0.3, 0.5), TIMBER_DARK, roll=0.03)
    p.box((0, 0.1, 1.4), (6.9, 0.3, 0.5), TIMBER_DARK, roll=-0.02)
    p.box((-2.0, -1.3, 1.6), (0.3, 3.4, 0.3), TIMBER, pitch=-0.8)
    p.box((2.2, -1.3, 1.6), (0.3, 3.4, 0.3), TIMBER, pitch=-0.8)
    p.prism((0.6, -0.12, 3.0), 8, 0.85, 0.75, 0.16, RED_DARK, axis='Y')
    p.prism((0.6, -0.26, 3.0), 6, 0.26, 0.16, 0.16, IRON, axis='Y')
    return p


def skull_stake():
    """A stake of old trophies."""
    p = piece('Kit_SkullStake')
    p.rock((0, 0, 0.15), (1.3, 1.2, 0.6), STONE, jitter=0.2)
    log(p, (0, 0, 0), 0.2, 6.2, TIMBER_DARK, lean=(0.3, 0))
    p.box((0.2, 0, 4.2), (2.6, 0.18, 0.18), TIMBER, roll=0.1)
    skull(p, (0.32, -0.1, 6.0), 1.0, horns=True)
    skull(p, (-0.9, -0.12, 3.7), 0.7, yaw=0.3)
    skull(p, (1.35, -0.12, 3.9), 0.75, yaw=-0.3)
    p.box((0.15, -0.15, 3.0), (0.5, 0.1, 1.6), RED_DARK, taper=0.4)
    for z in (1.4, 2.6):
        p.prism((0.1, 0, z), 6, 0.27, 0.27, 0.16, ROPE)
    return p


def war_drum():
    """A war drum the height of a man, its beaters leant on it."""
    p = piece('Kit_WarDrum')
    for side in (-1, 1):
        p.box((side * 1.5, 0, 1.0), (0.3, 2.6, 0.3), TIMBER_DARK)
        for dy in (-1.0, 1.0):
            p.box((side * 1.5, dy, 1.0), (0.3, 0.3, 2.0), TIMBER_DARK, pitch=dy * 0.25)
    start = p.mark()
    p.prism((0, 0, -1.2), 10, 1.55, 1.55, 2.4, TIMBER)
    for z in (-1.1, 0.0, 1.1):
        p.prism((0, 0, z - 0.08), 10, 1.62, 1.62, 0.16, IRON_DARK)
    p.prism((0, 0, 1.2), 10, 1.66, 1.5, 0.14, HIDE)
    p.prism((0, 0, -1.34), 10, 1.5, 1.66, 0.14, HIDE_DARK)
    p.prism((0, 0, 1.33), 6, 0.6, 0.5, 0.03, RED_DARK)
    p.turn(start, Matrix.Translation((0, 0, 2.1)) @ Matrix.Rotation(1.05, 4, 'X'))
    for x, lean in ((2.1, -0.35), (2.5, -0.2)):
        p.box((x, -0.6, 1.2), (0.13, 0.13, 2.4), TIMBER_PALE, roll=lean)
        p.rock((x + math.sin(-lean) * -1.25, -0.6, 2.35), (0.4, 0.4, 0.4), HIDE_DARK, jitter=0.08)
    return p


def campfire():
    """A fire pit against the wall: the camp's small light. Embers rise from it."""
    p = piece('Kit_Campfire')
    p.prism((0, 0, 0), 10, 1.9, 1.7, 0.08, ASH)
    for k in range(9):
        a = k * math.tau / 9
        p.rock((math.cos(a) * 1.35, math.sin(a) * 1.35, 0.22), (0.7, 0.6, 0.5), STONE, jitter=0.2)
    for k in range(4):
        a = k * math.tau / 4 + 0.4
        p.box((math.cos(a) * 0.4, math.sin(a) * 0.4, 0.45), (0.26, 1.7, 0.26), TIMBER_DARK if k % 2 else ASH, yaw=a + math.pi / 2, pitch=0.5)
    flames(p, (0, 0, 0.35), 0.62, 1.7)
    for side in (-1, 1):
        p.box((side * 1.9, 0, 1.2), (0.14, 0.14, 2.4), IRON_DARK, roll=side * 0.12)
    p.box((0, 0, 2.3), (4.0, 0.1, 0.1), IRON_DARK)
    p.prism((0, 0, 1.65), 8, 0.45, 0.55, 0.5, IRON)
    return p


def prison_cage():
    """A cage of iron and timber. Whoever it held is past caring."""
    p = piece('Kit_PrisonCage')
    p.box((0, 0, 0.2), (3.6, 3.2, 0.4), TIMBER_DARK, bevel=0.06)
    p.box((0, 0, 4.0), (3.6, 3.2, 0.36), TIMBER_DARK, bevel=0.06)
    for x in (-1.6, -0.8, 0.0, 0.8, 1.6):
        for y in (-1.4, 1.4):
            p.box((x, y, 2.1), (0.13, 0.13, 3.5), IRON if x else IRON_DARK)
    for y in (-0.7, 0.0, 0.7):
        for x in (-1.6, 1.6):
            p.box((x, y, 2.1), (0.13, 0.13, 3.5), IRON_DARK)
    for z in (1.4, 2.9):
        p.box((0, -1.42, z), (3.5, 0.12, 0.2), IRON_DARK)
    p.box((0.9, -1.55, 2.1), (0.5, 0.2, 0.6), IRON, bevel=0.05)
    skull(p, (-0.5, -0.2, 0.7), 0.7, yaw=0.5)
    p.sweep([(0.2, 0.4, 0.5), (1.1, -0.3, 0.5)], 0.09, 0.09, BONE_OLD, sides=4)
    p.ring((0, 0, 4.7), 0.5, 0.14, IRON_DARK, segments=8)
    return p


def weapon_rack():
    """The camp's arms: axes and spears racked, a shield against them."""
    p = piece('Kit_WeaponRack')
    for side in (-1, 1):
        p.box((side * 2.0, 0.3, 1.6), (0.3, 0.3, 3.2), TIMBER_DARK, pitch=0.12)
        p.box((side * 2.0, -0.5, 0.15), (0.3, 1.8, 0.3), TIMBER_DARK)
    for z in (1.2, 2.8):
        p.box((0, 0.2 + z * 0.12, z), (4.4, 0.22, 0.26), TIMBER)
    for x, h in ((-1.4, 5.4), (-0.7, 5.0)):
        p.prism((x, -0.1, 0.05), 5, 0.07, 0.06, h, TIMBER_PALE, lean=(0, h * 0.12))
        p.spike((x, -0.1 + h * 0.12, h), 0.17, 0.75, IRON, sides=4)
    for x, h in ((0.2, 3.6), (1.1, 3.9)):
        p.prism((x, -0.1, 0.05), 5, 0.09, 0.08, h, TIMBER_DARK, lean=(0, h * 0.12))
        p.box((x + 0.36, -0.1 + h * 0.11, h - 0.5), (0.85, 0.1, 1.0), IRON, taper=1.5, bevel=0.03)
        p.box((x - 0.24, -0.1 + h * 0.11, h - 0.5), (0.4, 0.1, 0.5), IRON_DARK, taper=0.4)
    start = p.mark()
    p.prism((0, 0, 0), 8, 1.0, 0.9, 0.18, RED_DARK, axis='Y')
    p.prism((0, -0.14, 0), 6, 0.3, 0.18, 0.18, IRON, axis='Y')
    p.turn(start, Matrix.Translation((2.0, -0.95, 1.0)) @ Matrix.Rotation(0.3, 4, 'X'))
    return p


def broken_cart():
    """A supply cart that has made its last trip."""
    p = piece('Kit_BrokenCart')
    start = p.mark()
    p.box((0, 0, 1.2), (4.4, 2.4, 0.24), TIMBER, bevel=0.04)
    for side in (-1, 1):
        p.box((0, side * 1.15, 1.75), (4.4, 0.16, 0.9), TIMBER_DARK if side > 0 else TIMBER)
    p.box((2.15, 0, 1.75), (0.16, 2.4, 0.9), TIMBER_DARK)
    p.box((-3.4, 0.5, 1.15), (2.6, 0.18, 0.18), TIMBER_DARK)
    p.box((-3.4, -0.5, 1.15), (2.6, 0.18, 0.18), TIMBER_DARK)
    p.ring((1.0, 1.4, 1.1), 1.05, 0.2, TIMBER_DARK, segments=10, width=0.2)
    for k in range(4):
        p.box((1.0, 1.4, 1.1), (0.12, 0.12, 2.0), TIMBER_PALE, roll=k * math.pi / 4)
    p.turn(start, Matrix.Translation((0, 0.3, -0.15)) @ Matrix.Rotation(-0.24, 4, 'X') @ Matrix.Rotation(0.1, 4, 'Y'))
    start = p.mark()
    p.ring((0, 0, 0), 1.05, 0.2, TIMBER_DARK, segments=10, width=0.2)
    for k in range(4):
        p.box((0, 0, 0), (0.12, 0.12, 2.0), TIMBER_PALE, roll=k * math.pi / 4)
    p.turn(start, Matrix.Translation((1.4, -2.2, 0.16)) @ Matrix.Rotation(math.pi / 2 - 0.12, 4, 'X'))
    for x, y, s in ((-0.6, 0.2, 0.8), (0.5, -0.2, 0.7), (1.3, 0.4, 0.62)):
        p.box((x, y + 0.3, 1.3 + s / 2), (s * 1.3, s, s), HIDE_DARK if s > 0.7 else HIDE, bevel=s * 0.2, yaw=x)
    return p


def hanging_trophies():
    """Skulls strung on a chain from the wall. Origin at the hang point: it sways."""
    p = piece('Kit_HangingTrophies')
    p.box((0, 0.2, 0.1), (0.6, 0.6, 0.3), IRON, bevel=0.05)
    for i in range(8):
        p.box((0, 0, -(i + 0.5) * 0.46), (0.3, 0.12, 0.55), IRON_DARK, yaw=(math.pi / 2) * (i % 2), bevel=0.03)
    skull(p, (0.05, -0.1, -1.5), 0.75, yaw=0.3)
    skull(p, (-0.1, -0.12, -2.7), 0.85, yaw=-0.4)
    skull(p, (0.0, -0.1, -3.95), 0.95, horns=True)
    p.box((0, -0.05, -4.9), (0.4, 0.08, 1.0), RED_DARK, taper=0.3)
    return p


BUILDERS = (warlord_gate, palisade, skull_stake, war_drum, campfire, prison_cage, weapon_rack, broken_cart, hanging_trophies)

if __name__ == '__main__':
    parts = build_kit('WarcampKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'warcamp_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_WarlordGate': (0, 12, 0, 0), 'Kit_Palisade': (-24, 0, 0, 0.3), 'Kit_SkullStake': (-17, -4, 0, 0),
            'Kit_WarDrum': (-12, -6, 0, 0), 'Kit_Campfire': (-6, -8, 0, 0), 'Kit_PrisonCage': (0, -7, 0, 0),
            'Kit_WeaponRack': (7, -7, 0, 0), 'Kit_BrokenCart': (14, -5, 0, 0), 'Kit_HangingTrophies': (20, -3, 6.5, 0),
        }, os.path.join(here(__file__), 'warcamp_kit.png'), background=(0.09, 0.07, 0.05))
