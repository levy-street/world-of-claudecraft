"""The Mirefen tavern's front, dressed for the road: what a traveller on the Fenbridge road sees
before the door. tavern_shell.py hall_front calls door_lantern, sign_ironwork and sign_board
into the shell parts; build_tavern.py calls build(B, parts) for the rest.

  HallWallFront   the door lanterns either side of the porch canopy (the front wall's split
                  hands each to its side's part): an iron cage on a scrolled wall arm, amber
                  glass on three sides and bars on the side toward the road, a candle burning
                  inside. They glow (TavernGlow), they cast no light: the runtime's point
                  lights stay indoors (src/render/mirefen_tavern.ts mirefenTavernLights)
  HallPorch       the tankard sign's carved mounting board and the wrought scrollwork under its
                  arm, and a small painted board hung under the tankard on two chains: a
                  crescent moon and a star on garnet, a picture only (no lettering)
  TavernTrim      medium and up: window boxes and their greenery under the two ground-floor
                  windows and the jettied storey's four, the carved drops under the
                  front bargeboards and the pendant at their apex, the painted roundel on the
                  porch canopy's gable, a worn doormat, weathering at the feet of the front's
                  posts
  TavernClutter   high and up: the flowers in the window boxes, the flowering ivy up the
                  front's left corner (leaf clusters, denser low, onto the stone base, along
                  the sill beam and round the corner), a hanging flower basket from each canopy
                  bracket, a boot scraper by the door, a tankard left on the tallest porch cask

The flower tubs at the foot of the porch steps are furniture the sim collides with
(TAVERN_PROPS kind 'planter', tavern_furnish.py planter).

Everything here is outside the walls, so the warm bake (build_tavern.py bake_warm_light) never
touches it; the palette is the tavern's own, with the garnet of the shutters on the window
boxes and the sign's board, and the flowers kept to red, cream and gold.
"""
import math

# the greenery and the soil (the rest of the colours come from B.PAL)
LEAF = [(0.25, 0.4, 0.2), (0.31, 0.47, 0.23), (0.21, 0.35, 0.19), (0.35, 0.5, 0.26)]
# the ivy's greens: deep, mid, fresh, a yellowing one and a blue-green, mixed per leaf
IVY = [(0.17, 0.3, 0.15), (0.24, 0.39, 0.19), (0.32, 0.48, 0.22), (0.41, 0.53, 0.24), (0.2, 0.35, 0.24),
       (0.27, 0.43, 0.21)]
SOIL = (0.24, 0.17, 0.11)
STEM = (0.3, 0.24, 0.14)
# the material index of the single-sided faces (build_tavern.py PLASTER)
PLASTER = 3
FLOWERS = [(0.8, 0.2, 0.22), (0.95, 0.9, 0.78), (0.93, 0.72, 0.3), (0.68, 0.14, 0.2)]


def build(B, parts):
    import tavern_shell as S

    trim, clutter = parts['TavernTrim'], parts['TavernClutter']
    H = B.HALL
    mid = -H['x0']
    face = H['z1']
    import tavern_jetty as JET

    # the ground floor's windows shelter under the jettied storey (their old slate hoods went
    # with it); the upper storey's leaded windows carry their own boxes on its face
    for (u0, u1, v0, v1) in S.FRONT_WINDOWS:
        window_box(B, trim, clutter, u0 - mid, u1 - mid, v0, face)
    for (x, w) in JET.UPPER_WINDOWS:
        window_box(B, trim, clutter, x - w / 2, x + w / 2, JET.UPPER_SILL, JET.face_z(B), scale=0.8)
    bargeboard_carving(B, trim)
    canopy_roundel(B, trim)
    creeper(B, clutter, face)
    for s in (1, -1):
        hanging_basket(B, clutter, s * 3.3, 16.55, s)
    for q in B.LAYOUT['props']:
        if q['kind'] == 'planter':
            tub_flowers(B, clutter, q)
    doormat(B, trim, face)
    boot_scraper(B, clutter, -2.44, face + 0.42)
    weathering(B, trim, face, [x for x in S.FRONT_POSTS if abs(x) > 2.9])
    # a tankard left on the tallest porch cask
    import tavern_furnish as U

    casks = [q for q in B.LAYOUT['props'] if q['kind'] == 'cask']
    if casks:
        q = max(casks, key=lambda c: c['height'])
        U.mug(B, clutter, q['x'] - 0.1, q['base'] + q['height'] + 0.01, q['z'] + 0.05, a=2.2)


