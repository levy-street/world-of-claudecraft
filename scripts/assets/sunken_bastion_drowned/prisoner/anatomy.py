"""Shackled Prisoner: skeleton and sculpts (rest pose), in yards.

One of the gaol's prisoners, left chained in the cells when the sea came in and
drowned there: a starved body gone grey in the water, every rib and the knobs of
the spine standing out, the belly fallen in, a long matted mane of weed-hair over
a grinning drowned face with sea light in the sockets. Rag breeches held up with a
rope, bare feet; iron manacles on both wrists and an iron collar, their chains
snapped off short, and a shackle on the left ankle dragging its broken chain.

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

NAME = 'ShackledPrisoner'
PREFIX = 'prisoner'
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

# ------------------------------------------------------------------ the staff
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.2 + _p * 0.07               # the centre of the right fist on the staff
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))         # the staff runs through the fist
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.2 + _pl * 0.07)
STAFF_BELOW, STAFF_ABOVE = 2.15, 2.0              # foot and crown distances from the right fist
LURE = np.array((0.42, 0.0, STAFF_ABOVE - 0.42))  # the lure's bulb in the staff frame (hung off the hook)


def staff_matrix():
    """Local staff frame (+Z up the staff, the hook curling toward +X) into the
    armature: the grip in the right fist, the staff along WEAPON_AXIS, the hook
    turned forward of the knuckles."""
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


def staff_point(p):
    return (staff_matrix() @ np.array((p[0], p[1], p[2], 1.0)))[:3]


# The head, the hood and everything on them are sculpted at the kit soldier's size
# and then grown about the base of the neck (post_mesh).
HEAD_SCALE = 1.13
HEAD_PIVOT = np.array((0.0, 0.02, 3.6))
HEAD_DROP = 0.07
HEAD_PARTS = ('Head', 'TeethUp', 'TeethLow', 'Eyes', 'Hair')


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
        # the skirts to the floor, front and back panels
        ('TabF1', 'Hips', (0, -0.5, 2.6), (0, -0.66, 1.5)),
        ('TabF2', 'TabF1', (0, -0.66, 1.5), (0, -0.78, 0.4)),
        ('TabB1', 'Hips', (0, 0.55, 2.6), (0, 0.7, 1.5)),
        ('TabB2', 'TabB1', (0, 0.7, 1.5), (0, 0.82, 0.4)),
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
WEAPON_PROBES = (-STAFF_BELOW + 0.1, -1.0, 0.8, STAFF_ABOVE)
COLLIDE_LEGS = {'L_Thigh': 0.32, 'R_Thigh': 0.32, 'L_Shin': 0.22, 'R_Shin': 0.22}


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
    F.add(Ellipsoid((0, 0.04, 2.44), (0.36, 0.27, 0.28), bone='Hips'), 0.14)
    F.add(Ellipsoid((0, 0.04, 2.8), (0.3, 0.24, 0.31), bone='Spine1'), 0.14)
    F.add(Ellipsoid((0, 0.04, 3.2), (0.42, 0.3, 0.38), rot_matrix(rx=-0.06), bone='Spine2'), 0.16)
    F.add(Ellipsoid((0, 0.12, 3.38), (0.46, 0.26, 0.28), bone='Spine2'), 0.14)
    F.sub(Ellipsoid((0, -0.3, 2.66), (0.22, 0.12, 0.16)), 0.12)                    # the belly fallen in
    for k in range(5):                                                                # the ribs
        z = 3.3 - 0.11 * k
        for s in (1, -1):
            rib = [_m((0.06, -0.245 + 0.01 * k, z), s), _m((0.22, -0.225 + 0.016 * k, z - 0.04), s),
                   _m((0.34, -0.12 + 0.012 * k, z - 0.09), s), _m((0.38, 0.02, z - 0.12), s)]
            F.ridge(Polyline(rib, 0.006), 0.028, k=0.016)
    for k in range(8):                                                                # the spine's knobs
        F.add(Sphere((0.0, 0.31 + 0.01 * math.sin(k), 2.62 + 0.12 * k), 0.035, bone='Spine1' if k < 4 else 'Spine2'),
              0.03)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.17, -0.16, 3.22), s), (0.13, 0.1, 0.14), rot_matrix(ry=0.2 * s), bone='Spine2'), 0.1)
        F.add(RoundCone(_m((0.1, 0.12, 3.54), s), _m((0.5, 0.08, 3.58), s), 0.11, 0.1, bone='Spine2'), 0.1)
        F.add(Ellipsoid(_m((0.3, 0.08, 3.06), s), (0.14, 0.18, 0.3), bone='Spine2'), 0.1)
        F.add(Sphere(_m((0.2, 0.0, 3.5), s), 0.06, bone='Spine2'), 0.05)          # the collarbone's knob
        F.add(Ellipsoid(_m((0.19, 0.2, 2.36), s), (0.23, 0.2, 0.24), bone='Hips'), 0.12)
    F.add(RoundCone((0, 0.05, 3.5), (0, 0.0, 3.98), 0.12, 0.1, bone='Neck'), 0.08)

    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.03 * s, 0, 0.0)), 0.14, bone=up), 0.08)
        F.add(RoundCone(sh, el, 0.115, 0.085, bone=up), 0.06)
        F.add(Ellipsoid(lerp(sh, el, 0.45) + np.array((0, -0.03, 0)), (0.075, 0.075, 0.2), _rot(sh, el), bone=up),
              0.04)
        F.add(Sphere(el + np.array((0, 0.05, 0)), 0.085, bone=_side('ElbowFix', s)), 0.05)   # the bony elbow
        # long thin forearms, the bones standing out under the skin
        F.add(RoundCone(el, lerp(el, wr, 0.35), 0.08, 0.085, bone=fo), 0.05)
        F.add(RoundCone(lerp(el, wr, 0.35), wr, 0.085, 0.065, bone=fo), 0.05)
        ax_ = unit(wr - el)
        out_ = unit(np.cross(ax_, (0, -1.0, 0)) * -s)
        F.ridge(Polyline([lerp(el, wr, 0.15) + out_ * 0.07, lerp(el, wr, 0.9) + out_ * 0.055], 0.003), 0.012, k=0.012)

    for s in (1, -1):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sh = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + np.array((0, 0, 0.06)), kn, 0.22, 0.13, bone=th), 0.12)
        F.add(Sphere(kn + np.array((0, -0.02, 0.0)), 0.1, bone=_side('KneeFix', s)), 0.06)
        F.add(RoundCone(kn, an, 0.1, 0.065, bone=sh), 0.06)
        # the calf: a strong bulge high at the back, the shin flat in front
        F.add(Ellipsoid(lerp(kn, an, 0.3) + np.array((0.01 * s, 0.05, 0)), (0.09, 0.09, 0.22), _rot(kn, an),
                        bone=sh), 0.06)
        foot = _side('Foot', s)
        F.add(Ellipsoid(an + np.array((0, 0.04, -0.08)), (0.075, 0.12, 0.09), bone=foot), 0.05)   # the heel
        F.add(RoundBox(_m((0.32, -0.15, 0.09), s), (0.075, 0.2, 0.045), radius=0.035, bone=foot), 0.05)
        for k_, dx in enumerate((-0.05, -0.015, 0.02, 0.055)):                                        # long toes
            t0 = _m((0.33 + dx, -0.36, 0.07), s)
            F.add(RoundCone(t0, t0 + np.array((0.012 * dx * 10 * s, -0.17 + 0.025 * k_, -0.035)), 0.026, 0.016,
                            bone=_side('Toes', s)), 0.012)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.12)
    return F


# ------------------------------------------------------------------ the head: bloated, drowned
MOUTH = np.array((0.0, -0.205, 4.065))


def build_head(voxel):
    """A starved drowned face: the skull close under the skin, the cheeks fallen
    in, deep sockets, the nose eaten to the cartilage, the lips shrunk back off a
    grin of long teeth, the jaw hanging a little; stringy neck cords."""
    F = Field((-0.42, -0.48, 3.55), (0.42, 0.44, 4.78), voxel)
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
    F.add(RoundBox(w + down * 0.13, (0.07, 0.026, 0.08), Rm, radius=0.03, bone=hand), 0.03)
    F.add(Ellipsoid(w + down * 0.08 + width * 0.05 + palm * 0.035, (0.055, 0.045, 0.072), Rm, bone=hand), 0.03)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = (HAND.fingers[f][4] if f != 'Thumb' else 0.04) * 0.78
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        if f != 'Thumb':
            F.add(Sphere(base - palm * 0.015, r0 + 0.008, bone=hand), 0.015)
        F.add(RoundCone(base, mid, r0, r0 * 0.9, bone=b1), 0.014)
        F.add(Sphere(mid, r0 * 0.94, bone=b2), 0.01)
        F.add(RoundCone(mid, tip, r0 * 0.9, r0 * 0.7, bone=b2), 0.01)
        # the long hooked nail
        d = unit(tip - mid)
        F.add(RoundCone(tip - d * 0.01, tip + d * 0.055 + palm * 0.02, r0 * 0.62, r0 * 0.12, bone=b2), 0.006)
        F.add(Sphere(mid, r0 * 1.02, bone=b2), 0.008)                     # the swollen knuckle
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
    def quilt(G):
        ring = [(0.47 * math.sin(a), 0.03 - 0.44 * math.cos(a), 2.53) for a in np.linspace(-math.pi, math.pi, 41)]
        G.add(Polyline(ring, 0.022), 0.012)
        for z in np.arange(2.66, 3.4, 0.12):                           # the quilting seams
            ring = [(0.47 * math.sin(a), 0.03 - 0.44 * math.cos(a), z) for a in np.linspace(-2.7, 2.7, 31)]
            G.groove(Polyline(ring, 0.003), 0.012, k=0.012)
    plate('Cuirass', Fb, (-0.75, -0.62, 2.4), (0.75, 0.62, 3.7), 0.03, 0.075, brig_mask,
          allow=('Spine1', 'Spine2', 'Hips'), extra=quilt)

    def gorget_mask(X_, Y_, Z_):
        r = np.sqrt(X_ ** 2 + (Y_ - 0.03) ** 2)
        return rg(Z_, 3.44, 3.48) * (1 - rg(Z_, 3.82, 3.87)) * rg(r, 0.4, 0.3)
    plate('Gorget', BU, (-0.45, -0.45, 3.4), (0.45, 0.45, 3.92), 0.035, 0.04, gorget_mask, allow=('Neck', 'Spine2'))

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
        hem = 1.0 + 0.12 * np.sin(X_ * 40 + Y_ * 30)
        return rg(Z_, hem, hem + 0.05) * (1 - rg(Z_, 2.6, 2.66)) * rg(d, 0.42, 0.34) * rg(X_ * s, -0.09, -0.04)

    noise = Noise(40 + s)

    def folds(X_, Y_, Z_):
        return 0.01 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 9, octaves=2)
    lo = np.minimum(hp, kn) - 0.5
    hi = np.maximum(hp, kn) + 0.5
    lo[2], hi[2] = 0.8, 2.75
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
    """Unused here (the Prisoner wears no helm); kept so the shared kelp code imports."""

    def __init__(self, *a, **k):
        raise RuntimeError('no brim on the Prisoner')


HELM_C = np.array((0.0, -0.01, 4.3))


def build_helm(Fh, Fb, voxel):
    """The deep hood and the mantle: a heavy sodden layer over the head and the
    shoulders, open at the face, its peak drawn forward over the brow, the mantle's
    hem ragged over the upper arms and the back."""
    rg = X.ramp
    base = _Union(Fb, Fh)
    noise = Noise(51)

    def mask(X_, Y_, Z_):
        hem = 2.9 + 0.16 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 2, octaves=2) - 0.3 * rg(Y_, -0.1, 0.45)
        m = rg(Z_, hem, hem + 0.05)
        face = rg(-Y_, 0.02, 0.12) * rg(Z_, 3.5, 3.6) * (1 - rg(Z_, 4.33, 4.38)) * rg(np.abs(X_), 0.19, 0.14)
        arms = 1.0
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            arms = arms * (1 - (1 - rg(d, 0.2, 0.26)) * rg(u, 0.35, 0.45))
        return m * (1 - face) * arms

    def off(X_, Y_, Z_):
        folds = 0.028 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 2.2, octaves=3)
        drape = 0.012 * np.sin(np.arctan2(Y_, X_) * 9 + Z_ * 2) * rg(Z_, 4.3, 3.9)
        return 0.025 + 0.05 * rg(Z_, 4.0, 4.4) + 0.04 * rg(Z_, 3.6, 3.3) + folds + drape

    def peak(G):
        G.add(RoundCone((0, -0.18, 4.47), (0, -0.33, 4.36), 0.11, 0.05), 0.08)
        # the hood's short sodden point, slumped over the back of the crown
        G.add(RoundCone((0, 0.2, 4.38), (0.0, 0.34, 4.12), 0.1, 0.05), 0.08)
        G.sub(Ellipsoid((0, -0.36, 4.12), (0.15, 0.12, 0.2)), 0.04)
    G = X.layer_field(base, (-1.0, -0.62, 2.85), (1.0, 0.65, 4.98), voxel, off, 0.045, mask, extra=peak)
    return G


def hood_weights(obj):
    """The hood rides the head, the mantle the neck, the shoulders and the upper arms."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Head', 'Neck', 'Spine2', 'L_Clavicle', 'R_Clavicle', 'L_UpperArm', 'R_UpperArm']
    W = np.zeros((len(P), len(names)))
    x, z = P[:, 0], P[:, 2]
    head = np.clip((z - 3.82) / 0.14, 0, 1)
    neck = np.clip((z - 3.5) / 0.2, 0, 1) * (1 - head)
    low = 1 - head - neck
    ax = np.abs(x)
    arm = np.clip((ax - 0.5) / 0.2, 0, 1) * np.clip((3.55 - z) / 0.3, 0, 1)
    clav = np.clip((ax - 0.15) / 0.25, 0, 1) * (1 - arm)
    spine = 1 - clav - arm
    left = x > 0
    W[:, 0] = head
    W[:, 1] = neck
    W[:, 2] = low * spine
    W[left, 3] = (low * clav)[left]
    W[~left, 4] = (low * clav)[~left]
    W[left, 5] = (low * arm)[left]
    W[~left, 6] = (low * arm)[~left]
    W = R.relax(W, E, iters=4)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def build_hair(Fh, Fb, voxel):
    """A long matted mane of weed-hair from the scalp: lank strands round the face,
    over the shoulders and down the back, rigid on the head (it is grown with it)."""
    G = Field((-0.55, -0.45, 3.35), (0.55, 0.65, 4.55), voxel)
    rng = np.random.default_rng(23)
    for i in range(16):
        # round the sides and the back of the head, the face left bare
        a = (1.0 + 2.1 * (i / 7)) if i < 8 else -(1.0 + 2.1 * ((i - 8) / 7))
        top = np.array((0.17 * math.sin(a), 0.02 - 0.17 * math.cos(a) * 0.9, 4.38 - 0.06 * abs(math.cos(a))))
        out = np.array((math.sin(a), -math.cos(a) * 0.6, 0.0))
        L_ = 0.55 + 0.35 * rng.random() + 0.25 * (abs(a) > 1.6)
        pts = [top + out * (0.06 * t) + np.array((0.02 * math.sin(t * 7 + i), 0.0, -L_ * t))
               for t in np.linspace(0, 1, 8)]
        ribbon(G, pts, [np.array((out[0], out[1], 0.25))] * 8, 0.05 + 0.015 * rng.random(), 0.01, rng, rag=0.55)
    G.add(Ellipsoid((0.0, 0.06, 4.36), (0.17, 0.18, 0.1)), 0.05)                     # the matted crown
    return G


