"""Gaoler Ossick: skeleton and sculpts (rest pose), in yards.

The master of the Bastion's gaol, drowned in his own yard and hauling the drowned
still: a hulking hunched brute, the shoulders heaped up past his ears and crusted
with barnacles, arms like mooring posts ending in iron manacles with their chains
snapped (the sea made a prisoner of him too), a bloated bald head sunk between
them, caged in an iron brank (the scold's bridle he once locked on others: a band
round the brow, straps over the crown, a bar down the nose to the iron bit in his
mouth) with sea light behind the bands. A leather harness crossed over the bare
grey chest, a wide studded belt and a leather kilt; a ship's anchor slung on his
back on a chain over the left shoulder, a pair of shackles hung at the hip, and a
great iron-banded cudgel in the right fist.

Axes: yards, +Z up, faces -Y (glTF +Z), his left is +X. Rest is an A-pose (arms
30 degrees off the body).

The skeleton, the landmarks and the hand are the Sanctum kit's soldier (the clips
and gates were tuned on them); everything that is dressed or sculpted is his own.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'GaolerOssick'
PREFIX = 'ossick'
VARIANT = [None]


def set_variant(v):
    VARIANT[0] = v


# ------------------------------------------------------------------ landmarks (left side)
SHOULDER = np.array((0.6, 0.04, 3.58))
ELBOW = np.array((0.98, 0.13, 2.94))
WRIST = np.array((1.3, 0.0, 2.38))
HAND_TIP = np.array((1.47, -0.08, 1.93))
HIP = np.array((0.25, 0.05, 2.3))
KNEE = np.array((0.29, -0.05, 1.28))
ANKLE = np.array((0.31, 0.08, 0.24))
BALL = np.array((0.33, -0.36, 0.075))
TOE = np.array((0.33, -0.62, 0.06))
HEAD_C = np.array((0.0, -0.02, 4.2))
EYE = np.array((0.072, -0.188, 4.205))
EYE_R = 0.03

HAND = B.Hand(WRIST, HAND_TIP, 0.25, {
    'Index': (0.075, 0.08, 0.0, 0.115, 0.034),
    'Middle': (0.024, 0.0, 0.01, 0.125, 0.035),
    'Ring': (-0.028, -0.06, -0.006, 0.115, 0.033),
    'Little': (-0.075, -0.14, -0.032, 0.09, 0.028),
}, thumb=((0.075, 0.08, 0.055), (0.55, 0.62, 0.55), 0.1, 0.085))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.1, -0.02, 3.52)))

# ------------------------------------------------------------------ the key ring (held like a haft: axe_matrix is its frame)
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.2 + _p * 0.07               # the centre of the right fist on the haft
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))         # the haft runs through the fist
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.2 + _pl * 0.07)
CUDGEL_BELOW, CUDGEL_GRIP, CUDGEL_END = 0.32, 0.2, 1.62   # butt, the grip's top and the head's end along it
_wl2, _dl2, _wdl2, _pl2 = HAND.frame(1)
GRIP_L = _wl2 + _dl2 * 0.2 + _pl2 * 0.07          # the centre of the left fist
GRIP_L_AXIS = unit(_wdl2 + _dl2 * 0.3)            # a haft through the left fist, toward the thumb
# The anchor on his back: its ring behind the left shoulder, the shank down his back
# to the crown over the right hip, the arms flat to the back.
ANCHOR_RING_B = np.array((0.44, 0.72, 3.62))
ANCHOR_CROWN_B = np.array((-0.3, 0.8, 2.3))
ANCHOR_SHANK = 1.45                               # ring to crown, before ANCHOR_SCALE
ANCHOR_SCALE = 1.3                                # the anchor is built at the shank above, drawn this much bigger
SHACKLE_HIP = np.array((0.7, -0.18, 2.5))         # where the shackle pair hangs off the belt
CUDGEL_HIP = np.array((-0.74, -0.08, 2.72))       # where the cudgel is thrust through the belt (its grip)


# The head, the helm and everything on them are sculpted at the kit soldier's size
# and then grown about the base of the neck (post_mesh): a heavier, more readable
# head under the camera, the way the game's figures carry theirs.
HEAD_SCALE = 1.1
HEAD_PIVOT = np.array((0.0, 0.02, 3.6))
HEAD_DROP = 0.12
HEAD_PARTS = ('Head', 'TeethUp', 'TeethLow', 'Brank', 'BarnHead', 'Eyes')


def head_map(P):
    """Rest-space points (n, 3) to their grown places: full scale above 3.78, none
    below 3.56 (the neck's foot stays seated in the gorget)."""
    P = np.asarray(P, float)
    t = np.clip((P[..., 2] - 3.56) / (3.78 - 3.56), 0, 1)
    t = t * t * (3 - 2 * t)
    k = 1.0 + (HEAD_SCALE - 1.0) * t
    out = HEAD_PIVOT + (P - HEAD_PIVOT) * k[..., None]
    out[..., 2] -= HEAD_DROP * t
    return out


def post_mesh(pairs):
    for hi, lo in pairs:
        if lo.name not in HEAD_PARTS:
            continue
        for o in (hi, lo):
            me = o.data
            co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get('co', co)
            co = head_map(co.reshape(-1, 3))
            me.vertices.foreach_set('co', co.ravel())
            me.update()


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.05, 2.36), (0, 0.05, 2.74)),
        ('Spine1', 'Hips', (0, 0.05, 2.74), (0, 0.04, 3.08)),
        ('Spine2', 'Spine1', (0, 0.04, 3.08), (0, 0.04, 3.52)),
        ('Neck', 'Spine2', (0, 0.05, 3.6), (0, -0.01, 3.96)),
        ('Head', 'Neck', (0, -0.01, 3.96), (0, -0.04, 4.55)),
        ('Jaw', 'Head', (0, -0.08, 4.07), (0, -0.2, 3.97)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        # the anchor and the shackle pair, twice each: slung on him, and in the left fist
        # (the clips show one and hide the other by scale)
        ('AnchorB', 'Spine2', tuple(ANCHOR_RING_B), tuple(ANCHOR_RING_B + np.array((0.0, 0.0, 0.3)))),
        ('AnchorH', 'L_Hand', tuple(GRIP_L), tuple(GRIP_L + GRIP_L_AXIS * 0.3)),
        ('ShackleB', 'Hips', tuple(SHACKLE_HIP), tuple(SHACKLE_HIP + np.array((0.0, 0.0, 0.3)))),
        ('ShackleH', 'L_Hand', tuple(GRIP_L + np.array((0.0, 0.0, 0.001))), tuple(GRIP_L + _dl2 * 0.3)),
        # the cudgel thrust through his belt while both fists heave the shackles
        ('CudgelB', 'Hips', tuple(CUDGEL_HIP), tuple(CUDGEL_HIP + np.array((0.0, 0.0, 0.3)))),
        # the sodden tabard, front and back panels
        ('TabF1', 'Hips', (0, -0.62, 2.6), (0, -0.66, 1.86)),
        ('TabF2', 'TabF1', (0, -0.66, 1.86), (0, -0.67, 1.1)),
        ('TabB1', 'Hips', (0, 0.4, 2.6), (0, 0.46, 1.86)),
        ('TabB2', 'TabB1', (0, 0.46, 1.86), (0, 0.47, 1.1)),
    ] + B.arm_leg_bones(L, HAND, FINGERS)
    grown = []
    for name, parent, h, t in out:
        if name in ('Head', 'Jaw'):
            h, t = tuple(head_map(h)), tuple(head_map(t))
        elif name == 'Neck':
            t = tuple(head_map(t))
        grown.append((name, parent, h, t))
    return B.topo(B.expand(grown))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.42), ('Spine2', 0.58))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1',
                                     'Little2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.16, -0.23))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_START = ()
FREE_END = ('Death',)
WEAPON_PROBES = (-CUDGEL_BELOW, 0.8, CUDGEL_END)
COLLIDE_LEGS = {'L_Thigh': 0.38, 'R_Thigh': 0.38, 'L_Shin': 0.28, 'R_Shin': 0.28}


