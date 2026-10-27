"""The Smith's Heart's Heart kit (phase 2J, build_smith_heart_heart_kit.py):
the raid's separate final room, reached only by the portal. The Anvil of the
World, a vast carved rock disc hung over the chasm down to the Smith's own
glowing heart; the Arrival Terrace and its return portal; the carved stone
Heart Bridge between them; the four altars, each in its vein's stone; the
four roots of the mountain that hold the platform; the great crystal heart
and the bed it rises from; and the rock pieces the heart tears out of the
room and binds into the colossus of the Masterless Strength.

Primal and divine (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md): living
rock and crystal, the Smith's own carving (the Ring's dressed granite, his
chevrons), no metal, no machinery. The four colossal chains of the blockout
are gone: the platform is held by four ROOTS of the mountain, braided rock
with crystal veins, each carrying its vein's light down into its altar
(chains are metal; the raid has none).

The crystal a vein lights (the altars' hearts, the roots' veins, the
colossus's seams) is painted a pale facet grey: the runtime tints it with
its vein's colour and dims it (the altars light and dim per vein, the heart
goes dark when the body dies). The fixed crystal (the keels', the core
bed's, the lamps') carries its emitted colour.

  - Kit_AnvilFloor: the platform's walk (r 42), in courses of dressed flags
    round a hub, three bands of dark basalt where the rune rings burn (r 14,
    26, 38.5), four channels from the hub to the altars (the veins' light runs
    in them), a carved fascia two lifts deep round the rim and a coped
    balustrade on it, open where the Heart Bridge lands, its newels crowned
    with crystal lamps.
  - Kit_AnvilKeel: the rock the platform is: a carved drum under the fascia
    with the Smith's chevrons, then the mountain's raw rock tapering to a
    root deep in the chasm, buttressed under each altar, each vein's crystal
    breaking out of it under its altar, crystal hanging from its root.
  - Kit_TerraceFloor, Kit_TerraceKeel: the Arrival Terrace (r 13) the same
    way, the return portal's basin and kerb on its west side, two tall
    standing stones past the lip behind it.
  - Kit_HeartBridge: the carved stone bridge from the terrace down to the
    platform: its deck in courses down the ramp, a coped parapet each side
    (a gap for the gate's standing stones), a segmental arch of voussoirs
    under it with a crystal keystone, its abutments falling into the keels.
  - Kit_AltarHammer, Breath, Quench, Heat: the four altars on a shared
    stepped plinth: the Hammer's ochre granite split round a geode, the
    Breath's twisted storm stone bored by the wind under a crown of horns,
    the Quench's frost granite under a mantle of ice, the Heat's bundled
    basalt bursting with fire crystal. Each a vein heart of crystal.
  - Kit_HeartRoot: one root of the mountain: braided strands of rock from
    the crown down to an altar, its fingers gripping the altar's back.
  - Kit_HeartCrystal: the heart: a great double-ended crystal and its
    satellites (the runtime's own shader draws the four veins inside it).
  - Kit_CoreBed: the heart's bed deep in the chasm: a crater of rock lined
    with crystal round the hollow the heart rises from.
  - Kit_Col*: the colossus's rock pieces (torso, hip, head, shoulder, upper
    arm, forearm, fist, three shards): the room's granite in its beds, seams
    of the heart's light in their cracks. One body until the final model.
  - Kit_TornSocket: the scar a torn-out piece leaves in the paving (flat);
    Kit_RubbleScatter: the low rubble a crumbled piece leaves.

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - Kit_AnvilFloor, Kit_AnvilKeel: origin at the platform's centre on its
    walk, bearings the game's (north -Y, east +X); every flag top within
    [-0.01, 0.035]; the parapet and fascia past the lip (r > 42).
  - Kit_TerraceFloor, Kit_TerraceKeel: origin at the terrace's centre on its
    walk (game height 4).
  - Kit_HeartBridge: origin at the terrace's centre at the platform's
    height (game 0), the bridge along +X (s), across along Y (t), its deck
    at the field's own heights (4 to s 12, down to 0 at s 27).
  - Kit_Altar*: the foot's centre, its front (toward the platform's centre)
    toward -Y.
  - Kit_HeartRoot: the altar's foot centre (the altar's own frame), the root
    rising out along +Y (away from the platform's centre) to the crown.
  - Kit_HeartCrystal, Kit_Col*: the piece's centre (the runtime moves it).
  - Kit_CoreBed: the hollow's centre at the bed's rim height.
  - Kit_TornSocket, Kit_RubbleScatter: the centre on the floor.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt, block
from gwkit import add_sculpt, crystal, hull, mix, slab, sstep
from heat_pieces import hex_column, _bundle_layout
from hckit import GLOW, STONE
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, RoundBox, RoundCone, Torus, rot
from ring_pieces import (
    BASALT, BASALT_WORN, CHANNEL, CHANNEL_LIP, CURB, CURB_WORN, FASCIA, FASCIA_DARK, FLAG, FLAG_COOL, FLAG_DARK,
    FLAG_PALE, FLAG_WARM, GRIT, _area, _chip, polar_outline, prism_top,
)
from ring_sculpt import (
    BREATH_GLOW, HAMMER_GLOW, HEAT_GLOW, LAMP_CORE, LAMP_GLOW, QUENCH_GLOW, Fn, _flags_round, _weather,
    facet_crystal,
)
from shkit import DRESSED, PAINT, RAW, SP, TAU

ICE = 2  # the kit's third slot (KitIce)

# ---- measures (the layout's, src/sim/content/smith_heart_layout.ts) ---------------------
ROOM_R = 42.0
TERRACE_R = 13.0
ROOM_FROM_TERRACE = 70.0
BRIDGE_HALF = 7.0
GATE_S = 22.0
ALTAR_R = 36.0
RUNE_RINGS = (14.0, 26.0, 38.5)
# The channels to the altars (bearings: breath north, quench east, hammer
# south, heat west) and the bearing the bridge lands on.
CHANNELS = (0.0, 90.0, 180.0, 270.0)
BRIDGE_BEARING = 225.0
CHANNEL_END = 34.2
HUB_R = 1.6
# The terrace's return portal (game local (-6, +6) of its centre: bearing 315).
PORTAL_BEARING = 315.0
PORTAL_R = 8.4853
PORTAL_HOLE = 3.5
# The root's spine in the altar's frame (outward +Y, up +Z): a quadratic
# Bezier from the altar's crown to the mountain's crown (heart_room_kit_plan_core.ts
# HEART_ROOT_SPINE carries the same three points).
ROOT_SPINE = ((0.0, 2.0, 6.3), (0.0, 22.0, 40.0), (0.0, 50.0, 52.0))

# ---- palette (sRGB) ----------------------------------------------------------------------
GRANITE = (0.4, 0.39, 0.39)
GRANITE_COOL = (0.34, 0.34, 0.37)
GRANITE_WARM = (0.44, 0.41, 0.38)
GRANITE_DARK = (0.24, 0.24, 0.27)
GRANITE_PALE = (0.54, 0.52, 0.49)
GRANITE_BED = (0.3, 0.29, 0.3)
OCHRE = (0.5, 0.44, 0.36)
OCHRE_DARK = (0.4, 0.35, 0.3)
STORM = (0.5, 0.53, 0.55)
STORM_DARK = (0.32, 0.35, 0.38)
GLASS = (0.14, 0.16, 0.19)
FROST = (0.6, 0.65, 0.7)
FROST_DARK = (0.38, 0.42, 0.48)
RIME = (0.78, 0.84, 0.9)
ICE_BODY = (0.62, 0.78, 0.88)
ICE_DEEP = (0.36, 0.55, 0.7)
BASALT_H = (0.27, 0.26, 0.26)
BASALT_HD = (0.18, 0.17, 0.17)
SOOT = (0.1, 0.095, 0.09)
ASH = (0.56, 0.53, 0.5)
# The tinted crystal's facet greys (the runtime's vein colour times these).
PALE_LO = (0.5, 0.5, 0.52)
PALE_HI = (1.0, 1.0, 1.0)
# The fixed crystal: the heart's white-gold.
CORE_GLOW = (0.98, 0.86, 0.58)
CORE_HOT = (1.0, 0.95, 0.8)
CORE_DEEP = (0.78, 0.5, 0.2)

HEART_COLOURS = {
    'g0': GRANITE, 'g1': GRANITE_COOL, 'g2': GRANITE_WARM, 'g3': GRANITE_DARK, 'g4': GRANITE_PALE,
    'bed': GRANITE_BED, 'dressed': (0.5, 0.48, 0.46), 'ochre': OCHRE, 'ochre2': OCHRE_DARK, 'storm': STORM,
    'storm2': STORM_DARK, 'glass': GLASS, 'frost': FROST, 'frost2': FROST_DARK, 'basalt': BASALT_H,
    'basalt2': BASALT_HD, 'soot': SOOT, 'deep': (0.13, 0.12, 0.13), 'deep2': (0.17, 0.15, 0.15),
}
HEART_KINDS = {k: RAW for k in HEART_COLOURS}
HEART_KINDS['dressed'] = DRESSED
HEART_KINDS['glass'] = PAINT
HEART_KINDS['soot'] = PAINT
TONES = ('g0', 'g1', 'g2', 'g0', 'g4', 'g3')
LIGHT = Vector((0.35, -0.55, 0.76)).normalized()


def HSP(name, **kw):
    """A piece named in full (Kit_*)."""
    return SP(name[4:] if name.startswith('Kit_') else name, **kw)


def _mesh(bpy, p, f, name, target, smooth=False):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, HEART_COLOURS, HEART_KINDS, smooth=smooth)


def _axes(f):
    return f.axes[0][:, None, None], f.axes[1][None, :, None], f.axes[2][None, None, :]


def _clamp(f, d):
    f.d = np.maximum(f.d, (d + np.zeros_like(f.d)).astype(np.float32))


def bp(r, deg):
    a = math.radians(deg)
    return (r * math.sin(a), -r * math.cos(a))


def pale_crystal(p, base, direction, h, r, sides=6, tip=0.24, squash=1.0, bright=0.0):
    """A crystal for a tinted slot: each facet its own pale grey (the light
    inside), the tip a value brighter, `bright` lifting the whole."""
    faces = facet_crystal(p, base, direction, h, r, PALE_HI, sides=sides, tip=tip, squash=squash,
                          twist=p.rng.uniform(0, TAU))
    b = Vector(base)
    d = Vector(direction).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(LIGHT)
        t = max(0.0, min(1.0, (fc.calc_center_median() - b).dot(d) / max(1e-3, h)))
        s = min(1.0, 0.2 + 0.55 * k + 0.25 * t + bright)
        c = tuple(PALE_LO[i] + (PALE_HI[i] - PALE_LO[i]) * s for i in range(3))
        for loop in fc.loops:
            loop[p.col] = (*c, 1.0)
    return faces


def core_crystal(p, base, direction, h, r, hot=0.0, sides=6, tip=0.24):
    """A crystal of the heart's own white-gold (fixed glow): a deep amber in
    the shade of a facet, gold on the body, white toward its heat."""
    faces = facet_crystal(p, base, direction, h, r, CORE_GLOW, sides=sides, tip=tip, twist=p.rng.uniform(0, TAU))
    b = Vector(base)
    d = Vector(direction).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(LIGHT)
        t = max(0.0, min(1.0, (fc.calc_center_median() - b).dot(d) / max(1e-3, h)))
        col = mix(CORE_DEEP, CORE_GLOW, sstep(0.1, 0.8, k))
        col = mix(col, CORE_HOT, sstep(0.72, 1.0, k) * 0.6 + hot * (1 - t) * 0.5)
        for loop in fc.loops:
            loop[p.col] = (*col, 1.0)
    return faces


def vein_crystal(p, base, direction, h, r, colour):
    """A fixed crystal of one vein's light (the keels'), faceted."""
    return facet_crystal(p, base, direction, h, r, p.vary(colour, 0.06), twist=p.rng.uniform(0, TAU))


def _grit_disc(p, r, z, n=180, hole=0.0):
    """The grit the flags are set in (only seen in the joints)."""
    bm = p.bm
    before = set(bm.faces)
    outer = [bm.verts.new((*bp(r, k * 360.0 / n), z)) for k in range(n)]
    if hole > 0:
        inner = [bm.verts.new((*bp(hole, k * 360.0 / n), z)) for k in range(n)]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
    else:
        bm.faces.new(outer)
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(RAW):
        p._paint(faces, GRIT, 0)
    p.facing(faces, (0, 0, 1))


def _tones(rng):
    # Mostly the mid granite, warm and cool, a paler or darker stone now and
    # then (big quiet fields, R2), never a checkerboard.
    return lambda: (FLAG, FLAG_COOL, FLAG_WARM, FLAG, FLAG_COOL, FLAG_WARM, FLAG, FLAG_PALE,
                    FLAG_DARK)[rng.randrange(9)]


def _basalt_tone(rng):
    return lambda: BASALT if rng.random() < 0.72 else BASALT_WORN


def _channel(p, rng, bearing, r0, r1):
    """A light channel along a radius (its polished dark bed, two carved
    lips under a hand)."""
    a = math.radians(bearing)
    ux, uy = math.sin(a), -math.cos(a)
    vx, vy = -uy, ux

    def box_along(lat0, lat1, d0, d1, top, color, bevel):
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
                box_along(lo, hi, d + 0.025, d + length - 0.025, rng.uniform(0.07, 0.09),
                          p.vary(CHANNEL_LIP, 0.05), 0.04)
                d += length


def _rim(p, rng, R, opens, z_lifts=((-1.5, 0.0), (-3.25, -1.5)), newels=(), lamp=True, skip=()):
    """A walk's rim: its carved fascia (two lifts of dressed blocks past the
    lip) and the coped balustrade on it (base course and rounded coping),
    open over `opens` ((bearing, half degrees)); newels at `newels`
    (bearings), each crowned with a crystal lamp; `skip` keeps the wall off
    bearings where something else stands on the lip."""
    def is_open(mid, w_extra=0.0):
        return any(abs(((mid - o + 180) % 360) - 180) < w + w_extra for (o, w) in opens)

    with p.as_kind(DRESSED):
        for lift, (z0, z1) in enumerate(z_lifts):
            a0 = rng.uniform(0, 6)
            a = a0
            while a < a0 + 360.0 - 1e-6:
                step = math.degrees(rng.uniform(1.6, 2.9) / R)
                b = min(a0 + 360.0, a + step)
                if a0 + 360.0 - b < math.degrees(0.9 / R):
                    b = a0 + 360.0
                ja = math.degrees(0.04 / R)
                outline = polar_outline([('arc', R + 0.0, a + ja, b - ja),
                                         ('arc', R + 0.66 + lift * 0.12, b - ja, a + ja)], step=1.0)
                prism_top(p, outline, z1 - 0.02, z0, p.vary(FASCIA if rng.random() < 0.7 else FASCIA_DARK, 0.05),
                          bevel=0.07)
                a = b
        # The string course under the balustrade, a breath proud.
        a = 0.0
        while a < 360.0 - 1e-6:
            step = math.degrees(rng.uniform(2.0, 3.4) / R)
            b = min(360.0, a + step)
            mid = (a + b) / 2
            if not is_open(mid, 0.4):
                outline = polar_outline([('arc', R + 0.02, a + 0.05, b - 0.05), ('arc', R + 0.86, b - 0.05,
                                                                                  a + 0.05)], step=1.0)
                prism_top(p, outline, -0.08, -0.42, p.vary(CURB_WORN, 0.05), bevel=0.06)
            a = b
        # The balustrade: a base course of big blocks and a rounded coping.
        a = 0.0
        while a < 360.0 - 1e-6:
            step = math.degrees(rng.uniform(1.4, 2.3) / R)
            b = min(360.0, a + step)
            mid = (a + b) / 2
            near_newel = any(abs(((mid - n + 180) % 360) - 180) < math.degrees(0.8 / R) for n in newels)
            if not is_open(mid) and not near_newel and not any(abs(((mid - s + 180) % 360) - 180) < w
                                                               for (s, w) in skip):
                outline = polar_outline([('arc', R + 0.08, a + 0.06, b - 0.06), ('arc', R + 0.8, b - 0.06,
                                                                                  a + 0.06)], step=0.9)
                prism_top(p, outline, 0.64, -0.12, p.vary(CURB if rng.random() < 0.75 else FASCIA, 0.05),
                          bevel=0.07)
                outline = polar_outline([('arc', R + 0.0, a + 0.03, b - 0.03), ('arc', R + 0.9, b - 0.03,
                                                                                 a + 0.03)], step=0.9)
                prism_top(p, outline, 0.96, 0.6, p.vary(CURB_WORN, 0.05), bevel=0.14)
            a = b
        for n in newels:
            w = math.degrees(0.72 / R)
            outline = polar_outline([('arc', R - 0.05, n - w, n + w), ('arc', R + 1.25, n + w, n - w)], step=0.5)
            prism_top(p, outline, 1.42, -0.12, p.vary(FASCIA, 0.04), bevel=0.1)
            w2 = math.degrees(0.86 / R)
            outline = polar_outline([('arc', R - 0.16, n - w2, n + w2), ('arc', R + 1.4, n + w2, n - w2)], step=0.5)
            prism_top(p, outline, 1.66, 1.38, p.vary(CURB_WORN, 0.04), bevel=0.12)
            if lamp:
                cx, cy = bp(R + 0.6, n)
                for k in range(5):
                    ang = TAU * k / 5 + p.rng.uniform(-0.3, 0.3)
                    lean = 0.0 if k == 0 else 0.5
                    d = (math.cos(ang) * lean, math.sin(ang) * lean, 1.0)
                    with p.as_kind(PAINT):
                        facet_crystal(p, (cx, cy, 1.6), d, p.rng.uniform(0.55, 0.85) * (1.0 if k == 0 else 0.7),
                                      p.rng.uniform(0.1, 0.16), LAMP_CORE if k == 0 else p.vary(LAMP_GLOW, 0.05))


# ================================================================ the platform
def anvil_floor(bpy):
    """The Anvil of the World's walk (see the module doc)."""
    p = HSP('Kit_AnvilFloor', seed=5001, ao=0.3, ao_dist=0.6, dust=0.45)
    rng = p.rng
    _grit_disc(p, ROOM_R + 0.08, -0.06, n=240)
    # The hub: a round stone of dark basalt where the four channels meet,
    # the body of the Masterless Strength hovering over it.
    with p.as_kind(DRESSED):
        prism_top(p, polar_outline([('arc', HUB_R, 0.0, 359.0)], step=0.4), 0.034, -0.4, p.vary(BASALT, 0.03),
                  bevel=0.1)
    gaps = [(b, 1.34) for b in CHANNELS]
    tones = _tones(rng)
    basalt = _basalt_tone(rng)
    courses = [
        (HUB_R, 3.3, 'pale'), (3.3, 5.1, 'flag'), (5.1, 7.1, 'flag'), (7.1, 9.3, 'flag'), (9.3, 11.4, 'flag'),
        (11.4, 12.4, 'flag'), (12.4, 15.6, 'band'), (15.6, 17.7, 'flag'), (17.7, 19.9, 'flag'),
        (19.9, 22.1, 'flag'), (22.1, 24.4, 'flag'), (24.4, 27.6, 'band'), (27.6, 29.8, 'flag'),
        (29.8, 32.0, 'flag'), (32.0, CHANNEL_END, 'flag'), (CHANNEL_END, 36.8, 'flag'), (36.8, 40.2, 'band'),
        (40.2, ROOM_R, 'flag'),
    ]
    for (r0, r1, kind) in courses:
        g = gaps if r1 <= CHANNEL_END + 1e-6 else []
        if kind == 'band':
            _flags_round(p, rng, r0, r1, basalt, g, lo=1.0, hi=1.7)
        elif kind == 'pale':
            _flags_round(p, rng, r0, r1, lambda: FLAG_PALE if rng.random() < 0.6 else FLAG_WARM, g, lo=1.0, hi=1.6)
        else:
            lo, hi = (1.3, 2.3) if r1 < 20 else (1.7, 3.1)
            _flags_round(p, rng, r0, r1, tones, g, lo=lo, hi=hi)
    for b in CHANNELS:
        _channel(p, rng, b, HUB_R - 0.2, CHANNEL_END)
    # Grit and a few spalls drifted into the joints (flat).
    with p.as_kind(RAW):
        for _ in range(60):
            r = rng.uniform(4.0, ROOM_R - 1.0)
            d = rng.uniform(0, 360)
            x, y = bp(r, d)
            s = rng.uniform(0.1, 0.26)
            slab(p, (x, y, 0.036), (s * 1.4, s, s * 0.2), p.vary(FLAG_PALE, 0.08), yaw=rng.uniform(0, TAU),
                 chamfer=0.25, jitter=0.15)
    # The rim: fascia, string course, balustrade open over the bridge, its
    # newels flanking the bridge and between the altars.
    bridge_w = math.degrees(math.asin(BRIDGE_HALF / ROOM_R)) + 0.6
    newels = [22.5, 67.5, 112.5, 157.5, BRIDGE_BEARING - bridge_w - 1.3, BRIDGE_BEARING + bridge_w + 1.3, 292.5,
              337.5]
    _rim(p, rng, ROOM_R, [(BRIDGE_BEARING, bridge_w)], newels=newels)
    return p