def _links(G, start, step, n, r=0.04, th=0.011):
    """A short chain of n oval links from `start`, each `step` further on, every
    other link turned a quarter round."""
    d = unit(np.asarray(step, float))
    side = unit(np.cross(d, (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)))
    for i in range(n):
        c = np.asarray(start, float) + np.asarray(step, float) * i
        axis = side if i % 2 == 0 else unit(np.cross(d, side))
        G.add(sdf.Torus(tuple(c), tuple(axis), r, th), 0.004)


def build_irons(voxel):
    """The manacles (on each forearm by the wrist), the collar and the left ankle's
    shackle, as (name, field, bone): iron bands with their snapped chains."""
    out = []
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)
        ax = unit(wr - el)
        c = wr - ax * 0.06
        G = Field(c - 0.45, c + 0.45, voxel)
        G.add(sdf.Torus(tuple(c), tuple(ax), 0.105, 0.03), 0.01)
        G.add(sdf.Torus(tuple(c - ax * 0.05), tuple(ax), 0.102, 0.02), 0.01)
        hang = c + np.array((0.0, 0.02, -0.11))
        _links(G, hang, (0.02 * s, 0.0, -0.075), 4)
        out.append((_side('Manacle', s), G, _side('Forearm', s)))
    G = Field((-0.4, -0.45, 3.0), (0.4, 0.35, 3.75), voxel)
    ring = [(0.2 * math.cos(a), 0.04 + 0.21 * math.sin(a), 3.6) for a in np.linspace(-math.pi, math.pi, 33)]
    G.add(Polyline(ring, 0.035), 0.02)
    G.add(RoundBox((0.0, -0.18, 3.6), (0.05, 0.03, 0.05), radius=0.01), 0.01)
    _links(G, (0.0, -0.21, 3.52), (0.01, -0.01, -0.075), 5)
    out.append(('Collar', G, 'Spine2'))
    an = ANKLE + np.array((0.0, 0.0, 0.08))
    G = Field(an - np.array((0.4, 0.5, 0.4)), an + np.array((0.4, 0.8, 0.4)), voxel)
    G.add(sdf.Torus(tuple(an), (0.0, 0.0, 1.0), 0.13, 0.03), 0.01)
    _links(G, an + np.array((0.0, 0.13, -0.02)), (0.0, 0.075, -0.012), 6)
    out.append(('Shackle', G, 'L_Shin'))
    return out