def _chains():
    from rig import Chain
    return [
        Chain(['TabF1', 'TabF2'], 'Hips', gravity=0.6, stiff=0.18, damp=0.2, drag=0.85, collide=True),
        Chain(['TabB1', 'TabB2'], 'Hips', gravity=0.6, stiff=0.18, damp=0.2, drag=0.85, collide=True),
    ]


class _Lazy(list):
    def __iter__(self):
        if not len(self):
            self.extend(_chains())
        return list.__iter__(self)

    def __bool__(self):
        return True


CHAINS = _Lazy()


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _rot(a, b):
    return frame_from(np.asarray(b) - np.asarray(a))


# ------------------------------------------------------------------ the body (sodden mail and gambeson)
def build_body(voxel):
    F = Field((-1.7, -0.85, -0.05), (1.7, 0.9, 4.15), voxel)
    F.add(Ellipsoid((0, 0.04, 2.44), (0.44, 0.31, 0.3), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, -0.01, 2.8), (0.5, 0.4, 0.36), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, -0.22, 2.62), (0.5, 0.42, 0.42), bone='Spine1'), 0.2)       # the gut
    F.add(Ellipsoid((0, -0.1, 2.42), (0.48, 0.36, 0.3), bone='Hips'), 0.18)
    F.add(Ellipsoid((0, -0.02, 3.2), (0.68, 0.47, 0.47), rot_matrix(rx=-0.06), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.14, 3.38), (0.58, 0.3, 0.31), bone='Spine2'), 0.16)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.23, -0.2, 3.3), s), (0.25, 0.14, 0.18), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.12, 3.54), s), _m((0.5, 0.08, 3.58), s), 0.16, 0.14, bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.38, 0.08, 3.06), s), (0.2, 0.24, 0.34), bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.19, 0.2, 2.36), s), (0.23, 0.2, 0.24), bone='Hips'), 0.12)
    F.add(RoundCone((0, 0.05, 3.5), (0, 0.0, 3.9), 0.24, 0.2, bone='Neck'), 0.12)
    # the hump: the trapezius heaped up behind and beside the neck, the back broad
    F.add(Ellipsoid((0, 0.24, 3.62), (0.56, 0.34, 0.3), bone='Spine2'), 0.16)
    F.add(Ellipsoid((0, 0.3, 3.2), (0.66, 0.32, 0.42), bone='Spine2'), 0.16)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.36, 0.12, 3.68), s), (0.3, 0.3, 0.24), bone='Spine2'), 0.14)
        F.add(Ellipsoid(_m((0.27, -0.26, 3.32), s), (0.3, 0.17, 0.22), rot_matrix(ry=0.25 * s), bone='Spine2'), 0.1)

    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.06 * s, 0, 0.03)), 0.31, bone=up), 0.12)
        F.add(RoundCone(sh, el, 0.3, 0.23, bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.5) + np.array((0, -0.08, 0)), (0.21, 0.21, 0.3), _rot(sh, el), bone=up), 0.07)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0.06 * s, 0.07, 0)), (0.19, 0.19, 0.28), _rot(sh, el), bone=up), 0.07)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.17, bone=_side('ElbowFix', s)), 0.08)
        # the forearms: swollen like mooring posts
        F.add(RoundCone(el, lerp(el, wr, 0.4), 0.22, 0.27, bone=fo), 0.08)
        F.add(RoundCone(lerp(el, wr, 0.4), wr, 0.27, 0.16, bone=fo), 0.08)

    for s in (1, -1):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sh = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0, 0.06)), kn, 0.3, 0.19, bone=th), 0.14)
        F.add(Ellipsoid(lerp(hp, kn, 0.42) + np.array((0.03 * s, -0.08, 0)), (0.22, 0.2, 0.32), _rot(hp, kn),
                        bone=th), 0.08)
        F.add(Sphere(kn + np.array((0, -0.02, 0.0)), 0.15, bone=_side('KneeFix', s)), 0.08)
        F.add(RoundCone(kn, an, 0.155, 0.09, bone=sh), 0.1)
        # the calf: a strong bulge high at the back, the shin flat in front
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0.01 * s, 0.075, 0)), (0.145, 0.14, 0.27), _rot(kn, an),
                        bone=sh), 0.09)
        foot = _side('Foot', s)
        F.add(Ellipsoid(an + np.array((0, 0.02, -0.07)), (0.11, 0.15, 0.1), bone=foot), 0.06)
        F.add(RoundBox(_m((0.32, -0.15, 0.105), s), (0.1, 0.2, 0.06), radius=0.04, bone=foot), 0.06)
        F.add(Ellipsoid(_m((0.33, -0.44, 0.075), s), (0.1, 0.16, 0.06), bone=_side('Toes', s)), 0.05)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.12)
    return F


# ------------------------------------------------------------------ the head: bloated, drowned
MOUTH = np.array((0.0, -0.212, 4.058))


def build_head(voxel):
    F = Field((-0.3, -0.36, 3.55), (0.3, 0.3, 4.55), voxel)
    noise = Noise(9)
    # a thick, swollen neck and a skull carried under the helm
    F.add(RoundCone((0, 0.04, 3.6), (0, -0.0, 4.0), 0.17, 0.145, bone='Neck'), 0.07)
    F.add(Ellipsoid((0, 0.0, 4.24), (0.19, 0.22, 0.235), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.1, 4.14), (0.165, 0.14, 0.19), bone='Head'), 0.07)
    for s in (1, -1):
        # waterlogged cheeks and jowls hanging over the jaw line
        F.add(Ellipsoid(_m((0.105, -0.17, 4.125), s), (0.065, 0.052, 0.05), bone='Head'), 0.035)
        F.add(Ellipsoid(_m((0.098, -0.13, 4.03), s), (0.062, 0.066, 0.056), rot_matrix(rx=0.25), bone='Jaw'), 0.04)
        F.add(Ellipsoid(_m((0.112, -0.172, 4.175), s), (0.048, 0.036, 0.03), bone='Head'), 0.02)        # cheekbone
        F.sub(Sphere(_m((0.112, -0.215, 4.1), s), 0.028), 0.02)                                         # hollow under it
        F.add(Ellipsoid(_m((0.168, -0.02, 4.17), s), (0.032, 0.062, 0.082), bone='Head'), 0.03)      # ear
        # swollen lids: a heavy upper lid and a water bag under the eye
        F.add(Ellipsoid(_m((0.074, -0.198, 4.236), s), (0.044, 0.024, 0.019), rot_matrix(rx=0.25), bone='Head'),
              0.014)
        F.add(Ellipsoid(_m((0.078, -0.192, 4.172), s), (0.042, 0.024, 0.02), bone='Head'), 0.014)
    F.add(Ellipsoid((0, -0.2, 4.265), (0.15, 0.055, 0.04), rot_matrix(rx=0.15), bone='Head'), 0.03)   # brow
    # a swollen, flattened nose, its tip eaten
    F.add(RoundCone((0, -0.21, 4.235), (0.0, -0.258, 4.15), 0.024, 0.034, bone='Head'), 0.025)
    F.add(Ellipsoid((0.0, -0.252, 4.135), (0.044, 0.032, 0.028), bone='Head'), 0.02)
    F.sub(Sphere((0.03, -0.285, 4.14), 0.022), 0.008)
    # the slack jaw: a chin hung low, the mouth open on a dark throat
    F.add(Ellipsoid((0, -0.12, 4.0), (0.13, 0.115, 0.08), rot_matrix(rx=0.24), bone='Jaw'), 0.05)
    F.add(Ellipsoid((0, -0.2, 3.965), (0.058, 0.046, 0.048), bone='Jaw'), 0.03)
    F.add(Ellipsoid((0, -0.21, 4.012), (0.06, 0.024, 0.016), bone='Jaw'), 0.012)       # lower lip, pulled down
    F.add(Ellipsoid((0, -0.228, 4.092), (0.06, 0.02, 0.013), bone='Head'), 0.012)      # upper lip, drawn back
    F.sub(Ellipsoid(MOUTH + np.array((0, 0, -0.006)), (0.056, 0.075, 0.038)), 0.012)                                 # the open mouth
    for s in (1, -1):
        F.sub(Sphere(_m(EYE + np.array((0, -0.008, 0.004)), s), EYE_R + 0.022), 0.02)      # sunken sockets
    # the crabs' work: the left cheek eaten open to the teeth
    F.sub(Ellipsoid((0.083, -0.195, 4.062), (0.036, 0.05, 0.024), rot_matrix(rz=0.3)), 0.01)
    F.sub(Ellipsoid((0.155, -0.08, 4.2), (0.02, 0.05, 0.02)), 0.006)                    # a torn ear
    # blistered, bloated skin: soft lumps, and the creases of skin gone loose
    for s in (1, -1):
        F.groove(Polyline([_m((0.045, -0.25, 4.115), s), _m((0.085, -0.235, 4.06), s), _m((0.1, -0.21, 4.0), s)],
                          0.003), 0.007, k=0.009)
        F.groove(Polyline([_m((0.04, -0.2, 4.15), s), _m((0.1, -0.2, 4.145), s), _m((0.13, -0.17, 4.15), s)],
                          0.003), 0.005, k=0.008)
    F.groove(Polyline([(-0.1, -0.08, 3.94), (0.0, -0.12, 3.9), (0.1, -0.08, 3.94)], 0.003), 0.008, k=0.01)
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=2)
               + 0.0018 * noise.fbm(X_ * 40, Y_ * 40, Z_ * 40, octaves=2), band=0.05)
    return F


