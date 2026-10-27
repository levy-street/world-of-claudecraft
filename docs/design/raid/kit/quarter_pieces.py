"""The Anvil of the World's four quarters (phase 2K, build_smith_heart_heart_kit.py):
the platform's walk rebuilt as four elemental quarters set in a pinwheel round
a central ring (the numbers: quarter_geom.py, the sim's smith_heart_quarters.ts).

  - Kit_QuarterHammer: heavy slabs of ochre-gold granite laid in rows across
    the quarter, each dressed with the mason's hammer (rows of tool grooves),
    tremor cracks running through them.
  - Kit_QuarterBreath: the wind-scoured storm stone in courses that swirl with
    the pinwheel, their joints skewed into a spiral, long spiral scorings and
    pale scour streaks running across them.
  - Kit_QuarterQuench: frost stone in an irregular crazy paving, much of it
    glazed under ice (the ice slot), frost veins branching across it.
  - Kit_QuarterHeat: the tops of basalt columns, hexagons with wide joints,
    fissures of white-gold fire crystal running out from the ring, ash.
  - Kit_HeartRidge: one ridge (ridge 0; the runtime turns it a quarter for
    each of the other three): a low spine of dark rock on the walk, its vein
    of crystal in a groove along its crest, rising past the rim into a
    hooked horn of rock over the platform's edge.
  - Kit_HeartDais: the central ring: the basalt hub, a rosette of the heart's
    crystal, rays of crystal toward the four quarters and the four ridges,
    the rune band, and a low carved kerb with a crystal channel and studs.

Every quarter's joints show its glow slot underneath (a sheet of pale crystal
just under the paving): the runtime tints it with the quarter's vein and wakes
it (src/render/smith_heart/heart_quarters.ts), so the seams ignite when the
boss stands in the quarter. Frames: every piece at the platform's centre on
its walk (Blender -Y the game's north), placed unturned (the ridge turned per
ridge). Walk rule: on the walk (r < 42) the quarters' paving stays a breath
over it (every top at most 0.04) and the ridges and the dais's kerb at most
0.25 (bodies walk over them; no collider); the horns stand past the lip.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
import quarter_geom as qg
from gravewyrm_sculpt import Sculpt
from gwkit import slab
from heart_pieces import (
    ASH, BASALT_H, BASALT_HD, FROST, FROST_DARK, HSP, ICE, ICE_BODY, ICE_DEEP, OCHRE, OCHRE_DARK, PALE_HI, PALE_LO,
    _clamp, pale_crystal,
)
from hckit import GLOW
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline
from ring_pieces import BASALT, BASALT_WORN, FLAG_PALE, FLAG_WARM, _area, _inset, polar_outline, prism_top
from shkit import DRESSED, PAINT, RAW, TAU

# ---- tones ------------------------------------------------------------------------------
HAMMER_TONES = ((0.56, 0.47, 0.33), (0.5, 0.43, 0.32), OCHRE, (0.6, 0.53, 0.4), OCHRE_DARK, (0.53, 0.45, 0.31))
HAMMER_GROOVE = (0.3, 0.25, 0.18)
BREATH_TONES = ((0.47, 0.46, 0.56), (0.42, 0.41, 0.53), (0.38, 0.47, 0.5), (0.53, 0.53, 0.6), (0.33, 0.34, 0.42),
                (0.45, 0.5, 0.55))
BREATH_SCOUR = (0.66, 0.67, 0.7)
QUENCH_TONES = (FROST, (0.66, 0.71, 0.77), (0.55, 0.6, 0.67), FROST_DARK, (0.62, 0.67, 0.73))
RIME = (0.82, 0.88, 0.93)
HEAT_TONES = (BASALT_H, BASALT_HD, (0.3, 0.27, 0.25), (0.23, 0.21, 0.2), (0.25, 0.24, 0.24))
RIDGE_TONES = ((0.2, 0.2, 0.22), (0.24, 0.23, 0.25), (0.17, 0.16, 0.18), (0.22, 0.21, 0.24))
RIDGE_COLOURS = {'r0': (0.2, 0.2, 0.22), 'r1': (0.25, 0.24, 0.26), 'r2': (0.16, 0.15, 0.17), 'r3': (0.22, 0.21, 0.24)}
RIDGE_KINDS = {k: RAW for k in RIDGE_COLOURS}

TOP_LO = 0.012
TOP_HI = 0.032
SKIN = 0.037  # a mark painted on the tops (grooves, scorings, veins), over every top
CREST = 0.24  # the ridges' and the kerb's highest point on the walk


# ---- clipping to a quarter ------------------------------------------------------------------
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


def _spiral_sides(poly, r0, r1):
    """A lane flag's outline from its two end arcs (poly: the inner arc then
    the outer arc reversed): the straight sides between them bent onto the
    pinwheel's spiral (points along constant unwound bearing)."""
    n = len(poly) // 2
    inner, outer = poly[:n], poly[n:]
    out = list(inner)
    a = inner[-1]
    b = outer[0]
    ra, ba = qg.polar_of(*a)
    rb, bb = qg.polar_of(*b)
    phi = qg.unwind(ba, ra)
    steps = max(1, int((r1 - r0) / 0.5))
    for k in range(1, steps):
        rr = r0 + (r1 - r0) * k / steps
        out.append(qg.bp(rr, qg.wind(phi, rr)))
    out.extend(outer)
    a = outer[-1]
    ra, ba = qg.polar_of(*a)
    phi = qg.unwind(ba, ra)
    for k in range(1, steps):
        rr = r1 - (r1 - r0) * k / steps
        out.append(qg.bp(rr, qg.wind(phi, rr)))
    return out


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


