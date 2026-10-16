"""Signed-distance sculpting for Balgath's body (numpy, meshed through OpenVDB).

The body is not a set of rigid parts: it is ONE continuous skin, sculpted as a
signed-distance field and meshed in a single pass, so the shoulders flow into the
traps, the forearm swells out of the elbow and the gut hangs over the belt the way
flesh does. Every primitive is evaluated only inside its own bounding box (plus its
blend radius), which keeps a 0.035-yard grid over a 14-yard giant to seconds.

  * Primitives return a distance array for a block of grid points: round cones
    (limbs, fingers, muscle bellies), ellipsoids, rounded boxes, tori.
  * `Field.add(prim, k)` is a smooth union with blend radius k; `Field.sub` a smooth
    subtraction (the eye socket, the mouth line, scars); `Field.ridge` raises a thin
    welt (scar tissue, veins).
  * Every primitive carries a BONE tag. The same primitives, evaluated at the final
    mesh's vertices, give the skin weights (soft-min over primitives, summed per bone),
    so a vertex in the elbow crease is shared by the arm and the forearm in exactly
    the proportion the sculpt blends them.
  * Detail (wrinkles, pores, muscle striation) is gradient noise displaced along the
    field, kept small so the field stays a distance.

Deterministic: every noise is seeded, nothing reads the clock.
"""
import math

import numpy as np

BIG = 50.0


# ------------------------------------------------------------------ math
def _v(a):
    return np.asarray(a, dtype=np.float64)


def rot_matrix(rx=0.0, ry=0.0, rz=0.0):
    """Euler XYZ (radians) rotation matrix, applied as R @ p."""
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    my = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    mz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return mz @ my @ mx


