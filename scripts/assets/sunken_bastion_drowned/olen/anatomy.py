"""Knight-Commander Olen: skeleton and sculpts (rest pose), in yards.

The Bastion's knight-commander, drowned on the wall with his oath unbroken and
risen to keep it, the officer the drowned garrison still serves: a towering
barrel-chested body in the finest plate on the wall, fluted and trimmed with
tarnished brass, the Bastion's tower-over-waves raised in brass on the breast; a
grand morion (the garrison's helm, a commander's) with a tall comb crowned by a
crest of faded crimson horsehair, a bevor up to the cheekbones and sea light
burning in the shadow between them; a commander's cloak torn to the calves; a
great tower shield on the left forearm crusted with barnacles under the brass
sigil, and a broad longsword with a brass hilt.

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

NAME = 'CommanderOlen'
PREFIX = 'olen'
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
GRIP_BELOW, GUARD_Z, BLADE_END = 0.36, 0.17, 2.15      # pommel, crossguard and point along the sword
BLADE_W = 0.1                                           # the blade's half width at the guard
# The tower shield, in its own frame (+Y up the board, +Z out of its face): strapped
# along the outside of the left forearm, the elbow near the top third.
SHIELD_TOP, SHIELD_FOOT, SHIELD_W = 0.92, -1.28, 0.52   # the board's top, foot and half width
SHIELD_BOW = 0.17                                       # how far the board's edges curl back
SHIELD_DROP = -0.12                                     # the board's centre below the fist


_wl0, _dl0, _wdl0, _pl0 = HAND.frame(1)
GRIP_L_FIST = _wl0 + _dl0 * 0.2 + _pl0 * 0.07           # the centre of the left fist (the shield's grip)


# The head, the helm and everything on them are sculpted at the kit soldier's size
# and then grown about the base of the neck (post_mesh): a heavier, more readable
# head under the camera, the way the game's figures carry theirs.
HEAD_SCALE = 1.13
HEAD_PIVOT = np.array((0.0, 0.02, 3.6))
HEAD_DROP = 0.07
HEAD_PARTS = ('Head', 'Helm', 'HelmTrim', 'Bevor', 'Crest', 'BarnHelm', 'Eyes')


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


def _shield_up():
    """The board's up through the left fist (shield_matrix's +Y)."""
    _w, down, width, _palm = HAND.frame(1)
    return unit(width + down * 0.3)


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
        # the tower shield on its own never-turned bone in the left fist, so a clip
        # can hide it by a keyed scale (ShieldThrow hurls it, ShieldCatch takes it back)
        ('Shield', 'L_Hand', tuple(GRIP_L_FIST), tuple(GRIP_L_FIST + _shield_up() * 0.5)),
        # the sodden tabard, front and back panels
        ('TabF1', 'Hips', (0, -0.42, 2.6), (0, -0.46, 1.86)),
        ('TabF2', 'TabF1', (0, -0.46, 1.86), (0, -0.47, 1.1)),
        # the commander's cloak down the back, three links
        ('Cape1', 'Spine2', (0, 0.48, 3.5), (0, 0.66, 2.7)),
        ('Cape2', 'Cape1', (0, 0.66, 2.7), (0, 0.76, 1.8)),
        ('Cape3', 'Cape2', (0, 0.76, 1.8), (0, 0.84, 0.9)),
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
WEAPON_PROBES = (-GRIP_BELOW, 0.6, 1.3, BLADE_END)
COLLIDE_LEGS = {'L_Thigh': 0.38, 'R_Thigh': 0.38, 'L_Shin': 0.28, 'R_Shin': 0.28}


def _chains():
    from rig import Chain
    return [
        Chain(['TabF1', 'TabF2'], 'Hips', gravity=0.6, stiff=0.18, damp=0.2, drag=0.85, collide=True),
        Chain(['Cape1', 'Cape2', 'Cape3'], 'Spine2', gravity=0.7, stiff=0.14, damp=0.22, drag=0.85, collide=True),
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
        for x0 in (-0.3, -0.2, -0.1, 0.1, 0.2, 0.3):                    # the fluting
            G.ridge(Polyline([(x0 * 1.15, -0.5 + abs(x0) * 0.25, 3.36), (x0 * 0.45, -0.52, 2.95),
                              (x0 * 0.25, -0.47, 2.7)], 0.004), 0.012, k=0.014)
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
        big = 1.4 if s > 0 else 1.32
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

    # cuisses down the front of the thighs, under the tassets
    for s in (1, -1):
        def cmask_(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'HIP', 'KNEE')
            return rg(u, 0.3, 0.36) * (1 - rg(u, 0.86, 0.92)) * rg(-Y_, -0.06, 0.04) * rg(d, 0.42, 0.36)

        def cridge(G, s=s):
            hp, kn_ = _m(HIP, s), _m(KNEE, s)
            G.add(Polyline([lerp(hp, kn_, 0.4) + np.array((0, -0.3, 0)), lerp(hp, kn_, 0.85) + np.array((0, -0.24, 0))],
                           0.012), 0.02)
        plate(_side('Cuisse', s), Fb, np.array((min(0, 0.62 * s) - 0.02, -0.6, 1.2)),
              np.array((max(0, 0.62 * s) + 0.02, 0.3, 2.1)), 0.05, 0.04, cmask_,
              allow=(_side('Thigh', s), _side('KneeFix', s)), extra=cridge)

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
    """Greave and sabaton: plate closed round the shin from under the poleyn to the
    ankle, a ridge down its front and a rolled top, the sabaton's lames over the
    foot."""
    rg = X.ramp
    an = _m(ANKLE, s)

    def mask(X_, Y_, Z_):
        near = rg(np.abs(X_ - an[0]), 0.36, 0.3)
        return (1 - rg(Z_, 1.13, 1.17)) * rg(Z_, 0.012, 0.03) * near

    def off(X_, Y_, Z_):
        return 0.03 + 0.02 * np.clip((Z_ - 0.85) / 0.3, 0, 1)

    def extra(G):
        G.add(Polyline([(an[0], -0.2, 1.1), (an[0], -0.215, 0.75), (an[0], -0.19, 0.45)], 0.014), 0.02)
        ring = [(an[0] + 0.205 * math.sin(a), 0.02 - 0.205 * math.cos(a), 1.13) for a in np.linspace(-math.pi, math.pi, 25)]
        G.add(Polyline(ring, 0.018), 0.01)
        for k in range(4):
            z = 0.23 - 0.03 * k
            y0 = -0.18 - 0.1 * k
            G.groove(Polyline([(an[0] - 0.13, y0, z), (an[0], y0 - 0.02, z + 0.02), (an[0] + 0.13, y0, z)], 0.003),
                     0.01, k=0.01)
        for z in (0.7, 0.42):
            G.add(Sphere((an[0] + 0.15 * s, 0.05, z), 0.016), 0.004)
    noise = Noise(60 + s)
    return X.layer_field(Fb, an + np.array((-0.4, -0.85, -0.35)), an + np.array((0.4, 0.45, 1.05)), voxel, off, 0.035,
                         mask, extra=extra, noise=lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=2))


# ------------------------------------------------------------------ the morion
class _Brim(sdf.Prim):
    """A morion's boat brim: an elliptic ring round the helm's base whose surface
    sweeps up to a point at the front and the back, with a slight droop at the sides."""

    def __init__(self, c, rin, rout, lift, th, bone=None):
        self.c, self.rin, self.rout, self.lift, self.th = np.asarray(c, float), rin, rout, lift, th
        self.bone = bone
        e = max(rout) + 0.14
        self.lo = self.c - np.array((e, e, 0.1))
        self.hi = self.c + np.array((e, e, lift + 0.14))

    @staticmethod
    def _ell(a, r):
        return 1.0 / np.sqrt((np.cos(a) / r[0]) ** 2 + (np.sin(a) / r[1]) ** 2)

    def profile(self, a, t):
        tc = np.clip(t, 0, 1)
        sa = np.abs(np.sin(a))
        lift = self.lift * sa ** 3 - 0.04 * np.cos(a) ** 2
        return lift * tc ** 1.6, lift

    def outer(self, a):
        return self._ell(a, self.rout) + 0.09 * np.abs(np.sin(a)) ** 16

    def dist(self, X_, Y_, Z_):
        x, y, z = X_ - self.c[0], Y_ - self.c[1], Z_ - self.c[2]
        r = np.sqrt(x * x + y * y)
        a = np.arctan2(y, x)
        ri, ro = self._ell(a, self.rin), self.outer(a)
        t = (r - ri) / (ro - ri)
        zs, lift = self.profile(a, t)
        slope = np.abs(lift) * 1.6 * np.clip(t, 1e-3, 1) ** 0.6 / (ro - ri)
        dv = np.abs(z - zs) / np.sqrt(1 + slope ** 2) - self.th * 0.5
        dr = np.maximum(r - ro, (ri - 0.05) - r)
        return np.maximum(dv, dr)


HELM_C = np.array((0.0, -0.01, 4.27))
BRIM_IN, BRIM_OUT, BRIM_LIFT = (0.24, 0.27), (0.34, 0.47), 0.15
COMB_C, COMB_R, COMB_A = np.array((0.0, -0.01, 4.34)), 0.52, 1.28     # the comb's arc (y-z plane)
_BRIM = _Brim(HELM_C, BRIM_IN, BRIM_OUT, BRIM_LIFT, 0.028)


def _comb_pt(a, r=COMB_R):
    return COMB_C + np.array((0.0, r * math.sin(a), r * math.cos(a)))


def _brim_edge(n=81, shrink=0.985):
    out = []
    for a in np.linspace(-math.pi, math.pi, n):
        ro = _BRIM.outer(a)
        zs, _ = _BRIM.profile(a, 1.0)
        out.append((HELM_C[0] + ro * math.cos(a) * shrink, HELM_C[1] + ro * math.sin(a) * shrink, HELM_C[2] + zs))
    return out


def build_helm(Fh, voxel):
    """A commander's morion: a domed skull with a tall arched comb and a broad boat
    brim swept up to points front and back, the brim's edge and the comb's ridge
    rolled (their brass trims are HelmTrim), a riveted band round the base, dents
    and a sword-cut in the comb. Rigid on the head."""
    rg = X.ramp
    G = Field((-0.66, -0.78, 4.12), (0.66, 0.78, 4.92), voxel)
    sk = X.layer_field(Fh, (-0.34, -0.36, 4.2), (0.34, 0.34, 4.56), voxel, 0.03, 0.035,
                       lambda X_, Y_, Z_: rg(Z_, 4.25, 4.29))
    Xg, Yg, Zg = np.meshgrid(*G.axes, indexing='ij')
    P = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
    hi = sk.lo + (np.array(sk.shape) - 1) * sk.voxel
    inside = np.all((P >= sk.lo) & (P <= hi), axis=1)
    d = np.full(len(P), 9.0, dtype=np.float32)
    d[inside] = sk.sample(P[inside])
    G.d = np.minimum(G.d, d.reshape(G.d.shape))
    G.add(X.Inter(Ellipsoid((0, -0.01, 4.3), (0.26, 0.29, 0.31)), X.Plane((0, 0, 4.28), (0, 0, -1)), 0.0), 0.04)
    # the comb: a tall fin arched along the crown
    comb = X.Inter(RoundBox((0, -0.01, 4.62), (0.024, 0.38, 0.32), radius=0.01),
                   Ellipsoid((0, -0.01, 4.34), (0.2, 0.36, COMB_R + 0.005)), 0.0)
    G.add(comb, 0.035)
    G.add(_BRIM, 0.02)
    # the band round the skull's base, riveted, and the comb's flanks riveted
    ring = [(0.262 * math.cos(a), -0.01 + 0.292 * math.sin(a), 4.31) for a in np.linspace(-math.pi, math.pi, 37)]
    G.add(Polyline(ring, 0.018), 0.01)
    for a in np.linspace(0, math.tau, 15)[:-1]:
        G.add(Sphere((0.276 * math.cos(a), -0.01 + 0.306 * math.sin(a), 4.315), 0.015), 0.004)
    for s in (1, -1):
        for a in np.linspace(-0.9, 0.9, 5):
            p = _comb_pt(a, COMB_R - 0.09)
            G.add(Sphere((0.026 * s, p[1], p[2]), 0.012), 0.004)
    _dents(G, [((0.24, -0.15, 4.5), 0.07, 0.012), ((-0.2, 0.2, 4.47), 0.08, 0.012), ((0.3, 0.1, 4.33), 0.05, 0.01)])
    G.sub(RoundBox(tuple(_comb_pt(-0.35, COMB_R - 0.02)), (0.04, 0.05, 0.006), rot_matrix(rx=-0.6), radius=0.003),
          0.004)                                                                    # a sword-cut in the comb
    noise = Noise(33)
    G.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=2), band=0.05)
    return G


def build_helm_trim(voxel):
    """The brass on the morion: the brim's rolled edge, the comb's ridge, and a boss
    at each temple where the bevor hangs."""
    G = Field((-0.68, -0.8, 4.12), (0.68, 0.8, 4.92), voxel)
    G.add(Polyline(_brim_edge(), 0.021), 0.01)
    G.add(Polyline([tuple(_comb_pt(a)) for a in np.linspace(-COMB_A, COMB_A, 25)], 0.026), 0.012)
    for s in (1, -1):
        G.add(Ellipsoid((0.262 * s, -0.05, 4.29), (0.02, 0.045, 0.045)), 0.012)
    return G


def build_bevor(voxel):
    """The bevor: a falling buffe of three overlapping lames rising from the gorget
    over the chin and the mouth to just under the nose, drawn to a sharp prow down
    its front, the top lame's edge rolled and riveted at the sides; the drowned face
    shows above it, the eyes burning in the shadow of the brim."""
    rg = X.ramp
    S_ = Field((-0.4, -0.5, 3.6), (0.4, 0.4, 4.4), voxel)
    S_.add(Ellipsoid((0, -0.06, 3.99), (0.18, 0.215, 0.17)), 0.0)
    S_.add(Ellipsoid((0, -0.04, 4.1), (0.19, 0.225, 0.11)), 0.06)
    S_.add(X.Inter(RoundBox((0, -0.2, 4.0), (0.004, 0.08, 0.12), radius=0.0),
                   Ellipsoid((0, -0.08, 4.0), (0.3, 0.2, 0.2)), 0.0), 0.09)                  # the prow

    def top(X_):
        return 4.115 + 1.0 * X_ ** 2

    def mask(X_, Y_, Z_):
        return rg(Z_, 3.84, 3.88) * (1 - rg(Z_, top(X_) - 0.01, top(X_))) * rg(-Y_, -0.03, 0.04)

    def off(X_, Y_, Z_):
        # each lame stands proud of the one under it
        return 0.032 + 0.016 * np.clip(np.floor((Z_ - 3.86) / 0.085), 0, 2)

    def extra(G):
        for s in (1, -1):
            for z in (3.92, 4.0, 4.08):
                G.add(Sphere((s * 0.205, -0.12, z), 0.012), 0.004)
    return X.layer_field(S_, (-0.34, -0.42, 3.75), (0.34, 0.2, 4.3), voxel, off, 0.026, mask, extra=extra)


def build_crest(voxel):
    """The commander's crest: a dense brush of horsehair, once crimson, set along
    the top of the comb from the brow to the nape, standing stiff and fanning out
    as it rises, its last hanks at the back curling down over the nape."""
    G = Field((-0.18, -0.66, 4.2), (0.18, 0.95, 5.3), voxel)
    rng = np.random.default_rng(17)
    for a in np.linspace(-1.1, 1.5, 58):
        u = (a + 1.1) / 2.6
        L_ = 0.12 + 0.1 * math.sin(math.pi * min(1.0, u * 1.25)) ** 0.6
        droop = max(0.0, a - 1.05) * 1.3                       # the back hanks curl down
        for dx in (-0.032, -0.011, 0.011, 0.032):
            aa = a + rng.uniform(-0.015, 0.015)
            base = _comb_pt(min(aa, COMB_A), COMB_R - 0.012) + np.array((dx, 0, 0))
            tip = _comb_pt(aa + 0.06 * u + droop, COMB_R + L_ * rng.uniform(0.88, 1.04)) + np.array((dx * 1.5, 0, 0))
            G.add(RoundCone(tuple(base), tuple(tip), 0.03, 0.02), 0.02)
    noise = Noise(19)

    def strands(X_, Y_, Z_):
        ang = np.arctan2(Y_ - COMB_C[1], Z_ - COMB_C[2])
        return (0.006 * noise.fbm(ang * 70.0, X_ * 28.0, Z_ * 3.0, octaves=2)
                + 0.003 * noise.fbm(X_ * 50, Y_ * 50, Z_ * 50, octaves=1))
    G.displace(strands, band=0.03)
    return G




class _FoldedCloak(sdf.Prim):
    """The cloak's surface before it is given a thickness: a cone round the body
    (narrow at the shoulders, wide at the hem) whose radius ripples round it in
    folds that deepen toward the hem."""

    def __init__(self):
        self.bone = None
        self.lo = np.array((-1.2, -1.2, 0.5))
        self.hi = np.array((1.2, 1.4, 3.8))

    @staticmethod
    def surface(theta, Z_):
        t = np.clip((3.62 - Z_) / (3.62 - 0.75), 0, 1)
        R_ = 0.6 + 0.35 * t
        amp = 0.015 + 0.075 * t ** 0.8
        return R_ + amp * np.sin(theta * 9.0 + 0.5 * np.sin(Z_ * 1.4)), amp

    def dist(self, X_, Y_, Z_):
        t = np.clip((3.62 - Z_) / (3.62 - 0.75), 0, 1)
        yc = 0.1 + 0.26 * t
        x, y = X_, Y_ - yc
        rho = np.sqrt(x * x + y * y) + 1e-6
        th = np.arctan2(y, x)
        Rf, amp = self.surface(th, Z_)
        slope = amp * 9.0 / rho
        return (rho - Rf) / np.sqrt(1 + slope ** 2)


def build_breast_sigil(cuirass, voxel):
    """The Bastion's tower over three waves raised in brass on the breastplate,
    inside a ring, lying over the fluting."""
    rg = X.ramp

    def box(X_, Z_, x0, x1, z0, z1):
        return (rg(X_, x0 - 0.008, x0) * (1 - rg(X_, x1, x1 + 0.008)) * rg(Z_, z0 - 0.008, z0)
                * (1 - rg(Z_, z1, z1 + 0.008)))

    def mask(X_, Y_, Z_):
        ax = np.abs(X_)
        tower = box(ax, Z_, -0.01, 0.07, 3.0, 3.26)
        crown = box(ax, Z_, -0.01, 0.1, 3.26, 3.3)
        merl = box(ax, Z_, -0.01, 0.1, 3.3, 3.34) * rg(np.abs(np.sin(X_ * 48.0)), 0.3, 0.45)
        gate = box(ax, Z_, -0.01, 0.026, 3.0, 3.08)
        m = np.maximum(np.maximum(tower, crown), merl) * (1 - gate)
        for zc in (2.95, 2.9, 2.85):
            wz = zc + 0.012 * np.sin(X_ * 30.0)
            m = np.maximum(m, rg(np.abs(Z_ - wz), 0.013, 0.007) * (1 - rg(ax, 0.15, 0.17)))
        rr = np.sqrt(X_ ** 2 + ((Z_ - 3.1) * 0.82) ** 2)
        m = np.maximum(m, rg(np.abs(rr - 0.22), 0.014, 0.007))
        return m * rg(-Y_, 0.2, 0.3)
    return X.layer_field(cuirass, (-0.32, -0.75, 2.76), (0.32, -0.25, 3.42), voxel, 0.0, 0.022, mask)


def build_clasps(voxel):
    """The cloak's brass clasps on the collarbones, a chain slung between them."""
    G = Field((-0.5, -0.62, 3.1), (0.5, -0.1, 3.7), voxel)
    pts = []
    for s in (1, -1):
        c = np.array((0.3 * s, -0.43, 3.46))
        G.add(Ellipsoid(c, (0.07, 0.03, 0.07), rot_matrix(rx=0.3)), 0.01)
        G.add(sdf.Torus(tuple(c + np.array((0, -0.025, 0))), (0, -1, 0.3), 0.06, 0.012), 0.004)
        G.add(Sphere(tuple(c + np.array((0, -0.035, 0))), 0.028), 0.006)
        pts.append(c + np.array((-0.03 * s, -0.04, -0.04)))
    for i in range(11):
        t = i / 10
        p = pts[0] + (pts[1] - pts[0]) * t + np.array((0, -0.03, -0.17 * math.sin(math.pi * t)))
        G.add(sdf.Torus(tuple(p), (0, -1, 0) if i % 2 else (0, 0, 1), 0.022, 0.007), 0.003)
    return G


