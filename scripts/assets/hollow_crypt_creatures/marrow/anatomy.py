"""Sexton Marrow: skeleton and sculpts (rest pose), in yards.

The parish sexton of the Hollow Crypt, raised and still digging: a gaunt, stooped
skeleton twice a man's height. A big grim skull (a heavy frowning brow over deep
sockets with a faint soul-green light far inside, hollow cheeks, a long heavy
jaw, a few lank wisps of hair) in the deep hood of a ragged capelet of soot-black
grave cloth; the bare ribcage and the lumbar column under it, long bony arms and
hands; ragged knee breeches, a gravedigger's leather apron to the shins, worn
boots caked with earth, a rope belt with a ring of iron keys and a hooded tin
lantern on an S-hook at the hip, its tallow light the one warm colour on him; a
long spade (an ash haft with a T-grip, an iron blade crusted with grave dirt).

Axes: yards, +Z up, faces -Y (glTF +Z), his left is +X. Rest is an A-pose,
upright; the stoop is posed (`lean`, `neck`), so every bone is rigid in it.
The pose language, the rig, the clip writer, the bake and the review renders are
the Sunken Bastion's sculpt kit (scripts/assets/sunken_bastion_drowned/kit),
unchanged: this module only names the bones and sculpts the parts.
"""
import math

import numpy as np

import biped as B
import sdf_ext as X
from biped import lerp, mirror, unit

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, Torus, frame_from, rot_matrix

NAME = 'SextonMarrow'
PREFIX = 'marrow'
VARIANT = [None]


def set_variant(v):
    VARIANT[0] = v


# ------------------------------------------------------------------ landmarks (left side)
SHOULDER = np.array((0.72, 0.06, 4.62))
ELBOW = np.array((1.16, 0.18, 3.72))
WRIST = np.array((1.56, 0.04, 2.88))
HAND_TIP = np.array((1.8, -0.06, 2.28))
HIP = np.array((0.3, 0.06, 3.0))
KNEE = np.array((0.34, -0.06, 1.7))
ANKLE = np.array((0.37, 0.1, 0.34))
BALL = np.array((0.39, -0.4, 0.1))
TOE = np.array((0.39, -0.74, 0.08))
HEAD_C = np.array((0.0, -0.08, 5.42))
EYE = np.array((0.088, -0.262, 5.37))
EYE_R = 0.032

HAND = B.Hand(WRIST, HAND_TIP, 0.34, {
    'Index': (0.105, 0.08, 0.0, 0.17, 0.038),
    'Middle': (0.035, 0.0, 0.014, 0.185, 0.04),
    'Ring': (-0.04, -0.06, -0.008, 0.17, 0.037),
    'Little': (-0.105, -0.14, -0.043, 0.13, 0.032),
}, thumb=((0.1, 0.1, 0.075), (0.55, 0.62, 0.55), 0.13, 0.115))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.1, -0.02, 4.55)))

# ------------------------------------------------------------------ the spade (weapon frame: +Z down the haft to the blade)
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.28 + _p * 0.085             # the centre of the right fist's grip on the haft
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.28 + _pl * 0.085)
HAFT_TOP = 1.3            # the T-grip's distance behind the right fist (the left hand works near it)
SOCKET = 1.45             # where the iron straps meet the blade, ahead of the right fist
BLADE_LEN = 1.02          # the blade from the socket to its tip
BLADE_HALF = 0.36         # the blade's half width at its tread
HAFT_R = 0.062            # the ash haft's radius
# The blade's turn about the haft in the fist, tuned on probes of the posed spade:
# the dish faces forward while it bites the earth, up while it carries, up and back
# at the fling, and the flat comes down on the smash.
BLADE_ROLL = -70.0
DIRT_AT = SOCKET + 0.42   # the heap of dirt on the blade (weapon frame, along the haft)

# The spade planted in the yard while he rings the bell (SpadeStuck, under Root): the
# blade's tip a third of its length under the flags at his right, the haft leaning out.
STUCK_TIP = np.array((-1.3, -0.62, -0.3))
STUCK_DIR = unit((-0.16, -0.08, 1.0))             # from the tip up the haft toward the T-grip

# The hooded lantern on its S-hook at the left hip (the Lantern bone hangs from the hook).
LANTERN_HOOK = np.array((0.84, -0.1, 3.1))
LANTERN_C = np.array((0.84, -0.1, 2.52))


# The skull, its hood and everything on them are sculpted at a man's proportion and
# then grown about the top of the neck (post_mesh): a heavier, more readable head
# under the game's camera, the way the game's figures carry theirs.
HEAD_SCALE = 1.16
HEAD_PIVOT = np.array((0.0, -0.02, 5.0))
HEAD_PARTS = ('Skull', 'TeethUp', 'TeethLow', 'Hair', 'EyeGlow', 'Cowl')


def head_map(P):
    """Rest-space points (n, 3) to their grown places: full scale above 5.14, none
    below 4.98 (the capelet and the neck's foot stay where they are)."""
    P = np.asarray(P, float)
    t = np.clip((P[..., 2] - 4.98) / (5.14 - 4.98), 0, 1)
    t = t * t * (3 - 2 * t)
    k = 1.0 + (HEAD_SCALE - 1.0) * t
    return HEAD_PIVOT + (P - HEAD_PIVOT) * k[..., None]


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


STUCK_PIVOT = np.array((-0.3, 0.1, 2.9))     # where the hidden planted spade shrinks to


