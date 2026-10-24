"""The guild hall's built furniture pieces (guild_furnish.py and guild_yard.py stand them):
tables, benches, chairs, rugs, banners, swords and shields, candles and candelabra, chandeliers,
barrels, plates and goblets, sconces, weapon racks and the yard's lamp. They began as the
Highwatch manor's (the manor left the town; the guild keeps its own copy); most of the hall's
dressing is now the painted props (guild_props.py), and these carry the rest.
"""
import math

from guild_kit import _ball, chain
from guild_lib import (GLOW_CANDLE, GLOW_LANTERN, LAYER, METAL, PAL, STONE, WOOD, abox, cbox, cyl, flat_face, tone)
from guild_plan import FLOOR, HALL

H = HALL
# the yard's flags a layer over their mortar bed, the bed a layer over the ground (at 0.03)
PAVE = 0.03 + 2 * LAYER


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


def barrel(p, x, z, y=FLOOR, h=1.1, r=0.45):
    p.prism((x, y, z), 12, r * 0.85, r, h / 2, tone(PAL['oak'][1], x, z), WOOD, axis=(0, 1, 0), cap0=True, cap1=False)
    p.prism((x, y + h / 2, z), 12, r, r * 0.85, h / 2, tone(PAL['oak'][1], x, z), WOOD, axis=(0, 1, 0), cap0=False)
    for f in (0.15, 0.85):
        rr = r * (0.88 + 0.12 * (1 - abs(f - 0.5) * 2))
        p.ring((x, y + h * f, z), rr + 0.01, 0.05, PAL['iron'], 12, axis=(0, 1, 0), mat=METAL)


def plate(p, x, y, z, r=0.22, col=None):
    p.prism((x, y, z), 6, r * 0.85, r, 0.03, col or PAL['pewter'], METAL, axis=(0, 1, 0), cap0=False)


def goblet(p, x, y, z):
    p.prism((x, y, z), 5, 0.07, 0.02, 0.16, PAL['gold'], METAL, axis=(0, 1, 0), cap0=False, cap1=False)
    p.prism((x, y + 0.16, z), 6, 0.04, 0.08, 0.16, PAL['gold'], METAL, axis=(0, 1, 0), cap0=False)


def sconce(p, glow, x, y, z, normal):
    nx, nz = normal
    cbox(p, x + nx * 0.05, y, z + nz * 0.05, 0.3 if abs(nz) > 0.5 else 0.1, 0.5, 0.3 if abs(nx) > 0.5 else 0.1,
         PAL['gold_dark'], METAL)
    p.beam([(x + nx * 0.08, y - 0.1, z + nz * 0.08), (x + nx * 0.42, y + 0.15, z + nz * 0.42)], 0.06, 0.06,
           PAL['iron'], METAL)
    cyl(p, x + nx * 0.45, y + 0.12, y + 0.22, z + nz * 0.45, 0.11, PAL['gold'], METAL, sides=8)
    candle(glow, p, x + nx * 0.45, y + 0.22, z + nz * 0.45, h=0.3)


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