def build_cape(voxel):
    """The commander's cloak: heavy wool hung from the shoulders under the
    pauldrons, falling in deep folds down the back to the calves, wider at the
    hem, torn into long tongues and holed; sodden."""
    F = Field((-1.15, -0.1, 0.55), (1.15, 1.2, 3.8), voxel)
    rng = np.random.default_rng(12)
    shell = X.Shell(_FoldedCloak(), 0.04)
    back = RoundBox((0.0, 0.86, 2.2), (1.25, 0.68, 1.6), radius=0.0)
    F.add(X.Inter(shell, back, 0.0, bone='Cape1'), 0.0, weight=False)
    # the drape over each shoulder, under the pauldron
    for s in (1, -1):
        F.add(X.Inter(X.Shell(Ellipsoid((0.42 * s, 0.12, 3.45), (0.3, 0.32, 0.22)), 0.035),
                      RoundBox((0.42 * s, 0.32, 3.5), (0.32, 0.2, 0.2), radius=0.0), 0.0), 0.04, weight=False)
    for k in range(20):                                               # the torn hem
        x = -1.0 + 2.0 * k / 19 + rng.uniform(-0.03, 0.03)
        F.sub(Ellipsoid((x, 1.0, 0.8 + rng.uniform(-0.05, 0.38)), (rng.uniform(0.03, 0.07), 0.45,
                                                                    rng.uniform(0.12, 0.42))), 0.01)
    for k in range(7):
        F.sub(Sphere((rng.uniform(-0.6, 0.6), 0.85, rng.uniform(1.2, 2.7)), rng.uniform(0.03, 0.08)), 0.01)
    noise = Noise(18)
    F.displace(lambda X_, Y_, Z_: 0.008 * noise.fbm(X_ * 4, Y_ * 2, Z_ * 0.8, octaves=3), band=0.05)
    return F


