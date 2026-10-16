"""The manor's stained glass, leaded: our own design, never a grid of blocks.

The great window behind the high table is three lancets between two stone mullions under a
round head. Each side lancet is a lattice of pale quarries (diamond panes) with gold flowers
in it inside a border of blue and garnet; the middle lancet carries a roundel of the hold's
beacon (three snowy peaks under a gold flame on a blue field) over the same lattice. The head
is a rose: a gold heart, eight petals in garnet and gold, a blue and gold rim. The chapel's
small window is one lancet with a roundel of a sun over a single peak.

Every pane is a flat face on each side of the wall; a charge laid over a field stands a whole
LAYER clear of it (never coplanar), and the cames (lead strips) run along every joint a hand
proud of the glass, so the leading reads at every distance. The glass's colours split over
the coloured-glass materials (their emission carries the hue at night; glTF emission cannot
read vertex colours).
"""
import math

from manor_lib import (GLASS, GLASS_BLUE, GLASS_GOLD, GLASS_RED, LAYER, METAL, PAL, STONE, flat_face, hashf,
                       tone)

PALE = (0.86, 0.78, 0.56)
GOLD = (0.9, 0.64, 0.16)
RED = (0.58, 0.09, 0.1)
BLUE = (0.12, 0.22, 0.62)
WHITE = (0.84, 0.84, 0.8)
LEAD = (0.12, 0.11, 0.1)
MAT = {PALE: GLASS, GOLD: GLASS_GOLD, RED: GLASS_RED, BLUE: GLASS_BLUE, WHITE: GLASS}

GLASS_W = 0.02          # the glass's faces, either side of the wall's middle
CAME_W = 0.045          # a came's width across the joint
CAME_D = 0.035          # how far a came stands proud of the glass under it


def _clip(poly, u0, u1, v0, v1):
    """A convex polygon clipped to a rectangle."""
    def cut(pts, inside, meet):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            if inside(p):
                out.append(p)
            if inside(p) != inside(q):
                out.append(meet(p, q))
        return out

    def at_u(u):
        return lambda p, q: (u, p[1] + (q[1] - p[1]) * (u - p[0]) / (q[0] - p[0]))

    def at_v(v):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (v - p[1]) / (q[1] - p[1]), v)
    pts = poly
    for inside, meet in ((lambda p: p[0] >= u0, at_u(u0)), (lambda p: p[0] <= u1, at_u(u1)),
                         (lambda p: p[1] >= v0, at_v(v0)), (lambda p: p[1] <= v1, at_v(v1))):
        if len(pts) < 3:
            return []
        pts = cut(pts, inside, meet)
    return pts if len(pts) >= 3 else []


def _area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts)))) / 2


class Leaded:
    """Panes and cames of one window on a wall, both faces."""

    def __init__(self, p_trim, glow, wall):
        self.p_trim, self.glow, self.wall = p_trim, glow, wall

    def pane(self, pts, col, layer=0, seed=0):
        if len(pts) < 3 or _area(pts) < 1e-4:
            return
        w = GLASS_W + layer * LAYER
        c = tone(col, seed, pts[0][0], spread=0.08)
        for s in (1, -1):
            flat_face(self.glow, [self.wall.pt(u, v, s * w) for (u, v) in pts], c, MAT[col],
                      (self.wall.nx * s, 0, self.wall.nz * s))

    def came(self, a, b, layer=0, width=CAME_W):
        """A lead strip along a joint, its back on the glass of `layer`, both faces."""
        if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02:
            return
        # a flat strip a came's depth proud of its glass (two triangles a face, where a boxed
        # came took twelve; crossing cames are one colour, so their overlaps draw alike)
        w = GLASS_W + layer * LAYER + CAME_D
        du, dv = b[0] - a[0], b[1] - a[1]
        n = math.hypot(du, dv)
        ou, ov = -dv / n * width / 2, du / n * width / 2
        quad = [(a[0] + ou, a[1] + ov), (b[0] + ou, b[1] + ov), (b[0] - ou, b[1] - ov), (a[0] - ou, a[1] - ov)]
        for s in (1, -1):
            flat_face(self.p_trim, [self.wall.pt(u, v, s * w) for (u, v) in quad], LEAD, METAL,
                      (self.wall.nx * s, 0, self.wall.nz * s))

    def outline(self, pts, layer=0, width=CAME_W):
        for i in range(len(pts)):
            self.came(pts[i], pts[(i + 1) % len(pts)], layer, width)


