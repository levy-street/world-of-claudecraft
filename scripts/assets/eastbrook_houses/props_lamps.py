# The other zones' street lamps, the muster camp and the fen's small things: the last of the
# release's own lamp posts, camp pieces and marsh dressing, rebuilt in the same painted kit.
# Built by build_props.py over each release model's own path (see props.py).
#
# Every zone burns the same warm light, so one amber lantern serves them all and a zone is
# told by its post: what it stands on, what it is made of, how it carries the light.
#
# The camp's structure pieces carry the sim's colliders (src/sim/muster_camp_colliders.ts),
# which are measured from the release models: a stake row, a gate's two wings and a tower's
# four legs are authored where those colliders stand, and reach the old bounds on every side
# so the exact fit neither stretches nor shifts them.
import math
import random

from kit import UP, Frame, Model, uv_band, uv_tile
from mathutils import Vector

from props import ASH, CANVAS, IRON, ROPE, TAR, bar, barrel_prop, crate_prop, tinted
from props_castle import ASHLAR, GOLD, LINEN, RED, STONE, WORLD, wood

# the two names the lamp loader lights (src/render/streetlamp_emissive.ts)
# every one of these lamps burns a real flame, so its emitter leaves as LAMP_FLAME: the game
# animates that name (src/render/streetlamp_flame.ts), where LAMP_SOURCE would sit still
GLOW = {"eh_parts_glow": "LAMP_GLASS", "eh_glass": "LAMP_FLAME"}
BASALT = (0.52, 0.46, 0.44)
MOSS = (0.36, 0.5, 0.24)
LEAF = (0.3, 0.52, 0.26)
REED = (0.5, 0.58, 0.3)
FROST = (0.78, 0.87, 0.95)
DUSK = (0.58, 0.52, 0.74)
CORAL = (0.92, 0.42, 0.32)
PURPLE = (0.5, 0.3, 0.7)
PETAL = (0.98, 0.74, 0.82)


def at(x, y, z):
    return Frame((x, y, z), (1, 0, 0), UP, (0, 1, 0))


def flame(m, c, r=0.09, h=0.2):
    """The fire the game lights: a little spindle of the glowing glass."""
    c = Vector(c)
    ring = [c + Vector((r * math.cos(math.tau * k / 6), r * math.sin(math.tau * k / 6), 0.0)) for k in range(6)]
    for k in range(6):
        a, b = ring[k], ring[(k + 1) % 6]
        for tip in (c + Vector((0.0, 0.0, h)), c - Vector((0.0, 0.0, h * 0.6))):
            m.face([a, b, tip], [uv_tile("glass", 0.2, 0.2), uv_tile("glass", 0.6, 0.2), uv_tile("glass", 0.4, 0.6)], "glass", 1.0, (a + b) / 2 - c + (tip - c) * 0.5)


def lantern(m, x, y, z, size=1.45):
    """A lantern hung from (x, y, z) with its flame inside. Returns where the flame is."""
    m.hung_lamp(x, y, z, size)
    spot = (x, y, z - 0.397 * size)
    flame(m, spot, 0.062 * size, 0.138 * size)
    return spot


def pennant(m, a, b, c, tone, side=(1.0, 0.0, 0.0)):
    """A scrap of cloth between three points, seen from both sides."""
    pts = [Vector(a), Vector(b), Vector(c)]
    span = max((pts[1] - pts[0]).length, 0.1)
    with tinted(m, tone):
        for sign, lit in ((1.0, 1.0), (-1.0, 0.78)):
            uvs = [uv_band("plaster", 0.0, 0.1, span), uv_band("plaster", span, 0.1, span), uv_band("plaster", span * 0.5, 0.9, span)]
            m.face(pts, uvs, "trim", lit, Vector(side) * sign)


def rock(m, x, y, r, h, seed=0, skin=STONE, shade=1.0):
    """A squat boulder: five uneven sides, a crown off its centre."""
    rng = random.Random(seed)
    lean = [(0.0, 0.0), (rng.uniform(-0.08, 0.08) * r, rng.uniform(-0.08, 0.08) * r), (rng.uniform(-0.2, 0.2) * r, rng.uniform(-0.2, 0.2) * r), (rng.uniform(-0.2, 0.2) * r, rng.uniform(-0.2, 0.2) * r)]
    m.lathe(at(x, y, 0.0), [(r, 0.0), (r * 0.94, h * 0.42), (r * 0.6, h * 0.86), (0.0, h)], sides=5, skin=skin, smooth=False, shade=shade, lean=lean, phase=rng.uniform(0.0, 1.0))


# -- the street lamps -------------------------------------------------------------------------


def foot(m, kind, top):
    """What a lamp stands on, up to the height `top` where its shaft begins."""
    if kind == "stone":
        m.lathe(WORLD, [(0.4, 0.0), (0.4, 0.14), (0.3, 0.2), (0.27, top - 0.16), (0.33, top - 0.1), (0.33, top), (0.0, top)], sides=8, skin=STONE, smooth=False)
    elif kind == "ashlar":
        m.lathe(WORLD, [(0.58, 0.0), (0.58, 0.18), (0.46, 0.26), (0.44, top - 0.14), (0.52, top - 0.08), (0.52, top), (0.0, top)], sides=4, skin=ASHLAR, smooth=False)
    elif kind == "rock":
        rock(m, 0.0, 0.0, 0.5, top, seed=3)
        rock(m, 0.36, 0.26, 0.26, top * 0.5, seed=5, shade=0.92)
        rock(m, -0.3, -0.32, 0.2, top * 0.36, seed=8, shade=0.95)
    elif kind == "timber":
        m.lathe(WORLD, [(0.36, 0.0), (0.32, top), (0.0, top)], sides=6, skin=("band", "planks", 0.6), smooth=False)
        with tinted(m, IRON):
            for z, r in ((0.12, 0.37), (top - 0.2, 0.345)):
                m.lathe(WORLD, [(r, z), (r, z + 0.09)], sides=6, skin=("band", "plaster", 0.1))


def shaft(m, z0, z1, rings=(), ring="gilded", ring_tone=None, tone=None, band="oak", r0=0.13, r1=0.11):
    """A turned post from z0 to z1, banded at the heights in `rings`."""
    if tone:
        with tinted(m, tone):
            m.lathe(WORLD, [(r0, z0), (r1, z1)], sides=8, skin=("band", band, 0.5))
    else:
        m.lathe(WORLD, [(r0, z0), (r1, z1)], sides=8, skin=("band", band, 0.5))
    for z in rings:
        r = r0 + (r1 - r0) * (z - z0) / (z1 - z0) + 0.028
        if ring_tone:
            with tinted(m, ring_tone):
                m.lathe(WORLD, [(r, z), (r, z + 0.12)], sides=8, skin=("band", "plaster", 0.12))
        else:
            m.lathe(WORLD, [(r, z), (r, z + 0.12)], sides=8, skin=("band", ring, 0.12))


def finial(m, z, r=0.11, band="gilded"):
    """The cap a turned post ends in, and the stud on it."""
    m.lathe(WORLD, [(r, z), (r + 0.06, z + 0.11), (0.0, z + 0.37)], sides=8, skin=("band", band, 0.2))
    m.gem(Vector((0.0, 0.0, z + 0.45)), 0.09, band=band)


def arm(m, z, reach=0.92, curl=False, size=1.45):
    """A wrought arm holding a lantern out over the road (toward -Y). Returns the flame."""
    with tinted(m, IRON):
        m.sweep([(0.0, 0.0, z - 0.24), (0.0, -reach * 0.5, z + 0.12), (0.0, -reach, z)], (0.07, 0.07), "plaster", depth=0.14)
        m.sweep([(0.0, -0.08, z - 0.74), (0.0, -reach * 0.55, z - 0.12)], (0.05, 0.05), "plaster", depth=0.1, caps=False)
        if curl:
            m.sweep([(0.0, 0.0, z - 0.12), (0.0, 0.3, z + 0.16), (0.0, 0.46, z + 0.02), (0.0, 0.36, z - 0.16), (0.0, 0.22, z - 0.08)], (0.05, 0.05), "plaster", depth=0.1)
    return lantern(m, 0.0, -reach, z, size)