def cape_weights(obj):
    """The cloak rides the shoulders at the top and the cloak chain below."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Spine2', 'L_Clavicle', 'R_Clavicle', 'Cape1', 'Cape2', 'Cape3']
    W = np.zeros((len(P), len(names)))
    x, z = P[:, 0], P[:, 2]
    top = np.clip((z - 3.3) / 0.25, 0, 1)
    ax = np.abs(x)
    clav = np.clip((ax - 0.25) / 0.3, 0, 1) * top
    W[:, 0] = top - clav
    W[x > 0, 1] = clav[x > 0]
    W[x <= 0, 2] = clav[x <= 0]
    rest = 1 - top
    t = np.clip((3.3 - z) / 2.4, 0, 1)
    c1 = np.clip(1 - t / 0.4, 0, 1)
    c3 = np.clip((t - 0.6) / 0.4, 0, 1)
    c2 = 1 - c1 - c3
    W[:, 3] = rest * c1
    W[:, 4] = rest * c2
    W[:, 5] = rest * c3
    W = R.relax(W, E, iters=4)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


# ------------------------------------------------------------------ the tabard
def build_tabard(voxel):
    """The tabard: a front and a back panel hanging from the belt, heavy with water,
    torn ragged at the hem, holed and split."""
    F = Field((-0.48, -0.66, 0.85), (0.48, 0.66, 2.72), voxel)
    rng = np.random.default_rng(4)
    for sgn, nm in ((-1, 'F'),):
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
    names = ['Hips', 'TabF1', 'TabF2']
    W = np.zeros((len(P), 3))
    z = P[:, 2]
    front = P[:, 1] < 0
    t = np.clip((2.62 - z) / (2.62 - 1.05), 0, 1)
    hip = np.clip(1 - t / 0.08, 0, 1)
    low = np.clip((t - 0.4) / 0.3, 0, 1)
    low = low * low * (3 - 2 * low)
    up = (1 - hip) * (1 - low)
    lw = (1 - hip) * low
    W[:, 0] = hip
    W[:, 1] = up
    W[:, 2] = lw
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
def build_sword(voxel):
    """The longsword, as two fields (the hilt; the blade): a leather-wrapped grip,
    a heavy disc pommel, a broad straight crossguard with downturned quillons, and a
    broad blade with a fuller tapering to the point, nicked and pitted."""
    lo, hi = (-0.4, -0.12, -GRIP_BELOW - 0.12), (0.4, 0.12, BLADE_END + 0.05)
    F = Field(lo, hi, voxel)
    H = Field(lo, hi, voxel)
    F.add(RoundCone((0, 0, -GRIP_BELOW + 0.06), (0, 0, GUARD_Z - 0.03), 0.042, 0.04), 0.01)
    for z in np.linspace(-GRIP_BELOW + 0.1, GUARD_Z - 0.06, 6):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.043, 0.008), 0.004)
    F.add(sdf.Torus((0, 0, -GRIP_BELOW), (0, 1, 0), 0.07, 0.03), 0.01)                 # the disc pommel
    F.add(Ellipsoid((0, 0, -GRIP_BELOW), (0.06, 0.04, 0.06)), 0.01)
    F.add(Polyline([(-0.34, 0, GUARD_Z - 0.06), (-0.26, 0, GUARD_Z), (0.26, 0, GUARD_Z),
                    (0.34, 0, GUARD_Z - 0.06)], 0.03), 0.02)                            # the crossguard
    F.add(Ellipsoid((0, 0, GUARD_Z), (0.08, 0.05, 0.05)), 0.02)
    H.add(_Longsword(), 0.006)
    rng = np.random.default_rng(8)
    for k in range(8):
        z = rng.uniform(GUARD_Z + 0.3, BLADE_END - 0.2)
        u = (z - GUARD_Z) / (BLADE_END - GUARD_Z)
        w = _Longsword.width(u)
        H.sub(Sphere(((1 if k % 2 else -1) * (w + 0.005), 0, z), rng.uniform(0.01, 0.022)), 0.004)
    return F, H


class _Longsword(sdf.Prim):
    """A broad straight blade in the sword frame (along +Z, flat in Y), a fuller down
    the middle, tapering to the point over its last tenth."""

    @staticmethod
    def width(u):
        u = np.clip(u, 0, 1)
        w = BLADE_W * (1 - 0.3 * u)
        return np.where(u > 0.88, w * (1 - (u - 0.88) / 0.12), w)

    def __init__(self):
        self.bone = None
        self.lo = np.array((-BLADE_W - 0.02, -0.04, GUARD_Z))
        self.hi = np.array((BLADE_W + 0.02, 0.04, BLADE_END + 0.02))

    def dist(self, X_, Y_, Z_):
        u = (Z_ - GUARD_Z) / (BLADE_END - GUARD_Z)
        w = self.width(u)
        th = 0.024 * (1 - 0.6 * np.clip(np.abs(X_) / np.maximum(w, 1e-3), 0, 1))
        th = th - 0.008 * np.exp(-(X_ / 0.02) ** 2)                     # the fuller
        d = np.maximum(np.abs(X_) - w, np.abs(Y_) - th)
        return np.maximum(d, np.maximum(GUARD_Z - Z_, Z_ - BLADE_END))


def _shield_hw(Y_):
    """The board's half width up its height: straight sides, the top corners
    rounded, the foot drawn to a shallow point."""
    top_r = 0.2
    yt = np.clip(Y_ - (SHIELD_TOP - top_r), 0, None) / top_r
    hw = SHIELD_W - top_r * (1 - np.sqrt(np.clip(1 - yt ** 2, 0, 1)))
    foot = np.clip((SHIELD_FOOT + 0.22 - Y_) / 0.22, 0, 1)
    return hw * (1 - 0.35 * foot ** 1.3)


def _shield_z(X_):
    return -SHIELD_BOW * (X_ / SHIELD_W) ** 2


class _Tower(sdf.Prim):
    """The tower shield in its own frame (+Y up, +Z its face): a tall board bowed
    round the body, the top corners rounded, the foot a shallow point."""

    def __init__(self, th=0.034):
        self.bone, self.th = None, th
        self.lo = np.array((-SHIELD_W - 0.05, SHIELD_FOOT - 0.1, -SHIELD_BOW - 0.1))
        self.hi = np.array((SHIELD_W + 0.05, SHIELD_TOP + 0.05, 0.1))

    def dist(self, X_, Y_, Z_):
        hw = _shield_hw(Y_)
        foot_y = SHIELD_FOOT + 0.12 * np.clip(np.abs(X_) / SHIELD_W, 0, 1)
        d = np.maximum(np.abs(X_) - hw, np.maximum(Y_ - SHIELD_TOP, foot_y - Y_))
        return np.maximum(d, np.abs(Z_ - _shield_z(X_)) - self.th * 0.5)


def _on_board(x, y, lift):
    return np.array((x, y, _shield_z(x) + lift))


def _rim_pts(n=90, inset=0.03):
    """The board's outline, inset a little, as a closed loop."""
    pts = []
    ys = np.linspace(SHIELD_FOOT + 0.12, SHIELD_TOP - 0.005, n // 2)
    right = [(float(_shield_hw(y)) - inset, y) for y in ys]
    for x, y in right:
        pts.append(tuple(_on_board(x, y, 0.02)))
    for x, y in reversed(right):
        pts.append(tuple(_on_board(-x, y, 0.02)))
    pts.append(tuple(_on_board(0.0, SHIELD_FOOT + 0.02, 0.02)))
    pts.append(pts[0])
    return pts


SHIELD_SIGIL_Y = 0.02


def build_shield(voxel):
    """The great tower shield: the bowed board, an iron rim, two riveted iron
    bands across it, dents, gouges and a sword-cut, the enarmes behind."""
    F = Field((-SHIELD_W - 0.1, SHIELD_FOOT - 0.12, -0.4), (SHIELD_W + 0.1, SHIELD_TOP + 0.1, 0.2), voxel)
    F.add(_Tower(), 0.0)
    F.add(Polyline(_rim_pts(), 0.03), 0.014)
    for yb in (0.64, -0.92):
        band = [tuple(_on_board(x, yb, 0.022)) for x in np.linspace(-SHIELD_W + 0.03, SHIELD_W - 0.03, 17)]
        F.add(Polyline(band, 0.02), 0.01)
        for x in np.linspace(-SHIELD_W + 0.08, SHIELD_W - 0.08, 6):
            F.add(Sphere(tuple(_on_board(x, yb, 0.04)), 0.017), 0.004)
    for x, y in ((0.4, 0.82), (-0.4, 0.82), (0.44, -1.1), (-0.44, -1.1), (0.0, -1.2)):
        F.add(Sphere(tuple(_on_board(x, y, 0.035)), 0.018), 0.004)
    _dents(F, [(_on_board(0.3, 0.3, 0.05), 0.09, 0.014), (_on_board(-0.28, -0.5, 0.05), 0.08, 0.012),
               (_on_board(0.1, -1.0, 0.05), 0.07, 0.012)])
    F.groove(Polyline([tuple(_on_board(-0.42, 0.45, 0.02)), tuple(_on_board(-0.12, 0.2, 0.02))], 0.004), 0.016,
             k=0.012)
    F.groove(Polyline([tuple(_on_board(0.35, -0.2, 0.02)), tuple(_on_board(0.46, -0.55, 0.02))], 0.004), 0.012,
             k=0.01)
    for y in (0.26, -0.26):                                               # the enarmes behind
        F.add(RoundBox((0.0, y, -0.12), (0.18, 0.03, 0.012), radius=0.006), 0.01)
    noise = Noise(55)
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=2), band=0.04)
    return F


