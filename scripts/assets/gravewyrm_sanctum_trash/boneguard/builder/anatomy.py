"""Sanctum Boneguard: skeleton and sculpts (rest pose), in yards.

One of the held dead thawed out of the Quench: a tall soldier of the Smith's era in
his old plate, twelve hundred years under the ice. NOT a skeleton: a whole body,
corpse-grey and frost-cracked, a gaunt bearded face under an open conical helm,
the left vambrace lost (the bare dead forearm shows), rime crusted on every upper
face of the plate and ice wedged in the joints. A long hand-and-a-half sword.

Axes: yards, +Z up, faces -Y (glTF +Z), his left is +X. Rest is an A-pose (arms
30 degrees off the body). Helm crest 4.62 yd (1.78 KayKit knights of 2.6).

Variant `bonewalker` (Raised Bonewalker, Velkhar's adds): the same dead in worse
shape: no helm (a frost-bitten bare head, ragged hair), the right pauldron and the
tassets gone, the cuirass split, the sword broken off at half its length.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'SanctumBoneguard'
PREFIX = 'boneguard'
VARIANT = [None]


def set_variant(v):
    VARIANT[0] = v
    global NAME, PREFIX
    if v == 'bonewalker':
        NAME, PREFIX = 'RaisedBonewalker', 'bonewalker'


def walker():
    return VARIANT[0] == 'bonewalker'


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

# ------------------------------------------------------------------ the sword
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.235 + _p * 0.075            # the centre of the right fist's grip
WEAPON_AXIS = tuple(unit(_wd + _d * 0.45))         # the grip lies diagonally across the palm
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.45))
GRIP_OFFSET_L = tuple(_dl * 0.235 + _pl * 0.075)
GRIP_LEN = 0.5                                    # the grip, from the guard to the pommel
BLADE_LEN = 2.25
GUARD_T = 0.17                                    # the guard sits this far up the axis from the fist's centre


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
        # the frozen tabard, front and back panels
        ('TabF1', 'Hips', (0, -0.42, 2.6), (0, -0.46, 1.86)),
        ('TabF2', 'TabF1', (0, -0.46, 1.86), (0, -0.47, 1.1)),
        ('TabB1', 'Hips', (0, 0.4, 2.6), (0, 0.46, 1.86)),
        ('TabB2', 'TabB1', (0, 0.46, 1.86), (0, 0.47, 1.1)),
    ] + B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


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
FREE_START = ('Thaw',)
FREE_END = ('Death',)
WEAPON_PROBES = (-0.6, 0.6, 1.4, 2.0, 2.45)
COLLIDE_LEGS = {'L_Thigh': 0.36, 'R_Thigh': 0.36, 'L_Shin': 0.26, 'R_Shin': 0.26}


def _chains():
    from rig import Chain
    return [
        Chain(['TabF1', 'TabF2'], 'Hips', gravity=0.55, stiff=0.2, damp=0.18, drag=0.8, collide=True),
        Chain(['TabB1', 'TabB2'], 'Hips', gravity=0.55, stiff=0.2, damp=0.18, drag=0.8, collide=True),
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


# ------------------------------------------------------------------ the body (mail and gambeson)
def build_body(voxel):
    F = Field((-1.15, -0.75, -0.05), (1.15, 0.75, 4.02), voxel)
    F.add(Ellipsoid((0, 0.04, 2.44), (0.42, 0.3, 0.3), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, 0.03, 2.8), (0.42, 0.31, 0.32), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, 0.0, 3.2), (0.6, 0.41, 0.44), rot_matrix(rx=-0.06), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.14, 3.38), (0.57, 0.29, 0.31), bone='Spine2'), 0.16)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.23, -0.2, 3.3), s), (0.25, 0.14, 0.18), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.12, 3.54), s), _m((0.5, 0.08, 3.58), s), 0.16, 0.14, bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.38, 0.08, 3.06), s), (0.2, 0.24, 0.34), bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.19, 0.2, 2.36), s), (0.23, 0.2, 0.24), bone='Hips'), 0.12)
    F.add(RoundCone((0, 0.05, 3.5), (0, 0.0, 3.98), 0.15, 0.12, bone='Neck'), 0.1)

    def arm(s):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.03 * s, 0, 0.0)), 0.22, bone=up), 0.1)
        F.add(RoundCone(sh, el, 0.19, 0.145, bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.5) + np.array((0, -0.06, 0)), (0.12, 0.12, 0.22), _rot(sh, el), bone=up), 0.06)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.12, bone=_side('ElbowFix', s)), 0.08)
        if s < 0 or walker():
            # the right forearm (under its vambrace); the left is bare flesh (its own sculpt)
            F.add(RoundCone(el, lerp(el, wr, 0.35), 0.145, 0.16, bone=fo), 0.08)
            F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.16, 0.105, bone=fo), 0.08)
    for s in (1, -1):
        if s > 0 and not walker():
            sh, el = SHOULDER, ELBOW
            F.add(Sphere(sh + np.array((0.03, 0, 0.0)), 0.22, bone='L_UpperArm'), 0.1)
            F.add(RoundCone(sh, el, 0.19, 0.145, bone='L_UpperArm'), 0.1)
            F.add(Ellipsoid(lerp(sh, el, 0.5) + np.array((0, -0.06, 0)), (0.12, 0.12, 0.22), _rot(sh, el),
                            bone='L_UpperArm'), 0.06)
            F.add(Sphere(el + np.array((0, 0.05, 0)), 0.12, bone='L_ElbowFix'), 0.08)
        else:
            arm(s)

    def leg(s):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sh = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0, 0.06)), kn, 0.29, 0.18, bone=th), 0.14)
        F.add(Ellipsoid(lerp(hp, kn, 0.42) + np.array((0.03 * s, -0.08, 0)), (0.21, 0.19, 0.32), _rot(hp, kn),
                        bone=th), 0.08)
        F.add(Sphere(kn + np.array((0, -0.02, 0.0)), 0.15, bone=_side('KneeFix', s)), 0.08)
        F.add(RoundCone(kn, an, 0.17, 0.105, bone=sh), 0.1)
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0, 0.07, 0)), (0.14, 0.13, 0.25), _rot(kn, an), bone=sh), 0.08)
        foot = _side('Foot', s)
        F.add(Ellipsoid(an + np.array((0, 0.02, -0.07)), (0.11, 0.15, 0.1), bone=foot), 0.06)
        F.add(RoundBox(_m((0.32, -0.15, 0.105), s), (0.1, 0.2, 0.06), radius=0.04, bone=foot), 0.06)
        F.add(Ellipsoid(_m((0.33, -0.44, 0.075), s), (0.1, 0.16, 0.06), bone=_side('Toes', s)), 0.05)
    leg(1)
    leg(-1)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.12)
    return F


# ------------------------------------------------------------------ the head
def build_head(voxel):
    F = Field((-0.3, -0.36, 3.55), (0.3, 0.3, 4.55), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, 0.04, 3.6), (0, -0.0, 4.0), 0.135, 0.115, bone='Neck'), 0.06)
    F.add(Ellipsoid((0, 0.0, 4.24), (0.185, 0.22, 0.235), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.11, 4.14), (0.155, 0.13, 0.19), bone='Head'), 0.06)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.1, -0.165, 4.155), s), (0.055, 0.045, 0.035), bone='Head'), 0.03)   # cheekbone
        F.add(Ellipsoid(_m((0.165, -0.02, 4.17), s), (0.03, 0.06, 0.08), bone='Head'), 0.03)       # ear
    F.add(Ellipsoid((0, -0.195, 4.255), (0.14, 0.045, 0.035), rot_matrix(rx=0.15), bone='Head'), 0.03)   # brow
    F.add(RoundCone((0, -0.21, 4.24), (0.006, -0.262, 4.14), 0.02, 0.028, bone='Head'), 0.025)        # nose
    F.add(Ellipsoid((0.005, -0.258, 4.125), (0.034, 0.03, 0.026), bone='Head'), 0.02)
    F.add(Ellipsoid((0, -0.12, 4.02), (0.125, 0.11, 0.075), rot_matrix(rx=0.2), bone='Jaw'), 0.05)
    F.add(Ellipsoid((0, -0.205, 3.99), (0.05, 0.04, 0.045), bone='Jaw'), 0.03)
    F.add(Ellipsoid((0, -0.215, 4.055), (0.055, 0.02, 0.014), bone='Jaw'), 0.012)       # lower lip
    F.add(Ellipsoid((0, -0.222, 4.082), (0.058, 0.02, 0.013), bone='Head'), 0.012)      # upper lip
    for s in (1, -1):
        F.sub(Ellipsoid(_m((0.105, -0.185, 4.07), s), (0.045, 0.035, 0.05)), 0.03)       # hollow cheeks
        F.sub(Sphere(_m(EYE + np.array((0, -0.005, 0)), s), EYE_R + 0.016), 0.022)        # sunken sockets
        F.sub(Ellipsoid(_m((0.075, -0.185, 4.245), s), (0.04, 0.02, 0.012)), 0.015)       # lid crease
    F.sub(Ellipsoid((0, -0.23, 4.068), (0.05, 0.03, 0.006)), 0.008)                       # the mouth line
    # frost cracks and wrinkles
    for z, w in ((4.3, 0.09), (4.33, 0.1)):
        F.groove(Polyline([(-w, -0.2, z), (0, -0.215, z + 0.004), (w, -0.2, z)], 0.003), 0.006, k=0.008)
    for s in (1, -1):
        F.groove(Polyline([_m((0.04, -0.245, 4.12), s), _m((0.07, -0.226, 4.07), s), _m((0.085, -0.21, 4.02), s)],
                          0.003), 0.008, k=0.009)
        F.groove(Polyline([_m((0.11, -0.17, 4.23), s), _m((0.14, -0.13, 4.18), s), _m((0.15, -0.1, 4.1), s)], 0.003),
                 0.005, k=0.008)
    if walker():
        # no helm: ragged frozen hair over the crown and a split scalp
        F.add(Ellipsoid((0, 0.04, 4.3), (0.2, 0.22, 0.2), bone='Head'), 0.05)
        F.groove(Polyline([(-0.05, -0.12, 4.44), (0.02, 0.0, 4.47), (0.06, 0.12, 4.4)], 0.003), 0.014, k=0.012)
    F.displace(lambda X_, Y_, Z_: 0.0025 * noise.fbm(X_ * 30, Y_ * 30, Z_ * 30, octaves=2), band=0.05)
    return F


# ------------------------------------------------------------------ the bare left forearm, and the hands
def build_hand(side, voxel, forearm):
    w, down, width, palm = hand_frame(side)
    el = ELBOW if side > 0 else mirror(ELBOW)
    lo = np.minimum(w, el) - 0.32
    hi = np.maximum(w + down * 0.62, el) + 0.32
    if not forearm:
        lo = np.minimum(w - down * 0.1, w + down * 0.55) - 0.2
        hi = np.maximum(w - down * 0.1, w + down * 0.55) + 0.2
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    if forearm:
        fo = _side('Forearm', side)
        F.add(Sphere(el + np.array((0, 0.04, 0)), 0.115, bone=_side('ElbowFix', side)), 0.05)
        F.add(RoundCone(el, lerp(el, w, 0.35), 0.12, 0.13, bone=fo), 0.06)
        F.add(RoundCone(lerp(el, w, 0.35), w, 0.13, 0.08, bone=fo), 0.06)
        ax = unit(w - el)
        out = unit(np.cross(ax, (0, -1.0, 0)) * -side)
        F.add(Ellipsoid(lerp(el, w, 0.28) + out * 0.05, (0.07, 0.07, 0.17), _rot(el, w), bone=fo), 0.04)
        F.add(Ellipsoid(lerp(el, w, 0.3) - out * 0.045, (0.06, 0.06, 0.15), _rot(el, w), bone=fo), 0.04)
        # tendons standing out of the starved arm
        for k in range(3):
            a = -0.5 + 0.5 * k
            off = (out * math.cos(a) + np.cross(ax, out) * math.sin(a)) * 0.075
            F.ridge(Polyline([lerp(el, w, 0.5) + off, lerp(el, w, 0.92) + off * 0.85], 0.003), 0.008, k=0.012)
    else:
        F.add(RoundCone(w - down * 0.08, w + down * 0.02, 0.085, 0.08, bone=hand), 0.03)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.13, (0.08, 0.03, 0.08), Rm, radius=0.035, bone=hand), 0.035)
    F.add(Ellipsoid(w + down * 0.08 + width * 0.05 + palm * 0.035, (0.05, 0.04, 0.07), Rm, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.04
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        if f != 'Thumb':
            F.add(Sphere(base - palm * 0.015, r0 + 0.008, bone=hand), 0.015)
        F.add(RoundCone(base, mid, r0, r0 * 0.88, bone=b1), 0.014)
        F.add(Sphere(mid, r0 * 0.9, bone=b2), 0.01)
        F.add(RoundCone(mid, tip, r0 * 0.88, r0 * 0.66, bone=b2), 0.01)
    if forearm:
        for f in FINGERS[1:]:
            base, mid, tip = finger_chain(side, f)
            F.ridge(Polyline([w + down * 0.04 + (base - w) * 0.25, base], 0.003), 0.006, k=0.01)
    return F


# ------------------------------------------------------------------ the plate
class _Union:
    def __init__(self, *fields):
        self.f = fields

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


def plates(Fb, Fh, Fl, voxel):
    """Every plate as (name, field, binding, bone, allow)."""
    out = []
    rg = X.ramp
    BU = _Union(Fb, Fh)
    noise = Noise(21)
    dent = lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=2)  # noqa: E731

    def plate(name, base, lo, hi, off, thick, mask, binding='transfer', bone='', allow=None, extra=None, v=None):
        G = X.layer_field(base, lo, hi, v or voxel, off, thick, mask, extra=extra, noise=dent)
        out.append((name, G, binding, bone, allow))
        return G

    # the cuirass: breast and back, armholes and a neck opening, a keel down the front
    def cuirass_mask(X_, Y_, Z_):
        m = rg(Z_, 2.6, 2.66) * (1 - rg(Z_, 3.5, 3.58))
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            m = m * rg(d, 0.25, 0.31)
        m = m * (1 - (1 - rg(np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2), 0.2, 0.26)) * rg(Z_, 3.3, 3.45))
        if walker():
            m = m * (1 - rg(Y_, 0.02, 0.06))          # the back plate is gone
        return m

    def keel(G):
        G.add(RoundCone((0, -0.43, 2.68), (0, -0.46, 3.18), 0.025, 0.02), 0.04)
        G.add(RoundCone((0, -0.46, 3.18), (0, -0.4, 3.44), 0.02, 0.015), 0.04)
        # the Smith's mark: a hammer over an anvil, raised on the breast
        for pts in ([(0, -0.47, 3.04), (0, -0.48, 3.26)], [(-0.07, -0.47, 3.26), (0.07, -0.47, 3.26)],
                    [(-0.11, -0.455, 2.96), (0.11, -0.455, 2.96)], [(-0.06, -0.462, 3.0), (0.06, -0.462, 3.0)]):
            G.ridge(Polyline(pts, 0.004), 0.016, k=0.016)
        for p in ((-0.2, -0.42, 3.42), (0.2, -0.42, 3.42), (-0.33, -0.33, 2.7), (0.33, -0.33, 2.7)):
            G.add(Sphere(p, 0.018), 0.008)
        # an old wound: a split across the breast, and the cracks the frost opened
        G.groove(Polyline([(0.12, -0.47, 3.32), (0.2, -0.45, 3.2), (0.27, -0.42, 3.12), (0.33, -0.38, 3.0)], 0.004),
                 0.028, k=0.014)
        G.groove(Polyline([(-0.25, -0.43, 3.0), (-0.3, -0.4, 2.85), (-0.36, -0.36, 2.78)], 0.003), 0.02, k=0.01)
        if walker():
            G.groove(Polyline([(0.02, -0.48, 3.4), (-0.05, -0.47, 3.0), (0.03, -0.45, 2.7)], 0.004), 0.05, k=0.02)
    plate('Cuirass', Fb, (-0.75, -0.62, 2.5), (0.75, 0.62, 3.7), 0.025, 0.05, cuirass_mask, allow=('Spine1', 'Spine2', 'Hips'),
          extra=keel)

    # the faulds: three lames below the breast, flaring over the hips
    def fauld_mask(X_, Y_, Z_):
        return rg(Z_, 2.22, 2.27) * (1 - rg(Z_, 2.62, 2.66)) * rg(-Y_ + 0.05, -0.05, 0.08)

    def fauld_off(X_, Y_, Z_):
        return 0.03 + 0.05 * rg(Z_, 2.62, 2.25) + 0.012 * (np.floor((2.66 - Z_) / 0.13))

    plate('Faulds', Fb, (-0.7, -0.62, 2.12), (0.7, 0.35, 2.72), fauld_off, 0.045, fauld_mask, allow=('Hips', 'Spine1'))
    if not walker():
        for s in (1, -1):
            def tasset_mask(X_, Y_, Z_, s=s):
                d, u = _arm_d(X_, Y_, Z_, s, 'HIP', 'KNEE')
                return rg(u, 0.03, 0.08) * (1 - rg(u, 0.36, 0.42)) * rg(-Y_, -0.02, 0.06) * rg(d, 0.42, 0.36)
            plate(_side('Tasset', s), Fb, _m((0.0, -0.6, 1.75), s) * 0 + np.array((min(0, 0.62 * s) - 0.02, -0.6, 1.75)),
                  np.array((max(0, 0.62 * s) + 0.02, 0.3, 2.35)), 0.07, 0.04, tasset_mask,
                  allow=(_side('Thigh', s), 'Hips'))

    # the gorget round the neck
    def gorget_mask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2)
        return rg(Z_, 3.44, 3.48) * (1 - rg(Z_, 3.7, 3.74)) * rg(r, 0.4, 0.34)
    plate('Gorget', BU, (-0.45, -0.45, 3.4), (0.45, 0.45, 3.8), 0.06, 0.04, gorget_mask, allow=('Neck', 'Spine2'))

    # the pauldrons: a dome and two lames, the left larger (the shield side)
    for s in (1, -1):
        if walker() and s < 0:
            continue
        big = 1.14 if s > 0 else 1.0
        c = _m(SHOULDER, s) + np.array((0.04 * s, 0.0, 0.05))

        def pmask(X_, Y_, Z_, c=c, big=big, s=s):
            d = np.sqrt((X_ - c[0]) ** 2 + (Y_ - c[1]) ** 2 + (Z_ - c[2]) ** 2)
            return rg(d, 0.42 * big, 0.36 * big) * rg(Z_, c[2] - 0.2 * big, c[2] - 0.12 * big) * rg(X_ * s, 0.3, 0.38)

        def poff(X_, Y_, Z_, c=c, big=big):
            return 0.05 + 0.05 * rg(Z_, c[2] + 0.1, c[2] - 0.25)

        def flange(G, c=c, s=s, big=big):
            # a raised rolled rim along the top edge (the haute-piece) and rivets
            G.add(RoundCone(c + np.array((-0.16 * s, -0.16, 0.2)) * big, c + np.array((-0.1 * s, 0.18, 0.21)) * big,
                            0.03, 0.03), 0.04)
            for a in (-0.6, 0.0, 0.6):
                G.add(Sphere(c + np.array((0.22 * s * math.cos(a), -0.22 * math.sin(a), -0.1)) * big, 0.017), 0.006)
        plate(_side('Pauldron', s), Fb, c - 0.5, c + 0.5, poff, 0.05, pmask,
              allow=(_side('UpperArm', s), _side('Clavicle', s), 'Spine2'), extra=flange)

        for k_, (z0, z1, of) in enumerate(((c[2] - 0.3 * big, c[2] - 0.14 * big, 0.11),
                                            (c[2] - 0.44 * big, c[2] - 0.28 * big, 0.13))):
            def lm(X_, Y_, Z_, c=c, z0=z0, z1=z1, s=s, big=big):
                d, u = _arm_d(X_, Y_, Z_, s)
                return (rg(Z_, z0, z0 + 0.03) * (1 - rg(Z_, z1, z1 + 0.03)) * rg(X_ * s, 0.42, 0.5) *
                        rg(d, 0.36, 0.3))
            plate(_side(f'PauldronLame{k_ + 1}', s), Fb, c - 0.55, c + 0.55, of, 0.04, lm,
                  allow=(_side('UpperArm', s), _side('Clavicle', s)))

    # couters (elbow cops) with a fan on the outside
    for s in (1, -1):
        el = _m(ELBOW, s)
        base = Fb if (s < 0 or walker()) else _Union(Fb, Fl)

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

    # the right vambrace (the left was lost; a split plate and its strap remain)
    for s in (1, -1):
        def vmask(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'ELBOW', 'WRIST')
            m = rg(u, 0.14, 0.2) * (1 - rg(u, 0.84, 0.9)) * rg(d, 0.24, 0.19)
            if s > 0 and not walker():
                ax = unit(WRIST - ELBOW)
                outv = unit(np.cross(ax, (0, -1.0, 0)) * -1)
                rel = (X_ - ELBOW[0]) * outv[0] + (Y_ - ELBOW[1]) * outv[1] + (Z_ - ELBOW[2]) * outv[2]
                m = m * rg(u, 0.5, 0.56) * rg(rel, 0.0, 0.04)
            return m
        base = Fb if (s < 0 or walker()) else Fl
        el, wr = _m(ELBOW, s), _m(WRIST, s)
        plate(_side('Vambrace', s), base, np.minimum(el, wr) - 0.3, np.maximum(el, wr) + 0.3, 0.025, 0.04, vmask,
              binding='rigid', bone=_side('Forearm', s))

    # cuisses over the front of the thighs, poleyns, greaves, sabatons
    for s in (1, -1):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)

        def cmask_(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'HIP', 'KNEE')
            return rg(u, 0.32, 0.38) * (1 - rg(u, 0.84, 0.9)) * rg(-Y_ + KNEE[1] * 0 + 0.0, -0.06, 0.04) * rg(d, 0.4, 0.33)
        plate(_side('Cuisse', s), Fb, np.minimum(hp, kn) - 0.45, np.maximum(hp, kn) + 0.45, 0.03, 0.04, cmask_,
              allow=(_side('Thigh', s),))

        def kmask(X_, Y_, Z_, kn=kn):
            d = np.sqrt((X_ - kn[0]) ** 2 + (Y_ - kn[1] + 0.06) ** 2 + (Z_ - kn[2]) ** 2)
            return rg(d, 0.22, 0.17) * rg(-Y_, 0.0, 0.08)

        def kfan(G, kn=kn, s=s):
            G.add(Ellipsoid(kn + np.array((0.17 * s, -0.04, 0.0)), (0.025, 0.1, 0.11), bone=None), 0.03)
        plate(_side('Poleyn', s), Fb, kn - 0.35, kn + 0.35, 0.035, 0.045, kmask, binding='rigid',
              bone=_side('KneeFix', s), extra=kfan)

        def gmask(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'KNEE', 'ANKLE')
            return rg(u, 0.1, 0.16) * (1 - rg(u, 0.84, 0.9)) * rg(d, 0.3, 0.24)
        plate(_side('Greave', s), Fb, np.minimum(kn, an) - 0.35, np.maximum(kn, an) + 0.35, 0.025, 0.045, gmask,
              binding='rigid', bone=_side('Shin', s))

        def smask(X_, Y_, Z_, an=an):
            return (1 - rg(Z_, 0.3, 0.36)) * rg(-(Y_ - an[1]), -0.08, -0.02) * rg(Z_, 0.025, 0.05)
        plate(_side('Sabaton', s), Fb, an + np.array((-0.25, -0.75, -0.3)), an + np.array((0.25, 0.25, 0.25)),
              0.02, 0.04, smask, allow=(_side('Foot', s), _side('Toes', s)))
    return out


def build_helm(Fh, voxel):
    """An open conical helm: a skull with a low crest-peak, a nasal bar, cheek guards
    and a brow band with rivets. Rigid on the head."""
    rg = X.ramp

    def hmask(X_, Y_, Z_):
        top = rg(Z_, 4.2 + 0.075 * rg(Y_, 0.0, -0.2), 4.24 + 0.075 * rg(Y_, 0.0, -0.2))
        cheek = rg(np.abs(X_), 0.08, 0.12) * rg(Y_, -0.2, -0.14) * rg(Z_, 3.98, 4.02)
        nape = rg(Y_, 0.06, 0.12) * rg(Z_, 3.98, 4.02)
        return np.maximum(top, np.maximum(cheek, nape))

    def detail(G):
        G.add(RoundCone((0, 0.01, 4.4), (0, 0.04, 4.6), 0.16, 0.035, bone=None), 0.12)
        G.add(RoundBox((0, -0.245, 4.165), (0.022, 0.012, 0.1), rot_matrix(rx=0.18), radius=0.008), 0.012)
        for z in (4.255,):
            ring = [(0.248 * math.sin(a), 0.01 - 0.28 * math.cos(a), z + 0.03 * math.cos(a))
                    for a in np.linspace(-math.pi, math.pi, 33)]
            G.add(Polyline(ring, 0.018), 0.012)
        for a in np.linspace(-2.6, 2.6, 9):
            G.add(Sphere((0.262 * math.sin(a), 0.01 - 0.295 * math.cos(a), 4.255 + 0.03 * math.cos(a)),
                         0.014), 0.004)
        for a in np.linspace(-0.0, 2 * math.pi, 5)[:4]:
            G.ridge(Polyline([(0.2 * math.sin(a) * 0.98, 0.02 - 0.22 * math.cos(a), 4.25),
                              (0.06 * math.sin(a), 0.02 - 0.07 * math.cos(a), 4.5)], 0.003), 0.012, k=0.01)
    return X.layer_field(Fh, (-0.32, -0.36, 3.9), (0.32, 0.32, 4.7), voxel, 0.035, 0.035, hmask, extra=detail)


def build_aventail(Fb, Fh, voxel):
    """Mail hung from the helm's rim to the shoulders, open at the face."""
    rg = X.ramp
    base = _Union(Fb, Fh)

    def amask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ - 0.02) ** 2)
        m = rg(Z_, 3.5, 3.56) * (1 - rg(Z_, 4.06, 4.12)) * rg(r, 0.52, 0.44)
        face = rg(-Y_, 0.06, 0.12) * rg(Z_, 3.86, 3.92) * rg(np.abs(X_), 0.16, 0.11)
        return m * (1 - face)

    def aoff(X_, Y_, Z_):
        return 0.03 + 0.07 * rg(Z_, 3.95, 3.62)
    return X.layer_field(base, (-0.58, -0.55, 3.42), (0.58, 0.55, 4.15), voxel, aoff, 0.035, amask)


