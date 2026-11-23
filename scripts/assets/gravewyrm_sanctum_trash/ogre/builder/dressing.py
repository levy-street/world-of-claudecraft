"""The Sledge-Hauler's hard dressing: the haul chain and its iron sledge hook hanging
off the right fist, the two short chains and hooks hanging from the back ring, and
the eyes."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part):
    o = part.to_object()
    return K.duplicate(o, o.name + '_hi'), o


def links(part, pts, link_len=0.2, R=0.085, r=0.026):
    """Chain links along a polyline, alternating 90 degrees."""
    pts = [np.asarray(p, float) for p in pts]
    seg = []
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        seg.append((a, b, np.linalg.norm(b - a)))
        total += seg[-1][2]
    n = int(total / link_len)
    for i in range(n):
        d = (i + 0.5) * link_len
        acc = 0.0
        for a, b, L in seg:
            if acc + L >= d:
                u = (d - acc) / L
                c = a + (b - a) * u
                ax = (b - a) / L
                break
            acc += L
        side = np.cross(ax, (1.0, 0, 0))
        if np.linalg.norm(side) < 1e-3:
            side = np.cross(ax, (0, 1.0, 0))
        side /= np.linalg.norm(side)
        if i % 2:
            side = np.cross(ax, side)
        part.torus(c, side, R, r, seg=12, sides=6, squash=(1.0, 0.62), roll=0.0)


def hook(part, top, down, out, size=1.0):
    """A heavy sledge hook: an eye at the top, a thick shank, a deep curve with a
    barbed point turning back up."""
    top, down, out = (np.asarray(v, float) for v in (top, down, out))
    part.torus(top, out, 0.075 * size, 0.026 * size, seg=12, sides=6)
    shank = [top + down * 0.08 * size, top + down * 0.4 * size]
    pts = list(shank)
    for k in range(1, 9):
        a = math.pi * k / 8
        c = top + down * 0.4 * size + out * 0.16 * size
        pts.append(c - out * math.cos(a) * 0.16 * size + down * math.sin(a) * 0.16 * size)
    pts.append(pts[-1] - down * 0.1 * size + out * 0.02 * size)
    radii = [0.04 * size] * 2 + [0.042 * size * (1 - 0.6 * k / 9) for k in range(1, 10)]
    part.tube(pts, radii, sides=8)


def build_hook():
    p = K.Part('SledgeHook', 'iron', binding='chain')
    links(p, A.HOOK_STATION, link_len=0.15, R=0.065, r=0.02)
    end = A.HOOK_STATION[-1]
    down = (end - A.HOOK_STATION[-2]) / np.linalg.norm(end - A.HOOK_STATION[-2])
    hook(p, end + down * 0.05, down, np.array((0.0, -1.0, 0.0)), size=1.6)
    o = p.to_object()
    o['chain_bones'] = 'Hook1,Hook2,Hook3'
    hi = K.duplicate(o, o.name + '_hi')
    return [(hi, o)]


def build_haul_chains():
    out = []
    for sd in ('L', 'R'):
        p = K.Part(f'HaulChain{sd}', 'iron', binding='chain')
        links(p, A.HAUL[sd], link_len=0.17, R=0.07, r=0.022)
        end = A.HAUL[sd][-1]
        down = (end - A.HAUL[sd][-2]) / np.linalg.norm(end - A.HAUL[sd][-2])
        hook(p, end + down * 0.05, down, np.array((1.0 if sd == 'L' else -1.0, 0.3, 0.0)), size=1.2)
        o = p.to_object()
        o['chain_bones'] = f'Haul{sd}1,Haul{sd}2,Haul{sd}3'
        out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build_eyes():
    p = K.Part('Eyes', 'eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1))
        p.sphere(c, (A.EYE_R, A.EYE_R * 0.85, A.EYE_R * 0.8), seg=12, rings=8)
    return [_pair(p)]


def build(sculpts):
    return build_hook() + build_haul_chains() + build_eyes()