def clip_to_quarter(pts, fields):
    poly = _densify(pts)
    for f in fields:
        poly = _clip(poly, f)
        if len(poly) < 3:
            return []
    poly = _simplify(poly)
    if len(poly) < 3 or abs(_area(poly)) < 0.12:
        return []
    # A tile across the wrap of the bearings (behind the centre, or holding
    # the ring's hole) can fool the linear cut: keep only a clean result.
    cx = sum(q[0] for q in poly) / len(poly)
    cy = sum(q[1] for q in poly) / len(poly)
    if not all(f((cx, cy)) >= 0 for f in fields):
        return []
    if any(f(q) < -0.05 for q in poly for f in fields):
        return []
    if _area(poly) < 0:
        poly.reverse()
    return poly


def inside_quarter(p, fields):
    return all(f(p) >= 0 for f in fields)


def _ccw(pts):
    pts = list(pts)
    if _area(pts) < 0:
        pts.reverse()
    return pts


def _lay(p, outline, tone, top, bevel, slot=0, tilt=None, kind=DRESSED):
    rng = p.rng
    tilt = tilt or (rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004))
    with p.as_kind(kind):
        prism_top(p, outline, top, -0.32, tone, bevel=bevel, tilt=tilt, slot=slot)
    return tilt


def _top_at(outline, top, tilt, x, y):
    cx = sum(q[0] for q in outline) / len(outline)
    cy = sum(q[1] for q in outline) / len(outline)
    return top + (x - cx) * tilt[0] + (y - cy) * tilt[1]


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
    before = set(bm.faces)
    vs = [bm.verts.new((a[0] - nx, a[1] - ny, z)), bm.verts.new((b[0] - nx, b[1] - ny, z1)),
          bm.verts.new((b[0] + nx, b[1] + ny, z1)), bm.verts.new((a[0] + nx, a[1] + ny, z))]
    bm.faces.new(vs)
    faces = [f for f in bm.faces if f not in before]
    p._paint(faces, color, slot)
    p.facing(faces, (0, 0, 1))
    return faces


def underlay(p, i, rng_fn):
    """The sheet of pale crystal under quarter i's paving (its glow slot,
    seen in every joint): a grid in the unwound sector, each vertex its own
    pale grey (the light inside, brighter in drifts)."""
    s0, s1 = qg.sector(i)
    radii = [qg.RING_R - 0.3]
    while radii[-1] < qg.RIM_R + 0.05:
        radii.append(min(qg.RIM_R + 0.06, radii[-1] + 1.7))
    na = 24
    bm = p.bm
    before = set(bm.faces)
    grid = []
    for r in radii:
        row = []
        for k in range(na + 1):
            phi = s0 - 1.5 + (s1 - s0 + 3.0) * k / na
            x, y = qg.bp(r, qg.wind(phi, r))
            row.append(bm.verts.new((x, y, -0.03)))
        grid.append(row)
    for a in range(len(radii) - 1):
        for k in range(na):
            bm.faces.new((grid[a][k], grid[a][k + 1], grid[a + 1][k + 1], grid[a + 1][k]))
    faces = [f for f in bm.faces if f not in before]
    p._paint(faces, PALE_HI, GLOW)
    for f in faces:
        for loop in f.loops:
            v = loop.vert.co
            s = rng_fn(v.x, v.y)
            c = tuple(PALE_LO[j] + (PALE_HI[j] - PALE_LO[j]) * s for j in range(3))
            loop[p.col] = (*c, 1.0)
    p.facing(faces, (0, 0, 1))


