"""Composite distance primitives and body-conforming layers for the trash kit.

  Shell(p, t)        a hollow skin of thickness t over a primitive (onion)
  Inter(a, b, k)     a cut to inside both; Diff(a, b, k) a minus b
  Plane(p, n)        the half-space behind a plane (n points outward)
  Cone(a, b, ra, rb) alias of RoundCone (for readability of hard parts)

`layer_field(body, lo, hi, voxel, off, thick, mask)` builds a plate, a band of cloth
or a mail curtain that hugs a body field: the region between `off` and `off+thick`
outside the body surface, kept where mask(X, Y, Z) > 0 (a soft 0..1 mask feathers the
edge into a rounded rim). Masks are plain numpy functions of the grid coordinates.
"""
import numpy as np

import sdf
from sdf import BIG, RoundCone, smax, smin


class Shell(sdf.Prim):
    def __init__(self, prim, t, bone=None):
        self.p, self.t, self.bone = prim, float(t), bone or prim.bone
        self.lo, self.hi = prim.lo - t, prim.hi + t

    def dist(self, X, Y, Z):
        return np.abs(self.p.dist(X, Y, Z)) - self.t * 0.5


class Inter(sdf.Prim):
    def __init__(self, a, b, k=0.0, bone=None):
        self.a, self.b, self.k, self.bone = a, b, k, bone or a.bone
        self.lo, self.hi = a.lo, a.hi

    def dist(self, X, Y, Z):
        return smax(self.a.dist(X, Y, Z), self.b.dist(X, Y, Z), self.k)


class Diff(sdf.Prim):
    def __init__(self, a, b, k=0.0, bone=None):
        self.a, self.b, self.k, self.bone = a, b, k, bone or a.bone
        self.lo, self.hi = a.lo, a.hi

    def dist(self, X, Y, Z):
        return smax(self.a.dist(X, Y, Z), -self.b.dist(X, Y, Z), self.k)


class Union(sdf.Prim):
    def __init__(self, parts, k=0.0, bone=None):
        self.parts, self.k = parts, k
        self.bone = bone or parts[0].bone
        self.lo = np.min([p.lo for p in parts], axis=0)
        self.hi = np.max([p.hi for p in parts], axis=0)

    def dist(self, X, Y, Z):
        out = None
        for p in self.parts:
            d = p.dist(X, Y, Z)
            out = d if out is None else smin(out, d, self.k)
        return out


class Plane(sdf.Prim):
    """Inside is behind the plane (opposite the normal). Unbounded: give lo/hi."""

    def __init__(self, point, normal, lo=(-50, -50, -50), hi=(50, 50, 50)):
        self.c = np.asarray(point, float)
        n = np.asarray(normal, float)
        self.n = n / np.linalg.norm(n)
        self.lo, self.hi, self.bone = np.asarray(lo, float), np.asarray(hi, float), None

    def dist(self, X, Y, Z):
        return (X - self.c[0]) * self.n[0] + (Y - self.c[1]) * self.n[1] + (Z - self.c[2]) * self.n[2]


class Prism(sdf.Prim):
    """A convex faceted crystal: the intersection of half-spaces round an axis
    (n facets), capped by a pyramid point at each end. Sharp, for ice."""

    def __init__(self, a, b, r, n=6, tip=0.35, rot=0.0, bone=None, tip_a=None):
        self.a, self.b, self.r, self.bone = np.asarray(a, float), np.asarray(b, float), float(r), bone
        ax = self.b - self.a
        self.L = np.linalg.norm(ax)
        self.ax = ax / self.L
        F = sdf.frame_from(self.ax)
        self.e1, self.e2 = F[:, 0], F[:, 1]
        self.n, self.rot, self.tip = n, rot, tip
        self.tip_a = tip if tip_a is None else tip_a
        e = self.r + 0.02
        self.lo = np.minimum(self.a, self.b) - e
        self.hi = np.maximum(self.a, self.b) + e

    def dist(self, X, Y, Z):
        px, py, pz = X - self.a[0], Y - self.a[1], Z - self.a[2]
        u = px * self.ax[0] + py * self.ax[1] + pz * self.ax[2]
        x = px * self.e1[0] + py * self.e1[1] + pz * self.e1[2]
        y = px * self.e2[0] + py * self.e2[1] + pz * self.e2[2]
        # every side facet, and the pyramid facets that close each end to a
        # point: the radius shrinks to 0 over `tip` of the length at b and
        # `tip_a` at a (each pyramid facet is the side facet tilted inward)
        L = self.L
        tb = max(1e-3, self.tip * L)
        ta = max(1e-3, self.tip_a * L)
        sb, sa = self.r / tb, self.r / ta
        nb, na = np.sqrt(1 + sb * sb), np.sqrt(1 + sa * sa)
        d = None
        for i in range(self.n):
            a = self.rot + np.pi * 2 * i / self.n
            p = x * np.cos(a) + y * np.sin(a)
            di = np.maximum(p - self.r, np.maximum((p + sb * (u - L)) / nb, (p - sa * u) / na))
            d = di if d is None else np.maximum(d, di)
        return d


def Cone(a, b, ra, rb, bone=None):
    return RoundCone(a, b, ra, rb, bone)


def grid(lo, hi, voxel):
    G = sdf.Field(lo, hi, voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    return G, X, Y, Z


def layer_field(body, lo, hi, voxel, off, thick, mask, extra=None, noise=None, edge=0.012):
    """A layer hugging `body` (a sdf.Field) inside the box lo..hi. `off`/`thick` may be
    numbers or functions of (X, Y, Z). The mask's soft edge rounds the rim."""
    G, X, Y, Z = grid(lo, hi, voxel)
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = body.sample(P).reshape(X.shape)
    o = off(X, Y, Z) if callable(off) else off
    t = thick(X, Y, Z) if callable(thick) else thick
    if noise is not None:
        t = t + noise(X, Y, Z)
    shell = np.maximum(db - (o + t), -(db - o))
    m = np.clip(mask(X, Y, Z), 0.0, 1.0)
    # outside the mask the layer recedes: a rounded rim where the mask fades
    shell = np.maximum(shell, (0.5 - m) * 0.2 - edge * 0.0)
    G.d = shell.astype(np.float32)
    if extra is not None:
        extra(G)
    return G


def seg_dist(X, Y, Z, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    l2 = ab @ ab
    px, py, pz = X - a[0], Y - a[1], Z - a[2]
    u = np.clip((px * ab[0] + py * ab[1] + pz * ab[2]) / l2, 0, 1)
    dx, dy, dz = px - ab[0] * u, py - ab[1] * u, pz - ab[2] * u
    return np.sqrt(dx * dx + dy * dy + dz * dz), u


def ramp(x, a, b):
    """0 at a, 1 at b (either order), smooth."""
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
