"""The Highwatch manor's furnishings, room by room: the great hall (tables, settles round the
hearth, banners, tapestries, the weapon and trophy walls, two wheel chandeliers high under
the trusses), the dais (the high table, the lord's chair, standing candelabra), the dining
hall (the feast table, high-backed chairs, a sideboard, a chandelier), the kitchen (the range,
the work table, the dresser, pots, sacks and barrels), the library (shelves with a ladder, the
reading desk, a globe, armchairs) and the chapel (the altar with its candles, pews).

Everything solid a player could walk into stands inside one of the plan's collision boxes
(manor_plan.collision_boxes); the walking lines (door to hearth to dais, arch to arch) are
kept clear. Parts: G_INT_Furnishings (furniture, cloth, books, clutter) and ManorGlow (candle
flames, lit lantern panes, embers).
"""
import math

from manor_lib import (GLOW, GLOW_CANDLE, LAYER, METAL, PAL, STONE, WOOD, abox, cbox, cyl, disc, flat_face, hashf, pick, tone)
from manor_plan import (BAY, CHAPEL, CHAPEL_DOOR, DAIS, EAST, FLOOR, HALL, KITCHEN, WEST)
from manor_shell import chain

H = HALL


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------
def table(p, x, z, lx, lz, y=FLOOR, h=1.0, top=0.12, col=None, cloth=None):
    """A trestle table lx by lz with its top at y + h: a thick plank top, two trestles and a
    stretcher; an optional runner of cloth down its length."""
    col = col or PAL['oak'][0]
    abox(p, x - lx / 2, x + lx / 2, y + h - top, y + h, z - lz / 2, z + lz / 2, col, WOOD)
    along_x = lx >= lz
    for s in (-1, 1):
        if along_x:
            tx = x + s * (lx / 2 - 0.6)
            abox(p, tx - 0.12, tx + 0.12, y, y + h - top, z - lz / 2 + 0.25, z + lz / 2 - 0.25, PAL['oak_dark'], WOOD)
            abox(p, tx - 0.18, tx + 0.18, y, y + 0.14, z - lz / 2 + 0.1, z + lz / 2 - 0.1, PAL['oak_dark'], WOOD)
        else:
            tz = z + s * (lz / 2 - 0.6)
            abox(p, x - lx / 2 + 0.25, x + lx / 2 - 0.25, y, y + h - top, tz - 0.12, tz + 0.12, PAL['oak_dark'], WOOD)
            abox(p, x - lx / 2 + 0.1, x + lx / 2 - 0.1, y, y + 0.14, tz - 0.18, tz + 0.18, PAL['oak_dark'], WOOD)
    if along_x:
        abox(p, x - lx / 2 + 0.6, x + lx / 2 - 0.6, y + 0.35, y + 0.5, z - 0.08, z + 0.08, PAL['oak_dark'], WOOD)
    else:
        abox(p, x - 0.08, x + 0.08, y + 0.35, y + 0.5, z - lz / 2 + 0.6, z + lz / 2 - 0.6, PAL['oak_dark'], WOOD)
    if cloth:
        if along_x:
            abox(p, x - lx / 2 + 0.3, x + lx / 2 - 0.3, y + h, y + h + LAYER, z - 0.5, z + 0.5, cloth, WOOD)
        else:
            abox(p, x - 0.5, x + 0.5, y + h, y + h + LAYER, z - lz / 2 + 0.3, z + lz / 2 - 0.3, cloth, WOOD)


def bench(p, x, z, lx, lz, y=FLOOR, h=0.55, col=None):
    col = col or PAL['oak'][1]
    abox(p, x - lx / 2, x + lx / 2, y + h - 0.1, y + h, z - lz / 2, z + lz / 2, col, WOOD)
    for s in (-1, 1):
        if lx >= lz:
            bx = x + s * (lx / 2 - 0.35)
            abox(p, bx - 0.08, bx + 0.08, y, y + h - 0.1, z - lz / 2 + 0.05, z + lz / 2 - 0.05, PAL['oak_dark'], WOOD)
        else:
            bz = z + s * (lz / 2 - 0.35)
            abox(p, x - lx / 2 + 0.05, x + lx / 2 - 0.05, y, y + h - 0.1, bz - 0.08, bz + 0.08, PAL['oak_dark'], WOOD)


def chair(p, x, z, face, y=FLOOR, high=2.6, col=None, carved=False, cushion=None):
    """A high-backed chair facing `face` (radians about +y, 0 = +z): a seat, four legs, arms,
    a tall back with a carved crest rail."""
    col = col or PAL['oak'][2]
    c, s = math.cos(face), math.sin(face)

    def at(lx, lz):
        return x + lx * c + lz * s, z - lx * s + lz * c
    sw, sd = 0.9, 0.85
    sy = y + 0.6
    cx, cz = at(0, 0)
    cbox(p, cx, sy, cz, sw, 0.1, sd, col, WOOD, yaw=face)
    if cushion:
        cbox(p, cx, sy + 0.08, cz, sw - 0.12, 0.08, sd - 0.12, cushion, WOOD, yaw=face)
    for (lx, lz) in ((-0.38, -0.36), (0.38, -0.36), (-0.38, 0.36), (0.38, 0.36)):
        px, pz = at(lx, lz)
        p.prism((px, y, pz), 4, 0.07, 0.07, sy - 0.05 - y, PAL['oak_dark'], WOOD, axis=(0, 1, 0), cap0=False,
                cap1=False, phase=math.pi / 4 + face)
    # the back (at local -z: the sitter faces +z local)
    bx, bz = at(0, -0.43)
    # back, posts and crest rail each a layer deeper (and the back a layer narrower) than the
    # piece behind it, so no two of their faces share a plane
    cbox(p, bx, sy + (high - 0.6) / 2, bz, sw - 2 * LAYER, high - 0.6, 0.1, col, WOOD, yaw=face)
    if cushion:
        kx, kz = at(0, -0.33)
        # the back's cushion stops under the crest rail
        kh = min(1.2, high - 1.0)
        cbox(p, kx, sy + 0.3 + kh / 2, kz, sw - 0.2, kh, 0.06, cushion, WOOD, yaw=face)
    for lx in (-0.44, 0.44):
        px, pz = at(lx, -0.43)
        cbox(p, px, sy + (high - 0.45 + LAYER) / 2 - 0.05 - LAYER, pz, 0.12, high - 0.45 + LAYER, 0.1 + 2 * LAYER, PAL['oak_dark'], WOOD, yaw=face)
        if carved:
            ax, az = at(lx, 0.0)
            cbox(p, ax, sy + 0.4, az, 0.12 + 2 * LAYER, 0.08, 0.8, PAL['oak_dark'], WOOD, yaw=face)
    tx, tz = at(0, -0.43)
    cbox(p, tx, sy + high - 0.5, tz, sw + 0.15, 0.22, 0.1 + 4 * LAYER, PAL['gold_dark'] if carved else PAL['oak_dark'],
         METAL if carved else WOOD, yaw=face)
    if carved:
        cbox(p, tx, sy + high - 0.2, tz, 0.35, 0.35, 0.1 + 6 * LAYER, PAL['gold'], METAL, yaw=face)


