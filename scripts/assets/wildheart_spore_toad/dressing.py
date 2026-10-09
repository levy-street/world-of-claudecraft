"""Everything the Spore Toad grew, and everything the basin's spores grew on it.

Grown: the great bulging eyes, the mouth (the palate, the fat tongue, the gum
ridges and a row of small hooked teeth in the upper jaw), the claws on the
fingers. Grown ON it: three big spore puffballs on the back (each on its own
bone, so they pulse and burst), clusters of glowing fungal caps and shelf
fungi sprouting from the warts down the back and the haunches, and a crust of
small spore pods that glow from inside.

Each item returns (high, low) objects; the caps and the pods copy the nearest
skin weights, the puffballs ride their Sac bones, the eyes the Head.
"""
import math

import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, duplicate


def surface_along(F, origin, direction, max_dist=3.0):
    o = np.asarray(origin, float)
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    step = F.voxel * 0.6
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


def pair(part_obj, group='body'):
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


def horn(part, base, ctrl, tip, r0, n=8, sides=7, r_tip=0.006):
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


def build_eyes():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        p = Part(side + 'EyeBall', 'eye', bone='Head')
        R = sdf.frame_from(A._m(A.EYE_DIR, s))
        p.sphere(A._m(A.EYE, s), (A.EYE_R, A.EYE_R, A.EYE_R * 0.95), rot=R, seg=22, rings=14)
        out.append(pair(p.to_object()))
    return out


def build_mouth():
    out = []
    z = A.MOUTH['z']
    p = Part('Palate', 'mouth', bone='Head')
    p.sphere((0, -1.75, z + 0.05), (1.22, 0.8, 0.06), seg=18, rings=6)
    out.append(pair(p.to_object()))
    p = Part('TongueMesh', 'tongue', bone='Tongue')
    p.sphere((0, -1.6, z - 0.08), (0.62, 0.85, 0.15), seg=16, rings=8)
    p.sphere((0, -2.25, z - 0.06), (0.42, 0.34, 0.13), seg=12, rings=6)
    out.append(pair(p.to_object()))
    # the gullet: a deep red throat lining the open mouth looks into
    g = Part('Gullet', 'mouth', bone='Spine')
    g.sphere((0, -0.95, z - 0.15), (0.95, 0.45, 0.42), seg=16, rings=8)
    out.append(pair(g.to_object()))
    p = Part('LowerGum', 'mouth', bone='Jaw')
    p.sphere((0, -1.72, z - 0.1), (1.25, 0.82, 0.05), seg=18, rings=6)
    out.append(pair(p.to_object()))
    up = Part('TeethUpper', 'tooth', bone='Head')
    for i in range(15):
        a = math.radians(-70 + 140 * i / 14)
        x, y = 1.3 * math.sin(a), -1.88 - 0.78 * math.cos(a)
        b = np.array((x, y, z + 0.04))
        ln = 0.13 if abs(i - 7) > 2 else 0.17
        horn(up, b, b + np.array((0, -0.02, -ln * 0.6)), b + np.array((0, 0.03, -ln)), 0.04, n=5, sides=6,
             r_tip=0.003)
    out.append(pair(up.to_object()))
    return out


def build_claws():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        wr = A._m(A.WRIST, s)
        p = Part(f'{side}FingerClaws', 'claw', bone=side + 'Hand')
        for a in (-50, -18, 14, 44):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            p0 = wr + np.array((0, -0.1, -0.16))
            tip = p0 + d * 0.62 + np.array((0, 0, -0.04))
            horn(p, tip, tip + d * 0.1 + np.array((0, 0, 0.02)), tip + d * 0.16 + np.array((0, 0, -0.08)), 0.05,
                 n=5, sides=6, r_tip=0.004)
        out.append(pair(p.to_object()))
    return out


