"""Nacre Templeguard: skeleton and sculpts (rest pose), in yards.

A temple knight the moon woke: a living statue carved in the shape of the
temple's sacred animal. It stands and fights on two legs like a knight, in
carved nacre plate with the seahorse's segmented ridges (gorget, cuirass,
pauldrons, tassets, cuisses, greaves, sabatons), white coral showing at every
joint, cracks lit cyan from inside. The head is a seahorse's: a long tube
snout, cheek plates, a fan crest of nacre fins, moonlight slits for eyes. A
curled seahorse tail hangs behind the legs. A sea-silk tabard with the moon
on it, a silver belt and circlet, pearls at the gorget. In its right fist a
coral-and-nacre trident two players long (the side tines are the horns of a
crescent moon); on its left forearm a giant scallop shield.

Axes: yards, +Z up, faces -Y, its left is +X. Rest is an A-pose. Crest top
about 5.5 yd (2.1 knights); the trident held upright stands above it.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundBox, RoundCone, Sphere, Torus, frame_from, rot_matrix

NAME = 'NacreTempleguard'
PREFIX = 'templeguard'

SHOULDER = np.array((0.74, 0.06, 3.98))
ELBOW = np.array((1.05, 0.2, 3.24))
WRIST = np.array((1.25, 0.04, 2.6))
HAND_TIP = np.array((1.36, -0.08, 2.26))
HIP = np.array((0.33, 0.06, 2.44))
KNEE = np.array((0.4, -0.14, 1.34))
ANKLE = np.array((0.42, 0.1, 0.34))
BALL = np.array((0.43, -0.3, 0.12))
TOE = np.array((0.44, -0.56, 0.11))
EYE0 = np.array((0.165, -0.33, 4.93))            # the eye as sculpted (before the head's enlargement)
HEAD_PIVOT = np.array((0.0, -0.1, 4.62))
HEAD_SCALE = 1.16


def hs(p):
    """A rest point of the head sculpt, enlarged about the top of the neck."""
    return HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) * HEAD_SCALE


EYE = hs(EYE0)

HAND = B.Hand(WRIST, HAND_TIP, 0.24, {
    'Index': (0.08, 0.1, 0.0, 0.15, 0.042),
    'Middle': (0.027, 0.02, 0.012, 0.165, 0.044),
    'Ring': (-0.027, -0.06, 0.0, 0.155, 0.042),
    'Little': (-0.075, -0.14, -0.025, 0.13, 0.037),
}, thumb=((0.08, 0.08, 0.06), (0.5, 0.65, 0.55), 0.13, 0.11))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.12, 0.04, 3.9)))

# ------------------------------------------------------------------ the trident in the right fist
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.23 + _p * 0.085
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.23 + _pl * 0.085)
HAFT_BELOW, HAFT_ABOVE = 1.8, 3.5            # butt and tine tips from the right fist
WEAPON_PROBES = (-HAFT_BELOW, 0.8, 2.0, HAFT_ABOVE)
CRES_C = HAFT_ABOVE - 0.62                     # the crescent tines' centre (local z)
CRES_R = 0.4

# ------------------------------------------------------------------ the shield on the left forearm
_a = unit(WRIST - ELBOW)
SH_N = unit(np.cross(_a, (0.0, 1.0, 0.0)))                  # out from the forearm's back
SH_U = unit(np.array((0.0, -1.0, 0.0)) - _a * (_a @ np.array((0.0, -1.0, 0.0))))   # the thumb side: shield up
SH_W = unit(np.cross(SH_U, SH_N))
SH_C = lerp(ELBOW, WRIST, 0.52) + SH_N * 0.2               # the shield's centre (the strap)
SH_FRAME = np.stack([SH_W, SH_U, SH_N], axis=1)             # local (w, u, n) -> armature

# ------------------------------------------------------------------ the curled tail
TAIL = [np.array(p) for p in ((0, 0.28, 2.42), (0, 0.5, 2.05), (0, 0.64, 1.55), (0, 0.66, 1.05), (0, 0.58, 0.6),
                              (0, 0.66, 0.3))]
CURL = [np.array(p) for p in ((0, 0.66, 0.3), (0, 0.82, 0.2), (0, 0.98, 0.3), (0, 1.0, 0.48), (0, 0.9, 0.58),
                              (0, 0.8, 0.5), (0, 0.82, 0.4))]

PEARLS_AT = np.array((0.0, -1.35, 0.0))      # the pearls spilt in the death heap


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.06, 2.48), (0, 0.04, 2.9)),
        ('Spine1', 'Hips', (0, 0.04, 2.9), (0, -0.02, 3.38)),
        ('Spine2', 'Spine1', (0, -0.02, 3.38), (0, 0.02, 3.9)),
        ('Neck1', 'Spine2', (0, 0.04, 3.92), (0, -0.04, 4.36)),
        ('Neck', 'Neck1', (0, -0.04, 4.36), (0, -0.1, 4.68)),
        ('Head', 'Neck', (0, -0.1, 4.68), tuple(hs((0, -0.12, 5.12)))),
        ('Eyes', 'Head', tuple(EYE * np.array((0, 1, 1))), tuple(EYE * np.array((0, 1, 1)) + np.array((0, 0, 0.2)))),
        ('Crest1', 'Head', tuple(hs((0, -0.24, 5.1))), tuple(hs((0, -0.28, 5.45)))),
        ('Crest2', 'Head', tuple(hs((0, 0.04, 5.04))), tuple(hs((0, 0.22, 5.32)))),
        ('LoinF1', 'Hips', (0, -0.42, 2.48), (0, -0.5, 1.92)),
        ('LoinF2', 'LoinF1', (0, -0.5, 1.92), (0, -0.52, 1.36)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        ('Water', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        ('Thrown', 'Root', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        ('Shield', 'L_Forearm', tuple(SH_C), tuple(SH_C + SH_U * 0.6)),
        ('Burst', 'Spine2', (0, -0.3, 3.5), (0, -0.3, 3.9)),
        ('Pearls', 'Root', tuple(PEARLS_AT + np.array((0, 0, 0.12))), tuple(PEARLS_AT + np.array((0, 0, 0.5)))),
        ('L_Pauldron', 'L_UpperArm', tuple(SHOULDER + np.array((0.04, 0, 0.1))),
         tuple(SHOULDER + np.array((0.34, 0, -0.1)))),
    ]
    prev = 'Hips'
    for i in range(5):
        out.append((f'Tail{i + 1}', prev, tuple(TAIL[i]), tuple(TAIL[i + 1])))
        prev = f'Tail{i + 1}'
    out.append(('Tail6', 'Tail5', tuple(CURL[0]), tuple(CURL[3])))
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.45), ('Spine2', 0.55))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1',
                                     'Little2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.16, -0.27))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_END = ('Death',)
COLLIDE_LEGS = {'L_Thigh': 0.36, 'R_Thigh': 0.36, 'L_Shin': 0.24, 'R_Shin': 0.24}
POP_SKIP = ('Eyes', 'Loin', 'Tail', 'Thrown', 'Water', 'Burst', 'Pearls', 'Pauldron', 'Shield', 'Crest')
FEET = ('L_Foot', 'R_Foot')
AIM_LIMITS = {'L_Hand': 75.0, 'R_Hand': 75.0, 'L_Foot': 95.0, 'R_Foot': 95.0}
# the props that appear only in one clip ride bones scaled to nothing elsewhere
HIDDEN = {'Thrown': 0.0, 'Water': 0.0, 'Burst': 0.0, 'Pearls': 0.0}


def _chains():
    from rig import Chain
    return [Chain(['LoinF1', 'LoinF2'], 'Hips', gravity=0.55, stiff=0.22, damp=0.16, drag=0.8, collide=True)]


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


class Local(sdf.Prim):
    """A distance function written in a local frame (M: local -> armature columns,
    o: origin); `fn(x, y, z)` gets local coordinates. Not an exact distance (the
    marching only needs the zero set and a sane gradient near it)."""

    def __init__(self, o, M, fn, ext, bone=None):
        self.o, self.M, self.fn, self.bone = np.asarray(o, float), np.asarray(M, float), fn, bone
        e = np.abs(self.M) @ np.asarray(ext, float)
        self.lo, self.hi = self.o - e, self.o + e

    def dist(self, X_, Y_, Z_):
        px, py, pz = X_ - self.o[0], Y_ - self.o[1], Z_ - self.o[2]
        M = self.M
        lx = M[0, 0] * px + M[1, 0] * py + M[2, 0] * pz
        ly = M[0, 1] * px + M[1, 1] * py + M[2, 1] * pz
        lz = M[0, 2] * px + M[1, 2] * py + M[2, 2] * pz
        return self.fn(lx, ly, lz)


# ------------------------------------------------------------------ body (the white coral under the plates)
def build_body(voxel):
    F = Field((-1.55, -1.0, 0.0), (1.55, 0.95, 4.6), voxel)
    F.add(Ellipsoid((0, 0.08, 2.55), (0.44, 0.34, 0.32), bone='Hips'), 0.15)
    F.add(Ellipsoid((0, 0.04, 2.98), (0.36, 0.28, 0.32), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, -0.2, 3.12), (0.34, 0.24, 0.36), bone='Spine1'), 0.14)          # the seahorse belly
    F.add(Ellipsoid((0, -0.06, 3.52), (0.62, 0.46, 0.5), rot_matrix(rx=-0.15), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.14, 3.8), (0.6, 0.3, 0.28), bone='Spine2'), 0.14)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.27, -0.3, 3.62), s), (0.27, 0.16, 0.2), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.06, 3.9), s), _m(SHOULDER, s), 0.18, 0.17, bone=_side('Clavicle', s)), 0.1)
        F.add(Ellipsoid(_m((0.42, 0.1, 3.42), s), (0.2, 0.26, 0.38), bone='Spine2'), 0.1)
    F.add(RoundCone((0, 0.08, 3.86), (0, -0.04, 4.38), 0.3, 0.255, bone='Neck1'), 0.12)
    F.add(RoundCone((0, -0.04, 4.36), (0, -0.1, 4.62), 0.255, 0.225, bone='Neck'), 0.08)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh, 0.23, bone=up), 0.1)
        F.add(RoundCone(sh, el, 0.21, 0.16, bone=up), 0.08)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0, -0.06, 0)), (0.14, 0.14, 0.24), _rot(sh, el), bone=up), 0.05)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.13, bone=_side('ElbowFix', s)), 0.06)
        F.add(RoundCone(el, lerp(el, wr, 0.4), 0.16, 0.17, bone=fo), 0.06)
        F.add(RoundCone(lerp(el, wr, 0.4), wr, 0.17, 0.11, bone=fo), 0.06)
        hp, kn, an, ba, to = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(BALL, s), _m(TOE, s)
        th, shn = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0.02, 0.06)), kn, 0.36, 0.21, bone=th), 0.14)
        F.add(Ellipsoid(lerp(hp, kn, 0.4) + np.array((0.04 * s, 0.0, 0)), (0.26, 0.25, 0.36), _rot(hp, kn), bone=th), 0.1)
        F.add(Sphere(kn, 0.16, bone=_side('KneeFix', s)), 0.07)
        F.add(RoundCone(kn, an, 0.22, 0.14, bone=shn), 0.08)
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0, 0.07, 0.02)), (0.17, 0.16, 0.28), _rot(kn, an), bone=shn), 0.07)
        foot = _side('Foot', s)
        F.add(RoundCone(an, ba + np.array((0, 0, 0.02)), 0.13, 0.11, bone=foot), 0.05)
        F.add(Ellipsoid(an + np.array((0, 0.1, -0.16)), (0.12, 0.13, 0.12), bone=foot), 0.05)
        F.add(RoundCone(ba + np.array((0, 0, 0.0)), to, 0.09, 0.07, bone=_side('Toes', s)), 0.04)
    # coral at the joints: branching white coral growing out of the gaps between plates
    rng = np.random.default_rng(5)

    def coral(c, axis, bone, n=5, size=0.14):
        c, axis = np.asarray(c, float), unit(axis)
        for k in range(n):
            d = unit(axis + rng.normal(0, 0.55, 3))
            L_ = size * rng.uniform(0.6, 1.0)
            a = c + rng.normal(0, 0.03, 3)
            b = a + d * L_
            F.add(RoundCone(a, b, 0.035, 0.018, bone=bone), 0.03)
            d2 = unit(d + rng.normal(0, 0.6, 3))
            F.add(RoundCone(b, b + d2 * L_ * 0.55, 0.018, 0.01, bone=bone), 0.012)
    for s in (1, -1):
        coral(_m(ELBOW, s) + np.array((0.05 * s, 0.12, 0.0)), (0.5 * s, 0.6, 0.2), _side('ElbowFix', s))
        coral(_m(KNEE, s) + np.array((0.16 * s, 0.05, 0.0)), (1.0 * s, 0.1, 0.0), _side('KneeFix', s), n=4)
        coral(_m((0.5, 0.0, 3.86), s), (0.5 * s, -0.3, 0.6), _side('Clavicle', s), n=4, size=0.12)
        coral(_m((0.44, 0.05, 2.6), s), (1.0 * s, 0.0, -0.2), 'Hips', n=4, size=0.12)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.007 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.1)
    return F


# ------------------------------------------------------------------ the seahorse head
def _head_unscaled(voxel):
    F = Field((-0.45, -1.15, 4.3), (0.45, 0.66, 5.72), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, 0.04, 4.42), (0, -0.08, 4.76), 0.225, 0.2, bone='Neck'), 0.08)
    # the skull, tilted back so its crown runs up and over into the nape
    F.add(Ellipsoid((0, -0.12, 4.96), (0.19, 0.26, 0.23), rot_matrix(rx=0.3), bone='Head'), 0.08)
    # the throat under the head, carrying the line from the neck into the snout
    F.add(Ellipsoid((0, -0.24, 4.76), (0.13, 0.2, 0.11), rot_matrix(rx=-0.2), bone='Head'), 0.07)
    for s in (1, -1):
        # the cheek plate (the operculum), its rear edge a raised rim
        cc = _m((0.135, -0.13, 4.84), s)
        F.add(Ellipsoid(cc, (0.075, 0.19, 0.15), rot_matrix(rx=0.25), bone='Head'), 0.05)
        F.ridge(Torus(cc + np.array((0.05 * s, 0.03, 0.0)), (1.0, 0.0, 0.0), 0.13, 0.004), 0.014, k=0.012)
        # brow over the eye with a backswept spine; the eye socket
        F.add(Ellipsoid(_m((0.13, -0.33, 5.0), s), (0.065, 0.12, 0.045), rot_matrix(rx=-0.1), bone='Head'), 0.03)
        F.add(RoundCone(_m((0.15, -0.26, 5.03), s), _m((0.22, -0.12, 5.16), s), 0.03, 0.006, bone='Head'), 0.015)
        F.add(RoundCone(_m((0.17, -0.06, 4.98), s), _m((0.25, 0.08, 5.06), s), 0.026, 0.005, bone='Head'), 0.012)
        F.sub(Ellipsoid(_m(EYE0, s), (0.03, 0.085, 0.04), rot_matrix(rx=0.25)), 0.012)
    # the tube snout, straight and proud, with growth rings and a flared mouth
    a, b = np.array((0, -0.36, 4.88)), np.array((0, -0.96, 4.76))
    F.add(RoundCone(a, b, 0.125, 0.075, bone='Head'), 0.1)
    F.add(Ellipsoid(b + np.array((0, -0.015, 0.0)), (0.09, 0.05, 0.078), bone='Head'), 0.02)
    F.sub(Ellipsoid(b + np.array((0, -0.065, 0.0)), (0.055, 0.03, 0.015)), 0.006)
    for u in (0.25, 0.45, 0.63, 0.8):
        c = lerp(a, b, u)
        F.ridge(Torus(c, unit(b - a), 0.125 - 0.05 * u + 0.004, 0.004), 0.012, k=0.012)
    # tubercles along the snout's flanks and under it, and spines off each cheek plate
    for s in (1, -1):
        for u in (0.18, 0.36, 0.54, 0.7):
            c = lerp(a, b, u)
            r = 0.125 - 0.05 * u
            F.add(Sphere(c + np.array((s * r * 0.86, 0.0, r * 0.32)), 0.017), 0.012)
            F.add(Sphere(c + np.array((s * r * 0.5, 0.0, -r * 0.8)), 0.014), 0.01)
        F.add(RoundCone(_m((0.2, -0.04, 4.78), s), _m((0.27, 0.07, 4.74), s), 0.028, 0.006, bone='Head'), 0.014)
        F.add(RoundCone(_m((0.19, -0.16, 4.7), s), _m((0.24, -0.06, 4.62), s), 0.022, 0.005, bone='Head'), 0.012)
        # a ridged lip at the operculum's lower edge
        F.ridge(RoundCone(_m((0.12, -0.3, 4.72), s), _m((0.17, 0.02, 4.7), s), 0.003, 0.003), 0.012, k=0.012)
    # rings under the throat, where the snout meets the jaw
    for k_ in range(3):
        F.ridge(Torus((0, -0.22 - 0.07 * k_, 4.7 + 0.01 * k_), (0, -0.4, 1.0), 0.09, 0.004), 0.008, k=0.012)
    # a ridge down the top of the snout to the brow
    F.ridge(RoundCone(a + np.array((0, 0.05, 0.13)), lerp(a, b, 0.7) + np.array((0, 0, 0.085)), 0.003, 0.003), 0.012,
            k=0.012)
    # the coronet: a fan crest of nacre fins rising from the brow to the nape,
    # leaning forward at the front and sweeping back; webbed only near the root
    fins = []
    for k in range(6):
        u = k / 5
        base = lerp((0, -0.27, 5.12), (0, 0.17, 4.98), u) + np.array((0, 0, 0.05 * math.sin(math.pi * u)))
        ang = math.radians(-14 + 100 * u)
        ln = 0.5 - 0.22 * u ** 1.5 - 0.06 * (1 - u) ** 3
        d = np.array((0, math.sin(ang), math.cos(ang)))
        tip = base + d * ln
        bone = 'Crest1' if u < 0.45 else 'Crest2'
        # each fin: a thin blade with a stiff leading ray
        side = np.cross(d, (1.0, 0, 0))
        blade_c = base + d * ln * 0.5 + side * 0.03
        F.add(X.Inter(Ellipsoid(blade_c, (0.016, 0.075, ln * 0.52), _rot(base, tip) @ rot_matrix(), bone=bone),
                      Sphere(base + d * ln * 0.45, ln * 0.62)), 0.01)
        F.add(RoundCone(base, tip, 0.03, 0.006, bone=bone), 0.012)
        fins.append((base, tip, bone, ln))
    for (b0, t0, bn, l0), (b1, t1, _, l1) in zip(fins, fins[1:]):
        m0, m1 = lerp(b0, t0, 0.45), lerp(b1, t1, 0.45)
        c = (b0 + b1 + m0 + m1) / 4
        F.add(X.Inter(RoundBox(c, (0.011, 0.3, 0.3), _rot(b0, m0 * 0.5 + m1 * 0.5), radius=0.004),
                      X.Union([Sphere(lerp(b0, t0, 0.25), 0.12), Sphere(lerp(b1, t1, 0.25), 0.12)]), 0.0, bone=bn),
              0.012)
    # the dorsal ridge down the back of the neck: small segmented knobs
    for k in range(5):
        u = k / 4
        p = lerp((0, 0.18, 4.74), (0, 0.25, 4.38), u)
        F.add(RoundCone(p, p + np.array((0, 0.09, 0.03)), 0.042, 0.012, bone='Neck'), 0.02)
    F.displace(lambda X_, Y_, Z_: 0.002 * noise.fbm(X_ * 30, Y_ * 30, Z_ * 30, octaves=2), band=0.04)
    return F


def _enlarge(G, voxel):
    """Resample a head sculpt drawn at its first proportions, enlarged about the top
    of the neck (its weighting primitives carried over enlarged)."""
    lo = hs(G.lo)
    top = G.lo + (np.array(G.shape) - 1) * G.voxel
    F = Field(lo, hs(top), voxel)
    for i, x in enumerate(F.axes[0]):          # a slab at a time: the grid is large
        Y_, Z_ = np.meshgrid(F.axes[1], F.axes[2], indexing='ij')
        P = np.stack([np.full(Y_.size, x), Y_.ravel(), Z_.ravel()], axis=1)
        Q = HEAD_PIVOT + (P - HEAD_PIVOT) / HEAD_SCALE
        F.d[i] = (G.sample(Q) * HEAD_SCALE).reshape(Y_.shape).astype(np.float32)
    for prim, k in G.prims:
        F.prims.append((_ScaledPrim(prim), k))
    return F


def build_head(voxel):
    """The head, set 16 percent larger than first drawn so the snout and the crest
    read from the MMO camera."""
    return _enlarge(_head_unscaled(voxel / HEAD_SCALE), voxel)


class _ScaledPrim(sdf.Prim):
    def __init__(self, prim):
        self.p, self.bone = prim, prim.bone
        self.lo, self.hi = hs(prim.lo), hs(prim.hi)

    def dist(self, X_, Y_, Z_):
        o, k = HEAD_PIVOT, HEAD_SCALE
        return self.p.dist(o[0] + (X_ - o[0]) / k, o[1] + (Y_ - o[1]) / k, o[2] + (Z_ - o[2]) / k) * k


def build_circlet(voxel):
    return _enlarge(_circlet_unscaled(voxel / HEAD_SCALE), voxel)


def _circlet_unscaled(voxel):
    """The moon diadem: a silver crescent set on the brow at the crest's root."""
    F = Field((-0.3, -0.6, 4.8), (0.3, 0.1, 5.3), voxel)
    F.add(RoundCone((0, -0.3, 5.12), (0, -0.35, 5.17), 0.025, 0.018, bone='Head'), 0.01)
    c = np.array((0, -0.36, 5.2))
    n = unit((0, -1.0, 0.45))
    M = frame_from(n)

    def cres(x, y, z):
        d1 = np.sqrt(x * x + y * y) - 0.09
        d2 = -(np.sqrt(x * x + (y - 0.04) ** 2) - 0.072)
        return np.maximum(np.maximum(d1, d2), np.abs(z) - 0.014)
    F.add(Local(c, M, cres, (0.11, 0.11, 0.03), bone='Head'), 0.006)
    return F


