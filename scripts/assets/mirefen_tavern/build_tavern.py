"""The Mirefen tavern: the walk-in inn on the Fenbridge road in Mirefen Marsh.

  npx tsx scripts/assets/mirefen_tavern/layout.ts          (refresh layout.json from the sim)
  blender --background --python scripts/assets/mirefen_tavern/build_tavern.py -- \
      [--save FILE.blend --context TERRAIN.json [--render OUT_DIR]]

Writes mirefen_tavern_source.glb beside this file. `node scripts/assets/mirefen_tavern/build.mjs`
ships it (validate, fingerprint, meshopt) to public/models/props/mirefen_tavern.glb, and
src/render/mirefen_tavern.ts places it on the ground floor at the tavern's origin.

Everything the player walks on or bumps into stands where the sim says it does
(src/sim/content/mirefen_tavern.ts through layout.json): the model frame IS the tavern's local
frame (yards, origin on the ground floor at the hall's middle, +x to the right of a player
walking in, +y up, +z out of the front door), and the terrain under the building comes with
the layout so the stone base runs down into the ground and the porch steps stop on it.

Hierarchy (the runtime keeps or sheds these by graphics tier, and cuts the shell parts away
for the camera when a player is indoors; the sim collides with what the low tier keeps):

  MirefenTavern_ROOT      root, placed on the ground floor at the tavern's origin
    TavernFrame           never cut: the stone base, every floor (the hearth pit, the bar
                          platform, the bard's stage, the porch and its steps, the tower's
                          flagged nook), the round hearth and its copper hood and flue, the
                          bar's counters and the beam over it, the kitchen behind the hatch
    TavernFurnishings     tables, chairs, stools, benches, the settles and booths, the barrel
                          racks, the stage's chest
    TavernLights          the lanterns, the wheel chandelier, the wall sconces, the table and
                          bar candles, the stage's footlights, the nook's crown, the fires
    HallWallFront/FrontLeft/FrontRight/Back/Left/Right, HallPorch, HallRoof,
    WingWallEast/Back/West, WingRoof, TowerWall, TowerRoof, BarPillar
                          the shell: each fades or cuts away on its own (whatever hangs on a
                          wall belongs to that wall's part, so it goes with it); the front
                          wall is three parts (the gable over the door with the door's posts,
                          and either side of them) and the porch's canopy and the tankard sign
                          a fourth, so a camera behind any one ghosts it alone, never the whole
                          front; the bar's pillar stands inside the room
    TavernTrim            medium tier and up: iron straps and bands, the bar's foot rail,
                          braces and stretchers
    TavernClutter         high tier and up: mugs, plates, bottles, dice, the bard's lute and
                          drum, firewood, sacks, rugs, the kitchen's pots (nothing is solid)

There is no upper floor for players and no timber crosses the common room under the
hammer beams (HALL['truss']): the camera's air stays well under every roof timber.

Original procedural work for this project. The palette is the tavern's own: honey wood,
ochre plaster, blue-grey stone at the base and the hearth, a dark green slate roof, river
stones in the chimney, copper at the hood, and one accent colour, garnet, in the textiles.
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
from shiplib import EDGE, FLAT, P, PLAIN, Piece, empty, scale_color, triangles  # noqa: E402
from shiplib import G as game_of  # noqa: E402

WOOD, METAL, STONE, PLASTER, GLOW = 0, 1, 2, 3, 4

with open(os.path.join(HERE, 'layout.json'), encoding='utf8') as fh:
    LAYOUT = json.load(fh)

# faces kept out of the warm bake (the sky in the stair tower's slits)
SKY_FACES = set()

HALL = LAYOUT['hall']
WING = LAYOUT['wing']
TOWER = LAYOUT['tower']
# the wing's upper floor (the keeper's, never walked): the band on its walls outside
G = WING['floor']
PLAYER_H = 2.6

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
PAL = dict(
    honey=[(0.8, 0.6, 0.38), (0.76, 0.57, 0.35), (0.84, 0.64, 0.41), (0.78, 0.59, 0.37)],
    board=[(0.72, 0.56, 0.38), (0.68, 0.52, 0.35), (0.76, 0.6, 0.41), (0.7, 0.54, 0.36)],
    beam=(0.5, 0.36, 0.24),
    beam_dark=(0.38, 0.27, 0.18),
    sarking=(0.3, 0.2, 0.12),
    plaster=[(0.9, 0.76, 0.52), (0.87, 0.73, 0.5), (0.92, 0.79, 0.55)],
    plaster_in=[(0.9, 0.78, 0.57), (0.87, 0.75, 0.54)],
    stone=[(0.47, 0.51, 0.56), (0.43, 0.47, 0.52), (0.51, 0.54, 0.58), (0.45, 0.49, 0.53)],
    stone_dark=(0.34, 0.37, 0.41),
    flag=[(0.55, 0.57, 0.6), (0.5, 0.53, 0.56), (0.58, 0.59, 0.61)],
    river=[(0.58, 0.55, 0.5), (0.47, 0.49, 0.52), (0.63, 0.58, 0.51), (0.52, 0.5, 0.47),
           (0.42, 0.44, 0.47)],
    slate=[(0.2, 0.33, 0.26), (0.17, 0.29, 0.23), (0.23, 0.36, 0.29), (0.19, 0.31, 0.25)],
    slate_ridge=(0.14, 0.23, 0.19),
    garnet=(0.55, 0.1, 0.15),
    garnet_dark=(0.42, 0.07, 0.11),
    gold=(0.82, 0.64, 0.3),
    copper=(0.76, 0.52, 0.34),
    copper_dark=(0.56, 0.37, 0.24),
    verdigris=(0.33, 0.55, 0.46),
    iron=(0.28, 0.28, 0.3),
    iron_hi=(0.42, 0.42, 0.44),
    glass=(0.58, 0.42, 0.2),
    # a lit window's glass: the lanterns' warm glow, a little deeper than their panes
    glass_lit=(0.86, 0.56, 0.26),
    cream=(0.94, 0.9, 0.78),
    foam=(0.98, 0.95, 0.86),
    fire=(1.0, 0.56, 0.18),
    ember=(1.0, 0.34, 0.08),
    candle=(1.0, 0.82, 0.5),
    lamp=(1.0, 0.74, 0.4),
    parchment=(0.9, 0.82, 0.62),
    soot=(0.12, 0.1, 0.09),
    # the stair tower's dressed limestone, its mortar, and the cool daylight in its slits
    ashlar=[(0.68, 0.62, 0.53), (0.63, 0.58, 0.5), (0.72, 0.66, 0.56), (0.6, 0.55, 0.48),
            (0.66, 0.61, 0.54), (0.7, 0.63, 0.52)],
    ashlar_hi=(0.78, 0.72, 0.62),
    ashlar_dark=(0.52, 0.47, 0.41),
    mortar=(0.3, 0.27, 0.24),
    slit_in=(0.66, 0.77, 0.88),
    tread=[(0.6, 0.58, 0.55), (0.56, 0.55, 0.53), (0.63, 0.6, 0.56), (0.58, 0.56, 0.52)],
    bone=(0.9, 0.86, 0.74),
)

MATERIAL_SPECS = (
    # name, roughness, metallic, emission; indexed WOOD, METAL, STONE, PLASTER, GLOW
    ('TavernWood', 0.8, 0.0, 0.0),
    ('TavernMetal', 0.45, 0.55, 0.0),
    ('TavernStone', 0.92, 0.0, 0.0),
    ('TavernPlaster', 0.95, 0.0, 0.0),
    ('TavernGlow', 0.5, 0.0, 2.4),
)


def pick(seq, i):
    return seq[int(i) % len(seq)]


# ---------------------------------------------------------------------------
# Terrain (heights over the ground floor, bilinear from the layout grid)
# ---------------------------------------------------------------------------
T = LAYOUT['terrain']


def ground(x, z):
    fx = min(max((x - T['x0']) / T['step'], 0.0), T['nx'] - 1.0001)
    fz = min(max((z - T['z0']) / T['step'], 0.0), T['nz'] - 1.0001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    h, n = T['h'], T['nx']
    a, b = h[j * n + i], h[j * n + i + 1]
    c, d = h[(j + 1) * n + i], h[(j + 1) * n + i + 1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


def ground_min(points):
    return min(ground(x, z) for x, z in points)


def hashf(*k):
    """A stable pseudo-random number in [0, 1) from a few coordinates (no rng: every build of
    the same source is identical)."""
    v = math.sin(sum(x * (12.9898 + 7.233 * i) for i, x in enumerate(k)) + 0.5) * 43758.5453
    return v - math.floor(v)


# ---------------------------------------------------------------------------
# Geometry helpers (game frame = the tavern's local frame)
# ---------------------------------------------------------------------------
def hexa(p, pts, color, mat, tag=PLAIN):
    """A closed six-sided solid from 8 game-frame corners: 0-3 the bottom ring, 4-7 the top
    ring above them (any order round the ring; normals are recalculated)."""
    bm = p.bm
    v = [bm.verts.new(P(*q)) for q in pts]
    faces = []
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        quad = [v[i] for i in f]
        uniq = []
        for q in quad:
            if all((q.co - u.co).length > 1e-6 for u in uniq):
                uniq.append(q)
        if len(uniq) < 3:
            continue
        try:
            faces.append(bm.faces.new(uniq))
        except ValueError:
            continue
    p.paint(faces, color, mat, tag)
    p.closed.extend(faces)
    return faces


def abox(p, x0, x1, y0, y1, z0, z1, color, mat=WOOD, bevel=0.0):
    """An axis-aligned box by its extents."""
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
        return []
    return p.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), color, mat,
                 bevel=bevel)


def beam(p, a, b, w, h, color, mat=WOOD):
    p.beam([a, b], w, h, color, mat, up=(0, 1, 0))


def post(p, x, z, y0, y1, w, color, mat=WOOD, bevel=0.0):
    if y1 - y0 > 0.02:
        p.box((x, (y0 + y1) / 2, z), (w, y1 - y0, w), color, mat, bevel=bevel)


def chain(p, a, b, links=None):
    """An iron chain as a run of alternating flat links."""
    ax, ay, az = a
    bx, by, bz = b
    length = math.dist(a, b)
    n = links or max(2, int(length / 0.4))
    for k in range(n):
        t = (k + 0.5) / n
        c = (ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)
        if k % 2 == 0:
            p.box(c, (0.09, length / n * 1.1, 0.03), PAL['iron'], METAL)
        else:
            p.box(c, (0.03, length / n * 1.1, 0.09), PAL['iron'], METAL)


class Wall:
    """A straight wall run in the game frame: u along it from its start, v up, w across it
    (positive outward)."""

    def __init__(self, x0, z0, x1, z1, outward):
        self.x0, self.z0 = x0, z0
        self.length = math.hypot(x1 - x0, z1 - z0)
        self.dx, self.dz = (x1 - x0) / self.length, (z1 - z0) / self.length
        # the outward normal is one of the two perpendiculars, chosen by a sample point
        nx, nz = self.dz, -self.dx
        if nx * outward[0] + nz * outward[1] < 0:
            nx, nz = -nx, -nz
        self.nx, self.nz = nx, nz

    def pt(self, u, v, w):
        return (self.x0 + self.dx * u + self.nx * w, v, self.z0 + self.dz * u + self.nz * w)

    def xz(self, u, w=0.0):
        return (self.x0 + self.dx * u + self.nx * w, self.z0 + self.dz * u + self.nz * w)

    def box(self, p, u0, u1, v0, v1, w0, w1, color, mat, tag=PLAIN, v1b=None):
        """A box in wall space; `v1b` slopes its top to that height at u1 (a gable)."""
        w0, w1 = min(w0, w1), max(w0, w1)
        if u1 - u0 < 1e-4 or v1 - v0 < 1e-4 or w1 - w0 < 1e-4:
            return []
        top1 = v1 if v1b is None else v1b
        pts = [self.pt(u0, v0, w0), self.pt(u1, v0, w0), self.pt(u1, v0, w1), self.pt(u0, v0, w1),
               self.pt(u0, v1, w0), self.pt(u1, top1, w0), self.pt(u1, top1, w1), self.pt(u0, v1, w1)]
        return hexa(p, pts, color, mat, tag)

    def beam(self, p, u0, v0, u1, v1, w, width, depth, color, mat=WOOD, hewn=0.0):
        """A timber on a face: from (u0, v0) to (u1, v1), its centre `w` out, `depth` across.
        `hewn` makes it hand-hewn: each end wanders up to that far across the timber's line,
        its width, depth and tone vary a little, all from a stable hash of where it stands
        (no rng: the build stays deterministic)."""
        if hewn > 0:
            du, dv = u1 - u0, v1 - v0
            n = math.hypot(du, dv) or 1.0
            pu, pv = -dv / n, du / n
            ka = (hashf(u0, v0, w, 1) - 0.5) * 2 * hewn
            kb = (hashf(u1, v1, w, 2) - 0.5) * 2 * hewn
            u0, v0 = u0 + pu * ka, v0 + pv * ka
            u1, v1 = u1 + pu * kb, v1 + pv * kb
            width *= 1 + (hashf(u0, v1, 3) - 0.5) * 0.22
            depth *= 1 + (hashf(v0, u1, 4) - 0.5) * 0.3
            color = scale_color(color, 0.9 + 0.16 * hashf(u0 + u1, v0 + v1, 5))
        ax, ay, az = self.pt(u0, v0, w)
        bx, by, bz = self.pt(u1, v1, w)
        # the beam's width lies in the wall's plane, its depth across it
        p.beam([(ax, ay, az), (bx, by, bz)], width, depth, color, mat, up=(self.nx, 0, self.nz))


def timber_wall(p, wall, t, top, openings, base_h=1.4, stone_to=0.0, bays=3.2, y0=0.0, inner=True,
                seed=0, braces=True, plaster=None, inner_plaster=None, frame_to=None, breaks=(), outer_to=None,
                hewn=0.035):
    """A timber-framed wall on a stone base course.

    top(u) gives the wall's top along it (the eaves, or a gable). `openings` are
    (u0, u1, v0, v1) holes. Below `base_h` (and up to `stone_to`, for a stone storey) the wall
    is coursed blue-grey stone; above, ochre plaster panels between honey posts, rails and
    braces on both faces. The core sits a hand behind the timbers so they read proud.
    `breaks` are places along the wall where the core and the rails part (where the wall is
    split into separate shell parts), so no solid runs across them. `outer_to` stops the outer
    face's timbers at that height (the front under its jettied upper storey, whose own frame
    stands a yard further out); `hewn` makes every timber of the frame hand-hewn (Wall.beam)."""
    plaster = plaster or PAL['plaster']
    inner_plaster = inner_plaster or PAL['plaster_in']
    L = wall.length
    stone_top = max(base_h, stone_to)
    frame_to = frame_to if frame_to is not None else None
    cuts = {0.0, L}
    for (a, b, _, _) in openings:
        cuts.add(max(0.0, min(L, a)))
        cuts.add(max(0.0, min(L, b)))
    for u in breaks:
        cuts.add(max(0.0, min(L, u)))
    # posts: the ends, every opening's jambs, and bays between
    posts = [0.0, L]
    for (a, b, _, _) in openings:
        posts += [a - 0.17, b + 0.17]
    edges = sorted(cuts)
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        n = int((b - a) / bays)
        for k in range(1, n + 1):
            posts.append(a + (b - a) * k / (n + 1))
    posts = sorted({round(min(max(u, 0.17), L - 0.17), 3) for u in posts})
    # the core is only broken where an opening's edge is (the posts stand proud over it), and
    # at the middle, where a gable's top turns
    cuts.add(L / 2)
    edges = sorted(cuts)
    half = t / 2
    k = 0
    for i in range(len(edges) - 1):
        ua, ub = edges[i], edges[i + 1]
        if ub - ua < 1e-3:
            continue
        um = (ua + ub) / 2
        holes = sorted([(v0, v1) for (a, b, v0, v1) in openings if a <= um <= b])
        # vertical bands between the holes
        spans = []
        v = y0
        for (h0, h1) in holes:
            if h0 > v:
                spans.append((v, h0))
            v = max(v, h1)
        spans.append((v, None))
        for (va, vb) in spans:
            ta, tb = (top(ua), top(ub)) if vb is None else (vb, vb)
            # stone part
            s_hi = min(stone_top, ta if vb is None else vb)
            if s_hi > va + 1e-3:
                sa = s_hi if vb is not None else min(stone_top, ta)
                sb = s_hi if vb is not None else min(stone_top, tb)
                wall.box(p, ua, ub, va, sa, -half - 0.06, half + 0.06, pick(PAL['stone'], k + seed), STONE,
                         v1b=sb)
                k += 1
            lo = max(va, stone_top)
            if vb is None:
                if ta > lo + 1e-3 or tb > lo + 1e-3:
                    wall.box(p, ua, ub, lo, max(ta, lo + 0.01), -half + 0.04, half - 0.04,
                             pick(plaster, seed), PLASTER, v1b=max(tb, lo + 0.01))
            elif vb > lo + 1e-3:
                wall.box(p, ua, ub, lo, vb, -half + 0.04, half - 0.04, pick(plaster, seed), PLASTER)
            k += 1
    # stone courses read as blocks: one joint line per course on the outer face, run between
    # the openings
    if stone_top > 0.3:
        v = y0 + 0.62
        while v < stone_top - 0.2:
            u = 0.0
            runs = []
            for (a, b) in sorted((a, b) for (a, b, v0, v1) in openings if v0 - 0.05 <= v <= v1 + 0.05):
                if a > u:
                    runs.append((u, a))
                u = max(u, b)
            if L > u:
                runs.append((u, L))
            for (a, b) in runs:
                if b - a > 0.1 and v < min(top(a), top(b)):
                    wall.box(p, a, b, v - 0.03, v + 0.03, half + 0.05, half + 0.075, PAL['stone_dark'], STONE)
            v += 0.62
    faces = [1] + ([-1] if inner else [])
    base = max(stone_top, y0)
    for s in faces:
        cap = frame_to
        if s > 0 and outer_to is not None:
            cap = outer_to if cap is None else min(cap, outer_to)
        frame_top = top if cap is None else (lambda u, c=cap: min(top(u), c))
        w = s * (half + 0.03)
        depth = 0.12
        col = PAL['beam'] if s > 0 else PAL['honey'][1]
        hw = hewn if s > 0 else hewn * 0.4
        # posts
        for u in posts:
            v1 = frame_top(u)
            if v1 - base < 0.3:
                continue
            if any(a < u < b and v0 < base + 0.1 < v1b for (a, b, v0, v1b) in openings):
                continue
            wall.beam(p, u, base, u, v1, w, 0.34, depth, col, hewn=hw)
        # the sill beam on the stone, the mid rail and the top plate, broken at openings
        rails = [base + 0.15]
        eave_line = min(top(0.0), top(L))
        if cap is not None:
            eave_line = min(eave_line, cap)
        if eave_line - base > 3.0:
            rails.append(base + (eave_line - base) * 0.5)
        rails.append(eave_line - 0.15)
        for rv in rails:
            u = 0.0
            runs = []
            blocked = sorted((a, b) for (a, b, v0, v1) in openings if v0 - 0.1 <= rv <= v1 + 0.1)
            for (a, b) in blocked:
                if a - 0.17 > u:
                    runs.append((u, a - 0.17))
                u = max(u, b + 0.17)
            if L - u > 0.05:
                runs.append((u, L))
            for (a, b) in runs:
                cut = [a] + sorted(u for u in breaks if a + 0.05 < u < b - 0.05) + [b]
                for (ra, rb) in zip(cut, cut[1:]):
                    if rb - ra > 0.3:
                        wall.beam(p, ra, rv, rb, rv, w, 0.28, depth, col, hewn=hw)
        # braces: one diagonal in each clear bay under the mid rail
        if braces and len(rails) >= 2:
            lo, hi = rails[0], rails[1]
            for i in range(len(posts) - 1):
                a, b = posts[i], posts[i + 1]
                if b - a < 1.2:
                    continue
                if any(oa < b and ob > a and v0 < hi for (oa, ob, v0, _) in openings):
                    continue
                # never across a break (the wall's shell parts part there)
                if any(a < u < b for u in breaks):
                    continue
                if (i + seed) % 2 == 0:
                    wall.beam(p, a + 0.1, lo + 0.1, b - 0.1, hi - 0.1, w, 0.24, depth, col, hewn=hw)
                else:
                    wall.beam(p, a + 0.1, hi - 0.1, b - 0.1, lo + 0.1, w, 0.24, depth, col, hewn=hw)
    return posts


def flat_face(p, pts, color, mat, facing, tag=FLAT):
    """A single flat polygon (game-frame corners) turned to face `facing` (a game-frame
    direction): a decal on a surface, a leaded came on a pane, a chalk line on a board."""
    from shiplib import P as _P
    f = p.face(pts, color, mat, tag)
    f.normal_update()
    if f.normal.dot(_P(*facing)) < 0:
        f.normal_flip()
    return f


def leaded(p, wall, u0, u1, v0, v1, w, facing, step=0.3, came=0.024):
    """Diamond leading over one light of a window (u0..u1, v0..v1 in wall space) on the face
    `w` out: two families of lead cames at 45 degrees, `step` apart across, clipped to the
    light, each a thin flat strip."""
    lead = (0.19, 0.19, 0.21)
    for sgn in (1, -1):
        # lines u - sgn*v = c across the light
        cs = [u0 - sgn * v0, u1 - sgn * v0, u0 - sgn * v1, u1 - sgn * v1]
        c0, c1 = min(cs), max(cs)
        d = step * math.sqrt(2)
        c = c0 + d * 0.5
        while c < c1:
            pts = []
            # intersections with the four edges
            for vv in (v0, v1):
                uu = c + sgn * vv
                if u0 - 1e-6 <= uu <= u1 + 1e-6:
                    pts.append((uu, vv))
            for uu in (u0, u1):
                vv = (uu - c) * sgn
                if v0 - 1e-6 <= vv <= v1 + 1e-6:
                    pts.append((uu, vv))
            pts = sorted(set((round(a, 5), round(b, 5)) for a, b in pts))
            if len(pts) >= 2:
                (au, av), (bu, bv) = pts[0], pts[-1]
                ln = math.hypot(bu - au, bv - av)
                if ln > 0.05:
                    nu, nv = -(bv - av) / ln * came / 2, (bu - au) / ln * came / 2
                    quad = [wall.pt(au + nu, av + nv, w), wall.pt(bu + nu, bv + nv, w),
                            wall.pt(bu - nu, bv - nv, w), wall.pt(au - nu, av - nv, w)]
                    flat_face(p, quad, lead, METAL, facing)
            c += d
    # the lead round the light's edge
    for (a, b, c_, d_) in ((u0, u1, v0, v0 + came), (u0, u1, v1 - came, v1), (u0, u0 + came, v0, v1),
                           (u1 - came, u1, v0, v1)):
        flat_face(p, [wall.pt(a, c_, w), wall.pt(b, c_, w), wall.pt(b, d_, w), wall.pt(a, d_, w)], lead, METAL,
                  facing)


def window(p, wall, u0, u1, v0, v1, t, shutters=True, bars=1, lit=False, outer=True, inner=True, glass_w=0.0,
           box_out=None):
    """A leaded window through (or set in) a wall: a timber frame round the opening, a mullion
    and `bars` transoms dividing it into lights, each light glazed in small diamond panes held
    in lead, a stone sill with a drip, and a pair of planked shutters folded back outside on
    iron strap hinges. A `lit` window's panes are the lanterns' glowing glass (TavernGlow: the
    hall behind is lit). `outer`/`inner` pick the faces dressed (a window hidden behind a
    jettied storey keeps only its inside; a decorative one only its outside); `glass_w` sets
    the panes' plane across the wall."""
    half = t / 2
    col = PAL['beam_dark']
    faces = ([1] if outer else []) + ([-1] if inner else [])
    for s in faces:
        w = s * (half + 0.02)
        wall.beam(p, u0 - 0.1, v0 - 0.08, u0 - 0.1, v1 + 0.08, w, 0.2, 0.14, col, hewn=0.012)
        wall.beam(p, u1 + 0.1, v0 - 0.08, u1 + 0.1, v1 + 0.08, w, 0.2, 0.14, col, hewn=0.012)
        wall.beam(p, u0 - 0.2, v1 + 0.1, u1 + 0.2, v1 + 0.1, w, 0.22, 0.16, col, hewn=0.012)
    # the panes in the wall's middle plane (or `glass_w` out)
    gw = glass_w
    if lit:
        wall.box(p, u0, u1, v0, v1, gw - 0.03, gw + 0.03, PAL['glass_lit'], GLOW, tag=FLAT)
    else:
        wall.box(p, u0, u1, v0, v1, gw - 0.03, gw + 0.03, PAL['glass'], STONE, tag=FLAT)
    um = (u0 + u1) / 2
    wall.box(p, um - 0.06, um + 0.06, v0, v1, gw - 0.08, gw + 0.08, col, WOOD)
    rails = [v0 + (v1 - v0) * k / (bars + 1) for k in range(1, bars + 1)]
    for vv in rails:
        wall.box(p, u0, u1, vv - 0.05, vv + 0.05, gw - 0.07, gw + 0.07, col, WOOD)
    # the diamond leading over every light, on each dressed face
    edges_v = [v0] + [x for vv in rails for x in (vv - 0.05, vv + 0.05)] + [v1]
    lights_v = list(zip(edges_v[0::2], edges_v[1::2]))
    for s in faces:
        facing = (wall.nx * s, 0.0, wall.nz * s)
        for (la, lb) in ((u0, um - 0.06), (um + 0.06, u1)):
            for (va, vb) in lights_v:
                leaded(p, wall, la, lb, va, vb, gw + s * 0.034, facing)
    if not outer:
        return
    # the sill: dressed stone, a drip under its lip
    sw = box_out if box_out is not None else half + 0.2
    wall.box(p, u0 - 0.25, u1 + 0.25, v0 - 0.18, v0, -half - 0.02, sw, PAL['stone_dark'], STONE)
    wall.box(p, u0 - 0.22, u1 + 0.22, v0 - 0.24, v0 - 0.18, sw - 0.1, sw, PAL['stone_dark'], STONE)
    if shutters:
        width = (u1 - u0) / 2
        for side, ue in ((-1, u0), (1, u1)):
            a, b = (ue - width - 0.14, ue - 0.14) if side < 0 else (ue + 0.14, ue + width + 0.14)
            # three planks with a hairline between, a little uneven at the top
            n = 3
            for k in range(n):
                pa = a + (b - a) * k / n + 0.008
                pb = a + (b - a) * (k + 1) / n - 0.008
                tone = scale_color(PAL['garnet_dark'], 0.92 + 0.14 * hashf(pa, v0, 7))
                wall.box(p, pa, pb, v0, v1 - 0.03 * (k % 2), half + 0.06, half + 0.14, tone, WOOD)
            # the ledges and the brace between them (a Z), in dark oak
            ya, yb = v0 + (v1 - v0) * 0.18, v0 + (v1 - v0) * 0.82
            for vv in (ya, yb):
                wall.box(p, a + 0.04, b - 0.04, vv - 0.06, vv + 0.06, half + 0.14, half + 0.18, PAL['beam_dark'],
                         WOOD)
            if side < 0:
                wall.beam(p, a + 0.1, ya + 0.06, b - 0.1, yb - 0.06, half + 0.16, 0.08, 0.04, PAL['beam_dark'])
            else:
                wall.beam(p, b - 0.1, ya + 0.06, a + 0.1, yb - 0.06, half + 0.16, 0.08, 0.04, PAL['beam_dark'])
            # the iron strap hinges running in from the jamb, and the hooks that hold it open
            for vv in (ya, yb):
                ua, ub = (b - width * 0.7, b + 0.02) if side < 0 else (a - 0.02, a + width * 0.7)
                wall.box(p, ua, ub, vv - 0.025, vv + 0.025, half + 0.18, half + 0.2, PAL['iron'], METAL)


