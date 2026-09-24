"""The XARRETH room kit: a cathedral of the dead, found buried in the cavern.

  blender --background --python docs/design/boss-rooms/crypt/build_crypt_kit.py [-- --preview]

Writes crypt_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: Xarreth's scythe sweeps wide arcs through the whole
floor. So the kit is wall architecture only, nothing in it is a long curved blade
shape lying flat, and the spectral green is a candle flame's worth, held high.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix  # noqa: E402

STONE = (0.62, 0.64, 0.7)
STONE_DARK = (0.46, 0.48, 0.55)
STONE_DEEP = (0.31, 0.33, 0.4)
BONE = (0.88, 0.86, 0.75)
BONE_OLD = (0.68, 0.66, 0.58)
HOLLOW = (0.08, 0.09, 0.1)
IRON = (0.3, 0.31, 0.34)
WAX = (0.8, 0.78, 0.68)
SPECTRAL = (0.45, 1.0, 0.62)
SPECTRAL_DIM = (0.2, 0.52, 0.34)
COLD = (0.02, 0.04, 0.05)


def piece(name):
    return Piece(name, warm=COLD)


def skull(p, at, s=1.0, yaw=0.0, tone=BONE):
    start = p.mark()
    p.rock((0, 0, 0), (0.62 * s, 0.7 * s, 0.6 * s), tone, jitter=0.08)
    p.box((0, -0.26 * s, -0.3 * s), (0.4 * s, 0.34 * s, 0.26 * s), BONE_OLD, taper=0.8)
    for side in (-1, 1):
        p.box((side * 0.14 * s, -0.31 * s, 0.02), (0.15 * s, 0.1 * s, 0.15 * s), HOLLOW)
    p.turn(start, Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z'))


def long_bone(p, a, b, r=0.1):
    p.sweep([a, b], r, r * 0.9, BONE_OLD, sides=4)
    for end in (a, b):
        p.rock(end, (r * 3, r * 3, r * 2.4), BONE, jitter=0.1)


def pointed_arch(p, x, y, spring, half, thickness, tone, width=None, broken=False):
    """A gothic arch: two arcs struck from the opposite springing points."""
    p.ring((x + half, y, spring), 2 * half, thickness, tone, segments=30, arc=(2 * math.pi / 3, math.pi), width=width)
    end = math.pi / 3 * (0.55 if broken else 1.0)
    p.ring((x - half, y, spring), 2 * half, thickness, tone, segments=30, arc=(0, end), width=width)


def candle(p, at, h, flame=SPECTRAL):
    p.prism(at, 6, 0.13, 0.12, h, WAX)
    p.spike((at[0], at[1], at[2] + h + 0.04), 0.12, 0.46, flame, sides=4, mat=GLOW)


def drum(p, at, r, h, tone):
    """One drum of a fluted column."""
    p.prism(at, 10, r, r, h, tone, phase=p.rng.random())
    p.prism((at[0], at[1], at[2] + h - 0.12), 10, r * 1.08, r * 1.08, 0.12, STONE_DEEP)


# --------------------------------------------------------------------- hero
def ossuary_altar():
    """The Ossuary Altar under its broken rose window. Back at y = +4."""
    p = piece('Kit_OssuaryAltar')
    for i, (w, d, h) in enumerate(((24, 9, 0.8), (19, 7, 0.8), (14, 5.2, 0.9))):
        p.box((0, 0.6 + i * 0.9, 0.4 + i * 0.8), (w, d, h), STONE if i % 2 == 0 else STONE_DARK, bevel=0.12)
    # The altar: a block of stone faced in the skulls of those it was raised for.
    p.box((0, 1.6, 4.0), (9.0, 3.0, 3.2), STONE_DARK, bevel=0.15)
    p.box((0, 1.6, 5.8), (10.2, 3.6, 0.5), STONE, bevel=0.1)
    for row in range(2):
        for k in range(8):
            skull(p, (-3.85 + k * 1.1 + (0.2 if row else 0), 0.0, 3.2 + row * 1.15), 0.95, yaw=(k % 3 - 1) * 0.12, tone=BONE if (k + row) % 2 else BONE_OLD)
    for side in (-1, 1):
        long_bone(p, (side * 4.9, 0.1, 2.6), (side * 4.92, 0.1, 5.4), 0.13)
        candle(p, (side * 3.8, 1.0, 6.05), 1.0)
        candle(p, (side * 3.1, 1.6, 6.05), 0.6, SPECTRAL_DIM)
    skull(p, (0, 1.2, 6.5), 1.6)
    # The frame of the window: two piers, a pointed arch over them.
    for side in (-1, 1):
        p.box((side * 9.4, 3.0, 6.0), (2.6, 2.6, 12.0), STONE_DARK, bevel=0.2)
        p.box((side * 9.4, 3.0, 12.4), (3.3, 3.1, 0.9), STONE, bevel=0.12)
        for z in (3.2, 6.4, 9.6):
            skull(p, (side * 9.4, 1.6, z), 1.0, tone=BONE_OLD)
    pointed_arch(p, 0, 3.0, 12.8, 9.4, 1.5, STONE, width=2.2, broken=True)
    p.box((7.0, -1.2, 1.9), (3.4, 1.8, 1.5), STONE, yaw=0.5, roll=0.3, bevel=0.15)
    p.box((10.6, -2.4, 1.0), (2.2, 1.6, 1.3), STONE_DARK, yaw=-0.3, roll=-0.2, bevel=0.15)
    # The rose: a great wheel of stone, its glass gone but for a few green panes.
    centre = (0, 3.2, 15.2)
    p.ring(centre, 6.2, 0.9, STONE, segments=24, arc=(0.0, math.tau * 0.86), width=1.2)
    p.ring(centre, 2.2, 0.5, STONE_DARK, segments=12, width=1.0)
    for k in range(8):
        a = k * math.tau / 8
        if k == 7:
            continue
        mid = 4.2
        p.box((math.cos(a) * mid, 3.2, 15.2 + math.sin(a) * mid), (0.45, 0.8, 3.6), STONE_DARK, roll=-(a - math.pi / 2))
    for a, r, s in ((0.4, 4.0, 1.5), (2.0, 4.3, 1.2), (3.6, 3.9, 1.6), (4.6, 4.2, 1.0)):
        p.box((math.cos(a) * r, 3.5, 15.2 + math.sin(a) * r), (s, 0.1, s * 1.2), SPECTRAL_DIM, mat=GLOW, roll=a, taper=0.5)
    p.box((0, 3.6, 15.2), (1.4, 0.1, 1.4), SPECTRAL, mat=GLOW, roll=math.pi / 4)
    return p


# ------------------------------------------------------------------- props
def tombstones():
    """A huddle of old gravestones, no two standing the same."""
    p = piece('Kit_Tombstones')
    p.rock((0, 0.4, 0.1), (6.4, 3.0, 0.6), STONE_DEEP, jitter=0.15)
    for x, y, w, h, roll, tone in ((-2.2, 0.6, 1.5, 2.6, 0.1, STONE), (-0.4, 0.9, 1.7, 3.2, -0.05, STONE_DARK), (1.5, 0.5, 1.4, 2.2, -0.16, STONE),
                                   (2.7, -0.4, 1.2, 1.7, 0.22, STONE_DARK), (-1.2, -0.7, 1.2, 1.5, -0.1, STONE)):
        start = p.mark()
        p.box((0, 0, h / 2), (w, 0.4, h), tone, bevel=0.06)
        p.prism((0, -0.2, h), 10, w / 2, w / 2, 0.4, tone, axis='Y')
        p.box((0, -0.22, h * 0.62), (w * 0.12, 0.06, h * 0.4), STONE_DEEP)
        p.box((0, -0.22, h * 0.7), (w * 0.44, 0.06, h * 0.08), STONE_DEEP)
        p.turn(start, Matrix.Translation((x, y, 0)) @ Matrix.Rotation(roll, 4, 'Y') @ Matrix.Rotation(roll * 0.6, 4, 'X'))
    skull(p, (0.4, -1.0, 0.45), 0.8, yaw=0.5)
    return p


def sarcophagus():
    """A sarcophagus, opened from the inside. Its lid lies in two pieces."""
    p = piece('Kit_Sarcophagus')
    p.box((0, 0.4, 0.3), (6.2, 3.2, 0.6), STONE_DARK, bevel=0.1)
    p.box((0, 0.4, 1.4), (5.4, 2.4, 1.8), STONE, bevel=0.1, taper=1.06)
    p.box((0, 0.4, 2.26), (4.8, 1.8, 0.12), HOLLOW)
    for k in range(5):
        p.box((-2.0 + k * 1.0, -0.84, 1.4), (0.5, 0.1, 1.1), STONE_DEEP, bevel=0.03)
    p.box((-1.2, -1.9, 1.0), (2.9, 0.4, 2.6), STONE_DARK, pitch=0.5, roll=0.1, bevel=0.06)
    p.box((2.2, -2.4, 0.26), (2.4, 2.4, 0.4), STONE_DARK, yaw=0.4, roll=0.06, bevel=0.06)
    long_bone(p, (0.6, 0.0, 2.4), (1.9, -0.9, 2.5), 0.09)
    long_bone(p, (3.4, -1.0, 0.2), (4.1, -0.1, 0.2), 0.09)
    skull(p, (-0.6, 0.2, 2.6), 0.85, yaw=-0.3)
    return p


def bone_candelabrum():
    """A tall candle stand, half iron, half bone. Its flames burn green."""
    p = piece('Kit_BoneCandelabrum')
    p.prism((0, 0, 0), 6, 0.95, 0.6, 0.5, STONE_DARK)
    for z in (0.5, 2.3, 4.1):
        p.prism((0, 0, z), 5, 0.13, 0.11, 1.7, BONE_OLD)
        p.rock((0, 0, z + 1.75), (0.44, 0.44, 0.3), BONE, jitter=0.1)
    for k in range(3):
        a = k * math.tau / 3 + 0.5
        tip = (math.cos(a) * 1.5, math.sin(a) * 1.5, 6.6)
        p.sweep(p.bezier((0, 0, 5.4), (math.cos(a) * 1.5, math.sin(a) * 1.5, 5.2), tip, steps=4), 0.12, 0.06, BONE, sides=4)
        p.prism((tip[0], tip[1], 6.6), 6, 0.3, 0.2, 0.12, IRON)
        candle(p, (tip[0], tip[1], 6.7), 0.7)
    skull(p, (0, -0.1, 6.1), 0.8)
    candle(p, (0, 0, 6.5), 0.9)
    return p


def broken_column():
    """A cathedral column, snapped a few drums up."""
    p = piece('Kit_BrokenColumn')
    p.box((0, 0, 0.35), (3.2, 3.2, 0.7), STONE_DARK, bevel=0.1)
    for i in range(4):
        drum(p, (0.03 * i, 0, 0.7 + i * 1.7), 1.15, 1.7, STONE if i % 2 == 0 else STONE_DARK)
    p.prism((0.2, 0, 7.5), 10, 1.15, 0.7, 1.1, STONE, lean=(0.5, 0.2))
    return p


def fallen_column():
    """The other column: two drums standing, the rest where they fell along the wall."""
    p = piece('Kit_FallenColumn')
    p.box((-2.6, 0.4, 0.35), (3.2, 3.2, 0.7), STONE_DARK, bevel=0.1)
    for i in range(2):
        drum(p, (-2.6, 0.4, 0.7 + i * 1.7), 1.15, 1.7, STONE_DARK if i % 2 == 0 else STONE)
    for i, (x, y, yaw) in enumerate(((0.6, -0.4, 0.15), (2.7, -0.1, 0.05), (5.0, 0.5, -0.3))):
        start = p.mark()
        p.prism((-0.85, 0, 0), 10, 1.15, 1.15, 1.7, STONE if i % 2 else STONE_DARK, axis='X')
        p.turn(start, Matrix.Translation((x, y, 1.1)) @ Matrix.Rotation(yaw, 4, 'Z'))
    skull(p, (1.6, -1.6, 0.4), 0.8, yaw=0.4)
    return p


def skull_pile():
    """An ossuary heap, stacked neatly once."""
    p = piece('Kit_SkullPile')
    p.rock((0, 0.4, 0.3), (4.4, 2.8, 1.2), BONE_OLD, jitter=0.12)
    layers = (((-1.5, -0.4), (-0.5, -0.6), (0.5, -0.5), (1.5, -0.3), (-1.0, 0.5), (0.0, 0.4), (1.0, 0.6)),
              ((-0.9, -0.2), (0.0, -0.3), (0.9, -0.1), (-0.4, 0.5), (0.5, 0.5)), ((-0.3, 0.0), (0.45, 0.1)), ((0.05, 0.05),))
    for level, spots in enumerate(layers):
        for k, (x, y) in enumerate(spots):
            skull(p, (x, y, 0.6 + level * 0.62), 0.92, yaw=((k * 7 + level) % 5 - 2) * 0.25, tone=BONE if (k + level) % 2 else BONE_OLD)
    long_bone(p, (-2.4, -0.9, 0.2), (-1.0, -1.4, 0.2), 0.09)
    long_bone(p, (1.2, -1.3, 0.2), (2.5, -0.7, 0.2), 0.09)
    return p


def crypt_arch():
    """A gothic arch of the nave, one shoulder of it fallen."""
    p = piece('Kit_CryptArch')
    for side, h in ((-1, 6.0), (1, 6.0)):
        p.box((side * 3.4, 0.8, h / 2), (1.5, 1.6, h), STONE_DARK, bevel=0.12)
        p.box((side * 3.4, 0.8, h + 0.25), (2.0, 2.0, 0.5), STONE, bevel=0.1)
    pointed_arch(p, 0, 0.8, 6.4, 3.4, 0.9, STONE, width=1.3, broken=True)
    p.box((0, 1.5, 3.2), (5.4, 0.4, 6.4), STONE_DEEP)
    for z in (1.6, 3.2, 4.8):
        skull(p, (0.9 * ((z * 10) % 3 - 1), 1.2, z), 0.8, tone=BONE_OLD)
    p.box((2.4, -1.4, 0.5), (1.8, 1.2, 0.9), STONE, yaw=0.5, roll=0.2, bevel=0.1)
    p.box((4.4, -0.9, 0.35), (1.2, 1.0, 0.7), STONE_DARK, yaw=-0.4, bevel=0.1)
    return p


def hanging_censer():
    """A censer on a long chain, still smouldering green. Origin at the hang point: it sways."""
    p = piece('Kit_HangingCenser')
    p.box((0, 0.2, 0.1), (0.5, 0.5, 0.3), IRON, bevel=0.05)
    for i in range(9):
        p.box((0, 0, -(i + 0.5) * 0.44), (0.26, 0.1, 0.52), IRON, yaw=(math.pi / 2) * (i % 2), bevel=0.03)
    p.prism((0, 0, -4.9), 8, 0.2, 0.62, 0.5, IRON)
    p.prism((0, 0, -5.5), 8, 0.62, 0.3, 0.6, IRON)
    p.prism((0, 0, -4.95), 8, 0.5, 0.5, 0.1, SPECTRAL_DIM, mat=GLOW)
    p.spike((0, 0, -5.5), 0.2, -0.5, BONE_OLD, sides=4)
    return p


BUILDERS = (ossuary_altar, tombstones, sarcophagus, bone_candelabrum, broken_column, fallen_column, skull_pile, crypt_arch, hanging_censer)

if __name__ == '__main__':
    parts = build_kit('CryptKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'crypt_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_OssuaryAltar': (0, 12, 0, 0), 'Kit_Tombstones': (-24, 0, 0, 0.3), 'Kit_Sarcophagus': (-16, -5, 0, 0),
            'Kit_BoneCandelabrum': (-9, -7, 0, 0), 'Kit_BrokenColumn': (-4, -7, 0, 0), 'Kit_FallenColumn': (3, -8, 0, 0),
            'Kit_SkullPile': (11, -7, 0, 0), 'Kit_CryptArch': (19, -2, 0, -0.3), 'Kit_HangingCenser': (25, -4, 7, 0),
        }, os.path.join(here(__file__), 'crypt_kit.png'), background=(0.06, 0.065, 0.075))
