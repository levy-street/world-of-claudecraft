"""The Gravewyrm Sanctum kit's natural masses, SCULPTED: glacier ice and
Thornpeak slate (build_gravewyrm_sanctum_kit.py).

Every piece here is a signed-distance field meshed through OpenVDB and
decimated to its budget (gravewyrm_sculpt.py): faceted plane-cut blocks
(ice shears and slate cleaves along planes) smooth-unioned into one mass,
grooved by old crevasses and flutes, weathered by stretched noise (melt
striation runs down the ice, cleavage ridges along the slate's dip), then
painted by part (ice, its dense core, snow, slate) and weathered per vertex
with a baked ambient occlusion (gwkit.GPiece.finish), so creases fall to
the deep blue core and never to grey.

Conventions as the kit's: yards, +Z up, front -Y, origin at the base centre
unless the piece says otherwise.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Ellipsoid, Polyline, RoundBox, Sculpt, block, ice_noise, rot, slate_noise
from gwkit import (
    GLACIER, ICE, ICE_CORE, ICE_MID, ICE_PALE, RIME, ROCK, SLATE, SLATE_DARK, SLATE_LIGHT, SLATE_RUST, SNOW, P,
    add_sculpt, icicles,
)

ICE_COLS = {'ice': GLACIER, 'mid': ICE_MID, 'core': ICE_CORE, 'pale': ICE_PALE, 'snow': RIME, 'rock': SLATE,
            'rockd': SLATE_DARK, 'rustr': SLATE_RUST, 'rockl': SLATE_LIGHT}
ICE_KINDS = {'ice': ICE, 'mid': ICE, 'core': ICE, 'pale': ICE, 'snow': SNOW, 'rock': ROCK, 'rockd': ROCK,
             'rustr': ROCK, 'rockl': ROCK}


def _mesh(bpy, p, f, name, target):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ICE_COLS, ICE_KINDS)


def _snow_pillows(f, rng, x0, x1, y, z, depth, n, size=(4.0, 1.6), lean=0.0):
    for k in range(n):
        x = x0 + (x1 - x0) * (k + rng.uniform(0.2, 0.8)) / n
        f.put('snow', Ellipsoid((x, y + rng.uniform(-depth * 0.2, depth * 0.2), z + rng.uniform(-0.3, 0.3)),
                                (size[0] * rng.uniform(0.8, 1.2), depth, size[1] * rng.uniform(0.7, 1.1)),
                                rot(rx=lean)), 0.8)


# ================================================================ the glacier
def glacier_wall(bpy, variant):
    """A module of the glacier's cliff (30 wide, front -Y, 15 deep): tall
    sheared ice columns stepped in and out round a dense deep-blue core,
    vertical crevasse grooves between them, shear notches across them, a white
    crust and an overhanging cornice on top with icicles under it, fallen
    blocks at the foot. A: 48 tall and sheer. B: 38 tall and broken, a
    detached serac leaning out and a dark hollow at its foot. Tiles along X
    (its ends run 1.5 past +-15 to overlap)."""
    seed = 3 if variant == 'A' else 9
    p = P('GlacierWall' + variant, frost=0.7, seed=seed, depth=1.4, ao_dist=6.0)
    rng = np.random.default_rng(seed)
    H = 48.0 if variant == 'A' else 38.0
    f = Sculpt((-17.5, -9, -1.5), (17.5, 16, H + 4), 0.3)
    f.put('core', block(rng, (0, 8, H / 2), (33, 14, H), cuts=0), 0.5)
    x = -16.0
    k = 0
    while x < 16.5:
        w = rng.uniform(2.4, 4.6)
        y = rng.uniform(-1.4, 2.4)
        h = H * rng.uniform(0.84, 1.0)
        if variant == 'B' and k % 3 == 1:
            h *= rng.uniform(0.6, 0.8)
        lab = ['ice', 'mid', 'ice', 'pale'][k % 4]
        f.put(lab, block(rng, (x, y, h / 2), (w, 7, h), cuts=5, top_tilt=0.45,
                         R=rot(rx=rng.uniform(-0.03, 0.03), ry=rng.uniform(-0.03, 0.03), rz=rng.uniform(-0.1, 0.1))),
              0.7)
        # The groove beside it, an old crevasse closed up.
        f.groove(Polyline([(x + w / 2, y - 3.6, 0.5), (x + w / 2 + rng.uniform(-0.4, 0.4), y - 3.6, h * 0.95)], 0.05),
                 1.2, 0.55)
        x += w * 0.92
        k += 1
    # Shear notches across the face, blocks jutting from them.
    for k in range(5):
        z = rng.uniform(H * 0.2, H * 0.8)
        f.sub(RoundBox((rng.uniform(-12, 12), -4.0, z), (rng.uniform(3, 6), 1.2, 0.5), 0.3, rot(ry=rng.uniform(-0.2, 0.2))),
              0.4)
        f.put('mid', block(rng, (rng.uniform(-12, 12), -3.8, z - 1.2), (rng.uniform(2.5, 4.5), 2.4, 2.0), cuts=4), 0.4)
    if variant == 'B':
        f.put('mid', block(rng, (6.5, -6.0, H * 0.42), (5.0, 4.2, H * 0.84), cuts=6, top_tilt=0.6,
                           R=rot(rx=0.12, ry=0.04)), 0.6)
        f.sub(Ellipsoid((-6, -3.0, 4), (5.0, 3.6, 6.0)), 1.0)
    for k in range(10):
        s = rng.uniform(1.6, 4.2)
        f.put('ice', block(rng, (rng.uniform(-14, 14), rng.uniform(-7, -3.6), s * 0.35), (s * 1.3, s, s * 0.9), cuts=5,
                           R=rot(rz=rng.uniform(0, 6), rx=rng.uniform(-0.3, 0.3))), 0.3)
    # The crust and the cornice.
    _snow_pillows(f, rng, -16, 16, 2.0, H + 0.3, 5.5, 8, (4.4, 1.8))
    _snow_pillows(f, rng, -15, 15, -2.6, H - 0.4, 2.0, 7, (3.6, 1.3), lean=-0.3)
    ice_noise(f, seed, amp=0.5, stria=0.6, scale=1.4)
    _mesh(bpy, p, f, 'GlacierWall' + variant, 7000)
    icicles(p, [(rng.uniform(-14.5, 14.5), -4.2 + rng.uniform(-0.4, 0.4), H - 1.4) for _ in range(18)], 4.0, 0.28)
    return p


def ice_fall(bpy):
    """An icefall (26 wide, 40 tall, 46 deep, climbing toward +Y): a frozen
    cascade of sheared serac blocks stepping down a ramp of deep ice, snow
    on every tread, the gaps between the blocks blue to black. Origin at the
    foot's front centre."""
    p = P('IceFall', frost=0.7, seed=4, depth=1.2, ao_dist=7.0)
    rng = np.random.default_rng(4)
    f = Sculpt((-15, -6, -2), (15, 50, 44), 0.4)
    ang = math.atan2(40, 46)
    f.put('core', block(rng, (0, 26, 12), (28, 56, 24), cuts=0, R=rot(rx=ang)), 1.0)
    for row in range(8):
        y = row * 5.6
        z = row * 4.9
        for k in range(6):
            x = -11 + k * 4.4 + rng.uniform(-1.2, 1.2) + (row % 2) * 2
            if abs(x) > 12.5:
                continue
            s = rng.uniform(3.8, 6.4)
            lab = ['ice', 'mid', 'pale'][(row + k) % 3]
            f.put(lab, block(rng, (x, y + rng.uniform(-1, 1), z + s * 0.45), (s, s * 0.9, s * 1.3), cuts=6, top_tilt=0.5,
                             R=rot(rz=rng.uniform(-0.5, 0.5), rx=rng.uniform(-0.35, 0.1))), 0.5)
            if rng.random() < 0.75:
                f.put('snow', Ellipsoid((x, y + 0.6, z + s * 1.05), (s * 0.5, s * 0.45, 0.55)), 0.5)
    ice_noise(f, 4, amp=0.5, stria=0.8, scale=1.3)
    _mesh(bpy, p, f, 'IceFall', 8000)
    return p


