"""The Mirefen tavern's frame (build_tavern.py calls build(B, parts) with itself as B): the parts
the camera never cuts away. The stone base under every wall, every floor the sim walks (the
hall's boards, the hearth pit and its step, the bar platform, the bard's stage, the porch and
its steps, the tower's flagged nook with its rose), the round hearth and its copper hood and
flue hung high over it, the bar's counters and the beam over the bar, and the kitchen behind
the serving hatch. The bar's stone pillar is built here too, into its own part (BarPillar),
which the camera cuts away rather than fight.

Every walking surface is laid at the height the sim's floor surface gives it
(src/sim/mirefen_tavern_floor.ts): the ramped edges of the pit, the platform and the stage are
drawn as bevelled curbs, the porch steps stop on the ground. Nothing here crosses the common
room between its floor and the hammer beams (HALL['truss']): the hood, its rods and the beam
over the bar all hang over the camera's air."""
import math


def build(B, parts):
    p = parts['TavernFrame']
    trim = parts['TavernTrim']
    plinth(B, p)
    hall_floor(B, p)
    pit_and_hearth(B, p, trim)
    hood(B, p, trim)
    bar_platform(B, p)
    stage(B, p, trim)
    porch(B, p)
    nook_floor(B, p)
    bar(B, p, parts['BarPillar'], trim)
    kitchen(B, p, trim)


# ---------------------------------------------------------------------------
# Stone base: coursed blue-grey blocks from the ground floor down into the ground
# ---------------------------------------------------------------------------
def plinth_run(B, p, wall, t, seed):
    """The base under one straight outer wall: a backing mass and block faces on the outside,
    each course stopping where it meets the ground."""
    L = wall.length
    samples = [wall.xz(L * k / 12, t / 2) for k in range(13)]
    low = B.ground_min(samples) - 0.5
    if low >= -0.05:
        return
    wall.box(p, 0, L, low, 0.0, -t / 2, t / 2 + 0.05, B.PAL['stone_dark'], B.STONE)
    course = 0.8
    k = 0
    v = 0.0
    while v > low:
        u = -0.9 if k % 2 else 0.0
        j = 0
        while u < L:
            a, b = max(0.0, u), min(L, u + 1.9)
            if b - a > 0.2:
                g = min(B.ground(*wall.xz(a, t / 2)), B.ground(*wall.xz(b, t / 2)))
                if v > g - 0.4:
                    wall.box(p, a + 0.03, b - 0.03, max(v - course + 0.04, g - 0.5), v - 0.03, t / 2,
                             t / 2 + 0.1 + ((j * 7 + k * 3) % 3) * 0.015, B.pick(B.PAL['stone'], j + k * 3 + seed),
                             B.STONE)
            u += 1.9
            j += 1
        v -= course
        k += 1


def plinth(B, p):
    H, W, T = B.HALL, B.WING, B.TOWER
    t = H['wall']
    hx0, hx1, hz0, hz1 = H['x0'], H['x1'], H['z0'], H['z1']
    runs = [
        (B.Wall(hx0, hz1, hx1, hz1, (0, 1)), 1),        # the front
        (B.Wall(hx0, hz0, hx0, hz1, (-1, 0)), 2),       # the left
        (B.Wall(hx1, hz0, hx1, hz1, (1, 0)), 3),        # the right
        (B.Wall(hx0, hz0, -8.3, hz0, (0, -1)), 4),      # the back, west of the tower
        (B.Wall(W['x0'], W['z0'], W['x1'], W['z0'], (0, -1)), 5),   # the wing's back
        (B.Wall(W['x1'], W['z0'], W['x1'], W['z1'], (1, 0)), 6),    # the wing's east side
        (B.Wall(W['x0'], W['z0'], W['x0'], -21.9, (-1, 0)), 7),     # the wing's west side
    ]
    for wall, seed in runs:
        # the base's outer face stands flush under the wall's outer face
        shifted = B.Wall(wall.x0 - wall.nx * t / 2, wall.z0 - wall.nz * t / 2,
                         wall.x0 - wall.nx * t / 2 + wall.dx * wall.length,
                         wall.z0 - wall.nz * t / 2 + wall.dz * wall.length, (wall.nx, wall.nz))
        plinth_run(B, p, shifted, t, seed)
    # the tower's round base
    cx, cz, r1 = T['x'], T['z'], T['rOut']
    n = 28
    for i in range(n):
        a0 = -math.pi + 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n
        am = (a0 + a1) / 2
        if abs(am) < math.radians(40):
            continue  # inside the hall
        x0, z0 = cx + math.sin(a0) * (r1 + 0.1), cz + math.cos(a0) * (r1 + 0.1)
        x1, z1 = cx + math.sin(a1) * (r1 + 0.1), cz + math.cos(a1) * (r1 + 0.1)
        g = min(B.ground(x0, z0), B.ground(x1, z1)) - 0.5
        if g >= -0.05:
            continue
        seg = B.Wall(x0, z0, x1, z1, (math.sin(am), math.cos(am)))
        k = 0
        v = 0.0
        while v > g:
            seg.box(p, 0.02, seg.length - 0.02, max(v - 0.58, g), v - 0.03, -0.9, 0.02,
                    B.pick(B.PAL['stone'], i + k), B.STONE)
            v -= 0.62
            k += 1


