"""The Fanglord Beastmaster: skeleton and sculpts (rest pose), in yards.

The first boss of the Wildheart Basin (with his Great Jaguar): a huge, scarred
jungle troll of the Sunbone, the beast-raiser of the Beast Pits. Darker,
bulkier and older than his tribe, his hide criss-crossed with old claw scars
and painted with the tribe's red and bone white; heavy tusks, a broken one. He
wears the pelt of a great jaguar: its head as a hood over his own, its fangs
over his brow, the pelt falling down his back as a cloak, its forelegs knotted
across his chest. Bone pauldrons and a harness of bone plates, a jaguar-hide
loincloth, wraps and fangs at the wrists. In his right fist the BEASTSPEAR: a
long ironwood haft bound in bone, a broad bone blade barbed with jaguar fangs.

Built on the Totem-Binder's troll body (the same rig and kit), authored at the
kit's size and scaled up by BUILD_SCALE at the end: about 6.6 yards to the
hood's ears, a head over his 4.7 yard jaguar.

Axes: yards, +Z up, faces -Y, his left is +X. Rest is an A-pose.
"""
import math

import numpy as np

import biped as B
import sdf
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundBox, RoundCone, Sphere, Torus, frame_from, rot_matrix

NAME = 'FanglordBeastmaster'
PREFIX = 'beastmaster'
# the finished troll is scaled up by this (build_core.scale_all)
BUILD_SCALE = 1.12

SHOULDER = np.array((0.86, -0.08, 3.96))
ELBOW = np.array((1.24, 0.08, 3.06))
WRIST = np.array((1.42, -0.06, 2.16))
HAND_TIP = np.array((1.5, -0.18, 1.62))
HIP = np.array((0.42, 0.12, 2.32))
KNEE = np.array((0.5, -0.26, 1.28))
ANKLE = np.array((0.54, 0.12, 0.32))
BALL = np.array((0.56, -0.3, 0.12))
TOE = np.array((0.57, -0.6, 0.1))
HEAD_C = np.array((0.0, -0.62, 4.82))
EYE = np.array((0.17, -0.92, 4.9))

HAND = B.Hand(WRIST, HAND_TIP, 0.34, {
    'Index': (0.11, 0.12, 0.0, 0.26, 0.078),
    'Middle': (0.0, 0.0, 0.02, 0.28, 0.082),
    'Ring': (-0.11, -0.12, 0.0, 0.24, 0.074),
}, thumb=((0.1, 0.11, 0.08), (0.5, 0.65, 0.55), 0.19, 0.15))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.1, 'Ring': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.16, -0.04, 3.92)))

# ------------------------------------------------------------------ the staff in the right fist
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.27 + _p * 0.11
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.27 + _pl * 0.11)
HAFT_BELOW, HAFT_ABOVE = 1.6, 3.15           # the butt and the blade's tip from the right fist
WEAPON_PROBES = (-HAFT_BELOW, 0.8, 1.6, HAFT_ABOVE)
BLADE_AT = HAFT_ABOVE - 0.55                  # the blade's widest point (local z)

