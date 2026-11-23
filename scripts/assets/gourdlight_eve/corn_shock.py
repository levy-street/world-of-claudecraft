# Gourdlight Eve's corn shock: a bundle of dried corn stalks stood on end and tied at the
# waist, the way a harvest field stacks them to cure. Built as a VOLUME, not a fan of cards
# (owner note 2026-10-18: the old shocks read flat from every side but one):
#
#   core     a closed, fluted hourglass body under the stalks: the shadowed heart of the
#            bundle, so a gap between two stalks shows deep straw instead of sky;
#   stalks   round (five-sided) stalks laid over the core on the bundle's own profile,
#            splayed into a skirt at the foot with their cut ends showing, cinched at the
#            tie, flaring out above it and breaking over at the top into drooping tips;
#   leaves   long dry blades with a creased midrib, peeling off the stalks above the tie,
#            curling out and down so the silhouette is ragged, never a clean cone;
#   bands    two lashings round the waist: an orange cord over a twisted twine rope, each
#            strand a real helix, sunk into the bundle where they bite, finished with a
#            knot and two loose ends;
#   ears     three ears of corn tucked in under the lashing, husks peeled back.
#
# Three materials, the same contract as before (Straw, Ribbon, GourdSkin), so the decor
# view's instanced parts and draw count do not change. Vertex colour carries the shading
# the eye needs at street distance: the stalks darken toward the bundle's heart and
# under the tie (a cheap baked occlusion), the cut ends read pale.
#
# Determinism: no clock, no `random`; variety is m.h01 / m.hs of a tag.

import math

import bmesh
from mathutils import Matrix, Vector

TAU = math.pi * 2.0

STRAW = (0.8, 0.66, 0.35)
STRAW_PALE = (0.9, 0.79, 0.5)
STRAW_DARK = (0.45, 0.33, 0.15)
STRAW_DEEP = (0.24, 0.17, 0.08)
LEAF_GREY = (0.62, 0.55, 0.4)
CORD = (0.95, 0.42, 0.05)
TWINE = (0.5, 0.39, 0.2)


class Shape:
    """The bundle's profile for one shock: radius of the stalk layer at height z."""

    def __init__(self, height):
        self.h = height
        self.tie = 0.42 * height
        self.foot_r = 0.5
        self.waist_r = 0.15
        self.shoulder_r = 0.38
        self.crown_r = 0.47

    def radius(self, z):
        h, tie = self.h, self.tie
        if z <= tie:
            u = max(0.0, z) / tie
            # a skirt that flares hard in the last hand's breadth above the ground
            return self.waist_r + (self.foot_r - self.waist_r) * (1.0 - u) ** 1.7
        u = (z - tie) / (h - tie)
        if u <= 0.62:
            k = u / 0.62
            return self.waist_r + (self.shoulder_r - self.waist_r) * math.sin(k * math.pi / 2) ** 1.2
        k = (u - 0.62) / 0.38
        return self.shoulder_r + (self.crown_r - self.shoulder_r) * k


def _frame(tdir):
    up = Vector((0, 0, 1)) if abs(tdir.z) < 0.92 else Vector((1, 0, 0))
    n1 = tdir.cross(up).normalized()
    n2 = tdir.cross(n1).normalized()
    return n1, n2


def sweep(bm, pts, radii, sides, cap_start=True, cap_end=True):
    """A tube along `pts` with a radius per point (parallel-transported frames, so a curving
    stalk never twists flat). Returns (rings, start_cap_face, end_cap_face)."""
    rings = []
    n1 = None
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)])
        b = Vector(pts[min(len(pts) - 1, i + 1)])
        t = (b - a).normalized()
        if n1 is None:
            n1, _ = _frame(t)
        else:
            n1 = (n1 - t * n1.dot(t)).normalized()
        n2 = t.cross(n1).normalized()
        ring = []
        for k in range(sides):
            ang = k / sides * TAU
            ring.append(bm.verts.new(Vector(p) + (n1 * math.cos(ang) + n2 * math.sin(ang)) * radii[i]))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    f0 = bm.faces.new(list(reversed(rings[0]))) if cap_start else None
    f1 = bm.faces.new(rings[-1]) if cap_end else None
    return rings, f0, f1