# ---------------------------------------------------------------------------
# Wrought iron
# ---------------------------------------------------------------------------
def scroll(B, p, x, pts, width=0.06, depth=0.1):
    """A flat iron bar bent in the (y, z) plane at x: `pts` are (y, z); the bar's thin side
    lies in the plane, its broad side faces +-x (a sign bracket's scrollwork)."""
    p.beam([(x, y, z) for (y, z) in pts], width, depth, B.PAL['iron'], B.METAL, up=(1, 0, 0))


def spiral(cy, cz, r0, r1, a0, turn, n):
    """(y, z) points round a spiral from radius r0 at angle a0 to r1 after `turn` radians."""
    out = []
    for k in range(n):
        t = k / (n - 1)
        a = a0 + turn * t
        r = r0 + (r1 - r0) * t
        out.append((cy + r * math.cos(a), cz + r * math.sin(a)))
    return out


def door_lantern(B, p, x, v, face):
    """A door lantern on a scrolled iron arm out from the front wall's face at local x: an
    iron cage (base, corner posts, a pyramid roof, a finial hung from the arm), amber glass
    on the back and the sides, two bars across the side toward the road, and a candle and
    its flame inside, seen between the bars."""
    iron = B.PAL['iron']
    out, s, h = 0.72, 0.4, 0.52
    arm_y = v + 0.9
    B.beam(p, (x, arm_y, face), (x, arm_y, face + out + 0.08), 0.07, 0.07, iron, B.METAL)
    # the scroll under the arm: up from the wall, out under it, curled at its end
    scroll(B, p, x, [(v + 0.45, face + 0.02), (v + 0.66, face + 0.08), (v + 0.8, face + 0.24),
                     (v + 0.84, face + 0.44), (v + 0.74, face + 0.52), (v + 0.68, face + 0.42)],
           width=0.045, depth=0.06)
    cz = face + out
    cy = arm_y - 0.04 - 0.36 - h / 2
    # the finial hooked under the arm, the roof, the frames top and bottom
    p.box((x, cy + h / 2 + 0.3, cz), (0.05, 0.14, 0.05), iron, B.METAL)
    p.box((x, cy + h / 2 + 0.13, cz), (s * 1.12, 0.2, s * 1.12), iron, B.METAL, taper=0.3)
    p.box((x, cy + h / 2 + 0.01, cz), (s * 1.1, 0.05, s * 1.1), iron, B.METAL)
    p.box((x, cy - h / 2 - 0.03, cz), (s * 1.12, 0.06, s * 1.12), iron, B.METAL)
    for dx in (-s / 2, s / 2):
        for dz in (-s / 2, s / 2):
            p.box((x + dx, cy, cz + dz), (0.045, h, 0.045), iron, B.METAL)
    # the glass: the back and the sides (the light the runtime glows), bars toward the road
    pane = (0.9, 0.58, 0.28)
    p.box((x, cy, cz - s / 2 + 0.02), (s * 0.92, h * 0.94, 0.03), pane, B.GLOW)
    for dx in (-s / 2 + 0.02, s / 2 - 0.02):
        p.box((x + dx, cy, cz), (0.03, h * 0.94, s * 0.92), pane, B.GLOW)
    for dx in (-s / 6, s / 6):
        p.box((x + dx, cy, cz + s / 2), (0.03, h, 0.03), iron, B.METAL)
    # the candle and its flame
    p.cylinder((x, cy - h / 2, cz), (x, cy - h / 2 + 0.2, cz), 0.055, B.PAL['cream'], B.PLASTER, sides=6)
    p.box((x, cy - h / 2 + 0.27, cz), (0.07, 0.14, 0.07), B.PAL['candle'], B.GLOW, taper=0.25)


