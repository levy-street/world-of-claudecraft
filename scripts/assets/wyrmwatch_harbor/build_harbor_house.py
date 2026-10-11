"""The Harbormaster's House at the Wyrmwatch cliff harbor: the walk-in timber house on stilts
at the harbor's north end, built into the one harbor model by build_wyrmwatch_harbor.py
(which calls build(B) with itself as B, so this module shares its palette, terrain and
helpers and never re-reads the layout).

Everything stands where the sim says it does (src/sim/content/wyrmwatch_harbor_house.ts,
through layout.json's `house`): the footprint and floor, the doorway, the furniture the sim
collides with, the wall map and the harbormaster's spot. The walls and the roof are split into
five parts so the runtime (src/render/wyrmwatch_harbor_house.ts) can cut away the ones between
the camera and a player indoors; whatever hangs on a wall belongs to that wall's part, so it
goes with it. The parts:

  HouseFrame        the floor, the stilts and their bracing, the corner posts, the tie beams
                    and the hanging lanterns (never cut away)
  HouseWallNorth    the north wall with the wall map of the two ferry routes and two windows
  HouseWallSouth    the door wall: the open double doors, the porch, two windows, the coat
                    pegs and the crossed oars inside
  HouseWallEast     the sea wall: the bay window with its seat, the nets, the life ring, the
                    gable's round window and the harbor lantern at the apex
  HouseWallWest     the land wall: the stone chimney stack outside, a window, the gable
  HouseRoof         rafters, ridge and king posts, the shingled slopes, the barge boards, the
                    pennant on the ridge
  HouseFurnishings  the hearth and its ship's wheel, the rest corner (settle, armchair, side
                    table, rug), the chart table and its charts, the cargo (every solid here
                    is a sim collider)
  HouseClutter      high tier: the sea chest under the map, firewood, a bucket, books, a rope
                    coil and a lobster pot, and the rowboat moored under the house

Original procedural work for this project, in the harbor's palette.
"""
import math

HOUSE_PARTS = ('HouseFrame', 'HouseWallNorth', 'HouseWallSouth', 'HouseWallEast',
               'HouseWallWest', 'HouseRoof', 'HouseFurnishings')
HOUSE_OPTIONAL = ('HouseClutter',)

# Colours the harbor palette does not carry
HPAL = dict(
    board=[(0.62, 0.45, 0.3), (0.58, 0.42, 0.28), (0.65, 0.47, 0.31), (0.6, 0.43, 0.29)],
    wainscot=[(0.44, 0.3, 0.2), (0.41, 0.28, 0.19)],
    gable=[(0.66, 0.5, 0.34), (0.62, 0.47, 0.32), (0.69, 0.52, 0.35)],
    beam=(0.36, 0.24, 0.16),
    sarking=(0.3, 0.2, 0.14),
    floor=[(0.52, 0.37, 0.24), (0.49, 0.35, 0.23), (0.55, 0.39, 0.25), (0.5, 0.36, 0.235)],
    sea=(0.64, 0.8, 0.8),
    parchment=(0.86, 0.78, 0.58),
    coast=(0.36, 0.27, 0.18),
    route_a=(0.86, 0.14, 0.08),
    route_b=(0.1, 0.36, 0.96),
    rug=(0.55, 0.17, 0.13),
    rug_border=(0.78, 0.6, 0.3),
    cushion=(0.22, 0.36, 0.66),
    fire=(1.0, 0.52, 0.18),
    ember=(1.0, 0.36, 0.1),
    coat=(0.72, 0.6, 0.2),
    ring_red=(0.74, 0.18, 0.14),
    books=[(0.5, 0.16, 0.12), (0.2, 0.3, 0.5), (0.3, 0.42, 0.24), (0.55, 0.42, 0.2)],
    bottle=(0.26, 0.46, 0.36),
    boat=(0.46, 0.31, 0.2),
    boat_trim=(0.2, 0.34, 0.62),
)

# The zones' land on the wall map (content zone ids, muted like old chart inks)
ZONE_LAND = {
    'eastbrook_vale': (0.62, 0.7, 0.42),
    'mirefen_marsh': (0.5, 0.56, 0.36),
    'thornpeak_heights': (0.6, 0.58, 0.46),
    'veiled_hollow': (0.54, 0.5, 0.56),
    'drakelands': (0.72, 0.5, 0.36),
    'frostveil': (0.82, 0.84, 0.82),
    'amberfall': (0.8, 0.66, 0.4),
    'willowfen': (0.56, 0.66, 0.4),
    'nightbloom': (0.5, 0.46, 0.6),
    'wraithwood': (0.42, 0.5, 0.38),
    'palmreach': (0.76, 0.72, 0.46),
    'evergarden': (0.56, 0.72, 0.44),
    'galecrest': (0.58, 0.64, 0.5),
    'farshore_isle': (0.78, 0.72, 0.52),
    'proving_shore': (0.76, 0.7, 0.5),
}


