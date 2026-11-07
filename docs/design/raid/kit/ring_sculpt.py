"""The Smith's Heart's Ring kit, the seal and the stones (phase 2F,
build_smith_heart_ring_kit.py): the heart seal (four quarters of raw rock
round a bed of crystal, the crystal boss at the middle, the shards it bursts
into), the Seal Dais (its paving round the seal, the four channels the veins'
light runs in, its rim, and the inverted mountain it floats on, crystal
breaking out of it in the four veins' colours), the four crystal spires that
light as each guardian falls, the Ring's standing stones with their crystal
lamps, the cairns that make each pack's spot a place, and the jambs of the
four vein mouths, each hinting its vein.

Primal and divine (DECISIONES_DISENO.md): living rock and crystal; no metal,
no machinery, no forge. The crystal of the seal and the spires is drawn by
the runtime's own crystal shader (its glow slot carries a facet shade per
vertex, grey; the vein's colour and how lit it is are the runtime's); the
other crystals carry their emitted colour (the shared glow material), kept
deep enough that no dressing out-glows a telegraph.

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - Kit_SealDais: origin at the seal's centre on the dais's walk (z 0); the
    dais's bearings are the game's (north is -Y, east +X). Every flag top
    within [-0.01, 0.03]; the rim stands past the walk (r > 19).
  - Kit_SealQuarter: one quarter about the seal's centre, its middle bearing
    toward -Y (the runtime turns it to its vein's bearing and slides it out
    as the seal opens); top within [-0.01, 0.13], the rim proudest.
  - Kit_SealHeart: the boss, about the centre (r <= 1.8), flush.
  - Kit_SealShard*: a shard's centre (the runtime tumbles it).
  - Kit_SealSpire: the plinth's foot centre; its crystal leans toward +Y
    (the runtime turns +Y toward the seal), the tip 16 yd up, 3.2 in.
  - Kit_RingMonolith, Kit_RingCairn*: the foot's centre.
  - Kit_Jamb*: the foot's centre, the stone's inner face (toward the mouth's
    opening) toward +X; front and back alike (the pair is the same stone
    turned half round).
Deterministic: every noise is seeded, nothing reads the clock.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt, block
from gwkit import add_sculpt, crystal, hull, slab
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, Prim, RoundBox, rot
from ring_pieces import (
    BASALT, BASALT_WORN, CHANNEL, CHANNEL_LIP, CURB, CURB_WORN, FASCIA, FASCIA_DARK, FLAG, FLAG_COOL, FLAG_PALE,
    FLAG_WARM, GRIT, _area, _chip, polar_outline, prism_top,
)
from shkit import DRESSED, DUST, GLOW, PAINT, RAW, SP, TAU

# ---- palette (sRGB) ---------------------------------------------------------------------
GRANITE = (0.42, 0.41, 0.41)
GRANITE_COOL = (0.36, 0.36, 0.39)
GRANITE_WARM = (0.46, 0.43, 0.4)
GRANITE_DARK = (0.27, 0.27, 0.3)
GRANITE_PALE = (0.55, 0.53, 0.5)
SOOT = (0.17, 0.16, 0.17)
RIME = (0.74, 0.82, 0.88)
# The veins' crystal light as the shared glow material draws it (emitted
# colour), deep: a dressing accent, never a beacon.
HAMMER_GLOW = (0.74, 0.5, 0.2)
BREATH_GLOW = (0.36, 0.7, 0.86)
QUENCH_GLOW = (0.56, 0.8, 0.92)
HEAT_GLOW = (0.92, 0.82, 0.55)
LAMP_GLOW = (0.86, 0.72, 0.46)
LAMP_CORE = (1.0, 0.9, 0.68)
# The crystal shade for the runtime's crystal shader (grey: facet light).
FACET_LO = (0.55, 0.55, 0.55)
FACET_HI = (0.95, 0.95, 0.95)

STONE_COLOURS = {
    'g0': GRANITE, 'g1': GRANITE_COOL, 'g2': GRANITE_WARM, 'g3': GRANITE_DARK, 'g4': GRANITE_PALE,
    'soot': SOOT, 'rime': RIME, 'dressed': (0.5, 0.48, 0.46),
}
STONE_KINDS = {k: RAW for k in STONE_COLOURS}
STONE_KINDS['dressed'] = DRESSED

SEAL_R = 9.0
SEAL_RIM = 9.75
BOSS_R = 1.85
DAIS_R = 19.0
# Bearings of the channels (Blender: north -Y, east +X), and the veins'
# emitted colours down the keel.
CHANNELS = (0.0, 90.0, 180.0, 270.0)
KEEL_VEINS = {0.0: BREATH_GLOW, 90.0: QUENCH_GLOW, 180.0: HAMMER_GLOW, 270.0: HEAT_GLOW}


def bp(r, deg):
    a = math.radians(deg)
    return (r * math.sin(a), -r * math.cos(a))


class Fn(Prim):
    """A primitive from a distance function over a box."""

    def __init__(self, fn, lo, hi):
        self.fn = fn
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        return self.fn(X, Y, Z)


def facet_crystal(p, base, direction, h, r, color, sides=6, tip=0.22, mat=GLOW, squash=1.0, twist=0.0,
                  shade=False):
    """A crystal: a faceted prism with a pointed tip, from `base` along
    `direction`. `shade` paints each facet its own grey (the runtime's
    crystal shader reads it as the light inside)."""
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    b = Vector(base)
    pts = []
    for (t, rr) in ((0.0, 1.0), (1.0 - tip, 0.86)):
        for k in range(sides):
            a = TAU * k / sides + twist + p.rng.uniform(-0.1, 0.1)
            pts.append(b + d * (h * t) + (side * math.cos(a) + up * math.sin(a) * squash) * r * rr)
    pts.append(b + d * h + side * p.rng.uniform(-0.1, 0.1) * r)
    faces = hull(p, pts, color, mat=mat)
    if shade:
        for f in faces:
            f.normal_update()
            k = 0.5 + 0.5 * abs(f.normal.dot(Vector((0.4, -0.5, 0.75)).normalized()))
            c = tuple(FACET_LO[i] + (FACET_HI[i] - FACET_LO[i]) * k for i in range(3))
            p._paint([f], c, mat)
    return faces


def _mesh(bpy, p, f, name, target, smooth=False, colours=None, kinds=None):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, colours or STONE_COLOURS, kinds or STONE_KINDS, smooth=smooth)


def _weather(f, seed, amp=0.12, scale=0.5, band=0.45):
    n1 = Noise(seed)
    f.displace(lambda X, Y, Z: amp * n1.fbm(X * scale, Y * scale, Z * scale, 3)
               + amp * 0.35 * (n1.ridged(X * scale * 2.6, Y * scale * 2.6, Z * scale * 2.6, 2) - 0.45),
               band=band)


# ==================================================================== the dais
def _flags_round(p, rng, r0, r1, tone, gaps, lo=1.3, hi=2.4, top=(0.012, 0.032)):
    """One course of flags round the dais between r0 and r1, broken where a
    channel crosses (gaps: (bearing, half width) in yards)."""
    rm = (r0 + r1) / 2
    cuts = []
    for (b, w) in gaps:
        hw = math.degrees(math.asin(min(0.99, w / rm)))
        cuts.append((b - hw, b + hw))
    cuts.sort()
    spans = []
    for i, (a0, a1) in enumerate(cuts):
        nxt = cuts[(i + 1) % len(cuts)][0] + (360.0 if i == len(cuts) - 1 else 0.0)
        spans.append((a1, nxt))
    if not cuts:
        spans = [(0.0, 360.0)]
    for (s0, s1) in spans:
        a = s0
        while a < s1 - 1e-6:
            step = math.degrees(rng.uniform(lo, hi) / rm)
            b = min(s1, a + step)
            if s1 - b < math.degrees(0.6 / rm):
                b = s1
            ja = math.degrees(0.035 / rm)
            outline = polar_outline([('arc', r0 + 0.035, a + ja, b - ja), ('arc', r1 - 0.035, b - ja, a + ja)], step=0.9)
            if rng.random() < 0.12:
                outline = _chip(outline, rng, rng.uniform(0.15, 0.35))
            c = tone if not callable(tone) else tone()
            with p.as_kind(DRESSED):
                prism_top(p, outline, rng.uniform(*top), -0.4, p.vary(c, 0.05), bevel=rng.uniform(0.045, 0.08),
                          tilt=(rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004)))
            a = b


APRON_END = 23.0
APRON_HALF = 8.0


def _apron(p, rng, bearing, tones):
    """A stair's landing between the dais's rim and the stair's first tread
    (the stair's walk, |lateral| <= 8, from the rim's circle out to 23 yd):
    courses across the stair, the course nearest the dais cut to the rim's
    circle, the channel's gap down its middle."""
    s = -1.0 if bearing == 0.0 else 1.0      # Blender y of the outward side

    def to_xy(lat, out):
        return (lat, s * out)

    rows = [(APRON_END, 21.7), (21.7, 20.35), (20.35, None)]
    for (o0, o1) in rows:
        x = -APRON_HALF
        while x < APRON_HALF - 1e-6:
            length = min(APRON_HALF - x, rng.uniform(1.3, 2.3))
            x1 = x + length
            if APRON_HALF - x1 < 0.6:
                x1 = APRON_HALF
            # The channel's gap.
            spans = []
            if x1 <= -1.34 or x >= 1.34:
                spans.append((x, x1))
            else:
                if x < -1.34:
                    spans.append((x, -1.34))
                if x1 > 1.34:
                    spans.append((1.34, x1))
            for (a, b) in spans:
                a0, b0 = a + 0.035, b - 0.035
                if b0 - a0 < 0.25:
                    continue
                if o1 is None:
                    # Cut to the dais's circle (19 yd) on its inner edge.
                    n = max(2, int((b0 - a0) / 0.5))
                    inner = [(a0 + (b0 - a0) * k / n, math.sqrt(max(0.0, DAIS_R * DAIS_R - (a0 + (b0 - a0) * k / n)
                                                                    ** 2)) + 0.02) for k in range(n + 1)]
                    pts = [to_xy(a0, o0 - 0.035), to_xy(b0, o0 - 0.035)] + [to_xy(q[0], q[1]) for q in reversed(inner)]
                else:
                    pts = [to_xy(a0, o0 - 0.035), to_xy(b0, o0 - 0.035), to_xy(b0, o1 + 0.035), to_xy(a0, o1 + 0.035)]
                with p.as_kind(DRESSED):
                    prism_top(p, pts, rng.uniform(0.012, 0.032), -0.4, p.vary(tones(), 0.05),
                              bevel=rng.uniform(0.045, 0.08))
            x = x1