def build_teeth(voxel):
    """Upper teeth (Head) and lower teeth (Jaw), yellowed and broken."""
    up = Field((-0.09, -0.27, 4.02), (0.09, -0.15, 4.12), voxel)
    lo = Field((-0.09, -0.27, 3.98), (0.09, -0.15, 4.07), voxel)
    rng = np.random.default_rng(31)
    for k in range(9):
        a = -0.75 + 1.5 * k / 8
        x, y = 0.07 * math.sin(a), -0.15 - 0.07 * math.cos(a)
        if k == 6:
            continue                                     # a missing tooth
        h = rng.uniform(0.016, 0.024)
        up.add(RoundCone((x, y, 4.096), (x, y - 0.004, 4.096 - h), 0.011, 0.008), 0.004)
        if k not in (2, 7):
            h2 = rng.uniform(0.012, 0.02)
            lo.add(RoundCone((x * 0.95, y + 0.006, 4.022), (x * 0.95, y + 0.004, 4.022 + h2), 0.01, 0.007), 0.004)
    return up, lo


# ------------------------------------------------------------------ the bare left forearm, and the hands
def build_hand(side, voxel, forearm):
    w, down, width, palm = hand_frame(side)
    el = ELBOW if side > 0 else mirror(ELBOW)
    lo = np.minimum(w, el) - 0.34
    hi = np.maximum(w + down * 0.62, el) + 0.34
    if not forearm:
        lo = np.minimum(w - down * 0.1, w + down * 0.55) - 0.24
        hi = np.maximum(w - down * 0.1, w + down * 0.55) + 0.24
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    if forearm:
        # the drowned forearm: bloated and smooth, the skin slack and split
        fo = _side('Forearm', side)
        F.add(Sphere(el + np.array((0, 0.04, 0)), 0.125, bone=_side('ElbowFix', side)), 0.05)
        F.add(RoundCone(el, lerp(el, w, 0.4), 0.135, 0.15, bone=fo), 0.06)
        F.add(RoundCone(lerp(el, w, 0.4), w, 0.15, 0.095, bone=fo), 0.06)
        ax = unit(w - el)
        out = unit(np.cross(ax, (0, -1.0, 0)) * -side)
        F.add(Ellipsoid(lerp(el, w, 0.32) + out * 0.04, (0.085, 0.085, 0.19), _rot(el, w), bone=fo), 0.05)
        F.add(Ellipsoid(lerp(el, w, 0.36) - out * 0.035, (0.075, 0.075, 0.17), _rot(el, w), bone=fo), 0.05)
        inner = np.cross(ax, out)
        # skin split along the inside of the arm, and blisters
        F.groove(Polyline([lerp(el, w, 0.45) + inner * 0.12, lerp(el, w, 0.75) + inner * 0.1], 0.004), 0.012, k=0.012)
        rng = np.random.default_rng(12)
        for _ in range(5):
            t = rng.uniform(0.25, 0.85)
            a = rng.uniform(0, math.tau)
            p = lerp(el, w, t) + (out * math.cos(a) + inner * math.sin(a)) * 0.13
            F.add(Sphere(p, rng.uniform(0.015, 0.025), bone=fo), 0.012)
    else:
        F.add(RoundCone(w - down * 0.08, w + down * 0.02, 0.09, 0.085, bone=hand), 0.03)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.13, (0.105, 0.045, 0.1), Rm, radius=0.045, bone=hand), 0.035)
    F.add(Ellipsoid(w + down * 0.08 + width * 0.05 + palm * 0.035, (0.055, 0.045, 0.072), Rm, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = (HAND.fingers[f][4] if f != 'Thumb' else 0.04) * 1.35
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        if f != 'Thumb':
            F.add(Sphere(base - palm * 0.015, r0 + 0.008, bone=hand), 0.015)
        F.add(RoundCone(base, mid, r0, r0 * 0.9, bone=b1), 0.014)
        F.add(Sphere(mid, r0 * 0.94, bone=b2), 0.01)
        F.add(RoundCone(mid, tip, r0 * 0.9, r0 * 0.7, bone=b2), 0.01)
    return F


# ------------------------------------------------------------------ the plate
class _Union:
    def __init__(self, *fields):
        self.f = fields
        self.lo = np.min([f.lo for f in fields], axis=0)

    def sample(self, P):
        out = None
        for f in self.f:
            d = f.sample(P)
            lo = f.lo
            hi = f.lo + (np.array(f.shape) - 1) * f.voxel
            inside = np.all((P >= lo) & (P <= hi), axis=1)
            d = np.where(inside, d, 9.0)
            out = d if out is None else np.minimum(out, d)
        return out


def _arm_d(X_, Y_, Z_, s, a='SHOULDER', b='ELBOW'):
    A_ = {'SHOULDER': SHOULDER, 'ELBOW': ELBOW, 'WRIST': WRIST, 'HIP': HIP, 'KNEE': KNEE, 'ANKLE': ANKLE}
    return X.seg_dist(X_, Y_, Z_, _m(A_[a], s), _m(A_[b], s))


def _dents(G, pts):
    for p, r, dep in pts:
        G.sub(Sphere(p, r), dep)


def plates(Fb, Fh, Fl, voxel):
    """Every plate as (name, field, binding, bone, allow)."""
    out = []
    rg = X.ramp
    BU = _Union(Fb, Fh)
    noise = Noise(21)
    dent = lambda X_, Y_, Z_: 0.008 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=2)  # noqa: E731

    def plate(name, base, lo, hi, off, thick, mask, binding='transfer', bone='', allow=None, extra=None, v=None):
        G = X.layer_field(base, lo, hi, v or voxel, off, thick, mask, extra=extra, noise=dent)
        out.append((name, G, binding, bone, allow))
        return G

    # the cuirass: breast and back, a keel, a rolled lower rim, battered and holed
    def cuirass_mask(X_, Y_, Z_):
        m = rg(Z_, 2.6, 2.66) * (1 - rg(Z_, 3.5, 3.58))
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            m = m * rg(d, 0.25, 0.31)
        m = m * (1 - (1 - rg(np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2), 0.2, 0.26)) * rg(Z_, 3.3, 3.45))
        return m

    def keel(G):
        # the jerkin's laced front and rows of iron studs
        for z in np.arange(2.62, 3.4, 0.1):
            for x in (-0.07, 0.07):
                G.add(Sphere((x, -0.5 - 0.08 * math.exp(-((z - 2.65) / 0.25) ** 2), z), 0.012), 0.004)
        ring = [(0.47 * math.sin(a), 0.03 - 0.45 * math.cos(a), 2.635) for a in np.linspace(-math.pi, math.pi, 41)]
        G.add(Polyline(ring, 0.02), 0.012)
        for p in ((-0.2, -0.42, 3.42), (0.2, -0.42, 3.42), (-0.36, -0.3, 2.68), (0.36, -0.3, 2.68),
                  (-0.43, -0.12, 2.66), (0.43, -0.12, 2.66)):
            G.add(Sphere(p, 0.02), 0.008)
        # dents from the rocks and an old spear hole, rusted through



    plate('Cuirass', Fb, (-0.75, -0.62, 2.5), (0.75, 0.62, 3.7), 0.025, 0.05, cuirass_mask,
          allow=('Spine1', 'Spine2', 'Hips'), extra=keel)

    # the faulds: three lames below the breast, flaring over the hips
    def fauld_mask(X_, Y_, Z_):
        return rg(Z_, 2.22, 2.27) * (1 - rg(Z_, 2.62, 2.66)) * rg(-Y_ + 0.05, -0.05, 0.08)

    def fauld_off(X_, Y_, Z_):
        return 0.03 + 0.05 * rg(Z_, 2.62, 2.25) + 0.012 * (np.floor((2.66 - Z_) / 0.13))

    plate('Faulds', Fb, (-0.7, -0.62, 2.12), (0.7, 0.35, 2.72), fauld_off, 0.045, fauld_mask, allow=('Hips', 'Spine1'))
    for s in (1, -1):
        def tasset_mask(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'HIP', 'KNEE')
            return rg(u, 0.03, 0.08) * (1 - rg(u, 0.36, 0.42)) * rg(-Y_, -0.02, 0.06) * rg(d, 0.42, 0.36)
        plate(_side('Tasset', s), Fb, np.array((min(0, 0.62 * s) - 0.02, -0.6, 1.75)),
              np.array((max(0, 0.62 * s) + 0.02, 0.3, 2.35)), 0.07, 0.04, tasset_mask,
              allow=(_side('Thigh', s), 'Hips'))

    # the gorget round the neck
    def gorget_mask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2)
        return rg(Z_, 3.44, 3.48) * (1 - rg(Z_, 3.8, 3.85)) * rg(r, 0.4, 0.3)
    plate('Gorget', BU, (-0.45, -0.45, 3.4), (0.45, 0.45, 3.9), 0.035, 0.04, gorget_mask, allow=('Neck', 'Spine2'))

    # the pauldrons: a dome and three lames, the left larger (his shield-arm side, though he carries none)
    for s in (1, -1):
        big = 1.32 if s > 0 else 1.24
        c = _m(SHOULDER, s) + np.array((0.04 * s, 0.0, 0.05))

        def pmask(X_, Y_, Z_, c=c, big=big, s=s):
            d = np.sqrt((X_ - c[0]) ** 2 + (Y_ - c[1]) ** 2 + (Z_ - c[2]) ** 2)
            return rg(d, 0.42 * big, 0.36 * big) * rg(Z_, c[2] - 0.2 * big, c[2] - 0.12 * big) * rg(X_ * s, 0.3, 0.38)

        def poff(X_, Y_, Z_, c=c, big=big):
            return 0.05 + 0.05 * rg(Z_, c[2] + 0.1, c[2] - 0.25)

        def flange(G, c=c, s=s, big=big):
            G.add(RoundCone(c + np.array((-0.08 * s, -0.14, 0.17)) * big, c + np.array((-0.05 * s, 0.16, 0.18)) * big,
                            0.028, 0.028), 0.04)
            for a in (-0.6, 0.0, 0.6):
                G.add(Sphere(c + np.array((0.22 * s * math.cos(a), -0.22 * math.sin(a), -0.1)) * big, 0.018), 0.006)
            _dents(G, [(c + np.array((0.25 * s, -0.2, 0.12)), 0.08, 0.016)])
        plate(_side('Pauldron', s), Fb, c - 0.5, c + 0.5, poff, 0.05, pmask,
              allow=(_side('UpperArm', s), _side('Clavicle', s), 'Spine2'), extra=flange)

        for k_, (z0, z1, of) in enumerate(((c[2] - 0.3 * big, c[2] - 0.14 * big, 0.11),
                                            (c[2] - 0.44 * big, c[2] - 0.28 * big, 0.13),
                                            (c[2] - 0.58 * big, c[2] - 0.42 * big, 0.15))):
            def lm(X_, Y_, Z_, c=c, z0=z0, z1=z1, s=s, big=big):
                d, u = _arm_d(X_, Y_, Z_, s)
                return (rg(Z_, z0, z0 + 0.03) * (1 - rg(Z_, z1, z1 + 0.03)) * rg(X_ * s, 0.42, 0.5) *
                        rg(d, 0.36, 0.3))
            plate(_side(f'PauldronLame{k_ + 1}', s), Fb, c - 0.55, c + 0.55, of, 0.04, lm,
                  allow=(_side('UpperArm', s), _side('Clavicle', s)))

    # couters (elbow cops) with a fan on the outside
    for s in (1, -1):
        el = _m(ELBOW, s)
        base = Fb

        def cmask(X_, Y_, Z_, el=el):
            d = np.sqrt((X_ - el[0]) ** 2 + (Y_ - el[1] - 0.05) ** 2 + (Z_ - el[2]) ** 2)
            return rg(d, 0.2, 0.15)

        def fan(G, el=el, s=s):
            out_ = unit(np.array((s * 0.9, 0.35, 0.0)))
            G.add(Ellipsoid(el + out_ * 0.14 + np.array((0, 0.02, 0)), (0.11, 0.025, 0.12),
                            frame_from(out_), bone=None), 0.03)
            G.add(Sphere(el + out_ * 0.17, 0.02), 0.01)
        plate(_side('Couter', s), base, el - 0.35, el + 0.35, 0.03, 0.045, cmask, binding='rigid',
              bone=_side('ElbowFix', s), extra=fan)

    # the vambraces, both forearms
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)

        def vmask(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'ELBOW', 'WRIST')
            return rg(u, 0.14, 0.2) * (1 - rg(u, 0.84, 0.9)) * rg(d, 0.25, 0.2)
        plate(_side('Vambrace', s), Fb, np.minimum(el, wr) - 0.3, np.maximum(el, wr) + 0.3, 0.025, 0.045, vmask,
              binding='rigid', bone=_side('Forearm', s))

    # knee cops over the breeches
    for s in (1, -1):
        kn = _m(KNEE, s)

        def kmask(X_, Y_, Z_, kn=kn):
            d = np.sqrt((X_ - kn[0]) ** 2 + (Y_ - kn[1] + 0.06) ** 2 + (Z_ - kn[2]) ** 2)
            return rg(d, 0.22, 0.17) * rg(-Y_, 0.0, 0.08)

        def kfan(G, kn=kn, s=s):
            G.add(Ellipsoid(kn + np.array((0.17 * s, -0.04, 0.0)), (0.025, 0.1, 0.11), bone=None), 0.03)
        plate(_side('Poleyn', s), Fb, kn - 0.35, kn + 0.35, 0.06, 0.045, kmask, binding='rigid',
              bone=_side('KneeFix', s), extra=kfan)
    return out