def _keel(bpy, p, seed, R, top, depth, voxel, target, buttresses=(), veins=None, root_crystals=9, frieze=True):
    """An island's keel: a carved drum under its fascia (the Smith's
    chevrons cut round it), then the mountain's raw rock tapering in ledged
    beds to a root deep in the chasm, lobed and fissured, buttressed under
    `buttresses` (bearings); `veins` ({bearing: colour}) crystal breaking
    out under each, crystal hanging from the root."""
    rng = np.random.default_rng(seed)
    pad = R + 4.0
    f = Sculpt((-pad, -pad, top - depth - 3.0), (pad, pad, top + 0.6), voxel)
    n1, n2 = Noise(seed), Noise(seed + 9)
    drum = 3.4 if frieze else 0.0

    def body(X, Y, Z):
        r = np.sqrt(X * X + Y * Y)
        ang = np.arctan2(X, -Y)
        t = np.clip((top - drum - Z) / (depth - drum), 0.0, 1.0)
        Rr = (R + 0.55) * (1.0 - t) ** 0.78 + 0.8
        Rr = Rr * (1.0 + 0.12 * np.sin(ang * 3.0 + 0.7) * t + 0.08 * np.sin(ang * 5.0 + 2.1) * t)
        ledge = 0.9 * np.maximum(0.0, np.sin(Z * 0.45 + 1.3 * n2.fbm(X * 0.04, Y * 0.04, 0.0, 2)))
        Rr = Rr - ledge * (0.3 + t) * (Z < top - drum)
        return np.maximum((r - Rr) * 0.8, Z - top)

    f.put('g1', Fn(body, (-pad, -pad, top - depth - 3.0), (pad, pad, top + 0.6)), 0.0)
    if frieze:
        # The carved drum: dressed, its face plumb under the fascia.
        f.put('dressed', Fn(lambda X, Y, Z: np.maximum(np.sqrt(X * X + Y * Y) - (R + 0.62),
                                                       np.maximum(Z - top, (top - drum) - Z)),
                            (-R - 1, -R - 1, top - drum - 0.5), (R + 1, R + 1, top + 0.3)), 0.25)
    for b in buttresses:
        a = math.radians(b)
        for k, (z0, sz) in enumerate(((top - drum - 2.5, 6.0), (top - drum - 8.0, 5.0), (top - drum - 13.5, 4.0))):
            t = (top - z0) / depth
            rr = (R + 0.5) * (1 - t) ** 0.78
            c = (math.sin(a) * (rr - 1.0), -math.cos(a) * (rr - 1.0), z0)
            f.put(('g0', 'g2', 'g3')[k % 3], block(rng, c, (sz * 1.6, sz * 1.3, sz * 1.4), cuts=9, chamfer=(0.72, 0.93),
                                                   R=rot(rz=float(a))), 1.0)
    for k in range(int(R * 0.5) + 4):
        a = rng.uniform(0, TAU)
        z = top - drum - rng.uniform(2.0, depth * 0.6)
        t = (top - z) / depth
        rr = (R + 0.4) * (1 - t) ** 0.78
        c = (math.sin(a) * rr * 0.82, -math.cos(a) * rr * 0.82, z)
        sz = R * 0.22
        f.put(('g0', 'g2', 'g3', 'bed')[k % 4], block(rng, c, (rng.uniform(0.8, 1.4) * sz, rng.uniform(0.8, 1.4) * sz,
                                                         rng.uniform(0.5, 0.9) * sz), cuts=8, chamfer=(0.7, 0.92),
                                                   R=rot(rz=float(a))), sz * 0.18)
    for k in range(int(R * 0.25) + 4):
        a = rng.uniform(0, TAU)
        pts = []
        z = top - drum - 1.0
        while z > top - depth * 0.7:
            t = (top - z) / depth
            rr = (R + 0.4) * (1 - t) ** 0.78
            pts.append((math.sin(a) * rr, -math.cos(a) * rr, z))
            a += rng.uniform(-0.05, 0.05)
            z -= rng.uniform(2.0, 4.0)
        if len(pts) > 1:
            f.groove(Polyline(pts, 0.25), 0.9, 0.35)
    if frieze:
        # The Smith's chevrons cut round the drum in a band, in short arcs
        # (each groove's box stays small).
        zc = top - drum * 0.5
        amp = 0.7
        n = int(TAU * (R + 0.62) / 1.2)
        seg = 12
        for s0 in range(0, n, seg):
            pts = []
            for i in range(s0, min(n, s0 + seg) + 1):
                a = TAU * i / n
                z = zc + (amp if i % 2 else -amp)
                pts.append((math.sin(a) * (R + 0.66), -math.cos(a) * (R + 0.66), z))
            f.groove(Polyline(pts, 0.04), 0.2, 0.09)
    f.displace(lambda X, Y, Z: (0.8 * n1.fbm(X * 0.08, Y * 0.08, Z * 0.06, 3)
                                + 0.4 * (n1.ridged(X * 0.2, Y * 0.2, Z * 0.16, 2) - 0.45))
               * np.clip((top - drum - Z) / 2.5, 0.0, 1.0), band=2.2)
    f.cut_above(top)
    _mesh(bpy, p, f, p.name.replace('Kit_', ''), target)
    prng = p.rng
    for b, col in (veins or {}).items():
        a = math.radians(b)
        for k in range(7):
            z = top - drum - 1.5 - k * prng.uniform(2.6, 4.0)
            t = (top - z) / depth
            rr = (R + 0.4) * (1 - t) ** 0.78 - 0.8
            jit = prng.uniform(-0.1, 0.1)
            ox, oy = math.sin(a + jit) * rr, -math.cos(a + jit) * rr
            out = Vector((math.sin(a + jit), -math.cos(a + jit), prng.uniform(-0.6, 0.2)))
            for _ in range(prng.randint(2, 4)):
                dd = out + Vector((prng.uniform(-0.5, 0.5), prng.uniform(-0.5, 0.5), prng.uniform(-0.4, 0.3)))
                with p.as_kind(PAINT):
                    vein_crystal(p, (ox, oy, z), dd, prng.uniform(2.6, 6.2) * (1.2 - t * 0.4),
                                 prng.uniform(0.5, 1.05), col)
    for k in range(root_crystals):
        a = prng.uniform(0, TAU)
        r = prng.uniform(0.0, 2.6)
        base = (math.sin(a) * r, -math.cos(a) * r, top - depth * 0.9 + prng.uniform(0, 3))
        with p.as_kind(PAINT):
            core_crystal(p, base, (prng.uniform(-0.3, 0.3), prng.uniform(-0.3, 0.3), -1.0), prng.uniform(3.0, 7.5),
                         prng.uniform(0.4, 0.9), hot=0.4)