def _channel_radial(p, rng, bearing, r0, r1):
    """A light channel along a radius of the dais (bed and lips)."""
    def box_along(lat0, lat1, d0, d1, top, color, bevel):
        a = math.radians(bearing)
        ux, uy = math.sin(a), -math.cos(a)     # outward
        vx, vy = -uy, ux                       # lateral
        pts = [(ux * d0 + vx * lat0, uy * d0 + vy * lat0), (ux * d1 + vx * lat0, uy * d1 + vy * lat0),
               (ux * d1 + vx * lat1, uy * d1 + vy * lat1), (ux * d0 + vx * lat1, uy * d0 + vy * lat1)]
        prism_top(p, pts, top, -0.4, color, bevel=bevel)

    with p.as_kind(DRESSED):
        d = r0
        while d < r1 - 1e-6:
            length = min(r1 - d, rng.uniform(1.6, 2.6))
            box_along(-0.88, 0.88, d + 0.02, d + length - 0.02, 0.03, p.vary(CHANNEL, 0.04), 0.03)
            d += length
        for side in (-1, 1):
            d = r0
            while d < r1 - 1e-6:
                length = min(r1 - d, rng.uniform(1.1, 2.0))
                lo, hi = sorted((side * 0.9, side * 1.32))
                box_along(lo, hi, d + 0.025, d + length - 0.025, rng.uniform(0.07, 0.09), p.vary(CHANNEL_LIP, 0.05),
                          0.04)
                d += length