def _bones():
    stuck_head = STUCK_PIVOT
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.06, 3.0), (0, 0.1, 3.45)),
        ('Spine1', 'Hips', (0, 0.1, 3.45), (0, 0.12, 3.95)),
        ('Spine2', 'Spine1', (0, 0.12, 3.95), (0, 0.08, 4.6)),
        ('Neck', 'Spine2', (0, 0.06, 4.66), (0, -0.04, 5.06)),
        ('Head', 'Neck', (0, -0.04, 5.06), (0, -0.1, 5.8)),
        ('Jaw', 'Head', (0, -0.08, 5.24), (0, -0.33, 5.04)),
        ('Eyes', 'Head', (0, -0.24, 5.37), (0, -0.24, 5.52)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + np.array(WEAPON_AXIS) * 1.0)),
        ('Dirt', 'Weapon', tuple(GRIP_R + np.array(WEAPON_AXIS) * DIRT_AT),
         tuple(GRIP_R + np.array(WEAPON_AXIS) * (DIRT_AT + 0.3))),
        ('SpadeStuck', 'Root', tuple(stuck_head), tuple(stuck_head + STUCK_DIR * 0.6)),
        ('Lantern', 'Hips', tuple(LANTERN_HOOK), tuple(LANTERN_HOOK + np.array((0.0, 0.0, -0.72)))),
        # the leather apron, one spring chain down the front
        ('ApronF1', 'Hips', (0, -0.42, 3.1), (0, -0.5, 2.3)),
        ('ApronF2', 'ApronF1', (0, -0.5, 2.3), (0, -0.56, 1.5)),
    ] + B.arm_leg_bones(L, HAND, FINGERS)
    grown = []
    for name, parent, h, t in out:
        if name in ('Head', 'Jaw', 'Eyes'):
            h, t = tuple(head_map(h)), tuple(head_map(t))
        elif name == 'Neck':
            t = tuple(head_map(t))
        grown.append((name, parent, h, t))
    return B.topo(B.expand(grown))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.4), ('Spine2', 0.6))
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1',
                                     'Little2'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.2, -0.33))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_START = ()
FREE_END = ('Death',)
WEAPON_PROBES = (-HAFT_TOP, 0.6, SOCKET, SOCKET + BLADE_LEN)
COLLIDE_LEGS = {'L_Thigh': 0.4, 'R_Thigh': 0.4, 'L_Shin': 0.26, 'R_Shin': 0.26}
POP_SKIP = ('Apron', 'Lantern')