# ------------------------------------------------------------------ the curled tail (nacre rings)
def build_tail(voxel):
    F = Field((-0.4, 0.0, 0.05), (0.4, 1.25, 2.75), voxel)
    rad = (0.25, 0.2, 0.16, 0.13, 0.1, 0.08)
    for i in range(5):
        F.add(RoundCone(TAIL[i], TAIL[i + 1], rad[i], rad[i + 1], bone=f'Tail{i + 1}'), 0.08 if i else 0.12)
    cr = (0.08, 0.07, 0.06, 0.05, 0.042, 0.035, 0.03)
    for i in range(len(CURL) - 1):
        F.add(RoundCone(CURL[i], CURL[i + 1], cr[i], cr[i + 1], bone='Tail6'), 0.03)
    # segment rings: a ridge every so often down the whole length, square-ish like a seahorse's
    pts = TAIL + CURL[1:]
    radii = list(rad) + list(cr[1:])
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L_ = np.linalg.norm(b - a)
        n = max(1, int(L_ / 0.11))
        for j in range(n):
            u = (j + 0.5) / n
            c = lerp(a, b, u)
            r = radii[i] + (radii[i + 1] - radii[i]) * u
            F.ridge(Torus(c, unit(b - a), r + 0.006, 0.005), 0.016 * min(1.0, r / 0.1), k=0.014)
            # a knob at each ring's back corner
            if r > 0.06 and (j + i) % 2 == 0:
                side = unit(np.cross(unit(b - a), (1.0, 0, 0)))
                F.add(Sphere(c - side * r * 0.95, 0.03), 0.02, weight=False)
        acc += L_
    return F


