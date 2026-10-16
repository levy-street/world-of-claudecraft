# The muster training effigy and the soldiers' stake mallet: a deterministic Blender
# factory.
#
# The Mirefen muster (the army camped around Balgath's crater) built a half-size
# wooden-and-straw effigy of the cyclops in its command camp to drill the pike trick:
# a pikeman braces a long pike and drives it into the single eye, which blinds the
# boss and drops his stone hide for a few seconds. The effigy mimics that hide with
# limewashed planks nailed over the chest, belly, flanks, shoulders, thighs, arms
# and back; every plank group is its own node (`Plank_NN`, origin at the centre of
# the group's bounds) so the game can detach and drop them one by one, and the straw body
# under them is finished so it reads when they are off. The eye is an iron
# lantern seated in a painted socket: `Lantern` (iron housing), `LanternGlass`
# (its own material bucket) and the empty `LanternFlame` at the flame centre.
#
# The second piece is the big two-handed stake mallet (a beetle) the camp's
# carpenters drive palisade stakes with. It is authored in the KayKit
# `axe_2handed.glb` grip frame: one mesh node, handle along +Y (glTF), butt and
# crown on the axe's, centred on the handle, so after quantization it carries the
# axe's node transform and attaches to `handslot.r` exactly like the two-handed
# axe (the `2H_Axe` accessory grip).
#
#   blender --background --python scripts/assets/muster_effigy/model.py -- --out <dir>
#
# Style: the muster camp kit's (scripts/assets/muster_camp/model.py): stylized
# low-poly, hand-painted by VERTEX COLOUR (no textures), the same timber, rope,
# red cloth and iron palette, chunky chamfers, per-face mottling. The helpers are
# copied, not imported, so this asset's fingerprint covers every input.
#
# Determinism: no clock, no `random`. Every variation comes from `h01`, a sha256 of
# a descriptive tag, so the same file always builds the same bytes.
#
# Frame: Blender Z-up with the FRONT toward -Y, which the glTF exporter turns into
# +Y up and +Z front. Units are yards (1 Blender unit = 1 yard). The effigy is
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


# the muster camp palette (same timber, rope, cloth and iron)
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
IRON = srgb(0x4A4E55)
IRON_LIGHT = srgb(0x6E737B)
STONE = srgb(0x7F8184)
STONE_LIGHT = srgb(0xA3A4A5)
GLOW = srgb(0xFFB24A)
# the effigy's own: straw, limewash (the painted "stone hide"), soot, earth
STRAW = srgb(0xD0A650)
STRAW_PALE = srgb(0xE8CC88)
STRAW_DARK = srgb(0x94702E)
STRAW_OLD = srgb(0xB09A66)
LIME = srgb(0x9A9C9B)
LIME_LIGHT = srgb(0xBDBEBA)
LIME_DARK = srgb(0x797C7E)
SOOT = srgb(0x2B211C)
SOCKET = srgb(0x1C120D)
EARTH = srgb(0x6E5438)
EARTH_LIGHT = srgb(0x8C7050)
GLASS_HOT = srgb(0xFFD27A)

# Material buckets. The NAMES are load-bearing for the runtime (surface-detail family
# and the lantern glow are routed by name).
MAT_WOOD = "EffigyWood"
MAT_STRAW = "EffigyStraw"
MAT_ROPE = "EffigyRope"
MAT_IRON = "EffigyIron"
MAT_CLOTH = "EffigyCloth"
MAT_GLASS = "EffigyGlass"
MAT_ROCK = "EffigyRock"
MATERIAL_ORDER = [MAT_WOOD, MAT_STRAW, MAT_ROPE, MAT_IRON, MAT_CLOTH, MAT_GLASS, MAT_ROCK]

MATERIAL_DEFS = {
    MAT_WOOD: {"metallic": 0.0, "roughness": 0.86, "emission": None},
    MAT_STRAW: {"metallic": 0.0, "roughness": 0.96, "emission": None},
    MAT_ROPE: {"metallic": 0.0, "roughness": 0.94, "emission": None},
    MAT_IRON: {"metallic": 0.6, "roughness": 0.48, "emission": None},
    MAT_CLOTH: {"metallic": 0.0, "roughness": 0.95, "emission": None},
    MAT_GLASS: {"metallic": 0.0, "roughness": 0.2, "emission": srgb(0xFF9A3C)},
    MAT_ROCK: {"metallic": 0.0, "roughness": 0.92, "emission": None},
}

# ---------------------------------------------------------------------------
# geometry primitives (local space, returned as (verts, faces))
# ---------------------------------------------------------------------------


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


def face_center(verts, f):
    c = Vector((0.0, 0.0, 0.0))
    for i in f:
        c += Vector(verts[i])
    return c / len(f)


def orient_refs(verts, faces, refs):
    """Wind each face so its normal points away from its reference point."""
    out = []
    for f, ref in zip(faces, refs):
        nrm = newell([verts[i] for i in f])
        out.append(f if nrm.dot(face_center(verts, f) - ref) >= 0.0 else list(reversed(f)))
    return out


def orient_convex(verts, faces, center=None):
    """Wind every face outward for a (near) convex shape."""
    if center is None:
        n = float(len(verts))
        center = Vector((sum(v[0] for v in verts) / n, sum(v[1] for v in verts) / n, sum(v[2] for v in verts) / n))
    return verts, orient_refs(verts, faces, [center] * len(faces))


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
    return orient_convex(verts, faces, Vector((0.0, 0.0, z0 + h / 2.0)))


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