def build_shield_sigil(voxel):
    """The Bastion's tower over three waves raised in brass on the shield's face."""
    G = Field((-0.4, -0.9, -0.12), (0.4, 0.75, 0.16), voxel)
    c = SHIELD_SIGIL_Y
    lift = 0.034

    def flat(x, y, hx, hy):
        return RoundBox(tuple(_on_board(x, y, lift)), (hx, hy, 0.016), radius=0.008)
    for k in range(6):                                                    # the tower, tapering up
        y = c - 0.22 + 0.1 * k
        G.add(flat(0.0, y, 0.13 - 0.01 * k, 0.06), 0.006)
    G.add(flat(0.0, c + 0.37, 0.15, 0.035), 0.006)                          # its parapet
    for k in range(4):
        G.add(flat(-0.105 + 0.07 * k, c + 0.45, 0.022, 0.045), 0.004)       # its merlons
    G.sub(Ellipsoid(tuple(_on_board(0.0, c - 0.2, lift + 0.01)), (0.04, 0.09, 0.04)), 0.006)   # the gate
    for k in range(4):                                                    # courses of stone
        y = c - 0.12 + 0.11 * k
        G.groove(Polyline([tuple(_on_board(-0.14, y, lift + 0.016)), tuple(_on_board(0.14, y, lift + 0.016))], 0.003),
                 0.006, k=0.006)
    for k in range(3):
        y = c - 0.38 - 0.13 * k
        wave = [tuple(_on_board(x, y + 0.035 * math.sin(x * 19), lift - 0.006)) for x in np.linspace(-0.3, 0.3, 21)]
        G.add(Polyline(wave, 0.018), 0.006)
    ring = [tuple(_on_board(0.36 * math.cos(a), c - 0.1 + 0.62 * math.sin(a), lift - 0.01))
            for a in np.linspace(-math.pi, math.pi, 49)]
    G.add(Polyline(ring, 0.014), 0.006)
    return G


