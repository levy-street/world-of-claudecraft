"""The guild hall's shell: the great hall's walls, floor and open timber roof, the trophy hall
behind it, the lantern tower, the porch with the guild's crest, the hearths' chimneys.

Parts (build_guild.py makes them): GuildShell (the walls and floors), GuildRoof (the slate and
everything above the plates outside), GuildTimber (the open roof's trusses inside the hall),
GuildTrim (gold, iron and the carved crest) and GuildGlow (lit glass and flames).

It builds with the guild's own kit (guild_lib.py, guild_kit.py): the walls, windows, slates
and porch Highwatch's manor was raised with, kept here since the manor left the town.
"""
import math

from guild_kit import (STONE_TO, _ashlar_face, _ball, arch_ring, chimney, door_frame, finial, flag_floor, hip_roof,
                       oculus, porch, slate_roof, wainscot)
from guild_lib import (GLOW, GLOW_LANTERN, LAYER, METAL, PAL, SLATE, STONE, WOOD, Wall, abox, cbox, cyl, flat_face,
                       hexa, pick, stone_wall, tone, window)

from guild_props import has, hang

from guild_plan import (ARCH_TROPHY, DOOR, EAVE_OUT, FLOOR, FOOT, HALL, HALL_PITCH, HEARTH, PILASTER, PORCH, TOWER,
                        TROPHY, TROPHY_HEARTH, TROPHY_OUT, TROPHY_PITCH, TRUSS_X, VERGE_OUT)

H = HALL








# ---------------------------------------------------------------------------
# The great hall
# ---------------------------------------------------------------------------
def hall_walls(p, p_trim, glow):
    t = H['t']
    plate = H['plate']
    flat = lambda u: plate  # noqa: E731
    # the front wall, from the right (-x) corner to the left (+x) one, its outer face south
    zc = (H['oz0'] + H['z0']) / 2
    front = Wall(H['ox0'], zc, H['ox1'], zc, (0, -1))
    U = lambda x: x - H['ox0']  # noqa: E731
    win = []
    for x in (-10.6, 10.6):
        win.append((U(x) - 1.2, U(x) + 1.2, FLOOR + 3.0, FLOOR + 9.2))
    for x in (-4.7, 4.7):
        win.append((U(x) - 0.85, U(x) + 0.85, FLOOR + 2.2, FLOOR + 5.9))
    door = (U(DOOR['x0']), U(DOOR['x1']), FLOOR, DOOR['head'])
    stone_wall(p, front, t, flat, win + [door], plinth=STONE_TO, seed=1)
    for (u0, u1, v0, v1) in win:
        window(p, front, u0, u1, v0, v1, t, lit=True, arch=True, bars=3 if v1 - v0 > 5 else 2)
    door_frame(p, front, U(DOOR['x0']), U(DOOR['x1']), t)
    # the guild's banners on the front either side of the porch, over the ashlar storey and
    # between the porch's eaves and the tall windows (the town hall's civic dress)
    if has('guild_banner'):
        for x in (-8.05, 8.05):
            hang(p_trim, 'guild_banner', (x, FLOOR + 7.55, H['oz0']), (0.0, -1.0), 4.2, standoff=0.06)
    wainscot(p, front, t, 0.9, U(DOOR['x0']) - 0.4)
    wainscot(p, front, t, U(DOOR['x1']) + 0.4, front.length - 0.9)
    # the back wall, its outer face north, the round arch into the trophy hall in its middle
    zc = (H['z1'] + H['oz1']) / 2
    back = Wall(H['ox0'], zc, H['ox1'], zc, (0, 1))
    span = ARCH_TROPHY['x1'] - ARCH_TROPHY['x0']
    spring = ARCH_TROPHY['head'] - span / 2
    arch = (U(ARCH_TROPHY['x0']), U(ARCH_TROPHY['x1']), FLOOR, ARCH_TROPHY['head'])
    bwin = [(U(x) - 1.1, U(x) + 1.1, FLOOR + 3.4, FLOOR + 9.2) for x in (-11.9, 11.9)]
    stone_wall(p, back, t, flat, bwin + [arch], plinth=STONE_TO, seed=2)
    for (u0, u1, v0, v1) in bwin:
        window(p, back, u0, u1, v0, v1, t, lit=True, arch=True, bars=3)
    arch_ring(p, back, arch[0], arch[1], spring, t, n=9)
    wainscot(p, back, t, 0.9, arch[0] - 0.5)
    wainscot(p, back, t, arch[1] + 0.5, back.length - 0.9)
    # the gable walls: left (+x) behind the contracts board, right (-x) behind the counter
    # and the guildmaster's hearth; a tall window toward the front or the back, and an oculus
    # high in each gable
    for sx in (1, -1):
        xc = sx * (H['x1'] + H['t'] / 2)
        g = Wall(xc, H['oz0'], xc, H['oz1'], (sx, 0))
        Z = lambda z: z - H['oz0']  # noqa: E731
        top = lambda u: H['plate'] + HALL_PITCH * (H['oz1'] - abs(u + H['oz0']))  # noqa: E731
        oc = (Z(-1.3), Z(1.3), FLOOR + 14.2, FLOOR + 16.8)
        if sx > 0:
            # the lantern tower stands against this wall's front: the window behind the board
            wins = [(Z(5.6), Z(8.0), FLOOR + 3.2, FLOOR + 9.0)]
        else:
            wins = [(Z(-8.0), Z(-5.6), FLOOR + 3.2, FLOOR + 9.0)]
        stone_wall(p, g, t, top, wins + [oc], plinth=STONE_TO, seed=3 + sx,
                   rails=[STONE_TO + 0.12, FLOOR + 6.8, H['plate'] - 0.21, FLOOR + 13.8])
        for (u0, u1, v0, v1) in wins:
            window(p, g, u0, u1, v0, v1, t, lit=True, arch=True, bars=3)
        oculus(p, g, (oc[0] + oc[1]) / 2, (oc[2] + oc[3]) / 2, 1.3, t, glow)
        wainscot(p, g, t, 0.9, g.length - 0.9)
    # pilasters inside under each truss, from a dressed stone base on the floor up to the plate
    # (the base sunk a hair under the flags, the oak let a hair into the base)
    P = PILASTER
    for x in TRUSS_X:
        for sz in (1, -1):
            zf = sz * (H['z1'] - P['off'])
            zp, zb = zf - sz * P['depth'], zf - sz * P['base_depth']
            abox(p, x - P['half'], x + P['half'], FLOOR + P['base_h'] - 0.05, H['plate'], min(zf, zp), max(zf, zp),
                 PAL['oak_dark'], WOOD)
            abox(p, x - P['base_half'], x + P['base_half'], FLOOR - 0.02, FLOOR + P['base_h'], min(zf, zb), max(zf, zb),
                 PAL['ashlar_hi'], STONE)


