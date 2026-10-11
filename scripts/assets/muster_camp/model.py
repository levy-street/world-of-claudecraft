# The Mirefen muster camp kit: a deterministic Blender factory.
#
# Builds every piece of the army camp Balgath smashes around the Starfall Crater
# (src/sim/content/mirefen_muster.ts is the layout; src/render/muster_camps.ts
# places the kit) and exports one raw GLB per piece. The shipping GLBs are made by
# scripts/assets/muster_camp/export_muster_camp.mjs, which runs this file through
# Blender in --background, stamps the source fingerprint, and optimizes through
# scripts/assets/build_assets.mjs with specs/muster_camp.json.
#
#   blender --background --python scripts/assets/muster_camp/model.py -- --out <dir>
#
# Style: stylized low-poly, hand-painted by VERTEX COLOUR (no textures): warm brown
# wood with lighter carved tips, cream rope lashings, red and cream cloth, grey
# stone footings, iron bolts. Chunky chamfers, per-face colour mottling, and a
# height gradient stand in for the painted texture; the renderer's shared
# triplanar surface layer adds the wood/fabric/metal grain per material family
# (src/render/worn_stone.ts routes on the material NAMES below).
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of
# a descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up with the FRONT toward -Y, which the glTF exporter turns into
# +Y up and +Z front. Units are yards (1 Blender unit = 1 yard). Every piece is
# floor-seated at z 0 and centred on its footprint.

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


WOOD_DARK = srgb(0x55341F)
WOOD_MID = srgb(0x7A4B2E)
WOOD_WARM = srgb(0x8E5C38)
WOOD_PLANK = srgb(0x946440)
WOOD_CARVED = srgb(0xD9AE82)
WOOD_ENDGRAIN = srgb(0xC89A6C)
ROPE = srgb(0xE6D4AE)
ROPE_SHADE = srgb(0xC9B48C)
CLOTH_RED = srgb(0xA9372A)
CLOTH_RED_DARK = srgb(0x7C271F)
CLOTH_CREAM = srgb(0xE9DCC0)
CANVAS_CREAM = srgb(0xDCCBA6)
CANVAS_RED = srgb(0xA63B2D)
SACK = srgb(0xC8A676)
TENT_DARK = srgb(0x2A1C14)
IRON = srgb(0x4A4E55)
IRON_LIGHT = srgb(0x6E737B)
STONE = srgb(0x7F8184)
STONE_LIGHT = srgb(0xA3A4A5)
COALS = srgb(0x3A2014)
GLOW = srgb(0xFFB24A)
CRYSTAL = srgb(0x6DEBF2)
CRYSTAL_DEEP = srgb(0x1E97B4)
HAFT = srgb(0x3E2A1D)
WRAP = srgb(0x6A4A30)

# Material buckets. The NAMES are load-bearing: src/render/worn_stone.ts routes the
# runtime surface-detail family by name (wood, cloth -> fabric, iron -> metal,
# rock -> rock) and skips glow/crystal, and src/render/props.ts MAT_OVERRIDES keys
# the emissive glow on `muster:MusterGlow` / `muster:MusterCrystal`.
MAT_WOOD = "MusterWood"
MAT_CLOTH = "MusterCloth"
MAT_IRON = "MusterIron"
MAT_ROCK = "MusterRock"
MAT_GLOW = "MusterGlow"
MAT_CRYSTAL = "MusterCrystal"
MATERIAL_ORDER = [MAT_WOOD, MAT_CLOTH, MAT_IRON, MAT_ROCK, MAT_GLOW, MAT_CRYSTAL]

MATERIAL_DEFS = {
    MAT_WOOD: {"metallic": 0.0, "roughness": 0.86, "emission": None},
    MAT_CLOTH: {"metallic": 0.0, "roughness": 0.95, "emission": None},
    MAT_IRON: {"metallic": 0.6, "roughness": 0.48, "emission": None},
    MAT_ROCK: {"metallic": 0.0, "roughness": 0.92, "emission": None},
    MAT_GLOW: {"metallic": 0.0, "roughness": 0.5, "emission": srgb(0xFF9A3C)},
    MAT_CRYSTAL: {"metallic": 0.0, "roughness": 0.25, "emission": srgb(0x3FD8E8)},
}

# ---------------------------------------------------------------------------
# geometry primitives (local space, returned as (verts, faces))
# ---------------------------------------------------------------------------


def ring(n, r, z, phase=0.0, jitter=0.0, tag=""):
    out = []
    for i in range(n):
        a = phase + TAU * i / n
        rr = r * (1.0 + jitter * hs(tag, "ring", i))
        out.append((math.cos(a) * rr, math.sin(a) * rr, z))
    return out


def prism(n, r0, r1, h, z0=0.0, cap0=True, cap1=True, phase=0.0, jitter=0.0, tag=""):
    verts = ring(n, r0, z0, phase, jitter, tag + "b") + ring(n, r1, z0 + h, phase, jitter, tag + "t")
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    if cap0:
        faces.append(list(reversed(range(n))))
    if cap1:
        faces.append([n + i for i in range(n)])
    return verts, faces


def stake(n, r, h, tip, tag, jitter=0.07, butt=0.0):
    """A pointed, hand-carved post: n-sided shaft, faceted tip, optional butt point."""
    verts = []
    faces = []
    z_start = butt
    rings = [
        ring(n, r * 1.02, z_start, 0.0, jitter, tag + "r0"),
        ring(n, r * 0.97, h * 0.55, 0.0, jitter * 0.8, tag + "r1"),
        ring(n, r * 0.94, h - tip, 0.0, jitter * 0.6, tag + "r2"),
    ]
    for rg in rings:
        verts.extend(rg)
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
    apex = len(verts)
    verts.append((0.05 * r * hs(tag, "ax"), 0.05 * r * hs(tag, "ay"), h))
    top = (len(rings) - 1) * n
    for i in range(n):
        j = (i + 1) % n
        faces.append([top + i, top + j, apex])
    if butt > 0.0:
        low = len(verts)
        verts.append((0.0, 0.0, 0.0))
        for i in range(n):
            j = (i + 1) % n
            faces.append([j, i, low])
    else:
        faces.append(list(reversed(range(n))))
    return verts, faces


def log_x(n, r, length, tip0=0.0, tip1=0.0, tag="", jitter=0.06):
    """A log along X, centred, with pointed or flat ends."""
    half = length / 2.0
    xs = [-half + tip0, -half * 0.3, half * 0.3, half - tip1]
    verts = []
    faces = []
    for k, x in enumerate(xs):
        for i in range(n):
            a = TAU * i / n
            rr = r * (1.0 + jitter * hs(tag, "l", k, i))
            verts.append((x, math.cos(a) * rr, math.sin(a) * rr))
    for k in range(len(xs) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + j, k * n + i, (k + 1) * n + i, (k + 1) * n + j])
    last = (len(xs) - 1) * n
    if tip0 > 0.0:
        a0 = len(verts)
        verts.append((-half, 0.02 * hs(tag, "t0y"), 0.02 * hs(tag, "t0z")))
        for i in range(n):
            j = (i + 1) % n
            faces.append([i, j, a0])
    else:
        faces.append(list(range(n)))
    if tip1 > 0.0:
        a1 = len(verts)
        verts.append((half, 0.02 * hs(tag, "t1y"), 0.02 * hs(tag, "t1z")))
        for i in range(n):
            j = (i + 1) % n
            faces.append([last + j, last + i, a1])
    else:
        faces.append([last + i for i in reversed(range(n))])
    return verts, faces