def shield_matrix():
    """The shield held by its upright grip in the left fist: the board's up runs
    through the fist toward the thumb, its face is the back of the hand (the
    board lies just beyond the knuckles), the board hanging lower below the
    fist than it rises above it."""
    _w, _down, _width, palm = HAND.frame(1)
    up_ = _shield_up()
    out = unit(-palm - up_ * (-palm @ up_))
    side = unit(np.cross(up_, out))
    M = np.eye(4)
    M[:3, 0] = side
    M[:3, 1] = up_
    M[:3, 2] = out
    M[:3, 3] = GRIP_L_FIST + out * 0.16 + up_ * SHIELD_DROP
    return M


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
    S = [Sculpt('Body', Fb, 'mail', 4200, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 1600, tau=0.02),
         Sculpt('R_Gauntlet', Fr, 'gauntlet', 1200, tau=0.012),
         Sculpt('L_Gauntlet', Fl, 'gauntlet', 1200, tau=0.012)]
    targets = {'Cuirass': 3200, 'Faulds': 900, 'Gorget': 600, 'Pauldron': 1600, 'PauldronLame1': 500,
               'PauldronLame2': 500, 'PauldronLame3': 500, 'Couter': 450, 'Vambrace': 550, 'Tasset': 450,
               'Poleyn': 450, 'Cuisse': 500}
    plate_fields = {}
    for name, G, binding, bone, allow in plates(Fb, Fh, Fl, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        plate_fields[name] = G
        S.append(Sculpt(name, G, 'plate', targets[key], binding=binding, bone=bone, allow=allow, relax=8))
    S.append(Sculpt('BreastSigil', build_breast_sigil(plate_fields['Cuirass'], 0.006 * k), 'brass', 1300,
                    binding='transfer', allow=('Spine2', 'Spine1'), relax=6))
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Fb, vp, s), 'breech', 900, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
        S.append(Sculpt(_side('Greave', s), build_boot(Fb, vp, s), 'plate', 1400, binding='transfer',
                        allow=(_side('Shin', s), _side('Foot', s), _side('Toes', s)), relax=6))
    Gh = build_helm(Fh, vh * 1.25)
    S.append(Sculpt('Helm', Gh, 'plate', 2800, binding='rigid', bone='Head'))
    S.append(Sculpt('HelmTrim', build_helm_trim(vh), 'brass', 1400, binding='rigid', bone='Head'))
    S.append(Sculpt('Bevor', build_bevor(vh * 1.2), 'plate', 1600, binding='rigid', bone='Head'))
    S.append(Sculpt('Crest', build_crest(vh * 1.2), 'horsehair', 2600, binding='rigid', bone='Head'))
    S.append(Sculpt('Cape', build_cape(vp), 'cape', 2800, binding='own', weigh=cape_weights))
    S.append(Sculpt('Clasps', build_clasps(0.0045 * k), 'brass', 900, binding='rigid', bone='Spine2'))
    S.append(Sculpt('Tabard', build_tabard(vp), 'cloth', 1300, binding='own', weigh=tabard_weights))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'leather', 700, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, binding, bone, allow in build_kelp(0.006 * k, Fb, Fh, plate_fields):
        if name == 'KelpHelm':
            continue
        S.append(Sculpt(name, G, 'kelp', 500, binding=binding, bone=bone, allow=allow, relax=4))
    c_l = _m(SHOULDER, 1) + np.array((0.04, 0.0, 0.05))
    c_r = _m(SHOULDER, -1) + np.array((-0.04, 0.0, 0.05))
    spots = [
        ('BarnPauldronL', c_l + np.array((0.28, 0.08, 0.26)), 0.3, 15, 0.08, 'L_UpperArm', [plate_fields['L_Pauldron']]),
        ('BarnPauldronR', c_r + np.array((-0.24, 0.14, 0.24)), 0.22, 10, 0.07, 'R_UpperArm', [plate_fields['R_Pauldron']]),
        ('BarnBack', (0.16, 0.5, 2.6), 0.2, 8, 0.07, 'Spine1', [plate_fields['Cuirass']]),
        ('BarnHelm', (0.26, 0.12, 4.37), 0.12, 6, 0.05, 'Head', [Gh]),
        ('BarnKneeR', _m(KNEE, -1) + np.array((0.0, -0.18, 0.04)), 0.1, 4, 0.05, 'R_KneeFix',
         [plate_fields['R_Poleyn']]),
    ]
    for name, G, bone in build_barnacles(spots, 0.004 * k):
        S.append(Sculpt(name, G, 'barnacle', 1000 if name in ('BarnPauldronL',) else 700, binding='rigid',
                        bone=bone))
    return S