def hall_roof(p_roof, p_timber):
    """The great roof: two slate slopes on a ridge along x from gable to gable, the porch's cross
    gable let into the south slope, wrought cresting on the ridge, and inside the open timber
    roof: four arch-braced hammer-beam trusses, purlins and a ridge beam, every member above the
    truss line (the camera's air, render/placed_town_interior_core.ts)."""
    plate, ridge = H['plate'], H['ridge']
    ez = H['oz1'] + EAVE_OUT
    eave_y = plate - HALL_PITCH * EAVE_OUT
    ex0, ex1 = H['ox0'] - VERGE_OUT, H['ox1'] + VERGE_OUT
    run = ez
    slope = math.hypot(run, ridge - eave_y)
    h, c = (ridge - eave_y) / slope, run / slope
    porch_ridge = PORCH['ridge']
    porch_pitch = (porch_ridge - PORCH['beam'] - 0.8) / (PORCH['x1'] + 0.6)

    def clip_south(s0, s1):
        y_lo = eave_y + h * s0
        half = (porch_ridge - y_lo) / porch_pitch if porch_pitch > 0 else 0
        # the lantern tower stands on the slope's left end: courses in front of its back wall
        # stop at its side
        end = TOWER['x0'] - ex0 if -ez + c * s0 < TOWER['z1'] else ex1 - ex0
        spans = [(0.0, end)]
        if half > 0:
            a, b = -ex0 - half + 0.15, -ex0 + half - 0.15
            spans = [(lo, hi) for (lo, hi) in ((0.0, a), (b, end)) if hi - lo > 0.1]
        return spans or None

    slate_roof(p_roof, (ex0, eave_y, -ez), (1, 0, 0), (0, h, c), ex1 - ex0, slope, seed=11, clip=clip_south,
               under=False)
    slate_roof(p_roof, (ex1, eave_y, ez), (-1, 0, 0), (0, h, -c), ex1 - ex0, slope, seed=12, under=False)
    p_roof.beam([(ex0, ridge + 0.12, 0), (ex1, ridge + 0.12, 0)], 0.4, 0.3, PAL['slate_ridge'], SLATE)
    for x in (ex0 + 0.1, ex1 - 0.1):
        finial(p_roof, x, ridge + 0.25, 0.0, h=1.8, r=0.2)
    # wrought cresting along the ridge, each upright tipped with a gilded point
    a, b = ex0 + 0.9, ex1 - 0.9
    y0 = ridge + 0.27
    p_roof.beam([(a, y0 + 0.5, 0.0), (b, y0 + 0.5, 0.0)], 0.05, 0.05, PAL['iron'], METAL)
    n = max(2, int((b - a) / 0.6))
    for k in range(n + 1):
        x = a + (b - a) * k / n
        cyl(p_roof, x, y0, y0 + 0.62, 0.0, 0.03, PAL['iron'], METAL, sides=4)
        p_roof.prism((x, y0 + 0.62, 0.0), 4, 0.07, 0.0, 0.2, PAL['gold'], METAL, axis=(0, 1, 0))
        if k % 2:
            p_roof.ring((x, y0 + 0.3, 0.0), 0.16, 0.025, PAL['iron'], 8, axis=(0, 0, 1), mat=METAL)
    # the verges' barge boards
    for x in (ex0, ex1):
        for sz in (1, -1):
            start = (x, eave_y - 0.1, sz * ez)
            if x == ex1 and sz < 0:
                # the tower hides the verge's foot: the board starts at the tower's back wall
                zt = TOWER['z1']
                start = (x, ridge - HALL_PITCH * abs(zt) - 0.1, zt)
            p_roof.beam([start, (x, ridge + 0.05, 0.0)], 0.12, 0.42, PAL['timber'], WOOD, up=(0, 1, 0))
    # the eaves' fascia and the corbels under them
    for sz in (1, -1):
        fx1 = TOWER['x0'] if sz < 0 else ex1
        abox(p_roof, ex0, fx1, eave_y - 0.42, eave_y - 0.06, sz * ez - 0.07, sz * ez + 0.07, PAL['timber'], WOOD)
        x = ex0 + 1.4
        while x < ex1 - 1.2:
            clear_porch = sz > 0 or abs(x) > PORCH['x1'] + 0.9
            clear_trophy = sz < 0 or abs(x) > TROPHY['ox1'] + 0.9
            clear_tower = not (sz < 0 and x > TOWER['x0'] - 0.6)
            if clear_porch and clear_trophy and clear_tower:
                zc = sz * (H['oz1'] + 0.3)
                abox(p_roof, x - 0.11, x + 0.11, plate - 0.9, plate - 0.25, min(zc, sz * (H['oz1'] + 0.9)),
                     max(zc, sz * (H['oz1'] + 0.9)), PAL['timber_dark'], WOOD)
            x += 2.2
    # the boarded underside inside and the common rafters on it
    for sz in (1, -1):
        za = sz * H['z1']
        ya = plate + 0.05
        flat_face(p_timber, [(H['x0'], ya, za), (H['x1'], ya, za), (H['x1'], ridge - 0.12, 0.0),
                             (H['x0'], ridge - 0.12, 0.0)], PAL['sarking'], WOOD, (0, -1, -sz))
        x = H['x0'] + 0.8
        while x < H['x1'] - 0.5:
            if not any(abs(x - tx) < 0.6 for tx in TRUSS_X):
                p_timber.beam([(x, ya - 0.14, za), (x, ridge - 0.26, 0.0)], 0.16, 0.18, PAL['oak'][1], WOOD,
                              up=(0, 1, 0))
            x += 1.3
    # the trusses (the manor's hammer-beam design, every member over the truss line)
    tl = H['truss']
    collar = FLOOR + 16.6
    for i, x in enumerate(TRUSS_X):
        col = pick(PAL['oak'], i)
        dk = PAL['oak_dark']
        for sz in (1, -1):
            zw = sz * (H['z1'] - 0.15)
            p_timber.beam([(x, plate + 0.05, sz * H['z1']), (x, ridge - 0.5, sz * 0.45)], 0.42, 0.46, col, WOOD,
                          up=(1, 0, 0))
            hb_y = tl + 0.35
            hz = sz * (H['z1'] - 2.4)
            p_timber.beam([(x, FLOOR + 6.4, zw), (x, hb_y, zw)], 0.36, 0.36, dk, WOOD, up=(1, 0, 0))
            p_timber.beam([(x, hb_y, sz * (H['z1'] + 0.2)), (x, hb_y, hz)], 0.4, 0.46, col, WOOD, up=(1, 0, 0))
            cbox(p_timber, x, hb_y - 0.32, hz, 0.36, 0.3, 0.4, PAL['gold_dark'], METAL)
            b0 = FLOOR + 9.2
            pts = [(x, b0 + (hb_y - 0.25 - b0) * (1 - math.cos(math.pi / 2 * k / 5)),
                    zw - sz * 2.2 * math.sin(math.pi / 2 * k / 5)) for k in range(6)]
            p_timber.sweep(pts, 0.16, 0.16, col, sides=4, mat=WOOD, phase=math.pi / 4)
            hp_top = plate + HALL_PITCH * (H['z1'] - abs(hz)) - 0.4
            p_timber.beam([(x, hb_y, hz), (x, hp_top, hz)], 0.34, 0.34, col, WOOD, up=(1, 0, 0))
            pts = []
            for k in range(9):
                tt = k / 8
                ang = math.pi / 2 * tt
                zz = hz - sz * (abs(hz) - 1.2) * math.sin(ang)
                yy = hb_y + 0.2 + (collar - hb_y - 0.2) * (1 - math.cos(ang)) ** 0.8
                pts.append((x, yy, zz))
            p_timber.sweep(pts, 0.17, 0.17, col, sides=4, mat=WOOD, phase=math.pi / 4)
        p_timber.beam([(x, collar, -2.6), (x, collar, 2.6)], 0.4, 0.44, col, WOOD, up=(1, 0, 0))
        p_timber.beam([(x, collar, 0), (x, ridge - 0.4, 0)], 0.3, 0.3, dk, WOOD, up=(1, 0, 0))
    p_timber.beam([(H['x0'], ridge - 0.5, 0), (H['x1'], ridge - 0.5, 0)], 0.36, 0.4, PAL['oak_dark'], WOOD)
    for sz in (1, -1):
        for f in (0.35, 0.68):
            zz = sz * H['z1'] * (1 - f)
            yy = plate + HALL_PITCH * (H['z1'] - abs(zz)) - 0.3
            p_timber.beam([(H['x0'], yy, zz), (H['x1'], yy, zz)], 0.32, 0.36, PAL['oak'][2], WOOD)
        p_timber.beam([(H['x0'], plate - 0.1, sz * (H['z1'] - 0.1)), (H['x1'], plate - 0.1, sz * (H['z1'] - 0.1))],
                      0.4, 0.34, PAL['oak_dark'], WOOD)


