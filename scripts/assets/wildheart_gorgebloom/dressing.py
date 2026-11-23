"""Everything the Gorgebloom grew, and what is left of its meals.

Grown: four rows of hooked thorn-teeth round the maw and down the gullet (the
upper ones ride the Head, the lower ones the Jaw), thorns spiralling down every
vine with a club of great barbs at each tip, and a crown of thorns on the bulb's
shoulders.
Left over (the trolls feed it prisoners): skulls (troll ones with tusks, smaller
human ones), a rib cage arching out of the roots, long bones jammed among them,
torn rags draped over the roots and trailing in the water, and a rusted shackle
with its chain.

Each item returns (high, low) objects. Thorns copy their weights from the skin
they grow on (`transfer`, with the skin's key in `skin`); teeth and the dead
ride one bone.
"""
import math

import bpy
import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, decimate, duplicate

RNG = np.random.default_rng(41)


def pair(part_obj, group='body'):
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


def horn(part, base, ctrl, tip, r0, n=6, sides=6, r_tip=0.006):
    """A curved tapering spike along a quadratic Bezier, painted root (R=0) to tip (R=1)."""
    pts, rr = [], []
    base, ctrl, tip = (np.asarray(x, float) for x in (base, ctrl, tip))
    for i in range(n):
        t = i / (n - 1)
        pts.append((1 - t) ** 2 * base + 2 * (1 - t) * t * ctrl + t * t * tip)
        rr.append(r0 * (1 - t) ** 0.8 + r_tip)
    faces = part.tube(pts, rr, sides=sides)
    ax = tip - base
    l2 = float(ax @ ax)
    for f in faces:
        for lp in f.loops:
            co = np.array(lp.vert.co[:])
            u = float(np.clip((co - base) @ ax / l2, 0, 1))
            lp[part.col] = (u, u, u, 1.0)
    return faces


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


# ------------------------------------------------------------------ the maw
def build_teeth():
    """Four rows of hooked thorn-teeth: the lip row, then three rows down the
    gullet wall, each hooked inward and back toward the throat."""
    up = Part('MawTeethUpper', 'tooth', bone='Head')
    low = Part('MawTeethLower', 'tooth', bone='Jaw')
    X, U, F = A.X, A.UP_H, A.FACE
    cav_c = A.HC + F * 0.55
    rows = [  # (depth s along F from the cavity centre, ellipse (a, b), count, length, r0)
        (0.5, (1.12, 0.78), 22, 0.62, 0.11),
        (0.12, (1.2, 0.85), 20, 0.52, 0.095),
        (-0.32, (1.15, 0.81), 18, 0.44, 0.085),
        (-0.72, (0.98, 0.69), 14, 0.36, 0.075),
    ]
    for ri, (s, (a, b), n, ln, r0) in enumerate(rows):
        c = cav_c + F * s
        for k in range(n):
            ang = math.tau * (k + 0.5 * (ri % 2)) / n
            jit = RNG.uniform(0.85, 1.15)
            radial = X * math.cos(ang) * a + U * math.sin(ang) * b
            base = c + radial * 1.02
            inward = -radial / np.linalg.norm(radial)
            tip = base + inward * ln * jit * 0.85 - F * ln * 0.45 * jit
            ctrl = base + inward * ln * 0.55 + F * ln * 0.12
            part = up if math.sin(ang) > -0.05 else low
            horn(part, base - inward * 0.06, ctrl, tip, r0 * jit, n=5, sides=5, r_tip=0.005)
    return [pair(up.to_object()), pair(low.to_object())]


