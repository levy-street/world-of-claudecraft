"""Everything the Basin Raptor grew or the Sunbone hunters put on it.

Grown: the eyes, the mouth (palate, tongue), the teeth (a saw of hooked fangs in
both jaws), the hooked claws on the hands and the toes, the great SICKLE claw on
each inner toe, the war crest (a fan of stiff quills behind the skull, red at
the tips), a ridge of keratin scutes down the back and the tail, the quill fans
on the forearms and the quill tuft at the tail tip.
Worn (the Sunbone hunters' mark of a pack beast): a leather collar studded with
carved bone plates, a fang charm hanging from it on a cord, and a bone ring
through the crest.

Each item returns (high, low) objects. Shells of the skin's own distance field
(the collar) take their weights from the skin; rigid parts ride one bone; the
scutes copy the nearest skin weights.
"""
import math

import bpy
import numpy as np

import anatomy as A
import sdf
from mesh_kit import Part, decimate, duplicate


# ------------------------------------------------------------------ surface queries
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


def shell(F, lo, hi, voxel, name, mat, region, thick=0.05, inset=0.03, target=800, workdir=None, bone='Neck1',
          binding='transfer'):
    """A layer over the skin: `region(X, Y, Z, db)` is negative where it covers."""
    G = sdf.Field(np.asarray(lo, float), np.asarray(hi, float), voxel)
    X, Y, Z = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    db = F.sample(P).reshape(X.shape)
    t = thick(X, Y, Z, db) if callable(thick) else thick
    d = np.maximum(db - t, -(db + inset))
    d = sdf.smax(d, region(X, Y, Z, db), 0.02)
    G.d = d.astype(np.float32)
    h = sdf.to_mesh(G, name + '_hi', bpy, workdir=workdir)
    low = duplicate(h, name)
    decimate(low, target=target)
    for o in (h, low):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = binding
        for p in o.data.polygons:
            p.use_smooth = True
    return h, low


def band(F, a, b, t, halfw, thick, name, mat, radius, voxel=0.02, workdir=None, target=700, ridge=0.0):
    """A band hugging the skin round the segment a -> b at fraction t (the collar):
    rounded in section, optionally ridged."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ax = (b - a) / np.linalg.norm(b - a)
    c = A._lerp(a, b, t)
    reach = radius + 0.35

    def rel(X, Y, Z):
        return (X - c[0]) * ax[0] + (Y - c[1]) * ax[1] + (Z - c[2]) * ax[2]

    def region(X, Y, Z, db):
        rn = rel(X, Y, Z)
        rx, ry, rz = X - c[0] - rn * ax[0], Y - c[1] - rn * ax[1], Z - c[2] - rn * ax[2]
        radial = np.sqrt(rx * rx + ry * ry + rz * rz) - (radius + 0.25)
        return np.maximum(np.abs(rn) - halfw, radial)

    def th(X, Y, Z, db):
        rn = rel(X, Y, Z) / halfw
        out = thick * (1.0 - 0.45 * rn ** 2)
        if ridge:
            out = out + ridge * np.exp(-(rn / 0.25) ** 2)
        return out
    return shell(F, c - reach, c + reach, voxel, name, mat, region, thick=th, inset=0.03, target=target,
                 workdir=workdir)


def horn(part, base, ctrl, tip, r0, n=8, sides=7, r_tip=0.006):
    """A curved tapering spike (a fang, a claw, a quill) along a quadratic Bezier."""
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


def quill(part, base, direction, length, width, bend=(0, 0, 0), sides=6, n=7, flat=0.45):
    """A stiff feather quill: a flattened blade swelling from its root then tapering
    to a point (wider than deep), bent along `bend`."""
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    b = np.asarray(base, float)
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        pts.append(b + d * length * t + np.asarray(bend) * length * t * t)
        rr.append(width * (0.55 + 1.4 * t) * (1 - t) ** 1.1 + 0.004)
    part.tube(pts, rr, sides=sides, squash=flat)


# ------------------------------------------------------------------ grown
def build_eyes():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        p = Part(side + 'EyeBall', 'eye', bone='Head')
        R = sdf.frame_from(A._m(A.EYE_DIR, s))
        p.sphere(A._m(A.EYE, s), (A.EYE_R, A.EYE_R * 0.85, A.EYE_R), rot=R, seg=18, rings=12)
        out.append(pair(p.to_object()))
    return out


def _lip_x(y):
    """The upper lip's half width (head space) along the snout."""
    t = np.clip((y - (-2.5)) / (-3.32 - (-2.5)), 0, 1)
    return 0.3 * (1 - t) + 0.16 * t


