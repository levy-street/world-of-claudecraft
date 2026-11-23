# Old Thatchgrin and his strawlings: a deterministic Blender factory for Gourdlight
# Eve's field boss (src/sim/content/gourdlight_eve_scarecrow.ts).
#
# Two rigged, animated GLBs come out of it, built on ONE armature layout and ONE clip
# set (scarecrow_clips.py), so the boss and his adds can never drift apart:
#
#   gourdlight_thatchgrin.glb   the boss: about five metres from his straw feet to the
#       crumpled tip of his hat, nearly three times a player. Two wooden stake legs in
#       torn burlap breeches tied at the knee, a stuffed burlap coat patched and
#       stitched with long tattered tails, a rope belt, a wooden yoke through his
#       shoulders lashed with rope, jointed stick arms in ragged sleeves ending in straw
#       bundles and long twig claws, a carved pumpkin head lit from inside under a
#       wide, torn, floppy felt hat, a long scythe (curved snath, rusted blade), and
#       three crows perched on him (left shoulder, hat brim, left forearm) on their own
#       bones so they shuffle, look round and burst off when he calls.
#   gourdlight_strawling.glb    the add: the same rig at under half his size, a burlap
#       sack head with a stitched grin and two ember eyes, no hat, no scythe, no crows.
#
# Materials (names are the runtime contract, src/render/characters/manifest.ts):
#   Burlap, BurlapDark, Straw, Wood, Rope, Iron, Felt, Feather, Beak  vertex-coloured
#   GourdLitSkin, GourdInner, GourdFlesh, GourdGlow, GourdStem        the pumpkin head
#   ScarecrowGlow                                                     the ember eyes
#
# Frame: Blender Z-up with the FRONT toward -Y (the glTF exporter turns it into +Y up,
# +Z front, the game's facing-0 convention). Units are metres; the game normalizes the
# body to VisualDef.height. Right side is -X.
#
#   blender --background --factory-startup --python \
#     scripts/assets/gourdlight_eve/scarecrow.py -- --out <dir> [--blend <file>]
#
# Determinism: no clock, no `random`; every variation is a sha256 of a tag (model.h01).

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M  # noqa: E402  (the shared helpers and the carved pumpkin)
import burlap_weave as W  # noqa: E402  (the sackcloth weave, box UVs, baked occlusion)
import scarecrow_clips as C  # noqa: E402  (the clip set)

TAU = math.pi * 2.0
h01 = M.h01
hs = M.hs
lerp = M.lerp
mix = M.mix
smooth = M.smooth

M.MATERIAL_DEFS.update(
    {
        "Burlap": {"rough": 0.97, "metal": 0.0},
        "BurlapDark": {"rough": 0.97, "metal": 0.0},
        "Rope": {"rough": 0.92, "metal": 0.0},
        "Felt": {"rough": 0.95, "metal": 0.0},
        "Feather": {"rough": 0.55, "metal": 0.0},
        "Beak": {"rough": 0.6, "metal": 0.0},
        "ScarecrowGlow": {"rough": 0.5, "metal": 0.0, "emit": (1.0, 0.55, 0.12)},
        "ScarecrowMatte": {"rough": 0.93, "metal": 0.0},
    }
)

# Every vertex-coloured matte surface (cloth, straw, wood, rope, felt, feathers, beaks) ships
# as ONE material: the colour lives in the vertices, so splitting them only cost draw calls.
# The glow materials (driven by name) and the metal blade keep their own.
MERGED_MATTE = {"Burlap", "BurlapDark", "Rope", "Straw", "Wood", "Felt", "Feather", "Beak"}
# ...except the boss's sackcloth, which carries the weave texture (burlap_weave.py) on a
# material of its own: one extra draw on a body the size of a house, none on a strawling
# (its budget is two). CLOTH_TILE is metres of cloth per weave tile.
CLOTH_PARTS = {"Burlap", "BurlapDark"}
CLOTH = [False]
CLOTH_TILE = 0.42

# palette (sRGB, authored)
BURLAP = (0.62, 0.48, 0.3)
BURLAP_DARK = (0.36, 0.25, 0.15)
PATCH_TONES = [(0.62, 0.48, 0.3), (0.56, 0.3, 0.16), (0.42, 0.44, 0.3), (0.66, 0.56, 0.4)]
COAT = (0.27, 0.22, 0.17)
STRAW = (0.86, 0.7, 0.36)
STRAW_DARK = (0.6, 0.45, 0.2)
WOOD = (0.42, 0.29, 0.17)
ROPE = (0.66, 0.55, 0.36)
IRON = (0.28, 0.27, 0.26)
RUST = (0.45, 0.22, 0.09)
FELT = (0.2, 0.15, 0.12)
FEATHER = (0.05, 0.05, 0.07)
BEAK = (0.3, 0.27, 0.22)


# ---------------------------------------------------------------------------
# the rig layout (armature space, metres): (name, parent, head, tail)
# ---------------------------------------------------------------------------


def bone_layout(s):
    """Every bone, scaled by `s` (1 for Thatchgrin, under half for a strawling)."""

    def p(x, y, z):
        return (x * s, y * s, z * s)

    bones = [
        ("Root", None, p(0, 0, 0), p(0, 0, 0.5)),
        ("Hips", "Root", p(0, 0, 1.95), p(0, 0, 2.3)),
        ("Spine", "Hips", p(0, 0, 2.3), p(0, 0, 2.85)),
        ("Chest", "Spine", p(0, 0, 2.85), p(0, -0.04, 3.4)),
        ("Neck", "Chest", p(0, -0.04, 3.4), p(0, -0.06, 3.6)),
        ("Head", "Neck", p(0, -0.06, 3.6), p(0, -0.06, 4.3)),
        ("Hat", "Head", p(0, 0.1, 4.4), p(0, 0.35, 4.9)),
        ("L_UpperArm", "Chest", p(0.5, 0, 3.28), p(1.28, 0, 3.2)),
        ("L_Forearm", "L_UpperArm", p(1.28, 0, 3.2), p(1.98, 0, 3.12)),
        ("L_Hand", "L_Forearm", p(1.98, 0, 3.12), p(2.4, 0, 3.08)),
        ("R_UpperArm", "Chest", p(-0.5, 0, 3.28), p(-1.28, 0, 3.2)),
        ("R_Forearm", "R_UpperArm", p(-1.28, 0, 3.2), p(-1.98, 0, 3.12)),
        ("R_Hand", "R_Forearm", p(-1.98, 0, 3.12), p(-2.4, 0, 3.08)),
        ("L_Thigh", "Hips", p(0.26, 0, 1.95), p(0.3, 0, 1.0)),
        ("L_Shin", "L_Thigh", p(0.3, 0, 1.0), p(0.32, 0, 0.17)),
        ("L_Foot", "L_Shin", p(0.32, 0, 0.17), p(0.32, -0.45, 0.06)),
        ("R_Thigh", "Hips", p(-0.26, 0, 1.95), p(-0.3, 0, 1.0)),
        ("R_Shin", "R_Thigh", p(-0.3, 0, 1.0), p(-0.32, 0, 0.17)),
        ("R_Foot", "R_Shin", p(-0.32, 0, 0.17), p(-0.32, -0.45, 0.06)),
        ("Coat_B", "Hips", p(0, 0.32, 2.2), p(0, 0.48, 1.0)),
        ("Coat_L", "Hips", p(0.42, 0.06, 2.2), p(0.58, 0.08, 1.15)),
        ("Coat_R", "Hips", p(-0.42, 0.06, 2.2), p(-0.58, 0.08, 1.15)),
    ]
    return bones


def crows_layout():
    """(name, parent bone, perch at s=1, facing yaw): left shoulder, hat brim, left forearm."""
    bx, by = 0.52, -0.3
    return [
        ("Crow1", "L_UpperArm", (0.8, 0.02, 3.47), 0.5),
        ("Crow2", "Head", (bx, by, brim_z(bx, by, 1.0) + 0.01), -0.4),
        ("Crow3", "L_Forearm", (1.66, 0.0, 3.29), 1.25),
    ]


def crow_bones():
    out = []
    for name, parent, (x, y, z), yaw in crows_layout():
        k = CROW_SCALE
        fx, fy = -math.sin(yaw), -math.cos(yaw)
        out.append((name, parent, (x, y, z + 0.06 * k), (x + fx * 0.25 * k, y + fy * 0.25 * k, z + 0.1 * k)))
        out.append((name + "_Head", name, (x + fx * 0.12 * k, y + fy * 0.12 * k, z + 0.13 * k), (x + fx * 0.28 * k, y + fy * 0.28 * k, z + 0.16 * k)))
        for side, sx in (("L", 1), ("R", -1)):
            # wing roots at the shoulders, pointing back along the body
            rx, ry = math.cos(yaw) * 0.08 * sx * k, -math.sin(yaw) * 0.08 * sx * k
            out.append((name + "_Wing" + side, name, (x + rx + fx * 0.06 * k, y + ry + fy * 0.06 * k, z + 0.12 * k), (x + rx - fx * 0.24 * k, y + ry - fy * 0.24 * k, z + 0.09 * k)))
    return out


