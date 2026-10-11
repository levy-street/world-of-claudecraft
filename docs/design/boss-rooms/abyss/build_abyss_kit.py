"""The ABYSSAL MAW room kit: a flooded sea cave a leviathan died in.

  blender --background --python docs/design/boss-rooms/abyss/build_abyss_kit.py [-- --preview]

Writes abyss_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rules this kit keeps: the turquoise glow is small and dim next to the
Maw's own wave and tentacle telegraphs, the kelp is flat and hangs from above (a
tentacle is round and rises from the floor), and the wrecked chest is smashed open
and lidless so it never reads as a reward chest.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

# Well above the dark they grade down to in the room.
ROCK = (0.4, 0.52, 0.54)
ROCK_DARK = (0.28, 0.38, 0.4)
BONE = (0.86, 0.88, 0.8)
BONE_OLD = (0.68, 0.72, 0.66)
CORAL = (0.66, 0.54, 0.62)
CORAL_PALE = (0.78, 0.76, 0.7)
CORAL_DEEP = (0.42, 0.58, 0.58)
IRON = (0.52, 0.36, 0.28)
IRON_DARK = (0.34, 0.26, 0.24)
WOOD = (0.46, 0.37, 0.3)
WOOD_DARK = (0.32, 0.27, 0.24)
BRASS = (0.62, 0.52, 0.28)
BARNACLE = (0.74, 0.74, 0.64)
BARNACLE_MOUTH = (0.08, 0.1, 0.11)
KELP = (0.2, 0.5, 0.36)
KELP_DARK = (0.14, 0.36, 0.28)
STALK = (0.2, 0.42, 0.44)
LURE = (0.25, 0.95, 0.84)
LURE_DIM = (0.12, 0.55, 0.5)
COLD = (0.0, 0.05, 0.05)


def piece(name):
    return Piece(name, warm=COLD)


def coral(p, base, height, spread, color, depth=2, radius=0.5, tilt=(0.0, 0.0)):
    """A dead branching coral: a bent trunk that forks, each fork thinner and paler."""
    base = Vector(base)
    top = base + Vector((tilt[0] * height, tilt[1] * height, height))
    bend = (base + top) / 2 + Vector(((p.rng.random() - 0.5) * spread, (p.rng.random() - 0.5) * spread * 0.4, 0))
    points = p.bezier(base, bend, top, steps=4)
    p.sweep(points, radius, radius * 0.55, color, sides=5)
    if depth <= 0:
        return
    forks = 2 if depth == 1 else 3
    for k in range(forks):
        at = points[2 + (k % 2)]
        lean = ((k - (forks - 1) / 2) * 0.75 + (p.rng.random() - 0.5) * 0.3, (p.rng.random() - 0.5) * 0.35)
        coral(p, at, height * (0.5 + 0.15 * p.rng.random()), spread * 0.7, color, depth - 1, radius * 0.55, lean)


def rib(p, foot, knee, tip, r0, r1, color=BONE, steps=8):
    p.sweep(p.bezier(foot, knee, tip, steps=steps), r0, r1, color, sides=5, squash=0.7)


def barnacle(p, at, r, h, lean=(0.0, 0.0)):
    p.prism(at, 6, r, r * 0.55, h, BARNACLE, lean=lean, phase=p.rng.random())
    top = (at[0] + lean[0], at[1] + lean[1], at[2] + h - 0.02)
    p.prism(top, 6, r * 0.42, r * 0.3, 0.05, BARNACLE_MOUTH, phase=p.rng.random())


def chain(p, top, links, size=0.5, color=IRON_DARK, drift=(0.0, 0.0)):
    """Links hanging down from `top`: slabs turned a quarter each, read as chain."""
    for i in range(links):
        z = top[2] - (i + 0.5) * size * 0.78
        p.box((top[0] + drift[0] * i, top[1] + drift[1] * i, z), (size * 0.55, size * 0.2, size), color,
              yaw=(math.pi / 2) * (i % 2), bevel=size * 0.05)


def polyp(p, at, height, glow=LURE):
    tip = (at[0] + (p.rng.random() - 0.5) * 0.5, at[1] + (p.rng.random() - 0.5) * 0.5, at[2] + height)
    knee = ((at[0] + tip[0]) / 2 + 0.2, (at[1] + tip[1]) / 2, at[2] + height * 0.6)
    p.sweep(p.bezier(at, knee, tip, steps=4), 0.09, 0.05, STALK, sides=4)
    p.rock(tip, (0.3, 0.3, 0.36), glow, jitter=0.08, subdivisions=1, mat=GLOW)


# --------------------------------------------------------------------- hero
def leviathan_arch():
    """The grave arch: a leviathan's rib cage standing in black rock, dead coral
    grown through it, a ship's hull caught in its right side. Back at y = +4."""
    p = piece('Kit_LeviathanArch')
    # The rock it stands in, rising to the wall behind.
    for x, y, z, sx, sy, sz in (
        (-12.5, 1.8, 1.6, 8, 6, 5.5), (-6.5, 2.6, 2.2, 8, 5, 7), (0, 3.2, 2.6, 9, 4, 8.5),
        (6.5, 2.6, 2.0, 8, 5, 6.5), (12.5, 1.8, 1.7, 8, 6, 5.5), (-15.5, 2.6, 4.5, 5, 4, 11),
        (15.8, 2.8, 4.0, 5, 4, 10), (-9, 0.2, 0.7, 4, 3, 2.2), (9.5, 0.0, 0.6, 4, 3, 2.0),
    ):
        p.rock((x, y, z), (sx, sy, sz), ROCK if sz < 8 else ROCK_DARK, jitter=0.22)
    # The ribs: pairs from front to back, the back ones taller, meeting over the middle.
    for i in range(5):
        y = -1.6 + i * 1.15
        top = 12.5 + i * 0.8
        reach = 10.5 + i * 0.5
        tone = BONE if i % 2 == 0 else BONE_OLD
        for side in (-1, 1):
            if i == 1 and side > 0:
                # One rib broke long ago: a stump, and its end lying in the rock.
                rib(p, (side * reach, y, 0.5), (side * (reach + 1.8), y, top * 0.55), (side * (reach - 1.5), y, top * 0.72), 0.95, 0.75, tone, steps=5)
                continue
            rib(p, (side * reach, y, 0.5), (side * (reach + 2.2), y, top * 0.95), (side * 0.9, y, top), 0.95, 0.32, tone)
    # The spine over them, running back into the wall.
    for k in range(6):
        y = -2.0 + k * 1.2
        z = 12.9 + k * 0.78
        p.prism((0, y - 0.45, z), 6, 0.95, 0.8, 0.9, BONE_OLD, axis='Y')
        p.box((0, y, z + 1.0), (0.3, 0.5, 1.3), BONE, taper=0.5)
    # Its skull, fallen forward onto the first ribs, looking down the room.
    start = p.mark()
    p.box((0, 0, 0), (4.4, 6.4, 2.6), BONE, taper=0.6, bevel=0.3)
    p.box((0, -4.4, -0.5), (2.6, 3.4, 1.5), BONE_OLD, taper=0.7, bevel=0.2)
    for side in (-1, 1):
        p.box((side * 0.95, -1.9, 0.72), (0.8, 1.3, 0.9), BARNACLE_MOUTH, yaw=side * 0.3)
        p.box((side * 2.0, 0.6, -1.7), (0.7, 4.6, 1.3), BONE_OLD, bevel=0.12)
        for k in range(5):
            p.spike((side * (1.15 - k * 0.06), -5.6 + k * 0.85, -1.2), 0.24, -1.1 - 0.18 * (k % 2), BONE, sides=4)
    p.turn(start, Matrix.Translation((0, -4.4, 13.4)) @ Matrix.Rotation(-0.5, 4, 'X'))
    # Dead coral grown through the cage.
    coral(p, (-13.5, -0.4, 3.2), 5.5, 2.2, CORAL, depth=2, radius=0.55)
    coral(p, (-5.2, 0.6, 4.6), 4.2, 1.8, CORAL_PALE, depth=2, radius=0.42)
    coral(p, (4.2, 0.8, 4.2), 3.6, 1.6, CORAL_DEEP, depth=2, radius=0.4)
    coral(p, (16.2, 0.2, 3.2), 4.6, 2.0, CORAL, depth=2, radius=0.5)
    # A hull caught in the right side: keel ribs, planking, a snapped mast.
    start = p.mark()
    for k in range(5):
        x = -3.2 + k * 1.6
        p.sweep(p.bezier((x, -2.2, 3.6), (x, -2.6, 0.2), (x, 0, -0.4), steps=5), 0.16, 0.16, WOOD_DARK, sides=4)
    for row in range(4):
        z = 0.5 + row * 0.85
        length = 7.4 - row * 0.9 - (1.4 if row == 2 else 0)
        p.box((-0.3 + row * 0.35, -2.3 - 0.13 * (3 - row), z), (length, 0.14, 0.7), WOOD if row % 2 else WOOD_DARK, bevel=0.04)
    p.box((0.4, -0.4, -0.2), (8.2, 0.5, 0.5), WOOD_DARK, bevel=0.06)
    p.turn(start, Matrix.Translation((11.2, -1.4, 2.2)) @ Matrix.Rotation(0.5, 4, 'Z') @ Matrix.Rotation(-0.3, 4, 'Y'))
    p.prism((8.8, -1.0, 1.0), 7, 0.36, 0.26, 10.5, WOOD, lean=(3.4, 1.6))
    p.box((11.2, 0.2, 9.0), (4.6, 0.22, 0.3), WOOD_DARK, roll=0.35)
    # The little light there is: polyps at the feet of the ribs, a few up in the cage.
    for x, y, z, h in ((-10.8, -2.4, 1.3, 1.4), (-9.6, -2.9, 0.9, 1.0), (10.2, -3.2, 1.0, 1.2),
                       (-3.4, -0.6, 5.6, 1.1), (2.6, -0.3, 6.0, 0.9), (-14.6, -1.6, 2.4, 1.2)):
        polyp(p, (x, y, z), h, LURE if h > 1.0 else LURE_DIM)
    for x, y, z, r in ((-7.6, -1.2, 3.0, 0.6), (-6.7, -1.5, 2.6, 0.42), (7.4, -1.6, 2.4, 0.55), (13.8, -1.9, 2.2, 0.5)):
        barnacle(p, (x, y, z), r, r * 1.5, lean=(0.1, -0.12))
    return p


