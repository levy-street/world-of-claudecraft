"""The Highwatch manor's walled garden: a low ashlar wall with a gilded coping band round the
front court, the gate between two tall piers topped with gilded finials and an open wrought
iron gate, a flagged path to the porch steps between clipped box hedges, four lamps, a
fountain in the west parterre, a stone bench and topiary cones in the east, flower beds.

Everything sits on the level pad the town stamps under the manor (the model's ground line);
the paving lies a hair over it. Parts: ManorGrounds and ManorGlow (the lamps' panes).
"""
import math

from manor_lib import GLOW, GLOW_LANTERN, LAYER, METAL, PAL, STONE, WOOD, Wall, abox, cyl, disc, flat_face, hashf, pick, tone
from manor_plan import (BENCH, EAST, FLOOR, FOUNTAIN, GARDEN, GATE, LAMPS, STEPS, WEST)
from manor_shell import _ashlar_face, _ball, finial, hanging_lantern

G = GARDEN
# the path's flags a layer over their mortar bed, the bed a layer over the lawn (at 0.03)
PAVE = 0.03 + 2 * LAYER


def garden_wall(p, x0, z0, x1, z1, outward, seed=0):
    t, h = G['t'], G['h']
    w = Wall(x0, z0, x1, z1, outward)
    L = w.length
    w.box(p, 0.0, L, -1.0, h - 0.12, -t / 2, t / 2, PAL['mortar'], STONE)
    _ashlar_face(p, w, 0.0, L, -0.2, h - 0.14, t / 2, seed=seed)
    # the garden side: a dressed face with a course line
    w.box(p, 0.0, L, -0.2, h - 0.14, -t / 2 - 0.03, -t / 2 + 0.01, tone(PAL['ashlar'][2], seed), STONE)
    w.box(p, 0.0, L, 0.6, 0.66, -t / 2 - 0.05, -t / 2, PAL['mortar'], STONE)
    # the coping: a dressed cap with a gilded band, and squat piers along the run
    w.box(p, 0.0, L, h - 0.14, h, -t / 2 - 0.08, t / 2 + 0.08, PAL['ashlar_hi'], STONE)
    w.box(p, 0.0, L, h - 0.2, h - 0.15, -t / 2 - 0.09, t / 2 + 0.09, PAL['gold_dark'], METAL)
    n = max(1, int(L / 5.5))
    for k in range(n + 1):
        u = min(L - 0.4, max(0.4, L * k / n))
        w.box(p, u - 0.4, u + 0.4, -1.0, h + 0.45, -t / 2 - 0.12, t / 2 + 0.12, tone(PAL['ashlar_hi'], u, seed), STONE)
        # the pier's cap, chamfered
        cx_, _, cz_ = w.pt(u, 0, 0)
        ha, hw = 0.48, t / 2 + 0.2
        hx, hz = (ha, hw) if abs(w.dx) > 0.5 else (hw, ha)
        abox(p, cx_ - hx, cx_ + hx, h + 0.45, h + 0.6, cz_ - hz, cz_ + hz, PAL['ashlar_hi'], STONE, bevel=0.04)
        cx, _, cz = w.pt(u, 0, 0)
        p.prism((cx, h + 0.6, cz), 4, 0.36, 0.05, 0.42, PAL['slate'][1], STONE, axis=(0, 1, 0), phase=math.pi / 4)