def slate_plane(p, e0, along, up, la, lu, seed=0, step=0.72, seg=4.6, thick=0.09, clip=None):
    """A slate roof slope: rows of overlapping dark green slates laid up the slope.

    e0 is the eave corner (game frame), `along` the unit vector along the eave, `up` the unit
    vector up the slope, la and lu the slope's extents. `clip(point)` may move a corner (the
    tower cone against the hall). Each row is a run of slates whose lower edge kicks out a
    little over the row below, which is what makes a slate roof read."""
    nx = along[1] * up[2] - along[2] * up[1]
    ny = along[2] * up[0] - along[0] * up[2]
    nz = along[0] * up[1] - along[1] * up[0]
    if ny < 0:
        nx, ny, nz = -nx, -ny, -nz

    def at(a, s, lift):
        q = (e0[0] + along[0] * a + up[0] * s + nx * lift,
             e0[1] + along[1] * a + up[1] * s + ny * lift,
             e0[2] + along[2] * a + up[2] * s + nz * lift)
        return clip(q) if clip else q

    rows = max(1, int(round(lu / step)))
    rstep = lu / rows
    for r in range(rows):
        s0 = r * rstep
        s1 = min(lu, s0 + rstep * 1.25)
        off = (r % 2) * seg * 0.5
        a = -off
        j = 0
        while a < la:
            a0, a1 = max(0.0, a), min(la, a + seg)
            if a1 - a0 > 0.2:
                kick = thick * 1.8
                pts = [at(a0 + 0.02, s0, kick), at(a1 - 0.02, s0, kick), at(a1 - 0.02, s0, kick - thick),
                       at(a0 + 0.02, s0, kick - thick),
                       at(a0 + 0.02, s1, thick), at(a1 - 0.02, s1, thick), at(a1 - 0.02, s1, 0.0),
                       at(a0 + 0.02, s1, 0.0)]
                # bottom ring = the underside (lift - thick), top ring = the upper surface
                hexa(p, [pts[3], pts[2], pts[6], pts[7], pts[0], pts[1], pts[5], pts[4]],
                     pick(PAL['slate'], r * 7 + j * 3 + seed), STONE)
            a += seg
            j += 1


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


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
import tavern_dog as DOG  # noqa: E402
import tavern_facade as FA  # noqa: E402
import tavern_grounds as GR  # noqa: E402
import tavern_frame as F  # noqa: E402
import tavern_furnish as U  # noqa: E402
import tavern_shell as S  # noqa: E402
import tavern_weather as WX  # noqa: E402

