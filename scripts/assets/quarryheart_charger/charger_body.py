# The Quarryheart Charger's body: floating quarry-stone plates over a body of living fire.
#
# Every surface is built here from code into one MeshAcc (positions, faces, per-loop UVs and
# shading colours, one rigid or blended bone weight set per vertex, and the three custom
# attributes the renderer's plate shader reads):
#   _DIR   the plate's outward direction (zero for anything that is not a plate or the core)
#   _CEN   the plate's centroid in bind space, divided by CEN_SCALE so it stays inside -1..1
#   _KIND  0 the fire body and every fixed piece, 1 a stone plate, 2 the heart core
# Plates are cut from lofted tubes as staggered "bricks": each brick is its cells shrunk toward
# their own centroid (the gap the fire shows through), thickened inward, domed and chipped, and
# bound rigidly to ONE bone, so a joint bends in the gaps and never through a plate.
#
# Frame: Blender Z up, the charger's FRONT toward -Y (glTF export turns that into the game's
# +Y up, +Z front). Units are game yards.

import math

from charger_atlas import R_BASALT, R_ENERGY, R_EYE, R_GOLD, R_ICE, R_STONE, h01, uv_in
from mathutils import Matrix, Vector

CEN_SCALE = 6.0
KIND_BODY = 0.0
KIND_PLATE = 1.0
KIND_CORE = 2.0

# The heart: where the core sits in the chest (bind space). The renderer's shader carries the
# same point (src/render/quarryheart_charger_fx.ts QUARRYHEART_CORE_BIND), pinned by the test.
CORE = Vector((0.0, -0.5, 2.02))
CORE_R = 0.36
# distance (yd) from the heart at which the fire body has cooled to its deepest ember red
FIRE_REACH = 2.6


class MeshAcc:
    def __init__(self):
        self.co = []
        self.w = []  # per vertex {bone: weight}
        self.dir = []
        self.cen = []
        self.kind = []
        self.faces = []  # (vertex indices, material index, smooth)
        self.uv = []  # per face: list of (u, v)
        self.col = []  # per face: list of (r, g, b, a)

    def v(self, p, bone, d=(0, 0, 0), cen=(0, 0, 0), kind=KIND_BODY):
        self.co.append(Vector(p))
        self.w.append(bone if isinstance(bone, dict) else {bone: 1.0})
        self.dir.append(tuple(d))
        self.cen.append(tuple(x / CEN_SCALE for x in cen))
        self.kind.append(kind)
        return len(self.co) - 1

    def f(self, idx, mat, uvs, cols, smooth=False, outward=None):
        """A face. `outward`, when given, flips the winding so the normal points along it."""
        idx = list(idx)
        uvs = list(uvs)
        cols = list(cols)
        if outward is not None and len(idx) >= 3:
            a, b, c = (self.co[i] for i in idx[:3])
            n = (b - a).cross(c - a)
            if n.length < 1e-12 and len(idx) > 3:
                n = (c - a).cross(self.co[idx[3]] - a)
            if n.dot(Vector(outward)) < 0:
                idx.reverse()
                uvs.reverse()
                cols.reverse()
        self.faces.append((idx, mat, smooth))
        self.uv.append(uvs)
        self.col.append(cols)


# ---------------------------------------------------------------------------
# lofts
# ---------------------------------------------------------------------------


def frame_of(t):
    """A frame (x, y, z) with z along t; x prefers world X so lofts keep a steady seam."""
    z = Vector(t).normalized()
    ref = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 0, 1))
    y = z.cross(ref).normalized()
    x = y.cross(z).normalized()
    return x, y, z


