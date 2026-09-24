"""The ARCHON NYXARIS room kit: an observatory that tore the sky open.

  blender --background --python docs/design/boss-rooms/void/build_void_kit.py [-- --preview]

Writes void_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: Nyxaris telegraphs in bright purple CIRCLES ON THE
FLOOR. So the violet here is vertical and small (rune lines, candle flames, the rim
of the tear), it lives above the ground on props at the walls, and no piece lays a
glowing disc or ring flat on the floor.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix  # noqa: E402

STONE = (0.52, 0.57, 0.76)
STONE_DARK = (0.38, 0.42, 0.6)
STONE_DEEP = (0.27, 0.3, 0.46)
BRONZE = (0.7, 0.6, 0.6)
BRONZE_DARK = (0.5, 0.43, 0.5)
VOID = (0.03, 0.025, 0.07)
GLASS = (0.12, 0.12, 0.27)
CRACK = (0.36, 0.4, 0.62)
WAX = (0.74, 0.72, 0.82)
PAGE = (0.78, 0.76, 0.7)
LEATHER = (0.32, 0.22, 0.4)
VIOLET = (0.72, 0.46, 1.0)
VIOLET_DIM = (0.4, 0.27, 0.7)
STAR = (0.85, 0.88, 1.0)
COLD = (0.03, 0.02, 0.08)


def piece(name):
    return Piece(name, warm=COLD)


def rune(p, at, length, angle=0.0, tone=VIOLET_DIM, y_thick=0.06):
    """One engraved stroke on a front face: a thin lit bar in the XZ plane."""
    p.box(at, (0.09, y_thick, length), tone, mat=GLOW, roll=angle)


def star(p, at, size=0.12, tone=STAR):
    p.box(at, (size, size, size), tone, mat=GLOW, roll=math.pi / 4)


def slab(p, at, size, tone, yaw=0.0, roll=0.0, pitch=0.0):
    p.box(at, size, tone, yaw=yaw, roll=roll, pitch=pitch, bevel=min(size) * 0.18)


def obelisk_body(p, height, base=1.0, top=0.56, tone=STONE_DARK):
    p.prism((0, 0, 0), 4, base, top, height, tone, phase=math.pi / 4)
    face = lambda z: -(base - (base - top) * z / height) * math.cos(math.pi / 4) - 0.02
    return face


# --------------------------------------------------------------------- hero
def armillary():
    """The broken armillary: great rings round a tear in the sky. Back at y = +4."""
    p = piece('Kit_Armillary')
    for i, (r, h) in enumerate(((10.5, 0.8), (8.2, 0.8), (6.0, 0.9))):
        p.prism((0, 1.0, i * 0.8), 8, r, r - 0.5, h, STONE if i % 2 == 0 else STONE_DARK, phase=math.pi / 8, squash=0.62)
    # The cradle: two horns of stone that held the rings. One has snapped.
    p.sweep(p.bezier((-6.2, 1.2, 2.2), (-11.5, 1.2, 6.5), (-8.6, 1.2, 14.2), steps=7), 1.15, 0.5, STONE_DARK, sides=6)
    p.sweep(p.bezier((6.2, 1.2, 2.2), (10.8, 1.2, 5.0), (10.4, 1.2, 8.4), steps=5), 1.15, 0.85, STONE_DARK, sides=6)
    slab(p, (10.2, 0.6, 11.2), (1.5, 1.4, 2.4), STONE_DARK, roll=0.5, yaw=0.4)
    slab(p, (9.0, 0.2, 13.6), (1.0, 0.9, 1.5), STONE, roll=-0.4)
    # The rings: two whole, tilted through each other; the inner one broken open.
    centre = (0, 1.0, 10.6)
    p.ring(centre, 8.0, 0.55, BRONZE, segments=24, tilt=(0.25, 0.0, 0.1), width=0.7)
    p.ring(centre, 6.4, 0.5, BRONZE_DARK, segments=20, tilt=(-0.55, 0.7, 0.0), width=0.6)
    p.ring(centre, 4.9, 0.45, BRONZE, segments=18, arc=(0.5, 5.0), tilt=(0.95, -0.5, 0.5), width=0.55)
    slab(p, (4.4, -1.6, 5.2), (1.6, 0.5, 0.45), BRONZE, roll=0.8, yaw=0.5)
    slab(p, (5.6, -2.4, 3.4), (1.2, 0.5, 0.45), BRONZE_DARK, roll=-0.3, yaw=-0.4)
    # The tear: darker than anything in the room, a thin violet rim, a few stars in it.
    p.rock(centre, (3.0, 1.0, 6.6), VOID, jitter=0.12, subdivisions=2)
    for side, z0, z1, lean in ((-1, 8.0, 13.2, 0.18), (1, 7.6, 12.6, -0.14), (-1, 12.6, 14.4, 0.5), (1, 12.2, 14.0, -0.55)):
        p.box((side * 1.5 + lean, 0.45, (z0 + z1) / 2), (0.16, 0.12, z1 - z0), VIOLET, mat=GLOW, roll=lean, taper=0.3)
    for x, z, s in ((-0.5, 11.6, 0.16), (0.4, 9.8, 0.12), (0.1, 12.6, 0.1), (-0.3, 8.9, 0.1), (0.7, 11.0, 0.09)):
        star(p, (x, 0.42, z), s)
    # What floats round it, held where it broke.
    for x, y, z, s in ((-4.6, -0.8, 5.0, 1.3), (-6.4, 0.4, 16.4, 1.0), (3.2, -0.4, 16.0, 1.2), (6.8, -1.0, 7.0, 0.8),
                       (-2.2, -1.2, 3.6, 0.7), (1.6, 0.2, 17.6, 0.6)):
        p.rock((x, y, z), (s, s * 0.8, s * 0.7), STONE if s > 0.9 else STONE_DEEP, jitter=0.25)
    # The hall's back wall behind it: two tall broken slabs, their engraving still lit.
    for side, h in ((-1, 15.0), (1, 11.5)):
        p.box((side * 14.2, 3.0, h / 2), (5.6, 1.8, h), STONE_DEEP, taper=0.82, bevel=0.2)
        p.box((side * 14.2, 2.0, h * 0.42), (3.4, 0.3, h * 0.6), STONE_DARK, bevel=0.08)
        for k in range(4):
            rune(p, (side * 14.2 + (k - 1.5) * 0.7, 1.8, h * 0.3 + k * 0.9), 1.4 + 0.5 * (k % 2), angle=0.5 * (-1) ** k)
        star(p, (side * 14.2, 1.78, h * 0.62), 0.2, VIOLET)
    return p


# ------------------------------------------------------------------- props
def rune_obelisk():
    """A dark obelisk that hangs half a yard off the floor. Origin under its foot: it hovers."""
    p = piece('Kit_RuneObelisk')
    face = obelisk_body(p, 6.0)
    p.spike((0, 0, 6.0), 0.56, 1.3, STONE, sides=4, phase=math.pi / 4)
    for k, (z, length, angle) in enumerate(((1.2, 0.9, 0.0), (2.2, 0.7, 0.8), (3.0, 0.9, -0.6), (3.9, 0.6, 0.0), (4.7, 0.7, 1.57))):
        rune(p, (0.0 if k % 2 == 0 else 0.12, face(z), z), length, angle)
    for x, y, z, s in ((0.3, 0.2, -0.45, 0.5), (-0.5, -0.2, -0.8, 0.36), (0.1, -0.4, -1.1, 0.26)):
        p.rock((x, y, z), (s, s, s * 0.8), STONE_DEEP, jitter=0.25)
    return p


def rune_obelisk_broken():
    """The second obelisk: snapped, its head held in the air above the break. It hovers."""
    p = piece('Kit_RuneObeliskBroken')
    face = obelisk_body(p, 3.4, top=0.75)
    p.box((0.2, 0, 3.5), (0.9, 0.9, 0.5), STONE_DARK, roll=0.3, taper=0.4)
    for z, length, angle in ((1.0, 0.8, 0.6), (2.0, 0.9, 0.0), (2.8, 0.5, -0.8)):
        rune(p, (0, face(z), z), length, angle)
    start = p.mark()
    p.prism((0, 0, 0), 4, 0.74, 0.5, 2.2, STONE_DARK, phase=math.pi / 4)
    p.spike((0, 0, 2.2), 0.5, 1.1, STONE, sides=4, phase=math.pi / 4)
    rune(p, (0, -0.5, 1.0), 0.8, 0.0, VIOLET)
    p.turn(start, Matrix.Translation((0.5, 0, 4.7)) @ Matrix.Rotation(0.28, 4, 'Y'))
    for x, y, z, s in ((-0.5, 0.1, 4.0, 0.3), (0.9, -0.3, 4.2, 0.22), (-0.2, 0.3, -0.5, 0.45), (0.4, -0.3, -0.9, 0.3)):
        p.rock((x, y, z), (s, s, s * 0.8), STONE_DEEP, jitter=0.25)
    return p


def floating_fragments():
    """Pieces of the old floor, lifted and held. Origin on the ground below: it hovers."""
    p = piece('Kit_FloatingFragments')
    for x, y, z, w, d, yaw, roll in ((0, 0, 1.4, 2.2, 1.7, 0.3, 0.12), (-1.6, 0.6, 2.8, 1.5, 1.2, -0.5, -0.2),
                                     (1.5, -0.4, 3.6, 1.3, 1.0, 0.9, 0.25), (0.3, 0.8, 4.8, 1.0, 0.8, 0.1, -0.3),
                                     (-0.9, -0.7, 0.7, 1.0, 0.9, 1.2, 0.1)):
        slab(p, (x, y, z), (w, d, 0.42), STONE if z > 2 else STONE_DARK, yaw=yaw, roll=roll)
        p.rock((x, y, z - 0.35), (w * 0.6, d * 0.6, 0.5), STONE_DEEP, jitter=0.25)
    for x, y, z, s in ((0.9, 0.5, 2.2, 0.3), (-0.4, -0.3, 3.9, 0.24), (1.9, 0.3, 1.1, 0.26), (-1.8, -0.2, 1.7, 0.2)):
        p.rock((x, y, z), (s, s, s), STONE_DEEP, jitter=0.3)
    star(p, (0, -0.3, 1.64), 0.1, VIOLET_DIM)
    return p


def broken_mirror():
    """A scrying mirror, shattered: its glass shows a darker sky than the room's."""
    p = piece('Kit_BrokenMirror')
    p.box((0, 0.2, 0.3), (5.0, 1.6, 0.6), STONE_DARK, bevel=0.1)
    for side in (-1, 1):
        p.box((side * 1.95, 0.2, 3.9), (0.5, 0.6, 6.6), BRONZE_DARK, bevel=0.08)
    p.ring((0, 0.2, 7.2), 1.95, 0.5, BRONZE, segments=14, arc=(0.0, math.pi), width=0.6)
    p.box((0, 0.3, 3.9), (3.5, 0.12, 6.6), GLASS)
    p.prism((0, 0.36, 7.2), 12, 1.72, 1.72, 0.12, GLASS, axis='Y')
    # The breaks, and the corner that fell out of it.
    for x, z, length, angle in ((-0.3, 4.6, 3.4, 0.5), (0.5, 5.6, 2.2, -0.7), (-0.8, 2.6, 2.0, -0.3), (0.7, 3.0, 1.6, 0.9)):
        p.box((x, 0.22, z), (0.05, 0.04, length), CRACK, roll=angle)
    p.box((1.1, 0.2, 1.3), (1.5, 0.16, 1.7), VOID, roll=0.5, taper=0.2)
    for x, z, s in ((-0.9, 5.4, 0.1), (0.3, 6.6, 0.08), (1.0, 4.2, 0.07), (-0.4, 3.4, 0.07), (0.6, 7.6, 0.06)):
        star(p, (x, 0.2, z), s)
    for x, y, yaw in ((1.6, -1.0, 0.4), (0.7, -1.5, 1.3), (2.3, -0.5, -0.5)):
        p.box((x, y, 0.06), (0.9, 0.5, 0.06), GLASS, yaw=yaw, taper=0.3)
    return p


