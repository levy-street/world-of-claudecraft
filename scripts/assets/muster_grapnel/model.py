# The Fenbridge muster grapnel: a deterministic Blender factory.
#
# Loot from Balgath, the One-Eyed Foreman: the grappling hook the muster's healers throw
# to haul a fallen soldier clear (the game draws the rope procedurally from the ring).
# ONE GLB, one scene root and one named mesh child (the names are the runtime contract,
# see contract.mjs):
#
#   Muster_Grapnel      the scene root (sculptRuntime extras), origin at the RING EYE
#                       centre, where the thrown rope ties on
#     Grapnel_Hook      the forged head: ring eye, shank, crimson cloth grip wrap with its
#                       cord bindings and a loose tail, the crown, and four curved prongs
#                       whose sharp tips are polished steel
#
# The hook hangs down -Y from the ring (the prongs are at the -Y end, their points curling
# back up toward +Y as a grapnel's do); the ring's hole faces +Z.
#
# The shipping GLB is made by scripts/assets/muster_grapnel/export_muster_grapnel.mjs,
# which runs this file through Blender in --background, stamps the source fingerprint,
# and optimizes through scripts/assets/build_assets.mjs with specs/muster_grapnel.json.
#
#   blender --background --factory-startup --python \
#     scripts/assets/muster_grapnel/model.py -- --out <dir>
#
# Style: the muster camp kit's texture-free lane (scripts/assets/muster_camp/model.py),
# its crimson cloth and iron, every colour a VERTEX colour: forged dark iron worn bright
# on its edges, the prong points ground to a mirror polish, a cloth wrap for the grip.
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


# The muster camp's iron and crimson (scripts/assets/muster_camp/model.py), with a
# ground steel for the points and the camp's cream rope for the cord.
IRON = srgb(0x3A3D43)
IRON_LIGHT = srgb(0x8A9098)
IRON_DARK = srgb(0x1F2226)
STEEL = srgb(0xD2DAE1)
STEEL_LIGHT = srgb(0xF0F5F8)
STEEL_DARK = srgb(0x6B737C)
CLOTH_RED = srgb(0xA9372A)
CLOTH_RED_LIGHT = srgb(0xC8513A)
CLOTH_RED_DARK = srgb(0x6E221B)
ROPE = srgb(0xE6D4AE)
ROPE_SHADE = srgb(0xA8926A)

# Material buckets. The NAMES are the contract (contract.mjs pins them). Every bucket
# carries DISTINCT metallic/roughness values: the optimizer's dedup merges materials that
# only differ by name, which would silently drop one of these names.
MAT_IRON = "MusterIron"
MAT_STEEL = "MusterSteel"
MAT_CLOTH = "MusterCloth"
MAT_ROPE = "MusterRope"
MATERIAL_ORDER = [MAT_IRON, MAT_STEEL, MAT_CLOTH, MAT_ROPE]

