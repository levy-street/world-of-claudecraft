"""The Highwatch manor's shell: the walls, floors, roofs, porch, dais bay, wings, the hearth
with its copper hood, the lantern on the ridge, the crest over the porch.

Parts (build_manor.py makes them): ManorShell (the walls and floors), ManorRoof (the slate and
everything above the plates outside), ManorTimber (the open roof's trusses inside the hall),
ManorTrim (gold, iron and the carved crest) and ManorGlow (lit glass).
"""
import math

from manor_lib import (GLASS, GLOW, GLOW_LANTERN, GLOW_SOFT, LAYER, METAL, PAL, PLASTER, SLATE, STONE, WOOD, Wall, abox, cbox, cyl, disc,
                       flat_face, hashf, hexa, manor_wall, opening_spans, pick, slate_roof, tone, window)
from manor_plan import (ARCH_DAIS, ARCH_SIDE, BAY, CHAPEL, CHAPEL_DOOR, COLUMN_R, COLUMNS, DAIS,
                        DAIS_FRONT, DOOR, EAST, EAVE_OUT, FLOOR, FOOT, HALL, HALL_PITCH, HATCH, HEARTH,
                        HOOD, KITCHEN, KITCHEN_DOOR, LANTERN, PORCH, SIDE_DOOR_H, STEPS, VERGE_OUT, WEST,
                        WING_T)
from shiplib import P
from manor_glass import chapel_window, great_window

H = HALL
STONE_TO = FLOOR + 3.6   # the ashlar storey under the plaster and timber


# ---------------------------------------------------------------------------
# Small pieces
# ---------------------------------------------------------------------------
def arch_ring(p, wall, u0, u1, spring, t, color=None, n=7, depth=0.3, key=True):
    """A dressed-stone round arch over an opening (u0..u1) springing at `spring`, on both
    faces, with the stone between the arch and the square head the opening was cut to; the
    keystone gilded."""
    um, r = (u0 + u1) / 2, (u1 - u0) / 2
    half = t / 2
    color = color or PAL['ashlar_hi']
    head = spring + r
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        c0, c1, s0, s1 = math.cos(a0), math.cos(a1), math.sin(a0), math.sin(a1)
        # the spandrel slice between the arc and the square head, through the wall
        xa, xb = um - c0 * r, um - c1 * r
        ya, yb = spring + s0 * r, spring + s1 * r
        pts = [wall.pt(xa, ya, -half), wall.pt(xb, yb, -half), wall.pt(xb, yb, half), wall.pt(xa, ya, half),
               wall.pt(xa, head, -half), wall.pt(xb, head, -half), wall.pt(xb, head, half), wall.pt(xa, head, half)]
        hexa(p, pts, tone(PAL['ashlar'][2], i, u0), STONE)
        # the voussoirs on each face
        for s in (1, -1):
            wa, wb = (half - 0.02, half + depth / 2) if s > 0 else (-half - depth / 2, -half + 0.02)
            r0, r1 = r, r + 0.42
            pts = [wall.pt(um - c0 * r0, spring + s0 * r0, wa), wall.pt(um - c1 * r0, spring + s1 * r0, wa),
                   wall.pt(um - c1 * r1, spring + s1 * r1, wa), wall.pt(um - c0 * r1, spring + s0 * r1, wa),
                   wall.pt(um - c0 * r0, spring + s0 * r0, wb), wall.pt(um - c1 * r0, spring + s1 * r0, wb),
                   wall.pt(um - c1 * r1, spring + s1 * r1, wb), wall.pt(um - c0 * r1, spring + s0 * r1, wb)]
            is_key = key and i == n // 2
            hexa(p, pts, PAL['gold'] if is_key else tone(color, i, s, u0), METAL if is_key else STONE)
    # the jambs' dressed quoins and the imposts the arch springs from
    for s in (1, -1):
        wa, wb = (half - 0.02, half + depth / 2) if s > 0 else (-half - depth / 2, -half + 0.02)
        for (ua, ub) in ((u0 - 0.42, u0), (u1, u1 + 0.42)):
            v = FLOOR
            k = 0
            while v < spring - 0.05:
                v1 = min(spring, v + 1.0)
                wide = 0.12 if k % 2 else 0.0
                wall.box(p, ua - (wide if ua < u0 else 0), ub + (wide if ub > u1 else 0), v + 0.02, v1 - 0.02,
                         wa, wb, tone(color, ua, v), STONE)
                v = v1
                k += 1
            wall.box(p, ua - 0.08, ub + 0.08, spring - 0.12, spring + 0.08, wa - 0.03, wb + 0.03,
                     PAL['ashlar_hi'], STONE)
    return head


def flag_floor(p, x0, x1, z0, z1, y, size=1.9, seed=0, colors=None):
    """A flagstone floor: a mortar bed and dressed slabs a hair proud of it, staggered rows."""
    colors = colors or PAL['flag']
    flat_face(p, [(x0, y - LAYER, z0), (x1, y - LAYER, z0), (x1, y - LAYER, z1), (x0, y - LAYER, z1)], PAL['mortar'],
              STONE, (0, 1, 0))
    z = z0
    row = 0
    while z < z1 - 0.05:
        zb = min(z1, z + size * (0.8 + 0.3 * hashf(row, seed)))
        x = x0 - (size * 0.5 if row % 2 else 0.0)
        j = 0
        while x < x1 - 0.05:
            xb = min(x1, x + size * (0.85 + 0.35 * hashf(row, j, seed)))
            xa = max(x0, x)
            if xb - xa > 0.15:
                col = tone(pick(colors, int(hashf(row, j, seed + 3) * 4)), row, j, seed, spread=0.16)
                flat_face(p, [(xa + 0.035, y, z + 0.035), (xb - 0.035, y, z + 0.035), (xb - 0.035, y, zb - 0.035),
                              (xa + 0.035, y, zb - 0.035)], col, STONE, (0, 1, 0))
            x = xb
            j += 1
        z = zb
        row += 1


def board_floor(p, x0, x1, z0, z1, y, along='z', width=0.42, seed=0):
    """Oak boards: strips with a dark joint between, their butt joints staggered."""
    flat_face(p, [(x0, y - LAYER, z0), (x1, y - LAYER, z0), (x1, y - LAYER, z1), (x0, y - LAYER, z1)],
              PAL['walnut'], WOOD, (0, 1, 0))
    a0, a1, b0, b1 = (x0, x1, z0, z1) if along == 'z' else (z0, z1, x0, x1)
    a = a0
    k = 0
    while a < a1 - 0.05:
        ab = min(a1, a + width)
        b = b0 - (hashf(k, seed) * 3.0)
        j = 0
        while b < b1 - 0.05:
            bb = min(b1, b + 3.2 + 1.6 * hashf(k, j, seed))
            ba = max(b0, b)
            col = tone(pick(PAL['board'], k + j), k, j, seed, spread=0.14)
            if along == 'z':
                quad = [(a + 0.02, y, ba + 0.02), (ab - 0.02, y, ba + 0.02), (ab - 0.02, y, bb - 0.02),
                        (a + 0.02, y, bb - 0.02)]
            else:
                quad = [(ba + 0.02, y, a + 0.02), (bb - 0.02, y, a + 0.02), (bb - 0.02, y, ab - 0.02),
                        (ba + 0.02, y, ab - 0.02)]
            flat_face(p, quad, col, WOOD, (0, 1, 0))
            b = bb
            j += 1
        a = ab
        k += 1


def wainscot(p, wall, t, u0, u1, top=FLOOR + 2.6, panel=1.6, side=-1):
    """Oak panelling on a wall's inner face from the floor to `top`: a rail, stiles and a cap."""
    half = t / 2
    w0 = side * (half + 0.02)
    w1 = side * (half + 0.12)
    wall.box(p, u0, u1, FLOOR, top, w0, w1, PAL['oak'][1], WOOD)
    wall.box(p, u0, u1, top - 0.08, top + 0.06, w0, side * (half + 0.2), PAL['oak_dark'], WOOD)
    wall.box(p, u0, u1, FLOOR, FLOOR + 0.22, w0, side * (half + 0.16), PAL['oak_dark'], WOOD)
    n = max(1, int((u1 - u0) / panel))
    for k in range(n + 1):
        u = u0 + (u1 - u0) * k / n
        wall.box(p, max(u0, u - 0.07), min(u1, u + 0.07), FLOOR + 0.22, top - 0.08, w0,
                 side * (half + 0.17), PAL['oak_dark'], WOOD)


def hip_roof(p, x0, x1, z0, z1, plate, pitch, ridge_axis, hips=(True, True), seed=0, out=0.8,
             clip_end=None, under=False):
    """A slate roof over the wall box x0..x1, z0..z1 with its eaves `out` past the walls, its
    ridge along `ridge_axis` ('x' or 'z'). `hips` hips the low and high ends of the ridge (an
    end left unhipped stops square against a wall, a gable or a host roof). Returns the ridge
    height and its ends. `clip_end(a, s0, s1, slope)` may trim a course further."""
    ex0, ex1, ez0, ez1 = x0 - out, x1 + out, z0 - out, z1 + out
    if ridge_axis == 'x':
        span = (ez1 - ez0) / 2
        run = span
        ridge = plate - pitch * out + pitch * span
        mid = (ez0 + ez1) / 2
        L = ex1 - ex0
    else:
        span = (ex1 - ex0) / 2
        run = span
        ridge = plate - pitch * out + pitch * span
        mid = (ex0 + ex1) / 2
        L = ez1 - ez0
    eave_y = plate - pitch * out
    slope_len = math.hypot(run, ridge - eave_y)
    cosr = run / slope_len

    def course_clip(la, lo_end, hi_end):
        def f(s0, s1):
            # the hips eat the course at its far edge (s1: the narrower) so slates stay under the hip
            inset = s1 * cosr
            a0 = inset if lo_end else 0.0
            a1 = la - inset if hi_end else la
            if a1 - a0 < 0.1:
                return None
            return [(a0, a1)]
        return f

    def run_slope(e0, along, up, la, lo_end, hi_end, sd):
        slate_roof(p, e0, along, up, la, slope_len, seed=seed + sd,
                   clip=course_clip(la, lo_end, hi_end), under=under)

    if ridge_axis == 'x':
        h = (ridge - eave_y) / slope_len
        c = run / slope_len
        # south slope (eave at ez0) and north slope
        run_slope((ex0, eave_y, ez0), (1, 0, 0), (0, h, c), L, hips[0], hips[1], 0)
        run_slope((ex1, eave_y, ez1), (-1, 0, 0), (0, h, -c), L, hips[1], hips[0], 1)
        if hips[0]:
            run_slope((ex0, eave_y, ez1), (0, 0, -1), (c, h, 0), ez1 - ez0, True, True, 2)
        if hips[1]:
            run_slope((ex1, eave_y, ez0), (0, 0, 1), (-c, h, 0), ez1 - ez0, True, True, 3)
        r0 = ex0 + run if hips[0] else ex0
        r1 = ex1 - run if hips[1] else ex1
        p.beam([(r0, ridge + 0.1, mid), (r1, ridge + 0.1, mid)], 0.34, 0.26, PAL['slate_ridge'], SLATE)
        ends = [(r0, ridge, mid), (r1, ridge, mid)]
        # the hips' cappings
        if hips[0]:
            for zz in (ez0, ez1):
                p.beam([(ex0, eave_y + 0.12, zz), (r0, ridge + 0.1, mid)], 0.26, 0.2, PAL['slate_ridge'], SLATE)
        if hips[1]:
            for zz in (ez0, ez1):
                p.beam([(ex1, eave_y + 0.12, zz), (r1, ridge + 0.1, mid)], 0.26, 0.2, PAL['slate_ridge'], SLATE)
    else:
        h = (ridge - eave_y) / slope_len
        c = run / slope_len
        run_slope((ex1, eave_y, ez0), (0, 0, 1), (-c, h, 0), L, hips[0], hips[1], 0)
        run_slope((ex0, eave_y, ez1), (0, 0, -1), (c, h, 0), L, hips[1], hips[0], 1)
        if hips[0]:
            run_slope((ex0, eave_y, ez0), (1, 0, 0), (0, h, c), ex1 - ex0, True, True, 2)
        if hips[1]:
            run_slope((ex1, eave_y, ez1), (-1, 0, 0), (0, h, -c), ex1 - ex0, True, True, 3)
        r0 = ez0 + run if hips[0] else ez0
        r1 = ez1 - run if hips[1] else ez1
        p.beam([(mid, ridge + 0.1, r0), (mid, ridge + 0.1, r1)], 0.34, 0.26, PAL['slate_ridge'], SLATE)
        ends = [(mid, ridge, r0), (mid, ridge, r1)]
        if hips[0]:
            for xx in (ex0, ex1):
                p.beam([(xx, eave_y + 0.12, ez0), (mid, ridge + 0.1, r0)], 0.26, 0.2, PAL['slate_ridge'], SLATE)
        if hips[1]:
            for xx in (ex0, ex1):
                p.beam([(xx, eave_y + 0.12, ez1), (mid, ridge + 0.1, r1)], 0.26, 0.2, PAL['slate_ridge'], SLATE)
    # gilded finials on the hipped ends of the ridge
    for (end, on) in zip(ends, hips):
        if on:
            finial(p, end[0], end[1] + 0.2, end[2], h=1.2, r=0.16)
    # timber corbels under the eaves along the open sides, chamfered, a stepped pair each
    if ridge_axis == 'x':
        for (zw, sz) in ((z0, -1), (z1, 1)):
            x = x0 + 0.9
            while x < x1 - 0.8:
                zo = zw + sz * (out - 0.18)
                abox(p, x - 0.12, x + 0.12, plate - 0.62, plate - 0.2, min(zw, zo), max(zw, zo), PAL['timber_dark'],
                     WOOD, bevel=0.03)
                zl = zw + sz * (out - 0.45)
                abox(p, x - 0.08, x + 0.08, plate - 0.95, plate - 0.62, min(zw, zl), max(zw, zl), PAL['timber_dark'],
                     WOOD, bevel=0.02)
                x += 1.7
    # the eaves' fascia boards round the open sides
    fy = eave_y - 0.18
    if ridge_axis == 'x':
        for zz in (ez0, ez1):
            abox(p, ex0, ex1, fy - 0.16, fy + 0.12, zz - 0.06, zz + 0.06, PAL['timber'], WOOD)
        for (xx, on) in ((ex0, hips[0]), (ex1, hips[1])):
            if on:
                abox(p, xx - 0.06, xx + 0.06, fy - 0.16, fy + 0.12, ez0, ez1, PAL['timber'], WOOD)
    else:
        for xx in (ex0, ex1):
            abox(p, xx - 0.06, xx + 0.06, fy - 0.16, fy + 0.12, ez0, ez1, PAL['timber'], WOOD)
        for (zz, on) in ((ez0, hips[0]), (ez1, hips[1])):
            if on:
                abox(p, ex0, ex1, fy - 0.16, fy + 0.12, zz - 0.06, zz + 0.06, PAL['timber'], WOOD)
    return ridge, ends


