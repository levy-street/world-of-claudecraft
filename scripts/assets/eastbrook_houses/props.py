# The harbour props: one new model for each small thing the towns, camps and quays stand
# (wells, stalls, fences, fires, crates, boats, gravestones, lamps), built from the same kit
# and the same paintings as the houses. Each replaces a release model AT ITS OWN PATH, so
# every place in the world that stands that prop shows the new one; build_props.py fits each
# to the old model's bounds, so the size rules and colliders the game keeps still hold.
#
# Sizes here are yards as drawn. The front is on -Y (it leaves as glTF +Z, the game's "front").
import math

from kit import UP, Frame, Model, uv_band, uv_tile
from mathutils import Vector

IRON = (0.2, 0.2, 0.23)
TAR = (0.24, 0.17, 0.13)
CANVAS = (0.96, 0.9, 0.76)
ROPE = (0.78, 0.64, 0.42)
WATER = (0.1, 0.3, 0.36)
ASH = (0.2, 0.18, 0.17)


class tinted:
    """Everything built inside takes a colour through its vertex colours."""

    def __init__(self, m, colour):
        self.m, self.colour = m, colour

    def __enter__(self):
        self.before = self.m.tint
        self.m.tint = self.colour

    def __exit__(self, *_):
        self.m.tint = self.before