# ------------------------------------------------------------------ thorns
def build_vine_thorns():
    out = []
    for name, bones in A.VINES.items():
        kind = 'BackVine' if 'Back' in name else 'Vine'
        rad = A.VINE_RAD[kind]
        pts = [A.REST[b][0] for b in bones] + [A.REST[bones[-1]][1]]
        p = Part(name + 'Thorns', 'tooth', binding='transfer')
        ph = RNG.uniform(0, math.tau)
        for i in range(len(bones)):
            a, b = pts[i], pts[i + 1]
            d = (b - a) / np.linalg.norm(b - a)
            e1 = np.cross(d, (0, 0, 1.0))
            e1 /= np.linalg.norm(e1)
            e2 = np.cross(d, e1)
            steps = max(2, int(np.linalg.norm(b - a) / 0.42))
            for j in range(steps):
                t = (j + 0.5) / steps
                r = rad[i] + (rad[i + 1] - rad[i]) * t
                ph += 2.2
                if math.sin(ph) < -0.55:      # the underside on the water stays smooth
                    continue
                o = e1 * math.cos(ph) + e2 * math.sin(ph)
                base = a + (b - a) * t + o * r * 0.85
                ln = 0.18 + 0.42 * r
                tip = base + o * ln + d * ln * 0.55
                horn(p, base, base + o * ln * 0.6, tip, 0.05 + 0.08 * r, n=4, sides=5, r_tip=0.004)
        # the club of great barbs at the tip
        tip, pre = pts[-1], pts[-2]
        d = (tip - pre) / np.linalg.norm(tip - pre)
        e1 = np.cross(d, (0, 0, 1.0))
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(d, e1)
        for k in range(7):
            ang = math.tau * k / 7 + 0.3
            o = e1 * math.cos(ang) + e2 * math.sin(ang)
            c = pre + (tip - pre) * (0.55 + 0.12 * (k % 2))
            base = c + o * rad[-2] * 1.1
            ln = 0.55 if kind == 'Vine' else 0.38
            horn(p, base, base + o * ln * 0.7, base + o * ln * 0.75 - d * ln * 0.5, 0.1 if kind == 'Vine' else 0.07,
                 n=5, sides=6, r_tip=0.005)
        horn(p, tip - d * 0.15, tip + d * 0.3, tip + d * 0.62 + (0, 0, 0.08), 0.12 if kind == 'Vine' else 0.08,
             n=5, sides=6, r_tip=0.005)
        o = p.to_object()
        o['skin'] = name
        hi, lo = pair(o)
        hi['skin'] = name
        out.append((hi, lo))
    return out


def build_bulb_thorns(F):
    """A crown of thorns on the bulb's shoulders and down its back."""
    p = Part('BulbThorns', 'tooth', binding='transfer')
    n = 0
    for k in range(60):
        az = RNG.uniform(-180, 180)
        z = RNG.uniform(3.6, 5.8)
        if any(abs(((az - s + 180) % 360) - 180) < 26 for s in A.SAC_AZ.values()) and z < 5.4:
            continue
        if abs(az) < 30 and z < 5.4:          # the front stays clear for the neck and petals
            continue
        c = np.array((0.0, -0.1, z))
        try:
            q = surface_along(F, c, A.azv(az) + (0, 0, 0.25 if z > 5 else 0.0), max_dist=4.5)
        except RuntimeError:
            continue
        nn = normal_at(F, q)
        ln = RNG.uniform(0.45, 0.85)
        up = np.array((0, 0, 1.0))
        tip = q + nn * ln + up * ln * 0.35
        horn(p, q - nn * 0.05, q + nn * ln * 0.6, tip, RNG.uniform(0.09, 0.14), n=5, sides=6, r_tip=0.005)
        n += 1
        if n >= 26:
            break
    o = p.to_object()
    o['skin'] = 'body'
    hi, lo = pair(o)
    hi['skin'] = 'body'
    return [(hi, lo)]