def finial(p, x, y, z, h=1.4, r=0.16):
    """A gilded finial: a turned stem, a ball, a spike."""
    cyl(p, x, y, y + h * 0.55, z, r * 0.6, PAL['gold_dark'], METAL, sides=8, r1=r * 0.45)
    p.prism((x, y + h * 0.55, z), 8, r, r * 0.2, h * 0.25, PAL['gold'], METAL, axis=(0, 1, 0))
    p.prism((x, y + h * 0.55, z), 8, r, r * 0.95, -0.0001, PAL['gold'], METAL, axis=(0, 1, 0))
    cyl(p, x, y + h * 0.78, y + h, z, 0.05, PAL['gold'], METAL, sides=6, r1=0.01)


# ---------------------------------------------------------------------------
# The great hall
# ---------------------------------------------------------------------------
def hall_walls(p, glow):
    t = H['t']
    plate = H['plate']
    flat = lambda u: plate  # noqa: E731
    # the front wall, west to east along u = x + 13.9 (its outer face south)
    zc = (H['oz0'] + H['z0']) / 2
    front = Wall(H['ox0'], zc, H['ox1'], zc, (0, -1))
    U = lambda x: x - H['ox0']  # noqa: E731
    win = []
    for x in (-10.4, 10.4):
        win.append((U(x) - 1.2, U(x) + 1.2, FLOOR + 3.0, FLOOR + 9.2))
    for x in (-4.3, 4.3):
        win.append((U(x) - 0.85, U(x) + 0.85, FLOOR + 2.2, FLOOR + 5.9))
    door = (U(DOOR['x0']), U(DOOR['x1']), FLOOR, DOOR['head'])
    manor_wall(p, front, t, flat, win + [door], plinth=STONE_TO, seed=1)
    for (u0, u1, v0, v1) in win:
        window(p, front, u0, u1, v0, v1, t, lit=True, arch=True, bars=3 if v1 - v0 > 5 else 2)
    door_frame(p, front, U(DOOR['x0']), U(DOOR['x1']), t)
    wainscot(p, front, t, 0.9, U(DOOR['x0']) - 0.4)
    wainscot(p, front, t, U(DOOR['x1']) + 0.4, front.length - 0.9)
    # the back wall, its outer face north, the arch to the dais in its middle
    zc = (H['z1'] + H['oz1']) / 2
    back = Wall(H['ox0'], zc, H['ox1'], zc, (0, 1))
    spring = ARCH_DAIS['head'] - (ARCH_DAIS['x1'] - ARCH_DAIS['x0']) / 2
    arch = (U(ARCH_DAIS['x0']), U(ARCH_DAIS['x1']), FLOOR, ARCH_DAIS['head'])
    bwin = [(U(x) - 1.2, U(x) + 1.2, FLOOR + 3.0, FLOOR + 9.2) for x in (-9.6, 9.6)]
    manor_wall(p, back, t, flat, bwin + [arch], plinth=STONE_TO, seed=2)
    for (u0, u1, v0, v1) in bwin:
        window(p, back, u0, u1, v0, v1, t, lit=True, arch=True, bars=3)
    arch_ring(p, back, arch[0], arch[1], spring, t, n=9)
    wainscot(p, back, t, 0.9, arch[0] - 0.5)
    wainscot(p, back, t, arch[1] + 0.5, back.length - 0.9)
    # the gable walls (west +x and east -x), the arch into each wing, an oculus over the wing roof
    for sx in (1, -1):
        xc = sx * (H['x1'] + H['t'] / 2)
        g = Wall(xc, H['oz0'], xc, H['oz1'], (sx, 0))
        Z = lambda z: z - H['oz0']  # noqa: E731
        top = lambda u: H['plate'] + HALL_PITCH * (H['oz1'] - abs(u + H['oz0']))  # noqa: E731
        span = ARCH_SIDE['z1'] - ARCH_SIDE['z0']
        spring = ARCH_SIDE['head'] - span / 2
        arch = (Z(ARCH_SIDE['z0']), Z(ARCH_SIDE['z1']), FLOOR, ARCH_SIDE['head'])
        oc = (Z(-1.3), Z(1.3), FLOOR + 15.0, FLOOR + 17.6)
        # the wing's roof covers this face to about 15 yd: the outer frame starts above it
        manor_wall(p, g, t, top, [arch, oc], plinth=STONE_TO, seed=3 + sx,
                   rails=[STONE_TO + 0.12, FLOOR + 8.0, H['plate'] - 0.21, FLOOR + 14.6])
        arch_ring(p, g, arch[0], arch[1], spring, t, n=7)
        oculus(p, g, (oc[0] + oc[1]) / 2, (oc[2] + oc[3]) / 2, 1.3, t, glow)
        wainscot(p, g, t, 0.9, arch[0] - 0.5)
        wainscot(p, g, t, arch[1] + 0.5, g.length - 0.9)
    # pilasters inside under each truss, on corbels
    for x in TRUSS_X:
        for sz in (1, -1):
            zf = sz * (H['z1'] - 0.02)
            abox(p, x - 0.32, x + 0.32, FLOOR + 2.6, H['plate'], min(zf, zf - sz * 0.22), max(zf, zf - sz * 0.22),
                 PAL['oak_dark'], WOOD)
            abox(p, x - 0.42, x + 0.42, FLOOR + 2.5, FLOOR + 2.8, min(zf, zf - sz * 0.3), max(zf, zf - sz * 0.3),
                 PAL['ashlar_hi'], STONE)


def oculus(p, wall, uc, vc, r, t, glow):
    """A round window: a stone ring and a quatrefoil of lit glass."""
    half = t / 2
    n = 14
    for i in range(n):
        a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
        for (ra, rb, col, mat, w0, w1) in ((r, r + 0.38, PAL['ashlar_hi'], STONE, -half - 0.08, half + 0.12),):
            pts = [wall.pt(uc + math.cos(a0) * ra, vc + math.sin(a0) * ra, w0),
                   wall.pt(uc + math.cos(a1) * ra, vc + math.sin(a1) * ra, w0),
                   wall.pt(uc + math.cos(a1) * rb, vc + math.sin(a1) * rb, w0),
                   wall.pt(uc + math.cos(a0) * rb, vc + math.sin(a0) * rb, w0),
                   wall.pt(uc + math.cos(a0) * ra, vc + math.sin(a0) * ra, w1),
                   wall.pt(uc + math.cos(a1) * ra, vc + math.sin(a1) * ra, w1),
                   wall.pt(uc + math.cos(a1) * rb, vc + math.sin(a1) * rb, w1),
                   wall.pt(uc + math.cos(a0) * rb, vc + math.sin(a0) * rb, w1)]
            hexa(p, pts, col, mat)
        # the glass disc, a slice at a time, through the square cut
        pts = [wall.pt(uc, vc, -0.03), wall.pt(uc + math.cos(a0) * r, vc + math.sin(a0) * r, -0.03),
               wall.pt(uc + math.cos(a1) * r, vc + math.sin(a1) * r, -0.03), wall.pt(uc, vc, -0.03),
               wall.pt(uc, vc, 0.03), wall.pt(uc + math.cos(a0) * r, vc + math.sin(a0) * r, 0.03),
               wall.pt(uc + math.cos(a1) * r, vc + math.sin(a1) * r, 0.03), wall.pt(uc, vc, 0.03)]
        hexa(glow, pts, PAL['glass_lit'], GLOW_SOFT)
        # the stone filling the square cut round the disc
        ca, sa = math.cos(a0), math.sin(a0)
        cb, sb = math.cos(a1), math.sin(a1)
        sq = r + 0.02

        def edge(c, s):
            k = sq / max(abs(c), abs(s))
            return c * k, s * k
        ea, eb = edge(ca, sa), edge(cb, sb)
        # (recessed a layer from both of the wall's plaster faces)
        fi, fo = -half + LAYER, half - 0.05 - LAYER
        pts = [wall.pt(uc + ca * r, vc + sa * r, fi), wall.pt(uc + cb * r, vc + sb * r, fi),
               wall.pt(uc + eb[0], vc + eb[1], fi), wall.pt(uc + ea[0], vc + ea[1], fi),
               wall.pt(uc + ca * r, vc + sa * r, fo), wall.pt(uc + cb * r, vc + sb * r, fo),
               wall.pt(uc + eb[0], vc + eb[1], fo), wall.pt(uc + ea[0], vc + ea[1], fo)]
        hexa(p, pts, pick(PAL['plaster'], i), PLASTER)
    # the quatrefoil tracery
    lead = (0.15, 0.14, 0.13)
    wall.box(p, uc - 0.05, uc + 0.05, vc - r, vc + r, -0.06, 0.06, lead, METAL)
    wall.box(p, uc - r, uc + r, vc - 0.05, vc + 0.05, -0.06, 0.06, lead, METAL)


