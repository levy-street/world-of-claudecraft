"""Tidewisp: skeleton and sculpts (rest pose), in yards.

A great drop of moon-water the siren's song lifts out of her spout: a clear
teardrop of sea-water lit from inside, its point curling back like a flame,
a silver crescent moon set in its face (it turns, faster as the wisp rushes
in), a few motes of water circling it, and a trail of falling drops behind
and under it. When it reaches its mark it bursts in a ring of frost and
spray.

Axes: yards, +Z up, faces -Y. The drop's centre about 1.25 up; the trail's
last drop near the floor.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import Field, Noise, RoundCone, Sphere

NAME = 'Tidewisp'
PREFIX = 'tidewisp'

C = np.array((0.0, 0.0, 1.25))       # the drop's centre
R = 0.5
TIP = C + np.array((0.0, 0.34, 0.9))  # its point, curled back
MOON_C = C + np.array((0.0, -0.47, 0.03))
TRAIL = [C + np.array(p) for p in ((0.0, 0.36, -0.28), (0.0, 0.72, -0.5), (0.0, 1.02, -0.64), (0.0, 1.28, -0.74),
                                   (0.0, 1.5, -0.8))]
BAKE_CAGE, BAKE_RAY = 0.02, 0.07


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', tuple(C), tuple(C + np.array((0, 0, 0.5)))),
        ('Moon', 'Hips', tuple(MOON_C), tuple(MOON_C + np.array((0, -0.3, 0)))),
        ('Orbit', 'Hips', tuple(C), tuple(C + np.array((0, 0, 0.4)))),
        ('Burst', 'Root', tuple(C), tuple(C + np.array((0, 0, 0.4)))),
    ]
    prev = 'Hips'
    for i in range(4):
        out.append((f'Trail{i + 1}', prev, tuple(TRAIL[i]), tuple(TRAIL[i + 1])))
        prev = f'Trail{i + 1}'
    return out


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = ()
LIMBS = ()
HELPERS = {}
ROLL_LIMIT = {}
LEFT_ARM = ()
FINGERS = ()
FINGER_FAN = {}
SOLE_Z = 0.3
GROUND = -5.0
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {}
POP_SKIP = ('Trail', 'Moon', 'Orbit', 'Burst')
TREMOR_KEYS = ('Hips',)
AIM_LIMITS = {}
HIDDEN = {'Burst': 0.0}
TRAIL_CHAIN = [f'Trail{i}' for i in range(1, 5)]
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS


def hand_frame(side=1):
    raise NotImplementedError


def _chains():
    from rig import Chain
    return [Chain(TRAIL_CHAIN, 'Hips', gravity=0.3, stiff=0.16, damp=0.12, drag=1.6)]


class _Lazy(list):
    def __iter__(self):
        if not len(self):
            self.extend(_chains())
        return list.__iter__(self)

    def __bool__(self):
        return True


CHAINS = _Lazy()


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def build_drop(voxel):
    """The drop: a round body drawing up into a point that curls back like a
    flame, a faint swirl in its surface, a socket in its face for the moon."""
    F = Field(C - 0.7, C + np.array((0.7, 0.9, 1.05)), voxel)
    F.add(Sphere(C, R, bone='Hips'), 0.1)
    mid = C + np.array((0.0, 0.08, 0.5))
    F.add(RoundCone(C + np.array((0, 0.02, 0.15)), mid, 0.42, 0.24, bone='Hips'), 0.18)
    F.add(RoundCone(mid, TIP, 0.24, 0.035, bone='Hips'), 0.12)
    # a swirl of water running round the drop, raised a little
    pts = []
    for i in range(40):
        u = i / 39
        a = 2 * math.pi * 1.6 * u
        z = C[2] - 0.35 + 0.95 * u
        r = math.sqrt(max(0.0, R * R - (z - C[2]) ** 2)) * (1.0 if z < C[2] + 0.2 else 0.85) + 0.005
        pts.append(np.array((r * math.sin(a), -r * math.cos(a) + 0.06 * u, z)))
    F.ridge(sdf.Polyline(pts, [0.01] * len(pts)), 0.018, k=0.03)
    F.sub(Sphere(MOON_C + np.array((0, 0.08, 0)), 0.24), 0.05)
    noise = Noise(3)
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=3), band=0.05)
    return F


def drop_paint(obj):
    """RegCore (how near the lit heart, for the light from within), RegZ, RegFace
    (the front, where the moon's light spills)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    d = np.linalg.norm(P - C, axis=1)
    core = np.clip(1 - (d - 0.3) / 0.6, 0, 1)
    face = np.clip(1 - np.linalg.norm(P - MOON_C, axis=1) / 0.45, 0, 1)
    _write(obj, {'RegCore': core, 'RegZ': np.clip((P[:, 2] - (C[2] - R)) / 1.4, 0, 1), 'RegFace': face})


def fields(k=1.0):
    from build_core import Sculpt
    return [Sculpt('Drop', build_drop(0.009 * k), 'water', 3200, tau=0.05, paint=drop_paint)]


_ = X