def _chains():
    from rig import Chain
    return [
        Chain(['ApronF1', 'ApronF2'], 'Hips', gravity=0.55, stiff=0.24, damp=0.24, drag=0.8, collide=True),
        Chain(['Lantern'], 'Hips', gravity=0.9, stiff=0.16, damp=0.12, drag=1.0, collide=True),
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


def frame_xz(z, x):
    """A rotation whose third column is `z` and whose first lies along `x` (made square)."""
    z = unit(z)
    x = np.asarray(x, float)
    x = unit(x - z * (x @ z))
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def _arm_hinge(s):
    sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
    return unit(np.cross(el - sh, wr - el))


# ------------------------------------------------------------------ the bones of the body
RIB_RX = (0.32, 0.41, 0.47, 0.52, 0.54, 0.54, 0.52, 0.47)
RIB_RY = (0.23, 0.27, 0.3, 0.32, 0.32, 0.32, 0.31, 0.29)
RIB_CY = -0.06


def rib_points(i, s):
    """The polyline of rib i (0 the highest) on side s: out of the vertebra, back and
    round the flank, down and forward to its cartilage (the floating ribs stop short)."""
    zb = 4.5 - i * 0.075
    rx, ry = RIB_RX[i], RIB_RY[i]
    drop = 0.1 + 0.035 * i
    gap = (0.3, 0.3, 0.32, 0.36, 0.42, 0.62, 0.95, 1.35)[i]
    pts = [np.array((0.05 * s, 0.15, zb + 0.01))]
    for a in np.linspace(0.18, math.pi - gap, 9):
        x = s * rx * math.sin(a)
        y = RIB_CY + ry * math.cos(a)
        z = zb - drop * (1 - math.cos(a)) / 2
        pts.append(np.array((x, y, z)))
    return pts


def build_body(voxel):
    """The skeleton from the ankles to the skull's foot: the pelvis, the lumbar
    column, the ribcage with its sternum and the thoracic column, the clavicles and
    the shoulder blades, the cervical column, the arms to the wrists and the legs.
    Chunky, stylised bones (the game reads a silhouette, not an anatomy plate),
    every one bound to the bone it rides."""
    F = Field((-1.95, -0.62, 0.85), (1.95, 0.55, 5.12), voxel)
    noise = Noise(7)
    # the pelvis: sacrum, the two flaring iliac wings, the pubic ring
    F.add(Ellipsoid((0, 0.16, 3.14), (0.13, 0.075, 0.2), rot_matrix(rx=-0.35), bone='Hips'), 0.03)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.27, 0.07, 3.2), s), (0.2, 0.055, 0.17), rot_matrix(rz=-0.64 * s, rx=0.2),
                        bone='Hips'), 0.03)
        F.add(Polyline([_m((0.1, 0.18, 3.3), s), _m((0.3, 0.13, 3.36), s), _m((0.42, -0.02, 3.3), s),
                        _m((0.38, -0.12, 3.18), s)], 0.032, bone='Hips'), 0.02)             # the iliac crest
        F.add(RoundCone(_m((0.36, -0.1, 3.12), s), _m((0.15, -0.18, 2.92), s), 0.05, 0.04, bone='Hips'), 0.03)
        F.add(Ellipsoid(_m((0.2, 0.04, 2.86), s), (0.07, 0.07, 0.1), bone='Hips'), 0.03)   # ischium
    F.add(Ellipsoid((0, -0.17, 2.93), (0.12, 0.05, 0.06), bone='Hips'), 0.03)              # pubic arch
    # the lumbar column (bodies, spines, the wings of the transverse processes)
    for j, z in enumerate((3.3, 3.43, 3.56, 3.69, 3.82)):
        bone = 'Hips' if z < 3.45 else 'Spine1'
        y = 0.12
        F.add(Ellipsoid((0, y, z), (0.125, 0.1, 0.055), bone=bone), 0.012)
        F.add(Ellipsoid((0, y, z + 0.065), (0.078, 0.064, 0.022), bone=bone), 0.01)        # the disc
        F.add(RoundCone((0, y + 0.06, z), (0, y + 0.22, z - 0.05), 0.042, 0.028, bone=bone), 0.012)
        for s in (1, -1):
            F.add(RoundCone(_m((0.05, y + 0.03, z), s), _m((0.2, y + 0.06, z + 0.012), s), 0.03, 0.02,
                            bone=bone), 0.01)
    # the thoracic column behind the cage
    for j in range(8):
        z = 3.97 + j * 0.085
        y = 0.13 - 0.03 * j / 7
        F.add(Ellipsoid((0, y, z), (0.085, 0.07, 0.038), bone='Spine2'), 0.012)
        F.add(RoundCone((0, y + 0.05, z), (0, y + 0.19, z - 0.09), 0.03, 0.02, bone='Spine2'), 0.01)
    # the ribs, the sternum, the costal arch
    for i in range(8):
        for s in (1, -1):
            pts = rib_points(i, s)
            radii = [0.034] + [0.043 - 0.01 * k / (len(pts) - 2) for k in range(len(pts) - 1)]
            F.add(Polyline(pts, radii, bone='Spine2'), 0.012)
            if i < 7:
                end = pts[-1]
                zj = 4.4 - 0.065 * i if i < 5 else 4.03
                tip = np.array((0.055 * s, -0.355 - 0.01 * i, zj))
                if i >= 5:
                    tip = np.array((0.07 * s, -0.37, 4.0 + 0.02 * (6 - i)))
                F.add(RoundCone(end, tip, 0.034, 0.03, bone='Spine2'), 0.01)
    st = frame_xz(np.array((0.0, -0.06, -0.4)), (1, 0, 0))
    F.add(RoundBox((0, -0.355, 4.2), (0.055, 0.02, 0.2), st, radius=0.012, bone='Spine2'), 0.015)
    F.add(Ellipsoid((0, -0.33, 4.43), (0.09, 0.03, 0.07), bone='Spine2'), 0.015)           # manubrium
    F.add(RoundCone((0, -0.385, 3.99), (0, -0.39, 3.9), 0.028, 0.012, bone='Spine2'), 0.01)  # xiphoid
    # clavicles and shoulder blades
    for s in (1, -1):
        cl = _side('Clavicle', s)
        F.add(Polyline([_m((0.07, -0.31, 4.47), s), _m((0.32, -0.26, 4.56), s), _m((0.62, -0.02, 4.68), s)],
                       [0.048, 0.045, 0.052], bone=cl), 0.015)
        F.add(Ellipsoid(_m((0.34, 0.29, 4.36), s), (0.2, 0.032, 0.23), rot_matrix(rz=-0.42 * s, rx=0.12),
                        bone=cl), 0.02)
        F.add(RoundCone(_m((0.2, 0.32, 4.44), s), _m((0.6, 0.12, 4.68), s), 0.03, 0.045, bone=cl), 0.02)
    # the cervical column, up into the skull
    nb, nt = np.array((0, 0.06, 4.66)), np.array((0, -0.04, 5.06))
    for j in range(5):
        c = lerp(nb, nt, (j + 0.3) / 5.2)
        F.add(Ellipsoid(c, (0.075, 0.064, 0.03), bone='Neck'), 0.01)
        F.add(RoundCone(c + np.array((0, 0.04, 0)), c + np.array((0, 0.13, -0.035)), 0.026, 0.017, bone='Neck'), 0.01)
        for s in (1, -1):
            F.add(RoundCone(c + np.array((0.03 * s, 0.01, 0)), c + np.array((0.1 * s, 0.03, 0.0)), 0.02, 0.014,
                            bone='Neck'), 0.008)
    # the arms
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        h = _arm_hinge(s)
        F.add(Sphere(sh + np.array((0.02 * s, 0.02, 0.0)), 0.145, bone=up), 0.03)
        F.add(RoundCone(sh, lerp(sh, el, 0.86), 0.108, 0.085, bone=up), 0.04)
        F.add(Ellipsoid(lerp(sh, el, 0.3) + np.array((0.03 * s, -0.02, 0)), (0.065, 0.065, 0.14), _rot(sh, el),
                        bone=up), 0.04)                                                     # the deltoid ridge
        F.add(Ellipsoid(el + unit(sh - el) * 0.04, (0.17, 0.095, 0.095), frame_xz(el - sh, h), bone=up), 0.03)
        ax = unit(wr - el)
        _wwl, _dd, wdw, _pp = HAND.frame(s)
        radl = wdw - ax * (wdw @ ax)
        radl = unit(radl)
        back = unit(np.cross(h, ax)) * (1 if s > 0 else -1)
        F.add(Sphere(el - ax * 0.02 + back * 0.06, 0.082, bone=fo), 0.015)                  # olecranon
        F.add(RoundCone(el - radl * 0.06 + back * 0.03, wr - radl * 0.068, 0.066, 0.05, bone=fo), 0.01)   # ulna
        F.add(RoundCone(el + radl * 0.07, wr + radl * 0.068, 0.054, 0.068, bone=fo), 0.01)               # radius
        F.add(Ellipsoid(wr - ax * 0.03, (0.12, 0.06, 0.06), frame_xz(ax, radl), bone=fo), 0.015)
    # the legs (the femurs under the breeches, the knees and shins bare, the boots below)
    for s in (1, -1):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sh_ = _side('Thigh', s), _side('Shin', s)
        F.add(Sphere(hp, 0.1, bone=th), 0.03)
        F.add(RoundCone(hp, hp + np.array((0.1 * s, 0.0, -0.12)), 0.075, 0.08, bone=th), 0.03)   # neck and trochanter
        F.add(RoundCone(hp + np.array((0.08 * s, 0.0, -0.14)), kn + np.array((0, 0.0, 0.14)), 0.085, 0.072,
                        bone=th), 0.04)
        F.add(Ellipsoid(kn + np.array((0, 0.03, 0.05)), (0.18, 0.12, 0.09), bone=th), 0.03)     # condyles
        F.add(Ellipsoid(kn + np.array((0, -0.13, 0.0)), (0.09, 0.05, 0.105), bone=_side('KneeFix', s)), 0.02)
        F.add(Ellipsoid(kn + np.array((0, 0.0, -0.11)), (0.18, 0.13, 0.07), bone=sh_), 0.03)     # tibial plateau
        F.add(RoundCone(kn + np.array((0, -0.05, -0.12)), kn + np.array((0, -0.06, -0.3)), 0.05, 0.03, bone=sh_), 0.03)
        F.add(RoundCone(kn + np.array((0, -0.02, -0.12)), an + np.array((0, -0.01, 0.3)), 0.092, 0.07, bone=sh_),
              0.03)
        F.add(RoundCone(kn + np.array((0.1 * s, 0.05, -0.13)), an + np.array((0.09 * s, 0.06, 0.32)), 0.042, 0.034,
                        bone=sh_), 0.01)                                                    # fibula
    # pitted, weathered bone
    F.displace(lambda X_, Y_, Z_: 0.004 * noise.fbm(X_ * 9, Y_ * 9, Z_ * 9, octaves=2), band=0.06)
    return F