def door_frame(p, wall, u0, u1, t):
    """The great door: a dressed stone surround, a heavy lintel, a carved tympanum with a gilded
    sunburst over it, and the two oak leaves standing open inside against the wall."""
    half = t / 2
    head = DOOR['head']
    width = u1 - u0
    um = (u0 + u1) / 2
    for s in (1, -1):
        wa, wb = (half - 0.02, half + 0.22) if s > 0 else (-half - 0.16, -half + 0.02)
        # jambs: big quoins, alternately long and short
        # (a layer into the opening, so a quoin's face never lies on the wall core's reveal)
        for (ua, ub, out) in ((u0 - 0.5, u0 + LAYER, -1), (u1 - LAYER, u1 + 0.5, 1)):
            v = FLOOR
            k = 0
            while v < head - 0.05:
                v1 = min(head, v + 0.8)
                ext = 0.22 if k % 2 == 0 else 0.0
                a = ua - (ext if out < 0 else 0)
                b = ub + (ext if out > 0 else 0)
                wall.box(p, a, b, v + 0.02, v1 - 0.02, wa, wb, tone(PAL['ashlar_hi'], v, out), STONE)
                v = v1
                k += 1
        # the lintel
        wall.box(p, u0 - 0.7, u1 + 0.7, head - LAYER, head + 0.7, wa, wb + (0.06 if s > 0 else 0), PAL['ashlar_hi'], STONE)
    # the tympanum: a half disc of dressed stone over the lintel, a gilded sunburst on it (outside)
    r = width / 2 + 0.5
    n = 10
    base = head + 0.7
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        pts = [wall.pt(um, base, half - 0.02), wall.pt(um - math.cos(a0) * r, base + math.sin(a0) * r, half - 0.02),
               wall.pt(um - math.cos(a1) * r, base + math.sin(a1) * r, half - 0.02), wall.pt(um, base, half - 0.02),
               wall.pt(um, base, half + 0.16), wall.pt(um - math.cos(a0) * r, base + math.sin(a0) * r, half + 0.16),
               wall.pt(um - math.cos(a1) * r, base + math.sin(a1) * r, half + 0.16), wall.pt(um, base, half + 0.16)]
        hexa(p, pts, tone(PAL['ashlar_hi'], i, 9), STONE)
        # the moulding round its rim
        r0, r1 = r, r + 0.24
        pts = [wall.pt(um - math.cos(a0) * r0, base + math.sin(a0) * r0, half), wall.pt(um - math.cos(a1) * r0, base + math.sin(a1) * r0, half),
               wall.pt(um - math.cos(a1) * r1, base + math.sin(a1) * r1, half), wall.pt(um - math.cos(a0) * r1, base + math.sin(a0) * r1, half),
               wall.pt(um - math.cos(a0) * r0, base + math.sin(a0) * r0, half + 0.26), wall.pt(um - math.cos(a1) * r0, base + math.sin(a1) * r0, half + 0.26),
               wall.pt(um - math.cos(a1) * r1, base + math.sin(a1) * r1, half + 0.26), wall.pt(um - math.cos(a0) * r1, base + math.sin(a0) * r1, half + 0.26)]
        hexa(p, pts, PAL['gold_dark'], METAL)
        # the sunburst's rays
        am = (a0 + a1) / 2
        ra, rb = 0.45, r - 0.25
        pts = [wall.pt(um - math.cos(am - 0.06) * ra, base + math.sin(am - 0.06) * ra, half + 0.16),
               wall.pt(um - math.cos(am + 0.06) * ra, base + math.sin(am + 0.06) * ra, half + 0.16),
               wall.pt(um - math.cos(am) * rb, base + math.sin(am) * rb, half + 0.16),
               wall.pt(um - math.cos(am) * rb, base + math.sin(am) * rb, half + 0.16),
               wall.pt(um - math.cos(am - 0.06) * ra, base + math.sin(am - 0.06) * ra, half + 0.24),
               wall.pt(um - math.cos(am + 0.06) * ra, base + math.sin(am + 0.06) * ra, half + 0.24),
               wall.pt(um - math.cos(am) * rb, base + math.sin(am) * rb, half + 0.2),
               wall.pt(um - math.cos(am) * rb, base + math.sin(am) * rb, half + 0.2)]
        hexa(p, pts, PAL['gold'], METAL)
    cyl_on_wall(p, wall, um, base + 0.05, half + 0.16, 0.42, 0.14)
    # the oak leaves, swung open against the inner face
    for side, (hinge, sgn) in enumerate(((u0, -1), (u1, 1))):
        lw = width / 2
        # the leaf stands at right angles to the wall, along -w (inward), at the jamb
        a = wall.pt(hinge + sgn * 0.12, FLOOR + 0.05, -half - 0.05)
        b = wall.pt(hinge + sgn * 0.12, FLOOR + 0.05, -half - 0.05 - lw)
        for k in range(5):
            f0, f1 = k / 5, (k + 1) / 5
            pa = (a[0] + (b[0] - a[0]) * f0, a[2] + (b[2] - a[2]) * f0)
            pb = (a[0] + (b[0] - a[0]) * f1, a[2] + (b[2] - a[2]) * f1)
            cx, cz = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            yaw = math.atan2(-wall.nx, -wall.nz)
            cbox(p, cx + wall.dx * sgn * 0.0, (FLOOR + head) / 2, cz, 0.16, head - FLOOR - 0.1, lw / 5 - 0.02,
                 tone(PAL['oak'][0], k, side), WOOD, yaw=yaw)
        for vv in (FLOOR + 0.9, (FLOOR + head) / 2, head - 0.9):
            mx, mz = (a[0] + b[0]) / 2, (a[2] + b[2]) / 2
            cbox(p, mx + wall.dx * sgn * 0.11, vv, mz, 0.05, 0.16, lw * 0.92, PAL['iron'], METAL,
                 yaw=math.atan2(-wall.nx, -wall.nz))
        # the great ring pull
        rx, rz = a[0] + (b[0] - a[0]) * 0.85, a[2] + (b[2] - a[2]) * 0.85
        p.ring((rx + wall.dx * sgn * 0.14, FLOOR + 2.4, rz), 0.22, 0.05, PAL['gold'], 10, axis=(wall.dx, 0, wall.dz),
               mat=METAL)
    # the threshold
    wall.box(p, u0, u1, FLOOR - 0.06, FLOOR + 0.04, -half, half + 0.1, PAL['ashlar_hi'], STONE)


def cyl_on_wall(p, wall, u, v, w, r, depth):
    """A boss on a wall face: a short cylinder along the wall's normal."""
    a = wall.pt(u, v, w)
    b = wall.pt(u, v, w + depth)
    p.cylinder(a, b, r, PAL['gold'], METAL, sides=10, r1=r * 0.8)


TRUSS_X = (-9.75, -3.25, 3.25, 9.75)


def hall_roof(p_roof, p_timber, glow):
    """The great roof: two slate slopes on a ridge along x from gable to gable, the lantern's
    drum straddling the ridge over the hearth, the porch's and the bay's cross gables let into
    it, and inside, the open timber roof: four arch-braced hammer-beam trusses, purlins and a
    ridge beam, every member above the truss line."""
    plate, ridge = H['plate'], H['ridge']
    ez = H['oz1'] + EAVE_OUT
    eave_y = plate - HALL_PITCH * EAVE_OUT
    ex0, ex1 = H['ox0'] - VERGE_OUT, H['ox1'] + VERGE_OUT
    run = ez
    slope = math.hypot(run, ridge - eave_y)
    h, c = (ridge - eave_y) / slope, run / slope
    lr = LANTERN['r'] * 0.6   # the slates' cut, well inside the drum
    wl = LANTERN['r'] * 0.8   # the light well's opening, inside the drum's lining
    porch_ridge = PORCH['ridge']
    porch_pitch = (porch_ridge - PORCH['beam'] - 0.8) / (PORCH['x1'] + 0.6)
    bay_ridge = BAY_RIDGE
    bay_pitch = BAY_PITCH

    def clip_for(north):
        def f(s0, s1):
            # height and z of this course (its lower and upper edges)
            y_lo = eave_y + h * s0
            y_hi = eave_y + h * s1
            z_hi = ez - c * s1
            spans = [(0.0, ex1 - ex0)]
            cut = []
            # the lantern's drum sits over the ridge's middle
            if z_hi < lr:
                cut.append((-ex0 - lr, -ex0 + lr))
            # a cross gable covers the courses lower than its own roof
            if not north:
                yy = y_lo
                half = (porch_ridge - yy) / porch_pitch if porch_pitch > 0 else 0
                if half > 0:
                    cut.append((-ex0 - half + 0.15, -ex0 + half - 0.15))
            else:
                yy = y_lo
                half = (bay_ridge - yy) / bay_pitch
                if half > 0:
                    cut.append((-ex0 - half + 0.15, -ex0 + half - 0.15))
            for (a, b) in sorted(cut):
                nxt = []
                for (lo, hi) in spans:
                    if b <= lo or a >= hi:
                        nxt.append((lo, hi))
                        continue
                    if a > lo:
                        nxt.append((lo, a))
                    if b < hi:
                        nxt.append((b, hi))
                spans = nxt
            return [s for s in spans if s[1] - s[0] > 0.1] or None
        return f

    slate_roof(p_roof, (ex0, eave_y, -ez), (1, 0, 0), (0, h, c), ex1 - ex0, slope, seed=11,
               clip=clip_for(False), under=False)
    # the cuts are symmetric about the ridge's middle, so the north slope (laid from the west
    # gable) reads the same spans
    slate_roof(p_roof, (ex1, eave_y, ez), (-1, 0, 0), (0, h, -c), ex1 - ex0, slope, seed=12,
               clip=clip_for(True), under=False)
    # the ridge capping either side of the lantern, gold finials at the gables
    for (a, b) in ((ex0, -LANTERN['r']), (LANTERN['r'], ex1)):
        p_roof.beam([(a, ridge + 0.12, 0), (b, ridge + 0.12, 0)], 0.4, 0.3, PAL['slate_ridge'], SLATE)
    for x in (ex0 + 0.1, ex1 - 0.1):
        finial(p_roof, x, ridge + 0.25, 0.0, h=1.8, r=0.2)
    # wrought cresting along the ridge either side of the lantern: a top rail on uprights,
    # each upright tipped with a gilded spear point
    for (a, b) in ((ex0 + 0.9, -LANTERN['r'] - 0.5), (LANTERN['r'] + 0.5, ex1 - 0.9)):
        y0 = ridge + 0.27
        p_roof.beam([(a, y0 + 0.5, 0.0), (b, y0 + 0.5, 0.0)], 0.05, 0.05, PAL['iron'], METAL)
        n = max(2, int((b - a) / 0.6))
        for k in range(n + 1):
            x = a + (b - a) * k / n
            cyl(p_roof, x, y0, y0 + 0.62, 0.0, 0.03, PAL['iron'], METAL, sides=4)
            p_roof.prism((x, y0 + 0.62, 0.0), 4, 0.07, 0.0, 0.2, PAL['gold'], METAL, axis=(0, 1, 0))
            if k % 2:
                p_roof.ring((x, y0 + 0.3, 0.0), 0.16, 0.025, PAL['iron'], 8, axis=(0, 0, 1), mat=METAL)
    # the verges: barge boards along the gables' rakes
    for x in (ex0, ex1):
        for sz in (1, -1):
            p_roof.beam([(x, eave_y - 0.1, sz * ez), (x, ridge + 0.05, 0.0)], 0.12, 0.42, PAL['timber'], WOOD,
                        up=(0, 1, 0))
    # the eaves' fascia
    for sz in (1, -1):
        abox(p_roof, ex0, ex1, eave_y - 0.42, eave_y - 0.06, sz * ez - 0.07, sz * ez + 0.07, PAL['timber'], WOOD)
        # brackets under the eaves (corbels in dark timber)
        x = ex0 + 1.4
        while x < ex1 - 1.2:
            if abs(x) > PORCH['x1'] + 0.9 or sz > 0:
                zc = sz * (H['oz1'] + 0.3)
                abox(p_roof, x - 0.11, x + 0.11, plate - 0.9, plate - 0.25, min(zc, sz * (H['oz1'] + 0.9)),
                     max(zc, sz * (H['oz1'] + 0.9)), PAL['timber_dark'], WOOD)
            x += 2.2
    # the boarded underside inside, with the light well cut round the lantern
    lr = wl
    for sz in (1, -1):
        zr = lr
        za = sz * H['z1']
        ya = plate + 0.05
        yb = ridge - HALL_PITCH * zr - 0.12
        yw = plate + HALL_PITCH * (H['z1'] - zr) - 0.12

        def q(pts):
            flat_face(p_timber, pts, PAL['sarking'], WOOD, (0, -1, -sz * 0.0 - sz))
        x0, x1 = H['x0'], H['x1']
        q([(x0, ya, za), (x1, ya, za), (x1, yw, sz * zr), (x0, yw, sz * zr)])
        q([(x0, yw, sz * zr), (-lr, yw, sz * zr), (-lr, ridge - 0.12, 0.0), (x0, ridge - 0.12, 0.0)])
        q([(lr, yw, sz * zr), (x1, yw, sz * zr), (x1, ridge - 0.12, 0.0), (lr, ridge - 0.12, 0.0)])
        # common rafters on the boards, between the trusses
        x = x0 + 0.8
        while x < x1 - 0.5:
            if not any(abs(x - tx) < 0.6 for tx in TRUSS_X) and abs(x) > lr + 0.2:
                p_timber.beam([(x, ya - 0.14, za), (x, ridge - 0.26, 0.0)], 0.16, 0.18, PAL['oak'][1], WOOD,
                              up=(0, 1, 0))
            elif abs(x) <= lr + 0.2:
                p_timber.beam([(x, ya - 0.14, za), (x, yw - 0.14, sz * zr)], 0.16, 0.18, PAL['oak'][1], WOOD,
                              up=(0, 1, 0))
            x += 1.3
        _ = yb
    # the light well's trimmers round the lantern's opening
    for sz in (1, -1):
        yw = plate + HALL_PITCH * (H['z1'] - lr) - 0.26
        p_timber.beam([(-lr, yw, sz * lr), (lr, yw, sz * lr)], 0.3, 0.3, PAL['oak_dark'], WOOD)
    for sx in (1, -1):
        p_timber.beam([(sx * lr, plate + HALL_PITCH * (H['z1'] - lr) - 0.26, -lr),
                       (sx * lr, ridge - 0.3, 0.0), (sx * lr, plate + HALL_PITCH * (H['z1'] - lr) - 0.26, lr)],
                      0.3, 0.3, PAL['oak_dark'], WOOD)
    # the trusses
    tl = H['truss']
    for i, x in enumerate(TRUSS_X):
        col = pick(PAL['oak'], i)
        dk = PAL['oak_dark']
        for sz in (1, -1):
            zw = sz * (H['z1'] - 0.15)
            # the principal rafter under the boards
            p_timber.beam([(x, plate + 0.05, sz * H['z1']), (x, ridge - 0.5, sz * 0.45)], 0.42, 0.46, col, WOOD,
                          up=(1, 0, 0))
            # the wall post on its corbel, and the hammer beam
            hb_y = tl + 0.35
            hz = sz * (H['z1'] - 2.4)
            p_timber.beam([(x, FLOOR + 6.4, zw), (x, hb_y, zw)], 0.36, 0.36, dk, WOOD, up=(1, 0, 0))
            p_timber.beam([(x, hb_y, sz * (H['z1'] + 0.2)), (x, hb_y, hz)], 0.4, 0.46, col, WOOD, up=(1, 0, 0))
            # a carved end on the hammer beam
            cbox(p_timber, x, hb_y - 0.32, hz, 0.36, 0.3, 0.4, PAL['gold_dark'], METAL)
            # the curved brace from the wall post up under the hammer beam, all of it over the
            # camera's air (manor_plan HALL truss line; render/placed_town_interior_core.ts)
            b0 = FLOOR + 9.2
            pts = [(x, b0 + (hb_y - 0.25 - b0) * (1 - math.cos(math.pi / 2 * k / 5)),
                    zw - sz * 2.2 * math.sin(math.pi / 2 * k / 5)) for k in range(6)]
            p_timber.sweep(pts, 0.16, 0.16, col, sides=4, mat=WOOD, phase=math.pi / 4)
            # the hammer post up to the principal
            hp_top = plate + HALL_PITCH * (H['z1'] - abs(hz)) - 0.4
            p_timber.beam([(x, hb_y, hz), (x, hp_top, hz)], 0.34, 0.34, col, WOOD, up=(1, 0, 0))
            # the arch brace from the hammer post's foot up to the collar
            collar = FLOOR + 16.6
            pts = []
            for k in range(9):
                tt = k / 8
                ang = math.pi / 2 * tt
                zz = hz - sz * (abs(hz) - 1.2) * math.sin(ang)
                yy = hb_y + 0.2 + (collar - hb_y - 0.2) * (1 - math.cos(ang)) ** 0.8
                pts.append((x, yy, zz))
            p_timber.sweep(pts, 0.17, 0.17, col, sides=4, mat=WOOD, phase=math.pi / 4)
        # the collar beam
        p_timber.beam([(x, FLOOR + 16.6, -2.6), (x, FLOOR + 16.6, 2.6)], 0.4, 0.44, col, WOOD, up=(1, 0, 0))
        # the king post from the collar to the ridge beam
        p_timber.beam([(x, FLOOR + 16.6, 0), (x, ridge - 0.4, 0)], 0.3, 0.3, dk, WOOD, up=(1, 0, 0))
    # purlins and the ridge beam (broken at the light well)
    for (xa, xb) in ((H['x0'], -lr - 0.2), (lr + 0.2, H['x1'])):
        p_timber.beam([(xa, ridge - 0.5, 0), (xb, ridge - 0.5, 0)], 0.36, 0.4, PAL['oak_dark'], WOOD)
    for sz in (1, -1):
        for f in (0.35, 0.68):
            zz = sz * H['z1'] * (1 - f)
            yy = plate + HALL_PITCH * (H['z1'] - abs(zz)) - 0.3
            if abs(zz) < lr + 0.4:
                continue
            p_timber.beam([(H['x0'], yy, zz), (H['x1'], yy, zz)], 0.32, 0.36, PAL['oak'][2], WOOD)
    # the wall plates inside
    for sz in (1, -1):
        p_timber.beam([(H['x0'], plate - 0.1, sz * (H['z1'] - 0.1)), (H['x1'], plate - 0.1, sz * (H['z1'] - 0.1))],
                      0.4, 0.34, PAL['oak_dark'], WOOD)