# ------------------------------------------------------------------ the sodden breeches and the sea boots
def build_breeches(Fb, voxel, s):
    rg = X.ramp
    hp, kn = _m(HIP, s), _m(KNEE, s)

    def mask(X_, Y_, Z_):
        d, u = _arm_d(X_, Y_, Z_, s, 'HIP', 'KNEE')
        return rg(Z_, 1.1, 1.16) * (1 - rg(Z_, 2.3, 2.36)) * rg(d, 0.48, 0.4) * rg(X_ * s, -0.02, 0.04)

    noise = Noise(40 + s)

    def folds(X_, Y_, Z_):
        return 0.01 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 9, octaves=2)
    lo = np.minimum(hp, kn) - 0.5
    hi = np.maximum(hp, kn) + 0.5
    lo[2], hi[2] = 1.0, 2.45
    return X.layer_field(Fb, lo, hi, voxel, 0.012, 0.035, mask, noise=folds)


def build_boot(Fb, voxel, s):
    rg = X.ramp
    an = _m(ANKLE, s)

    def mask(X_, Y_, Z_):
        near = rg(np.abs(X_ - an[0]), 0.36, 0.3)
        return (1 - rg(Z_, 1.17, 1.21)) * rg(Z_, 0.012, 0.03) * near

    def off(X_, Y_, Z_):
        # hugging the calf and the ankle, then the bucket top flaring out to its rim
        t = np.clip((Z_ - 0.78) / (1.18 - 0.78), 0, 1)
        return 0.012 + 0.075 * t * t

    def extra(G):
        # the cuff's fold line and a strap round the ankle
        ring = [(an[0] + 0.25 * math.sin(a), 0.0 - 0.24 * math.cos(a), 0.9) for a in np.linspace(-math.pi, math.pi, 25)]
        G.groove(Polyline(ring, 0.004), 0.01, k=0.012)
        ring = [(an[0] + 0.155 * math.sin(a), 0.06 - 0.16 * math.cos(a), 0.36) for a in np.linspace(-math.pi, math.pi, 25)]
        G.add(Polyline(ring, 0.022), 0.01)
        G.add(RoundBox((an[0] + 0.16 * s, 0.0, 0.36), (0.012, 0.04, 0.035), radius=0.008), 0.006)
    noise = Noise(60 + s)
    return X.layer_field(Fb, an + np.array((-0.4, -0.85, -0.35)), an + np.array((0.4, 0.45, 1.05)), voxel, off, 0.03,
                         mask, extra=extra, noise=lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 12, octaves=2))


