"""The Masterless Strength's great anvil (Weight of the Anvil), one block of the mountain's
dark granite cut to an anvil and fallen a long way: Kit_FinalAnvil, placed and swung by
src/render/smith_heart_fx/final_kit_fx.ts.

Its measures are the fight's (final_kit_shapes.ts ANVIL_SIZE, the fallback the runtime draws
until the kit lands): about 11 yards along the horn, 7 high, its feet on z = 0, centred on
its footprint. A monumental silhouette before anything else: stepped feet, a waist curving
in, a broad flat face over a heavy shoulder, the long round horn, the squared heel with its
undercut. Then its age: a face worn pale by the blows, chips out of every edge, a great
crack down one flank with the Smith's gold deep in it, gold crystal breaking out of the
heel and the waist (the glow slot, the runtime's own colour, hotter as it falls).

Painted by landmark_paint.py. Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np

from gravewyrm_sculpt import Sculpt, block
from heart_pieces import HEART_COLOURS, HEART_KINDS, HSP, pale_crystal
from jaguar_head_sculpt import Ellipsoid, Polyline, RoundBox, RoundCone
from landmark_paint import crystal_grade, hand_sculpt, paint_faces, stone_shader
from ring_sculpt import Fn
from shkit import PAINT

# The side profile (x along the horn, z up), its feet on z = 0, the horn apart.
PROFILE = ((-5.1, 0.0), (2.7, 0.0), (2.7, 0.62), (2.0, 0.9), (0.72, 1.55), (0.42, 3.2), (0.9, 4.1), (2.6, 4.7),
           (3.5, 5.0), (3.5, 6.42), (-5.5, 6.42), (-5.5, 5.15), (-4.6, 4.72), (-3.05, 4.15), (-2.8, 3.2), (-3.1, 1.55),
           (-4.4, 0.9), (-5.1, 0.62))
HALF_DEPTH = 1.72


def _extrude(poly, half_y, round_r):
    """A polygon in (x, z) as a solid along y, its edges rounded by `round_r`."""
    P = np.asarray(poly, dtype=np.float64)
    lo = (P[:, 0].min() - 1.0, -half_y - 1.0, P[:, 1].min() - 1.0)
    hi = (P[:, 0].max() + 1.0, half_y + 1.0, P[:, 1].max() + 1.0)

    def fn(X, Y, Z):
        d2 = np.full(X.shape, 1e18)
        inside = np.zeros(X.shape, dtype=bool)
        n = len(P)
        for i in range(n):
            ax, az = P[i]
            bx, bz = P[(i + 1) % n]
            ex, ez = bx - ax, bz - az
            wx, wz = X - ax, Z - az
            t = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0.0, 1.0)
            qx, qz = wx - ex * t, wz - ez * t
            d2 = np.minimum(d2, qx * qx + qz * qz)
            cross = ((az <= Z) & (Z < bz)) | ((bz <= Z) & (Z < az))
            inside ^= cross & (X < ax + (Z - az) / (ez if ez != 0 else 1e-9) * ex)
        d = np.sqrt(d2)
        d = np.where(inside, -d, d)
        dy = np.abs(Y) - half_y
        outside = np.sqrt(np.maximum(d, 0.0) ** 2 + np.maximum(dy, 0.0) ** 2)
        return outside + np.minimum(np.maximum(d, dy), 0.0) - round_r

    return Fn(fn, lo, hi)


def final_anvil(bpy):
    p = HSP('Kit_FinalAnvil', seed=7101, ao=0.5, ao_dist=1.6, dust=0.0)
    rng = np.random.default_rng(7101)
    f = Sculpt((-7.0, -3.4, -0.5), (9.4, 3.4, 8.0), 0.075)
    # The block: the profile, a waist narrower than its shoulders and its feet.
    f.put('g1', _extrude(PROFILE, HALF_DEPTH, 0.12), 0.08)
    # The feet: a broad plinth, stepped, the corners cut.
    f.put('g1', RoundBox((-1.2, 0.0, 0.34), (4.35, 2.42, 0.32), 0.1), 0.05)
    f.put('g1', RoundBox((-1.2, 0.0, 0.84), (3.7, 2.05, 0.28), 0.1), 0.1)
    # The shoulder under the face, the face itself standing proud of it.
    f.put('g1', RoundBox((-1.0, 0.0, 5.5), (4.6, 2.05, 0.62), 0.14), 0.12)
    f.put('face', RoundBox((-1.0, 0.0, 6.5), (4.62, 1.92, 0.1), 0.06), 0.03)
    # The horn: round, long, lifting a little to its point.
    f.put('g1', RoundCone((2.8, 0.0, 5.46), (4.4, 0.0, 5.6), 1.24, 0.72), 0.25)
    f.put('g1', RoundCone((4.4, 0.0, 5.6), (5.95, 0.0, 5.98), 0.72, 0.1), 0.12)
    # The hardy hole and the pritchel in the heel.
    f.sub(RoundBox((-4.1, 0.0, 6.55), (0.42, 0.42, 0.5), 0.04), 0.04)
    f.sub(Ellipsoid((-2.7, 0.0, 6.6), (0.26, 0.26, 0.5)), 0.04)
    # What the fall and the blows took: chips out of the edges (never a straight arris).
    edges = [((x, y, 6.42)) for x in np.linspace(-5.4, 3.4, 13) for y in (-1.95, 1.95)]
    edges += [((-5.45, y, z)) for y in (-1.8, 1.8) for z in (5.4, 6.1)]
    edges += [((x, y, 0.72)) for x in np.linspace(-5.0, 2.6, 7) for y in (-2.45, 2.45)]
    for q in edges:
        if rng.random() < 0.62:
            r = float(rng.uniform(0.16, 0.42))
            f.sub(Ellipsoid(q, (r * float(rng.uniform(1.0, 2.2)), r, r * float(rng.uniform(0.7, 1.2)))), 0.05)
    # The great crack down one flank, from the face to the waist; a lesser on the other.
    crack = [(-0.4, -2.1, 6.5), (-0.1, -2.05, 5.5), (-0.6, -1.75, 4.6), (-0.15, -1.45, 3.6), (-0.5, -1.4, 2.5), (-0.1, -1.7, 1.3)]
    f.sub(Polyline(crack, [0.3, 0.26, 0.24, 0.2, 0.16, 0.1]), 0.05)
    crack2 = [(-2.8, 2.1, 6.5), (-3.05, 2.05, 5.6), (-2.75, 1.7, 4.6), (-3.0, 1.55, 3.7)]
    f.sub(Polyline(crack2, [0.2, 0.17, 0.14, 0.08]), 0.04)
    # Blocks of it hanging on by the crack: one corner of the heel shifted.
    f.put('g1', block(rng, (-5.3, 1.3, 5.8), (1.0, 1.2, 1.2), cuts=6, chamfer=(0.86, 0.97)), 0.05)
    made = hand_sculpt(bpy, p, f, 'FinalAnvil', 2600, sharp=34.0, colours=HEART_COLOURS, kinds=HEART_KINDS)
    body = stone_shader(
        (0.2, 0.19, 0.22), (0.31, 0.3, 0.33), (0.47, 0.45, 0.45), (0.13, 0.12, 0.18),
        edge=1.1, hollow=0.7, z_span=(0.0, 6.6))

    def shade(q, n, c):
        col = body(q, n, c)
        # The face, worn pale by a giant's blows.
        if q.z > 6.3 and n.z > 0.5:
            k = 0.7 + 0.3 * math.sin(q.x * 1.3 + q.y * 2.1)
            col = tuple(col[i] * (1 - k) + (0.68, 0.64, 0.58)[i] * k for i in range(3))
        return col

    paint_faces(p, made, shade)
    # The crack's gold, deep in it.
    from landmark_pieces import _glow_thread
    _glow_thread(p, crack, [0.14, 0.12, 0.11, 0.09, 0.07, 0.04], 0.95)
    _glow_thread(p, crack2, [0.09, 0.08, 0.06, 0.03], 0.85)
    # Gold crystal breaking out: the heel's crown and the waist on either flank.
    for (base, d, L, r) in (
            ((-4.5, 1.0, 6.3), (-0.45, 0.5, 1.0), 2.5, 0.42), ((-4.9, 0.3, 6.2), (-0.65, 0.05, 0.9), 1.7, 0.3),
            ((-4.2, 1.5, 6.1), (-0.1, 0.8, 0.7), 1.6, 0.26),
            ((0.1, 1.2, 3.2), (0.25, 0.95, 0.35), 2.0, 0.36), ((-0.5, 1.2, 2.7), (-0.2, 0.9, 0.2), 1.4, 0.26),
            ((-0.9, -1.2, 2.8), (-0.3, -0.95, 0.4), 2.1, 0.38), ((-0.3, -1.25, 2.4), (0.25, -0.9, 0.15), 1.3, 0.24),
            ((-2.4, 2.3, 0.9), (-0.2, 0.7, 0.75), 1.2, 0.24), ((1.0, -2.3, 0.9), (0.2, -0.7, 0.8), 1.2, 0.24)):
        with p.as_kind(PAINT):
            faces = pale_crystal(p, base, d, L, r, bright=0.1)
        crystal_grade(p, faces, base, d, L, lo=0.3)
    return p


__all__ = ['final_anvil']
