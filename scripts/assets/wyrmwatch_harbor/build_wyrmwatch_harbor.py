"""The Wyrmwatch cliff harbor: the built waterfront at the Drakelands ferry berth.

  npx tsx scripts/assets/wyrmwatch_harbor/layout.ts        (refresh layout.json from the sim)
  blender --background --python scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py -- \
      [--save FILE.blend --context TERRAIN.json]

Writes wyrmwatch_harbor_source.glb beside this file. `node scripts/assets/wyrmwatch_harbor/build.mjs`
ships it (validate, fingerprint, meshopt) to public/models/props/wyrmwatch_harbor.glb, and
src/render/wyrmwatch_harbor.ts places it at the berth.

Every walkable plank, rail and solid here stands where the sim says it does: the decks, rails
and props come from src/sim/content/wyrmwatch_harbor.ts through layout.json (model frame:
yards, origin on the waterline at the content's WYRMWATCH_HARBOR_ORIGIN, +x east, +y up, +z
the world's +z), and every pile, post and wall runs down into the terrain under it (the
layout's height grid), so nothing floats. The ferry pier itself is not modelled here (the game
draws it from its deck); this model meets it at its root.

Hierarchy (the runtime keeps or sheds these by graphics tier; the sim collides with what the
low tier keeps, so every solid is in a low-tier part):

  WyrmwatchHarbor_ROOT     root, placed on the waterline at the harbor origin
    QuayDecks              the north yard and the south quay: planks, fascia, piles, bracing,
                           the stone walls on their landward sides
    StairFlights           both flights: treads, risers, stringers, their posts and bracing
    Landings               the turning landing and the top landing on their posts
    Railings               every rail, its posts and newels
    HarborGate             the post-and-lintel gate at the head of the stair, anchor crest
    Lanterns               every lantern post, newel lantern and gate lantern (the landmarks)
    House*                 the Harbormaster's House on stilts at the north end, walk-in: its
                           frame, four walls and roof (split so the runtime can cut away the
                           ones between the camera and a player indoors), its furnishings,
                           and its high-tier clutter (build_harbor_house.py)
    Cargo                  crate stacks, barrels and bollards (all collide)
    HarborTrim             medium tier and up: fenders, iron bands, bolts, straps, battens
    HarborClutter          high tier and up: rope coils, the net, baskets, oars, a bucket, a sack
    PathStoneA/B/C         three flagstones the runtime lays along the path to Wyrmwatch
                           (never drawn where they stand in the model)

Everything is original procedural work for this project, in the Eastbrook ferry's palette and
the harbor route marker's materials, so the harbor belongs to the ship and the sign.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from shiplib import EDGE, FLAT, GLOW, IRON, ROPE, WOOD, P, Piece, empty, scale_color, triangles  # noqa: E402

import build_harbor_house as H  # noqa: E402

STONE = 2  # shiplib's third slot (its cloth index) carries the stone here

with open(os.path.join(HERE, 'layout.json'), encoding='utf8') as fh:
    LAYOUT = json.load(fh)

# ---------------------------------------------------------------------------
# Palette: the ferry's woods, iron, brass and blue, plus stone and roof shingle
# ---------------------------------------------------------------------------
PAL = dict(
    plank=[(0.66, 0.45, 0.29), (0.62, 0.42, 0.27), (0.69, 0.47, 0.3), (0.64, 0.435, 0.28)],
    deck=[(0.6, 0.43, 0.29), (0.56, 0.4, 0.27), (0.63, 0.45, 0.3), (0.58, 0.415, 0.28)],
    post=(0.5, 0.34, 0.22),
    post_dark=(0.42, 0.28, 0.18),
    pile=(0.36, 0.26, 0.18),
    trim_dark=(0.54, 0.37, 0.24),
    seam=(0.3, 0.21, 0.14),
    iron=(0.36, 0.36, 0.38),
    iron_hi=(0.52, 0.52, 0.54),
    brass=(0.82, 0.63, 0.32),
    accent=(0.2, 0.36, 0.7),
    accent_dark=(0.15, 0.27, 0.53),
    ivory=(0.93, 0.88, 0.75),
    rope=(0.72, 0.6, 0.43),
    rope_dark=(0.56, 0.46, 0.32),
    net=(0.52, 0.47, 0.38),
    glow=(1.0, 0.78, 0.46),
    stone=[(0.56, 0.52, 0.47), (0.5, 0.47, 0.43), (0.6, 0.55, 0.49), (0.53, 0.49, 0.45)],
    stone_dark=(0.42, 0.39, 0.36),
    path=[(0.62, 0.58, 0.52), (0.56, 0.53, 0.48), (0.66, 0.61, 0.54)],
    shingle=[(0.46, 0.25, 0.18), (0.41, 0.22, 0.16), (0.5, 0.28, 0.2)],
    wall=[(0.6, 0.44, 0.3), (0.55, 0.4, 0.27), (0.63, 0.46, 0.31)],
)

MATERIAL_SPECS = (
    # name, roughness, metallic, emission; indexed like shiplib (WOOD, IRON, STONE, ROPE, GLOW)
    ('HarborWood', 0.82, 0.0, 0.0),
    ('HarborIron', 0.5, 0.4, 0.0),
    ('HarborStone', 0.92, 0.0, 0.0),
    ('HarborRope', 0.95, 0.0, 0.0),
    ('HarborGlow', 0.5, 0.0, 2.2),
)

PLAYER_H = 2.6
RAIL_H = LAYOUT['railHeight']
PLANK_T = 0.16
BURY = 0.8          # piles and posts run this far into the ground under them
GATE_TOP = 5.8      # the lintel's top over the top landing
DECKS = {d['id']: d for d in LAYOUT['decks']}
TOP = DECKS['topLanding']['near']
PROPS = LAYOUT['props']


def pick(seq, i):
    return seq[i % len(seq)]


# ---------------------------------------------------------------------------
# Terrain and deck geometry (model frame)
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


def axes(d):
    """A deck's along and across unit vectors (the sim's galeDeckSurfaceAt frame)."""
    a = (math.sin(d['rot']), math.cos(d['rot']))
    c = (math.cos(d['rot']), -math.sin(d['rot']))
    return a, c


def at(d, along, across):
    a, c = axes(d)
    return (d['x'] + a[0] * along + c[0] * across, d['z'] + a[1] * along + c[1] * across)


def surf(d, along):
    t = min(1.0, max(0.0, (along + d['hl']) / (2 * d['hl'])))
    return d['near'] + (d['far'] - d['near']) * t


def pt(d, along, across, dy=0.0):
    x, z = at(d, along, across)
    return (x, surf(d, along) + dy, z)


def xyz(d, along, across, y):
    x, z = at(d, along, across)
    return (x, y, z)


def post(p, x, z, top, bottom, w, color, mat=WOOD, bevel=0.0):
    h = top - bottom
    if h <= 0.02:
        return
    p.box((x, bottom + h / 2, z), (w, h, w), color, mat, bevel=bevel)


def beam(p, a, b, w, h, color, mat=WOOD):
    p.beam([a, b], w, h, color, mat, up=(0, 1, 0))


def slab(p, poly, z0, z1, color, mat=WOOD, side_color=None, tag=FLAT):
    """A convex polygon in the game XY plane (counter-clockwise from +z), extruded z0..z1."""
    bm = p.bm
    back = [bm.verts.new(P(x, y, z0)) for x, y in poly]
    front = [bm.verts.new(P(x, y, z1)) for x, y in poly]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    p.paint(faces, color, mat, tag)
    sides = []
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        sides.append(bm.faces.new((back[i], back[j], front[j], front[i])))
    p.paint(sides, side_color if side_color is not None else scale_color(color, 0.9), mat, EDGE)
    p.closed.extend(faces + sides)


def lantern(p, x, y, z, s=0.3):
    """The ferry's lantern: iron frame, warm crossed panes, tapered cap, foot plate.
    (x, y, z) is the lantern body's centre."""
    iron = PAL['iron']
    p.box((x, y, z), (s * 1.1, s * 1.35, s * 1.1), iron, IRON, bevel=0.02)
    p.box((x, y, z), (s * 0.8, s * 1.1, s * 1.18), PAL['glow'], GLOW)
    p.box((x, y, z), (s * 1.18, s * 1.1, s * 0.8), PAL['glow'], GLOW)
    p.box((x, y + s * 0.82, z), (s * 0.75, s * 0.32, s * 0.75), iron, IRON, taper=0.4)
    p.box((x, y - s * 0.74, z), (s * 0.7, s * 0.12, s * 0.7), iron, IRON, taper=0.8)