def sword_point(p):
    return (axe_matrix() @ np.array((p[0], p[1], p[2], 1.0)))[:3]


def shield_point(p):
    return (shield_matrix() @ np.array((p[0], p[1], p[2], 1.0)))[:3]


# The effect anchors the game reads (kit/anchors.py prints them in the game's terms).
ANCHORS = {
    'brimF': ('Head', head_map(np.array((0.0, -0.6, 4.46)))),
    'brimL': ('Head', head_map(np.array((0.36, -0.05, 4.24)))),
    'brimR': ('Head', head_map(np.array((-0.36, -0.05, 4.24)))),
    'crest': ('Head', head_map(_comb_pt(0.3, COMB_R + 0.2))),
    'shieldTop': ('Shield', shield_point((0.0, SHIELD_TOP, 0.0))),
    'shieldFoot': ('Shield', shield_point((0.0, SHIELD_FOOT, 0.0))),
    'shieldFace': ('Shield', shield_point((0.0, SHIELD_SIGIL_Y, 0.05))),
    'sword': ('Weapon', sword_point((0.0, 0.0, BLADE_END))),
    'cape': ('Cape3', np.array((0.0, 0.84, 0.95))),
    'chest': ('Spine2', np.array((0.0, -0.55, 3.05))),
    'eyes': ('Head', head_map(np.array((0.0, -0.3, 4.2)))),
}
