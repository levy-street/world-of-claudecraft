"""The BROODMOTHER VYSSKA room kit: an old, deep spider nest.

  blender --background --python docs/design/boss-rooms/nest/build_nest_kit.py [-- --preview]

Writes nest_kit_components.glb beside this file (scripts/assets/boss_rooms/build.mjs
ships it). Conventions and the painting model: ../kitlib.py and ../README.md.

Readability rule this kit keeps: in this fight a live cocoon, a live egg and bright
green all mean ACT. So everything here is the opposite on every axis: grey and
dust-white, old, split or collapsed, far larger or plainly empty, and hung on the
walls, never stood in the fight. The only glow is a few dim fungus caps on roots.
"""
import math
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from kitlib import GLOW, Piece, build_kit, export_kit, here, preview  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

SILK = (0.84, 0.84, 0.78)
SILK_OLD = (0.66, 0.66, 0.6)
SILK_DARK = (0.46, 0.47, 0.43)
ROOT = (0.36, 0.3, 0.24)
ROOT_DARK = (0.25, 0.21, 0.18)
ROCK = (0.34, 0.39, 0.34)
ROCK_DARK = (0.24, 0.28, 0.25)
SHELL = (0.68, 0.68, 0.61)
SHELL_OLD = (0.52, 0.53, 0.48)
HOLLOW = (0.1, 0.11, 0.09)
BONE = (0.82, 0.8, 0.68)
BONE_OLD = (0.62, 0.6, 0.52)
CAP = (0.42, 0.56, 0.24)
DAMP = (0.02, 0.05, 0.03)


def piece(name):
    return Piece(name, warm=DAMP)


def strand(p, a, b, width=0.12, tone=SILK, sag=0.0, steps=1):
    """One thread of a web, a flat strip facing the room, sagging if asked."""
    a, b = Vector(a), Vector(b)
    along = b - a
    across = Vector((-along.z, 0, along.x))
    if across.length < 1e-4:
        across = Vector((1, 0, 0))
    mid = (a + b) / 2 - Vector((0, 0, sag))
    points = p.bezier(a, mid, b, steps=max(2, steps)) if sag else [a, b]
    p.ribbon(points, width, tone, across=across)


def web(p, centre, anchors, rings=5, tone=SILK, thread=0.12):
    """A web in the XZ plane: spokes from `centre` to each anchor, and rings across them."""
    centre = Vector(centre)
    anchors = [Vector(a) for a in anchors]
    for i, anchor in enumerate(anchors):
        strand(p, centre, anchor, thread * 1.3, tone if i % 3 else SILK_OLD)
    for ring in range(1, rings + 1):
        t = ring / (rings + 0.6)
        for i in range(len(anchors)):
            a = centre.lerp(anchors[i], t * (0.92 + 0.12 * p.rng.random()))
            b = centre.lerp(anchors[(i + 1) % len(anchors)], t * (0.92 + 0.12 * p.rng.random()))
            mid = (a + b) / 2
            pull = (centre - mid) * 0.12
            strand(p, a, mid + pull, thread, SILK_OLD if ring % 2 else tone)
            strand(p, mid + pull, b, thread, SILK_OLD if ring % 2 else tone)


def root(p, points, r0, r1, tone=ROOT):
    p.sweep(points, r0, r1, tone, sides=5)


def bundle(p, centre, size, tone, bands=3, axis_tilt=0.0):
    """A thing wrapped in silk: a lumpy spindle with darker windings round it."""
    start = p.mark()
    p.rock((0, 0, 0), size, tone, jitter=0.1, subdivisions=2)
    for k in range(bands):
        z = (k + 1) / (bands + 1) - 0.5
        r = math.sqrt(max(0.05, 0.25 - z * z)) * 1.04
        p.prism((0, 0, z * size[2] - 0.06), 8, r * size[0], r * size[0], 0.12, SILK_DARK, squash=size[1] / size[0], phase=k)
    p.turn(start, Matrix.Translation(centre) @ Matrix.Rotation(axis_tilt, 4, 'Y'))


def egg_shell(p, at, r, tone=SHELL, lean=(0.0, 0.0)):
    """An old egg, hatched long ago: the lower half of a shell, dark and empty inside."""
    p.prism(at, 7, r * 0.55, r, r * 1.1, tone, lean=lean, phase=p.rng.random() * 3)
    rim = (at[0] + lean[0], at[1] + lean[1], at[2] + r * 1.1)
    p.prism((rim[0], rim[1], rim[2] - 0.04), 7, r * 0.86, r * 0.86, 0.05, HOLLOW, phase=p.rng.random())
    for k in range(3):
        a = k * 2.1 + p.rng.random()
        p.spike((rim[0] + math.cos(a) * r * 0.78, rim[1] + math.sin(a) * r * 0.78, rim[2] - 0.05), r * 0.3, r * (0.5 + 0.4 * p.rng.random()), tone, sides=3)