# ---------------------------------------------------------------------------
# The hall's floor: honey boards, broken round the hearth pit and under the bar
# ---------------------------------------------------------------------------
def hall_floor(B, p):
    H, pit, plat, st = B.HALL, B.LAYOUT['pit'], B.LAYOUT['platform'], B.LAYOUT['stage']
    x0, x1 = H['x0'] + H['wall'], H['x1'] - H['wall']
    z0, z1 = H['z0'] + H['wall'], H['z1'] - H['wall']
    width = 0.95
    n = int(round((x1 - x0) / width))
    step = (x1 - x0) / n
    thick = 0.14

    def pit_half(x):
        # the curb's outer circle's half chord at x (0 past its side)
        dx = abs(x - pit['x'])
        return math.sqrt(pit['rim'] ** 2 - dx * dx) if dx < pit['rim'] else 0.0

    def strip_edges(xa, xb):
        # a board end's strip edges: broken at the circle's side (a chord across it would cut
        # the corner short of the curb), then the fewest strips whose chords keep within a few
        # inches of the circle (a chord of it runs in under the curb's lip, never out past it)
        sides = (pit['x'] - pit['rim'], pit['x'] + pit['rim'])
        cuts = [xa] + [x for x in sides if xa < x < xb] + [xb]
        edges = [xa]
        for u, v in zip(cuts, cuts[1:]):
            for m in (1, 2, 3, 4):
                worst = 0.0
                for k in range(m):
                    sa, sb = u + (v - u) * k / m, u + (v - u) * (k + 1) / m
                    mx, mz = (sa + sb) / 2 - pit['x'], (pit_half(sa) + pit_half(sb)) / 2
                    if max(pit_half(sa), pit_half(sb)) > 0:
                        worst = max(worst, pit['rim'] - math.hypot(mx, mz))
                if worst < 0.07 or m == 4:
                    edges += [u + (v - u) * (k + 1) / m for k in range(m)]
                    break
        return edges

    def board(xa, xb, c, d, color, pit_end):
        """One board from c to d: square-ended, or its end toward the pit (pit_end +1 its high
        end, -1 its low end) cut along the curb's circle in strips, so the board runs in under
        the curb's lip and no crescent opens between them."""
        if not pit_end:
            B.abox(p, xa, xb, -thick, 0.0, c, d, color, B.WOOD)
            return
        edges = strip_edges(xa, xb)
        for sa, sb in zip(edges, edges[1:]):
            if pit_end > 0:
                ea, eb = pit['z'] - pit_half(sa), pit['z'] - pit_half(sb)
                q = [(sa, c), (sb, c), (sb, eb), (sa, ea)]
            else:
                ea, eb = pit['z'] + pit_half(sa), pit['z'] + pit_half(sb)
                q = [(sa, ea), (sb, eb), (sb, d), (sa, d)]
            B.hexa(p, [(x, -thick, z) for (x, z) in q] + [(x, 0.0, z) for (x, z) in q], color, B.WOOD)

    # the board columns: those under the bar platform or the stage start before it, except
    # the one each bevel starts in, which runs the whole room (on under the bevel and the
    # deck, hidden) so it floors the strip between the deck and the next column
    columns = []
    for i in range(n):
        xa, xb = x0 + step * i + 0.004, x0 + step * (i + 1) - 0.004
        under = (xa + xb) / 2 >= plat['x0'] - plat['rim'] and xa >= plat['x0'] - 0.01
        on_stage = (xa + xb) / 2 <= st['x1'] + st['rim'] and xb <= st['x1'] + 0.01
        za = z0
        if under:
            za = plat['z1'] + plat['rim'] - 0.05
        elif on_stage:
            za = st['z1'] + st['rim'] - 0.05
        columns.append((i, xa, xb, za))
    for (i, xa, xb, za) in columns:
        # the circle's reach across this column (sampled across it)
        hs = [pit_half(xa + (xb - xa) * s / 8) for s in range(9)]
        if max(hs) > 0:
            # broken round the pit: each run's end toward it follows the circle
            runs = [(za, pit['z'] - max(hs), 1), (pit['z'] + max(hs), z1, -1)]
        else:
            runs = [(za, z1, 0)]
        for j, (a, b, end) in enumerate(runs):
            # boards come in lengths: break each run once at a staggered joint
            if b - a < 0.1:
                continue
            cut = a + (b - a) * (0.35 + 0.3 * ((i * 5) % 7) / 7)
            for k, (c, d) in enumerate(((a, cut - 0.004), (cut + 0.004, b))):
                if d - c <= 0.05:
                    continue
                pit_end = end if (end > 0 and k == 1) or (end < 0 and k == 0) else 0
                board(xa, xb, c, d, B.pick(B.PAL['board'], i * 3 + j + k), pit_end)
    # the thresholds: the front doorway and the stair arch, dressed stone
    door, arch = B.LAYOUT['door'], B.LAYOUT['arch']
    B.abox(p, door['x'] - door['width'] / 2, door['x'] + door['width'] / 2, -0.3, 0.02, z1, H['z1'],
           B.PAL['stone_dark'], B.STONE)
    B.abox(p, arch['x0'], arch['x1'], -0.3, 0.02, H['z0'], z0, B.PAL['stone_dark'], B.STONE)