def pile_rows(a0, a1, spacing):
    n = max(1, int(math.ceil((a1 - a0) / spacing)))
    return [a0 + (a1 - a0) * i / n for i in range(n + 1)]


def brace(p, xa, za, xb, zb, hi, lo_a, lo_b, i):
    """One diagonal brace between two neighbouring posts, alternating direction."""
    if i % 2 == 0:
        beam(p, (xa, hi, za), (xb, lo_b, zb), 0.2, 0.22, PAL['post_dark'])
    else:
        beam(p, (xa, lo_a, za), (xb, hi, zb), 0.2, 0.22, PAL['post_dark'])


# ---------------------------------------------------------------------------
# Quays: the north yard and the south quay
# ---------------------------------------------------------------------------
PIER = LAYOUT['pier']
PIER_Z0 = PIER['z'] - PIER['hw']   # the pier's north edge (model z)
PIER_Z1 = PIER['z'] + PIER['hw']   # its south edge
# the model stops each quay's planks at the pier's edge (the sim deck laps under it)
QUAY_VISUAL = {
    'northYard': (-DECKS['northYard']['hl'], PIER_Z0 - DECKS['northYard']['z']),
    'southQuay': (PIER_Z1 - DECKS['southQuay']['z'], DECKS['southQuay']['hl']),
}
SEA_SIDE = 1  # both quays face the water on their +x side