def frame_from(axis, up=(0, 0, 1)):
    """An orthonormal frame whose third column is `axis`."""
    z = _v(axis)
    z = z / np.linalg.norm(z)
    u = _v(up)
    if abs(np.dot(u, z)) > 0.95:
        u = _v((1, 0, 0)) if abs(z[0]) < 0.9 else _v((0, 1, 0))
    x = np.cross(u, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def smin(a, b, k):
    """Polynomial smooth minimum (iq)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


# ------------------------------------------------------------------ noise
class Noise:
    """Seeded 3D gradient (Perlin) noise, vectorized over point arrays."""

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
        perm, grad = self.perm, self.grad

        def fade(t):
            return t * t * t * (t * (t * 6 - 15) + 10)

        u, v, w = fade(xf), fade(yf), fade(zf)
        out = 0.0
        acc = []
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    h = perm[perm[perm[xi + dx] + yi + dy] + zi + dz] & 255
                    g = grad[h]
                    dot = g[..., 0] * (xf - dx) + g[..., 1] * (yf - dy) + g[..., 2] * (zf - dz)
                    wx = u if dx else 1 - u
                    wy = v if dy else 1 - v
                    wz = w if dz else 1 - w
                    acc.append(dot * wx * wy * wz)
        out = acc[0]
        for a in acc[1:]:
            out = out + a
        return out

    def fbm(self, x, y, z, octaves=4, lac=2.03, gain=0.5):
        s, amp, total = 1.0, 1.0, 0.0
        for _ in range(octaves):
            total = total + amp * self(x * s, y * s, z * s)
            s *= lac
            amp *= gain
        return total

    def ridged(self, x, y, z, octaves=3):
        """Ridged multifractal-ish: sharp creases (wrinkles, cracks)."""
        s, amp, total = 1.0, 1.0, 0.0
        for _ in range(octaves):
            n = 1.0 - np.abs(self(x * s, y * s, z * s))
            total = total + amp * n * n
            s *= 2.1
            amp *= 0.5
        return total


# ------------------------------------------------------------------ primitives
class Prim:
    """A distance primitive with a bone tag and a bounding box."""

    bone = None
    lo = hi = None

    def dist(self, X, Y, Z):
        raise NotImplementedError

    def dist_pts(self, P):
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


class RoundCone(Prim):
    """iq's round cone between points a and b with radii ra, rb (limbs, fingers)."""

    def __init__(self, a, b, ra, rb, bone=None):
        self.a, self.b, self.ra, self.rb, self.bone = _v(a), _v(b), float(ra), float(rb), bone
        r = max(ra, rb)
        self.lo = np.minimum(self.a, self.b) - r
        self.hi = np.maximum(self.a, self.b) + r

    def dist(self, X, Y, Z):
        a, b, r1, r2 = self.a, self.b, self.ra, self.rb
        ba = b - a
        l2 = float(ba @ ba)
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        px, py, pz = X - a[0], Y - a[1], Z - a[2]
        yv = px * ba[0] + py * ba[1] + pz * ba[2]
        zv = yv - l2
        qx = px * l2 - ba[0] * yv
        qy = py * l2 - ba[1] * yv
        qz = pz * l2 - ba[2] * yv
        x2 = qx * qx + qy * qy + qz * qz
        y2 = yv * yv * l2
        z2 = zv * zv * l2
        k = math.copysign(1.0, rr) * rr * rr * x2
        out = (np.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1
        c1 = np.sign(zv) * a2 * z2 > k
        c2 = np.sign(yv) * a2 * y2 < k
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        out = np.where(c1, d1, np.where(c2, d2, out))
        return out


def Capsule(a, b, r, bone=None):
    return RoundCone(a, b, r, r, bone)


class Ellipsoid(Prim):
    """Approximate ellipsoid distance (iq), rotated by `rot` (3x3, body-to-world)."""

    def __init__(self, c, radii, rot=None, bone=None):
        self.c = _v(c)
        self.r = _v(radii)
        self.R = np.eye(3) if rot is None else _v(rot)
        self.bone = bone
        ext = np.abs(self.R) @ self.r
        self.lo, self.hi = self.c - ext, self.c + ext

    def dist(self, X, Y, Z):
        Rt = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = Rt[0, 0] * px + Rt[0, 1] * py + Rt[0, 2] * pz
        ly = Rt[1, 0] * px + Rt[1, 1] * py + Rt[1, 2] * pz
        lz = Rt[2, 0] * px + Rt[2, 1] * py + Rt[2, 2] * pz
        r = self.r
        k0 = np.sqrt((lx / r[0]) ** 2 + (ly / r[1]) ** 2 + (lz / r[2]) ** 2)
        k1 = np.sqrt((lx / r[0] ** 2) ** 2 + (ly / r[1] ** 2) ** 2 + (lz / r[2] ** 2) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)


def Sphere(c, r, bone=None):
    return Ellipsoid(c, (r, r, r), None, bone)


class RoundBox(Prim):
    def __init__(self, c, half, rot=None, radius=0.05, bone=None):
        self.c, self.h, self.rad, self.bone = _v(c), _v(half), float(radius), bone
        self.R = np.eye(3) if rot is None else _v(rot)
        ext = np.abs(self.R) @ (self.h + self.rad)
        self.lo, self.hi = self.c - ext, self.c + ext

    def dist(self, X, Y, Z):
        Rt = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = np.abs(Rt[0, 0] * px + Rt[0, 1] * py + Rt[0, 2] * pz) - self.h[0]
        ly = np.abs(Rt[1, 0] * px + Rt[1, 1] * py + Rt[1, 2] * pz) - self.h[1]
        lz = np.abs(Rt[2, 0] * px + Rt[2, 1] * py + Rt[2, 2] * pz) - self.h[2]
        out = np.sqrt(np.maximum(lx, 0) ** 2 + np.maximum(ly, 0) ** 2 + np.maximum(lz, 0) ** 2)
        return out + np.minimum(np.maximum(lx, np.maximum(ly, lz)), 0.0) - self.rad


class Torus(Prim):
    """A torus of major radius R and tube radius r in the plane normal to `axis`."""

    def __init__(self, c, axis, R, r, bone=None, squash=1.0):
        self.c, self.Rm, self.r, self.bone = _v(c), float(R), float(r), bone
        self.F = frame_from(axis)
        self.squash = squash
        e = R + r
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        F = self.F
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = F[0, 0] * px + F[1, 0] * py + F[2, 0] * pz
        ly = F[0, 1] * px + F[1, 1] * py + F[2, 1] * pz
        lz = (F[0, 2] * px + F[1, 2] * py + F[2, 2] * pz) / self.squash
        q = np.sqrt(lx * lx + ly * ly) - self.Rm
        return np.sqrt(q * q + lz * lz) - self.r


class Polyline(Prim):
    """A tube through a list of points with per-point radii (a chain of round cones)."""

    def __init__(self, pts, radii, bone=None):
        pts = [_v(p) for p in pts]
        if np.isscalar(radii):
            radii = [radii] * len(pts)
        self.cones = [RoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
        self.bone = bone
        self.lo = np.min([c.lo for c in self.cones], axis=0)
        self.hi = np.max([c.hi for c in self.cones], axis=0)

    def dist(self, X, Y, Z):
        out = None
        for c in self.cones:
            d = c.dist(X, Y, Z)
            out = d if out is None else np.minimum(out, d)
        return out


# ------------------------------------------------------------------ field
class Field:
    """A dense distance grid over an axis-aligned box, built by smooth CSG."""

    def __init__(self, lo, hi, voxel):
        self.voxel = float(voxel)
        self.lo = _v(lo)
        n = np.ceil((_v(hi) - self.lo) / voxel).astype(int) + 1
        self.shape = tuple(int(x) for x in n)
        self.d = np.full(self.shape, BIG, dtype=np.float32)
        self.axes = [self.lo[i] + np.arange(self.shape[i]) * voxel for i in range(3)]
        self.prims = []  # (prim, k, kind) for weights and records

    def _block(self, lo, hi):
        i0 = np.clip(np.floor((lo - self.lo) / self.voxel).astype(int), 0, np.array(self.shape) - 1)
        i1 = np.clip(np.ceil((hi - self.lo) / self.voxel).astype(int) + 1, 0, np.array(self.shape))
        sl = tuple(slice(int(a), int(b)) for a, b in zip(i0, i1))
        if any(s.stop <= s.start for s in sl):
            return None, None
        X, Y, Z = np.meshgrid(self.axes[0][sl[0]], self.axes[1][sl[1]], self.axes[2][sl[2]], indexing='ij')
        return sl, (X, Y, Z)

    def add(self, prim, k=0.2, weight=True):
        sl, P = self._block(prim.lo - k * 1.5 - 0.1, prim.hi + k * 1.5 + 0.1)
        if sl is None:
            return
        d = prim.dist(*P).astype(np.float32)
        self.d[sl] = smin(self.d[sl], d, k)
        if weight and prim.bone:
            self.prims.append((prim, k))

    def sub(self, prim, k=0.1):
        sl, P = self._block(prim.lo - k * 1.5 - 0.1, prim.hi + k * 1.5 + 0.1)
        if sl is None:
            return
        d = prim.dist(*P).astype(np.float32)
        self.d[sl] = smax(self.d[sl], -d, k)

    def intersect(self, prim, k=0.05):
        """Clip the whole field to inside `prim` (used for plates)."""
        X, Y, Z = np.meshgrid(*self.axes, indexing='ij')
        d = prim.dist(X, Y, Z).astype(np.float32)
        self.d = smax(self.d, d, k)

    def ridge(self, prim, height, k=0.04):
        """A raised welt along a primitive (scar tissue, a vein): the field is
        pushed outward where the primitive's own (thin) distance is near zero."""
        sl, P = self._block(prim.lo - 0.3, prim.hi + 0.3)
        if sl is None:
            return
        d = prim.dist(*P).astype(np.float32)
        bump = height * np.exp(-np.maximum(d, 0.0) ** 2 / (k * k))
        self.d[sl] -= bump * (np.abs(self.d[sl]) < 0.4)

    def groove(self, prim, depth, k=0.04):
        sl, P = self._block(prim.lo - 0.3, prim.hi + 0.3)
        if sl is None:
            return
        d = prim.dist(*P).astype(np.float32)
        cut = depth * np.exp(-np.maximum(d, 0.0) ** 2 / (k * k))
        self.d[sl] += cut * (np.abs(self.d[sl]) < 0.4)

    def displace(self, fn, band=0.35, region=None):
        """Add fn(X, Y, Z) to the field near its surface (|d| < band). `region`
        (lo, hi) limits the work to a box."""
        if region is None:
            top = self.lo + (np.array(self.shape) - 1) * self.voxel
            step = 32 * self.voxel
            z = self.lo[2]
            while z <= top[2]:
                lo = np.array((self.lo[0], self.lo[1], z))
                hi = np.array((top[0], top[1], min(top[2], z + step - self.voxel * 0.5)))
                self.displace(fn, band, (lo, hi))
                z += step
            return
        lo, hi = region
        i0 = np.clip(np.round((_v(lo) - self.lo) / self.voxel).astype(int), 0, np.array(self.shape) - 1)
        i1 = np.clip(np.round((_v(hi) - self.lo) / self.voxel).astype(int) + 1, 0, np.array(self.shape))
        sl = tuple(slice(int(a), int(b)) for a, b in zip(i0, i1))
        if any(s.stop <= s.start for s in sl):
            return
        block = self.d[sl]
        near = np.abs(block) < band
        if not near.any():
            return
        ii = np.nonzero(near)
        X = self.axes[0][sl[0]][ii[0]]
        Y = self.axes[1][sl[1]][ii[1]]
        Z = self.axes[2][sl[2]][ii[2]]
        block[near] += fn(X, Y, Z).astype(np.float32)
        self.d[sl] = block

    def sample(self, P):
        """Trilinear sample of the field at points P (n, 3)."""
        f = (P - self.lo) / self.voxel
        i = np.clip(np.floor(f).astype(int), 0, np.array(self.shape) - 2)
        t = np.clip(f - i, 0, 1)
        d = self.d
        out = 0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                    out = out + w * d[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        return out

    def gradient(self, P, h=None):
        h = h or self.voxel
        g = np.zeros_like(P)
        for a in range(3):
            e = np.zeros(3)
            e[a] = h
            g[:, a] = (self.sample(P + e) - self.sample(P - e)) / (2 * h)
        n = np.linalg.norm(g, axis=1, keepdims=True)
        return g / np.maximum(n, 1e-9)


def to_mesh(field, name, bpy, adaptivity=0.0, workdir=None):
    """Mesh the zero level set through OpenVDB + Blender's Volume to Mesh."""
    import os
    import tempfile

    import openvdb as vdb

    g = vdb.FloatGrid(background=float(BIG))
    g.copyFromArray(field.d)
    g.transform = vdb.createLinearTransform(voxelSize=field.voxel)
    g.name = 'density'
    workdir = workdir or tempfile.gettempdir()
    path = os.path.join(workdir, f'{name}.vdb')
    vdb.write(path, grids=[g])
    before = set(bpy.data.objects)
    bpy.ops.object.volume_import(filepath=path)
    vol = [o for o in bpy.data.objects if o not in before][0]
    vol.location = tuple(field.lo)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('v2m', 'VOLUME_TO_MESH')
    mod.object = vol
    mod.grid_name = 'density'
    mod.threshold = 0.0
    mod.adaptivity = adaptivity
    mod.resolution_mode = 'GRID'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mesh.name = name
    ob.modifiers.clear()
    ob.data = mesh
    bpy.data.objects.remove(vol, do_unlink=True)
    ob.name = name
    # Volume to Mesh winds faces inward for a negative-inside field: flip if so.
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return ob


def skin_weights(prims, P, tau=0.22, floor=1e-3):
    """Per-vertex bone weights from the sculpt's own primitives: a soft-min over the
    primitives' distances (temperature `tau`, yards), summed per bone. Returns
    (bones, W) with W (n_vertices, n_bones), rows summing to 1."""
    bones = sorted({p.bone for p, _ in prims})
    idx = {b: i for i, b in enumerate(bones)}
    n = len(P)
    D = np.full((len(prims), n), BIG)
    for j, (p, k) in enumerate(prims):
        D[j] = p.dist_pts(P)
    dmin = D.min(axis=0)
    E = np.exp(-(D - dmin) / tau)
    W = np.zeros((n, len(bones)))
    for j, (p, k) in enumerate(prims):
        W[:, idx[p.bone]] += E[j]
    W /= W.sum(axis=1, keepdims=True)
    W[W < floor] = 0
    W /= W.sum(axis=1, keepdims=True)
    return bones, W