def anvil_keel(bpy):
    p = HSP('Kit_AnvilKeel', seed=5101, ao=0.5, ao_dist=6.0, dust=0.0)
    _keel(bpy, p, 5101, ROOM_R, -3.25, 34.0, 0.38, 16000, buttresses=CHANNELS,
          veins={0.0: BREATH_GLOW, 90.0: QUENCH_GLOW, 180.0: HAMMER_GLOW, 270.0: HEAT_GLOW}, root_crystals=12)
    return p


# ================================================================ the terrace
def terrace_floor(bpy):
    """The Arrival Terrace's walk (see the module doc)."""
    p = HSP('Kit_TerraceFloor', seed=5201, ao=0.3, ao_dist=0.6, dust=0.45)
    rng = p.rng
    _grit_disc(p, TERRACE_R + 0.08, -0.06, n=120)
    with p.as_kind(DRESSED):
        prism_top(p, polar_outline([('arc', 1.4, 0.0, 359.0)], step=0.4), 0.032, -0.4, p.vary(FLAG_PALE, 0.03),
                  bevel=0.1)
    tones = _tones(rng)
    for (r0, r1, kind) in ((1.4, 3.0, 'pale'), (3.0, 4.8, 'flag'), (4.8, 6.8, 'flag'), (6.8, 8.9, 'flag'),
                           (8.9, 10.7, 'band'), (10.7, TERRACE_R, 'flag')):
        if kind == 'band':
            _flags_round(p, rng, r0, r1, _basalt_tone(rng), [], lo=1.0, hi=1.6)
        elif kind == 'pale':
            _flags_round(p, rng, r0, r1, lambda: FLAG_PALE if rng.random() < 0.6 else FLAG_WARM, [], lo=1.0, hi=1.5)
        else:
            _flags_round(p, rng, r0, r1, tones, [], lo=1.2, hi=2.2)
    # The return portal's basin (its vortex turns on it) and its kerb, with
    # crystal studs round it.
    px, py = bp(PORTAL_R, PORTAL_BEARING)
    with p.as_kind(DRESSED):
        prism_top(p, [(px + x, py + y) for (x, y) in polar_outline([('arc', PORTAL_HOLE + 0.1, 0.0, 359.0)],
                                                                     step=0.5)],
                  0.045, -0.3, p.vary(BASALT, 0.03), bevel=0.05)
        a = 0.0
        while a < 360.0 - 1e-6:
            b = min(360.0, a + rng.uniform(24.0, 40.0))
            outline = polar_outline([('arc', PORTAL_HOLE + 0.15, a + 0.8, b - 0.8),
                                     ('arc', PORTAL_HOLE + 0.85, b - 0.8, a + 0.8)], step=0.4)
            prism_top(p, [(px + x, py + y) for (x, y) in outline], rng.uniform(0.08, 0.1), -0.3,
                      p.vary(CURB_WORN, 0.05), bevel=0.05)
            a = b
    for k in range(8):
        sx, sy = bp(PORTAL_HOLE + 0.5, k * 45.0 + 22.5)
        with p.as_kind(PAINT):
            facet_crystal(p, (px + sx, py + sy, 0.06), (0.0, 0.0, 1.0), 0.24, 0.1, p.vary(LAMP_GLOW, 0.04))
    bridge_w = math.degrees(math.asin(BRIDGE_HALF / TERRACE_R)) + 1.2
    stones = [(PORTAL_BEARING - 16.0, 3.4), (PORTAL_BEARING + 16.0, 3.4)]
    _rim(p, rng, TERRACE_R, [(45.0, bridge_w)], newels=[45.0 - bridge_w - 2.2, 45.0 + bridge_w + 2.2, 180.0,
                                                          270.0 - 40.0],
         skip=stones)
    # The two standing stones past the lip behind the return portal, framing
    # it (render only: they stand past the walk, on the fascia).
    for (b, _w) in stones:
        _portal_stone(p, rng, bp(TERRACE_R + 0.75, b), b)
    return p


def _portal_stone(p, rng, at, bearing):
    """A tall rough-hewn stone with a crystal lamp in the cleft of its head,
    standing past the terrace's lip (built as bmesh blocks: it is small)."""
    x, y = at
    a = math.radians(bearing)
    yaw = -a
    h = 6.6
    with p.as_kind(DRESSED):
        crystal(p, (x, y, h * 0.38), (1.5, 1.2, h * 0.8), p.vary(GRANITE, 0.05), n=14, boxy=0.82, jitter=0.06,
                yaw=yaw, floor=-1.2)
        crystal(p, (x, y, h * 0.86), (1.25, 1.0, 1.35), p.vary(GRANITE_WARM, 0.05), n=12, boxy=0.75, jitter=0.08,
                yaw=yaw + 0.2)
        crystal(p, (x, y, -0.3), (2.0, 1.7, 1.1), p.vary(GRANITE_DARK, 0.05), n=12, boxy=0.7, jitter=0.1, yaw=yaw)
    for k in range(5):
        ang = TAU * k / 5 + rng.uniform(-0.3, 0.3)
        lean = 0.0 if k == 0 else 0.5
        d = (math.cos(ang) * lean, math.sin(ang) * lean, 1.0)
        with p.as_kind(PAINT):
            facet_crystal(p, (x, y, h * 0.86 + 0.6), d, rng.uniform(0.7, 1.1) * (1.0 if k == 0 else 0.7),
                          rng.uniform(0.13, 0.2), LAMP_CORE if k == 0 else p.vary(LAMP_GLOW, 0.05))


def terrace_keel(bpy):
    p = HSP('Kit_TerraceKeel', seed=5301, ao=0.5, ao_dist=3.0, dust=0.0)
    _keel(bpy, p, 5301, TERRACE_R, -3.25, 20.0, 0.22, 7000, buttresses=(), veins={}, root_crystals=6)
    return p


# ================================================================ the bridge
def bridge_height(s):
    """The deck's height at s (the field's path: 4 to s 12, a straight ramp
    down to 0 at s 27, level after)."""
    if s <= 12.0:
        return 4.0
    if s >= 27.0:
        return 0.0
    return 4.0 - (s - 12.0) * 4.0 / 15.0


def _bridge_clip(s, t):
    """Push a deck point out of the terrace's and the platform's discs."""
    lo = math.sqrt(max(0.0, (TERRACE_R + 0.03) ** 2 - t * t)) if abs(t) < TERRACE_R + 0.03 else -1e9
    hi = ROOM_FROM_TERRACE - math.sqrt(max(0.0, (ROOM_R + 0.03) ** 2 - t * t))
    return min(max(s, lo), hi)


def _deck_stone(p, rng, s0, s1, t0, t1, tone):
    """One deck stone between s0..s1 and t0..t1, clipped to the deck, its top
    on the ramp's line (a stone never straddles a kink: the rows break at
    s 12 and 27)."""
    pts = []
    n = 6
    for k in range(n + 1):
        pts.append((s0, t0 + (t1 - t0) * k / n))
    for k in range(n + 1):
        pts.append((s1, t1 + (t0 - t1) * k / n))
    out = []
    for (s, t) in pts:
        # Out of the discs, and never past the stone's own row (a stone wholly
        # inside a disc folds to nothing and is dropped).
        out.append((min(max(_bridge_clip(s, t), s0), s1), t))
    if abs(_area(out)) < 0.2:
        return
    clean = [out[0]]
    for q in out[1:]:
        if math.hypot(q[0] - clean[-1][0], q[1] - clean[-1][1]) > 0.02:
            clean.append(q)
    if math.hypot(clean[0][0] - clean[-1][0], clean[0][1] - clean[-1][1]) < 0.02:
        clean.pop()
    if len(clean) < 3:
        return
    # The top on the ramp's line about the stone's own centre (prism_top
    # tilts about the outline's mean): every corner a breath over the walk.
    sc = sum(q[0] for q in clean) / len(clean)
    slope = 0.0 if (sc <= 12.0 or sc >= 27.0) else -4.0 / 15.0
    top = bridge_height(sc) + rng.uniform(0.015, 0.03)
    if rng.random() < 0.1:
        clean = _chip(clean, rng, rng.uniform(0.15, 0.3))
    with p.as_kind(DRESSED):
        prism_top(p, clean, top, top - 0.9, p.vary(tone, 0.06), bevel=rng.uniform(0.05, 0.08), tilt=(slope, 0.0))