# ------------------------------------------------------------------ hands (gauntlets)
def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.2, w + down * 0.7) - 0.25
    hi = np.maximum(w - down * 0.2, w + down * 0.7) + 0.25
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.16, w + down * 0.02, 0.1, 0.09, bone=hand), 0.03)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.13, (0.095, 0.038, 0.085), Rm, radius=0.035, bone=hand), 0.03)
    # knuckle plates on the back of the hand
    F.add(RoundBox(w + down * 0.2 - palm * 0.05, (0.1, 0.012, 0.05), Rm, radius=0.012, bone=hand), 0.012)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.046
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.9, bone=b1), 0.012)
        F.add(Sphere(mid, r0 * 0.95, bone=b2), 0.01)
        F.add(RoundCone(mid, tip, r0 * 0.88, r0 * 0.62, bone=b2), 0.01)
        d2 = unit(tip - mid)
        F.add(RoundCone(tip - d2 * 0.02, tip + d2 * 0.05 + palm * 0.02, r0 * 0.6, 0.008, bone=b2), 0.008)
    return F


# ------------------------------------------------------------------ the nacre plate
def _lames(Z_, pitch, phase=0.0, sharp=0.75):
    """Segment steps (0..1) every `pitch` yards along a coordinate: a seahorse ring."""
    s = np.sin((Z_ / pitch + phase) * math.tau)
    return np.clip((s - (1 - 2 * sharp)) / (2 * sharp), 0, 1)


