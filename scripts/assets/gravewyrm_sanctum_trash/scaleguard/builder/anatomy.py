"""Sanctum Scaleguard: skeleton and sculpts (rest pose), in yards.

The Wyrm's drowned brood: a wyrm-kin guard that stood watch in the lake for twelve
hundred years. Upright and long-limbed, digitigrade, a heavy counterweight tail;
meltwater-dark scales with a pale scuted belly; an eel-long head with gill frills at
the jaw hinge and a finned crest of webbed spines from the brow down the nape, frost
crusted along its top. No wings: it reads as a sentinel, never a small dragon. The
cinders it breathes glow in its throat and through the gill slits of its neck. A
long iron halberd of the Smith's foundry.

Axes: yards, +Z up, faces -Y, its left is +X. Rest is an A-pose. Crest top about
4.4 yd (1.7 knights).
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit
from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'SanctumScaleguard'
PREFIX = 'scaleguard'

SHOULDER = np.array((0.55, 0.02, 3.42))
ELBOW = np.array((0.92, 0.14, 2.84))
WRIST = np.array((1.2, 0.0, 2.32))
HAND_TIP = np.array((1.34, -0.1, 1.94))
HIP = np.array((0.3, 0.1, 2.12))
KNEE = np.array((0.36, -0.34, 1.4))
ANKLE = np.array((0.38, 0.3, 0.6))
BALL = np.array((0.38, -0.12, 0.1))
TOE = np.array((0.38, -0.5, 0.07))
EYE = np.array((0.105, -0.5, 4.06))
EYE_R = 0.032

HAND = B.Hand(WRIST, HAND_TIP, 0.2, {
    'Index': (0.06, 0.12, 0.0, 0.15, 0.034),
    'Middle': (0.0, 0.0, 0.01, 0.17, 0.036),
    'Ring': (-0.06, -0.14, -0.01, 0.15, 0.033),
}, thumb=((0.07, 0.07, 0.05), (0.5, 0.65, 0.55), 0.11, 0.1))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.0, 'Ring': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.1, -0.02, 3.36)))

_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.2 + _p * 0.07
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.2 + _pl * 0.07)
HAFT_BELOW, HAFT_ABOVE = 1.35, 2.25                  # butt and head distances from the right fist
WEAPON_PROBES = (-HAFT_BELOW, 0.8, 1.6, HAFT_ABOVE + 0.3)

TAIL = [np.array(p) for p in ((0, 0.3, 2.18), (0, 0.82, 1.86), (0, 1.32, 1.52), (0, 1.8, 1.28), (0, 2.22, 1.2))]


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.08, 2.14), (0, 0.06, 2.55)),
        ('Spine1', 'Hips', (0, 0.06, 2.55), (0, 0.04, 2.96)),
        ('Spine2', 'Spine1', (0, 0.04, 2.96), (0, 0.02, 3.38)),
        ('Neck1', 'Spine2', (0, 0.02, 3.42), (0, -0.1, 3.74)),
        ('Neck', 'Neck1', (0, -0.1, 3.74), (0, -0.2, 3.96)),
        ('Head', 'Neck', (0, -0.2, 3.96), (0, -0.2, 4.36)),
        ('Jaw', 'Head', (0, -0.28, 3.93), (0, -0.78, 3.82)),
        ('Throat', 'Neck1', (0, -0.22, 3.55), (0, -0.3, 3.75)),
        ('LoinF1', 'Hips', (0, -0.4, 2.28), (0, -0.48, 1.72)),
        ('LoinF2', 'LoinF1', (0, -0.48, 1.72), (0, -0.5, 1.18)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
    ]
    prev = 'Hips'
    for i in range(4):
        out.append((f'Tail{i + 1}', prev, tuple(TAIL[i]), tuple(TAIL[i + 1])))
        prev = f'Tail{i + 1}'
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.42), ('Spine2', 0.58))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = BALL_OFF.copy()            # digitigrade: it rolls on the ball, never a heel
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_END = ('Death',)
COLLIDE_LEGS = {'L_Thigh': 0.32, 'R_Thigh': 0.32, 'L_Shin': 0.22, 'R_Shin': 0.22}
POP_SKIP = ('Loin', 'Tail')
FEET = ('L_Foot', 'R_Foot')
AIM_LIMITS = {'L_Hand': 75.0, 'R_Hand': 75.0, 'L_Foot': 95.0, 'R_Foot': 95.0}


def _chains():
    from rig import Chain
    return [Chain(['LoinF1', 'LoinF2'], 'Hips', gravity=0.6, stiff=0.2, damp=0.16, drag=0.8, collide=True)]


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
    F = Field((-1.15, -0.9, -0.05), (1.15, 2.5, 3.8), voxel)
    F.add(Ellipsoid((0, 0.12, 2.2), (0.36, 0.34, 0.3), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, 0.04, 2.62), (0.33, 0.27, 0.32), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, -0.02, 3.06), (0.55, 0.4, 0.42), rot_matrix(rx=-0.12), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.1, 3.26), (0.5, 0.27, 0.28), bone='Spine2'), 0.14)
    F.add(Ellipsoid((0, -0.24, 2.85), (0.27, 0.16, 0.5), bone='Spine1'), 0.12)        # the scuted belly
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.21, -0.22, 3.15), s), (0.22, 0.13, 0.17), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.08, 0.1, 3.38), s), _m((0.46, 0.06, 3.42), s), 0.14, 0.13, bone='Spine2'), 0.1)
        F.add(Ellipsoid(_m((0.36, 0.08, 2.92), s), (0.17, 0.22, 0.32), bone='Spine2'), 0.1)
    # the neck: long, thick, carried forward
    F.add(RoundCone((0, 0.04, 3.3), (0, -0.12, 3.76), 0.2, 0.16, bone='Neck1'), 0.1)
    F.add(Ellipsoid((0, -0.2, 3.62), (0.12, 0.1, 0.2), bone='Throat'), 0.08)
    # the tail, a counterweight
    rad = (0.29, 0.23, 0.16, 0.1, 0.045)
    for i in range(4):
        F.add(RoundCone(TAIL[i], TAIL[i + 1], rad[i], rad[i + 1], bone=f'Tail{i + 1}'), 0.08 if i else 0.15)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh, 0.2, bone=up), 0.1)
        F.add(RoundCone(sh, el, 0.18, 0.14, bone=up), 0.08)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0, -0.05, 0)), (0.11, 0.11, 0.2), _rot(sh, el), bone=up), 0.05)
        F.add(Sphere(el + np.array((0, 0.04, 0)), 0.1, bone=_side('ElbowFix', s)), 0.06)
        F.add(RoundCone(el, lerp(el, wr, 0.4), 0.13, 0.14, bone=fo), 0.06)
        F.add(RoundCone(lerp(el, wr, 0.4), wr, 0.14, 0.095, bone=fo), 0.06)
        # forearm fin
        ax = unit(wr - el)
        outv = unit(np.cross(ax, (0, -1.0, 0)) * -s)
        F.add(X.Inter(Ellipsoid(lerp(el, wr, 0.45) + outv * 0.12, (0.03, 0.12, 0.28), _rot(el, wr) @ rot_matrix(rz=0),
                                bone=fo), Sphere(lerp(el, wr, 0.45), 0.3)), 0.03)
        hp, kn, an, ba = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(BALL, s)
        th, shn = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0.02, 0.06)), kn, 0.31, 0.18, bone=th), 0.14)
        F.add(Ellipsoid(lerp(hp, kn, 0.4) + np.array((0.04 * s, 0.04, 0)), (0.24, 0.23, 0.34), _rot(hp, kn), bone=th), 0.1)
        F.add(Sphere(kn, 0.13, bone=_side('KneeFix', s)), 0.07)
        F.add(RoundCone(kn, an, 0.17, 0.1, bone=shn), 0.08)
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0, 0.06, 0.02)), (0.13, 0.12, 0.24), _rot(kn, an), bone=shn), 0.07)
        foot = _side('Foot', s)
        F.add(RoundCone(an, ba + np.array((0, 0, 0.03)), 0.1, 0.085, bone=foot), 0.05)
        F.add(Sphere(an + np.array((0, 0.06, 0)), 0.07, bone=foot), 0.04)       # the raised heel spur
        toes = _side('Toes', s)
        for k, dx in enumerate((-0.09, 0.0, 0.09)):
            a = ba + np.array((dx * s * 0.6, 0.0, 0.0))
            b = a + np.array((dx * s * 0.5, -0.32 + abs(dx) * 0.6, -0.04))
            F.add(RoundCone(a, b, 0.05, 0.035, bone=toes), 0.03)
    # the back ridge: low spines down the spine and the tail
    for i, t in enumerate(np.linspace(0.0, 1.0, 9)):
        if t < 0.35:
            p = lerp((0, 0.32, 3.3), (0, 0.38, 2.4), t / 0.35)
            bone = 'Spine2' if t < 0.18 else 'Spine1'
        else:
            u = (t - 0.35) / 0.65 * 3.0
            k = min(2, int(u))
            p = lerp(TAIL[k], TAIL[k + 1], u - k) + np.array((0, 0, 0.22 - 0.06 * k))
            bone = f'Tail{k + 1}'
        F.add(RoundCone(p - np.array((0, 0, 0.06)), p + np.array((0, 0.08, 0.12)), 0.05, 0.008, bone=bone), 0.03)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=2), band=0.1)
    return F


# ------------------------------------------------------------------ head
def build_head(voxel):
    F = Field((-0.38, -1.02, 3.55), (0.38, 0.38, 4.62), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, -0.06, 3.7), (0, -0.2, 3.97), 0.15, 0.13, bone='Neck'), 0.07)
    F.add(Ellipsoid((0, -0.3, 4.03), (0.18, 0.22, 0.17), bone='Head'), 0.07)          # the skull
    F.add(RoundCone((0, -0.36, 4.03), (0, -0.86, 3.96), 0.14, 0.075, bone='Head'), 0.08)  # the snout
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.11, -0.48, 4.1), s), (0.06, 0.09, 0.045), bone='Head'), 0.03)    # brow over the eye
        F.add(Ellipsoid(_m((0.13, -0.38, 3.97), s), (0.06, 0.12, 0.06), bone='Head'), 0.04)    # cheek
        F.add(Ellipsoid(_m((0.05, -0.83, 3.99), s), (0.03, 0.04, 0.025), bone='Head'), 0.02)   # nostril ridge
        F.sub(Sphere(_m(EYE, s), EYE_R + 0.012), 0.015)
        F.sub(Ellipsoid(_m((0.04, -0.86, 3.99), s), (0.012, 0.02, 0.01)), 0.008)               # nostril
    # the lower jaw, a little open; teeth along both jaws
    F.add(RoundCone((0, -0.32, 3.9), (0, -0.82, 3.86), 0.11, 0.055, bone='Jaw'), 0.06)
    F.sub(Ellipsoid((0, -0.62, 3.925), (0.075, 0.26, 0.018)), 0.01)
    for s in (1, -1):
        for k in range(7):
            u = k / 6
            y = -0.46 - 0.36 * u
            x = (0.095 - 0.04 * u) * s
            F.add(RoundCone((x, y, 3.935), (x * 0.95, y - 0.01, 3.9), 0.012, 0.002, bone='Head'), 0.004)
            F.add(RoundCone((x * 0.9, y + 0.02, 3.895), (x * 0.86, y + 0.01, 3.93), 0.01, 0.002, bone='Jaw'), 0.004)
    # gill frills at the jaw hinge: three ribbed fans each side
    for s in (1, -1):
        for k in range(3):
            a = np.array((0.16 * s, -0.22 + 0.06 * k, 3.95 - 0.04 * k))
            b = a + np.array((0.2 * s, 0.14 + 0.03 * k, -0.04 - 0.06 * k))
            F.add(X.Inter(Ellipsoid((a + b) / 2, (0.11, 0.025, 0.07), _rot(a, b) @ rot_matrix(rx=0.3)),
                          Sphere((a + b) / 2, 0.2), 0.0, bone='Neck' if k else 'Head'), 0.02)
            F.add(RoundCone(a, b + np.array((0.03 * s, 0.03, 0.0)), 0.016, 0.006, bone='Neck' if k else 'Head'), 0.012)
    # the finned crest: spines from the brow over the skull and down the nape, webbed
    spines = []
    for k in range(7):
        u = k / 6
        base = lerp((0, -0.5, 4.14), (0, 0.06, 3.86), u) + np.array((0, 0, 0.1 * math.sin(math.pi * min(1, u * 1.4))))
        tip = base + np.array((0, 0.26 + 0.12 * u, 0.5 - 0.24 * u))
        bone = 'Head' if u < 0.7 else 'Neck'
        F.add(RoundCone(base, tip, 0.03, 0.006, bone=bone), 0.014)
        spines.append((base, tip, bone))
    for (b0, t0, bn), (b1, t1, _) in zip(spines, spines[1:]):
        c = (b0 + b1 + t0 * 0.85 + t1 * 0.85) / 3.7
        F.add(X.Inter(RoundBox(c, (0.011, 0.2, 0.2), _rot(b0, t0 * 0.5 + t1 * 0.5), radius=0.005),
                      X.Union([Sphere(lerp(b0, t0, 0.35), 0.13), Sphere(lerp(b1, t1, 0.35), 0.13)]), 0.0, bone=bn),
              0.01)
    F.displace(lambda X_, Y_, Z_: 0.0025 * noise.fbm(X_ * 28, Y_ * 28, Z_ * 28, octaves=2), band=0.04)
    return F


def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.15, w + down * 0.62) - 0.22
    hi = np.maximum(w - down * 0.15, w + down * 0.62) + 0.22
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.12, w + down * 0.02, 0.075, 0.07, bone=hand), 0.03)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(RoundBox(w + down * 0.11, (0.07, 0.03, 0.07), Rm, radius=0.03, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.038
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.85, bone=b1), 0.014)
        F.add(Sphere(mid, r0 * 0.88, bone=b2), 0.01)
        F.add(RoundCone(mid, tip, r0 * 0.85, r0 * 0.6, bone=b2), 0.01)
        d2 = unit(tip - mid)
        claw_tip = tip + d2 * 0.09 + palm * 0.04
        F.add(RoundCone(tip - d2 * 0.02, claw_tip, r0 * 0.55, 0.004, bone=b2), 0.008)
    return F


# ------------------------------------------------------------------ worn iron and leather
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
    noise = Noise(31)
    dent = lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=2)  # noqa: E731

    def layer(name, base, lo, hi, off, thick, mask, mat, binding='transfer', bone='', allow=None, extra=None):
        G = X.layer_field(base, lo, hi, voxel, off, thick, mask, extra=extra, noise=dent)
        out.append((name, G, mat, binding, bone, allow))

    # the iron collar of the Smith's foundry, spiked
    def collar_mask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ + 0.0) ** 2)
        return rg(Z_, 3.3, 3.34) * (1 - rg(Z_, 3.5, 3.54)) * rg(r, 0.55, 0.45)

    def spikes(G):
        for a in np.linspace(0, 2 * math.pi, 9)[:-1]:
            c = np.array((0.36 * math.sin(a), 0.02 - 0.34 * math.cos(a), 3.44))
            d = unit(np.array((math.sin(a), -math.cos(a), 0.5)))
            G.add(RoundCone(c, c + d * 0.13, 0.03, 0.004), 0.015)
    layer('Collar', Fb, (-0.6, -0.6, 3.2), (0.6, 0.6, 3.65), 0.03, 0.05, collar_mask, 'iron',
          allow=('Spine2', 'Neck1'), extra=spikes)

    # a spaulder of layered plates on the left shoulder
    c = SHOULDER + np.array((0.04, 0.0, 0.04))

    def sp_mask(X_, Y_, Z_):
        d = np.sqrt((X_ - c[0]) ** 2 + (Y_ - c[1]) ** 2 + (Z_ - c[2]) ** 2)
        return rg(d, 0.36, 0.3) * rg(Z_, c[2] - 0.22, c[2] - 0.14) * rg(X_, 0.26, 0.34)
    layer('L_Spaulder', Fb, c - 0.45, c + 0.45, lambda X_, Y_, Z_: 0.04 + 0.05 * rg(Z_, c[2] + 0.1, c[2] - 0.2), 0.045,
          sp_mask, 'iron', allow=('L_UpperArm', 'L_Clavicle', 'Spine2'))
    # the harness: a broad strap from the right shoulder to the left hip, and the belt
    a, b = np.array((-0.4, -0.2, 3.42)), np.array((0.32, -0.22, 2.3))

    def strap_mask(X_, Y_, Z_):
        d, u = X.seg_dist(X_, Y_ * 0.0, Z_, a * np.array((1, 0, 1)), b * np.array((1, 0, 1)))
        return rg(d, 0.1, 0.075)
    layer('Strap', Fb, (-0.7, -0.6, 2.15), (0.7, 0.55, 3.6), 0.02, 0.03, strap_mask, 'leather',
          allow=('Spine1', 'Spine2', 'Hips'))

    def belt_mask(X_, Y_, Z_):
        return rg(Z_, 2.22, 2.26) * (1 - rg(Z_, 2.36, 2.4)) * (1 - rg(Y_, 0.25, 0.32))

    def buckle(G):
        G.add(RoundBox((0, -0.38, 2.31), (0.08, 0.025, 0.07), radius=0.012), 0.01)
    layer('Belt', Fb, (-0.6, -0.6, 2.1), (0.6, 0.5, 2.5), 0.03, 0.035, belt_mask, 'leather',
          allow=('Hips', 'Spine1'), extra=buckle)
    # bracers on both forearms
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)

        def br_mask(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return rg(u, 0.45, 0.5) * (1 - rg(u, 0.88, 0.93)) * rg(d, 0.2, 0.16)
        layer(_side('Bracer', s), Fb, np.minimum(el, wr) - 0.3, np.maximum(el, wr) + 0.3, 0.02, 0.035, br_mask, 'iron',
              binding='rigid', bone=_side('Forearm', s))
        kn = _m(KNEE, s)

        def kn_mask(X_, Y_, Z_, kn=kn):
            d = np.sqrt((X_ - kn[0]) ** 2 + (Y_ - kn[1] + 0.06) ** 2 + (Z_ - kn[2]) ** 2)
            return rg(d, 0.2, 0.15) * rg(-Y_, 0.2, 0.32)
        layer(_side('KneeGuard', s), Fb, kn - 0.3, kn + 0.3, 0.025, 0.04, kn_mask, 'iron', binding='rigid',
              bone=_side('KneeFix', s))
    return out


def build_loin(voxel):
    F = Field((-0.4, -0.66, 1.05), (0.4, -0.2, 2.42), voxel)
    rng = np.random.default_rng(3)
    cyl = np.array((0, 0.1, 0))
    shell = X.Shell(RoundCone(cyl + np.array((0, 0, 0.5)), cyl + np.array((0, 0, 3.0)), 0.55, 0.55), 0.028)
    box = RoundBox((0, -0.45, 1.75), (0.22, 0.25, 0.6), radius=0.02)
    F.add(X.Inter(shell, box, 0.0), 0.0, weight=False)
    for k in range(7):
        x = -0.2 + 0.065 * k + rng.uniform(-0.02, 0.02)
        F.sub(Ellipsoid((x, -0.45, 1.18 + rng.uniform(-0.03, 0.1)), (rng.uniform(0.02, 0.04), 0.2,
                                                                         rng.uniform(0.05, 0.14))), 0.01)
    noise = Noise(14)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 2, Z_ * 1.2, octaves=3), band=0.05)
    return F


def loin_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'LoinF1', 'LoinF2']
    W = np.zeros((len(P), 3))
    t = np.clip((2.3 - P[:, 2]) / (2.3 - 1.15), 0, 1)
    hip = np.clip(1 - t / 0.1, 0, 1)
    low = np.clip((t - 0.4) / 0.3, 0, 1)
    low = low * low * (3 - 2 * low)
    W[:, 0] = hip
    W[:, 1] = (1 - hip) * (1 - low)
    W[:, 2] = (1 - hip) * low
    W = R.relax(W, E, iters=3)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


# ------------------------------------------------------------------ the halberd (local: +Z up the haft)
def build_halberd(voxel):
    F = Field((-0.5, -0.12, -HAFT_BELOW - 0.15), (0.5, 0.12, HAFT_ABOVE + 0.65), voxel)
    F.add(RoundCone((0, 0, -HAFT_BELOW), (0, 0, HAFT_ABOVE + 0.1), 0.045, 0.04), 0.01)
    for z in (-0.25, 0.25, 1.1, HAFT_ABOVE - 0.35):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.047, 0.012), 0.006)
    F.add(RoundCone((0, 0, -HAFT_BELOW - 0.12), (0, 0, -HAFT_BELOW + 0.08), 0.02, 0.055), 0.01)   # butt spike
    h = HAFT_ABOVE
    # the socket and langets
    F.add(RoundCone((0, 0, h - 0.3), (0, 0, h + 0.15), 0.06, 0.055), 0.01)
    # the axe blade: a broad crescent on +X
    blade = X.Inter(Ellipsoid((0.2, 0, h - 0.02), (0.3, 0.018, 0.42)),
                    X.Diff(RoundBox((0.25, 0, h - 0.02), (0.25, 0.03, 0.45), radius=0.01),
                           Ellipsoid((-0.02, 0, h - 0.02), (0.14, 0.1, 0.5))), 0.0)
    F.add(blade, 0.012)
    F.sub(Sphere((0.13, 0, h + 0.12), 0.035), 0.01)
    F.sub(Sphere((0.13, 0, h - 0.16), 0.035), 0.01)
    # the back hook on -X and the top spike
    F.add(RoundCone((-0.05, 0, h), (-0.22, 0, h - 0.02), 0.04, 0.015), 0.015)
    F.add(RoundCone((-0.22, 0, h - 0.02), (-0.27, 0, h - 0.14), 0.015, 0.004), 0.01)
    F.add(X.Prism((0, 0, h + 0.12), (0, 0, h + 0.62), 0.045, n=4, tip=0.75, rot=math.pi / 4), 0.01)
    rng = np.random.default_rng(6)
    for k in range(5):
        z = h - 0.3 + 0.55 * rng.random()
        F.sub(Sphere((0.48 + 0.02 * rng.random(), 0, z), rng.uniform(0.01, 0.025)), 0.004)
    return F


def halberd_matrix():
    ax = np.array(WEAPON_AXIS)
    w, down, width, palm = HAND.frame(-1)
    edge = unit(np.cross(palm, ax))      # the axe blade faces this way
    flat = unit(np.cross(ax, edge))
    M = np.eye(4)
    M[:3, 0] = -edge
    M[:3, 1] = flat
    M[:3, 2] = ax
    M[:3, 3] = GRIP_R
    return M


def build_ice(voxel):
    rng = np.random.default_rng(23)
    out = []

    def cluster(name, c, n, size, bone, up=(0, 0, 1), down=False, spread=0.06):
        c = np.asarray(c, float)
        G = Field(c - size * 1.6 - 0.05, c + size * 1.6 + 0.05, voxel)
        for k in range(n):
            d = unit(np.asarray(up, float) + rng.normal(0, 0.5, 3))
            if down:
                d = unit(np.array((rng.normal(0, 0.15), rng.normal(0, 0.15), -1.0)))
            L_ = size * rng.uniform(0.45, 1.0)
            a = c + rng.normal(0, spread, 3) * (0.3 if down else 1.0)
            G.add(X.Prism(a - d * L_ * 0.25, a + d * L_, L_ * rng.uniform(0.12, 0.2), n=int(rng.choice([5, 6])),
                          tip=rng.uniform(0.25, 0.45), rot=rng.uniform(0, 3), tip_a=0.1), 0.004)
        out.append((name, G, bone))
    cluster('IceCrest', (0, -0.15, 4.25), 5, 0.12, 'Head', up=(0, 0.4, 0.8))
    cluster('IceSpaulder', SHOULDER + np.array((0.25, 0.0, -0.22)), 5, 0.13, 'L_UpperArm', down=True, spread=0.1)
    cluster('IceTail', TAIL[2] + np.array((0, 0, 0.12)), 4, 0.12, 'Tail2', up=(0, 0.2, 1))
    for s in (1, -1):
        cluster(_side('IceKnee', s), _m(KNEE, s) + np.array((0, 0.1, 0.05)), 4, 0.1, _side('KneeFix', s),
                up=(0.3 * s, 0.6, 0.3))
    return out


def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand, vp = 0.012 * k, 0.0055 * k, 0.0048 * k, 0.009 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    S = [Sculpt('Body', Fb, 'scales', 8000, spots=[((0, -0.1, 3.6), 0.25, 0.4)], tau=0.05),
         Sculpt('Head', Fh, 'scales', 4200, spots=[((0, -0.55, 4.0), 0.22, 1.0)], tau=0.02),
         Sculpt('L_Claw', build_hand(1, vhand), 'scales', 1300, tau=0.012),
         Sculpt('R_Claw', build_hand(-1, vhand), 'scales', 1300, tau=0.012)]
    targets = {'Collar': 1100, 'Spaulder': 1100, 'Strap': 700, 'Belt': 700, 'Bracer': 450, 'KneeGuard': 380}
    for name, G, mat, binding, bone, allow in gear(Fb, Fh, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        S.append(Sculpt(name, G, mat, targets[key], binding=binding, bone=bone, allow=allow, relax=8))
    S.append(Sculpt('Loincloth', build_loin(vp), 'cloth', 900, binding='own', weigh=loin_weights))
    for name, G, bone in build_ice(0.006 * k):
        S.append(Sculpt(name, G, 'ice', 260, binding='rigid', bone=bone))
    return S