def _drift(seed):
    from jaguar_head_sculpt import Noise as _N
    n = _N(seed)

    def f(x, y):
        v = n.fbm(x * 0.09, y * 0.09, 0.3, 3)
        return max(0.0, min(1.0, 0.55 + 0.9 * v))

    return f


def _frame(i):
    """Quarter i's middle at the rim: (bearing, unit out, unit across)."""
    b = (qg.sector(i)[0] + 45.0)
    a = math.radians(b)
    out = (math.sin(a), -math.cos(a))
    across = (math.cos(a), math.sin(a))
    return b, out, across


# ================================================================ the Hammer
def quarter_hammer(bpy):
    """Kit_QuarterHammer (see the module doc)."""
    i = qg.ORDER.index('hammer')
    p = HSP('Kit_QuarterHammer', seed=6101, ao=0.25, ao_dist=0.5, dust=0.35)
    rng = p.rng
    fields = quarter_fields(i, qg.RING_R + 0.35, qg.RIM_R, qg.RIDGE_HALF - 0.25)
    underlay(p, i, _drift(6103))
    _, out, across = _frame(i)
    # Rows across the quarter (perpendicular to its middle), running bond.
    d = -46.0
    row = 0
    while d < qg.RIM_R + 3.0:
        depth = rng.uniform(2.3, 3.3)
        s = -44.0 + (rng.uniform(0.0, 2.0) if row % 2 else rng.uniform(1.6, 3.2))
        while s < 44.0:
            length = rng.uniform(2.8, 4.8) if rng.random() < 0.82 else rng.uniform(5.2, 6.6)
            j = 0.06  # half the glowing joint
            corners = []
            for (u, v) in ((d + j, s + j), (d + depth - j, s + j), (d + depth - j, s + length - j),
                           (d + j, s + length - j)):
                corners.append((out[0] * u + across[0] * v, out[1] * u + across[1] * v))
            outline = clip_to_quarter(_ccw(corners), fields)
            s += length
            if not outline:
                continue
            tone = p.vary(HAMMER_TONES[rng.randrange(len(HAMMER_TONES))], 0.06)
            top = rng.uniform(TOP_LO, TOP_HI)
            tilt = _lay(p, outline, tone, top, rng.uniform(0.08, 0.13))
            _hammer_marks(p, rng, outline, top, tilt, fields, tone)
        d += depth
        row += 1
    return p


def _hammer_marks(p, rng, outline, top, tilt, fields, tone=HAMMER_GROOVE):
    """The mason's hammer on one slab: a band of parallel tool grooves, and
    now and then a tremor crack running through it (its light leaking)."""
    xs = [q[0] for q in outline]
    ys = [q[1] for q in outline]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span < 1.4 or rng.random() < 0.35:
        return
    inner = _inset(outline, 0.28)
    if abs(_area(inner)) < 0.4:
        return
    groove = tuple(min(1.0, c * 0.66) for c in tone)
    ang = rng.uniform(0, math.pi)
    ux, uy = math.cos(ang), math.sin(ang)
    vx, vy = -uy, ux
    n = rng.randrange(3, 7)
    pitch = rng.uniform(0.24, 0.34)
    off = rng.uniform(-0.4, 0.4)
    for k in range(n):
        o = off + (k - n / 2) * pitch
        a = (cx + vx * o - ux * span, cy + vy * o - uy * span)
        b = (cx + vx * o + ux * span, cy + vy * o + uy * span)
        seg = _clip_segment(inner, a, b)
        if not seg:
            continue
        (a2, b2) = seg
        z = max(_top_at(outline, top, tilt, *a2), _top_at(outline, top, tilt, *b2)) + 0.004
        strip(p, a2, b2, rng.uniform(0.035, 0.05), min(SKIN, z), groove)
    if rng.random() < 0.3:
        # A tremor crack across the slab: the quarter's light leaks through.
        a = (cx - ux * span, cy - uy * span)
        b = (cx + ux * span, cy + uy * span)
        seg = _clip_segment(_inset(outline, 0.12), (a[0] + vx * 0.3, a[1] + vy * 0.3), b)
        if seg:
            pts = [seg[0]]
            m = 5
            for k in range(1, m):
                t = k / m
                j = rng.uniform(-0.22, 0.22)
                pts.append((seg[0][0] + (seg[1][0] - seg[0][0]) * t + vx * j,
                            seg[0][1] + (seg[1][1] - seg[0][1]) * t + vy * j))
            pts.append(seg[1])
            for q0, q1 in zip(pts, pts[1:]):
                strip(p, q0, q1, rng.uniform(0.06, 0.09), SKIN, PALE_HI, slot=GLOW)


