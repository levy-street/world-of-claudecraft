# The Guttered Eye: a deterministic Blender factory.
#
# Loot from Balgath, the One-Eyed Foreman, the grey-granite cyclops of the Mirefen whose
# eye is a glowing turquoise crystal. This is that eye after the fight: cracked and
# burnt out, it floats above the wearer and fires a turquoise beam along its gaze. ONE
# GLB, one scene root, two named mesh children and a beam socket (the names are the
# runtime contract, see contract.mjs):
#
#   Guttered_Eye       the scene root (sculptRuntime extras); origin at the lens centre
#     Eye_Lens         the faceted turquoise crystal lens (material GutteredEyeGlow), its
#                      burnt-out pupil and the dark crack lines (GutteredEyeCrack)
#     Eye_Cage         the blackened iron socket ring and back cup, three claw prongs
#                      gripping the lens, and the torn sinew strands hanging off it
#     Socket_Beam      an empty on the lens face: where the beam leaves the eye
#
# The lens looks down +Z in the glTF frame (the beam direction), +Y up.
#
# The shipping GLB is made by scripts/assets/guttered_eye/export_guttered_eye.mjs, which
# runs this file through Blender in --background, stamps the source fingerprint, and
# optimizes through scripts/assets/build_assets.mjs with specs/guttered_eye.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/guttered_eye/model.py -- --out <dir>
#
# Style: the muster kits' texture-free lane, every colour a VERTEX colour. The lens is
# cut like a cabochon gem (flat-shaded facets, each ring of facets turned half a step
# against the next) and painted from a deep teal rim to a bright iris ring round the
# dead pupil, with sooty facets where it guttered. The iron is blackened, its edges worn
# bright, and the lip facing the lens catches the crystal's turquoise bounce.
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of a
# descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up with the FRONT toward -Y, which the glTF exporter turns into +Y up
# and +Z front. The lens is built along a local +Z axis and turned onto -Y.

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


# Balgath's eye crystal (0x5fe8d2) in a deep-to-bright ramp, the burnt pupil and cracks,
# blackened iron, and wet sinew.
EYE_DEEP = srgb(0x0A4744)
EYE = srgb(0x23A596)
EYE_BRIGHT = srgb(0x7DF2DE)
EYE_CORE = srgb(0x5FE8D2)
SOOT = srgb(0x163230)
CRACK = srgb(0x08100F)
CHAR = srgb(0x1B1614)
IRON = srgb(0x2E2F33)
IRON_LIGHT = srgb(0x6A6D74)
IRON_DARK = srgb(0x151618)
HEAT = srgb(0x4A3526)  # the heat tint where the ring bit into the burning crystal
BOUNCE = srgb(0x1F6B63)  # the crystal's turquoise light on the iron lip
SINEW = srgb(0x5E1B20)
SINEW_LIGHT = srgb(0x93403A)
SINEW_DARK = srgb(0x2A0B0E)
SINEW_TORN = srgb(0xB47868)

# Material buckets. The NAMES are the contract (contract.mjs pins them); the renderer keys
# the emissive glow on the name containing `EyeGlow`. Every bucket carries DISTINCT
# metallic/roughness values: the optimizer's dedup merges materials that only differ by
# name, which would silently drop one of these names.
MAT_GLOW = "GutteredEyeGlow"
MAT_CRACK = "GutteredEyeCrack"
MAT_IRON = "GutteredEyeIron"
MAT_SINEW = "GutteredEyeSinew"
MATERIAL_ORDER = [MAT_GLOW, MAT_CRACK, MAT_IRON, MAT_SINEW]

