# Balgath's Starwake VFX kit: a deterministic Blender factory.
#
# The fallen star in Balgath's crater wakes: star crystals split out of the meteor and
# glow, lava fissures crawl across the fen, geysers burst and molten pools linger. The
# renderer draws the solid pieces of that mechanic from ONE GLB with seventeen named
# mesh nodes (the names are the runtime contract, see contract.mjs):
#
#   star_crystal_0 .. 5   glowing faceted star-crystal shards planted around and on the
#                         meteor; BASE at the origin, growing up +Y
#   lava_chunk_0 .. 5     molten gobbets a geyser throws: black basalt crust split by
#                         glowing cracks, one face still white-hot; surface-centroid pivot
#   pool_crust_0 .. 3     flat cooling-crust plates that float on a molten pool, lying in
#                         the XZ plane with glowing rims and crack lines; centroid pivot
#   geyser_column         the lava plume: a tapering column with a lumpy splash crown and
#                         thrown droplets; BASE at the origin, height 1
#
# The shipping GLB is made by scripts/assets/balgath_starwake/export_balgath_starwake.mjs,
# which runs this file through Blender in --background, stamps the source fingerprint,
# and optimizes through scripts/assets/build_assets.mjs with specs/balgath_starwake.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/balgath_starwake/model.py -- --out <dir>
#
# Style: the Boulder Toss kit's texture-free lane. Every colour is a VERTEX colour. The
# glowing parts (crystals, cracks, rims, the column) are painted in bright ramps because
# the renderer draws them with an additive, vertex-colour-multiplied basic material, so
# a bright vertex reads as light; the basalt stays near-black so it reads as a crust
# against the glow. Facets are genuinely flat (a chipped, stylized silhouette).
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of a
# descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up, which the glTF exporter turns into +Y up. Chunks and crusts sit at
# the origin centred on their own surface centroid (area weighted). Crystals and the
# column are BASE-anchored: their lowest point is z = 0 and their bounding box is centred
# on the origin in X and Y (glTF X and Z), so the renderer plants them on the ground.

import hashlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

TAU = math.pi * 2.0

# ---------------------------------------------------------------------------
# deterministic variation
# ---------------------------------------------------------------------------


def h01(*parts):
    """A stable [0, 1) value for a tag (sha256, so identical on every machine)."""
    text = "|".join(str(p) for p in parts)
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16) / float(1 << 48)


def hs(*parts):
    """A stable [-1, 1) value for a tag."""
    return h01(*parts) * 2.0 - 1.0


def hdir(*parts):
    """A stable unit direction for a tag (uniform on the sphere)."""
    z = hs(*parts, "z")
    phi = TAU * h01(*parts, "phi")
    r = math.sqrt(max(0.0, 1.0 - z * z))
    return Vector((math.cos(phi) * r, math.sin(phi) * r, z))


def fbm(d, tag, octaves=3, freq=1.7):
    """Smooth hashed noise over a point: a few summed sine ridges per octave."""
    s = 0.0
    amp = 1.0
    total = 0.0
    f = freq
    for o in range(octaves):
        for k in range(3):
            w = hdir(tag, "fbm", o, k)
            ph = TAU * h01(tag, "fph", o, k)
            s += amp * math.sin(f * d.dot(w) + ph)
            total += amp
        amp *= 0.5
        f *= 2.13
    return s / (total * 0.62)


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


# ---------------------------------------------------------------------------
# palette (authored in sRGB, stored linear: glTF COLOR_0 is linear)
# ---------------------------------------------------------------------------


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(hexv):
    return (
        _lin(((hexv >> 16) & 255) / 255.0),
        _lin(((hexv >> 8) & 255) / 255.0),
        _lin((hexv & 255) / 255.0),
    )


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def mul(c, k):
    return tuple(max(0.0, min(1.0, c[i] * k)) for i in range(3))


def ramp(stops, t):
    """Piecewise-linear colour ramp over (position, colour) stops."""
    t = clamp(t)
    for k in range(len(stops) - 1):
        t0, c0 = stops[k]
        t1, c1 = stops[k + 1]
        if t <= t1:
            return mix(c0, c1, (t - t0) / max(1e-6, t1 - t0))
    return stops[-1][1]


# Star crystal: deep orange-red where it leaves the ground, warm amber through the body,
# a near-white pale gold at the tip.
STAR_BASE = srgb(0xA8280C)
STAR_LOW = srgb(0xE0561A)
STAR_AMBER = srgb(0xFFA02A)
STAR_GOLD = srgb(0xFFD877)
STAR_TIP = srgb(0xFFF6DA)
STAR_RAMP = [(0.0, STAR_BASE), (0.18, STAR_LOW), (0.5, STAR_AMBER), (0.8, STAR_GOLD), (1.0, STAR_TIP)]

