# The Fenbridge muster standard: a deterministic Blender factory.
#
# Loot from Balgath, the One-Eyed Foreman: the planted battle standard of the Fenbridge
# muster, the marsh militia that fights under crimson banners. The game plants it in the
# ground and two muster soldiers rally to it. ONE GLB, one scene root, three named
# children (the names are the runtime contract, see contract.mjs):
#
#   Muster_Standard            the scene root (sculptRuntime extras), origin at the spike foot
#     Standard_Pole            iron spike foot, dark oak pole with iron bands and a leather
#                              grip, the crossbar with brass knobs and its rope lashing, and
#                              the ribbons tied under the finial
#     Standard_Banner          an EMPTY pivot on the crossbar axis: rotate it to sway the cloth
#       Standard_Banner_Cloth  the crimson banner alone (hanging tabs, pale pike-and-eye emblem on
#                              both faces, cream stripes, a torn and notched lower edge)
#     Standard_Finial          the brass winged spear-point finial
#
# The banner pivot is an empty on purpose: the optimizer's meshopt quantization rewrites a
# MESH node's matrix (it bakes the dequantizing offset and scale in), which would move the
# pivot off the crossbar. The empty keeps the crossbar pivot exact; the cloth mesh rides it.
#
# The shipping GLB is made by scripts/assets/muster_standard/export_muster_standard.mjs,
# which runs this file through Blender in --background, stamps the source fingerprint,
# and optimizes through scripts/assets/build_assets.mjs with specs/muster_standard.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/muster_standard/model.py -- --out <dir>
#
# Style: the muster camp kit's texture-free lane (scripts/assets/muster_camp/model.py):
# its crimson cloth, warm oak and iron palette, every colour a VERTEX colour. The painted
# pass bakes a soft top-down gradient, a front-left key, cavity darkening in the crevices
# and worn highlights on ridges, so the flat-shaded game lighting reads as hand painted.
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of a
# descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up with the FRONT toward -Y, which the glTF exporter turns into +Y up
# and +Z front. Units are game yards; the spike point sits at the origin (y 0).

import hashlib
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

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


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


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


# The muster camp's own colours (scripts/assets/muster_camp/model.py), deepened a step
# for a hero piece: dark oak, crimson cloth, cream trim, iron, brass.
OAK = srgb(0x3F2819)
OAK_LIGHT = srgb(0x6A4329)
OAK_DARK = srgb(0x24170F)
OAK_END = srgb(0xB88A5E)
IRON = srgb(0x4A4E55)
IRON_LIGHT = srgb(0x8A9098)
IRON_DARK = srgb(0x26292E)
LEATHER = srgb(0x6A4A30)
LEATHER_DARK = srgb(0x3E2A1B)
ROPE = srgb(0xE6D4AE)
ROPE_SHADE = srgb(0xA8926A)
CLOTH_RED = srgb(0xA9372A)
CLOTH_RED_LIGHT = srgb(0xC8513A)
CLOTH_RED_DARK = srgb(0x7C271F)
CLOTH_DEEP = srgb(0x4E1813)
CLOTH_CREAM = srgb(0xE9DCC0)
CLOTH_CREAM_SHADE = srgb(0xBFAE8C)
GRIME = srgb(0x3A2A1E)
BRASS = srgb(0xC8963E)
BRASS_LIGHT = srgb(0xF2D284)
BRASS_DARK = srgb(0x7A5424)

# Material buckets. The NAMES are the contract (contract.mjs pins them). Every bucket
# carries DISTINCT metallic/roughness values: the optimizer's dedup merges materials that
# only differ by name, which would silently drop one of these names.
MAT_OAK = "MusterOak"
MAT_IRON = "MusterIron"
MAT_BRASS = "MusterBrass"
MAT_LEATHER = "MusterLeather"
MAT_CLOTH = "MusterCloth"
MATERIAL_ORDER = [MAT_OAK, MAT_IRON, MAT_BRASS, MAT_LEATHER, MAT_CLOTH]

MATERIAL_DEFS = {
    MAT_OAK: {"metallic": 0.0, "roughness": 0.86, "emission": None},
    MAT_IRON: {"metallic": 0.6, "roughness": 0.48, "emission": None},
    MAT_BRASS: {"metallic": 0.75, "roughness": 0.36, "emission": None},
    MAT_LEATHER: {"metallic": 0.0, "roughness": 0.78, "emission": None},
    MAT_CLOTH: {"metallic": 0.0, "roughness": 0.95, "emission": None},
}

# ---------------------------------------------------------------------------
# small math
# ---------------------------------------------------------------------------


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def RX(a):
    return Matrix.Rotation(a, 4, "X")


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


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


def nearest_on_path(path, c, closed=False):
    best = path[0]
    best_d = (c - best).length
    count = len(path) if closed else len(path) - 1
    for k in range(count):
        a, b = path[k], path[(k + 1) % len(path)]
        ab = b - a
        t = clamp((c - a).dot(ab) / max(ab.dot(ab), 1e-12))
        p = a + ab * t
        d = (c - p).length
        if d < best_d:
            best, best_d = p, d
    return best


# ---------------------------------------------------------------------------
# geometry primitives: each returns (verts, faces, uv); uv is per vertex (u around,
# v along) and feeds the painters
# ---------------------------------------------------------------------------