MATERIAL_DEFS = {
    MAT_GLOW: {"metallic": 0.0, "roughness": 0.18, "emission": srgb(0x2A8C80)},
    MAT_CRACK: {"metallic": 0.0, "roughness": 0.9, "emission": None},
    MAT_IRON: {"metallic": 0.55, "roughness": 0.55, "emission": None},
    MAT_SINEW: {"metallic": 0.0, "roughness": 0.42, "emission": None},
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
# the eye: dimensions (lens-local: axis +Z is the gaze, turned onto -Y at the end)
# ---------------------------------------------------------------------------

N_LENS = 10
# the cabochon's profile (r, w) from the hidden back to the flat table at the front
LENS_PROFILE = [(0.0, -0.085), (0.11, -0.07), (0.158, -0.03), (0.168, 0.01), (0.152, 0.052), (0.114, 0.09), (0.062, 0.114), (0.0, 0.12)]
PUPIL_R = 0.05
RING_IN = 0.15
RING_OUT = 0.222
CLAW_ANGLES = (math.pi / 2, math.pi / 2 + TAU / 3, math.pi / 2 + 2 * TAU / 3)
EYE_SCALE = 1.2  # authored at 0.45 across, shipped at 0.55
# lens-local +Z (the gaze) onto Blender -Y (glTF +Z), at the shipped size
TO_WORLD = Matrix.Diagonal(Vector((EYE_SCALE, EYE_SCALE, EYE_SCALE, 1.0))) @ RX(math.pi / 2)
FROM_WORLD = TO_WORLD.inverted()


def gem_lathe(profile, n, twist):
    """A lathe whose every other ring turns half a facet, so the faces read as cut facets."""
    verts, uv, rows = [], [], []
    for k, (r, z) in enumerate(profile):
        if r <= 1e-9:
            rows.append([len(verts)])
            verts.append(Vector((0.0, 0.0, z)))
            uv.append((0.0, 0.0))
            continue
        row = []
        for i in range(n):
            a = TAU * i / n + twist * (k % 2)
            row.append(len(verts))
            verts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
            uv.append((r, z))
        rows.append(row)
    faces = []
    for k in range(len(rows) - 1):
        a, b = rows[k], rows[k + 1]
        if len(a) == 1:
            for i in range(n):
                faces.append([a[0], b[(i + 1) % n], b[i]])
        elif len(b) == 1:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[0]])
        else:
            for i in range(n):
                faces.append([a[i], a[(i + 1) % n], b[i]])
                faces.append([a[(i + 1) % n], b[(i + 1) % n], b[i]])
    return verts, faces, uv


def ray_hit(tris, x, y):
    """The first point hit by a ray down -Z at (x, y) on a set of triangles (lens-local),
    and that triangle's normal turned to face the viewer (+Z)."""
    best = None
    o = Vector((x, y, 1.0))
    d = Vector((0.0, 0.0, -1.0))
    for a, b, c in tris:
        e1 = b - a
        e2 = c - a
        pv = d.cross(e2)
        det = e1.dot(pv)
        if abs(det) < 1e-12:
            continue
        tv = o - a
        u = tv.dot(pv) / det
        if u < -1e-6 or u > 1.0 + 1e-6:
            continue
        qv = tv.cross(e1)
        v = d.dot(qv) / det
        if v < -1e-6 or u + v > 1.0 + 1e-6:
            continue
        t = e2.dot(qv) / det
        if best is None or t < best[0]:
            best = (t, e1.cross(e2).normalized())
    if best is None:
        return None
    n = best[1] if best[1].z > 0.0 else -best[1]
    return o + d * best[0], n


def lens_paint(c):
    """Deep teal at the rim, a bright iris ring round the pupil, soot where it guttered."""
    fc = FROM_WORLD @ c.fc
    rr = math.hypot(fc.x, fc.y)
    face = hs("lensfacet", c.fi)
    if rr > 0.125:
        col = mix(EYE_DEEP, EYE, 0.3 + 0.2 * face)
    elif rr > 0.095:
        col = mix(EYE, EYE_BRIGHT, 0.35 + 0.25 * face)
    elif rr > PUPIL_R + 0.012:
        col = mix(EYE_BRIGHT, EYE_CORE, 0.2 + 0.2 * face)
    else:
        col = mix(EYE_BRIGHT, EYE_CORE, 0.5)
    ang = math.atan2(fc.y, fc.x)
    # two sooty streaks where the eye guttered out, on the lower flank
    soot = max(0.0, math.cos(ang + 2.1)) ** 3 * 0.75 + max(0.0, math.cos(ang - 2.9)) ** 6 * 0.5
    col = mix(col, SOOT, clamp(soot * (0.6 + 0.4 * face)))
    return lit(col, c.n, 0.9, 0.0, 0.0, "lens", c.fi, key=0.3, lo=0.9, hi=1.0)