# Basalt crust: near-black brown, never grey-blue.
BASALT = srgb(0x2A201B)
BASALT_DARK = srgb(0x17110E)
BASALT_LIGHT = srgb(0x3E3129)
BASALT_WARM = srgb(0x4A2A1C)  # the crust just above a crack, heat-stained

# Molten glow: dull red through orange to a white-hot yellow.
EMBER_DULL = srgb(0x7A1C0A)
EMBER_RED = srgb(0xC8340C)
EMBER_ORANGE = srgb(0xFF7A14)
EMBER_YELLOW = srgb(0xFFC23A)
EMBER_WHITE = srgb(0xFFF1B0)

# Geyser column: white-yellow at the vent, orange through the body, a darkening
# red-brown crown where the spray cools.
COLUMN_RAMP = [
    (0.0, srgb(0xFFF4B8)),
    (0.14, srgb(0xFFD650)),
    (0.4, srgb(0xFF8A1C)),
    (0.66, srgb(0xE0480E)),
    (0.84, srgb(0x9A2A0E)),
    (1.0, srgb(0x5A2012)),
]

# Material buckets. The NAMES are the contract (contract.mjs pins them): the renderer
# may key surface treatment on them, and the test fails on any other name.
MAT_BASALT = "basalt"
MAT_EMBER = "ember"
MAT_CRYSTAL = "crystal"
MATERIAL_ORDER = [MAT_BASALT, MAT_EMBER, MAT_CRYSTAL]

MATERIAL_DEFS = {
    MAT_BASALT: {"metallic": 0.0, "roughness": 0.92, "emission": 0.0},
    MAT_EMBER: {"metallic": 0.0, "roughness": 0.6, "emission": 1.0},
    MAT_CRYSTAL: {"metallic": 0.0, "roughness": 0.25, "emission": 1.0},
}

# ---------------------------------------------------------------------------
# base meshes
# ---------------------------------------------------------------------------


def icosphere(level):
    """A unit icosphere as (list of Vector, list of [a, b, c])."""
    t = (1.0 + math.sqrt(5.0)) / 2.0
    base = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    verts = [Vector(p).normalized() for p in base]
    faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    for _ in range(level):
        mids = {}

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in mids:
                verts.append(((verts[a] + verts[b]) * 0.5).normalized())
                mids[key] = len(verts) - 1
            return mids[key]

        nxt = []
        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nxt += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        faces = nxt
    return verts, faces


def cut_rock(tag, level, planes, stretch, skin_noise, angle=0.6):
    """Every vertex of a subdivided sphere is pulled in to the NEAREST of a set of planes
    (or its own lumpy skin radius, whichever is closer), so whole patches land exactly on
    a plane and read as flat chipped facets. Coplanar triangles are then dissolved into
    one face per facet and re-triangulated. Returns (verts, tris, face_class) with
    class 0 = skin, 1 + i = plane i."""
    dirs, faces = icosphere(level)
    pos = []
    owner = []
    for d in dirs:
        r = 1.0 + skin_noise * fbm(d, tag, 3, 1.9)
        who = -1
        for i, (n, off) in enumerate(planes):
            c = d.dot(n)
            if c > 1e-4 and off / c < r:
                r = off / c
                who = i
        p = d * r
        pos.append(Vector((p.x * stretch[0], p.y * stretch[1], p.z * stretch[2])))
        owner.append(who)

    bm = bmesh.new()
    bverts = [bm.verts.new(p) for p in pos]
    for f in faces:
        o = {owner[i] for i in f}
        cls = (next(iter(o)) + 1) if len(o) == 1 and -1 not in o else 0
        bf = bm.faces.new([bverts[i] for i in f])
        bf.material_index = cls
    bm.normal_update()
    bmesh.ops.dissolve_limit(
        bm,
        angle_limit=math.radians(angle),
        use_dissolve_boundaries=False,
        verts=list(bm.verts),
        edges=list(bm.edges),
        delimit={"MATERIAL"},
    )
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    tris = []
    cls = []
    for f in bm.faces:
        tris.append([v.index for v in f.verts])
        cls.append(f.material_index)
    bm.free()
    return verts, tris, cls


def plane_set(tag, count, off_lo, off_hi, min_z=-1.0, max_z=1.0):
    """`count` hashed fracture planes whose normals keep inside a z band."""
    out = []
    k = 0
    while len(out) < count and k < count * 40:
        n = hdir(tag, "plane", k)
        k += 1
        if n.z < min_z or n.z > max_z:
            continue
        # keep planes from stacking onto the same facet
        if any(n.dot(m) > 0.82 for m, _ in out):
            continue
        off = off_lo + (off_hi - off_lo) * h01(tag, "off", k)
        out.append((n, off))
    return out


