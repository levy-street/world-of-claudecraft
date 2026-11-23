"""Everything the Snarlvine Lasher grew on its braided body (and the Thorn
Sprout's variant of it).

  * Bark plates: shells of the body's own distance field cut into fissured
    plates (the Saurian kit's slabs), on the shoulders, the hump, the forearms,
    the thighs and the shins. The deepest cracks glow with sap (surface.py).
  * Moss: a cushion layer on whatever faces the sky (hump, shoulders, crown).
  * Thorns: hooked rose-thorns seated on the braided strands (anatomy.STRANDS),
    denser and longer on the arms; a crown of broken branch spikes on the hump.
  * Flowers: small blood-red five-petal blooms in the moss (the Gorgebloom's
    colours), a pollen bud in each.
  * The face: a glowing sap core deep in each eye hollow, the dark maw with
    splinter teeth, sap blisters along the chest split.
  * Sprout only: a lip of red petals round the maw, rows of hooked thorn teeth,
    longer thorns everywhere.

Each item returns (high, low) objects. Bindings: `rigid` (one bone), or
`transfer` (weights copied from the nearest skin vertices: thorns, moss).
"""
import math

import bpy
import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, decimate, duplicate

SP = A.SPROUT


# ------------------------------------------------------------------ surface queries
def surface_along(F, origin, direction, max_dist=5.0):
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


def snap(F, p, iters=3):
    """Move a point onto the zero level set along the gradient."""
    p = np.asarray(p, float)
    for _ in range(iters):
        d = F.sample(p[None])[0]
        n = normal_at(F, p)
        p = p - n * d
    return p, normal_at(F, p)


def tangent_frame(n, along=None):
    n = n / np.linalg.norm(n)
    a = np.asarray(along if along is not None else (0, 0, 1), float)
    a = a - n * (a @ n)
    if np.linalg.norm(a) < 1e-3:
        a = np.array((1.0, 0, 0)) - n * n[0]
    a /= np.linalg.norm(a)
    b = np.cross(n, a)
    return a, b


def tag(objs, mat, bone='', binding='rigid', group='body'):
    for o in objs:
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = binding
        o['group'] = group
    return objs


def pair(part_obj, group='body'):
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


# ------------------------------------------------------------------ bark plates
class Slab:
    def __init__(self, origin, direction, size, thick=0.12, along=None, sides=7, seed=1, bone=None, facets=2,
                 sink=0.06, name=None):
        self.origin, self.direction = np.asarray(origin, float), np.asarray(direction, float)
        self.size, self.thick, self.along = size, thick, along
        self.sides, self.seed, self.bone, self.facets, self.sink, self.name = sides, seed, bone, facets, sink, name