def cbox(sx, sy, sz, b):
    """A chamfered box centred at the origin (the chunky stylized plank/crate)."""
    hx, hy, hz = sx / 2.0, sy / 2.0, sz / 2.0
    b = min(b, hx * 0.45, hy * 0.45, hz * 0.45)
    verts = []
    idx = {}
    for i in (-1, 1):
        for j in (-1, 1):
            for k in (-1, 1):
                idx[(i, j, k, "x")] = len(verts)
                verts.append((i * hx, j * (hy - b), k * (hz - b)))
                idx[(i, j, k, "y")] = len(verts)
                verts.append((i * (hx - b), j * hy, k * (hz - b)))
                idx[(i, j, k, "z")] = len(verts)
                verts.append((i * (hx - b), j * (hy - b), k * hz))
    faces = []
    for s in (-1, 1):
        faces.append([idx[(s, j, k, "x")] for j, k in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        faces.append([idx[(i, s, k, "y")] for i, k in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        faces.append([idx[(i, j, s, "z")] for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for j in (-1, 1):
        for k in (-1, 1):
            faces.append([idx[(-1, j, k, "y")], idx[(1, j, k, "y")], idx[(1, j, k, "z")], idx[(-1, j, k, "z")]])
    for i in (-1, 1):
        for k in (-1, 1):
            faces.append([idx[(i, -1, k, "x")], idx[(i, 1, k, "x")], idx[(i, 1, k, "z")], idx[(i, -1, k, "z")]])
    for i in (-1, 1):
        for j in (-1, 1):
            faces.append([idx[(i, j, -1, "x")], idx[(i, j, 1, "x")], idx[(i, j, 1, "y")], idx[(i, j, -1, "y")]])
    for i in (-1, 1):
        for j in (-1, 1):
            for k in (-1, 1):
                faces.append([idx[(i, j, k, "x")], idx[(i, j, k, "y")], idx[(i, j, k, "z")]])
    return orient_convex(verts, faces)


def orient_convex(verts, faces, center=None):
    """Wind every face outward for a (near) convex shape."""
    if center is None:
        n = float(len(verts))
        center = Vector((sum(v[0] for v in verts) / n, sum(v[1] for v in verts) / n, sum(v[2] for v in verts) / n))
    out = []
    for f in faces:
        nrm = newell([verts[i] for i in f])
        c = Vector((0.0, 0.0, 0.0))
        for i in f:
            c += Vector(verts[i])
        c /= len(f)
        out.append(f if nrm.dot(c - center) >= 0.0 else list(reversed(f)))
    return verts, out


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


_ICO = None


def _icosphere1():
    global _ICO
    if _ICO is not None:
        return _ICO
    t = (1.0 + math.sqrt(5.0)) / 2.0
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [tuple(c / math.sqrt(1 + t * t) for c in p) for p in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    verts = list(v)
    mids = {}

    def mid(a, b):
        key = (min(a, b), max(a, b))
        if key in mids:
            return mids[key]
        p = Vector(verts[a]) + Vector(verts[b])
        p.normalize()
        verts.append(tuple(p))
        mids[key] = len(verts) - 1
        return mids[key]

    faces = []
    for a, b, c in f:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        faces += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
    _ICO = (verts, faces)
    return _ICO


def rock(r, tag, squash=0.62, sink=0.0):
    """A faceted footing stone, flat-bottomed and part buried."""
    base_v, base_f = _icosphere1()
    verts = []
    for i, p in enumerate(base_v):
        k = 1.0 + 0.2 * hs(tag, "rk", i)
        x, y, z = p[0] * r * k, p[1] * r * k * (0.85 + 0.2 * h01(tag, "ry")), p[2] * r * k * squash
        z = max(z, -r * squash * 0.35)
        verts.append((x, y, z + r * squash * 0.35 - sink))
    return verts, [list(f) for f in base_f]


def sack_shape(sx, sy, sz, tag, nu=10, nv=6):
    """A stuffed sack: a superellipsoid pillow, slightly lopsided."""
    verts = []
    faces = []
    e = 0.45
    for vi in range(nv + 1):
        v = -math.pi / 2 + math.pi * vi / nv
        cv, sv = math.cos(v), math.sin(v)
        for ui in range(nu):
            u = TAU * ui / nu
            cu, su = math.cos(u), math.sin(u)
            fx = math.copysign(abs(cv) ** e, cv) * math.copysign(abs(cu) ** e, cu)
            fy = math.copysign(abs(cv) ** e, cv) * math.copysign(abs(su) ** e, su)
            fz = math.copysign(abs(sv) ** 0.7, sv)
            bulge = 1.0 + 0.05 * hs(tag, vi, ui)
            verts.append((fx * sx / 2 * bulge, fy * sy / 2 * bulge, fz * sz / 2))
    for vi in range(nv):
        for ui in range(nu):
            a = vi * nu + ui
            b = vi * nu + (ui + 1) % nu
            faces.append([a, b, b + nu, a + nu])
    # collapse the pole rings into fans (drop degenerate quads)
    clean = []
    for f in faces:
        pts = [Vector(verts[i]) for i in f]
        uniq = []
        for i, p in zip(f, pts):
            if all((p - Vector(verts[j])).length > 1e-5 for j in uniq):
                uniq.append(i)
        if len(uniq) >= 3:
            clean.append(uniq)
    return orient_convex(verts, clean)


def cloth(w, h, nx, ny, tag, teeth=0.18, wave=0.08, thick=0.03, taper=0.0):
    """A hanging cloth (pennant/banner): top edge at z 0 along X, hanging down to
    -h, jagged bottom, a soft wave, and a back face so it reads from both sides.
    `taper` narrows the bottom (1.0 makes a triangular pennant)."""
    front = []
    for yi in range(ny + 1):
        t = yi / ny
        for xi in range(nx + 1):
            s = xi / nx - 0.5
            width = w * (1.0 - taper * t)
            x = s * width
            z = -h * t
            if yi == ny:
                z -= teeth * (1.0 if xi % 2 == 0 else -0.2) * (0.7 + 0.3 * h01(tag, "tooth", xi))
            y = wave * math.sin(s * 5.0 + t * 2.3 + h01(tag, "ph") * 6.0) * (0.25 + t)
            front.append((x, y, z))
    n = len(front)
    verts = list(front) + [(p[0], p[1] + thick, p[2]) for p in front]
    faces = []
    row = nx + 1
    for yi in range(ny):
        for xi in range(nx):
            a = yi * row + xi
            faces.append([a, a + row, a + row + 1, a + 1])
            faces.append([n + a, n + a + 1, n + a + row + 1, n + a + row])
    return verts, faces


def rope_between(p0, p1, r, n=4):
    """A straight rope segment as a thin prism from p0 to p1 (world vectors)."""
    d = p1 - p0
    length = d.length
    v, f = prism(n, r, r, length, 0.0, False, False)
    m = Matrix.Translation(p0) @ align_z(d)
    return v, f, m


def align_z(direction):
    """Rotation taking +Z onto `direction`."""
    d = direction.normalized()
    z = Vector((0.0, 0.0, 1.0))
    axis = z.cross(d)
    if axis.length < 1e-9:
        return Matrix.Identity(4) if d.z > 0 else Matrix.Rotation(math.pi, 4, "X")
    ang = math.acos(max(-1.0, min(1.0, z.dot(d))))
    return Matrix.Rotation(ang, 4, axis.normalized())


# ---------------------------------------------------------------------------
# colouring: the hand-painted pass
# ---------------------------------------------------------------------------


def painter(base, top=None, top_from=None, grad=0.28, mottle=0.07, tag="", light=None, ground_dark=0.12):
    """A per-corner colour function: `base` darkens toward the ground and
    brightens up the part, faces facing the sky catch a lighter wash, each face
    is mottled a touch, and anything above `top_from` (local z) takes `top`
    (the carved tip, the end grain)."""

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        span = max(1e-6, zmax - zmin)
        t = (p[2] - zmin) / span
        if top is not None and top_from is not None and (fc if fc is not None else p)[2] >= top_from - 1e-4:
            c = top
            k = 1.0 + mottle * 0.6 * hs(tag, "tf", fi)
        else:
            c = base
            k = (1.0 - grad * 0.5) + grad * t
            k *= 1.0 + mottle * hs(tag, "f", fi)
        if nrm.z > 0.6:
            k *= 1.08
        elif nrm.z < -0.5:
            k *= 0.78
        if light is not None and nrm.z > 0.3:
            c = mix(c, light, 0.25)
        if p[2] < zmin + 0.08 * span:
            k *= 1.0 - ground_dark
        return mul(c, k)

    return fn


def log_paint(base, half, tip, tag):
    """Horizontal log colouring: the sharpened ends are the carved light wood."""
    body = painter(base, grad=0.3, tag=tag)

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        if abs(fc[0]) >= half - tip - 1e-4:
            return mul(WOOD_CARVED, 1.0 + 0.06 * hs(tag, "tip", fi))
        return body(p, nrm, fi, zmin, zmax, fc)

    return fn


def flat(color, mottle=0.05, tag=""):
    def fn(p, nrm, fi, zmin, zmax, fc=None):
        k = 1.0 + mottle * hs(tag, "fl", fi)
        if nrm.z > 0.6:
            k *= 1.06
        elif nrm.z < -0.5:
            k *= 0.8
        return mul(color, k)

    return fn


# ---------------------------------------------------------------------------
# the piece accumulator
# ---------------------------------------------------------------------------


class Piece:
    def __init__(self, key, asset_id, tier_class, notes):
        self.key = key
        self.asset_id = asset_id
        self.tier_class = tier_class
        self.notes = notes
        self.verts = []
        self.faces = []
        self.face_mats = []
        self.corner_cols = []
        self.sockets = []  # (name, Vector, extras)
        self.parts = 0

    def add(self, geo, mat, paint, m=None):
        verts, faces = geo[0], geo[1]
        if m is None:
            m = Matrix.Identity(4)
        zs = [v[2] for v in verts]
        zmin, zmax = min(zs), max(zs)
        rot = m.to_3x3()
        base = len(self.verts)
        world = [m @ Vector(v) for v in verts]
        self.verts.extend(world)
        tag = self.parts
        self.parts += 1
        for fi, f in enumerate(faces):
            local = [verts[i] for i in f]
            nrm_local = newell(local)
            nrm_world = (rot @ nrm_local).normalized() if nrm_local.length > 0 else nrm_local
            fc = tuple(sum(v[a] for v in local) / len(local) for a in range(3))
            cols = [paint(verts[i], nrm_world, (tag, fi), zmin, zmax, fc) for i in f]
            self.faces.append([base + i for i in f])
            self.face_mats.append(mat)
            self.corner_cols.append(cols)

    def socket(self, name, pos, extras):
        self.sockets.append((name, Vector(pos), extras))

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def normalize(self):
        """Floor-seat at z 0 and centre the footprint on the origin."""
        (x0, y0, z0), (x1, y1, _z1) = self.bounds()
        off = Vector(((x0 + x1) / 2.0, (y0 + y1) / 2.0, z0))
        self.verts = [v - off for v in self.verts]
        self.sockets = [(n, p - off, e) for n, p, e in self.sockets]

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation(Vector((x, y, z)))


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


def RX(a):
    return Matrix.Rotation(a, 4, "X")


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal(Vector((x, y, z, 1.0)))


# ---------------------------------------------------------------------------
# shared details
# ---------------------------------------------------------------------------


def lashing(pc, m, r, tag, z=0.0, double=True, width=0.13):
    """Cream rope wraps around a post of radius r (in the post's local frame m)."""
    n = 7
    for k in range(2 if double else 1):
        dz = z + k * (width * 1.15) + 0.02 * hs(tag, "lz", k)
        tilt = 0.08 * hs(tag, "lt", k)
        v, f = prism(n, r + 0.035, r + 0.035, width, 0.0, False, False, phase=0.3 * k)
        pc.add((v, f), MAT_CLOTH, painter(ROPE, grad=0.1, mottle=0.08, tag="rope" + tag), m @ T(0, 0, dz) @ RX(tilt))


def bolt(pc, m, tag):
    v, f = prism(6, 0.055, 0.05, 0.05, 0.0, False, True, phase=h01(tag) * 1.0)
    pc.add((v, f), MAT_IRON, flat(IRON_LIGHT, 0.08, tag), m)


def footing(pc, x, y, r, tag, squash=0.62):
    pc.add(rock(r, tag, squash), MAT_ROCK, painter(STONE, top=None, grad=0.35, mottle=0.12, tag=tag, light=STONE_LIGHT), T(x, y, 0) @ RZ(h01(tag, "rz") * TAU))


def post(pc, x, y, h, r, tag, tip=0.55, lean=(0.0, 0.0), n=7, carve=True, butt=0.0, twist=None):
    """A vertical pointed stake at (x, y) with lean (radians about X then Y)."""
    v, f = stake(n, r, h, tip if carve else 0.001, tag, butt=butt)
    tw = h01(tag, "tw") * TAU if twist is None else twist
    m = T(x, y, 0) @ RY(lean[1]) @ RX(lean[0]) @ RZ(tw)
    pc.add((v, f), MAT_WOOD, painter(WOOD_MID if h01(tag, "shade") < 0.5 else WOOD_WARM, top=WOOD_CARVED, top_from=h - tip, tag=tag), m)
    return m


def plank(pc, m, w, h, d, tag, color=None, bolts=0, bolt_face=-1):
    c = color if color is not None else mix(WOOD_PLANK, WOOD_WARM, h01(tag, "pc"))
    pc.add(cbox(w, d, h, min(0.045, d * 0.4)), MAT_WOOD, painter(c, grad=0.18, mottle=0.08, tag=tag, light=WOOD_CARVED), m)
    for bi in range(bolts):
        bx = (-0.5 + (bi + 0.5) / bolts) * w * 0.8
        bolt(pc, m @ T(bx, bolt_face * (d / 2.0 + 0.001), 0.0) @ RX(math.pi / 2 * (1 if bolt_face < 0 else -1)), tag + "b%d" % bi)


# ---------------------------------------------------------------------------
# the pieces
# ---------------------------------------------------------------------------


def build_palisade():
    pc = Piece("musterPalisade", "mirefen-muster-palisade", "structure", ["stake-wall", "rope-lashings", "stone-footings", "twin-rails"])
    heights = [3.7, 4.3, 3.95, 4.15, 4.5, 3.85, 4.25, 3.6]
    for i, hgt in enumerate(heights):
        x = -2.45 + i * 0.7 + 0.05 * hs("pal", i, "x")
        r = 0.28 + 0.04 * h01("pal", i, "r")
        m = post(pc, x, 0.02 * hs("pal", i, "y"), hgt, r, "pal%d" % i, lean=(0.035 * hs("pal", i, "lx"), 0.045 * hs("pal", i, "ly")))
        lashing(pc, m, r, "pl%d" % i, z=1.0)
        lashing(pc, m, r, "pu%d" % i, z=2.55)
    # twin rails behind the wall (the back of the wall is +Y)
    for k, z in enumerate((1.12, 2.68)):
        pc.add(log_x(7, 0.14, 6.1, tag="rail%d" % k), MAT_WOOD, painter(WOOD_DARK, grad=0.1, tag="rail%d" % k), T(0, 0.36, z))
    # back braces
    for k, x in enumerate((-1.6, 1.7)):
        base = Vector((x, 1.55, 0.0))
        top = Vector((x + 0.05, 0.42, 2.55))
        v, f, m = rope_between(base, top, 0.13, n=6)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, tag="br%d" % k), m)
        footing(pc, x, 1.62, 0.3, "palbf%d" % k)
    # a red rag tied high on the tallest stake, and stone footings on the front
    pc.add(cloth(0.62, 1.05, 3, 3, "palrag", teeth=0.16, wave=0.06), MAT_CLOTH, painter(CLOTH_RED, grad=0.3, mottle=0.08, tag="palrag"), T(0.35, -0.36, 3.55) @ RZ(0.05))
    lashing(pc, T(0.35, 0.0, 0.0), 0.32, "palragtie", z=3.45, double=False)
    for k, (x, r) in enumerate(((-2.75, 0.42), (-0.9, 0.3), (1.05, 0.34), (2.75, 0.46))):
        footing(pc, x, -0.35 - 0.08 * h01("palft", k), r, "palft%d" % k)
    return pc


def build_barricade():
    pc = Piece("musterBarricade", "mirefen-muster-barricade", "structure", ["sharpened-logs", "bolted-planks", "sandbags", "draped-cloth"])
    # three sharpened logs, stacked, points out past both ends
    for k, z in enumerate((0.78, 1.62, 2.42)):
        length = 6.1 - 0.3 * k + 0.2 * hs("bl", k)
        m = T(0.12 * hs("bl", k, "x"), 0.0, z) @ RZ(0.03 * hs("bl", k, "rz")) @ RY(0.02 * hs("bl", k, "ry"))
        pc.add(log_x(7, 0.23, length, 0.55, 0.55, tag="blog%d" % k), MAT_WOOD, log_paint(WOOD_MID, length / 2.0, 0.55, "blog%d" % k), m)
    # the uprights the logs are lashed to (behind them, +Y)
    for i, (x, hgt) in enumerate(((-2.2, 3.55), (-0.55, 3.1), (1.1, 3.4), (2.45, 3.85))):
        m = post(pc, x, 0.34, hgt, 0.24, "bup%d" % i, lean=(0.03 * hs("bup", i), 0.03 * hs("bupy", i)))
        for z in (0.62, 1.48, 2.28):
            if z + 0.3 < hgt - 0.55:
                lashing(pc, m, 0.24, "bul%d%.1f" % (i, z), z=z, double=False, width=0.16)
    # leaning front braces with stone feet
    for k, (x, lean) in enumerate(((-2.55, 0.34), (2.2, -0.3))):
        base = Vector((x - 0.35 * math.copysign(1, lean), -1.35, 0.0))
        top = Vector((x + 0.25 * math.copysign(1, lean), 0.1, 3.05))
        v, f, m = rope_between(base, top, 0.19, n=7)
        pc.add((v, f), MAT_WOOD, painter(WOOD_WARM, top=WOOD_CARVED, top_from=2.95, tag="bfb%d" % k), m)
        lashing(pc, m, 0.19, "bfl%d" % k, z=1.2)
        lashing(pc, m, 0.19, "bfu%d" % k, z=2.55, double=False)
        footing(pc, base.x, base.y, 0.36, "bff%d" % k)
    # the bolted plank panel on the front
    for k in range(4):
        z = 0.72 + k * 0.62
        m = T(0.85 + 0.08 * hs("bpk", k), -0.36, z) @ RY(0.07 * hs("bpr", k)) @ RZ(0.03 * hs("bpz", k))
        plank(pc, m, 1.95 - 0.1 * k, 0.46, 0.1, "bpk%d" % k, bolts=2)
    # a short bundle of planks leaning at the right
    for k in range(3):
        m = T(1.85 + 0.3 * k, -0.55, 0.0) @ RX(-0.2) @ T(0, 0, 0.8)
        plank(pc, m, 0.28, 1.6, 0.1, "bbd%d" % k)
    lashing(pc, T(2.15, -0.42, 0.0) @ RX(-0.2) @ S(1.9, 0.5, 1.0), 0.28, "bbdl", z=0.9, double=False)
    # sandbags
    for k, (x, y, z, rz) in enumerate(((-1.45, -0.78, 0.0, 0.1), (-0.55, -0.82, 0.0, -0.12), (-1.0, -0.8, 0.46, 0.04))):
        pc.add(sack_shape(1.0, 0.62, 0.52, "bsack%d" % k), MAT_CLOTH, painter(SACK, grad=0.3, mottle=0.06, tag="bsack%d" % k), T(x, y, z + 0.24) @ RZ(rz))
        v, f = prism(6, 0.32, 0.32, 0.07, 0.0, False, False)
        pc.add((v, f), MAT_CLOTH, flat(WOOD_MID, 0.05, "bsb%d" % k), T(x + 0.18, y, z + 0.24) @ RY(math.pi / 2) @ S(0.9, 0.95, 1.0) @ T(0, 0, -0.035))
    # red cloth draped over the top log, and a cream rag on a stick
    pc.add(cloth(0.9, 1.3, 3, 4, "bredc", teeth=0.2, wave=0.07), MAT_CLOTH, painter(CLOTH_RED, grad=0.35, tag="bredc"), T(-1.3, -0.26, 2.66))
    pc.add(cloth(0.9, 1.3, 3, 4, "bredb", teeth=0.2, wave=0.07), MAT_CLOTH, painter(CLOTH_RED_DARK, grad=0.35, tag="bredb"), T(-1.3, 0.28, 2.66))
    pc.add(cbox(0.95, 0.56, 0.06, 0.02), MAT_CLOTH, flat(CLOTH_RED, 0.05, "bredt"), T(-1.3, 0.01, 2.66))
    stick = T(2.9, 0.1, 0.0) @ RY(-0.12)
    v, f = stake(6, 0.07, 3.9, 0.12, "bstick")
    pc.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=3.78, tag="bstick"), stick)
    pc.add(cloth(0.95, 0.75, 4, 2, "brag", teeth=0.14, wave=0.09, taper=0.35), MAT_CLOTH, painter(CLOTH_CREAM, grad=0.2, tag="brag"), stick @ T(-0.5, 0.0, 3.62) @ RZ(0.1))
    lashing(pc, stick, 0.07, "bstl", z=3.55, double=False, width=0.09)
    return pc


def pennant_rope(pc, p0, p1, sag, count, tag, colors):
    """A sagging rope between p0 and p1 with triangular pennants hanging off it."""
    segs = 6
    pts = []
    for i in range(segs + 1):
        t = i / segs
        p = p0.lerp(p1, t)
        p.z -= sag * 4.0 * t * (1.0 - t)
        pts.append(p)
    for i in range(segs):
        v, f, m = rope_between(pts[i], pts[i + 1], 0.035, n=4)
        pc.add((v, f), MAT_CLOTH, flat(ROPE_SHADE, 0.05, tag + "r%d" % i), m)
    d = p1 - p0
    yaw = math.atan2(d.y, d.x)
    for k in range(count):
        t = (k + 1) / (count + 1)
        p = p0.lerp(p1, t)
        p.z -= sag * 4.0 * t * (1.0 - t) + 0.02
        col = colors[k % len(colors)]
        pc.add(cloth(0.62, 0.95, 2, 3, tag + "p%d" % k, teeth=0.0, wave=0.05, taper=0.9), MAT_CLOTH, painter(col, grad=0.3, tag=tag + "p%d" % k), T(p.x, p.y, p.z) @ RZ(yaw))


def flag_pole(pc, base, height, lean, tag, flag_color):
    m = T(base.x, base.y, base.z) @ RY(lean)
    v, f = stake(6, 0.075, height, 0.16, tag)
    pc.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=height - 0.16, tag=tag), m)
    pc.add(cloth(1.05, 0.95, 4, 3, tag + "f", teeth=0.2, wave=0.1, taper=0.3), MAT_CLOTH, painter(flag_color, grad=0.3, tag=tag + "f"), m @ T(0.56 * (1 if lean >= 0 else -1), 0.0, height - 0.28))
    lashing(pc, m, 0.075, tag + "l", z=height - 0.32, double=False, width=0.08)
    return m


def build_gate():
    pc = Piece("musterGate", "mirefen-muster-gate", "structure", ["gate-posts", "open-leaves", "pennant-rope", "banner-poles"])
    # the two big gate posts with their stake clusters
    for s in (-1, 1):
        m = post(pc, s * 2.3, 0.0, 5.5, 0.36, "gpost%d" % s, tip=0.7, lean=(0.0, s * 0.02))
        for z in (0.95, 2.4, 3.9):
            lashing(pc, m, 0.36, "gpl%d%.1f" % (s, z), z=z)
        footing(pc, s * 2.3, -0.5, 0.5, "gpf%d" % s)
        footing(pc, s * 2.75, 0.45, 0.4, "gpf2%d" % s)
        for k, (dx, hgt) in enumerate(((0.62, 4.6), (1.3, 3.95), (2.0, 4.25), (2.7, 3.6))):
            mm = post(pc, s * (2.3 + dx), 0.05 * hs("gw", s, k), hgt, 0.26, "gw%d%d" % (s, k), lean=(0.03 * hs("gwl", s, k), s * 0.03))
            lashing(pc, mm, 0.26, "gwl1%d%d" % (s, k), z=1.1)
            lashing(pc, mm, 0.26, "gwl2%d%d" % (s, k), z=2.6, double=False)
        pc.add(log_x(7, 0.14, 3.1, tag="gwr%d" % s), MAT_WOOD, painter(WOOD_DARK, grad=0.1, tag="gwr%d" % s), T(s * 3.75, 0.34, 1.2))
        pc.add(log_x(7, 0.14, 3.1, tag="gwr2%d" % s), MAT_WOOD, painter(WOOD_DARK, grad=0.1, tag="gwr2%d" % s), T(s * 3.75, 0.34, 2.7))
        # banner poles leaning out over the wings
        flag_pole(pc, Vector((s * 2.62, 0.0, 3.4)), 2.8, s * 0.42, "gflag%d" % s, CLOTH_RED)
    # the open gate leaves, swung inward (+Y) on the posts
    for s in (-1, 1):
        hinge = T(s * 1.98, 0.08, 0.12) @ RZ(s * -1.25)
        for k in range(5):
            x = -s * (0.2 + k * 0.4)
            hgt = 3.0 + 0.25 * hs("gl", s, k)
            v, f = stake(5, 0.2, hgt, 0.38, "gls%d%d" % (s, k), jitter=0.04)
            pc.add((v, f), MAT_WOOD, painter(WOOD_PLANK, top=WOOD_CARVED, top_from=hgt - 0.38, tag="gls%d%d" % (s, k)), hinge @ T(x, 0.0, 0.0) @ S(1.0, 0.45, 1.0))
        for z in (0.7, 2.25):
            plank(pc, hinge @ T(-s * 1.0, -0.12, z), 2.1, 0.3, 0.1, "glb%d%.1f" % (s, z), bolts=3)
        brace = hinge @ T(-s * 1.0, -0.13, 1.48) @ RY(s * 0.62)
        plank(pc, brace, 2.1, 0.26, 0.09, "glz%d" % s, bolts=2)
    # the pennant rope between the post tops
    pennant_rope(pc, Vector((-2.3, -0.1, 4.75)), Vector((2.3, -0.1, 4.75)), 0.7, 4, "gpr", [CLOTH_RED, CLOTH_CREAM])
    return pc


def build_watchtower():
    pc = Piece("musterWatchtower", "mirefen-muster-watchtower", "structure", ["four-posts", "cross-bracing", "plank-platform", "parapet", "ladder", "roof", "banner"])
    plat = 6.0
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i, (sx, sy) in enumerate(corners):
        base = Vector((sx * 1.62, sy * 1.62, 0.0))
        top = Vector((sx * 1.35, sy * 1.35, plat + 2.35))
        d = top - base
        v, f = stake(8, 0.21, d.length, 0.001, "wtp%d" % i, jitter=0.04)
        m = T(base.x, base.y, 0.0) @ align_z(d)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, grad=0.25, tag="wtp%d" % i), m)
        for z in (0.5, 3.0, plat - 0.35, plat + 1.1):
            lashing(pc, m, 0.21, "wtl%d%.1f" % (i, z), z=z, double=(z > 1))
        footing(pc, base.x * 1.08, base.y * 1.08, 0.46, "wtf%d" % i)
        # a cap on each post top
        pc.add(cbox(0.52, 0.52, 0.24, 0.06), MAT_WOOD, painter(WOOD_PLANK, tag="wtc%d" % i, light=WOOD_CARVED), T(top.x, top.y, top.z + 0.02))

    def on_face(t, z):
        return 1.62 + (1.35 - 1.62) * (z / (plat + 2.35))

    # girts and X braces on the back and the two sides; the front keeps the ladder
    sides = {"back": ((-1, 1), (1, 1)), "left": ((-1, -1), (-1, 1)), "right": ((1, -1), (1, 1)), "front": ((-1, -1), (1, -1))}
    for name, ((ax, ay), (bx, by)) in sides.items():
        for z in (3.0,):
            ka = on_face(0, z)
            p0 = Vector((ax * ka, ay * ka, z))
            p1 = Vector((bx * ka, by * ka, z))
            v, f, m = rope_between(p0, p1, 0.13, n=6)
            pc.add((v, f), MAT_WOOD, painter(WOOD_DARK, tag="wtg" + name), m)
        if name == "front":
            continue
        for z0, z1 in ((0.45, 2.95), (3.05, plat - 0.25)):
            k0, k1 = on_face(0, z0), on_face(0, z1)
            for flip in (0, 1):
                p0 = Vector((ax * k0, ay * k0, z0)) if flip == 0 else Vector((bx * k0, by * k0, z0))
                p1 = Vector((bx * k1, by * k1, z1)) if flip == 0 else Vector((ax * k1, ay * k1, z1))
                v, f, m = rope_between(p0, p1, 0.1, n=5)
                pc.add((v, f), MAT_WOOD, painter(WOOD_WARM, tag="wtx%s%.1f%d" % (name, z0, flip)), m)
    # the platform: joists and a plank deck
    for s in (-1, 1):
        pc.add(log_x(6, 0.13, 3.7, tag="wtj%d" % s), MAT_WOOD, painter(WOOD_DARK, tag="wtj%d" % s), T(0, s * 1.35, plat - 0.05))
    for k in range(8):
        y = -1.72 + k * 0.49
        plank(pc, T(0.04 * hs("wtd", k), y, plat + 0.1), 3.95 + 0.12 * hs("wtdl", k), 0.12, 0.47, "wtd%d" % k)
    # the parapet: pointed boards round the deck, a gap at the front for the ladder
    for side in range(4):
        for k in range(8):
            u = -1.75 + k * 0.5
            if side == 0 and -0.8 < u < 0.8:
                continue
            hgt = 1.3 + 0.18 * hs("wtpp", side, k)
            yaw = side * math.pi / 2
            m = RZ(yaw) @ T(u, -1.86, plat + 0.15)
            v, f = stake(5, 0.2, hgt, 0.3, "wtpp%d%d" % (side, k), jitter=0.05)
            pc.add((v, f), MAT_WOOD, painter(WOOD_PLANK, top=WOOD_CARVED, top_from=hgt - 0.3, tag="wtpp%d%d" % (side, k)), m @ S(1.0, 0.45, 1.0))
        rail = RZ(side * math.pi / 2) @ T(0, -1.95, plat + 0.95)
        plank(pc, rail, 3.9, 0.2, 0.1, "wtpr%d" % side, bolts=0)
    # the roof: a low hip of planks on the post tops, and a banner pole
    peak = plat + 3.25
    eave = plat + 2.45
    hw = 2.05
    roof_v = [(-hw, -hw, eave), (hw, -hw, eave), (hw, hw, eave), (-hw, hw, eave), (0.0, 0.0, peak)]
    for side in range(4):
        a, b = side, (side + 1) % 4
        pa, pb, pk = Vector(roof_v[a]), Vector(roof_v[b]), Vector(roof_v[4])
        for strip in range(4):
            t0, t1 = strip / 4.0, (strip + 1) / 4.0
            q = [pa.lerp(pb, t0), pa.lerp(pb, t1), pk, pk]
            q2 = [q[0], q[1], pa.lerp(pb, t1).lerp(pk, 0.999), pa.lerp(pb, t0).lerp(pk, 0.999)]
            tri_top = pk
            verts = [tuple(q2[0]), tuple(q2[1]), tuple(tri_top)]
            under = [tuple(Vector(p) + Vector((0, 0, -0.12))) for p in verts]
            vv = verts + under
            ff = [[0, 1, 2], [5, 4, 3], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]]
            col = WOOD_PLANK if (strip + side) % 2 == 0 else WOOD_WARM
            pc.add((vv, ff), MAT_WOOD, painter(col, grad=0.3, mottle=0.06, tag="wtr%d%d" % (side, strip), light=WOOD_CARVED))
    flag_pole(pc, Vector((0.0, 0.0, peak - 0.3)), 1.1, 0.0, "wtflag", CLOTH_RED)
    # a banner hung from the front parapet
    pc.add(cloth(1.2, 1.45, 4, 4, "wtban", teeth=0.22, wave=0.06), MAT_CLOTH, painter(CLOTH_RED, grad=0.35, tag="wtban"), T(-1.2, -2.02, plat + 1.12))
    # the ladder up the front
    foot = Vector((0.0, -2.75, 0.0))
    head = Vector((0.0, -1.9, plat + 0.2))
    d = head - foot
    for s in (-1, 1):
        v, f, m = rope_between(foot + Vector((s * 0.36, 0, 0)), head + Vector((s * 0.36, 0, 0.35)), 0.075, n=6)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, tag="wtlr%d" % s), m)
    rungs = 13
    for k in range(1, rungs):
        p = foot.lerp(head, k / rungs)
        pc.add(log_x(5, 0.05, 0.86, tag="wtrg%d" % k), MAT_WOOD, painter(WOOD_WARM, tag="wtrg%d" % k), T(p.x, p.y, p.z))
        if k % 3 == 0:
            for s in (-1, 1):
                v, f = prism(5, 0.1, 0.1, 0.1, -0.05, False, False)
                pc.add((v, f), MAT_CLOTH, flat(ROPE, 0.06, "wtrt%d%d" % (k, s)), T(p.x + s * 0.36, p.y, p.z) @ align_z(d))
    return pc


