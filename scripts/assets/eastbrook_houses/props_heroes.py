# The statues and landmark pieces, the planted beds, rocks and crystals: the last of the
# release's own show pieces, rebuilt in the same painted kit. Built by build_props.py over
# each release model's own path (see props.py).
#
# Most of these were generated scans of five to twelve thousand triangles; each is now a
# few hundred faces of the kit's own stone, plaster, gilt and planking, so a statue in a
# square is drawn by the same hand as the houses round it. Leaves, petals and crystal are
# the plaster band tinted through the vertex colours (the kit has no leaf painting), which
# reads as clipped, painted foliage rather than a photograph of a hedge.
#
# Pieces the game keeps a collider or a footprint for (huts, crystals, rocks, the shrine,
# the mushroom house, the gate mound) are fitted exactly to the old bounds. Free-standing
# pieces (statues, beds, shrubs, palms) are scaled as one inside the old bounds, so nothing
# is squashed.
import math
import random

from kit import UP, Frame, Model, uv_band, uv_tile
from mathutils import Matrix, Vector

from props import CANVAS, bar, hull, striped, tinted
from props_castle import ASHLAR, GOLD, LINEN, RED, STONE, WORLD, block, candle

LEAF = (0.24, 0.5, 0.2)
LEAF_DARK = (0.14, 0.36, 0.17)
LEAF_PALE = (0.42, 0.62, 0.24)
SOIL = (0.2, 0.15, 0.11)
DARK = (0.06, 0.05, 0.06)
DRIFT = (0.62, 0.58, 0.5)
MUD = (0.74, 0.62, 0.5)
PINK = (0.95, 0.5, 0.62)
YELLOW = (0.98, 0.82, 0.26)
VIOLET = (0.62, 0.44, 0.88)
AMETHYST = (0.62, 0.4, 0.9)
AMETHYST_DEEP = (0.4, 0.22, 0.68)
AMETHYST_PALE = (0.8, 0.66, 0.98)
STAR = ((0.62, 0.84, 0.98), (0.42, 0.62, 0.94), (0.86, 0.94, 1.0))
BLOOMS = (RED, YELLOW, PINK, LINEN, VIOLET)


# -- shared shapes ------------------------------------------------------------------------------


def mark(m):
    """Where the model's vertices stand now: everything built after it can be moved as one."""
    return len(m.bm.verts)


def move(m, start, scale=1.0, offset=(0.0, 0.0, 0.0), turn=0.0, tilt=0.0):
    """Scales, turns (about Z), tilts (about X) and shifts everything built since `start`:
    how a piece modelled at the origin (a hull, a horse) is stood on its plinth."""
    rot = Matrix.Rotation(math.radians(turn), 3, "Z") @ Matrix.Rotation(math.radians(tilt), 3, "X")
    off = Vector(offset)
    for v in list(m.bm.verts)[start:]:
        v.co = rot @ (v.co * scale) + off


def blob(m, c, r, h, sides=8, rings=3, band="plaster", depth=1.0, axis=UP, right=(1.0, 0.0, 0.0), shade=1.0, flat=False, dome=False):
    """A rounded mass centred on c: r across, h along its axis each way. `dome` keeps only
    the upper half (a mound sitting on something)."""
    fr = Frame(c, right, axis)
    n = rings * 2
    first = rings if dome else 0
    profile = [(r * math.sin(math.pi * i / n), -h * math.cos(math.pi * i / n)) for i in range(first, n + 1)]
    profile[-1] = (0.0, h)
    if not dome:
        profile[0] = (0.0, -h)
    m.lathe(fr, profile, sides=sides, skin=("band", band, depth), smooth=not flat, shade=shade)


def cutout(m, outline, thick, band="gilded", y=0.0, shade=1.0, depth=None):
    """A thick shape cut to an outline [(x, z)] (convex, anticlockwise seen from the front),
    its front on -Y: the kit's standing stone, in a trim band instead of a tile."""
    zs = [p[1] for p in outline]
    z0, z1 = min(zs), max(zs)
    tall = depth or max(z1 - z0, 0.2)

    def uv(px, pz):
        # the middle of the band, so its painted edges never cross a face
        return uv_band(band, px + 3.0, 0.2 + 0.6 * (pz - z0) / max(z1 - z0, 1e-4), tall)

    front = [(px, y - thick / 2, pz) for px, pz in outline]
    back = [(px, y + thick / 2, pz) for px, pz in outline]
    m.face(front, [uv(px, pz) for px, pz in outline], "trim", shade, (0.0, -1.0, 0.0))
    m.face(back, [uv(px, pz) for px, pz in outline], "trim", shade * 0.86, (0.0, 1.0, 0.0))
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    run = 0.0
    for i in range(len(outline)):
        (ax, az), (bx, bz) = outline[i], outline[(i + 1) % len(outline)]
        length = math.hypot(bx - ax, bz - az)
        out = Vector(((ax + bx) / 2 - cx, 0.0, (az + bz) / 2 - cz))
        pts = [(ax, y - thick / 2, az), (bx, y - thick / 2, bz), (bx, y + thick / 2, bz), (ax, y + thick / 2, az)]
        uvs = [uv_band(band, run, 0.2, thick), uv_band(band, run + length, 0.2, thick), uv_band(band, run + length, 0.8, thick), uv_band(band, run, 0.8, thick)]
        lit = 0.68 + 0.32 * max(0.0, out.normalized().z if out.length else 0.0)
        m.face(pts, uvs, "trim", shade * lit, out)
        run += length


def arch_outline(half, spring, rise, z=0.0, steps=6):
    """A round-headed opening's outline: up one jamb, over the head, down the other."""
    pts = [(-half, z), (half, z), (half, z + spring)]
    for i in range(1, steps):
        a = math.pi * i / steps
        pts.append((half * math.cos(a), z + spring + rise * math.sin(a)))
    pts.append((-half, z + spring))
    return pts


def rock(m, c, r, h, sides=6, seed=0, skin=STONE, lean=(0.0, 0.0), shade=1.0, squash=1.0):
    """A faceted boulder standing at c: an uneven lathe, its rings pushed off centre so no
    two rocks share a silhouette. `squash` narrows it front to back."""
    rng = random.Random(seed)
    fr = Frame(c, (1.0, 0.0, 0.0), UP, (0.0, squash, 0.0)) if squash == 1.0 else None
    if fr is None:
        # a squashed rock: the same lathe, then pressed along Y about its own centre
        start = mark(m)
        rock(m, (0.0, 0.0, 0.0), r, h, sides, seed, skin, lean, shade)
        for v in list(m.bm.verts)[start:]:
            v.co = Vector((v.co.x + c[0], v.co.y * squash + c[1], v.co.z + c[2]))
        return
    jit = lambda k: rng.uniform(-0.08, 0.08) * r * k  # noqa: E731
    profile = [
        (r * rng.uniform(0.86, 1.0), 0.0),
        (r * rng.uniform(0.9, 1.04), h * rng.uniform(0.26, 0.4)),
        (r * rng.uniform(0.58, 0.78), h * rng.uniform(0.68, 0.82)),
        (r * rng.uniform(0.2, 0.34), h * 0.97),
        (0.0, h),
    ]
    leans = [(0.0, 0.0), (lean[0] * 0.3 + jit(1), lean[1] * 0.3 + jit(1)), (lean[0] * 0.7 + jit(1), lean[1] * 0.7 + jit(1)), (lean[0], lean[1]), (lean[0], lean[1])]
    m.lathe(fr, profile, sides=sides, skin=skin, smooth=False, shade=shade, lean=leans, phase=rng.uniform(0.0, 1.0))