def crown(m, z, size=1.1, cap=("tile", "slate"), cap_tone=None):
    """A lantern caged on the head of its post, under a little four-sided roof."""
    with tinted(m, IRON):
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            c, s = math.cos(a), math.sin(a)
            m.sweep([(c * 0.1, s * 0.1, z), (c * 0.36, s * 0.36, z + 0.2), (c * 0.36, s * 0.36, z + 1.0)], (0.045, 0.045), "plaster", depth=0.09, caps=False)
        m.lathe(at(0.0, 0.0, z + 0.16), [(0.4, 0.0), (0.4, 0.06)], sides=8, skin=("band", "plaster", 0.08))
    top = at(0.0, 0.0, z + 1.0)
    if cap_tone:
        with tinted(m, cap_tone):
            m.lathe(top, [(0.62, 0.0), (0.2, 0.3), (0.0, 0.52)], sides=4, skin=cap, smooth=False)
    else:
        m.lathe(top, [(0.62, 0.0), (0.2, 0.3), (0.0, 0.52)], sides=4, skin=cap, smooth=False)
    m.lathe(top, [(0.0, 0.0), (0.62, 0.0)], sides=4, skin=("band", "planks", 0.5), smooth=False, shade=0.55)
    m.gem(Vector((0.0, 0.0, z + 1.6)), 0.07)
    return lantern(m, 0.0, 0.0, z + 1.0, size)


def fire_bowl(m, z):
    """An iron bowl of fire on the head of a pillar. Returns the heart of the fire."""
    cup = at(0.0, 0.0, z)
    with tinted(m, IRON):
        m.lathe(cup, [(0.14, 0.0), (0.42, 0.2), (0.54, 0.44)], sides=8, skin=("band", "plaster", 0.4))
        m.lathe(cup, [(0.54, 0.44), (0.47, 0.44), (0.3, 0.26), (0.0, 0.24)], sides=8, skin=("band", "plaster", 0.4), shade=0.55)
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            tip = Vector((math.cos(a) * 0.54, math.sin(a) * 0.54, z + 0.44))
            bar(m, tip, tip + Vector((math.cos(a) * 0.08, math.sin(a) * 0.08, 0.3)), 0.035, band="plaster", sides=4, r1=0.008)
    heart = (0.0, 0.0, z + 0.66)
    flame(m, heart, 0.25, 0.56)
    flame(m, (0.16, 0.06, z + 0.5), 0.13, 0.3)
    flame(m, (-0.14, -0.1, z + 0.48), 0.12, 0.26)
    return heart


# a crooked trunk's centre line: (dx, dy, height)
BOUGH = [(0.0, 0.0, 0.3), (0.1, 0.05, 1.5), (-0.06, -0.02, 2.4), (0.05, -0.14, 3.2), (0.0, -0.3, 3.85)]


def bough_at(z):
    for (x0, y0, z0), (x1, y1, z1) in zip(BOUGH, BOUGH[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
    return BOUGH[-1][0], BOUGH[-1][1]


def bough(m, tone, r0=0.17, r1=0.09):
    """A crooked trunk that leans out toward the road as it climbs. Returns its tip."""
    n = len(BOUGH)
    profile = [(r0 + (r1 - r0) * i / (n - 1), z) for i, (_x, _y, z) in enumerate(BOUGH)]
    with tinted(m, tone):
        m.lathe(WORLD, profile, sides=7, skin=("band", "oak", 0.5), lean=[(x, y) for x, y, _z in BOUGH])
    return Vector(BOUGH[-1])


def bough_ring(m, z, tone, r):
    x, y = bough_at(z)
    with tinted(m, tone):
        m.lathe(at(x, y, z), [(r, 0.0), (r, 0.1)], sides=7, skin=("band", "plaster", 0.1))


def bough_lamp(m, tone, hang=1.3):
    """The trunk's last bough reaches over the road and the lantern hangs from it on a chain."""
    tip = bough(m, tone)
    with tinted(m, tone):
        bar(m, tip, (0.0, -0.98, 4.12), 0.075, sides=6, r1=0.045, caps=False)
        bar(m, (0.0, -0.98, 4.12), (0.0, -1.22, 3.98), 0.045, sides=5, r1=0.02)
        bar(m, (0.05, -0.14, 3.2), (0.44, 0.18, 3.74), 0.055, sides=5, r1=0.02)
    with tinted(m, IRON):
        bar(m, (0.0, -0.98, 4.07), (0.0, -0.98, 3.84), 0.014, band="plaster", sides=4, caps=False)
    return lantern(m, 0.0, -0.98, 3.84, hang)


def lamp_witchflame(m):
    foot(m, "rock", 0.5)
    spot = bough_lamp(m, TAR)
    with tinted(m, MOSS):
        m.lathe(at(0.05, 0.02, 0.5), [(0.3, -0.08), (0.2, 0.04), (0.0, 0.08)], sides=6, skin=("band", "plaster", 0.3), smooth=False)
    # a charm of bones and beads swinging under the bough
    with tinted(m, LINEN):
        m.gem(Vector((0.0, -0.6, 3.82)), 0.045, band="plaster", stretch=2.4)
        m.gem(Vector((0.0, -0.46, 3.7)), 0.035, band="plaster", stretch=2.0)
    return spot


def lamp_beacon(m):
    foot(m, "ashlar", 0.7)
    m.lathe(WORLD, [(0.42, 0.7), (0.38, 2.74), (0.5, 2.84), (0.5, 3.0), (0.0, 3.0)], sides=4, skin=ASHLAR, smooth=False)
    with tinted(m, IRON):
        for z in (1.2, 2.3):
            m.lathe(WORLD, [(0.445, z), (0.445, z + 0.1)], sides=4, skin=("band", "plaster", 0.1))
    return crown(m, 3.0, size=1.1)


def lamp_veiled(m):
    foot(m, "stone", 0.78)
    shaft(m, 0.78, 3.75, rings=(0.92, 2.3, 3.62), ring="teal")
    m.lathe(WORLD, [(0.11, 3.75), (0.17, 3.86), (0.0, 4.0)], sides=8, skin=("band", "teal", 0.2))
    m.gem(Vector((0.0, 0.0, 4.26)), 0.12, band="teal", stretch=2.4)
    for k in range(3):
        a = math.tau * k / 3 + 0.4
        m.gem(Vector((math.cos(a) * 0.14, math.sin(a) * 0.14, 4.08)), 0.06, band="teal", stretch=2.0)
    return arm(m, 3.74, curl=True)


def lamp_brazier(m):
    with tinted(m, BASALT):
        foot(m, "ashlar", 0.7)
        m.lathe(WORLD, [(0.44, 0.7), (0.36, 2.9), (0.5, 3.04), (0.5, 3.2), (0.0, 3.2)], sides=4, skin=ASHLAR, smooth=False)
    with tinted(m, IRON):
        for z in (1.0, 2.5):
            m.lathe(WORLD, [(0.45, z), (0.45, z + 0.12)], sides=4, skin=("band", "plaster", 0.12))
    pennant(m, (-0.2, -0.3, 2.44), (0.2, -0.3, 2.44), (0.0, -0.3, 1.5), RED, side=(0.0, -1.0, 0.0))
    return fire_bowl(m, 3.2)


def lamp_icicle(m):
    foot(m, "stone", 0.78)
    shaft(m, 0.78, 3.15, rings=(1.0, 2.9), tone=FROST, band="plaster")
    spot = crown(m, 3.15, size=1.1)
    with tinted(m, FROST):
        for k in range(4):
            a = math.tau * k / 4
            m.gem(Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 4.0)), 0.05, band="plaster", stretch=3.4)
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            m.gem(Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 4.05)), 0.035, band="plaster", stretch=2.6)
    return spot


def lamp_amber(m):
    foot(m, "stone", 0.78)
    shaft(m, 0.78, 3.75, rings=(0.92, 1.6, 2.3, 3.62))
    finial(m, 3.75)
    m.sweep([(0.0, 0.0, 3.3), (0.0, 0.56, 3.3)], (0.05, 0.05), "gilded", depth=0.1)
    pennant(m, (0.0, 0.1, 3.27), (0.0, 0.52, 3.27), (0.0, 0.31, 2.62), RED)
    return arm(m, 3.74)


def lamp_reed(m):
    foot(m, "timber", 0.6)
    spot = bough_lamp(m, (0.66, 0.6, 0.4), hang=1.25)
    for z in (1.1, 2.5):
        bough_ring(m, z, ROPE, 0.2 - 0.025 * z)
    # a sheaf of cut reeds lashed to the post
    for k in range(5):
        a = 2.0 + k * 0.5
        x0, y0 = math.cos(a) * 0.22, math.sin(a) * 0.22
        top = 2.0 + 0.24 * (k % 3)
        with tinted(m, REED):
            bar(m, (x0, y0, 0.6), (x0 * 1.5, y0 * 1.5, top), 0.02, band="plaster", sides=4, caps=False)
        with tinted(m, (0.42, 0.26, 0.16)):
            m.gem(Vector((x0 * 1.5, y0 * 1.5, top + 0.08)), 0.04, band="plaster", stretch=3.0)
    return spot