SHELL = ('HallWallFront', 'HallWallFrontLeft', 'HallWallFrontRight', 'HallWallBack', 'HallWallLeft',
         'HallWallRight', 'HallRoof', 'WingWallEast', 'WingWallBack', 'WingWallWest', 'WingRoof', 'TowerWall',
         'TowerRoof', 'HallPorch', 'BarPillar')
# the front wall's three parts meet this far either side of the door's middle
# (src/render/mirefen_tavern_core.ts TAVERN_FRONT_SPLIT)
FRONT_SPLIT = 3.2
# the grounds outside (the forecourt, the terrace, the stable, the cart, the woodpile) and the dog
# asleep on the porch, its own part so the runtime can make it breathe
CRITICAL = ('TavernFrame', 'TavernFurnishings', 'TavernLights', 'TavernGrounds', 'TavernDog') + SHELL
TRIM = ('TavernTrim',)
OPTIONAL = ('TavernClutter',)


# per part: the wear (per-face value jitter) and the top-to-bottom shading gradient
PART_SHADING = {name: (0.035, 0.06) for name in CRITICAL + TRIM + OPTIONAL}
PART_SHADING.update({'HallRoof': (0.05, 0.03), 'WingRoof': (0.05, 0.03), 'TowerRoof': (0.05, 0.03),
                     'TavernLights': (0.01, 0.02), 'TavernClutter': (0.03, 0.04)})