# ---------------------------------------------------------------------------
# part building: every part carries its colours and its bone weights
# ---------------------------------------------------------------------------


class Part:
    def __init__(self, name, bm, mat, tint, weights):
        self.name = name
        self.bm = bm
        self.mat = mat
        self.tint = tint  # tint(co, normal, face_index) -> sRGB
        self.weights = weights  # weights(co) -> {bone: w}


PARTS = []


def add(name, bm, mat, tint, weights):
    PARTS.append(Part(name, bm, mat, tint, weights))


def rigid(bone):
    return lambda co: {bone: 1.0}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length, t


def envelope(bones_by_name, names, power=6.0):
    """Weights by distance to each bone segment (inverse power), top three kept."""

    segs = [(n, Vector(bones_by_name[n][2]), Vector(bones_by_name[n][3])) for n in names]

    def w(co):
        p = Vector(co)
        raw = []
        for n, a, b in segs:
            d, _ = seg_dist(p, a, b)
            raw.append((n, 1.0 / (d ** power + 1e-7)))
        raw.sort(key=lambda r: -r[1])
        raw = raw[:3]
        tot = sum(r[1] for r in raw)
        return {n: v / tot for n, v in raw}

    return w


def tube(bm, pts, radii, sides=8, noise=0.0, tag="t", cap=True, twist=0.0):
    """A tube swept along `pts` (Vectors) with a radius per point. Returns the rings."""
    rings = []
    n = len(pts)
    up = Vector((0, 0, 1))
    for i, c in enumerate(pts):
        d = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        ref = up if abs(d.dot(up)) < 0.9 else Vector((1, 0, 0))
        u = d.cross(ref).normalized()
        v = d.cross(u).normalized()
        ring = []
        for k in range(sides):
            a = k / sides * TAU + twist * i
            r = radii[i] * (1.0 + noise * hs(tag, i, k))
            ring.append(bm.verts.new(c + (u * math.cos(a) + v * math.sin(a)) * r))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return rings


def polyline(a, b, n, bend=None):
    """n+1 points from a to b, optionally bowed by `bend(t) -> Vector`."""
    a, b = Vector(a), Vector(b)
    out = []
    for i in range(n + 1):
        t = i / n
        q = a.lerp(b, t)
        if bend:
            q = q + bend(t)
        out.append(q)
    return out


def loft(bm, center_at, radius_at, rings, sides, tag, close_top=False, close_bottom=False,
         hem=None):
    """A lofted cloth body: rings bottom (t=0) to top (t=1). `radius_at(t, a)` returns
    (rx, ry) for angle a; `hem(a)` pulls the bottom ring down/up (a torn hem)."""
    verts = []
    for i in range(rings + 1):
        t = i / rings
        c = center_at(t)
        row = []
        for k in range(sides):
            a = k / sides * TAU
            rx, ry = radius_at(t, a)
            co = Vector((c.x + math.cos(a) * rx, c.y + math.sin(a) * ry, c.z))
            if hem is not None and i == 0:
                co.z += hem(a)
            row.append(bm.verts.new(co))
        verts.append(row)
    for i in range(rings):
        for k in range(sides):
            bm.faces.new((verts[i][k], verts[i][(k + 1) % sides], verts[i + 1][(k + 1) % sides], verts[i + 1][k]))
    if close_top:
        bm.faces.new(verts[-1])
    if close_bottom:
        bm.faces.new(list(reversed(verts[0])))
    return verts


def vnoise(tag, x, y, z):
    """Smooth value noise in [0, 1): sha256 lattice values, trilinearly blended."""
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = smooth(x - xi), smooth(y - yi), smooth(z - zi)

    def v(i, j, k):
        return h01(tag, xi + i, yi + j, zi + k)

    x00 = lerp(v(0, 0, 0), v(1, 0, 0), fx)
    x10 = lerp(v(0, 1, 0), v(1, 1, 0), fx)
    x01 = lerp(v(0, 0, 1), v(1, 0, 1), fx)
    x11 = lerp(v(0, 1, 1), v(1, 1, 1), fx)
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz)


def burlap_tint(tag, base=BURLAP, patch_rate=0.0, dirt_z=None):
    """Old sackcloth, painted: two octaves of soft mottling, dark water and soot stains
    that pool in blotches, faint vertical sun-streaks, field dirt climbing from the hem,
    undersides in shadow, and a per-face jitter so it reads hand-painted, not a gradient."""

    def tint(co, nrm, fi):
        n1 = vnoise(tag, co.x * 2.2, co.y * 2.2, co.z * 2.2)
        n2 = vnoise(tag + "b", co.x * 7.0, co.y * 7.0, co.z * 7.0)
        stain = smooth((vnoise(tag + "s", co.x * 1.4, co.y * 1.4, co.z * 1.4) - 0.6) * 6.0)
        streak = 0.05 * math.sin(co.x * 23.0 + 2.0 * n1) * math.sin(co.y * 19.0 + 3.0 * n2)
        # a fine mottle that runs smoothly across faces (owner note 2026-10-18: a jitter
        # per face read as facets up close); the weave texture carries the fine grain
        jitter = 0.06 * (vnoise(tag + "j", co.x * 16.0, co.y * 16.0, co.z * 16.0) - 0.5)
        k = 1.0 + 0.2 * (n1 - 0.5) + 0.12 * (n2 - 0.5) + streak + jitter
        c = (base[0] * k, base[1] * k, base[2] * k)
        c = mix(c, (c[0] * 0.55, c[1] * 0.5, c[2] * 0.42), stain * 0.55)
        if dirt_z is not None:
            d = smooth((dirt_z - co.z) / max(dirt_z, 0.01))
            c = mix(c, (0.2, 0.15, 0.09), d * 0.6)
        c = mix(c, (c[0] * 0.55, c[1] * 0.55, c[2] * 0.55), smooth(-nrm.z) * 0.4)
        return c

    # painted per VERTEX with the smooth vertex normal (color_part), so it shades like cloth
    tint.smooth = True
    return tint


def rag_strips(tag, roots, length, width, s, droop=(0, 0, -1)):
    """Torn cloth strips hanging from `roots` (Vectors): each a thin, twisting, tapering
    ribbon with a ragged end, so the edges of his clothes fray into the wind."""
    bm = bmesh.new()
    d = Vector(droop).normalized()
    for i, root in enumerate(roots):
        ln = length * (0.6 + 0.6 * h01(tag, "l", i))
        side = Vector((math.cos(h01(tag, "a", i) * TAU), math.sin(h01(tag, "a", i) * TAU), 0)) * width * 0.5
        rows = []
        n = 6
        for k in range(n + 1):
            t = k / n
            w = (1.0 - 0.6 * t) * (1.0 + 0.3 * hs(tag, "w", i, k))
            sway = Vector((0.04 * hs(tag, "sx", i, k), 0.04 * hs(tag, "sy", i, k), 0)) * s * t
            q = Vector(root) + d * ln * t + sway
            rows.append((bm.verts.new(q + side * w), bm.verts.new(q - side * w)))
        for k in range(n):
            bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008 * s)
    return bm


def straw_tint(tag):
    def tint(co, nrm, fi):
        t = h01(tag, "s", fi)
        c = mix(STRAW_DARK, STRAW, 0.35 + 0.65 * t)
        # sun-bleached tips
        return mix(c, (0.95, 0.86, 0.6), 0.25 * h01(tag, "tip", fi))

    return tint


def wood_tint(tag, base=WOOD):
    def tint(co, nrm, fi):
        grain = 0.14 * math.sin(co.z * 47.0 + co.x * 9.0 + 3.0 * hs(tag, "g"))
        knot = -0.25 if h01(tag, "k", round(co.z * 6.0)) > 0.93 else 0.0
        k = 0.85 + grain + knot + 0.1 * hs(tag, "f", fi)
        return (base[0] * k, base[1] * k, base[2] * k)

    return tint


def flat_tint(c, jitter=0.08, tag="flat"):
    return lambda co, nrm, fi: tuple(ch * (1.0 + jitter * hs(tag, fi)) for ch in c)


# ---------------------------------------------------------------------------
# the pieces
# ---------------------------------------------------------------------------


STRAW_DENSITY = [1.0]