def _clip_segment(poly, a, b):
    """The part of segment a-b inside a (roughly convex) polygon."""
    t0, t1 = 0.0, 1.0
    n = len(poly)
    pts = _ccw(poly)
    for k in range(n):
        p0 = pts[k]
        p1 = pts[(k + 1) % n]
        ex, ey = p1[0] - p0[0], p1[1] - p0[1]
        # Inside is to the left of a counter-clockwise edge.
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


# ================================================================ the Breath
def quarter_breath(bpy):
    """Kit_QuarterBreath (see the module doc)."""
    i = qg.ORDER.index('breath')
    p = HSP('Kit_QuarterBreath', seed=6201, ao=0.25, ao_dist=0.5, dust=0.15)
    rng = p.rng
    fields = quarter_fields(i, qg.RING_R + 0.35, qg.RIM_R, qg.RIDGE_HALF - 0.25)
    underlay(p, i, _drift(6203))
    s0, s1 = qg.sector(i)
    # Lanes of long flags running out along the pinwheel's own spiral (the
    # wind's path from the ring to the rim), split in two past mid-way so
    # they never grow wide; each flag's ends cut square across its lane.
    bands = ((qg.RING_R + 0.2, 23.0, 16), (23.0, qg.RIM_R + 0.4, 32))
    for (ra, rb, lanes) in bands:
        dphi = (s1 - s0 + 16.0) / lanes
        for L in range(lanes):
            p0 = s0 - 8.0 + dphi * L
            p1 = p0 + dphi
            r = ra + rng.uniform(0.0, 1.8)
            if L % 2:
                r = ra
            while r < rb - 1e-6:
                length = min(rb - r, rng.uniform(2.4, 4.4))
                if rb - (r + length) < 0.8:
                    length = rb - r
                r0, r1 = r, r + length
                poly = []
                jr = 0.06
                for (rr, a0, a1) in ((r0 + jr, p0, p1), (r1 - jr, p1, p0)):
                    j = math.degrees(0.075 / rr)
                    n = max(1, int(abs(math.radians(a1 - a0)) * rr / 0.8))
                    for k in range(n + 1):
                        phi = (a0 + j if a0 < a1 else a0 - j) + ((a1 - j if a1 > a0 else a1 + j) - (a0 + j if a0 < a1 else a0 - j)) * k / n
                        poly.append(qg.bp(rr, qg.wind(phi, rr)))
                # The lane's sides follow the spiral: densify along them.
                outline = clip_to_quarter(_ccw(_spiral_sides(poly, r0 + jr, r1 - jr)), fields)
                r = r1
                if not outline:
                    continue
                tone = p.vary(BREATH_TONES[rng.randrange(len(BREATH_TONES))], 0.05)
                _lay(p, outline, tone, rng.uniform(TOP_LO, TOP_HI), rng.uniform(0.06, 0.1))
    # The spiral scorings the wind cut (their light wakes with the quarter:
    # the wind's lines drawn in its stone), broken here and there, and pale
    # scour streaks along them.
    for k in range(26):
        phi0 = rng.uniform(s0 - 25.0, s1 + 5.0)
        kappa = rng.uniform(0.9, 1.5)
        ra = rng.uniform(qg.RING_R + 1.0, qg.RIM_R - 14.0)
        rb = min(qg.RIM_R - 0.6, ra + rng.uniform(8.0, 20.0))
        w = rng.uniform(0.07, 0.11)
        scour = rng.random() < 0.3
        prev = None
        rr = ra
        while rr < rb:
            q = qg.bp(rr, qg.wind(phi0 + kappa * (rr - ra), rr))
            if prev is not None and rng.random() > 0.12 and inside_quarter(prev, fields) and inside_quarter(q, fields):
                if scour:
                    strip(p, prev, q, w * 4.0, SKIN - 0.002, p.vary(BREATH_SCOUR, 0.04))
                else:
                    strip(p, prev, q, w, SKIN, PALE_HI, slot=GLOW)
            prev = q
            rr += 0.7
    return p