def heart_bridge(bpy):
    """The Heart Bridge (see the module doc)."""
    p = HSP('Kit_HeartBridge', seed=5401, ao=0.55, ao_dist=3.0, dust=0.4)
    rng = p.rng
    tones = _tones(rng)
    s_start = math.sqrt(TERRACE_R ** 2 - BRIDGE_HALF ** 2) - 0.2
    s_end = ROOM_FROM_TERRACE - math.sqrt(ROOM_R ** 2 - BRIDGE_HALF ** 2) + 0.2
    # Rows across the deck, broken at the ramp's kinks.
    rows = []
    for (a, b) in ((s_start, 12.0), (12.0, 27.0), (27.0, s_end)):
        n = max(1, round((b - a) / 1.85))
        for k in range(n):
            rows.append((a + (b - a) * k / n, a + (b - a) * (k + 1) / n))
    for i, (s0, s1) in enumerate(rows):
        t = -BRIDGE_HALF
        while t < BRIDGE_HALF - 1e-6:
            w = rng.uniform(2.4, 4.4)
            t1 = min(BRIDGE_HALF, t + w)
            if BRIDGE_HALF - t1 < 1.0:
                t1 = BRIDGE_HALF
            _deck_stone(p, rng, s0 + 0.035, s1 - 0.035, t + 0.035, t1 - 0.035,
                        BASALT if i % 6 == 3 else tones())
            t = t1
    # The grit under the deck (seen in the joints), on the ramp's line.
    bm = p.bm
    before = set(bm.faces)
    ts = [-BRIDGE_HALF + k * 0.5 for k in range(int(2 * BRIDGE_HALF / 0.5) + 1)]
    for j in range(len(ts) - 1):
        ta, tb = ts[j], ts[j + 1]
        sa0, sb0 = _bridge_clip(-1e9, ta), _bridge_clip(-1e9, tb)
        sa1, sb1 = _bridge_clip(1e9, ta), _bridge_clip(1e9, tb)
        m = 24
        for k in range(m):
            u0, u1 = k / m, (k + 1) / m
            q = [(sa0 + (sa1 - sa0) * u0, ta), (sb0 + (sb1 - sb0) * u0, tb), (sb0 + (sb1 - sb0) * u1, tb),
                 (sa0 + (sa1 - sa0) * u1, ta)]
            vs = [bm.verts.new((s, t, bridge_height(s) - 0.06)) for (s, t) in q]
            bm.faces.new(vs)
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(RAW):
        p._paint(faces, GRIT, 0)
    p.facing(faces, (0, 0, 1))
    # The parapets: coped walls down both sides, following the ramp, a gap
    # where the gate's standing stones stand.
    with p.as_kind(DRESSED):
        for side in (-1, 1):
            s = s_start + 0.3
            while s < s_end - 0.3:
                L = rng.uniform(1.4, 2.3)
                s1 = min(s_end - 0.3, s + L)
                if not (s1 > GATE_S - 1.05 and s < GATE_S + 1.05):
                    sc = (s + s1) / 2
                    slope = 0.0 if (sc <= 12.0 or sc >= 27.0) else -4.0 / 15.0
                    if s < 12.0 < s1 or s < 27.0 < s1:
                        # Never across a kink: cut at it.
                        cut = 12.0 if s < 12.0 < s1 else 27.0
                        s1 = cut
                        sc = (s + s1) / 2
                        slope = 0.0 if (sc <= 12.0 or sc >= 27.0) else -4.0 / 15.0
                    h = bridge_height(sc)
                    t0, t1 = sorted((side * (BRIDGE_HALF + 0.06), side * (BRIDGE_HALF + 0.8)))
                    prism_top(p, [(s + 0.05, t0), (s1 - 0.05, t0), (s1 - 0.05, t1), (s + 0.05, t1)], h + 0.64,
                              h - 1.6, p.vary(CURB if rng.random() < 0.75 else FASCIA, 0.05), bevel=0.07,
                              tilt=(slope, 0.0))
                    t0, t1 = sorted((side * (BRIDGE_HALF - 0.02), side * (BRIDGE_HALF + 0.9)))
                    prism_top(p, [(s + 0.02, t0), (s1 - 0.02, t0), (s1 - 0.02, t1), (s + 0.02, t1)], h + 0.96,
                              h + 0.6, p.vary(CURB_WORN, 0.05), bevel=0.14, tilt=(slope, 0.0))
                s = s1
    # The arch: a carved segmental arch of voussoirs under the deck, its
    # spandrels plumb with the parapets, its abutments falling into the
    # keels' rock.
    lo = (s_start - 3.0, -BRIDGE_HALF - 2.5, -26.0)
    hi = (s_end + 3.0, BRIDGE_HALF + 2.5, 4.3)
    f = Sculpt(lo, hi, 0.16)
    nf = Noise(5403)
    X, Y, Z = _axes(f)
    s_a, z_a = 14.4, -8.5
    s_b, z_b = 26.6, -11.5
    crown = -2.2
    mid = (s_a + s_b) / 2
    half = (s_b - s_a) / 2
    u = np.clip((X - mid) / half, -1.0, 1.0)
    spring = z_a + (z_b - z_a) * (u + 1.0) / 2.0
    intrados = spring + (crown - (z_a + z_b) / 2.0) * np.sqrt(np.maximum(0.0, 1.0 - u * u))
    deck = np.where(X <= 12.0, 4.0, np.where(X >= 27.0, 0.0, 4.0 - (X - 12.0) * 4.0 / 15.0))
    inside = (X > s_a) & (X < s_b)
    W = BRIDGE_HALF + 0.82
    # Past the springers the abutments: buttresses of the mountain's rock
    # falling steeply back into the keels, narrowing as they go down.
    abut_floor = np.where(X <= s_a, z_a - (s_a - X) * 2.2, np.where(X >= s_b, z_b - (X - s_b) * 2.2, -99.0))
    spring_z = np.where(X <= mid, z_a, z_b)
    narrow = np.clip(spring_z + 1.5 - Z, 0.0, None) * 0.42
    half_w = np.maximum(2.2, W - narrow * (~inside))
    under = np.where(inside, intrados, abut_floor)
    body = np.maximum(np.maximum(np.abs(Y) - half_w, Z - (deck - 0.32)), under - Z)
    ends = np.maximum(-(X - (s_start - 2.0)), X - (s_end + 2.0))
    body = np.maximum(body, ends)
    f.d = np.minimum(f.d, body.astype(np.float32))
    for k in range(10):
        x = s_start + k * (s_end - s_start) / 9.0
        f.parts.append((TONES[k % len(TONES)], RoundBox((x, 0.0, -16.0), (1.2, 12.0, 8.0), 0.2)))
    # The spandrels are dressed masonry: courses and staggered joints cut in
    # both faces between the arch's ring and the deck.
    f.parts.append(('dressed', Fn(lambda X, Y, Z: np.maximum(np.abs(np.abs(Y) - W) - 0.6, np.maximum(
        s_start - 0.5 - X, X - (s_end + 0.5))) + 0.0 * Z, (s_start - 1, -W - 1, -14), (s_end + 1, W + 1, 4.5))))
    for face in (-1, 1):
        zc = 3.4
        course = 0
        while zc > -9.0:
            xs = [q for q in np.linspace(s_start + 0.4, s_end - 0.4, 40)]
            pts = []
            for x in xs:
                top = (4.0 if x <= 12.0 else (0.0 if x >= 27.0 else 4.0 - (x - 12.0) * 4.0 / 15.0)) - 0.95
                uu = min(1.0, max(-1.0, (x - mid) / half))
                arch_top = (z_a + (z_b - z_a) * (uu + 1.0) / 2.0
                            + (crown - (z_a + z_b) / 2.0) * math.sqrt(max(0.0, 1 - uu * uu))) + 1.55
                lo_z = arch_top if s_a < x < s_b else -9.0
                if lo_z + 0.2 < zc < top - 0.2:
                    pts.append((float(x), face * W, zc))
                elif len(pts) > 1:
                    f.groove(Polyline(pts, 0.02), 0.07, 0.04)
                    pts = []
                else:
                    pts = []
            if len(pts) > 1:
                f.groove(Polyline(pts, 0.02), 0.07, 0.04)
            # The joints of this course, staggered from the one under it.
            x = s_start + 0.4 + (0.8 if course % 2 else 0.0)
            while x < s_end - 0.4:
                top = (4.0 if x <= 12.0 else (0.0 if x >= 27.0 else 4.0 - (x - 12.0) * 4.0 / 15.0)) - 0.95
                uu = min(1.0, max(-1.0, (x - mid) / half))
                arch_top = (z_a + (z_b - z_a) * (uu + 1.0) / 2.0
                            + (crown - (z_a + z_b) / 2.0) * math.sqrt(max(0.0, 1 - uu * uu))) + 1.55
                lo_z = arch_top if s_a < x < s_b else -9.0
                z0 = max(zc - 1.15, lo_z)
                if z0 + 0.3 < zc < top:
                    f.groove(Polyline([(x, face * W, z0), (x, face * W, zc)], 0.02), 0.06, 0.035)
                x += 1.7
            zc -= 1.15
            course += 1
    # The arch ring: dressed voussoirs (their joints radial on both faces)
    # and the spandrels' string course under the parapets.
    f.parts.append(('dressed', Fn(lambda X, Y, Z: np.maximum(np.abs(Y) - (W + 0.2), np.abs(
        Z - (np.where(X <= 12.0, 4.0, np.where(X >= 27.0, 0.0, 4.0 - (X - 12.0) * 4.0 / 15.0)) - 0.9)) - 0.55),
                                  (s_start - 3, -W - 1, -3), (s_end + 3, W + 1, 4.5))))
    ring = 1.5
    n_v = 15
    for k in range(n_v + 1):
        uu = -1.0 + 2.0 * k / n_v
        sx = mid + uu * half
        szp = z_a + (z_b - z_a) * (uu + 1.0) / 2.0 + (crown - (z_a + z_b) / 2.0) * math.sqrt(max(0.0, 1 - uu * uu))
        # The joint's direction: normal to the intrados.
        du = 1e-3
        u2 = min(1.0, uu + du)
        sz2 = z_a + (z_b - z_a) * (u2 + 1.0) / 2.0 + (crown - (z_a + z_b) / 2.0) * math.sqrt(max(0.0, 1 - u2 * u2))
        tx, tz = (u2 - uu) * half, sz2 - szp
        ln = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / ln, tx / ln
        if nz < 0:
            nx, nz = -nx, -nz
        for face in (-1, 1):
            a = (sx, face * W, szp)
            b = (sx + nx * ring, face * W, szp + nz * ring)
            f.groove(Polyline([a, b], 0.02), 0.12, 0.05)
    for face in (-1, 1):
        pts = []
        for k in range(31):
            uu = -1.0 + 2.0 * k / 30
            sx = mid + uu * half
            szp = z_a + (z_b - z_a) * (uu + 1.0) / 2.0 + (crown - (z_a + z_b) / 2.0) * math.sqrt(max(0.0, 1 - uu * uu))
            pts.append((sx, face * W, szp + ring))
        f.groove(Polyline(pts, 0.03), 0.14, 0.06)
    def arch_at(Xa):
        ua = np.clip((Xa - mid) / half, -1.0, 1.0)
        return z_a + (z_b - z_a) * (ua + 1.0) / 2.0 + (crown - (z_a + z_b) / 2.0) * np.sqrt(np.maximum(0.0, 1.0 - ua * ua))

    def deck_at(Xa):
        return np.where(Xa <= 12.0, 4.0, np.where(Xa >= 27.0, 0.0, 4.0 - (Xa - 12.0) * 4.0 / 15.0))

    f.parts.append(('dressed', Fn(lambda X, Y, Z: np.where((X > s_a) & (X < s_b), Z - (arch_at(X) + ring), 9.0)
                                  + 0.0 * Y, (s_a, -W - 1, -14), (s_b, W + 1, 0))))

    def disp(X, Y, Z):
        ins = (X > s_a) & (X < s_b)
        ring_k = np.where(ins, np.clip((Z - arch_at(X)) / 1.6, 0.0, 1.0), 0.0)
        return 0.5 * nf.fbm(X * 0.15, Y * 0.15, Z * 0.12, 3) * np.clip((deck_at(X) - 3.0 - Z) / 3.0, 0.0, 1.0) \
            * (1.0 - ring_k * 0.8)

    f.displace(disp, band=1.4)
    _clamp(f, np.where(np.abs(Y) < BRIDGE_HALF + 0.05, Z - (deck - 0.32), -50.0))
    f.cut_below(-26.0)
    _mesh(bpy, p, f, 'HeartBridgeArch', 9000)
    prng = p.rng
    # The keystone's crystal, both faces.
    for face in (-1, 1):
        base = (mid, face * (W + 0.05), crown + ring * 0.55)
        for k in range(4):
            ang = TAU * k / 4 + prng.uniform(-0.3, 0.3)
            d = (math.cos(ang) * 0.3, face * 1.0, math.sin(ang) * 0.3 - 0.2)
            with p.as_kind(PAINT):
                core_crystal(p, base, d, prng.uniform(0.6, 1.0), prng.uniform(0.12, 0.18), hot=0.5)
    return p


# ================================================================ the altars
ALTAR = dict(r=3.0, plinth=1.1)


def _plinth(f, rng):
    """The altars' shared stepped plinth: two dressed drums, chamfered, the
    upper carved with chevrons."""
    f.put('dressed', RoundBox((0, 0, 0.12), (2.95, 2.95, 0.42), 0.4, rot(rz=math.pi / 8)), 0.06)
    f.put('dressed', RoundBox((0, 0, 0.75), (2.55, 2.55, 0.3), 0.35, rot(rz=0.0)), 0.06)
    for k in range(16):
        a = TAU * k / 16
        r = 2.6
        p0 = (math.sin(a) * r, -math.cos(a) * r, 0.62)
        a1 = a + TAU / 32
        p1 = (math.sin(a1) * r, -math.cos(a1) * r, 0.92)
        a2 = a + TAU / 16
        p2 = (math.sin(a2) * r, -math.cos(a2) * r, 0.62)
        f.groove(Polyline([p0, p1, p2], 0.012), 0.06, 0.035)


def _altar_clamp(f):
    X, Y, Z = _axes(f)
    _clamp(f, np.where(Z < 3.0, np.sqrt(X * X + Y * Y) - 3.08, np.sqrt(X * X + Y * Y) - 3.45))