# ------------------------------------------------------------------ the barbute


def _band(G, pts, r):
    G.add(Polyline([tuple(p) for p in pts], r), 0.01)


BRANK_C = np.array((0.0, -0.01, 4.24))


def build_brank(voxel):
    """The brank, the scold's bridle he once locked on the gaol's loud mouths, now
    riveted on his own drowned head: a band round the brow, a strap over the crown
    from brow to nape and one from ear to ear, a bar down the nose to the iron bit
    in his mouth, a strap under the jaw, rivets where they cross, a padlock at the
    nape. Rigid on the head."""
    G = Field((-0.4, -0.45, 3.82), (0.4, 0.45, 4.62), voxel)
    c = BRANK_C
    brow = [c + np.array((0.235 * np.cos(a), 0.27 * np.sin(a), 0.07 - 0.03 * np.sin(a)))
            for a in np.linspace(-math.pi, math.pi, 49)]
    _band(G, brow, 0.026)
    _band(G, [c + np.array((0.0, 0.3 * math.sin(a), 0.26 * math.cos(a))) for a in np.linspace(-1.25, 1.75, 25)], 0.024)
    _band(G, [c + np.array((0.25 * math.sin(a), -0.01, 0.255 * math.cos(a))) for a in np.linspace(-1.55, 1.55, 25)],
          0.024)
    # the nose bar down to the bit, and the bit itself across the open mouth
    _band(G, [(0.0, -0.285, 4.29), (0.0, -0.3, 4.2), (0.0, -0.3, 4.13), (0.0, -0.27, 4.07)], 0.02)
    G.add(RoundBox((0.0, -0.255, 4.06), (0.075, 0.02, 0.022), radius=0.012), 0.012)
    # the jaw strap, cheek to cheek under the chin
    _band(G, [(s_ * 0.24, -0.04, 4.27) if i in (0, 8) else
              (0.2 * math.sin(a), -0.04 - 0.21 * math.cos(a), 3.94 + 0.02 * abs(math.sin(a)))
              for i, (s_, a) in enumerate([(1, 0)] + [(0, a) for a in np.linspace(1.3, -1.3, 7)] + [(-1, 0)])], 0.02)
    for p in ((0, -0.3, 4.29), (0, 0.27, 4.28), (0.24, -0.01, 4.3), (-0.24, -0.01, 4.3), (0, -0.01, 4.5)):
        G.add(Sphere(p, 0.028), 0.006)
    # the padlock at the nape
    G.add(RoundBox((0.0, 0.33, 4.24), (0.06, 0.03, 0.06), radius=0.02), 0.01)
    G.add(sdf.Torus((0.0, 0.33, 4.33), (0.0, 1.0, 0.0), 0.04, 0.012), 0.004)
    noise = Noise(33)
    G.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 8, Y_ * 8, Z_ * 8, octaves=2), band=0.03)
    return G


HARNESS_C = np.array((0.0, -0.5, 3.12))


def build_harness(Fb, voxel):
    """The harness: two broad leather straps crossed over the chest and the back, from
    each shoulder to the other hip, riveted, an iron ring where they cross."""
    rg = X.ramp
    n1 = unit(np.array((0.72, 0.0, -0.69)))
    n2 = unit(np.array((-0.72, 0.0, -0.69)))

    def mask(X_, Y_, Z_):
        d1 = (X_ - HARNESS_C[0]) * n1[0] + (Z_ - HARNESS_C[2]) * n1[2]
        d2 = (X_ - HARNESS_C[0]) * n2[0] + (Z_ - HARNESS_C[2]) * n2[2]
        m = np.maximum(rg(np.abs(d1), 0.085, 0.065), rg(np.abs(d2), 0.085, 0.065))
        return m * rg(Z_, 2.6, 2.66) * (1 - rg(Z_, 4.3, 4.36))

    def extra(G):
        for s in (1, -1):
            for k in range(5):
                t = 0.15 + 0.17 * k
                p = HARNESS_C + np.array((0.6 * s, 0.0, 0.58)) * (t - 0.5) * 2 * 0.5
                q, nrm = _project([Fb], p + np.array((0, -0.3, 0)))
                G.add(Sphere(q + nrm * 0.045, 0.014), 0.004)
    return X.layer_field(Fb, (-1.0, -0.95, 2.45), (1.0, 0.95, 4.4), voxel, 0.006, 0.032, mask, extra=extra)




def _links(G, start, step, n, r=0.05, th=0.014):
    d = unit(np.asarray(step, float))
    side = unit(np.cross(d, (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)))
    for i in range(n):
        c = np.asarray(start, float) + np.asarray(step, float) * i
        axis = side if i % 2 == 0 else unit(np.cross(d, side))
        G.add(sdf.Torus(tuple(c), tuple(axis), r, th), 0.004)


def build_manacle(voxel, s):
    """A manacle on the wrist: a thick iron cuff, hinged and riveted, a short length
    of snapped chain hanging off it (rigid on the forearm)."""
    el, wr = _m(ELBOW, s), _m(WRIST, s)
    ax = unit(wr - el)
    c = lerp(el, wr, 0.84)
    G = Field(c - 0.6, c + 0.6, voxel)
    G.add(sdf.Torus(tuple(c), tuple(ax), 0.215, 0.05, squash=1.6), 0.01)
    G.add(sdf.Torus(tuple(c - ax * 0.07), tuple(ax), 0.22, 0.016), 0.004)
    G.add(sdf.Torus(tuple(c + ax * 0.07), tuple(ax), 0.22, 0.016), 0.004)
    side = unit(np.cross(ax, (0.0, 1.0, 0.0)))
    hang = c - side * 0.24 * s * 0 + np.array((0.0, 0.0, -0.22))
    G.add(sdf.Torus(tuple(c + np.array((0.0, 0.0, -0.24))), (0.0, 1.0, 0.0), 0.05, 0.017), 0.004)
    _links(G, c + np.array((0.0, 0.02, -0.34)), (0.012 * s, 0.01, -0.09), 3, r=0.05, th=0.017)
    for k in range(4):
        a_ = k * math.pi / 2 + 0.4
        p = c + (side * math.cos(a_) + unit(np.cross(ax, side)) * math.sin(a_)) * 0.235
        G.add(Sphere(tuple(p), 0.018), 0.004)
    del hang
    return G


def anchor_chain_points(Fb):
    """The anchor's chain over the left shoulder: from the ring at his back over the
    top of the shoulder, down across the chest to the harness ring."""
    rough = [ANCHOR_RING_B + np.array((0.0, -0.05, 0.08)), np.array((0.42, 0.38, 3.92)), np.array((0.36, 0.0, 3.98)),
             np.array((0.3, -0.36, 3.7)), np.array((0.18, -0.5, 3.4)), HARNESS_C + np.array((0.04, -0.02, 0.06))]
    out = []
    for p in rough:
        q, n = _project([Fb], p)
        out.append(q + n * 0.07)
    out[0] = ANCHOR_RING_B + np.array((0.0, -0.02, 0.06))
    dense = []
    for a_, b_ in zip(out, out[1:]):
        n_ = max(2, int(np.linalg.norm(b_ - a_) / 0.085))
        for i in range(n_):
            dense.append(lerp(a_, b_, i / n_))
    dense.append(out[-1])
    return dense