def plank_run(p, d, a0, a1, width, top, seed=0):
    """Planks laid across a deck from along a0 to a1, top at `top` (level decks)."""
    n = max(1, int(round((a1 - a0) / 0.55)))
    step = (a1 - a0) / n
    for i in range(n):
        a = a0 + step * (i + 0.5)
        x, z = at(d, a, 0.0)
        lift = (p.rng.random() - 0.5) * 0.01
        p.box((x, top - PLANK_T / 2 + lift, z), (width, PLANK_T, step - 0.05), pick(PAL['deck'], i + seed), WOOD,
              yaw=d['rot'])


def fascia(p, d, a0, a1, under):
    """Heavy edge beams dressing the plank ends, both long sides and both ends."""
    hw = d['hw']
    for s in (1, -1):
        beam(p, xyz(d, a0, s * (hw - 0.14), under - 0.18), xyz(d, a1, s * (hw - 0.14), under - 0.18), 0.28, 0.38,
             PAL['post'])
    for a in (a0 + 0.14, a1 - 0.14):
        beam(p, xyz(d, a, -hw + 0.02, under - 0.18), xyz(d, a, hw - 0.02, under - 0.18), 0.28, 0.38, PAL['post'])


def piles_and_bracing(p, d, a0, a1, top, across_rows, spacing=2.3, pile_w=0.42):
    hw = d['hw']
    under = top - PLANK_T
    rows = pile_rows(a0 + 0.3, a1 - 0.3, spacing)
    for a in rows:
        for c in across_rows:
            x, z = at(d, a, c)
            post(p, x, z, under - 0.1, foot(x, z), pile_w, PAL['pile'])
        beam(p, xyz(d, a, -hw + 0.25, under - 0.25), xyz(d, a, hw - 0.25, under - 0.25), 0.3, 0.3, PAL['post_dark'])
    for c in (across_rows[0], across_rows[-1]):
        for i in range(len(rows) - 1):
            xa, za = at(d, rows[i], c)
            xb, zb = at(d, rows[i + 1], c)
            ga, gb = max(ground(xa, za), -1.0) + 0.25, max(ground(xb, zb), -1.0) + 0.25
            hi = under - 0.5
            if hi - max(ga, gb) < 1.1:
                continue
            brace(p, xa, za, xb, zb, hi, ga, gb, i)


def stone_wall(p, x0, z0, x1, z1, top, thick, seed=0):
    """A coursed stone wall from the ground up to `top` along a straight line (the quays'
    landward faces): blocks in staggered courses, each course stopping at the ground."""
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
    # a dressed coping course on top
    p.box(((x0 + x1) / 2, top + 0.06, (z0 + z1) / 2), (thick + 0.14, 0.12, length), PAL['stone_dark'], STONE, yaw=yaw)


def build_quays():
    p = Piece('QuayDecks', wear=0.07, gradient=0.14)
    for name in ('northYard', 'southQuay'):
        d = DECKS[name]
        a0, a1 = QUAY_VISUAL[name]
        top = d['near']
        plank_run(p, d, a0, a1, d['hw'] * 2 - 0.02, top, seed=3 if name == 'southQuay' else 0)
        fascia(p, d, a0, a1, top - PLANK_T)
        hw = d['hw']
        piles_and_bracing(p, d, a0, a1, top, [-(hw - 0.3), 0.0, hw - 0.3])
    # the stone walls on the landward sides: the north yard's back against the beach, the
    # south quay's side against the cliff foot (under the rail, dressing the drop)
    ny, sq = DECKS['northYard'], DECKS['southQuay']
    stone_wall(p, ny['x'] - ny['hw'] - 0.2, ny['z'] - ny['hl'], ny['x'] - ny['hw'] - 0.2, PIER_Z0,
               ny['near'] - PLANK_T - 0.12, 0.7, seed=1)
    stone_wall(p, sq['x'] - sq['hw'] - 0.1, PIER_Z1, sq['x'] - sq['hw'] - 0.1, sq['z'] + sq['hl'],
               sq['near'] - PLANK_T - 0.12, 0.6, seed=2)
    return p


# ---------------------------------------------------------------------------
# Stair flights
# ---------------------------------------------------------------------------
RISERS = 10
FLIGHT_CLIP = 0.2   # each flight's drawn run stops where the deck it joins begins


def flight_along_at(d, y):
    """The along position where a flight's ramp reaches height y."""
    t = (y - d['near']) / (d['far'] - d['near'])
    return -d['hl'] + t * 2 * d['hl']