def dais_keel(bpy, p, seed=3101):
    """The inverted mountain under the dais: raw granite tapering to a root
    some 46 yd down, ledged by its beds, lobed and fissured; the four veins'
    crystal breaking out of it under each channel, and crystal hanging from
    its root."""
    rng = np.random.default_rng(seed)
    top = -2.9
    depth = 46.0
    f = Sculpt((-22.5, -22.5, top - depth - 3.0), (22.5, 22.5, top + 0.6), 0.32)
    n1, n2 = Noise(seed), Noise(seed + 9)

    def body(X, Y, Z):
        r = np.sqrt(X * X + Y * Y)
        ang = np.arctan2(X, -Y)
        t = np.clip((top - Z) / depth, 0.0, 1.0)
        # The taper: broad under the dais, a long root below, ledges where
        # the beds step in, lobes round it (never a cone).
        R = 19.9 * (1.0 - t) ** 0.72 + 0.6
        R = R * (1.0 + 0.14 * np.sin(ang * 3.0 + 0.7) * t + 0.1 * np.sin(ang * 5.0 + 2.1) * t)
        ledge = 0.9 * np.maximum(0.0, np.sin(Z * 0.55 + 1.3 * n2.fbm(X * 0.05, Y * 0.05, 0.0, 2)))
        R = R - ledge * (0.4 + t)
        return np.maximum((r - R) * 0.8, Z - top)

    f.put('g1', Fn(body, (-22.5, -22.5, top - depth - 3.0), (22.5, 22.5, top + 0.6)), 0.0)
    # Bulges of other beds.
    for k in range(9):
        a = rng.uniform(0, TAU)
        z = top - rng.uniform(3.0, 24.0)
        t = (top - z) / depth
        rr = 19.0 * (1 - t) ** 0.72
        c = (math.sin(a) * rr * 0.8, -math.cos(a) * rr * 0.8, z)
        f.put(('g0', 'g2', 'g3')[k % 3], block(rng, c, (rng.uniform(6, 11), rng.uniform(6, 11), rng.uniform(4, 8)),
                                               cuts=8, chamfer=(0.7, 0.92), R=rot(rz=float(a))), 1.2)
    # Fissures down it.
    for k in range(6):
        a = rng.uniform(0, TAU)
        pts = []
        z = top - 1.0
        while z > top - depth * 0.7:
            t = (top - z) / depth
            rr = 19.5 * (1 - t) ** 0.72
            pts.append((math.sin(a) * rr, -math.cos(a) * rr, z))
            a += rng.uniform(-0.05, 0.05)
            z -= rng.uniform(2.0, 4.0)
        if len(pts) > 1:
            f.groove(Polyline(pts, 0.25), 0.9, 0.35)
    f.displace(lambda X, Y, Z: 0.9 * n1.fbm(X * 0.08, Y * 0.08, Z * 0.06, 3)
               + 0.45 * (n1.ridged(X * 0.22, Y * 0.22, Z * 0.18, 2) - 0.45), band=2.2)
    f.cut_above(top)
    _mesh(bpy, p, f, 'SealDaisKeel', 9000)
    # The veins' crystal breaking out under each channel, and the root's.
    prng = p.rng
    for b, col in KEEL_VEINS.items():
        a = math.radians(b)
        for k in range(7):
            z = top - 2.0 - k * prng.uniform(3.0, 4.6)
            t = (top - z) / depth
            rr = 19.9 * (1 - t) ** 0.72 - 0.9
            jit = prng.uniform(-0.12, 0.12)
            ox, oy = math.sin(a + jit) * rr, -math.cos(a + jit) * rr
            out = Vector((math.sin(a + jit), -math.cos(a + jit), prng.uniform(-0.6, 0.2)))
            for j in range(prng.randint(2, 4)):
                dd = out + Vector((prng.uniform(-0.5, 0.5), prng.uniform(-0.5, 0.5), prng.uniform(-0.4, 0.3)))
                with p.as_kind(PAINT):
                    facet_crystal(p, (ox, oy, z), dd, prng.uniform(2.4, 5.6) * (1.2 - t * 0.4),
                                  prng.uniform(0.45, 0.95), p.vary(col, 0.06))
    for k in range(9):
        a = prng.uniform(0, TAU)
        r = prng.uniform(0.0, 2.2)
        base = (math.sin(a) * r, -math.cos(a) * r, top - depth * 0.92 + prng.uniform(0, 3))
        with p.as_kind(PAINT):
            facet_crystal(p, base, (prng.uniform(-0.3, 0.3), prng.uniform(-0.3, 0.3), -1.0),
                          prng.uniform(2.5, 6.0), prng.uniform(0.35, 0.8),
                          p.vary(LAMP_GLOW if k % 2 else HEAT_GLOW, 0.05))


