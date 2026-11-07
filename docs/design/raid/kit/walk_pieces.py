"""The Hammer Gallery's walk dressing (phase 2E, build_smith_heart_hammer_kit.py):
the worn kerb along the walk's lip, the rubble edge where the kerb has
broken away, the masons' chain rail where the walk overlooks the chasm, and
the fallen blocks lying on the walk (each on a collider of the layout).

Edge pieces follow the kit's convention: a module runs along X, its origin
on the walk's lip (z 0 the walk's top), the drop toward -Y, the walk toward
+Y. Nothing of a kerb stands more than a hand over the walk (z < 0.3, the
render-only rule); a rail stands entirely past the lip (y < -0.3), over
the drop, where no body walks. Deterministic: every draw is the piece's own
seeded rng.
"""
import math

from mathutils import Vector

import hammer_cliff as hc
from gwkit import crystal, loop_tube, rivets, slab
from shkit import (
    DRESSED, DUST, IRON, IRON_DARK, METAL, QUARRY, QUARRY_DARK, QUARRY_PALE, RAW, SP, TAU,
    light_chain, mix,
)

CHAIN_IRON = (0.25, 0.235, 0.22)
# The kerb's dressed granite: the quarry's mid grey (under the low sun a
# paler kerb read as a white stripe along the walk), worn a little paler.
KERB = mix(QUARRY, QUARRY_DARK, 0.25)
KERB_WORN = mix(QUARRY, DUST, 0.2)


def _kerbstone(p, x0, x1, y0, y1, top, rng, sunk=0.0, tilt=0.0):
    """One kerbstone from x0 to x1 (along the lip) and y0 to y1 (into the
    walk), its top at `top`: a dressed block with its arrises worn round
    and one corner chipped off now and then (a slab's chamfered hull)."""
    w = x1 - x0
    d = y1 - y0
    h = top + 0.55 - sunk
    slab(p, ((x0 + x1) / 2, (y0 + y1) / 2, top - h / 2 - sunk), (w, d, h),
         p.vary(KERB if rng.random() < 0.7 else KERB_WORN, 0.05), roll=tilt, chamfer=0.12 + rng.uniform(0, 0.08),
         jitter=0.06)


def walk_curb(variant):
    """A 6 yd module of the walk's kerb: worn dressed kerbstones of uneven
    length set along the lip, their tops a hand proud of the walk, sunk or
    tipped here and there where the edge has settled; variant B is the kerb
    broken away, its stones cracked and shifted, a rubble edge of chips and
    spalls where it was lost."""
    p = SP('WalkCurb' + variant, seed=611 + ord(variant), ao=0.6, ao_dist=0.8)
    rng = p.rng
    with p.as_kind(DRESSED):
        x = -3.0
        while x < 3.0:
            length = rng.uniform(0.9, 1.7)
            x1 = min(3.0, x + length)
            gap = rng.random() < (0.35 if variant == 'B' else 0.06)
            if not gap:
                sunk = rng.uniform(0.0, 0.12) if rng.random() < 0.3 else 0.0
                tilt = rng.uniform(-0.08, 0.08) if variant == 'B' else rng.uniform(-0.02, 0.02)
                _kerbstone(p, x + 0.03, x1 - 0.03, 0.02, rng.uniform(0.5, 0.62), rng.uniform(0.16, 0.24), rng,
                           sunk=sunk, tilt=tilt)
            x = x1
    # The rubble where the kerb is lost (B), chips along the foot of the
    # kerb on the walk's side (both): flat, under a hand.
    with p.as_kind(RAW):
        n = 22 if variant == 'B' else 7
        for k in range(n):
            s = rng.uniform(0.12, 0.42 if variant == 'B' else 0.26)
            x = rng.uniform(-2.9, 2.9)
            y = rng.uniform(0.0, 0.5) if variant == 'B' else rng.uniform(0.6, 0.95)
            slab(p, (x, y, s * 0.2), (s * 1.4, s, s * 0.45), p.vary(QUARRY_PALE if k % 3 else QUARRY, 0.08),
                 yaw=rng.uniform(0, TAU), roll=rng.uniform(-0.3, 0.3), chamfer=0.22, jitter=0.18)
    return p


