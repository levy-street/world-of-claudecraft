"""The Colossus's dressing: the silver crescent that holds its prism and the
ring of pearls round it, the pearls on its brow, silver bands with moons at
its wrists and ankles, the ring of broken crystal its slams and its death
scatter (Shards), and the pool of moonlit water its glass becomes (Pool)."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def build_setting():
    sil = K.Part('PrismSetting', 'silver', bone='Spine2')
    c = A.PRISM_AT + np.array((0, -0.08, -0.05))
    arc, rad = [], []
    for i in range(25):
        a = math.radians(200 + 140 * i / 24)
        arc.append(c + np.array((0.62 * math.cos(a), 0.02, 0.62 * math.sin(a) + 0.12)))
        rad.append(0.02 + 0.08 * math.sin(math.pi * i / 24))
    sil.tube(arc, rad, sides=7, up=(0, -1, 0))
    pearls = K.Part('PrismPearls', 'pearl', bone='Spine2')
    for i in range(18):
        a = 2 * math.pi * i / 18
        pearls.sphere(c + np.array((0.78 * math.cos(a), 0.08 + 0.05 * abs(math.sin(a)), 0.78 * math.sin(a) * 1.1)),
                      (0.055, 0.055, 0.055), seg=10, rings=6)
    brow = K.Part('BrowMoon', 'silver', bone='Head')
    c = A.HEAD_C + np.array((0, -0.36, 0.24))
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(c + np.array((0.16 * math.cos(a), 0.0, 0.16 * math.sin(a) + 0.05)))
        rad.append(0.008 + 0.03 * math.sin(math.pi * i / 12))
    brow.tube(arc, rad, sides=6, up=(0, -1, 0))
    return [_pair(sil), _pair(pearls), _pair(brow)]


def _band(name, bone, c, axis, r):
    p = K.Part(name, 'silver', bone=bone)
    p.torus(c, axis, r, 0.05, seg=28, sides=6)
    ax = np.asarray(axis, float)
    ax /= np.linalg.norm(ax)
    side = np.cross(ax, (0, 1, 0)) if abs(ax[1]) < 0.9 else np.cross(ax, (1, 0, 0))
    side /= np.linalg.norm(side)
    front = np.cross(ax, side)
    m = c - np.array((0, 1, 0)) * (r + 0.04)
    arc, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        arc.append(m + ax * 0.12 * math.sin(a) + side * 0.12 * math.cos(a) - np.array((0, 0.02, 0)))
        rad.append(0.01 + 0.03 * math.sin(math.pi * i / 12))
    p.tube(arc, rad, sides=6)
    _ = front
    return _pair(p)


def build_bands():
    out = []
    for s, side in ((1, 'L'), (-1, 'R')):
        el, wr = A._m(A.ELBOW, s), A._m(A.WRIST, s)
        c = wr + (el - wr) * 0.12
        out.append(_band(f'{side}_WristBand', f'{side}_Forearm', c, tuple(el - wr), 0.44))
        kn, an = A._m(A.KNEE, s), A._m(A.ANKLE, s)
        c = an + (kn - an) * 0.16
        out.append(_band(f'{side}_AnkleBand', f'{side}_Shin', c, tuple(kn - an), 0.44))
    return out


def build_shards():
    p = K.Part('Shards', 'shard', bone='Shards')
    rng = np.random.default_rng(29)
    for i in range(26):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(1.2, 3.2)
        c = np.array((math.cos(a) * r, -1.6 + math.sin(a) * r + 1.6, 0.05))
        h = rng.uniform(0.25, 0.7)
        d = np.array((rng.normal(0, 0.4), rng.normal(0, 0.4), 1.0))
        d /= np.linalg.norm(d)
        pts = [c, c + d * h * 0.6, c + d * h]
        p.tube(pts, [0.12, 0.08, 0.005], sides=5)
    pool = K.Part('GlassPool', 'glow_pool', bone='Pool')
    pool.sphere(np.array((0.0, -0.4, 0.015)), (3.2, 2.8, 0.015), seg=32, rings=6)
    return [_pair(p), _pair(pool)]


def build(sculpts):
    return build_setting() + build_bands() + build_shards()