def seal_dais(bpy):
    """The Seal Dais (see the module doc): the seal's dark basalt ring, the
    courses of dressed flags out to the rim, the four channels from the
    rim to the seal's notches, the rim's low parapet (open where the two
    stairs land and where the Quench's and the Heat's light leap onto it),
    the rim's carved face, and the keel."""
    p = SP('SealDais', seed=3001, ao=0.4, ao_dist=0.6, dust=0.6)
    rng = p.rng
    gaps = [(b, 1.34) for b in CHANNELS]
    # The grit under the paving (seen in the joints).
    outline = [bp(DAIS_R + 0.1, a * 3.0) for a in range(120)]
    outline.reverse() if _area(outline) < 0 else None
    bm = p.bm
    before = set(bm.faces)
    ring_out = [bm.verts.new((x, y, -0.06)) for x, y in outline]
    inner = [bp(SEAL_RIM - 0.1, a * 3.0) for a in range(120)]
    ring_in = [bm.verts.new((x, y, -0.06)) for x, y in inner]
    for i in range(120):
        j = (i + 1) % 120
        bm.faces.new((ring_in[i], ring_in[j], ring_out[j], ring_out[i]))
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(RAW):
        p._paint(faces, GRIT, 0)
    p.facing(faces, (0, 0, 1))
    # The seal's bed: dark rock under the quarters (it shows between them, and
    # where they part as the seal opens; the portal turns on it).
    before = set(bm.faces)
    bed = [bm.verts.new((x, y, -0.07)) for x, y in [bp(SEAL_RIM - 0.05, a * 5.0) for a in range(72)]]
    bm.faces.new(bed)
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(RAW):
        p._paint(faces, GRANITE_DARK, 0)
    p.facing(faces, (0, 0, 1))
    # The courses: the seal's basalt ring, then dressed granite out to the rim.
    _flags_round(p, rng, SEAL_RIM + 0.05, 11.1, lambda: BASALT if rng.random() < 0.7 else BASALT_WORN, gaps,
                 lo=1.0, hi=1.6)
    tones = lambda: (FLAG, FLAG_COOL, FLAG_WARM, FLAG_PALE)[rng.randrange(4)]  # noqa: E731
    for (r0, r1) in ((11.1, 12.8), (12.8, 14.6), (14.6, 16.35), (16.35, 17.95), (17.95, DAIS_R)):
        _flags_round(p, rng, r0, r1, tones, gaps)
    # The two stairs' landings out over the void (north and south, to the
    # stairs' first treads at 23 yd), paved in courses across the stair.
    for b in (0.0, 180.0):
        _apron(p, rng, b, tones)
    # The channels, from the rim (the landings' ends north and south) to the
    # seal's notch.
    for b in CHANNELS:
        _channel_radial(p, rng, b, SEAL_RIM - 0.35, APRON_END if b in (0.0, 180.0) else DAIS_R + 0.55)
    # The rim: a carved face down to the keel, and the low parapet on it.
    with p.as_kind(DRESSED):
        for lift, (z0, z1) in enumerate(((-1.4, 0.0), (-2.95, -1.4))):
            a0 = rng.uniform(0, 6)
            a = a0
            while a < a0 + 360.0 - 1e-6:
                step = rng.uniform(5.0, 9.0)
                b = min(a0 + 360.0, a + step)
                if a0 + 360.0 - b < 3.0:
                    b = a0 + 360.0
                outline = polar_outline([('arc', DAIS_R + 0.0, a + 0.12, b - 0.12),
                                         ('arc', DAIS_R + 0.62 + lift * 0.1, b - 0.12, a + 0.12)], step=1.0)
                prism_top(p, outline, z1 - 0.02, z0, p.vary(FASCIA if rng.random() < 0.7 else FASCIA_DARK, 0.05),
                          bevel=0.07)
                a = b
        # The parapet: open over the stairs (N, S) and the leaps (E, W).
        opens = [(0.0, 27.5), (180.0, 27.5), (90.0, 4.8), (270.0, 4.8)]
        a = 0.0
        while a < 360.0 - 1e-6:
            step = rng.uniform(4.5, 7.0)
            b = min(360.0, a + step)
            mid = (a + b) / 2
            if not any(abs(((mid - o + 180) % 360) - 180) < w for (o, w) in opens):
                outline = polar_outline([('arc', DAIS_R + 0.06, a + 0.15, b - 0.15), ('arc', DAIS_R + 0.68, b - 0.15,
                                                                                       a + 0.15)], step=0.9)
                prism_top(p, outline, 0.42, -0.1, p.vary(CURB, 0.05), bevel=0.06)
                outline = polar_outline([('arc', DAIS_R + 0.0, a + 0.1, b - 0.1), ('arc', DAIS_R + 0.76, b - 0.1,
                                                                                    a + 0.1)], step=0.9)
                prism_top(p, outline, 0.62, 0.38, p.vary(CURB_WORN, 0.05), bevel=0.11)
            a = b
    dais_keel(bpy, p)
    return p


# ==================================================================== the seal
def seal_quarter(bpy):
    """One quarter of the heart seal (see the module doc): a wedge of raw
    granite (a slab 0.6 thick) whose middle is a bed of crystal set in the
    rock (the vein's light fills it: the runtime's crystal shader and the
    seal's fill over it), a rough rim proud at the outside with the notch
    where the vein's channel runs in, ribs along its two sides, a lip round
    the boss."""
    p = SP('SealQuarter', seed=3201, ao=0.45, ao_dist=0.5)
    rng = p.rng
    half = 45.0 - 1.6
    # The slab under everything (dark rock between the crystals).
    with p.as_kind(RAW):
        outline = polar_outline([('arc', BOSS_R, -half, half), ('arc', SEAL_RIM, half, -half)], step=0.8)
        prism_top(p, outline, -0.03, -0.6, GRANITE_DARK, bevel=0.0)
    # The crystal bed: cells of crystal plates, each its own facet tilt.
    rings = [2.3, 3.7, 5.2, 6.7, 8.05, SEAL_R]
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        rm = (r0 + r1) / 2
        a = -half + 0.9
        end = half - 0.9
        while a < end - 1e-6:
            step = math.degrees(rng.uniform(1.0, 1.9) / rm)
            b = min(end, a + step)
            if end - b < math.degrees(0.5 / rm):
                b = end
            ja = math.degrees(0.07 / rm)
            sk = rng.uniform(-0.25, 0.25) * (b - a)
            outline = polar_outline([('arc', r0 + 0.07, a + ja, b - ja), ('pt', r1 - 0.07, b - ja + sk),
                                     ('pt', r1 - 0.07, a + ja + sk)], step=0.7)
            faces = prism_top(p, outline, rng.uniform(0.0, 0.03), -0.3, (0.8, 0.8, 0.8), bevel=0.05,
                              tilt=(rng.uniform(-0.025, 0.025), rng.uniform(-0.025, 0.025)), slot=GLOW)
            for f in faces:
                f.normal_update()
                k = 0.45 + 0.55 * abs(f.normal.dot(Vector((0.35, -0.55, 0.75)).normalized())) ** 2
                k *= rng.uniform(0.85, 1.0)
                p._paint([f], (k, k, k), GLOW)
            a = b
    with p.as_kind(RAW):
        # The rim: rough-hewn blocks, the notch at the middle for the channel.
        a = -half
        while a < half - 1e-6:
            step = math.degrees(rng.uniform(1.0, 1.8) / SEAL_RIM)
            b = min(half, a + step)
            mid = (a + b) / 2
            lat = abs(math.sin(math.radians(mid)) * SEAL_R)
            if lat > 1.25:
                outline = polar_outline([('arc', SEAL_R + 0.03, a + 0.08, b - 0.08), ('arc', SEAL_RIM + 0.12, b - 0.08,
                                                                                     a + 0.08)], step=0.7)
                prism_top(p, outline, rng.uniform(0.09, 0.13), -0.55, p.vary(GRANITE, 0.07), bevel=0.06)
            a = b
        # The ribs along the two sides (the seal's cross, raw).
        for side in (-1, 1):
            ang = side * half
            d = BOSS_R + 0.2
            while d < SEAL_RIM - 0.2:
                length = min(SEAL_RIM - 0.2 - d, rng.uniform(1.2, 2.2))
                a0 = math.radians(ang)
                ux, uy = math.sin(a0), -math.cos(a0)
                vx, vy = -uy * side, ux * side
                pts = [(ux * d - vx * 0.38, uy * d - vy * 0.38), (ux * (d + length) - vx * 0.38, uy * (d + length) - vy * 0.38),
                       (ux * (d + length) + vx * 0.02, uy * (d + length) + vy * 0.02), (ux * d + vx * 0.02, uy * d + vy * 0.02)]
                prism_top(p, pts, rng.uniform(0.07, 0.11), -0.55, p.vary(GRANITE_COOL, 0.06), bevel=0.05)
                d += length + 0.05
        # The lip round the boss.
        outline = polar_outline([('arc', BOSS_R, -half + 0.3, half - 0.3), ('arc', 2.25, half - 0.3, -half + 0.3)],
                                step=0.5)
        prism_top(p, outline, 0.08, -0.55, p.vary(GRANITE, 0.05), bevel=0.05)
    return p


