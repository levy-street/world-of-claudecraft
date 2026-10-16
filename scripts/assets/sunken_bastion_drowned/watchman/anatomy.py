"""Drowned Watchman: skeleton and sculpts (rest pose), in yards.

A sentry of the Sunken Bastion's night watch, drowned at his post when the storm
tide took the walls, still walking his round. Gaunt where the Revenant is
bloated: the flesh shrunk to the bone, the cheeks fallen in, the lips gone back
off the teeth in a grin, a beard of weed hanging off the chin; sea light in the
sockets. A wide kettle hat with a drooping brim, a riveted brigandine over sodden
mail with the Bastion's tower-over-waves on the breast, a long watch coat split
front and back down to the knees, leather gloves and tall sea boots; a watch
lantern still glowing at his left hip; a long rusted halberd with a torn pennon.
Barnacles crust the hat and the shoulders, kelp hangs off the brim and the belt.

Axes: yards, +Z up, faces -Y (glTF +Z), his left is +X. Rest is an A-pose.
The skeleton, the landmarks and the hand are the Sanctum kit's soldier (the
Revenant's); the dressing, the face and the clips are his own.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, mirror, unit

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'DrownedWatchman'
PREFIX = 'watchman'
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

# ------------------------------------------------------------------ the halberd
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.2 + _p * 0.07               # the centre of the right fist's grip on the haft
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.2 + _pl * 0.07)
HAFT_BELOW, HAFT_ABOVE = 1.45, 2.35                # butt and head distances from the right fist


# The head, the helm and everything on them are sculpted at the kit soldier's size
# and then grown about the base of the neck (post_mesh): a heavier, more readable
# head under the camera, the way the game's figures carry theirs.
HEAD_SCALE = 1.13
HEAD_PIVOT = np.array((0.0, 0.02, 3.6))
HEAD_DROP = 0.07
HEAD_PARTS = ('Head', 'TeethUp', 'TeethLow', 'Helm', 'KelpHelm', 'Hair', 'Beard', 'BarnHelm', 'Eyes')


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
        ('TabF1', 'Hips', (0, -0.5, 2.6), (0, -0.6, 1.86)),
        ('TabF2', 'TabF1', (0, -0.6, 1.86), (0, -0.66, 1.1)),
        ('TabB1', 'Hips', (0, 0.55, 2.6), (0, 0.66, 1.86)),
        ('TabB2', 'TabB1', (0, 0.66, 1.86), (0, 0.74, 1.1)),
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
WEAPON_PROBES = (-HAFT_BELOW, 0.8, 1.6, HAFT_ABOVE + 0.3)
COLLIDE_LEGS = {'L_Thigh': 0.38, 'R_Thigh': 0.38, 'L_Shin': 0.28, 'R_Shin': 0.28}


def _chains():
    from rig import Chain
    return [
        Chain(['TabF1', 'TabF2'], 'Hips', gravity=0.5, stiff=0.22, damp=0.22, drag=0.9, collide=True),
        Chain(['TabB1', 'TabB2'], 'Hips', gravity=0.5, stiff=0.22, damp=0.22, drag=0.9, collide=True),
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
    F.add(Ellipsoid((0, 0.04, 2.44), (0.4, 0.29, 0.3), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, 0.02, 2.8), (0.37, 0.28, 0.33), bone='Spine1'), 0.16)
    F.add(Ellipsoid((0, 0.0, 3.2), (0.62, 0.42, 0.44), rot_matrix(rx=-0.06), bone='Spine2'), 0.18)
    F.add(Ellipsoid((0, 0.14, 3.38), (0.58, 0.3, 0.31), bone='Spine2'), 0.16)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.23, -0.2, 3.3), s), (0.25, 0.14, 0.18), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.12, 3.54), s), _m((0.5, 0.08, 3.58), s), 0.16, 0.14, bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.38, 0.08, 3.06), s), (0.2, 0.24, 0.34), bone='Spine2'), 0.12)
        F.add(Ellipsoid(_m((0.19, 0.2, 2.36), s), (0.23, 0.2, 0.24), bone='Hips'), 0.12)
    F.add(RoundCone((0, 0.05, 3.5), (0, 0.0, 3.98), 0.16, 0.13, bone='Neck'), 0.1)

    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.03 * s, 0, 0.0)), 0.22, bone=up), 0.1)
        F.add(RoundCone(sh, el, 0.19, 0.145, bone=up), 0.1)
        F.add(Ellipsoid(lerp(sh, el, 0.5) + np.array((0, -0.06, 0)), (0.12, 0.12, 0.22), _rot(sh, el), bone=up), 0.06)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.12, bone=_side('ElbowFix', s)), 0.08)
        if True:
            # both forearms, under the gloves' long cuffs and the vambraces
            F.add(RoundCone(el, lerp(el, wr, 0.35), 0.145, 0.16, bone=fo), 0.08)
            F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.16, 0.105, bone=fo), 0.08)

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
MOUTH = np.array((0.0, -0.205, 4.065))


def build_head(voxel):
    """A starved drowned face: the skull close under the skin, the cheeks fallen
    in, deep sockets, the nose eaten to the cartilage, the lips shrunk back off a
    grin of long teeth, the jaw hanging a little; stringy neck cords."""
    F = Field((-0.3, -0.36, 3.55), (0.3, 0.3, 4.55), voxel)
    noise = Noise(19)
    F.add(RoundCone((0, 0.05, 3.6), (0, 0.0, 4.0), 0.13, 0.12, bone='Neck'), 0.06)
    for s in (1, -1):
        F.ridge(Polyline([_m((0.07, -0.08, 3.68), s), _m((0.06, -0.12, 3.95), s)], 0.003), 0.014, k=0.014)  # neck cord
    F.add(Ellipsoid((0, 0.0, 4.25), (0.18, 0.21, 0.23), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.1, 4.16), (0.145, 0.13, 0.17), bone='Head'), 0.06)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.105, -0.17, 4.19), s), (0.05, 0.04, 0.032), bone='Head'), 0.016)     # sharp cheekbone
        F.sub(Ellipsoid(_m((0.1, -0.19, 4.09), s), (0.045, 0.05, 0.06)), 0.03)                      # fallen cheek
        F.sub(Ellipsoid(_m((0.14, -0.06, 4.28), s), (0.03, 0.06, 0.05)), 0.02)                      # sunken temple
        F.add(Ellipsoid(_m((0.165, -0.02, 4.17), s), (0.028, 0.058, 0.078), bone='Head'), 0.03)    # ear
        F.add(Ellipsoid(_m((0.07, -0.13, 3.99), s), (0.05, 0.08, 0.04), rot_matrix(rx=0.3), bone='Jaw'), 0.03)  # jaw corner
    F.add(Ellipsoid((0, -0.2, 4.268), (0.15, 0.05, 0.036), rot_matrix(rx=0.15), bone='Head'), 0.025)  # brow
    F.add(RoundCone((0, -0.205, 4.24), (0.0, -0.245, 4.17), 0.02, 0.022, bone='Head'), 0.02)      # the nose bridge
    F.sub(Ellipsoid((0.0, -0.255, 4.15), (0.03, 0.03, 0.03)), 0.008)                              # nose eaten away
    # a long jaw, hanging a little open; thin lips drawn back
    F.add(Ellipsoid((0, -0.12, 4.0), (0.11, 0.11, 0.075), rot_matrix(rx=0.24), bone='Jaw'), 0.05)
    F.add(Ellipsoid((0, -0.2, 3.955), (0.05, 0.045, 0.05), bone='Jaw'), 0.03)
    F.add(Ellipsoid((0, -0.2, 4.03), (0.055, 0.016, 0.01), bone='Jaw'), 0.008)
    F.add(Ellipsoid((0, -0.215, 4.105), (0.055, 0.016, 0.01), bone='Head'), 0.008)
    F.sub(Ellipsoid(MOUTH + np.array((0, 0.0, 0.01)), (0.062, 0.08, 0.04)), 0.01)                  # the grin's gap
    for s in (1, -1):
        F.sub(Sphere(_m(EYE + np.array((0, -0.006, 0.004)), s), EYE_R + 0.026), 0.018)             # deep sockets
    # skin: dry ridges over the skull, wrinkles round the grin
    for s in (1, -1):
        F.groove(Polyline([_m((0.05, -0.24, 4.12), s), _m((0.09, -0.22, 4.06), s), _m((0.1, -0.2, 3.98), s)],
                          0.003), 0.008, k=0.009)
    F.groove(Polyline([(-0.09, -0.21, 4.31), (0.0, -0.225, 4.315), (0.09, -0.21, 4.31)], 0.003), 0.005, k=0.008)
    F.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 16, Y_ * 16, Z_ * 16, octaves=2)
               + 0.0015 * noise.fbm(X_ * 44, Y_ * 44, Z_ * 44, octaves=2), band=0.05)
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
def build_hand(side, voxel, forearm, cuff=False):
    w, down, width, palm = hand_frame(side)
    el = ELBOW if side > 0 else mirror(ELBOW)
    lo = np.minimum(w, el) - 0.34
    hi = np.maximum(w + down * 0.62, el) + 0.34
    if not forearm:
        lo = np.minimum(w - down * 0.1, w + down * 0.55) - 0.2
        hi = np.maximum(w - down * 0.1, w + down * 0.55) + 0.2
    ax = unit(w - el)
    if cuff:
        lo = np.minimum(lo, w - ax * 0.45 - 0.22)
        hi = np.maximum(hi, w - ax * 0.45 + 0.22)
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    if cuff:
        # a heavy leather gauntlet glove: the flared cuff over the wrist
        for zf, r in ((0.02, 0.105), (0.14, 0.125), (0.26, 0.145)):
            F.add(X.Shell(RoundCone(w - ax * zf, w - ax * (zf + 0.1), r, r + 0.014, bone=hand), 0.024), 0.012)
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
    """Every plate as (name, field, binding, bone, allow): the riveted brigandine
    (the cloth-covered coat of plates), the gorget, a single-lame pauldron each
    side, couters, both vambraces and the knee cops."""
    out = []
    rg = X.ramp
    BU = _Union(Fb, Fh)
    noise = Noise(25)
    dent = lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=2)  # noqa: E731

    def plate(name, base, lo, hi, off, thick, mask, binding='transfer', bone='', allow=None, extra=None, v=None):
        G = X.layer_field(base, lo, hi, v or voxel, off, thick, mask, extra=extra, noise=dent)
        out.append((name, G, binding, bone, allow))
        return G

    def brig_mask(X_, Y_, Z_):
        m = rg(Z_, 2.48, 2.54) * (1 - rg(Z_, 3.5, 3.58))
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            m = m * rg(d, 0.25, 0.31)
        m = m * (1 - (1 - rg(np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2), 0.2, 0.26)) * rg(Z_, 3.3, 3.45))
        return m

    def rivets(G):
        # rows of rivet heads (the plates riveted inside the cloth), front and back
        for z in np.arange(2.62, 3.4, 0.13):
            for a in np.linspace(-2.6, 2.6, 15):
                p = np.array((0.47 * math.sin(a), 0.02 - 0.42 * math.cos(a), z))
                G.add(Sphere(p * np.array((1.0, 1.0, 1.0)), 0.016), 0.004)
        ring = [(0.47 * math.sin(a), 0.03 - 0.44 * math.cos(a), 2.53) for a in np.linspace(-math.pi, math.pi, 41)]
        G.add(Polyline(ring, 0.018), 0.01)
    plate('Cuirass', Fb, (-0.75, -0.62, 2.4), (0.75, 0.62, 3.7), 0.03, 0.06, brig_mask,
          allow=('Spine1', 'Spine2', 'Hips'), extra=rivets)

    def gorget_mask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2)
        return rg(Z_, 3.44, 3.48) * (1 - rg(Z_, 3.82, 3.87)) * rg(r, 0.4, 0.3)
    plate('Gorget', BU, (-0.45, -0.45, 3.4), (0.45, 0.45, 3.92), 0.035, 0.04, gorget_mask, allow=('Neck', 'Spine2'))

    for s in (1, -1):
        c = _m(SHOULDER, s) + np.array((0.04 * s, 0.0, 0.05))

        def pmask(X_, Y_, Z_, c=c, s=s):
            d = np.sqrt((X_ - c[0]) ** 2 + (Y_ - c[1]) ** 2 + (Z_ - c[2]) ** 2)
            return rg(d, 0.36, 0.3) * rg(Z_, c[2] - 0.2, c[2] - 0.12) * rg(X_ * s, 0.3, 0.38)

        def flange(G, c=c, s=s):
            G.add(RoundCone(c + np.array((-0.14 * s, -0.14, 0.17)), c + np.array((-0.09 * s, 0.15, 0.18)), 0.025,
                            0.025), 0.035)
            for a in (-0.6, 0.0, 0.6):
                G.add(Sphere(c + np.array((0.19 * s * math.cos(a), -0.19 * math.sin(a), -0.08)), 0.016), 0.005)
        plate(_side('Pauldron', s), Fb, c - 0.45, c + 0.45, 0.05, 0.045, pmask,
              allow=(_side('UpperArm', s), _side('Clavicle', s), 'Spine2'), extra=flange)

        def lm(X_, Y_, Z_, c=c, s=s):
            d, u = _arm_d(X_, Y_, Z_, s)
            z0, z1 = c[2] - 0.32, c[2] - 0.16
            return (rg(Z_, z0, z0 + 0.03) * (1 - rg(Z_, z1, z1 + 0.03)) * rg(X_ * s, 0.42, 0.5) * rg(d, 0.36, 0.3))
        plate(_side('PauldronLame1', s), Fb, c - 0.55, c + 0.55, 0.065, 0.04, lm,
              allow=(_side('UpperArm', s), _side('Clavicle', s)))

    for s in (1, -1):
        el = _m(ELBOW, s)

        def cmask(X_, Y_, Z_, el=el):
            d = np.sqrt((X_ - el[0]) ** 2 + (Y_ - el[1] - 0.05) ** 2 + (Z_ - el[2]) ** 2)
            return rg(d, 0.18, 0.13)
        plate(_side('Couter', s), Fb, el - 0.35, el + 0.35, 0.03, 0.04, cmask, binding='rigid',
              bone=_side('ElbowFix', s))

        wr = _m(WRIST, s)

        def vmask(X_, Y_, Z_, s=s):
            d, u = _arm_d(X_, Y_, Z_, s, 'ELBOW', 'WRIST')
            return rg(u, 0.14, 0.2) * (1 - rg(u, 0.6, 0.66)) * rg(d, 0.24, 0.19)
        plate(_side('Vambrace', s), Fb, np.minimum(el, wr) - 0.3, np.maximum(el, wr) + 0.3, 0.025, 0.04, vmask,
              binding='rigid', bone=_side('Forearm', s))

    for s in (1, -1):
        kn = _m(KNEE, s)

        def kmask(X_, Y_, Z_, kn=kn):
            d = np.sqrt((X_ - kn[0]) ** 2 + (Y_ - kn[1] + 0.06) ** 2 + (Z_ - kn[2]) ** 2)
            return rg(d, 0.2, 0.15) * rg(-Y_, 0.0, 0.08)
        plate(_side('Poleyn', s), Fb, kn - 0.35, kn + 0.35, 0.06, 0.045, kmask, binding='rigid',
              bone=_side('KneeFix', s))
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


# ------------------------------------------------------------------ the morion
class _Brim(sdf.Prim):
    """A kettle hat's brim: a ring round the crown sloping down and out, a little
    deeper at the sides than at the front and back."""

    def __init__(self, c, rin, rout, lift, th, bone=None):
        self.c, self.rin, self.rout, self.lift, self.th = np.asarray(c, float), rin, rout, lift, th
        self.bone = bone
        e = max(rout) + 0.12
        self.lo = self.c - np.array((e, e, abs(lift) + 0.15))
        self.hi = self.c + np.array((e, e, 0.12))

    @staticmethod
    def _ell(a, r):
        return 1.0 / np.sqrt((np.cos(a) / r[0]) ** 2 + (np.sin(a) / r[1]) ** 2)

    def profile(self, a, t):
        tc = np.clip(t, 0, 1)
        droop = self.lift * (1.0 + 0.25 * np.cos(a) ** 2)
        return -droop * tc ** 1.15, droop

    def outer(self, a):
        return self._ell(a, self.rout)

    def dist(self, X_, Y_, Z_):
        x, y, z = X_ - self.c[0], Y_ - self.c[1], Z_ - self.c[2]
        r = np.sqrt(x * x + y * y)
        a = np.arctan2(y, x)
        ri, ro = self._ell(a, self.rin), self.outer(a)
        t = (r - ri) / (ro - ri)
        zs, droop = self.profile(a, t)
        slope = droop * 1.15 / (ro - ri)
        dv = np.abs(z - zs) / np.sqrt(1 + slope ** 2) - self.th * 0.5
        dr = np.maximum(r - ro, (ri - 0.05) - r)
        return np.maximum(dv, dr)


HELM_C = np.array((0.0, -0.01, 4.3))
BRIM_IN, BRIM_OUT, BRIM_LIFT = (0.25, 0.27), (0.52, 0.54), 0.15


def build_helm(Fh, voxel):
    """A kettle hat: a tall rounded crown with a low comb, a wide brim sloping down
    all round with a rolled edge, a riveted band; dented. Rigid on the head."""
    G = Field((-0.66, -0.68, 3.95), (0.66, 0.66, 4.85), voxel)
    G.add(X.Inter(Ellipsoid((0, -0.01, 4.3), (0.26, 0.28, 0.4)), X.Plane((0, 0, 4.29), (0, 0, -1)), 0.0), 0.03)
    G.add(X.Inter(RoundBox((0, -0.01, 4.6), (0.014, 0.24, 0.12), radius=0.008),
                  Ellipsoid((0, -0.01, 4.3), (0.2, 0.27, 0.43)), 0.0), 0.02)
    brim = _Brim(HELM_C, BRIM_IN, BRIM_OUT, BRIM_LIFT, 0.024)
    G.add(brim, 0.02)
    edge = []
    for a in np.linspace(-math.pi, math.pi, 73):
        ro = brim.outer(a)
        zs, _ = brim.profile(a, 1.0)
        edge.append((HELM_C[0] + ro * math.cos(a) * 0.99, HELM_C[1] + ro * math.sin(a) * 0.99, HELM_C[2] + zs))
    G.add(Polyline(edge, 0.016), 0.01)
    ring = [(0.262 * math.cos(a), -0.01 + 0.282 * math.sin(a), 4.33) for a in np.linspace(-math.pi, math.pi, 37)]
    G.add(Polyline(ring, 0.018), 0.01)
    for a in np.linspace(0, math.tau, 13)[:-1]:
        G.add(Sphere((0.276 * math.cos(a), -0.01 + 0.296 * math.sin(a), 4.335), 0.014), 0.004)
    _dents(G, [((0.27, -0.14, 4.57), 0.07, 0.01), ((-0.2, 0.24, 4.6), 0.07, 0.01)])
    noise = Noise(37)
    G.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=2), band=0.05)
    return G


# ------------------------------------------------------------------ the tabard
def build_tabard(voxel):
    """The long watch coat's skirts: a flared shell from the waist to the knees,
    split up the front and the back, the hem ragged and torn; heavy with water."""
    F = Field((-0.9, -0.9, 1.0), (0.9, 0.9, 2.75), voxel)
    rng = np.random.default_rng(6)
    cone = X.Shell(RoundCone((0, 0.04, 2.7), (0, 0.06, 1.1), 0.5, 0.72), 0.035)
    band = RoundBox((0, 0.04, 1.95), (1.0, 1.0, 0.75), radius=0.0)
    F.add(X.Inter(cone, band, 0.0, bone='Hips'), 0.0, weight=False)
    for sgn in (-1, 1):                                                   # the front and back splits
        F.sub(RoundBox((0, 0.7 * sgn, 1.55), (0.05 + 0.03 * (sgn > 0), 0.3, 0.55), radius=0.01), 0.02)
    for k in range(26):                                                   # the ragged hem
        a = math.tau * k / 26 + rng.uniform(-0.08, 0.08)
        r = 0.72
        F.sub(Ellipsoid((r * math.sin(a), 0.06 - r * math.cos(a), 1.1 + rng.uniform(-0.05, 0.12)),
                        (rng.uniform(0.04, 0.08), rng.uniform(0.04, 0.08), rng.uniform(0.06, 0.2))), 0.01)
    for k in range(5):                                                    # holes rotted through
        a = rng.uniform(0, math.tau)
        F.sub(Sphere((0.62 * math.sin(a), 0.06 - 0.62 * math.cos(a), rng.uniform(1.4, 2.2)), rng.uniform(0.03, 0.06)),
              0.01)
    noise = Noise(16)
    F.displace(lambda X_, Y_, Z_: 0.01 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 1.0, octaves=3), band=0.05)
    return F


def tabard_weights(obj):
    """The skirts ride the hips at the waist and follow each thigh lower down (the
    front panels more than the back), the springs adding the swing."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'L_Thigh', 'R_Thigh', 'TabF1', 'TabF2', 'TabB1', 'TabB2']
    W = np.zeros((len(P), len(names)))
    z = P[:, 2]
    t = np.clip((2.62 - z) / (2.62 - 1.1), 0, 1)
    hip = np.clip(1 - t / 0.12, 0, 1)
    leg = (1 - hip) * 0.55 * np.clip(t, 0, 1)
    spring = (1 - hip) - leg
    front = P[:, 1] < 0.05
    left = P[:, 0] > 0
    lowr = np.clip((t - 0.45) / 0.3, 0, 1)
    W[:, 0] = hip
    W[left, 1] = leg[left]
    W[~left, 2] = leg[~left]
    W[front, 3] = (spring * (1 - lowr))[front]
    W[front, 4] = (spring * lowr)[front]
    W[~front, 5] = (spring * (1 - lowr))[~front]
    W[~front, 6] = (spring * lowr)[~front]
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