# ------------------------------------------------------------------- props
def coral_column():
    """A broken column of dead coral, snapped near the top."""
    p = piece('Kit_CoralColumn')
    p.rock((0, 0.3, 0.5), (3.4, 2.8, 1.6), ROCK, jitter=0.2)
    p.sweep(p.bezier((0, 0.3, 0.4), (0.7, 0.3, 3.4), (-0.3, 0.2, 6.6), steps=5), 0.95, 0.62, CORAL, sides=6)
    p.prism((-0.3, 0.2, 6.5), 6, 0.66, 0.5, 0.25, CORAL_PALE)
    coral(p, (0.4, 0.1, 2.6), 3.2, 1.4, CORAL_PALE, depth=2, radius=0.4, tilt=(0.7, -0.1))
    coral(p, (-0.2, 0.2, 4.0), 2.8, 1.2, CORAL, depth=1, radius=0.36, tilt=(-0.8, 0.0))
    coral(p, (0.0, 0.0, 5.2), 2.4, 1.0, CORAL_PALE, depth=1, radius=0.3, tilt=(0.35, -0.2))
    barnacle(p, (0.9, -0.7, 0.9), 0.4, 0.6, lean=(0.08, -0.1))
    barnacle(p, (-1.1, -0.5, 0.8), 0.32, 0.5, lean=(-0.08, -0.08))
    return p