LOIN = [np.array(p) for p in ((0, -0.5, 2.4), (0, -0.56, 1.9), (0, -0.56, 1.4))]
LOIN_B = [np.array(p) for p in ((0, 0.52, 2.4), (0, 0.6, 1.9), (0, 0.62, 1.42))]


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.12, 2.38), (0, 0.08, 2.86)),
        ('Spine1', 'Hips', (0, 0.08, 2.86), (0, 0.04, 3.42)),
        ('Spine2', 'Spine1', (0, 0.04, 3.42), (0, -0.1, 4.0)),
        ('Neck1', 'Spine2', (0, -0.14, 4.02), (0, -0.36, 4.38)),
        ('Neck', 'Neck1', (0, -0.36, 4.38), (0, -0.5, 4.6)),
        ('Head', 'Neck', (0, -0.5, 4.6), (0, -0.7, 5.25)),
        ('Jaw', 'Head', (0, -0.6, 4.66), (0, -1.08, 4.46)),
        ('Eyes', 'Head', tuple(EYE * np.array((0, 1, 1))), tuple(EYE * np.array((0, 1, 1)) + np.array((0, 0, 0.2)))),
        ('LoinF1', 'Hips', tuple(LOIN[0]), tuple(LOIN[1])),
        ('LoinF2', 'LoinF1', tuple(LOIN[1]), tuple(LOIN[2])),
        ('LoinB1', 'Hips', tuple(LOIN_B[0]), tuple(LOIN_B[1])),
        ('LoinB2', 'LoinB1', tuple(LOIN_B[1]), tuple(LOIN_B[2])),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        ('Cape1', 'Spine2', (0, 0.42, 4.05), (0, 0.62, 3.35)),
        ('Cape2', 'Cape1', (0, 0.62, 3.35), (0, 0.72, 2.55)),
        ('Cape3', 'Cape2', (0, 0.72, 2.55), (0, 0.76, 1.7)),
        ('L_Ear', 'Head', (0.36, -0.5, 4.95), (0.78, -0.18, 5.1)),
    ]
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.45), ('Spine2', 0.55))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.18, -0.28))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_END = ('Death',)
COLLIDE_LEGS = {'L_Thigh': 0.42, 'R_Thigh': 0.42, 'L_Shin': 0.28, 'R_Shin': 0.28}
POP_SKIP = ('Eyes', 'Loin', 'Cape', 'Ear')
FEET = ('L_Foot', 'R_Foot')
AIM_LIMITS = {'L_Hand': 75.0, 'R_Hand': 75.0, 'L_Foot': 95.0, 'R_Foot': 95.0}
HIDDEN = {}
BAKE_CAGE, BAKE_RAY = 0.03, 0.12


def _chains():
    from rig import Chain
    return [Chain(['LoinF1', 'LoinF2'], 'Hips', gravity=0.6, stiff=0.22, damp=0.16, drag=0.8, collide=True),
            Chain(['LoinB1', 'LoinB2'], 'Hips', gravity=0.6, stiff=0.22, damp=0.16, drag=0.8, collide=True),
            Chain(['Cape1', 'Cape2', 'Cape3'], 'Spine2', gravity=0.6, stiff=0.2, damp=0.15, drag=1.0)]


class _Lazy(list):
    def __iter__(self):
        if not len(self):
            self.extend(_chains())
        return list.__iter__(self)

    def __bool__(self):
        return True


CHAINS = _Lazy()


def mirror(p):
    return B.mirror(p)


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _rot(a, b):
    return frame_from(np.asarray(b) - np.asarray(a))