def void_candles():
    """A stand of spectral candles: small violet flames, the room's only fire."""
    p = piece('Kit_VoidCandles')
    p.prism((0, 0, 0), 6, 0.8, 0.6, 0.4, STONE_DARK)
    p.prism((0, 0, 0.4), 6, 0.22, 0.18, 2.2, BRONZE_DARK)
    p.prism((0, 0, 2.6), 6, 0.35, 0.95, 0.3, BRONZE)
    for x, y, h in ((0, 0, 1.0), (-0.55, 0.15, 0.7), (0.5, -0.2, 0.5), (0.1, 0.55, 0.6)):
        p.prism((x, y, 2.9), 6, 0.13, 0.12, h, WAX)
        p.spike((x, y, 2.95 + h), 0.11, 0.42, VIOLET, sides=4, mat=GLOW)
    return p


def lectern():
    """A reader's stand, the book lifted off it, a few leaves gone further."""
    p = piece('Kit_Lectern')
    p.box((0, 0.2, 0.25), (2.4, 2.0, 0.5), STONE_DARK, bevel=0.1)
    p.box((0, 0.3, 1.7), (1.0, 0.9, 2.6), STONE, taper=0.8, bevel=0.08)
    p.box((0, 0.1, 3.2), (2.2, 1.5, 0.3), STONE_DARK, pitch=0.45, bevel=0.06)
    for side in (-1, 1):
        p.box((side * 0.55, -0.1, 4.25), (1.0, 1.3, 0.16), LEATHER, pitch=0.45, roll=side * 0.2)
        p.box((side * 0.52, -0.14, 4.35), (0.88, 1.16, 0.08), PAGE, pitch=0.45, roll=side * 0.2)
    rune(p, (-0.5, -0.62, 4.2), 0.4, 0.4, VIOLET)
    rune(p, (0.5, -0.62, 4.2), 0.4, -0.4, VIOLET)
    for x, y, z, yaw, roll in ((0.9, -0.2, 5.3, 0.4, 0.5), (-0.7, 0.2, 5.9, -0.6, -0.3), (0.2, 0.4, 6.6, 1.1, 0.7)):
        p.box((x, y, z), (0.6, 0.8, 0.03), PAGE, yaw=yaw, roll=roll)
    return p


