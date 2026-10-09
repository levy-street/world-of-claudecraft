"""Everything the Great Jaguar grew or the Sunbone trolls put on it.

Grown: the eyes, the mouth (palate, tongue, gums), the teeth (four great fangs,
incisors, carnassials), the claws on every toe, the whiskers.
Worn (the Fanglord's work): a leather collar studded with carved bone plates and
a fringe of fangs, three charm cords under the throat (fangs and a small skull,
on a spring), the jade ring on the collar where the spirit cord binds it to its
master, bone bands round both forearms, bone rings through the ears with a fang
charm on the left one, and a leather wrap with bone beads round the tail.

Each item returns (high, low) objects. Shells of the skin's own distance field
(the collar, the bands, the wrap) take their weights from the skin; rigid parts
ride one bone.
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
    tag((h, low), mat, bone, binding)
    for o in (h, low):
        for p in o.data.polygons:
            p.use_smooth = True
    return h, low


def band(F, a, b, t, halfw, thick, name, mat, radius, voxel=0.02, workdir=None, target=700, ridge=0.0):
    """A band hugging the skin round the segment a -> b at fraction t (a collar, a
    bracer, a tail wrap): rounded in section, optionally ridged."""
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
    """A curved tapering spike (a fang, a claw, a charm tooth) along a quadratic Bezier."""
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


# ------------------------------------------------------------------ grown
def build_eyes():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        p = Part(side + 'EyeBall', 'eye', bone='Head')
        R = sdf.frame_from(A._m(A.EYE_DIR, s))
        p.sphere(A._m(A.EYE, s), (A.EYE_R, A.EYE_R * 0.8, A.EYE_R), rot=R, seg=20, rings=14)
        out.append(pair(p.to_object()))
    return out


def build_mouth():
    H, M = A.H, A.MOUTH
    out = []
    p = Part('Palate', 'mouth', bone='Head')
    p.sphere(H((0, -4.6, 3.6)), np.array((0.27, 0.36, 0.05)) * A.HK, seg=16, rings=6)
    out.append(pair(p.to_object()))
    p = Part('Tongue', 'mouth', bone='Jaw')
    p.sphere(H((0, -4.5, 3.53)), np.array((0.16, 0.3, 0.04)) * A.HK, seg=14, rings=6)
    p.sphere(H((0, -4.5, 3.51)), np.array((0.21, 0.32, 0.035)) * A.HK, seg=14, rings=6)    # the lower gum bed
    out.append(pair(p.to_object()))
    up = Part('TeethUpper', 'tooth', bone='Head')
    low = Part('TeethLower', 'tooth', bone='Jaw')
    z0 = M['z']
    for s in (1, -1):
        # the great fangs: upper ones long and curved back, lower ones in front of them
        b = H((0.165 * s, -4.82, 3.62))
        horn(up, b, b + np.array((0, -0.03, -0.14)), b + np.array((0.0, 0.02, -0.27)), 0.052, sides=8)
        b = H((0.13 * s, -4.86, 3.5))
        horn(low, b, b + np.array((0, -0.03, 0.08)), b + np.array((0.0, 0.0, 0.16)), 0.04, sides=8)
        # carnassials: a saw of blades behind the fangs
        for k, y in enumerate((-4.62, -4.48, -4.36)):
            w = 0.2 + 0.03 * k
            bb = H((w * s, y, 3.6))
            horn(up, bb, bb + np.array((0, 0.0, -0.05)), bb + np.array((0, 0.01, -0.09 + 0.01 * k)), 0.035, n=5, sides=6)
            bb = H((w * 0.92 * s, y + 0.03, 3.5))
            horn(low, bb, bb + np.array((0, 0, 0.04)), bb + np.array((0, 0.01, 0.075)), 0.03, n=5, sides=6)
    for x in (-0.09, -0.03, 0.03, 0.09):
        b = H((x, -4.9, 3.6))
        horn(up, b, b + np.array((0, 0, -0.03)), b + np.array((0, 0, -0.06)), 0.018, n=4, sides=5)
        b = H((x * 0.9, -4.9, 3.51))
        horn(low, b, b + np.array((0, 0, 0.025)), b + np.array((0, 0, 0.05)), 0.016, n=4, sides=5)
    del z0
    out.append(pair(up.to_object()))
    out.append(pair(low.to_object()))
    return out


def build_claws():
    """Heavy hooked claws on every toe, half drawn (a beast that never sheathes)."""
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        for paw, bone, spread, r0, ln in ((A.FPAW, 'FToes', 46, 0.05, 0.28), (A.HPAW, 'HToes', 42, 0.042, 0.22)):
            c = A._m(paw, s)
            p = Part(f'{side}{bone}Claws', 'claw', bone=side + bone)
            reach = 0.29 if bone == 'FToes' else 0.26
            for a in np.linspace(-spread, spread, 4):
                th = math.radians(a)
                d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
                base = c + d * (reach + 0.08) + np.array((0, 0, 0.07))
                tip = base + d * ln * 0.75 + np.array((0, 0, -0.13))
                ctrl = base + d * ln * 0.6 + np.array((0, 0, 0.04))
                horn(p, base, ctrl, tip, r0, n=7, sides=7, r_tip=0.004)
            out.append(pair(p.to_object()))
    return out


def build_whiskers():
    p = Part('Whiskers', 'whisker', bone='Head')
    rng = np.random.default_rng(3)
    for s in (1, -1):
        for k in range(5):
            b = A.H(A._m((0.2 + 0.015 * k, -4.8 + 0.03 * k, 3.72 - 0.035 * k), s))
            out_d = np.array((0.85 * s, 0.35 + 0.05 * k, -0.08 * k + 0.05))
            ln = 0.55 + rng.uniform(0, 0.15)
            pts = [b, b + out_d * ln * 0.5 + np.array((0, 0.05, 0.02)), b + out_d * ln + np.array((0, 0.18, -0.08))]
            p.tube(pts, [0.011, 0.007, 0.002], sides=4)
    return [pair(p.to_object())]


# ------------------------------------------------------------------ worn
COLLAR_T = 0.5


def collar_frame():
    a, b = A.NECK_PTS[0] + (0, 0, -0.1), A.NECK_PTS[1] + (0, 0, -0.1)
    ax = (b - a) / np.linalg.norm(b - a)
    return a, b, A._lerp(a, b, COLLAR_T), ax


def build_collar(F, voxel=0.018, workdir=None):
    a, b, c, ax = collar_frame()
    out = [band(F, a, b, COLLAR_T, 0.13, 0.055, 'Collar', 'leather', 0.75, voxel=voxel, workdir=workdir, target=1400,
                ridge=0.02)]
    # carved bone plates studded round the collar, and a fringe of fangs below
    e1 = np.cross(ax, (1.0, 0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    plates = Part('CollarBones', 'bone', bone='Neck1')
    fangs = Part('CollarFangs', 'tooth', bone='Neck1')
    for k in range(14):
        th = math.tau * k / 14
        d = e1 * math.cos(th) + e2 * math.sin(th)
        try:
            q = surface_along(F, c + d * 0.05, d)
        except RuntimeError:
            continue
        n = normal_at(F, q)
        if abs(math.sin(th)) < 0.2 and k > 7:
            continue
        pc = q + n * 0.075
        R = sdf.frame_from(n, ax)
        plates.sphere(pc, (0.075, 0.1, 0.035), rot=R @ np.diag((1, 1, 1)), seg=10, rings=6)
        down = -n[2] if n[2] < -0.2 else 0
        if n[2] < 0.35:
            tip = pc + n * 0.04 + np.array((0, 0, -0.22 - 0.05 * down))
            horn(fangs, pc + np.array((0, 0, -0.04)), pc + n * 0.06 + np.array((0, 0, -0.1)), tip, 0.03, n=6, sides=6)
    out.append(pair(plates.to_object()))
    out.append(pair(fangs.to_object()))
    # the jade ring on the collar's crest: the spirit cord binds here (BondAnchor)
    ring = Part('BondRing', 'jade', bone='BondAnchor')
    h = A.REST['BondAnchor'][0]
    ring.torus(h + (0, 0, 0.1), (0, 1, 0), 0.13, 0.035, seg=16, sides=7)
    ring.sphere(h + (0, 0, -0.02), (0.07, 0.07, 0.05), seg=10, rings=6)
    out.append(pair(ring.to_object()))
    return out


def build_charms():
    """Three charm cords under the throat: fangs, a claw, a small skull in the middle."""
    top = A.REST['Charm1'][0]
    rope = Part('CharmCords', 'rope', bone='Charm1', binding='charm')
    bones_ = Part('CharmBones', 'bone', bone='Charm1', binding='charm')
    for k, dx in enumerate((-0.2, 0.0, 0.2)):
        ln = (0.55, 0.72, 0.5)[k]
        p0 = top + np.array((dx * 0.7, 0.0, 0.04))
        p1 = p0 + np.array((dx * 0.25, -0.03, -ln))
        rope.tube([p0, (p0 + p1) / 2 + np.array((0, -0.01, 0)), p1], 0.016, sides=5)
        mid = p0 + (p1 - p0) * 0.45
        bones_.tube([mid + np.array((-0.11, 0, 0.01)), mid + np.array((0.11, 0, -0.01))], [0.025, 0.018, 0.025], sides=6)
        horn(bones_, p1 + np.array((0, 0, 0.02)), p1 + np.array((0.0, -0.04, -0.08)), p1 + np.array((0.02, -0.02, -0.17)),
             0.035, n=6, sides=6)
        if k == 1:
            sk = p1 + np.array((0, 0, -0.04))
            bones_.sphere(sk, (0.085, 0.09, 0.08), seg=12, rings=8)
            bones_.sphere(sk + np.array((0, -0.05, -0.05)), (0.06, 0.06, 0.045), seg=10, rings=6)
    return [pair(rope.to_object()), pair(bones_.to_object())]


def build_bracers(F, voxel=0.018, workdir=None):
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        el, wr = A._m(A.ELBOW, s), A._m(A.WRIST, s)
        for k, (t, hw) in enumerate(((0.64, 0.065), (0.81, 0.055))):
            out.append(band(F, el, wr, t, hw, 0.06, f'{side}Bracer{k}', 'bone', 0.36, voxel=voxel, workdir=workdir,
                            target=500, ridge=0.012))
    return out


def build_ear_rings():
    out = []
    for s, side, ks in ((1, 'L_', (0, 1)), (-1, 'R_', (0,))):
        p = Part(f'{side}EarRings', 'bone', bone=side + 'Ear')
        h, t = A.REST[side + 'Ear']
        d = (t - h) / np.linalg.norm(t - h)
        for k in ks:
            c = h + d * (0.07 + 0.08 * k) + np.array((0.075 * s, 0, 0))
            p.torus(c, (0, 1, 0.2), 0.042, 0.012, seg=14, sides=6)
        out.append(pair(p.to_object()))
    p = Part('EarCharm', 'bone', bone='EarCharmL')
    h, t = A.REST['EarCharmL']
    p.tube([h, A._lerp(h, t, 0.5)], 0.012, sides=5)
    horn(p, A._lerp(h, t, 0.45), A._lerp(h, t, 0.75) + np.array((0, -0.02, 0)), t + np.array((0, 0, -0.05)), 0.03, n=6,
         sides=6)
    p.sphere(A._lerp(h, t, 0.42), (0.03, 0.03, 0.03), seg=8, rings=5)
    out.append(pair(p.to_object()))
    return out


def build_tail_wrap(F, voxel=0.018, workdir=None):
    a, b = A.TAIL_PTS[2], A.TAIL_PTS[3]
    out = [band(F, a, b, 0.45, 0.1, 0.04, 'TailWrap', 'leather', A.TAIL_R[2], voxel=voxel, workdir=workdir, target=500)]
    ax = (b - a) / np.linalg.norm(b - a)
    beads = Part('TailBeads', 'bone', bone='Tail3')
    for t in (0.2, 0.7):
        c = A._lerp(a, b, t)
        e1 = np.cross(ax, (1.0, 0, 0))
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(ax, e1)
        r = A.TAIL_R[2] * 0.95 + 0.045
        for k in range(8):
            th = math.tau * k / 8
            p = c + (e1 * math.cos(th) + e2 * math.sin(th)) * r
            beads.sphere(p, (0.04, 0.04, 0.04), seg=8, rings=5)
    out.append(pair(beads.to_object()))
    return out