# ------------------------------------------------------------------ the body
def build_body(voxel):
    """A big, hunched troll: a deep barrel chest, a gut, heavy traps rising into a
    neck thrust forward, shoulders like boulders, long sinewy arms with knotted
    forearms, lean bowed legs on big flat feet."""
    F = Field((-1.75, -1.15, 0.0), (1.75, 1.05, 4.75), voxel)
    noise = Noise(7)
    F.add(Ellipsoid((0, 0.12, 2.5), (0.5, 0.4, 0.34), bone='Hips'), 0.16)
    F.add(Ellipsoid((0, -0.06, 2.86), (0.52, 0.44, 0.42), bone='Spine1'), 0.2)              # the gut
    F.add(Ellipsoid((0, -0.2, 2.72), (0.4, 0.34, 0.3), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, -0.06, 3.52), (0.8, 0.58, 0.6), rot_matrix(rx=-0.25), bone='Spine2'), 0.22)  # chest
    F.add(Ellipsoid((0, 0.24, 3.8), (0.66, 0.38, 0.36), rot_matrix(rx=0.3), bone='Spine2'), 0.2)      # the hunch
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.28, -0.38, 3.56), s), (0.3, 0.17, 0.24), rot_matrix(ry=0.25 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.12, 0.0, 3.95), s), _m(SHOULDER, s), 0.26, 0.24, bone=_side('Clavicle', s)), 0.14)
        F.add(Ellipsoid(_m((0.34, 0.12, 4.06), s), (0.3, 0.26, 0.2), rot_matrix(ry=-0.4 * s), bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.5, 0.18, 3.36), s), (0.22, 0.28, 0.42), bone='Spine2'), 0.12)       # lats
    F.add(RoundCone((0, -0.06, 3.96), (0, -0.4, 4.42), 0.36, 0.26, bone='Neck1'), 0.14)
    F.add(RoundCone((0, -0.36, 4.38), (0, -0.52, 4.62), 0.26, 0.22, bone='Neck'), 0.08)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.04 * s, 0.0, 0.06)), 0.38, bone=_side('Clavicle', s)), 0.14)   # deltoid
        F.add(RoundCone(sh, el, 0.33, 0.23, bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.42) + np.array((0.02 * s, -0.07, 0)), (0.18, 0.18, 0.3), _rot(sh, el), bone=up),
              0.06)
        F.add(Sphere(el + np.array((0, 0.06, 0)), 0.17, bone=_side('ElbowFix', s)), 0.07)
        F.add(RoundCone(el, lerp(el, wr, 0.35), 0.24, 0.28, bone=fo), 0.07)
        F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.28, 0.16, bone=fo), 0.07)
        hp, kn, an, ba, to = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(BALL, s), _m(TOE, s)
        th, shn = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0.02, 0.05)), kn, 0.37, 0.23, bone=th), 0.14)
        F.add(Ellipsoid(lerp(hp, kn, 0.4) + np.array((0.04 * s, -0.02, 0)), (0.24, 0.24, 0.36), _rot(hp, kn), bone=th),
              0.1)
        F.add(Sphere(kn, 0.17, bone=_side('KneeFix', s)), 0.07)
        F.add(RoundCone(kn, an, 0.24, 0.15, bone=shn), 0.08)
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0, 0.08, 0.02)), (0.17, 0.17, 0.28), _rot(kn, an), bone=shn),
              0.07)
        foot = _side('Foot', s)
        F.add(RoundCone(an, ba + np.array((0, 0, 0.02)), 0.15, 0.14, bone=foot), 0.06)
        F.add(Ellipsoid(an + np.array((0, 0.1, -0.16)), (0.14, 0.15, 0.13), bone=foot), 0.05)
        for k, dx in enumerate((-0.08, 0.0, 0.08)):
            F.add(RoundCone(ba + np.array((dx * s, 0, 0.0)), to + np.array((dx * 1.3 * s, 0.04 * k, -0.01)), 0.07,
                            0.055, bone=_side('Toes', s)), 0.03)
    F.sub(RoundBox((0, 0, -1.0), (4, 4, 1.0), radius=0.0), 0.02)
    # sinew and skin: veins down the forearms, a ridged back, pores
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)
        for k in range(2):
            a = lerp(el, wr, 0.15) + np.array((0.12 * s, -0.12 + 0.08 * k, 0.0))
            b = lerp(el, wr, 0.85) + np.array((0.08 * s, -0.08 + 0.05 * k, 0.0))
            F.ridge(sdf.Polyline([a, lerp(a, b, 0.5) + np.array((0.03 * s, 0, 0)), b], 0.004), 0.018, k=0.02)
    F.displace(lambda X_, Y_, Z_: 0.01 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=3)
               - 0.004 * noise.ridged(X_ * 14, Y_ * 14, Z_ * 14, octaves=2), band=0.1)
    return F


