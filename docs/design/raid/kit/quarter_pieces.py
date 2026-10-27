"""The Anvil of the World's four quarters (phases 2K and 2L,
build_smith_heart_heart_kit.py): the platform's walk as four elemental quarters
set in a pinwheel round a central ring (the numbers: quarter_geom.py, the
sim's smith_heart_quarters.ts).

Phase 2L repainted every quarter as hand-painted sculpted stone (the style
guide's language, never a tile grid): large irregular slabs, each its own
dense painted top (colour drifting inside the stone, brush strokes along its
form, painted light, a worn pale lip and dirt toward its joints) over a worn
bevel, dark dirty joints, broken and missing pieces, and each element's
detail living IN the stone:

  - Kit_QuarterHammer: big hammer-dressed blocks of ochre and sand granite
    laid in a random ashlar (cut by hand, never in courses), chipped
    corners, bands of the mason's tool grooves, and tremor cracks running
    out through the blocks (the quarter's light leaks up them).
  - Kit_QuarterBreath: the wind-scoured storm stone (violet and teal slate,
    mid-dark) in long flags drawn out along the pinwheel's spiral, their
    edges eroded round, pale scour streaks painted along the wind, and long
    scorings carved along the spiral (the wind's lines, lit when it wakes).
  - Kit_QuarterQuench: pale frost stone in irregular slabs, rime on their
    edges, sheets of ice glazed over them across the joints (deep dark ice
    asleep, lit from inside when the quarter wakes), frost veins branching
    across it.
  - Kit_QuarterHeat: dark cooled basalt crust in great plates, split by a
    network of molten fissures (the red-orange of the Heat guardian's
    hearth, never gold): a bed of fire under each fissure, its lips
    glowing, scorched rims, ash on the plates, a few plates cracking open.
  - Kit_HeartRidge: one ridge's spine on the walk (ridge 0; the runtime
    turns it a quarter for each of the other three): a sculpted spine of
    dark rock in faceted vertebrae, its crest notched and chipped, cracks
    across and down it with the vein's light inside them, knuckles of the
    same rock half sunk along its flanks. Low enough to walk over (no
    collider; the runtime draws it so a floor telegraph always shows over
    it).
  - Kit_HeartRidgeHorn: the ridge rising past the rim into its hooked horn
    of rock over the platform's edge.
  - Kit_HeartDais: the central ring: the basalt hub, a rosette of the
    heart's crystal, rays of crystal toward the four quarters and the four
    ridges, the rune band, and a low carved kerb with a crystal channel.

The arrival's sockets (quarter_geom.SOCKETS): where the heart tears the
colossus's rock pieces out, each quarter's paving is broken round a pit
(broken slab edges, fragments tipped into it, rubble at its bottom, a faint
crack of its vein's light), carved into the piece of the quarter it lies in.
The joint dirt under the slabs is Kit_AnvilFloor's (`joint_bed`, each
quarter its own dirt, holed under every socket).

The glow slot (the cracks, scorings, veins, fissures, the Quench's ice) is a
pale grey the runtime tints with the quarter's colour and wakes
(src/render/smith_heart/heart_quarters.ts); a glow face painted blue (its
blue well over its red) is the Quench's ice, which the runtime draws as ice.
Frames: every piece at the platform's centre on its walk (Blender -Y the
game's north), placed unturned (the ridge turned per ridge). Walk rule: on
the walk (r < 42) the quarters' stones stay a breath over it (every top
under 0.056) and the ridge's spine and the dais's kerb at most 0.6 and 0.25;
the horns stand past the lip. Deterministic: every draw is the piece's own
seeded rng or a seeded noise.
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

# ---- tones (sRGB). The four quarters read apart in value, not hue alone:
# the Quench palest, the Hammer mid-light, the Breath mid-dark, the Heat dark.
HAMMER_TONES = ((0.68, 0.57, 0.41), (0.63, 0.53, 0.38), (0.72, 0.62, 0.46), (0.6, 0.5, 0.37), (0.66, 0.58, 0.45),
                (0.58, 0.53, 0.46))
HAMMER_WARM = (0.74, 0.55, 0.33)
HAMMER_COOL = (0.57, 0.54, 0.5)
BREATH_TONES = ((0.42, 0.4, 0.53), (0.38, 0.38, 0.49), (0.35, 0.4, 0.47), (0.46, 0.44, 0.56), (0.32, 0.32, 0.42),
                (0.4, 0.42, 0.5))
BREATH_TEAL = (0.32, 0.45, 0.48)
BREATH_VIOLET = (0.45, 0.38, 0.56)
BREATH_SCOUR = (0.64, 0.64, 0.72)
QUENCH_TONES = ((0.7, 0.75, 0.81), (0.64, 0.7, 0.77), (0.76, 0.8, 0.85), (0.6, 0.66, 0.74), (0.68, 0.72, 0.79))
QUENCH_COLD = (0.5, 0.6, 0.76)
RIME = (0.9, 0.93, 0.97)
HEAT_TONES = ((0.2, 0.18, 0.17), (0.17, 0.155, 0.15), (0.23, 0.2, 0.185), (0.15, 0.14, 0.14), (0.19, 0.175, 0.175))
HEAT_ASH = (0.42, 0.4, 0.38)
HEAT_SCORCH = (0.38, 0.13, 0.05)
RIDGE_TONES = ((0.33, 0.31, 0.33), (0.37, 0.35, 0.36), (0.29, 0.28, 0.31), (0.35, 0.32, 0.33))
RIDGE_COLOURS = {'r0': (0.3, 0.28, 0.3), 'r1': (0.34, 0.31, 0.32), 'r2': (0.23, 0.22, 0.25), 'r3': (0.28, 0.27, 0.3)}
RIDGE_KINDS = {k: DRESSED for k in RIDGE_COLOURS}
HORN_COLOURS = {'r0': (0.27, 0.26, 0.29), 'r1': (0.31, 0.3, 0.32), 'r2': (0.23, 0.22, 0.25), 'r3': (0.29, 0.28, 0.31)}
HORN_KINDS = {k: RAW for k in HORN_COLOURS}
# The joints' dirt per quarter (Kit_AnvilFloor's bed): always darker than its
# stones, so the paving reads as stone set in dirt, never a lit grid.
JOINT_DIRT = {'hammer': (0.3, 0.23, 0.15), 'breath': (0.2, 0.2, 0.26), 'quench': (0.38, 0.44, 0.52),
              'heat': (0.07, 0.06, 0.06)}
RING_DIRT = (0.11, 0.1, 0.11)

TOP_LO = 0.012
TOP_HI = 0.03
SKIN = 0.042  # a mark laid on the tops (grooves, scorings, veins), over every top
ICE_TOP = 0.05
WALK_TOP = 0.056  # nothing on a quarter rises past this on the walk
CREST = 0.24  # the dais's kerb's highest point on the walk
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


def clip_to_quarter(pts, fields, centre=None):
    poly = _densify(pts)
    for f in fields:
        poly = _clip(poly, f)
        if len(poly) < 3:
            return []
    poly = _simplify(poly)
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


def _poisson(rng, i, spacing, margin=10.0, var=(0.72, 1.25)):
    """Irregular seeds over quarter i (and a margin round it): darts thrown
    at random, each keeping its own clearance (so the stones come in every
    size, never a lattice)."""
    s0, s1 = qg.sector(i)
    cell = spacing * 0.7
    grid = {}
    out = []
    clear = []
    area = math.radians(s1 - s0 + 2 * margin) * 0.5 * ((qg.RIM_R + 3) ** 2 - (qg.RING_R - 3) ** 2)
    want = int(area / (spacing * spacing * 0.78))
    for _ in range(want * 30):
        if len(out) >= want:
            break
        r = math.sqrt(rng.uniform((qg.RING_R - 3) ** 2, (qg.RIM_R + 3) ** 2))
        phi = rng.uniform(s0 - margin, s1 + margin)
        q = qg.bp(r, qg.wind(phi, r))
        c = spacing * rng.uniform(*var)
        gx, gy = int(math.floor(q[0] / cell)), int(math.floor(q[1] / cell))
        ok = True
        reach = int(math.ceil(spacing * var[1] / cell)) + 1
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
    """The dirt the quarters' slabs are set in (only seen in their joints): a
    polar sheet over the whole walk, each quarter its own dirt (blended
    across its ridges), the ring's dark grit in the middle, a hole under
    every socket (its pit and apron carry their own)."""
    bm = p.bm
    socks = all_sockets()
    n1 = Noise(7001)
    radii = [0.0, 1.6]
    while radii[-1] < qg.RIM_R + 0.05:
        radii.append(min(qg.RIM_R + 0.08, radii[-1] + 1.55))
    rows = []
    for r in radii:
        m = max(8, int(math.ceil(TAU * max(r, 0.5) / 1.7)))
        rows.append([(r, 360.0 * k / m) for k in range(m)])

    def dirt(x, y):
        r, b = qg.polar_of(x, y)
        if r < qg.RING_R - 0.6:
            c = np.asarray(RING_DIRT)
        else:
            phi = qg.unwind(b, r)
            u = ((phi - (-45.0 + qg.RIM_OFFSET)) % 360.0) / 90.0
            i = int(u) % 4
            f = u - int(u)
            here = np.asarray(JOINT_DIRT[qg.ORDER[i]])
            # Blend toward the neighbour across the ridge (its spine covers
            # the seam).
            arc = math.radians(90.0) * r
            if f * arc < 2.0:
                nb = np.asarray(JOINT_DIRT[qg.ORDER[(i - 1) % 4]])
                here = here + (nb - here) * 0.5 * (1.0 - f * arc / 2.0)
            elif (1.0 - f) * arc < 2.0:
                nb = np.asarray(JOINT_DIRT[qg.ORDER[(i + 1) % 4]])
                here = here + (nb - here) * 0.5 * (1.0 - (1.0 - f) * arc / 2.0)
            c = here
        k = 0.85 + 0.3 * float(n1.fbm(x * 0.2, y * 0.2, 0.4, 2))
        return tuple(float(v) for v in np.clip(c * k, 0.0, 1.0))

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


# ================================================================ the Hammer
def _bsp_blocks(rng, out, across, lo, hi, min_side=1.7, max_side=5.6):
    """Random ashlar: the quarter's frame cut again and again by hand-skewed
    lines into convex blocks of every size (never courses, never a grid)."""
    def P(u, v):
        return (out[0] * u + across[0] * v, out[1] * u + across[1] * v)

    stack = [[(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])]]
    blocks = []
    while stack:
        q = stack.pop()
        a, b, c, d = q
        wu = math.hypot(b[0] - a[0], b[1] - a[1])
        wv = math.hypot(d[0] - a[0], d[1] - a[1])
        big = max(wu, wv)
        mx = (a[0] + c[0]) / 2
        my = (a[1] + c[1]) / 2
        rr = math.hypot(out[0] * mx + across[0] * my, out[1] * mx + across[1] * my)
        cap = min(max_side, 2.6 + 0.16 * max(0.0, rr - qg.RING_R))
        if big <= cap and (big < 2.1 * min_side or rng.random() < 0.3 + 0.4 * (1.0 - big / cap)):
            blocks.append([P(*a), P(*b), P(*c), P(*d)])
            continue
        t = rng.uniform(0.33, 0.67)
        sk = rng.uniform(-0.07, 0.07)
        if wu >= wv:
            e = (a[0] + (b[0] - a[0]) * (t + sk), a[1] + (b[1] - a[1]) * (t + sk))
            f = (d[0] + (c[0] - d[0]) * (t - sk), d[1] + (c[1] - d[1]) * (t - sk))
            stack.append([a, e, f, d])
            stack.append([e, b, c, f])
        else:
            e = (a[0] + (d[0] - a[0]) * (t + sk), a[1] + (d[1] - a[1]) * (t + sk))
            f = (b[0] + (c[0] - b[0]) * (t - sk), b[1] + (c[1] - b[1]) * (t - sk))
            stack.append([a, b, f, e])
            stack.append([e, f, c, d])
    return blocks


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


def _hammer_marks(p, rng, outline, z_at, tone):
    """The mason's hammer on one block: a band of parallel tool grooves."""
    xs = [q[0] for q in outline]
    ys = [q[1] for q in outline]
    cx, cy = _centroid(outline)
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span < 1.6:
        return
    inner = _inset(outline, 0.32)
    if abs(_area(inner)) < 0.5:
        return
    groove = tuple(min(1.0, c * 0.74) for c in tone)
    ang = rng.uniform(0, math.pi)
    ux, uy = math.cos(ang), math.sin(ang)
    vx, vy = -uy, ux
    n = rng.randrange(4, 9)
    pitch = rng.uniform(0.2, 0.3)
    off = rng.uniform(-0.5, 0.5)
    for k in range(n):
        o = off + (k - n / 2) * pitch
        a = (cx + vx * o - ux * span, cy + vy * o - uy * span)
        b = (cx + vx * o + ux * span, cy + vy * o + uy * span)
        seg = _clip_segment(inner, a, b)
        if not seg:
            continue
        (a2, b2) = seg
        z = min(WALK_TOP - 0.002, max(z_at(*a2), z_at(*b2)) + 0.012)
        strip(p, a2, b2, rng.uniform(0.04, 0.06), z, p.vary(groove, 0.05))


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


