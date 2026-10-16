"""Drowned Sergeant: skeleton and sculpts (rest pose), in yards.

The wall watch's sergeant, drowned at his post with his men and still driving them:
a barrel-chested brute of a drowned body under the heaviest plate on the wall. A
closed barbute with a T-slit, sea light burning in the slit and in the slot of the
mouth, a ragged kelp plume trailing from its crest; huge layered pauldrons crusted
with barnacles, a keeled breastplate with the sergeant's faded sash across it, both
forearms in vambraces, the Bastion's tabard, and a heavy bearded boarding axe.

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

NAME = 'DrownedSergeant'
PREFIX = 'sergeant'
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

# ------------------------------------------------------------------ the boarding axe
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.2 + _p * 0.07               # the centre of the right fist on the haft
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))         # the haft runs through the fist
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.2 + _pl * 0.07)
HAFT_BELOW, HAFT_ABOVE = 0.38, 1.78               # butt and head-top distances from the right fist
AXE_TOP, AXE_HEEL = HAFT_ABOVE - 0.06, HAFT_ABOVE - 0.42
AXE_EDGE = 0.6                                    # the edge's reach out from the haft (+X)


# The head, the helm and everything on them are sculpted at the kit soldier's size
# and then grown about the base of the neck (post_mesh): a heavier, more readable
# head under the camera, the way the game's figures carry theirs.
HEAD_SCALE = 1.13
HEAD_PIVOT = np.array((0.0, 0.02, 3.6))
HEAD_DROP = 0.07
HEAD_PARTS = ('Head', 'TeethUp', 'TeethLow', 'Helm', 'KelpHelm', 'Hair', 'BarnHelm', 'Eyes')


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
        # the sodden tabard, front and back panels
        ('TabF1', 'Hips', (0, -0.42, 2.6), (0, -0.46, 1.86)),
        ('TabF2', 'TabF1', (0, -0.46, 1.86), (0, -0.47, 1.1)),
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
WEAPON_PROBES = (-HAFT_BELOW, 0.6, 1.2, AXE_HEEL, HAFT_ABOVE)
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
    F = Field((-1.15, -0.75, -0.05), (1.15, 0.75, 4.02), voxel)
    F.add(Ellipsoid((0, 0.04, 2.44), (0.44, 0.31, 0.3), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, -0.01, 2.8), (0.46, 0.36, 0.35), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, -0.02, 3.2), (0.68, 0.47, 0.47), rot_matrix(rx=-0.06), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.14, 3.38), (0.58, 0.3, 0.31), bone='Spine2'), 0.16)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.23, -0.2, 3.3), s), (0.25, 0.14, 0.18), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.12, 3.54), s), _m((0.5, 0.08, 3.58), s), 0.16, 0.14, bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.38, 0.08, 3.06), s), (0.2, 0.24, 0.34), bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.19, 0.2, 2.36), s), (0.23, 0.2, 0.24), bone='Hips'), 0.12)
    F.add(RoundCone((0, 0.05, 3.5), (0, 0.0, 3.98), 0.2, 0.15, bone='Neck'), 0.12)

    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.03 * s, 0, 0.0)), 0.22, bone=up), 0.1)
        F.add(RoundCone(sh, el, 0.19, 0.145, bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.5) + np.array((0, -0.06, 0)), (0.12, 0.12, 0.22), _rot(sh, el), bone=up), 0.06)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.12, bone=_side('ElbowFix', s)), 0.08)
        # both forearms, under their vambraces
        F.add(RoundCone(el, lerp(el, wr, 0.35), 0.15, 0.165, bone=fo), 0.08)
        F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.165, 0.11, bone=fo), 0.08)

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
        lo = np.minimum(w - down * 0.1, w + down * 0.55) - 0.2
        hi = np.maximum(w - down * 0.1, w + down * 0.55) + 0.2
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
    F.add(RoundBox(w + down * 0.13, (0.085, 0.034, 0.085), Rm, radius=0.037, bone=hand), 0.035)
    F.add(Ellipsoid(w + down * 0.08 + width * 0.05 + palm * 0.035, (0.055, 0.045, 0.072), Rm, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = (HAND.fingers[f][4] if f != 'Thumb' else 0.04) * (1.12 if forearm else 1.0)
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
        G.add(RoundCone((0, -0.43, 2.68), (0, -0.46, 3.18), 0.025, 0.02), 0.04)
        G.add(RoundCone((0, -0.46, 3.18), (0, -0.4, 3.44), 0.02, 0.015), 0.04)
        ring = [(0.47 * math.sin(a), 0.03 - 0.45 * math.cos(a), 2.635) for a in np.linspace(-math.pi, math.pi, 41)]
        G.add(Polyline(ring, 0.02), 0.012)
        for p in ((-0.2, -0.42, 3.42), (0.2, -0.42, 3.42), (-0.36, -0.3, 2.68), (0.36, -0.3, 2.68),
                  (-0.43, -0.12, 2.66), (0.43, -0.12, 2.66)):
            G.add(Sphere(p, 0.02), 0.008)
        # dents from the rocks and an old spear hole, rusted through
        _dents(G, [((0.22, -0.56, 3.08), 0.12, 0.02), ((-0.26, -0.55, 2.84), 0.1, 0.018),
                   ((0.05, -0.58, 2.78), 0.09, 0.015), ((-0.18, 0.6, 3.2), 0.12, 0.02)])
        G.sub(Ellipsoid((0.25, -0.47, 2.9), (0.045, 0.1, 0.035), rot_matrix(rz=0.3)), 0.006)
        G.groove(Polyline([(-0.12, -0.47, 3.34), (-0.2, -0.45, 3.22), (-0.27, -0.42, 3.15)], 0.004), 0.022, k=0.012)
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


def build_helm(Fh, voxel):
    """A barbute: a closed, rounded helm down over the jaw and the nape, a raised
    keel over the crown, the face shut behind a T-slit (the eye slit across, the
    slot down to the chin), its edges rolled, a flared rim round the neck and a
    plume socket at the back of the crown. Rigid on the head."""
    rg = X.ramp

    def mask(X_, Y_, Z_):
        m = rg(Z_, 3.86, 3.92)
        front = rg(-Y_, 0.05, 0.12)
        slit = rg(Z_, 4.165, 4.18) * (1 - rg(Z_, 4.225, 4.24)) * rg(np.abs(X_), 0.17, 0.155)
        slot = rg(Z_, 3.92, 3.94) * (1 - rg(Z_, 4.19, 4.21)) * rg(np.abs(X_), 0.032, 0.022)
        return m * (1 - front * np.maximum(slit, slot))

    def off(X_, Y_, Z_):
        return 0.04

    def extra(G):
        crest = [(0, -0.01 + 0.34 * math.sin(a), 4.24 + 0.33 * math.cos(a)) for a in np.linspace(-1.3, 1.3, 15)]
        G.add(Polyline(crest, 0.026), 0.03)
        # the flared rim round the neck
        ring = [(0.3 * math.cos(a), -0.04 + 0.32 * math.sin(a), 3.88) for a in np.linspace(-math.pi, math.pi, 41)]
        G.add(Polyline(ring, 0.022), 0.015)
        # rivets round the brow, the plume socket at the back of the crown
        for a in np.linspace(-1.0, 1.0, 9):
            G.add(Sphere((0.35 * math.sin(a), -0.0 - 0.38 * math.cos(a), 4.3), 0.017), 0.004)
        G.add(RoundCone((0, 0.3, 4.44), (0, 0.36, 4.54), 0.05, 0.04), 0.02)
        _dents(G, [((0.24, -0.2, 4.4), 0.06, 0.008), ((-0.27, 0.12, 4.32), 0.07, 0.008)])
    # a smooth form round the head (not the face's own bumps): the crown and the jaw
    S_ = Field((-0.45, -0.5, 3.6), (0.45, 0.45, 4.7), voxel)
    S_.add(Ellipsoid((0, 0.0, 4.22), (0.27, 0.3, 0.26)), 0.0)
    S_.add(Ellipsoid((0, -0.04, 4.0), (0.25, 0.27, 0.21)), 0.1)
    G = X.layer_field(S_, (-0.48, -0.5, 3.75), (0.48, 0.52, 4.8), voxel, off, 0.04, mask, extra=extra)
    noise = Noise(33)
    G.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=2), band=0.05)
    return G


# ------------------------------------------------------------------ the sergeant's sash
SASH_N = unit(np.array((0.75, 0.0, -0.66)))
SASH_C = np.array((0.0, 0.0, 3.05))


def build_sash(Fb, cuirass, voxel):
    """The sergeant's sash: a broad band of faded cloth over the left shoulder and
    across the breast and the back to the right hip, lying over the plate, a knot
    and two torn tails at the right hip."""
    rg = X.ramp
    base = _Union(Fb, cuirass)

    def mask(X_, Y_, Z_):
        d = (X_ - SASH_C[0]) * SASH_N[0] + (Z_ - SASH_C[2]) * SASH_N[2]
        return rg(np.abs(d), 0.11, 0.08) * rg(Z_, 2.5, 2.56) * (1 - rg(Z_, 3.82, 3.88))

    def knot(G):
        k = np.array((-0.5, -0.24, 2.62))
        G.add(Ellipsoid(k, (0.09, 0.07, 0.08)), 0.03)
        for dx, L_ in ((0.04, 0.42), (-0.06, 0.32)):
            G.add(RoundBox(k + np.array((dx, -0.04, -L_ * 0.5 - 0.04)), (0.055, 0.014, L_ * 0.5), radius=0.012), 0.02)
    G = X.layer_field(base, (-0.85, -0.7, 2.0), (0.85, 0.7, 3.95), voxel, 0.02, 0.03, mask, extra=knot)
    noise = Noise(61)
    G.displace(lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.04)
    return G


# ------------------------------------------------------------------ the tabard
def build_tabard(voxel):
    """The tabard: a front and a back panel hanging from the belt, heavy with water,
    torn ragged at the hem, holed and split."""
    F = Field((-0.48, -0.66, 0.85), (0.48, 0.66, 2.72), voxel)
    rng = np.random.default_rng(4)
    for sgn, nm in ((-1, 'F'), (1, 'B')):
        bot = np.array((0, 0.5 * sgn, 1.1 if sgn < 0 else 1.2))
        cyl_c = np.array((0, -0.25 * sgn, 0))
        Rr = 0.68
        shell = X.Shell(RoundCone(cyl_c + np.array((0, 0, 0.5)), cyl_c + np.array((0, 0, 3.0)), Rr, Rr), 0.03)
        box = RoundBox((0, 0.43 * sgn, 1.85), (0.27, 0.4, 0.8), radius=0.02)
        prim = X.Inter(shell, box, 0.0, bone='Tab' + nm + '1')
        F.add(prim, 0.0, weight=False)
        # torn hem: long ragged tongues, and a split up the side
        for k in range(11):
            x = -0.27 + 0.054 * k + rng.uniform(-0.015, 0.015)
            zc = bot[2] + rng.uniform(-0.05, 0.22)
            F.sub(Ellipsoid((x, 0.45 * sgn, zc), (rng.uniform(0.018, 0.04), 0.2, rng.uniform(0.07, 0.2))), 0.008)
        F.sub(RoundBox((0.16 * sgn, 0.45 * sgn, bot[2] + 0.25), (0.01, 0.2, 0.3), radius=0.004), 0.006)
        for k in range(4):
            F.sub(Sphere((rng.uniform(-0.2, 0.2), 0.45 * sgn, rng.uniform(1.35, 1.75)), rng.uniform(0.02, 0.045)), 0.01)
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


# ------------------------------------------------------------------ the axe (local frame: +Z up the haft)
def build_axe(voxel):
    """A heavy bearded boarding axe, as two fields (the ash haft; the iron): the haft
    with a wrapped grip and an iron butt knob, iron langets under the head; the head
    a broad bearded blade (edge +X) whose beard sweeps down along the haft, a hooked
    back spike and a short top spike. Rust-pitted and nicked."""
    lo, hi = (-0.45, -0.12, -HAFT_BELOW - 0.15), (AXE_EDGE + 0.12, 0.12, HAFT_ABOVE + 0.25)
    F = Field(lo, hi, voxel)
    H = Field(lo, hi, voxel)
    F.add(RoundCone((0, 0, -HAFT_BELOW), (0, 0, HAFT_ABOVE - 0.02), 0.05, 0.044), 0.01)
    for z in np.linspace(-0.22, 0.24, 6):                     # the grip's wraps
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.052, 0.01), 0.004)
    H.add(Ellipsoid((0, 0, -HAFT_BELOW - 0.03), (0.07, 0.07, 0.08)), 0.02)
    for s in (1, -1):                                         # the langets
        H.add(RoundBox((0.0, 0.047 * s, AXE_HEEL - 0.25), (0.022, 0.008, 0.3), radius=0.005), 0.006)
    H.add(sdf.Torus((0, 0, AXE_HEEL - 0.55), (0, 0, 1), 0.052, 0.012), 0.005)
    # the eye round the haft and the blade
    H.add(RoundBox((0.02, 0, (AXE_TOP + AXE_HEEL) / 2 + 0.04), (0.08, 0.065, (AXE_TOP - AXE_HEEL) / 2 + 0.02),
                   radius=0.02), 0.02)
    H.add(_AxeHead(), 0.012)
    H.add(RoundCone((-0.06, 0, AXE_TOP - 0.13), (-0.36, 0, AXE_TOP - 0.24), 0.045, 0.006), 0.02)
    H.add(RoundCone((0.0, 0, HAFT_ABOVE - 0.02), (0.0, 0, HAFT_ABOVE + 0.18), 0.035, 0.004), 0.015)
    rng = np.random.default_rng(8)
    for k in range(7):                                        # nicks in the edge
        z = rng.uniform(AXE_HEEL - 0.25, AXE_TOP - 0.04)
        H.sub(Sphere((float(_AxeHead.edge_x(z)) + 0.01, 0, z), rng.uniform(0.012, 0.028)), 0.004)
    for k in range(10):                                       # pits in the flats
        H.sub(Sphere((rng.uniform(0.12, 0.45), 0.024 * (1 if k % 2 else -1), rng.uniform(AXE_HEEL - 0.1, AXE_TOP - 0.05)),
                     rng.uniform(0.008, 0.016)), 0.003)
    return F, H


class _AxeHead(sdf.Prim):
    """The bearded blade in the axe frame (X-Z plane, thin in Y): straight along the
    top, its lower line sweeping down into the beard, the edge a long shallow curve;
    thick at the eye and thinning to the edge."""

    @staticmethod
    def edge_x(Z_):
        u = np.clip((Z_ - (AXE_HEEL - 0.32)) / (AXE_TOP - AXE_HEEL + 0.32), 0, 1)
        return AXE_EDGE - 0.07 * (2 * u - 1) ** 2 + 0.02 * u

    def __init__(self):
        self.bone = None
        self.lo = np.array((0.0, -0.06, AXE_HEEL - 0.4))
        self.hi = np.array((AXE_EDGE + 0.06, 0.06, AXE_TOP + 0.06))

    def dist(self, X_, Y_, Z_):
        x = np.clip(X_ / AXE_EDGE, 0, 1)
        top = AXE_TOP - 0.03 * x
        bot = AXE_HEEL + 0.02 - 0.34 * x ** 1.6               # the beard
        ex = self.edge_x(Z_)
        th = 0.032 - 0.026 * np.clip(X_ / ex, 0, 1) ** 1.4
        d = np.maximum(np.maximum(0.04 - X_, X_ - ex), np.maximum(Z_ - top, bot - Z_))
        return np.maximum(d, np.abs(Y_) - th)


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
    """Kelp lying over the pauldrons and down the arms, over the belt and the tassets,
    a few blades off the brim, and weed-hair over the nape, as
    (name, field, binding, bone, allow)."""
    rng = np.random.default_rng(41)
    out = []
    # the plume: a ragged spray of kelp blades out of the crest socket, arching back
    # and falling down the back of the helm, rigid on the head
    G = Field((-0.5, -0.1, 3.55), (0.5, 0.95, 4.85), voxel)
    sock = np.array((0.0, 0.36, 4.52))
    for k, (dx, L_, arch) in enumerate(((0.0, 0.85, 0.22), (-0.09, 0.7, 0.18), (0.09, 0.74, 0.2),
                                        (-0.17, 0.52, 0.14), (0.17, 0.56, 0.15), (0.04, 0.6, 0.26))):
        pts, nr = [], []
        for t_ in np.linspace(0, 1, 9):
            p = sock + np.array((dx * t_ * 1.6, arch * math.sin(t_ * math.pi * 0.6) + 0.18 * t_,
                                 0.1 * math.sin(t_ * math.pi * 0.5) - L_ * t_ ** 1.5))
            p = p + np.array((0.02 * math.sin(t_ * 7 + k), 0.0, 0.0))
            pts.append(p)
            nr.append(unit(np.array((dx * 2, 1.0, 0.4 - t_))))
        ribbon(G, pts, nr, 0.05 - 0.004 * k, 0.009, rng, rag=0.45)
    out.append(('KelpHelm', G, 'rigid', 'Head', None))
    # draped over each pauldron, down the outside of the arm toward the elbow
    for s in (1, -1):
        c = _m(SHOULDER, s) + np.array((0.04 * s, 0.0, 0.05))
        fl = [pf[_side('Pauldron', s)], pf[_side('PauldronLame1', s)], pf[_side('PauldronLame2', s)]]
        G = Field(c + np.array((-0.7, -0.7, -1.0)), c + np.array((0.7, 0.7, 0.5)), voxel)
        el = _m(ELBOW, s)
        for k, dy in enumerate((-0.14, 0.04, 0.2)):
            if s < 0 and k == 1:
                continue
            rough = [c + np.array((0.08 * s, dy, 0.3)), c + np.array((0.22 * s, dy, 0.3)),
                     c + np.array((0.36 * s, dy, 0.12)), c + np.array((0.42 * s, dy * 0.8, -0.14)),
                     c + np.array((0.44 * s, dy * 0.6, -0.36)), lerp(c, el, 0.62) + np.array((0.2 * s, dy * 0.4, 0)),
                     lerp(c, el, 0.85) + np.array((0.18 * s, dy * 0.3, 0))]
            pts, nr = surface_path(Fb, fl, rough, 0.024)
            ribbon(G, pts, nr, 0.05 - 0.008 * k, 0.009, rng)
        out.append((_side('KelpShoulder', s), G, 'transfer', '', (_side('UpperArm', s), _side('Clavicle', s))))
    # over the belt and down the tassets
    for s in (1, -1):
        fl = [pf[_side('Tasset', s)], pf['Faulds']]
        G = Field(_m((0.5, -0.5, 1.6), s) - 0.4, _m((0.5, 0.5, 2.85), s) + 0.4, voxel)
        for k, (dy, L_) in enumerate(((-0.3, 0.6), (-0.08, 0.75))):
            rough = [np.array((0.42 * s, dy, 2.72)) + np.array((0.08 * s * t, 0, -L_ * t)) for t in np.linspace(0, 1, 7)]
            pts, nr = surface_path(Fb, fl, rough, 0.026)
            ribbon(G, pts, nr, 0.05, 0.009, rng)
        out.append((_side('KelpBelt', s), G, 'transfer', '', ('Hips', _side('Thigh', s))))
    return out


# ------------------------------------------------------------------ sculpt list
VOXEL_K = 1.0


def fields(k=1.0):
    global VOXEL_K
    from build_core import Sculpt
    VOXEL_K = k
    vb, vh, vhand, vp = 0.0125 * k, 0.0055 * k, 0.005 * k, 0.0095 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    Fr = build_hand(-1, vhand, forearm=False)
    Fl = build_hand(1, vhand, forearm=False)
    face = [((0, -0.2, 4.12), 0.12, 1.0)]
    S = [Sculpt('Body', Fb, 'mail', 4200, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 4200, spots=face, tau=0.02),
         Sculpt('R_Gauntlet', Fr, 'gauntlet', 1200, tau=0.012),
         Sculpt('L_Gauntlet', Fl, 'gauntlet', 1200, tau=0.012)]
    tu, tl = build_teeth(vh * 0.7)
    S.append(Sculpt('TeethUp', tu, 'tooth', 300, binding='rigid', bone='Head'))
    S.append(Sculpt('TeethLow', tl, 'tooth', 240, binding='rigid', bone='Jaw'))
    targets = {'Cuirass': 2600, 'Faulds': 900, 'Gorget': 500, 'Pauldron': 1300, 'PauldronLame1': 450,
               'PauldronLame2': 450, 'PauldronLame3': 450, 'Couter': 400, 'Vambrace': 500, 'Tasset': 400,
               'Poleyn': 400}
    plate_fields = {}
    for name, G, binding, bone, allow in plates(Fb, Fh, Fl, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        plate_fields[name] = G
        S.append(Sculpt(name, G, 'plate', targets[key], binding=binding, bone=bone, allow=allow, relax=8))
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Fb, vp, s), 'breech', 900, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
        S.append(Sculpt(_side('Boot', s), build_boot(Fb, vp, s), 'leather', 1300, binding='transfer',
                        allow=(_side('Shin', s), _side('Foot', s), _side('Toes', s)), relax=6))
    Gh = build_helm(Fh, vh * 1.25)
    S.append(Sculpt('Helm', Gh, 'plate', 2600, binding='rigid', bone='Head'))
    S.append(Sculpt('Sash', build_sash(Fb, plate_fields['Cuirass'], vp), 'sash', 1400, binding='transfer',
                    allow=('Spine1', 'Spine2', 'Hips', 'L_Clavicle'), relax=6))
    S.append(Sculpt('Tabard', build_tabard(vp), 'cloth', 1500, binding='own', weigh=tabard_weights))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'leather', 700, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, binding, bone, allow in build_kelp(0.006 * k, Fb, Fh, plate_fields):
        S.append(Sculpt(name, G, 'kelp', 500 if name.startswith('Kelp') else 420, binding=binding, bone=bone,
                        allow=allow, relax=4))
    # barnacle clusters, each stuck to its own plate
    c_l = _m(SHOULDER, 1) + np.array((0.04, 0.0, 0.05))
    c_r = _m(SHOULDER, -1) + np.array((-0.04, 0.0, 0.05))
    spots = [
        ('BarnPauldronL', c_l + np.array((0.26, 0.08, 0.24)), 0.3, 15, 0.08, 'L_UpperArm', [plate_fields['L_Pauldron']]),
        ('BarnPauldronR', c_r + np.array((-0.22, 0.14, 0.22)), 0.26, 12, 0.075, 'R_UpperArm',
         [plate_fields['R_Pauldron']]),
        ('BarnBack', (0.16, 0.5, 3.1), 0.26, 11, 0.08, 'Spine2', [plate_fields['Cuirass']]),
        ('BarnBreast', (-0.3, -0.42, 2.8), 0.14, 5, 0.06, 'Spine1', [plate_fields['Cuirass']]),
        ('BarnHelm', (0.22, 0.1, 4.4), 0.15, 7, 0.055, 'Head', [Gh]),
        ('BarnKneeR', _m(KNEE, -1) + np.array((0.0, -0.18, 0.04)), 0.1, 4, 0.05, 'R_KneeFix',
         [plate_fields['R_Poleyn']]),
    ]
    for name, G, bone in build_barnacles(spots, 0.004 * k):
        S.append(Sculpt(name, G, 'barnacle', 1100 if name in ('BarnPauldronL', 'BarnBack') else 700, binding='rigid',
                        bone=bone))
    return S


def _axe_point(p):
    return (axe_matrix() @ np.array((p[0], p[1], p[2], 1.0)))[:3]


# The effect anchors the game reads (kit/anchors.py prints them in the game's terms).
ANCHORS = {
    'visor': ('Head', head_map(np.array((0.0, -0.36, 3.95)))),
    'helmL': ('Head', head_map(np.array((0.3, -0.05, 3.9)))),
    'helmR': ('Head', head_map(np.array((-0.3, -0.05, 3.9)))),
    'plume': ('Head', head_map(np.array((0.0, 0.62, 3.95)))),
    'axe': ('Weapon', _axe_point((AXE_EDGE * 0.7, 0.0, AXE_HEEL - 0.2))),
    'chest': ('Spine2', np.array((0.0, -0.55, 3.05))),
    'eyes': ('Head', head_map(np.array((0.0, -0.3, 4.2)))),
}
