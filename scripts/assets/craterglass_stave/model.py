# The Craterglass Stave: a deterministic Blender factory.
#
# Loot from Balgath, the One-Eyed Foreman: an epic two-handed caster staff cut from black
# bog oak out of the Mirefen and crowned with glassy meteor shards from the Starfall
# Crater, round a small turquoise star-glint of the same fire as Balgath's eye. It is
# HELD in the hand. ONE GLB, one scene root, two named mesh children and a glow socket
# (the names are the runtime contract, see contract.mjs):
#
#   Craterglass_Stave   the scene root (sculptRuntime extras); origin AT THE GRIP
#     Stave_Shaft       bronze butt ferrule, the gnarled bog-oak shaft with its knot stubs,
#                       iron and bronze bindings, the leather grip and its thong tails
#     Stave_Head        the bronze cup and claws, the crown of black-green meteor-glass
#                       shards (StaveGlass) and the star-glint core (StaveGlow)
#     Socket_Core       an empty at the core: where a light or spell effect anchors
#
# Held-weapon convention (scripts/asset_pipeline/lib/families.mjs `staff`, measured off
# the shipped staves such as knotted_oak_stave.glb and forgeheart_stave.glb): the mesh
# origin IS the grip, the staff runs along +Y with the head up, it is 2.28 long with the
# grip 40 percent up from the butt (y -0.912 to 1.368), centred on X and Z, and the head's
# wide axis lies on X. The VAR_STAFF grip family then attaches it at the origin with no
# rescale (2.28 is under its 2.4 clamp).
#
# The shipping GLB is made by scripts/assets/craterglass_stave/export_craterglass_stave.mjs,
# which runs this file through Blender in --background, stamps the source fingerprint,
# and optimizes through scripts/assets/build_assets.mjs with specs/craterglass_stave.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/craterglass_stave/model.py -- --out <dir>
#
# Style: the muster kits' texture-free lane, every colour a VERTEX colour: near-black bog
# oak with a faint grain, bronze worn bright on its edges with verdigris in the crevices,
# dark iron, oiled leather, and flat-shaded meteor glass whose inner faces catch the
# core's turquoise light. The glass and glow carry their own material values, so the
# held item should ride the authored-surface arm (AUTHORED_HELD_MODELS) at runtime.
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of a
# descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up with the FRONT toward -Y, which the glTF exporter turns into +Y up
# and +Z front.

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


# Black bog oak, dark iron, bronze with verdigris, oiled leather, black-green meteor
# glass, and the turquoise of Balgath's eye (0x5fe8d2) for the core.
BOG = srgb(0x2A1E17)
BOG_LIGHT = srgb(0x4E3C2E)
BOG_DARK = srgb(0x140D09)
IRON = srgb(0x3C3F46)
IRON_LIGHT = srgb(0x8A9098)
IRON_DARK = srgb(0x1C1E22)
BRONZE = srgb(0x9A6A30)
BRONZE_LIGHT = srgb(0xE6BC72)
BRONZE_DARK = srgb(0x4E3316)
VERDIGRIS = srgb(0x4E8C74)
LEATHER = srgb(0x5C3B25)
LEATHER_LIGHT = srgb(0x8A5E3C)
LEATHER_DARK = srgb(0x2A1A10)
GLASS = srgb(0x0B1512)
GLASS_FACET = srgb(0x17332A)
GLASS_EDGE = srgb(0x5CB093)
GLASS_INNER = srgb(0x2A9E88)
GLASS_TIP = srgb(0x2F6E5A)
CORE = srgb(0x5FE8D2)
CORE_WHITE = srgb(0xD8FFF6)

# Material buckets. The NAMES are the contract (contract.mjs pins them); the renderer keys
# the emissive glow on the name containing `StaveGlow`. Every bucket carries DISTINCT
# metallic/roughness values: the optimizer's dedup merges materials that only differ by
# name, which would silently drop one of these names.
MAT_OAK = "StaveBogOak"
MAT_IRON = "StaveIron"
MAT_BRONZE = "StaveBronze"
MAT_LEATHER = "StaveLeather"
MAT_GLASS = "StaveGlass"
MAT_GLOW = "StaveGlow"
MATERIAL_ORDER = [MAT_OAK, MAT_IRON, MAT_BRONZE, MAT_LEATHER, MAT_GLASS, MAT_GLOW]