def build_tabard(voxel):
    """The frozen tabard: a front and a back panel hanging from the belt, stiff with
    ice, torn ragged at the hem and split once."""
    F = Field((-0.48, -0.66, 0.85), (0.48, 0.66, 2.72), voxel)
    rng = np.random.default_rng(4)
    for sgn, nm in ((-1, 'F'), (1, 'B')):
        top = np.array((0, 0.41 * sgn, 2.62))
        bot = np.array((0, 0.5 * sgn, 1.05 if sgn < 0 else 1.15))
        # a curved slab: a thin shell of a tall vertical cylinder in front of the legs
        cyl_c = np.array((0, -0.25 * sgn, 0))
        Rr = 0.68
        shell = X.Shell(RoundCone(cyl_c + np.array((0, 0, 0.5)), cyl_c + np.array((0, 0, 3.0)), Rr, Rr), 0.03)
        box = RoundBox((0, 0.43 * sgn, 1.85), (0.27, 0.4, 0.8), radius=0.02)
        prim = X.Inter(shell, box, 0.0, bone='Tab' + nm + '1')
        F.add(prim, 0.0, weight=False)
        # torn hem: bites out of the bottom, and a split up the middle
        for k in range(9):
            x = -0.26 + 0.065 * k + rng.uniform(-0.02, 0.02)
            zc = bot[2] + rng.uniform(-0.06, 0.12)
            F.sub(Ellipsoid((x, 0.45 * sgn, zc), (rng.uniform(0.02, 0.05), 0.2, rng.uniform(0.06, 0.16))), 0.01)
        F.sub(RoundBox((0.03 * sgn, 0.45 * sgn, bot[2] + 0.2), (0.012, 0.2, 0.26), radius=0.004), 0.008)
        for k in range(3):
            F.sub(Sphere((rng.uniform(-0.2, 0.2), 0.45 * sgn, rng.uniform(1.5, 2.3)), rng.uniform(0.02, 0.04)), 0.01)
    noise = Noise(14)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 2, Z_ * 1.2, octaves=3), band=0.05)
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
        G.add(RoundBox((0, -0.47, 2.64), (0.075, 0.025, 0.06), radius=0.012), 0.01)
        G.sub(RoundBox((0, -0.5, 2.64), (0.045, 0.03, 0.032), radius=0.006), 0.006)
    return X.layer_field(Fb, (-0.62, -0.62, 2.48), (0.62, 0.62, 2.8), voxel, 0.08, 0.035, bmask, extra=buckle)