def rug(p, x0, x1, z0, z1, y=FLOOR + LAYER, field=None, border=None, seed=0):
    """A woven rug a layer over the floor: a border round a field in one plane (never one
    over the other), a row of lozenges a layer above the field, and its edges."""
    field = field or PAL['garnet']
    border = border or PAL['blue_dark']
    b = min(x1 - x0, z1 - z0) * 0.1
    xa, xb, za, zb = x0 + b, x1 - b, z0 + b, z1 - b
    for quad in (((x0, z0), (x1, z0), (x1, za), (x0, za)), ((x0, zb), (x1, zb), (x1, z1), (x0, z1)),
                 ((x0, za), (xa, za), (xa, zb), (x0, zb)), ((xb, za), (x1, za), (x1, zb), (xb, zb))):
        flat_face(p, [(qx, y, qz) for (qx, qz) in quad], border, WOOD, (0, 1, 0))
    flat_face(p, [(xa, y, za), (xb, y, za), (xb, y, zb), (xa, y, zb)], field, WOOD, (0, 1, 0))
    # the rug's thickness, so the layer reads as cloth on the floor, not a sheet floating
    edge = scale_dark(border)
    for (pa, pb, n) in (((x0, z0), (x1, z0), (0, 0, -1)), ((x1, z0), (x1, z1), (1, 0, 0)),
                        ((x1, z1), (x0, z1), (0, 0, 1)), ((x0, z1), (x0, z0), (-1, 0, 0))):
        flat_face(p, [(pa[0], y - LAYER, pa[1]), (pb[0], y - LAYER, pb[1]), (pb[0], y, pb[1]), (pa[0], y, pa[1])],
                  edge, WOOD, n)
    y = y + LAYER
    along_x = x1 - x0 >= z1 - z0
    n = max(2, int(max(x1 - x0, z1 - z0) / 1.6))
    for k in range(n):
        f = (k + 0.5) / n
        cx = x0 + (x1 - x0) * f if along_x else (x0 + x1) / 2
        cz = (z0 + z1) / 2 if along_x else z0 + (z1 - z0) * f
        r = min(min(x1 - x0, z1 - z0) * 0.22, max(x1 - x0, z1 - z0) / n * 0.45)
        flat_face(p, [(cx - r, y, cz), (cx, y, cz - r), (cx + r, y, cz), (cx, y, cz + r)],
                  PAL['gold_dark'] if k % 2 else PAL['cream'], WOOD, (0, 1, 0))


def banner(p, x, z, y_top, normal, width=1.6, length=4.2, field=None, emblem=True):
    """A hanging banner on a gilded rod off a wall: a cloth with a swallow-tail, a gold border
    stripe and the hold's three peaks under the beacon. `normal` is the wall's inward face
    direction (dx, dz); the banner hangs a hand off the wall."""
    field = field or PAL['blue']
    nx, nz = normal
    ax, az = nz, -nx  # along the wall
    off = 0.14

    def pt(u, v, w=0.0):
        return (x + ax * u + nx * (off + w), v, z + az * u + nz * (off + w))
    cyl_h = 0.06
    p.cylinder(pt(-width / 2 - 0.25, y_top + 0.1), pt(width / 2 + 0.25, y_top + 0.1), cyl_h, PAL['gold'], METAL,
               sides=6)
    for sgn in (-1, 1):
        p.prism(pt(sgn * (width / 2 + 0.3), y_top + 0.1), 6, 0.11, 0.11, 0.0001, PAL['gold'], METAL,
                axis=(ax * sgn, 0, az * sgn))
    yb = y_top - length
    tail = length * 0.15
    body = [pt(-width / 2, y_top), pt(width / 2, y_top), pt(width / 2, yb), pt(0, yb + tail), pt(-width / 2, yb)]
    flat_face(p, body, field, WOOD, (nx, 0, nz))
    back = [pt(-width / 2, y_top, -0.01), pt(width / 2, y_top, -0.01), pt(width / 2, yb, -0.01),
            pt(0, yb + tail, -0.01), pt(-width / 2, yb, -0.01)]
    flat_face(p, back, scale_dark(field), WOOD, (-nx, 0, -nz))
    # the border stripes
    for u in (-width / 2 + 0.12, width / 2 - 0.12):
        flat_face(p, [pt(u - 0.05, y_top - 0.1, LAYER), pt(u + 0.05, y_top - 0.1, LAYER),
                      pt(u + 0.05, yb + 0.2, LAYER), pt(u - 0.05, yb + 0.2, LAYER)], PAL['gold'], METAL, (nx, 0, nz))
    flat_face(p, [pt(-width / 2 + 0.1, y_top - 0.25, 2 * LAYER), pt(width / 2 - 0.1, y_top - 0.25, 2 * LAYER),
                  pt(width / 2 - 0.1, y_top - 0.35, 2 * LAYER), pt(-width / 2 + 0.1, y_top - 0.35, 2 * LAYER)],
              PAL['gold'],
              METAL, (nx, 0, nz))
    if emblem:
        cy = y_top - length * 0.42
        s = width * 0.28
        for (px, ph) in ((-0.9, 0.9), (0.0, 1.25), (0.9, 0.85)):
            # the middle peak a layer over its neighbours, which it overlaps
            w_peak = (3 if px == 0.0 else 2) * LAYER
            flat_face(p, [pt(px * s - s * 0.7, cy - s, w_peak), pt(px * s + s * 0.7, cy - s, w_peak),
                          pt(px * s, cy - s + ph * s * 1.4, w_peak)], PAL['silver'], METAL, (nx, 0, nz))
        flat_face(p, [pt(0, cy + s * 1.2, 4 * LAYER), pt(s * 0.32, cy + s * 0.75, 4 * LAYER),
                      pt(0, cy + s * 0.45, 4 * LAYER), pt(-s * 0.32, cy + s * 0.75, 4 * LAYER)], PAL['gold'], METAL,
                  (nx, 0, nz))


def scale_dark(c):
    return (c[0] * 0.7, c[1] * 0.7, c[2] * 0.7)


