"""The one sculpt grammar the Heart's four wall landmarks share (the AAA pass's third
round, 2026-11-04). The four had grown four languages: the Hammer's level courses of
worked blocks read as flat brown slabs, the Breath's wind-eaten lobes as a lilac blob
with black slits (its shelves' overhangs), the Quench's snow swells as pillows and the
Heat's heaped blocks as black faces. Now each is the same mountain rock (the rock kit's
calm grammar, rock_sculpt.rock_wall, turned round the rim) and only its element differs:

  - a few great columns along the run, each a broad plane turned a little its own way
    and bevelled back at its edges where a cleft or the run's end cuts it (one mass,
    never a row of pillars);
  - deep clefts between some of them, wandering down from the crest;
  - every lift a ledge stepping back as the cliff climbs (lit tops, a drip-edge over
    the face below, each column taking its beds a little higher or lower);
  - the crest a table tipped one way per column, a corner chopped off, falling back to
    the crown; a great fracture plane off one corner of most columns;
  - the run's ends turned back into the mountain (`_env`'s swell low at both ends).

`crag` puts that mass into a landmark's field; each landmark then adds its element (the
Heat's column bundles, crater and lava; the Hammer's great hammer and gold; the Quench's
spires and falls; the Breath's horns and split) and paints it with the one painted-stone
recipe (landmark_paint.stone_shader) in its own palette.

Deterministic: every draw is the piece's own seeded rng or a seeded noise.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from jaguar_head_sculpt import Noise, Polyline

# The landmarks' lift (yards): smaller than the mountain's (their cliffs are some
# twenty yards at the crown, the mountain's a hundred).
CRAG_LIFT = 4.6


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class Spall(gs.Prim if hasattr(gs, 'Prim') else object):
    """A spall knocked off the rock: the part of a ball past a plane through its
    centre, one flat oblique facet and a broken rim (rock_sculpt.Lens's shape)."""

    def __init__(self, c, n, r):
        n = np.asarray(n, dtype=np.float64)
        self.n = n / np.linalg.norm(n)
        self.c = np.asarray(c, dtype=np.float64)
        self.r = float(r)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def dist(self, X, Y, Z):
        dx, dy, dz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        plane = -(dx * self.n[0] + dy * self.n[1] + dz * self.n[2])
        ball = np.sqrt(dx * dx + dy * dy + dz * dz) - self.r
        return np.maximum(plane, ball)

    def at(self, P):
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


class ArcCrag(gs.Prim if hasattr(gs, 'Prim') else object):
    """The mass of one landmark's cliff along the rim: everything past its front (a
    radius that climbs back lift by lift) and under its crest, between the run's ends.
    `top(d, r)` the crest's height at (degrees round from the bearing, radius)."""

    def __init__(self, F, lo, hi, front, top, r_back, span):
        self.F = F
        self.span = span
        self.front = front
        self.top = top
        self.r_back = r_back
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        F = self.F
        u = X * F.ox + Y * F.oy
        v = X * F.sx + Y * F.sy
        R = np.sqrt(X * X + Y * Y)
        d = np.degrees(np.arctan2(v, u))
        body = (self.front(d, Z) - R) * 0.7
        crest = (Z - self.top(d, R)) * 0.6
        back = R - self.r_back
        # Never past the run's ends (a seam's horn stands just beyond them).
        d0, d1 = self.span
        ends = np.maximum(d0 - d, d - d1) * np.radians(1.0) * R
        return np.maximum(np.maximum(np.maximum(body, crest), back), ends)

    def at(self, P):
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


def crag(f, F, rng, span, r_lip, top_fn, label, *, cols=5, clefts=0.6, setback=(0.7, 1.8), lean=0.32,
         r_back=96.0, depth_cut=-28.0, cleft_depth=(2.2, 3.4), spalls=16, partings=10):
    """Put a landmark's cliff into the field `f` (its frame `F`, its run `span` in
    degrees round from the bearing, its foot at `r_lip`, its crest `top_fn(d, r)`).
    `cols` the columns along the run, `clefts` the share of their joins cut as clefts,
    `setback` the step back of a strong ledge, `lean` how far it lays back per yard
    climbed. Returns the clefts' bearings (for the element's detail)."""
    d0, d1 = span
    nf = Noise(int(rng.integers(1, 1 << 20)))
    w = rng.dirichlet(np.full(cols, 2.4)) * 0.6 + 0.4 / cols
    w = w / w.sum() * (d1 - d0)
    bounds = np.concatenate([[d0], d0 + np.cumsum(w)])
    col = []
    for i in range(cols):
        a, b = float(bounds[i]), float(bounds[i + 1])
        col.append(dict(a=a, b=b, c=(a + b) / 2, hw=(b - a) / 2,
                        off=float(rng.uniform(-0.6, 1.8)), tilt=float(rng.uniform(-0.09, 0.09)),
                        bev=float(rng.uniform(0.72, 0.88)), bslope=float(rng.uniform(0.25, 0.5)),
                        bedk=float(rng.uniform(0.5, 1.5)), bph=float(rng.uniform(0.0, 0.7)) * CRAG_LIFT,
                        # Its beds slope along the run (a ledge climbs or falls,
                        # never a level terrace round the whole formation).
                        bslant=float(rng.uniform(-0.28, 0.28)),
                        swell=float(rng.uniform(0.82, 1.12)), tslope=float(rng.uniform(-0.06, 0.06)),
                        chop=float(rng.uniform(0.04, 0.16)), cside=-1.0 if rng.random() < 0.5 else 1.0,
                        shave=rng.random() < 0.6, sside=-1.0 if rng.random() < 0.5 else 1.0,
                        sz=float(rng.uniform(3.0, 9.0)), sdepth=float(rng.uniform(0.25, 0.45))))
    cut = [rng.random() < clefts for _ in range(cols - 1)]
    for i, c in enumerate(col):
        c['bev_l'] = 1.0 if i == 0 or cut[i - 1] else 0.2
        c['bev_r'] = 1.0 if i == cols - 1 or cut[i] else 0.2
    cleft = [dict(d=float(bounds[k + 1]), depth=float(rng.uniform(*cleft_depth)),
                  w=float(rng.uniform(0.9, 1.6)), arc=float(rng.uniform(-0.8, 0.8)), ph=float(rng.uniform(0, 6.28)),
                  z_end=float(rng.uniform(-2.0, 6.0)))
             for k in range(cols - 1) if cut[k]]
    n_lift = 16
    strong = rng.random(n_lift) < 0.5
    strong[0] = False
    steps = np.where(strong, rng.uniform(*setback, n_lift), 0.25)
    backs = np.cumsum(steps)

    def per_col(D, key, default=0.0):
        out = np.full_like(D, default)
        for c in col:
            out = np.where((D >= c['a'] - 1e-6) & (D <= c['b'] + 1e-6), c[key], out)
        return out

    def front(D, Z):
        # Each column takes the beds its own way (a deep ledge here, a shallow one
        # there: the line runs on, never a belt round the whole formation).
        bph = per_col(D, 'bph') + per_col(D, 'bslant') * (D - per_col(D, 'c'))
        bedk = per_col(D, 'bedk', 1.0)
        u = np.maximum(Z + bph, 0.0) / CRAG_LIFT
        i = np.clip(np.floor(u).astype(np.int64), 0, n_lift - 1)
        fr = u - np.floor(u)
        beds = backs[i] + steps[np.minimum(i + 1, n_lift - 1)] * _sstep(0.88, 1.0, fr)
        r = r_lip + 1.0 + beds * bedk + np.maximum(Z, 0.0) * lean * 0.35
        r = r + 0.7 * nf.fbm(D * 0.12, 0.0 * D, Z * 0.06, 2)
        colv = np.zeros_like(D)
        for c in col:
            inside = (D >= c['a'] - 1e-6) & (D <= c['b'] + 1e-6)
            e = np.abs(D - c['c']) / c['hw']
            side_r = (D - c['c']) > 0
            bevel = np.where(side_r, c['bev_r'], c['bev_l'])
            v = c['off'] + c['tilt'] * (D - c['c']) * 3.0 + bevel * np.maximum(0.0, e - c['bev']) * c['hw'] * c['bslope'] * 6.0
            if c['shave']:
                edge = c['c'] + c['sside'] * c['hw']
                cutv = (c['sside'] * (D - edge) + c['sdepth'] * c['hw']) * 1.6 + (Z - c['sz']) * 0.3 + c['off']
                v = np.maximum(v, np.where(Z > c['sz'] - 2.0, cutv, -1e3))
            colv = np.where(inside, v, colv)
        r = r + colv
        for c in cleft:
            dc = c['d'] + c['arc'] * np.sin(Z * 0.12 + c['ph'])
            wd = c['w'] * (0.8 + 0.04 * np.maximum(Z, 0.0))
            r = r + c['depth'] * np.maximum(0.0, 1.0 - np.abs(D - dc) / wd) ** 1.2 * _sstep(c['z_end'] - 1.5, c['z_end'] + 1.5, Z)
        # The run's ends turn back (a formation's end shows rock falling away).
        t0 = np.clip((D - d0) / 5.0, 0.0, 1.0)
        t1 = np.clip((d1 - D) / 5.0, 0.0, 1.0)
        r = r + (1.0 - np.minimum(t0, t1)) ** 2 * 9.0
        return r

    def top(D, R):
        z = top_fn(D, R)
        k = per_col(D, 'swell', 1.0)
        z = z * k + per_col(D, 'tslope') * (D - per_col(D, 'c')) * 6.0
        # A corner chopped off each column's top (an oblique facet, never a pillow).
        for c in col:
            inside = (D >= c['a'] - 1e-6) & (D <= c['b'] + 1e-6)
            edge = c['c'] + c['cside'] * c['hw']
            chop = z - c['chop'] * 30.0 * np.maximum(0.0, 1.0 - np.abs(D - edge) / (c['hw'] * 0.8))
            z = np.where(inside, chop, z)
        for c in cleft:
            z = z - 1.6 * np.maximum(0.0, 1.0 - np.abs(D - c['d']) / (c['w'] * 3.0)) ** 1.5
        return z + 0.5 * nf.fbm(D * 0.2 + 3.0, R * 0.08, 1.0 + 0.0 * D, 2)

    lo = (f.lo[0], f.lo[1], depth_cut)
    hi = (f.lo[0] + f.voxel * f.shape[0], f.lo[1] + f.voxel * f.shape[1], f.lo[2] + f.voxel * f.shape[2])
    f.put(label, ArcCrag(F, lo, hi, front, top, r_back, span), 0.6)
    # Great spalls knocked off the columns' faces (crisp oblique facets catching
    # the light: the rock reads broken and angular, never a smooth clay mass).
    one = lambda v: np.array([float(v)])  # noqa: E731
    for _ in range(spalls):
        d = float(rng.uniform(d0 + 4.0, d1 - 4.0))
        z = float(rng.uniform(1.0, 13.0))
        r = float(front(one(d), one(z))[0])
        if z > float(top(one(d), one(r + 1.0))[0]) - 1.0:
            continue
        side = -1.0 if rng.random() < 0.5 else 1.0
        a = math.radians(F.bearing + d)
        out = np.array([math.sin(a), -math.cos(a), 0.0])
        across = np.array([math.cos(a), math.sin(a), 0.0]) * side
        c = np.array(F.ad(d, r + 0.4, z))
        n = out * 0.7 + across * 0.8 + np.array([0.0, 0.0, float(rng.uniform(-0.5, 0.6))])
        f.sub(Spall(tuple(c), tuple(n), float(rng.uniform(2.0, 3.8))), 0.15)
    # Partings: thin cracks running down the faces beside the clefts and across
    # the columns, wandering (the small work clusters where the eye goes).
    for k in range(partings):
        d = (cleft[k % len(cleft)]['d'] + float(rng.uniform(-3.0, 3.0))) if cleft else float(rng.uniform(d0 + 4, d1 - 4))
        z = float(rng.uniform(5.0, 14.0))
        pts = []
        while z > 0.5:
            r = float(front(one(d), one(z))[0])
            pts.append(F.ad(d, r - 0.05, z))
            d += float(rng.uniform(-0.6, 0.6))
            z -= float(rng.uniform(1.2, 2.4))
        if len(pts) > 2:
            f.groove(Polyline(pts, 0.08), 0.32, 0.14)
    return [c['d'] for c in cleft]