# ---------------------------------------------------------------------------
# The hearth pit: flagstones one step down, the bevelled curb, the round hearth
# ---------------------------------------------------------------------------
def ring_pt(cx, cz, r, a):
    return (cx + math.sin(a) * r, cz + math.cos(a) * r)


def sector(B, p, cx, cz, r0, r1, a0, a1, y0, y1, color, mat, y1b=None, y1r=None, subdiv=1):
    """An annular sector solid from y0 to its top: flat at y1, or sloped to y1b at a1 (a
    spiral tread), or sloped radially to y1r at r1 (a curb)."""
    for s in range(subdiv):
        aa = a0 + (a1 - a0) * s / subdiv
        ab = a0 + (a1 - a0) * (s + 1) / subdiv
        ta = y1 if y1b is None else y1 + (y1b - y1) * s / subdiv
        tb = y1 if y1b is None else y1 + (y1b - y1) * (s + 1) / subdiv
        tro = y1r if y1r is not None else None
        p0 = ring_pt(cx, cz, r0, aa)
        p1 = ring_pt(cx, cz, r1, aa)
        p2 = ring_pt(cx, cz, r1, ab)
        p3 = ring_pt(cx, cz, r0, ab)
        t1a = ta if tro is None else tro
        t1b = tb if tro is None else tro
        B.hexa(p, [(p0[0], y0, p0[1]), (p1[0], y0, p1[1]), (p2[0], y0, p2[1]), (p3[0], y0, p3[1]),
                   (p0[0], ta, p0[1]), (p1[0], t1a, p1[1]), (p2[0], t1b, p2[1]), (p3[0], tb, p3[1])],
               color, mat)


def pit_and_hearth(B, p, trim):
    pit = B.LAYOUT['pit']
    cx, cz = pit['x'], pit['z']
    d = -pit['depth']
    hearth = next(q for q in B.LAYOUT['props'] if q['kind'] == 'hearth')
    rh = hearth['r']
    # a mortar bed under the flags (the joints show it, never the ground)
    p.cylinder((cx, d - 0.5, cz), (cx, d - 0.12, cz), pit['rim'], B.PAL['stone_dark'], B.STONE, sides=24)
    # flagstones in three rings
    rings = [(rh - 0.2, 2.9, 12), (2.9, 4.2, 16), (4.2, pit['r'], 20)]
    for ri, (r0, r1, n) in enumerate(rings):
        for i in range(n):
            a0 = 2 * math.pi * i / n + ri * 0.2
            a1 = a0 + 2 * math.pi / n
            sector(B, p, cx, cz, r0 + 0.02, r1 - 0.02, a0 + 0.012, a1 - 0.012, d - 0.2, d,
                   B.pick(B.PAL['flag'], i * 3 + ri), B.STONE, subdiv=1 if n > 12 else 2)
    # the bevelled curb the sim ramps up: from the pit floor at r to the hall floor at rim
    n = 32
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n
        sector(B, p, cx, cz, pit['r'], pit['rim'] + 0.05, a0, a1, d - 0.25, d, B.pick(B.PAL['stone'], i),
               B.STONE, y1r=0.0)
    # the round hearth: a knee-high ring of blue-grey blocks, a coping, the ash bed inside
    top = d + hearth['height']
    n = 18
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n
        sector(B, p, cx, cz, rh - 0.5, rh, a0 + 0.01, a1 - 0.01, d, top - 0.12, B.pick(B.PAL['stone'], i + 1),
               B.STONE)
        sector(B, p, cx, cz, rh - 0.6, rh + 0.08, a0, a1, top - 0.12, top, B.PAL['stone_dark'], B.STONE)
    B.abox(p, cx - rh + 0.5, cx + rh - 0.5, d, d + 0.25, cz - 0.9, cz + 0.9, B.PAL['soot'], B.STONE)
    # logs across the fire
    for k, (a, l) in enumerate(((0.3, 1.9), (1.9, 1.7), (-1.1, 1.6))):
        dx, dz = math.sin(a) * l / 2, math.cos(a) * l / 2
        y = d + 0.4 + k * 0.12
        p.cylinder((cx - dx, y, cz - dz), (cx + dx, y, cz + dz), 0.17, B.PAL['beam_dark'], B.WOOD, sides=7)
    # the iron fire grate (trim)
    for k in range(4):
        x = cx - 0.6 + k * 0.4
        B.abox(trim, x - 0.03, x + 0.03, d + 0.25, d + 0.33, cz - 0.7, cz + 0.7, B.PAL['iron'], B.METAL)