def lamp_moonflower(m):
    foot(m, "stone", 0.78)
    shaft(m, 0.78, 3.75, rings=(0.92, 3.62), ring="teal", tone=DUSK)
    finial(m, 3.75, band="teal")
    reach = 1.15
    spot = arm(m, 3.74, reach=reach, curl=True)
    # the flower the lantern hangs from: a ring of pale petals round its crown
    with tinted(m, (0.9, 0.88, 1.0)):
        for k in range(6):
            a = math.tau * k / 6
            c = Vector((math.cos(a) * 0.3, -reach + math.sin(a) * 0.3, 3.7))
            m.gem(c, 0.13, band="plaster", stretch=0.42)
    return spot


def lamp_ghost(m):
    foot(m, "rock", 0.5)
    spot = bough_lamp(m, ASH)
    for z in (1.3, 2.7):
        bough_ring(m, z, IRON, 0.2 - 0.025 * z)
    # a rag the wind has left on the bough
    rag = (0.72, 0.8, 0.76)
    pennant(m, (0.0, -0.42, 3.94), (0.0, -0.74, 4.04), (0.0, -0.52, 3.2), rag)
    pennant(m, (0.2, 0.0, 3.46), (0.4, 0.14, 3.7), (0.34, 0.1, 2.9), rag, side=(1.0, -1.0, 0.0))
    return spot


def lamp_totem(m):
    foot(m, "timber", 0.6)
    n = 6
    step = (3.75 - 0.6) / n
    for i in range(n):
        a, b = 0.6 + i * step, 0.6 + (i + 1) * step
        r = 0.2 if i % 2 == 0 else 0.165
        band, tone = (("oak", None), ("teal", None), ("plaster", RED), ("gilded", None))[i % 4]
        profile = [(r - 0.03, a), (r, a + 0.05), (r, b - 0.05), (r - 0.03, b)]
        if tone:
            with tinted(m, tone):
                m.lathe(WORLD, profile, sides=8, skin=("band", band, step), smooth=False)
        else:
            m.lathe(WORLD, profile, sides=8, skin=("band", band, step), smooth=False)
    # the carved wings every totem spreads
    m.sweep([(-0.62, 0.0, 3.02), (-0.2, 0.0, 3.16), (0.2, 0.0, 3.16), (0.62, 0.0, 3.02)], [(0.07, 0.2), (0.09, 0.34), (0.09, 0.34), (0.07, 0.2)], "bargeboard", depth=0.34)
    finial(m, 3.75, r=0.15)
    return arm(m, 3.74)


def lamp_flower(m):
    foot(m, "ashlar", 0.7)
    # a planted collar round the foot of the post
    with tinted(m, LEAF):
        m.lathe(at(0.0, 0.0, 0.7), [(0.5, -0.04), (0.42, 0.12), (0.16, 0.2)], sides=8, skin=("band", "plaster", 0.3), smooth=False)
    blooms = (RED, GOLD, PETAL, (0.95, 0.95, 0.9))
    for k in range(8):
        a = math.tau * k / 8 + 0.2
        with tinted(m, blooms[k % 4]):
            m.gem(Vector((math.cos(a) * 0.36, math.sin(a) * 0.36, 0.86)), 0.07, band="plaster", stretch=0.8)
    shaft(m, 0.86, 3.15, rings=(1.3, 2.9), ring="teal")
    spot = crown(m, 3.15, size=1.1)
    for k in range(8):
        a = math.tau * k / 8
        r = 0.52 if k % 2 == 0 else 0.44
        with tinted(m, blooms[k % 4]):
            m.gem(Vector((math.cos(a) * r, math.sin(a) * r, 4.19)), 0.06, band="plaster", stretch=0.8)
    return spot


def lamp_mast(m):
    foot(m, "timber", 0.6)
    m.lathe(WORLD, [(0.13, 0.6), (0.075, 4.35), (0.0, 4.38)], sides=8, skin=("band", "oak", 0.5))
    bar(m, (0.0, -1.05, 3.6), (0.0, 0.62, 3.6), 0.045, sides=6, r1=0.035)
    with tinted(m, ROPE):
        m.lathe(WORLD, [(0.125, 3.5), (0.125, 3.7)], sides=8, skin=("band", "plaster", 0.1))
        bar(m, (0.0, -1.0, 3.63), (0.0, 0.0, 4.3), 0.013, band="plaster", sides=4, caps=False)
        bar(m, (0.0, 0.58, 3.63), (0.0, 0.0, 4.3), 0.013, band="plaster", sides=4, caps=False)
        m.lathe(at(0.0, 0.0, 0.6), [(0.3, 0.0), (0.36, 0.06), (0.3, 0.12), (0.2, 0.12)], sides=8, skin=("band", "plaster", 0.1))
    with tinted(m, CANVAS):
        # the sail, furled along the yard's far half
        bar(m, (0.0, 0.08, 3.5), (0.0, 0.58, 3.5), 0.085, band="plaster", sides=6, r1=0.06)
    pennant(m, (0.0, 0.0, 4.34), (0.0, 0.0, 4.08), (0.0, 0.6, 4.2), RED)
    m.gem(Vector((0.0, 0.0, 4.45)), 0.07)
    return lantern(m, 0.0, -0.95, 3.56, 1.3)


def lamp_coral(m):
    foot(m, "ashlar", 0.7)
    shaft(m, 0.7, 3.75, rings=(0.84, 0.98, 2.3, 3.6), ring_tone=ROPE)
    finial(m, 3.75)
    with tinted(m, CORAL):
        for k, (x, y) in enumerate(((0.34, 0.3), (-0.36, 0.26), (0.3, -0.34))):
            base = Vector((x, y, 0.7))
            mid = base + Vector((x * 0.2, y * 0.2, 0.3))
            bar(m, base, mid, 0.05, band="plaster", sides=5, r1=0.04, caps=False)
            for dx, dy, dz in ((0.12, 0.04, 0.26), (-0.06, 0.1, 0.32), (0.0, -0.1, 0.22)):
                bar(m, mid, mid + Vector((dx * (1 + 0.2 * k), dy, dz)), 0.035, band="plaster", sides=4, r1=0.012)
    return arm(m, 3.74)


LAMPS = {
    "mirefen_witchflame": lamp_witchflame,
    "thornpeak_beacon": lamp_beacon,
    "veiled_crystal": lamp_veiled,
    "drakelands_brazier": lamp_brazier,
    "frostveil_icicle": lamp_icicle,
    "amberfall_crystal": lamp_amber,
    "willowfen_reed": lamp_reed,
    "nightbloom_moonflower": lamp_moonflower,
    "wraithwood_ghost": lamp_ghost,
    "palmreach_totem": lamp_totem,
    "evergarden_flower": lamp_flower,
    "galecrest_mast": lamp_mast,
    "farshore_coral": lamp_coral,
}


def zone_lamp(style):
    m = Model("streetlamp_" + style)
    m.sockets = {"LIGHT_SOCKET": tuple(LAMPS[style](m))}
    return m


# -- the muster camp --------------------------------------------------------------------------


def stake(m, x, y, top, r=0.29, shade=1.0, point=0.9):
    """One sharpened log of a stockade."""
    bar(m, (x, y, 0.0), (x, y, top - point), r, band="oak", sides=7, shade=shade, caps=False)
    bar(m, (x, y, top - point), (x, y, top), r, band="oak", sides=7, r1=0.03, shade=shade * 0.88, caps=False)


def stockade(m, xs, y, tops, r=0.29):
    for i, (x, top) in enumerate(zip(xs, tops)):
        stake(m, x, y, top, r=r, shade=0.92 if i % 2 else 1.0)


def camp_palisade():
    """A length of the camp's stockade: sharpened logs lashed to two rails, braced from
    behind, footed with stones in front. The stake row stands 0.3 forward of the centre,
    where the sim's wall is."""
    m = Model("muster_palisade")
    xs = [-2.92 + i * 0.584 for i in range(11)]
    tops = [4.1, 4.54, 3.9, 4.3, 4.0, 4.5, 3.85, 4.25, 4.54, 3.95, 4.2]
    stockade(m, xs, -0.3, tops)
    for z in (1.3, 3.0):
        wood(m, -3.21, 3.21, -0.04, 0.16, z, z + 0.22, "planks")
    for x in (-2.0, 0.0, 2.0):
        m.sweep([(x, 0.1, 3.0), (x, 1.31, 0.0)], (0.2, 0.24), "oak", depth=0.4, shade=0.8)
    with tinted(m, ROPE):
        wood(m, -3.21, 3.21, -0.62, -0.58, 2.2, 2.36, "plaster")
    for i, (x, r) in enumerate(((-2.5, 0.34), (-1.1, 0.26), (0.5, 0.33), (2.2, 0.3))):
        rock(m, x, -1.435 + r, r, r * 1.1, seed=20 + i, shade=0.95)
    return m