def straw_tuft(tag, origin, direction, count, length, spread, width=0.012, droop=0.15):
    """A splayed bunch of straw: each straw a thin three-sided strand, kinked once.
    `STRAW_DENSITY` thins a small body's tufts (and widens each strand to keep the mass)."""
    density = STRAW_DENSITY[0]
    count = max(4, int(round(count * density)))
    width = width / max(0.5, density) ** 0.5
    bm = bmesh.new()
    o = Vector(origin)
    d = Vector(direction).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    for i in range(count):
        a = h01(tag, "a", i) * TAU
        r = spread * math.sqrt(h01(tag, "r", i))
        ln = length * (0.55 + 0.7 * h01(tag, "l", i))
        dirn = (d + (u * math.cos(a) + v * math.sin(a)) * r).normalized()
        start = o + (u * math.cos(a) + v * math.sin(a)) * width * 5 * h01(tag, "o", i)
        kink = (u * hs(tag, "ku", i) + v * hs(tag, "kv", i)) * ln * 0.12
        pts = []
        for k in range(4):
            t = k / 3
            pts.append(start + dirn * ln * t + kink * (t if t < 0.6 else 0.6) + Vector((0, 0, -droop * ln * t * t)))
        wd = width * (0.7 + 0.6 * h01(tag, "w", i))
        tube(bm, pts, [wd, wd * 0.85, wd * 0.6, wd * 0.2], sides=3, cap=False)
    return bm


def ring_rope(center, rx, ry, thick, n=16, wobble=0.0, tag="rr"):
    bm = bmesh.new()
    pts = [Vector(center) + Vector((math.cos(a) * rx, math.sin(a) * ry, wobble * math.sin(a * 3 + h01(tag) * 6)))
           for a in [i / n * TAU for i in range(n + 1)]]
    tube(bm, pts, [thick] * len(pts), sides=6, cap=False, noise=0.12, tag=tag)
    return bm


def stitch_line(bm, a, b, n, s, w=0.03):
    """A row of thick cross stitches from a to b (Vectors), on the surface normal side."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side = side.normalized() * w * s
    for i in range(n):
        c = a + d * ((i + 0.5) / n)
        for sg in (1, -1):
            p0 = c - side + d.normalized() * 0.02 * s * sg
            p1 = c + side - d.normalized() * 0.02 * s * sg
            tube(bm, [p0, p1], [0.009 * s, 0.009 * s], sides=4)


def build_legs(s, B):
    for side, sx in (("L", 1), ("R", -1)):
        hip = Vector((0.26 * sx, 0, 1.95)) * s
        knee = Vector((0.3 * sx, 0, 1.0)) * s
        ankle = Vector((0.32 * sx, 0, 0.17)) * s
        legs = [side + "_Thigh", side + "_Shin"]
        # the stake: a knotted pole through the whole leg, splintered at its foot
        bm = bmesh.new()
        pts = polyline(hip + Vector((0, 0, 0.12 * s)), ankle - Vector((0, 0, 0.1 * s)), 12,
                       bend=lambda t: Vector((0.02 * s * math.sin(t * 7), 0.025 * s * math.sin(t * 5 + 1), 0)))
        tube(bm, pts, [0.06 * s * (1.0 - 0.18 * t / 12) for t in range(13)], sides=8, noise=0.1, tag="stake" + side)
        add("Stake_" + side, bm, "Wood", wood_tint("stake" + side), envelope(B, legs))
        # the breeches: a torn burlap tube, stuffed at the thigh, cinched at the knee, flared
        # and shredded below it so the stake shows through
        bm = bmesh.new()

        def center(t, hip=hip, knee=knee):
            low = knee + Vector((0, -0.01 * s, -0.46 * s))
            return low.lerp(hip + Vector((0, 0, 0.12 * s)), t)

        def radius(t, a, side=side):
            cinch = math.exp(-((t - 0.32) / 0.06) ** 2)
            r = (0.13 + 0.06 * smooth((t - 0.35) * 2.2) - 0.045 * cinch + 0.035 * smooth((0.25 - t) * 4)) * s
            r *= 1.0 + 0.07 * hs("breech" + side, round(a * 3), round(t * 9))
            return r, r * 0.92

        def hem(a, side=side):
            return (-0.14 * abs(math.sin(a * 3.5 + h01("hem" + side) * 6)) ** 2 + 0.05 * hs("hm" + side, round(a * 8))) * s

        loft(bm, center, radius, 18, 20, "breech" + side, hem=hem)
        add("Breeches_" + side, bm, "Burlap", burlap_tint("breech" + side, base=(0.5, 0.39, 0.25), dirt_z=1.3 * s),
            envelope(B, legs + ["Hips"]))
        add("KneeRope_" + side, ring_rope(knee + Vector((0, -0.005 * s, 0.03 * s)), 0.1 * s, 0.093 * s, 0.024 * s, tag="kr" + side),
            "Rope", flat_tint(ROPE, tag="kr" + side), rigid(side + "_Shin"))
        # straw bursting from the shredded hem and from the knee tie
        add("ShinStraw_" + side, straw_tuft("shin" + side, knee + Vector((0, 0, -0.44 * s)), (0, 0, -1), 64, 0.36 * s, 0.75, 0.011 * s, 0.05),
            "Straw", straw_tint("shin" + side), rigid(side + "_Shin"))
        add("KneeStraw_" + side, straw_tuft("knee" + side, knee + Vector((0.05 * sx * s, -0.08 * s, 0.04 * s)), (0.4 * sx, -1, -0.2), 18, 0.2 * s, 0.5, 0.01 * s),
            "Straw", straw_tint("knee" + side), rigid(side + "_Shin"))
        add("ThighStraw_" + side, straw_tuft("thigh" + side, hip + Vector((0.12 * sx * s, -0.08 * s, -0.45 * s)), (sx, -0.6, 0.2), 14, 0.18 * s, 0.5, 0.01 * s),
            "Straw", straw_tint("thigh" + side), rigid(side + "_Thigh"))
        # the foot: a bound bundle of straw splaying on the ground ahead of the stake
        bm = straw_tuft("foot" + side, ankle + Vector((0, 0.02 * s, 0.13 * s)), (0, -0.5, -1), 90, 0.4 * s, 0.65, 0.013 * s, 0.25)
        add("FootStraw_" + side, bm, "Straw", straw_tint("foot" + side), rigid(side + "_Foot"))
        add("AnkleRope_" + side, ring_rope(ankle + Vector((0, 0, 0.12 * s)), 0.08 * s, 0.08 * s, 0.02 * s, tag="ar" + side),
            "Rope", flat_tint(ROPE, tag="ar" + side), rigid(side + "_Shin"))


def coat_center(t, s):
    """The torso's spine curve, t 0 (waist) .. 1 (shoulders): hunched forward at the top."""
    z = lerp(2.2, 3.36, t) * s
    y = (0.04 * t - 0.1 * smooth((t - 0.45) * 2.0)) * s
    return Vector((0, y, z))


def coat_radius(t, a, s):
    chest = math.exp(-((t - 0.62) / 0.26) ** 2)
    shoulder = smooth((t - 0.75) * 4.0)
    rx = (0.34 + 0.15 * chest + 0.12 * shoulder - 0.07 * smooth((t - 0.94) * 16)) * s
    ry = (0.3 + 0.16 * chest - 0.03 * shoulder) * s
    if math.sin(a) < 0:  # the stuffed chest bulges forward
        ry *= 1.0 + 0.14 * chest * (-math.sin(a))
    lump = 1.0 + 0.05 * hs("coat", round(a * 4), round(t * 8))
    return rx * lump, ry * lump