def build_mouth():
    H, k = A.H, A.HK
    out = []
    p = Part('Palate', 'mouth', bone='Head')
    p.sphere(H((0, -2.92, 3.86)), np.array((0.22, 0.46, 0.04)) * k, seg=14, rings=6)
    out.append(pair(p.to_object()))
    p = Part('Tongue', 'mouth', bone='Jaw')
    p.sphere(H((0, -2.85, 3.78)), np.array((0.15, 0.4, 0.035)) * k, seg=12, rings=6)
    p.sphere(H((0, -2.88, 3.765)), np.array((0.21, 0.44, 0.03)) * k, seg=12, rings=6)    # the lower gum bed
    out.append(pair(p.to_object()))
    up = Part('TeethUpper', 'tooth', bone='Head')
    low = Part('TeethLower', 'tooth', bone='Jaw')
    for s in (1, -1):
        # big hooked fangs set along the OUTER edge of the lip, curving back and
        # hanging over the lower jaw like a crocodile's, longest mid-snout; the
        # lower row rises outside the upper lip between them
        n = 6
        for i in range(n):
            y = -2.58 - (3.28 - 2.58) * i / (n - 1)
            x = _lip_x(y) * 1.0
            ln = 0.16 + 0.08 * math.sin(math.pi * (0.2 + 0.7 * i / (n - 1)))
            b = H((x * s, y, 3.87))
            out_d = np.array((0.25 * s, 0.0, 0.0))
            horn(up, b, b + (np.array((0.0, -0.03, -ln * 0.6)) + out_d * ln) * k,
                 b + (np.array((0.0, 0.03, -ln)) + out_d * ln * 0.6) * k, 0.038 * k, n=6, sides=6, r_tip=0.002)
            if i in (1, 3, 5):
                yl = y + 0.06
                bl = H((_lip_x(yl) * 0.96 * s, yl, 3.78))
                lnl = ln * 0.75
                horn(low, bl, bl + (np.array((0.0, -0.02, lnl * 0.6)) + out_d * lnl) * k,
                     bl + (np.array((0.0, 0.02, lnl)) + out_d * lnl * 0.5) * k, 0.032 * k, n=6, sides=6, r_tip=0.002)
    # the front fangs
    for x in (-0.07, 0.07):
        b = H((x, -3.38, 3.87))
        horn(up, b, b + np.array((0, -0.03, -0.1)) * k, b + np.array((0, 0.02, -0.2)) * k, 0.036 * k, n=6, sides=6,
             r_tip=0.002)
    out.append(pair(up.to_object()))
    out.append(pair(low.to_object()))
    return out


