"""The Gravewyrm Sanctum's interior AAA pass, the walks between the bosses
(build_gravewyrm_sanctum_interior.py), on the same sculpt library as
gravewyrm_interior_sculpt.py:

  edge_rubble_field()  the rubble a walk's edge gathers before it drops into
                       the gulf: rimed boulders, cleaved slabs and ice shards
                       under drift, knee low (a body steps over it), lying on
                       the floor's last yard and spilling past the lip
  drift_field()        a wind drift banked on a snowfield: a long lee slope,
                       a crest with its cornice lip, sastrugi grooves, a rock
                       showing through, knee low

The module frame is lip_rock_field's: origin on the lip at the floor's
height, the module along local X, the drop toward game +lz (Blender -Y), the
walk toward game -lz (Blender +Y). Deterministic: seeded generators and
seeded noise only.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_interior_sculpt import (
    FROST, ICE_CLEAR, ICE_DEEP, ICE_PALE, RIME, SLATE, SLATE_DARK, SLATE_DEEP, SLATE_PALE, SNOW_SHADE, G, icicle,
    rot_z,
)
from gravewyrm_sculpt import Sculpt
from jaguar_head_sculpt import Ellipsoid, Noise, RoundBox
from sanctum_gate_sculpt import Convex, ao_and_edge, mix, sstep

RUBBLE_LENGTH = 4.8
RUBBLE_TOP = 0.72                 # knee low: under the walls test's band


def edge_rubble_field(variant, rng, icy, voxel=0.06):
    """Rubble along a walk's lip. `icy` swaps most slabs for ice shards (the
    glacier walks); the rock walks keep slate."""
    f = Sculpt((-3.2, -2.4, -2.6), (3.2, 2.0, 1.0), voxel)
    # the lip's own broken edge, a hand under the floor, spilling out
    for k in range(7):
        x = -2.6 + k * 0.86 + rng.uniform(-0.2, 0.2)
        c = G(x, rng.uniform(0.1, 0.7), -0.45 - rng.uniform(0.0, 0.5))
        f.put('ice' if icy and k % 2 else 'rock',
              gs.block(rng, c, (rng.uniform(0.9, 1.5), rng.uniform(0.9, 1.4), rng.uniform(0.7, 1.2)), cuts=6,
                       chamfer=(0.62, 0.92), R=gs.rot(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3),
                                                       rng.uniform(0, math.pi))), 0.08)
    # rimed boulders and slabs on the floor's last yard and a half
    for k in range(9):
        x = rng.uniform(-2.4, 2.4)
        lz = -rng.uniform(0.0, 1.3)
        h = rng.uniform(0.25, RUBBLE_TOP - 0.08)
        if icy and rng.random() < 0.45:
            f.put('ice', gs.block(rng, G(x, lz, h / 2 - 0.12), (rng.uniform(0.4, 0.8), rng.uniform(0.35, 0.7), h + 0.24),
                                  cuts=6, chamfer=(0.55, 0.88),
                                  R=gs.rot(rng.uniform(-0.35, 0.35), rng.uniform(-0.3, 0.3), rng.uniform(0, math.pi))),
                  0.04)
        else:
            f.put('rock', Ellipsoid(G(x, lz, h * 0.3), (rng.uniform(0.35, 0.7), rng.uniform(0.3, 0.55), h),
                                    rot_z(rng.uniform(0, math.pi))), 0.12)
    # pebbles
    for k in range(14):
        r = rng.uniform(0.08, 0.18)
        f.put('rock', Ellipsoid(G(rng.uniform(-2.8, 2.8), -rng.uniform(0.0, 1.8), r * 0.4), (r * 1.3, r, r * 0.8)), 0.03)
    # drift banked against the rubble on the walk's side
    for k in range(3):
        f.put('snow', Ellipsoid(G(rng.uniform(-2.0, 2.0), -rng.uniform(0.6, 1.4), -0.05),
                                (rng.uniform(0.9, 1.6), rng.uniform(0.5, 0.8), rng.uniform(0.16, 0.26))), 0.25)
    # icicles hanging off the spill
    for k in range(5):
        icicle(f, G(rng.uniform(-2.4, 2.4), rng.uniform(0.9, 1.3), -0.9), rng.uniform(0.4, 1.2),
               rng.uniform(0.05, 0.1), rng)
    n1 = Noise(4100 + variant)
    f.displace(lambda X, Y, Z: 0.04 * n1.fbm(X * 1.2, Y * 1.2, Z * 1.2, 2), band=0.25)
    f.cut_above(RUBBLE_TOP)
    f.cut_below(-2.5)
    return f


def drift_field(variant, rng, voxel=0.07):
    """A wind drift (origin its centre on the floor; the lee slope toward
    local +X)."""
    f = Sculpt((-3.6, -2.2, -0.3), (3.6, 2.2, 0.7), voxel)
    # the windward ramp rising to the crest (+X), a long low swell
    for k in range(6):
        x = -2.6 + k * 0.75 + rng.uniform(-0.15, 0.15)
        h = 0.12 + 0.07 * k
        f.put('snow', Ellipsoid((x, rng.uniform(-0.3, 0.3), -0.05),
                                (rng.uniform(0.9, 1.2), rng.uniform(1.0, 1.5) - 0.08 * k, h)), 0.4)
    # the crest and its cornice lip overhanging the lee
    f.put('snow', Ellipsoid((1.35, 0.0, 0.18), (0.5, 1.15, 0.3)), 0.25)
    # the lee face: cut steep
    nrm = np.array((0.94, 0.0, 0.34))
    P0 = np.array((1.75, 0.0, 0.0))
    f.sub(Convex([(tuple(-nrm), float(-nrm @ P0))], (1.0, -2.2, -0.3), (3.6, 2.2, 0.8)), 0.12)
    if variant % 2 == 0:
        f.put('rock', Ellipsoid((rng.uniform(-1.0, 1.0), rng.uniform(-0.6, 0.6), 0.05), (0.45, 0.38, 0.32),
                                rot_z(rng.uniform(0, math.pi))), 0.08)
    # the sastrugi: shallow wind grooves across the crest
    for k in range(6):
        y0 = -1.2 + k * 0.48
        f.groove(gs.Union([RoundBox((0.0, y0, 0.4), (3.0, 0.02, 0.4), 0.02)]), 0.05, 0.06)
    n1 = Noise(4200 + variant)
    f.displace(lambda X, Y, Z: 0.05 * n1.fbm(X * 0.8, Y * 0.8, Z * 0.8, 2), band=0.3)
    f.cut_above(0.5)
    f.cut_below(-0.25)
    return f


def path_paint(field, seed, icy):
    n1 = Noise(seed)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='rock')
        up = np.clip(N[:, 2], -1, 1)
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.7, P[:, 1] * 0.7, P[:, 2] * 0.7, 2)
        rock = mix(SLATE_DARK, SLATE, np.clip(tone * 0.6 + edge * 0.5, 0, 1))
        rock = mix(rock, SLATE_PALE, np.clip(edge - 0.4, 0, 1))
        ice = mix(ICE_DEEP, ICE_CLEAR, np.clip(ao * 0.7 + edge * 0.4, 0, 1))
        ice = mix(ice, ICE_PALE, np.clip(edge * 0.6, 0, 1))
        snow = mix(SNOW_SHADE, RIME, np.clip(up * 0.7 + 0.3 * ao, 0, 1))
        c = np.where((labels == 'ice')[:, None], ice, rock)
        c = np.where((labels == 'snow')[:, None], snow, c)
        c = mix(np.asarray(SLATE_DEEP) * 0.7, c, np.clip(ao ** 1.3 * 0.85 + 0.15, 0, 1))
        cover = sstep(0.6, 0.9, up + (tone - 0.5) * 0.4) * np.clip(0.35 + ao, 0, 1)
        c = mix(c, RIME, cover * (labels != 'snow') * 0.85)
        c = mix(c, FROST, np.clip(0.25 * (1 - ao), 0, 0.25))
        return c

    return paint
