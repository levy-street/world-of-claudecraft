"""The Wickharbor ferry wharf: the one built waterfront at the Wickharbor ferry berth.

  npx tsx scripts/assets/wickharbor_wharf/layout.ts        (refresh layout.json from the sim)
  blender --background --python scripts/assets/wickharbor_wharf/build_wickharbor_wharf.py -- \
      [--save FILE.blend --context TERRAIN.json [--render OUT_DIR]]

Writes wickharbor_wharf_source.glb beside this file. `node scripts/assets/wickharbor_wharf/build.mjs`
ships it (validate, fingerprint, meshopt) to public/models/props/wickharbor_wharf.glb, and
src/render/wickharbor_wharf.ts places it at the berth.

Every walkable plank, rail and solid here stands where the sim says it does: the decks, rails
and props come from src/sim/content/wickharbor_wharf.ts through layout.json (model frame:
yards, origin on the waterline at the content's WICKHARBOR_WHARF_ORIGIN, +x east, +y up, +z the
world's +z), and every pile, post and wall runs down into the terrain under it (the layout's
height grid), so nothing floats. The level decks (the pier, the berth head and the arm) are
laid as ONE plank field at one height: each course of boards runs across the pier's heading
and stops at the field's edge, so no two floors ever overlap. The flight's first tread rests on
the town's boardwalk (drawn by the game from its deck), a step above its planks.

The recipe, the palette and the materials are the Wyrmwatch cliff harbor's
(scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py, imported here as W): its lanterns,
posts, beams, rope coils and rail simplifier, on the Eastbrook ferry's shared builder library
(scripts/assets/eastbrook_ferry/shiplib.py), so the two harbors belong to the one ferry line.

Hierarchy (the runtime keeps or sheds these by graphics tier; the sim collides with what the
low tier keeps, so every solid is in a low-tier part):

  WickharborWharf_ROOT   root, placed on the waterline at the wharf origin
    WharfDeck            the one plank field: pier, berth head and arm
    WharfFrame           fascia, joists, pile bents to the seabed, bracing, the stone wall
                         under the root against the bluff
    WharfFlight          the flight up from the boardwalk: treads, risers, stringers, posts
    WharfRails           every rail, its posts and newels
    WharfLanterns        the lantern posts and the newel lanterns (the landmarks)
    WharfCargo           crate stacks, barrels and bollards (all collide)
    WharfTrim            medium tier and up: fender piles, mooring rings, bolts, iron bands
    WharfClutter         high tier and up: rope coils, sacks, a bucket, oars, a net

Everything is original procedural work for this project.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))
sys.path.insert(0, os.path.join(HERE, '..', 'wyrmwatch_harbor'))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from shiplib import IRON, ROPE, WOOD, Piece, empty, triangles  # noqa: E402

import build_wyrmwatch_harbor as W  # noqa: E402

STONE = W.STONE
PAL = W.PAL

with open(os.path.join(HERE, 'layout.json'), encoding='utf8') as fh:
    LAYOUT = json.load(fh)

RAIL_H = LAYOUT['railHeight']
LEVEL = LAYOUT['level']
PLANK_T = 0.16
BURY = 0.8          # piles and posts run this far into the ground under them
DECKS = {d['id']: d for d in LAYOUT['decks']}
PROPS = LAYOUT['props']
ROT = LAYOUT['rot']
DA = (math.sin(ROT), math.cos(ROT))      # along the pier (model x, z)
DC = (math.cos(ROT), -math.sin(ROT))     # across it, positive to the north
FIELD = {k: DECKS[k]['frame'] for k in ('pier', 'berthHead', 'arm')}
PIER, HEAD, ARM = FIELD['pier'], FIELD['berthHead'], FIELD['arm']
FLIGHT = DECKS['flight']
BOARDWALK_TOP = LAYOUT['boardwalkTop']
UNDER = LEVEL - PLANK_T


def pick(seq, i):
    return seq[i % len(seq)]


# ---------------------------------------------------------------------------
# Terrain and the wharf frame (model frame)
# ---------------------------------------------------------------------------
T = LAYOUT['terrain']


def ground(x, z):
    """Bilinear terrain height (above the waterline) from the layout grid."""
    fx = min(max((x - T['x0']) / T['step'], 0.0), T['nx'] - 1.0001)
    fz = min(max((z - T['z0']) / T['step'], 0.0), T['nz'] - 1.0001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    h, n = T['h'], T['nx']
    a, b = h[j * n + i], h[j * n + i + 1]
    c, d = h[(j + 1) * n + i], h[(j + 1) * n + i + 1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


def foot(x, z):
    return ground(x, z) - BURY


def W2(a, c):
    """A wharf-frame point (along, across) in the model frame (x, z)."""
    return (DA[0] * a + DC[0] * c, DA[1] * a + DC[1] * c)


def W3(a, c, y):
    x, z = W2(a, c)
    return (x, y, z)


def post(p, a, c, top, w, color, bottom=None, mat=WOOD):
    """A square post at wharf point (a, c) from `top` down into the ground under it."""
    x, z = W2(a, c)
    W.post(p, x, z, top, foot(x, z) if bottom is None else bottom, w, color, mat)


def beam(p, a0, c0, y0, a1, c1, y1, w, h, color, mat=WOOD):
    W.beam(p, W3(a0, c0, y0), W3(a1, c1, y1), w, h, color, mat)


def board(p, a0, a1, c0, c1, top, color, thick=PLANK_T, lift=0.0):
    """A board over the wharf-frame rectangle a0..a1 x c0..c1, its top at `top`."""
    x, z = W2((a0 + a1) / 2, (c0 + c1) / 2)
    p.box((x, top - thick / 2 + lift, z), (c1 - c0, thick, a1 - a0), color, WOOD, yaw=ROT)


def rows(a0, a1, spacing):
    n = max(1, int(math.ceil((a1 - a0) / spacing)))
    return [a0 + (a1 - a0) * i / n for i in range(n + 1)]


# ---------------------------------------------------------------------------
# The plank field: one height, courses across the pier, never doubled
# ---------------------------------------------------------------------------
def field_segments():
    """The field as spans along the pier, each with its across extent: the pier's root to
    the arm, the pier with the arm, the pier on to the head, the head."""
    return [
        (PIER['a0'], ARM['a0'], PIER['c0'], PIER['c1']),
        (ARM['a0'], ARM['a1'], PIER['c0'], ARM['c1']),
        (ARM['a1'], PIER['a1'], PIER['c0'], PIER['c1']),
        (HEAD['a0'], HEAD['a1'], HEAD['c0'], HEAD['c1']),
    ]


BOARD_LEN = 3.3      # boards butt-jointed along each course, staggered course to course
COURSE = 0.55        # course pitch (a board's width), fitted to each span


def build_deck():
    p = Piece('WharfDeck', wear=0.08, gradient=0.12)
    course = 0
    for a0, a1, c0, c1 in field_segments():
        n = max(1, int(round((a1 - a0) / COURSE)))
        step = (a1 - a0) / n
        for i in range(n):
            s0 = a0 + step * i + 0.025
            s1 = a0 + step * (i + 1) - 0.025
            # butt joints staggered a third of a board each course
            offset = (course % 3) * BOARD_LEN / 3
            cuts = [c0]
            c = c0 + BOARD_LEN - offset
            while c < c1 - 0.6:
                if c - cuts[-1] > 0.6:
                    cuts.append(c)
                c += BOARD_LEN
            cuts.append(c1)
            for j in range(len(cuts) - 1):
                lo = cuts[j] + (0.015 if j > 0 else 0.0)
                hi = cuts[j + 1] - (0.015 if j + 2 < len(cuts) else 0.0)
                lift = (p.rng.random() - 0.5) * 0.012
                board(p, s0, s1, lo, hi, LEVEL, pick(PAL['deck'], course * 3 + j), lift=lift)
            course += 1
    return p


# ---------------------------------------------------------------------------
# The frame: fascia, joists, pile bents, bracing, the stone wall at the root
# ---------------------------------------------------------------------------
def outline():
    """The field's outer edges as wharf-frame segments (a0, c0, a1, c1) with the unit
    normal (na, nc) pointing into the field, round the pier's root, its sides, the arm and
    the head."""
    p, h, m = PIER, HEAD, ARM
    return [
        (p['a0'], p['c0'], p['a0'], p['c1'], 1, 0),    # the root
        (p['a0'], p['c0'], h['a0'], p['c0'], 0, 1),    # the pier's south side
        (p['a0'], p['c1'], m['a0'], p['c1'], 0, -1),   # its north side, root to arm
        (m['a0'], p['c1'], m['a0'], m['c1'], 1, 0),    # the arm's west side
        (m['a0'], m['c1'], m['a1'], m['c1'], 0, -1),   # the arm's north end (the flight's head)
        (m['a1'], m['c1'], m['a1'], p['c1'], -1, 0),   # the arm's east side
        (m['a1'], p['c1'], h['a0'], p['c1'], 0, -1),   # the pier's north side, arm to head
        (h['a0'], p['c1'], h['a0'], h['c1'], 1, 0),    # the head's back, north wing
        (h['a0'], h['c0'], h['a0'], p['c0'], 1, 0),    # ...south wing
        (h['a0'], h['c1'], h['a1'], h['c1'], 0, -1),   # the head's north end
        (h['a0'], h['c0'], h['a1'], h['c0'], 0, 1),    # its south end
        (h['a1'], h['c0'], h['a1'], h['c1'], -1, 0),   # its face
    ]


def inward(a0, c0, a1, c1, na, nc, d):
    """Shift an outline segment `d` into the field."""
    return a0 + na * d, c0 + nc * d, a1 + na * d, c1 + nc * d


def brace_run(p, pts, hi, idx0=0):
    """Diagonal braces between neighbouring piles (wharf points), alternating."""
    for i in range(len(pts) - 1):
        (aa, ca), (ab, cb) = pts[i], pts[i + 1]
        xa, za = W2(aa, ca)
        xb, zb = W2(ab, cb)
        ga, gb = max(ground(xa, za), -1.2) + 0.25, max(ground(xb, zb), -1.2) + 0.25
        if hi - max(ga, gb) < 1.1:
            continue
        if (i + idx0) % 2 == 0:
            W.beam(p, (xa, hi, za), (xb, gb, zb), 0.2, 0.22, PAL['post_dark'])
        else:
            W.beam(p, (xa, ga, za), (xb, hi, zb), 0.2, 0.22, PAL['post_dark'])


def build_frame():
    p = Piece('WharfFrame', wear=0.07, gradient=0.14)
    # heavy fascia beams dressing the plank ends round the whole outline
    for seg in outline():
        a0, c0, a1, c1 = inward(*seg, 0.14)
        beam(p, a0, c0, UNDER - 0.18, a1, c1, UNDER - 0.18, 0.28, 0.38, PAL['post'])
    # joists under the courses: along the pier and the head, across the arm
    for c in (-2.1, -0.7, 0.7, 2.1):
        beam(p, PIER['a0'] + 0.2, c, UNDER - 0.13, HEAD['a1'] - 0.2, c, UNDER - 0.13, 0.2, 0.24,
             PAL['post_dark'])
    for c in (-4.8, -3.45, 3.45, 4.8):
        beam(p, HEAD['a0'] + 0.2, c, UNDER - 0.13, HEAD['a1'] - 0.2, c, UNDER - 0.13, 0.2, 0.24,
             PAL['post_dark'])
    for a in (ARM['a0'] + 0.5, (ARM['a0'] + ARM['a1']) / 2, ARM['a1'] - 0.5):
        beam(p, a, PIER['c1'] - 0.3, UNDER - 0.13, a, ARM['c1'] - 0.2, UNDER - 0.13, 0.2, 0.24,
             PAL['post_dark'])
    # pile bents: across the pier every ~2.3 yd, across the head, along the arm
    pier_rows = rows(PIER['a0'] + 0.45, HEAD['a0'] - 0.3, 2.3)
    pier_cols = (PIER['c0'] + 0.3, 0.0, PIER['c1'] - 0.3)
    head_rows = (HEAD['a0'] + 0.35, (HEAD['a0'] + HEAD['a1']) / 2, HEAD['a1'] - 0.35)
    head_cols = (HEAD['c0'] + 0.3, -2.6, 0.0, 2.6, HEAD['c1'] - 0.3)
    arm_rows = (PIER['c1'] + 1.6, (PIER['c1'] + ARM['c1']) / 2 + 0.5, ARM['c1'] - 0.3)
    arm_cols = (ARM['a0'] + 0.3, (ARM['a0'] + ARM['a1']) / 2, ARM['a1'] - 0.3)
    cap = UNDER - 0.3
    for a in pier_rows:
        for c in pier_cols:
            post(p, a, c, UNDER - 0.1, 0.42, PAL['pile'])
        beam(p, a, PIER['c0'] + 0.1, cap, a, PIER['c1'] - 0.1, cap, 0.3, 0.3, PAL['post_dark'])
    for a in head_rows:
        for c in head_cols:
            post(p, a, c, UNDER - 0.1, 0.42, PAL['pile'])
        beam(p, a, HEAD['c0'] + 0.1, cap, a, HEAD['c1'] - 0.1, cap, 0.3, 0.3, PAL['post_dark'])
    for c in arm_rows:
        for a in arm_cols:
            post(p, a, c, UNDER - 0.1, 0.42, PAL['pile'])
        beam(p, ARM['a0'] + 0.1, c, cap, ARM['a1'] - 0.1, c, cap, 0.3, 0.3, PAL['post_dark'])
    # diagonal bracing down both outer pile lines of the pier, the head's ends, the arm's sides
    hi = UNDER - 0.55
    for c in (pier_cols[0], pier_cols[-1]):
        brace_run(p, [(a, c) for a in pier_rows], hi)
    for c in (head_cols[0], head_cols[-1]):
        brace_run(p, [(a, c) for a in head_rows], hi, 1)
    for a in (arm_cols[0], arm_cols[-1]):
        brace_run(p, [(a, c) for c in arm_rows], hi)
    # the stone wall under the root, against the bluff: coursed blocks from the ground up to
    # the fascia, a little wider than the pier
    stone_wall(p, PIER['a0'] - 0.25, PIER['c0'] - 0.5, PIER['a0'] - 0.25, PIER['c1'] + 0.5,
               UNDER - 0.12, 0.7)
    return p


def stone_wall(p, a0, c0, a1, c1, top, thick, seed=0):
    """A coursed stone wall from the ground up to `top` along a straight wharf-frame line,
    each course stopping at the ground (W.stone_wall's recipe on this wharf's terrain)."""
    x0, z0 = W2(a0, c0)
    x1, z1 = W2(a1, c1)
    length = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / length, (z1 - z0) / length
    yaw = math.atan2(ux, uz)
    course_h = 0.55
    low = min(ground(x0 + ux * length * k / 10, z0 + uz * length * k / 10) for k in range(11)) - 0.3
    k = 0
    y = top - course_h
    while y + course_h > low:
        t = -0.55 if k % 2 else 0.0
        j = 0
        while t < length:
            ta, tb = max(0.0, t), min(length, t + 1.1)
            if tb - ta > 0.15:
                tm = (ta + tb) / 2
                g = min(ground(x0 + ux * ta, z0 + uz * ta), ground(x0 + ux * tb, z0 + uz * tb))
                if y + course_h > g - 0.35:
                    bulge = 0.04 + p.rng.random() * 0.05
                    p.box((x0 + ux * tm, y + course_h / 2, z0 + uz * tm),
                          (thick + bulge, course_h - 0.05, (tb - ta) - 0.05), pick(PAL['stone'], j + k * 3 + seed),
                          STONE, yaw=yaw)
            t += 1.1
            j += 1
        y -= course_h
        k += 1
    p.box(((x0 + x1) / 2, top + 0.06, (z0 + z1) / 2), (thick + 0.14, 0.12, length), PAL['stone_dark'], STONE, yaw=yaw)


# ---------------------------------------------------------------------------
# The flight: up from the boardwalk onto the arm
# ---------------------------------------------------------------------------
RISERS = 6


def f_at(along, across):
    """A point in the flight's own frame (its heading runs from the boardwalk to the arm)."""
    d = FLIGHT
    a = (math.sin(d['rot']), math.cos(d['rot']))
    c = (math.cos(d['rot']), -math.sin(d['rot']))
    return (d['x'] + a[0] * along + c[0] * across, d['z'] + a[1] * along + c[1] * across)