def build_torso(s, B, boss):
    torso = ["Hips", "Spine", "Chest"]
    # the coat's body: waist to shoulders
    bm = bmesh.new()
    loft(bm, lambda t: coat_center(t, s), lambda t, a: coat_radius(t, a, s), 24, 32, "coat")
    coat_base = COAT
    add("Coat", bm, "BurlapDark", burlap_tint("coat", base=coat_base), envelope(B, torso, power=4.0))
    # the shoulder line closing round the neck, and a high, ragged, turned-up collar
    bm = bmesh.new()

    def capc(t):
        return Vector((0, coat_center(1, s).y + 0.02 * s, lerp(3.33, 3.48, t) * s))

    def capr(t, a):
        rx0, ry0 = coat_radius(1.0, a, s)
        return lerp(rx0, 0.16 * s, smooth(t)), lerp(ry0, 0.15 * s, smooth(t))

    loft(bm, capc, capr, 5, 32, "cap")
    add("ShoulderCap", bm, "BurlapDark", burlap_tint("cap", base=coat_base), envelope(B, ["Chest", "Neck"], power=4.0))
    bm = bmesh.new()

    def colc(t):
        return Vector((0, coat_center(1, s).y + 0.03 * s, lerp(3.42, 3.68, t) * s))

    def colr(t, a):
        r = lerp(0.2, 0.36, t) * s * (1.0 + 0.1 * hs("collar", round(a * 5)))
        # open at the front so the neck sack and the head read
        return r, r * 0.9

    verts = loft(bm, colc, colr, 4, 28, "collarloft")
    for f in list(bm.faces):
        c = f.calc_center_median()
        if c.y < -0.05 * s and abs(c.x) < 0.17 * s:
            bm.faces.remove(f)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02 * s)
    add("Collar", bm, "BurlapDark", burlap_tint("collar", base=(0.2, 0.17, 0.14)), envelope(B, ["Chest", "Neck"], power=4.0))
    # the neck: a burlap sack gathered under the head with a rope noose
    bm = bmesh.new()

    def neckc(t):
        return Vector((0, -0.05 * s, lerp(3.38, 3.68, t) * s))

    def neckr(t, a):
        r = (0.15 + 0.1 * smooth((t - 0.6) * 3)) * s * (1.0 + 0.1 * hs("neck", round(a * 6), round(t * 4)))
        return r, r

    loft(bm, neckc, neckr, 6, 18, "neck")
    add("NeckSack", bm, "Burlap", burlap_tint("neck", base=(0.6, 0.47, 0.3)), envelope(B, ["Chest", "Neck", "Head"], power=6.0))
    add("Noose", ring_rope((0, -0.05 * s, 3.5 * s), 0.16 * s, 0.16 * s, 0.03 * s, tag="noose"), "Rope", flat_tint(ROPE, tag="noose"),
        rigid("Neck"))
    bm = bmesh.new()
    k0 = Vector((0.05 * s, -0.2 * s, 3.5 * s))
    tube(bm, polyline(k0, k0 + Vector((0.06, -0.06, -0.5)) * s, 7, bend=lambda t: Vector((0.03 * math.sin(t * 4), 0, 0)) * s), [0.028 * s] * 8, sides=6)
    add("NooseEnd", bm, "Rope", flat_tint(ROPE, tag="noose2"), rigid("Chest"))
    # the long coat skirt: open in front, falling past the knees behind and at the sides,
    # torn into strips at the hem; each third of it rides its own coat bone
    if boss:
        bm = bmesh.new()
        nu, nv = 30, 16
        a0, a1 = -math.pi / 2 + 0.55, -math.pi / 2 + TAU - 0.55  # leave the front open
        top = 2.3
        rows = []
        for j in range(nv + 1):
            v = j / nv
            row = []
            for i in range(nu + 1):
                u = i / nu
                a = lerp(a0, a1, u)
                back = 0.5 + 0.5 * math.sin(a)  # 1 at the back, 0 at the front edges
                z = lerp(top, lerp(1.35, 0.92, back), v) * s
                rx, ry = coat_radius(0.0, a, s)
                flare = (1.0 + 0.55 * v * v)
                co = Vector((math.cos(a) * rx * flare, coat_center(0, s).y + math.sin(a) * ry * flare, z))
                co += Vector((math.cos(a), math.sin(a), 0)) * 0.025 * s * math.sin(u * 23 + v * 4)
                if j == nv:
                    co.z += (0.22 * abs(math.sin(u * 17 + 0.4)) ** 1.5 + 0.06 * h01("skirt", i)) * s
                row.append(bm.verts.new(co))
            rows.append(row)
        for j in range(nv):
            for i in range(nu):
                if j > nv * 0.55 and i % 5 == 2 and h01("skirtgap", i, j) > 0.25:
                    continue
                bm.faces.new((rows[j][i + 1], rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.014 * s)

        def skirt_w(co):
            a = math.atan2(co.y - coat_center(0, s).y, co.x)
            v = max(0.0, min(1.0, (top * s - co.z) / ((top - 1.0) * s)))
            w = smooth(v * 1.4)
            if w < 0.002:
                return {"Hips": 1.0}
            # left side, back, right side (the front is open)
            wl = max(0.0, math.cos(a)) ** 2
            wr = max(0.0, -math.cos(a)) ** 2
            wb = max(0.0, math.sin(a)) ** 2
            tot = wl + wr + wb + 1e-6
            return {"Hips": 1.0 - w, "Coat_L": w * wl / tot, "Coat_R": w * wr / tot, "Coat_B": w * wb / tot}

        add("CoatSkirt", bm, "BurlapDark", burlap_tint("skirt", base=COAT, dirt_z=1.5 * s), skirt_w)
        # the stuffing showing in the open front of the coat
        add("BellyStraw", straw_tuft("belly", (0, -0.3 * s, 2.15 * s), (0, -1, -0.5), 46, 0.34 * s, 0.85, 0.012 * s, 0.3),
            "Straw", straw_tint("belly"), rigid("Hips"))
    # patches sewn on: raised dark panels, stitched round with thick thread
    patch_sites = [(-0.2, 2.95, 0.26, 0.22, -1), (0.24, 2.5, 0.22, 0.28, -1), (0.12, 3.0, 0.3, 0.24, 1),
                   (-0.25, 2.55, 0.22, 0.2, 1)] if boss else [(0.1, 2.75, 0.26, 0.24, -1)]
    for i, (px, pz, w, h, face) in enumerate(patch_sites):
        bm = bmesh.new()
        sb = bmesh.new()
        t = (pz - 2.2) / (3.36 - 2.2)
        nx, nz = 6, 6
        rows = []
        for a_i in range(nx + 1):
            row = []
            for b_i in range(nz + 1):
                x = px * s + (a_i / nx - 0.5) * w * s
                z = pz * s + (b_i / nz - 0.5) * h * s
                edge = a_i in (0, nx) or b_i in (0, nz)
                if edge:
                    x += 0.014 * s * hs("pe", i, a_i, b_i)
                    z += 0.014 * s * hs("pz", i, a_i, b_i)
                tt = (z / s - 2.2) / (3.36 - 2.2)
                c = coat_center(tt, s)
                rx, ry = coat_radius(tt, -math.pi / 2 * face, s)
                xa = max(-0.98, min(0.98, x / rx))
                y = c.y + face * ry * math.sqrt(1.0 - xa * xa) * 1.0 + face * 0.012 * s
                row.append(bm.verts.new((x, y, z)))
            rows.append(row)
        for a_i in range(nx):
            for b_i in range(nz):
                q = (rows[a_i][b_i], rows[a_i + 1][b_i], rows[a_i + 1][b_i + 1], rows[a_i][b_i + 1])
                bm.faces.new(q if face > 0 else tuple(reversed(q)))
        add("Patch%d" % i, bm, "Burlap", burlap_tint("patch%d" % i, base=PATCH_TONES[i % len(PATCH_TONES)]),
            envelope(B, torso, power=4.0))
        # stitches along the patch's top and side edges
        for edge in ((rows[0][nz], rows[nx][nz]), (rows[0][0], rows[0][nz]), (rows[nx][0], rows[nx][nz])):
            a_, b_ = edge[0].co.copy(), edge[1].co.copy()
            off = Vector((0, face * 0.008 * s, 0))
            stitch_line(sb, a_ + off, b_ + off, 4, s, 0.022)
        add("PatchStitch%d" % i, sb, "Rope", flat_tint((0.16, 0.11, 0.07), tag="ps%d" % i), envelope(B, torso, power=4.0))
    # the rope belt (doubled) with a long hanging knot
    bz = 2.24 * s
    rx, ry = coat_radius(0.03, 0, s)
    cc = coat_center(0.03, s)
    for k, dz in enumerate((0.0, 0.05)):
        add("Belt%d" % k, ring_rope(cc + Vector((0, 0, bz - cc.z + dz * s)), rx + 0.025 * s, ry + 0.03 * s, 0.03 * s, n=28, wobble=0.012 * s, tag="belt%d" % k),
            "Rope", flat_tint(ROPE, tag="belt%d" % k), envelope(B, ["Hips", "Spine"]))
    bm = bmesh.new()
    knot = Vector((0.16 * s, cc.y - ry - 0.04 * s, bz))
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.06 * s, matrix=Matrix.Translation(knot))
    tube(bm, polyline(knot, knot + Vector((0.06, -0.05, -0.55)) * s, 7), [0.03 * s] * 8, sides=6, noise=0.1, tag="k1")
    tube(bm, polyline(knot, knot + Vector((-0.05, -0.04, -0.42)) * s, 7), [0.028 * s] * 8, sides=6, noise=0.1, tag="k2")
    add("BeltKnot", bm, "Rope", flat_tint(ROPE, tag="belt"), rigid("Hips"))
    # straw bursting out of the collar, the shoulder seams and a tear in the back
    add("CollarStraw", straw_tuft("collar", (0, -0.02 * s, 3.5 * s), (0, 0, 1), 90 if boss else 50, 0.28 * s, 1.0, 0.012 * s, 0.5),
        "Straw", straw_tint("collar"), rigid("Chest"))
    if boss:
        # an ember heart smouldering behind the tear in his chest, showing between the straws
        hbm = bmesh.new()
        bmesh.ops.create_icosphere(hbm, subdivisions=2, radius=1.0)
        for v in hbm.verts:
            v.co = Vector((0.06 * s + v.co.x * 0.11 * s, -0.43 * s + v.co.y * 0.05 * s, 2.86 * s + v.co.z * 0.14 * s))
        add("EmberHeart", hbm, "ScarecrowGlow", flat_tint((1.0, 0.5, 0.12), 0.0), rigid("Chest"))
        # frayed strips at his shoulders and the coat's open front
        roots = [Vector((sx * (0.5 + 0.05 * k) * s, (-0.2 + 0.18 * k) * s, 3.3 * s)) for sx in (1, -1) for k in range(3)]
        add("ShoulderRags", rag_strips("shrag", roots, 0.5 * s, 0.09 * s, s), "BurlapDark",
            burlap_tint("shrag", base=COAT), envelope(B, ["Chest", "L_UpperArm", "R_UpperArm"], power=6))
        add("ChestStraw", straw_tuft("chest", (0.06 * s, -0.5 * s, 2.86 * s), (0.2, -1, 0.1), 40, 0.28 * s, 0.6, 0.012 * s, 0.2),
            "Straw", straw_tint("chest"), rigid("Chest"))
        add("BackStraw", straw_tuft("back", (-0.12 * s, 0.33 * s, 2.7 * s), (0, 1, -0.2), 34, 0.26 * s, 0.6, 0.012 * s, 0.25),
            "Straw", straw_tint("back"), rigid("Spine"))
        for sx in (1, -1):
            add("SeamStraw%d" % sx, straw_tuft("seam%d" % sx, (0.6 * sx * s, 0.02 * s, 3.38 * s), (sx, 0, 0.6), 22, 0.22 * s, 0.6, 0.011 * s, 0.2),
                "Straw", straw_tint("seam%d" % sx), rigid("Chest"))
    # a long stitched seam down his front
    bm = bmesh.new()
    pts = []
    for i in range(12):
        z = lerp(2.4, 3.25, i / 11) * s
        t = (z / s - 2.2) / (3.36 - 2.2)
        cy = coat_center(t, s).y - coat_radius(t, -math.pi / 2, s)[1] - 0.008 * s
        pts.append(Vector((0.02 * s * math.sin(i), cy, z)))
    for i in range(len(pts) - 1):
        stitch_line(bm, pts[i], pts[i + 1], 1, s, 0.05)
    add("Stitches", bm, "Rope", flat_tint((0.16, 0.11, 0.07), tag="st"), envelope(B, torso, power=4.0))