def build_lens():
    me = Mesh("Eye_Lens")
    verts, faces, uv = gem_lathe(LENS_PROFILE, N_LENS, TAU / N_LENS * 0.5)
    local = [Vector(v) for v in verts]
    centre = Vector((0.0, 0.0, 0.0))
    # the burnt-out pupil: the flat front table goes dark and dead (no glow)
    table, rest = [], []
    for f in faces:
        c = sum((local[i] for i in f), Vector((0.0, 0.0, 0.0))) / 3.0
        (table if c.z > 0.105 and math.hypot(c.x, c.y) < PUPIL_R else rest).append(f)
    me.add((verts, rest, uv), MAT_GLOW, lens_paint, TO_WORLD, inside=lambda c: centre, flat=True)

    def pupil_paint(c):
        return lit(mix(CRACK, CHAR, 0.5 + 0.5 * h01("pupil", c.fi)), c.n, 1.0, 0.0, 0.0, "pupil", c.fi, key=0.3)

    me.add((verts, table, uv), MAT_CRACK, pupil_paint, TO_WORLD, inside=lambda c: centre, flat=True)

    # the cracks: dark lines laid ON the facets (a ray down the gaze finds each point),
    # zigzagging out from the pupil's rim toward the lens edge, two of them forking
    front = []
    for f in faces:
        tri = [local[i] for i in f]
        if min(p.z for p in tri) > -0.03:
            front.append(tri)
    cracks = [(0.35, 0.155, 7, None), (2.55, 0.16, 7, (3, 0.5)), (4.35, 0.15, 6, (2, -0.55)), (5.45, 0.12, 5, None)]
    for k, (ang, reach, segs, fork) in enumerate(cracks):
        path2d = []
        a = ang
        for i in range(segs + 1):
            r = PUPIL_R * 0.9 + (reach - PUPIL_R * 0.9) * i / segs
            a += 0.2 * hs("crack", k, i)
            path2d.append((r, a))
        lines = [path2d]
        if fork is not None:
            at, turn = fork
            r0, a0 = path2d[at]
            lines.append([(r0 + (reach * 0.8 - r0) * i / 3, a0 + turn * i / 3 + 0.1 * hs("fork", k, i)) for i in range(4)])
        for li, line in enumerate(lines):
            pts, nrms = [], []
            for r, a in line:
                hit = ray_hit(front, math.cos(a) * r, math.sin(a) * r)
                if hit is None:
                    continue
                pts.append(hit[0] + hit[1] * 0.0025)
                nrms.append(hit[1])
            vs, fs = [], []
            width = 0.0055 if li == 0 else 0.004
            for i, p in enumerate(pts):
                t = i / max(1, len(pts) - 1)
                d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
                side = nrms[i].cross(d).normalized()
                w = width * (0.35 + 0.65 * math.sin(math.pi * (0.15 + 0.85 * t)))
                vs += [p - side * w, p + side * w]
            for i in range(len(pts) - 1):
                fs.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])

            def crack_paint(c):
                return mul(CRACK, 1.0 + 0.4 * h01("crk", c.fi))

            me.add((vs, fs, None), MAT_CRACK, crack_paint, TO_WORLD, inside=lambda c: centre, flat=True)
    return me


def ring_profile():
    """The socket ring's closed section (r, w): a chunky forged band whose inner lip bites
    the lens just in front of its equator."""
    return [(RING_IN, 0.046), (0.2, 0.056), (RING_OUT, 0.02), (0.214, -0.04), (0.168, -0.05), (0.156, -0.012)]