def sign_ironwork(B, p, tx, arm, face, tz):
    """The sign arm's carved mounting board on the wall and the wrought scrollwork that
    carries the arm: a quarter-round brace from the board's foot out to the arm, a large
    scroll in the quarter it closes, and a small one at either end of it."""
    dark = B.PAL['beam_dark']
    y0, y1 = arm - 2.6, arm + 0.2
    # the board: dark oak, a garnet panel, pointed ends
    B.abox(p, tx - 0.32, tx + 0.32, y0, y1, face, face + 0.1, dark, B.WOOD)
    B.abox(p, tx - 0.2, tx + 0.2, y0 + 0.25, y1 - 0.25, face + 0.1, face + 0.13, B.PAL['garnet'], B.PLASTER)
    B.abox(p, tx - 0.05, tx + 0.05, y0 + 0.35, y1 - 0.35, face + 0.13, face + 0.15, B.PAL['gold'], B.PLASTER)
    p.box((tx, y1 + 0.09, face + 0.05), (0.64, 0.18, 0.1), dark, B.WOOD, taper=0.25)
    p.box((tx, y0 - 0.09, face + 0.05), (0.64, 0.18, 0.1), dark, B.WOOD, taper=0.25, pitch=math.pi)
    # the brace: a quarter round from the board's foot out to the arm, bowed away from the
    # corner, the scrolls in the quarter it closes
    z0, zb = face + 0.1, tz - 1.0
    ya, yb = y0 + 0.3, arm - 0.08
    brace = []
    for k in range(7):
        a = k / 6 * math.pi / 2
        brace.append((yb - (yb - ya) * math.cos(a), z0 + (zb - z0) * math.sin(a)))
    scroll(B, p, tx, brace, width=0.09, depth=0.13)
    scroll(B, p, tx, spiral(yb - 0.74, z0 + 0.95, 0.66, 0.1, 0.0, 2 * math.pi * 1.1, 11), width=0.055)
    scroll(B, p, tx, spiral(ya + 0.62, z0 + 0.34, 0.32, 0.07, -math.pi / 2, 2 * math.pi * 0.9, 8), width=0.05)
    scroll(B, p, tx, spiral(yb - 0.34, zb - 0.62, 0.28, 0.07, 0.0, -2 * math.pi * 0.9, 8), width=0.05)


def crescent(B, p, x, yc, zc, R, w, half, facing, n=7):
    """A crescent moon standing `half` either side of x in the (y, z) plane, its horns open
    toward `facing` (an angle in the plane: 0 toward +z, pi/2 up), fattest opposite."""
    a0, a1 = facing + 0.85, facing + 2 * math.pi - 0.85
    for k in range(n):
        pts = []
        for t in (k / n, (k + 1) / n):
            a = a0 + (a1 - a0) * t
            ww = w * max(0.08, math.sin(math.pi * t))
            # the inner edge runs off centre, so the horns taper to points
            ri, ro = R - ww, R
            pts.append([(yc + ri * math.sin(a), zc + ri * math.cos(a)), (yc + ro * math.sin(a), zc + ro * math.cos(a))])
        (ia, oa), (ib, ob) = pts
        ring = [ia, oa, ob, ib]
        B.hexa(p, [(x - half, y, z) for (y, z) in ring] + [(x + half, y, z) for (y, z) in ring], B.PAL['gold'],
               B.PLASTER)


def star(B, p, c, u, v, n, long, short, half, color=None, mat=None):
    """An eight-point star about the point c in the plane of the unit vectors u and v, a slab
    `half` either side of it along n: four long rays and four short ones between them, each
    a flat wedge from a broad foot to its point."""
    color = color or B.PAL['gold']
    mat = B.PLASTER if mat is None else mat

    def at(a, b, w):
        return tuple(c[i] + u[i] * a + v[i] * b + n[i] * w for i in range(3))

    for k in range(8):
        a = k * math.pi / 4
        ln = long if k % 2 == 0 else short
        w = ln * 0.36
        du, dv = math.cos(a), math.sin(a)
        pu, pv = -dv, du
        foot = [(pu * w, pv * w), (-pu * w, -pv * w), (du * ln, dv * ln), (du * ln, dv * ln)]
        B.hexa(p, [at(fu, fv, -half) for (fu, fv) in foot] + [at(fu, fv, half) for (fu, fv) in foot], color, mat)