def build_yoke(s, B):
    """The wooden yoke through his shoulders, lashed with rope, its ends poking out."""
    bm = bmesh.new()
    tube(bm, polyline((-0.72 * s, 0.05 * s, 3.33 * s), (0.72 * s, 0.05 * s, 3.33 * s), 8,
                      bend=lambda t: Vector((0, 0, 0.03 * s * math.sin(t * math.pi)))),
         [0.065 * s] * 9, sides=7, noise=0.08, tag="yoke")
    add("Yoke", bm, "Wood", wood_tint("yoke"), rigid("Chest"))
    for sx in (1, -1):
        for k in range(3):
            x = (0.6 + 0.035 * k) * sx * s
            bm = bmesh.new()
            pts = [Vector((x + 0.01 * s * math.sin(a * 2), 0.05 * s + math.cos(a) * 0.085 * s, 3.33 * s + math.sin(a) * 0.085 * s))
                   for a in [i / 10 * TAU for i in range(11)]]
            tube(bm, pts, [0.017 * s] * len(pts), sides=5, cap=False)
            add("YokeRope%d_%d" % (sx, k), bm, "Rope", flat_tint(ROPE, tag="yr%d%d" % (sx, k)), rigid("Chest"))


def build_arms(s, B, boss):
    for side, sx in (("L", 1), ("R", -1)):
        sh = Vector((0.5 * sx, 0, 3.28)) * s
        el = Vector((1.28 * sx, 0, 3.2)) * s
        wr = Vector((1.98 * sx, 0, 3.12)) * s
        # the sticks
        bm = bmesh.new()
        tube(bm, polyline(sh, el + Vector((0.06 * sx * s, 0, 0)), 6), [0.048 * s] * 7, sides=7, noise=0.12, tag="ua" + side)
        add("UpperStick_" + side, bm, "Wood", wood_tint("ua" + side), rigid(side + "_UpperArm"))
        bm = bmesh.new()
        tube(bm, polyline(el - Vector((0.06 * sx * s, 0, 0)), wr + Vector((0.14 * sx * s, 0, 0)), 6), [0.042 * s] * 7, sides=7, noise=0.12, tag="fa" + side)
        add("ForeStick_" + side, bm, "Wood", wood_tint("fa" + side), rigid(side + "_Forearm"))
        # the sleeve: one ragged tube, stuffed, slumping under its own weight, a torn cuff
        bm = bmesh.new()

        def center(t, sh=sh, wr=wr):
            q = sh.lerp(wr - Vector((0.05 * sx * s, 0, 0)), t)
            return q + Vector((0, 0, -0.04 * s * math.sin(t * math.pi)))

        def radius(t, side=side):
            elbow = math.exp(-((t - 0.53) / 0.05) ** 2)
            return (0.2 - 0.05 * t - 0.04 * elbow + 0.05 * smooth((t - 0.86) * 7)) * s

        rings, sides = 20, 18
        verts = []
        for i in range(rings + 1):
            t = i / rings
            c = center(t)
            row = []
            for k in range(sides):
                a = k / sides * TAU
                r = radius(t) * (1.0 + 0.07 * hs("sl" + side, k // 2, i))
                off = Vector((0, math.cos(a) * r, math.sin(a) * r))
                if i == rings:
                    off *= 1.0 + 0.3 * abs(math.sin(a * 3 + 0.5))
                    c2 = c + Vector((0.09 * sx * s * abs(math.sin(a * 2.5 + 1.1)) ** 2, 0, 0))
                    row.append(bm.verts.new(c2 + off))
                else:
                    row.append(bm.verts.new(c + off))
            verts.append(row)
        for i in range(rings):
            for k in range(sides):
                f = (verts[i][k], verts[i][(k + 1) % sides], verts[i + 1][(k + 1) % sides], verts[i + 1][k])
                bm.faces.new(f if sx > 0 else tuple(reversed(f)))
        add("Sleeve_" + side, bm, "BurlapDark", burlap_tint("sleeve" + side, base=COAT),
            envelope(B, ["Chest", side + "_UpperArm", side + "_Forearm"], power=6.0))
        # an elbow patch with its stitches
        bm = bmesh.new()
        sb = bmesh.new()
        ec = el + Vector((0, 0.0, 0.0))
        for a_i in range(5):
            for b_i in range(5):
                pass
        nx = 5
        rows = []
        for a_i in range(nx + 1):
            row = []
            for b_i in range(nx + 1):
                ang = lerp(0.5, 2.4, b_i / nx)
                x = ec.x + (a_i / nx - 0.5) * 0.3 * s
                r = radius(0.53) + 0.012 * s
                row.append(bm.verts.new((x, math.cos(ang) * r, ec.z - 0.035 * s + math.sin(ang) * r)))
            rows.append(row)
        for a_i in range(nx):
            for b_i in range(nx):
                q = (rows[a_i][b_i], rows[a_i + 1][b_i], rows[a_i + 1][b_i + 1], rows[a_i][b_i + 1])
                bm.faces.new(q if sx < 0 else tuple(reversed(q)))
        add("ElbowPatch_" + side, bm, "Burlap", burlap_tint("ep" + side, base=PATCH_TONES[1 if sx > 0 else 2]),
            envelope(B, [side + "_UpperArm", side + "_Forearm"], power=8))
        # frayed strips hanging off the torn cuff
        cuff = wr - Vector((0.02 * sx * s, 0, 0))
        roots = [cuff + Vector((0, math.cos(a) * 0.17 * s, math.sin(a) * 0.17 * s)) for a in (3.6, 4.2, 4.8, 5.5, 0.4)]
        add("CuffRags_" + side, rag_strips("cuff" + side, roots, 0.42 * s, 0.07 * s, s), "BurlapDark",
            burlap_tint("cuffrag" + side, base=COAT), rigid(side + "_Forearm"))
        # rope bindings at the elbow and the cuff
        for k, x in enumerate((el, wr - Vector((0.03 * sx * s, 0, 0)))):
            bm = bmesh.new()
            pts = [x + Vector((0.012 * s * math.sin(a * 2), math.cos(a) * 0.15 * s, math.sin(a) * 0.15 * s))
                   for a in [i / 12 * TAU for i in range(13)]]
            tube(bm, pts, [0.021 * s] * len(pts), sides=5, cap=False)
            add("ArmRope_%s%d" % (side, k), bm, "Rope", flat_tint(ROPE, tag="arr%s%d" % (side, k)),
                rigid(side + ("_UpperArm" if k == 0 else "_Forearm")))
        # the hand: a bound straw bundle bursting from the cuff, and long twig claws
        grip = side == "R" and boss
        if grip:
            build_grip_hand(s, side, sx, wr)
            continue
        add("HandStraw_" + side, straw_tuft("hand" + side, wr + Vector((0.08 * sx * s, 0, 0)), (sx, 0, -0.3), 70, 0.34 * s, 0.6, 0.012 * s, 0.35),
            "Straw", straw_tint("hand" + side), rigid(side + "_Hand"))
        bm = bmesh.new()
        base = wr + Vector((0.2 * sx * s, 0, 0))
        claws = [(-0.4, 0.05), (-0.14, -0.02), (0.14, -0.04), (0.4, 0.0), (0.0, -0.7)]
        for ci, (spread, down) in enumerate(claws):
            length = (0.58 if ci < 4 else 0.34) * s
            pts = []
            for k in range(7):
                t = k / 6
                p = base + Vector((sx * length * t, spread * 0.3 * s * t + (-0.25 * s if ci == 4 else 0) * t,
                                   (down - 0.5 * t * t) * 0.32 * s * t))
                p += Vector((0, 0.016 * s * hs("claw", side, ci, k), 0.016 * s * hs("clawz", side, ci, k)))
                pts.append(p)
            tube(bm, pts, [0.026 * s, 0.024 * s, 0.021 * s, 0.017 * s, 0.013 * s, 0.008 * s, 0.002 * s], sides=5)
        add("Claws_" + side, bm, "Wood", wood_tint("claws" + side, base=(0.26, 0.17, 0.1)), rigid(side + "_Hand"))


# The scythe hand's palm: where the snath runs, out past the cuff in the middle of the straw
# fist, so the haft sits IN his hand and not at his wrist (owner note, 2026-10-17).
SNATH_RADIUS = 0.045


def grip_center(s):
    return Vector((-2.36, 0.0, 3.08)) * s


def build_grip_hand(s, side, sx, wr):
    """The right hand closed round the scythe: a short straw fist packed round the haft, four
    twig fingers wrapped round it in the horizontal plane (the haft is upright), stacked down
    its length like a real grip, and a thumb hooked over the top from the other side."""
    c = grip_center(s)
    # the straw fist: packed tight round the haft, bursting a little past it and out of the
    # cuff, never the long splay of the open hand (it would bury the grip)
    add("HandStraw_" + side, straw_tuft("handgrip" + side, wr + Vector((0.06 * sx * s, 0, 0)), (sx, 0, -0.08), 44, 0.27 * s, 0.42, 0.012 * s, 0.1),
        "Straw", straw_tint("hand" + side), rigid(side + "_Hand"))
    bm = bmesh.new()
    wrap = SNATH_RADIUS * s + 0.022 * s
    # (height on the haft, start angle, sweep, knuckle reach): angle 0 points back at his
    # wrist (+X), the fingers sweep forward round the front (-Y) and close on the far side
    # each finger a jointed twig: three phalanges bent at knuckles round the haft (angular,
    # not a smooth ring), each a touch shorter than the last, the tip digging in
    fingers = [(0.135, 0.1, 4.2, 0.12), (0.045, 0.05, 4.4, 0.13), (-0.045, 0.1, 4.25, 0.13), (-0.13, 0.2, 3.8, 0.11)]
    for fi, (dz, a0, sweep, reach) in enumerate(fingers):
        pts = []
        root = c + Vector((reach * s, 0.035 * s, dz * s))
        pts.append(root + Vector((0.06 * s, 0.01 * s, 0.01 * s)))
        pts.append(root)
        joints = [0.0, 0.34, 0.62, 0.84, 1.0]
        for k, t in enumerate(joints):
            a = a0 + sweep * t
            r = wrap * (1.22 - 0.2 * t) * (1.08 if 0 < k < len(joints) - 1 else 1.0)
            jitter = 0.008 * s * hs("grip", fi, k)
            pts.append(c + Vector((math.cos(a) * r, -math.sin(a) * r, dz * s + jitter - 0.018 * s * t)))
        radii = [0.034 * s, 0.033 * s, 0.031 * s, 0.028 * s, 0.023 * s, 0.016 * s, 0.004 * s]
        tube(bm, pts, radii, sides=6)
    # the thumb: hooked over the top of the fist from the other side, the way a hand holds a pole
    pts = []
    for k in range(7):
        t = k / 6
        a = -0.5 - 3.2 * t
        r = wrap * (1.15 - 0.1 * t)
        pts.append(c + Vector((math.cos(a) * r + 0.05 * s * (1 - t), -math.sin(a) * r, (0.2 + 0.03 * math.sin(t * math.pi)) * s)))
    tube(bm, pts, [0.028 * s, 0.026 * s, 0.023 * s, 0.019 * s, 0.014 * s, 0.009 * s, 0.003 * s], sides=5)
    add("Claws_" + side, bm, "Wood", wood_tint("claws" + side, base=(0.26, 0.17, 0.1)), rigid(side + "_Hand"))


def strip_material(obj, name):
    me = obj.data
    idx = [i for i, m in enumerate(me.materials) if m and m.name == name]
    if not idx:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()


def build_head(s, B, boss):
    coll = bpy.context.scene.collection
    if boss:
        # a big carved pumpkin, the angry fanged face, lit from inside
        head = M.carved_pumpkin("ThatchgrinHead", "thatchgrin-head", coll, 0.58, 0.78, 10, "fang", 60, 30,
                                M.PALETTE_ORANGE, neck_hole=0.17, shell=0.05, glow_r=0.36, face_lift=-0.02,
                                tilt=False, face_scale=(1.0, 0.66))
        strip_material(head, "GourdStem")
        head.location = (0, -0.02, 3.92)
        head.rotation_euler = (math.radians(8), 0, 0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        head.select_set(True)
        bpy.context.view_layer.objects.active = head
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return head
    # a strawling: a burlap sack, gathered at the neck, a stitched grin, two ember eyes
    bm = bmesh.new()

    def center(t):
        return Vector((0, -0.04 * s, lerp(3.45, 4.2, t) * s))

    def radius(t, a):
        r = (0.13 + 0.33 * math.sin(min(1.0, t * 1.05) * math.pi) ** 0.7) * s
        r *= 1.0 + 0.07 * hs("sack", round(a * 4), round(t * 6))
        return r, r * 0.9

    loft(bm, center, radius, 16, 22, "sack", close_top=True, close_bottom=True)
    add("Sack", bm, "Burlap", burlap_tint("sack", base=(0.58, 0.45, 0.29)), rigid("Head"))
    # two drooping sack ears where the corners were tied off
    for sx in (1, -1):
        bm = bmesh.new()
        tube(bm, polyline((0.3 * sx * s, -0.04 * s, 4.05 * s), (0.46 * sx * s, -0.02 * s, 4.18 * s), 4,
                          bend=lambda t: Vector((0, 0, -0.06 * s * t * t))), [0.07 * s, 0.06 * s, 0.05 * s, 0.035 * s, 0.01 * s], sides=7)
        add("SackEar%d" % sx, bm, "Burlap", burlap_tint("ear%d" % sx, base=(0.55, 0.42, 0.27)), rigid("Head"))
    # the face sits ON the sack's front (owner note 2026-10-18: set at -0.33 it was buried
    # inside the head, so a strawling read faceless and its portrait looked turned away)
    def sack_front(x, z):
        t = (z / s - 3.45) / 0.75
        r = (0.13 + 0.33 * math.sin(min(1.0, t * 1.05) * math.pi) ** 0.7) * s
        ry = r * 0.9
        return -0.04 * s - ry * math.sqrt(max(0.0, 1.0 - (x / r) ** 2))

    bm = bmesh.new()
    for sx in (1, -1):
        ex, ez = 0.12 * sx * s, 3.92 * s
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.07 * s,
                                   matrix=Matrix.Translation((ex, sack_front(ex, ez) + 0.01 * s, ez)))
    add("EmberEyes", bm, "ScarecrowGlow", flat_tint((1.0, 0.62, 0.2), 0.0), rigid("Head"))
    bm = bmesh.new()
    pts = []
    for i in range(9):
        x = lerp(-0.17, 0.17, i / 8) * s
        z = 3.72 * s - 0.035 * s * math.sin(i / 8 * math.pi)
        pts.append(Vector((x, sack_front(x, z) - 0.008 * s, z)))
    for i in range(len(pts) - 1):
        stitch_line(bm, pts[i], pts[i + 1], 1, s, 0.045)
    tube(bm, pts, [0.009 * s] * len(pts), sides=4)
    add("SackGrin", bm, "Rope", flat_tint((0.14, 0.09, 0.05), tag="grin"), rigid("Head"))
    return None


HAT_Z = 4.24


def brim_z(x, y, s):
    """The brim's height over (x, y): drooping all round, the front flipped up."""
    r = math.hypot(x, y + 0.02 * s) / s
    a = math.atan2(y, x)
    v = max(0.0, min(1.0, (r - 0.32) / 0.56))
    front = max(0.0, -math.sin(a)) ** 2
    return (HAT_Z * s - 0.26 * s * v * v * (0.6 + 0.4 * math.cos(a - 0.6)) - 0.05 * s * math.sin(a * 3) * v
            + 0.3 * s * v * front)


def build_hat(s, B):
    """A wide, torn, floppy felt hat pushed back off the face; the crown slumps back and
    crumples; a rope band, a crow's feather."""
    bm = bmesh.new()
    rings, sides = 10, 48
    rows = []
    for j in range(rings + 1):
        v = j / rings
        row = []
        for k in range(sides):
            a = k / sides * TAU
            r = lerp(0.33, 0.9, v) * s
            r *= 1.0 + (0.1 * hs("brim", k) if j == rings else 0.0)
            x, y = math.cos(a) * r, math.sin(a) * r * 0.95 - 0.02 * s
            row.append(bm.verts.new((x, y, brim_z(x, y, s))))
        rows.append(row)
    for j in range(rings):
        for k in range(sides):
            if j >= rings - 3 and h01("hole", j, k) > 0.88:
                continue
            bm.faces.new((rows[j][k], rows[j][(k + 1) % sides], rows[j + 1][(k + 1) % sides], rows[j + 1][k]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.025 * s)
    cz = HAT_Z * s

    # the crown: a slumped, dented cone that bends back and folds over at the tip
    def crown_c(t):
        return Vector((0.06 * s * math.sin(t * 2), 0.08 * s + 0.36 * s * t ** 2.2, cz - 0.02 * s + 0.44 * s * math.sin(t * 1.9) / math.sin(1.9)))

    def crown_r(t, a):
        dent = 1.0 - 0.12 * math.exp(-((a - 4.6) / 0.5) ** 2) * math.sin(t * math.pi)
        r = (0.34 * max(0.0, 1.0 - t ** 2.4) ** 0.55 + 0.035 * (1.0 - t) + 0.02) * s * dent * (1.0 + 0.08 * hs("crown", round(a * 3), round(t * 6)))
        return r, r * (1.0 - 0.2 * t)

    loft(bm, crown_c, crown_r, 14, 24, "crown", close_top=True)

    def tint(co, nrm, fi):
        k = 1.0 + 0.14 * hs("felt", fi) + 0.07 * math.sin(co.x * 40 + co.y * 33)
        c = (FELT[0] * k, FELT[1] * k, FELT[2] * k)
        # sun-faded on top, darker under the brim
        c = mix(c, (0.34, 0.27, 0.2), 0.3 * smooth((co.z - cz) / (0.6 * s)))
        return mix(c, (c[0] * 0.5, c[1] * 0.5, c[2] * 0.5), smooth(-nrm.z) * 0.5)

    def hw(co):
        t = max(0.0, min(1.0, (co.z - (cz + 0.2 * s)) / (0.4 * s)))
        return {"Head": 1.0 - t, "Hat": t} if t > 0 else {"Head": 1.0}

    add("Hat", bm, "Felt", tint, hw)
    roots = []
    for k in range(7):
        a = math.pi * (0.25 + 0.5 * k / 6)
        x, y = math.cos(a) * 0.86 * s, math.sin(a) * 0.82 * s
        roots.append(Vector((x, y, brim_z(x, y, s) - 0.01 * s)))
    add("BrimRags", rag_strips("brimrag", roots, 0.34 * s, 0.08 * s, s), "Felt",
        flat_tint(FELT, 0.15, "brimrag"), rigid("Head"))
    add("HatBand", ring_rope((0, 0.02 * s, cz + 0.06 * s), 0.335 * s, 0.32 * s, 0.032 * s, n=28, wobble=0.015 * s, tag="band"),
        "Rope", flat_tint((0.5, 0.2, 0.08), tag="band"), rigid("Head"))
    # two crow feathers stuck in the band
    for fi, (fx, fyaw) in enumerate(((0.3, 0.2), (0.26, 0.6))):
        bm = bmesh.new()
        base = Vector((fx * s, (0.1 + 0.08 * fi) * s, cz + 0.08 * s))
        rows2 = []
        for j in range(8):
            t = j / 7
            q = base + Vector((0.14 * t + 0.05 * fi, 0.12 * t, 0.5 * t - 0.08 * t * t)) * s
            w = 0.055 * s * math.sin(t * math.pi) + 0.004 * s
            rows2.append((bm.verts.new(q + Vector((w, -w * 0.5, 0))), bm.verts.new(q - Vector((w, -w * 0.5, 0)))))
        for j in range(7):
            bm.faces.new((rows2[j][0], rows2[j][1], rows2[j + 1][1], rows2[j + 1][0]))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.005 * s)
        add("HatFeather%d" % fi, bm, "Feather", flat_tint(FEATHER, tag="hf%d" % fi), rigid("Hat"))


def build_scythe(s, B):
    """A long scythe upright in his right fist: a curved snath with two grips, a ferrule,
    and a long rusted blade sweeping out in front of him from the top."""
    hand = grip_center(s)
    bm = bmesh.new()

    def bend(t):
        return Vector((0.1 * math.sin(t * math.pi) * s, 0.08 * math.sin(t * math.pi * 1.5) * s, 0))

    bottom = hand + Vector((0, 0.02, -2.0)) * s
    top = hand + Vector((0, 0.06, 1.45)) * s
    tube(bm, polyline(bottom, top, 18, bend=bend), [0.045 * s] * 19, sides=8, noise=0.05, tag="snath")
    add("Snath", bm, "Wood", wood_tint("snath", base=(0.34, 0.22, 0.12)), rigid("R_Hand"))
    bm = bmesh.new()
    for z in (-0.95, 0.75):
        g = hand + Vector((0.06, 0.04, z)) * s
        tube(bm, polyline(g, g + Vector((0.05, -0.36, 0.05)) * s, 3), [0.032 * s] * 4, sides=6)
    add("Nibs", bm, "Wood", wood_tint("nib", base=(0.3, 0.2, 0.12)), rigid("R_Hand"))
    bm = bmesh.new()
    tube(bm, polyline(top - Vector((0, 0, 0.16 * s)), top + Vector((0, 0, 0.06 * s)), 2), [0.06 * s] * 3, sides=8)
    add("Ferrule", bm, "Iron", flat_tint(IRON, tag="fer"), rigid("R_Hand"))
    for gi, g in enumerate((-0.95, 0.75, 1.2)):
        add("SnathRope%d" % gi, ring_rope(hand + Vector((0.06 * s * (g + 2) / 3.5, 0.04 * s, g * s)), 0.065 * s, 0.065 * s, 0.017 * s, n=10, tag="sr%d" % gi),
            "Rope", flat_tint(ROPE, tag="sr%d" % gi), rigid("R_Hand"))
    # the blade: a long tapering crescent sweeping forward from the head and down
    bm = bmesh.new()
    n = 26
    spine, edge = [], []
    for i in range(n + 1):
        t = i / n
        ang = t * 1.45
        reach = 1.7 * s
        p = top + Vector((0.12 * s * t, -math.sin(ang) / math.sin(1.45) * reach, (0.1 - 0.7 * t * t) * s))
        width = (0.24 * (1.0 - t) ** 0.75 + 0.012) * s
        nick = 0.03 * s if h01("nick", i) > 0.78 and 0.15 < t < 0.9 else 0.0
        spine.append(bm.verts.new(p))
        edge.append(bm.verts.new(p + Vector((0, 0.06 * s * t, -width + nick))))
    for i in range(n):
        bm.faces.new((spine[i], spine[i + 1], edge[i + 1], edge[i]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02 * s)

    def blade_tint(co, nrm, fi):
        e = smooth((top.z + 0.1 * s - co.z) / (0.3 * s))
        c = mix(RUST, (0.66, 0.64, 0.6), e * 0.7)
        blot = 0.2 * hs("rust", round(co.y * 12), round(co.z * 12))
        return tuple(ch * (1.0 + blot) for ch in c)

    add("Blade", bm, "Iron", blade_tint, rigid("R_Hand"))


CROW_SCALE = 1.35


def build_crow(name, parent, perch, yaw):
    """A crow: plump body, round head, a heavy beak, folded wings, a fanned tail, ember
    eyes. Every piece rides its own crow bone."""
    o = Vector(perch)
    rot = Matrix.Rotation(yaw, 4, "Z")
    S = CROW_SCALE

    def P(x, y, z):
        return o + (rot @ (Vector((x, y, z)) * S))

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=12, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        taper = 1.0 - 0.25 * max(0.0, y)
        v.co = P(x * 0.085 * taper, y * 0.16 - 0.01, z * 0.08 * taper + 0.08 + 0.02 * y)
    add(name + "_Body", bm, "Feather", flat_tint(FEATHER, 0.3, name), rigid(name))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=9, radius=0.06 * S,
                              matrix=Matrix.Translation(P(0, -0.16, 0.15)))
    add(name + "_HeadMesh", bm, "Feather", flat_tint(FEATHER, 0.3, name + "h"), rigid(name + "_Head"))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.026 * S, radius2=0.002, depth=0.12 * S,
                          matrix=Matrix.Translation(P(0, -0.245, 0.135)) @ rot @ Matrix.Rotation(math.radians(98), 4, "X"))
    add(name + "_Beak", bm, "Beak", flat_tint(BEAK, 0.1, name + "b"), rigid(name + "_Head"))
    bm = bmesh.new()
    for sx in (1, -1):
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.013 * S, matrix=Matrix.Translation(P(0.043 * sx, -0.195, 0.168)))
    add(name + "_Eyes", bm, "ScarecrowGlow", flat_tint((1.0, 0.7, 0.25), 0.0), rigid(name + "_Head"))
    for side, sx in (("L", 1), ("R", -1)):
        bm = bmesh.new()
        rows = []
        for j in range(7):
            t = j / 6
            q = P(0.08 * sx, -0.06 + 0.32 * t, 0.12 - 0.035 * t)
            w = (0.075 * math.sin(min(1, t * 1.2 + 0.1) * math.pi * 0.8) + 0.012) * S
            # the primaries fray into a few feather points at the tail end
            if j >= 4:
                w *= 0.8 + 0.3 * (j % 2)
            rows.append((bm.verts.new(q), bm.verts.new(q + rot @ Vector((0.025 * sx * S, 0, -w)))))
        for j in range(6):
            f = (rows[j][0], rows[j + 1][0], rows[j + 1][1], rows[j][1])
            bm.faces.new(f if sx > 0 else tuple(reversed(f)))
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
        add(name + "_Wing" + side + "Mesh", bm, "Feather", flat_tint((0.07, 0.07, 0.11), 0.25, name + side), rigid(name + "_Wing" + side))
    bm = bmesh.new()
    c0 = bm.verts.new(P(0, 0.12, 0.08))
    fan = [bm.verts.new(P(0.075 * math.sin(a), 0.32 + 0.02 * (i % 2), 0.05 - 0.02 * math.cos(a)))
           for i, a in enumerate([(-0.6 + 1.2 * i / 6) for i in range(7)])]
    for i in range(6):
        bm.faces.new((c0, fan[i], fan[i + 1]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
    add(name + "_Tail", bm, "Feather", flat_tint(FEATHER, 0.2, name + "t"), rigid(name))
    bm = bmesh.new()
    for sx in (1, -1):
        tube(bm, polyline(P(0.03 * sx, -0.02, 0.03), P(0.03 * sx, -0.07, -0.005), 2), [0.008 * S] * 3, sides=4)
    add(name + "_Feet", bm, "Beak", flat_tint((0.15, 0.13, 0.1), 0.1, name + "f"), rigid(name))


# ---------------------------------------------------------------------------
# assembly: armature, mesh, weights, clips, export
# ---------------------------------------------------------------------------


def build_armature(name, layout):
    data = bpy.data.armatures.new(name + "Rig")
    arm = bpy.data.objects.new(name + "Rig", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, parent, head, tail in layout:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = 0.0
    for bname, parent, head, tail in layout:
        if parent:
            data.edit_bones[bname].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    data.display_type = "STICK"
    return arm


def finish_part(part, layout_names):
    me = bpy.data.meshes.new(part.name)
    part.bm.normal_update()
    part.bm.to_mesh(me)
    part.bm.free()
    obj = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(obj)
    if CLOTH[0] and part.mat in CLOTH_PARTS:
        # the boss's sackcloth: its own material with the weave (burlap_weave.py)
        obj.data.materials.append(W.cloth_material())
        W.box_uvs(obj, CLOTH_TILE)
    else:
        obj.data.materials.append(M.material("ScarecrowMatte" if part.mat in MERGED_MATTE else part.mat))
    color_part(obj, part.tint)
    weight_part(obj, part.weights, layout_names)
    return obj


def color_part(obj, tint):
    me = obj.data
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    data = []
    smooth_tint = getattr(tint, "smooth", False)
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            if smooth_tint:
                c = M.lin(tint(v.co, v.normal, v.index))
            else:
                c = M.lin(tint(v.co, poly.normal, poly.index))
            data.extend((max(0.0, c[0]), max(0.0, c[1]), max(0.0, c[2]), 1.0))
    col.data.foreach_set("color", data)


def weight_part(obj, weights, names):
    groups = {}
    for v in obj.data.vertices:
        for bone, w in weights(v.co).items():
            if w <= 0.0005:
                continue
            g = groups.get(bone)
            if g is None:
                g = groups[bone] = obj.vertex_groups.new(name=bone)
            g.add([v.index], w, "REPLACE")


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = name
    out.data.name = name
    return out


def build_character(kind):
    """kind 'thatchgrin' or 'strawling'. Returns (armature, mesh)."""
    PARTS.clear()
    boss = kind == "thatchgrin"
    s = 1.0 if boss else 0.46
    STRAW_DENSITY[0] = 1.0 if boss else 0.4
    CLOTH[0] = boss
    layout = bone_layout(s) + (crow_bones() if boss else [])
    B = {b[0]: b for b in layout}
    build_legs(s, B)
    build_torso(s, B, boss)
    build_yoke(s, B)
    build_arms(s, B, boss)
    head_obj = build_head(s, B, boss)
    if boss:
        build_hat(s, B)
        build_scythe(s, B)
        for name, parent, perch, yaw in crows_layout():
            build_crow(name, parent, perch, yaw)
    names = [b[0] for b in layout]
    objs = [finish_part(p, names) for p in PARTS]
    if head_obj is not None:
        g = head_obj.vertex_groups.new(name="Head")
        g.add([v.index for v in head_obj.data.vertices], 1.0, "REPLACE")
        objs.append(head_obj)
    body = join(objs, "Thatchgrin" if boss else "Strawling")
    M.shade_smooth(body, 0.9)
    # the folds sit in their own shade: occlusion baked into the vertex colour (rest pose)
    W.bake_occlusion(body, strength=0.7 if boss else 0.55, distance=0.6 * s)
    arm = build_armature("Thatchgrin" if boss else "Strawling", layout)
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    C.build_clips(arm, s, boss)
    return arm, body


# A creature rig's materials are not driven by the seasonal glow driver (the decor's), so
# each glow is authored at the strength it should hold: the candle and the eyes full (the
# renderer pins any *Glow material to its glow band), the carved flesh warm, the rind's
# light through the skin barely there.
EMISSION_STRENGTH = {"GourdLitSkin": 0.05, "GourdFlesh": 0.45, "GourdInner": 0.7}


def tune_emission():
    for name, strength in EMISSION_STRENGTH.items():
        mat = bpy.data.materials.get(name)
        if not mat or not mat.use_nodes:
            continue
        b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            b.inputs["Emission Strength"].default_value = strength


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export(arm, body, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm
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
        export_texcoords=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_def_bones=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else None
    blend_out = argv[argv.index("--blend") + 1] if "--blend" in argv else None
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = C.FPS
    built = []
    for kind in ("thatchgrin", "strawling"):
        if only and only != kind:
            continue
        arm, body = build_character(kind)
        built.append((kind, arm, body))
        print("SCARECROW_REPORT %s tris=%d verts=%d bones=%d actions=%s" % (
            kind, tri_count(body), len(body.data.vertices), len(arm.data.bones),
            ",".join(sorted(a.name for a in bpy.data.actions if a.name.startswith(C.prefix(kind == 'thatchgrin'))))))
        if kind == "thatchgrin" and len(built) > 0 and not only:
            # park the boss off to the side so the strawling builds beside him in the .blend
            arm.location = (0, 0, 0)
    tune_emission()
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        for kind, arm, body in built:
            C.prepare_export(arm, kind == "thatchgrin")
            export(arm, body, os.path.join(out_dir, "gourdlight_%s.glb" % kind))
    for kind, arm, body in built:
        if kind == "strawling" and len(built) > 1:
            arm.location = (3.5, 0, 0)
    if blend_out:
        bpy.ops.wm.save_as_mainfile(filepath=blend_out)


if __name__ == "__main__":
    main()
