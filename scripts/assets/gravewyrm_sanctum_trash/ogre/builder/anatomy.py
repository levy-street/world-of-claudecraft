"""Ogre Sledge-Hauler: skeleton and sculpts (rest pose), in yards.

A mountain ogre of the clans that sold their axes to the cult, put to hauling the
cult's sledges up the glacier. Huge and hunched: a barrel chest over a hanging
gut, a neck lost in the trapezius, a small heavy-jawed head with an underbite and
two broken tusks, short thick legs, arms to the knee and fists like anvils. Grey
mountain hide gone blue-violet with cold, frostbite black at the fingers, the
ears and the nose. A shaggy fur mantle on the shoulders, a fur kilt, fur wraps on
the shins; the HAULING HARNESS: two broad straps crossed over the chest and the
back on a big iron ring at the sternum and another between the shoulder blades,
a padded yoke, and from the back ring two short chains with sledge hooks swinging
at his hips. A haul chain is wrapped round his right fist, a heavy iron hook
hanging off it (it whips round when he swings). His Ice Block Toss uses his own
block (the IceBlock mesh on the Weapon bone between his palms, scaled to nothing in
every other clip).

Axes: yards, +Z up, faces -Y, his left is +X. Rest is an A-pose. Top of the fur
mantle 5.8 yd (2.2 knights).
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit
from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'OgreSledgeHauler'
PREFIX = 'sledge_hauler'

SHOULDER = np.array((1.02, 0.1, 4.42))
ELBOW = np.array((1.6, 0.28, 3.38))
WRIST = np.array((2.02, 0.02, 2.4))
HAND_TIP = np.array((2.22, -0.14, 1.74))
HIP = np.array((0.44, 0.12, 2.3))
KNEE = np.array((0.52, -0.12, 1.28))
ANKLE = np.array((0.55, 0.12, 0.32))
BALL = np.array((0.57, -0.42, 0.1))
TOE = np.array((0.57, -0.72, 0.09))
# The head is sculpted at a realistic ogre size and grown about the top of the
# neck (HEAD_PIVOT) by HEAD_SCALE: the game's chunky proportions want a head that
# reads at a distance, its brow clear of the fur mantle.
HEAD_PIVOT = np.array((0.0, -0.2, 4.72))
HEAD_SCALE = 1.4


def hp(p):
    """A head-space point carried onto the grown head."""
    return tuple(HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) * HEAD_SCALE)


def hr(r):
    return tuple(np.asarray(r, float) * HEAD_SCALE) if np.ndim(r) else float(r) * HEAD_SCALE


EYE = np.array(hp((0.13, -0.6, 5.12)))
EYE_R = 0.045 * HEAD_SCALE

HAND = B.Hand(WRIST, HAND_TIP, 0.36, {
    'Index': (0.115, 0.08, 0.0, 0.17, 0.068),
    'Middle': (0.035, 0.0, 0.01, 0.18, 0.072),
    'Ring': (-0.045, -0.06, -0.01, 0.17, 0.068),
    'Little': (-0.12, -0.14, -0.05, 0.13, 0.058),
}, thumb=((0.11, 0.12, 0.08), (0.55, 0.62, 0.55), 0.15, 0.13))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.18, -0.02, 4.32)))

_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.24 + _p * 0.14              # the right palm's face
WEAPON_AXIS = tuple(unit(_p))                    # the 'weapon' is the ice block: from the right palm across to the left
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(-_pl))
GRIP_OFFSET_L = tuple(_dl * 0.24 + _pl * 0.14)
BLOCK_HALF = 0.5                                 # half the block's width between the palms
WEAPON_PROBES = (0.0, BLOCK_HALF, 2 * BLOCK_HALF)
RING_FRONT = np.array((0.0, -0.98, 3.86))
RING_BACK = np.array((0.0, 0.84, 4.06))
HOOK_STATION = [np.array(p) for p in ((-2.04, -0.02, 2.36), (-2.12, -0.06, 1.98), (-2.18, -0.08, 1.58),
                                        (-2.2, -0.1, 1.18))]
HAUL = {
    'L': [np.array(p) for p in ((0.3, 0.88, 3.95), (0.5, 0.92, 3.45), (0.62, 0.86, 2.95), (0.68, 0.78, 2.5))],
    'R': [np.array(p) for p in ((-0.3, 0.88, 3.95), (-0.5, 0.92, 3.45), (-0.62, 0.86, 2.95), (-0.68, 0.78, 2.5))],
}


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.12, 2.36), (0, 0.1, 2.9)),
        ('Spine1', 'Hips', (0, 0.1, 2.9), (0, 0.08, 3.55)),
        ('Spine2', 'Spine1', (0, 0.08, 3.55), (0, 0.06, 4.35)),
        ('Belly', 'Spine1', (0, -0.4, 3.0), (0, -0.95, 2.85)),
        ('Neck', 'Spine2', (0, 0.06, 4.45), hp((0, -0.3, 4.85))),
        ('Head', 'Neck', hp((0, -0.3, 4.85)), hp((0, -0.34, 5.5))),
        ('Jaw', 'Head', hp((0, -0.36, 4.98)), hp((0, -0.66, 4.78))),
        ('KiltF1', 'Hips', (0, -0.62, 2.45), (0, -0.7, 1.95)),
        ('KiltF2', 'KiltF1', (0, -0.7, 1.95), (0, -0.72, 1.5)),
        ('KiltB1', 'Hips', (0, 0.62, 2.45), (0, 0.72, 1.95)),
        ('KiltB2', 'KiltB1', (0, 0.72, 1.95), (0, 0.74, 1.5)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
    ]
    prev = 'R_Hand'
    for i in range(3):
        out.append((f'Hook{i + 1}', prev, tuple(HOOK_STATION[i]), tuple(HOOK_STATION[i + 1])))
        prev = f'Hook{i + 1}'
    for sd in ('L', 'R'):
        prev = 'Spine2'
        for i in range(3):
            out.append((f'Haul{sd}{i + 1}', prev, tuple(HAUL[sd][i]), tuple(HAUL[sd][i + 1])))
            prev = f'Haul{sd}{i + 1}'
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.4), ('Spine2', 0.6))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1',
                                     'Little2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.2, -0.28))
SOLE_Z = float(ANKLE[2])
GROUND = 0.05
FREE_END = ('Death',)
COLLIDE_LEGS = {'L_Thigh': 0.5, 'R_Thigh': 0.5, 'L_Shin': 0.36, 'R_Shin': 0.36}
POP_SKIP = ('Kilt', 'Hook', 'Haul', 'Belly', 'Weapon')
ROLL_GATE = {'UpperArm': 80.0, 'Forearm': 75.0, 'Hand': 75.0}


def _chains():
    from rig import Chain
    return [
        Chain(['KiltF1', 'KiltF2'], 'Hips', gravity=0.55, stiff=0.22, damp=0.18, drag=0.8, collide=True),
        Chain(['KiltB1', 'KiltB2'], 'Hips', gravity=0.55, stiff=0.22, damp=0.18, drag=0.8, collide=True),
        Chain(['Hook1', 'Hook2', 'Hook3'], 'R_Hand', gravity=0.95, stiff=0.08, damp=0.1, drag=0.4),
        Chain(['HaulL1', 'HaulL2', 'HaulL3'], 'Spine2', gravity=0.95, stiff=0.08, damp=0.12, drag=0.5, collide=True),
        Chain(['HaulR1', 'HaulR2', 'HaulR3'], 'Spine2', gravity=0.95, stiff=0.08, damp=0.12, drag=0.5, collide=True),
        Chain(['Belly'], 'Spine1', gravity=0.0, stiff=0.4, damp=0.3, drag=0.0),
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


# ------------------------------------------------------------------ body
def build_body(voxel):
    F = Field((-1.75, -1.35, -0.05), (1.75, 1.2, 5.05), voxel)
    noise = Noise(7)
    F.add(Ellipsoid((0, 0.12, 2.5), (0.72, 0.56, 0.45), bone='Hips'), 0.25)
    F.add(Ellipsoid((0, -0.42, 2.95), (0.86, 0.72, 0.78), bone='Belly'), 0.3)          # the gut
    F.add(Ellipsoid((0, 0.1, 3.3), (0.82, 0.62, 0.62), bone='Spine1'), 0.3)
    F.add(Ellipsoid((0, -0.05, 3.95), (1.08, 0.78, 0.7), rot_matrix(rx=-0.1), bone='Spine2'), 0.32)
    F.add(Ellipsoid((0, 0.32, 4.2), (0.98, 0.56, 0.5), bone='Spine2'), 0.3)            # the hump of the back
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.45, -0.52, 4.05), s), (0.5, 0.28, 0.36), rot_matrix(ry=0.25 * s), bone='Spine2'), 0.18)
        F.add(RoundCone(_m((0.15, 0.2, 4.4), s), _m((0.9, 0.12, 4.42), s), 0.36, 0.3, bone='Spine2'), 0.22)
        F.add(Ellipsoid(_m((0.72, 0.15, 3.55), s), (0.36, 0.48, 0.6), bone='Spine2'), 0.2)
        F.add(Ellipsoid(_m((0.36, 0.42, 2.35), s), (0.42, 0.34, 0.38), bone='Hips'), 0.18)
        F.add(Ellipsoid(_m((0.62, -0.1, 2.75), s), (0.3, 0.42, 0.4), bone='Spine1'), 0.2)   # love handles
    F.add(RoundCone((0, 0.12, 4.3), (0, -0.25, 4.8), 0.36, 0.3, bone='Neck'), 0.22)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.04 * s, 0, 0)), 0.36, bone=up), 0.16)
        F.add(RoundCone(sh, el, 0.32, 0.24, bone=up), 0.14)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0, -0.12, 0)), (0.23, 0.22, 0.38), _rot(sh, el), bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0.05 * s, 0.12, 0)), (0.22, 0.2, 0.36), _rot(sh, el), bone=up), 0.1)
        F.add(Sphere(el + np.array((0, 0.08, 0)), 0.2, bone=_side('ElbowFix', s)), 0.1)
        F.add(RoundCone(el, lerp(el, wr, 0.35), 0.24, 0.27, bone=fo), 0.12)
        F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.27, 0.17, bone=fo), 0.12)
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, shn = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0, 0.08)), kn, 0.44, 0.27, bone=th), 0.2)
        F.add(Ellipsoid(lerp(hp, kn, 0.42) + np.array((0.06 * s, -0.08, 0)), (0.32, 0.3, 0.42), _rot(hp, kn), bone=th),
              0.12)
        F.add(Sphere(kn, 0.26, bone=_side('KneeFix', s)), 0.12)
        F.add(RoundCone(kn, an, 0.27, 0.18, bone=shn), 0.14)
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0, 0.1, 0)), (0.22, 0.2, 0.34), _rot(kn, an), bone=shn), 0.1)
        foot = _side('Foot', s)
        F.add(Ellipsoid(an + np.array((0, 0.04, -0.1)), (0.2, 0.24, 0.16), bone=foot), 0.08)
        F.add(RoundBox(_m((0.56, -0.2, 0.15), s), (0.18, 0.26, 0.08), radius=0.07, bone=foot), 0.1)
        for k, dx in enumerate((-0.12, -0.03, 0.06, 0.14)):
            a = _m((0.57 + dx, -0.42, 0.12), s)
            F.add(RoundCone(a, a + np.array((dx * s * 0.2, -0.24 + abs(dx) * 0.4, -0.02)), 0.07 - 0.01 * k, 0.05,
                            bone=_side('Toes', s)), 0.03)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.fbm(X_ * 2.4, Y_ * 2.4, Z_ * 2.4, octaves=3)
               + 0.004 * noise.fbm(X_ * 12, Y_ * 12, Z_ * 12, octaves=2), band=0.15)
    return F


def build_head(voxel):
    F = Field(hp((-0.62, -0.95, 4.45)), hp((0.62, 0.35, 5.62)), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, 0.1, 4.5), hp((0, -0.25, 4.85)), 0.3, hr(0.26), bone='Neck'), 0.12)
    F.add(Ellipsoid(hp((0, -0.28, 5.15)), hr((0.33, 0.36, 0.34)), bone='Head'), hr(0.1))
    F.add(Ellipsoid(hp((0, -0.5, 5.18)), hr((0.3, 0.2, 0.2)), bone='Head'), hr(0.1))               # the face mass
    F.add(Ellipsoid(hp((0, -0.63, 5.24)), hr((0.32, 0.13, 0.09)), rot_matrix(rx=0.15), bone='Head'), hr(0.06))   # brow
    for s in (1, -1):      # the brow ridge bunched over each eye: a scowl
        F.add(Ellipsoid(hp(_m((0.14, -0.66, 5.22), s)), hr((0.11, 0.07, 0.05)), rot_matrix(ry=0.35 * s), bone='Head'),
              hr(0.04))
    for s in (1, -1):
        F.add(Ellipsoid(hp(_m((0.2, -0.56, 5.08), s)), hr((0.12, 0.1, 0.09)), bone='Head'), hr(0.06))            # cheek
        F.add(Ellipsoid(hp(_m((0.33, -0.22, 5.12), s)), hr((0.05, 0.12, 0.13)), rot_matrix(rz=-0.3 * s), bone='Head'),
              hr(0.05))  # ear
        F.sub(Sphere(_m(EYE, s), EYE_R + 0.022), 0.025)
    F.add(Ellipsoid(hp((0, -0.72, 5.1)), hr((0.09, 0.08, 0.09)), bone='Head'), hr(0.05))            # the squashed nose
    F.add(Ellipsoid(hp((0, -0.73, 5.04)), hr((0.13, 0.06, 0.05)), bone='Head'), hr(0.04))
    for s in (1, -1):
        F.sub(Sphere(hp(_m((0.05, -0.79, 5.04), s)), hr(0.022)), hr(0.012))
    # the jaw: a heavy underbite, the lower lip jutting
    F.add(Ellipsoid(hp((0, -0.5, 4.86)), hr((0.3, 0.26, 0.15)), rot_matrix(rx=0.2), bone='Jaw'), hr(0.08))
    F.add(Ellipsoid(hp((0, -0.73, 4.87)), hr((0.2, 0.08, 0.08)), bone='Jaw'), hr(0.05))
    F.sub(Ellipsoid(hp((0, -0.76, 4.95)), hr((0.15, 0.06, 0.012))), hr(0.01))
    # tusks from the lower jaw, the left one broken short
    for s, ln in ((1, 0.09), (-1, 0.2)):
        a = np.array(hp(_m((0.12, -0.74, 4.92), s)))
        F.add(RoundCone(a, a + np.array(hr(_m((0.03, -0.04, ln), s))), hr(0.035), hr(0.012 if ln > 0.1 else 0.03),
                        bone='Jaw'), hr(0.012))
    # brow wrinkles, scars
    for z in (5.3, 5.34):
        F.groove(Polyline([hp((-0.18, -0.6, z)), hp((0, -0.63, z + 0.01)), hp((0.18, -0.6, z))], hr(0.003)),
                 hr(0.008), k=hr(0.012))
    F.groove(Polyline([hp((-0.24, -0.56, 5.3)), hp((-0.17, -0.62, 5.16)), hp((-0.1, -0.66, 5.02))], hr(0.004)),
             hr(0.012), k=hr(0.012))
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 16, Y_ * 16, Z_ * 16, octaves=2), band=0.06)
    return F


def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.2, w + down * 0.8) - 0.32
    hi = np.maximum(w - down * 0.2, w + down * 0.8) + 0.32
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.15, w + down * 0.03, 0.16, 0.15, bone=hand), 0.05)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.2, (0.14, 0.06, 0.13), Rm, radius=0.06, bone=hand), 0.06)
    F.add(Ellipsoid(w + down * 0.13 + width * 0.09 + palm * 0.06, (0.08, 0.07, 0.11), Rm, bone=hand), 0.05)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.075
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        if f != 'Thumb':
            F.add(Sphere(base - palm * 0.02, r0 + 0.012, bone=hand), 0.025)
        F.add(RoundCone(base, mid, r0, r0 * 0.9, bone=b1), 0.022)
        F.add(Sphere(mid, r0 * 0.92, bone=b2), 0.016)
        F.add(RoundCone(mid, tip, r0 * 0.9, r0 * 0.72, bone=b2), 0.016)
        d2 = unit(tip - mid)
        F.add(Ellipsoid(tip - d2 * 0.02 - palm * 0.03, (r0 * 0.6, r0 * 0.35, r0 * 0.6), frame_from(d2), bone=b2),
              0.01)  # thick nails on the back
    return F


# ------------------------------------------------------------------ fur, harness, wraps
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


def gear(Fb, Fh, voxel):
    rg = X.ramp
    out = []
    shag = Noise(41)
    BU = _Union(Fb, Fh)

    def fur_noise(amp, fz=9.0):
        return lambda X_, Y_, Z_: amp * (0.5 + 0.5 * shag.fbm(X_ * 7, Y_ * 7, Z_ * fz * 0.3, octaves=3))

    def layer(name, base, lo, hi, off, thick, mask, mat, binding='transfer', bone='', allow=None, extra=None,
              noise=None, v=None):
        G = X.layer_field(base, lo, hi, v or voxel, off, thick, mask, extra=extra, noise=noise)
        out.append((name, G, mat, binding, bone, allow))

    # the fur mantle: shaggy over the shoulders and the hump, ragged at its edge
    def mantle_mask(X_, Y_, Z_):
        m = rg(Z_, 3.75 + 0.25 * rg(Y_, 0.3, -0.6) + 0.12 * shag.fbm(X_ * 4, Y_ * 4, 0.0, octaves=2), 3.9 + 0.25 *
               rg(Y_, 0.3, -0.6))
        neck = rg(np.sqrt(X_ ** 2 + (Y_ + 0.1) ** 2), 0.42, 0.52) + rg(Z_, 4.75, 4.65)
        # never over the face: in front of the neck and above the shoulder line
        # the mantle stops, so the grown head stands clear of the fur
        face = rg(Z_, 4.55, 4.68) * (1 - rg(np.abs(X_), 0.66, 0.8)) * (1 - rg(Y_, -0.05, 0.12))
        neck = neck * (1 - face)
        for s in (1, -1):
            d, u = X.seg_dist(X_, Y_, Z_, _m(SHOULDER, s), _m(ELBOW, s))
            m = m * (1 - rg(u, 0.32, 0.4) * rg(d, 0.6, 0.45))
        return m * np.clip(neck, 0, 1)
    layer('FurMantle', BU, (-1.6, -1.2, 3.5), (1.6, 1.2, 5.05), 0.04, 0.12, mantle_mask, 'fur',
          allow=('Spine2', 'Neck', 'L_Clavicle', 'R_Clavicle'), noise=fur_noise(0.1))

    # the kilt of fur round the hips, long and ragged
    def kilt_mask(X_, Y_, Z_):
        hem = 1.55 + 0.15 * shag.fbm(X_ * 5, Y_ * 5, 0.0, octaves=2)
        return rg(Z_, hem, hem + 0.06) * (1 - rg(Z_, 2.62, 2.7))

    def kilt_off(X_, Y_, Z_):
        return 0.04 + 0.28 * rg(Z_, 2.4, 1.6)
    layer('FurKilt', Fb, (-1.3, -1.3, 1.4), (1.3, 1.3, 2.78), kilt_off, 0.09, kilt_mask, 'fur', binding='own',
          noise=fur_noise(0.06))
    # the harness straps: an X over the chest and an X over the back, the belt and the yoke pads
    straps = []
    for sy, (a, b) in (( -1, ((0.98, -0.45, 4.55), (-0.62, -0.9, 3.2))), (-1, ((-0.98, -0.45, 4.55), (0.62, -0.9, 3.2))),
                       (1, ((0.98, 0.45, 4.6), (-0.6, 0.7, 3.35))), (1, ((-0.98, 0.45, 4.6), (0.6, 0.7, 3.35)))):
        straps.append((np.array(a), np.array(b), sy))

    def strap_mask(X_, Y_, Z_):
        m = 0.0
        for a, b, sy in straps:
            a2, b2 = a * np.array((1, 0, 1)), b * np.array((1, 0, 1))
            d, u = X.seg_dist(X_, Y_ * 0, Z_, a2, b2)
            side = rg(Y_ * sy, -0.1, 0.05)
            m = np.maximum(m, rg(d, 0.13, 0.1) * side)
        return m * (1 - rg(Z_, 4.6, 4.7))

    def rings(G):
        G.add(sdf.Torus(RING_FRONT + np.array((0, -0.06, 0)), (0, 1, 0), 0.17, 0.045), 0.02)
        G.add(sdf.Torus(RING_BACK + np.array((0, 0.06, 0)), (0, 1, 0), 0.17, 0.045), 0.02)
    layer('Harness', Fb, (-1.2, -1.2, 3.0), (1.2, 1.2, 4.8), 0.05, 0.05, strap_mask, 'leather',
          allow=('Spine1', 'Spine2', 'Belly'), extra=rings)

    def belt_mask(X_, Y_, Z_):
        return rg(Z_, 2.55, 2.6) * (1 - rg(Z_, 2.78, 2.83))
    layer('Belt', Fb, (-1.3, -1.3, 2.45), (1.3, 1.3, 2.95), 0.06, 0.05, belt_mask, 'leather', allow=('Hips', 'Spine1', 'Belly'))
    # fur wraps on the shins, cord-bound
    for s in (1, -1):
        kn, an = _m(KNEE, s), _m(ANKLE, s)

        def wrap_mask(X_, Y_, Z_, kn=kn, an=an):
            d, u = X.seg_dist(X_, Y_, Z_, kn, an)
            return rg(u, 0.25, 0.3) * (1 - rg(u, 0.92, 0.98)) * rg(d, 0.45, 0.36)
        layer(_side('ShinWrap', s), Fb, np.minimum(kn, an) - 0.5, np.maximum(kn, an) + 0.5, 0.03, 0.07, wrap_mask, 'fur',
              binding='rigid', bone=_side('Shin', s), noise=fur_noise(0.04))
    # the haul chain wrapped round the right forearm and fist
    el, wr = _m(ELBOW, -1), _m(WRIST, -1)

    def chain_mask(X_, Y_, Z_):
        d, u = X.seg_dist(X_, Y_, Z_, el, wr)
        return rg(u, 0.6, 0.64) * (1 - rg(u, 1.02, 1.06)) * rg(d, 0.42, 0.34)

    def chain_links(G):
        ax = unit(wr - el)
        e1 = unit(np.cross(ax, (0, 0, 1.0)))
        e2 = np.cross(ax, e1)
        for k in range(16):
            u = 0.62 + 0.4 * k / 15
            a = k * 1.1
            c = lerp(el, wr, u) + (e1 * math.cos(a) + e2 * math.sin(a)) * 0.24
            G.add(sdf.Torus(c, ax * 0.5 + (e1 * -math.sin(a) + e2 * math.cos(a)), 0.07, 0.022, squash=1.0), 0.004)
    G = Field(np.minimum(el, wr) - 0.5, np.maximum(el, wr) + 0.5, voxel * 0.8)
    chain_links(G)
    out.append(('HaulChain', G, 'iron', 'rigid', 'R_Forearm', None))
    return out


def kilt_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'KiltF1', 'KiltF2', 'KiltB1', 'KiltB2', 'L_Thigh', 'R_Thigh']
    W = np.zeros((len(P), len(names)))
    z = P[:, 2]
    t = np.clip((2.62 - z) / (2.62 - 1.55), 0, 1)
    hip = np.clip(1 - t / 0.15, 0, 1)
    low = np.clip((t - 0.35) / 0.35, 0, 1)
    low = low * low * (3 - 2 * low)
    side = np.abs(P[:, 0]) > 0.55          # the flanks ride the thighs, the front and back panels swing
    front = P[:, 1] < 0
    W[:, 0] = hip
    for i in np.nonzero(~side)[0]:
        a, b = (1, 2) if front[i] else (3, 4)
        W[i, a] = (1 - hip[i]) * (1 - low[i])
        W[i, b] = (1 - hip[i]) * low[i]
    for i in np.nonzero(side)[0]:
        th = 5 if P[i, 0] > 0 else 6
        W[i, th] = (1 - hip[i]) * 0.7
        W[i, 0] += (1 - hip[i]) * 0.3
    W = R.relax(W, E, iters=4)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def build_ice(voxel):
    rng = np.random.default_rng(29)
    out = []

    def cluster(name, c, n, size, bone, down=True, spread=0.1):
        c = np.asarray(c, float)
        G = Field(c - size * 1.6 - 0.05, c + size * 1.6 + 0.05, voxel)
        for k in range(n):
            d = unit(np.array((rng.normal(0, 0.15), rng.normal(0, 0.15), -1.0))) if down else \
                unit(np.array((0, 0, 1.0)) + rng.normal(0, 0.5, 3))
            L_ = size * rng.uniform(0.45, 1.0)
            a = c + rng.normal(0, spread, 3) * np.array((1, 1, 0.3))
            G.add(X.Prism(a - d * L_ * 0.25, a + d * L_, L_ * rng.uniform(0.12, 0.2), n=int(rng.choice([5, 6])),
                          tip=rng.uniform(0.25, 0.45), rot=rng.uniform(0, 3), tip_a=0.1), 0.004)
        out.append((name, G, bone))
    cluster('IceMantleL', (0.95, -0.3, 3.95), 6, 0.2, 'Spine2', spread=0.18)
    cluster('IceMantleR', (-0.95, -0.25, 3.98), 6, 0.2, 'Spine2', spread=0.18)
    cluster('IceKilt', (0.3, -0.85, 1.62), 5, 0.17, 'KiltF2', spread=0.2)
    cluster('IceChin', (0.0, -0.74, 4.8), 4, 0.1, 'Jaw', spread=0.06)
    return out


def build_block(voxel):
    """The ice block he tears out of the glacier for the toss: a rough-cut slab with
    fractured faces, sitting on the Block bone's tail."""
    c = GRIP_R + np.array(WEAPON_AXIS) * BLOCK_HALF
    G = Field(c - 0.85, c + 0.85, voxel)
    rng = np.random.default_rng(31)
    G.add(RoundBox(c, (0.42, 0.36, 0.34), frame_from(np.array(WEAPON_AXIS)) @ rot_matrix(rz=0.3), radius=0.05), 0.0)
    for k in range(9):
        n = unit(rng.normal(0, 1, 3))
        p = c + n * rng.uniform(0.3, 0.4)
        G.sub(X.Plane(p, -n, lo=c - 1, hi=c + 1), 0.01)
    return G


