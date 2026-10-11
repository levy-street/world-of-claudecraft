"""Korzul's dressing: everything that is not the sculpted skin, each as a high/low
pair for the bake (most pieces are their own high, subdivided once).

  * horn: the two great back-swept horns, the cheek horns, the crown of
    bone-white spikes behind the skull, the brow, jaw and chin spikes, the nose
    horn, and the dorsal spines down the neck, the back and the tail (keratin,
    ivory to stained, never bare bone: this is a living wyrm, not the Knellwyrm).
  * tooth, eye, mouth (tongue and palate), claw (fore, hind, thumb).
  * iron: the Smith's shackles (two forelegs, the right hind leg, the collar) with
    their rune bands, and the broken chains hanging from them, link by link.
  * ice: the old quench-ice still fused to his back and tail, icicles under the
    jaw, the chest and the wings, and the eight great slabs (IceShed bones) that
    burst off in BreakFree.
  * shard: the swallowed heart-shard breaking out through the sternum.
  * skin: the wing fingers; membrane: the tattered wing membranes.

Bindings: `rigid` (one bone), `preset` (the part wrote its own vertex groups:
fingers, membranes).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import anatomy as A
import mesh_kit as K

RNG = np.random.default_rng(1207)
H, HK = A.H, A.HK


def V(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def _m(p, s):
    return np.array((p[0] * s, p[1], p[2]), float)


def side_name(n, s):
    return ('L_' if s > 0 else 'R_') + n


def pair(obj, subsurf=0, group='body'):
    obj['group'] = group
    hi = K.duplicate(obj, obj.name + '_hi')
    if subsurf:
        m = hi.modifiers.new('ss', 'SUBSURF')
        m.levels = subsurf
        m.render_levels = subsurf
        K.apply_mods(hi)
    for p in hi.data.polygons:
        p.use_smooth = True
    return hi, obj


# ------------------------------------------------------------------ shapes
def bend_path(base, direction, length, n=9, curl_axis=None, curl=0.0, droop=0.0):
    """Points of a curved spike: from base along direction, bending `curl` degrees
    in total about `curl_axis`, and drooping (world -Z) by `droop` yards at the tip."""
    d = V(direction).normalized()
    pts = [V(base)]
    p = V(base)
    step = length / (n - 1)
    ax = V(curl_axis).normalized() if curl_axis is not None else None
    for i in range(1, n):
        if ax is not None and curl:
            d = (Matrix.Rotation(math.radians(curl / (n - 1)), 3, ax) @ d).normalized()
        p = p + d * step
        pts.append(p + Vector((0, 0, -droop * (i / (n - 1)) ** 2)))
    return pts


def spike(part, base, direction, length, r0, curl_axis=None, curl=0.0, sides=10, squash=1.0, up=(0, 0, 1),
          rings=0.0, n=9, tip=0.012, droop=0.0, blunt=0.0):
    pts = bend_path(base, direction, length, n, curl_axis, curl, droop)
    radii = []
    for i in range(n):
        t = i / (n - 1)
        r = r0 * (1 - t) ** 0.85 + tip
        if blunt:
            r = max(r, r0 * blunt * (1 - t) + tip)
        if rings:
            r *= 1 + rings * math.sin(t * 34.0) * (1 - t)
        radii.append(r)
    part.tube(pts, radii, sides=sides, squash=squash, up=up)
    return pts


def crystal(part, center, size, axis, n_pts=14, seed=0, elong=1.6):
    """A faceted ice or star-glass chunk: the convex hull of jittered points."""
    rng = np.random.default_rng(seed)
    ax = V(axis).normalized()
    R = ax.to_track_quat('Z', 'Y').to_matrix()
    pts = []
    for _ in range(n_pts):
        v = rng.normal(size=3)
        v /= np.linalg.norm(v)
        v *= rng.uniform(0.55, 1.0)
        pts.append(R @ Vector((v[0] * size[0], v[1] * size[1], v[2] * size[2] * elong)) + V(center))
    tmp = bmesh.new()
    vs = [tmp.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(tmp, input=vs)
    me = bpy.data.meshes.new('tmpc')
    tmp.to_mesh(me)
    tmp.free()
    before = set(part.bm.faces)
    part.bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    faces = [f for f in part.bm.faces if f not in before]
    for f in faces:
        f.smooth = False
    return faces


def prism(part, base, direction, length, r, sides=6, tip_len=0.35, seed=0):
    """A star-glass crystal: a hexagonal prism with a pointed cap."""
    d = V(direction).normalized()
    s = d.orthogonal().normalized()
    u = d.cross(s)
    rng = np.random.default_rng(seed)
    ring0, ring1 = [], []
    for k in range(sides):
        a = math.tau * k / sides + rng.uniform(-0.12, 0.12)
        off = (s * math.cos(a) + u * math.sin(a)) * r * rng.uniform(0.85, 1.1)
        ring0.append(part.bm.verts.new(V(base) + off * 0.9))
        ring1.append(part.bm.verts.new(V(base) + d * length + off))
    apex = part.bm.verts.new(V(base) + d * (length + tip_len * length))
    for k in range(sides):
        a0, a1, b0, b1 = ring0[k], ring0[(k + 1) % sides], ring1[k], ring1[(k + 1) % sides]
        part.bm.faces.new((a0, a1, b1, b0)).smooth = False
        part.bm.faces.new((b0, b1, apex)).smooth = False
    part.bm.faces.new(list(reversed(ring0))).smooth = False


# ------------------------------------------------------------------ head
def build_horns(F):
    pairs = []
    p = K.Part('Horns', 'horn', bone='Head', smooth=True)
    for s in (1, -1):
        # the two great horns: up and back off the crown, curving back and out, then down
        base = H(_m((0.9, -17.75, 17.35), s))
        spike(p, base, _m((0.32, 0.75, 0.58), s), 4.6, 0.62 * HK, curl_axis=(0.9, 0.0, 0.3 * s), curl=-38,
              sides=16, rings=0.07, n=16, droop=0.5)
        # the cheek horns: back and out off the cheekbones
        base = H(_m((1.75, -17.2, 16.55), s))
        spike(p, base, _m((0.55, 0.82, -0.05), s), 2.0, 0.3 * HK, curl_axis=(0, 0, 1), curl=14 * s, sides=12,
              rings=0.05, n=11)
        base = H(_m((1.45, -17.0, 16.05), s))
        spike(p, base, _m((0.4, 0.9, -0.25), s), 2.2, 0.22 * HK, curl_axis=(0, 0, 1), curl=10 * s, sides=10, n=9)
    pairs.append(pair(p.to_object(), subsurf=1))

    c = K.Part('Crown', 'horn', bone='Head', smooth=True)
    # a crown of bone-white spikes fanned round the back of the skull
    for k, a in enumerate(np.linspace(-70, 70, 9)):
        th = math.radians(a)
        base = H((0.95 * math.sin(th), -17.45 + 0.15 * abs(math.sin(th)), 16.45 + 0.75 * math.cos(th)))
        d = np.array((math.sin(th) * 0.75, 0.9, 0.35 * math.cos(th) + 0.1))
        ln = (1.5 - 0.5 * abs(math.sin(th))) * (1.0 if k % 2 == 0 else 0.72)
        spike(c, base, d, ln, 0.2 * HK, curl_axis=(1, 0, 0), curl=-8, sides=8, n=8)
    # brow spikes, three a side above each eye, raking back
    for s in (1, -1):
        for j in range(3):
            base = H(_m((0.95 + 0.08 * j, -19.9 + 0.55 * j, 17.12 - 0.04 * j), s))
            spike(c, base, _m((0.25, 0.8, 0.55), s), 0.85 - 0.12 * j, 0.11 * HK, sides=7, n=6)
    # the nose horn
    spike(c, H((0, -21.75, 16.0)), (0, -0.35, 1.0), 1.3, 0.2 * HK, curl_axis=(1, 0, 0), curl=-24, sides=9, n=8)
    spike(c, H((0, -20.95, 16.3)), (0, -0.1, 1.0), 0.6, 0.12 * HK, sides=7, n=6)
    pairs.append(pair(c.to_object(), subsurf=1))

    j = K.Part('JawSpikes', 'horn', bone='Jaw', smooth=True)
    for s in (1, -1):
        for k in range(3):
            base = H(_m((0.95 - 0.12 * k, -18.6 - 0.9 * k, 14.55), s))
            spike(j, base, _m((0.45, 0.75, -0.45), s), 1.25 - 0.25 * k, 0.17 * HK, curl_axis=(1, 0, 0), curl=12,
                  sides=8, n=7)
        spike(j, H(_m((0.3, -21.55, 14.5), s)), _m((0.2, 0.2, -1.0), s), 0.7, 0.13 * HK, sides=7, n=6)   # chin
    pairs.append(pair(j.to_object(), subsurf=1))
    return pairs


def lip_x(F, y, z):
    """How far out the lip surface sits at (y, z) (projected from the midline)."""
    q = A._project(F, (0.0, y, z), (4.0, y, z), inset=0.04)
    return float(q[0])


def build_teeth(F):
    pairs = []
    mz = A.MOUTH['z']
    up = K.Part('TeethUpper', 'tooth', bone='Head', smooth=True)
    lo = K.Part('TeethLower', 'tooth', bone='Jaw', smooth=True)
    y0, y1 = A.MOUTH['y_corner'] - 0.35, A.MOUTH['y_front'] + 0.35
    n = 8
    for s in (1, -1):
        for i in range(n):
            t = i / (n - 1)
            y = y0 + (y1 - y0) * t
            x = max(0.22, lip_x(F, y, mz + 0.14) - 0.1) * s
            fang = i in (5, 6)
            ln = (0.8 if fang else 0.3 + 0.2 * math.sin(i * 1.7 + s) ** 2) * HK
            r = (0.13 if fang else 0.085) * HK
            spike(up, (x, y, mz + 0.18), (0.1 * s, -0.05, -1.0), ln, r, curl_axis=(1, 0, 0), curl=-14, sides=7, n=6)
            if i % 2:
                continue
            xl = max(0.2, lip_x(F, y + 0.25, mz - 0.14) - 0.12) * s
            ln2 = (0.62 if i == 7 else 0.22 + 0.12 * math.cos(i * 1.3 + s) ** 2) * HK
            spike(lo, (xl, y + 0.25, mz - 0.2), (0.08 * s, -0.08, 1.0), ln2, 0.08 * HK, curl_axis=(1, 0, 0), curl=10,
                  sides=7, n=6)
    pairs.append(pair(up.to_object(), subsurf=1))
    pairs.append(pair(lo.to_object(), subsurf=1))
    # the mouth: tongue on the jaw, palate in the head (dark, the throat glowing grave-green)
    t = K.Part('Tongue', 'mouth', bone='Jaw', smooth=True)
    pts = [H((0, y, 14.98 + 0.06 * math.sin(math.pi * (y + 18.3) / -3.6))) for y in np.linspace(-18.3, -21.6, 8)]
    t.tube(pts, [0.48 * HK, 0.5 * HK, 0.46 * HK, 0.42 * HK, 0.36 * HK, 0.28 * HK, 0.18 * HK, 0.06 * HK], sides=12,
           squash=0.28, up=(0, 0, 1))
    pairs.append(pair(t.to_object(), subsurf=1))
    pl = K.Part('Palate', 'mouth', bone='Head', smooth=True)
    pl.sphere(H((0, -19.9, 15.32)), HR3((0.95, 2.6, 0.16)), seg=16, rings=8)
    pairs.append(pair(pl.to_object()))
    return pairs


def HR3(r):
    return tuple(np.asarray(r, float) * HK)


def build_eyes():
    pairs = []
    for s in (1, -1):
        e = K.Part(side_name('Eye', s), 'eye', bone='Head', smooth=True)
        c = A._m(A.EYE, s) - _m(A.EYE_DIR, s) * 0.16
        R = A.seg_frame(c, c + _m(A.EYE_DIR, s))
        e.sphere(c, (A.EYE_R * 1.15, A.EYE_R * 0.62, A.EYE_R), rot=R, seg=20, rings=12)
        pairs.append(pair(e.to_object()))
    return pairs


# ------------------------------------------------------------------ body spikes
def drop(F, x, y, z0=24.0, z1=-1.0, inset=0.1):
    """The first skin point met going straight down (from outside the body) at (x, y)."""
    z = min(z0, F.lo[2] + (F.shape[2] - 2) * F.voxel)
    while z > z1:
        if F.sample(np.array([[x, y, z]]))[0] < 0:
            return np.array((x, y, z - inset))
        z -= F.voxel * 0.5
    return None


def build_spines(F):
    """Dorsal spines down the neck, the back and the tail, each riding its bone."""
    pairs = []
    stations = []
    for i in range(14):                                   # the neck, from the head back
        t = 0.92 - i * 0.066
        c, r = A.neck_at(t)
        stations.append((c, r, 0.9 + 0.75 * (1 - t), 'neck'))
    for y in np.linspace(-6.6, 7.8, 13):                  # the back
        stations.append((np.array((0, y, 11.0)), 1.0, 2.6 - 1.0 * abs((y + 3.5) / 11.0), 'back'))
    for i in range(18):                                   # the tail
        t = 0.04 + i * 0.054
        c, r = A.tail_at(t)
        stations.append((c, r, 1.9 * (1 - t) ** 0.9 + 0.25, 'tail'))
    candidates = [n for n in A.REST if n.startswith(('Neck', 'Tail', 'Spine', 'Hips', 'Chest'))]
    by_bone = {}
    for k, (c, r, ln, kind) in enumerate(stations):
        base = drop(F, 0.0, c[1], inset=0.16)
        if base is None:
            continue
        # sweep back along the body
        if kind == 'neck':
            t0 = np.array((0, 1.0, -0.5))
        elif kind == 'tail':
            t0 = np.array((0, 1.0, 0.55))
        else:
            t0 = np.array((0, 0.8, 0.9))
        broken = False
        ln = ln * 0.6
        bone = A.nearest_bone(base, candidates)
        by_bone.setdefault(bone, []).append((base, t0, ln * (0.55 if broken else 1.0), broken, r))
    for bone, items in by_bone.items():
        p = K.Part('Spines_' + bone, 'horn', bone=bone, smooth=True)
        for base, t0, ln, broken, r in items:
            d = np.array((0, 0.0, 1.0)) * 0.55 + t0 * 0.45
            spike(p, base, d, ln, min(0.55, 0.18 + 0.22 * ln), curl_axis=(1, 0, 0), curl=-26, sides=10,
                  squash=0.4, up=(1, 0, 0), n=8, blunt=0.45 if broken else 0.0)
        pairs.append(pair(p.to_object(), subsurf=1))
    return pairs


def build_claws():
    pairs = []
    for s in (1, -1):
        for front in (True, False):
            paw = A._m(A.FPAW if front else A.HPAW, s)
            bone = side_name('FToes' if front else 'HToes', s)
            p = K.Part(bone + 'Claws', 'claw', bone=bone, smooth=True)
            angles = np.linspace(-38, 38, 3) if front else np.linspace(-34, 34, 3)
            for k, a in enumerate(angles):
                th = math.radians(a)
                d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
                tip = paw + d * ((1.55 if k == 1 else 1.35) if front else (1.5 if k == 1 else 1.3)) + np.array((0, 0, -0.1))
                spike(p, tip - d * 0.15 + np.array((0, 0, 0.12)), d + np.array((0, 0, -0.35)), 1.15, 0.24,
                      curl_axis=np.cross(d, (0, 0, 1)), curl=-55, sides=9, squash=0.7, up=(0, 0, 1), n=8)
            pairs.append(pair(p.to_object(), subsurf=1))
            if front:  # the inner thumb claw on the hand
                q = K.Part(side_name('ThumbClaw', s), 'claw', bone=side_name('Hand', s), smooth=True)
                spike(q, paw + _m((0.95, 0.85, 0.0), s), _m((0.4, -0.5, -0.5), s), 0.8, 0.18,
                      curl_axis=(1, 0, 0), curl=40, sides=8, n=7)
                pairs.append(pair(q.to_object(), subsurf=1))
    return pairs


# ------------------------------------------------------------------ iron
def build_shackles():
    pairs = []
    pts = {'ELBOW': A.ELBOW, 'WRIST': A.WRIST, 'KNEE': A.KNEE, 'HOCK': A.HOCK}
    for name, (bone, a, b, t, rad) in A.SHACKLES.items():
        s = 1 if bone.startswith('L_') else -1
        pa, pb = A._m(pts[a], s), A._m(pts[b], s)
        c = pa + (pb - pa) * t
        ax = (pb - pa) / np.linalg.norm(pb - pa)
        p = K.Part(name, 'rune_iron', bone=bone, smooth=True)
        for k, (off, r, w) in enumerate(((-0.42, rad, 0.17), (0.0, rad + 0.05, 0.26), (0.42, rad, 0.17))):
            cc = c + ax * off
            p.torus(cc, ax, r, w, seg=28, sides=6, squash=(1.0, 1.0))
        # rivets round the middle band
        side = np.cross(ax, (0, 0, 1))
        side /= np.linalg.norm(side)
        up = np.cross(side, ax)
        for k in range(10):
            a_ = math.tau * k / 10
            q = c + (side * math.cos(a_) + up * math.sin(a_)) * (rad + 0.28)
            p.sphere(q, (0.09, 0.09, 0.09), seg=8, rings=5)
        # the ring the chain hangs from
        ch = [v for v in A.CHAINS.values() if v[0] == bone][0]
        anc = np.array(ch[1])
        p.torus(anc + np.array((0, 0, 0.1)), (0, 1, 0), 0.36, 0.1, seg=16, sides=6)
        pairs.append(pair(p.to_object(), subsurf=1))
    # the collar on the neck's root
    p = K.Part('Collar', 'rune_iron', bone='Neck1', smooth=True)
    a, b = A.NECK_PTS[0], A.NECK_PTS[1]
    c = a + (b - a) * 0.42
    ax = (b - a) / np.linalg.norm(b - a)
    r = A.NECK_R[0] * 0.92 + 0.2
    for off, rr, w in ((-0.55, r - 0.05, 0.2), (0.0, r + 0.08, 0.34), (0.55, r - 0.12, 0.2)):
        p.torus(c + ax * off, ax, rr, w, seg=36, sides=6)
    side = np.array((1.0, 0, 0))
    up = np.cross(side, ax)
    for k in range(16):
        a_ = math.tau * k / 16
        q = c + (side * math.cos(a_) + up * math.sin(a_)) * (r + 0.4)
        p.sphere(q, (0.12, 0.12, 0.12), seg=8, rings=5)
    anc = np.array(A.CHAINS['ChainNk'][1])
    p.torus(anc + np.array((0, 0.0, 0.15)), (1, 0, 0), 0.5, 0.13, seg=16, sides=6)
    pairs.append(pair(p.to_object(), subsurf=1))
    return pairs


def build_chains():
    pairs = []
    L, W, T = 0.66, 0.4, 0.11
    for name, (parent, anchor, pts) in A.CHAINS.items():
        stations = [np.array(anchor, float)] + [np.array(q, float) for q in pts]
        flip = 0
        for i in range(len(stations) - 1):
            bone = f'{name}{i + 1}'
            a, b = stations[i], stations[i + 1]
            seg = np.linalg.norm(b - a)
            d = (b - a) / seg
            n = max(1, int(round(seg / (L * 0.78))))
            part = K.Part(bone + 'Links', 'iron', bone=bone, smooth=True)
            for k in range(n):
                c = a + d * (seg * (k + 0.5) / n)
                # a link: a torus stretched along the chain, every other one turned 90 degrees
                side = np.cross(d, (0, 0, 1)) if abs(d[2]) < 0.95 else np.cross(d, (1, 0, 0))
                side /= np.linalg.norm(side)
                if flip % 2:
                    side = np.cross(d, side)
                flip += 1
                ax = np.cross(d, side)
                e1 = V(d)
                e2 = V(side)
                ring = []
                for j in range(14):
                    ang = math.tau * j / 14
                    ring.append(V(c) + e1 * math.cos(ang) * (L * 0.5) + e2 * math.sin(ang) * (W * 0.5))
                last_broken = (i == len(stations) - 2 and k == n - 1)
                if last_broken:   # the last link is snapped open
                    ring = ring[2:]
                part.tube(ring + ([] if last_broken else []), T, sides=6, closed=not last_broken, up=tuple(ax))
            pairs.append(pair(part.to_object()))
    return pairs


# ------------------------------------------------------------------ ice
ICE_CRUST = [  # (center on the surface (x, y), size, the bone family)
    ((0.9, -5.6), (1.1, 1.3, 0.45)), ((-1.3, -3.0), (1.0, 1.6, 0.4)), ((1.5, -0.4), (0.9, 1.4, 0.35)),
    ((-0.7, 2.6), (1.2, 1.5, 0.4)), ((1.2, 5.6), (1.0, 1.3, 0.4)), ((-1.4, 7.6), (0.9, 1.2, 0.35)),
    ((0.0, 10.9), (0.8, 1.4, 0.38)), ((0.5, 14.0), (0.7, 1.2, 0.32)), ((-0.4, 18.5), (0.5, 1.0, 0.25)),
    ((0.6, -9.6), (0.7, 1.0, 0.3)), ((-0.6, -11.4), (0.6, 0.9, 0.28)),
]


def build_ice(F):
    pairs = []
    cands = [n for n in A.REST if n.startswith(('Neck', 'Tail', 'Spine', 'Hips', 'Chest'))]
    groups = {}
    for k, ((x, y), size) in enumerate(ICE_CRUST):
        top = drop(F, x, y, inset=0.12)
        if top is None:
            continue
        groups.setdefault(A.nearest_bone(top, cands), []).append((k, top, size))
    for bone, items in groups.items():
        p = K.Part('Ice_' + bone, 'ice', bone=bone, smooth=False)
        for k, top, size in items:
            for j in range(3):
                off = RNG.normal(size=3) * np.array((size[0] * 0.4, size[1] * 0.4, 0.05))
                crystal(p, top + off, (size[0] * (0.7 - 0.15 * j), size[1] * (0.7 - 0.15 * j), size[2]),
                        (RNG.normal() * 0.3, RNG.normal() * 0.3, 1.0), n_pts=12, seed=k * 10 + j, elong=1.3)
        pairs.append(pair(p.to_object()))
    # icicles: under the jaw, the chest and the belly, the tail
    spots = [('Jaw', H(_m((0.6, -19.6, 14.4), 1)), 0.9), ('Jaw', H(_m((-0.55, -20.4, 14.42), 1)), 0.7),
             ('Jaw', H(_m((0.15, -21.2, 14.45), 1)), 0.5)]
    for y in np.linspace(-6.5, 3.5, 9):
        spots.append(('Chest' if y < -3.4 else 'Spine2', None, 0.6 + 0.5 * RNG.random(), y))
    p_by = {}
    for item in spots:
        if item[1] is None:
            bone, _, ln, y = item
            x = RNG.uniform(-1.4, 1.4)
            base = A._project(F, np.array((x * 0.2, y, 9.0)), np.array((x, y, 0.0)), inset=-0.05)
        else:
            bone, base, ln = item
        p_by.setdefault(bone, []).append((base, ln))
    for bone, items in p_by.items():
        p = K.Part('Icicles_' + bone, 'ice', bone=bone, smooth=True)
        for base, ln in items:
            for j in range(2):
                b2 = np.asarray(base) + np.array((RNG.uniform(-0.2, 0.2), RNG.uniform(-0.2, 0.2), 0.05))
                spike(p, b2, (RNG.uniform(-0.08, 0.08), RNG.uniform(-0.08, 0.08), -1.0), ln * (1 - 0.35 * j),
                      0.13 * (1 - 0.3 * j), sides=6, n=5)
        pairs.append(pair(p.to_object()))
    return pairs


def build_shed_ice(F):
    """The great slabs that only exist in the Frozen pose and burst off in BreakFree."""
    pairs = []
    for k, (bone, parent, head, tail) in enumerate(A.ICE_SHED):
        p = K.Part('Shed_' + bone, 'ice', bone=bone, smooth=False)
        h = np.array(head, float)
        up = np.array(tail, float) - h
        up /= np.linalg.norm(up)
        for j in range(4):
            off = RNG.normal(size=3) * np.array((0.8, 1.1, 0.25))
            size = (1.4 - 0.2 * j, 1.9 - 0.25 * j, 0.6 - 0.08 * j)
            crystal(p, h + off + up * (0.2 + 0.25 * j), size, up + RNG.normal(size=3) * 0.25, n_pts=16,
                    seed=300 + k * 10 + j, elong=1.2)
        pairs.append(pair(p.to_object(), group='shed'))
    return pairs


# ------------------------------------------------------------------ the shard
def build_shard():
    p = K.Part('HeartShard', 'shard', bone='Shard', smooth=False)
    c = A.SHARD_C + np.array((0, 0.55, 0.2))         # the root, inside the sternum
    dirs = [(0.0, -1.0, -0.15), (0.35, -0.9, 0.1), (-0.3, -0.92, 0.22), (0.15, -0.85, -0.5), (-0.4, -0.8, -0.35),
            (0.55, -0.75, -0.2), (-0.1, -0.95, 0.45)]
    lens = (2.9, 2.1, 2.3, 1.8, 1.6, 1.3, 1.5)
    rads = (0.58, 0.4, 0.42, 0.36, 0.32, 0.26, 0.3)
    for k, (d, ln, r) in enumerate(zip(dirs, lens, rads)):
        prism(p, c, d, ln, r, sides=6, tip_len=0.35, seed=k)
    return [pair(p.to_object())]


# ------------------------------------------------------------------ wings
def proximity_weights(P, bones, power=3.0, keep=3):
    segs = [(b, A.REST[b][0], A.REST[b][1]) for b in bones]
    W = np.zeros((len(P), len(bones)))
    for j, (b, h, t) in enumerate(segs):
        ab = t - h
        u = np.clip(((P - h) @ ab) / max(1e-9, ab @ ab), 0, 1)
        d = np.linalg.norm(P - (h + ab[None, :] * u[:, None]), axis=1)
        W[:, j] = 1.0 / (d + 0.25) ** power
    if W.shape[1] > keep:
        idx = np.argsort(-W, axis=1)[:, keep:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W /= W.sum(axis=1, keepdims=True)
    W[W < 0.02] = 0
    W /= W.sum(axis=1, keepdims=True)
    return W


def write_weights(obj, bones, W):
    obj.vertex_groups.clear()
    gs = {b: obj.vertex_groups.new(name=b) for b in bones}
    for j, b in enumerate(bones):
        for i in np.nonzero(W[:, j] > 0)[0]:
            gs[b].add([int(i)], float(W[i, j]), 'REPLACE')


def mesh_points(obj):
    P = np.zeros(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', P)
    return P.reshape(-1, 3)


def wing_bones(s):
    names = ['Humerus', 'WForearm', 'WHand', 'F1a', 'F1b', 'F2a', 'F2b', 'F3a', 'F3b', 'F4a', 'F4b']
    return [side_name(n, s) for n in names]


def build_fingers():
    pairs = []
    for s in (1, -1):
        for f, pts in A.FINGERS.items():
            p = K.Part(side_name(f + 'Finger', s), 'skin', binding='preset', smooth=True)
            pp = [A._m(q, s) for q in pts]
            path = [pp[0], pp[0] + (pp[1] - pp[0]) * 0.5, pp[1], pp[1] + (pp[2] - pp[1]) * 0.5, pp[2]]
            radii = [0.36, 0.28, 0.24, 0.17, 0.05]
            p.tube(path, radii, sides=9)
            o = p.to_object()
            bones = [side_name(f + 'a', s), side_name(f + 'b', s), side_name('WHand', s)]
            W = proximity_weights(mesh_points(o), bones, power=4.0, keep=2)
            write_weights(o, bones, W)
            pairs.append(pair(o, subsurf=0))
        # the knuckle spike and the thumb claw
        q = K.Part(side_name('WingClaw', s), 'claw', bone=side_name('Thumb', s), smooth=True)
        th = A._m(A.W_THUMB, s)
        spike(q, th - _m((0.15, -0.3, 0), s), _m((0.15, -1.0, -0.3), s), 1.3, 0.24, curl_axis=(1, 0, 0), curl=50,
              sides=9, n=8)
        pairs.append(pair(q.to_object(), subsurf=1))
        k = K.Part(side_name('KnuckleSpike', s), 'horn', bone=side_name('WHand', s), smooth=True)
        spike(k, A._m(A.W_KNUCKLE, s) + np.array((0, 0, 0.3)), _m((0.4, 0.2, 1.0), s), 1.4, 0.24, curl_axis=(0, 1, 0),
              curl=-25 * s, sides=8, n=7)
        spike(k, A._m(A.W_ELBOW, s) + np.array((0, 0.3, 0.5)), _m((0.0, 0.6, 1.0), s), 1.1, 0.22, sides=8, n=6)
        k.bone = side_name('WHand', s)
        o = k.to_object()
        # the elbow spike rides the forearm: split by proximity
        W = proximity_weights(mesh_points(o), [side_name('WHand', s), side_name('Humerus', s)], power=6.0, keep=1)
        write_weights(o, [side_name('WHand', s), side_name('Humerus', s)], W)
        o['binding'] = 'preset'
        pairs.append(pair(o, subsurf=0))
    return pairs


def _poly_at(pts, t):
    pts = [np.asarray(p, float) for p in pts]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + np.linalg.norm(b - a))
    d = np.clip(t, 0, 1) * lens[-1]
    for i in range(len(pts) - 1):
        if d <= lens[i + 1] or i == len(pts) - 2:
            k = (d - lens[i]) / max(1e-9, lens[i + 1] - lens[i])
            return pts[i] + (pts[i + 1] - pts[i]) * np.clip(k, 0, 1)
    return pts[-1]


def membrane(bm, col, spar_a, spar_b, rows, cols, scallop=0.2, tear=0.4, sag=0.0, holes=0.0, seed=0, color=(1, 1, 1)):
    """A skin panel between two point spars (root to tip): the far edge (u=1) is
    scalloped and torn, the inside can be holed."""
    rng = np.random.default_rng(seed)
    rag = []
    for c in range(cols + 1):
        k = rng.random()
        depth = 0.2 + 0.4 * rng.random() if k > 0.8 else 0.03 + 0.12 * rng.random()
        rag.append(1.0 - tear * depth * (0.4 + 0.6 * math.sin(math.pi * c / cols)))
    rag[0] = rag[-1] = 1.0
    grid = []
    for r in range(rows + 1):
        u = r / rows
        row = []
        for c in range(cols + 1):
            v = c / cols
            s = (1.0 - scallop * math.sin(math.pi * v)) * rag[c]
            pa = _poly_at(spar_a, u * s if c == 0 else u * s)
            pb = _poly_at(spar_b, u * s)
            co = pa + (pb - pa) * v
            co = co + np.array((0, 0, -sag * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.2))))
            row.append(bm.verts.new(V(co)))
        grid.append(row)
    lin = (*K.srgb_to_linear(color), 1.0)
    for r in range(rows):
        for c in range(cols):
            if holes and 1 <= r < rows - 1 and 1 <= c < cols - 1:
                n = math.sin(r * 1.7 + seed) * math.cos(c * 2.3 + seed * 0.7) + rng.normal() * 0.35
                if n > 1.0 - holes:
                    continue
            f = bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
            f.smooth = True
            for lp in f.loops:
                lp[col] = lin
    return grid


def build_membranes():
    pairs = []
    for s in (1, -1):
        bm = bmesh.new()
        col = bm.loops.layers.float_color.new('Col')
        f = {k: [A._m(q, s) for q in v] for k, v in A.FINGERS.items()}
        sh, el, wr, kn = (A._m(q, s) for q in (A.W_SHOULDER, A.W_ELBOW, A.W_WRIST, A.W_KNUCKLE))
        seed = 5 if s > 0 else 9
        membrane(bm, col, f['F1'], f['F2'], 22, 9, scallop=0.16, tear=0.1, holes=0.0, seed=seed)
        membrane(bm, col, f['F2'], f['F3'], 22, 9, scallop=0.2, tear=0.1, holes=0.0, seed=seed + 1)
        membrane(bm, col, f['F3'], f['F4'], 20, 9, scallop=0.2, tear=0.1, holes=0.0, seed=seed + 2)
        arm = [sh + _m((0.2, 0.3, -0.25), s), el + np.array((0, 0.35, -0.1)), wr + np.array((0, 0.3, -0.05)), kn,
               f['F4'][1], f['F4'][2]]
        body = [A._m((2.0, -2.6, 11.7), s), A._m((2.45, 0.9, 11.3), s), A._m((2.65, 4.4, 10.9), s),
                A._m((2.95, 7.2, 10.2), s), A._m((3.4, 8.4, 8.9), s)]
        membrane(bm, col, arm, body, 26, 12, scallop=0.12, tear=0.1, sag=0.35, holes=0.0, seed=seed + 3)
        lead_a = [A._m((1.6, -5.4, 12.1), s), el + np.array((0, -1.35, 0.1)), wr + np.array((0, -0.75, 0.05))]
        lead_b = [sh + np.array((0, -0.3, 0.1)), el + np.array((0, -0.4, 0.1)), wr + np.array((0, -0.3, 0.05))]
        membrane(bm, col, lead_b, lead_a, 14, 3, scallop=0.0, tear=0.0, seed=seed + 4)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.02)
        me = bpy.data.meshes.new(side_name('Membrane', s))
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(side_name('Membrane', s), me)
        bpy.context.scene.collection.objects.link(o)
        o['mat'] = 'membrane'
        o['bone'] = ''
        o['binding'] = 'preset'
        bones = wing_bones(s) + ['Chest', 'Spine2', 'Spine1', 'Hips', side_name('Thigh', s)]
        W = proximity_weights(mesh_points(o), bones, power=3.0, keep=3)
        write_weights(o, bones, W)
        pairs.append(pair(o))
    return pairs


def build_all(F, workdir=None, fast=False):
    pairs = []
    pairs += build_horns(F)
    pairs += build_teeth(F)
    pairs += build_eyes()
    pairs += build_spines(F)
    pairs += build_claws()
    pairs += build_ice(F)
    pairs += build_fingers()
    pairs += build_membranes()
    return pairs