def altar(bpy, vein):
    """An altar (see the module doc): inside r 3.08 below 3 yd (the
    collider's 3 and a hair), its heart crystal pale (the runtime tints it
    with the vein's colour and dims it)."""
    seeds = {'hammer': 5501, 'breath': 5511, 'quench': 5521, 'heat': 5531}
    seed = seeds[vein]
    p = HSP('Kit_Altar' + vein.capitalize(), seed=seed, ao=0.6, ao_dist=1.6, dust=0.4)
    rng = np.random.default_rng(seed)
    f = Sculpt((-3.6, -3.6, -0.4), (3.6, 3.6, 8.6), 0.07)
    _plinth(f, rng)
    heart = (0.0, -0.4, 5.0)
    if vein == 'hammer':
        # Heavy ochre granite, pick-dressed, split down its middle round a
        # geode of ochre crystal broken open toward the platform.
        f.put('ochre', block(rng, (-0.95, 0.1, 3.3), (2.3, 3.8, 4.7), cuts=16, chamfer=(0.78, 0.96),
                             R=rot(ry=-0.07, rz=0.06), top_tilt=0.2), 0.15)
        f.put('ochre2', block(rng, (1.0, 0.05, 3.0), (2.2, 3.6, 4.2), cuts=16, chamfer=(0.78, 0.96),
                              R=rot(ry=0.09, rz=-0.05), top_tilt=0.25), 0.15)
        f.put('g2', block(rng, (-0.2, 0.3, 5.9), (3.3, 2.9, 1.3), cuts=14, chamfer=(0.72, 0.94),
                          R=rot(rz=0.15, ry=-0.08)), 0.2)
        f.put('ochre', block(rng, (0.6, 0.6, 6.7), (1.9, 1.8, 1.0), cuts=12, chamfer=(0.7, 0.93),
                             R=rot(rz=-0.3, ry=0.12)), 0.15)
        f.sub(Ellipsoid((0.05, -1.35, 3.7), (1.3, 1.3, 1.9)), 0.2)
        f.groove(Polyline([(0.05, -1.9, 1.3), (0.1, -1.6, 2.2)], 0.02), 0.2, 0.08)
        heart = (0.05, -0.85, 3.5)
    elif vein == 'breath':
        # Twisted storm stone, narrowing as it rises, bored by the wind, two
        # horns curling up to cradle the crystal.
        z = 1.0
        k = 0
        while z < 5.4:
            h = rng.uniform(1.0, 1.4)
            w = 2.7 - (z - 1.0) * 0.18
            f.put(('storm', 'storm2', 'storm')[k % 3], block(rng, (0.0, 0.1 * k, z + h / 2), (w, w * 0.82, h * 1.1),
                                                              cuts=8, chamfer=(0.82, 0.96), R=rot(rz=0.38 * k)), 0.3)
            z += h * 0.9
            k += 1
        f.sub(Ellipsoid((0.2, 0.0, 2.6), (1.6, 0.4, 0.45), rot(rz=0.6)), 0.12)
        f.sub(Ellipsoid((-0.3, 0.0, 4.1), (1.4, 0.35, 0.4), rot(rz=-0.7)), 0.12)
        for s in (-1, 1):
            f.put('storm2', block(rng, (s * 0.95, 0.15, 6.6), (0.7, 1.3, 3.2), cuts=10, chamfer=(0.7, 0.93),
                                  R=rot(ry=s * 0.32, rz=s * 0.3), top_tilt=0.35), 0.2)
            f.sub(Ellipsoid((s * 1.15, 0.1, 6.9), (0.5, 0.9, 0.3), rot(ry=s * 0.3)), 0.1)
        heart = (0.0, -0.3, 5.9)
    elif vein == 'quench':
        # A squat block of frost granite, cracked by the cold (the ice
        # mantle and the rime are laid over it below).
        f.put('frost', block(rng, (0.0, 0.1, 1.55), (4.0, 3.8, 1.4), cuts=12, chamfer=(0.8, 0.96),
                             R=rot(rz=0.12)), 0.16)
        f.put('frost2', block(rng, (0.1, 0.5, 2.6), (2.4, 2.0, 2.4), cuts=12, chamfer=(0.76, 0.95),
                              R=rot(rz=-0.3)), 0.2)
        f.put('frost', block(rng, (0.0, 0.2, 5.75), (2.9, 2.7, 0.9), cuts=12, chamfer=(0.78, 0.95),
                             R=rot(rz=-0.2, ry=0.05)), 0.12)
        f.sub(Ellipsoid((0.0, -0.3, 6.3), (1.0, 0.95, 0.6)), 0.12)
        heart = (0.0, -0.3, 6.0)
    else:
        # A bundle of the Hearth's basalt columns, stepped, split at its
        # crown where the fire crystal bursts out.
        for (cx, cy) in _bundle_layout(rng, 2.5, 0.62):
            r = math.hypot(cx, cy)
            if r > 2.25:
                continue
            top = 6.2 - r * 0.9 + float(rng.uniform(-0.5, 0.4))
            if r < 0.7:
                top = 5.0
            f.put(('basalt', 'basalt2', 'basalt')[int(rng.integers(0, 3))],
                  hex_column((cx, cy), 0.62, 0.8, max(2.0, top), phase=float(rng.uniform(0, 1)),
                             top_tilt=(float(rng.uniform(-0.2, 0.2)), float(rng.uniform(-0.2, 0.2)))), 0.04)
        heart = (0.0, -0.2, 5.2)
    _weather(f, seed, amp=0.08, scale=0.7, band=0.35)
    f.cut_below(0.0)
    _altar_clamp(f)
    _mesh(bpy, p, f, 'Altar' + vein, 5200)
    prng = p.rng
    # The vein's heart: a cluster of pale crystal (tinted at runtime).
    if vein == 'hammer':
        # The geode: prisms growing inward off its walls toward its mouth,
        # the largest at its back.
        for k in range(22):
            a = prng.uniform(0, TAU)
            ring = prng.uniform(0.55, 1.0)
            wall = Vector((heart[0] + math.cos(a) * 1.05 * ring, heart[1] + 0.75, heart[2] + math.sin(a) * 1.5 * ring))
            d = Vector((heart[0], heart[1] - 1.4, heart[2])) - wall
            d = d.normalized() + Vector((0.0, -0.5, 0.0))
            with p.as_kind(PAINT):
                pale_crystal(p, tuple(wall), tuple(d), prng.uniform(0.6, 1.25) * (1.3 - ring * 0.4),
                             prng.uniform(0.13, 0.24), bright=0.15 if k < 4 else 0.0)
        for k in range(4):
            a = prng.uniform(0, TAU)
            with p.as_kind(PAINT):
                pale_crystal(p, (prng.uniform(-0.8, 0.8), prng.uniform(-0.6, 0.8), 6.4),
                             (math.cos(a) * 0.4, math.sin(a) * 0.4, 1.0), prng.uniform(0.7, 1.4),
                             prng.uniform(0.15, 0.24))
    else:
        n = 7 if vein != 'heat' else 9
        tall = {'breath': 2.0, 'quench': 1.7, 'heat': 2.6}[vein]
        for k in range(n):
            a = TAU * k / max(1, n - 1) + prng.uniform(-0.3, 0.3)
            lean = 0.0 if k == 0 else 0.45
            d = (math.cos(a) * lean, math.sin(a) * lean - (0.15 if k == 0 else 0.0), 1.0)
            with p.as_kind(PAINT):
                pale_crystal(p, heart, d, prng.uniform(0.8, 1.0) * tall * (1.0 if k == 0 else 0.6),
                             prng.uniform(0.18, 0.3) * (1.0 if k == 0 else 0.75), bright=0.1 if k == 0 else 0.0)
    if vein == 'breath':
        # Fused glass run down from the strikes (dark, glossy).
        for s in (-1, 1):
            for k in range(6):
                z = 5.0 - k * 0.7
                with p.as_kind(PAINT):
                    crystal(p, (s * (1.3 - k * 0.02), -0.9, z), (0.12, 0.08, 0.6), p.vary(GLASS, 0.05), n=10,
                            boxy=0.5, jitter=0.12)
    elif vein == 'quench':
        # The ice mantle: plates of clear ice over its shoulders and its
        # front, icicles off its brow, rime on the ledges.
        # The ice: three great columns of clear ice fused, leaning together
        # between the granite foot and the cradle, deep blue at their hearts.
        for k, (x, y, w, lean) in enumerate(((-0.75, 0.0, 1.9, -0.08), (0.8, -0.2, 1.8, 0.1), (0.0, 0.75, 1.7, 0.0))):
            crystal(p, (x, y, 3.85), (w, w * 0.9, 3.8), p.vary(ICE_BODY if k != 2 else ICE_DEEP, 0.05), n=22,
                    boxy=0.78, jitter=0.07, roll=lean, mat=ICE)
        for k in range(8):
            a = TAU * k / 8 + prng.uniform(-0.2, 0.2)
            c = (math.sin(a) * 1.55, -math.cos(a) * 1.45, prng.uniform(2.6, 5.0))
            crystal(p, c, (0.9, 0.7, prng.uniform(1.2, 2.0)), p.vary(ICE_BODY, 0.06), n=14, boxy=0.7, jitter=0.1,
                    yaw=-a, mat=ICE)
        for k in range(18):
            a = prng.uniform(0, TAU)
            x = math.sin(a) * 1.4
            y = -1.3 * math.cos(a)
            L = prng.uniform(0.4, 1.2)
            hull(p, [Vector((x - 0.09, y, 5.32)), Vector((x + 0.09, y, 5.32)), Vector((x, y - 0.09, 5.32)),
                     Vector((x, y + 0.08, 5.32)), Vector((x + prng.uniform(-0.03, 0.03), y, 5.32 - L))],
                 p.vary(ICE_BODY, 0.05), mat=ICE)
        with p.as_kind(PAINT):
            for k in range(10):
                a = prng.uniform(0, TAU)
                r = prng.uniform(0.5, 1.4)
                crystal(p, (math.sin(a) * r, -math.cos(a) * r * 0.9, 6.2), (0.6, 0.45, 0.1), p.vary(RIME, 0.03), n=16,
                        boxy=1.0, jitter=0.05, yaw=prng.uniform(0, TAU))
    elif vein == 'heat':
        # Ash on the column heads, soot up the faces near the fire.
        with p.as_kind(PAINT):
            for k in range(10):
                a = prng.uniform(0, TAU)
                r = prng.uniform(1.0, 2.1)
                crystal(p, (math.sin(a) * r, -math.cos(a) * r, 6.2 - r * 0.9 + 0.05), (0.9, 0.7, 0.1),
                        p.vary(ASH, 0.04), n=16, boxy=1.0, jitter=0.05, yaw=prng.uniform(0, TAU))
    # Rubble round the plinth's foot.
    with p.as_kind(RAW):
        for k in range(12):
            a = prng.uniform(0, TAU)
            r = prng.uniform(2.95, 3.05)
            s = prng.uniform(0.12, 0.24)
            crystal(p, (math.sin(a) * r, -math.cos(a) * r, s * 0.2), (s * 1.3, s * 1.0, s * 0.4),
                    p.vary(GRANITE if k % 2 else GRANITE_COOL, 0.07), n=10, boxy=0.55, jitter=0.2,
                    yaw=prng.uniform(0, TAU), floor=0.0)
    return p


# ================================================================ the roots
def _bez(t, P):
    a, b, c = (np.asarray(q, dtype=np.float64) for q in P)
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t * t * c


def _bez_d(t, P):
    a, b, c = (np.asarray(q, dtype=np.float64) for q in P)
    return 2 * (1 - t) * (b - a) + 2 * t * (c - b)


