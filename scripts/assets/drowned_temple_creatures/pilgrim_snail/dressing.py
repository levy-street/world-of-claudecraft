"""The Tide Pilgrim's small dressing: the moon eyes (flat glow with a dark slit), the
shrine's moon pearl and its frenzy flare (flat glow, each on its own bone), the
pearl strands hanging from the shrine down the whorls with a silver moon pendant
at each end, and the pearls in the offering bowl."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K

GS = A.GS


def _pair(part):
    o = part.to_object()
    return (K.duplicate(o, o.name + '_hi'), o)


def build_eyes():
    out = []
    for s, p in ((1, 'L_'), (-1, 'R_')):
        e2 = A.g(0.42 * s, -1.92, 1.92) + A.g(0.0, -0.02, 0.04)
        fwd = A.unit((0.15 * s, -1.0, 0.1))
        g = K.Part(p + 'EyeGlow', 'glow_eye', bone=p + 'Eye2')
        # a moon orb set in the bulb, no pupil: it glows, it does not goggle
        g.sphere(e2 + fwd * 0.05 * GS, (0.072 * GS, 0.072 * GS, 0.072 * GS), seg=12, rings=8)
        out.append(_pair(g))
        continue
        pu = K.Part(p + 'Pupil', 'pupil', bone=p + 'Eye2')
        side = A.unit(np.cross(fwd, (0, 0, 1)))
        R = np.stack([side, fwd, np.cross(side, fwd)], axis=1)
        pu.sphere(e2 + fwd * 0.118 * GS, (0.052 * GS, 0.014 * GS, 0.017 * GS), rot=R, seg=10, rings=6)
        out.append(_pair(pu))
    return out


def build_pearl():
    pc = A.shrine_pearl()
    p = K.Part('MoonPearl', 'glow_pearl', bone='Pearl')
    p.sphere(pc, (0.15 * GS,) * 3, seg=16, rings=10)
    return [_pair(p)]


def build_flare():
    """The frenzy: a violet moon halo and rays round the pearl (scaled from nothing
    on the Flare bone)."""
    pc = A.shrine_pearl()
    p = K.Part('FrenzyFlare', 'glow_flare', bone='Flare')
    p.torus(pc, (0, 1, 0), 0.6 * GS, 0.04 * GS, seg=36, sides=6)
    p.torus(pc, (0, 0, 1), 0.5 * GS, 0.03 * GS, seg=32, sides=5)
    for i in range(10):
        a = math.tau * i / 10 + 0.15
        d = np.array((math.cos(a), 0.0, math.sin(a)))
        p.tube([pc + d * 0.66 * GS, pc + d * 1.0 * GS], [0.04 * GS, 0.006 * GS], sides=5)
    p.sphere(pc, (0.2 * GS,) * 3, seg=14, rings=8)
    return [_pair(p)]


def _shell_d(P):
    d, *_ = A.shell_coords(P[:, 0], P[:, 1], P[:, 2])
    return d


def _push_out(pts, clear):
    """Move curve points that sit inside (or too near) the shell out along the
    field's gradient until they clear it by `clear`."""
    P = np.array(pts, float)
    h = 0.01 * GS
    for _ in range(30):
        d = _shell_d(P)
        bad = d < clear
        if not bad.any():
            break
        g = np.zeros_like(P)
        for a in range(3):
            e = np.zeros(3)
            e[a] = h
            g[:, a] = (_shell_d(P + e) - _shell_d(P - e)) / (2 * h)
        g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        P[bad] += g[bad] * (clear - d[bad])[:, None] * 0.8
    return P


def build_strands():
    """Four strands of pearls from the plinth's rim down over the whorls."""
    o = A.shrine_origin()
    rim = A.SHRINE['plinth_r'] * GS * 0.98
    pearls = K.Part('PearlStrands', 'pearl', bone='Shrine')
    silver = K.Part('Pendants', 'silver', bone='Shrine')
    for k, (a, drop, sag) in enumerate(((0.35, 0.95, 0.12), (1.95, 1.05, 0.1), (3.45, 0.85, 0.14), (4.9, 1.0, 0.1))):
        d = np.array((math.cos(a), math.sin(a), 0.0))
        A0 = o + d * rim + np.array((0, 0, 0.04 * GS))
        B = A0 + d * 0.55 * GS + np.array((0, 0, -drop * GS))
        n = 15
        pts = []
        for i in range(n):
            u = i / (n - 1)
            p = A0 * (1 - u) + B * u
            p = p + d * (0.35 * GS * math.sin(math.pi * u * 0.8)) + np.array((0, 0, -sag * GS * 4 * u * (1 - u)))
            pts.append(p)
        pts = _push_out(pts, 0.05 * GS)
        for i, p in enumerate(pts):
            r = 0.033 * GS if i % 4 else 0.042 * GS
            pearls.sphere(p, (r, r, r), seg=7, rings=5)
        end = pts[-1] + np.array((0, 0, -0.07 * GS))
        # the moon pendant: a small flat crescent hung edge-on to the strand
        side = np.cross(d, (0, 0, 1))
        cres = []
        for i in range(9):
            t = -1.15 + 2.3 * i / 8
            cres.append(end + (side * math.sin(t) + np.array((0, 0, -1)) * math.cos(t)) * 0.075 * GS)
        silver.tube(cres, [0.012 * GS, 0.02 * GS, 0.026 * GS, 0.03 * GS, 0.03 * GS, 0.03 * GS, 0.026 * GS,
                           0.02 * GS, 0.012 * GS], sides=6, up=tuple(d))
        pearls.sphere(end + np.array((0, 0, -0.03 * GS)), (0.05 * GS,) * 3, seg=10, rings=6)
    # the offering bowl's pearls
    bw = o + np.array((0, -A.SHRINE['plinth_r'] * 0.72, A.SHRINE['plinth_h'] + 0.05 + 0.1)) * np.array((1, 1, 1))
    bw = np.array((o[0], o[1] - A.SHRINE['plinth_r'] * 0.72 * GS, o[2] + (A.SHRINE['plinth_h'] + 0.15) * GS))
    for dx, dy, dz in ((0.03, 0.0, 0.0), (-0.035, 0.02, 0.0), (0.0, -0.035, 0.005), (0.005, 0.01, 0.045)):
        pearls.sphere(bw + np.array((dx, dy, dz)) * GS, (0.03 * GS,) * 3, seg=8, rings=5)
    return [_pair(pearls), _pair(silver)]


def build(sculpts):
    return build_eyes() + build_pearl() + build_flare() + build_strands()