def shell_ring(B, p, cx, cz, rings, color_fn, mat, n=16):
    """A closed lathe solid through (r, y) profile points (the hood: out and back in)."""
    bm = p.bm
    vs = []
    for (r, y) in rings:
        vs.append([bm.verts.new(B.P(cx + math.sin(2 * math.pi * i / n) * r, y,
                                    cz + math.cos(2 * math.pi * i / n) * r)) for i in range(n)])
    faces = []
    m = len(vs)
    for k in range(m):
        a, b = vs[k], vs[(k + 1) % m]
        for i in range(n):
            f = bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            f[p.soft] = 1
            p.paint([f], color_fn(k), mat)
            faces.append(f)
    p.closed.extend(faces)


def hood(B, p, trim):
    pit, h = B.LAYOUT['pit'], B.LAYOUT['hood']
    cx, cz = pit['x'], pit['z']
    cop, dark = B.PAL['copper'], B.PAL['copper_dark']
    # the hood: a copper bell with a rolled rim, closed as a thin shell (out and back in)
    prof = [(h['rimR'], h['rimY']), (h['rimR'] - 0.35, h['rimY'] + 0.55), (h['topR'] + 0.05, h['topY']),
            (h['topR'] - 0.08, h['topY'] - 0.02), (h['rimR'] - 0.47, h['rimY'] + 0.55),
            (h['rimR'] - 0.1, h['rimY'] - 0.02)]
    shell_ring(B, p, cx, cz, prof, lambda k: dark if k in (3, 4, 5) else cop, B.METAL, n=20)
    # the rolled rim and a band half way up
    p.ring((cx, h['rimY'], cz), h['rimR'] + 0.02, 0.14, dark, segments=20, axis=(0, 1, 0), mat=B.METAL, depth=0.1)
    # the flue up through the roof, banded, with a cap over the ridge
    p.cylinder((cx, h['topY'] - 0.1, cz), (cx, h['flueTop'], cz), h['topR'] - 0.05, dark, B.METAL, sides=12,
               r1=h['topR'] - 0.14)
    y = h['topY'] + 2.0
    while y < h['flueTop'] - 0.5:
        p.cylinder((cx, y, cz), (cx, y + 0.18, cz), h['topR'] + 0.02, cop, B.METAL, sides=12)
        y += 2.6
    top = h['flueTop']
    p.cylinder((cx, top + 0.3, cz), (cx, top + 1.0, cz), 1.05, B.PAL['verdigris'], B.METAL, sides=12, r1=0.1)
    for s in (1, -1):
        B.abox(p, cx + s * 0.35 - 0.05, cx + s * 0.35 + 0.05, top - 0.1, top + 0.4, cz - 0.05, cz + 0.05,
               B.PAL['iron'], B.METAL)
    # four iron rods from the rim up to the ridge beam: the hood hangs over the camera's air
    ridge = B.HALL['ridge'] - 1.1
    for s in (1, -1):
        for dz in (-1, 1):
            rim = (cx + s * h['rimR'] * 0.7, h['rimY'] + 0.3, cz + dz * h['rimR'] * 0.7)
            B.beam(p, rim, (cx + s * 0.28, ridge, cz + dz * 1.4), 0.08, 0.08, B.PAL['iron'], B.METAL)
    # rivets round the rim (trim)
    for i in range(20):
        a = 2 * math.pi * (i + 0.5) / 20
        x, z = ring_pt(cx, cz, h['rimR'] - 0.18, a)
        trim.box((x, h['rimY'] + 0.3, z), (0.08, 0.08, 0.08), B.PAL['gold'], B.METAL)


# ---------------------------------------------------------------------------
# The bar platform: a raised deck with bevelled front and left edges
# ---------------------------------------------------------------------------
def bar_platform(B, p):
    q = B.LAYOUT['platform']
    lift, rim = q['lift'], q['rim']
    x0, x1, z0, z1 = q['x0'], q['x1'], q['z0'], q['z1']
    n = int((x1 - x0) / 0.85)
    for i in range(n):
        xa = x0 + (x1 - x0) * i / n + 0.004
        xb = x0 + (x1 - x0) * (i + 1) / n - 0.004
        B.abox(p, xa, xb, 0.0, lift, z0, z1, B.pick(B.PAL['board'], i + 2), B.WOOD)
    # the bevelled front edge (the sim ramps half a yard) and the left edge
    B.hexa(p, [(x0, 0, z1), (x1, 0, z1), (x1, 0, z1 + rim), (x0, 0, z1 + rim),
               (x0, lift, z1), (x1, lift, z1), (x1, 0.02, z1 + rim), (x0, 0.02, z1 + rim)],
           B.PAL['beam'], B.WOOD)
    B.hexa(p, [(x0 - rim, 0, z0), (x0, 0, z0), (x0, 0, z1), (x0 - rim, 0, z1),
               (x0 - rim, 0.02, z0), (x0, lift, z0), (x0, lift, z1), (x0 - rim, 0.02, z1)],
           B.PAL['beam'], B.WOOD)
    # the rounded corner, a fan of bevelled wedges
    for k in range(4):
        a0 = math.pi + math.pi / 2 * k / 4
        a1 = math.pi + math.pi / 2 * (k + 1) / 4
        c0 = (x0 + math.sin(a0) * rim, z1 - math.cos(a0) * rim)
        c1 = (x0 + math.sin(a1) * rim, z1 - math.cos(a1) * rim)
        B.hexa(p, [(x0, 0, z1), (x0, 0, z1), (c1[0], 0, c1[1]), (c0[0], 0, c0[1]),
                   (x0, lift, z1), (x0, lift, z1), (c1[0], 0.02, c1[1]), (c0[0], 0.02, c0[1])],
               B.PAL['beam'], B.WOOD)