def heart_root(bpy):
    """A root of the mountain (see the module doc): three strands of rock
    braided round its spine, thickening from the altar to the crown, knotted
    here and there, its fingers gripping the altar's crown behind its heart;
    pale crystal veins wound along it (the runtime tints them)."""
    p = HSP('Kit_HeartRoot', seed=5601, ao=0.55, ao_dist=4.0, dust=0.0)
    rng = np.random.default_rng(5601)
    S = ROOT_SPINE
    f = Sculpt((-14.0, -3.0, 1.5), (14.0, 64.0, 68.0), 0.3)
    n1 = Noise(5603)
    N = 40
    spine = [_bez(k / N, S) for k in range(N + 1)]
    strands = []
    for j in range(3):
        pts = []
        radii = []
        for k in range(N + 1):
            t = k / N
            c = spine[k]
            d = _bez_d(t, S)
            d = d / np.linalg.norm(d)
            side = np.cross(d, (0.0, 0.0, 1.0))
            side = side / max(1e-6, np.linalg.norm(side))
            up = np.cross(side, d)
            ang = TAU * j / 3 + t * 5.5
            spread = 0.9 + 3.6 * t ** 0.85
            q = c + (side * math.cos(ang) + up * math.sin(ang)) * spread
            pts.append(tuple(q))
            radii.append(1.1 + 3.4 * t ** 0.8 + 0.25 * math.sin(k * 1.7 + j))
        strands.append(pts)
        f.put(('g0', 'g1', 'g3')[j], Polyline(pts, radii), 0.6)
    f.put('bed', Polyline([tuple(q) for q in spine], [1.2 + 3.6 * (k / N) ** 0.85 for k in range(N + 1)]), 0.9)
    # Knots where the strands bind.
    for t in (0.22, 0.47, 0.71):
        c = _bez(t, S)
        f.put('g2', Ellipsoid(tuple(c), (2.4 + 5.0 * t, 2.4 + 5.0 * t, 2.0 + 4.2 * t)), 1.2)
    # The fingers gripping the altar's crown behind its heart.
    base = np.asarray(S[0])
    for (fx, fy, fz) in ((-2.1, 1.0, 4.9), (-1.2, 2.3, 5.4), (1.2, 2.3, 5.4), (2.1, 1.0, 4.9), (0.0, 2.7, 5.6)):
        mid = (base + np.array((fx, fy, fz))) / 2 + np.array((0.0, 0.3, 0.9))
        f.put('g1', Polyline([tuple(base + np.array((0.0, 0.8, 0.6))), tuple(mid), (fx, fy, fz)], [0.7, 0.5, 0.28]),
              0.3)
    f.displace(lambda X, Y, Z: 0.35 * n1.fbm(X * 0.25, Y * 0.12, Z * 0.25, 3)
               + 0.2 * (n1.ridged(X * 0.6, Y * 0.3, Z * 0.6, 2) - 0.45), band=1.2)
    X, Y, Z = _axes(f)
    # Never inside the altar's body under its crown.
    _clamp(f, np.where((np.sqrt(X * X + Y * Y) < 3.1) & (Z < 4.7), 4.7 - Z, -1.0))
    _mesh(bpy, p, f, 'HeartRoot', 9000)
    prng = p.rng
    # The veins: pale crystal laid along each strand's crown, and clusters
    # breaking out at the knots.
    for j, pts in enumerate(strands):
        for k in range(2, N - 1, 2):
            a = np.asarray(pts[k])
            b = np.asarray(pts[k + 1])
            t = k / N
            r = 1.1 + 3.4 * t ** 0.8
            up = np.array((0.0, -0.2, 1.0))
            up = up / np.linalg.norm(up)
            q = (a + b) / 2 + up * (r * 0.92)
            seg = b - a
            with p.as_kind(PAINT):
                crystal(p, tuple(q), (0.28 + 0.4 * t, 0.28 + 0.4 * t, float(np.linalg.norm(seg)) * 1.05),
                        PALE_HI if k % 4 else p.vary((0.8, 0.8, 0.82), 0.03), n=10, boxy=0.4, jitter=0.15,
                        yaw=math.atan2(seg[0], -seg[1]), pitch=math.atan2(math.hypot(seg[0], seg[1]), seg[2]),
                        mat=GLOW)
    for t in (0.22, 0.47, 0.71):
        c = _bez(t, S)
        for k in range(5):
            ang = prng.uniform(0, TAU)
            d = (math.cos(ang), math.sin(ang) * 0.5, prng.uniform(-0.2, 0.9))
            base = (c[0] + math.cos(ang) * (2.2 + 5.0 * t), c[1], c[2] + math.sin(ang) * (1.8 + 4.0 * t))
            with p.as_kind(PAINT):
                pale_crystal(p, base, d, prng.uniform(1.6, 3.6) * (0.6 + t), prng.uniform(0.3, 0.7) * (0.7 + t))
    return p


# ================================================================ the heart
def heart_crystal(bpy):
    """The heart (see the module doc): a double-ended crystal six yards long
    and its satellites, facets pale (the runtime's shader draws the veins)."""
    p = HSP('Kit_HeartCrystal', seed=5701, ao=0.0)
    rng = p.rng
    sides = 7
    pts = []
    for (z, r) in ((-0.6, 1.75), (0.9, 1.9)):
        for k in range(sides):
            a = TAU * k / sides + rng.uniform(-0.08, 0.08) + (0.2 if z > 0 else 0.0)
            pts.append(Vector((math.cos(a) * r, math.sin(a) * r * 0.92, z)))
    pts.append(Vector((0.15, -0.1, 3.6)))
    pts.append(Vector((-0.1, 0.1, -2.8)))
    faces = hull(p, pts, PALE_HI, mat=GLOW)
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(LIGHT)
        c = tuple(PALE_LO[i] + (PALE_HI[i] - PALE_LO[i]) * (0.3 + 0.7 * k) for i in range(3))
        for loop in fc.loops:
            loop[p.col] = (*c, 1.0)
    for k in range(7):
        a = TAU * k / 7 + rng.uniform(-0.3, 0.3)
        up = rng.choice([-1, 1]) * rng.uniform(0.3, 0.9)
        d = (math.cos(a), math.sin(a), up)
        base = (math.cos(a) * 1.2, math.sin(a) * 1.1, rng.uniform(-0.6, 0.8))
        pale_crystal(p, base, d, rng.uniform(1.1, 2.1), rng.uniform(0.28, 0.48))
    return p


def core_bed(bpy):
    """The heart's bed deep in the chasm (see the module doc): a crater of
    rock round the hollow the heart rose from, lined with crystal of its
    white-gold, falling away into the dark below."""
    p = HSP('Kit_CoreBed', seed=5801, ao=0.55, ao_dist=5.0, dust=0.0)
    rng = np.random.default_rng(5801)
    f = Sculpt((-27.0, -27.0, -32.0), (27.0, 27.0, 5.0), 0.3)
    n1 = Noise(5803)

    def body(X, Y, Z):
        r = np.sqrt(X * X + Y * Y)
        t = np.clip(-Z / 30.0, 0.0, 1.0)
        R = 23.5 * (1.0 - t) ** 0.9 + 1.0
        return np.maximum(r - R, Z - (1.2 - 0.06 * np.maximum(0.0, 20 - r)))

    f.put('deep', Fn(body, (-27, -27, -32), (27, 27, 5)), 0.0)
    f.sub(Ellipsoid((0, 0, 3.5), (17.0, 17.0, 6.5)), 1.0)
    f.sub(Ellipsoid((0, 0, -1.0), (5.2, 5.2, 4.0)), 0.6)
    for k in range(14):
        a = rng.uniform(0, TAU)
        c = (math.sin(a) * 19.0, -math.cos(a) * 19.0, rng.uniform(-3.0, 1.0))
        f.put(('deep2', 'deep', 'deep2')[k % 3], block(rng, c, (rng.uniform(4, 8), rng.uniform(4, 8), rng.uniform(3, 6)),
                                               cuts=8, chamfer=(0.7, 0.92), R=rot(rz=float(a))), 0.8)
    f.displace(lambda X, Y, Z: 0.7 * n1.fbm(X * 0.1, Y * 0.1, Z * 0.1, 3)
               + 0.35 * (n1.ridged(X * 0.25, Y * 0.25, Z * 0.25, 2) - 0.45), band=2.0)
    f.cut_below(-31.5)
    _mesh(bpy, p, f, 'CoreBed', 7000)
    prng = p.rng
    # The crystal lining the crater, tallest round the hollow, leaning in.
    for k in range(46):
        a = prng.uniform(0, TAU)
        r = prng.uniform(5.5, 19.0)
        z = -1.0 + (r - 5.5) * 0.12 + prng.uniform(-0.3, 0.3)
        lean_in = 0.2 + 0.25 * (r / 19.0)
        d = (-math.sin(a) * lean_in + prng.uniform(-0.15, 0.15), math.cos(a) * lean_in + prng.uniform(-0.15, 0.15),
             1.0)
        h = prng.uniform(2.0, 4.0) * (1.6 - r / 19.0) * 1.4
        with p.as_kind(PAINT):
            core_crystal(p, (math.sin(a) * r, -math.cos(a) * r, z), d, h, prng.uniform(0.35, 0.8) * (h / 3.5),
                         hot=0.6 * (1 - r / 19.0))
    # The hollow's own bed: a nest of small crystal (the heart's socket).
    for k in range(18):
        a = prng.uniform(0, TAU)
        r = prng.uniform(0.5, 4.5)
        with p.as_kind(PAINT):
            core_crystal(p, (math.sin(a) * r, -math.cos(a) * r, -3.5 + r * 0.4),
                         (math.sin(a) * 0.4, -math.cos(a) * 0.4, 1.0), prng.uniform(0.8, 1.8),
                         prng.uniform(0.2, 0.4), hot=0.9)
    return p


# ================================================================ the colossus
def _seams(p, f, pts_list, width=0.18):
    """Seams of the heart's light in a rock piece's cracks (pale: tinted at
    runtime), carved before meshing; returns the lines."""
    out = []
    for pts in pts_list:
        on = [tuple(q) for q in f.snap(np.array(pts, dtype=np.float64), steps=8)]
        f.groove(Polyline(on, 0.02), width * 1.3, width * 0.6)
        out.append(on)
    return out


def _seam_glow(p, f, lines, width):
    for on in lines:
        pts = [tuple(q) for q in f.snap(np.array(on, dtype=np.float64), lift=-0.06, steps=8)]
        for q0, q1 in zip(pts, pts[1:]):
            a = Vector(q0)
            b = Vector(q1)
            seg = b - a
            if seg.length < 1e-3:
                continue
            with p.as_kind(PAINT):
                crystal(p, tuple((a + b) / 2), (width, width, seg.length * 1.08), p.vary(PALE_HI, 0.04), n=10,
                        boxy=0.4, jitter=0.12, yaw=math.atan2(seg.x, -seg.y),
                        pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z), mat=GLOW)


def _wander(rng, a, b, steps, amp):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    d = b - a
    side = np.cross(d, (0.0, 0.0, 1.0))
    n = np.linalg.norm(side)
    side = side / n if n > 1e-6 else np.array((1.0, 0.0, 0.0))
    out = []
    off = 0.0
    for i in range(steps + 1):
        t = i / steps
        off += rng.uniform(-amp, amp)
        off *= 0.8
        out.append(tuple(a + d * t + side * off * math.sin(t * math.pi)))
    return out


def _rock_piece(bpy, name, seed, size, blocks, target, voxel, seams=(), sub=(), strata=True, extra=None):
    """A colossus rock piece: a few big faceted blocks of the room's granite
    fused into one mass (its beds banding it), carved with the cracks the
    heart's light shines through."""
    p = HSP(name, seed=seed, ao=0.6, ao_dist=1.8, dust=0.0)
    rng = np.random.default_rng(seed)
    hx, hy, hz = (s / 2 + 1.2 for s in size)
    f = Sculpt((-hx, -hy, -hz), (hx, hy, hz), voxel)
    n1 = Noise(seed + 3)
    for i, (c, s, R, label) in enumerate(blocks):
        # A boulder's rounded mass under each block, the block's broken facets
        # cut over it: natural mountain rock, never a cut box.
        f.put(label or TONES[i % len(TONES)], Ellipsoid(c, tuple(v * 0.47 for v in s), R), 0.4)
        f.put(label or TONES[i % len(TONES)], block(rng, c, tuple(v * 1.04 for v in s), cuts=22,
                                                    chamfer=(0.6, 0.9), R=R), 0.45)
    for prim, k in sub:
        f.sub(prim, k)
    if extra:
        extra(f, rng)
    if strata:
        # The mountain's beds: shallow grooves banding it.
        for z in np.arange(-hz + 0.8, hz - 0.5, 1.3):
            f.groove(Polyline([(-hx, -hy, float(z)), (hx, -hy, float(z) + 0.2), (hx, hy, float(z)),
                               (-hx, hy, float(z) - 0.2), (-hx, -hy, float(z))], 0.03), 0.08, 0.06)
    f.displace(lambda X, Y, Z: 0.22 * n1.fbm(X * 0.4, Y * 0.4, Z * 0.4, 3)
               + 0.12 * (n1.ridged(X * 1.0, Y * 1.0, Z * 1.0, 2) - 0.45), band=0.8)
    # Extra cracks wandering over its faces (the heart's light shows through
    # the whole body, never only at its front).
    extra_seams = []
    for k in range(3):
        a = rng.uniform(0, TAU)
        b = a + rng.uniform(1.2, 2.4)
        z0, z1 = rng.uniform(-hz * 0.6, hz * 0.6), rng.uniform(-hz * 0.6, hz * 0.6)
        extra_seams.append(((math.cos(a) * hx, math.sin(a) * hy, z0), (math.cos(b) * hx, math.sin(b) * hy, z1)))
    lines = _seams(p, f, [_wander(rng, a, b, 8, 0.25) for (a, b) in list(seams) + extra_seams])
    _mesh(bpy, p, f, name.replace('Kit_', ''), target)
    _seam_glow(p, f, lines, 0.2)
    return p


