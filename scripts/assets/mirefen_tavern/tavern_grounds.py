"""The Mirefen tavern's grounds (build_tavern.py calls build(B, parts)): everything outside on the
terrain, drawn where the sim collides with it (LAYOUT['props'] and LAYOUT['grounds'], from
src/sim/content/mirefen_tavern_grounds.ts), every foot planted on the terrain under it.

  TavernGrounds   (every tier) the forecourt's bed and its kerb, the terrace's trestle tables and
                  benches, the lantern posts, the strings and their lanterns (they glow, the two
                  terrace lights are the runtime's), the open stable (footings, posts, planked
                  walls, the stall partition, the manger, its shingled roof), the trough, the
                  hay bales, the cart, the woodpile and its little roof, the crates
  TavernTrim      (medium and up) the forecourt's cobbles, iron straps, hoops and hinges, the
                  chalkboard menu by the door (pictures only: a tankard, a loaf, a fish, a
                  steaming bowl and chalk dots for prices, never words)
  TavernClutter   (high and up) straw on the stable's floor and round the bales, sacks in the
                  cart, a bucket and a pitchfork, a saddle on the partition, mugs and a candle
                  lantern on the terrace's tables, tufts of grass between the kerb stones

The forecourt is drawn over the terrain, never a walk surface of its own: the ground the feet
walk is the terrain's (groundHeight is untouched), so the cobbles ride a hand over it.
"""
import math

STRAW = [(0.86, 0.72, 0.38), (0.8, 0.66, 0.33), (0.9, 0.78, 0.45), (0.76, 0.62, 0.3)]
COBBLE = [(0.5, 0.5, 0.5), (0.45, 0.46, 0.48), (0.55, 0.53, 0.5), (0.42, 0.42, 0.44), (0.52, 0.5, 0.46),
          (0.47, 0.49, 0.5), (0.58, 0.55, 0.5)]
BED = (0.3, 0.27, 0.22)
WATER = (0.24, 0.34, 0.36)
ROPE = (0.44, 0.36, 0.24)
CHALK = (0.9, 0.9, 0.86)
SLATE_BOARD = (0.13, 0.15, 0.15)
SACK = [(0.72, 0.62, 0.44), (0.66, 0.56, 0.38)]


def _h(*k):
    v = math.sin(sum(x * (12.9898 + 3.337 * i) for i, x in enumerate(k)) + 0.13) * 43758.5453
    return v - math.floor(v)


def build(B, parts):
    g = parts['TavernGrounds']
    trim, clutter = parts['TavernTrim'], parts['TavernClutter']
    G = B.LAYOUT['grounds']
    props = B.LAYOUT['props']
    forecourt(B, g, trim, clutter, G['forecourt'])
    for q in props:
        k = q['kind']
        if k == 'terraceTable':
            terrace_table(B, g, trim, clutter, q)
        elif k == 'terraceBench':
            terrace_bench(B, g, trim, q)
        elif k == 'post':
            lantern_post(B, g, trim, q)
        elif k == 'crate':
            crate(B, g, trim, q)
        elif k == 'trough':
            trough(B, g, trim, q)
        elif k == 'hay':
            hay(B, g, clutter, q)
        elif k == 'cart':
            cart(B, g, trim, clutter, q)
        elif k == 'woodpile':
            woodpile(B, g, trim, q)
    for s in G['strings']:
        lantern_string(B, g, s)
    stable(B, g, trim, clutter, G['stable'])
    chalkboard(B, trim, G['chalkboard'])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def local(q, lx, lz):
    """A prop's own frame (turned by its yaw) to the tavern's."""
    c, s = math.cos(q['rot']), math.sin(q['rot'])
    return (q['x'] + lx * c + lz * s, q['z'] - lx * s + lz * c)


def foot(B, p, x, z, y1, w, color, sink=0.15):
    """A square leg or post from under the terrain up to y1."""
    y0 = B.ground(x, z) - sink
    B.post(p, x, z, y0, y1, w, color)


def pbox(B, p, q, lx0, lx1, y0, y1, lz0, lz1, color, mat):
    """A box in a prop's frame."""
    pts = [local(q, a, b) for (a, b) in ((lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1))]
    B.hexa(p, [(x, y0, z) for (x, z) in pts] + [(x, y1, z) for (x, z) in pts], color, mat)


# ---------------------------------------------------------------------------
# The forecourt
# ---------------------------------------------------------------------------
def _in_forecourt(rects, x, z):
    return any(r[0] <= x <= r[1] and r[2] <= z <= r[3] for r in rects)


def _clear(B, x, z):
    """Whether a point of the forecourt is open cobbles: not under the stone base, the porch, its
    steps or their foot."""
    H, q = B.HALL, B.LAYOUT['porch']
    if z < H['z1'] + 0.12:
        return False
    if abs(x) < q['x1'] + 0.3 and z < q['z1'] + 0.05:
        return False
    if abs(x) < q['stepHalfWidth'] + 0.08:
        run = (0.0 - B.ground(x, z)) / q['stepSlope']
        if z < q['z1'] + run + 0.25:
            return False
    return True