# ---------------------------------------------------------------------------
# The porch and its steps down toward the road
# ---------------------------------------------------------------------------
def porch(B, p):
    q = B.LAYOUT['porch']
    x0, x1, z0, z1 = q['x0'], q['x1'], q['z0'], q['z1']
    low = B.ground_min([(x0, z1), (x1, z1), (x0, z0), (x1, z0)]) - 0.4
    B.abox(p, x0, x1, low, -0.2, z0, z1, B.PAL['stone_dark'], B.STONE)
    # flagstones
    for i in range(4):
        for j in range(2):
            xa = x0 + (x1 - x0) * i / 4
            za = z0 + (z1 - z0) * j / 2
            B.abox(p, xa + 0.03, xa + (x1 - x0) / 4 - 0.03, -0.2, 0.0, za + 0.03, za + (z1 - z0) / 2 - 0.03,
                   B.pick(B.PAL['flag'], i + j * 2), B.STONE)
    # parapets on both sides, dressed with a coping
    for x in (x0, x1):
        B.abox(p, x - 0.2, x + 0.2, low, q['parapet'] - 0.12, z0, z1 + 0.3, B.pick(B.PAL['stone'], 1), B.STONE)
        B.abox(p, x - 0.28, x + 0.28, q['parapet'] - 0.12, q['parapet'], z0 - 0.05, z1 + 0.38,
               B.PAL['stone_dark'], B.STONE)
    # the steps: each tread at the sim's ramp height at its middle, down until they meet the ground
    hw = q['stepHalfWidth']
    run = 0.8
    k = 0
    while True:
        za = z1 + run * k
        zb = za + run
        y = -q['stepSlope'] * (za - z1 + run / 2)
        g = max(B.ground(0, zb), B.ground(-hw, zb), B.ground(hw, zb))
        if y < g - 0.15 or k > 12:
            break
        bottom = min(B.ground(0, za), B.ground(-hw, za), B.ground(hw, za)) - 0.4
        B.abox(p, -hw, hw, bottom, y - 0.1, za, zb, B.PAL['stone_dark'], B.STONE)
        B.abox(p, -hw - 0.03, hw + 0.03, y - 0.1, y, za - 0.05, zb, B.pick(B.PAL['flag'], k), B.STONE)
        # stepped cheeks
        for s in (-1, 1):
            B.abox(p, s * hw - 0.25 if s > 0 else -hw - 0.25, s * hw + 0.25 if s > 0 else -hw + 0.25,
                   bottom, y + 0.35, za, zb, B.pick(B.PAL['stone'], k + 2), B.STONE)
        k += 1


