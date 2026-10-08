# Balgath's Boulder Toss VFX kit: a deterministic Blender factory.
#
# Balgath, the One-Eyed Foreman, rips a moss-grown boulder out of the fen, heaves it
# overhead and hurls it. The renderer draws that boulder, the shatter it bursts into on
# impact, and the splinter vortex that spins over a marked player from ONE GLB with
# eleven named mesh nodes (the names are the runtime contract, see contract.mjs):
#
#   boulder              the hero rock: a torn-up granite boulder, weathered facets on
#                        top under green moss caps, soil and roots caked on the underside
#   chunk_0 .. chunk_5   shatter fragments: fresh broken faces (lighter, speckled) meeting
#                        a sliver of the weathered skin, some still carrying moss
#   shard_0 .. shard_3   thin angular splinters for the vortex
#
# The shipping GLB is made by scripts/assets/balgath_boulder/export_balgath_boulder.mjs,
# which runs this file through Blender in --background, stamps the source fingerprint,
# and optimizes through scripts/assets/build_assets.mjs with specs/balgath_boulder.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/balgath_boulder/model.py -- --out <dir>
#
# Style: the muster camp kit's texture-free lane. Every colour is a VERTEX colour: a
# grey-brown granite with darker crevices (a per-vertex cavity term), lighter worn
# edges, salt-and-pepper speckle and lichen flecks per face, moss caps raised a touch
# proud of the stone, and dark soil with roots on the torn underside. The rock shapes are
# a sphere cut by hashed planes, so the facets are genuinely flat (a chipped stone
# silhouette that reads at raid distance) while the uncut skin stays softly lumpy.
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of a
# descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up, which the glTF exporter turns into +Y up. Every node sits at the
# origin and is centred on its own surface centroid (area weighted), so a renderer that
# spins a node spins it about its own middle.

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
    """Smooth hashed noise over a direction: a few summed sine ridges per octave."""
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


# Balgath's own stone: grey with a brown cast, never blue.
GRANITE = srgb(0x6F685E)
GRANITE_LIGHT = srgb(0x8C8478)
GRANITE_DARK = srgb(0x4A443C)
FRESH = srgb(0x8E8679)  # a broken face: lighter, faintly warm
FELDSPAR = srgb(0x9A8272)  # the pink grain in fresh granite
SPECK_DARK = srgb(0x302C27)  # biotite
SPECK_LIGHT = srgb(0xB2AB9F)  # quartz
LICHEN_PALE = srgb(0x9C9B6A)  # yellow-green crust
LICHEN_GREY = srgb(0x8A9480)  # grey-green crust
LICHEN_OCHRE = srgb(0xA07C45)  # the orange crust every old boulder carries
MOSS = srgb(0x4F6E27)
MOSS_LIGHT = srgb(0x6F8E33)
MOSS_DARK = srgb(0x2C4018)
SOIL = srgb(0x4A3525)
SOIL_DARK = srgb(0x2C2018)
SOIL_LIGHT = srgb(0x654A32)
PEBBLE = srgb(0x8A8378)
ROOT = srgb(0x7A5C41)
ROOT_DARK = srgb(0x453222)

# Material buckets. The NAMES are the contract (contract.mjs pins them): the renderer
# may key surface treatment on them, and the test fails on any other name.
MAT_GRANITE = "granite"
MAT_MOSS = "moss"
MAT_SOIL = "soil"
MATERIAL_ORDER = [MAT_GRANITE, MAT_MOSS, MAT_SOIL]