# ------------------------------------------------------------------ the dead
def _skull_field(troll, voxel=0.012):
    s = 1.35 if troll else 1.0
    G = sdf.Field((-0.42 * s, -0.55 * s, -0.42 * s), (0.42 * s, 0.42 * s, 0.45 * s), voxel)
    E, Sp = sdf.Ellipsoid, sdf.Sphere
    G.add(E((0, 0.05 * s, 0.12 * s), (0.28 * s, 0.34 * s, 0.27 * s)), 0.05)           # cranium
    G.add(E((0, -0.2 * s, -0.04 * s), (0.2 * s, 0.17 * s, 0.17 * s)), 0.06)           # face
    for x in (1, -1):
        G.add(E((0.17 * x * s, -0.2 * s, -0.04 * s), (0.08 * s, 0.1 * s, 0.06 * s)), 0.03)   # cheekbone
        G.sub(Sp((0.1 * x * s, -0.31 * s, 0.03 * s), 0.075 * s), 0.02)                    # eye socket
    G.sub(E((0, -0.36 * s, -0.08 * s), (0.04 * s, 0.05 * s, 0.06 * s)), 0.015)          # nose
    G.add(E((0, -0.22 * s, -0.25 * s), (0.17 * s, 0.15 * s, 0.06 * s)), 0.03)           # jaw
    if troll:
        G.add(E((0, -0.33 * s, -0.13 * s), (0.12 * s, 0.08 * s, 0.07 * s)), 0.04)      # the snout
    G.sub(E((0, -0.3 * s, -0.17 * s), (0.15 * s, 0.1 * s, 0.018 * s)), 0.01)          # the mouth line
    return G


def _place(obj, M, loc):
    me = obj.data
    import mathutils
    T = mathutils.Matrix.Translation(loc) @ mathutils.Matrix(np.asarray(M).tolist()).to_4x4()
    me.transform(T)
    me.update()