def bar(m, a, b, r, band="oak", sides=8, r1=None, shade=1.0, caps=True, depth=None):
    """A round bar from a to b (a log, a pole, an oar's loom)."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    length = axis.length
    u = axis.normalized()
    side = u.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-4:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    fr = Frame(a, side, u, side.cross(u))
    end = r if r1 is None else r1
    skin = ("band", band, depth or max(r * 5.0, 0.2))
    m.lathe(fr, [(r, 0.0), (end, length)], sides=sides, skin=skin, shade=shade)
    if caps:
        m.lathe(fr, [(0.0, 0.0), (r, 0.0)], sides=sides, skin=skin, smooth=False, shade=shade * 0.8)
        m.lathe(fr, [(end, length), (0.0, length)], sides=sides, skin=skin, smooth=False, shade=shade * 0.9)


def post(m, x, y, z0, z1, size=0.18, band="oak", cap=True, shade=1.0):
    """A square timber post, a gilded stud on its head."""
    m.sweep([(x, y, z0), (x, y, z1)], (size, size), band, depth=size * 2.2, caps=True, shade=shade)
    if cap:
        m.gem(Vector((x, y, z1 + size * 0.45)), size * 0.5)


def slab(m, outline, thick, mat="stone", y=0.0, shade=1.0):
    """A standing stone cut to an outline [(x, z)] (anticlockwise seen from the front), its
    front on -Y, `thick` deep."""
    front = [(px, y - thick / 2, pz) for px, pz in outline]
    back = [(px, y + thick / 2, pz) for px, pz in outline]
    m.face(front, [uv_tile(mat, px, pz) for px, pz in outline], mat, shade, (0.0, -1.0, 0.0))
    m.face(back, [uv_tile(mat, -px, pz) for px, pz in outline], mat, shade * 0.82, (0.0, 1.0, 0.0))
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    run = 0.0
    for i in range(len(outline)):
        (ax, az), (bx, bz) = outline[i], outline[(i + 1) % len(outline)]
        length = math.hypot(bx - ax, bz - az)
        out = Vector(((ax + bx) / 2 - cx, 0.0, (az + bz) / 2 - cz))
        pts = [(ax, y - thick / 2, az), (bx, y - thick / 2, bz), (bx, y + thick / 2, bz), (ax, y + thick / 2, az)]
        uvs = [uv_tile(mat, run, 0.0), uv_tile(mat, run + length, 0.0), uv_tile(mat, run + length, thick), uv_tile(mat, run, thick)]
        m.face(pts, uvs, mat, shade * (0.7 + 0.3 * max(0.0, out.normalized().z if out.length else 0.0)), out)
        run += length


def arch_top(half, base, rise, steps=7):
    """The outline of a round-headed stone: up one side, over the top, down the other."""
    pts = [(-half, 0.0), (half, 0.0), (half, base)]
    for i in range(1, steps):
        a = math.pi * i / steps
        pts.append((half * math.cos(a), base + rise * math.sin(a)))
    pts.append((-half, base))
    return pts


def hull(m, length, beam, depth, sheer=0.28, transom=0.62, stations=10, rows=5, floor=None, rail="oak", bow_rise=0.5):
    """A clinker boat hull, its bow toward -Y: painted strakes outside, boards inside, a rail
    round the gunwale and a flat transom. Returns a function giving the half-breadth and
    the gunwale height at t (0 at the stern, 1 at the stem)."""

    def half(t):
        if t < 0.42:
            k = t / 0.42
            return beam / 2 * (transom + (1.0 - transom) * (k * k * (3 - 2 * k)))
        k = (t - 0.42) / 0.58
        return beam / 2 * max(0.0, 1.0 - k**2.3)

    def keel(t):
        return depth * bow_rise * max(0.0, (t - 0.55) / 0.45) ** 2.2 + depth * 0.12 * max(0.0, (0.25 - t) / 0.25) ** 2

    def top(t):
        return depth + sheer * (2 * t - 1) ** 2

    def point(t, s, inset=0.0):
        w = max(0.0, half(t) - inset)
        return (w * math.sin(math.pi / 2 * s) ** 0.75, length / 2 - length * t, keel(t) + inset * 0.8 + (top(t) - keel(t) - inset * 0.8) * (1 - math.cos(math.pi / 2 * s)))

    for i in range(stations):
        t0, t1 = i / stations, (i + 1) / stations
        for k in range(rows):
            s0, s1 = k / rows, (k + 1) / rows
            for sign in (-1.0, 1.0):
                a, b, c, d = point(t0, s0), point(t1, s0), point(t1, s1), point(t0, s1)
                pts = [(sign * p[0], p[1], p[2]) for p in (a, b, c, d)]
                # every other strake a touch darker, so the laps read
                lit = (0.82 if k % 2 else 1.0) * (0.72 + 0.28 * s1)
                uvs = [uv_tile("hull", length * t0, depth * s0 * 1.6), uv_tile("hull", length * t1, depth * s0 * 1.6), uv_tile("hull", length * t1, depth * s1 * 1.6), uv_tile("hull", length * t0, depth * s1 * 1.6)]
                m.face(pts, uvs, "hull", lit, (sign, 0.0, -0.35 + s1))
                a, b, c, d = point(t0, s0, 0.07), point(t1, s0, 0.07), point(t1, s1, 0.07), point(t0, s1, 0.07)
                pts = [(sign * p[0], p[1], p[2]) for p in (a, b, c, d)]
                uvs = [uv_band("planks", length * t0, s0, depth), uv_band("planks", length * t1, s0, depth), uv_band("planks", length * t1, s1, depth), uv_band("planks", length * t0, s1, depth)]
                m.face(pts, uvs, "trim", 0.62 + 0.2 * s1, (-sign, 0.0, 0.6))
    # the transom, outside and in
    ring = [point(0.0, k / rows) for k in range(rows + 1)]
    outline = [(-p[0], p[1], p[2]) for p in reversed(ring)] + [(p[0], p[1], p[2]) for p in ring[1:]]
    m.face(outline, [uv_tile("hull", p[0], p[2]) for p in outline], "hull", 0.8, (0.0, 1.0, 0.0))
    inner = [(p[0] * 0.9, p[1] - 0.07, p[2] + 0.05) for p in outline]
    m.face(inner, [uv_band("planks", p[0], 0.5, depth) for p in inner], "trim", 0.6, (0.0, -1.0, 0.0))
    # the rail round the gunwale and a stem post at the bow
    for sign in (-1.0, 1.0):
        line = [(sign * point(i / stations, 1.0)[0], point(i / stations, 1.0)[1], point(i / stations, 1.0)[2]) for i in range(stations + 1)]
        m.sweep(line, (0.11, 0.09), rail, depth=0.2, caps=False)
    stem = point(1.0, 1.0)
    m.sweep([(0.0, stem[1] + 0.12, keel(0.86)), (0.0, stem[1], stem[2] + 0.02), (0.0, stem[1] - 0.1, stem[2] + 0.34)], [(0.12, 0.16), (0.12, 0.14), (0.09, 0.1)], rail, depth=0.24)
    if floor is not None:
        # bottom boards
        z = floor
        pts = []
        for i in range(stations + 1):
            t = i / stations
            w = max(0.0, half(t) * 0.66)
            pts.append((w, length / 2 - length * t))
        for i in range(stations):
            (w0, y0), (w1, y1) = pts[i], pts[i + 1]
            quad = [(-w0, y0, z), (w0, y0, z), (w1, y1, z), (-w1, y1, z)]
            m.face(quad, [uv_band("planks", q[1], 0.5 + q[0] / beam, beam) for q in quad], "trim", 0.72, UP)
    return lambda t: (half(t), top(t), keel(t))


def thwart(m, shape, length, t, drop=0.22, width=0.3):
    """A seat board across a hull at t."""
    w, top, _keel = shape(t)
    y = length / 2 - length * t
    m.box(Frame((-w * 0.9, y + width / 2, top - drop), (1.0, 0.0, 0.0)), 0.0, w * 1.8, -0.06, 0.0, 0.0, width, ("band", "planks", "x", 0.4), skip="b")


def oar(m, a, b, blade=0.5):
    a, b = Vector(a), Vector(b)
    bar(m, a, b, 0.035, band="oak", sides=6)
    along = (b - a).normalized()
    side = along.cross(Vector((0.0, 0.0, 1.0))).normalized()
    tip = b + along * blade
    pts = [b - side * 0.04, b + side * 0.04, tip + side * 0.11, tip - side * 0.11]
    for facing in (1.0, -1.0):
        m.face(pts, [uv_band("planks", 0.0, 0.2, 0.3), uv_band("planks", 0.0, 0.8, 0.3), uv_band("planks", blade, 0.8, 0.3), uv_band("planks", blade, 0.2, 0.3)], "trim", 0.9, Vector((0.0, 0.0, facing)))


def striped(m, pts, shade=1.0, facing=UP, along=1.0):
    """A sheet of the striped awning canvas over four corners (near left, near right, far
    right, far left)."""
    from kit import uv_part

    uvs = [uv_part("awning_top", 0.04, 0.97), uv_part("awning_top", 0.04 + 0.92 * along, 0.97), uv_part("awning_top", 0.04 + 0.92 * along, 0.03), uv_part("awning_top", 0.04, 0.03)]
    m.face(pts, uvs, "parts_solid", shade, facing)


# -- the props ------------------------------------------------------------------------------


def well():
    """The town well: a coursed stone drum, a windlass between two posts and a little
    prow roof over it, the bucket hanging on its rope."""
    m = Model("well")
    axis = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(axis, [(1.16, 0.0), (1.1, 0.16), (1.02, 0.2), (1.0, 0.92)], sides=12, skin=("tile", "stone"), smooth=False)
    m.lathe(axis, [(1.0, 0.92), (1.12, 0.96), (1.12, 1.1), (0.84, 1.1), (0.82, 0.5)], sides=12, skin=("tile", "stone"), smooth=False, shade=0.95)
    with tinted(m, WATER):
        m.lathe(axis, [(0.82, 0.55), (0.0, 0.55)], sides=12, skin=("band", "plaster", 1.0), smooth=False)
    for y in (-1.1, 1.1):
        post(m, 0.0, y, 0.0, 2.62, size=0.2, cap=False)
        m.sweep([(0.0, y, 1.5), (0.0, y * 0.62, 2.5)], (0.12, 0.12), "oak", depth=0.3, caps=False, shade=0.8)
    bar(m, (0.0, -1.22, 1.95), (0.0, 1.22, 1.95), 0.11, band="oak", sides=8)
    m.sweep([(0.0, -1.24, 1.95), (0.3, -1.24, 1.95), (0.3, -1.4, 1.95)], (0.07, 0.07), "oak", depth=0.14)
    with tinted(m, ROPE):
        bar(m, (0.0, 0.1, 1.95), (0.0, 0.1, 1.32), 0.03, band="plaster", sides=5, caps=False)
    bucket = Frame((0.0, 0.1, 0.98), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(bucket, [(0.2, 0.0), (0.26, 0.36)], sides=8, skin=("band", "planks", 0.3))
    m.lathe(bucket, [(0.0, 0.03), (0.2, 0.03)], sides=8, skin=("band", "planks", 0.3), smooth=False, shade=0.6)
    m.lathe(bucket, [(0.27, 0.28), (0.27, 0.34)], sides=8, skin=("band", "gilded", 0.08))
    m.swept_roof(-1.12, 1.12, -1.2, 1.2, 2.6, rise=0.72, ridge="y", prow=0.12, sweep=0.22, eave_out=0.1, eave_drop=0.16, gable_out=0.05, thick=0.1, board=0.18, horn=0.16, gable=None, collide=False)
    return m


def stall(variant=0):
    """A market stall: turned posts under a striped canvas, a carved counter stacked with
    crates, sacks and a barrel, a lamp on its front beam."""
    m = Model("stall")
    w, d = 3.0, 2.3
    front, back = (2.0, 2.56) if variant == 0 else (2.3, 2.3)
    for sx in (-1.0, 1.0):
        post(m, sx * (w / 2 - 0.12), -d / 2 + 0.12, 0.0, front, size=0.17)
        post(m, sx * (w / 2 - 0.12), d / 2 - 0.12, 0.0, back, size=0.17)
        m.sweep([(sx * (w / 2 - 0.12), -d / 2 + 0.12, front - 0.05), (sx * (w / 2 - 0.12), d / 2 - 0.12, back - 0.05)], (0.1, 0.12), "oak", depth=0.24, caps=False)
    m.sweep([(-w / 2 + 0.1, -d / 2 + 0.12, front - 0.05), (w / 2 - 0.1, -d / 2 + 0.12, front - 0.05)], (0.1, 0.12), "gilded", depth=0.2, caps=False)
    if variant == 0:
        # one slope, falling to the street, with a scalloped edge
        corners = [(-w / 2 - 0.2, -d / 2 - 0.35, front - 0.12), (w / 2 + 0.2, -d / 2 - 0.35, front - 0.12), (w / 2 + 0.2, d / 2 + 0.12, back + 0.06), (-w / 2 - 0.2, d / 2 + 0.12, back + 0.06)]
        striped(m, corners, 1.0, (0.0, -0.3, 1.0))
        striped(m, [corners[1], corners[0], corners[3], corners[2]], 0.6, (0.0, 0.3, -1.0))
    else:
        # a ridge tent of the same canvas
        ridge = back + 0.75
        for sy, shade in ((-1.0, 1.0), (1.0, 0.85)):
            corners = [(-w / 2 - 0.2, sy * (d / 2 + 0.3), back - 0.1), (w / 2 + 0.2, sy * (d / 2 + 0.3), back - 0.1), (w / 2 + 0.2, 0.0, ridge), (-w / 2 - 0.2, 0.0, ridge)]
            striped(m, corners if sy < 0 else [corners[1], corners[0], corners[3], corners[2]], shade, (0.0, sy, 0.8))
            striped(m, [corners[1], corners[0], corners[3], corners[2]] if sy < 0 else corners, 0.55, (0.0, -sy, -0.8))
        m.sweep([(-w / 2 - 0.25, 0.0, ridge), (w / 2 + 0.25, 0.0, ridge)], (0.1, 0.1), "gilded", depth=0.2)
        for sx in (-1.0, 1.0):
            m.gem(Vector((sx * (w / 2 + 0.3), 0.0, ridge)), 0.1)
    m.counter(Frame((-w / 2 + 0.2, -d / 2 + 0.2, 0.0), (1, 0, 0)), length=w - 0.4, height=1.0, depth=0.62, band="bargeboard" if variant == 0 else "teal")
    # a boarded back and the goods
    m.box(Frame((-w / 2 + 0.2, d / 2 - 0.22, 0.0), (1, 0, 0)), 0.0, w - 0.4, 0.0, 1.5, 0.0, 0.08, ("band", "planks", "x", 0.75), shade=0.86)
    m.box(Frame((-w / 2 + 0.2, d / 2 - 0.36, 1.05), (1, 0, 0)), 0.0, w - 0.4, 0.0, 0.07, -0.2, 0.0, ("band", "planks", "x", 0.34))
    m.crate(-0.75, -d / 2 + 0.5, 1.0, size=0.38, turn=0.2)
    m.crate(-0.2, -d / 2 + 0.52, 1.0, size=0.3, turn=-0.3)
    m.barrel(w / 2 - 0.55, 0.25, 0.0, size=0.62)
    m.crate(-w / 2 + 0.62, 0.3, 0.0, size=0.62, turn=0.15)
    m.crate(-w / 2 + 0.62, 0.3, 0.62, size=0.42, turn=-0.4)
    with tinted(m, (0.86, 0.72, 0.5)):
        for sx, sy in ((0.5, -0.62), (0.86, -0.55)):
            sack = Frame((sx, sy, 1.0), (1, 0, 0), UP, (0, 1, 0))
            m.lathe(sack, [(0.0, 0.0), (0.2, 0.02), (0.22, 0.2), (0.12, 0.34), (0.05, 0.38)], sides=7, skin=("band", "plaster", 0.5))
    m.hung_lamp(0.0, -d / 2 + 0.12, front - 0.14, 0.9)
    return m


def fence():
    """A length of yard fence: two capped posts, two rails and pointed pales."""
    m = Model("fence")
    half = 1.18
    for sx in (-1.0, 1.0):
        post(m, sx * (half - 0.07), 0.0, 0.0, 0.92, size=0.14)
    for z in (0.3, 0.68):
        m.sweep([(-half, 0.0, z), (half, 0.0, z)], (0.06, 0.1), "oak", depth=0.2, caps=False)
    for i in range(6):
        x = -half + 0.3 + i * (2 * half - 0.6) / 5
        pts = [(x - 0.07, -0.045, 0.06), (x + 0.07, -0.045, 0.06), (x + 0.07, -0.045, 0.74), (x, -0.045, 0.86), (x - 0.07, -0.045, 0.74)]
        for sign in (-1.0, 1.0):
            face = [(px, sign * abs(py), pz) for px, py, pz in pts]
            m.face(face, [uv_band("planks", px, pz / 0.86, 0.86) for px, _py, pz in pts], "trim", 0.95 if sign < 0 else 0.8, (0.0, sign, 0.0))
    return m


def bonfire():
    """A fire ring: a circle of hearth stones round crossed logs on a bed of ash."""
    m = Model("bonfire")
    for i in range(9):
        a = math.tau * i / 9
        r = 0.72
        fr = Frame((math.cos(a) * r, math.sin(a) * r, 0.0), (-math.sin(a), math.cos(a), 0.0), UP)
        m.box(fr, -0.2, 0.2, -0.04, 0.2 + 0.05 * (i % 3), -0.14, 0.14, ("tile", "stone"), skip="b", shade=0.9 + 0.05 * (i % 2))
    with tinted(m, ASH):
        m.lathe(Frame((0, 0, 0), (1, 0, 0), UP, (0, 1, 0)), [(0.62, 0.03), (0.0, 0.06)], sides=9, skin=("band", "plaster", 1.0), smooth=False)
    for i in range(4):
        a = math.tau * i / 4 + 0.4
        bar(m, (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.08), (-math.cos(a) * 0.12, -math.sin(a) * 0.12, 0.42), 0.085, band="oak", sides=6, shade=0.7)
    return m


def crate_prop():
    m = Model("crate")
    m.crate(0.0, 0.0, 0.0, size=1.0)
    return m


def barrel_prop():
    m = Model("barrel")
    m.barrel(0.0, 0.0, 0.0, size=1.0)
    return m


def apple_crate():
    """A low market tray heaped with apples."""
    m = Model("apple_crate")
    w, d, h = 1.4, 0.82, 0.36
    fr = Frame((-w / 2, -d / 2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, 0.05, 0.0, d, ("band", "planks", "x", 0.4))
    for x0, x1, z0, z1 in ((0.0, w, 0.0, 0.06), (0.0, w, d - 0.06, d), (0.0, 0.06, 0.0, d), (w - 0.06, w, 0.0, d)):
        m.box(fr, x0, x1, 0.0, h, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", 0.36), shade=0.9)
    for cx, cz in ((0.0, 0.0), (w, 0.0), (0.0, d), (w, d)):
        m.box(fr, cx - 0.05, cx + 0.05, 0.0, h + 0.04, cz - 0.05, cz + 0.05, ("band", "oak", "y", 0.2), shade=0.7)
    k = 0
    for ix in range(6):
        for iy in range(3):
            k += 1
            colour = (0.78, 0.14, 0.1) if k % 4 else (0.72, 0.66, 0.16)
            with tinted(m, colour):
                m.gem(Vector((-w / 2 + 0.2 + ix * 0.2, -d / 2 + 0.2 + iy * 0.21, h - 0.02 + 0.05 * ((ix + iy) % 2))), 0.1, band="plaster", stretch=1.0)
    return m


def dock_platform():
    """One bay of quay: a boarded deck on four tarred piles, braced below."""
    m = Model("dock_platform")
    half, top = 1.25, 1.31
    fr = Frame((-half, -half, 0.0), (1, 0, 0), UP, (0, 1, 0))
    count = 7
    for i in range(count):
        z0 = 2 * half * i / count
        m.box(fr, 0.0, 2 * half, top - 0.1, top, z0 + 0.012, z0 + 2 * half / count - 0.012, ("band", "planks", "x", 0.36), shade=0.92 + 0.06 * (i % 2))
    for z in (0.18, 2 * half - 0.3):
        m.box(fr, 0.0, 2 * half, top - 0.26, top - 0.1, z, z + 0.12, ("band", "oak", "x", 0.3), shade=0.7)
    with tinted(m, TAR):
        for sx in (-1.0, 1.0):
            for sy in (-1.0, 1.0):
                bar(m, (sx * (half - 0.17), sy * (half - 0.17), 0.0), (sx * (half - 0.17), sy * (half - 0.17), top + 0.2), 0.13, band="plaster", sides=7)
    for sx in (-1.0, 1.0):
        m.sweep([(sx * (half - 0.17), -half + 0.2, 0.25), (sx * (half - 0.17), half - 0.2, top - 0.32)], (0.07, 0.1), "oak", depth=0.2, caps=False, shade=0.7)
    return m


def rowboat():
    """A clinker rowing boat, its oars shipped across the thwarts."""
    m = Model("rowboat")
    length, beam, depth = 2.36, 1.05, 0.52
    shape = hull(m, length, beam, depth, sheer=0.14, floor=0.1)
    thwart(m, shape, length, 0.34)
    thwart(m, shape, length, 0.62)
    for sign in (-1.0, 1.0):
        oar(m, (sign * 0.3, 0.55, 0.52), (sign * 1.02, -0.5, 0.62), blade=0.42)
    return m


def skiff():
    """A broad open harbour boat with two thwarts and a pair of oars laid inboard (the
    hex-kit boat's place)."""
    m = Model("skiff")
    length, beam, depth = 3.0, 1.46, 0.4
    shape = hull(m, length, beam, depth, sheer=0.12, floor=0.1)
    thwart(m, shape, length, 0.3, drop=0.14)
    thwart(m, shape, length, 0.6, drop=0.14)
    for sign in (-1.0, 1.0):
        oar(m, (sign * 0.28, 0.9, 0.36), (sign * 0.36, -0.7, 0.4), blade=0.4)
    return m


def fishing_boat():
    """A harbour fishing boat: a deep hull, a little wheelhouse aft, a mast with its sail
    furled along the yard and a lamp at the stern."""
    m = Model("fishing_boat")
    length, beam, depth = 3.87, 1.78, 0.95
    shape = hull(m, length, beam, depth, sheer=0.26, floor=0.5, stations=12, rows=6)
    # the wheelhouse
    cab = Frame((-0.5, 0.55, 0.5), (1, 0, 0), UP, (0, 1, 0))
    m.box(cab, 0.0, 1.0, 0.0, 1.15, 0.0, 0.95, ("band", "teal", "y", 1.15), skip="b")
    m.box(cab, -0.1, 1.1, 1.15, 1.25, -0.12, 1.07, ("band", "planks", "x", 0.5))
    m.box(cab, -0.12, 1.12, 1.25, 1.31, -0.14, 1.09, ("band", "gilded", "x", 0.12))
    for x0 in (0.14, 0.58):
        m.box(cab, x0, x0 + 0.28, 0.55, 0.92, -0.02, 0.0, ("tile", "glass"), skip="k")
    thwart(m, shape, length, 0.74, drop=0.3)
    bar(m, (0.0, -0.55, 0.5), (0.0, -0.55, 2.6), 0.07, band="oak", sides=7, r1=0.05)
    bar(m, (-0.85, -0.55, 2.0), (0.85, -0.55, 2.0), 0.045, band="oak", sides=6)
    with tinted(m, CANVAS):
        bar(m, (-0.78, -0.55, 1.9), (0.78, -0.55, 1.9), 0.13, band="plaster", sides=7)
    m.gem(Vector((0.0, -0.55, 2.66)), 0.07)
    m.hung_lamp(0.0, 1.55, 1.6, 0.7)
    bar(m, (0.0, 1.55, 0.9), (0.0, 1.55, 1.62), 0.035, band="oak", sides=5)
    m.crate(0.42, -1.0, 0.5, size=0.34, turn=0.3)
    m.barrel(-0.4, -0.95, 0.5, size=0.34)
    return m


def sail_boat():
    """A small trading boat under one square sail of striped canvas."""
    m = Model("sail_boat")
    length, beam, depth = 3.77, 1.78, 0.9
    shape = hull(m, length, beam, depth, sheer=0.26, floor=0.45, stations=12, rows=6)
    thwart(m, shape, length, 0.3, drop=0.3)
    thwart(m, shape, length, 0.7, drop=0.3)
    bar(m, (0.0, -0.2, 0.45), (0.0, -0.2, 4.55), 0.08, band="oak", sides=7, r1=0.05)
    bar(m, (-1.05, -0.2, 4.0), (1.05, -0.2, 4.0), 0.05, band="oak", sides=6)
    bar(m, (-0.95, -0.2, 1.5), (0.95, -0.2, 1.5), 0.045, band="oak", sides=6)
    front = [(-0.98, -0.34, 1.55), (0.98, -0.34, 1.55), (0.98, -0.28, 3.95), (-0.98, -0.28, 3.95)]
    striped(m, front, 1.0, (0.0, -1.0, 0.0))
    striped(m, [front[1], front[0], front[3], front[2]], 0.8, (0.0, 1.0, 0.0))
    m.gem(Vector((0.0, -0.2, 4.64)), 0.08)
    m.barrel(0.4, 0.9, 0.45, size=0.36)
    return m


def gravestone(kind="round"):
    """A churchyard stone, cut from the same masonry as the town: round-headed, a cross, a
    plain bevelled slab, or a carved one with shoulders."""
    m = Model("gravestone_" + kind)
    if kind == "round":
        slab(m, arch_top(0.42, 0.74, 0.4), 0.22)
    elif kind == "bevel":
        slab(m, [(-0.42, 0.0), (0.42, 0.0), (0.42, 0.82), (0.26, 1.02), (-0.26, 1.02), (-0.42, 0.82)], 0.22)
    elif kind == "decorative":
        slab(m, [(-0.5, 0.0), (0.5, 0.0), (0.5, 0.62), (0.36, 0.62), (0.36, 0.9), (0.2, 1.14), (-0.2, 1.14), (-0.36, 0.9), (-0.36, 0.62), (-0.5, 0.62)], 0.22)
        m.gem(Vector((0.0, -0.13, 0.84)), 0.11)
    else:
        slab(m, [(-0.16, 0.0), (0.16, 0.0), (0.16, 1.02), (0.44, 1.02), (0.44, 1.32), (0.16, 1.32), (0.16, 1.78), (-0.16, 1.78), (-0.16, 1.32), (-0.44, 1.32), (-0.44, 1.02), (-0.16, 1.02)], 0.2)
    base = Frame((-0.52, -0.2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(base, 0.0, 1.04, 0.0, 0.14, 0.0, 0.4, ("tile", "stone"), skip="b", shade=0.86)
    return m


def timber_pillar():
    m = Model("timber_pillar")
    post(m, 0.0, 0.0, 0.0, 0.94, size=0.15)
    return m


def anvil():
    """A smith's anvil on its oak block."""
    m = Model("anvil")
    m.box(Frame((-0.3, -0.2, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 0.6, 0.0, 0.2, 0.0, 0.4, ("band", "oak", "x", 0.4), skip="b", shade=0.8)
    with tinted(m, IRON):
        fr = Frame((0.0, 0.0, 0.2), (1, 0, 0), UP, (0, 1, 0))
        m.box(fr, -0.22, 0.22, 0.0, 0.1, -0.16, 0.16, ("band", "plaster", "x", 0.4), skip="b")
        m.box(fr, -0.13, 0.13, 0.1, 0.24, -0.1, 0.1, ("band", "plaster", "x", 0.4), skip="b")
        m.box(fr, -0.34, 0.36, 0.24, 0.36, -0.19, 0.19, ("band", "plaster", "x", 0.4))
        bar(m, (0.36, 0.0, 0.5), (0.6, 0.0, 0.52), 0.1, band="plaster", sides=7, r1=0.02)
    return m


def weapon_stand():
    """An arms rack: an oak frame holding spears and a pair of shields' worth of blades."""
    m = Model("weapon_stand")
    for sx in (-1.0, 1.0):
        post(m, sx * 0.62, 0.0, 0.0, 1.04, size=0.12)
        m.sweep([(sx * 0.62, -0.42, 0.04), (sx * 0.62, 0.42, 0.04)], (0.12, 0.08), "oak", depth=0.2)
    for z in (0.34, 0.9):
        m.sweep([(-0.62, 0.0, z), (0.62, 0.0, z)], (0.07, 0.1), "oak", depth=0.2, caps=False)
    for i, x in enumerate((-0.4, -0.13, 0.14, 0.41)):
        bar(m, (x, -0.1, 0.04), (x, 0.06, 1.0), 0.028, band="oak", sides=5)
        with tinted(m, (0.62, 0.64, 0.68)):
            tip = Vector((x, 0.06 + 0.02, 1.0))
            m.gem(tip + Vector((0.0, 0.01, 0.1)), 0.05 if i % 2 else 0.07, band="plaster", stretch=2.6)
    return m


def wall_lantern():
    """A lamp on a wrought arm, standing out from where it is fixed."""
    m = Model("lantern_wall")
    m.box(Frame((-0.1, 0.0, 0.08), (1, 0, 0)), 0.0, 0.2, 0.0, 1.3, -0.05, 0.0, ("band", "oak", "y", 0.3), shade=0.6)
    m.lantern(Frame((0.0, 0.0, 1.24), (1, 0, 0)), reach=1.12, size=0.86)
    return m


def iron_rails(m, x0, x1, top, bars, base=0.0):
    """Wrought railings between two points: uprights with gilded spear heads and two rails."""
    with tinted(m, IRON):
        for z in (base + 0.25, top - 0.3):
            m.sweep([(x0, 0.0, z), (x1, 0.0, z)], (0.07, 0.07), "plaster", depth=0.14, caps=False)
        for i in range(bars):
            x = x0 + (x1 - x0) * (i + 0.5) / bars
            m.sweep([(x, 0.0, base + 0.05), (x, 0.0, top - 0.08)], (0.05, 0.05), "plaster", depth=0.1, caps=False)
    for i in range(bars):
        x = x0 + (x1 - x0) * (i + 0.5) / bars
        m.gem(Vector((x, 0.0, top + 0.02)), 0.07, stretch=2.2)


def stone_pier(m, x, top, size=0.5):
    fr = Frame((x - size / 2, -size / 2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, size, 0.0, top - 0.22, 0.0, size, ("tile", "stone"), skip="b")
    m.box(fr, -0.06, size + 0.06, top - 0.22, top - 0.08, -0.06, size + 0.06, ("tile", "stone"), shade=0.95)
    m.gem(Vector((x, 0.0, top + 0.02)), 0.12, stretch=1.2)


def iron_fence():
    m = Model("garden_iron_fence")
    iron_rails(m, -1.98, 1.98, 2.1, 13)
    return m


def iron_pillar():
    m = Model("garden_iron_pillar")
    stone_pier(m, 0.0, 2.2)
    return m


def iron_gate():
    m = Model("garden_iron_gate")
    for sx in (-1.0, 1.0):
        stone_pier(m, sx * 1.75, 2.9)
    iron_rails(m, -1.5, -0.04, 2.4, 5)
    iron_rails(m, 0.04, 1.5, 2.4, 5)
    return m


def garden_arch():
    m = Model("garden_arch")
    for sx in (-1.0, 1.0):
        stone_pier(m, sx * 1.85, 2.6)
    with tinted(m, IRON):
        for offset in (-0.16, 0.16):
            arc = [(1.85 * math.cos(math.pi * i / 10), offset, 2.55 + 1.75 * math.sin(math.pi * i / 10)) for i in range(11)]
            m.sweep(arc, (0.07, 0.07), "plaster", depth=0.14, caps=False)
        for i in range(1, 10):
            a = math.pi * i / 10
            m.sweep([(1.85 * math.cos(a), -0.16, 2.55 + 1.75 * math.sin(a)), (1.85 * math.cos(a), 0.16, 2.55 + 1.75 * math.sin(a))], (0.05, 0.05), "plaster", depth=0.1, caps=False)
    m.gem(Vector((0.0, 0.0, 4.36)), 0.14, stretch=1.6)
    return m


def tent(small=False):
    """A camp tent: low canvas walls, a striped fly pitched over a ridge pole (the stalls' own
    canvas, so a camp belongs to the market it trades with), its two door flaps tied back
    off a dark way in."""
    m = Model("tent_small" if small else "tent_open")
    w, d, h = (1.9, 2.4, 1.9) if small else (3.1, 2.4, 1.95)
    wall, eave = 0.62, 0.16
    canvas = (0.84, 0.78, 0.64)

    def sheet(pts, shade, facing):
        """Plain canvas over the points, its weave scaled to the tent's height."""
        m.face(pts, [uv_band("plaster", p[0] + p[1], p[2] / h, h * 1.4) for p in pts], "trim", shade, facing)

    for sx in (-1.0, 1.0):
        lit = 1.0 if sx < 0 else 0.84
        # the fly: striped canvas from just past the wall's head up to the ridge
        low = wall - eave * (h - wall) / (w / 2)
        fly = [(sx * (w / 2 + eave), -d / 2 - 0.06, low), (sx * (w / 2 + eave), d / 2 + 0.06, low), (0.0, d / 2 + 0.06, h), (0.0, -d / 2 - 0.06, h)]
        striped(m, fly if sx < 0 else [fly[1], fly[0], fly[3], fly[2]], lit, (sx, 0.0, 0.7), along=d / 2.4)
        with tinted(m, canvas):
            under = [fly[1], fly[0], fly[3], fly[2]]
            sheet(under, 0.42, (-sx, 0.0, -0.7))
            # the wall under it, seen from outside and from within
            side = [(sx * w / 2, -d / 2, 0.0), (sx * w / 2, d / 2, 0.0), (sx * w / 2, d / 2, wall), (sx * w / 2, -d / 2, wall)]
            sheet(side, lit * 0.92, (sx, 0.0, 0.0))
            sheet([side[1], side[0], side[3], side[2]], 0.4, (-sx, 0.0, 0.0))
            # a door flap: hung from the ridge and the wall's head, its foot drawn aside
            foot = (sx * w * 0.27, -d / 2 - 0.1, 0.0)
            flap = [(sx * w / 2, -d / 2, 0.0), foot, (0.0, -d / 2, h), (sx * w / 2, -d / 2, wall)]
            sheet(flap if sx > 0 else [flap[1], flap[0], flap[3], flap[2]], 0.9 if sx < 0 else 0.76, (sx * 0.25, -1.0, 0.0))
            sheet(flap if sx < 0 else [flap[1], flap[0], flap[3], flap[2]], 0.4, (-sx * 0.25, 1.0, 0.0))
    with tinted(m, canvas):
        back = [(-w / 2, d / 2, 0.0), (w / 2, d / 2, 0.0), (w / 2, d / 2, wall), (0.0, d / 2, h), (-w / 2, d / 2, wall)]
        sheet(back, 0.78, (0.0, 1.0, 0.0))
        sheet(list(reversed(back)), 0.36, (0.0, -1.0, 0.0))
    bar(m, (0.0, -d / 2 - 0.2, h + 0.02), (0.0, d / 2 + 0.2, h + 0.02), 0.045, band="oak", sides=6)
    for sy in (-1.0, 1.0):
        bar(m, (0.0, sy * d / 2, 0.0), (0.0, sy * d / 2, h), 0.05, band="oak", sides=6, caps=False)
        m.gem(Vector((0.0, sy * (d / 2 + 0.24), h + 0.02)), 0.07)
    # the tie that holds each flap back, and a peg at each corner of the walls
    with tinted(m, ROPE):
        for sx in (-1.0, 1.0):
            bar(m, (sx * w * 0.27, -d / 2 - 0.1, 0.02), (sx * w / 2, -d / 2 - 0.02, wall * 0.6), 0.02, band="plaster", sides=4, caps=False)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            bar(m, (sx * (w / 2 + 0.06), sy * (d / 2 - 0.08), 0.0), (sx * (w / 2 + 0.02), sy * (d / 2 - 0.08), 0.22), 0.035, band="oak", sides=5)
    return m


def chest():
    """The banker's strongbox: oak boards under a barrel lid, strapped and cornered in gilt."""
    m = Model("banker_chest")
    w, d, h = 2.1, 1.2, 0.72
    fr = Frame((-w / 2, -d / 2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, h, 0.0, d, ("band", "planks", "x", h), skip="b")
    axis = Frame((-w / 2, 0.0, h), (0, 1, 0), (1, 0, 0), (0, 0, 1))
    m.lathe(axis, [(d / 2, 0.0), (d / 2, w)], sides=8, skin=("band", "planks", 0.5), arc=(0.0, 180.0), smooth=True)
    for x in (0.0, w):
        ring = [(x - w / 2, d / 2 * math.cos(math.pi * i / 8), h + d / 2 * math.sin(math.pi * i / 8)) for i in range(9)]
        pts = ring if x > 0 else list(reversed(ring))
        m.face(pts, [uv_band("planks", p[1], (p[2] - h) / (d / 2), d / 2) for p in pts], "trim", 0.84, (1.0 if x > 0 else -1.0, 0.0, 0.0))
    for x in (0.16, w / 2, w - 0.16):
        m.box(fr, x - 0.07, x + 0.07, 0.0, h + 0.01, -0.02, d + 0.02, ("band", "gilded", "y", 0.14))
        m.lathe(Frame((x - w / 2 - 0.07, 0.0, h), (0, 1, 0), (1, 0, 0), (0, 0, 1)), [(d / 2 + 0.025, 0.0), (d / 2 + 0.025, 0.14)], sides=8, skin=("band", "gilded", 0.14), arc=(0.0, 180.0))
    m.box(fr, w / 2 - 0.14, w / 2 + 0.14, h - 0.26, h + 0.06, -0.06, 0.0, ("band", "gilded", "x", 0.3))
    m.gem(Vector((0.0, -d / 2 - 0.08, h - 0.1)), 0.07)
    return m


def anchor():
    """A ship's anchor leaned against the quay."""
    m = Model("anchor")
    with tinted(m, IRON):
        bar(m, (0.0, 0.0, 0.2), (0.0, 0.0, 1.9), 0.07, band="plaster", sides=6)
        bar(m, (-0.42, 0.0, 1.66), (0.42, 0.0, 1.66), 0.05, band="plaster", sides=6)
        arc = [(0.66 * math.sin(a), 0.0, 0.62 - 0.5 * math.cos(a)) for a in [math.radians(v) for v in (-110, -70, -35, 0, 35, 70, 110)]]
        m.sweep(arc, (0.12, 0.1), "plaster", depth=0.2)
        for sx in (-1.0, 1.0):
            m.gem(Vector((sx * 0.64, 0.0, 0.82)), 0.14, band="plaster", stretch=1.5)
    m.lathe(Frame((0.0, -0.09, 2.0), (1, 0, 0), (0, 1, 0), (0, 0, 1)), [(0.2, 0.0), (0.2, 0.18)], sides=8, skin=("band", "gilded", 0.1))
    return m


def sack():
    m = Model("sack")
    with tinted(m, (0.84, 0.7, 0.48)):
        fr = Frame((0, 0, 0), (1, 0, 0), UP, (0, 1, 0))
        m.lathe(fr, [(0.0, 0.0), (0.4, 0.03), (0.46, 0.34), (0.3, 0.62), (0.1, 0.7)], sides=8, skin=("band", "plaster", 0.9))
    with tinted(m, ROPE):
        m.lathe(Frame((0, 0, 0.62), (1, 0, 0), UP, (0, 1, 0)), [(0.13, 0.0), (0.13, 0.06)], sides=8, skin=("band", "plaster", 0.2))
    return m


def open_crate():
    """A crate with its lid off, packed with fish on straw."""
    m = Model("crate_open")
    w, h = 1.0, 0.72
    fr = Frame((-w / 2, -w / 2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, 0.06, 0.0, w, ("band", "planks", "x", 0.5))
    for x0, x1, z0, z1 in ((0.0, w, 0.0, 0.07), (0.0, w, w - 0.07, w), (0.0, 0.07, 0.0, w), (w - 0.07, w, 0.0, w)):
        m.box(fr, x0, x1, 0.0, h, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", h), shade=0.9)
    for cx, cz in ((0.0, 0.0), (w, 0.0), (0.0, w), (w, w)):
        m.box(fr, cx - 0.06, cx + 0.06, 0.0, h + 0.03, cz - 0.06, cz + 0.06, ("band", "oak", "y", 0.2), shade=0.7)
    with tinted(m, (0.86, 0.76, 0.42)):
        m.box(fr, 0.07, w - 0.07, h - 0.24, h - 0.16, 0.07, w - 0.07, ("band", "plaster", "x", 0.6), skip="b")
    with tinted(m, (0.5, 0.62, 0.7)):
        for i in range(4):
            m.gem(Vector((-0.24 + i * 0.16, -0.1 + 0.08 * (i % 2), h - 0.1)), 0.12, band="plaster", stretch=0.5)
    # the lid, leaned against its side
    lid = Frame((w / 2 + 0.06, -w / 2, 0.0), (0, 1, 0), (0.28, 0.0, 0.96))
    m.box(lid, 0.0, w, 0.0, w * 0.96, 0.0, 0.06, ("band", "planks", "x", 0.5))
    return m


def watchtower():
    """A harbour watch platform: four braced legs, a railed deck and a prow roof, a ladder
    up one side and a lamp under the eave."""
    m = Model("watchtower")
    half, deck, eave = 1.3, 3.6, 5.9
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            m.sweep([(sx * (half + 0.35), sy * (half + 0.35), 0.0), (sx * half, sy * half, deck), (sx * half, sy * half, eave)], (0.22, 0.22), "oak", depth=0.5, caps=False)
    for side in range(4):
        a = math.pi / 2 * side
        c, s = math.cos(a), math.sin(a)

        def spot(u, v, z, c=c, s=s):
            return (u * c - v * s, u * s + v * c, z)

        m.sweep([spot(-half - 0.3, -half - 0.3, 0.4), spot(half, -half, deck - 0.5)], (0.1, 0.12), "oak", depth=0.3, caps=False, shade=0.8)
        m.sweep([spot(-half - 0.15, -half - 0.02, deck + 0.95), spot(half + 0.15, -half - 0.02, deck + 0.95)], (0.1, 0.1), "gilded", depth=0.2, caps=False)
        for k in range(5):
            u = -half + 0.3 + k * (2 * half - 0.6) / 4
            m.sweep([spot(u, -half - 0.02, deck), spot(u, -half - 0.02, deck + 0.95)], (0.07, 0.07), "oak", depth=0.14, caps=False)
    fr = Frame((-half - 0.2, -half - 0.2, deck - 0.14), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, 2 * half + 0.4, 0.0, 0.14, 0.0, 2 * half + 0.4, ("band", "planks", "x", 0.5))
    m.swept_roof(-half - 0.25, half + 0.25, -half - 0.25, half + 0.25, eave, rise=1.7, ridge="y", prow=0.7, sweep=0.5, eave_out=0.4, eave_drop=0.3, gable_out=0.2, thick=0.14, board=0.3, horn=0.6, gable="timber", collide=False)
    for k in range(9):
        z = 0.4 + k * 0.38
        t = z / deck
        m.sweep([((half + 0.35) * (1 - t) + half * t + 0.16, -0.3, z), ((half + 0.35) * (1 - t) + half * t + 0.16, 0.3, z)], (0.06, 0.06), "oak", depth=0.12, caps=False)
    for sy in (-0.3, 0.3):
        m.sweep([(half + 0.51, sy, 0.0), (half + 0.16, sy, deck + 0.1)], (0.07, 0.07), "oak", depth=0.14, caps=False)
    m.hung_lamp(0.0, -half - 0.3, eave - 0.1, 1.1)
    return m


def buoy(flag=False):
    """A channel buoy: a tarred float banded in the town's red and cream, a staff on top."""
    m = Model("buoy_flag" if flag else "buoy")
    axis = Frame((0.0, 0.0, -0.3), (1, 0, 0), UP, (0, 1, 0))
    with tinted(m, (0.72, 0.16, 0.12)):
        m.lathe(axis, [(0.0, 0.0), (0.42, 0.14), (0.46, 0.5), (0.34, 0.92)], sides=10, skin=("band", "plaster", 0.6))
    with tinted(m, (0.94, 0.9, 0.78)):
        m.lathe(axis, [(0.34, 0.92), (0.24, 1.2), (0.0, 1.24)], sides=10, skin=("band", "plaster", 0.6))
    bar(m, (0.0, 0.0, 0.9), (0.0, 0.0, 1.5 if not flag else 2.38), 0.035, band="oak", sides=5)
    m.gem(Vector((0.0, 0.0, 1.54 if not flag else 2.42)), 0.07)
    if flag:
        pts = [(0.0, 0.0, 2.3), (0.0, -0.8, 2.12), (0.0, 0.0, 1.9)]
        with tinted(m, (0.1, 0.14, 0.4)):
            for facing in (1.0, -1.0):
                m.face(pts, [uv_band("plaster", p[1], (p[2] - 1.9) / 0.4, 0.4) for p in pts], "trim", 0.95, (facing, 0.0, 0.0))
    return m


def cart():
    """A two-wheeled hand cart loaded for market."""
    m = Model("cart")
    w, d = 1.5, 2.4
    fr = Frame((-w / 2, -d / 2, 0.62), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, 0.08, 0.0, d, ("band", "planks", "z", 0.5))
    for x0, x1, z0, z1 in ((0.0, w, 0.0, 0.07), (0.0, w, d - 0.07, d), (0.0, 0.07, 0.0, d), (w - 0.07, w, 0.0, d)):
        m.box(fr, x0, x1, 0.08, 0.5, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", 0.42), shade=0.9)
    for sx in (-1.0, 1.0):
        hub = Frame((sx * (w / 2 + 0.07), 0.15, 0.56), (0, 1, 0), (1, 0, 0), (0, 0, 1))
        m.lathe(hub, [(0.56, -0.05), (0.56, 0.05)], sides=12, skin=("band", "oak", 0.1))
        m.lathe(hub, [(0.47, 0.05), (0.56, 0.05)], sides=12, skin=("band", "oak", 0.2), smooth=False, shade=0.8)
        m.lathe(hub, [(0.56, -0.05), (0.47, -0.05)], sides=12, skin=("band", "oak", 0.2), smooth=False, shade=0.8)
        m.lathe(hub, [(0.1, -0.08), (0.1, 0.08)], sides=8, skin=("band", "gilded", 0.16))
        for k in range(6):
            a = math.pi * k / 6
            m.sweep([(sx * (w / 2 + 0.07), 0.15 - 0.5 * math.cos(a), 0.56 - 0.5 * math.sin(a)), (sx * (w / 2 + 0.07), 0.15 + 0.5 * math.cos(a), 0.56 + 0.5 * math.sin(a))], (0.05, 0.05), "oak", depth=0.1, caps=False)
        m.sweep([(sx * (w / 2 - 0.1), -d / 2, 0.64), (sx * (w / 2 - 0.2), -d / 2 - 1.1, 0.78)], (0.07, 0.07), "oak", depth=0.14)
    bar(m, (-w / 2 + 0.2, d / 2 - 0.3, 0.0), (-w / 2 + 0.2, d / 2 - 0.3, 0.62), 0.05, band="oak", sides=5)
    # the tilt: three bent hoops and the canvas over them, open at both ends
    crown = 2.5
    arc = [(w / 2 * math.cos(math.pi * i / 8), 1.12 + (crown - 1.12) * math.sin(math.pi * i / 8)) for i in range(9)]
    for y in (-d / 2 + 0.1, 0.0, d / 2 - 0.1):
        m.sweep([(px, y, pz) for px, pz in arc], (0.07, 0.07), "oak", depth=0.14, caps=False)
    with tinted(m, CANVAS):
        for i in range(8):
            (x0, z0), (x1, z1) = arc[i], arc[i + 1]
            pts = [(x0, -d / 2 + 0.04, z0), (x0, d / 2 - 0.04, z0), (x1, d / 2 - 0.04, z1), (x1, -d / 2 + 0.04, z1)]
            uvs = [uv_band("plaster", p[1], i / 8 + (0 if k in (0, 1) else 1 / 8), 3.0) for k, p in enumerate(pts)]
            m.face(pts, uvs, "trim", 0.8 + 0.2 * math.sin(math.pi * (i + 0.5) / 8), ((x0 + x1) / 2, 0.0, (z0 + z1) / 2 - 1.0))
            m.face(list(reversed(pts)), list(reversed(uvs)), "trim", 0.5, (-(x0 + x1) / 2, 0.0, 1.0 - (z0 + z1) / 2))
    m.crate(-0.3, 0.4, 0.7, size=0.55, turn=0.2)
    m.barrel(0.32, -0.45, 0.7, size=0.52)
    return m


def wheel(m, x, y, radius=0.55):
    """A spoked cart wheel standing on the ground at (x, y), its axle along x."""
    hub = Frame((x, y, radius), (0, 1, 0), (1, 0, 0), (0, 0, 1))
    m.lathe(hub, [(radius, -0.05), (radius, 0.05)], sides=12, skin=("band", "oak", 0.1))
    m.lathe(hub, [(radius - 0.09, 0.05), (radius, 0.05)], sides=12, skin=("band", "oak", 0.2), smooth=False, shade=0.8)
    m.lathe(hub, [(radius, -0.05), (radius - 0.09, -0.05)], sides=12, skin=("band", "oak", 0.2), smooth=False, shade=0.8)
    m.lathe(hub, [(0.1, -0.08), (0.1, 0.08)], sides=8, skin=("band", "gilded", 0.16))
    reach = radius - 0.06
    for k in range(6):
        a = math.pi * k / 6
        m.sweep([(x, y - reach * math.cos(a), radius - reach * math.sin(a)), (x, y + reach * math.cos(a), radius + reach * math.sin(a))], (0.05, 0.05), "oak", depth=0.1, caps=False)


def freight_wagon():
    """The freight caravan's wagon (render/world_quest_freight_visual.ts stands a team before
    it and stacks its cargo on the bed): an open four-wheeled dray, a plank bed between low
    side boards, the driver's bench across its front and the pole run out to the horses.
    Its front is -y, which the game's own wagon turns toward its team."""
    m = Model("freight_wagon")
    w, d, bed = 1.45, 3.0, 0.88
    y0 = -d / 2
    fr = Frame((-w / 2, y0, bed), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, 0.08, 0.0, d, ("band", "planks", "z", 0.5))
    for x0, x1, z0, z1 in ((0.0, w, d - 0.07, d), (0.0, 0.07, 0.0, d), (w - 0.07, w, 0.0, d)):
        m.box(fr, x0, x1, 0.08, 0.42, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", 0.34), shade=0.9)
    # the low front board, and the bench over it on two brackets
    m.box(fr, 0.0, w, 0.08, 0.3, 0.0, 0.07, ("band", "planks", "x", 0.22), shade=0.9)
    m.box(fr, -0.06, w + 0.06, 0.52, 0.6, 0.02, 0.5, ("band", "oak", "x", 0.24))
    for bx in (0.12, w - 0.2):
        m.box(fr, bx, bx + 0.08, 0.08, 0.52, 0.06, 0.4, ("band", "oak", "y", 0.24), shade=0.85)
    # the gilt caps on the corner posts, so it is a carrier's wagon and not a farm cart
    for cx in (0.035, w - 0.035):
        for cz in (0.035, d - 0.035):
            m.gem(fr.p(cx, 0.5, cz), 0.07, stretch=1.2)
    # the two axle beams under the bed, and the wheels
    for ay in (y0 + 0.62, y0 + d - 0.62):
        m.sweep([(-w / 2 - 0.18, ay, 0.55), (w / 2 + 0.18, ay, 0.55)], (0.12, 0.12), "oak", depth=0.24)
        m.sweep([(0.0, ay, 0.55), (0.0, ay, bed)], (0.14, 0.14), "oak", depth=0.24, up=(0, 1, 0), shade=0.85)
        for sx in (-1.0, 1.0):
            wheel(m, sx * (w / 2 + 0.2), ay)
    # the pole out to the team, with its crossbar
    m.sweep([(0.0, y0 + 0.5, 0.6), (0.0, y0 - 0.95, 0.72)], (0.09, 0.09), "oak", depth=0.18)
    m.sweep([(-0.55, y0 - 0.85, 0.72), (0.55, y0 - 0.85, 0.72)], (0.07, 0.07), "oak", depth=0.14)
    return m


def pumpkin():
    """A field pumpkin: squat, ribbed, on its side of the patch with a curl of stalk."""
    m = Model("patch_pumpkin")
    axis = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    with tinted(m, (0.98, 0.5, 0.12)):
        m.lathe(axis, [(0.16, 0.0), (0.42, 0.08), (0.5, 0.3), (0.46, 0.52), (0.3, 0.66), (0.08, 0.64), (0.0, 0.6)], sides=10, skin=("band", "plaster", 0.7), smooth=False)
    with tinted(m, (0.36, 0.5, 0.22)):
        m.sweep([(0.0, 0.0, 0.62), (0.03, 0.02, 0.74), (0.1, 0.05, 0.8)], (0.07, 0.07), "oak", depth=0.14)
    return m


# The street lamp's foot, in the model's own yards: its corners reach 0.45 yards from the post
# once the lamp stands 5.5 yards tall, the release lamp's own collider.
LAMP_FOOT = 0.3705


def lamp_post():
    """The town's street lamp: a coursed stone foot, a turned oak post banded in gilt, and a
    wrought yoke on its head that hangs the lantern straight over the post. The game lights
    the lantern itself: its pane and its flame leave as the two materials the lamp loader
    looks for.

    The lantern hangs over the post, not out on an arm, because of how a lamp collides: the
    game stands a fixture on the middle of its own footprint and plants its collider there
    (sim/streetlamp_style.ts, measured off this file by tests/streetlamp_colliders.test.ts).
    A post under a one-sided arm stands a yard off that middle, so the first lamp built here
    blocked a circle more than twice as wide as the release's, on every road of the vale.
    With the lantern over the post the collider is the foot, and the foot is cut to the
    release lamp's own 0.45 yards."""
    m = Model("streetlamp")
    foot = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    r = LAMP_FOOT
    m.lathe(foot, [(r, 0.0), (r, 0.14), (r - 0.08, 0.2), (r - 0.1, 0.62), (r - 0.04, 0.68), (r - 0.04, 0.78), (0.0, 0.78)], sides=8, skin=("tile", "stone"), smooth=False)
    head = 3.3
    m.lathe(foot, [(0.13, 0.78), (0.11, head)], sides=8, skin=("band", "oak", 0.5))
    for z in (0.92, 2.1, head - 0.13):
        m.lathe(foot, [(0.155, z), (0.155, z + 0.12)], sides=8, skin=("band", "gilded", 0.12))
    # the yoke: two wrought bars that spring from the post's head, bow out round the
    # lantern and meet over it, a gilt finial where they meet
    top = 4.18
    with tinted(m, IRON):
        for side in (-1.0, 1.0):
            m.sweep([(0.0, side * 0.1, head - 0.02), (0.0, side * 0.44, head + 0.3), (0.0, side * 0.46, head + 0.62), (0.0, side * 0.22, top - 0.06), (0.0, 0.0, top)], (0.06, 0.06), "plaster", depth=0.12)
            m.sweep([(0.0, side * 0.12, head - 0.5), (0.0, side * 0.4, head + 0.22)], (0.045, 0.045), "plaster", depth=0.09, caps=False)
    m.lathe(foot, [(0.07, top - 0.02), (0.1, top + 0.06), (0.0, top + 0.22)], sides=8, skin=("band", "gilded", 0.2))
    m.gem(Vector((0.0, 0.0, top + 0.3)), 0.07)
    hang, size = top - 0.06, 1.05
    m.hung_lamp(0.0, 0.0, hang, size)
    # the flame inside the glass
    c = Vector((0.0, 0.0, hang - 0.1 * size - 0.3 * size))
    fr, fh = 0.085, 0.19
    ring = [c + Vector((fr * math.cos(math.tau * k / 6), fr * math.sin(math.tau * k / 6), 0.0)) for k in range(6)]
    for k in range(6):
        a, b = ring[k], ring[(k + 1) % 6]
        for tip in (c + Vector((0.0, 0.0, fh)), c - Vector((0.0, 0.0, fh * 0.6))):
            m.face([a, b, tip], [uv_tile("glass", 0.2, 0.2), uv_tile("glass", 0.6, 0.2), uv_tile("glass", 0.4, 0.6)], "glass", 1.0, (a + b) / 2 - c + (tip - c) * 0.5)
    m.sockets = {"LIGHT_SOCKET": tuple(c)}
    return m


def mailbox():
    """The raven post: a stone foot, an oak post, and a little teal mail house under its own
    prow roof, a gilt band round it and the slot in its front."""
    m = Model("mailbox")
    foot = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(foot, [(0.5, 0.0), (0.5, 0.16), (0.38, 0.24), (0.34, 0.6), (0.0, 0.6)], sides=8, skin=("tile", "stone"), smooth=False)
    post(m, 0.0, 0.0, 0.6, 1.5, size=0.22, cap=False)
    box = Frame((-0.6, -0.42, 1.5), (1, 0, 0), UP, (0, 1, 0))
    m.box(box, 0.0, 1.2, 0.0, 0.86, 0.0, 0.84, ("band", "teal", "y", 0.86))
    m.box(box, -0.05, 1.25, -0.08, 0.02, -0.05, 0.89, ("band", "planks", "x", 0.4))
    m.box(box, -0.02, 1.22, 0.52, 0.64, -0.02, 0.86, ("band", "gilded", "x", 0.12))
    with tinted(m, (0.08, 0.06, 0.05)):
        m.box(Frame((-0.3, -0.435, 1.86), (1, 0, 0)), 0.0, 0.6, 0.0, 0.09, 0.0, 0.01, ("band", "plaster", "x", 0.2), skip="k")
    m.box(Frame((-0.34, -0.44, 1.83), (1, 0, 0)), 0.0, 0.68, 0.0, 0.03, 0.0, 0.03, ("band", "gilded", "x", 0.06))
    m.swept_roof(-0.72, 0.72, -0.55, 0.55, 2.36, rise=0.46, ridge="x", prow=0.2, sweep=0.14, eave_out=0.06, eave_drop=0.1, gable_out=0.04, thick=0.07, board=0.12, horn=0.16, gable="timber", collide=False)
    m.sockets = {"Socket_UnreadGlow": (0.0, -0.5, 1.9), "Socket_MailSlot": (0.0, -0.45, 1.9)}
    return m


def noticeboard():
    """The town notice board: two capped posts, a plank board pinned with notices, a narrow
    prow roof to keep the rain off them."""
    m = Model("noticeboard")
    for sx in (-1.0, 1.0):
        post(m, sx * 1.02, 0.0, 0.0, 2.2, size=0.18, cap=False)
    m.box(Frame((-0.94, 0.03, 0.72), (1, 0, 0)), 0.0, 1.88, 0.0, 1.3, 0.0, 0.08, ("band", "planks", "y", 1.3))
    for z in (0.7, 2.0):
        m.box(Frame((-0.98, -0.01, z), (1, 0, 0)), 0.0, 1.96, 0.0, 0.08, 0.0, 0.1, ("band", "gilded", "x", 0.1))
    notes = ((-0.62, 1.4, 0.46, 0.5, 0.05), (-0.08, 1.3, 0.4, 0.62, -0.06), (0.4, 1.46, 0.42, 0.44, 0.04), (-0.56, 0.84, 0.5, 0.4, -0.04), (0.14, 0.82, 0.56, 0.36, 0.07))
    for i, (x, z, w, h, lean) in enumerate(notes):
        with tinted(m, (1.0, 0.96, 0.82) if i % 2 else (0.96, 0.9, 0.72)):
            fr = Frame((x, -0.045, z), (math.cos(lean), 0.0, math.sin(lean)), (-math.sin(lean), 0.0, math.cos(lean)))
            m.box(fr, 0.0, w, 0.0, h, 0.0, 0.012, ("band", "plaster", "x", 0.5), skip="k")
        m.gem(Vector((x + w / 2, -0.07, z + h - 0.04)), 0.035)
    m.swept_roof(-1.24, 1.24, -0.3, 0.3, 2.2, rise=0.42, ridge="x", prow=0.22, sweep=0.14, eave_out=0.05, eave_drop=0.1, gable_out=0.03, thick=0.07, board=0.12, horn=0.18, gable=None, collide=False)
    # the anchors the game's own board carries (src/render/noticeboard.ts): where a reader
    # touches the board's public face, and where pinned notices hang
    m.sockets = {"Socket_Interaction": (0.0, -0.31, 1.3), "Socket_Notices": (0.0, -0.15, 1.51)}
    return m


def bench():
    """A square bench: a plank seat and back between carved oak ends."""
    m = Model("bench")
    length = 1.8
    fr = Frame((-length / 2, -0.3, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.06, length - 0.06, 0.44, 0.52, 0.04, 0.5, ("band", "planks", "x", 0.46))
    m.box(fr, 0.06, length - 0.06, 0.62, 1.02, 0.5, 0.57, ("band", "planks", "x", 0.4), shade=0.92)
    for x0 in (0.0, length - 0.1):
        m.box(fr, x0, x0 + 0.1, 0.0, 0.5, 0.02, 0.58, ("band", "oak", "y", 0.5), shade=0.8)
        m.box(fr, x0, x0 + 0.1, 0.5, 1.1, 0.46, 0.6, ("band", "oak", "y", 0.6), shade=0.8)
        m.box(fr, x0 - 0.01, x0 + 0.11, 0.66, 0.74, 0.0, 0.5, ("band", "gilded", "z", 0.08))
        m.gem(Vector((x0 + 0.05 - length / 2, 0.23, 1.16)), 0.06)
    return m


def cog(tone=(0.62, 0.16, 0.12)):
    """A harbour cog: a deep round hull under fore and stern castles, one mast and a broad
    square sail in stripes of the town's canvas and `tone`, a lamp on the stern rail."""
    m = Model("cog")
    length, beam, depth = 7.5, 3.3, 1.7
    shape = hull(m, length, beam, depth, sheer=0.5, transom=0.72, stations=14, rows=7, floor=1.05, bow_rise=0.6)
    # the stern castle: teal boarded sides, a planked deck and a gilt rail
    sc = Frame((-1.25, 1.75, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(sc, 0.0, 2.5, 1.5, 2.5, 0.0, 2.05, ("band", "teal", "x", 1.0), skip="b")
    m.box(sc, -0.1, 2.6, 2.5, 2.6, -0.1, 2.15, ("band", "planks", "x", 0.5))
    for x0, x1, z0, z1 in ((-0.1, 2.6, -0.1, -0.02), (-0.1, 2.6, 2.07, 2.15), (-0.1, -0.02, -0.1, 2.15), (2.52, 2.6, -0.1, 2.15)):
        m.box(sc, x0, x1, 3.0, 3.1, z0, z1, ("band", "gilded", "x" if x1 - x0 > z1 - z0 else "z", 0.1))
        count = 6 if x1 - x0 > z1 - z0 else 5
        for k in range(count):
            px = x0 + (x1 - x0) * (k + 0.5) / count if x1 - x0 > z1 - z0 else (x0 + x1) / 2
            pz = (z0 + z1) / 2 if x1 - x0 > z1 - z0 else z0 + (z1 - z0) * (k + 0.5) / count
            m.box(sc, px - 0.035, px + 0.035, 2.6, 3.0, pz - 0.035, pz + 0.035, ("band", "oak", "y", 0.1), skip="tb")
    for x0 in (0.35, 1.5):
        m.box(Frame((-1.25, 3.81, 0.0), (-1, 0, 0), UP, (0, 1, 0)), -x0 - 0.65, -x0, 1.75, 2.3, 0.0, 0.02, ("tile", "glass"), skip="k")
    # the forecastle
    fc = Frame((-0.95, -3.55, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fc, 0.0, 1.9, 2.05, 2.15, 0.0, 1.5, ("band", "planks", "x", 0.5))
    m.box(fc, 0.0, 1.9, 2.55, 2.63, 0.0, 0.08, ("band", "gilded", "x", 0.08))
    for sx in (0.04, 1.86):
        m.box(fc, sx - 0.04, sx + 0.04, 1.2, 2.6, 0.02, 0.1, ("band", "oak", "y", 0.1), skip="tb")
        m.box(fc, sx - 0.04, sx + 0.04, 1.2, 2.15, 1.4, 1.48, ("band", "oak", "y", 0.1), skip="tb")
    # mast, yard and the sail
    bar(m, (0.0, -0.3, 1.0), (0.0, -0.3, 7.25), 0.14, band="oak", sides=8, r1=0.08)
    bar(m, (-1.95, -0.3, 6.25), (1.95, -0.3, 6.25), 0.07, band="oak", sides=6)
    m.gem(Vector((0.0, -0.3, 7.35)), 0.1)
    stripes = 8
    for i in range(stripes):
        x0 = -1.85 + 3.7 * i / stripes
        x1 = -1.85 + 3.7 * (i + 1) / stripes
        with tinted(m, tone if i % 2 == 0 else CANVAS):
            for za, zb, ya, yb in ((2.95, 4.6, -0.52, -0.86), (4.6, 6.2, -0.86, -0.4)):
                pts = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
                uvs = [uv_band("plaster", p[0], (p[2] - 2.95) / 3.25, 3.25) for p in pts]
                m.face(pts, uvs, "trim", 1.0, (0.0, -1.0, 0.0))
                m.face(list(reversed(pts)), list(reversed(uvs)), "trim", 0.72, (0.0, 1.0, 0.0))
    with tinted(m, ROPE):
        for sx in (-1.0, 1.0):
            bar(m, (sx * 1.85, -0.52, 2.95), (sx * 1.4, 0.9, 1.9), 0.02, band="plaster", sides=4, caps=False)
            bar(m, (sx * 1.3, -0.3, 2.0), (0.0, -0.3, 6.9), 0.02, band="plaster", sides=4, caps=False)
    with tinted(m, tone):
        pts = [(0.0, -0.3, 7.2), (0.0, 0.9, 7.05), (0.0, -0.3, 6.8)]
        for facing in (1.0, -1.0):
            m.face(pts, [uv_band("plaster", p[1], (p[2] - 6.8) / 0.4, 0.4) for p in pts], "trim", 0.95, (facing, 0.0, 0.0))
    bar(m, (0.0, 3.86, 2.6), (0.0, 3.86, 3.6), 0.04, band="oak", sides=5)
    m.hung_lamp(0.0, 3.86, 3.62, 0.9)
    m.barrel(0.7, 0.4, 1.05, size=0.55)
    m.barrel(-0.65, 0.75, 1.05, size=0.5)
    m.crate(-0.6, -1.3, 1.05, size=0.6, turn=0.3)
    # the rudder
    m.box(Frame((-0.06, 3.84, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 0.12, 0.05, 1.9, 0.0, 0.5, ("band", "oak", "y", 0.5))
    return m


def flag(tone=None):
    """A standard on a gilt-headed pole: the town's navy and gold, or a plain `tone`."""
    m = Model("flag")
    bar(m, (0.0, 0.0, 0.0), (0.0, 0.0, 5.0), 0.07, band="oak", sides=6, r1=0.05)
    m.gem(Vector((0.0, 0.0, 5.12)), 0.12)
    if tone is None:
        from kit import uv_part

        pts = [(0.0, -0.08, 4.85), (0.0, -1.5, 4.85), (0.0, -1.5, 2.1), (0.0, -0.08, 2.1)]
        uvs = [uv_part("banner", 0.02, 0.02), uv_part("banner", 0.98, 0.02), uv_part("banner", 0.98, 0.98), uv_part("banner", 0.02, 0.98)]
        m.face(pts, uvs, "parts", 1.0, (1.0, 0.0, 0.0))
        m.face(list(reversed(pts)), list(reversed(uvs)), "parts", 0.8, (-1.0, 0.0, 0.0))
    else:
        pts = [(0.0, -0.08, 4.85), (0.0, -2.0, 4.5), (0.0, -1.5, 4.0), (0.0, -2.0, 3.5), (0.0, -0.08, 3.2)]
        with tinted(m, tone):
            for facing in (1.0, -1.0):
                face = pts if facing > 0 else list(reversed(pts))
                m.face(face, [uv_band("plaster", p[1], (p[2] - 3.2) / 1.65, 1.65) for p in face], "trim", 0.95 if facing > 0 else 0.8, (facing, 0.0, 0.0))
    return m


def raider_tent():
    """A raiders' hide tent: red-brown skins over crossed poles, their tips showing at the
    smoke hole."""
    m = Model("raider_tent")
    r, h, sides = 2.2, 2.9, 8
    with tinted(m, (0.58, 0.2, 0.15)):
        for i in range(sides):
            if i == 6:
                continue
            a0, a1 = math.tau * i / sides, math.tau * (i + 1) / sides
            pts = [(r * math.cos(a0), r * math.sin(a0), 0.0), (r * math.cos(a1), r * math.sin(a1), 0.0), (0.18 * math.cos(a1), 0.18 * math.sin(a1), h), (0.18 * math.cos(a0), 0.18 * math.sin(a0), h)]
            uvs = [uv_band("plaster", i * 1.6, 0.0, h), uv_band("plaster", (i + 1) * 1.6, 0.0, h), uv_band("plaster", (i + 1) * 1.6, 1.0, h), uv_band("plaster", i * 1.6, 1.0, h)]
            out = (math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), 0.7)
            m.face(pts, uvs, "trim", 0.82 + 0.18 * (i % 2), out)
            m.face(list(reversed(pts)), list(reversed(uvs)), "trim", 0.45, (-out[0], -out[1], -0.7))
    for i in range(sides):
        a = math.tau * i / sides
        bar(m, (r * 1.02 * math.cos(a), r * 1.02 * math.sin(a), 0.0), (-0.36 * math.cos(a), -0.36 * math.sin(a), h + 0.55), 0.045, band="oak", sides=5, caps=False)
    with tinted(m, (0.86, 0.72, 0.4)):
        for i in range(sides):
            a = math.tau * (i + 0.5) / sides
            m.gem(Vector((r * 0.62 * math.cos(a), r * 0.62 * math.sin(a), h * 0.42)), 0.1, band="plaster", stretch=1.0)
    return m


def house(maker, footing=1.0):
    """One of the town lots (lots.py) stood as a free building, for the settlements whose
    houses are single props: the same model, without its collision table."""
    import kit
    import lots

    before = kit.FOOTING
    kit.FOOTING = footing
    try:
        model, _rows = getattr(lots, maker)()
    finally:
        kit.FOOTING = before
    return model


def cistern():
    """Fenbridge's mirelight cistern: a broad coursed basin, four oak posts and a wrought
    crown over it, and the marsh light burning in a great lantern hung from its peak."""
    m = Model("cistern")
    axis = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(axis, [(1.8, 0.0), (1.72, 0.18), (1.6, 0.24), (1.56, 0.84)], sides=14, skin=("tile", "stone"), smooth=False)
    m.lathe(axis, [(1.56, 0.84), (1.7, 0.88), (1.7, 1.02), (1.34, 1.02), (1.32, 0.5)], sides=14, skin=("tile", "stone"), smooth=False, shade=0.95)
    with tinted(m, WATER):
        m.lathe(axis, [(1.32, 0.6), (0.0, 0.6)], sides=14, skin=("band", "plaster", 1.0), smooth=False)
    for k in range(4):
        a = math.pi / 4 + math.pi / 2 * k
        x, y = 1.5 * math.cos(a), 1.5 * math.sin(a)
        post(m, x, y, 1.0, 1.95, size=0.16, cap=False)
        with tinted(m, IRON):
            m.sweep([(x, y, 1.95), (x * 0.7, y * 0.7, 2.36), (0.0, 0.0, 2.46)], (0.07, 0.07), "plaster", depth=0.14, caps=False)
    m.lathe(Frame((0.0, 0.0, 2.44), (1, 0, 0), UP, (0, 1, 0)), [(0.16, 0.0), (0.2, 0.08), (0.0, 0.2)], sides=8, skin=("band", "gilded", 0.2))
    m.hung_lamp(0.0, 0.0, 2.44, 1.7)
    return m


def haybale():
    """A bound bale of straw."""
    m = Model("haybale")
    with tinted(m, (0.92, 0.76, 0.34)):
        m.box(Frame((-1.0, -0.54, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 2.0, 0.0, 0.9, 0.0, 1.08, ("band", "plaster", "x", 0.5), skip="b")
    with tinted(m, ROPE):
        for x in (-0.5, 0.5):
            m.box(Frame((x - 0.04, -0.56, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 0.08, 0.0, 0.92, 0.0, 1.12, ("band", "plaster", "y", 0.2), skip="b")
    return m


def lumber():
    """A stack of sawn logs between two stakes."""
    m = Model("lumber")
    rows = ((0.0, 4), (0.36, 3), (0.72, 2))
    for z, count in rows:
        for i in range(count):
            y = (i - (count - 1) / 2) * 0.4
            bar(m, (-1.7, y, z + 0.2), (1.7, y, z + 0.2), 0.19, band="oak", sides=7, shade=0.9 if (i + count) % 2 else 1.0)
    for x in (-1.2, 1.2):
        for y in (-0.86, 0.86):
            post(m, x, y, 0.0, 0.9, size=0.1, cap=False)
    return m


def trough():
    """A water trough of pegged boards."""
    m = Model("trough")
    w, d, h = 1.6, 0.8, 0.55
    fr = Frame((-w / 2, -d / 2, 0.14), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, 0.0, 0.07, 0.0, d, ("band", "planks", "x", 0.4))
    for x0, x1, z0, z1 in ((0.0, w, 0.0, 0.07), (0.0, w, d - 0.07, d), (0.0, 0.07, 0.0, d), (w - 0.07, w, 0.0, d)):
        m.box(fr, x0, x1, 0.0, h, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", h), shade=0.9)
    with tinted(m, WATER):
        m.box(fr, 0.07, w - 0.07, h - 0.14, h - 0.1, 0.07, d - 0.07, ("band", "plaster", "x", 0.6), skip="b")
    for x in (-w / 2 + 0.2, w / 2 - 0.2):
        m.box(Frame((x - 0.07, -d / 2 - 0.05, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 0.14, 0.0, 0.2, 0.0, d + 0.1, ("band", "oak", "z", 0.2), shade=0.75)
    return m


def target():
    """An archery butt: a straw boss ringed in the town's colours on a three-legged stand."""
    m = Model("target")
    centre = Vector((0.0, 0.0, 1.5))
    fr = Frame(centre, (1, 0, 0), (0, 0.24, 0.97), (0, -0.97, 0.24))
    rings = ((0.95, (0.94, 0.86, 0.6)), (0.72, (0.66, 0.14, 0.11)), (0.48, (0.94, 0.9, 0.76)), (0.26, (0.1, 0.14, 0.4)), (0.1, (0.92, 0.72, 0.26)))
    for i, (radius, colour) in enumerate(rings):
        with tinted(m, colour):
            pts = [fr.p(radius * math.cos(math.tau * k / 14), radius * math.sin(math.tau * k / 14), 0.01 * i) for k in range(14)]
            m.face(pts, [uv_band("plaster", p.x, 0.5, 1.0) for p in pts], "trim", 1.0, fr.n)
    with tinted(m, (0.88, 0.74, 0.36)):
        m.lathe(Frame(centre, (1, 0, 0), (0, -0.97, 0.24), (0, 0.24, 0.97)), [(0.95, 0.0), (0.95, -0.22), (0.0, -0.22)], sides=14, skin=("band", "plaster", 0.3))
    for a, b in (((-0.7, 0.2, 0.0), (-0.25, 0.1, 2.1)), ((0.7, 0.2, 0.0), (0.25, 0.1, 2.1)), ((0.0, 1.1, 0.0), (0.0, 0.16, 2.0))):
        bar(m, a, b, 0.05, band="oak", sides=5)
    return m


def wheelbarrow():
    """A barrow: a boarded tray on one wheel and two shafts."""
    m = Model("wheelbarrow")
    fr = Frame((-0.45, -0.3, 0.5), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, 0.9, 0.0, 0.06, 0.0, 1.2, ("band", "planks", "z", 0.45))
    for x0, x1, z0, z1 in ((0.0, 0.9, 0.0, 0.06), (0.0, 0.9, 1.14, 1.2), (0.0, 0.06, 0.0, 1.2), (0.84, 0.9, 0.0, 1.2)):
        m.box(fr, x0, x1, 0.06, 0.42, z0, z1, ("band", "planks", "x" if x1 - x0 > z1 - z0 else "z", 0.36), shade=0.9)
    hub = Frame((-0.05, -0.62, 0.34), (0, 1, 0), (1, 0, 0), (0, 0, 1))
    m.lathe(hub, [(0.34, 0.0), (0.34, 0.1)], sides=10, skin=("band", "oak", 0.1))
    m.lathe(hub, [(0.0, 0.0), (0.34, 0.0)], sides=10, skin=("band", "planks", 0.34), smooth=False, shade=0.8)
    m.lathe(hub, [(0.34, 0.1), (0.0, 0.1)], sides=10, skin=("band", "planks", 0.34), smooth=False, shade=0.8)
    for sx in (-0.38, 0.38):
        m.sweep([(sx * 0.4, -0.62, 0.34), (sx, 0.2, 0.52), (sx * 1.1, 1.75, 0.72)], (0.06, 0.06), "oak", depth=0.12)
        bar(m, (sx, 0.75, 0.5), (sx, 0.75, 0.0), 0.035, band="oak", sides=5)
    return m


def cannonballs():
    """A pyramid of shot on a plank tray."""
    m = Model("cannonballs")
    m.box(Frame((-0.6, -0.6, 0.0), (1, 0, 0), UP, (0, 1, 0)), 0.0, 1.2, 0.0, 0.08, 0.0, 1.2, ("band", "planks", "x", 0.4))
    with tinted(m, IRON):
        layers = (((-0.34, 0.0, 0.34), 0.26), ((-0.17, 0.17), 0.54), ((0.0,), 0.82))
        for spots, z in layers:
            for x in spots:
                for y in spots:
                    ball = Frame((x, y, z), (1, 0, 0), UP, (0, 1, 0))
                    m.lathe(ball, [(0.0, -0.18), (0.13, -0.13), (0.18, 0.0), (0.13, 0.13), (0.0, 0.18)], sides=7, skin=("band", "plaster", 0.4))
    return m


def cannon():
    """A harbour gun on its truck carriage."""
    m = Model("cannon")
    for sx in (-1.0, 1.0):
        m.box(Frame((sx * 0.3 - 0.06, -0.9, 0.3), (1, 0, 0), UP, (0, 1, 0)), 0.0, 0.12, 0.0, 0.42, 0.0, 1.8, ("band", "planks", "z", 0.42))
        for y in (-0.55, 0.55):
            hub = Frame((sx * 0.38, y, 0.3), (0, 1, 0), (1, 0, 0), (0, 0, 1))
            m.lathe(hub, [(0.3, -0.06), (0.3, 0.06)], sides=10, skin=("band", "oak", 0.12))
            m.lathe(hub, [(0.0, 0.06), (0.3, 0.06)], sides=10, skin=("band", "planks", 0.3), smooth=False, shade=0.8) if sx > 0 else m.lathe(hub, [(0.3, -0.06), (0.0, -0.06)], sides=10, skin=("band", "planks", 0.3), smooth=False, shade=0.8)
    with tinted(m, IRON):
        bar(m, (0.0, 0.85, 0.82), (0.0, -1.5, 0.92), 0.24, band="plaster", sides=9, r1=0.17)
        for y, r in ((0.6, 0.27), (-0.4, 0.23), (-1.42, 0.21)):
            ring = Frame((0.0, y, 0.83 + (0.6 - y) * 0.043), (1, 0, 0), (0, -1, 0.043), (0, 0.043, 1))
            m.lathe(ring, [(r, -0.05), (r, 0.05)], sides=9, skin=("band", "plaster", 0.1))
    m.gem(Vector((0.0, 0.98, 0.8)), 0.12)
    return m


def wall_length():
    """A length of curtain wall: coursed stone, a walk along its top and merlons to the field."""
    m = Model("wall")
    w, d, h = 4.0, 1.5, 1.6
    fr = Frame((-w / 2, -d / 2, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.box(fr, 0.0, w, -0.3, h, 0.0, d, ("tile", "stone"), skip="b")
    m.box(fr, -0.04, w + 0.04, h, h + 0.12, -0.06, d + 0.06, ("tile", "stone"), shade=0.95)
    for i in range(4):
        x = 0.1 + i * (w - 0.9) / 3
        m.box(fr, x, x + 0.7, h + 0.12, h + 0.62, -0.06, 0.34, ("tile", "stone"))
    return m


def tower_drum(top="roof", flare=0.0):
    """One drum of a round tower, made to stack: a coursed wall with lit slits, and either
    a battlemented head (to carry the next drum) or the witch-hat that finishes the tower."""
    m = Model("tower_" + top)
    r, h = 0.95, 2.6
    axis = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(axis, [(r + 0.08, 0.0), (r + 0.08, 0.16), (r, 0.22), (r + flare, h)], sides=10, skin=("tile", "stone"), smooth=False)
    for k in range(3):
        a = math.tau * (k + 0.25) / 3
        slit = Frame((math.cos(a) * (r + 0.01), math.sin(a) * (r + 0.01), 1.1), (-math.sin(a), math.cos(a), 0.0))
        m.box(slit, -0.1, 0.1, 0.0, 0.6, 0.0, 0.03, ("tile", "glass"), skip="k")
    head = r + flare
    m.lathe(axis, [(head, h), (head + 0.14, h + 0.06), (head + 0.14, h + 0.2), (0.0, h + 0.2)], sides=10, skin=("tile", "stone"), smooth=False, shade=0.95)
    if top == "roof":
        m.lathe(axis, [(head + 0.42, h + 0.12), (head + 0.1, h + 0.5), (head * 0.5, h + 1.5), (head * 0.18, h + 2.3), (0.02, h + 2.9)], sides=10, skin=("tile", "slate"), lean=[(0, 0), (0, 0), (0.05, 0.02), (0.14, 0.05), (0.26, 0.09)])
        m.lathe(axis, [(head + 0.44, h + 0.08), (head + 0.44, h + 0.18)], sides=10, skin=("band", "gilded", 0.1), smooth=False)
        m.gem(Vector((0.26, 0.09, h + 3.0)), 0.08, stretch=1.8)
    else:
        for k in range(8):
            a = math.tau * k / 8
            fr = Frame((math.cos(a) * (head + 0.02), math.sin(a) * (head + 0.02), h + 0.2), (-math.sin(a), math.cos(a), 0.0))
            m.box(fr, -0.17, 0.17, 0.0, 0.34, -0.2, 0.0, ("tile", "stone"))
    return m


# Which release model each prop replaces, and how it is turned on the way out. `turn` is in
# degrees about the up axis (the two market stands and the tents were authored facing other
# ways, and their loaders turn them back). `fit` says how it is laid on the old model's
# bounds: every axis (the default: its footprint must match what the game collides on),
# "inside" (one scale that keeps its own proportions and stays within the old bounds), or
# False (left at the size built: the game stretches those to a box of its own).
PROPS = {
    "props/well": dict(make=well, fit=False),
    "props/market_stand_1": dict(make=lambda: stall(0), turn=90.0, fit=False),
    "props/market_stand_2": dict(make=lambda: stall(1), turn=90.0, fit=False),
    "props/fence": dict(make=fence),
    "props/bonfire": dict(make=bonfire),
    "props/cart": dict(make=cart),
    # the world quests' own pieces, which the release drew from stock kits: the caravan's
    # wagon and the stray pumpkin of Gourdlight Eve's daily. New files, so the kits' own
    # models stay where the dungeons and the editor still read them.
    "quest/freight_wagon": dict(make=freight_wagon, like="biome/city_wagon"),
    "quest/patch_pumpkin": dict(make=pumpkin, like="dungeon/pumpkin_orange"),
    "props/tent_open": dict(make=lambda: tent(False), turn=180.0),
    "props/tent_small": dict(make=lambda: tent(True), turn=180.0),
    "props/dock_platform": dict(make=dock_platform),
    "props/rowboat": dict(make=rowboat),
    "props/gravestone_round": dict(make=lambda: gravestone("round")),
    "props/gravestone_cross": dict(make=lambda: gravestone("cross")),
    "props/gravestone_bevel": dict(make=lambda: gravestone("bevel")),
    "props/gravestone_decorative": dict(make=lambda: gravestone("decorative")),
    "props/timber_pillar": dict(make=timber_pillar),
    "props/crate_wooden": dict(make=crate_prop),
    "props/farmcrate_apple": dict(make=apple_crate),
    "props/barrel": dict(make=barrel_prop),
    "props/anvil": dict(make=anvil),
    "props/weapon_stand": dict(make=weapon_stand),
    "props/lantern_wall": dict(make=wall_lantern),
    "props/garden_iron_fence": dict(make=iron_fence, fit="inside"),
    "props/garden_iron_pillar": dict(make=iron_pillar),
    "props/garden_iron_gate": dict(make=iron_gate),
    "props/garden_arch": dict(make=garden_arch),
    "props/banker_chest": dict(make=chest),
    "biome/hex_boat": dict(make=skiff),
    "biome/sea_boat_fishing": dict(make=fishing_boat),
    "biome/sea_boat_sail_a": dict(make=sail_boat),
    "biome/hex_anchor": dict(make=anchor),
    "biome/hex_sack": dict(make=sack),
    "biome/hex_crate_big": dict(make=crate_prop),
    "biome/hex_crate_open": dict(make=open_crate),
    "biome/hex_barrel": dict(make=barrel_prop),
    "biome/hex_watchtower": dict(make=watchtower, fit="inside"),
    "biome/sea_buoy": dict(make=lambda: buoy(False)),
    "biome/sea_buoy_flag": dict(make=lambda: buoy(True)),
    # the other harbours' ships, standards and raider camps
    "biome/hex_ship_blue": dict(make=lambda: cog((0.12, 0.2, 0.5))),
    "biome/hex_ship_red": dict(make=lambda: cog((0.62, 0.16, 0.12))),
    "biome/hex_ship_green": dict(make=lambda: cog((0.14, 0.4, 0.26))),
    "biome/hex_flag": dict(make=lambda: flag(None), fit="inside"),
    "biome/hex_flag_red": dict(make=lambda: flag((0.66, 0.14, 0.11)), fit="inside"),
    "biome/hexr_tent": dict(make=raider_tent),
    # the settlements built of single house props: the town lots stand in for them
    "biome/hexb_tavern": dict(make=lambda: house("inn"), fit="inside"),
    "biome/hex_tavern": dict(make=lambda: house("inn"), fit="inside"),
    "biome/hexb_townhall": dict(make=lambda: house("bank"), fit="inside"),
    "biome/hexb_market": dict(make=lambda: house("apothecary"), fit="inside"),
    "biome/hex_market": dict(make=lambda: house("apothecary"), fit="inside"),
    "biome/hex_church": dict(make=lambda: house("chapel"), fit="inside"),
    # camp and harbour clutter, wall lengths and the stackable tower drums
    "biome/hex_haybale": dict(make=haybale),
    "biome/hex_lumber": dict(make=lumber),
    "biome/hex_trough": dict(make=trough, fit="inside"),
    "biome/hex_target": dict(make=target, fit="inside"),
    "biome/hex_wheelbarrow": dict(make=wheelbarrow),
    "biome/hex_weaponrack": dict(make=weapon_stand),
    "biome/hex_cannonballs": dict(make=cannonballs),
    "biome/hex_cannon": dict(make=cannon, fit="inside"),
    "biome/hex_wall": dict(make=wall_length),
    "biome/hexr_watchtower": dict(make=watchtower, fit="inside"),
    "biome/hexb_tower_base": dict(make=lambda: tower_drum("battlements")),
    "biome/hex_tower": dict(make=lambda: tower_drum("roof")),
    "biome/hexb_tower_a": dict(make=lambda: tower_drum("roof")),
    "biome/hexr_tower_a": dict(make=lambda: tower_drum("roof")),
    "biome/hexb_tower_b": dict(make=lambda: tower_drum("roof", flare=0.12)),
    # the old village kit's houses, wherever a settlement still stands one
    "props/house_1": dict(make=lambda: house("small_cottage"), fit="inside"),
    "props/house_2": dict(make=lambda: house("cottage"), fit="inside", turn=90.0),
    "props/blacksmith": dict(make=lambda: house("smithy"), fit="inside"),
    "props/inn": dict(make=lambda: house("inn"), fit="inside"),
    # Eastbrook's own lamp, mailbox and notice board. `rename` gives a painted surface the
    # material name its loader looks for; `inside` keeps their proportions.
    # Eastbrook's own lamp, the mailbox and the notice board, on quarter-size maps so each file
    # stays inside the game's budget for it (a lamp 128 KB, the other two 100 KB).
    "props/streetlamp_eastbrook_civic": dict(make=lamp_post, fit=False, tall=5.5, rename={"eh_parts_glow": "LAMP_GLASS", "eh_glass": "LAMP_FLAME"}, maps=256),
    "props/mailbox_pillar": dict(make=mailbox, fit="inside", maps=256),
    "props/eastbrook_noticeboard": dict(make=noticeboard, fit="inside", maps=256),
}

# The castle kit and the settlements' last works live in their own file; it builds on the
# helpers above, so it is read in only once they exist.
from props_castle import CASTLE_PROPS  # noqa: E402

PROPS.update(CASTLE_PROPS)

# The other zones' lamps, the camps and the fen (props_lamps.py), and the statues, landmark
# pieces and planted things (props_heroes.py), and the crafting stations (props_stations.py).
from props_heroes import HERO_PROPS  # noqa: E402
from props_lamps import LAMP_PROPS  # noqa: E402
from props_stations import STATION_PROPS  # noqa: E402
from props_palace import PALACE_PROPS  # noqa: E402  (after the two it builds on)

PROPS.update(LAMP_PROPS)
PROPS.update(HERO_PROPS)
PROPS.update(STATION_PROPS)
PROPS.update(PALACE_PROPS)