def _icosahedron():
    t = (1.0 + math.sqrt(5.0)) / 2.0
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [tuple(c / math.sqrt(1 + t * t) for c in p) for p in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    return v, [list(x) for x in f]


def rock(r, tag, squash=0.62, detail=1):
    """A faceted footing stone (or packed-earth mound), flat-bottomed at z 0.
    `detail` 0 is a bare icosahedron (small stones), 1 is subdivided once."""
    base_v, base_f = _icosphere1() if detail else _icosahedron()
    verts = []
    for i, p in enumerate(base_v):
        k = 1.0 + 0.2 * hs(tag, "rk", i)
        x, y, z = p[0] * r * k, p[1] * r * k * (0.85 + 0.2 * h01(tag, "ry")), p[2] * r * k * squash
        z = max(z, -r * squash * 0.35)
        verts.append((x, y, z + r * squash * 0.35))
    return orient_convex(verts, [list(f) for f in base_f], Vector((0.0, 0.0, r * squash * 0.3)))


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
            bulge = 1.0 + 0.06 * hs(tag, vi, ui)
            verts.append((fx * sx / 2 * bulge, fy * sy / 2 * bulge, fz * sz / 2))
    for vi in range(nv):
        for ui in range(nu):
            a = vi * nu + ui
            b = vi * nu + (ui + 1) % nu
            faces.append([a, b, b + nu, a + nu])
    clean = []
    for f in faces:
        uniq = []
        for i in f:
            if all((Vector(verts[i]) - Vector(verts[j])).length > 1e-5 for j in uniq):
                uniq.append(i)
        if len(uniq) >= 3:
            clean.append(uniq)
    return orient_convex(verts, clean, Vector((0.0, 0.0, 0.0)))


def cloth(w, h, nx, ny, tag, teeth=0.18, wave=0.08, thick=0.03, taper=0.0):
    """A hanging cloth (rag/pennant): top edge at z 0 along X, hanging to -h, a jagged
    torn bottom, a soft wave, and a back face so it reads from both sides."""
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


def sweep(path, radius, n, closed=False, cap0=True, cap1=True, tip0=0.0, tip1=0.0, jitter=0.0, tag="", phase=0.0, squash=1.0, hint=None):
    """A tube swept along a polyline (parallel-transport frames). `radius` is a
    number or one value per path point; `squash` flattens the tube along its first
    frame axis (a slat); `tip0`/`tip1` end in a point instead of a flat cap. Faces
    are wound outward from the path. Side face index = segment * n + side, so a
    paint function can read the side column as `fi % n`."""
    P = [Vector(p) for p in path]
    m = len(P)
    tans = []
    for i in range(m):
        if closed:
            d = P[(i + 1) % m] - P[(i - 1) % m]
        else:
            d = P[min(i + 1, m - 1)] - P[max(i - 1, 0)]
        tans.append(d.normalized())
    h = Vector(hint) if hint is not None else (Vector((0.0, 0.0, 1.0)) if abs(tans[0].z) < 0.9 else Vector((1.0, 0.0, 0.0)))
    a = h - tans[0] * h.dot(tans[0])
    if a.length < 1e-6:
        a = Vector((1.0, 0.0, 0.0)) - tans[0] * tans[0].x
    a.normalize()
    frames = []
    for i in range(m):
        t = tans[i]
        a = a - t * a.dot(t)
        a.normalize()
        frames.append((a.copy(), t.cross(a)))
    verts = []
    for i in range(m):
        fa, fb = frames[i]
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        for k in range(n):
            ang = phase + TAU * k / n
            rr = r * (1.0 + jitter * hs(tag, "sw", i % m if closed else i, k))
            verts.append(tuple(P[i] + fa * (math.cos(ang) * rr * squash) + fb * (math.sin(ang) * rr)))
    faces = []
    refs = []
    segs = m if closed else m - 1
    for i in range(segs):
        i2 = (i + 1) % m
        ref = (P[i] + P[i2]) / 2.0
        for k in range(n):
            k2 = (k + 1) % n
            faces.append([i * n + k, i * n + k2, i2 * n + k2, i2 * n + k])
            refs.append(ref)
    if not closed:
        last = (m - 1) * n
        if tip0 > 0.0:
            apex = len(verts)
            verts.append(tuple(P[0] - tans[0] * tip0))
            for k in range(n):
                faces.append([k, (k + 1) % n, apex])
                refs.append(P[0] + tans[0] * 0.02)
        elif cap0:
            faces.append(list(range(n)))
            refs.append(P[0] + tans[0] * 0.02)
        if tip1 > 0.0:
            apex = len(verts)
            verts.append(tuple(P[-1] + tans[-1] * tip1))
            for k in range(n):
                faces.append([last + k, last + (k + 1) % n, apex])
                refs.append(P[-1] - tans[-1] * 0.02)
        elif cap1:
            faces.append([last + k for k in range(n)])
            refs.append(P[-1] - tans[-1] * 0.02)
    return verts, orient_refs(verts, faces, refs)


def lerp_path(p0, p1, count):
    p0, p1 = Vector(p0), Vector(p1)
    return [p0.lerp(p1, i / (count - 1)) for i in range(count)]


def spike_fan(center, direction, count, length, spread, tag, base_r=0.035, lift=0.0):
    """A straw tuft: `count` thin three-sided spikes fanned in a cone round
    `direction`. Returns geometry in world space (no caps: the base is buried)."""
    d = Vector(direction).normalized()
    ha = Vector((0.0, 0.0, 1.0)) if abs(d.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    ea = d.cross(ha).normalized()
    eb = d.cross(ea).normalized()
    c = Vector(center)
    verts = []
    faces = []
    refs = []
    for s in range(count):
        ang = TAU * (s + 0.5 * h01(tag, "a", s)) / count
        tilt = spread * (0.35 + 0.65 * h01(tag, "t", s))
        dirv = (d * math.cos(tilt) + (ea * math.cos(ang) + eb * math.sin(ang)) * math.sin(tilt)).normalized()
        dirv = (dirv + Vector((0.0, 0.0, lift))).normalized()
        ln = length * (0.6 + 0.4 * h01(tag, "l", s))
        base = c + (ea * math.cos(ang) + eb * math.sin(ang)) * (0.06 * h01(tag, "o", s))
        pa = dirv.cross(ha if abs(dirv.z) < 0.9 else Vector((1.0, 0.0, 0.0))).normalized()
        pb = dirv.cross(pa).normalized()
        i0 = len(verts)
        for q in range(3):
            aa = TAU * q / 3 + h01(tag, "p", s)
            verts.append(tuple(base + (pa * math.cos(aa) + pb * math.sin(aa)) * base_r))
        verts.append(tuple(base + dirv * ln))
        axis_mid = base + dirv * (ln * 0.3)
        for q in range(3):
            faces.append([i0 + q, i0 + (q + 1) % 3, i0 + 3])
            refs.append(axis_mid)
    return verts, orient_refs(verts, faces, refs)


def align_z(direction):
    """Rotation taking +Z onto `direction`."""
    d = Vector(direction).normalized()
    z = Vector((0.0, 0.0, 1.0))
    axis = z.cross(d)
    if axis.length < 1e-9:
        return Matrix.Identity(4) if d.z > 0 else Matrix.Rotation(math.pi, 4, "X")
    ang = math.acos(max(-1.0, min(1.0, z.dot(d))))
    return Matrix.Rotation(ang, 4, axis.normalized())


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


def frame_at(point, normal, tangent_hint):
    """A 4x4 whose Z is `normal`, X is the hint projected onto the tangent plane."""
    n = Vector(normal).normalized()
    t = Vector(tangent_hint)
    t = (t - n * t.dot(n)).normalized()
    b = n.cross(t)
    m = Matrix.Identity(4)
    for r in range(3):
        m[r][0], m[r][1], m[r][2], m[r][3] = t[r], b[r], n[r], point[r]
    return m


# ---------------------------------------------------------------------------
# surfaces the conformed pieces (planks, paint, scars) wrap onto
# ---------------------------------------------------------------------------


class Cylinder:
    """A tapered round surface around a segment a -> b (radius ra at a, rb at b)."""

    def __init__(self, a, b, ra, rb=None):
        self.a = Vector(a)
        self.b = Vector(b)
        self.u = (self.b - self.a).normalized()
        self.len = (self.b - self.a).length
        self.ra = ra
        self.rb = ra if rb is None else rb

    def project(self, p):
        p = Vector(p)
        s = (p - self.a).dot(self.u)
        f = self.a + self.u * s
        d = p - f
        if d.length < 1e-9:
            d = Vector((0.0, -1.0, 0.0))
        d.normalize()
        t = max(0.0, min(1.0, s / self.len))
        r = self.ra + (self.rb - self.ra) * t
        return f + d * r, d


class Sphere:
    def __init__(self, c, r):
        self.c = Vector(c)
        self.r = r

    def project(self, p):
        d = (Vector(p) - self.c).normalized()
        return self.c + d * self.r, d


# ---------------------------------------------------------------------------
# colouring: the hand-painted pass
# ---------------------------------------------------------------------------


def painter(base, top=None, top_from=None, grad=0.28, mottle=0.07, tag="", light=None, ground_dark=0.12):
    """A per-corner colour function: `base` darkens toward the ground and brightens
    up the part, sky-facing faces catch a lighter wash, each face is mottled a touch,
    and anything above `top_from` (local z) takes `top` (a carved tip)."""

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


def flat(color, mottle=0.05, tag=""):
    def fn(p, nrm, fi, zmin, zmax, fc=None):
        k = 1.0 + mottle * hs(tag, "fl", fi)
        if nrm.z > 0.6:
            k *= 1.06
        elif nrm.z < -0.5:
            k *= 0.8
        return mul(color, k)

    return fn


def log_paint(base, axis, tag, grad=0.22, n=None):
    """A timber: the sawn/split ends (faces along `axis`) are the pale end grain. With
    `n` (the sweep's side count) the mottle runs per side column instead of per face,
    so the faces along one side of a straight log share their corners."""
    ax = Vector(axis).normalized()
    body = painter(base, grad=grad, mottle=0.08 if n is None else 0.0, tag=tag)

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        if abs(nrm.dot(ax)) > 0.75:
            return mul(WOOD_ENDGRAIN, 1.0 + 0.06 * hs(tag, "eg", fi))
        c = body(p, nrm, fi, zmin, zmax, fc)
        if n is not None:
            c = mul(c, 1.0 + 0.08 * hs(tag, "col", fi[1] % n))
        return c

    return fn


STRAW_TONES = None


def straw_tone(tag, col):
    """Bound straw reads as strands: each column draws one of five tones at random,
    never the same tone as the column before it, so the banding never looks ruled."""
    global STRAW_TONES
    if STRAW_TONES is None:
        STRAW_TONES = [STRAW_PALE, STRAW, mix(STRAW, STRAW_DARK, 0.45), STRAW_OLD, mix(STRAW, STRAW_DARK, 0.8)]

    def pick(c):
        return int(h01(tag, "tone", c) * len(STRAW_TONES))

    i = pick(col)
    if col > 0 and i == pick(col - 1):
        i = (i + 2) % len(STRAW_TONES)
    return STRAW_TONES[i]


def straw_column_paint(n, tag, shade=1.0, ao=None, lift=0.22):
    """Straw strands: every face in sweep column `fi % n` takes that column's tone
    (crisp stripes between columns), shaded per corner by height and the tucked-in
    darkening only. Faces up a column share their corner colours, so the export
    keeps those rows welded."""

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        c = straw_tone(tag, fi[1] % n)
        t = (p[2] - zmin) / max(1e-6, zmax - zmin)
        k = shade * (0.84 + lift * t)
        occl = ao(p) if ao is not None else 1.0
        if occl < 1.0:
            c = mix(c, STRAW_DARK, (1.0 - occl) * 1.4)
        return mul(c, k * occl)

    return fn


def smooth_paint(base, grad=0.14):
    """A colour that varies only with height (rope): shared across faces."""

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        t = (p[2] - zmin) / max(1e-6, zmax - zmin)
        return mul(base, (1.0 - grad * 0.5) + grad * t)

    return fn


def spike_paint(center, length, tag, base=STRAW, tip=STRAW_PALE):
    c0 = Vector(center)

    def fn(p, nrm, fi, zmin, zmax, fc=None):
        t = min(1.0, (Vector(p) - c0).length / max(1e-6, length))
        c = mix(mix(base, STRAW_DARK, 0.35), tip, t)
        return mul(c, 1.0 + 0.08 * hs(tag, "sp", fi[1] // 3))

    return fn


# ---------------------------------------------------------------------------
# the part accumulator
# ---------------------------------------------------------------------------


class Part:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.face_mats = []
        self.corner_cols = []
        self.parts = 0

    def add(self, geo, mat, paint, m=None):
        verts, faces = geo[0], geo[1]
        if m is None:
            m = Matrix.Identity(4)
        zs = [v[2] for v in verts]
        zmin, zmax = min(zs), max(zs)
        rot = m.to_3x3()
        base = len(self.verts)
        self.verts.extend(m @ Vector(v) for v in verts)
        tag = (self.name, self.parts)
        self.parts += 1
        for fi, f in enumerate(faces):
            local = [verts[i] for i in f]
            nrm_local = newell(local)
            nrm_world = (rot @ nrm_local).normalized() if nrm_local.length > 0 else nrm_local
            fc = tuple(sum(v[a] for v in local) / len(local) for a in range(3))
            if isinstance(paint, tuple) and paint[0] == "vertex":
                cols = [paint[1][i] for i in f]
            elif isinstance(paint, tuple) and paint[0] == "corner":
                cols = [paint[1](fi, i) for i in f]
            elif isinstance(paint, list):
                cols = [paint[fi]] * len(f)
            else:
                cols = [paint(verts[i], nrm_world, (tag, fi), zmin, zmax, fc) for i in f]
            self.faces.append([base + i for i in f])
            self.face_mats.append(mat)
            self.corner_cols.append(cols)

    def offset(self, off):
        self.verts = [v - off for v in self.verts]

    def bounds(self):
        xs = [v.x for v in self.verts]
        ys = [v.y for v in self.verts]
        zs = [v.z for v in self.verts]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)


# ---------------------------------------------------------------------------
# shared details
# ---------------------------------------------------------------------------


def lash_ring(pc, center, axis, r, tag, width=0.12, turns=2, sides=8):
    """Cream rope turns wrapped round a member of radius r (axis = its direction)."""
    ax = Vector(axis).normalized()
    for k in range(turns):
        c = Vector(center) + ax * ((k - (turns - 1) / 2.0) * width * 1.1 + 0.015 * hs(tag, "lz", k))
        tilt = Vector((hs(tag, "tx", k), hs(tag, "ty", k), hs(tag, "tz", k))) * 0.06
        m = Matrix.Translation(c) @ align_z(ax + tilt)
        v, f = prism(sides, r + 0.035, r + 0.035, width, -width / 2.0, False, False, phase=0.3 * k)
        pc.add((v, f), MAT_ROPE, smooth_paint(mix(ROPE, ROPE_SHADE, 0.3 * h01(tag, k))), m)


def hoop_path(ell, z, off, count):
    """A closed loop round an ellipsoid at height z, `off` out from its surface."""
    pts = []
    for i in range(count):
        th = TAU * i / count
        q, n = ell.at(th, z)
        pts.append(q + n * off)
    return pts


def rivet(pc, point, normal, tag, r=0.05, h=0.035, mat=MAT_IRON, sides=4):
    """A forged nail head: a low pyramid (4 tris) or a capped frustum."""
    if sides == 4:
        verts = ring(4, r, 0.0, h01(tag) * TAU) + [(0.0, 0.0, h)]
        faces = [[i, (i + 1) % 4, 4] for i in range(4)]
        v, f = orient_convex(verts, faces, Vector((0.0, 0.0, -0.01)))
    else:
        v, f = prism(sides, r, r * 0.55, h, 0.0, False, True, phase=h01(tag) * TAU)
    pc.add((v, f), mat, flat(IRON_LIGHT, 0.1, tag), Matrix.Translation(Vector(point)) @ align_z(normal))


def conformed_disc(surface, center, normal_hint, r0, r1, n, standoff, rings=1):
    """A flat annulus (or disc when r0 is 0) wrapped onto a surface: paint decals."""
    q, nrm = surface.project(center)
    fr = frame_at(q, nrm, Vector((1.0, 0.0, 0.0)) if abs(nrm.x) < 0.9 else Vector((0.0, 0.0, 1.0)))
    ex = fr.col[0].xyz
    ey = fr.col[1].xyz
    verts = []
    faces = []
    refs = []
    radii = [r1] if r0 <= 1e-6 else [r0 + (r1 - r0) * i / rings for i in range(rings + 1)]
    for r in radii:
        for k in range(n):
            a = TAU * k / n
            p = q + ex * (math.cos(a) * r) + ey * (math.sin(a) * r)
            qq, nn = surface.project(p)
            verts.append(tuple(qq + nn * standoff))
    if r0 <= 1e-6:
        c = len(verts)
        verts.append(tuple(q + nrm * standoff))
        for k in range(n):
            faces.append([k, (k + 1) % n, c])
            refs.append(q - nrm * 0.3)
        return verts, orient_refs(verts, faces, refs)
    for i in range(rings):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append([i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k])
            refs.append(q - nrm * 0.3)
    return verts, orient_refs(verts, faces, refs)


# ---------------------------------------------------------------------------
# the plank armour ("stone hide")
# ---------------------------------------------------------------------------


def conformed_plank(pc, surface, hint_point, tangent_hint, length, width, thick, standoff, tag, twist=0.0, segs=None, rivets=True):
    """One limewashed plank bent onto a surface: a hexagonal (chamfered) profile swept
    along its length, every section projected onto the surface and lifted by
    `standoff`, a slanted split end, worn brown edges, and an iron nail at each end."""
    if segs is None:
        segs = 4 if length > 1.05 else 3
    q, n = surface.project(hint_point)
    t = Vector(tangent_hint)
    t = (t - n * t.dot(n)).normalized()
    b = n.cross(t)
    if abs(twist) > 1e-9:
        t, b = (t * math.cos(twist) + b * math.sin(twist)).normalized(), (b * math.cos(twist) - t * math.sin(twist)).normalized()
    hw = width / 2.0
    ch = min(0.05, thick * 0.45)
    profile = [(-hw, 0.0), (hw, 0.0), (hw, thick - ch), (hw - ch, thick), (-hw + ch, thick), (-hw, thick - ch)]
    slant0 = 0.12 * hs(tag, "s0")
    slant1 = 0.12 * hs(tag, "s1")
    verts = []
    centres = []
    for i in range(segs + 1):
        u = -length / 2.0 + length * i / segs
        for j, (v, w) in enumerate(profile):
            uu = u
            if i == 0:
                uu += slant0 * (v / hw)
            elif i == segs:
                uu += slant1 * (v / hw) - 0.05 * (1.0 if (j in (2, 3)) else 0.0) * h01(tag, "chip")
            p = q + t * uu + b * v
            qq, nn = surface.project(p)
            lift = standoff + 0.015 * math.sin(math.pi * i / segs)
            verts.append(tuple(qq + nn * (lift + w)))
        qq, nn = surface.project(q + t * u)
        centres.append(qq + nn * (standoff + thick * 0.5))
    k = len(profile)
    faces = []
    refs = []
    kinds = []
    for i in range(segs):
        ref = (centres[i] + centres[i + 1]) / 2.0
        for j in range(k):
            j2 = (j + 1) % k
            faces.append([i * k + j, i * k + j2, (i + 1) * k + j2, (i + 1) * k + j])
            refs.append(ref)
            kinds.append("top" if j == 3 else ("chamfer" if j in (2, 4) else ("bottom" if j == 0 else "side")))
    faces.append(list(range(k)))
    refs.append(centres[0].lerp(centres[1], 0.3))
    kinds.append("end")
    faces.append([segs * k + j for j in range(k)])
    refs.append(centres[segs].lerp(centres[segs - 1], 0.3))
    kinds.append("end")
    faces = orient_refs(verts, faces, refs)
    wash = mix(LIME, LIME_LIGHT, h01(tag, "w")) if h01(tag, "wt") < 0.7 else mix(LIME, LIME_DARK, 0.6)
    chamfer_worn = h01(tag, "cw") > 0.45

    def plank_color(fi, vi):
        kind = kinds[fi]
        ring = vi // k
        worn = h01(tag, "worn", ring) < 0.3
        if kind == "top":
            c = mix(wash, WOOD_PLANK, 0.55) if worn else wash
            return mul(c, 1.0 + 0.08 * hs(tag, "tp", ring))
        if kind == "chamfer":
            return mix(WOOD_CARVED, wash, 0.35) if (chamfer_worn or worn) else mix(wash, LIME_LIGHT, 0.5)
        if kind == "end":
            return WOOD_ENDGRAIN
        if kind == "side":
            return mix(WOOD_WARM, wash, 0.25)
        return mul(WOOD_DARK, 0.8)

    pc.add((verts, faces), MAT_WOOD, ("corner", plank_color))
    if rivets:
        for e, u in enumerate((-length / 2.0 + 0.13, length / 2.0 - 0.13)):
            qq, nn = surface.project(q + t * u + b * (0.03 * hs(tag, "rv", e)))
            rivet(pc, qq + nn * (standoff + thick - 0.01), nn, tag + "rv%d" % e)
    return centres[segs // 2]


# ---------------------------------------------------------------------------
# the effigy
# ---------------------------------------------------------------------------

# authored layout (Blender units = yards, z up, front -Y)
FLAME_Z = 5.36  # the lantern flame, the pike's target (glTF y after export)
EYE_R = 0.38  # the socket's inner radius
HEAD_BASE = 4.25
HEAD_TOP = 6.12
HEAD_CY = -0.14
HEAD_R_END = 0.92
HEAD_R_MID = 1.12


class TorsoSurface:
    """The straw barrel's outer surface (the core before its hoop pinches): a
    superellipse profile (torso_k), the belly pushed forward low and the hunch
    pushed back high. `at(theta, z)` is the point at azimuth theta (0 = front, -Y)
    and EXACTLY height z; `project` keeps a point's height and takes its azimuth,
    so things wrapped round the barrel never drift up or down it."""

    def __init__(self, c, rx, ry, rz):
        self.c = Vector(c)
        self.r = Vector((rx, ry, rz))

    def point(self, th, z):
        k = max(0.3, torso_k(z))
        fwd = -0.1 * math.exp(-(((z - 3.2) / 0.55) ** 2))
        back = 0.12 * math.exp(-(((z - 4.3) / 0.4) ** 2))
        cth = math.cos(th)
        y = -cth * self.r.y * k + fwd * max(0.0, cth) + back * max(0.0, -cth)
        return Vector((self.c.x + math.sin(th) * self.r.x * k, self.c.y + y, z))

    def at(self, th, z):
        z = max(self.c.z - self.r.z + 0.02, min(self.c.z + self.r.z - 0.02, z))
        q = self.point(th, z)
        ta = self.point(th + 0.01, z) - self.point(th - 0.01, z)
        tz = self.point(th, z + 0.01) - self.point(th, z - 0.01)
        n = ta.cross(tz).normalized()
        if n.dot(q - Vector((self.c.x, self.c.y, z))) < 0.0:
            n = -n
        return q, n

    def project(self, p):
        p = Vector(p)
        th = math.atan2(p.x - self.c.x, -(p.y - self.c.y))
        return self.at(th, p.z)


TORSO = TorsoSurface((0.0, 0.12, 3.5), 1.5, 1.12, 1.24)
LEG_X = 0.8
HIP_Z = 2.55
SHOULDER_Z = 4.42
STRAW_SIDES = 10
HOOP_Z = (3.06, 4.0)
BELT_Z = 2.62


def head_r(z):
    t = max(0.0, min(1.0, (z - HEAD_BASE) / (HEAD_TOP - HEAD_BASE)))
    return HEAD_R_END + (HEAD_R_MID - HEAD_R_END) * math.sin(math.pi * t) ** 0.7


class CaskSurface:
    """The barrel head: a bulged cylinder round the vertical axis at HEAD_CY."""

    def project(self, p):
        p = Vector(p)
        d = Vector((p.x, p.y - HEAD_CY, 0.0))
        if d.length < 1e-9:
            d = Vector((0.0, -1.0, 0.0))
        d.normalize()
        z = p.z
        r = head_r(z)
        dr = (head_r(z + 0.01) - head_r(z - 0.01)) / 0.02
        q = Vector((d.x * r, HEAD_CY + d.y * r, z))
        n = Vector((d.x, d.y, -dr)).normalized()
        return q, n


CASK = CaskSurface()


def cask_at(u, z):
    """The cask surface point `u` yards of arc from the front centre line (+u is +X)."""
    r = head_r(z)
    a = u / r
    return Vector((math.sin(a) * r, HEAD_CY - math.cos(a) * r, z))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def torso_k(z):
    """The straw barrel's profile: a superellipse, rounder at the belly than an
    ellipse so it sits on the hips instead of tapering to a point."""
    d = (z - TORSO.c.z) / TORSO.r.z
    p = 2.7 if d < 0 else 2.2
    return max(0.0, 1.0 - min(1.0, abs(d)) ** p) ** (1.0 / p)


def torso_ao(p):
    z = p[2]
    k = 1.0
    for hz in HOOP_Z + (BELT_Z,):
        k *= 1.0 - 0.2 * math.exp(-(((z - hz) / 0.1) ** 2))
    k *= 1.0 - 0.22 * smooth(4.3, 4.74, z)
    k *= 1.0 - 0.18 * smooth(2.62, 2.27, z)
    return k


def bundle_ao(p0, p1):
    a, b = Vector(p0), Vector(p1)
    d = b - a
    ln2 = max(1e-9, d.dot(d))

    def ao(p):
        t = max(0.0, min(1.0, (Vector(p) - a).dot(d) / ln2))
        return 1.0 - 0.2 * (1.0 - smooth(0.0, 0.22, min(t, 1.0 - t)))

    return ao


def straw_bundle(pc, path, radii, tag, n=STRAW_SIDES, shade=1.0, jitter=0.08, tuft0=None, tuft1=None):
    v, f = sweep(path, radii, n, cap0=True, cap1=True, jitter=jitter, tag=tag, phase=h01(tag, "ph") * TAU)
    pc.add((v, f), MAT_STRAW, straw_column_paint(n, tag, shade, bundle_ao(path[0], path[-1])))
    P = [Vector(p) for p in path]
    if tuft0:
        d = (P[0] - P[1]).normalized()
        g = spike_fan(P[0] + d * 0.02, d, tuft0[0], tuft0[1], 0.8, tag + "t0", base_r=0.045)
        pc.add(g, MAT_STRAW, spike_paint(P[0], tuft0[1], tag + "t0"))
    if tuft1:
        d = (P[-1] - P[-2]).normalized()
        g = spike_fan(P[-1] + d * 0.02, d, tuft1[0], tuft1[1], 0.8, tag + "t1", base_r=0.045)
        pc.add(g, MAT_STRAW, spike_paint(P[-1], tuft1[1], tag + "t1"))


def log(pc, p0, p1, r, tag, n=7, base=WOOD_MID, tip1=0.0, jitter=0.05, count=3):
    path = lerp_path(p0, p1, count)
    v, f = sweep(path, r, n, tip1=tip1, jitter=jitter, tag=tag, phase=h01(tag, "ph") * TAU)
    pc.add((v, f), MAT_WOOD, log_paint(base, Vector(p1) - Vector(p0), tag, n=n))


def stub(pc, p0, p1, r, tag, n=8, tip=0.06, base=WOOD_PLANK):
    """A sawn peg end (toes, knuckles): a short log with a chamfered end-grain face."""
    p0, p1 = Vector(p0), Vector(p1)
    p2 = p1 + (p1 - p0).normalized() * tip
    v, f = sweep([p0, p1, p2], [r, r, r * 0.7], n, jitter=0.04, tag=tag, phase=h01(tag) * TAU)
    pc.add((v, f), MAT_WOOD, log_paint(base, Vector(p1) - Vector(p0), tag))


def tuft(pc, center, direction, count, length, tag, spread=0.7, base_r=0.035):
    g = spike_fan(center, direction, count, length, spread, tag, base_r=base_r)
    pc.add(g, MAT_STRAW, spike_paint(center, length, tag))


def build_legs(body):
    for s in (-1, 1):
        x = s * LEG_X
        tag = "leg%d" % s
        # the driven log leg (splayed a touch)
        log(body, (x + s * 0.04, 0.02, 0.0), (x, 0.08, HIP_Z + 0.12), 0.3, tag, n=8, base=WOOD_MID)
        # the foot: a chunky block the leg is pinned through, three blunt toes
        foot = T(x + s * 0.06, -0.3, 0.21) @ RZ(s * 0.06)
        body.add(cbox(0.94, 1.36, 0.42, 0.08), MAT_WOOD, painter(WOOD_WARM, grad=0.3, tag=tag + "ft", light=WOOD_CARVED), foot)
        for k, dx in enumerate((-0.29, 0.0, 0.29)):
            p0 = foot @ Vector((dx, -0.56, -0.05))
            p1 = foot @ Vector((dx * 1.06, -0.8 - 0.04 * h01(tag, k), -0.06))
            stub(body, p0, p1, 0.135, tag + "toe%d" % k, n=6, tip=0.06)
        for k, dx in enumerate((-0.3, 0.3)):
            rivet(body, foot @ Vector((dx, -0.35, 0.21)), (0, 0, 1), tag + "fn%d" % k, r=0.07, h=0.04)
        # packed earth round the leg behind the foot, two stones
        mv, mf = prism(9, 0.66, 0.4, 0.16, 0.0, False, True, jitter=0.12, tag=tag + "mound")
        body.add((mv, mf), MAT_ROCK, painter(EARTH, grad=0.35, mottle=0.12, tag=tag + "mound", light=EARTH_LIGHT), T(x + s * 0.05, 0.28, 0.0) @ RZ(h01(tag, "mz") * TAU))
        for k, (dx, dy, r) in enumerate(((s * 0.55, 0.55, 0.2), (-s * 0.35, 0.72, 0.16))):
            body.add(rock(r, tag + "st%d" % k, detail=0), MAT_ROCK, painter(STONE, grad=0.35, mottle=0.12, tag=tag + "st%d" % k, light=STONE_LIGHT), T(x + dx, dy, 0.0) @ RZ(h01(tag, "sz", k) * TAU))
        # the lower leg lashing and the straw thigh
        lash_ring(body, (x + s * 0.02, 0.05, 0.62), (0, 0, 1), 0.3, tag + "sh", turns=2)
        path = lerp_path((x + s * 0.02, 0.06, 1.18), (x, 0.08, HIP_Z + 0.02), 4)
        straw_bundle(body, path, [0.44, 0.6, 0.62, 0.56], tag + "th", tuft0=(7, 0.34))
        lash_ring(body, (x + s * 0.02, 0.06, 1.34), (0, 0, 1), 0.47, tag + "thl", turns=1, width=0.14, sides=10)
        lash_ring(body, (x, 0.08, 2.18), (0, 0, 1), 0.59, tag + "thu", turns=1, width=0.14, sides=10)
    # the hip beam the legs are lashed to
    log(body, (-1.25, 0.1, HIP_Z), (1.25, 0.1, HIP_Z), 0.23, "hip", base=WOOD_DARK)


def torso_core(body):
    """The stuffed straw barrel, pinched where the rope hoops bind it."""
    n = 16
    c = TORSO.c
    levels = [2.27, 2.4, 2.62, 2.88, HOOP_Z[0], 3.3, 3.6, 3.86, HOOP_Z[1], 4.2, 4.46, 4.66, 4.74]
    verts = []
    for z in levels:
        pinch = 0.94 if z in HOOP_Z else 1.0
        for i in range(n):
            th = TAU * (i + 0.5) / n
            j = (1.0 + 0.04 * hs("core", z, i)) * pinch
            q = TORSO.point(th, z)
            verts.append((c.x + (q.x - c.x) * j, c.y + (q.y - c.y) * j, z))
    faces = []
    refs = []
    for li in range(len(levels) - 1):
        ref = Vector((c.x, c.y, (levels[li] + levels[li + 1]) / 2.0))
        for i in range(n):
            i2 = (i + 1) % n
            faces.append([li * n + i, li * n + i2, (li + 1) * n + i2, (li + 1) * n + i])
            refs.append(ref)
    for cap, zc in ((0, levels[0] - 0.05), (len(levels) - 1, levels[-1] + 0.04)):
        ci = len(verts)
        verts.append((c.x, c.y, zc))
        for i in range(n):
            faces.append([cap * n + i, cap * n + (i + 1) % n, ci])
            refs.append(Vector((c.x, c.y, 3.5)))
    body.add((verts, orient_refs(verts, faces, refs)), MAT_STRAW, straw_column_paint(n, "core", 1.0, torso_ao))


RIB_ANGLES = [-0.42, 0.42, -1.22, 1.22, -2.1, 2.1, math.pi]


def torso_frame(body):
    # vertical slats lashed round the straw
    for k, th in enumerate(RIB_ANGLES):
        pts = []
        for z in (2.44, 2.95, 3.5, 4.05, 4.58):
            q, nn = TORSO.at(th, z)
            pts.append(q + nn * (0.05 * max(0.4, torso_k(z) / 0.8)))
        radial = TORSO.at(th, 3.5)[1]
        v, f = sweep(pts, 0.1, 4, jitter=0.05, tag="rib%d" % k, squash=0.45, hint=radial, phase=math.pi / 4)
        body.add((v, f), MAT_WOOD, painter(WOOD_WARM if k % 2 else WOOD_MID, grad=0.25, mottle=0.08, tag="rib%d" % k, light=WOOD_CARVED))
    # rope hoops squeezing the straw
    for k, z in enumerate(HOOP_Z):
        pts = hoop_path(TORSO, z, -0.035, 14)
        v, f = sweep(pts, 0.05, 4, closed=True, tag="hoop%d" % k, phase=0.4)
        body.add((v, f), MAT_ROPE, smooth_paint(ROPE))
    # the rope belt (Balgath's iron belt) and its bound buckle
    for k, dz in enumerate((-0.07, 0.07)):
        pts = hoop_path(TORSO, BELT_Z + dz, 0.1 + 0.02 * k, 14)
        v, f = sweep(pts, 0.075, 4, closed=True, tag="belt%d" % k, phase=0.2 * k)
        body.add((v, f), MAT_ROPE, smooth_paint(mix(ROPE, ROPE_SHADE, 0.5)))
    q, nn = TORSO.at(0.0, BELT_Z)
    fr = frame_at(q + nn * 0.2, nn, (1, 0, 0))
    body.add(cbox(0.56, 0.52, 0.14, 0.04), MAT_WOOD, painter(WOOD_PLANK, grad=0.2, tag="buckle", light=WOOD_CARVED), fr)
    sq = [fr @ Vector(p) for p in ((-0.3, -0.28, 0.1), (0.3, -0.28, 0.1), (0.3, 0.28, 0.1), (-0.3, 0.28, 0.1))]
    v, f = sweep(sq, 0.045, 4, closed=True, tag="bucklering", phase=math.pi / 4)
    body.add((v, f), MAT_IRON, flat(IRON, 0.06, "bucklering"))
    rivet(body, fr @ Vector((0.0, 0.0, 0.07)), nn, "bucklepin", r=0.1, h=0.06)
    # straw bursting out between the slats at the hoops
    for k, (th, z) in enumerate(((0.0, 4.0), (0.85, 3.06), (-0.85, 3.06), (1.66, 4.0), (-1.66, 4.0), (2.6, 3.06))):
        q, nn = TORSO.at(th, z + 0.12)
        tuft(body, q, (nn + Vector((0.0, 0.0, 0.35))).normalized(), 3, 0.26, "burst%d" % k, spread=0.6, base_r=0.04)
    # the straw skirt hanging out under the belt
    for i in range(14):
        th = TAU * (i + 0.3 * h01("skirt", i)) / 14
        q, nn = TORSO.at(th, 2.44)
        d = (nn * 0.35 + Vector((0.0, 0.0, -1.0))).normalized()
        tuft(body, q - nn * 0.04, d, 3, 0.42, "skirt%d" % i, spread=0.35, base_r=0.045)
    # the shoulder yoke across the top (straw-packed), the back crossbar the props bear on
    log(body, (-2.12, 0.14, SHOULDER_Z + 0.05), (2.12, 0.14, SHOULDER_Z + 0.05), 0.24, "yoke", n=8, base=WOOD_MID)
    for s in (-1, 1):
        path = lerp_path((s * 0.62, 0.22, SHOULDER_Z - 0.02), (s * 1.78, 0.16, SHOULDER_Z + 0.02), 4)
        straw_bundle(body, path, [0.5, 0.6, 0.58, 0.5], "trap%d" % s, n=12, shade=1.02)
        lash_ring(body, (s * 1.25, 0.2, SHOULDER_Z), (1, 0, 0), 0.56, "trapl%d" % s, turns=1, width=0.13, sides=10)
    log(body, (-0.95, 1.33, 3.95), (0.95, 1.33, 3.95), 0.15, "backbar", base=WOOD_DARK)
    for s in (-1, 1):
        lash_ring(body, (s * 0.62, 1.33, 3.95), (1, 0, 0), 0.15, "bbl%d" % s, turns=2, width=0.1)


def build_props(body):
    """The two back props that make it stand, on stone footings."""
    for s in (-1, 1):
        tag = "prop%d" % s
        top = Vector((s * 0.62, 1.38, 4.0))
        foot = Vector((s * 1.2, 2.62, 0.02))
        v, f = sweep(lerp_path(foot, top, 3), 0.16, 7, jitter=0.05, tag=tag)
        body.add((v, f), MAT_WOOD, log_paint(WOOD_WARM, top - foot, tag, n=7))
        lash_ring(body, top.lerp(foot, 0.08), top - foot, 0.16, tag + "l", turns=2, width=0.1)
        body.add(rock(0.36, tag + "fs"), MAT_ROCK, painter(STONE, grad=0.35, mottle=0.12, tag=tag + "fs", light=STONE_LIGHT), T(foot.x + s * 0.12, foot.y + 0.14, 0.0))
        body.add(rock(0.22, tag + "fs2", detail=0), MAT_ROCK, painter(STONE, grad=0.35, mottle=0.12, tag=tag + "fs2", light=STONE_LIGHT), T(foot.x - s * 0.28, foot.y - 0.12, 0.0))


def arm_points(s):
    shoulder = Vector((s * 1.98, 0.16, SHOULDER_Z))
    elbow = Vector((s * 2.3, 0.22, 3.3))
    wrist = Vector((s * 2.32, -0.26, 2.42))
    fist = Vector((s * 2.34, -0.4, 1.92))
    return shoulder, elbow, wrist, fist


def build_arms(body):
    for s in (-1, 1):
        tag = "arm%d" % s
        sh, el, wr, fi = arm_points(s)
        log(body, sh + Vector((-s * 0.1, 0, 0.05)), el, 0.19, tag + "ub", base=WOOD_MID)
        log(body, el, fi + Vector((0, 0.05, 0.25)), 0.18, tag + "fb", base=WOOD_MID)
        straw_bundle(body, lerp_path(sh + (el - sh) * 0.02, el + (el - sh).normalized() * 0.1, 4), [0.46, 0.52, 0.48, 0.38], tag + "us", tuft1=(6, 0.3))
        straw_bundle(body, lerp_path(el - (wr - el).normalized() * 0.05, wr, 4), [0.36, 0.45, 0.44, 0.38], tag + "fs", tuft1=(7, 0.3))
        lash_ring(body, el + (el - sh).normalized() * 0.02, el - sh, 0.42, tag + "el", turns=2, width=0.12, sides=10)
        lash_ring(body, sh + (el - sh) * 0.5, el - sh, 0.5, tag + "ul", turns=1, width=0.13, sides=10)
        # the iron bracer (Balgath's own), riveted
        d = (wr - el).normalized()
        bc = el + (wr - el) * 0.62
        m = Matrix.Translation(bc) @ align_z(d)
        v, f = prism(12, 0.5, 0.49, 0.36, -0.18, False, False)
        body.add((v, f), MAT_IRON, flat(IRON, 0.07, tag + "br"), m)
        for rz in (-0.2, 0.2):
            v, f = prism(12, 0.53, 0.53, 0.05, rz - 0.025, False, False)
            body.add((v, f), MAT_IRON, flat(IRON_LIGHT, 0.05, tag + "brl%.1f" % rz), m)
        for k in range(4):
            a = TAU * k / 4 + 0.5
            p = m @ Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 0.0))
            rivet(body, p, (p - bc), tag + "brr%d" % k, r=0.07, h=0.045)
        # the fist: a stuffed straw sack tied with rope, blunt wooden knuckles
        sv, sf = sack_shape(0.9, 0.84, 0.86, tag + "fist", nu=10, nv=6)
        body.add((sv, sf), MAT_STRAW, straw_column_paint(10, tag + "fist", 0.98), T(fi.x, fi.y, fi.z) @ RZ(s * 0.12))
        loop = [fi + Vector((math.sin(a) * 0.47, -math.cos(a) * 0.44, 0.14 + 0.03 * math.sin(2 * a))) for a in [TAU * i / 10 for i in range(10)]]
        v, f = sweep(loop, 0.05, 4, closed=True, tag=tag + "ft")
        body.add((v, f), MAT_ROPE, flat(ROPE, 0.08, tag + "ft"))
        for k, dx in enumerate((-0.27, -0.09, 0.09, 0.27)):
            p0 = fi + Vector((dx, -0.26, -0.06 + 0.03 * hs(tag, k)))
            p1 = p0 + Vector((0.0, -0.2, 0.02))
            stub(body, p0, p1, 0.1, tag + "kn%d" % k, n=5, tip=0.045)
        p0 = fi + Vector((-s * 0.36, -0.14, 0.05))
        p1 = p0 + Vector((-s * 0.08, -0.28, 0.08))
        stub(body, p0, p1, 0.1, tag + "th", n=5, tip=0.05)
        # shoulder end: the yoke's lashing and a straw tuft under the pauldron
        lash_ring(body, sh + Vector((-s * 0.12, 0, 0.08)), (1, 0, 0), 0.24, tag + "sl", turns=2, width=0.11)
        tuft(body, sh + Vector((s * 0.2, 0.3, -0.1)), (s * 0.5, 0.6, 0.2), 5, 0.32, tag + "st")


def build_head(body):
    n = 16
    levels = [HEAD_BASE, 4.45, 4.75, 5.05, FLAME_Z, 5.67, 5.92, HEAD_TOP]
    verts = []
    for z in levels:
        r = head_r(z)
        for i in range(n):
            a = -math.pi / 2 + TAU * (i + 0.5) / n
            verts.append((math.cos(a) * r, HEAD_CY + math.sin(a) * r, z))
    faces = []
    refs = []
    for li in range(len(levels) - 1):
        ref = Vector((0.0, HEAD_CY, (levels[li] + levels[li + 1]) / 2.0))
        for i in range(n):
            faces.append([li * n + i, li * n + (i + 1) % n, (li + 1) * n + (i + 1) % n, (li + 1) * n + i])
            refs.append(ref)
    faces.append(list(range(n)))
    refs.append(Vector((0.0, HEAD_CY, HEAD_BASE + 0.5)))
    def stave(p, nrm, fi, zmin, zmax, fc=None):
        # one tone per stave, shaded by height only, so a stave's faces share corners
        col = fi[1] % n
        c = WOOD_PLANK if col % 2 == 0 else WOOD_WARM
        c = mix(c, WOOD_MID, 0.4 * h01("stave", col))
        t = (p[2] - HEAD_BASE) / (HEAD_TOP - HEAD_BASE)
        return mul(c, 0.78 + 0.26 * smooth(0.0, 0.4, t) - 0.08 * smooth(0.8, 1.0, t))

    body.add((verts, orient_refs(verts, faces, refs)), MAT_WOOD, stave)
    # the iron hoop round the jaw
    z0, z1 = HEAD_BASE + 0.02, HEAD_BASE + 0.19
    hv = []
    for z, dr in ((z0, 0.035), (z1, 0.035), (z0, -0.01), (z1, -0.01)):
        r = head_r(z) + dr
        for i in range(n):
            a = -math.pi / 2 + TAU * (i + 0.5) / n
            hv.append((math.cos(a) * r, HEAD_CY + math.sin(a) * r, z))
    hf = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    hf += [[2 * n + i, 2 * n + (i + 1) % n, (i + 1) % n, i] for i in range(n)]
    hf += [[n + i, n + (i + 1) % n, 3 * n + (i + 1) % n, 3 * n + i] for i in range(n)]
    ref = Vector((0.0, HEAD_CY, (z0 + z1) / 2.0))
    body.add((hv, orient_refs(hv, hf, [ref] * len(hf))), MAT_IRON, flat(IRON, 0.06, "jawhoop"))
    for k in range(6):
        a = -math.pi / 2 + TAU * (k + 0.25) / 6
        q, nn = CASK.project((math.cos(a) * 3.0, HEAD_CY + math.sin(a) * 3.0, (z0 + z1) / 2.0))
        rivet(body, q + nn * 0.035, nn, "jawn%d" % k, r=0.055, h=0.04)
    # the straw thatch skull: a round dome continuing the cask, bound with rope
    dn = 16
    rt = head_r(HEAD_TOP)
    dv = []
    rings = [(HEAD_TOP - 0.1, rt + 0.035), (HEAD_TOP + 0.1, rt * 0.98), (HEAD_TOP + 0.24, rt * 0.86), (HEAD_TOP + 0.34, rt * 0.64), (HEAD_TOP + 0.4, rt * 0.34)]
    for li, (z, r) in enumerate(rings):
        for i in range(dn):
            a = TAU * (i + 0.5) / dn
            j = 1.0 + 0.045 * hs("dome", li, i)
            dv.append((math.cos(a) * r * j, HEAD_CY + math.sin(a) * r * j, z + 0.02 * hs("domez", li, i)))
    df = []
    for li in range(len(rings) - 1):
        for i in range(dn):
            df.append([li * dn + i, li * dn + (i + 1) % dn, (li + 1) * dn + (i + 1) % dn, (li + 1) * dn + i])
    apex = len(dv)
    dv.append((0.0, HEAD_CY, HEAD_TOP + 0.42))
    last = (len(rings) - 1) * dn
    for i in range(dn):
        df.append([last + i, last + (i + 1) % dn, apex])
    dref = Vector((0.0, HEAD_CY, HEAD_TOP - 0.4))

    def dome_ao(p):
        return 1.0 - 0.25 * smooth(HEAD_TOP + 0.02, HEAD_TOP - 0.1, p[2])

    body.add((dv, orient_refs(dv, df, [dref] * len(df))), MAT_STRAW, straw_column_paint(dn, "dome", 1.05, dome_ao))
    pts = [(math.cos(TAU * i / 16) * (rt + 0.06), HEAD_CY + math.sin(TAU * i / 16) * (rt + 0.06), HEAD_TOP - 0.02) for i in range(16)]
    v, f = sweep(pts, 0.055, 4, closed=True, tag="domerope", phase=0.4)
    body.add((v, f), MAT_ROPE, smooth_paint(ROPE))
    for i in range(16):
        a = TAU * (i + 0.4 * h01("fringe", i)) / 16
        if -2.1 < math.atan2(math.sin(a), math.cos(a)) < -1.05:
            continue  # the brow owns the front of the rim
        p = Vector((math.cos(a) * (rt + 0.03), HEAD_CY + math.sin(a) * (rt + 0.03), HEAD_TOP - 0.08))
        d = Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -1.0))
        tuft(body, p, d, 2, 0.24, "fringe%d" % i, spread=0.25, base_r=0.045)
    # the topknot: a tied sheaf standing out of the crown
    straw_bundle(body, [(0.0, HEAD_CY + 0.05, HEAD_TOP + 0.32), (0.02, HEAD_CY + 0.07, HEAD_TOP + 0.42), (0.03, HEAD_CY + 0.08, HEAD_TOP + 0.47)], [0.16, 0.12, 0.15], "knot", n=7, tuft1=(6, 0.12))
    lash_ring(body, (0.02, HEAD_CY + 0.07, HEAD_TOP + 0.42), (0, 0, 1), 0.11, "knotl", turns=1, width=0.06, sides=7)
    # the ruff of straw where the head meets the shoulders
    for i in range(10):
        a = TAU * (i + 0.5 * h01("ruff", i)) / 10
        p = Vector((math.cos(a) * (HEAD_R_END - 0.05), HEAD_CY + math.sin(a) * (HEAD_R_END - 0.05), HEAD_BASE + 0.02))
        d = Vector((math.cos(a), math.sin(a), 0.2))
        tuft(body, p, d, 3, 0.36, "ruff%d" % i, spread=0.5, base_r=0.05)
    # the eye socket: a dark sunken disc, a sooty funnel, a rope-bound withy hoop
    eye_q, eye_n = CASK.project((0.0, -3.0, FLAME_Z))
    fr = frame_at(eye_q, eye_n, (1, 0, 0))
    body.add(conformed_disc(CASK, eye_q, eye_n, 0.0, EYE_R + 0.02, 12, 0.012), MAT_WOOD, flat(SOCKET, 0.05, "socket"))
    fv = []
    for i in range(12):
        a = TAU * i / 12
        for r, off in ((EYE_R + 0.02, 0.012), (EYE_R + 0.06, 0.1)):
            qq, nn = CASK.project(fr @ Vector((math.cos(a) * r, math.sin(a) * r, 0.0)))
            fv.append(tuple(qq + nn * off))
    ff = [[2 * i, 2 * ((i + 1) % 12), 2 * ((i + 1) % 12) + 1, 2 * i + 1] for i in range(12)]
    body.add((fv, orient_refs(fv, ff, [eye_q + eye_n * 0.6] * len(ff))), MAT_WOOD, flat(mix(SOCKET, WOOD_DARK, 0.45), 0.05, "funnel"))
    ring_pts = []
    for i in range(12):
        a = TAU * i / 12
        qq, nn = CASK.project(fr @ Vector((math.cos(a) * (EYE_R + 0.1), math.sin(a) * (EYE_R + 0.1), 0.0)))
        ring_pts.append(qq + nn * 0.09)
    v, f = sweep(ring_pts, 0.085, 5, closed=True, tag="eyering", jitter=0.05)
    body.add((v, f), MAT_WOOD, painter(WOOD_DARK, grad=0.2, tag="eyering", light=WOOD_MID))
    for k in range(3):
        i0 = (4 * k + 1) % 12
        p0, p1 = ring_pts[i0], ring_pts[(i0 + 1) % 12]
        lash_ring(body, (p0 + p1) / 2.0, p1 - p0, 0.058, "eyelash%d" % k, turns=2, width=0.055, sides=6)
    # the painted target round it (a red ring and three ticks) and the pike misses
    body.add(conformed_disc(CASK, eye_q, eye_n, EYE_R + 0.25, EYE_R + 0.34, 18, 0.008), MAT_WOOD, flat(CLOTH_RED, 0.08, "target"))
    for k, a in enumerate((0.0, math.pi, -math.pi / 2)):
        cp = fr @ Vector((math.cos(a) * (EYE_R + 0.43), math.sin(a) * (EYE_R + 0.43), 0.0))
        ex = fr.col[0].xyz * math.cos(a) + fr.col[1].xyz * math.sin(a)
        ey = fr.col[0].xyz * -math.sin(a) + fr.col[1].xyz * math.cos(a)
        quad = []
        for du, dv in ((-0.09, -0.045), (0.12, -0.045), (0.12, 0.045), (-0.09, 0.045)):
            qq, nn = CASK.project(cp + ex * du + ey * dv)
            quad.append(tuple(qq + nn * 0.008))
        body.add((quad, orient_refs(quad, [[0, 1, 2, 3]], [eye_q - eye_n])), MAT_WOOD, flat(CLOTH_RED, 0.05, "tick%d" % k))
    for k, (dx, dz, r) in enumerate(((0.8, 0.36, 0.07), (-0.86, -0.22, 0.06), (0.58, -0.5, 0.065), (-0.74, 0.34, 0.055))):
        cq = cask_at(dx, FLAME_Z + dz)
        # a punched hole: a dark core, a thin ring of splintered pale wood
        body.add(conformed_disc(CASK, cq, None, 0.0, r, 7, 0.012), MAT_WOOD, flat(SOCKET, 0.05, "miss%d" % k))
        body.add(conformed_disc(CASK, cq, None, r, r + 0.028, 7, 0.012), MAT_WOOD, flat(mix(WOOD_CARVED, WOOD_WARM, 0.45), 0.08, "missrim%d" % k))
    # the brow: two thick planks bent round the cask into a scowl, sooted
    for s in (-1, 1):
        conformed_brow(body, cask_at(s * 0.35, FLAME_Z + 0.55), s)
    # the mouth: a sooted frown with rope stitches across it
    mpts = []
    for i in range(7):
        u = -0.46 + 0.92 * i / 6
        z = 4.62 - 0.08 * (u / 0.46) ** 2
        mpts.append(cask_at(u, z))
    mv = []
    for p in mpts:
        for dz in (-0.04, 0.04):
            qq, nn = CASK.project(p + Vector((0.0, 0.0, dz)))
            mv.append(tuple(qq + nn * 0.009))
    mf = [[2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1] for i in range(len(mpts) - 1)]
    body.add((mv, orient_refs(mv, mf, [Vector((0.0, HEAD_CY, 4.6))] * len(mf))), MAT_WOOD, flat(SOOT, 0.08, "mouth"))
    for i in range(1, 6):
        p = CASK.project(mpts[i])[0]
        qa, na = CASK.project(p + Vector((0.025, 0.0, 0.08)))
        qb, nb = CASK.project(p + Vector((-0.025, 0.0, -0.08)))
        v, f = sweep([qa + na * 0.02, p + (na + nb).normalized() * 0.035, qb + nb * 0.02], 0.028, 4, tag="stitch%d" % i)
        body.add((v, f), MAT_ROPE, flat(ROPE, 0.08, "stitch%d" % i))
    # chalked tally of the drill's hits on the left cheek
    for k in range(5):
        if k < 4:
            a0 = cask_at(0.86 + 0.09 * k, 4.62)
            a1 = cask_at(0.86 + 0.09 * k + 0.02, 4.9)
        else:
            a0 = cask_at(0.82, 4.66)
            a1 = cask_at(1.22, 4.86)
        d = (a1 - a0).normalized()
        side = Vector((-d.z, 0.0, d.x)) * 0.022
        quad = []
        for c in (a0 - side, a1 - side, a1 + side, a0 + side):
            qq, nn = CASK.project(c)
            quad.append(tuple(qq + nn * 0.009))
        body.add((quad, orient_refs(quad, [[0, 1, 2, 3]], [Vector((0.0, HEAD_CY, 4.85))])), MAT_WOOD, flat(LIME_LIGHT, 0.05, "tally%d" % k))
    # plank ears nailed on the sides
    for s in (-1, 1):
        q, nn = CASK.project((s * 3.0, HEAD_CY + 0.05, FLAME_Z + 0.1))
        m = Matrix.Translation(q + nn * 0.12) @ RZ(math.atan2(nn.y, nn.x)) @ RZ(s * -0.35) @ RY(-0.2)
        body.add(cbox(0.3, 0.13, 0.46, 0.045), MAT_WOOD, painter(WOOD_WARM, grad=0.3, tag="ear%d" % s, light=WOOD_CARVED), m)
        rivet(body, m @ Vector((-0.02, -0.07, 0.1)), m.to_3x3() @ Vector((0, -1, 0)), "earn%d" % s, r=0.045)
    # a split stave on the back of the head, patched with a nailed board
    q, nn = CASK.project(cask_at(-math.pi * 1.06 + 0.35, 5.05))
    m = frame_at(q + nn * 0.05, nn, (0.2, 0.0, 1.0))
    body.add(cbox(0.62, 0.36, 0.08, 0.03), MAT_WOOD, painter(WOOD_PLANK, grad=0.2, tag="patch", light=WOOD_CARVED), m)
    for e in (-0.22, 0.22):
        rivet(body, m @ Vector((e, 0.0, 0.04)), nn, "patchn%.2f" % e, r=0.05)
    return eye_q, eye_n