def f_surf(along):
    d = FLIGHT
    t = min(1.0, max(0.0, (along + d['hl']) / (2 * d['hl'])))
    return d['near'] + (d['far'] - d['near']) * t


def f_along_at(y):
    d = FLIGHT
    return -d['hl'] + (y - d['near']) / (d['far'] - d['near']) * 2 * d['hl']


def build_flight():
    p = Piece('WharfFlight', wear=0.07, gradient=0.14)
    d = FLIGHT
    hw = d['hw']
    rise = (d['far'] - d['near']) / RISERS
    a0, a1 = -d['hl'], d['hl'] - 0.02
    inner = hw * 2 - 0.62
    # tread k covers the ramp heights within half a riser of its top (the sim walks the ramp)
    edges = [a0] + [f_along_at(d['near'] + (k + 0.5) * rise) for k in range(RISERS)] + [a1]
    for k in range(RISERS + 1):
        lo, hi = max(edges[k], a0), min(edges[k + 1], a1)
        if hi - lo < 0.05:
            continue
        ytop = d['near'] + k * rise
        x, z = f_at((lo + hi) / 2, 0)
        p.box((x, ytop - 0.07, z), (inner, 0.14, (hi - lo) + 0.05), pick(PAL['plank'], k), WOOD, yaw=d['rot'])
        # the nosing on the tread's downhill edge, and the riser board under it (the first
        # riser stands on the boardwalk's planks)
        xn, zn = f_at(lo + 0.05, 0)
        p.box((xn, ytop - 0.05, zn), (inner, 0.1, 0.12), PAL['trim_dark'], WOOD, yaw=d['rot'])
        below = BOARDWALK_TOP if k == 0 else ytop - rise
        xr, zr = f_at(lo, 0)
        p.box((xr, (ytop - 0.1 + below) / 2, zr), (inner - 0.02, ytop - 0.1 - below, 0.06), PAL['seam'], WOOD,
              yaw=d['rot'])
    # a sill under the first tread, bedded on the boardwalk
    xs, zs = f_at(a0 + 0.35, 0)
    p.box((xs, BOARDWALK_TOP + 0.06, zs), (hw * 2 - 0.1, 0.12, 0.62), PAL['post_dark'], WOOD, yaw=d['rot'])
    # the two stringers from the sill up to the arm's fascia, a hand above the ramp line
    s0 = a0 + 0.55
    for s in (1, -1):
        c = s * (hw - 0.16)
        x0, z0 = f_at(s0, c)
        x1, z1 = f_at(a1, c)
        W.beam(p, (x0, f_surf(s0) - 0.2, z0), (x1, f_surf(a1) - 0.2, z1), 0.3, 0.5, PAL['post'])
    # posts under the stringers down to the beach, and a cross beam
    for a in (a0 + 0.75, d['hl'] - 0.45):
        y = f_surf(a) - 0.45
        for s in (1, -1):
            x, z = f_at(a, s * (hw - 0.16))
            W.post(p, x, z, y, foot(x, z), 0.34, PAL['pile'])
        xa, za = f_at(a, -hw + 0.2)
        xb, zb = f_at(a, hw - 0.2)
        W.beam(p, (xa, y - 0.2, za), (xb, y - 0.2, zb), 0.24, 0.24, PAL['post_dark'])
    return p