def canvas_side(nx, ny, length, half_w, ridge, hem_out, sag, tag, stripes, side):
    """One sloping side of a ridge tent: from the ridge (y along the length) down
    to the hem, with a soft sag between the poles and a flared hem."""
    verts = []
    for yi in range(ny + 1):
        t = yi / ny
        for xi in range(nx + 1):
            u = xi / nx
            y = -length / 2.0 + u * length
            x = side * (half_w + hem_out * t * t) * t
            z = ridge * (1.0 - t)
            mid = math.sin(u * math.pi)
            x -= side * sag * mid * math.sin(t * math.pi)
            z -= sag * 0.35 * mid * math.sin(t * math.pi)
            verts.append((x, y, z))
    faces = []
    for yi in range(ny):
        for xi in range(nx):
            a = yi * (nx + 1) + xi
            f = [a, a + 1, a + nx + 2, a + nx + 1]
            faces.append(list(reversed(f)) if side > 0 else f)
    return verts, faces


def build_tent(large):
    key = "musterTentLarge" if large else "musterTentSmall"
    pc = Piece(key, "mirefen-muster-tent-large" if large else "mirefen-muster-tent-small", "structure", ["ridge-tent", "striped-canvas", "open-door", "guy-ropes"])
    length = 4.1 if large else 2.9
    half_w = 1.75 if large else 1.2
    ridge = 2.95 if large else 2.05
    hem = 0.28 if large else 0.2
    nx = 6 if large else 4
    ny = 3
    for side in (-1, 1):
        v, f = canvas_side(nx, ny, length, half_w, ridge, hem, 0.12, key + "s%d" % side, nx, side)

        def stripe_paint(p, nrm, fi, zmin, zmax, fc=None, side=side):
            u = (fc[1] + length / 2.0) / length
            band = int(min(nx - 1, max(0, math.floor(u * nx + 1e-6))))
            if large:
                c = CANVAS_RED if band % 2 == 0 else CANVAS_CREAM
            else:
                c = CANVAS_RED if (fc[2] < 0.5) else CANVAS_CREAM
            k = 0.82 + 0.3 * ((p[2] - zmin) / max(1e-6, zmax - zmin))
            k *= 1.0 + 0.05 * hs(key, side, fi)
            return mul(c, k)

        pc.add((v, f), MAT_CLOTH, stripe_paint)
    # back wall
    bw = [(-half_w - hem, length / 2.0, 0.0), (half_w + hem, length / 2.0, 0.0), (0.0, length / 2.0, ridge)]
    pc.add((bw, [[0, 2, 1]]), MAT_CLOTH, painter(CANVAS_CREAM, grad=0.3, tag=key + "bw"))
    # the doorway: a dark interior panel set back, with the flaps tied open
    dz = -length / 2.0
    door = [(-half_w * 0.95, dz + 0.35, 0.0), (0.0, dz + 0.35, ridge * 0.97), (half_w * 0.95, dz + 0.35, 0.0)]
    pc.add((door, [[0, 2, 1]]), MAT_CLOTH, flat(TENT_DARK, 0.03, key + "door"))
    for s in (-1, 1):
        flap = [
            (s * 0.05, dz, ridge * 0.98),
            (s * (half_w + hem * 0.6), dz - 0.02, 0.0),
            (s * (half_w * 0.55), dz - 0.38, 0.05),
        ]
        back = [(p[0], p[1] + 0.03, p[2]) for p in flap]
        vv = flap + back
        ff = [[0, 1, 2], [5, 4, 3]]
        pc.add((vv, ff), MAT_CLOTH, painter(CANVAS_CREAM if large else CANVAS_CREAM, grad=0.3, tag=key + "fl%d" % s))
        # tie
        pc.add(prism(5, 0.07, 0.07, 0.08, 0.0), MAT_CLOTH, flat(CANVAS_RED, 0.04, key + "tie%d" % s), T(s * half_w * 0.62, dz - 0.2, 0.9 if large else 0.65))
    # ridge pole and uprights
    pc.add(log_x(6, 0.07, length + 0.5, tag=key + "rp"), MAT_WOOD, painter(WOOD_MID, tag=key + "rp"), T(0, 0, ridge + 0.02) @ RZ(math.pi / 2))
    for k, y in enumerate((-length / 2.0 - 0.12, length / 2.0 + 0.12)):
        v, f = stake(6, 0.075, ridge + 0.38, 0.14, key + "up%d" % k)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=ridge + 0.24, tag=key + "up%d" % k), T(0, y, 0))
    # a small pennant on the front pole
    pc.add(cloth(0.55, 0.42, 2, 2, key + "pn", teeth=0.0, wave=0.04, taper=0.9), MAT_CLOTH, painter(CLOTH_RED, tag=key + "pn"), T(0.3, -length / 2.0 - 0.12, ridge + 0.3) @ RY(math.pi / 2) @ RZ(0.0) @ RX(0.0))
    # guy ropes and pegs
    for k, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        top = Vector((0.0, sy * (length / 2.0 + 0.1), ridge + 0.05))
        peg = Vector((sx * (half_w + 0.9), sy * (length / 2.0 + 0.75), 0.0))
        v, f, m = rope_between(peg + Vector((0, 0, 0.18)), top, 0.022, n=4)
        pc.add((v, f), MAT_CLOTH, flat(ROPE_SHADE, 0.04, key + "gr%d" % k), m)
        v, f = stake(5, 0.05, 0.36, 0.08, key + "pg%d" % k)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=0.28, tag=key + "pg%d" % k), T(peg.x, peg.y, 0.0))
    # hem stones holding the canvas corners down
    for k, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        footing(pc, sx * (half_w + hem + 0.1), sy * (length / 2.0 - 0.25), 0.2 if large else 0.16, key + "hs%d" % k)
    return pc