def build(B):
    """Build the house's pieces with the harbor builder's helpers; returns them in order."""
    H = B.LAYOUT['house']
    P_ = B.PAL
    WOOD, IRON, STONE, ROPE, GLOW = B.WOOD, B.IRON, B.STONE, B.ROPE, B.GLOW
    pick = B.pick
    F = H['floor']
    hx, hz, hw, hd, T = H['x'], H['z'], H['hw'], H['hd'], H['wall']
    X0, X1, Z0, Z1 = hx - hw, hx + hw, hz - hd, hz + hd
    IX0, IX1, IZ0, IZ1 = X0 + T, X1 - T, Z0 + T, Z1 - T
    TOPW = F + H['wallTop']
    TIE = F + H['tieBeam']
    RIDGE = F + H['ridge']
    DOOR = H['door']
    CORNER = 0.6
    # the roof: its surface at the ridge line and the slope angle down to the wall plate
    ROOF_AT_RIDGE = RIDGE - H['roof']['ridgeDrop']
    PLATE = TOPW + H['roof']['plateLift']
    SLOPE = math.atan2(ROOF_AT_RIDGE - PLATE, hd)
    EAVE_OUT, VERGE_OUT = H['roof']['eaveOut'], H['roof']['vergeOut']
    props = {q['kind']: q for q in H['props']}

    def roof_y(z):
        """The roof surface's height over z (both slopes)."""
        return ROOF_AT_RIDGE - abs(z - hz) * math.tan(SLOPE)

    # ------------------------------------------------------------------ wall kit
    def wbox(p, axis, fixed, s0, s1, y0, y1, depth, color, mat=WOOD, off=0.0, bevel=0.0):
        """A box on a wall plane: `axis` 'x' runs along x at z = fixed, 'z' along z at x = fixed;
        `off` shifts it across the wall (toward +z or +x)."""
        if s1 - s0 <= 0.01 or y1 - y0 <= 0.01:
            return
        sm, ym = (s0 + s1) / 2, (y0 + y1) / 2
        if axis == 'x':
            p.box((sm, ym, fixed + off), (s1 - s0, y1 - y0, depth), color, mat, bevel=bevel)
        else:
            p.box((fixed + off, ym, sm), (depth, y1 - y0, s1 - s0), color, mat, bevel=bevel)

    def wall_point(axis, fixed, s, y, off=0.0):
        return (s, y, fixed + off) if axis == 'x' else (fixed + off, y, s)

    def window(p, axis, fixed, out, s, w, y0, y1, shutters=True):
        """A window through the wall at s: dark frame proud both faces, warm panes, an iron
        cross, a sill, and open blue shutters on the outside face."""
        half = w / 2
        d = T + 0.16
        wbox(p, axis, fixed, s - half - 0.14, s - half, y0 - 0.12, y1 + 0.14, d, HPAL['beam'])
        wbox(p, axis, fixed, s + half, s + half + 0.14, y0 - 0.12, y1 + 0.14, d, HPAL['beam'])
        wbox(p, axis, fixed, s - half - 0.2, s + half + 0.2, y1, y1 + 0.2, d + 0.04, HPAL['beam'])
        wbox(p, axis, fixed, s - half - 0.22, s + half + 0.22, y0 - 0.16, y0, d + 0.2,
             P_['trim_dark'], off=out * 0.06)
        wbox(p, axis, fixed, s - half, s + half, y0, y1, 0.08, P_['glow'], GLOW)
        wbox(p, axis, fixed, s - 0.04, s + 0.04, y0, y1, 0.14, P_['iron'], IRON)
        wbox(p, axis, fixed, s - half, s + half, (y0 + y1) / 2 - 0.04, (y0 + y1) / 2 + 0.04, 0.14,
             P_['iron'], IRON)
        if shutters:
            for side in (-1, 1):
                a = s + side * (half + 0.16)
                b = s + side * (half + 0.16 + half * 0.95)
                wbox(p, axis, fixed, min(a, b), max(a, b), y0 - 0.05, y1 + 0.05, 0.08, P_['accent'],
                     off=out * (T / 2 + 0.06))
                for yy in (y0 + 0.3, y1 - 0.3):
                    wbox(p, axis, fixed, min(a, b) + 0.06, max(a, b) - 0.06, yy - 0.06, yy + 0.06, 0.05,
                         P_['accent_dark'], off=out * (T / 2 + 0.12))

    def timber_wall(p, axis, fixed, out, s0, s1, posts, openings, seed=0):
        """Sill, wall plate, posts, a dark wainscot of horizontal planks and upright boards,
        with rectangular openings (s0, s1, y0, y1) left clear. `posts` are s positions."""
        wbox(p, axis, fixed, s0, s1, F, F + 0.34, T + 0.08, P_['post_dark'])
        wbox(p, axis, fixed, s0, s1, TOPW - 0.36, TOPW, T + 0.12, HPAL['beam'], bevel=0.02)
        for s in posts:
            wbox(p, axis, fixed, s - 0.22, s + 0.22, F + 0.34, TOPW - 0.36, T + 0.1, P_['post'], bevel=0.02)

        def clear_spans(a, b, y0, y1, whole=False):
            """[a, b] minus every post and every opening overlapping y0..y1 (with `whole`,
            only the openings spanning all of y0..y1: the boards split round the rest)."""
            cuts = [(s - 0.22, s + 0.22) for s in posts]
            cuts += [(o[0], o[1]) for o in openings
                     if (o[2] <= y0 and o[3] >= y1) or (not whole and o[2] < y1 and o[3] > y0)]
            spans = [(a, b)]
            for c0, c1 in sorted(cuts):
                nxt = []
                for x0, x1 in spans:
                    if c1 <= x0 or c0 >= x1:
                        nxt.append((x0, x1))
                        continue
                    if c0 > x0:
                        nxt.append((x0, c0))
                    if c1 < x1:
                        nxt.append((c1, x1))
                spans = nxt
            return [sp for sp in spans if sp[1] - sp[0] > 0.02]

        # the wainscot: two horizontal planks, and a proud rail on top of it
        wy0, wy1 = F + 0.34, F + 1.3
        for k in range(2):
            ya = wy0 + (wy1 - wy0) * k / 2
            yb = wy0 + (wy1 - wy0) * (k + 1) / 2
            for a, b in clear_spans(s0, s1, ya, yb):
                wbox(p, axis, fixed, a, b, ya + 0.02, yb - 0.02, 0.28, pick(HPAL['wainscot'], k + seed))
        for a, b in clear_spans(s0, s1, wy1, wy1 + 0.16):
            wbox(p, axis, fixed, a, b, wy1, wy1 + 0.16, T + 0.06, P_['post_dark'])
        # the upright boards above it, each split around any opening
        by0, by1 = wy1 + 0.16, TOPW - 0.36
        for a, b in clear_spans(s0, s1, by0, by1, whole=True):
            n = max(1, int(round((b - a) / 0.44)))
            w = (b - a) / n
            for i in range(n):
                ba, bb = a + i * w, a + (i + 1) * w
                ranges = [(by0, by1)]
                for o in openings:
                    if o[0] < bb and o[1] > ba:
                        nr = []
                        for ya, yb in ranges:
                            if o[3] <= ya or o[2] >= yb:
                                nr.append((ya, yb))
                                continue
                            if o[2] > ya:
                                nr.append((ya, o[2]))
                            if o[3] < yb:
                                nr.append((o[3], yb))
                        ranges = nr
                col = pick(HPAL['board'], i + seed * 3 + int(abs(a) * 7))
                for ya, yb in ranges:
                    wbox(p, axis, fixed, ba + 0.015, bb - 0.015, ya, yb, 0.26, col)
                    # a batten over the joint on the outside face
                    wbox(p, axis, fixed, bb - 0.05, bb + 0.05, ya, yb, 0.06, P_['trim_dark'],
                         off=out * 0.15)
        # corner braces on the outside face, from the sill to the first post (timber framing)
        for c, s in ((s0, next((q for q in posts if q > s0), None)),
                     (s1, next((q for q in reversed(posts) if q < s1), None))):
            if s is None or abs(s - c) > 3.4:
                continue
            a = wall_point(axis, fixed, c + (0.1 if s > c else -0.1), F + 0.5, out * 0.17)
            b = wall_point(axis, fixed, s - (0.25 if s > c else -0.25), TOPW - 0.6, out * 0.17)
            if not any(o[0] < max(c, s) and o[1] > min(c, s) for o in openings):
                p.beam([a, b], 0.2, 0.16, P_['post_dark'], WOOD, up=(0, 0, 1) if axis == 'x' else (1, 0, 0))

    def gable(p, axis_fixed, out, seed=0):
        """The triangle above the wall plate on an east or west wall: upright boards whose tops
        follow the roof's slope (the board under the ridge peaks with it), so the gable reads
        clean even with the roof cut away."""
        n = int(round((hd * 2 - 0.2) / 0.46))
        w = (hd * 2 - 0.2) / n
        for i in range(n):
            za = Z0 + 0.1 + i * w + 0.015
            zb = Z0 + 0.1 + (i + 1) * w - 0.015
            poly = [(za, TOPW), (zb, TOPW), (zb, roof_y(zb) - 0.14)]
            if za < hz < zb:
                poly.append((hz, roof_y(hz) - 0.14))
            poly.append((za, roof_y(za) - 0.14))
            xslab(p, poly, axis_fixed - 0.13, axis_fixed + 0.13, pick(HPAL['gable'], i + seed))
        # a collar under the verge
        wbox(p, 'z', axis_fixed, Z0 + 0.4, Z1 - 0.4, TOPW, TOPW + 0.3, T + 0.14, HPAL['beam'])

    def xslab(p, poly, x0, x1, color, mat=WOOD):
        """A convex polygon in the (z, y) plane, extruded along x from x0 to x1."""
        bm = p.bm
        a = [bm.verts.new(B.P(x0, y, z)) for z, y in poly]
        b = [bm.verts.new(B.P(x1, y, z)) for z, y in poly]
        faces = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
        for i in range(len(poly)):
            j = (i + 1) % len(poly)
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        p.paint(faces, color, mat)
        p.closed.extend(faces)

    def lantern_hang(p, x, z, drop=2.1, s=0.42):
        """A lantern on an iron rod under a tie beam, hung from a ring bolt."""
        low = TIE - drop
        p.ring((x, TIE - 0.08, z), 0.08, 0.035, P_['iron'], segments=6, axis=(1, 0, 0), mat=IRON, depth=0.035)
        p.box((x, (TIE - 0.15 + low + s * 0.9) / 2, z), (0.045, TIE - 0.15 - low - s * 0.9, 0.045), P_['iron'], IRON)
        B.lantern(p, x, low, z, s)

    # ================================================================== HouseFrame
    frame = B.Piece('HouseFrame', wear=0.07, gradient=0.12)
    # floor boards, running east to west, under the walls
    n = int(round((Z1 - Z0) / 0.48))
    step = (Z1 - Z0) / n
    for i in range(n):
        z = Z0 + step * (i + 0.5)
        frame.box((hx, F - B.PLANK_T / 2, z), (X1 - X0, B.PLANK_T, step - 0.04), pick(HPAL['floor'], i), WOOD)
    # the threshold in the doorway
    frame.box((DOOR['x'], F + 0.01, Z1 - T / 2), (DOOR['width'] + 0.2, 0.08, T + 0.16), P_['post_dark'], WOOD)
    # heavy fascia round the floor's edge, girders under it on the pile rows
    under = F - B.PLANK_T
    for z in (Z0 + 0.15, Z1 - 0.15):
        frame.box((hx, under - 0.24, z), (X1 - X0 + 0.1, 0.48, 0.3), P_['post'], WOOD)
    for x in (X0 + 0.15, X1 - 0.15):
        frame.box((x, under - 0.24, hz), (0.3, 0.48, Z1 - Z0), P_['post'], WOOD)
    xs = B.pile_rows(X0 + 0.35, X1 - 0.35, 2.6)
    zs = B.pile_rows(Z0 + 0.35, Z1 - 0.35, 2.4)
    for z in zs:
        frame.box((hx, under - 0.62, z), (X1 - X0 - 0.2, 0.36, 0.34), P_['post_dark'], WOOD)
    # log piles down into the sea bed, a darker wet band at the waterline
    for x in xs:
        for z in zs:
            f = B.foot(x, z)
            frame.cylinder((x, f, z), (x, under - 0.8, z), 0.27, P_['pile'], WOOD, sides=8, caps=False)
    # X bracing between the outside piles on every face
    for z in (zs[0], zs[-1]):
        for i in range(len(xs) - 1):
            for flip in (0, 1):
                a, b = xs[i], xs[i + 1]
                ga, gb = max(B.ground(a, z), -1.2) + 0.4, max(B.ground(b, z), -1.2) + 0.4
                hi = under - 0.9
                if hi - max(ga, gb) < 1.0:
                    continue
                pa = (a, hi if flip else ga, z)
                pb = (b, gb if flip else hi, z)
                frame.beam([pa, pb], 0.18, 0.2, P_['post_dark'], WOOD, up=(0, 0, 1))
    for x in (xs[0], xs[-1]):
        for i in range(len(zs) - 1):
            for flip in (0, 1):
                a, b = zs[i], zs[i + 1]
                ga, gb = max(B.ground(x, a), -1.2) + 0.4, max(B.ground(x, b), -1.2) + 0.4
                hi = under - 0.9
                if hi - max(ga, gb) < 1.0:
                    continue
                pa = (x, hi if flip else ga, a)
                pb = (x, gb if flip else hi, b)
                frame.beam([pa, pb], 0.18, 0.2, P_['post_dark'], WOOD, up=(1, 0, 0))
    # the corner posts, full height, and the wall plate's corner blocks
    for cx in (X0 + CORNER / 2, X1 - CORNER / 2):
        for cz in (Z0 + CORNER / 2, Z1 - CORNER / 2):
            frame.box((cx, (F + TOPW + 0.1) / 2, cz), (CORNER, TOPW + 0.1 - F, CORNER), P_['post'], WOOD, bevel=0.03)
            frame.box((cx, TOPW + 0.2, cz), (CORNER + 0.12, 0.2, CORNER + 0.12), HPAL['beam'], WOOD)
    # the tie beams across the room, the hanging lanterns under them
    TIE_XS = (1.2, 3.8, 6.4)
    for x in TIE_XS:
        frame.box((x, TIE + 0.2, hz), (0.4, 0.4, IZ1 - IZ0 + 0.3), HPAL['beam'], WOOD, bevel=0.03)
    npc = H['npc']
    table = props['chartTable']
    for lamp in H['lanterns']:
        lantern_hang(frame, lamp['x'], lamp['z'], drop=lamp['drop'], s=0.42)

    # ================================================================== the walls
    posts_ns = (1.2, 3.8, 6.4)
    s0x, s1x = X0 + CORNER, X1 - CORNER
    s0z, s1z = Z0 + CORNER, Z1 - CORNER
    win_lo, win_hi = F + 2.7, F + 4.8

    # ---- north: two windows either side of the map
    north = B.Piece('HouseWallNorth', wear=0.06, gradient=0.12)
    nz = Z0 + T / 2
    MAP = H['map']
    map_x0, map_x1 = MAP['x'] - MAP['width'] / 2, MAP['x'] + MAP['width'] / 2
    n_windows = [(-0.35, 1.3), (7.2, 0.9)]
    timber_wall(north, 'x', nz, -1, s0x, s1x, (1.2, 6.4),
                [(s - w / 2, s + w / 2, win_lo, win_hi) for s, w in n_windows], seed=1)
    for s, w in n_windows:
        window(north, 'x', nz, -1, s, w, win_lo, win_hi)
    # the corbel carrying the middle tie beam over the map, and knee braces at the posts
    north.box((3.8, TIE - 0.25, IZ0 + 0.2), (0.44, 0.5, 0.4), HPAL['beam'], WOOD, bevel=0.03)
    for x in (1.2, 6.4):
        north.beam([(x, TIE - 1.3, IZ0 + 0.08), (x, TIE - 0.02, IZ0 + 1.0)], 0.2, 0.22, HPAL['beam'], WOOD)
    build_map(B, north, MAP, IZ0, F)

    # ---- south: the doorway, two windows, the porch, the open double doors
    south = B.Piece('HouseWallSouth', wear=0.06, gradient=0.12)
    sz = Z1 - T / 2
    dx0, dx1 = DOOR['x'] - DOOR['width'] / 2, DOOR['x'] + DOOR['width'] / 2
    DH = F + DOOR['height']
    s_windows = [(2.95, 1.1), (5.1, 1.3)]
    timber_wall(south, 'x', sz, 1, s0x, s1x, (3.8, 6.4),
                [(dx0 - 0.3, dx1 + 0.3, F, DH + 0.45)] + [(s - w / 2, s + w / 2, win_lo, win_hi)
                                                         for s, w in s_windows], seed=2)
    # the door frame: heavy jambs outside the clear width, a lintel with a keystone block
    for jx in (dx0 - 0.16, dx1 + 0.16):
        south.box((jx, (F + DH + 0.1) / 2, sz), (0.32, DH + 0.1 - F, T + 0.2), HPAL['beam'], WOOD, bevel=0.03)
    south.box((DOOR['x'], DH + 0.25, sz), (DOOR['width'] + 1.0, 0.42, T + 0.26), HPAL['beam'], WOOD, bevel=0.03)
    south.box((DOOR['x'], DH + 0.28, sz + 0.2), (0.4, 0.5, 0.12), P_['brass'], IRON, bevel=0.02)
    # the boards over the lintel up to the plate
    wbox(south, 'x', sz, dx0 - 0.3, dx1 + 0.3, DH + 0.46, TOPW - 0.36, 0.26, pick(HPAL['board'], 2))
    for i, (s, w) in enumerate(s_windows):
        # the first window's shutters would fold onto the open door leaf: it has none
        window(south, 'x', sz, 1, s, w, win_lo, win_hi, shutters=i > 0)
    # the open double doors, swung back flat against the front
    for side in (-1, 1):
        hinge = dx0 if side < 0 else dx1
        a, b = sorted((hinge, hinge + side * (DOOR['width'] / 2 - 0.05)))
        zz = Z1 + 0.13
        south.box(((a + b) / 2, F + DOOR['height'] / 2, zz), (b - a, DOOR['height'] - 0.1, 0.12), P_['accent'], WOOD)
        for yy in (F + 0.7, F + 1.95, F + 3.2):
            south.box(((a + b) / 2, yy, zz + 0.07), (b - a - 0.08, 0.16, 0.04), P_['accent_dark'], WOOD)
            south.box(((a + b) / 2 - side * 0.1, yy, zz + 0.1), (b - a - 0.3, 0.07, 0.03), P_['iron'], IRON)
        south.ring((b - 0.22 if side < 0 else a + 0.22, F + 1.9, zz + 0.12), 0.1, 0.03, P_['brass'], segments=8,
                   axis=(0, 0, 1), mat=IRON, depth=0.03)
    # the porch: a little gabled roof over the door on two carved brackets
    pr_y = DH + 0.75
    pr_d = 1.5
    for side in (-1, 1):
        bx = DOOR['x'] + side * (DOOR['width'] / 2 + 0.16)
        south.beam([(bx, pr_y - 0.75, Z1 + 0.05), (bx, pr_y - 0.05, Z1 + pr_d - 0.1)], 0.14, 0.16, HPAL['beam'], WOOD)
        south.box((bx, pr_y - 0.02, Z1 + pr_d / 2), (0.16, 0.18, pr_d), HPAL['beam'], WOOD)
    ph = 0.95
    run = DOOR['width'] / 2 + 0.9
    pitch = math.atan2(ph, run)
    slope_len = math.hypot(run, ph)
    for side in (-1, 1):
        cxp = DOOR['x'] + side * run / 2
        south.box((cxp, pr_y + ph / 2 + 0.1, Z1 + pr_d / 2), (slope_len + 0.1, 0.14, pr_d + 0.3),
                  pick(P_['shingle'], 1 + side), WOOD, roll=-side * pitch)
    south.box((DOOR['x'], pr_y + ph + 0.18, Z1 + pr_d / 2), (0.22, 0.2, pr_d + 0.36), HPAL['beam'], WOOD)
    B.slab(south, [(DOOR['x'] - run + 0.1, pr_y + 0.05), (DOOR['x'] + run - 0.1, pr_y + 0.05),
                   (DOOR['x'], pr_y + ph + 0.02)], Z1 + pr_d - 0.06, Z1 + pr_d + 0.02, pick(HPAL['gable'], 0), WOOD)
    # the house sign under the porch: an anchor on a blue board (no lettering)
    sy = pr_y - 0.55
    for side in (-1, 1):
        south.box((DOOR['x'] + side * 0.45, sy + 0.3, Z1 + pr_d - 0.2), (0.03, 0.4, 0.03), P_['iron'], IRON)
    south.box((DOOR['x'], sy, Z1 + pr_d - 0.2), (1.1, 0.52, 0.08), P_['accent'], WOOD, bevel=0.02)
    anchor(south, B, DOOR['x'], sy, Z1 + pr_d - 0.2 + 0.05, 0.2, P_['brass'], facing=1)
    anchor(south, B, DOOR['x'], sy, Z1 + pr_d - 0.2 - 0.05, 0.2, P_['brass'], facing=-1)
    # inside: coat pegs with an oilskin and a sou'wester by the door, crossed oars between the windows
    iz = IZ1 - 0.02
    south.box((dx1 + 0.75, F + 3.1, iz - 0.05), (1.0, 0.12, 0.1), HPAL['beam'], WOOD)
    for k in range(3):
        south.box((dx1 + 0.4 + k * 0.35, F + 3.05, iz - 0.16), (0.05, 0.05, 0.2), P_['brass'], IRON)
    south.box((dx1 + 0.6, F + 2.2, iz - 0.2), (0.62, 1.6, 0.22), HPAL['coat'], ROPE, taper=0.72)
    south.cylinder((dx1 + 1.1, F + 2.95, iz - 0.2), (dx1 + 1.1, F + 3.2, iz - 0.2), 0.2, HPAL['coat'], ROPE,
                   sides=8, r1=0.12)
    for side in (-1, 1):
        a = (3.8 - side * 0.8, F + 1.6, iz - 0.12)
        b = (3.8 + side * 0.8, F + 4.6, iz - 0.12)
        south.beam([a, b], 0.07, 0.07, P_['plank'][2], WOOD, up=(0, 0, 1))
        south.box((b[0] - side * 0.05, b[1] - 0.35, iz - 0.12), (0.22, 0.7, 0.05), P_['plank'][0], WOOD,
                  roll=side * 0.35)
    for x in (1.2, 6.4):
        south.beam([(x, TIE - 1.3, IZ1 - 0.08), (x, TIE - 0.02, IZ1 - 1.0)], 0.2, 0.22, HPAL['beam'], WOOD)
    south.beam([(3.8, TIE - 1.3, IZ1 - 0.08), (3.8, TIE - 0.02, IZ1 - 1.0)], 0.2, 0.22, HPAL['beam'], WOOD)

    # ---- east (the sea wall): the bay window, the nets, the life ring, gable and harbor light
    east = B.Piece('HouseWallEast', wear=0.06, gradient=0.12)
    ex = X1 - T / 2
    bay0, bay1 = hz - 1.5, hz + 1.5
    bay_lo, bay_hi = F + 0.9, F + 5.0
    e_windows = []
    timber_wall(east, 'z', ex, 1, s0z, s1z, (bay0 - 0.25, bay1 + 0.25),
                [(bay0, bay1, bay_lo, bay_hi)] + [(s - w / 2, s + w / 2, win_lo, win_hi) for s, w in e_windows],
                seed=3)
    for s, w in e_windows:
        window(east, 'z', ex, 1, s, w, win_lo, win_hi)
    gable(east, ex, 1, seed=1)
    bay_window(east, B, X1, bay0, bay1, bay_lo, bay_hi, F)
    # the nets hung from a peg rail in the north bay, cork floats knotted in
    nz0, nz1 = Z0 + CORNER + 0.2, bay0 - 0.5
    nx = IX1 - 0.12
    east.box((nx + 0.05, F + 5.6, (nz0 + nz1) / 2), (0.1, 0.12, nz1 - nz0 + 0.3), HPAL['beam'], WOOD)
    rows = []
    for i in range(7):
        z = nz0 + (nz1 - nz0) * i / 6
        sag = math.sin(math.pi * i / 6) * 0.35
        rows.append([(nx - 0.05 - 0.05 * j * (1 if i % 2 else 0.6), F + 5.5 - j * 0.9 - sag * (j / 4), z)
                     for j in range(5)])
    grid = [list(col) for col in zip(*rows)]
    east.surface(grid, lambda i, j: P_['net'] if (i + j) % 2 else P_['rope_dark'], ROPE,
                 outward=lambda c: (-1, 0, 0), soft=False)
    for i, (px_, py_, pz_) in enumerate(p for r in rows for p in r[1:4]):
        if i % 2 == 0:
            east.cylinder((px_ - 0.1, py_ - 0.08, pz_), (px_ - 0.1, py_ + 0.08, pz_), 0.09,
                          (0.72, 0.58, 0.36) if i % 4 else HPAL['ring_red'], ROPE, sides=6)
    # the life ring in the south bay, above the barrel
    lz = (bay1 + 0.25 + Z1 - CORNER) / 2
    east.ring((IX1 - 0.1, F + 3.6, lz), 0.5, 0.16, HPAL['ring_red'], segments=12, axis=(1, 0, 0), mat=ROPE,
              depth=0.14)
    for k in range(4):
        a = math.tau * (k + 0.5) / 4
        east.box((IX1 - 0.12, F + 3.6 + math.sin(a) * 0.5, lz + math.cos(a) * 0.5), (0.18, 0.16, 0.16),
                 P_['ivory'], ROPE)
    east.box((IX1 - 0.06, F + 4.2, lz), (0.12, 0.1, 0.1), P_['brass'], IRON)
    # the round window high in the gable, and the harbor light on its bracket at the apex
    oy = F + 9.0
    east.cylinder((ex - 0.2, oy, hz), (ex + 0.22, oy, hz), 0.56, P_['glow'], GLOW, sides=12)
    east.ring((ex + 0.2, oy, hz), 0.64, 0.16, HPAL['beam'], segments=12, axis=(1, 0, 0), mat=WOOD, depth=0.16)
    east.box((ex + 0.22, oy, hz), (0.08, 1.2, 0.08), P_['iron'], IRON)
    east.box((ex + 0.22, oy, hz), (0.08, 0.08, 1.2), P_['iron'], IRON)
    ly = RIDGE - 1.9
    east.beam([(X1 + 0.1, ly + 0.9, hz), (X1 + 1.25, ly + 0.9, hz)], 0.1, 0.12, P_['iron'], IRON)
    east.beam([(X1 + 0.1, ly + 0.1, hz), (X1 + 1.2, ly + 0.88, hz)], 0.08, 0.08, P_['iron'], IRON)
    east.box((X1 + 1.2, ly + 0.62, hz), (0.05, 0.5, 0.05), P_['iron'], IRON)
    B.lantern(east, X1 + 1.2, ly, hz, 0.58)

    # ---- west (the land wall): the chimney stack outside, a window, the gable
    west = B.Piece('HouseWallWest', wear=0.06, gradient=0.12)
    wx = X0 + T / 2
    hearth = props['hearth']
    w_windows = [(-16.8, 1.1)]
    timber_wall(west, 'z', wx, -1, s0z, s1z, (hearth['z'] - hearth['hd'] - 0.2, hearth['z'] + hearth['hd'] + 0.2),
                [(s - w / 2, s + w / 2, win_lo, win_hi) for s, w in w_windows], seed=4)
    for s, w in w_windows:
        window(west, 'z', wx, -1, s, w, win_lo, win_hi)
    gable(west, wx, -1, seed=2)
    chim = props['chimney']
    chimney(west, B, chim, RIDGE)
    # a shelf over the firewood with bottles and a ledger
    sh_z = -22.75
    west.box((IX0 + 0.2, F + 2.6, sh_z), (0.4, 0.08, 1.1), HPAL['beam'], WOOD)
    for k, dz in enumerate((-0.4, -0.15, 0.1)):
        west.cylinder((IX0 + 0.22, F + 2.64, sh_z + dz), (IX0 + 0.22, F + 2.95 + 0.05 * k, sh_z + dz), 0.07,
                      HPAL['bottle'], GLOW if k == 1 else IRON, sides=6)
    west.box((IX0 + 0.2, F + 2.78, sh_z + 0.38), (0.26, 0.28, 0.12), pick(HPAL['books'], 1), ROPE)

    # ================================================================== HouseRoof
    roof = B.Piece('HouseRoof', wear=0.07, gradient=0.1)
    xa, xb = X0 - VERGE_OUT, X1 + VERGE_OUT
    s_max = (hd + EAVE_OUT) / math.cos(SLOPE)
    cos_t, sin_t = math.cos(SLOPE), math.sin(SLOPE)
    for side in (-1, 1):
        n_ = (0.0, cos_t, side * sin_t)          # the slope's outward normal

        def at(s, lift=0.0, side=side, n_=n_):
            return (hz + side * s * cos_t + n_[2] * lift, ROOF_AT_RIDGE - s * sin_t + n_[1] * lift)

        # sarking boards (their underside is the ceiling seen from inside)
        z_, y_ = at(s_max / 2, -0.06)
        roof.beam([(xa, y_, z_), (xb, y_, z_)], s_max, 0.12, HPAL['sarking'], WOOD, up=n_)
        # shingle courses, bottom up, each overlapping the one below
        courses = 9
        tiles = int(round((xb - xa) / 0.95))
        tw = (xb - xa + 0.1) / tiles
        for k in range(courses):
            s0_ = s_max * (courses - 1 - k) / courses
            s1_ = s_max * (courses - k) / courses
            z_, y_ = at((s0_ + s1_) / 2 + 0.05, 0.1 + 0.03 * (k % 2))
            # a course of shingle tiles, every other course half a tile over, each a touch
            # different in shade and lift so the roof reads hand-laid from the sea
            shift = tw / 2 if k % 2 else 0.0
            for t in range(tiles + 1):
                ta = max(xa - 0.05, xa - 0.05 - shift + t * tw)
                tb = min(xb + 0.05, xa - 0.05 - shift + (t + 1) * tw)
                if tb - ta < 0.1:
                    continue
                jit = roof.rng.random()
                zt, yt = at((s0_ + s1_) / 2 + 0.05, 0.1 + 0.03 * (k % 2) + jit * 0.03)
                roof.beam([(ta + 0.02, yt, zt), (tb - 0.02, yt, zt)], (s1_ - s0_) + 0.2, 0.15,
                          B.scale_color(pick(P_['shingle'], k + t + (1 if side > 0 else 0)), 0.9 + 0.2 * jit), WOOD,
                          up=n_, caps=False)
        # the eave fascia and the barge boards up both verges
        z_, y_ = at(s_max, 0.0)
        roof.beam([(xa, y_ - 0.1, z_ + side * 0.05), (xb, y_ - 0.1, z_ + side * 0.05)], 0.14, 0.34, HPAL['beam'], WOOD)
        for xv in (xa - 0.02, xb + 0.02):
            z0_, y0_ = at(s_max, 0.08)
            z1_, y1_ = at(0.0, 0.08)
            roof.beam([(xv, y0_, z0_), (xv, y1_, z1_)], 0.42, 0.16, HPAL['beam'], WOOD, up=(1, 0, 0))
        # rafters under the sarking, from the wall plate to the ridge
        s_wall = (hd - T) / cos_t
        nr = int(round((X1 - X0 - 0.8) / 1.3))
        for i in range(nr + 1):
            x = X0 + 0.4 + (X1 - X0 - 0.8) * i / nr
            z0_, y0_ = at(s_wall, -0.3)
            z1_, y1_ = at(0.25, -0.3)
            roof.beam([(x, y0_, z0_), (x, y1_, z1_)], 0.2, 0.3, HPAL['beam'], WOOD)
        # a purlin half way up
        z_, y_ = at(s_wall * 0.5, -0.5)
        roof.beam([(X0 + 0.3, y_, z_), (X1 - 0.3, y_, z_)], 0.26, 0.26, HPAL['beam'], WOOD, up=n_)
    # ridge beam inside, ridge cap outside with carved ends
    roof.box((hx, ROOF_AT_RIDGE - 0.55, hz), (X1 - X0 - 0.4, 0.4, 0.36), HPAL['beam'], WOOD)
    roof.box((hx, RIDGE - 0.05, hz), (xb - xa + 0.2, 0.3, 0.5), P_['post_dark'], WOOD, bevel=0.03)
    for xv in (xa - 0.15, xb + 0.15):
        roof.box((xv, RIDGE + 0.08, hz), (0.36, 0.5, 0.5), HPAL['beam'], WOOD, taper=0.6, bevel=0.02)
    # king posts on the tie beams, braced to the ridge
    for x in TIE_XS:
        roof.box((x, (TIE + 0.4 + ROOF_AT_RIDGE - 0.75) / 2, hz), (0.3, ROOF_AT_RIDGE - 0.75 - TIE - 0.4, 0.3),
                 HPAL['beam'], WOOD)
        for side in (-1, 1):
            roof.beam([(x, TIE + 1.6, hz + side * 0.15), (x, TIE + 2.9, hz + side * 1.5)], 0.16, 0.18, HPAL['beam'],
                      WOOD)
    # a pennant mast on the ridge's sea end
    mx = X1 - 0.4
    roof.cylinder((mx, RIDGE, hz), (mx, RIDGE + 2.4, hz), 0.06, P_['post_dark'], WOOD, sides=6)
    roof.cylinder((mx, RIDGE + 2.4, hz), (mx, RIDGE + 2.52, hz), 0.1, P_['brass'], IRON, sides=6)
    for flip in (1, -1):
        pts = [(mx, RIDGE + 2.3, hz + flip * 0.01), (mx - 1.3, RIDGE + 2.0, hz + flip * 0.01 + 0.12),
               (mx, RIDGE + 1.7, hz + flip * 0.01)]
        roof.face(pts if flip > 0 else list(reversed(pts)), P_['accent'], WOOD)

    # ================================================================== HouseFurnishings
    furn = B.Piece('HouseFurnishings', wear=0.07, gradient=0.12)
    build_hearth(furn, B, hearth, F, TOPW)
    build_rest_corner(furn, B, props, F)
    build_chart_table(furn, B, table, F)
    for q in H['props']:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'crateStack':
            hw_, hd_ = q['hw'], q['hd']
            s = min(hw_, hd_ * 2) * 0.96
            B.crate(furn, x - hw_ / 2, base, z, s, 0.06, pick(P_['plank'], 1))
            B.crate(furn, x + hw_ / 2, base, z, s, -0.05, pick(P_['plank'], 2))
            B.crate(furn, x, base + s, z, s * 0.84, 0.25, pick(P_['plank'], 3))
        elif k == 'barrel':
            r, h = q['r'] * 0.95, q['height']
            furn.sweep([(x, base, z), (x, base + h * 0.5, z), (x, base + h, z)], r, r, pick(P_['plank'], 0),
                       sides=10, radii=[r * 0.84, r, r * 0.84])
            furn.cylinder((x, base + h - 0.01, z), (x, base + h + 0.02, z), r * 0.8, P_['trim_dark'], WOOD, sides=10)
            for yy in (0.2, h - 0.2):
                furn.ring((x, base + yy, z), r * 0.9 + 0.01, 0.06, P_['iron'], segments=10, axis=(0, 1, 0), mat=IRON,
                          depth=0.03)

    # ================================================================== HouseClutter
    clutter = B.Piece('HouseClutter', wear=0.06, gradient=0.08)
    build_clutter(clutter, B, H, props, F)

    return [frame, north, south, east, west, roof, furn, clutter]


