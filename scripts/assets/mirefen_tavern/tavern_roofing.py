"""The Mirefen tavern's roofing (tavern_shell.py's roofs call into it): irregular, mossy slate
shingles laid course by course, a bellcast flare at the eaves, a ridge of half-round cappers, the
dormers on the hall roof, and moss.

  shingle_plane   one roof slope: every shingle its own width, a little shorter or longer, its
                  lower edge kicked out over the course below by a varying amount, a few slipped
                  or missing (the sarking shows through), tones from dark green to blue-grey,
                  lichen and moss gathering low on the slope and along the lower edges
  ridge_cappers   half-round cappers along a ridge, each set a little askew
  dormer          a gabled dormer on a hall roof slope: a timber-framed plaster face round a
                  leaded window glowing like the front's, cheeks down to the roof, its own small
                  shingled roof dying into the main slope along its valleys (decorative: nothing
                  opens under it, the hall's sarking runs on unbroken inside)
  moss_clumps     cushions of moss on the lower courses (clutter: high tier)

Only the upper surface and the kicked-out lip of each shingle are drawn (their undersides and
ends lie on the course below), which keeps a roof of a few thousand shingles cheap.
"""
import math

# the slates' tones: the tavern's dark green, a blue-grey and a near black among them
SLATE = [(0.2, 0.33, 0.26), (0.17, 0.29, 0.23), (0.23, 0.36, 0.29), (0.19, 0.31, 0.25), (0.22, 0.3, 0.3),
         (0.15, 0.23, 0.21), (0.26, 0.34, 0.3)]
MOSS = [(0.4, 0.49, 0.18), (0.33, 0.44, 0.17), (0.47, 0.52, 0.22)]
LICHEN = (0.62, 0.62, 0.44)


def _h(*k):
    v = math.sin(sum(x * (12.9898 + 5.731 * i) for i, x in enumerate(k)) + 0.37) * 43758.5453
    return v - math.floor(v)


def _noise(a, b, seed):
    """Smooth value noise in [0, 1) over the slope (patches a couple of yards across)."""
    fa, fb = a / 2.3, b / 2.3
    ia, ib = math.floor(fa), math.floor(fb)
    ta, tb = fa - ia, fb - ib
    ta, tb = ta * ta * (3 - 2 * ta), tb * tb * (3 - 2 * tb)
    v00, v10 = _h(ia, ib, seed), _h(ia + 1, ib, seed)
    v01, v11 = _h(ia, ib + 1, seed), _h(ia + 1, ib + 1, seed)
    return (v00 * (1 - ta) + v10 * ta) * (1 - tb) + (v01 * (1 - ta) + v11 * ta) * tb


def _mix(c0, c1, t):
    return tuple(c0[i] + (c1[i] - c0[i]) * t for i in range(3))