def plates(Fb, voxel):
    rg = X.ramp
    out = []
    noise = Noise(31)
    dent = lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=2)  # noqa: E731

    def layer(name, lo, hi, off, thick, mask, mat='nacre', binding='transfer', bone='', allow=None, extra=None):
        G = X.layer_field(Fb, lo, hi, voxel, off, thick, mask, extra=extra, noise=dent)
        out.append((name, G, mat, binding, bone, allow))

    def onto(p, lift):
        """A point carried onto the body's surface along its gradient, then lifted."""
        q = np.asarray(p, float)[None, :]
        for _ in range(4):
            d = Fb.sample(q)
            n = Fb.gradient(q)
            q = q - n * d[:, None]
        return (q + Fb.gradient(q) * lift)[0]

    def rims(u, a, b, w=0.035, h=0.022):
        """Raised borders at both ends (a, b) of a plate measured along u."""
        return h * (rg(u, a, a + w * 0.4) * (1 - rg(u, a + w, a + w * 1.4))
                    + rg(u, b - w * 1.4, b - w) * (1 - rg(u, b - w * 0.4, b)))

    # the cuirass: one smooth breast- and backplate; the seahorse's rings only
    # over the belly, where they read as the creature's own segments
    def cuir_mask(X_, Y_, Z_):
        return rg(Z_, 2.68, 2.76) * (1 - rg(Z_, 3.86, 3.94)) * (1 - rg(np.abs(X_), 0.52, 0.6))

    def cuir_thick(X_, Y_, Z_):
        upper = rg(Z_, 3.26, 3.34)
        return 0.05 + 0.035 * _lames(Z_, 0.19, 0.1) * (1 - upper) + 0.025 * upper + 0.02 * rg(Z_, 3.84, 3.88)

    def cuir_extra(G):
        # a keel down the breast, tubercle spines at the belly rings' flanks, and
        # the dorsal ridge of the seahorse down the backplate
        G.add(RoundCone((0, -0.55, 3.75), (0, -0.5, 3.3), 0.035, 0.03), 0.03)
        for z in np.arange(2.88, 3.3, 0.19):
            for s in (1, -1):
                ang = 0.95
                r = 0.52
                p = np.array((s * r * math.sin(ang), -r * math.cos(ang) * 0.85, z + 0.05))
                G.add(RoundCone(p, p + np.array((0.05 * s, -0.05, 0.04)), 0.025, 0.006), 0.012)
        for z in np.linspace(3.78, 2.86, 6):
            p = onto((0.0, 0.6, z), 0.075)
            G.add(RoundCone(p - np.array((0, 0.02, 0.05)), p + np.array((0, 0.09, 0.05)), 0.04, 0.01), 0.025)
    layer('Cuirass', (-0.85, -0.85, 2.55), (0.85, 0.7, 4.05), 0.025, cuir_thick, cuir_mask,
          allow=('Hips', 'Spine1', 'Spine2'), extra=cuir_extra)

    # the gorget: stacked rings round the neck's base, flaring at the bottom
    def gor_mask(X_, Y_, Z_):
        return rg(Z_, 3.8, 3.86) * (1 - rg(Z_, 4.3, 4.36))

    def gor_off(X_, Y_, Z_):
        return 0.03 + 0.1 * rg(Z_, 4.1, 3.84)

    def gor_thick(X_, Y_, Z_):
        return 0.04 + 0.025 * _lames(Z_, 0.12, 0.25)
    layer('Gorget', (-0.8, -0.8, 3.7), (0.8, 0.75, 4.45), gor_off, gor_thick, gor_mask, allow=('Spine2', 'Neck1'))

    # pauldrons: a great dome and two overlapping lames below it, each smaller,
    # each flaring at its lower edge and tucked under the one above
    for s in (1, -1):
        c = _m(SHOULDER, s) + np.array((0.06 * s, 0.0, 0.08))
        z1, z2, z3 = c[2] - 0.05, c[2] - 0.21, c[2] - 0.33

        def pa_mask(X_, Y_, Z_, c=c, s=s, z3=z3):
            d = np.sqrt((X_ - c[0]) ** 2 + (Y_ - c[1]) ** 2 + (Z_ - c[2]) ** 2)
            narrow = np.where(Z_ < c[2] - 0.21, 0.08, 0.0)
            return rg(d, 0.52 - narrow, 0.44 - narrow) * rg(Z_, z3 - 0.02, z3 + 0.04) * rg(X_ * s, 0.42, 0.52)

        def pa_off(X_, Y_, Z_, c=c, z1=z1, z2=z2, z3=z3):
            dome = 0.06 + 0.05 * rg(Z_, c[2] + 0.18, z1)
            l1 = 0.085 + 0.06 * rg(Z_, z1, z2)
            l2 = 0.11 + 0.06 * rg(Z_, z2, z3)
            return np.where(Z_ > z1, dome, np.where(Z_ > z2, l1, l2))

        def pa_thick(X_, Y_, Z_, z1=z1, z2=z2):
            edge = 0.018 * (rg(Z_, z1 + 0.05, z1 + 0.01) * rg(Z_, z1 - 0.01, z1 + 0.01)
                            + rg(Z_, z2 + 0.05, z2 + 0.01) * rg(Z_, z2 - 0.01, z2 + 0.01))
            return 0.05 + edge

        def pa_fin(G, c=c, s=s):
            for k in range(4):
                u = k / 3
                p = c + np.array((0.12 * s, -0.22 + 0.42 * u, 0.2 - 0.04 * abs(u - 0.5)))
                G.add(RoundCone(p, p + np.array((0.08 * s, 0.03, 0.17 - 0.05 * abs(u - 0.4))), 0.035, 0.008), 0.02)
        layer(_side('Pauldron', s), c - 0.66, c + 0.66, pa_off, pa_thick, pa_mask, binding='rigid',
              bone=_side('Pauldron', s), extra=pa_fin)

    # vambraces: one smooth plate with raised rims at both ends
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)

        def va_mask(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return rg(u, 0.18, 0.24) * (1 - rg(u, 0.9, 0.96)) * rg(d, 0.26, 0.21)

        def va_thick(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return 0.04 + rims(u, 0.21, 0.93, 0.05)
        layer(_side('Vambrace', s), np.minimum(el, wr) - 0.35, np.maximum(el, wr) + 0.35, 0.02, va_thick, va_mask,
              binding='rigid', bone=_side('Forearm', s))

    # tassets: two lames hanging from the belt over each hip
    for s in (1, -1):
        def ta_mask(X_, Y_, Z_, s=s):
            return (rg(Z_, 1.96, 2.04) * (1 - rg(Z_, 2.5, 2.56)) * rg(X_ * s, 0.06, 0.14) * (1 - rg(Y_, 0.08, 0.2)))

        def ta_off(X_, Y_, Z_):
            return 0.04 + 0.12 * rg(Z_, 2.5, 2.0)

        def ta_thick(X_, Y_, Z_):
            return 0.04 + 0.03 * _lames(Z_, 0.24, 0.35)
        layer(_side('Tasset', s), np.array((0.0 if s > 0 else -0.85, -0.75, 1.85)),
              np.array((0.85 if s > 0 else 0.0, 0.5, 2.68)), ta_off, ta_thick, ta_mask,
              allow=('Hips', _side('Thigh', s)))
        # the cuisse: a single plate over the thigh's front, rimmed
        hp, kn = _m(HIP, s), _m(KNEE, s)

        def cu_mask(X_, Y_, Z_, hp=hp, kn=kn):
            d, u = X.seg_dist(X_, Y_, Z_, hp, kn)
            return rg(u, 0.38, 0.45) * (1 - rg(u, 0.82, 0.88)) * rg(Y_, 0.02, -0.08)

        def cu_thick(X_, Y_, Z_, hp=hp, kn=kn):
            d, u = X.seg_dist(X_, Y_, Z_, hp, kn)
            return 0.045 + rims(u, 0.41, 0.86, 0.045)
        layer(_side('Cuisse', s), np.minimum(hp, kn) - 0.42, np.maximum(hp, kn) + 0.42, 0.02,
              cu_thick, cu_mask, binding='rigid', bone=_side('Thigh', s))
        # the knee cop: a broad dome with a fin
        kn = _m(KNEE, s)

        def kn_mask(X_, Y_, Z_, kn=kn):
            d = np.sqrt((X_ - kn[0]) ** 2 + (Y_ - kn[1] + 0.06) ** 2 + (Z_ - kn[2]) ** 2)
            return rg(d, 0.28, 0.22) * rg(-Y_, 0.16, 0.28)

        def kn_fin(G, kn=kn, s=s):
            p = kn + np.array((0.18 * s, -0.04, 0.0))
            G.add(X.Inter(Ellipsoid(p + np.array((0.08 * s, 0.04, 0.0)), (0.12, 0.14, 0.022),
                                    rot_matrix(ry=math.pi / 2)), Sphere(p, 0.22)), 0.015)
        layer(_side('KneeCop', s), kn - 0.4, kn + 0.4, 0.035, 0.055, kn_mask, binding='rigid', bone=_side('KneeFix', s),
              extra=kn_fin)
        # the greave: one smooth shell over the shin, a keel down its front, raised
        # rims at both ends (a carved wave border runs inside the upper rim)
        an = _m(ANKLE, s)

        def gr_mask(X_, Y_, Z_, kn=kn, an=an):
            d, u = X.seg_dist(X_, Y_, Z_, kn, an)
            return rg(u, 0.16, 0.22) * (1 - rg(u, 0.88, 0.94)) * rg(d, 0.32, 0.26)

        def gr_thick(X_, Y_, Z_, kn=kn, an=an):
            d, u = X.seg_dist(X_, Y_, Z_, kn, an)
            return 0.045 + rims(u, 0.19, 0.91, 0.05, 0.026)

        def gr_keel(G, kn=kn, an=an):
            pts = [onto(lerp(kn, an, u) + np.array((0, -0.3, 0)), 0.065) for u in (0.24, 0.5, 0.86)]
            G.add(sdf.Polyline(pts, [0.03, 0.026, 0.022]), 0.03)
        layer(_side('Greave', s), np.minimum(kn, an) - 0.35, np.maximum(kn, an) + 0.35, 0.02,
              gr_thick, gr_mask, binding='rigid', bone=_side('Shin', s), extra=gr_keel)
        # the sabaton: one sculpted shoe of plate, a toe cap over the instep and a
        # ridge along the top
        to, ba = _m(TOE, s), _m(BALL, s)

        def sa_mask(X_, Y_, Z_, an=an):
            return rg(Z_, 0.07, 0.11) * rg(Y_, an[1] + 0.25, an[1] + 0.12)

        def sa_thick(X_, Y_, Z_, ba=ba):
            return 0.045 + 0.022 * rg(Y_, ba[1] + 0.04, ba[1] - 0.02)

        def sa_ridge(G, an=an, ba=ba, to=to):
            pts = [onto(np.array((an[0], an[1] - 0.06, 0.5)), 0.06), onto(np.array((ba[0], ba[1], 0.35)), 0.07),
                   onto(np.array((to[0], to[1] + 0.04, 0.3)), 0.06)]
            G.add(sdf.Polyline(pts, [0.026, 0.024, 0.018]), 0.03)
        layer(_side('Sabaton', s), np.array((min(an[0], to[0]) - 0.3, to[1] - 0.2, -0.05)),
              np.array((max(an[0], to[0]) + 0.3, an[1] + 0.35, 0.62)), 0.015,
              sa_thick, sa_mask, allow=(_side('Foot', s), _side('Toes', s)), extra=sa_ridge)

    # the silver belt with a crescent buckle
    def belt_mask(X_, Y_, Z_):
        return rg(Z_, 2.52, 2.56) * (1 - rg(Z_, 2.66, 2.7))

    def buckle(G):
        c = np.array((0, -0.42, 2.62))

        def cres(x, y, z):
            d1 = np.sqrt(x * x + y * y) - 0.12
            d2 = -(np.sqrt((x) ** 2 + (y - 0.05) ** 2) - 0.1)
            return np.maximum(np.maximum(d1, d2), np.abs(z) - 0.02)
        G.add(Local(c, frame_from((0, -1.0, 0.0)), cres, (0.14, 0.14, 0.03)), 0.008)
    layer('Belt', (-0.75, -0.75, 2.4), (0.75, 0.6, 2.85), 0.03, 0.035, belt_mask, mat='silver',
          allow=('Hips', 'Spine1'), extra=buckle)
    return out


def build_tabard(voxel):
    """The sea-silk tabard: a front panel from the belt to below the knees, cut in
    three tails at its hem."""
    F = Field((-0.4, -0.72, 1.15), (0.4, -0.2, 2.62), voxel)
    cyl = np.array((0, 0.08, 0))
    shell = X.Shell(RoundCone(cyl + np.array((0, 0, 0.6)), cyl + np.array((0, 0, 3.0)), 0.62, 0.38), 0.03)
    box = RoundBox((0, -0.5, 1.92), (0.25, 0.3, 0.66), radius=0.02)
    F.add(X.Inter(shell, box, 0.0), 0.0, weight=False)
    for x in (-0.085, 0.085):
        F.sub(RoundBox((x, -0.5, 1.2), (0.012, 0.3, 0.14), radius=0.005), 0.01)
    noise = Noise(14)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 2, Z_ * 1.2, octaves=3), band=0.05)
    return F