# ------------------------------------------------------------------ the skull
def build_skull(voxel):
    """A big grim skull: the cranium, a heavy brow ridge dropping to a frown over
    deep orbits, the cheekbones and their arches, the temples and the cheeks fallen
    in, the nasal hollow, a long heavy mandible on the Jaw; sutures and cracks."""
    F = Field((-0.4, -0.52, 4.86), (0.4, 0.38, 5.84), voxel)
    noise = Noise(19)
    F.add(Ellipsoid((0, -0.01, 5.48), (0.255, 0.29, 0.27), bone='Head'), 0.05)               # the cranium
    F.add(Ellipsoid((0, 0.17, 5.4), (0.2, 0.11, 0.17), bone='Head'), 0.06)                  # the occiput
    F.add(Ellipsoid((0, -0.17, 5.33), (0.2, 0.17, 0.18), bone='Head'), 0.05)                # the face block
    F.add(Ellipsoid((0, -0.25, 5.18), (0.13, 0.08, 0.065), bone='Head'), 0.03)              # the maxilla
    F.add(Polyline([(-0.2, -0.27, 5.47), (-0.07, -0.33, 5.415), (0.07, -0.33, 5.415), (0.2, -0.27, 5.47)],
                   [0.03, 0.045, 0.045, 0.03], bone='Head'), 0.03)                          # the frowning brow
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.165, -0.25, 5.29), s), (0.06, 0.05, 0.04), bone='Head'), 0.02)   # cheekbone
        F.add(RoundCone(_m((0.18, -0.22, 5.29), s), _m((0.235, -0.04, 5.31), s), 0.026, 0.022, bone='Head'), 0.02)
        F.add(Ellipsoid(_m((0.22, 0.02, 5.24), s), (0.04, 0.05, 0.06), bone='Head'), 0.02)     # mastoid
        F.sub(Ellipsoid(_m((0.245, -0.08, 5.43), s), (0.05, 0.11, 0.08)), 0.035)                 # temple
        F.sub(Ellipsoid(_m((0.15, -0.27, 5.17), s), (0.05, 0.05, 0.06)), 0.03)                   # fallen cheek
        F.sub(Sphere(_m((0.092, -0.33, 5.37), s), 0.075), 0.018)                                  # the orbit
        F.sub(Sphere(_m((0.088, -0.27, 5.37), s), 0.058), 0.02)                                   # deep inside it
    F.sub(Ellipsoid((0.0, -0.355, 5.245), (0.038, 0.06, 0.06)), 0.012)                        # the nasal hollow
    for s in (1, -1):
        F.sub(Ellipsoid(_m((0.018, -0.35, 5.21), s), (0.028, 0.05, 0.035)), 0.01)
    F.sub(RoundBox((0, -0.33, 5.12), (0.1, 0.06, 0.012), radius=0.01), 0.008)                 # under the upper teeth
    # the mandible: a heavy U, the rami up to the hinge, a square chin
    jaw = [(-0.19, -0.05, 5.13), (-0.16, -0.22, 5.04), (-0.07, -0.33, 5.0), (0.07, -0.33, 5.0),
           (0.16, -0.22, 5.04), (0.19, -0.05, 5.13)]
    F.add(Polyline(jaw, [0.035, 0.042, 0.045, 0.045, 0.042, 0.035], bone='Jaw'), 0.02)
    for s in (1, -1):
        F.add(RoundCone(_m((0.19, -0.05, 5.13), s), _m((0.2, -0.04, 5.25), s), 0.035, 0.028, bone='Jaw'), 0.02)
        F.add(RoundCone(_m((0.19, -0.07, 5.16), s), _m((0.18, -0.12, 5.25), s), 0.022, 0.012, bone='Jaw'), 0.015)
    F.add(Ellipsoid((0, -0.345, 5.0), (0.075, 0.04, 0.045), bone='Jaw'), 0.02)               # the chin
    F.add(RoundBox((0, -0.27, 5.06), (0.11, 0.06, 0.02), radius=0.015, bone='Jaw'), 0.02)
    # sutures and a crack
    F.groove(Polyline([(0, -0.22, 5.68), (0.0, -0.02, 5.75), (0.01, 0.16, 5.66), (0.0, 0.26, 5.5)], 0.003),
             0.007, k=0.008)
    F.groove(Polyline([(-0.24, 0.02, 5.58), (-0.12, 0.0, 5.72), (0.0, -0.02, 5.75), (0.12, 0.0, 5.72),
                       (0.24, 0.02, 5.58)], 0.003), 0.006, k=0.008)
    F.groove(Polyline([(0.16, -0.24, 5.62), (0.2, -0.2, 5.56), (0.19, -0.14, 5.52), (0.23, -0.1, 5.47)], 0.003),
             0.009, k=0.008)
    F.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=2)
               + 0.0015 * noise.fbm(X_ * 40, Y_ * 40, Z_ * 40, octaves=2), band=0.05)
    return F