def conformed_brow(body, mid, s):
    q, n = CASK.project(mid)
    t = Vector((1.0, 0.0, 0.0))
    t = (t - n * t.dot(n)).normalized()
    b = n.cross(t)
    ang = s * 0.3
    tt = (t * math.cos(ang) + b * math.sin(ang)).normalized()
    bb = n.cross(tt)
    length, width, thick = 0.74, 0.26, 0.22
    segs = 3
    profile = [(-width / 2, 0.0), (width / 2, 0.0), (width / 2, thick * 0.6), (width * 0.3, thick), (-width * 0.3, thick), (-width / 2, thick * 0.6)]
    verts = []
    centres = []
    for i in range(segs + 1):
        u = -length / 2 + length * i / segs
        for v, w in profile:
            qq, nn = CASK.project(q + tt * u + bb * v)
            verts.append(tuple(qq + nn * (0.05 + w)))
        qq, nn = CASK.project(q + tt * u)
        centres.append(qq + nn * (0.05 + thick / 2))
    k = len(profile)
    faces = []
    refs = []
    cols = []
    for i in range(segs):
        for j in range(k):
            faces.append([i * k + j, i * k + (j + 1) % k, (i + 1) * k + (j + 1) % k, (i + 1) * k + j])
            refs.append((centres[i] + centres[i + 1]) / 2)
            cols.append(mul(SOOT, 1.0 + 0.15 * hs("brow", s, i, j)) if j in (3, 4) else mul(WOOD_DARK, 1.0 + 0.08 * hs("browb", s, i, j)))
    faces.append(list(range(k)))
    refs.append(centres[0].lerp(centres[1], 0.3))
    cols.append(WOOD_ENDGRAIN)
    faces.append([segs * k + j for j in range(k)])
    refs.append(centres[segs].lerp(centres[segs - 1], 0.3))
    cols.append(WOOD_ENDGRAIN)
    body.add((verts, orient_refs(verts, faces, refs)), MAT_WOOD, cols)
    for e in (-0.2, 0.24):
        qq, nn = CASK.project(q + tt * e)
        rivet(body, qq + nn * (0.05 + thick - 0.01), nn, "brown%d%.1f" % (s, e), r=0.06, h=0.045)


