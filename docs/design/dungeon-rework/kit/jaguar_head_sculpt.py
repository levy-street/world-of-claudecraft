"""The colossal stone jaguar's head, SCULPTED (build_wildheart_basin_kit.py jaguar_head).

The phase A head was boxes and lofts: it read as a bulldog from the shrine
terrace. This is one continuous carved mass instead, sculpted as a signed-distance
field (smooth unions, carved subtractions, eroded by noise) and meshed in a single
pass through OpenVDB, the way the basin's creatures are built
(scripts/assets/wildheart_great_jaguar/sdf.py): a big cat's skull, low and broad,
the cranium sweeping into a long heavy muzzle; sharp cheekbones under angular
planes; the brow driven down in fury over slanted almond sockets (the glowing eyes,
Kit_JaguarEyes, sit in them); the maw roaring open with four crossed canines,
incisors and carnassials; snarl furrows on the bridge; ears laid back; rosettes and
cheek scrolls carved in; the whole of it eroded, cracked and chipped by centuries.

Then decimated to a hero budget and handed back as plain faces with a colour each
(stone, the dark throat, bone teeth, the nose leather, ochre and war-red paint), so
the kit's weathering (BPiece.finish: rain streaks, grime, cavity damp, worn edges,
moss on every ledge) runs over it like every other piece.

Coordinates: the kit's (yards, +Z up, the face toward -Y, origin at the base
centre), the same frame the phase A head used, so the eyes, the placement and the
roots keep their marks: the eye sockets at (+-12, -13.4, 49.2), the maw between
z 16 and 29, the muzzle's nose at y -28.

Deterministic: every noise is seeded, nothing reads the clock.
"""
import math
import os
import tempfile

import numpy as np

BIG = 60.0


# ------------------------------------------------------------------ math
def _v(a):
    return np.asarray(a, dtype=np.float64)


def rot(rx=0.0, ry=0.0, rz=0.0):
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Noise:
    """Seeded 3D gradient noise, vectorized."""

    def __init__(self, seed=1):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)
        g = rng.normal(size=(256, 3))
        self.grad = g / np.linalg.norm(g, axis=1, keepdims=True)

    def __call__(self, x, y, z):
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        zi = np.floor(z).astype(np.int64)
        xf, yf, zf = x - xi, y - yi, z - zi
        xi &= 255
        yi &= 255
        zi &= 255

        def fade(t):
            return t * t * t * (t * (t * 6 - 15) + 10)

        u, v, w = fade(xf), fade(yf), fade(zf)
        out = 0.0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    h = self.perm[self.perm[self.perm[xi + dx] + yi + dy] + zi + dz] & 255
                    g = self.grad[h]
                    dot = g[..., 0] * (xf - dx) + g[..., 1] * (yf - dy) + g[..., 2] * (zf - dz)
                    out = out + dot * (u if dx else 1 - u) * (v if dy else 1 - v) * (w if dz else 1 - w)
        return out

    def fbm(self, x, y, z, octaves=4):
        s, amp, total = 1.0, 1.0, 0.0
        for _ in range(octaves):
            total = total + amp * self(x * s, y * s, z * s)
            s *= 2.03
            amp *= 0.5
        return total

    def ridged(self, x, y, z, octaves=3):
        s, amp, total = 1.0, 1.0, 0.0
        for _ in range(octaves):
            n = 1.0 - np.abs(self(x * s, y * s, z * s))
            total = total + amp * n * n
            s *= 2.1
            amp *= 0.5
        return total


# ------------------------------------------------------------------ primitives
class Prim:
    lo = hi = None

    def dist(self, X, Y, Z):
        raise NotImplementedError

    def at(self, P):
        """Distance at points P (n, 3)."""
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