def camp_gate():
    """The camp's gate: two wings of stockade either side of a 3.9 yard way in, their inner
    posts carrying a beam and the muster's colours over the road."""
    m = Model("muster_gate")
    y = -0.45
    for sign in (-1.0, 1.0):
        xs = [sign * (2.765 + i * 0.5825) for i in range(5)]
        tops = [4.9, 4.5, 5.1, 4.6, 5.0]
        stockade(m, xs, y, tops, r=0.275)
        # the gate post: thicker, taller, squared off to take the beam
        bar(m, (sign * 2.22, y, 0.0), (sign * 2.22, y, 5.6), 0.27, band="oak", sides=8, shade=0.95)
        m.gem(Vector((sign * 2.22, y, 5.78)), 0.13, stretch=1.4)
        for z in (1.4, 3.4):
            a, b = sorted((sign * 2.0, sign * 5.37))
            wood(m, a, b, y + 0.26, y + 0.46, z, z + 0.22, "planks")
        for x in (sign * 3.2, sign * 4.7):
            m.sweep([(x, y + 0.36, 3.4), (x, 1.39, 0.0)], (0.2, 0.24), "oak", depth=0.4, shade=0.8)
        # stakes set in the ground before each wing, leaning out at whoever comes
        for i in range(3):
            x = sign * (2.9 + i * 0.95)
            bar(m, (x, y - 0.2, 0.0), (x, -1.5, 1.5), 0.09, band="oak", sides=5, r1=0.015, shade=0.85, caps=False)
        with tinted(m, ROPE):
            a, b = sorted((sign * 2.4, sign * 5.37))
            wood(m, a, b, y - 0.3, y - 0.26, 2.4, 2.56, "plaster")
    bar(m, (-2.6, y, 5.1), (2.6, y, 5.1), 0.2, band="oak", sides=7, shade=0.9)
    bar(m, (-2.3, y, 4.55), (2.3, y, 4.55), 0.11, band="oak", sides=6, shade=0.85, caps=False)
    with tinted(m, RED):
        for sign, lit in ((-1.0, 1.0), (1.0, 0.7)):
            pts = [(-0.8, y - 0.02 * sign, 4.5), (0.8, y - 0.02 * sign, 4.5), (0.8, y - 0.02 * sign, 3.6), (0.0, y - 0.02 * sign, 3.2), (-0.8, y - 0.02 * sign, 3.6)]
            m.face(pts, [uv_band("plaster", p[0] + 0.8, (4.5 - p[2]) / 1.3, 1.3) for p in pts], "trim", lit, (0.0, sign, 0.0))
    with tinted(m, GOLD):
        m.gem(Vector((0.0, y - 0.05, 4.0)), 0.2, band="plaster", stretch=1.0)
    return m


def camp_barricade():
    """A spiked barricade: sharpened stakes lashed over a log, their points toward the
    road, and a pike flying the colours at one end."""
    m = Model("muster_barricade")
    y = 0.25
    bar(m, (-3.1, y, 0.95), (3.1, y, 0.95), 0.2, band="oak", sides=7, shade=0.92)
    for i in range(8):
        x = -2.7 + i * 0.77
        back = 1.19 - 0.09
        bar(m, (x, back, 0.0), (x, -1.19, 2.3 + 0.25 * (i % 2)), 0.1, band="oak", sides=5, r1=0.012, shade=0.95 if i % 2 else 0.85, caps=False)
    for x in (-2.95, 0.0, 2.95):
        # the trestle the log rides on
        m.sweep([(x, y - 0.8, 0.0), (x, y + 0.12, 1.0)], (0.14, 0.16), "oak", depth=0.3, shade=0.75)
        m.sweep([(x, y + 0.84, 0.0), (x, y - 0.12, 1.0)], (0.14, 0.16), "oak", depth=0.3, shade=0.75)
    with tinted(m, ROPE):
        for i in range(8):
            x = -2.7 + i * 0.77
            m.lathe(Frame((x - 0.07, y, 0.95), (0, 1, 0), (1, 0, 0), (0, 0, 1)), [(0.215, 0.0), (0.215, 0.14)], sides=7, skin=("band", "plaster", 0.14))
    bar(m, (-3.05, y, 0.0), (-3.05, y, 3.82), 0.05, band="oak", sides=6)
    with tinted(m, (0.7, 0.72, 0.76)):
        m.gem(Vector((-3.05, y, 3.87)), 0.06, band="plaster", stretch=1.5)
    pennant(m, (-3.05, y, 3.7), (-3.05, y, 3.2), (-2.3, y, 3.42), RED, side=(0.0, -1.0, 0.0))
    return m


def camp_tower():
    """The camp's watchtower: four splayed legs where the sim stands its posts, a boarded
    lookout, a roof, and the ladder up its front."""
    m = Model("muster_watchtower")
    fx, fy, by = 1.68, -1.42, 1.95
    cy, top = 0.265, 1.34
    deck, eave = 6.1, 8.3
    corners = [(sx, y0, y1) for sx in (-1.0, 1.0) for y0, y1 in ((fy, cy - top), (by, cy + top))]
    for sx, y0, y1 in corners:
        m.sweep([(sx * fx, y0, 0.0), (sx * top, y1, deck), (sx * top, y1, eave)], (0.26, 0.26), "oak", depth=0.5, caps=False)
    # braces: a cross on each side and the back, a tie along the front under the deck
    for sx in (-1.0, 1.0):
        m.sweep([(sx * 1.62, fy + 0.1, 0.8), (sx * 1.38, cy + top, 5.4)], (0.12, 0.14), "oak", depth=0.3, caps=False, shade=0.8)
        m.sweep([(sx * 1.62, by - 0.1, 0.8), (sx * 1.38, cy - top, 5.4)], (0.12, 0.14), "oak", depth=0.3, caps=False, shade=0.8)
    m.sweep([(-1.62, by - 0.06, 0.8), (1.38, cy + top, 5.4)], (0.12, 0.14), "oak", depth=0.3, caps=False, shade=0.8)
    m.sweep([(1.62, by - 0.06, 0.8), (-1.38, cy + top, 5.4)], (0.12, 0.14), "oak", depth=0.3, caps=False, shade=0.8)
    for z in (3.2, 5.5):
        t = z / deck
        half = fx + (top - fx) * t
        m.sweep([(-half, fy + (cy - top - fy) * t, z), (half, fy + (cy - top - fy) * t, z)], (0.12, 0.14), "oak", depth=0.3, caps=False, shade=0.85)
    wood(m, -top - 0.22, top + 0.22, cy - top - 0.22, cy + top + 0.22, deck - 0.14, deck, "planks", axis="x")
    # the lookout's boarded sides, the front left open above the ladder
    for x0, x1, y0, y1 in ((-top - 0.16, -top - 0.08, cy - top, cy + top), (top + 0.08, top + 0.16, cy - top, cy + top), (-top, top, cy + top + 0.08, cy + top + 0.16)):
        wood(m, x0, x1, y0, y1, deck, deck + 1.0, "planks", axis="x" if x1 - x0 > y1 - y0 else "y", shade=0.92)
    for sx in (-1.0, 1.0):
        wood(m, sx * top - 0.25 if sx > 0 else -top - 0.16, sx * top + 0.16 if sx > 0 else -top + 0.25, cy - top - 0.16, cy - top - 0.08, deck, deck + 1.0, "planks", axis="x", shade=0.92)
    m.swept_roof(-top - 0.5, top + 0.5, cy - top - 0.4, cy + top + 0.4, eave, rise=1.35, ridge="y", prow=0.2, sweep=0.4, eave_out=0.4, eave_drop=0.3, gable_out=0.1, thick=0.14, board=0.3, horn=0.15, gable="timber", collide=False)
    # the ladder, footed out at the front bound
    foot_y, head_y = -2.49, cy - top - 0.22
    for sx in (-0.3, 0.3):
        m.sweep([(sx, foot_y, 0.0), (sx, head_y, deck + 0.2)], (0.08, 0.08), "oak", depth=0.16, caps=False)
    for k in range(14):
        t = (k + 1) / 15
        m.sweep([(-0.3, foot_y + (head_y - foot_y) * t, (deck + 0.2) * t), (0.3, foot_y + (head_y - foot_y) * t, (deck + 0.2) * t)], (0.06, 0.06), "oak", depth=0.12, caps=False)
    m.hung_lamp(0.0, cy - top - 0.3, eave - 0.1, 1.1)
    pennant(m, (top + 0.1, cy + top, eave - 0.2), (top + 0.1, cy + top, eave - 1.2), (top + 0.1, cy + top + 0.6, eave - 0.7), RED)
    return m