def build_story(body):
    """Camp colour and practice scars: a red armband and belt rag, arrows and a
    snapped pike stuck in the straw, pike holes through the belly."""
    sh, el, wr, fi = arm_points(1)
    c = sh.lerp(el, 0.3)
    d = (el - sh).normalized()
    m = Matrix.Translation(c) @ align_z(d)
    v, f = prism(12, 0.555, 0.545, 0.2, -0.1, False, False, jitter=0.03, tag="band")
    body.add((v, f), MAT_CLOTH, painter(CLOTH_RED, grad=0.2, mottle=0.1, tag="band"), m)
    for k, (dx, rot) in enumerate(((0.08, 0.25), (-0.1, -0.2))):
        body.add(cloth(0.2, 0.62 - 0.12 * k, 1, 3, "bandtail%d" % k, teeth=0.1, wave=0.04), MAT_CLOTH, painter(CLOTH_RED if k == 0 else CLOTH_RED_DARK, grad=0.3, tag="bandtail%d" % k), m @ T(0.55, dx - 0.35, 0.02) @ RZ(math.pi / 2 + rot) @ RY(-0.1))
    # a torn red rag hanging from the belt on the right hip
    q, nn = TORSO.at(-1.0, BELT_Z)
    yaw = math.atan2(nn.y, nn.x) + math.pi / 2
    body.add(cloth(0.62, 0.95, 3, 3, "beltrag", teeth=0.22, wave=0.07), MAT_CLOTH, painter(CLOTH_RED, grad=0.35, tag="beltrag"), T(q.x + nn.x * 0.2, q.y + nn.y * 0.2, BELT_Z) @ RZ(yaw))
    # arrows in the straw
    for k, (th, z, tilt) in enumerate(((0.95, 3.35, (0.2, 0.1)), (-2.5, 3.9, (-0.1, -0.25)), (1.9, 2.95, (0.15, -0.2)))):
        q, nn = TORSO.at(th, z)
        d = (-nn + Vector((tilt[0], tilt[1], -0.25))).normalized()
        tail = q - d * 0.72
        v, f = sweep([q + d * 0.1, tail], 0.025, 4, tag="arrow%d" % k)
        body.add((v, f), MAT_WOOD, flat(WOOD_CARVED, 0.05, "arrow%d" % k))
        a = align_z(-d)
        for j in range(2):
            fl = [(0.0, 0.0, 0.0), (0.0, 0.0, 0.22), (0.07, 0.0, 0.16), (0.07, 0.0, 0.02)]
            fl2 = [(p[0], p[1] + 0.01, p[2]) for p in fl]
            gv = fl + fl2
            gf = [[0, 1, 2, 3], [7, 6, 5, 4]]
            mm = Matrix.Translation(tail) @ a @ RZ(j * math.pi / 2 + 0.3) @ T(0.0, 0.0, -0.2)
            body.add((gv, gf), MAT_CLOTH, flat(CLOTH_CREAM if k != 1 else CLOTH_RED, 0.06, "fletch%d%d" % (k, j)), mm)
    # a snapped pike shaft stuck in the right shoulder, splintered
    q, nn = TORSO.at(-0.9, 4.3)
    d = (-nn + Vector((0.2, 0.3, -0.35))).normalized()
    butt = q - d * 1.05
    v, f = sweep([q + d * 0.15, q.lerp(butt, 0.5), butt], 0.05, 6, tip1=0.12, tag="pike")
    body.add((v, f), MAT_WOOD, painter(WOOD_MID, top=WOOD_CARVED, top_from=max(p[2] for p in v) - 0.13, tag="pike"))
    # pike holes punched through the belly straw
    for k, (th, z) in enumerate(((0.25, 2.95), (-0.55, 3.55), (0.7, 3.95), (-0.15, 3.25), (2.6, 3.3))):
        q, nn = TORSO.at(th, z)
        body.add(conformed_disc(TORSO, q, nn, 0.0, 0.075, 6, 0.02), MAT_STRAW, flat(SOCKET, 0.06, "hole%d" % k))
        tuft(body, q + nn * 0.02, nn, 3, 0.16, "holetuft%d" % k, spread=0.9, base_r=0.025)