# ---------------------------------------------------------------------------
# The warm light baked into the inside (the lanterns and fires are few at runtime, the
# budget shares six point lights with the whole world: the vertex colours carry the glow)
# ---------------------------------------------------------------------------
def _warm_sources():
    """The warm lights the bake reads: ((x, y, z), strength, reach). The hearth is the room's
    heart, the wall fire and the stage's footlights warm their corners, the candles pool on
    each table, the lanterns and the chandelier glow high, the kitchen's range fills the hatch."""
    pit, c = LAYOUT['pit'], LAYOUT['chandelier']
    fire = next(q for q in LAYOUT['props'] if q['kind'] == 'fireplace')
    counter = next(q for q in LAYOUT['props'] if q['kind'] == 'counter' and q['hw'] > q['hd'])
    st, hatch = LAYOUT['stage'], LAYOUT['hatch']
    src = [((pit['x'], 1.6, pit['z']), 1.25, 17.0),
           ((fire['x'] - 1.4, 1.2, fire['z']), 0.85, 10.0),
           ((c['x'], c['y'] - 0.3, c['z']), 0.55, 12.0),
           ((counter['x'], counter['base'] + counter['height'] + 0.4, counter['z']), 0.6, 7.5),
           # the stage's footlights, a warm wash up the curtain
           (((st['x0'] + st['x1']) / 2, st['lift'] + 0.6, st['z1'] - 0.4), 0.75, 7.5),
           # the kitchen's range behind the hatch
           (((hatch['x0'] + hatch['x1']) / 2, 1.0, -17.0), 1.1, 6.5),
           (((hatch['x0'] + hatch['x1']) / 2 + 1.4, 3.8, -16.0), 0.8, 6.0),
           # the nook's crown and its sconces' glow
           ((TOWER['x'], 5.5, TOWER['z']), 0.55, 9.0)]
    for q in LAYOUT['lanterns']:
        src.append(((q['x'], q['y'], q['z']), 0.5 if q['lit'] else 0.3, 9.0))
    for q in LAYOUT['sconces']:
        src.append(((q['x'] + q['nx'] * 0.45, q['y'] + 0.3, q['z'] + q['nz'] * 0.45), 0.4, 4.5))
    # a candle on every table: a small warm pool on its top and the seats round it
    for q in LAYOUT['props']:
        if q['kind'] in ('table', 'roundTable'):
            src.append(((q['x'], q['base'] + q['height'] + 0.5, q['z']), 0.32, 3.6))
    return src