# ------------------------------------------------------------------ the sword (local frame: +Z up the blade)
def build_sword(voxel):
    blade = BLADE_LEN * (0.5 if walker() else 1.0)
    F = Field((-0.3, -0.08, -GRIP_LEN - 0.25), (0.3, 0.08, GUARD_T + blade + 0.1), voxel)
    g = GUARD_T
    # grip and pommel
    F.add(RoundCone((0, 0, -GRIP_LEN + 0.04), (0, 0, g - 0.03), 0.042, 0.038), 0.01)
    for z in np.linspace(-GRIP_LEN + 0.08, g - 0.08, 7):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.042, 0.009), 0.004)
    F.add(Ellipsoid((0, 0, -GRIP_LEN - 0.03), (0.075, 0.05, 0.08)), 0.02)
    F.add(RoundCone((0, 0, -GRIP_LEN - 0.1), (0, 0, -GRIP_LEN - 0.14), 0.03, 0.02), 0.01)
    # cross-guard: a heavy straight bar with turned-down ends
    F.add(RoundBox((0, 0, g), (0.26, 0.04, 0.035), radius=0.015), 0.01)
    for s in (1, -1):
        F.add(RoundCone((0.25 * s, 0, g), (0.29 * s, 0, g - 0.08), 0.035, 0.028), 0.02)
    F.add(RoundBox((0, 0, g + 0.06), (0.09, 0.05, 0.04), radius=0.015), 0.015)
    # the blade: wide at the root, tapering to a point; a fuller down its middle
    z0, z1 = g + 0.07, g + blade
    n = 10
    for i in range(n):
        a = z0 + (z1 - z0) * i / n
        b = z0 + (z1 - z0) * (i + 1) / n
        wa = 0.11 * (1 - 0.35 * i / n)
        wb = 0.11 * (1 - 0.35 * (i + 1) / n)
        F.add(X.Inter(RoundBox((0, 0, (a + b) / 2), ((wa + wb) / 2, 0.022, (b - a) / 2 + 0.01), radius=0.004),
                      X.Union([Ellipsoid((0, 0.18, (a + b) / 2), (0.2 + wa, 0.205, 1.0)),
                               Ellipsoid((0, -0.18, (a + b) / 2), (0.2 + wa, 0.205, 1.0))]), 0.0), 0.012)
    if not walker():
        tip = X.Prism((0, 0, z1 - 0.32), (0, 0, z1 + 0.04), 0.075, n=4, tip=0.92, rot=math.pi / 4)
        F.add(tip, 0.01)
    else:
        # snapped: a jagged break
        for k in range(4):
            F.sub(Sphere((-0.08 + 0.055 * k, 0, z1 + 0.02 + 0.03 * ((k * 7) % 3)), 0.035), 0.005)
    F.sub(RoundBox((0, -0.03, (z0 + z1) / 2 - 0.1), (0.018, 0.012, (z1 - z0) / 2 - 0.35), radius=0.006), 0.006)
    F.sub(RoundBox((0, 0.03, (z0 + z1) / 2 - 0.1), (0.018, 0.012, (z1 - z0) / 2 - 0.35), radius=0.006), 0.006)
    # nicks in the edges from old battles
    rng = np.random.default_rng(8)
    for k in range(7):
        z = rng.uniform(z0 + 0.2, z1 - 0.4)
        s = 1 if rng.random() < 0.5 else -1
        F.sub(Sphere((s * (0.115 * (1 - 0.35 * (z - z0) / (z1 - z0)) + 0.005), 0, z), rng.uniform(0.012, 0.028)), 0.004)
    return F