def tapestry(p, x, z, y0, y1, normal, width, seed=0):
    """A woven hanging on a wall: a border, bands of a hunting scene suggested in blocks of
    colour (a green field, hills, a pale sky, trees), all flat on the wall."""
    nx, nz = normal
    ax, az = nz, -nx

    def pt(u, v, w=0.0):
        return (x + ax * u + nx * (0.075 + LAYER + w), v, z + az * u + nz * (0.075 + LAYER + w))
    p.cylinder(pt(-width / 2 - 0.2, y1 + 0.08), pt(width / 2 + 0.2, y1 + 0.08), 0.07, PAL['oak_dark'], WOOD, sides=6)
    flat_face(p, [pt(-width / 2, y0), pt(width / 2, y0), pt(width / 2, y1), pt(-width / 2, y1)], PAL['garnet_dark'],
              WOOD, (nx, 0, nz))
    b = 0.28
    bands = [(0.0, 0.35, (0.28, 0.38, 0.2)), (0.35, 0.55, (0.36, 0.44, 0.26)), (0.55, 0.72, (0.42, 0.44, 0.5)),
             (0.72, 1.0, (0.7, 0.72, 0.66))]
    for (f0, f1, col) in bands:
        va = y0 + b + (y1 - y0 - 2 * b) * f0
        vb = y0 + b + (y1 - y0 - 2 * b) * f1
        flat_face(p, [pt(-width / 2 + b, va, LAYER), pt(width / 2 - b, va, LAYER), pt(width / 2 - b, vb, LAYER),
                      pt(-width / 2 + b, vb, LAYER)], tone(col, seed, f0), WOOD, (nx, 0, nz))
    # hills and trees and a stag-less hunt: a rider-less banner of shapes (blocks), our own
    k = 0
    u = -width / 2 + b + 0.4
    while u < width / 2 - b - 0.4:
        h = 0.6 + 0.6 * hashf(u, seed)
        vb = y0 + b + (y1 - y0 - 2 * b) * 0.35
        flat_face(p, [pt(u - 0.25, vb, 2 * LAYER), pt(u + 0.25, vb, 2 * LAYER), pt(u, vb + h, 2 * LAYER)],
                  (0.18, 0.3, 0.16), WOOD,
                  (nx, 0, nz))
        u += 0.7 + 0.5 * hashf(k, seed)
        k += 1
    # the sun
    cv = y0 + b + (y1 - y0 - 2 * b) * 0.82
    flat_face(p, [pt(width * 0.22 + 0.3 * math.cos(math.tau * i / 8), cv + 0.3 * math.sin(math.tau * i / 8),
                     3 * LAYER)
                  for i in range(8)], PAL['gold'], WOOD, (nx, 0, nz))
    # the fringe
    for i in range(int(width / 0.18)):
        uu = -width / 2 + 0.09 + i * 0.18
        flat_face(p, [pt(uu - 0.04, y0, 0.012), pt(uu + 0.04, y0, 0.012), pt(uu + 0.04, y0 - 0.22, 0.012),
                      pt(uu - 0.04, y0 - 0.22, 0.012)], PAL['gold_dark'], WOOD, (nx, 0, nz))


def sword(p, x, y, z, ang, normal, length=2.0):
    """A sword flat on a wall at angle `ang` (in the wall's plane, 0 = point up)."""
    nx, nz = normal
    ax, az = nz, -nx
    du, dv = math.sin(ang), math.cos(ang)

    def pt(u, v, w):
        return (x + ax * u + nx * w, y + v, z + az * u + nz * w)
    tip = (du * length * 0.62, dv * length * 0.62)
    hilt = (-du * length * 0.38, -dv * length * 0.38)
    # crossed over the shield's face (0.2 off the wall), each piece a layer proud of the last
    p.beam([pt(0, 0, 0.26), pt(tip[0], tip[1], 0.26)], 0.14, 0.03, PAL['silver'], METAL, up=(nx, 0, nz))
    p.beam([pt(0, 0, 0.27), pt(hilt[0] * 0.75, hilt[1] * 0.75, 0.27)], 0.07, 0.07, PAL['leather'], WOOD, up=(nx, 0, nz))
    gu, gv = math.cos(ang) * 0.36, -math.sin(ang) * 0.36
    p.beam([pt(-gu, -gv, 0.29), pt(gu, gv, 0.29)], 0.08, 0.08, PAL['gold'], METAL, up=(nx, 0, nz))
    cx, cz = pt(hilt[0], hilt[1], 0.29)[0], pt(hilt[0], hilt[1], 0.29)[2]
    p.box((cx, y + hilt[1], cz), (0.14, 0.14, 0.14), PAL['gold'], METAL)


def shield(p, x, y, z, normal, r=0.75, field=None, seed=0):
    """A round shield on a wall: a boss, a rim, a field split in two colours."""
    nx, nz = normal
    a = (x + nx * 0.08, y, z + nz * 0.08)
    b = (x + nx * 0.2, y, z + nz * 0.2)
    p.cylinder(a, b, r, field or PAL['garnet'], WOOD, sides=14)
    p.ring((x + nx * 0.2, y, z + nz * 0.2), r - 0.02, 0.07, PAL['iron'], 14, axis=(nx, 0, nz), mat=METAL)
    p.cylinder(b, (x + nx * 0.34, y, z + nz * 0.34), 0.2, PAL['gold'], METAL, sides=10, r1=0.08)


def antlers(p, x, y, z, normal, size=1.0):
    """A trophy: a carved shield-shaped board with a pair of branching antlers."""
    nx, nz = normal
    ax, az = nz, -nx
    # the board stands clear of a banner hung behind it (0.14 off the wall)
    cbox(p, x + nx * 0.2, y, z + nz * 0.2, 0.9 * size if abs(ax) > 0.5 else 0.12, 1.1 * size,
         0.9 * size if abs(az) > 0.5 else 0.12, PAL['oak_dark'], WOOD)
    for sgn in (-1, 1):
        pts = []
        for k in range(6):
            t = k / 5
            u = sgn * (0.15 + 1.0 * t) * size
            v = (0.2 + 1.1 * t - 0.5 * t * t) * size
            pts.append((x + ax * u + nx * (0.3 + 0.25 * t), y + v, z + az * u + nz * (0.3 + 0.25 * t)))
        p.sweep(pts, 0.07 * size, 0.035 * size, PAL['cream'], sides=5, mat=WOOD)
        for k in (2, 3, 4):
            t = k / 5
            u = sgn * (0.15 + 1.0 * t) * size
            v = (0.2 + 1.1 * t - 0.5 * t * t) * size
            base = (x + ax * u + nx * (0.3 + 0.25 * t), y + v, z + az * u + nz * (0.3 + 0.25 * t))
            tip = (base[0] + ax * sgn * 0.1 * size, base[1] + 0.5 * size, base[2] + az * sgn * 0.1 * size)
            p.sweep([base, tip], 0.04 * size, 0.015 * size, PAL['cream'], sides=4, mat=WOOD)


def candle(glow, p, x, y, z, h=0.35, r=0.06):
    p.prism((x, y, z), 4, r, r, h, PAL['cream'], WOOD, axis=(0, 1, 0), cap0=False, phase=math.pi / 4)
    p_flame(glow, x, y + h, z, 0.05)


def p_flame(glow, x, y, z, s):
    glow.prism((x, y, z), 4, s, 0.0, s * 3.2, PAL['candle'], GLOW_CANDLE, axis=(0, 1, 0), cap0=False)


def candelabrum(p, glow, x, z, y=FLOOR, h=2.6):
    """A standing iron candelabrum: a tripod foot, a stem, a ring of five candles."""
    for k in range(3):
        a = math.tau * k / 3
        p.beam([(x, y + 0.5, z), (x + math.cos(a) * 0.45, y, z + math.sin(a) * 0.45)], 0.06, 0.06, PAL['iron'], METAL)
    cyl(p, x, y + 0.3, y + h, z, 0.05, PAL['iron'], METAL, sides=6)
    p.ring((x, y + h, z), 0.42, 0.05, PAL['gold_dark'], 10, axis=(0, 1, 0), mat=METAL)
    for k in range(5):
        a = math.tau * k / 5
        candle(glow, p, x + math.cos(a) * 0.42, y + h, z + math.sin(a) * 0.42, h=0.3)
    candle(glow, p, x, y + h + 0.1, z, h=0.4)