MATERIAL_DEFS = {
    MAT_GRANITE: {"metallic": 0.0, "roughness": 0.9},
    MAT_MOSS: {"metallic": 0.0, "roughness": 0.97},
    MAT_SOIL: {"metallic": 0.0, "roughness": 0.96},
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


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a = pts[i]
        b = pts[(i + 1) % len(pts)]
        n.x += (a[1] - b[1]) * (a[2] + b[2])
        n.y += (a[2] - b[2]) * (a[0] + b[0])
        n.z += (a[0] - b[0]) * (a[1] + b[1])
    if n.length > 1e-12:
        n.normalize()
    return n


# ---------------------------------------------------------------------------
# the cut rock: a lumpy sphere trimmed by flat fracture planes
# ---------------------------------------------------------------------------


def cut_rock(tag, level, planes, stretch, skin_noise, underside=0.0, dissolve=True, angle=0.6):
    """Every vertex of a subdivided sphere is pulled in to the NEAREST of a set of planes
    (or its own lumpy skin radius, whichever is closer), so whole patches land exactly on
    a plane and read as flat chipped facets. Coplanar triangles are then dissolved into
    one face per facet and re-triangulated (`dissolve`), which is where the small
    pieces get their triangle budget back. The hero boulder keeps its full vertex
    density instead: its colour lives on the vertices, and a dissolved facet has too
    few of them to carry speckle, lichen or a worn edge.

    `underside` roughens the lower cap (d.z below -0.3) for the boulder's torn, soil-caked
    bottom. Returns (verts, tris, face_class) with class 0 = skin, 1 + i = plane i."""
    dirs, faces = icosphere(level)
    pos = []
    owner = []
    for d in dirs:
        r = 1.0 + skin_noise * fbm(d, tag, 3, 1.9)
        if underside > 0.0 and d.z < -0.3:
            w = clamp((-0.3 - d.z) / 0.35)
            r *= 1.0 + underside * w * fbm(d, tag + "torn", 2, 6.5)
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
    if dissolve:
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


# ---------------------------------------------------------------------------
# the piece accumulator (per-face material, per-corner colour)
# ---------------------------------------------------------------------------


class Piece:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.tris = []
        self.kind = []  # per face: 'rock', 'root', 'clump', 'tuft', 'shard'
        self.cls = []  # per face: 0 skin, >0 fracture facet
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

    def radius(self):
        return max(v.length for v in self.verts)

    def scale(self, k):
        self.verts = [v * k for v in self.verts]

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def length(self):
        (x0, y0, z0), (x1, y1, z1) = self.bounds()
        return max(x1 - x0, y1 - y0, z1 - z0)

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


# ---------------------------------------------------------------------------
# colour: the hand-painted pass
# ---------------------------------------------------------------------------
#
# Two layers. The BASE colour is flat per face and comes from coherent positional noise
# sampled at the face centroid (tonal drift, lichen crusts, moss light and shade), so
# neighbouring faces agree and patches read as patches rather than as confetti; a subtle
# hashed per-face speckle is the granite's salt and pepper, and a per-facet mottle keeps
# each chipped plane one surface. The SHADE is per corner: a cavity term darkens the
# crevices and lifts the worn ridges, which is what gives the flat facets their depth.


def vkey(tag, p):
    """A hash key for a vertex position (split corners of one vertex agree)."""
    return (tag, round(p.x, 4), round(p.y, 4), round(p.z, 4))


def granite_corner(tag, p, n, facet, cav, zlo, zhi, fresh=False, lichen=True):
    """One corner of granite: `p` is the FACE centroid (the base is flat per face) and
    `cav` the corner's own cavity. `fresh` is a face the shatter just exposed: lighter,
    warmer, grain showing, no lichen. Otherwise the weathered outside of the stone."""
    t = clamp((p.z - zlo) / max(1e-6, zhi - zlo))
    tone = 0.6 * fbm(p, tag + "tone", 3, 6.5) + 0.4 * fbm(p, tag + "grain", 2, 17.0)
    if fresh:
        col = mul(FRESH, 0.94 + 0.08 * t)
        col = mix(col, FELDSPAR if tone > 0.0 else GRANITE, 0.3 * abs(tone))
    else:
        col = mix(GRANITE_DARK, GRANITE, 0.4 + 0.6 * t)
        if n.z > 0.0:
            col = mix(col, GRANITE_LIGHT, 0.32 * n.z)
        col = mix(col, GRANITE_LIGHT if tone > 0.0 else GRANITE_DARK, 0.35 * abs(tone))
    k = 1.0 + 0.06 * hs(tag, "facet", facet)
    # The grain only shows on a fresh break; on the weathered skin a per-face speckle
    # reads as mesh noise rather than as stone, so the tone noise carries it there.
    if fresh:
        r = h01(*vkey(tag + "spk", p))
        if r < 0.1:
            col = mix(col, SPECK_DARK, 0.25)
        elif r > 0.9:
            col = mix(col, SPECK_LIGHT, 0.22)
        elif r > 0.8:
            col = mix(col, FELDSPAR, 0.35)
    if lichen and not fresh and n.z > -0.3:
        crust = fbm(p, tag + "lichen", 2, 9.0) + 0.25 * n.z
        if crust > 0.55:
            w = clamp((crust - 0.55) / 0.3)
            pick = fbm(p, tag + "lichpick", 1, 5.0)
            lic = LICHEN_PALE if pick > 0.0 else (LICHEN_GREY if pick > -0.6 else LICHEN_OCHRE)
            col = mix(col, lic, (0.38 if lic is LICHEN_OCHRE else 0.46) * w)
    return corner_shade(mul(col, k), cav)


def moss_corner(tag, p, n, cav, edge):
    col = mix(MOSS_DARK, MOSS, 0.35 + 0.65 * clamp(n.z))
    tone = fbm(p, tag + "mosstone", 3, 9.0)
    col = mix(col, MOSS_LIGHT if tone > 0.0 else MOSS_DARK, 0.6 * abs(tone))
    col = mul(col, 1.0 + 0.05 * hs(*vkey(tag + "mv", p)))
    if edge:
        col = mul(col, 0.72)  # the shadow line where the cushion meets the stone
    return corner_shade(col, cav, dark=1.3)


def soil_corner(tag, p, cav):
    tone = fbm(p, tag + "soiltone", 2, 6.0)
    col = mix(SOIL, SOIL_LIGHT if tone > 0.0 else SOIL_DARK, 0.55 * abs(tone))
    r = h01(*vkey(tag + "pb", p))
    if r > 0.93:
        col = mix(col, PEBBLE, 0.45)  # a pebble pressed into the clod
    return corner_shade(col, cav, dark=1.2)


def corner_shade(base, cav, dark=1.7, lift=0.55, floor=0.42):
    """Darken the crevices and lift the worn ridges, per corner."""
    if cav > 0.0:
        k = max(floor, 1.0 - dark * cav)
    else:
        k = min(1.18, 1.0 - lift * cav)
    return mul(base, k)


# ---------------------------------------------------------------------------
# the boulder
# ---------------------------------------------------------------------------


def tube(path, radii, sides, tag):
    """A tapered, closed-tip tube along a polyline (roots). Returns (verts, tris)."""
    verts = []
    tris = []
    prev_side = None
    for k, p in enumerate(path):
        if k + 1 < len(path):
            fwd = (path[k + 1] - p).normalized()
        else:
            fwd = (p - path[k - 1]).normalized()
        side = Vector((0.0, 0.0, 1.0)).cross(fwd)
        if side.length < 1e-4:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()
        if prev_side is not None and side.dot(prev_side) < 0.0:
            side = -side
        prev_side = side
        up = fwd.cross(side).normalized()
        if k == len(path) - 1:
            verts.append(p.copy())
            continue
        for s in range(sides):
            a = TAU * s / sides + 0.6 * k
            rr = radii[k] * (1.0 + 0.18 * hs(tag, "tb", k, s))
            verts.append(p + side * math.cos(a) * rr + up * math.sin(a) * rr)
    rings = len(path) - 1
    for k in range(rings - 1):
        for s in range(sides):
            a = k * sides + s
            b = k * sides + (s + 1) % sides
            c = (k + 1) * sides + (s + 1) % sides
            d = (k + 1) * sides + s
            tris.append([a, b, c])
            tris.append([a, c, d])
    tip = len(verts) - 1
    last = (rings - 1) * sides
    for s in range(sides):
        tris.append([last + s, last + (s + 1) % sides, tip])
    return verts, tris


def lump(tag, level, r, squash, noise=0.22):
    """A small lumpy blob (soil clod, moss cushion): a noisy icosphere, z squashed."""
    dirs, faces = icosphere(level)
    verts = []
    for d in dirs:
        k = 1.0 + noise * fbm(d, tag, 2, 2.6)
        verts.append(Vector((d.x * r * k, d.y * r * k, d.z * r * k * squash)))
    return verts, [list(f) for f in faces]


ORIGIN = Vector((0.0, 0.0, 0.0))


def nearest_on_path(path, c):
    """The closest point to c on a polyline (the inside of a root tube)."""
    best = path[0]
    best_d = (c - best).length
    for k in range(len(path) - 1):
        a, b = path[k], path[k + 1]
        ab = b - a
        t = clamp((c - a).dot(ab) / max(ab.dot(ab), 1e-12))
        p = a + ab * t
        d = (c - p).length
        if d < best_d:
            best, best_d = p, d
    return best


def surface_point(pc, direction):
    """The rock vertex whose own direction best matches `direction` (for attaching)."""
    best = None
    best_dot = -2.0
    for fi in range(len(pc.tris)):
        if pc.kind[fi] != "rock":
            continue
        for i in pc.tris[fi]:
            v = pc.verts[i]
            dd = v.normalized().dot(direction)
            if dd > best_dot:
                best_dot = dd
                best = v
    return best.copy()


def normalize_radius(pc, radius):
    pc.recenter()
    pc.scale(radius / pc.radius())


def build_boulder():
    tag = "boulder"
    pc = Piece("boulder")
    # Fracture planes stay OFF the underside (normal z above -0.25): the bottom is where
    # it tore out of the ground, so it stays rounded and caked, never cleanly cut. The
    # planes bite deep, which is what turns a lumpy sphere into a blocky chipped boulder,
    # and one deeper cut on the flank gives the silhouette its big step.
    planes = plane_set(tag, 10, 0.6, 0.8, min_z=-0.25)
    planes.append((Vector((0.82, -0.3, 0.25)).normalized(), 0.56))
    planes.append((Vector((0.0, 0.0, 1.0)), 0.7))  # a broad, gently domed crown for the moss
    verts, tris, cls = cut_rock(tag, 3, planes, (1.3, 1.0, 0.8), 0.12, underside=0.12, dissolve=False)
    pc.add(verts, tris, "rock", cls, inside=lambda _c: ORIGIN)
    rock_faces = len(pc.tris)

    # A skirt of soil clods caked on the underside, half sunk into the stone.
    clods = [(0.0, 0.0, 0.26), (0.55, 0.3, 0.2), (-0.55, 0.15, 0.21), (0.1, -0.6, 0.19), (-0.2, 0.62, 0.18), (0.62, -0.35, 0.16)]
    for i, (ax, ay, r) in enumerate(clods):
        d = Vector((ax, ay, -1.0)).normalized()
        anchor = surface_point(pc, d)
        v, t = lump(tag + "clod%d" % i, 1, r * (0.9 + 0.2 * h01(tag, "clod", i)), 0.6)
        at = anchor * 0.9
        v = [p + at for p in v]
        pc.add(v, t, "clump", inside=lambda _c, at=at: at)

    # Roots torn out with it: short, gnarled, of mixed thickness, poking out of the soil
    # at odd angles. Every third one is a snapped stub. Long even roots in a ring read as
    # legs, so these stay short and irregular on purpose.
    for i in range(10):
        a = TAU * (i / 10.0 + 0.06 * hs(tag, "ra", i))
        spread = 0.35 + 0.55 * h01(tag, "rs", i)
        d = Vector((math.cos(a) * spread, math.sin(a) * spread, -1.0)).normalized()
        start = surface_point(pc, d) * 0.95
        out = Vector((math.cos(a), math.sin(a), 0.0))
        stub = i % 3 == 0
        segs = 2 if stub else 3 + int(h01(tag, "rn", i) * 2)
        seg = 0.08 + 0.05 * h01(tag, "rl", i)
        path = [start]
        dirv = (out * (0.5 + 0.4 * h01(tag, "ro", i)) + Vector((0.0, 0.0, -0.8))).normalized()
        side = out.cross(Vector((0.0, 0.0, 1.0)))
        for k in range(segs):
            bend = side * 0.7 * hs(tag, "rb", i, k) + Vector((0.0, 0.0, -0.25)) + out * 0.3 * hs(tag, "rc", i, k)
            dirv = (dirv + bend * 0.6).normalized()
            path.append(path[-1] + dirv * seg * (1.0 - 0.12 * k))
        base_r = 0.028 + 0.024 * h01(tag, "rr", i)
        tip = 0.55 if stub else 0.2
        radii = [base_r * (1.0 - (1.0 - tip) * k / max(1, segs)) for k in range(len(path))]
        v, t = tube(path, radii, 4, tag + "root%d" % i)
        pc.add(v, t, "root", inside=lambda c, path=path: nearest_on_path(path, c))

    # Two moss cushions sitting proud on the crown: the silhouette's soft bumps.
    for i, (ax, ay) in enumerate([(0.3, -0.2), (-0.35, 0.3)]):
        d = Vector((ax, ay, 1.0)).normalized()
        anchor = surface_point(pc, d)
        r = 0.2 + 0.06 * h01(tag, "tuft", i)
        v, t = lump(tag + "tuft%d" % i, 1, r, 0.6, noise=0.28)
        at = anchor * 0.95
        v = [p + at for p in v]
        pc.add(v, t, "tuft", inside=lambda _c, at=at: at)

    normalize_radius(pc, 1.0)
    rock = [fi for fi in range(len(pc.tris)) if pc.kind[fi] == "rock"]
    # Classify the rock faces: a soil band on the underside, moss on the sky-facing
    # crown with a ragged edge that drapes over the rim.
    fmat = {}
    for fi in rock:
        c, n, _a = pc.face_data(fi)
        d = c.normalized()
        soil_line = -0.4 + 0.14 * fbm(d, tag + "soilline", 2, 3.0)
        moss_score = 0.8 * n.z + 0.55 * fbm(d, tag + "moss", 3, 3.2) + 0.45 * d.z
        if d.z < soil_line:
            fmat[fi] = MAT_SOIL
        elif moss_score > 0.78 and d.z > 0.05:
            fmat[fi] = MAT_MOSS
        else:
            fmat[fi] = MAT_GRANITE
    # No stray single triangles: a moss face with fewer than two moss neighbours goes
    # back to stone, and a stone face walled in by moss joins it. Two passes settle it.
    edge_faces = {}
    for fi in rock:
        t = pc.tris[fi]
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
    for _ in range(2):
        for fi in rock:
            if fmat[fi] == MAT_SOIL:
                continue
            t = pc.tris[fi]
            mossy = 0
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                for fj in edge_faces[(min(a, b), max(a, b))]:
                    if fj != fi and fmat[fj] == MAT_MOSS:
                        mossy += 1
            if fmat[fi] == MAT_MOSS and mossy < 2:
                fmat[fi] = MAT_GRANITE
            elif fmat[fi] == MAT_GRANITE and mossy == 3:
                fmat[fi] = MAT_MOSS
    # Raise the moss: vertices only moss faces touch sit a touch proud of the stone, so
    # the cap has a lip instead of being paint.
    touch = {}
    for fi in rock:
        for i in pc.tris[fi]:
            touch.setdefault(i, set()).add(fmat[fi])
    for i, mats in touch.items():
        if mats == {MAT_MOSS}:
            pc.verts[i] = pc.verts[i] + pc.verts[i].normalized() * 0.022
    normalize_radius(pc, 1.0)

    (_x0, _y0, zlo), (_x1, _y1, zhi) = pc.bounds()
    cav = vertex_cavity(pc, rock)
    cav_all = vertex_cavity(pc)
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        kind = pc.kind[fi]
        tri = pc.tris[fi]
        if kind == "rock":
            mat = fmat[fi]
            cols = []
            for i in tri:
                if mat == MAT_MOSS:
                    cols.append(moss_corner(tag, c, n, cav[i], touch[i] != {MAT_MOSS}))
                elif mat == MAT_SOIL:
                    cols.append(soil_corner(tag, c, cav[i]))
                else:
                    col = granite_corner(tag, c, n, pc.cls[fi], cav[i], zlo, zhi)
                    stain = clamp((-0.22 - c.z) / 0.3)  # soil creeping up from the tear
                    if stain > 0.0:
                        col = mix(col, mul(SOIL_LIGHT, 0.9), 0.6 * stain)
                    if len(touch[i]) > 1:
                        col = mul(col, 0.82)
                    cols.append(col)
        elif kind == "root":
            mat = MAT_SOIL
            base = mix(ROOT, ROOT_DARK, 0.2 + 0.5 * h01(tag, "rootc", fi))
            cols = [corner_shade(base, cav_all[i], dark=0.8) for i in tri]
        elif kind == "clump":
            mat = MAT_SOIL
            cols = [soil_corner(tag + "clod", c, cav_all[i]) for i in tri]
        else:  # tuft
            mat = MAT_MOSS
            cols = [moss_corner(tag + "tuft", c, n, cav_all[i], n.z < 0.1) for i in tri]
        pc.mats.append(mat)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# the shatter chunks
# ---------------------------------------------------------------------------

# (target bounding radius, stretch, whether its skin carries moss)
CHUNK_SPECS = [
    (0.44, (1.3, 0.95, 0.78), True),
    (0.4, (1.05, 1.15, 0.72), False),
    (0.36, (1.3, 0.85, 0.75), True),
    (0.32, (0.95, 1.05, 0.9), False),
    (0.29, (1.25, 0.9, 0.66), True),
    (0.26, (1.1, 0.8, 0.85), False),
]


CHUNK_MAX_TRIANGLES = 246
CHUNK_DISSOLVE_STEPS = (0.6, 2.0, 3.5, 5.0, 7.0)


def build_chunk(i):
    radius, stretch, mossy = CHUNK_SPECS[i]
    tag = "chunk%d" % i
    pc = Piece("chunk_%d" % i)
    # Deep fracture planes from below and the sides; the crown (+Z) is left as a patch of
    # the boulder's weathered skin, which is what makes a fragment read as PART of that
    # boulder rather than as a fresh pebble.
    planes = plane_set(tag, 8, 0.42, 0.7, max_z=0.45)
    # Held under the contract's 250-triangle ceiling deterministically: the dissolve
    # angle widens in fixed steps (merging the flattest skin triangles too) until the
    # fragment fits, so a retune of the planes can never silently blow the budget.
    for angle in CHUNK_DISSOLVE_STEPS:
        verts, tris, cls = cut_rock(tag, 2, planes, stretch, 0.12, angle=angle)
        if len(tris) <= CHUNK_MAX_TRIANGLES:
            break
    else:
        raise SystemExit("chunk %d cannot meet its triangle budget" % i)
    pc.add(verts, tris, "rock", cls, inside=lambda _c: ORIGIN)
    normalize_radius(pc, radius)
    (_x0, _y0, zlo), (_x1, _y1, zhi) = pc.bounds()
    cav = vertex_cavity(pc)
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        tri = pc.tris[fi]
        if pc.cls[fi] > 0:
            mat = MAT_GRANITE
            cols = [granite_corner(tag, c, n, pc.cls[fi], cav[j] * 0.7, zlo, zhi, fresh=True) for j in tri]
        elif mossy and n.z > 0.5 and fbm(c, tag + "moss", 2, 5.0) > -0.3:
            mat = MAT_MOSS
            cols = [moss_corner(tag, c, n, cav[j], n.z < 0.62) for j in tri]
        else:
            mat = MAT_GRANITE
            cols = [granite_corner(tag, c, n, 0, cav[j], zlo, zhi) for j in tri]
        pc.mats.append(mat)
        pc.cols.append(cols)
    return pc


# ---------------------------------------------------------------------------
# the vortex splinters
# ---------------------------------------------------------------------------

SHARD_LENGTH = 0.5


def build_shard(i):
    """A thin angular splinter along X: an irregular 5-sided section, two waists, and a
    point at both ends (one long, one blunt), so it tumbles readably in the vortex."""
    tag = "shard%d" % i
    pc = Piece("shard_%d" % i)
    sides = 5
    stations = [(-0.2, 0.62), (-0.02, 1.0), (0.16, 0.72)]
    flat = 0.6 + 0.2 * h01(tag, "flat")
    width = 0.085 + 0.015 * h01(tag, "w")
    verts = []
    for k, (x, s) in enumerate(stations):
        for j in range(sides):
            a = TAU * j / sides + 0.35 * hs(tag, "a", k, j)
            r = width * s * (0.8 + 0.4 * h01(tag, "r", k, j))
            verts.append(Vector((x + 0.02 * hs(tag, "x", k, j), math.cos(a) * r, math.sin(a) * r * flat)))
    verts.append(Vector((-0.29 - 0.03 * h01(tag, "t0"), 0.012 * hs(tag, "t0y"), 0.01 * hs(tag, "t0z"))))
    tip0 = len(verts) - 1
    verts.append(Vector((0.3 + 0.04 * h01(tag, "t1"), 0.02 * hs(tag, "t1y"), 0.012 * hs(tag, "t1z"))))
    tip1 = len(verts) - 1
    tris = []
    for k in range(len(stations) - 1):
        for j in range(sides):
            a = k * sides + j
            b = k * sides + (j + 1) % sides
            c = (k + 1) * sides + (j + 1) % sides
            d = (k + 1) * sides + j
            tris.append([a, d, c])
            tris.append([a, c, b])
    last = (len(stations) - 1) * sides
    for j in range(sides):
        tris.append([tip0, (j + 1) % sides, j])
        tris.append([last + j, last + (j + 1) % sides, tip1])
    # Wound outward about the splinter's own axis, THEN bent a little so no two shards
    # are the same straight stick (a bend this small cannot flip a face).
    probe = Piece("probe")
    probe.add(verts, tris, "shard", inside=lambda c: Vector((c.x, 0.0, 0.0)))
    bend = 0.35 * hs(tag, "bend")
    verts = [Vector((v.x, v.y + bend * v.x * v.x, v.z)) for v in verts]
    pc.add(verts, probe.tris, "shard")
    pc.recenter()
    pc.scale(SHARD_LENGTH / pc.length())
    (_x0, _y0, zlo), (_x1, _y1, zhi) = pc.bounds()
    cav = vertex_cavity(pc)
    weathered_side = int(h01(tag, "wf") * sides)
    body = (len(stations) - 1) * sides * 2
    for fi in range(len(pc.tris)):
        c, n, _a = pc.face_data(fi)
        # one long side keeps the old weathered skin; every other face is fresh break
        side = (fi // 2) % sides if fi < body else -1
        fresh = side != weathered_side
        pc.mats.append(MAT_GRANITE)
        pc.cols.append([granite_corner(tag, c, n, side + 1, cav[j] * 0.5, zlo, zhi, fresh=fresh) for j in pc.tris[fi]])
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


BUILDERS = [build_boulder] + [lambda i=i: build_chunk(i) for i in range(6)] + [lambda i=i: build_shard(i) for i in range(4)]


def build_kit(collection):
    root = bpy.data.objects.new("BalgathBoulderKit", None)
    collection.objects.link(root)
    pieces = []
    for build in BUILDERS:
        pc = build()
        piece_object(pc, root, collection)
        pieces.append(pc)
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "balgath-boulder-toss-kit",
        "stage": "final",
        "coordinateFrame": {"up": "+Y", "units": "normalized", "pivot": "surface-centroid"},
        "nodes": {pc.name: {"triangles": pc.triangles(), "radius": round(pc.radius(), 3)} for pc in pieces},
        "identityCues": ["moss-capped-granite", "torn-soil-underside", "hanging-roots", "fresh-fracture-faces", "splinters"],
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
    collection = bpy.data.collections.new("BalgathBoulderKit")
    bpy.context.scene.collection.children.link(collection)
    root, pieces = build_kit(collection)
    report = []
    for pc in pieces:
        report.append("%s tris=%d radius=%.3f length=%.3f mats=%s" % (pc.name, pc.triangles(), pc.radius(), pc.length(), ",".join(sorted(set(pc.mats)))))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "balgath_boulder.glb"))
    print("BOULDER_KIT_REPORT_BEGIN")
    print("\n".join(report))
    print("BOULDER_KIT_REPORT_END")


if __name__ == "__main__":
    main()
