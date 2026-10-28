"""The Anvil of the World's walk (phases 2K to 2M, build_smith_heart_heart_kit.py):
since phase 2M ONE floor of hand-painted warm stone round a central circle,
split by four curved seams in a pinwheel into one quarter per vein (the
numbers: quarter_geom.py, the sim's smith_heart_quarters.ts). The element
lives on the edges, never in the floor:

  - Kit_Quarter<Vein>: the quarter's share of the one floor (large irregular
    slabs laid once over the whole walk, the same stones on both sides of a
    seam), its colour drifted a few percent toward its element
    (`QUARTER_TINT`); its element's crackle bursting out of the central
    circle's rim a short way into it (the Breath's forked storm crackle, the
    Quench's frost cracks, the Hammer's earth fissures with gold glints, the
    Heat's molten cracks over a bed of fire), each over its scar in the
    stone; and the thin border light along both seams that bound it (the
    glow slot painted with `BORDER_TAG`).
  - Kit_HeartRidge: one seam's spine on the walk (ridge 0; the runtime turns
    it a quarter for each of the other three): a sculpted spine of dark
    rock, low enough to walk over (no collider; drawn so a floor telegraph
    always shows over it), a groove of light down its crest.
  - Kit_HeartRidgeHorn: the seam rising past the rim into its hooked horn.
  - Kit_HeartDais: the central circle's raised rim of dark rock (walkable,
    drawn like a spine), the light in its crest's groove and its notches,
    crystal breaking out of its inner face over the well.
  - Kit_HeartWell: the well's floor inside the rim: flat on the walk, its
    glow faces painted with `MIST_TAG` (the runtime draws the sunken well of
    mist and crystal under it).

The arrival's sockets (quarter_geom.SOCKETS): where the heart tears the
colossus's rock pieces out, the floor is broken round a pit, carved into
the piece of the quarter it lies in. The joint dirt under the slabs is
Kit_AnvilFloor's (`joint_bed`, holed under every socket).

The glow slot is a pale grey the runtime tints with the quarter's colour
and wakes (src/render/smith_heart/heart_quarters.ts). Frames: every piece at
the platform's centre on its walk (Blender -Y the game's north), placed
unturned (the ridge turned per ridge). Walk rule: on the walk (r < 60) the
stones stay a breath over it (every top under 0.056), the seams' spines and
the circle's rim at most 0.6 and 0.65; the horns stand past the lip.
Deterministic: every draw is a seeded rng or a seeded noise.
"""
import math

import numpy as np
import quarter_geom as qg
from gravewyrm_sculpt import Sculpt
from gwkit import crystal, slab
from heart_pieces import HSP, PALE_HI, PALE_LO, _clamp, pale_crystal
from hckit import GLOW
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, rot
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt
from ring_pieces import BASALT, BASALT_WORN, FLAG_PALE, FLAG_WARM, _area, _inset, polar_outline, prism_top
from shkit import DRESSED, PAINT, RAW, TAU

ICE_TAG = (0.42, 0.6, 0.92)  # a glow face painted this blue is the Quench's ice

# ---- tones (sRGB) ---------------------------------------------------------------------------
RIDGE_TONES = ((0.33, 0.31, 0.33), (0.37, 0.35, 0.36), (0.29, 0.28, 0.31), (0.35, 0.32, 0.33))
RIDGE_COLOURS = {'r0': (0.3, 0.28, 0.3), 'r1': (0.34, 0.31, 0.32), 'r2': (0.23, 0.22, 0.25), 'r3': (0.28, 0.27, 0.3)}
RIDGE_KINDS = {k: DRESSED for k in RIDGE_COLOURS}
HORN_COLOURS = {'r0': (0.27, 0.26, 0.29), 'r1': (0.31, 0.3, 0.32), 'r2': (0.23, 0.22, 0.25), 'r3': (0.29, 0.28, 0.31)}
HORN_KINDS = {k: RAW for k in HORN_COLOURS}
TOP_LO = 0.012
TOP_HI = 0.03
SKIN = 0.042  # a mark laid on the tops (grooves, scorings, veins), over every top
ICE_TOP = 0.05
WALK_TOP = 0.056  # nothing on a quarter rises past this on the walk
SPINE = 0.52  # the ridge's crest at its highest on the walk


# ---- small geometry ------------------------------------------------------------------------
def _densify(pts, step=0.3):
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[i]
        b = pts[(i + 1) % n]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        m = max(1, int(math.ceil(L / step)))
        for k in range(m):
            t = k / m
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def _clip(pts, f):
    """Keep the part of polygon `pts` where f(point) >= 0 (Sutherland-Hodgman
    with a scalar field; the edges are short, so a linear cut is exact
    enough)."""
    out = []
    n = len(pts)
    if n == 0:
        return out
    vals = [f(p) for p in pts]
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        fa, fb = vals[i], vals[(i + 1) % n]
        if fa >= 0:
            out.append(a)
        if (fa >= 0) != (fb >= 0):
            t = fa / (fa - fb)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def _simplify(pts, tol=0.04):
    """Drop the repeats and the near-collinear corners (one at a time, so a
    polygon never loses a real corner)."""
    out = []
    for q in pts:
        if not out or math.hypot(q[0] - out[-1][0], q[1] - out[-1][1]) > 1e-4:
            out.append(q)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 1e-4:
        out.pop()
    i = 0
    while len(out) > 3 and i < len(out):
        a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
        ac = math.hypot(c[0] - a[0], c[1] - a[1])
        d = abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / max(1e-9, ac)
        if d < tol:
            out.pop(i)
        else:
            i += 1
    return out


def _ccw(pts):
    pts = list(pts)
    if _area(pts) < 0:
        pts.reverse()
    return pts


def _centroid(pts):
    return sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)


def _pip(q, poly):
    x, y = q
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def _poly_dist(X, Y, poly):
    """Each point's distance (numpy) to a polygon's boundary."""
    best = np.full(np.shape(X), 1e9)
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        L2 = max(1e-12, ex * ex + ey * ey)
        t = np.clip(((X - ax) * ex + (Y - ay) * ey) / L2, 0.0, 1.0)
        best = np.minimum(best, np.hypot(X - ax - ex * t, Y - ay - ey * t))
    return best


def _lines_dist(X, Y, lines):
    """Each point's distance (numpy) to the nearest of some polylines."""
    best = np.full(np.shape(X), 1e9)
    for line in lines:
        for a, b in zip(line, line[1:]):
            ex, ey = b[0] - a[0], b[1] - a[1]
            L2 = max(1e-12, ex * ex + ey * ey)
            t = np.clip(((X - a[0]) * ex + (Y - a[1]) * ey) / L2, 0.0, 1.0)
            best = np.minimum(best, np.hypot(X - a[0] - ex * t, Y - a[1] - ey * t))
    return best


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _mixc(a, b, t):
    """Mix colour arrays (N, 3) a toward b (a colour or array) by t (N,)."""
    b = np.asarray(b, dtype=float)
    return a + (b - a) * np.asarray(t)[..., None]