def shingle_plane(B, p, e0, along, up, la, lu, seed=0, step=0.6, size=0.95, thick=0.07, moss=0.5, bell=0.0,
                  start=None, clip=None):
    """One slope of irregular shingles. e0 is the eave corner (game frame), `along` the unit
    vector along the eave, `up` the unit vector up the slope, la and lu the slope's extents,
    `step` the courses' spacing up the slope and `size` a shingle's mean width. `moss` (0..1)
    is how much moss and lichen gathers (more low on the slope). `bell` flares the lowest
    `bell` yards of the slope out a little (a bellcast eave). `start(s)` may begin a course
    further along than 0 (a dormer's slope dying into the main roof along its valley);
    `clip(point)` may move a corner."""
    nx = along[1] * up[2] - along[2] * up[1]
    ny = along[2] * up[0] - along[0] * up[2]
    nz = along[0] * up[1] - along[1] * up[0]
    if ny < 0:
        nx, ny, nz = -nx, -ny, -nz
    n = (nx, ny, nz)
    down = (-up[0], -up[1], -up[2])

    def at(a, s, lift):
        if bell > 0 and s < bell:
            lift += 0.13 * (bell - s) ** 2 / bell
        q = (e0[0] + along[0] * a + up[0] * s + nx * lift,
             e0[1] + along[1] * a + up[1] * s + ny * lift,
             e0[2] + along[2] * a + up[2] * s + nz * lift)
        return clip(q) if clip else q

    rows = max(1, int(round(lu / step)))
    rstep = lu / rows
    for r in range(rows):
        s0 = r * rstep
        a = -size * _h(r, seed, 1)
        a_min = start(s0) if start else 0.0
        j = 0
        while a < la:
            w = size * (0.65 + 0.7 * _h(r, j, seed, 2))
            a0, a1 = max(a_min, a) + 0.025, min(la, a + w) - 0.025
            k = _h(r, j, seed, 3)
            if a1 - a0 > 0.12 and k > 0.012:
                slip = (_h(r, j, seed, 4) - 0.5) * 0.12 - (0.18 if k < 0.03 else 0.0)
                sa = max(0.0, s0 + slip)
                sb = min(lu, s0 + rstep * 1.4)
                kick = thick * (1.5 + 1.1 * _h(r, j, seed, 5))
                # a slight skew: the lower edge's two corners sit at different heights
                skew = (_h(r, j, seed, 6) - 0.5) * 0.06
                bl, br = at(a0, sa + skew, kick), at(a1, sa - skew, kick)
                tl, tr = at(a0, sb, thick), at(a1, sb, thick)
                lbl, lbr = at(a0, sa + skew, kick - thick), at(a1, sa - skew, kick - thick)
                # tone: the slate's own, then moss and lichen by a patchy field, low on the slope
                base = SLATE[int(_h(r, j, seed, 7) * len(SLATE))]
                base = B.scale_color(base, 0.8 + 0.2 * _h(r, j, seed, 8))
                low = max(0.0, 1.0 - s0 / max(lu, 1e-3))
                field = _noise(a, s0, seed)
                m = moss * max(0.0, (field - 0.5) * 2.4 + (low - 0.55) * 0.9)
                top_col = _mix(base, MOSS[int(_h(r, j, 9) * len(MOSS))], min(0.75, m))
                if _h(r, j, seed, 10) < 0.05 * moss:
                    top_col = _mix(top_col, LICHEN, 0.55)
                f = B.flat_face(p, [bl, br, tr, tl], top_col, B.STONE, n, tag=0)
                # the moss gathers along the lower edge: those two corners greener still
                if m > 0.15:
                    edge = _mix(top_col, MOSS[0], min(0.7, m))
                    for loop in f.loops:
                        g = B.game_of(loop.vert.co)
                        dup = (g.x - e0[0]) * up[0] + (g.y - e0[1]) * up[1] + (g.z - e0[2]) * up[2]
                        if dup < sa + rstep * 0.5:
                            loop[p.col] = (*edge, 1.0)
                # the lip: the shingle's lower edge, kicked out over the course below
                B.flat_face(p, [lbl, lbr, br, bl], B.scale_color(base, 0.78), B.STONE, down, tag=0)
            a += w
            j += 1


def ridge_cappers(B, p, a, b, r=0.34, seed=0, color=None):
    """Half-round cappers along a ridge from game-frame point a to b, each a little askew."""
    color = color or (0.14, 0.23, 0.19)
    L = math.dist(a, b)
    n = max(2, int(L / 0.9))
    for k in range(n):
        t0, t1 = k / n, (k + 1) / n + 0.02
        pa = tuple(a[i] + (b[i] - a[i]) * t0 for i in range(3))
        pb = tuple(a[i] + (b[i] - a[i]) * min(1.0, t1) for i in range(3))
        tone = B.scale_color(color, 0.85 + 0.3 * _h(k, seed, 11))
        lift = (_h(k, seed, 12) - 0.5) * 0.06
        pa = (pa[0], pa[1] + lift, pa[2])
        p.cylinder(pa, pb, r * (0.92 + 0.14 * _h(k, seed, 13)), tone, B.STONE, sides=6,
                   phase=(_h(k, seed, 14) - 0.5) * 0.2)


def moss_clumps(B, p, e0, along, up, la, lu, seed=0, count=30):
    """Cushions of moss on a slope's lower courses and along its eave (clutter)."""
    nx = along[1] * up[2] - along[2] * up[1]
    ny = along[2] * up[0] - along[0] * up[2]
    nz = along[0] * up[1] - along[1] * up[0]
    if ny < 0:
        nx, ny, nz = -nx, -ny, -nz
    for k in range(count):
        a = la * _h(k, seed, 20)
        s = lu * (_h(k, seed, 21) ** 2.2) * 0.8
        if _noise(a, s, seed) < 0.35:
            continue
        c = (e0[0] + along[0] * a + up[0] * s + nx * 0.14, e0[1] + along[1] * a + up[1] * s + ny * 0.14,
             e0[2] + along[2] * a + up[2] * s + nz * 0.14)
        sz = 0.35 + 0.45 * _h(k, seed, 22)
        p.rock_blob(c, (sz, sz * 0.32, sz * 0.9), MOSS[k % len(MOSS)], B.PLASTER, jitter=0.25, subdivisions=0)


