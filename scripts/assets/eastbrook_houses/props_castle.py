# The castle kit and the last of the settlements' works (the windmills, the keep, the armed
# towers, the bell tower, palisades): the same kit and paintings as the harbour props, plus
# one more surface, a pale dressed stone ("ashlar": the house stone's own brushwork laid over
# a warm limestone, made in build_props.py). Dark rubble stone is what the houses stand on;
# pale ashlar is what the realm fortifies with.
#
# The castle pieces are modules the game assembles (src/render/dawnhold_features.ts and the
# two dressing passes), so every one is authored at EXACTLY the bounds of the release piece
# it replaces: walls still meet, parapets still sit on walls, and furniture still stands
# where each room's dressing puts it. build_props.py prints each piece's stretch: a wall
# module that does not read 1.0 on every axis has a wrong bound here.
#
# The settlement works are authored at the size the game draws them (yards) and scaled into
# the old model's bounds, so their stone and slate keep the texel size of the houses.
import math
import random

from kit import STOREY, UP, Frame, Model, side_frame, uv_band, uv_tile
from mathutils import Vector

from props import CANVAS, IRON, ROPE, bar, barrel_prop, chest, house, hull, tinted

WORLD = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
ASHLAR = ("tile", "ashlar")
STONE = ("tile", "stone")
GREEN = (0.16, 0.42, 0.27)
RED = (0.66, 0.14, 0.11)
GOLD = (0.95, 0.74, 0.28)
LINEN = (0.95, 0.91, 0.82)
NAVY = (0.12, 0.17, 0.42)
BOOKS = ((0.5, 0.14, 0.12), (0.14, 0.24, 0.42), (0.2, 0.36, 0.22), (0.62, 0.46, 0.2), (0.34, 0.2, 0.36), (0.82, 0.76, 0.6))
# half the thickness of a wall's own face: its plinth and coping stand out to 0.5
FACE = 0.44


def block(m, x0, x1, y0, y1, z0, z1, skin=ASHLAR, shade=1.0, skip=""):
    """A box in the model's own yards: x across, y from the front (-) to the back (+), z up."""
    m.box(WORLD, x0, x1, z0, z1, y0, y1, skin, shade=shade, skip=skip)


def wood(m, x0, x1, y0, y1, z0, z1, band="planks", axis=None, shade=1.0, skip=""):
    """A board or a beam: the grain runs along its longest side unless `axis` says which of
    the frame's axes it follows ("x" across, "y" up, "z" front to back)."""
    sizes = (x1 - x0, z1 - z0, y1 - y0)
    along = axis or "xyz"[sizes.index(max(sizes))]
    block(m, x0, x1, y0, y1, z0, z1, ("band", band, along, max(sorted(sizes)[1], 0.08)), shade=shade, skip=skip)


def turned(m, x, y, z, profile, band="oak", sides=10, depth=0.4, shade=1.0, smooth=True):
    """A turned piece standing at (x, y, z): [(radius, height)] up its outside."""
    m.lathe(Frame((x, y, z), (1, 0, 0), UP, (0, 1, 0)), profile, sides=sides, skin=("band", band, depth), smooth=smooth, shade=shade)


def candle(m, x, y, z, height=0.3, r=0.04):
    """A wax candle with a lit flame (the flame is the glowing window paint)."""
    with tinted(m, LINEN):
        turned(m, x, y, z, [(r, 0.0), (r, height), (0.0, height)], "plaster", sides=6, depth=0.2)
    m.lathe(Frame((x, y, z + height), (1, 0, 0), UP, (0, 1, 0)), [(0.0, 0.0), (r * 0.9, 0.04), (r * 0.6, 0.08), (0.0, 0.12)], sides=5, skin=("tile", "glass"))


def heater(m, cx, y, cz, w, h, field, rim=GOLD):
    """A heater shield flat against a wall: a gilt rim, a coloured field, a boss."""

    def shape(k):
        return [(-w / 2 * k, h / 2 * k), (w / 2 * k, h / 2 * k), (w / 2 * k, h * 0.05 * k), (w * 0.3 * k, -h * 0.3 * k), (0.0, -h / 2 * k), (-w * 0.3 * k, -h * 0.3 * k), (-w / 2 * k, h * 0.05 * k)]

    for k, out, colour in ((1.0, 0.0, rim), (0.84, 0.025, field)):
        pts = [(cx + px, y - out, cz + pz) for px, pz in shape(k)]
        with tinted(m, colour):
            m.face(pts, [uv_band("plaster", px, 0.5, 1.0) for px, _py, _pz in pts], "trim", 1.0, (0.0, -1.0, 0.0))
    m.gem(Vector((cx, y - 0.07, cz + h * 0.08)), w * 0.1)


# -- the castle's walls -------------------------------------------------------------------------