def serac(bpy, size):
    """An ice tower of the Serac Field (S 9, M 16, L 26 yd: the L the size of
    a chapel): a leaning sheared mass with a secondary fin and a buttress,
    split by a crevasse, an overhanging cap fused to its top under a snow
    crown, blue from inside (every crease falls to the dense core), icicles,
    fallen blocks at its foot."""
    H = {'S': 9.0, 'M': 16.0, 'L': 26.0}[size]
    seed = ord(size)
    p = P('Serac' + size, frost=0.75, seed=seed, depth=1.5, ao_dist=H * 0.25)
    rng = np.random.default_rng(seed)
    R = H * 0.24
    f = Sculpt((-R * 2.6, -R * 2.6, -1), (R * 2.6, R * 2.6, H * 1.15), max(0.12, H / 110))
    f.put('ice', block(rng, (0, 0, H * 0.48), (R * 2.1, R * 1.8, H * 0.98), cuts=8, top_tilt=0.5,
                       R=rot(rx=-0.06, ry=0.05)), R * 0.15)
    f.put('mid', block(rng, (R * 1.0, R * 0.55, H * 0.36), (R * 1.3, R * 1.2, H * 0.72), cuts=7, top_tilt=0.7,
                       R=rot(ry=0.1, rz=0.4)), R * 0.2)
    f.put('pale', block(rng, (-R * 0.95, R * 0.4, H * 0.27), (R * 1.0, R * 1.1, H * 0.54), cuts=7, top_tilt=0.7,
                        R=rot(ry=-0.14, rz=-0.3)), R * 0.2)
    # The broken crest: sheared blocks tipped every way, one leaning out
    # over the front.
    for (cx, cy, cz, w, h, rx, ry) in ((-R * 0.4, -R * 0.5, H * 0.94, R * 1.2, H * 0.22, -0.32, 0.1),
                                       (R * 0.5, -R * 0.1, H * 0.9, R * 1.0, H * 0.16, 0.15, -0.3),
                                       (-R * 0.1, R * 0.5, H * 0.92, R * 1.1, H * 0.12, 0.2, 0.25)):
        f.put('pale' if cz > H * 0.93 else 'ice', block(rng, (cx, cy, cz), (w, w * 0.9, h), cuts=7, top_tilt=0.8,
                                                     R=rot(rx=rx, ry=ry, rz=rng.uniform(0, 1))), R * 0.06)
    # The crevasse splitting it, from the crest down to two thirds.
    f.sub(RoundBox((R * 0.12, -R * 0.4, H * 0.66), (R * 0.12, R * 1.4, H * 0.36), R * 0.05, rot(ry=0.07)), R * 0.06)
    f.groove(Polyline([(-R * 0.6, -R * 0.95, H * 0.1), (-R * 0.5, -R * 0.95, H * 0.85)], 0.05), R * 0.12, R * 0.08)
    for k in range(6):
        s = R * rng.uniform(0.35, 0.75)
        a = rng.uniform(0, 6.28)
        f.put('ice', block(rng, (math.cos(a) * R * 1.6, math.sin(a) * R * 1.4, s * 0.3), (s, s * 0.8, s * 0.7), cuts=5,
                           R=rot(rz=a, rx=rng.uniform(-0.3, 0.3))), s * 0.1)
    f.put('snow', Ellipsoid((R * 0.3, R * 0.2, H * 0.99), (R * 0.7, R * 0.6, H * 0.03 + 0.2), rot(rx=0.15)), R * 0.1)
    f.put('snow', Ellipsoid((R * 1.0, R * 0.55, H * 0.73), (R * 0.55, R * 0.5, 0.3)), R * 0.1)
    ice_noise(f, seed, amp=0.12 * R, stria=0.12 * R, scale=max(0.6, R / 3))
    _mesh(bpy, p, f, 'Serac' + size, {'S': 2400, 'M': 3600, 'L': 5200}[size])
    icicles(p, [(rng.uniform(-R, R), -R * 1.3, H * 0.84) for _ in range(int(4 + H / 3))], H * 0.1, R * 0.07)
    return p