def sword_matrix():
    """Local sword frame (blade along +Z, the edges along X) into the armature: the
    pommel end at the right fist, the blade out along WEAPON_AXIS, the flat facing
    the palm."""
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


# ------------------------------------------------------------------ ice in the joints
def build_ice(voxel):
    """Ice wedged in the joints and hanging off the plate, as (name, field, bone)."""
    rng = np.random.default_rng(17)
    out = []

    def cluster(name, c, n, size, bone, up=(0, 0, 1), spread=0.08, down=False):
        c = np.asarray(c, float)
        G = Field(c - size * 1.6 - 0.05, c + size * 1.6 + 0.05, voxel)
        for k in range(n):
            d = unit(np.asarray(up, float) + rng.normal(0, 0.55, 3))
            if down:
                d = unit(np.array((rng.normal(0, 0.15), rng.normal(0, 0.15), -1.0)))
            L_ = size * rng.uniform(0.45, 1.0)
            a = c + rng.normal(0, spread, 3) * (0.3 if down else 1.0)
            G.add(X.Prism(a - d * L_ * 0.25, a + d * L_, L_ * rng.uniform(0.12, 0.2), n=int(rng.choice([5, 6])),
                          tip=rng.uniform(0.25, 0.45), rot=rng.uniform(0, 3), tip_a=0.1), 0.004)
        out.append((name, G, bone))

    for s in (1, -1):
        el = _m(ELBOW, s)
        cluster(_side('IceElbow', s), el + np.array((0.0, 0.14, 0.03)), 6, 0.13, _side('ElbowFix', s),
                up=(0.3 * s, 0.6, 0.4))
        kn = _m(KNEE, s)
        cluster(_side('IceKnee', s), kn + np.array((0.0, 0.14, 0.02)), 5, 0.12, _side('KneeFix', s),
                up=(0.2 * s, 0.7, 0.2))
        if not (walker() and s < 0):
            c = _m(SHOULDER, s) + np.array((0.24 * s, -0.02, -0.33))
            cluster(_side('IcePauldron', s), c, 7, 0.17, _side('UpperArm', s), down=True, spread=0.12)
        cluster(_side('IceHip', s), _m((0.42, -0.05, 2.25), s), 4, 0.1, 'Hips', up=(0.6 * s, -0.2, 0.3))
    if not walker():
        cluster('IceHelm', (0.0, -0.18, 4.17), 5, 0.1, 'Head', down=True, spread=0.1)
    cluster('IceChin', (0.0, -0.215, 3.97), 4, 0.075, 'Jaw', down=True, spread=0.03)
    return out