def build_slab(F, slab, index, voxel=0.02, workdir=None):
    """A bark plate grown out of the vines: its underside sits in the body, its
    top is the surface pushed out, cut into a ragged outline and into facets,
    and scored with long fissures."""
    rng = np.random.default_rng(slab.seed * 7919 + index)
    q = surface_along(F, slab.origin, slab.direction)
    n = normal_at(F, q)
    t1, t2 = tangent_frame(n, slab.along)
    a, b = slab.size
    reach = max(a, b) * 1.4 + slab.thick + 0.25
    G = sdf.Field(q - reach, q + reach, voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P_all = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    near = np.sqrt(((P_all - q) ** 2).sum(1)) < max(a, b) * 1.45
    db_all = np.full(len(P_all), 1.0)
    db_all[near] = F.sample(P_all[near])
    act = near & (np.abs(db_all) < slab.thick + 0.25)
    P = P_all[act]
    db = db_all[act]
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    noise = sdf.Noise(slab.seed + 100)
    rel = P - q
    u = rel @ t1
    v = rel @ t2
    rad = np.sqrt((u / a) ** 2 + (v / b) ** 2)
    t_out = slab.thick * (1.0 - 0.4 * np.clip(rad, 0, 1) ** 2) * (1.0 + 0.2 * noise(x * 2.3, y * 2.3, z * 2.3))
    d = np.maximum(db - t_out, -(db + slab.sink))
    region = None
    for i in range(slab.sides):
        th = math.tau * i / slab.sides + rng.uniform(-0.25, 0.25)
        dirv = math.cos(th) * t1 + math.sin(th) * t2
        r = 1.0 / math.sqrt((math.cos(th) / a) ** 2 + (math.sin(th) / b) ** 2) * rng.uniform(0.82, 1.05)
        w = dirv - n * rng.uniform(0.3, 0.6)
        w /= np.linalg.norm(w)
        pl = rel @ w - r * (w @ dirv)
        region = pl if region is None else sdf.smax(region, pl, 0.05)
    d = sdf.smax(d, region, 0.03)
    along_n = rel @ n
    d = np.maximum(d, np.abs(along_n - slab.thick * 0.3) - (slab.thick + 0.3))
    for k in range(slab.facets):
        tilt = rng.normal(size=2) * 0.25
        nk = n + t1 * tilt[0] + t2 * tilt[1]
        nk /= np.linalg.norm(nk)
        ck = q + n * slab.thick * rng.uniform(0.75, 0.9) + (t1 * rng.uniform(-a, a) + t2 * rng.uniform(-b, b)) * 0.4
        d = sdf.smax(d, (P - ck) @ nk, 0.04)
    # long fissures along the plate (the bark's grain), scored deep
    ga = u * 0.0 + v
    fiss = np.abs(np.sin(ga * (math.pi / 0.11) + 1.6 * noise(x * 1.5, y * 1.5, z * 1.5)))
    d = d + 0.03 * np.clip(0.3 - fiss, 0, 1) / 0.3 * np.clip(slab.thick / 0.12, 0.5, 1.4)
    d = d + 0.012 * noise.fbm(x * 4, y * 4, z * 4, octaves=3)
    full = np.full(len(P_all), 0.5)
    full[act] = d
    G.d = full.reshape(X.shape).astype(np.float32)
    name = slab.name or f'Bark{index:02d}'
    hi = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    lo = duplicate(hi, name)
    area = math.pi * a * b
    decimate(lo, target=int(60 + 260 * area))
    bone = slab.bone or A.bone_of_point(F, q - n * 0.2)
    tag((hi, lo), 'bark', bone, 'rigid')
    return hi, lo


def bark_specs():
    S = []
    k = 0
    for s in (1, -1):
        m = lambda p: A._m(p, s)  # noqa: E731
        rows = [
            (m((0.95, -0.15, 4.86)), m((0.6, 0.1, 1.0)), (0.36, 0.3), 0.13, (0, 1, 0), 'Shoulder'),
            (m((0.95, -0.15, 4.86)), m((0.9, -0.5, 0.25)), (0.3, 0.24), 0.11, (0, 0, 1), 'Shoulder'),
            (m((0.6, 0.25, 5.0)), m((0.3, 0.5, 1.0)), (0.32, 0.26), 0.12, (0, 1, 0), None),
            (A._lerp(m(A.ELBOW), m(A.WRIST), 0.45), m((1.0, 0.25, 0.1)), (0.24, 0.32), 0.1,
             A.WRIST - A.ELBOW, 'Forearm'),
            (A._lerp(m(A.HIP), m(A.KNEE), 0.5), m((0.6, -0.8, 0.0)), (0.3, 0.36), 0.12, (0, 0, 1), 'Thigh'),
            (A._lerp(m(A.KNEE), m(A.ANKLE), 0.45), m((0.3, -1.0, 0.1)), (0.22, 0.3), 0.1, (0, 0, 1), 'Shin'),
            (A._lerp(m(A.SHOULDER), m(A.ELBOW), 0.45), m((1.0, 0.0, 0.2)), (0.24, 0.3), 0.1,
             A.ELBOW - A.SHOULDER, 'UpperArm'),
        ]
        if SP:
            rows = rows[:2] + rows[3:6]
        for org, dirv, size, th, along, bone in rows:
            k += 1
            S.append(Slab(org, dirv, size, th, along=along, seed=k, sides=7,
                          bone=(A._side(bone, s) if bone else None)))
    if not SP:
        for y, z, sz in ((0.35, 5.3, (0.4, 0.34)), (0.75, 4.75, (0.36, 0.3)), (0.85, 4.0, (0.3, 0.28))):
            k += 1
            S.append(Slab((0, y - 0.3, z - 0.1), (0, 1, 0.6), sz, 0.13, along=(1, 0, 0), seed=k, sides=8,
                          bone=None))
        k += 1
        S.append(Slab((0, -0.4, 4.4), (0, -1, 0.1), (0.2, 0.28), 0.08, along=(0, 0, 1), seed=k, sides=6, bone='Spine2'))
    return S


def build_bark(F, voxel=0.02, workdir=None):
    return [build_slab(F, sl, i, voxel=voxel, workdir=workdir) for i, sl in enumerate(bark_specs())]


# ------------------------------------------------------------------ moss
def shell(F, lo, hi, voxel, name, mat, region, thick=0.1, inset=0.05, target=1500, workdir=None, bone='Chest',
          binding='transfer', group='body'):
    G = sdf.Field(np.asarray(lo, float), np.asarray(hi, float), voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = F.sample(P).reshape(X.shape)
    t = thick(X, Y, Z, db) if callable(thick) else thick
    d = np.maximum(db - t, -(db + inset))
    d = sdf.smax(d, region(X, Y, Z, db), 0.04)
    G.d = d.astype(np.float32)
    h = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    low = duplicate(h, name)
    decimate(low, target=target)
    tag((h, low), mat, bone, binding, group)
    for o in (h, low):
        for p in o.data.polygons:
            p.use_smooth = True
    return h, low


def build_moss(F, voxel=0.03, workdir=None):
    noise = sdf.Noise(23)
    lo, hi = (-1.9, -1.9, 3.6), (1.9, 1.4, 6.2)

    cache = {}

    def mask(X, Y, Z, db):
        if 'm' not in cache:
            h = 0.08
            P = np.stack([X.ravel(), Y.ravel(), (Z + h).ravel()], axis=1)
            nz = (F.sample(P).reshape(X.shape) - db) / h
            m = 0.8 * noise.fbm(X * 1.1, Y * 1.1, Z * 1.1, octaves=3) + 1.6 * (nz - 0.6)
            hc = A.HEAD_C
            face = ((X - hc[0]) ** 2 + (Y - hc[1]) ** 2 + (Z - hc[2]) ** 2 < 0.8 ** 2) | (Y < -0.95)
            m = np.where(face, m - 3.0, m)              # keep the face and the head bare
            m = m - 0.25
            cache['m'] = m
        return cache['m']

    def region(X, Y, Z, db):
        return (0.1 - mask(X, Y, Z, db)) * 1.5

    def thick(X, Y, Z, db):
        m = mask(X, Y, Z, db)
        lump = 0.7 + 0.6 * noise.fbm(X * 3.0 + 5, Y * 3.0, Z * 3.0, octaves=3)
        return 0.025 + 0.075 * np.clip((m - 0.1) * 2.2, 0, 1) * lump

    return shell(F, lo, hi, voxel, 'Moss', 'moss', region, thick=thick, inset=0.04, target=1800, workdir=workdir)


# ------------------------------------------------------------------ thorns
def thorn(part, base, n, hook, length, r0, sides=4):
    """A hooked rose-thorn: out along the normal, the tip bent toward `hook`."""
    base = np.asarray(base, float)
    n = np.asarray(n, float)
    hook = np.asarray(hook, float)
    p0 = base - n * r0 * 0.6
    p1 = base + n * length * 0.55 + hook * length * 0.1
    p2 = base + n * length * 0.9 + hook * length * 0.5
    part.tube([p0, p1, p2], [r0, r0 * 0.42, 0.003], sides=sides)


def build_thorns(F, seed=5):
    rng = np.random.default_rng(seed)
    p = Part('Thorns', 'thorn', binding='transfer')
    count = 0
    dens = 1.0
    for line, rads in A.STRANDS:
        pts = np.array(line)
        seglen = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        L = seglen.sum()
        nthorn = int(L * (2.6 * dens))
        cum = np.concatenate([[0], np.cumsum(seglen)])
        for _ in range(nthorn):
            s = rng.uniform(0.05, 0.97) * L
            i = int(np.searchsorted(cum, s) - 1)
            i = max(0, min(i, len(pts) - 2))
            u = (s - cum[i]) / max(seglen[i], 1e-9)
            c = pts[i] + (pts[i + 1] - pts[i]) * u
            tang = (pts[i + 1] - pts[i]) / max(seglen[i], 1e-9)
            # seat it on the outer face of the strand
            q, n = snap(F, c + rng.normal(size=3) * 0.04)
            if np.linalg.norm(q - c) > 0.25 or q[2] < 0.12:
                continue
            if not SP and q[1] < -1.0 and q[2] > 4.1 and abs(q[0]) < 0.62:
                continue                                   # keep the face readable
            r_here = float(rads[min(i, len(rads) - 1)])
            length = rng.uniform(0.12, 0.26) * (1.9 if SP else 1.0) * (0.6 + 2.2 * r_here)
            hook = -tang if rng.uniform() < 0.5 else tang
            hook = hook - n * (hook @ n)
            hook /= max(1e-9, np.linalg.norm(hook))
            thorn(p, q, n, hook, length, length * 0.22)
            count += 1
    # bigger thorns down the shins and the forearms, along the vine arm's outer line
    for s in (1, -1):
        for a, b, nn in ((A.KNEE, A.ANKLE, 5), (A.ELBOW, A.WRIST, 6)):
            for t in np.linspace(0.12, 0.88, nn):
                c = A._lerp(A._m(a, s), A._m(b, s), t)
                out = np.array((s * 1.0, rng.uniform(-0.6, 0.3), rng.uniform(-0.2, 0.3)))
                try:
                    q = surface_along(F, c, out, 1.5)
                except RuntimeError:
                    continue
                n = normal_at(F, q)
                L = rng.uniform(0.3, 0.42) * (1.4 if SP else 1.0)
                thorn(p, q, n, np.array((0, 0, -1.0)) if t > 0.5 else np.array((0, 0, 1.0)), L, L * 0.2, sides=6)
                count += 1
    print('THORNS', count)
    return [pair(p.to_object())]


def build_crown(F, seed=9):
    """Broken branch spikes jutting from the hump and the shoulders, swept back:
    the silhouette's crown of thorns."""
    rng = np.random.default_rng(seed)
    p = Part('BranchCrown', 'bark', bone='Chest')
    rows = [((0.0, 0.3, 5.5), (0.0, 0.55, 1.0), 0.95), ((0.35, 0.15, 5.45), (0.35, 0.45, 1.0), 0.8),
            ((-0.35, 0.15, 5.45), (-0.35, 0.45, 1.0), 0.8), ((0.75, -0.05, 5.25), (0.7, 0.3, 1.0), 0.7),
            ((-0.75, -0.05, 5.25), (-0.7, 0.3, 1.0), 0.7), ((0.15, 0.6, 5.2), (0.1, 1.0, 0.7), 0.62),
            ((-0.2, 0.62, 5.15), (-0.15, 1.0, 0.65), 0.58), ((1.1, -0.1, 5.1), (0.9, 0.0, 0.8), 0.55),
            ((-1.1, -0.1, 5.1), (-0.9, 0.0, 0.8), 0.55)]
    if SP:
        rows = [((0.0, -0.75, 5.6), (0.0, 0.4, 1.0), 0.75), ((0.45, -0.85, 5.45), (0.5, 0.3, 1.0), 0.6),
                ((-0.45, -0.85, 5.45), (-0.5, 0.3, 1.0), 0.6), ((0.7, -0.4, 5.2), (0.8, 0.5, 0.6), 0.5),
                ((-0.7, -0.4, 5.2), (-0.8, 0.5, 0.6), 0.5), ((0.0, -0.3, 5.5), (0.0, 0.8, 0.8), 0.6)]
    for c, d, L in rows:
        d = np.asarray(d, float)
        d /= np.linalg.norm(d)
        try:
            q = surface_along(F, np.asarray(c) - d * 0.5, d, 2.0)
        except RuntimeError:
            continue
        side = np.cross(d, (1, 0, 0))
        if np.linalg.norm(side) < 1e-3:
            side = np.array((0, 1.0, 0))
        side /= np.linalg.norm(side)
        bend = side * rng.uniform(-0.25, 0.25) + np.array((0, 0.3, -0.1))
        pts = [q - d * 0.12, q + d * L * 0.35, q + d * L * 0.7 + bend * L * 0.25, q + d * L + bend * L * 0.5]
        p.tube(pts, [0.11 * L + 0.03, 0.07 * L + 0.02, 0.04 * L + 0.01, 0.004], sides=7)
        # a side twig
        mid = q + d * L * 0.45
        tw = (d * 0.5 + side * (1 if rng.uniform() < 0.5 else -1) * 0.8)
        tw /= np.linalg.norm(tw)
        p.tube([mid, mid + tw * L * 0.3, mid + tw * L * 0.45 + d * L * 0.1], [0.035 * L + 0.01, 0.015, 0.003], sides=5)
    o = p.to_object()
    o['binding'] = 'transfer'
    return [pair(o)]


# ------------------------------------------------------------------ flowers
def flower(part_p, part_c, c, n, size, rng, petals=5):
    n = n / np.linalg.norm(n)
    t1, t2 = tangent_frame(n)
    rot0 = rng.uniform(0, math.tau)
    for i in range(petals):
        a = rot0 + math.tau * i / petals
        d = math.cos(a) * t1 + math.sin(a) * t2
        tilt = d * 0.85 + n * 0.5
        tilt /= np.linalg.norm(tilt)
        side = np.cross(n, d)
        R = np.stack([side, tilt, np.cross(side, tilt)], axis=1)
        part_p.sphere(c + tilt * size * 0.55 + n * size * 0.05, (size * 0.36, size * 0.62, size * 0.07), rot=R,
                      seg=8, rings=5)
    part_c.sphere(c + n * size * 0.12, (size * 0.24,) * 3, seg=7, rings=5)


def build_flowers(F, seed=13):
    rng = np.random.default_rng(seed)
    pp = Part('Flowers', 'petal', binding='transfer')
    pc = Part('FlowerBuds', 'pollen', binding='transfer')
    spots = [(0.55, 0.0), (-0.6, 0.05), (0.2, 0.45), (-0.25, 0.5), (1.05, -0.3), (-1.0, -0.25), (0.35, -0.85),
             (-0.4, -0.8), (0.85, 0.3), (-0.8, 0.35), (0.0, 0.85), (1.3, -0.1), (-1.32, -0.05)]
    for x, y in spots:
        try:
            q = surface_along(F, (x, y, 6.4), (0, 0, -1), 3.0)
        except RuntimeError:
            continue
        n = normal_at(F, q)
        flower(pp, pc, q + n * 0.07, n, rng.uniform(0.13, 0.2), rng)
    # a few on the thighs and the forearms
    for s in (1, -1):
        for a, b, t, out in ((A.HIP, A.KNEE, 0.35, (1.0, -0.5, 0.4)), (A.ELBOW, A.WRIST, 0.25, (1.0, 0.3, 0.6))):
            c = A._lerp(A._m(a, s), A._m(b, s), t)
            q = surface_along(F, c, np.array((out[0] * s, out[1], out[2])), 1.5)
            n = normal_at(F, q)
            flower(pp, pc, q + n * 0.06, n, rng.uniform(0.12, 0.16), rng)
    return [pair(pp.to_object()), pair(pc.to_object())]


# ------------------------------------------------------------------ face
def build_face(F):
    out = []
    eyes = Part('SapEyes', 'sap', bone='Head')
    for s in (1, -1):
        e = A._m(A.EYE, s)
        eyes.sphere(e + np.array((0, 0.05 if not SP else 0.02, -0.01)), (A.EYE_R * 1.3, A.EYE_R, A.EYE_R * 0.7), seg=12, rings=8)
    out.append(pair(eyes.to_object()))
    if not SP:
        maw = Part('Maw', 'maw', bone='Head')
        maw.sphere((0, -1.45, 4.5), (0.24, 0.26, 0.05), seg=12, rings=6)
        out.append(pair(maw.to_object()))
        low = Part('MawLow', 'maw', bone='Jaw')
        low.sphere((0, -1.45, 4.43), (0.22, 0.24, 0.04), seg=12, rings=6)
        out.append(pair(low.to_object()))
        up = Part('TeethUpper', 'thorn', bone='Head')
        lo = Part('TeethLower', 'thorn', bone='Jaw')
        rng = np.random.default_rng(3)
        for a in np.linspace(-1.1, 1.1, 9):
            x = 0.26 * math.sin(a)
            y = -1.64 + 0.2 * (1 - math.cos(a))
            ln = rng.uniform(0.08, 0.15)
            up.tube([np.array((x, y, 4.56)), np.array((x, y - 0.01, 4.56 - ln))], [0.03, 0.003], sides=5)
            ln = rng.uniform(0.06, 0.12)
            lo.tube([np.array((x * 0.92, y + 0.02, 4.4)), np.array((x * 0.92, y + 0.01, 4.4 + ln))], [0.028, 0.003],
                    sides=5)
        out += [pair(up.to_object()), pair(lo.to_object())]
        # sap blisters along the chest split and in the hollows of the arms
        sap = Part('SapBlisters', 'sap', binding='transfer')
        for z in (4.45, 4.2, 3.95, 3.7, 3.45):
            q, n = snap(F, (0.0, -0.95 + 0.03 * math.sin(z * 9), z))
            sap.sphere(q - n * 0.03, (0.06, 0.06, 0.08), seg=8, rings=6)
        out.append(pair(sap.to_object()))
    else:
        # the bud's maw: a throat, petal lips and rows of hooked thorn teeth
        z = A.MOUTH['z']
        maw = Part('Maw', 'maw', bone='Head')
        maw.sphere((0, -1.15, z + 0.04), (0.7, 0.72, 0.08), seg=16, rings=6)
        out.append(pair(maw.to_object()))
        low = Part('MawLow', 'maw', bone='Jaw')
        low.sphere((0, -1.15, z - 0.04), (0.68, 0.7, 0.07), seg=16, rings=6)
        out.append(pair(low.to_object()))
        up = Part('TeethUpper', 'thorn', bone='Head')
        lo = Part('TeethLower', 'thorn', bone='Jaw')
        rng = np.random.default_rng(4)
        for row, (rad, ln0) in enumerate(((0.8, 0.26), (0.6, 0.2))):
            for a in np.linspace(-1.35, 1.35, 13 - row * 3):
                x = rad * math.sin(a)
                y = -1.12 - rad * math.cos(a)
                inward = np.array((-math.sin(a), math.cos(a), 0.0)) * 0.3
                ln = ln0 * rng.uniform(0.8, 1.2)
                b = np.array((x, y, z + 0.06))
                up.tube([b, b + np.array((0, 0, -ln * 0.6)) + inward * ln * 0.3, b + np.array((0, 0, -ln)) + inward * ln],
                        [0.045, 0.02, 0.003], sides=5)
                b = np.array((x * 0.97, y * 0.99 - 0.0, z - 0.06))
                lo.tube([b, b + np.array((0, 0, ln * 0.6)) + inward * ln * 0.3, b + np.array((0, 0, ln)) + inward * ln],
                        [0.045, 0.02, 0.003], sides=5)
        out += [pair(up.to_object()), pair(lo.to_object())]
        # petal lips round the maw (upper on the head, lower on the jaw)
        pu = Part('LipPetalsUp', 'petal', bone='Head')
        pl = Part('LipPetalsLow', 'petal', bone='Jaw')
        for a in np.linspace(-1.2, 1.2, 5):
            for part, dz, up_s in ((pu, 0.1, 1), (pl, -0.1, -1)):
                c = np.array((0.9 * math.sin(a), -1.12 - 0.92 * math.cos(a), z + dz))
                d = np.array((math.sin(a), -math.cos(a), 0.55 * up_s))
                d /= np.linalg.norm(d)
                side = np.cross(d, (0, 0, 1.0))
                side /= np.linalg.norm(side)
                R = np.stack([side, d, np.cross(side, d)], axis=1)
                part.sphere(c + d * 0.22, (0.24, 0.36, 0.05), rot=R, seg=10, rings=6)
        out += [pair(pu.to_object()), pair(pl.to_object())]
    return out