def tabard_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'LoinF1', 'LoinF2']
    W = np.zeros((len(P), 3))
    t = np.clip((2.5 - P[:, 2]) / (2.5 - 1.25), 0, 1)
    hip = np.clip(1 - t / 0.1, 0, 1)
    low = np.clip((t - 0.4) / 0.3, 0, 1)
    low = low * low * (3 - 2 * low)
    W[:, 0] = hip
    W[:, 1] = (1 - hip) * (1 - low)
    W[:, 2] = (1 - hip) * low
    W = R.relax(W, E, iters=3)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def tabard_paint(obj):
    """RegGlyph: the moon embroidered on the tabard (a full moon held in a crescent)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, z = P[:, 0], P[:, 2] - 2.08
    r = np.sqrt(x * x + z * z)
    disc = np.clip((0.07 - r) / 0.012, 0, 1)
    ring = np.clip((0.15 - r) / 0.012, 0, 1) * np.clip((np.sqrt(x * x + (z - 0.06) ** 2) - 0.13) / 0.012, 0, 1)
    hem = np.clip((1.36 - P[:, 2]) / 0.02, 0, 1) * (P[:, 2] > 1.26) + np.clip((P[:, 2] - 2.4) / 0.02, 0, 1)
    vals = {'RegGlyph': np.maximum(disc, ring), 'RegHem': np.clip(hem, 0, 1)}
    _write(obj, vals)


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def _crescent2d(u, v, r, cut=0.42, w=0.0):
    """A crescent (horns up) in a plane: inside a disc of r, outside the same disc
    shifted up by cut*r. Returns 0..1 with a soft edge."""
    a = (r - np.sqrt(u * u + v * v)) / (r * 0.08)
    b = (np.sqrt(u * u + (v - cut * r) ** 2) - r * 0.92) / (r * 0.08)
    return np.clip(np.minimum(a, b), 0, 1)


def cuirass_paint(obj):
    """The moon on the breast: a crescent cut in the plate, lit from within."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    front = P[:, 1] < -0.3
    u, v = P[:, 0], P[:, 2] - 3.36
    cres = _crescent2d(u, v, 0.26, cut=0.5)
    moon = np.clip((0.1 - np.sqrt(u * u + (v - 0.15) ** 2)) / 0.012, 0, 1)
    g = np.maximum(cres, moon) * front
    _write(obj, {'RegGlyph': g})