def gate(p, glow):
    z = G['z0'] + G['t'] / 2
    pw = GATE['pier']
    for sx in (-1, 1):
        x = sx * (GATE['x1'] + pw / 2)
        abox(p, x - pw / 2, x + pw / 2, -1.0, GATE['pier_h'], z - pw / 2, z + pw / 2, PAL['mortar'], STONE)
        v = -0.4
        k = 0
        while v < GATE['pier_h'] - 0.3:
            vb = min(GATE['pier_h'] - 0.3, v + 0.55)
            ext = 0.06 if k % 2 == 0 else 0.0
            abox(p, x - pw / 2 - 0.04 - ext, x + pw / 2 + 0.04 + ext, v + 0.02, vb - 0.02, z - pw / 2 - 0.04 - ext,
                 z + pw / 2 + 0.04 + ext, tone(pick(PAL['ashlar'], k), k, sx), STONE)
            v = vb
            k += 1
        abox(p, x - pw / 2 - 0.15, x + pw / 2 + 0.15, GATE['pier_h'] - 0.3, GATE['pier_h'], z - pw / 2 - 0.15,
             z + pw / 2 + 0.15, PAL['ashlar_hi'], STONE)
        abox(p, x - pw / 2 - 0.16, x + pw / 2 + 0.16, GATE['pier_h'] - 0.22, GATE['pier_h'] - 0.16,
             z - pw / 2 - 0.16, z + pw / 2 + 0.16, PAL['gold'], METAL)
        _ball(p, x, GATE['pier_h'] + 0.42, z, 0.36)
        finial(p, x, GATE['pier_h'] + 0.7, z, h=0.9, r=0.12)
        # a lantern on a bracket on each pier's garden face (the pane glows)
        hanging_lantern(p, glow, x - sx * 0.9, GATE['pier_h'] - 0.5, z + 0.1, drop=0.3, size=0.36)
        p.beam([(x - sx * pw / 2, GATE['pier_h'] - 0.45, z + 0.1), (x - sx * 0.9, GATE['pier_h'] - 0.45, z + 0.1)],
               0.06, 0.06, PAL['iron'], METAL)
    # the wrought iron gate's two leaves, swung open into the garden
    for sx in (-1, 1):
        hinge = (sx * GATE['x1'], z + 0.2)
        lw = GATE['x1'] - 0.1
        ang = sx * 1.25
        dx, dz = -sx * math.cos(1.25), math.sin(1.25)
        ex, ez = hinge[0] + dx * lw, hinge[1] + dz * lw
        for v in (0.25, 1.3, 2.3):
            p.beam([(hinge[0], v, hinge[1]), (ex, v, ez)], 0.07, 0.07, PAL['iron'], METAL)
        n = 9
        for k in range(n + 1):
            f = k / n
            bx, bz = hinge[0] + dx * lw * f, hinge[1] + dz * lw * f
            top = 2.3 + 0.55 * math.sin(math.pi * f) + 0.2
            cyl(p, bx, 0.1, top, bz, 0.035, PAL['iron'], METAL, sides=4)
            p.prism((bx, top, bz), 4, 0.07, 0.0, 0.22, PAL['gold'], METAL, axis=(0, 1, 0))
        # a scroll of gilded iron in the middle of each leaf
        mx, mz = hinge[0] + dx * lw * 0.5, hinge[1] + dz * lw * 0.5
        p.ring((mx, 1.8, mz), 0.32, 0.04, PAL['gold'], 12, axis=(dz, 0, -dx), mat=METAL)
        _ = ang


def path_and_beds(p):
    # the flagged path from the gate to the steps on a mortar bed, its kerbs
    x0, x1 = -2.1, 2.1
    za, zb = G['z0'] + G['t'], STEPS['z0']
    flat_face(p, [(x0, PAVE - LAYER, za), (x1, PAVE - LAYER, za), (x1, PAVE - LAYER, zb), (x0, PAVE - LAYER, zb)],
              PAL['mortar'], STONE, (0, 1, 0))
    z = za
    row = 0
    while z < zb - 0.05:
        z1 = min(zb, z + 0.9 + 0.3 * hashf(row, 3))
        x = x0 - (0.6 if row % 2 else 0.0)
        while x < x1 - 0.05:
            xb = min(x1, x + 1.1 + 0.4 * hashf(x, row))
            xa = max(x0, x)
            if xb - xa > 0.15:
                flat_face(p, [(xa + 0.03, PAVE, z + 0.03), (xb - 0.03, PAVE, z + 0.03), (xb - 0.03, PAVE, z1 - 0.03),
                              (xa + 0.03, PAVE, z1 - 0.03)],
                          tone(pick(PAL['flag'], int(hashf(xa, row) * 4)), xa, row, spread=0.16), STONE, (0, 1, 0))
            x = xb
        z = z1
        row += 1
    for sx in (-1, 1):
        abox(p, sx * 2.1 - 0.12, sx * 2.1 + 0.12, -0.1, PAVE + 0.12, za, zb, PAL['ashlar_hi'], STONE)
    # the cross path to the fountain and to the bench
    for (xa, xb) in ((2.2, FOUNTAIN['x'] - FOUNTAIN['r'] - 0.6), (BENCH['x'] + 1.0, -2.2)):
        zc = -21.2 if xa > 0 else BENCH['z'] + 0.9
        abox(p, min(xa, xb), max(xa, xb), -0.1, PAVE - 0.01, zc - 0.8, zc + 0.8, PAL['flag'][1], STONE)
    # clipped box hedges either side of the path, broken for the lamps and the cross paths
    for sx in (-1, 1):
        x = sx * 3.0
        runs = [(za + 0.6, -26.3), (-24.9, -22.2), (-20.2, zb - 0.4)]
        for (a, b) in runs:
            if b - a > 0.4:
                hedge(p, x - 0.45, x + 0.45, a, b, 1.0)
    # flower beds along the house's front, either side of the porch
    for (bx0, bx1) in ((WEST['x0'] + 0.6, WEST['ox1'] - 0.6), (EAST['ox0'] + 0.6, EAST['x1'] - 0.6)):
        bz0, bz1 = WEST['oz0'] - 2.0, WEST['oz0'] - 0.2
        abox(p, bx0, bx1, -0.1, 0.32, bz0, bz1, PAL['ashlar_hi'], STONE)
        soil = 0.32 + LAYER
        flat_face(p, [(bx0 + 0.12, soil, bz0 + 0.12), (bx1 - 0.12, soil, bz0 + 0.12), (bx1 - 0.12, soil, bz1 - 0.12),
                      (bx0 + 0.12, soil, bz1 - 0.12)], (0.24, 0.18, 0.12), WOOD, (0, 1, 0))
        x = bx0 + 0.5
        k = 0
        while x < bx1 - 0.4:
            for zz in (bz0 + 0.55, bz1 - 0.55):
                p.rock_blob((x, 0.55, zz), (0.55, 0.45, 0.55), pick(PAL['hedge'], k), WOOD, jitter=0.18)
                p.rock_blob((x + 0.1, 0.8, zz), (0.3, 0.25, 0.3), pick(PAL['bloom'], int(hashf(x, zz) * 4)), WOOD,
                            jitter=0.2)
            x += 0.9
            k += 1