def arch_head(m, a, spring, top, depth=FACE, steps=6):
    """The head of a round-arched opening 2a wide: the wall between the arch and the level
    `top` on both faces, and the arch's own soffit."""
    crown = top - 0.04
    pts = [(a * math.cos(math.pi * (1 - i / steps)), spring + (crown - spring) * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    run = 0.0
    for (xa, za), (xb, zb) in zip(pts, pts[1:]):
        for y, facing, lit in ((-depth, (0.0, -1.0, 0.0), 0.8), (depth, (0.0, 1.0, 0.0), 0.97)):
            quad = [(xa, y, za), (xb, y, zb), (xb, y, top), (xa, y, top)]
            m.face(quad, [uv_tile("ashlar", p[0], p[2]) for p in quad], "ashlar", lit, facing)
        length = math.hypot(xb - xa, zb - za)
        quad = [(xa, -depth, za), (xb, -depth, zb), (xb, depth, zb), (xa, depth, za)]
        uvs = [uv_tile("ashlar", run, -depth), uv_tile("ashlar", run + length, -depth), uv_tile("ashlar", run + length, depth), uv_tile("ashlar", run, depth)]
        m.face(quad, uvs, "ashlar", 0.62, (-(xa + xb) / 2, 0.0, spring - (za + zb) / 2 - 0.01))
        run += length


def courses(m, spans, x0, x1, top=4.0):
    """The dark plinth under each solid span of a wall, and the string and coping along it."""
    for a, b in spans:
        block(m, a, b, -0.5, 0.5, 0.0, 0.5, STONE, skip="b")
    block(m, x0, x1, -0.47, 0.47, top - 0.44, top - 0.32, ("band", "plaster", "x", 0.24), shade=0.96)
    block(m, x0, x1, -0.5, 0.5, top - 0.22, top, ASHLAR, shade=0.97)


def castle_wall(kind="plain"):
    """One four-yard module of castle wall: pale ashlar on a dark plinth under a coping.
    Kinds: plain, half, pillar (a buttress each side), window (a lit, leaded arch), doorway
    (an open arch two yards wide), gated (a barred grate), broken, cracked, corner."""
    m = Model("castle_wall_" + kind)
    x0, x1 = (0.0, 2.0) if kind == "half" else (-2.0, 2.0)

    def body(a, b, z0=0.5, z1=3.78):
        block(m, a, b, -FACE, FACE, z0, z1, ASHLAR)

    if kind in ("plain", "half", "pillar", "cracked"):
        body(x0, x1)
        courses(m, [(x0, x1)], x0, x1)
    if kind == "pillar":
        block(m, -0.56, 0.56, -0.75, 0.75, 0.0, 0.62, STONE, skip="b")
        block(m, -0.46, 0.46, -0.69, 0.69, 0.62, 3.5, ASHLAR)
        block(m, -0.54, 0.54, -0.75, 0.75, 3.5, 4.0, ASHLAR, shade=0.97)
    if kind == "cracked":
        rng = random.Random(4)
        for _ in range(8):
            x, z, out = rng.uniform(-1.7, 1.1), rng.uniform(0.8, 3.0), rng.uniform(0.07, 0.19)
            side = rng.choice((-1.0, 1.0))
            ya, yb = sorted((side * (FACE - 0.05), side * (FACE + out)))
            block(m, x, x + rng.uniform(0.45, 0.8), ya, yb, z, z + 0.36, ASHLAR, shade=0.92)
        block(m, -0.3, 0.3, -0.63, 0.63, 1.7, 2.0, ASHLAR, shade=0.9)
    if kind == "window":
        body(-2.0, -0.6)
        body(0.6, 2.0)
        body(-0.6, 0.6, 0.5, 1.2)
        body(-0.6, 0.6, 2.6, 3.78)
        arch_head(m, 0.6, 2.2, 2.6)
        courses(m, [(-2.0, 2.0)], -2.0, 2.0)
        block(m, -0.74, 0.74, -0.5, 0.5, 1.08, 1.2, ASHLAR, shade=0.97)
        for y, facing in ((-0.1, (0.0, -1.0, 0.0)), (0.1, (0.0, 1.0, 0.0))):
            pane = [(-0.6, y, 1.2), (0.6, y, 1.2), (0.6, y, 2.6), (-0.6, y, 2.6)]
            m.face(pane, [uv_tile("glass", p[0] + 0.65, p[2] - 1.25) for p in pane], "glass", 1.0, facing)
        with tinted(m, IRON):
            block(m, -0.03, 0.03, -0.14, 0.14, 1.2, 2.56, ("band", "plaster", "y", 0.1))
            block(m, -0.6, 0.6, -0.14, 0.14, 2.02, 2.08, ("band", "plaster", "x", 0.1))
    if kind == "doorway":
        body(-2.0, -1.0)
        body(1.0, 2.0)
        body(-1.0, 1.0, 2.8, 3.78)
        arch_head(m, 1.0, 2.2, 2.8)
        courses(m, [(-2.0, -1.0), (1.0, 2.0)], -2.0, 2.0)
        for a, b in ((-1.2, -0.99), (0.99, 1.2)):
            block(m, a, b, -0.5, 0.5, 0.5, 2.2, STONE, shade=0.95)
        block(m, -0.17, 0.17, -0.5, 0.5, 2.74, 3.12, STONE, shade=0.97)
    if kind == "niche":
        # A blind arch: the wall steps back to a plastered panel, the palaces' indoor rhythm.
        body(-2.0, -1.0)
        body(1.0, 2.0)
        body(-1.0, 1.0, 2.8, 3.78)
        arch_head(m, 1.0, 2.2, 2.8)
        courses(m, [(-2.0, 2.0)], -2.0, 2.0)
        block(m, -1.0, 1.0, -0.2, 0.2, 0.5, 2.8, ("band", "plaster", "x", 2.3), shade=0.98)
        block(m, -1.12, 1.12, -0.5, 0.5, 0.5, 0.66, ASHLAR, shade=0.97)
    if kind == "gated":
        body(-2.0, -1.5)
        body(1.5, 2.0)
        body(-1.5, 1.5, 0.5, 1.0)
        body(-1.5, 1.5, 3.0, 3.78)
        courses(m, [(-2.0, 2.0)], -2.0, 2.0)
        with tinted(m, IRON):
            for i in range(7):
                x = -1.2 + i * 0.4
                bar(m, (x, 0.0, 1.0), (x, 0.0, 3.0), 0.045, band="plaster", sides=5, caps=False)
            for z in (1.5, 2.5):
                bar(m, (-1.5, 0.0, z), (1.5, 0.0, z), 0.04, band="plaster", sides=5, caps=False)
    if kind == "broken":
        body(-2.0, -0.7)
        courses(m, [(-2.0, 2.0)], -2.0, -0.7)
        for a, b, top in ((-0.7, 0.1, 2.5), (0.1, 0.9, 1.5), (0.9, 1.5, 2.2), (1.5, 2.0, 3.3)):
            body(a, b, 0.5, top)
        for x, y, z in ((0.3, -0.5, 1.5), (0.8, 0.2, 1.5), (-0.4, 0.1, 2.5)):
            block(m, x, x + 0.5, y, y + 0.3, z, z + 0.3, ASHLAR, shade=0.9)
    if kind == "corner":
        block(m, -2.0, 0.5, -0.5, 0.5, 0.0, 0.5, STONE, skip="b")
        block(m, -0.5, 0.5, -2.0, -0.5, 0.0, 0.5, STONE, skip="b")
        block(m, -2.0, FACE, -FACE, FACE, 0.5, 3.78, ASHLAR)
        block(m, -FACE, FACE, -2.0, -FACE, 0.5, 3.78, ASHLAR, skip="f")
        block(m, -2.0, 0.5, -0.5, 0.5, 3.78, 4.0, ASHLAR, shade=0.97)
        block(m, -0.5, 0.5, -2.0, -0.5, 3.78, 4.0, ASHLAR, shade=0.97)
    return m


def castle_parapet(kind="full"):
    """The battlement that sits on a wall's top: a low breast wall and its merlons."""
    m = Model("castle_parapet_" + kind)
    if kind == "corner":
        for xa, xb, ya, yb in ((-2.0, 0.2, -0.2, 0.2), (-0.2, 0.2, -2.0, -0.2)):
            block(m, xa, xb, ya, yb, 0.0, 0.66, ASHLAR, skip="b")
        block(m, -0.4, 0.4, -0.4, 0.4, 0.0, 1.4, ASHLAR, skip="b")
        for x in (-1.5, -0.75):
            block(m, x - 0.27, x + 0.27, -0.25, 0.25, 0.66, 1.1, ASHLAR, shade=0.97)
            block(m, -0.25, 0.25, x - 0.27, x + 0.27, 0.66, 1.1, ASHLAR, shade=0.97)
        return m
    x0, x1 = (0.0, 2.0) if kind == "half" else (-2.0, 2.0)
    block(m, x0, x1, -0.25, 0.25, 0.0, 0.1, STONE, skip="b")
    block(m, x0, x1, -0.2, 0.2, 0.1, 0.64, ASHLAR)
    for i in range(int(x1 - x0)):
        c = x0 + 0.5 + i
        block(m, c - 0.27, c + 0.27, -0.25, 0.25, 0.64, 1.1, ASHLAR, shade=0.97)
    return m


def castle_stairs(walled=False):
    """A flight of ashlar steps, rising from the front to the back; `walled` runs it between
    two cheek walls."""
    m = Model("castle_stairs")
    half, rise, steps = (1.5, 4.0, 10) if walled else (3.5, 5.1, 12)
    for i in range(steps):
        y0, y1 = -4.0 + i * 4.0 / steps, -4.0 + (i + 1) * 4.0 / steps
        block(m, -half, half, y0, y1, 0.0, rise * (i + 1) / steps, ASHLAR, shade=0.94 if i % 2 else 1.0, skip="b")
    if walled:
        for xa, xb in ((-2.5, -1.5), (1.5, 2.5)):
            block(m, xa, xb, -4.0, 0.0, 0.0, 0.5, STONE, skip="b")
            block(m, xa + 0.06, xb - 0.06, -4.0, 0.0, 0.5, 3.78, ASHLAR)
            block(m, xa, xb, -4.0, 0.0, 3.78, 4.0, ASHLAR, shade=0.97)
    return m


def castle_column():
    m = Model("castle_column")
    m.lathe(WORLD, [(0.35, 0.0), (0.35, 0.14), (0.24, 0.22), (0.22, 1.08), (0.33, 1.2), (0.35, 1.4), (0.0, 1.4)], sides=8, skin=ASHLAR, smooth=False)
    return m


def castle_pier():
    """A free-standing pier: a square shaft on a spreading base."""
    m = Model("castle_pier")
    block(m, -1.115, 1.115, -0.96, 0.75, 0.0, 0.5, STONE, skip="b")
    block(m, -0.72, 0.72, -0.72, 0.72, 0.5, 3.6, ASHLAR)
    block(m, -0.86, 0.86, -0.86, 0.75, 3.6, 4.0, ASHLAR, shade=0.97)
    return m


def castle_floor(weeds=False):
    """A square of flagged floor."""
    m = Model("castle_floor")
    half = 1.0 if weeds else 2.0
    block(m, -half, half, -half, half, -0.1, 0.05, ASHLAR, skip="b")
    if weeds:
        for x, y, s in ((-0.6, -0.5, 0.22), (0.45, 0.55, 0.3), (0.3, -0.62, 0.18)):
            block(m, x, x + s, y, y + s, 0.05, 0.2, STONE, shade=0.9)
    return m


def hall_floor(small=False):
    """A bay of a palace's indoor floor: pale flags set inside a dark stone joint, a shade
    under the walls so the room reads floor, then wall."""
    m = Model("hall_floor")
    half = 1.0 if small else 2.0
    j = 0.05
    block(m, -half + j, half - j, -half + j, half - j, -0.1, 0.04, ASHLAR, shade=0.9, skip="b")
    for a, b, c, d in ((-half, half, -half, -half + j), (-half, half, half - j, half), (-half, -half + j, -half + j, half - j), (half - j, half, -half + j, half - j)):
        block(m, a, b, c, d, -0.1, 0.05, STONE, shade=0.95, skip="b")
    return m


def hall_pier():
    """A square pier for an indoor hall, on the dungeon kit's pillar footprint."""
    m = Model("hall_pier")
    block(m, -0.75, 0.75, -0.75, 0.75, 0.0, 0.5, STONE, skip="b")
    block(m, -0.56, 0.56, -0.56, 0.56, 0.5, 3.56, ASHLAR)
    block(m, -0.7, 0.7, -0.7, 0.7, 3.56, 4.0, ASHLAR, shade=0.97)
    return m


def castle_foundation():
    """The footing block a castle's floor is raised on."""
    m = Model("castle_foundation")
    block(m, -1.1, 1.1, -1.1, 1.1, 0.0, 0.36, STONE, skip="b")
    block(m, -1.03, 1.03, -1.03, 1.03, 0.36, 1.74, STONE)
    block(m, -1.1, 1.1, -1.1, 1.1, 1.74, 2.0, ASHLAR, shade=0.97)
    return m


def castle_rubble(half=False):
    """A length of fallen wall: stumps of ashlar and the blocks that came off them."""
    m = Model("castle_rubble")
    rng = random.Random(9)
    x0, x1 = (0.0, 4.0) if half else (-4.06, 4.06)
    block(m, x0, x1, -0.5, 0.5, 0.0, 0.5, STONE, skip="b")
    x = x0
    while x < x1 - 0.2:
        w = min(rng.uniform(0.6, 1.3), x1 - x)
        block(m, x, x + w, -FACE, FACE, 0.5, rng.choice((0.9, 1.4, 2.1, 2.8, 3.5)), ASHLAR, shade=rng.uniform(0.88, 1.0))
        x += w
    block(m, x0, x0 + 0.7, -FACE, FACE, 0.5, 3.5, ASHLAR)
    for _ in range(5 if half else 9):
        x, s = rng.uniform(x0, x1 - 0.7), rng.uniform(0.35, 0.6)
        y = rng.choice((-1.0, 1.0)) * rng.uniform(0.6, 1.0)
        ya, yb = (y, y + s) if y > 0 else (y - s, y)
        block(m, x, x + s * 1.4, ya, yb, 0.0, s, ASHLAR, shade=rng.uniform(0.8, 0.95), skip="b")
    return m


def castle_rocks():
    """A heap of quarried blocks."""
    m = Model("castle_rocks")
    rng = random.Random(3)
    for x, y, z, s in ((-0.9, -0.6, 0.0, 1.0), (0.2, -0.9, 0.0, 0.8), (0.3, 0.2, 0.0, 1.1), (-1.0, 0.5, 0.0, 0.7), (-0.4, -0.2, 0.75, 0.8), (0.4, 0.5, 1.0, 0.56)):
        fr = Frame((x, y, z), (math.cos(rng.uniform(0, 1.5)), math.sin(rng.uniform(0, 1.5)), 0.0))
        m.box(fr, 0.0, s * 1.2, 0.0, s * 0.72, -s, 0.0, STONE if rng.random() < 0.5 else ASHLAR, shade=rng.uniform(0.85, 1.0), skip="b")
    return m


# -- what hangs and burns on them -------------------------------------------------------------


def hung_banner(tone=RED, kind="a"):
    """A castle banner hung flat from a gilt-ended rod: one cloth, a cloth charged with a
    shield, or three."""
    m = Model("banner_" + kind)
    half = {"a": 0.75, "shield": 1.115, "triple": 1.85}[kind]
    top = 3.1
    bar(m, (-half + 0.05, 0.0, top + 0.05), (half - 0.05, 0.0, top + 0.05), 0.045, band="oak", sides=6)
    for sx in (-1.0, 1.0):
        m.gem(Vector((sx * (half - 0.05), 0.0, top + 0.05)), 0.07)
        wood(m, sx * half * 0.6 - 0.03, sx * half * 0.6 + 0.03, 0.0, 0.22, top + 0.02, top + 0.08, "oak", shade=0.6)

    def cloth(cx, w, foot):
        notch = foot + w * 0.32
        for facing, y, lit in ((-1.0, -0.03, 1.0), (1.0, -0.018, 0.78)):
            for a, b in ((cx - w / 2, cx), (cx, cx + w / 2)):
                outer, inner = (a, b) if a < cx else (b, a)
                quad = [(outer, y, top), (inner, y, top), (inner, y, notch), (outer, y, foot)]
                with tinted(m, tone):
                    m.face(quad, [uv_band("plaster", p[0] - cx, (p[2] - foot) / (top - foot), top - foot) for p in quad], "trim", lit, (0.0, facing, 0.0))
        with tinted(m, GOLD):
            for a, b in ((cx - w / 2, cx - w / 2 + 0.07), (cx + w / 2 - 0.07, cx + w / 2)):
                block(m, a, b, -0.036, -0.03, foot + 0.02, top, ("band", "plaster", "y", 0.1), skip="fbt")
            block(m, cx - w / 2, cx + w / 2, -0.036, -0.03, top - 0.34, top - 0.26, ("band", "plaster", "x", 0.1), skip="fbt")

    if kind == "triple":
        cloth(0.0, 1.2, 0.0)
        cloth(-1.25, 1.0, 0.7)
        cloth(1.25, 1.0, 0.7)
        m.gem(Vector((0.0, -0.06, 2.0)), 0.16)
    else:
        cloth(0.0, 1.4 if kind == "shield" else 1.3, 0.0)
        if kind == "shield":
            heater(m, 0.0, -0.05, 2.1, 1.05, 1.2, NAVY if tone == RED else RED)
        else:
            m.gem(Vector((0.0, -0.06, 2.1)), 0.18)
    return m


def torch(mounted=False):
    """An iron cresset on an oak stave (the game lights its flame): standing in the ground,
    or leaning out from a wall bracket."""
    m = Model("torch")
    foot, head = (Vector((0.0, -0.06, 0.0)), Vector((0.0, -0.36, 0.7))) if mounted else (Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.74)))
    bar(m, foot, head, 0.045, band="oak", sides=6)
    cup = Frame(head, (1, 0, 0), UP, (0, 1, 0))
    with tinted(m, IRON):
        m.lathe(cup, [(0.05, -0.06), (0.13, 0.06), (0.17, 0.26)], sides=8, skin=("band", "plaster", 0.3))
        m.lathe(cup, [(0.17, 0.26), (0.14, 0.26), (0.1, 0.12), (0.0, 0.1)], sides=8, skin=("band", "plaster", 0.3), shade=0.6)
        for k in range(4):
            a = math.tau * (k + 0.5) / 4
            tip = head + Vector((math.cos(a) * 0.17, math.sin(a) * 0.17, 0.26))
            bar(m, tip, tip + Vector((0.0, 0.0, 0.13)), 0.02, band="plaster", sides=4, r1=0.006)
        m.lathe(Frame(foot.lerp(head, 0.55), (1, 0, 0), (head - foot).normalized()), [(0.06, 0.0), (0.06, 0.07)], sides=6, skin=("band", "plaster", 0.1))
        if mounted:
            block(m, -0.1, 0.1, -0.05, 0.0, 0.0, 0.34, ("band", "plaster", "y", 0.2))
            m.sweep([(0.0, -0.02, 0.26), (0.0, -0.22, 0.4)], (0.05, 0.05), "plaster", depth=0.1)
    return m


# -- the castle's furniture -------------------------------------------------------------------


def ftable(kind="long", tone=RED):
    """A hall table: long and laid, long under a cloth, or round on a turned pedestal."""
    m = Model("table_" + kind)
    if kind.startswith("round"):
        r = 0.5 if kind == "round_small" else 0.97
        turned(m, 0.0, 0.0, 0.0, [(r * 0.6, 0.0), (r * 0.6, 0.07), (0.1, 0.16), (0.1, 0.82), (r * 0.5, 0.9)], "oak", depth=0.5)
        turned(m, 0.0, 0.0, 0.0, [(r, 0.9), (r, 1.0), (0.0, 1.0)], "planks", sides=12, depth=0.6, smooth=False)
        return m
    if kind == "cloth":
        with tinted(m, LINEN):
            block(m, -1.0, 1.0, -2.0, 2.0, 0.42, 1.0, ("band", "plaster", "x", 0.6), skip="b")
        with tinted(m, tone):
            block(m, -0.34, 0.34, -2.012, 2.012, 0.41, 1.012, ("band", "plaster", "z", 0.7), skip="b")
        for x in (-0.82, 0.82):
            for y in (-1.8, 1.8):
                wood(m, x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.0, 0.44, "oak")
        return m
    wood(m, -1.03, 1.03, -2.0, 2.0, 0.86, 0.96, "planks", axis="z")
    for y in (-1.45, 1.45):
        wood(m, -0.8, 0.8, y - 0.07, y + 0.07, 0.0, 0.86, "oak", axis="y", shade=0.8)
    wood(m, -0.08, 0.08, -1.45, 1.45, 0.28, 0.42, "oak", shade=0.75)
    with tinted(m, tone):
        block(m, -0.32, 0.32, -2.012, 2.012, 0.955, 0.975, ("band", "plaster", "z", 0.64), skip="b")
    for y in (-1.1, 1.1):
        turned(m, 0.0, y, 0.975, [(0.16, 0.0), (0.05, 0.06), (0.04, 0.6), (0.11, 0.66)], "gilded", sides=7, depth=0.3)
        candle(m, 0.0, y, 1.635, 0.14)
    for y in (-1.6, -0.55, 0.55, 1.6):
        for x in (-0.66, 0.66):
            turned(m, x, y, 0.96, [(0.22, 0.04), (0.2, 0.02), (0.0, 0.015)], "gilded", sides=9, depth=0.3)
    for x, y in ((0.0, 0.0), (0.42, -1.9), (-0.42, 1.9)):
        turned(m, x, y, 0.975, [(0.1, 0.0), (0.12, 0.16), (0.0, 0.16)], "oak", sides=7, depth=0.2)
    return m


def fbench():
    m = Model("bench")
    wood(m, -0.875, 0.875, -0.375, 0.375, 0.4, 0.5, "planks")
    for x in (-0.68, 0.68):
        wood(m, x - 0.06, x + 0.06, -0.33, 0.33, 0.0, 0.4, "oak", axis="y", shade=0.8)
    wood(m, -0.68, 0.68, -0.05, 0.05, 0.14, 0.24, "oak", shade=0.75)
    return m


def fchair(tone=RED):
    """A hall chair, its back to the back of the model, a cushion on its seat."""
    m = Model("chair")
    for x in (-0.31, 0.31):
        wood(m, x - 0.06, x + 0.06, -0.375, -0.255, 0.0, 0.46, "oak")
        wood(m, x - 0.06, x + 0.06, 0.255, 0.375, 0.0, 1.23, "oak")
    wood(m, -0.375, 0.375, -0.375, 0.375, 0.44, 0.52, "planks")
    wood(m, -0.25, 0.25, 0.28, 0.35, 0.72, 1.16, "planks", axis="x")
    with tinted(m, tone):
        block(m, -0.3, 0.3, -0.32, 0.24, 0.52, 0.58, ("band", "plaster", "x", 0.4), skip="b")
    return m


def fstool(round_=False):
    m = Model("stool")
    if round_:
        turned(m, 0.0, 0.0, 0.0, [(0.3, 0.0), (0.3, 0.05), (0.12, 0.1), (0.12, 0.4), (0.375, 0.44), (0.375, 0.5), (0.0, 0.5)], "oak", depth=0.4)
        return m
    wood(m, -0.375, 0.375, -0.375, 0.375, 0.42, 0.5, "planks")
    for x in (-0.3, 0.3):
        for y in (-0.3, 0.3):
            wood(m, x - 0.05, x + 0.05, y - 0.05, y + 0.05, 0.0, 0.42, "oak")
    return m