def crystal(m, foot, tip, r, colour=AMETHYST, sides=6, point=0.26, waist=0.7, turn=0.0):
    """A pointed six-sided crystal from foot to tip. Every facet takes its own shade, so the
    cut reads from any side and under any light."""
    foot, tip = Vector(foot), Vector(tip)
    axis = tip - foot
    length = axis.length
    u = axis.normalized()
    side = u.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-4:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    other = u.cross(side).normalized()
    shoulder = foot + u * length * (1.0 - point)
    angles = [math.tau * k / sides + turn for k in range(sides)]
    ring0 = [foot + (side * math.cos(a) + other * math.sin(a)) * r * waist for a in angles]
    ring1 = [shoulder + (side * math.cos(a) + other * math.sin(a)) * r for a in angles]
    with tinted(m, colour):
        for k in range(sides):
            j = (k + 1) % sides
            lit = 0.5 + 0.5 * (0.5 + 0.5 * math.cos(angles[k] * 1.0 + 0.8))
            out = (ring1[k] + ring1[j]) / 2 - shoulder
            quad = [ring0[k], ring0[j], ring1[j], ring1[k]]
            uvs = [uv_band("plaster", 0.0, 0.2, 1.2), uv_band("plaster", r, 0.2, 1.2), uv_band("plaster", r, 0.8, 1.2), uv_band("plaster", 0.0, 0.8, 1.2)]
            m.face(quad, uvs, "trim", lit, out)
            m.face([ring1[k], ring1[j], tip], uvs[:3], "trim", min(1.0, lit + 0.22), out + u * r)


def spray(m, centre, specs, colours, base=0.4, seed=0):
    """Crystals leaning out from a centre: specs are (bearing degrees, how far out the foot
    stands, how far the tip leans, length, radius)."""
    rng = random.Random(seed)
    cx, cy, cz = centre
    for i, (deg, out, lean, length, r) in enumerate(specs):
        a = math.radians(deg)
        foot = Vector((cx + math.cos(a) * out, cy + math.sin(a) * out, cz + base * rng.uniform(0.2, 1.0)))
        aim = Vector((math.cos(a) * lean, math.sin(a) * lean, 1.0)).normalized()
        crystal(m, foot, foot + aim * length, r, colours[i % len(colours)], turn=rng.uniform(0.0, 1.0))


def plinth(m, hx, hy, shaft_x, shaft_y, height, steps=0.22):
    """A stepped pedestal: a dark stone step, a pale one, a pale shaft with a gilt band and
    a cap. Returns the height of its top."""
    block(m, -hx, hx, -hy, hy, 0.0, steps, STONE, skip="b")
    block(m, -hx * 0.82, hx * 0.82, -hy * 0.82, hy * 0.82, steps, steps * 2, ASHLAR)
    z = steps * 2
    block(m, -shaft_x, shaft_x, -shaft_y, shaft_y, z, z + height, ASHLAR)
    block(m, -shaft_x - 0.03, shaft_x + 0.03, -shaft_y - 0.03, shaft_y + 0.03, z + height * 0.62, z + height * 0.62 + 0.1, ("band", "gilded", "x", 0.1))
    block(m, -shaft_x - 0.12, shaft_x + 0.12, -shaft_y - 0.12, shaft_y + 0.12, z + height, z + height + 0.16, ASHLAR, shade=0.97)
    return z + height + 0.16


def bloom(m, x, y, z, size, colour, stem=0.0):
    """One flower: a faceted head on a short green stem."""
    if stem > 0.0:
        with tinted(m, LEAF_DARK):
            bar(m, (x, y, z), (x, y, z + stem), size * 0.22, band="plaster", sides=4, caps=False)
    with tinted(m, colour):
        m.gem(Vector((x, y, z + stem + size * 0.5)), size, band="plaster", stretch=0.7)
    with tinted(m, YELLOW):
        m.gem(Vector((x, y, z + stem + size * 0.95)), size * 0.36, band="plaster", stretch=0.8)


def planting(m, spots, seed=0):
    """Low leafy mounds with flowers on them: spots are (x, y, z, radius)."""
    rng = random.Random(seed)
    for i, (x, y, z, r) in enumerate(spots):
        with tinted(m, (LEAF, LEAF_DARK, LEAF_PALE)[i % 3]):
            blob(m, (x, y, z), r, r * 0.5, sides=7, rings=2, depth=1.0, dome=True, flat=True)
        for k in range(3):
            a = rng.uniform(0.0, math.tau)
            d = r * rng.uniform(0.15, 0.6)
            bloom(m, x + math.cos(a) * d, y + math.sin(a) * d, z + r * 0.34, r * rng.uniform(0.16, 0.24), BLOOMS[(i + k) % len(BLOOMS)], stem=r * 0.12)


# -- statues and landmark pieces -----------------------------------------------------------------


def knight(m):
    """A heraldic horse's head and neck, cut thick like a chess knight, its nose toward +X
    and its neck standing on z = 0. A cut profile with a mane ridge reads as a horse from
    across a square, where a hand-modelled whole horse reads as a lump."""
    neck = [(-0.55, 0.0), (0.5, 0.0), (0.62, 0.55), (0.52, 1.3), (0.1, 1.72), (-0.3, 1.25), (-0.5, 0.6)]
    head = [(0.0, 1.3), (0.55, 1.05), (1.02, 0.8), (1.14, 1.0), (0.74, 1.6), (0.3, 1.9), (0.02, 1.8)]
    mane = [(-0.68, 0.12), (-0.5, 0.05), (-0.2, 1.25), (0.12, 1.78), (-0.02, 1.96), (-0.52, 1.36)]
    cutout(m, mane, 0.2, "gilded", shade=0.66)
    cutout(m, neck, 0.5, "gilded")
    cutout(m, head, 0.4, "gilded", shade=0.97)
    for side in (-1.0, 1.0):
        cutout(m, [(0.1, 1.76), (0.32, 1.84), (0.17, 2.24)], 0.08, "gilded", y=side * 0.13, shade=0.9)
        with tinted(m, DARK):
            m.gem(Vector((0.5, side * 0.21, 1.5)), 0.055, band="plaster", stretch=0.8)
    # the bridle: a band over the nose and one behind the jaw
    with tinted(m, RED):
        cutout(m, [(0.8, 0.9), (0.9, 0.86), (0.98, 1.3), (0.88, 1.36)], 0.43, "plaster")
        cutout(m, [(0.34, 1.12), (0.46, 1.08), (0.6, 1.72), (0.48, 1.78)], 0.43, "plaster")
    # a collar where the neck meets the stone
    block(m, -0.62, 0.66, -0.3, 0.3, 0.0, 0.14, ("band", "gilded", "x", 0.14), shade=0.9)


def horse_statue(grand=False):
    """The golden horse: a gilded heraldic horse on a stepped pedestal. `grand` is the taller
    one, on a long pedestal, that the old castle kit carried."""
    m = Model("horse_statue")
    if grand:
        top = plinth(m, 0.86, 1.65, 0.6, 1.25, 2.0)
        size = 1.5
    else:
        top = plinth(m, 1.3, 1.3, 0.66, 0.66, 0.85)
        size = 1.0
    start = mark(m)
    knight(m)
    # nose toward the front (-Y)
    move(m, start, scale=size, offset=(0.0, 0.1 * size, top), turn=-90.0)
    return m


def ship_monument():
    """The ship monument: a little cog under sail riding a painted swell on a pedestal."""
    m = Model("ship_monument")
    top = plinth(m, 1.35, 1.35, 0.9, 0.9, 0.6)
    m.lathe(Frame((0.0, 0.0, top), (1, 0, 0), UP, (0, 1, 0)), [(1.0, 0.0), (0.95, 0.1), (0.5, 0.2), (0.0, 0.24)], sides=10, skin=("band", "teal", 0.5), smooth=False)
    start = mark(m)
    hull(m, 2.3, 0.86, 0.46, sheer=0.2, stations=8, rows=4, floor=0.2)
    bar(m, (0.0, 0.1, 0.2), (0.0, 0.1, 2.25), 0.05, band="oak", sides=6)
    bar(m, (-0.72, 0.1, 1.9), (0.72, 0.1, 1.9), 0.035, band="oak", sides=6)
    with tinted(m, CANVAS):
        n = 3
        for i in range(n):
            for j in range(n):
                quad = []
                for tx, tz in ((i / n, j / n), ((i + 1) / n, j / n), ((i + 1) / n, (j + 1) / n), (i / n, (j + 1) / n)):
                    belly = 0.24 * math.sin(math.pi * tx) * math.sin(math.pi * (0.15 + 0.85 * tz))
                    quad.append((-0.66 + 1.32 * tx, 0.08 - belly, 0.74 + 1.14 * tz))
                uvs = [uv_band("plaster", p[0] + 1.0, 0.2 + 0.6 * (p[2] - 0.74) / 1.14, 1.2) for p in quad]
                m.face(quad, uvs, "trim", 0.9 + 0.1 * (j / n), (0.0, -1.0, 0.2))
                m.face([(p[0], p[1] + 0.012, p[2]) for p in quad], uvs, "trim", 0.74, (0.0, 1.0, 0.0))
    with tinted(m, RED):
        flag = [(0.0, 0.1, 2.24), (0.0, 0.1, 2.02), (0.0, 0.62, 2.13)]
        for facing in (1.0, -1.0):
            m.face([(p[0] + 0.006 * facing, p[1], p[2]) for p in flag], [uv_band("plaster", 0.0, 0.2, 0.4), uv_band("plaster", 0.0, 0.8, 0.4), uv_band("plaster", 0.5, 0.5, 0.4)], "trim", 0.95, (facing, 0.0, 0.0))
    m.gem(Vector((0.0, 0.1, 2.3)), 0.05)
    move(m, start, scale=0.92, offset=(0.0, 0.0, top + 0.1), turn=62.0)
    return m