def build_dead(workdir=None):
    out = []
    protos = {}
    for troll in (True, False):
        G = _skull_field(troll)
        hi = sdf.to_mesh(G, 'SkullProto' + ('T' if troll else 'H') + '_hi', bpy, workdir=workdir)
        protos[troll] = hi
    spots = [  # (troll?, azimuth, radius, z, yaw, tilt)
        (True, -24, 4.3, 0.42, 30, -20), (False, 52, 4.0, 0.62, -60, 15), (True, 148, 4.6, 0.3, 160, 35),
        (False, -118, 3.9, 0.7, -100, -10), (False, 8, 5.1, 0.2, 10, 50),
    ]
    for i, (troll, az, r, z, yaw, tilt) in enumerate(spots):
        M = sdf.rot_matrix(rx=math.radians(tilt), rz=math.radians(az + yaw))
        loc = A.azv(az, r, z)
        hi = duplicate(protos[troll], f'Skull{i}_hi')
        _place(hi, M, loc)
        lo = duplicate(hi, f'Skull{i}')
        decimate(lo, target=520 if troll else 380)
        for o in (hi, lo):
            o['mat'], o['bone'], o['binding'], o['group'] = 'bone', 'Root', 'rigid', 'body'
            for p in o.data.polygons:
                p.use_smooth = True
        out.append((hi, lo))
        if troll:     # the tusks
            tp = Part(f'Tusks{i}', 'bone', bone='Root')
            s = 1.35
            for x in (1, -1):
                b = np.array((0.11 * x * s, -0.3 * s, -0.2 * s))
                horn(tp, M @ b + loc, M @ (b + np.array((0.03 * x, -0.06, 0.12))) + loc,
                     M @ (b + np.array((0.06 * x, -0.02, 0.3))) + loc, 0.045, n=6, sides=7, r_tip=0.006)
            out.append(pair(tp.to_object()))
    for pr in protos.values():
        bpy.data.objects.remove(pr, do_unlink=True)
    # a rib cage arching out of the roots (front right), a spine and the ribs
    rc = Part('RibCage', 'bone', bone='Root')
    base = A.azv(-48, 4.2, 0.15)
    ax = A.azv(-48 + 90)
    spine = [base + ax * (t - 0.5) * 1.6 + np.array((0, 0, 0.12 * math.sin(t * 3))) for t in np.linspace(0, 1, 9)]
    rc.tube(spine, 0.07, sides=7)
    out_d = A.azv(-48)
    for k in range(7):
        t = (k + 0.5) / 7
        p0 = base + ax * (t - 0.5) * 1.5
        for sg in (1, -1):
            arc = []
            for u in np.linspace(0, 1, 7):
                arc.append(p0 + out_d * sg * math.sin(u * math.pi * 0.9) * 0.6 * (1 - 0.25 * abs(t - 0.5))
                           + np.array((0, 0, 0.75 * math.sin(u * math.pi * 0.55) * (1.0 - 0.3 * abs(t - 0.5))))
                           + ax * u * 0.12)
            rc.tube(arc, [0.04, 0.045, 0.04, 0.035, 0.03, 0.025, 0.015], sides=5)
    out.append(pair(rc.to_object()))
    # long bones jammed among the roots
    lb = Part('LongBones', 'bone', bone='Root')
    for az, r, z, ln, yaw, pitch in ((30, 4.6, 0.3, 1.1, 70, 25), (-150, 4.2, 0.5, 0.95, -20, -30),
                                     (95, 4.8, 0.25, 1.2, 10, 15), (-80, 5.0, 0.2, 0.9, 120, 35)):
        c = A.azv(az, r, z)
        d = sdf.rot_matrix(rz=math.radians(az + yaw)) @ np.array((math.cos(math.radians(pitch)), 0,
                                                                   math.sin(math.radians(pitch))))
        a, b = c - d * ln / 2, c + d * ln / 2
        lb.tube([a, a + (b - a) * 0.15, a + (b - a) * 0.5, a + (b - a) * 0.85, b], [0.075, 0.05, 0.045, 0.05, 0.075],
                sides=8)
        for e in (a, b):
            lb.sphere(e, (0.1, 0.09, 0.09), seg=10, rings=6)
    out.append(pair(lb.to_object()))
    # torn rags draped over the roots, trailing into the water
    for i, (az, r, w, ln) in enumerate(((-30, 3.9, 1.2, 1.5), (70, 4.1, 1.0, 1.3), (175, 3.8, 1.3, 1.6),
                                        (-95, 4.4, 0.9, 1.2))):
        p = Part(f'Rag{i}', 'cloth', bone='Root')
        top = A.azv(az, r, 1.0)
        o = A.azv(az)
        t = np.cross(o, (0, 0, 1.0))
        cut = RNG.uniform(0.55, 1.0, size=9)

        def fn(u, v, top=top, o=o, t=t, cut=cut, w=w, ln=ln):
            j = min(8, int(v * 8.999))
            uu = u * cut[j]
            s = (uu - 0.35) * ln * 1.6
            z = 0.45 - 0.9 * max(0.0, abs(s) - 0.15) - 0.05 * math.sin(v * 9 + u * 4)
            return top + t * (v - 0.5) * w + o * s * 0.8 + np.array((0, 0, z - 0.45 + 0.02))
        p.grid(10, 8, fn)
        obj = p.to_object()
        sol = obj.modifiers.new('sol', 'SOLIDIFY')
        sol.thickness = 0.025
        from mesh_kit import apply_mods
        apply_mods(obj)
        out.append(pair(obj))
    # a rusted shackle and its chain
    sh = Part('Shackle', 'iron', bone='Root')
    c = A.azv(52, 4.5, 0.25)
    sh.torus(c, (0.3, 0.2, 1.0), 0.2, 0.04, seg=16, sides=6)
    prev = c + np.array((0.2, 0, 0))
    for k in range(5):
        q = prev + np.array((0.13, -0.08, -0.05 * k))
        sh.torus(q, (0, 1, 0) if k % 2 else (0, 0, 1), 0.08, 0.022, seg=10, sides=5, squash=(1.4, 1.0))
        prev = q
    out.append(pair(sh.to_object()))
    return out