def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand, vp = 0.018 * k, 0.008 * k, 0.0075 * k, 0.014 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    S = [Sculpt('Body', Fb, 'skin', 8000, spots=[((0, -0.3, 4.6), 0.3, 0.5)], tau=0.07),
         Sculpt('Head', Fh, 'skin', 3600, spots=[(hp((0, -0.65, 5.05)), hr(0.25), 1.0)], tau=0.03),
         Sculpt('L_Fist', build_hand(1, vhand), 'skin', 1600, tau=0.02),
         Sculpt('R_Fist', build_hand(-1, vhand), 'skin', 1600, tau=0.02)]
    targets = {'FurMantle': 3600, 'FurKilt': 2200, 'Harness': 1400, 'Belt': 700, 'ShinWrap': 600, 'HaulChain': 1500}
    for name, G, mat, binding, bone, allow in gear(Fb, Fh, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        S.append(Sculpt(name, G, mat, targets[key], binding=binding, bone=bone, allow=allow, relax=8,
                        weigh=kilt_weights if name == 'FurKilt' else None))
    for name, G, bone in build_ice(0.009 * k):
        S.append(Sculpt(name, G, 'ice', 280, binding='rigid', bone=bone))
    S.append(Sculpt('IceBlock', build_block(0.016 * k), 'ice', 700, binding='rigid', bone='Weapon',
                    separate='OgreSledgeHaulerBlock'))
    return S