def forecourt(B, g, trim, clutter, rects):
    """The cobbled forecourt: a dark bed draped on the terrain (every tier), the cobbles set in
    it (medium and up), a kerb of long stones along its road side, tufts between the kerb."""
    step = 1.0
    lift = 0.05
    for (x0, x1, z0, z1) in rects:
        nx, nz = int(math.ceil((x1 - x0) / step)), int(math.ceil((z1 - z0) / step))
        for i in range(nx):
            for j in range(nz):
                a, b = x0 + (x1 - x0) * i / nx, x0 + (x1 - x0) * (i + 1) / nx
                c, d = z0 + (z1 - z0) * j / nz, z0 + (z1 - z0) * (j + 1) / nz
                if not all(_clear(B, x, z) for (x, z) in ((a, c), (b, c), (a, d), (b, d))):
                    continue
                pts = [(x, B.ground(x, z) + lift, z) for (x, z) in ((a, c), (b, c), (b, d), (a, d))]
                B.flat_face(g, pts, B.scale_color(BED, 0.92 + 0.14 * _h(a, c, 1)), B.STONE, (0, 1, 0), tag=0)
    # the cobbles: rows of setts, each its own size, turn and tone, a hand over the bed
    for (x0, x1, z0, z1) in rects:
        z = z0 + 0.22
        row = 0
        while z < z1 - 0.18:
            x = x0 + 0.2 + (0.2 if row % 2 else 0.0)
            while x < x1 - 0.18:
                w = 0.34 + 0.1 * _h(x, z, 2)
                dpt = 0.3 + 0.08 * _h(z, x, 3)
                cx, cz = x + (_h(x, z, 4) - 0.5) * 0.06, z + (_h(z, x, 5) - 0.5) * 0.06
                if _clear(B, cx - w / 2, cz - dpt / 2) and _clear(B, cx + w / 2, cz + dpt / 2) and \
                        _in_forecourt(rects, cx, cz):
                    turn = (_h(x, z, 6) - 0.5) * 0.3
                    ct, st = math.cos(turn), math.sin(turn)
                    corners = []
                    for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                        ku = w / 2 * (0.85 + 0.15 * _h(x, z, u, v))
                        kv = dpt / 2 * (0.85 + 0.15 * _h(z, x, v, u))
                        px, pz = cx + (u * ku) * ct + (v * kv) * st, cz - (u * ku) * st + (v * kv) * ct
                        corners.append((px, B.ground(px, pz) + 0.1 + 0.02 * _h(px, pz), pz))
                    tone = B.scale_color(COBBLE[int(_h(cx, cz, 7) * len(COBBLE))], 0.85 + 0.25 * _h(cz, cx, 8))
                    # moss creeping in near the walls and the kerb
                    if (cz < B.HALL['z1'] + 0.8 or cz > z1 - 0.5) and _h(cx, 9) < 0.35:
                        tone = tuple(tone[i] * 0.6 + (0.3, 0.42, 0.16)[i] * 0.4 for i in range(3))
                    B.flat_face(trim, corners, tone, B.STONE, (0, 1, 0), tag=0)
                x += w + 0.06
            z += 0.36
            row += 1
    # the kerb along the forecourt's road side and its open ends: long dressed stones
    (x0, x1, z0, z1) = rects[0]
    (tx0, tx1, tz0, tz1) = rects[1] if len(rects) > 1 else (0, 0, 0, 0)
    runs = [((x0, z1), (tx0, z1)), ((tx0, tz1), (tx1, tz1)), ((tx1, z1), (x1, z1)), ((tx0, z1), (tx0, tz1)),
            ((tx1, z1), (tx1, tz1)), ((x0, z0 + 0.2), (x0, z1)), ((x1, z0 + 0.2), (x1, z1))]
    for (a, b) in runs:
        L = math.dist(a, b)
        n = max(1, int(L / 0.9))
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            ax, az = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
            bx, bz = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            if not _clear(B, mx, mz):
                continue
            yg = B.ground(mx, mz)
            ang = math.atan2(bx - ax, bz - az)
            p_ = (mx, yg + 0.02, mz)
            g.box(p_, (0.34, 0.3, L / n - 0.05), B.scale_color(COBBLE[k % len(COBBLE)], 0.95), B.STONE, yaw=ang)
            if _h(mx, mz, 10) < 0.45:
                clutter.rock_blob((mx + 0.3 * math.cos(ang), yg + 0.12, mz - 0.3 * math.sin(ang)), (0.35, 0.22, 0.3),
                                  (0.33, 0.46, 0.2), B.PLASTER, jitter=0.3, subdivisions=0)