# ------------------------------------------------------------------ the head
def build_head(voxel):
    """A troll's face: a heavy brow over small deep eyes, a long hooked nose, wide
    cheekbones, a jutting jaw with two tusks curling up, long ears swept back."""
    F = Field((-1.0, -1.45, 4.25), (1.0, 0.25, 5.45), voxel)
    noise = Noise(13)
    F.add(RoundCone((0, -0.36, 4.38), (0, -0.52, 4.62), 0.26, 0.22, bone='Neck'), 0.08)
    F.add(Ellipsoid(HEAD_C + np.array((0, 0.12, 0.1)), (0.3, 0.32, 0.3), bone='Head'), 0.1)          # the skull
    F.add(Ellipsoid((0, -0.86, 5.02), (0.26, 0.12, 0.08), rot_matrix(rx=0.25), bone='Head'), 0.05)    # the brow
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.17, -0.88, 5.0), s), (0.13, 0.09, 0.06), rot_matrix(ry=-0.45 * s, rx=0.3), bone='Head'),
              0.03)
        F.add(Ellipsoid(_m((0.24, -0.78, 4.78), s), (0.12, 0.14, 0.1), bone='Head'), 0.05)          # cheekbones
        F.sub(Ellipsoid(_m(EYE, s) + np.array((0, 0.02, 0)), (0.05, 0.035, 0.03), rot_matrix(ry=0.3 * s)), 0.012)
        # the long ear, swept back and up
        e0, e1, e2 = _m((0.3, -0.52, 4.92), s), _m((0.56, -0.36, 5.02), s), _m((0.84, -0.16, 5.12), s)
        F.add(sdf.Polyline([e0, e1, e2], [0.07, 0.05, 0.012], bone=_side('Ear', s)), 0.03)
        F.add(Ellipsoid(lerp(e0, e2, 0.42), (0.2, 0.06, 0.1), _rot(e0, e2), bone=_side('Ear', s)), 0.03)
    # the nose: long, hooked, flared
    F.add(RoundCone((0, -0.92, 4.95), (0, -1.2, 4.78), 0.075, 0.07, bone='Head'), 0.04)
    F.add(Ellipsoid((0, -1.22, 4.74), (0.1, 0.08, 0.07), bone='Head'), 0.03)
    for s in (1, -1):
        F.add(Sphere(_m((0.07, -1.14, 4.72), s), 0.05, bone='Head'), 0.02)
        F.sub(Ellipsoid(_m((0.055, -1.2, 4.7), s), (0.025, 0.03, 0.02)), 0.01)
    # the muzzle and the jutting jaw
    F.add(Ellipsoid((0, -0.92, 4.66), (0.2, 0.2, 0.12), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.88, 4.5), (0.22, 0.24, 0.1), rot_matrix(rx=0.2), bone='Jaw'), 0.06)
    F.add(Ellipsoid((0, -1.04, 4.47), (0.14, 0.1, 0.08), bone='Jaw'), 0.04)                         # the chin
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.22, -0.66, 4.58), s), (0.1, 0.18, 0.12), bone='Jaw'), 0.05)
    F.sub(RoundBox((0, -0.98, 4.585), (0.17, 0.14, 0.012), radius=0.0), 0.012)                      # the mouth line
    # a crest of hair rising off the scalp (red, its own strands)
    for k in range(9):
        u = k / 8
        base = lerp((0, -0.72, 5.12), (0, 0.06, 4.86), u)
        d = unit(np.array((0.0, 0.45 + 0.4 * u, 1.0 - 0.5 * u)))
        F.add(RoundCone(base, base + d * (0.36 - 0.12 * abs(u - 0.3)), 0.06, 0.012, bone='Head'), 0.03)
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 12, Y_ * 12, Z_ * 12, octaves=2), band=0.05)
    return F


# ------------------------------------------------------------------ the hands
def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.25, w + down * 0.85) - 0.3
    hi = np.maximum(w - down * 0.25, w + down * 0.85) + 0.3
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.2, w + down * 0.02, 0.13, 0.12, bone=hand), 0.03)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.17, (0.15, 0.06, 0.12), Rm, radius=0.05, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.078
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.9, bone=b1), 0.015)
        F.add(Sphere(mid, r0 * 0.96, bone=b2), 0.012)
        F.add(RoundCone(mid, tip, r0 * 0.88, r0 * 0.6, bone=b2), 0.012)
        d2 = unit(tip - mid)
        # a thick black claw-nail
        F.add(RoundCone(tip - d2 * 0.02, tip + d2 * 0.06 + palm * 0.02, r0 * 0.55, 0.01, bone=b2), 0.008)
    return F