def hair_weights(obj):
    """The hair rides the head down to the chin, then the neck and the breast."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Head', 'Neck', 'Spine2']
    W = np.zeros((len(P), len(names)))
    z = P[:, 2]
    head = np.clip((z - 3.85) / 0.15, 0, 1)
    neck = np.clip((z - 3.55) / 0.2, 0, 1) * (1 - head)
    W[:, 0] = head
    W[:, 1] = neck
    W[:, 2] = 1 - head - neck
    W = R.relax(W, E, iters=4)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def build_bodice(Fb, voxel):
    """The bodice: rotten rags bound over the bony breast and the belly, the edges
    torn, a necklace of shells and teeth round the neck."""
    rg = X.ramp
    noise = Noise(71)

    def mask(X_, Y_, Z_):
        hem = 3.42 + 0.05 * noise.fbm(X_ * 6, Y_ * 6, 0, octaves=2)
        m = rg(Z_, 2.42, 2.48) * (1 - rg(Z_, hem, hem + 0.05))
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            m = m * rg(d, 0.17, 0.22)
        return m

    def wraps(G):
        for z in np.arange(2.6, 3.3, 0.16):                       # the binding straps
            ring = [(0.36 * math.sin(a), 0.05 - 0.29 * math.cos(a), z + 0.04 * math.sin(a * 2))
                    for a in np.linspace(-math.pi, math.pi, 31)]
            G.add(Polyline(ring, 0.014), 0.012)
    return X.layer_field(Fb, (-0.6, -0.5, 2.3), (0.6, 0.5, 3.6), voxel, 0.02, 0.04, mask, extra=wraps,
                         noise=lambda X_, Y_, Z_: 0.008 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=2))


def build_necklace(voxel):
    """A cord round the neck strung with cockle shells, a whelk and fish teeth."""
    G = Field((-0.4, -0.45, 3.15), (0.4, 0.3, 3.7), voxel)
    pts = [(0.17 * math.sin(a), 0.06 - 0.25 * math.cos(a), 3.5 - 0.17 * math.cos(a) ** 2) for a in np.linspace(-1.6, 1.6, 17)]
    G.add(Polyline(pts, 0.008), 0.004)
    rng = np.random.default_rng(5)
    for i in range(3, 14, 2):
        p = np.array(pts[i]) + np.array((0, -0.015, -0.035))
        if i == 9:
            G.add(RoundCone(p, p + np.array((0.0, -0.02, -0.11)), 0.035, 0.008), 0.01)         # the whelk
        elif i % 4 == 1:
            G.add(RoundCone(p, p + np.array((0.0, -0.01, -0.06)), 0.012, 0.002), 0.004)        # a fish tooth
        else:
            G.add(Ellipsoid(p, (0.03, 0.012, 0.028), rot_matrix(rz=rng.uniform(-0.4, 0.4))), 0.006)  # a cockle
    return G


# ------------------------------------------------------------------ the tabard
def build_tabard(voxel):
    """Her skirts: a long flared shell of sodden rags from the waist to her ankles,
    split up the front to the knee so the bare shins show as she hobbles, the hem
    torn into long tongues; heavy with water."""
    F = Field((-1.0, -1.0, 0.1), (1.0, 1.0, 2.75), voxel)
    rng = np.random.default_rng(6)
    cone = X.Shell(RoundCone((0, 0.06, 2.7), (0, 0.12, 0.3), 0.4, 0.62), 0.045)
    band = RoundBox((0, 0.04, 1.5), (1.1, 1.1, 1.2), radius=0.0)
    F.add(X.Inter(cone, band, 0.0, bone='Hips'), 0.0, weight=False)
    F.sub(RoundBox((0, -0.6, 0.55), (0.07, 0.3, 0.6), radius=0.01), 0.03)           # the front split
    for k in range(30):                                                             # the ragged hem
        a = math.tau * k / 30 + rng.uniform(-0.08, 0.08)
        r = 0.62
        F.sub(Ellipsoid((r * math.sin(a), 0.12 - r * math.cos(a), 0.3 + rng.uniform(-0.05, 0.3)),
                        (rng.uniform(0.04, 0.08), rng.uniform(0.04, 0.08), rng.uniform(0.1, 0.3))), 0.01)
    for k in range(3):                                                              # holes rotted through
        a = rng.uniform(0, math.tau)
        F.sub(Sphere((0.55 * math.sin(a), 0.1 - 0.55 * math.cos(a), rng.uniform(0.7, 2.0)), rng.uniform(0.03, 0.07)),
              0.01)
    noise = Noise(16)
    # long vertical folds hanging from the girdle, the hem dragged and clinging
    F.displace(lambda X_, Y_, Z_: 0.014 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 0.5, octaves=3)
               + 0.008 * np.sin(np.arctan2(Y_, X_) * 11), band=0.05)
    return F


def tabard_weights(obj):
    """The skirts ride the hips at the waist and follow each thigh lower down (the
    front panels more than the back), the springs adding the swing."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'L_Thigh', 'R_Thigh', 'TabF1', 'TabF2', 'TabB1', 'TabB2']
    W = np.zeros((len(P), len(names)))
    z = P[:, 2]
    t = np.clip((2.62 - z) / (2.62 - 0.5), 0, 1)
    hip = np.clip(1 - t / 0.1, 0, 1)
    front = P[:, 1] < 0.05
    # the front of the long skirts follows her thighs closely (she walks bent, the
    # thighs swinging forward under it), the back hangs freer
    leg = (1 - hip) * np.where(front, 0.85, 0.5) * np.clip(t * 1.4, 0, 1)
    spring = (1 - hip) - leg
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

    def knot(G):
        # a rope girdle knotted at the left hip, its ends hanging, a pouch and a
        # little bottle of brine at the right
        k = np.array((0.3, -0.3, 2.6))
        G.add(Sphere(k, 0.045), 0.02)
        for dx, L_ in ((0.0, 0.5), (0.06, 0.38)):
            G.add(Polyline([k, k + np.array((dx, -0.03, -L_ * 0.5)), k + np.array((dx + 0.03, -0.02, -L_))], 0.018), 0.01)
        G.add(RoundBox((-0.38, -0.22, 2.47), (0.06, 0.09, 0.1), rot_matrix(rz=0.5), radius=0.04), 0.02)
        G.add(RoundCone((-0.24, -0.33, 2.38), (-0.24, -0.34, 2.54), 0.045, 0.02), 0.015)
    return X.layer_field(Fb, (-0.62, -0.62, 2.2), (0.62, 0.62, 2.8), voxel, 0.06, 0.03, bmask, extra=knot)


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
    # off the mantle's hem at the back and the sides
    G = Field((-1.0, -0.4, 2.1), (1.0, 0.75, 3.2), voxel)
    for x, y in ((0.5, 0.12), (-0.46, 0.2), (0.2, 0.42), (-0.15, 0.44)):
        s0 = np.array((x, y, 2.95))
        kelp_strand(G, hanging(s0, 0.4 + 0.15 * rng.random(), 0.02, rng, n=5, out=(0.1 * np.sign(x), 0.1, 0)), 0.011,
                    rng, fronds=2)
    out.append(('KelpHood', G, 'transfer', '', ('Spine2', 'L_Clavicle', 'R_Clavicle')))
    # over the belt and down the tassets
    for s in (1, -1):
        G = Field(_m((0.6, -0.5, 1.6), s) - 0.4, _m((0.6, 0.5, 2.85), s) + 0.4, voxel)
        for k, dy in enumerate((-0.28, 0.0, 0.22)):
            s0 = np.array((0.58 * s, dy, 2.62))
            kelp_strand(G, hanging(s0, 0.42 + 0.1 * k, 0.02, rng, n=5, out=(0.2 * s, 0, 0)), 0.013, rng, fronds=2)
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
    S = [Sculpt('Body', Fb, 'flesh', 4600, spots=[((0, -0.1, 3.9), 0.2, 0.5)], tau=0.05),
         Sculpt('Head', Fh, 'flesh', 3800, spots=face, tau=0.02),
         Sculpt('R_Hand', Fr, 'flesh', 1300, tau=0.012),
         Sculpt('L_Hand', Fl, 'flesh', 1300, tau=0.012)]
    tu, tl = build_teeth(vh * 0.7)
    S.append(Sculpt('TeethUp', tu, 'tooth', 300, binding='rigid', bone='Head'))
    S.append(Sculpt('TeethLow', tl, 'tooth', 240, binding='rigid', bone='Jaw'))
    S.append(Sculpt('Hair', build_hair(Fh, Fb, vh * 1.2), 'kelp', 2400, binding='rigid', bone='Head'))
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Fb, vp, s), 'rag', 1100, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
    S.append(Sculpt('Belt', build_belt(Fb, vp), 'rope', 700, binding='transfer', allow=('Hips', 'Spine1'),
                    relax=6))
    for name, G, bone in build_irons(0.0045 * k):
        S.append(Sculpt(name, G, 'steel', 900, binding='rigid', bone=bone))
    plate_fields = {}
    for name, G, binding, bone, allow in build_kelp(0.006 * k, Fb, Fh, plate_fields):
        if name == 'KelpHood':
            continue
        S.append(Sculpt(name, G, 'kelp', 500, binding=binding, bone=bone, allow=allow, relax=4))
    spots = [
        ('BarnShoulderR', (-0.42, 0.12, 3.5), 0.16, 6, 0.05, 'R_Clavicle', [Fb]),
        ('BarnBack', (0.15, 0.36, 3.0), 0.2, 8, 0.055, 'Spine2', [Fb]),
    ]
    for name, G, bone in build_barnacles(spots, 0.004 * k):
        S.append(Sculpt(name, G, 'barnacle', 700, binding='rigid', bone=bone))
    return S


ANCHORS = {
    'cuffL': ('L_Hand', np.array(WRIST) + np.array((0.0, 0.0, -0.05))),
    'cuffR': ('R_Hand', mirror(WRIST) + np.array((0.0, 0.0, -0.05))),
    'brow': ('Head', head_map(np.array((0.0, -0.26, 4.3)))),
    'hair': ('Head', head_map(np.array((0.2, 0.05, 3.85)))),
    'collar': ('Spine2', np.array((0.0, -0.22, 3.5))),
    'chest': ('Spine2', np.array((0.0, -0.4, 3.05))),
    'eyes': ('Head', head_map(np.array((0.0, -0.2, 4.205)))),
}