def coral_shelf():
    """The low variation: plates of dead table coral stepping up a rock."""
    p = piece('Kit_CoralShelf')
    p.rock((0, 0.6, 0.9), (4.2, 3.0, 2.6), ROCK_DARK, jitter=0.2)
    for x, y, z, r, tone in ((-0.9, -0.5, 1.5, 1.7, CORAL_DEEP), (0.8, -0.2, 2.3, 1.45, CORAL),
                             (-0.2, 0.3, 3.1, 1.2, CORAL_PALE), (1.5, -0.9, 1.0, 1.0, CORAL_PALE)):
        p.prism((x, y, z - 0.5), 5, 0.3, 0.42, 0.5, tone)
        p.prism((x, y, z), 8, r * 0.7, r, 0.22, tone, squash=0.8, phase=p.rng.random())
    coral(p, (-1.6, 0.4, 1.6), 2.2, 1.0, CORAL, depth=1, radius=0.26, tilt=(-0.3, 0))
    polyp(p, (1.9, -1.3, 0.3), 0.9, LURE_DIM)
    return p


def anchor():
    """A ship's anchor leant on the wall, its chain heaped at its foot."""
    p = piece('Kit_Anchor')
    start = p.mark()
    p.box((0, 0, 2.9), (0.42, 0.36, 5.0), IRON, bevel=0.06)
    p.box((0, 0, 4.9), (3.0, 0.34, 0.36), IRON_DARK, bevel=0.05)
    p.ring((0, 0, 5.95), 0.55, 0.16, IRON_DARK, segments=8)
    for side in (-1, 1):
        p.sweep(p.bezier((0, 0, 0.35), (side * 1.3, 0, 0.1), (side * 2.1, 0, 1.5), steps=5), 0.26, 0.2, IRON, sides=5)
        p.box((side * 2.12, 0, 1.7), (0.85, 0.2, 1.0), IRON_DARK, roll=-side * 0.55, taper=0.25)
    p.turn(start, Matrix.Translation((0, 1.5, 0.15)) @ Matrix.Rotation(0.34, 4, 'X') @ Matrix.Rotation(0.12, 4, 'Y'))
    # Chain slumped from the ring to a heap on the floor.
    for i, (x, y, z) in enumerate(p.bezier((0.7, -0.2, 5.2), (1.6, -0.8, 1.2), (1.9, -1.6, 0.25), steps=9)):
        p.box((x, y, z), (0.34, 0.14, 0.62), IRON_DARK, yaw=(math.pi / 2) * (i % 2), pitch=0.5, bevel=0.03)
    for i in range(7):
        a = i * 0.9
        p.box((1.9 + math.cos(a) * 0.55, -1.7 + math.sin(a) * 0.5, 0.16 + 0.1 * (i % 2)), (0.6, 0.3, 0.14), IRON_DARK, yaw=a + math.pi / 2, bevel=0.03)
    for x, y, z, r in ((-0.35, 0.6, 1.6, 0.26), (0.3, 0.9, 2.5, 0.2), (-1.7, 0.7, 1.1, 0.24)):
        barnacle(p, (x, y, z), r, r * 1.3, lean=(0, -0.1))
    return p