# ---------------------------------------------------------------------------
# Railings (W's recipe on this wharf's rails)
# ---------------------------------------------------------------------------
NEWEL_TOP = 0.2
# rail corners that carry a newel lantern: (rail index, corner index)
NEWEL_LANTERNS = {(0, 1), (0, 3), (0, 4), (0, 5), (0, 6), (1, 2), (1, 3), (1, 5)}


def on_boardwalk(x, z):
    b = LAYOUT['boardwalk']
    dx, dz = x - b['x'], z - b['z']
    al = dx * math.sin(b['rot']) + dz * math.cos(b['rot'])
    ac = dx * math.cos(b['rot']) - dz * math.sin(b['rot'])
    return abs(al) <= b['hl'] and abs(ac) <= b['hw']


def build_rails():
    p = Piece('WharfRails', wear=0.06, gradient=0.12)
    lanterns = []
    for ri, rail in enumerate(LAYOUT['rails']):
        for ci, c in enumerate(rail['corners']):
            top = c['y'] + RAIL_H + NEWEL_TOP
            # a newel at the flight's foot stands down on the boardwalk
            bottom = BOARDWALK_TOP - 0.05 if on_boardwalk(c['x'], c['z']) else c['y'] - 0.05
            W.post(p, c['x'], c['z'], top, bottom, 0.28, PAL['post_dark'])
            p.box((c['x'], top + 0.06, c['z']), (0.36, 0.12, 0.36), PAL['trim_dark'], WOOD)
            if (ri, ci) in NEWEL_LANTERNS:
                lanterns.append((c['x'], top + 0.12, c['z']))
            else:
                p.box((c['x'], top + 0.2, c['z']), (0.22, 0.16, 0.22), PAL['post'], WOOD, taper=0.3)
        for leg in rail['legs']:
            pts = [(s['x'], s['y'], s['z']) for s in leg]
            length = math.hypot(pts[-1][0] - pts[0][0], pts[-1][2] - pts[0][2])
            if length < 0.2:
                continue
            n = max(1, int(math.ceil(length / 1.35)))
            for k in range(1, n):
                idx = k / n * (len(pts) - 1)
                i0 = min(int(idx), len(pts) - 2)
                f = idx - i0
                x = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * f
                y = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * f
                z = pts[i0][2] + (pts[i0 + 1][2] - pts[i0][2]) * f
                W.post(p, x, z, y + RAIL_H - 0.05, y - 0.05, 0.15, PAL['post'])
            line = W.simplify(pts)
            for lift, w, h, col in ((RAIL_H - 0.02, 0.17, 0.11, PAL['trim_dark']), (0.62, 0.1, 0.09, PAL['post'])):
                p.beam([(x, y + lift, z) for x, y, z in line], w, h, col, WOOD, up=(0, 1, 0))
    return p, lanterns