def build_flights():
    p = Piece('StairFlights', wear=0.07, gradient=0.14)
    for name in ('flightOne', 'flightTwo'):
        d = DECKS[name]
        hw = d['hw']
        rise = (d['far'] - d['near']) / RISERS
        a0, a1 = -d['hl'] + FLIGHT_CLIP, d['hl'] - FLIGHT_CLIP
        inner = hw * 2 - 0.62  # treads run between the stringers
        # tread k covers the ramp heights within half a riser of its top, so a body
        # walking the sim's ramp never floats or sinks more than half a riser
        edges = [a0] + [flight_along_at(d, d['near'] + (k + 0.5) * rise) for k in range(RISERS)] + [a1]
        for k in range(RISERS + 1):
            lo, hi = max(edges[k], a0), min(edges[k + 1], a1)
            if hi - lo < 0.05:
                continue
            ytop = d['near'] + k * rise
            x, z = at(d, (lo + hi) / 2, 0)
            p.box((x, ytop - 0.07, z), (inner, 0.14, (hi - lo) + 0.05), pick(PAL['plank'], k), WOOD, yaw=d['rot'])
            if 0 < k:
                # the nosing on the tread's downhill edge, and the riser board under it
                xn, zn = at(d, lo + 0.05, 0)
                p.box((xn, ytop - 0.05, zn), (inner, 0.1, 0.12), PAL['trim_dark'], WOOD, yaw=d['rot'])
                xr, zr = at(d, lo, 0)
                p.box((xr, ytop - rise / 2 - 0.07, zr), (inner - 0.02, rise, 0.06), PAL['seam'], WOOD, yaw=d['rot'])
        # the two stringers, their top edge a hand above the ramp line
        for s in (1, -1):
            c = s * (hw - 0.16)
            beam(p, pt(d, a0 - 0.1, c, -0.14), pt(d, a1 + 0.1, c, -0.14), 0.3, 0.6, PAL['post'])
        # posts under the stringers down to the rock or the sea bed, a cross beam and bracing
        rows = pile_rows(a0 + 0.35, a1 - 0.35, 2.3)
        for a in rows:
            y = surf(d, a) - 0.48
            for s in (1, -1):
                x, z = at(d, a, s * (hw - 0.16))
                post(p, x, z, y, foot(x, z), 0.36, PAL['pile'])
            beam(p, pt(d, a, -hw + 0.2, -0.62), pt(d, a, hw - 0.2, -0.62), 0.26, 0.26, PAL['post_dark'])
        for s in (1, -1):
            c = s * (hw - 0.16)
            for i in range(len(rows) - 1):
                xa, za = at(d, rows[i], c)
                xb, zb = at(d, rows[i + 1], c)
                ya, yb = surf(d, rows[i]) - 0.8, surf(d, rows[i + 1]) - 0.8
                ga, gb = max(ground(xa, za), -1.0) + 0.3, max(ground(xb, zb), -1.0) + 0.3
                if min(ya - gb, yb - ga) < 1.0:
                    continue
                if i % 2 == 0:
                    beam(p, (xa, ya, za), (xb, gb, zb), 0.2, 0.22, PAL['post_dark'])
                else:
                    beam(p, (xa, ga, za), (xb, yb, zb), 0.2, 0.22, PAL['post_dark'])
    return p


# ---------------------------------------------------------------------------
# Landings
# ---------------------------------------------------------------------------
def build_landings():
    p = Piece('Landings', wear=0.07, gradient=0.14)
    for name in ('turnLanding', 'topLanding'):
        d = DECKS[name]
        top = d['near']
        hl, hw = d['hl'], d['hw']
        plank_run(p, d, -hl, hl, hw * 2 - 0.02, top, seed=5 if name == 'topLanding' else 2)
        under = top - PLANK_T
        fascia(p, d, -hl, hl, under)
        # posts: a grid across the landing, every one to the rock, tied by beams both ways
        cols = pile_rows(-hw + 0.3, hw - 0.3, 2.4)
        rows = [-hl + 0.3, hl - 0.3]
        for a in rows:
            for c in cols:
                x, z = at(d, a, c)
                post(p, x, z, under - 0.1, foot(x, z), 0.42, PAL['pile'])
            beam(p, xyz(d, a, -hw + 0.25, under - 0.3), xyz(d, a, hw - 0.25, under - 0.3), 0.3, 0.3, PAL['post_dark'])
        for c in cols:
            beam(p, xyz(d, rows[0], c, under - 0.3), xyz(d, rows[1], c, under - 0.3), 0.26, 0.28, PAL['post_dark'])
        # X bracing on the faces where the posts stand tall
        hi = under - 0.55
        for a in rows:
            for i in range(len(cols) - 1):
                xa, za = at(d, a, cols[i])
                xb, zb = at(d, a, cols[i + 1])
                ga, gb = max(ground(xa, za), -1.0) + 0.3, max(ground(xb, zb), -1.0) + 0.3
                if hi - max(ga, gb) < 1.2:
                    continue
                beam(p, (xa, hi, za), (xb, gb, zb), 0.2, 0.22, PAL['post_dark'])
                beam(p, (xa, ga, za), (xb, hi, zb), 0.2, 0.22, PAL['post_dark'])
        for c in (cols[0], cols[-1]):
            xa, za = at(d, rows[0], c)
            xb, zb = at(d, rows[1], c)
            ga, gb = max(ground(xa, za), -1.0) + 0.3, max(ground(xb, zb), -1.0) + 0.3
            if hi - max(ga, gb) < 1.2:
                continue
            beam(p, (xa, hi, za), (xb, gb, zb), 0.2, 0.22, PAL['post_dark'])
    return p