def _crack_net(rng, i, fields, socks, mains, step=(0.5, 1.0), turn=0.42, branch=0.22, start_r=(0.6, 5.0)):
    """A network of cracks running out from the ring through quarter i:
    `mains` lines wandering outward, each throwing a few branches."""
    s0, s1 = qg.sector(i)
    lines = []

    def ok(q):
        return inside_quarter(q, fields) and not any(s.contains(q, 0.2) for s in socks)

    for k in range(mains):
        phi = s0 + 10.0 + (s1 - s0 - 20.0) * (k + rng.uniform(0.15, 0.85)) / mains
        r = qg.RING_R + rng.uniform(*start_r)
        start = qg.bp(r, qg.wind(phi, r))
        if not ok(start):
            continue
        # Outward along the spiral, then wandering.
        a = qg.bp(r + 1.0, qg.wind(phi, r + 1.0))
        ang = math.atan2(a[1] - start[1], a[0] - start[0])
        line = [start]
        q = start
        for _ in range(80):
            rr = math.hypot(*q)
            b = qg.bp(rr + 1.0, qg.wind(phi, rr + 1.0))
            c = qg.bp(rr, qg.wind(phi, rr))
            want = math.atan2(b[1] - c[1], b[0] - c[0])
            d = (want - ang + math.pi) % TAU - math.pi
            ang += 0.35 * d + rng.uniform(-turn, turn)
            L = rng.uniform(*step)
            nq = None
            for dev in (0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5):
                a2 = ang + dev
                cand = (q[0] + math.cos(a2) * L, q[1] + math.sin(a2) * L)
                if ok(cand) and math.hypot(*cand) > math.hypot(*q) - 0.2:
                    nq = cand
                    ang = a2
                    break
            if nq is None:
                break
            line.append(nq)
            q = nq
            if math.hypot(*q) > qg.RIM_R - 1.0:
                break
        if len(line) > 3:
            lines.append(line)
            for j in range(2, len(line) - 2):
                if rng.random() < branch:
                    br, _ = _wander(rng, line[j], ang + rng.choice((-1, 1)) * rng.uniform(0.6, 1.2),
                                    rng.randrange(3, 9), (0.4, 0.8), 0.5, keep=ok)
                    if len(br) > 2:
                        lines.append(br)
    return lines