def hall_hearth(p, p_trim, glow):
    """The guildmaster's fireplace in the right gable wall: a stone breast proud of the wall, a
    wide arched firebox with logs and embers, a carved mantel, a tapering stone hood to the
    wall plate; outside, the chimney stack up the gable."""
    hz0, hz1 = HEARTH['z0'], HEARTH['z1']
    xw = H['x0']
    xf = xw + HEARTH['depth']
    # the breast's sides and its face either side of the firebox
    abox(p, xw, xf, FLOOR, HEARTH['hood_top'], hz0, hz0 + 0.5, PAL['ashlar'][1], STONE)
    abox(p, xw, xf, FLOOR, HEARTH['hood_top'], hz1 - 0.5, hz1, PAL['ashlar'][3], STONE)
    abox(p, xw, xf, HEARTH['opening'], HEARTH['hood_top'], hz0 + 0.5, hz1 - 0.5, PAL['ashlar'][0], STONE)
    # the firebox: a soot-dark back and floor
    abox(p, xw, xw + 0.25, FLOOR, HEARTH['opening'], hz0 + 0.5, hz1 - 0.5, PAL['soot'], STONE)
    flat_face(p, [(xw + 0.25, FLOOR + 0.12, hz0 + 0.5), (xf, FLOOR + 0.12, hz0 + 0.5), (xf, FLOOR + 0.12, hz1 - 0.5),
                  (xw + 0.25, FLOOR + 0.12, hz1 - 0.5)], PAL['soot'], STONE, (0, 1, 0))
    # coursed quoins on the breast's face and a dressed arch over the opening
    for (za, zb) in ((hz0, hz0 + 0.5), (hz1 - 0.5, hz1)):
        v = FLOOR
        k = 0
        while v < HEARTH['opening'] - 0.05:
            v1 = min(HEARTH['opening'], v + 0.6)
            abox(p, xf, xf + 0.1, v + 0.02, v1 - 0.02, za - (0.12 if k % 2 else 0) * (1 if za == hz0 else 0),
                 zb + (0.12 if k % 2 else 0) * (1 if zb == hz1 else 0), tone(PAL['ashlar_hi'], v, za), STONE)
            v = v1
            k += 1
    # the mantel shelf and its carved corbels, the hood rising behind
    abox(p, xw, xf + 0.45, HEARTH['mantel'] - 0.25, HEARTH['mantel'], hz0 - 0.2, hz1 + 0.2, PAL['oak_dark'], WOOD)
    for zz in (hz0 + 0.25, hz1 - 0.25):
        abox(p, xf, xf + 0.38, HEARTH['opening'], HEARTH['mantel'] - 0.25, zz - 0.18, zz + 0.18, PAL['oak_dark'], WOOD)
    # logs and the fire (glow) in the box
    for k, zz in enumerate((hz0 + 1.2, (hz0 + hz1) / 2, hz1 - 1.2)):
        p.cylinder((xw + 0.5, FLOOR + 0.3, zz - 0.7), (xw + 0.75, FLOOR + 0.32, zz + 0.7), 0.16, tone(PAL['oak_dark'], k),
                   WOOD, sides=6)
    # (the fire itself is the campfire's live flame, render/highwatch_guild_lights.ts: the
    # model keeps the logs and the glowing bed of embers under it)
    flat_face(glow, [(xw + 0.3, FLOOR + 0.16, hz0 + 0.7), (xf - 0.2, FLOOR + 0.16, hz0 + 0.7),
                     (xf - 0.2, FLOOR + 0.16, hz1 - 0.7), (xw + 0.3, FLOOR + 0.16, hz1 - 0.7)], PAL['ember'], GLOW,
              (0, 1, 0))
    # andirons
    for zz in (hz0 + 0.9, hz1 - 0.9):
        abox(p_trim, xf - 0.5, xf - 0.1, FLOOR, FLOOR + 0.55, zz - 0.06, zz + 0.06, PAL['iron'], METAL)
        p_trim.prism((xf - 0.12, FLOOR + 0.55, zz), 8, 0.08, 0.08, 0.0001, PAL['gold'], METAL, axis=(0, 1, 0))
        _ball(p_trim, xf - 0.12, FLOOR + 0.66, zz, 0.1)
    # the hearthstone
    abox(p, xf, xf + 1.0, FLOOR - 0.02, FLOOR + LAYER, hz0 - 0.4, hz1 + 0.4, PAL['stone_dark'], STONE)
    # the breast's face over the mantel dressed in coursed ashlar
    _ashlar_face(p, Wall(xf, hz0, xf, hz1, (1, 0)), 0.0, hz1 - hz0, HEARTH['mantel'] + 0.05, HEARTH['hood_top'],
                    0.0, seed=17)
    # the chimney stack outside the gable, up past the roof slope
    zc = (hz0 + hz1) / 2
    top = H['plate'] + HALL_PITCH * (H['oz1'] - abs(zc)) + 2.4
    chimney(p, p_trim, H['ox0'] - 0.8, zc, top, 1.6, 2.6)