def build_teeth(voxel):
    """Long yellowed teeth, upper (Head) and lower (Jaw), two of them gone."""
    up = Field((-0.16, -0.38, 5.05), (0.16, -0.12, 5.2), voxel)
    lo = Field((-0.16, -0.38, 4.99), (0.16, -0.12, 5.12), voxel)
    rng = np.random.default_rng(31)
    for k in range(10):
        a = -0.95 + 1.9 * k / 9
        x, y = 0.12 * math.sin(a), -0.21 - 0.11 * math.cos(a)
        if k == 6:
            continue
        hgt = rng.uniform(0.032, 0.045)
        up.add(RoundCone((x, y, 5.165), (x, y - 0.004, 5.165 - hgt), 0.019, 0.014), 0.005)
        if k not in (2, 8):
            h2 = rng.uniform(0.026, 0.036)
            lo.add(RoundCone((x * 0.93, y + 0.008, 5.04), (x * 0.93, y + 0.006, 5.04 + h2), 0.017, 0.012), 0.005)
    return up, lo


# ------------------------------------------------------------------ the bony hands
def build_hand(side, voxel):
    """Carpals, the long metacarpals, three phalanges a finger ending in a hooked
    tip; the thumb's own two."""
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.1, w + down * 0.75) - 0.24
    hi = np.maximum(w - down * 0.1, w + down * 0.75) + 0.24
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(Ellipsoid(w + down * 0.06, (0.095, 0.055, 0.07), Rm, bone=hand), 0.02)             # the carpals
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.041
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        if f == 'Thumb':
            F.add(RoundCone(w + down * 0.07 + width * 0.04, base, 0.038, 0.038, bone=hand), 0.01)
        else:
            F.add(RoundCone(w + down * 0.1 + width * HAND.fingers[f][0] * 0.55, base - unit(base - w) * 0.02,
                            0.029, 0.034, bone=hand), 0.008)
            F.add(Sphere(base, r0 * 1.05, bone=hand), 0.008)
        F.add(RoundCone(base, mid, r0, r0 * 0.82, bone=b1), 0.008)
        F.add(Sphere(mid, r0 * 0.9, bone=b2), 0.006)
        m2 = lerp(mid, tip, 0.52)
        F.add(RoundCone(mid, m2, r0 * 0.78, r0 * 0.66, bone=b2), 0.006)
        F.add(Sphere(m2, r0 * 0.7, bone=b2), 0.005)
        F.add(RoundCone(m2, tip + (tip - m2) * 0.15, r0 * 0.62, r0 * 0.22, bone=b2), 0.005)
    return F


# ------------------------------------------------------------------ the cowl and capelet
def _ghost(voxel):
    """An invisible padded form under the cowl: the cloth drapes over it, never over
    the bare ribs."""
    G = Field((-1.15, -0.72, 3.2), (1.15, 0.82, 6.05), voxel)
    G.add(Ellipsoid((0, -0.05, 5.47), (0.285, 0.33, 0.33)), 0.05)
    G.add(RoundCone((0, 0.12, 4.6), (0, 0.0, 5.12), 0.27, 0.22), 0.1)
    G.add(Ellipsoid((0, 0.06, 4.5), (0.7, 0.42, 0.3)), 0.12)
    G.add(Ellipsoid((0, 0.2, 4.15), (0.56, 0.36, 0.56)), 0.12)
    G.add(Ellipsoid((0, -0.08, 4.28), (0.5, 0.36, 0.34)), 0.12)
    for s in (1, -1):
        G.add(Sphere(_m(SHOULDER, s) + np.array((0.0, 0, 0.04)), 0.13), 0.1)
        G.add(RoundCone(_m(SHOULDER, s), lerp(_m(SHOULDER, s), _m(ELBOW, s), 0.3), 0.11, 0.09), 0.06)
    return G


def _arm_d(X_, Y_, Z_, s, a='SHOULDER', b='ELBOW'):
    A_ = {'SHOULDER': SHOULDER, 'ELBOW': ELBOW, 'WRIST': WRIST, 'HIP': HIP, 'KNEE': KNEE, 'ANKLE': ANKLE}
    return X.seg_dist(X_, Y_, Z_, _m(A_[a], s), _m(A_[b], s))


FACE_Z = (5.08, 5.62)


def build_cowl(voxel):
    """The sexton's cowl: a deep hood of soot-black grave cloth, its peak drawn over
    the brow and its point slumped down the back, open wide on the skull's face;
    the capelet over the shoulders and the upper back, parted in front on the
    sternum, its hem torn into tatters (longest at the back)."""
    rg = X.ramp
    base = _ghost(voxel * 1.6)
    noise = Noise(51)
    rng = np.random.default_rng(8)

    def mask(X_, Y_, Z_):
        ang = np.arctan2(X_, -Y_)                                   # 0 at the front, pi at the back
        back = (1 - np.cos(ang)) / 2
        hem = 4.22 - 0.62 * back ** 1.6 + 0.08 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 1.5, octaves=2)
        hem = hem + 0.05 * np.sin(ang * 13.0) * (1 - 0.3 * back)       # the tatters' tongues
        m = rg(Z_, hem, hem + 0.05)
        # parted in front, a V down to the sternum
        part = rg(-Y_, 0.08, 0.2) * (1 - rg(Z_, 4.42, 4.6)) * rg(np.abs(X_), 0.1 + (4.6 - Z_) * 0.35,
                                                               0.04 + (4.6 - Z_) * 0.35)
        face = rg(-Y_, -0.02, 0.1) * rg(Z_, FACE_Z[0], FACE_Z[0] + 0.06) * (1 - rg(Z_, FACE_Z[1] - 0.06, FACE_Z[1])) \
            * rg(np.abs(X_), 0.23, 0.18)
        chin = rg(-Y_, 0.1, 0.22) * rg(Z_, 4.78, 4.86) * (1 - rg(Z_, 5.1, 5.14)) * rg(np.abs(X_), 0.2, 0.15)
        arms = 1.0
        for s in (1, -1):
            d, u = _arm_d(X_, Y_, Z_, s)
            arms = arms * (1 - (1 - rg(d, 0.16, 0.24)) * rg(u, 0.17, 0.25))
        return m * (1 - part) * (1 - face) * (1 - chin) * arms

    def off(X_, Y_, Z_):
        folds = 0.03 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 2.2, octaves=3)
        drape = 0.016 * np.sin(np.arctan2(Y_, X_) * 9 + Z_ * 2) * rg(Z_, 4.75, 4.3)
        flare = 0.12 * rg(Z_, 4.62, 4.0) * (1.0 - 0.5 * rg(np.abs(X_), 0.35, 0.6))
        return 0.02 + 0.03 * rg(Z_, 5.0, 5.4) + folds + drape + flare

    def peak(G):
        # the peak drawn forward over the brow, the rolled rim round the face, the point down the back
        G.add(RoundCone((0, -0.28, 5.84), (0, -0.5, 5.7), 0.12, 0.05), 0.08)
        rim = []
        for a in np.linspace(-1.0, 1.0, 21):
            th = a * 1.45
            x = 0.235 * math.sin(th)
            z = 5.35 + 0.29 * math.cos(th) * (1.0 if math.cos(th) > 0 else 1.05)
            rim.append((x, -0.44 + 0.08 * abs(math.sin(th)) ** 2 + 0.02 * (z - 5.35), z))
        G.add(Polyline(rim, 0.038), 0.04)
        # the cowl's point: up off the crown, then slumped back and down the nape
        G.add(RoundCone((0, 0.0, 5.68), (0, 0.27, 5.74), 0.15, 0.1), 0.1)
        G.add(RoundCone((0, 0.27, 5.74), (0.0, 0.47, 5.62), 0.1, 0.075), 0.08)
        G.add(RoundCone((0.0, 0.47, 5.66), (0.03, 0.56, 5.3), 0.075, 0.05), 0.06)
        G.add(RoundCone((0.03, 0.56, 5.3), (0.05, 0.58, 5.02), 0.05, 0.03), 0.04)
        G.sub(Ellipsoid((0, -0.5, 5.35), (0.17, 0.12, 0.24)), 0.04)
        # rents in the cloth
        for _ in range(6):
            a = rng.uniform(1.2, 5.1)
            G.sub(Ellipsoid((0.5 * math.sin(a), 0.1 - 0.42 * math.cos(a), rng.uniform(4.15, 4.5)),
                            (rng.uniform(0.03, 0.06), rng.uniform(0.03, 0.06), rng.uniform(0.03, 0.08))), 0.01)
    return X.layer_field(base, (-1.15, -0.75, 3.45), (1.15, 0.95, 6.0), voxel, off, 0.045, mask, extra=peak)