# ------------------------------------------------------------------ the cutlass (local frame: +Z up the blade)


# ------------------------------------------------------------------ the halberd (local frame: +Z up the haft)
def build_halberd(voxel):
    """A long watch halberd: an ash haft bound in iron, a broad crescent axe blade
    (+X), a back hook (-X), a long top spike, a butt spike; rusted and nicked,
    a barnacle crust on the socket."""
    F = Field((-0.5, -0.12, -HAFT_BELOW - 0.15), (0.6, 0.12, HAFT_ABOVE + 0.75), voxel)
    F.add(RoundCone((0, 0, -HAFT_BELOW), (0, 0, HAFT_ABOVE + 0.1), 0.048, 0.042), 0.01)
    for z in (-0.3, 0.3, 1.2, HAFT_ABOVE - 0.42):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.05, 0.012), 0.006)
    F.add(RoundCone((0, 0, -HAFT_BELOW - 0.14), (0, 0, -HAFT_BELOW + 0.08), 0.02, 0.058), 0.01)
    h = HAFT_ABOVE
    F.add(RoundCone((0, 0, h - 0.38), (0, 0, h + 0.18), 0.064, 0.056), 0.01)               # socket and langets
    blade = X.Inter(Ellipsoid((0.24, 0, h - 0.02), (0.36, 0.032, 0.5)),
                    X.Diff(RoundBox((0.3, 0, h - 0.02), (0.3, 0.035, 0.52), radius=0.01),
                           Ellipsoid((-0.03, 0, h - 0.02), (0.16, 0.1, 0.6))), 0.0)
    F.add(blade, 0.012)
    F.sub(Sphere((0.15, 0, h + 0.14), 0.04), 0.01)
    F.sub(Sphere((0.15, 0, h - 0.18), 0.04), 0.01)
    F.add(RoundCone((-0.05, 0, h), (-0.26, 0, h - 0.03), 0.045, 0.016), 0.015)
    F.add(RoundCone((-0.26, 0, h - 0.03), (-0.31, 0, h - 0.17), 0.016, 0.004), 0.01)
    F.add(X.Prism((0, 0, h + 0.14), (0, 0, h + 0.74), 0.05, n=4, tip=0.75, rot=math.pi / 4), 0.01)
    rng = np.random.default_rng(6)
    for k in range(6):
        z = h - 0.38 + 0.66 * rng.random()
        F.sub(Sphere((0.58 + 0.02 * rng.random(), 0, z), rng.uniform(0.012, 0.03)), 0.004)
    for k in range(5):
        a = rng.uniform(0, math.tau)
        p = np.array((0.07 * math.cos(a), 0.07 * math.sin(a), h - 0.3 + 0.25 * rng.random()))
        barnacle(F, p, p * np.array((1, 1, 0)), rng.uniform(0.022, 0.034), 0.02, rng)
    return F