def skull(p, at, s=1.0, yaw=0.0):
    start = p.mark()
    p.rock((0, 0, 0), (0.62 * s, 0.7 * s, 0.6 * s), BONE, jitter=0.08)
    p.box((0, -0.26 * s, -0.3 * s), (0.4 * s, 0.34 * s, 0.26 * s), BONE_OLD, taper=0.8)
    for side in (-1, 1):
        p.box((side * 0.14 * s, -0.31 * s, 0.02), (0.15 * s, 0.1 * s, 0.15 * s), HOLLOW)
    p.turn(start, Matrix.Translation(at) @ Matrix.Rotation(yaw, 4, 'Z'))


def caps(p, spots):
    for x, y, z, r in spots:
        p.prism((x, y, z), 6, r, r * 0.3, r * 0.5, CAP, mat=GLOW)


# --------------------------------------------------------------------- hero
def great_web():
    """The Great Web across the end wall, and in it a cocoon far too big and too old
    to be part of any fight: grey, slumped, torn open and empty. Back at y = +3."""
    p = piece('Kit_GreatWeb')
    # What the web is strung from: rock spurs and the roots that came down through them.
    for side in (-1, 1):
        p.rock((side * 16.5, 2.0, 3.0), (6, 5, 7.5), ROCK_DARK, jitter=0.22)
        p.rock((side * 13.0, 1.2, 1.2), (5, 4, 3.2), ROCK, jitter=0.22)
        root(p, p.bezier((side * 17.5, 1.5, 19.0), (side * 13.0, 0.6, 13.0), (side * 15.2, 0.2, 5.5), steps=7), 0.9, 0.5, ROOT_DARK)
        root(p, p.bezier((side * 15.0, 1.4, 19.5), (side * 9.0, 0.4, 17.4), (side * 6.2, 0.6, 19.6), steps=6), 0.7, 0.3, ROOT)
        root(p, p.bezier((side * 15.2, 0.2, 5.5), (side * 12.4, -0.8, 2.6), (side * 9.6, -1.4, 0.0), steps=5), 0.5, 0.22, ROOT)
    centre = (0, 0.4, 10.4)
    anchors = [(-15.4, 0.4, 5.6), (-14.0, 0.4, 12.4), (-10.0, 0.4, 17.6), (-3.6, 0.4, 19.4), (3.8, 0.4, 19.6), (10.2, 0.4, 17.8),
               (14.2, 0.4, 12.0), (15.2, 0.4, 5.8), (10.6, 0.4, 1.4), (3.4, 0.4, 0.5), (-4.0, 0.4, 0.6), (-10.8, 0.4, 1.5)]
    web(p, centre, anchors, rings=6, thread=0.16)
    # The old cocoon: hung in the middle, slumped to one side, split down its face.
    bundle(p, (0.3, -0.6, 10.2), (5.4, 3.8, 9.4), SILK_OLD, bands=5, axis_tilt=0.1)
    p.rock((-0.5, -1.4, 6.6), (3.4, 2.6, 2.6), SILK_DARK, jitter=0.2)
    p.box((0.5, -2.46, 10.6), (1.3, 0.3, 4.6), HOLLOW, taper=0.25, roll=0.12)
    for side, tilt in ((-1, 0.3), (1, -0.2)):
        p.box((0.5 + side * 1.0, -2.5, 10.2), (0.7, 0.16, 3.6), SILK, roll=tilt + 0.12, taper=0.4)
    for x, z in ((-2.6, 15.0), (2.8, 15.4), (0.2, 16.2)):
        strand(p, (x * 0.4, -0.6, 14.4), (x * 1.6, 0.4, z + 3.2), 0.3, SILK_OLD)
    # Hatched shells heaped under it, a few bones, the fungus that feeds on all of it.
    for x, y, r, lean in ((-3.2, -1.6, 1.0, (-0.2, -0.1)), (-1.2, -2.4, 0.8, (0.1, -0.2)), (1.4, -2.0, 1.15, (0.2, -0.1)),
                          (3.4, -1.2, 0.85, (0.3, 0.0)), (-5.0, -0.8, 0.7, (-0.3, 0.0)), (0.2, -1.0, 0.9, (0.0, 0.1))):
        egg_shell(p, (x, y, 0.3), r, SHELL if r > 0.85 else SHELL_OLD, lean)
    p.rock((0, -1.2, 0.2), (11, 4.4, 1.0), SILK_DARK, jitter=0.15)
    skull(p, (5.4, -2.2, 0.6), 1.0, yaw=0.5)
    skull(p, (-6.4, -1.8, 0.55), 0.9, yaw=-0.4)
    caps(p, ((-14.4, -0.6, 5.2, 0.34), (-13.6, -0.9, 3.4, 0.26), (14.6, -0.7, 6.2, 0.3), (12.2, -1.3, 2.2, 0.24), (9.8, -1.5, 0.4, 0.22)))
    return p