def col_torso(bpy):
    """The chest: three great slabs about a socket open at the front (-Y)
    where the heart sits, cracked across, the seams round the socket."""
    blocks = [
        ((0.0, 0.4, 1.2), (8.6, 4.8, 4.0), rot(rx=0.05), 'g2'),
        ((-2.3, 0.1, -1.6), (4.2, 4.4, 3.6), rot(rz=0.12, ry=0.05), 'g0'),
        ((2.3, 0.0, -1.7), (4.0, 4.2, 3.4), rot(rz=-0.1, ry=-0.06), 'g1'),
        ((0.0, 1.2, 3.3), (6.0, 3.2, 1.6), rot(rx=-0.15), 'g2'),
        ((0.0, 0.8, -3.4), (3.6, 3.2, 1.6), rot(rz=0.3), 'g1'),
        ((0.0, 0.6, -1.0), (3.2, 4.0, 3.6), rot(rz=0.6), 'g2'),
        ((0.0, 1.6, 0.6), (5.0, 2.6, 4.6), rot(rx=0.1), 'g1'),
    ]
    sub = [(Ellipsoid((0.0, -2.5, 0.5), (2.3, 1.9, 2.8)), 0.3)]
    seams = [((-2.1, -2.0, 0.5), (-3.8, -1.6, 2.6)), ((2.1, -2.0, 0.4), (3.9, -1.5, -1.8)),
             ((0.0, -2.0, 3.0), (1.4, -1.0, 3.9)), ((-0.6, -2.0, -2.4), (-2.6, -1.2, -3.3))]
    return _rock_piece(bpy, 'Kit_ColTorso', 5901, (9.0, 6.0, 8.0), blocks, 5200, 0.12, seams=seams, sub=sub)


def col_hip(bpy):
    blocks = [((0.0, 0.0, 0.0), (6.6, 4.2, 2.6), rot(rz=0.05), 'g2'),
              ((-1.9, 0.3, -0.9), (2.6, 3.2, 1.8), rot(rz=0.2), 'g0'),
              ((1.9, 0.2, -0.9), (2.5, 3.0, 1.8), rot(rz=-0.25), 'g1')]
    seams = [((-2.6, -2.0, 0.3), (2.4, -2.0, 0.1)), ((0.3, -2.0, -0.6), (0.2, -1.4, -1.6))]
    return _rock_piece(bpy, 'Kit_ColHip', 5911, (7.0, 4.6, 3.4), blocks, 2600, 0.1, seams=seams)


def col_head(bpy):
    """The head: a heavy block of the crown's rock, its brow a ledge over a
    deep cleft where a band of the heart's light burns (no face: a mountain
    looking out), broken crags leaning back off its crown."""
    def crags(f, rng):
        # Three broken crags of unequal height leaning their own ways, a
        # spike or two between (the mountain's crown on its brow).
        # A crown of peaks like the mountain's own range: tapering spires of
        # unequal height spread over the brow, each with a lower shoulder
        # peak leaning off it (a skyline, never a row of fingers).
        for k, (x, y, r, h, lean) in enumerate(((-1.45, 0.6, 1.05, 2.3, -0.5), (0.15, 1.0, 1.25, 3.7, -0.08),
                                                (1.55, 0.5, 0.95, 2.0, 0.55))):
            tip = (x + math.sin(lean) * h, y + 0.6, 1.0 + math.cos(lean) * h)
            f.put(('g0', 'g4', 'g2')[k], RoundCone((x, y, 0.9), tip, r, 0.06), 0.35)
            sx = x + (0.55 if k != 2 else -0.55)
            stip = (sx + math.sin(lean * 1.6 + 0.3) * h * 0.55, y + 0.2, 1.0 + h * 0.5)
            f.put('g1', RoundCone((sx, y - 0.1, 0.9), stip, r * 0.7, 0.05), 0.3)
        for (x, y, h) in ((-0.45, 0.2, 1.3), (0.95, 1.6, 1.1)):
            f.put('g1', RoundCone((x, y, 1.2), (x * 1.1, y * 1.1 + 0.2, 1.2 + h), 0.45, 0.08), 0.2)
        # The cleft under the brow, right across the front.
        f.sub(RoundBox((0.0, -1.75, 0.05), (1.55, 0.55, 0.26), 0.12), 0.1)

    blocks = [((0.0, 0.1, 0.0), (3.8, 3.4, 2.6), rot(rz=0.06), 'g2'),
              ((0.0, -0.75, 0.55), (4.0, 1.6, 0.9), rot(rx=-0.12), 'g0'),
              ((0.0, -0.4, -1.05), (3.0, 2.6, 1.3), rot(rx=0.2), 'g1')]
    p = _rock_piece(bpy, 'Kit_ColHead', 5921, (4.4, 4.4, 5.4), blocks, 3000, 0.08,
                    seams=[((-1.7, -1.6, 0.9), (-1.9, 0.4, 1.4)), ((1.6, -1.6, -0.7), (1.9, 0.6, -1.0))],
                    extra=crags)
    # The band of light in the cleft: a row of crystal lying along it.
    x = -1.35
    while x < 1.4:
        L = p.rng.uniform(0.32, 0.5)
        pale_crystal(p, (x, -1.45, 0.05), (1.0, p.rng.uniform(-0.6, -0.2), p.rng.uniform(-0.15, 0.15)), L,
                     p.rng.uniform(0.1, 0.16), bright=0.3)
        x += L * 0.7
    return p


def col_shoulder(bpy):
    blocks = [((0.0, 0.0, 0.3), (4.8, 4.2, 3.6), rot(rz=0.2, ry=-0.15), 'g2'),
              ((0.7, 0.2, 1.8), (3.2, 3.0, 1.6), rot(ry=-0.3), 'g0'),
              ((-0.8, -0.3, -1.4), (2.6, 2.6, 1.6), rot(rz=-0.3), 'g1')]
    seams = [((-1.9, -2.0, 0.6), (1.8, -1.8, 1.5)), ((1.0, -1.9, -0.6), (2.2, -1.2, -1.3))]
    return _rock_piece(bpy, 'Kit_ColShoulder', 5931, (5.4, 4.8, 4.8), blocks, 3000, 0.09, seams=seams)


def col_upper_arm(bpy):
    """The upper arm, its axis along Z (6.5 long)."""
    blocks = [((0.0, 0.0, 1.5), (2.8, 2.7, 3.6), rot(rz=0.3), 'g0'),
              ((0.1, 0.1, -1.6), (2.5, 2.4, 3.4), rot(rz=-0.25), 'g2'),
              ((0.2, -0.3, 0.0), (2.0, 2.0, 2.0), rot(rz=0.9), 'g1')]
    seams = [((-1.2, -1.3, 2.6), (1.0, -1.3, -2.4))]
    return _rock_piece(bpy, 'Kit_ColUpperArm', 5941, (3.0, 3.0, 6.6), blocks, 2400, 0.09, seams=seams)


def col_forearm(bpy):
    """The forearm, its axis along Z (6 long), thickening to the wrist (-Z)."""
    blocks = [((0.0, 0.0, 1.6), (2.6, 2.6, 2.8), rot(rz=0.2), 'g1'),
              ((0.0, 0.0, -1.2), (3.4, 3.2, 3.2), rot(rz=-0.35), 'g2'),
              ((0.4, -0.5, -0.2), (2.0, 2.2, 1.8), rot(rz=1.1), 'g2')]
    seams = [((-1.5, -1.5, -2.2), (0.9, -1.3, 2.4)), ((1.5, -0.6, -1.0), (1.2, 0.9, -2.3))]
    return _rock_piece(bpy, 'Kit_ColForearm', 5951, (3.6, 3.6, 6.2), blocks, 2600, 0.09, seams=seams)


def col_fist(bpy):
    """The fist: a knuckled boulder, its striking face toward -Z."""
    def knuckles(f, rng):
        for k in range(4):
            x = -1.35 + k * 0.9
            f.put(('g0', 'g3', 'g0', 'g1')[k], Ellipsoid((x, -0.9, -1.35), (0.58, 0.62, 0.5)), 0.25)

    blocks = [((0.0, 0.0, 0.2), (4.0, 3.4, 3.4), rot(rz=0.1), 'g2'),
              ((-1.4, -0.9, 0.4), (1.4, 1.6, 2.2), rot(rz=0.5), 'g2')]
    seams = [((-1.6, -1.8, 0.8), (1.7, -1.7, 0.3)), ((1.9, -0.4, 0.9), (1.9, 1.0, -0.8))]
    return _rock_piece(bpy, 'Kit_ColFist', 5961, (4.4, 4.0, 4.2), blocks, 2600, 0.08, seams=seams, extra=knuckles)


def col_shard(bpy, variant):
    seeds = {'A': 5971, 'B': 5981, 'C': 5991}
    sizes = {'A': 1.6, 'B': 2.4, 'C': 3.2}
    s = sizes[variant]
    blocks = [((0.0, 0.0, 0.0), (s, s * 0.8, s * 1.1), rot(rz=0.4, ry=0.3), 'g0' if variant != 'B' else 'g2'),
              ((s * 0.2, 0.0, s * 0.3), (s * 0.6, s * 0.6, s * 0.7), rot(rz=-0.6), 'g1')]
    seams = [((-s * 0.4, -s * 0.42, s * 0.3), (s * 0.4, -s * 0.38, -s * 0.3))]
    return _rock_piece(bpy, 'Kit_ColShard' + variant, seeds[variant], (s * 1.2, s * 1.0, s * 1.3), blocks,
                       700 + int(s * 300), 0.06, seams=seams, strata=False)


# ================================================================ the floor marks
def torn_socket(bpy):
    """The scar a torn-out piece leaves in the paving (flat, a hand high at
    most): a ring of broken flag edges round a dark hollow of dust and
    grit, cracks running out from it."""
    p = HSP('Kit_TornSocket', seed=6101, ao=0.3, ao_dist=0.5, dust=0.2)
    rng = p.rng
    bm = p.bm
    before = set(bm.faces)
    n = 40
    vs = []
    for k in range(n):
        a = TAU * k / n
        r = 3.0 + 0.5 * math.sin(a * 3 + 1.0) + rng.uniform(-0.2, 0.2)
        vs.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0.05)))
    bm.faces.new(vs)
    faces = [f for f in bm.faces if f not in before]
    with p.as_kind(PAINT):
        p._paint(faces, (0.21, 0.2, 0.2), 0)
    p.facing(faces, (0, 0, 1))
    with p.as_kind(RAW):
        for k in range(26):
            a = rng.uniform(0, TAU)
            r = rng.uniform(2.6, 4.0)
            s = rng.uniform(0.25, 0.6)
            slab(p, (math.cos(a) * r, math.sin(a) * r, 0.06), (s * 1.4, s, 0.1), p.vary(FLAG if k % 2 else FLAG_DARK,
                                                                                    0.06),
                 yaw=rng.uniform(0, TAU), pitch=rng.uniform(-0.1, 0.1), chamfer=0.2, jitter=0.15)
        for k in range(30):
            a = rng.uniform(0, TAU)
            r = rng.uniform(0.0, 2.6)
            s = rng.uniform(0.08, 0.2)
            slab(p, (math.cos(a) * r, math.sin(a) * r, 0.07), (s * 1.4, s, s * 0.35), p.vary(GRANITE_DARK, 0.08),
                 yaw=rng.uniform(0, TAU), chamfer=0.25, jitter=0.2)
    # Cracks out across the paving (dark, flat).
    with p.as_kind(PAINT):
        for k in range(7):
            a = rng.uniform(0, TAU)
            r = 3.0
            for i in range(6):
                x, y = math.cos(a) * r, math.sin(a) * r
                L = rng.uniform(0.5, 0.9)
                crystal(p, (x, y, 0.045), (0.07, L, 0.02), (0.1, 0.095, 0.1), n=8, boxy=0.9, jitter=0.05,
                        yaw=-a + rng.uniform(-0.4, 0.4))
                a += rng.uniform(-0.12, 0.12)
                r += L * 0.85
    return p


def rubble_scatter(bpy):
    """The low rubble a crumbled piece leaves on the platform (under 0.6)."""
    p = HSP('Kit_RubbleScatter', seed=6201, ao=0.5, ao_dist=0.8, dust=0.3)
    rng = p.rng
    with p.as_kind(RAW):
        for k in range(46):
            a = rng.uniform(0, TAU)
            r = rng.uniform(0.0, 3.4) ** 1.1
            s = rng.uniform(0.18, 0.6) * (1.2 - r / 4.5)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.28), (s * 1.4, s * 1.1, s * 0.65),
                    p.vary((GRANITE, GRANITE_DARK, GRANITE_COOL, GRANITE_BED)[k % 4], 0.07), n=10, boxy=0.55,
                    jitter=0.22, yaw=rng.uniform(0, TAU), floor=0.0)
    with p.as_kind(PAINT):
        for k in range(8):
            a = rng.uniform(0, TAU)
            r = rng.uniform(0.0, 3.0)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, 0.04), (1.4, 1.0, 0.05), p.vary((0.36, 0.34, 0.33), 0.04),
                    n=16, boxy=1.0, jitter=0.05, yaw=rng.uniform(0, TAU))
    return p