def build_pike(pc, m, tag):
    """One muster shardpike: the in-game Shardpike (public/models/weapons/
    shardpike_spear.glb) at rack scale: dark wrapped haft, iron butt spike, an
    iron crown of prongs, and the long cyan crystal head."""
    length = 3.0
    haft = prism(6, 0.058, 0.05, length - 0.62, 0.14)
    pc.add(haft, MAT_WOOD, painter(HAFT, grad=0.15, mottle=0.05, tag=tag + "h"), m)
    for k, z in enumerate((0.5, 1.35, 2.05, 2.28)):
        pc.add(prism(6, 0.07, 0.07, 0.1 if k < 3 else 0.14, z, False, False, phase=0.2), MAT_CLOTH, flat(WRAP, 0.06, tag + "w%d" % k), m)
    # butt spike
    butt = [(0, 0, 0)] + ring(6, 0.06, 0.16)
    pc.add((butt, [[0, 1 + (i + 1) % 6, 1 + i] for i in range(6)] + [[1 + i for i in range(6)]]), MAT_IRON, flat(IRON, 0.06, tag + "bs"), m)
    # the collar and its prongs
    top = length - 0.48
    pc.add(prism(6, 0.075, 0.1, 0.16, top - 0.16), MAT_IRON, flat(IRON_LIGHT, 0.06, tag + "cl"), m)
    for i in range(4):
        a = TAU * i / 4 + 0.4
        v, f = stake(4, 0.028, 0.24, 0.1, tag + "pr%d" % i, jitter=0.0)
        pc.add((v, f), MAT_IRON, flat(IRON_LIGHT, 0.05, tag + "pr%d" % i), m @ T(math.cos(a) * 0.085, math.sin(a) * 0.085, top - 0.04) @ RY(math.cos(a) * 0.35) @ RX(-math.sin(a) * 0.35))
    # the crystal head: a long six-sided shard
    head = []
    head.append((0, 0, top - 0.02))
    head += ring(6, 0.1, top + 0.14, 0.26, 0.12, tag + "cr")
    head += ring(6, 0.075, top + 0.3, 0.0, 0.1, tag + "cr2")
    head.append((0.01, 0.0, length + 0.02))
    faces = []
    for i in range(6):
        j = (i + 1) % 6
        faces.append([0, 1 + j, 1 + i])
        faces.append([1 + i, 1 + j, 7 + j, 7 + i])
        faces.append([7 + i, 7 + j, 13])

    def crystal_paint(p, nrm, fi, zmin, zmax, fc=None):
        t = (p[2] - zmin) / max(1e-6, zmax - zmin)
        c = mix(CRYSTAL_DEEP, CRYSTAL, 0.35 + 0.65 * t)
        return mul(c, 1.0 + 0.12 * hs(tag, "c", fi))

    pc.add((head, faces), MAT_CRYSTAL, crystal_paint, m)