def rune_wall():
    """A length of the observatory's wall, its star chart still faintly alight."""
    p = piece('Kit_RuneWall')
    for i, (x, w, h) in enumerate(((-2.2, 2.4, 6.2), (0.1, 2.4, 4.8), (2.3, 2.2, 2.6))):
        p.box((x, 0.8, h / 2), (w, 1.4, h), STONE_DARK if i % 2 == 0 else STONE, bevel=0.12)
    p.box((-1.0, 0.04, 3.0), (3.6, 0.2, 3.6), STONE_DEEP, bevel=0.05)
    p.ring((-1.0, -0.08, 3.0), 1.3, 0.07, VIOLET_DIM, segments=16, width=0.06, mat=GLOW)
    for k in range(8):
        a = k * math.tau / 8
        rune(p, (-1.0 + math.sin(a) * 0.75, -0.1, 3.0 + math.cos(a) * 0.75), 0.7 if k % 2 == 0 else 0.4, -a)
    star(p, (-1.0, -0.12, 3.0), 0.16, VIOLET)
    for x, y, z, s, yaw in ((2.8, -1.2, 0.35, 1.2, 0.4), (1.4, -1.6, 0.25, 0.9, -0.3), (-3.4, -0.6, 0.3, 1.0, 0.8)):
        slab(p, (x, y, z), (s, s * 0.8, 0.6), STONE, yaw=yaw, roll=0.2)
    return p


BUILDERS = (armillary, rune_obelisk, rune_obelisk_broken, floating_fragments, broken_mirror, void_candles, lectern, rune_wall)

if __name__ == '__main__':
    parts = build_kit('VoidKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'void_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_Armillary': (0, 10, 0, 0), 'Kit_RuneObelisk': (-20, -2, 0.6, 0.2), 'Kit_RuneObeliskBroken': (-15, -5, 0.6, -0.2),
            'Kit_FloatingFragments': (-9, -6, 0, 0), 'Kit_BrokenMirror': (-2, -7, 0, 0), 'Kit_VoidCandles': (5, -8, 0, 0),
            'Kit_Lectern': (10, -7, 0, 0), 'Kit_RuneWall': (19, -3, 0, -0.3),
        }, os.path.join(here(__file__), 'void_kit.png'), background=(0.025, 0.03, 0.07))