# ================================================================ the Quench
def _voronoi_cells(seeds, box):
    """Each seed's Voronoi cell inside `box` (x0, y0, x1, y1): a square
    clipped by the bisectors with its near neighbours."""
    x0, y0, x1, y1 = box
    pts = np.asarray(seeds)
    out = []
    for idx, s in enumerate(pts):
        poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        poly = [(max(x0, s[0] - 4), max(y0, s[1] - 4)), (min(x1, s[0] + 4), max(y0, s[1] - 4)),
                (min(x1, s[0] + 4), min(y1, s[1] + 4)), (max(x0, s[0] - 4), min(y1, s[1] + 4))]
        d = np.hypot(pts[:, 0] - s[0], pts[:, 1] - s[1])
        for jdx in np.argsort(d)[1:14]:
            o = pts[jdx]
            mx, my = (s[0] + o[0]) / 2, (s[1] + o[1]) / 2
            nx, ny = s[0] - o[0], s[1] - o[1]
            poly = _clip(poly, lambda q, mx=mx, my=my, nx=nx, ny=ny: (q[0] - mx) * nx + (q[1] - my) * ny)
            if len(poly) < 3:
                break
        if len(poly) >= 3:
            out.append(poly)
    return out


def quarter_quench(bpy):
    """Kit_QuarterQuench (see the module doc)."""
    i = qg.ORDER.index('quench')
    p = HSP('Kit_QuarterQuench', seed=6301, ao=0.2, ao_dist=0.5, dust=0.0)
    rng = p.rng
    fields = quarter_fields(i, qg.RING_R + 0.35, qg.RIM_R, qg.RIDGE_HALF - 0.25)
    underlay(p, i, _drift(6303))
    seeds = []
    sp = 2.05
    y = -44.0
    row = 0
    while y < 44.0:
        x = -44.0 + (sp / 2 if row % 2 else 0.0)
        while x < 44.0:
            q = (x + rng.uniform(-0.55, 0.55) * sp, y + rng.uniform(-0.55, 0.55) * sp)
            r = math.hypot(*q)
            if qg.RING_R - 3 < r < qg.RIM_R + 3:
                # Only seeds near this quarter (its sector, a margin round it).
                phi, _ = _phi(q[0], q[1], i)
                s0, s1 = qg.sector(i)
                if s0 - 12 < phi < s1 + 12:
                    seeds.append(q)
            x += sp
        y += sp * 0.87
        row += 1
    cells = _voronoi_cells(seeds, (-45.0, -45.0, 45.0, 45.0))
    for cell in cells:
        cell = _ccw(cell)
        inner = _inset(cell, 0.045)
        outline = clip_to_quarter(inner, fields)
        if not outline:
            continue
        if rng.random() < 0.46:
            # Glazed under ice: smooth, a breath proud of the frost stone.
            tone = p.vary(ICE_BODY if rng.random() < 0.7 else ICE_DEEP, 0.05)
            prism_top(p, outline, rng.uniform(0.026, TOP_HI + 0.002), -0.3, tone, bevel=0.03, slot=ICE)
        else:
            tone = p.vary(QUENCH_TONES[rng.randrange(len(QUENCH_TONES))], 0.05)
            _lay(p, outline, tone, rng.uniform(TOP_LO, TOP_HI - 0.004), rng.uniform(0.05, 0.08))
    # Frost veins branching across the paving (their light wakes with the
    # quarter), rime caught along them.
    for k in range(26):
        while True:
            r = rng.uniform(qg.RING_R + 1.5, qg.RIM_R - 1.5)
            phi = rng.uniform(*qg.sector(i))
            start = qg.bp(r, qg.wind(phi, r))
            if inside_quarter(start, fields):
                break
        _frost_vein(p, rng, start, rng.uniform(0, TAU), rng.randrange(6, 13), fields, 0.11, 2)
    return p