# ================================================================ the Walking Slab
# Mythic's Walking Slab (the Slabwright's soul dragging its pillar across the
# Quarry, src/render/smith_heart_fx/council_slab_fx.ts): the column gains
# stone claws that grip its foot and drag it, a collar of root rock round its
# foot, and a face of cracks with the soul's jade light burning in them. The
# jade is fixed crystal (it carries its emitted colour: the Slabwright's soul
# is always jade, render/smith_heart_fx/council_fx_core.ts SOUL_COLORS).
JADE = (0.34, 0.9, 0.55)
JADE_HOT = (0.8, 1.0, 0.86)
JADE_DEEP = (0.12, 0.55, 0.32)


def _jade_glow(p, f, lines, width, hot=0.0):
    """The soul's jade burning in carved seams (fixed glow, sRGB)."""
    for on in lines:
        pts = [tuple(q) for q in f.snap(np.array(on, dtype=np.float64), lift=-0.05, steps=8)]
        for i, (q0, q1) in enumerate(zip(pts, pts[1:])):
            a = Vector(q0)
            b = Vector(q1)
            seg = b - a
            if seg.length < 1e-3:
                continue
            t = i / max(1, len(pts) - 2)
            col = mix(JADE, JADE_HOT, min(1.0, hot + 0.35 * math.sin(t * math.pi)))
            with p.as_kind(PAINT):
                crystal(p, tuple((a + b) / 2), (width, width, seg.length * 1.1), p.vary(col, 0.05), n=10,
                        boxy=0.4, jitter=0.12, yaw=math.atan2(seg.x, -seg.y),
                        pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z), mat=GLOW)


def slab_claw(bpy):
    """One stone claw of the Walking Slab: a root of the room's granite that
    grips the column's foot and reaches out to rake the floor. Three knuckled
    segments arch out and down from a root mass hugging the column's face to
    a hooked talon dug into the paving; a jade seam of the soul's light runs
    along its back. Origin where it grips the column at floor level (on the
    column's face), the claw reaching out along -Y; the runtime sets five
    round the foot and swings each about its origin as it pulls."""
    seed = 6301
    p = HSP('Kit_SlabClaw', seed=seed, ao=0.6, ao_dist=1.2, dust=0.0)
    rng = np.random.default_rng(seed)
    f = Sculpt((-1.5, -4.6, -0.9), (1.5, 1.2, 3.4), 0.055)
    n1 = Noise(seed + 3)
    spine = [(0.0, 0.5, 2.55), (0.0, -0.35, 2.45), (0.0, -1.45, 2.05), (0.0, -2.45, 1.35),
             (0.0, -3.25, 0.55), (0.0, -3.7, -0.3)]
    f.put('g2', Polyline(spine, [0.7, 0.68, 0.56, 0.45, 0.32, 0.14]), 0.25)
    # The knuckles: a broken block at every joint, turned its own way.
    for i, (c, s) in enumerate((((0.0, -0.4, 2.5), (1.35, 1.15, 1.05)), ((0.0, -1.5, 2.08), (1.1, 1.0, 0.95)),
                                ((0.0, -2.5, 1.38), (0.9, 0.85, 0.85)), ((0.0, -3.2, 0.62), (0.62, 0.6, 0.6)))):
        f.put(TONES[i], block(rng, c, s, cuts=14, chamfer=(0.6, 0.9),
                              R=rot(rx=float(rng.uniform(-0.35, 0.35)), rz=float(rng.uniform(-0.45, 0.45)))), 0.28)
    # The grip: a heavy root mass spread against the column's face, and
    # thinner roots creeping up it.
    f.put('g0', Ellipsoid((0.0, 0.45, 1.3), (1.05, 0.6, 1.7)), 0.45)
    for s in (-1, 1):
        f.put('g1', Polyline([(s * 0.45, 0.6, 2.2), (s * 0.85, 0.85, 3.0), (s * 1.0, 1.0, 3.3)], [0.32, 0.2, 0.08]),
              0.2)
    # The talon: a hooked point, dug in.
    f.put('g3', RoundCone((0.0, -3.35, 0.6), (0.0, -4.05, -0.7), 0.3, 0.035), 0.12)
    # Two lesser talons either side of it.
    for s in (-1, 1):
        f.put('g3', RoundCone((s * 0.3, -3.0, 0.7), (s * 0.75, -3.6, -0.55), 0.2, 0.03), 0.1)
    f.displace(lambda X, Y, Z: 0.07 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 3)
               + 0.04 * (n1.ridged(X * 2.2, Y * 2.2, Z * 2.2, 2) - 0.45), band=0.5)
    seam = _wander(rng, (0.0, 0.1, 3.2), (0.0, -3.1, 1.0), 12, 0.1)
    lines = _seams(p, f, [seam], width=0.12)
    _mesh(bpy, p, f, 'SlabClaw', 2000)
    _jade_glow(p, f, lines, 0.13, hot=0.2)
    return p


def slab_collar(bpy):
    """The root rock heaped round the Walking Slab's foot: a broken ring of
    fused boulders and roots of the granite gripping the column (its inner
    edge just inside the column's face, so it is never a floating ring),
    jade cracks of the soul's light running through it. Origin at the
    column's axis on the floor; the hole fits the carved column (radius
    2.3) and, scaled, the risen pillar."""
    seed = 6311
    p = HSP('Kit_SlabCollar', seed=seed, ao=0.6, ao_dist=1.4, dust=0.1)
    rng = np.random.default_rng(seed)
    f = Sculpt((-4.2, -4.2, -0.8), (4.2, 4.2, 2.4), 0.07)
    n1 = Noise(seed + 5)
    # One fused heap: a low ring of root rock, boulders broken out of it.
    f.put('g3', Torus((0.0, 0.0, 0.25), 2.7, 0.62, (0.0, 0.0, 1.0)), 0.5)
    k = 0
    for i in range(13):
        a = TAU * i / 13 + float(rng.uniform(-0.1, 0.1))
        r = float(rng.uniform(2.55, 2.95))
        s = float(rng.uniform(1.25, 1.75))
        h = float(rng.uniform(0.8, 1.35))
        c = (math.cos(a) * r, math.sin(a) * r, h * 0.32)
        f.put(TONES[k % len(TONES)], Ellipsoid(c, (s * 0.62, s * 0.52, h * 0.55), rot(rz=a)), 0.55)
        f.put(TONES[(k + 2) % len(TONES)], block(rng, c, (s, s * 0.8, h), cuts=12, chamfer=(0.6, 0.9),
                                                 R=rot(rz=a + float(rng.uniform(-0.4, 0.4)))), 0.5)
        k += 1
    # Roots climbing out of the heap over the plinth onto the shaft (radius
    # 1.5 above the plinth's 2.2), hugging it.
    for i in range(8):
        a = TAU * i / 8 + 0.3
        f.put('g1', Polyline([(math.cos(a) * 2.6, math.sin(a) * 2.6, 0.7),
                              (math.cos(a + 0.1) * 2.05, math.sin(a + 0.1) * 2.05, 1.35),
                              (math.cos(a + 0.2) * 1.62, math.sin(a + 0.2) * 1.62, float(rng.uniform(2.1, 2.8)))],
                             [0.42, 0.28, 0.08]), 0.25)
    # The column's own place (its plinth is the collar's inner wall).
    f.sub(RoundCone((0.0, 0.0, -1.0), (0.0, 0.0, 1.2), 1.95, 1.95), 0.15)
    f.displace(lambda X, Y, Z: 0.1 * n1.fbm(X * 0.6, Y * 0.6, Z * 0.6, 3)
               + 0.05 * (n1.ridged(X * 1.6, Y * 1.6, Z * 1.6, 2) - 0.45), band=0.6)
    _clamp(f, -_axes(f)[2] - 0.35)
    seams = []
    for i in range(6):
        a = TAU * i / 6 + float(rng.uniform(-0.2, 0.2))
        b = a + float(rng.uniform(0.4, 0.7))
        seams.append(_wander(rng, (math.cos(a) * 2.7, math.sin(a) * 2.7, 1.3),
                             (math.cos(b) * 3.3, math.sin(b) * 3.3, 0.5), 8, 0.12))
    lines = _seams(p, f, seams, width=0.13)
    _mesh(bpy, p, f, 'SlabCollar', 3200)
    _jade_glow(p, f, lines, 0.14)
    return p


def slab_face(bpy):
    """The Walking Slab's face: the column's front split into a face of
    cracks, the Slabwright's soul looking out of the stone it drags. A curved
    shield of the column's own granite (its radius, a little proud of it)
    with a heavy brow ledge over two deep eye sockets, a jagged mouth split
    under them, cracks running out across the stone; the jade burns in the
    eyes, the mouth and the cracks. Origin on the column's axis at the floor;
    the face looks along -Y from 4.6 to 8 yd up (a player's camera sees it
    over the raid's heads)."""
    seed = 6321
    p = HSP('Kit_SlabFace', seed=seed, ao=0.6, ao_dist=1.0, dust=0.0)
    rng = np.random.default_rng(seed)
    # The carved column's shaft (hammer_pieces.pit_column: octagonal drums of
    # radius 1.5); the runtime widens it round a risen pillar's rock.
    R = 1.5
    f = Sculpt((-2.4, -3.0, 4.0), (2.4, -0.4, 8.6), 0.045)
    n1 = Noise(seed + 7)
    # The shield: a slab of the stone curved round the column (a thick ring
    # segment, cut to a rough face outline).
    face_tones = ('g2', 'g0', 'g4', 'g2', 'g4', 'g0', 'g2')
    for i in range(7):
        a = math.radians(-48 + i * 16)
        c = (math.sin(a) * (R + 0.18), -math.cos(a) * (R + 0.18), 6.35 + float(rng.uniform(-0.12, 0.12)))
        f.put(face_tones[i], block(rng, c, (0.95, 0.5, 3.9 - abs(i - 3) * 0.4), cuts=12, chamfer=(0.55, 0.9),
                                   R=rot(rz=-a)), 0.4)
    # The brow: a heavy ledge across the face.
    f.put('g3', block(rng, (0.0, -(R + 0.55), 7.25), (2.6, 0.8, 0.6), cuts=14, chamfer=(0.55, 0.88),
                      R=rot(rx=-0.12)), 0.25)
    # The eye sockets, the mouth.
    for s in (-1, 1):
        f.sub(Ellipsoid((s * 0.62, -(R + 0.6), 6.75), (0.36, 0.45, 0.26), rot(rz=s * 0.25)), 0.1)
    f.sub(RoundBox((0.0, -(R + 0.6), 5.35), (0.72, 0.4, 0.12), 0.08), 0.08)
    f.displace(lambda X, Y, Z: 0.05 * n1.fbm(X * 1.1, Y * 1.1, Z * 1.1, 3)
               + 0.03 * (n1.ridged(X * 2.6, Y * 2.6, Z * 2.6, 2) - 0.45), band=0.4)
    # The cracks of the face: down from the eyes, across the cheeks, the
    # mouth's jag, up over the brow.
    y = -(R + 0.7)
    cracks = [
        _wander(rng, (-0.62, y, 6.5), (-1.2, y + 0.35, 4.6), 8, 0.08),
        _wander(rng, (0.62, y, 6.5), (1.3, y + 0.35, 4.5), 8, 0.08),
        [(-0.75, y, 5.4), (-0.35, y, 5.2), (0.0, y, 5.45), (0.35, y, 5.2), (0.75, y, 5.4)],
        _wander(rng, (0.0, y, 7.5), (0.3, y + 0.25, 8.4), 6, 0.1),
        _wander(rng, (-1.0, y + 0.3, 7.0), (-1.9, y + 1.1, 7.8), 6, 0.1),
    ]
    lines = _seams(p, f, cracks, width=0.12)
    _mesh(bpy, p, f, 'SlabFace', 2600)
    _jade_glow(p, f, lines, 0.12, hot=0.25)
    # The eyes: a cluster of jade crystal burning in each socket.
    for s in (-1, 1):
        for k in range(4):
            core = (s * 0.62 + float(rng.uniform(-0.12, 0.12)), -(R + 0.42), 6.75 + float(rng.uniform(-0.1, 0.1)))
            facet_crystal(p, core, (s * 0.2, -1.0, float(rng.uniform(-0.1, 0.25))), float(rng.uniform(0.3, 0.42)),
                          float(rng.uniform(0.1, 0.15)), p.vary(JADE_HOT if k == 0 else JADE, 0.05), sides=6,
                          twist=float(rng.uniform(0, TAU)))
    return p