def camp_tent(name, half, wall, ridge, front, back, peg, reach):
    """A campaign tent: canvas walls under a pitched fly on a ridge pole, its front tied
    open, guyed to pegs. `front` and `back` are where its canvas ends; `peg` and `reach`
    are how far its guys and its ridge pole run (the release tent's bounds)."""
    m = Model(name)
    canvas = (0.86, 0.8, 0.66)
    span = back - front

    def sheet(pts, lit, facing):
        uvs = [uv_band("plaster", p[1] - front if abs(facing[0]) > 0.1 else p[0] + half, p[2] / ridge, ridge * 1.4) for p in pts]
        m.face(pts, uvs, "trim", lit, facing)
        m.face(list(reversed(pts)), list(reversed(uvs)), "trim", lit * 0.5, tuple(-v for v in facing))

    with tinted(m, canvas):
        for sx in (-1.0, 1.0):
            sheet([(sx * half, front, 0.0), (sx * half, back, 0.0), (sx * half, back, wall), (sx * half, front, wall)], 0.9 if sx < 0 else 0.76, (sx, 0.0, 0.0))
            sheet([(sx * (half + 0.16), front - 0.1, wall - 0.06), (sx * (half + 0.16), back + 0.1, wall - 0.06), (0.0, back + 0.1, ridge), (0.0, front - 0.1, ridge)], 1.0 if sx < 0 else 0.84, (sx, 0.0, 0.8))
        sheet([(-half, back, 0.0), (half, back, 0.0), (half, back, wall), (0.0, back, ridge - 0.04), (-half, back, wall)], 0.72, (0.0, 1.0, 0.0))
        # the front, tied back either side of the way in
        for sx in (-1.0, 1.0):
            sheet([(sx * half, front, 0.0), (sx * half * 0.46, front, 0.0), (sx * 0.06, front, ridge - 0.1), (sx * half, front, wall)], 0.8, (0.0, -1.0, 0.0))
    with tinted(m, RED):
        for sx in (-1.0, 1.0):
            wood(m, sx * (half + 0.17) - 0.01, sx * (half + 0.17) + 0.01, front - 0.1, back + 0.1, wall - 0.2, wall - 0.06, "plaster", axis="y")
    bar(m, (0.0, -reach, ridge + 0.03), (0.0, reach, ridge + 0.03), 0.06, band="oak", sides=6)
    for y in (front - 0.1, back + 0.1):
        bar(m, (0.0, y, 0.0), (0.0, y, ridge), 0.07, band="oak", sides=6, caps=False)
    for y in (-reach, reach):
        m.gem(Vector((0.0, y, ridge + 0.03)), 0.09)
    with tinted(m, ROPE):
        for sx in (-1.0, 1.0):
            for y in (front + span * 0.12, front + span * 0.5, back - span * 0.12):
                bar(m, (sx * (half + 0.16), y, wall - 0.06), (sx * (peg - 0.05), y, 0.06), 0.014, band="plaster", sides=4, caps=False)
    for sx in (-1.0, 1.0):
        for y in (front + span * 0.12, front + span * 0.5, back - span * 0.12):
            bar(m, (sx * (peg - 0.09), y, 0.0), (sx * peg - sx * 0.02, y, 0.26), 0.035, band="oak", sides=4, caps=False)
    # a bedroll and a chest just inside
    with tinted(m, (0.5, 0.36, 0.3)):
        bar(m, (-half * 0.7, front + span * 0.45, 0.14), (-half * 0.7, back - 0.3, 0.14), 0.14, band="plaster", sides=6)
    m.crate(half * 0.5, back - 0.6, 0.0, size=0.7, turn=0.3)
    return m


def camp_rack():
    """The arms rack: two trestles, two rails, a row of shardpikes and a pair of shields."""
    m = Model("muster_weapon_rack")
    for sx in (-1.0, 1.0):
        x = sx * 1.55
        m.sweep([(x, -0.78, 0.0), (x, 0.0, 1.7)], (0.16, 0.16), "oak", depth=0.3, shade=0.9)
        m.sweep([(x, 0.78, 0.0), (x, 0.0, 1.7)], (0.16, 0.16), "oak", depth=0.3, shade=0.8)
        m.gem(Vector((x, 0.0, 1.84)), 0.1)
    for z, y in ((0.55, -0.5), (1.5, -0.08)):
        bar(m, (-1.75, y, z), (1.75, y, z), 0.07, band="oak", sides=6)
    for i in range(7):
        x = -1.2 + i * 0.4
        tip = Vector((x, 0.14, 2.78))
        bar(m, (x, -0.66, 0.03), tip, 0.035, band="oak", sides=5, caps=False)
        with tinted(m, IRON):
            m.lathe(Frame(tip - Vector((0.0, 0.03, 0.1)), (1, 0, 0), UP, (0, 1, 0)), [(0.05, 0.0), (0.05, 0.1)], sides=5, skin=("band", "plaster", 0.1))
        m.gem(tip + Vector((0.0, 0.01, 0.12)), 0.06 if i % 2 else 0.075, band="teal", stretch=2.0)
    for x, tone in ((-0.9, RED), (0.85, (0.2, 0.32, 0.5))):
        disc = Frame((x, -0.6, 0.52), (1, 0, 0), (0.0, -0.94, 0.34))
        with tinted(m, tone):
            m.lathe(disc, [(0.46, 0.0), (0.42, 0.06), (0.14, 0.1)], sides=10, skin=("band", "plaster", 0.5), smooth=False)
        m.lathe(disc, [(0.14, 0.1), (0.1, 0.17), (0.0, 0.19)], sides=8, skin=("band", "gilded", 0.2))
    return m


def camp_lantern():
    """The camp's lantern post: a stave in a ring of stones, a yard across its head, the
    lantern on one arm and the muster's colours on the other. The post stands at the
    centre, where the sim's is."""
    m = Model("muster_lantern_post")
    for i, (x, y, r) in enumerate(((0.2, 0.16, 0.26), (-0.22, 0.1, 0.25), (0.02, -0.24, 0.24))):
        rock(m, x, y, r, 0.3, seed=40 + i, shade=0.95)
    m.lathe(WORLD, [(0.085, 0.0), (0.07, 2.72), (0.0, 2.76)], sides=7, skin=("band", "oak", 0.4))
    m.gem(Vector((0.0, 0.0, 2.85)), 0.07)
    bar(m, (0.0, -0.6, 2.5), (0.0, 0.66, 2.5), 0.04, band="oak", sides=5)
    with tinted(m, ROPE):
        m.lathe(at(0.0, 0.0, 2.42), [(0.1, 0.0), (0.1, 0.16)], sides=7, skin=("band", "plaster", 0.1))
    pennant(m, (0.0, 0.2, 2.46), (0.0, 0.64, 2.46), (0.0, 0.42, 1.7), RED)
    spot = lantern(m, 0.0, -0.42, 2.46, 0.95)
    m.sockets = {"Socket_Light": spot}
    return m


def camp_torch():
    """A standing torch: a stave wedged in stones, an iron cresset on its head. The game
    lights the fire at the socket."""
    m = Model("muster_torch")
    for i, (x, y, r) in enumerate(((0.16, 0.2, 0.24), (-0.18, 0.18, 0.22), (0.0, -0.2, 0.24))):
        rock(m, x, y, r, 0.3, seed=60 + i, shade=0.95)
    bar(m, (0.0, 0.0, 0.0), (0.0, 0.0, 1.98), 0.05, band="oak", sides=6)
    with tinted(m, RED):
        m.lathe(at(0.0, 0.0, 1.62), [(0.065, 0.0), (0.065, 0.22)], sides=6, skin=("band", "plaster", 0.2))
    cup = at(0.0, 0.0, 1.96)
    with tinted(m, IRON):
        m.lathe(cup, [(0.06, -0.04), (0.16, 0.08), (0.2, 0.27)], sides=8, skin=("band", "plaster", 0.3))
        m.lathe(cup, [(0.2, 0.27), (0.16, 0.27), (0.11, 0.13), (0.0, 0.11)], sides=8, skin=("band", "plaster", 0.3), shade=0.55)
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            tip = Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, 2.23))
            bar(m, tip, tip + Vector((0.0, 0.0, 0.11)), 0.022, band="plaster", sides=4, r1=0.006)
    m.sockets = {"Socket_Flame": (0.0, 0.0, 2.36)}
    return m


def sack_at(m, x, y, z, s=0.75, axis=None, tone=(0.84, 0.7, 0.48)):
    fr = at(x, y, z) if axis is None else Frame((x, y, z), (0, 1, 0), axis)
    with tinted(m, tone):
        m.lathe(fr, [(0.0, 0.0), (0.4 * s, 0.02 * s), (0.47 * s, 0.22 * s), (0.44 * s, 0.5 * s), (0.24 * s, 0.7 * s), (0.11 * s, 0.76 * s), (0.2 * s, 0.9 * s), (0.0, 0.87 * s)], sides=8, skin=("band", "plaster", 0.9 * s))
    with tinted(m, ROPE):
        m.lathe(Frame(fr.p(0.0, 0.73 * s, 0.0), fr.r, fr.u, fr.n), [(0.13 * s, 0.0), (0.13 * s, 0.06 * s)], sides=8, skin=("band", "plaster", 0.2))


