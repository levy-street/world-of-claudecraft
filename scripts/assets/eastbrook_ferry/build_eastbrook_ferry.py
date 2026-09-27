"""The Eastbrook ferry: a stylized three-masted passenger transport for World of ClaudeCraft.

  blender --background --python scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py -- \
      [--preview OUT_DIR] [--save FILE.blend] [--collision volumes.json]

Writes eastbrook_ferry_source.glb beside this file. `node scripts/assets/eastbrook_ferry/build.mjs`
ships it (validate, fingerprint, meshopt) to public/models/props/eastbrook_ferry.glb, and
src/render/transport_ship.ts draws it. The walkable collision is NOT in the model: it is the
sim's simple-volume hull layout (src/sim/content/transport_ships.ts), whose headline numbers
this file mirrors (DECK, CAPTAIN, FORECASTLE, RAIL, the beam stations, the gangways, the
masts) and stamps into the root's extras so a test can hold the two together.
`--collision` (a JSON dump of those volumes, see dump_collision.ts) adds them to the saved
.blend as wire boxes for review; they are never exported.

Frame: game yards, origin at the waterline centre, +x port, +y up, +z bow (shiplib.P maps it
to Blender). Hierarchy (the runtime depends on these names):

  TransportShip_ROOT                    root, the placed transform (waterline centre)
    Ship_Motion                         the idle bob / pitch / roll (clip "Idle")
      LOD0                              full model
        Hull Deck Railings Structures(RearCabin CaptainDeck Bow Stairs) Figurehead
        Masts(MainMast SecondaryMast MizzenMast) Sails(MainSail MainTopsail SecondarySail
        SecondaryTopsail MizzenSail JibSail) Rigging Props(Barrels Crates Rope Benches)
        Wheel Flags(Pennant_* Ensign_*)
      LOD1  LOD2  LOD3                  reduced, silhouette, far silhouette
    Gangplank                           the deployed plank (static, rests on the pier)
    Sockets                             gangway, wake, splash and helm attachment points
    AnimationControllers                documents the idle clip (extras)

Everything is original procedural work for this project: the hull, the sea-serpent
figurehead, the Eastbrook compass emblem, no third-party mesh, texture or reference.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from shiplib import (  # noqa: E402
    CLOTH, FLAT, GLOW, IRON, ROPE, WOOD, P, Piece, empty, lerp, make_materials, mix,
    scale_color, smooth, triangles,
)

# ---------------------------------------------------------------------------
# Dimensions: mirror src/sim/content/transport_ships.ts
# ---------------------------------------------------------------------------
DECK = 3.3
CAPTAIN = 6.3
FORECASTLE = 4.5
RAIL = 1.2
STATIONS = [(-15.5, 4.1), (-12, 4.75), (-7.5, 5.05), (-2.5, 5.15), (0.8, 5.15), (5, 5.0),
            (8.5, 4.6), (11, 3.95), (13, 3.0), (14.5, 1.9), (15.5, 0.7)]
GANGWAY = (-0.4, 2.0)
GANGWAY_Z = 0.8
STERN_Z = -15.5
STEM_Z = 15.5
QD_FRONT = -7.5
FC_BACK = 8.5
STAIR_X = 3.72  # quarterdeck stair centre, each side
STAIR_HW = 0.97
MASTS = {  # z, top of the pole, lower-mast foot radius
    'SecondaryMast': (11.2, 24.0, 0.5),
    'MainMast': (2.5, 28.0, 0.55),
    'MizzenMast': (-10.5, 21.0, 0.45),
}
PIER_DECK = 2.64  # the Eastbrook ferry pier deck above the waterline (the gangplank foot)
PIER_EDGE_X = 8.0  # the pier's T-head, ship frame
LENGTH, BEAM, DRAFT = 31.0, 10.3, 2.4


def half_beam(z):
    s = STATIONS
    if z <= s[0][0]:
        return s[0][1]
    for i in range(1, len(s)):
        if z <= s[i][0]:
            z0, w0 = s[i - 1]
            z1, w1 = s[i]
            return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    return s[-1][1]


def inner(z):
    """The bulwark's inner face (the sim's rails stop a body 0.07 short of it)."""
    return max(0.12, half_beam(z) - 0.42)


# ---------------------------------------------------------------------------
# Palette: the neutral Eastbrook vessel. Variants (rough, naval, pirate, ghost, desert,
# frost) swap this table; the geometry stays.
# ---------------------------------------------------------------------------
PAL = dict(
    hull=[(0.66, 0.45, 0.29), (0.62, 0.42, 0.27), (0.69, 0.47, 0.3), (0.64, 0.435, 0.28),
          (0.6, 0.405, 0.26)],
    bottom=(0.44, 0.37, 0.27),
    wale=(0.42, 0.28, 0.18),
    deck=[(0.7, 0.55, 0.39), (0.65, 0.51, 0.36), (0.74, 0.58, 0.41), (0.68, 0.53, 0.37),
          (0.62, 0.49, 0.35)],
    seam=(0.42, 0.3, 0.2),
    deck_edge=(0.56, 0.4, 0.27),
    trim=(0.76, 0.53, 0.34),
    trim_dark=(0.54, 0.37, 0.24),
    castle=[(0.7, 0.55, 0.41), (0.66, 0.52, 0.39), (0.73, 0.58, 0.43)],
    beam=(0.42, 0.28, 0.18),
    iron=(0.36, 0.36, 0.38),
    iron_hi=(0.52, 0.52, 0.54),
    sail=(0.95, 0.92, 0.82),
    sail_panel=(0.95, 0.92, 0.82),
    sail_edge=(0.87, 0.82, 0.7),
    sail_patch=(0.91, 0.87, 0.75),
    sail_band=(0.95, 0.92, 0.82),
    accent=(0.2, 0.36, 0.7),
    accent_hi=(0.23, 0.4, 0.74),
    cream=(0.95, 0.9, 0.76),
    ivory=(0.93, 0.88, 0.75),
    ivory_dark=(0.82, 0.75, 0.61),
    rope=(0.72, 0.6, 0.43),
    rope_dark=(0.56, 0.46, 0.32),
    glow=(1.0, 0.78, 0.46),
    dark=(0.12, 0.09, 0.07),
)


def plank(i, j=0, pal='hull'):
    tones = PAL[pal]
    return tones[(i * 3 + (j // 3) * 7 + (i * j) % 3) % len(tones)]


def accent(j=0):
    return PAL['accent'] if j % 7 else PAL['accent_hi']


# ---------------------------------------------------------------------------
# Hull shape
# ---------------------------------------------------------------------------
YMAX = 1.7  # the belly: the hull is widest here, below the deck
SHEER = 4.5  # the waist bulwark top amidships (castles build on it)


def hull_w(z):
    """The loft's half-beam: the sim table, closing onto the stem timber at the bow."""
    if z > 14.5:
        return lerp(1.9, 0.22, smooth((z - 14.5) / (STEM_Z - 14.5)))
    return half_beam(z)


def sheer(z):
    """The waist bulwark's top: level amidships, sweeping up into the bow and stern."""
    return SHEER + 1.1 * smooth((z - 8.0) / 7.5) ** 1.3 + 0.35 * smooth((-9.0 - z) / 6.5)


def keel_y(z):
    if z > 6.5:
        return lerp(-2.4, -0.3, ((z - 6.5) / (STEM_Z - 6.5)) ** 1.7)
    if z < -10.5:
        return lerp(-2.4, -1.5, ((-10.5 - z) / (-10.5 - STERN_Z)) ** 1.4)
    return -2.4


def half_breadth(z, y):
    W = hull_w(z)
    K = keel_y(z)
    keel_w = 0.16
    bow = smooth((z - 8.0) / 7.5)
    if y <= YMAX:
        v = max(0.0, min(1.0, (y - K) / (YMAX - K)))
        f = math.sin(v * math.pi / 2) ** lerp(0.62, 1.0, bow)
        return keel_w + (W * 1.05 - keel_w) * f
    if y <= DECK:
        t = (y - YMAX) / (DECK - YMAX)
        return W * lerp(1.05, 1.0, smooth(t))
    t = min(1.0, (y - DECK) / max(0.1, sheer(z) - DECK))
    return W * (1.0 - 0.03 * t)


def wall_x(z):
    """Castle and forecastle walls rise plumb from the sheer."""
    return hull_w(z) * 0.97


def station_z(z, y):
    """Bow rake (a curved clipper stem) and a gently raked transom."""
    if z > 11.0:
        w = smooth((z - 11.0) / (STEM_Z - 11.0))
        return z + (0.36 * y - 0.3) * w
    if z < -12.5:
        w = smooth((-12.5 - z) / (-12.5 - STERN_Z))
        return z - 0.1 * (y - 2.0) * w
    return z


def hull_stations(step=1.0):
    zs = set()
    z = STERN_Z
    while z <= STEM_Z + 1e-6:
        zs.add(round(z, 4))
        z += step
    for s, _ in STATIONS:
        zs.add(s)
    for g in GANGWAY:
        zs.add(g)
    zs.update((-3.2, -2.5, -1.9, 8.5, 14.8, 15.2))
    return sorted(zs)


# hull rows above the waterline; those above the deck scale with the local sheer
HULL_ROWS_FINE = [0.2, 0.75, 1.3, 1.72, 2.02, 2.5, 2.9, 3.3, 3.42, 3.66, 4.14, 4.34, 4.5]
HULL_ROWS_COARSE = [1.3, 2.5, 3.3, 4.5]


def row_y(z, y):
    if y <= DECK:
        return y
    return DECK + (y - DECK) * (sheer(z) - DECK) / (SHEER - DECK)


def hull_rows(z, fine=True):
    K = keel_y(z)
    low = [K + (0.2 - K) * f for f in ((0.0, 0.3, 0.62) if fine else (0.0, 0.5))]
    high = HULL_ROWS_FINE if fine else HULL_ROWS_COARSE
    return low + [row_y(z, y) for y in high]