def _inside(x, y, z):
    H, T = HALL, TOWER
    if abs(x) <= H['x1'] - H['wall'] + 0.06 and H['z0'] + H['wall'] - 0.06 <= z <= H['z1'] - H['wall'] + 0.06 \
            and -1.0 <= y <= H['ridge']:
        return True
    # the kitchen behind the hatch
    if 5.4 <= x <= 13.6 and -18.4 <= z <= H['z0'] and -0.5 <= y <= 6.0:
        return True
    return math.hypot(x - T['x'], z - T['z']) <= T['rIn'] + 0.06 and -0.5 <= y <= T['peak']


def bake_warm_light(parts):
    """Warm the colours of every surface inside the tavern by the light that reaches it from
    the fires, lanterns and candles: brighter and warmer near a flame, a soft golden floor
    of light everywhere indoors, the far corners left a little dim."""
    from shiplib import G as game
    sources = _warm_sources()
    for piece in parts.values():
        bm = piece.bm
        bm.normal_update()
        for f in bm.faces:
            if f.material_index == GLOW or f in SKY_FACES:
                continue
            c = game(f.calc_center_median())
            if not _inside(c.x, c.y, c.z):
                continue
            n = game(f.normal)
            light = 0.0
            for (lx, ly, lz), k, reach in sources:
                dx, dy, dz = lx - c.x, ly - c.y, lz - c.z
                d = math.sqrt(dx * dx + dy * dy + dz * dz)
                if d >= reach:
                    continue
                facing = (dx * n.x + dy * n.y + dz * n.z) / max(d, 1e-4)
                fall = (1 - d / reach) ** 2
                light += k * fall * (0.35 + 0.65 * max(0.0, facing))
            light = min(light, 1.1)
            mult = (0.9 + light * 0.55, 0.85 + light * 0.46, 0.78 + light * 0.34)
            for loop in f.loops:
                r, g, b, a = loop[piece.col]
                loop[piece.col] = (min(1.0, r * mult[0]), min(1.0, g * mult[1]), min(1.0, b * mult[2]), a)