def strip(p, a, b, w, z, color, slot=0, z1=None):
    """A thin flat strip from a to b (a groove, a scoring, a vein of light)
    lying at height z (to z1 at b), its face up."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    if L < 1e-4:
        return []
    nx, ny = -dy / L * w / 2, dx / L * w / 2
    z1 = z if z1 is None else z1
    bm = p.bm
    vs = [bm.verts.new((a[0] - nx, a[1] - ny, z)), bm.verts.new((b[0] - nx, b[1] - ny, z1)),
          bm.verts.new((b[0] + nx, b[1] + ny, z1)), bm.verts.new((a[0] + nx, a[1] + ny, z))]
    f = bm.faces.new(vs)
    p._paint([f], color, slot)
    p.facing([f], (0, 0, 1))
    return [f]


def ribbon(p, line, w, z, color, slot=GLOW, edge=None, taper=True):
    """A ribbon of quads along a polyline (a crack, a scoring, a fissure's
    fire): its middle painted `color`, its two edges `edge` (a darker
    shade), tapering to a point at both ends when `taper`."""
    if len(line) < 2:
        return []
    bm = p.bm
    n = len(line)
    rows = []
    for i, q in enumerate(line):
        a = line[max(0, i - 1)]
        b = line[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        k = 1.0
        if taper:
            u = i / (n - 1)
            k = min(1.0, 0.25 + 3.0 * min(u, 1.0 - u))
        ww = (w[i] if isinstance(w, (list, tuple)) else w) * 0.5 * k
        zz = z(q) if callable(z) else z
        rows.append([bm.verts.new((q[0] - nx * ww, q[1] - ny * ww, zz)), bm.verts.new((q[0], q[1], zz + 0.001)),
                     bm.verts.new((q[0] + nx * ww, q[1] + ny * ww, zz))])
    faces = []
    for i in range(n - 1):
        for j in range(2):
            faces.append(bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])))
    p._paint(faces, color, slot)
    if edge is not None:
        for f in faces:
            for loop in f.loops:
                if any(loop.vert is r[1] for r in rows):
                    continue
                loop[p.col] = (*edge, 1.0)
    p.facing(faces, (0, 0, 1))
    return faces


def _wander(rng, start, ang, steps, step=(0.45, 0.9), turn=0.5, keep=None):
    """A jagged line wandering from `start` (a crack's path)."""
    q = start
    out = [q]
    for _ in range(steps):
        ang += rng.uniform(-turn, turn)
        L = rng.uniform(*step)
        nq = (q[0] + math.cos(ang) * L, q[1] + math.sin(ang) * L)
        if keep is not None and not keep(nq):
            break
        out.append(nq)
        q = nq
    return out, ang


# ---- the quarter's walk --------------------------------------------------------------------
def _phi(x, y, i):
    """A point's unwound bearing, unwrapped round quarter i's sector."""
    r, b = qg.polar_of(x, y)
    s0, s1 = qg.sector(i)
    c = (s0 + s1) / 2
    phi = qg.unwind(b, r)
    return c + ((phi - c + 180.0) % 360.0) - 180.0, r


def quarter_fields(i, r_in, r_out, margin):
    """The clip fields of quarter i's walk: past the ring, inside the rim,
    `margin` yards clear of each of its two ridges."""
    s0, s1 = qg.sector(i)

    def f_in(p):
        return math.hypot(*p) - r_in

    def f_out(p):
        return r_out - math.hypot(*p)

    def f_a(p):
        phi, r = _phi(p[0], p[1], i)
        return math.radians(phi - s0) * r - margin

    def f_b(p):
        phi, r = _phi(p[0], p[1], i)
        return math.radians(s1 - phi) * r - margin

    return (f_in, f_out, f_a, f_b)


def inside_quarter(p, fields):
    return all(f(p) >= 0 for f in fields)


def clip_to_quarter(pts, fields, centre=None, tol=0.04):
    poly = _densify(pts)
    for f in fields:
        poly = _clip(poly, f)
        if len(poly) < 3:
            return []
    poly = _simplify(poly, tol)
    if len(poly) < 3 or abs(_area(poly)) < 0.12:
        return []
    # A tile across the wrap of the bearings (behind the centre) can fool the
    # linear cut: keep only a clean result, every corner inside and none
    # near the wrap.
    if any(f(q) < -0.05 for q in poly for f in fields):
        return []
    if centre is not None:
        for q in poly:
            phi, _r = _phi(q[0], q[1], centre)
            s0, s1 = qg.sector(centre)
            if abs(phi - (s0 + s1) / 2) > 140.0:
                return []
    if _area(poly) < 0:
        poly.reverse()
    return poly


def _frame(i):
    """Quarter i's middle at the rim: (bearing, unit out, unit across)."""
    b = (qg.sector(i)[0] + 45.0)
    a = math.radians(b)
    out = (math.sin(a), -math.cos(a))
    across = (math.cos(a), math.sin(a))
    return b, out, across


def _walk_fields(i):
    return quarter_fields(i, qg.RING_R + 0.35, qg.RIM_R, qg.RIDGE_HALF - 0.25)


def _warp(pts, n, amp=0.2, freq=0.3):
    """Bend a densified outline by a smooth shared field (neighbouring
    stones bend together: nothing ruler-straight, every joint closed)."""
    out = []
    for (x, y) in pts:
        dx = float(n.fbm(x * freq, y * freq, 0.5, 2))
        dy = float(n.fbm(x * freq + 17.0, y * freq - 9.0, 2.5, 2))
        out.append((x + dx * amp, y + dy * amp))
    return out


# ---- the sockets -----------------------------------------------------------------------------
class Socket:
    """One of the arrival's sockets: its centre (Blender), its pit's jagged
    radius by angle, and how far its broken paving reaches."""

    def __init__(self, k, bearing, r, size):
        self.k = k
        self.c = qg.bp(r, bearing)
        self.R = qg.socket_radius(size)
        self.Z = qg.socket_zone(size)
        self.n = Noise(7100 + k)
        self.seed = 7100 + k

    def jag(self, ang):
        """The pit's radius at angle `ang` (radians, Blender plan)."""
        v = float(self.n.fbm(math.cos(ang) * 1.3 + 4.0, math.sin(ang) * 1.3, 0.5, 3))
        return self.R * (1.0 + 0.11 * math.sin(ang * 3.0 + self.k) + 0.22 * v)

    def zone_jag(self, ang):
        v = float(self.n.fbm(math.cos(ang) * 1.1 - 3.0, math.sin(ang) * 1.1, 2.5, 3))
        return self.Z * (1.0 + 0.18 * v + 0.08 * math.sin(ang * 4.0 + self.k * 0.7))

    def f_out(self, q):
        """>= 0 outside the broken zone."""
        dx, dy = q[0] - self.c[0], q[1] - self.c[1]
        return math.hypot(dx, dy) - self.zone_jag(math.atan2(dy, dx))

    def contains(self, q, pad=0.0):
        dx, dy = q[0] - self.c[0], q[1] - self.c[1]
        return math.hypot(dx, dy) < self.zone_jag(math.atan2(dy, dx)) + pad


def sockets_in(i):
    """The sockets whose centres lie in quarter i."""
    out = []
    for k, (b, r, size) in enumerate(qg.SOCKETS):
        s = Socket(k, b, r, size)
        if qg.quarter_of(*s.c) == i:
            out.append(s)
    return out


def all_sockets():
    return [Socket(k, b, r, size) for k, (b, r, size) in enumerate(qg.SOCKETS)]


def _cut_round_sockets(outline, socks):
    """A slab's outline with every socket's broken zone taken out: a slab
    holding a socket's centre is first split into wedges about it (a slab
    never keeps a hole); returns the pieces."""
    pieces = [outline]
    for s in socks:
        nxt = []
        for poly in pieces:
            xs = [q[0] for q in poly]
            ys = [q[1] for q in poly]
            if (min(xs) > s.c[0] + s.Z * 1.4 or max(xs) < s.c[0] - s.Z * 1.4 or min(ys) > s.c[1] + s.Z * 1.4
                    or max(ys) < s.c[1] - s.Z * 1.4):
                nxt.append(poly)
                continue
            parts = [poly]
            if _pip(s.c, poly):
                parts = []
                for w in range(6):
                    a0 = TAU * w / 6 + s.k
                    a1 = a0 + TAU / 6

                    def fa(q, a0=a0):
                        return -math.sin(a0) * (q[0] - s.c[0]) + math.cos(a0) * (q[1] - s.c[1])

                    def fb(q, a1=a1):
                        return math.sin(a1) * (q[0] - s.c[0]) - math.cos(a1) * (q[1] - s.c[1])

                    wedge = _clip(_clip(_densify(poly, 0.25), fa), fb)
                    if len(wedge) >= 3:
                        parts.append(wedge)
            for part in parts:
                cut = _clip(_densify(part, 0.2), s.f_out)
                cut = _simplify(cut, 0.02)
                if len(cut) >= 3 and abs(_area(cut)) > 0.15:
                    nxt.append(_ccw(cut))
        pieces = nxt
    return pieces


# ---- a painted slab ----------------------------------------------------------------------
class SlabInfo:
    """What a painter knows of the slab it paints."""

    def __init__(self, tone, outline, h, axis=None):
        self.tone = np.asarray(tone, dtype=float)
        self.cx, self.cy = _centroid(outline)
        self.rad = max(0.6, math.sqrt(abs(_area(outline)) / math.pi))
        self.h = h
        if axis is None:
            # The slab's long axis (its largest spread).
            best = (1.0, 0.0)
            bl = -1.0
            for a in range(0, 180, 15):
                ux, uy = math.cos(math.radians(a)), math.sin(math.radians(a))
                proj = [(q[0] - self.cx) * ux + (q[1] - self.cy) * uy for q in outline]
                s = max(proj) - min(proj)
                if s > bl:
                    bl, best = s, (ux, uy)
            axis = best
        self.ax, self.ay = axis


def painted_slab(p, outline, top, info, paint, bevel=0.1, tilt=(0.0, 0.0), spacing=0.62, foot=-0.1, slot=0,
                 kind=PAINT, crown=0.006, edge_glow=None, lip_k=1.16, edge_k=0.8, foot_k=0.5):
    """A hand-painted stone: its top a dense triangulation (CDT, interior
    points about `spacing` apart) each vertex painted by `paint(X, Y, D,
    info)` (D: the distance to the slab's edge), a worn rounded arris (a pale
    lip, then a darker chamfer) and its sides down to `foot` in the joint's
    shadow. `edge_glow(a, b)` gives an edge's glow shade (its chamfer and
    side drawn in the glow slot: a fissure's lit lip) or None. Returns the
    top's height function."""
    pts = _ccw(_simplify(list(outline), 0.02))
    if len(pts) < 3 or abs(_area(pts)) < 0.08:
        return None
    area = abs(_area(pts))
    b = bevel
    inner = None
    for _ in range(5):
        cand = _inset(pts, b)
        if len(cand) >= 3 and _area(cand) > area * 0.3 and all(_pip(q, pts) for q in cand):
            inner = cand
            break
        b *= 0.6
    if inner is None:
        return None
    lip = _inset(pts, b * 0.42)
    cx, cy = _centroid(pts)
    rng = p.rng
    xs = [q[0] for q in inner]
    ys = [q[1] for q in inner]
    interior = []
    step = spacing
    yy = min(ys) + step * rng.uniform(0.2, 0.7)
    row = 0
    while yy < max(ys):
        xx = min(xs) + step * (0.5 if row % 2 else 0.0) + step * rng.uniform(0.0, 0.3)
        while xx < max(xs):
            q = (xx + rng.uniform(-0.28, 0.28) * step, yy + rng.uniform(-0.28, 0.28) * step)
            if _pip(q, inner) and float(_poly_dist(np.array([q[0]]), np.array([q[1]]), inner)[0]) > step * 0.42:
                interior.append(q)
            xx += step
        yy += step * 0.87
        row += 1
    n = len(inner)
    coords = [Vector((q[0], q[1])) for q in inner] + [Vector((q[0], q[1])) for q in interior]
    try:
        vco, _e, tris, orig, _oe, _of = delaunay_2d_cdt(coords, [(k, (k + 1) % n) for k in range(n)],
                                                        [list(range(n))], 1, 1e-6)
    except Exception:  # pragma: no cover (a degenerate outline)
        return None
    in2out = {}
    for oi, lst in enumerate(orig):
        for ii in lst:
            in2out.setdefault(ii, oi)
    if any(k not in in2out for k in range(n)) or not tris:
        return None

    def z_at(x, y):
        return top + (x - cx) * tilt[0] + (y - cy) * tilt[1]

    X = np.array([v.x for v in vco])
    Y = np.array([v.y for v in vco])
    D = _poly_dist(X, Y, pts)
    dome = crown * np.clip((D - b) / 0.9, 0.0, 1.0)
    Z = np.minimum(WALK_TOP - 0.004, top + (X - cx) * tilt[0] + (Y - cy) * tilt[1] + dome)
    col_top = np.clip(paint(X, Y, D, info), 0.0, 1.0)
    LX = np.array([q[0] for q in lip])
    LY = np.array([q[1] for q in lip])
    col_lip = np.clip(paint(LX, LY, np.full(len(lip), b * 0.42), info) * lip_k, 0.0, 1.0)
    EX = np.array([q[0] for q in pts])
    EY = np.array([q[1] for q in pts])
    col_edge = np.clip(paint(EX, EY, np.zeros(len(pts)), info) * edge_k, 0.0, 1.0)
    bm = p.bm
    tv = [bm.verts.new((float(X[k]), float(Y[k]), float(Z[k]))) for k in range(len(vco))]
    lv = [bm.verts.new((q[0], q[1], min(WALK_TOP - 0.006, z_at(*q) - b * 0.22))) for q in lip]
    ev = [bm.verts.new((q[0], q[1], min(WALK_TOP - 0.012, z_at(*q) - b * 0.8))) for q in pts]
    fv = [bm.verts.new((q[0], q[1], foot)) for q in pts]
    colour = {}
    for k, v in enumerate(tv):
        colour[v] = col_top[k]
    for k in range(n):
        colour[lv[k]] = col_lip[k]
        colour[ev[k]] = col_edge[k]
        colour[fv[k]] = col_edge[k] * (foot_k / max(0.05, edge_k))
    top_faces = []
    for t in tris:
        try:
            top_faces.append(bm.faces.new([tv[t[0]], tv[t[1]], tv[t[2]]]))
        except ValueError:
            pass
    ring_faces = []
    glow_faces = []
    for k in range(n):
        j = (k + 1) % n
        a_in, b_in = tv[in2out[k]], tv[in2out[j]]
        ring_faces.append(bm.faces.new((a_in, b_in, lv[j], lv[k])))
        g = edge_glow(pts[k], pts[j]) if edge_glow else None
        band = bm.faces.new((lv[k], lv[j], ev[j], ev[k]))
        side = bm.faces.new((ev[k], ev[j], fv[j], fv[k]))
        if g is None:
            ring_faces.extend((band, side))
        else:
            glow_faces.append((band, side, g))
    with p.as_kind(kind):
        p._paint(top_faces + ring_faces, (1.0, 1.0, 1.0), slot)
    p.facing(top_faces, (0, 0, 1))
    for f in top_faces + ring_faces:
        for loop in f.loops:
            c = colour.get(loop.vert)
            if c is not None:
                loop[p.col] = (float(c[0]), float(c[1]), float(c[2]), 1.0)
    out_dir = lambda c: Vector((c.x - cx, c.y - cy, 0.35))  # noqa: E731
    p.facing(ring_faces[: n], (0, 0, 1))
    p.facing(ring_faces[n:], out_dir)
    for (band, side, g) in glow_faces:
        p._paint([band, side], (g, g, g), GLOW)
        for loop in side.loops:
            if loop.vert in fv:
                loop[p.col] = (g * 0.55, g * 0.55, g * 0.55, 1.0)
        p.facing([band, side], out_dir)
    return z_at


# ---- the joints' dirt (Kit_AnvilFloor's bed) -------------------------------------------------
def joint_bed(p, z=-0.06):
    """The dirt the floor's slabs are set in (only seen in their joints): a
    polar sheet over the whole walk, one dark warm dirt with each quarter's
    drift (blended across its seams), a hole under every socket (its pit
    and apron carry their own). The well's floor covers its middle."""
    bm = p.bm
    socks = all_sockets()
    n1 = Noise(7001)
    radii = [qg.RING_R - 3.2]
    while radii[-1] < qg.RIM_R + 0.05:
        radii.append(min(qg.RIM_R + 0.08, radii[-1] + 2.4))
    rows = []
    for r in radii:
        m = max(8, int(math.ceil(TAU * max(r, 0.5) / 2.6)))
        rows.append([(r, 360.0 * k / m) for k in range(m)])

    def dirt(x, y):
        r, b = qg.polar_of(x, y)
        phi = qg.unwind(b, r)
        u = ((phi - (-45.0 + qg.RIM_OFFSET)) % 360.0) / 90.0
        i = int(u) % 4
        f = u - int(u)
        here = np.asarray(_tinted(FLOOR_DIRT, qg.ORDER[i]))
        arc = math.radians(90.0) * max(r, 1.0)
        if f * arc < 2.0:
            nb = np.asarray(_tinted(FLOOR_DIRT, qg.ORDER[(i - 1) % 4]))
            here = here + (nb - here) * 0.5 * (1.0 - f * arc / 2.0)
        elif (1.0 - f) * arc < 2.0:
            nb = np.asarray(_tinted(FLOOR_DIRT, qg.ORDER[(i + 1) % 4]))
            here = here + (nb - here) * 0.5 * (1.0 - (1.0 - f) * arc / 2.0)
        k = 0.85 + 0.3 * float(n1.fbm(x * 0.2, y * 0.2, 0.4, 2))
        return tuple(float(v) for v in np.clip(here * k, 0.0, 1.0))

    verts = []
    for row in rows:
        verts.append([bm.verts.new((*qg.bp(r, d), z)) for (r, d) in row])
    faces = []

    def holed(vs):
        cx = sum(v.co.x for v in vs) / 3
        cy = sum(v.co.y for v in vs) / 3
        return any(s.contains((cx, cy), pad=0.3) for s in socks)

    for a in range(len(rows) - 1):
        A, B = verts[a], verts[a + 1]
        na, nb = len(A), len(B)
        i = j = 0
        while i < na or j < nb:
            ua = (i + 1) / na
            ub = (j + 1) / nb
            if i < na and (j >= nb or ua <= ub):
                tri = (A[i % na], A[(i + 1) % na], B[j % nb])
                i += 1
            else:
                tri = (A[i % na], B[(j + 1) % nb], B[j % nb])
                j += 1
            if tri[0] is tri[1] or tri[1] is tri[2] or tri[0] is tri[2]:
                continue
            if holed(tri):
                continue
            try:
                faces.append(bm.faces.new(tri))
            except ValueError:
                pass
    with p.as_kind(PAINT):
        p._paint(faces, (0.2, 0.2, 0.2), 0)
    for f in faces:
        for loop in f.loops:
            loop[p.col] = (*dirt(loop.vert.co.x, loop.vert.co.y), 1.0)
    p.facing(faces, (0, 0, 1))


def socket_pit(p, s, stone, dirt, fresh, n_frag=11):
    """A socket's pit (see the module doc): jagged walls of broken paving
    falling to a floor of rubble and grit, a crack of the vein's light at its
    bottom, the broken zone round it in fragments tipped toward the pit
    (some missing, the grit apron showing), all of it under the walk."""
    rng = p.rng
    bm = p.bm
    cx, cy = s.c
    m = 40
    rings = ((1.0, 0.004, 'fresh'), (0.93, -0.12, 'fresh2'), (0.84, -0.3, 'wall'), (0.7, -0.46, 'deep'),
             (0.48, -0.52, 'floor'))
    tone = {'fresh': np.asarray(fresh), 'fresh2': np.asarray(fresh) * 0.8, 'wall': np.asarray(stone) * 0.48,
            'deep': np.asarray(dirt) * 0.8, 'floor': np.asarray(dirt)}
    grid = []
    for (k, z, t) in rings:
        row = []
        for j in range(m):
            a = TAU * j / m
            rr = s.jag(a) * k * (1.0 + (rng.uniform(-0.05, 0.05) if k < 1.0 else 0.0))
            row.append((bm.verts.new((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z + rng.uniform(-0.02, 0.02))),
                        t))
        grid.append(row)
    centre = bm.verts.new((cx, cy, -0.55))
    faces = []
    for a in range(len(grid) - 1):
        for j in range(m):
            k2 = (j + 1) % m
            faces.append(bm.faces.new((grid[a][j][0], grid[a][k2][0], grid[a + 1][k2][0], grid[a + 1][j][0])))
    for j in range(m):
        faces.append(bm.faces.new((grid[-1][j][0], grid[-1][(j + 1) % m][0], centre)))
    with p.as_kind(RAW):
        p._paint(faces, (0.3, 0.3, 0.3), 0)
    vt = {}
    for row in grid:
        for (v, t) in row:
            vt[v] = t
    for f in faces:
        for loop in f.loops:
            t = vt.get(loop.vert, 'floor')
            c = tone[t] * rng.uniform(0.86, 1.1)
            loop[p.col] = (*np.clip(c, 0, 1), 1.0)
    p.facing(faces, (0, 0, 1))
    # The apron of grit round it, under the broken zone's fragments.
    ap = []
    inner = [bm.verts.new((cx + math.cos(TAU * j / m) * s.jag(TAU * j / m) * 0.97,
                           cy + math.sin(TAU * j / m) * s.jag(TAU * j / m) * 0.97, -0.066)) for j in range(m)]
    outer = [bm.verts.new((cx + math.cos(TAU * j / m) * (s.zone_jag(TAU * j / m) + 1.75),
                           cy + math.sin(TAU * j / m) * (s.zone_jag(TAU * j / m) + 1.75), -0.066)) for j in range(m)]
    for j in range(m):
        k2 = (j + 1) % m
        ap.append(bm.faces.new((inner[j], inner[k2], outer[k2], outer[j])))
    with p.as_kind(PAINT):
        p._paint(ap, tuple(float(v) for v in dirt), 0)
    p.facing(ap, (0, 0, 1))
    # Rubble at its bottom and tumbled into it.
    with p.as_kind(RAW):
        for k in range(16):
            a = rng.uniform(0, TAU)
            rr = s.R * rng.uniform(0.0, 0.62)
            sz = rng.uniform(0.14, 0.38) * (s.R / 1.5)
            crystal(p, (cx + math.cos(a) * rr, cy + math.sin(a) * rr, -0.5 + sz * 0.25),
                    (sz * 1.4, sz * 1.1, sz * 0.6), p.vary(tuple(stone) if k % 3 else tuple(fresh), 0.1), n=10,
                    boxy=0.6, jitter=0.25, yaw=rng.uniform(0, TAU))
        # Slabs broken off the rim, tipped down into the pit.
        for k in range(5):
            a = rng.uniform(0, TAU)
            rr = s.jag(a) * 0.8
            sz = rng.uniform(0.45, 0.8) * (s.R / 1.5)
            slab(p, (cx + math.cos(a) * rr, cy + math.sin(a) * rr, -0.24), (sz * 1.3, sz, 0.12),
                 p.vary(tuple(stone), 0.08), yaw=a + math.pi / 2 + rng.uniform(-0.4, 0.4),
                 pitch=rng.uniform(0.35, 0.6), chamfer=0.25, jitter=0.2)
    # The vein's light at its bottom: a crack across the floor and its branches.
    a0 = rng.uniform(0, TAU)
    line = [(cx + math.cos(a0) * s.R * 0.62, cy + math.sin(a0) * s.R * 0.62)]
    ang = a0 + math.pi
    for _ in range(int(s.R * 2.2)):
        ang += rng.uniform(-0.45, 0.45)
        q = line[-1]
        line.append((q[0] + math.cos(ang) * 0.6, q[1] + math.sin(ang) * 0.6))
        if math.hypot(line[-1][0] - cx, line[-1][1] - cy) > s.R * 0.66:
            break
    ribbon(p, line, 0.16, -0.505, (0.62, 0.62, 0.62), edge=(0.3, 0.3, 0.3))
    for _ in range(2):
        j = rng.randrange(1, max(2, len(line) - 1))
        br, _ = _wander(rng, line[j], ang + rng.choice((-1.4, 1.4)), 3, (0.3, 0.5), 0.5,
                        keep=lambda q: math.hypot(q[0] - cx, q[1] - cy) < s.R * 0.6)
        ribbon(p, br, 0.09, -0.508, (0.5, 0.5, 0.5))
    # The broken zone: fragments of the quarter's paving between the pit and
    # the whole slabs, tipped toward the pit, a few missing.
    seeds = []
    for k in range(n_frag * 3):
        a = rng.uniform(0, TAU)
        rr = rng.uniform(s.jag(a), s.zone_jag(a))
        seeds.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    cells = _voronoi_cells(seeds, (cx - s.Z * 2, cy - s.Z * 2, cx + s.Z * 2, cy + s.Z * 2), reach=2.0)
    frags = []
    for cell in cells:
        poly = _clip(_densify(cell, 0.15), lambda q: math.hypot(q[0] - cx, q[1] - cy) -
                     s.jag(math.atan2(q[1] - cy, q[0] - cx)))
        poly = _clip(poly, lambda q: -s.f_out(q))
        poly = _simplify(poly, 0.02)
        if len(poly) < 3 or abs(_area(poly)) < 0.06:
            continue
        frags.append(_inset(_ccw(poly), rng.uniform(0.03, 0.06)))
    return frags


def lay_fragments(p, frags, s, tones, paint, fresh):
    """The broken zone's fragments: each a small painted slab tipped toward
    the pit, its broken edge pale (fresh fracture); one in six missing."""
    rng = p.rng
    for poly in frags:
        if rng.random() < 0.17 or abs(_area(poly)) < 0.05:
            continue
        cxf, cyf = _centroid(poly)
        dx, dy = cxf - s.c[0], cyf - s.c[1]
        L = math.hypot(dx, dy) or 1.0
        k = rng.uniform(0.02, 0.05)
        tilt = (dx / L * k, dy / L * k)
        info = SlabInfo(p.vary(tones[rng.randrange(len(tones))], 0.06), poly, rng.random())
        top = rng.uniform(TOP_LO - 0.01, TOP_HI - 0.012)
        painted_slab(p, poly, top, info, paint, bevel=rng.uniform(0.03, 0.05), tilt=tilt, spacing=0.5,
                     edge_k=0.95, lip_k=1.22)


# ---- Voronoi cells -------------------------------------------------------------------------
def _voronoi_cells(seeds, box, reach=4.0):
    """Each seed's Voronoi cell inside `box` (x0, y0, x1, y1): a square of
    side 2 `reach` round it clipped by the bisectors with its near
    neighbours. Returns the cells in seed order (an empty list for none)."""
    x0, y0, x1, y1 = box
    pts = np.asarray(seeds)
    out = []
    for s in pts:
        poly = [(max(x0, s[0] - reach), max(y0, s[1] - reach)), (min(x1, s[0] + reach), max(y0, s[1] - reach)),
                (min(x1, s[0] + reach), min(y1, s[1] + reach)), (max(x0, s[0] - reach), min(y1, s[1] + reach))]
        d = np.hypot(pts[:, 0] - s[0], pts[:, 1] - s[1])
        for jdx in np.argsort(d)[1:16]:
            o = pts[jdx]
            mx, my = (s[0] + o[0]) / 2, (s[1] + o[1]) / 2
            nx, ny = s[0] - o[0], s[1] - o[1]
            poly = _clip(poly, lambda q, mx=mx, my=my, nx=nx, ny=ny: (q[0] - mx) * nx + (q[1] - my) * ny)
            if len(poly) < 3:
                break
        out.append(poly if len(poly) >= 3 else [])
    return out


def _relaxed(seeds, box, reach, rounds=1, blend=0.45):
    """Part of a Lloyd's relaxation (each seed moved `blend` of the way to its
    cell's centroid): no slivers, still irregular (a full one tends to a
    honeycomb)."""
    for _ in range(rounds):
        cells = _voronoi_cells(seeds, box, reach)
        nxt = []
        for c, s in zip(cells, seeds):
            if c:
                cx, cy = _centroid(c)
                nxt.append((s[0] + (cx - s[0]) * blend, s[1] + (cy - s[1]) * blend))
            else:
                nxt.append(s)
        seeds = nxt
    return seeds, _voronoi_cells(seeds, box, reach)


# ---- the painters --------------------------------------------------------------------------
LIGHT2 = (-0.42, 0.58)  # the painted light's side (plan), never the sun


class Painter:
    """A quarter's stone painter: colour drifting inside the stone (its warm
    and cool companions), brush strokes along the slab's form, a painted
    light across it, a worn pale lip and dirt toward its joints."""

    def __init__(self, seed, warm, cool, drift=0.18, hue=0.35, stroke=0.08, light=0.14, lip=0.22, grime=0.28,
                 lip_w=0.16, extra=None):
        self.n = Noise(seed)
        self.warm = np.asarray(warm)
        self.cool = np.asarray(cool)
        self.drift = drift
        self.hue = hue
        self.stroke = stroke
        self.light = light
        self.lip = lip
        self.grime = grime
        self.lip_w = lip_w
        self.extra = extra

    def __call__(self, X, Y, D, s):
        n = self.n
        X = np.asarray(X, dtype=float)
        Y = np.asarray(Y, dtype=float)
        D = np.asarray(D, dtype=float)
        base = np.broadcast_to(s.tone, (len(X), 3)).astype(float)
        t = np.clip(0.5 + 1.1 * n.fbm(X * 0.09 + 5.0, Y * 0.09 - 3.0, 1.7 + s.h, 2), 0.0, 1.0)
        comp = self.cool[None, :] + (self.warm - self.cool)[None, :] * t[:, None]
        col = base + (comp - base) * self.hue * (0.6 + 0.4 * np.abs(2 * t[:, None] - 1))
        k = 1.0 + self.drift * n.fbm(X * 0.23 + s.h * 13.0, Y * 0.23, 0.37, 3)
        u = (X - s.cx) * s.ax + (Y - s.cy) * s.ay
        v = -(X - s.cx) * s.ay + (Y - s.cy) * s.ax
        k = k * (1.0 + self.stroke * n(u * 0.55 + s.h * 40.0, v * 2.4, 3.3 + s.h))
        lit = ((X - s.cx) * LIGHT2[0] + (Y - s.cy) * LIGHT2[1]) / s.rad
        k = k * (1.0 + self.light * np.clip(lit, -1.0, 1.0))
        lip = np.exp(-D / self.lip_w)
        grime = _smooth(0.75, 0.12, D) * np.clip(0.5 + 0.9 * n.fbm(X * 0.8, Y * 0.8, 8.1, 2), 0.0, 1.0)
        k = k * (1.0 + self.lip * lip) * (1.0 - self.grime * grime * (1.0 - lip))
        col = col * k[:, None]
        if self.extra is not None:
            col = self.extra(X, Y, D, s, col)
        return col


def _chip_corners(rng, poly, chance=0.35):
    """Knock a corner or two off a block (the mason's hammer)."""
    out = []
    n = len(poly)
    for k in range(n):
        q = poly[k]
        if rng.random() < chance:
            a = poly[k - 1]
            b = poly[(k + 1) % n]
            la = math.hypot(a[0] - q[0], a[1] - q[1])
            lb = math.hypot(b[0] - q[0], b[1] - q[1])
            c = rng.uniform(0.12, 0.42)
            ta = min(0.4, c / max(1e-6, la))
            tb = min(0.4, c / max(1e-6, lb))
            out.append((q[0] + (a[0] - q[0]) * ta, q[1] + (a[1] - q[1]) * ta))
            out.append((q[0] + (b[0] - q[0]) * tb, q[1] + (b[1] - q[1]) * tb))
        else:
            out.append(q)
    return out


def _split_broken(rng, poly):
    """A block broken in two along a jagged line (each half its own stone)."""
    cx, cy = _centroid(poly)
    ang = rng.uniform(0, math.pi)
    ux, uy = math.cos(ang), math.sin(ang)
    off = rng.uniform(-0.25, 0.25)
    jag = Noise(int(rng.random() * 1e6))

    def f(q, sgn):
        d = (q[0] - cx) * -uy + (q[1] - cy) * ux - off
        along = (q[0] - cx) * ux + (q[1] - cy) * uy
        return sgn * (d + 0.18 * float(jag(along * 1.6, 0.3, 0.7))) - 0.035

    halves = []
    for sgn in (1, -1):
        h = _simplify(_clip(_densify(poly, 0.2), lambda q, s=sgn: f(q, s)), 0.02)
        if len(h) >= 3 and abs(_area(h)) > 0.2:
            halves.append(_ccw(h))
    return halves


def _rubble(p, rng, poly, tones, n=6):
    """Rubble chips in a missing stone's hole (under the walk's breath)."""
    cx, cy = _centroid(poly)
    rad = math.sqrt(abs(_area(poly)) / math.pi)
    with p.as_kind(RAW):
        for _ in range(n):
            a = rng.uniform(0, TAU)
            r = rad * rng.uniform(0.0, 0.7)
            sz = rng.uniform(0.12, 0.32)
            crystal(p, (cx + math.cos(a) * r, cy + math.sin(a) * r, -0.06 + sz * 0.16), (sz * 1.4, sz, sz * 0.38),
                    p.vary(tones[rng.randrange(len(tones))], 0.1), n=9, boxy=0.6, jitter=0.25,
                    yaw=rng.uniform(0, TAU))


def _clip_segment(poly, a, b):
    """The part of segment a-b inside a (roughly convex) polygon."""
    t0, t1 = 0.0, 1.0
    n = len(poly)
    pts = _ccw(poly)
    for k in range(n):
        p0 = pts[k]
        p1 = pts[(k + 1) % n]
        ex, ey = p1[0] - p0[0], p1[1] - p0[1]
        fa = ex * (a[1] - p0[1]) - ey * (a[0] - p0[0])
        fb = ex * (b[1] - p0[1]) - ey * (b[0] - p0[0])
        if fa < 0 and fb < 0:
            return None
        if fa < 0 or fb < 0:
            t = fa / (fa - fb)
            if fa < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
    if t1 - t0 < 0.05:
        return None
    return ((a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
            (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1))


# ================================================================ the one floor (phase 2M)
# One hand-painted warm stone over the whole walk (the style guide's quiet
# field, R2): large irregular slabs laid ONCE over the platform (the same
# seeds for every quarter, so the joints run on unbroken under the seams),
# each quarter's piece the stones that fall in it, its colour drifted a few
# percent toward its element (`QUARTER_TINT`): enough to tell them apart,
# never four floors. The element lives on the edges: each quarter's crackle
# bursting out of the central circle's rim (`_rim_crackle`) and its border
# light along the two seams that bound it (`_border_light`).

STONE_TONES = ((0.57, 0.47, 0.43), (0.53, 0.45, 0.42), (0.61, 0.5, 0.45), (0.5, 0.43, 0.41), (0.56, 0.48, 0.45),
               (0.49, 0.42, 0.4), (0.59, 0.49, 0.44), (0.54, 0.47, 0.45))
STONE_WARM = (0.63, 0.49, 0.41)
STONE_COOL = (0.47, 0.44, 0.47)
STONE_DUST = (0.7, 0.62, 0.55)
STONE_STAIN = (0.36, 0.3, 0.29)
FLOOR_DIRT = (0.26, 0.21, 0.2)
# Each quarter's drift toward its element (a multiply, a few percent of hue,
# its value kept within a percent of the others): the Breath a breath of
# violet, the Quench of cold blue, the Hammer of ochre, the Heat of ember
# red.
QUARTER_TINT = {
    'breath': (1.015, 0.98, 1.06),
    'quench': (0.97, 1.0, 1.06),
    'hammer': (1.04, 1.0, 0.93),
    'heat': (1.05, 0.99, 0.94),
}
SLAB_SPACING = 6.4
# A glow face painted with its green well over its red is a border light
# (the runtime draws it as the thin line of the quarter's colour along a
# seam); a grey glow face is the rim's crackle; one under the walk the
# Heat's fire bed.
BORDER_TAG = (0.42, 0.86, 0.42)


def _tinted(c, vein, k=1.0):
    t = QUARTER_TINT[vein]
    return tuple(min(1.0, c[j] * (1.0 + (t[j] - 1.0) * k)) for j in range(3))


_CELLS = None


def floor_cells():
    """The one floor's stones (Voronoi cells over the whole walk, Blender
    plan), the same for every quarter's piece."""
    global _CELLS
    if _CELLS is not None:
        return _CELLS
    import random
    rng = random.Random(6007)
    sp = SLAB_SPACING
    cell = sp * 0.7
    grid = {}
    out = []
    clear = []
    r0, r1 = qg.RING_R - 3.0, qg.RIM_R + 3.5
    want = int(math.pi * (r1 * r1 - r0 * r0) / (sp * sp * 0.8))
    for _ in range(want * 30):
        if len(out) >= want:
            break
        r = math.sqrt(rng.uniform(r0 * r0, r1 * r1))
        q = qg.bp(r, rng.uniform(0.0, 360.0))
        # Smaller stones near the circle and the wall (worn, patched), the
        # biggest across the open middle of each quarter.
        u = (r - qg.RING_R) / (qg.RIM_R - qg.RING_R)
        size = 0.78 + 0.5 * math.sin(math.pi * max(0.0, min(1.0, u)))
        c = sp * size * rng.uniform(0.62, 1.45)
        gx, gy = int(math.floor(q[0] / cell)), int(math.floor(q[1] / cell))
        ok = True
        reach = int(math.ceil(sp * 1.6 / cell)) + 1
        for ix in range(gx - reach, gx + reach + 1):
            for iy in range(gy - reach, gy + reach + 1):
                for j in grid.get((ix, iy), ()):
                    o = out[j]
                    if math.hypot(o[0] - q[0], o[1] - q[1]) < 0.5 * (c + clear[j]):
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            grid.setdefault((gx, gy), []).append(len(out))
            out.append(q)
            clear.append(c)
    box = (-qg.RIM_R - 6.0, -qg.RIM_R - 6.0, qg.RIM_R + 6.0, qg.RIM_R + 6.0)
    cells = _voronoi_cells(out, box, reach=sp * 1.8)
    _CELLS = cells
    return cells


class StonePainter(Painter):
    """The one floor's paint: the warm stone with its quarter's drift, dust
    settled in the hollows, old stains, a wide pale worn lip."""

    def __init__(self, vein):
        tint = QUARTER_TINT[vein]
        warm = tuple(STONE_WARM[j] * tint[j] for j in range(3))
        cool = tuple(STONE_COOL[j] * tint[j] for j in range(3))
        super().__init__(6801, warm, cool, drift=0.16, hue=0.34, stroke=0.07, light=0.16, lip=0.24, grime=0.3,
                         lip_w=0.22, extra=self._extra)

    def _extra(self, X, Y, D, s, col):
        n = self.n
        dust = np.clip(n.fbm(X * 0.11 + 9.0, Y * 0.11, 2.2, 3) * 1.8 - 0.3, 0.0, 1.0)
        col = _mixc(col, STONE_DUST, dust * 0.2)
        stain = np.clip(n.fbm(X * 0.09 - 4.0, Y * 0.09 + 2.0, 6.0, 2) * 2.0 - 0.45, 0.0, 1.0)
        col = _mixc(col, STONE_STAIN, stain * 0.28)
        # Big painted value groups across the whole floor (squint and the
        # stones still separate, M4).
        big = 1.0 + 0.09 * n.fbm(X * 0.06 + 1.0, Y * 0.06, 4.0, 2)
        return col * big[:, None]


def _hairline(p, rng, part, z_at):
    """An old hairline crack across a big stone (painted dark, never lit)."""
    inner = _inset(part, 0.45)
    if len(inner) < 3 or abs(_area(inner)) < 1.0:
        return
    cx, cy = _centroid(part)
    ang = rng.uniform(0, math.pi)
    a = (cx - math.cos(ang) * 8, cy - math.sin(ang) * 8)
    b = (cx + math.cos(ang) * 8, cy + math.sin(ang) * 8)
    seg = _clip_segment(inner, a, b)
    if not seg:
        return
    line = [seg[0]]
    m = 6
    for t in range(1, m):
        u = t / m
        line.append((seg[0][0] + (seg[1][0] - seg[0][0]) * u + rng.uniform(-0.2, 0.2),
                     seg[0][1] + (seg[1][1] - seg[0][1]) * u + rng.uniform(-0.2, 0.2)))
    line.append(seg[1])
    z = min(WALK_TOP - 0.004, max(z_at(*q) for q in line) + 0.014)
    ribbon(p, line, 0.09, z, (0.27, 0.22, 0.21), slot=0, edge=(0.4, 0.34, 0.32))


def quarter_floor(bpy, vein):
    """Kit_Quarter<Vein> (phase 2M): this quarter's share of the one floor,
    its crackle at the circle's rim and its border light (see the module
    doc)."""
    i = qg.ORDER.index(vein)
    seeds = {'breath': 6201, 'quench': 6301, 'hammer': 6101, 'heat': 6401}
    p = HSP('Kit_Quarter' + vein.capitalize(), seed=seeds[vein], ao=0.12, ao_dist=0.35, dust=0.0)
    rng = p.rng
    fields = _walk_fields(i)
    socks = sockets_in(i)
    paint = StonePainter(vein)
    tones = [_tinted(t, vein) for t in STONE_TONES]
    nw = Noise(6809)
    nw2 = Noise(6810)
    import random
    lay = random.Random(6811)  # the slabs' own draws, shared by every quarter
    for idx, cell in enumerate(floor_cells()):
        crng = random.Random(90001 + idx)  # this stone's own (the same in every quarter)
        # Draw this stone's choices from the shared stream first, so a stone
        # cut by a seam is the same stone on both sides of it.
        d_chip = lay.random()
        d_join = lay.uniform(0.04, 0.1)
        d_kind = lay.random()
        d_tone = lay.randrange(len(tones))
        d_top = lay.uniform(TOP_LO, TOP_HI)
        d_tilt = (lay.uniform(-0.004, 0.004), lay.uniform(-0.004, 0.004))
        d_bevel = lay.uniform(0.12, 0.18)
        d_h = lay.random()
        d_crack = lay.random()
        if not cell:
            continue
        bx, by = _centroid(cell)
        if math.hypot(bx, by) < qg.RING_R - 6.0 or math.hypot(bx, by) > qg.RIM_R + 8.0:
            continue
        # Bent by a broad shared field (big slabs never ruler-straight: their
        # sides bow and kink like hand-laid stone) and a finer one.
        cell = _warp(_densify(_ccw(cell), 0.6), nw, 0.75, 0.07)
        cell = _simplify(_ccw(_warp(cell, nw2, 0.18, 0.35)), 0.04)
        if d_chip < 0.45:
            cell = _chip_corners(crng, cell, 0.18)
        cell = _inset(cell, d_join)
        outline = clip_to_quarter(cell, fields, i, tol=0.08)
        if not outline:
            continue
        for piece in _cut_round_sockets(outline, socks):
            if d_kind < 0.025 and abs(_area(piece)) < 8.0:
                _rubble(p, crng, piece, tones, 11)
                continue
            parts = _split_broken(crng, piece) if d_kind < 0.09 else [piece]
            for part in parts:
                tone = p.vary(tones[d_tone], 0.035)
                info = SlabInfo(tone, part, d_h)
                tilt = d_tilt if len(parts) == 1 else (rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01))
                z_at = painted_slab(p, part, d_top, info, paint, bevel=d_bevel, tilt=tilt, spacing=1.15,
                                    crown=0.012, lip_k=1.2)
                if z_at and d_crack < 0.22 and abs(_area(part)) > 8.0:
                    _hairline(p, rng, part, z_at)
    _rim_crackle(p, rng, i, vein, socks)
    _border_light(p, i)
    for s in socks:
        frags = socket_pit(p, s, _tinted((0.42, 0.36, 0.34), vein), _tinted(FLOOR_DIRT, vein),
                           _tinted((0.74, 0.66, 0.6), vein))
        lay_fragments(p, frags, s, tones, paint, _tinted((0.74, 0.66, 0.6), vein))
    return p


def quarter_hammer(bpy):
    return quarter_floor(bpy, 'hammer')


def quarter_breath(bpy):
    return quarter_floor(bpy, 'breath')


def quarter_quench(bpy):
    return quarter_floor(bpy, 'quench')


def quarter_heat(bpy):
    return quarter_floor(bpy, 'heat')


# ---- the element on the edges ----------------------------------------------------------------
# How each element's crackle runs out of the rim: its line's step, its turn
# (radians a step), its branching, how far out it reaches (yards past the
# ring), its light's width and its scar's.
CRACKLE = {
    # Storm crackle: forked lightning, sharp zigzags, many forks.
    'breath': dict(mains=11, step=(0.45, 1.0), turn=0.95, branch=0.32, reach=(6.0, 13.0), w=0.18, scar=0.36,
                   scar_col=(0.22, 0.2, 0.27)),
    # Frost cracks: near straight, branching at a frost fern's angles, a
    # rime of pale stone along them.
    'quench': dict(mains=10, step=(0.6, 1.0), turn=0.22, branch=0.42, reach=(5.5, 11.5), w=0.15, scar=0.48,
                   scar_col=(0.78, 0.82, 0.88)),
    # Earth fissures: few, wide, wandering, a dark scar either side.
    'hammer': dict(mains=8, step=(0.8, 1.5), turn=0.38, branch=0.16, reach=(7.0, 13.5), w=0.28, scar=0.7,
                   scar_col=(0.2, 0.15, 0.1)),
    # Molten cracks: wide glowing seams over a bed of fire, scorched round.
    'heat': dict(mains=9, step=(0.7, 1.3), turn=0.42, branch=0.24, reach=(7.0, 13.5), w=0.3, scar=0.85,
                 scar_col=(0.12, 0.06, 0.04)),
}


def _ribbon_fade(p, line, w, z, shade, slot=GLOW, fade=(1.0, 0.4), edge_k=0.55, colour=None):
    """A crackle's ribbon: its light fading from `fade[0]` at its root to
    `fade[1]` at its tip (the burst out of the rim dying into the stone),
    its edges `edge_k` of its middle; `colour` overrides the grey."""
    faces = ribbon(p, line, w, z, (shade, shade, shade), slot=slot)
    if not faces:
        return faces
    n = len(line)
    pos = {}
    for f in faces:
        for loop in f.loops:
            v = loop.vert
            if v in pos:
                continue
            best = 0
            bd = 1e9
            for k, q in enumerate(line):
                d = (q[0] - v.co.x) ** 2 + (q[1] - v.co.y) ** 2
                if d < bd:
                    bd, best = d, k
            pos[v] = best
    for f in faces:
        for loop in f.loops:
            v = loop.vert
            u = pos[v] / max(1, n - 1)
            k = fade[0] + (fade[1] - fade[0]) * u
            mid = math.hypot(v.co.x - line[pos[v]][0], v.co.y - line[pos[v]][1]) < 1e-3
            e = 1.0 if mid else edge_k
            if colour is not None:
                c = tuple(cc * (0.5 + 0.5 * k) * (1.0 if mid else 1.0) for cc in colour)
            else:
                g = shade * k * e
                c = (g, g, g)
            loop[p.col] = (*c, 1.0)
    return faces


def _crackle_line(rng, start, ang, cfg, ok, reach):
    """One crackle line out of the rim: wandering outward per its element."""
    line = [start]
    q = start
    r_end = math.hypot(*start) + reach
    for _ in range(60):
        r = math.hypot(*q)
        out = math.atan2(q[1], q[0])
        d = (out - ang + math.pi) % TAU - math.pi
        ang += 0.3 * d + rng.uniform(-cfg['turn'], cfg['turn'])
        L = rng.uniform(*cfg['step'])
        nq = (q[0] + math.cos(ang) * L, q[1] + math.sin(ang) * L)
        if not ok(nq) or math.hypot(*nq) < r - 0.3:
            break
        line.append(nq)
        q = nq
        if math.hypot(*q) > r_end:
            break
    return line, ang


def _rim_crackle(p, rng, i, vein, socks):
    """Quarter i's element bursting out of the central circle's rim: lines
    of its light (the glow slot, grey: the runtime's crackle) running a
    short way out into the quarter and forking, fading as they go, each
    over its scar in the stone (the Heat's over a bed of fire)."""
    cfg = CRACKLE[vein]
    fields = quarter_fields(i, qg.RING_R - 0.2, qg.RIM_R - 2.0, qg.RIDGE_HALF + 0.35)
    s0, s1 = qg.sector(i)

    def ok(q):
        return inside_quarter(q, fields) and not any(s.contains(q, 0.4) for s in socks)

    lines = []
    m = cfg['mains']
    for k in range(m):
        phi = s0 + 4.0 + (s1 - s0 - 8.0) * (k + rng.uniform(0.2, 0.8)) / m
        r = qg.RING_R + 0.15
        start = qg.bp(r, qg.wind(phi, r))
        if not ok(start):
            continue
        a = math.atan2(start[1], start[0]) + rng.uniform(-0.35, 0.35)
        reach = rng.uniform(*cfg['reach'])
        line, ang = _crackle_line(rng, start, a, cfg, ok, reach)
        if len(line) < 3:
            continue
        lines.append((line, 1.0, 0.25 + 0.15 * rng.random()))
        for j in range(1, len(line) - 1):
            if rng.random() < cfg['branch']:
                if vein == 'quench':
                    turn = rng.choice((-1.0, 1.0)) * math.radians(rng.uniform(52.0, 66.0))
                else:
                    turn = rng.choice((-1.0, 1.0)) * rng.uniform(0.5, 1.1)
                prev = line[j - 1]
                da = math.atan2(line[j][1] - prev[1], line[j][0] - prev[0])
                br, _ = _wander(rng, line[j], da + turn, rng.randrange(2, 6),
                                (cfg['step'][0] * 0.7, cfg['step'][1] * 0.8), cfg['turn'] * 0.7, keep=ok)
                if len(br) > 2:
                    u = j / (len(line) - 1)
                    lines.append((br, 0.9 - 0.5 * u, 0.15))
    for (line, f0, f1) in lines:
        main = f0 > 0.95
        w = cfg['w'] * (1.0 if main else 0.7)
        # Its scar in the stone (stone slot), then its light over it.
        _ribbon_fade(p, line, cfg['scar'] * (1.0 if main else 0.7), SKIN - 0.006, 1.0, slot=0, fade=(1.0, 0.7),
                     colour=cfg['scar_col'])
        _ribbon_fade(p, line, w, SKIN, 1.0, fade=(f0, f1), edge_k=0.5)
        if vein == 'heat':
            # The bed of fire under a molten crack (the embers rise off it).
            _ribbon_fade(p, line, cfg['scar'] * 1.4, -0.035, 1.0, fade=(f0, f1 * 0.6), edge_k=0.45)
    if vein == 'hammer':
        # Gold glints of the geode crystal broken out along its fissures.
        for (line, _f0, _f1) in lines[:8]:
            q = line[min(len(line) - 1, 2)]
            with p.as_kind(PAINT):
                pale_crystal(p, (q[0], q[1], -0.01), (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 1.0),
                             0.06, rng.uniform(0.08, 0.12), squash=0.5)
    return lines


def _border_light(p, i):
    """The thin line of quarter i's light along each seam that bounds it,
    at the spine's foot, from the circle's rim to the wall (the glow slot
    painted with the border tag)."""
    s0, s1 = qg.sector(i)
    off = qg.RIDGE_HALF + 0.12
    for (edge, sgn) in ((s0, 1.0), (s1, -1.0)):
        line = []
        r = qg.RING_R + 0.3
        while r < qg.RIM_R - 0.25:
            phi = edge + sgn * math.degrees(off / r)
            line.append(qg.bp(r, qg.wind(phi, r)))
            r += 0.5
        rr = qg.RIM_R - 0.25
        line.append(qg.bp(rr, qg.wind(edge + sgn * math.degrees(off / rr), rr)))
        faces = ribbon(p, line, 0.16, SKIN + 0.002, BORDER_TAG, slot=GLOW, taper=False)
        for f in faces:
            for loop in f.loops:
                loop[p.col] = (*BORDER_TAG, 1.0)


# ================================================================ the ridge
def heart_ridge(bpy):
    """Kit_HeartRidge: one ridge's spine on the walk (ridge 0; see the module
    doc): a sculpted spine of rock, its vertebrae fused on a broad rounded
    back, faceted and chipped, a groove down its crest and cracks across
    its notches with the vein's light inside them."""
    from mathutils.bvhtree import BVHTree

    p = HSP('Kit_HeartRidge', seed=6501, ao=0.3, ao_dist=0.7, dust=0.0)
    rng = p.rng
    n1 = Noise(6503)
    k = 0
    r0 = qg.RING_R - 0.6
    r1 = qg.RIM_R + 0.3

    def at(r, s=0.0):
        """The ridge's line at radius r, `s` yards across it (+: clockwise)."""
        b = qg.ridge_deg(k, r)
        cx, cy = qg.bp(r, b)
        tx, ty = qg.bp(r + 0.05, qg.ridge_deg(k, r + 0.05))
        dx, dy = tx - cx, ty - cy
        L = math.hypot(dx, dy)
        return (cx - dy / L * s, cy + dx / L * s), math.atan2(dy, dx)

    line = []
    rr = r0
    while rr < r1:
        line.append(at(rr)[0])
        rr += 0.5
    xs = [q[0] for q in line]
    ys = [q[1] for q in line]
    f = Sculpt((min(xs) - 4.0, min(ys) - 4.0, -0.5), (max(xs) + 4.0, max(ys) + 4.0, 1.1), 0.13)
    # The broad rounded back the vertebrae grow from (never higher than
    # about two hands, its foot flaring into the paving).
    back = []
    radii = []
    rr = r0 - 0.4
    while rr < r1 + 0.6:
        q, _ = at(rr)
        back.append((q[0], q[1], -2.65))
        radii.append(2.95 + 0.12 * math.sin(rr * 0.8 + 1.0) + 0.35 * max(0.0, 1.0 - (rr - qg.RING_R) / 3.0))
        rr += 0.8
    f.put('r2', Polyline(back, radii), 0.3)
    # The vertebrae: a fused chain of rock, each its own length, height and
    # set, a notch between each and the next.
    cuts = [r0]
    while cuts[-1] < r1 - 1.0:
        cuts.append(cuts[-1] + rng.uniform(1.6, 2.9))
    cuts[-1] = r1
    notches = []
    for j in range(len(cuts) - 1):
        a, b = cuts[j], cuts[j + 1]
        m = (a + b) / 2
        q, ang = at(m, rng.uniform(-0.25, 0.25))
        ring = min(1.0, max(0.45, (m - qg.RING_R + 0.8) / 2.0))
        hgt = rng.uniform(0.4, 0.5) * ring
        f.put(('r0', 'r1', 'r3')[j % 3],
              Ellipsoid((q[0], q[1], -0.02), ((b - a) * 0.56, rng.uniform(1.45, 1.8), hgt),
                        rot(rz=ang + rng.uniform(-0.22, 0.22))), 0.32)
        if j:
            notches.append(a)
    # Faceted and chipped: broad planes and sharp breaks, never smooth.
    f.displace(lambda X, Y, Z: 0.07 * n1.fbm(X * 0.6, Y * 0.6, Z * 0.6, 3)
               + 0.09 * (n1.ridged(X * 1.3, Y * 1.3, Z * 1.6, 2) - 0.5), band=0.6)
    # The groove down its crest the vein runs in, and the cracks across its
    # notches.
    crest = []
    rr = r0 + 0.6
    while rr < r1 - 0.2:
        q, _ = at(rr, 0.05 * math.sin(rr * 1.7))
        crest.append((q[0], q[1], 0.42))
        rr += 0.4
    f.groove(Polyline(crest, [0.05] * len(crest)), 0.09, 0.13)
    for x in notches:
        side = rng.choice((-1.0, 1.0))
        pts = [at(x + rng.uniform(-0.15, 0.15), side * t)[0] for t in (-0.3, 0.2, 0.7, 1.2)]
        f.groove(Polyline([(q[0], q[1], 0.35) for q in pts], [0.05] * len(pts)), 0.1, 0.1)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    R = np.sqrt(X * X + Y * Y)
    # Low enough to walk over; it ends at the rim (the horn goes on) and at
    # the dais's kerb.
    f.cut_above(SPINE + 0.03, 0.06)
    _clamp(f, np.where((R > qg.RIM_R + 0.35) | (R < qg.RING_R - 1.0), 1.0, -1e3))
    f.cut_below(-0.22)
    _mesh_ridge(bpy, p, f, 'HeartRidgeSpine', 5200)
    tree = BVHTree.FromBMesh(p.bm)

    def surf(q):
        hit = tree.ray_cast(Vector((q[0], q[1], 2.0)), Vector((0.0, 0.0, -1.0)), 4.0)
        return None if hit[0] is None else hit[0].z

    # The vein of light in the crest's groove: runs broken by rock, wider
    # here and there (an eye of crystal).
    on = True
    run = []
    rr = r0 + 0.8

    def lay(run):
        if len(run) < 2:
            return
        for q0, q1 in zip(run, run[1:]):
            strip(p, (q0[0], q0[1]), (q1[0], q1[1]), q0[3], q0[2] + 0.012, PALE_HI, slot=GLOW, z1=q1[2] + 0.012)

    while rr < r1 - 0.4:
        if rng.random() < (0.035 if on else 0.55):
            on = not on
            lay(run)
            run = []
        q, _ = at(rr, 0.05 * math.sin(rr * 1.7))
        z = surf(q)
        if on and z is not None:
            run.append((q[0], q[1], z, 0.24 if rng.random() < 0.05 else 0.1 + 0.07 * (0.5 + 0.5 * math.sin(rr * 0.9))))
        rr += 0.3
    lay(run)
    # The light in the notch cracks.
    for x in notches:
        if rng.random() > 0.55:
            continue
        side = rng.choice((-1.0, 1.0))
        pts = []
        for t in (0.0, 0.25, 0.55, 0.85):
            q, _ = at(x + rng.uniform(-0.12, 0.12), side * t)
            z = surf(q)
            if z is not None:
                pts.append((q[0], q[1], z))
        for q0, q1 in zip(pts, pts[1:]):
            strip(p, (q0[0], q0[1]), (q1[0], q1[1]), rng.uniform(0.07, 0.11), q0[2] + 0.012, (0.9, 0.9, 0.9),
                  slot=GLOW, z1=q1[2] + 0.012)
    # Crystal breaking out of a flank here and there.
    rr = r0 + 2.0
    while rr < r1 - 2.0:
        if rng.random() < 0.35:
            q, _ = at(rr, rng.choice((-1.0, 1.0)) * rng.uniform(1.0, 1.5))
            z = surf(q)
            if z is not None and z < SPINE - 0.2:
                with p.as_kind(PAINT):
                    pale_crystal(p, (q[0], q[1], z - 0.06), (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 1.0),
                                 min(0.3, SPINE - z), rng.uniform(0.08, 0.13))
        rr += rng.uniform(2.0, 4.0)
    # Knuckles of the same rock half sunk along its foot, and rubble.
    rr = r0 + 1.0
    while rr < r1 - 1.0:
        side = rng.choice((-1.0, 1.0))
        if rng.random() < 0.45:
            q, _ = at(rr, side * rng.uniform(1.9, 2.4))
            sz = rng.uniform(0.35, 0.7)
            with p.as_kind(RAW):
                crystal(p, (q[0], q[1], 0.0), (sz * 1.5, sz * 1.1, min(0.5, sz * 0.9)),
                        p.vary(RIDGE_TONES[rng.randrange(4)], 0.06), n=12, boxy=0.45, jitter=0.2,
                        yaw=rng.uniform(0, TAU), floor=0.0)
        if rng.random() < 0.4:
            q, _ = at(rr + 0.7, -side * rng.uniform(2.3, 2.7))
            sz = rng.uniform(0.15, 0.3)
            with p.as_kind(RAW):
                crystal(p, (q[0], q[1], 0.0), (sz * 1.4, sz, sz * 0.5), p.vary(RIDGE_TONES[rng.randrange(4)], 0.08),
                        n=9, boxy=0.6, jitter=0.25, yaw=rng.uniform(0, TAU))
        rr += rng.uniform(1.2, 2.4)
    return p


def heart_ridge_horn(bpy):
    """Kit_HeartRidgeHorn: the ridge past the rim, its horn (ridge 0)."""
    p = HSP('Kit_HeartRidgeHorn', seed=6511, ao=0.35, ao_dist=0.8, dust=0.0)
    _ridge_horn(bpy, p, 0)
    return p


def _ridge_horn(bpy, p, k):
    """The ridge rising past the rim into a hooked horn of rock over the
    platform's edge, rooted down the fascia, its vein of crystal running up
    its inner face."""
    b = qg.ridge_deg(k, qg.RIM_R)
    a = math.radians(b)
    ox, oy = math.sin(a), -math.cos(a)  # out (plan)
    sx, sy = math.cos(a), math.sin(a)  # across (plan)

    def at(r, z, s=0.0):
        return (ox * r + sx * s, oy * r + sy * s, z)

    corners = [at(qg.RIM_R - 1.5, -5.0, -3.0), at(qg.RIM_R + 7.5, 10.0, -3.0), at(qg.RIM_R - 1.5, -5.0, 10.0),
               at(qg.RIM_R + 7.5, 10.0, 10.0)]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    lo = (min(xs) - 5.0, min(ys) - 5.0, -5.0)
    hi = (max(xs) + 5.0, max(ys) + 5.0, 10.5)
    f = Sculpt(lo, hi, 0.2)
    n1 = Noise(6511)
    # The spine past the lip: rising off the fascia and curling on along the
    # pinwheel's turn (across, +bearing) into a claw that hooks back over
    # the rim, so from above each ridge's arm runs on past the platform.
    spine = [at(qg.RIM_R + 0.7, -0.5, -0.2), at(qg.RIM_R + 1.9, 1.5, 0.5), at(qg.RIM_R + 3.0, 3.7, 1.7),
             at(qg.RIM_R + 3.7, 5.7, 3.3), at(qg.RIM_R + 3.8, 7.1, 4.9), at(qg.RIM_R + 3.2, 7.9, 6.2),
             at(qg.RIM_R + 2.2, 8.2, 6.9)]
    radii = [1.55, 1.85, 1.75, 1.4, 1.02, 0.66, 0.3]
    f.put('r0', Polyline(spine, radii), 0.55)
    # Its root down the platform's fascia.
    f.put('r2', Polyline([at(qg.RIM_R + 0.9, 0.2, -0.3), at(qg.RIM_R + 1.5, -1.8, -0.2),
                          at(qg.RIM_R + 1.2, -3.8, -0.4)], [1.9, 2.1, 1.4]), 0.8)
    # A lesser spur thrown off its outer flank, and a knuckle at its knee.
    f.put('r1', Polyline([at(qg.RIM_R + 2.9, 3.0, 1.4), at(qg.RIM_R + 4.9, 4.6, 1.0), at(qg.RIM_R + 5.6, 5.4, 0.2)],
                         [0.7, 0.42, 0.16]), 0.45)
    f.put('r3', Polyline([at(qg.RIM_R + 2.1, 1.6, 0.4), at(qg.RIM_R + 2.6, 2.4, -1.0)], [0.75, 0.3]), 0.4)
    f.put('r1', Ellipsoid(at(qg.RIM_R + 1.1, 0.25, 0.0), (2.1, 2.1, 1.1)), 0.7)
    f.displace(lambda X, Y, Z: 0.28 * n1.fbm(X * 0.45, Y * 0.45, Z * 0.3, 3)
               + 0.16 * (n1.ridged(X * 1.1, Y * 1.1, Z * 0.7, 2) - 0.45), band=0.9)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    # Never over the walk: inside the rim it stays under the crest (and it
    # barely reaches in: the walk's own spine meets it there).
    R = np.sqrt(X * X + Y * Y)
    _clamp(f, np.where(R < qg.RIM_R + 0.25, Z - SPINE + 0.04 + (qg.RIM_R + 0.25 - R) * 0.6, -1.0))
    f.cut_below(-4.2)
    _mesh_ridge(bpy, p, f, 'HeartRidgeHorn', 3600, HORN_COLOURS, HORN_KINDS)
    prng = p.rng
    # The vein up its inner face: a seam of small flat shards along the
    # spine (never a row of teeth), a cluster breaking out of the hook and
    # one at the root where it leaves the walk.
    inward = np.array((-ox, -oy, 0.0))
    for j in range(len(spine) - 1):
        q0 = np.asarray(spine[j])
        q1 = np.asarray(spine[j + 1])
        seg = q1 - q0
        L = float(np.linalg.norm(seg))
        n = max(2, int(L / 0.45))
        for m in range(n):
            t = (m + prng.uniform(0.2, 0.8)) / n
            q = q0 + seg * t
            rr = radii[j] + (radii[j + 1] - radii[j]) * t
            up = np.array((0.0, 0.0, 1.0))
            face = inward * 0.9 + up * 0.35
            face = face / np.linalg.norm(face)
            base = q + face * rr * 0.86 + np.array((sx, sy, 0.0)) * prng.uniform(-0.18, 0.18) * rr
            if math.hypot(base[0], base[1]) < qg.RIM_R + 0.2:
                continue
            d = seg / max(1e-6, L) + face * 0.35
            with p.as_kind(PAINT):
                pale_crystal(p, tuple(base - face * 0.08), tuple(d), prng.uniform(0.3, 0.55), prng.uniform(0.09, 0.15),
                             squash=0.45, bright=0.15 * prng.random())
    for (c, cnt, size) in ((spine[-2], 6, 0.9), (spine[2], 4, 0.6)):
        c = np.asarray(c)
        for m in range(cnt):
            ang = prng.uniform(0, TAU)
            d = np.array((math.cos(ang) * 0.6 - ox * 0.5, math.sin(ang) * 0.6 - oy * 0.5, prng.uniform(0.2, 0.9)))
            with p.as_kind(PAINT):
                pale_crystal(p, tuple(c + d * 0.55), tuple(d), prng.uniform(0.6, 1.3) * size,
                             prng.uniform(0.12, 0.22) * size, bright=0.1)


def _mesh_ridge(bpy, p, f, name, target, colours=None, kinds=None):
    import gravewyrm_sculpt as gs
    from gwkit import add_sculpt
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, colours or RIDGE_COLOURS, kinds or RIDGE_KINDS, smooth=False)