def leafy_fox():
    """The leafy fox: a clipped topiary fox sitting up in a stone planter."""
    m = Model("leafy_fox")
    block(m, -0.82, 0.82, -0.82, 0.82, 0.0, 0.16, STONE, skip="b")
    block(m, -0.72, 0.72, -0.72, 0.72, 0.16, 0.56, ASHLAR)
    block(m, -0.8, 0.8, -0.8, 0.8, 0.56, 0.68, ASHLAR, shade=0.97, skip="b")
    with tinted(m, SOIL):
        block(m, -0.66, 0.66, -0.66, 0.66, 0.6, 0.7, ("band", "plaster", "x", 0.4), skip="b")
    z = 0.68
    with tinted(m, LEAF):
        blob(m, (0.0, 0.12, z + 0.62), 0.44, 0.64, sides=8, rings=3)  # the body, sitting up
        blob(m, (0.0, -0.1, z + 1.42), 0.3, 0.27, sides=8, rings=3)  # the head
        for side in (-1.0, 1.0):
            blob(m, (side * 0.3, 0.2, z + 0.3), 0.26, 0.3, sides=7, rings=2)  # haunches
    with tinted(m, LEAF_PALE):
        blob(m, (0.0, -0.22, z + 0.72), 0.26, 0.4, sides=7, rings=2)  # the pale chest
        # the muzzle, pointing forward
        m.lathe(Frame((0.0, -0.3, z + 1.36), (1, 0, 0), (0.0, -1.0, -0.12)), [(0.16, 0.0), (0.06, 0.3), (0.0, 0.34)], sides=6, skin=("band", "plaster", 0.6))
    with tinted(m, LEAF_DARK):
        for side in (-1.0, 1.0):
            # ears
            m.lathe(Frame((side * 0.17, -0.02, z + 1.6), (1, 0, 0), (side * 0.2, 0.0, 1.0)), [(0.11, 0.0), (0.0, 0.34)], sides=4, skin=("band", "plaster", 0.5), smooth=False)
            # front legs
            m.lathe(Frame((side * 0.15, -0.34, z), (1, 0, 0), UP, (0, 1, 0)), [(0.1, 0.0), (0.09, 0.5), (0.0, 0.58)], sides=6, skin=("band", "plaster", 0.5))
        # the brush, curled round one flank
        m.sweep([(0.34, 0.42, z + 0.16), (0.62, 0.18, z + 0.24), (0.66, -0.22, z + 0.3), (0.42, -0.52, z + 0.22)], [(0.2, 0.2), (0.3, 0.3), (0.26, 0.26), (0.08, 0.08)], "plaster", depth=0.6)
    with tinted(m, DARK):
        m.gem(Vector((0.0, -0.64, z + 1.33)), 0.045, band="plaster", stretch=0.8)
        for side in (-1.0, 1.0):
            m.gem(Vector((side * 0.13, -0.36, z + 1.5)), 0.035, band="plaster", stretch=0.8)
    return m


def stag_shrine():
    """The stag shrine: a round-headed stone on a stepped base, a gilt stag's head with its
    antlers spread across it, candles and an offering bowl below."""
    m = Model("stag_shrine")
    block(m, -2.0, 2.0, -1.5165, 1.5165, 0.0, 0.32, STONE, skip="b")
    block(m, -1.62, 1.62, -1.0, 1.36, 0.32, 0.6, ASHLAR)
    back = [(px, pz + 0.6) for px, pz in arch_outline(1.34, 1.5, 1.2)]
    # the standing stone, built with the kit's own outline cutter in pale stone
    from props import slab

    slab(m, back, 0.62, "ashlar", y=0.95)
    block(m, -0.86, 0.86, 0.58, 0.64, 0.86, 2.3, ("band", "plaster", "x", 1.5), shade=0.97)
    # the stag: a wedge of a head, gilt, with antlers branching to the top of the stone
    cutout(m, [(-0.2, 1.9), (0.2, 1.9), (0.13, 1.42), (0.0, 1.22), (-0.13, 1.42)], 0.2, "gilded", y=0.48)
    for side in (-1.0, 1.0):
        beam = [(side * 0.14, 0.46, 1.86), (side * 0.52, 0.44, 2.3), (side * 0.98, 0.44, 2.9), (side * 1.12, 0.46, 3.6), (side * 0.92, 0.48, 4.2)]
        m.sweep(beam, [(0.13, 0.13), (0.12, 0.12), (0.1, 0.1), (0.08, 0.08), (0.04, 0.04)], "gilded", depth=0.3)
        for (bx, bz), (tx, tz) in (((0.52, 2.3), (0.36, 2.86)), ((0.98, 2.9), (0.62, 3.5)), ((1.1, 3.4), (1.5, 3.86)), ((0.74, 2.6), (1.16, 2.5))):
            m.sweep([(side * bx, 0.45, bz), (side * tx, 0.45, tz)], [(0.09, 0.09), (0.03, 0.03)], "gilded", depth=0.25, caps=False)
        with tinted(m, DARK):
            m.gem(Vector((side * 0.09, 0.37, 1.72)), 0.035, band="plaster", stretch=0.8)
        # a low pier each side, a gilt stud on its head
        block(m, side * 1.74 - 0.2, side * 1.74 + 0.2, 0.7, 1.1, 0.32, 1.5, ASHLAR)
        m.gem(Vector((side * 1.74, 0.9, 1.62)), 0.12)
    for x, y, tall in ((-1.2, -0.4, 0.42), (-0.86, -0.7, 0.3), (1.2, -0.4, 0.42), (0.86, -0.7, 0.3), (-0.5, 0.1, 0.36), (0.5, 0.1, 0.36)):
        candle(m, x, y, 0.6, height=tall, r=0.06)
    m.lathe(Frame((0.0, -0.45, 0.6), (1, 0, 0), UP, (0, 1, 0)), [(0.16, 0.0), (0.12, 0.08), (0.36, 0.24), (0.3, 0.24), (0.0, 0.14)], sides=8, skin=("band", "gilded", 0.3))
    with tinted(m, LEAF):
        for x in (-1.5, 1.5):
            blob(m, (x, -1.0, 0.32), 0.34, 0.26, sides=6, rings=2, dome=True, flat=True)
    return m