# ---------------------------------------------------------------------------
# Railings
# ---------------------------------------------------------------------------
NEWEL_TOP = 0.2     # newels stand this far over the handrail
# rail corners that carry a newel lantern: (rail index, corner index)
NEWEL_LANTERNS = {(0, 4), (0, 5), (0, 7), (0, 12), (1, 1), (1, 2), (1, 3)}


def simplify(points, eps=0.02):
    """Drop samples that lie on the straight line between their neighbours (3D)."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        a, b, c = Vector(out[-1]), Vector(points[i]), Vector(points[i + 1])
        ac = c - a
        if ac.length < 1e-6:
            continue
        t = max(0.0, min(1.0, (b - a).dot(ac) / ac.length_squared))
        if (a + ac * t - b).length > eps:
            out.append(points[i])
    out.append(points[-1])
    return out


def build_rails():
    p = Piece('Railings', wear=0.06, gradient=0.12)
    lanterns = []
    for ri, rail in enumerate(LAYOUT['rails']):
        for ci, c in enumerate(rail['corners']):
            top = c['y'] + RAIL_H + NEWEL_TOP
            post(p, c['x'], c['z'], top, c['y'] - 0.05, 0.28, PAL['post_dark'])
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
            # balusters between the newels, each on the planks under it
            for k in range(1, n):
                idx = k / n * (len(pts) - 1)
                i0 = min(int(idx), len(pts) - 2)
                f = idx - i0
                x = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * f
                y = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * f
                z = pts[i0][2] + (pts[i0 + 1][2] - pts[i0][2]) * f
                post(p, x, z, y + RAIL_H - 0.05, y - 0.05, 0.15, PAL['post'])
            # the handrail and the mid rail, bending where a flight meets a landing
            line = simplify(pts)
            for lift, w, h, col in ((RAIL_H - 0.02, 0.17, 0.11, PAL['trim_dark']), (0.62, 0.1, 0.09, PAL['post'])):
                p.beam([(x, y + lift, z) for x, y, z in line], w, h, col, WOOD, up=(0, 1, 0))
    return p, lanterns


# ---------------------------------------------------------------------------
# The harbor gate
# ---------------------------------------------------------------------------
GATE_POSTS = [q for q in PROPS if q['kind'] == 'gatePost']


def anchor_crest(p, cx, cy, cz):
    """The ferry line's anchor roundel standing on the lintel, faces toward +x and -x."""
    r, t = 0.66, 0.18
    p.cylinder((cx - t / 2, cy, cz), (cx + t / 2, cy, cz), r, PAL['accent'], WOOD, sides=20, soft=False)
    p.ring((cx, cy, cz), r + 0.02, t + 0.06, PAL['brass'], segments=20, axis=(1, 0, 0), mat=IRON, depth=0.09)
    col = PAL['ivory']
    for s in (1, -1):
        x = cx + s * (t / 2 + 0.025)
        p.box((x, cy - 0.02, cz), (0.05, 0.62, 0.1), col, WOOD)                 # shank
        p.box((x, cy + 0.2, cz), (0.05, 0.08, 0.46), col, WOOD)                 # stock
        p.ring((x, cy + 0.36, cz), 0.075, 0.05, col, segments=8, axis=(1, 0, 0), depth=0.05)
        arc = []
        for k in range(9):
            a = math.radians(205 + (335 - 205) * k / 8)
            arc.append((x, cy - 0.06 + math.sin(a) * 0.28, cz + math.cos(a) * 0.28))
        p.beam(arc, 0.05, 0.09, col, WOOD, up=(1, 0, 0))
        for zz in (-0.29, 0.29):
            p.box((x, cy - 0.16, cz + zz), (0.05, 0.1, 0.14), col, WOOD, taper=0.3)