# ---------------------------------------------------------------------------
# Lanterns, cargo (the solids), trim and clutter
# ---------------------------------------------------------------------------
def build_lanterns(newel_tops):
    p = Piece('WharfLanterns', wear=0.04, gradient=0.08)
    iron = PAL['iron']
    for q in PROPS:
        if q['kind'] != 'lanternPost':
            continue
        x, z, base = q['x'], q['z'], q['base']
        top = base + q['height'] - 0.3
        W.post(p, x, z, base + 0.3, base - 0.05, 0.5, PAL['post_dark'], WOOD)
        W.post(p, x, z, top, base + 0.28, 0.3, PAL['post_dark'], WOOD, bevel=0.025)
        p.box((x, top + 0.08, z), (0.4, 0.16, 0.4), PAL['trim_dark'], WOOD)
        ca, sa = math.cos(q['rot']), -math.sin(q['rot'])
        ax, az = x + ca * 0.95, z + sa * 0.95
        W.beam(p, (x + ca * 0.15, top - 0.12, z + sa * 0.15), (ax + ca * 0.05, top - 0.12, az + sa * 0.05), 0.08,
               0.08, iron, IRON)
        W.beam(p, (x + ca * 0.15, top - 0.62, z + sa * 0.15), (x + ca * 0.62, top - 0.14, z + sa * 0.62), 0.06,
               0.06, iron, IRON)
        p.box((ax, top - 0.3, az), (0.04, 0.3, 0.04), iron, IRON)
        W.lantern(p, ax, top - 0.7, az, 0.36)
    for x, y, z in newel_tops:
        W.lantern(p, x, y + 0.26, z, 0.3)
    return p