def mushroom_house():
    """The pixie mushroom house: a fat cream stem under a spotted red cap, a little arched
    door, a lit round window and a step."""
    m = Model("mushroom_house")
    with tinted(m, (0.97, 0.93, 0.84)):
        m.lathe(WORLD, [(1.06, 0.0), (1.16, 0.55), (0.98, 1.5), (0.9, 2.3)], sides=10, skin=("band", "plaster", 2.3))
    with tinted(m, (0.8, 0.72, 0.6)):
        m.lathe(WORLD, [(0.9, 2.3), (1.66, 2.02)], sides=10, skin=("band", "plaster", 1.0), smooth=False)
    cap = [(1.66, 2.02), (1.6, 2.5), (1.24, 3.22), (0.62, 3.8), (0.0, 4.0)]
    with tinted(m, RED):
        m.lathe(WORLD, cap, sides=10, skin=("band", "plaster", 2.6))
    # pale spots, each a low dome set into the cap where the cap's own surface is
    rng = random.Random(7)
    for i in range(9):
        t = rng.uniform(0.12, 0.86)
        a = math.tau * i / 9 + rng.uniform(-0.2, 0.2)
        seg = min(int(t * (len(cap) - 1)), len(cap) - 2)
        f = t * (len(cap) - 1) - seg
        r = cap[seg][0] + (cap[seg + 1][0] - cap[seg][0]) * f
        z = cap[seg][1] + (cap[seg + 1][1] - cap[seg][1]) * f
        out = Vector((math.cos(a), math.sin(a), 0.75)).normalized()
        side = Vector((-math.sin(a), math.cos(a), 0.0))
        with tinted(m, LINEN):
            blob(m, (math.cos(a) * r * 0.97, math.sin(a) * r * 0.97, z), rng.uniform(0.16, 0.26), 0.07, sides=6, rings=2, axis=out, right=side, dome=True, flat=True)
    # the door, its frame and its knob
    cutout(m, [(px, pz) for px, pz in arch_outline(0.4, 0.8, 0.4)], 0.16, "planks", y=-1.1, depth=1.2)
    cutout(m, [(px * 1.22, pz * 1.08) for px, pz in arch_outline(0.4, 0.8, 0.4)], 0.1, "oak", y=-1.04, shade=0.8, depth=1.3)
    m.gem(Vector((0.24, -1.2, 0.62)), 0.05)
    block(m, -0.56, 0.56, -1.56, -1.06, 0.0, 0.13, STONE, skip="b")
    # the window: a lit pane in an oak ring, round the stem from the door
    a = math.radians(-28.0)
    out = Vector((math.cos(a), math.sin(a), 0.0))
    at = out * 1.03 + Vector((0.0, 0.0, 1.32))
    fr = Frame(at, (-math.sin(a), math.cos(a), 0.0), out)
    m.lathe(fr, [(0.25, 0.0), (0.0, 0.03)], sides=8, skin=("tile", "glass"), smooth=False)
    m.lathe(fr, [(0.33, -0.05), (0.33, 0.06), (0.24, 0.06)], sides=8, skin=("band", "oak", 0.2), smooth=False)
    # a few small ones at its foot
    for x, y, s in ((1.25, -0.85, 0.3), (1.5, -0.4, 0.2), (-1.3, -0.7, 0.24)):
        with tinted(m, (0.97, 0.93, 0.84)):
            m.lathe(Frame((x, y, 0.0), (1, 0, 0), UP, (0, 1, 0)), [(s * 0.3, 0.0), (s * 0.22, s)], sides=6, skin=("band", "plaster", 0.4))
        with tinted(m, RED):
            blob(m, (x, y, s), s * 0.7, s * 0.5, sides=7, rings=2, dome=True)
    return m


def mud_door(m, radius, tall=1.75):
    """A hut's doorway on its front (-Y): a dark mouth between driftwood posts under a lintel."""
    with tinted(m, DARK):
        cutout(m, arch_outline(0.62, tall - 0.6, 0.5), 0.1, "plaster", y=-radius - 0.03)
    with tinted(m, DRIFT):
        for side in (-1.0, 1.0):
            bar(m, (side * 0.74, -radius - 0.1, 0.0), (side * 0.66, -radius - 0.08, tall + 0.2), 0.09, band="oak", sides=6)
        bar(m, (-0.98, -radius - 0.1, tall + 0.12), (0.98, -radius - 0.1, tall + 0.22), 0.08, band="oak", sides=6)


def wall_frame(angle, radius, z):
    """A frame flat against a round wall: its right along the wall, its normal straight out."""
    a = math.radians(angle)
    return Frame((math.cos(a) * radius, math.sin(a) * radius, z), (-math.sin(a), math.cos(a), 0.0), UP)


def mudfin_hut(spire=False):
    """A mudfin hut: a round wall and a roof laid like an upturned boat in old strakes, a
    dark doorway, driftwood poles and a net. `spire` is the tall one with the bent top and
    the awning. The wall stands where the game's solid wall does (sim/mudfin_huts.ts)."""
    m = Model("mudfin_hut")
    # the strakes are the boats' own bright paint: weathered down to mud and old tar here
    m.tint = MUD
    if spire:
        wall, eave, top = 2.34, 2.45, 6.0
        m.lathe(WORLD, [(wall - 0.04, 0.0), (wall, 1.0), (wall - 0.2, 2.0)], sides=12, skin=("tile", "hull"), shade=0.9, phase=0.0)
        roof = [(eave, 1.78), (2.0, 2.7), (1.32, 3.7), (0.72, 4.6), (0.3, 5.4), (0.0, top)]
        leans = [(0.0, 0.0), (0.04, 0.0), (0.18, 0.04), (0.42, 0.08), (0.7, 0.1), (0.98, 0.1)]
        m.lathe(WORLD, roof, sides=12, skin=("tile", "hull"), lean=leans, phase=0.0)
        m.lathe(WORLD, [(wall - 0.2, 2.0), (eave, 1.78)], sides=12, skin=("band", "planks", 0.6), smooth=False, shade=0.6, phase=0.0)
        m.tint = (1.0, 1.0, 1.0)
        mud_door(m, wall, 1.8)
        # the awning over the door, on two poles
        with tinted(m, DRIFT):
            for side in (-1.0, 1.0):
                bar(m, (side * 1.0, -2.74, 0.0), (side * 0.96, -2.7, 1.86), 0.07, band="oak", sides=6)
        cloth = [(-1.2, -2.83, 1.74), (1.2, -2.83, 1.74), (1.2, -2.1, 2.26), (-1.2, -2.1, 2.26)]
        striped(m, cloth, 0.95, Vector((0.0, -0.4, 1.0)))
        striped(m, [(p[0], p[1], p[2] - 0.015) for p in cloth], 0.6, Vector((0.0, 0.4, -1.0)))
        # a drying rack behind, so the hut sits in the middle of its own footprint
        with tinted(m, DRIFT):
            for x in (-0.9, 0.9):
                bar(m, (x, 2.36, 0.0), (x * 0.92, 2.44, 1.7), 0.06, band="oak", sides=6)
            bar(m, (-1.1, 2.42, 1.56), (1.1, 2.42, 1.56), 0.05, band="oak", sides=6)
        m.net(Frame((0.0, 2.44, 1.56), (-1.0, 0.0, 0.0), UP), 1.6)
        poles = (((0.55, -0.1, 5.0), (1.3, 0.3, 5.95)), ((1.1, 0.3, 5.2), (0.7, -0.3, 5.9)))
    else:
        wall, eave, top = 2.31, 2.635, 4.75
        m.lathe(WORLD, [(wall - 0.04, 0.0), (wall + 0.04, 0.9), (wall - 0.14, 1.72)], sides=12, skin=("tile", "hull"), shade=0.9, phase=0.0)
        roof = [(eave, 1.5), (2.3, 2.24), (1.62, 3.14), (0.78, 3.86), (0.24, 4.22), (0.0, 4.28)]
        m.lathe(WORLD, roof, sides=12, skin=("tile", "hull"), phase=0.0)
        m.lathe(WORLD, [(wall - 0.14, 1.72), (eave, 1.5)], sides=12, skin=("band", "planks", 0.6), smooth=False, shade=0.6, phase=0.0)
        m.tint = (1.0, 1.0, 1.0)
        mud_door(m, wall + 0.04, 1.6)
        m.net(wall_frame(-38.0, wall + 0.06, 1.62), 1.7)
        poles = (((-0.5, 0.2, 3.7), (0.5, -0.24, top)), ((0.46, 0.3, 3.7), (-0.4, -0.2, 4.6)), ((0.0, -0.44, 3.7), (0.1, 0.5, 4.66)))
    with tinted(m, DRIFT):
        for a, b in poles:
            bar(m, a, b, 0.06, band="oak", sides=5)
        # spears and a paddle leaning on the wall
        for angle in (() if spire else (128.0, 142.0, 222.0)):
            a = math.radians(angle)
            bar(m, (math.cos(a) * (wall + 0.2), math.sin(a) * (wall + 0.2), 0.0), (math.cos(a) * (wall + 0.03), math.sin(a) * (wall + 0.03), 2.3), 0.045, band="oak", sides=5)
    # stones at the foot of the wall, kept inside the eaves so the fit never shrinks the wall
    for i in range(0 if spire else 7):
        a = math.radians(40.0 + i * 47.0)
        if abs(math.sin(a) + 1.0) < 0.3:
            continue
        rock(m, (math.cos(a) * (wall - 0.04), math.sin(a) * (wall - 0.04), 0.0), 0.2 + 0.02 * (i % 3), 0.3 + 0.05 * (i % 2), sides=5, seed=20 + i)
    return m