def quarter_hammer(bpy):
    """Kit_QuarterHammer (see the module doc)."""
    i = qg.ORDER.index('hammer')
    p = HSP('Kit_QuarterHammer', seed=6101, ao=0.12, ao_dist=0.35, dust=0.0)
    rng = p.rng
    fields = _walk_fields(i)
    socks = sockets_in(i)

    def extra(X, Y, D, s, col):
        # Pale dust settled in the hammer-dressed hollows, a rusty iron bloom
        # now and then (the granite's own warmth).
        n = paint.n
        dust = np.clip(n.fbm(X * 0.5 + 9.0, Y * 0.5, 2.2, 2) * 1.6 - 0.25, 0.0, 1.0)
        col = _mixc(col, (0.78, 0.7, 0.56), dust * 0.22)
        bloom = np.clip(n.fbm(X * 0.15 - 4.0, Y * 0.15 + 2.0, 6.0, 2) * 2.2 - 0.55, 0.0, 1.0)
        return _mixc(col, (0.62, 0.4, 0.24), bloom * 0.3)

    paint = Painter(6103, HAMMER_WARM, HAMMER_COOL, hue=0.32, extra=extra)
    _, out, across = _frame(i)
    nw = Noise(6109)
    blocks = _bsp_blocks(rng, out, across, (-qg.RIM_R - 3.0, -qg.RIM_R - 3.0), (qg.RIM_R + 3.0, qg.RIM_R + 3.0))
    for blk in blocks:
        blk = _ccw(blk)
        bx, by = _centroid(blk)
        if math.hypot(bx, by) > qg.RIM_R + 6 or qg.quarter_of(bx, by) not in (i, -1, (i + 1) % 4, (i - 1) % 4):
            continue
        if not any(qg.quarter_of(*q) == i for q in blk + [(bx, by)]):
            if math.hypot(bx, by) > qg.RING_R + 6:
                continue
        blk = _ccw(_warp(_densify(blk, 0.6), nw, 0.16, 0.22))
        blk = _simplify(blk, 0.015)
        if rng.random() < 0.5:
            blk = _chip_corners(rng, blk, 0.12)
        j = rng.uniform(0.025, 0.05)
        blk = _inset(blk, j)
        outline = clip_to_quarter(blk, fields, i)
        if not outline:
            continue
        for piece in _cut_round_sockets(outline, socks):
            r = rng.random()
            if r < 0.04 and abs(_area(piece)) < 3.5:
                _rubble(p, rng, piece, HAMMER_TONES, 9)
                continue
            parts = _split_broken(rng, piece) if r < 0.11 else [piece]
            for part in parts:
                tone = p.vary(HAMMER_TONES[rng.randrange(len(HAMMER_TONES))], 0.05)
                info = SlabInfo(tone, part, rng.random())
                top = rng.uniform(TOP_LO, TOP_HI)
                tilt = (rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004))
                if len(parts) > 1:
                    tilt = (rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012))
                z_at = painted_slab(p, part, top, info, paint, bevel=rng.uniform(0.07, 0.12), tilt=tilt,
                                    crown=0.008)
                if z_at and rng.random() < 0.55:
                    _hammer_marks(p, rng, part, z_at, tuple(info.tone))
    # Tremor cracks out from the ring through the blocks: a dark scar with
    # the quarter's light leaking up its middle.
    for line in _crack_net(rng, i, fields, socks, 5, step=(1.0, 2.2), turn=0.3, branch=0.1,
                           start_r=(0.4, 14.0)):
        ribbon(p, line, 0.3, SKIN - 0.004, (0.24, 0.17, 0.1), slot=0, edge=(0.42, 0.33, 0.22))
        ribbon(p, line, 0.13, SKIN, (0.95, 0.95, 0.95), edge=(0.5, 0.5, 0.5))
    for s in socks:
        frags = socket_pit(p, s, (0.52, 0.44, 0.32), JOINT_DIRT['hammer'], (0.82, 0.74, 0.6))
        lay_fragments(p, frags, s, HAMMER_TONES, paint, (0.82, 0.74, 0.6))
    return p