# ---------------------------------------------------------------------------
# The terrace
# ---------------------------------------------------------------------------
def terrace_table(B, g, trim, clutter, q):
    """A trestle table: a top of three thick planks over battens, an X trestle at each end whose
    feet stand on the terrain, a stretcher between them, iron straps at the joints."""
    top = q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    honey = B.PAL['honey']
    for i in range(3):
        a = -hd + i * (2 * hd / 3) + 0.01
        b = a + 2 * hd / 3 - 0.02
        pbox(B, g, q, -hw - 0.05, hw + 0.05 - 0.06 * (i % 2), top - 0.13, top, a, b,
             B.scale_color(B.pick(honey, i * 2 + 1), 0.86 + 0.1 * _h(q['x'], i)), B.WOOD)
    for lx in (-hw + 0.4, hw - 0.4):
        pbox(B, g, q, lx - 0.07, lx + 0.07, top - 0.25, top - 0.13, -hd + 0.05, hd - 0.05, B.PAL['beam_dark'],
             B.WOOD)
        for s in (-1, 1):
            fx, fz = local(q, lx, s * (hd - 0.08))
            tx, tz = local(q, lx, -s * 0.05)
            y0 = B.ground(fx, fz) - 0.1
            B.beam(g, (fx, y0, fz), (tx, top - 0.25, tz), 0.14, 0.14, B.PAL['beam'])
        # the trestle's foot board
        fa, fb = local(q, lx, -hd + 0.02), local(q, lx, hd - 0.02)
        ya = B.ground(*fa)
        yb = B.ground(*fb)
        B.beam(g, (fa[0], ya + 0.06, fa[1]), (fb[0], yb + 0.06, fb[1]), 0.16, 0.12, B.PAL['beam_dark'])
        cx, cz = local(q, lx, 0.0)
        trim.box((cx, top - 0.62, cz), (0.18, 0.26, 0.18), B.PAL['iron'], B.METAL, yaw=q['rot'])
    pbox(B, g, q, -hw + 0.45, hw - 0.45, top - 0.72, top - 0.58, -0.07, 0.07, B.PAL['beam_dark'], B.WOOD)
    # a pewter jug, mugs and a candle lantern on it (clutter)
    import tavern_furnish as U

    for k, (dx, dz, a) in enumerate(((-0.6, -0.2, 0.4), (0.3, 0.25, 2.2), (0.9, -0.15, 1.1))):
        x, z = local(q, dx * hw / 1.5, dz)
        U.mug(B, clutter, x, top, z, a)
    x, z = local(q, -0.1, 0.05)
    clutter.box((x, top + 0.12, z), (0.18, 0.24, 0.18), B.PAL['iron'], B.METAL)
    clutter.box((x, top + 0.12, z), (0.13, 0.18, 0.2), B.PAL['lamp'], B.GLOW)
    clutter.box((x, top + 0.27, z), (0.2, 0.06, 0.2), B.PAL['iron'], B.METAL, taper=0.4)


def terrace_bench(B, g, trim, q):
    """A plank bench on two slab legs cut to the ground under each."""
    top = q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    pbox(B, g, q, -hw, hw, top - 0.12, top, -hd, hd, B.scale_color(B.PAL['honey'][1], 0.92), B.WOOD)
    for lx in (-hw + 0.28, hw - 0.28):
        x, z = local(q, lx, 0.0)
        y0 = B.ground(x, z) - 0.12
        pbox(B, g, q, lx - 0.07, lx + 0.07, y0, top - 0.12, -hd + 0.03, hd - 0.03, B.PAL['beam'], B.WOOD)
    pbox(B, trim, q, -hw + 0.3, hw - 0.3, top - 0.5, top - 0.4, -0.04, 0.04, B.PAL['beam_dark'], B.WOOD)


def lantern_post(B, g, trim, q):
    """A squared oak post on a stone pad, a cap and an iron hook at its head."""
    x, z = q['x'], q['z']
    top = q['base'] + q['height']
    yg = B.ground(x, z)
    g.box((x, yg + 0.08, z), (0.5, 0.3, 0.5), B.PAL['stone_dark'], B.STONE)
    B.post(g, x, z, yg - 0.1, top, 0.26, B.PAL['beam_dark'])
    g.box((x, top + 0.08, z), (0.36, 0.16, 0.36), B.PAL['beam'], B.WOOD, taper=0.4)
    trim.box((x, top - 0.25, z), (0.3, 0.06, 0.3), B.PAL['iron'], B.METAL)


def lantern_string(B, g, s):
    """A rope hung from a to b, sagging by `sag`, with small glowing lanterns along it."""
    ax, ay, az = s['a']
    bx, by, bz = s['b']
    n = 14
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((ax + (bx - ax) * t, ay + (by - ay) * t - s['sag'] * 4 * t * (1 - t), az + (bz - az) * t))
    g.sweep(pts, 0.025, 0.025, ROPE, sides=3)
    m = s['lanterns']
    for k in range(m):
        t = (k + 0.5) / m
        x = ax + (bx - ax) * t
        y = ay + (by - ay) * t - s['sag'] * 4 * t * (1 - t)
        z = az + (bz - az) * t
        yl = y - 0.26
        g.box((x, y - 0.08, z), (0.03, 0.16, 0.03), B.PAL['iron'], B.METAL)
        g.box((x, yl, z), (0.2, 0.24, 0.2), B.PAL['iron'], B.METAL)
        g.box((x, yl, z), (0.15, 0.2, 0.23), B.PAL['lamp'], B.GLOW)
        g.box((x, yl, z), (0.23, 0.2, 0.15), B.PAL['lamp'], B.GLOW)
        g.box((x, yl + 0.16, z), (0.22, 0.08, 0.22), B.PAL['iron'], B.METAL, taper=0.4)