def _frost_vein(p, rng, start, ang, steps, fields, w, depth):
    q = start
    for s in range(steps):
        ang += rng.uniform(-0.6, 0.6)
        L = rng.uniform(0.45, 1.0)
        nq = (q[0] + math.cos(ang) * L, q[1] + math.sin(ang) * L)
        if not inside_quarter(nq, fields):
            return
        strip(p, q, nq, w, SKIN, PALE_HI, slot=GLOW)
        if rng.random() < 0.18:
            strip(p, q, nq, w * 3.2, SKIN - 0.002, p.vary(RIME, 0.04))
        if depth > 0 and rng.random() < 0.22:
            _frost_vein(p, rng, nq, ang + rng.choice((-1, 1)) * rng.uniform(0.6, 1.1), rng.randrange(2, 6),
                        fields, w * 0.7, depth - 1)
        q = nq


# ================================================================ the Heat
def quarter_heat(bpy):
    """Kit_QuarterHeat (see the module doc)."""
    i = qg.ORDER.index('heat')
    p = HSP('Kit_QuarterHeat', seed=6401, ao=0.25, ao_dist=0.5, dust=0.0)
    rng = p.rng
    fields = quarter_fields(i, qg.RING_R + 0.35, qg.RIM_R, qg.RIDGE_HALF - 0.25)
    underlay(p, i, _drift(6403))
    s0, s1 = qg.sector(i)
    # The fissures of fire crystal: wandering lines out from the ring.
    fissures = []
    for k in range(4):
        phi = s0 + 12.0 + (s1 - s0 - 24.0) * (k + rng.uniform(0.2, 0.8)) / 4
        line = []
        r = qg.RING_R + rng.uniform(0.5, 6.0)
        end = qg.RIM_R - rng.uniform(1.0, 12.0)
        while r < end:
            line.append(qg.bp(r, qg.wind(phi, r)))
            phi += rng.uniform(-3.0, 3.0) * (14.0 / r)
            r += 1.2
        fissures.append(line)

    def near_fissure(q):
        best = 99.0
        for line in fissures:
            for a, b in zip(line, line[1:]):
                ex, ey = b[0] - a[0], b[1] - a[1]
                L2 = ex * ex + ey * ey
                t = max(0.0, min(1.0, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / max(1e-6, L2)))
                best = min(best, math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ey * t))
        return best

    R = 1.18
    dx = 1.5 * R
    dy = math.sqrt(3.0) * R
    col = 0
    x = -45.0
    while x < 45.0:
        y = -45.0 + (dy / 2 if col % 2 else 0.0)
        while y < 45.0:
            c = (x, y)
            r = math.hypot(*c)
            if qg.RING_R - 2 < r < qg.RIM_R + 2:
                hexo = []
                for k in range(6):
                    a = TAU * k / 6
                    jr = R + rng.uniform(-0.07, 0.04)
                    hexo.append((c[0] + math.cos(a) * jr, c[1] + math.sin(a) * jr))
                hexo = _inset(_ccw(hexo), 0.06)
                outline = clip_to_quarter(hexo, fields)
                if outline:
                    if near_fissure(c) < 0.62 and inside_quarter(c, fields):
                        _fire_crystal_tile(p, rng, outline)
                    else:
                        tone = p.vary(HEAT_TONES[rng.randrange(len(HEAT_TONES))], 0.06)
                        if rng.random() < 0.18:
                            tone = p.vary(tuple(t * 0.6 + a * 0.4 for t, a in zip(tone, ASH)), 0.05)
                        _lay(p, outline, tone, rng.uniform(TOP_LO, TOP_HI), rng.uniform(0.07, 0.11), kind=DRESSED)
            y += dy
        x += dx
        col += 1
    return p