# ================================================================ the Breath
def quarter_breath(bpy):
    """Kit_QuarterBreath (see the module doc)."""
    i = qg.ORDER.index('breath')
    p = HSP('Kit_QuarterBreath', seed=6201, ao=0.12, ao_dist=0.35, dust=0.0)
    rng = p.rng
    fields = _walk_fields(i)
    socks = sockets_in(i)
    s0, s1 = qg.sector(i)
    STRETCH = 1.55  # the flags drawn out along the wind's spiral

    def extra(X, Y, D, s, col):
        # Pale scour streaks drawn along the spiral (the wind's own strokes),
        # teal and violet drifting through the slate.
        n = paint.n
        R = np.hypot(X, Y)
        B = np.degrees(np.arctan2(X, -Y))
        phi = B + qg.SWEEP * np.clip(1.0 - (R - qg.RING_R) / (qg.RIM_R - qg.RING_R), 0.0, 1.0) ** qg.POWER
        w = np.radians(phi) * R
        streak = np.clip(n.fbm(R * 0.16 + 3.0, w * 1.15, 4.4, 3) * 2.4 - 0.35, 0.0, 1.0)
        col = _mixc(col, BREATH_SCOUR, streak * 0.38)
        tv = np.clip(0.5 + 1.4 * n.fbm(X * 0.07, Y * 0.07, 9.0, 2), 0.0, 1.0)
        col = _mixc(col, BREATH_TEAL, (1.0 - tv) * 0.22)
        return _mixc(col, BREATH_VIOLET, tv * 0.18)

    paint = Painter(6203, (0.46, 0.42, 0.56), (0.34, 0.4, 0.46), hue=0.3, lip=0.28, lip_w=0.2, extra=extra)
    # Seeds in the spiral's own frame (u: radius over STRETCH, w: arc length
    # at the unwound bearing), darts thrown at random each with its own
    # clearance: isotropic cells there are irregular flags drawn out along
    # the wind here.
    seeds = []
    clear = []
    for _ in range(9000):
        if len(seeds) >= 230:
            break
        rr = math.sqrt(rng.uniform((qg.RING_R - 2.5) ** 2, (qg.RIM_R + 3.5) ** 2))
        phi = rng.uniform(s0 - 14.0, s1 + 14.0)
        q = (rr / STRETCH, math.radians(phi) * rr)
        c = rng.uniform(2.2, 3.4)
        if all(math.hypot(q[0] - o[0], q[1] - o[1]) > 0.5 * (c + co) for o, co in zip(seeds, clear)):
            seeds.append(q)
            clear.append(c)
    seeds, cells = _relaxed(seeds, (-1e3, -1e3, 1e3, 1e3), reach=4.5, rounds=1)
    nw = Noise(6209)

    def to_plan(q):
        rr = max(0.5, q[0] * STRETCH)
        phi = math.degrees(q[1] / rr)
        return qg.bp(rr, qg.wind(phi, rr))

    for cell in cells:
        if not cell:
            continue
        plan = _ccw(_warp([to_plan(q) for q in _densify(cell, 0.22)], nw, 0.14, 0.3))
        plan = _simplify(plan, 0.02)
        if len(plan) < 3:
            continue
        plan = _inset(plan, rng.uniform(0.03, 0.055))
        outline = clip_to_quarter(plan, fields, i)
        if not outline:
            continue
        for piece in _cut_round_sockets(outline, socks):
            rr = rng.random()
            if rr < 0.025 and abs(_area(piece)) < 3.5:
                _rubble(p, rng, piece, BREATH_TONES)
                continue
            parts = _split_broken(rng, piece) if rr < 0.08 else [piece]
            for part in parts:
                tone = p.vary(BREATH_TONES[rng.randrange(len(BREATH_TONES))], 0.05)
                info = SlabInfo(tone, part, rng.random())
                tilt = (rng.uniform(-0.005, 0.005), rng.uniform(-0.005, 0.005))
                painted_slab(p, part, rng.uniform(TOP_LO, TOP_HI), info, paint, bevel=rng.uniform(0.1, 0.15),
                             tilt=tilt, crown=0.01, lip_k=1.24)
    # The wind's scorings: long grooves carved along the spiral, broken here
    # and there, the quarter's light in their bottoms.
    for k in range(15):
        phi0 = rng.uniform(s0 + 4.0, s1 - 4.0)
        kappa = rng.uniform(-0.5, 0.5)
        ra = rng.uniform(qg.RING_R + 1.0, qg.RIM_R - 16.0)
        rb = min(qg.RIM_R - 0.8, ra + rng.uniform(9.0, 22.0))
        line = []
        rr = ra
        while rr < rb:
            q = qg.bp(rr, qg.wind(phi0 + kappa * (rr - ra), rr))
            q = (q[0] + rng.uniform(-0.05, 0.05), q[1] + rng.uniform(-0.05, 0.05))
            if inside_quarter(q, fields) and not any(s.contains(q, 0.2) for s in socks):
                line.append(q)
            else:
                if len(line) > 3:
                    break
                line = []
            rr += 0.6
            if len(line) > 4 and rng.random() < 0.05:
                break
        if len(line) > 3:
            ribbon(p, line, 0.38, SKIN - 0.004, (0.18, 0.18, 0.24), slot=0, edge=(0.3, 0.3, 0.38))
            ribbon(p, line, 0.1, SKIN, (0.9, 0.9, 0.9), edge=(0.45, 0.45, 0.45))
    for s in socks:
        frags = socket_pit(p, s, (0.34, 0.33, 0.42), JOINT_DIRT['breath'], (0.6, 0.6, 0.68))
        lay_fragments(p, frags, s, BREATH_TONES, paint, (0.6, 0.6, 0.68))
    return p