def build_cargo():
    # W.build_cargo reads W's own props: the same recipe over this wharf's
    p = Piece('WharfCargo', wear=0.08, gradient=0.12)
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'crateStack':
            hw, hd = q['hw'], q['hd']
            s = min(hw * 2, hd) * 0.96
            # two crates side by side along the stack's local z, a third on top
            lz = (math.sin(q['rot']), math.cos(q['rot']))  # local +z in model x, z (three.js yaw)
            for sgn, col, yaw in ((-1, 1, 0.05), (1, 2, -0.08)):
                cx, cz = x + lz[0] * sgn * hd / 2, z + lz[1] * sgn * hd / 2
                W.crate(p, cx, base, cz, s, q['rot'] + yaw, pick(PAL['plank'], col))
            W.crate(p, x, base + s, z, s * 0.85, q['rot'] + 0.3, pick(PAL['plank'], 3))
        elif k == 'barrel':
            r, h = q['r'] * 0.95, q['height']
            p.sweep([(x, base, z), (x, base + h * 0.5, z), (x, base + h, z)], r, r, pick(PAL['plank'], int(abs(z) * 10)),
                    sides=10, radii=[r * 0.84, r, r * 0.84])
            p.cylinder((x, base + h - 0.01, z), (x, base + h + 0.02, z), r * 0.8, PAL['trim_dark'], WOOD, sides=10)
        elif k == 'bollard':
            p.cylinder((x, base - 0.02, z), (x, base + q['height'] - 0.16, z), q['r'] * 0.85, PAL['post_dark'], WOOD,
                       sides=10)
            p.cylinder((x, base + q['height'] - 0.16, z), (x, base + q['height'], z), q['r'], PAL['iron'], IRON,
                       sides=10)
    return p