def revolve_closed(section, n, phase=0.0):
    verts, faces, uv = [], [], []
    m = len(section)
    for i in range(n):
        a = phase + TAU * i / n
        for r, w in section:
            verts.append(Vector((math.cos(a) * r, math.sin(a) * r, w)))
            uv.append((r, w))
    for i in range(n):
        j = (i + 1) % n
        for k in range(m):
            k2 = (k + 1) % m
            faces.append([i * m + k, j * m + k, j * m + k2, i * m + k2])
    return verts, faces, uv


def iron_paint(tag):
    def fn(c):
        local = FROM_WORLD @ c.p
        col = IRON
        if c.cav < 0.0:
            col = mix(col, IRON_LIGHT, clamp(-c.cav * 1.6))
        elif c.cav > 0.0:
            col = mix(col, IRON_DARK, clamp(c.cav * 2.0))
        rr = math.hypot(local.x, local.y)
        # heat tint and turquoise bounce on the lip that holds the crystal
        near = smooth(0.2, 0.15, rr) * smooth(-0.06, 0.03, local.z)
        col = mix(col, HEAT, 0.35 * near)
        n_local = FROM_WORLD.to_3x3() @ c.n
        inward = -(n_local.x * local.x + n_local.y * local.y) / max(rr, 1e-6)
        col = mix(col, BOUNCE, 0.55 * clamp(inward) * near)
        t = clamp((c.p.z + 0.25) / 0.5)
        return lit(col, c.n, 0.6 + 0.4 * t, 0.0, 0.05, tag, c.fi, key=0.25)

    return fn


def claw_path(ang):
    """A claw rooted on the ring's rim, arching out and forward, its point biting the lens."""
    pts = [(0.214, 0.0), (0.238, 0.055), (0.214, 0.106), (0.162, 0.118), (0.132, 0.1)]
    return [Vector((math.cos(ang) * r, math.sin(ang) * r, w)) for r, w in pts]


def ring_inside(c):
    """The middle of the ring's section nearest a lens-local point (winds the ring)."""
    flat = Vector((c.x, c.y, 0.0))
    if flat.length < 1e-6:
        return Vector((0.0, 0.0, 0.0))
    return flat.normalized() * 0.188