# ================================================================ the Quench
def _blob(rng, c, rx, ry, rot, n1, m=36):
    """A pool's outline: a lumpy ellipse."""
    out = []
    for k in range(m):
        a = TAU * k / m
        w = 1.0 + 0.22 * float(n1.fbm(math.cos(a) * 1.4 + c[0], math.sin(a) * 1.4 + c[1], 0.3, 3))
        x = math.cos(a) * rx * w
        y = math.sin(a) * ry * w
        out.append((c[0] + x * math.cos(rot) - y * math.sin(rot), c[1] + x * math.sin(rot) + y * math.cos(rot)))
    return out


def quarter_quench(bpy):
    """Kit_QuarterQuench (see the module doc)."""
    i = qg.ORDER.index('quench')
    p = HSP('Kit_QuarterQuench', seed=6301, ao=0.12, ao_dist=0.35, dust=0.0)
    rng = p.rng
    fields = _walk_fields(i)
    socks = sockets_in(i)

    def extra(X, Y, D, s, col):
        # Rime caught along the edges and in drifts, cold blue in the stone.
        n = paint.n
        rime = _smooth(0.42, 0.04, D) * np.clip(0.4 + 1.2 * n.fbm(X * 0.9 + 2.0, Y * 0.9, 1.1, 2), 0.0, 1.0)
        drift = np.clip(n.fbm(X * 0.18 + 7.0, Y * 0.18, 3.3, 3) * 2.0 - 0.3, 0.0, 1.0)
        col = _mixc(col, RIME, np.clip(rime * 0.7 + drift * 0.35, 0.0, 0.85))
        cold = np.clip(0.5 + 1.2 * n.fbm(X * 0.11 - 6.0, Y * 0.11, 5.0, 2), 0.0, 1.0)
        return _mixc(col, QUENCH_COLD, cold * 0.2)

    paint = Painter(6303, (0.74, 0.77, 0.8), (0.58, 0.66, 0.78), drift=0.12, hue=0.3, stroke=0.06, light=0.1,
                    lip=0.12, grime=0.2, extra=extra)
    seeds = _poisson(rng, i, 2.7)
    seeds, cells = _relaxed(seeds, (-46.0, -46.0, 46.0, 46.0), reach=4.5, rounds=1)
    nw = Noise(6309)
    for cell in cells:
        if not cell:
            continue
        cell = _simplify(_ccw(_warp(_densify(_ccw(cell), 0.5), nw, 0.14, 0.3)), 0.015)
        cell = _inset(cell, rng.uniform(0.03, 0.055))
        outline = clip_to_quarter(cell, fields, i)
        if not outline:
            continue
        for piece in _cut_round_sockets(outline, socks):
            rr = rng.random()
            if rr < 0.025 and abs(_area(piece)) < 3.5:
                _rubble(p, rng, piece, QUENCH_TONES)
                continue
            parts = _split_broken(rng, piece) if rr < 0.08 else [piece]
            for part in parts:
                tone = p.vary(QUENCH_TONES[rng.randrange(len(QUENCH_TONES))], 0.04)
                info = SlabInfo(tone, part, rng.random())
                tilt = (rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004))
                painted_slab(p, part, rng.uniform(TOP_LO, TOP_HI - 0.004), info, paint,
                             bevel=rng.uniform(0.08, 0.12), tilt=tilt)
    # Sheets of ice glazed over the stones across their joints: the glow
    # slot painted blue (the runtime's ice: deep and dark asleep, lit from
    # inside when the quarter wakes), their rims frosted paler.
    n1 = Noise(6307)
    s0, s1 = qg.sector(i)
    placed = []
    tries = 0
    while len(placed) < 6 and tries < 400:
        tries += 1
        r = rng.uniform(qg.RING_R + 4.0, qg.RIM_R - 4.0)
        phi = rng.uniform(s0 + 8.0, s1 - 8.0)
        c = qg.bp(r, qg.wind(phi, r))
        rx = rng.uniform(1.5, 3.4)
        ry = rx * rng.uniform(0.45, 0.75)
        blob = _blob(rng, c, rx, ry, rng.uniform(0, math.pi), n1)
        if not all(inside_quarter(q, fields) for q in blob):
            continue
        if any(s.contains(q, 0.6) for q in blob for s in socks):
            continue
        if any(math.hypot(c[0] - o[0], c[1] - o[1]) < 7.5 for o in placed):
            continue
        _ice_pool(p, rng, blob)
        placed.append(c)
    # Frost veins branching across the paving (their light wakes with the
    # quarter), rime caught along them.
    for line in _crack_net(rng, i, fields, socks, 5, step=(0.7, 1.3), turn=0.7, branch=0.2,
                           start_r=(0.4, 14.0)):
        ribbon(p, line, 0.42, SKIN - 0.004, RIME, slot=0, edge=(0.72, 0.78, 0.86))
        ribbon(p, line, 0.13, SKIN, (0.95, 0.95, 0.95), edge=(0.55, 0.55, 0.55))
    for s in socks:
        frags = socket_pit(p, s, (0.5, 0.56, 0.64), JOINT_DIRT['quench'], (0.86, 0.9, 0.95))
        lay_fragments(p, frags, s, QUENCH_TONES, paint, (0.86, 0.9, 0.95))
    return p


