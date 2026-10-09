"""The Snapper's dressing: its tentacles (three to four to a bundle, each
bundle on a follow-through chain), the silver crescent medallions with a
pearl set in the shell's navel on both sides."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part, chain=None):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    if chain:
        for x in (hi, o):
            x['binding'] = 'chain'
            x['chain_bones'] = ','.join(chain)
    return (hi, o)


def build_tentacles():
    out = []
    rng = np.random.default_rng(11)
    for i in range(A.N_BUNDLE):
        chain = [f'Tent{i}_{j}' for j in (1, 2, 3)]
        pts0 = A.bundle_points(i)
        p = K.Part(f'Tentacles{i}', 'tentacle', bone=chain[0])
        for m in range(4):
            off = rng.normal(0, 1, 3) * np.array((0.06, 0.04, 0.05))
            pts, rad = [], []
            for j in range(3):
                for t in np.linspace(0, 1, 6, endpoint=False):
                    q = pts0[j] + (pts0[j + 1] - pts0[j]) * t
                    u = (j + t) / 3
                    pts.append(q + off * (0.4 + u) + np.array((0, 0, 0.02 * math.sin(u * 9 + m))))
                    rad.append(0.055 * (1 - u) + 0.012)
            pts.append(pts0[3] + off * 1.4)
            rad.append(0.01)
            for q in pts:
                q[2] = max(q[2], 0.03)
            p.tube(pts, rad, sides=6)
        out.append(_pair(p, chain))
    return out


def build_medallions():
    out = []
    for s in (1, -1):
        sil = K.Part(f'Medallion{"L" if s > 0 else "R"}', 'silver', bone='Shell')
        c = A.SHELL_C + np.array((s * 0.3, 0.0, 0.0))
        arc, rad = [], []
        for i in range(19):
            a = math.radians(200 + 140 * i / 18)
            arc.append(c + np.array((0.0, -0.17 * math.cos(a), 0.17 * math.sin(a) + 0.05)))
            rad.append(0.012 + 0.04 * math.sin(math.pi * i / 18))
        sil.tube(arc, rad, sides=7, up=(s, 0, 0))
        sil.torus(c, (1, 0, 0), 0.24, 0.02, seg=32, sides=5)
        pearl = K.Part(f'NavelPearl{"L" if s > 0 else "R"}', 'glow_pearl', bone='Shell')
        pearl.sphere(c + np.array((s * 0.02, 0.0, 0.0)), (0.075, 0.075, 0.075), seg=12, rings=8)
        out += [_pair(sil), _pair(pearl)]
    return out


def build(sculpts):
    return build_tentacles() + build_medallions()