def chandelier(p, glow, x, z, y, r=1.6, hang_to=None, candles=10):
    """A wheel chandelier: an iron hoop with gilded bands, spokes, candles round the rim, a
    gilded boss, and the chain up to whatever carries it (`hang_to`)."""
    p.ring((x, y, z), r, 0.12, PAL['iron'], 12, axis=(0, 1, 0), mat=METAL)
    p.ring((x, y + 0.12, z), r, 0.05, PAL['gold'], 12, axis=(0, 1, 0), mat=METAL)
    for k in range(3):
        a = math.tau * k / 3 + 0.4
        p.beam([(x, y, z), (x + math.cos(a) * r, y, z + math.sin(a) * r)], 0.07, 0.07, PAL['iron'], METAL, caps=False)
    p.prism((x, y - 0.35, z), 8, 0.05, 0.26, 0.35, PAL['gold'], METAL, axis=(0, 1, 0))
    p.prism((x, y, z), 8, 0.26, 0.05, 0.3, PAL['gold'], METAL, axis=(0, 1, 0))
    for k in range(candles):
        a = math.tau * (k + 0.5) / candles
        cx, cz = x + math.cos(a) * r, z + math.sin(a) * r
        p.prism((cx, y + 0.06, cz), 5, 0.1, 0.1, 0.1, PAL['gold_dark'], METAL, axis=(0, 1, 0), cap0=False)
        candle(glow, p, cx, y + 0.16, cz, h=0.32)
    if hang_to:
        for k in range(3):
            a = math.tau * k / 3
            chain(p, (x + math.cos(a) * r * 0.9, y + 0.1, z + math.sin(a) * r * 0.9), (x, y + 1.4, z), links=4)
        chain(p, (x, y + 1.4, z), (x, hang_to, z))


def shelves(p, x0, x1, z0, z1, y0, y1, face, seed=0, rows=6):
    """A wall of book shelves: a carcass, shelves, and books of every colour on them. `face` is
    the open side's direction (dx, dz)."""
    dark = PAL['walnut']
    fx, fz = face
    along_x = abs(fz) > 0.5
    L = (x1 - x0) if along_x else (z1 - z0)
    depth = (z1 - z0) if along_x else (x1 - x0)
    # carcass front: posts and shelves proud of the back
    sgn = fz if along_x else fx
    # the whole case stands clear of the wall's timber posts (0.075 proud of it) by a layer
    off = 0.075 + LAYER
    front = ((z0 if fz < 0 else z1) if along_x else (x0 if fx < 0 else x1)) + sgn * off
    back = front - sgn * depth
    if along_x:
        abox(p, x0, x1, y0, y1, min(back, back + sgn * 0.1), max(back, back + sgn * 0.1), dark, WOOD)
    else:
        abox(p, min(back, back + sgn * 0.1), max(back, back + sgn * 0.1), y0, y1, z0, z1, dark, WOOD)
    bays = max(1, int(L / 1.5))
    book_cols = [(0.5, 0.12, 0.1), (0.14, 0.24, 0.42), (0.2, 0.36, 0.2), (0.56, 0.4, 0.16), (0.36, 0.2, 0.32),
                 (0.62, 0.52, 0.36), (0.18, 0.16, 0.14), (0.66, 0.2, 0.14)]
    for r in range(rows):
        sy = y0 + 0.3 + (y1 - y0 - 0.5) * r / rows
        sh = (y1 - y0 - 0.5) / rows
        # the shelf board
        if along_x:
            abox(p, x0, x1, sy - 0.05, sy, min(front, front - sgn * (depth - 0.1)), max(front, front - sgn * (depth - 0.1)),
                 PAL['oak'][0], WOOD)
        else:
            abox(p, min(front, front - sgn * (depth - 0.1)), max(front, front - sgn * (depth - 0.1)), sy - 0.05, sy, z0,
                 z1, PAL['oak'][0], WOOD)
        # the books: a run of spines a hand back from the shelf's front
        a = 0.08
        k = 0
        while a < L - 0.1:
            bw = 0.1 + 0.1 * hashf(a, r, seed)
            bh = sh * (0.62 + 0.3 * hashf(r, a, seed + 1))
            if hashf(a, r, seed + 2) < 0.08:
                a += bw * 2
                continue
            col = pick(book_cols, int(hashf(k, r, seed) * 8))
            lean = 0.0
            w0 = front - sgn * (depth - 0.12)
            w1 = front - sgn * 0.08
            # each book is its spine and its top (the shelf's back hides the rest)
            b0, b1 = a, a + bw - 0.01
            if along_x:
                spine = [(x0 + b0, sy, w1), (x0 + b1, sy, w1), (x0 + b1, sy + bh, w1), (x0 + b0, sy + bh, w1)]
                top = [(x0 + b0, sy + bh, w0), (x0 + b1, sy + bh, w0), (x0 + b1, sy + bh, w1), (x0 + b0, sy + bh, w1)]
            else:
                spine = [(w1, sy, z0 + b0), (w1, sy, z0 + b1), (w1, sy + bh, z0 + b1), (w1, sy + bh, z0 + b0)]
                top = [(w0, sy + bh, z0 + b0), (w0, sy + bh, z0 + b1), (w1, sy + bh, z0 + b1), (w1, sy + bh, z0 + b0)]
            flat_face(p, spine, col, WOOD, (fx, 0, fz))
            flat_face(p, top, PAL['parchment'], WOOD, (0, 1, 0))
            if k % 3 == 0:
                g0, g1 = sy + bh * 0.78, sy + bh * 0.78 + 0.04
                wb = w1 + sgn * LAYER
                if along_x:
                    band = [(x0 + b0, g0, wb), (x0 + b1, g0, wb), (x0 + b1, g1, wb), (x0 + b0, g1, wb)]
                else:
                    band = [(wb, g0, z0 + b0), (wb, g0, z0 + b1), (wb, g1, z0 + b1), (wb, g1, z0 + b0)]
                flat_face(p, band, PAL['gold'], METAL, (fx, 0, fz))
            a += bw
            k += 1
            _ = lean
    for b in range(bays + 1):
        a = L * b / bays
        if along_x:
            abox(p, x0 + a - 0.07, x0 + a + 0.07, y0, y1, min(front, front - sgn * depth), max(front, front + sgn * 0.04),
                 PAL['oak_dark'], WOOD)
        else:
            abox(p, min(front, front - sgn * depth), max(front, front + sgn * 0.04), y0, y1, z0 + a - 0.07, z0 + a + 0.07,
                 PAL['oak_dark'], WOOD)
    # the cornice
    if along_x:
        abox(p, x0 - 0.1, x1 + 0.1, y1, y1 + 0.2, min(front + sgn * 0.12, front - sgn * depth),
             max(front + sgn * 0.12, front - sgn * depth), PAL['oak_dark'], WOOD)
    else:
        abox(p, min(front + sgn * 0.12, front - sgn * depth), max(front + sgn * 0.12, front - sgn * depth), y1,
             y1 + 0.2, z0 - 0.1, z1 + 0.1, PAL['oak_dark'], WOOD)