def build_anchor_chain(Fb, voxel):
    pts = anchor_chain_points(Fb)
    G = Field(np.min(pts, axis=0) - 0.15, np.max(pts, axis=0) + 0.15, voxel)
    for i, p in enumerate(pts):
        d = unit((pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]))
        side = unit(np.cross(d, (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)))
        axis = side if i % 2 == 0 else unit(np.cross(d, side))
        G.add(sdf.Torus(tuple(p), tuple(axis), 0.05, 0.018), 0.004)
    G.add(sdf.Torus(tuple(HARNESS_C + np.array((0.0, -0.06, 0.0))), (0.0, 1.0, 0.0), 0.085, 0.022), 0.006)
    return G


def build_cudgel(voxel):
    """The gaoler's cudgel, as two fields (the oak; the iron): a leather-bound grip
    and a knob at the butt, the head swelling to a heavy club bound with three iron
    bands and studded with nails, split and pitted."""
    lo, hi = (-0.3, -0.3, -CUDGEL_BELOW - 0.1), (0.3, 0.3, CUDGEL_END + 0.08)
    F = Field(lo, hi, voxel)
    H = Field(lo, hi, voxel)
    F.add(RoundCone((0, 0, -CUDGEL_BELOW + 0.04), (0, 0, CUDGEL_GRIP), 0.055, 0.058), 0.01)
    F.add(RoundCone((0, 0, CUDGEL_GRIP), (0, 0, CUDGEL_END - 0.12), 0.06, 0.17), 0.04)
    F.add(Ellipsoid((0, 0, CUDGEL_END - 0.12), (0.17, 0.17, 0.14)), 0.03)
    for z in np.linspace(-CUDGEL_BELOW + 0.08, CUDGEL_GRIP - 0.03, 6):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.06, 0.011), 0.004)
    F.groove(Polyline([(0.12, -0.08, 1.1), (0.14, -0.04, 1.35)], 0.004), 0.02, k=0.012)
    H.add(Ellipsoid((0, 0, -CUDGEL_BELOW), (0.08, 0.08, 0.06)), 0.02)
    for z in (0.75, 1.1, 1.42):
        r = 0.06 + (0.17 - 0.06) * (z - CUDGEL_GRIP) / (CUDGEL_END - 0.12 - CUDGEL_GRIP)
        H.add(sdf.Torus((0, 0, z), (0, 0, 1), r + 0.012, 0.024), 0.008)
    rng = np.random.default_rng(5)
    for k in range(22):
        z = rng.uniform(0.85, CUDGEL_END - 0.08)
        a_ = rng.uniform(0, math.tau)
        r = 0.06 + (0.17 - 0.06) * min(1.0, (z - CUDGEL_GRIP) / (CUDGEL_END - 0.12 - CUDGEL_GRIP))
        p = np.array((math.cos(a_) * r, math.sin(a_) * r, z))
        H.add(RoundCone(tuple(p * np.array((0.95, 0.95, 1))), tuple(p * np.array((1.28, 1.28, 1))), 0.022, 0.01), 0.004)
    return F, H


def anchor_shape(voxel):
    """A ship's anchor in its own frame (+Z from the crown up the shank to the ring,
    the arms and the stock in the X-Z plane): the ring, the stock, the shank, the
    crown and two curved arms ending in spade flukes; rusted and barnacled."""
    L_ = ANCHOR_SHANK
    G = Field((-0.62, -0.25, -0.2), (0.62, 0.25, L_ + 0.3), voxel)
    G.add(sdf.Torus((0, 0, L_ + 0.1), (0, 1, 0), 0.12, 0.03), 0.006)                     # the ring
    G.add(RoundCone((0, 0, 0.12), (0, 0, L_ - 0.02), 0.075, 0.055), 0.01)                # the shank
    G.add(Ellipsoid((0, 0, L_ - 0.01), (0.07, 0.07, 0.06)), 0.01)
    G.add(RoundCone((-0.42, 0, L_ - 0.16), (0.42, 0, L_ - 0.16), 0.045, 0.045), 0.01)     # the stock
    for s in (1, -1):
        G.add(Sphere((0.45 * s, 0, L_ - 0.16), 0.06), 0.01)
    G.add(Sphere((0, 0, 0.1), 0.11), 0.02)                                                # the crown
    for s in (1, -1):                                                                     # the arms
        arc = [(0.52 * s * math.sin(a), 0.0, 0.62 - 0.52 * math.cos(a)) for a in np.linspace(0.0, 1.15, 9)]
        G.add(Polyline(arc, 0.06), 0.02)
        tip = np.array(arc[-1])
        dirv = unit(np.array(arc[-1]) - np.array(arc[-3]))
        G.add(X.Inter(Ellipsoid(tuple(tip - dirv * 0.06), (0.16, 0.05, 0.14), frame_from(dirv)),
                      RoundBox(tuple(tip), (0.3, 0.06, 0.3), radius=0.0), 0.0), 0.02)       # the fluke
        G.add(RoundCone(tuple(tip + dirv * 0.03), tuple(tip + dirv * 0.16), 0.03, 0.004), 0.01)
    rng = np.random.default_rng(13)
    for k in range(14):                                                                   # barnacles
        t = rng.uniform(0.1, 0.9)
        p = np.array((rng.uniform(-0.04, 0.04), 0.0, 0.15 + t * (L_ - 0.4)))
        nrm = unit(np.array((rng.uniform(-1, 1), rng.choice((-1.0, 1.0)), 0.0)))
        barnacle(G, p + nrm * 0.055, nrm, rng.uniform(0.025, 0.045), 0.04, rng)
    noise = Noise(71)
    G.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 9, Y_ * 9, Z_ * 9, octaves=3), band=0.04)
    return G


def anchor_matrix_back():
    """The anchor on his back: ring behind the left shoulder, crown over the right
    hip, the arms flat against the back."""
    z = unit(ANCHOR_RING_B - ANCHOR_CROWN_B)
    y = unit(np.array((0.0, 1.0, 0.0)) - z * z[1])
    x = unit(np.cross(y, z))
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2] = x * ANCHOR_SCALE, y * ANCHOR_SCALE, z * ANCHOR_SCALE
    M[:3, 3] = ANCHOR_RING_B - z * (ANCHOR_SHANK + 0.1) * ANCHOR_SCALE
    return M


def anchor_matrix_hand():
    """The anchor in the left fist: the shank gripped just below the stock, the ring
    up out of the thumb side, the crown hanging below the little finger."""
    z = GRIP_L_AXIS
    _, down, width, palm = HAND.frame(1)
    y = unit(palm - z * (palm @ z))
    x = unit(np.cross(y, z))
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2] = x * ANCHOR_SCALE, y * ANCHOR_SCALE, z * ANCHOR_SCALE
    M[:3, 3] = GRIP_L - z * (ANCHOR_SHANK - 0.32) * ANCHOR_SCALE
    return M


def shackle_shape(voxel, held=False):
    """A shackle pair: two hinged iron cuffs on a short chain. Hanging (+Z up the
    chain from the cuffs), or held by the middle of the chain (the cuffs hanging
    either side of the fist)."""
    G = Field((-0.5, -0.3, -0.75), (0.5, 0.3, 0.3), voxel)
    if held:
        cuffs = [np.array((0.2, 0.0, -0.52)), np.array((-0.2, 0.0, -0.5))]
        chain = [np.array((0.19, 0.0, -0.4)), np.array((0.1, 0.0, -0.15)), np.array((0.0, 0.0, 0.02)),
                 np.array((-0.1, 0.0, -0.15)), np.array((-0.19, 0.0, -0.38))]
    else:
        cuffs = [np.array((0.06, 0.0, -0.58)), np.array((-0.08, 0.04, -0.66))]
        chain = [np.array((0.0, 0.0, 0.05)), np.array((0.03, 0.0, -0.2)), np.array((0.05, 0.0, -0.45))]
    for i, c in enumerate(cuffs):
        G.add(sdf.Torus(tuple(c), (0.3 * i, 1.0, 0.2), 0.11, 0.028, squash=1.5), 0.006)
        G.add(Sphere(tuple(c + np.array((0.0, 0.0, 0.11))), 0.03), 0.006)
    dense = []
    for a_, b_ in zip(chain, chain[1:]):
        for i in range(3):
            dense.append(lerp(a_, b_, i / 3))
    dense.append(chain[-1])
    for i, p in enumerate(dense):
        G.add(sdf.Torus(tuple(p), (1.0, 0.0, 0.0) if i % 2 else (0.0, 1.0, 0.0), 0.045, 0.014), 0.003)
    return G