def ring_band(tris, a0, b0, sides):
    """Quads between two rings of `sides` vertices starting at a0 and b0 (b above a)."""
    for s in range(sides):
        a = a0 + s
        b = a0 + (s + 1) % sides
        c = b0 + (s + 1) % sides
        d = b0 + s
        tris.append([a, b, c])
        tris.append([a, c, d])


# ---------------------------------------------------------------------------
# the piece accumulator (per-face material, per-corner colour)
# ---------------------------------------------------------------------------


class Piece:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.tris = []
        self.kind = []  # per face: the part it came from
        self.cls = []  # per face: 0 skin, >0 fracture facet (rocks), or a part index
        self.mats = []  # per face: material bucket, filled by the painter
        self.cols = []  # per face: three corner colours, filled by the painter

    def add(self, verts, tris, kind, cls=None, inside=None):
        """Append a part. `inside(c)` names a point INSIDE the part near face centroid
        c; every face is wound so its normal points away from it (three.js lights
        by winding, and the exporter carries it through)."""
        base = len(self.verts)
        verts = [Vector(v) for v in verts]
        self.verts.extend(verts)
        for i, t in enumerate(tris):
            if inside is not None:
                a, b, c = (verts[j] for j in t)
                n = (b - a).cross(c - a)
                cen = (a + b + c) / 3.0
                if n.dot(cen - inside(cen)) < 0.0:
                    t = [t[0], t[2], t[1]]
            self.tris.append([base + j for j in t])
            self.kind.append(kind)
            self.cls.append(cls[i] if cls is not None else 0)

    def face_data(self, fi):
        a, b, c = (self.verts[i] for i in self.tris[fi])
        n = (b - a).cross(c - a)
        area = n.length * 0.5
        if n.length > 1e-12:
            n.normalize()
        return (a + b + c) / 3.0, n, area

    def centroid(self):
        """The area-weighted surface centroid: robust to how the mesh is split."""
        acc = Vector((0.0, 0.0, 0.0))
        total = 0.0
        for fi in range(len(self.tris)):
            c, _n, area = self.face_data(fi)
            acc += c * area
            total += area
        return acc / total

    def recenter(self):
        c = self.centroid()
        self.verts = [v - c for v in self.verts]

    def plant(self):
        """Base-anchor: the lowest point to z = 0, the bounding box centred in x and y."""
        (x0, y0, z0), (x1, y1, _z1) = self.bounds()
        off = Vector(((x0 + x1) * 0.5, (y0 + y1) * 0.5, z0))
        self.verts = [v - off for v in self.verts]

    def radius(self):
        return max(v.length for v in self.verts)

    def scale(self, k):
        self.verts = [v * k for v in self.verts]

    def scale_axes(self, kx, ky, kz):
        self.verts = [Vector((v.x * kx, v.y * ky, v.z * kz)) for v in self.verts]

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def extent(self):
        (x0, y0, z0), (x1, y1, z1) = self.bounds()
        return x1 - x0, y1 - y0, z1 - z0

    def length(self):
        return max(self.extent())

    def height(self):
        return self.extent()[2]

    def triangles(self):
        return len(self.tris)


def vertex_cavity(pc, faces=None):
    """Per-vertex concavity: how far the one-ring's average sits OUT past the vertex along
    its normal, over the ring's mean edge. Positive is a crevice (darkened), negative a
    ridge or worn edge (lightened). Only faces in `faces` contribute (default: all)."""
    faces = range(len(pc.tris)) if faces is None else faces
    nb = [set() for _ in pc.verts]
    nrm = [Vector((0.0, 0.0, 0.0)) for _ in pc.verts]
    for fi in faces:
        t = pc.tris[fi]
        _c, n, area = pc.face_data(fi)
        for i in t:
            nrm[i] += n * area
            for j in t:
                if j != i:
                    nb[i].add(j)
    out = [0.0] * len(pc.verts)
    for i, p in enumerate(pc.verts):
        if not nb[i] or nrm[i].length < 1e-12:
            continue
        n = nrm[i].normalized()
        avg = Vector((0.0, 0.0, 0.0))
        edge = 0.0
        for j in nb[i]:
            avg += pc.verts[j]
            edge += (pc.verts[j] - p).length
        avg /= len(nb[i])
        edge /= len(nb[i])
        out[i] = (avg - p).dot(n) / max(edge, 1e-6)
    return out


def corner_shade(base, cav, dark=1.7, lift=0.55, floor=0.42):
    """Darken the crevices and lift the worn ridges, per corner."""
    if cav > 0.0:
        k = max(floor, 1.0 - dark * cav)
    else:
        k = min(1.18, 1.0 - lift * cav)
    return mul(base, k)