def _circle(cu, cv, r, n=24, a0=0.0, a1=math.tau):
    return [(cu + math.cos(a0 + (a1 - a0) * i / n) * r, cv + math.sin(a0 + (a1 - a0) * i / n) * r)
            for i in range(n + (0 if a1 - a0 >= math.tau - 1e-6 else 1))]


def lattice(L, u0, u1, v0, v1, seed=0, flower=True, hole=None):
    """Diamond quarries over a rectangle with their cames; gold flowers every few quarries.
    `hole` (cu, cv, r) keeps the cames out of a roundel laid over the lattice."""
    dx, dy = 0.5, 0.74
    row = 0
    v = v0 - dy / 2
    while v < v1 + dy / 2:
        off = (row % 2) * dx / 2
        u = u0 - dx + off
        col = 0
        while u < u1 + dx:
            pts = _clip([(u - dx / 2, v), (u, v - dy / 2), (u + dx / 2, v), (u, v + dy / 2)], u0, u1, v0, v1)
            k = int(hashf(row, col, seed) * 9)
            colour = GOLD if flower and (row + 2 * col) % 5 == 0 and k % 2 == 0 else PALE
            L.pane(pts, colour, seed=row * 31 + col)
            u += dx
            col += 1
        v += dy / 2
        row += 1
    # the cames: the lattice's two families of diagonals, clipped to the field, kept out of the
    # roundel, and the field's own frame
    slope = dy / dx
    for sgn in (1, -1):
        c = u0 - (v1 - v0) / slope - dx
        while c < u1 + (v1 - v0) / slope + dx:
            segs = _line_in_rect(c, sgn * slope, u0, u1, v0, v1, v0)
            for (a, b) in segs:
                for (pa, pb) in _outside_circle(a, b, hole):
                    L.came(pa, pb)
            c += dx
    L.outline([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def _line_in_rect(c, slope, u0, u1, v0, v1, vref):
    """The part of the line v = vref + slope * (u - c) inside the rectangle."""
    ts = []
    for u in (u0, u1):
        v = vref + slope * (u - c)
        if v0 - 1e-9 <= v <= v1 + 1e-9:
            ts.append((u, v))
    for v in (v0, v1):
        u = c + (v - vref) / slope
        if u0 - 1e-9 <= u <= u1 + 1e-9:
            ts.append((u, v))
    ts = sorted(set((round(a, 6), round(b, 6)) for (a, b) in ts))
    if len(ts) < 2:
        return []
    return [(ts[0], ts[-1])]


def _outside_circle(a, b, hole):
    if hole is None:
        return [(a, b)]
    cu, cv, r = hole
    r += 0.02
    du, dv = b[0] - a[0], b[1] - a[1]
    fu, fv = a[0] - cu, a[1] - cv
    A = du * du + dv * dv
    B = 2 * (fu * du + fv * dv)
    C = fu * fu + fv * fv - r * r
    disc = B * B - 4 * A * C
    if disc <= 0:
        return [(a, b)]
    t0 = (-B - math.sqrt(disc)) / (2 * A)
    t1 = (-B + math.sqrt(disc)) / (2 * A)
    out = []
    if t0 > 0:
        out.append((a, (a[0] + du * min(t0, 1), a[1] + dv * min(t0, 1))))
    if t1 < 1:
        out.append(((a[0] + du * max(t1, 0), a[1] + dv * max(t1, 0)), b))
    return [s for s in out if math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 0.02]


def border(L, u0, u1, v0, v1, band=0.16, seg=0.55):
    """A border round a lancet: blue and garnet lengths, their joints leaded."""
    strips = [((u0, v0), (u1, v0 + band)), ((u0, v1 - band), (u1, v1)),
              ((u0, v0 + band), (u0 + band, v1 - band)), ((u1 - band, v0 + band), (u1, v1 - band))]
    k = 0
    for ((a0, b0), (a1, b1)) in strips:
        along_u = a1 - a0 > b1 - b0
        length = (a1 - a0) if along_u else (b1 - b0)
        n = max(1, int(round(length / seg)))
        for i in range(n):
            if along_u:
                pa, pb = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
                pts = [(pa, b0), (pb, b0), (pb, b1), (pa, b1)]
            else:
                pa, pb = b0 + (b1 - b0) * i / n, b0 + (b1 - b0) * (i + 1) / n
                pts = [(a0, pa), (a1, pa), (a1, pb), (a0, pb)]
            L.pane(pts, BLUE if (i + k) % 2 == 0 else RED, seed=k * 7 + i)
            L.outline(pts)
        k += 1
    return u0 + band, u1 - band, v0 + band, v1 - band


def beacon_roundel(L, cu, cv, r):
    """The hold's beacon in a roundel over the lattice: a gold rim, a blue field, three snowy
    peaks side by side under a gold flame with a garnet heart. The rim, the field, the charges
    and the heart each lie a layer over the one under them; the charges never overlap each
    other, so they share one layer."""
    rim = _circle(cu, cv, r)
    field = _circle(cu, cv, r - 0.1)
    base = cv - r * 0.4
    peaks = [[(cu - r * 0.6, base), (cu - r * 0.24, base), (cu - r * 0.42, base + r * 0.48)],
             [(cu - r * 0.24, base), (cu + r * 0.24, base), (cu, base + r * 0.7)],
             [(cu + r * 0.24, base), (cu + r * 0.6, base), (cu + r * 0.42, base + r * 0.44)]]
    fy0, fy1 = cv + r * 0.34, cv + r * 0.7
    flame = [(cu, fy1), (cu + r * 0.12, fy0 + (fy1 - fy0) * 0.62), (cu + r * 0.16, fy0 + (fy1 - fy0) * 0.3),
             (cu + r * 0.08, fy0), (cu - r * 0.08, fy0), (cu - r * 0.16, fy0 + (fy1 - fy0) * 0.3),
             (cu - r * 0.12, fy0 + (fy1 - fy0) * 0.62)]
    fc = (cu, fy0 + (fy1 - fy0) * 0.38)
    heart = [(fc[0] + (x - fc[0]) * 0.42, fc[1] + (y - fc[1]) * 0.42) for (x, y) in flame]
    L.pane(rim, GOLD, layer=1)
    L.pane(field, BLUE, layer=2)
    for tri in peaks:
        L.pane(tri, WHITE, layer=3)
    L.pane(flame, GOLD, layer=3)
    L.pane(heart, RED, layer=4)
    L.outline(rim, layer=1)
    L.outline(field, layer=2, width=0.04)
    for tri in peaks:
        L.outline(tri, layer=3, width=0.035)
    L.outline(flame, layer=3, width=0.035)


def rose(L, um, spring, R):
    """The head's rose over the lancets: a gold heart, eight petals, a blue and gold rim."""
    r0, r1 = R * 0.24, R * 0.86
    heart = [(um, spring)] + [(um + math.cos(math.pi * i / 10) * r0, spring + math.sin(math.pi * i / 10) * r0)
                              for i in range(11)]
    L.pane(heart, GOLD)
    n = 8
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        inner = [(um + math.cos(a0 + (a1 - a0) * k / 3) * r0, spring + math.sin(a0 + (a1 - a0) * k / 3) * r0)
                 for k in range(4)]
        outer = [(um + math.cos(a1 - (a1 - a0) * k / 3) * r1, spring + math.sin(a1 - (a1 - a0) * k / 3) * r1)
                 for k in range(4)]
        L.pane(inner + outer, RED if i % 2 == 0 else GOLD, seed=i)
        L.came(inner[0], outer[-1])
        # a pale quarry set in each petal, a layer over it
        am = (a0 + a1) / 2
        rc = (r0 + r1) / 2
        q = [(um + math.cos(am) * (rc - 0.28), spring + math.sin(am) * (rc - 0.28)),
             (um + math.cos(am + 0.09) * rc, spring + math.sin(am + 0.09) * rc),
             (um + math.cos(am) * (rc + 0.28), spring + math.sin(am) * (rc + 0.28)),
             (um + math.cos(am - 0.09) * rc, spring + math.sin(am - 0.09) * rc)]
        L.pane(q, PALE if i % 2 == 0 else BLUE, layer=1, seed=i + 40)
        L.outline(q, layer=1, width=0.035)
    L.came((um - R, spring), (um + R, spring))
    m = 16
    for i in range(m):
        a0, a1 = math.pi * i / m, math.pi * (i + 1) / m
        pts = [(um + math.cos(a0) * r1, spring + math.sin(a0) * r1), (um + math.cos(a1) * r1, spring + math.sin(a1) * r1),
               (um + math.cos(a1) * R, spring + math.sin(a1) * R), (um + math.cos(a0) * R, spring + math.sin(a0) * R)]
        L.pane(pts, BLUE if i % 2 == 0 else GOLD, seed=i + 80)
        L.came(pts[0], pts[3])
    for rr in (r0, r1):
        arc = _circle(um, spring, rr, n=16, a0=0.0, a1=math.pi)
        for i in range(len(arc) - 1):
            L.came(arc[i], arc[i + 1])


def great_window(p, p_trim, glow, wall, u0, u1, v0, v1, t, tracery):
    """The bay's great window: three lancets and a rose (see the module's note). `tracery`
    lays the stone (mullions, the arch) the caller owns."""
    L = Leaded(p_trim, glow, wall)
    um = (u0 + u1) / 2
    w = u1 - u0
    spring = v1 - w / 2
    mull = 0.24
    edges = [u0, u0 + w / 3 - mull / 2, u0 + w / 3 + mull / 2, u0 + 2 * w / 3 - mull / 2, u0 + 2 * w / 3 + mull / 2,
             u1]
    lancets = [(edges[0], edges[1]), (edges[2], edges[3]), (edges[4], edges[5])]
    for i, (a, b) in enumerate(lancets):
        fu0, fu1, fv0, fv1 = border(L, a, b, v0, spring)
        if i == 1:
            cu, cv = (a + b) / 2, v0 + (spring - v0) * 0.56
            r = (fu1 - fu0) / 2 - 0.04
            lattice(L, fu0, fu1, fv0, fv1, seed=i, flower=False, hole=(cu, cv, r))
            beacon_roundel(L, cu, cv, r)
        else:
            lattice(L, fu0, fu1, fv0, fv1, seed=i)
    rose(L, um, spring, w / 2)
    tracery(mull)


def chapel_window(p_trim, glow, wall, u0, u1, v0, v1):
    """The chapel's window: one lancet, a sun over a single peak in a roundel, a lattice, a
    half rose of gold and blue in the head."""
    L = Leaded(p_trim, glow, wall)
    um = (u0 + u1) / 2
    w = u1 - u0
    spring = v1 - w / 2
    fu0, fu1, fv0, fv1 = border(L, u0, u1, v0, spring, band=0.13, seg=0.45)
    cu, cv, r = um, v0 + (spring - v0) * 0.55, (fu1 - fu0) / 2 - 0.04
    lattice(L, fu0, fu1, fv0, fv1, seed=9, flower=False, hole=(cu, cv, r))
    L.pane(_circle(cu, cv, r), GOLD, layer=1)
    L.pane(_circle(cu, cv, r - 0.08), BLUE, layer=2)
    peak = [(cu - r * 0.55, cv - r * 0.42), (cu + r * 0.55, cv - r * 0.42), (cu, cv + r * 0.22)]
    L.pane(peak, WHITE, layer=3)
    sun = [(cu + math.cos(math.tau * i / 16) * (r * (0.2 if i % 2 else 0.12)),
            cv + r * 0.48 + math.sin(math.tau * i / 16) * (r * (0.2 if i % 2 else 0.12))) for i in range(16)]
    L.pane(sun, GOLD, layer=3)
    L.outline(_circle(cu, cv, r), layer=1)
    L.outline(_circle(cu, cv, r - 0.08), layer=2, width=0.035)
    L.outline(peak, layer=3, width=0.03)
    n = 8
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        R = w / 2
        pts = [(um, spring), (um + math.cos(a0) * R, spring + math.sin(a0) * R),
               (um + math.cos(a1) * R, spring + math.sin(a1) * R)]
        L.pane(pts, GOLD if i % 2 else BLUE, seed=i)
        L.came((um, spring), pts[1])
    L.came((u0, spring), (u1, spring))
    arc = _circle(um, spring, w / 2, n=12, a0=0.0, a1=math.pi)
    for i in range(len(arc) - 1):
        L.came(arc[i], arc[i + 1])
    _ = (PAL, STONE)