def build_trim():
    p = Piece('WharfTrim', wear=0.05, gradient=0.06)
    iron, hi = PAL['iron'], PAL['iron_hi']
    top = UNDER - 0.1
    # fender piles down the berth face (where the ship lies) and the head's ends, a mooring
    # ring between each pair
    face = [(HEAD['a1'] + 0.12, c) for c in rows(HEAD['c0'] + 0.4, HEAD['c1'] - 0.4, 1.35)]
    for i, (a, c) in enumerate(face):
        x, z = W2(a, c)
        bed = max(ground(x, z), -0.9)
        p.box((x, (top + bed) / 2, z), (0.22, top - bed, 0.22), PAL['pile'], WOOD, yaw=ROT)
        if i + 1 < len(face):
            xr, zr = W2(HEAD['a1'] + 0.05, (c + face[i + 1][1]) / 2)
            p.ring((xr, top - 0.3, zr), 0.14, 0.035, iron, segments=10, axis=(DA[0], 0, DA[1]), mat=IRON, depth=0.035)
    # bolt heads along the fascia of the whole outline
    for seg in outline():
        a0, c0, a1, c1 = inward(*seg, -0.01)
        length = math.hypot(a1 - a0, c1 - c0)
        m = max(1, int(length / 1.1))
        for i in range(m + 1):
            t = (0.2 + (length - 0.4) * i / m) / length if length > 0.4 else 0.5
            x, z = W2(a0 + (a1 - a0) * t, c0 + (c1 - c0) * t)
            p.box((x, UNDER - 0.18, z), (0.09, 0.09, 0.09), hi, IRON, yaw=ROT)
    # iron on the cargo: barrel bands, bollard rings, crate battens
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'barrel':
            r = q['r'] * 0.95
            for yy in (0.2, q['height'] - 0.2):
                p.ring((x, base + yy, z), r * 0.9 + 0.01, 0.06, iron, segments=10, axis=(0, 1, 0), mat=IRON, depth=0.03)
        elif k == 'bollard':
            p.ring((x, base + 0.35, z), q['r'] * 0.87, 0.07, iron, segments=10, axis=(0, 1, 0), mat=IRON, depth=0.03)
    return p