def sign_board(B, p, tx, base, tz):
    """A small board hung under the tankard on two short chains: a dark oak frame round a
    garnet panel painted both sides with a gold crescent moon cradling a star and two small
    stars by it (the inn's beds under the tankard's ale; a picture, never words)."""
    dark = B.PAL['beam_dark']
    top, bot, hw = base - 0.5, base - 1.4, 0.75
    for dz in (-0.5, 0.5):
        B.chain(p, (tx, base, tz + dz), (tx, top + 0.02, tz + dz), links=3)
    B.abox(p, tx - 0.04, tx + 0.04, bot + 0.08, top - 0.1, tz - hw + 0.08, tz + hw - 0.08, B.PAL['garnet'],
           B.PLASTER)
    B.abox(p, tx - 0.07, tx + 0.07, top - 0.12, top, tz - hw - 0.06, tz + hw + 0.06, dark, B.WOOD)
    B.abox(p, tx - 0.07, tx + 0.07, bot, bot + 0.1, tz - hw, tz + hw, dark, B.WOOD)
    for zz in (tz - hw, tz + hw):
        B.abox(p, tx - 0.07, tx + 0.07, bot, top - 0.12, zz - 0.08, zz + 0.08, dark, B.WOOD)
    ym = (top + bot) / 2 - 0.01
    # the moon on the wall's side of the board, its horns up toward the star on the road's side
    crescent(B, p, tx, ym - 0.04, tz - 0.25, 0.3, 0.2, 0.06, math.pi * 0.28)
    star(B, p, (tx, ym + 0.1, tz + 0.33), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0.32, 0.15, 0.06)
    gold = B.PAL['gold']
    for (dy, dz, sz) in ((-0.2, 0.55, 0.1), (0.24, -0.58, 0.08)):
        p.box((tx, ym + dy, tz + dz), (0.12, sz, sz), gold, B.PLASTER, pitch=math.pi / 4)


# ---------------------------------------------------------------------------
# The windows
# ---------------------------------------------------------------------------
def window_box(B, trim, clutter, x0, x1, v0, face, scale=1.0):
    """A garnet window box under a front window on two iron brackets: dark oak rims, green
    clumps spilling over its lip (trim) and red, cream and gold flowers in them (clutter).
    `scale` shrinks it for the small upper windows."""
    k = scale
    xa, xb = x0 - 0.2 * k, x1 + 0.2 * k
    y0, y1 = v0 - 0.26 - 0.52 * k, v0 - 0.26
    z0, z1 = face + 0.06, face + 0.06 + 0.56 * k
    B.abox(trim, xa, xb, y0, y1, z0, z1, B.PAL['garnet_dark'], B.WOOD)
    B.abox(trim, xa - 0.04, xb + 0.04, y1 - 0.02, y1 + 0.06, z0, z1 + 0.04, B.PAL['beam'], B.WOOD)
    B.abox(trim, xa - 0.02, xb + 0.02, y0 - 0.02, y0 + 0.06, z0, z1 + 0.03, B.PAL['beam_dark'], B.WOOD)
    B.abox(trim, xa + 0.05, xb - 0.05, y1 - 0.08, y1 + 0.02, z0 + 0.05, z1 - 0.05, SOIL, B.PLASTER)
    for x in (xa + 0.3 * k, xb - 0.3 * k):
        B.beam(trim, (x, y0 - 0.45 * k, face + 0.02), (x, y0 - 0.02, z1 - 0.12 * k), 0.05, 0.05, B.PAL['iron'],
               B.METAL)
    # the greens: clumps along the box, a few spilling over its front
    n = 5 if k > 0.9 else 3
    for i in range(n):
        x = xa + 0.22 * k + (xb - xa - 0.44 * k) * i / (n - 1)
        trim.rock_blob((x, y1 + 0.14 * k, (z0 + z1) / 2 + (0.05 if i % 2 else -0.04) * k),
                       (0.52 * k, 0.36 * k, 0.5 * k), LEAF[i % len(LEAF)], B.PLASTER, jitter=0.2, subdivisions=0)
    for i, f in enumerate((0.2, 0.55, 0.85) if k > 0.9 else (0.3, 0.75)):
        x = xa + (xb - xa) * f
        trim.rock_blob((x, y1 - (0.18 + 0.08 * (i % 2)) * k, z1 + 0.04), (0.3 * k, 0.5 * k, 0.12),
                       LEAF[(i + 2) % len(LEAF)], B.PLASTER, jitter=0.15, subdivisions=0)
    # the flowers: little heads over the greens
    m = 8 if k > 0.9 else 5
    for i in range(m):
        x = xa + 0.18 * k + (xb - xa - 0.36 * k) * i / (m - 1)
        zz = (z0 + z1) / 2 + (0.14 if i % 2 else -0.1) * k
        yy = y1 + (0.3 + 0.07 * ((i * 5) % 3)) * k
        clutter.box((x, yy, zz), (0.15 * k, 0.12 * k, 0.15 * k), FLOWERS[(i * 3) % len(FLOWERS)], B.PLASTER,
                    yaw=0.4 * i)