def walk_rail(variant='A'):
    """A 6 yd module of the masons' chain rail where the walk overlooks the
    chasm: two iron posts with ring tops leaded into stone footings set
    into the brink past the lip, a heavy chain slung between them, sagging,
    and a lighter one under it. Everything stands past the lip (y < -0.3)."""
    p = SP('WalkRail', seed=641, ao=0.4, ao_dist=0.6)
    rng = p.rng
    y = -0.62
    for x in (-3.0, 3.0):
        # The footing: a squared stone leaded into the brink.
        with p.as_kind(DRESSED):
            slab(p, (x, y, -0.35), (0.62, 0.56, 0.95), p.vary(KERB, 0.05), chamfer=0.1, jitter=0.05)
        with p.as_kind(METAL):
            p.sweep([(x, y, 0.1), (x, y, 1.12)], 0.075, 0.065, p.vary(IRON_DARK, 0.04), sides=6)
            loop_tube(p, [Vector((x + math.cos(a) * 0.13, y, 1.24 + math.sin(a) * 0.13))
                          for a in [TAU * i / 8 for i in range(8)]], 0.035, IRON, normal=(0, 1, 0))
            rivets(p, [(x, y - 0.29, -0.1)], 0.05, color=IRON)
    light_chain(p, (-2.92, y, 1.05), (2.92, y, 1.05), 0.5, 0.14, 0.042, CHAIN_IRON, sag=0.34)
    light_chain(p, (-2.92, y, 0.6), (2.92, y, 0.6), 0.5, 0.12, 0.036, CHAIN_IRON, sag=0.2)
    return p



def fallen_block(variant):
    """A dressed block fallen onto the walk from the Smith's work above
    (origin at its foot's centre; its collider 2.2 by 1.6 by 1.5): split
    stone tipped on its edge, one corner broken off and lying beside it,
    the walk's chips scattered round, a little dust drifted against it."""
    import bpy
    seeds = {'A': 671, 'B': 677}
    p = SP('FallenBlock' + variant, seed=seeds[variant], ao_dist=1.4)
    rng = p.rng
    if variant == 'A':
        hc.cut_stone(bpy, p, 'FallenBlockA0', 1701, (0, 0, 0.62), (2.1, 1.5, 1.3), yaw=0.25, target=760)
        hc.cut_stone(bpy, p, 'FallenBlockA1', 1703, (1.25, -0.55, 0.28), (0.8, 0.6, 0.55), yaw=1.1, drill=False,
                     fresh=False, target=200)
    else:
        hc.cut_stone(bpy, p, 'FallenBlockB0', 1705, (0, 0, 0.7), (1.7, 1.6, 1.45), yaw=-0.4, drill=False,
                     target=760)
        hc.cut_stone(bpy, p, 'FallenBlockB1', 1707, (-1.05, 0.7, 0.3), (0.9, 0.7, 0.6), yaw=0.7, drill=False,
                     fresh=False, target=200)
    with p.as_kind(RAW):
        for k in range(10):
            a = rng.uniform(0, TAU)
            r = rng.uniform(1.0, 1.9)
            s = rng.uniform(0.12, 0.34)
            slab(p, (math.cos(a) * r, math.sin(a) * r * 0.8, s * 0.2), (s * 1.4, s, s * 0.45),
                 p.vary(QUARRY_PALE if k % 2 else QUARRY_DARK, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22,
                 jitter=0.18)
        crystal(p, (0.0, -0.95, 0.05), (2.2, 0.8, 0.22), DUST, n=12, boxy=0.9, jitter=0.1, floor=0.0)
    return p