def books(m, rng, x0, x1, y0, y1, z, tall=(0.4, 0.58)):
    """A run of books standing on a shelf."""
    x = x0
    while x < x1 - 0.12:
        if rng.random() < 0.12:
            x += rng.uniform(0.1, 0.3)
            continue
        w, h = rng.uniform(0.07, 0.15), rng.uniform(*tall)
        with tinted(m, rng.choice(BOOKS)):
            block(m, x, min(x + w, x1), y0, y1, z, z + h, ("band", "plaster", "y", 0.3), skip="b")
        x += w + 0.008


def bookcase():
    """The library's great press: four shelves of books either side of a middle post."""
    m = Model("bookcase")
    rng = random.Random(11)
    wood(m, -2.0, 2.0, 0.21, 0.29, 0.0, 3.0, "planks", axis="y", shade=0.7)
    for x in (-2.0, 1.9, -0.05):
        wood(m, x, x + 0.1, -0.26, 0.21, 0.0, 3.0, "oak", axis="y")
    for z in (0.0, 0.74, 1.46, 2.18, 2.9):
        wood(m, -2.0, 2.0, -0.26, 0.21, z, z + 0.1, "planks", axis="x")
    for z in (0.1, 0.84, 1.56, 2.28):
        books(m, rng, -1.88, -0.07, -0.2, 0.16, z)
        books(m, rng, 0.07, 1.88, -0.2, 0.16, z)
    return m


def shelf(kind="small"):
    """A wall shelf on two brackets: bare, or carrying books or candles."""
    m = Model("shelf_" + kind)
    half = 1.0 if kind == "large" else 0.5
    wood(m, -half, half, -0.5, 0.0, 0.37, 0.45, "planks", axis="x")
    for x in (-half * 0.7, half * 0.7):
        m.sweep([(x, -0.42, 0.37), (x, -0.04, 0.03)], (0.07, 0.07), "oak", depth=0.1, shade=0.8)
        wood(m, x - 0.035, x + 0.035, -0.07, 0.0, 0.0, 0.37, "oak", axis="y", shade=0.8)
    if kind == "books":
        books(m, random.Random(5), -0.44, 0.44, -0.4, -0.08, 0.45, tall=(0.34, 0.48))
    if kind == "candles":
        for x, h in ((-0.28, 0.3), (0.0, 0.42), (0.26, 0.22)):
            candle(m, x, -0.25, 0.45, h)
    return m