# ---------------------------------------------------------------------------
# The gable, the canopy, the creeper
# ---------------------------------------------------------------------------
def bargeboard_carving(B, p):
    """Carved drops under the front gable's bargeboards (tavern_shell.py hall_roof) and a
    turned pendant under the finial at their apex."""
    import tavern_shell as S

    H = B.HALL
    xe = H['x1'] + H['eaveOut']
    ye = S.hall_y(B, xe)
    zz = H['z1'] + H['vergeOut'] + 0.1
    top = H['ridge'] + 0.12
    run = math.hypot(xe + 0.1, top - (ye - 0.2))
    # the board's underside: 0.31 under its centre line, square to the slope
    nx, ny = (top - (ye - 0.2)) / run, (xe + 0.1) / run
    dark = B.PAL['beam_dark']
    for s in (1, -1):
        n = 7
        for k in range(1, n):
            t = k / n
            cx = s * (xe + 0.1) * (1 - t)
            cy = (ye - 0.2) + (top - (ye - 0.2)) * t
            ux, uy = cx - s * nx * 0.31, cy - ny * 0.31
            p.box((ux, uy - 0.2, zz), (0.2, 0.42, 0.12), dark, B.WOOD, taper=0.15, pitch=math.pi)
        # the board's foot, carved into a kick
        p.box((s * (xe + 0.05), ye - 0.62, zz), (0.24, 0.5, 0.14), dark, B.WOOD, taper=0.3, pitch=math.pi)
    # the pendant under the finial post
    p.cylinder((0, H['ridge'] - 0.8, zz), (0, H['ridge'] - 1.45, zz), 0.13, dark, B.WOOD, sides=6, r1=0.06)
    p.box((0, H['ridge'] - 1.52, zz), (0.2, 0.2, 0.2), B.PAL['beam'], B.WOOD, taper=0.35, pitch=math.pi)


def canopy_roundel(B, p):
    """A painted roundel on the porch canopy's gable over the door: a gold rim, a garnet
    field, the sign board's gold star on it."""
    q = B.LAYOUT['porch']
    front = q['z1'] + 0.6
    y = 7.0
    p.cylinder((0, y, front), (0, y, front + 0.04), 0.5, B.PAL['gold'], B.PLASTER, sides=12)
    p.cylinder((0, y, front + 0.04), (0, y, front + 0.07), 0.43, B.PAL['garnet'], B.PLASTER, sides=12)
    star(B, p, (0, y, front + 0.085), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.3, 0.15, 0.018)


def _h(k, salt=0.0):
    """A stable pseudo-random number in [0, 1) for the k-th leaf (no rng: the build is
    deterministic)."""
    v = math.sin(k * 12.9898 + salt * 78.233) * 43758.5453
    return v - math.floor(v)


