# The Emberbristle Broom: Gourdlight Eve's ridable broom (Old Thatchgrin's keepsake,
# src/sim/content/mounts.ts 'emberbristle_broom'). A deterministic Blender factory: one
# rigged, animated, textured GLB, procedural from end to end (the model pipeline guide's
# concept, model, rig and animate steps, done in script; owner note 2026-10-17: a fully
# procedural Blender build is fine if it looks better).
#
# CONCEPT (front, left and back views: render with broom_preview.py --concept). A harvest
# broom fit for a lantern-night ride, read at a glance from a player's camera:
#   - a long, gnarled ash handle, knotted and slightly bowed, ending in front in a curled
#     crook from which a small carved pumpkin lantern swings on a short cord;
#   - a wrapped leather grip where the rider's hands go, and two worn brass collars;
#   - a big bushy head of straw bound in three twine lashings under a brass ferrule, the
#     strands flaring and splitting at the end, their tips smouldering ember-orange;
#   - an orange-and-plum ribbon tied in a bow at the binding, two long tails streaming back;
#   - two twig stirrups hanging from the binding, where the rider's feet rest.
# It hovers a hand above the ground (a GROUND mount like every mount: it never flies), so
# it is drawn long, about a third longer than a player is tall, and the rider sits astride
# its handle just ahead of the bristles.
#
# BUDGET (the guide's): a few thousand triangles (report printed as BROOM_REPORT), one
# 1024 px texture atlas painted here in numpy (bark, leather, brass, straw, ribbon, twine)
# and shipped as KTX2 by ship_broom.mjs; the lantern's candle and the ember tips are the
# two self-lit materials the renderer drives by name (BroomEmber, GourdGlow).
#
# RIG: Root > Body (the handle: everything rigid), Bristles (the head, swaying), the two
# ribbon tails (two bones each), the lantern on its cord, and the two stirrups. CLIPS at
# 30 fps, every loop closing on its first frame:
#   Idle  2.0 s  the head breathes and sways, the ribbons lift and settle, the lantern
#                swings gently; the hover bob itself is the renderer's (it carries the rider)
#   Walk  1.0 s  the head drags behind, the ribbons stream, the lantern swings wider
#   Run   0.6 s  everything streams back hard: the head flattened, the ribbons whipping,
#                the lantern swung back on its cord
# Frame: Blender Z-up, FRONT toward -Y (the crook leads), so the glTF export turns it into
# +Y up and +Z front, the game's facing-0 convention. Units are metres.
#
#   blender --background --factory-startup --python scripts/assets/gourdlight_eve/broom.py \
#     -- --out <glb> [--blend <file>]
#
# Determinism: no clock, no `random`; every variation is a sha256 of a tag (model.h01).

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M  # noqa: E402  (shared hashing helpers, the carved pumpkin)

TAU = math.pi * 2.0
h01 = M.h01
hs = M.hs
FPS = 30
ATLAS_PX = 1024

# Atlas regions (u0, v0, u1, v1).
R_BARK = (0.0, 0.5, 0.5, 1.0)
R_LEATHER = (0.5, 0.75, 1.0, 1.0)
R_BRASS = (0.5, 0.5, 1.0, 0.75)
R_STRAW = (0.0, 0.25, 1.0, 0.5)
R_RIBBON = (0.0, 0.0, 0.5, 0.25)
R_TWINE = (0.5, 0.0, 1.0, 0.25)

# The broom's layout along its length (metres, -Y is the front).
CROOK_Y = -1.32
GRIP_Y = (-1.02, -0.62)
COLLAR_YS = (-1.08, -0.56)
FERRULE_Y = 0.62
HEAD_Y = (0.62, 1.62)
SEAT_Y = 0.12

PARTS = []


# ---------------------------------------------------------------------------
# the texture atlas
# ---------------------------------------------------------------------------