def ice_bridge(bpy):
    """A natural ice arch over a crevasse (26 yd span along X, deck 6 wide):
    the walking surface lies at the origin, flat (z 0) under packed snow;
    the arch beneath is a sheared bow of blue ice thickening into abutments
    that run down into the crevasse to -40, its flanks fluted, icicles under
    it."""
    p = P('IceBridge', frost=0.6, seed=12, depth=1.0, ao_dist=4.0)
    rng = np.random.default_rng(12)
    f = Sculpt((-22, -6, -42), (22, 6, 1), 0.3)
    f.put('ice', block(rng, (0, 0, -20), (40, 6.2, 40), cuts=0), 0.5)
    for s in (-1, 1):
        f.put('mid', block(rng, (s * 18, 0, -22), (8, 8.4, 40), cuts=6), 1.2)
    f.sub(Ellipsoid((0, 0, -36), (14.5, 9, 33)), 1.5)
    for s in (-1, 1):
        for k in range(7):
            x = -13 + k * 4.3 + rng.uniform(-0.8, 0.8)
            f.groove(Polyline([(x, s * 3.1, -1.5), (x + rng.uniform(-1, 1), s * 3.4, -12)], 0.05), 0.5, 0.35)
    ice_noise(f, 12, amp=0.4, stria=0.6)
    f.cut_above(-0.3)
    _mesh(bpy, p, f, 'IceBridge', 4200)
    with p.as_kind(SNOW):
        p.box((0, 0, -0.16), (27, 5.6, 0.32), RIME)
        for s in (-1, 1):
            for k in range(9):
                p.smooth(p.rock((-13 + k * 3.25, s * 2.85, -0.2), (3.6, 1.1, 0.5), RIME, jitter=0.1, subdivisions=1))
    icicles(p, [(rng.uniform(-10, 10), rng.uniform(-2.6, 2.6), -2.4) for _ in range(20)], 3.0, 0.2)
    return p


def crevasse_edge(bpy, variant):
    """A 8 yd ice lip on a glacier terrace's edge, the crevasse wall falling
    to -64 toward -Y: A sheer and fluted, B stepped in ledges, C a snow
    cornice over the lip and a split. Its ends are flat (tiles along X);
    nothing above 0.45 or past the lip by more."""
    seed = ord(variant) * 3
    p = P('CrevasseEdge' + variant, frost=0.6, seed=seed, depth=2.0, ao_dist=3.0)
    rng = np.random.default_rng(seed)
    f = Sculpt((-4.4, -3.2, -66), (4.4, 3.4, 1.0), 0.2)
    f.put('ice', block(rng, (0, 1.4, -32), (8.6, 3.4, 64), cuts=0), 0.3)
    x = -4.0
    while x < 4.2:
        r = rng.uniform(0.3, 0.6)
        pts = [(x + rng.uniform(-0.15, 0.15), -0.55 - r * 0.3, z) for z in np.linspace(-65, 0.5, 6)]
        f.sub(Polyline(pts, r), 0.25)
        x += rng.uniform(0.9, 1.6)
    if variant == 'B':
        for z in (-38.0, -18.0):
            f.put('mid', block(rng, (0, -0.6, z), (8.6, 1.8, 1.6), cuts=4), 0.3)
            f.put('snow', Ellipsoid((rng.uniform(-1, 1), -0.8, z + 0.85), (4.4, 0.8, 0.35)), 0.3)
    if variant == 'C':
        for k in range(4):
            f.put('snow', Ellipsoid((-3 + k * 2.0, -0.2, -0.1), (1.5, 0.75, 0.55)), 0.4)
        f.sub(RoundBox((0.8, -0.3, -20), (0.18, 1.2, 22), 0.05, rot(ry=0.06)), 0.1)
    ice_noise(f, seed, amp=0.25, stria=0.5, scale=0.8)
    f.cut_above(0.28 if variant == 'C' else 0.0)
    _mesh(bpy, p, f, 'CrevasseEdge' + variant, 1000)
    return p


