"""The Smith's Seal Gate as carved masses (build_sanctum_entrance.py).

The Gravewyrm Sanctum's interior kit sculpts its ice and slate as signed
distance fields (kit/gravewyrm_sculpt.py), the way the Wildheart Maw's head is
sculpted (entrance/wildheart_idol_sculpt.py). The gate at the door is the same
mountain and the same Smith, so it is sculpted the same way:

  pylon_field()     a battered, chamfered shaft of coursed black ashlar on a
                    stepped plinth with a roll moulding, a corbelled capital,
                    a sunk relief panel (the Smith's tools: hammer and tongs
                    crossed over the anvil on one pylon, the bellows and the
                    flame over the anvil on the other) and a column of
                    incised rune channels above it; chipped arrises, cracks,
                    rime lodged on every ledge
  lintel_field()    the two lintel monoliths either side of the torn-out
                    keystone, a rune frieze, a cornice on dentils, and the
                    stepped crown over them whose seal disc (the anvil) is
                    split down the middle by the fissure the keystone left
  spur_field()      the mountain's spur the tunnel is cut into: cleaved slate
                    blocks stacked on a dip, smooth-unioned into one crag,
                    seated on the terrain, the tunnel bored through it
  icefall_field()   the glacier tongue spilling through the ridge notch: a
                    stack of serac blocks breaking over each other down the
                    cliff, crevasses between them, a snow cap blending into
                    the face above, and two rock cheeks

Each field is meshed through OpenVDB (gravewyrm_sculpt.mesh_sculpt) and
decimated to its budget, then handed to an hckit Piece with a colour per
VERTEX (smooth gradients, no per-face checkerboard): a baked ambient
occlusion from the field itself darkens every joint, groove and crack, worn
arrises catch a paler tone, and rime gathers on whatever faces up.

Coordinates are Blender's (X west, Y SOUTH, Z up, the door at the origin);
G(lx, lz, y) takes door-local game coordinates. Deterministic: every draw
comes from a seeded generator and every noise is seeded.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, Prim, RoundBox, RoundCone

STONE, GLOW, ICE = 0, 1, 2


def G(lx, lz, y):
    return np.array((lx, -lz, y), dtype=np.float64)


def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


# ------------------------------------------------------------------ primitives
class Convex(Prim):
    """The intersection of half spaces n . P <= d (world normals, unit): crisp
    faces, chamfers and batters."""

    def __init__(self, planes, lo, hi):
        self.N = np.array([p[0] for p in planes], dtype=np.float64)
        self.d = np.array([p[1] for p in planes], dtype=np.float64)
        self.lo, self.hi = np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        out = None
        for n, d in zip(self.N, self.d):
            v = n[0] * X + n[1] * Y + n[2] * Z - d
            out = v if out is None else np.maximum(out, v)
        return out


def batter_plane(h, a0, a1, y0, y1):
    """A face whose horizontal outward direction is h (unit, Blender XY) and
    whose offset along h runs from a0 at height y0 to a1 at y1."""
    k = (a1 - a0) / (y1 - y0)
    n = np.array((h[0], h[1], -k))
    ln = np.linalg.norm(n)
    return (n / ln, (a0 - k * y0) / ln)


def frustum(x0, x1, z0, z1, y0, y1, top_in=(0.0, 0.0, 0.0, 0.0), chamfer=0.0, chamfer_top=None):
    """A chamfered frustum from local game bounds (lx x0..x1, lz z0..z1, y
    y0..y1); top_in insets the top's (x0, x1, z0, z1) faces by that much."""
    X0, X1 = x0, x1
    Ys, Yn = -z0, -z1                     # Blender Y of the south and north faces
    i0, i1, iz0, iz1 = top_in
    faces = [
        ((1.0, 0.0), X1, X1 - i1),
        ((-1.0, 0.0), -X0, -(X0 + i0)),
        ((0.0, 1.0), Ys, Ys - iz0),
        ((0.0, -1.0), -Yn, -(Yn + iz1)),
    ]
    planes = [batter_plane(h, a0, a1, y0, y1) for (h, a0, a1) in faces]
    if chamfer > 0:
        ct = chamfer if chamfer_top is None else chamfer_top
        r2 = math.sqrt(0.5)
        for (ha, a0, a1), (hb, b0, b1) in ((faces[0], faces[2]), (faces[0], faces[3]), (faces[1], faces[2]),
                                           (faces[1], faces[3])):
            h = ((ha[0] + hb[0]) * r2, (ha[1] + hb[1]) * r2)
            planes.append(batter_plane(h, (a0 + b0 - chamfer) * r2, (a1 + b1 - ct) * r2, y0, y1))
    planes.append(((0.0, 0.0, 1.0), y1))
    planes.append(((0.0, 0.0, -1.0), -y0))
    lo = (min(X0, X1) - 0.2, min(Ys, Yn) - 0.2, y0 - 0.2)
    hi = (max(X0, X1) + 0.2, max(Ys, Yn) + 0.2, y1 + 0.2)
    return Convex(planes, lo, hi)


def poly_sdf(u, v, pts):
    """Signed distance to a closed 2D polygon (inside negative)."""
    d = np.full(np.shape(u), np.inf)
    s = np.ones(np.shape(u))
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[i - 1]
        ex, ey = bx - ax, by - ay
        wx, wy = u - ax, v - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        dx, dy = wx - ex * t, wy - ey * t
        d = np.minimum(d, dx * dx + dy * dy)
        c1 = v >= ay
        c2 = v < by
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


class Frame:
    """A carving frame on a face: origin O, U across (screen right seen from
    the front), V up the face, W out of it."""

    def __init__(self, O, U, W):
        self.O = np.asarray(O, dtype=np.float64)
        self.U = np.asarray(U, dtype=np.float64) / np.linalg.norm(U)
        W = np.asarray(W, dtype=np.float64)
        W = W - self.U * (W @ self.U)
        self.W = W / np.linalg.norm(W)
        self.V = np.cross(self.W, self.U)

    def at(self, u, v, w=0.0):
        return self.O + self.U * u + self.V * v + self.W * w

    def local(self, X, Y, Z):
        px, py, pz = X - self.O[0], Y - self.O[1], Z - self.O[2]
        u = px * self.U[0] + py * self.U[1] + pz * self.U[2]
        v = px * self.V[0] + py * self.V[1] + pz * self.V[2]
        w = px * self.W[0] + py * self.W[1] + pz * self.W[2]
        return u, v, w


class Extrude(Prim):
    """A 2D polygon (frame u, v) extruded along the frame's W from w0 to w1,
    its edges rounded by r (the outer extents kept)."""

    def __init__(self, frame, pts, w0, w1, r=0.0):
        self.f, self.pts, self.w0, self.w1, self.r = frame, list(pts), w0, w1, r
        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        corners = [frame.at(u, v, w) for u in (min(us), max(us)) for v in (min(vs), max(vs)) for w in (w0, w1)]
        c = np.array(corners)
        self.lo, self.hi = c.min(axis=0) - 0.1, c.max(axis=0) + 0.1

    def dist(self, X, Y, Z):
        u, v, w = self.f.local(X, Y, Z)
        d2 = poly_sdf(u, v, self.pts) + self.r
        dz = np.abs(w - (self.w0 + self.w1) / 2) - (self.w1 - self.w0) / 2 + self.r
        out = np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0)
        return out - self.r


class Slab(Prim):
    """The plane through P with normal n, as a zero-thickness slab bounded by a
    box (a joint line where it meets a surface)."""

    def __init__(self, P, n, lo, hi):
        self.P = np.asarray(P, dtype=np.float64)
        n = np.asarray(n, dtype=np.float64)
        self.n = n / np.linalg.norm(n)
        self.lo, self.hi = np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        return np.abs((X - self.P[0]) * self.n[0] + (Y - self.P[1]) * self.n[1] + (Z - self.P[2]) * self.n[2])


def rect(cu, cv, w, h, ang=0.0):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for (a, b) in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cu + a * c - b * s, cv + a * s + b * c))
    return out


def ellipse(cu, cv, a, b, n=18, ang=0.0, squeeze=None):
    c, s = math.cos(ang), math.sin(ang)
    out = []
    for i in range(n):
        t = math.tau * i / n
        x, y = math.cos(t) * a, math.sin(t) * b
        if squeeze is not None:
            x *= 1.0 - squeeze * (0.5 - 0.5 * math.sin(t))
        out.append((cu + x * c - y * s, cv + x * s + y * c))
    return out


def groove_polyline(f, pts, depth, width):
    f.groove(Polyline([np.asarray(p) for p in pts], 0.0), depth, width)


def crack_path(rng, start, direction, length, steps, wander=0.35):
    """A jagged crack polyline in a frame's (u, v) from start along direction."""
    u, v = start
    ang = math.atan2(direction[1], direction[0])
    out = [(u, v)]
    seg = length / steps
    for _ in range(steps):
        ang += rng.uniform(-wander, wander)
        u += math.cos(ang) * seg
        v += math.sin(ang) * seg
        out.append((u, v))
    return out


# ------------------------------------------------------------------ meshing and paint
def ao_and_edge(field, P, N):
    """Baked occlusion in [0, 1] (1 open) and an arris-wear term in [0, 1]."""
    occ = np.zeros(len(P))
    for d, w in ((0.08, 0.3), (0.22, 0.4), (0.55, 0.3)):
        f = field.sample(P + N * d)
        occ += w * np.clip((d - f) / d, 0.0, 1.0)
    d = 0.07
    f = field.sample(P - N * d)
    edge = np.clip((f + d) / d - 0.15, 0.0, 1.0)
    return np.clip(1.0 - occ, 0.0, 1.0), edge


_MESHED = [0]


