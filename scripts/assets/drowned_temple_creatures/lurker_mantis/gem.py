"""Cut-crystal primitives: a convex polytope circumscribed round a smooth
convex shape, so a body sculpted from ellipsoids and cones comes out as hard
planar facets meeting at sharp (barely bevelled) edges, like cut glass.

  Gem(support, centre, size, normals, bevel, bone)
      the intersection of the half-spaces n . p <= h(n) + cut, where h is the
      support function of the shape it circumscribes
  gem_ellipsoid(c, radii, n, seed, rot, bevel, chip, bone)
      an ellipsoid cut into about n facets (a Fibonacci sphere, jittered)
  gem_column(a, b, ra, rb, sides, seed, bevel, chip, bone, rings)
      a round cone cut as a crystal column: rings of long facets round its
      axis and short bevel facets toward each end

`chip` cuts each plane a little deeper at random (in yards) so neighbouring
facets come out in different sizes, as on a broken gem rather than a die.
The distance is a max of plane distances: exact on the faces, a lower bound
past an edge, which is all the mesher and the skin weights need.
"""
import math

import numpy as np

import sdf
from sdf import smax


class Gem(sdf.Prim):
    def __init__(self, normals, offsets, lo, hi, bevel=0.015, bone=None):
        self.N = np.asarray(normals, float)
        self.h = np.asarray(offsets, float)
        self.bevel, self.bone = float(bevel), bone
        self.lo, self.hi = np.asarray(lo, float), np.asarray(hi, float)

    def dist(self, X, Y, Z):
        d = None
        for (nx, ny, nz), h in zip(self.N, self.h):
            di = X * nx + Y * ny + Z * nz - h
            d = di if d is None else (smax(d, di, self.bevel) if self.bevel > 0 else np.maximum(d, di))
        return d


def _fib(n, rng, jitter=0.18):
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        a = ga * i
        v = np.array((r * math.cos(a), r * math.sin(a), z)) + rng.normal(0, jitter, 3)
        out.append(v / np.linalg.norm(v))
    return np.array(out)


def gem_ellipsoid(c, radii, n=20, seed=1, rot=None, bevel=0.015, chip=0.03, bone=None, jitter=0.18):
    rng = np.random.default_rng(seed)
    c = np.asarray(c, float)
    r = np.asarray(radii, float)
    R = np.eye(3) if rot is None else np.asarray(rot, float)
    N = _fib(n, rng, jitter)
    # support of the ellipsoid c + R diag(r) u, |u| = 1, along n
    M = R @ np.diag(r)
    h = N @ c + np.linalg.norm(N @ M, axis=1) - rng.uniform(0, chip, n)
    e = float(r.max()) + 0.05
    return Gem(N, h, c - e, c + e, bevel, bone)


def gem_column(a, b, ra, rb, sides=7, seed=1, bevel=0.015, chip=0.03, bone=None,
               rings=((0.0, 1.0), (40.0, 0.5), (-40.0, 0.5)), twist=None):
    """Rings: (elevation from the axis's normal plane in degrees, share of
    `sides`). 0 is the long column faces; +/- tilts face toward b / a."""
    rng = np.random.default_rng(seed)
    a, b = np.asarray(a, float), np.asarray(b, float)
    ax = b - a
    L = np.linalg.norm(ax)
    ax = ax / L
    F = sdf.frame_from(ax)
    e1, e2 = F[:, 0], F[:, 1]
    rot0 = rng.uniform(0, 2 * math.pi) if twist is None else twist
    N = []
    for el, share in rings:
        k = max(3, int(round(sides * share)))
        off = rng.uniform(0, 2 * math.pi)
        for i in range(k):
            az = rot0 + off + 2 * math.pi * (i + rng.uniform(-0.18, 0.18)) / k
            e = math.radians(el + rng.uniform(-6, 6))
            v = (e1 * math.cos(az) + e2 * math.sin(az)) * math.cos(e) + ax * math.sin(e)
            N.append(v / np.linalg.norm(v))
    # the end caps
    N.append(ax)
    N.append(-ax)
    N = np.array(N)
    h = np.maximum(N @ a + ra, N @ b + rb) - rng.uniform(0, chip, len(N))
    e = max(ra, rb) + 0.05
    return Gem(N, h, np.minimum(a, b) - e, np.maximum(a, b) + e, bevel, bone)