def hall_floor(p, p_trim):
    flag_floor(p, H['x0'], H['x1'], H['z0'], H['z1'], FLOOR, size=2.0, seed=81)
    # the arch's dressed sill, a layer proud over the wall core's cut
    abox(p, ARCH_TROPHY['x0'], ARCH_TROPHY['x1'], FLOOR - 0.02, FLOOR + LAYER, H['z1'], H['oz1'], PAL['ashlar_hi'],
         STONE)


# ---------------------------------------------------------------------------
# The trophy hall
# ---------------------------------------------------------------------------
def trophy_hall(p, p_roof, p_trim, glow):
    T = TROPHY
    t = T['t']
    plate = T['plate']
    flat = lambda u: plate  # noqa: E731
    # the side walls, a high window between the two plaques on each
    for sx in (1, -1):
        xc = sx * (T['x1'] + t / 2)
        g = Wall(xc, H['oz1'], xc, T['z1'], (sx, 0))
        Z = lambda z: z - H['oz1']  # noqa: E731
        wins = [(Z(14.7), Z(16.1), FLOOR + 6.6, FLOOR + 8.4)]
        stone_wall(p, g, t, flat, wins, plinth=FLOOR + 2.8, seed=31 + sx, rails=[FLOOR + 2.92, FLOOR + 6.2, plate - 0.21])
        for (u0, u1, v0, v1) in wins:
            window(p, g, u0, u1, v0, v1, t, lit=True, arch=True, bars=1)
        wainscot(p, g, t, 0.2, g.length - 1.1, top=FLOOR + 2.4)
    # the back wall
    zc = T['z1'] + t / 2
    back = Wall(T['ox0'], zc, T['ox1'], zc, (0, 1))
    stone_wall(p, back, t, flat, [], plinth=FLOOR + 2.8, seed=35, rails=[FLOOR + 2.92, FLOOR + 6.2, plate - 0.21])
    # the floor: dark and pale flags in a chequer
    flag_floor(p, T['x0'], T['x1'], H['oz1'], T['z1'], FLOOR, size=1.4, seed=91,
               colors=[(0.36, 0.38, 0.44), (0.56, 0.57, 0.6), (0.4, 0.42, 0.47), (0.6, 0.6, 0.62)])
    # the roof: a hipped slate roof tucked under the great hall's north eave, boarded inside
    hip_roof(p_roof, T['ox0'], T['ox1'], H['oz1'], T['oz1'], plate, TROPHY_PITCH, 'x', hips=(True, True), seed=41,
             out=TROPHY_OUT, under=True)
    # tie beams across under the boards (all over the trophy hall's air)
    for k in range(4):
        zz = H['oz1'] + 1.3 + (T['z1'] - H['oz1'] - 2.6) * k / 3
        p_roof.beam([(T['x0'], plate - 0.15, zz), (T['x1'], plate - 0.15, zz)], 0.28, 0.32, PAL['oak_dark'], WOOD)
    # the fireplace in the back wall, under the wyrm's skull
    th = TROPHY_HEARTH
    zw = T['z1']
    zf = zw - th['depth']
    abox(p, th['x0'], th['x0'] + 0.55, FLOOR, th['hood_top'], zf, zw, PAL['ashlar'][1], STONE)
    abox(p, th['x1'] - 0.55, th['x1'], FLOOR, th['hood_top'], zf, zw, PAL['ashlar'][3], STONE)
    abox(p, th['x0'] + 0.55, th['x1'] - 0.55, th['opening'], th['hood_top'], zf, zw, PAL['ashlar'][0], STONE)
    abox(p, th['x0'] + 0.55, th['x1'] - 0.55, FLOOR, th['opening'], zw - 0.25, zw, PAL['soot'], STONE)
    flat_face(p, [(th['x0'] + 0.55, FLOOR + 0.12, zf), (th['x1'] - 0.55, FLOOR + 0.12, zf),
                  (th['x1'] - 0.55, FLOOR + 0.12, zw - 0.25), (th['x0'] + 0.55, FLOOR + 0.12, zw - 0.25)], PAL['soot'],
              STONE, (0, 1, 0))
    abox(p, th['x0'] - 0.25, th['x1'] + 0.25, th['mantel'] - 0.25, th['mantel'], zf - 0.4, zw, PAL['ashlar_hi'], STONE)
    # (its fire is the campfire's live flame too: render/highwatch_guild_lights.ts)
    for xx in (-0.9, 0.9):
        p.cylinder((xx - 0.6, FLOOR + 0.25, zw - 0.55), (xx + 0.6, FLOOR + 0.27, zw - 0.7), 0.14, PAL['oak_dark'], WOOD,
                   sides=6)
    flat_face(glow, [(th['x0'] + 0.7, FLOOR + 0.16, zf + 0.15), (th['x1'] - 0.7, FLOOR + 0.16, zf + 0.15),
                     (th['x1'] - 0.7, FLOOR + 0.16, zw - 0.3), (th['x0'] + 0.7, FLOOR + 0.16, zw - 0.3)], PAL['ember'],
              GLOW, (0, 1, 0))
    abox(p, th['x0'] - 0.3, th['x1'] + 0.3, FLOOR - 0.02, FLOOR + LAYER, zf - 1.0, zf, PAL['stone_dark'], STONE)
    face = Wall(th['x0'], zf, th['x1'], zf, (0, -1))
    _ashlar_face(p, face, 0.0, th['x1'] - th['x0'], th['mantel'] + 0.05, th['hood_top'], 0.0, seed=19)
    for (ua, ub) in ((0.0, 0.55), (th['x1'] - th['x0'] - 0.55, th['x1'] - th['x0'])):
        _ashlar_face(p, face, ua, ub, FLOOR, th['mantel'] - 0.25, 0.0, seed=23)
    # the chimney stack behind, up past the hip
    chimney(p, p_trim, 0.0, T['oz1'] + 0.7, plate + 5.6, 2.2, 1.4)