def hedge(p, x0, x1, z0, z1, h):
    abox(p, x0, x1, -0.1, h, z0, z1, pick(PAL['hedge'], int(x0 * 3 + z0)), WOOD)
    # a softer clipped top
    abox(p, x0 + 0.08, x1 - 0.08, h, h + 0.12, z0 + 0.08, z1 - 0.08, PAL['hedge'][2], WOOD)


def lamp(p, glow, x, z):
    """A garden lamp: a stone foot, a fluted iron post, a gilded collar and a lit lantern."""
    abox(p, x - 0.3, x + 0.3, -0.2, 0.45, z - 0.3, z + 0.3, PAL['ashlar_hi'], STONE)
    cyl(p, x, 0.45, 3.1, z, 0.09, PAL['iron'], METAL, sides=8, r1=0.07)
    cyl(p, x, 2.9, 3.05, z, 0.14, PAL['gold'], METAL, sides=8)
    abox(glow, x - 0.22, x + 0.22, 3.1, 3.62, z - 0.22, z + 0.22, PAL['lantern_lit'], GLOW_LANTERN)
    for sx in (-1, 1):
        for sz in (-1, 1):
            abox(p, x + sx * 0.23 - 0.03, x + sx * 0.23 + 0.03, 3.08, 3.64, z + sz * 0.23 - 0.03, z + sz * 0.23 + 0.03,
                 PAL['gold_dark'], METAL)
    p.prism((x, 3.62, z), 4, 0.38, 0.03, 0.34, PAL['iron'], METAL, axis=(0, 1, 0), phase=math.pi / 4)
    _ball(p, x, 4.02, z, 0.07)