def seal_heart(bpy):
    """The seal's boss: a crown of raw crystal points cut flush (a geode's
    heart), set in a ring of rock."""
    p = SP('SealHeart', seed=3251, ao=0.3, ao_dist=0.4)
    rng = p.rng
    with p.as_kind(RAW):
        outline = [bp(BOSS_R - 0.05, a * 10.0) for a in range(36)]
        inner = [bp(1.45, a * 10.0) for a in range(36)]
        prism_top(p, outline, 0.06, -0.5, GRANITE, bevel=0.05)
    # Crystal points, their tops cut at the walk (a polished geode).
    for k in range(13):
        a = rng.uniform(0, TAU)
        r = 0.0 if k == 0 else rng.uniform(0.3, 1.25)
        x, y = math.sin(a) * r, -math.cos(a) * r
        s = rng.uniform(0.32, 0.55) if k else 0.7
        pts = []
        for j in range(6):
            b = TAU * j / 6 + rng.uniform(-0.1, 0.1)
            pts.append((x + math.cos(b) * s, y + math.sin(b) * s))
        faces = prism_top(p, pts, rng.uniform(0.07, 0.12), -0.4, (0.9, 0.9, 0.9), bevel=s * 0.35,
                          tilt=(rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04)), slot=GLOW)
        for f in faces:
            f.normal_update()
            kk = 0.6 + 0.4 * abs(f.normal.z)
            p._paint([f], (kk, kk, kk), GLOW)
    _ = inner
    return p


def seal_shard(bpy, variant):
    """A shard of the seal: raw rock with a crystal face (the runtime lifts
    them out of the split and turns them round the portal)."""
    seeds = {'A': 3301, 'B': 3307, 'C': 3313}
    sizes = {'A': (1.6, 1.1, 0.7), 'B': (1.1, 0.8, 0.55), 'C': (0.8, 0.6, 0.45)}
    p = SP('SealShard' + variant, seed=seeds[variant], ao=0.4, ao_dist=0.4)
    sx, sy, sz = sizes[variant]
    with p.as_kind(RAW):
        crystal(p, (0, 0, -sz * 0.12), (sx, sy, sz * 0.8), p.vary(GRANITE_DARK, 0.06), n=14, boxy=0.45,
                jitter=0.22)
    faces = []
    for k in range(3):
        d = (p.rng.uniform(-0.5, 0.5), p.rng.uniform(-0.5, 0.5), 1.0)
        faces += facet_crystal(p, (p.rng.uniform(-sx, sx) * 0.2, p.rng.uniform(-sy, sy) * 0.2, sz * 0.1), d,
                               sz * p.rng.uniform(0.7, 1.3), min(sx, sy) * p.rng.uniform(0.18, 0.3), (0.9, 0.9, 0.9),
                               shade=True)
    return p