def cudgel_matrix_hip():
    """The cudgel thrust through the belt at his right hip, its grip at the belt
    and the iron-bound head hanging down by his knee."""
    z = unit(np.array((-0.08, 0.12, -1.0)))
    x = unit(np.cross((0.0, 1.0, 0.0), z))
    y = unit(np.cross(z, x))
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2] = x, y, z
    M[:3, 3] = CUDGEL_HIP - z * 0.15
    return M


def shackle_matrix_hip():
    M = np.eye(4)
    M[:3, 3] = SHACKLE_HIP
    return M


def shackle_matrix_hand():
    z = -unit(HAND.frame(1)[1])                       # up the hand, from the fingers to the wrist
    _, down, width, palm = HAND.frame(1)
    x = unit(width - z * (width @ z))
    y = unit(np.cross(z, x))
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2] = x, y, z
    M[:3, 3] = GRIP_L
    return M


# ------------------------------------------------------------------ the tabard
def build_tabard(voxel):
    """The tabard: a front and a back panel hanging from the belt, heavy with water,
    torn ragged at the hem, holed and split."""
    F = Field((-0.48, -0.66, 0.85), (0.48, 0.66, 2.72), voxel)
    rng = np.random.default_rng(4)
    for sgn, nm in ((-1, 'F'), (1, 'B')):
        bot = np.array((0, 0.5 * sgn, 1.1 if sgn < 0 else 1.2))
        cyl_c = np.array((0, -0.05 * sgn if sgn < 0 else -0.2, 0))
        Rr = 0.68
        shell = X.Shell(RoundCone(cyl_c + np.array((0, 0, 0.5)), cyl_c + np.array((0, 0, 3.0)), Rr, Rr), 0.03)
        box = RoundBox((0, 0.6 * sgn, 1.85), (0.36, 0.3, 0.8), radius=0.02)
        prim = X.Inter(shell, box, 0.0, bone='Tab' + nm + '1')
        F.add(prim, 0.0, weight=False)
        # torn hem: long ragged tongues, and a split up the side
        for k in range(11):
            x = -0.36 + 0.072 * k + rng.uniform(-0.015, 0.015)
            zc = bot[2] + rng.uniform(-0.05, 0.22)
            F.sub(Ellipsoid((x, 0.62 * sgn, zc), (rng.uniform(0.018, 0.035), 0.2, rng.uniform(0.04, 0.1))), 0.008)

    noise = Noise(14)
    F.displace(lambda X_, Y_, Z_: 0.007 * noise.fbm(X_ * 5, Y_ * 2, Z_ * 1.2, octaves=3), band=0.05)
    return F


def tabard_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'TabF1', 'TabF2', 'TabB1', 'TabB2']
    W = np.zeros((len(P), 5))
    z = P[:, 2]
    front = P[:, 1] < 0
    t = np.clip((2.62 - z) / (2.62 - 1.05), 0, 1)
    hip = np.clip(1 - t / 0.08, 0, 1)
    low = np.clip((t - 0.4) / 0.3, 0, 1)
    low = low * low * (3 - 2 * low)
    up = (1 - hip) * (1 - low)
    lw = (1 - hip) * low
    W[:, 0] = hip
    W[front, 1] = up[front]
    W[front, 2] = lw[front]
    W[~front, 3] = up[~front]
    W[~front, 4] = lw[~front]
    W = R.relax(W, E, iters=3)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def build_belt(Fb, voxel):
    rg = X.ramp

    def bmask(X_, Y_, Z_):
        return rg(Z_, 2.55, 2.58) * (1 - rg(Z_, 2.7, 2.73))

    def buckle(G):
        G.add(RoundBox((0, -0.47, 2.64), (0.08, 0.025, 0.065), radius=0.012), 0.01)
        G.sub(RoundBox((0, -0.5, 2.64), (0.048, 0.03, 0.035), radius=0.006), 0.006)
        # a hanging pouch at the right hip
        G.add(RoundBox((-0.45, -0.18, 2.5), (0.06, 0.1, 0.11), rot_matrix(rz=0.5), radius=0.04), 0.02)
    return X.layer_field(Fb, (-0.62, -0.62, 2.36), (0.62, 0.62, 2.8), voxel, 0.08, 0.035, bmask, extra=buckle)


# ------------------------------------------------------------------ the key ring's frame
def axe_matrix():
    """Local axe frame (haft along +Z, the edge toward +X) into the armature: the grip
    in the right fist, the haft along WEAPON_AXIS, the edge turned forward of the
    knuckles (the way the blow lands)."""
    ax = np.array(WEAPON_AXIS)
    w, down, width, palm = HAND.frame(-1)
    edge = unit(np.cross(palm, ax))
    flat = unit(np.cross(ax, edge))
    M = np.eye(4)
    M[:3, 0] = edge
    M[:3, 1] = flat
    M[:3, 2] = ax
    M[:3, 3] = GRIP_R
    return M


# ------------------------------------------------------------------ barnacles and kelp
def _inside(f, p):
    hi = f.lo + (np.array(f.shape) - 1) * f.voxel
    return bool(np.all((p >= f.lo) & (p <= hi)))


def _project(fields, p, iters=6):
    """Pull a point onto the zero surface of the nearest of `fields`."""
    p = np.asarray(p, float).reshape(1, 3)
    for _ in range(iters):
        best = None
        for f in fields:
            if not _inside(f, p[0]):
                continue
            d = float(f.sample(p)[0])
            if best is None or abs(d) < abs(best[0]):
                best = (d, f)
        if best is None:
            break
        d, f = best
        p = p - f.gradient(p) * d
    for f in fields:
        if _inside(f, p[0]):
            return p[0], f.gradient(p)[0]
    return p[0], np.array((0, 0, 1.0))


def barnacle(G, base, n, r, h, rng):
    """One acorn barnacle: a ribbed cone on the surface, a crater at its top."""
    n = unit(n)
    h = min(h, r * 0.8)
    top = base + n * h
    G.add(RoundCone(base - n * 0.015, top, r, r * 0.66), 0.008)
    G.sub(Sphere(top + n * r * 0.3, r * 0.52), 0.005)
    F_ = frame_from(n)
    for k in range(6):
        a = math.tau * k / 6 + rng.uniform(0, 0.4)
        side = F_[:, 0] * math.cos(a) + F_[:, 1] * math.sin(a)
        G.ridge(Polyline([base + side * r * 0.98, top + side * r * 0.55], 0.002), 0.004, k=0.004)


def build_barnacles(spots, voxel):
    """Clusters of barnacles stuck to the plate, the helm, as
    (name, field, bone)."""
    rng = np.random.default_rng(23)
    out = []
    for name, centre, spread, count, size, bone, fields in spots:
        c = np.asarray(centre, float)
        G = Field(c - spread - 0.14, c + spread + 0.14, voxel)
        placed = 0
        tries = 0
        while placed < count and tries < count * 8:
            tries += 1
            q = c + rng.normal(0, spread * 0.5, 3)
            p, nrm = _project(fields, q)
            if np.linalg.norm(p - c) > spread * 1.15:
                continue
            r = size * rng.uniform(0.45, 1.0)
            barnacle(G, p, nrm, r, r * rng.uniform(0.55, 0.8), rng)
            placed += 1
        out.append((name, G, bone))
    return out


