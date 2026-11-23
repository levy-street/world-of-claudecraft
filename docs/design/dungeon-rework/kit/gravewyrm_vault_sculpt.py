"""The Gravewyrm Sanctum's interior AAA pass, the Ritual Vault (Velkhar) and
the icy walks round it (build_gravewyrm_sanctum_interior.py), on the same
sculpt library as gravewyrm_interior_sculpt.py:

  pyre_rim_field()    a thaw pool's rim: rimed boulders and ice shards round
                      the meltwater, knee high at most, slush between them
  pyre_core_field()   the thaw pyre: a cairn of black slate under its coals,
                      four leaning riveted uprights bound in chain, the grate
                      ring, soul cages, the tithe of bones at its foot
  banner_field()      a cult standard: pole, crossbar, skull finial and a
                      tattered banner in heavy folds, torn to tongues
  lip_ice_field()     an ice lip module (the lip_rock_field frame): glacier
                      blocks, blue crevasses, icicles, a snow cornice
  bone_heap_field()   skulls and long bones under drift, knee low

Coordinates: Blender's (X east, Y SOUTH, Z up); G(lx, lz, y) takes game-local
coordinates. Deterministic: seeded generators and seeded noise only.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_interior_sculpt import (
    FROST, ICE_CLEAR, ICE_DEEP, ICE_PALE, IRON, IRON_DARK, RIME, RUST, SLATE, SLATE_DARK, SLATE_DEEP, SNOW_SHADE, G,
    icicle, rot_z,
)
from gravewyrm_sculpt import Sculpt
from jaguar_head_sculpt import Ellipsoid, Noise, Prim, RoundBox, RoundCone, Torus
from sanctum_gate_sculpt import Convex, ao_and_edge, groove_polyline, mix, sstep

BONE = (0.74, 0.71, 0.63)
BONE_DARK = (0.42, 0.39, 0.34)
SOOT = (0.075, 0.07, 0.07)
EMBER = (0.62, 0.26, 0.1)
CULT_CLOTH = (0.24, 0.15, 0.29)
CULT_DARK = (0.1, 0.07, 0.12)
CULT_RED = (0.45, 0.11, 0.1)
TIMBER_DARK = (0.22, 0.17, 0.13)
TIMBER = (0.3, 0.23, 0.17)
SIGIL = (0.62, 0.78, 0.64)
SOUL_STONE = (0.42, 0.72, 0.52)       # the caged souls, unlit (the fire is the runtime's)
SOUL_PALE = (0.62, 0.9, 0.7)
POOL_R = 7.0                           # the meltwater pools' radius (sim THAW_POOLS)
BANNER = dict(w=1.6, top=5.22, bot=2.6)


def skull(f, c, size, yaw, label='bone', pitch=0.0):
    """A skull: cranium, brow, cheekbones and jaw, the eye sockets cut
    (Blender coords, its face toward -Y turned by `yaw`)."""
    R = gs.rot(pitch, 0.0, yaw)
    s = size
    c = np.asarray(c, dtype=np.float64)

    def at(x, y, z):
        return c + R @ np.array((x * s, y * s, z * s))

    f.put(label, Ellipsoid(at(0, 0.05, 0.1), (0.5 * s, 0.58 * s, 0.5 * s), R), 0.06 * s)
    f.put(label, Ellipsoid(at(0, -0.38, -0.12), (0.36 * s, 0.24 * s, 0.26 * s), R), 0.05 * s)
    f.put(label, RoundBox(at(0, -0.36, -0.36), (0.24 * s, 0.14 * s, 0.1 * s), 0.05 * s, R), 0.04 * s)
    for sx in (-1, 1):
        f.sub(Ellipsoid(at(sx * 0.19, -0.52, 0.0), (0.13 * s, 0.12 * s, 0.11 * s), R), 0.03 * s)
    f.sub(Ellipsoid(at(0, -0.6, -0.2), (0.06 * s, 0.08 * s, 0.08 * s), R), 0.02 * s)


def long_bone(f, a, b, r, label='bone'):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    f.put(label, RoundCone(a, b, r * 0.75, r * 0.75), 0.02)
    f.put(label, Ellipsoid(a, (r * 1.4, r * 1.4, r * 1.4)), 0.03)
    f.put(label, Ellipsoid(b, (r * 1.4, r * 1.4, r * 1.4)), 0.03)


def pyre_rim_field(rng, voxel=0.08):
    E = POOL_R + 1.6
    f = Sculpt((-E, -E, -0.4), (E, E, 1.1), voxel)
    n = 46
    for k in range(n):
        if rng.random() < 0.12:
            continue
        a = 2 * math.pi * (k + rng.uniform(-0.3, 0.3)) / n
        r = POOL_R + rng.uniform(-0.25, 0.45)
        cx, cy = math.cos(a) * r, math.sin(a) * r
        if k % 3 == 0:
            h = rng.uniform(0.45, 0.85)
            R = rot_z(a) @ gs.rot(rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2), 0)
            f.put('ice', gs.block(rng, (cx, cy, h / 2 - 0.15), (rng.uniform(0.9, 1.6), rng.uniform(0.6, 1.0), h + 0.3),
                                  cuts=6, chamfer=(0.6, 0.9), R=R), 0.05)
        else:
            h = rng.uniform(0.3, 0.7)
            f.put('rock', Ellipsoid((cx, cy, h * 0.35), (rng.uniform(0.55, 0.95), rng.uniform(0.45, 0.75), h),
                                    rot_z(a + rng.uniform(-0.4, 0.4))), 0.18)
    for k in range(18):
        a = rng.uniform(0, 2 * math.pi)
        r = POOL_R + rng.uniform(0.3, 1.1)
        f.put('snow', Ellipsoid((math.cos(a) * r, math.sin(a) * r, -0.05),
                                (rng.uniform(0.8, 1.5), rng.uniform(0.5, 0.8), 0.22), rot_z(a)), 0.25)
    n1 = Noise(3101)
    f.displace(lambda X, Y, Z: 0.07 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 2), band=0.3)
    f.cut_below(-0.3)
    f.cut_above(0.95)
    return f


def pyre_core_field(rng, voxel=0.05):
    f = Sculpt((-3.4, -3.4, -0.3), (3.4, 3.4, 7.6), voxel)
    # the cairn
    y = 0.0
    for course, (r, h, n) in enumerate(((2.15, 0.6, 9), (1.85, 0.55, 8), (1.5, 0.5, 7), (1.15, 0.45, 6))):
        for k in range(n):
            a = 2 * math.pi * (k + rng.uniform(-0.2, 0.2) + course * 0.5) / n
            c = (math.cos(a) * (r - 0.45), math.sin(a) * (r - 0.45), y + h / 2)
            f.put('rock', gs.block(rng, c, (1.0, 2 * math.pi * r / n * 1.1, h * 1.1), cuts=6, chamfer=(0.65, 0.9),
                                   R=rot_z(a), top_tilt=0.2), 0.08)
        y += h * 0.92
    # a last course lifts the coal bed to the soulfire's base (the runtime's
    # thaw-pyre flame stands 2.6 over the floor)
    for k in range(5):
        a = 2 * math.pi * (k + rng.uniform(-0.2, 0.2)) / 5
        f.put('rock', gs.block(rng, (math.cos(a) * 0.45, math.sin(a) * 0.45, y + 0.2), (0.9, 0.9, 0.44), cuts=5,
                               chamfer=(0.65, 0.9), R=rot_z(a), top_tilt=0.15), 0.08)
    y += 0.37
    # the coal bed and the grate ring round it
    for k in range(26):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.0, 1.05)
        rr = rng.uniform(0.18, 0.32)
        f.put('coal', Ellipsoid((math.cos(a) * r, math.sin(a) * r, y + rng.uniform(0.0, 0.25)),
                                (rr, rr, rng.uniform(0.12, 0.22))), 0.05)
    f.put('iron', Torus((0.0, 0.0, y + 0.2), 1.35, 0.09, (0.0, 0.0, 1.0)), 0.02)
    # four leaning uprights: riveted bands, hooked crowns, soul cages
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        base = np.array((ca * 2.5, sa * 2.5, 0.0))
        mid = np.array((ca * 2.25, sa * 2.25, 3.4))
        top = np.array((ca * 1.65, sa * 1.65, 6.8))
        f.put('iron', RoundCone(base, mid, 0.21, 0.18), 0.03)
        f.put('iron', RoundCone(mid, top, 0.18, 0.13), 0.03)
        for t in (0.15, 0.45, 0.78):
            q = base + (top - base) * t
            f.put('iron', Torus(q, 0.2 - 0.05 * t, 0.06, top - base), 0.01)
        crown = top + np.array((0.0, 0.0, 0.55))
        hook = top + np.array((-ca * 0.45, -sa * 0.45, 0.35))
        f.put('iron', RoundCone(top, crown, 0.12, 0.08), 0.02)
        f.put('iron', RoundCone(crown, hook, 0.08, 0.04), 0.02)
        hc = np.array((ca * 2.75, sa * 2.75, 4.3))
        f.put('iron', RoundCone(top + np.array((ca * 0.15, sa * 0.15, -0.3)), hc + np.array((0, 0, 0.75)), 0.03, 0.03),
              0.0)
        for j in range(6):
            b = 2 * math.pi * j / 6
            p0 = hc + np.array((math.cos(b) * 0.32, math.sin(b) * 0.32, -0.5))
            p1 = hc + np.array((math.cos(b) * 0.4, math.sin(b) * 0.4, 0.1))
            p2 = hc + np.array((0.0, 0.0, 0.75))
            f.put('iron', RoundCone(p0, p1, 0.035, 0.035), 0.0)
            f.put('iron', RoundCone(p1, p2, 0.035, 0.03), 0.0)
        f.put('iron', Torus(hc + np.array((0, 0, -0.5)), 0.32, 0.04, (0.0, 0.0, 1.0)), 0.0)
        f.put('soul', Ellipsoid(hc + np.array((0, 0, -0.05)), (0.22, 0.22, 0.32)), 0.04)
    # chains sagging between the uprights
    for k in range(4):
        a0 = 2 * math.pi * k / 4 + math.pi / 4
        a1 = a0 + math.pi / 2
        p0 = np.array((math.cos(a0) * 2.3, math.sin(a0) * 2.3, 2.4))
        p1 = np.array((math.cos(a1) * 2.3, math.sin(a1) * 2.3, 2.4))
        u = p1 - p0
        for j in range(5):
            t = (j + 0.5) / 5
            q = p0 + u * t + np.array((0, 0, -0.45 * math.sin(math.pi * t)))
            nrm = np.array((0.0, 0.0, 1.0)) if j % 2 else np.cross(u, (0.0, 0.0, 1.0))
            f.put('iron', gs.Link(q, u, nrm, 0.14, 0.12, 0.045), 0.0)
    # the tithe of bones heaped at the cairn's foot
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(2.05, 2.6)
        skull(f, (math.cos(a) * r, math.sin(a) * r, 0.22), rng.uniform(0.34, 0.46),
              a + math.pi + rng.uniform(-0.6, 0.6), pitch=rng.uniform(-0.3, 0.3))
    for k in range(16):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(1.9, 2.9)
        c = np.array((math.cos(a) * r, math.sin(a) * r, 0.12))
        d = np.array((math.cos(a + 1.5), math.sin(a + 1.5), rng.uniform(-0.1, 0.25))) * rng.uniform(0.35, 0.6)
        long_bone(f, c - d, c + d, rng.uniform(0.05, 0.08))
    n1 = Noise(3201)
    f.displace(lambda X, Y, Z: 0.03 * n1.fbm(X * 1.4, Y * 1.4, Z * 1.4, 2), band=0.25)
    f.cut_below(-0.2)
    return f


class Cloth(Prim):
    """A hanging cloth sheet (X across, Y its face's normal, Z down from the
    crossbar): folds, a sag, a sway toward `side`."""

    def __init__(self, w, top, bot, folds, side):
        self.w, self.top, self.bot, self.folds, self.side = w, top, bot, folds, side
        self.lo = np.array((-w / 2 - 0.3, -0.6, bot - 0.6))
        self.hi = np.array((w / 2 + 0.3, 0.6, top + 0.1))

    def dist(self, X, Y, Z):
        t = np.clip((self.top - Z) / (self.top - self.bot), 0, 1)
        off = ((0.09 * np.sin(X * 6.0 + self.folds[0]) + 0.05 * np.sin(X * 11.0 + self.folds[1])) * (0.4 + 0.6 * t)
               + 0.18 * t * t * self.side)
        dy = np.abs(Y - off) - 0.03
        dx = np.abs(X) - self.w / 2 * (1.0 - 0.06 * t)
        dz = np.maximum(Z - self.top, self.bot - Z)
        return np.maximum(np.maximum(dx, dy), dz) * 0.7


def banner_field(rng, side, voxel=0.035):
    f = Sculpt((-1.2, -0.9, -0.2), (1.2, 0.9, 6.6), voxel)
    f.put('wood', RoundCone((0, 0, -0.1), (0, 0, 5.9), 0.1, 0.075), 0.02)
    f.put('iron', Torus((0, 0, 5.45), 0.11, 0.035, (0.0, 0.0, 1.0)), 0.01)
    f.put('wood', RoundCone((-0.85, 0, 5.3), (0.85, 0, 5.3), 0.055, 0.055), 0.02)
    for sx in (-1, 1):
        f.put('iron', RoundCone((sx * 0.85, 0, 5.3), (sx * 1.0, 0, 5.55), 0.04, 0.02), 0.01)
    skull(f, (0, 0, 6.15), 0.3, 0.0)
    b = BANNER
    folds = [rng.uniform(0, 2 * math.pi) for _ in range(2)]
    f.put('cloth', Cloth(b['w'], b['top'], b['bot'], folds, side), 0.0)
    for k in range(6):
        x = -b['w'] / 2 + (k + rng.uniform(0.1, 0.9)) * b['w'] / 6
        f.sub(Ellipsoid((x, 0.0, b['bot'] + rng.uniform(-0.05, 0.25)), (0.09, 0.7, rng.uniform(0.2, 0.55))), 0.01)
    for k in range(3):
        f.sub(Ellipsoid((rng.uniform(-0.6, 0.6), 0.0, rng.uniform(b['bot'] + 0.6, b['top'] - 0.6)),
                        (0.08, 0.7, 0.11)), 0.01)
    f.put('rime', Ellipsoid((0, 0, 5.36), (0.9, 0.12, 0.05)), 0.02)
    return f


def vault_paint(field):
    n1 = Noise(3301)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='rock')
        up = np.clip(N[:, 2], 0, 1)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.8, P[:, 1] * 0.8, P[:, 2] * 0.8, 2)
        c = mix(SLATE_DARK, SLATE, np.clip(tone * 0.6 + edge * 0.5, 0, 1))

        def put(lab, col):
            nonlocal c
            m = (labels == lab).astype(np.float64)[:, None]
            c = c * (1 - m) + np.asarray(col) * m

        put('ice', mix(ICE_DEEP, ICE_CLEAR, np.clip(ao * 0.7 + edge * 0.4, 0, 1)))
        put('snow', mix(SNOW_SHADE, RIME, np.clip(up * 0.8 + 0.2, 0, 1)))
        put('rime', mix(FROST, RIME, np.clip(up, 0, 1)))
        put('coal', mix(SOOT, EMBER, np.clip(tone - 0.35, 0, 1) * 0.9))
        iron = mix(IRON_DARK, IRON, np.clip(edge + 0.2, 0, 1))
        put('iron', mix(iron, RUST, np.clip(tone - 0.6, 0, 1)))
        put('soul', mix(SOUL_STONE, SOUL_PALE, np.clip(edge, 0, 1)))
        put('bone', mix(BONE_DARK, BONE, np.clip(ao * 0.8 + edge * 0.4, 0, 1)))
        put('wood', mix(TIMBER_DARK, TIMBER, tone))
        cl = labels == 'cloth'
        if cl.any():
            z, x = P[:, 2], P[:, 0]
            band = np.abs(z - 4.75) < 0.16
            ring = np.abs(np.hypot(x, (z - 3.85) * 1.05) - 0.36) < 0.06
            bar = (np.abs(x) < 0.05) & (np.abs(z - 3.85) < 0.5)
            cc = mix(CULT_DARK, CULT_CLOTH, np.clip(tone * 0.7 + 0.3 * up, 0, 1))
            cc = np.where(band[:, None], np.asarray(CULT_RED), cc)
            cc = np.where((ring | bar)[:, None], np.asarray(SIGIL), cc)
            c = np.where(cl[:, None], cc, c)
        c = mix(np.asarray(SLATE_DEEP) * 0.6, c, np.clip(ao ** 1.4 * 0.85 + 0.15, 0, 1))
        snow = sstep(0.7, 0.95, up + (tone - 0.5) * 0.3) * np.clip(0.3 + ao, 0, 1)
        snowable = np.isin(labels, ('rock', 'ice', 'bone', 'iron')).astype(np.float64)
        return mix(c, RIME, snow * snowable * 0.85)

    return paint


def lip_ice_field(variant, rng, voxel=0.12):
    f = Sculpt((-4.4, -5.2, -16.5), (4.4, 1.4, 0.4), voxel)
    top = -0.14
    f.put('ice', RoundBox(G(0.0, 0.6, -8.0), (3.3, 1.0, 8.2), 0.3), 0.0)
    y = top
    course = 0
    while y > -16.0:
        h = rng.uniform(1.6, 3.4)
        x = -3.5 + rng.uniform(-0.4, 0.2)
        while x < 3.4:
            w = rng.uniform(1.4, 2.8)
            o = 1.4 + (0.5 if (course + variant) % 2 else -0.1) + rng.uniform(-0.6, 0.6) - max(0.0, -y - 7.0) * 0.12
            c = G(x + w / 2, o - 0.4, y - h / 2)
            R = gs.rot(rng.uniform(-0.15, 0.15), rng.uniform(-0.1, 0.1), 0)
            f.put('ice', gs.block(rng, c, (w * 1.05, 2.6 + rng.uniform(0, 0.9), h * 1.15), cuts=7,
                                  chamfer=(0.55, 0.9), R=R, top_tilt=0.3), 0.1)
            x += w
        y -= h
        course += 1
    for k in range(3):
        px = rng.uniform(-2.8, 2.8)
        pts = [G(px + rng.uniform(-0.15, 0.15), 1.9 + 0.3 * math.sin(j * 1.3), -0.4 - j * 2.0) for j in range(7)]
        groove_polyline(f, pts, 0.45, 0.2)
    for k in range(14):
        px = rng.uniform(-3.1, 3.1)
        icicle(f, G(px, 2.2 + rng.uniform(0, 0.8), rng.uniform(-3.0, -0.5)), rng.uniform(0.8, 2.6),
               rng.uniform(0.1, 0.2), rng)
    f.put('snow', RoundBox(G(0.0, 1.3, -0.45), (3.4, 1.2, 0.3), 0.25), 0.3)
    gs.ice_noise(f, 950 + variant, amp=0.3, stria=0.5, scale=1.0)
    f.cut_above(top)
    f.sub(Convex([((0.0, -1.0, 0.0), -0.35)], (-5.0, 0.3, -20.0), (5.0, 2.0, 1.0)), 0.0)
    return f


def ice_paint(field, seed):
    n1 = Noise(seed)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='ice')
        up = np.clip(N[:, 2], -1, 1)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.25, P[:, 1] * 0.25, P[:, 2] * 0.12, 3)
        stria = 0.5 + 0.5 * n1.fbm(P[:, 0] * 1.2, P[:, 1] * 1.2, P[:, 2] * 0.08, 2)
        c = mix(ICE_CLEAR, ICE_PALE, np.clip(edge * 0.8 + (tone - 0.5) * 0.5, 0, 1))
        c = c * (0.9 + 0.15 * stria)[:, None]
        c = mix(np.asarray(ICE_DEEP) * 0.7, c, np.clip(ao ** 1.5, 0, 1))
        c = mix(c, ICE_DEEP, np.clip(-up, 0, 1) * 0.45)
        snow = np.maximum((labels == 'snow') * 1.0, sstep(0.55, 0.85, up) * np.clip(0.3 + ao, 0, 1))
        return mix(c, RIME, np.clip(snow, 0, 1))

    return paint


def bone_heap_field(rng, voxel=0.035):
    f = Sculpt((-1.8, -1.4, -0.2), (1.8, 1.4, 0.95), voxel)
    # drift lodged against the heap's back (the wall's side), never a disc
    for k in range(4):
        f.put('snow', Ellipsoid((rng.uniform(-1.0, 1.0), rng.uniform(0.3, 0.8), -0.05),
                                (rng.uniform(0.5, 0.9), rng.uniform(0.35, 0.55), rng.uniform(0.2, 0.32))), 0.2)
    for k in range(7):
        skull(f, (rng.uniform(-1.1, 1.1), rng.uniform(-0.6, 0.6), rng.uniform(0.15, 0.4)), rng.uniform(0.3, 0.42),
              rng.uniform(-1.0, 1.0), pitch=rng.uniform(-0.5, 0.5))
    for k in range(14):
        c = np.array((rng.uniform(-1.2, 1.2), rng.uniform(-0.7, 0.7), rng.uniform(0.05, 0.35)))
        a = rng.uniform(0, math.pi)
        d = np.array((math.cos(a), math.sin(a), rng.uniform(-0.2, 0.3))) * rng.uniform(0.3, 0.55)
        long_bone(f, c - d, c + d, rng.uniform(0.045, 0.07))
    f.cut_below(-0.15)
    f.cut_above(0.85)
    return f