def lathe(profile, n, phase=0.0, jitter=0.0, tag="", sx=1.0, sy=1.0):
    """Revolve `profile` [(r, z), ...] about +Z with n sides. A station with r == 0
    collapses to one apex vertex (a point or a closed cap)."""
    verts, uv, rows = [], [], []
    for k, (r, z) in enumerate(profile):
        v = k / max(1, len(profile) - 1)
        if r <= 1e-9:
            rows.append([len(verts)])
            verts.append(Vector((0.0, 0.0, z)))
            uv.append((0.0, v))
            continue
        row = []
        for i in range(n):
            a = phase + TAU * i / n
            rr = r * (1.0 + jitter * hs(tag, "lj", k, i))
            row.append(len(verts))
            verts.append(Vector((math.cos(a) * rr * sx, math.sin(a) * rr * sy, z)))
            uv.append((i / n, v))
        rows.append(row)
    faces = []
    for k in range(len(rows) - 1):
        a, b = rows[k], rows[k + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(n):
                faces.append([a[0], b[(i + 1) % n], b[i]])
        elif len(b) == 1:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[0]])
        else:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    return verts, faces, uv


def frames(path, closed=False, up=Vector((0.0, 0.0, 1.0))):
    """Parallel-transport frames (tangent, normal, binormal) along a polyline."""
    count = len(path)
    tans = []
    for k in range(count):
        if closed:
            d = path[(k + 1) % count] - path[(k - 1) % count]
        elif k == 0:
            d = path[1] - path[0]
        elif k == count - 1:
            d = path[k] - path[k - 1]
        else:
            d = (path[k + 1] - path[k]).normalized() + (path[k] - path[k - 1]).normalized()
        tans.append(d.normalized())
    nrm = up.cross(tans[0])
    if nrm.length < 1e-6:
        nrm = Vector((1.0, 0.0, 0.0)).cross(tans[0])
    nrm.normalize()
    out = []
    for k in range(count):
        t = tans[k]
        nrm = (nrm - t * nrm.dot(t)).normalized()
        out.append((t, nrm, t.cross(nrm).normalized()))
    return out


def sweep(path, radii, n, tag="", flat=1.0, jitter=0.0, tip=False, closed=False, up=Vector((0.0, 0.0, 1.0)), phase=0.0):
    """A tube along a polyline; `radii` per station; `flat` squashes the section on the
    binormal. `tip` collapses the last station to an apex (a claw, a prong point);
    otherwise open ends stay open unless the caller caps them."""
    fr = frames(path, closed, up)
    verts, uv, rows = [], [], []
    last = len(path) - 1
    for k, p in enumerate(path):
        v = k / max(1, last)
        if tip and k == last:
            rows.append([len(verts)])
            verts.append(p.copy())
            uv.append((0.0, 1.0))
            continue
        _t, nn, bb = fr[k]
        row = []
        for i in range(n):
            a = phase + TAU * i / n
            rr = radii[k] * (1.0 + jitter * hs(tag, "sj", k, i))
            row.append(len(verts))
            verts.append(p + nn * math.cos(a) * rr + bb * math.sin(a) * rr * flat)
            uv.append((i / n, v))
        rows.append(row)
    faces = []
    spans = len(rows) if closed else len(rows) - 1
    for k in range(spans):
        a, b = rows[k], rows[(k + 1) % len(rows)]
        if len(b) == 1:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[0]])
        else:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]])
    return verts, faces, uv


# ---------------------------------------------------------------------------
# the mesh accumulator (one glTF mesh node); painting is deferred so the painters can
# read the per-vertex cavity of the finished part
# ---------------------------------------------------------------------------


class Mesh:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.uv = []
        self.faces = []
        self.mats = []
        self.paints = []
        self.flat = []
        self.cols = []

    def add(self, geo, mat, paint, m=None, inside=None, flat=False):
        """Append a part. `inside(c)` names a LOCAL point inside the part near face
        centroid c; every face is wound so its normal points away from it (three.js
        lights by winding). `flat` marks the part's faces flat shaded (facets)."""
        verts, faces, uv = geo
        m = Matrix.Identity(4) if m is None else m
        base = len(self.verts)
        for k, v in enumerate(verts):
            self.verts.append(m @ Vector(v))
            self.uv.append(uv[k] if uv is not None else (0.0, 0.0))
        for f in faces:
            if inside is not None:
                pts = [Vector(verts[i]) for i in f]
                c = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
                if newell(pts).dot(c - inside(c)) < 0.0:
                    f = list(reversed(f))
            self.faces.append([base + i for i in f])
            self.mats.append(mat)
            self.paints.append(paint)
            self.flat.append(flat)

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)

    def face_data(self, fi):
        pts = [self.verts[i] for i in self.faces[fi]]
        c = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
        return c, newell(pts)

    def cavity(self):
        """Per-vertex concavity over each vertex's one-ring: positive in a crevice,
        negative on a ridge or worn edge."""
        nb = [set() for _ in self.verts]
        nrm = [Vector((0.0, 0.0, 0.0)) for _ in self.verts]
        for fi, f in enumerate(self.faces):
            _c, n = self.face_data(fi)
            for k, i in enumerate(f):
                nrm[i] += n
                nb[i].add(f[k - 1])
                nb[i].add(f[(k + 1) % len(f)])
        out = [0.0] * len(self.verts)
        for i, p in enumerate(self.verts):
            if not nb[i] or nrm[i].length < 1e-9:
                continue
            n = nrm[i].normalized()
            avg = Vector((0.0, 0.0, 0.0))
            edge = 0.0
            for j in nb[i]:
                avg += self.verts[j]
                edge += (self.verts[j] - p).length
            avg /= len(nb[i])
            edge /= len(nb[i])
            out[i] = (avg - p).dot(n) / max(edge, 1e-6)
        return out

    def paint(self):
        cav = self.cavity()
        self.cols = []
        for fi, f in enumerate(self.faces):
            c, n = self.face_data(fi)
            self.cols.append([self.paints[fi](Corner(self.verts[i], n, self.uv[i], c, fi, cav[i])) for i in f])

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