def vkey(tag, p):
    """A hash key for a vertex position (split corners of one vertex agree)."""
    return (tag, round(p.x, 4), round(p.y, 4), round(p.z, 4))


def basalt_colour(tag, p, n):
    """The cooled crust at a point: near-black brown with a faint tonal drift and a
    lighter glint on the up-facing facets."""
    tone = fbm(p, tag + "tone", 3, 7.0)
    col = mix(BASALT, BASALT_LIGHT if tone > 0.0 else BASALT_DARK, 0.55 * abs(tone))
    if n.z > 0.0:
        col = mix(col, BASALT_LIGHT, 0.25 * n.z)
    return col


def crack_heat(tag, p, freq, width):
    """A glowing crack network: 1 on the zero line of a smooth noise field, 0 away from
    it. Two fields overlaid so the lines branch rather than run in parallel."""
    a = abs(fbm(p, tag + "crackA", 2, freq))
    b = abs(fbm(p, tag + "crackB", 2, freq * 1.37))
    return clamp(1.0 - min(a, b) / width)


def ember_colour(heat):
    """Molten glow by heat: dull red, orange, yellow, white-hot."""
    return ramp([(0.0, EMBER_DULL), (0.35, EMBER_RED), (0.6, EMBER_ORANGE), (0.85, EMBER_YELLOW), (1.0, EMBER_WHITE)], heat)


# ---------------------------------------------------------------------------
# star crystals
# ---------------------------------------------------------------------------

# (height, width over height, sides, lean, twist, spur)
CRYSTAL_SPECS = [
    (1.55, 0.2, 6, 0.1, 0.35, True),
    (0.9, 0.27, 5, -0.14, -0.4, False),
    (1.22, 0.22, 6, 0.06, 0.5, False),
    (0.62, 0.33, 5, 0.12, -0.3, True),
    (1.36, 0.19, 6, -0.08, 0.28, False),
    (0.78, 0.3, 6, 0.16, 0.45, False),
]

CRYSTAL_MAX_TRIANGLES = 160


def prism(tag, height, radius, sides, lean_dir, lean, twist, stations, base_z=0.0):
    """A faceted crystal along +Z from base_z: rings at the given (t, radius scale)
    stations, a flat bottom cap and a pointed tip. The axis leans (a quadratic sweep in
    `lean_dir`) and the rings twist with height. Returns (verts, tris, axis(z))."""

    def axis(z):
        t = clamp((z - base_z) / height)
        return Vector((lean_dir.x * lean * height * t * t, lean_dir.y * lean * height * t * t, z))

    verts = []
    tris = []
    for k, (t, rs) in enumerate(stations):
        z = base_z + t * height
        centre = axis(z)
        for s in range(sides):
            a = TAU * s / sides + twist * t + 0.18 * hs(tag, "a", k, s)
            r = radius * rs * (0.86 + 0.28 * h01(tag, "r", k, s))
            verts.append(centre + Vector((math.cos(a) * r, math.sin(a) * r, 0.0)))
    tip_top = base_z + height
    verts.append(axis(tip_top) + Vector((0.04 * radius * hs(tag, "tx"), 0.04 * radius * hs(tag, "ty"), 0.0)))
    tip = len(verts) - 1
    verts.append(axis(base_z))
    bottom = len(verts) - 1
    for k in range(len(stations) - 1):
        ring_band(tris, k * sides, (k + 1) * sides, sides)
    last = (len(stations) - 1) * sides
    for s in range(sides):
        tris.append([last + s, last + (s + 1) % sides, tip])
        tris.append([(s + 1) % sides, s, bottom])
    return verts, tris, axis