# -- crystals -----------------------------------------------------------------------------------


def amethyst_cluster():
    """An amethyst cluster: one tall spire and its lesser points breaking out of a rock."""
    m = Model("amethyst_cluster")
    rock(m, (0.0, 0.0, 0.0), 1.9, 1.0, sides=7, seed=1)
    rock(m, (1.0, -0.7, 0.0), 0.9, 0.7, sides=5, seed=2)
    crystal(m, (0.0, 0.0, 0.3), (0.25, 0.1, 6.0), 0.78, AMETHYST)
    specs = [(30, 0.8, 0.34, 4.2, 0.56), (112, 0.9, 0.4, 3.5, 0.5), (200, 0.8, 0.36, 4.5, 0.6), (286, 1.0, 0.5, 3.1, 0.46), (338, 1.1, 0.62, 2.3, 0.4), (158, 1.2, 0.66, 2.1, 0.36), (74, 1.3, 0.8, 1.7, 0.3), (244, 1.2, 0.74, 1.9, 0.32)]
    spray(m, (0.0, 0.0, 0.2), specs, (AMETHYST_DEEP, AMETHYST_PALE, AMETHYST), seed=3)
    return m


def cave_mouth(m, y, width, tall):
    """A cave mouth on a mound's front: a dark opening between rough stone jambs."""
    with tinted(m, DARK):
        cutout(m, arch_outline(width / 2, tall * 0.6, tall * 0.4), 0.3, "plaster", y=y)
    for side in (-1.0, 1.0):
        rock(m, (side * (width / 2 + width * 0.16), y - 0.1, 0.0), width * 0.3, tall * 0.86, sides=5, seed=40 + int(side))
    rock(m, (0.0, y + 0.2, tall * 0.92), width * 0.66, tall * 0.34, sides=6, seed=44, squash=0.6)


def crystal_mound():
    """The crystal mound: a great heap of rock with a cave mouth in its face and a crown of
    amethyst, the tallest spire standing eleven yards."""
    m = Model("crystal_mound")
    rock(m, (0.0, 0.3, 0.0), 5.0, 5.4, sides=7, seed=5, lean=(0.4, 0.3))
    rock(m, (-2.9, 1.2, 0.0), 2.7, 4.4, sides=6, seed=6, lean=(-0.5, 0.2))
    rock(m, (3.0, 0.8, 0.0), 2.6, 3.7, sides=6, seed=7, lean=(0.5, 0.0))
    rock(m, (-3.4, -2.2, 0.0), 2.1, 2.6, sides=5, seed=31, lean=(-0.3, -0.2))
    rock(m, (3.5, -2.4, 0.0), 2.0, 2.2, sides=5, seed=32, lean=(0.3, -0.2))
    rock(m, (0.6, 3.6, 0.0), 2.3, 3.0, sides=6, seed=33, lean=(0.0, 0.4))
    cave_mouth(m, -4.5, 2.6, 3.0)
    crystal(m, (0.0, 0.3, 3.6), (0.5, 0.2, 11.0), 1.3, AMETHYST)
    specs = [(20, 1.6, 0.4, 5.4, 0.9), (95, 1.8, 0.5, 4.4, 0.8), (170, 1.7, 0.46, 5.0, 0.86), (250, 2.0, 0.6, 3.8, 0.7), (310, 2.2, 0.7, 3.4, 0.64), (135, 3.0, 0.9, 2.8, 0.56), (52, 3.1, 0.95, 2.6, 0.5), (215, 3.2, 1.0, 2.6, 0.5)]
    spray(m, (0.0, 0.2, 3.2), specs, (AMETHYST_DEEP, AMETHYST_PALE, AMETHYST), seed=8)
    spray(m, (0.0, -3.6, 1.2), [(238, 2.2, 0.6, 2.2, 0.4), (302, 2.2, 0.6, 2.4, 0.42)], (AMETHYST_PALE, AMETHYST), base=2.2, seed=9)
    return m


def star_heart():
    """The star heart: a wide burst of pale blue crystal, long points to the four quarters
    and shorter ones between, round a tall heart."""
    m = Model("star_heart")
    rock(m, (0.0, 0.0, 0.0), 2.7, 0.9, sides=8, seed=11)
    crystal(m, (0.0, 0.0, 0.3), (0.0, 0.0, 5.5), 1.0, STAR[2])
    for i in range(8):
        a = math.tau * i / 8
        long_ = i % 2 == 0
        reach, lift, r = (4.6, 2.5, 0.66) if long_ else (3.3, 3.2, 0.52)
        foot = Vector((math.cos(a) * 0.7, math.sin(a) * 0.7, 0.5))
        crystal(m, foot, (math.cos(a) * reach, math.sin(a) * reach, lift), r, STAR[i % 2], turn=0.3 * i)
    spray(m, (0.0, 0.0, 0.5), [(22, 0.5, 0.4, 3.6, 0.42), (112, 0.5, 0.4, 3.9, 0.44), (202, 0.5, 0.42, 3.5, 0.4), (292, 0.5, 0.38, 3.8, 0.42)], STAR, seed=12)
    return m


def gate_mound():
    """The Hollow's crystal gate: a rock mound a traveller walks into, a dark mouth in its
    face and amethyst breaking through its crown. Authored ten yards wide and fitted to the
    old mound's bounds, which the gate's fade and footprint are measured from."""
    m = Model("gate_mound")
    rock(m, (0.0, 0.3, 0.0), 4.4, 5.0, sides=7, seed=15, lean=(-0.3, 0.3))
    rock(m, (-2.6, 1.0, 0.0), 2.4, 3.9, sides=6, seed=16, lean=(-0.4, 0.1))
    rock(m, (2.7, 0.7, 0.0), 2.3, 3.3, sides=6, seed=17, lean=(0.4, 0.0))
    rock(m, (-3.0, -1.9, 0.0), 1.8, 2.3, sides=5, seed=34, lean=(-0.2, -0.2))
    rock(m, (3.1, -2.0, 0.0), 1.7, 2.0, sides=5, seed=35, lean=(0.2, -0.2))
    rock(m, (0.4, 3.0, 0.0), 2.0, 2.7, sides=6, seed=36, lean=(0.0, 0.3))
    cave_mouth(m, -3.9, 2.5, 2.9)
    crystal(m, (0.2, 0.4, 3.6), (0.5, 0.3, 6.9), 0.8, AMETHYST)
    specs = [(40, 1.4, 0.5, 2.8, 0.56), (130, 1.5, 0.6, 2.5, 0.5), (220, 1.5, 0.55, 2.7, 0.52), (300, 1.6, 0.7, 2.3, 0.46), (80, 2.6, 0.9, 2.0, 0.4), (180, 2.7, 0.95, 1.9, 0.4)]
    spray(m, (0.0, 0.2, 3.2), specs, (AMETHYST_DEEP, AMETHYST_PALE, AMETHYST), seed=18)
    spray(m, (0.0, -3.1, 1.0), [(236, 2.0, 0.6, 1.9, 0.34), (304, 2.0, 0.6, 2.0, 0.36)], (AMETHYST_PALE, AMETHYST), base=2.0, seed=19)
    return m


# -- planted things and rocks ---------------------------------------------------------------------


