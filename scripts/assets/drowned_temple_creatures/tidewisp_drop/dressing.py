"""The Tidewisp's dressing: the silver crescent moon in its face (Moon), the
motes of water circling it (Orbit), the falling drops of its trail (Trail1-4)
and the ring of frost and spray it bursts into (Burst)."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def build_moon():
    """A thick silver crescent, horns up, set in the drop's face, a moon pearl
    cradled in it."""
    sil = K.Part('MoonCrescent', 'glow_moon', bone='Moon')
    c = A.MOON_C
    arc, rad = [], []
    for i in range(21):
        a = math.radians(205 + 130 * i / 20)
        arc.append(c + np.array((0.27 * math.cos(a), -0.03, 0.27 * math.sin(a) + 0.1)))
        rad.append(0.012 + 0.075 * math.sin(math.pi * i / 20))
    sil.tube(arc, rad, sides=8, up=(0, -1, 0))
    pearl = K.Part('MoonCore', 'glow_core', bone='Moon')
    pearl.sphere(c + np.array((0, -0.02, 0.02)), (0.085, 0.085, 0.085), seg=12, rings=8)
    return [_pair(sil), _pair(pearl)]


def build_motes():
    p = K.Part('Motes', 'glow_drop', bone='Orbit')
    for i in range(6):
        a = 2 * math.pi * i / 6
        r = 0.72 + 0.06 * math.sin(i * 2.1)
        z = 0.12 * math.sin(i * 1.7)
        q = A.C + np.array((r * math.sin(a), -r * math.cos(a), z))
        s = 0.045 + 0.015 * math.cos(i * 1.3)
        p.sphere(q, (s, s, s * 1.3), seg=8, rings=6)
    return [_pair(p)]


def build_trail():
    out = []
    sizes = (0.13, 0.1, 0.075, 0.055)
    for i, s in enumerate(sizes):
        p = K.Part(f'TrailDrop{i + 1}', 'glow_drop', bone=f'Trail{i + 1}')
        q = A.TRAIL[i + 1]
        p.sphere(q, (s, s * 1.4, s), seg=10, rings=7)
        out.append(_pair(p))
    return out


def build_burst():
    """The burst: a ring of frost (3 yards across once scaled up in the clip)
    with spikes of ice standing out of it and a spray of drops."""
    ring = K.Part('BurstRing', 'glow_frost', bone='Burst')
    c = A.C
    ring.torus(c, (0, 0, 1), 0.5, 0.03, seg=40, sides=5)
    for i in range(12):
        a = 2 * math.pi * i / 12
        b = c + np.array((0.5 * math.sin(a), -0.5 * math.cos(a), 0.0))
        t = b + np.array((0.12 * math.sin(a), -0.12 * math.cos(a), 0.16 + 0.06 * (i % 2)))
        ring.tube([b, t], [0.035, 0.004], sides=4)
    spray = K.Part('BurstSpray', 'glow_drop', bone='Burst')
    rng = np.random.default_rng(5)
    for i in range(18):
        d = rng.normal(0, 1, 3)
        d[2] = abs(d[2]) * 0.6
        d /= np.linalg.norm(d)
        q = c + d * rng.uniform(0.25, 0.5)
        s = rng.uniform(0.03, 0.06)
        spray.sphere(q, (s, s, s), seg=7, rings=5)
    return [_pair(ring), _pair(spray)]


def build(sculpts):
    return build_moon() + build_motes() + build_trail() + build_burst()