def fountain(p):
    F = FOUNTAIN
    x, z, r = F['x'], F['z'], F['r']
    n = 8
    ph = math.pi / 8
    for i in range(n):
        a0, a1 = ph + math.tau * i / n, ph + math.tau * (i + 1) / n
        for (ra, rb, y0, y1, col) in ((r - 0.3, r, -0.3, 0.7, tone(PAL['ashlar_hi'], i)),
                                      (r - 0.35, r + 0.08, 0.7, 0.82, PAL['ashlar_hi'])):
            pts = [(x + math.cos(a0) * ra, y0, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y0, z + math.sin(a1) * ra),
                   (x + math.cos(a1) * rb, y0, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y0, z + math.sin(a0) * rb),
                   (x + math.cos(a0) * ra, y1, z + math.sin(a0) * ra), (x + math.cos(a1) * ra, y1, z + math.sin(a1) * ra),
                   (x + math.cos(a1) * rb, y1, z + math.sin(a1) * rb), (x + math.cos(a0) * rb, y1, z + math.sin(a0) * rb)]
            from manor_lib import hexa
            hexa(p, pts, col, STONE)
    disc(p, x, 0.52, z, r - 0.28, PAL['water'], STONE, sides=8)
    # the column and its basin, the upper bowl, the water falling (pale strips)
    cyl(p, x, 0.5, 2.0, z, 0.32, PAL['ashlar_hi'], STONE, sides=10, r1=0.24)
    p.prism((x, 2.0, z), 12, 0.3, 1.1, 0.4, PAL['ashlar_hi'], STONE, axis=(0, 1, 0))
    disc(p, x, 2.36, z, 1.0, PAL['water'], STONE, sides=12)
    cyl(p, x, 2.4, 3.0, z, 0.14, PAL['ashlar_hi'], STONE, sides=8)
    _ball(p, x, 3.2, z, 0.22)
    for k in range(8):
        a = math.tau * k / 8
        bx, bz = x + math.cos(a) * 1.08, z + math.sin(a) * 1.08
        p.beam([(bx, 2.4, bz), (x + math.cos(a) * 1.45, 0.55, z + math.sin(a) * 1.45)], 0.12, 0.03, (0.62, 0.78, 0.84),
               STONE, up=(math.cos(a), 0, math.sin(a)))


def stone_bench(p):
    B = BENCH
    x, z, w = B['x'], B['z'], B['w']
    abox(p, x - w / 2, x + w / 2, 0.42, 0.55, z - 0.35, z + 0.35, PAL['ashlar_hi'], STONE)
    for sx in (-1, 1):
        abox(p, x + sx * (w / 2 - 0.35) - 0.22, x + sx * (w / 2 - 0.35) + 0.22, -0.1, 0.42, z - 0.3, z + 0.3,
             PAL['ashlar'][1], STONE)
    # topiary cones either side of the bench and in the east parterre's corners
    for (tx, tz) in ((x - w / 2 - 1.2, z), (x + w / 2 + 1.2, z), (-20.6, -25.6), (-8.6, -25.6), (8.6, -25.6),
                     (20.6, -25.6)):
        cyl(p, tx, -0.1, 0.5, tz, 0.45, (0.55, 0.34, 0.22), STONE, sides=8, r1=0.38)
        p.prism((tx, 0.5, tz), 8, 0.62, 0.05, 2.0, PAL['hedge'][1], WOOD, axis=(0, 1, 0))
        p.prism((tx, 0.5, tz), 8, 0.62, 0.62, 0.0001, PAL['hedge'][1], WOOD, axis=(0, 1, 0))


def lawn(p):
    """A mown lawn over the court (the terrain's grass is cleared under the model's reach)."""
    x0, x1 = G['x0'] + G['t'], G['x1'] - G['t']
    z0, z1 = G['z0'] + G['t'], WEST['oz0']
    n = 6
    for i in range(n):
        for j in range(4):
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            za, zb = z0 + (z1 - z0) * j / 4, z0 + (z1 - z0) * (j + 1) / 4
            col = tone(PAL['lawn'], i, j, spread=0.1) if (i + j) % 2 else tone(scale(PAL['lawn'], 0.92), i, j, spread=0.1)
            flat_face(p, [(xa, 0.03, za), (xb, 0.03, za), (xb, 0.03, zb), (xa, 0.03, zb)], col, WOOD, (0, 1, 0))


def scale(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def build(m, parts):
    g, glow = parts['ManorGrounds'], parts['ManorGlow']
    # the front wall either side of the gate, then the two side walls back to the wings
    garden_wall(g, G['x0'], G['z0'] + G['t'] / 2, GATE['x0'] - GATE['pier'], G['z0'] + G['t'] / 2, (0, -1), seed=1)
    garden_wall(g, GATE['x1'] + GATE['pier'], G['z0'] + G['t'] / 2, G['x1'], G['z0'] + G['t'] / 2, (0, -1), seed=2)
    garden_wall(g, G['x0'] + G['t'] / 2, G['z0'], G['x0'] + G['t'] / 2, EAST['oz0'], (-1, 0), seed=3)
    garden_wall(g, G['x1'] - G['t'] / 2, G['z0'], G['x1'] - G['t'] / 2, WEST['oz0'], (1, 0), seed=4)
    gate(g, glow)
    lawn(g)
    path_and_beds(g)
    for (lx, lz) in LAMPS:
        lamp(g, glow, lx, lz)
    fountain(g)
    stone_bench(g)
    _ = (FLOOR, hashf)