def _fire_crystal_tile(p, rng, outline):
    """A column top burst open with fire crystal: facets of pale crystal (the
    quarter's white-gold at runtime) in a rim of scorched basalt."""
    rim = _inset(outline, 0.16)
    with p.as_kind(DRESSED):
        prism_top(p, outline, rng.uniform(TOP_LO, 0.02), -0.3, p.vary((0.12, 0.1, 0.09), 0.05), bevel=0.05)
    if abs(_area(rim)) < 0.08:
        return
    cx = sum(q[0] for q in rim) / len(rim)
    cy = sum(q[1] for q in rim) / len(rim)
    bm = p.bm
    hub = bm.verts.new((cx, cy, 0.034))
    ring = [bm.verts.new((q[0], q[1], 0.024 + rng.uniform(0.0, 0.006))) for q in rim]
    n = len(ring)
    faces = []
    for k in range(n):
        faces.append(bm.faces.new((ring[k], ring[(k + 1) % n], hub)))
    p._paint(faces, PALE_HI, GLOW)
    for f in faces:
        s = rng.uniform(0.35, 1.0)
        c = tuple(PALE_LO[j] + (PALE_HI[j] - PALE_LO[j]) * s for j in range(3))
        for loop in f.loops:
            loop[p.col] = (*c, 1.0)
    p.facing(faces, (0, 0, 1))


# ================================================================ the ridges
def _ridge_profile(t):
    """A ridge's height (0 to 1 of CREST) across it (t -1 to 1): a broad
    hump, two shoulders and the groove of its vein between them."""
    a = abs(t)
    hump = max(0.0, 1.0 - a * a) ** 1.25
    groove = max(0.0, 1.0 - (a / 0.2) ** 2) * 0.36
    return hump * (1.0 - groove)