def camp_sacks():
    """A stack of grain sacks: three stood in a row, one thrown across them."""
    m = Model("muster_sacks")
    for x, y, s, tone in ((-0.64, 0.04, 0.74, (0.8, 0.64, 0.4)), (0.0, -0.04, 0.8, (0.72, 0.58, 0.38)), (0.64, 0.05, 0.72, (0.84, 0.68, 0.44))):
        sack_at(m, x, y, 0.0, s, tone=tone)
    sack_at(m, -0.34, 0.0, 0.74, 0.7, axis=(1.0, 0.0, 0.1), tone=(0.76, 0.62, 0.4))
    return m


def wheel(m, fr, radius=0.74, spokes=10):
    """A cart wheel in the frame's x/z plane, its axle along the frame's up."""
    m.lathe(fr, [(radius, -0.06), (radius, 0.06)], sides=14, skin=("band", "oak", 0.12))
    m.lathe(fr, [(radius, 0.06), (radius - 0.13, 0.06)], sides=14, skin=("band", "oak", 0.2), smooth=False, shade=0.85)
    m.lathe(fr, [(radius - 0.13, -0.06), (radius, -0.06)], sides=14, skin=("band", "oak", 0.2), smooth=False, shade=0.7)
    m.lathe(fr, [(radius - 0.13, 0.06), (radius - 0.13, -0.06)], sides=14, skin=("band", "oak", 0.12), shade=0.6)
    with tinted(m, IRON):
        m.lathe(fr, [(radius + 0.012, -0.066), (radius + 0.012, 0.066)], sides=14, skin=("band", "plaster", 0.14))
    m.lathe(fr, [(0.13, -0.11), (0.13, 0.11), (0.0, 0.14)], sides=8, skin=("band", "gilded", 0.2))
    m.lathe(fr, [(0.0, -0.14), (0.13, -0.11)], sides=8, skin=("band", "gilded", 0.2), shade=0.7)
    for k in range(spokes):
        a = math.tau * k / spokes
        c, s = math.cos(a), math.sin(a)
        m.sweep([fr.p(c * 0.12, 0.0, s * 0.12), fr.p(c * (radius - 0.12), 0.0, s * (radius - 0.12))], (0.06, 0.07), "oak", depth=0.12, up=fr.u, caps=False, shade=0.9)


def camp_wheel():
    """A spare cart wheel, leaned on a field stone."""
    m = Model("muster_cart_wheel")
    lean = math.radians(28.0)
    radius = 0.74
    centre = (0.0, -0.1, radius * math.cos(lean) + 0.02)
    wheel(m, Frame(centre, (1, 0, 0), (0.0, -math.cos(lean), math.sin(lean))), radius)
    rock(m, 0.1, 0.5, 0.36, 0.62, seed=71)
    rock(m, -0.5, 0.34, 0.2, 0.26, seed=72, shade=0.92)
    return m


# -- the fen and the wild's small things ------------------------------------------------------


def toadstool(m, x, y, z, height, cap_r, tone, stem=0.28, droop=0.3, glow=False, spots=0, lean=(0.0, 0.0), seed=0):
    """One mushroom: a pale stem, a domed cap in `tone`, pale gills beneath. `glow` lights
    the gills; `spots` flecks the cap."""
    fr = at(x, y, z)
    sr = cap_r * stem
    stalk = [(sr * 1.25, 0.0), (sr, height * 0.3), (sr * 0.86, height * 0.72)]
    with tinted(m, (0.94, 0.9, 0.78)):
        m.lathe(fr, stalk, sides=7, skin=("band", "plaster", height), lean=[(0.0, 0.0), (lean[0] * 0.5, lean[1] * 0.5), lean])
    head = Frame(fr.p(lean[0], 0.0, lean[1]), fr.r, fr.u, fr.n)
    rim = height * (0.72 - droop * 0.2)
    dome = [(cap_r, rim), (cap_r * 0.94, rim + (height - rim) * 0.42), (cap_r * 0.66, rim + (height - rim) * 0.8), (cap_r * 0.3, height * 0.985), (0.0, height)]
    with tinted(m, tone):
        m.lathe(head, dome, sides=9, skin=("band", "plaster", cap_r * 2.0))
    gills = [(sr * 0.86, height * 0.72), (cap_r, rim)]
    if glow:
        # the gills in the glowing glass, so the cap is lit from beneath
        for i in range(9):
            a0, a1 = math.tau * i / 9, math.tau * (i + 1) / 9
            pts = [head.p(gills[0][0] * math.cos(a0), gills[0][1], gills[0][0] * math.sin(a0)), head.p(gills[0][0] * math.cos(a1), gills[0][1], gills[0][0] * math.sin(a1)), head.p(cap_r * math.cos(a1), rim, cap_r * math.sin(a1)), head.p(cap_r * math.cos(a0), rim, cap_r * math.sin(a0))]
            m.face(pts, [uv_tile("glass", 0.2, 0.2), uv_tile("glass", 0.6, 0.2), uv_tile("glass", 0.6, 0.6), uv_tile("glass", 0.2, 0.6)], "glass", 1.0, (0.0, 0.0, -1.0))
    else:
        with tinted(m, (0.84, 0.76, 0.62)):
            m.lathe(head, gills, sides=9, skin=("band", "plaster", cap_r), shade=0.7)
    rng = random.Random(seed)
    with tinted(m, (0.98, 0.95, 0.86)):
        for k in range(spots):
            a = math.tau * (k + rng.uniform(0.0, 0.6)) / spots
            t = rng.uniform(0.3, 0.74)
            r = cap_r * (0.96 - 0.68 * t * t)
            h = rim + (height - rim) * (0.3 + 0.62 * t)
            m.gem(head.p(math.cos(a) * r, h, math.sin(a) * r), cap_r * 0.085, band="plaster", stretch=0.5)


def hut_mushroom():
    """The great red toadstool the mudfin hollow out for a house (the game draws it many
    times its own size and paints the doorway on)."""
    m = Model("mushroom_red")
    toadstool(m, 0.0, 0.0, 0.0, 2.9, 1.34, (0.74, 0.2, 0.14), stem=0.66, droop=0.9, spots=9, seed=4)
    return m


def toadstools():
    """A knot of small tan toadstools."""
    m = Model("mushroom_tan")
    tan = (0.8, 0.6, 0.36)
    toadstool(m, -0.1, 0.06, 0.0, 0.6, 0.27, tan, lean=(0.02, 0.0), seed=1)
    toadstool(m, 0.2, -0.14, 0.0, 0.42, 0.2, (0.74, 0.52, 0.3), lean=(0.03, -0.02), seed=2)
    toadstool(m, 0.1, 0.24, 0.0, 0.3, 0.15, tan, seed=3)
    return m


def giant_mushroom():
    """A tall purple mushroom and its young, for the Hollow's floor."""
    m = Model("mushroom_giant_purple")
    toadstool(m, -0.1, 0.1, 0.0, 0.98, 0.3, PURPLE, stem=0.3, droop=0.0, spots=7, lean=(0.03, 0.0), seed=7)
    toadstool(m, 0.25, -0.22, 0.0, 0.46, 0.15, (0.6, 0.36, 0.76), stem=0.34, droop=0.0, spots=4, seed=8)
    toadstool(m, 0.24, 0.26, 0.0, 0.3, 0.11, PURPLE, stem=0.36, droop=0.0, seed=9)
    toadstool(m, -0.28, -0.28, 0.0, 0.24, 0.1, (0.6, 0.36, 0.76), stem=0.36, droop=0.0, seed=10)
    return m


def glow_cluster():
    """A cluster of teal mushrooms, their gills alight."""
    m = Model("mushroom_glow_cluster")
    teal = (0.3, 0.72, 0.7)
    toadstool(m, -0.12, 0.14, 0.0, 0.97, 0.26, teal, stem=0.3, droop=0.0, glow=True, lean=(0.04, 0.02), seed=11)
    toadstool(m, 0.2, -0.2, 0.0, 0.64, 0.18, (0.26, 0.62, 0.66), stem=0.32, droop=0.0, glow=True, lean=(0.03, -0.03), seed=12)
    toadstool(m, -0.24, -0.28, 0.0, 0.4, 0.13, teal, stem=0.34, droop=0.0, glow=True, seed=13)
    toadstool(m, 0.22, 0.28, 0.0, 0.3, 0.11, (0.26, 0.62, 0.66), stem=0.36, droop=0.0, glow=True, seed=14)
    # motes of the same light on the tall cap
    for k in range(4):
        a = math.tau * k / 4 + 0.5
        flame(m, (-0.08 + math.cos(a) * 0.15, 0.16 + math.sin(a) * 0.15, 0.9), 0.022, 0.03)
    return m