def add_sculpt(p, field, name, target, paint, mat=STONE, smooth=True, mat_of=None):
    """Mesh a field into a piece. paint(P (n, 3), N (n, 3)) returns per-vertex
    sRGB (n, 3); every loop of a vertex takes its colour. mat_of(face centres
    (m, 3)) may pick a material slot per face instead of `mat`."""
    # Blender keeps an imported volume by its file path: every mesh gets its
    # own name, or a second field would mesh as the first one again
    _MESHED[0] += 1
    verts, faces = gs.mesh_sculpt(field, _bpy(), '%s_%d' % (name, _MESHED[0]), target)
    bm = p.bm
    vs = [bm.verts.new(Vector(v)) for v in verts]
    made = []
    for poly in faces:
        try:
            made.append(bm.faces.new([vs[i] for i in poly]))
        except ValueError:
            pass
    for f in made:
        f.normal_update()
    for v in vs:
        v.normal_update()
    P = np.array([tuple(v.co) for v in vs])
    N = np.array([tuple(v.normal) for v in vs])
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    col = np.clip(paint(P, N), 0.0, 1.0)
    idx = {v: i for i, v in enumerate(vs)}
    mats = None
    if mat_of is not None and made:
        mats = mat_of(np.array([tuple(f.calc_center_median()) for f in made]))
    for k, f in enumerate(made):
        f.smooth = smooth
        f.material_index = int(mats[k]) if mats is not None else mat
        for loop in f.loops:
            c = col[idx[loop.vert]]
            loop[p.col] = (float(c[0]), float(c[1]), float(c[2]), 1.0)
    return made


def _bpy():
    import bpy
    return bpy


def sharpen(obj, degrees=38.0):
    """Smooth shading with sharp edges where the faces meet steeper than
    `degrees` (so a chamfer reads crisp and a carved swell reads soft)."""
    me = obj.data
    try:
        me.set_sharp_from_angle(angle=math.radians(degrees))
    except Exception:
        pass


# ------------------------------------------------------------------ the Smith's runes
# Each glyph is a set of strokes in a unit cell (u across, v up): the Smith's
# marks, angular and language free.
GLYPHS = [
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.75), (0.85, 1.0)), ((0.5, 0.45), (0.85, 0.7)), ((0.5, 0.2), (0.18, 0.0))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.15, 0.55), (0.5, 0.85)), ((0.5, 0.85), (0.85, 0.55)), ((0.28, 0.12), (0.72, 0.3))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 1.0), (0.85, 0.8)), ((0.85, 0.8), (0.5, 0.6)), ((0.5, 0.35), (0.18, 0.15))],
    [((0.3, 0.0), (0.3, 1.0)), ((0.7, 0.0), (0.7, 1.0)), ((0.3, 0.85), (0.7, 0.55)), ((0.3, 0.45), (0.7, 0.15))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.95), (0.15, 0.65)), ((0.15, 0.65), (0.5, 0.35)), ((0.5, 0.35), (0.85, 0.1))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.9), (0.82, 0.75)), ((0.5, 0.6), (0.82, 0.45)), ((0.5, 0.3), (0.82, 0.15))],
    [((0.35, 0.0), (0.35, 0.7)), ((0.35, 0.7), (0.68, 1.0)), ((0.35, 0.4), (0.75, 0.4)), ((0.75, 0.4), (0.75, 0.0))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.2, 0.32), (0.8, 0.72)), ((0.2, 0.72), (0.5, 0.52)), ((0.5, 1.0), (0.2, 0.86))],
]


def glyph_strokes(frame, glyph, cu, v0, size):
    """The strokes of one glyph as frame (u, v) segments."""
    out = []
    for (a, b) in GLYPHS[glyph % len(GLYPHS)]:
        out.append(((cu + (a[0] - 0.5) * size, v0 + a[1] * size), (cu + (b[0] - 0.5) * size, v0 + b[1] * size)))
    return out


def carve_glyph(field, frame, strokes, r, w=0.0):
    for (a, b) in strokes:
        field.sub(RoundCone(frame.at(a[0], a[1], w), frame.at(b[0], b[1], w), r, r), 0.015)


def inlay_quads(frame, strokes, width, w):
    """The lit inlay of each stroke: a quad on the channel floor (Blender
    corners, facing W)."""
    quads = []
    for (a, b) in strokes:
        du, dv = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(du, dv)
        if ln < 1e-6:
            continue
        tu, tv = du / ln, dv / ln
        nu, nv = -tv, tu
        e = width * 0.5
        pts = []
        for (su, sv) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pu = (a[0] if su < 0 else b[0]) + su * tu * e + sv * nu * e
            pv = (a[1] if su < 0 else b[1]) + su * tv * e + sv * nv * e
            pts.append(frame.at(pu, pv, w))
        quads.append(pts)
    return quads


def add_quads(p, quads, color, mat, facing=(0.0, 1.0, 0.0)):
    """Flat quads (Blender corners), each wound to face `facing` (south by
    default: the unlit inlays are drawn front side only)."""
    for pts in quads:
        vs = [p.bm.verts.new(Vector(tuple(c))) for c in pts]
        f = p.bm.faces.new(vs)
        f.normal_update()
        if f.normal.dot(Vector(facing)) < 0:
            f.normal_flip()
        f.material_index = mat
        for loop in f.loops:
            loop[p.col] = (*color, 1.0)


# ------------------------------------------------------------------ the pylons
# Local game layout (lx, lz, y): the sim's pylon collider is lx 2.0..5.3 by lz
# -2.2..2.8, its inner face the walk-in lane's edge (|lx| 2.0). Nothing here
# reaches past it at walking height.
PLINTH_TIERS = [
    # (x0, x1, z0, z1, y1, chamfer)
    (2.0, 5.3, -2.12, 2.8, 0.42, 0.08),
    (2.0, 5.12, -1.9, 2.72, 0.98, 0.1),
]
ROLL = dict(x0=2.06, x1=5.02, z0=-1.62, z1=2.62, y0=0.98, y1=1.42, r=0.2)
SHAFT_B = dict(x0=2.22, x1=4.96, z0=-1.26, z1=2.46, y=1.42)
SHAFT_T = dict(x0=2.4, x1=4.72, z0=-1.02, z1=2.24, y=10.2)
SHAFT_CHAMFER = 0.24
COURSES = [1.5, 1.42, 1.5, 1.44, 1.52, 1.4]
CAPITAL = [
    # (x0, x1, z0, z1, y0, y1)
    (2.26, 4.88, -1.2, 2.42, 10.2, 10.46),
    (2.08, 5.2, -1.4, 2.56, 10.46, 10.9),
]
PANEL = dict(cx=3.6, v0=2.25, v1=6.75, w=1.62, depth=0.15, frame=0.13)
RUNE_COL = dict(cx=3.92, v0=7.15, step=1.0, size=0.72, n=3)


def shaft_front_lz(y):
    t = (y - SHAFT_B['y']) / (SHAFT_T['y'] - SHAFT_B['y'])
    return SHAFT_B['z0'] + (SHAFT_T['z0'] - SHAFT_B['z0']) * t


def shaft_x(y, key, s):
    t = (y - SHAFT_B['y']) / (SHAFT_T['y'] - SHAFT_B['y'])
    return s * (SHAFT_B[key] + (SHAFT_T[key] - SHAFT_B[key]) * t)


def panel_floor_shade(s):
    """Darken the relief panel's sunk floor (the gate faces south and is lit
    from behind at noon, so the carving must read in the shade)."""
    fr = face_frame(s)
    pc = -s * PANEL['cx']

    def shade(P, N):
        u, v, w = fr.local(P[:, 0], P[:, 1], P[:, 2])
        inside = (np.abs(u - pc) < PANEL['w'] / 2 + 0.02) & (v > PANEL['v0'] - 0.02) & (v < PANEL['v1'] + 0.02)
        return np.where(inside & (w < -0.1), 0.62, 1.0)

    return shade


def face_frame(s):
    """The pylon's south face as a carving frame (u = screen right, i.e. east)."""
    yb, yt = SHAFT_B['y'], SHAFT_T['y']
    zb, zt = SHAFT_B['z0'], SHAFT_T['z0']
    slope = (zt - zb) / (yt - yb)          # lz gained per yard up (the face leans back)
    O = G(0.0, zb - slope * yb, 0.0)       # the face plane extended to y 0 at lx 0
    W = np.array((0.0, 1.0, slope))
    return Frame(O, (-1.0, 0.0, 0.0), W)


def _span(s, a, b):
    return (min(s * a, s * b), max(s * a, s * b))