def hull_color(y, i_row, j):
    if y < 0.2:
        return mix(PAL['bottom'], plank(i_row, j), 0.3)
    if 3.66 <= y < 4.14:
        return accent(j)
    if 3.42 <= y < 3.66 or 4.14 <= y < 4.34:
        return PAL['castle'][(i_row + j // 2) % 3]
    if 3.3 <= y < 3.42 or y >= 4.34:
        return PAL['trim']
    if 1.72 <= y < 2.02 or 2.9 <= y < 3.3:
        return PAL['wale']
    return plank(i_row, j)


# ---------------------------------------------------------------------------
# LOD0 pieces: hull, castles, transom
# ---------------------------------------------------------------------------

def build_hull(fine=True, name='Hull'):
    p = Piece(name, wear=0.03, gradient=0.14)
    zs = hull_stations(1.0 if fine else 3.0)
    ref_rows = [0.0] * (3 if fine else 2) + (HULL_ROWS_FINE if fine else HULL_ROWS_COARSE)
    nrows = len(ref_rows)
    for side in (1, -1):
        rows = []
        for k in range(nrows):
            row = []
            for z in zs:
                y = hull_rows(z, fine)[k]
                row.append((side * half_breadth(z, y), y, station_z(z, y)))
            rows.append(row)

        def color(i, j):
            y = ref_rows[i] if i >= (3 if fine else 2) else -1.0
            return hull_color(y, i, j)

        def skip(i, j):
            # the gangway openings through the waist bulwark
            if ref_rows[i] < DECK - 1e-6 or i < (3 if fine else 2):
                return False
            return zs[j] >= GANGWAY[0] - 1e-6 and zs[j + 1] <= GANGWAY[1] + 1e-6

        p.surface(rows, color, WOOD, outward=lambda c, s=side: (s, -0.25, 0.0), skip=skip)
    # keel closing the two sides along the bottom
    keel = [(0.0, keel_y(z) - 0.1, station_z(z, keel_y(z))) for z in zs if z < 15.0]
    p.beam(keel, 0.34, 0.26, PAL['beam'], WOOD, up=(0, 1, 0), caps=True)
    if fine:
        # wales: heavy dark strakes, the upper one sweeping up with the sheer toward the bow
        for y, h in ((1.87, 0.36), (3.1, 0.38)):
            pts = [(half_breadth(z, y) + 0.06, y, station_z(z, y)) for z in zs if -15.3 < z < 14.9]
            for side in (1, -1):
                sp = [(side * x, yy, zz) for x, yy, zz in pts]
                p.beam(sp, 0.2, h, PAL['wale'], WOOD, up=(0, 1, 0),
                       edge_color=scale_color(PAL['wale'], 1.35))
        # closed port lids between the wales
        for side in (1, -1):
            for z in (-10.2, -6.4, -3.0, 4.4, 7.6):
                x = side * (half_breadth(z, 2.45) + 0.05)
                p.box((x, 2.45, z), (0.1, 0.5, 0.66), PAL['trim_dark'], WOOD, bevel=0.03,
                      edge_color=PAL['trim'])
                for dy in (-0.14, 0.14):
                    p.box((x + side * 0.05, 2.45 + dy, z - 0.12), (0.05, 0.07, 0.5), PAL['iron'], IRON)
    return p


def castle_top(z):
    """The stern castle wall's top: the quarterdeck rail, rising a touch aft and
    scrolling down to the waist at its fore end."""
    if z <= -3.2:
        return CAPTAIN + RAIL + 0.4 * smooth((-11.5 - z) / 4.0)
    if z >= -1.9:
        return sheer(z)
    t = (z + 3.2) / 1.3
    return lerp(CAPTAIN + RAIL, sheer(z), smooth(t))


def fc_top(z):
    """The forecastle bulwark's top, sweeping up toward the stem head."""
    return FORECASTLE + RAIL + 1.5 * smooth((z - FC_BACK) / (STEM_Z - FC_BACK)) ** 1.4


def build_castles(p, fine=True):
    """Stern castle and forecastle walls (outer skin, inner lining, rail caps)."""
    zs_all = hull_stations(1.0 if fine else 3.0)
    # --- stern castle outer walls: planked, a trim molding at the deck line, a cobalt
    # frieze under the rail
    zs = [z for z in zs_all if z <= -1.9]
    ylev = [0.0, 0.16, 5.95, 6.2, 6.45, 6.78, 7.06, 7.3, 9.9]
    for side in (1, -1):
        rows = []
        for k, y in enumerate(ylev):
            row = []
            for z in zs:
                base = sheer(z)
                yy = base if k == 0 else (base + 0.16 if k == 1 else min(max(y, base + 0.16), castle_top(z)))
                if k == len(ylev) - 1:
                    yy = castle_top(z)
                row.append((side * wall_x(z), yy, station_z(z, yy)))
            rows.append(row)

        def color(i, j):
            if i in (0, 2, 3, 7):
                return PAL['trim']
            if i == 5:
                return accent(j)
            return PAL['castle'][(i + j // 2) % 3]

        p.surface(rows, color, WOOD, outward=lambda c, s=side: (s, 0, 0))
        # pilasters dividing the castle side into bays
        if fine:
            for z in (-14.2, -11.0, -7.8, -4.6):
                top = castle_top(z)
                p.box((side * (wall_x(z) + 0.06), (sheer(z) + top) / 2 + 0.05, z),
                      (0.14, top - sheer(z) - 0.1, 0.3), PAL['trim'], WOOD, bevel=0.03)
        # inner lining above the quarterdeck and down the stair section
        rows = []
        for f in (0.0, 1.0):
            row = []
            for z in zs:
                floor = CAPTAIN if z <= QD_FRONT else DECK
                row.append((side * inner(z), lerp(floor, castle_top(z), f), z))
            rows.append(row)
        p.surface(rows, lambda i, j: PAL['castle'][j % 3], WOOD, outward=lambda c, s=side: (-s, 0, 0))
        cap = [(side * (inner(z) + wall_x(z)) / 2, castle_top(z) + 0.08, station_z(z, castle_top(z)))
               for z in zs]
        p.beam(cap, wall_x(-8.0) - inner(-8.0) + 0.2, 0.16, PAL['trim'], WOOD,
               edge_color=scale_color(PAL['trim'], 1.2))
    # --- forecastle outer walls, lining and cap
    zs = [z for z in zs_all if z >= FC_BACK - 0.3]
    for side in (1, -1):
        rows = []
        for f in (0.0, 0.14, 0.44, 0.62, 0.84, 1.0):
            row = []
            for z in zs:
                y = lerp(sheer(z), fc_top(z), f)
                row.append((side * max(0.12, half_breadth(z, sheer(z))), y, station_z(z, y)))
            rows.append(row)
        p.surface(rows, lambda i, j: PAL['trim'] if i in (0, 4) else (
            accent(j) if i == 2 else PAL['castle'][(i + j // 2) % 3]), WOOD,
            outward=lambda c, s=side: (s, 0, 0.3))
        rows = []
        for f in (0.0, 1.0):
            row = []
            for z in zs:
                y = lerp(FORECASTLE, fc_top(z), f)
                row.append((side * inner(z), y, min(station_z(z, y) - 0.05, 15.0)))
            rows.append(row)
        p.surface(rows, lambda i, j: PAL['castle'][j % 3], WOOD, outward=lambda c, s=side: (-s, 0, -0.3))
        cap = [(side * (inner(z) + half_breadth(z, sheer(z))) / 2, fc_top(z) + 0.08,
                station_z(z, fc_top(z))) for z in zs if z <= 15.2]
        p.beam(cap, 0.44, 0.16, PAL['trim'], WOOD, edge_color=scale_color(PAL['trim'], 1.2))
    # --- waist bulwark inner lining and cap (the gangways stay open)
    zs = [z for z in zs_all if -2.5 <= z <= FC_BACK]
    for side in (1, -1):
        segs = [[z for z in zs if z <= GANGWAY[0] + 1e-6], [z for z in zs if z >= GANGWAY[1] - 1e-6]]
        for seg in segs:
            if len(seg) < 2:
                continue
            rows = [[(side * inner(z), y if y == DECK else sheer(z), z) for z in seg] for y in (DECK, SHEER)]
            p.surface(rows, lambda i, j: PAL['castle'][j % 3], WOOD, outward=lambda c, s=side: (-s, 0, 0))
            cap = [(side * (inner(z) + half_breadth(z, sheer(z))) / 2, sheer(z) + 0.08, z) for z in seg]
            p.beam(cap, 0.48, 0.16, PAL['trim'], WOOD, edge_color=scale_color(PAL['trim'], 1.2))
        # gangway: stout posts either side of the opening with carved caps
        for gz in GANGWAY:
            x = side * (inner(gz) + half_breadth(gz, SHEER)) / 2
            p.box((x, SHEER + 0.05, gz), (0.44, 1.7, 0.36), PAL['trim'], WOOD, bevel=0.05 if fine else 0,
                  edge_color=scale_color(PAL['trim'], 1.2))
            p.box((x, SHEER + 1.0, gz), (0.5, 0.2, 0.42), PAL['trim_dark'], WOOD)
            p.box((x, SHEER + 1.22, gz), (0.36, 0.26, 0.36), PAL['iron'], IRON, taper=0.45)
        # threshold: the deck runs out through the opening onto the side step
        xo = half_breadth(GANGWAY_Z, DECK)
        p.box((side * (inner(GANGWAY_Z) + xo + 0.6) / 2, DECK - 0.06, GANGWAY_Z),
              (xo - inner(GANGWAY_Z) + 0.6, 0.12, GANGWAY[1] - GANGWAY[0]), PAL['deck_edge'], WOOD)
        # the small side platform under the gangway, on two knees
        p.box((side * (xo + 0.35), DECK - 0.2, GANGWAY_Z), (0.7, 0.16, GANGWAY[1] - GANGWAY[0] + 0.1),
              PAL['beam'], WOOD)
        for dz in (-0.9, 0.9):
            p.box((side * (xo + 0.18), DECK - 0.7, GANGWAY_Z + dz), (0.36, 0.9, 0.16), PAL['beam'], WOOD,
                  taper=0.5)
    # stanchions along the linings (LOD0 only)
    if fine:
        for side in (1, -1):
            z = -14.4
            while z < 14.0:
                if GANGWAY[0] - 0.4 < z < GANGWAY[1] + 0.4:
                    z += 1.6
                    continue
                if z <= -1.9:
                    floor = CAPTAIN if z <= QD_FRONT else DECK
                    top = castle_top(z)
                elif z < FC_BACK:
                    floor, top = DECK, sheer(z)
                else:
                    floor, top = FORECASTLE, fc_top(z)
                if top - floor > 0.5:
                    h = top - floor
                    p.box((side * (inner(z) - 0.07), floor + h / 2, z), (0.16, h, 0.24),
                          PAL['trim_dark'], WOOD, bevel=0.03)
                z += 1.6


def build_quarter_galleries(p, fine=True):
    """Enclosed galleries bulging from each stern quarter, windows lit from the cabin."""
    z0, z1 = -15.1, -12.1
    zc = (z0 + z1) / 2
    y0, y1 = 4.55, 6.65
    for side in (1, -1):
        xw = wall_x(zc)
        out = 0.7
        x = side * (xw + out / 2)
        p.box((x, (y0 + y1) / 2, zc), (out, y1 - y0, z1 - z0), PAL['castle'][0], WOOD,
              bevel=0.05 if fine else 0, edge_color=PAL['trim'])
        # windows on the outer face
        for k in range(3):
            wz = z0 + 0.5 + k * 1.0
            p.box((x + side * (out / 2 + 0.02), 5.55, wz), (0.08, 0.95, 0.66), PAL['trim'], WOOD)
            p.box((x + side * (out / 2 + 0.06), 5.55, wz), (0.04, 0.72, 0.46), PAL['glow'], GLOW)
        # cobalt roof sloping into the castle, and a carved drop below
        p.box((side * (xw + out / 2 - 0.05), y1 + 0.18, zc), (out + 0.35, 0.3, z1 - z0 + 0.3), PAL['accent'],
              WOOD, taper=0.55, bevel=0.03 if fine else 0)
        p.box((x, y0 - 0.25, zc), (out * 0.8, 0.5, (z1 - z0) * 0.8), PAL['trim'], WOOD, taper=1.0)
        p.box((x, y0 - 0.75, zc), (out * 0.55, 0.5, (z1 - z0) * 0.4), PAL['trim_dark'], WOOD, taper=0.3)
        if fine:
            p.box((x + side * 0.02, y0 + 0.12, zc), (out + 0.08, 0.14, z1 - z0 + 0.1), PAL['trim'], WOOD)


def build_transom(p, fine=True):
    """The flat stern: planked face, the captain's cabin windows, the emblem, the rudder."""
    z = STERN_Z
    n = 8
    ylist = [keel_y(z) + 0.05, 0.2, 1.3, 2.4, DECK, 3.42, 3.66, 4.14, 4.34, sheer(z), 5.95, 6.45, 6.78, 7.06,
             7.3, castle_top(z)]
    rows = []
    for y in ylist:
        hb = half_breadth(z, y) if y <= sheer(z) + 1e-6 else wall_x(z)
        rows.append([(lerp(-hb, hb, k / n), y, station_z(z, y)) for k in range(n + 1)])
    crown = []
    hb = wall_x(z)
    top = castle_top(z)
    for k in range(n + 1):
        x = lerp(-hb, hb, k / n)
        y = top + 0.95 * math.cos((x / hb) * math.pi / 2) ** 0.8
        crown.append((x, y, station_z(z, y)))
    rows.append(crown)
    ylist = ylist + [top + 1.0]

    def color(i, j):
        y = ylist[i]
        if y < 0.2:
            return PAL['bottom']
        if 3.66 <= y < 4.14 or 6.78 <= y < 7.06:
            return accent(j)
        if 3.3 <= y < 3.42 or 5.95 <= y < 6.45 or y >= 7.3 or 4.34 <= y < 4.6:
            return PAL['trim']
        return PAL['castle'][(i + j) % 3]

    p.surface(rows, color, WOOD, outward=lambda c: (0, 0, -1))
    cap = [(x, y + 0.09, zz - 0.02) for x, y, zz in crown]
    p.beam(cap, 0.38, 0.2, PAL['trim'], WOOD, up=(0, 0, 1), edge_color=scale_color(PAL['trim'], 1.2))
    back = [[(x, CAPTAIN, zz + 0.3) for x, _, zz in crown], [(x, y, zz + 0.3) for x, y, zz in crown]]
    p.surface(back, lambda i, j: PAL['castle'][j % 3], WOOD, outward=lambda c: (0, 0, 1))
    # the captain's cabin windows: five warm panes across the stern, framed and hooded
    for k in range(5):
        x = (k - 2) * 1.32
        w, h = (0.92, 1.3) if k != 2 else (1.02, 1.45)
        zf = station_z(z, 4.95) - 0.06
        p.box((x, 4.95, zf), (w + 0.26, h + 0.26, 0.14), PAL['trim'], WOOD, bevel=0.04 if fine else 0)
        p.box((x, 4.95, zf - 0.06), (w, h, 0.08), PAL['glow'], GLOW)
        if fine:
            p.box((x, 4.95, zf - 0.11), (0.07, h, 0.05), PAL['trim_dark'], WOOD)
            p.box((x, 4.95 + h * 0.12, zf - 0.11), (w, 0.07, 0.05), PAL['trim_dark'], WOOD)
        p.box((x, 4.95 + h / 2 + 0.2, zf - 0.08), (w + 0.42, 0.14, 0.26), PAL['trim_dark'], WOOD,
              bevel=0.03 if fine else 0)
    # a gallery rail under the windows
    p.box((0, 4.1, station_z(z, 4.1) - 0.18), (2 * half_breadth(z, 4.1) - 0.3, 0.16, 0.36), PAL['trim'], WOOD,
          bevel=0.03 if fine else 0)
    emblem(p, (0, 7.2, station_z(z, 7.2) - 0.08), 0.62, normal=(0, 0, -1), fine=fine)
    # rudder hung on iron pintles
    p.box((0, 0.7, STERN_Z - 0.6), (0.36, 4.8, 1.1), PAL['beam'], WOOD, bevel=0.05 if fine else 0, taper=0.85)
    if fine:
        for y in (-0.8, 0.8, 2.4):
            p.box((0, y, STERN_Z - 0.32), (0.46, 0.16, 0.95), PAL['iron'], IRON)


def emblem(p, center, radius, normal=(0, 0, -1), fine=True, up=(0, 1, 0)):
    """The Eastbrook compass: a cobalt roundel ringed in cream, a cream eight-point
    star, a cobalt heart. Thin plates standing off `normal`."""
    c = Vector(center)
    n = Vector(normal).normalized()
    u = Vector(up).cross(n).normalized()
    v = n.cross(u).normalized()

    def pt(r, a, lift):
        return tuple(c + (u * math.cos(a) + v * math.sin(a)) * r + n * lift)

    seg = 18 if fine else 10
    for k in range(seg):
        a0 = math.tau * k / seg
        a1 = math.tau * (k + 1) / seg
        p.face([pt(radius * 0.86, a0, 0.02), pt(radius, a0, 0.02), pt(radius, a1, 0.02),
                pt(radius * 0.86, a1, 0.02)], PAL['cream'], WOOD, FLAT)
        p.face([pt(0, 0, 0.03), pt(radius * 0.86, a0, 0.03), pt(radius * 0.86, a1, 0.03)], PAL['accent'], WOOD,
               FLAT)
    star = []
    for k in range(16):
        a = math.pi / 2 + math.tau * k / 16
        r = radius * (0.74 if k % 4 == 0 else (0.5 if k % 2 == 0 else 0.2))
        star.append((r, a))
    for k in range(16):
        r0, a0 = star[k]
        r1, a1 = star[(k + 1) % 16]
        p.face([pt(0, 0, 0.045), pt(r0, a0, 0.045), pt(r1, a1, 0.045)], PAL['cream'], WOOD, FLAT)
    for k in range(8):
        a0 = math.tau * k / 8
        a1 = math.tau * (k + 1) / 8
        p.face([pt(0, 0, 0.06), pt(radius * 0.13, a0, 0.06), pt(radius * 0.13, a1, 0.06)], PAL['accent'], WOOD,
               FLAT)


# ---------------------------------------------------------------------------
# Decks, stairs, cabin front, railings
# ---------------------------------------------------------------------------

def deck_grid(p, z0, z1, y, planks, dz, width_fn=inner, z_edges=None, seam=0.022):
    zs = []
    z = z0
    while z < z1 - 1e-6:
        zs.append(z)
        z += dz
    zs.append(z1)
    if z_edges:
        zs = sorted(set(zs) | set(e for e in z_edges if z0 < e < z1))
    ts = []
    for c in range(planks):
        t0 = -1 + 2 * c / planks
        t1 = -1 + 2 * (c + 1) / planks
        ts.append(t0 + (seam if c else 0))
        ts.append(t1 - (seam if c < planks - 1 else 0))
    rows = [[(t * width_fn(z), y, z) for t in ts] for z in zs]

    def color(i, j):
        if j % 2 == 1:
            return PAL['seam']
        c = j // 2
        if c == 0 or c == planks - 1:
            return PAL['deck_edge']
        # butt joints: each plank changes tone every few yards, staggered by column
        seg = (i + c * 2) // 3
        return plank(c, seg * 5 + c, 'deck')

    return p.surface(rows, color, WOOD, outward=lambda c: (0, 1, 0), soft=False)


def build_decks(fine=True):
    p = Piece('Deck', wear=0.06, gradient=0.0)
    planks = 18 if fine else 6
    dz = 1.0 if fine else 4.0
    seam = 0.022 if fine else 0.0
    deck_grid(p, QD_FRONT, FC_BACK, DECK, planks, dz, z_edges=list(GANGWAY), seam=seam)
    deck_grid(p, STERN_Z + 0.28, QD_FRONT, CAPTAIN, planks, dz, seam=seam)
    deck_grid(p, FC_BACK, 14.9, FORECASTLE, max(4, planks - 4), dz,
              width_fn=lambda z: max(0.1, inner(z) - (0.12 if z > 13 else 0)), seam=seam)
    # the raised decks' leading edges: a trim fascia with a molding
    for z, y1 in ((QD_FRONT, CAPTAIN), (FC_BACK, FORECASTLE)):
        w = inner(z)
        dzs = 0.1 if z == QD_FRONT else -0.1
        p.box((0, y1 - 0.09, z + dzs), (2 * w, 0.2, 0.3), PAL['trim'], WOOD, bevel=0.04 if fine else 0,
              edge_color=scale_color(PAL['trim'], 1.2))
    if fine:
        # the main hatch: a raised coaming with an iron-banded grating
        p.box((0, DECK + 0.1, -1.0), (2.2, 0.22, 2.2), PAL['trim'], WOOD, bevel=0.05,
              edge_color=scale_color(PAL['trim'], 1.2))
        for k in range(5):
            p.box((-0.8 + k * 0.4, DECK + 0.215, -1.0), (0.2, 0.02, 1.9), PAL['dark'], WOOD)
        for dz2 in (-0.55, 0.55):
            p.box((0, DECK + 0.225, -1.0 + dz2), (1.95, 0.02, 0.08), PAL['iron'], IRON)
    return p


def build_cabin_front(p, fine=True):
    """The quarterdeck face between the stairs: the stern cabin's door and windows."""
    z = QD_FRONT
    x0 = STAIR_X - STAIR_HW - 0.05
    cols = 6
    for k in range(cols):
        xa = lerp(-x0, x0, k / cols)
        xb = lerp(-x0, x0, (k + 1) / cols)
        col = PAL['accent'] if k in (0, 5) else PAL['castle'][k % 3]
        p.face([(xa, DECK, z), (xb, DECK, z), (xb, CAPTAIN - 0.18, z), (xa, CAPTAIN - 0.18, z)], col, WOOD)
    for x in (-x0, -1.05, 1.05, x0):
        p.box((x, (DECK + CAPTAIN) / 2, z + 0.08), (0.3, CAPTAIN - DECK, 0.2), PAL['trim'], WOOD,
              bevel=0.04 if fine else 0)
    # door: 3 yd tall, 1.5 wide, iron strapped, under a carved hood
    p.box((0, DECK + 1.45, z + 0.06), (1.5, 2.9, 0.12), PAL['beam'], WOOD, bevel=0.03 if fine else 0)
    if fine:
        for k in range(4):
            p.box((-0.56 + k * 0.375, DECK + 1.45, z + 0.125), (0.04, 2.8, 0.02), PAL['dark'], WOOD)
    for y in (DECK + 0.5, DECK + 1.5, DECK + 2.5):
        p.box((0, y, z + 0.14), (1.42, 0.13, 0.05), PAL['iron'], IRON)
    p.box((0.52, DECK + 1.45, z + 0.17), (0.11, 0.11, 0.09), PAL['iron_hi'], IRON)
    p.box((0, DECK + 3.02, z + 0.14), (1.95, 0.2, 0.34), PAL['trim'], WOOD, bevel=0.04 if fine else 0)
    for x in (-1.85, 1.85):
        p.box((x, DECK + 1.75, z + 0.08), (0.8, 1.0, 0.1), PAL['trim'], WOOD, bevel=0.03 if fine else 0)
        p.box((x, DECK + 1.75, z + 0.13), (0.58, 0.76, 0.04), PAL['glow'], GLOW)
        if fine:
            p.box((x, DECK + 1.75, z + 0.155), (0.05, 0.76, 0.02), PAL['trim_dark'], WOOD)
    lantern(p, (0, DECK + 3.55, z + 0.35), 0.3, fine=fine)


def lantern(p, center, s, fine=True):
    x, y, z = center
    p.box((x, y, z), (s * 1.1, s * 1.35, s * 1.1), PAL['iron'], IRON, bevel=0.02 if fine else 0)
    p.box((x, y, z), (s * 0.8, s * 1.1, s * 1.18), PAL['glow'], GLOW)
    p.box((x, y, z), (s * 1.18, s * 1.1, s * 0.8), PAL['glow'], GLOW)
    p.box((x, y + s * 0.82, z), (s * 0.75, s * 0.32, s * 0.75), PAL['iron'], IRON, taper=0.4)


def build_stairs(fine=True):
    p = Piece('Stairs', wear=0.05, gradient=0.1)
    for side in (1, -1):
        x = side * STAIR_X
        for k in range(1, 11):
            top = DECK + 0.3 * k
            z1 = -2.5 - 0.5 * (k - 1)
            z0 = z1 - 0.5
            p.box((x, (DECK + top) / 2 - 0.05, (z0 + z1) / 2), (STAIR_HW * 2, top - DECK - 0.1, 0.5),
                  PAL['castle'][k % 3], WOOD)
            p.box((x, top - 0.05, (z0 + z1) / 2 + 0.03), (STAIR_HW * 2 + 0.04, 0.1, 0.56), PAL['trim'], WOOD,
                  bevel=0.025 if fine else 0, edge_color=scale_color(PAL['trim'], 1.25))
        xi = side * (STAIR_X - STAIR_HW - 0.1)
        p.beam([(xi, DECK + 0.25, -2.35), (xi, CAPTAIN + 0.25, -7.55)], 0.2, 0.5, PAL['trim_dark'], WOOD)
        for pz, py in ((-2.6, DECK + 0.3), (-4.9, DECK + 1.68), (-7.4, CAPTAIN)):
            p.box((xi, py + 0.62, pz), (0.22, 1.24, 0.22), PAL['trim'], WOOD, bevel=0.03 if fine else 0)
            if fine:
                p.box((xi, py + 1.3, pz), (0.3, 0.16, 0.3), PAL['trim_dark'], WOOD, taper=0.6)
        p.beam([(xi, DECK + 1.5, -2.6), (xi, CAPTAIN + 1.2, -7.4)], 0.17, 0.13, PAL['trim'], WOOD,
               edge_color=scale_color(PAL['trim'], 1.2))
        if fine:
            for f in (0.2, 0.4, 0.6, 0.8):
                pz = lerp(-2.6, -7.4, f)
                py = lerp(DECK + 0.3, CAPTAIN, f)
                p.box((xi, py + 0.6, pz), (0.1, 1.2, 0.1), PAL['trim_dark'], WOOD)
    for k in range(1, 4):
        top = DECK + 0.3 * k
        z0 = 7.15 + 0.45 * (k - 1)
        p.box((0, (DECK + top) / 2 - 0.05, z0 + 0.225), (3.2, top - DECK - 0.1, 0.45), PAL['castle'][k % 3], WOOD)
        p.box((0, top - 0.05, z0 + 0.2), (3.24, 0.1, 0.5), PAL['trim'], WOOD, bevel=0.025 if fine else 0,
              edge_color=scale_color(PAL['trim'], 1.25))
    return p


def balustrade(p, a, b, floor, n_posts, fine=True):
    ax, az = a
    bx, bz = b
    for k in range(n_posts):
        t = k / (n_posts - 1)
        x, z = lerp(ax, bx, t), lerp(az, bz, t)
        big = k in (0, n_posts - 1)
        if fine or big:
            s = 0.28 if big else 0.14
            p.box((x, floor + 0.56, z), (s, 1.12, s), PAL['trim'] if big else PAL['trim_dark'], WOOD,
                  bevel=0.03 if fine else 0)
            if big and fine:
                p.box((x, floor + 1.32, z), (0.32, 0.22, 0.32), PAL['trim_dark'], WOOD, bevel=0.03, taper=0.6)
            elif fine:
                p.box((x, floor + 0.56, z), (0.2, 0.3, 0.2), PAL['trim'], WOOD, taper=0.7)
    p.beam([(ax, floor + 1.14, az), (bx, floor + 1.14, bz)], 0.28, 0.14, PAL['trim'], WOOD,
           edge_color=scale_color(PAL['trim'], 1.2))
    if fine:
        p.beam([(ax, floor + 0.22, az), (bx, floor + 0.22, bz)], 0.18, 0.1, PAL['trim_dark'], WOOD)


def build_railings(fine=True):
    p = Piece('Railings', wear=0.05, gradient=0.1)
    balustrade(p, (-2.62, QD_FRONT - 0.12), (2.62, QD_FRONT - 0.12), CAPTAIN, 9, fine)
    for side in (1, -1):
        balustrade(p, (side * 1.75, FC_BACK + 0.12), (side * (inner(FC_BACK) - 0.05), FC_BACK + 0.12),
                   FORECASTLE, 6, fine)
    if fine:
        # belaying pin rails inside the waist bulwark, rope coils hung on the pins
        for side in (1, -1):
            for z in (6.2, -1.8):
                x = side * (inner(z) - 0.12)
                p.box((x, DECK + 0.95, z), (0.22, 0.16, 1.6), PAL['trim'], WOOD, bevel=0.03)
                for k in range(4):
                    zz = z - 0.6 + k * 0.4
                    p.cylinder((x, DECK + 0.74, zz), (x, DECK + 1.22, zz), 0.035, PAL['trim_dark'], WOOD, sides=4)
                p.ring((x - side * 0.02, DECK + 0.72, z - 0.2), 0.26, 0.06, PAL['rope'], segments=10,
                       axis=(1, 0, 0), mat=ROPE)
    return p


# ---------------------------------------------------------------------------
# Masts, yards, sails, rigging
# ---------------------------------------------------------------------------
BRACE = 0.66  # the yards are braced round: the sails show their faces from the shore
MAST_PARTS = {
    'MainMast': dict(foot=DECK, head=17.8, top=15.8, topmast=26.0, yard1=(14.6, 6.3), yard2=(22.2, 4.7)),
    'SecondaryMast': dict(foot=FORECASTLE, head=15.9, top=14.1, topmast=22.6, yard1=(13.2, 5.5),
                          yard2=(20.0, 4.0)),
    'MizzenMast': dict(foot=CAPTAIN, head=16.0, top=14.4, topmast=19.8, yard1=(14.1, 4.5), yard2=None),
}
SAILS = {
    # name: mast, head y, foot y, head half width, foot half width, belly depth
    'MainSail': ('MainMast', 14.4, 8.9, 5.9, 6.5, 1.55),
    'MainTopsail': ('MainMast', 22.0, 15.2, 4.4, 5.7, 1.2),
    'SecondarySail': ('SecondaryMast', 13.0, 8.4, 5.1, 5.6, 1.4),
    'SecondaryTopsail': ('SecondaryMast', 19.8, 13.7, 3.7, 4.9, 1.1),
    'MizzenSail': ('MizzenMast', 13.9, 10.4, 4.2, 4.6, 1.15),
}


def brace_matrix(mast_z, angle=BRACE):
    """Blender-frame yaw about the mast's axis (game yaw = Blender Z)."""
    c = P(0, 0, mast_z)
    return Matrix.Translation(c) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation(-c)


def braced(pt, mast_z, angle=BRACE):
    x, y, z = pt
    dz = z - mast_z
    c, s = math.cos(angle), math.sin(angle)
    return (x * c + dz * s, y, mast_z - x * s + dz * c)


def build_mast(name, fine=True):
    z, pole, r = MASTS[name]
    d = MAST_PARTS[name]
    p = Piece(name, wear=0.05, gradient=0.08)
    sides = 10 if fine else 6
    p.cylinder((0, d['foot'] - 0.2, z), (0, d['head'], z), r, PAL['trim'], WOOD, sides=sides, r1=r * 0.78)
    p.cylinder((0, d['foot'] - 0.05, z), (0, d['foot'] + 0.32, z), r + 0.14, PAL['trim_dark'], WOOD, sides=sides)
    if fine:
        y = d['foot'] + 1.4
        while y < d['head'] - 0.8:
            rr = r - (r * 0.22) * (y - d['foot']) / (d['head'] - d['foot'])
            p.cylinder((0, y, z), (0, y + 0.22, z), rr + 0.05, PAL['iron'], IRON, sides=sides)
            y += 2.1
    ty = d['top']
    p.box((0, ty, z - 0.15), (2.5, 0.22, 2.0), PAL['trim'], WOOD, bevel=0.05 if fine else 0,
          edge_color=scale_color(PAL['trim'], 1.2))
    if fine:
        p.box((0, ty - 0.26, z - 0.15), (2.1, 0.3, 0.3), PAL['beam'], WOOD)
        p.box((0, ty - 0.26, z - 0.15), (0.3, 0.3, 1.7), PAL['beam'], WOOD)
        for x in (-1.1, 1.1):
            p.box((x, ty + 0.42, z - 0.15), (0.12, 0.62, 1.9), PAL['trim_dark'], WOOD)
        p.box((0, ty + 0.42, z - 1.1), (2.3, 0.62, 0.12), PAL['trim_dark'], WOOD)
    p.box((0, d['head'], z), (0.84, 0.38, 1.15), PAL['beam'], WOOD, bevel=0.04 if fine else 0)
    p.cylinder((0, d['head'] - 2.2, z - 0.05), (0, d['topmast'], z - 0.05), r * 0.6, PAL['trim'], WOOD,
               sides=8 if fine else 5, r1=r * 0.42)
    p.cylinder((0, d['topmast'], z - 0.05), (0, pole, z - 0.05), r * 0.36, PAL['trim'], WOOD,
               sides=6 if fine else 4, r1=r * 0.22)
    p.box((0, pole + 0.12, z - 0.05), (0.3, 0.24, 0.3), PAL['iron'], IRON)
    m = p.mark()
    for yard in (d['yard1'], d['yard2']):
        if not yard:
            continue
        yy, half = yard
        pts = [(-half, yy, z + 0.35), (-half * 0.5, yy, z + 0.35), (0, yy, z + 0.35), (half * 0.5, yy, z + 0.35),
               (half, yy, z + 0.35)]
        p.sweep(pts, 0, 0, PAL['trim'], sides=8 if fine else 5, radii=[0.1, 0.2, 0.25, 0.2, 0.1])
        if fine:
            for x in (-half * 0.62, half * 0.62):
                p.cylinder((x - 0.1, yy, z + 0.35), (x + 0.1, yy, z + 0.35), 0.21, PAL['iron'], IRON, sides=8)
            p.box((0, yy, z + 0.2), (0.44, 0.44, 0.36), PAL['beam'], WOOD)
    p.turn(m, brace_matrix(z))
    return p


def sail_point(spec, u, v, zbase):
    """A point of a square sail in its UNBRACED pose (yard athwartships)."""
    mast, head, foot, hh, fh, depth = spec
    half = lerp(hh, fh, v)
    x = lerp(-half, half, u)
    y = lerp(head, foot + 0.45 * math.sin(math.pi * u), v)
    belly = math.sin(math.pi * v * 0.9) * (1 - 0.12 * v) * math.sin(math.pi * u) ** 0.8
    edge_pull = 0.18 * v * (1 - math.sin(math.pi * u))
    return (x, y, zbase + 0.5 + depth * belly - edge_pull)


def build_sail(name, fine=True, emblem_on=False, band=False):
    spec = SAILS[name]
    z = MASTS[spec[0]][0]
    p = Piece(name, wear=0.0, gradient=0.0, facing=False)
    nu, nv = (10, 7) if fine else (4, 3)
    rows = [[sail_point(spec, i / nu, j / nv, z) for i in range(nu + 1)] for j in range(nv + 1)]
    patches = {(2, 5), (7, 2)} if fine else set()

    def color(j, i):
        if j == 0 or i == 0 or i == nu - 1:
            return PAL['sail_edge']
        if band and j == nv - 1:
            return PAL['accent']
        if j == nv - 1:
            return PAL['sail_edge']
        if (i, j) in patches:
            return PAL['sail_patch']
        if j == 2 and fine:
            return PAL['sail_band']
        return PAL['sail'] if i % 2 else PAL['sail_panel']

    p.surface(rows, color, CLOTH, outward=lambda c: (0, 0, 1))
    if fine:
        # bolt ropes, drawn in the cloth material so a sail stays one draw
        foot = [sail_point(spec, i / nu, 1.0, z) for i in range(nu + 1)]
        p.sweep(foot, 0.05, 0.05, PAL['rope'], sides=4, mat=CLOTH)
        for u in (0.0, 1.0):
            leech = [sail_point(spec, u, j / nv, z) for j in range(nv + 1)]
            p.sweep(leech, 0.045, 0.045, PAL['rope'], sides=4, mat=CLOTH)
    if emblem_on:
        for face_sign in (1, -1):
            sail_emblem(p, spec, z, face_sign, fine)
    return p, (0.0, spec[1], z)


def sail_emblem(p, spec, zbase, sign, fine, radius=1.75):
    mast, head, foot, hh, fh, depth = spec
    height = head - foot
    cu, cv = 0.5, 0.47
    seg = 22 if fine else 10

    def at(dx, dy, lift):
        v = cv - dy / height
        half = lerp(hh, fh, v)
        u = cu + dx / (2 * half)
        a = Vector(sail_point(spec, u, v, zbase))
        b = Vector(sail_point(spec, u + 0.01, v, zbase))
        c = Vector(sail_point(spec, u, v + 0.01, zbase))
        n = (b - a).cross(c - a).normalized()
        if n.z < 0:
            n = -n
        return tuple(a + n * lift * sign)

    def disc(r0, r1, col, lift):
        for k in range(seg):
            a0 = math.tau * k / seg
            a1 = math.tau * (k + 1) / seg
            pts = [at(r0 * math.cos(a0), r0 * math.sin(a0), lift), at(r1 * math.cos(a0), r1 * math.sin(a0), lift),
                   at(r1 * math.cos(a1), r1 * math.sin(a1), lift)]
            if r0 > 0:
                pts.append(at(r0 * math.cos(a1), r0 * math.sin(a1), lift))
            p.face(pts if sign > 0 else list(reversed(pts)), col, CLOTH, FLAT)

    disc(0.0, radius, PAL['accent'], 0.035)
    disc(radius * 0.84, radius * 0.93, PAL['cream'], 0.05)
    star = []
    for k in range(16):
        a = math.pi / 2 + math.tau * k / 16
        r = radius * (0.74 if k % 4 == 0 else (0.48 if k % 2 == 0 else 0.19))
        star.append((r * math.cos(a), r * math.sin(a)))
    for k in range(16):
        x0, y0 = star[k]
        x1, y1 = star[(k + 1) % 16]
        pts = [at(0, 0, 0.06), at(x0, y0, 0.06), at(x1, y1, 0.06)]
        p.face(pts if sign > 0 else list(reversed(pts)), PAL['cream'], CLOTH, FLAT)
    disc(0.0, radius * 0.12, PAL['accent'], 0.075)


JIB_HEAD = (0.0, 21.4, 11.55)
JIB_TACK = (0.0, 8.95, 22.6)
JIB_CLEW = (0.0, 8.4, 16.9)


def build_jib(fine=True):
    p = Piece('JibSail', wear=0.0, gradient=0.08, facing=False)
    head, tack, clew = Vector(JIB_HEAD), Vector(JIB_TACK), Vector(JIB_CLEW)
    n = 6 if fine else 2
    rows = []
    for j in range(n + 1):
        t = j / n
        a = head.lerp(tack, t)
        b = head.lerp(clew, t)
        row = []
        for i in range(n + 1):
            s = i / n
            q = a.lerp(b, s)
            bulge = math.sin(math.pi * s) * math.sin(math.pi * min(1.0, t * 1.1)) * 0.75
            row.append((q.x + bulge, q.y, q.z))
        rows.append(row)
    p.surface(rows, lambda j, i: PAL['sail_edge'] if j == n - 1 or i == n - 1 else
              (PAL['sail'] if i % 2 else PAL['sail_panel']), CLOTH, outward=lambda c: (1, 0, 0))
    return p, tuple(head)


BOWSPRIT_HEEL = (0, FORECASTLE + 0.55, 12.9)
BOWSPRIT_TIP = (0, 9.1, 23.4)


def build_bowsprit(p, fine=True):
    p.sweep([BOWSPRIT_HEEL, BOWSPRIT_TIP], 0.38, 0.2, PAL['trim'], sides=8 if fine else 5)
    p.box((0, FORECASTLE + 0.6, 13.1), (1.3, 1.2, 0.46), PAL['beam'], WOOD, bevel=0.05 if fine else 0)
    if fine:
        for t in (0.45, 0.72, 0.96):
            q = Vector(BOWSPRIT_HEEL).lerp(Vector(BOWSPRIT_TIP), t)
            d = (Vector(BOWSPRIT_TIP) - Vector(BOWSPRIT_HEEL)).normalized()
            p.cylinder(q - d * 0.12, q + d * 0.12, 0.33 - 0.12 * t, PAL['iron'], IRON, sides=8)


def rope_line(p, a, b, r=0.045, sag=0.0, segs=1, color=None):
    a, b = Vector(a), Vector(b)
    pts = []
    for k in range(segs + 1):
        t = k / segs
        q = a.lerp(b, t)
        q.y -= sag * 4 * t * (1 - t)
        pts.append(tuple(q))
    p.sweep(pts, r, r, color or PAL['rope'], sides=4, mat=ROPE, caps=False)


def build_rigging(fine=True):
    p = Piece('Rigging', wear=0.03, gradient=0.0)
    chan = {
        # channel height, shroud offsets along z (kept clear of the gangway)
        'MainMast': (SHEER - 0.25, [0.35, 1.2, 2.05, 2.9]),
        'SecondaryMast': (None, [-0.9, 0.0, 0.9]),
        'MizzenMast': (CAPTAIN + RAIL - 0.3, [-1.1, -0.2, 0.7]),
    }
    for name, (cy, offsets) in chan.items():
        z, pole, _ = MASTS[name]
        d = MAST_PARTS[name]
        if cy is None:
            cy = fc_top(z) - 0.3
        for side in (1, -1):
            hb = wall_x(z) if name != 'MainMast' else half_breadth(z, sheer(z))
            xo = side * (hb + 0.45)
            p.box((side * (hb + 0.22), cy, z + (offsets[0] + offsets[-1]) / 2),
                  (0.52, 0.15, offsets[-1] - offsets[0] + 0.8), PAL['trim_dark'], WOOD)
            for off in offsets:
                p.cylinder((xo, cy + 0.1, z + off), (xo, cy + 0.52, z + off), 0.14, PAL['beam'], WOOD, sides=6)
                p.box((xo, cy - 0.35, z + off), (0.1, 0.7, 0.1), PAL['iron'], IRON)
                rope_line(p, (xo, cy + 0.52, z + off), (side * 0.34, d['top'] - 0.12, z - 0.1), 0.05)
            if fine:
                n = 7 if name == 'MainMast' else 5
                for k in range(1, n + 1):
                    t = k / (n + 1.5)
                    rung = []
                    for off in offsets:
                        a = Vector((xo, cy + 0.52, z + off))
                        b = Vector((side * 0.34, d['top'] - 0.12, z - 0.1))
                        rung.append(tuple(a.lerp(b, t)))
                    p.sweep(rung, 0.03, 0.03, PAL['rope_dark'], sides=3, mat=ROPE, caps=False)
            rope_line(p, (side * 1.1, d['top'] + 0.1, z - 0.2), (side * 0.2, d['topmast'] - 0.3, z - 0.05), 0.04)
            # topmast backstay, aft of the channels and clear of the gangway
            back_z = {'MainMast': -3.6, 'SecondaryMast': z - 2.3, 'MizzenMast': z - 2.4}[name]
            back_y = castle_top(back_z) - 0.2 if back_z <= -1.9 else (fc_top(back_z) - 0.2 if back_z >= FC_BACK
                                                                      else sheer(back_z))
            rope_line(p, (side * (wall_x(back_z) + 0.2), back_y, back_z),
                      (side * 0.18, d['topmast'] - 0.1, z - 0.05), 0.04)
            for yard in (d['yard1'], d['yard2']):
                if yard:
                    yy, half = yard
                    tip = braced((side * (half - 0.25), yy, z + 0.35), z)
                    top = d['head'] + 0.2 if yy < d['head'] else d['topmast'] - 0.2
                    rope_line(p, tip, (0, top, z), 0.03)
    F, M, Z = MAST_PARTS['SecondaryMast'], MAST_PARTS['MainMast'], MAST_PARTS['MizzenMast']
    fz, mz, zz = MASTS['SecondaryMast'][0], MASTS['MainMast'][0], MASTS['MizzenMast'][0]
    bs = lambda t: tuple(Vector(BOWSPRIT_HEEL).lerp(Vector(BOWSPRIT_TIP), t))  # noqa: E731
    rope_line(p, (0, F['head'] - 0.2, fz + 0.2), bs(0.62), 0.065)
    rope_line(p, (0, F['topmast'] - 0.3, fz), bs(0.98), 0.05)
    rope_line(p, (0, M['head'] - 0.2, mz + 0.2), (0, F['top'] + 0.3, fz - 0.4), 0.065)
    rope_line(p, (0, M['topmast'] - 0.3, mz), (0, F['topmast'] - 1.2, fz - 0.2), 0.045)
    rope_line(p, (0, Z['head'] - 0.2, zz + 0.2), (0, M['top'] - 3.4, mz - 0.5), 0.045)
    rope_line(p, bs(0.98), (0, 1.0, station_z(STEM_Z, 1.0) + 0.1), 0.055)  # bobstay
    # course sheets from the clews down outside the rail, well aft of the gangway
    for name, target_z in (('MainSail', -4.2), ('SecondarySail', 6.6)):
        spec = SAILS[name]
        z = MASTS[spec[0]][0]
        for side, u in ((1, 1.0), (-1, 0.0)):
            clew = braced(sail_point(spec, u, 1.0, z), z)
            ty = castle_top(target_z) if target_z <= -1.9 else sheer(target_z)
            rail = (side * (wall_x(target_z) + 0.12), ty + 0.1, target_z)
            rope_line(p, clew, rail, 0.035)
    return p


# ---------------------------------------------------------------------------
# Bow: stem, trailboards, iron straps, cat-heads and anchors; the figurehead
# ---------------------------------------------------------------------------
def build_bow(fine=True):
    p = Piece('Bow', wear=0.05, gradient=0.1)
    stem = [(0, y, station_z(STEM_Z, y) + 0.06) for y in (-0.4, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.3)]
    p.beam(stem, 0.46, 0.46, PAL['beam'], WOOD, up=(1, 0, 0))
    p.beam([(x, y, z + 0.22) for x, y, z in stem[:6]], 0.22, 0.14, PAL['iron'], IRON, up=(1, 0, 0))
    # stem-head scroll: a carved volute where the stem meets the forecastle rail
    scroll = []
    for k in range(9):
        a = math.pi * 0.2 + k * math.pi * 0.2
        r = 0.55 - k * 0.04
        scroll.append((0.0, 7.35 + math.sin(a) * r, station_z(STEM_Z, 7.3) - 0.35 + math.cos(a) * r))
    p.sweep(scroll, 0.2, 0.08, PAL['trim'], sides=6, up=(1, 0, 0))
    for side in (1, -1):
        # cobalt trailboards sweeping aft from the figurehead, cream-edged
        pts = []
        for z in (15.3, 14.6, 13.6, 12.4, 11.2):
            y = 3.05 + 0.4 * (15.3 - z) / 4.1
            pts.append((side * (half_breadth(z, y) + 0.07), y, station_z(z, y)))
        p.beam(pts, 0.13, 0.62, PAL['accent'], WOOD, up=(0, 1, 0), edge_color=PAL['cream'])
        if fine:
            for z in (11.6, 12.7, 13.7):
                strap = [(side * (half_breadth(z, y) + 0.045), y, station_z(z, y))
                         for y in (0.25, 1.1, 2.0, 2.9, 3.8, row_y(z, 4.45))]
                p.beam(strap, 0.34, 0.08, PAL['iron'], IRON, up=(side, 0, 0),
                       edge_color=PAL['iron_hi'])
                for x, y, zz in strap[1:-1]:
                    p.box((x + side * 0.06, y, zz), (0.08, 0.1, 0.1), PAL['iron_hi'], IRON)
            for z in (-13.9, -14.95):
                strap = [(side * (half_breadth(z, y) + 0.045), y, station_z(z, y))
                         for y in (0.25, 1.1, 2.0, 2.9, 3.8, 4.6)]
                p.beam(strap, 0.34, 0.08, PAL['iron'], IRON, up=(side, 0, 0), edge_color=PAL['iron_hi'])
    for side in (1, -1):
        z = 12.6
        x = side * wall_x(z)
        y = fc_top(z) - 0.35
        p.box((x + side * 0.38, y, z), (1.15, 0.36, 0.36), PAL['beam'], WOOD, bevel=0.04 if fine else 0)
        ax = x + side * 0.82
        p.box((ax, y - 0.3, z), (0.1, 0.5, 0.1), PAL['iron'], IRON)
        p.box((ax, y - 1.7, z), (0.18, 2.4, 0.18), PAL['iron'], IRON)
        p.box((ax, y - 0.62, z), (0.22, 0.22, 1.35), PAL['beam'], WOOD)
        arm = [(ax, y - 3.05, z - 0.85), (ax, y - 2.9, z - 0.4), (ax, y - 2.85, z), (ax, y - 2.9, z + 0.4),
               (ax, y - 3.05, z + 0.85)]
        p.sweep(arm, 0.1, 0.1, PAL['iron'], sides=5, mat=IRON)
        for dz in (-0.9, 0.9):
            p.box((ax, y - 2.82, z + dz), (0.1, 0.3, 0.32), PAL['iron'], IRON, pitch=-0.5 * (dz / 0.9))
        hz = 13.3
        hy = 3.75
        p.prism((side * (half_breadth(hz, hy) - 0.02), hy, station_z(hz, hy)), 8, 0.22, 0.22, 0.1, PAL['dark'],
                WOOD, axis=(side, 0, 0.4))
    build_bowsprit(p, fine)
    for x in (-0.78, 0.78):
        p.box((x, FORECASTLE + 0.62, 12.55), (0.32, 1.24, 0.32), PAL['trim'], WOOD, bevel=0.04 if fine else 0)
    return p


def _head_frame():
    f = Vector((0.0, -0.2, 1.0)).normalized()
    r = Vector((1.0, 0.0, 0.0))
    u = f.cross(r).normalized()
    if u.y < 0:
        u = -u
    return f, u, r


def _ring(center, f, u, r, w, h, n=10, flat_bottom=0.75, flat_top=0.92, bulge=0.0):
    pts = []
    for k in range(n):
        a = (k + 0.5) / n * math.tau
        ca, sa = math.cos(a), math.sin(a)
        hh = h * (flat_top if sa > 0 else flat_bottom)
        ww = w * (1 + bulge * max(0.0, -sa * 0.5 + 0.3))
        pts.append(tuple(center + r * ca * ww + u * sa * hh))
    return pts


def build_figurehead(fine=True):
    """An original sea serpent rising off the stem under the bowsprit: an ivory
    body, a cobalt dorsal fin and cheek frills, lantern-amber eyes, an open jaw."""
    p = Piece('Figurehead', wear=0.035, gradient=0.14)
    sides = 10 if fine else 6
    neck = [(0, 2.55, 16.25), (0, 2.95, 17.05), (0, 3.7, 17.75), (0, 4.6, 18.15), (0, 5.3, 18.2),
            (0, 5.7, 18.05)]
    radii = [0.58, 0.6, 0.56, 0.5, 0.46, 0.44]
    p.sweep(neck, 0, 0, PAL['ivory'], sides=sides, radii=radii, up=(1, 0, 0), phase=math.pi / sides,
            color_fn=lambda i, k: PAL['ivory'] if i % 2 == 0 else PAL['ivory_dark'])
    f, u, r = _head_frame()
    O = Vector((0.0, 5.72, 17.85))
    sections = [(-0.12, 0.46, 0.46, 0.0), (0.28, 0.58, 0.52, 0.05), (0.68, 0.54, 0.45, 0.04),
                (1.08, 0.4, 0.33, -0.02), (1.42, 0.34, 0.28, -0.05), (1.7, 0.27, 0.23, -0.07),
                (1.9, 0.15, 0.14, -0.09)]
    if not fine:
        sections = [sections[0], sections[2], sections[4], sections[6]]
    rings = [_ring(O + f * d + u * yo, f, u, r, w, h, n=sides, bulge=0.25) for d, w, h, yo in sections]
    p.loft(rings, lambda i, k: PAL['ivory'] if i != 1 else PAL['ivory_dark'], WOOD)
    # the lower jaw, open a little
    fj = (f * math.cos(0.36) - u * math.sin(0.36)).normalized()
    uj = fj.cross(r).normalized()
    if uj.y < 0:
        uj = -uj
    J = O + u * (-0.36) + f * 0.2
    jaw = [(0.0, 0.38, 0.15), (0.55, 0.32, 0.14), (1.1, 0.23, 0.11), (1.45, 0.13, 0.08)]
    if not fine:
        jaw = [jaw[0], jaw[2], jaw[3]]
    p.loft([_ring(J + fj * d, fj, uj, r, w, h, n=8, flat_bottom=1.0, flat_top=0.6) for d, w, h in jaw],
           lambda i, k: PAL['ivory_dark'], WOOD)
    # the mouth's dark inside
    p.box(tuple(O + f * 0.75 + u * (-0.3)), (0.5, 0.28, 1.0), PAL['dark'], WOOD, pitch=0.2)
    if fine:
        # fangs: down from the upper jaw, up from the lower
        for side in (1, -1):
            for d, lng in ((0.95, 0.3), (1.28, 0.24), (1.58, 0.18)):
                base = O + f * d + r * (side * 0.28) + u * (-0.24)
                p.prism(tuple(base), 4, 0.06, 0.005, lng, PAL['cream'], WOOD, axis=tuple(-u))
            base = J + fj * 1.25 + r * (side * 0.17) + uj * 0.08
            p.prism(tuple(base), 4, 0.05, 0.005, 0.2, PAL['cream'], WOOD, axis=tuple(uj))
    for side in (1, -1):
        eye = O + f * 0.62 + r * (side * 0.47) + u * 0.17
        p.box(tuple(eye), (0.16, 0.14, 0.24), PAL['glow'], GLOW)
        p.box(tuple(eye + u * 0.15 - f * 0.02), (0.24, 0.1, 0.48), PAL['ivory_dark'], WOOD, pitch=0.2)
        # swept-back horns
        hb = O + f * 0.15 + r * (side * 0.28) + u * 0.4
        horn = [hb, hb - f * 0.55 + u * 0.28 + r * (side * 0.12), hb - f * 1.15 + u * 0.18 + r * (side * 0.22)]
        p.sweep([tuple(q) for q in horn], 0, 0, PAL['ivory_dark'], sides=5, radii=[0.12, 0.08, 0.015])
        # cheek frills: a fan of cream rays webbed in cobalt
        root = O + f * 0.32 + r * (side * 0.5) + u * (-0.04)
        tips = [root + r * (side * 0.75) - f * 0.95 + u * 0.55, root + r * (side * 0.95) - f * 1.05,
                root + r * (side * 0.72) - f * 0.85 + u * (-0.5)]
        for t in tips:
            mid = root.lerp(t, 0.5) + r * (side * 0.08)
            p.sweep([tuple(root), tuple(mid), tuple(t)], 0, 0, PAL['cream'], sides=4, radii=[0.07, 0.05, 0.01])
        for a, b in ((tips[0], tips[1]), (tips[1], tips[2])):
            q = [tuple(root), tuple(a), tuple(b)]
            p.face(q, PAL['accent_hi'], WOOD)
            p.face(list(reversed(q)), PAL['accent_hi'], WOOD)
    # dorsal fin: a cobalt membrane on cream spines from the crown down the neck
    fin_base = [O + f * 0.35 + u * 0.5, O + f * (-0.1) + u * 0.46]
    heights = [0.62, 0.8]
    for k in range(len(neck) - 1, 0, -1):
        pk = Vector(neck[k])
        t = (Vector(neck[min(k + 1, len(neck) - 1)]) - Vector(neck[k - 1])).normalized()
        back = t.cross(Vector((1, 0, 0))).normalized()
        if back.z > 0:
            back = -back
        fin_base.append(pk + back * radii[k] * 0.92)
        heights.append(lerp(0.3, 0.75, k / (len(neck) - 1)))
    tipsv = []
    for k, b in enumerate(fin_base):
        up = (b - (O if k < 2 else Vector(neck[len(neck) - 1 - (k - 2)]))).normalized()
        up = (up + Vector((0, 0.35, -0.5))).normalized()
        tipsv.append(b + up * heights[k])
    for k in range(len(fin_base) - 1):
        q = [tuple(fin_base[k]), tuple(fin_base[k + 1]), tuple(tipsv[k + 1]), tuple(tipsv[k])]
        p.face(q, PAL['accent'], WOOD)
        p.face(list(reversed(q)), PAL['accent'], WOOD)
    for k in range(len(fin_base)):
        tip = tipsv[k] + (tipsv[k] - fin_base[k]).normalized() * 0.18
        p.sweep([tuple(fin_base[k]), tuple(tip)], 0, 0, PAL['cream'], sides=4, radii=[0.06, 0.012])
    # the coil: the body wraps down the stem under the neck, ending in a tail fin
    coil = [(0.0, 2.6, 16.2), (0.48, 2.1, 16.1), (0.42, 1.5, 15.9), (-0.22, 1.08, 15.72), (-0.42, 0.65, 15.55),
            (-0.3, 0.3, 15.42)]
    p.sweep(coil, 0, 0, PAL['ivory'], sides=8 if fine else 5, radii=[0.46, 0.4, 0.33, 0.26, 0.19, 0.1],
            up=(0, 0, 1), color_fn=lambda i, k: PAL['ivory'] if i % 2 == 0 else PAL['ivory_dark'])
    tail = Vector(coil[-1])
    for dy, dz in ((0.35, 0.4), (-0.35, 0.45)):
        q = [tuple(tail), tuple(tail + Vector((-0.05, dy, dz))), tuple(tail + Vector((-0.05, 0, 0.7)))]
        p.face(q, PAL['accent'], WOOD)
        p.face(list(reversed(q)), PAL['accent'], WOOD)
    return p


# ---------------------------------------------------------------------------
# Deck dressing and the helm
# ---------------------------------------------------------------------------
def barrel(p, x, y, z, r=0.38, h=1.0, fine=True):
    sides = 10 if fine else 6
    p.cylinder((x, y, z), (x, y + h * 0.5, z), r * 0.88, PAL['trim'], WOOD, sides=sides, r1=r)
    p.cylinder((x, y + h * 0.5, z), (x, y + h, z), r, PAL['trim'], WOOD, sides=sides, r1=r * 0.88)
    if fine:
        for hy in (0.14, 0.86):
            p.cylinder((x, y + h * hy - 0.04, z), (x, y + h * hy + 0.04, z), r * 0.93 + 0.03, PAL['iron'], IRON,
                       sides=sides)


def crate(p, center, size, fine=True, yaw=0.0):
    x, y, z = center
    p.box(center, size, PAL['castle'][1], WOOD, bevel=0.06 if fine else 0, yaw=yaw, edge_color=PAL['trim'])
    if fine:
        p.box((x, y, z), (size[0] + 0.04, size[1] * 0.22, size[2] + 0.04), PAL['iron'], IRON, yaw=yaw)


def build_props(fine=True):
    props = {}
    b = Piece('Benches', wear=0.06, gradient=0.1)
    for side in (1, -1):
        x = side * 4.2
        b.box((x, DECK + 0.5, 5.0), (0.62, 0.12, 2.6), PAL['trim'], WOOD, bevel=0.03 if fine else 0,
              edge_color=scale_color(PAL['trim'], 1.2))
        for z in (3.95, 5.0, 6.05):
            b.box((x, DECK + 0.22, z), (0.5, 0.44, 0.14), PAL['trim_dark'], WOOD)
    props['Benches'] = b
    c = Piece('Crates', wear=0.07, gradient=0.12)
    crate(c, (3.55, DECK + 0.5, 7.5), (1.2, 1.0, 1.5), fine)
    crate(c, (3.45, DECK + 1.25, 7.3), (0.85, 0.5, 0.8), fine, yaw=0.25)
    c.rock_blob((2.7, DECK + 0.3, 6.95), (0.6, 0.6, 0.5), PAL['cream'], WOOD, jitter=0.12)
    c.rock_blob((2.85, DECK + 0.28, 8.05), (0.55, 0.55, 0.45), mix(PAL['cream'], PAL['trim'], 0.3), WOOD,
                jitter=0.12)
    c.box((-2.6, CAPTAIN + 0.95, -9.6), (1.1, 0.12, 1.5), PAL['trim'], WOOD, bevel=0.03 if fine else 0)
    for dx in (-0.45, 0.45):
        for dz in (-0.62, 0.62):
            c.box((-2.6 + dx, CAPTAIN + 0.45, -9.6 + dz), (0.12, 0.9, 0.12), PAL['trim_dark'], WOOD)
    c.face([(-3.05, CAPTAIN + 1.02, -10.2), (-2.15, CAPTAIN + 1.02, -10.2), (-2.15, CAPTAIN + 1.02, -9.1),
            (-3.05, CAPTAIN + 1.02, -9.1)], PAL['cream'], WOOD, FLAT)
    if fine:
        c.box((-2.35, CAPTAIN + 1.1, -9.3), (0.12, 0.16, 0.12), PAL['iron'], IRON)
        lantern(c, (-2.95, CAPTAIN + 1.25, -10.1), 0.2, fine=fine)
    props['Crates'] = c
    br = Piece('Barrels', wear=0.06, gradient=0.12)
    for dx, dz in ((0.0, -0.35), (-0.45, 0.35), (0.42, 0.4)):
        barrel(br, -3.6 + dx, DECK, 7.45 + dz, fine=fine)
    props['Barrels'] = br
    r = Piece('Rope', wear=0.04, gradient=0.0)
    for (x, y, z, rad) in ((1.35, DECK, 3.6, 0.45), (-1.3, DECK, 1.2, 0.4), (1.1, CAPTAIN, -11.6, 0.4),
                           (-0.9, FORECASTLE, 10.3, 0.38)):
        for k in range(3 if fine else 1):
            r.ring((x, y + 0.06 + k * 0.07, z), rad - k * 0.1, 0.07, PAL['rope'], segments=12 if fine else 6,
                   axis=(0, 1, 0), mat=ROPE)
    props['Rope'] = r
    return props


def build_wheel(fine=True):
    p = Piece('Wheel', wear=0.04, gradient=0.06)
    z = -13.4
    cy = CAPTAIN + 1.45
    p.box((0, CAPTAIN + 0.65, z - 0.15), (0.55, 1.3, 0.55), PAL['beam'], WOOD, bevel=0.05, taper=0.8)
    p.box((0, CAPTAIN + 0.05, z - 0.15), (0.95, 0.1, 0.95), PAL['trim_dark'], WOOD)
    p.cylinder((0, cy, z - 0.3), (0, cy, z + 0.25), 0.16, PAL['iron'], IRON, sides=8)
    p.ring((0, cy, z + 0.2), 0.78, 0.1, PAL['trim'], segments=16 if fine else 8, axis=(0, 0, 1), mat=WOOD,
           depth=0.14)
    for k in range(8):
        a = math.tau * k / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        inner_pt = Vector((0, cy, z + 0.2)) + d * 0.12
        outer_pt = Vector((0, cy, z + 0.2)) + d * 1.05
        p.cylinder(tuple(inner_pt), tuple(outer_pt), 0.045, PAL['trim_dark'], WOOD, sides=4)
        if fine:
            p.cylinder(tuple(outer_pt - d * 0.06), tuple(outer_pt + d * 0.1), 0.06, PAL['trim'], WOOD, sides=6)
    p.cylinder((0, cy, z + 0.12), (0, cy, z + 0.32), 0.2, PAL['iron_hi'], IRON, sides=8)
    return p, (0, cy, z + 0.2)


def build_structure_misc(fine=True):
    """Quarterdeck and castle dressing: stern lanterns, quarter windows, ensign staff."""
    p = Piece('CaptainDeck', wear=0.05, gradient=0.1)
    for side in (1, -1):
        x = side * (wall_x(STERN_Z + 0.4) - 0.35)
        z = STERN_Z + 0.55
        top = castle_top(z)
        p.cylinder((x, top, z), (x, top + 1.1, z), 0.07, PAL['iron'], IRON, sides=6)
        lantern(p, (x, top + 1.35, z), 0.36, fine=fine)
    for side in (1, -1):
        for z in (-10.2, -6.0):
            x = side * (wall_x(z) + 0.04)
            p.box((x, 5.1, z), (0.16, 1.15, 0.95), PAL['trim'], WOOD, bevel=0.03 if fine else 0)
            p.box((x + side * 0.05, 5.1, z), (0.1, 0.85, 0.66), PAL['glow'], GLOW)
            p.box((x, 5.85, z), (0.26, 0.14, 1.2), PAL['trim_dark'], WOOD)
    build_quarter_galleries(p, fine)
    p.cylinder((0, castle_top(STERN_Z) + 0.5, STERN_Z + 0.3), (0, 12.2, STERN_Z - 0.55), 0.07, PAL['trim'],
               WOOD, sides=6)
    p.box((0, 12.3, STERN_Z - 0.57), (0.16, 0.16, 0.16), PAL['iron'], IRON)
    return p


# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
def flag_chain(name, parent_obj, materials, anchor, length, h0, h1, segments, colors, emblem_seg=None):
    """A flag as a chain of hinged segments (each a child of the previous) so a
    rotation per segment reads as a travelling wave. Returns the segment objects."""
    objs = []
    parent = parent_obj
    seg_len = length / segments
    ax, ay, az = anchor
    for k in range(segments):
        ha = lerp(h0, h1, k / segments) / 2
        hb = lerp(h0, h1, (k + 1) / segments) / 2
        p = Piece(f'{name}_{k + 1}', wear=0.02, gradient=0.0)
        z0 = az + k * seg_len
        z1 = z0 + seg_len
        col = colors[min(k, len(colors) - 1)]
        p.face([(ax, ay - ha, z0), (ax, ay - hb, z1), (ax, ay + hb, z1), (ax, ay + ha, z0)], col, CLOTH)
        if emblem_seg == k:
            cy, cz = ay, (z0 + z1) / 2
            rr = min(ha, hb)
            for sgn in (1, -1):
                star = []
                for s in range(16):
                    a = math.pi / 2 + math.tau * s / 16
                    r = rr * (0.72 if s % 4 == 0 else (0.45 if s % 2 == 0 else 0.18))
                    star.append((r * math.cos(a), r * math.sin(a)))
                for s in range(16):
                    y0, zz0 = star[s]
                    y1, zz1 = star[(s + 1) % 16]
                    q = [(ax + 0.02 * sgn, cy, cz), (ax + 0.02 * sgn, cy + y0, cz + zz0),
                         (ax + 0.02 * sgn, cy + y1, cz + zz1)]
                    p.face(q if sgn > 0 else list(reversed(q)), PAL['cream'], CLOTH, FLAT)
        obj = p.finish(materials, parent, location=(ax, ay, z0))
        objs.append(obj)
        parent = obj
    return objs


# ---------------------------------------------------------------------------
# The gangplank: separate, it rests on the pier and does not bob with the ship
# ---------------------------------------------------------------------------
def build_gangplank(fine=True):
    p = Piece('Gangplank', wear=0.06, gradient=0.08)
    x0, y0 = half_breadth(GANGWAY_Z, DECK) + 0.7, DECK - 0.12
    x1, y1 = PIER_EDGE_X + 0.4, PIER_DECK
    z = GANGWAY_Z
    length = math.hypot(x1 - x0, y1 - y0)
    slope = math.atan2(y0 - y1, x1 - x0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    m = p.mark()
    p.box((0, -0.06, 0), (length, 0.12, 1.5), PAL['trim'], WOOD, bevel=0.03 if fine else 0,
          edge_color=scale_color(PAL['trim'], 1.2))
    if fine:
        for k in range(6):
            p.box((-length / 2 + 0.25 + k * (length - 0.5) / 5, 0.03, 0), (0.1, 0.06, 1.4), PAL['trim_dark'], WOOD)
    for zz in (-0.7, 0.7):
        p.box((0, -0.12, zz), (length, 0.16, 0.12), PAL['beam'], WOOD)
    rot = Matrix.Translation(P(cx, cy, z)) @ Matrix.Rotation(-slope, 4, 'Y')
    p.turn(m, rot)
    for zz in (-0.72, 0.72):
        for x in (x0 + 0.2, x1 - 0.25):
            y = lerp(y0, y1, (x - x0) / (x1 - x0))
            p.box((x, y + 0.5, z + zz), (0.12, 1.0, 0.12), PAL['trim_dark'], WOOD)
        a = (x0 + 0.2, lerp(y0, y1, 0.2 / (x1 - x0)) + 0.95, z + zz)
        b = (x1 - 0.25, lerp(y0, y1, 1 - 0.25 / (x1 - x0)) + 0.95, z + zz)
        rope_line(p, a, b, 0.04, sag=0.12, segs=4)
    return p


# ---------------------------------------------------------------------------
# Reduced LODs
# ---------------------------------------------------------------------------
def build_lod1(materials, parent):
    """Reduced: the same hull and castles at a coarse loft, masts and flat-bellied sails,
    no rigging lines, dressing as blocks."""
    hull = build_hull(fine=False, name='Hull_LOD1')
    build_castles(hull, fine=False)
    build_transom(hull, fine=False)
    objs = [hull.finish(materials, parent)]
    d = build_decks(fine=False)
    d.name = 'Deck_LOD1'
    objs.append(d.finish(materials, parent))
    s = Piece('Structure_LOD1', wear=0.04)
    build_cabin_front(s, fine=False)
    build_quarter_galleries(s, fine=False)
    for side in (1, -1):
        for k in range(1, 11, 3):
            top = DECK + 0.3 * (k + 2)
            s.box((side * STAIR_X, (DECK + top) / 2, -2.5 - 0.5 * (k + 1)), (STAIR_HW * 2, top - DECK, 1.5),
                  PAL['castle'][k % 3], WOOD)
    s.box((0, DECK + 0.6, 7.8), (3.2, 1.2, 1.3), PAL['castle'][0], WOOD)
    for name in MASTS:
        z, pole, r = MASTS[name]
        d2 = MAST_PARTS[name]
        s.cylinder((0, d2['foot'], z), (0, d2['topmast'], z), r * 0.9, PAL['trim'], WOOD, sides=6, r1=r * 0.4)
        s.cylinder((0, d2['topmast'], z), (0, pole, z), r * 0.3, PAL['trim'], WOOD, sides=4, r1=r * 0.2)
        s.box((0, d2['top'], z), (2.3, 0.2, 1.8), PAL['trim'], WOOD)
        m = s.mark()
        for yard in (d2['yard1'], d2['yard2']):
            if yard:
                yy, half = yard
                s.cylinder((-half, yy, z + 0.35), (half, yy, z + 0.35), 0.18, PAL['trim'], WOOD, sides=5)
        s.turn(m, brace_matrix(z))
    objs.append(s.finish(materials, parent))
    b = Piece('Bow_LOD1')
    build_bowsprit(b, fine=False)
    stem = [(0, y, station_z(STEM_Z, y) + 0.06) for y in (-0.4, 2.5, 5.5, 7.3)]
    b.beam(stem, 0.46, 0.46, PAL['beam'], WOOD, up=(1, 0, 0))
    objs.append(b.finish(materials, parent))
    fig = build_figurehead(fine=False)
    fig.name = 'Figurehead_LOD1'
    objs.append(fig.finish(materials, parent))
    sails = Piece('Sails_LOD1', wear=0.0, facing=False)
    for name in SAILS:
        spec = SAILS[name]
        z = MASTS[spec[0]][0]
        nu, nv = 4, 3
        m = sails.mark()
        rows = [[sail_point(spec, i / nu, j / nv, z) for i in range(nu + 1)] for j in range(nv + 1)]
        sails.surface(rows, lambda j, i: PAL['sail'] if j < nv - 1 else PAL['sail_edge'], CLOTH,
                      outward=lambda c: (0, 0, 1))
        if name == 'MainSail':
            sail_emblem(sails, spec, z, 1, False)
            sail_emblem(sails, spec, z, -1, False)
        sails.turn(m, brace_matrix(z))
    objs.append(sails.finish(materials, parent, smooth_shading=None))
    jib, _ = build_jib(fine=False)
    jib.name = 'JibSail_LOD1'
    objs.append(jib.finish(materials, parent, smooth_shading=None))
    return objs


def build_lod2(materials, parent, name='Silhouette_LOD2', far=False):
    """Silhouette: a hull block with its castles, three poles, the sails as bent panes.
    LOD3 (`far`) is the same idea at the fewest faces that still read."""
    p = Piece(name, wear=0.0, gradient=0.08)
    zs = [-15.5, -7.5, 0.8, 8.5, 12.5, 15.5] if not far else [-15.5, 0.8, 12.5, 15.5]
    ys = [-1.6, 1.5, 3.66, 4.14, SHEER] if not far else [-1.2, SHEER]
    for side in (1, -1):
        rows = [[(side * half_breadth(z, row_y(z, y)), row_y(z, y), station_z(z, row_y(z, y))) for z in zs]
                for y in ys]
        p.surface(rows, lambda i, j: PAL['accent'] if (not far and i == 2) else (
            PAL['castle'][0] if i == 3 else PAL['hull'][0]), WOOD, outward=lambda c, s=side: (s, 0, 0))
    p.face([(-half_breadth(STERN_Z, ys[0]), ys[0], STERN_Z), (half_breadth(STERN_Z, ys[0]), ys[0], STERN_Z),
            (wall_x(STERN_Z), CAPTAIN + RAIL, STERN_Z), (-wall_x(STERN_Z), CAPTAIN + RAIL, STERN_Z)],
           PAL['castle'][0], WOOD)
    p.face([(-inner(-15.0), SHEER, -15.0), (inner(-15.0), SHEER, -15.0), (inner(14.0), SHEER, 14.0),
            (-inner(14.0), SHEER, 14.0)], PAL['deck'][0], WOOD)
    # castles as blocks that follow the hull's outline
    def castle_block(zs_c, top_fn):
        for side in (1, -1):
            rows = [[(side * wall_x(z), yy(z), station_z(z, yy(z))) for z in zs_c]
                    for yy in (lambda z: sheer(z), top_fn)]
            p.surface(rows, lambda i, j: PAL['castle'][0], WOOD, outward=lambda c, s=side: (s, 0, 0))
        lid = [[(-wall_x(z), top_fn(z), z), (wall_x(z), top_fn(z), z)] for z in zs_c]
        p.surface(lid, lambda i, j: PAL['deck'][0], WOOD, outward=lambda c: (0, 1, 0))
        for z, facing in ((zs_c[0], -1), (zs_c[-1], 1)):
            w = wall_x(z)
            p.surface([[(-w, sheer(z), z), (w, sheer(z), z)], [(-w, top_fn(z), z), (w, top_fn(z), z)]],
                      lambda i, j: PAL['castle'][1], WOOD, outward=lambda c, f=facing: (0, 0, f))

    castle_block([-15.4, -12.0, -7.5, -3.2] if not far else [-15.4, -3.2], lambda z: CAPTAIN + RAIL)
    castle_block([8.5, 11.0, 13.0, 14.8] if not far else [8.5, 14.8], lambda z: fc_top(z))
    if not far:
        p.box((0, 5.0, STERN_Z - 0.05), (3.5, 0.9, 0.1), PAL['glow'], GLOW)
    for mname in MASTS:
        z, pole, r = MASTS[mname]
        d = MAST_PARTS[mname]
        p.cylinder((0, d['foot'], z), (0, pole, z), r * 0.95, PAL['trim'], WOOD, sides=4 if far else 5,
                   r1=r * 0.35, caps=False)
    p.cylinder(BOWSPRIT_HEEL, BOWSPRIT_TIP, 0.32, PAL['trim'], WOOD, sides=4, caps=False)
    for sname in SAILS:
        spec = SAILS[sname]
        z = MASTS[spec[0]][0]
        nu, nv = (2, 1) if far else (2, 2)
        m = p.mark()
        rows = [[sail_point(spec, i / nu, j / nv, z) for i in range(nu + 1)] for j in range(nv + 1)]
        p.surface(rows, lambda j, i: PAL['sail'], CLOTH, outward=lambda c: (0, 0, 1))
        p.turn(m, brace_matrix(z))
    p.face([JIB_HEAD, JIB_TACK, JIB_CLEW], PAL['sail'], CLOTH)
    return p.finish(materials, parent)


# ---------------------------------------------------------------------------
# The idle clip
# ---------------------------------------------------------------------------
FPS = 10
CLIP_SECONDS = 12
FRAMES = FPS * CLIP_SECONDS
TAU = math.tau


def iter_fcurves(action):
    fcs = getattr(action, 'fcurves', None)
    if fcs is not None:
        try:
            for fc in fcs:
                yield fc
            return
        except (AttributeError, TypeError):
            pass
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                for fc in bag.fcurves:
                    yield fc


def key_object(obj, fn):
    """fn(t in [0,1)) -> dict(loc=(x,y,z) game-frame offset, rot=(pitch, yaw, roll) game,
    scale=(sx, sy, sz) game). Keys every frame, linear; the last frame equals the first."""
    base_loc = obj.location.copy()
    base_rot = obj.rotation_euler.copy()
    base_scale = obj.scale.copy()
    for fr in range(FRAMES + 1):
        t = (fr % FRAMES) / FRAMES
        v = fn(t)
        loc = v.get('loc', (0, 0, 0))
        rot = v.get('rot', (0, 0, 0))
        sc = v.get('scale', (1, 1, 1))
        obj.location = base_loc + P(*loc)
        obj.rotation_euler = (base_rot.x + rot[0], base_rot.y - rot[2], base_rot.z + rot[1])
        obj.scale = (base_scale.x * sc[0], base_scale.y * sc[2], base_scale.z * sc[1])
        obj.keyframe_insert('location', frame=fr)
        obj.keyframe_insert('rotation_euler', frame=fr)
        obj.keyframe_insert('scale', frame=fr)
    obj.location, obj.rotation_euler, obj.scale = base_loc, base_rot, base_scale
    anim = obj.animation_data
    if anim and anim.action:
        for fc in iter_fcurves(anim.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'


def animate(motion, sails, flags):
    # the whole ship: a slow heave, a gentle roll and pitch. Small on purpose: players stand
    # on a static deck collider, so the drawn deck may drift only a few centimetres.
    key_object(motion, lambda t: dict(
        loc=(0, 0.045 * math.sin(TAU * 2 * t) + 0.02 * math.sin(TAU * 3 * t + 1.1), 0),
        rot=(0.0028 * math.sin(TAU * 2 * t + 0.7), 0.0, 0.009 * math.sin(TAU * t + 0.3))))
    # sails breathe: the belly fills and eases, swinging a touch about the yard
    for k, obj in enumerate(sails):
        phase = 0.9 * k
        key_object(obj, lambda t, ph=phase: dict(
            rot=(0.02 * math.sin(TAU * 3 * t + ph), 0.0, 0.004 * math.sin(TAU * 2 * t + ph)),
            scale=(1.0, 1.0, 1.0 + 0.09 * math.sin(TAU * 3 * t + ph + 0.4))))
    # flags ripple: each segment swings a little more than the last, a quarter-wave behind
    for chain in flags:
        for k, obj in enumerate(chain):
            amp = 0.16 + 0.07 * k
            key_object(obj, lambda t, k=k, amp=amp: dict(
                rot=(0.0, amp * math.sin(TAU * 8 * t - 0.95 * k), 0.04 * math.sin(TAU * 4 * t - 0.6 * k))))


# ---------------------------------------------------------------------------
# Scene assembly
# ---------------------------------------------------------------------------
def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'Idle'
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = FRAMES
    mats = make_materials()
    root = empty('TransportShip_ROOT', None, display='ARROWS', size=2.0)
    motion = empty('Ship_Motion', root)
    lod0 = empty('LOD0', motion)
    groups = {g: empty(g, lod0) for g in ('Masts', 'Sails', 'Structures', 'Props', 'Flags')}

    hull = build_hull(True)
    build_castles(hull, True)
    build_transom(hull, True)
    hull.finish(mats, lod0)
    build_decks(True).finish(mats, lod0)
    build_railings(True).finish(mats, lod0)
    cabin = Piece('RearCabin', wear=0.05, gradient=0.1)
    build_cabin_front(cabin, True)
    cabin.finish(mats, groups['Structures'])
    build_structure_misc(True).finish(mats, groups['Structures'])
    build_bow(True).finish(mats, groups['Structures'])
    build_stairs(True).finish(mats, groups['Structures'])
    build_figurehead(True).finish(mats, lod0)
    for n in MASTS:
        build_mast(n, True).finish(mats, groups['Masts'])
    sail_objs = []
    for name in SAILS:
        piece, pivot = build_sail(name, True, emblem_on=(name == 'MainSail'), band=(name == 'SecondarySail'))
        obj = piece.finish(mats, groups['Sails'], location=pivot, smooth_shading=None)
        obj.rotation_euler = (0.0, 0.0, BRACE)
        sail_objs.append(obj)
    jib, jib_pivot = build_jib(True)
    sail_objs.append(jib.finish(mats, groups['Sails'], location=jib_pivot, smooth_shading=None))
    build_rigging(True).finish(mats, lod0)
    for pc in build_props(True).values():
        pc.finish(mats, groups['Props'])
    wheel, wheel_pivot = build_wheel(True)
    wheel.finish(mats, lod0, location=wheel_pivot)
    mz = MASTS['MainMast'][0]
    pennant = flag_chain('Pennant_Main', groups['Flags'], mats, (0.0, MASTS['MainMast'][1] - 0.35, mz + 0.1), 5.2,
                         0.62, 0.08, 3, [PAL['accent'], PAL['accent_hi'], PAL['cream']])
    fz = MASTS['SecondaryMast'][0]
    pen_f = flag_chain('Pennant_Fore', groups['Flags'], mats, (0.0, MASTS['SecondaryMast'][1] - 0.3, fz + 0.1), 2.6,
                       0.42, 0.06, 2, [PAL['accent'], PAL['cream']])
    zz = MASTS['MizzenMast'][0]
    pen_z = flag_chain('Pennant_Mizzen', groups['Flags'], mats, (0.0, MASTS['MizzenMast'][1] - 0.3, zz + 0.1), 2.4,
                       0.4, 0.06, 2, [PAL['accent'], PAL['cream']])
    ensign = flag_chain('Ensign', groups['Flags'], mats, (0.0, 11.6, STERN_Z - 0.5), 2.1, 1.3, 1.2, 3,
                        [PAL['accent']], emblem_seg=1)

    lod1 = empty('LOD1', motion)
    build_lod1(mats, lod1)
    lod2 = empty('LOD2', motion)
    build_lod2(mats, lod2)
    lod3 = empty('LOD3', motion)
    build_lod2(mats, lod3, name='Silhouette_LOD3', far=True)

    gx = half_breadth(GANGWAY_Z, DECK) + 0.7
    gang = build_gangplank(True).finish(mats, root, location=(gx, DECK, GANGWAY_Z))
    sockets = empty('Sockets', root)
    for name, loc in (('Socket_Gangway_Port', (5.15, DECK, GANGWAY_Z)),
                      ('Socket_Gangway_Starboard', (-5.15, DECK, GANGWAY_Z)),
                      ('Socket_Gangplank_Hinge', (gx, DECK, GANGWAY_Z)),
                      ('Socket_BowSplash', (0.0, 0.0, STEM_Z - 0.4)),
                      ('Socket_Wake', (0.0, 0.0, STERN_Z - 0.6)),
                      ('Socket_Helm', (0.0, CAPTAIN, -13.4)),
                      ('Socket_StandMainDeck', (0.0, DECK, 0.0)),
                      ('Socket_StandCaptainDeck', (0.0, CAPTAIN, -11.0))):
        empty(name, sockets, location=loc)
    ctrl = empty('AnimationControllers', root)
    ctrl['idleClip'] = {'name': 'Idle', 'seconds': CLIP_SECONDS, 'fps': FPS,
                        'targets': 'Ship_Motion, LOD0 sails, flag segments'}
    root['transportShip'] = {
        'id': 'eastbrookFerry',
        'mainDeckY': DECK, 'captainDeckY': CAPTAIN, 'forecastleY': FORECASTLE, 'railHeight': RAIL,
        'length': LENGTH, 'beam': BEAM, 'draft': DRAFT,
        'gangwayPort': [5.15, DECK, GANGWAY_Z], 'gangwayStarboard': [-5.15, DECK, GANGWAY_Z],
        'gangwayWidth': GANGWAY[1] - GANGWAY[0] - 0.3,
        'masts': {n: [MASTS[n][0], MASTS[n][1]] for n in MASTS},
    }
    animate(motion, sail_objs, [pennant, pen_f, pen_z, ensign])
    return dict(root=root, motion=motion, lods=(lod0, lod1, lod2, lod3), gang=gang, mats=mats)


def report(scene_objs):
    totals = {}
    for lod in scene_objs['lods']:
        n = 0
        for o in lod.children_recursive:
            if o.type == 'MESH':
                t = triangles(o)
                n += t
                if lod.name == 'LOD0':
                    print(f'PIECE {o.name} triangles {t}')
        totals[lod.name] = n
    totals['Gangplank'] = triangles(scene_objs['gang'])
    for k, v in totals.items():
        print(f'TRIANGLES {k} {v}')
    return totals


def export(path, scene_objs):
    bpy.ops.object.select_all(action='DESELECT')
    root = scene_objs['root']
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=True, export_animation_mode='SCENE',
        export_anim_scene_split_object=False, export_force_sampling=True, export_frame_range=True,
        export_optimize_animation_size=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_morph=False,
    )
    print('WROTE', path)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


if __name__ == '__main__':
    objs = build_scene()
    report(objs)
    export(os.path.join(HERE, 'eastbrook_ferry_source.glb'), objs)
    out_dir = arg('--preview')
    if out_dir or arg('--save'):
        import preview_scene  # noqa: E402

        preview_scene.stage(objs, collision=arg('--collision'))
        if arg('--lod'):
            preview_scene.show_lod(objs, int(arg('--lod')))
        if out_dir:
            preview_scene.render_all(out_dir, only=arg('--only'))
        if arg('--save'):
            preview_scene.save(arg('--save'))