def blade(m, foot_pt, tip, width, tone, bend=0.0):
    """One leaf: a tapering strip from the ground to its tip, seen from both sides."""
    a, b = Vector(foot_pt), Vector(tip)
    along = b - a
    side = along.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-4:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    out = side.cross(along).normalized()
    mid = a.lerp(b, 0.55) + out * bend
    length = along.length
    with tinted(m, tone):
        for p0, p1, w0, w1, t0, t1 in ((a, mid, width, width * 0.8, 0.0, 0.55), (mid, b, width * 0.8, 0.02, 0.55, 1.0)):
            pts = [p0 - side * w0 / 2, p0 + side * w0 / 2, p1 + side * w1 / 2, p1 - side * w1 / 2]
            uvs = [uv_band("plaster", 0.0, t0, length), uv_band("plaster", width, t0, length), uv_band("plaster", width, t1, length), uv_band("plaster", 0.0, t1, length)]
            m.face(pts, uvs, "trim", 1.0, out)
            m.face(list(reversed(pts)), list(reversed(uvs)), "trim", 0.74, -out)


def reed_clump(name, radius, deep, height, blades, tails, seed):
    """A clump of reeds: green blades leaning every way, a few cattails standing over them."""
    m = Model(name)
    rng = random.Random(seed)
    for i in range(blades):
        a = math.tau * i / blades + rng.uniform(-0.2, 0.2)
        r0 = rng.uniform(0.02, 0.3) * radius
        r1 = rng.uniform(0.45, 1.0) * radius
        h = height * rng.uniform(0.5, 0.86)
        tone = (REED[0] * rng.uniform(0.8, 1.0), REED[1] * rng.uniform(0.82, 1.0), REED[2])
        blade(m, (math.cos(a) * r0, math.sin(a) * r0 * deep, 0.0), (math.cos(a) * r1, math.sin(a) * r1 * deep, h), radius * 0.16, tone, bend=radius * 0.1)
    for i in range(tails):
        a = math.tau * i / tails + 0.6
        r0, r1 = 0.14 * radius, rng.uniform(0.2, 0.42) * radius
        top = height * (0.98 if i == 0 else rng.uniform(0.78, 0.95))
        foot_pt = Vector((math.cos(a) * r0, math.sin(a) * r0 * deep, 0.0))
        head = Vector((math.cos(a) * r1, math.sin(a) * r1 * deep, top))
        with tinted(m, REED):
            bar(m, foot_pt, head, radius * 0.022, band="plaster", sides=4, caps=False)
        with tinted(m, (0.44, 0.27, 0.16)):
            neck = foot_pt.lerp(head, 0.78)
            bar(m, neck, foot_pt.lerp(head, 0.97), radius * 0.06, band="plaster", sides=6)
    return m


def lily_raft():
    """A raft of lily pads on still water, two of them in flower."""
    m = Model("fen_lilies")
    pads = ((0.0, 0.02, 0.2), (0.28, 0.2, 0.17), (-0.3, 0.16, 0.16), (-0.2, -0.26, 0.19), (0.24, -0.24, 0.15), (0.0, 0.34, 0.12), (-0.38, -0.04, 0.1))
    for i, (x, y, r) in enumerate(pads):
        tone = (LEAF[0] * (0.9 + 0.1 * (i % 3)), LEAF[1] * (0.86 + 0.07 * (i % 3)), LEAF[2])
        with tinted(m, tone):
            # a pad is a disc with a wedge cut from it
            m.lathe(at(x, y, 0.012 + 0.004 * (i % 3)), [(r, 0.0), (r * 0.5, 0.012), (0.0, 0.006)], sides=9, skin=("band", "plaster", r), smooth=False, arc=(20.0 + 47.0 * i, 350.0 + 47.0 * i))
    for (x, y, r), tone in ((pads[0], PETAL), (pads[3], (0.98, 0.95, 0.9))):
        c = Vector((x + r * 0.2, y - r * 0.1, 0.07))
        with tinted(m, tone):
            for k in range(6):
                a = math.tau * k / 6
                m.gem(c + Vector((math.cos(a) * 0.055, math.sin(a) * 0.055, 0.0)), 0.045, band="plaster", stretch=1.6)
        with tinted(m, GOLD):
            m.gem(c + Vector((0.0, 0.0, 0.06)), 0.03, band="plaster", stretch=1.6)
    return m


def fen_log():
    """A fallen log gone to moss, a snapped limb on it and toadstools in its lee."""
    m = Model("fen_log")
    with tinted(m, (0.62, 0.5, 0.4)):
        bar(m, (-0.47, 0.02, 0.16), (0.44, -0.04, 0.17), 0.16, band="oak", sides=8, r1=0.13)
        bar(m, (0.1, -0.02, 0.24), (0.3, 0.26, 0.37), 0.05, band="oak", sides=5, r1=0.03)
    with tinted(m, MOSS):
        for x, y, r in ((-0.26, 0.02, 0.13), (0.06, -0.02, 0.11), (0.3, -0.03, 0.08)):
            m.lathe(at(x, y, 0.27), [(r, 0.0), (r * 0.6, 0.05), (0.0, 0.07)], sides=6, skin=("band", "plaster", 0.2), smooth=False)
    toadstool(m, -0.1, -0.24, 0.0, 0.2, 0.08, (0.8, 0.6, 0.36), seed=21)
    toadstool(m, 0.04, -0.28, 0.0, 0.13, 0.06, (0.74, 0.52, 0.3), seed=22)
    return m


def fen_mushrooms():
    """A row of marsh mushrooms, brown and broad."""
    m = Model("fen_mushrooms")
    brown = (0.66, 0.44, 0.26)
    for i, (x, y, h, r) in enumerate(((-0.3, 0.02, 0.56, 0.18), (0.02, -0.08, 0.4, 0.16), (0.3, 0.04, 0.47, 0.17), (-0.08, 0.18, 0.26, 0.1), (0.18, -0.2, 0.2, 0.08))):
        toadstool(m, x, y, 0.0, h, r, brown if i % 2 else (0.74, 0.5, 0.3), spots=3 if i < 3 else 0, lean=(0.02 * (i - 2), 0.01), seed=30 + i)
    return m


def glow_flower():
    """A night flower: a stem, two leaves, and pale petals round a lit heart."""
    m = Model("flower_glow")
    with tinted(m, LEAF):
        bar(m, (0.0, 0.0, 0.0), (0.03, 0.0, 0.5), 0.022, band="plaster", sides=5, caps=False)
    blade(m, (0.0, 0.0, 0.02), (0.1, 0.47, 0.24), 0.16, LEAF, bend=0.06)
    blade(m, (0.0, 0.0, 0.02), (-0.08, -0.46, 0.2), 0.15, (LEAF[0] * 0.9, LEAF[1] * 0.9, LEAF[2]), bend=0.05)
    heart = Vector((0.03, 0.0, 0.54))
    for k in range(6):
        a = math.tau * k / 6
        out = Vector((math.cos(a), math.sin(a), 0.0))
        blade(m, heart - Vector((0.0, 0.0, 0.03)), heart + out * 0.35 + Vector((0.0, 0.0, 0.16)), 0.22, (0.86, 0.8, 1.0), bend=-0.05)
    flame(m, heart + Vector((0.0, 0.0, 0.06)), 0.07, 0.14)
    return m


def boardwalk():
    """A length of marsh boardwalk: planks laid across two bearers."""
    m = Model("fenbridge_boardwalk")
    for y in (-0.5, 0.5):
        wood(m, -2.0, 2.0, y - 0.07, y + 0.07, 0.0, 0.08, "oak", axis="x", shade=0.6)
    rng = random.Random(6)
    n = 12
    for i in range(n):
        x0 = -2.0 + i * 4.0 / n
        over = 0.7 if i in (0, 5, n - 1) else 0.7 - rng.uniform(0.0, 0.05)
        wood(m, x0 + 0.012, x0 + 4.0 / n - 0.012, -over, over, 0.08, 0.15, "planks", axis="y", shade=0.92 + 0.08 * (i % 2))
    m.sockets = {"Socket_LeftJoin": (-2.0, 0.0, 0.15), "Socket_RightJoin": (2.0, 0.0, 0.15)}
    return m


# -- the riding course ------------------------------------------------------------------------


def striped_rail(m, x0, x1, y, z, r=0.085, tones=(RED, LINEN), n=6):
    """A jump's pole, banded in two colours so a rider reads its height."""
    step = (x1 - x0) / n
    for i in range(n):
        with tinted(m, tones[i % 2]):
            bar(m, (x0 + i * step, y, z), (x0 + (i + 1) * step, y, z), r, band="plaster", sides=6, caps=i in (0, n - 1))