def build_gate():
    p = Piece('HarborGate', wear=0.06, gradient=0.12)
    zs = sorted(q['z'] for q in GATE_POSTS)
    gx = GATE_POSTS[0]['x']
    lintel_top = TOP + GATE_TOP
    for q in GATE_POSTS:
        x, z = q['x'], q['z']
        plinth_top = TOP + 0.6
        # a stone plinth from the rock up past the planks, a dressed cap
        post(p, x, z, plinth_top, ground(x, z) - 0.5, 0.92, pick(PAL['stone'], int(z * 7)), STONE)
        p.box((x, plinth_top + 0.07, z), (1.04, 0.14, 1.04), PAL['stone_dark'], STONE, bevel=0.03)
        # the timber post, chamfered
        post(p, x, z, lintel_top - 0.5, plinth_top + 0.14, 0.62, PAL['post'], WOOD, bevel=0.04)
    # the lintel: a heavy beam over both posts, a capping board and stepped carved ends
    z0, z1 = zs[0] - 1.0, zs[1] + 1.0
    zm = (zs[0] + zs[1]) / 2
    p.box((gx, lintel_top - 0.3, zm), (0.62, 0.6, z1 - z0), PAL['post_dark'], WOOD, bevel=0.04)
    p.box((gx, lintel_top + 0.07, zm), (0.8, 0.14, z1 - z0 + 0.3), PAL['trim_dark'], WOOD, bevel=0.02)
    for s, ze in ((-1, z0), (1, z1)):
        p.box((gx, lintel_top - 0.72, ze - s * 0.18), (0.5, 0.26, 0.36), PAL['post_dark'], WOOD)
    # the tie beam under it, and knee braces from each post up to the lintel
    p.box((gx, lintel_top - 1.35, zm), (0.44, 0.38, zs[1] - zs[0]), PAL['post'], WOOD)
    for s, zp in ((1, zs[0]), (-1, zs[1])):
        beam(p, (gx, lintel_top - 2.3, zp + s * 0.31), (gx, lintel_top - 0.62, zp + s * 1.35), 0.26, 0.22, PAL['post'])
        beam(p, (gx, lintel_top - 1.9, zp - s * 0.31), (gx, lintel_top - 0.62, zp - s * 1.0), 0.26, 0.22, PAL['post'])
    anchor_crest(p, gx, lintel_top + 0.14 + 0.72, zm)
    return p, [(gx, lintel_top - 1.25, zs[0] - 0.62), (gx, lintel_top - 1.25, zs[1] + 0.62)]


# ---------------------------------------------------------------------------
# Lanterns (every one a landmark: the low tier keeps them all)
# ---------------------------------------------------------------------------
def build_lanterns(newel_tops, gate_hangs):
    p = Piece('Lanterns', wear=0.04, gradient=0.08)
    iron = PAL['iron']
    for q in PROPS:
        if q['kind'] != 'lanternPost':
            continue
        x, z, base = q['x'], q['z'], q['base']
        top = base + q['height'] - 0.3
        post(p, x, z, base + 0.32, base - 0.4, 0.56, pick(PAL['stone'], int(abs(x) * 3)), STONE)
        post(p, x, z, top, base + 0.3, 0.3, PAL['post_dark'], WOOD, bevel=0.025)
        p.box((x, top + 0.08, z), (0.4, 0.16, 0.4), PAL['trim_dark'], WOOD)
        # the arm along local +x (turned by the prop's yaw), its stay, and the lantern
        ca, sa = math.cos(q['rot']), -math.sin(q['rot'])
        ax, az = x + ca * 0.95, z + sa * 0.95
        beam(p, (x + ca * 0.15, top - 0.12, z + sa * 0.15), (ax + ca * 0.05, top - 0.12, az + sa * 0.05), 0.08, 0.08,
             iron, IRON)
        beam(p, (x + ca * 0.15, top - 0.62, z + sa * 0.15), (x + ca * 0.62, top - 0.14, z + sa * 0.62), 0.06, 0.06,
             iron, IRON)
        p.box((ax, top - 0.3, az), (0.04, 0.3, 0.04), iron, IRON)
        lantern(p, ax, top - 0.7, az, 0.36)
    for x, y, z in newel_tops:
        lantern(p, x, y + 0.26, z, 0.3)   # a squat lantern on the newel's cap
    for x, y, z in gate_hangs:
        p.box((x, y + 0.52, z), (0.05, 0.5, 0.05), iron, IRON)
        lantern(p, x, y, z, 0.4)
    return p


# ---------------------------------------------------------------------------
# Cargo and bollards (everything on the quays the sim collides with)
# ---------------------------------------------------------------------------
def crate(p, x, y, z, s, yaw, col):
    p.box((x, y + s / 2, z), (s, s, s), col, WOOD, bevel=0.03, yaw=yaw)


def build_cargo():
    p = Piece('Cargo', wear=0.08, gradient=0.12)
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'crateStack':
            hw, hd = q['hw'], q['hd']
            s = min(hw * 2, hd) * 0.96
            crate(p, x, base, z - hd / 2, s, 0.05, pick(PAL['plank'], 1))
            crate(p, x, base, z + hd / 2, s, -0.08, pick(PAL['plank'], 2))
            crate(p, x, base + s, z, s * 0.85, 0.3, pick(PAL['plank'], 3))
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