def build_weapon_rack():
    pc = Piece("musterWeaponRack", "mirefen-muster-weapon-rack", "structure", ["a-frame-trestles", "five-shardpikes", "rope-lashings", "pennant"])
    top_z = 2.05
    for s in (-1, 1):
        x = s * 1.45
        for k, sy in enumerate((-1, 1)):
            base = Vector((x, sy * 0.62, 0.0))
            tip = Vector((x, sy * -0.04, top_z + 0.28))
            v, f = stake(6, 0.1, (tip - base).length, 0.16, "rkleg%d%d" % (s, k))
            m = T(base.x, base.y, 0.0) @ align_z(tip - base)
            pc.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=(tip - base).length - 0.16, tag="rkleg%d%d" % (s, k)), m)
            footing(pc, base.x, base.y, 0.24, "rkf%d%d" % (s, k))
        pc.add(log_x(6, 0.07, 1.25, tag="rkx%d" % s), MAT_WOOD, painter(WOOD_DARK, tag="rkx%d" % s), T(x, 0.0, 0.62) @ RZ(math.pi / 2))
        lashing(pc, T(x, 0.0, 0.0), 0.12, "rktl%d" % s, z=top_z - 0.1, double=True, width=0.1)
    # top rail with the pike loops, and the butt rail behind
    pc.add(log_x(7, 0.1, 3.5, tag="rktop"), MAT_WOOD, painter(WOOD_WARM, tag="rktop", light=WOOD_CARVED), T(0, 0.0, top_z))
    pc.add(log_x(7, 0.11, 3.3, tag="rkbot"), MAT_WOOD, painter(WOOD_DARK, tag="rkbot"), T(0, 0.3, 0.3))
    # five pikes, stood in the butt rail and leaning on the top rail
    for i in range(5):
        x = -1.08 + i * 0.54
        base = Vector((x, 0.36, 0.05))
        lean_top = Vector((x + 0.03 * hs("rkp", i), -0.1, top_z))
        d = lean_top - base
        m = T(base.x, base.y, base.z) @ align_z(d) @ RZ(h01("rkp", i, "tw") * TAU)
        build_pike(pc, m, "rkp%d" % i)
        v, f = prism(6, 0.085, 0.085, 0.08, 0.0, False, False)
        pc.add((v, f), MAT_CLOTH, flat(ROPE, 0.06, "rkloop%d" % i), m @ T(0, 0, d.length - 0.02))
    # a red pennant tied to the left trestle
    pc.add(cloth(0.55, 0.65, 2, 2, "rkpn", teeth=0.14, wave=0.05, taper=0.4), MAT_CLOTH, painter(CLOTH_RED, grad=0.3, tag="rkpn"), T(-1.45, -0.08, top_z + 0.22) @ RZ(0.0))
    return pc