def cowl_weights(obj):
    """The hood rides the head, its throat the neck, the capelet the upper spine,
    the clavicles and (over the shoulders) the upper arms."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Head', 'Neck', 'Spine2', 'L_Clavicle', 'R_Clavicle', 'L_UpperArm', 'R_UpperArm']
    W = np.zeros((len(P), len(names)))
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    head = np.clip((z - 4.98) / 0.16, 0, 1)
    head = np.maximum(head, np.clip((z - 4.8) / 0.2, 0, 1) * np.clip((-y - 0.2) / 0.1, 0, 1))
    neck = np.clip((z - 4.6) / 0.22, 0, 1) * (1 - head)
    low = 1 - head - neck
    ax = np.abs(x)
    arm = np.clip((ax - 0.55) / 0.2, 0, 1) * np.clip((4.65 - z) / 0.3, 0, 1)
    clav = np.clip((ax - 0.18) / 0.3, 0, 1) * (1 - arm)
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


# ------------------------------------------------------------------ the breeches, the apron, the boots, the belt
def _legs_ghost(voxel):
    G = Field((-0.85, -0.6, 1.4), (0.85, 0.6, 3.5), voxel)
    G.add(Ellipsoid((0, 0.04, 3.1), (0.4, 0.25, 0.25)), 0.1)
    for s in (1, -1):
        G.add(RoundCone(_m(HIP, s) + np.array((0.02 * s, -0.02, 0.05)), _m(KNEE, s) + np.array((0, 0, 0.1)), 0.24,
                        0.18), 0.1)
    return G


def build_breeches(G, voxel, s):
    """Ragged knee breeches of grave-dirty wool, torn off above the knee."""
    rg = X.ramp
    noise = Noise(40 + s)

    def mask(X_, Y_, Z_):
        hem = 1.86 + 0.08 * noise.fbm(X_ * 7, Y_ * 7, Z_, octaves=2) + 0.04 * np.sin(np.arctan2(Y_, X_ - 0.3 * s) * 9)
        return rg(Z_, hem, hem + 0.04) * (1 - rg(Z_, 3.28, 3.32)) * rg(X_ * s, -0.02, 0.04)

    def folds(X_, Y_, Z_):
        return 0.012 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 9, octaves=2)
    hp, kn = _m(HIP, s), _m(KNEE, s)
    lo = np.minimum(hp, kn) - 0.5
    hi = np.maximum(hp, kn) + 0.5
    lo[2], hi[2] = 1.6, 3.42
    return X.layer_field(G, lo, hi, voxel, 0.012, 0.035, mask, noise=folds)


def build_apron(voxel):
    """The gravedigger's leather apron: from the rope belt to the shins, curved over
    the thighs, a patch pocket on the right, the edges stitched, the hem worn and
    split, one corner torn away."""
    F = Field((-0.75, -0.8, 1.35), (0.75, 0.1, 3.35), voxel)
    rng = np.random.default_rng(6)
    cone = X.Shell(RoundCone((0, 0.03, 3.28), (0, -0.02, 1.45), 0.365, 0.6), 0.034)
    band = RoundBox((0, -0.6, 2.35), (0.56, 0.42, 0.93), radius=0.0)
    F.add(X.Inter(cone, band, 0.0, bone='Hips'), 0.0, weight=False)
    # the pocket and its stitched edges
    pk = frame_xz(np.array((0.0, -0.12, 1.0)), (1, 0, 0))
    F.add(RoundBox((-0.2, -0.535, 2.45), (0.17, 0.014, 0.15), pk, radius=0.008), 0.012)
    F.groove(Polyline([(-0.36, -0.56, 2.3), (-0.36, -0.56, 2.58), (-0.04, -0.56, 2.58), (-0.04, -0.56, 2.3)], 0.002),
             0.004, k=0.006)
    # the hem: worn tongues, a split, a torn corner
    for k in range(18):
        x = -0.55 + 1.1 * k / 17 + rng.uniform(-0.02, 0.02)
        F.sub(Ellipsoid((x, -0.62, 1.45 + rng.uniform(-0.04, 0.06)),
                        (rng.uniform(0.025, 0.05), 0.2, rng.uniform(0.04, 0.12))), 0.01)
    F.sub(RoundBox((0.12, -0.62, 1.62), (0.012, 0.2, 0.2), radius=0.004), 0.008)
    F.sub(Ellipsoid((0.56, -0.5, 1.5), (0.16, 0.3, 0.22)), 0.02)
    noise = Noise(16)
    F.displace(lambda X_, Y_, Z_: 0.007 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 1.4, octaves=3), band=0.05)
    return F


def apron_weights(obj):
    """The apron rides the hips at the belt, its spring chain and the thighs below."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Hips', 'L_Thigh', 'R_Thigh', 'ApronF1', 'ApronF2']
    W = np.zeros((len(P), len(names)))
    z = P[:, 2]
    t = np.clip((3.2 - z) / (3.2 - 1.45), 0, 1)
    hip = np.clip(1 - t / 0.12, 0, 1)
    leg = (1 - hip) * 0.4 * np.clip(t * 1.6, 0, 1) * (1 - np.clip((t - 0.7) / 0.3, 0, 1) * 0.6)
    spring = (1 - hip) - leg
    left = P[:, 0] > 0
    lowr = np.clip((t - 0.45) / 0.3, 0, 1)
    W[:, 0] = hip
    W[left, 1] = leg[left]
    W[~left, 2] = leg[~left]
    W[:, 3] = spring * (1 - lowr)
    W[:, 4] = spring * lowr
    W = R.relax(W, E, iters=3)
    W = R.cap4(W)
    R.write_groups(obj, names, W)