# ---------------------------------------------------------------------------
# The bard's stage: a raised deck in the back left corner, its front and right edges bevelled
# like the bar platform's (the sim ramps them), a darker nosing along the deck's lip
# ---------------------------------------------------------------------------
def stage(B, p, trim):
    q = B.LAYOUT['stage']
    lift, rim = q['lift'], q['rim']
    x0, x1, z0, z1 = q['x0'], q['x1'], q['z0'], q['z1']
    # the deck: boards running across the stage, each its own tone, a hairline between them
    n = int(round((z1 - z0) / 0.62))
    for i in range(n):
        za = z0 + (z1 - z0) * i / n + 0.006
        zb = z0 + (z1 - z0) * (i + 1) / n - 0.006
        # boards come in two lengths, butted at a staggered joint
        cut = x0 + (x1 - x0) * (0.38 + 0.24 * ((i * 5) % 7) / 7)
        for k, (a, b) in enumerate(((x0, cut - 0.006), (cut + 0.006, x1))):
            B.abox(p, a, b, 0.0, lift, za, zb, B.pick(B.PAL['board'], i * 2 + k + 1), B.WOOD)
    # the bevelled front and right edges, and the rounded corner between them
    B.hexa(p, [(x0, 0, z1), (x1, 0, z1), (x1, 0, z1 + rim), (x0, 0, z1 + rim),
               (x0, lift, z1), (x1, lift, z1), (x1, 0.02, z1 + rim), (x0, 0.02, z1 + rim)],
           B.PAL['beam'], B.WOOD)
    B.hexa(p, [(x1, 0, z0), (x1 + rim, 0, z0), (x1 + rim, 0, z1), (x1, 0, z1),
               (x1, lift, z0), (x1 + rim, 0.02, z0), (x1 + rim, 0.02, z1), (x1, lift, z1)],
           B.PAL['beam'], B.WOOD)
    for k in range(4):
        a0 = math.pi / 2 * k / 4
        a1 = math.pi / 2 * (k + 1) / 4
        c0 = (x1 + math.sin(a0) * rim, z1 + math.cos(a0) * rim)
        c1 = (x1 + math.sin(a1) * rim, z1 + math.cos(a1) * rim)
        B.hexa(p, [(x1, 0, z1), (x1, 0, z1), (c1[0], 0, c1[1]), (c0[0], 0, c0[1]),
                   (x1, lift, z1), (x1, lift, z1), (c1[0], 0.02, c1[1]), (c0[0], 0.02, c0[1])],
               B.PAL['beam'], B.WOOD)
    # the dark oak nosing along the deck's lip, flush with it, and brass corner plates (trim)
    B.abox(p, x0, x1 - 0.02, lift - 0.07, lift + 0.004, z1 - 0.14, z1, B.PAL['beam_dark'], B.WOOD)
    B.abox(p, x1 - 0.14, x1, lift - 0.07, lift + 0.004, z0, z1 - 0.02, B.PAL['beam_dark'], B.WOOD)
    B.abox(trim, x1 - 0.2, x1 + 0.01, lift - 0.05, lift + 0.006, z1 - 0.2, z1 + 0.01, B.PAL['gold'], B.METAL)


# ---------------------------------------------------------------------------
# The tower's nook: flagged in rings round a two-tone stone rose, on a mortar bed, its hall
# side stopping under the arch's threshold
# ---------------------------------------------------------------------------
def nook_floor(B, p):
    T, H = B.TOWER, B.HALL
    cx, cz, ri = T['x'], T['z'], T['rIn']
    wall_z = H['z0']

    def piece(r0, r1, a0, a1, y0, y1, color, mat):
        pts = []
        for (r, a) in ((r0, a0), (r1, a0), (r1, a1), (r0, a1)):
            x, z = ring_pt(cx, cz, r, a)
            pts.append((x, min(z, wall_z)))
        B.hexa(p, [(x, y0, z) for (x, z) in pts] + [(x, y1, z) for (x, z) in pts], color, mat)

    # the mortar bed under the whole nook (the joints show it, never the ground)
    n = 24
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        piece(0.0, ri + 0.45, a0, a1, -0.42, -0.1, B.PAL['mortar'], B.STONE)
    # the rose: sixteen wedges in two tones, a dark ring round it
    n = 16
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n + 0.004, 2 * math.pi * (i + 1) / n - 0.004
        tone = B.PAL['ashlar_hi'] if i % 2 else B.scale_color(B.PAL['stone_dark'], 1.08)
        piece(0.0, 1.45, a0, a1, -0.22, 0.0, tone, B.STONE)
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n + 0.006, 2 * math.pi * (i + 1) / n - 0.006
        piece(1.5, 1.85, a0, a1, -0.22, 0.0, B.PAL['stone_dark'], B.STONE)
    # the flags, three rings, each staggered on the last
    rings = [(1.9, 3.2, 14), (3.25, 4.65, 20), (4.7, ri + 0.45, 26)]
    for ri_, (r0, r1, m) in enumerate(rings):
        for i in range(m):
            a0 = 2 * math.pi * i / m + ri_ * 0.19 + 0.008
            a1 = 2 * math.pi * (i + 1) / m + ri_ * 0.19 - 0.008
            am = (a0 + a1) / 2
            # the sector the arch opens on past the back wall's line is the hall's floor
            if cz + math.cos(am) * r0 > wall_z + 0.05:
                continue
            piece(r0 + 0.02, r1 - 0.02, a0, a1, -0.22, 0.0,
                  B.scale_color(B.pick(B.PAL['ashlar'], i * 3 + ri_), 0.92 + 0.12 * ((i * 7 + ri_) % 3) / 2),
                  B.STONE)