def loft_rings(spine, radii, n, tag, jitter=0.0, phase=0.0):
    """Rings of `n` points round a polyline spine. radii[i] = (rx, ry) per ring (rx along the
    frame's x, sideways; ry along the frame's y). Returns (rings, centres, frames)."""
    rings, frames = [], []
    for i, p in enumerate(spine):
        if i == 0:
            t = spine[1] - spine[0]
        elif i == len(spine) - 1:
            t = spine[-1] - spine[-2]
        else:
            t = spine[i + 1] - spine[i - 1]
        x, y, z = frame_of(t)
        rx, ry = radii[i]
        ring = []
        for j in range(n):
            a = phase + math.tau * j / n
            jr = 1.0 + jitter * (h01(tag, i, j, "r") - 0.5)
            ja = jitter * 0.35 * (h01(tag, i, j, "a") - 0.5) * math.tau / n
            ring.append(p + (x * math.cos(a + ja) * rx + y * math.sin(a + ja) * ry) * jr)
        rings.append(ring)
        frames.append((x, y, z))
    return rings, [Vector(p) for p in spine], frames


def _shade(z_world, top=1.0):
    """Painted occlusion: plates low on the body sit in their own shadow."""
    k = max(0.0, min(1.0, (z_world - 0.4) / 2.4))
    s = top * (0.78 + 0.22 * k)
    return (s, s, s, 1.0)


def plate(acc, grid, centre_axis, bone, mat, tag, shrink=0.84, thick=0.09, dome=0.035,
          lift=0.02, region=R_STONE, px_per_yd=0.32, chip=0.018, kind=KIND_PLATE, rim_mat=None,
          rim_region=None, tilt_mag=0.1, float_mag=0.035, bevel=0.025):
    """One floating plate from a grid of points grid[r][c] (rows x cols, >= 2 x 2) lying on a
    surface whose outward side faces away from `centre_axis` (a point inside the body)."""
    rows, cols = len(grid), len(grid[0])
    pts = [p for row in grid for p in row]
    c = sum(pts, Vector()) / len(pts)
    out = (c - Vector(centre_axis)).normalized()
    # shrink toward the centroid in the tangent plane, dome the middle, lift off the fire
    # each plate hangs at its own small tilt and float, and is cut to its own thickness, so the
    # body reads as hewn stones held in the fire rather than courses of brick
    tilt_axis = out.orthogonal().normalized()
    tilt_axis.rotate(Matrix.Rotation(h01(tag, "tilt-a") * math.tau, 3, out))
    tilt = Matrix.Rotation((h01(tag, "tilt") - 0.5) * 2 * tilt_mag, 3, tilt_axis) if tilt_mag else Matrix.Identity(3)
    lift = lift + float_mag * h01(tag, "float")
    thick = thick * (0.8 + 0.45 * h01(tag, "thick"))
    top = []
    raw = []
    for r in range(rows):
        row = []
        rrow = []
        for q in range(cols):
            p = grid[r][q]
            d = p - c
            d = d - out * d.dot(out) * 0.6
            edge = r in (0, rows - 1) or q in (0, cols - 1)
            bump = 0.0 if edge else dome
            nz = (h01(tag, r, q, "chip") - 0.5) * chip * 2
            base = c + tilt @ (d * shrink + out * (lift + bump + nz))
            rrow.append(base)
            if edge and bevel > 0:
                # the chamfer: the top's edge drawn in and down, so the rim slopes like a cut edge
                base = base - out * bevel + (c + out * lift - base).normalized() * bevel * 0.8
            row.append(base)
        top.append(row)
        raw.append(rrow)
    # the plate's own planar UV frame, its window placed at random inside the stone region
    ux = out.cross(Vector((0, 0, 1)))
    if ux.length < 0.2:
        ux = out.cross(Vector((0, 1, 0)))
    ux.normalize()
    vy = out.cross(ux).normalized()
    span = max(max(abs((p - c).dot(ux)), abs((p - c).dot(vy))) for p in pts)
    win = span * px_per_yd * 2 + 0.002
    ou = 0.5 * win + h01(tag, "ou") * max(0.0, 1.0 - win)
    ov = 0.5 * win + h01(tag, "ov") * max(0.0, 1.0 - win)

    def uv(p):
        du = (p - c).dot(ux) * px_per_yd
        dv = (p - c).dot(vy) * px_per_yd
        return uv_in(region, min(max(ou + du, 0.0), 1.0), min(max(ov + dv, 0.0), 1.0))

    wgt = bone

    def V(p):
        return acc.v(p, wgt, out, c, kind)

    ti = [[V(p) for p in row] for row in top]
    bi = [[V(p - out * thick) for p in row] for row in raw]
    for r in range(rows - 1):
        for q in range(cols - 1):
            quad = [top[r][q], top[r][q + 1], top[r + 1][q + 1], top[r + 1][q]]
            zc = sum((p.z for p in quad)) / 4
            acc.f([ti[r][q], ti[r][q + 1], ti[r + 1][q + 1], ti[r + 1][q]], mat,
                  [uv(p) for p in quad], [_shade(zc)] * 4, outward=out)
            acc.f([bi[r][q], bi[r][q + 1], bi[r + 1][q + 1], bi[r + 1][q]], mat,
                  [uv(p) for p in quad], [_shade(zc, 0.3)] * 4, outward=-out)
    # the rim: walk the boundary of the grid once round
    loop = ([(0, q) for q in range(cols)] + [(r, cols - 1) for r in range(1, rows)]
            + [(rows - 1, q) for q in range(cols - 2, -1, -1)] + [(r, 0) for r in range(rows - 2, 0, -1)])
    for k in range(len(loop)):
        a = loop[k]
        b = loop[(k + 1) % len(loop)]
        pa, pb = top[a[0]][a[1]], top[b[0]][b[1]]
        mid = (pa + pb) * 0.5
        side_out = (mid - c) - out * (mid - c).dot(out)
        sm = rim_mat if rim_mat is not None else mat
        if rim_region is not None:
            f0, f1 = 0.2 + 0.6 * k / len(loop), 0.2 + 0.6 * (k + 1) / len(loop)
            ruv = [uv_in(rim_region, f0, 0.3), uv_in(rim_region, f1, 0.3),
                   uv_in(rim_region, f1, 0.7), uv_in(rim_region, f0, 0.7)]
            rcol = [(1, 1, 1, 1)] * 4
        else:
            ruv = [uv(pa), uv(pb), uv(pb - out * thick), uv(pa - out * thick)]
            rcol = [(0.5, 0.48, 0.46, 1)] * 2 + [(0.36, 0.34, 0.33, 1)] * 2
        acc.f([ti[a[0]][a[1]], ti[b[0]][b[1]], bi[b[0]][b[1]], bi[a[0]][a[1]]], sm, ruv, rcol,
              outward=side_out)
    return c, out