def frozen_fall(bpy):
    """A frozen waterfall hanging off a slate lip (origin on the lip): fused
    fluted columns of pale ice bulging out and down 30 yd over a slate face,
    a frozen splash cone at its foot, snow on the lip."""
    p = P('FrozenFall', frost=0.6, seed=15, depth=0.8, ao_dist=3.0)
    rng = np.random.default_rng(15)
    f = Sculpt((-10, -7, -33), (10, 6, 2.5), 0.22)
    for k in range(6):
        f.put('rock', block(rng, (-7.5 + k * 3.0, 1.8, -0.6), (3.2, 4.0, 2.6), cuts=6,
                            R=rot(rz=rng.uniform(-0.2, 0.2), rx=0.2)), 0.3)
        f.put('rockd', block(rng, (-8.5 + k * 3.4, 3.0, -16), (3.6, 3.0, 32), cuts=4,
                             R=rot(rz=rng.uniform(-0.1, 0.1))), 0.3)
    for k in range(16):
        x = -5 + k * 0.66 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.4, 0.85)
        bulge = 1.6 * math.exp(-((x - 0.5) / 3.5) ** 2)
        pts, rad = [], []
        for j in range(9):
            t = j / 8
            pts.append((x + 0.2 * math.sin(t * 7 + k), -0.2 - bulge * math.sin(math.pi * t) - 0.5 * t, -t * 30))
            rad.append(r * (0.7 + 0.8 * t))
        f.put(['pale', 'ice', 'pale'][k % 3], Polyline(pts, rad), 0.45)
    f.put('ice', Ellipsoid((0.5, -2.6, -30.5), (6.5, 3.8, 2.8)), 1.0)
    f.put('snow', Ellipsoid((0, 2.0, 0.8), (8.5, 2.6, 0.6)), 0.5)
    ice_noise(f, 15, amp=0.15, stria=0.4, scale=0.7)
    _mesh(bpy, p, f, 'FrozenFall', 6500)
    icicles(p, [(rng.uniform(-6, 6), -1.0 - rng.uniform(0, 1.2), -rng.uniform(1, 18)) for _ in range(20)], 3.0, 0.2)
    return p


# ================================================================== the rock
def _slate_piece(bpy, name, seed, bounds, voxel, slabs, snow, target, frost=0.65, top=None):
    p = P(name, frost=frost, seed=seed, ao_dist=None)
    rng = np.random.default_rng(seed)
    f = Sculpt(bounds[0], bounds[1], voxel)
    for (lab, c, size, R, k, cuts) in slabs(rng):
        f.put(lab, block(rng, c, size, cuts=cuts, R=R, top_tilt=0.3), k)
    for (c, r, R) in snow(rng):
        f.put('snow', Ellipsoid(c, r, R), min(r) * 0.6)
    slate_noise(f, seed, amp=0.18 * voxel / 0.1, scale=max(0.5, voxel / 0.1))
    if top is not None:
        f.cut_above(top)
    _mesh(bpy, p, f, name, target)
    return p, rng


def thornpeak_rock(bpy, variant):
    """Thornpeak slate: A a boulder of three cleaved slabs leaning together
    (3.5 yd), B a cluster of four frost-split blocks, C a split fin 4.5 yd
    tall with ice in its joint; snow on every ledge."""
    seed = ord(variant) * 7
    if variant == 'A':
        def slabs(rng):
            return [(['rock', 'rockd', 'rock'][k], (k * 0.9 - 0.9, k * 0.3, 1.3 + k * 0.1), (1.3, 3.2, 3.0 - k * 0.3),
                     rot(ry=0.5, rz=0.3), 0.15, 6) for k in range(3)]

        def snow(rng):
            return [((0.3, 0.2, 2.75), (1.2, 1.2, 0.3), rot(ry=0.3))]
        return _slate_piece(bpy, 'ThornpeakRockA', seed, ((-3, -3, -0.5), (3, 3, 4)), 0.07, slabs, snow, 1800)[0]
    if variant == 'B':
        spots = ((-1.4, -0.6, 1.6), (0.6, 0.2, 2.0), (1.8, -1.4, 1.1), (-0.3, 1.6, 1.3))

        def slabs(rng):
            return [(['rock', 'rockd', 'rustr', 'rock'][k], (x, y, s * 0.4), (s * 1.3, s, s * 0.9),
                     rot(rz=rng.uniform(0, 6), ry=rng.uniform(-0.3, 0.3)), 0.08, 7) for k, (x, y, s) in enumerate(spots)]

        def snow(rng):
            return [((x, y, s * 0.85), (s * 0.45, s * 0.38, 0.18), None) for (x, y, s) in spots]
        return _slate_piece(bpy, 'ThornpeakRockB', seed, ((-3.2, -3.2, -0.5), (3.2, 3.2, 2.5)), 0.07, slabs, snow,
                            1800)[0]

    def slabs(rng):
        out = [('rock', (-0.55, 0, 2.3), (1.1, 2.5, 4.7), rot(ry=-0.12), 0.05, 6),
               ('rockd', (0.62, 0.2, 2.0), (1.0, 2.3, 4.1), rot(ry=0.15, rz=0.1), 0.05, 6),
               ('pale', (0.05, -0.1, 1.8), (0.3, 1.8, 3.6), None, 0.05, 2)]
        for k in range(4):
            out.append(('rockl', (rng.uniform(-1.8, 1.8), rng.uniform(-1.8, 1.8), 0.2), (0.8, 0.6, 0.5),
                        rot(rz=rng.uniform(0, 6)), 0.05, 6))
        return out

    def snow(rng):
        return [((-0.5, 0, 4.3), (0.45, 1.0, 0.2), None)]
    return _slate_piece(bpy, 'ThornpeakRockC', seed, ((-2.6, -2.6, -0.5), (2.6, 2.6, 5.2)), 0.06, slabs, snow,
                        1800)[0]