def barrel(p, x, z, y=FLOOR, h=1.1, r=0.45):
    p.prism((x, y, z), 12, r * 0.85, r, h / 2, tone(PAL['oak'][1], x, z), WOOD, axis=(0, 1, 0), cap0=True, cap1=False)
    p.prism((x, y + h / 2, z), 12, r, r * 0.85, h / 2, tone(PAL['oak'][1], x, z), WOOD, axis=(0, 1, 0), cap0=False)
    for f in (0.15, 0.85):
        rr = r * (0.88 + 0.12 * (1 - abs(f - 0.5) * 2))
        p.ring((x, y + h * f, z), rr + 0.01, 0.05, PAL['iron'], 12, axis=(0, 1, 0), mat=METAL)


def sack(p, x, z, y=FLOOR, s=1.0, seed=0):
    p.rock_blob((x, y + 0.38 * s, z), (0.7 * s, 0.8 * s, 0.6 * s), tone(PAL['sack'], seed, x), WOOD, jitter=0.08)
    cyl(p, x, y + 0.72 * s, y + 0.9 * s, z, 0.1 * s, PAL['sack'], WOOD, sides=6, r1=0.16 * s)


def pot(p, x, y, z, r=0.3, col=None):
    col = col or PAL['copper']
    p.prism((x, y, z), 10, r * 0.8, r, r * 0.9, col, METAL, axis=(0, 1, 0), cap0=True, cap1=False)
    p.ring((x, y + r * 0.9, z), r, 0.04, PAL['copper_dark'], 10, axis=(0, 1, 0), mat=METAL)


def plate(p, x, y, z, r=0.22, col=None):
    p.prism((x, y, z), 6, r * 0.85, r, 0.03, col or PAL['pewter'], METAL, axis=(0, 1, 0), cap0=False)


def goblet(p, x, y, z):
    p.prism((x, y, z), 5, 0.07, 0.02, 0.16, PAL['gold'], METAL, axis=(0, 1, 0), cap0=False, cap1=False)
    p.prism((x, y + 0.16, z), 6, 0.04, 0.08, 0.16, PAL['gold'], METAL, axis=(0, 1, 0), cap0=False)


def food(p, x, y, z, seed=0):
    col = pick(PAL['food'], int(hashf(x, z, seed) * 4))
    p.rock_blob((x, y + 0.1, z), (0.3, 0.2, 0.26), col, WOOD, jitter=0.12)


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------
def great_hall(p, glow):
    # two long tables with benches in the south quadrants, clear of the door's line and the
    # arches' line (inside the plan's collision boxes hall_table_w / hall_table_e)
    for sx in (1, -1):
        cx = sx * 8.25
        table(p, cx, -6.4, 6.0, 1.3, cloth=PAL['linen'])
        bench(p, cx, -7.45, 6.0, 0.5)
        bench(p, cx, -5.35, 6.0, 0.5)
        for k in range(5):
            px = cx - 2.4 + k * 1.2
            plate(p, px, FLOOR + 1.0 + LAYER, -6.75)
            plate(p, px + 0.3, FLOOR + 1.0 + LAYER, -6.05)
            if k % 2 == 0:
                goblet(p, px + 0.25, FLOOR + 1.0 + LAYER, -6.75)
            else:
                food(p, px, FLOOR + 1.02 + LAYER, -6.4, seed=k)
        candle(glow, p, cx - 1.5, FLOOR + 1.0 + LAYER, -6.4, h=0.4, r=0.07)
        candle(glow, p, cx + 1.5, FLOOR + 1.0 + LAYER, -6.4, h=0.4, r=0.07)
        # the north quadrants: a chest and two armour-less weapon racks against the back wall
        chest(p, sx * 9.25, H['z1'] - 0.75, 1.6, 0.9, seed=sx)
        for k in range(2):
            rx = sx * (7.6 + k * 3.3)
            weapon_rack(p, rx, H['z1'] - 0.5)
    # rugs on the hearth's axes, never on its ring
    # (the door's rug stops short of the gold star inlaid in the floor by the door)
    rug(p, -1.6, 1.6, -6.0, -4.4, seed=1)
    rug(p, -1.6, 1.6, 4.4, 8.4, field=PAL['blue'], border=PAL['garnet_dark'], seed=2)
    rug(p, 4.6, 9.4, -1.4, 1.4, field=PAL['blue'], border=PAL['garnet_dark'], seed=3)
    rug(p, -9.4, -4.6, -1.4, 1.4, seed=4)
    # banners between the windows on the front and back walls
    for x in (-7.0, 7.0):
        banner(p, x, H['z0'], FLOOR + 9.6, (0, 1), width=1.7, length=4.6,
               field=PAL['blue'] if x > 0 else PAL['garnet'])
    # (the corner pair a hand short of the gable walls, their rods' finials clear of the plaster)
    for x in (-11.7, -6.6, 6.6, 11.7):
        banner(p, x, H['z1'], FLOOR + 9.8, (0, -1), width=1.4, length=4.0,
               field=PAL['garnet'] if abs(x) > 10 else PAL['blue'])
    # tapestries on the gable walls either side of the arches
    for sx in (1, -1):
        for zc in (-6.6, 6.6):
            tapestry(p, sx * H['x1'], zc, FLOOR + 3.4, FLOOR + 8.2, (-sx, 0), 5.0, seed=int(zc) + sx)
    # the weapon walls: crossed swords and shields on the back wall's corners, the trophies over
    for sx in (1, -1):
        base_x = sx * 9.6
        shield(p, base_x, FLOOR + 5.6, H['z1'], (0, -1), r=0.8, field=PAL['blue'] if sx > 0 else PAL['garnet'])
        sword(p, base_x, FLOOR + 5.6, H['z1'], 0.6, (0, -1), length=2.4)
        sword(p, base_x, FLOOR + 5.6, H['z1'], -0.6, (0, -1), length=2.4)
        antlers(p, sx * 12.2, FLOOR + 7.4, H['z1'], (0, -1), size=1.0)
        shield(p, sx * 12.2, FLOOR + 5.3, H['z1'], (0, -1), r=0.55, field=PAL['cream'])
    # two wheel chandeliers high under the trusses, east and west of the hearth
    for sx in (1, -1):
        chandelier(p, glow, sx * 6.5, 0.0, FLOOR + 10.4, r=1.9, hang_to=FLOOR + 16.4, candles=12)
    # wall sconces on the gable walls (candles in gilded cups)
    for sx in (1, -1):
        for zc in (-3.7, 3.7):
            sconce(p, glow, sx * H['x1'], FLOOR + 4.4, zc, (-sx, 0))
    for x in (-3.5, 3.5):
        sconce(p, glow, x, FLOOR + 4.4, H['z0'], (0, 1))


def sconce(p, glow, x, y, z, normal):
    nx, nz = normal
    cbox(p, x + nx * 0.05, y, z + nz * 0.05, 0.3 if abs(nz) > 0.5 else 0.1, 0.5, 0.3 if abs(nx) > 0.5 else 0.1,
         PAL['gold_dark'], METAL)
    p.beam([(x + nx * 0.08, y - 0.1, z + nz * 0.08), (x + nx * 0.42, y + 0.15, z + nz * 0.42)], 0.06, 0.06,
           PAL['iron'], METAL)
    cyl(p, x + nx * 0.45, y + 0.12, y + 0.22, z + nz * 0.45, 0.11, PAL['gold'], METAL, sides=8)
    candle(glow, p, x + nx * 0.45, y + 0.22, z + nz * 0.45, h=0.3)