def dormer(B, p, side, zc, xd, width=2.6):
    """A gabled dormer on the hall roof's slope `side` (+1 the north slope, -1 the south), its
    face at |x| = xd, `width` wide along the hall, centred on local z = zc: a leaded window
    glowing like the front's, a timber-framed plaster face and cheeks down to the roof, and a
    small shingled roof whose valleys die into the main slope."""
    import tavern_shell as S

    H = B.HALL
    k = S.pitch(B)
    hw = width / 2
    # the main roof's upper surface (over the sarking and a course of shingles)
    lift = 0.22

    def roof_y(x):
        return S.hall_y(B, x) + lift

    x_face = side * xd
    # the face: a wall run along z at x = x_face, outward +x*side
    wall = B.Wall(x_face, zc - hw, x_face, zc + hw, (side, 0))
    t = 0.3
    y_base = roof_y(xd) - 0.1
    sill = y_base + 0.42
    head = sill + 1.25
    eave_y = head + 0.45
    ridge_y = eave_y + 1.15

    def top(u):
        # the face's gable: up to the dormer's ridge in its middle
        return eave_y + (ridge_y - eave_y) * (1 - abs(u - hw) / hw) - 0.08

    openings = [(hw - 0.55, hw + 0.55, sill, head)]
    B.timber_wall(p, wall, t, top, openings, base_h=0.0, y0=y_base, inner=False, bays=1.2, seed=31,
                  braces=False, hewn=0.02)
    B.window(p, wall, hw - 0.55, hw + 0.55, sill, head, t, shutters=False, lit=True, inner=False, glass_w=0.0,
             box_out=0.35)
    # the cheeks: from the face back to where the dormer's eave meets the main roof
    x_back = (H['ridge'] + lift - eave_y) / k
    for sz in (-1, 1):
        z = zc + sz * (hw - t / 2)
        # a triangular cheek: the roof line below, the dormer's eave above
        B.hexa(p, [(side * xd, y_base, z - t / 2), (side * x_back, roof_y(x_back) - 0.05, z - t / 2),
                   (side * x_back, roof_y(x_back) - 0.05, z + t / 2), (side * xd, y_base, z + t / 2),
                   (side * xd, eave_y, z - t / 2), (side * x_back, eave_y, z - t / 2),
                   (side * x_back, eave_y, z + t / 2), (side * xd, eave_y, z + t / 2)],
               B.pick(B.PAL['plaster'], 1), B.PLASTER)
        # a timber along the cheek's top and one down its front
        B.beam(p, (side * (xd + 0.02), eave_y - 0.1, z + sz * 0.02),
               (side * x_back, eave_y - 0.1, z + sz * 0.02), 0.18, 0.18, B.PAL['beam_dark'])
    # the dormer's roof: two small slopes from its ridge (along x) down to its eaves over the
    # cheeks, running out past the face and back into the main roof along the valleys
    over = 0.35
    lu = math.hypot(hw + over, ridge_y - eave_y)
    x_ridge_back = (H['ridge'] + lift - ridge_y) / k
    la = xd + 0.45 - x_ridge_back
    for sz in (-1, 1):
        up = (0.0, (ridge_y - eave_y) / lu, -sz * (hw + over) / lu)
        e0 = (side * (xd + 0.45), eave_y - 0.12 - over * (ridge_y - eave_y) / (hw + over), zc + sz * (hw + over))
        along = (-side, 0.0, 0.0)

        def start(s, sz=sz):
            # at slope distance s the dormer's roof stands at this height: it rises out of the
            # main roof where the main roof is that high
            y = e0[1] + up[1] * s
            return max(0.0, xd + 0.45 - (H['ridge'] + lift - y) / k)

        shingle_plane(B, p, e0, along, up, la, lu, seed=40 + int(zc) + sz, step=0.42, size=0.55, moss=0.4,
                      start=start)
        # the sarking under it and the bargeboard over the face
        B.beam(p, (side * (xd + 0.5), e0[1] - 0.05, e0[2]), (side * (xd + 0.5), ridge_y + 0.06, zc), 0.12, 0.34,
               B.PAL['beam_dark'])
    ridge_cappers(B, p, (side * (xd + 0.5), ridge_y + 0.1, zc), (side * x_ridge_back, ridge_y + 0.1, zc), r=0.2,
                  seed=int(zc * 3))
    # the soffit under the overhang at the face
    B.hexa(p, [(side * xd, eave_y - 0.2, zc - hw - over), (side * (xd + 0.45), eave_y - 0.2, zc - hw - over),
               (side * (xd + 0.45), eave_y - 0.2, zc + hw + over), (side * xd, eave_y - 0.2, zc + hw + over),
               (side * xd, eave_y - 0.05, zc - hw - over), (side * (xd + 0.45), eave_y - 0.05, zc - hw - over),
               (side * (xd + 0.45), eave_y - 0.05, zc + hw + over), (side * xd, eave_y - 0.05, zc + hw + over)],
           B.PAL['sarking'], B.WOOD)
