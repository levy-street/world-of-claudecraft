"""The guild hall's architectural pieces, shared by its builders: arches, the flagged floors,
the wainscot, hipped roofs over a dark underlay, finials, the round oculus, the great door's
frame, chains, the columned porch with the guild's crest in its pediment, the hearths' chimney
stacks and the hanging lanterns. They began as the Highwatch manor's (the manor left the town;
the guild keeps its own copy) and read the guild's plan (guild_plan.py) directly.
"""
import math

from guild_lib import (GLOW_LANTERN, GLOW_SOFT, LAYER, METAL, PAL, PLASTER, SLATE, STONE, WOOD, Wall,
                       abox, cbox, cyl, flat_face, hashf, hexa, pick, tone)
from guild_lib import slate_roof as _lib_slate_roof
from guild_plan import (COLUMN_R, COLUMNS, DOOR, FLOOR, FOOT, HALL, HALL_PITCH, PORCH, STEPS)
from guild_props import has, hang

H = HALL
STONE_TO = FLOOR + 3.6   # the ashlar storey under the plaster and timber
# the underlay's lift off the roof plane: clear of a gable wall's raking top (which lies in the
# plane) by more than the depth buffer's reach, and still well under the slates (0.07 up)
UNDERLAY = 0.035


def slate_roof(p, e0, along, up, la, lu, seed=0, step=0.66, seg=1.75, thick=0.07, clip=None, under=True):
    """The kit's slate slope, over a dark underlay a hand under the slates: the courses
    leave hairline gaps, and through bare gaps the lit room under the boards shows as specks
    of light on the roof. The underlay follows the same courses and clip, so a cut slope (a
    hip, a cross gable, the lantern tower) is underlaid only where it is slated."""
    _lib_slate_roof(p, e0, along, up, la, lu, seed=seed, step=step, seg=seg, thick=thick, clip=clip, under=under)
    nx = along[1] * up[2] - along[2] * up[1]
    ny = along[2] * up[0] - along[0] * up[2]
    nz = along[0] * up[1] - along[1] * up[0]
    if ny < 0:
        nx, ny, nz = -nx, -ny, -nz

    def at(a, s_, lift):
        return (e0[0] + along[0] * a + up[0] * s_ + nx * lift, e0[1] + along[1] * a + up[1] * s_ + ny * lift,
                e0[2] + along[2] * a + up[2] * s_ + nz * lift)
    rows = max(1, int(round(lu / step)))
    rstep = lu / rows
    for r in range(rows):
        s0 = r * rstep
        spans = [(0.0, la)] if clip is None else clip(s0, min(lu, s0 + rstep * 1.3))
        if not spans:
            continue
        s1 = min(lu, s0 + rstep)
        for (a0, a1) in spans:
            if a1 - a0 > 0.15:
                flat_face(p, [at(a0, s0, UNDERLAY), at(a1, s0, UNDERLAY), at(a1, s1, UNDERLAY), at(a0, s1, UNDERLAY)],
                          PAL['slate_ridge'], SLATE, (nx, ny, nz))


