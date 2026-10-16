"""Shared helpers for the Highwatch manor build (build_manor.py).

Everything is authored in the MODEL frame the game reads the shipped GLB in: yards, origin on
the ground line under the great hall's middle, +y up, +x to the west (a visitor walking in
has it on the left), +z to the north; the front door looks south (-z). shiplib.P turns a
model-frame point into Blender's frame and the glTF exporter turns it back.

The look is Highwatch's: grey-blue ashlar under sage plaster in dark timber frames, blue
square-cut slate, gold trim at the ridges and the doors, warm windows. No randomness: every
variation comes from a stable hash of where a piece stands, so every build is identical.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))

from shiplib import EDGE, FLAT, P, PLAIN, scale_color  # noqa: E402,F401

WOOD, METAL, STONE, PLASTER, GLOW, SLATE, GLASS = 0, 1, 2, 3, 4, 5, 6
# the stained glass by its colour
GLASS_BLUE, GLASS_RED, GLASS_GOLD = 7, 8, 9
# the warm lights in more tones than one: honey lamplight, the lanterns, the candle flames
GLOW_SOFT, GLOW_LANTERN, GLOW_CANDLE = 10, 11, 12
# every glowing material (the weathering and the warm bake leave them alone)
EMISSIVE = (GLOW, GLASS, GLASS_BLUE, GLASS_RED, GLASS_GOLD, GLOW_SOFT, GLOW_LANTERN, GLOW_CANDLE)

# The least gap between a decal-like layer and the surface under it (a rug on a floor, a stripe
# on a banner, a skin on a wall's core): closer than this, two overlapping faces fight in the
# depth buffer and flicker (pinned by tests/highwatch_manor_asset.test.ts over the shipped GLB).
LAYER = 0.04

# The palette the builders paint with. The materials (the painted maps the wood, stone, plaster
# and slate wear, the metal, the glass and the glows) are manor_texture.py's.
PAL = dict(
    # the ashlar plinth and the dressed stone: cool blue-grey granite
    ashlar=[(0.42, 0.47, 0.55), (0.38, 0.43, 0.51), (0.46, 0.5, 0.57), (0.4, 0.45, 0.53),
            (0.44, 0.48, 0.54), (0.36, 0.41, 0.49)],
    ashlar_hi=(0.55, 0.59, 0.65),
    mortar=(0.24, 0.27, 0.31),
    stone_dark=(0.3, 0.34, 0.4),
    flag=[(0.5, 0.52, 0.56), (0.46, 0.48, 0.53), (0.54, 0.55, 0.58), (0.48, 0.5, 0.52)],
    # sage plaster, a little weathered outside, warmer and paler inside
    plaster=[(0.58, 0.66, 0.6), (0.55, 0.63, 0.58), (0.61, 0.68, 0.61), (0.56, 0.65, 0.6)],
    plaster_in=[(0.78, 0.76, 0.66), (0.75, 0.73, 0.63), (0.8, 0.78, 0.68)],
    # dark timber outside, oak inside
    timber=(0.22, 0.16, 0.12),
    timber_dark=(0.16, 0.11, 0.08),
    oak=[(0.48, 0.33, 0.2), (0.44, 0.3, 0.18), (0.52, 0.36, 0.22)],
    oak_dark=(0.32, 0.21, 0.13),
    board=[(0.5, 0.36, 0.23), (0.46, 0.33, 0.21), (0.54, 0.39, 0.25), (0.48, 0.34, 0.22)],
    walnut=(0.3, 0.19, 0.12),
    # the blue square-cut slate
    slate=[(0.27, 0.32, 0.5), (0.24, 0.29, 0.46), (0.3, 0.35, 0.54), (0.26, 0.3, 0.48),
           (0.22, 0.27, 0.44), (0.29, 0.33, 0.52)],
    slate_ridge=(0.18, 0.21, 0.32),
    sarking=(0.34, 0.24, 0.16),
    gold=(0.86, 0.66, 0.28),
    gold_dark=(0.66, 0.48, 0.18),
    copper=(0.74, 0.46, 0.28),
    copper_dark=(0.5, 0.3, 0.18),
    verdigris=(0.36, 0.58, 0.5),
    iron=(0.2, 0.2, 0.22),
    iron_hi=(0.36, 0.36, 0.38),
    # heraldic colours: the hold's deep blue and a garnet accent
    blue=(0.12, 0.2, 0.46),
    blue_dark=(0.08, 0.13, 0.32),
    garnet=(0.5, 0.1, 0.13),
    garnet_dark=(0.36, 0.07, 0.09),
    cream=(0.93, 0.89, 0.78),
    linen=(0.86, 0.82, 0.7),
    silver=(0.8, 0.82, 0.86),
    parchment=(0.9, 0.82, 0.62),
    leather=(0.42, 0.24, 0.14),
    # glass and light
    glass=(0.32, 0.4, 0.52),
    # lit glass reads warm amber, never white: the runtime lifts the glow over the bloom
    # threshold (render/eastbrook_placed_building.ts), so these stay deep
    glass_lit=(0.86, 0.48, 0.16),
    lantern_lit=(0.9, 0.56, 0.2),
    candle=(0.95, 0.66, 0.3),
    fire=(0.95, 0.46, 0.12),
    ember=(0.85, 0.26, 0.05),
    soot=(0.1, 0.09, 0.09),
    # the garden
    hedge=[(0.2, 0.34, 0.18), (0.18, 0.31, 0.16), (0.22, 0.37, 0.2)],
    hedge_dark=(0.13, 0.24, 0.12),
    lawn=(0.3, 0.42, 0.22),
    water=(0.24, 0.42, 0.52),
    bloom=[(0.8, 0.3, 0.32), (0.86, 0.78, 0.34), (0.62, 0.42, 0.78), (0.92, 0.9, 0.84)],
    food=[(0.82, 0.56, 0.24), (0.66, 0.2, 0.16), (0.88, 0.8, 0.5), (0.5, 0.62, 0.24)],
    sack=(0.72, 0.62, 0.44),
    pewter=(0.6, 0.62, 0.64),
)


def pick(seq, i):
    return seq[int(i) % len(seq)]


def hashf(*k):
    """A stable number in [0, 1) from a few coordinates (no rng: every build is identical)."""
    v = math.sin(sum(x * (12.9898 + 7.233 * i) for i, x in enumerate(k)) + 0.5) * 43758.5453
    return v - math.floor(v)


def tone(color, *k, spread=0.12):
    """A colour nudged up or down by a stable hash of where it stands."""
    return scale_color(color, 1 - spread / 2 + spread * hashf(*k))


# ---------------------------------------------------------------------------
# Solids
# ---------------------------------------------------------------------------
def hexa(p, pts, color, mat, tag=PLAIN):
    """A closed six-sided solid from 8 model-frame corners: 0-3 the bottom ring, 4-7 the top
    ring above them (normals are recalculated at finish)."""
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
    return p.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), color,
                 mat, bevel=bevel)


def cbox(p, cx, cy, cz, sx, sy, sz, color, mat=WOOD, yaw=0.0, bevel=0.0):
    """A box by its centre and size, turned `yaw` about +y."""
    return p.box((cx, cy, cz), (sx, sy, sz), color, mat, bevel=bevel, yaw=yaw)


def flat_face(p, pts, color, mat, facing, tag=FLAT):
    """One flat polygon turned to face `facing` (a model-frame direction)."""
    f = p.face(pts, color, mat, tag)
    f.normal_update()
    if f.normal.dot(P(*facing)) < 0:
        f.normal_flip()
    return f


def disc(p, cx, y, cz, r, color, mat, sides=16, up=True):
    """A flat round face at height y (a rug, a pool's surface, a table top's inlay)."""
    pts = [(cx + math.cos(math.tau * i / sides) * r, y, cz + math.sin(math.tau * i / sides) * r)
           for i in range(sides)]
    return flat_face(p, pts, color, mat, (0, 1 if up else -1, 0))


def cyl(p, x, y0, y1, z, r, color, mat=STONE, sides=12, r1=None, caps=True):
    """An upright cylinder (or a cone frustum with r1)."""
    return p.cylinder((x, y0, z), (x, y1, z), r, color, mat, sides=sides, r1=r1, caps=caps)


class Wall:
    """A straight wall run: u along it from its start, v up (model y), w across it (positive
    outward)."""

    def __init__(self, x0, z0, x1, z1, outward):
        self.x0, self.z0 = x0, z0
        self.length = math.hypot(x1 - x0, z1 - z0)
        self.dx, self.dz = (x1 - x0) / self.length, (z1 - z0) / self.length
        nx, nz = self.dz, -self.dx
        if nx * outward[0] + nz * outward[1] < 0:
            nx, nz = -nx, -nz
        self.nx, self.nz = nx, nz

    def pt(self, u, v, w):
        return (self.x0 + self.dx * u + self.nx * w, v, self.z0 + self.dz * u + self.nz * w)

    def box(self, p, u0, u1, v0, v1, w0, w1, color, mat, tag=PLAIN, v1b=None):
        """A box in wall space; `v1b` slopes its top to that height at u1 (a gable's rake)."""
        w0, w1 = min(w0, w1), max(w0, w1)
        if u1 - u0 < 1e-4 or v1 - v0 < 1e-4 or w1 - w0 < 1e-4:
            return []
        top1 = v1 if v1b is None else v1b
        pts = [self.pt(u0, v0, w0), self.pt(u1, v0, w0), self.pt(u1, v0, w1), self.pt(u0, v0, w1),
               self.pt(u0, v1, w0), self.pt(u1, top1, w0), self.pt(u1, top1, w1), self.pt(u0, v1, w1)]
        return hexa(p, pts, color, mat, tag)

    def skin(self, p, u0, u1, v0, v1, w, side, color, mat, v1b=None, tag=PLAIN):
        """A single face on the wall's plane `w` out, facing `side` (+1 out, -1 in): the
        inside's plaster or dressed stone over the core (2 triangles where a box takes 12).
        `v1b` slopes its top to that height at u1."""
        top1 = v1 if v1b is None else v1b
        f = p.face([self.pt(u0, v0, w), self.pt(u1, v0, w), self.pt(u1, top1, w), self.pt(u0, v1, w)], color, mat,
                   tag)
        f.normal_update()
        if f.normal.dot(P(self.nx * side, 0.0, self.nz * side)) < 0:
            f.normal_flip()
        return f

    def slab(self, p, u0, u1, v0, v1, w, depth, color, mat, tag=PLAIN):
        """A block proud of a face by `depth` (positive out along the normal, negative in):
        only its front and its top are built (4 triangles): the front carries the block's tone,
        the top the course line's highlight."""
        wf = w + depth
        sgn = 1 if depth > 0 else -1
        facing = (self.nx * sgn, 0.0, self.nz * sgn)
        f1 = p.face([self.pt(u0, v0, wf), self.pt(u1, v0, wf), self.pt(u1, v1, wf), self.pt(u0, v1, wf)], color,
                    mat, tag)
        f1.normal_update()
        if f1.normal.dot(P(*facing)) < 0:
            f1.normal_flip()
        f2 = p.face([self.pt(u0, v1, w), self.pt(u1, v1, w), self.pt(u1, v1, wf), self.pt(u0, v1, wf)],
                    scale_color(color, 1.12), mat, tag)
        f2.normal_update()
        if f2.normal.dot(P(0, 1, 0)) < 0:
            f2.normal_flip()
        return [f1, f2]

    def beam(self, p, u0, v0, u1, v1, w, width, depth, color, mat=WOOD, hewn=0.0):
        """A timber on a face from (u0, v0) to (u1, v1), its centre `w` out, `depth` across;
        `hewn` lets each end wander a little and the tone vary (stable hash, no rng)."""
        if hewn > 0:
            du, dv = u1 - u0, v1 - v0
            n = math.hypot(du, dv) or 1.0
            pu, pv = -dv / n, du / n
            ka = (hashf(u0, v0, w, 1) - 0.5) * 2 * hewn
            kb = (hashf(u1, v1, w, 2) - 0.5) * 2 * hewn
            u0, v0 = u0 + pu * ka, v0 + pv * ka
            u1, v1 = u1 + pu * kb, v1 + pv * kb
            width *= 1 + (hashf(u0, v1, 3) - 0.5) * 0.2
            color = scale_color(color, 0.9 + 0.18 * hashf(u0 + u1, v0 + v1, 5))
        a = self.pt(u0, v0, w)
        b = self.pt(u1, v1, w)
        p.beam([a, b], width, depth, color, mat, up=(self.nx, 0, self.nz), caps=False)


def opening_spans(L, openings, v):
    """The runs along a wall of length L that no opening (u0, u1, v0, v1) cuts at height v."""
    runs, u = [], 0.0
    for (a, b) in sorted((a, b) for (a, b, v0, v1) in openings if v0 - 1e-6 <= v <= v1 + 1e-6):
        if a > u:
            runs.append((u, a))
        u = max(u, b)
    if L > u:
        runs.append((u, L))
    return runs


def manor_wall(p, wall, t, top, openings, plinth=2.4, y0=-1.0, seed=0, bays=3.0, inner=True,
               braces=True, frame_from=None, rails=None, inner_color=None, outer=True,
               inner_from=99.0):
    """A Highwatch wall: an ashlar plinth to `plinth` (coursed blocks proud of a mortar core on
    the outer face), sage plaster above between dark timber posts, rails and braces (outer face)
    and pale plaster with oak posts inside. `top(u)` is the wall's top along it (the plate, or a
    gable's rake); `openings` are (u0, u1, v0, v1) holes cut through it."""
    L = wall.length
    half = t / 2
    inner_color = inner_color or PAL['plaster_in']
    cuts = {0.0, L, L / 2}
    for (a, b, _, _) in openings:
        cuts.add(max(0.0, min(L, a)))
        cuts.add(max(0.0, min(L, b)))
    edges = sorted(cuts)
    k = 0
    for i in range(len(edges) - 1):
        ua, ub = edges[i], edges[i + 1]
        if ub - ua < 1e-3:
            continue
        um = (ua + ub) / 2
        holes = sorted([(v0, v1) for (a, b, v0, v1) in openings if a <= um <= b])
        spans, v = [], y0
        for (h0, h1) in holes:
            if h0 > v:
                spans.append((v, h0))
            v = max(v, h1)
        spans.append((v, None))
        for (va, vb) in spans:
            ta, tb = (top(ua), top(ub)) if vb is None else (vb, vb)
            # the stone storey: a mortar core, the courses dressed onto it below
            s_hi_a = min(plinth, ta) if vb is None else min(plinth, vb)
            s_hi_b = min(plinth, tb) if vb is None else min(plinth, vb)
            if max(s_hi_a, s_hi_b) > va + 1e-3:
                wall.box(p, ua, ub, va, s_hi_a, -half + LAYER + 0.01, half, PAL['mortar'], STONE, v1b=s_hi_b)
                if inner and max(s_hi_a, s_hi_b) > max(va, 0.55) + 1e-3:
                    wall.skin(p, ua, ub, max(va, 0.55), s_hi_a, -half, -1,
                              tone(PAL['ashlar_hi'], seed, k, spread=0.06), STONE, v1b=s_hi_b)
            lo = max(va, plinth)
            if vb is None:
                if ta > lo + 1e-3 or tb > lo + 1e-3:
                    wall.box(p, ua, ub, lo, max(ta, lo + 0.01), -half + 0.05, half - 0.05,
                             pick(PAL['plaster'], seed + k), PLASTER, v1b=max(tb, lo + 0.01))
                    if inner:
                        wall.skin(p, ua, ub, lo, max(ta, lo + 0.01), -half, -1,
                                  pick(inner_color, seed + k), PLASTER, v1b=max(tb, lo + 0.01))
            elif vb > lo + 1e-3:
                wall.box(p, ua, ub, lo, vb, -half + 0.05, half - 0.05, pick(PAL['plaster'], seed + k),
                         PLASTER)
                if inner:
                    wall.skin(p, ua, ub, lo, vb, -half, -1, pick(inner_color, seed + k), PLASTER)
            k += 1
    # the ashlar: courses of dressed blocks proud of the core, staggered, each its own tone (a
    # partition's plinth stops a hair over the floor: its courses would lie under the floor's
    # flags, so it has none)
    course = 0.72
    v = y0
    row = 0
    while v < plinth - 0.05 and plinth > 0.7:
        v1 = min(plinth, v + course)
        off = (row % 2) * 0.55
        for (a, b) in opening_spans(L, openings, (v + v1) / 2):
            u = a - off if row % 2 else a
            while u < b - 0.05:
                blen = 1.35 + 0.45 * hashf(u, v, seed)
                u0, u1 = max(a, u), min(b, u + blen)
                if u1 - u0 > 0.12 and v1 <= min(top(u0), top(u1)) + 1e-3:
                    col = tone(pick(PAL['ashlar'], int(hashf(u0, v, 7) * 6)), u0, v, spread=0.14)
                    if outer and v1 > -0.2:
                        wall.slab(p, u0 + 0.025, u1 - 0.025, v + 0.025, v1 - 0.025, half, 0.05, col, STONE)
                    if inner and v1 > inner_from:
                        wall.slab(p, u0 + 0.025, u1 - 0.025, max(v, inner_from) + 0.025, v1 - 0.025, -half, -0.05,
                                  col, STONE)
                u += blen
        v = v1
        row += 1
    # the plinth's dressed coping
    for (a, b) in opening_spans(L, openings, plinth - 0.05):
        if outer:
            wall.box(p, a, b, plinth - 0.06, plinth + 0.1, half - 0.02, half + 0.12, PAL['ashlar_hi'], STONE)
    # the timber frame over the plaster
    frame_from = plinth + 0.1 if frame_from is None else frame_from
    posts = [0.17, L - 0.17]
    for (a, b, v0, v1) in openings:
        if v1 > frame_from + 0.3:
            posts += [a - 0.35, b + 0.35]
    marks = sorted({0.0, L} | {max(0.0, min(L, a)) for (a, _, _, _) in openings}
                   | {max(0.0, min(L, b)) for (_, b, _, _) in openings})
    for i in range(len(marks) - 1):
        a, b = marks[i], marks[i + 1]
        n = int((b - a) / bays)
        for j in range(1, n + 1):
            posts.append(a + (b - a) * j / (n + 1))
    posts = sorted({round(min(max(u, 0.17), L - 0.17), 3) for u in posts})
    for s in ([1] if outer else []) + ([-1] if inner else []):
        w = s * (half + 0.025)
        col = PAL['timber'] if s > 0 else pick(PAL['oak'], seed)
        for i_post, u in enumerate(posts):
            v1 = top(u) - 0.05
            if v1 - frame_from < 0.4:
                continue
            if s < 0 and i_post % 2 == 1 and 0 < i_post < len(posts) - 1:
                continue
            if any(a < u < b and v0 < frame_from + 0.2 < v1b for (a, b, v0, v1b) in openings):
                continue
            wall.beam(p, u, frame_from, u, v1, w, 0.3, 0.1, col, hewn=0.02)
        eave = min(top(0.0), top(L))
        rows = rails if rails is not None else [frame_from + 0.12, frame_from + (eave - frame_from) * 0.52,
                                                 eave - 0.14]
        if s < 0:
            rows = [rows[0], rows[-1]]
        for rv in rows:
            for (a, b) in opening_spans(L, [(a - 0.17, b + 0.17, v0 - 0.1, v1 + 0.1)
                                            for (a, b, v0, v1) in openings], rv):
                if b - a > 0.3 and rv < min(top(a), top(b)):
                    wall.beam(p, a, rv, b, rv, w - s * LAYER, 0.26, 0.1, col, hewn=0.02)
        if braces and s > 0 and len(rows) >= 2:
            lo, hi = rows[0], rows[1]
            for i in range(len(posts) - 1):
                a, b = posts[i], posts[i + 1]
                if b - a < 1.2 or b - a > 4.2:
                    continue
                if any(oa < b and ob > a and v0 < hi and v1 > lo for (oa, ob, v0, v1) in openings):
                    continue
                if (i + seed) % 2 == 0:
                    wall.beam(p, a + 0.12, lo + 0.1, b - 0.12, hi - 0.1, w - s * LAYER, 0.22, 0.09, col, hewn=0.015)
                else:
                    wall.beam(p, a + 0.12, hi - 0.1, b - 0.12, lo + 0.1, w - s * LAYER, 0.22, 0.09, col, hewn=0.015)
    return posts


def window(p, wall, u0, u1, v0, v1, t, lit=True, arch=True, bars=2, inner=True, shutters=False,
           frame=PAL['timber']):
    """A tall glazed window in a wall: a dressed stone surround with a gold keystone, a mullion
    and transoms, small square leaded panes, a stone sill. A lit window's glass glows warm
    (ManorGlow), the hall behind it lit; an unlit one is cool dark glass."""
    half = t / 2
    um = (u0 + u1) / 2
    w = u1 - u0
    # the glass plane in the wall's middle (both faces read it)
    glass = PAL['glass_lit'] if lit else PAL['glass']
    # lit windows in two warm tones, by a stable hash of where they stand
    gm = (GLOW if hashf(wall.x0, wall.z0, u0) < 0.55 else GLOW_SOFT) if lit else STONE
    top_rect = v1 - (w / 2 if arch else 0.0)
    for s in ((1, -1) if inner else (1,)):
        wall.skin(p, u0, u1, v0, top_rect, s * 0.03, s, glass, gm, tag=FLAT)
    if arch:
        # the round head in five glass slices
        n = 6
        for i in range(n):
            a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
            xa, xb = um - math.cos(a0) * w / 2, um - math.cos(a1) * w / 2
            ya, yb = top_rect + math.sin(a0) * w / 2, top_rect + math.sin(a1) * w / 2
            pts = [wall.pt(xa, top_rect, -0.03), wall.pt(xb, top_rect, -0.03), wall.pt(xb, top_rect, 0.03),
                   wall.pt(xa, top_rect, 0.03), wall.pt(xa, ya, -0.03), wall.pt(xb, yb, -0.03),
                   wall.pt(xb, yb, 0.03), wall.pt(xa, ya, 0.03)]
            hexa(p, pts, glass, gm, FLAT)
    # mullion and transoms (leaded grid)
    lead = (0.14, 0.13, 0.13)
    for s in ([1, -1] if inner else [1]):
        g = s * 0.045
        wall.box(p, um - 0.05, um + 0.05, v0, top_rect, g - 0.02, g + 0.02, lead, METAL)
        for k in range(1, bars + 1 if s > 0 else 1):
            vv = v0 + (top_rect - v0) * k / (bars + 1)
            wall.box(p, u0, u1, vv - 0.03, vv + 0.03, g - 0.02, g + 0.02, lead, METAL)
        # quarry leading: two more uprights (outside only)
        for f in ((0.25, 0.75) if s > 0 else ()):
            uu = u0 + w * f
            wall.box(p, uu - 0.015, uu + 0.015, v0, top_rect, g - 0.015, g + 0.015, lead, METAL)
    # the stone surround: jambs, the arch's voussoirs, a keystone in gold (outside); inside an
    # oak frame round the reveal
    if inner:
        wall.box(p, u0 - 0.16, u0, v0, top_rect, -half - 0.08, -half + 0.02, PAL['oak_dark'], WOOD)
        wall.box(p, u1, u1 + 0.16, v0, top_rect, -half - 0.08, -half + 0.02, PAL['oak_dark'], WOOD)
    for s in [1]:
        wo = s * half
        wa, wb = (wo - 0.02, wo + 0.12) if s > 0 else (wo - 0.12, wo + 0.02)
        wall.box(p, u0 - 0.28, u0 + LAYER, v0, top_rect, wa, wb, PAL['ashlar_hi'], STONE)
        wall.box(p, u1 - LAYER, u1 + 0.28, v0, top_rect, wa, wb, PAL['ashlar_hi'], STONE)
        if arch:
            n = 5
            r0, r1 = w / 2, w / 2 + 0.3
            for i in range(n):
                a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
                c0, c1 = math.cos(a0), math.cos(a1)
                s0, s1 = math.sin(a0), math.sin(a1)
                pts = [wall.pt(um - c0 * r0, top_rect + s0 * r0, wa), wall.pt(um - c1 * r0, top_rect + s1 * r0, wa),
                       wall.pt(um - c1 * r1, top_rect + s1 * r1, wa), wall.pt(um - c0 * r1, top_rect + s0 * r1, wa),
                       wall.pt(um - c0 * r0, top_rect + s0 * r0, wb), wall.pt(um - c1 * r0, top_rect + s1 * r0, wb),
                       wall.pt(um - c1 * r1, top_rect + s1 * r1, wb), wall.pt(um - c0 * r1, top_rect + s0 * r1, wb)]
                key = i == n // 2
                hexa(p, pts, PAL['gold'] if key else tone(PAL['ashlar_hi'], i, u0), METAL if key else STONE)
        else:
            wall.box(p, u0 - 0.28, u1 + 0.28, v1, v1 + 0.3, wa, wb, PAL['ashlar_hi'], STONE)
    # the sill
    wall.box(p, u0 - 0.36, u1 + 0.36, v0 - 0.2, v0, -half - 0.06, half + 0.2, PAL['stone_dark'], STONE)
    if shutters:
        for side in (-1, 1):
            a, b = (u0 - 0.3 - w / 2, u0 - 0.3) if side < 0 else (u1 + 0.3, u1 + 0.3 + w / 2)
            for k in range(3):
                pa = a + (b - a) * k / 3 + 0.01
                pb = a + (b - a) * (k + 1) / 3 - 0.01
                wall.box(p, pa, pb, v0, top_rect, half + 0.06, half + 0.13, tone(PAL['blue_dark'], pa, k),
                         WOOD)


def slate_roof(p, e0, along, up, la, lu, seed=0, step=0.66, seg=1.75, thick=0.07, clip=None,
               under=True):
    """A slate slope of blue square-cut slates laid in staggered courses up the slope.

    e0 is the eave corner, `along` the unit vector along the eave, `up` the unit vector up the
    slope, la and lu the slope's extents. Each course
    kicks its lower edge out over the course below; each slate takes its own tone. `clip(s0,
    s1)` returns the list of (a0, a1) spans a course keeps (None or empty skips it). `under`
    lines the slope's underside with boards (seen from inside an open roof)."""
    nx = along[1] * up[2] - along[2] * up[1]
    ny = along[2] * up[0] - along[0] * up[2]
    nz = along[0] * up[1] - along[1] * up[0]
    if ny < 0:
        nx, ny, nz = -nx, -ny, -nz

    def at(a, s, lift):
        return (e0[0] + along[0] * a + up[0] * s + nx * lift,
                e0[1] + along[1] * a + up[1] * s + ny * lift,
                e0[2] + along[2] * a + up[2] * s + nz * lift)

    rows = max(1, int(round(lu / step)))
    rstep = lu / rows
    for r in range(rows):
        s0 = r * rstep
        s1 = min(lu, s0 + rstep * 1.3)
        spans = [(0.0, la)] if clip is None else clip(s0, s1)
        if not spans:
            continue
        off = (r % 2) * seg * 0.5
        a = -off
        j = 0
        while a < la - 1e-3:
            for (lo, hi) in spans:
                a0, a1 = max(lo, a), min(hi, a + seg)
                if a1 - a0 <= 0.15:
                    continue
                # each course's butt kicked well out over the course below (a clear step, never
                # a near-coplanar overlap of the two)
                kick = thick * 2.2
                col = tone(pick(PAL['slate'], int(hashf(r, j, seed) * 6)), r, j, seed, spread=0.16)
                # the slate's face, and its butt edge kicked out over the course below (4
                # triangles: the underside is never seen, the boards or a ceiling hide it)
                top = [at(a0 + 0.02, s0, kick), at(a1 - 0.02, s0, kick), at(a1 - 0.02, s1, thick),
                       at(a0 + 0.02, s1, thick)]
                flat_face(p, top, col, SLATE, (nx, ny, nz), tag=PLAIN)
                butt = [at(a0 + 0.02, s0, kick - thick), at(a1 - 0.02, s0, kick - thick), at(a1 - 0.02, s0, kick),
                        at(a0 + 0.02, s0, kick)]
                flat_face(p, butt, scale_color(col, 0.7), SLATE, (-up[0], -up[1], -up[2]), tag=PLAIN)
            a += seg
            j += 1
    if under:
        # the boarded underside, a hand under the slates
        quad = [at(0, 0, -0.06), at(la, 0, -0.06), at(la, lu, -0.06), at(0, lu, -0.06)]
        flat_face(p, quad, PAL['sarking'], WOOD, (-nx, -ny, -nz), tag=PLAIN)


def encode_for_export(parts):
    """shiplib.finish linearizes every corner colour (**2.2) and the glTF exporter linearizes
    the colour attribute again: pre-encode so the two steps net to one (the tavern's fix)."""
    for piece in parts.values():
        for f in piece.bm.faces:
            for loop in f.loops:
                r, g, b, a = loop[piece.col]
                loop[piece.col] = (r ** (1 / 2.2), g ** (1 / 2.2), b ** (1 / 2.2), a)