MATERIAL_DEFS = {
    MAT_IRON: {"metallic": 0.6, "roughness": 0.48, "emission": None},
    MAT_STEEL: {"metallic": 0.85, "roughness": 0.24, "emission": None},
    MAT_CLOTH: {"metallic": 0.0, "roughness": 0.95, "emission": None},
    MAT_ROPE: {"metallic": 0.0, "roughness": 0.9, "emission": None},
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
# the grapnel: dimensions (Blender Z-up; the ring at the origin, the head hangs to -Z)
# ---------------------------------------------------------------------------

RING_R = 0.05
RING_T = 0.015
SHANK_TOP = -0.1
SHANK_BOT = -0.52
WRAP = (-0.37, -0.15)
PRONG_ANGLES = [math.pi / 4 + k * math.pi / 2 for k in range(4)]
STEEL_FROM = 0.5  # the fraction of a prong's length where the ground steel begins
LENGTH_Z = (-0.632, 0.065)


def iron_paint(tag):
    def fn(c):
        t = clamp((c.p.z - LENGTH_Z[0]) / (LENGTH_Z[1] - LENGTH_Z[0]))
        return metal(IRON, IRON_LIGHT, IRON_DARK, c, 0.6 + 0.4 * t, edge=0.7, tag=tag)

    return fn


def steel_paint(tag):
    def fn(c):
        v = c.uv[1]
        grind = smooth(STEEL_FROM, 1.0, v)
        col = mix(mix(IRON, STEEL, 0.7), STEEL, grind)
        if c.cav < 0.0:
            col = mix(col, STEEL_LIGHT, clamp(-c.cav * 2.5))
        # a mirror polish: the face toward the lamp flashes, the rest reflects dark
        k = 0.9 + 0.45 * max(0.0, c.n.dot(KEY)) ** 2
        return mul(col, k)

    return fn


def cloth_paint(c):
    t = clamp((c.p.z - WRAP[0]) / (WRAP[1] - WRAP[0]))
    col = mix(CLOTH_RED_DARK, CLOTH_RED_LIGHT, 0.25 + 0.5 * t)
    return lit(col, c.n, 0.85 + 0.15 * t, c.cav, 0.05, "wrap", c.fi, dark=2.0, key=0.3)


def rope_paint(c):
    return lit(mix(ROPE, ROPE_SHADE, 0.35 * h01("cord", c.fi)), c.n, 0.9, c.cav, 0.05, "cord", c.fi)


def build_hook():
    me = Mesh("Grapnel_Hook")
    axis = lambda c: Vector((0.0, 0.0, c.z))

    # the ring eye: a forged torus in the XZ plane (its hole faces the viewer)
    path = [Vector((math.cos(a) * RING_R, 0.0, math.sin(a) * RING_R)) for a in (TAU * i / 10 + TAU / 40 for i in range(10))]
    me.add(sweep(path, [RING_T] * 10, 4, closed=True, up=Vector((0.0, 1.0, 0.0)), phase=TAU / 8), MAT_IRON, iron_paint("ring"), inside=lambda c: nearest_on_path(path, c, True))
    # the boss the ring is forged through, the shank below it
    boss = lathe([(0.02, SHANK_TOP - 0.01), (0.031, -0.084), (0.029, -0.064), (0.0, -0.05)], 6)
    me.add(boss, MAT_IRON, iron_paint("boss"), inside=axis)
    shank = lathe([(0.021, SHANK_TOP), (0.023, -0.3), (0.026, SHANK_BOT)], 6, phase=TAU / 12)
    me.add(shank, MAT_IRON, iron_paint("shank"), inside=axis)

    # the crimson grip wrap: overlapping turns, a touch lumpy, with a loose tail
    prof = []
    turns = 6
    for k in range(turns + 1):
        z = WRAP[0] + (WRAP[1] - WRAP[0]) * k / turns
        prof.append((0.033 + (0.004 if k % 2 else 0.0), z))
    me.add(lathe(prof, 6, phase=TAU / 12, jitter=0.06, tag="wrap"), MAT_CLOTH, cloth_paint, inside=axis)
    # cord bindings at each end of the wrap
    for k, z in enumerate((WRAP[0], WRAP[1])):
        cord = lathe([(0.038, z - 0.011), (0.039, z + 0.011)], 6, phase=TAU / 12 + 0.3 * k)
        me.add(cord, MAT_ROPE, rope_paint, inside=axis)
    # the loose tail of the wrap, fluttering off the lower binding (two-sided)
    base = Vector((0.03, -0.024, WRAP[0] + 0.02))
    out = Vector((0.75, -0.66, 0.0)).normalized()
    side = Vector((0.0, 0.0, 1.0)).cross(out).normalized()
    pts = [base + out * (0.035 * s) + Vector((0.0, 0.0, -0.1 * s)) + side * (0.012 * math.sin(s * 4.0)) for s in (0.0, 0.34, 0.67, 1.0)]
    verts = []
    for i, p in enumerate(pts):
        w = 0.016 * (1.0 - 0.2 * i / 3)
        verts += [p - side * w, p + side * w]
    verts.append((verts[-2] + verts[-1]) * 0.5 + Vector((0.0, 0.0, 0.025)))
    faces = [[0, 1, 3, 2], [2, 3, 5, 4], [4, 5, 7, 8], [4, 8, 6]]  # a notch in the torn end
    uv = [(0.0, 0.0)] * len(verts)
    me.add((verts, faces, uv), MAT_CLOTH, cloth_paint, inside=lambda c: c - out)
    back = [v + out * 0.003 for v in verts]
    me.add((back, faces, uv), MAT_CLOTH, cloth_paint, inside=lambda c: c + out)

    # the crown the prongs are forged from
    crown = lathe([(0.026, SHANK_BOT + 0.02), (0.046, -0.535), (0.05, -0.565), (0.036, -0.6), (0.0, -0.622)], 8, phase=TAU / 16)
    me.add(crown, MAT_IRON, iron_paint("crown"), inside=lambda c: Vector((0.0, 0.0, min(max(c.z, -0.6), SHANK_BOT))))

    # four prongs: out and down from the crown, curling back up to a ground point
    for k, ang in enumerate(PRONG_ANGLES):
        radial = Vector((math.cos(ang), math.sin(ang), 0.0))
        rz = [(0.03, -0.567), (0.1, -0.607), (0.168, -0.598), (0.214, -0.548), (0.232, -0.47), (0.218, -0.392)]
        path = [radial * r + Vector((0.0, 0.0, z)) for r, z in rz]
        radii = [0.029, 0.026, 0.023, 0.018, 0.011, 0.0]
        verts, faces, uv = sweep(path, radii, 5, tip=True, flat=0.8, up=Vector((0.0, 0.0, 1.0)), phase=TAU / 10)
        iron_f, steel_f = [], []
        for f in faces:
            v = sum(uv[i][1] for i in f) / len(f)
            (steel_f if v >= STEEL_FROM else iron_f).append(f)
        inside = lambda c, path=path: nearest_on_path(path, c)
        me.add((verts, iron_f, uv), MAT_IRON, iron_paint("prong%d" % k), inside=inside)
        me.add((verts, steel_f, uv), MAT_STEEL, steel_paint("tip%d" % k), inside=inside, flat=True)
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
    root = empty("Muster_Grapnel", None, collection)
    hook = build_hook()
    mesh_object(hook, root, collection, 50.0)
    meshes = [hook]
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "muster-grapnel",
        "stage": "final",
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards", "origin": "ring-eye"},
        "rope": {"node": "Muster_Grapnel", "at": "origin"},
        "nodes": {m.name: {"triangles": m.triangles()} for m in meshes},
        "identityCues": ["ring-eye", "forged-shank", "crimson-cloth-wrap", "four-curved-prongs", "polished-steel-points"],
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
    collection = bpy.data.collections.new("MusterGrapnel")
    bpy.context.scene.collection.children.link(collection)
    root, meshes = build_kit(collection)
    report = []
    for me in meshes:
        (x0, y0, z0), (x1, y1, z1) = me.bounds()
        report.append("%s tris=%d x=%.3f..%.3f y=%.3f..%.3f z=%.3f..%.3f mats=%s" % (me.name, me.triangles(), x0, x1, y0, y1, z0, z1, ",".join(sorted(set(me.mats)))))
    report.append("total tris=%d" % sum(m.triangles() for m in meshes))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_kit(root, os.path.join(out_dir, "muster_grapnel.glb"))
    print("MUSTER_GRAPNEL_REPORT_BEGIN")
    print("\n".join(report))
    print("MUSTER_GRAPNEL_REPORT_END")


if __name__ == "__main__":
    main()