def thornpeak_crag(bpy):
    """A crag of Thornpeak slate (10 x 8, 11 tall): leaning cleaved fins,
    broken ledges heaped with snow, frozen seeps down the joints, rubble at
    the foot."""
    def slabs(rng):
        out = []
        for k in range(7):
            x = -3.6 + k * 1.2 + rng.uniform(-0.3, 0.3)
            h = rng.uniform(6, 11) * (1 - abs(x) / 9)
            out.append((['rock', 'rockd', 'rock', 'rustr'][k % 4], (x, rng.uniform(-1, 1), h / 2),
                        (1.6, rng.uniform(4, 6), h), rot(ry=0.22 + rng.uniform(-0.06, 0.06), rz=rng.uniform(-0.15, 0.15)),
                        0.12, 6))
        for k in range(4):
            out.append(('rockl', (rng.uniform(-3, 3), -1.8, rng.uniform(2, 8)), (2.6, 2.4, 0.8),
                        rot(rz=rng.uniform(-0.3, 0.3)), 0.1, 5))
        for k in range(9):
            s = rng.uniform(0.6, 1.6)
            out.append(('rock', (rng.uniform(-4.5, 4.5), rng.uniform(-3.8, -2), s * 0.3), (s, s * 0.8, s * 0.6),
                        rot(rz=rng.uniform(0, 6), rx=rng.uniform(-0.4, 0.4)), 0.05, 6))
        for k in range(3):
            x = -2 + k * 2.1
            out.append(('pale', (x, -2.8, 4.5 - k * 0.5), (0.7, 0.6, 8.6 - k), rot(ry=0.05), 0.2, 3))
        return out

    def snow(rng):
        return [((0, 0, 9.7), (1.6, 2.4, 0.45), None)] + [((rng.uniform(-3, 3), -1.9, rng.uniform(3, 8.5)),
                                                             (1.1, 1.0, 0.25), None) for _ in range(4)]
    p, rng = _slate_piece(bpy, 'ThornpeakCrag', 31, ((-6, -5.5, -0.5), (6, 5, 12)), 0.13, slabs, snow, 4200)
    icicles(p, [(rng.uniform(-3, 3), -3.0, rng.uniform(4, 9)) for _ in range(6)], 1.2, 0.1)
    return p


def moraine_rocks(bpy):
    """Moraine rubble (a band 10 x 6, mostly under knee high): slate blocks
    of every size half sunk in old snow."""
    def slabs(rng):
        out = []
        for k in range(22):
            s = rng.uniform(0.35, 1.5) if k > 2 else rng.uniform(1.5, 2.3)
            out.append((['rock', 'rockd', 'rustr', 'rockl'][k % 4],
                        (rng.uniform(-4.8, 4.8), rng.uniform(-2.6, 2.6), s * 0.2), (s * 1.3, s, s * 0.8),
                        rot(rz=rng.uniform(0, 6), ry=rng.uniform(-0.35, 0.35), rx=rng.uniform(-0.3, 0.3)), 0.04, 6))
        return out

    def snow(rng):
        return [((0, 0, -0.35), (5.6, 3.4, 0.55), None)]
    return _slate_piece(bpy, 'MoraineRocks', 33, ((-6.2, -4, -1), (6.2, 4, 2.4)), 0.08, slabs, snow, 2400)[0]


def rock_cliff(bpy):
    """A slate cliff run (16 yd along X) for the terrace drops: the lip at z 0
    and nothing above it, a face of vertical cleaved ribs falling to -64
    toward -Y, ledges holding snow, frozen seeps down the joints. Its ends
    run flat for tiling."""
    def slabs(rng):
        out = [('rockd', (0, 2.8, -32), (16.4, 4.4, 64), None, 0.3, 0)]
        x = -8.0
        k = 0
        while x < 8.3:
            w = rng.uniform(1.4, 2.6)
            top = -rng.uniform(0.0, 1.2)
            out.append((['rock', 'rockd', 'rock', 'rustr'][k % 4], (x, rng.uniform(-0.5, 0.6), (top - 64) / 2),
                        (w, 2.6, 64 + top), rot(ry=rng.uniform(-0.03, 0.03), rz=rng.uniform(-0.08, 0.08)), 0.2, 4))
            x += w * 0.9
            k += 1
        for k in range(6):
            out.append(('rockl', (rng.uniform(-6, 6), -1.4, -rng.uniform(6, 56)), (rng.uniform(2.4, 4), 1.8, 0.8),
                        rot(rz=rng.uniform(-0.2, 0.2)), 0.15, 4))
        for k in range(3):
            x = rng.uniform(-6, 6)
            out.append(('pale', (x, -1.4, -32), (0.8, 0.9, 62), rot(ry=rng.uniform(-0.03, 0.03)), 0.3, 3))
        return out

    def snow(rng):
        return [((rng.uniform(-6, 6), -1.6, -rng.uniform(6, 56)), (1.2, 0.8, 0.22), None) for _ in range(6)]
    return _slate_piece(bpy, 'RockCliff', 35, ((-8.4, -3, -66), (8.4, 5.2, 1.0)), 0.25, slabs, snow, 1600,
                        top=0.0)[0]