def heart_ridge(bpy):
    """Kit_HeartRidge (ridge 0; see the module doc)."""
    p = HSP('Kit_HeartRidge', seed=6501, ao=0.35, ao_dist=0.8, dust=0.0)
    rng = p.rng
    n1 = Noise(6503)
    # The spine on the walk: a swept grid along the ridge from inside the
    # dais's kerb to the rim.
    k = 0
    radii = []
    r = qg.RING_R - 0.9
    while r < qg.RIM_R + 0.6:
        radii.append(r)
        r += 0.42
    across = [-1.0, -0.86, -0.7, -0.52, -0.36, -0.22, -0.13, -0.06, 0.0, 0.06, 0.13, 0.22, 0.36, 0.52, 0.7, 0.86,
              1.0]
    bm = p.bm
    before = set(bm.faces)
    grid = []
    for r in radii:
        b = qg.ridge_deg(k, r)
        w = qg.RIDGE_HALF + 0.12 * math.sin(r * 0.9) + 0.25 * max(0.0, 1.0 - (r - qg.RING_R) / 4.0)
        # The ridge's outward normal in plan (across it).
        cx, cy = qg.bp(r, b)
        tx, ty = qg.bp(r + 0.05, qg.ridge_deg(k, r + 0.05))
        dx, dy = tx - cx, ty - cy
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        row = []
        for t in across:
            h = _ridge_profile(t)
            rough = n1.fbm(r * 0.55, t * 2.0, 0.5, 3)
            z = CREST * h * (0.86 + 0.14 * rough) - 0.03 * (1.0 - h)
            # The crest's edge broken (the rock is never a clean extrusion).
            lat = t * w * (1.0 + 0.08 * n1.fbm(r * 0.4, t, 2.0, 2))
            row.append(bm.verts.new((cx + nx * lat, cy + ny * lat, min(CREST, z))))
        grid.append(row)
    for a in range(len(radii) - 1):
        for j in range(len(across) - 1):
            bm.faces.new((grid[a][j], grid[a + 1][j], grid[a + 1][j + 1], grid[a][j + 1]))
    faces = [f for f in bm.faces if f not in before]
    for f in faces:
        c = f.calc_center_median()
        tone = RIDGE_TONES[int((n1.fbm(c.x * 0.3, c.y * 0.3, 1.0, 2) + 1.0) * 2.0) % len(RIDGE_TONES)]
        with p.as_kind(RAW):
            p._paint([f], p.vary(tone, 0.05), 0)
    p.facing(faces, (0, 0, 1))
    # The vein in its groove: a strip of crystal down the crest, and crystal
    # breaking out of the shoulders here and there (never over the crest).
    for a in range(len(radii) - 1):
        q0 = grid[a][8].co
        q1 = grid[a + 1][8].co
        z0 = max(grid[a][j].co.z for j in (6, 7, 8, 9, 10)) + 0.004
        z1 = max(grid[a + 1][j].co.z for j in (6, 7, 8, 9, 10)) + 0.004
        strip(p, (q0.x, q0.y), (q1.x, q1.y), 0.36, min(CREST, z0), PALE_HI, slot=GLOW, z1=min(CREST, z1))
    for a in range(2, len(radii) - 2, 3):
        if rng.random() < 0.55:
            side = rng.choice((5, 11))
            q = grid[a][side].co
            with p.as_kind(PAINT):
                pale_crystal(p, (q.x, q.y, q.z - 0.06), (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 1.0),
                             max(0.05, CREST - q.z + 0.03), rng.uniform(0.07, 0.12))
    # Knuckles of the same dark rock half sunk along its flanks (never over
    # its crest), so the spine reads broken out of the floor, not laid on it.
    for a in range(1, len(radii) - 1):
        if rng.random() < 0.42:
            side = rng.choice((1, 15))
            q = grid[a][side].co
            inward = grid[a][8].co - q
            inward.z = 0.0
            inward.normalize()
            c = (q.x + inward.x * rng.uniform(0.1, 0.4), q.y + inward.y * rng.uniform(0.1, 0.4), 0.0)
            sz = rng.uniform(0.35, 0.75)
            with p.as_kind(RAW):
                slab(p, c, (sz * 1.5, sz, min(0.4, CREST * 1.6)), p.vary(RIDGE_TONES[rng.randrange(4)], 0.05),
                     yaw=rng.uniform(0, TAU), chamfer=0.3, jitter=0.2)
    _ridge_horn(bpy, p, k)
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
    radii = [1.2, 1.45, 1.4, 1.15, 0.85, 0.55, 0.26]
    f.put('r0', Polyline(spine, radii), 0.55)
    # Its root down the platform's fascia.
    f.put('r2', Polyline([at(qg.RIM_R + 0.9, 0.2, -0.3), at(qg.RIM_R + 1.5, -1.8, -0.2),
                          at(qg.RIM_R + 1.2, -3.8, -0.4)], [1.5, 1.7, 1.1]), 0.8)
    # A lesser spur thrown off its outer flank, and a knuckle at its knee.
    f.put('r1', Polyline([at(qg.RIM_R + 2.9, 3.0, 1.4), at(qg.RIM_R + 4.9, 4.6, 1.0), at(qg.RIM_R + 5.6, 5.4, 0.2)],
                         [0.7, 0.42, 0.16]), 0.45)
    f.put('r3', Polyline([at(qg.RIM_R + 2.1, 1.6, 0.4), at(qg.RIM_R + 2.6, 2.4, -1.0)], [0.75, 0.3]), 0.4)
    f.put('r1', Ellipsoid(at(qg.RIM_R + 1.1, 0.2, 0.0), (1.6, 1.6, 0.9)), 0.7)
    f.displace(lambda X, Y, Z: 0.28 * n1.fbm(X * 0.45, Y * 0.45, Z * 0.3, 3)
               + 0.16 * (n1.ridged(X * 1.1, Y * 1.1, Z * 0.7, 2) - 0.45), band=0.9)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    # Never over the walk: inside the rim it stays under the crest (and it
    # barely reaches in: the walk's own spine meets it there).
    R = np.sqrt(X * X + Y * Y)
    _clamp(f, np.where(R < qg.RIM_R + 0.25, Z - CREST + 0.06 + (qg.RIM_R + 0.25 - R) * 0.6, -1.0))
    f.cut_below(-4.2)
    _mesh_ridge(bpy, p, f, 'HeartRidgeHorn', 3600)
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


def _mesh_ridge(bpy, p, f, name, target):
    import gravewyrm_sculpt as gs
    from gwkit import add_sculpt
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, RIDGE_COLOURS, RIDGE_KINDS, smooth=False)


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


__all__ = ['quarter_hammer', 'quarter_breath', 'quarter_quench', 'quarter_heat', 'heart_ridge', 'heart_dais',
           'clip_to_quarter', 'quarter_fields']