def ribbon(G, pts, nrms, width, th, rng, rag=0.35):
    """A kelp blade: flat overlapping slabs along a path, the flat facing `nrms`
    (the surface it lies on, or outward when it hangs free), tapering to a ragged tip."""
    pts = [np.asarray(p, float) for p in pts]
    n = len(pts)
    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        d = b - a
        L_ = float(np.linalg.norm(d))
        if L_ < 1e-4:
            continue
        d = d / L_
        nm = np.asarray(nrms[i], float)
        nm = unit(nm - d * (nm @ d))
        side = unit(np.cross(nm, d))
        Rm = np.stack([side, nm, d], axis=1)
        u = (i + 0.5) / (n - 1)
        w = width * (1.0 - 0.55 * u) * rng.uniform(1.0 - rag, 1.0)
        G.add(RoundBox((a + b) / 2, (w, th, L_ * 0.5 + 0.012), Rm, radius=th * 0.9), 0.012)


def surface_path(body, shells, pts, lift=0.022):
    """Lay a rough path on the figure: project each point onto the body field, then
    walk it out along the normal until it clears every plate in `shells`."""
    out, nrms = [], []
    for p in pts:
        q, n = _project([body], p)
        for _ in range(40):
            qq = q.reshape(1, 3)
            if not any(_inside(f, q) and float(f.sample(qq)[0]) < 0.004 for f in shells):
                break
            q = q + n * 0.008
        out.append(q + n * lift)
        nrms.append(n)
    return out, nrms


def hanging(start, length, sway, rng, n=6, out=(0, 0, 0)):
    pts = [np.asarray(start, float)]
    o = np.asarray(out, float)
    ph1, ph2 = rng.uniform(0, 3), rng.uniform(0, 3)
    for k in range(1, n):
        t = k / (n - 1)
        p = pts[0] + np.array((0, 0, -length * t)) + o * t * 0.6
        p = p + np.array((math.sin(t * 5 + ph1) * sway, math.cos(t * 4 + ph2) * sway, 0))
        pts.append(p)
    return pts


def build_kelp(voxel, Fb, Fh, pf):
    """Kelp hanging off the belt over the apron's sides and the hips, as
    (name, field, binding, bone, allow)."""
    rng = np.random.default_rng(41)
    out = []
    for s in (1, -1):
        G = Field(_m((0.75, -0.7, 1.6), s) - 0.45, _m((0.75, 0.6, 2.85), s) + 0.45, voxel)
        for k, (dy, L_) in enumerate(((-0.45, 0.55), (-0.15, 0.7), (0.22, 0.6))):
            s0 = np.array((0.7 * s, dy, 2.6))
            pts = hanging(s0, L_, 0.02, rng, n=6, out=(0.15 * s, 0.0, 0.0))
            ribbon(G, pts, [np.array((float(s), 0.0, 0.0))] * len(pts), 0.045, 0.009, rng)
        out.append((_side('KelpBelt', s), G, 'transfer', '', ('Hips', _side('Thigh', s))))
    return out


# ------------------------------------------------------------------ sculpt list
VOXEL_K = 1.0


def fields(k=1.0):
    global VOXEL_K
    from build_core import Sculpt
    VOXEL_K = k
    vb, vh, vhand, vp = 0.0125 * k, 0.0055 * k, 0.0055 * k, 0.0095 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    Fr = build_hand(-1, vhand, forearm=False)
    Fl = build_hand(1, vhand, forearm=False)
    S = [Sculpt('Body', Fb, 'flesh', 6200, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 2600, tau=0.02),
         Sculpt('R_Hand', Fr, 'flesh', 1400, tau=0.012),
         Sculpt('L_Hand', Fl, 'flesh', 1400, tau=0.012)]
    tu, tl = build_teeth(vh * 0.7)
    S.append(Sculpt('TeethUp', tu, 'tooth', 300, binding='rigid', bone='Head'))
    S.append(Sculpt('TeethLow', tl, 'tooth', 240, binding='rigid', bone='Jaw'))
    plate_fields = {}
    for name, G, binding, bone, allow in plates(Fb, Fh, Fl, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        if key != 'Vambrace':
            continue
        plate_fields[name] = G
        S.append(Sculpt(name, G, 'leather', 600, binding=binding, bone=bone, allow=allow, relax=8))
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Fb, vp, s), 'breech', 900, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
        S.append(Sculpt(_side('Boot', s), build_boot(Fb, vp, s), 'leather', 1300, binding='transfer',
                        allow=(_side('Shin', s), _side('Foot', s), _side('Toes', s)), relax=6))
        S.append(Sculpt(_side('Manacle', s), build_manacle(0.005 * k, s), 'steel', 1300, binding='rigid',
                        bone=_side('Forearm', s)))
    Gb = build_brank(0.0045 * k)
    S.append(Sculpt('Brank', Gb, 'steel', 2600, binding='rigid', bone='Head'))
    Gharn = build_harness(Fb, vp)
    S.append(Sculpt('Harness', Gharn, 'leather', 2400, binding='transfer', allow=('Spine1', 'Spine2', 'Hips',
                                                                                    'L_Clavicle', 'R_Clavicle'), relax=6))
    S.append(Sculpt('AnchorChain', build_anchor_chain(Fb, 0.0045 * k), 'steel', 2200, binding='rigid', bone='Spine2'))
    S.append(Sculpt('Kilt', build_tabard(vp), 'apron', 1800, binding='own', weigh=tabard_weights))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'leather', 900, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, binding, bone, allow in build_kelp(0.006 * k, Fb, Fh, plate_fields):
        S.append(Sculpt(name, G, 'kelp', 500, binding=binding, bone=bone, allow=allow, relax=4))
    c_l = _m(SHOULDER, 1) + np.array((0.06, 0.0, 0.08))
    c_r = _m(SHOULDER, -1) + np.array((-0.06, 0.0, 0.08))
    spots = [
        ('BarnShoulderL', c_l + np.array((0.12, 0.06, 0.16)), 0.3, 16, 0.085, 'L_UpperArm', [Fb]),
        ('BarnShoulderR', c_r + np.array((-0.14, 0.1, 0.12)), 0.28, 13, 0.08, 'R_UpperArm', [Fb]),
        ('BarnHump', (0.0, 0.5, 3.66), 0.32, 18, 0.09, 'Spine2', [Fb]),
        ('BarnBack', (-0.2, 0.62, 3.0), 0.26, 10, 0.075, 'Spine2', [Fb]),
        ('BarnArmR', lerp(_m(ELBOW, -1), _m(WRIST, -1), 0.4) + np.array((-0.2, 0.08, 0.0)), 0.16, 7, 0.06, 'R_Forearm',
         [Fb]),
        ('BarnHead', (0.2, 0.1, 4.36), 0.12, 6, 0.05, 'Head', [Fh]),
    ]
    for name, G, bone in build_barnacles(spots, 0.004 * k):
        S.append(Sculpt(name, G, 'barnacle', 1100 if name.startswith(('BarnHump', 'BarnShoulder')) else 700,
                        binding='rigid', bone=bone))
    return S


def weapon_point(p):
    return (axe_matrix() @ np.array((p[0], p[1], p[2], 1.0)))[:3]


def _at(M, p):
    return (M @ np.array((p[0], p[1], p[2], 1.0)))[:3]


# The effect anchors the game reads (kit/anchors.py prints them in the game's terms).
ANCHORS = {
    'brank': ('Head', head_map(np.array((0.0, -0.32, 4.1)))),
    'cudgel': ('Weapon', weapon_point((0.0, 0.0, CUDGEL_END - 0.1))),
    'anchorBack': ('AnchorB', _at(anchor_matrix_back(), (0.0, 0.0, 0.1))),
    'anchorHand': ('AnchorH', _at(anchor_matrix_hand(), (0.0, 0.0, 0.1))),
    'shackleHand': ('ShackleH', GRIP_L + np.array((0.0, 0.0, -0.4))),
    'manacleL': ('L_Forearm', lerp(ELBOW, WRIST, 0.84) + np.array((0.0, 0.0, -0.4))),
    'chest': ('Spine2', np.array((0.0, -0.62, 3.0))),
    'eyes': ('Head', head_map(np.array((0.0, -0.3, 4.205)))),
}