def pylon_tools(s):
    """The relief's tool outlines in frame (u, v) about the panel centre. West
    (s = +1): the hammer and the tongs crossed over the anvil. East: the
    bellows breathing on the flame over the anvil."""
    anvil = [(u * 0.92 + 0.06, v) for (u, v) in (
        (-0.6, -2.0), (-0.14, -2.0), (-0.08, -1.9), (0.08, -1.9), (0.14, -2.0), (0.6, -2.0), (0.52, -1.86),
        (0.3, -1.72), (0.24, -1.5), (0.3, -1.34), (0.5, -1.27), (0.7, -1.25), (0.7, -0.9), (-0.3, -0.9),
        (-0.55, -0.95), (-0.75, -1.02), (-0.92, -1.08), (-0.72, -1.15), (-0.45, -1.21), (-0.3, -1.27),
        (-0.24, -1.5), (-0.3, -1.72), (-0.52, -1.86))]
    shapes = [anvil]
    if s > 0:
        # the hammer: a long haft from low right to high left, the head
        # square across its top
        ha = math.radians(118)
        shapes.append(rect(0.04, 0.2, 0.17, 2.25, ha - math.pi / 2))
        hc = (0.04 + math.cos(ha) * 1.1, 0.2 + math.sin(ha) * 1.1)
        shapes.append(rect(hc[0], hc[1], 0.98, 0.4, ha - math.pi / 2))
        shapes.append(rect(hc[0], hc[1], 0.4, 0.56, ha - math.pi / 2))
        # the tongs: two reins from low left to high right, crossing at the
        # pivot, their jaws bent open at the top
        ta = math.radians(62)
        for off in (-0.075, 0.075):
            shapes.append(rect(0.05 + off * math.sin(ta), 0.1 - off * math.cos(ta), 0.1, 2.0, ta - math.pi / 2))
        jc = (0.05 + math.cos(ta) * 1.0, 0.1 + math.sin(ta) * 1.0)
        for sgn in (-1, 1):
            a0 = ta + sgn * 0.42
            shapes.append(rect(jc[0] + math.cos(a0) * 0.22, jc[1] + math.sin(a0) * 0.22, 0.12, 0.46, a0 - math.pi / 2))
        shapes.append(ellipse(0.05, 0.1, 0.16, 0.16, n=14))
    else:
        # the bellows: a pear-shaped board with its pleated hide, the two
        # handles up, the nozzle down toward the flame
        body = ellipse(0.0, 0.72, 0.62, 0.78, n=22, squeeze=0.55)
        shapes.append(body)
        shapes.append(rect(-0.26, 1.62, 0.11, 0.52, 0.18))
        shapes.append(rect(0.26, 1.62, 0.11, 0.52, -0.18))
        shapes.append([(-0.12, 0.0), (0.12, 0.0), (0.05, -0.42), (-0.05, -0.42)])
        # the flame on the anvil's face: three tongues
        shapes.append([(-0.34, -0.84), (0.34, -0.84), (0.28, -0.66), (0.16, -0.52), (0.18, -0.4), (0.06, -0.5),
                       (0.0, -0.32), (-0.08, -0.5), (-0.18, -0.38), (-0.18, -0.54), (-0.3, -0.66)])
    return shapes


def pylon_field(s, ground, rng, voxel=0.04):
    """One pylon (s = +1 west, -1 east) as a Sculpt; returns (field, info)."""
    tag = 'w' if s > 0 else 'e'
    xs = (2.0 * s, 5.6 * s)
    x_lo, x_hi = min(xs) - 0.4, max(xs) + 0.4
    bottom = ground['bottom']
    f = Sculpt((x_lo, -3.0, bottom - 0.3), (x_hi, 2.6, 11.2), voxel)
    # the stepped plinth and its roll moulding
    y = bottom
    for (x0, x1, z0, z1, y1, ch) in PLINTH_TIERS:
        a, b = _span(s, x0, x1)
        top_in = (0.06, 0.06, 0.06, 0.06)
        f.put('stone', frustum(a, b, z0, z1, y, y1, top_in=top_in, chamfer=ch), 0.02)
        y = y1
    a, b = _span(s, ROLL['x0'], ROLL['x1'])
    cy = (ROLL['y0'] + ROLL['y1']) / 2
    f.put('stone', RoundBox(G((a + b) / 2, (ROLL['z0'] + ROLL['z1']) / 2, cy),
                            ((b - a) / 2, (ROLL['z1'] - ROLL['z0']) / 2, (ROLL['y1'] - ROLL['y0']) / 2), ROLL['r']),
          0.03)
    # the battered shaft
    a, b = _span(s, SHAFT_B['x0'], SHAFT_B['x1'])
    at, bt = _span(s, SHAFT_T['x0'], SHAFT_T['x1'])
    top_in = (at - a, b - bt, SHAFT_T['z0'] - SHAFT_B['z0'], SHAFT_B['z1'] - SHAFT_T['z1'])
    f.put('stone', frustum(a, b, SHAFT_B['z0'], SHAFT_B['z1'], SHAFT_B['y'], SHAFT_T['y'] + 0.02, top_in=top_in,
                           chamfer=SHAFT_CHAMFER, chamfer_top=SHAFT_CHAMFER * 0.85), 0.02)
    # the corbelled capital
    for (x0, x1, z0, z1, y0, y1) in CAPITAL:
        a, b = _span(s, x0, x1)
        f.put('stone', frustum(a, b, z0, z1, y0, y1, chamfer=0.1), 0.02)
    # the outer brackets carrying the lintel's overhang
    for (ext, y0, y1, z0, z1) in ((0.7, 9.35, 9.95, -0.7, 2.0), (1.5, 9.95, 10.9, -0.95, 2.2)):
        a, b = _span(s, 4.4, 4.72 + ext)
        f.put('stone', frustum(a, b, z0, z1, y0, y1, top_in=(0, 0, 0, 0), chamfer=0.08), 0.02)
    # coursed ashlar: bed joints round the shaft, staggered perpends
    y = SHAFT_B['y']
    for k, h in enumerate(COURSES[:-1]):
        y += h
        f.groove(Slab(G(0, 0, y), (0, 0, 1), (x_lo, -3.0, y - 0.4), (x_hi, 2.6, y + 0.4)), 0.075, 0.05)
    y = SHAFT_B['y']
    for k, h in enumerate(COURSES):
        # a perpend on the south face and one on the outer face per course
        xa, xb = SHAFT_B['x0'] + 0.5, SHAFT_B['x1'] - 0.5
        jx = s * (xa + (xb - xa) * (0.3 if k % 2 else 0.68))
        f.groove(Slab(G(jx, 0, 0), (1, 0, 0), (jx - 0.3, 0.6, y + 0.05), (jx + 0.3, 2.0, y + h - 0.05)), 0.07, 0.045)
        jz = 0.2 + (1.1 if k % 2 else -0.3)
        xo = s * 5.6
        f.groove(Slab(G(0, jz, 0), (0, 1, 0), (min(xo, s * 4.0), -jz - 0.3, y + 0.05), (max(xo, s * 4.0), -jz + 0.3,
                                                                                         y + h - 0.05)), 0.07, 0.045)
        y += h
    # the sunk relief panel and its raised frame
    fr = face_frame(s)
    pc = -s * PANEL['cx']                   # u of the panel centre (u = -lx)
    hw, v0, v1 = PANEL['w'] / 2, PANEL['v0'], PANEL['v1']
    vc = (v0 + v1) / 2
    fw = PANEL['frame']
    outer = rect(pc, vc, 2 * (hw + fw), (v1 - v0) + 2 * fw)
    f.put('stone', Extrude(fr, outer, -0.2, 0.05, r=0.025), 0.01)
    inner = rect(pc, vc, 2 * hw, v1 - v0)
    f.sub(Extrude(fr, inner, -PANEL['depth'], 0.4, r=0.02), 0.012)
    for shape in pylon_tools(s):
        pts = [(pc + u, vc + v) for (u, v) in shape]
        f.put('relief', Extrude(fr, pts, -PANEL['depth'] - 0.05, -0.025, r=0.045), 0.015)
    # the rune column over the panel: incised channels (the inlay is added
    # as lit quads on the channel floors by the builder)
    strokes = []
    rc = -s * RUNE_COL['cx']
    for k in range(RUNE_COL['n']):
        st = glyph_strokes(fr, (k * 3 + (0 if s > 0 else 1)), rc, RUNE_COL['v0'] + k * RUNE_COL['step'],
                           RUNE_COL['size'])
        carve_glyph(f, fr, st, 0.06)
        strokes.append((k, st))
    # weathering: chipped arrises, a few cracks, erosion
    corners = []
    for yk in np.linspace(SHAFT_B['y'] + 0.6, SHAFT_T['y'] - 0.6, 7):
        for (kx, kz) in (('x0', 'z0'), ('x1', 'z0'), ('x1', 'z1'), ('x0', 'z1')):
            if rng.random() < 0.45:
                cx = shaft_x(yk, kx, s)
                t = (yk - SHAFT_B['y']) / (SHAFT_T['y'] - SHAFT_B['y'])
                cz = SHAFT_B[kz] + (SHAFT_T[kz] - SHAFT_B[kz]) * t
                corners.append(G(cx, cz, yk + rng.uniform(-0.5, 0.5)))
    for (x0, x1, z0, z1, y1, ch) in PLINTH_TIERS:
        for (cx, cz) in ((x1, z0), (x1, z1), (x0, z1)):
            if rng.random() < 0.6:
                corners.append(G(s * cx, cz, y1 - 0.05))
    for c in corners:
        r = rng.uniform(0.12, 0.3)
        f.sub(Ellipsoid(c, (r * rng.uniform(0.8, 1.4), r * rng.uniform(0.8, 1.4), r * rng.uniform(0.6, 1.2))), 0.04)
    for k in range(3):
        u0 = pc + rng.uniform(-1.0, 1.0)
        v0_ = rng.uniform(2.0, 9.0)
        path = crack_path(rng, (u0, v0_), (rng.uniform(-0.4, 0.4), -1.0), rng.uniform(0.8, 1.8), 6, 0.5)
        groove_polyline(f, [fr.at(u, v, 0.0) for (u, v) in path], 0.05, 0.035)
    n1, n2 = Noise(71 + (s > 0)), Noise(91 + (s > 0))
    f.displace(lambda X, Y, Z: 0.035 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 2) + 0.012 * n2.fbm(X * 4.0, Y * 4.0, Z * 4.0,
                                                                                           2), band=0.3)
    # rime lodged on the ledges: the plinth steps, the roll, the capital
    ledges = [(PLINTH_TIERS[0], 0.42), (PLINTH_TIERS[1], 0.98)]
    for (t_, yl) in ledges:
        x0, x1, z0, z1 = t_[0], t_[1], t_[2], t_[3]
        for k in range(7):
            px = s * rng.uniform(x0 + 0.2, x1 - 0.2)
            pz = rng.choice((rng.uniform(z0 + 0.05, z0 + 0.3), rng.uniform(z1 - 0.3, z1 - 0.05),
                             rng.uniform(z0, z1)))
            f.put('rime', Ellipsoid(G(px, pz, yl + 0.01), (rng.uniform(0.25, 0.55), rng.uniform(0.18, 0.3), 0.07)),
                  0.06)
    for k in range(6):
        px = s * rng.uniform(2.4, 4.8)
        f.put('rime', Ellipsoid(G(px, rng.uniform(-1.55, -1.35), ROLL['y1'] - 0.02),
                                (rng.uniform(0.25, 0.5), 0.16, 0.07)), 0.05)
    info = {'tag': tag, 'frame': fr, 'strokes': strokes, 'bottom': bottom}
    return f, info