# ------------------------------------------------------------------ the loincloth
def build_loincloth(voxel):
    """The hide loincloth: a front and a back flap off the bone girdle."""
    F = Field((-0.75, -0.95, 1.2), (0.75, 1.0, 2.7), voxel)
    noise = Noise(31)
    for pts, bones in ((LOIN, ('LoinF1', 'LoinF2')), (LOIN_B, ('LoinB1', 'LoinB2'))):
        for i in range(2):
            a, b = pts[i], pts[i + 1]
            # a hide flap tapering down, a little cupped round the thighs
            for j in range(4):
                u0, u1 = j / 4, (j + 1) / 4
                p0, p1 = lerp(a, b, u0), lerp(a, b, u1)
                w = 0.34 - 0.1 * (i + (u0 + u1) / 2)
                F.add(RoundBox((p0 + p1) / 2, (w, 0.022, np.linalg.norm(p1 - p0) * 0.62),
                               _rot(p0, p1) @ rot_matrix(rz=math.pi / 2), radius=0.018, bone=bones[i]), 0.03)
    # a ragged hem: notches along the bottom edge
    for pts in (LOIN, LOIN_B):
        for x in (-0.16, -0.05, 0.06, 0.16):
            F.sub(Sphere(pts[2] + np.array((x, 0.0, -0.04)), 0.05), 0.02)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=2), band=0.05)
    return F


def loin_weights(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    obj.vertex_groups.clear()
    g = {n: obj.vertex_groups.new(name=n) for n in ('Hips', 'LoinF1', 'LoinF2', 'LoinB1', 'LoinB2')}
    for i, p in enumerate(P):
        front = p[1] < 0.0
        t = np.clip((2.38 - p[2]) / 0.95, 0, 1)
        w0 = max(0.0, 1 - t / 0.15)
        w2 = float(np.clip((t - 0.45) / 0.45, 0, 1))
        w1 = max(0.0, 1 - w0 - w2)
        for name, w in (('Hips', w0), ('LoinF1' if front else 'LoinB1', w1), ('LoinF2' if front else 'LoinB2', w2)):
            if w > 1e-3:
                g[name].add([i], float(w), 'REPLACE')


# ------------------------------------------------------------------ the Beastspear (local: +Z up the haft)
def build_staff(voxel):
    """The Beastspear: an ironwood haft bound in bone rings, a socket of carved
    bone, and a broad leaf blade of bone barbed with jaguar fangs."""
    HB, HA, bz = HAFT_BELOW, HAFT_ABOVE, BLADE_AT
    F = Field((-0.5, -0.4, -HB - 0.2), (0.5, 0.4, HA + 0.15), voxel)
    noise = Noise(23)
    F.add(RoundCone((0, 0, -HB + 0.05), (0, 0, bz - 0.7), 0.075, 0.085), 0.01)
    for z in (-HB + 0.2, -0.3, 0.32, bz - 0.78):
        F.add(Torus((0, 0, z), (0, 0, 1), 0.095, 0.03), 0.012)
    F.add(RoundCone((0, 0, -HB + 0.08), (0, 0, -HB - 0.15), 0.08, 0.03), 0.02)           # a bone butt cap
    # the socket and the blade (flat in local x-z)
    F.add(RoundCone((0, 0, bz - 0.72), (0, 0, bz - 0.42), 0.11, 0.08), 0.03)
    F.add(Ellipsoid((0, 0, bz), (0.22, 0.045, 0.62)), 0.02)
    F.add(Ellipsoid((0, 0, bz + 0.48), (0.1, 0.035, 0.32)), 0.02)                          # the point
    for s in (1, -1):
        for k, z in enumerate((bz - 0.35, bz - 0.1)):
            b = np.array((0.16 * s, 0.0, z))
            F.add(RoundCone(b, b + np.array((0.16 * s, 0.0, -0.14 + 0.05 * k)), 0.035, 0.006), 0.012)   # fang barbs
    F.ridge(RoundCone((0, -0.04, bz - 0.5), (0, -0.04, bz + 0.7), 0.004, 0.004), 0.012, k=0.02)
    F.ridge(RoundCone((0, 0.04, bz - 0.5), (0, 0.04, bz + 0.7), 0.004, 0.004), 0.012, k=0.02)
    F.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 4, octaves=2), band=0.03)
    return F


def staff_matrix():
    """The spear's local frame set in the right fist: +Z up the haft, the blade's
    flat across the palm."""
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