def chest(p, x, z, lx, lz, seed=0):
    abox(p, x - lx / 2, x + lx / 2, FLOOR, FLOOR + 0.8, z - lz / 2, z + lz / 2, tone(PAL['oak'][1], seed), WOOD)
    p.prism((x - lx / 2 - LAYER, FLOOR + 0.8, z), 8, lz / 2, lz / 2, lx + 2 * LAYER, tone(PAL['oak'][2], seed), WOOD,
            axis=(1, 0, 0),
            squash=0.5)
    for f in (0.2, 0.8):
        abox(p, x - lx / 2 + lx * f - 0.05, x - lx / 2 + lx * f + 0.05, FLOOR, FLOOR + 0.82, z - lz / 2 - 0.02,
             z + lz / 2 + 0.02, PAL['iron'], METAL)
    abox(p, x - 0.12, x + 0.12, FLOOR + 0.55, FLOOR + 0.8, z - lz / 2 - 0.04, z - lz / 2, PAL['gold'], METAL)


def weapon_rack(p, x, z):
    """A rack against the wall: two posts, a rail, three spears and a halberd standing in it."""
    for dx in (-0.8, 0.8):
        abox(p, x + dx - 0.07, x + dx + 0.07, FLOOR, FLOOR + 2.0, z - 0.35, z + 0.15, PAL['oak_dark'], WOOD)
    # the rails a layer inside the posts' faces
    abox(p, x - 0.9, x + 0.9, FLOOR + 1.6, FLOOR + 1.72, z - 0.35 + LAYER, z + 0.15 - LAYER, PAL['oak_dark'], WOOD)
    abox(p, x - 0.9, x + 0.9, FLOOR, FLOOR + 0.12, z - 0.35 + LAYER, z + 0.15 - LAYER, PAL['oak_dark'], WOOD)
    for k in range(4):
        sx = x - 0.6 + k * 0.4
        cyl(p, sx, FLOOR + 0.12, FLOOR + 3.4, z - 0.12, 0.04, PAL['oak'][0], WOOD, sides=5)
        p.prism((sx, FLOOR + 3.4, z - 0.12), 4, 0.1, 0.0, 0.42, PAL['silver'], METAL, axis=(0, 1, 0))
        if k == 3:
            cbox(p, sx + 0.12, FLOOR + 3.1, z - 0.12, 0.3, 0.4, 0.03, PAL['silver'], METAL)


def high_table(p, glow):
    B = BAY
    zt = 14.0
    table(p, 0.0, zt, 8.6, 1.4, y=DAIS, cloth=PAL['garnet'])
    # the cloth of state hanging over the table's front
    abox(p, -4.1, 4.1, DAIS + 0.25, DAIS + 1.0, zt - 0.7 - 1.5 * LAYER, zt - 0.7, PAL['garnet'], WOOD)
    abox(p, -4.1, 4.1, DAIS + 0.25, DAIS + 0.35, zt - 0.7 - 2.5 * LAYER, zt - 0.7 - 1.5 * LAYER, PAL['gold'], METAL)
    for k in range(5):
        px = -3.2 + k * 1.6
        plate(p, px, DAIS + 1.0 + LAYER, zt - 0.2, r=0.26, col=PAL['gold_dark'] if k == 2 else PAL['pewter'])
        goblet(p, px + 0.4, DAIS + 1.0 + LAYER, zt - 0.1)
    for x in (-2.4, 0.0, 2.4):
        candle(glow, p, x, DAIS + 1.0 + LAYER, zt + 0.3, h=0.5, r=0.08)
    food(p, -1.2, DAIS + 1.02 + LAYER, zt + 0.25, seed=3)
    food(p, 1.2, DAIS + 1.02 + LAYER, zt + 0.25, seed=4)
    # the lord's chair in the middle, carved and gilded, and four high-backed chairs
    chair(p, 0.0, zt + 1.3, math.pi, y=DAIS, high=3.4, carved=True, cushion=PAL['garnet'])
    for x in (-3.4, -1.7, 1.7, 3.4):
        chair(p, x, zt + 1.25, math.pi, y=DAIS, high=2.6, cushion=PAL['blue'])
    # banners either side of the great window and standing candelabra at the dais' corners
    for sx in (1, -1):
        banner(p, sx * 4.2, B['z1'], DAIS + 8.0, (0, -1), width=1.5, length=5.0,
               field=PAL['blue'] if sx > 0 else PAL['garnet'])
        candelabrum(p, glow, sx * 5.2, zt - 1.4, y=DAIS, h=2.4)
    rug(p, -4.6, 4.6, 11.3, 16.6, y=DAIS + LAYER, field=PAL['blue'], border=PAL['gold_dark'], seed=8)


def dining(p, glow):
    W = WEST
    xc, zc = 18.9, 0.2
    table(p, xc, zc, 2.0, 10.0, cloth=PAL['linen'])
    for sx in (-1, 1):
        for k in range(5):
            chair(p, xc + sx * 1.55, zc - 4.0 + k * 2.0, -math.pi / 2 if sx > 0 else math.pi / 2, high=2.3,
                  cushion=PAL['garnet'] if k % 2 else PAL['blue'])
    chair(p, xc, zc - 5.7 + 0.5, 0.0, high=3.0, carved=True, cushion=PAL['garnet'])
    chair(p, xc, zc + 5.7 - 0.5, math.pi, high=3.0, carved=True, cushion=PAL['garnet'])
    for k in range(5):
        zz = zc - 4.0 + k * 2.0
        for sx in (-1, 1):
            plate(p, xc + sx * 0.6, FLOOR + 1.0, zz)
            goblet(p, xc + sx * 0.6, FLOOR + 1.0, zz + 0.35)
        food(p, xc, FLOOR + 1.02 + LAYER, zz + 0.9, seed=k)
    for zz in (zc - 3.0, zc, zc + 3.0):
        candelabrum_small(p, glow, xc, FLOOR + 1.0 + LAYER, zz)
    # the sideboard on the west wall with the plate displayed on it
    sb = (23.1, W['x1'])
    abox(p, sb[0], sb[1], FLOOR, FLOOR + 1.4, -4.2, 2.6, PAL['walnut'], WOOD)
    abox(p, sb[0] - 0.08, sb[1], FLOOR + 1.4, FLOOR + 1.52, -4.3, 2.7, PAL['oak'][2], WOOD)
    for k in range(4):
        zz = -3.3 + k * 1.8
        abox(p, sb[0] - 0.02, sb[0], FLOOR + 0.25, FLOOR + 1.25, zz - 0.75, zz + 0.75, PAL['oak'][0], WOOD)
        plate(p, sb[0] + 0.35, FLOOR + 1.52, zz, r=0.3, col=PAL['gold_dark'] if k % 2 else PAL['silver'])
        p.box((W['x1'] - 0.08, FLOOR + 2.1, zz), (0.04, 0.6, 0.6), PAL['pewter'] if k % 2 else PAL['gold_dark'], METAL)
    rug(p, 16.6, 21.2, -5.6, 6.0, field=PAL['garnet'], border=PAL['blue_dark'], seed=11)
    chandelier(p, glow, xc, zc, FLOOR + 7.9, r=1.4, hang_to=W['plate'] + 0.2, candles=8)
    banner(p, 18.9, W['z0'], FLOOR + 7.6, (0, 1), width=1.4, length=3.6, field=PAL['blue'])
    for zz in (-4.6, 4.6):
        sconce(p, glow, H['x1'] + H['t'], FLOOR + 4.2, zz, (1, 0))