def chalkboard(B, p, c):
    """The chalkboard menu on the front wall right of the door: an oak frame round a slate
    board, a little shelf under it with a stub of chalk, and chalk pictures (a tankard, a loaf, a
    fish, a steaming bowl), each with a row of dots for its price. No words."""
    H = B.HALL
    zf = H['z1'] - 0.04
    x0, x1 = c['x'] - c['width'] / 2, c['x'] + c['width'] / 2
    y0, y1 = c['y0'], c['y1']
    dark = B.PAL['beam_dark']
    B.abox(p, x0, x1, y0, y1, zf, zf + 0.05, SLATE_BOARD, B.STONE)
    for (a, b, cc, d) in ((x0 - 0.07, x1 + 0.07, y1, y1 + 0.08), (x0 - 0.07, x1 + 0.07, y0 - 0.08, y0),
                          (x0 - 0.07, x0, y0, y1), (x1, x1 + 0.07, y0, y1)):
        B.abox(p, a, b, cc, d, zf, zf + 0.09, dark, B.WOOD)
    B.abox(p, x0 - 0.02, x1 + 0.02, y0 - 0.12, y0 - 0.08, zf, zf + 0.16, dark, B.WOOD)
    B.abox(p, x1 - 0.25, x1 - 0.12, y0 - 0.08, y0 - 0.05, zf + 0.05, zf + 0.09, CHALK, B.PLASTER)
    zc = zf + 0.056
    n = (0.0, 0.0, 1.0)

    def line(ax, ay, bx, by, w=0.022):
        L = math.hypot(bx - ax, by - ay) or 1.0
        nx, ny = -(by - ay) / L * w / 2, (bx - ax) / L * w / 2
        B.flat_face(p, [(ax + nx, ay + ny, zc), (bx + nx, by + ny, zc), (bx - nx, by - ny, zc), (ax - nx, ay - ny, zc)],
                    CHALK, B.PLASTER, n)

    def loop(cx, cy, rx, ry, k=10, a0=0.0, a1=2 * math.pi):
        prev = None
        for i in range(k + 1):
            a = a0 + (a1 - a0) * i / k
            q = (cx + math.cos(a) * rx, cy + math.sin(a) * ry)
            if prev:
                line(prev[0], prev[1], q[0], q[1])
            prev = q

    def dots(x, y, count):
        for i in range(count):
            B.flat_face(p, [(x + i * 0.07, y, zc), (x + i * 0.07 + 0.035, y, zc), (x + i * 0.07 + 0.035, y + 0.035, zc),
                            (x + i * 0.07, y + 0.035, zc)], CHALK, B.PLASTER, n)

    rows = 4
    h = (y1 - y0 - 0.12) / rows
    lx = x0 + 0.1
    for r in range(rows):
        cy = y1 - 0.08 - h * (r + 0.5)
        cx = lx + 0.13
        if r == 0:
            # a tankard: its body, a handle, foam
            line(cx - 0.08, cy - 0.1, cx - 0.07, cy + 0.08)
            line(cx + 0.08, cy - 0.1, cx + 0.07, cy + 0.08)
            line(cx - 0.08, cy - 0.1, cx + 0.08, cy - 0.1)
            loop(cx + 0.1, cy, 0.05, 0.06, 6, -math.pi / 2, math.pi / 2)
            loop(cx, cy + 0.1, 0.09, 0.035, 8, 0.0, math.pi)
        elif r == 1:
            # a loaf
            loop(cx, cy - 0.02, 0.11, 0.07, 10, 0.0, math.pi)
            line(cx - 0.11, cy - 0.02, cx + 0.11, cy - 0.02)
            for d in (-0.05, 0.0, 0.05):
                line(cx + d - 0.02, cy + 0.0, cx + d + 0.02, cy + 0.04)
        elif r == 2:
            # a fish
            loop(cx, cy, 0.1, 0.045, 10)
            line(cx + 0.1, cy, cx + 0.16, cy + 0.05)
            line(cx + 0.1, cy, cx + 0.16, cy - 0.05)
            line(cx + 0.16, cy + 0.05, cx + 0.16, cy - 0.05)
        else:
            # a bowl and its steam
            loop(cx, cy - 0.02, 0.11, 0.08, 8, math.pi, 2 * math.pi)
            line(cx - 0.11, cy - 0.02, cx + 0.11, cy - 0.02)
            for d in (-0.04, 0.04):
                line(cx + d, cy + 0.01, cx + d + 0.02, cy + 0.06)
                line(cx + d + 0.02, cy + 0.06, cx + d, cy + 0.11)
        dots(cx + 0.24, cy - 0.02, 1 + (r * 2 + 1) % 3)