# ================================================================ the central circle (phase 2M)
# A raised rim of dark rock round a sunken well of mist and crystal where the
# heart's light lives (the boss's final phase). The well's floor is flat on
# the walk (bodies stand on it); its depth is the runtime's: its glow faces
# carry the mist tag and the shader draws a well under them (interior
# mapping: the rim's rock falling away to a bed of crystal under drifting
# mist). The rim is walkable (no collider), drawn like a seam's spine (after
# the floors, no depth write: a telegraph always shows over it).

WELL_R = 13.4  # the well's edge: the rim's inner foot
RIM_CREST_R = 14.9  # the rim's crest line
RIM_OUT = 16.4  # the rim's outer foot (the quarters' stones start under it)
RIM_CREST = 0.62  # its crest's height on the walk
# A glow face painted with its red and blue well over its green is the
# well's mist (the runtime draws the well under it).
MIST_TAG = (0.86, 0.4, 0.86)
RIM_COLOURS = {'r0': (0.21, 0.2, 0.23), 'r1': (0.25, 0.23, 0.26), 'r2': (0.17, 0.16, 0.19), 'r3': (0.23, 0.21, 0.24)}
RIM_KINDS = {k: DRESSED for k in RIM_COLOURS}


def heart_dais(bpy):
    """Kit_HeartDais (phase 2M): the central circle (see above)."""
    from mathutils.bvhtree import BVHTree

    p = HSP('Kit_HeartDais', seed=6601, ao=0.3, ao_dist=0.7, dust=0.0)
    rng = p.rng
    n1 = Noise(6603)
    R = RIM_OUT + 1.0
    f = Sculpt((-R, -R, -0.5), (R, R, 1.1), 0.13)
    # The rim's broad back, a closed ring.
    back = []
    radii = []
    m = 72
    for k in range(m + 1):
        b = 360.0 * k / m
        q = qg.bp(RIM_CREST_R, b)
        back.append((q[0], q[1], -2.55))
        radii.append(3.0 + 0.1 * math.sin(math.radians(b) * 5.0 + 1.0))
    f.put('r2', Polyline(back, radii), 0.3)
    # Its blocks: a fused ring of faceted rock, each its own length and set,
    # a notch between each and the next.
    cuts = [0.0]
    while cuts[-1] < 360.0 - 6.0:
        cuts.append(cuts[-1] + math.degrees(rng.uniform(1.8, 3.0) / RIM_CREST_R))
    cuts[-1] = 360.0
    notches = []
    for j in range(len(cuts) - 1):
        a, b = cuts[j], cuts[j + 1]
        mid = (a + b) / 2
        q = qg.bp(RIM_CREST_R + rng.uniform(-0.2, 0.2), mid)
        L = math.radians(b - a) * RIM_CREST_R
        ang = math.radians(mid)
        tang = math.atan2(math.sin(ang), math.cos(ang))  # the ring's tangent in plan (bp's frame)
        f.put(('r0', 'r1', 'r3')[j % 3],
              Ellipsoid((q[0], q[1], -0.02), (L * 0.58, rng.uniform(1.4, 1.7), rng.uniform(0.5, 0.6)),
                        rot(rz=tang + rng.uniform(-0.15, 0.15))), 0.32)
        notches.append(a)
    # Spurs of the same rock thrown out over the floor where it bursts
    # (eight, between the seams), and the seams' roots.
    for k in range(4):
        for off in (-22.0, 22.0):
            b = qg.wind(qg.sector(k)[0] + 45.0 + off, qg.RING_R)
            q0 = qg.bp(RIM_OUT - 0.6, b)
            q1 = qg.bp(RIM_OUT + 0.9, b + rng.uniform(-4.0, 4.0))
            f.put('r1', Polyline([(q0[0], q0[1], -0.1), (q1[0], q1[1], -0.3)], [0.75, 0.25]), 0.35)
    f.displace(lambda X, Y, Z: 0.07 * n1.fbm(X * 0.6, Y * 0.6, Z * 0.6, 3)
               + 0.1 * (n1.ridged(X * 1.3, Y * 1.3, Z * 1.6, 2) - 0.5), band=0.6)
    # The groove round its crest, and the cracks across its notches.
    crest = []
    for k in range(181):
        b = 2.0 * k
        q = qg.bp(RIM_CREST_R + 0.05 * math.sin(math.radians(b) * 9.0), b)
        crest.append((q[0], q[1], 0.52))
    f.groove(Polyline(crest, [0.05] * len(crest)), 0.1, 0.14)
    for a in notches:
        side = rng.choice((-1.0, 1.0))
        pts = [(*qg.bp(RIM_CREST_R + side * t, a + rng.uniform(-0.6, 0.6)), 0.4) for t in (-0.4, 0.2, 0.8, 1.4)]
        f.groove(Polyline(pts, [0.05] * len(pts)), 0.1, 0.1)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Rr = np.sqrt(X * X + Y * Y)
    f.cut_above(RIM_CREST + 0.03, 0.06)
    # Its inner face drops to the well's edge; nothing of it inside the well.
    _clamp(f, np.where(Rr < WELL_R - 0.05, 1.0, -1e3))
    f.cut_below(-0.22)
    _mesh_ridge(bpy, p, f, 'HeartDaisRim', 7000, RIM_COLOURS, RIM_KINDS)
    tree = BVHTree.FromBMesh(p.bm)

    def surf(q):
        hit = tree.ray_cast(Vector((q[0], q[1], 2.0)), Vector((0.0, 0.0, -1.0)), 4.0)
        return None if hit[0] is None else hit[0].z

    # The light in its crest's groove (broken by rock) and in its notches:
    # the runtime colours each side with the quarter it opens onto.
    run = []
    on = True

    def lay(run):
        for q0, q1 in zip(run, run[1:]):
            strip(p, (q0[0], q0[1]), (q1[0], q1[1]), q0[3], q0[2] + 0.012, PALE_HI, slot=GLOW, z1=q1[2] + 0.012)

    b = 0.0
    while b < 360.0:
        if rng.random() < (0.03 if on else 0.55):
            on = not on
            lay(run)
            run = []
        q = qg.bp(RIM_CREST_R + 0.05 * math.sin(math.radians(b) * 9.0), b)
        z = surf(q)
        if on and z is not None:
            run.append((q[0], q[1], z, 0.09 + 0.06 * (0.5 + 0.5 * math.sin(math.radians(b) * 7.0))))
        b += math.degrees(0.3 / RIM_CREST_R)
    lay(run)
    for a in notches:
        if rng.random() > 0.6:
            continue
        side = rng.choice((-1.0, 1.0))
        pts = []
        for t in (0.0, 0.3, 0.65, 1.0, 1.35):
            q = qg.bp(RIM_CREST_R + side * t, a + rng.uniform(-0.4, 0.4))
            z = surf(q)
            if z is not None:
                pts.append((q[0], q[1], z))
        for q0, q1 in zip(pts, pts[1:]):
            strip(p, (q0[0], q0[1]), (q1[0], q1[1]), rng.uniform(0.07, 0.12), q0[2] + 0.012, (0.9, 0.9, 0.9),
                  slot=GLOW, z1=q1[2] + 0.012)
    # Crystal breaking out of its inner face over the well, leaning in.
    for k in range(40):
        b = 9.0 * k + rng.uniform(-3.0, 3.0)
        q = qg.bp(WELL_R + rng.uniform(0.15, 0.5), b)
        z = surf(q)
        if z is None:
            continue
        inward = qg.bp(1.0, b)
        d = (-inward[0] * 0.8, -inward[1] * 0.8, rng.uniform(0.2, 0.7))
        with p.as_kind(PAINT):
            pale_crystal(p, (q[0], q[1], max(0.0, z - 0.15)), d, rng.uniform(0.35, 0.7), rng.uniform(0.08, 0.15),
                         squash=0.8, bright=0.1 * rng.random())
    return p