def build_cage():
    me = Mesh("Eye_Cage")
    me.add(revolve_closed(ring_profile(), 16, TAU / 32), MAT_IRON, iron_paint("ring"), TO_WORLD, inside=ring_inside)
    # the back cup the crystal sits in
    cup = lathe([(0.2, -0.048), (0.172, -0.1), (0.1, -0.138), (0.0, -0.15)], 10, phase=TAU / 20)
    me.add(cup, MAT_IRON, iron_paint("cup"), TO_WORLD, inside=lambda c: Vector((0.0, 0.0, 0.0)))
    # three iron straps over the cup, carrying each claw round to a boss at the back
    for k, ang in enumerate(CLAW_ANGLES):
        rib = [Vector((math.cos(ang) * r, math.sin(ang) * r, w)) for r, w in ((0.21, -0.03), (0.182, -0.104), (0.108, -0.146), (0.03, -0.16))]
        me.add(sweep(rib, [0.017, 0.016, 0.015, 0.012], 4, flat=0.45, up=Vector((0.0, 0.0, 1.0)), phase=TAU / 8), MAT_IRON, iron_paint("rib%d" % k), TO_WORLD, inside=lambda c: Vector((0.0, 0.0, 0.0)))
    boss = lathe([(0.04, -0.148), (0.034, -0.172), (0.0, -0.18)], 6)
    me.add(boss, MAT_IRON, iron_paint("boss"), TO_WORLD, inside=lambda c: Vector((0.0, 0.0, -0.14)))
    # six rivets on the ring face
    for k in range(6):
        a = TAU * (k + 0.5) / 6
        rv = lathe([(0.013, 0.0), (0.0, 0.012)], 4, phase=a)
        m = TO_WORLD @ T(math.cos(a) * 0.19, math.sin(a) * 0.19, 0.05)
        me.add(rv, MAT_IRON, iron_paint("rivet"), m, inside=lambda c: Vector((0.0, 0.0, -0.01)))
    # three claws
    for k, ang in enumerate(CLAW_ANGLES):
        path = claw_path(ang)
        radii = [0.036, 0.03, 0.022, 0.013, 0.0]
        me.add(sweep(path, radii, 5, tip=True, flat=0.55, up=Vector((0.0, 0.0, 1.0))), MAT_IRON, iron_paint("claw%d" % k), TO_WORLD, inside=lambda c, path=path: nearest_on_path(path, c))

    # torn sinew strands hanging from the lower rim (built in the world frame: -Z is down)
    def sinew_paint(c):
        t = c.uv[1]
        col = mix(SINEW, SINEW_LIGHT if c.n.z > 0.2 else SINEW_DARK, 0.4)
        col = mix(col, SINEW_TORN, smooth(0.75, 1.0, t) * 0.7)
        return lit(col, c.n, 1.0 - 0.3 * t, c.cav, 0.06, "sinew", c.fi, key=0.3)

    strands = [(-2.25, 0.2, 0.02), (-1.6, 0.28, 0.024), (-0.9, 0.16, 0.018)]
    for k, (ang, length, r0) in enumerate(strands):
        root = TO_WORLD @ Vector((math.cos(ang) * 0.2, math.sin(ang) * 0.2, -0.035))
        path = [root]
        segs = 5
        for i in range(1, segs + 1):
            s = i / segs
            path.append(root + Vector((0.03 * hs("sx", k) * s + 0.02 * math.sin(s * 4.0 + k), 0.05 * s * s, -length * s)))
        radii = [r0 * (1.0 - 0.55 * i / segs) for i in range(segs)] + [0.0]
        me.add(sweep(path, radii, 4, tag="sinew%d" % k, jitter=0.2, tip=True, flat=0.6), MAT_SINEW, sinew_paint, inside=lambda c, path=path: nearest_on_path(path, c))
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
    root = empty("Guttered_Eye", None, collection)
    lens = build_lens()
    cage = build_cage()
    mesh_object(lens, root, collection, 20.0)
    mesh_object(cage, root, collection, 45.0)
    socket = empty("Socket_Beam", root, collection, (0.0, -LENS_PROFILE[-1][1] * EYE_SCALE, 0.0))
    socket["socket"] = {"role": "beam-origin", "direction": "+Z"}
    meshes = [lens, cage]
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "guttered-eye",
        "stage": "final",
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards", "origin": "lens-centre"},
        "beam": {"socket": "Socket_Beam", "direction": "+Z"},
        "nodes": {m.name: {"triangles": m.triangles()} for m in meshes},
        "identityCues": ["faceted-turquoise-lens", "burnt-out-pupil", "crack-lines", "blackened-iron-socket", "three-claw-prongs", "torn-sinew"],
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
    collection = bpy.data.collections.new("GutteredEye")
    bpy.context.scene.collection.children.link(collection)
    root, meshes = build_kit(collection)
    report = []
    for me in meshes:
        (x0, y0, z0), (x1, y1, z1) = me.bounds()
        report.append("%s tris=%d x=%.3f..%.3f y=%.3f..%.3f z=%.3f..%.3f mats=%s" % (me.name, me.triangles(), x0, x1, y0, y1, z0, z1, ",".join(sorted(set(me.mats)))))
    report.append("total tris=%d" % sum(m.triangles() for m in meshes))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "guttered_eye.glb"))
    print("GUTTERED_EYE_REPORT_BEGIN")
    print("\n".join(report))
    print("GUTTERED_EYE_REPORT_END")


if __name__ == "__main__":
    main()