def plank_groups():
    """Plank groups: (kind, surface, planks as (hint point, tangent hint, length,
    width, standoff, twist)). Each group becomes one Plank_NN node."""
    E = TORSO

    def around(th):
        return Vector((math.cos(th), math.sin(th), 0.0))

    def at(th, z):
        return Vector((TORSO.c.x + math.sin(th) * 4.0, TORSO.c.y - math.cos(th) * 4.0, z))

    groups = []
    for s in (-1, 1):  # chest plates
        groups.append(("chest", E, [
            (at(s * 0.46, 4.22), around(s * 0.46), 1.12, 0.36, 0.13, s * -0.2),
            (at(s * 0.48, 3.96), around(s * 0.48), 1.04, 0.34, 0.09, s * -0.12),
        ]))
    groups.append(("belly", E, [
        (at(0.0, 3.7), around(0.0), 1.36, 0.33, 0.12, 0.04),
        (at(0.02, 3.42), around(0.02), 1.32, 0.33, 0.08, -0.05),
    ]))
    groups.append(("belly", E, [
        (at(0.0, 3.2), around(0.0), 1.3, 0.31, 0.13, -0.03),
        (at(-0.02, 2.92), around(-0.02), 1.2, 0.31, 0.09, 0.06),
    ]))
    for s in (-1, 1):  # flank plates, near vertical
        groups.append(("flank", E, [
            (at(s * 1.12, 3.5), around(s * 1.12), 0.92, 0.3, 0.08, s * 1.45),
            (at(s * 1.42, 3.45), around(s * 1.42), 0.86, 0.3, 0.12, s * 1.62),
        ]))
    for s in (-1, 1):  # layered pauldrons over the shoulder ends
        sh, el, wr, fi = arm_points(s)
        sph = Sphere(Vector((s * 1.86, 0.18, SHOULDER_Z - 0.1)), 0.62)
        c = sph.c
        pl = []
        for k, (dy, ln, so) in enumerate(((-0.62, 0.94, 0.03), (0.62, 0.94, 0.03), (0.0, 1.02, 0.08))):
            hint = c + Vector((s * 0.75, dy, 0.78)) * 3.0
            pl.append((hint, Vector((s * 0.72, 0.0, -0.7)), ln, 0.42, so, 0.0))
        groups.append(("pauldron", sph, pl))
    for s in (-1, 1):  # thigh plates
        x = s * LEG_X
        cyl = Cylinder((x + s * 0.02, 0.06, 1.2), (x, 0.08, HIP_Z), 0.58, 0.66)
        groups.append(("thigh", cyl, [
            (Vector((x - 0.22, -3.0, 1.88)), Vector((0.0, 0.0, 1.0)), 0.96, 0.3, 0.03, s * 0.06),
            (Vector((x + 0.2, -3.0, 1.84)), Vector((0.0, 0.0, 1.0)), 0.9, 0.3, 0.07, -s * 0.05),
        ]))
    for s in (-1, 1):  # upper arm plates (outer face)
        sh, el, wr, fi = arm_points(s)
        cyl = Cylinder(sh, el, 0.53, 0.5)
        d = (el - sh).normalized()
        mid = sh.lerp(el, 0.62)
        groups.append(("arm", cyl, [
            (mid + Vector((s * 3.0, -1.4, 0.0)), d, 0.66, 0.3, 0.04, 0.0),
            (mid + Vector((s * 3.0, 0.9, 0.0)), d, 0.62, 0.28, 0.08, 0.0),
        ]))
    for s in (-1, 1):  # lower back plates
        groups.append(("back", E, [
            (at(math.pi - s * 0.5, 3.4), around(math.pi - s * 0.5), 1.0, 0.32, 0.12, s * 0.1),
            (at(math.pi - s * 0.55, 3.12), around(math.pi - s * 0.55), 0.94, 0.3, 0.08, -s * 0.06),
        ]))
    return groups