def greave_paint(s):
    """RegInlay: a carved running-wave border inside the greave's upper rim, and a
    row of crescents inside its lower one."""
    kn, an = _m(KNEE, s), _m(ANKLE, s)

    def paint(obj):
        from rig import mesh_arrays
        P, _ = mesh_arrays(obj)
        ax = an - kn
        L2 = ax @ ax
        u = np.clip(((P - kn) @ ax) / L2, 0, 1)
        c = kn + u[:, None] * ax
        rel = P - c
        th = np.arctan2(rel[:, 0] * s, -rel[:, 1])
        v = (u - 0.285) / 0.03
        wave = np.clip(1 - np.abs(v - 0.7 * np.sin(th * 7)) / 0.32, 0, 1) * (np.abs(v) < 1.3)
        w2 = (u - 0.81) / 0.028
        k = th * 6 / math.pi
        f = k - np.floor(k + 0.5)
        dots = _crescent2d(f * 0.22, w2 * 0.028, 0.03) * (np.abs(w2) < 1.4)
        _write(obj, {'RegInlay': np.maximum(wave, dots)})
    return paint


# ------------------------------------------------------------------ the trident (local: +Z up the haft)
def build_trident(voxel):
    HB, HA = HAFT_BELOW, HAFT_ABOVE
    cz, R = CRES_C, CRES_R
    top = cz - R - 0.22
    F = Field((-0.62, -0.18, -HB - 0.22), (0.62, 0.18, HA + 0.1), voxel)
    F.add(RoundCone((0, 0, -HB + 0.12), (0, 0, top), 0.068, 0.062), 0.01)
    # the coral twist: two helical ridges round the shaft
    for ph in (0.0, math.pi):
        pts, rad = [], []
        for i in range(110):
            z = -HB + 0.15 + (top - (-HB + 0.15)) * i / 109
            a = ph + z * 4.2
            pts.append((0.064 * math.cos(a), 0.064 * math.sin(a), z))
            rad.append(0.02)
        F.add(sdf.Polyline(pts, rad), 0.014)
    # nacre bands: the grip rings and the collars
    for z in (-0.36, 0.34, -HB + 0.24, top - 0.04):
        F.add(Torus((0, 0, z), (0, 0, 1), 0.08, 0.022), 0.01)
    # the butt: a small spiral shell
    F.add(RoundCone((0, 0, -HB - 0.16), (0, 0, -HB + 0.16), 0.025, 0.1), 0.02)
    F.add(Torus((0, 0, -HB + 0.05), (0, 0, 1), 0.08, 0.024), 0.012)
    # the socket rising to the crescent
    F.add(RoundCone((0, 0, top), (0, 0, cz - R + 0.03), 0.075, 0.09), 0.02)
    # the crescent moon: its horns are the side tines
    pts, rad = [], []
    for i in range(33):
        phi = math.pi + math.pi * i / 32
        k = math.sin(phi - math.pi)
        pts.append((R * math.cos(phi), 0.0, cz + R * math.sin(phi)))
        rad.append(0.022 + 0.062 * k ** 1.5)
    F.add(sdf.Polyline(pts, rad), 0.014)
    for s in (1, -1):
        h0 = np.array((s * R, 0.0, cz))
        h1 = h0 + np.array((s * 0.05, 0.0, 0.26))
        h2 = h1 + np.array((-s * 0.03, 0.0, 0.24))
        F.add(sdf.Polyline([h0, h1, h2], [0.024, 0.02, 0.005]), 0.012)
        F.add(RoundCone(h1 + np.array((0, 0, 0.15)), h1 + np.array((-s * 0.09, 0, 0.05)), 0.016, 0.004), 0.008)
    # the central tine: a leaf blade with a ridge, barbed at its root
    base = cz - R + 0.03
    F.add(RoundCone((0, 0, base), (0, 0, HA - 0.42), 0.058, 0.046), 0.012)
    F.add(Ellipsoid((0, 0, HA - 0.27), (0.1, 0.034, 0.29)), 0.024)
    F.add(X.Prism((0, 0, HA - 0.32), (0, 0, HA), 0.08, n=4, tip=0.55, rot=math.pi / 4), 0.012)
    for s in (1, -1):
        F.add(RoundCone((s * 0.07, 0, HA - 0.44), (s * 0.12, 0, HA - 0.58), 0.018, 0.004), 0.008)
    return F