def build_star_crystal(i):
    height, ratio, sides, lean, twist, spur = CRYSTAL_SPECS[i]
    tag = "crystal%d" % i
    pc = Piece("star_crystal_%d" % i)
    radius = ratio * height * 0.5
    ang = TAU * h01(tag, "lean")
    lean_dir = Vector((math.cos(ang), math.sin(ang), 0.0))
    # A slight flare at the root, a fuller waist, then the shoulder where the point begins.
    stations = [(0.0, 0.92), (0.3, 1.05), (0.62, 1.0), (0.8, 0.78)]
    verts, tris, axis = prism(tag, height, radius, sides, lean_dir, lean, twist, stations)
    h = height

    def inside_main(c, axis=axis, h=h):
        return axis(clamp(c.z, 0.08 * h, 0.95 * h))

    pc.add(verts, tris, "main", inside=inside_main)
    if spur:
        # A smaller crystal branching from low on the flank, its root sunk in the shaft.
        sa = ang + math.pi + 0.8 * hs(tag, "spurA")
        sd = Vector((math.cos(sa), math.sin(sa), 0.0))
        sh = height * 0.42
        sr = radius * 0.55
        tilt = math.radians(32.0 + 8.0 * h01(tag, "spurT"))
        root_z = height * 0.16
        sv, st, _ = prism(tag + "spur", sh, sr, 5, Vector((0.0, 0.0, 0.0)), 0.0, 0.3, [(0.0, 0.9), (0.55, 1.0), (0.78, 0.72)])
        # Tilt the spur outward about the horizontal axis perpendicular to sd.
        side = Vector((-sd.y, sd.x, 0.0))
        cs, sn = math.cos(tilt), math.sin(tilt)
        root = axis(root_z)
        placed = []
        for v in sv:
            # v in the spur's own frame: rotate so +Z leans toward sd by `tilt`.
            along = v.z
            flat = Vector((v.x, v.y, 0.0))
            up = Vector((0.0, 0.0, 1.0)) * (along * cs) + sd * (along * sn)
            # keep the ring's cross-section perpendicular to the tilted axis
            fx = flat.dot(sd)
            fy = flat.dot(side)
            cross = sd * (fx * cs) + Vector((0.0, 0.0, -fx * sn)) + side * fy
            placed.append(root + up + cross)
        spur_axis_dir = Vector((0.0, 0.0, cs)) + sd * sn

        def inside_spur(c, root=root, d=spur_axis_dir, sh=sh):
            t = clamp((c - root).dot(d), 0.05 * sh, 0.95 * sh)
            return root + d * t

        pc.add(placed, st, "spur", inside=inside_spur)
    pc.plant()
    if pc.triangles() > CRYSTAL_MAX_TRIANGLES:
        raise SystemExit("star crystal %d over its triangle budget" % i)
    ht = pc.height()
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        # Alternate facets catch the light a touch brighter: a cut gem, not a cone.
        k = 1.0 + 0.1 * hs(tag, "facet", fi // 2) + (0.06 if n.z > 0.25 else 0.0)
        cols = []
        for j in pc.tris[fi]:
            v = pc.verts[j]
            t = v.z / ht
            col = ramp(STAR_RAMP, t)
            # a faint inner banding so the glow is not a flat gradient
            col = mul(col, k * (1.0 + 0.05 * math.sin(v.z * 19.0 + h01(tag, "band") * TAU)))
            cols.append(col)
        pc.mats.append(MAT_CRYSTAL)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# lava chunks
# ---------------------------------------------------------------------------

# (target bounding radius, stretch)
LAVA_CHUNK_SPECS = [
    (0.44, (1.25, 0.95, 0.82)),
    (0.4, (1.05, 1.12, 0.78)),
    (0.36, (1.3, 0.88, 0.8)),
    (0.32, (0.98, 1.05, 0.9)),
    (0.29, (1.2, 0.92, 0.72)),
    (0.26, (1.1, 0.85, 0.86)),
]

LAVA_CHUNK_MAX_TRIANGLES = 216
LAVA_DISSOLVE_STEPS = (0.6, 2.0, 3.5, 5.0, 7.0, 9.0, 12.0, 15.0)


def build_lava_chunk(i):
    radius, stretch = LAVA_CHUNK_SPECS[i]
    tag = "lava%d" % i
    pc = Piece("lava_chunk_%d" % i)
    planes = plane_set(tag, 6, 0.5, 0.74)
    for angle in LAVA_DISSOLVE_STEPS:
        verts, tris, cls = cut_rock(tag, 2, planes, stretch, 0.14, angle=angle)
        if len(tris) <= LAVA_CHUNK_MAX_TRIANGLES:
            break
    else:
        raise SystemExit("lava chunk %d cannot meet its triangle budget" % i)
    pc.add(verts, tris, "rock", cls, inside=lambda _c: Vector((0.0, 0.0, 0.0)))
    pc.recenter()
    pc.scale(radius / pc.radius())
    # The hot face: the largest fracture facet, where the gobbet tore off the pool.
    area_by_cls = {}
    for fi in range(len(pc.tris)):
        if pc.cls[fi] > 0:
            _c, _n, a = pc.face_data(fi)
            area_by_cls[pc.cls[fi]] = area_by_cls.get(pc.cls[fi], 0.0) + a
    hot = max(sorted(area_by_cls), key=lambda k: area_by_cls[k]) if area_by_cls else -1
    hot_centre = Vector((0.0, 0.0, 0.0))
    hot_area = 0.0
    for fi in range(len(pc.tris)):
        if pc.cls[fi] == hot:
            c, _n, a = pc.face_data(fi)
            hot_centre += c * a
            hot_area += a
    if hot_area > 0.0:
        hot_centre /= hot_area
    cav = vertex_cavity(pc)
    freq = 2.2 / radius
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        tri = pc.tris[fi]
        if pc.cls[fi] == hot:
            # White-hot at the heart of the torn face, cooling to orange at its rim.
            cols = []
            for j in tri:
                v = pc.verts[j]
                d = (v - hot_centre).length / (radius * 0.75)
                cols.append(ember_colour(1.0 - 0.55 * clamp(d)))
            pc.mats.append(MAT_EMBER)
            pc.cols.append(cols)
            continue
        cols = []
        glowing = False
        for j in tri:
            v = pc.verts[j]
            heat = crack_heat(tag, v, freq, 0.1)
            # the seams glow: a crevice corner shows the melt under the crust
            heat = max(heat, clamp((cav[j] - 0.12) / 0.2))
            # the crust right at the hot face's rim is heat-stained and cracks more
            near = clamp(1.0 - (v - hot_centre).length / (radius * 0.9))
            heat = clamp(heat + 0.25 * near * near * near)
            crust = corner_shade(basalt_colour(tag, c, n), cav[j], dark=1.4)
            if heat > 0.35:
                glowing = True
                w = clamp((heat - 0.35) / 0.4)
                col = mix(mix(crust, BASALT_WARM, 0.6), ember_colour(0.4 + 0.45 * heat), w)
            else:
                col = crust
            cols.append(col)
        pc.mats.append(MAT_EMBER if glowing else MAT_BASALT)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# pool crusts
# ---------------------------------------------------------------------------

# (longest side, thickness, outline points, elongation, crack count)
CRUST_SPECS = [
    (1.24, 0.12, 18, 1.35, 3),
    (1.04, 0.09, 16, 1.15, 2),
    (0.94, 0.07, 16, 1.5, 3),
    (1.14, 0.11, 18, 1.25, 2),
]

CRUST_MAX_TRIANGLES = 200


def build_pool_crust(i):
    length, thickness, n_pts, elong, n_cracks = CRUST_SPECS[i]
    tag = "crust%d" % i
    pc = Piece("pool_crust_%d" % i)
    # The outline: an irregular, slightly elongated blob. Rings (from the outside in):
    # bottom edge, top bevel, mid top, inner top, then the crown point.
    outline = []
    for s in range(n_pts):
        a = TAU * s / n_pts + 0.12 * hs(tag, "oa", s)
        r = 1.0 + 0.2 * hs(tag, "or", s) + 0.1 * math.sin(3.0 * a + TAU * h01(tag, "lobe"))
        outline.append((a, r))
    crack_angles = [TAU * (k / n_cracks + 0.2 * h01(tag, "ca", k)) for k in range(n_cracks)]

    def crackness(a):
        best = 0.0
        for ca in crack_angles:
            d = abs(math.atan2(math.sin(a - ca), math.cos(a - ca)))
            best = max(best, clamp(1.0 - d / (TAU / n_pts * 0.9)))
        return best

    # Cracks run in from the rim and die out before the middle (rings 2 and 3 only), so
    # the plate reads as a crust breaking up at its edge, not as a sliced pie.
    rings = [(1.0, -0.5), (0.93, 0.4), (0.8, 0.48), (0.56, 0.52), (0.28, 0.55)]
    crack_rings = {2: 1.0, 3: 0.7}
    verts = []
    crack_v = []
    for k, (rs, z) in enumerate(rings):
        for s, (a, r) in enumerate(outline):
            rr = r * rs
            zz = z + (0.05 * hs(tag, "z", k, s) if k > 0 else 0.0)
            cr = crackness(a) * crack_rings.get(k, 0.0)
            if cr > 0.5:
                zz -= 0.14  # the crack sits as a groove in the top
            verts.append(Vector((math.cos(a) * rr * elong, math.sin(a) * rr, zz)))
            crack_v.append(cr)
    verts.append(Vector((0.0, 0.0, 0.58)))
    crack_v.append(0.0)
    top = len(verts) - 1
    verts.append(Vector((0.0, 0.0, -0.5)))
    crack_v.append(0.0)
    bot = len(verts) - 1
    tris = []
    for k in range(len(rings) - 1):
        ring_band(tris, k * n_pts, (k + 1) * n_pts, n_pts)
    inner = (len(rings) - 1) * n_pts
    for s in range(n_pts):
        tris.append([inner + s, inner + (s + 1) % n_pts, top])
        tris.append([(s + 1) % n_pts, s, bot])

    def inside(c):
        return Vector((c.x * 0.5, c.y * 0.5, 0.0))

    pc.add(verts, tris, "plate", inside=inside)
    pc.recenter()
    ex, ey, ez = pc.extent()
    kxy = length / max(ex, ey)
    pc.scale_axes(kxy, kxy, thickness / ez)
    pc.recenter()
    if pc.triangles() > CRUST_MAX_TRIANGLES:
        raise SystemExit("pool crust %d over its triangle budget" % i)
    rim_start = n_pts  # ring 1 (the top bevel) is the glowing lip
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        tri = pc.tris[fi]
        cols = []
        glowing = False
        for j in tri:
            v = pc.verts[j]
            if j < n_pts or j == bot:
                # the bottom edge and underside sit in the molten pool
                col = ember_colour(0.66 + 0.2 * h01(*vkey(tag + "bh", v)))
                glowing = True
            elif j < rim_start + n_pts:
                # the top lip: still soft and glowing orange
                col = ember_colour(0.42 + 0.16 * h01(*vkey(tag + "rh", v)))
                glowing = True
            else:
                cr = crack_v[j]
                crust = basalt_colour(tag, v, n)
                if cr > 0.3:
                    col = mix(crust, ember_colour(0.5 + 0.45 * cr), clamp((cr - 0.3) / 0.4))
                    glowing = True
                else:
                    col = crust
            cols.append(col)
        # the flat underside is lit from the pool below; the top stays crust unless it glows
        pc.mats.append(MAT_EMBER if glowing else MAT_BASALT)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# the geyser column
# ---------------------------------------------------------------------------

COLUMN_SIDES = 16
# (height, radius): a broad vent, a tapering throat, then the bulbous splash crown.
COLUMN_PROFILE = [
    (0.0, 0.5),
    (0.06, 0.45),
    (0.16, 0.38),
    (0.3, 0.32),
    (0.46, 0.28),
    (0.58, 0.25),
    (0.66, 0.26),
    (0.73, 0.31),
    (0.8, 0.36),
    (0.87, 0.37),
    (0.93, 0.32),
    (0.97, 0.22),
    (0.99, 0.11),
]
COLUMN_TOP = 1.0
COLUMN_MAX_TRIANGLES = 700
DROPLETS = 6


def teardrop(tag, centre, direction, length, radius):
    """A small faceted droplet: a point trailing back along -direction, a round head.
    Returns (verts, tris, inside(c))."""
    sides = 6
    d = direction.normalized()
    side = d.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-4:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    up = side.cross(d).normalized()
    stations = [(-0.25, 0.75), (0.1, 1.0), (0.38, 0.62)]
    verts = []
    for k, (t, rs) in enumerate(stations):
        at = centre + d * (t * length)
        for s in range(sides):
            a = TAU * s / sides + 0.4 * k
            r = radius * rs * (0.85 + 0.3 * h01(tag, "dr", k, s))
            verts.append(at + side * math.cos(a) * r + up * math.sin(a) * r)
    verts.append(centre - d * (0.9 * length))  # the trailing point
    tail = len(verts) - 1
    verts.append(centre + d * (0.5 * length))  # the round front
    head = len(verts) - 1
    tris = []
    for k in range(len(stations) - 1):
        ring_band(tris, k * sides, (k + 1) * sides, sides)
    last = (len(stations) - 1) * sides
    for s in range(sides):
        tris.append([(s + 1) % sides, s, tail])
        tris.append([last + s, last + (s + 1) % sides, head])

    def inside(c, centre=centre, d=d, length=length):
        t = clamp((c - centre).dot(d), -0.6 * length, 0.3 * length)
        return centre + d * t

    return verts, tris, inside


def build_geyser_column():
    tag = "geyser"
    pc = Piece("geyser_column")
    sides = COLUMN_SIDES
    lobe_phase = TAU * h01(tag, "lobe")
    verts = []
    for k, (z, r) in enumerate(COLUMN_PROFILE):
        crown = clamp((z - 0.64) / 0.2)
        for s in range(sides):
            a = TAU * s / sides + 0.1 * k
            lump = 1.0 + 0.07 * hs(tag, "rj", k, s)
            # the splash crown throws out a few lobes
            lump += crown * 0.3 * max(0.0, math.cos(5.0 * a + lobe_phase + 0.25 * k)) ** 2
            rr = r * lump
            zz = z + crown * (0.03 * hs(tag, "zj", k, s) + 0.035 * max(0.0, math.cos(5.0 * a + lobe_phase)))
            verts.append(Vector((math.cos(a) * rr, math.sin(a) * rr, max(0.0, zz))))
    verts.append(Vector((0.03, -0.02, COLUMN_TOP)))
    tip = len(verts) - 1
    tris = []
    for k in range(len(COLUMN_PROFILE) - 1):
        ring_band(tris, k * sides, (k + 1) * sides, sides)
    last = (len(COLUMN_PROFILE) - 1) * sides
    for s in range(sides):
        tris.append([last + s, last + (s + 1) % sides, tip])

    def inside_column(c):
        return Vector((0.0, 0.0, min(c.z, 0.9)))

    pc.add(verts, tris, "column", inside=inside_column)
    # Droplets thrown off the crown, arcing outward and up.
    for d in range(DROPLETS):
        a = TAU * (d / DROPLETS + 0.08 * hs(tag, "da", d))
        out = Vector((math.cos(a), math.sin(a), 0.0))
        r = 0.56 + 0.16 * h01(tag, "dist", d)
        z = 0.78 + 0.2 * h01(tag, "dz", d)
        centre = out * r + Vector((0.0, 0.0, z))
        dirv = out * 0.8 + Vector((0.0, 0.0, 0.25 + 0.5 * h01(tag, "up", d)))
        size = 0.06 + 0.035 * h01(tag, "size", d)
        v, t, inside = teardrop(tag + "drop%d" % d, centre, dirv, size * 2.2, size)
        pc.add(v, t, "drop", inside=inside)
    pc.plant()
    ht = pc.height()
    pc.scale_axes(1.0, 1.0, COLUMN_TOP / ht)
    pc.plant()
    if pc.triangles() > COLUMN_MAX_TRIANGLES:
        raise SystemExit("geyser column over its triangle budget")
    ht = pc.height()
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        kind = pc.kind[fi]
        cols = []
        for j in pc.tris[fi]:
            v = pc.verts[j]
            t = v.z / ht
            col = ramp(COLUMN_RAMP, t)
            # rising streaks of hotter lava up the body
            ang = math.atan2(v.y, v.x)
            streak = math.sin(ang * 7.0 + v.z * 5.0 + lobe_phase)
            if streak > 0.55 and t < 0.8:
                col = mix(col, ramp(COLUMN_RAMP, t * 0.5), 0.55 * (streak - 0.55) / 0.45)
            if kind == "drop":
                col = mul(ramp(COLUMN_RAMP, 0.55 + 0.35 * t), 0.95)
            cols.append(col)
        pc.mats.append(MAT_EMBER)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# Blender scene assembly and export
# ---------------------------------------------------------------------------


def make_material(name):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    spec = MATERIAL_DEFS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = spec["metallic"]
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    return mat


def piece_object(pc, parent, collection):
    mats = [m for m in MATERIAL_ORDER if m in set(pc.mats)]
    me = bpy.data.meshes.new(pc.name)
    me.from_pydata([tuple(v) for v in pc.verts], [], pc.tris)
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(make_material(m))
    me.polygons.foreach_set("material_index", [mats.index(m) for m in pc.mats])
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    flat_cols = []
    for cols in pc.cols:
        for c in cols:
            flat_cols.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", flat_cols)
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(26.0))
    me.update()
    obj = bpy.data.objects.new(pc.name, me)
    obj.parent = parent
    collection.objects.link(obj)
    return obj