# ---------------------------------------------------------------------------
# The lantern tower
# ---------------------------------------------------------------------------
def tower(p, p_roof, p_trim, glow):
    W = TOWER
    t = 0.8
    x0, x1, z0, z1 = W['x0'], W['x1'], W['z0'], W['z1']
    plate = W['plate']
    flat = lambda u: plate  # noqa: E731
    # the front and back walls stop at the outer wall's inner face, so no two end faces
    # share a plane with a neighbour's face
    sides = [
        (Wall(x0, z0 + t / 2, x1 - t, z0 + t / 2, (0, -1)), 'front'),
        (Wall(x1 - t / 2, z0, x1 - t / 2, z1, (1, 0)), 'outer'),
        (Wall(x0, z1 - t / 2, x1 - t, z1 - t / 2, (0, 1)), 'back'),
    ]
    for k, (wall, name) in enumerate(sides):
        L = wall.length
        wins = [(L / 2 - 0.7, L / 2 + 0.7, FLOOR + 8.2, FLOOR + 11.0), (L / 2 - 0.7, L / 2 + 0.7, FLOOR + 14.6, FLOOR + 17.4)]
        if name == 'front':
            wins.append((L / 2 - 0.8, L / 2 + 0.8, FLOOR + 2.6, FLOOR + 5.6))
        stone_wall(p, wall, t, flat, wins, plinth=STONE_TO, seed=50 + k, inner=False,
                   rails=[STONE_TO + 0.12, FLOOR + 7.4, FLOOR + 12.6, plate - 0.21])
        for (u0, u1, v0, v1) in wins:
            window(p, wall, u0, u1, v0, v1, t, lit=True, arch=True, bars=2, inner=False)
    # the side against the hall's gable rises clear of the hall's roof: its upper storey
    inner_wall = Wall(x0 + t / 2, z0 + t, x0 + t / 2, z1 - t, (-1, 0))
    # (from just under the hall's plate: the great roof's slope runs into it below)
    lo = H['plate'] - 0.5
    stone_wall(p, inner_wall, t, flat, [], plinth=STONE_TO, y0=lo, seed=55, inner=False,
               rails=[lo + 0.2, plate - 0.21])
    # two dressed string courses round the three free faces, a gilded fillet on the upper
    for (yy, gilt) in ((FLOOR + 7.4, False), (FLOOR + 12.6, True)):
        abox(p, x0 + 0.01, x1 + 0.14, yy - 0.16, yy + 0.16, z0 - 0.14, z1 + 0.14, PAL['ashlar_hi'], STONE)
        if gilt:
            abox(p_trim, x0 + 0.01, x1 + 0.17, yy - 0.04, yy + 0.04, z0 - 0.17, z1 + 0.17, PAL['gold'], METAL)
    # a contract writ of the guild's own hung on the tower's face toward the yard: a long blue
    # banner from the upper course with the lantern in gold (the painted banner where it is
    # packed, guild_props.py)
    bx = (x0 + x1) / 2 + 1.9
    if has('guild_banner'):
        hang(p, 'guild_banner', (bx, FLOOR + 10.2, z0), (0.0, -1.0), 4.4, standoff=0.05)
        return _tower_top(p, p_roof, p_trim, glow, x0, x1, z0, z1, plate)
    p.cylinder((bx - 0.75, FLOOR + 12.3, z0 - 0.22), (bx + 0.75, FLOOR + 12.3, z0 - 0.22), 0.05, PAL['gold'], METAL,
               sides=6)
    flat_face(p, [(bx - 0.6, FLOOR + 12.3, z0 - 0.24), (bx + 0.6, FLOOR + 12.3, z0 - 0.24), (bx + 0.6, FLOOR + 8.4, z0 - 0.24),
                  (bx, FLOOR + 8.0, z0 - 0.24), (bx - 0.6, FLOOR + 8.4, z0 - 0.24)], PAL['blue'], WOOD, (0, 0, -1))
    flat_face(p, [(bx - 0.6, FLOOR + 12.3, z0 - 0.23), (bx - 0.6, FLOOR + 8.4, z0 - 0.23), (bx, FLOOR + 8.0, z0 - 0.23),
                  (bx + 0.6, FLOOR + 8.4, z0 - 0.23), (bx + 0.6, FLOOR + 12.3, z0 - 0.23)], PAL['blue_dark'], WOOD,
              (0, 0, 1))
    for u in (-0.48, 0.48):
        flat_face(p, [(bx + u - 0.04, FLOOR + 12.2, z0 - 0.24 - LAYER), (bx + u + 0.04, FLOOR + 12.2, z0 - 0.24 - LAYER),
                      (bx + u + 0.04, FLOOR + 8.6, z0 - 0.24 - LAYER), (bx + u - 0.04, FLOOR + 8.6, z0 - 0.24 - LAYER)],
                  PAL['gold'], METAL, (0, 0, -1))
    flat_face(p, [(bx - 0.3, FLOOR + 10.0, z0 - 0.24 - LAYER), (bx + 0.3, FLOOR + 10.0, z0 - 0.24 - LAYER),
                  (bx + 0.3, FLOOR + 10.8, z0 - 0.24 - LAYER), (bx - 0.3, FLOOR + 10.8, z0 - 0.24 - LAYER)], PAL['gold'],
              METAL, (0, 0, -1))
    flat_face(p, [(bx - 0.18, FLOOR + 10.12, z0 - 0.24 - 2 * LAYER), (bx + 0.18, FLOOR + 10.12, z0 - 0.24 - 2 * LAYER),
                  (bx + 0.18, FLOOR + 10.66, z0 - 0.24 - 2 * LAYER), (bx - 0.18, FLOOR + 10.66, z0 - 0.24 - 2 * LAYER)],
              PAL['lantern_lit'], METAL, (0, 0, -1))
    _tower_top(p, p_roof, p_trim, glow, x0, x1, z0, z1, plate)