# ---------------------------------------------------------------------------
# Trim (medium tier and up)
# ---------------------------------------------------------------------------
def build_trim():
    p = Piece('HarborTrim', wear=0.05, gradient=0.06)
    iron, hi = PAL['iron'], PAL['iron_hi']
    # fender timbers down the quays' water faces, a mooring ring between each pair,
    # and bolt heads along both fascias
    for name in ('northYard', 'southQuay'):
        d = DECKS[name]
        a0, a1 = QUAY_VISUAL[name]
        top = d['near'] - PLANK_T
        n = max(1, int((a1 - a0) / 1.3))
        step = (a1 - a0 - 0.7) / n
        for i in range(n + 1):
            a = a0 + 0.35 + step * i
            x, z = at(d, a, SEA_SIDE * (d['hw'] + 0.1))
            bed = max(ground(x, z), -0.9)
            p.box((x, (top - 0.1 + bed) / 2, z), (0.2, top - 0.1 - bed, 0.22), PAL['pile'], WOOD)
            if i < n:
                xr, zr = at(d, a + step / 2, SEA_SIDE * (d['hw'] + 0.06))
                p.ring((xr, top - 0.35, zr), 0.14, 0.035, iron, segments=10, axis=(1, 0, 0), mat=IRON, depth=0.035)
        for side in (1, -1):
            m = max(1, int((a1 - a0) / 1.1))
            for i in range(m + 1):
                a = a0 + 0.2 + (a1 - a0 - 0.4) * i / m
                x, z = at(d, a, side * (d['hw'] + 0.01))
                p.box((x, top - 0.18, z), (0.06, 0.09, 0.09), hi, IRON)
    # iron bands on the barrels, battens on the crates, rings on the bollards, gate and door iron
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'barrel':
            r = q['r'] * 0.95
            for yy in (0.2, q['height'] - 0.2):
                p.ring((x, base + yy, z), r * 0.9 + 0.01, 0.06, iron, segments=10, axis=(0, 1, 0), mat=IRON, depth=0.03)
        elif k == 'bollard':
            p.ring((x, base + 0.35, z), q['r'] * 0.87, 0.07, iron, segments=10, axis=(0, 1, 0), mat=IRON, depth=0.03)
        elif k == 'crateStack':
            s = min(q['hw'] * 2, q['hd']) * 0.96
            for zz in (z - q['hd'] / 2, z + q['hd'] / 2):
                p.box((x, base + s * 0.5, zz), (s + 0.03, 0.08, 0.1), PAL['post_dark'], WOOD)
        elif k == 'gatePost':
            for yy in (TOP + 1.4, TOP + 4.6):
                p.box((x, yy, z), (0.68, 0.12, 0.68), iron, IRON)
    for zp in sorted(q['z'] for q in GATE_POSTS):
        p.box((GATE_POSTS[0]['x'], TOP + GATE_TOP - 0.3, zp), (0.66, 0.66, 0.14), iron, IRON)
    return p


# ---------------------------------------------------------------------------
# Clutter (high tier and up): nothing here is solid, so it keeps off the walkways
# ---------------------------------------------------------------------------
def coil(p, x, y, z, r=0.3, turns=2):
    for k in range(turns):
        p.ring((x, y + 0.05 + k * 0.08, z), r - k * 0.04, 0.08, PAL['rope'] if k % 2 == 0 else PAL['rope_dark'],
               segments=12, axis=(0, 1, 0), mat=ROPE, depth=0.08)


def build_clutter():
    p = Piece('HarborClutter', wear=0.06, gradient=0.08)
    for q in PROPS:
        k, x, z, base = q['kind'], q['x'], q['z'], q['base']
        if k == 'bollard':
            coil(p, x - 0.62, base, z + 0.1, 0.28)
        elif k == 'barrel' and z > 1.0:
            # a bucket and a sack beside the south quay's second barrel, against the wall
            p.cylinder((x + 0.05, base, z + 0.72), (x + 0.05, base + 0.38, z + 0.72), 0.2, PAL['post'], WOOD, sides=8,
                       r1=0.24)
            p.rock_blob((x - 0.05, base + 0.26, z + 1.2), (0.55, 0.5, 0.45), PAL['rope_dark'], ROPE, jitter=0.12)
        elif k == 'crateStack' and z < 0:
            # a small crate on top of the yard's stack
            p.box((x, base + q['height'] + 0.2, z + 0.1), (0.42, 0.4, 0.42), PAL['plank'][0], WOOD, bevel=0.02,
                  yaw=0.5)
    # rope coils on the landings' corners, against the rails
    for d, a, c in ((DECKS['turnLanding'], 1.3, -3.3), (DECKS['topLanding'], -1.6, 1.7)):
        x, z = at(d, a, c)
        coil(p, x, d['near'], z, 0.3, turns=3)
    # an old spare anchor propped against the south quay's cliff wall, by the stair foot
    sq = DECKS['southQuay']
    ax, az, y = sq['x'] - sq['hw'] + 0.45, sq['z'] + 3.65, sq['near']
    p.box((ax, y + 0.7, az), (0.1, 1.4, 0.12), PAL['iron'], IRON, roll=-0.25)
    p.box((ax + 0.18, y + 1.3, az), (0.1, 0.1, 0.7), PAL['iron'], IRON, roll=-0.25)
    arc = [(ax - 0.1, y + 0.1 + abs(math.cos(math.radians(a))) * 0.3, az + math.cos(math.radians(a)) * 0.45)
           for a in range(180, 361, 30)]
    p.beam(arc, 0.1, 0.1, PAL['iron'], IRON, up=(1, 0, 0))
    return p


