"""Glacier Splinter: skeleton and sculpts (rest pose), in yards.

A walking shard of the Quench, shaken loose by the thaw: a hulking body of faceted
glacier ice (sharp-cut slabs and crystals, deep blue in the thick of them, white
with rime on top) held together round a skeleton of the Smith's RUNE-IRON: a spine
column, a yoke across the shoulders, rods down the limbs and, in the chest, the
rune-forged heart block whose blue runes burn through the gap between the chest
slabs and the gaps at every joint. Great crystal spikes rise off its shoulders and
back; its fists are clusters of crystal. When it dies the core flares and, 2 s
later, the whole body bursts (Shatter).

Every ice piece is rigid on its own bone (no skin stretches on ice), so the burst
can fling them apart: Death ends on the core's flare, Shatter blows the pieces out.

Axes: yards, +Z up, faces -Y, its left is +X. Top of the back spikes 5.4 yd.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit
from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'GlacierSplinter'
PREFIX = 'glacier_splinter'

SHOULDER = np.array((1.0, 0.05, 4.02))
ELBOW = np.array((1.5, 0.22, 3.05))
WRIST = np.array((1.86, 0.0, 2.18))
HAND_TIP = np.array((2.0, -0.1, 1.62))
HIP = np.array((0.44, 0.05, 2.0))
KNEE = np.array((0.52, -0.16, 1.12))
ANKLE = np.array((0.54, 0.05, 0.36))
BALL = np.array((0.56, -0.42, 0.12))
TOE = np.array((0.56, -0.66, 0.1))
CORE_C = np.array((0.0, -0.18, 3.55))

HAND = B.Hand(WRIST, HAND_TIP, 0.3, {}, thumb=None)
FINGERS = ()
FINGER_FAN = {}


def hand_frame(side=1):
    return HAND.frame(side)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.2, 0.0, 3.95)))
SPIKES = {
    # name: (parent, base, tip): the great crystals off the shoulders and the back
    'L_SpikeShoulder1': ('L_Clavicle', (0.95, 0.1, 4.25), (1.25, 0.25, 5.1)),
    'L_SpikeShoulder2': ('L_Clavicle', (0.78, 0.28, 4.3), (0.92, 0.62, 5.0)),
    'SpikeBack1': ('Spine2', (0.0, 0.42, 4.1), (0.05, 0.85, 5.4)),
    'SpikeBack2': ('Spine2', (0.38, 0.45, 3.85), (0.62, 0.95, 4.85)),
    'SpikeBack3': ('Spine2', (-0.38, 0.45, 3.85), (-0.66, 0.92, 4.75)),
    'SpikeBack4': ('Spine1', (0.0, 0.42, 3.2), (0.0, 0.95, 3.85)),
}


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.05, 2.05), (0, 0.05, 2.6)),
        ('Spine1', 'Hips', (0, 0.05, 2.6), (0, 0.04, 3.2)),
        ('Spine2', 'Spine1', (0, 0.04, 3.2), (0, 0.02, 4.02)),
        ('Neck', 'Spine2', (0, 0.0, 4.08), (0, -0.14, 4.32)),
        ('Head', 'Neck', (0, -0.14, 4.32), (0, -0.2, 4.88)),
        ('Core', 'Spine2', tuple(CORE_C), tuple(CORE_C + np.array((0, -0.5, 0)))),
    ]
    for name, (par, a, b) in SPIKES.items():
        out.append((name, par, a, b))
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.4), ('Spine2', 0.6))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.2, -0.3))
SOLE_Z = float(ANKLE[2])
GROUND = 0.05
FREE_END = ('Death', 'Shatter')
FREE_START = ('Shatter',)
POP_SKIP = ('Spike',)
CHAINS = []
ROLL_GATE = {'UpperArm': 80.0, 'Forearm': 75.0}
FEET = ('L_Foot', 'R_Foot')


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


# ------------------------------------------------------------------ the rune-iron core
def build_core(voxel):
    F = Field((-2.2, -0.75, 0.05), (2.2, 0.75, 4.55), voxel)
    # the spine column and the pelvis yoke
    F.add(RoundCone((0, 0.08, 2.05), (0, 0.06, 2.6), 0.14, 0.13, bone='Hips'), 0.04)
    F.add(RoundCone((0, 0.06, 2.6), (0, 0.04, 3.2), 0.13, 0.12, bone='Spine1'), 0.04)
    F.add(RoundCone((0, 0.04, 3.2), (0, 0.02, 4.05), 0.12, 0.11, bone='Spine2'), 0.04)
    F.add(RoundCone((0, 0.02, 4.05), (0, -0.14, 4.4), 0.1, 0.09, bone='Neck'), 0.03)
    F.add(RoundCone((-0.44, 0.06, 2.05), (0.44, 0.06, 2.05), 0.1, 0.1, bone='Hips'), 0.05)
    for s in (1, -1):
        F.add(RoundCone((0, 0.02, 3.98), _m(SHOULDER, s), 0.1, 0.09, bone=_side('Clavicle', s)), 0.05)
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        F.add(Sphere(sh, 0.14, bone=_side('UpperArm', s)), 0.03)
        F.add(RoundCone(sh, el, 0.075, 0.07, bone=_side('UpperArm', s)), 0.02)
        F.add(Sphere(el, 0.11, bone=_side('ElbowFix', s)), 0.02)
        F.add(RoundCone(el, wr, 0.07, 0.065, bone=_side('Forearm', s)), 0.02)
        F.add(Sphere(wr, 0.1, bone=_side('Hand', s)), 0.02)
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        F.add(Sphere(hp, 0.13, bone=_side('Thigh', s)), 0.03)
        F.add(RoundCone(hp, kn, 0.085, 0.08, bone=_side('Thigh', s)), 0.02)
        F.add(Sphere(kn, 0.12, bone=_side('KneeFix', s)), 0.02)
        F.add(RoundCone(kn, an, 0.08, 0.075, bone=_side('Shin', s)), 0.02)
        F.add(Sphere(an, 0.1, bone=_side('Foot', s)), 0.02)
        # bands of iron round the rods (the Smith's rings)
        for a, b, bone in ((sh, el, 'UpperArm'), (el, wr, 'Forearm'), (hp, kn, 'Thigh'), (kn, an, 'Shin')):
            for u in (0.33, 0.66):
                F.add(sdf.Torus(lerp(a, b, u), b - a, 0.09, 0.03, squash=1.6), 0.01, weight=False)
    # the heart block: a squat iron casket in the chest with a hammered rim
    R = rot_matrix(rx=0.08)
    F.add(RoundBox(CORE_C, (0.3, 0.22, 0.3), R, radius=0.04, bone='Core'), 0.03)
    F.add(RoundBox(CORE_C + np.array((0, -0.03, 0)), (0.36, 0.2, 0.06), R, radius=0.02, bone='Core'), 0.02)
    F.sub(RoundBox(CORE_C + np.array((0, -0.24, 0.0)), (0.17, 0.06, 0.17), R, radius=0.03), 0.02)   # the window
    return F


def rune_strokes():
    """Rune strokes on the heart block's face and down the spine (for the core shader)."""
    out = []
    c = CORE_C + np.array((0, -0.235, 0))
    for (x0, z0), (x1, z1) in (((-0.24, 0.22), (-0.24, -0.22)), ((0.24, 0.22), (0.24, -0.22)),
                               ((-0.24, 0.22), (0.24, 0.22)), ((-0.24, -0.22), (0.24, -0.22))):
        out.append([c + np.array((x0, 0, z0)), c + np.array((x1, 0, z1))])
    for z in np.linspace(2.2, 3.1, 4):
        out.append([np.array((-0.05, -0.12, z)), np.array((0.05, -0.12, z + 0.08)), np.array((-0.03, -0.12, z + 0.16))])
    return out


def fields(k=1.0):
    from build_core import Sculpt
    Fc = build_core(0.011 * k)
    return [Sculpt('RuneIron', Fc, 'runeiron', 5200, tau=0.025)]