# ================================================================ the spires
def seal_spire(bpy):
    """One of the four crystal spires on the dais's diagonals (their layout
    prop is `sh_portal_tine`, collider r 1.6): a plinth of rough-carved
    granite, banded, and out of it a great crystal leaning in over the seal
    (its tip 16 yd up, 3.2 in), lesser crystals round its foot. The crystal
    is the runtime's (its vein's colour, dark until the vein lights)."""
    p = SP('SealSpire', seed=3401, ao=0.55, ao_dist=1.2)
    rng = np.random.default_rng(3401)
    f = Sculpt((-2.2, -2.2, -0.6), (2.2, 2.2, 3.4), 0.06)
    # The drum: faceted, a little wider at the foot, its top split open where
    # the crystal rises.
    f.put('g0', block(rng, (0, 0, 1.2), (2.2, 2.2, 2.6), cuts=10, chamfer=(0.86, 0.97)), 0.25)
    f.put('g3', block(rng, (0, 0, 0.25), (2.6, 2.6, 0.6), cuts=8, chamfer=(0.82, 0.95)), 0.15)
    f.sub(Ellipsoid((0, 0.35, 2.75), (0.95, 0.95, 0.75)), 0.15)
    # Carved bands round the drum.
    for z in (0.95, 1.85):
        pts = [(math.cos(a) * 1.2, math.sin(a) * 1.2, z) for a in np.linspace(0, TAU, 25)]
        f.groove(Polyline(pts, 0.02), 0.07, 0.05)
    _weather(f, 3401, amp=0.07, scale=1.1, band=0.3)
    f.cut_below(0.0)
    _mesh(bpy, p, f, 'SealSpirePlinth', 1700)
    # The great crystal and its brothers (glow: the runtime's crystal), a
    # cluster grown out of the split drum, every one leaning in over the
    # seal, of unequal lengths (the tallest's tip 16 yd up, 3.2 in).
    lean = Vector((0.0, 3.2, 16.0 - 2.3)).normalized()
    cluster = [
        ((0.0, 0.25, 2.3), lean, 14.0, 0.86, 0.12, 0.3),
        ((0.35, 0.05, 2.2), lean + Vector((0.22, -0.08, 0.0)), 10.2, 0.6, 0.15, 1.1),
        ((-0.4, 0.1, 2.2), lean + Vector((-0.25, -0.02, 0.05)), 8.0, 0.52, 0.16, 0.7),
        ((0.1, -0.35, 2.15), lean + Vector((0.05, -0.32, 0.0)), 6.2, 0.44, 0.18, 1.9),
        ((-0.25, 0.5, 2.3), lean + Vector((-0.1, 0.2, 0.0)), 4.6, 0.38, 0.2, 2.4),
    ]
    for (base, d, h, r, tip, tw) in cluster:
        facet_crystal(p, base, d, h, r, (0.9, 0.9, 0.9), tip=tip, shade=True, twist=tw)
    prng = p.rng
    for k in range(7):
        a = TAU * k / 7 + prng.uniform(-0.3, 0.3)
        base = (math.cos(a) * 0.7, math.sin(a) * 0.7 + 0.2, 2.2)
        d = (math.cos(a) * 0.9, math.sin(a) * 0.9 + 0.2, 1.0)
        facet_crystal(p, base, d, prng.uniform(1.0, 2.4), prng.uniform(0.16, 0.3), (0.9, 0.9, 0.9), shade=True)
    # A ring of stones at its foot (on the dais's walk: flat).
    with p.as_kind(RAW):
        for k in range(8):
            a = prng.uniform(0, TAU)
            r = prng.uniform(1.4, 1.75)
            s = prng.uniform(0.18, 0.36)
            slab(p, (math.cos(a) * r, math.sin(a) * r, s * 0.18), (s * 1.4, s, s * 0.32), p.vary(GRANITE, 0.08),
                 yaw=prng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


# ============================================================ the Ring's stones
def ring_monolith(bpy):
    """A standing stone on the Ring's outer rim (the layout's `sh_ring_pillar`,
    collider r 1.2, 12 tall): a rough-hewn menhir leaning a breath, its faces
    split along the grain, a band of carved chevrons, a cleft at its head
    where a crystal lamp burns (warm white, small), rubble round its foot."""
    p = SP('RingMonolith', seed=3501, ao=0.6, ao_dist=1.6)
    rng = np.random.default_rng(3501)
    f = Sculpt((-2.6, -2.6, -0.6), (2.6, 2.6, 13.2), 0.09)
    lean = rot(rx=0.035, ry=-0.025)
    f.put('g0', block(rng, (0, 0, 5.4), (2.2, 1.7, 11.2), cuts=12, chamfer=(0.9, 0.985), R=lean), 0.2)
    f.put('g2', block(rng, (0.15, 0.1, 9.6), (2.2, 1.7, 3.6), cuts=10, chamfer=(0.85, 0.97),
                      R=rot(rx=0.06, ry=-0.05, rz=0.2)), 0.25)
    f.put('g3', block(rng, (0, 0, 0.45), (2.5, 2.1, 1.0), cuts=10, chamfer=(0.8, 0.95)), 0.2)
    # The head's cleft (the lamp burns in it), open to both faces.
    f.sub(RoundBox((0.0, 0.0, 10.1), (0.55, 1.4, 0.95), 0.35, rot(ry=0.25)), 0.15)
    # Chevrons carved in a band on both faces.
    for face in (-1, 1):
        for k in range(4):
            x0 = -0.9 + k * 0.6
            pts = [(x0, face * 0.86, 4.8), (x0 + 0.3, face * 0.86, 5.25), (x0 + 0.6, face * 0.86, 4.8)]
            f.groove(Polyline(pts, 0.02), 0.08, 0.05)
    # Split along the grain: two long cracks.
    for s in (-1, 1):
        f.groove(Polyline([(s * 1.2, -0.4, 1.0), (s * 1.15, 0.0, 4.5), (s * 1.25, 0.3, 8.0)], 0.03), 0.18, 0.07)
    _weather(f, 3501, amp=0.12, scale=0.6, band=0.45)
    f.cut_below(0.0)
    _mesh(bpy, p, f, 'RingMonolithStone', 3200)
    prng = p.rng
    # The lamp: a small cluster of warm crystal in the cleft, its heart brighter.
    for k in range(5):
        a = TAU * k / 5 + prng.uniform(-0.3, 0.3)
        d = (math.cos(a) * 0.55, math.sin(a) * 0.55, 1.0)
        with p.as_kind(PAINT):
            facet_crystal(p, (0.1, 0.0, 9.45), d, prng.uniform(0.7, 1.2), prng.uniform(0.14, 0.22),
                          LAMP_CORE if k == 0 else p.vary(LAMP_GLOW, 0.05))
    with p.as_kind(RAW):
        for k in range(14):
            a = prng.uniform(0, TAU)
            r = prng.uniform(1.5, 2.1)
            s = prng.uniform(0.18, 0.4)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.2), (s * 1.4, s * 1.1, s * 0.5),
                    p.vary(GRANITE if k % 2 else GRANITE_COOL, 0.07), n=12, boxy=0.55, jitter=0.2,
                    yaw=prng.uniform(0, TAU), floor=0.0)
    return p