def lantern(p_roof, p_trim, glow):
    """The octagonal lantern on the ridge: a slate-hung drum straddling the ridge, eight tall
    glazed lights between gilded mullions, a cornice, a slate spire with a gilded finial and a
    vane. Its inside is lined (seen up the light well from the hall)."""
    L = LANTERN
    x, z, r = L['x'], L['z'], L['r']
    n = 8
    ph = math.pi / 8

    def ring(rr, y):
        return [(x + math.cos(ph + math.tau * i / n) * rr, y, z + math.sin(ph + math.tau * i / n) * rr)
                for i in range(n)]
    # the drum: plastered, timber corner posts, from inside the roof to the glazing
    base = HALL['ridge'] - HALL_PITCH * (r + 0.2) - 0.35
    lo, hi = ring(r, base), ring(r, L['y0'])
    loi, hii = ring(r - 0.3, base), ring(r - 0.3, L['y0'])
    for i in range(n):
        j = (i + 1) % n
        hexa(p_roof, [lo[i], lo[j], loi[j], loi[i], hi[i], hi[j], hii[j], hii[i]], pick(PAL['plaster'], i), PLASTER)
    # the glazing: eight lit lights, gilded mullions, a sill and a head
    gl, gh = ring(r - 0.12, L['y0']), ring(r - 0.12, L['y1'])
    gli, ghi = ring(r - 0.2, L['y0']), ring(r - 0.2, L['y1'])
    for i in range(n):
        j = (i + 1) % n
        hexa(glow, [gl[i], gl[j], gli[j], gli[i], gh[i], gh[j], ghi[j], ghi[i]], PAL['lantern_lit'], GLOW_LANTERN)
        # the mullion at each corner
        cx, _, cz = ring(r, 0)[i]
        cbox(p_trim, cx, (L['y0'] + L['y1']) / 2, cz, 0.26, L['y1'] - L['y0'], 0.26, PAL['gold'], METAL,
             yaw=-(ph + math.tau * i / n))
        # a transom across each light and the light's arched head in stone
        a, b = ring(r - 0.05, 0)[i], ring(r - 0.05, 0)[j]
        mx, mz = (a[0] + b[0]) / 2, (a[2] + b[2]) / 2
        yaw = math.atan2(b[0] - a[0], b[2] - a[2])
        side = 2 * (r - 0.05) * math.sin(math.pi / n)
        cbox(p_trim, mx, L['y0'] + (L['y1'] - L['y0']) * 0.62, mz, 0.08, 0.08, side, PAL['gold_dark'], METAL,
             yaw=yaw)
    cyl(p_roof, x, L['y0'] - 0.25, L['y0'] + 0.05, z, r + 0.25, PAL['ashlar_hi'], STONE, sides=8, caps=True)
    # the cornice and the eaves of the spire
    cyl(p_roof, x, L['y1'], L['y1'] + 0.35, z, r + 0.35, PAL['timber'], WOOD, sides=8)
    cyl(p_trim, x, L['y1'] + 0.35, L['y1'] + 0.5, z, r + 0.45, PAL['gold'], METAL, sides=8)
    # the spire: slate courses up an octagonal cone
    sy0, sy1 = L['y1'] + 0.5, L['spire']
    steps = 9
    for k in range(steps):
        ya = sy0 + (sy1 - sy0) * k / steps
        yb = sy0 + (sy1 - sy0) * (k + 1.25) / steps
        ra = (r + 0.55) * (1 - k / steps)
        rb = max(0.04, (r + 0.55) * (1 - (k + 1.25) / steps))
        for i in range(n):
            a0 = ph + math.tau * i / n
            a1 = ph + math.tau * (i + 1) / n
            col = tone(pick(PAL['slate'], i + k), i, k, spread=0.18)
            pts = [(x + math.cos(a0) * (ra + 0.1), ya, z + math.sin(a0) * (ra + 0.1)),
                   (x + math.cos(a1) * (ra + 0.1), ya, z + math.sin(a1) * (ra + 0.1)),
                   (x + math.cos(a1) * ra * 0.9, ya, z + math.sin(a1) * ra * 0.9),
                   (x + math.cos(a0) * ra * 0.9, ya, z + math.sin(a0) * ra * 0.9),
                   (x + math.cos(a0) * rb, yb, z + math.sin(a0) * rb),
                   (x + math.cos(a1) * rb, yb, z + math.sin(a1) * rb),
                   (x + math.cos(a1) * rb * 0.9, yb - 0.08, z + math.sin(a1) * rb * 0.9),
                   (x + math.cos(a0) * rb * 0.9, yb - 0.08, z + math.sin(a0) * rb * 0.9)]
            hexa(p_roof, pts, col, SLATE)
    # gilded hip ribs up the spire's eight corners
    for i in range(n):
        a0 = ph + math.tau * i / n
        p_trim.beam([(x + math.cos(a0) * (r + 0.6), sy0 + 0.05, z + math.sin(a0) * (r + 0.6)), (x, sy1, z)],
                    0.1, 0.12, PAL['gold_dark'], METAL)
    finial(p_trim, x, sy1 - 0.1, z, h=L['finial'] - sy1 + 1.0, r=0.32)
    # the vane: a pennant on the finial's spike
    vy = L['finial'] - 0.3
    flat_face(p_trim, [(x, vy, z), (x + 1.3, vy + 0.15, z), (x + 1.1, vy + 0.45, z), (x, vy + 0.5, z)],
              PAL['gold'], METAL, (0, 0, -1))
    flat_face(p_trim, [(x, vy, z), (x + 1.3, vy + 0.15, z), (x + 1.1, vy + 0.45, z), (x, vy + 0.5, z)],
              PAL['gold'], METAL, (0, 0, 1))
    # inside: the lining under the spire, warm from the light below
    disc(p_roof, x, L['y1'] - 0.02, z, r - 0.15, PAL['oak'][0], WOOD, sides=8, up=False)
    for i in range(n):
        j = (i + 1) % n
        a, b = ring(r - 0.32, base), ring(r - 0.32, L['y0'])
        flat_face(p_roof, [a[i], a[j], b[j], b[i]], PAL['oak'][1], WOOD,
                  (-math.cos(ph + math.tau * (i + 0.5) / n), 0, -math.sin(ph + math.tau * (i + 0.5) / n)))