def build_claws():
    """Hooked claws on the hands and the toes, the great sickle on the inner toe and
    the dewclaw behind."""
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        wr, ht = A._m(A.WRIST, s), A._m(A.HAND_T, s)
        d = (ht - wr) / np.linalg.norm(ht - wr)
        p = Part(f'{side}HandClaws', 'claw', bone=side + 'Hand')
        for dx, dz, ln in ((0.07, 0.03, 0.32), (0.0, -0.02, 0.36), (-0.07, -0.04, 0.26)):
            a = A._lerp(wr, ht, 0.4) + np.array((dx * s, 0.0, dz))
            base = a + d * ln * 0.92 + np.array((0, 0, -0.07))
            horn(p, base, base + d * 0.12 + np.array((0, 0, -0.02)), base + d * 0.13 + np.array((0, 0, -0.17)), 0.045,
                 n=7, sides=6, r_tip=0.004)
        out.append(pair(p.to_object()))
        ft = A._m(A.FOOT_T, s)
        p = Part(f'{side}ToeClaws', 'claw', bone=side + 'Toes')
        for a in (-12, 12):
            th = math.radians(a)
            dd = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            base = ft + dd * 0.6 + np.array((0, 0, -0.01))
            horn(p, base, base + dd * 0.16 + np.array((0, 0, 0.02)), base + dd * 0.2 + np.array((0, 0, -0.11)), 0.06,
                 n=7, sides=7, r_tip=0.004)
        out.append(pair(p.to_object()))
        # the sickle: a great hooked blade held up off the ground
        sb, st_ = A._m(A.SICKLE_B, s), A._m(A.SICKLE_T, s)
        dd = (st_ - sb) / np.linalg.norm(st_ - sb)
        p = Part(f'{side}SickleClaw', 'claw', bone=side + 'Sickle')
        base = st_ - dd * 0.04
        horn(p, base, base + dd * 0.24 + np.array((0, -0.06, 0.02)), base + np.array((0, -0.36, -0.12)), 0.085,
             n=9, sides=8, r_tip=0.004)
        out.append(pair(p.to_object()))
        p = Part(f'{side}DewClaw', 'claw', bone=side + 'Foot')
        base = ft + np.array((0.06 * s, 0.31, 0.03))
        horn(p, base, base + np.array((0, 0.06, -0.01)), base + np.array((0, 0.1, -0.08)), 0.03, n=5, sides=5)
        out.append(pair(p.to_object()))
    return out


def build_crest():
    """The war crest: a fan of stiff quills from the back of the skull, the longest
    in the middle, swept back and up; red at the tips. It rides the Crest bone."""
    H = A.H
    p = Part('CrestQuills', 'quill', bone='Crest')
    rng = np.random.default_rng(5)
    for i in range(11):
        u = i / 10.0 - 0.5                     # -0.5 .. 0.5 across the fan
        base = H((u * 0.42, -2.36 + abs(u) * 0.18, 4.3 - abs(u) * 0.12))
        ang = math.radians(28 + 18 * (1 - abs(u) * 2))
        d = np.array((u * 0.9, math.cos(ang), math.sin(ang)))
        ln = (1.55 - 1.0 * abs(u)) * (1 + rng.uniform(-0.06, 0.06))
        quill(p, base, d, ln, 0.085, bend=(0, 0.05, -0.2), sides=6)
    # the bone ring through the crest's root (a Sunbone mark)
    ring = Part('CrestRing', 'bone', bone='Crest')
    c = H((0.0, -2.2, 4.42))
    ring.torus(c, (1, 0, 0), 0.09, 0.022, seg=14, sides=6)
    ring.sphere(c + np.array((0, 0.0, -0.11)), (0.035, 0.035, 0.035), seg=8, rings=5)
    return [pair(p.to_object()), pair(ring.to_object())]


def build_nape_quills(F):
    """Shorter quills down the nape behind the crest (they follow the neck)."""
    p = Part('NapeQuills', 'quill', binding='transfer')
    for i in range(6):
        t = i / 5.0
        top = A._lerp((0, -2.02, 4.2), (0, -1.45, 3.3), t)
        try:
            q = surface_along(F, top + np.array((0, 0.0, -0.5)), (0, 0.2, 1.0))
        except RuntimeError:
            continue
        for s in (1, -1):
            base = q + np.array((0.05 * s, 0.0, -0.02))
            d = np.array((0.35 * s, 0.75, 0.6))
            quill(p, base, d, 0.7 - 0.07 * i, 0.06, bend=(0, 0.1, -0.15), sides=5)
    return [pair(p.to_object())]


def build_scutes(F):
    """A ridge of keratin scutes down the back and the tail, biggest over the hips."""
    p = Part('BackScutes', 'claw', binding='transfer')
    pts = [(0, -1.25, 3.4), (0, -0.6, 3.38), (0, 0.0, 3.36), (0, 0.6, 3.36), (0, 1.2, 3.3), (0, 1.8, 3.25),
           (0, 2.4, 3.2), (0, 3.0, 3.12), (0, 3.55, 3.04), (0, 4.05, 2.95), (0, 4.5, 2.86)]
    for i, top in enumerate(pts):
        try:
            q = surface_along(F, np.array(top) + np.array((0, 0, -0.9)), (0, 0, 1.0))
        except RuntimeError:
            continue
        h = 0.2 * math.sin(math.pi * (0.2 + 0.8 * min(1.0, i / 4.0))) if i < 5 else 0.2 * (1 - (i - 4) / 8.0)
        h = max(0.06, h)
        p.tube([q + np.array((0, 0.06, -0.02)), q + np.array((0, 0.1, h * 0.6)), q + np.array((0, 0.2, h))],
               [0.07, 0.045, 0.006], sides=6, squash=0.45)
    return [pair(p.to_object())]