def build_planks():
    parts = []
    for gi, (kind, surf, planks) in enumerate(plank_groups()):
        pc = Part("Plank_%02d" % gi)
        pc.kind = kind
        for pi, (hint, tang, ln, wd, so, tw) in enumerate(planks):
            conformed_plank(pc, surf, hint, tang, ln, wd, 0.1, so, "pk%d_%d" % (gi, pi), twist=tw)
        parts.append(pc)
    return parts


def build_lantern(eye_q, eye_n):
    """The iron lantern seated in the eye socket; returns (housing, glass, flame)."""
    flame = eye_q + eye_n * 0.16
    flame.z = FLAME_Z
    lan = Part("Lantern")
    gl = Part("LanternGlass")
    at = T(flame.x, flame.y, flame.z)
    gv, gf = prism(6, 0.19, 0.19, 0.36, -0.18, True, True, phase=math.pi / 6)

    def glass_paint(p, nrm, fi, zmin, zmax, fc=None):
        t = abs(p[2]) / 0.18
        return mix(GLASS_HOT, GLOW, min(1.0, t * 0.8))

    gl.add((gv, gf), MAT_GLASS, glass_paint, at)
    iron = flat(IRON, 0.07, "lantern")
    iron_l = flat(IRON_LIGHT, 0.05, "lanternl")
    ph = math.pi / 6
    lan.add(prism(6, 0.25, 0.25, 0.05, -0.23, True, True, phase=ph), MAT_IRON, iron, at)
    lan.add(prism(6, 0.17, 0.22, 0.05, -0.28, True, False, phase=ph), MAT_IRON, iron, at)
    lan.add(prism(6, 0.26, 0.26, 0.05, 0.18, True, True, phase=ph), MAT_IRON, iron_l, at)
    lan.add(prism(6, 0.23, 0.1, 0.12, 0.23, False, False, phase=ph), MAT_IRON, iron, at)
    lan.add(prism(6, 0.075, 0.075, 0.07, 0.35, False, False, phase=ph), MAT_IRON, iron, at)
    lan.add(prism(6, 0.11, 0.11, 0.03, 0.42, True, True, phase=ph), MAT_IRON, iron_l, at)
    hp = [Vector((0.0, math.cos(TAU * i / 8) * 0.07, 0.52 + math.sin(TAU * i / 8) * 0.07)) for i in range(8)]
    v, f = sweep(hp, 0.022, 4, closed=True, tag="lanhandle")
    lan.add((v, f), MAT_IRON, iron, at)
    for i in range(6):
        a = TAU * i / 6
        p0 = Vector((math.cos(a) * 0.215, math.sin(a) * 0.215, -0.19))
        p1 = Vector((math.cos(a) * 0.215, math.sin(a) * 0.215, 0.19))
        v, f = sweep([p0, p1], 0.03, 4, tag="lanbar%d" % i, phase=a + math.pi / 4)
        lan.add((v, f), MAT_IRON, iron, at)
    band = [Vector((math.cos(TAU * i / 6) * 0.21, math.sin(TAU * i / 6) * 0.21, 0.0)) for i in range(6)]
    v, f = sweep(band, 0.022, 4, closed=True, tag="lanband", phase=math.pi / 4)
    lan.add((v, f), MAT_IRON, iron_l, at)
    # two iron straps pinning it into the socket, nailed to the cask
    for s in (-1, 1):
        p0 = Vector((flame.x + s * 0.22, flame.y + 0.03, FLAME_Z + 0.1))
        qq, nn = CASK.project(cask_at(s * (EYE_R + 0.26), FLAME_Z + 0.14))
        p1 = qq + nn * 0.04
        v, f = sweep([p0, p0.lerp(p1, 0.5) + nn * 0.1, p1], 0.035, 4, tag="lanstrap%d" % s, squash=0.5)
        lan.add((v, f), MAT_IRON, iron, None)
        rivet(lan, p1 + nn * 0.02, nn, "lanstrapn%d" % s, r=0.06)
    return lan, gl, flame


