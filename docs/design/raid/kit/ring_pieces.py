"""The Smith's Heart's Ring kit, cut stone (phase 2F, build_smith_heart_ring_kit.py):
the Ring's paving, its curb over the chasm and the rubble at the mountain's
foot, the light-rivers' channels, the two stairs down to the seal (treads,
the channel down their middle, the carved stringers and low parapets), and the
thresholds of the vein mouths.

The raid is primal and divine (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md):
the Ring is a sacred circle cut out of the living granite long before any
forge, so nothing here is metal or machinery. Dressed granite flags in courses
round the seal, a band of dark basalt running the whole circle (the
processional ring), worn arrises, chipped corners, a crack here and there,
grit in the joints; crystal only where the veins' light runs.

Frames (the kit's: yards, +Z up, the game's +Z is Blender -Y):
  - Kit_RingPave*: a 6 degree sector of the Ring (radius 62 to 78) about its
    centre: the origin is the Ring's centre, the sector's middle bearing is
    Blender -Y (the runtime turns it by its bearing). Walk at z 0: every flag
    top within [-0.01, 0.03], the joints' grit at -0.06.
  - Kit_RingChannel: a light-river's channel inlaid over the paving, along
    the radius: origin at the Ring's centre line (r 70) on the channel's axis,
    the channel running along Blender Y (toward the seal is +Y), 17 yd long,
    its bed at z 0.035, its lips under a hand (z <= 0.1).
  - Edge pieces (Kit_RingCurb*, Kit_RingFoot*, Kit_StairParapet*): a module
    along X (6 yd at stretch 1), origin on the walk's lip at the walk's
    height, the drop toward -Y, the walk toward +Y (the edge planner's frame).
    A curb stands under a hand over the walk (z < 0.3); a parapet and a
    stringer stand wholly past the lip (y < -0.05).
  - Stair pieces (Kit_StairTread*, Kit_StairChute): the stair's run along +X
    (down the stair), across along Y, origin at the tread's top centre; a
    tread's top at z 0, its nosing at +X, its block down past the next tread.
    The chute along X too, its top the ramp's line (sheared by the runtime).
  - Kit_Jamb*: a vein mouth's standing stone, origin at its foot's centre,
    the mouth's axis toward -X (the runtime turns a pair across the mouth).
  - Kit_RingSill: the mouth's threshold, along X, flush (z <= 0.05).
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import bmesh
from mathutils import Vector

from gwkit import crystal, hull, mix, slab
from shkit import DRESSED, DUST, GLOW, PAINT, RAW, SP, TAU

# ---- the Ring's stone (sRGB) ---------------------------------------------------------
# Dressed Stormcrag granite: mid greys (under the low sun a pale flag reads as
# a white tile), warm and cool stones mixed (M5), a few paler worn ones; the
# processional band a dark basalt; the grit in the joints a cool dark grey,
# never black (L6).
# (Phase 2F review: at 0.5 the flags under the Ring's low sun read as a pale
# sand tile; the dressed granite sits a value lower, its stones apart.)
FLAG = (0.41, 0.395, 0.38)
FLAG_COOL = (0.36, 0.36, 0.38)
FLAG_WARM = (0.45, 0.415, 0.375)
FLAG_PALE = (0.5, 0.485, 0.455)
FLAG_DARK = (0.31, 0.305, 0.31)
BASALT = (0.22, 0.22, 0.24)
BASALT_WORN = (0.27, 0.265, 0.275)
GRIT = (0.21, 0.205, 0.215)
CHANNEL = (0.17, 0.17, 0.2)
CHANNEL_LIP = (0.43, 0.425, 0.43)
CURB = (0.42, 0.41, 0.4)
CURB_WORN = (0.47, 0.455, 0.43)
FASCIA = (0.37, 0.365, 0.37)
FASCIA_DARK = (0.29, 0.29, 0.31)
SCREE = (0.4, 0.39, 0.39)
SCREE_DARK = (0.3, 0.3, 0.32)

# ---- the Ring's measures --------------------------------------------------------------
RING_R0 = 62.0
RING_R1 = 78.0
SECTOR = 6.0
# The courses (radii), shared by every module so they run on round the whole
# circle; the band between 69.1 and 70.9 is the processional basalt.
COURSES = [62.0, 63.35, 65.2, 67.05, 69.1, 70.9, 72.75, 74.55, 76.35, 78.0]
BAND = 4
# Each course's joints are staggered by its own offset (degrees) at every
# module's ends, so no radial joint runs straight across the Ring.
OFFSETS = [0.0, 1.9, 0.7, 2.6, 1.3, 0.35, 2.2, 1.0, 2.9]
JOINT = 0.035


def bp(r, deg):
    """Blender point at radius r and bearing deg (clockwise from the
    module's middle, which is Blender -Y)."""
    a = math.radians(deg)
    return (r * math.sin(a), -r * math.cos(a))


def _area(pts):
    s = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return s / 2


def _inset(pts, d):
    """Offset a counter-clockwise polygon inward by d (corner bisectors)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0 = Vector((*pts[i - 1], 0))
        p1 = Vector((*pts[i], 0))
        p2 = Vector((*pts[(i + 1) % n], 0))
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = Vector((-e0.y, e0.x, 0))
        n1 = Vector((-e1.y, e1.x, 0))
        b = n0 + n1
        if b.length < 1e-6:
            b = n0
        b.normalize()
        k = d / max(0.35, b.dot(n0))
        out.append((p1.x + b.x * k, p1.y + b.y * k))
    return out


def prism_top(p, outline, top, bottom, color, bevel=0.06, tilt=(0.0, 0.0), slot=0, dip=0.0):
    """A flat stone: the outline (x, y) extruded from `bottom` up to `top`,
    its top edge worn round by `bevel` (the top an inset of the outline, the
    arris a band falling `bevel` to the side). `tilt` (dz per yard in x, y)
    settles it; `dip` hollows its middle (a worn tread). Returns the faces."""
    pts = list(outline)
    if _area(pts) < 0:
        pts.reverse()
    bm = p.bm
    before = set(bm.faces)
    cx = sum(q[0] for q in pts) / len(pts)
    cy = sum(q[1] for q in pts) / len(pts)

    def z_at(x, y, base):
        return base + (x - cx) * tilt[0] + (y - cy) * tilt[1]

    inner = _inset(pts, bevel)
    top_v = [bm.verts.new((x, y, z_at(x, y, top))) for x, y in inner]
    edge_v = [bm.verts.new((x, y, z_at(x, y, top - bevel * 0.85))) for x, y in pts]
    foot_v = [bm.verts.new((x, y, bottom)) for x, y in pts]
    n = len(pts)
    if dip > 0 and n >= 3:
        # A worn hollow: a middle vertex sunk a little (the top fans to it).
        mid = bm.verts.new((sum(v.co.x for v in top_v) / n, sum(v.co.y for v in top_v) / n,
                            z_at(cx, cy, top) - dip))
        for i in range(n):
            bm.faces.new((top_v[i], top_v[(i + 1) % n], mid))
    else:
        bm.faces.new(top_v)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((edge_v[i], edge_v[j], top_v[j], top_v[i]))
        bm.faces.new((foot_v[i], foot_v[j], edge_v[j], edge_v[i]))
    faces = [f for f in bm.faces if f not in before]
    p._paint(faces, color, slot)
    # Wound outward by construction: finish() never re-winds them.
    for f in faces:
        f[p.keep] = 1
    return faces


def polar_outline(spec, step=1.1):
    """A polygon from a list of polar runs: ('arc', r, deg0, deg1) runs
    along radius r (subdivided every `step` yards), ('pt', r, deg) a corner."""
    out = []
    for item in spec:
        if item[0] == 'pt':
            out.append(bp(item[1], item[2]))
            continue
        _, r, a0, a1 = item
        span = math.radians(abs(a1 - a0)) * r
        n = max(1, int(math.ceil(span / step)))
        for k in range(n + 1):
            out.append(bp(r, a0 + (a1 - a0) * k / n))
    # Drop repeats.
    clean = []
    for q in out:
        if not clean or math.hypot(q[0] - clean[-1][0], q[1] - clean[-1][1]) > 1e-4:
            clean.append(q)
    if math.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) < 1e-4:
        clean.pop()
    return clean


def _chip(outline, rng, depth):
    """Knock one corner off an outline (the dark grit shows where it went)."""
    n = len(outline)
    i = int(rng.integers(0, n)) if hasattr(rng, 'integers') else rng.randrange(n)
    a = Vector((*outline[i - 1], 0))
    b = Vector((*outline[i], 0))
    c = Vector((*outline[(i + 1) % n], 0))
    da = min(depth, (a - b).length * 0.45)
    dc = min(depth, (c - b).length * 0.45)
    p0 = b + (a - b).normalized() * da
    p1 = b + (c - b).normalized() * dc
    return outline[:i] + [(p0.x, p0.y), (p1.x, p1.y)] + outline[i + 1:]


def _flag_tone(rng, course):
    if course == BAND:
        return BASALT if rng.random() < 0.75 else BASALT_WORN
    r = rng.random()
    if r < 0.28:
        return FLAG
    if r < 0.5:
        return FLAG_COOL
    if r < 0.7:
        return FLAG_WARM
    if r < 0.8:
        return FLAG_PALE
    return FLAG_DARK


def lay_flag(p, rng, r0, r1, a0, a1, course, crack=0.12, chip=0.14, sink=0.12):
    """One dressed flag of the Ring between radii r0, r1 and bearings a0, a1
    (degrees): its joints, its own tone, a settle, sometimes a corner chipped
    off or the flag cracked across into two."""
    rm = (r0 + r1) / 2
    ja = math.degrees(JOINT / rm)
    a0j, a1j = a0 + ja, a1 - ja
    r0j, r1j = r0 + JOINT, r1 - JOINT
    tone = _flag_tone(rng, course)
    # Every top a breath over the field's own walk under the paving (so the
    # depth test never fights it), the settled ones only a little lower.
    top = rng.uniform(0.012, 0.032)
    if rng.random() < sink:
        top -= rng.uniform(0.003, 0.005)
    tilt = (rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004))
    bevel = rng.uniform(0.05, 0.09)
    pieces = []
    if rng.random() < crack and (a1 - a0) * math.pi / 180 * rm > 1.6:
        # Cracked across: two stones, the break skewed and kinked.
        m = (a0j + a1j) / 2 + rng.uniform(-0.25, 0.25) * (a1j - a0j)
        sk = rng.uniform(-0.18, 0.18) * (a1j - a0j)
        gap = math.degrees(0.018 / rm)
        mid_r = rng.uniform(r0j + 0.3, r1j - 0.3)
        kink = rng.uniform(-0.1, 0.1) * (a1j - a0j)
        left = polar_outline([('arc', r0j, a0j, m - sk - gap), ('pt', mid_r, m + kink - gap),
                              ('pt', r1j, m + sk - gap), ('arc', r1j, m + sk - gap, a0j)])
        right = polar_outline([('arc', r0j, m - sk + gap, a1j), ('arc', r1j, a1j, m + sk + gap),
                               ('pt', mid_r, m + kink + gap)])
        pieces = [left, right]
    else:
        pieces = [polar_outline([('arc', r0j, a0j, a1j), ('arc', r1j, a1j, a0j)])]
    for k, outline in enumerate(pieces):
        if rng.random() < chip:
            outline = _chip(outline, rng, rng.uniform(0.18, 0.42))
        t = top - (rng.uniform(0.0, 0.004) if k else 0.0)
        with p.as_kind(DRESSED):
            prism_top(p, outline, t, -0.32, p.vary(tone, 0.08), bevel=bevel, tilt=tilt)


def lay_bed(p, r0, r1, a0, a1):
    """The grit the flags are set in (only seen in the joints)."""
    outline = polar_outline([('arc', r0, a0, a1), ('arc', r1, a1, a0)], step=2.0)
    if _area(outline) < 0:
        outline.reverse()
    bm = p.bm
    before = set(bm.faces)
    bm.faces.new([bm.verts.new((x, y, -0.06)) for x, y in outline])
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(RAW):
        p._paint(faces, GRIT, 0)
    p.facing(faces, (0, 0, 1))


def ring_pave(variant):
    """A 6 degree sector of the Ring's paving (see the module doc). Variants
    A to D differ in their joints and stones; Start and End close the Ring's
    arc square at its two ends (the Balcony Stairs' feet)."""
    seeds = {'A': 2101, 'B': 2111, 'C': 2129, 'D': 2141, 'Start': 2153, 'End': 2161}
    p = SP('RingPave' + variant, seed=seeds[variant], ao=0.35, ao_dist=0.5, dust=0.7)
    rng = p.rng
    half = SECTOR / 2
    for c in range(len(COURSES) - 1):
        r0, r1 = COURSES[c], COURSES[c + 1]
        o = OFFSETS[c]
        a0 = -half + (0.0 if variant == 'Start' else o)
        a1 = half + (0.0 if variant == 'End' else o)
        lay_bed(p, r0 - 0.02, r1 + 0.02, a0 - 0.05, a1 + 0.05)
        rm = (r0 + r1) / 2
        # Flags along the course: unequal lengths (a long stone beside short
        # ones), the band's basalt in shorter blocks.
        lo, hi = (1.0, 1.9) if c == BAND else (1.5, 3.3)
        a = a0
        while a < a1 - 1e-6:
            length = rng.uniform(lo, hi)
            step = math.degrees(length / rm)
            b = min(a1, a + step)
            if a1 - b < math.degrees(0.7 / rm):
                b = a1
            lay_flag(p, rng, r0, r1, a, b, c)
            a = b
    # Grit and a few spalls drifted in the joints (flat).
    with p.as_kind(RAW):
        for _ in range(9):
            r = rng.uniform(RING_R0 + 1.2, RING_R1 - 1.0)
            d = rng.uniform(-half + 0.5, half + 0.5)
            x, y = bp(r, d)
            s = rng.uniform(0.1, 0.26)
            slab(p, (x, y, 0.035), (s * 1.4, s, s * 0.22), p.vary(FLAG_PALE, 0.08), yaw=rng.uniform(0, TAU),
                 chamfer=0.25, jitter=0.15)
    return p


def ring_channel():
    """A light-river's channel across the Ring: two carved lips under a
    hand, a polished dark bed between them (the river's ribbon draws on it),
    and at each end a worn step down into the joint. Along Blender Y from
    -8.5 (the vein's side) to +8.5 (toward the seal)."""
    p = SP('RingChannel', seed=2171, ao=0.4, ao_dist=0.5)
    rng = p.rng
    L = 8.5
    with p.as_kind(DRESSED):
        # The bed: long polished slabs end to end.
        y = -L
        while y < L - 1e-6:
            length = min(L - y, rng.uniform(1.8, 3.0))
            prism_top(p, [(-0.88, y + 0.02), (0.88, y + 0.02), (0.88, y + length - 0.02), (-0.88, y + length - 0.02)],
                      0.035, -0.3, p.vary(CHANNEL, 0.04), bevel=0.03)
            y += length
        # The lips: carved kerbs either side, their arrises worn.
        for side in (-1, 1):
            y = -L
            while y < L - 1e-6:
                length = min(L - y, rng.uniform(1.2, 2.4))
                x0, x1 = side * 0.9, side * 1.32
                prism_top(p, [(min(x0, x1), y + 0.025), (max(x0, x1), y + 0.025), (max(x0, x1), y + length - 0.025),
                              (min(x0, x1), y + length - 0.025)], rng.uniform(0.075, 0.095), -0.3,
                          p.vary(CHANNEL_LIP, 0.05), bevel=0.04)
                y += length
    return p


def ring_curb(variant):
    """A 6 yd module of the Ring's lip over the chasm: dressed curbstones of
    uneven length a hand proud of the walk, a carved fascia under them down
    the face (three lifts of dressed blocks, battered out a little at the
    foot, a string course under the curb). B has lost a curbstone (its bed
    shows) and a block of the fascia has slipped."""
    p = SP('RingCurb' + variant, seed=2201 + ord(variant), ao=0.55, ao_dist=0.9)
    rng = p.rng
    with p.as_kind(DRESSED):
        # The string course: one long band under the curb, its lip rounded.
        x = -3.05
        while x < 3.05:
            length = min(3.05 - x, rng.uniform(1.6, 2.6))
            slab(p, (x + length / 2, -0.28, -0.36), (length - 0.04, 0.7, 0.32), p.vary(FASCIA, 0.04),
                 chamfer=0.12, jitter=0.05)
            x += length
        # The fascia: three lifts of dressed blocks, each set back a breath
        # as it rises (battered), joints never above one another.
        z = -0.52
        lift = 0
        for h in (0.95, 1.05, 1.1):
            x = -3.05 - rng.uniform(0.0, 0.9)
            while x < 3.05:
                length = rng.uniform(1.0, 2.1)
                a, b = max(-3.05, x), min(3.05, x + length)
                if b - a > 0.2:
                    out = 0.06 * lift
                    slipped = variant == 'B' and lift == 1 and abs((a + b) / 2) < 1.0
                    slab(p, ((a + b) / 2, -0.32 - out + (0.08 if slipped else 0.0), z - h / 2 - (0.06 if slipped else 0)),
                         (b - a - 0.05, 0.6, h - 0.05), p.vary(FASCIA if rng.random() < 0.7 else FASCIA_DARK, 0.05),
                         roll=(0.05 if slipped else 0.0), chamfer=0.1, jitter=0.06)
                x += length
            z -= h
            lift += 1
        # The curbstones.
        x = -3.0
        k = 0
        while x < 3.0:
            length = rng.uniform(0.95, 1.75)
            x1 = min(3.0, x + length)
            lost = variant == 'B' and k == 2
            if not lost:
                top = rng.uniform(0.2, 0.27)
                sunk = rng.uniform(0.0, 0.06) if rng.random() < 0.25 else 0.0
                slab(p, ((x + x1) / 2, 0.12, (top - sunk - 0.5) / 2 + 0.0), (x1 - x - 0.05, 0.98, top - sunk + 0.5),
                     p.vary(CURB if rng.random() < 0.7 else CURB_WORN, 0.05), roll=rng.uniform(-0.015, 0.015),
                     chamfer=0.14, jitter=0.05)
            x = x1
            k += 1
    if variant == 'B':
        with p.as_kind(RAW):
            for _ in range(7):
                s = rng.uniform(0.12, 0.3)
                slab(p, (rng.uniform(-0.6, 1.4), rng.uniform(0.0, 0.6), s * 0.2), (s * 1.4, s, s * 0.4),
                     p.vary(CURB_WORN, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


def ring_foot(variant):
    """A 6 yd module of the Ring's outer edge, where the walk meets the
    mountain: a gutter of rough setts flush with the walk, and past the lip
    the scree and fallen blocks heaped against the rock's foot (from under
    the walk up to about a body's height, never over the walk)."""
    p = SP('RingFoot' + variant, seed=2231 + ord(variant), ao=0.6, ao_dist=1.2)
    rng = p.rng
    with p.as_kind(DRESSED):
        # The gutter: setts, flush.
        x = -3.0
        while x < 3.0:
            length = rng.uniform(0.5, 0.9)
            x1 = min(3.0, x + length)
            for (y0, y1) in ((0.05, 0.5), (0.53, 0.95)):
                if rng.random() < 0.08:
                    continue
                jx = rng.uniform(-0.05, 0.05)
                prism_top(p, [(x + 0.03 + jx, y0), (x1 - 0.03 + jx, y0), (x1 - 0.03, y1), (x + 0.03, y1)],
                          rng.uniform(-0.01, 0.03), -0.3, p.vary(FLAG_DARK if rng.random() < 0.5 else SCREE, 0.06),
                          bevel=0.06)
            x = x1
    with p.as_kind(RAW):
        # The scree, heaped against the rock (y < -0.2), rising away from the
        # walk; the bigger blocks behind.
        for k in range(30 if variant == 'A' else 24):
            x = rng.uniform(-3.3, 3.3)
            d = rng.uniform(0.25, 4.2)
            s = rng.uniform(0.25, 0.75) * (0.7 + d * 0.22)
            z = -0.9 + d * 0.42 + s * 0.2
            crystal(p, (x, -d - s * 0.3, z), (s * 1.5, s * 1.2, s * 0.8),
                    p.vary(SCREE if k % 3 else SCREE_DARK, 0.08), n=12, boxy=0.55, jitter=0.2,
                    yaw=rng.uniform(0, TAU), pitch=rng.uniform(-0.4, 0.4))
        for k in range(2 if variant == 'A' else 3):
            x = rng.uniform(-2.4, 2.4)
            s = rng.uniform(1.0, 1.7)
            slab(p, (x, -2.6 - s * 0.4, 0.2 + s * 0.3), (s * 1.6, s * 1.2, s * 1.1), p.vary(SCREE, 0.07),
                 yaw=rng.uniform(-0.5, 0.5), roll=rng.uniform(-0.3, 0.3), chamfer=0.22, jitter=0.12)
        # Grit and chips spilt onto the gutter (flat).
        for _ in range(10):
            s = rng.uniform(0.1, 0.24)
            slab(p, (rng.uniform(-2.9, 2.9), rng.uniform(0.05, 0.9), s * 0.18), (s * 1.4, s, s * 0.28),
                 p.vary(FLAG_PALE, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


# ---- the stairs ---------------------------------------------------------------------------
# A tread's base measures: its run (down the stair), its rise, the width of a
# side module (from the channel's lip to the stair's edge).
TREAD_RUN = 0.55
TREAD_RISE = 0.36
LONG_RUN = 2.4
LONG_RISE = 0.25
SIDE_W = 6.8
MID_W = 2.4


def _tread_blocks(rng, w, min_len, max_len):
    """Split a tread's width into blocks of uneven length."""
    cuts = [-w / 2]
    while cuts[-1] < w / 2 - min_len:
        cuts.append(min(w / 2, cuts[-1] + rng.uniform(min_len, max_len)))
    cuts[-1] = w / 2
    return list(zip(cuts[:-1], cuts[1:]))


def stair_tread(variant, long=False, mid=False):
    """One tread of a stair module (see the module doc): two or three
    blocks across, their tops a breath hollow where feet wore them, the
    nosing worn round and chipped now and then, the block running down past
    the next tread so a riser never shows a gap."""
    name = 'StairTread' + ('Mid' if mid else '') + ('Long' if long else '') + variant
    p = SP(name, seed=2301 + ord(variant) * 3 + (17 if long else 0) + (5 if mid else 0), ao=0.5, ao_dist=0.6)
    rng = p.rng
    run = LONG_RUN if long else TREAD_RUN
    rise = LONG_RISE if long else TREAD_RISE
    w = MID_W if mid else SIDE_W
    with p.as_kind(DRESSED):
        for (y0, y1) in _tread_blocks(rng, w, 1.4 if not mid else w, 3.2):
            tone = (FLAG, FLAG_COOL, FLAG_WARM, FLAG_PALE)[int(rng.integers(0, 4)) if hasattr(rng, 'integers')
                                                           else rng.randrange(4)]
            if long:
                # A long tread is paved in two or three flags down its run.
                xs = [-run / 2]
                while xs[-1] < run / 2 - 0.7:
                    xs.append(min(run / 2, xs[-1] + rng.uniform(0.75, 1.3)))
                xs[-1] = run / 2
            else:
                xs = [-run / 2, run / 2]
            for k in range(len(xs) - 1):
                x0, x1 = xs[k], xs[k + 1]
                nose = k == len(xs) - 2
                outline = [(x0 + 0.02, y0 + 0.03), (x1 - (0.0 if nose else 0.02), y0 + 0.03),
                           (x1 - (0.0 if nose else 0.02), y1 - 0.03), (x0 + 0.02, y1 - 0.03)]
                if nose and rng.random() < 0.18:
                    outline = _chip(outline, rng, rng.uniform(0.1, 0.22))
                prism_top(p, outline, rng.uniform(-0.012, 0.01), -(rise + 0.5), p.vary(tone, 0.05),
                          bevel=(0.07 if nose else 0.045), dip=(0.02 if not mid else 0.012))
    return p


def stair_chute():
    """The light-river's channel down the middle of a stair: a smooth chute
    of polished dark stone between two carved lips, 4 yd along X at stretch
    1, its bed on the ramp's line (sheared by the runtime): the river's
    ribbon runs in it, the treads stop at its lips."""
    p = SP('StairChute', seed=2351, ao=0.45, ao_dist=0.6)
    rng = p.rng
    L = 2.0
    with p.as_kind(DRESSED):
        x = -L
        while x < L - 1e-6:
            length = min(L - x, rng.uniform(1.1, 1.8))
            prism_top(p, [(x + 0.015, -0.86), (x + length - 0.015, -0.86), (x + length - 0.015, 0.86),
                          (x + 0.015, 0.86)], -0.04, -0.75, p.vary(CHANNEL, 0.04), bevel=0.025)
            x += length
        for side in (-1, 1):
            x = -L
            while x < L - 1e-6:
                length = min(L - x, rng.uniform(0.9, 1.6))
                y0, y1 = sorted((side * 0.88, side * 1.2))
                prism_top(p, [(x + 0.02, y0), (x + length - 0.02, y0), (x + length - 0.02, y1), (x + 0.02, y1)],
                          rng.uniform(0.2, 0.24), -0.75, p.vary(CHANNEL_LIP, 0.05), bevel=0.05)
                x += length
    return p


def stair_parapet(variant):
    """A 6 yd module of a stair's side (an edge piece: the walk toward +Y,
    the drop toward -Y): the carved stringer down the stair's flank (two
    lifts of dressed blocks to 3.3 under the walk, a moulded string course at
    the walk's height) and a low parapet on it, a body's knee high (0.8),
    coped with rounded stones, a squat newel at the module's end. B: a coping
    stone lost, its bed showing, a crack down the stringer."""
    p = SP('StairParapet' + variant, seed=2401 + ord(variant), ao=0.55, ao_dist=0.9)
    rng = p.rng
    half = 3.0
    with p.as_kind(DRESSED):
        # The stringer: two lifts.
        z = -0.32
        for h in (1.45, 1.55):
            x = -half - rng.uniform(0.0, 0.8)
            while x < half:
                length = rng.uniform(1.1, 2.2)
                a, b = max(-half, x), min(half, x + length)
                if b - a > 0.2:
                    slab(p, ((a + b) / 2, -0.42, z - h / 2), (b - a - 0.05, 0.75, h - 0.05),
                         p.vary(FASCIA if rng.random() < 0.65 else FASCIA_DARK, 0.05), chamfer=0.1, jitter=0.05)
                x += length
            z -= h
        # The string course at the walk's height, rounded, proud of the face.
        x = -half
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(1.5, 2.5))
            slab(p, (x + length / 2, -0.5, -0.17), (length - 0.04, 0.95, 0.32), p.vary(FASCIA, 0.04),
                 chamfer=0.2, jitter=0.04)
            x += length
        # The parapet wall: one course of long blocks (y -0.9 to -0.12).
        x = -half + 0.55
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(1.2, 2.0))
            slab(p, (x + length / 2, -0.5, 0.28), (length - 0.04, 0.62, 0.56), p.vary(CURB, 0.05), chamfer=0.1,
                 jitter=0.04)
            x += length
        # The coping: rounded stones on top (0.8 over the walk: low, so the
        # Ring's eyes keep the seal over it).
        x = -half + 0.55
        k = 0
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(0.9, 1.5))
            if not (variant == 'B' and k == 1):
                slab(p, (x + length / 2, -0.5, 0.66), (length - 0.04, 0.74, 0.24),
                     p.vary(CURB_WORN if rng.random() < 0.5 else CURB, 0.05), chamfer=0.38, jitter=0.05)
            x += length
            k += 1
        # The newel at the module's start: a squat block with a capstone.
        slab(p, (-half + 0.28, -0.5, 0.36), (0.56, 0.86, 0.72), p.vary(FASCIA, 0.04), chamfer=0.12, jitter=0.04)
        slab(p, (-half + 0.28, -0.5, 0.8), (0.72, 0.98, 0.2), p.vary(CURB_WORN, 0.04), chamfer=0.3, jitter=0.04)
    if variant == 'B':
        with p.as_kind(RAW):
            for _ in range(5):
                s = rng.uniform(0.1, 0.24)
                slab(p, (rng.uniform(-1.6, -0.4), rng.uniform(-0.8, -0.2), 0.68 + s * 0.15), (s * 1.4, s, s * 0.3),
                     p.vary(CURB_WORN, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


# ---- the vein mouths --------------------------------------------------------------------
def ring_sill():
    """A vein mouth's threshold across its walk (6 yd at stretch 1, along
    X): one course of long dark stones flush with the walk, a carved groove
    along its middle (z <= 0.05: the runtime stretches it across)."""
    p = SP('RingSill', seed=2451, ao=0.4, ao_dist=0.5)
    rng = p.rng
    with p.as_kind(DRESSED):
        x = -3.0
        while x < 3.0 - 1e-6:
            length = min(3.0 - x, rng.uniform(1.4, 2.4))
            for (y0, y1) in ((-0.62, -0.05), (0.05, 0.62)):
                prism_top(p, [(x + 0.025, y0), (x + length - 0.025, y0), (x + length - 0.025, y1), (x + 0.025, y1)],
                          rng.uniform(0.02, 0.045), -0.3, p.vary(BASALT_WORN, 0.05), bevel=0.05)
            x += length
        prism_top(p, [(-3.0, -0.05), (3.0, -0.05), (3.0, 0.05), (-3.0, 0.05)], -0.02, -0.3, GRIT, bevel=0.0)
    return p
