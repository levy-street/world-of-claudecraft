"""Everything Balgath wears or grew: barrowhide slabs, the foreman's gear, the eye.

Stone slabs ("barrowhide") are sculpted as SHELLS of the body's own distance field:
the slab's underside sits a few centimetres inside the skin and its top is the skin
pushed outward and cut into facets, so every slab hugs the flesh it is fused into
with no gap, whatever the curvature. Its outline is a jittered polygon of planes
tilted inward (a split stone's bevel), chipped and eroded by noise. Each slab is
rigid on the one bone that owns the flesh beneath it (stone never bends).

The belt is a shell too (a band of the skin pushed out), so it cinches under the
gut instead of floating round it. Rope, chain links, shackles, teeth and the eye are
bmesh parts (mesh_kit.py). Each item returns (high, low) objects: the high mesh is
what the normal and occlusion bakes read, the low ships.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import anatomy as A
import sdf
from mesh_kit import Part, V, apply_mods, decimate, duplicate, obj_from_bm, triangles

# palette (sRGB) for the vertex-coloured glow
IRIS_DEEP = (0.0, 0.08, 0.08)
IRIS = (0.33, 0.9, 0.8)
IRIS_HOT = (0.9, 1.0, 0.98)
PUPIL = (0.0, 0.03, 0.03)


# ------------------------------------------------------------------ surface queries
def surface_along(F, origin, direction, max_dist=4.0):
    """First zero crossing of the body field marching from an inside point."""
    o = np.asarray(origin, float)
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    step = F.voxel * 0.7
    prev_t, prev_v = 0.0, F.sample(o[None])[0]
    t = step
    while t < max_dist:
        v = F.sample((o + d * t)[None])[0]
        if prev_v < 0 <= v:
            a, b = prev_t, t
            for _ in range(20):
                m = (a + b) / 2
                if F.sample((o + d * m)[None])[0] < 0:
                    a = m
                else:
                    b = m
            return o + d * (a + b) / 2
        prev_t, prev_v = t, v
        t += step
    raise RuntimeError(f'no surface from {origin} along {direction}')


def normal_at(F, p):
    return F.gradient(np.asarray(p, float)[None])[0]


def tangent_frame(n, along=None):
    n = n / np.linalg.norm(n)
    a = np.asarray(along if along is not None else (0, 0, 1), float)
    a = a - n * (a @ n)
    if np.linalg.norm(a) < 1e-3:
        a = np.array((1.0, 0, 0)) - n * n[0]
    a /= np.linalg.norm(a)
    b = np.cross(n, a)
    return a, b


# ------------------------------------------------------------------ slabs
class Slab:
    def __init__(self, origin, direction, size, thick=0.3, along=None, sides=7, seed=1, bone=None, facets=3,
                 sink=0.1, name=None, voxel=None, chips=True, glow=True):
        self.voxel, self.chips, self.glow = voxel, chips, glow
        self.origin, self.direction = np.asarray(origin, float), np.asarray(direction, float)
        self.size, self.thick, self.along = size, thick, along
        self.sides, self.seed, self.bone, self.facets, self.sink = sides, seed, bone, facets, sink
        self.name = name


def build_slab(F, slab, index, voxel=0.022, noise=None, workdir=None):
    rng = np.random.default_rng(slab.seed * 7919 + index)
    voxel = slab.voxel or voxel
    q = surface_along(F, slab.origin, slab.direction)
    n = normal_at(F, q)
    t1, t2 = tangent_frame(n, slab.along)
    a, b = slab.size
    reach = max(a, b) * 1.4 + slab.thick + 0.3
    G = sdf.Field(q - reach, q + reach, voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P_all = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    # only the voxels near this patch of skin are worth shaping
    near = np.sqrt(((P_all - q) ** 2).sum(1)) < max(a, b) * 1.45
    db_all = np.full(len(P_all), 1.0)
    db_all[near] = F.sample(P_all[near])
    act = near & (np.abs(db_all) < slab.thick + 0.3)
    P = P_all[act]
    db = db_all[act]
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    noise = noise or sdf.Noise(slab.seed + 100)
    rel = P - q
    u = rel @ t1
    v = rel @ t2
    rad = np.sqrt((u / a) ** 2 + (v / b) ** 2)
    # thickness swells toward the middle and wanders
    t_out = slab.thick * (1.0 - 0.35 * np.clip(rad, 0, 1) ** 2) * (1.0 + 0.18 * noise(x * 2.3, y * 2.3, z * 2.3))
    d = np.maximum(db - t_out, -(db + slab.sink))
    # jittered polygon outline, walls leaning inward like split stone
    region = None
    for i in range(slab.sides):
        th = math.tau * i / slab.sides + rng.uniform(-0.25, 0.25)
        dirv = math.cos(th) * t1 + math.sin(th) * t2
        r = 1.0 / math.sqrt((math.cos(th) / a) ** 2 + (math.sin(th) / b) ** 2) * rng.uniform(0.82, 1.06)
        w = dirv - n * rng.uniform(0.25, 0.55)
        w /= np.linalg.norm(w)
        pl = rel @ w - r * (w @ dirv)
        region = pl if region is None else sdf.smax(region, pl, 0.05)
    d = sdf.smax(d, region, 0.04)
    along_n = rel @ n
    d = np.maximum(d, np.abs(along_n - slab.thick * 0.3) - (slab.thick + 0.3))
    # faceted top: a few planes tilted off the normal shave the crown into facets
    for k in range(slab.facets):
        tilt = rng.normal(size=2) * 0.32
        nk = n + t1 * tilt[0] + t2 * tilt[1]
        nk /= np.linalg.norm(nk)
        ck = q + n * slab.thick * rng.uniform(0.62, 0.86) + (t1 * rng.uniform(-a, a) + t2 * rng.uniform(-b, b)) * 0.4
        d = sdf.smax(d, (P - ck) @ nk, 0.03)
    # erosion and chips
    ks = min(1.0, slab.thick / 0.3)
    d = d + ks * (0.022 * noise.fbm(x * 3.2, y * 3.2, z * 3.2, octaves=3) + 0.007 * noise(x * 14, y * 14, z * 14))
    for _ in range(rng.integers(2, 5) if slab.chips else 0):
        th = rng.uniform(0, math.tau)
        c = q + (math.cos(th) * t1 * a + math.sin(th) * t2 * b) * rng.uniform(0.8, 1.0) + n * slab.thick * 0.7
        cr = rng.uniform(0.07, 0.16) * max(a, b)
        dc = np.sqrt(((P - c) ** 2).sum(1)) - cr
        d = sdf.smax(d, -dc, 0.03)
    full = np.full(len(P_all), 0.5)
    full[act] = d
    d = full.reshape(X.shape)
    crack_pts = None
    if max(a, b) > 0.55 and slab.glow:
        # a seam of the fallen star's light: a crack wandering across the top,
        # carved into the stone and filled by a faint glowing vein (glow material)
        G.d = d.astype(np.float32)
        p = q + (t1 * rng.uniform(-0.3, 0.3) * a + t2 * rng.uniform(-0.3, 0.3) * b)
        ang = rng.uniform(0, math.tau)
        pts = []
        for k in range(7):
            ang += rng.uniform(-0.6, 0.6)
            p = p + (math.cos(ang) * t1 + math.sin(ang) * t2) * max(a, b) * 0.17
            top = None
            for step in range(60):
                c = p + n * (slab.thick * 1.6 - step * 0.02)
                if G.sample(c[None])[0] < 0:
                    top = c
                    break
            if top is None:
                break
            pts.append(top)
        if len(pts) >= 3:
            crack_pts = pts
            poly = sdf.Polyline(pts, 0.012)
            dist = poly.dist(X, Y, Z)
            d = d + 0.055 * np.exp(-(dist / 0.045) ** 2)
    G.d = d.astype(np.float32)
    name = slab.name or f'Slab{index:02d}'
    hi = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    lo = duplicate(hi, name)
    area = math.pi * a * b
    decimate(lo, target=int(60 + 150 * area) if a > 0.3 else 40)
    bone = slab.bone or A.bone_of_point(F, q - n * 0.25)
    for o in (hi, lo):
        o['mat'] = 'stone'
        o['bone'] = bone
        o['binding'] = 'rigid'
    glow = None
    if crack_pts:
        gp = Part(name + 'Glow', 'glow', bone=bone)
        inset = [pt - n * 0.035 for pt in crack_pts]
        gp.tube(inset, [0.02] + [0.032] * (len(inset) - 2) + [0.012], sides=5, color=(0.16, 0.62, 0.55))
        go = gp.to_object()
        glow = (duplicate(go, name + 'Glow_hi'), go)
    return hi, lo, q, n, glow


def _limb(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def slab_specs():
    """The barrowhide: where the stone broke through his hide. Big, few and grouped
    so they read from across the fen: a pauldron of it on the right shoulder, a ridge
    down the hump like a range of hills, a craggy crown, one bracer per forearm, a
    greave per shin, the heart stone. Not symmetric. Nails of the same stone."""
    S = []
    m = A.mirror
    # right shoulder: the pauldron
    S += [Slab((-3.0, 0.1, 10.5), (-0.55, 0.05, 1), (1.12, 0.92), 0.52, along=(-1, 0, -0.35), seed=4, sides=8),
          Slab((-3.0, 0.1, 10.4), (-1, 0.0, 0.3), (1.0, 0.82), 0.48, along=(0, 0, 1), seed=5),
          Slab((-3.0, 0.1, 10.45), (-0.45, 0.85, 0.45), (0.8, 0.65), 0.42, seed=6)]
    # left shoulder
    S += [Slab((3.0, 0.1, 10.5), (0.6, 0.15, 1), (0.88, 0.7), 0.42, along=(1, 0, -0.3), seed=1),
          Slab((3.0, 0.1, 10.4), (1, 0.25, 0.2), (0.72, 0.6), 0.36, along=(0, 0, 1), seed=2)]
    # the ridge down the hump and spine
    S += [Slab((0, 0.5, 10.5), (0, 0.85, 0.75), (1.1, 0.85), 0.6, along=(1, 0, 0), seed=8, sides=8),
          Slab((1.05, 0.4, 10.05), (0.5, 1, 0.35), (0.85, 0.66), 0.5, seed=9),
          Slab((-1.1, 0.4, 9.9), (-0.45, 1, 0.25), (0.92, 0.7), 0.52, seed=10),
          Slab((0.15, 0.4, 9.15), (0.05, 1, 0.05), (0.8, 0.62), 0.46, seed=11),
          Slab((-0.35, 0.5, 8.35), (-0.1, 1, -0.05), (0.62, 0.5), 0.38, seed=12)]
    # the crown of the skull
    S += [Slab((0, -1.0, 12.55), (0.05, 0.35, 1), (0.72, 0.55), 0.38, along=(0, 1, 0), seed=13),
          Slab((0, -1.0, 12.55), (0.7, 0.45, 0.7), (0.5, 0.4), 0.3, seed=14),
          Slab((0, -1.0, 12.55), (-0.6, 0.7, 0.55), (0.55, 0.42), 0.32, seed=15)]
    # forearm bracers
    for s, k0 in ((1, 0), (-1, 1)):
        el, wr = (A.ELBOW, A.WRIST) if s > 0 else (m(A.ELBOW), m(A.WRIST))
        ax = (wr - el) / np.linalg.norm(wr - el)
        out = np.cross(ax, (0, -1.0, 0)) * -s
        S.append(Slab(_limb(el, wr, 0.5), out + np.array((0, -0.15, 0)), (0.95, 0.68), 0.46, along=ax, seed=20 + k0,
                      sides=7))
        if s < 0:
            S.append(Slab(_limb(el, wr, 0.4), np.array((0, -1.0, 0.15)) + out * 0.4, (0.6, 0.48), 0.34, along=ax, seed=24))
    # greaves, and one plate on the right thigh
    for s, k0 in ((1, 0), (-1, 1)):
        kn, an, hp = (A.KNEE, A.ANKLE, A.HIP) if s > 0 else (m(A.KNEE), m(A.ANKLE), m(A.HIP))
        ax = (an - kn) / np.linalg.norm(an - kn)
        S.append(Slab(_limb(kn, an, 0.42), (0.2 * s, -1, 0.05), (0.92, 0.62), 0.42, along=ax, seed=30 + k0, sides=7))
        if s < 0:
            tax = (kn - hp) / np.linalg.norm(kn - hp)
            S.append(Slab(_limb(hp, kn, 0.55), (-1, -0.35, 0.0), (0.75, 0.6), 0.38, along=tax, seed=34))
    # the heart stone
    S.append(Slab((1.1, -0.8, 9.9), (0.12, -1, 0.25), (0.62, 0.5), 0.34, seed=40, sides=6))
    # more of it: the shoulders' backs, the upper arms, the shoulder blades, the
    # flank of the hump, the left thigh, and a plate fused into the forehead
    S += [Slab((3.0, 0.1, 10.4), (0.3, 0.9, 0.5), (0.7, 0.55), 0.38, seed=41),
          Slab((-3.0, 0.1, 10.4), (-0.2, 0.3, -0.25), (0.62, 0.5), 0.34, seed=42),
          Slab((1.6, 0.6, 9.6), (0.6, 1, 0.1), (0.7, 0.55), 0.4, seed=43),
          Slab((-1.7, 0.6, 9.4), (-0.6, 1, 0.0), (0.75, 0.58), 0.42, seed=44),
          Slab((0.0, 0.5, 9.8), (0.0, 1, 0.45), (0.6, 0.48), 0.36, seed=45),
          Slab((0, -1.15, 12.7), (0.02, -0.8, 0.75), (0.5, 0.34), 0.2, along=(1, 0, 0), seed=46, sides=6,
               bone='Head', name='SlabBrowPlate'),
          # the brow itself is stone: a craggy ridge of it over the eye, on the brow's bone
          Slab((0, -1.85, 13.3), (0, -1, 0.42), (1.05, 0.34), 0.3, along=(1, 0, 0), seed=53, sides=8, facets=4,
               bone='Brow', name='SlabBrowRidge', glow=False)]
    for s_, k0 in ((1, 0), (-1, 1)):
        sh, el = (A.SHOULDER, A.ELBOW) if s_ > 0 else (m(A.SHOULDER), m(A.ELBOW))
        ax = (el - sh) / np.linalg.norm(el - sh)
        S.append(Slab(_limb(sh, el, 0.55), (s_ * 1.0, 0.25, 0.1), (0.6, 0.45), 0.34, along=ax, seed=47 + k0))
        el, wr = (A.ELBOW, A.WRIST) if s_ > 0 else (m(A.ELBOW), m(A.WRIST))
        ax = (wr - el) / np.linalg.norm(wr - el)
        S.append(Slab(_limb(el, wr, 0.78), (s_ * 0.6, 0.8, 0.1), (0.5, 0.42), 0.3, along=ax, seed=49 + k0))
    hp, kn = A.HIP, A.KNEE
    tax = (kn - hp) / np.linalg.norm(kn - hp)
    S.append(Slab(_limb(hp, kn, 0.45), (1, -0.25, 0.0), (0.62, 0.5), 0.34, along=tax, seed=51))
    # nails: thick stone plates on the finger and toe tips
    for s in (1, -1):
        side = 'L_' if s > 0 else 'R_'
        w, down, width, palm = A.hand_frame(s)
        for f in A.FINGERS:
            base, mid, tip = A.finger_chain(s, f)
            d = (tip - mid) / np.linalg.norm(tip - mid)
            dorsal = -palm if f != 'Thumb' else (-palm * 0.5 + width * 0.8)
            S.append(Slab(tip - d * 0.14, dorsal, (0.18, 0.24), 0.13, along=d, seed=50 + len(S), sides=5, facets=1,
                          sink=0.05, bone=side + f + '2', voxel=0.012, chips=False))
        for f in ('Index', 'Middle', 'Ring'):
            base, mid, tip = A.finger_chain(s, f)
            d = (mid - base) / np.linalg.norm(mid - base)
            # knuckle-stones: the barrowhide grown over the backs of his fingers
            S.append(Slab(base + d * 0.38, -palm, (0.22, 0.3), 0.15, along=d, seed=60 + len(S), sides=6, facets=2,
                          sink=0.05, bone=side + f + '1', voxel=0.014, chips=False, glow=False))
        for k, dx in enumerate((0.48, 0.0, -0.46)):
            ln = (0.85, 0.92, 0.78)[k]
            tip = np.array(((1.66 + dx * 1.12) * s, -1.0 - ln, 0.28))
            S.append(Slab(tip + np.array((0, 0.2, 0.05)), (0, -0.4, 1), (0.22, 0.24), 0.13, along=(0, -1, 0),
                          seed=70 + len(S), sides=5, facets=1, sink=0.04, bone=side + 'Toes', voxel=0.012, chips=False))
    for sl in S:
        if sl.size[0] > 0.3:            # the big stones: a fifth larger and thicker
            sl.size = (sl.size[0] * 1.2, sl.size[1] * 1.2)
            sl.thick *= 1.2
    return S


# ------------------------------------------------------------------ belt
def belt_center(y):
    """Belt height: low in front, under the gut; higher behind."""
    return 6.98 + 0.3 * (y / 1.8)


def build_belt(F, voxel=0.025, workdir=None):
    lo_b = np.array((-3.4, -3.2, 5.6))
    hi_b = np.array((3.4, 2.6, 7.9))
    G = sdf.Field(lo_b, hi_b, voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = F.sample(P).reshape(X.shape)
    noise = sdf.Noise(51)
    shell = np.maximum(db - (0.12 + 0.01 * noise(X * 3, Y * 3, Z * 3)), -(db + 0.06))
    band = np.abs(Z - belt_center(Y)) - 0.3
    radial = np.sqrt(X ** 2 + (Y + 0.2) ** 2) - 3.25
    d = sdf.smax(sdf.smax(shell, band, 0.03), radial, 0.05)
    # stitched edges: a shallow groove a hand in from each edge
    edge = np.abs(np.abs(Z - belt_center(Y)) - 0.22) - 0.012
    d = d + 0.008 * np.exp(-np.maximum(edge, 0) ** 2 / 0.0004)
    G.d = d.astype(np.float32)
    hi = sdf.to_mesh(G, 'Belt_hi', bpy, workdir=workdir)
    lo = duplicate(hi, 'Belt')
    decimate(lo, target=1200)
    for o in (hi, lo):
        o['mat'] = 'leather'
        o['bone'] = 'Hips'
        o['binding'] = 'transfer'
    return hi, lo


def build_buckle(F):
    y_front = surface_along(F, (0, 0, belt_center(-2.4)), (0, -1, 0))
    c = y_front + np.array((0, -0.12, 0))
    n = normal_at(F, y_front)
    p = Part('Buckle', 'iron', bone='Hips')
    t1, t2 = np.array((1.0, 0, 0)), np.array((0, 0, 1.0))
    t2 = t2 - n * (t2 @ n)
    t2 /= np.linalg.norm(t2)
    t1 = np.cross(t2, n)
    # a heavy rectangular frame with rounded corners, a bar and a prong
    corners = []
    for k in range(20):
        a = math.tau * k / 20
        x, z = math.cos(a), math.sin(a)
        sx = math.copysign(abs(x) ** 0.45, x) * 0.55
        sz = math.copysign(abs(z) ** 0.45, z) * 0.42
        corners.append(c + t1 * sx + t2 * sz)
    p.tube(corners, 0.085, sides=6, closed=True, up=tuple(n))
    p.tube([c - t2 * 0.42, c + t2 * 0.42], 0.06, sides=8, up=tuple(n))
    p.tube([c, c + t1 * 0.58 - n * 0.04], 0.045, sides=6, up=tuple(n))
    for sx in (-0.38, 0.38):
        p.sphere(c + t1 * sx + t2 * 0.42 - n * 0.02, (0.06, 0.06, 0.06), seg=8, rings=5)
        p.sphere(c + t1 * sx - t2 * 0.42 - n * 0.02, (0.06, 0.06, 0.06), seg=8, rings=5)
    o = p.to_object()
    return o, duplicate(o, 'Buckle_hi')


# ------------------------------------------------------------------ rope
def _ring_path(F, z_of_theta, offset, n=72, center=(0.0, -0.2)):
    pts = []
    for i in range(n):
        th = math.tau * i / n
        d = np.array((math.sin(th), -math.cos(th), 0.0))
        z = z_of_theta(th)
        o = np.array((center[0], center[1], z))
        s = surface_along(F, o, d, max_dist=5.0)
        nn = normal_at(F, s)
        pts.append(s + nn * offset)
    return pts


def rope_parts(path, radius, name, mat='rope', bone='Hips', binding='transfer', closed=True, strands=3):
    """A rope as (high: twisted strands, low: one tube)."""
    lo = Part(name, mat, bone=bone, binding=binding)
    lo.tube(path, radius, sides=6, closed=closed, cap=not closed)
    hi = Part(name + '_hi', mat, bone=bone, binding=binding)
    P = [np.asarray(p, float) for p in path]
    m = len(P)
    # resample densely for the strands
    dense = []
    for i in range(m if closed else m - 1):
        a, b = P[i], P[(i + 1) % m]
        for k in range(4):
            dense.append(a + (b - a) * k / 4)
    if not closed:
        dense.append(P[-1])
    nd = len(dense)
    tang = [(dense[(i + 1) % nd] - dense[(i - 1) % nd]) for i in range(nd)]
    for s in range(strands):
        sp = []
        ref = np.array((0, 0, 1.0))
        for i in range(nd):
            t = tang[i] / (np.linalg.norm(tang[i]) + 1e-9)
            e1 = np.cross(t, ref)
            if np.linalg.norm(e1) < 1e-3:
                e1 = np.cross(t, (1.0, 0, 0))
            e1 /= np.linalg.norm(e1)
            e2 = np.cross(t, e1)
            ang = math.tau * s / strands + i * 0.55
            sp.append(dense[i] + (e1 * math.cos(ang) + e2 * math.sin(ang)) * radius * 0.42)
        hi.tube(sp, radius * 0.62, sides=6, closed=closed, cap=not closed)
    return hi.to_object(), lo.to_object()


# ------------------------------------------------------------------ loincloth
def _front_y(F, x, z, sign=-1.0, pad=0.14):
    s = surface_along(F, (x, 0.2 * -sign, z), (0, sign, 0), max_dist=4.5)
    return s[1] + sign * pad


def build_apron(F, front=True):
    """Hide strips hanging off the belt, front or back: overlapping tongues of
    tanned hide of different lengths, their hems torn."""
    sign = -1.0 if front else 1.0
    name = 'ApronF' if front else 'ApronB'
    bones = ('Hips', 'LoinF1', 'LoinF2') if front else ('Hips', 'LoinB1', 'LoinB2')
    z_top = belt_center(-2.3 if front else 1.9) + 0.05
    # (centre x, half width, bottom z, layer)
    strips = ([(0.0, 0.42, 4.0, 0), (-0.62, 0.34, 4.55, 1), (0.6, 0.36, 4.75, 1)] if front else
              [(-0.45, 0.55, 4.25, 0), (0.5, 0.52, 4.45, 1), (0.0, 0.4, 3.95, 2)])
    p = Part(name, 'hide', bone=bones[0], binding='loin')
    rng = np.random.default_rng(3 if front else 4)
    z_bot = min(st[2] for st in strips)
    for cx, hw, zb, layer in strips:
        rows, cols = 14, 5
        rag = [1.0 - 0.1 * rng.random() - (0.16 if rng.random() > 0.75 else 0.0) for _ in range(cols + 1)]
        rag[0] *= 0.93
        rag[-1] *= 0.95
        pts = {}
        ys_prev = None
        for r in range(rows + 1):
            u = r / rows
            row = []
            for c in range(cols + 1):
                v = c / cols * 2 - 1
                w = hw * (1.0 - 0.12 * u)
                x = cx + v * w
                z = z_top - (z_top - zb) * u * rag[c]
                try:
                    y = _front_y(F, x * 0.98, max(z, 3.7), sign, pad=0.14 + 0.05 * layer)
                except RuntimeError:
                    y = ys_prev[c] if ys_prev else sign * 2.2
                if ys_prev is not None:
                    y = min(y, ys_prev[c]) if front else max(y, ys_prev[c])
                row.append((x, y + sign * 0.03 * math.sin(v * 2.5 + u * 3 + cx), z))
            ys_prev = [q[1] for q in row]
            pts[r] = row
        p.grid(rows, cols, lambda u, v, pts=pts, rows=rows, cols=cols: pts[round(u * rows)][round(v * cols)])
    o = p.to_object()
    o['loin_bones'] = ','.join(bones)
    o['z_top'] = z_top
    o['z_bot'] = z_bot
    sol = o.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.06
    sol.offset = 1.0 if front else -1.0
    apply_mods(o)
    return duplicate(o, name + '_hi'), o


# ------------------------------------------------------------------ chains and iron
def chain(points, link_len=0.3, R=0.15, r=0.045, name='Chain', bone='Spine2', binding='transfer', broken_last=False,
          seg=8, sides=5):
    p = Part(name, 'iron', bone=bone, binding=binding)
    P = [np.asarray(q, float) for q in points]
    lens = [0.0]
    for a, b in zip(P, P[1:]):
        lens.append(lens[-1] + np.linalg.norm(b - a))
    total = lens[-1]
    count = max(2, int(total / link_len))
    for i in range(count):
        d = total * (i + 0.5) / count
        j = max(0, min(len(P) - 2, int(np.searchsorted(lens, d) - 1)))
        k = (d - lens[j]) / max(1e-9, lens[j + 1] - lens[j])
        c = P[j] + (P[j + 1] - P[j]) * k
        t = P[j + 1] - P[j]
        t /= np.linalg.norm(t)
        side = np.cross(t, (0, 0, 1.0))
        if np.linalg.norm(side) < 1e-3:
            side = np.cross(t, (1.0, 0, 0))
        side /= np.linalg.norm(side)
        if i % 2:
            side = np.cross(t, side)
        # the link's plane contains t; its axis is `side`
        axis = side
        e1 = t
        e2 = np.cross(axis, e1)
        ring = []
        segs = seg
        gap = broken_last and i == count - 1
        for q in range(segs):
            a = math.tau * q / segs
            if gap and 0.4 < a < 1.3:
                continue
            ring.append(c + e1 * math.cos(a) * R * 1.45 + e2 * math.sin(a) * R)
        p.tube(ring, r, sides=sides, closed=not gap, cap=gap, up=tuple(axis))
    return p.to_object()


def build_wrist_iron(side=-1):
    """The broken shackle on his right wrist (and leather wraps on the left)."""
    s = side
    el, wr = (A.ELBOW, A.WRIST) if s > 0 else (A.mirror(A.ELBOW), A.mirror(A.WRIST))
    ax = (wr - el) / np.linalg.norm(wr - el)
    out = []
    if s < 0:
        p = Part('R_Shackle', 'iron', bone='R_Forearm')
        c = _limb(el, wr, 0.9)
        e1 = np.cross(ax, (0, 0, 1.0))
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(ax, e1)
        ring = [c + (e1 * math.cos(math.tau * k / 18) + e2 * math.sin(math.tau * k / 18)) * 0.86 for k in range(18)]
        p.tube(ring, 0.2, sides=6, closed=True, up=tuple(ax), squash=0.55)
        for k in range(6):
            a = math.tau * (k + 0.5) / 6
            p.sphere(c + (e1 * math.cos(a) + e2 * math.sin(a)) * 0.97, (0.065, 0.065, 0.065), seg=8, rings=5)
        # the hinge lug the chain hangs from
        lug = c + e2 * -0.0 + np.array((0, 0, -0.85))
        p.torus(lug, (1, 0, 0), 0.13, 0.05, seg=10, sides=5)
        o = p.to_object()
        out.append((duplicate(o, 'R_Shackle_hi'), o))
        ch = chain([lug + np.array((0, 0, -0.1)), (-5.75, -0.1, 4.95), (-5.82, -0.12, 4.05)], link_len=0.27, R=0.14,
                   r=0.045, name='R_ChainLinks', bone='R_Chain1', binding='chain', broken_last=True)
        out.append((duplicate(ch, 'R_ChainLinks_hi'), ch))
    else:
        p = Part('L_Wraps', 'leather', bone='L_Forearm')
        for k, t in enumerate((0.8, 0.88, 0.95)):
            c = _limb(el, wr, t)
            e1 = np.cross(ax, (0, 0, 1.0))
            e1 /= np.linalg.norm(e1)
            e2 = np.cross(ax, e1)
            rr = 0.86 - 0.12 * (t - 0.8) / 0.15
            ring = [c + (e1 * math.cos(math.tau * q / 16 + k) + e2 * math.sin(math.tau * q / 16 + k)) * rr
                    + ax * 0.04 * math.sin(math.tau * q / 16 * 2) for q in range(16)]
            p.tube(ring, 0.085, sides=5, closed=True, up=tuple(ax), squash=0.5)
        o = p.to_object()
        out.append((duplicate(o, 'L_Wraps_hi'), o))
    return out


def build_knuckle_rope(side):
    w, down, width, palm = A.hand_frame(side)
    name = ('L_' if side > 0 else 'R_') + 'HandRope'
    paths = []
    for k, t in enumerate((0.42, 0.7)):
        c = w + down * t
        ring = []
        for q in range(14):
            a = math.tau * q / 14
            ring.append(c + width * math.cos(a) * 1.0 + palm * math.sin(a) * 0.6 + down * 0.05 * math.sin(a * 2 + k))
        paths.append(ring)
    out = []
    for i, ring in enumerate(paths):
        hi, lo = rope_parts(ring, 0.07, f'{name}{i}', bone=('L_' if side > 0 else 'R_') + 'Hand', binding='rigid')
        out.append((hi, lo))
    return out


# ------------------------------------------------------------------ tally stones
def build_tally(workdir=None):
    """The foreman's tally: a cord of flat river stones notched with the day's count."""
    out = []
    t1h, t1t = A.REST['Tally1']
    t2h, t2t = A.REST['Tally2']
    cord = [t1h, _limb(t1h, t1t, 0.5), t1t, _limb(t2h, t2t, 0.5), t2t]
    hi, lo = rope_parts(cord, 0.045, 'TallyCord', bone='Tally1', binding='tally', closed=False)
    out.append((hi, lo))
    spots = [(t1h, t1t, 0.45, 'Tally1'), (t1h, t1t, 0.95, 'Tally1'), (t2h, t2t, 0.45, 'Tally2'), (t2h, t2t, 0.98, 'Tally2')]
    for i, (a, b, t, bone) in enumerate(spots):
        c = _limb(a, b, t) + np.array((-0.05, -0.12, 0))
        rng = np.random.default_rng(60 + i)
        G = sdf.Field(c - 0.45, c + 0.45, 0.014)
        X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
        R = sdf.rot_matrix(rz=rng.uniform(-0.4, 0.4), rx=rng.uniform(-0.2, 0.2))
        e = sdf.Ellipsoid(c, (0.26 + 0.05 * rng.random(), 0.1, 0.32 + 0.05 * rng.random()), R)
        d = e.dist(X, Y, Z)
        noise = sdf.Noise(70 + i)
        d = d + 0.01 * noise.fbm(X * 9, Y * 9, Z * 9, octaves=2)
        nmarks = 3 + i
        for k in range(nmarks):
            x = (k - (nmarks - 1) / 2) * 0.075
            g = sdf.RoundBox(c + R @ np.array((x, -0.1, 0.0)), (0.012, 0.04, 0.17), R, radius=0.006)
            d = sdf.smax(d, -g.dist(X, Y, Z), 0.008)
        if nmarks >= 5:
            g = sdf.RoundBox(c + R @ np.array((0, -0.1, 0.0)), (0.2, 0.04, 0.012), R @ sdf.rot_matrix(ry=0.6), radius=0.006)
            d = sdf.smax(d, -g.dist(X, Y, Z), 0.008)
        G.d = d.astype(np.float32)
        h = sdf.to_mesh(G, f'Tally{i}_hi', bpy, workdir=workdir)
        lw = duplicate(h, f'Tally{i}')
        decimate(lw, target=140)
        for o in (h, lw):
            o['mat'] = 'stone'
            o['bone'] = bone
            o['binding'] = 'rigid'
        out.append((h, lw))
    return out


# ------------------------------------------------------------------ the face
def build_eye():
    """Eyeball (sclera, baked), the burning iris on EyeCore (glow), and the lids."""
    E, R = A.EYE, A.EYE_R
    out = []
    ball = Part('Eyeball', 'eye', bone='Head')
    ball.sphere(E, (R, R, R), seg=28, rings=16)
    o = ball.to_object()
    out.append((duplicate(o, 'Eyeball_hi'), o))
    # The iris: a dense polar cap facing -Y, coloured by radius; the pupil a slit.
    iris = Part('Iris', 'glow', bone='EyeCore')
    rings, segs = 10, 32
    cap = math.radians(40)
    bm = iris.bm
    col = iris.col
    from mesh_kit import srgb_to_linear
    verts = []
    for i in range(1, rings + 1):
        polar = cap * i / rings
        row = []
        for k in range(segs):
            az = math.tau * k / segs
            d = Vector((math.sin(polar) * math.cos(az), -math.cos(polar), math.sin(polar) * math.sin(az)))
            row.append(bm.verts.new(Vector(E) + d * (R + 0.014 + 0.012 * math.cos(polar * 2.2))))
        verts.append(row)
    center = bm.verts.new(Vector(E) + Vector((0, -(R + 0.026), 0)))
    faces = []
    for k in range(segs):
        faces.append(bm.faces.new((center, verts[0][k], verts[0][(k + 1) % segs])))
    for i in range(rings - 1):
        for k in range(segs):
            faces.append(bm.faces.new((verts[i][k], verts[i + 1][k], verts[i + 1][(k + 1) % segs],
                                       verts[i][(k + 1) % segs])))

    def iris_color(p):
        rel = (Vector(p) - Vector(E))
        polar = math.acos(max(-1, min(1, -rel.y / rel.length)))
        r = polar / cap                       # 0 centre .. 1 limbus
        az = math.atan2(rel.z, rel.x)
        # slit pupil: narrow in x, tall in z
        streak = 0.5 + 0.5 * math.sin(az * 23.0 + math.sin(az * 7) * 2)
        if r < 0.22:
            k = r / 0.22
            return tuple(h * (1 - k) + i * k for h, i in zip(IRIS_HOT, IRIS))
        if r < 0.72:
            k = (r - 0.22) / 0.5
            base = tuple(i * (1 - 0.55 * k) for i in IRIS)
            return tuple(c * (0.55 + 0.6 * streak) for c in base)
        k = min(1.0, (r - 0.72) / 0.16)
        return tuple(i * (1 - k) * 0.4 + d * k for i, d in zip(IRIS, IRIS_DEEP))

    for f in faces:
        for lp in f.loops:
            lp[col] = (*srgb_to_linear(iris_color(lp.vert.co)), 1.0)
    # The pupil: a black slit standing just proud of the iris, so its edge is a clean
    # curve at any distance (vertex colour alone would step along the iris rings).
    for k, (w, h) in enumerate(((0.075, 0.34), )):
        pts = []
        for i in range(24):
            a = math.tau * i / 24
            x, z = math.cos(a) * w, math.sin(a) * h
            x *= 1.0 - 0.55 * (abs(z) / h) ** 1.5
            d = Vector((x, -1.0, z)).normalized()
            pts.append(Vector(E) + Vector((x, 0, z)) + Vector((0, -(R + 0.03 + 0.03 * (1 - (z / h) ** 2)), 0)))
        cen = iris.bm.verts.new(Vector(E) + Vector((0, -(R + 0.062), 0)))
        ring = [iris.bm.verts.new(p) for p in pts]
        pf = [iris.bm.faces.new((cen, ring[i], ring[(i + 1) % 24])) for i in range(24)]
        for f in pf:
            for lp in f.loops:
                lp[col] = (0.0, 0.004, 0.004, 1.0)
    o = iris.to_object()
    out.append((duplicate(o, 'Iris_hi'), o))
    # Lids: shells round the eyeball, modelled CLOSED and swung open about the
    # eye's lateral axis, so the bone's rest is the open eye and its keyed turn
    # closes it. The upper lid travels 72 degrees, the lower 26.
    for name, bone, polar_max, open_deg, up in (('LidUpper', 'LidUp', 98, -72, 1), ('LidLower', 'LidLo', 84, 26, -1)):
        p = Part(name, 'skin', bone=bone)
        rows, cols = 6, 14
        rr = R + 0.055
        pts = {}
        for i in range(rows + 1):
            pol = math.radians(polar_max) * i / rows
            for k in range(cols + 1):
                az = math.radians(-115 + 230 * k / cols)
                # axis +Z (upper) or -Z (lower); azimuth sweeps round the front (-Y)
                d = Vector((math.sin(pol) * math.sin(az), -math.sin(pol) * math.cos(az), up * math.cos(pol)))
                pts[(i, k)] = Vector(E) + d * rr
        rot = Matrix.Rotation(math.radians(open_deg), 3, 'X')
        p.grid(rows, cols, lambda u, v: tuple(rot @ (pts[(round(u * rows), round(v * cols))] - Vector(E)) + Vector(E)))
        # the thick lash line along the leading edge
        edge = [tuple(rot @ (pts[(rows, k)] - Vector(E)) + Vector(E)) for k in range(cols + 1)]
        p.tube(edge, 0.045, sides=6, squash=0.55)
        o = p.to_object()
        sol = o.modifiers.new('sol', 'SOLIDIFY')
        sol.thickness = 0.05
        sol.offset = 1.0
        apply_mods(o)
        out.append((duplicate(o, name + '_hi'), o))
    return out


def build_teeth():
    """Tusks jutting up out of the underbite, a broken row of lower teeth standing
    proud of the lip, and a cracked upper fang bared under the sneer."""
    out = []
    t = Part('Tusks', 'tooth', bone='Jaw')
    for s, broken in ((1, False), (-1, True)):
        base = np.array((0.58 * s, -2.52, 11.5))
        pts = [base, base + (0.06 * s, -0.14, 0.3), base + (0.16 * s, -0.24, 0.62), base + (0.3 * s, -0.24, 0.9)]
        radii = [0.19, 0.16, 0.12, 0.07]
        if broken:
            pts = pts[:3] + [base + (0.2 * s, -0.25, 0.7)]
            radii = [0.19, 0.16, 0.12, 0.1]
        else:
            pts.append(base + (0.42 * s, -0.18, 1.1))
            radii.append(0.015)
        t.tube(pts, radii, sides=10, cap=True)
    # the lower row: blocky, chipped, uneven, leaning, one knocked out
    row = ((-0.4, 0.07, 0.17, -0.12), (-0.25, 0.06, 0.08, 0.1), (-0.1, 0.075, 0.22, -0.05),
           (0.2, 0.065, 0.12, 0.14), (0.33, 0.055, 0.19, -0.1))
    for x, w, h, lean in row:
        y = -2.86 + abs(x) * 0.35
        R = np.array(((math.cos(lean), 0, math.sin(lean)), (0, 1, 0), (-math.sin(lean), 0, math.cos(lean))))
        t.box((x, y, 11.64 + h / 2), (w, 0.05, h / 2 + 0.04), rot=R, color=(1, 1, 1), bevel=0.025, segments=1)
        # a chipped corner
        t.box((x + w * 0.6, y - 0.03, 11.66 + h + 0.02), (w * 0.35, 0.03, 0.03), rot=R, color=(1, 1, 1), bevel=0.01,
              segments=1)
    o = t.to_object()
    out.append((duplicate(o, 'Tusks_hi'), o))
    u = Part('UpperTeeth', 'tooth', bone='Head')
    for k, h in enumerate((0.12, 0.06, 0.15, 0.1, 0.05, 0.14)):
        x = (k - 2.5) * 0.16
        u.tube([(x, -2.36 + abs(x) * 0.3, 11.84), (x, -2.38 + abs(x) * 0.3, 11.84 - h)], [0.065, 0.05], sides=6)
    # the bared fang under the hitched lip
    u.tube([(0.42, -2.62, 11.9), (0.43, -2.72, 11.7), (0.45, -2.76, 11.56)], [0.085, 0.065, 0.012], sides=7)
    o = u.to_object()
    out.append((duplicate(o, 'UpperTeeth_hi'), o))
    m = Part('MouthUpper', 'mouth', bone='Head')
    m.sphere((0, -1.95, 11.74), (0.66, 0.6, 0.22), seg=16, rings=8, cut=((0, 0, 1), -0.05))
    o = m.to_object()
    out.append((duplicate(o, 'MouthUpper_hi'), o))
    m = Part('MouthLower', 'mouth', bone='Jaw')
    m.sphere((0, -1.95, 11.6), (0.64, 0.58, 0.24), seg=16, rings=8, cut=((0, 0, -1), -0.05))
    o = m.to_object()
    out.append((duplicate(o, 'MouthLower_hi'), o))
    return out