def build_pennon(voxel):
    """The Bastion pennon on the haft under the head: a torn sea-green swallowtail."""
    h = HAFT_ABOVE
    F = Field((-0.06, -0.62, h - 0.85), (0.06, 0.06, h - 0.3), voxel)
    pts = [(0, -0.05 - 0.55 * t, h - 0.36 - 0.12 * t * t) for t in np.linspace(0, 1, 7)]
    for i, p in enumerate(pts[:-1]):
        u = i / (len(pts) - 1)
        F.add(RoundBox((p[0], p[1] - 0.045, p[2] - 0.17 * (1 - 0.35 * u)), (0.024, 0.05, 0.17 * (1 - 0.35 * u)),
                       radius=0.01), 0.01)
    F.sub(RoundBox((0, -0.6, h - 0.62), (0.03, 0.12, 0.04), radius=0.01), 0.02)            # the swallowtail cut
    rng = np.random.default_rng(13)
    for k in range(4):
        F.sub(Sphere((0, -rng.uniform(0.15, 0.55), h - rng.uniform(0.4, 0.7)), rng.uniform(0.02, 0.04)), 0.008)
    return F


def halberd_matrix():
    ax = np.array(WEAPON_AXIS)
    w, down, width, palm = HAND.frame(-1)
    edge = unit(np.cross(palm, ax))
    flat = unit(np.cross(ax, edge))
    M = np.eye(4)
    M[:3, 0] = -edge
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
    """Clusters of barnacles stuck to the plate, the helm and the buckler, as
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


def kelp_strand(G, pts, r, rng, fronds=3):
    G.add(Polyline([tuple(p) for p in pts], r), 0.008)
    for k in range(fronds):
        i = int(rng.integers(1, len(pts)))
        a, b = np.asarray(pts[i - 1]), np.asarray(pts[i])
        m = lerp(a, b, rng.uniform(0.2, 0.8))
        d = unit(b - a)
        F_ = frame_from(d)
        G.add(Ellipsoid(m + F_[:, 0] * r * 1.5, (r * 3.0, r * 0.7, np.linalg.norm(b - a) * 0.45), F_), 0.01)


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
    # off the brim's low sides and back: short blades hanging free, rigid on the head
    G = Field((-0.62, -0.62, 3.75), (0.62, 0.72, 4.36), voxel)
    brim = _Brim(HELM_C, BRIM_IN, BRIM_OUT, BRIM_LIFT, 0.026)
    for a, L_ in ((0.2, 0.3), (-0.3, 0.4), (math.pi - 0.15, 0.36), (math.pi + 0.45, 0.28), (1.9, 0.32),
                  (-1.3, 0.24)):
        ro = brim.outer(a) * 0.9
        zs, _ = brim.profile(a, 0.9)
        s0 = HELM_C + np.array((ro * math.cos(a), ro * math.sin(a), zs - 0.01))
        pts = hanging(s0, L_, 0.015, rng, n=5)
        nr = [np.array((math.cos(a), math.sin(a), 0.0))] * len(pts)
        ribbon(G, pts, nr, 0.026, 0.006, rng)
    out.append(('KelpHelm', G, 'rigid', 'Head', None))
    # draped over each pauldron, down the outside of the arm toward the elbow
    for s in (1, -1):
        c = _m(SHOULDER, s) + np.array((0.04 * s, 0.0, 0.05))
        fl = [pf[_side('Pauldron', s)], pf[_side('PauldronLame1', s)]]
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
        G = Field(_m((0.6, -0.5, 1.6), s) - 0.4, _m((0.6, 0.5, 2.85), s) + 0.4, voxel)
        for k, dy in enumerate((-0.28, 0.0, 0.22)):
            s0 = np.array((0.58 * s, dy, 2.62))
            kelp_strand(G, hanging(s0, 0.42 + 0.1 * k, 0.02, rng, n=5, out=(0.2 * s, 0, 0)), 0.013, rng, fronds=2)
        out.append((_side('KelpBelt', s), G, 'transfer', '', ('Hips', _side('Thigh', s))))
    # lank weed-hair from under the helm, lying over the nape and the neck
    G = Field((-0.32, -0.25, 3.62), (0.32, 0.4, 4.32), voxel)
    for x in (-0.15, -0.075, 0.0, 0.08, 0.15):
        rough = [np.array((x * 1.1, 0.2, 4.28 - 0.1 * t)) + np.array((0, 0.06 * t, -0.28 * t)) for t in np.linspace(0, 1, 6)]
        pts, nr = surface_path(Fh, [], rough, 0.02)
        ribbon(G, pts, nr, 0.032, 0.008, rng)
    out.append(('Hair', G, 'rigid', 'Head', None))
    # the beard of weed hanging off the chin
    G = Field((-0.2, -0.4, 3.45), (0.2, -0.05, 4.05), voxel)
    for x in (-0.06, -0.02, 0.025, 0.06):
        s0 = np.array((x, -0.2, 3.97))
        kelp_strand(G, hanging(s0, 0.3 + 0.08 * rng.random(), 0.014, rng, n=5, out=(0, -0.06, 0)), 0.0075, rng,
                    fronds=1)
    out.append(('Beard', G, 'rigid', 'Jaw', None))
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
    Fr = build_hand(-1, vhand, forearm=False, cuff=True)
    Fl = build_hand(1, vhand, forearm=False, cuff=True)
    face = [((0, -0.2, 4.12), 0.12, 1.0)]
    S = [Sculpt('Body', Fb, 'mail', 4200, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 4000, spots=face, tau=0.02),
         Sculpt('R_Glove', Fr, 'leather', 1300, tau=0.012),
         Sculpt('L_Glove', Fl, 'leather', 1300, tau=0.012)]
    tu, tl = build_teeth(vh * 0.7)
    S.append(Sculpt('TeethUp', tu, 'tooth', 300, binding='rigid', bone='Head'))
    S.append(Sculpt('TeethLow', tl, 'tooth', 240, binding='rigid', bone='Jaw'))
    targets = {'Cuirass': 3000, 'Gorget': 500, 'Pauldron': 1100, 'PauldronLame1': 450, 'Couter': 380,
               'Vambrace': 450, 'Poleyn': 400}
    plate_fields = {}
    for name, G, binding, bone, allow in plates(Fb, Fh, None, vp):
        key = name[2:] if name[:2] in ('L_', 'R_') else name
        plate_fields[name] = G
        S.append(Sculpt(name, G, 'brig' if name == 'Cuirass' else 'plate', targets[key], binding=binding, bone=bone,
                        allow=allow, relax=8))
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Fb, vp, s), 'breech', 900, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
        S.append(Sculpt(_side('Boot', s), build_boot(Fb, vp, s), 'leather', 1300, binding='transfer',
                        allow=(_side('Shin', s), _side('Foot', s), _side('Toes', s)), relax=6))
    Gh = build_helm(Fh, vh * 1.25)
    S.append(Sculpt('Helm', Gh, 'plate', 2200, binding='rigid', bone='Head'))
    Gc = build_tabard(vp)
    plate_fields['Coat'] = Gc
    S.append(Sculpt('Coat', Gc, 'coat', 2600, binding='own', weigh=tabard_weights))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'leather', 700, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, binding, bone, allow in build_kelp(0.006 * k, Fb, Fh, plate_fields):
        S.append(Sculpt(name, G, 'kelp', 500 if name.startswith('Kelp') else 420, binding=binding, bone=bone,
                        allow=allow, relax=4))
    c_l = _m(SHOULDER, 1) + np.array((0.04, 0.0, 0.05))
    c_r = _m(SHOULDER, -1) + np.array((-0.04, 0.0, 0.05))
    spots = [
        ('BarnPauldronL', c_l + np.array((0.2, 0.1, 0.18)), 0.2, 9, 0.07, 'L_UpperArm', [plate_fields['L_Pauldron']]),
        ('BarnPauldronR', c_r + np.array((-0.14, 0.18, 0.16)), 0.15, 6, 0.06, 'R_UpperArm',
         [plate_fields['R_Pauldron']]),
        ('BarnBack', (-0.12, 0.48, 3.0), 0.22, 9, 0.07, 'Spine2', [plate_fields['Cuirass']]),
        ('BarnHelm', (-0.2, 0.15, 4.5), 0.14, 8, 0.055, 'Head', [Gh]),
        ('BarnBrim', (0.38, 0.25, 4.22), 0.12, 5, 0.05, 'Head', [Gh]),
    ]
    for name, G, bone in build_barnacles(spots, 0.004 * k):
        S.append(Sculpt(name, G, 'barnacle', 900 if name in ('BarnPauldronL', 'BarnBack') else 600, binding='rigid',
                        bone=bone))
    return S


def _brim_point(a, t=1.0):
    brim = _Brim(HELM_C, BRIM_IN, BRIM_OUT, BRIM_LIFT, 0.024)
    ro = brim.outer(a) * t + brim._ell(a, BRIM_IN) * (1 - t)
    zs, _ = brim.profile(a, t)
    return head_map(HELM_C + np.array((ro * math.cos(a), ro * math.sin(a), zs)))


# The effect anchors the game reads (kit/anchors.py prints them in the game's terms).
ANCHORS = {
    'brimL': ('Head', _brim_point(0.0)),
    'brimR': ('Head', _brim_point(math.pi)),
    'brimF': ('Head', _brim_point(-math.pi / 2)),
    'brimB': ('Head', _brim_point(math.pi / 2)),
    'halberd': ('Weapon', GRIP_R + np.array(WEAPON_AXIS) * (HAFT_ABOVE + 0.1)),
    'lantern': ('Hips', np.array((0.56, -0.12, 2.2))),
    'chest': ('Spine2', np.array((0.0, -0.5, 3.05))),
    'eyes': ('Head', head_map(np.array((0.0, -0.2, 4.205)))),
}