def heart_well(bpy):
    """Kit_HeartWell (phase 2M): the well's floor (see above)."""
    p = HSP('Kit_HeartWell', seed=6611, ao=0.0, ao_dist=0.1, dust=0.0)
    _well_floor(p)
    return p


def _well_floor(p):
    """The well's floor on the walk: a dense disc of glow faces painted with
    the mist tag (the runtime draws the well under it)."""
    bm = p.bm
    rings = []
    r = 0.0
    radii = [0.0]
    while radii[-1] < WELL_R - 0.05:
        radii.append(min(WELL_R + 0.25, radii[-1] + 0.7))
    rows = []
    for r in radii:
        if r <= 0.0:
            rows.append([bm.verts.new((0.0, 0.0, 0.006))])
            continue
        m = max(8, int(math.ceil(TAU * r / 0.7)))
        rows.append([bm.verts.new((*qg.bp(r, 360.0 * k / m), 0.006)) for k in range(m)])
    faces = []
    for a in range(len(rows) - 1):
        A, B = rows[a], rows[a + 1]
        na, nb = len(A), len(B)
        i = j = 0
        while i < na or j < nb:
            ua = (i + 1) / na
            ub = (j + 1) / nb
            if i < na and (j >= nb or ua <= ub):
                tri = (A[i % na], B[j % nb], A[(i + 1) % na])
                i += 1
            else:
                tri = (A[i % na], B[j % nb], B[(j + 1) % nb])
                j += 1
            if tri[0] is tri[1] or tri[1] is tri[2] or tri[0] is tri[2]:
                continue
            try:
                faces.append(bm.faces.new(tri))
            except ValueError:
                pass
    p._paint(faces, MIST_TAG, GLOW)
    for f in faces:
        for loop in f.loops:
            loop[p.col] = (*MIST_TAG, 1.0)
    p.facing(faces, (0, 0, 1))
    del rings


__all__ = ['quarter_hammer', 'quarter_breath', 'quarter_quench', 'quarter_heat', 'quarter_floor', 'heart_ridge',
           'heart_ridge_horn', 'heart_dais', 'heart_well', 'joint_bed', 'clip_to_quarter', 'quarter_fields']