def hanging_chain():
    """A chain hung from the rock. Its origin is its hang point: it sways."""
    p = piece('Kit_HangingChain')
    p.box((0, 0.1, 0.1), (0.5, 0.5, 0.3), IRON, bevel=0.05)
    chain(p, (0, 0, 0), 9, size=0.62)
    p.ring((0, 0, -4.85), 0.5, 0.15, IRON, segments=8)
    barnacle(p, (0.1, -0.12, -3.2), 0.16, 0.2, lean=(0.02, -0.05))
    return p


def barnacles():
    """Oversized abyssal barnacles crusting a lump of rock."""
    p = piece('Kit_Barnacles')
    p.rock((0, 0.4, 0.5), (3.2, 2.4, 1.5), ROCK_DARK, jitter=0.2)
    for x, y, z, r, h, lean in (
        (0.0, 0.0, 0.9, 0.78, 1.5, (0.1, -0.2)), (-1.0, -0.3, 0.6, 0.6, 1.1, (-0.25, -0.2)),
        (1.0, -0.1, 0.7, 0.55, 1.0, (0.3, -0.15)), (0.4, -0.95, 0.3, 0.45, 0.8, (0.05, -0.3)),
        (-0.5, 0.75, 1.0, 0.5, 0.9, (-0.1, 0.1)), (-1.5, 0.5, 0.4, 0.36, 0.6, (-0.2, 0.0)),
        (1.55, 0.6, 0.4, 0.4, 0.7, (0.2, 0.05)), (-0.35, -1.2, 0.15, 0.3, 0.5, (-0.05, -0.2)),
    ):
        barnacle(p, (x, y, z), r, h, lean=lean)
    return p


def wreckage():
    """What the sea kept of a ship: a smashed, lidless chest, planks, fittings."""
    p = piece('Kit_Wreckage')
    # The chest: on its side, staved in, its lid gone. Never a reward chest.
    start = p.mark()
    p.box((0, 0, 0.1), (1.7, 1.1, 0.12), WOOD_DARK)
    p.box((0, 0.5, 0.55), (1.7, 0.1, 0.9), WOOD)
    p.box((-0.8, 0, 0.55), (0.1, 1.1, 0.9), WOOD_DARK)
    p.box((0.8, 0, 0.4), (0.1, 1.1, 0.6), WOOD)
    p.box((-0.2, -0.5, 0.3), (1.0, 0.1, 0.4), WOOD_DARK, roll=0.15)
    for x in (-0.55, 0.55):
        p.box((x, 0.52, 0.55), (0.12, 0.13, 0.94), IRON_DARK)
    p.turn(start, Matrix.Translation((-0.7, 0.4, 0.25)) @ Matrix.Rotation(0.35, 4, 'Z') @ Matrix.Rotation(-0.42, 4, 'Y'))
    # Planks, a rib of the hull, a barrel hoop, a few dull coins of brass.
    for x, y, z, length, yaw, roll in ((1.4, 0.6, 0.12, 3.4, 0.5, 0.0), (1.9, -0.5, 0.2, 2.6, -0.3, 0.12),
                                       (-1.9, -0.8, 0.1, 2.2, 1.2, 0.0), (0.6, 1.3, 0.6, 3.0, 0.15, 0.4)):
        p.box((x, y, z), (length, 0.5, 0.12), WOOD if roll else WOOD_DARK, yaw=yaw, roll=roll, bevel=0.03)
    p.sweep(p.bezier((2.6, 1.2, 0.0), (2.9, 1.0, 1.6), (2.2, 0.4, 2.6), steps=5), 0.15, 0.1, WOOD_DARK, sides=4)
    p.ring((-2.3, 0.6, 0.55), 0.55, 0.08, IRON, segments=10, tilt=(0.25, 0, 0.6), width=0.14)
    for x, y in ((0.3, -0.9), (0.55, -1.1), (0.1, -1.25), (-0.2, -1.0)):
        p.prism((x, y, 0.02), 6, 0.11, 0.11, 0.04, BRASS)
    p.rock((-2.4, -0.4, 0.2), (1.2, 1.0, 0.7), ROCK, jitter=0.2)
    return p