def hearth_and_hood(p, p_trim, glow):
    """The round hearth in the hall's middle: a raised ring of dressed stone with a gilded
    curb, a sunken fire bed of ash and embers with the log pile (the flames are the runtime's),
    and over it, high above the camera's band, the copper hood on four chains and its flue up
    into the lantern."""
    x, z = HEARTH['x'], HEARTH['z']
    r, curb, bed = HEARTH['r'], HEARTH['curb'], HEARTH['bed']
    n = 20
    for i in range(n):
        a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
        for (ra, rb, y0, y1, col, mat) in ((bed, r, FLOOR - 0.05, curb, tone(PAL['ashlar'][i % 6], i, 1), STONE),
                                           (r - 0.05, r + 0.12, curb - 0.02, curb + 0.12, PAL['gold_dark'], METAL)):
            pts = [(x + math.cos(a0) * ra, y0, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y0, z + math.sin(a1) * ra),
                   (x + math.cos(a1) * rb, y0, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y0, z + math.sin(a0) * rb),
                   (x + math.cos(a0) * ra, y1, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y1, z + math.sin(a1) * ra),
                   (x + math.cos(a1) * rb, y1, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y1, z + math.sin(a0) * rb)]
            hexa(p, pts, col, mat)
    # the step of flagstones round it
    for i in range(n):
        a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
        ra, rb = r + 0.12, r + 1.0
        y0, y1 = FLOOR - 0.04, FLOOR + 0.12
        pts = [(x + math.cos(a0) * ra, y0, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y0, z + math.sin(a1) * ra),
               (x + math.cos(a1) * rb, y0, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y0, z + math.sin(a0) * rb),
               (x + math.cos(a0) * ra, y1, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y1, z + math.sin(a1) * ra),
               (x + math.cos(a1) * rb, y1 - 0.08, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y1 - 0.08, z + math.sin(a0) * rb)]
        hexa(p, pts, tone(PAL['flag'][i % 4], i, 4), STONE)
    # the fire bed: ash, a glowing ember bed, the logs
    disc(p, x, curb - 0.18, z, bed + 0.02, PAL['soot'], STONE, sides=n)
    disc(glow, x, curb - 0.14, z, bed * 0.72, PAL['ember'], GLOW, sides=14)
    for k in range(7):
        a = math.tau * k / 7 + 0.3
        r0 = 0.35
        p.cylinder((x + math.cos(a) * r0, curb - 0.08, z + math.sin(a) * r0),
                   (x + math.cos(a) * (bed - 0.25), curb - 0.12 + 0.18 * (k % 2), z + math.sin(a) * (bed - 0.25)),
                   0.17, tone(PAL['oak_dark'], k, 8), WOOD, sides=6)
    # fire dogs: four gilded iron dogs on the ring
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        fx, fz = x + math.cos(a) * (r - 0.3), z + math.sin(a) * (r - 0.3)
        cyl(p_trim, fx, curb + 0.12, curb + 1.0, fz, 0.07, PAL['iron'], METAL, sides=6)
        p_trim.prism((fx, curb + 1.0, fz), 8, 0.14, 0.02, 0.24, PAL['gold'], METAL, axis=(0, 1, 0))
    # the hood: a copper cone in riveted bands, a verdigris lip, and the flue
    y0, y1, r0, r1 = HOOD['y0'], HOOD['y1'], HOOD['r0'], HOOD['r1']
    bands = 5
    for k in range(bands):
        ya = y0 + (y1 - y0) * k / bands
        yb = y0 + (y1 - y0) * (k + 1) / bands
        ra = r0 + (r1 - r0) * k / bands
        rb = r0 + (r1 - r0) * (k + 1) / bands
        p.prism((x, ya, z), 16, ra, rb, yb - ya, PAL['copper'] if k % 2 else PAL['copper_dark'], METAL,
                axis=(0, 1, 0), cap0=False, cap1=False)
        p.prism((x, yb, z), 16, rb + 0.06, rb + 0.06, 0.08, PAL['copper_dark'], METAL, axis=(0, 1, 0))
    # the inside of the cone (seen from below), dark with soot
    p.prism((x, y0 + 0.02, z), 16, r0 - 0.05, r1 - 0.04, y1 - y0 - 0.05, PAL['soot'], METAL, axis=(0, 1, 0),
            cap0=False, cap1=False)
    p.ring((x, y0, z), r0 + 0.04, 0.16, PAL['verdigris'], 18, axis=(0, 1, 0), mat=METAL)
    # flip the inner cone's faces inward: its normals are recalculated at finish, so build it
    # as a closed thin shell instead (the lip ring caps it)
    cyl(p, x, y1, LANTERN['y1'] - 0.05, z, HOOD['flue'], PAL['copper_dark'], METAL, sides=12, caps=False)
    for k in range(int((LANTERN['y1'] - y1) / 1.6)):
        yy = y1 + 0.8 + k * 1.6
        cyl(p_trim, x, yy, yy + 0.12, z, HOOD['flue'] + 0.06, PAL['gold_dark'], METAL, sides=12)
    # four chains from the lip to the collars of the inner trusses
    for sx in (1, -1):
        for sz in (1, -1):
            a = (x + sx * r0 * 0.7, y0 + 0.1, z + sz * r0 * 0.7)
            b = (sx * 3.25, FLOOR + 16.4, sz * 2.2)
            chain(p_trim, a, b)


def chain(p, a, b, links=None):
    """An iron chain: a run of alternating flat links."""
    length = math.dist(a, b)
    n = links or max(2, int(length / 0.6))
    dx, dy, dz = (b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length
    yaw = math.atan2(dx, dz)
    pitch = -math.asin(max(-1.0, min(1.0, dy)))
    # each link a flat iron strip in alternating planes (both windings, so it reads from
    # either side): cheap, and from the floor indistinguishable from a solid chain
    d = (dx, dy, dz)
    e1 = (dy * 0 - dz * 1, dz * 0 - dx * 0, dx * 1 - dy * 0)
    m = math.sqrt(e1[0] ** 2 + e1[1] ** 2 + e1[2] ** 2)
    e1 = (1.0, 0.0, 0.0) if m < 1e-6 else (e1[0] / m, e1[1] / m, e1[2] / m)
    e2 = (d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0])
    for k in range(n):
        t0, t1 = k / n, min(1.0, (k + 1.15) / n)
        p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0)
        p1 = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1)
        e = e1 if k % 2 == 0 else e2
        ox, oy, oz = e[0] * 0.05, e[1] * 0.05, e[2] * 0.05
        quad = [(p0[0] - ox, p0[1] - oy, p0[2] - oz), (p0[0] + ox, p0[1] + oy, p0[2] + oz),
                (p1[0] + ox, p1[1] + oy, p1[2] + oz), (p1[0] - ox, p1[1] - oy, p1[2] - oz)]
        p.face(quad, PAL['iron'], METAL)
        p.face(list(reversed(quad)), PAL['iron'], METAL)
    _ = (yaw, pitch)


# ---------------------------------------------------------------------------
# The porch and its crest
# ---------------------------------------------------------------------------
def porch(p, p_roof, p_trim, glow):
    P_ = PORCH
    # the platform: ashlar faces, a flagstone top, three steps
    abox(p, P_['x0'], P_['x1'], FOOT, FLOOR - 0.02, P_['z0'], P_['z1'], PAL['mortar'], STONE)
    flag_floor(p, P_['x0'], P_['x1'], P_['z0'], P_['z1'], FLOOR, size=1.6, seed=21)
    for sx in (1, -1):
        wall = Wall(sx * P_['x1'], P_['z0'], sx * P_['x1'], P_['z1'], (sx, 0))
        _ashlar_face(p, wall, 0.0, wall.length, FOOT + 0.6, FLOOR, 0.0, seed=sx)
    front = Wall(P_['x0'], P_['z0'], P_['x1'], P_['z0'], (0, -1))
    for (a, b) in ((0, STEPS['x0'] - P_['x0']), (STEPS['x1'] - P_['x0'], front.length)):
        _ashlar_face(p, front, a, b, FOOT + 0.6, FLOOR, 0.0, seed=5)
    n = 3
    for k in range(n):
        y1 = FLOOR * (n - k) / n
        zb = STEPS['z0'] + (STEPS['z1'] - STEPS['z0']) * k / n
        abox(p, STEPS['x0'] - 0.0, STEPS['x1'], FOOT + 0.4, y1, zb, STEPS['z1'], tone(PAL['ashlar_hi'], k, 2), STONE)
    # the cheek walls of the steps with a gilded ball on each
    for sx in (1, -1):
        x0, x1 = sorted((sx * STEPS['x1'], sx * (STEPS['x1'] + 0.6)))
        abox(p, x0, x1, FOOT + 0.4, FLOOR + 0.5, STEPS['z0'], STEPS['z1'], PAL['ashlar_hi'], STONE)
        p_trim.prism((sx * (STEPS['x1'] + 0.3), FLOOR + 0.5, STEPS['z0'] + 0.3), 10, 0.22, 0.22, 0.04, PAL['gold'],
                     METAL, axis=(0, 1, 0))
        _ball(p_trim, sx * (STEPS['x1'] + 0.3), FLOOR + 0.82, STEPS['z0'] + 0.3, 0.28)
    # the columns: a moulded base, a fluted shaft, a gilded necking and a capital
    for (cx, cz) in COLUMNS:
        cyl(p, cx, FLOOR, FLOOR + 0.35, cz, COLUMN_R + 0.22, PAL['ashlar_hi'], STONE, sides=12)
        cyl(p, cx, FLOOR + 0.35, FLOOR + 0.55, cz, COLUMN_R + 0.1, PAL['ashlar_hi'], STONE, sides=16)
        top = P_['beam'] - 0.6
        p.prism((cx, FLOOR + 0.55, cz), 16, COLUMN_R, COLUMN_R * 0.9, top - FLOOR - 0.55, tone(PAL['ashlar'][2], cx),
                STONE, axis=(0, 1, 0))
        cyl(p_trim, cx, top, top + 0.14, cz, COLUMN_R * 0.95, PAL['gold'], METAL, sides=16)
        cyl(p, cx, top + 0.14, P_['beam'] - 0.2, cz, COLUMN_R * 0.9, PAL['ashlar_hi'], STONE, sides=16,
            r1=COLUMN_R + 0.3)
        abox(p, cx - COLUMN_R - 0.32, cx + COLUMN_R + 0.32, P_['beam'] - 0.2, P_['beam'], cz - COLUMN_R - 0.32,
             cz + COLUMN_R + 0.32, PAL['ashlar_hi'], STONE)
    # pilasters against the hall's front wall behind them
    for (cx, _) in COLUMNS:
        abox(p, cx - 0.45, cx + 0.45, FLOOR, P_['beam'], P_['z1'] - 0.18, P_['z1'] + 0.02, PAL['ashlar_hi'], STONE)
    # the entablature: an architrave round three sides, a frieze, a gilded band, a cornice
    eb, ee = P_['beam'], P_['beam'] + 0.8
    xa, xb, za, zb = P_['x0'] - 0.1, P_['x1'] + 0.1, P_['z0'] + 0.3 - COLUMN_R - 0.4, P_['z1']
    for (a0, a1, b0, b1) in ((xa, xb, za, za + 0.9), (xa, xa + 0.9, za, zb), (xb - 0.9, xb, za, zb)):
        abox(p, a0, a1, eb, ee, b0, b1, PAL['ashlar_hi'], STONE)
        abox(p_trim, a0 - 0.02, a1 + 0.02, ee - 0.32, ee - 0.2, b0 - 0.02, b1 + 0.02, PAL['gold'], METAL)
        abox(p, a0 - 0.18, a1 + 0.18, ee, ee + 0.24, b0 - 0.18, b1 + 0.18, PAL['ashlar_hi'], STONE)
    # the coffered ceiling under the roof
    cy = ee - 0.02
    flat_face(p, [(xa, cy, za), (xb, cy, za), (xb, cy, zb), (xa, cy, zb)], PAL['oak'][1], WOOD, (0, -1, 0))
    for k in range(1, 4):
        xx = xa + (xb - xa) * k / 4
        abox(p, xx - 0.12, xx + 0.12, cy - 0.3, cy, za + 0.9, zb, PAL['oak_dark'], WOOD)
    for k in range(1, 3):
        zz = za + (zb - za) * k / 3
        abox(p, xa + 0.9, xb - 0.9, cy - 0.3, cy, zz - 0.12, zz + 0.12, PAL['oak_dark'], WOOD)
    # a hanging lantern under the ceiling, over the door
    hanging_lantern(p_trim, glow, 0.0, cy - 0.3, (za + zb) / 2 + 1.2, drop=1.6, size=0.5)
    # the pediment: a timber-framed plaster gable on the cornice, its rake mouldings in stone,
    # and the crest in its field
    ped_y = ee + 0.24
    ridge = P_['ridge']
    pitch = (ridge - ped_y) / (xb + 0.18)
    zf = za - 0.18
    gw = Wall(xa - 0.18, zf + 0.25, xb + 0.18, zf + 0.25, (0, -1))
    Lg = gw.length
    tri = lambda u: ped_y + pitch * (Lg / 2 - abs(u - Lg / 2))  # noqa: E731
    k = 0
    for i in range(12):
        ua, ub = Lg * i / 12, Lg * (i + 1) / 12
        gw.box(p, ua, ub, ped_y, tri(ua) - 0.02, -0.25, 0.25, pick(PAL['plaster'], k), PLASTER, v1b=tri(ub) - 0.02)
        k += 1
    for (a, b) in ((0.0, Lg / 2), (Lg / 2, Lg)):
        ya, yb = tri(a), tri(b)
        p.beam([gw.pt(a, ya + 0.08, 0.32), gw.pt(b, yb + 0.08, 0.32)], 0.42, 0.34, PAL['ashlar_hi'], STONE,
               up=(0, 0, -1))
        p_trim.beam([gw.pt(a, ya - 0.2, 0.38), gw.pt(b, yb - 0.2, 0.38)], 0.1, 0.1, PAL['gold'], METAL,
                    up=(0, 0, -1))
    crest(p_trim, 0.0, ped_y + 2.05, zf - 0.12)
    finial(p_trim, 0.0, ridge + 0.2, zf + 0.1, h=1.5, r=0.2)
    for sx in (1, -1):
        p_trim.prism((sx * (xb + 0.1), ped_y + 0.2, zf + 0.2), 8, 0.2, 0.2, 0.05, PAL['gold'], METAL, axis=(0, 1, 0))
        _ball(p_trim, sx * (xb + 0.1), ped_y + 0.55, zf + 0.2, 0.3)
    # the roof: two slopes from the pediment back into the hall's roof (a cross gable)
    eave_y = ped_y + 0.05
    ex = xb + 0.6
    run = ex
    slope = math.hypot(run, ridge + 0.1 - eave_y)
    h, c = (ridge + 0.1 - eave_y) / slope, run / slope
    zfront = zf - 0.4

    def porch_clip(s0, s1):
        y_hi = eave_y + h * s1
        # the hall's south slope reaches this height at z: the valley
        zv = (y_hi - H['plate']) / HALL_PITCH - H['oz1']
        zend = max(zv, H['oz0'])
        if zend - zfront < 0.1:
            return None
        return [(0.0, zend - zfront)]

    slate_roof(p_roof, (-ex, eave_y, zfront), (0, 0, 1), (c, h, 0), 30.0, slope, seed=31, clip=porch_clip,
               under=False)
    slate_roof(p_roof, (ex, eave_y, zfront), (0, 0, 1), (-c, h, 0), 30.0, slope, seed=32, clip=porch_clip,
               under=False)
    zv = (ridge - H['plate']) / HALL_PITCH - H['oz1']
    p_roof.beam([(0, ridge + 0.2, zfront), (0, ridge + 0.2, zv)], 0.36, 0.28, PAL['slate_ridge'], SLATE)
    # barge boards on the rakes
    for sx in (1, -1):
        p_roof.beam([(sx * ex, eave_y - 0.05, zfront - 0.02), (0, ridge + 0.12, zfront - 0.02)], 0.1, 0.42,
                    PAL['timber'], WOOD, up=(0, 1, 0))