class Ellipsoid(Prim):
    def __init__(self, c, r, R=None):
        self.c = _v(c)
        self.r = _v(r)
        self.R = np.eye(3) if R is None else R
        e = float(np.max(self.r))
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        Ri = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = Ri[0, 0] * px + Ri[0, 1] * py + Ri[0, 2] * pz
        ly = Ri[1, 0] * px + Ri[1, 1] * py + Ri[1, 2] * pz
        lz = Ri[2, 0] * px + Ri[2, 1] * py + Ri[2, 2] * pz
        k0 = np.sqrt((lx / self.r[0]) ** 2 + (ly / self.r[1]) ** 2 + (lz / self.r[2]) ** 2)
        k1 = np.sqrt((lx / self.r[0] ** 2) ** 2 + (ly / self.r[1] ** 2) ** 2 + (lz / self.r[2] ** 2) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class RoundBox(Prim):
    def __init__(self, c, half, rounding, R=None):
        self.c = _v(c)
        self.h = _v(half)
        self.rr = rounding
        self.R = np.eye(3) if R is None else R
        e = float(np.linalg.norm(self.h)) + rounding
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        Ri = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = Ri[0, 0] * px + Ri[0, 1] * py + Ri[0, 2] * pz
        ly = Ri[1, 0] * px + Ri[1, 1] * py + Ri[1, 2] * pz
        lz = Ri[2, 0] * px + Ri[2, 1] * py + Ri[2, 2] * pz
        qx = np.abs(lx) - self.h[0] + self.rr
        qy = np.abs(ly) - self.h[1] + self.rr
        qz = np.abs(lz) - self.h[2] + self.rr
        outside = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        inside = np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0)
        return outside + inside - self.rr


class RoundCone(Prim):
    """A capsule from a (radius ra) to b (radius rb)."""

    def __init__(self, a, b, ra, rb):
        self.a, self.b = _v(a), _v(b)
        self.ra, self.rb = ra, rb
        e = max(ra, rb)
        self.lo = np.minimum(self.a, self.b) - e
        self.hi = np.maximum(self.a, self.b) + e

    def dist(self, X, Y, Z):
        ba = self.b - self.a
        L2 = float(ba @ ba)
        px, py, pz = X - self.a[0], Y - self.a[1], Z - self.a[2]
        t = np.clip((px * ba[0] + py * ba[1] + pz * ba[2]) / L2, 0.0, 1.0)
        dx, dy, dz = px - ba[0] * t, py - ba[1] * t, pz - ba[2] * t
        return np.sqrt(dx * dx + dy * dy + dz * dz) - (self.ra + (self.rb - self.ra) * t)