def build_boot(voxel, s):
    """A worn, slouched work boot caked in earth: the shaft gaping round the shin
    bone, a turned-down cuff, a strap and buckle at the ankle, a split welt."""
    an = _m(ANKLE, s)
    F = Field(an + np.array((-0.3, -0.95, -0.4)), an + np.array((0.3, 0.42, 1.0)), voxel)
    shin, foot, toes = _side('Shin', s), _side('Foot', s), _side('Toes', s)
    F.add(RoundCone(an + np.array((0, 0.02, 0.06)), np.array((an[0], 0.06, 1.18)), 0.155, 0.175, bone=shin), 0.06)
    F.add(Torus((an[0], 0.06, 1.12), (0, 0.15, 1.0), 0.19, 0.05, bone=shin), 0.04)          # the cuff
    F.add(Ellipsoid((an[0], 0.04, 0.78), (0.172, 0.17, 0.2), bone=shin), 0.1)                 # slouched
    F.sub(RoundCone(np.array((an[0], 0.065, 0.96)), np.array((an[0], 0.07, 1.4)), 0.11, 0.125), 0.02)
    F.add(Ellipsoid(an + np.array((0, 0.06, -0.15)), (0.16, 0.2, 0.17), bone=foot), 0.06)     # heel
    F.add(RoundBox(_m((0.385, -0.14, 0.14), s), (0.14, 0.24, 0.1), radius=0.07, bone=foot), 0.06)
    F.add(Ellipsoid(_m((0.39, -0.56, 0.115), s), (0.145, 0.21, 0.1), bone=toes), 0.05)        # the toe box
    F.add(RoundBox(_m((0.385, -0.08, 0.03), s), (0.165, 0.3, 0.03), radius=0.02, bone=foot), 0.02)   # sole
    F.add(RoundBox(_m((0.39, -0.56, 0.03), s), (0.16, 0.22, 0.03), radius=0.02, bone=toes), 0.02)
    F.add(Torus(an + np.array((0, 0.0, 0.08)), (0, 0.2, 1.0), 0.162, 0.022, bone=shin), 0.015)  # the strap
    F.add(RoundBox(an + np.array((0.165 * s, -0.04, 0.08)), (0.012, 0.045, 0.04), radius=0.008, bone=shin), 0.006)
    F.groove(Polyline([_m((0.25, -0.3, 0.07), s), _m((0.3, -0.55, 0.06), s), _m((0.39, -0.74, 0.07), s)], 0.003),
             0.012, k=0.01)                                                                  # the split welt
    noise = Noise(60 + s)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 12, octaves=2), band=0.05)
    return F


BELT_C, BELT_R = np.array((0.0, 0.03, 3.22)), (0.46, 0.4)


def build_belt(voxel):
    """The rope belt: a twist of hemp round the hips over the apron's top, a knot at
    the front left with two frayed ends, the S-hook for the lantern."""
    F = Field((-0.62, -0.62, 2.55), (0.9, 0.6, 3.45), voxel)
    ring = []
    for a in np.linspace(-math.pi, math.pi, 49):
        ring.append((BELT_R[0] * math.cos(a), BELT_C[1] + BELT_R[1] * math.sin(a),
                     BELT_C[2] + 0.025 * math.sin(a * 2)))
    F.add(Polyline(ring, 0.04), 0.01)
    for ph in (0.0, math.pi):                                      # the twist of the strands
        hel = []
        for a in np.linspace(-math.pi, math.pi, 241):
            tw = a * 22 + ph
            r0, r1 = BELT_R[0] + 0.025 * math.cos(tw), BELT_R[1] + 0.025 * math.cos(tw)
            hel.append((r0 * math.cos(a), BELT_C[1] + r1 * math.sin(a),
                        BELT_C[2] + 0.025 * math.sin(a * 2) + 0.025 * math.sin(tw)))
        F.ridge(Polyline(hel, 0.004), 0.01, k=0.012)
    kn = np.array((0.2, -0.38, 3.2))
    F.add(Ellipsoid(kn, (0.07, 0.05, 0.06)), 0.02)
    for dx, L_ in ((-0.02, 0.36), (0.04, 0.27)):
        F.add(Polyline([kn + np.array((dx, -0.02, -0.03)), kn + np.array((dx * 1.5, -0.05, -L_ * 0.5)),
                        kn + np.array((dx * 2, -0.04, -L_))], [0.03, 0.028, 0.02]), 0.02)
    # the S-hook out to the lantern's ring
    hk = [(0.44, -0.08, 3.2), (0.62, -0.09, 3.3), (0.8, -0.1, 3.27), (0.84, -0.1, 3.14)]
    F.add(Polyline(hk, 0.018), 0.01)
    return F