def _ball(p, x, y, z, r):
    """A small ball: two stacked lathe slices."""
    p.prism((x, y - r, z), 10, r * 0.2, r, r, PAL['gold'], METAL, axis=(0, 1, 0), cap0=True, cap1=False)
    p.prism((x, y, z), 10, r, r * 0.2, r, PAL['gold'], METAL, axis=(0, 1, 0), cap0=False, cap1=True)


def _ashlar_face(p, wall, u0, u1, v0, v1, w, seed=0):
    """Coursed ashlar blocks on a face (a platform's side, a garden wall), proud by a hand."""
    v = v0
    row = 0
    while v < v1 - 0.05:
        vb = min(v1, v + 0.55)
        u = u0 - (0.5 if row % 2 else 0.0)
        while u < u1 - 0.05:
            ub = min(u1, u + 1.0 + 0.4 * hashf(u, v, seed))
            ua = max(u0, u)
            if ub - ua > 0.1:
                wall.slab(p, ua + 0.02, ub - 0.02, v + 0.02, vb - 0.02, w, 0.05,
                          tone(pick(PAL['ashlar'], int(hashf(ua, v, seed) * 6)), ua, v, spread=0.14), STONE)
            u = ub
        v = vb
        row += 1


def crest(p, x, y, z):
    """The crest of the house on the pediment, our own: a heater shield in the hold's blue,
    three silver peaks under a gilded beacon flame, a gilded border, two gilded laurel sprays
    round it and a scroll under it. Faces south (-z)."""
    # the shield: a stack of slices narrowing to the point
    w, hgt = 1.55, 2.3
    rows = 10
    for i in range(rows):
        t0, t1 = i / rows, (i + 1) / rows

        def half_w(t):
            return w if t < 0.45 else w * math.cos((t - 0.45) / 0.55 * math.pi / 2) ** 0.8
        ya, yb = y + hgt / 2 - hgt * t0, y + hgt / 2 - hgt * t1
        wa, wb = half_w(t0), max(0.04, half_w(t1))
        pts = [(x - wa, ya, z), (x + wa, ya, z), (x + wb, yb, z), (x - wb, yb, z),
               (x - wa, ya, z - 0.14), (x + wa, ya, z - 0.14), (x + wb, yb, z - 0.14), (x - wb, yb, z - 0.14)]
        hexa(p, [pts[3], pts[2], pts[1], pts[0], pts[7], pts[6], pts[5], pts[4]], PAL['blue'], METAL)
        # the border
        for sgn in (1, -1):
            pts = [(x + sgn * wa, ya, z - 0.1), (x + sgn * (wa + 0.14), ya, z - 0.1),
                   (x + sgn * (wb + 0.14), yb, z - 0.1), (x + sgn * wb, yb, z - 0.1),
                   (x + sgn * wa, ya, z - 0.14 - 2.5 * LAYER), (x + sgn * (wa + 0.14), ya, z - 0.14 - 2.5 * LAYER),
                   (x + sgn * (wb + 0.14), yb, z - 0.14 - 2.5 * LAYER), (x + sgn * wb, yb, z - 0.14 - 2.5 * LAYER)]
            hexa(p, pts, PAL['gold'], METAL)
    # each charge a layer over the one under it: shield, peaks, their snow, the flame; the
    # border over the field and the top band over the border
    abox(p, x - w - 0.14, x + w + 0.14, y + hgt / 2 - 0.02, y + hgt / 2 + 0.14, z - 0.14 - 4 * LAYER, z, PAL['gold'],
         METAL)
    # three silver peaks
    base = y - 0.45
    for (px, ph, pw) in ((-0.62, 0.9, 0.55), (0.0, 1.25, 0.7), (0.62, 0.85, 0.55)):
        lift = z - 0.14 - (2 if px == 0.0 else 1) * LAYER
        pts = [(x + px - pw, base, lift), (x + px + pw, base, lift), (x + px, base + ph, lift)]
        flat_face(p, pts, PAL['silver'], METAL, (0, 0, -1))
        snow = lift - LAYER
        pts = [(x + px - pw * 0.35, base + ph * 0.65, snow), (x + px + pw * 0.35, base + ph * 0.65, snow),
               (x + px, base + ph, snow)]
        flat_face(p, pts, PAL['cream'], METAL, (0, 0, -1))
    abox(p, x - 1.2, x + 1.2, base - 0.12, base, z - 0.14 - 1.5 * LAYER, z - 0.1, PAL['silver'], METAL)
    # the beacon flame over them
    fy = y + 0.55
    flame = [(0.0, 0.62), (0.2, 0.25), (0.32, 0.0), (0.18, -0.22), (0.0, -0.3), (-0.18, -0.22), (-0.32, 0.0),
             (-0.2, 0.25)]
    flat_face(p, [(x + fx, fy + fy2, z - 0.14 - 4 * LAYER) for (fx, fy2) in flame], PAL['gold'], METAL, (0, 0, -1))
    # the laurel sprays: leaves along two arcs either side
    for sgn in (1, -1):
        for k in range(9):
            a = -1.2 + 2.0 * k / 8
            r = w + 0.65
            lx = x + sgn * math.cos(a) * r
            ly = y - 0.1 + math.sin(a) * r * 0.95
            yaw = 0.0
            p.box((lx, ly, z - 0.1), (0.42, 0.18, 0.06), PAL['gold'] if k % 2 else PAL['gold_dark'], METAL,
                  roll=sgn * (a + math.pi / 2) * 0.9, yaw=yaw)
    # the scroll beneath
    abox(p, x - 1.6, x + 1.6, y - hgt / 2 - 0.55, y - hgt / 2 - 0.18, z - 0.16, z, PAL['cream'], METAL)
    for sgn in (1, -1):
        p.cylinder((x + sgn * 1.6, y - hgt / 2 - 0.36, z - 0.2), (x + sgn * 1.6, y - hgt / 2 - 0.36, z + 0.02),
                   0.22, PAL['cream'], METAL, sides=8)


def hanging_lantern(p_trim, glow, x, y, z, drop=1.2, size=0.45):
    """A gilded lantern on a rod: a frame, four lit panes, a little roof."""
    cyl(p_trim, x, y - drop, y, z, 0.035, PAL['iron'], METAL, sides=6)
    yb = y - drop - size * 1.4
    abox(p_trim, x - size * 0.6, x + size * 0.6, yb - 0.06, yb, z - size * 0.6, z + size * 0.6, PAL['gold_dark'], METAL)
    abox(glow, x - size * 0.48, x + size * 0.48, yb, yb + size * 1.2, z - size * 0.48, z + size * 0.48,
         PAL['lantern_lit'], GLOW_LANTERN)
    for sx in (1, -1):
        for sz in (1, -1):
            abox(p_trim, x + sx * size * 0.5 - 0.035, x + sx * size * 0.5 + 0.035, yb, yb + size * 1.2,
                 z + sz * size * 0.5 - 0.035, z + sz * size * 0.5 + 0.035, PAL['gold_dark'], METAL)
    p_trim.prism((x, yb + size * 1.2, z), 4, size * 0.85, 0.05, size * 0.6, PAL['iron'], METAL, axis=(0, 1, 0),
                 phase=math.pi / 4)


# ---------------------------------------------------------------------------
# The dais bay
# ---------------------------------------------------------------------------
BAY_PITCH = 0.82
BAY_RIDGE = BAY['plate'] + BAY_PITCH * (BAY['ox1'] + 0.6) - BAY_PITCH * 0.6


def bay(p, p_roof, p_trim, glow):
    B = BAY
    t = B['t']
    # the side walls (west and east) and the back gable with the great window
    for sx in (1, -1):
        xc = sx * (B['x1'] + t / 2)
        w = Wall(xc, B['z0'], xc, B['oz1'], (sx, 0))
        # a tall narrow lit window each side
        u = 3.5
        manor_wall(p, w, t, lambda u: B['plate'], [(u - 0.7, u + 0.7, FLOOR + 3.2, FLOOR + 7.6)],
                   plinth=STONE_TO, seed=40 + sx)
        window(p, w, u - 0.7, u + 0.7, FLOOR + 3.2, FLOOR + 7.6, t, lit=True, arch=True, bars=2)
    zc = B['z1'] + t / 2
    back = Wall(B['ox0'], zc, B['ox1'], zc, (0, 1))
    Lb = back.length
    gtop = lambda u: B['plate'] + BAY_PITCH * (Lb / 2 - abs(u - Lb / 2))  # noqa: E731
    wu0, wu1 = Lb / 2 - 2.5, Lb / 2 + 2.5
    wv0, wv1 = FLOOR + 2.8, FLOOR + 12.2
    manor_wall(p, back, t, gtop, [(wu0, wu1, wv0, wv1)], plinth=STONE_TO, seed=44,
               rails=[STONE_TO + 0.12, B['plate'] - 0.15])
    stained_glass(p, p_trim, glow, back, wu0, wu1, wv0, wv1, t)
    # the dais: a raised oak platform with a stone nosing, the bay's floor and a step into the hall
    board_floor(p, B['x0'], B['x1'], DAIS_FRONT, B['z1'], DAIS, along='x', seed=45)
    abox(p, B['x0'], B['x1'], FLOOR - 0.02, DAIS - 0.02, DAIS_FRONT, H['z1'], PAL['oak_dark'], WOOD)
    abox(p, B['x0'] - 0.05, B['x1'] + 0.05, DAIS - 0.1, DAIS + 0.02, DAIS_FRONT - 0.12, DAIS_FRONT + 0.1,
         PAL['ashlar_hi'], STONE)
    for sx in (1, -1):
        abox(p, sx * B['x1'] - 0.12 if sx > 0 else B['x0'] - 0.05, sx * B['x1'] + 0.05 if sx > 0 else B['x0'] + 0.12,
             FLOOR - 0.02, DAIS + 0.02, DAIS_FRONT, H['z1'], PAL['ashlar_hi'], STONE)
    # the bay's roof: a cross gable into the hall's north slope
    eave_y = B['plate'] - BAY_PITCH * 0.6
    ex = B['ox1'] + 0.6
    slope = math.hypot(ex, BAY_RIDGE - eave_y)
    h, c = (BAY_RIDGE - eave_y) / slope, ex / slope
    zback = B['oz1'] + 0.5

    def bay_clip(s0, s1):
        y_hi = eave_y + h * s1
        zv = H['oz1'] - (y_hi - H['plate']) / HALL_PITCH
        zend = min(zv, H['oz1'])
        if zback - zend < 0.1:
            return None
        return [(0.0, zback - zend)]

    slate_roof(p_roof, (ex, eave_y, zback), (0, 0, -1), (-c, h, 0), 30.0, slope, seed=46, clip=bay_clip,
               under=False)
    slate_roof(p_roof, (-ex, eave_y, zback), (0, 0, -1), (c, h, 0), 30.0, slope, seed=47, clip=bay_clip,
               under=False)
    zv = H['oz1'] - (BAY_RIDGE - H['plate']) / HALL_PITCH
    p_roof.beam([(0, BAY_RIDGE + 0.15, zback), (0, BAY_RIDGE + 0.15, zv)], 0.36, 0.28, PAL['slate_ridge'], SLATE)
    finial(p_trim, 0.0, BAY_RIDGE + 0.2, zback - 0.2, h=1.5, r=0.2)
    for sx in (1, -1):
        p_roof.beam([(sx * ex, eave_y - 0.05, zback + 0.02), (0, BAY_RIDGE + 0.1, zback + 0.02)], 0.1, 0.42,
                    PAL['timber'], WOOD, up=(0, 1, 0))
    # inside: a boarded barrel of a ceiling under the bay's roof, oak ribs on it
    ins = B['plate'] - 0.05
    for sx in (1, -1):
        flat_face(p_roof, [(sx * B['x1'], ins, B['z0'] - 0.5), (sx * B['x1'], ins, B['z1']),
                           (0, BAY_RIDGE - 0.6, B['z1']), (0, BAY_RIDGE - 0.6, B['z0'] - 0.5)],
                  PAL['sarking'], WOOD, (-sx, -1, 0))
    for k in range(4):
        zz = B['z0'] + 0.3 + (B['z1'] - B['z0'] - 0.6) * k / 3
        for sx in (1, -1):
            p_roof.beam([(sx * (B['x1'] - 0.05), ins - 0.15, zz), (0, BAY_RIDGE - 0.75, zz)], 0.24, 0.26,
                        PAL['oak_dark'], WOOD, up=(0, 0, 1))