def bricks(acc, rings, centres, mat, bone_of, tag, cols_per=2, row_step=1, skip=None, **kw):
    """Cut a loft into staggered plates. bone_of(i_row, centroid) names the bone."""
    n = len(rings[0])
    nr = len(rings)
    for i in range(0, nr - 1, row_step):
        i1 = min(i + row_step, nr - 1)
        offset = (i // row_step) % 2
        q = offset
        start = offset
        while q < n + start:
            span = cols_per + (1 if h01(tag, "span", i, q) > 0.62 else 0)
            span = min(span, n + start - q)
            j0 = q
            j1 = q + span
            grid = [[rings[r][jj % n] for jj in range(j0, j1 + 1)] for r in range(i, i1 + 1)]
            cen_axis = (centres[i] + centres[i1]) * 0.5
            pts = [p for row in grid for p in row]
            cc = sum(pts, Vector()) / len(pts)
            if skip is None or not skip(cc, i, j0 % n):
                plate(acc, grid, cen_axis, bone_of(i, cc), mat, f"{tag}-{i}-{j0 % n}", **kw)
            q += span


def fire_tube(acc, rings, centres, bone_of, scale, mat, tag, cap0=False, cap1=False, skip=None):
    """The fire body under the plates: the loft pulled in toward its spine, smooth, its UVs the
    energy gradient by distance from the heart. bone_of(i) gives a weight dict per ring."""
    n = len(rings[0])
    idx = []
    for i, ring in enumerate(rings):
        row = []
        for j, p in enumerate(ring):
            q = centres[i] + (p - centres[i]) * scale
            row.append(acc.v(q, bone_of(i)))
        idx.append(row)

    def uv(i, j):
        p = acc.co[idx[i][j]]
        d = (p - CORE).length
        return uv_in(R_ENERGY, min(0.98, d / FIRE_REACH), 0.1 + 0.8 * (j / n))

    for i in range(len(rings) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            q = [idx[i][j], idx[i][j2], idx[i + 1][j2], idx[i + 1][j]]
            mid = sum((acc.co[k] for k in q), Vector()) / 4
            if skip is not None and skip(mid):
                continue
            acc.f(q, mat, [uv(i, j), uv(i, j2), uv(i + 1, j2), uv(i + 1, j)], [(1, 1, 1, 1)] * 4,
                  smooth=True, outward=mid - (centres[i] + centres[i + 1]) * 0.5)
    for cap, i in ((cap0, 0), (cap1, len(rings) - 1)):
        if not cap:
            continue
        cv = acc.v(centres[i], bone_of(i))
        d = (centres[i] - CORE).length
        for j in range(n):
            j2 = (j + 1) % n
            tri = [idx[i][j], idx[i][j2], cv]
            away = centres[i] - centres[1 if i == 0 else len(rings) - 2]
            acc.f(tri, mat, [uv(i, j), uv(i, j2), uv_in(R_ENERGY, min(0.98, d / FIRE_REACH), 0.5)],
                  [(1, 1, 1, 1)] * 3, smooth=True, outward=away)


# ---------------------------------------------------------------------------
# solid helpers (fixed pieces: hooves, ribs, saddle, horns, core)
# ---------------------------------------------------------------------------


def prism(acc, base, tip, r0, r1, sides, bone, mat, region, tag, cap0=True, cap1=True,
          rot=0.0, shade=1.0, kind=KIND_BODY, uvv=(0.0, 1.0), squash=1.0):
    """A straight faceted prism/frustum from base to tip (flat shaded), UVs across a region."""
    base, tip = Vector(base), Vector(tip)
    x, y, z = frame_of(tip - base)
    ra, rb = [], []
    for j in range(sides):
        a = rot + math.tau * j / sides
        d = x * math.cos(a) + y * math.sin(a) * squash
        ra.append(acc.v(base + d * r0, bone, kind=kind))
        rb.append(acc.v(tip + d * r1, bone, kind=kind))
    col = (shade, shade, shade, 1)
    for j in range(sides):
        j2 = (j + 1) % sides
        u0, u1 = j / sides, (j + 1) / sides
        mid = (acc.co[ra[j]] + acc.co[ra[j2]] + acc.co[rb[j]] + acc.co[rb[j2]]) / 4
        acc.f([ra[j], ra[j2], rb[j2], rb[j]], mat,
              [uv_in(region, u0, uvv[0]), uv_in(region, u1, uvv[0]), uv_in(region, u1, uvv[1]),
               uv_in(region, u0, uvv[1])], [col] * 4, outward=mid - (base + tip) / 2)
    if cap0:
        acc.f(list(reversed(ra)), mat, [uv_in(region, 0.5 + 0.4 * math.cos(math.tau * j / sides),
                                              0.5 + 0.4 * math.sin(math.tau * j / sides)) for j in range(sides)][::-1],
              [col] * sides, outward=-z)
    if cap1:
        acc.f(rb, mat, [uv_in(region, 0.5 + 0.4 * math.cos(math.tau * j / sides),
                              0.5 + 0.4 * math.sin(math.tau * j / sides)) for j in range(sides)],
              [col] * sides, outward=z)
    return ra, rb


def crystal_path(acc, pts, radii, sides, bone, mat, tag, twist=0.0):
    """A curved faceted crystal (an ice horn): hexagonal rings along a path, a pointed tip."""
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        x, y, z = frame_of(t)
        r = radii[i]
        ring = []
        for j in range(sides):
            a = twist * i + math.tau * j / sides + (h01(tag, i, j) - 0.5) * 0.12
            ring.append(acc.v(p + (x * math.cos(a) + y * math.sin(a)) * r, bone))
        rings.append(ring)
    n = len(pts)
    for i in range(n - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            q = [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]]
            mid = sum((acc.co[k] for k in q), Vector()) / 4
            v0, v1 = i / n, (i + 1) / n
            facet = 0.15 + 0.7 * (j % 2)
            acc.f(q, mat, [uv_in(R_ICE, facet, v0), uv_in(R_ICE, facet + 0.12, v0),
                           uv_in(R_ICE, facet + 0.12, v1), uv_in(R_ICE, facet, v1)],
                  [(1, 1, 1, 1)] * 4, outward=mid - pts[i])
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 3.2
    tv = acc.v(tip, bone)
    for j in range(sides):
        j2 = (j + 1) % sides
        q = [rings[-1][j], rings[-1][j2], tv]
        mid = sum((acc.co[k] for k in q), Vector()) / 3
        acc.f(q, mat, [uv_in(R_ICE, 0.4, 0.95), uv_in(R_ICE, 0.5, 0.95), uv_in(R_ICE, 0.45, 1.0)],
              [(1, 1, 1, 1)] * 3, outward=mid - pts[-1])
    # the base cap, hidden in the skull
    acc.f(list(reversed(rings[0])), mat, [uv_in(R_ICE, 0.5, 0.05)] * sides, [(1, 1, 1, 1)] * sides,
          outward=pts[0] - pts[1])


def ico(acc, c, r, bone, mat, region, tag, kind=KIND_BODY, subdiv=1, rough=0.0, u=0.5, inward=False,
        u_of=None):
    """A faceted sphere (an icosphere), UVs at one point of a region (a flat colour)."""
    t = (1 + 5 ** 0.5) / 2
    vs = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t),
          (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    vs = [Vector(v).normalized() for v in vs]
    fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4),
          (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
          (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdiv):
        cache = {}
        nf = []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                vs.append(((vs[a] + vs[b]) / 2).normalized())
                cache[k] = len(vs) - 1
            return cache[k]

        for a, b, cc in fs:
            ab, bc, ca = mid(a, b), mid(b, cc), mid(cc, a)
            nf += [(a, ab, ca), (b, bc, ab), (cc, ca, bc), (ab, bc, ca)]
        fs = nf
    c = Vector(c)
    idx = []
    for k, v in enumerate(vs):
        rr = r * (1 + rough * (h01(tag, k) - 0.5))
        p = c + v * rr
        if kind == KIND_CORE:
            idx.append(acc.v(p, bone, v, c, kind))
        else:
            idx.append(acc.v(p, bone, (0, 0, 0), (0, 0, 0), kind))
    for k, (a, b, cc) in enumerate(fs):
        mid = (vs[a] + vs[b] + vs[cc]) / 3
        uu = u if u_of is None else u_of(mid, k)
        acc.f([idx[a], idx[b], idx[cc]], mat, [uv_in(region, uu, 0.15 + 0.7 * h01(tag, "v", k))] * 3,
              [(1, 1, 1, 1)] * 3, outward=-mid if inward else mid)
    return idx


def box(acc, c, size, rot, bone, mat, region, shade=1.0, uvscale=0.25, tag="box"):
    """A chamfer-free box (rot: a 3x3 Matrix), planar UVs per face into a region."""
    c = Vector(c)
    sx, sy, sz = size
    corners = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                corners.append(c + rot @ Vector((dx * sx / 2, dy * sy / 2, dz * sz / 2)))
    ids = [acc.v(p, bone) for p in corners]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    col = (shade, shade, shade, 1)
    ou = h01(tag, "u") * 0.5
    ov = h01(tag, "v") * 0.5
    for f in faces:
        pts = [corners[k] for k in f]
        mid = sum(pts, Vector()) / 4
        acc.f([ids[k] for k in f], mat,
              [uv_in(region, ou + uvscale * (k % 2), ov + uvscale * (k // 2)) for k in (0, 1, 3, 2)],
              [col] * 4, outward=mid - c)


__all__ = ['MeshAcc', 'loft_rings', 'bricks', 'plate', 'fire_tube', 'prism', 'crystal_path', 'ico',
           'box', 'CORE', 'CORE_R', 'CEN_SCALE', 'KIND_BODY', 'KIND_PLATE', 'KIND_CORE', 'Matrix',
           'R_BASALT', 'R_GOLD', 'R_ICE', 'R_ENERGY', 'R_EYE', 'R_STONE', 'h01', 'uv_in']