SECTIONS = []


def build_effigy():
    body = Part("EffigyBody")
    SECTIONS.clear()

    def run(name, fn, *args):
        before = body.triangles()
        out = fn(body, *args)
        SECTIONS.append((name, body.triangles() - before))
        return out

    run("legs", build_legs)
    run("torso", torso_core)
    run("frame", torso_frame)
    run("props", build_props)
    run("arms", build_arms)
    eye_q, eye_n = run("head", build_head)
    run("story", build_story)
    # nothing sinks through the ground: slanted log ends are cut flat at z 0
    body.verts = [Vector((v.x, v.y, max(0.0, v.z))) for v in body.verts]
    planks = build_planks()
    lantern, glass, flame = build_lantern(eye_q, eye_n)
    parts = [body] + planks + [lantern, glass]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for pc in parts:
        a, b = pc.bounds()
        lo = Vector((min(lo.x, a.x), min(lo.y, a.y), min(lo.z, a.z)))
        hi = Vector((max(hi.x, b.x), max(hi.y, b.y), max(hi.z, b.z)))
    # floor-seat and centre the footprint
    off = Vector(((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0, lo.z))
    for pc in parts:
        pc.offset(off)
    return {"body": body, "planks": planks, "lantern": lantern, "glass": glass, "flame": flame - off, "size": hi - lo}


# ---------------------------------------------------------------------------
# the stake mallet (KayKit axe_2handed grip frame)
# ---------------------------------------------------------------------------

# The KayKit two-handed axe (public/models/weapons/axe_2handed.glb) is one mesh node
# whose world bounds run from the butt at y -0.4330 to the head at y 1.2916 (glTF),
# centred on the handle axis, its blades along +-X. Meshopt quantization turns those
# bounds into the node's translation (0, 0.4293, 0) and uniform scale 0.8623; the
# runtime (flattenWeaponScene + the `2H_Axe` hand grip) zeroes that translation and
# keeps the scale, so a weapon lands in the hand exactly where the axe does when its
# world bounds match. The mallet is built in rough units, then uniformly scaled and
# shifted so its handle axis is y (Blender z), its butt and crown land on the axe's
# butt and crown, and it is mirror-symmetric about the handle, the striking faces
# along +-X where the axe's blades are.
AXE_BUTT_Y = -0.4330
AXE_CROWN_Y = 1.2916


def build_mallet():
    pc = Part("MusterMallet")
    # the handle: tapered, swelled at the butt
    hp = [Vector((0.0, 0.0, z)) for z in (-0.96, -0.9, -0.6, -0.1, 0.4, 0.72)]
    radii = [0.08, 0.086, 0.076, 0.071, 0.067, 0.066]
    v, f = sweep(hp, radii, 8, jitter=0.03, tag="mhandle", cap0=False)
    pc.add((v, f), MAT_WOOD, log_paint(WOOD_WARM, (0, 0, 1), "mhandle", grad=0.25))
    # a cord grip, wound tight (alternating swell and pinch reads as turns)
    wz = [-0.86 + 0.07 * i for i in range(7)]
    wr = [0.089 if i % 2 else 0.095 for i in range(7)]
    v, f = sweep([Vector((0.0, 0.0, z)) for z in wz], wr, 8, tag="mwrap", phase=0.2)

    def wrap_paint(p, nrm, fi, zmin, zmax, fc=None):
        band = fi[1] // 8
        return mul(ROPE if band % 2 == 0 else ROPE_SHADE, 1.0 + 0.06 * hs("mwrap", fi))

    pc.add((v, f), MAT_ROPE, wrap_paint)
    # the head: a banded oak drum across the handle, mushroomed striking faces
    hz = 0.72
    hr = 0.28
    half = 0.49
    xs = [(-half, hr * 0.88), (-half + 0.05, hr * 1.05), (-half + 0.15, hr), (-0.12, hr * 1.02), (0.12, hr * 1.02), (half - 0.15, hr), (half - 0.05, hr * 1.05), (half, hr * 0.88)]
    n = 12
    verts = []
    for k, (x, r) in enumerate(xs):
        for i in range(n):
            a = TAU * i / n
            j = 1.0 + 0.035 * hs("mhead", k, min(i, (n // 2 - i) % n))
            verts.append((x, math.cos(a) * r * j, hz + math.sin(a) * r * j))
    faces = []
    refs = []
    for k in range(len(xs) - 1):
        ref = Vector(((xs[k][0] + xs[k + 1][0]) / 2.0, 0.0, hz))
        for i in range(n):
            faces.append([k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i])
            refs.append(ref)
    for cap, sx in ((0, 1.0), (len(xs) - 1, -1.0)):
        ci = len(verts)
        verts.append((xs[cap][0] - sx * 0.02, 0.0, hz))
        for i in range(n):
            faces.append([cap * n + i, cap * n + (i + 1) % n, ci])
            refs.append(Vector((xs[cap][0] + sx * 0.2, 0.0, hz)))
    faces = orient_refs(verts, faces, refs)
    cols = []
    for fi in range(len(faces)):
        k = fi // n
        if fi >= (len(xs) - 1) * n:
            c = mix(WOOD_ENDGRAIN, WOOD_CARVED, 0.45 * h01("mface", fi))
            if h01("mdent", fi) < 0.3:
                c = mul(c, 0.8)
        elif k in (0, len(xs) - 2):
            c = mix(WOOD_CARVED, WOOD_ENDGRAIN, 0.5 * h01("medge", fi))
        else:
            c = mix(WOOD_PLANK, WOOD_MID, 0.45 * h01("mstave", fi % n))
            c = mul(c, 1.0 + 0.07 * hs("mhead", fi))
        cols.append(c)
    pc.add((verts, faces), MAT_WOOD, cols)
    # iron rings near both faces, nailed, and a wedge where the handle comes through
    for s in (-1, 1):
        m = T(s * (half - 0.22), 0.0, hz) @ RY(math.pi / 2)
        v, f = prism(n, hr * 1.07, hr * 1.07, 0.09, -0.045, False, False)
        pc.add((v, f), MAT_IRON, flat(IRON, 0.07, "mring%d" % s), m)
        for k in range(3):
            a = TAU * k / 3 + math.pi / 2
            p = Vector((s * (half - 0.22), math.cos(a) * hr * 1.07, hz + math.sin(a) * hr * 1.07))
            rivet(pc, p, (0.0, math.cos(a), math.sin(a)), "mrn%d%d" % (s, k), r=0.03, h=0.018)
    pc.add(prism(6, 0.072, 0.066, 0.045, hz + hr - 0.01, False, True, phase=math.pi / 6), MAT_WOOD, flat(WOOD_ENDGRAIN, 0.05, "mtop"))
    pc.add(cbox(0.03, 0.12, 0.03, 0.008), MAT_IRON, flat(IRON_LIGHT, 0.05, "mwedge"), T(0.0, 0.0, hz + hr + 0.04))
    # an iron collar under the head and a worn butt cap
    pc.add(prism(8, 0.08, 0.08, 0.06, hz - hr - 0.06, False, False), MAT_IRON, flat(IRON, 0.07, "mcollar"))
    pc.add(prism(8, 0.092, 0.086, 0.05, -1.0, True, False), MAT_IRON, flat(IRON_LIGHT, 0.07, "mbutt"))
    # land the butt and crown on the axe's: one uniform scale, one shift along z
    lo, hi = pc.bounds()
    k = (AXE_CROWN_Y - AXE_BUTT_Y) / (hi.z - lo.z)
    pc.verts = [Vector((v.x * k, v.y * k, AXE_BUTT_Y + (v.z - lo.z) * k)) for v in pc.verts]
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
    if spec["emission"] is not None:
        bsdf.inputs["Emission Color"].default_value = (*spec["emission"], 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


def part_mesh(pc, origin):
    mats = [m for m in MATERIAL_ORDER if m in set(pc.face_mats)]
    me = bpy.data.meshes.new(pc.name + "Mesh")
    me.from_pydata([tuple(v - origin) for v in pc.verts], [], pc.faces)
    me.validate(clean_customdata=False)
    if len(me.polygons) != len(pc.faces):
        raise RuntimeError("%s: validate dropped faces (%d of %d)" % (pc.name, len(me.polygons), len(pc.faces)))
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
    soften(me, {mats.index(m) for m in (MAT_ROPE, MAT_STRAW) if m in mats}, math.radians(70.0))
    me.update()
    return me


def soften(me, soft_mats, angle):
    """Rope and straw read as soft round forms: clear the sharp flag between two
    faces of those materials that meet under `angle` (8-sided rope rings stay
    round, the straw spikes, all near 120 degrees, stay crisp)."""
    sharp = me.attributes.get("sharp_edge")
    if sharp is None or not soft_mats:
        return
    faces_of = {}
    for poly in me.polygons:
        for ek in poly.edge_keys:
            faces_of.setdefault(ek, []).append(poly.index)
    vals = [False] * len(me.edges)
    sharp.data.foreach_get("value", vals)
    for e in me.edges:
        fs = faces_of.get(e.key, [])
        if len(fs) != 2 or not vals[e.index]:
            continue
        a, b = me.polygons[fs[0]], me.polygons[fs[1]]
        if a.material_index in soft_mats and b.material_index in soft_mats and a.normal.angle(b.normal, 0.0) < angle:
            vals[e.index] = False
    sharp.data.foreach_set("value", vals)


def mesh_object(pc, origin, collection, parent=None):
    ob = bpy.data.objects.new(pc.name, part_mesh(pc, origin))
    ob.location = origin
    ob.parent = parent
    collection.objects.link(ob)
    return ob


def effigy_objects(eff, collection):
    """Root empty + EffigyBody + Plank_NN + Lantern + LanternGlass + LanternFlame."""
    size = eff["size"]
    flame = eff["flame"]
    root = bpy.data.objects.new("MusterEffigy", None)
    gl_flame = [round(flame.x, 4), round(flame.z, 4), round(-flame.y, 4)]
    root["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "mirefen-muster-effigy",
        "kitKey": "musterEffigy",
        "stage": "final",
        "coordinateFrame": {"front": "+Z", "up": "+Y", "right": "+X", "units": "world-yards"},
        "nativeBounds": {"width": round(size.x, 3), "height": round(size.z, 3), "depth": round(size.y, 3)},
        "identityCues": ["log-legs", "back-props", "straw-body", "cask-head", "lantern-eye", "plank-hide", "red-rag"],
        "collider": {"shippingCollisionMesh": False},
    }
    root["height"] = round(size.z, 4)
    root["lanternHeight"] = round(flame.z, 4)
    root["lanternFlame"] = gl_flame
    root["plankCount"] = len(eff["planks"])
    collection.objects.link(root)
    zero = Vector((0.0, 0.0, 0.0))
    objs = {"root": root}
    objs["body"] = mesh_object(eff["body"], zero, collection, root)
    objs["planks"] = []
    for pc in eff["planks"]:
        lo, hi = pc.bounds()
        ob = mesh_object(pc, (lo + hi) / 2.0, collection, root)
        ob["plankGroup"] = pc.kind
        objs["planks"].append(ob)
    objs["lantern"] = mesh_object(eff["lantern"], flame, collection, root)
    objs["glass"] = mesh_object(eff["glass"], flame, collection, root)
    fl = bpy.data.objects.new("LanternFlame", None)
    fl.location = flame
    fl.parent = root
    fl["flameAnchor"] = 1
    collection.objects.link(fl)
    objs["flame"] = fl
    return objs


def mallet_object(pc, collection):
    ob = bpy.data.objects.new("MusterMallet", part_mesh(pc, Vector((0.0, 0.0, 0.0))))
    ob["sculptRuntime"] = {
        "schemaVersion": 1,
        "assetId": "mirefen-muster-mallet",
        "kitKey": "musterMallet",
        "stage": "final",
        "grip": {"convention": "kaykit-axe_2handed", "accessory": "2H_Axe", "handleAxis": "+Y", "bone": "handslot.r", "buttY": AXE_BUTT_Y, "crownY": AXE_CROWN_Y},
        "coordinateFrame": {"up": "+Y", "strikingFaces": "+-X", "units": "kaykit-weapon"},
    }
    collection.objects.link(ob)
    return ob


def export_selection(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
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


def build_scene(collection):
    eff = build_effigy()
    objs = effigy_objects(eff, collection)
    mallet = build_mallet()
    mob = mallet_object(mallet, collection)
    return eff, objs, mallet, mob


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out_dir = None
    if "--out" in argv:
        out_dir = argv[argv.index("--out") + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.data.collections.new("MusterEffigy")
    bpy.context.scene.collection.children.link(collection)
    eff, objs, mallet, mob = build_scene(collection)
    tris = eff["body"].triangles() + sum(p.triangles() for p in eff["planks"]) + eff["lantern"].triangles() + eff["glass"].triangles()
    size = eff["size"]
    fl = eff["flame"]
    lo, hi = mallet.bounds()
    report = [
        "musterEffigy tris=%d body=%d planks=%d plankTris=%d lantern=%d glass=%d size=%.3fx%.3fx%.3f flameGltf=(%.4f,%.4f,%.4f)"
        % (tris, eff["body"].triangles(), len(eff["planks"]), sum(p.triangles() for p in eff["planks"]), eff["lantern"].triangles(), eff["glass"].triangles(), size.x, size.y, size.z, fl.x, fl.z, -fl.y),
        "musterMallet tris=%d local=(%.3f..%.3f)x(%.3f..%.3f)x(%.3f..%.3f)" % (mallet.triangles(), lo.x, hi.x, lo.y, hi.y, lo.z, hi.z),
        "bodySections " + " ".join("%s=%d" % kv for kv in SECTIONS),
    ]
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        export_selection([objs["root"], objs["body"], *objs["planks"], objs["lantern"], objs["glass"], objs["flame"]], os.path.join(out_dir, "muster_effigy.glb"))
        export_selection([mob], os.path.join(out_dir, "muster_mallet.glb"))
    print("EFFIGY_KIT_REPORT_BEGIN")
    print("\n".join(report))
    print("EFFIGY_KIT_REPORT_END")


if __name__ == "__main__":
    main()