def kelp():
    """Hanging kelp: flat dark blades from a hold on the wall. Origin at the hold."""
    p = piece('Kit_Kelp')
    p.rock((0, 0.3, 0.0), (1.8, 0.9, 0.7), ROCK_DARK, jitter=0.2)
    for i, (x, length, wave) in enumerate(((-0.7, 5.6, 0.5), (-0.35, 7.2, -0.4), (0.0, 6.2, 0.35),
                                           (0.35, 7.8, -0.5), (0.7, 5.0, 0.45))):
        points = [(x + math.sin(t * 2.4 + i) * wave * t, -0.12 * i + 0.1, -t * length) for t in (k / 6 for k in range(7))]
        p.sweep(points, 0.46, 0.12, KELP if i % 2 else KELP_DARK, sides=4, squash=0.16)
    return p


def glow_polyp():
    """The room's living light: a few abyssal polyps on wet stones. Used sparsely."""
    p = piece('Kit_GlowPolyp')
    p.rock((0, 0, 0.2), (1.6, 1.3, 0.7), ROCK_DARK, jitter=0.2)
    p.rock((0.9, -0.3, 0.12), (0.8, 0.7, 0.4), ROCK, jitter=0.2)
    for x, y, h, tone in ((0, 0, 1.7, LURE), (-0.4, 0.2, 1.1, LURE_DIM), (0.35, 0.3, 1.3, LURE),
                          (0.2, -0.4, 0.8, LURE_DIM), (-0.5, -0.3, 0.6, LURE_DIM)):
        polyp(p, (x, y, 0.4), h, tone)
    return p


def rib_bones():
    """The rest of the leviathan: ribs standing out of the floor by the wall."""
    p = piece('Kit_RibBones')
    p.rock((0, 0.8, 0.4), (5.0, 2.2, 1.4), ROCK, jitter=0.2)
    for x, top, lean in ((-1.9, 7.4, -1.2), (0.0, 8.6, -0.6), (1.9, 6.6, -1.4)):
        rib(p, (x, 1.0, 0.2), (x + 0.2, 1.9, top * 0.7), (x + 0.1, lean, top), 0.46, 0.13, BONE if x else BONE_OLD)
    p.prism((-2.9, -0.6, 0.45), 6, 0.7, 0.6, 0.7, BONE_OLD, axis='X')
    p.box((-2.5, -0.6, 1.1), (0.3, 0.22, 0.8), BONE, taper=0.5)
    barnacle(p, (0.7, 0.2, 0.9), 0.3, 0.45, lean=(0.05, -0.1))
    return p


BUILDERS = (leviathan_arch, coral_column, coral_shelf, anchor, hanging_chain, barnacles, wreckage, kelp, glow_polyp, rib_bones)

if __name__ == '__main__':
    parts = build_kit('AbyssKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'abyss_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_LeviathanArch': (0, 10, 0, 0), 'Kit_CoralColumn': (-22, 2, 0, 0.3), 'Kit_CoralShelf': (-15, -4, 0, 0),
            'Kit_Anchor': (-8, -6, 0, 0.2), 'Kit_HangingChain': (-3, -6, 7, 0), 'Kit_Barnacles': (2, -7, 0, 0),
            'Kit_Wreckage': (8, -6, 0, 0), 'Kit_Kelp': (14, -5, 8.5, 0), 'Kit_GlowPolyp': (18, -7, 0, 0),
            'Kit_RibBones': (24, 0, 0, -0.3),
        }, os.path.join(here(__file__), 'abyss_kit.png'), background=(0.02, 0.045, 0.05))