def build_crate():
    pc = Piece("musterCrate", "mirefen-muster-crate", "clutter", ["plank-crate", "cross-brace", "iron-corners"])
    s = 0.95
    pc.add(cbox(s, s, s, 0.06), MAT_WOOD, painter(WOOD_PLANK, grad=0.22, tag="crbody", light=WOOD_CARVED), T(0, 0, s / 2))
    # top and bottom bands, corner posts, a cross brace on two faces
    for z in (0.08, s - 0.08):
        pc.add(cbox(s + 0.05, s + 0.05, 0.15, 0.03), MAT_WOOD, painter(WOOD_MID, grad=0.1, tag="crband%.2f" % z), T(0, 0, z))
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        pc.add(cbox(0.15, 0.15, s - 0.3, 0.03), MAT_WOOD, painter(WOOD_MID, grad=0.2, tag="crpost%d" % i), T(sx * (s / 2 - 0.045), sy * (s / 2 - 0.045), s / 2))
    for face in (0, 2):
        m = RZ(face * math.pi / 2) @ T(0, -s / 2 - 0.015, s / 2) @ RY(0.78)
        pc.add(cbox(0.14, 0.05, s * 1.0, 0.02), MAT_WOOD, painter(WOOD_WARM, grad=0.1, tag="crd%d" % face), m)
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        pc.add(cbox(0.2, 0.2, 0.1, 0.03), MAT_IRON, flat(IRON, 0.06, "crc%d" % i), T(sx * (s / 2 - 0.05), sy * (s / 2 - 0.05), s - 0.02))
    return pc