# ---------------------------------------------------------------------------
# The bar: the stone pillar at the elbow (its own part, cut away for the camera), the beam it
# carries to the right wall over the camera's air, and the two counters
# ---------------------------------------------------------------------------
def bar(B, p, pillar_part, trim):
    H = B.HALL
    truss = H['truss']
    for q in B.LAYOUT['props']:
        k = q['kind']
        base = q['base']
        if k == 'pillar':
            x, z, r = q['x'], q['z'], q['r']
            pp = pillar_part
            # an octagonal plinth, a moulded roll, the drum shaft with its bands, a flared
            # capital and its square abacus under the beam
            # warm dressed limestone, the tower's: an octagonal plinth, a moulded roll, drums of
            # varied tone with their joints dark between them, a carved band at head height, a
            # flared capital and its square abacus under the beam
            pp.cylinder((x, base - 0.5, z), (x, base + 0.45, z), r + 0.26, B.PAL['ashlar_dark'], B.STONE, sides=8,
                        phase=math.pi / 8)
            pp.cylinder((x, base + 0.45, z), (x, base + 0.72, z), r + 0.16, B.PAL['ashlar_hi'], B.STONE, sides=16,
                        r1=r + 0.02)
            top = truss - 1.15
            pp.cylinder((x, base + 0.72, z), (x, top, z), r - 0.035, B.PAL['mortar'], B.STONE, sides=16, caps=False)
            y, j = base + 0.72, 0
            while y < top - 0.05:
                h = min(0.78, top - y)
                pp.cylinder((x, y + 0.025, z), (x, y + h - 0.025, z), r,
                            B.scale_color(B.pick(B.PAL['ashlar'], j * 5 + 2), 0.9 + 0.12 * ((j * 3) % 4) / 3), B.STONE,
                            sides=16, caps=False, phase=0.2 * j)
                y += h
                j += 1
            for yb in (base + 3.1, top - 0.1):
                pp.cylinder((x, yb - 0.1, z), (x, yb + 0.1, z), r + 0.1, B.PAL['ashlar_hi'], B.STONE, sides=16)
                pp.cylinder((x, yb + 0.1, z), (x, yb + 0.18, z), r + 0.04, B.PAL['ashlar_dark'], B.STONE, sides=16)
            pp.cylinder((x, top, z), (x, truss - 0.4, z), r, B.PAL['ashlar_hi'], B.STONE, sides=16, r1=r + 0.32)
            pp.box((x, truss - 0.2, z), (2 * r + 0.8, 0.4, 2 * r + 0.8), B.PAL['ashlar_dark'], B.STONE, bevel=0.05)
            # the beam from the capital to the right wall, a carved bracket under its wall end
            xw = H['x1'] - H['wall']
            B.abox(p, x, xw + 0.2, truss, truss + 0.62, z - 0.28, z + 0.28, B.PAL['beam_dark'], B.WOOD, bevel=0.03)
            B.beam(p, (xw - 0.05, truss - 0.95, z), (xw - 1.05, truss + 0.02, z), 0.3, 0.26, B.PAL['beam'])
            B.abox(p, xw - 0.22, xw, truss - 1.3, truss, z - 0.2, z + 0.2, B.PAL['beam'], B.WOOD)
            # iron hooks along its underside for the hung tankards (clutter hangs them)
            for i in range(6):
                hx = x + 2.0 + i * 1.5
                B.abox(trim, hx - 0.025, hx + 0.025, truss - 0.28, truss, z - 0.025, z + 0.025, B.PAL['iron'],
                       B.METAL)
        elif k == 'counter':
            x, z, hw, hd = q['x'], q['z'], q['hw'], q['hd']
            top = base + q['height']
            # the body: dark panels in a honey frame, the top slab overhanging the drinkers' side
            B.abox(p, x - hw + 0.08, x + hw - 0.08, base, top - 0.15, z - hd + 0.1, z + hd - 0.08,
                   B.PAL['beam_dark'], B.WOOD)
            B.abox(p, x - hw - 0.1, x + hw + 0.1, top - 0.15, top, z - hd - 0.05, z + hd + 0.15,
                   B.PAL['honey'][2], B.WOOD, bevel=0.03)
            B.abox(p, x - hw, x + hw, base, base + 0.18, z - hd, z + hd, B.PAL['beam'], B.WOOD)
            n = max(1, int(hw * 2 / 1.2))
            for i in range(n + 1):
                xp = x - hw + 0.08 + (hw * 2 - 0.16) * i / n
                B.abox(p, xp - 0.07, xp + 0.07, base, top - 0.15, z - hd + 0.02, z + hd + 0.01, B.PAL['honey'][0],
                       B.WOOD)
            # a raised field in each bay on the drinkers' side, bevelled so it catches the light
            if hw > hd:
                for i in range(n):
                    xa = x - hw + 0.08 + (hw * 2 - 0.16) * i / n + 0.16
                    xb = x - hw + 0.08 + (hw * 2 - 0.16) * (i + 1) / n - 0.16
                    B.abox(p, xa, xb, base + 0.34, top - 0.34, z + hd - 0.08, z + hd + 0.02,
                           B.scale_color(B.PAL['beam'], 1.05), B.WOOD, bevel=0.03)
            # the brass foot rail on the drinkers' side (trim)
            if hw > hd:
                trim.cylinder((x - hw, base + 0.35, z + hd + 0.3), (x + hw, base + 0.35, z + hd + 0.3), 0.05,
                              B.PAL['gold'], B.METAL, sides=6)
                for i in range(4):
                    xp = x - hw + 0.3 + (hw * 2 - 0.6) * i / 3
                    B.abox(trim, xp - 0.03, xp + 0.03, base + 0.3, base + 0.4, z + hd, z + hd + 0.3,
                           B.PAL['gold'], B.METAL)