def stone_paint(field, base, pale, deep, rime, frost, rng_seed, cold=None, snow_up=0.62, shade=None):
    """The vertex paint for carved stone: tone drift, baked occlusion into
    every joint, pale worn arrises, rime on what faces up (and, by `cold`,
    a frost bloom where the tunnel's breath reaches)."""
    n1 = Noise(rng_seed)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        tone = 0.86 + 0.28 * (0.5 + 0.5 * n1.fbm(P[:, 0] * 0.45, P[:, 1] * 0.45, P[:, 2] * 0.45, 3))
        streak = 0.92 + 0.12 * (0.5 + 0.5 * n1.fbm(P[:, 0] * 2.2 + 7, P[:, 1] * 2.2, P[:, 2] * 0.25, 2))
        c = mix(base, pale, np.clip(edge * 0.75, 0, 1)) * (tone * streak)[:, None]
        c = mix(deep, c, np.clip(ao ** 2.0, 0, 1))
        labels = field.classify(P, default='stone')
        # the carving catches what light there is: raised relief a step paler
        c = mix(c, pale, (labels == 'relief') * 0.35)
        if shade is not None:
            c = c * shade(P, N)[:, None]
        up = np.clip(N[:, 2], 0, 1)
        patch = 0.5 + 0.5 * n1.fbm(P[:, 0] * 1.3 + 3, P[:, 1] * 1.3, P[:, 2] * 1.3, 2)
        snow = sstep(snow_up, 0.95, up + (patch - 0.5) * 0.35) * np.clip(0.35 + ao, 0, 1)
        if cold is not None:
            fr = np.clip(cold(P, N) * (0.35 + 0.65 * patch), 0, 1)
            c = mix(c, frost, fr * 0.8)
        is_rime = (labels == 'rime').astype(np.float64)
        c = mix(c, rime, np.maximum(snow, is_rime * (0.75 + 0.25 * patch)))
        return c

    return paint


# ------------------------------------------------------------------ the lintel and its crown
LINTEL = dict(x=8.0, y0=10.9, y1=13.3, z0=-1.4, z1=2.5)
SOCKET = dict(bot=0.75, top=1.3)
CORNICE = dict(x0=1.5, x1=8.35, z0=-1.62, z1=2.7, y0=13.3, y1=13.88)
ATTIC = dict(x=4.4, z0=-1.0, z1=2.2, y0=13.86, y1=16.1)
STEP = dict(x=2.95, z0=-0.72, z1=1.95, y0=16.08, y1=16.92)
SEAL = dict(y=14.98, r=0.98)
CAPSTONE = [(-1.45, 16.9), (1.45, 16.9), (1.15, 17.12), (0.72, 17.25), (0.68, 17.55), (0.95, 17.68), (1.65, 17.78),
            (1.72, 18.22), (-0.85, 18.22), (-1.45, 18.15), (-2.05, 18.02), (-2.55, 17.88), (-2.1, 17.76),
            (-1.45, 17.68), (-0.95, 17.6), (-0.7, 17.52), (-0.72, 17.25), (-1.15, 17.12)]
CAPSTONE_Z = (-0.6, 1.95)


def cbox(x0, x1, z0, z1, y0, y1, ch_v=0.0, ch_top=0.0, ch_bot=0.0, front_bot=None):
    """An axis box from local game bounds with 45 degree chamfers: every
    vertical edge by ch_v, every top edge by ch_top, every bottom edge by
    ch_bot (front_bot overrides the south bottom edge: a cove under a cornice)."""
    X0, X1 = min(x0, x1), max(x0, x1)
    Ys, Yn = -z0, -z1
    r2 = math.sqrt(0.5)
    planes = [((1, 0, 0), X1), ((-1, 0, 0), -X0), ((0, 1, 0), Ys), ((0, -1, 0), -Yn), ((0, 0, 1), y1),
              ((0, 0, -1), -y0)]
    sides = [((1, 0), X1), ((-1, 0), -X0), ((0, 1), Ys), ((0, -1), -Yn)]
    if ch_v > 0:
        for (ha, a), (hb, b) in ((sides[0], sides[2]), (sides[0], sides[3]), (sides[1], sides[2]),
                                 (sides[1], sides[3])):
            planes.append((((ha[0] + hb[0]) * r2, (ha[1] + hb[1]) * r2, 0.0), (a + b - ch_v) * r2))
    for (h, a) in sides:
        bot = front_bot if (front_bot is not None and h == (0, 1)) else ch_bot
        for (sz, yy, c) in ((1.0, y1, ch_top), (-1.0, -y0, bot)):
            if c and c > 0:
                planes.append(((h[0] * r2, h[1] * r2, sz * r2), (a + yy - c) * r2))
    return Convex(planes, (X0 - 0.2, Yn - 0.2, y0 - 0.2), (X1 + 0.2, Ys + 0.2, y1 + 0.2))


def monolith(s):
    L = LINTEL
    r2 = math.sqrt(0.5)
    planes = [batter_plane((s, 0.0), L['x'], L['x'], L['y0'], L['y1']),
              batter_plane((-s, 0.0), -SOCKET['bot'], -SOCKET['top'], L['y0'], L['y1']),
              ((0, 1, 0), -L['z0']), ((0, -1, 0), L['z1']), ((0, 0, 1), L['y1']), ((0, 0, -1), -L['y0'])]
    c = 0.12
    Ys, Yn = -L['z0'], -L['z1']
    planes += [((0, r2, -r2), (Ys - L['y0'] - c) * r2), ((0, r2, r2), (Ys + L['y1'] - c) * r2),
               ((0, -r2, r2), (-Yn + L['y1'] - c) * r2), ((s * r2, r2, 0), (L['x'] + Ys - c) * r2),
               ((s * r2, 0, r2), (L['x'] + L['y1'] - c) * r2), ((s * r2, 0, -r2), (L['x'] - L['y0'] - c) * r2)]
    lo = (min(0, s * L['x']) - 0.3, Yn - 0.3, L['y0'] - 0.3)
    hi = (max(0, s * L['x']) + 0.3, Ys + 0.3, L['y1'] + 0.3)
    return Convex(planes, lo, hi)


def shoulder(s):
    """The sloped wing either side of the attic, down to the cornice's ends."""
    xi, xo, yt, yb = ATTIC['x'] - 0.2, 7.5, 15.45, ATTIC['y0']
    n = np.array((s * (yt - yb), 0.0, (xo - xi)))
    n /= np.linalg.norm(n)
    d = n[0] * s * xi + n[2] * yt
    planes = [((-s, 0, 0), -xi), ((0, 1, 0), 0.85), ((0, -1, 0), 2.1), ((0, 0, -1), -yb), (tuple(n), d),
              ((s, 0, 0), xo)]
    lo = (min(s * xi, s * xo) - 0.3, -2.4, yb - 0.3)
    hi = (max(s * xi, s * xo) + 0.3, 1.2, yt + 0.3)
    return Convex(planes, lo, hi)


def fissure_path(rng):
    """The crack the torn-out keystone left, up through the crown: (u, v,
    half width) points (u = screen right)."""
    pts = []
    u = 0.0
    for v in np.linspace(LINTEL['y1'] - 0.05, 18.4, 15):
        u += rng.uniform(-0.16, 0.16)
        u = max(-0.35, min(0.35, u))
        t = (v - LINTEL['y1']) / (18.4 - LINTEL['y1'])
        pts.append((u, float(v), 0.2 * (1 - t) + 0.05))
    return pts