# ---------------------------------------------------------------------------
# The corner's crates, the trough, the hay, the cart, the woodpile
# ---------------------------------------------------------------------------
def crate(B, g, trim, q):
    """A plank crate on the ground: slats round it, a lid, iron corner straps."""
    base = q['base']
    top = base + q['height']
    hw, hd = q['hw'], q['hd']
    yg = min(B.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.05
    pbox(B, g, q, -hw, hw, yg, top, -hd, hd, B.scale_color(B.PAL['board'][1], 0.9 + 0.15 * _h(q['x'])), B.WOOD)
    for (a, b) in ((-hw - 0.02, -hw + 0.08), (hw - 0.08, hw + 0.02)):
        pbox(B, g, q, a, b, yg, top + 0.02, -hd - 0.02, hd + 0.02, B.PAL['beam'], B.WOOD)
    for v in (base + 0.25, top - 0.25):
        pbox(B, trim, q, -hw - 0.03, hw + 0.03, v - 0.05, v + 0.05, -hd - 0.03, hd + 0.03, B.PAL['beam_dark'], B.WOOD)


def trough(B, g, trim, q):
    """A horse trough: a thick stone basin on the ground, water a hand under its rim."""
    base, top = q['base'], q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    yg = min(B.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.1
    stone = B.PAL['ashlar'][2]
    pbox(B, g, q, -hw, hw, yg, base + 0.15, -hd, hd, B.PAL['ashlar_dark'], B.STONE)
    for (a, b, c, d) in ((-hw, hw, -hd, -hd + 0.13), (-hw, hw, hd - 0.13, hd), (-hw, -hw + 0.13, -hd, hd),
                         (hw - 0.13, hw, -hd, hd)):
        pbox(B, g, q, a, b, base + 0.15, top, c, d, stone, B.STONE)
    pbox(B, g, q, -hw + 0.13, hw - 0.13, base + 0.15, top - 0.12, -hd + 0.13, hd - 0.13, WATER, B.STONE)
    # a moss line along its foot and a green stain inside the rim
    pbox(B, trim, q, -hw - 0.02, hw + 0.02, yg + 0.1, base + 0.12, -hd - 0.02, hd + 0.02, (0.33, 0.44, 0.19), B.STONE)


def hay(B, g, clutter, q):
    """A hay bale: a straw block with softened edges, two twine bands, loose straw round it."""
    top = q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    yg = min(B.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.05
    x, z = q['x'], q['z']
    tone = STRAW[int(_h(x, z) * len(STRAW))]
    g.box((x, (yg + top) / 2, z), (2 * hw, top - yg, 2 * hd), tone, B.PLASTER, bevel=0.08, yaw=q['rot'])
    for lx in (-hw * 0.45, hw * 0.45):
        pbox(B, g, q, lx - 0.03, lx + 0.03, yg + 0.02, top + 0.01, -hd - 0.01, hd + 0.01, ROPE, B.WOOD)
    for k in range(6):
        a = k * 1.1 + q['rot']
        rr = max(hw, hd) + 0.2 + 0.2 * _h(k, x)
        px, pz = x + math.sin(a) * rr, z + math.cos(a) * rr
        clutter.box((px, B.ground(px, pz) + 0.02, pz), (0.5, 0.03, 0.3), STRAW[k % 4], B.PLASTER, yaw=a)


def cart(B, g, trim, clutter, q):
    """A two-wheeled cart parked with its shafts on the ground: a planked bed with low sides,
    two big spoked wheels on an axle, the shafts resting down, sacks in the bed."""
    hw, hd = q['hw'], q['hd']
    x, z = q['x'], q['z']
    base = q['base']
    wheel_r = 0.75
    axle_y = base + wheel_r - 0.05
    bed_y = axle_y + 0.2
    dark, beam = B.PAL['beam_dark'], B.PAL['beam']
    # the bed and its sides (the cart tips forward a little onto its shafts)
    pbox(B, g, q, -hw, hw, bed_y, bed_y + 0.12, -hd + 0.4, hd, B.PAL['board'][0], B.WOOD)
    for s in (-1, 1):
        pbox(B, g, q, s * hw - 0.06, s * hw + 0.06, bed_y + 0.12, bed_y + 0.55, -hd + 0.4, hd, B.PAL['board'][2],
             B.WOOD)
    pbox(B, g, q, -hw, hw, bed_y + 0.12, bed_y + 0.55, hd - 0.1, hd, B.PAL['board'][2], B.WOOD)
    # the axle and the wheels (spokes, felloes, a hub)
    ax0, az0 = local(q, -hw - 0.25, 0.3)
    ax1, az1 = local(q, hw + 0.25, 0.3)
    g.cylinder((ax0, axle_y, az0), (ax1, axle_y, az1), 0.08, dark, B.WOOD, sides=6)
    for s in (-1, 1):
        cx, cz = local(q, s * (hw + 0.18), 0.3)
        axis = (math.cos(q['rot']), 0.0, -math.sin(q['rot']))
        g.ring((cx, axle_y, cz), wheel_r - 0.06, 0.13, beam, segments=14, axis=axis, mat=B.WOOD, depth=0.12)
        trim.ring((cx, axle_y, cz), wheel_r + 0.005, 0.03, B.PAL['iron'], segments=14, axis=axis, mat=B.METAL,
                  depth=0.13)
        g.cylinder((cx - axis[0] * 0.12, axle_y, cz - axis[2] * 0.12), (cx + axis[0] * 0.12, axle_y, cz + axis[2] * 0.12),
                   0.14, dark, B.WOOD, sides=8)
        for k in range(8):
            a = k * math.pi / 4 + 0.2
            # a spoke from the hub out to the rim, in the wheel's plane (the plane across its axis)
            ux, uz = -axis[2], axis[0]
            px = cx + ux * math.cos(a) * (wheel_r - 0.1)
            pz = cz + uz * math.cos(a) * (wheel_r - 0.1)
            g.beam([(cx, axle_y, cz), (px, axle_y + math.sin(a) * (wheel_r - 0.1), pz)], 0.06, 0.06, beam, B.WOOD)
    # the shafts, from under the bed down to the ground ahead
    for s in (-1, 1):
        sx, sz = local(q, s * (hw - 0.15), hd - 0.3)
        fx, fz = local(q, s * (hw - 0.3), -hd - 1.6)
        g.beam([(sx, bed_y - 0.05, sz), (fx, B.ground(fx, fz) + 0.1, fz)], 0.1, 0.12, beam, B.WOOD)
    # sacks and a barrel in the bed
    for k, (lx, lz) in enumerate(((-0.35, 0.8), (0.3, 0.5), (-0.1, -0.2))):
        px, pz = local(q, lx, lz)
        clutter.rock_blob((px, bed_y + 0.35, pz), (0.55, 0.45, 0.75), SACK[k % 2], B.PLASTER, jitter=0.12)
    del x, z


def woodpile(B, g, trim, q):
    """Split logs stacked against the hall's north wall, their round ends out, on two sleepers,
    under a little shingled lean-to roof hung from the wall."""
    import tavern_roofing as RF

    hw, hd = q['hw'], q['hd']
    x, z = q['x'], q['z']
    base, top = q['base'], q['base'] + q['height']
    for dz in (-hd + 0.3, hd - 0.3):
        B.beam(g, (x - hw, B.ground(x - hw, z + dz) + 0.06, z + dz), (x + hw, B.ground(x + hw, z + dz) + 0.06, z + dz),
               0.14, 0.12, B.PAL['beam_dark'])
    r = 0.14
    rows = int((top - base - 0.15) / (2 * r * 0.9))
    for row in range(rows):
        y = base + 0.18 + r + row * 2 * r * 0.88
        zz = z - hd + r + (r if row % 2 else 0.0)
        k = 0
        while zz < z + hd - r:
            ln = 2 * hw * (0.85 + 0.2 * _h(row, k))
            end = B.scale_color((0.78, 0.63, 0.44), 0.85 + 0.2 * _h(k, row))
            bark = B.scale_color((0.36, 0.27, 0.19), 0.85 + 0.25 * _h(row, k, 3))
            g.cylinder((x + hw - ln, y, zz), (x + hw, y, zz), r * (0.8 + 0.3 * _h(k, row, 2)), bark, B.WOOD, sides=6,
                       phase=_h(k, row) * 1.0)
            g.box((x + hw + 0.005, y, zz), (0.01, r * 1.5, r * 1.5), end, B.WOOD)
            zz += 2 * r * 0.95
            k += 1
    # the lean-to roof over it, from the wall down toward the open side
    wall_x = B.HALL['x1'] + 0.06
    y_hi, y_lo = top + 0.75, top + 0.3
    for dz in (-hd - 0.2, hd + 0.2):
        B.beam(g, (x + hw + 0.2, y_lo - 0.05, z + dz), (wall_x, y_hi, z + dz), 0.1, 0.14, B.PAL['beam_dark'])
        B.post(g, x + hw + 0.15, z + dz, B.ground(x + hw + 0.15, z + dz) - 0.1, y_lo - 0.1, 0.14, B.PAL['beam_dark'])
    lu = math.hypot(x + hw + 0.35 - wall_x, y_hi - y_lo)
    up = ((wall_x - (x + hw + 0.35)) / lu, (y_hi - y_lo) / lu, 0.0)
    RF.shingle_plane(B, g, (x + hw + 0.35, y_lo, z - hd - 0.35), (0, 0, 1), up, 2 * hd + 0.7, lu, seed=77, step=0.4,
                     size=0.6, moss=0.6)


# ---------------------------------------------------------------------------
# The stable
# ---------------------------------------------------------------------------
def stable(B, g, trim, clutter, s):
    """The open stable: a stone footing under planked walls on three sides, three posts along
    its open front, a stall partition, a manger along the back wall, a shingled roof with its
    ridge along the front, a lantern under the eave, a horseshoe over the middle post, straw on
    the floor, a saddle on the partition, a bucket and a pitchfork."""
    import tavern_roofing as RF

    x0, x1, z0, z1 = s['x0'], s['x1'], s['z0'], s['z1']
    base = s['baseY']
    eave, ridge = base + s['eave'], base + s['ridge']
    t = s['wall']
    dark, beam = B.PAL['beam_dark'], B.PAL['beam']
    zm = (z0 + z1) / 2
    k_front = (ridge - eave) / (z1 - zm)

    def roof_at(z):
        return ridge - abs(z - zm) * k_front

    # the walls: a stone footing course following the ground, vertical boards over it
    walls = [((x0, z0 + t / 2), (x1, z0 + t / 2), False), ((x0 + t / 2, z0), (x0 + t / 2, z1), True),
             ((x1 - t / 2, z0), (x1 - t / 2, z1), True)]
    for (a, b, side) in walls:
        L = math.dist(a, b)
        n = int(L / 0.32)
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            px0, pz0 = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
            px1, pz1 = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
            mx, mz = (px0 + px1) / 2, (pz0 + pz1) / 2
            yg = B.ground(mx, mz)
            foot_top = yg + 0.4
            top = roof_at(mz) - 0.12 if side else eave - 0.05
            g.box((mx, (yg - 0.3 + foot_top) / 2, mz), (abs(px1 - px0) + t + 0.04 if not side else t + 0.08, foot_top - yg + 0.3,
                                                    abs(pz1 - pz0) + 0.04 if side else t + 0.08),
                  B.pick(B.PAL['stone'], k), B.STONE)
            tone = B.scale_color(B.pick(B.PAL['board'], k), 0.8 + 0.18 * _h(mx, mz))
            if side:
                B.abox(g, mx - t / 2, mx + t / 2, foot_top, top, pz0 + 0.01, pz1 - 0.01, tone, B.WOOD)
            else:
                B.abox(g, px0 + 0.01, px1 - 0.01, foot_top, top, mz - t / 2, mz + t / 2, tone, B.WOOD)
        # a rail along the wall inside and out at mid height
        yg_mid = B.ground((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        for w in (-1, 1):
            if side:
                xx = a[0] + w * (t / 2 + 0.04)
                B.beam(g, (xx, yg_mid + 1.6, z0), (xx, yg_mid + 1.6, z1), 0.08, 0.16, dark)
            else:
                zz = a[1] + w * (t / 2 + 0.04)
                B.beam(g, (x0, yg_mid + 1.6, zz), (x1, yg_mid + 1.6, zz), 0.08, 0.16, dark)
    # the front posts and the front beam carrying the eave
    posts = [(x0 + t / 2, z1 - 0.2), ((x0 + x1) / 2 + (s['partitionX'] - (x0 + x1) / 2), z1 - 0.2), (x1 - t / 2, z1 - 0.2)]
    for (px, pz) in posts:
        yg = B.ground(px, pz)
        g.box((px, yg + 0.1, pz), (0.55, 0.4, 0.55), B.PAL['stone_dark'], B.STONE)
        B.post(g, px, pz, yg + 0.25, eave, 0.36, dark)
        # knee braces up to the beam
        for d in (-1, 1):
            if x0 + 0.4 < px + d * 0.8 < x1 - 0.4:
                B.beam(g, (px, eave - 0.9, pz), (px + d * 0.75, eave - 0.2, pz), 0.14, 0.14, beam)
    B.abox(g, x0 - 0.15, x1 + 0.15, eave - 0.25, eave + 0.1, z1 - 0.4, z1, dark, B.WOOD)
    # the back plate and the ridge beam, the gable ends' boards up to the roof
    B.abox(g, x0 - 0.15, x1 + 0.15, eave - 0.25, eave + 0.1, z0, z0 + 0.35, dark, B.WOOD)
    B.abox(g, x0 - 0.3, x1 + 0.3, ridge - 0.35, ridge - 0.05, zm - 0.15, zm + 0.15, dark, B.WOOD)
    # the stall partition: boards to shoulder height, a post at its end
    px = s['partitionX']
    zp1 = z0 + t + s['partitionTo']
    for k in range(int(s['partitionTo'] / 0.3)):
        za, zb = z0 + t + k * 0.3, z0 + t + (k + 1) * 0.3
        yg = B.ground(px, (za + zb) / 2)
        B.abox(g, px - 0.08, px + 0.08, yg, yg + 1.7 - 0.05 * (k % 2), za + 0.01, zb - 0.01,
               B.scale_color(B.pick(B.PAL['board'], k), 0.85), B.WOOD)
    B.post(g, px, zp1, B.ground(px, zp1) - 0.1, B.ground(px, zp1) + 1.95, 0.2, dark)
    # the manger along the back wall of the right stall, a hay rack over it
    mx0, mx1 = px + 0.3, x1 - t - 0.2
    yg = B.ground((mx0 + mx1) / 2, z0 + 0.6)
    B.abox(g, mx0, mx1, yg + 0.8, yg + 1.2, z0 + t, z0 + t + 0.55, beam, B.WOOD)
    B.abox(g, mx0 + 0.05, mx1 - 0.05, yg + 1.18, yg + 1.22, z0 + t + 0.05, z0 + t + 0.5, STRAW[0], B.PLASTER)
    for k in range(9):
        xx = mx0 + (mx1 - mx0) * (k + 0.5) / 9
        B.beam(g, (xx, yg + 1.5, z0 + t + 0.02), (xx, yg + 2.3, z0 + t + 0.4), 0.04, 0.04, dark)
    B.beam(g, (mx0, yg + 2.3, z0 + t + 0.4), (mx1, yg + 2.3, z0 + t + 0.4), 0.06, 0.06, dark)
    # the roof: two shingled slopes from the ridge, out over the front and the back
    over = s['eaveOut']
    for (sgn, zedge) in ((1, z1 + over), (-1, z0 - over)):
        y_edge = roof_at(zedge)
        lu = math.hypot(zedge - zm, ridge - y_edge)
        up = (0.0, (ridge - y_edge) / lu, -(zedge - zm) / lu)
        RF.shingle_plane(B, g, (x0 - 0.35, y_edge + 0.08, zedge), (1, 0, 0), up, x1 - x0 + 0.7, lu, seed=90 + sgn,
                         step=0.45, size=0.7, moss=0.8, bell=0.6)
        # the boards under it (the stable's ceiling) and the fascia
        B.hexa(g, [(x0 - 0.35, y_edge - 0.08, zedge), (x1 + 0.35, y_edge - 0.08, zedge), (x1 + 0.35, ridge - 0.08, zm),
                   (x0 - 0.35, ridge - 0.08, zm), (x0 - 0.35, y_edge + 0.06, zedge), (x1 + 0.35, y_edge + 0.06, zedge),
                   (x1 + 0.35, ridge + 0.06, zm), (x0 - 0.35, ridge + 0.06, zm)], B.PAL['sarking'], B.WOOD)
        B.abox(g, x0 - 0.4, x1 + 0.4, y_edge - 0.25, y_edge + 0.12, zedge - 0.08 if sgn > 0 else zedge,
               zedge if sgn > 0 else zedge + 0.08, dark, B.WOOD)
    RF.ridge_cappers(B, g, (x0 - 0.4, ridge + 0.2, zm), (x1 + 0.4, ridge + 0.2, zm), r=0.24, seed=91)
    # the gable ends: boards from the wall head up under the roof
    for xg in (x0 + t / 2, x1 - t / 2):
        for k in range(12):
            za = z0 + (z1 - z0) * k / 12
            zb = z0 + (z1 - z0) * (k + 1) / 12
            zmid = (za + zb) / 2
            yb = eave - 0.05
            yt = roof_at(zmid) - 0.1
            if yt > yb + 0.05:
                B.abox(g, xg - t / 2, xg + t / 2, yb, yt, za + 0.01, zb - 0.01,
                       B.scale_color(B.pick(B.PAL['board'], k + 1), 0.8), B.WOOD)
    # a lantern under the eave by the middle post, and a horseshoe over it
    lx, lz = posts[1][0] + 0.9, z1 - 0.2
    g.box((lx, eave - 0.55, lz), (0.26, 0.34, 0.26), B.PAL['iron'], B.METAL)
    g.box((lx, eave - 0.55, lz), (0.2, 0.28, 0.3), B.PAL['lamp'], B.GLOW)
    g.box((lx, eave - 0.3, lz), (0.04, 0.2, 0.04), B.PAL['iron'], B.METAL)
    hx, hz = posts[1][0], z1 + 0.02
    for k in range(7):
        a = math.pi * (0.1 + 0.8 * k / 6)
        b = math.pi * (0.1 + 0.8 * (k + 1) / 6)
        trim.beam([(hx + math.cos(a) * 0.14, eave - 0.45 + math.sin(a) * 0.14, hz),
                   (hx + math.cos(b) * 0.14, eave - 0.45 + math.sin(b) * 0.14, hz)], 0.05, 0.03, B.PAL['iron_hi'],
                  B.METAL, up=(0, 0, 1))
    # straw on the floor of both stalls, a saddle over the partition, a bucket and a pitchfork
    for k in range(26):
        sx = x0 + t + 0.3 + (x1 - x0 - 2 * t - 0.6) * _h(k, 1)
        sz = z0 + t + 0.3 + (z1 - z0 - t - 0.6) * _h(k, 2)
        clutter.box((sx, B.ground(sx, sz) + 0.02, sz), (0.8, 0.03, 0.45), STRAW[k % 4], B.PLASTER,
                    yaw=_h(k, 3) * 3.0)
    sy = B.ground(px, z0 + 1.6) + 1.72
    clutter.box((px, sy + 0.08, z0 + 1.6), (0.5, 0.18, 0.62), (0.4, 0.22, 0.12), B.WOOD, taper=0.7)
    clutter.box((px, sy - 0.15, z0 + 1.6), (0.56, 0.4, 0.5), (0.35, 0.19, 0.1), B.WOOD)
    bx, bz = x1 - 0.9, z1 - 0.9
    clutter.cylinder((bx, B.ground(bx, bz), bz), (bx, B.ground(bx, bz) + 0.4, bz), 0.2, B.PAL['beam'], B.WOOD, sides=8,
                     r1=0.24)
    clutter.ring((bx, B.ground(bx, bz) + 0.33, bz), 0.24, 0.04, B.PAL['iron'], segments=8, axis=(0, 1, 0),
                 mat=B.METAL, depth=0.03)
    fx, fz = x0 + t + 0.35, z1 - 0.5
    yg = B.ground(fx, fz)
    clutter.beam([(fx, yg, fz), (fx + 0.05, yg + 1.9, fz - 0.35)], 0.05, 0.05, B.PAL['beam'], B.WOOD)
    for d in (-0.08, 0.0, 0.08):
        clutter.beam([(fx + d, yg + 1.9, fz - 0.35), (fx + d, yg + 2.25, fz - 0.42)], 0.02, 0.02, B.PAL['iron'],
                     B.METAL)