RING_C = np.array((-0.74, -0.06, 2.92))


def build_keys(voxel):
    """The sexton's keys: an iron hoop on a cord from the belt at the right hip, a
    handful of big church keys fanning down from it."""
    F = Field(RING_C + np.array((-0.2, -0.32, -0.62)), RING_C + np.array((0.2, 0.32, 0.38)), voxel)
    F.add(Polyline([(-0.48, -0.06, 3.2), (-0.6, -0.06, 3.14), RING_C + np.array((0.0, 0.0, 0.1))], 0.02), 0.01)
    F.add(Torus(tuple(RING_C), (1.0, 0.0, 0.0), 0.1, 0.017), 0.01)
    rng = np.random.default_rng(31)
    for i in range(5):
        a = math.pi + (-0.9 + 1.8 * i / 4) + rng.uniform(-0.06, 0.06)
        dirv = np.array((0.0, math.sin(a), math.cos(a)))
        p = RING_C + dirv * 0.1
        L_ = rng.uniform(0.3, 0.42)
        F.add(Torus(tuple(p + dirv * 0.05), (1.0, 0.0, 0.0), 0.05, 0.013), 0.004)            # the bow
        tip = p + dirv * (0.1 + L_)
        F.add(RoundCone(p + dirv * 0.1, tip, 0.017, 0.015), 0.004)                          # the shank
        side = np.cross(dirv, (1.0, 0.0, 0.0))
        F.add(RoundBox(tip - dirv * 0.05 + side * 0.04, (0.012, 0.035, 0.045), frame_xz(dirv, (1, 0, 0)),
                       radius=0.006), 0.004)                                                  # the bit
        F.sub(RoundBox(tip - dirv * 0.04 + side * 0.06, (0.02, 0.012, 0.01), frame_xz(dirv, (1, 0, 0)),
                       radius=0.003), 0.003)
    return F


def build_hair(voxel):
    """A few lank wisps of grey hair from under the hood, at the temples and the nape."""
    F = Field((-0.36, -0.36, 4.75), (0.36, 0.36, 5.55), voxel)
    rng = np.random.default_rng(4)
    for x0, y0, z0, L_ in ((0.22, -0.2, 5.48, 0.42), (0.25, -0.12, 5.46, 0.5), (-0.23, -0.19, 5.47, 0.46),
                           (-0.25, -0.1, 5.44, 0.38), (0.12, 0.24, 5.4, 0.44), (-0.08, 0.26, 5.38, 0.5)):
        pts = []
        ph = rng.uniform(0, 3)
        for t in np.linspace(0, 1, 7):
            out = np.array((x0, y0, 0.0))
            out = out / np.linalg.norm(out)
            p = np.array((x0, y0, z0)) + out * (0.04 * t + 0.01 * math.sin(t * 6 + ph)) \
                + np.array((0, 0, -L_ * t))
            pts.append(p)
        F.add(Polyline(pts, [0.012 - 0.008 * t for t in np.linspace(0, 1, 7)]), 0.008)
    return F


# ------------------------------------------------------------------ sculpt list
VOXEL_K = 1.0


def fields(k=1.0):
    global VOXEL_K
    from build_core import Sculpt
    VOXEL_K = k
    vb, vh, vhand, vp = 0.0125 * k, 0.006 * k, 0.0055 * k, 0.0105 * k
    Fb = build_body(vb)
    Fs = build_skull(vh)
    face = [((0, -0.3, 5.3), 0.16, 1.0)]
    ribs = [((0, -0.2, 4.2), 0.4, 0.4)]
    S = [Sculpt('Body', Fb, 'bone', 10500, spots=ribs, tau=0.025),
         Sculpt('Skull', Fs, 'bone', 4200, spots=face, tau=0.02),
         Sculpt('R_HandBones', build_hand(-1, vhand), 'bone', 1500, tau=0.008),
         Sculpt('L_HandBones', build_hand(1, vhand), 'bone', 1500, tau=0.008)]
    tu, tl = build_teeth(vh * 0.7)
    S.append(Sculpt('TeethUp', tu, 'tooth', 420, binding='rigid', bone='Head'))
    S.append(Sculpt('TeethLow', tl, 'tooth', 340, binding='rigid', bone='Jaw'))
    S.append(Sculpt('Cowl', build_cowl(vp), 'cloth', 4800, binding='own', weigh=cowl_weights))
    Gl = _legs_ghost(0.02)
    for s in (1, -1):
        S.append(Sculpt(_side('Breeches', s), build_breeches(Gl, vp, s), 'breech', 950, binding='transfer',
                        allow=(_side('Thigh', s), 'Hips', _side('KneeFix', s)), relax=6))
        S.append(Sculpt(_side('Boot', s), build_boot(vp * 0.9, s), 'boot', 1500, tau=0.03))
    S.append(Sculpt('Apron', build_apron(vp), 'apron', 1900, binding='own', weigh=apron_weights))
    S.append(Sculpt('Belt', build_belt(0.006 * k), 'rope', 1100, binding='rigid', bone='Hips'))
    S.append(Sculpt('Keys', build_keys(0.0045 * k), 'iron', 1000, binding='rigid', bone='Hips'))
    S.append(Sculpt('Hair', build_hair(0.0045 * k), 'hair', 420, binding='rigid', bone='Head'))
    return S


# The effect anchors the game reads (kit/anchors.py prints them in the game's terms).
ANCHORS = {
    'lantern': ('Lantern', LANTERN_C),
    'eyes': ('Head', head_map(np.array((0.0, -0.3, 5.37)))),
    'blade': ('Weapon', GRIP_R + np.array(WEAPON_AXIS) * (SOCKET + BLADE_LEN * 0.5)),
    'bladeTip': ('Weapon', GRIP_R + np.array(WEAPON_AXIS) * (SOCKET + BLADE_LEN)),
    'chest': ('Spine2', np.array((0.0, -0.4, 4.2))),
}