def wing(m, x, y, height, depth, flag=None):
    """A jump's standard: a post on a cross foot, a cup for every pole."""
    wood(m, x - 0.12, x + 0.12, y - depth / 2, y + depth / 2, 0.0, 0.16, "oak", axis="y", shade=0.8)
    wood(m, x - 0.4, x + 0.4, y - 0.1, y + 0.1, 0.0, 0.14, "oak", axis="x", shade=0.75)
    wood(m, x - 0.1, x + 0.1, y - 0.1, y + 0.1, 0.14, height, "oak", axis="z")
    m.gem(Vector((x, y, height + 0.07)), 0.09)
    if flag:
        pennant(m, (x, y, height - 0.04), (x, y, height - 0.36), (x, y + 0.5, height - 0.2), flag)


def jump_vertical():
    """An upright jump: two standards and three banded poles one over another."""
    m = Model("jump_vertical")
    for sx in (-1.0, 1.0):
        wing(m, sx * 3.55, 0.0, 1.62, 1.6, flag=(0.2, 0.5, 0.56))
    for z, tones in ((0.5, (RED, LINEN)), (0.95, (LINEN, RED)), (1.4, (RED, LINEN))):
        striped_rail(m, -3.5, 3.5, 0.0, z, tones=tones)
    return m


def jump_oxer():
    """A spread jump: a low pair of poles in front, a higher pair behind."""
    m = Model("jump_oxer")
    blue = (0.16, 0.3, 0.56)
    for sx in (-1.0, 1.0):
        wing(m, sx * 3.8, -0.55, 1.35, 0.8)
        wing(m, sx * 3.8, 0.55, 1.77, 0.8, flag=blue)
    for z, tones in ((0.55, (blue, LINEN)), (1.05, (LINEN, blue))):
        striped_rail(m, -3.75, 3.75, -0.55, z, tones=tones)
    for z, tones in ((0.7, (LINEN, blue)), (1.15, (blue, LINEN)), (1.55, (LINEN, blue))):
        striped_rail(m, -3.75, 3.75, 0.55, z, tones=tones)
    return m


def course_arch():
    """The course's start: two braced pylons on stone feet, a beam and a bowed head across
    them, the colours hung between and a pennant on each."""
    m = Model("course_arch")
    span, top = 4.75, 6.4
    for sx in (-1.0, 1.0):
        x = sx * span
        m.lathe(at(x, 0.0, 0.0), [(0.62, 0.0), (0.62, 0.3), (0.46, 0.42), (0.46, 0.8), (0.0, 0.8)], sides=4, skin=STONE, smooth=False)
        wood(m, x - 0.24, x + 0.24, -0.24, 0.24, 0.8, top + 0.9, "oak", axis="z")
        for sy in (-1.0, 1.0):
            m.sweep([(x, sy * 1.6, 0.0), (x, sy * 0.2, 3.3)], (0.2, 0.22), "oak", depth=0.4, shade=0.8)
        for z in (1.6, 4.4):
            m.lathe(at(x, 0.0, z), [(0.36, 0.0), (0.36, 0.16)], sides=4, skin=("band", "gilded", 0.16))
        m.gem(Vector((x, 0.0, top + 1.12)), 0.2)
        pennant(m, (x, 0.0, top + 0.86), (x, 0.0, top + 0.2), (x - sx * 1.2, 0.0, top + 0.55), RED, side=(0.0, -1.0, 0.0))
    wood(m, -span - 0.5, span + 0.5, -0.2, 0.2, top - 0.34, top, "oak", axis="x", shade=0.92)
    arc = [(span * math.cos(math.pi * i / 10), top + 1.25 * math.sin(math.pi * i / 10)) for i in range(11)]
    m.sweep([(px, 0.0, pz) for px, pz in arc], (0.3, 0.26), "bargeboard", depth=0.5, up=(0.0, 1.0, 0.0))
    for i in (2, 5, 8):
        px, pz = arc[i]
        wood(m, px - 0.1, px + 0.1, -0.1, 0.1, top, pz - 0.1, "oak", axis="z", shade=0.85)
    # the colours, hung from the beam either side of the way through
    for sx in (-1.0, 1.0):
        x0, x1 = sorted((sx * 1.3, sx * 3.5))
        for sign, lit in ((-1.0, 1.0), (1.0, 0.72)):
            pts = [(x0, 0.03 * sign, top - 0.34), (x1, 0.03 * sign, top - 0.34), (x1, 0.03 * sign, top - 1.5), ((x0 + x1) / 2, 0.03 * sign, top - 2.0), (x0, 0.03 * sign, top - 1.5)]
            with tinted(m, (0.16, 0.3, 0.56) if sx < 0 else RED):
                m.face(pts, [uv_band("plaster", p[0] - x0, (top - 0.34 - p[2]) / 1.66, 1.66) for p in pts], "trim", lit, (0.0, sign, 0.0))
        with tinted(m, GOLD):
            m.gem(Vector(((x0 + x1) / 2, -0.06, top - 1.1)), 0.24, band="plaster", stretch=1.0)
    return m


def muster_barrel():
    m = barrel_prop()
    m.name = "muster_barrel"
    return m


def muster_crate():
    m = crate_prop()
    m.name = "muster_crate"
    return m


LAMP_PROPS = {
    # every lamp ships five and a half yards tall, centred on its own footprint: the size the
    # game places a fixture at, so the loader has nothing to rescale
    # The zone street lamps, on quarter-size maps so each file stays inside the game's 128 KB
    # (tests/streetlamp_asset_wave.test.ts). Each style was stood beside the release lamp in
    # the same world and the two compared.
    #
    # The kit's stands where it looked as good or better; the release lamp stays where the
    # kit's looked worse (Mirefen, Farshore, Thornpeak), and in the Drakelands, whose brazier
    # also lights the forge, which keeps its own pieces.
    **{
        "props/streetlamp_" + style: dict(make=lambda style=style: zone_lamp(style), fit=False, tall=5.5, rename=GLOW, maps=256)
        for style in LAMPS
        if style not in ("drakelands_brazier", "mirefen_witchflame", "farshore_coral", "thornpeak_beacon")
    },
    # the muster camp: structure on the release bounds (the sim's colliders are measured
    # from them), loose clutter inside them
    # NOT built: the release camp stays. Stood beside it in the same world the kit's camp
    # looked no better, and the release pieces are texture-free by contract
    # (scripts/assets/muster_camp/contract.mjs: 24 to 80 KB a piece), which a kit piece
    # cannot meet with its painted sheets aboard.
    # "props/muster_palisade": dict(make=camp_palisade),
    # "props/muster_gate": dict(make=camp_gate),
    # "props/muster_barricade": dict(make=camp_barricade),
    # "props/muster_watchtower": dict(make=camp_tower),
    # "props/muster_tent_large": dict(make=lambda: camp_tent("muster_tent_large", 1.95, 1.1, 3.45, -2.0, 2.7, 2.69, 2.83)),
    # "props/muster_tent_small": dict(make=lambda: camp_tent("muster_tent_small", 1.4, 0.8, 2.56, -1.45, 2.1, 2.14, 2.23)),
    # "props/muster_weapon_rack": dict(make=camp_rack),
    # "props/muster_lantern_post": dict(make=camp_lantern),
    # "props/muster_torch": dict(make=camp_torch),
    # "props/muster_barrel": dict(make=muster_barrel),
    # "props/muster_crate": dict(make=muster_crate, fit="inside"),
    # "props/muster_sacks": dict(make=camp_sacks),
    # "props/muster_cart_wheel": dict(make=camp_wheel, fit="inside"),
    # the fen and the wild
    "props/fen_lilies": dict(make=lily_raft),
    "props/fen_log": dict(make=fen_log, fit="inside"),
    "props/fen_mushrooms": dict(make=fen_mushrooms, fit="inside"),
    "props/fen_reeds": dict(make=lambda: reed_clump("fen_reeds", 0.56, 0.54, 0.85, 16, 4, 5)),
    "props/reeds": dict(make=lambda: reed_clump("reeds", 0.42, 1.14, 1.0, 14, 5, 9)),
    "props/mushroom_red": dict(make=hut_mushroom),
    "props/mushroom_tan": dict(make=toadstools),
    # NOT built: the release piece stays. A rebuild was tried in the game and the sculpted
    # original looked better.
    # "props/mushroom_giant_purple": dict(make=giant_mushroom),
    # "props/mushroom_glow_cluster": dict(make=glow_cluster),
    # "props/flower_glow": dict(make=glow_flower),
    # Fenbridge draws its boardwalk through the town's own surface atlas, reading each
    # vertex's colour to pick a painted cell (src/render/fenbridge_town.ts
    # buildBoardwalkBatches), so a kit model would lose its paint there. The release deck
    # stays, in the town's painted planks; boardwalk() is kept for a town that draws its
    # own parts.
    # the riding course: authored across X, turned to the release models' long axis
    "props/course_arch": dict(make=course_arch, turn=90.0),
    "props/jump_vertical": dict(make=jump_vertical, turn=90.0),
    "props/jump_oxer": dict(make=jump_oxer, turn=90.0),
}