def build_arm_fans():
    """Stiff quill fans along the back edge of each forearm and hand."""
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        el, wr = A._m(A.ELBOW, s), A._m(A.WRIST, s)
        p = Part(f'{side}ArmFan', 'quill', bone=side + 'Forearm')
        for i in range(5):
            t = 0.1 + 0.2 * i
            base = A._lerp(el, wr, t) + np.array((0.05 * s, 0.06, -0.06))
            d = np.array((0.3 * s, 0.75, -0.55))
            quill(p, base, d, 0.42 + 0.06 * i, 0.045, bend=(0, 0.15, 0.1), sides=5)
        out.append(pair(p.to_object()))
    return out


def build_tail_tuft():
    a, b = A.TAIL_PTS[7], A.TAIL_PTS[8]
    p = Part('TailTuft', 'quill', bone='Tail8')
    ax = (b - a) / np.linalg.norm(b - a)
    for k in range(9):
        th = math.tau * k / 9
        e = np.array((math.cos(th), 0.0, math.sin(th)))
        base = A._lerp(a, b, 0.55) + e * 0.05
        d = ax + e * 0.35
        quill(p, base, d, 0.55, 0.05, bend=tuple(e * 0.12 + np.array((0, 0, -0.1))), sides=5)
    return [pair(p.to_object())]


# ------------------------------------------------------------------ worn
COLLAR_T = 0.42


def collar_frame():
    a, b = A.NECK_PTS[0] + (0, 0, -0.08), A.NECK_PTS[1] + (0, 0, -0.08)
    ax = (b - a) / np.linalg.norm(b - a)
    return a, b, A._lerp(a, b, COLLAR_T), ax


def build_collar(F, voxel=0.018, workdir=None):
    a, b, c, ax = collar_frame()
    out = [band(F, a, b, COLLAR_T, 0.1, 0.05, 'Collar', 'leather', 0.55, voxel=voxel, workdir=workdir, target=900,
                ridge=0.018)]
    e1 = np.cross(ax, (1.0, 0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    plates = Part('CollarBones', 'bone', bone='Neck1')
    for k in range(10):
        th = math.tau * k / 10
        d = e1 * math.cos(th) + e2 * math.sin(th)
        try:
            q = surface_along(F, c + d * 0.05, d)
        except RuntimeError:
            continue
        n = normal_at(F, q)
        pc = q + n * 0.06
        R = sdf.frame_from(n, ax)
        plates.sphere(pc, (0.06, 0.085, 0.03), rot=R, seg=8, rings=5)
    out.append(pair(plates.to_object()))
    return out


def build_charm():
    """A fang and a little skull on a cord, hanging from the collar's throat."""
    top = A.REST['Charm1'][0]
    rope = Part('CharmCord', 'rope', bone='Charm1', binding='charm')
    bones_ = Part('CharmBones', 'bone', bone='Charm1', binding='charm')
    p0 = top + np.array((0, 0, 0.03))
    p1 = A.REST['Charm2'][1] + np.array((0, 0, 0.06))
    rope.tube([p0, A._lerp(p0, p1, 0.5) + np.array((0, -0.01, 0)), p1], 0.014, sides=5)
    sk = p1 + np.array((0, -0.01, -0.03))
    bones_.sphere(sk, (0.07, 0.075, 0.065), seg=12, rings=8)
    bones_.sphere(sk + np.array((0, -0.045, -0.04)), (0.05, 0.05, 0.035), seg=10, rings=6)
    for s in (1, -1):
        b = A._lerp(p0, p1, 0.55) + np.array((0.04 * s, 0, 0))
        horn(bones_, b, b + np.array((0.02 * s, -0.03, -0.06)), b + np.array((0.03 * s, -0.01, -0.15)), 0.025,
             n=6, sides=6)
    return [pair(rope.to_object()), pair(bones_.to_object())]