def build_puffballs():
    """The three big spore puffballs: a pale cap cracked open over a glowing core,
    a ring of torn skin round the base, studded with tiny spore warts."""
    out = []
    rng = np.random.default_rng(7)
    for k, (c, r) in enumerate(A.SACS):
        p = Part(f'Puffball{k + 1}', 'spore', bone=f'Sac{k + 1}')
        p.sphere(c, (r, r * 0.95, r * 0.86), seg=18, rings=12)
        # the split crown, glowing inside
        p.sphere(c + np.array((0, 0, r * 0.62)), (r * 0.42, r * 0.38, r * 0.3), seg=14, rings=8)
        for j in range(10):
            th = rng.uniform(0, math.tau)
            ph = rng.uniform(0.15, 1.2)
            d = np.array((math.cos(th) * math.cos(ph), math.sin(th) * math.cos(ph), math.sin(ph)))
            p.sphere(c + d * r * 0.95, (0.05, 0.05, 0.045), seg=6, rings=4)
        out.append(pair(p.to_object()))
        q = Part(f'SacCollar{k + 1}', 'fungus', bone=f'Sac{k + 1}')
        q.torus(c + np.array((0, 0, -r * 0.55)), (0, 0, 1), r * 0.92, r * 0.18, seg=18, sides=7)
        out.append(pair(q.to_object()))
    return out


def _cap(part, base, n, size, rng):
    """A mushroom: a stalk leaning out of the hide and a domed, flared cap."""
    n = n / np.linalg.norm(n)
    lean = n + rng.normal(size=3) * 0.25
    lean /= np.linalg.norm(lean)
    top = base + lean * size * 1.2
    part.tube([base - n * 0.05, base + lean * size * 0.6, top], [size * 0.22, size * 0.18, size * 0.16], sides=6)
    R = sdf.frame_from(lean)
    part.sphere(top + lean * size * 0.12, (size * 0.62, size * 0.62, size * 0.32), rot=R, seg=10, rings=6,
                cut=((0, 0, 1), -0.25))


def build_fungus(F):
    """Clusters of glowing mushrooms and shelf fungi on the back and the haunches."""
    rng = np.random.default_rng(11)
    caps = Part('SporeCaps', 'spore', binding='transfer')
    shelves = Part('ShelfFungi', 'fungus', binding='transfer')
    spots = [(0.95, -0.4, 2.9), (-0.9, -0.2, 2.85), (0.3, 0.5, 3.2), (-0.3, 0.9, 3.1), (1.35, 0.9, 2.4),
             (-1.35, 0.7, 2.4), (0.75, 1.35, 2.5), (-0.6, 1.5, 2.3), (0.0, -0.4, 3.2), (1.6, -0.2, 2.2)]
    for sp in spots:
        o = np.array((sp[0] * 0.6, sp[1], 1.3))      # inside the body, marching out
        try:
            q = surface_along(F, o, np.array(sp) - o + rng.normal(size=3) * 0.05)
        except RuntimeError:
            continue
        nrm = normal_at(F, q)
        for j in range(rng.integers(2, 4)):
            off = rng.normal(size=3) * 0.12
            off -= nrm * (off @ nrm)
            _cap(caps, q + off, nrm, rng.uniform(0.12, 0.26), rng)
    # shelf fungi: half-discs stacked on the flanks
    for sp in ((1.45, 0.1, 1.45), (-1.45, 0.3, 1.35), (1.3, 1.1, 1.25), (-1.25, 1.2, 1.25)):
        o = np.array(sp)
        d = np.array((np.sign(sp[0]), 0.0, 0.0))
        try:
            q = surface_along(F, o - d * 1.2, d)
        except RuntimeError:
            continue
        nrm = normal_at(F, q)
        for j in range(2):
            c = q + nrm * 0.1 + np.array((0, 0.16 * j, -0.2 * j))
            R = sdf.frame_from(np.array((0, 0, 1.0)), nrm)
            shelves.sphere(c, (0.3 - 0.06 * j, 0.32 - 0.06 * j, 0.07), rot=R, seg=12, rings=5, cut=((0, 0, 1), -0.2))
    return [pair(caps.to_object()), pair(shelves.to_object())]


def build_pods(F):
    """A crust of small glowing spore pods over the back."""
    rng = np.random.default_rng(13)
    p = Part('SporePods', 'spore', binding='transfer')
    for _ in range(30):
        u, v = rng.uniform(-1.1, 1.1), rng.uniform(-0.8, 1.4)
        o = np.array((u * 0.6, v, 1.3))
        try:
            q = surface_along(F, o, np.array((u, v * 0.3, 1.0)), max_dist=3.0)
        except RuntimeError:
            continue
        if q[2] < 1.35 or q[1] < -1.3:
            continue
        nrm = normal_at(F, q)
        r = rng.uniform(0.05, 0.1)
        p.sphere(q + nrm * r * 0.4, (r, r, r * 0.8), rot=sdf.frame_from(nrm), seg=7, rings=4)
    return [pair(p.to_object())]