def trident_paint(obj):
    """RegCoral on the twisted shaft (white coral), nacre elsewhere."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    r = np.sqrt(P[:, 0] ** 2 + P[:, 1] ** 2)
    top = CRES_C - CRES_R - 0.22
    coral = (r < 0.095) & (P[:, 2] > -HAFT_BELOW + 0.3) & (P[:, 2] < top - 0.08)
    ring = np.zeros(len(P), bool)
    for z in (-0.36, 0.34):
        ring |= np.abs(P[:, 2] - z) < 0.04
    _write(obj, {'RegCoral': (coral & ~ring).astype(float)})


def trident_matrix():
    """The trident's local frame set in the right fist: +Z up the haft, the tines'
    spread across the palm's normal (so held upright the crescent faces forward)."""
    ax = np.array(WEAPON_AXIS)
    w, down, width, palm = HAND.frame(-1)
    xl = unit(palm - ax * (palm @ ax))
    yl = np.cross(ax, xl)
    M = np.eye(4)
    M[:3, 0] = xl
    M[:3, 1] = yl
    M[:3, 2] = ax
    M[:3, 3] = GRIP_R
    return M


# ------------------------------------------------------------------ the scallop shield (local: w across, u up, n out)
HINGE = np.array((0.0, -0.5, 0.0))
SC_R, SC_TH, SC_RIBS = 1.02, 0.95, 13