def staff_point(local):
    return (staff_matrix() @ np.array((*local, 1.0)))[:3]


# ------------------------------------------------------------------ the pelt cloak
CAPE = [np.array(p) for p in ((0, 0.46, 4.1), (0, 0.66, 3.35), (0, 0.76, 2.55), (0, 0.8, 1.7))]


def build_cape(voxel):
    """The jaguar's pelt hanging from the hood down his back: broad at the
    shoulders, narrowing to the tail's end, its edge ragged."""
    F = Field((-1.1, 0.1, 1.4), (1.1, 1.2, 4.4), voxel)
    noise = Noise(41)
    widths = (0.82, 0.74, 0.62, 0.42)
    for i in range(3):
        a, b = CAPE[i], CAPE[i + 1]
        for j in range(4):
            u0, u1 = j / 4, (j + 1) / 4
            p0, p1 = lerp(a, b, u0), lerp(a, b, u1)
            w = widths[i] + (widths[i + 1] - widths[i]) * (u0 + u1) / 2
            F.add(RoundBox((p0 + p1) / 2, (w, 0.03, np.linalg.norm(p1 - p0) * 0.62),
                           _rot(p0, p1) @ rot_matrix(rz=math.pi / 2), radius=0.025,
                           bone=f'Cape{i + 1}'), 0.05)
    # the tail of the pelt hanging past the hem
    F.add(sdf.Polyline([CAPE[3] + np.array((0.1, 0.0, 0.1)), CAPE[3] + np.array((0.16, 0.04, -0.35))],
                       [0.07, 0.04], bone='Cape3'), 0.03)
    for x in (-0.5, -0.25, 0.0, 0.25, 0.5):
        F.sub(Sphere(np.array((x, 0.82, 1.62)), 0.07), 0.02)
    F.displace(lambda X_, Y_, Z_: 0.014 * noise.fbm(X_ * 3.5, Y_ * 3.5, Z_ * 3.5, octaves=2), band=0.05)
    return F


def cape_weights(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    obj.vertex_groups.clear()
    names = ('Spine2', 'Cape1', 'Cape2', 'Cape3')
    g = {n: obj.vertex_groups.new(name=n) for n in names}
    zs = [4.1, 3.35, 2.55, 1.7]
    for i, p in enumerate(P):
        z = p[2]
        if z >= zs[0]:
            g['Spine2'].add([i], 1.0, 'REPLACE')
            continue
        for k in range(3):
            if zs[k] >= z >= zs[k + 1] or k == 2:
                u = float(np.clip((zs[k] - z) / (zs[k] - zs[k + 1]), 0, 1))
                if k == 0:
                    a, b = 'Spine2', 'Cape1'
                    w0 = max(0.0, 1 - u / 0.25)
                    g[a].add([i], w0, 'REPLACE') if w0 > 1e-3 else None
                    g[b].add([i], 1 - w0, 'REPLACE')
                else:
                    a, b = f'Cape{k}', f'Cape{k + 1}'
                    g[a].add([i], 1 - u, 'REPLACE') if 1 - u > 1e-3 else None
                    g[b].add([i], max(u, 1e-3), 'REPLACE')
                break


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand, vl = 0.016 * k, 0.0075 * k, 0.0065 * k, 0.014 * k
    S = [Sculpt('Body', build_body(vb), 'skin', 7500, spots=[((0, -0.3, 4.3), 0.4, 0.5)], tau=0.05),
         Sculpt('Head', build_head(vh), 'skin', 3400, spots=[((0, -0.9, 4.8), 0.3, 1.0)], tau=0.02),
         Sculpt('L_Hand', build_hand(1, vhand), 'skin', 1100, tau=0.012),
         Sculpt('R_Hand', build_hand(-1, vhand), 'skin', 1100, tau=0.012),
         Sculpt('Loincloth', build_loincloth(vl), 'pelt', 700, binding='own', weigh=loin_weights),
         Sculpt('Cape', build_cape(vl), 'pelt', 1500, binding='own', weigh=cape_weights)]
    return S


_ = (Field, Noise, RoundBox, Torus, mirror)