class Polyline(Prim):
    def __init__(self, pts, radii):
        if np.isscalar(radii):
            radii = [radii] * len(pts)
        self.cones = [RoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
        self.lo = np.min([c.lo for c in self.cones], axis=0)
        self.hi = np.max([c.hi for c in self.cones], axis=0)

    def dist(self, X, Y, Z):
        out = None
        for c in self.cones:
            d = c.dist(X, Y, Z)
            out = d if out is None else np.minimum(out, d)
        return out


class Torus(Prim):
    """A ring of radius R, tube r, round `axis` through c."""

    def __init__(self, c, R, r, axis):
        self.c = _v(c)
        z = _v(axis) / np.linalg.norm(axis)
        u = np.array((0.0, 0.0, 1.0)) if abs(z[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
        x = np.cross(u, z)
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        self.F = np.stack([x, y, z])
        self.R, self.r = R, r
        e = R + r
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = self.F[0, 0] * px + self.F[0, 1] * py + self.F[0, 2] * pz
        ly = self.F[1, 0] * px + self.F[1, 1] * py + self.F[1, 2] * pz
        lz = self.F[2, 0] * px + self.F[2, 1] * py + self.F[2, 2] * pz
        q = np.sqrt(lx * lx + ly * ly) - self.R
        return np.sqrt(q * q + lz * lz) - self.r


# ------------------------------------------------------------------ the field
class Field:
    def __init__(self, lo, hi, voxel):
        self.voxel = float(voxel)
        self.lo = _v(lo)
        n = np.ceil((_v(hi) - self.lo) / voxel).astype(int) + 1
        self.shape = tuple(int(x) for x in n)
        self.d = np.full(self.shape, BIG, dtype=np.float32)
        self.axes = [self.lo[i] + np.arange(self.shape[i]) * voxel for i in range(3)]

    def _block(self, lo, hi):
        i0 = np.clip(np.floor((lo - self.lo) / self.voxel).astype(int), 0, np.array(self.shape) - 1)
        i1 = np.clip(np.ceil((hi - self.lo) / self.voxel).astype(int) + 1, 0, np.array(self.shape))
        sl = tuple(slice(int(a), int(b)) for a, b in zip(i0, i1))
        if any(s.stop <= s.start for s in sl):
            return None, None
        X, Y, Z = np.meshgrid(self.axes[0][sl[0]], self.axes[1][sl[1]], self.axes[2][sl[2]], indexing='ij')
        return sl, (X, Y, Z)

    def add(self, prim, k=0.5):
        sl, P = self._block(prim.lo - k * 1.5 - 0.5, prim.hi + k * 1.5 + 0.5)
        if sl is not None:
            self.d[sl] = smin(self.d[sl], prim.dist(*P).astype(np.float32), k)

    def sub(self, prim, k=0.3):
        sl, P = self._block(prim.lo - k * 1.5 - 0.5, prim.hi + k * 1.5 + 0.5)
        if sl is not None:
            self.d[sl] = smax(self.d[sl], -prim.dist(*P).astype(np.float32), k)

    def groove(self, prim, depth, width):
        sl, P = self._block(prim.lo - width * 3, prim.hi + width * 3)
        if sl is None:
            return
        d = prim.dist(*P).astype(np.float32)
        cut = depth * np.exp(-np.maximum(d, 0.0) ** 2 / (width * width))
        self.d[sl] += cut * (np.abs(self.d[sl]) < depth * 4 + 1.0)

    def displace(self, fn, band=1.5):
        near = np.abs(self.d) < band
        ii = np.nonzero(near)
        X = self.axes[0][ii[0]]
        Y = self.axes[1][ii[1]]
        Z = self.axes[2][ii[2]]
        self.d[near] += fn(X, Y, Z).astype(np.float32)

    def sample(self, P):
        f = (P - self.lo) / self.voxel
        i = np.clip(np.floor(f).astype(int), 0, np.array(self.shape) - 2)
        t = np.clip(f - i, 0, 1)
        out = 0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) \
                        * (t[:, 2] if dz else 1 - t[:, 2])
                    out = out + w * self.d[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        return out

    def gradient(self, P):
        h = self.voxel
        g = np.zeros_like(P)
        for a in range(3):
            e = np.zeros(3)
            e[a] = h
            g[:, a] = (self.sample(P + e) - self.sample(P - e)) / (2 * h)
        n = np.linalg.norm(g, axis=1, keepdims=True)
        return g / np.maximum(n, 1e-9)

    def snap(self, P, lift=0.0, steps=6):
        """Move points onto the surface (plus `lift` outward)."""
        P = np.array(P, dtype=np.float64)
        for _ in range(steps):
            d = self.sample(P) - lift
            P = P - self.gradient(P) * d[:, None]
        return P


# ------------------------------------------------------------------ the carving
SOCKET_X, SOCKET_Y, SOCKET_Z = 12.0, -15.6, 48.8
MAW = dict(c=(0.0, -13.0, 22.6), half=(11.6, 18.6, 6.6))


def _socket(s):
    return Ellipsoid((s * SOCKET_X, SOCKET_Y, SOCKET_Z), (6.9, 4.6, 3.6), rot(ry=-s * 0.3))


def _teeth():
    """Every tooth: (prim, kind) so the colour pass can find them."""
    out = []
    for s in (-1, 1):
        # The four great canines, crossing in the roar.
        out.append(RoundCone((s * 9.2, -22.0, 30.2), (s * 9.8, -24.4, 17.2), 2.15, 0.12))
        out.append(RoundCone((s * 6.8, -21.4, 14.6), (s * 7.2, -23.4, 25.0), 1.75, 0.12))
        # Incisors, upper and lower.
        for k in range(3):
            x = s * (1.6 + k * 1.75)
            out.append(RoundCone((x, -26.0 + k * 0.5, 29.6), (x, -26.7 + k * 0.5, 26.4), 0.8, 0.22))
            out.append(RoundCone((x * 0.92, -23.4 + k * 0.4, 15.2), (x * 0.92, -24.0 + k * 0.4, 17.6), 0.65, 0.2))
        # Carnassials along the jaws, shearing.
        for k in range(4):
            y = -16.0 + k * 3.4
            out.append(RoundCone((s * (10.9 - k * 0.1), y, 29.4), (s * (10.6 - k * 0.1), y - 0.6, 26.6), 1.2, 0.2))
            out.append(RoundCone((s * (9.9 - k * 0.2), y, 15.6), (s * (9.7 - k * 0.2), y - 0.5, 18.0), 1.0, 0.18))
    return out


def _rosettes():
    """Carved rosettes (broken rings) over the cranium, the cheeks and the brow."""
    spots = []
    rng = np.random.default_rng(31)
    for s in (-1, 1):
        for (y, z) in ((-2, 62), (6, 63.5), (13, 57), (4, 53), (-4, 41), (5, 36), (12, 45), (-9, 58), (15, 66)):
            spots.append((s, y + rng.uniform(-0.8, 0.8), z + rng.uniform(-0.8, 0.8), rng.uniform(1.5, 2.3)))
    return spots


def build_field(voxel=0.34):
    f = Field((-33, -35, -4), (33, 30, 84), voxel)
    # The neck and the shoulder mass the head rises from, down into the rim.
    f.add(Ellipsoid((0, 10, 16), (24, 20, 24)), 4)
    # The head: one broad rounded mass, widest across the cheeks; the skull
    # rising behind it, and the flat sloped forehead in front.
    f.add(Ellipsoid((0, -1, 47), (22, 19, 16.5)), 5)
    f.add(Ellipsoid((0, 8, 55), (18, 17, 12)), 5)
    f.add(RoundBox((0, -11.5, 55.5), (11.5, 6.0, 6.5), 3.0, rot(rx=-0.45)), 3.5)
    # The ruff below the cheeks, a soft carved flare toward the jaw.
    f.add(Ellipsoid((0, -2, 35), (22.5, 15, 8)), 6)
    # The muzzle: short, broad and strong, the bridge running down to the
    # wedge of the nose leather; the whisker pads either side.
    f.add(RoundBox((0, -21.0, 39.5), (9.6, 9.5, 6.2), 3.0, rot(rx=0.08)), 3.0)
    f.add(RoundCone((0, -13.0, 52.0), (0, -28.0, 44.6), 4.8, 3.4), 2.0)
    f.add(RoundBox((0, -30.2, 42.4), (4.2, 1.8, 2.6), 1.0, rot(rx=-0.3)), 1.2)
    for s in (-1, 1):
        f.add(Ellipsoid((s * 5.2, -28.2, 36.4), (5.4, 4.2, 4.4)), 2.0)
    # The cheekbones: hard crests under the eyes running back to the ears,
    # the shadow line cut sharp beneath them.
    for s in (-1, 1):
        f.add(Ellipsoid((s * 19.0, -7.0, 46.5), (2.8, 11.5, 2.2), rot(rx=0.1, ry=s * 0.3, rz=s * 0.18)), 1.6)
        f.groove(Polyline([(s * 12.0, -20.0, 40.0), (s * 18.0, -12.5, 41.6), (s * 22.0, -2.0, 42.4)], 0.05), 1.0, 0.8)
    # The brow: heavy ridges driven down at their inner ends in fury, a deep V
    # over the bridge.
    for s in (-1, 1):
        f.add(RoundCone((s * 4.0, -19.0, 51.6), (s * 20.0, -13.0, 55.8), 3.6, 2.6), 1.6)
        f.add(RoundCone((s * 13.0, -15.5, 55.0), (s * 18.0, -9.0, 56.4), 2.6, 1.6), 1.8)
    f.sub(RoundCone((0, -19.0, 52.2), (0, -14.0, 55.0), 1.2, 1.6), 0.8)
    # The forehead furrowed between the brows.
    for x in (-2.2, 0.0, 2.2):
        f.groove(Polyline([(x, -16.5, 54.0), (x * 1.3, -12.5, 59.0), (x * 1.6, -7.0, 62.5)], 0.05), 0.6, 0.45)
    # The almond sockets, slanting up and out (the eyes burn in them).
    for s in (-1, 1):
        f.sub(_socket(s), 1.0)
    # The ears, laid back flat against the skull, their hollows carved.
    for s in (-1, 1):
        # Small, rounded, set low and back on the skull and pinned flat in rage.
        f.add(Ellipsoid((s * 16.5, 12.0, 65.0), (5.6, 2.2, 6.0), rot(rx=-0.6, ry=-s * 0.6, rz=s * 0.35)), 2.0)
        f.sub(Ellipsoid((s * 16.2, 10.8, 65.6), (3.6, 1.3, 4.0), rot(rx=-0.6, ry=-s * 0.6, rz=s * 0.35)), 0.5)
    # The roaring maw: the lower jaw thrust down and forward, the throat open.
    f.add(RoundBox((0, -13.0, 12.4), (12.0, 11.4, 3.8), 2.2, rot(rx=0.16)), 3.0)
    f.add(Ellipsoid((0, -22.6, 11.0), (8.2, 4.4, 4.6)), 2.2)
    f.sub(RoundBox(MAW['c'], MAW['half'], 3.2), 2.4)
    # The tongue, low in the throat.
    f.add(Ellipsoid((0, -7.0, 16.4), (8.0, 11.0, 2.1)), 1.2)
    # Every tooth.
    for t in _teeth():
        f.add(t, 0.45)
    # The nostrils.
    for s in (-1, 1):
        f.sub(Ellipsoid((s * 2.2, -31.8, 41.2), (1.3, 1.2, 0.9)), 0.4)
    # The snarl: deep furrows across the bridge and up from the nose.
    for k in range(3):
        f.groove(Polyline([(-4.6, -24.6 + k * 2.6, 46.2 + k * 0.9), (0, -25.6 + k * 2.6, 47.3 + k * 0.9),
                           (4.6, -24.6 + k * 2.6, 46.2 + k * 0.9)], 0.05), 0.75, 0.55)
    for s in (-1, 1):
        f.groove(Polyline([(s * 3.2, -27.0, 43.8), (s * 6.0, -23.0, 47.0), (s * 9.0, -19.0, 49.0)], 0.05), 0.7, 0.5)
        # Carved scrolls of the cheek ruff, whorling back toward the ears.
        pts = []
        for i in range(26):
            t = i / 25
            a = math.pi * 0.4 + t * math.tau * 1.4
            rr = 5.0 * (1 - t * 0.78)
            pts.append((s * 26.0, -2.0 + math.cos(a) * rr, 30.0 + math.sin(a) * rr))
        f.groove(Polyline(pts, 0.05), 0.65, 0.5)
        for k in range(3):
            y0 = 2.0 + k * 3.2
            f.groove(Polyline([(s * 24.8, y0 - 8, 24), (s * 26.5, y0 - 4, 30), (s * 26.0, y0, 40)], 0.05), 0.5, 0.45)
    # Rosettes carved into the hide of the stone.
    for (s, y, z, r) in _rosettes():
        c = np.array((s * 22.0, y, z))
        out = np.array((s, (y - 4) * 0.02, (z - 50) / 30.0))
        f.groove(Torus(c, r, 0.05, out), 0.95, 0.55)
    # Centuries: weathered, cracked and chipped.
    n1, n2 = Noise(7), Noise(19)
    f.displace(lambda X, Y, Z: 0.55 * n1.fbm(X * 0.11, Y * 0.11, Z * 0.11, 4)
               + 0.18 * n1.fbm(X * 0.42 + 9, Y * 0.42, Z * 0.42, 3))
    f.displace(lambda X, Y, Z: 0.85 * np.maximum(0.0, n2.ridged(X * 0.07, Y * 0.07, Z * 0.05, 3) - 1.0))
    rng = np.random.default_rng(5)
    for (cx, cy, cz, r) in ((20.6, 14.5, 74.0, 2.2), (-22.0, 12.5, 73.0, 1.8), (13.0, -16.0, 6.6, 1.7),
                             (-24.0, -4.0, 51.0, 1.6), (25.0, 2.0, 44.0, 1.4), (-6.0, -29.0, 33.0, 1.2)):
        f.sub(Ellipsoid((cx, cy, cz), (r * rng.uniform(1, 1.6), r, r * rng.uniform(0.8, 1.3))), 0.5)
    return f


def mesh_field(field, bpy, target_tris=30000):
    """Mesh the zero set (OpenVDB + Blender's Volume to Mesh), decimate it to the
    hero budget and return (vertices (n, 3), polygons [vertex index lists])."""
    import bmesh
    import openvdb as vdb

    g = vdb.FloatGrid(background=float(BIG))
    g.copyFromArray(field.d)
    g.transform = vdb.createLinearTransform(voxelSize=field.voxel)
    g.name = 'density'
    path = os.path.join(tempfile.gettempdir(), 'wildheart_jaguar_head.vdb')
    vdb.write(path, grids=[g])
    before = set(bpy.data.objects)
    bpy.ops.object.volume_import(filepath=path)
    vol = [o for o in bpy.data.objects if o not in before][0]
    me = bpy.data.meshes.new('JaguarHeadSculpt')
    ob = bpy.data.objects.new('JaguarHeadSculpt', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('v2m', 'VOLUME_TO_MESH')
    mod.object = vol
    mod.grid_name = 'density'
    mod.threshold = 0.0
    mod.adaptivity = 0.0
    mod.resolution_mode = 'GRID'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = mesh
    bpy.data.objects.remove(vol, do_unlink=True)
    mesh.calc_loop_triangles()
    tris = max(1, len(mesh.loop_triangles))
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, target_tris / tris)
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(out)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    verts = np.array([tuple(v.co) for v in bm.verts]) + field.lo
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob, do_unlink=True)
    return verts, faces


def face_kinds(field, centres, normals):
    """What each face is: 'stone', 'throat', 'tooth', 'tongue', 'leather',
    'lip', 'ochre', 'red', 'rosette'. Vectorized over the face centres."""
    n = len(centres)
    kind = np.array(['stone'] * n, dtype=object)
    X, Y, Z = centres[:, 0], centres[:, 1], centres[:, 2]
    maw = RoundBox(MAW['c'], MAW['half'], 3.2)
    dm = maw.at(centres)
    # The throat: inside the maw's carving, the palate and the gums.
    throat = (dm < 1.4) & (Y > -26.5)
    kind[throat] = 'throat'
    lip = (np.abs(dm) < 2.0) & ~throat & (Y < -14) & (np.abs(X) < 14.5)
    kind[lip] = 'lip'
    tongue = Ellipsoid((0, -7.0, 16.4), (8.0, 11.0, 2.1)).at(centres) < 0.6
    kind[tongue & throat] = 'tongue'
    tooth = np.full(n, np.inf)
    for t in _teeth():
        tooth = np.minimum(tooth, t.at(centres))
    kind[tooth < 0.35] = 'tooth'
    # The nose leather and its nostrils.
    nose = (np.abs(X) < 4.4) & (Y < -29.8) & (Z > 39.6) & (Z < 45.0) & (normals[:, 1] < -0.2)
    kind[nose] = 'leather'
    # Sunbone paint: ochre rings round the sockets, three war-red slashes down
    # each cheek, an ochre chevron along the brow.
    for s in (-1, 1):
        ds = _socket(s).at(centres)
        kind[(ds > 0.2) & (ds < 2.0) & (normals[:, 1] < 0.1) & (kind == 'stone')] = 'ochre'
        for k in range(3):
            slash = RoundCone((s * (19.5 + k * 1.6), -14.5 + k * 1.6, 44.0 - k * 1.3),
                              (s * (23.0 + k * 1.4), -9.5 + k * 1.6, 33.0 - k * 1.3), 0.85, 0.5)
            kind[(np.abs(slash.at(centres)) < 1.2) & (kind == 'stone')] = 'red'
        brow = RoundCone((s * 4.6, -17.4, 53.2), (s * 21.5, -11.6, 59.4), 1.0, 0.7)
        kind[(np.abs(brow.at(centres)) < 1.5) & (normals[:, 2] > 0.1) & (kind == 'stone')] = 'ochre'
    # The rosettes' carved rings read darker (dirt in the groove).
    ring = np.full(n, np.inf)
    for (s, y, z, r) in _rosettes():
        c = np.array((s * 22.0, y, z))
        out = np.array((s, (y - 4) * 0.02, (z - 50) / 30.0))
        ring = np.minimum(ring, Torus(c, r, 0.05, out).at(centres))
    kind[(ring < 0.75) & (kind == 'stone')] = 'rosette'
    return kind