def ring_cairn(bpy, variant):
    """A pack's spot on the Ring made a place (layout `sh_ring_cairn`,
    collider r 2): A, a block fallen from the mountain, split, with a
    crystal lamp set in a rock cradle beside it; B, a toppled standing stone
    broken in two, its lamp in the break. Rubble round both."""
    seeds = {'A': 3601, 'B': 3611}
    p = SP('RingCairn' + variant, seed=seeds[variant], ao=0.6, ao_dist=1.4)
    rng = np.random.default_rng(seeds[variant])
    f = Sculpt((-3.0, -3.0, -0.6), (3.0, 3.0, 3.6), 0.07)
    if variant == 'A':
        f.put('g0', block(rng, (0.5, 0.3, 0.95), (2.6, 2.0, 1.9), cuts=10, chamfer=(0.85, 0.97),
                          R=rot(rz=0.4, rx=0.08)), 0.15)
        f.put('g2', block(rng, (0.9, -0.9, 0.45), (1.2, 0.9, 0.9), cuts=8, chamfer=(0.8, 0.95), R=rot(rz=1.1)), 0.1)
        # The cradle: a split boulder open to the sky.
        f.put('g3', Ellipsoid((-1.25, 0.2, 0.75), (0.95, 0.85, 0.8)), 0.1)
        f.sub(Ellipsoid((-1.25, 0.2, 1.15), (0.7, 0.6, 0.55)), 0.1)
        lamp = (-1.25, 0.2, 0.75)
    else:
        f.put('g0', block(rng, (-0.3, 0.0, 0.7), (3.6, 1.4, 1.3), cuts=10, chamfer=(0.88, 0.98),
                          R=rot(rz=0.25, ry=0.06)), 0.15)
        f.put('g1', block(rng, (1.25, 0.5, 0.6), (1.3, 1.2, 1.1), cuts=8, chamfer=(0.85, 0.97),
                          R=rot(rz=0.9, rx=0.2)), 0.12)
        f.sub(Ellipsoid((0.8, 0.25, 1.1), (0.55, 0.6, 0.45)), 0.1)
        lamp = (0.8, 0.25, 0.95)
    _weather(f, seeds[variant], amp=0.08, scale=0.9, band=0.35)
    f.cut_below(0.0)
    _mesh(bpy, p, f, 'RingCairn' + variant, 2600)
    prng = p.rng
    for k in range(6):
        a = TAU * k / 6 + prng.uniform(-0.3, 0.3)
        d = (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0)
        with p.as_kind(PAINT):
            facet_crystal(p, lamp, d, prng.uniform(0.6, 1.1), prng.uniform(0.12, 0.2),
                          LAMP_CORE if k == 0 else p.vary(LAMP_GLOW, 0.05))
    with p.as_kind(RAW):
        for k in range(22):
            a = prng.uniform(0, TAU)
            r = prng.uniform(0.8, 2.4)
            s = prng.uniform(0.15, 0.45)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.2), (s * 1.4, s * 1.1, s * 0.5),
                    p.vary(GRANITE if k % 3 else GRANITE_PALE, 0.07), n=10, boxy=0.55, jitter=0.2,
                    yaw=prng.uniform(0, TAU), floor=0.0)
    return p


