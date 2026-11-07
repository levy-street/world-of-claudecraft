"""The Smith's Heart's gate kit (build_smith_heart_gate_kit.py): the carved
stone every vein gate and the Heart Bridge's gate stand on, and the crystal
its curtain of light rises from.

The raid is primal and divine (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md):
nothing metal, no machinery. A gate is no bronze sill and no bars; it is the
Smith's own threshold cut in the living granite (the Ring's dressed stone, the
same chevrons), a channel down its top where crystal grows, and at each end a
rough-hewn standing stone with a crystal in the cleft of its head. The light
that bars the way (a curtain rising out of the channel) is the runtime's
shader; its colour is the vein's, so every crystal here is painted a pale
facet grey and tinted by the gate it stands in.

  - Kit_GateSill: the threshold across the passage (15.2 yd, the width every
    forge seal gate shares): five dressed blocks of uneven length set end to
    end, worn arrises, a corner knocked off, the Smith's chevrons carved in a
    band down both long faces, a channel down the middle of its top with a
    bed of crystal in it and four small clusters standing proud of it (none
    within 2 yd of the middle: the line a raid looks along stays clear).
  - Kit_GateStone: the standing stone at one end (2.8 tall, its inner face
    toward +X, the passage): two blocks, the upper turned a little, a band of
    chevrons, a cleft at its head where a crystal crown grows, rubble at its
    foot.

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - Kit_GateSill: origin at the middle of the threshold on the floor, the
    passage across X (from -7.6 to 7.6), the gate's depth along Y (0.9),
    the top at z 0.6 (the plan's sill height).
  - Kit_GateStone: origin at its foot's centre, the inner face toward +X.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Vector

from gravewyrm_sculpt import Sculpt, block
from gwkit import crystal
from jaguar_head_sculpt import Polyline, RoundBox, rot
from ring_sculpt import GRANITE, GRANITE_COOL, _mesh, _weather, facet_crystal
from shkit import PAINT, RAW, SP, TAU

# The plan's measures (heart_gates_core.ts HEART_SEAL_BARRIER, the gates' hw).
SILL = dict(half=7.6, depth=0.9, top=0.6, channel=0.13, channel_depth=0.16)
STONE = dict(w=1.2, d=1.3, h=2.8)
# The crystal's facet greys: the runtime tints them with the gate's vein.
FACET_LO = (0.58, 0.58, 0.6)
FACET_HI = (0.98, 0.98, 1.0)
LIGHT = Vector((0.35, -0.55, 0.76)).normalized()


def pale_crystal(p, base, direction, h, r, sides=6, tip=0.26):
    """A crystal for a tinted slot: each facet its own pale grey (the light
    inside), the tip a value brighter."""
    faces = facet_crystal(p, base, direction, h, r, FACET_HI, sides=sides, tip=tip,
                          twist=p.rng.uniform(0, TAU))
    b = Vector(base)
    d = Vector(direction).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(LIGHT)
        t = max(0.0, min(1.0, (fc.calc_center_median() - b).dot(d) / max(1e-3, h)))
        c = tuple(FACET_LO[i] + (FACET_HI[i] - FACET_LO[i]) * min(1.0, 0.25 + 0.6 * k + 0.25 * t)
                  for i in range(3))
        for loop in fc.loops:
            loop[p.col] = (*c, 1.0)
    return faces


def gate_sill(bpy):
    """The threshold (see the module doc)."""
    p = SP('GateSill', seed=4101, ao=0.55, ao_dist=0.8, dust=0.6)
    rng = np.random.default_rng(4101)
    S = SILL
    f = Sculpt((-S['half'] - 0.4, -0.85, -0.4), (S['half'] + 0.4, 0.85, S['top'] + 0.3), 0.035)
    # Five blocks of uneven length, end to end, a hairline joint between.
    cuts = [-S['half']]
    lengths = [2.9, 3.4, 2.6, 3.5, 2.8]
    total = sum(lengths)
    x = -S['half']
    for L in lengths:
        x += L * (2 * S['half']) / total
        cuts.append(x)
    tones = ('g0', 'g1', 'g2', 'g0', 'g4')
    for i in range(len(lengths)):
        x0, x1 = cuts[i] + 0.03, cuts[i + 1] - 0.03
        settle = rot(rz=float(rng.uniform(-0.006, 0.006)), ry=float(rng.uniform(-0.004, 0.004)))
        f.put(tones[i], block(rng, ((x0 + x1) / 2, 0.0, S['top'] - (S['top'] + 0.35) / 2),
                              (x1 - x0, S['depth'], S['top'] + 0.35), cuts=9, chamfer=(0.9, 0.985),
                              R=settle), 0.04)
    # The channel down the middle of the top, end to end but for a lip at
    # each end.
    f.sub(RoundBox((0.0, 0.0, S['top']), (S['half'] - 0.35, S['channel'], S['channel_depth']), 0.05), 0.03)
    # The Smith's chevrons in a band down both long faces.
    for face in (-1, 1):
        x = -S['half'] + 0.5
        while x < S['half'] - 0.6:
            pts = [(x, face * S['depth'] / 2, 0.16), (x + 0.22, face * S['depth'] / 2, 0.42),
                   (x + 0.44, face * S['depth'] / 2, 0.16)]
            f.groove(Polyline(pts, 0.012), 0.045, 0.03)
            x += 0.62
    # A corner knocked off, a crack across one block.
    f.sub(RoundBox((S['half'] - 0.1, 0.42, S['top'] - 0.05), (0.35, 0.2, 0.18), 0.06, rot(rz=0.4)), 0.04)
    f.groove(Polyline([(cuts[2] + 0.9, -0.46, 0.6), (cuts[2] + 1.05, 0.0, 0.62), (cuts[2] + 0.8, 0.46, 0.6)], 0.01),
             0.06, 0.025)
    _weather(f, 4101, amp=0.025, scale=1.6, band=0.12)
    f.cut_below(-0.15)
    _mesh(bpy, p, f, 'GateSillStone', 5200)
    prng = p.rng
    # The bed of crystal in the channel: low prisms lying along it, a hair
    # under the top (the curtain rises out of them).
    xx = -S['half'] + 0.55
    while xx < S['half'] - 0.55:
        L = float(prng.uniform(0.35, 0.55))
        d = (1.0, float(prng.uniform(-0.15, 0.15)), float(prng.uniform(0.08, 0.3)))
        with p.as_kind(PAINT):
            pale_crystal(p, (xx, float(prng.uniform(-0.03, 0.03)), S['top'] - S['channel_depth'] - 0.02), d,
                         L, float(prng.uniform(0.05, 0.08)), tip=0.35)
        xx += L * 0.62
    # Four small clusters standing proud of the channel (never in the
    # middle 2 yd), each under 0.5 over the top.
    for cx in (-6.0, -3.1, 3.1, 6.0):
        base = (cx + float(prng.uniform(-0.2, 0.2)), 0.0, S['top'] - S['channel_depth'] + 0.04)
        for k in range(5):
            a = TAU * k / 4 + float(prng.uniform(-0.4, 0.4))
            lean = 0.0 if k == 0 else 0.45
            d = (math.cos(a) * lean, math.sin(a) * lean * 0.5, 1.0)
            with p.as_kind(PAINT):
                pale_crystal(p, base, d, float(prng.uniform(0.55, 0.66)) * (1.0 if k == 0 else 0.68),
                             float(prng.uniform(0.08, 0.12)))
    # Grit and a spall or two at the threshold's feet (flat).
    with p.as_kind(RAW):
        for _ in range(14):
            x = float(prng.uniform(-S['half'], S['half']))
            y = float(prng.choice([-1, 1])) * float(prng.uniform(0.5, 0.75))
            s = float(prng.uniform(0.07, 0.16))
            crystal(p, (x, y, s * 0.2), (s * 1.4, s * 1.1, s * 0.4), p.vary(GRANITE if prng.random() < 0.5
                                                                         else GRANITE_COOL, 0.07),
                    n=10, boxy=0.55, jitter=0.2, yaw=float(prng.uniform(0, TAU)), floor=0.0)
    return p


def gate_stone(bpy):
    """The standing stone at a threshold's end (see the module doc)."""
    p = SP('GateStone', seed=4111, ao=0.6, ao_dist=1.0, dust=0.7)
    rng = np.random.default_rng(4111)
    S = STONE
    f = Sculpt((-1.2, -1.2, -0.4), (1.2, 1.2, S['h'] + 0.4), 0.04)
    lean = rot(ry=0.035, rx=-0.02)
    # A hewn body tapering to its head, the head a second block turned a
    # little on it, a footing stone sunk round its foot.
    f.put('g0', block(rng, (-0.05, 0.0, 1.0), (S['w'], S['d'], 2.1), cuts=14, chamfer=(0.86, 0.98), R=lean), 0.12)
    f.put('g0', block(rng, (-0.08, 0.0, 1.75), (S['w'] * 0.86, S['d'] * 0.88, 0.9), cuts=10, chamfer=(0.84, 0.97),
                      R=lean), 0.18)
    f.put('g2', block(rng, (-0.05, 0.03, 2.22), (S['w'] * 0.8, S['d'] * 0.82, 0.62), cuts=10, chamfer=(0.8, 0.96),
                      R=rot(rz=0.22, ry=0.06)), 0.12)
    f.put('g3', block(rng, (0.0, 0.0, 0.16), (S['w'] + 0.3, S['d'] + 0.25, 0.4), cuts=10, chamfer=(0.8, 0.95)),
          0.1)
    # The cleft at its head: a notch open to the passage's side and the sky.
    f.sub(RoundBox((0.34, 0.0, 2.52), (0.36, 0.3, 0.4), 0.12, rot(ry=-0.45)), 0.08)
    # A band of chevrons round its waist (both broad faces and the inner).
    for face in (-1, 1):
        for k in range(3):
            x0 = -0.5 + k * 0.34
            y = face * (S['d'] / 2 - 0.02)
            f.groove(Polyline([(x0, y, 1.35), (x0 + 0.17, y, 1.58), (x0 + 0.34, y, 1.35)], 0.012), 0.05, 0.03)
    for k in range(3):
        y0 = -0.5 + k * 0.34
        f.groove(Polyline([(S['w'] / 2 - 0.02, y0, 1.35), (S['w'] / 2 - 0.02, y0 + 0.17, 1.58),
                           (S['w'] / 2 - 0.02, y0 + 0.34, 1.35)], 0.012), 0.05, 0.03)
    # Split along the grain.
    f.groove(Polyline([(-0.62, -0.2, 0.4), (-0.6, 0.1, 1.2), (-0.64, -0.1, 2.0)], 0.02), 0.08, 0.035)
    _weather(f, 4111, amp=0.05, scale=1.2, band=0.2)
    f.cut_below(0.0)
    _mesh(bpy, p, f, 'GateStoneBody', 2600)
    prng = p.rng
    # The crown: a small cluster of crystal in the cleft, its tallest under
    # three yards.
    for k in range(5):
        a = TAU * k / 5 + float(prng.uniform(-0.3, 0.3))
        lean = 0.0 if k == 0 else 0.55
        d = (math.cos(a) * lean + 0.12, math.sin(a) * lean, 1.0)
        with p.as_kind(PAINT):
            pale_crystal(p, (0.2, 0.0, 2.24), d, float(prng.uniform(0.6, 0.7)) * (1.0 if k == 0 else 0.72),
                         float(prng.uniform(0.09, 0.13)))
    with p.as_kind(RAW):
        for _ in range(10):
            a = float(prng.uniform(0, TAU))
            r = float(prng.uniform(0.75, 1.05))
            s = float(prng.uniform(0.1, 0.22))
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.2), (s * 1.4, s * 1.1, s * 0.45),
                    p.vary(GRANITE if prng.random() < 0.5 else GRANITE_COOL, 0.07), n=10, boxy=0.55,
                    jitter=0.2, yaw=float(prng.uniform(0, TAU)), floor=0.0)
    return p