def lintel_field(rng, voxel=0.055):
    L = LINTEL
    f = Sculpt((-8.8, -3.1, 10.5), (8.8, 2.1, 18.6), voxel)
    front = Frame(G(0.0, L['z0'], 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    for s in (-1, 1):
        f.put('stone', monolith(s), 0.02)
        # the cornice on its dentils, a cove under its front
        f.put('stone', cbox(s * CORNICE['x0'], s * CORNICE['x1'], CORNICE['z0'], CORNICE['z1'], CORNICE['y0'],
                            CORNICE['y1'], ch_v=0.06, ch_top=0.06, ch_bot=0.04, front_bot=0.2), 0.02)
        x = CORNICE['x0'] + 0.32
        while x < L['x'] - 0.1:
            f.put('stone', cbox(s * (x - 0.1), s * (x + 0.1), L['z0'] - 0.17, L['z0'] + 0.1, CORNICE['y0'] - 0.24,
                                CORNICE['y0'] + 0.02, ch_v=0.02), 0.01)
            x += 0.46
        # the roll under the frieze and the boss on the monolith's end
        f.put('stone', RoundBox(G(s * (L['x'] + 1.3) / 2, L['z0'] - 0.02, 11.12), ((L['x'] - 1.6) / 2, 0.07, 0.1),
                                0.07), 0.02)
        f.put('stone', cbox(s * (L['x'] - 0.05), s * (L['x'] + 0.12), -0.9, 2.0, 11.4, 12.8, ch_v=0.05, ch_top=0.05,
                            ch_bot=0.05), 0.02)
        f.put('stone', shoulder(s), 0.03)
    f.put('stone', cbox(-ATTIC['x'], ATTIC['x'], ATTIC['z0'], ATTIC['z1'], ATTIC['y0'], ATTIC['y1'], ch_v=0.12,
                        ch_top=0.1), 0.03)
    f.put('stone', cbox(-STEP['x'], STEP['x'], STEP['z0'], STEP['z1'], STEP['y0'], STEP['y1'], ch_v=0.1,
                        ch_top=0.1), 0.03)
    cap = Frame(G(0.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    f.put('stone', Extrude(cap, CAPSTONE, -CAPSTONE_Z[1], -CAPSTONE_Z[0], r=0.06), 0.03)
    # the seal disc on the attic's face: a raised rim, a sunk field, the anvil
    attic = Frame(G(0.0, ATTIC['z0'], 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    f.put('stone', Extrude(attic, ellipse(0.0, SEAL['y'], SEAL['r'], SEAL['r'], n=40), -0.1, 0.16, r=0.05), 0.02)
    f.sub(Extrude(attic, ellipse(0.0, SEAL['y'], SEAL['r'] - 0.16, SEAL['r'] - 0.16, n=40), 0.07, 0.5, r=0.03),
          0.015)
    small = [(u * 0.62, SEAL['y'] + (v + 1.45) * 0.62) for (u, v) in (
        (-0.6, -2.0), (0.6, -2.0), (0.3, -1.72), (0.24, -1.5), (0.5, -1.27), (0.7, -1.25), (0.7, -0.9), (-0.3, -0.9),
        (-0.75, -1.02), (-0.92, -1.08), (-0.45, -1.21), (-0.24, -1.5), (-0.3, -1.72))]
    f.put('relief', Extrude(attic, small, 0.0, 0.13, r=0.035), 0.012)
    # the rune frieze: a sunk band each side, its glyphs incised
    strokes = []
    for s in (-1, 1):
        band = rect(-s * 4.65, 12.06, 5.8, 1.12)
        f.sub(Extrude(front, band, -0.07, 0.4, r=0.02), 0.012)
        for k in range(4):
            gu = -s * (2.45 + k * 1.5)
            st = glyph_strokes(front, k * 5 + (2 if s > 0 else 6), gu, 11.66, 0.82)
            carve_glyph(f, front, st, 0.055, -0.07)
            strokes.append((s, k, st))
    # the torn socket: the fissure up through the crown, the fractured
    # wedge faces, the shards still caught in it, the cracks across the face
    fis = fissure_path(rng)
    left = [(u - w, v) for (u, v, w) in fis]
    right = [(u + w, v) for (u, v, w) in reversed(fis)]
    f.sub(Extrude(cap, left + [(fis[-1][0], 18.8)] + right, -2.4, 1.9, r=0.0), 0.02)
    f.sub(Extrude(cap, [(-CORNICE['x0'] + 0.02, 13.2), (CORNICE['x0'] - 0.02, 13.2), (0.4, 13.95), (-0.4, 13.95)],
                  -2.9, 1.9, r=0.0), 0.03)
    nr = Noise(311)

    def fracture(X, Y, Z):
        m = sstep(2.3, 1.2, np.abs(X)) * sstep(10.6, 11.0, Z) * sstep(14.4, 13.6, Z)
        return m * 0.13 * (nr.ridged(X * 1.4, Y * 1.4, Z * 1.4, 2) - 0.6)

    f.displace(fracture, band=0.4)
    for (sx, y, sz, size, yaw) in ((-1, 11.25, 0.2, (0.55, 0.62, 0.48), 0.4), (1, 11.9, 1.1, (0.48, 0.7, 0.42), -0.6),
                                   (-1, 12.75, -0.6, (0.5, 0.5, 0.44), 0.9), (1, 13.0, 0.5, (0.42, 0.55, 0.4), 0.2)):
        w = SOCKET['bot'] + (SOCKET['top'] - SOCKET['bot']) * (y - L['y0']) / (L['y1'] - L['y0'])
        R = gs.rot(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), yaw)
        f.put('shard', gs.block(np.random.default_rng(int(y * 100)), G(sx * (w - 0.08), sz, y), size, cuts=6, R=R),
              0.02)
    for s in (-1, 1):
        for k in range(3):
            v0 = rng.uniform(11.0, 13.1)
            u0 = s * (SOCKET['bot'] + (SOCKET['top'] - SOCKET['bot']) * (v0 - L['y0']) / (L['y1'] - L['y0']))
            path = crack_path(rng, (-u0, v0), (-s * 1.0, rng.uniform(-0.5, 0.5)), rng.uniform(0.9, 2.2), 7, 0.45)
            groove_polyline(f, [front.at(u, v, 0.0) for (u, v) in path], 0.06, 0.04)
        for k in range(5):
            c = G(s * rng.choice((L['x'], CORNICE['x1'], ATTIC['x'], 7.2)), rng.choice((L['z0'], CORNICE['z0'], -1.0)),
                  rng.uniform(11.0, 15.0))
            r = rng.uniform(0.14, 0.32)
            f.sub(Ellipsoid(c, (r * 1.3, r, r)), 0.04)
    n1, n2 = Noise(171), Noise(191)
    f.displace(lambda X, Y, Z: 0.035 * n1.fbm(X * 0.8, Y * 0.8, Z * 0.8, 2)
               + 0.012 * n2.fbm(X * 4.0, Y * 4.0, Z * 4.0, 2), band=0.3)
    # snow lodged on the cornice's ledge, the shoulders, the step and the anvil
    for s in (-1, 1):
        for k in range(9):
            px = s * rng.uniform(1.8, 8.1)
            pz = rng.uniform(-1.55, -1.1) if abs(px) < ATTIC['x'] + 0.1 else rng.uniform(-1.55, 2.4)
            f.put('rime', Ellipsoid(G(px, pz, CORNICE['y1'] + 0.01),
                                    (rng.uniform(0.3, 0.7), rng.uniform(0.2, 0.35), 0.09)), 0.07)
        for k in range(3):
            px = s * rng.uniform(1.0, 2.8)
            f.put('rime', Ellipsoid(G(px, rng.uniform(-0.6, -0.2), STEP['y0'] + 0.01), (0.45, 0.22, 0.08)), 0.06)
    for k in range(4):
        px = rng.uniform(-2.2, 1.5)
        f.put('rime', Ellipsoid(G(px, rng.uniform(-0.4, 1.6), 18.22), (rng.uniform(0.4, 0.7), 0.35, 0.1)), 0.07)
    info = {'front': front, 'strokes': strokes, 'fissure': fis, 'cap': cap}
    return f, info


# ------------------------------------------------------------------ terrain helpers
def ground_grid(GR, field):
    """The terrain height (door-relative) under every field column (nx, ny)."""
    xs, ys = field.axes[0], field.axes[1]
    return np.array([[GR.h(float(x), float(-y)) for y in ys] for x in xs])


def seat_on_ground(field, H, bury):
    """Cut the field off `bury` yards under the terrain, column by column."""
    Z = field.axes[2][None, None, :]
    field.d = np.maximum(field.d, ((H[:, :, None] - bury) - Z).astype(np.float32))


# ------------------------------------------------------------------ the rock spur and its tunnel
TUNNEL_HW = 3.6


class TunnelBore(Prim):
    """The rock-cut tunnel: battered walls and a flattened cut vault (the old
    lofted section) riding the floor's rise, bored from lz z0 to z1."""

    def __init__(self, floor_lz, floor_y, roof_lz, roof_h, z0, z1):
        self.fl, self.fy = np.asarray(floor_lz), np.asarray(floor_y)
        self.rl, self.rh = np.asarray(roof_lz), np.asarray(roof_h)
        self.z0, self.z1 = z0, z1
        prof = []
        for i in range(25):
            th = math.pi * (1 - i / 24)
            prof.append((math.cos(th) * TUNNEL_HW, (math.sin(th) ** 0.62) * 9.6))
        self.prof = prof + [(TUNNEL_HW, -2.0), (-TUNNEL_HW, -2.0)]
        top = float(np.max(self.fy) + np.max(self.rh) + 1.0)
        self.lo = np.array((-TUNNEL_HW - 1.0, -z1 - 1.0, float(np.min(self.fy)) - 2.0))
        self.hi = np.array((TUNNEL_HW + 1.0, -z0 + 1.0, top))

    def dist(self, X, Y, Z):
        lz = -Y
        fl = np.interp(lz, self.fl, self.fy)
        rh = np.interp(lz, self.rl, self.rh)
        h = (Z - fl) * (9.6 / (rh + 0.6))
        d2 = poly_sdf(X, h, self.prof)
        dz = np.maximum(self.z0 - lz, lz - self.z1)
        return np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0)


def spur_field(GR, stations, rng, voxel=0.22, tunnel_end=28.0, rock_front=2.2):
    """The mountain's spur, cleaved slate blocks stacked on a dip into the
    face, seated on the terrain, the tunnel bored through. stations: (lz,
    west half width, east half width, top y, tunnel roof or None)."""
    nrng = np.random.default_rng(4242)
    f = Sculpt((-14.5, -51.5, -3.0), (14.5, -0.8, 41.0), voxel)
    H = ground_grid(GR, f)
    st = np.array([(s_[0], s_[1], s_[2], s_[3]) for s_ in stations])
    W = lambda z: float(np.interp(z, st[:, 0], st[:, 1]))  # noqa: E731
    E = lambda z: float(np.interp(z, st[:, 0], st[:, 2]))  # noqa: E731
    TOP = lambda z: float(np.interp(z, st[:, 0], st[:, 3]))  # noqa: E731
    # the skirt: the station outline from under the ground to above head
    # height, so the rock meets the ground where the colliders say it does
    zs = list(np.arange(rock_front, 46.0, 1.6)) + [46.0]
    for za, zb in zip(zs, zs[1:]):
        ga = min(GR.h(0, za), GR.h(-E(za), za), GR.h(W(za), za))
        gb = min(GR.h(0, zb), GR.h(-E(zb), zb), GR.h(W(zb), zb))
        y0 = min(ga, gb) - 1.2
        y1 = max(GR.h(-E(za), za), GR.h(W(za), za), GR.h(-E(zb), zb), GR.h(W(zb), zb)) + 3.0
        planes = [((0, 1, 0), -za), ((0, -1, 0), zb + 0.4), ((0, 0, 1), y1), ((0, 0, -1), -y0)]
        # interpolate the side faces between the two stations
        for side, A, Bv in ((1.0, W(za), W(zb)), (-1.0, E(za), E(zb))):
            n = np.array((side * (zb - za), (Bv - A), 0.0))
            n /= np.linalg.norm(n)
            d = n[0] * side * A + n[1] * (-za)
            planes.append((tuple(n), d))
        f.put('rock', Convex(planes, (-E(za) - 1.5, -zb - 1.0, y0 - 0.5), (W(za) + 1.5, -za + 1.0, y1 + 0.5)), 0.5)
    # the crag: cleaved blocks stacked up the spur, dipping into the face
    z = rock_front + 0.4
    while z < 45.0:
        dz = rng.uniform(2.8, 4.0)
        zc = z + dz / 2
        top = TOP(zc) + rng.uniform(-1.2, 1.4)
        for side in (-1, 1):
            half = W(zc) if side > 0 else E(zc)
            g = GR.h(side * half * 0.6, zc)
            for tier in range(2):
                if tier == 0:
                    y0, y1 = g - 1.0, g + (top - g) * rng.uniform(0.5, 0.65)
                    w = half * rng.uniform(0.85, 1.0)
                    cx = side * (half - w / 2 + rng.uniform(-0.2, 0.25))
                else:
                    y0, y1 = g + (top - g) * 0.42, top + rng.uniform(-0.6, 0.6)
                    w = half * rng.uniform(0.6, 0.85)
                    cx = side * (half - w / 2 - rng.uniform(0.3, 1.2))
                R = gs.rot(rng.uniform(0.12, 0.3), side * rng.uniform(0.0, 0.18), rng.uniform(-0.12, 0.12))
                f.put('rock', gs.block(nrng, G(cx, zc, (y0 + y1) / 2), (w, dz * rng.uniform(1.0, 1.25), y1 - y0),
                                       cuts=7, chamfer=(0.7, 0.93), R=R, top_tilt=0.25), 0.35)
        # a crest block bridging the two flanks over the tunnel
        g = GR.h(0, zc)
        f.put('rock', gs.block(nrng, G(rng.uniform(-1.5, 1.5), zc, (top + g) / 2 + 1.5),
                               (min(W(zc), E(zc)) * 1.3, dz * 1.15, top - g - 2.0), cuts=7, chamfer=(0.7, 0.93),
                               R=gs.rot(rng.uniform(0.1, 0.25), 0.0, rng.uniform(-0.1, 0.1)), top_tilt=0.3), 0.35)
        z += dz * 0.8
    # strata: broken ledges on the dip (each runs a few yards, then dies
    # out), and a few vertical joints
    y = -1.0
    while y < 40.0:
        y += rng.uniform(1.3, 2.6)
        for k in range(3):
            zc = rng.uniform(rock_front, 46.0)
            xc = rng.uniform(-11.0, 11.0)
            dip = np.array((rng.uniform(-0.12, 0.12), -math.sin(0.18 + rng.uniform(-0.08, 0.08)), 1.0))
            ext = rng.uniform(4.0, 9.0)
            f.groove(Slab(G(xc, zc, y), dip, (xc - ext, -zc - ext, y - 4), (xc + ext, -zc + ext, y + 4)),
                     rng.uniform(0.14, 0.34), rng.uniform(0.14, 0.24))
    for k in range(9):
        x = rng.uniform(-11, 11)
        n = (1.0, rng.uniform(-0.4, 0.4), 0.0)
        f.groove(Slab(G(x, 0, 0), n, (x - 3, -51.5, -3), (x + 3, -0.8, 41)), 0.32, 0.16)
    # the tunnel, bored through
    roofs = [(s_[0], s_[4]) for s_ in stations if s_[4] is not None]
    rl = [r[0] for r in roofs]
    fl = list(np.arange(0.0, tunnel_end + 1.0, 1.0))
    f.sub(TunnelBore(fl, [GR.h(0, z_) - 0.6 for z_ in fl], rl, [r[1] for r in roofs], rock_front - 1.6,
                     tunnel_end), 0.12)
    slate_noise_ridged(f, 4711)
    seat_on_ground(f, H, 0.9)
    # a margin so the outer skin never steps past the outline at the ground
    # (the colliders sit 0.35 inside it) nor into the two ruin rings
    X = f.axes[0][:, None, None]
    lzs = -f.axes[1][None, :, None]
    Zs = f.axes[2][None, None, :]
    Wv = np.interp(-f.axes[1], st[:, 0], st[:, 1])[None, :, None]
    Ev = np.interp(-f.axes[1], st[:, 0], st[:, 2])[None, :, None]
    hh = Zs - H[:, :, None]
    over = np.clip((hh - 2.6) * 0.3, 0.0, 1.4)
    margin = 0.32 + over
    env = np.maximum(X - (Wv + margin), -(Ev + margin) - X)
    env = np.where(lzs < rock_front - 0.4, np.maximum(env, (rock_front - 0.4) - lzs), env)
    f.d = np.maximum(f.d, env.astype(np.float32))
    return f, H


def slate_noise_ridged(f, seed):
    n1, n2 = Noise(seed), Noise(seed + 3)
    f.displace(lambda X, Y, Z: 0.32 * n1.fbm(X * 0.22, Y * 0.22, Z * 0.3, 3)
               + 0.12 * (n2.ridged(X * 0.9, Y * 0.9, Z * 0.6, 2) - 0.5), band=1.2)


def rock_paint(field, inside_fn, outer, outer_dark, inner, frost, rime, floor_fn=None):
    """The spur's vertex paint: the mountain's rock with its carving baked in
    as relief (the runtime's Thornpeak shader re-tones it and keeps the
    luminance swing), the tunnel's own dark slate inside."""
    n1 = Noise(919)
    GR_FLOOR = floor_fn or (lambda P: np.zeros(len(P)))  # noqa: N806

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.18, P[:, 1] * 0.18, P[:, 2] * 0.18, 3)
        c = mix(outer_dark, outer, np.clip(tone * 0.7 + edge * 0.45, 0, 1))
        # the runtime keeps this swing as relief; it never drops the outer
        # rock under the tunnel's own dark (the shader's inside test reads both)
        c = c * (0.66 + 0.34 * np.clip(ao, 0, 1) ** 1.2)[:, None]
        up = np.clip(N[:, 2], 0, 1)
        snow = sstep(0.55, 0.9, up + (tone - 0.5) * 0.3) * np.clip(0.3 + ao, 0, 1)
        c = mix(c, rime, snow * 0.85)
        # never under the tunnel's own dark (the runtime's inside test, and
        # its relief, read the outer rock as at least this bright)
        c = np.maximum(c, 0.36)
        ins = inside_fn(P)
        lz = -P[:, 1]
        depth = np.clip(1 - (lz - 2.2) / 5.5, 0, 1)
        floor = np.clip(1 - (P[:, 2] - GR_FLOOR(P)) / 2.0, 0, 1)
        ci = mix(inner, frost, depth * floor * 0.8) * (0.75 + 0.35 * tone)[:, None]
        ci = ci * (1 - 0.8 * np.clip((lz - 5.0) / 12.0, 0, 1))[:, None]
        ci = ci * (0.6 + 0.4 * np.clip(ao, 0, 1))[:, None]
        return mix(c, ci, ins.astype(np.float64))

    return paint


# ------------------------------------------------------------------ the icefall in the ridge notch
ICEFALL = dict(cx=-17.0, snout=41.0, crest=56.0, top=58.0)


def icefall_field(GR, rng, voxel=0.28):
    """The glacier tongue breaking down the Thornpeak face through the notch:
    a body of ice draped on the face (its margins sunk into the slope, so it
    grows out of the mountain), a jumble of tilted serac blocks riding it,
    bowed crevasses across it, the ice cliff of its snout, its upper reach
    a snowfield feathering into the slope under the crest, and rock slabs
    walling the notch. Returns (field, lips): the (P, width) of every lip an
    icicle fringe hangs from."""
    nrng = np.random.default_rng(777)
    I = ICEFALL
    f = Sculpt((-38.0, -62.0, 14.0), (4.0, -36.0, 84.0), voxel)
    H = ground_grid(GR, f)

    def S(x, lz):
        return GR.h(x, lz)

    def half(lz):
        t = min(1.0, max(0.0, (lz - I['snout']) / (I['crest'] - I['snout'])))
        return 5.6 + 6.0 * t ** 1.15

    def cx(lz):
        return I['cx'] + 1.0 * math.sin((lz - 40) * 0.22)

    def pitch_at(x, lz):
        return math.atan2(S(x, lz + 1.0) - S(x, lz - 1.0), 2.0)

    X = f.axes[0][:, None, None]
    lzs = -f.axes[1][None, :, None]
    Zs = f.axes[2][None, None, :]
    lz1 = -f.axes[1]
    nm1, nm2 = Noise(4301), Noise(4302)
    hwL = np.array([half(z) * (1.0 + 0.2 * float(nm1.fbm(z * 0.18, 0.3, 0.7, 2))
                               + 0.12 * float(nm2.fbm(z * 0.8, 4.3, 0.7, 2))) for z in lz1])[None, :, None]
    hwR = np.array([half(z) * (1.0 + 0.2 * float(nm2.fbm(z * 0.18, 1.3, 0.2, 2))
                               + 0.12 * float(nm1.fbm(z * 0.8, 2.1, 5.2, 2))) for z in lz1])[None, :, None]
    cxs = np.array([cx(z) for z in lz1])[None, :, None]
    hw = np.minimum(np.where(X < cxs, hwL, hwR), 12.5)
    t = np.clip((lz1 - I['snout']) / (I['crest'] - I['snout']), 0, 1)[None, :, None]
    # thick at the snout's cliff, thinning up the face into the snowfield,
    # and gone (sunk under the slope) past the crest's lip
    thick = 3.0 - 1.4 * t ** 0.8
    thick = thick * np.clip((I['top'] - lzs) / 2.5, 0, 1)
    across = np.clip(1 - ((X - cxs) / hw) ** 2, 0, 1) ** 0.95
    gy = np.gradient(H, axis=1) / voxel
    gx = np.gradient(H, axis=0) / voxel
    slope = np.sqrt(1 + gx ** 2 + gy ** 2)[:, :, None]
    # the margins dive well under the slope (the render terrain's lattice
    # sags between its samples on a face this steep), so the ice grows out
    # of the mountain instead of standing on it as a sheet
    body = (Zs - H[:, :, None] - (thick * across - 1.5 * (1.0 - across))) / slope
    n_snout = Noise(808)
    snout = I['snout'] + 0.7 * n_snout.fbm(X * 0.35, X * 0.0 + 1.3, X * 0.0, 2)
    body = np.maximum(body, snout - lzs)
    # under the slope the ice flares (a root, not a wall): where the far
    # terrain's coarser lattice lets the face sink back, what shows is a
    # sloped shoulder of ice spreading onto the rock, never a vertical side
    body = np.maximum(body, (np.abs(X - cxs) - (hw + 1.4 * np.clip(H[:, :, None] - Zs, 0, None))) * 0.7)
    body = np.maximum(body, lzs - I['top'])
    body = np.maximum(body, (H[:, :, None] - 3.0) - Zs)
    body = body.astype(np.float32)
    f.d = np.minimum(f.d, body)
    f.parts.append(('ice', _Grid(f, body)))
    lips = []
    # the seracs: tilted blocks riding the body, thickest in the broken
    # middle reach, few on the snowfield
    for k in range(46):
        zc = I['snout'] + 0.8 + (I['crest'] - 1.5 - I['snout'] - 0.8) * (rng.random() ** 1.25)
        h_ = half(zc)
        x = cx(zc) + rng.uniform(-0.82, 0.82) * h_
        acr = max(0.0, 1 - ((x - cx(zc)) / h_) ** 2) ** 0.95
        tt = (zc - I['snout']) / (I['crest'] - I['snout'])
        th_body = (3.0 - 1.4 * tt ** 0.8) * acr - 1.5 * (1 - acr)
        p_ = pitch_at(x, zc)
        out = np.array((0.0, math.sin(p_), math.cos(p_)))
        flow = np.array((0.0, -math.cos(p_), math.sin(p_)))
        size = np.array((rng.uniform(1.4, 3.4), rng.uniform(1.2, 2.6), rng.uniform(1.4, 3.0))) * (1.0 - 0.35 * tt)
        R = gs.rot((math.pi / 2 - p_) + rng.uniform(-0.35, 0.25), rng.uniform(-0.35, 0.35), rng.uniform(-0.4, 0.4))
        c = G(x, zc, S(x, zc)) + out * (th_body * (0.6 if tt < 0.75 else 0.3) + size[1] * 0.1)
        f.put('serac', gs.block(nrng, c, tuple(size), cuts=7, chamfer=(0.68, 0.95), R=R, top_tilt=0.3), 0.15)
        if size[1] > 1.6 and tt < 0.8:
            lips.append((c - flow * size[2] * 0.45 + out * size[1] * 0.35, size[0] * 0.7))
    # bowed crevasses across the flow
    for zk in np.linspace(I['snout'] + 2.5, I['crest'] - 3.0, 6):
        zk = zk + rng.uniform(-0.6, 0.6)
        h_ = half(zk)
        pts = []
        for u in np.linspace(-0.85, 0.85, 9):
            x = cx(zk) + u * h_
            z_ = zk - 1.6 * (1 - u * u)            # the faster middle drags it down
            p_ = pitch_at(x, z_)
            out = np.array((0.0, math.sin(p_), math.cos(p_)))
            acr = max(0.0, 1 - u * u) ** 0.6
            pts.append(G(x, z_, S(x, z_)) + out * ((3.0 - 1.4 * (z_ - I['snout']) / 16.0) * acr * 0.9))
        f.sub(Polyline(pts, [0.15] + [rng.uniform(0.35, 0.6) for _ in pts[1:-1]] + [0.15]), 0.25)
    # the snout's ice cliff: its lower edge, where the longest icicles hang
    for u in np.linspace(-0.75, 0.75, 6):
        x = cx(I['snout']) + u * half(I['snout'])
        z_ = I['snout'] + 0.3
        p_ = pitch_at(x, z_)
        out = np.array((0.0, math.sin(p_), math.cos(p_)))
        acr = max(0.0, 1 - u * u) ** 0.6
        lips.append((G(x, z_, S(x, z_)) + out * (3.4 * acr - 0.6), half(I['snout']) * 0.3))
    n1, n2 = Noise(5150), Noise(5151)
    f.displace(lambda X_, Y_, Z_: 0.18 * n1.fbm(X_ * 0.15, Y_ * 0.15, Z_ * 0.15, 3)
               + 0.07 * n2.fbm(X_ * 0.9, Y_ * 0.9, Z_ * 0.1, 2), band=1.0)
    seat_on_ground(f, H, 3.0)
    return f, lips


class _Grid(Prim):
    """A precomputed distance grid as a labelled part (classification only)."""

    def __init__(self, field, grid):
        self.f, self.g = field, grid.astype(np.float32)
        self.lo, self.hi = field.lo, field.lo + np.array(field.shape) * field.voxel

    def at(self, P):
        fl = (P - self.f.lo) / self.f.voxel
        i = np.clip(np.round(fl).astype(int), 0, np.array(self.g.shape) - 1)
        return self.g[i[:, 0], i[:, 1], i[:, 2]]


def ice_paint(field, deep, clear, pale, crust, rock, rock_dark):
    """The icefall's vertex paint: the deep blue core in every crevasse and
    under every lip, clear glacier blue on the faces, pale thin ice at the
    arrises, and the white crust of old snow on what faces up."""
    n1 = Noise(2323)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='ice')
        up = np.clip(N[:, 2], -1, 1)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.25, P[:, 1] * 0.25, P[:, 2] * 0.25, 3)
        c = mix(clear, pale, np.clip(edge * 0.8 + (tone - 0.5) * 0.4, 0, 1))
        c = mix(deep, c, np.clip(ao ** 1.6, 0, 1))
        down = np.clip(-up, 0, 1)
        c = mix(c, deep, down * 0.55)
        body = (labels == 'ice').astype(np.float64)
        snow = sstep(0.35, 0.75, up + (tone - 0.5) * 0.35) * np.clip(0.2 + ao, 0, 1)
        snow = np.maximum(snow, body * sstep(0.0, 0.34, up + (tone - 0.5) * 0.4) * np.clip(ao * 1.3, 0, 1))
        field_up = sstep(ICEFALL['crest'] - 7.0, ICEFALL['crest'] - 1.0, -P[:, 1] + (tone - 0.5) * 3.0)
        snow = np.maximum(snow, field_up * np.clip(ao * 1.2, 0, 1) * sstep(-0.6, 0.2, up))
        c = mix(c, crust, np.clip(snow, 0, 1))
        r = mix(rock_dark, rock, np.clip(tone * 0.6 + edge * 0.4, 0, 1)) * (0.5 + 0.5 * ao)[:, None]
        r = mix(r, crust, sstep(0.55, 0.85, up) * 0.9)
        return np.where((labels == 'rock')[:, None], r, c)

    return paint


# ------------------------------------------------------------------ the plaza's props
def headstone_field(rng, w, hh, thick, cross, voxel=0.035):
    """One old Vigil headstone at its own origin (base centre at 0, its front
    toward +Y): a worn slab with a round head (or a cross), chamfered and
    chipped, the Vigil's open eye cut in its face, a crack, frost-weathered."""
    m = 0.5
    top = hh + (0.95 if cross else w / 2) + 0.1
    f = Sculpt((-w / 2 - m - 0.4, -thick / 2 - m, -0.1), (w / 2 + m + 0.4, thick / 2 + m, top + m), voxel)
    face = Frame((0.0, 0.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    if cross:
        bar = hh * 0.92
        shape = [(-0.12, 0.0), (0.12, 0.0), (0.12, bar), (0.36, bar), (0.36, bar + 0.21), (0.12, bar + 0.21),
                 (0.12, hh + 0.5), (-0.12, hh + 0.5), (-0.12, bar + 0.21), (-0.36, bar + 0.21), (-0.36, bar),
                 (-0.12, bar)]
        shape = [(u * (w / 0.75), v) for (u, v) in shape]
        base = rect(0.0, hh * 0.22, w * 0.62, hh * 0.44)
        f.put('stone', Extrude(face, base, -thick / 2, thick / 2, r=0.03), 0.02)
    else:
        shape = [(-w / 2, 0.0), (w / 2, 0.0)] + [(math.cos(a) * w / 2, hh + math.sin(a) * w * 0.42)
                                                 for a in np.linspace(0.0, math.pi, 13)]
    f.put('stone', Extrude(face, shape, -thick / 2, thick / 2, r=0.035), 0.02)
    # the Vigil's open eye: two chevrons and a pupil cut in the face
    ey = hh * 0.74
    for sgn in (-1, 1):
        groove_polyline(f, [face.at(-w * 0.24, ey, thick / 2), face.at(0.0, ey + sgn * w * 0.13, thick / 2),
                            face.at(w * 0.24, ey, thick / 2)], 0.03, 0.022)
    f.sub(Ellipsoid(face.at(0.0, ey, thick / 2), (0.05, 0.03, 0.05)), 0.01)
    if rng.random() < 0.7:
        path = crack_path(rng, (rng.uniform(-w * 0.3, w * 0.3), hh), (rng.uniform(-0.3, 0.3), -1.0),
                          rng.uniform(0.4, 0.8), 5, 0.6)
        groove_polyline(f, [face.at(u, v, thick / 2) for (u, v) in path], 0.025, 0.02)
    for k in range(rng.randint(2, 4)):
        c = (rng.choice((-w / 2, w / 2)) * rng.uniform(0.7, 1.0), rng.choice((-1, 1)) * thick / 2,
             rng.uniform(0.3, hh + w * 0.3))
        r = rng.uniform(0.06, 0.13)
        f.sub(Ellipsoid(c, (r, r, r * 1.3)), 0.02)
    n1 = Noise(rng.randint(1, 9999))
    f.displace(lambda X, Y, Z: 0.012 * n1.fbm(X * 5.0, Y * 5.0, Z * 5.0, 2), band=0.12)
    return f, top


def grave_paint(field, stone, stone_dark, lichen, rime, seed):
    n1 = Noise(seed)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 2.0, P[:, 1] * 2.0, P[:, 2] * 2.0, 3)
        c = mix(stone_dark, stone, np.clip(tone * 0.8 + edge * 0.5, 0, 1))
        c = c * (0.55 + 0.45 * ao)[:, None]
        low = np.clip(1 - P[:, 2] / 0.6, 0, 1)
        c = c * (1 - 0.25 * low)[:, None]
        lich = np.clip((tone - 0.55) * 3.0, 0, 1) * np.clip(1 - P[:, 2] / 1.4, 0, 1) * 0.55
        c = mix(c, lichen, lich)
        up = np.clip(N[:, 2], 0, 1)
        snow = sstep(0.5, 0.85, up + (tone - 0.5) * 0.3)
        return mix(c, rime, snow)

    return paint


def mound_field(GR, blobs, voxel=0.08, bury=0.25, lo=None, hi=None):
    """Snow (or frozen spoil) heaped on the real ground: a smooth union of
    flattened ellipsoids, cut off under the terrain. blobs: (lx, lz, rx,
    rz, height, yaw) in game coordinates; the height is over the ground."""
    pts = np.array([(b[0], b[1]) for b in blobs])
    r = max(max(b[2], b[3]) for b in blobs) + 0.6
    lo = lo or (pts[:, 0].min() - r, -(pts[:, 1].max() + r), min(GR.h(b[0], b[1]) for b in blobs) - bury - 0.4)
    hi = hi or (pts[:, 0].max() + r, -(pts[:, 1].min() - r), max(GR.h(b[0], b[1]) + b[4] for b in blobs) + 0.5)
    f = Sculpt(lo, hi, voxel)
    for (x, z, rx, rz, h, yaw) in blobs:
        g = GR.h(x, z)
        f.put('snow', Ellipsoid(G(x, z, g - h * 0.25), (rx, rz, h * 1.25), R=gs.rot(0, 0, yaw)), 0.35)
    H = ground_grid(GR, f)
    seat_on_ground(f, H, bury)
    n1 = Noise(int(abs(pts[0, 0] * 100 + pts[0, 1] * 37)) + 5)
    f.displace(lambda X, Y, Z: 0.03 * n1.fbm(X * 1.2, Y * 1.2, Z * 1.2, 2), band=0.2)
    return f


def snow_paint(field, snow, shade, seed):
    n1 = Noise(seed)

    def paint(P, N):
        ao, _ = ao_and_edge(field, P, N)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 1.5, P[:, 1] * 1.5, P[:, 2] * 1.5, 2)
        side = np.clip(1 - N[:, 2], 0, 1)
        c = mix(snow, shade, np.clip(side * 0.55 + (1 - ao) * 0.6 + (tone - 0.5) * 0.2, 0, 1))
        return c

    return paint


def cairn_field(GR, cx, cz, rng, voxel=0.05):
    """The Vigil cairn: courses of split stones stacked into a beacon, a flat
    cap stone for the fire basket, a face-stone toward the gate with the
    Vigil's open eye, snow lodged on every course."""
    nrng = np.random.default_rng(4141)
    g0 = min(GR.h(cx + dx, cz + dz) for dx in (-1, 0, 1) for dz in (-1, 0, 1))
    f = Sculpt((cx - 1.8, -(cz + 1.9), g0 - 0.6), (cx + 1.8, -(cz - 1.9), g0 + 3.0), voxel)
    y = g0 - 0.3
    for course, (r, h, n) in enumerate(((1.0, 0.5, 8), (0.84, 0.46, 7), (0.66, 0.42, 6), (0.48, 0.38, 5))):
        for k in range(n):
            a = math.tau * (k + rng.random() * 0.3) / n + course * 0.4
            px, pz = cx + math.cos(a) * r * 0.62, cz + math.sin(a) * r * 0.62
            R = gs.rot(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), a)
            f.put('stone', gs.block(nrng, G(px, pz, y + h * 0.5), (r * 0.8, r * 0.62, h * 1.05), cuts=6,
                                    chamfer=(0.75, 0.95), R=R, top_tilt=0.15), 0.03)
        y += h * 0.9
    f.put('stone', gs.block(nrng, G(cx, cz, y + 0.1), (0.95, 0.95, 0.28), cuts=6, chamfer=(0.8, 0.96)), 0.03)
    # the face-stone toward the gate (north) with the Vigil's eye
    fs = Frame(G(cx, cz + 0.98, 0.0), (1.0, 0.0, 0.0), (0.0, -1.0, 0.0))
    f.put('stone', Extrude(fs, [(-0.38, g0 - 0.3), (0.38, g0 - 0.3), (0.36, g0 + 1.0), (0.0, g0 + 1.18),
                                (-0.36, g0 + 1.0)], -0.22, 0.0, r=0.04), 0.02)
    ey = g0 + 0.72
    for sgn in (-1, 1):
        groove_polyline(f, [fs.at(-0.2, ey, 0.0), fs.at(0.0, ey + sgn * 0.11, 0.0), fs.at(0.2, ey, 0.0)], 0.03, 0.022)
    n1 = Noise(4142)
    f.displace(lambda X, Y, Z: 0.02 * n1.fbm(X * 3.0, Y * 3.0, Z * 3.0, 2), band=0.15)
    H = ground_grid(GR, f)
    seat_on_ground(f, H, 0.3)
    return f, y + 0.24