def flower_bed(kind="a"):
    """A planted bed: a stone kerb, dark soil, low green mounds and bright flowers. `round`
    stands a clipped shrub in its middle."""
    m = Model("flower_bed_" + kind)
    if kind == "round":
        m.lathe(WORLD, [(2.0, 0.0), (2.0, 0.42), (1.74, 0.42), (1.74, 0.3)], sides=10, skin=STONE, smooth=False)
        with tinted(m, SOIL):
            m.lathe(WORLD, [(1.74, 0.3), (0.0, 0.36)], sides=10, skin=("band", "plaster", 1.0), smooth=False)
        with tinted(m, LEAF_DARK):
            blob(m, (0.0, 0.0, 1.05), 0.74, 0.74, sides=8, rings=3)
        with tinted(m, LEAF):
            blob(m, (0.0, 0.0, 1.78), 0.4, 0.4, sides=7, rings=2)
        for i in range(5):
            a = math.tau * i / 5 + 0.3
            bloom(m, math.cos(a) * 0.7, math.sin(a) * 0.7, 1.2 + 0.2 * (i % 2), 0.12, BLOOMS[i % 5])
        ring = [(math.cos(math.tau * i / 7) * 1.18, math.sin(math.tau * i / 7) * 1.18, 0.3, 0.4 + 0.06 * (i % 2)) for i in range(7)]
        planting(m, ring, seed=3)
        return m
    block(m, -2.0, 2.0, -2.0, 2.0, 0.0, 0.34, STONE, skip="b")
    with tinted(m, SOIL):
        block(m, -1.74, 1.74, -1.74, 1.74, 0.3, 0.37, ("band", "plaster", "x", 1.0), skip="b")
    if kind == "a":
        spots = [(-1.05, -1.05, 0.34, 0.5), (1.05, -1.05, 0.34, 0.5), (-1.05, 1.05, 0.34, 0.5), (1.05, 1.05, 0.34, 0.5), (0.0, 0.0, 0.34, 0.62), (0.0, -1.2, 0.34, 0.36), (0.0, 1.2, 0.34, 0.36), (-1.2, 0.0, 0.34, 0.36), (1.2, 0.0, 0.34, 0.36)]
    else:
        # rows, like a kitchen border
        spots = [(-1.2 + 0.8 * i, -1.1 + 1.1 * j, 0.34, 0.4 if (i + j) % 2 else 0.46) for i in range(4) for j in range(3)]
    planting(m, spots, seed=1 if kind == "a" else 2)
    return m


def shrub():
    """A flowering shrub: a clump of clipped green with blossom over it."""
    m = Model("shrub")
    masses = [(0.0, 0.0, 0.62, 0.82, LEAF), (-0.78, 0.2, 0.46, 0.6, LEAF_DARK), (0.76, -0.18, 0.5, 0.64, LEAF_DARK), (0.1, -0.72, 0.42, 0.52, LEAF_PALE), (-0.16, 0.74, 0.44, 0.54, LEAF)]
    rng = random.Random(4)
    for i, (x, y, z, r, colour) in enumerate(masses):
        with tinted(m, colour):
            blob(m, (x, y, z), r, r * 0.8, sides=7, rings=3, flat=True)
        for k in range(4):
            a = rng.uniform(0.0, math.tau)
            lift = rng.uniform(0.25, 0.8)
            d = r * math.sqrt(max(0.0, 1.0 - lift * lift)) * 0.96
            bloom(m, x + math.cos(a) * d, y + math.sin(a) * d, z + r * 0.8 * lift - 0.04, 0.1, (PINK, LINEN, PINK, VIOLET)[(i + k) % 4])
    return m


def ore_rocks():
    """A scatter of ore: low nuggets on the ground. They keep the old material's name, so the
    game's own copper finish for ore still lands on them."""
    m = Model("ore_rocks")
    for i, (x, y, r, h) in enumerate(((0.0, 0.0, 0.62, 0.78), (0.95, 0.5, 0.42, 0.5), (-0.85, 0.62, 0.46, 0.56), (0.6, -0.8, 0.36, 0.44), (-0.7, -0.6, 0.4, 0.48), (1.3, -0.3, 0.26, 0.3))):
        rock(m, (x, y, 0.0), r, h, sides=5, seed=60 + i)
    return m


def boulders(kind):
    """A mine's rocks: faceted boulders leaned and stacked. A boulder is one stone, so it
    wears the plain plaster under a cool grey, never the coursed house stone (which reads
    as a built wall on a lump this size); the flat facets carry its form."""
    m = Model("boulders_" + kind)
    plain = ("band", "plaster", 3.0)

    def lump(c, r, h, tone, **more):
        with tinted(m, tone):
            rock(m, c, r, h, skin=plain, **more)

    grey, slate, pale = (0.5, 0.53, 0.6), (0.4, 0.43, 0.52), (0.6, 0.62, 0.66)
    if kind == "tall_a":
        lump((0.3, 0.0, 0.0), 1.5, 4.0, grey, sides=6, seed=70, lean=(0.3, 0.1), squash=0.8)
        lump((-1.0, 0.2, 0.0), 1.05, 2.5, slate, sides=5, seed=71, lean=(-0.2, 0.0), squash=0.8)
        lump((1.3, -0.5, 0.0), 0.6, 1.1, pale, sides=5, seed=72)
    elif kind == "tall_h":
        lump((0.0, 0.1, 0.0), 1.1, 2.85, grey, sides=6, seed=73, lean=(0.16, -0.12))
        lump((-0.5, -0.8, 0.0), 0.56, 1.0, slate, sides=5, seed=74)
    elif kind == "large_d":
        lump((0.0, 0.0, 0.0), 1.9, 2.3, grey, sides=7, seed=75)
        lump((-1.5, -0.9, 0.0), 0.8, 1.0, pale, sides=5, seed=76)
        lump((1.4, 1.1, 0.0), 0.74, 0.9, slate, sides=5, seed=77)
    else:
        lump((0.0, 0.0, 0.0), 2.0, 1.9, slate, sides=7, seed=78, squash=0.82)
        lump((1.5, 0.6, 0.0), 0.84, 0.9, grey, sides=5, seed=79)
        lump((-1.4, -0.7, 0.0), 0.62, 0.7, pale, sides=5, seed=80)
    return m


def palm(width, height, depth, cx, cy, seed=0):
    """A palm: a curved, ringed trunk and a crown of arched fronds. The old models stand
    their trunk foot on the model's own origin and lean their crown off it, and the game
    plants trunks (and their colliders) by that origin: `cx`, `cy` are how far the old
    crown's middle sat from the foot, so this one leans the same way and the fit lands its
    foot back on the origin. Authored three times the old size, like the game draws it."""
    m = Model("palm")
    k = 3.0
    rng = random.Random(seed)
    radius = min(width, depth) * k / 2
    top = height * k
    crown = Vector((cx * k, cy * k, top * 0.8))
    foot = Vector((0.0, 0.0, 0.0))
    # the trunk: a bow from the foot to the crown, thicker at the foot
    bow = Vector((crown.x * 0.2, crown.y * 0.2, 0.0)) - Vector((crown.x, crown.y, 0.0)) * 0.35
    pts, sizes = [], []
    for i in range(6):
        t = i / 5
        p = foot.lerp(crown, t) + bow * math.sin(math.pi * t)
        pts.append(p)
        w = 0.62 - 0.26 * t
        sizes.append((w, w))
    with tinted(m, (0.78, 0.66, 0.5)):
        m.sweep(pts, sizes, "oak", depth=0.5)
    with tinted(m, (0.5, 0.4, 0.3)):
        for i in range(1, 5):
            p = pts[i]
            w = sizes[i][0] * 0.62
            m.lathe(Frame(p, (1, 0, 0), (pts[i + 1] - pts[i - 1]).normalized()), [(w, -0.06), (w * 1.06, 0.0), (w, 0.06)], sides=6, skin=("band", "plaster", 0.3), smooth=False)
    # the fronds: each a folded leaf arching out and drooping, tallest at the bbox's top
    count = 13
    for i in range(count):
        a = math.tau * i / count + rng.uniform(-0.1, 0.1)
        upper = i % 2 == 0
        reach = radius * (rng.uniform(0.78, 0.88) if upper else rng.uniform(0.94, 1.0))
        rise = (top - crown.z) * (rng.uniform(0.9, 1.0) if upper else rng.uniform(0.4, 0.6))
        droop = top * (rng.uniform(0.1, 0.16) if upper else rng.uniform(0.3, 0.4))
        out = Vector((math.cos(a), math.sin(a), 0.0))
        side = Vector((-math.sin(a), math.cos(a), 0.0))
        spine, halfw = [], []
        segs = 5
        for s in range(segs + 1):
            t = s / segs
            z = crown.z + rise * math.sin(math.pi * min(1.0, t * 1.25)) * (1.0 - 0.3 * t) - droop * t * t
            spine.append(crown + out * reach * t + Vector((0.0, 0.0, z - crown.z)))
            halfw.append(radius * 0.13 * math.sin(math.pi * (0.1 + 0.9 * t)) ** 0.7 if t < 1.0 else 0.0)
        colour = (LEAF, LEAF_DARK, LEAF_PALE)[i % 3]
        with tinted(m, colour):
            for s in range(segs):
                a0, a1 = spine[s], spine[s + 1]
                fold = Vector((0.0, 0.0, -1.0))
                for sign in (-1.0, 1.0):
                    quad = [a0, a1, a1 + side * sign * halfw[s + 1] + fold * halfw[s + 1] * 0.45, a0 + side * sign * halfw[s] + fold * halfw[s] * 0.45]
                    uvs = [uv_band("plaster", s * 0.5, 0.25, 1.0), uv_band("plaster", s * 0.5 + 0.5, 0.25, 1.0), uv_band("plaster", s * 0.5 + 0.5, 0.75, 1.0), uv_band("plaster", s * 0.5, 0.75, 1.0)]
                    if halfw[s + 1] == 0.0:
                        quad, uvs = [quad[0], quad[1], quad[3]], [uvs[0], uvs[1], uvs[3]]
                    m.face(quad, uvs, "trim", 1.0 if sign > 0 else 0.86, Vector((0.0, 0.0, 1.0)) + side * sign * 0.3)
                    m.face([q - Vector((0.0, 0.0, 0.012)) for q in quad], uvs, "trim", 0.56, Vector((0.0, 0.0, -1.0)) - side * sign * 0.3)
    # coconuts under the crown
    with tinted(m, (0.42, 0.3, 0.2)):
        for i in range(3):
            a = math.tau * i / 3 + 0.5
            blob(m, crown + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -0.34)), 0.2, 0.22, sides=6, rings=2)
    return m