def build_clutter():
    p = Piece('WharfClutter', wear=0.06, gradient=0.08)
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'bollard':
            # a coiled mooring line on the deck beside each bollard, inboard of it
            cx, cz = x - DA[0] * 0.75, z - DA[1] * 0.75
            W.coil(p, cx, base, cz, 0.3)
        elif k == 'crateStack' and q['base'] > 0 and x < 5:
            # sacks and a bucket beside the root's stack
            sx, sz = W2(1.3, -0.35)
            p.rock_blob((sx, base + 0.26, sz), (0.6, 0.5, 0.5), PAL['rope_dark'], ROPE, jitter=0.12)
            bx, bz = W2(2.55, -2.15)
            p.cylinder((bx, base, bz), (bx, base + 0.38, bz), 0.2, PAL['post'], WOOD, sides=8, r1=0.24)
    # a small crate atop the head's stack, and a net heaped on the north corner by the barrel
    stack = next(q for q in PROPS if q['kind'] == 'crateStack' and q['x'] > 20)
    p.box((stack['x'], stack['base'] + stack['height'] + 0.2, stack['z']), (0.42, 0.4, 0.42), PAL['plank'][0], WOOD,
          bevel=0.02, yaw=0.5)
    nx, nz = W2(28.0, 4.6)
    p.rock_blob((nx, LEVEL + 0.12, nz), (1.1, 0.3, 0.8), PAL['net'], ROPE, jitter=0.2)
    # two oars leaning on the root's rail
    for dc in (0.0, 0.35):
        x0, z0 = W2(0.75, 0.4 + dc)
        W.beam(p, (x0, LEVEL + 0.05, z0), (x0 - DA[0] * 0.2, LEVEL + 2.2, z0 - DA[1] * 0.2), 0.08, 0.08, PAL['post'])
    return p


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
CRITICAL = ('WharfDeck', 'WharfFrame', 'WharfFlight', 'WharfRails', 'WharfLanterns', 'WharfCargo')
TRIM = ('WharfTrim',)
OPTIONAL = ('WharfClutter',)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = W.make_materials()
    root = empty('WickharborWharf_ROOT', None, display='ARROWS', size=2.0)
    pieces = {}
    rails, newel_tops = build_rails()
    for piece in (build_deck(), build_frame(), build_flight(), rails, build_lanterns(newel_tops), build_cargo(),
                  build_trim(), build_clutter()):
        pieces[piece.name] = piece.finish(mats, root)
    root['wickharborWharf'] = {
        'origin': [LAYOUT['origin']['x'], LAYOUT['origin']['z']],
        'rot': ROT,
        'layoutVersion': LAYOUT['version'],
        'tiers': {'low': list(CRITICAL), 'medium': list(TRIM), 'high': list(OPTIONAL)},
        'level': LEVEL,
        'decks': {d['id']: [d['near'], d['far']] for d in LAYOUT['decks']},
        'railHeight': RAIL_H,
    }
    return dict(root=root, pieces=pieces, mats=mats)


def report(objs):
    total = 0
    for name, obj in objs['pieces'].items():
        n = triangles(obj)
        total += n
        print(f'PIECE {name} triangles {n}')
    print(f'TRIANGLES total {total}')
    print(f"TRIANGLES low tier {sum(triangles(objs['pieces'][n]) for n in CRITICAL)}")
    return total


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


if __name__ == '__main__':
    objs = build_scene()
    report(objs)
    W.export(os.path.join(HERE, 'wickharbor_wharf_source.glb'), objs)
    if arg('--save'):
        import wharf_scene  # noqa: E402

        wharf_scene.stage(objs, arg('--context'))
        wharf_scene.save(arg('--save'))