def keg():
    """A tun lying in its cradle, tapped at the front."""
    m = Model("keg")
    axis = Frame((0.0, -0.95, 1.12), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    staves = [(0.7, 0.0), (0.85, 0.45), (0.9, 0.95), (0.85, 1.45), (0.7, 1.9)]
    m.lathe(axis, staves, sides=12, skin=("band", "planks", 1.0))
    m.lathe(axis, [(0.0, 0.07), (0.7, 0.07)], sides=12, skin=("band", "planks", 0.7), smooth=False, shade=0.85)
    m.lathe(axis, [(0.7, 1.83), (0.0, 1.83)], sides=12, skin=("band", "planks", 0.7), smooth=False, shade=0.8)
    with tinted(m, IRON):
        for h, r in ((0.2, 0.775), (0.7, 0.885), (1.2, 0.885), (1.7, 0.775)):
            m.lathe(axis, [(r + 0.02, h - 0.05), (r + 0.02, h + 0.05)], sides=12, skin=("band", "plaster", 0.1))
    for y in (-0.45, 0.45):
        wood(m, -0.9, 0.9, y - 0.12, y + 0.12, 0.0, 0.34, "oak", axis="x", shade=0.85)
        for x in (-0.7, 0.7):
            wood(m, x - 0.14, x + 0.14, y - 0.1, y + 0.1, 0.34, 0.6, "oak", shade=0.8)
    m.gem(Vector((0.0, -0.96, 0.72)), 0.07)
    return m


def bed(kind="single", tone=RED):
    """A bedstead, its head to the back of the model: single, cot, double, the royal bed with
    its night table, a bunk with its ladder, or a bedroll on a mat."""
    m = Model("bed_" + kind)
    if kind == "roll":
        with tinted(m, (0.62, 0.52, 0.36)):
            block(m, -0.75, 0.75, -1.5, 1.5, 0.0, 0.1, ("band", "plaster", "z", 0.8), skip="b")
        with tinted(m, tone):
            block(m, -0.66, 0.66, -1.4, 0.55, 0.1, 0.24, ("band", "plaster", "z", 0.7), skip="b")
        with tinted(m, LINEN):
            bar(m, (-0.6, 1.0, 0.33), (0.6, 1.0, 0.33), 0.23, band="plaster", sides=8)
        return m
    hw = {"single": 1.0, "cot": 1.0, "double": 1.75, "royal": 0.75, "bunk": 1.0}[kind]

    def stead(z, head, foot):
        for x in (-hw + 0.08, hw - 0.08):
            wood(m, x - 0.08, x + 0.08, 1.34, 1.5, z, z + head, "oak", axis="y")
            wood(m, x - 0.08, x + 0.08, -1.5, -1.34, z, z + foot, "oak", axis="y")
            wood(m, x - 0.06, x + 0.06, -1.36, 1.36, z + 0.3, z + 0.5, "oak", shade=0.85)
        wood(m, -hw + 0.14, hw - 0.14, 1.38, 1.46, z + 0.35, z + head - 0.08, "planks", axis="x")
        wood(m, -hw + 0.14, hw - 0.14, -1.46, -1.38, z + 0.3, z + foot - 0.06, "planks", axis="x")
        with tinted(m, LINEN):
            block(m, -hw + 0.12, hw - 0.12, -1.36, 1.36, z + 0.4, z + 0.64, ("band", "plaster", "z", 0.8), skip="b")
            for cx in ((0.0,) if hw < 1.4 else (-0.8, 0.8)):
                block(m, cx - min(0.42, hw - 0.2), cx + min(0.42, hw - 0.2), 0.76, 1.28, z + 0.64, z + 0.78, ("band", "plaster", "x", 0.5), skip="b")
        with tinted(m, tone):
            block(m, -hw + 0.1, hw - 0.1, -1.38, 0.55, z + 0.5, z + 0.68, ("band", "plaster", "z", 0.9), skip="b")
        with tinted(m, GOLD):
            block(m, -hw + 0.1, hw - 0.1, 0.4, 0.55, z + 0.505, z + 0.688, ("band", "plaster", "x", 0.15), skip="b")

    if kind == "bunk":
        stead(0.0, 1.5, 1.5)
        stead(1.5, 1.5, 1.5)
        for x in (-0.3, 0.3):
            wood(m, x - 0.04, x + 0.04, -1.7, -1.62, 0.0, 2.2, "oak", axis="y")
        for z in (0.45, 0.9, 1.35, 1.8):
            wood(m, -0.3, 0.3, -1.69, -1.63, z, z + 0.06, "oak", axis="x")
    elif kind == "cot":
        stead(0.0, 1.0, 0.7)
    elif kind == "royal":
        stead(0.0, 1.62, 0.95)
        for x in (-0.67, 0.67):
            for y in (-1.42, 1.42):
                m.gem(Vector((x, y, 1.66 if y > 0 else 0.99)), 0.08)
        wood(m, 0.98, 1.86, 0.5, 1.5, 0.0, 0.7, "planks", axis="y")
        wood(m, 0.95, 1.86, 0.47, 1.5, 0.7, 0.78, "oak", axis="x")
        turned(m, 1.4, 1.0, 0.78, [(0.14, 0.0), (0.05, 0.05), (0.05, 0.16)], "gilded", sides=7, depth=0.2)
        candle(m, 1.4, 1.0, 0.94, 0.26)
    else:
        stead(0.0, 1.5, 0.9)
    return m


def bar_counter(kind="a"):
    """A length of tavern counter, its overhanging top to the front."""
    m = Model("counter_" + kind)
    wood(m, -1.0, 1.0, -0.42, 0.5, 0.0, 0.9, "planks", axis="y")
    wood(m, -1.0, 1.0, -0.47, 0.5, 0.0, 0.14, "oak", axis="x", shade=0.8)
    wood(m, -1.0, 1.0, -0.7, 0.5, 0.9, 1.0, "oak", axis="x")
    wood(m, -1.0, 1.0, -0.46, -0.42, 0.52, 0.6, "gilded", axis="x")
    if kind == "b":
        bar(m, (-1.0, -0.7, 0.2), (1.0, -0.7, 0.2), 0.04, band="gilded", sides=6)
        for x in (-0.8, 0.8):
            wood(m, x - 0.03, x + 0.03, -0.7, -0.42, 0.17, 0.23, "gilded")
    if kind == "c":
        wood(m, -1.0, 1.0, -0.81, -0.42, 0.0, 0.12, "planks", axis="x")
    return m


def backbar():
    """The shelves behind a counter: bottles above, small casks below."""
    m = Model("backbar")
    rng = random.Random(8)
    wood(m, -1.0, 1.0, 0.42, 0.5, 0.0, 2.2, "planks", axis="y", shade=0.7)
    for x in (-1.0, 0.92):
        wood(m, x, x + 0.08, 0.0, 0.5, 0.0, 2.2, "oak", axis="y")
    for z in (0.0, 0.7, 1.3, 1.9, 2.12):
        wood(m, -1.0, 1.0, 0.0, 0.5, z, z + 0.08, "oak", axis="x")
    for z in (0.78, 1.38):
        x = -0.8
        while x < 0.82:
            with tinted(m, rng.choice(((0.2, 0.42, 0.24), (0.6, 0.34, 0.12), (0.3, 0.16, 0.12), (0.2, 0.3, 0.42)))):
                turned(m, x, 0.24, z, [(0.07, 0.0), (0.07, 0.24), (0.025, 0.32), (0.025, 0.42), (0.0, 0.42)], "plaster", sides=6, depth=0.3)
            x += rng.uniform(0.16, 0.26)
    for x in (-0.55, 0.0, 0.55):
        cask = Frame((x, 0.04, 0.34), (1, 0, 0), (0, 1, 0), (0, 0, 1))
        m.lathe(cask, [(0.2, 0.0), (0.25, 0.2), (0.2, 0.4)], sides=9, skin=("band", "planks", 0.4))
        m.lathe(cask, [(0.0, 0.02), (0.2, 0.02)], sides=9, skin=("band", "planks", 0.3), smooth=False, shade=0.8)
    return m


def candles():
    """Three candles on a gilt dish."""
    m = Model("candles")
    turned(m, 0.08, 0.0, 0.0, [(0.24, 0.05), (0.2, 0.02), (0.0, 0.03)], "gilded", sides=9, depth=0.3)
    turned(m, 0.08, 0.0, 0.0, [(0.12, 0.0), (0.24, 0.05)], "gilded", sides=9, depth=0.3)
    for x, y, h in ((-0.05, 0.02, 0.5), (0.14, -0.06, 0.66), (0.2, 0.09, 0.4)):
        candle(m, x, y, 0.03, h, r=0.05)
    return m


def crates(kind="large"):
    m = Model("crates_" + kind)
    if kind == "stacked":
        m.crate(-0.52, -0.05, 0.0, size=1.0, turn=8.0)
        m.crate(0.52, 0.1, 0.0, size=0.95, turn=-6.0)
        m.crate(0.05, 0.0, 1.0, size=0.9, turn=20.0)
    else:
        m.crate(0.0, 0.0, 0.0, size=1.0)
    return m


def trophy():
    """A wall trophy: a shield over two crossed swords."""
    m = Model("trophy")
    for s in (-1.0, 1.0):
        with tinted(m, (0.78, 0.8, 0.84)):
            m.sweep([(s * -0.86, -0.07, -0.62), (s * 1.0, -0.07, 0.8)], (0.15, 0.04), "plaster", depth=0.16)
        m.sweep([(s * -1.08, -0.07, -0.8), (s * -0.86, -0.07, -0.62)], (0.06, 0.06), "oak", depth=0.1)
        m.sweep([(s * -0.98, -0.07, -0.5), (s * -0.74, -0.07, -0.74)], (0.05, 0.05), "gilded", depth=0.1)
        m.gem(Vector((s * -1.1, -0.07, -0.81)), 0.06)
    heater(m, 0.0, -0.14, 0.0, 1.0, 1.25, NAVY)
    return m


def shrine():
    """A small stone altar under a gilt sun, candles burning on it."""
    m = Model("shrine")
    block(m, -0.55, 0.55, -0.55, 0.55, 0.0, 0.18, STONE, skip="b")
    block(m, -0.42, 0.42, -0.42, 0.42, 0.18, 0.8, ASHLAR)
    block(m, -0.5, 0.5, -0.5, 0.5, 0.8, 0.92, ASHLAR, shade=0.97)
    block(m, -0.3, 0.3, 0.24, 0.44, 0.92, 1.6, ASHLAR)
    m.gem(Vector((0.0, 0.2, 1.3)), 0.17)
    m.gem(Vector((0.0, 0.34, 1.7)), 0.09)
    for x, y, h in ((-0.34, -0.2, 0.3), (0.34, -0.16, 0.42), (-0.12, -0.3, 0.22), (0.14, -0.28, 0.34)):
        candle(m, x, y, 0.92, h)
    return m


# -- the settlements' last works --------------------------------------------------------------


def catapult(m, z):
    """A catapult on a tower's deck, its arm thrown back."""
    for sx in (-0.9, 0.9):
        wood(m, sx - 0.14, sx + 0.14, -1.9, 1.9, z, z + 0.28, "oak")
        wood(m, sx - 0.12, sx + 0.12, -0.2, 0.2, z + 0.28, z + 2.3, "oak", shade=0.9)
        m.sweep([(sx, -1.6, z + 0.28), (sx, -0.1, z + 2.0)], (0.16, 0.16), "oak", depth=0.2, shade=0.8)
    bar(m, (-1.05, 0.0, z + 2.2), (1.05, 0.0, z + 2.2), 0.11, band="oak", sides=6)
    m.sweep([(0.0, -1.5, z + 0.9), (0.0, 0.0, z + 2.3), (0.0, 4.4, z + 4.3)], [(0.22, 0.22), (0.2, 0.2), (0.14, 0.14)], "planks", depth=0.3)
    with tinted(m, IRON):
        block(m, -0.45, 0.45, -1.9, -1.1, z + 0.35, z + 1.15, ("band", "plaster", "x", 0.5))
    m.lathe(Frame((0.0, 4.4, z + 4.2), (1, 0, 0), UP, (0, 1, 0)), [(0.1, 0.0), (0.42, 0.12), (0.5, 0.4)], sides=8, skin=("band", "planks", 0.4))


def gun(m, z):
    """A gun on its truck carriage on a tower's deck, laid to the front."""
    wood(m, -0.5, 0.5, -1.3, 1.1, z, z + 0.55, "oak", axis="z")
    for sx in (-0.62, 0.62):
        for y in (-0.8, 0.6):
            hub = Frame((sx, y, z + 0.45), (0, 1, 0), (1, 0, 0), (0, 0, 1))
            m.lathe(hub, [(0.45, -0.09), (0.45, 0.09)], sides=10, skin=("band", "oak", 0.18))
            m.lathe(hub, [(0.45, 0.09), (0.0, 0.09)], sides=10, skin=("band", "planks", 0.45), smooth=False, shade=0.8)
            m.lathe(hub, [(0.0, -0.09), (0.45, -0.09)], sides=10, skin=("band", "planks", 0.45), smooth=False, shade=0.8)
    with tinted(m, IRON):
        bar(m, (0.0, 1.2, z + 1.0), (0.0, -2.9, z + 1.25), 0.4, band="plaster", sides=10, r1=0.28)
        bar(m, (0.0, -2.9, z + 1.25), (0.0, -3.2, z + 1.27), 0.34, band="plaster", sides=10, r1=0.36)
    m.gem(Vector((0.0, 1.35, z + 0.99)), 0.16)


def drum_tower(top="roof", flare=0.0, engine=None):
    """One drum of a round tower in the castle's pale stone, made to stack: lit slits, a
    corbelled head, and either battlements (to carry the next drum, a catapult or a gun) or
    the leaning witch-hat that finishes the tower."""
    m = Model("tower_" + top + ("_" + engine if engine else ""))
    r, h = 3.1, 9.2
    head = r + flare
    flat = math.cos(math.pi / 12)
    m.lathe(WORLD, [(r + 0.34, 0.0), (r + 0.34, 0.8), (r + 0.05, 1.05)], sides=12, skin=STONE, smooth=False, shade=0.9)
    m.lathe(WORLD, [(r, 1.05), (head, h)], sides=12, skin=ASHLAR, smooth=False, v0=1.05)
    for k in range(3):
        a = math.tau * (k + 0.25) / 3
        for z in (3.2, 6.2) if k == 2 else (4.7,):
            at = (r + flare * (z - 1.05) / (h - 1.05)) * flat + 0.01
            slit = Frame((math.cos(a) * at, math.sin(a) * at, z), (-math.sin(a), math.cos(a), 0.0))
            m.box(slit, -0.28, 0.28, 0.0, 1.5, 0.0, 0.06, ("tile", "glass"), skip="k")
            m.box(slit, -0.42, 0.42, -0.16, 0.0, 0.0, 0.14, ASHLAR, shade=0.95)
    m.lathe(WORLD, [(head + 0.07, h - 1.25), (head + 0.07, h - 0.95)], sides=12, skin=("band", "plaster", 0.3), smooth=False)
    m.lathe(WORLD, [(head, h), (head + 0.5, h + 0.3), (head + 0.5, h + 0.75), (0.0, h + 0.75)], sides=12, skin=ASHLAR, smooth=False, shade=0.96)
    deck = h + 0.75
    if top == "roof":
        lean = [(0.0, 0.0), (0.0, 0.0), (0.16, 0.06), (0.46, 0.16), (0.86, 0.3)]
        m.lathe(WORLD, [(head + 1.35, deck - 0.2), (head + 0.3, deck + 1.1), (head * 0.5, deck + 4.4), (head * 0.18, deck + 7.0), (0.04, deck + 9.0)], sides=12, skin=("tile", "slate"), lean=lean)
        m.lathe(WORLD, [(head + 1.38, deck - 0.32), (head + 1.38, deck - 0.06)], sides=12, skin=("band", "gilded", 0.26), smooth=False)
        m.gem(Vector((0.86, 0.3, deck + 9.3)), 0.26, stretch=1.8)
    else:
        for k in range(8):
            a = math.tau * (k + 0.5) / 8
            fr = Frame((math.cos(a) * (head + 0.5), math.sin(a) * (head + 0.5), deck), (-math.sin(a), math.cos(a), 0.0))
            m.box(fr, -0.62, 0.62, 0.0, 1.2, -0.62, 0.0, ASHLAR)
        if engine == "catapult":
            catapult(m, deck)
        elif engine == "cannon":
            gun(m, deck)
    return m


def curtain():
    """A length of town wall: pale ashlar on a dark footing, a walk along its top behind
    merlons, a pier at each end and lit loops to the field."""
    m = Model("curtain")
    block(m, -7.0, 7.0, -2.4, 2.4, 0.0, 0.9, STONE, skip="b")
    block(m, -7.0, 7.0, -1.9, 1.9, 0.9, 6.0, ASHLAR)
    block(m, -7.0, 7.0, -2.0, 2.0, 5.2, 5.45, ("band", "plaster", "x", 0.3))
    block(m, -7.0, 7.0, -2.15, 2.15, 6.0, 6.3, ASHLAR, shade=0.96)
    block(m, -7.0, 7.0, -2.15, -1.55, 6.3, 6.9, ASHLAR, shade=0.95)
    block(m, -7.0, 7.0, 1.7, 2.15, 6.3, 6.85, ASHLAR, shade=0.95)
    for i in range(6):
        x = -6.6 + i * 2.4
        block(m, x, x + 1.3, -2.15, -1.45, 6.9, 7.7, ASHLAR)
    for x in (-7.0, 6.2):
        block(m, x, x + 0.8, -2.8, 2.8, 0.0, 4.4, ASHLAR, skip="b")
        block(m, x, x + 0.8, -2.5, 2.5, 4.4, 5.0, ASHLAR, shade=0.95)
    for x in (-3.6, 0.0, 3.6):
        block(m, x - 0.22, x + 0.22, -1.96, -1.9, 2.5, 4.0, ("tile", "glass"), skip="f")
        block(m, x - 0.36, x + 0.36, -2.02, -1.9, 2.34, 2.5, ASHLAR, shade=0.95)
    return m


def turret(m, x, y, r, base, top, hat=4.4):
    """A slim round turret under a witch-hat, for the corners of a keep."""
    fr = Frame((x, y, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(fr, [(r + 0.25, base), (r + 0.25, base + 0.9), (r, base + 1.2), (r, top)], sides=10, skin=ASHLAR, smooth=False)
    m.lathe(fr, [(r, top), (r + 0.3, top + 0.25), (r + 0.3, top + 0.55), (0.0, top + 0.55)], sides=10, skin=ASHLAR, smooth=False, shade=0.96)
    m.lathe(fr, [(r + 0.72, top + 0.4), (r + 0.12, top + 1.2), (r * 0.45, top + hat * 0.62), (0.04, top + hat)], sides=10, skin=("tile", "slate"))
    m.lathe(fr, [(r + 0.75, top + 0.3), (r + 0.75, top + 0.5)], sides=10, skin=("band", "gilded", 0.2), smooth=False)
    m.gem(Vector((x, y, top + hat + 0.25)), 0.2, stretch=1.8)


def loop(m, fr, tall=1.5, sill=ASHLAR):
    """An arrow loop cut in a wall, the frame's origin at its foot: a dark cross slit (the
    upright for a bow, the short bar to traverse it) over a dressed sill (`sill` is its
    stone: the castle's pale ashlar, or a rubble house's own)."""
    dark = ("tile", "stone")
    m.box(fr, -0.07, 0.07, 0.0, tall, 0.0, 0.02, dark, skip="k", shade=0.2)
    m.box(fr, -0.26, 0.26, tall * 0.6, tall * 0.6 + 0.14, 0.0, 0.02, dark, skip="k", shade=0.2)
    m.box(fr, -0.3, 0.3, -0.16, 0.0, 0.0, 0.12, sill, skip="k", shade=0.95)


def keep():
    """The castle's keep: a battlemented ward with a turret at each corner and a gatehouse
    to the front, and the great tower rising out of it under a steep slate spire."""
    m = Model("keep")
    wx, wy, wall = 5.2, 6.2, 11.5
    block(m, -wx - 0.35, wx + 0.35, -wy - 0.35, wy + 0.35, 0.0, 1.3, STONE, skip="b")
    block(m, -wx, wx, -wy, wy, 1.3, wall, ASHLAR)
    block(m, -wx - 0.1, wx + 0.1, -wy - 0.1, wy + 0.1, wall - 2.2, wall - 1.85, ("band", "plaster", "x", 0.4))
    block(m, -wx - 0.3, wx + 0.3, -wy - 0.3, wy + 0.3, wall, wall + 0.5, ASHLAR, shade=0.96)
    for i in range(5):
        x = -wx + 1.7 + i * (2 * wx - 3.4 - 1.2) / 4
        for y0 in (-wy - 0.3, wy - 0.4):
            block(m, x, x + 1.2, y0, y0 + 0.7, wall + 0.5, wall + 1.8, ASHLAR)
    for i in range(6):
        y = -wy + 1.7 + i * (2 * wy - 3.4 - 1.2) / 5
        for x0 in (-wx - 0.3, wx - 0.4):
            block(m, x0, x0 + 0.7, y, y + 1.2, wall + 0.5, wall + 1.8, ASHLAR)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            turret(m, sx * wx, sy * wy, 1.5, 0.0, 14.0)
    # the gatehouse and its gate
    gy = -wy - 1.2
    for xa, xb in ((-2.9, -1.95), (1.95, 2.9)):
        block(m, xa, xb, gy - 0.3, -wy, 0.0, 1.3, STONE, skip="b")
    block(m, -2.6, 2.6, gy, -wy, 1.3, 13.4, ASHLAR)
    block(m, -2.8, 2.8, gy - 0.2, -wy, 13.4, 13.9, ASHLAR, shade=0.96)
    for x in (-2.8, -0.6, 1.6):
        block(m, x, x + 1.2, gy - 0.2, gy + 0.5, 13.9, 15.1, ASHLAR)
    wood(m, -1.5, 1.5, gy - 0.07, gy, 0.0, 4.2, "planks", axis="y")
    block(m, -1.95, -1.5, gy - 0.14, gy, 0.0, 4.2, STONE, shade=0.95)
    block(m, 1.5, 1.95, gy - 0.14, gy, 0.0, 4.2, STONE, shade=0.95)
    block(m, -1.95, 1.95, gy - 0.14, gy, 4.2, 4.95, STONE, shade=0.97)
    with tinted(m, IRON):
        for z in (1.1, 3.0):
            block(m, -1.5, 1.5, gy - 0.1, gy - 0.07, z, z + 0.2, ("band", "plaster", "x", 0.2), skip="f")
        block(m, -0.04, 0.04, gy - 0.1, gy - 0.07, 0.0, 4.2, ("band", "plaster", "y", 0.1), skip="f")
    m.gem(Vector((0.0, gy - 0.2, 4.6)), 0.26)
    m.banner(Frame((0.0, gy - 0.02, 11.4), (1, 0, 0)), width=2.6, flat=True)
    # The ward's flanks and back: a lit window in every bay over a lit loop, a banner hung
    # from the battlements between the windows, and a corbel table under the parapet. (A
    # flank with its three windows alone was eleven yards of bare ashlar from the bailey
    # beside it, and looked worse there than the release's keep.)
    for y in (-2.6, 0.0, 2.6):
        m.arch_window(Frame((wx, y, 5.6), (0, 1, 0)), width=1.7)
        m.arch_window(Frame((-wx, y, 5.6), (0, -1, 0)), width=1.7)
        for sx in (-1.0, 1.0):
            loop(m, Frame((sx * wx, y, 2.5), (0, sx, 0)))
    for y in (-1.3, 1.3):
        for sx in (-1.0, 1.0):
            fr = Frame((sx * wx, y, 0.0), (0, sx, 0))
            # a flat buttress between the windows, the banner hung on its head
            m.box(fr, -0.38, 0.38, 1.3, 9.3, 0.0, 0.3, ASHLAR, skip="k", shade=0.93)
            m.box(fr, -0.44, 0.44, 9.3, 9.65, 0.0, 0.36, ("band", "plaster", "x", 0.4), skip="k")
            m.banner(fr.at(0.0, 10.9, 0.0), width=1.5, flat=True)
    for x in (-2.2, 2.2):
        m.arch_window(Frame((x, wy, 5.6), (-1, 0, 0)), width=1.7)
        loop(m, Frame((x, wy, 2.5), (-1, 0, 0)))
    m.banner(Frame((0.0, wy, 10.9), (-1, 0, 0)), width=1.5, flat=True)
    for i in range(10):
        y = -wy + 2.0 + i * (2 * wy - 4.0 - 0.4) / 9
        for sx in (-1.0, 1.0):
            block(m, min(sx * wx, sx * (wx + 0.28)), max(sx * wx, sx * (wx + 0.28)), y, y + 0.4, wall - 0.4, wall, ASHLAR, shade=0.88)
    for i in range(8):
        x = -wx + 2.0 + i * (2 * wx - 4.0 - 0.4) / 7
        block(m, x, x + 0.4, wy, wy + 0.28, wall - 0.4, wall, ASHLAR, shade=0.88)
    # the great tower
    tx, t0, t1, top = 3.3, -2.0, 4.6, 23.5
    cy = (t0 + t1) / 2
    block(m, -tx, tx, t0, t1, wall, top, ASHLAR)
    block(m, -tx - 0.1, tx + 0.1, t0 - 0.1, t1 + 0.1, 17.3, 17.65, ("band", "plaster", "x", 0.4))
    block(m, -tx - 0.35, tx + 0.35, t0 - 0.35, t1 + 0.35, top, top + 0.6, ASHLAR, shade=0.96)
    spire = Frame((0.0, cy, 0.0), (1, 0, 0), UP, (0, 1, 0))
    eave = (tx + 0.95) * math.sqrt(2.0)
    m.lathe(spire, [(eave, top + 0.4), (eave * 0.66, top + 2.1), (eave * 0.32, top + 4.4), (eave * 0.1, top + 5.7), (0.04, top + 6.5)], sides=4, skin=("tile", "slate"), smooth=False)
    m.lathe(spire, [(eave + 0.04, top + 0.28), (eave + 0.04, top + 0.5)], sides=4, skin=("band", "gilded", 0.22), smooth=False)
    m.gem(Vector((0.0, cy, top + 6.8)), 0.3, stretch=1.8)
    for x in (-1.6, 1.6):
        m.arch_window(Frame((x, t0, 13.4), (1, 0, 0)), width=1.5)
    m.arch_window(Frame((0.0, t0, 18.6), (1, 0, 0)), width=2.2)
    for z, width in ((13.4, 1.5), (18.6, 1.9)):
        m.arch_window(Frame((tx, cy, z), (0, 1, 0)), width=width)
        m.arch_window(Frame((-tx, cy, z), (0, -1, 0)), width=width)
    m.arch_window(Frame((0.0, t1, 18.6), (-1, 0, 0)), width=1.9)
    return m


# The game stands a prop with its LOWEST point on the ground at its middle (render/props.ts
# re-bases every model to min-y 0), so whatever a free-standing building carries below its
# floor line lifts the whole building by that much: a town lot's yard-deep footing put a door
# a yard up a stone block on Dawnhold's flat parade ground. These buildings keep a quarter of
# a yard: enough to meet the turf where the ground rolls, a doorstep where it is flat.
STANDING_FOOTING = 0.25


class standing_footing:
    """Every stone foot built inside runs STANDING_FOOTING below the building's floor line."""

    def __enter__(self):
        import kit

        self.before = kit.FOOTING
        kit.FOOTING = STANDING_FOOTING

    def __exit__(self, *_):
        import kit

        kit.FOOTING = self.before


def guardhouse():
    """The garrison's guardhouse, built at the size it stands in the game: a squat hall of
    rubble stone behind arrow loops and a studded door, a timbered gable leaning out over it
    under one steep slate roof, and a round watch turret on its front corner under a
    witch-hat. A shield hangs by the door, the watch's spears lean in their rack and its
    lantern burns over them. (The same hall in the castle's pale ashlar looked no better on
    Dawnhold's parade ground, so it keeps the houses' stone.)"""
    import lots

    m = Model("guardhouse")
    x0, x1, y0, y1, wall = -4.0, 4.0, -3.6, 3.8, 4.3
    w, d = x1 - x0, y1 - y0
    with standing_footing():
        m.stone_base(x0, x1, y0, y1, wall)
        # the door stands a walker and a half high: the game's own figures are tall
        m.door(m.base_frame("front", 4.85), width=3.5)
        # the watch turret on the front corner, its hat leaning out over the yard
        lots.turret(m, x0 + 0.2, y0 + 0.2, 1.0, 7.0, windows=((-90.0, 5.0),), lean=(-0.3, -0.2))
    for degrees, height in ((-90.0, 1.5), (-135.0, 2.7), (180.0, 1.5)):
        loop(m, m.drum_frame(degrees, height), tall=1.3, sill=STONE)
    m.banner(m.drum_frame(-135.0, 6.2), width=1.05)
    # the front: a shield by the door, the lantern, the spear rack under it
    at = m.base_frame("front", 2.4, 2.5).p(0.0, 0.0, 0.03)
    heater(m, at.x, at.y, at.z, 0.86, 1.08, RED)
    m.lantern(m.base_frame("front", 7.25, 3.6), reach=0.75)
    rail = m.base_frame("front", 6.85, 1.75)
    m.box(rail, 0.0, 1.02, 0.0, 0.1, 0.0, 0.16, ("band", "oak", "x", 0.2), skip="k", shade=0.8)
    for i, along in enumerate((6.98, 7.26, 7.54, 7.8)):
        foot = m.base_frame("front", along, 0.0).p(0.0, 0.0, 0.62)
        head = m.base_frame("front", along + 0.03, 2.95).p(0.0, 0.0, 0.12)
        bar(m, (foot.x, foot.y, 0.0), head, 0.034, band="oak", sides=5)
        with tinted(m, (0.62, 0.64, 0.68)):
            m.gem(head + Vector((0.0, 0.0, 0.13)), 0.05 if i % 2 else 0.07, band="plaster", stretch=2.6)
    # the flanks and the back: loops in the stone, one lit window to the rear
    for along in (d * 0.3, d * 0.62):
        loop(m, m.base_frame("left", along, 1.5), tall=1.5, sill=STONE)
    loop(m, m.base_frame("right", d * 0.26, 1.5), tall=1.5, sill=STONE)
    m.arch_window(m.base_frame("right", d * 0.82, 1.4), width=1.5)
    m.arch_window(m.base_frame("back", w * 0.5, 1.4), width=1.6)
    m.ivy(m.base_frame("back", w * 0.82, 0.5), width=2.2)
    # the roof, its gable a timbered prow over the door: a tie beam under it, a lit window
    # and the garrison's shield in it
    surface = m.swept_roof(x0, x1, y0, y1, wall, rise=4.7, ridge="y", eave_out=0.9, gable_out=0.45, prow=(1.15, 0.55), sweep=0.6, horn=(0.9, 0.6))
    m.box(Frame((x0 - 0.1, y0, wall - 0.3), (1, 0, 0)), 0.0, w + 0.2, 0.0, 0.34, -0.2, 0.12, ("band", "oak", "x", 0.34), shade=0.9)
    m.box(Frame((x1 + 0.1, y1, wall - 0.3), (-1, 0, 0)), 0.0, w + 0.2, 0.0, 0.34, -0.2, 0.12, ("band", "oak", "x", 0.34), shade=0.9)
    gable = Frame((0.0, y0, wall), (1, 0, 0))
    m.arch_window(gable.at(0.0, 0.55, 0.0), width=1.5)
    heater(m, 0.0, y0 - 0.03, wall + 3.15, 0.9, 1.1, RED)
    m.dormer(surface, 0.0, (y0 + y1) / 2, "y", along=0.5, out=2.6, side=1.0, width=2.0)
    with standing_footing():
        m.chimney(x1 + 0.3, 0.2, 1.05, 1.5, -STANDING_FOOTING, 9.5, lean=(-0.1, 0.08), pots=2)
    m.barrel(x1 - 0.55, y0 - 0.75, size=1.0)
    m.barrel(x1 + 0.3, y0 - 0.45, size=0.85, turn=0.6)
    m.crate(x0 + 2.2, y0 - 0.7, size=0.85, turn=0.25)
    return m


def smith_anvil(m, x, y, z=0.0, size=1.0):
    """A smith's anvil on its oak block, standing at (x, y, z), its horn to the right."""
    k = size
    fr = Frame((x, y, z), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, -0.36 * k, 0.36 * k, 0.0, 0.5 * k, -0.27 * k, 0.27 * k, ("band", "oak", "y", 0.5), skip="b", shade=0.8)
    with tinted(m, IRON):
        top = fr.at(0.0, 0.5 * k, 0.0)
        m.box(top, -0.24 * k, 0.24 * k, 0.0, 0.11 * k, -0.17 * k, 0.17 * k, ("band", "plaster", "x", 0.4), skip="b")
        m.box(top, -0.14 * k, 0.14 * k, 0.11 * k, 0.27 * k, -0.11 * k, 0.11 * k, ("band", "plaster", "x", 0.4), skip="b")
        m.box(top, -0.37 * k, 0.39 * k, 0.27 * k, 0.4 * k, -0.2 * k, 0.2 * k, ("band", "plaster", "x", 0.4))
        bar(m, (x + 0.39 * k, y, z + 0.835 * k), (x + 0.66 * k, y, z + 0.86 * k), 0.11 * k, band="plaster", sides=7, r1=0.02 * k)


def open_forge(stone="stone"):
    """The smithy, built at the size it stands in the game: three walls of stone under one
    broad tiled roof, eaves to the yard, its whole front open under an oak beam so the work
    shows from the road: the hearth burning in the back wall under its stack, the anvil on
    its block, the quench trough, bar iron in the corner and a heap of coal. `stone` is its
    walls: the houses' dark rubble ("stone"), or pale dressed ashlar ("ashlar")."""
    m = Model("open_forge")
    # (the walls stand a walker and a half high: the game's own figures are tall, and a beam
    # at a kit door's height came to their brow)
    # Its plan is cut to the old model's bounds: Wyrmwatch's smithy collides as a fixed box of
    # that size (sim/hex_building_dims.ts), and a smaller forge left an unseen margin round it.
    x0, x1, y0, y1, wall, thick, floor = -3.2, 3.2, -3.25, 3.4, 3.25, 0.46, 0.08
    skin = ASHLAR if stone == "ashlar" else STONE
    # the three walls, each on a dark plinth course, and the flagged floor running out in front
    for xa, xb, ya, yb in ((x0, x1, y1 - thick, y1), (x0, x0 + thick, y0, y1 - thick), (x1 - thick, x1, y0, y1 - thick)):
        block(m, xa, xb, ya, yb, -STANDING_FOOTING, wall, skin, skip="b")
        block(m, xa - 0.1, xb + 0.1, ya - 0.1, yb + 0.1, -STANDING_FOOTING, 0.55, STONE, skip="b", shade=0.9)
    block(m, x0 + thick, x1 - thick, y0 - 0.55, y1 - thick, -STANDING_FOOTING, floor, STONE, skip="b", shade=0.96)
    # the open front: an oak beam on the wall heads and one post, braced both ways
    m.sweep([(x0 - 0.15, y0 + 0.24, wall - 0.2), (x1 + 0.15, y0 + 0.24, wall - 0.2)], (0.4, 0.42), "oak", depth=0.5)
    m.stud_row((x0 + 0.3, y0 + 0.02, wall - 0.2), (x1 - 0.3, y0 + 0.02, wall - 0.2), 9)
    post = 0.95
    m.sweep([(post, y0 + 0.24, -STANDING_FOOTING), (post, y0 + 0.24, wall - 0.4)], (0.34, 0.34), "oak", depth=0.5, caps=False)
    for sx in (-1.0, 1.0):
        m.sweep([(post + sx * 0.08, y0 + 0.24, wall - 1.35), (post + sx * 0.95, y0 + 0.24, wall - 0.42)], (0.16, 0.18), "oak", depth=0.3, caps=False, shade=0.85)
    # a counter wall across the left of the opening, its board top set with the day's work
    block(m, x0 + thick, post - 1.25, y0, y0 + 0.4, floor, 1.0, skin, skip="b", shade=0.95)
    wood(m, x0 + thick - 0.02, post - 1.18, y0 - 0.12, y0 + 0.5, 1.0, 1.1, "planks")
    with tinted(m, IRON):
        for i, bx in enumerate((x0 + thick + 0.3, x0 + thick + 0.62, x0 + thick + 0.9)):
            bar(m, (bx, y0 - 0.04, 1.14), (bx + 0.05, y0 + 0.44, 1.14), 0.03 + 0.008 * (i % 2), band="plaster", sides=5)
    m.swept_roof(x0, x1, y0, y1, wall, rise=2.25, ridge="x", eave_out=0.95, eave_drop=0.3, gable_out=0.35, prow=0.65, sweep=0.3, horn=0.5, board=0.42)
    for sx, run in ((x0, (0, -1, 0)), (x1, (0, 1, 0))):
        m.relief(Frame((sx, 0.05, wall + 0.42), run), "wheel", 0.95, 0.1, anchor=(0.5, 0.0))
    # the hearth in the back wall, its stack out through the slates behind the ridge
    hx = -0.95
    m.hearth(Frame((hx, y1 - thick, floor), (1, 0, 0)), width=2.3, height=2.9, depth=0.8)
    m.chimney(hx, y1 - 0.42, 1.4, 1.05, wall - 0.4, 5.6, lean=(0.05, -0.05), pots=2, mat="ashlar" if stone == "ashlar" else "stone")
    m.hung_lamp(x1 - thick - 0.55, y0 + 0.24, wall - 0.42, 0.9)
    # the work
    smith_anvil(m, 0.1, -1.05, floor, size=1.15)
    tw, td, th = 1.5, 0.66, 0.62
    tr = Frame((x1 - thick - 0.12, -0.9, floor), (0, 1, 0), UP, (-1, 0, 0))
    m.box(tr, 0.0, tw, 0.0, 0.08, 0.0, td, ("band", "planks", "x", 0.4))
    for a0, a1, b0, b1 in ((0.0, tw, 0.0, 0.08), (0.0, tw, td - 0.08, td), (0.0, 0.08, 0.0, td), (tw - 0.08, tw, 0.0, td)):
        m.box(tr, a0, a1, 0.0, th, b0, b1, ("band", "planks", "x" if a1 - a0 > b1 - b0 else "z", th), shade=0.9)
    with tinted(m, (0.1, 0.3, 0.36)):
        m.box(tr, 0.08, tw - 0.08, th - 0.16, th - 0.12, 0.08, td - 0.08, ("band", "plaster", "x", 0.6), skip="b")
    heap = Frame((1.45, y1 - thick - 0.75, floor), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(heap, [(0.66, 0.0), (0.46, 0.24), (0.2, 0.42), (0.0, 0.48)], sides=7, skin=("tile", "stone"), smooth=False, shade=0.22)
    with tinted(m, IRON):
        for i, bx in enumerate((0.42, 0.56, 0.72)):
            bar(m, (bx, y1 - thick - 0.5 + i * 0.05, floor), (bx - 0.1, y1 - thick - 0.06, 2.1 - i * 0.2), 0.032, band="plaster", sides=5)
    m.barrel(x1 - 0.2, y0 - 0.8, size=0.95)
    m.barrel(x1 - 1.1, y0 - 0.9, size=0.8, turn=0.5)
    m.crate(x0 + 0.1, y0 - 0.78, size=0.8, turn=0.25)
    return m


class shifted:
    """Everything built inside is moved by `by`: for a helper that only builds at the model's
    origin (a hull), stood somewhere else in a bigger model."""

    def __init__(self, m, by):
        self.m, self.by = m, Vector(by)

    def __enter__(self):
        face, by = self.m.face, self.by
        self.m.face = lambda points, *args, **kwargs: face([Vector(p) + by for p in points], *args, **kwargs)

    def __exit__(self, *_):
        del self.m.face


# How big the hamlet buildings stand. The game draws a hex building at about 7.5 times its
# file's size (7 for a stable), and a figure in it is 2.6 yards tall, so these scales set a
# cottage door at about 4.4 yards and a stable's eave at about 4.4: a building a person can
# walk up to, not a model of one. Each still stands inside the circle its record collides as
# (4.5 yards for a croft, 5 for the tall one, 5.5 for a stable), so nothing solid changes.
CROFT_FIT = ("stretch", 1.6 / 7.5)
TALL_CROFT_FIT = ("stretch", 1.5 / 7.5)
STABLE_FIT = ("stretch", 1.05 / 7.0)


def croft():
    """A crofter's one-room cottage (drawn at CROFT_FIT, so its door stands well over a
    walker): rubble walls, a plank door under a lantern, a lit window in each flank and one
    in the timbered gable, a steep slate roof and a stack up one side."""
    m = Model("croft")
    x0, x1, y0, y1, wall = -1.95, 1.95, -1.9, 1.95, 2.95
    w, d = x1 - x0, y1 - y0
    with standing_footing():
        m.stone_base(x0, x1, y0, y1, wall, batter=0.1, plinth=0.4, flare=0.14)
        # (the door is as tall as the wall lets it be: the game's own figures are tall)
        m.door(m.base_frame("front", w / 2), width=2.6, steps=1)
        m.chimney(x1 + 0.2, 0.55, 0.75, 1.0, -STANDING_FOOTING, 5.55, lean=(-0.06, 0.05), pots=2)
    m.lantern(m.base_frame("front", w - 0.26, 2.35), reach=0.5, size=0.8)
    m.arch_window(m.base_frame("left", d / 2, 0.95), width=1.15)
    m.arch_window(m.base_frame("right", d * 0.28, 0.95), width=1.15)
    m.arch_window(m.base_frame("back", w / 2, 0.95), width=1.15, keystone=False)
    m.ivy(m.base_frame("left", d * 0.82, 0.35), width=1.5)
    m.swept_roof(x0, x1, y0, y1, wall, rise=3.1, ridge="y", eave_out=0.7, eave_drop=0.35, gable_out=0.35, prow=(0.6, 0.3), sweep=0.4, horn=(0.5, 0.35), board=0.4)
    m.box(Frame((x0 - 0.08, y0, wall - 0.26), (1, 0, 0)), 0.0, w + 0.16, 0.0, 0.3, -0.14, 0.1, ("band", "oak", "x", 0.3), shade=0.9)
    m.box(Frame((x1 + 0.08, y1, wall - 0.26), (-1, 0, 0)), 0.0, w + 0.16, 0.0, 0.3, -0.14, 0.1, ("band", "oak", "x", 0.3), shade=0.9)
    m.arch_window(Frame((0.0, y0, wall + 0.42), (1, 0, 0)), width=1.05)
    m.barrel(x0 + 0.1, y0 - 0.55, size=0.8)
    m.crate(x1 - 0.2, y0 - 0.5, size=0.6, turn=0.3)
    return m


def tall_croft():
    """A two-storey cottage on a narrow plot (drawn at TALL_CROFT_FIT): a stone
    ground floor, a timber storey jettied out over the door on carved brackets, shuttered
    casements with flower boxes, a prow gable and a stack at the back."""
    import houses

    m = Model("tall_croft")
    x0, x1, y0, y1, ground = -2.2, 2.2, -2.35, 2.5, 2.95
    w, d = x1 - x0, y1 - y0
    with standing_footing():
        floors, eave = houses.shell(m, x0, x1, y0, y1, ground=ground, jetty=(0.4, 0.22, 0.08))
        m.door(m.base_frame("front", w / 2 - 0.35), width=2.6, steps=1)
        m.chimney(x1 - 0.75, y1 + 0.3, 0.9, 0.8, -STANDING_FOOTING, 8.1, lean=(0.05, -0.06), pots=2)
    rect, za, _zb = floors[0]
    m.lantern(m.base_frame("front", w - 0.32, 2.35), reach=0.5, size=0.8)
    m.arch_window(m.base_frame("left", d * 0.5, 0.95), width=1.15)
    m.arch_window(m.base_frame("right", d * 0.4, 0.95), width=1.15)
    front, width = side_frame("front", *rect, za)
    m.casement(front.at(width / 2, 1.25, 0.0), width=1.4)
    for side in ("left", "right"):
        fr, length = side_frame(side, *rect, za)
        m.casement(fr.at(length / 2, 1.25, 0.0), width=1.3, flowers=side == "left")
    m.swept_roof(*rect, eave, rise=2.4, ridge="y", eave_out=0.7, eave_drop=0.35, gable_out=0.35, prow=(0.7, 0.35), sweep=0.4, horn=(0.5, 0.35), board=0.4)
    m.arch_window(front.at(width / 2, STOREY + 0.3, 0.0), width=1.0)
    m.ivy(m.base_frame("right", d * 0.85, 0.35), width=1.6)
    m.barrel(x1 - 0.25, y0 - 0.7, size=0.85)
    m.crate(x0 + 0.2, y0 - 0.62, size=0.65, turn=0.25)
    return m


def boat_shed():
    """The shipwright's shed, built at the size the game draws it: six oak posts on stone pads
    under one swept roof, open to the shingle, a clinker hull on the stocks inside with its
    bow out under the prow, a boarded back wall, planks seasoning down one side and the
    yard's barrels and tar by the posts."""
    m = Model("boat_shed")
    x0, x1, y0, y1, eave = -3.3, 3.3, -4.2, 3.9, 4.0
    w = x1 - x0
    mid = (y0 + y1) / 2
    for sx in (x0, x1):
        for py in (y0 + 0.3, mid, y1 - 0.3):
            block(m, sx - 0.38, sx + 0.38, py - 0.38, py + 0.38, -STANDING_FOOTING, 0.45, STONE, skip="b", shade=0.95)
            m.sweep([(sx, py, 0.45), (sx, py, eave - 0.3)], (0.36, 0.36), "oak", depth=0.5, caps=False)
            for sy in (-1.0, 1.0):
                if y0 < py + sy * 1.1 < y1:
                    m.sweep([(sx, py + sy * 0.05, eave - 1.45), (sx, py + sy * 1.05, eave - 0.36)], (0.16, 0.18), "oak", depth=0.3, caps=False, shade=0.85)
        m.sweep([(sx, y0 - 0.2, eave - 0.18), (sx, y1 + 0.1, eave - 0.18)], (0.34, 0.36), "oak", depth=0.5)
    for py in (y0 + 0.3, mid, y1 - 0.3):
        m.sweep([(x0 - 0.1, py, eave - 0.2), (x1 + 0.1, py, eave - 0.2)], (0.3, 0.34), "oak", depth=0.5)
    m.swept_roof(x0, x1, y0, y1, eave, rise=3.3, ridge="y", eave_out=0.9, gable_out=0.4, prow=(1.1, 0.6), sweep=0.6, horn=(0.9, 0.6))
    m.relief(Frame((0.0, y0, eave + 0.55), (1, 0, 0)), "wheel", 1.3, 0.12, anchor=(0.5, 0.0))
    # the back wall: timbered and plastered both sides, on a stone footing
    block(m, x0 - 0.1, x1 + 0.1, y1 - 0.28, y1 + 0.1, -STANDING_FOOTING, 0.45, STONE, skip="b", shade=0.95)
    back, length = side_frame("back", x0, x1, y0, y1, 0.45)
    m.timber_wall(back, length, eave - 0.75, ends=False)
    m.timber_wall(Frame((x0, y1 - 0.14, 0.45), (1, 0, 0)), w, eave - 0.75, ends=False)
    # the hull on the stocks: two cradles, shores down to the ground, a ladder up her side
    lift = 0.95
    for cy in (-1.9, 1.6):
        wood(m, -1.5, 1.5, cy - 0.16, cy + 0.16, 0.0, 0.3, "oak", axis="x", shade=0.9)
        for sx in (-1.0, 1.0):
            wood(m, sx * 1.02 - 0.12, sx * 1.02 + 0.12, cy - 0.12, cy + 0.12, 0.3, lift + 0.55, "oak", axis="y", shade=0.85)
        wood(m, -0.9, 0.9, cy - 0.12, cy + 0.12, lift - 0.16, lift + 0.02, "oak", axis="x")
    with shifted(m, (0.0, -0.35, lift)):
        hull(m, 6.6, 2.3, 1.05, sheer=0.26, floor=0.24)
    for sx in (-1.0, 1.0):
        bar(m, (sx * 2.0, 0.2, 0.0), (sx * 1.12, 0.1, lift + 0.8), 0.07, band="oak", sides=6)
    for i in range(5):
        z = 0.35 + i * 0.36
        m.sweep([(1.42 + 0.34 * (1 - z / 2.1), -2.9, z), (1.42 + 0.34 * (1 - z / 2.1), -2.35, z)], (0.07, 0.07), "oak", depth=0.14, caps=False)
    for sy in (-2.9, -2.35):
        m.sweep([(1.78, sy, 0.0), (1.4, sy, 2.2)], (0.08, 0.08), "oak", depth=0.16, caps=False)
    # planks seasoning on bearers, the tar barrel, a crate of fastenings
    for i in range(4):
        wood(m, x0 + 0.55, x0 + 1.55, -0.6 + i * 0.02, 3.2 - i * 0.05, 0.3 + i * 0.13, 0.4 + i * 0.13, "planks", axis="z", shade=0.9 if i % 2 else 1.0)
    for by in (0.0, 2.6):
        wood(m, x0 + 0.5, x0 + 1.6, by - 0.1, by + 0.1, 0.0, 0.3, "oak", axis="x", shade=0.8)
    m.barrel(x1 - 0.75, y0 + 1.0, size=1.0)
    m.barrel(x1 - 0.7, y0 + 1.95, size=0.85, turn=0.6)
    m.crate(x1 - 0.85, 2.7, size=0.9, turn=0.2)
    m.hung_lamp(0.0, y0 + 0.3, eave - 0.42, 1.0)
    return m


def stable_block():
    """A stable at a horse's scale: three loose boxes in a row behind oak posts, rubble walls
    behind and at each end, half-doors on two and the third open on its hay, one long slate
    roof with its eaves to the yard, and the trough and bales that go with horses in front."""
    m = Model("stable_block")
    x0, x1, y0, y1, eave, thick, floor = -4.3, 4.3, -1.9, 2.3, 4.2, 0.46, 0.06
    # the back and end walls on a plinth course, the bedded floor
    for xa, xb, ya, yb in ((x0, x1, y1 - thick, y1), (x0, x0 + thick, y0, y1 - thick), (x1 - thick, x1, y0, y1 - thick)):
        block(m, xa, xb, ya, yb, -STANDING_FOOTING, eave, STONE, skip="b")
        block(m, xa - 0.08, xb + 0.08, ya - 0.08, yb + 0.08, -STANDING_FOOTING, 0.6, STONE, skip="b", shade=0.9)
    with tinted(m, (0.86, 0.72, 0.36)):
        block(m, x0 + thick, x1 - thick, y0 + 0.1, y1 - thick, -STANDING_FOOTING, floor, ("band", "plaster", "x", 0.8), skip="b", shade=0.85)
    # three bays: posts, the plate over them, plank partitions between the boxes
    bays = [x0 + thick + (x1 - x0 - 2 * thick) * i / 3 for i in range(4)]
    for px in bays[1:3]:
        m.sweep([(px, y0 + 0.2, -STANDING_FOOTING), (px, y0 + 0.2, eave - 0.3)], (0.36, 0.36), "oak", depth=0.5, caps=False)
        wood(m, px - 0.08, px + 0.08, y0 + 0.3, y1 - thick, floor, 2.4, "planks", axis="z", shade=0.85)
        # a knee brace each side of the post, up to the plate
        for side in (-1, 1):
            m.sweep([(px, y0 + 0.2, eave - 1.3), (px + side * 0.85, y0 + 0.2, eave - 0.4)], (0.2, 0.2), "oak", depth=0.3, caps=False)
    m.sweep([(x0 - 0.1, y0 + 0.2, eave - 0.2), (x1 + 0.1, y0 + 0.2, eave - 0.2)], (0.4, 0.4), "oak", depth=0.6)
    m.stud_row((x0 + 0.3, y0 + 0.0, eave - 0.2), (x1 - 0.3, y0 + 0.0, eave - 0.2), 11)
    # half-doors on the first two boxes: boarded, a ledge and a gilt latch
    for a, b in ((bays[0], bays[1]), (bays[1], bays[2])):
        wood(m, a + 0.2, b - 0.2, y0 + 0.14, y0 + 0.24, floor, 2.05, "planks", axis="y")
        wood(m, a + 0.2, b - 0.2, y0 + 0.08, y0 + 0.14, 1.6, 1.78, "oak", axis="x", shade=0.8)
        wood(m, a + 0.2, b - 0.2, y0 + 0.08, y0 + 0.14, 0.3, 0.48, "oak", axis="x", shade=0.8)
        m.gem(Vector((b - 0.45, y0 + 0.05, 1.69)), 0.09)
    # the open box: a hay heap and a manger on the back wall
    hx = (bays[2] + bays[3]) / 2
    with tinted(m, (0.92, 0.76, 0.34)):
        m.lathe(Frame((hx + 0.2, 0.9, floor), (1, 0, 0), UP, (0, 1, 0)), [(1.15, 0.0), (0.95, 0.6), (0.5, 1.25), (0.0, 1.5)], sides=8, skin=("band", "plaster", 0.9), smooth=True)
    wood(m, bays[0] + 0.3, bays[1] - 0.3, y1 - thick - 0.5, y1 - thick, 1.4, 1.66, "planks", axis="x", shade=0.9)
    m.swept_roof(x0, x1, y0, y1, eave, rise=2.0, ridge="x", eave_out=0.85, eave_drop=0.3, gable_out=0.35, prow=0.5, sweep=0.3, horn=0.4, board=0.4, thick=0.22)
    m.hung_lamp(bays[1], y0 + 0.2, eave - 0.45, 1.1)
    # the yard in front: two bales, the trough, a bucket
    for bx, turn in ((x0 + 1.2, 0.2), (x0 + 2.7, -0.5)):
        fr = Frame((bx, y0 - 1.05, 0.0), (math.cos(turn), math.sin(turn), 0.0), UP)
        with tinted(m, (0.92, 0.76, 0.34)):
            m.box(fr, -0.85, 0.85, 0.0, 0.85, -0.5, 0.5, ("band", "plaster", "x", 0.5), skip="b")
        with tinted(m, ROPE):
            for off in (-0.42, 0.42):
                m.box(fr, off - 0.03, off + 0.03, 0.0, 0.87, -0.52, 0.52, ("band", "plaster", "y", 0.2), skip="b")
    tw, td, th = 2.1, 0.8, 0.85
    tr = Frame((x1 - 3.0, y0 - 1.35, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(tr, 0.0, tw, 0.0, 0.08, 0.0, td, ("band", "planks", "x", 0.4))
    for a0, a1, b0, b1 in ((0.0, tw, 0.0, 0.08), (0.0, tw, td - 0.08, td), (0.0, 0.08, 0.0, td), (tw - 0.08, tw, 0.0, td)):
        m.box(tr, a0, a1, 0.0, th, b0, b1, ("band", "planks", "x" if a1 - a0 > b1 - b0 else "z", th), shade=0.9)
    with tinted(m, (0.1, 0.3, 0.36)):
        m.box(tr, 0.08, tw - 0.08, th - 0.16, th - 0.12, 0.08, td - 0.08, ("band", "plaster", "x", 0.6), skip="b")
    m.barrel(x1 - 0.5, y0 - 0.8, size=0.95)
    return m


def windmill():
    """A tower mill: a stone foot, a timbered body under a slate cap, and four canvas sails
    on a cross the game turns (the sails are their own mesh, named for it)."""
    m = Model("windmill")
    m.lathe(WORLD, [(2.75, 0.0), (2.75, 0.6), (2.45, 0.9), (2.1, 3.4)], sides=8, skin=STONE, smooth=False)
    m.lathe(WORLD, [(2.24, 3.3), (2.24, 3.62)], sides=8, skin=("band", "oak", 0.32), smooth=False)
    m.lathe(WORLD, [(2.08, 3.5), (1.62, 7.1)], sides=8, skin=("tile", "timber"), smooth=False)
    m.lathe(WORLD, [(1.76, 7.0), (1.76, 7.3)], sides=8, skin=("band", "bargeboard", 0.3), smooth=False)
    m.lathe(WORLD, [(2.3, 7.2), (1.7, 8.2), (0.8, 9.2), (0.04, 9.7)], sides=8, skin=("tile", "slate"))
    m.gem(Vector((0.0, 0.0, 9.95)), 0.2, stretch=1.8)
    wood(m, -0.55, 0.55, -2.52, -2.2, 0.0, 2.1, "planks", axis="y")
    block(m, -0.8, 0.8, -2.5, -2.1, 2.1, 2.5, STONE, shade=0.95)
    m.gem(Vector((0.3, -2.56, 1.0)), 0.07)
    flat = math.cos(math.pi / 8)
    for deg in (45.0, 135.0, 225.0, 315.0):
        a = math.radians(deg)
        at = (2.08 + (1.62 - 2.08) * (4.6 - 3.5) / 3.6) * flat + 0.01
        pane = Frame((math.cos(a) * at, math.sin(a) * at, 4.6), (-math.sin(a), math.cos(a), 0.0)).tilted(-6.7)
        m.box(pane, -0.3, 0.3, 0.0, 1.0, 0.0, 0.05, ("tile", "glass"), skip="k")
    bar(m, (0.0, -1.2, 7.2), (0.0, -3.0, 7.2), 0.2, band="oak", sides=8)
    m.sweep([(0.0, 1.5, 7.4), (0.0, 3.0, 4.2)], (0.16, 0.16), "oak", depth=0.2)
    fan = Model("windmill_fan")
    plane = -3.1
    for k in range(4):
        ca, sa = math.cos(math.pi / 2 * k), math.sin(math.pi / 2 * k)

        def at(w, r, y=plane, ca=ca, sa=sa):
            return (w * ca - r * sa, y, 7.2 + w * sa + r * ca)

        fan.sweep([at(0.0, 0.0), at(0.0, 4.5)], (0.2, 0.16), "oak", depth=0.24)
        for r in (1.2, 2.0, 2.8, 3.6, 4.35):
            fan.sweep([at(0.0, r), at(1.15, r)], (0.08, 0.08), "oak", depth=0.12)
        fan.sweep([at(1.15, 1.2), at(1.15, 4.35)], (0.08, 0.08), "oak", depth=0.12)
        with tinted(fan, CANVAS):
            for y, facing, lit in ((plane - 0.05, -1.0, 1.0), (plane + 0.05, 1.0, 0.8)):
                quad = [at(0.08, 1.25, y), at(1.1, 1.25, y), at(1.1, 4.3, y), at(0.08, 4.3, y)]
                uvs = [uv_band("plaster", 0.0, 0.0, 3.0), uv_band("plaster", 1.0, 0.0, 3.0), uv_band("plaster", 1.0, 1.0, 3.0), uv_band("plaster", 0.0, 1.0, 3.0)]
                fan.face(quad, uvs, "trim", lit, (0.0, facing, 0.0))
    fan.gem(Vector((0.0, plane - 0.2, 7.2)), 0.3)
    m.extras = [fan]
    return m


def bell_tower():
    """A village bell tower: a tall stone foot under a skirt of slate, a timbered shaft, an
    open belfry with its gilt bell, and a slate spire."""
    m = Model("bell_tower")
    foot = 4.6
    block(m, -3.1, 3.1, -3.1, 3.1, 0.0, foot, STONE, skip="b")
    block(m, -3.16, 3.16, -3.16, 3.16, 2.6, 2.85, ("band", "plaster", "x", 0.25))
    skirt = (3.1 + 0.4) * math.sqrt(2.0)
    m.lathe(WORLD, [(skirt, foot - 0.1), (1.85 * math.sqrt(2.0), foot + 0.9)], sides=4, skin=("tile", "slate"), smooth=False)
    wood(m, -0.6, 0.6, -3.16, -3.1, 0.0, 2.1, "planks", axis="y")
    block(m, -0.85, 0.85, -3.2, -3.1, 2.1, 2.5, ("band", "oak", "x", 0.4))
    m.gem(Vector((0.34, -3.2, 1.05)), 0.07)
    for sx in (-1.0, 1.0):
        block(m, sx * 3.1 - 0.03, sx * 3.1 + 0.03, -0.4, 0.4, 1.2, 2.4, ("tile", "glass"), skip="l" if sx > 0 else "r")
    block(m, -0.4, 0.4, -3.13, -3.07, 3.1, 4.1, ("tile", "glass"), skip="f")
    shaft = foot + 0.5
    m.storey(-1.75, 1.75, -1.75, 1.75, shaft, shaft + 3.6, collide=False)
    block(m, -1.72, 1.72, -1.72, 1.72, shaft - 0.2, shaft, ("band", "oak", "x", 0.2))
    deck = shaft + 3.6
    for x in (-1.6, 1.6):
        for y in (-1.6, 1.6):
            wood(m, x - 0.15, x + 0.15, y - 0.15, y + 0.15, deck, deck + 2.4, "oak", axis="y")
    block(m, -1.85, 1.85, -1.85, 1.85, deck, deck + 0.18, ("band", "oak", "x", 0.2))
    block(m, -1.8, 1.8, -1.8, 1.8, deck + 2.2, deck + 2.45, ("band", "bargeboard", "x", 0.25))
    for xa, xb, ya, yb in ((-1.75, 1.75, -1.75, -1.67), (-1.75, 1.75, 1.67, 1.75), (-1.75, -1.67, -1.75, 1.75), (1.67, 1.75, -1.75, 1.75)):
        wood(m, xa, xb, ya, yb, deck + 0.7, deck + 0.82, "oak")
    turned(m, 0.0, 0.0, deck, [(0.75, 0.5), (0.55, 0.75), (0.4, 1.35), (0.25, 1.8), (0.0, 1.85)], "gilded", sides=10, depth=0.8)
    bar(m, (0.0, 0.0, deck + 1.8), (0.0, 0.0, deck + 2.25), 0.05, band="oak", sides=5)
    eave = (1.75 + 0.55) * math.sqrt(2.0)
    roof = deck + 2.4
    m.lathe(WORLD, [(eave, roof), (eave * 0.45, roof + 2.4), (eave * 0.16, roof + 4.6), (0.04, roof + 5.8)], sides=4, skin=("tile", "slate"), smooth=False)
    m.lathe(WORLD, [(eave + 0.03, roof - 0.09), (eave + 0.03, roof + 0.07)], sides=4, skin=("band", "gilded", 0.16), smooth=False)
    m.gem(Vector((0.0, 0.0, roof + 6.05)), 0.2, stretch=1.8)
    return m


def palisade():
    """A length of stockade: sharpened logs lashed to two rails, braced from behind."""
    m = Model("palisade")
    for i in range(10):
        x = -6.3 + i * 1.4
        tall = 6.4 + (0.7 if i % 3 == 1 else 0.0) + (0.35 if i % 2 else 0.0)
        bar(m, (x, 0.0, 0.0), (x, 0.0, tall - 1.2), 0.66, band="oak", sides=7, shade=0.92 if i % 2 else 1.0, caps=False)
        bar(m, (x, 0.0, tall - 1.2), (x, 0.0, tall), 0.66, band="oak", sides=7, r1=0.06, shade=0.85, caps=False)
    for z in (2.0, 4.6):
        wood(m, -7.0, 7.0, 0.5, 0.86, z, z + 0.36, "planks")
    for x in (-4.2, 0.0, 4.2):
        m.sweep([(x, 0.7, 4.4), (x, 4.9, 0.0)], (0.3, 0.3), "oak", depth=0.4, shade=0.8)
    with tinted(m, ROPE):
        block(m, -7.0, 7.0, -0.74, -0.66, 3.3, 3.5, ("band", "plaster", "x", 0.2), skip="f")
    return m


def stone_fence():
    """A length of dry-stone wall under a row of cope stones (it runs front to back)."""
    m = Model("stone_fence")
    block(m, -0.62, 0.62, -4.0, 4.0, 0.0, 1.45, STONE, skip="b")
    for i in range(8):
        y = -4.0 + i
        block(m, -0.7, 0.7, y + 0.04, y + 0.96, 1.45, 1.75 + (0.14 if i % 2 else 0.0), STONE, shade=0.94)
    return m


def boatrack():
    """A skiff hauled out onto two cradles."""
    m = Model("boatrack")
    hull(m, 2.2, 0.9, 0.36, sheer=0.08, floor=0.1)
    for y in (-0.6, 0.6):
        wood(m, -0.75, 0.75, y - 0.08, y + 0.08, -0.26, -0.1, "oak", axis="x")
        for x in (-0.62, 0.62):
            wood(m, x - 0.07, x + 0.07, y - 0.07, y + 0.07, -0.26, 0.34, "oak", axis="y", shade=0.85)
    return m


def ruin_column(broken=False):
    """A column of the old ruins, standing whole or snapped off a third of the way down."""
    m = Model("ruin_column")
    top = 2.8 if broken else 4.0
    m.lathe(WORLD, [(0.6, 0.0), (0.6, 0.22), (0.46, 0.34), (0.42, 0.5)], sides=8, skin=ASHLAR, smooth=False)
    if broken:
        m.lathe(WORLD, [(0.42, 0.5), (0.39, top - 0.3), (0.0, top - 0.3)], sides=8, skin=ASHLAR, smooth=False, v0=0.5)
        m.box(Frame((-0.3, -0.22, top - 0.3), (0.94, 0.34, 0.0)), 0.0, 0.52, 0.0, 0.3, -0.5, 0.0, ASHLAR, shade=0.92, skip="b")
    else:
        m.lathe(WORLD, [(0.42, 0.5), (0.38, 3.58), (0.56, 3.8), (0.6, 4.0), (0.0, 4.0)], sides=8, skin=ASHLAR, smooth=False, v0=0.5)
    return m


def ruin_block():
    """A carved block fallen from the ruins: a pedestal on its own."""
    m = Model("ruin_block")
    block(m, -0.8, 0.8, -0.8, 0.8, 0.0, 0.26, STONE, skip="b")
    block(m, -0.72, 0.72, -0.72, 0.72, 0.26, 1.36, ASHLAR)
    block(m, -0.74, 0.74, -0.74, 0.74, 0.9, 1.02, ("band", "plaster", "x", 0.2))
    block(m, -0.8, 0.8, -0.8, 0.8, 1.36, 1.6, ASHLAR, shade=0.97)
    return m


def ruin_head():
    """The helmed head of a fallen colossus, set upright in the turf."""
    m = Model("ruin_head")
    m.lathe(WORLD, [(0.85, 0.0), (0.8, 0.5), (1.05, 0.9), (1.12, 2.2), (0.95, 3.2), (0.5, 3.8), (0.0, 4.0)], sides=8, skin=ASHLAR)
    block(m, -1.2, 1.2, -1.14, -0.7, 2.25, 2.55, ASHLAR, shade=0.95)
    block(m, -0.16, 0.16, -1.2, -0.8, 1.2, 2.3, ASHLAR, shade=0.97)
    for xa, xb in ((-0.8, -0.22), (0.22, 0.8)):
        block(m, xa, xb, -1.07, -0.96, 1.85, 2.2, STONE, shade=0.45)
    block(m, -0.1, 0.1, -0.6, 0.9, 3.55, 4.0, ASHLAR)
    for sx in (-1.0, 1.0):
        block(m, sx * 1.05 - 0.12, sx * 1.05 + 0.12, -0.9, -0.2, 0.7, 1.9, ASHLAR, shade=0.92)
    return m


def lot(name):
    return dict(make=lambda: house(name), fit="inside")


# Colour sets of the props' own, beside the towns' (build.py COLOUR_SETS): {name: (the sheets
# repainted, the surface tones)}. "ember" is Wyrmwatch's: that town is lit low and warm, and a
# surface darker than pale stone or bright tile goes black in its own shadow there, so its
# smithy is roofed in scarlet tile and takes every tone at full strength.
PROP_LOOKS = {
    "ember": ({"slate": (-150.0, 0.45, 1.0, (0.88, 0.27, 0.17))}, {"eh_slate": (1.0, 1.0, 1.0), "eh_stone": (1.0, 0.97, 0.93), "eh_timber": (0.9, 0.9, 0.9), "eh_trim": (0.92, 0.92, 0.92)}),
}

# Every release model this file replaces. A target whose release file the DUNGEONS also load
# (public/models/dungeon/) is written to a NEW path beside the rest of the castle kit and the
# game's prop table is pointed at it; `like` names the release model whose bounds it takes.
CASTLE_PROPS = {
    # windmills, the keep, towers and walls
    "biome/hex_windmill": dict(make=windmill, fit="inside"),
    "biome/hexb_windmill": dict(make=windmill, fit="inside"),
    "biome/hexr_windmill": dict(make=windmill, fit="inside"),
    "biome/hex_castle": dict(make=keep, fit="inside"),
    "biome/hexr_castle": dict(make=keep, fit="inside"),
    "biome/hex_tower_cannon": dict(make=lambda: drum_tower("battlements", engine="cannon"), fit="inside"),
    "biome/hex_tower_catapult": dict(make=lambda: drum_tower("battlements", engine="catapult"), fit="inside"),
    "biome/hexr_tower_catapult": dict(make=lambda: drum_tower("battlements", engine="catapult"), fit="inside"),
    "biome/hexr_tower_base": dict(make=lambda: drum_tower("battlements"), fit="inside"),
    "biome/hexb_tower_base": dict(make=lambda: drum_tower("battlements"), fit="inside"),
    "biome/hex_tower": dict(make=lambda: drum_tower("roof"), fit="inside"),
    "biome/hexb_tower_a": dict(make=lambda: drum_tower("roof"), fit="inside"),
    "biome/hexr_tower_a": dict(make=lambda: drum_tower("roof"), fit="inside"),
    "biome/hexb_tower_b": dict(make=lambda: drum_tower("roof", flare=0.4), fit="inside"),
    "biome/hex_wall": dict(make=curtain),
    "biome/hex_boatrack": dict(make=boatrack, fit="inside"),
    "biome/hexn_fence_stone": dict(make=stone_fence),
    "biome/hexn_palisade": dict(make=palisade),
    "props/bell_tower": dict(make=bell_tower, fit="inside"),
    # the old ruins scattered over the map
    "props/column": dict(make=lambda: ruin_column(False)),
    "props/column_broken": dict(make=lambda: ruin_column(True)),
    "props/statue_head": dict(make=ruin_head),
    "props/statue_block": dict(make=ruin_block),
    # The barracks and the smithy stand ALONE in the main map as one prop each (the green
    # barracks on Dawnhold's parade ground and at the hedge knights' camp, the red smithy in
    # Wyrmwatch's workshop yard; the other colourway of each shares its model), so each is its
    # own small building made at the size the game draws it: a town lot squeezed into these
    # bounds came out at two fifths of its size, a doll's house with a door to a walker's
    # knee. Wyrmwatch's smithy wears the ember look, PROP_LOOKS above.
    "biome/hex_barracks": dict(make=guardhouse, fit="inside"),
    "biome/hexr_barracks": dict(make=guardhouse, fit="inside"),
    "biome/hex_blacksmith": dict(make=open_forge, fit="inside"),
    "biome/hexr_blacksmith": dict(make=lambda: open_forge("ashlar"), fit="inside", look="ember"),
    # Galecrest's and Willowfen's homesteads, stable hamlet, farrier and shipwright stand the
    # same way, one prop a building: a croft, a taller croft, the forge again as the
    # workshop, a boat shed and a stable block.
    "biome/hexb_home_a": dict(make=croft, fit=CROFT_FIT),
    "biome/hex_home_a": dict(make=croft, fit=CROFT_FIT),
    "biome/hexr_home_a": dict(make=croft, fit=CROFT_FIT),
    "biome/hexb_home_b": dict(make=tall_croft, fit=TALL_CROFT_FIT),
    "biome/hex_home_b": dict(make=tall_croft, fit=TALL_CROFT_FIT),
    "biome/hexr_home_b": dict(make=tall_croft, fit=TALL_CROFT_FIT),
    "biome/hexb_workshop": dict(make=open_forge, fit="inside"),
    "biome/hexb_shipyard": dict(make=boat_shed, fit="inside"),
    "biome/hexb_stables": dict(make=stable_block, fit=STABLE_FIT),
    "biome/hexr_stables": dict(make=stable_block, fit=STABLE_FIT),
    # the last settlements built of single house props
    "props/house_3": lot("apothecary"),
    "props/kmed_home_A_hollow": lot("small_cottage"),
    "props/kmed_home_B_hollow": lot("cottage"),
    "props/kmed_tavern_hollow": lot("inn"),
    "props/kmed_church_hollow": lot("chapel"),
    "props/kmed_blacksmith_hollow": lot("smithy"),
    "props/kmed_market_hollow": lot("apothecary"),
    "biome/hexr_townhall": lot("bank"),
    "biome/hexr_church": lot("chapel"),
    "biome/hexr_tavern": lot("inn"),
    "biome/hexr_market": lot("apothecary"),
    "biome/hexr_archeryrange": lot("smithy"),
    # the castle's walls
    "biome/kcas_wall": dict(make=lambda: castle_wall("plain")),
    "biome/kcas_wall_half": dict(make=lambda: castle_wall("half")),
    "biome/kcas_wall_corner": dict(make=lambda: castle_wall("corner")),
    "biome/kcas_wall_gated": dict(make=lambda: castle_wall("gated")),
    "biome/kcas_wall_doorway": dict(make=lambda: castle_wall("doorway")),
    "biome/kcas_wall_broken": dict(make=lambda: castle_wall("broken")),
    "biome/kcas_wall_cracked": dict(make=lambda: castle_wall("cracked")),
    "biome/kcas_wall_window": dict(make=lambda: castle_wall("window")),
    "biome/kcas_wall_pillar": dict(make=lambda: castle_wall("pillar")),
    # The two palaces' rooms (render/palace_tile_kit.ts): the pieces the dungeon kit has and
    # the castle kit lacked, each on the dungeon module's own bounds.
    "biome/kcas_wall_niche": dict(make=lambda: castle_wall("niche"), like="dungeon/wall_arched"),
    "biome/kcas_hall_floor": dict(make=lambda: hall_floor(False), like="dungeon/floor_tile_large"),
    "biome/kcas_hall_floor_small": dict(make=lambda: hall_floor(True), like="dungeon/floor_tile_small"),
    "biome/kcas_hall_pier": dict(make=hall_pier, like="dungeon/pillar"),
    "biome/kcas_stairs_wide": dict(make=lambda: castle_stairs(False)),
    "biome/kcas_stairs_walled": dict(make=lambda: castle_stairs(True)),
    "biome/kcas_barrier": dict(make=lambda: castle_parapet("full")),
    "biome/kcas_barrier_half": dict(make=lambda: castle_parapet("half")),
    "biome/kcas_barrier_corner": dict(make=lambda: castle_parapet("corner")),
    "biome/kcas_column": dict(make=castle_column),
    "biome/kcas_pillar": dict(make=castle_pier),
    "biome/kcas_floor_large": dict(make=lambda: castle_floor(False)),
    "biome/kcas_floor_weeds": dict(make=lambda: castle_floor(True)),
    "biome/kcas_foundation": dict(make=castle_foundation),
    "biome/kcas_rubble_large": dict(make=lambda: castle_rubble(False)),
    "biome/kcas_rubble_half": dict(make=lambda: castle_rubble(True)),
    "biome/kcas_rocks": dict(make=castle_rocks),
    # banners and torches
    "biome/kcas_banner_red_a": dict(make=lambda: hung_banner(RED, "a")),
    "biome/kcas_banner_red_shield": dict(make=lambda: hung_banner(RED, "shield")),
    "biome/kcas_banner_red_triple": dict(make=lambda: hung_banner(RED, "triple")),
    "biome/kcas_banner_green_a": dict(make=lambda: hung_banner(GREEN, "a"), like="dungeon/banner_green"),
    "biome/kcas_banner_green_shield": dict(make=lambda: hung_banner(GREEN, "shield"), like="dungeon/banner_shield_green"),
    "biome/kcas_banner_green_triple": dict(make=lambda: hung_banner(GREEN, "triple"), like="dungeon/banner_triple_green"),
    "biome/kcas_torch": dict(make=lambda: torch(False), fit="inside"),
    "biome/kcas_torch_mounted": dict(make=lambda: torch(True), fit="inside"),
    # furniture
    "biome/kcas_chest_gold": dict(make=chest),
    "biome/kcas_chest": dict(make=chest, like="dungeon/chest"),
    "biome/kcas_table_long": dict(make=lambda: ftable("long")),
    "biome/kcas_table_cloth": dict(make=lambda: ftable("cloth"), like="dungeon/table_long_tablecloth"),
    "biome/kcas_table_round_small": dict(make=lambda: ftable("round_small"), like="dungeon/table_round_small"),
    "biome/kcas_table_round_medium": dict(make=lambda: ftable("round_medium"), like="dungeon/table_round_medium"),
    "biome/kcas_bench": dict(make=fbench),
    "biome/kcas_chair": dict(make=fchair, like="dungeon/chair"),
    "biome/kcas_stool": dict(make=lambda: fstool(False), like="dungeon/stool"),
    "biome/kcas_stool_round": dict(make=lambda: fstool(True), like="dungeon/stool_round"),
    "biome/kcas_bookcase": dict(make=bookcase),
    "biome/kcas_shelf_large": dict(make=lambda: shelf("large"), like="dungeon/shelf_large"),
    "biome/kcas_shelf_small": dict(make=lambda: shelf("small"), like="dungeon/shelf_small"),
    "biome/kcas_shelf_books": dict(make=lambda: shelf("books"), like="dungeon/shelf_small_books"),
    "biome/kcas_shelf_candles": dict(make=lambda: shelf("candles"), like="dungeon/shelf_small_candles"),
    "biome/kcas_keg": dict(make=keg),
    "biome/kcas_barrel": dict(make=barrel_prop),
    "biome/kcas_bed_royal": dict(make=lambda: bed("royal"), like="dungeon/bed_decorated"),
    "biome/kcas_bed_double": dict(make=lambda: bed("double", NAVY), like="dungeon/bed_b_double"),
    "biome/kcas_bed_single": dict(make=lambda: bed("single", GREEN), like="dungeon/bed_b_single"),
    "biome/kcas_bed_bunk": dict(make=lambda: bed("bunk", NAVY), like="dungeon/bed_a_stacked"),
    "biome/kcas_bed_cot": dict(make=lambda: bed("cot", GREEN), like="dungeon/bed_a_single"),
    "biome/kcas_bedroll": dict(make=lambda: bed("roll"), like="dungeon/bed_floor"),
    "biome/kcas_bar_a": dict(make=lambda: bar_counter("a"), like="dungeon/bar_straight_a"),
    "biome/kcas_bar_b": dict(make=lambda: bar_counter("b"), like="dungeon/bar_straight_b"),
    "biome/kcas_bar_c": dict(make=lambda: bar_counter("c"), like="dungeon/bar_straight_c"),
    "biome/kcas_bartop": dict(make=backbar, like="dungeon/bartop_a_medium"),
    "biome/kcas_candle_triple": dict(make=candles, like="dungeon/candle_triple"),
    "biome/kcas_crate_large": dict(make=lambda: crates("large"), like="dungeon/crate_large"),
    "biome/kcas_crate_small": dict(make=lambda: crates("small"), like="dungeon/crate_small"),
    "biome/kcas_crates_stacked": dict(make=lambda: crates("stacked"), like="dungeon/crates_stacked"),
    "biome/kcas_sword_shield": dict(make=trophy, like="dungeon/sword_shield"),
    "biome/kcas_shrine": dict(make=shrine, like="dungeon/shrine_candles"),
}

# The game's prop keys that pointed into public/models/dungeon/ and now point at the files
# above (src/render/props.ts PROP_ASSET_DEFS).
REPOINTED = {
    "dungeon/banner_green": "biome/kcas_banner_green_a",
    "dungeon/banner_shield_green": "biome/kcas_banner_green_shield",
    "dungeon/banner_triple_green": "biome/kcas_banner_green_triple",
    "dungeon/bed_decorated": "biome/kcas_bed_royal",
    "dungeon/bed_b_double": "biome/kcas_bed_double",
    "dungeon/bed_b_single": "biome/kcas_bed_single",
    "dungeon/bed_a_stacked": "biome/kcas_bed_bunk",
    "dungeon/bed_a_single": "biome/kcas_bed_cot",
    "dungeon/bed_floor": "biome/kcas_bedroll",
    "dungeon/chair": "biome/kcas_chair",
    "dungeon/stool": "biome/kcas_stool",
    "dungeon/stool_round": "biome/kcas_stool_round",
    "dungeon/chest": "biome/kcas_chest",
    "dungeon/table_round_small": "biome/kcas_table_round_small",
    "dungeon/table_round_medium": "biome/kcas_table_round_medium",
    "dungeon/table_long_tablecloth": "biome/kcas_table_cloth",
    "dungeon/shelf_large": "biome/kcas_shelf_large",
    "dungeon/shelf_small": "biome/kcas_shelf_small",
    "dungeon/shelf_small_books": "biome/kcas_shelf_books",
    "dungeon/shelf_small_candles": "biome/kcas_shelf_candles",
    "dungeon/bar_straight_a": "biome/kcas_bar_a",
    "dungeon/bar_straight_b": "biome/kcas_bar_b",
    "dungeon/bar_straight_c": "biome/kcas_bar_c",
    "dungeon/bartop_a_medium": "biome/kcas_bartop",
    "dungeon/candle_triple": "biome/kcas_candle_triple",
    "dungeon/crate_large": "biome/kcas_crate_large",
    "dungeon/crate_small": "biome/kcas_crate_small",
    "dungeon/crates_stacked": "biome/kcas_crates_stacked",
    "dungeon/sword_shield": "biome/kcas_sword_shield",
    "dungeon/shrine_candles": "biome/kcas_shrine",
}