# ---------------------------------------------------------------------------
# The guild's crest: our own sign, a lantern over two crossed swords on a blue heater shield,
# a gilded border, laurels and a scroll
# ---------------------------------------------------------------------------
def guild_crest(p, x, y, z):
    """The guild's crest on a face at z (its own front toward -z): the painted crest where it is
    packed (guild_props.py), else built."""
    if has('guild_crest'):
        hang(p, 'guild_crest', (x, y - 0.1, z), (0.0, -1.0), 2.7, standoff=0.03)
        return
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
        for sgn in (1, -1):
            pts = [(x + sgn * wa, ya, z - 0.1), (x + sgn * (wa + 0.14), ya, z - 0.1),
                   (x + sgn * (wb + 0.14), yb, z - 0.1), (x + sgn * wb, yb, z - 0.1),
                   (x + sgn * wa, ya, z - 0.14 - 2.5 * LAYER), (x + sgn * (wa + 0.14), ya, z - 0.14 - 2.5 * LAYER),
                   (x + sgn * (wb + 0.14), yb, z - 0.14 - 2.5 * LAYER), (x + sgn * wb, yb, z - 0.14 - 2.5 * LAYER)]
            hexa(p, pts, PAL['gold'], METAL)
    abox(p, x - w - 0.14, x + w + 0.14, y + hgt / 2 - 0.02, y + hgt / 2 + 0.14, z - 0.14 - 4 * LAYER, z, PAL['gold'],
         METAL)
    face = z - 0.14
    # two crossed swords, silver blades and gilded guards, each a layer over the field
    for k, sgn in enumerate((1, -1)):
        lift = face - (1 + k) * LAYER
        a, b = (x - sgn * 1.0, y - 0.95), (x + sgn * 0.95, y + 0.85)
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy)
        px, py = -dy / n * 0.09, dx / n * 0.09
        flat_face(p, [(a[0] + px, a[1] + py, lift), (a[0] - px, a[1] - py, lift), (b[0], b[1], lift)],
                  PAL['silver'], METAL, (0, 0, -1))
        gx, gy = a[0] + dx * 0.18, a[1] + dy * 0.18
        flat_face(p, [(gx + px * 3.2, gy + py * 3.2, lift - LAYER), (gx + px * 3.2 + dx / n * 0.1, gy + py * 3.2 + dy / n * 0.1, lift - LAYER),
                      (gx - px * 3.2 + dx / n * 0.1, gy - py * 3.2 + dy / n * 0.1, lift - LAYER),
                      (gx - px * 3.2, gy - py * 3.2, lift - LAYER)], PAL['gold'], METAL, (0, 0, -1))
    # the lantern over the cross: a gilded frame round a pane of lit amber, a ring on top
    lift = face - 4 * LAYER
    ly = y + 0.2
    flat_face(p, [(x - 0.42, ly - 0.5, lift), (x + 0.42, ly - 0.5, lift), (x + 0.42, ly + 0.45, lift),
                  (x - 0.42, ly + 0.45, lift)], PAL['gold'], METAL, (0, 0, -1))
    flat_face(p, [(x - 0.28, ly - 0.38, lift - LAYER), (x + 0.28, ly - 0.38, lift - LAYER),
                  (x + 0.28, ly + 0.32, lift - LAYER), (x - 0.28, ly + 0.32, lift - LAYER)], PAL['lantern_lit'], METAL,
              (0, 0, -1))
    flat_face(p, [(x - 0.55, ly + 0.45, lift), (x + 0.55, ly + 0.45, lift), (x, ly + 0.85, lift)], PAL['gold_dark'],
              METAL, (0, 0, -1))
    p.ring((x, ly + 0.98, lift - 0.02), 0.13, 0.035, PAL['gold'], 8, axis=(0, 0, 1), mat=METAL)
    for sgn in (1, -1):
        for k in range(9):
            a = -1.2 + 2.0 * k / 8
            r = w + 0.65
            lx = x + sgn * math.cos(a) * r
            ly2 = y - 0.1 + math.sin(a) * r * 0.95
            p.box((lx, ly2, z - 0.1), (0.42, 0.18, 0.06), PAL['gold'] if k % 2 else PAL['gold_dark'], METAL,
                  roll=sgn * (a + math.pi / 2) * 0.9)
    abox(p, x - 1.6, x + 1.6, y - hgt / 2 - 0.55, y - hgt / 2 - 0.18, z - 0.16, z, PAL['cream'], METAL)
    for sgn in (1, -1):
        p.cylinder((x + sgn * 1.6, y - hgt / 2 - 0.36, z - 0.2), (x + sgn * 1.6, y - hgt / 2 - 0.36, z + 0.02),
                   0.22, PAL['cream'], METAL, sides=8)


crest = guild_crest


# ---------------------------------------------------------------------------
# Small pieces
# ---------------------------------------------------------------------------
def arch_ring(p, wall, u0, u1, spring, t, color=None, n=7, depth=0.3):
    """A dressed-stone round arch over an opening (u0..u1) springing at `spring`, on both
    faces, with the stone between the arch and the square head the opening was cut to (every
    voussoir dressed stone, the keystone too: a gilded one drew as a flat yellow block)."""
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
            hexa(p, pts, tone(color, i, s, u0), STONE)
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