# -- the Realm Builder monument -------------------------------------------------------------------
#
# Eastbrook's centrepiece is drawn by its own code (src/render/realm_builder_monument_fx.ts),
# which reads four things off the file, all kept here:
#   - its bounds: the effects scale from the size in realm_builder_monument_fx_core.ts, so the
#     model is authored in yards at the size it stands in the square (7.6 high) and brought
#     down by exactly that factor;
#   - the two honour plates and the four lantern flames, at the points the same file lists,
#     because the honouree's name is projected off the plates and the glow sits on the flames;
#   - two material names: the flame cores (no shadow) and the gilt tools (the gold pulse and
#     the glints). Everything gilt on it is therefore a tool: the hammer and the tablet;
#   - six sockets, each tagged with the id the monument's test looks up (patch_monument).
MONUMENT_SIZE = (0.755235, 0.991974, 0.702649)  # the file's x, y (up), z
MONUMENT_K = 7.6 / MONUMENT_SIZE[1]
# (x, y up, z) in the file's own space, as realm_builder_monument_fx_core.ts lists them
MONUMENT_POINTS = {
    "Socket_PlaqueFront": ("plaque-front", (0.005804, 0.113437, 0.270204)),
    "Socket_PlaqueBack": ("plaque-back", (0.002776, 0.113437, -0.289506)),
    "Socket_Lantern1": ("lantern-1", (-0.337989, 0.112617, 0.151826)),
    "Socket_Lantern2": ("lantern-2", (0.335273, 0.112559, 0.144209)),
    "Socket_Lantern3": ("lantern-3", (0.331369, 0.112559, -0.19133)),
    "Socket_Lantern4": ("lantern-4", (-0.331968, 0.112617, -0.183852)),
}


# A smooth patch inside one stone of the pale ashlar paint (measured off the built texture:
# the calmest bright window in it). A statue's surfaces are drawn in to it, so the figure
# reads as one carved block: coursed masonry across a face or a sleeve reads as a wall.
CARVED_AT = (0.668, 0.6953)
CARVED_SPAN = 0.04


def carved(m, first_face):
    """Every ashlar face built since `first_face` becomes carved stone (see CARVED_AT)."""
    stone = m._mat("ashlar")
    m.bm.faces.ensure_lookup_table()
    for f in list(m.bm.faces)[first_face:]:
        if f.material_index != stone:
            continue
        for loop in f.loops:
            uv = loop[m.uv].uv
            loop[m.uv].uv = (CARVED_AT[0] + (uv.x % 1.0 - 0.5) * CARVED_SPAN, CARVED_AT[1] + (uv.y % 1.0 - 0.5) * CARVED_SPAN)


def frustum(m, lo, hi, z0, z1, mat="ashlar", shade=1.0):
    """A battered block: the rectangle lo (x0, x1, y0, y1) at z0 drawn in to hi at z1."""
    a = [Vector((lo[0], lo[2], z0)), Vector((lo[1], lo[2], z0)), Vector((lo[1], lo[3], z0)), Vector((lo[0], lo[3], z0))]
    b = [Vector((hi[0], hi[2], z1)), Vector((hi[1], hi[2], z1)), Vector((hi[1], hi[3], z1)), Vector((hi[0], hi[3], z1))]
    cx, cy = (lo[0] + lo[1]) / 2, (lo[2] + lo[3]) / 2
    for i in range(4):
        j = (i + 1) % 4
        width, slant = (a[j] - a[i]).length, (b[i] - a[i]).length
        uvs = [uv_tile(mat, 0.0, 0.0), uv_tile(mat, width, 0.0), uv_tile(mat, width, slant), uv_tile(mat, 0.0, slant)]
        out = Vector(((a[i].x + a[j].x) / 2 - cx, (a[i].y + a[j].y) / 2 - cy, 0.2))
        m.face([a[i], a[j], b[j], b[i]], uvs, mat, shade * (0.88 if i % 2 else 1.0), out)
    m.face(b, [uv_tile(mat, p.x, p.y) for p in b], mat, shade, (0.0, 0.0, 1.0))