def build_barrel():
    pc = Piece("musterBarrel", "mirefen-muster-barrel", "clutter", ["staved-barrel", "iron-hoops", "plank-lid"])
    n = 12
    zs = [0.0, 0.18, 0.55, 0.92, 1.1]
    rs = [0.4, 0.45, 0.49, 0.45, 0.4]
    verts = []
    for k, (z, r) in enumerate(zip(zs, rs)):
        verts += ring(n, r, z, 0.0, 0.015, "bar%d" % k)
    faces = []
    for k in range(len(zs) - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
    faces.append(list(reversed(range(n))))

    def stave_paint(p, nrm, fi, zmin, zmax, fc=None):
        a = math.atan2(p[1], p[0])
        stave = int(((math.atan2(fc[1], fc[0]) / TAU) % 1.0) * n) % n
        c = mix(WOOD_MID, WOOD_WARM, h01("stave", stave))
        k = 0.82 + 0.25 * (p[2] / 1.1)
        return mul(c, k * (1.0 + 0.04 * hs("bar", fi)))

    pc.add((verts, faces), MAT_WOOD, stave_paint)
    lid = ring(n, 0.39, 1.05, 0.0)
    pc.add((lid, [list(range(n))]), MAT_WOOD, painter(WOOD_ENDGRAIN, grad=0.0, mottle=0.1, tag="barlid"))
    for k, (z, r) in enumerate(((0.16, 0.455), (0.93, 0.455), (0.5, 0.495))):
        pc.add(prism(n, r + 0.012, r + 0.012, 0.09, z - 0.045, False, False), MAT_IRON, flat(IRON, 0.05, "barh%d" % k))
    return pc


def build_sacks():
    pc = Piece("musterSacks", "mirefen-muster-sacks", "clutter", ["grain-sacks", "tie-cords"])
    specs = [(-0.46, 0.0, 0.0, 0.25, 1.0, 0.66, 0.6), (0.48, 0.06, 0.0, -0.3, 0.95, 0.64, 0.58), (0.02, 0.02, 0.5, 0.1, 0.92, 0.6, 0.55)]
    for k, (x, y, z, rz, sx, sy, sz) in enumerate(specs):
        m = T(x, y, z + sz / 2) @ RZ(rz)
        pc.add(sack_shape(sx, sy, sz, "sk%d" % k), MAT_CLOTH, painter(mix(SACK, CANVAS_CREAM, 0.25 * h01("skc", k)), grad=0.3, mottle=0.06, tag="sk%d" % k), m)
        pc.add(prism(6, 0.11, 0.13, 0.12, 0.0), MAT_CLOTH, flat(ROPE_SHADE, 0.05, "skt%d" % k), m @ T(sx * 0.38, 0, 0) @ RY(math.pi / 2))
        pc.add(prism(5, 0.1, 0.02, 0.16, 0.0), MAT_CLOTH, flat(SACK, 0.05, "skn%d" % k), m @ T(sx * 0.45, 0, 0) @ RY(math.pi / 2))
    return pc


def build_cart_wheel():
    pc = Piece("musterCartWheel", "mirefen-muster-cart-wheel", "clutter", ["spoked-wheel", "iron-tyre", "prop-crate"])
    # the wheel leans on a small crate
    radius = 0.78
    lean = RX(-0.26)
    centre = T(0.0, 0.25, radius + 0.02) @ lean
    n = 14
    rim_v = []
    for k, (r, y) in enumerate(((radius, -0.07), (radius, 0.07), (radius - 0.12, 0.07), (radius - 0.12, -0.07))):
        for i in range(n):
            a = TAU * i / n
            rim_v.append((math.cos(a) * r, y, math.sin(a) * r))
    faces = []
    for k in range(4):
        k2 = (k + 1) % 4
        for i in range(n):
            j = (i + 1) % n
            faces.append([k * n + i, k2 * n + i, k2 * n + j, k * n + j])
    pc.add((rim_v, faces), MAT_WOOD, painter(WOOD_WARM, grad=0.2, tag="whrim"), centre)
    tyre = []
    for k, (r, y) in enumerate(((radius + 0.035, -0.075), (radius + 0.035, 0.075), (radius - 0.005, 0.075), (radius - 0.005, -0.075))):
        for i in range(n):
            a = TAU * i / n
            tyre.append((math.cos(a) * r, y, math.sin(a) * r))
    pc.add((tyre, faces), MAT_IRON, flat(IRON, 0.05, "whtyre"), centre)
    for i in range(8):
        a = TAU * i / 8 + 0.2
        m = centre @ RY(-a) @ T(0.0, 0.0, 0.0)
        v, f = prism(5, 0.045, 0.035, radius - 0.12, 0.0, True, True)
        pc.add((v, f), MAT_WOOD, painter(WOOD_MID, tag="whsp%d" % i), m)
    hub = prism(8, 0.14, 0.14, 0.34, -0.17)
    pc.add(hub, MAT_WOOD, painter(WOOD_DARK, tag="whhub"), centre @ RX(math.pi / 2))
    pc.add(prism(8, 0.08, 0.08, 0.42, -0.21), MAT_IRON, flat(IRON_LIGHT, 0.05, "whax"), centre @ RX(math.pi / 2))
    # the crate it leans on
    pc.add(cbox(0.8, 0.62, 0.7, 0.05), MAT_WOOD, painter(WOOD_PLANK, grad=0.2, tag="whcr", light=WOOD_CARVED), T(0.05, 0.72, 0.35))
    for z in (0.1, 0.6):
        plank(pc, T(0.05, 0.41, z), 0.82, 0.12, 0.04, "whcp%.1f" % z, color=WOOD_MID)
    footing(pc, -0.55, -0.35, 0.18, "whst")
    return pc


TORCH_FLAME_Z = 2.36


def build_torch():
    pc = Piece("musterTorch", "mirefen-muster-torch", "clutter", ["torch-post", "iron-cup", "glowing-coals", "rope-bands"])
    m = post(pc, 0.0, 0.0, 2.12, 0.11, "tch", tip=0.001, carve=False)
    lashing(pc, m, 0.11, "tchl", z=0.9, double=True, width=0.1)
    lashing(pc, m, 0.11, "tchu", z=1.85, double=False, width=0.1)
    # the flared iron cup, its rim struts, and the coals the runtime flame sits on
    cup = []
    cup += ring(6, 0.12, 2.0, 0.3)
    cup += ring(6, 0.26, TORCH_FLAME_Z - 0.04, 0.3)
    cup += ring(6, 0.22, TORCH_FLAME_Z - 0.04, 0.3)
    cup += ring(6, 0.1, 2.06, 0.3)
    faces = []
    for k in range(3):
        for i in range(6):
            j = (i + 1) % 6
            faces.append([k * 6 + i, k * 6 + j, (k + 1) * 6 + j, (k + 1) * 6 + i])
    faces.append(list(reversed(range(6))))
    pc.add((cup, faces), MAT_IRON, flat(IRON, 0.06, "tchcup"))
    coals = [(0.0, 0.0, TORCH_FLAME_Z - 0.02)] + ring(6, 0.2, TORCH_FLAME_Z - 0.08, 0.1, 0.1, "tchc")
    pc.add((coals, [[0, 1 + i, 1 + (i + 1) % 6] for i in range(6)]), MAT_GLOW, flat(GLOW, 0.1, "tchcoal"))
    for k in range(3):
        a = TAU * k / 3
        footing(pc, math.cos(a) * 0.3, math.sin(a) * 0.3, 0.17, "tchs%d" % k)
    pc.socket("Socket_Flame", (0.0, 0.0, TORCH_FLAME_Z), {"socket": "flame"})
    return pc


def build_lantern_post():
    pc = Piece("musterLanternPost", "mirefen-muster-lantern-post", "structure", ["lantern-post", "iron-lantern", "glass-glow"])
    m = post(pc, 0.0, 0.0, 2.95, 0.13, "lp", tip=0.28)
    lashing(pc, m, 0.13, "lpl", z=0.8, double=True, width=0.1)
    lashing(pc, m, 0.13, "lpu", z=2.45, double=True, width=0.1)
    # the arm reaching forward (-Y) and a diagonal strut
    pc.add(log_x(6, 0.07, 1.0, tag="lparm"), MAT_WOOD, painter(WOOD_MID, tag="lparm"), T(0.0, -0.42, 2.58) @ RZ(math.pi / 2))
    v, f, mm = rope_between(Vector((0.0, -0.08, 2.08)), Vector((0.0, -0.6, 2.56)), 0.05, n=5)
    pc.add((v, f), MAT_WOOD, painter(WOOD_MID, tag="lpstrut"), mm)
    # the hanging lantern: hook, cap, glass, frame, base
    lx, ly = 0.0, -0.8
    v, f, mm = rope_between(Vector((lx, ly, 2.55)), Vector((lx, ly, 2.3)), 0.018, n=4)
    pc.add((v, f), MAT_IRON, flat(IRON, 0.04, "lphook"), mm)
    cap = [(p[0] + lx, p[1] + ly, p[2]) for p in ring(6, 0.2, 2.1, 0.0)] + [(lx, ly, 2.32)]
    pc.add((cap, [[i, (i + 1) % 6, 6] for i in range(6)] + [list(reversed(range(6)))]), MAT_IRON, flat(IRON, 0.05, "lpcap"))
    pc.add(prism(6, 0.13, 0.13, 0.36, 1.74), MAT_GLOW, flat(GLOW, 0.08, "lpglass"), T(lx, ly, 0.0))
    for i in range(6):
        a = TAU * i / 6
        pc.add(prism(4, 0.022, 0.022, 0.4, 1.72, phase=0.78), MAT_IRON, flat(IRON, 0.04, "lpbar%d" % i), T(lx + math.cos(a) * 0.15, ly + math.sin(a) * 0.15, 0.0))
    pc.add(prism(6, 0.19, 0.16, 0.08, 1.66), MAT_IRON, flat(IRON_LIGHT, 0.05, "lpbase"), T(lx, ly, 0.0))
    for k in range(3):
        a = TAU * k / 3 + 0.5
        footing(pc, math.cos(a) * 0.32, math.sin(a) * 0.32, 0.2, "lps%d" % k)
    pc.socket("Socket_Light", (lx, ly, 1.92), {"socket": "light"})
    return pc


BUILDERS = [
    build_palisade,
    build_barricade,
    build_gate,
    build_watchtower,
    lambda: build_tent(True),
    lambda: build_tent(False),
    build_weapon_rack,
    build_crate,
    build_barrel,
    build_sacks,
    build_cart_wheel,
    build_torch,
    build_lantern_post,
]

# kit key -> shipped file name (public/models/props/<file>.glb)
FILE_NAMES = {
    "musterPalisade": "muster_palisade",
    "musterBarricade": "muster_barricade",
    "musterGate": "muster_gate",
    "musterWatchtower": "muster_watchtower",
    "musterTentLarge": "muster_tent_large",
    "musterTentSmall": "muster_tent_small",
    "musterWeaponRack": "muster_weapon_rack",
    "musterCrate": "muster_crate",
    "musterBarrel": "muster_barrel",
    "musterSacks": "muster_sacks",
    "musterCartWheel": "muster_cart_wheel",
    "musterTorch": "muster_torch",
    "musterLanternPost": "muster_lantern_post",
}

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


def piece_object(pc, collection):
    mats = [m for m in MATERIAL_ORDER if m in set(pc.face_mats)]
    me = bpy.data.meshes.new(pc.key + "Mesh")
    me.from_pydata([tuple(v) for v in pc.verts], [], pc.faces)
    me.validate(clean_customdata=False)
    for m in mats:
        me.materials.append(make_material(m))
    me.polygons.foreach_set("material_index", [mats.index(m) for m in pc.face_mats])
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    flat_cols = []
    for poly, cols in zip(me.polygons, pc.corner_cols):
        for c in cols:
            flat_cols.extend((c[0], c[1], c[2], 1.0))
    col.data.foreach_set("color", flat_cols)
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(38.0))
    me.update()
    (x0, y0, z0), (x1, y1, z1) = pc.bounds()
    root = bpy.data.objects.new(pc.key[0].upper() + pc.key[1:], None)
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": pc.asset_id,
        "kitKey": pc.key,
        "stage": "final",
        "tierClass": pc.tier_class,
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards"},
        "nativeBounds": {"width": round(x1 - x0, 3), "height": round(z1 - z0, 3), "depth": round(y1 - y0, 3)},
        "identityCues": list(pc.notes),
        "collider": {"shippingCollisionMesh": False},
    }
    collection.objects.link(root)
    body = bpy.data.objects.new(pc.key[0].upper() + pc.key[1:] + "Body", me)
    body.parent = root
    collection.objects.link(body)
    for name, pos, extras in pc.sockets:
        s = bpy.data.objects.new(name, None)
        s.location = pos
        s.parent = root
        s["socket"] = extras["socket"]
        collection.objects.link(s)
    return root


def build_all(collection):
    pieces = []
    for build in BUILDERS:
        pc = build()
        pc.normalize()
        root = piece_object(pc, collection)
        pieces.append((pc, root))
    return pieces


def export_piece(root, path):
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
    collection = bpy.data.collections.new("MusterKit")
    bpy.context.scene.collection.children.link(collection)
    pieces = build_all(collection)
    report = []
    for pc, root in pieces:
        (x0, y0, z0), (x1, y1, z1) = pc.bounds()
        report.append("%s tris=%d size=%.2fx%.2fx%.2f" % (pc.key, pc.triangles(), x1 - x0, y1 - y0, z1 - z0))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
            export_piece(root, os.path.join(out_dir, FILE_NAMES[pc.key] + ".glb"))
    print("MUSTER_KIT_REPORT_BEGIN")
    print("\n".join(report))
    print("MUSTER_KIT_REPORT_END")


if __name__ == "__main__":
    main()