def _tower_top(p, p_roof, p_trim, glow, x0, x1, z0, z1, plate):
    """The tower's quoins, its belfry and the great lantern in it, and its spire."""
    W = TOWER
    # corner quoins up the stone storey
    for (cx, cz) in ((x0, z0), (x1, z0), (x1, z1)):
        v = FOOT
        k = 0
        while v < STONE_TO - 0.05:
            v1 = min(STONE_TO, v + 0.7)
            e = 0.32 if k % 2 else 0.2
            abox(p, cx - e, cx + e, v + 0.02, v1 - 0.02, cz - e, cz + e, tone(PAL['ashlar_hi'], cx, v), STONE)
            v = v1
            k += 1
    # the belfry stage: four corner piers on a cornice, an open arch on each face, the great
    # lantern hung in the middle where the whole yard can see it
    by = plate
    abox(p, x0 - 0.25, x1 + 0.25, by - 0.05, by + 0.45, z0 - 0.25, z1 + 0.25, PAL['ashlar_hi'], STONE)
    abox(p_trim, x0 - 0.27, x1 + 0.27, by + 0.12, by + 0.22, z0 - 0.27, z1 + 0.27, PAL['gold'], METAL)
    top = W['belfry']
    for (cx, cz) in ((x0 + 0.55, z0 + 0.55), (x1 - 0.55, z0 + 0.55), (x1 - 0.55, z1 - 0.55), (x0 + 0.55, z1 - 0.55)):
        abox(p, cx - 0.55, cx + 0.55, by + 0.45, top, cz - 0.55, cz + 0.55, tone(PAL['ashlar'][2], cx, cz), STONE)
    for (wall_x0, wall_z0, wall_x1, wall_z1, out) in ((x0, z0, x1, z0, (0, -1)), (x1, z0, x1, z1, (1, 0)),
                                                       (x0, z1, x1, z1, (0, 1)), (x0, z0, x0, z1, (-1, 0))):
        wl = Wall(wall_x0, wall_z0, wall_x1, wall_z1, out)
        L = wl.length
        span_head = top - 0.5
        spring = span_head - (L - 2.2) / 2
        # the arch over the opening, the sill under it
        r = (L - 2.2) / 2
        um = L / 2
        for i in range(8):
            a0, a1 = math.pi * i / 8, math.pi * (i + 1) / 8
            c0, c1, s0, s1 = math.cos(a0), math.cos(a1), math.sin(a0), math.sin(a1)
            pts = [wl.pt(um - c0 * r, spring + s0 * r, -0.35), wl.pt(um - c1 * r, spring + s1 * r, -0.35),
                   wl.pt(um - c1 * r, top, -0.35), wl.pt(um - c0 * r, top, -0.35),
                   wl.pt(um - c0 * r, spring + s0 * r, 0.25), wl.pt(um - c1 * r, spring + s1 * r, 0.25),
                   wl.pt(um - c1 * r, top, 0.25), wl.pt(um - c0 * r, top, 0.25)]
            hexa(p, pts, tone(PAL['ashlar_hi'], i, wall_x0), STONE)
        wl.box(p, 1.1, L - 1.1, by + 0.45, by + 1.4, -0.3, 0.2, PAL['ashlar'][1], STONE)
        wl.box(p_trim, 1.0, L - 1.0, by + 1.4, by + 1.52, -0.32, 0.22, PAL['iron'], METAL)
    # the great lantern: an iron cage of gilded ribs round a lit core, on a chain from the spire
    cx, cz = W['cx'], W['cz']
    ly0, ly1 = by + 1.0, top - 0.6
    lr = 1.05
    abox(glow, cx - lr, cx + lr, ly0 + 0.3, ly1 - 0.2, cz - lr, cz + lr, PAL['lantern_lit'], GLOW_LANTERN)
    for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        abox(p_trim, cx + sx * (lr + 0.05) - 0.08, cx + sx * (lr + 0.05) + 0.08, ly0 + 0.2, ly1 - 0.1,
             cz + sz * (lr + 0.05) - 0.08, cz + sz * (lr + 0.05) + 0.08, PAL['gold_dark'], METAL)
    for yy in ((ly0 + ly1) / 2,):
        for (a, b, c, d) in ((cx - lr - 0.04, cx + lr + 0.04, cz - lr - 0.06, cz - lr - 0.01),
                             (cx - lr - 0.04, cx + lr + 0.04, cz + lr + 0.01, cz + lr + 0.06),
                             (cx - lr - 0.06, cx - lr - 0.01, cz - lr, cz + lr),
                             (cx + lr + 0.01, cx + lr + 0.06, cz - lr, cz + lr)):
            abox(p_trim, a, b, yy - 0.05, yy + 0.05, c, d, PAL['gold'], METAL)
    abox(p_trim, cx - lr - 0.2, cx + lr + 0.2, ly0 + 0.1, ly0 + 0.3, cz - lr - 0.2, cz + lr + 0.2, PAL['iron'], METAL)
    p_trim.prism((cx, ly1 - 0.2, cz), 4, (lr + 0.3) * 1.414, 0.12, 0.6, PAL['iron'], METAL, axis=(0, 1, 0),
                 phase=math.pi / 4)
    cyl(p_trim, cx, ly1 + 0.4, top + 0.2, cz, 0.05, PAL['iron'], METAL, sides=6)
    # the cornice over the arches and the spire: a steep slate pyramid with a gilded finial and
    # a weathervane (a lantern-and-arrow, our own)
    abox(p, x0 - 0.3, x1 + 0.3, top, top + 0.55, z0 - 0.3, z1 + 0.3, PAL['ashlar_hi'], STONE)
    abox(p_trim, x0 - 0.32, x1 + 0.32, top + 0.18, top + 0.3, z0 - 0.32, z1 + 0.32, PAL['gold'], METAL)
    sy = top + 0.55
    half = (x1 - x0) / 2 + 0.5
    rise = W['spire'] - sy
    slope = math.hypot(half, rise)
    hh, cc = rise / slope, half / slope
    for (e0, along, up) in (((cx - half, sy, cz - half), (1, 0, 0), (0, hh, cc)),
                            ((cx + half, sy, cz - half), (0, 0, 1), (-cc, hh, 0)),
                            ((cx + half, sy, cz + half), (-1, 0, 0), (0, hh, -cc)),
                            ((cx - half, sy, cz + half), (0, 0, -1), (cc, hh, 0))):
        def clip(s0, s1, la=2 * half):
            inset = s1 * cc
            a0, a1 = inset, la - inset
            return [(a0, a1)] if a1 - a0 > 0.1 else None
        slate_roof(p_roof, e0, along, up, 2 * half, slope, seed=61, clip=clip, under=False, step=0.55, seg=1.2)
    for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        p_roof.beam([(cx + sx * half, sy + 0.1, cz + sz * half), (cx, W['spire'] + 0.1, cz)], 0.22, 0.18,
                    PAL['slate_ridge'], SLATE)
    finial(p_trim, cx, W['spire'], cz, h=2.2, r=0.24)
    vy = W['spire'] + 2.0
    p_trim.beam([(cx - 1.1, vy, cz), (cx + 1.0, vy, cz)], 0.06, 0.06, PAL['gold'], METAL)
    flat_face(p_trim, [(cx + 1.0, vy - 0.2, cz), (cx + 1.4, vy, cz), (cx + 1.0, vy + 0.2, cz)], PAL['gold'], METAL,
              (0, 0, -1))
    flat_face(p_trim, [(cx + 1.0, vy - 0.2, cz), (cx + 1.0, vy + 0.2, cz), (cx + 1.4, vy, cz)], PAL['gold'], METAL,
              (0, 0, 1))
    for (a, b, c) in (((cx - 1.1, vy, cz), (cx - 1.5, vy + 0.35, cz), (cx - 1.5, vy - 0.35, cz)),):
        flat_face(p_trim, [a, b, c], PAL['gold_dark'], METAL, (0, 0, -1))
        flat_face(p_trim, [a, c, b], PAL['gold_dark'], METAL, (0, 0, 1))


# ---------------------------------------------------------------------------
# The whole
# ---------------------------------------------------------------------------
def build(parts):
    shell, roof, timber, trim, glow = (parts['GuildShell'], parts['GuildRoof'], parts['G_INT_Timber'],
                                       parts['GuildTrim'], parts['GuildGlow'])
    hall_walls(shell, trim, glow)
    hall_floor(shell, trim)
    hall_roof(roof, timber)
    hall_hearth(shell, trim, glow)
    trophy_hall(shell, roof, trim, glow)
    tower(shell, roof, trim, glow)
    porch(shell, roof, trim, glow)