def limb(m, a, b, r0, r1, skin=ASHLAR, sides=6):
    """A stone limb from a to b, closed at both ends."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    u = axis.normalized()
    side = u.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-4:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    m.lathe(Frame(a, side, u, side.cross(u)), [(0.0, 0.0), (r0, 0.0), (r1, axis.length), (0.0, axis.length)], sides=sides, skin=skin)


def realm_builder_monument():
    """The Realm Builder: a hooded mason in pale stone on a battered plinth, a gilt hammer
    raised in one hand and a gilt tablet in the other arm, a dark honour plate front and
    back, and a stone lantern on each of the plinth's four outriggers."""
    m = Model("realm_builder_monument")
    k = MONUMENT_K
    hx, hy = MONUMENT_SIZE[0] / 2 * k, MONUMENT_SIZE[2] / 2 * k

    def yards(point):
        # the file's (x, y up, z) to this builder's yards (x, y back, z up)
        return Vector((point[0] * k, -point[2] * k, point[1] * k))

    front, back = yards(MONUMENT_POINTS["Socket_PlaqueFront"][1]), yards(MONUMENT_POINTS["Socket_PlaqueBack"][1])
    lean = 0.2237  # the plates lean back 12.6 degrees, as the effect's own normals say
    z0, z1 = 0.3, 1.45
    # the leaning course's front and back faces pass through the two plate anchors
    f0, f1 = front.y + lean * (z0 - front.z), front.y + lean * (z1 - front.z)
    b0, b1 = back.y - lean * (z0 - back.z), back.y - lean * (z1 - back.z)
    # the ground slab measures the whole footprint, so the file's bounds are exactly the old ones
    block(m, -hx, hx, -hy, hy, 0.0, z0, STONE, skip="b")
    frustum(m, (-2.05, 2.05, f0, b0), (-1.8, 1.8, f1, b1), z0, z1)
    cy = (f1 + b1) / 2
    block(m, -1.5, 1.5, cy - 1.5, cy + 1.5, z1, 2.25, ASHLAR)
    block(m, -1.68, 1.68, cy - 1.68, cy + 1.68, 2.25, 2.5, ASHLAR, shade=0.97)
    # the honour plates: dark slate set on the leaning course, centred on the effect's anchors
    for anchor, sign in ((front, -1.0), (back, 1.0)):
        quad = []
        for dx, z in ((-1.15, 0.5), (1.15, 0.5), (1.15, 1.24), (-1.15, 1.24)):
            y = anchor.y + sign * lean * (z - anchor.z) * -1.0 + sign * 0.03
            quad.append((anchor.x + dx, y, z))
        m.face(quad, [uv_tile("slate", q[0], q[2]) for q in quad], "slate", 0.8, (0.0, sign, 0.25))
    # the four stone lanterns, each flame on its own anchor
    for name in ("Socket_Lantern1", "Socket_Lantern2", "Socket_Lantern3", "Socket_Lantern4"):
        at = yards(MONUMENT_POINTS[name][1])
        block(m, at.x - 0.3, at.x + 0.3, at.y - 0.3, at.y + 0.3, z0, 0.62, ASHLAR)
        for dx in (-0.22, 0.22):
            for dy in (-0.22, 0.22):
                block(m, at.x + dx - 0.035, at.x + dx + 0.035, at.y + dy - 0.035, at.y + dy + 0.035, 0.62, 1.1, STONE)
        m.lathe(Frame((at.x, at.y, 1.1), (1, 0, 0), UP, (0, 1, 0)), [(0.38, 0.0), (0.38, 0.06), (0.0, 0.36)], sides=4, skin=("tile", "slate"), smooth=False)
        m.lathe(Frame((at.x, at.y, at.z - 0.18), (1, 0, 0), UP, (0, 1, 0)), [(0.0, 0.0), (0.12, 0.13), (0.08, 0.25), (0.0, 0.36)], sides=6, skin=("tile", "glass"))
    # the mason: robe, shoulders and hood
    figure = len(m.bm.faces)
    body = Frame((0.0, cy, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(body, [(1.0, 2.5), (0.84, 3.3), (0.64, 4.5), (0.74, 5.05)], sides=8, skin=ASHLAR)
    m.lathe(body, [(0.74, 5.05), (0.8, 5.45), (0.52, 5.85), (0.3, 5.95)], sides=8, skin=ASHLAR, shade=0.97)
    hood = Frame((0.0, cy - 0.08, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(hood, [(0.3, 5.9), (0.44, 6.15), (0.42, 6.5), (0.24, 6.8), (0.0, 6.9)], sides=8, skin=ASHLAR)
    fy = cy - 0.08 - 0.43 * math.cos(math.radians(22.5)) - 0.02
    face = [(-0.17, fy, 6.1), (0.17, fy, 6.1), (0.17, fy, 6.46), (0.0, fy, 6.56), (-0.17, fy, 6.46)]
    m.face(face, [uv_tile("slate", q[0], q[2]) for q in face], "slate", 0.5, (0.0, -1.0, 0.0))
    # one arm raises the hammer, the other holds the tablet to the chest
    limb(m, (0.62, cy - 0.05, 5.5), (1.0, cy - 0.3, 5.15), 0.2, 0.17)
    limb(m, (1.0, cy - 0.3, 5.15), (1.05, cy - 0.45, 5.8), 0.17, 0.14)
    limb(m, (-0.62, cy - 0.05, 5.5), (-0.86, cy - 0.5, 4.9), 0.2, 0.17)
    limb(m, (-0.86, cy - 0.5, 4.9), (-0.42, cy - 0.82, 4.86), 0.17, 0.14)
    carved(m, figure)
    bar(m, (1.05, cy - 0.45, 5.3), (1.05, cy - 0.45, 7.2), 0.06, band="gilded", sides=6)
    block(m, 0.83, 1.27, cy - 0.95, cy + 0.05, 7.15, 7.6, ("band", "gilded", "y", 0.45))
    cutout(m, [(-0.95, 4.75), (-0.05, 4.75), (-0.05, 5.95), (-0.2, 6.1), (-0.8, 6.1), (-0.95, 5.95)], 0.12, "gilded", y=cy - 0.9)
    for v in m.bm.verts:
        v.co = v.co / k
    m.sockets = {name: (point[0], -point[2], point[1]) for name, (_id, point) in MONUMENT_POINTS.items()}
    m.sockets["Socket_CivicCenter"] = (0.0, 0.0, 0.0)
    return m


def patch_monument(path):
    """Tags the monument's socket nodes with the ids its test and effects look up
    (extras.sculptSocket.id), which the kit's plain sockets do not carry. build_props.py
    calls a spec's `post` with the written file's path once it has one."""
    import json
    import struct

    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20 : 20 + json_len])
    rest = data[20 + json_len :]
    for node in doc.get("nodes", []):
        found = MONUMENT_POINTS.get(node.get("name", ""))
        if found:
            node.setdefault("extras", {})["sculptSocket"] = {"id": found[0]}
    body = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    body += b" " * ((4 - len(body) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(body) + len(rest)))
        f.write(struct.pack("<II", len(body), 0x4E4F534A))
        f.write(body)
        f.write(rest)


# The old palms' sizes and how far each crown's middle sat from its trunk foot (x, and
# Blender y, which is the file's -z), read off the release models.
PALMS = {
    "1": (2.6364, 2.6853, 2.5778, 0.7148, -0.0404),
    "2": (2.8628, 2.6887, 2.7534, 0.2318, 0.2423),
    "3": (2.6098, 3.5874, 2.5183, 0.3631, 0.1397),
}

HERO_PROPS = {
    # NOT built: the release piece stays. A rebuild was tried in the game and the sculpted
    # original looked better.
    # "props/golden_horse_statue": dict(make=lambda: horse_statue(False), fit="inside"),
    "biome/dungeon_statue_horse": dict(make=lambda: horse_statue(True), fit="inside"),
    "props/ship_monument": dict(make=ship_monument, fit="inside"),
    # NOT built: the release piece stays. A rebuild was tried in the game and the sculpted
    # original looked better.
    # "props/leafy_fox_statue": dict(make=leafy_fox, fit="inside"),
    # "props/stag_shrine": dict(make=stag_shrine),
    # "props/pixie_mushroom_house": dict(make=mushroom_house),
    # NOT built: the release piece stays. The art lead's thatched mud huts were stood beside
    # these upturned hulls in the game and are plainly the better art: bright, crooked, of
    # the marsh.
    # "props/mudfin_hut_a": dict(make=lambda: mudfin_hut(False)),
    # "props/mudfin_hut_b": dict(make=lambda: mudfin_hut(True)),
    # NOT built: the release piece stays. A rebuild was tried in the game and the sculpted
    # original looked better.
    # "props/crystal_amethyst_cluster": dict(make=amethyst_cluster),
    # NOT built: the release piece stays. The Veiled Hollow's own pieces are
    # tuned to its pink light: the pale kit crystals washed out beside the
    # dark veined originals.
    # "props/crystal_mound_cave": dict(make=crystal_mound),
    # "props/star_heart_crystal": dict(make=star_heart),
    # "props/hollow_gate_crystal": dict(make=gate_mound),
    "props/flower_bed_round": dict(make=lambda: flower_bed("round"), fit="inside"),
    "props/flower_bed_square_a": dict(make=lambda: flower_bed("a"), fit="inside"),
    "props/flower_bed_square_b": dict(make=lambda: flower_bed("b"), fit="inside"),
    "props/shrub_flowering": dict(make=shrub, fit="inside"),
    "props/ore_rocks": dict(make=ore_rocks, rename={"eh_stone": "Stone_Dark"}),
    "props/rock_tall_a": dict(make=lambda: boulders("tall_a")),
    "props/rock_tall_h": dict(make=lambda: boulders("tall_h")),
    "props/rock_large_d": dict(make=lambda: boulders("large_d")),
    "props/rock_large_f": dict(make=lambda: boulders("large_f")),
    # authored at its exact size (no fit); `post` tags its sockets once build_props.py runs it
    # NOT built: Eastbrook's realm builder monument keeps the release sculpture. The hand-built
    # mason below was tried in the square and looked worse than the sculpted figure with its
    # face and hands. A statue is the one thing the kit's lathes and boxes cannot carve.
    # realm_builder_monument() stays for whoever sculpts a new one (its far impostor would
    # have to be baked again for it).
    # "props/eastbrook_realm_builder_monument": dict(make=realm_builder_monument, fit=False, rename={"eh_glass": "MonumentFlame", "eh_trim": "MonumentTools"}, post=patch_monument),
}
# NOT built: the release palms stay. They are part of the foliage, which this kit leaves alone,
# and the kit's palm (716 triangles of folded fronds) could not be thinned to the far model the
# game's scenery LOD builder asks for (scripts/assets/scenery_lod_build.mjs wants under 40% of
# the near mesh; these stopped at 60%), where the release palms drop to about 200 triangles.
# palm() and PALMS stay for whoever wants one near a camera.
# for _n, _spec in PALMS.items():
#     HERO_PROPS["biome/beach_palm_%s" % _n] = dict(make=lambda spec=_spec, n=_n: palm(*spec, seed=int(n)), fit="inside")