def core_bm(m, tag, shape):
    """The fluted hourglass under the stalks, closed top and bottom."""
    bm = bmesh.new()
    sides = 22
    zs = [0.0, 0.12, 0.3, 0.55, 0.72, 0.86, 1.0]
    top = shape.h * 0.76
    rings = []
    for zi, zf in enumerate(zs):
        z = 0.02 + zf * (top - 0.02)
        r0 = max(0.04, shape.radius(z) - 0.045)
        if zf > 0.7:
            # a domed crown, so a look down into the shock meets packed straw
            r0 *= 1.0 - 1.9 * (zf - 0.7) ** 1.3
        ring = []
        for k in range(sides):
            a = k / sides * TAU
            # a groove for every stalk-width round it, so the packed heart reads as more
            # stalks in the gaps between the round ones laid over it
            flute = 1.0 + 0.08 * math.cos(a * 15 + 0.6 * m.hs(tag, "flute", zi)) + 0.03 * m.hs(tag, "core", zi, k)
            ring.append(bm.verts.new((math.cos(a) * r0 * flute, math.sin(a) * r0 * flute, z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(list(reversed(rings[0])))
    cap = bm.verts.new((0, 0, top + 0.06))
    last = rings[-1]
    for k in range(sides):
        bm.faces.new((last[k], last[(k + 1) % sides], cap))
    return bm


def stalk_path(m, tag, shape, s, count, inner=False):
    """One stalk's centreline on the bundle profile: its bearing, a slow spiral, its own
    height, the foot splayed out, the top arching over and drooping outward (an outer
    stalk), or rising out of the crown and nodding (an inner one, filling the top)."""
    a0 = s / count * TAU + 0.35 * m.hs(tag, "a", s, inner)
    twist = 0.22 * m.hs(tag, "tw", s, inner)
    h = shape.h * (0.86 + 0.2 * m.h01(tag, "h", s, inner))
    if inner:
        h = shape.h * (0.95 + 0.15 * m.h01(tag, "ih", s))
    out = 0.012 + 0.025 * m.h01(tag, "out", s)
    break_at = 0.68 + 0.16 * m.h01(tag, "brk", s, inner)
    droop = 0.18 + 0.4 * m.h01(tag, "drp", s, inner)
    segs = 5
    pts = []
    for i in range(segs + 1):
        t = i / segs
        z = h * t
        a = a0 + twist * t
        if inner:
            # two rings inside the crown: most at half the bundle, every third near its heart
            r = (0.22 if s % 3 == 0 else 0.55) * shape.radius(min(z, shape.h))
        else:
            r = shape.radius(min(z, shape.h)) + out * (1.0 - math.exp(-((z - shape.tie) / 0.12) ** 2))
        if t > break_at:
            # past the break the stalk arches outward and its tip nods down
            k = (t - break_at) / (1.0 - break_at)
            r += droop * 0.42 * k * k
            z -= droop * 0.3 * k ** 2.4 * h / shape.h
        if i == 0 and not inner:
            r += 0.04 + 0.05 * m.h01(tag, "splay", s)
        pts.append((math.cos(a) * r, math.sin(a) * r, z))
    return pts


def stalks_bm(m, tag, shape, count, inner_count):
    bm = bmesh.new()
    for inner, n in ((False, count), (True, inner_count)):
        for s in range(n):
            pts = stalk_path(m, tag, shape, s, n, inner)
            r0 = (0.02 if inner else 0.025) + 0.007 * m.h01(tag, "rad", s, inner)
            last = len(pts) - 1
            radii = [max(0.0035, r0 * (1.0 - 0.85 * (i / last) ** 1.6)) for i in range(len(pts))]
            sweep(bm, pts, radii, 4, cap_start=not inner, cap_end=False)
    return bm


def leaf_strip(bm, base, direction, length, width, curl, twist, segs=5):
    """A creased dry leaf: three verts across (edge, midrib, edge) so it catches light on
    both halves, tapering to a point, arcing out and down by `curl`, twisting along."""
    d = Vector(direction).normalized()
    side, _ = _frame(d)
    rows = []
    for i in range(segs + 1):
        t = i / segs
        p = Vector(base) + d * (length * t) + Vector((0, 0, -curl * t * t * length))
        w = width * math.sin(math.pi * min(0.97, 0.12 + t * 0.95)) * (1.0 - 0.75 * t)
        rot = Matrix.Rotation(twist * t, 3, d)
        sv = rot @ side
        crease = Vector((0, 0, 1)) * (w * 0.35)
        rows.append((
            bm.verts.new(p - sv * w),
            bm.verts.new(p + crease),
            bm.verts.new(p + sv * w),
        ))
    for r0, r1 in zip(rows, rows[1:]):
        bm.faces.new((r0[0], r0[1], r1[1], r1[0]))
        bm.faces.new((r0[1], r0[2], r1[2], r1[1]))


def leaves_into(m, tag, shape, bm, count):
    for i in range(count):
        a = i / count * TAU + 0.5 * m.hs(tag, "la", i)
        u = m.h01(tag, "lz", i)
        z = shape.tie + 0.12 + u * (shape.h * 0.92 - shape.tie - 0.12)
        r = shape.radius(z) + 0.02
        base = (math.cos(a) * r, math.sin(a) * r, z)
        out = Vector((math.cos(a), math.sin(a), 0.55 + 0.35 * m.h01(tag, "lup", i)))
        leaf_strip(
            bm,
            base,
            out,
            0.45 + 0.4 * m.h01(tag, "ll", i),
            0.05 + 0.025 * m.h01(tag, "lw", i),
            1.1 + 0.8 * m.h01(tag, "lc", i),
            1.6 * m.hs(tag, "lt", i),
        )
    # a few short broken blades low on the skirt, hanging down over the foot
    for i in range(4):
        a = (i + 0.5) / 4 * TAU + 0.4 * m.hs(tag, "sa", i)
        z = shape.tie * (0.35 + 0.4 * m.h01(tag, "sz", i))
        r = shape.radius(z) + 0.015
        base = (math.cos(a) * r, math.sin(a) * r, z)
        leaf_strip(bm, base, (math.cos(a), math.sin(a), -0.6), 0.26, 0.04, 0.3, 0.8 * m.hs(tag, "st", i), 4)


def rope_into(m, tag, shape, bm, z, bite, strands, seg=18, sides=3, strand_r=0.0115, lay=0.013, turns=9):
    """A lashing round the waist at height `z`: `strands` twisted strands on a ring that
    bites `bite` into the bundle, wobbling with the stalks under it."""
    # it sits ON the stalk layer (their centreline plus a stalk's radius), biting a little
    ring_r = shape.radius(z) + 0.03 + strand_r + lay - bite
    for st in range(strands):
        pts = []
        for i in range(seg + 1):
            t = i / seg
            a = t * TAU
            wob = 0.008 * math.sin(a * 5 + st) + 0.004 * m.hs(tag, "wob", i)
            hel = a * turns + st * TAU / strands
            rr = ring_r + wob + lay * math.cos(hel)
            zz = z + lay * math.sin(hel) + 0.012 * math.sin(a + 0.6)
            pts.append((math.cos(a) * rr, math.sin(a) * rr, zz))
        sweep(bm, pts, [strand_r] * len(pts), sides, cap_start=False, cap_end=False)


def knot_into(m, tag, shape, bm, z):
    """The knot on the front of the lashing and its two loose ends hanging down."""
    a = -math.pi / 2 + 0.25
    r = shape.radius(z) + 0.065
    c = Vector((math.cos(a) * r, math.sin(a) * r, z))
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0,
                               matrix=Matrix.Translation(c) @ Matrix.Diagonal((0.035, 0.03, 0.03, 1)))
    for k, (da, dl) in enumerate(((-0.25, 0.2), (0.3, 0.26))):
        pts = []
        for i in range(5):
            t = i / 4
            aa = a + da * t
            rr = r + 0.02 + 0.03 * t
            pts.append((math.cos(aa) * rr, math.sin(aa) * rr, z - 0.01 - dl * t))
        sweep(bm, pts, [0.008 * (1.0 - 0.5 * (i / 4)) for i in range(5)], 4)


def ears_bm(m, tag, shape):
    """Three ears of flint corn tucked in under the lashing, husks peeled back."""
    bm = bmesh.new()
    husk_faces = []
    for k, (a, dz) in enumerate(((0.6, 0.22), (2.7, 0.3), (4.6, 0.18))):
        z = shape.tie + dz
        r = shape.radius(z) + 0.05
        c = Vector((math.cos(a) * r, math.sin(a) * r, z))
        tilt = Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(-0.5, 4, "Y")
        mat = Matrix.Translation(c) @ tilt
        ret = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0,
                                        matrix=mat @ Matrix.Diagonal((0.042, 0.042, 0.17, 1)))
        # the kernel rows: a fine ridged surface (the vertex colour paints the kernels)
        inv = mat.inverted()
        for v in ret["verts"]:
            lv = inv @ v.co
            bump = 1.0 + 0.06 * math.cos(math.atan2(lv.y, lv.x) * 10)
            v.co = mat @ Vector((lv.x * bump, lv.y * bump, lv.z))
        # three husk blades peeled back from the ear's foot
        for h in range(3):
            ha = a + (h - 1) * 0.9
            foot = c - (tilt @ Vector((0, 0, 0.13, 0))).to_3d()
            before = len(bm.faces)
            leaf_strip(bm, foot, (math.cos(ha) * 0.9, math.sin(ha) * 0.9, 0.25), 0.26, 0.05, 0.9, 0.6, 4)
            husk_faces.extend(range(before, len(bm.faces)))
    return bm, set(husk_faces)


FLINT = [
    (0.62, 0.16, 0.06),
    (0.86, 0.44, 0.08),
    (0.93, 0.66, 0.16),
    (0.9, 0.56, 0.12),
    (0.78, 0.3, 0.07),
    (0.42, 0.14, 0.1),
]


def build(m, stall, collection, name, tag, height=2.2):
    """The finished shock: three parts joined (Straw, Ribbon, GourdSkin)."""
    shape = Shape(height)
    count = 38
    # the core and the stalks and leaves: one Straw part
    sbm = core_bm(m, tag, shape)
    core_faces = len(sbm.faces)
    stb = stalks_bm(m, tag, shape, count, 10)
    leaves_into(m, tag, shape, stb, 16)
    tmp = stall_join_bm(sbm, stb)

    def straw_tint(mn, co, fc, pi):
        if pi < core_faces:
            # the heart of the bundle: shadowed straw, streaked stalk by stalk (the flutes),
            # a touch lighter up where light gets in between the stalks
            k = min(1.0, max(0.0, co.z / shape.h))
            streak = 0.5 + 0.5 * math.cos(math.atan2(co.y, co.x) * 15)
            base = m.mix(STRAW_DARK, STRAW, 0.15 + 0.3 * k + 0.25 * streak)
            g = 0.55 + 0.2 * m.h01(tag, "cs", pi % 30)
            return (base[0] * g, base[1] * g, base[2] * g)
        rr = math.hypot(co.x, co.y)
        depth = rr - shape.radius(min(max(co.z, 0.0), shape.h))
        # baked occlusion: the stalks darken toward the core and in the tie's shadow
        occ = min(1.0, max(0.0, (depth + 0.02) / 0.06))
        tie_shade = 1.0 - 0.35 * math.exp(-((co.z - shape.tie) / 0.18) ** 2)
        foot_shade = 0.75 + 0.25 * min(1.0, co.z / 0.35)
        base = m.mix(STRAW_DARK, STRAW, 0.45 + 0.4 * m.h01(tag, "sc", pi // 40))
        if co.z > shape.tie + 0.1 and m.h01(tag, "grey", pi // 40) < 0.3:
            base = m.mix(base, LEAF_GREY, 0.5)
        if co.z < 0.06:
            base = STRAW_PALE  # the cut ends at the foot
        g = (0.55 + 0.45 * occ) * tie_shade * foot_shade
        return (base[0] * g, base[1] * g, base[2] * g)

    straw = stall.part(m, name + "_stalks", tmp, collection, ["Straw"], straw_tint, smooth=True)

    # the lashings and the knot: one Ribbon part
    rbm = bmesh.new()
    # two turns of orange cord over a twisted twine rope
    rope_into(m, tag + "-cord", shape, rbm, shape.tie + 0.03, 0.004, 2, strand_r=0.017, lay=0.016)
    rope_into(m, tag + "-cord2", shape, rbm, shape.tie + 0.1, 0.004, 2, strand_r=0.017, lay=0.016)
    cord_faces = len(rbm.faces)
    rope_into(m, tag + "-twine", shape, rbm, shape.tie - 0.07, 0.004, 2, seg=18, strand_r=0.01, lay=0.011, turns=11)
    knot_into(m, tag, shape, rbm, shape.tie + 0.065)

    def rope_tint(mn, co, fc, pi):
        shade = 0.82 + 0.18 * math.sin(math.atan2(co.y, co.x) * 9 + co.z * 140)
        c = CORD if (pi < cord_faces or co.z > shape.tie + 0.02) else TWINE
        return (c[0] * shade, c[1] * shade, c[2] * shade)

    rope = stall.part(m, name + "_tie", rbm, collection, ["Ribbon"], rope_tint, smooth=True)

    ebm, husks = ears_bm(m, tag, shape)

    def ear_tint(mn, co, fc, pi):
        if pi in husks:
            return m.mix((0.66, 0.58, 0.38), (0.82, 0.74, 0.52), m.h01("husk", pi // 8))
        # flint corn: every kernel its own colour, deep red through gold to cream
        return FLINT[int(m.h01(tag, "kernel", pi) * len(FLINT)) % len(FLINT)]

    ears = stall.part(m, name + "_ears", ebm, collection, ["GourdSkin"], ear_tint, smooth=True)
    return m.join([straw, rope, ears], name)


def stall_join_bm(a, b):
    """Append bmesh `b` into `a` (faces keep their order: a's first), free `b`."""
    vmap = {}
    for v in b.verts:
        vmap[v] = a.verts.new(v.co)
    for f in b.faces:
        a.faces.new([vmap[v] for v in f.verts])
    b.free()
    return a