def candelabrum_small(p, glow, x, y, z):
    cyl(p, x, y, y + 0.06, z, 0.16, PAL['gold_dark'], METAL, sides=8)
    cyl(p, x, y + 0.06, y + 0.55, z, 0.04, PAL['gold'], METAL, sides=6)
    p.beam([(x, y + 0.55, z - 0.3), (x, y + 0.55, z + 0.3)], 0.05, 0.05, PAL['gold'], METAL)
    for dz in (-0.3, 0.0, 0.3):
        candle(glow, p, x, y + 0.58 + (0.08 if dz == 0 else 0), z + dz, h=0.28, r=0.04)


def kitchen(p, glow):
    K = KITCHEN
    W = WEST
    # the range: a wide stone fireplace on the north wall, a cauldron on a crane, a spit
    x0, x1 = 18.0, 22.6
    zb = K['z1']
    abox(p, x0, x1, FLOOR, FLOOR + 0.3, zb - 1.2, zb, PAL['ashlar_hi'], STONE)
    for xx in (x0, x1 - 0.5):
        abox(p, xx, xx + 0.5, FLOOR, FLOOR + 3.2, zb - 1.2, zb, tone(PAL['ashlar'][1], xx), STONE)
    abox(p, x0 - 0.2, x1 + 0.2, FLOOR + 3.2, FLOOR + 3.9, zb - 1.35, zb, PAL['ashlar_hi'], STONE)
    abox(p, x0 + 0.3, x1 - 0.3, FLOOR + 3.9, K['plate'], zb - 1.0, zb, PAL['mortar'], STONE)
    abox(p, x0 + 0.5, x1 - 0.5, FLOOR + 0.3, FLOOR + 3.2, zb - 0.25, zb - 0.05, PAL['soot'], STONE)
    disc(glow, (x0 + x1) / 2, FLOOR + 0.32, zb - 0.6, 0.9, PAL['ember'], GLOW, sides=10)
    for k in range(4):
        p.cylinder(((x0 + x1) / 2 - 0.8 + k * 0.4, FLOOR + 0.4, zb - 0.9), ((x0 + x1) / 2 - 0.6 + k * 0.4, FLOOR + 0.45, zb - 0.3),
                   0.12, PAL['oak_dark'], WOOD, sides=6)
    # the cauldron and the spit
    cx = x0 + 1.1
    p.prism((cx, FLOOR + 1.0, zb - 0.65), 12, 0.25, 0.5, 0.35, PAL['iron'], METAL, axis=(0, 1, 0))
    p.prism((cx, FLOOR + 1.35, zb - 0.65), 12, 0.5, 0.42, 0.25, PAL['iron'], METAL, axis=(0, 1, 0), cap1=False)
    chain(p, (cx, FLOOR + 1.6, zb - 0.65), (cx, FLOOR + 3.1, zb - 0.65), links=4)
    p.cylinder((x0 + 0.5, FLOOR + 1.3, zb - 0.6), (x1 - 0.5, FLOOR + 1.3, zb - 0.6), 0.04, PAL['iron'], METAL, sides=5)
    p.rock_blob((x1 - 1.4, FLOOR + 1.3, zb - 0.6), (0.8, 0.45, 0.45), (0.62, 0.34, 0.18), WOOD)
    # pots and pans on the mantel and on hooks
    for k in range(5):
        pot(p, x0 + 0.1 + k * 1.0, FLOOR + 3.9, zb - 1.1, r=0.22 + 0.04 * (k % 2))
    # the work table with food on it
    table(p, 19.2, 10.9, 3.6, 1.4, col=PAL['board'][0])
    for k in range(5):
        food(p, 17.8 + k * 0.7, FLOOR + 1.02, 10.7 + 0.3 * (k % 2), seed=k + 20)
    p.box((20.4, FLOOR + 1.06, 11.2), (0.9, 0.06, 0.5), PAL['oak'][2], WOOD)
    pot(p, 18.2, FLOOR + 1.0, 11.25, r=0.25)
    # the dresser on the east wall: shelves of plates and jugs
    dx0 = K['x0']
    abox(p, dx0, dx0 + 0.8, FLOOR, FLOOR + 1.2, 9.6, 12.8, PAL['walnut'], WOOD)
    abox(p, dx0, dx0 + 0.35, FLOOR + 1.2, FLOOR + 3.0, 9.6, 12.8, PAL['walnut'], WOOD)
    for r in range(3):
        sy = FLOOR + 1.8 + r * 0.6
        abox(p, dx0 + 0.35, dx0 + 0.6, sy - 0.04, sy, 9.6, 12.8, PAL['oak'][0], WOOD)
        for k in range(5):
            zz = 9.95 + k * 0.62
            p.prism((dx0 + 0.4, sy + 0.24, zz), 8, 0.22, 0.22, 0.04, PAL['cream'] if (k + r) % 2 else PAL['blue'],
                    METAL, axis=(1, 0, 0), cap0=False)
    abox(p, dx0, dx0 + 0.85, FLOOR + 3.0, FLOOR + 3.15, 9.5, 12.9, PAL['oak_dark'], WOOD)
    # sacks, barrels and a crate in the corner by the door
    for (bx, bz) in ((23.2, 13.8), (23.3, 12.8), (22.4, 14.0)):
        barrel(p, bx, bz)
    for k, (sx_, sz_) in enumerate(((16.4, 14.0), (17.1, 14.1), (16.6, 13.3))):
        sack(p, sx_, sz_, seed=k)
    # herbs and a ham hung under the ceiling, out of the camera's band
    for k in range(5):
        hx = 17.0 + k * 1.4
        cyl(p, hx, K['plate'] - 0.6, K['plate'], 10.0, 0.02, PAL['iron'], METAL, sides=4)
        p.rock_blob((hx, K['plate'] - 0.8, 10.0), (0.25, 0.4, 0.25),
                    (0.36, 0.44, 0.2) if k % 2 else (0.56, 0.3, 0.2), WOOD)
    # dishes on the hatch's shelf, waiting to go through
    for k in range(3):
        plate(p, 17.0 + k * 0.9, FLOOR + 1.36, W['z1'] + 0.4, r=0.24)
        food(p, 17.0 + k * 0.9, FLOOR + 1.39, W['z1'] + 0.4, seed=40 + k)
    flag_rug = PAL['garnet_dark']
    rug(p, 16.6, 21.6, 9.0, 9.9, field=flag_rug, border=PAL['oak_dark'], seed=13)