# ============================================================ shared masses
def slate_mass(bpy, p, name, seed, bounds, voxel, blocks, subs=(), target=4000, top=None, snow=()):
    """Sculpt a mass of cleaved slate into a piece that also carries dressed
    parts (a portal, a panel): blocks (label, centre, size, R, k, cuts),
    subtractions (prims carved out: an opening), snow pillows."""
    rng = np.random.default_rng(seed)
    f = Sculpt(bounds[0], bounds[1], voxel)
    for (lab, c, size, R, k, cuts) in blocks:
        f.put(lab, block(rng, c, size, cuts=cuts, R=R, top_tilt=0.25), k)
    for (c, r, R) in snow:
        f.put('snow', Ellipsoid(c, r, R), min(r) * 0.6)
    slate_noise(f, seed, amp=0.18 * voxel / 0.1, scale=max(0.5, voxel / 0.1))
    for prim in subs:
        f.sub(prim, 0.15)
    if top is not None:
        f.cut_above(top)
    _mesh(bpy, p, f, name, target)
    return rng


def ice_wall_shard(bpy, i, seeds, cell_fn, half, height, thick):
    """One shard of the ice wall gate (the wall's base centre is every shard's
    origin): its convex cell of the wall as planes (the cell's edges, the
    front and back), a bulging faceted front, sharp shared edges a hair
    apart, melt striation, rime on its top edge, a dark fracture through it."""
    letter = 'ABCDEFG'[i]
    p = P('IceWall_' + letter, frost=0.6, seed=90 + i, depth=0.6, ao_dist=2.0)
    rng = np.random.default_rng(90 + i)
    poly = cell_fn(i)
    cx = sum(q[0] for q in poly) / len(poly)
    cz = sum(q[1] for q in poly) / len(poly)
    N, D = [], []
    for k in range(len(poly)):
        (x0, z0), (x1, z1) = poly[k], poly[(k + 1) % len(poly)]
        ex, ez = x1 - x0, z1 - z0
        nx, nz = ez, -ex
        L = math.hypot(nx, nz) or 1.0
        nx, nz = nx / L, nz / L
        if (cx - x0) * nx + (cz - z0) * nz > 0:
            nx, nz = -nx, -nz
        N.append((nx, 0.0, nz))
        D.append((x0 - cx) * nx + (z0 - cz) * nz - 0.03)
    N += [(0, 1, 0)]
    D += [thick / 2]
    # The front: three facets leaning out, so it bulges toward -Y.
    for a in range(3):
        ang = a * 2.1 + i
        n = np.array((math.cos(ang) * 0.35, -1.0, math.sin(ang) * 0.35))
        n /= np.linalg.norm(n)
        N.append(tuple(n))
        D.append(thick / 2 + 0.35 + 0.2 * rng.random())
    f = Sculpt((cx - 8, -thick - 1.5, -1), (cx + 8, thick + 1.5, height + 2), 0.12)
    prim = gs.Planes((cx, 0.0, cz), N, D)
    f.put('ice', prim, 0.0)
    f.groove(Polyline([(cx - 1.5, -thick / 2 - 0.6, cz - 1.2), (cx + 0.4, -thick / 2 - 0.6, cz + 0.2),
                       (cx + 1.4, -thick / 2 - 0.6, cz + 1.4)], 0.03), 0.35, 0.15)
    top = max(z for (_, z) in poly)
    if top > height - 0.1:
        xs = [x for (x, z) in poly if z > height - 0.2]
        f.put('snow', Ellipsoid(((min(xs) + max(xs)) / 2, 0.0, height + 0.05),
                                (max(0.6, (max(xs) - min(xs)) * 0.45), thick * 0.55, 0.32)), 0.15)
    ice_noise(f, 90 + i, amp=0.12, stria=0.25, scale=0.6, band=0.6)
    _mesh(bpy, p, f, 'IceWall' + letter, 900)
    return p


def ice_chunk(bpy, variant):
    """A broken plate's chunk riding the water (origin at the waterline): A a
    big slab tipped 15 degrees (7 x 5), B a medium slab (4 x 3), C a cluster
    of bits; clear blue edges, the upper face frosted."""
    seed = ord(variant) * 5
    p = P('IceChunk' + variant, frost=0.3, seed=seed, depth=0.4, ao_dist=1.2)
    rng = np.random.default_rng(seed)
    f = Sculpt((-5, -4, -2), (5, 4, 2.2), 0.08)
    if variant == 'A':
        f.put('pale', block(rng, (0, 0, -0.1), (7, 5, 1.3), cuts=7, R=rot(ry=0.26)), 0.05)
    elif variant == 'B':
        f.put('pale', block(rng, (0, 0, -0.2), (4, 3, 1.1), cuts=7, R=rot(rx=-0.16, ry=0.1)), 0.05)
    else:
        for k in range(6):
            s = rng.uniform(0.8, 1.8)
            f.put('pale' if k % 2 else 'ice', block(rng, (rng.uniform(-2, 2), rng.uniform(-2, 2), -0.2),
                                                    (s, s * 0.8, s * 0.5), cuts=6,
                                                    R=rot(rz=rng.uniform(0, 6), rx=rng.uniform(-0.4, 0.4))), 0.03)
    ice_noise(f, seed, amp=0.05, stria=0.05, scale=0.4, band=0.4)
    _mesh(bpy, p, f, 'IceChunk' + variant, 700)
    return p