MATERIAL_DEFS = {
    MAT_OAK: {"metallic": 0.0, "roughness": 0.8, "emission": None},
    MAT_IRON: {"metallic": 0.6, "roughness": 0.46, "emission": None},
    MAT_BRONZE: {"metallic": 0.8, "roughness": 0.34, "emission": None},
    MAT_LEATHER: {"metallic": 0.0, "roughness": 0.72, "emission": None},
    MAT_GLASS: {"metallic": 0.1, "roughness": 0.12, "emission": None},
    MAT_GLOW: {"metallic": 0.0, "roughness": 0.3, "emission": srgb(0x5FE8D2)},
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
# the stave: dimensions (Blender Z-up; the grip at the origin, the head up +Z)
# ---------------------------------------------------------------------------

BUTT = -0.912  # the ferrule point
TOP = 1.368  # the tallest shard's point
SHAFT_TOP = 0.99
GRIP = (-0.2, 0.24)
CUP_TOP = 1.075
CORE_Z = 1.17
IRON_BANDS = [-0.55, 0.53]
BRONZE_BANDS = [(-0.26, 0.05), (0.3, 0.05), (0.84, 0.07)]
SIDES = 10


def centre(z):
    """The shaft's gently wandering centreline (root wood is never straight), pinned so
    the grip sits exactly on the origin."""
    def raw(zz):
        return Vector((0.007 * math.sin(2.3 * zz + 0.4), 0.005 * math.sin(1.7 * zz + 1.1), 0.0))

    return raw(z) - raw(0.0) + Vector((0.0, 0.0, z))


def shaft_radius(z):
    r = 0.031 + 0.005 * clamp((z - BUTT) / (SHAFT_TOP - BUTT))
    for zk, amp in ((-0.38, 0.006), (0.66, 0.007), (-0.66, 0.004)):
        r += amp * math.exp(-((z - zk) / 0.05) ** 2)
    return r


def oak_paint(c):
    u = c.uv[0]
    t = clamp((c.p.z - BUTT) / (TOP - BUTT))
    col_k = hs("oakcol", int(round(u * SIDES)))
    col = mix(BOG, BOG_LIGHT if col_k > 0.0 else BOG_DARK, 0.45 * abs(col_k))
    return lit(col, c.n, 0.75 + 0.3 * t, c.cav, 0.05, "oak", c.fi, dark=2.0, lift=0.9, key=0.3)


def iron_paint(tag):
    def fn(c):
        return metal(IRON, IRON_LIGHT, IRON_DARK, c, 0.8, edge=0.8, tag=tag)

    return fn


def bronze_paint(tag):
    def fn(c):
        col = BRONZE
        if c.cav < 0.0:
            col = mix(col, BRONZE_LIGHT, clamp(-c.cav * 2.0))
        elif c.cav > 0.0:
            col = mix(col, VERDIGRIS, clamp(c.cav * 2.4) * 0.8)
        t = clamp((c.p.z - BUTT) / (TOP - BUTT))
        return lit(col, c.n, 0.75 + 0.3 * t, 0.0, 0.05, tag, c.fi, key=0.3)

    return fn


def leather_paint(c):
    col = LEATHER
    if c.cav < 0.0:
        col = mix(col, LEATHER_LIGHT, clamp(-c.cav * 1.8))
    return lit(col, c.n, 0.9, c.cav, 0.05, "leather", c.fi, dark=2.4, key=0.25)


def band_at(z, half, r, bevel):
    return lathe([(r - bevel, z - half), (r, z), (r - bevel, z + half)], SIDES, phase=TAU / (2 * SIDES))


def build_shaft():
    me = Mesh("Stave_Shaft")
    axis = lambda c: Vector((0.0, 0.0, c.z))

    # the bronze butt ferrule
    ferrule = lathe([(0.0, BUTT), (0.02, BUTT + 0.04), (0.037, BUTT + 0.085), (0.043, BUTT + 0.112), (0.036, BUTT + 0.14)], SIDES, phase=TAU / (2 * SIDES))
    base = centre(BUTT + 0.1)
    me.add(ferrule, MAT_BRONZE, bronze_paint("ferrule"), T(base.x, base.y, 0.0), inside=lambda c: Vector((0.0, 0.0, max(c.z, BUTT + 0.03))))

    # the gnarled bog-oak shaft along its wandering centreline
    zs = [BUTT + 0.12 + (SHAFT_TOP - BUTT - 0.12) * k / 14 for k in range(15)]
    path = [centre(z) for z in zs]
    radii = [shaft_radius(z) for z in zs]
    me.add(sweep(path, radii, SIDES, tag="shaft", jitter=0.05, up=Vector((1.0, 0.0, 0.0))), MAT_OAK, oak_paint, inside=lambda c: nearest_on_path(path, c))
    # two snapped-off knot stubs
    for k, (z, ang, length) in enumerate(((-0.38, 2.4, 0.05), (0.66, -0.5, 0.045))):
        root = centre(z)
        out = Vector((math.cos(ang), math.sin(ang), 0.35)).normalized()
        stub = [root + out * 0.0, root + out * (shaft_radius(z) + length * 0.6), root + out * (shaft_radius(z) + length)]
        me.add(sweep(stub, [0.016, 0.012, 0.0], 5, tip=True, up=Vector((0.0, 0.0, 1.0))), MAT_OAK, oak_paint, inside=lambda c, stub=stub: nearest_on_path(stub, c))

    # iron bindings
    for k, z in enumerate(IRON_BANDS):
        at = centre(z)
        me.add(band_at(0.0, 0.028, shaft_radius(z) + 0.009, 0.008), MAT_IRON, iron_paint("iron%d" % k), T(at.x, at.y, z), inside=axis)
    # bronze bindings: a double collar with a raised middle rib
    for k, (z, h) in enumerate(BRONZE_BANDS):
        at = centre(z)
        r = shaft_radius(z) + 0.01
        prof = [(r - 0.008, -h * 0.5), (r, -h * 0.3), (r - 0.003, 0.0), (r, h * 0.3), (r - 0.008, h * 0.5)]
        me.add(lathe(prof, SIDES, phase=TAU / (2 * SIDES)), MAT_BRONZE, bronze_paint("bronze%d" % k), T(at.x, at.y, z), inside=axis)

    # the leather grip: three wrapped turns, a ridge per strap edge
    turns = 3
    prof = []
    for k in range(turns * 2 + 1):
        z = GRIP[0] + (GRIP[1] - GRIP[0]) * k / (turns * 2)
        prof.append((shaft_radius(z) + (0.009 if k % 2 else 0.004), z))
    me.add(lathe(prof, SIDES, phase=TAU / (2 * SIDES)), MAT_LEATHER, leather_paint, inside=axis)
    # two thong tails hanging from the top of the grip
    for k, (ang, length) in enumerate(((-2.0, 0.17), (-1.4, 0.12))):
        root = centre(GRIP[1]) + Vector((math.cos(ang) * 0.042, math.sin(ang) * 0.042, -0.01))
        out = Vector((math.cos(ang), math.sin(ang), 0.0))
        tail = [root, root + out * 0.02 + Vector((0.0, 0.0, -length * 0.5)), root + out * 0.028 + Vector((0.004 * k, 0.0, -length))]
        me.add(sweep(tail, [0.006, 0.005, 0.0], 3, tip=True, up=Vector((1.0, 0.0, 0.0))), MAT_LEATHER, leather_paint, inside=lambda c, tail=tail: nearest_on_path(tail, c))
    return me


# ---------------------------------------------------------------------------
# the head: bronze cup and claws, the meteor-glass crown, the star-glint core
# ---------------------------------------------------------------------------

# (angle deg round the shaft, outward lean deg, length, base radius): a tall dark spire
# behind the core, the rest leaning out; the front (-Y, angle -90) stays open so the core
# shows. The crown spreads wider on X than on Y (the head's wide axis is X).
SHARDS = [
    (90.0, 8.0, None, 0.036),
    (32.0, 20.0, 0.25, 0.032),
    (148.0, 21.0, 0.235, 0.031),
    (-4.0, 30.0, 0.2, 0.028),
    (184.0, 29.0, 0.205, 0.029),
    (-40.0, 34.0, 0.14, 0.023),
    (-140.0, 33.0, 0.15, 0.024),
]
SHARD_BASE_Z = 1.07
SPLINTERS = [(-90.0, 0.075), (0.0 + 60.0, 0.06), (120.0, 0.065), (-15.0, 0.055)]


def glass_paint(tag):
    core = Vector((0.0, 0.0, CORE_Z))

    def fn(c):
        col = mix(GLASS, GLASS_FACET, 0.35 + 0.35 * hs(tag, "facet", c.fi))
        t = clamp((c.p.z - SHARD_BASE_Z) / (TOP - SHARD_BASE_Z))
        col = mix(col, GLASS_TIP, 0.18 * t)
        # faces turned toward the core catch its light, fading fast with distance
        to_core = (core - c.fc).normalized()
        facing = clamp(c.n.dot(to_core))
        near = clamp(1.0 - (c.fc - core).length / 0.16)
        col = mix(col, GLASS_INNER, 0.5 * facing * near * near)
        # only the sharpest chipped edges glint green (on a thin prism every corner is a
        # ridge, so a soft threshold would tint the whole shard)
        if c.cav < -0.45:
            col = mix(col, GLASS_EDGE, clamp((-c.cav - 0.45) * 1.5) * 0.35)
        k = 0.85 + 0.9 * max(0.0, c.n.dot(KEY)) ** 4
        return mul(col, k)

    return fn


def shard(tag, base, direction, length, r0):
    """A meteor-glass shard: an irregular five-sided prism that swells a little and then
    chisels to an off-centre point."""
    tip = base + direction * length
    mid = base + direction * (length * 0.55)
    low = base + direction * (length * 0.2)
    path = [base - direction * 0.03, low, mid, tip]
    radii = [r0 * 0.8, r0, r0 * 1.05, 0.0]
    verts, faces, uv = sweep(path, radii, 5, tag=tag, jitter=0.28, tip=True, up=Vector((0.0, 0.0, 1.0)), phase=TAU * h01(tag, "ph"))
    # close the buried base
    faces.append([4, 3, 2, 1, 0])
    return verts, faces, uv, path


def build_head():
    me = Mesh("Stave_Head")
    axis = lambda c: Vector((0.0, 0.0, c.z))
    top = centre(SHAFT_TOP)
    shift = T(top.x, top.y, 0.0)

    # the bronze cup the crown is set in
    cup = lathe([(0.04, 0.93), (0.05, 0.975), (0.08, 1.035), (0.094, 1.062), (0.086, CUP_TOP + 0.008), (0.05, CUP_TOP + 0.012), (0.0, CUP_TOP + 0.005)], 12, phase=TAU / 24)
    me.add(cup, MAT_BRONZE, bronze_paint("cup"), shift, inside=lambda c: Vector((0.0, 0.0, min(max(c.z, 0.97), 1.06))))
    # four bronze claws up the crown
    for k in range(4):
        ang = math.radians(45.0 + 90.0 * k)
        radial = Vector((math.cos(ang), math.sin(ang), 0.0))
        path = [radial * 0.086 + Vector((0.0, 0.0, 1.05)), radial * 0.102 + Vector((0.0, 0.0, 1.12)), radial * 0.094 + Vector((0.0, 0.0, 1.18)), radial * 0.07 + Vector((0.0, 0.0, 1.22))]
        me.add(sweep(path, [0.013, 0.011, 0.008, 0.0], 4, tip=True, flat=0.6, up=Vector((0.0, 0.0, 1.0)), phase=TAU / 8), MAT_BRONZE, bronze_paint("claw%d" % k), shift, inside=lambda c, path=path: nearest_on_path(path, c))

    # the meteor-glass crown
    for k, (ang_d, lean_d, length, r0) in enumerate(SHARDS):
        ang = math.radians(ang_d)
        lean = math.radians(lean_d)
        radial = Vector((math.cos(ang) * 1.0, math.sin(ang) * 0.75, 0.0))
        direction = (Vector((0.0, 0.0, math.cos(lean))) + Vector((math.cos(ang) * 1.15, math.sin(ang) * 0.8, 0.0)) * math.sin(lean)).normalized()
        base = radial * 0.045 + Vector((0.0, 0.0, SHARD_BASE_Z))
        if length is None:
            length = (TOP - base.z) / direction.z  # the tall spire sets the staff's height
        verts, faces, uv, path = shard("shard%d" % k, base, direction, length, r0)
        me.add((verts, faces, uv), MAT_GLASS, glass_paint("shard%d" % k), shift, inside=lambda c, path=path: nearest_on_path(path, c), flat=True)
    # small splinters round the cup's rim
    for k, (ang_d, length) in enumerate(SPLINTERS):
        ang = math.radians(ang_d)
        direction = Vector((math.cos(ang) * 0.9, math.sin(ang) * 0.7, 0.75)).normalized()
        base = Vector((math.cos(ang) * 0.075, math.sin(ang) * 0.075, CUP_TOP - 0.005))
        verts, faces, uv, path = shard("splinter%d" % k, base, direction, length, 0.016)
        me.add((verts, faces, uv), MAT_GLASS, glass_paint("splinter%d" % k), shift, inside=lambda c, path=path: nearest_on_path(path, c), flat=True)

    # the star-glint core: a four-pointed star facing front and back round a small gem
    def core_paint(c):
        d = (c.p - Vector((top.x, top.y, CORE_Z))).length
        return mix(CORE_WHITE, CORE, clamp(d / 0.07))

    pts = []
    for i in range(8):
        a = math.radians(45.0 * i + 22.5 * 0)
        r = 0.078 if i % 2 == 0 else 0.03
        pts.append(Vector((math.cos(a) * r, 0.0, math.sin(a) * r)))
    front = Vector((0.0, -0.034, 0.0))
    back = Vector((0.0, 0.034, 0.0))
    verts = pts + [front, back]
    faces = [[i, (i + 1) % 8, 8] for i in range(8)] + [[(i + 1) % 8, i, 9] for i in range(8)]
    star_at = T(top.x, top.y, CORE_Z) @ RY(math.radians(12.0))
    me.add((verts, faces, None), MAT_GLOW, core_paint, star_at, inside=lambda c: Vector((0.0, 0.0, 0.0)), flat=True)
    # a second, smaller star turned 45 degrees behind the first, for the glint's sparkle
    star2 = T(top.x, top.y, CORE_Z) @ RY(math.radians(57.0)) @ Matrix.Diagonal(Vector((0.62, 0.8, 0.62, 1.0)))
    me.add((verts, faces, None), MAT_GLOW, core_paint, star2, inside=lambda c: Vector((0.0, 0.0, 0.0)), flat=True)
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
    root = empty("Craterglass_Stave", None, collection)
    shaft = build_shaft()
    head = build_head()
    mesh_object(shaft, root, collection, 50.0)
    mesh_object(head, root, collection, 40.0)
    top = centre(SHAFT_TOP)
    socket = empty("Socket_Core", root, collection, (top.x, top.y, CORE_Z))
    socket["socket"] = {"role": "glow-core"}
    meshes = [shaft, head]
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "craterglass-stave",
        "stage": "final",
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards", "origin": "grip"},
        "heldConvention": {"family": "VAR_STAFF", "gripFraction": 0.4, "length": round(TOP - BUTT, 3)},
        "nodes": {m.name: {"triangles": m.triangles()} for m in meshes},
        "identityCues": ["black-bog-oak-shaft", "iron-and-bronze-bindings", "leather-grip", "meteor-glass-crown", "turquoise-star-glint-core"],
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
    collection = bpy.data.collections.new("CraterglassStave")
    bpy.context.scene.collection.children.link(collection)
    root, meshes = build_kit(collection)
    report = []
    for me in meshes:
        (x0, y0, z0), (x1, y1, z1) = me.bounds()
        report.append("%s tris=%d x=%.3f..%.3f y=%.3f..%.3f z=%.3f..%.3f mats=%s" % (me.name, me.triangles(), x0, x1, y0, y1, z0, z1, ",".join(sorted(set(me.mats)))))
    report.append("total tris=%d" % sum(m.triangles() for m in meshes))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "craterglass_stave.glb"))
    print("CRATERGLASS_STAVE_REPORT_BEGIN")
    print("\n".join(report))
    print("CRATERGLASS_STAVE_REPORT_END")


if __name__ == "__main__":
    main()