def library(p, glow):
    E = EAST
    # the east wall of shelves, floor to near the ceiling, and its rolling ladder
    shelves(p, E['x0'], E['x0'] + 0.9, -6.6, 4.2, FLOOR, FLOOR + 6.2, (1, 0), seed=1, rows=7)
    # the ladder's rail rides a hand proud of the shelves' posts (their fronts 0.9 + 0.115 + 0.04 out)
    rail_x = E['x0'] + 0.9 + 0.075 + LAYER + 0.04 + 0.035
    p.beam([(rail_x, FLOOR + 6.0, -6.4), (rail_x, FLOOR + 6.0, 4.0)], 0.05, 0.05, PAL['gold'], METAL)
    lx = rail_x - 0.05
    for dz in (-0.3, 0.3):
        p.beam([(lx + 1.0, FLOOR, -1.0 + dz), (lx + 0.05, FLOOR + 6.0, -1.0 + dz)], 0.08, 0.06, PAL['oak'][2], WOOD)
    for k in range(12):
        f = (k + 0.5) / 12
        p.beam([(lx + 1.0 - f * 0.95, FLOOR + f * 6.0, -1.3), (lx + 1.0 - f * 0.95, FLOOR + f * 6.0, -0.7)], 0.05,
               0.05, PAL['oak'][2], WOOD)
    # the north wall's shelves west of the chapel door
    shelves(p, CHAPEL_DOOR['x1'] + 0.5, H['ox0'] - 0.3, E['z1'] - 0.8, E['z1'], FLOOR, FLOOR + 6.2, (0, -1), seed=2,
            rows=7)
    # the reading desk: a slanted lectern-desk with an open book, a chair, a globe beside it
    dx, dz = -18.4, 0.5
    abox(p, dx - 1.2, dx + 1.2, FLOOR + 1.0, FLOOR + 1.12, dz - 0.9, dz + 0.9, PAL['walnut'], WOOD)
    for (ex, ez) in ((-1.05, -0.75), (1.05, -0.75), (-1.05, 0.75), (1.05, 0.75)):
        abox(p, dx + ex - 0.08, dx + ex + 0.08, FLOOR, FLOOR + 1.0, dz + ez - 0.08, dz + ez + 0.08, PAL['oak_dark'], WOOD)
    p.box((dx, FLOOR + 1.25, dz), (1.1, 0.06, 0.8), PAL['parchment'], WOOD, pitch=-0.2)
    p.box((dx, FLOOR + 1.3, dz), (0.04, 0.08, 0.8 + 2 * LAYER), PAL['leather'], WOOD, pitch=-0.2)
    candle(glow, p, dx + 0.9, FLOOR + 1.12, dz + 0.5, h=0.3)
    chair(p, dx, dz - 1.5, 0.0, high=2.4, cushion=PAL['garnet'])
    gx, gz = -15.8, -4.9
    for k in range(3):
        a = math.tau * k / 3
        p.beam([(gx, FLOOR + 0.6, gz), (gx + math.cos(a) * 0.45, FLOOR, gz + math.sin(a) * 0.45)], 0.06, 0.06,
               PAL['oak_dark'], WOOD)
    p.rock_blob((gx, FLOOR + 1.25, gz), (1.0, 1.0, 1.0), (0.34, 0.5, 0.62), WOOD, jitter=0.0, subdivisions=2)
    p.ring((gx, FLOOR + 1.25, gz), 0.58, 0.04, PAL['gold'], 16, axis=(1, 0, 0.3), mat=METAL)
    # two armchairs by the windows with a low table
    chair(p, -21.6, -4.4, math.pi / 4 * 1.5, high=2.0, cushion=PAL['blue'])
    chair(p, -20.2, -5.6, math.pi / 8 * 0.4, high=2.0, cushion=PAL['blue'])
    rug(p, -22.4, -15.4, -5.0, 3.4, field=PAL['blue'], border=PAL['garnet_dark'], seed=15)
    chandelier(p, glow, -18.9, -1.0, FLOOR + 7.9, r=1.3, hang_to=E['plate'] + 0.2, candles=8)
    banner(p, -18.9, E['z0'], FLOOR + 7.6, (0, 1), width=1.3, length=3.4, field=PAL['garnet'])
    for zz in (-4.6, 3.6):
        sconce(p, glow, H['ox0'], FLOOR + 4.2, zz, (-1, 0))


def chapel(p, glow):
    C = CHAPEL
    # the altar: a stone table with a cloth, a gilded sun on a stand, candles
    ax, az = (C['x0'] + C['x1']) / 2, 11.5
    abox(p, ax - 1.2, ax + 1.2, FLOOR, FLOOR + 1.3, az - 0.5, az + 0.5, PAL['ashlar_hi'], STONE)
    abox(p, ax - 1.3, ax + 1.3, FLOOR + 1.3, FLOOR + 1.45, az - 0.6, az + 0.6, PAL['ashlar_hi'], STONE)
    abox(p, ax - 1.25, ax + 1.25, FLOOR + 1.45, FLOOR + 1.45 + LAYER, az - 0.55, az + 0.55, PAL['cream'], WOOD)
    abox(p, ax - 0.4, ax + 0.4, FLOOR + 0.6, FLOOR + 1.45 + LAYER, az - 0.6 - 1.5 * LAYER, az - 0.6, PAL['garnet'], WOOD)
    cyl(p, ax, FLOOR + 1.45 + LAYER, FLOOR + 2.0, az + 0.2, 0.05, PAL['gold'], METAL, sides=6)
    sun = [(math.cos(math.tau * i / 16) * (0.42 if i % 2 else 0.22), math.sin(math.tau * i / 16) * (0.42 if i % 2 else 0.22))
           for i in range(16)]
    flat_face(p, [(ax + a, FLOOR + 2.45 + b, az + 0.18) for (a, b) in sun], PAL['gold'], METAL, (0, 0, -1))
    for k in range(5):
        candle(glow, p, ax - 1.0 + k * 0.5, FLOOR + 1.45 + LAYER, az - 0.2, h=0.25 + 0.15 * (k % 2), r=0.05)
    for sx in (1, -1):
        candelabrum(p, glow, ax + sx * 1.9, az - 0.3, h=1.8)
    # two short pews either side of the aisle
    for (x0, x1) in ((-21.6, -19.8), (-17.8, -16.0)):
        for k in range(2):
            zz = 7.9 + k * 1.3
            abox(p, x0, x1, FLOOR + 0.45, FLOOR + 0.55, zz - 0.25, zz + 0.25, PAL['oak'][1], WOOD)
            abox(p, x0, x1, FLOOR + 0.55, FLOOR + 1.1, zz - 0.3, zz - 0.22, PAL['oak'][1], WOOD)
            # the pew ends stand proud of the seat and the back on every side (never flush)
            for xx in (x0 - LAYER, x1 - 0.08 + LAYER):
                abox(p, xx, xx + 0.08, FLOOR, FLOOR + 1.1 + 2 * LAYER, zz - 0.3 - LAYER, zz + 0.25 + LAYER,
                     PAL['oak_dark'], WOOD)
    rug(p, -19.5, -18.1, 6.2, 10.8, field=PAL['garnet'], border=PAL['gold_dark'], seed=17)
    banner(p, C['x0'], 8.8, FLOOR + 6.4, (1, 0), width=1.0, length=2.8, field=PAL['blue'])
    banner(p, C['x1'], 8.8, FLOOR + 6.4, (-1, 0), width=1.0, length=2.8, field=PAL['blue'])


def build(m, parts):
    furn, glow = parts['G_INT_Furnishings'], parts['ManorGlow']
    great_hall(furn, glow)
    high_table(furn, glow)
    dining(furn, glow)
    kitchen(furn, glow)
    library(furn, glow)
    chapel(furn, glow)
    _ = (EAST, WEST, STONE)