def _along(line, step):
    """Points every `step` along a polyline."""
    out = []
    for (a, b) in zip(line, line[1:]):
        m = max(1, int(math.dist(a, b) / step))
        for i in range(m):
            t = i / m
            out.append(tuple(a[j] + (b[j] - a[j]) * t for j in range(3)))
    out.append(line[-1])
    return out


def leaf(p, o, r, u, n, length, width, color, lift=0.04):
    """One leaf, a single pointed face in the plane of r (across) and u (along it), facing n
    (r x u = n): its stalk at o, its point `length` along u and lifted `lift` off the wall."""
    tip = tuple(o[i] + u[i] * length + n[i] * lift for i in range(3))
    mid = 0.42 * length
    right = tuple(o[i] + r[i] * width + u[i] * mid + n[i] * lift * 0.5 for i in range(3))
    left = tuple(o[i] - r[i] * width + u[i] * mid + n[i] * lift * 0.5 for i in range(3))
    p.face([o, right, tip, left], color, PLASTER)


def leaf_cluster(B, p, o, r, u, n, count, size, k, flowers=False):
    """A cluster of `count` leaves fanned from one node, each its own size, turn and green;
    `flowers` adds a spray of three small blossoms over it."""
    base = (_h(k, 9) - 0.5) * 1.2
    for j in range(count):
        a = base + (j - (count - 1) / 2) * (2.1 / max(1, count - 1)) + (_h(k * 7 + j, 10) - 0.5) * 0.5
        ca, sa = math.cos(a), math.sin(a)
        d = tuple(u[i] * ca + r[i] * sa for i in range(3))
        side = tuple(r[i] * ca - u[i] * sa for i in range(3))
        ln = size * (0.75 + 0.5 * _h(k * 7 + j, 11))
        off = 0.02 + 0.05 * _h(k * 7 + j, 12)
        oo = tuple(o[i] + n[i] * off for i in range(3))
        leaf(p, oo, side, d, n, ln, ln * 0.42, IVY[int(_h(k * 7 + j, 13) * len(IVY))], lift=0.05)
    if flowers:
        for j in range(3):
            a = j * 2.1 + _h(k, 14)
            c = tuple(o[i] + (r[i] * math.cos(a) + u[i] * math.sin(a)) * size * 0.45 + n[i] * 0.1 for i in range(3))
            col = FLOWERS[0] if (k + j) % 3 else FLOWERS[1]
            hs = 0.08
            p.face([tuple(c[i] - u[i] * hs for i in range(3)), tuple(c[i] + r[i] * hs for i in range(3)),
                    tuple(c[i] + u[i] * hs for i in range(3)), tuple(c[i] - r[i] * hs for i in range(3))], col, PLASTER)