# ------------------------------------------------------------------ sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand, vp = 0.0125 * k, 0.0055 * k, 0.005 * k, 0.0095 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    Fr = build_hand(-1, vhand, forearm=False)
    Fl = build_hand(1, vhand, forearm=not walker()) if not walker() else build_hand(1, vhand, forearm=False)
    face = [((0, -0.2, 4.12), 0.12, 1.0)]
    S = [Sculpt('Body', Fb, 'mail', 7000, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 3600, spots=face, tau=0.02),
         Sculpt('R_Gauntlet', Fr, 'gauntlet', 1500, tau=0.012),
         Sculpt('L_Arm', Fl, 'flesh', 2300, tau=0.015)]
    targets = {'Cuirass': 2400, 'Faulds': 900, 'Gorget': 500, 'Pauldron': 1300, 'PauldronLame1': 500,
               'PauldronLame2': 500, 'Couter': 420, 'Vambrace': 500, 'Tasset': 400, 'Cuisse': 450, 'Poleyn': 420,
               'Greave': 650, 'Sabaton': 650}
    for name, G, binding, bone, allow in plates(Fb, Fh, Fl, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        S.append(Sculpt(name, G, 'plate', targets[key], binding=binding, bone=bone, allow=allow, relax=8))
    if not walker():
        S.append(Sculpt('Helm', build_helm(Fh, vh * 1.3), 'plate', 1700, binding='rigid', bone='Head'))
    S.append(Sculpt('Aventail', build_aventail(Fb, Fh, vp), 'mail', 1300, binding='transfer',
                    allow=('Head', 'Neck', 'Spine2'), relax=6))
    S.append(Sculpt('Tabard', build_tabard(vp), 'cloth', 1500, binding='own', weigh=tabard_weights))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'leather', 600, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, bone in build_ice(0.006 * k):
        S.append(Sculpt(name, G, 'ice', 260, binding='rigid', bone=bone))
    return S