def melt_banks(bpy, p):
    """The melt channel's cut banks (sculpted into MeltChannel)."""
    rng = np.random.default_rng(73)
    f = Sculpt((-4.2, -4.4, -1.6), (4.2, 4.4, 0.4), 0.09)
    for s in (-1, 1):
        f.put('ice', block(rng, (0, s * 2.75, -0.75), (8.6, 3.1, 1.5), cuts=0), 0.05)
        for k in range(9):
            x = -3.8 + k * 0.95
            f.sub(Ellipsoid((x, s * 1.22, -0.6), (0.45, 0.16, 0.7)), 0.05)
    f.put('core', block(rng, (0, 0, -1.45), (8.6, 2.6, 0.3), cuts=0), 0.05)
    ice_noise(f, 73, amp=0.06, stria=0.1, scale=0.5, band=0.5)
    f.cut_above(0.0)
    _mesh(bpy, p, f, 'MeltBanks', 1100)


def chain_bridge_crust(bpy, p, half, reach):
    """The Chain Bridge's frozen crust: packed rime and ice lumps over the
    chain, flat on top at z 0, lumpy on its flanks, slotted where the
    standing links' worn tops run through the deck as strips of iron
    (this module's link, and the tail of the next one's). half: the
    module's half length; reach: how far a standing link runs past its
    module's start."""
    rng = np.random.default_rng(55)
    f = Sculpt((-half - 0.4, -3.8, -3.4), (half + 0.4, 3.8, 0.6), 0.1)
    f.put('snow', block(rng, (0, 0, -0.85), (half * 2 + 0.05, 5.3, 1.7), cuts=0), 0.05)
    for s in (-1, 1):
        x = -half
        while x < half:
            w = rng.uniform(0.7, 1.6)
            f.put('ice' if rng.random() < 0.5 else 'pale',
                  Ellipsoid((x + w * 0.5, s * rng.uniform(2.3, 2.75), -rng.uniform(0.9, 1.8)),
                            (w, rng.uniform(0.45, 0.8), rng.uniform(0.8, 1.5)), rot(ry=rng.uniform(-0.5, 0.5))), 0.5)
            x += w * rng.uniform(0.9, 1.5)
    ice_noise(f, 55, amp=0.08, stria=0.1, scale=0.5, band=0.6)
    f.cut_above(0.0)
    a0 = half / 2 - reach
    f.sub(RoundBox(((a0 + half + 0.4) / 2, 0, -0.2), ((half + 0.4 - a0) / 2, 0.8, 1.3), 0.05), 0.02)
    f.sub(RoundBox((-half - 0.4 + (reach - half / 2 + 0.4) / 2, 0, -0.2), ((reach - half / 2 + 0.4) / 2 + 0.01, 0.8, 1.3),
                   0.05), 0.02)
    _mesh(bpy, p, f, 'BridgeCrust', 1600)


# ============================================================ sculpted props
PROP_COLS = {'iron': (0.19, 0.2, 0.23), 'ironl': (0.3, 0.31, 0.34), 'leather': (0.3, 0.22, 0.16), 'snow': RIME,
             'hide': (0.5, 0.4, 0.3), 'fur': (0.42, 0.35, 0.27), 'furd': (0.25, 0.2, 0.17), 'soot': (0.08, 0.075, 0.07),
             'furp': (0.6, 0.54, 0.45)}


def _prop_kinds():
    from gwkit import IRON, PAINT
    return {'iron': IRON, 'ironl': IRON, 'leather': PAINT, 'snow': SNOW, 'hide': PAINT, 'fur': PAINT, 'furd': PAINT,
            'soot': PAINT, 'furp': PAINT}


def smiths_hammer_sculpt(bpy, p, hz=1.5):
    """The Smith's hammer as one forged mass: a long head with flared
    octagonal striking faces ringed by forge grooves, a wedged collar and
    square bosses, the haft banded in iron to a leather grip and a ringed
    pommel, rime and snow drifted on and against it."""
    from jaguar_head_sculpt import Torus
    f = Sculpt((-4.0, -13.2, -0.8), (4.0, 3.2, 3.8), 0.07)
    f.put('iron', RoundBox((0, 0, hz), (2.05, 1.18, 1.18), 0.25), 0.1)
    oct_n = [(0.0, math.cos(a), math.sin(a)) for a in [math.pi / 8 + k * math.pi / 4 for k in range(8)]]
    for s in (-1, 1):
        N = oct_n + [(1.0, 0, 0), (-1.0, 0, 0)]
        D = [1.42] * 8 + [0.55, 0.55]
        f.put('ironl', gs.Planes((s * 2.45, 0, hz), N, D), 0.12)
        f.put('ironl', Ellipsoid((s * 2.95, 0, hz), (0.25, 1.2, 1.2)), 0.15)
        for x in (1.75, 2.05):
            f.groove(Polyline([(s * x, math.cos(a) * 1.45, hz + math.sin(a) * 1.45)
                               for a in np.linspace(0, math.tau, 25)], 0.02), 0.12, 0.06)
        for (y, z) in ((0, 1.2), (0, -1.2), (1.2, 0), (-1.2, 0)):
            f.put('ironl', RoundBox((s * 1.0, y, hz + z), (0.42, 0.16 if y else 0.42, 0.42 if y else 0.16), 0.05), 0.05)
    f.put('iron', RoundBox((0, 0, hz), (0.7, 1.42, 1.42), 0.12), 0.08)
    for (y, z) in ((1.45, 0), (-1.45, 0), (0, 1.45), (0, -1.45)):
        f.put('ironl', RoundBox((0, y, hz + z), (0.55, 0.12 if y else 0.5, 0.5 if y else 0.12), 0.04), 0.04)
    # The haft, its bands, the grip, the pommel.
    a, b = np.array((0, -1.2, hz)), np.array((0, -11.4, 0.6))
    f.put('iron', gs.RoundCone(a, b, 0.48, 0.42), 0.1)
    for t in (0.04, 0.3, 0.62):
        q = a + (b - a) * t
        f.put('ironl', gs.RoundCone(q - (b - a) * 0.012, q + (b - a) * 0.012, 0.6, 0.6), 0.04)
    for k in range(10):
        t = 0.7 + k * 0.026
        q = a + (b - a) * t
        f.put('leather', gs.RoundCone(q - (b - a) * 0.011, q + (b - a) * 0.011, 0.5, 0.5), 0.05)
    f.put('ironl', Ellipsoid(b + (b - a) * 0.03, (0.62, 0.55, 0.62)), 0.1)
    f.put('iron', Torus(b + (b - a) * 0.075, 0.42, 0.1, (b - a)), 0.03)
    # Rime and drifted snow.
    f.put('snow', Ellipsoid((0.2, 0.0, hz + 1.25), (2.0, 0.9, 0.22)), 0.2)
    f.put('snow', Ellipsoid((1.0, 1.7, 0.3), (2.4, 1.0, 0.7)), 0.5)
    f.put('snow', Ellipsoid((-1.4, -1.8, 0.2), (1.2, 0.8, 0.45)), 0.4)
    n1 = gs.Noise(43)
    f.displace(lambda X, Y, Z: 0.03 * n1.fbm(X * 3, Y * 3, Z * 3, 2), band=0.3)
    verts, faces = gs.mesh_sculpt(f, bpy, 'Hammer', 7000)
    add_sculpt(p, f, verts, faces, PROP_COLS, _prop_kinds())