def creeper(B, p, face):
    """A flowering ivy on the front's left corner: a woody stem from the ground up the corner
    post to under the eaves, a mass of leaf clusters over the stone base at its foot, a
    runner along the sill beam on the base, a branch up the corner bay's brace and a few
    clusters round the corner on the side wall. Clusters are denser, fuller and bigger low
    down and thin out upward; a few carry red or cream blossoms."""
    H = B.HALL
    x = H['x0'] + 0.17
    g = B.ground(x + 0.4, face + 0.2) - 0.1
    zf = face + 0.12
    front = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    side = ((0, 0, 1), (0, 1, 0), (-1, 0, 0))
    import tavern_jetty as JET

    # up the ground floor's corner post, round the jetty's bressumer and on up the upper storey
    zj = JET.face_z(B) + 0.12
    stem = [(x + 0.05, g, zf), (x + 0.12, 0.2, zf), (x + 0.02, 1.6, zf), (x + 0.1, 3.0, zf), (x - 0.02, 4.4, zf),
            (x + 0.06, 5.35, zf), (x + 0.1, 5.75, zf + 0.5), (x + 0.12, 6.35, zj), (x + 0.02, 7.4, zj),
            (x + 0.2, 8.5, zj)]
    runner = [(x + 0.1, 1.5, zf), (x + 1.0, 1.62, zf), (x + 2.0, 1.52, zf), (x + 3.0, 1.62, zf),
              (x + 3.7, 1.56, zf)]
    brace = [(x + 0.08, 2.4, zf), (x + 0.7, 3.1, zf), (x + 1.3, 3.8, zf), (x + 1.8, 4.5, zf)]
    xs = H['x0'] - 0.07
    side_stem = [(xs, g + 0.3, face - 0.1), (xs, 1.2, face - 0.35), (xs, 2.6, face - 0.3), (xs, 3.8, face - 0.55)]
    for line, r0 in ((stem, 0.09), (runner, 0.05), (brace, 0.05)):
        p.sweep(line, r0, 0.03, STEM, sides=4)
    p.sweep(side_stem, 0.05, 0.03, STEM, sides=4)
    k = 0
    top = stem[-1][1]

    def place(pt, frame, spread, fullness):
        nonlocal k
        r, u, n = frame
        ox = (_h(k, 1) - 0.5) * 2 * spread
        oy = (_h(k, 2) - 0.5) * 2 * spread * 0.7
        o = tuple(pt[i] + r[i] * ox + u[i] * oy for i in range(3))
        count = max(3, min(5, 3 + int(round(2 * fullness * (0.5 + _h(k, 3))))))
        leaf_cluster(B, p, o, r, u, n, count, 0.3 + 0.2 * fullness, k, flowers=(k % 6 == 2))
        k += 1

    # up the post: the step between clusters opens and the clusters thin with height
    y = g + 0.3
    while y < top:
        t = (y - g) / (top - g)
        pt = next(((a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y,
                    a[2] + (b[2] - a[2]) * (y - a[1]) / (b[1] - a[1]))
                   for (a, b) in zip(stem, stem[1:]) if a[1] <= y <= b[1]), stem[-1])
        place(pt, front, 0.32 - 0.12 * t, 1.0 - 0.8 * t)
        if t < 0.6:
            place(pt, front, 0.5 - 0.2 * t, 1.0 - t)
        if t < 0.25:
            place(pt, front, 0.62, 1.0)
        y += 0.2 + 0.3 * t
    # the mass over the stone base at its foot
    for j in range(16):
        pt = (x + 0.15 + 1.9 * _h(j, 20) ** 1.5, g + 0.4 + (1.35 - g) * _h(j, 21) * 0.85, face + 0.1)
        place(pt, front, 0.15, 0.95)
    for line, step, fullness in ((runner, 0.27, 0.65), (brace, 0.3, 0.5)):
        for pt in _along(line, step)[1:]:
            place(pt, front, 0.16, fullness)
    for pt in _along(side_stem, 0.3)[1:]:
        place(pt, side, 0.16, 0.7)


def hanging_basket(B, p, x, z, s):
    """A flower basket hung on a short chain from under a porch-canopy bracket's end: a
    woven honey bowl, a mound of greens, trailing leaves and red, cream and gold flowers."""
    top = 5.95 - 0.1
    B.chain(p, (x, top, z), (x, top - 0.6, z), links=3)
    yb = top - 0.62
    p.cylinder((x, yb - 0.36, z), (x, yb, z), 0.2, B.PAL['honey'][1], B.WOOD, sides=8, r1=0.42)
    p.cylinder((x, yb - 0.02, z), (x, yb + 0.05, z), 0.45, B.PAL['beam'], B.WOOD, sides=8)
    for j in range(3):
        a = j * 2.1 + 0.4 * s
        p.rock_blob((x + math.sin(a) * 0.18, yb + 0.14, z + math.cos(a) * 0.18), (0.42, 0.3, 0.42),
                    LEAF[j % len(LEAF)], B.PLASTER, jitter=0.2, subdivisions=0)
    for j in range(6):
        a = j * math.pi / 3 + 0.3 * s
        n = (math.sin(a), 0.0, math.cos(a))
        r = (math.cos(a), 0.0, -math.sin(a))
        o = (x + n[0] * 0.42, yb, z + n[2] * 0.42)
        # hanging down (along -y), facing out from the bowl: across is -r so across x down = n
        leaf(p, o, (-r[0], 0.0, -r[2]), (0.0, -1.0, 0.0), n, 0.34 + 0.12 * _h(j, 30), 0.13,
             IVY[j % len(IVY)], lift=0.06)
    for j in range(7):
        a = j * 0.9 + s
        rr = 0.12 + 0.2 * _h(j, 31)
        p.box((x + math.sin(a) * rr, yb + 0.3 + 0.06 * (j % 2), z + math.cos(a) * rr), (0.12, 0.1, 0.12),
              FLOWERS[j % len(FLOWERS)], B.PLASTER, yaw=a)