BUILDERS = (
    [lambda i=i: build_star_crystal(i) for i in range(6)]
    + [lambda i=i: build_lava_chunk(i) for i in range(6)]
    + [lambda i=i: build_pool_crust(i) for i in range(4)]
    + [build_geyser_column]
)


def build_kit(collection):
    root = bpy.data.objects.new("BalgathStarwakeKit", None)
    collection.objects.link(root)
    pieces = []
    for build in BUILDERS:
        pc = build()
        piece_object(pc, root, collection)
        pieces.append(pc)
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "balgath-starwake-kit",
        "stage": "final",
        "coordinateFrame": {
            "up": "+Y",
            "units": "normalized",
            "pivot": "base-origin for star_crystal_* and geyser_column, surface-centroid for lava_chunk_* and pool_crust_*",
        },
        "nodes": {pc.name: {"triangles": pc.triangles(), "height": round(pc.height(), 3), "radius": round(pc.radius(), 3)} for pc in pieces},
        "identityCues": ["glowing-star-crystals", "basalt-crust-with-molten-cracks", "floating-cooling-crust", "erupting-lava-column"],
    }
    return root, pieces


def export_kit(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_vertex_color="NAME",
        export_vertex_color_name="Col",
        export_all_vertex_colors=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out_dir = None
    if "--out" in argv:
        out_dir = argv[argv.index("--out") + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.data.collections.new("BalgathStarwakeKit")
    bpy.context.scene.collection.children.link(collection)
    root, pieces = build_kit(collection)
    report = []
    for pc in pieces:
        ex, ey, ez = pc.extent()
        report.append("%s tris=%d radius=%.3f length=%.3f height=%.3f footprint=%.3fx%.3f mats=%s" % (pc.name, pc.triangles(), pc.radius(), pc.length(), ez, ex, ey, ",".join(sorted(set(pc.mats)))))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "balgath_starwake.glb"))
    print("STARWAKE_KIT_REPORT_BEGIN")
    print("\n".join(report))
    print("STARWAKE_KIT_REPORT_END")


if __name__ == "__main__":
    main()