def anchor(p, B, x, y, z, s, color, facing=1):
    """A flat anchor emblem in the x-y plane at depth z (a sign's device)."""
    IRON = B.IRON
    p.box((x, y + 0.02, z), (0.05 * s * 5, 0.5 * s * 2.4, 0.03), color, IRON)
    p.box((x, y + s * 0.95, z), (s * 1.1, 0.05 * s * 4, 0.03), color, IRON)
    p.ring((x, y + s * 1.35, z), s * 0.22, 0.05 * s * 3, color, segments=8, axis=(0, 0, 1), mat=IRON, depth=0.03)
    arc = [(x + math.cos(math.radians(a)) * s * 0.9, y - s * 0.45 + math.sin(math.radians(a)) * s * 0.55, z)
           for a in range(190, 351, 20)]
    p.beam(arc, 0.05 * s * 4, 0.03, color, IRON, up=(0, 0, 1))


def build_map(B, p, MAP, iz, F):
    """The wall map on the north wall's inner face (facing +z): a framed sea chart of the
    world, the coasts from the layout's land runs tinted by zone, the two ferry routes as
    dashed lines in their own colours between brass pins at the berths, a little ship on
    each, and a compass rose. No lettering, no timetable."""
    WOOD, IRON = B.WOOD, B.IRON
    P_ = B.PAL
    x0, x1 = MAP['x'] - MAP['width'] / 2, MAP['x'] + MAP['width'] / 2
    y0, y1 = F + MAP['bottom'], F + MAP['top']
    fz = iz + 0.02
    # frame and backing
    p.box(((x0 + x1) / 2, (y0 + y1) / 2, fz + 0.03), (x1 - x0, y1 - y0, 0.06), HPAL['parchment'], WOOD)
    fr = 0.14
    for (a, b, c, d) in ((x0, x1, y1 - fr, y1), (x0, x1, y0, y0 + fr), (x0, x0 + fr, y0, y1), (x1 - fr, x1, y0, y1)):
        p.box(((a + b) / 2, (c + d) / 2, fz + 0.08), (b - a, d - c, 0.1), HPAL['beam'], WOOD, bevel=0.02)
    for xx in (x0 + 0.07, x1 - 0.07):
        p.box((xx, y1 - 0.07, fz + 0.14), (0.07, 0.07, 0.04), P_['brass'], IRON)
    m = fr + 0.06
    mx0, mx1, my0, my1 = x0 + m, x1 - m, y0 + m, y1 - m
    sea_z = fz + 0.065

    def face(pts, color, lift):
        p.face([(px, py, sea_z + lift) for px, py in pts], color, WOOD, B.FLAT)

    face([(mx0, my0), (mx1, my0), (mx1, my1), (mx0, my1)], HPAL['sea'], 0.0)

    def uv(u, v):
        return (mx0 + u * (mx1 - mx0), my1 - v * (my1 - my0))

    rows = MAP['world']['rows']
    zones = MAP['zones']
    # The coasts: each row's land runs, joined to the matching run of the next row (same
    # zone, overlapping) by a trapezoid from row centre to row centre, so the coastline runs
    # smooth instead of stepping; an unmatched run end is capped by half a row. A slightly
    # wider dark copy underneath draws the coast line.
    by_row = {}
    for r, u0, u1, zi in MAP['runs']:
        by_row.setdefault(r, []).append((u0, u1, zi))

    def matches(run, r):
        return [q for q in by_row.get(r, []) if q[2] == run[2] and q[0] < run[1] and q[1] > run[0]]

    def band(ua0, ua1, va, ub0, ub1, vb, zi):
        e = 0.006
        for lift, grow, col in ((0.007, e, HPAL['coast']), (0.014, 0.0, B.scale_color(ZONE_LAND.get(zones[zi], HPAL['parchment']), 1.12))):
            a0, a1 = uv(ua0 - grow, va), uv(ua1 + grow, va)
            b0, b1 = uv(ub0 - grow, vb), uv(ub1 + grow, vb)
            face([b0, b1, a1, a0], col, lift)

    for r in sorted(by_row):
        vc = (r + 0.5) / rows
        for run in by_row[r]:
            u0, u1, zi = run
            down = matches(run, r + 1)
            up = matches(run, r - 1)
            if len(down) == 1 and len(matches(down[0], r)) == 1:
                d = down[0]
                band(u0, u1, vc, d[0], d[1], vc + 1 / rows, zi)
            else:
                band(u0, u1, vc, u0, u1, vc + 0.5 / rows, zi)
            if not (len(up) == 1 and len(matches(up[0], r)) == 1):
                band(u0, u1, vc - 0.5 / rows, u0, u1, vc, zi)
    # the routes: dashed lanes, a pin at each berth, a little ship half way along
    colors = {'eastbrookNightbloom': HPAL['route_a'], 'wickharborDrakelands': HPAL['route_b']}
    for route in MAP['routes']:
        col = colors.get(route['id'], HPAL['route_a'])
        pts = [uv(u, v) for u, v in route['lane']]
        dash, gap, width = 0.1, 0.04, 0.045
        run = 0.0
        on = True
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            seg = math.hypot(bx - ax, by - ay)
            t = 0.0
            while t < seg - 1e-6:
                left = (dash if on else gap) - run
                t1 = min(seg, t + left)
                if on:
                    ux, uy = (bx - ax) / seg, (by - ay) / seg
                    nx_, ny_ = -uy * width / 2, ux * width / 2
                    pa = (ax + ux * t, ay + uy * t)
                    pb = (ax + ux * t1, ay + uy * t1)
                    face([(pa[0] - nx_, pa[1] - ny_), (pb[0] - nx_, pb[1] - ny_), (pb[0] + nx_, pb[1] + ny_),
                          (pa[0] + nx_, pa[1] + ny_)], col, 0.021)
                run += t1 - t
                t = t1
                if run >= (dash if on else gap) - 1e-9:
                    run = 0.0
                    on = not on
        for u, v in route['berths']:
            cx, cy = uv(u, v)
            p.cylinder((cx, cy, sea_z), (cx, cy, sea_z + 0.05), 0.085, col, IRON, sides=8)
            p.cylinder((cx, cy, sea_z + 0.05), (cx, cy, sea_z + 0.09), 0.055, P_['brass'], IRON, sides=8)
        # the ship: at the lane's middle waypoint, a hull and a sail in the route's colour
        mid = pts[len(pts) // 2]
        sx, sy = mid[0], mid[1]
        face([(sx - 0.07, sy - 0.02), (sx + 0.07, sy - 0.02), (sx + 0.1, sy + 0.015), (sx - 0.1, sy + 0.015)],
             HPAL['coast'], 0.028)
        face([(sx - 0.005, sy + 0.02), (sx + 0.06, sy + 0.03), (sx - 0.005, sy + 0.12)], P_['ivory'], 0.028)
        face([(sx - 0.02, sy + 0.02), (sx - 0.02, sy + 0.1), (sx - 0.07, sy + 0.03)], col, 0.028)
    # the compass rose in the open sea at the top left
    cx, cy = uv(0.13, 0.05)
    for k in range(8):
        a = math.tau * k / 8
        ln = 0.16 if k % 2 == 0 else 0.09
        w = 0.035
        tip = (cx + math.sin(a) * ln, cy + math.cos(a) * ln)
        l_ = (cx + math.cos(a) * w, cy - math.sin(a) * w)
        r_ = (cx - math.cos(a) * w, cy + math.sin(a) * w)
        col = HPAL['route_a'] if k == 0 else (P_['brass'] if k % 2 == 0 else HPAL['coast'])
        face([l_, tip, r_], col, 0.028)
    p.cylinder((cx, cy, sea_z), (cx, cy, sea_z + 0.02), 0.03, P_['brass'], IRON, sides=8)


def bay_window(p, B, X1, z0, z1, y0, y1, F):
    """The bay window on the sea wall: a timber box standing 0.9 out on brackets, glazed on
    three sides, a little shingled roof, and the window seat with its cushion inside."""
    WOOD, IRON, GLOW, ROPE = B.WOOD, B.IRON, B.GLOW, B.ROPE
    P_ = B.PAL
    d = 0.9
    xo = X1 + d
    zm = (z0 + z1) / 2
    # the bay's floor (the seat's base), sill panel under the glass, and corner posts
    p.box((X1 + d / 2 - 0.2, y0 - 0.1, zm), (d + 0.4, 0.2, z1 - z0 + 0.2), HPAL['beam'], WOOD)
    p.box((xo - 0.08, (y0 + y0 + 0.5) / 2, zm), (0.16, 0.5, z1 - z0), pick(HPAL['board'], 1), WOOD)
    for zz in (z0 + 0.08, z1 - 0.08):
        p.box((X1 + d / 2, (y0 + 0.5 + y0) / 2, zz), (d, 0.5, 0.16), pick(HPAL['board'], 2), WOOD)
    for zz in (z0 + 0.08, z1 - 0.08):
        p.box((xo - 0.08, (y0 + y1) / 2, zz), (0.18, y1 - y0, 0.18), P_['post'], WOOD)
    # glass: the front in three lights, the two sides
    gy0, gy1 = y0 + 0.5, y1 - 0.25
    p.box((xo - 0.08, (gy0 + gy1) / 2, zm), (0.06, gy1 - gy0, z1 - z0 - 0.2), P_['glow'], GLOW)
    for zz in (z0 + (z1 - z0) / 3, z0 + 2 * (z1 - z0) / 3):
        p.box((xo - 0.08, (gy0 + gy1) / 2, zz), (0.14, gy1 - gy0, 0.1), HPAL['beam'], WOOD)
    p.box((xo - 0.08, (gy0 + gy1) / 2 + 0.6, zm), (0.14, 0.08, z1 - z0 - 0.2), P_['iron'], IRON)
    for zz in (z0 + 0.08, z1 - 0.08):
        p.box((X1 + d / 2, (gy0 + gy1) / 2, zz), (d - 0.3, gy1 - gy0, 0.06), P_['glow'], GLOW)
    # head beam and a shingled lean-to roof
    p.box((X1 + d / 2, y1 - 0.12, zm), (d + 0.2, 0.26, z1 - z0 + 0.1), HPAL['beam'], WOOD)
    tilt = 0.5
    p.box((X1 + d / 2 + 0.1, y1 + 0.22, zm), (d + 0.5, 0.14, z1 - z0 + 0.5), pick(B.PAL['shingle'], 2), WOOD,
          roll=-tilt)
    # brackets under it
    for zz in (z0 + 0.2, z1 - 0.2):
        p.beam([(X1 + 0.05, y0 - 0.9, zz), (xo - 0.1, y0 - 0.2, zz)], 0.14, 0.16, HPAL['beam'], WOOD)
    # the window seat inside, a blue cushion and a folded chart on it
    p.box((X1 + d / 2 - 0.35, F + 0.45, zm), (d + 0.5, 0.9, z1 - z0 - 0.1), HPAL['beam'], WOOD)
    p.box((X1 + d / 2 - 0.35, y0 + 0.07, zm), (d + 0.4, 0.14, z1 - z0 - 0.25), HPAL['cushion'], ROPE, bevel=0.03)
    p.box((X1 + 0.1, y0 + 0.16, zm + 0.6), (0.5, 0.03, 0.36), P_['ivory'], WOOD, yaw=0.3)


def pick(seq, i):
    return seq[i % len(seq)]


def chimney(p, B, chim, RIDGE):
    """The stone chimney stack standing outside the land wall, from the shingle beach to
    above the ridge: coursed blocks, a stepped shoulder, a cap slab and two pots."""
    STONE, IRON = B.STONE, B.IRON
    P_ = B.PAL
    x, z, base = chim['x'], chim['z'], chim['base']
    bottom = min(base, B.ground(x, z)) - 0.5
    top = RIDGE + 1.1
    course = 0.55
    y = bottom
    k = 0
    shoulder = B.LAYOUT['house']['floor'] + 3.2
    while y < top - 0.02:
        yb = min(top, y + course)
        wide = y < shoulder
        dx = chim['hw'] * 2 + (0.3 if wide else 0.0)
        dz = chim['hd'] * 2 + (0.3 if wide else 0.0)
        off = 0.25 if k % 2 else -0.25
        for j, (za, zb) in enumerate(((-dz / 2, off), (off, dz / 2))):
            p.box((x - (0.15 if wide else 0) + 0.0, (y + yb) / 2, z + (za + zb) / 2),
                  (dx + 0.04 * ((k + j) % 2), yb - y - 0.04, zb - za - 0.04), pick(P_['stone'], k + j), STONE)
        y = yb
        k += 1
    p.box((x, shoulder + 0.05, z), (chim['hw'] * 2 + 0.4, 0.14, chim['hd'] * 2 + 0.4), P_['stone_dark'], STONE,
          taper=0.85)
    p.box((x, top + 0.08, z), (chim['hw'] * 2 + 0.3, 0.18, chim['hd'] * 2 + 0.3), P_['stone_dark'], STONE)
    for dz in (-0.4, 0.4):
        p.cylinder((x, top + 0.15, z + dz), (x, top + 0.6, z + dz), 0.19, (0.55, 0.3, 0.22), STONE, sides=8, r1=0.15)
        p.cylinder((x, top + 0.6, z + dz), (x, top + 0.66, z + dz), 0.2, P_['iron'], IRON, sides=8)


def build_hearth(p, B, q, F, TOPW):
    """The stone hearth on the land wall: side piers, the firebox with its fire and grate,
    a timber mantel, the chimney breast up to the wall plate, the ship's wheel mounted on it,
    and a hearthstone apron on the floor before it."""
    STONE, IRON, WOOD, GLOW = B.STONE, B.IRON, B.WOOD, B.GLOW
    P_ = B.PAL
    x, z, hw, hd = q['x'], q['z'], q['hw'], q['hd']
    back, front = x - hw, x + hw
    mant = F + 2.35
    # the piers either side of the firebox, the back, the hearth floor
    for s in (-1, 1):
        zc = z + s * (hd - 0.35)
        rows = 4
        for k in range(rows):
            ya = F + (mant - F) * k / rows
            yb = F + (mant - F) * (k + 1) / rows
            p.box((x + 0.02 * (k % 2), (ya + yb) / 2, zc), (hw * 2 + 0.04 * (k % 2), yb - ya - 0.04, 0.7),
                  pick(P_['stone'], k + (s > 0)), STONE)
    p.box((back + 0.25, (F + mant) / 2, z), (0.5, mant - F, hd * 2 - 1.3), P_['stone_dark'], STONE)
    p.box((x + 0.1, F + 0.14, z), (hw * 2 + 0.2, 0.28, hd * 2 - 1.3), P_['stone_dark'], STONE)
    # the fire: logs on an iron grate, embers glowing under them
    p.box((x + 0.05, F + 0.33, z), (0.6, 0.08, 1.2), HPAL['ember'], GLOW)
    for dz, rot in ((-0.2, 0.15), (0.22, -0.2), (0.0, 0.0)):
        y = F + 0.48 + (0.12 if dz == 0 else 0)
        p.cylinder((x - 0.25, y, z + dz - 0.45), (x + 0.3, y + 0.06, z + dz + 0.45 * math.cos(rot)), 0.12,
                   P_['post_dark'], WOOD, sides=6)
    for dz in (-0.25, 0.1):
        p.cylinder((x + 0.05, F + 0.55, z + dz), (x + 0.05, F + 1.15, z + dz + 0.05), 0.2, HPAL['fire'], GLOW,
                   sides=6, r1=0.02)
    for dz in (-0.5, 0.5):
        p.box((front - 0.1, F + 0.45, z + dz), (0.06, 0.5, 0.06), P_['iron'], IRON)
    p.box((front - 0.1, F + 0.7, z), (0.06, 0.06, 1.1), P_['iron'], IRON)
    # the mantel beam and shelf, a kettle and two candlesticks on it
    p.box((x + 0.15, mant + 0.16, z), (hw * 2 + 0.5, 0.32, hd * 2 + 0.1), HPAL['beam'], WOOD, bevel=0.03)
    p.box((x + 0.3, mant + 0.36, z), (hw * 2 + 0.3, 0.08, hd * 2 + 0.3), P_['post'], WOOD)
    for dz in (-1.1, 1.1):
        p.cylinder((front + 0.05, mant + 0.4, z + dz), (front + 0.05, mant + 0.65, z + dz), 0.05, P_['brass'], IRON,
                   sides=6)
        p.box((front + 0.05, mant + 0.72, z + dz), (0.05, 0.1, 0.05), P_['glow'], B.GLOW)
    # the chimney breast, stepped in, up to the wall plate
    breast_front = front - 0.2
    rows = 7
    for k in range(rows):
        ya = mant + 0.4 + (TOPW - mant - 0.4) * k / rows
        yb = mant + 0.4 + (TOPW - mant - 0.4) * (k + 1) / rows
        for j, (za, zb) in enumerate(((z - hd + 0.25, z + (0.3 if k % 2 else -0.3)),
                                      (z + (0.3 if k % 2 else -0.3), z + hd - 0.25))):
            p.box(((back + breast_front) / 2, (ya + yb) / 2, (za + zb) / 2),
                  (breast_front - back + 0.03 * ((k + j) % 2), yb - ya - 0.04, zb - za - 0.04),
                  pick(P_['stone'], k * 2 + j), STONE)
    # the old ship's wheel mounted on the breast over the mantel
    wy, wz = mant + 2.05, z
    wx_ = breast_front + 0.12
    p.ring((wx_, wy, wz), 0.78, 0.12, P_['plank'][2], segments=16, axis=(1, 0, 0), mat=WOOD, depth=0.1)
    p.ring((wx_, wy, wz), 0.62, 0.05, P_['brass'], segments=16, axis=(1, 0, 0), mat=IRON, depth=0.06)
    p.cylinder((wx_ - 0.1, wy, wz), (wx_ + 0.16, wy, wz), 0.16, P_['post_dark'], WOOD, sides=8)
    p.cylinder((wx_ + 0.16, wy, wz), (wx_ + 0.2, wy, wz), 0.1, P_['brass'], IRON, sides=8)
    for k in range(8):
        a = math.tau * k / 8
        ca, sa = math.cos(a), math.sin(a)
        p.beam([(wx_, wy + sa * 0.14, wz + ca * 0.14), (wx_, wy + sa * 1.08, wz + ca * 1.08)], 0.07, 0.07,
               P_['plank'][0], WOOD, up=(1, 0, 0))
        p.cylinder((wx_, wy + sa * 0.95, wz + ca * 0.95), (wx_, wy + sa * 1.15, wz + ca * 1.15), 0.06,
                   P_['plank'][2], WOOD, sides=6, r1=0.045)
    # the hearthstone apron on the floor before it
    p.box((front + 0.4, F + 0.03, z), (0.8, 0.06, hd * 2 - 0.4), P_['stone_dark'], STONE)


def build_rest_corner(p, B, props, F):
    """The rest corner before the fire: the rug, the high-backed settle against the north
    wall, the armchair turned to the hearth and the small table between them."""
    WOOD, ROPE, IRON = B.WOOD, B.ROPE, B.IRON
    P_ = B.PAL
    hearth = props['hearth']
    # the rug
    rx, rz = hearth['x'] + hearth['hw'] + 1.75, hearth['z']
    p.box((rx, F + 0.012, rz), (2.7, 0.024, 2.9), HPAL['rug_border'], ROPE)
    p.box((rx, F + 0.03, rz), (2.3, 0.024, 2.5), HPAL['rug'], ROPE)
    p.box((rx, F + 0.045, rz), (1.2, 0.02, 1.3), HPAL['rug_border'], ROPE, yaw=math.pi / 4)
    # the settle
    s = props['settle']
    x, z, hw, hd = s['x'], s['z'], s['hw'], s['hd']
    seat = F + 0.78
    p.box((x, seat - 0.06, z + 0.05), (hw * 2, 0.12, hd * 2 - 0.1), P_['post'], WOOD, bevel=0.02)
    p.box((x, (F + seat - 0.12) / 2, z + hd - 0.15), (hw * 2 - 0.1, seat - 0.12 - F, 0.08), HPAL['beam'], WOOD)
    back_top = F + 2.35
    p.box((x, (seat + back_top) / 2, z - hd + 0.08), (hw * 2, back_top - seat, 0.14), P_['post'], WOOD)
    for k in range(5):
        xx = x - hw + 0.25 + (hw * 2 - 0.5) * k / 4
        p.box((xx, (seat + back_top) / 2, z - hd + 0.18), (0.08, back_top - seat - 0.2, 0.05), HPAL['beam'], WOOD)
    p.box((x, back_top + 0.06, z - hd + 0.08), (hw * 2 + 0.16, 0.14, 0.22), HPAL['beam'], WOOD, bevel=0.02)
    for sx in (-1, 1):
        ax_ = x + sx * (hw - 0.06)
        p.box((ax_, (F + seat + 0.5) / 2, z), (0.12, seat + 0.5 - F, hd * 2), HPAL['beam'], WOOD)
    p.box((x, seat + 0.05, z + 0.05), (hw * 2 - 0.3, 0.1, hd * 2 - 0.2), HPAL['cushion'], ROPE, bevel=0.03)
    # the armchair, turned to the fire
    a = props['armchair']
    ax_, az_ = a['x'], a['z']
    face = math.atan2(hearth['x'] + hearth['hw'] - ax_, hearth['z'] - az_)  # direction to the fire
    mk = p.mark()
    cs = F + 0.62
    p.box((0, cs - 0.08, 0), (1.0, 0.16, 0.95), P_['post'], WOOD, bevel=0.02)
    p.box((0, cs + 0.05, 0.03), (0.86, 0.14, 0.8), HPAL['rug'], ROPE, bevel=0.03)
    p.box((0, cs + 0.6, -0.42), (1.0, 1.25, 0.16), P_['post'], WOOD, bevel=0.02, pitch=-0.12)
    p.box((0, cs + 0.62, -0.32), (0.8, 1.0, 0.1), HPAL['rug'], ROPE, bevel=0.02, pitch=-0.12)
    for sx in (-1, 1):
        p.box((sx * 0.46, cs + 0.22, 0.0), (0.12, 0.34, 0.9), HPAL['beam'], WOOD, bevel=0.02)
        for sz in (-1, 1):
            p.box((sx * 0.4, (F + cs - 0.16) / 2, sz * 0.36), (0.1, cs - 0.16 - F, 0.1), HPAL['beam'], WOOD)
    from mathutils import Matrix
    turn = Matrix.Translation(B.P(ax_, 0, az_)) @ Matrix.Rotation(face, 4, 'Z')
    p.turn(mk, turn)
    # the side table with a mug
    t = props['sideTable']
    tx, tz, tr = t['x'], t['z'], t['r']
    top = F + t['height']
    p.cylinder((tx, top - 0.08, tz), (tx, top, tz), tr + 0.03, P_['post'], WOOD, sides=10)
    p.cylinder((tx, F + 0.06, tz), (tx, top - 0.08, tz), 0.08, HPAL['beam'], WOOD, sides=6)
    p.cylinder((tx, F, tz), (tx, F + 0.08, tz), tr * 0.8, HPAL['beam'], WOOD, sides=8)
    p.cylinder((tx + 0.1, top, tz - 0.05), (tx + 0.1, top + 0.18, tz - 0.05), 0.07, P_['ivory'], WOOD, sides=8)


def build_chart_table(p, B, q, F):
    """The chart table: a heavy top on turned legs, sea charts spread on it, dividers and a
    spyglass, a rolled chart and a candle lantern."""
    WOOD, IRON, ROPE = B.WOOD, B.IRON, B.ROPE
    P_ = B.PAL
    x, z, hw, hd = q['x'], q['z'], q['hw'], q['hd']
    top = F + q['height']
    p.box((x, top - 0.08, z), (hw * 2, 0.16, hd * 2), P_['post'], WOOD, bevel=0.03)
    p.box((x, top - 0.24, z), (hw * 2 - 0.2, 0.16, hd * 2 - 0.2), HPAL['beam'], WOOD)
    for sx in (-1, 1):
        for sz in (-1, 1):
            lx, lz = x + sx * (hw - 0.22), z + sz * (hd - 0.2)
            p.box((lx, (F + top - 0.16) / 2, lz), (0.2, top - 0.16 - F, 0.2), HPAL['beam'], WOOD, bevel=0.02)
    p.box((x, F + 0.3, z), (hw * 2 - 0.5, 0.1, 0.1), HPAL['beam'], WOOD)
    # the charts: overlapping sheets with inked coasts and a course line
    sheets = ((-0.45, 0.05, 0.12, 1.25, 0.9), (0.45, -0.1, -0.2, 1.1, 0.8), (0.0, 0.2, 0.05, 0.9, 0.62))
    for i, (dx, dz, yaw, w, d) in enumerate(sheets):
        yy = top + 0.005 + 0.006 * i
        p.box((x + dx, yy, z + dz), (w, 0.012, d), P_['ivory'] if i != 1 else HPAL['parchment'], WOOD, yaw=yaw)
        for k in range(3):
            p.box((x + dx + (k - 1) * 0.22, yy + 0.008, z + dz + 0.1 * (k - 1)), (0.3, 0.004, 0.03),
                  HPAL['route_b'] if k != 1 else HPAL['coast'], WOOD, yaw=yaw + 0.4 * (k - 1))
    # dividers, a spyglass, a rolled chart, a candle lantern, an ink pot
    p.beam([(x + 0.2, top + 0.05, z + 0.2), (x + 0.5, top + 0.03, z + 0.45)], 0.03, 0.03, P_['brass'], IRON)
    p.beam([(x + 0.2, top + 0.05, z + 0.2), (x + 0.1, top + 0.03, z + 0.55)], 0.03, 0.03, P_['brass'], IRON)
    p.cylinder((x - 1.0, top + 0.08, z + 0.5), (x - 0.4, top + 0.08, z + 0.55), 0.06, P_['brass'], IRON, sides=8,
               r1=0.045)
    p.cylinder((x + 0.8, top + 0.09, z - 0.5), (x + 1.25, top + 0.09, z - 0.35), 0.08, P_['ivory'], WOOD, sides=8)
    B.lantern(p, x + 1.05, top + 0.2, z + 0.4, 0.22)
    p.cylinder((x - 0.9, top, z - 0.45), (x - 0.9, top + 0.1, z - 0.45), 0.06, (0.12, 0.12, 0.16), IRON, sides=6)


def build_clutter(p, B, H, props, F):
    """High tier dressing: nothing here is solid, and all of it keeps off the walk."""
    WOOD, IRON, ROPE = B.WOOD, B.IRON, B.ROPE
    P_ = B.PAL
    MAP = H['map']
    iz0 = H['interior']['z0']
    # the sea chest under the map
    cx, cz = MAP['x'], iz0 + 0.45
    p.box((cx, F + 0.33, cz), (1.3, 0.66, 0.7), P_['plank'][1], WOOD, bevel=0.03)
    p.box((cx, F + 0.72, cz), (1.36, 0.14, 0.76), P_['post_dark'], WOOD, bevel=0.03)
    for dx in (-0.45, 0.45):
        p.box((cx + dx, F + 0.4, cz), (0.08, 0.8, 0.8), P_['iron'], IRON)
    p.box((cx, F + 0.55, cz + 0.36), (0.14, 0.18, 0.05), P_['brass'], IRON)
    p.cylinder((cx + 0.35, F + 0.8, cz), (cx - 0.4, F + 0.84, cz + 0.05), 0.07, P_['ivory'], WOOD, sides=6)
    # firewood stacked north of the hearth
    hearth = props['hearth']
    fx = H['interior']['x0'] + 0.45
    fz = hearth['z'] - hearth['hd'] - 0.55
    for k, (dy, dz) in enumerate(((0.12, -0.24), (0.12, 0.0), (0.12, 0.24), (0.34, -0.12), (0.34, 0.12),
                                   (0.56, 0.0))):
        p.cylinder((fx - 0.4, F + dy, fz + dz), (fx + 0.4, F + dy, fz + dz), 0.12, P_['plank'][k % 3], WOOD, sides=6)
    # a bucket by the hearth
    bx, bz = hearth['x'] + hearth['hw'] + 0.3, hearth['z'] + hearth['hd'] + 0.3
    p.cylinder((bx, F, bz), (bx, F + 0.42, bz), 0.2, P_['post'], WOOD, sides=8, r1=0.25)
    p.ring((bx, F + 0.3, bz), 0.24, 0.04, P_['iron'], segments=8, axis=(0, 1, 0), mat=IRON, depth=0.02)
    # books and a bottle on the side table
    t = props['sideTable']
    top = F + t['height']
    for k in range(3):
        p.box((t['x'] - 0.1, top + 0.03 + k * 0.06, t['z'] + 0.08), (0.3, 0.055, 0.22), pick(HPAL['books'], k), ROPE,
              yaw=0.2 * k)
    # a rope coil and a lobster pot on the cargo
    crates = props['crateStack']
    ctop = crates['base'] + min(crates['hw'], crates['hd'] * 2) * 0.96
    for k in range(3):
        p.ring((crates['x'] - 0.6, ctop + 0.05 + k * 0.08, crates['z'] + 0.1), 0.3 - k * 0.04, 0.08,
               P_['rope'] if k % 2 == 0 else P_['rope_dark'], segments=12, axis=(0, 1, 0), mat=ROPE, depth=0.08)
    p.cylinder((crates['x'] + 0.55, ctop, crates['z'] - 0.1), (crates['x'] + 0.55, ctop + 0.4, crates['z'] - 0.1),
               0.28, P_['rope_dark'], ROPE, sides=8, r1=0.22)
    # the rowboat moored under the house's north side
    bx, bz = H['x'] - 0.5, H['z'] - H['hd'] - 1.6
    L, W = 3.4, 1.2
    rows = []
    for i in range(7):
        t_ = i / 6
        halfw = W / 2 * math.sin(math.pi * (0.12 + 0.76 * t_)) ** 0.7
        xx = bx - L / 2 + L * t_
        rows.append([(xx, 0.45, bz - halfw), (xx, 0.05, bz - halfw * 0.7), (xx, -0.12, bz),
                     (xx, 0.05, bz + halfw * 0.7), (xx, 0.45, bz + halfw)])
    for flip in (1, -1):
        p.surface(rows if flip > 0 else [list(reversed(r)) for r in rows],
                  lambda i, j: HPAL['boat'] if j not in (0, 3) else HPAL['boat_trim'], WOOD, soft=False)
    for dx in (-0.6, 0.5):
        p.box((bx + dx, 0.3, bz), (0.22, 0.06, W * 0.85), P_['plank'][2], WOOD)
    p.beam([(bx - L / 2, 0.4, bz), (H['x'] - 0.2, 1.4, H['z'] - H['hd'] + 0.1)], 0.04, 0.04, P_['rope'], ROPE)