def split_part(parts, src_name, rules):
    """Move each connected solid of one part into another part by where it stands: `rules` is
    a list of (part name, test on the solid's centre in the game frame), the first match
    wins, a solid no rule takes stays. A solid moves whole (a beam never loses its end)."""
    import bmesh
    from shiplib import G as game

    src = parts[src_name]
    bm = src.bm
    bm.verts.ensure_lookup_table()
    closed = set(src.closed)
    seen = set()
    groups = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, group = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            group.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        groups.append(group)
    moved = []
    for group in groups:
        verts = {v for f in group for v in f.verts}
        acc = None
        for v in verts:
            acc = v.co.copy() if acc is None else acc + v.co
        c = game(acc / len(verts))
        target = next((name for (name, test) in rules if test(c)), None)
        if target is None:
            continue
        dst = parts[target]
        vmap = {}
        for f in group:
            vs = []
            for v in f.verts:
                nv = vmap.get(v)
                if nv is None:
                    nv = dst.bm.verts.new(v.co)
                    vmap[v] = nv
                vs.append(nv)
            nf = dst.bm.faces.new(vs)
            nf.material_index = f.material_index
            nf[dst.tag] = f[src.tag]
            nf[dst.soft] = f[src.soft]
            for la, lb in zip(f.loops, nf.loops):
                lb[dst.col] = la[src.col]
            if f in closed:
                dst.closed.append(nf)
        moved.extend(group)
    bmesh.ops.delete(bm, geom=moved, context='FACES')
    src.closed = [f for f in src.closed if f.is_valid]