# ---------------------------------------------------------------------------
# The kitchen behind the serving hatch: a flagged floor, plastered partitions and a boarded
# ceiling closing a small room in the wing, the stone range with its firebox and chimney
# breast on the far wall, a cook's table (seen only through the hatch)
# ---------------------------------------------------------------------------
KITCHEN = dict(x0=5.6, x1=13.4, z0=-18.2, z1=-14.0, ceil=5.8)


def kitchen(B, p, trim):
    k = KITCHEN
    x0, x1, z0, z1, ceil = k['x0'], k['x1'], k['z0'], k['z1'], k['ceil']
    # the floor: big worn flags on a bed
    B.abox(p, x0, x1, -0.4, -0.2, z0, z1, B.PAL['mortar'], B.STONE)
    i = 0
    for xa in (x0, x0 + 2.0, x0 + 3.9, x0 + 5.9):
        xb = min(x1, xa + 1.95)
        for (za, zb) in ((z0, z0 + 1.4), (z0 + 1.45, z0 + 2.8), (z0 + 2.85, z1)):
            B.abox(p, xa + 0.03, xb - 0.03, -0.2, 0.0, za + 0.03, zb - 0.03, B.pick(B.PAL['flag'], i), B.STONE)
            i += 1
    # the partitions: plaster over a sill, oak posts on their faces
    B.abox(p, x0 - 0.2, x1 + 0.2, 0.0, ceil, z0 - 0.2, z0, B.PAL['plaster_in'][1], B.PLASTER)
    for xa in (x0 - 0.2, x1):
        B.abox(p, xa, xa + 0.2, 0.0, ceil, z0 - 0.2, z1, B.PAL['plaster_in'][0], B.PLASTER)
    for xp in (x0 + 0.1, x0 + 2.4, x1 - 2.4, x1 - 0.1):
        B.abox(p, xp - 0.14, xp + 0.14, 0.0, ceil, z0, z0 + 0.1, B.PAL['beam'], B.WOOD)
    B.abox(p, x0, x1, 0.0, 0.3, z0, z0 + 0.08, B.PAL['beam_dark'], B.WOOD)
    # the ceiling: boards over three joists
    B.abox(p, x0 - 0.2, x1 + 0.2, ceil, ceil + 0.2, z0 - 0.2, z1, B.PAL['sarking'], B.WOOD)
    for xj in (x0 + 1.6, (x0 + x1) / 2, x1 - 1.6):
        B.abox(p, xj - 0.16, xj + 0.16, ceil - 0.36, ceil, z0, z1, B.PAL['beam_dark'], B.WOOD)
    # the range: a stone body, an iron top, the arched firebox glowing, the breast and flue
    xm = (x0 + x1) / 2
    B.abox(p, xm - 1.5, xm + 1.5, 0.0, 1.25, z0, z0 + 1.05, B.pick(B.PAL['stone'], 2), B.STONE, bevel=0.03)
    B.abox(p, xm - 1.6, xm + 1.6, 1.25, 1.36, z0, z0 + 1.12, B.PAL['iron'], B.METAL)
    B.abox(p, xm - 0.6, xm + 0.6, 0.22, 0.85, z0 + 0.95, z0 + 1.07, B.PAL['soot'], B.STONE)
    B.abox(p, xm - 0.5, xm + 0.5, 0.26, 0.5, z0 + 1.0, z0 + 1.08, B.PAL['ember'], B.GLOW)
    for s in (-1, 1):
        B.abox(trim, xm + s * 0.62 - 0.04, xm + s * 0.62 + 0.04, 0.2, 0.9, z0 + 1.05, z0 + 1.1, B.PAL['iron'],
               B.METAL)
    B.abox(p, xm - 1.2, xm + 1.2, 1.36, ceil, z0, z0 + 0.7, B.pick(B.PAL['stone'], 1), B.STONE)
    B.abox(p, xm - 1.35, xm + 1.35, 2.2, 2.38, z0, z0 + 0.86, B.PAL['beam_dark'], B.WOOD)
    # the cook's table in the middle, scrubbed pale
    tx, tz = xm, z0 + 2.55
    B.abox(p, tx - 1.0, tx + 1.0, 1.28, 1.42, tz - 0.55, tz + 0.55, B.PAL['honey'][2], B.WOOD, bevel=0.02)
    for sx in (-0.85, 0.85):
        for sz in (-0.42, 0.42):
            B.post(p, tx + sx, tz + sz, 0.0, 1.28, 0.14, B.PAL['beam'])
    B.abox(trim, tx - 0.85, tx + 0.85, 0.3, 0.38, tz - 0.04, tz + 0.04, B.PAL['beam_dark'], B.WOOD)