def stained_glass(p, p_trim, glow, wall, u0, u1, v0, v1, t):
    """The great window behind the high table: three leaded lancets and a rose in stone
    tracery (manor_glass.py has the glass: our own design). It glows warm at night."""
    um = (u0 + u1) / 2
    w = u1 - u0
    rect_top = v1 - w / 2

    def tracery(mull):
        # the stone: two mullions through the wall's depth, the arch, jambs and the sill
        for f in (1 / 3, 2 / 3):
            uu = u0 + w * f
            wall.box(p, uu - mull / 2, uu + mull / 2, v0, rect_top, -0.16, 0.16, PAL['ashlar_hi'], STONE)
        arch_ring(p, wall, u0, u1, rect_top, t, n=11)
        for s in (1, -1):
            wo = s * t / 2
            wa, wb = (wo - 0.02, wo + 0.14) if s > 0 else (wo - 0.14, wo + 0.02)
            wall.box(p, u0 - 0.3, u0 + LAYER, v0, rect_top, wa, wb, PAL['ashlar_hi'], STONE)
            wall.box(p, u1 - LAYER, u1 + 0.3, v0, rect_top, wa, wb, PAL['ashlar_hi'], STONE)
        wall.box(p, u0 - 0.4, u1 + 0.4, v0 - 0.22, v0, -t / 2 - 0.1, t / 2 + 0.2, PAL['stone_dark'], STONE)
    great_window(p, p_trim, glow, wall, u0, u1, v0, v1, t, tracery)
    _ = um


# ---------------------------------------------------------------------------
# The wings
# ---------------------------------------------------------------------------
def wings(p, p_roof, p_trim, glow):
    t = WING_T
    W, K, E, C = WEST, KITCHEN, EAST, CHAPEL
    # --- the west wing: the dining hall
    zc = W['oz0'] + t / 2
    front = Wall(H['ox1'], zc, W['ox1'], zc, (0, -1))
    U = lambda x: x - H['ox1']  # noqa: E731
    plate = W['plate']
    wins = [(U(x) - 1.0, U(x) + 1.0, FLOOR + 2.4, FLOOR + 6.8) for x in (16.9, 21.4)]
    manor_wall(p, front, t, lambda u: plate, wins, plinth=STONE_TO, seed=51)
    for (a, b, c, d) in wins:
        window(p, front, a, b, c, d, t, lit=True, arch=False, bars=2, shutters=True)
    wainscot(p, front, t, 0.2, front.length - 0.9)
    xc = W['x1'] + t / 2
    outer = Wall(xc, W['oz0'], xc, K['oz1'], (1, 0))
    Z = lambda z: z - W['oz0']  # noqa: E731
    owin = [(Z(z) - 1.0, Z(z) + 1.0, FLOOR + 2.4, FLOOR + 6.8) for z in (-3.6, 3.4)]
    owin.append((Z(11.6) - 0.8, Z(11.6) + 0.8, FLOOR + 2.6, FLOOR + 5.6))
    kp = K['plate']

    def otop(u):
        return plate if u < Z(K['z0']) else kp
    manor_wall(p, outer, t, otop, owin, plinth=STONE_TO, seed=52)
    for (a, b, c, d) in owin:
        window(p, outer, a, b, c, d, t, lit=True, arch=False, bars=2, shutters=True)
    wainscot(p, outer, t, 0.9, Z(W['z1']))
    # the wall between the dining hall and the kitchen: the door and the serving hatch
    zc = W['z1'] + t / 2
    mid = Wall(H['ox1'], zc, W['x1'], zc, (0, 1))
    door = (U(KITCHEN_DOOR['x0']), U(KITCHEN_DOOR['x1']), FLOOR, SIDE_DOOR_H)
    hatch = (U(HATCH['x0']), U(HATCH['x1']), HATCH['y0'], HATCH['y1'])
    manor_wall(p, mid, t, lambda u: plate, [door, hatch], plinth=FLOOR + 0.01, seed=53, braces=False,
               inner_color=PAL['plaster_in'])
    # on the kitchen side the wall's face is the kitchen's (pale plaster)
    mid.box(p, 0.0, mid.length, FLOOR, plate, t / 2 - 0.02, t / 2 + 0.01, PAL['plaster_in'][1], PLASTER)
    inner_door(p, mid, door[0], door[1], t)
    hatch_frame(p, p_trim, mid, hatch, t)
    wainscot(p, mid, t, 0.2, door[0] - 0.4)
    # the kitchen's own walls: north and east
    zc = K['z1'] + t / 2
    kback = Wall(K['ox0'], zc, W['x1'], zc, (0, 1))
    manor_wall(p, kback, t, lambda u: kp, [], plinth=STONE_TO, seed=54)
    xc = K['x0'] - t / 2
    kside = Wall(xc, K['z0'], xc, K['oz1'], (-1, 0))
    kwin = [(1.6, 3.2, FLOOR + 2.6, FLOOR + 5.4)]
    manor_wall(p, kside, t, lambda u: kp, kwin, plinth=STONE_TO, seed=55)
    window(p, kside, 1.6, 3.2, FLOOR + 2.6, FLOOR + 5.4, t, lit=True, arch=False, bars=1, shutters=True)
    # the dining hall's floor (oak) and the kitchen's (flags)
    board_floor(p, H['ox1'], W['x1'], W['z0'], W['z1'], FLOOR, along='x', seed=56)
    flag_floor(p, K['x0'], W['x1'], K['z0'], K['z1'], FLOOR, size=1.3, seed=57)
    # (the doorway's floor is inner_door's oak sill)
    # roofs: the dining hall's ridge runs east-west into the hall's gable, hipped at its west end;
    # the kitchen's lower roof is hipped at both ends
    hip_roof(p_roof, H['ox1'] + 0.8, W['ox1'], W['oz0'], W['z1'] + t, plate, 0.72, 'x', hips=(False, True),
             seed=58)
    hip_roof(p_roof, K['ox0'], W['ox1'], K['z0'], K['oz1'], kp, 0.72, 'x', hips=(True, True), seed=59)
    # the kitchen's chimney stack on its north wall
    chimney(p, p_trim, 20.3, K['oz1'] + 0.5, FLOOR + 14.6, 3.8, 1.0)
    # --- the east wing: the library
    zc = E['oz0'] + t / 2
    front = Wall(E['ox0'], zc, H['ox0'], zc, (0, -1))
    U2 = lambda x: x - E['ox0']  # noqa: E731
    wins = [(U2(x) - 1.0, U2(x) + 1.0, FLOOR + 2.4, FLOOR + 6.8) for x in (-21.4, -16.9)]
    manor_wall(p, front, t, lambda u: plate, wins, plinth=STONE_TO, seed=61)
    for (a, b, c, d) in wins:
        window(p, front, a, b, c, d, t, lit=True, arch=False, bars=2, shutters=True)
    xc = E['x0'] - t / 2
    outer = Wall(xc, E['oz0'], xc, E['oz1'], (-1, 0))
    Z2 = lambda z: z - E['oz0']  # noqa: E731
    owin = []  # the library's east wall is all shelves inside
    manor_wall(p, outer, t, lambda u: plate, owin, plinth=STONE_TO, seed=62)
    for (a, b, c, d) in owin:
        window(p, outer, a, b, c, d, t, lit=True, arch=True, bars=2)
    # the wall between the library and the chapel
    zc = E['z1'] + t / 2
    mid = Wall(E['ox0'], zc, H['ox0'], zc, (0, 1))
    door = (U2(CHAPEL_DOOR['x0']), U2(CHAPEL_DOOR['x1']), FLOOR, SIDE_DOOR_H)
    manor_wall(p, mid, t, lambda u: plate, [door], plinth=FLOOR + 0.01, seed=63, braces=False)
    mid.box(p, 0.0, mid.length, FLOOR, plate, t / 2 - 0.02, t / 2 + 0.01, PAL['plaster_in'][1], PLASTER)
    inner_door(p, mid, door[0], door[1], t)
    # the chapel: three walls of its own and a pointed gable to the north with a round window
    cp = C['plate']
    for sx, xw in ((-1, C['x0'] - t / 2), (1, C['x1'] + t / 2)):
        w = Wall(xw, C['z0'], xw, C['oz1'], (sx, 0))
        cw = [(2.6, 3.8, FLOOR + 2.8, FLOOR + 6.2)]
        manor_wall(p, w, t, lambda u: cp, cw, plinth=STONE_TO, seed=64 + sx)
        window(p, w, 2.6, 3.8, FLOOR + 2.8, FLOOR + 6.2, t, lit=True, arch=True, bars=2)
    zc = C['z1'] + t / 2
    cb = Wall(C['ox0'], zc, C['ox1'], zc, (0, 1))
    Lc = cb.length
    cpitch = 0.95
    ctop = lambda u: cp + cpitch * (Lc / 2 - abs(u - Lc / 2))  # noqa: E731
    manor_wall(p, cb, t, ctop, [(Lc / 2 - 1.0, Lc / 2 + 1.0, FLOOR + 3.0, FLOOR + 7.0)], plinth=STONE_TO, seed=66,
               rails=[STONE_TO + 0.12, cp - 0.15])
    stained_small(p, p_trim, glow, cb, Lc / 2 - 1.0, Lc / 2 + 1.0, FLOOR + 3.0, FLOOR + 7.0, t)
    # floors: library oak, chapel flags
    board_floor(p, E['x0'], H['ox0'], E['z0'], E['z1'], FLOOR, along='z', seed=67)
    flag_floor(p, C['x0'], C['x1'], C['z0'], C['z1'], FLOOR, size=1.2, seed=68)
    # (the doorway's floor is inner_door's oak sill)
    # roofs: the library like the dining hall; the chapel a steep gable running north
    hip_roof(p_roof, E['ox0'], H['ox0'] - 0.8, E['oz0'], E['z1'] + t, plate, 0.72, 'x', hips=(True, False),
             seed=69)
    chapel_roof(p_roof, p_trim, cp, cpitch)
    # inside each wing: tie beams across the rooms at the plate, nothing lower
    for x in (16.6, 21.2):
        abox(p, x - 0.22, x + 0.22, plate - 0.45, plate - 0.02, W['z0'], W['z1'], PAL['oak_dark'], WOOD)
    for x in (-21.2, -16.6):
        abox(p, x - 0.22, x + 0.22, plate - 0.45, plate - 0.02, E['z0'], E['z1'], PAL['oak_dark'], WOOD)
    # their ceilings: boarded, at the tie beams' tops
    for (x0, x1, z0, z1) in ((H['ox1'], W['x1'], W['z0'], W['z1']), (E['x0'], H['ox0'], E['z0'], E['z1']),
                             (K['x0'], W['x1'], K['z0'], K['z1'])):
        top = plate - 0.02 if z1 <= W['z1'] + 0.01 else kp - 0.02
        flat_face(p, [(x0, top, z0), (x1, top, z0), (x1, top, z1), (x0, top, z1)], PAL['sarking'], WOOD, (0, -1, 0))
        z = z0 + 1.2
        while z < z1 - 0.6:
            abox(p, x0, x1, top - 0.22, top, z - 0.1, z + 0.1, PAL['oak'][2], WOOD)
            z += 1.6