class Corner:
    __slots__ = ("p", "n", "uv", "fc", "fi", "cav")

    def __init__(self, p, n, uv, fc, fi, cav):
        self.p = p
        self.n = n
        self.uv = uv
        self.fc = fc
        self.fi = fi
        self.cav = cav


# ---------------------------------------------------------------------------
# the painted light
# ---------------------------------------------------------------------------

KEY = Vector((-0.45, -0.6, 0.66)).normalized()  # front-left-top, the painter's lamp


def lit(col, n, t, cav=0.0, mottle=0.0, tag="", fi=0, key=0.16, dark=1.4, lift=0.5, lo=0.8, hi=1.1):
    """The hand-painted shade: a bottom-to-top gradient `t` (0..1), a sky lift and an
    under-shadow, a soft key light, crevice darkening and a worn-ridge lift."""
    k = lo + (hi - lo) * t
    if n.z > 0.0:
        k *= 1.0 + 0.1 * n.z
    else:
        k *= 1.0 + 0.22 * n.z
    k *= 1.0 + key * (max(0.0, n.dot(KEY)) - 0.3)
    if cav > 0.0:
        k *= max(0.5, 1.0 - dark * cav)
    else:
        k *= min(1.18, 1.0 - lift * cav)
    if mottle > 0.0:
        k *= 1.0 + mottle * hs(tag, "mottle", fi)
    return mul(col, k)


def metal(base, light, dark, c, t, edge=0.6, mottle=0.05, tag="m"):
    """Worn metal: the edges catch light (a ridge cavity lifts toward `light`), the
    recesses sink toward `dark`, and the whole part reads top-lit."""
    col = base
    if c.cav < 0.0:
        col = mix(col, light, clamp(-c.cav * edge * 2.2))
    elif c.cav > 0.0:
        col = mix(col, dark, clamp(c.cav * 2.0))
    return lit(col, c.n, t, 0.0, mottle, tag, c.fi, key=0.22)


# ---------------------------------------------------------------------------
# the standard: dimensions (Blender Z-up, front -Y)
# ---------------------------------------------------------------------------

POLE_TOP = 3.03  # the oak ends in the finial socket
BAR_Z = 2.85  # the crossbar axis height (the banner pivot)
BAR_Y = -0.074  # the crossbar is lashed to the FRONT of the pole
BAR_HALF = 0.64
BAR_R = 0.027
BANNER_W = 1.0
BANNER_BODY = 1.4  # tab bottom to the notch line
SLEEVE_R = 0.036  # the hanging tabs' radius: the cloth's top edge sits this far under the bar
TABS = [-0.42, -0.14, 0.14, 0.42]
TAB_W = 0.1
HEIGHT = 3.3
BANDS = [0.98, 1.42, 2.24, 2.66]
GRIP = (1.03, 1.37)


def pole_radius(z):
    return 0.047 - 0.008 * clamp(z / POLE_TOP)


def oak_paint(tag, z0, z1):
    def fn(c):
        u, _v = c.uv
        t = clamp((c.p.z - z0) / max(1e-6, z1 - z0))
        # grain: each lathe column is a stave of the split trunk, a touch lighter or
        # darker, with a long streak down its middle
        col_k = hs(tag, "col", int(round(u * 64)))
        col = mix(OAK, OAK_LIGHT if col_k > 0.0 else OAK_DARK, 0.35 * abs(col_k))
        col = mix(col, OAK_DARK, 0.25 * clamp(hs(tag, "knot", int(c.p.z * 7)) - 0.6) * 2.5)
        return lit(col, c.n, t, c.cav, 0.04, tag, c.fi, lo=0.72, hi=1.12)

    return fn


def iron_paint(tag):
    def fn(c):
        t = clamp(c.p.z / HEIGHT)
        return metal(IRON, IRON_LIGHT, IRON_DARK, c, 0.55 + 0.45 * t, tag=tag)

    return fn


def brass_paint(tag):
    def fn(c):
        t = clamp((c.p.z - 2.5) / 0.8)
        col = metal(BRASS, BRASS_LIGHT, BRASS_DARK, c, 0.6 + 0.4 * t, edge=0.8, tag=tag)
        return col

    return fn


def band(z0, z1, r, bevel):
    return lathe([(r - bevel * 0.6, z0), (r, (z0 + z1) * 0.5), (r - bevel * 0.6, z1)], 8, phase=TAU / 16)