def encode_for_export(parts):
    """Hand the exporter the palette once linearized. shiplib's finish() linearizes every
    corner colour (**2.2) and the glTF exporter linearizes the colour attribute again, so
    without this the shipped COLOR_0 is darkened twice (a cream wall ships near brown, the
    green slate near black): the palette is pre-encoded here so the two steps net to one."""
    for piece in parts.values():
        for f in piece.bm.faces:
            for loop in f.loops:
                r, g, b, a = loop[piece.col]
                loop[piece.col] = (r ** (1 / 2.2), g ** (1 / 2.2), b ** (1 / 2.2), a)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    root = empty('MirefenTavern_ROOT', None, display='ARROWS', size=2.0)
    this = sys.modules[__name__]
    parts = {name: Piece(name, wear=w, gradient=g) for name, (w, g) in PART_SHADING.items()}
    F.build(this, parts)
    S.build(this, parts)
    U.build(this, parts)
    FA.build(this, parts)
    WX.build(this, parts)
    GR.build(this, parts)
    DOG.build(this, parts)
    # the front wall's two sides are their own parts: a camera at an angle to the door ghosts
    # only the side between it and the player
    split_part(parts, 'HallWallFront', [('HallWallFrontLeft', lambda c: c.x < -FRONT_SPLIT),
                                         ('HallWallFrontRight', lambda c: c.x > FRONT_SPLIT)])
    bake_warm_light(parts)
    encode_for_export(parts)
    pieces = {}
    for name in CRITICAL + TRIM + OPTIONAL:
        if not parts[name].bm.faces:
            raise RuntimeError(f'part {name} is empty')
        # the dog's origin is where it lies, so the runtime breathes it round its own middle
        dog = LAYOUT['grounds']['dog']
        at = (dog['x'], 0.0, dog['z']) if name == 'TavernDog' else (0.0, 0.0, 0.0)
        pieces[name] = parts[name].finish(mats, root, location=at)
    root['mirefenTavern'] = {
        'layoutVersion': LAYOUT['version'],
        'tiers': {'low': list(CRITICAL), 'medium': list(TRIM), 'high': list(OPTIONAL)},
        'shell': list(SHELL),
        'hall': {'eave': HALL['eave'], 'ridge': HALL['ridge'], 'truss': HALL['truss']},
        'door': [LAYOUT['door']['width'], LAYOUT['door']['height']],
        'nookRadius': TOWER['rIn'],
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
    export(os.path.join(HERE, 'mirefen_tavern_source.glb'), objs)
    if arg('--save'):
        import tavern_scene  # noqa: E402

        tavern_scene.stage(objs, arg('--context'))
        tavern_scene.save(arg('--save'))