def rubble_field(GR, spots, rng, voxel=0.07):
    """Split stones and frozen scree where stone meets ground: (lx, lz, r)
    spots, each a few faceted blocks half sunk, snow drifted round them."""
    nrng = np.random.default_rng(6161)
    xs = [s_[0] for s_ in spots]
    zs = [s_[1] for s_ in spots]
    lo = (min(xs) - 2.0, -(max(zs) + 2.0), min(GR.h(x, z) for (x, z, r) in spots) - 1.0)
    hi = (max(xs) + 2.0, -(min(zs) - 2.0), max(GR.h(x, z) for (x, z, r) in spots) + 1.6)
    f = Sculpt(lo, hi, voxel)
    for (x, z, r) in spots:
        for k in range(rng.randint(2, 4)):
            ox, oz = x + rng.uniform(-0.6, 0.6) * r, z + rng.uniform(-0.6, 0.6) * r
            s_ = r * rng.uniform(0.35, 0.7)
            R = gs.rot(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, math.tau))
            f.put('stone', gs.block(nrng, G(ox, oz, GR.h(ox, oz) + s_ * 0.15), (s_ * 1.3, s_, s_ * 0.7), cuts=6,
                                    chamfer=(0.7, 0.94), R=R, top_tilt=0.3), 0.04)
        f.put('snow', Ellipsoid(G(x + rng.uniform(-0.3, 0.3) * r, z + rng.uniform(-0.3, 0.3) * r,
                                  GR.h(x, z) - 0.08), (r * 0.7, r * 0.5, 0.14)), 0.2)
    H = ground_grid(GR, f)
    seat_on_ground(f, H, 0.3)
    return f


def earth_paint(field, earth, earth_dark, frost, seed):
    """Frozen grave earth: dark soil, frost lodged in its hollows and on top."""
    n1 = Noise(seed)

    def paint(P, N):
        ao, _ = ao_and_edge(field, P, N)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 2.5, P[:, 1] * 2.5, P[:, 2] * 2.5, 2)
        c = mix(earth_dark, earth, np.clip(tone, 0, 1)) * (0.6 + 0.4 * ao)[:, None]
        speck = sstep(0.55, 0.75, tone) * np.clip(N[:, 2], 0, 1)
        return mix(c, frost, np.clip(speck * 0.9 + 0.15 * np.clip(N[:, 2], 0, 1), 0, 1))

    return paint