def build_pole():
    me = Mesh("Standard_Pole")
    axis = lambda c: Vector((0.0, 0.0, c.z))

    # the iron spike foot: a forged four-sided point in a socket, two nailed langets
    foot = lathe([(0.0, 0.0), (0.026, 0.12), (0.05, 0.2), (0.054, 0.34), (0.05, 0.37)], 8, phase=TAU / 16)
    me.add(foot, MAT_IRON, iron_paint("foot"), inside=lambda c: Vector((0.0, 0.0, max(c.z, 0.05))))
    for s in (-1.0, 1.0):
        lang = lathe([(0.012, 0.34), (0.012, 0.62), (0.0, 0.66)], 4, phase=TAU / 8, sx=1.0, sy=0.45)
        me.add(lang, MAT_IRON, iron_paint("lang"), T(s * 0.046, 0.0, 0.0), inside=axis)

    # the oak pole: eight split-oak staves, hand-hewn (a little per-vertex wobble)
    zs = [0.33, 0.62, 0.98, 1.42, 1.8, 2.24, 2.66, 2.86, POLE_TOP]
    prof = [(pole_radius(z), z) for z in zs] + [(0.0, POLE_TOP + 0.005)]
    me.add(lathe(prof, 8, jitter=0.035, tag="pole"), MAT_OAK, oak_paint("pole", 0.3, POLE_TOP), inside=axis)

    # iron bands
    for k, z in enumerate(BANDS):
        r = pole_radius(z) + 0.011
        me.add(band(z - 0.03, z + 0.03, r, 0.012), MAT_IRON, iron_paint("band%d" % k), inside=axis)

    # the leather grip: wrapped strap, a ridge per turn
    turns = 3
    prof = []
    for k in range(turns * 2 + 1):
        z = GRIP[0] + (GRIP[1] - GRIP[0]) * k / (turns * 2)
        prof.append((pole_radius(z) + (0.007 if k % 2 else 0.003), z))

    def leather(c):
        t = clamp((c.p.z - GRIP[0]) / (GRIP[1] - GRIP[0]))
        return lit(LEATHER, c.n, 0.6 + 0.4 * t, c.cav, 0.05, "grip", c.fi, dark=2.2)

    me.add(lathe(prof, 8, phase=TAU / 16), MAT_LEATHER, leather, inside=axis)

    # the crossbar with its brass knobs
    bar = lathe([(BAR_R, -BAR_HALF), (BAR_R * 1.06, -BAR_HALF * 0.4), (BAR_R * 1.06, BAR_HALF * 0.4), (BAR_R, BAR_HALF)], 6, jitter=0.03, tag="bar")
    bar_m = T(0.0, BAR_Y, BAR_Z) @ RY(math.pi / 2)
    me.add(bar, MAT_OAK, oak_paint("bar", BAR_Z - 0.04, BAR_Z + 0.04), bar_m, inside=axis)
    for s in (-1.0, 1.0):
        knob = lathe([(BAR_R * 1.15, 0.0), (0.042, 0.03), (0.024, 0.07), (0.0, 0.1)], 6)
        m = T(s * (BAR_HALF - 0.005), BAR_Y, BAR_Z) @ RY(s * math.pi / 2)
        me.add(knob, MAT_BRASS, brass_paint("knob"), m, inside=lambda c: Vector((0.0, 0.0, max(0.0, min(c.z, 0.06)))))

    # the rope lashing: two loops crossed over the junction of bar and pole
    centre = Vector((0.0, (BAR_Y + 0.0) * 0.5, BAR_Z))
    for k, tilt in enumerate((0.8, -0.8)):
        u = Vector((math.cos(tilt), 0.0, math.sin(tilt)))
        path = []
        for i in range(8):
            a = TAU * i / 8
            path.append(centre + u * (0.052 * math.cos(a)) + Vector((0.0, 1.0, 0.0)) * (0.085 * math.sin(a)))

        def rope(c, k=k):
            return lit(mix(ROPE, ROPE_SHADE, 0.3 * h01("rope", k, c.fi)), c.n, 0.8, c.cav, 0.05, "rope", c.fi)

        me.add(sweep(path, [0.01] * 8, 3, closed=True, up=u), MAT_CLOTH, rope, inside=lambda c, path=path: nearest_on_path(path, c, True))

    # the ribbons: tied under the finial, a knot and three tails lifting in the wind
    knot = lathe([(0.05, 2.935), (0.058, 2.962), (0.047, 3.0)], 8, jitter=0.12, tag="knot")

    def knot_paint(c):
        return lit(CLOTH_RED_DARK, c.n, 0.9, c.cav, 0.06, "knot", c.fi)

    me.add(knot, MAT_CLOTH, knot_paint, inside=axis)
    ribbons = [(1.95, 0.5, CLOTH_RED), (2.65, 0.38, CLOTH_CREAM), (0.95, 0.46, CLOTH_RED)]  # all behind the pole
    for k, (ang, length, colour) in enumerate(ribbons):
        out = Vector((math.cos(ang), math.sin(ang), 0.0))
        side = Vector((0.0, 0.0, 1.0)).cross(out).normalized()
        start = Vector((0.0, 0.0, 2.96)) + out * 0.05
        segs = 6
        pts = []
        for i in range(segs + 1):
            s = i / segs
            p = start + out * (0.06 * s + 0.1 * s * s) + Vector((0.0, 0.0, -length * s)) + side * (0.05 * math.sin(s * 5.0 + k) * s)
            pts.append(p)
        w = 0.022
        rows = []
        for i, p in enumerate(pts):
            ww = w * (1.0 - 0.15 * i / segs)
            rows.append([p - side * ww, p + side * ww])
        # a swallow tail: the middle of the last edge lifts into a notch
        tip_mid = (rows[-1][0] + rows[-1][1]) * 0.5 + Vector((0.0, 0.0, 0.05))
        verts = []
        for a, b in rows:
            verts += [a, b]
        verts.append(tip_mid)
        faces = []
        for i in range(segs - 1):
            faces.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])
        last = 2 * (segs - 1)
        faces.append([last, last + 1, len(verts) - 1])
        faces.append([last, len(verts) - 1, last + 2])
        faces.append([last + 1, last + 3, len(verts) - 1])
        uv = [(0.0, (i // 2) / segs) for i in range(len(verts))]
        lo_col = CLOTH_CREAM_SHADE if colour is CLOTH_CREAM else CLOTH_RED_DARK

        def ribbon(c, colour=colour, lo_col=lo_col):
            return lit(mix(colour, lo_col, 0.6 * c.uv[1]), c.n, 1.0 - 0.3 * c.uv[1], 0.0, 0.04, "rib", c.fi, key=0.1)

        # two-sided: the same strip wound both ways a hair apart
        normal = out
        me.add((verts, faces, uv), MAT_CLOTH, ribbon, inside=lambda c, normal=normal: c + normal)
        back = [v + out * 0.003 for v in verts]
        me.add((back, faces, uv), MAT_CLOTH, ribbon, inside=lambda c, normal=normal: c - normal)
    return me


# ---------------------------------------------------------------------------
# the banner (banner-local: origin on the crossbar axis, x across, z up, -y front)
# ---------------------------------------------------------------------------

NX = 10
NY = 9
THICK = 0.012
NOTCH = 0.17
DECAL_STEP = 0.0045  # how far each applique layer stands off the cloth


def fold(s, d):
    """The cloth's depth offset (+y is back, away from the viewer) at across `s` and
    drop `d`: three soft vertical folds that deepen toward the free lower edge."""
    t = clamp((d - SLEEVE_R) / BANNER_BODY)
    x = s / BANNER_W
    y = 0.032 * (0.2 + 0.8 * t) * math.sin(TAU * 1.5 * x + 0.9)
    y += 0.004 * t * math.sin(TAU * 3.2 * x + 2.0 * t + 0.3)
    # the free hem bellies a little toward the viewer, which also keeps the back face
    # clear of the pole the banner hangs in front of
    y -= 0.04 * t
    return y


def surf(s, d):
    return Vector((s * (1.0 - 0.02 * clamp(d / BANNER_BODY)), fold(s, d), -d))


def surf_normal(s, d):
    """The FRONT normal (toward -y) of the cloth surface."""
    e = 1e-3
    ds = surf(s + e, d) - surf(s - e, d)
    dd = surf(s, d + e) - surf(s, d - e)
    n = dd.cross(ds)
    if n.y > 0.0:
        n = -n
    return n.normalized()


def edge_drop(i):
    """How far below the notch line column i of the lower edge hangs: tongues on even
    columns, notches on odd, with torn jitter and one tongue torn short."""
    if i % 2 == 0:
        d = NOTCH * (0.85 + 0.3 * h01("tongue", i))
        if i == 4:
            d *= 0.45  # torn off
    else:
        d = 0.02 * hs("notch", i)
        if i == 7:
            d -= 0.13  # a ragged tear up into the cloth
    return d


def cloth_colour(s, d, n, front, fi, cav):
    """The crimson field, deepening toward the hem, darker along the side hems and the
    tongues, the folds painted light and shade from the lamp."""
    half = BANNER_W * 0.5
    t = clamp((d - SLEEVE_R) / (BANNER_BODY + NOTCH))
    col = mix(CLOTH_RED_LIGHT, CLOTH_RED, smooth(0.0, 0.45, t))
    col = mix(col, CLOTH_RED_DARK, smooth(0.55, 1.0, t) * 0.8)
    hem = smooth(half - 0.08, half, abs(s))
    col = mix(col, CLOTH_RED_DARK, 0.7 * hem)
    if d > SLEEVE_R + BANNER_BODY - 0.005:
        col = mix(col, CLOTH_DEEP, 0.45 + 0.35 * clamp((d - BANNER_BODY) / NOTCH))
        col = mix(col, GRIME, 0.18)
    key = KEY if front else Vector((-KEY.x, -KEY.y, KEY.z))
    k = 0.7 + 0.46 * max(0.0, n.dot(key))
    k *= 1.0 - 0.14 * smooth(0.0, 0.1, SLEEVE_R + 0.1 - d)  # shade under the bar
    k *= 1.0 + 0.03 * hs("cloth", front, fi)
    if cav > 0.0:
        k *= max(0.6, 1.0 - 1.6 * cav)
    return mul(col, k)


def emblem_polys():
    """The pale pike-and-eye emblem in banner (s, d) coordinates: two crossed pikes,
    each with a leaf blade, behind an almond eye with a crimson iris. Returns a list of
    (layer, colour, [(s, d), ...] triangles)."""
    tris = []
    cy = 0.74
    for sgn in (-1.0, 1.0):
        # shaft from lower (butt) to upper (blade) along the diagonal
        a = Vector((-sgn * 0.3, cy + 0.36))
        b = Vector((sgn * 0.27, cy - 0.33))
        dirv = (b - a).normalized()
        perp = Vector((-dirv.y, dirv.x))
        w = 0.021
        segs = 10
        for k in range(segs):
            p0 = a + (b - a) * (k / segs)
            p1 = a + (b - a) * ((k + 1) / segs)
            q = [p0 - perp * w, p0 + perp * w, p1 + perp * w, p1 - perp * w]
            tris.append((1, CLOTH_CREAM, [q[0], q[1], q[2]]))
            tris.append((1, CLOTH_CREAM, [q[0], q[2], q[3]]))
        # the leaf blade past b, and a butt cap before a
        base = b
        tip = b + dirv * 0.2
        mid = b + dirv * 0.07
        l = mid + perp * 0.055
        r = mid - perp * 0.055
        tris.append((2, CLOTH_CREAM, [base, l, tip]))
        tris.append((2, CLOTH_CREAM, [base, tip, r]))
        cap0 = a - dirv * 0.04
        tris.append((2, CLOTH_CREAM, [cap0 + perp * 0.03, a + perp * 0.03, a - perp * 0.03]))
        tris.append((2, CLOTH_CREAM, [cap0 + perp * 0.03, a - perp * 0.03, cap0 - perp * 0.03]))
    # the almond eye: a pointed lens shape over the crossing
    rim = []
    n = 16
    for i in range(n):
        a = TAU * i / n
        x = 0.19 * math.cos(a)
        y = 0.095 * math.sin(a) * (1.0 - 0.35 * abs(math.cos(a)) ** 3)
        rim.append(Vector((x, cy + y)))
    c = Vector((0.0, cy))
    inner = [c + (p - c) * 0.5 for p in rim]
    for i in range(n):
        j = (i + 1) % n
        tris.append((3, CLOTH_CREAM, [inner[i], rim[i], rim[j]]))
        tris.append((3, CLOTH_CREAM, [inner[i], rim[j], inner[j]]))
        tris.append((3, CLOTH_CREAM, [c, inner[i], inner[j]]))
    iris = []
    m = 10
    for i in range(m):
        a = TAU * i / m
        iris.append(Vector((0.058 * math.cos(a), cy + 0.058 * math.sin(a))))
    for i in range(m):
        tris.append((4, CLOTH_RED_DARK, [c, iris[i], iris[(i + 1) % m]]))
    return tris


TRIM = 0.045  # the cream trim frame's inset from the side hems


def stripe_polys(d0, d1):
    """A horizontal cream trim line, one segment per cloth column so it rides the folds."""
    tris = []
    x0 = -BANNER_W * 0.5 + TRIM
    x1 = BANNER_W * 0.5 - TRIM
    cuts = [x0] + [-BANNER_W * 0.5 + BANNER_W * i / NX for i in range(1, NX) if x0 < -BANNER_W * 0.5 + BANNER_W * i / NX < x1] + [x1]
    for i in range(len(cuts) - 1):
        a, b, c, d = Vector((cuts[i], d0)), Vector((cuts[i + 1], d0)), Vector((cuts[i + 1], d1)), Vector((cuts[i], d1))
        tris.append((1, CLOTH_CREAM, [a, b, c]))
        tris.append((1, CLOTH_CREAM, [a, c, d]))
    return tris


def side_trim_polys(d0, d1, w):
    """The two vertical trim lines joining the stripes into a frame round the emblem."""
    tris = []
    step = BANNER_BODY / (NY - 1)
    cuts = [d0] + [k * step for k in range(1, NY) if d0 < k * step < d1] + [d1]
    for sgn in (-1.0, 1.0):
        s0 = sgn * (BANNER_W * 0.5 - TRIM)
        s1 = s0 - sgn * w
        for i in range(len(cuts) - 1):
            a, b, c, d = Vector((s0, cuts[i])), Vector((s1, cuts[i])), Vector((s1, cuts[i + 1])), Vector((s0, cuts[i + 1]))
            tris.append((1, CLOTH_CREAM, [a, b, c]))
            tris.append((1, CLOTH_CREAM, [a, c, d]))
    return tris


def build_banner():
    me = Mesh("Standard_Banner_Cloth")
    half = BANNER_W * 0.5
    dx = BANNER_W / NX
    dy = BANNER_BODY / (NY - 1)
    # `grid` holds the (s, d) each vertex is DRAWN at (the notched hem drops, the lower
    # rows fray, the side hems waver); the decals map through the UNIFORM parameter grid
    # onto the very triangles drawn from it, so they can never sink into a fold.
    grid = []
    for j in range(NY):
        row = []
        for i in range(NX + 1):
            s = -half + dx * i
            d = SLEEVE_R + dy * j
            if j == NY - 1:
                d += edge_drop(i)
            elif j >= NY - 3:
                d += 0.006 * hs("fray", i, j)
            if i in (0, NX) and j > NY // 2:
                s += 0.008 * hs("side", j)
            row.append((s, d))
        grid.append(row)

    front_pts = [[surf(s, d) for s, d in row] for row in grid]
    back_pts = [[surf(s, d) - surf_normal(s, d) * THICK for s, d in row] for row in grid]
    cols = NX + 1

    def tri_sheet(pts):
        verts = [p for row in pts for p in row]
        faces = []
        for j in range(NY - 1):
            for i in range(NX):
                a = j * cols + i
                faces.append([a, a + 1, a + cols + 1])
                faces.append([a, a + cols + 1, a + cols])
        return verts, faces, [sd for row in grid for sd in row]

    def on_cloth(pts, s, d):
        """The point of the DRAWN cloth at parameter (s, d), and that triangle's normal."""
        u = (s + half) / dx
        v = (d - SLEEVE_R) / dy
        i = min(NX - 1, max(0, int(math.floor(u))))
        j = min(NY - 2, max(0, int(math.floor(v))))
        u -= i
        v -= j
        p00, p10, p11, p01 = pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]
        if u >= v:
            p = p00 * (1.0 - u) + p10 * (u - v) + p11 * v
            n = (p10 - p00).cross(p11 - p00)
        else:
            p = p00 * (1.0 - v) + p11 * u + p01 * (v - u)
            n = (p11 - p00).cross(p01 - p00)
        return p, n.normalized()

    def cloth_paint(front):
        def fn(c):
            s, d = c.uv
            return cloth_colour(s, d, c.n, front, c.fi, c.cav)

        return fn

    me.add(tri_sheet(front_pts), MAT_CLOTH, cloth_paint(True), inside=lambda c: c + Vector((0.0, 0.05, 0.0)))
    me.add(tri_sheet(back_pts), MAT_CLOTH, cloth_paint(False), inside=lambda c: c - Vector((0.0, 0.05, 0.0)))

    # close the side and lower edges so the cloth has a body, not a paper edge
    edge_loop = [(j, 0) for j in range(NY)] + [(NY - 1, i) for i in range(1, NX + 1)] + [(j, NX) for j in range(NY - 2, -1, -1)]
    verts, faces, uv = [], [], []
    for k in range(len(edge_loop) - 1):
        (j0, i0), (j1, i1) = edge_loop[k], edge_loop[k + 1]
        base = len(verts)
        verts += [front_pts[j0][i0], front_pts[j1][i1], back_pts[j1][i1], back_pts[j0][i0]]
        uv += [grid[j0][i0], grid[j1][i1], grid[j1][i1], grid[j0][i0]]
        faces.append([base, base + 1, base + 2, base + 3])

    def edge_paint(c):
        s, d = c.uv
        return mul(cloth_colour(s, d, c.n, True, c.fi, 0.0), 0.7)

    centre_line = lambda c: Vector((0.0, c.y, -SLEEVE_R - BANNER_BODY * 0.45))
    me.add((verts, faces, uv), MAT_CLOTH, edge_paint, inside=centre_line)

    # the hanging tabs looped round the crossbar, spaced clear of the pole behind it
    def tab_paint(c):
        n = c.n
        k = 0.78 + 0.3 * max(0.0, n.dot(KEY)) + 0.1 * max(0.0, n.z)
        col = mix(CLOTH_RED, CLOTH_RED_DARK, 0.35 + 0.3 * max(0.0, -n.z))
        if c.cav > 0.0:
            k *= max(0.6, 1.0 - 1.4 * c.cav)
        return mul(col, k * (1.0 + 0.03 * hs("tab", c.fi)))

    for k, x in enumerate(TABS):
        tab = lathe([(SLEEVE_R, -TAB_W * 0.5), (SLEEVE_R * 1.04, TAB_W * 0.5)], 6, phase=-TAU / 4, jitter=0.05, tag="tab%d" % k)
        me.add(tab, MAT_CLOTH, tab_paint, T(x, 0.0, 0.0) @ RY(math.pi / 2), inside=lambda c: Vector((0.0, 0.0, c.z)))

    # the emblem and the trim frame, appliqued on both faces: each layer stands a hair
    # proud of the one under it, along the normal of the cloth triangle it sits on
    top0, top1 = 0.1, 0.124
    bot0, bot1 = BANNER_BODY - 0.1, BANNER_BODY - 0.076
    decals = emblem_polys() + stripe_polys(top0, top1) + stripe_polys(bot0, bot1) + side_trim_polys(top0, bot1, top1 - top0)
    for front_side in (True, False):
        verts, faces, uv, colours = [], [], [], []
        for layer, colour, tri in decals:
            base = len(verts)
            for q in tri:
                s, d = q.x, q.y + SLEEVE_R
                off = DECAL_STEP * layer
                if front_side:
                    p, n = on_cloth(front_pts, s, d)
                    n = n if n.y < 0.0 else -n
                else:
                    p, n = on_cloth(back_pts, s, d)
                    n = n if n.y > 0.0 else -n
                verts.append(p + n * off)
                uv.append((s, d))
            faces.append([base, base + 1, base + 2])
            colours.append(colour)

        def decal_paint(c, colours=colours, front_side=front_side, first=len(me.faces)):
            _s, d = c.uv
            base = colours[c.fi - first]
            key = KEY if front_side else Vector((-KEY.x, -KEY.y, KEY.z))
            k = 0.78 + 0.36 * max(0.0, c.n.dot(key))
            t = clamp((d - SLEEVE_R) / BANNER_BODY)
            if base is CLOTH_CREAM:
                colour = mix(CLOTH_CREAM, CLOTH_CREAM_SHADE, 0.2 + 0.35 * t)
            else:
                colour = base
            return mul(colour, k)

        facing = (lambda c: c + Vector((0.0, 0.05, 0.0))) if front_side else (lambda c: c - Vector((0.0, 0.05, 0.0)))
        me.add((verts, faces, uv), MAT_CLOTH, decal_paint, inside=facing)
    return me


# ---------------------------------------------------------------------------
# the finial: a brass winged spear point on a socket collar
# ---------------------------------------------------------------------------


def build_finial():
    me = Mesh("Standard_Finial")
    axis = lambda c: Vector((0.0, 0.0, c.z))
    socket = lathe([(0.046, 3.0), (0.051, 3.02), (0.036, 3.07), (0.03, 3.1), (0.043, 3.125), (0.022, 3.15)], 8, phase=TAU / 16)
    me.add(socket, MAT_BRASS, brass_paint("socket"), inside=axis)
    # the leaf blade: a flat diamond section, wide on X (it faces the viewer)
    blade = lathe([(0.02, 3.145), (0.062, 3.19), (0.05, 3.235), (0.0, HEIGHT)], 4, sx=1.0, sy=0.32)
    me.add(blade, MAT_BRASS, brass_paint("blade"), inside=axis, flat=True)
    # two swept-back wings (lugs) under the blade
    for s in (-1.0, 1.0):
        path = [Vector((s * 0.03, 0.0, 3.12)), Vector((s * 0.07, 0.0, 3.1)), Vector((s * 0.1, 0.0, 3.07))]
        me.add(sweep(path, [0.012, 0.009, 0.005], 4, tip=True, flat=0.6, up=Vector((0.0, 1.0, 0.0))), MAT_BRASS, brass_paint("wing"), inside=lambda c, path=path: nearest_on_path(path, c))
    return me


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
    if spec["emission"] is not None:
        bsdf.inputs["Emission Color"].default_value = (*spec["emission"], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


def check_materials():
    seen = set()
    for name in MATERIAL_ORDER:
        spec = MATERIAL_DEFS[name]
        key = (spec["metallic"], spec["roughness"], spec["emission"])
        if key in seen:
            raise SystemExit("material %s duplicates another bucket (dedup would merge it)" % name)
        seen.add(key)


def mesh_object(me, parent, collection, angle):
    me.paint()
    mats = [m for m in MATERIAL_ORDER if m in set(me.mats)]
    data = bpy.data.meshes.new(me.name)
    data.from_pydata([tuple(v) for v in me.verts], [], me.faces)
    data.validate(clean_customdata=False)
    for m in mats:
        data.materials.append(make_material(m))
    data.polygons.foreach_set("material_index", [mats.index(m) for m in me.mats])
    col = data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    flat_cols = []
    for cols in me.cols:
        for c in cols:
            flat_cols.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", flat_cols)
    data.color_attributes.active_color_index = 0
    data.color_attributes.render_color_index = 0
    data.shade_smooth()
    data.set_sharp_from_angle(angle=math.radians(angle))
    sharp = data.attributes.get("sharp_face") or data.attributes.new("sharp_face", "BOOLEAN", "FACE")
    sharp.data.foreach_set("value", [bool(f) for f in me.flat])
    data.update()
    obj = bpy.data.objects.new(me.name, data)
    obj.parent = parent
    collection.objects.link(obj)
    return obj


def empty(name, parent, collection, loc=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.location = loc
    obj.parent = parent
    collection.objects.link(obj)
    return obj


def build_kit(collection):
    check_materials()
    root = empty("Muster_Standard", None, collection)
    pole = build_pole()
    banner = build_banner()
    finial = build_finial()
    mesh_object(pole, root, collection, 50.0)
    pivot = empty("Standard_Banner", root, collection, (0.0, BAR_Y, BAR_Z))
    mesh_object(banner, pivot, collection, 60.0)
    mesh_object(finial, root, collection, 40.0)
    meshes = [pole, banner, finial]
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "muster-standard",
        "stage": "final",
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards", "origin": "spike-point"},
        "nativeHeight": HEIGHT,
        "bannerPivot": {"node": "Standard_Banner", "axis": "+X", "height": BAR_Z},
        "nodes": {m.name: {"triangles": m.triangles()} for m in meshes},
        "identityCues": ["iron-spike-foot", "dark-oak-pole", "iron-bands", "crimson-banner", "pike-and-eye-emblem", "notched-torn-hem", "brass-winged-finial", "tied-ribbons"],
    }
    return root, meshes


def export_kit(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
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
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.data.collections.new("MusterStandard")
    bpy.context.scene.collection.children.link(collection)
    root, meshes = build_kit(collection)
    report = []
    for me in meshes:
        (x0, y0, z0), (x1, y1, z1) = me.bounds()
        report.append("%s tris=%d x=%.3f..%.3f y=%.3f..%.3f z=%.3f..%.3f mats=%s" % (me.name, me.triangles(), x0, x1, y0, y1, z0, z1, ",".join(sorted(set(me.mats)))))
    report.append("total tris=%d" % sum(m.triangles() for m in meshes))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "muster_standard.glb"))
    print("MUSTER_STANDARD_REPORT_BEGIN")
    print("\n".join(report))
    print("MUSTER_STANDARD_REPORT_END")


if __name__ == "__main__":
    main()