# ------------------------------------------------------------------- props
def wall_web():
    """A web strung between a root and a spur of rock."""
    p = piece('Kit_WallWeb')
    p.rock((-3.6, 0.6, 1.4), (2.4, 2.2, 3.4), ROCK_DARK, jitter=0.2)
    root(p, p.bezier((3.4, 0.8, 0.0), (4.6, 0.4, 4.2), (3.0, 1.0, 8.4), steps=6), 0.42, 0.2, ROOT_DARK)
    root(p, p.bezier((3.9, 0.5, 3.4), (2.4, 0.0, 5.0), (1.2, 0.6, 7.6), steps=4), 0.22, 0.1, ROOT)
    anchors = [(-3.2, 0.2, 3.0), (-2.6, 0.2, 6.6), (0.4, 0.2, 8.0), (3.0, 0.2, 7.4), (4.0, 0.2, 4.0), (3.4, 0.2, 0.8), (-0.2, 0.2, 0.2)]
    web(p, (0.3, 0.2, 4.2), anchors, rings=4, thread=0.1)
    return p


def egg_shells():
    """Old eggs, hatched and grey. Empty shells never look like live ones."""
    p = piece('Kit_EggShells')
    p.rock((0, 0.2, 0.2), (4.2, 3.0, 0.9), SILK_DARK, jitter=0.15)
    for x, y, r, lean in ((0, 0.2, 0.95, (0.1, -0.1)), (-1.3, -0.2, 0.75, (-0.25, -0.1)), (1.3, 0.0, 0.8, (0.3, 0.0)),
                          (0.4, -1.0, 0.6, (0.05, -0.25)), (-0.6, 1.0, 0.65, (-0.1, 0.1))):
        egg_shell(p, (x, y, 0.35), r, SHELL if r > 0.7 else SHELL_OLD, lean)
    for x, y, yaw in ((1.9, -1.0, 0.4), (-1.9, -0.9, 1.4), (0.9, -1.6, 2.2)):
        p.box((x, y, 0.1), (0.7, 0.5, 0.08), SHELL_OLD, yaw=yaw, taper=0.4, roll=0.2)
    return p


def wrapped_prey():
    """Something caught long ago, wound in silk, hung by a rope of it. Origin at the hang point: it sways."""
    p = piece('Kit_WrappedPrey')
    p.rock((0, 0.3, 0.1), (1.3, 1.0, 0.6), SILK_DARK, jitter=0.2)
    strand(p, (0, 0, 0), (0, 0, -1.6), 0.3, SILK_OLD)
    strand(p, (-0.5, 0.2, 0.1), (-0.1, 0, -1.4), 0.16, SILK)
    bundle(p, (0, 0, -3.6), (1.7, 1.4, 4.4), SILK_OLD, bands=4, axis_tilt=0.06)
    p.rock((0, -0.1, -2.2), (1.9, 1.3, 1.1), SILK_OLD, jitter=0.12)
    p.spike((0, 0, -5.6), 0.5, -1.0, SILK_DARK, sides=5)
    return p


def bone_cluster():
    """What she did not keep: the bones of earlier visitors, webbed to the floor."""
    p = piece('Kit_BoneCluster')
    p.rock((0, 0.2, 0.15), (4.4, 3.2, 0.7), SILK_DARK, jitter=0.15)
    for x, top, lean in ((-0.9, 2.6, -0.7), (0.0, 3.0, -0.4), (0.9, 2.4, -0.8)):
        p.sweep(p.bezier((x, 0.9, 0.2), (x, 1.5, top * 0.8), (x + 0.1, lean, top), steps=5), 0.16, 0.05, BONE if x else BONE_OLD, sides=4)
    skull(p, (-1.5, -0.4, 0.62), 1.0, yaw=0.4)
    skull(p, (1.3, -0.8, 0.5), 0.8, yaw=-0.7)
    for a, b in (((-0.4, -1.2, 0.35), (1.0, -1.5, 0.3)), ((1.6, 0.4, 0.4), (2.3, -0.4, 0.2)), ((-2.2, 0.6, 0.35), (-1.2, 1.2, 0.3))):
        p.sweep([a, b], 0.1, 0.09, BONE_OLD, sides=4)
    for a, b in (((-2.0, -1.0, 0.1), (0.0, 0.6, 1.8)), ((2.0, -0.8, 0.1), (0.2, 0.7, 2.2)), ((0.1, -1.6, 0.1), (0.0, 0.5, 1.2))):
        strand(p, a, b, 0.09, SILK)
    return p