def _noise(np, w, h, cells, tag):
    """Smooth value noise on a w x h grid (cells x cells lattice), deterministic."""
    lat = np.array([[h01(tag, i, j) for j in range(cells + 1)] for i in range(cells + 1)])
    ys = np.linspace(0, cells, h, endpoint=False)
    xs = np.linspace(0, cells, w, endpoint=False)
    yi = ys.astype(int)
    xi = xs.astype(int)
    fy = (ys - yi)[:, None]
    fx = (xs - xi)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = lat[yi][:, xi]
    b = lat[yi][:, xi + 1]
    c = lat[yi + 1][:, xi]
    d = lat[yi + 1][:, xi + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def paint_atlas():
    import numpy as np

    W = H = ATLAS_PX
    img = np.zeros((H, W, 3), dtype=np.float64)

    def region(r):
        u0, v0, u1, v1 = r
        return int(v0 * H), int(v1 * H), int(u0 * W), int(u1 * W)

    def srgb(c):
        return np.array(c, dtype=np.float64)

    # bark: dark ash, long grain streaks running down the handle (along V), knots
    y0, y1, x0, x1 = region(R_BARK)
    h, w = y1 - y0, x1 - x0
    grain = _noise(np, w, h, 6, "bark-grain-u")  # coarse
    streak = np.repeat(np.array([[h01("bark-streak", i) for i in range(w)]]), h, axis=0)
    fine = _noise(np, w, h, 48, "bark-fine")
    base = srgb((0.36, 0.24, 0.15))
    dark = srgb((0.17, 0.11, 0.07))
    light = srgb((0.52, 0.37, 0.24))
    t = 0.45 * grain + 0.35 * streak + 0.2 * fine
    col = dark[None, None, :] * (1 - t[..., None]) + light[None, None, :] * t[..., None]
    col = 0.6 * col + 0.4 * base[None, None, :]
    # dark grain lines
    lines = (np.sin((np.arange(w)[None, :] / w) * TAU * 9 + 4 * grain) > 0.92)
    col[lines] *= 0.6
    img[y0:y1, x0:x1] = col

    # leather: a dark oxblood strap wrapped in diagonal turns with a stitched edge
    y0, y1, x0, x1 = region(R_LEATHER)
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:h, 0:w]
    turn = ((xx / w + yy / h * 3.0) % 1.0)
    edge = np.minimum(turn, 1 - turn)
    n = _noise(np, w, h, 24, "leather")
    base = srgb((0.33, 0.16, 0.1)) * (0.8 + 0.3 * n[..., None])
    base[edge < 0.06] *= 0.45
    stitch = (edge > 0.1) & (edge < 0.13) & (((xx + yy) // 6) % 2 == 0)
    base[stitch] = srgb((0.78, 0.66, 0.44))
    img[y0:y1, x0:x1] = base

    # brass: warm gold, rubbed bright on the high spots, tarnish in the low
    y0, y1, x0, x1 = region(R_BRASS)
    h, w = y1 - y0, x1 - x0
    n = _noise(np, w, h, 10, "brass")
    f = _noise(np, w, h, 40, "brass-f")
    gold = srgb((0.78, 0.56, 0.22))
    tarn = srgb((0.32, 0.3, 0.16))
    t = np.clip(0.55 * n + 0.45 * f, 0, 1)[..., None]
    img[y0:y1, x0:x1] = gold * (0.4 + 0.6 * t) + tarn * (1 - t) * 0.5

    # straw: dense strands along V, root (low v) dusky, the TIP end (high v) burning
    y0, y1, x0, x1 = region(R_STRAW)
    h, w = y1 - y0, x1 - x0
    strand = np.repeat(np.array([[h01("straw-strand", i // 2) for i in range(w)]]), h, axis=0)
    n = _noise(np, w, h, 20, "straw")
    v = (np.arange(h) / h)[:, None]
    pale = srgb((0.9, 0.74, 0.4))
    dusk = srgb((0.55, 0.4, 0.18))
    t = np.clip(0.6 * strand + 0.4 * n, 0, 1)[..., None]
    col = dusk * (1 - t) + pale * t
    # the smouldering tips: the last fifth of the length runs to ember orange, then char
    ember = np.clip((v - 0.8) / 0.12, 0, 1)[..., None]
    col = col * (1 - ember) + srgb((1.0, 0.42, 0.08)) * ember
    char = np.clip((v - 0.95) / 0.05, 0, 1)[..., None]
    col = col * (1 - char) + srgb((0.16, 0.07, 0.03)) * char
    img[y0:y1, x0:x1] = col

    # ribbon: festival orange, plum edge stripes, a satin sheen line
    y0, y1, x0, x1 = region(R_RIBBON)
    h, w = y1 - y0, x1 - x0
    u = (np.arange(w) / w)[None, :].repeat(h, axis=0)
    col = np.zeros((h, w, 3)) + srgb((0.96, 0.42, 0.06))
    col[(u < 0.14) | (u > 0.86)] = srgb((0.26, 0.08, 0.24))
    col[(np.abs(u - 0.5) < 0.04)] = srgb((1.0, 0.62, 0.28))
    img[y0:y1, x0:x1] = col

    # twine: tan rope with a diagonal twist
    y0, y1, x0, x1 = region(R_TWINE)
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[0:h, 0:w]
    twist = np.sin((xx / w * 4 + yy / h * 12) * TAU) * 0.5 + 0.5
    col = srgb((0.6, 0.48, 0.3)) * (0.65 + 0.35 * twist[..., None])
    img[y0:y1, x0:x1] = col

    # to linear, RGBA, bottom-up as Blender stores it (row 0 is v = 0)
    lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
    rgba = np.ones((H, W, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(lin, 0, 1)
    image = bpy.data.images.new("BroomAtlas", W, H, alpha=False)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(_to_srgb_pixels(np, rgba))
    image.pack()
    return image


def _to_srgb_pixels(np, rgba):
    # Blender's float pixels on an sRGB image are display values: hand it sRGB
    out = rgba.copy()
    c = out[..., :3]
    out[..., :3] = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return out.ravel()


def atlas_material(image):
    mat = bpy.data.materials.new("BroomAtlas")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.82
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def ember_material():
    mat = bpy.data.materials.new("BroomEmber")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.32, 0.04, 1)
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.36, 0.05, 1)
    bsdf.inputs["Emission Strength"].default_value = 2.0
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


# ---------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------


class Part:
    def __init__(self, name, bm, mat, bone):
        self.name = name
        self.bm = bm
        self.mat = mat
        self.bone = bone  # vertex group name, or a callable (co) -> {bone: weight}


def frames_along(pts):
    """Parallel-transport frames along a polyline: (tangent, normal, binormal) per point."""
    out = []
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    n = t0.cross(ref).normalized()
    for i in range(len(pts)):
        if i == 0:
            t = t0
        elif i == len(pts) - 1:
            t = (pts[i] - pts[i - 1]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n).normalized()
        out.append((t, n, b))
    return out


def uv_tube(bm, uv, pts, radii, sides, region, v_repeat=1.0, cap=False, noise=0.0, tag="t"):
    """A tube swept along `pts`, with a seam column so its UVs wrap cleanly: u runs round
    the tube across `region`, v down its length (repeated `v_repeat` times)."""
    u0, v0, u1, v1 = region
    fr = frames_along(pts)
    rows = []
    length = [0.0]
    for i in range(1, len(pts)):
        length.append(length[-1] + (pts[i] - pts[i - 1]).length)
    total = max(1e-6, length[-1])
    for i, p in enumerate(pts):
        t, n, b = fr[i]
        row = []
        for k in range(sides + 1):
            a = (k % sides) / sides * TAU
            r = radii[i] * (1.0 + noise * hs(tag, i, k % sides))
            row.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r))
        rows.append(row)
    for i in range(len(pts) - 1):
        for k in range(sides):
            f = bm.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
            for loop in f.loops:
                vi = rows[i].index(loop.vert) if loop.vert in rows[i] else None
                ii = i if vi is not None else i + 1
                kk = vi if vi is not None else rows[i + 1].index(loop.vert)
                uu = u0 + (u1 - u0) * (kk / sides)
                vv = (length[ii] / total) * v_repeat
                vv = v0 + (v1 - v0) * (vv % 1.0 if v_repeat > 1.0 and vv % 1.0 > 1e-6 else min(vv, 1.0))
                loop[uv].uv = (uu, vv)
    if cap:
        for end in (0, len(pts) - 1):
            c = bm.verts.new(pts[end])
            ring = rows[end][:sides]
            for k in range(sides):
                a, b2 = ring[k], ring[(k + 1) % sides]
                f = bm.faces.new((c, b2, a) if end == 0 else (c, a, b2))
                for loop in f.loops:
                    loop[uv].uv = (u0 + (u1 - u0) * 0.5, v0 + (v1 - v0) * (0.02 if end == 0 else 0.98))
    return rows


def new_bm():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    return bm, uv


def handle_points():
    """The handle's spine: from just behind the ferrule to the crook's root, bowed a touch
    and kinked at two knots."""
    pts = []
    n = 24
    y_back = FERRULE_Y + 0.12
    y_front = CROOK_Y + 0.14
    for i in range(n + 1):
        t = i / n
        y = y_back + (y_front - y_back) * t
        bow = 0.025 * math.sin(t * math.pi)
        kink = 0.012 * math.sin(t * math.pi * 5 + 1.3)
        pts.append(Vector((kink, y, bow + 0.01 * math.sin(t * math.pi * 3))))
    return pts


def build_handle(atlas):
    bm, uv = new_bm()
    pts = handle_points()
    radii = []
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        knot = 0.006 * math.exp(-((t - 0.33) / 0.03) ** 2) + 0.007 * math.exp(-((t - 0.71) / 0.025) ** 2)
        radii.append(0.043 - 0.009 * t + knot)
    uv_tube(bm, uv, pts, radii, 10, R_BARK, v_repeat=3.0, noise=0.05, tag="handle")
    PARTS.append(Part("Handle", bm, atlas, "Body"))
    # the crook: the front curls up and back over itself
    bm, uv = new_bm()
    start = pts[-1]
    cpts = [start]
    for i in range(1, 17):
        t = i / 16
        a = t * 1.55 * math.pi
        r = 0.13 * (1 - 0.35 * t)
        cpts.append(start + Vector((0.0, -0.06 - math.sin(a) * r, (1 - math.cos(a)) * r)))
    crad = [0.034 - 0.018 * (i / 16) for i in range(17)]
    uv_tube(bm, uv, cpts, crad, 9, R_BARK, v_repeat=1.0, cap=True, noise=0.05, tag="crook")
    PARTS.append(Part("Crook", bm, atlas, "Body"))
    return pts, cpts


def ring(bm, uv, center, axis, radius, thick, region, n=16, m=6):
    """A torus band round `axis` at `center` (a collar or a lashing)."""
    axis = axis.normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    a1 = axis.cross(ref).normalized()
    a2 = axis.cross(a1).normalized()
    pts = []
    for i in range(n + 1):
        th = i / n * TAU
        pts.append(center + (a1 * math.cos(th) + a2 * math.sin(th)) * radius)
    uv_tube(bm, uv, pts, [thick] * len(pts), m, region, v_repeat=2.0)


def build_fittings(atlas, hpts):
    # the leather grip, a wrapped sleeve over the handle
    bm, uv = new_bm()
    seg = [p for p in hpts if GRIP_Y[0] <= p.y <= GRIP_Y[1]]
    uv_tube(bm, uv, seg, [0.052 + 0.003 * math.sin(i * 2.1) for i in range(len(seg))], 10, R_LEATHER, v_repeat=2.0)
    PARTS.append(Part("Grip", bm, atlas, "Body"))
    # brass collars at each end of the grip, and the ferrule where the head is bound
    bm, uv = new_bm()
    for cy in COLLAR_YS:
        c = min(hpts, key=lambda p: abs(p.y - cy))
        ring(bm, uv, c, Vector((0, 1, 0)), 0.05, 0.016, R_BRASS, n=12, m=4)
    ferrule = [Vector((0, FERRULE_Y - 0.06 + 0.12 * i / 4, 0)) for i in range(5)]
    uv_tube(bm, uv, ferrule, [0.062, 0.068, 0.07, 0.068, 0.062], 14, R_BRASS)
    PARTS.append(Part("Brass", bm, atlas, "Body"))


def head_radius(t, a):
    """The straw head's radius at t (0 = bound end, 1 = the core's closed tip) round angle
    a: narrow at the ferrule, swelling to a full brush by two thirds of its length, then
    drawing in to a rounded end (the loose strands splay on past it), flattened a touch
    top-to-bottom like a well-ridden broom."""
    if t <= 0.68:
        swell = 0.075 + 0.25 * math.sin(t / 0.68 * math.pi * 0.5) ** 1.25
    else:
        k = (t - 0.68) / 0.32
        swell = 0.325 - 0.21 * k * k
    flat = 1.0 - 0.18 * math.sin(a) ** 2
    rag = 1.0 + 0.07 * hs("head", int(a * 8), int(t * 9)) * t
    return swell * flat * rag


def build_head(atlas):
    bm, uv = new_bm()
    rings, sides = 12, 16
    y0, y1 = HEAD_Y
    rows = []
    for i in range(rings + 1):
        t = i / rings
        y = y0 + (y1 - y0) * t
        row = []
        for k in range(sides + 1):
            a = (k % sides) / sides * TAU
            r = head_radius(t, a)
            sag = -0.03 * t * t
            row.append(bm.verts.new((math.cos(a) * r, y + 0.06 * t * hs("tip", k % sides) * (t > 0.85), math.sin(a) * r + sag)))
        rows.append(row)
    for i in range(rings):
        for k in range(sides):
            f = bm.faces.new((rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]))
            for loop in f.loops:
                ii = i if loop.vert in rows[i] else i + 1
                kk = rows[ii].index(loop.vert)
                loop[uv].uv = (R_STRAW[0] + (R_STRAW[2] - R_STRAW[0]) * (kk / sides) * 3 % (R_STRAW[2] - R_STRAW[0]),
                               R_STRAW[1] + (R_STRAW[3] - R_STRAW[1]) * (ii / rings))
    # the core's end: drawn in to a rounded, ragged cap (the strands splay on past it)
    prev = rows[-1]
    for d, (dy, shrink) in enumerate(((0.06, 0.62), (0.1, 0.28))):
        nxt = []
        for k in range(sides + 1):
            v = prev[k].co
            nxt.append(bm.verts.new((v.x * shrink, v.y + dy * (0.8 + 0.4 * h01("dome", d, k % sides)), v.z * shrink - 0.01)))
        for k in range(sides):
            f = bm.faces.new((prev[k], prev[k + 1], nxt[k + 1], nxt[k]))
            for loop in f.loops:
                kk = (prev + nxt).index(loop.vert) % (sides + 1)
                loop[uv].uv = (R_STRAW[0] + (R_STRAW[2] - R_STRAW[0]) * (kk / sides), R_STRAW[1] + (R_STRAW[3] - R_STRAW[1]) * (0.86 + 0.04 * d))
        prev = nxt
    tip = bm.verts.new((0, prev[0].co.y + 0.03, -0.03))
    for k in range(sides):
        f = bm.faces.new((prev[k], prev[k + 1], tip))
        for loop in f.loops:
            loop[uv].uv = (R_STRAW[0] + (R_STRAW[2] - R_STRAW[0]) * (k / sides), R_STRAW[1] + (R_STRAW[3] - R_STRAW[1]) * 0.9)
    PARTS.append(Part("Head", bm, atlas, "Bristles"))

    # loose strands: lying along the brush and splaying past its end, three-sided
    bm, uv = new_bm()
    for s in range(70):
        a = h01("strand-a", s) * TAU
        t0 = 0.2 + 0.5 * h01("strand-t", s)
        r0 = head_radius(t0, a) * 0.96
        start = Vector((math.cos(a) * r0, y0 + (y1 - y0) * t0, math.sin(a) * r0))
        # every strand runs out past the core's end, the outer ones splaying wider
        reach_end = y1 + 0.08 + 0.32 * h01("strand-l", s)
        length = max(0.2, reach_end - start.y)
        out = Vector((math.cos(a), 0, math.sin(a))) * (0.05 + 0.16 * h01("strand-o", s))
        pts = []
        for k in range(4):
            t = k / 3
            pts.append(start + Vector((0, length * t, -0.04 * t * t)) + out * t * t)
        w = 0.0065 + 0.004 * h01("strand-w", s)
        uv_tube(bm, uv, pts, [w, w * 0.9, w * 0.7, w * 0.25], 3, (R_STRAW[0], R_STRAW[1] + 0.1 * (R_STRAW[3] - R_STRAW[1]), R_STRAW[2], R_STRAW[3]))
    PARTS.append(Part("Strands", bm, atlas, "Bristles"))

    # three twine lashings round the bound end
    bm, uv = new_bm()
    for i, t in enumerate((0.04, 0.13, 0.22)):
        y = y0 + (y1 - y0) * t
        r = head_radius(t, 0.0) + 0.012
        ring(bm, uv, Vector((0, y, -0.005 * i)), Vector((0, 1, 0)), r, 0.014, R_TWINE, n=12, m=4)
    PARTS.append(Part("Lashing", bm, atlas, "Bristles"))


def build_embers(ember):
    """Glowing ember beads caught in the tips of the straw."""
    bm = bmesh.new()
    y0, y1 = HEAD_Y
    for s in range(26):
        a = h01("ember-a", s) * TAU
        t = 0.72 + 0.26 * h01("ember-t", s)
        r = head_radius(t, a) * (0.85 + 0.3 * h01("ember-r", s))
        c = Vector((math.cos(a) * r, y0 + (y1 - y0) * t + 0.1 * h01("ember-y", s), math.sin(a) * r))
        r = 0.008 + 0.007 * h01("ember-s", s)
        vs = [bm.verts.new(c + d * r) for d in (Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1.6, 0)), Vector((0, -1.6, 0)), Vector((0, 0, 1)), Vector((0, 0, -1)))]
        for f in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            bm.faces.new([vs[i] for i in f])
    PARTS.append(Part("Embers", bm, ember, "Bristles"))


def build_ribbon(atlas):
    """A bow at the binding and two long tails streaming back over the head."""
    y = HEAD_Y[0] + 0.08
    top = head_radius(0.08, math.pi / 2) + 0.02
    for side, sx in (("L", 1), ("R", -1)):
        bm, uv = new_bm()
        # the bow loop
        lpts = []
        for i in range(11):
            a = i / 10 * TAU
            lpts.append(Vector((sx * (0.03 + 0.11 * (1 - math.cos(a)) * 0.5), y + 0.06 * math.sin(a), top + 0.09 * math.sin(a * 0.5) ** 2)))
        ribbon_strip(bm, uv, lpts, 0.055)
        # the tail: back and down along the head, a lazy S, cut in a swallow-tail
        tpts = []
        for i in range(12):
            t = i / 11
            yy = y + 0.95 * t
            th = (yy - HEAD_Y[0]) / (HEAD_Y[1] - HEAD_Y[0])
            xx = sx * (0.05 + 0.12 * t + 0.04 * math.sin(t * 5))
            # draped over the brush: just proud of its surface wherever the tail lies
            surf = math.sqrt(max(0.0, head_radius(min(1.0, th), math.pi / 2) ** 2 - xx * xx))
            tpts.append(Vector((xx, yy, surf + 0.03 + 0.02 * math.sin(t * 7))))
        ribbon_strip(bm, uv, tpts, 0.06, notch=True)
        PARTS.append(Part("Ribbon_" + side, bm, atlas, ribbon_weights(side, sx, y)))


def ribbon_strip(bm, uv, pts, width, notch=False):
    """A flat strip along `pts`, lying across the broom (its width runs in X)."""
    u0, v0, u1, v1 = R_RIBBON
    left, right = [], []
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        w = width * (1.0 if not notch else (1.0 if t < 0.92 else 0.9))
        a = Vector((w * 0.5, 0, 0))
        left.append(bm.verts.new(p - a))
        right.append(bm.verts.new(p + a + (Vector((0, -0.04, 0)) if notch and i == len(pts) - 1 else Vector())))
    for i in range(len(pts) - 1):
        f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        vv = (v0, v1)
        for loop in f.loops:
            ii = i if loop.vert in (left[i], right[i]) else i + 1
            uu = u0 if loop.vert in left else u1
            loop[uv].uv = (uu, vv[0] + (vv[1] - vv[0]) * (ii / (len(pts) - 1)))
    bmesh.ops.solidify(bm, geom=[f for f in bm.faces], thickness=0.004)


def ribbon_weights(side, sx, y):
    def w(co):
        t = max(0.0, min(1.0, (co.y - y) / 0.95))
        if t < 0.08:
            return {"Bristles": 1.0}
        if t < 0.5:
            k = (t - 0.08) / 0.42
            return {"Ribbon%s1" % side: 1.0 - 0.5 * k, "Bristles": 0.5 * (1 - k), "Ribbon%s2" % side: 0.5 * k}
        k = (t - 0.5) / 0.5
        return {"Ribbon%s2" % side: 0.5 + 0.5 * k, "Ribbon%s1" % side: 0.5 * (1 - k)}

    return w


def build_stirrups(atlas):
    """Two twig loops hanging off the first lashing, one each side, for the rider's feet."""
    for side, sx in (("L", 1), ("R", -1)):
        bm, uv = new_bm()
        top = Vector((sx * 0.12, HEAD_Y[0] + 0.04, -0.05))
        loop_c = top + Vector((sx * 0.02, -0.05, -0.3))
        uv_tube(bm, uv, [top, top + Vector((sx * 0.01, -0.02, -0.12)), loop_c + Vector((0, 0, 0.07))], [0.008, 0.008, 0.008], 5, R_TWINE)
        pts = []
        for i in range(15):
            a = i / 14 * TAU
            pts.append(loop_c + Vector((sx * 0.02 * math.sin(a), -0.085 * math.sin(a), 0.07 * math.cos(a))))
        uv_tube(bm, uv, pts, [0.015] * len(pts), 6, R_BARK, noise=0.08, tag="stirrup" + side)
        PARTS.append(Part("Stirrup_" + side, bm, atlas, "Stirrup_" + side))


def build_lantern(cpts):
    """A small carved pumpkin lantern swinging from the crook on a short cord."""
    coll = bpy.context.scene.collection
    tip = cpts[-1]
    cord_top = tip + Vector((0, -0.01, -0.02))
    hang = cord_top + Vector((0, 0, -0.16))
    lantern = M.carved_pumpkin("BroomLantern", "broom-lantern", coll, 0.115, 0.14, 8, "grin", 12, 7, M.PALETTE_ORANGE, shell=0.014, glow_r=0.45)
    lantern.location = hang - Vector((0, 0, 0.075))
    lantern.rotation_euler = (0, 0, math.pi)
    bm, uv = new_bm()
    uv_tube(bm, uv, [cord_top, cord_top + Vector((0.004, 0, -0.1)), hang], [0.006, 0.006, 0.006], 5, R_TWINE)
    PARTS.append(Part("Cord", bm, None, "Lantern"))
    return lantern


# ---------------------------------------------------------------------------
# rig, skin, clips
# ---------------------------------------------------------------------------

BONES = [
    ("Root", None, (0, 0, 0), (0, 0, 0.25)),
    ("Body", "Root", (0, 0.4, 0), (0, -0.4, 0)),
    ("Bristles", "Body", (0, HEAD_Y[0], 0), (0, HEAD_Y[1] - 0.2, 0)),
    ("RibbonL1", "Bristles", (0.05, HEAD_Y[0] + 0.1, 0.2), (0.09, HEAD_Y[0] + 0.45, 0.17)),
    ("RibbonL2", "RibbonL1", (0.09, HEAD_Y[0] + 0.45, 0.17), (0.13, HEAD_Y[0] + 0.85, 0.1)),
    ("RibbonR1", "Bristles", (-0.05, HEAD_Y[0] + 0.1, 0.2), (-0.09, HEAD_Y[0] + 0.45, 0.17)),
    ("RibbonR2", "RibbonR1", (-0.09, HEAD_Y[0] + 0.45, 0.17), (-0.13, HEAD_Y[0] + 0.85, 0.1)),
    ("Lantern", "Body", None, None),  # placed from the crook tip at build
    ("Stirrup_L", "Bristles", (0.11, HEAD_Y[0] + 0.03, -0.04), (0.11, HEAD_Y[0] - 0.04, -0.34)),
    ("Stirrup_R", "Bristles", (-0.11, HEAD_Y[0] + 0.03, -0.04), (-0.11, HEAD_Y[0] - 0.04, -0.34)),
]


def build_armature(lantern_top):
    arm_data = bpy.data.armatures.new("EmberbristleBroom")
    arm = bpy.data.objects.new("EmberbristleBroom", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail in BONES:
        b = arm_data.edit_bones.new(name)
        if name == "Lantern":
            head = tuple(lantern_top)
            tail = tuple(lantern_top + Vector((0, 0, -0.25)))
        b.head = head
        b.tail = tail
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def finish(atlas, ember):
    objs = []
    for p in PARTS:
        print("BROOM_PART %s tris=%d" % (p.name, sum(len(f.verts) - 2 for f in p.bm.faces)))
        me = bpy.data.meshes.new(p.name)
        p.bm.to_mesh(me)
        p.bm.free()
        obj = bpy.data.objects.new(p.name, me)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(p.mat if p.mat is not None else atlas)
        weights = p.bone if callable(p.bone) else (lambda co, b=p.bone: {b: 1.0})
        groups = {}
        for v in obj.data.vertices:
            for bone, w in weights(v.co).items():
                if w <= 0:
                    continue
                g = groups.get(bone) or obj.vertex_groups.new(name=bone)
                groups[bone] = g
                g.add([v.index], w, "REPLACE")
        objs.append(obj)
    return objs


def key_pose(arm, t, pose):
    """pose: bone -> (rx, ry, rz degrees in the bone's local frame, optional loc)."""
    f = 1 + t * FPS
    for pb in arm.pose.bones:
        rot = pose.get(pb.name, (0, 0, 0))
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Euler(tuple(math.radians(x) for x in rot[:3]), "XYZ").to_quaternion()
        pb.location = rot[3] if len(rot) > 3 else (0, 0, 0)
        pb.keyframe_insert("rotation_quaternion", frame=f)
        pb.keyframe_insert("location", frame=f)


def clip(arm, name, period, amp_head, amp_ribbon, amp_lantern, drag, stream, steps=8):
    act = bpy.data.actions.new("Broom|" + name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for k in range(steps + 1):
        t = period * k / steps
        ph = k / steps * TAU
        pose = {
            # the head: a slow figure-eight sway, dragged down-and-back at speed
            "Bristles": (drag + amp_head * math.sin(ph), 0, amp_head * 0.8 * math.sin(ph * 2 + 0.6)),
            # the ribbon tails: a travelling wave, lifted and streamed back at speed
            "RibbonL1": (stream + amp_ribbon * math.sin(ph + 0.3), 0, amp_ribbon * 0.5 * math.sin(ph * 2)),
            "RibbonL2": (stream * 0.6 + amp_ribbon * 1.4 * math.sin(ph - 0.9), 0, amp_ribbon * 0.6 * math.sin(ph * 2 - 0.8)),
            "RibbonR1": (stream + amp_ribbon * math.sin(ph + 1.5), 0, -amp_ribbon * 0.5 * math.sin(ph * 2 + 0.4)),
            "RibbonR2": (stream * 0.6 + amp_ribbon * 1.4 * math.sin(ph + 0.3), 0, -amp_ribbon * 0.6 * math.sin(ph * 2 - 0.2)),
            # the lantern: a pendulum on its cord, swung back by the ride
            "Lantern": (-stream * 0.8 + amp_lantern * math.sin(ph), 0, amp_lantern * 0.5 * math.sin(ph + 1.2)),
            "Stirrup_L": (-drag * 0.5 + amp_head * 0.6 * math.sin(ph + 0.8), 0, 0),
            "Stirrup_R": (-drag * 0.5 + amp_head * 0.6 * math.sin(ph + 1.6), 0, 0),
        }
        key_pose(arm, t, pose)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()
    act["duration"] = period
    return act


def fcurves(act):
    out = []
    if hasattr(act, "layers") and len(act.layers) > 0:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
    elif hasattr(act, "fcurves"):
        out.extend(act.fcurves)
    return out


def build_clips(arm):
    clip(arm, "Idle", 2.0, 2.5, 6, 6, 0, 0)
    clip(arm, "Walk", 1.0, 4, 12, 10, 6, -18)
    clip(arm, "Run", 0.6, 5, 16, 8, 12, -38)
    arm.animation_data.action = bpy.data.actions["Broom|Idle"]


def tri_count(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def export(arm, body, path):
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
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
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_vertex_color="MATERIAL",
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
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    blend = argv[argv.index("--blend") + 1] if "--blend" in argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    PARTS.clear()
    image = paint_atlas()
    atlas = atlas_material(image)
    ember = ember_material()
    hpts, cpts = build_handle(atlas)
    build_fittings(atlas, hpts)
    build_head(atlas)
    build_embers(ember)
    build_ribbon(atlas)
    build_stirrups(atlas)
    lantern = build_lantern(cpts)
    objs = finish(atlas, ember)
    # the lantern keeps its own vertex-coloured pumpkin materials, rigid to its bone
    g = lantern.vertex_groups.new(name="Lantern")
    g.add([v.index for v in lantern.data.vertices], 1.0, "REPLACE")
    bpy.context.view_layer.objects.active = lantern
    lantern.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    objs.append(lantern)
    print("BROOM_PART Lantern tris=%d" % sum(len(q.vertices) - 2 for q in lantern.data.polygons))
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Broom"
    for poly in body.data.polygons:
        poly.use_smooth = True
    for name, strength in (("GourdLitSkin", 0.05), ("GourdFlesh", 0.45), ("GourdInner", 0.7)):
        mat = bpy.data.materials.get(name)
        b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat else None
        if b:
            b.inputs["Emission Strength"].default_value = strength
    arm = build_armature(cpts[-1] + Vector((0, -0.01, -0.02)))
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    build_clips(arm)
    print("BROOM_REPORT tris=%d verts=%d bones=%d materials=%s" % (
        tri_count([body]), len(body.data.vertices), len(arm.data.bones),
        ",".join(m.name for m in body.data.materials)))
    if out:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        export(arm, body, out)
        arm.animation_data.action = bpy.data.actions["Broom|Idle"]
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)


if __name__ == "__main__":
    main()
