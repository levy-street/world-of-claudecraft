"""The Lurker's dressing: the silver crescent bands round its eye stalks, the
moon pearl set in its rostrum, the rows of pearls along the carapace rim, the
long antennae (on follow-through chains) and their paddle scales, the glow
spots down its flanks (Glow1-4, put out one by one when it dies) and the bolus
of glimmering venom it spits (Venom, seen only in Spit)."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part, binding=None, chain=None):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    if chain:
        for x in (hi, o):
            x['binding'] = 'chain'
            x['chain_bones'] = ','.join(chain)
    return (hi, o)


def _m(p, s):
    return A._m(p, s)


def build_eye_bands():
    out = []
    for s, side in ((1, 'L'), (-1, 'R')):
        sil = K.Part(f'{side}_EyeBand', 'silver', bone=f'{side}_Eye')
        b, t = _m(A.EYE_BASE, s), _m(A.EYE_TOP, s)
        d = (t - b) / np.linalg.norm(t - b)
        c = b + d * 0.36
        u = np.cross(d, (0, 1, 0))
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        arc, rad = [], []
        for i in range(17):
            a = math.radians(-120 + 240 * i / 16)
            arc.append(c + (u * math.cos(a) + v * math.sin(a)) * 0.075)
            rad.append(0.012 + 0.014 * math.sin(math.pi * i / 16))
        sil.tube(arc, rad, sides=6)
        out.append(_pair(sil))
    return out


def build_crown_pearls():
    """The moon pearl on the rostrum, and pearls along the carapace's rim."""
    p = K.Part('Pearls', 'pearl', bone='Chest')
    Rc = A._seg_frame(A.CHEST[0], A.CHEST[1])
    c = (A.CHEST[0] + A.CHEST[1]) * 0.5 + Rc[:, 2] * 0.12
    for i in range(15):
        a = math.radians(-150 + 300 * i / 14)
        q = c + Rc @ np.array((0.55 * math.sin(a), 0.56 * math.cos(a) * -1.0, 0.0)) * 1.0
        q = q + Rc[:, 2] * 0.05
        p.sphere(q, (0.03, 0.03, 0.03), seg=8, rings=5)
    head = K.Part('RostrumPearl', 'glow_pearl', bone='Head')
    head.sphere(A.HEAD[1] + np.array((0, -0.08, 0.06)), (0.06, 0.06, 0.06), seg=12, rings=8)
    sil = K.Part('RostrumMoon', 'silver', bone='Head')
    cc = A.HEAD[1] + np.array((0, -0.09, 0.06))
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(cc + np.array((0.09 * math.cos(a), -0.01, 0.09 * math.sin(a) + 0.03)))
        rad.append(0.006 + 0.016 * math.sin(math.pi * i / 12))
    sil.tube(arc, rad, sides=6, up=(0, -1, 0))
    return [_pair(p), _pair(head), _pair(sil)]


def build_antennae():
    out = []
    for s, side in ((1, 'L'), (-1, 'R')):
        pts, rad = [], []
        chain = [f'{side}_Ant{j}' for j in (1, 2, 3)]
        nodes = [_m(p, s) for p in A.ANT]
        for j in range(3):
            for i in range(8):
                t = i / 8
                pts.append(nodes[j] + (nodes[j + 1] - nodes[j]) * t)
                u = (j + t) / 3
                rad.append(0.028 * (1 - u) + 0.006)
        pts.append(nodes[3])
        rad.append(0.005)
        ant = K.Part(f'{side}_Antenna', 'shell_thin', bone=chain[0])
        ant.tube(pts, rad, sides=6)
        out.append(_pair(ant, chain=chain))
        sc = K.Part(f'{side}_AntScale', 'shell_thin', bone=f'{side}_Scale')
        b0, b1 = _m(A.SCALE_B[0], s), _m(A.SCALE_B[1], s)
        c = (b0 + b1) * 0.5
        d = (b1 - b0) / np.linalg.norm(b1 - b0)
        u = np.cross(d, (0, 0, 1))
        u /= np.linalg.norm(u)
        R = np.stack([u, d, np.cross(u, d)], axis=1)
        sc.sphere(c, (0.07, 0.17, 0.018), rot=R, seg=14, rings=8)
        out.append(_pair(sc))
    return out


def build_glow_spots():
    out = []
    for g in A.GLOW_SEG:
        p = K.Part(f'GlowSpots{g}', 'glow_spot', bone=f'Glow{g}')
        a, b = A.ABD[g - 1], A.ABD[g]
        for s in (1, -1):
            for t in (0.3, 0.7):
                q = a + (b - a) * t + np.array((s * A.ABD_W[g - 1] * 0.98, 0, -A.ABD_H[g - 1] * 0.05))
                p.sphere(q, (0.035, 0.05, 0.035), seg=8, rings=5)
        out.append(_pair(p))
    return out


def build_venom():
    p = K.Part('VenomBolus', 'glow_venom', bone='Venom')
    c = A.VENOM_AT + np.array((0, -0.08, 0))
    p.sphere(c, (0.14, 0.14, 0.14), seg=14, rings=9)
    sp = K.Part('VenomSparks', 'glow_pearl', bone='Venom')
    rng = np.random.default_rng(9)
    for i in range(8):
        d = rng.normal(0, 1, 3)
        d /= np.linalg.norm(d)
        sp.sphere(c + d * 0.2, (0.018, 0.018, 0.018), seg=6, rings=4)
    return [_pair(p), _pair(sp)]


def build(sculpts):
    return build_eye_bands() + build_crown_pearls() + build_antennae() + build_glow_spots() + build_venom()