# ============================================================ the vein mouths
def jamb(bpy, vein):
    """A vein mouth's standing stone (see the module doc), about 8.5 tall,
    leaning a breath toward the opening (+X), each its vein's:
      hammer: broad and heavy, pick-dressed, ochre geodes breaking out of it;
      breath: slender and wind-worn, twisted, holed by the gale, a pale teal
              crystal in its split crown;
      quench: squat and cracked by frost, rime on every ledge, ice-pale
              crystal growing out of its seams;
      heat:   dark and sooted, split by seams of white-gold fire, a white-gold
              crystal ember in a cradle at its head."""
    seeds = {'hammer': 3701, 'breath': 3711, 'quench': 3721, 'heat': 3731}
    seed = seeds[vein]
    p = SP('Jamb' + vein.capitalize(), seed=seed, ao=0.6, ao_dist=1.6)
    rng = np.random.default_rng(seed)
    f = Sculpt((-3.0, -3.0, -0.6), (3.0, 3.0, 10.4), 0.09)
    lean = rot(ry=0.05)
    if vein == 'hammer':
        f.put('g2', block(rng, (0, 0, 4.0), (2.8, 2.2, 8.2), cuts=12, chamfer=(0.9, 0.985), R=lean), 0.2)
        f.put('g0', block(rng, (0.1, 0.0, 8.1), (2.4, 2.0, 1.6), cuts=10, chamfer=(0.85, 0.97),
                          R=rot(ry=0.08, rz=0.15)), 0.2)
        f.sub(Ellipsoid((0.9, -1.0, 5.2), (1.0, 0.8, 1.3)), 0.15)
        f.sub(Ellipsoid((-0.6, 1.05, 2.8), (0.9, 0.7, 1.1)), 0.15)
        crown = (0.1, 0.0, 9.0)
    elif vein == 'breath':
        # Twisted: a stack of turned blocks, narrowing as it rises.
        z = 0.0
        k = 0
        while z < 8.6:
            h = rng.uniform(1.2, 1.8)
            w = 1.9 - z * 0.08
            f.put(('g4', 'g0', 'g1')[k % 3], block(rng, (0.05 * z, 0, z + h / 2), (w, w * 0.8, h * 1.1), cuts=8,
                                                     chamfer=(0.82, 0.96), R=rot(rz=0.35 * k, ry=0.05)), 0.35)
            z += h * 0.9
            k += 1
        f.sub(Ellipsoid((0.2, 0.0, 3.6), (1.4, 0.35, 0.45), rot(rz=0.6)), 0.12)
        f.sub(Ellipsoid((0.4, 0.0, 6.3), (1.2, 0.3, 0.4), rot(rz=-0.5)), 0.12)
        f.sub(RoundBox((0.45, 0.0, 8.8), (0.25, 1.3, 0.9), 0.15), 0.12)
        crown = (0.45, 0.0, 8.2)
    elif vein == 'quench':
        f.put('g1', block(rng, (0, 0, 3.4), (2.6, 2.3, 7.0), cuts=12, chamfer=(0.9, 0.985), R=lean), 0.2)
        f.put('g0', block(rng, (0.0, 0.1, 7.3), (2.2, 2.0, 1.5), cuts=10, chamfer=(0.85, 0.97), R=rot(rz=-0.2)),
              0.2)
        # Frost cracks and rime on the ledges.
        for s in (-1, 1):
            f.groove(Polyline([(s * 1.25, -0.6, 0.6), (s * 1.3, 0.2, 3.5), (s * 1.2, -0.3, 6.6)], 0.03), 0.2, 0.08)
        crown = (0.0, 0.1, 8.1)
    else:
        f.put('soot', block(rng, (0, 0, 3.9), (2.5, 2.2, 7.9), cuts=12, chamfer=(0.9, 0.985), R=lean), 0.2)
        f.put('g3', block(rng, (0.1, 0.0, 7.9), (2.2, 2.0, 1.4), cuts=10, chamfer=(0.85, 0.97), R=rot(rz=0.3)), 0.2)
        f.sub(Ellipsoid((0.15, 0.0, 8.75), (0.75, 0.75, 0.6)), 0.12)
        crown = (0.15, 0.0, 8.4)
    _weather(f, seed, amp=0.1, scale=0.7, band=0.4)
    f.cut_below(0.0)
    _mesh(bpy, p, f, 'Jamb' + vein, 3200)
    prng = p.rng
    if vein == 'hammer':
        # Ochre geodes broken open in its flanks, a crown of crystal on top.
        for (c, out) in (((0.9, -0.75, 5.2), (0.2, -1.0, 0.1)), ((-0.6, 0.8, 2.8), (-0.2, 1.0, 0.1))):
            for k in range(9):
                d = (out[0] + prng.uniform(-0.6, 0.6), out[1] + prng.uniform(-0.3, 0.3), prng.uniform(-0.5, 0.8))
                base = (c[0] + prng.uniform(-0.4, 0.4), c[1] - out[1] * 0.35, c[2] + prng.uniform(-0.6, 0.6))
                with p.as_kind(PAINT):
                    facet_crystal(p, base, d, prng.uniform(0.6, 1.3), prng.uniform(0.12, 0.24),
                                  p.vary(HAMMER_GLOW, 0.08))
        for k in range(4):
            a = TAU * k / 4 + prng.uniform(-0.3, 0.3)
            with p.as_kind(PAINT):
                facet_crystal(p, crown, (math.cos(a) * 0.4, math.sin(a) * 0.4, 1.0), prng.uniform(0.9, 1.6),
                              prng.uniform(0.16, 0.26), p.vary(HAMMER_GLOW, 0.06))
    elif vein == 'breath':
        for k in range(4):
            a = TAU * k / 4 + prng.uniform(-0.3, 0.3)
            with p.as_kind(PAINT):
                facet_crystal(p, crown, (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.0), prng.uniform(0.9, 1.6),
                              prng.uniform(0.14, 0.24), p.vary(BREATH_GLOW, 0.06))
    elif vein == 'quench':
        # Ice growing out of the frost cracks in clusters, longest low down.
        for (s, z0) in ((-1, 1.4), (1, 2.6), (-1, 5.2), (1, 6.4)):
            for k in range(5):
                z = z0 + prng.uniform(-0.5, 0.5)
                base = (s * prng.uniform(1.05, 1.25), prng.uniform(-0.6, 0.6), z)
                d = (s * 1.0, prng.uniform(-0.6, 0.6), prng.uniform(0.1, 1.0))
                with p.as_kind(PAINT):
                    facet_crystal(p, base, d, prng.uniform(0.8, 2.0) * (1.25 - z / 10), prng.uniform(0.12, 0.26),
                                  p.vary(QUENCH_GLOW if k % 2 else RIME, 0.06))
        for k in range(3):
            a = TAU * k / 3 + 0.4
            with p.as_kind(PAINT):
                facet_crystal(p, crown, (math.cos(a) * 0.35, math.sin(a) * 0.35, 1.0), prng.uniform(0.8, 1.3),
                              prng.uniform(0.16, 0.26), p.vary(QUENCH_GLOW, 0.05))
    else:
        # Seams of fire split down its faces, branching (glow strips).
        def seam(x, y, z, z_end, w, depth=0):
            pts = [Vector((x, y, z))]
            while z > z_end:
                x += prng.uniform(-0.3, 0.3)
                z -= prng.uniform(0.45, 0.9)
                pts.append(Vector((x, y, z)))
                if depth < 1 and prng.random() < 0.25:
                    seam(x, y, z, z - prng.uniform(1.0, 2.2), w * 0.6, depth + 1)
            for a, b in zip(pts, pts[1:]):
                with p.as_kind(PAINT):
                    p.sweep([a, b], w, w * 0.8, p.vary(HEAT_GLOW, 0.05), sides=4, mat=GLOW)

        for s in (-1, 1):
            seam(s * 0.15, s * 1.12, 7.6, 0.4, 0.09)
            seam(1.25 * s, s * 0.3, 6.0, 2.0, 0.07)
        for k in range(5):
            a = TAU * k / 5 + prng.uniform(-0.3, 0.3)
            with p.as_kind(PAINT):
                facet_crystal(p, crown, (math.cos(a) * 0.45, math.sin(a) * 0.45, 1.0), prng.uniform(0.5, 0.95),
                              prng.uniform(0.12, 0.2), LAMP_CORE if k == 0 else p.vary(HEAT_GLOW, 0.05))
    with p.as_kind(RAW):
        for k in range(10):
            a = prng.uniform(0, TAU)
            r = prng.uniform(1.5, 2.3)
            s = prng.uniform(0.2, 0.5)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.25), (s * 1.4, s * 1.1, s * 0.55),
                    p.vary(GRANITE_DARK if vein == 'heat' else GRANITE, 0.07), n=10, boxy=0.55, jitter=0.2,
                    yaw=prng.uniform(0, TAU), floor=0.0)
    return p