# ---------------------------------------------------------------------------
# Path stones (the runtime lays them along the path, seated on the terrain)
# ---------------------------------------------------------------------------
STONE_SPECS = (('PathStoneA', 0.62, 0.5, 8), ('PathStoneB', 0.5, 0.44, 7), ('PathStoneC', 0.72, 0.42, 9))
STONE_TOP, STONE_BOTTOM = 0.08, -0.14


def build_stone(name, rx, rz, sides, seed):
    """One flagstone, centred on its own origin, its dressed top a little domed."""
    p = Piece(name, wear=0.05, gradient=0.3)
    ring = []
    for i in range(sides):
        a = math.tau * i / sides
        k = 0.82 + p.rng.random() * 0.25
        ring.append((math.cos(a) * rx * k, math.sin(a) * rz * k))
    bm = p.bm
    up = [bm.verts.new(P(x * 0.86, STONE_TOP + 0.03, z * 0.86)) for x, z in ring]
    rim = [bm.verts.new(P(x, STONE_TOP, z)) for x, z in ring]
    low = [bm.verts.new(P(x * 1.04, STONE_BOTTOM, z * 1.04)) for x, z in ring]
    faces = [bm.faces.new(list(reversed(up)))]
    for i in range(sides):
        j = (i + 1) % sides
        faces.append(bm.faces.new((up[j], up[i], rim[i], rim[j])))
        faces.append(bm.faces.new((rim[j], rim[i], low[i], low[j])))
    faces.append(bm.faces.new(low))
    p.paint(faces, pick(PAL['path'], seed), STONE)
    p.closed.extend(faces)
    return p


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
def make_materials():
    mats = []
    for name, rough, metal, emission in MATERIAL_SPECS:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


CRITICAL = ('QuayDecks', 'StairFlights', 'Landings', 'Railings', 'HarborGate', 'Lanterns', 'Cargo') + H.HOUSE_PARTS
TRIM = ('HarborTrim',)
OPTIONAL = ('HarborClutter',) + H.HOUSE_OPTIONAL
STONES = tuple(s[0] for s in STONE_SPECS)
# where the stone kit sits in the model (under the water off the north yard: never drawn in place)
STONE_KIT_AT = (5.0, -3.0, -14.0)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    root = empty('WyrmwatchHarbor_ROOT', None, display='ARROWS', size=2.0)
    pieces = {}
    rails, newel_tops = build_rails()
    gate, gate_hangs = build_gate()
    for piece in (build_quays(), build_flights(), build_landings(), rails, gate,
                  build_lanterns(newel_tops, gate_hangs), build_cargo(), build_trim(), build_clutter(),
                  *H.build(sys.modules[__name__])):
        pieces[piece.name] = piece.finish(mats, root)
    for i, (name, rx, rz, sides) in enumerate(STONE_SPECS):
        obj = build_stone(name, rx, rz, sides, i).finish(mats, root)
        obj.location = P(STONE_KIT_AT[0] + i * 1.6, STONE_KIT_AT[1], STONE_KIT_AT[2])
        pieces[name] = obj
    root['wyrmwatchHarbor'] = {
        'origin': [LAYOUT['origin']['x'], LAYOUT['origin']['z']],
        'layoutVersion': LAYOUT['version'],
        'tiers': {'low': list(CRITICAL), 'medium': list(TRIM), 'high': list(OPTIONAL)},
        'pathStones': list(STONES),
        'stoneTop': STONE_TOP,
        'decks': {d['id']: [d['near'], d['far']] for d in LAYOUT['decks']},
        'railHeight': RAIL_H,
        'gateTop': round(TOP + GATE_TOP, 4),
        'house': {
            'floor': LAYOUT['house']['floor'],
            'wallTop': LAYOUT['house']['wallTop'],
            'ridge': LAYOUT['house']['ridge'],
            'door': [LAYOUT['house']['door']['width'], LAYOUT['house']['door']['height']],
        },
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


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    root = objs['root']
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
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
    export(os.path.join(HERE, 'wyrmwatch_harbor_source.glb'), objs)
    if arg('--save'):
        import harbor_scene  # noqa: E402

        harbor_scene.stage(objs, arg('--context'))
        harbor_scene.save(arg('--save'))
