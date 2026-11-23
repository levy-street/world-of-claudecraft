"""Everything the Great Saurian grew or the Sunbone trolls put on it.

Grown: the dorsal scutes (shells of the body's own distance field, like the
Balgath kit's barrowhide slabs), the moss carpets on its back and haunches with
ferns rooted in them, the toenails, the eyes, the teeth and the mouth.
Worn: the saddle blanket and the girth straps (shells of the skin, so they cinch
the flesh), the neck collar with its bone charms, the bone rings round the neck,
the carved forehead plate and the lashed horns, the bone spikes on the tail club.
The howdah: deck, bolsters, rails, posts, canopy, banners, shields, ropes, every
piece rigid on its own bone; and the seated troll rider.

Each item returns (high, low) objects; `group` marks which shipped mesh it joins
('body', 'howdah' or 'rider').
"""
import math

import bpy
import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, apply_mods, decimate, duplicate


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
    """(high, low) from one bmesh Part object (the high is a copy)."""
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


def two_sided(obj, offset=0.012):
    """Give a sheet a back face (glTF draws one side): the faces duplicated,
    flipped, and pushed a hair behind."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    faces = list(bm.faces)
    ret = bmesh.ops.duplicate(bm, geom=faces)
    new_faces = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=new_faces)
    bm.normal_update()
    for f in new_faces:
        for v in f.verts:
            v.co = v.co + f.normal * offset
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def solidify(obj, thickness):
    m = obj.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = 0.0
    apply_mods(obj)
    return obj


# ------------------------------------------------------------------ slabs (scutes, bone plates)
class Slab:
    def __init__(self, origin, direction, size, thick=0.3, along=None, sides=7, seed=1, bone=None, facets=3,
                 sink=0.1, name=None, voxel=None, chips=True, mat='scute'):
        self.voxel, self.chips, self.mat = voxel, chips, mat
        self.origin, self.direction = np.asarray(origin, float), np.asarray(direction, float)
        self.size, self.thick, self.along = size, thick, along
        self.sides, self.seed, self.bone, self.facets, self.sink = sides, seed, bone, facets, sink
        self.name = name


def build_slab(F, slab, index, voxel=0.03, noise=None, workdir=None):
    """A plate grown out of the skin: its underside sits inside the flesh, its top
    is the skin pushed out and cut into facets (the Balgath kit's barrowhide)."""
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
    t_out = slab.thick * (1.0 - 0.45 * np.clip(rad, 0, 1) ** 2) * (1.0 + 0.15 * noise(x * 2.3, y * 2.3, z * 2.3))
    d = np.maximum(db - t_out, -(db + slab.sink))
    region = None
    for i in range(slab.sides):
        th = math.tau * i / slab.sides + rng.uniform(-0.2, 0.2)
        dirv = math.cos(th) * t1 + math.sin(th) * t2
        r = 1.0 / math.sqrt((math.cos(th) / a) ** 2 + (math.sin(th) / b) ** 2) * rng.uniform(0.86, 1.04)
        w = dirv - n * rng.uniform(0.3, 0.6)
        w /= np.linalg.norm(w)
        pl = rel @ w - r * (w @ dirv)
        region = pl if region is None else sdf.smax(region, pl, 0.08)
    d = sdf.smax(d, region, 0.05)
    along_n = rel @ n
    d = np.maximum(d, np.abs(along_n - slab.thick * 0.3) - (slab.thick + 0.3))
    for k in range(slab.facets):
        tilt = rng.normal(size=2) * 0.3
        nk = n + t1 * tilt[0] + t2 * tilt[1]
        nk /= np.linalg.norm(nk)
        ck = q + n * slab.thick * rng.uniform(0.7, 0.9) + (t1 * rng.uniform(-a, a) + t2 * rng.uniform(-b, b)) * 0.4
        d = sdf.smax(d, (P - ck) @ nk, 0.05)
    ks = min(1.0, slab.thick / 0.3)
    d = d + ks * (0.02 * noise.fbm(x * 3.2, y * 3.2, z * 3.2, octaves=3) + 0.006 * noise(x * 14, y * 14, z * 14))
    for _ in range(rng.integers(1, 4) if slab.chips else 0):
        th = rng.uniform(0, math.tau)
        c = q + (math.cos(th) * t1 * a + math.sin(th) * t2 * b) * rng.uniform(0.8, 1.0) + n * slab.thick * 0.7
        cr = rng.uniform(0.07, 0.14) * max(a, b)
        dc = np.sqrt(((P - c) ** 2).sum(1)) - cr
        d = sdf.smax(d, -dc, 0.03)
    full = np.full(len(P_all), 0.5)
    full[act] = d
    G.d = full.reshape(X.shape).astype(np.float32)
    name = slab.name or f'Scute{index:02d}'
    hi = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    lo = duplicate(hi, name)
    area = math.pi * a * b
    decimate(lo, target=int(50 + 120 * area))
    bone = slab.bone or A.bone_of_point(F, q - n * 0.25)
    tag((hi, lo), slab.mat, bone, 'rigid')
    return hi, lo


def scute_specs():
    """The scutes: a double row of horn plates down the neck, the withers, the sacral
    hump and the tail (the howdah's blanket covers the middle of the back)."""
    S = []
    k = 0
    for i in range(4):
        a, b = A.NECK_PTS[i], A.NECK_PTS[i + 1]
        R = A.seg_frame(a, b)
        up = R[:, 1]
        for t in (0.25, 0.7):
            c = A._lerp(a, b, t)
            r = A.NECK_R[i] + (A.NECK_R[i + 1] - A.NECK_R[i]) * t
            sz = 0.62 * r / 2.0 + 0.18
            for sx in (1, -1):
                k += 1
                S.append(Slab(c, up + np.array((0.32 * sx, 0, 0)), (sz, sz * 1.25), 0.2 + 0.12 * r / 2.0,
                              along=b - a, seed=k, sides=6, facets=2, mat='scute'))
    # the withers, in front of the blanket
    for y, sz, th in ((-4.3, 0.6, 0.36), (-3.6, 0.66, 0.4)):
        for sx in (1, -1):
            k += 1
            S.append(Slab((0.0, y, 8.6), (0.38 * sx, -0.1, 1), (sz, sz * 1.2), th, along=(0, 1, 0), seed=k, sides=7))
    # the sacral hump and down the tail
    for y, sz, th in ((2.35, 0.7, 0.42), (3.25, 0.78, 0.46), (4.2, 0.72, 0.42)):
        for sx in (1, -1):
            k += 1
            S.append(Slab((0.0, y, 8.4), (0.4 * sx, 0.05, 1), (sz, sz * 1.25), th, along=(0, 1, 0), seed=k, sides=7))
    for i in range(1, 6):
        a, b = A.TAIL_PTS[i], A.TAIL_PTS[i + 1]
        R = A.seg_frame(a, b)
        up = -R[:, 1]                      # the tail's frame y points down (its axis falls)
        r = A.TAIL_R[i]
        for t in (0.2, 0.7):
            c = A._lerp(a, b, t)
            sz = 0.28 + 0.24 * r
            for sx in (1, -1):
                k += 1
                S.append(Slab(c, up + np.array((0.35 * sx, 0, 0)), (sz, sz * 1.3), 0.14 + 0.16 * r, along=b - a,
                              seed=k, sides=6, facets=2))
    return S


# ------------------------------------------------------------------ skin shells (moss, blanket, straps, rings)
def shell(F, lo, hi, voxel, name, mat, region, thick=0.1, inset=0.05, target=1500, workdir=None, bone='Spine1',
          binding='transfer', group='body'):
    """A layer over the skin: `region(X, Y, Z, db)` is negative where it covers;
    `thick` a number or fn(X, Y, Z, db)."""
    G = sdf.Field(np.asarray(lo, float), np.asarray(hi, float), voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = F.sample(P).reshape(X.shape)
    t = thick(X, Y, Z, db) if callable(thick) else thick
    d = np.maximum(db - t, -(db + inset))
    d = sdf.smax(d, region(X, Y, Z, db), 0.05)
    G.d = d.astype(np.float32)
    h = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    low = duplicate(h, name)
    decimate(low, target=target)
    tag((h, low), mat, bone, binding, group)
    for o in (h, low):
        for p in o.data.polygons:
            p.use_smooth = True
    return h, low


def build_moss(F, voxel=0.06, workdir=None):
    """Moss cushions on everything that faces the sky, outside the blanket."""
    noise = sdf.Noise(23)
    lo, hi = (-4.4, -9.6, 5.8), (4.4, 17.0, 15.2)

    def up_of(X, Y, Z, db):
        h = 0.15
        P = np.stack([X.ravel(), Y.ravel(), (Z + h).ravel()], axis=1)
        return ((F.sample(P).reshape(X.shape) - db) / h)

    cache = {}

    def mask(X, Y, Z, db):
        if 'm' not in cache:
            nz = up_of(X, Y, Z, db)
            m = 0.9 * noise.fbm(X * 0.42, Y * 0.42, Z * 0.42, octaves=3) + 1.5 * (nz - 0.52)
            blanket = (Y > -3.5) & (Y < 2.1) & (Z > 7.2)
            m = np.where(blanket, m - 2.0, m)
            head = Y < -8.9
            m = np.where(head, m - 0.25, m)
            cache['m'] = m
        return cache['m']

    def region(X, Y, Z, db):
        return (0.12 - mask(X, Y, Z, db)) * 1.6

    def thick(X, Y, Z, db):
        m = mask(X, Y, Z, db)
        lump = 0.7 + 0.6 * noise.fbm(X * 1.7 + 5, Y * 1.7, Z * 1.7, octaves=3)
        return 0.06 + 0.32 * np.clip((m - 0.12) * 2.2, 0, 1) * lump

    return shell(F, lo, hi, voxel, 'Moss', 'moss', region, thick=thick, inset=0.06, target=4200, workdir=workdir)


def build_blanket(F, voxel=0.05, workdir=None):
    """The Sunbone saddle blanket over the middle of the back, scalloped at its hem."""
    def region(X, Y, Z, db):
        edge = 7.55 + 0.22 * np.cos((Y + 0.7) * 4.6) + 0.15 * (np.abs(X) < 1.0)
        return np.maximum(np.abs(Y + 0.7) - 2.65, edge - Z)
    return shell(F, (-4.2, -3.8, 6.8), (4.2, 2.4, 11.4), voxel, 'Blanket', 'cloth', region, thick=0.1, inset=0.05,
                 target=1700, workdir=workdir)


def build_girth(F, y0, name, voxel=0.045, workdir=None):
    def region(X, Y, Z, db):
        return np.maximum(np.abs(Y - y0 - 0.06 * (Z - 7)) - 0.22, Z - 8.3)
    return shell(F, (-4.0, y0 - 1.2, 3.6), (4.0, y0 + 1.2, 8.6), voxel, name, 'leather', region, thick=0.08,
                 inset=0.05, target=700, workdir=workdir)


def build_neck_band(F, seg, t, halfw, thick, name, mat, voxel=0.04, workdir=None):
    a, b = A.NECK_PTS[seg], A.NECK_PTS[seg + 1]
    ax = (b - a) / np.linalg.norm(b - a)
    c = A._lerp(a, b, t)
    reach = 3.0

    def region(X, Y, Z, db):
        rel_n = (X - c[0]) * ax[0] + (Y - c[1]) * ax[1] + (Z - c[2]) * ax[2]
        return np.abs(rel_n) - halfw

    def th(X, Y, Z, db):
        rel_n = (X - c[0]) * ax[0] + (Y - c[1]) * ax[1] + (Z - c[2]) * ax[2]
        return thick * (1.0 - 0.35 * (rel_n / halfw) ** 2)
    return shell(F, c - reach, c + reach, voxel, name, mat, region, thick=th, inset=0.05, target=600, workdir=workdir)


# ------------------------------------------------------------------ small parts
def build_eyes():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        p = Part(side + 'EyeBall', 'eye', bone=side + 'Eye')
        p.sphere(A._m(A.EYE, s), (A.EYE_R,) * 3, seg=18, rings=12)
        out.append(pair(p.to_object()))
    return out


def build_mouth():
    out = []
    p = Part('MouthInside', 'mouth', bone='Head')
    p.sphere((0, -10.75, 13.16), (0.72, 1.05, 0.1), seg=14, rings=6)
    out.append(pair(p.to_object()))
    p = Part('Tongue', 'mouth', bone='Jaw')
    p.sphere((0, -10.7, 13.08), (0.42, 0.85, 0.07), seg=12, rings=6)
    out.append(pair(p.to_object()))
    # peg teeth along both jaws, worn blunt
    up = Part('TeethUpper', 'tooth', bone='Head')
    low = Part('TeethLower', 'tooth', bone='Jaw')
    for y in np.linspace(-11.95, -10.55, 8):
        u = (y + 11.15) / 1.18
        w = 0.8 * math.sqrt(max(0.0, 1 - u * u)) * 0.86
        zl = 13.2 - 0.09 * (-11.1 - y)
        for s in (1, -1):
            for part, dz, ln in ((up, 0.05, -0.12), (low, -0.05, 0.1)):
                base = np.array((s * w, y, zl + dz))
                part.tube([base - np.array((0, 0, np.sign(ln) * 0.06)), base + np.array((0, 0, ln))], [0.055, 0.02],
                          sides=5)
    out.append(pair(up.to_object()))
    out.append(pair(low.to_object()))
    return out


def build_nails():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        for pad, bone, n, rad in ((A.FPAD, 'Hand', 4, 1.38), (A.HPAD, 'Foot', 3, 1.44)):
            c = A._m(pad, s)
            p = Part(f'{side}{bone}Nails', 'nail', bone=side + bone)
            angs = np.linspace(-62, 62, n) if n == 4 else np.linspace(-48, 48, n)
            for a in angs:
                th = math.radians(a)
                d = np.array((math.sin(th), -math.cos(th), 0.0))
                pos = c + d * rad * 0.93 + np.array((0, 0, -0.2))
                R = sdf.frame_from(d)
                p.sphere(pos, (0.44, 0.34, 0.48), rot=R, seg=12, rings=8)
            out.append(pair(p.to_object()))
    return out


def horn(part, base, ctrl, tip, r0, n=9):
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.8 + 0.012)
    part.tube(pts, rr, sides=8)


def build_head_bone(F, workdir=None):
    """The carved bone plate over the nasal arch, and the two horns the trolls
    lashed above its brows."""
    out = [build_slab(F, Slab((0, -10.25, 13.9), (0, -0.35, 1), (0.6, 0.85), 0.2, along=(0, 1, 0), seed=91, sides=7,
                              facets=1, sink=0.06, bone='Head', name='BonePlate', mat='bone', chips=False, voxel=0.025),
                      0, workdir=workdir)]
    p = Part('BrowHorns', 'bone', bone='Head')
    for s in (1, -1):
        base = np.array((0.62 * s, -10.05, 14.55))
        horn(p, base, base + np.array((0.55 * s, 0.6, 0.55)), base + np.array((0.75 * s, 1.55, 0.5)), 0.17)
    out.append(pair(p.to_object()))
    r = Part('HornLashing', 'rope', bone='Head')
    for s in (1, -1):
        base = np.array((0.62 * s, -10.05, 14.5))
        r.torus(base + np.array((0.05 * s, 0.05, 0.08)), (0.3 * s, 0.4, 0.8), 0.19, 0.04, seg=12, sides=5)
    out.append(pair(r.to_object()))
    return out


def build_tail_club():
    p = Part('ClubSpikes', 'bone', bone='Tail7')
    c = np.array((0, 16.8, 3.3))
    rng = np.random.default_rng(5)
    dirs = [(1, 0.1, 0.35), (-1, 0.1, 0.35), (0.85, 0.6, 0.0), (-0.85, 0.6, 0.0), (0.55, -0.3, 0.8),
            (-0.55, -0.3, 0.8), (0.25, 0.85, 0.5), (-0.25, 0.85, 0.5), (0.0, 0.3, 1.0)]
    for d in dirs:
        d = np.asarray(d, float)
        d /= np.linalg.norm(d)
        root = c + d * 0.6
        ln = 0.75 + rng.uniform(0, 0.3)
        bend = d + np.array((0, 0.35, 0))
        horn(p, root, root + d * ln * 0.5 + bend * 0.1, root + d * ln + np.array((0, 0.25, 0)), 0.17, n=6)
    out = [pair(p.to_object())]
    r = Part('ClubLashing', 'rope', bone='Tail7')
    r.torus((0, 15.65, 3.5), (0, 1, -0.3), 0.72, 0.06, seg=18, sides=5)
    r.torus((0, 15.95, 3.45), (0, 1, -0.3), 0.75, 0.06, seg=18, sides=5)
    out.append(pair(r.to_object()))
    return out


def build_charms(F):
    """Bone charms on three cords under the throat, hung from the collar."""
    a, b = A.NECK_PTS[1], A.NECK_PTS[2]
    top = surface_along(F, A._lerp(a, b, 0.4), (0, -0.05, -1))
    rope = Part('CharmCords', 'rope', bone='Charm1', binding='charm')
    bones_ = Part('CharmBones', 'bone', bone='Charm1', binding='charm')
    for k, dx in enumerate((-0.45, 0.0, 0.45)):
        ln = (1.5, 2.0, 1.3)[k]
        p0 = top + np.array((dx * 0.6, 0.0, 0.05))
        p1 = p0 + np.array((dx * 0.35, -0.08, -ln))
        rope.tube([p0, (p0 + p1) / 2 + np.array((0, -0.03, 0)), p1], 0.045, sides=5)
        # a long bone across the cord, a fang below it
        mid = p0 + (p1 - p0) * 0.55
        bones_.tube([mid + np.array((-0.32, 0, 0.04)), mid + np.array((0.32, 0, -0.04))], [0.07, 0.05, 0.07], sides=6)
        for e in (-0.33, 0.33):
            bones_.sphere(mid + np.array((e, 0, 0)), (0.1, 0.09, 0.09), seg=8, rings=5)
        bones_.tube([p1 + np.array((0, 0, 0.05)), p1 + np.array((0.04, -0.03, -0.42))], [0.09, 0.012], sides=6)
        if k == 1:
            bones_.sphere(p1 + np.array((0, 0, -0.1)), (0.22, 0.24, 0.2), seg=12, rings=8)   # a small skull
    return [pair(rope.to_object()), pair(bones_.to_object())]


# ------------------------------------------------------------------ ferns
def fern(part, base, up, rng, n_fronds=6, length=1.4):
    """A fern crown: fronds arching out of the moss, each a rachis with leaflets."""
    up = np.asarray(up, float)
    up /= np.linalg.norm(up)
    e1 = np.cross(up, (0, 0, 1.0)) if abs(up[2]) < 0.9 else np.cross(up, (1.0, 0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    for f in range(n_fronds):
        th = math.tau * f / n_fronds + rng.uniform(-0.3, 0.3)
        out = math.cos(th) * e1 + math.sin(th) * e2
        ln = length * rng.uniform(0.75, 1.15)
        tilt = rng.uniform(0.35, 0.65)
        pts = []
        for i in range(9):
            t = i / 8
            # arching: rises, then droops
            p = base + (out * math.sin(tilt + t * 1.1) + up * math.cos(tilt + t * 1.6)) * ln * t
            pts.append(p)
        part.tube(pts, [0.03 * (1 - t) + 0.01 for t in np.linspace(0, 1, 9)], sides=3)
        # leaflets: little blades alternating along the rachis
        for i in range(2, 8):
            t = i / 8
            p = pts[i]
            tang = pts[min(i + 1, 8)] - pts[i - 1]
            tang /= np.linalg.norm(tang)
            side = np.cross(tang, up)
            if np.linalg.norm(side) < 1e-3:
                side = e1
            side /= np.linalg.norm(side)
            w = 0.34 * (1 - t) ** 0.7 * ln / 1.4 + 0.05
            for sgn in (1, -1):
                tip = p + side * sgn * w + tang * w * 0.45 - up * w * 0.15
                q0 = p - tang * 0.05
                q1 = p + tang * 0.07
                part.grid(1, 1, lambda u, v, q0=q0, q1=q1, tip=tip: (q0 + (q1 - q0) * v) * (1 - u) + tip * u)


def build_ferns(F, moss_lo):
    rng = np.random.default_rng(31)
    spots = [(-1.6, 3.6), (1.7, 3.0), (-0.9, 4.6), (1.2, 5.2), (-2.0, -3.9), (2.1, -4.2), (0.0, -4.7), (-1.2, 6.6),
             (1.4, 7.4), (-2.3, 2.4), (2.4, 1.9), (0.6, -5.4)]
    out = []
    for k, (x, y) in enumerate(spots):
        try:
            q = surface_along(F, (x * 0.5, y, 7.0), (x * 0.5, 0, 3.0), max_dist=6)
        except RuntimeError:
            continue
        n = normal_at(F, q)
        if n[2] < 0.35:
            continue
        bone = A.bone_of_point(F, q - n * 0.3)
        p = Part(f'Fern{k:02d}', 'fern', bone=bone, binding='transfer')
        fern(p, q + n * 0.08, n * 0.7 + np.array((0, 0, 0.3)), rng, n_fronds=int(rng.integers(5, 8)),
             length=rng.uniform(1.0, 1.7))
        o = p.to_object()
        two_sided(o)
        out.append(pair(o))
    return out


# ------------------------------------------------------------------ the howdah
def bamboo(part, a, b, r, sides=6, seg=0.75):
    """A bamboo pole: a tube with swollen nodes every `seg` yards."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ln = np.linalg.norm(b - a)
    k = max(2, int(round(ln / seg)))
    pts, rr = [], []
    for i in range(k):
        for tt, rad in ((0.0, 1.16), (0.07, 1.0)):
            t = (i + tt) / k
            pts.append(a + (b - a) * t)
            rr.append(r * rad)
    pts.append(b)
    rr.append(r * 1.16)
    part.tube(pts, rr, sides=sides)


def lash(part, c, axis, r):
    part.torus(c, axis, r + 0.035, 0.035, seg=10, sides=4)
    part.torus(np.asarray(c) + np.asarray(axis) / np.linalg.norm(axis) * 0.07, axis, r + 0.035, 0.035, seg=10, sides=4)


def skull(part, c, s=1.0, facing=(0, -1, 0)):
    """A horned beast skull (a post finial)."""
    c = np.asarray(c, float)
    f = np.asarray(facing, float)
    part.sphere(c, (0.26 * s, 0.3 * s, 0.24 * s), seg=12, rings=8)
    part.sphere(c + f * 0.28 * s + np.array((0, 0, -0.06 * s)), (0.17 * s, 0.22 * s, 0.13 * s), seg=10, rings=6)
    for sx in (1, -1):
        base = c + np.array((0.2 * sx * s, 0, 0.1 * s))
        horn(part, base, base + np.array((0.4 * sx, 0.05, 0.25)) * s, base + np.array((0.5 * sx, -0.25, 0.6)) * s,
             0.09 * s, n=6)


def build_howdah():
    c = A.HOWDAH_C
    hx, hy = A.HOWDAH_HALF
    top = c[2] + A.POST_H
    out = []
    # the deck: poles across the back on two beams, bolsters under its edges
    base = Part('HowdahDeck', 'bamboo', bone='HowdahBase')
    for i in range(14):
        y = c[1] - hy + 0.15 + i * (2 * hy - 0.3) / 13
        bamboo(base, (-hx - 0.12, y, c[2] - 0.15), (hx + 0.12, y, c[2] - 0.15), 0.16, sides=5, seg=1.4)
    for sx in (0.85, -0.85):
        bamboo(base, (sx, c[1] - hy - 0.3, c[2] - 0.4), (sx, c[1] + hy + 0.3, c[2] - 0.4), 0.2, seg=1.4)
    for sx in (hx - 0.05, -hx + 0.05):
        bamboo(base, (sx, c[1] - hy - 0.15, c[2] - 0.32), (sx, c[1] + hy + 0.15, c[2] - 0.32), 0.12, seg=1.2)
    out.append(pair(base.to_object(), 'howdah'))
    bol = Part('HowdahBolsters', 'leather', bone='HowdahBase')
    for sx in (1.5, -1.5):
        bol.tube([(sx, c[1] - hy + 0.1, c[2] - 0.82), (sx * 1.03, c[1], c[2] - 0.92), (sx, c[1] + hy - 0.1, c[2] - 0.82)],
                 [0.5, 0.6, 0.5], sides=10)
    out.append(pair(bol.to_object(), 'howdah'))
    # the posts; the back ones rise into banner poles with a crossbar
    for tag_, sx, sy in (('FL', 1, -1), ('FR', -1, -1), ('BL', 1, 1), ('BR', -1, 1)):
        p = Part('HowdahPost' + tag_, 'bamboo', bone='HowdahPost' + tag_)
        x, y = sx * hx, c[1] + sy * hy
        h = top + (2.2 if sy > 0 else 0.15)
        bamboo(p, (x, y, c[2] - 0.45), (x, y, h), 0.2)
        if sy > 0:
            bamboo(p, (x + sx * 0.24, y - 0.1, top + 1.98), (x + sx * 0.24, y + 1.3, top + 1.98), 0.08)
            lash(p, (x, y, top + 1.98), (0, 0, 1), 0.2)
        out.append(pair(p.to_object(), 'howdah'))
        r = Part('HowdahLash' + tag_, 'rope', bone='HowdahPost' + tag_)
        for z in (c[2] + 0.55, c[2] + 1.05, top - 0.1):
            lash(r, (x, y, z), (0, 0, 1), 0.2)
        out.append(pair(r.to_object(), 'howdah'))
        if sy < 0:
            sk = Part('HowdahSkull' + tag_, 'bone', bone='HowdahPost' + tag_)
            skull(sk, (x, y, top + 0.5), 1.25)
            out.append(pair(sk.to_object(), 'howdah'))
    # rails (left, right, front); the back stays open for the rider
    for tag_, a, b in (('L', (hx, c[1] - hy, 0), (hx, c[1] + hy, 0)), ('R', (-hx, c[1] - hy, 0), (-hx, c[1] + hy, 0)),
                       ('F', (-hx, c[1] - hy, 0), (hx, c[1] - hy, 0))):
        p = Part('HowdahRail' + tag_, 'bamboo', bone='HowdahRail' + tag_)
        for z in (c[2] + 0.55, c[2] + 1.05):
            bamboo(p, (a[0], a[1], z), (b[0], b[1], z), 0.11)
        # short uprights and crossed braces between the rails
        for t in (0.33, 0.66):
            q = np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t
            bamboo(p, (q[0], q[1], c[2] - 0.05), (q[0], q[1], c[2] + 1.1), 0.09)
        out.append(pair(p.to_object(), 'howdah'))
        if tag_ in ('L', 'R'):
            sx = 1 if tag_ == 'L' else -1
            sh = Part('HowdahShield' + tag_, 'hide', bone='HowdahRail' + tag_)
            ctr = np.array((sx * (hx + 0.2), c[1] + 0.3, c[2] + 0.75))
            sh.tube([ctr - np.array((0.06 * sx, 0, 0)), ctr + np.array((0.06 * sx, 0, 0))], [0.72, 0.72], sides=18)
            out.append(pair(sh.to_object(), 'howdah'))
            rim = Part('HowdahShieldRim' + tag_, 'bone', bone='HowdahRail' + tag_)
            rim.torus(ctr + np.array((0.07 * sx, 0, 0)), (1, 0, 0), 0.72, 0.06, seg=20, sides=5)
            rim.sphere(ctr + np.array((0.1 * sx, 0, 0)), (0.12, 0.16, 0.16), seg=10, rings=6)
            out.append(pair(rim.to_object(), 'howdah'))
    # the canopy: a hide stretched over three bamboo arches
    roof = Part('HowdahCanopy', 'hide', bone='HowdahRoof')
    W, L = hx + 0.45, hy + 0.5

    def canopy(u, v):
        x = -W + 2 * W * v
        y = c[1] - L + 2 * L * u
        z = top + 0.75 * math.cos(math.pi * x / (2 * W)) ** 0.8 - 0.15 * math.sin(math.pi * u * 3) ** 2
        return (x, y, z)
    roof.grid(10, 14, canopy)
    ro = roof.to_object()
    solidify(ro, 0.05)
    out.append(pair(ro, 'howdah'))
    arch = Part('HowdahArches', 'bamboo', bone='HowdahRoof')
    for y in (c[1] - L + 0.15, c[1], c[1] + L - 0.15):
        pts = [(-W + 2 * W * k / 10, y, top + 0.07 + 0.75 * math.cos(math.pi * (-W + 2 * W * k / 10) / (2 * W)) ** 0.8)
               for k in range(11)]
        arch.tube(pts, 0.09, sides=6)
    out.append(pair(arch.to_object(), 'howdah'))
    # bone charms hanging from the canopy's front edge
    ch = Part('HowdahCharms', 'bone', bone='HowdahRoof')
    for x in np.linspace(-W + 0.3, W - 0.3, 6):
        z0 = top + 0.75 * math.cos(math.pi * x / (2 * W)) ** 0.8 - 0.05
        ch.tube([(x, c[1] - L, z0), (x, c[1] - L - 0.02, z0 - 0.42)], [0.04, 0.035], sides=4)
        ch.tube([(x - 0.12, c[1] - L - 0.02, z0 - 0.45), (x + 0.12, c[1] - L - 0.02, z0 - 0.48)], [0.05, 0.04], sides=5)
        ch.tube([(x, c[1] - L - 0.02, z0 - 0.5), (x + 0.02, c[1] - L - 0.04, z0 - 0.85)], [0.06, 0.01], sides=5)
    out.append(pair(ch.to_object(), 'howdah'))
    # tie-down ropes from the deck to the girth straps
    ropes = Part('HowdahRopes', 'rope', bone='HowdahBase')
    for sx in (1, -1):
        for y in (-2.25, 1.2):
            ropes.tube([(sx * (hx - 0.1), y, c[2] - 0.25), (sx * 2.75, y, 9.0), (sx * 3.15, y + 0.05, 8.1)], 0.065, sides=5)
    out.append(pair(ropes.to_object(), 'howdah'))
    # the Sunbone banners: hung from the back crossbars, the sun on dark red
    for side, sx in (('L', 1), ('R', -1)):
        b = Part('Banner' + side, 'banner', bone=f'Banner{side}1', binding='banner')
        x = sx * (hx + 0.24)
        y0, y1 = c[1] + hy - 0.05, c[1] + hy + 1.25
        z0, z1 = top + 1.93, top - 0.5

        def flag(u, v, x=x, y0=y0, y1=y1, z0=z0, z1=z1, sx=sx):
            y = y0 + (y1 - y0) * v
            # a ragged hem: three tongues
            hem = 1.0 - 0.13 * (0.5 + 0.5 * math.cos(v * math.tau * 1.5)) * u ** 6
            z = z0 + (z1 - z0) * u * hem
            return (x + sx * 0.06 * math.sin(u * 3.1 + v * 2.0), y, z)
        b.grid(10, 6, flag)
        bo = b.to_object()
        solidify(bo, 0.035)
        out.append(pair(bo, 'howdah'))
    return out


def build_rider():
    """The Sunbone hexcaller riding the howdah, cross-legged with his staff: a
    render-only body until the howdah breaks and the real mob jumps down."""
    c = A.HOWDAH_C + np.array((0, -0.25, 0.0))
    z = c[2]
    out = []
    skin = Part('RiderBody', 'troll', bone='Rider')
    # torso hunched forward, shoulders, neck
    skin.tube([(0, c[1] + 0.05, z + 0.45), (0, c[1] - 0.05, z + 0.95), (0, c[1] - 0.18, z + 1.4)], [0.36, 0.38, 0.44],
              sides=12)
    skin.sphere((0, c[1] - 0.2, z + 1.42), (0.58, 0.36, 0.3), seg=14, rings=8)
    skin.tube([(0, c[1] - 0.25, z + 1.55), (0, c[1] - 0.42, z + 1.82)], [0.17, 0.15], sides=8)
    # the head: long jaw, big nose, swept ears, tusks
    hc = np.array((0, c[1] - 0.55, z + 1.98))
    skin.sphere(hc, (0.25, 0.27, 0.25), seg=14, rings=10)
    skin.sphere(hc + (0, -0.2, -0.12), (0.2, 0.22, 0.16), seg=12, rings=8)
    skin.tube([hc + (0, -0.2, 0.0), hc + (0, -0.46, -0.08), hc + (0, -0.52, -0.16)], [0.09, 0.07, 0.04], sides=7)
    for s in (1, -1):
        skin.tube([hc + (0.2 * s, 0.02, 0.05), hc + (0.45 * s, 0.12, 0.2), hc + (0.62 * s, 0.22, 0.32)], [0.08, 0.05, 0.01],
                  sides=6)
        # arms: shoulder, elbow forward, hands on knees / the staff
        sh = np.array((0.5 * s, c[1] - 0.2, z + 1.38))
        el = sh + np.array((0.12 * s, -0.25, -0.5))
        wr = el + (np.array((-0.12 * s, -0.45, 0.02)) if s > 0 else np.array((0.05, -0.32, 0.28)))
        skin.tube([sh, el, wr], [0.15, 0.12, 0.09], sides=8)
        skin.sphere(wr + np.array((0, -0.08, 0)), (0.1, 0.12, 0.09), seg=8, rings=6)
        # crossed legs
        hp = np.array((0.24 * s, c[1] + 0.0, z + 0.4))
        kn = np.array((0.62 * s, c[1] - 0.55, z + 0.32))
        ft = np.array((-0.25 * s, c[1] - 0.7, z + 0.18))
        skin.tube([hp, kn, ft], [0.2, 0.15, 0.11], sides=8)
    out.append(pair(skin.to_object(), 'rider'))
    tusk = Part('RiderTusks', 'tooth', bone='Rider')
    for s in (1, -1):
        b = hc + np.array((0.12 * s, -0.3, -0.2))
        horn(tusk, b, b + np.array((0.03 * s, -0.08, 0.14)), b + np.array((0.08 * s, -0.02, 0.28)), 0.04, n=5)
    out.append(pair(tusk.to_object(), 'rider'))
    cloth = Part('RiderCloth', 'cloth', bone='Rider')
    cloth.sphere((0, c[1] + 0.0, z + 0.42), (0.52, 0.48, 0.25), seg=14, rings=8)
    cloth.tube([(0, c[1] - 0.2, z + 1.6), (0, c[1] + 0.15, z + 1.0), (0, c[1] + 0.32, z + 0.35)], [0.3, 0.46, 0.52],
               sides=12)                                                                    # the cloak
    out.append(pair(cloth.to_object(), 'rider'))
    bone = Part('RiderBone', 'bone', bone='Rider')
    # a bone mask over the brow and a crest of bone spikes; the staff with its skull
    bone.sphere(hc + (0, -0.12, 0.1), (0.27, 0.2, 0.17), seg=12, rings=8, cut=((0, -1, 0.3), 0.0))
    for k, a in enumerate((-0.5, 0.0, 0.5)):
        b = hc + np.array((0.12 * a, 0.0, 0.2))
        horn(bone, b, b + np.array((0.15 * a, 0.12, 0.3)), b + np.array((0.3 * a, 0.3, 0.55 - 0.1 * abs(a))), 0.05, n=5)
    st = np.array((-0.62, c[1] - 0.68, z + 0.05))
    bone.tube([st, st + np.array((0.02, -0.05, 2.5))], [0.05, 0.045], sides=6)
    skull(bone, st + np.array((0.02, -0.05, 2.65)), 0.55)
    out.append(pair(bone.to_object(), 'rider'))
    for h, lo in out:
        for o in (h, lo):
            o['group'] = 'rider'
    return out