def cult_tent_sculpt(bpy, p):
    """The cult tent's hides as one sculpted shell: two roof panels of hide
    and fur in an A-frame, a closed back, a front with its door flaps tied
    back on the dark inside, wrinkled and sagging, fur rolls weighting the
    skirt, soot round the smoke hole."""
    f = Sculpt((-3.3, -3.3, -0.3), (3.3, 3.3, 4.7), 0.05)
    nl = (-0.857, 0.0, 0.514)
    nr = (0.857, 0.0, 0.514)
    d = 2.057
    for lab, n, ridge in (('hide', nl, (1.0, 0, 0)), ('fur', nr, (-1.0, 0, 0))):
        N = [n, tuple(-c for c in n), (0, 0, -1), (0, 1, 0), (0, -1, 0), ridge]
        D = [d + 0.07, -(d - 0.07), -0.05, 2.62, 2.62, 0.09]
        f.put(lab, gs.Planes((0, 0, 0), N, D), 0.02)
    f.put('furd', gs.Planes((0, 0, 0), [nl, nr, (0, 0, -1), (0, 1, 0), (0, -1, 0)], [d, d, -0.05, 2.6, -2.48]), 0.02)
    f.put('hide', gs.Planes((0, 0, 0), [nl, nr, (0, 0, -1), (0, 1, 0), (0, -1, 0)], [d, d, -0.05, -2.48, 2.6]), 0.02)
    f.sub(RoundBox((0, -2.55, 1.1), (0.95, 0.4, 1.5), 0.3), 0.05)
    for s in (-1, 1):
        f.put('furp', Ellipsoid((s * 1.25, -2.62, 1.0), (0.45, 0.2, 1.2), rot(ry=-s * 0.35)), 0.1)
        f.put('fur', Polyline([(s * 2.42, -2.5, 0.18), (s * 2.5, 0.0, 0.22), (s * 2.42, 2.5, 0.18)], 0.26), 0.12)
    f.put('soot', Ellipsoid((0, 0, 4.0), (0.35, 1.2, 0.18)), 0.1)
    n1 = gs.Noise(63)
    f.displace(lambda X, Y, Z: 0.07 * n1.fbm(X * 1.1, Y * 1.1, Z * 1.1, 2) + 0.025 * n1.fbm(X * 4, Y * 4, Z * 4, 2),
               band=0.25)
    verts, faces = gs.mesh_sculpt(f, bpy, 'Tent', 3800)
    add_sculpt(p, f, verts, faces, PROP_COLS, _prop_kinds())


def face_chunk(bpy, name, size, seed):
    """Collapse debris: a great sheared block of the Calving Face (origin at
    its middle, so the runtime can tumble it): weathered blue faces, one
    clean fresh break, old snow on its top."""
    p = P(name, frost=0.5, seed=seed, depth=0.6, ao_dist=size[0] * 0.25)
    rng = np.random.default_rng(seed)
    e = max(size) * 0.8
    f = Sculpt((-e, -e, -e), (e, e, e), max(size) / 70)
    f.put('ice', block(rng, (0, 0, 0), size, cuts=9, R=rot(rz=rng.uniform(0, 6))), 0.1)
    f.put('pale', block(rng, (size[0] * 0.25, -size[1] * 0.2, size[2] * 0.1), (size[0] * 0.5, size[1] * 0.6,
                                                                                size[2] * 0.6), cuts=6), 0.1)
    f.put('snow', Ellipsoid((0, 0, size[2] * 0.42), (size[0] * 0.32, size[1] * 0.3, size[2] * 0.08)), 0.3)
    ice_noise(f, seed, amp=size[0] * 0.02, stria=size[0] * 0.03, scale=size[0] / 10)
    _mesh(bpy, p, f, name, 1600)
    return p