def twisted_roots():
    """Roots come down through the rock; she strings her silk between them."""
    p = piece('Kit_TwistedRoots')
    p.rock((0, 0.8, 0.5), (4.6, 2.2, 1.6), ROCK_DARK, jitter=0.2)
    root(p, p.bezier((-1.6, 1.2, 9.6), (-3.2, 0.2, 5.0), (-1.2, -0.6, 0.0), steps=8), 0.6, 0.26, ROOT_DARK)
    root(p, p.bezier((0.6, 1.3, 9.8), (2.8, 0.4, 6.2), (0.8, 0.0, 2.8), steps=7), 0.52, 0.22, ROOT)
    root(p, p.bezier((0.8, 0.0, 2.8), (-0.2, -0.8, 1.2), (1.9, -1.4, 0.0), steps=4), 0.24, 0.1, ROOT)
    root(p, p.bezier((2.4, 1.2, 9.2), (1.4, 0.8, 7.8), (3.0, 0.2, 5.2), steps=5), 0.3, 0.1, ROOT_DARK)
    root(p, p.bezier((-2.6, 0.6, 5.6), (-3.8, -0.4, 3.4), (-3.2, -1.0, 0.0), steps=5), 0.26, 0.1, ROOT)
    for a, b, w in (((-2.4, 0.3, 6.0), (1.9, 0.3, 6.6), 0.12), ((-2.6, 0.2, 4.2), (1.2, 0.2, 3.4), 0.1), ((-1.9, 0.2, 7.6), (1.4, 0.4, 8.2), 0.1),
                    ((-0.4, 0.3, 6.3), (-0.8, 0.2, 3.9), 0.08), ((0.9, 0.3, 6.5), (0.3, 0.2, 3.6), 0.08)):
        strand(p, a, b, w, SILK_OLD, sag=0.4, steps=4)
    caps(p, ((-2.3, -0.3, 3.0, 0.26), (-2.6, -0.2, 3.7, 0.18), (1.5, -0.2, 4.4, 0.22)))
    return p


def silk_column():
    """Webbing laid so thick for so long that it stands like a column against the wall."""
    p = piece('Kit_SilkColumn')
    for i, (z, r0, r1) in enumerate(((0.0, 2.2, 1.0), (2.2, 1.0, 0.7), (5.0, 0.7, 1.0), (7.4, 1.0, 1.9))):
        height = (2.2, 2.8, 2.4, 2.2)[i]
        p.prism((0, 0.6, z), 7, r0, r1, height, SILK_OLD if i % 2 else SILK_DARK, squash=0.75, phase=i * 0.4)
    for k in range(7):
        a = math.pi + (k - 3) * 0.42
        strand(p, (math.cos(a) * 0.8, 0.2, 2.6), (math.cos(a) * 3.4, 0.4 + 0.2 * (k % 2), 0.05), 0.12, SILK)
        strand(p, (math.cos(a) * 0.8, 0.2, 7.0), (math.cos(a) * 3.6, 0.6, 9.8), 0.12, SILK if k % 2 else SILK_OLD)
    for z in (3.0, 4.4, 6.0):
        p.prism((0, 0.6, z), 7, 0.92, 0.92, 0.12, SILK, squash=0.75)
    return p


BUILDERS = (great_web, wall_web, egg_shells, wrapped_prey, bone_cluster, twisted_roots, silk_column)

if __name__ == '__main__':
    parts = build_kit('NestKit_ROOT', BUILDERS)
    export_kit(os.path.join(here(__file__), 'nest_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, {
            'Kit_GreatWeb': (0, 10, 0, 0), 'Kit_WallWeb': (-21, -1, 0, 0.3), 'Kit_EggShells': (-13, -6, 0, 0),
            'Kit_WrappedPrey': (-7, -6, 7.5, 0), 'Kit_BoneCluster': (-1, -8, 0, 0), 'Kit_TwistedRoots': (8, -5, 0, 0),
            'Kit_SilkColumn': (18, -3, 0, -0.3),
        }, os.path.join(here(__file__), 'nest_kit.png'), background=(0.03, 0.045, 0.035))