def tub_flowers(B, p, q):
    """The flowers in a stone tub at the foot of the steps (the tub and its greens are
    tavern_furnish.py planter): heads over the greens and a few leaves trailing over its lip."""
    x, z, r, top = q['x'], q['z'], q['r'], q['base'] + q['height']
    for j in range(8):
        a = j * 0.8 + q['rot']
        rr = r * (0.15 + 0.55 * _h(j, 50))
        p.box((x + math.sin(a) * rr, top + 0.42 + 0.1 * _h(j, 51), z + math.cos(a) * rr), (0.14, 0.12, 0.14),
              FLOWERS[j % len(FLOWERS)], B.PLASTER, yaw=a)
    for j in range(5):
        a = j * 1.25 + q['rot']
        n = (math.sin(a), 0.0, math.cos(a))
        rv = (math.cos(a), 0.0, -math.sin(a))
        o = (x + n[0] * (r + 0.04), top + 0.04, z + n[2] * (r + 0.04))
        leaf(p, o, (-rv[0], 0.0, -rv[2]), (0.0, -1.0, 0.0), n, 0.3 + 0.12 * _h(j, 52), 0.12,
             IVY[(j + 2) % len(IVY)], lift=0.05)


def doormat(B, p, face):
    """A coir doormat on the porch before the door, worn paler where the feet go (no words)."""
    B.abox(p, -1.25, 1.25, 0.0, 0.025, face + 0.3, face + 1.15, (0.5, 0.39, 0.23), B.PLASTER)
    for (a, b) in ((-1.25, -1.1), (1.1, 1.25)):
        B.abox(p, a, b, 0.0, 0.03, face + 0.3, face + 1.15, (0.36, 0.27, 0.16), B.PLASTER)
    # the worn patch, facing up
    p.face([(-0.7, 0.028, face + 0.95), (0.75, 0.028, face + 0.98), (0.65, 0.028, face + 0.5),
            (-0.6, 0.028, face + 0.45)], (0.62, 0.52, 0.34), PLASTER)


def boot_scraper(B, p, x, z):
    """An iron boot scraper by the door: two uprights on a stone block, the blade between."""
    iron = B.PAL['iron']
    B.abox(p, x - 0.12, x + 0.12, 0.0, 0.08, z - 0.22, z + 0.22, B.PAL['stone_dark'], B.STONE)
    for dz in (-0.16, 0.16):
        p.box((x, 0.22, z + dz), (0.04, 0.28, 0.04), iron, B.METAL)
        p.box((x, 0.38, z + dz), (0.04, 0.08, 0.08), iron, B.METAL)
    p.box((x, 0.2, z), (0.02, 0.07, 0.34), B.PAL['iron_hi'], B.METAL)


def weathering(B, p, face, posts):
    """Subtle weathering at the feet of the front's timber posts: the post's foot darkened
    by the damp over the sill beam, and a rain streak down the stone base under it."""
    for i, x in enumerate(posts):
        h = 0.22 + 0.2 * _h(i, 40)
        w = 0.15
        z = face + 0.097
        p.face([(x - w, 1.7, z), (x + w, 1.7, z), (x + w * 0.6, 1.7 + h, z), (x - w * 0.7, 1.7 + h * 0.8, z)],
               (0.43, 0.31, 0.2), PLASTER)
        zs = face + 0.066
        d = 0.55 + 0.45 * _h(i, 41)
        p.face([(x - 0.12, 1.38 - d, zs), (x + 0.12, 1.38 - d, zs), (x + 0.2, 1.38, zs), (x - 0.2, 1.38, zs)],
               (0.38, 0.4, 0.43), PLASTER)