def _ice_pool(p, rng, blob):
    """One sheet of ice (glow slot, painted the ice blue): a dense top so its
    paint can run from the frosted rim to the deep middle."""
    pts = _ccw(blob)
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    interior = []
    step = 0.7
    yy = min(ys) + 0.3
    while yy < max(ys):
        xx = min(xs) + 0.3 + rng.uniform(0, 0.3)
        while xx < max(xs):
            q = (xx + rng.uniform(-0.18, 0.18), yy + rng.uniform(-0.18, 0.18))
            if _pip(q, pts) and float(_poly_dist(np.array([q[0]]), np.array([q[1]]), pts)[0]) > 0.3:
                interior.append(q)
            xx += step
        yy += step * 0.87
    n = len(pts)
    coords = [Vector(q) for q in pts] + [Vector(q) for q in interior]
    vco, _e, tris, _o, _oe, _of = delaunay_2d_cdt(coords, [(k, (k + 1) % n) for k in range(n)], [list(range(n))],
                                                  1, 1e-6)
    X = np.array([v.x for v in vco])
    Y = np.array([v.y for v in vco])
    D = _poly_dist(X, Y, pts)
    n1 = Noise(int(rng.random() * 1e6))
    deep = np.clip(D / 1.4, 0.0, 1.0)
    vary = 0.85 + 0.3 * n1.fbm(X * 0.6, Y * 0.6, 0.2, 2)
    bm = p.bm
    vs = [bm.verts.new((float(X[k]), float(Y[k]), ICE_TOP - 0.004 * float(deep[k]))) for k in range(len(vco))]
    faces = []
    for t in tris:
        try:
            faces.append(bm.faces.new([vs[t[0]], vs[t[1]], vs[t[2]]]))
        except ValueError:
            pass
    p._paint(faces, ICE_TAG, GLOW)
    idx = {v: k for k, v in enumerate(vs)}
    for f in faces:
        for loop in f.loops:
            k = idx[loop.vert]
            # Blue stays well over red (the runtime's ice tag); the rim pale,
            # the middle deeper.
            rim = 1.0 - float(deep[k])
            v = float(vary[k])
            c = (min(1.0, (0.3 + 0.32 * rim) * v), min(1.0, (0.46 + 0.3 * rim) * v), min(1.0, (0.78 + 0.18 * rim) * v))
            loop[p.col] = (*c, 1.0)
    p.facing(faces, (0, 0, 1))