def _scallop(x, y, z):
    hx, hy = x - HINGE[0], y - HINGE[1]
    r = np.sqrt(hx * hx + hy * hy)
    th = np.arctan2(hx, hy)
    rr = np.clip(r / SC_R, 0, 1.2)
    rib = 0.5 + 0.5 * np.cos(th * SC_RIBS / SC_TH * math.pi / 2 * 2)
    dome = 0.26 * np.sqrt(np.clip(1 - (rr * 0.92) ** 2, 0, 1)) - 0.06 + 0.035 * rib * np.clip(rr * 2.5, 0, 1)
    t = 0.045
    d_shell = np.abs(z - (dome - t * 0.5)) - t * 0.5
    rim = SC_R * (1.0 + 0.03 * rib)
    d_rim = r - rim
    d_fan = (np.abs(th) - SC_TH) * np.maximum(r, 0.15)
    return np.maximum(d_shell, np.maximum(d_rim, d_fan))


def _ears(x, y, z):
    d = None
    for s in (1, -1):
        bx = np.abs(x - s * 0.24) - 0.18
        by = np.abs(y - (HINGE[1] + 0.05)) - 0.1
        bz = np.abs(z - 0.15) - 0.022
        e = np.sqrt(np.maximum(bx, 0) ** 2 + np.maximum(by, 0) ** 2 + np.maximum(bz, 0) ** 2) + \
            np.minimum(np.maximum(bx, np.maximum(by, bz)), 0) - 0.01
        d = e if d is None else np.minimum(d, e)
    return d


def build_shield(voxel):
    """The scallop in its local frame (the caller places it): a ribbed fan, ears at
    the hinge, a silver crescent boss with a pearl added by the dressing."""
    F = Field((-1.1, -0.75, -0.2), (1.1, 0.75, 0.42), voxel)
    I = np.eye(3)
    F.add(Local((0, 0, 0), I, _scallop, (1.1, 0.75, 0.42)), 0.0, weight=False)
    F.add(Local((0, 0, 0), I, _ears, (0.5, 0.2, 0.05)), 0.03, weight=False)
    # growth lines: fine concentric grooves across the ribs
    for k in range(1, 7):
        rr = SC_R * k / 7.2
        F.groove(Torus(HINGE + np.array((0, 0, 0.1)), (0, 0, 1), rr, 0.004), 0.008, k=0.01)
    # the strap block behind
    F.add(RoundBox((0, 0, 0.04), (0.12, 0.36, 0.1), radius=0.03), 0.03, weight=False)
    return F


def shield_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    hx, hy = P[:, 0] - HINGE[0], P[:, 1] - HINGE[1]
    r = np.sqrt(hx * hx + hy * hy)
    th = np.arctan2(hx, hy)
    rib = 0.5 + 0.5 * np.cos(th * SC_RIBS / SC_TH * math.pi)
    _write(obj, {'RegRib': rib * np.clip(r / 0.3, 0, 1), 'RegRad': np.clip(r / SC_R, 0, 1)})


def shield_matrix():
    M = np.eye(4)
    M[:3, :3] = SH_FRAME
    M[:3, 3] = SH_C
    return M


def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand, vp = 0.013 * k, 0.0058 * k, 0.005 * k, 0.0095 * k
    Fb = build_body(vb)
    S = [Sculpt('Body', Fb, 'coral', 7000, spots=[((0, -0.1, 4.2), 0.3, 0.4)], tau=0.05),
         Sculpt('Head', build_head(vh), 'nacre', 4300, spots=[((0, -0.3, 4.95), 0.25, 1.0)], tau=0.02),
         Sculpt('Tail', build_tail(0.009 * k), 'nacre', 1500, tau=0.04),
         Sculpt('Circlet', build_circlet(0.005 * k), 'silver', 500, binding='rigid', bone='Head'),
         Sculpt('L_Gauntlet', build_hand(1, vhand), 'nacre', 1100, tau=0.012),
         Sculpt('R_Gauntlet', build_hand(-1, vhand), 'nacre', 1100, tau=0.012)]
    targets = {'Cuirass': 2300, 'Gorget': 850, 'Pauldron': 1100, 'Vambrace': 420, 'Tasset': 520, 'Cuisse': 360,
               'KneeCop': 300, 'Greave': 620, 'Sabaton': 420, 'Belt': 520}
    paints = {'Cuirass': cuirass_paint, 'L_Greave': greave_paint(1), 'R_Greave': greave_paint(-1)}
    for name, G, mat, binding, bone, allow in plates(Fb, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        S.append(Sculpt(name, G, mat, targets[key], binding=binding, bone=bone, allow=allow, relax=8,
                        paint=paints.get(name)))
    S.append(Sculpt('Tabard', build_tabard(vp), 'silk', 700, binding='own', weigh=tabard_weights,
                    paint=tabard_paint))
    return S