def inner_door(p, wall, u0, u1, t, arch=False):
    """A doorway between two rooms: oak posts and lintel on both faces, an open oak door."""
    half = t / 2
    head = SIDE_DOOR_H
    for s in (1, -1):
        wa, wb = (half - 0.02, half + 0.12) if s > 0 else (-half - 0.12, -half + 0.02)
        # (the posts' faces a layer back from the lining's, never on its plane)
        wall.box(p, u0 - 0.3, u0 - LAYER, FLOOR, head, wa, wb, PAL['oak_dark'], WOOD)
        wall.box(p, u1 + LAYER, u1 + 0.3, FLOOR, head, wa, wb, PAL['oak_dark'], WOOD)
        wall.box(p, u0 - 0.4, u1 + 0.4, head, head + 0.4, wa, wb, PAL['oak_dark'], WOOD)
    # the jambs' lining through the wall
    wall.box(p, u0 - 0.06, u0, FLOOR, head, -half, half, PAL['oak'][0], WOOD)
    wall.box(p, u1, u1 + 0.06, FLOOR, head, -half, half, PAL['oak'][0], WOOD)
    wall.box(p, u0, u1, head - 0.06, head, -half, half, PAL['oak'][0], WOOD)
    # an oak sill a layer proud, closed over the wall core's cut and the floors meeting under it
    wall.box(p, u0 - 0.06, u1 + 0.06, FLOOR - 0.02, FLOOR + LAYER, -half - 0.02, half + 0.02, PAL['oak'][1], WOOD)
    if arch:
        r = (u1 - u0) / 2 + 0.4
        um = (u0 + u1) / 2
        for s in (1, -1):
            wa = s * (half + 0.06)
            for i in range(6):
                a0, a1 = math.pi * i / 6, math.pi * (i + 1) / 6
                pts = [wall.pt(um - math.cos(a0) * r, head + 0.4 + math.sin(a0) * r * 0.5, wa),
                       wall.pt(um - math.cos(a1) * r, head + 0.4 + math.sin(a1) * r * 0.5, wa),
                       wall.pt(um - math.cos(a1) * (r + 0.2), head + 0.4 + math.sin(a1) * (r + 0.2) * 0.5, wa),
                       wall.pt(um - math.cos(a0) * (r + 0.2), head + 0.4 + math.sin(a0) * (r + 0.2) * 0.5, wa)]
                flat_face(p, pts, PAL['oak_dark'], WOOD, (wall.nx * s, 0, wall.nz * s))


def hatch_frame(p, p_trim, wall, hatch, t):
    """The serving hatch: an oak frame, a wide shelf through the wall, a raised shutter."""
    u0, u1, v0, v1 = hatch
    half = t / 2
    wall.box(p, u0 - 0.25, u1 + 0.25, v0 - 0.1, v0 + 0.06, -half - 0.45, half + 0.45, PAL['oak'][2], WOOD)
    for s in (1, -1):
        wa, wb = (half - 0.02, half + 0.1) if s > 0 else (-half - 0.1, -half + 0.02)
        wall.box(p, u0 - 0.2, u0, v0, v1, wa, wb, PAL['oak_dark'], WOOD)
        wall.box(p, u1, u1 + 0.2, v0, v1, wa, wb, PAL['oak_dark'], WOOD)
        wall.box(p, u0 - 0.25, u1 + 0.25, v1, v1 + 0.22, wa, wb, PAL['oak_dark'], WOOD)
    # the shutter propped open on the kitchen side
    a = wall.pt(u0, v1 + 0.2, half + 0.1)
    b = wall.pt(u1, v1 + 0.2, half + 0.1)
    cx, cz = (a[0] + b[0]) / 2, (a[2] + b[2]) / 2
    p.box((cx + wall.nx * 0.5, v1 + 0.15, cz + wall.nz * 0.5), (u1 - u0, 0.08, 1.0), PAL['oak'][1], WOOD,
          pitch=0.35 * (1 if wall.nz > 0 else -1))


def chimney(p, p_trim, x, z, top, w, d):
    """A stone chimney stack with a cap and two clay pots."""
    abox(p, x - w / 2, x + w / 2, FOOT, top, z - d / 2, z + d / 2, PAL['mortar'], STONE)
    v = FOOT
    row = 0
    while v < top - 0.1:
        vb = min(top, v + 0.9)
        for (a, b, c, e) in ((x - w / 2 - 0.04, x + w / 2 + 0.04, z + d / 2, z + d / 2 + 0.05),
                             (x - w / 2 - 0.04, x + w / 2 + 0.04, z - d / 2 - 0.05, z - d / 2)):
            n = 2
            for k in range(n):
                xa = a + (b - a) * (k + (0.5 if row % 2 else 0)) / n
                xb = min(b, xa + (b - a) / n)
                if xb - xa > 0.1:
                    abox(p, xa + 0.02, xb - 0.02, v + 0.02, vb - 0.02, c, e, tone(pick(PAL['ashlar'], k + row), k, row),
                         STONE)
        v = vb
        row += 1
    abox(p, x - w / 2 - 0.2, x + w / 2 + 0.2, top, top + 0.3, z - d / 2 - 0.2, z + d / 2 + 0.2, PAL['ashlar_hi'], STONE)
    for k in (-1, 1):
        cyl(p, x + k * w * 0.22, top + 0.3, top + 1.1, z, 0.28, (0.62, 0.36, 0.24), STONE, sides=8, r1=0.22)


def chapel_roof(p_roof, p_trim, plate, pitch):
    """The chapel's steep slate gable, its ridge running north from the library's roof, a
    stone bellcote with its bell over the north gable."""
    C = CHAPEL
    xm = (C['ox0'] + C['ox1']) / 2
    halfw = (C['ox1'] - C['ox0']) / 2 + 0.6
    eave_y = plate - pitch * 0.6
    ridge = eave_y + pitch * halfw
    slope = math.hypot(halfw, ridge - eave_y)
    h, c = (ridge - eave_y) / slope, halfw / slope
    zb = C['oz1'] + 0.5
    # the library's north slope: its height at z (hip_roof's ridge along x)
    E = EAST
    lib_ez0, lib_ez1 = E['oz0'] - 0.8, E['z1'] + WING_T + 0.8
    lib_ridge = (E['plate'] - 0.72 * 0.8) + 0.72 * (lib_ez1 - lib_ez0) / 2
    lib_mid = (lib_ez0 + lib_ez1) / 2

    def clip(s0, s1):
        y_hi = eave_y + h * s1
        zv = lib_mid + (lib_ridge - y_hi) / 0.72
        if zb - zv < 0.1:
            return None
        return [(0.0, zb - zv)]
    slate_roof(p_roof, (xm + halfw, eave_y, zb), (0, 0, -1), (-c, h, 0), 30.0, slope, seed=71, clip=clip, under=False)
    slate_roof(p_roof, (xm - halfw, eave_y, zb), (0, 0, -1), (c, h, 0), 30.0, slope, seed=72, clip=clip, under=False)
    # the boards under the slates, over the chapel only (seen from inside: it is open to them)
    for sx in (1, -1):
        flat_face(p_roof, [(xm + sx * (halfw - 0.6), plate - 0.02, C['z1']), (xm + sx * (halfw - 0.6), plate - 0.02, C['z0']),
                           (xm, ridge - 0.12, C['z0']), (xm, ridge - 0.12, C['z1'])], PAL['sarking'], WOOD, (-sx, -1, 0))
    zv = lib_mid + (lib_ridge - ridge) / 0.72
    p_roof.beam([(xm, ridge + 0.12, zb), (xm, ridge + 0.12, zv)], 0.32, 0.26, PAL['slate_ridge'], SLATE)
    for sx in (1, -1):
        p_roof.beam([(xm + sx * halfw, eave_y - 0.05, zb + 0.02), (xm, ridge + 0.1, zb + 0.02)], 0.1, 0.4,
                    PAL['timber'], WOOD, up=(0, 1, 0))
    # the bellcote: a stone frame on the gable with an arched opening, a bronze bell, a cross-less
    # gilded sun on top (the hold's sign)
    bz = C['oz1'] - 0.35
    by = ridge - 0.6
    abox(p_roof, xm - 1.0, xm + 1.0, by, by + 3.2, bz - 0.35, bz + 0.35, PAL['mortar'], STONE)
    for (a, b) in ((xm - 1.0, xm - 0.55), (xm + 0.55, xm + 1.0)):
        abox(p_roof, a - 0.04, b + 0.04, by, by + 3.2, bz - 0.4, bz + 0.4, PAL['ashlar_hi'], STONE)
    abox(p_roof, xm - 1.1, xm + 1.1, by + 3.2, by + 3.55, bz - 0.45, bz + 0.45, PAL['ashlar_hi'], STONE)
    p_roof.prism((xm, by + 3.55, bz), 4, 1.15, 0.05, 1.0, PAL['slate'][0], SLATE, axis=(0, 1, 0),
                 phase=math.pi / 4, squash=0.45)
    # cut the opening visually: a dark recess with the bell in it
    abox(p_roof, xm - 0.54, xm + 0.54, by + 0.9, by + 2.7, bz - 0.36, bz + 0.36, PAL['soot'], STONE)
    p_trim.prism((xm, by + 1.2, bz - 0.38), 12, 0.42, 0.24, 0.9, PAL['gold_dark'], METAL, axis=(0, 1, 0))
    p_trim.prism((xm, by + 2.1, bz - 0.38), 12, 0.24, 0.06, 0.22, PAL['gold_dark'], METAL, axis=(0, 1, 0))
    _ball(p_trim, xm, by + 4.75, bz, 0.22)
    sun = [(math.cos(math.tau * i / 16) * (0.48 if i % 2 else 0.26), math.sin(math.tau * i / 16) * (0.48 if i % 2 else 0.26))
           for i in range(16)]
    for sz in (-1, 1):
        flat_face(p_trim, [(xm + a, by + 4.3 + b, bz + sz * 0.03) for (a, b) in sun], PAL['gold'], METAL, (0, 0, sz))
    # inside: the chapel is open to its rafters
    for k in range(5):
        zz = C['z0'] + 0.4 + (C['z1'] - C['z0'] - 0.8) * k / 4
        for sx in (1, -1):
            p_roof.beam([(xm + sx * (halfw - 1.4), plate - 0.1, zz), (xm, ridge - 0.5, zz)], 0.2, 0.22, PAL['oak_dark'],
                        WOOD, up=(0, 0, 1))


def stained_small(p, p_trim, glow, wall, u0, u1, v0, v1, t):
    """The chapel's window: one leaded lancet, a sun over a peak in a roundel (manor_glass.py)."""
    w = u1 - u0
    rect_top = v1 - w / 2
    chapel_window(p_trim, glow, wall, u0, u1, v0, v1)
    arch_ring(p, wall, u0, u1, rect_top, t, n=7)
    wall.box(p, u0 - 0.3, u1 + 0.3, v0 - 0.2, v0, -t / 2 - 0.08, t / 2 + 0.16, PAL['stone_dark'], STONE)


# ---------------------------------------------------------------------------
# The hall's floor and the whole
# ---------------------------------------------------------------------------
def hall_floor(p, p_trim):
    flag_floor(p, H['x0'], H['x1'], H['z0'], H['z1'], FLOOR, size=2.0, seed=81)
    # a border of dark stone round the hearth's step and a compass star inlaid in gold at the door
    # (the door's own threshold is door_frame's; the side arches get a dressed sill a layer
    # proud, a closed stone over the wall core's cut)
    for (x0, x1, z0, z1) in ((H['x1'], H['ox1'], ARCH_SIDE['z0'], ARCH_SIDE['z1']),
                             (H['ox0'], H['x0'], ARCH_SIDE['z0'], ARCH_SIDE['z1'])):
        abox(p, x0, x1, FLOOR - 0.02, FLOOR + LAYER, z0, z1, PAL['ashlar_hi'], STONE)
    star = []
    for i in range(16):
        r = 1.3 if i % 2 == 0 else 0.45
        a = math.tau * i / 16
        star.append((math.cos(a) * r, FLOOR + LAYER, -7.6 + math.sin(a) * r))
    flat_face(p_trim, star, PAL['gold'], METAL, (0, 1, 0))


def build(m, parts):
    shell, roof, timber, trim, glow = (parts['ManorShell'], parts['ManorRoof'], parts['ManorTimber'],
                                       parts['ManorTrim'], parts['ManorGlow'])
    hall_walls(shell, glow)
    hall_floor(shell, trim)
    hall_roof(roof, timber, glow)
    lantern(roof, trim, glow)
    hearth_and_hood(timber, trim, glow)
    porch(shell, roof, trim, glow)
    bay(shell, roof, trim, glow)
    wings(shell, roof, trim, glow)
    _ = (P, cyl, disc, opening_spans, abox, SLATE, HOOD)