# ================================================================ the Heat
def _seg_hit(a, b, c, d):
    """Where segments a-b and c-d cross: (t along a-b, point), or None."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-9:
        return None
    t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den
    u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
    if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0:
        return t, (a[0] + rx * t, a[1] + ry * t)
    return None


def _split_by_lines(poly, lines, half):
    """A plate split by every fissure crossing it: cut along the fissure's
    chord through it, `half` back on each side (the fissure's gap)."""
    parts = [poly]
    for line in lines:
        nxt = []
        for part in parts:
            hits = []
            m = len(part)
            for j, (q0, q1) in enumerate(zip(line, line[1:])):
                for k in range(m):
                    h = _seg_hit(q0, q1, part[k], part[(k + 1) % m])
                    if h:
                        hits.append((j + h[0], h[1]))
            hits.sort()
            if len(hits) < 2:
                nxt.append(part)
                continue
            e1, e2 = hits[0][1], hits[1][1]
            dx, dy = e2[0] - e1[0], e2[1] - e1[1]
            L = math.hypot(dx, dy)
            if L < 0.3:
                nxt.append(part)
                continue
            nx, ny = -dy / L, dx / L
            for sgn in (1, -1):
                cut = _clip(_densify(part, 0.3),
                            lambda q, s=sgn: s * ((q[0] - e1[0]) * nx + (q[1] - e1[1]) * ny) - half)
                cut = _simplify(cut, 0.02)
                if len(cut) >= 3 and abs(_area(cut)) > 0.2:
                    nxt.append(_ccw(cut))
        parts = nxt
    return parts


def quarter_heat(bpy):
    """Kit_QuarterHeat (see the module doc)."""
    i = qg.ORDER.index('heat')
    p = HSP('Kit_QuarterHeat', seed=6401, ao=0.12, ao_dist=0.35, dust=0.0)
    rng = p.rng
    fields = _walk_fields(i)
    socks = sockets_in(i)
    # The molten fissures first: rivers of fire running out of the ring,
    # branching, then the crust's plates split along them.
    fis_lines = _crack_net(rng, i, quarter_fields(i, qg.RING_R + 0.2, qg.RIM_R - 0.6, qg.RIDGE_HALF + 0.3),
                           socks, 8, step=(0.9, 1.6), turn=0.42, branch=0.2, start_r=(0.3, 12.0))

    def extra(X, Y, D, s, col):
        # Ash settled on the plates, soot and the fire's scorch toward the
        # fissures (the stone round the fire glowing dull red).
        n = paint.n
        ash = np.clip(n.fbm(X * 0.2 + 1.0, Y * 0.2, 7.7, 3) * 2.4 - 0.3, 0.0, 1.0)
        col = _mixc(col, HEAT_ASH, ash * 0.42)
        F = _lines_dist(X, Y, fis_lines)
        hot = np.clip(1.0 - F / 1.4, 0.0, 1.0) ** 2
        col = _mixc(col, (0.05, 0.04, 0.04), np.clip(1.0 - F / 2.4, 0.0, 1.0) * 0.45)
        return _mixc(col, HEAT_SCORCH, hot * 0.75)

    paint = Painter(6403, (0.26, 0.2, 0.17), (0.15, 0.15, 0.17), drift=0.22, hue=0.3, light=0.18, lip=0.3,
                    extra=extra)

    def near_fissure(a, b):
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        return float(_lines_dist(np.array([mx]), np.array([my]), fis_lines)[0]) < 0.55

    seeds = _poisson(rng, i, 3.3)
    seeds, cells = _relaxed(seeds, (-46.0, -46.0, 46.0, 46.0), reach=5.0, rounds=1)
    nw = Noise(6409)
    for cell in cells:
        if not cell:
            continue
        cell = _simplify(_ccw(_warp(_densify(_ccw(cell), 0.5), nw, 0.2, 0.25)), 0.015)
        cell = _inset(cell, rng.uniform(0.04, 0.07))
        outline = clip_to_quarter(cell, fields, i)
        if not outline:
            continue
        for piece in _cut_round_sockets(outline, socks):
            for plate in _split_by_lines(piece, fis_lines, rng.uniform(0.2, 0.28)):
                rr = rng.random()
                parts = _split_broken(rng, plate) if rr < 0.06 else [plate]
                for part in parts:
                    tone = p.vary(HEAT_TONES[rng.randrange(len(HEAT_TONES))], 0.06)
                    info = SlabInfo(tone, part, rng.random())
                    tilt = (rng.uniform(-0.006, 0.006), rng.uniform(-0.006, 0.006))
                    z_at = painted_slab(p, part, rng.uniform(TOP_LO, TOP_HI), info, paint,
                                        bevel=rng.uniform(0.09, 0.14), tilt=tilt, crown=0.01,
                                        edge_glow=lambda a, b: 0.42 if near_fissure(a, b) else None)
                    if z_at and rng.random() < 0.14 and abs(_area(part)) > 3.0:
                        # The crust cracking open: a thin line of fire across it.
                        cx, cy = _centroid(part)
                        inner = _inset(part, 0.35)
                        ang = rng.uniform(0, math.pi)
                        a = (cx - math.cos(ang) * 4, cy - math.sin(ang) * 4)
                        b = (cx + math.cos(ang) * 4, cy + math.sin(ang) * 4)
                        seg = _clip_segment(inner, a, b) if abs(_area(inner)) > 0.4 else None
                        if seg:
                            line = [seg[0]]
                            for t in (0.25, 0.5, 0.75):
                                line.append((seg[0][0] + (seg[1][0] - seg[0][0]) * t + rng.uniform(-0.15, 0.15),
                                             seg[0][1] + (seg[1][1] - seg[0][1]) * t + rng.uniform(-0.15, 0.15)))
                            line.append(seg[1])
                            ribbon(p, line, 0.24, SKIN - 0.004, (0.08, 0.05, 0.04), slot=0,
                                   edge=(0.32, 0.1, 0.04))
                            ribbon(p, line, 0.09, SKIN, (0.85, 0.85, 0.85), edge=(0.45, 0.45, 0.45))
    # The bed of fire under each fissure (seen between its glowing lips): a
    # ribbon hottest along its middle.
    for line in fis_lines:
        ribbon(p, line, 1.25, -0.035, (1.0, 1.0, 1.0), edge=(0.42, 0.42, 0.42), taper=False)
    for s in socks:
        frags = socket_pit(p, s, (0.2, 0.18, 0.17), JOINT_DIRT['heat'], (0.36, 0.3, 0.28))
        lay_fragments(p, frags, s, HEAT_TONES, paint, (0.36, 0.3, 0.28))
    return p


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
        if rng.random() < (0.12 if on else 0.35):
            on = not on
            lay(run)
            run = []
        q, _ = at(rr, 0.05 * math.sin(rr * 1.7))
        z = surf(q)
        if on and z is not None:
            run.append((q[0], q[1], z, 0.3 if rng.random() < 0.06 else rng.uniform(0.12, 0.2)))
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



# ================================================================ the dais
def heart_dais(bpy):
    """Kit_HeartDais (see the module doc)."""
    p = HSP('Kit_HeartDais', seed=6601, ao=0.25, ao_dist=0.5, dust=0.2)
    rng = p.rng
    # The hub where the body hovers: dark basalt round a nest of crystal.
    with p.as_kind(DRESSED):
        prism_top(p, polar_outline([('arc', 1.7, 0.0, 359.0)], step=0.4), 0.03, -0.4, p.vary(BASALT, 0.03),
                  bevel=0.1)
    _rosette(p, rng, 0.0, 1.35, 8, 0.036)
    # The heart's light radiating: a rosette of crystal, then rays toward the
    # four quarters (their middles at the ring) and the four ridges.
    _rosette(p, rng, 1.85, 3.3, 16, 0.03)
    rays = []
    for k in range(4):
        rays.append((qg.wind(qg.sector(k)[0] + 45.0, qg.RING_R), 0.26))
        rays.append((qg.ridge_deg(k, qg.RING_R), 0.18))
    gaps = [(b % 360.0, w + 0.06) for (b, w) in rays]
    courses = [(3.3, 4.9, 'pale'), (4.9, 6.4, 'basalt'), (6.4, 8.3, 'pale'), (8.3, 8.75, 'basalt'),
               (8.75, 9.85, 'band')]
    for (r0, r1, kind) in courses:
        g = gaps if r1 <= 8.4 else []
        tone = {
            'pale': lambda: FLAG_PALE if rng.random() < 0.55 else FLAG_WARM,
            'basalt': lambda: BASALT if rng.random() < 0.7 else BASALT_WORN,
            'band': lambda: BASALT,
        }[kind]
        _ring_course(p, rng, r0, r1, tone, g)
    for (b, w) in rays:
        _ray(p, rng, b, 3.4, 8.25, w)
    # The kerb: a low carved ring, a crystal channel along its crown.
    _kerb(p, rng)
    return p


def _rosette(p, rng, r0, r1, n, z):
    bm = p.bm
    faces = []
    for k in range(n):
        a0 = 360.0 * k / n
        a1 = 360.0 * (k + 1) / n
        am = (a0 + a1) / 2
        if r0 <= 0.0:
            vs = [bm.verts.new((0.0, 0.0, z + 0.004)), bm.verts.new((*qg.bp(r1, a0), z - 0.004)),
                  bm.verts.new((*qg.bp(r1 * 1.04, am), z)), bm.verts.new((*qg.bp(r1, a1), z - 0.004))]
        else:
            vs = [bm.verts.new((*qg.bp(r0, a0 + 2.0), z)), bm.verts.new((*qg.bp(r1, am), z)),
                  bm.verts.new((*qg.bp(r0, a1 - 2.0), z))]
        faces.append(bm.faces.new(vs))
    p._paint(faces, PALE_HI, GLOW)
    for f in faces:
        s = rng.uniform(0.55, 1.0)
        c = tuple(PALE_LO[j] + (PALE_HI[j] - PALE_LO[j]) * s for j in range(3))
        for loop in f.loops:
            loop[p.col] = (*c, 1.0)
    p.facing(faces, (0, 0, 1))


def _ring_course(p, rng, r0, r1, tone, gaps):
    rm = (r0 + r1) / 2
    cuts = sorted(((b - math.degrees(w / rm), b + math.degrees(w / rm)) for (b, w) in gaps))
    spans = []
    if cuts:
        for i, (a0, a1) in enumerate(cuts):
            nxt = cuts[(i + 1) % len(cuts)][0] + (360.0 if i == len(cuts) - 1 else 0.0)
            spans.append((a1, nxt))
    else:
        spans = [(0.0, 360.0)]
    for (s0, s1) in spans:
        a = s0
        while a < s1 - 1e-6:
            step = math.degrees(rng.uniform(1.0, 1.8) / rm)
            b = min(s1, a + step)
            if s1 - b < math.degrees(0.5 / rm):
                b = s1
            ja = math.degrees(0.035 / rm)
            outline = polar_outline([('arc', r0 + 0.035, a + ja, b - ja), ('arc', r1 - 0.035, b - ja, a + ja)],
                                    step=1.2)
            with p.as_kind(DRESSED):
                prism_top(p, outline, rng.uniform(TOP_LO, TOP_HI), -0.4, p.vary(tone(), 0.05),
                          bevel=rng.uniform(0.045, 0.07))
            a = b


def _ray(p, rng, bearing, r0, r1, half):
    """A ray of crystal set flush in the paving, from r0 to r1 at `bearing`."""
    bm = p.bm
    faces = []
    steps = 6
    for k in range(steps):
        ra = r0 + (r1 - r0) * k / steps
        rb = r0 + (r1 - r0) * (k + 1) / steps
        ha = half * (1.0 - 0.55 * (ra - r0) / (r1 - r0))
        hb = half * (1.0 - 0.55 * (rb - r0) / (r1 - r0))
        a = math.radians(bearing)
        ux, uy = math.sin(a), -math.cos(a)
        vx, vy = -uy, ux
        vs = [bm.verts.new((ux * ra - vx * ha, uy * ra - vy * ha, 0.028)),
              bm.verts.new((ux * rb - vx * hb, uy * rb - vy * hb, 0.028)),
              bm.verts.new((ux * rb + vx * hb, uy * rb + vy * hb, 0.028)),
              bm.verts.new((ux * ra + vx * ha, uy * ra + vy * ha, 0.028))]
        faces.append(bm.faces.new(vs))
    p._paint(faces, PALE_HI, GLOW)
    for f in faces:
        s = rng.uniform(0.6, 1.0)
        c = tuple(PALE_LO[j] + (PALE_HI[j] - PALE_LO[j]) * s for j in range(3))
        for loop in f.loops:
            loop[p.col] = (*c, 1.0)
    p.facing(faces, (0, 0, 1))


KERB_IN = 9.95
KERB_OUT = 11.35


def _kerb(p, rng):
    """The dais's kerb: two rings of carved blocks either side of a crystal
    channel, low enough to step over, crystal studs where the ridges meet it
    and between."""
    for (r0, r1, top) in ((KERB_IN, 10.55, CREST - 0.03), (10.8, KERB_OUT, CREST)):
        rm = (r0 + r1) / 2
        a = rng.uniform(0, 4)
        a_end = a + 360.0
        while a < a_end - 1e-6:
            step = math.degrees(rng.uniform(1.2, 2.0) / rm)
            b = min(a_end, a + step)
            ja = math.degrees(0.04 / rm)
            outline = polar_outline([('arc', r0, a + ja, b - ja), ('arc', r1, b - ja, a + ja)], step=1.0)
            with p.as_kind(DRESSED):
                prism_top(p, outline, top - rng.uniform(0.0, 0.02), -0.3,
                          p.vary((0.36, 0.35, 0.37) if rng.random() < 0.7 else (0.3, 0.29, 0.31), 0.05),
                          bevel=0.09)
            a = b
    # The channel between them, its crystal a hand under the crown.
    bm = p.bm
    faces = []
    n = 96
    for k in range(n):
        a0 = 360.0 * k / n
        a1 = 360.0 * (k + 1) / n
        vs = [bm.verts.new((*qg.bp(10.55, a0), CREST - 0.1)), bm.verts.new((*qg.bp(10.55, a1), CREST - 0.1)),
              bm.verts.new((*qg.bp(10.8, a1), CREST - 0.1)), bm.verts.new((*qg.bp(10.8, a0), CREST - 0.1))]
        faces.append(bm.faces.new(vs))
    p._paint(faces, PALE_HI, GLOW)
    p.facing(faces, (0, 0, 1))
    # Studs: low crystal clusters in the channel.
    for k in range(16):
        b = k * 22.5 + 11.25
        if k % 4 == 0:
            b = qg.ridge_deg(k // 4, qg.RING_R)
        x, y = qg.bp(10.675, b)
        for j in range(3):
            with p.as_kind(PAINT):
                pale_crystal(p, (x + rng.uniform(-0.08, 0.08), y + rng.uniform(-0.08, 0.08), CREST - 0.12),
                             (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 1.0), rng.uniform(0.07, 0.11),
                             rng.uniform(0.05, 0.08), bright=0.2)



__all__ = ['quarter_hammer', 'quarter_breath', 'quarter_quench', 'quarter_heat', 'heart_ridge', 'heart_ridge_horn',
           'heart_dais', 'joint_bed', 'clip_to_quarter', 'quarter_fields']
