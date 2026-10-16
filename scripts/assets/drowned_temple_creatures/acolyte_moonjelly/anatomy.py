"""Pale Choir Acolyte: skeleton and sculpts (rest pose), in yards.

A novice of the moon choir whom the temple's water remade instead of drowning:
a slender woman hovering a hand's breadth above the floor. The bell of a great
moon jellyfish is her hood (milky, lit from within, its four rings glowing
through it); under its brim a serene, cold, beautiful face sings with closed
eyes. A silk cowl under the bell, a crescent circlet on the brow and a pearl
pendant at the throat. A fitted bodice of carved nacre over pale skin; slender
bare arms with nacre cuffs. Below the waist the jellyfish takes over: a long
skirt of semi-sheer silk, two frilled oral arms falling down its front like the
panels of a robe, and from the bell's margin a veil of silk and trailing
tentacles that falls behind her to the floor.

Axes: yards, +Z up, faces -Y, her left is +X. Rest is an A-pose. Bell top about
5.2 yd (2 players). There are no legs: the body ends in the skirt, and every
hanging layer rides its own follow-through chain.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'PaleChoirAcolyte'
PREFIX = 'acolyte'

SHOULDER = np.array((0.36, 0.04, 3.85))
ELBOW = np.array((0.5, 0.1, 3.27))
WRIST = np.array((0.6, 0.02, 2.76))
HAND_TIP = np.array((0.645, -0.05, 2.5))
HEAD_PIVOT = np.array((0.0, 0.02, 4.26))     # the top of the neck: the head is enlarged about it
HEAD_SCALE = 1.2


def hs(p):
    """A rest point of the head sculpt, enlarged about the top of the neck."""
    return HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) * HEAD_SCALE


def hs_inv(p):
    return HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) / HEAD_SCALE


HEAD_C = hs((0.0, 0.02, 4.5))                # the skull's centre

HAND = B.Hand(WRIST, HAND_TIP, 0.13, {
    'Index': (0.034, 0.08, 0.0, 0.085, 0.017),
    'Middle': (0.011, 0.02, 0.006, 0.095, 0.0175),
    'Ring': (-0.012, -0.05, 0.0, 0.088, 0.0165),
    'Little': (-0.032, -0.12, -0.012, 0.07, 0.0145),
}, thumb=((0.04, 0.035, 0.03), (0.5, 0.65, 0.55), 0.065, 0.055))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


# ------------------------------------------------------------------ the bell (her hood)
BELL_C = np.array((0.0, 0.2, 4.38))         # the margin's centre: the bell sits on her head
BELL_TILT = math.radians(33.0)               # tipped back: the brim on her brow, the back margin on her shoulders
BELL_AXIS = np.array((0.0, math.sin(BELL_TILT), math.cos(BELL_TILT)))
BELL_FRONT = np.array((0.0, -math.cos(BELL_TILT), math.sin(BELL_TILT)))
BELL_SIDE = np.array((1.0, 0.0, 0.0))
BELL_R, BELL_H = 0.74, 0.78                  # margin radius, dome height
BELL_FRAME = np.stack([BELL_SIDE, BELL_FRONT, BELL_AXIS], axis=1)   # local (side, front, axis) -> armature


def bell_point(phi, rho=1.0, u=0.0):
    """A point in the bell's frame: phi round the axis (0 = the brim's front,
    +90 her left), rho a fraction of the margin radius, u along the axis."""
    return BELL_C + BELL_R * rho * (BELL_FRONT * math.cos(phi) + BELL_SIDE * math.sin(phi)) + BELL_AXIS * u


# ------------------------------------------------------------------ hanging chains
SKIRT_N = 8
SKIRT_Z = (2.72, 1.9, 1.1, 0.3)


def skirt_radius(z):
    """The skirt's radius (x half-width) at height z, and its front-back squash."""
    t = np.clip((2.95 - z) / 2.65, 0.0, 1.0)
    r = 0.3 + 0.12 * np.clip((2.95 - z) / 0.25, 0, 1) + 0.46 * t ** 1.15
    squash = 0.74 + 0.16 * t
    return r, squash


def skirt_point(phi, z, out=0.0):
    """phi: 0 = front (-Y), +90 = her left (+X)."""
    r, sq = skirt_radius(z)
    r = r + out
    return np.array((r * math.sin(phi), -r * math.cos(phi) * sq + 0.02, z))


VEIL_ANG = (-80.0, -40.0, 0.0, 40.0, 80.0)   # degrees from straight back, + toward her left
VEIL_Z = (3.2, 2.2, 1.2, 0.1)


def veil_top(deg):
    """Where a veil chain leaves the bell: under the margin, just inside it."""
    phi = math.pi - math.radians(deg)          # bell phi: 0 front, pi back
    return bell_point(phi, 0.93, 0.03)


def veil_point(deg, z):
    top = veil_top(deg)
    a = math.radians(deg)
    t = (top[2] - z) / (top[2] - 0.1)
    r = 0.72 + 0.32 * t
    back = np.array((math.sin(a), math.cos(a), 0.0))
    return np.array((0.0, 0.1, z)) + back * r


TENT_SIDES = ((1, 'L'), (-1, 'R'))


def tent_points(s):
    """The face-framing tentacle chain: from the brim beside the cheek to the bust."""
    top = bell_point(s * math.radians(62), 0.95, 0.02)
    mid = np.array((s * 0.5, -0.12, 3.75))
    low = np.array((s * 0.46, -0.2, 3.15))
    return top, mid, low


FRILL_X = 0.12
FRILL_Z = (2.95, 2.0, 1.1, 0.22)


def frill_point(s, z):
    r, sq = skirt_radius(z)
    x = s * (FRILL_X + 0.05 * (2.95 - z) / 2.7)
    y = -np.sqrt(max(r * r - x * x, 0.0)) * sq - 0.11 + 0.02
    return np.array((x, y, z))


BAKE_CAGE, BAKE_RAY = 0.02, 0.07     # thin layers lie close: short rays never reach a neighbour
PEARL_AT = np.array((0.0, -0.215, 3.64))      # the pendant pearl
POOL_AT = np.array((0.0, -0.1, 0.0))          # the pool she dissolves into


def _arm_bones():
    L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP)
    out = [
        ('L_Clavicle', 'Spine2', np.array((0.05, -0.02, 3.8)), L['SHOULDER']),
        ('L_UpperArm', 'L_Clavicle', L['SHOULDER'], L['ELBOW']),
        ('L_Forearm', 'L_UpperArm', L['ELBOW'], L['WRIST']),
        ('L_ElbowFix', 'L_UpperArm', L['ELBOW'], lerp(L['ELBOW'], L['WRIST'], 0.3)),
        ('L_Hand', 'L_Forearm', L['WRIST'], L['HAND_TIP']),
    ]
    for f in FINGERS:
        base, mid, tip = HAND.chain(1, f)
        out.append((f'L_{f}1', 'L_Hand', base, mid))
        out.append((f'L_{f}2', f'L_{f}1', mid, tip))
    return out


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.02, 2.82), (0, 0.02, 3.08)),
        ('Spine1', 'Hips', (0, 0.02, 3.08), (0, 0.0, 3.44)),
        ('Spine2', 'Spine1', (0, 0.0, 3.44), (0, 0.02, 3.82)),
        ('Neck', 'Spine2', (0, 0.03, 3.9), (0, 0.02, 4.24)),
        ('Head', 'Neck', (0, 0.02, 4.24), (0, 0.0, 4.74)),
        ('Bell', 'Head', tuple(BELL_C), tuple(BELL_C + BELL_AXIS * BELL_H)),
        ('BellRim', 'Bell', tuple(BELL_C), tuple(BELL_C + BELL_AXIS * 0.2)),
        ('Dart', 'R_Hand', tuple(HAND_TIP * np.array((-1, 1, 1))),
         tuple(HAND_TIP * np.array((-1, 1, 1)) + np.array((0, -0.3, 0)))),
        ('Light', 'Spine2', (0.0, -0.75, 3.35), (0.0, -0.75, 3.65)),
        ('Pool', 'Root', tuple(POOL_AT), tuple(POOL_AT + np.array((0, 0, 0.4)))),
        ('SkirtCore', 'Hips', (0, 0.04, 2.7), (0, 0.06, 0.5)),
    ]
    for k in range(SKIRT_N):
        phi = 2 * math.pi * k / SKIRT_N
        prev = 'Hips'
        for j in range(3):
            nm = f'Skirt{k}_{j + 1}'
            out.append((nm, prev, tuple(skirt_point(phi, SKIRT_Z[j])), tuple(skirt_point(phi, SKIRT_Z[j + 1]))))
            prev = nm
    for i, deg in enumerate(VEIL_ANG):
        pts = [veil_top(deg)] + [veil_point(deg, z) for z in VEIL_Z]
        prev = 'Head'
        for j in range(4):
            nm = f'Veil{i}_{j + 1}'
            out.append((nm, prev, tuple(pts[j]), tuple(pts[j + 1])))
            prev = nm
    for s, side in TENT_SIDES:
        a, b, c = tent_points(s)
        out.append((f'Tent{side}1', 'Head', tuple(a), tuple(b)))
        out.append((f'Tent{side}2', f'Tent{side}1', tuple(b), tuple(c)))
    for s, side in TENT_SIDES:
        prev = 'Hips'
        for j in range(3):
            nm = f'Frill{side}{j + 1}'
            out.append((nm, prev, tuple(frill_point(s, FRILL_Z[j])), tuple(frill_point(s, FRILL_Z[j + 1]))))
            prev = nm
    out += _arm_bones()
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.45), ('Spine2', 0.55))
LIMBS = (('L_UpperArm', 'L_Forearm'), ('R_UpperArm', 'R_Forearm'))
HELPERS = {'L_ElbowFix': 'L_Forearm', 'R_ElbowFix': 'R_Forearm'}
ROLL_LIMIT = {'L_UpperArm': 62.0, 'R_UpperArm': 62.0}
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2',
                                     'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1',
                                     'Little2'))
SOLE_Z = 0.3
GROUND = 0.1
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {'SkirtCore': 0.6, 'Spine2': 0.3}
POP_SKIP = ('Skirt', 'Veil', 'Tent', 'Frill', 'Bell', 'Dart', 'Light', 'Pool')
TREMOR_KEYS = ('Clavicle', 'UpperArm', 'Forearm', 'Hand', 'Spine', 'Neck', 'Head')
AIM_LIMITS = {'L_Hand': 80.0, 'R_Hand': 80.0}
# the props that appear only in one clip ride bones scaled to nothing elsewhere
HIDDEN = {'Dart': 0.0, 'Light': 0.0, 'Pool': 0.0}


def _chains():
    from rig import Chain
    out = []
    for k in range(SKIRT_N):
        out.append(Chain([f'Skirt{k}_{j}' for j in (1, 2, 3)], 'Hips', gravity=0.72, stiff=0.2, damp=0.16, drag=1.0))
    for i in range(len(VEIL_ANG)):
        out.append(Chain([f'Veil{i}_{j}' for j in (1, 2, 3, 4)], 'Head', gravity=0.55, stiff=0.18, damp=0.24,
                         drag=1.5, collide=True))
    for _, side in TENT_SIDES:
        out.append(Chain([f'Tent{side}1', f'Tent{side}2'], 'Head', gravity=0.45, stiff=0.2, damp=0.14, drag=1.1))
        out.append(Chain([f'Frill{side}{j}' for j in (1, 2, 3)], 'Hips', gravity=0.6, stiff=0.18, damp=0.14,
                         drag=1.2))
    return out


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


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def _sm(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def _grid(lo, hi, voxel):
    return X.grid(lo, hi, voxel)


# ------------------------------------------------------------------ the body: torso, neck, arms
def build_body(voxel):
    F = Field((-0.85, -0.5, 2.45), (0.85, 0.45, 4.36), voxel)
    # the pelvis, hidden in the skirt's top, and the narrow waist
    F.add(Ellipsoid((0, 0.03, 2.8), (0.31, 0.22, 0.26), bone='Hips'), 0.12)
    F.add(Ellipsoid((0, 0.02, 3.1), (0.205, 0.15, 0.2), bone='Spine1'), 0.12)
    # the ribcage, the bust and the upper chest
    F.add(Ellipsoid((0, 0.03, 3.48), (0.25, 0.17, 0.28), rot_matrix(rx=-0.06), bone='Spine2'), 0.12)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.105, -0.11, 3.52), s), (0.105, 0.09, 0.095), rot_matrix(rz=0.25 * s), bone='Spine2'),
              0.05)
    F.add(Ellipsoid((0, 0.05, 3.76), (0.3, 0.14, 0.11), bone='Spine2'), 0.1)
    # shoulder blades, collarbones and the slope of the shoulders
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.13, 0.15, 3.66), s), (0.11, 0.05, 0.13), bone='Spine2'), 0.06)
        F.add(RoundCone(_m((0.05, -0.05, 3.83), s), _m((0.3, 0.0, 3.86), s), 0.022, 0.03, bone=_side('Clavicle', s)),
              0.04)
        F.add(RoundCone(_m((0.06, 0.07, 3.93), s), _m((0.3, 0.05, 3.86), s), 0.055, 0.062, bone=_side('Clavicle', s)),
              0.09)
    # the long neck
    F.add(RoundCone((0, 0.05, 3.8), (0, 0.02, 4.3), 0.078, 0.07, bone='Neck'), 0.07)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.01 * s, 0, -0.01)), 0.088, bone=up), 0.06)
        F.add(RoundCone(sh, el, 0.08, 0.055, bone=up), 0.04)
        F.add(Sphere(el + np.array((0, 0.02, 0)), 0.052, bone=_side('ElbowFix', s)), 0.035)
        F.add(RoundCone(el, lerp(el, wr, 0.38), 0.054, 0.06, bone=fo), 0.03)
        F.add(RoundCone(lerp(el, wr, 0.38), wr, 0.06, 0.04, bone=fo), 0.03)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.0015 * noise.fbm(X_ * 12, Y_ * 12, Z_ * 12, octaves=2), band=0.05)
    return F


# ------------------------------------------------------------------ the face
EYE = np.array((0.066, -0.165, 4.488))


def _lid_line(s):
    """The closed eye's lash line: a gentle downward arc, inner to outer corner."""
    return [np.array((s * 0.032, -0.181, 4.49)), np.array((s * 0.066, -0.193, 4.478)),
            np.array((s * 0.1, -0.168, 4.488))]


def _head_unscaled(voxel):
    F = Field((-0.25, -0.33, 4.08), (0.25, 0.3, 4.82), voxel)
    noise = Noise(9)
    # the neck's top and the skull
    F.add(RoundCone((0, 0.03, 4.16), (0, 0.02, 4.34), 0.07, 0.072, bone='Neck'), 0.05)
    F.add(Ellipsoid((0, 0.035, 4.53), (0.155, 0.19, 0.2), bone='Head'), 0.06)
    # the face: a long oval, cheeks high and soft
    F.add(Ellipsoid((0, -0.07, 4.445), (0.138, 0.13, 0.165), bone='Head'), 0.07)
    for s in (1, -1):
        # high soft cheekbones and full, young cheeks under them
        F.add(Ellipsoid(_m((0.085, -0.15, 4.455), s), (0.045, 0.03, 0.028), rot_matrix(rz=0.3 * s), bone='Head'),
              0.04)
        F.add(Ellipsoid(_m((0.07, -0.142, 4.4), s), (0.058, 0.05, 0.055), bone='Head'), 0.06)
        # the jaw: a soft clean line from below the ear to a small rounded chin
        F.add(RoundCone(_m((0.108, -0.01, 4.38), s), _m((0.04, -0.134, 4.268), s), 0.05, 0.037, bone='Head'), 0.07)
    F.add(Ellipsoid((0, -0.145, 4.264), (0.04, 0.033, 0.032), bone='Head'), 0.045)
    # the brow: a soft ridge, the eyes set into shallow sockets under it
    F.add(Ellipsoid((0, -0.172, 4.548), (0.1, 0.03, 0.03), bone='Head'), 0.04)
    for s in (1, -1):
        F.sub(Ellipsoid(_m((0.066, -0.205, 4.492), s), (0.038, 0.024, 0.02), rot_matrix(rz=0.12 * s)), 0.03)
        # the closed lids: a full, rounded upper lid over each eye
        F.add(Ellipsoid(_m((0.066, -0.17, 4.493), s), (0.037, 0.024, 0.02), rot_matrix(rx=0.2, rz=0.1 * s),
                        bone='Head'), 0.012)
        F.add(Ellipsoid(_m((0.066, -0.168, 4.474), s), (0.032, 0.02, 0.012), bone='Head'), 0.01)
        F.groove(sdf.Polyline(_lid_line(s), [0.0018] * 3), 0.0065, k=0.004)
    # the nose: straight and fine, a soft tip, narrow wings
    F.add(RoundCone((0, -0.19, 4.49), (0, -0.226, 4.418), 0.012, 0.016, bone='Head'), 0.02)
    F.add(Sphere((0, -0.229, 4.413), 0.017, bone='Head'), 0.012)
    for s in (1, -1):
        F.add(Sphere(_m((0.016, -0.214, 4.405), s), 0.012, bone='Head'), 0.012)
        F.sub(Sphere(_m((0.011, -0.224, 4.398), s), 0.0055), 0.004)
    # the lips: a defined cupid's bow, a fuller lower lip, a closed singing mouth
    F.add(Ellipsoid((0, -0.194, 4.354), (0.03, 0.012, 0.009), rot_matrix(rx=-0.25), bone='Head'), 0.012)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.012, -0.194, 4.356), s), (0.016, 0.01, 0.008), bone='Head'), 0.008)
    F.add(Ellipsoid((0, -0.19, 4.333), (0.026, 0.013, 0.012), bone='Head'), 0.012)
    F.groove(sdf.Polyline([np.array((-0.033, -0.186, 4.346)), np.array((0, -0.204, 4.343)),
                           np.array((0.033, -0.186, 4.346))], [0.0014] * 3), 0.0035, k=0.0035)
    F.sub(Ellipsoid((0, -0.212, 4.311), (0.022, 0.008, 0.006)), 0.008)          # under the lower lip
    F.groove(sdf.Polyline([np.array((0, -0.216, 4.39)), np.array((0, -0.214, 4.366))], [0.002, 0.002]), 0.0025,
             k=0.006)                                                                # the philtrum
    # the ears, small and set back (mostly under the cowl)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.148, 0.02, 4.47), s), (0.018, 0.035, 0.05), rot_matrix(rz=-0.3 * s), bone='Head'),
              0.02)
    F.displace(lambda X_, Y_, Z_: 0.0006 * noise.fbm(X_ * 50, Y_ * 50, Z_ * 50, octaves=2), band=0.02)
    return F


class _ScaledPrim(sdf.Prim):
    def __init__(self, prim):
        self.p, self.bone = prim, prim.bone
        self.lo, self.hi = hs(prim.lo), hs(prim.hi)

    def dist(self, X_, Y_, Z_):
        o, k = HEAD_PIVOT, HEAD_SCALE
        return self.p.dist(o[0] + (X_ - o[0]) / k, o[1] + (Y_ - o[1]) / k, o[2] + (Z_ - o[2]) / k) * k


def build_head(voxel):
    """The head, drawn at true proportions and set a fifth larger about the top
    of the neck, so the face reads from the MMO camera."""
    G = _head_unscaled(voxel / HEAD_SCALE)
    lo = hs(G.lo)
    top = G.lo + (np.array(G.shape) - 1) * G.voxel
    F = Field(lo, hs(top), voxel)
    for i, x in enumerate(F.axes[0]):
        Y_, Z_ = np.meshgrid(F.axes[1], F.axes[2], indexing='ij')
        P = np.stack([np.full(Y_.size, x), Y_.ravel(), Z_.ravel()], axis=1)
        F.d[i] = (G.sample(hs_inv(P)) * HEAD_SCALE).reshape(Y_.shape).astype(np.float32)
    for prim, k in G.prims:
        F.prims.append((_ScaledPrim(prim), k))
    return F


def head_paint(obj):
    """RegLip, RegLash (the closed lash line), RegBrow, RegCheek, RegLid."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    P = hs_inv(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    front = np.clip((-y - 0.15) / 0.02, 0, 1)
    # lips: an ellipse round the mouth, tapering to the corners
    lu, lv = x / 0.037, (z - 4.344) / 0.021
    lip = np.clip((1 - (lu * lu + lv * lv)) / 0.25, 0, 1) * front
    lash = np.zeros(len(P))
    brow = np.zeros(len(P))
    lid = np.zeros(len(P))
    cheek = np.zeros(len(P))
    for s in (1, -1):
        pts = _lid_line(s)
        d = np.full(len(P), 9.0)
        for a, b in zip(pts, pts[1:]):
            dd, _ = X.seg_dist(x, y, z, a, b)
            d = np.minimum(d, dd)
        lash = np.maximum(lash, np.clip((0.0075 - d) / 0.0025, 0, 1) * front)
        # a fine silver brow, a long arch
        bx = (x * s - 0.07) / 0.05
        bz = z - (4.545 + 0.012 * (1 - bx * bx))
        brow = np.maximum(brow, np.clip((1 - bx * bx) * 3, 0, 1) * np.clip((0.0055 - np.abs(bz)) / 0.002, 0, 1)
                          * front)
        # the lid's lilac shadow above the lash line
        ex, ez = (x * s - 0.066) / 0.042, (z - 4.497) / 0.022
        lid = np.maximum(lid, np.clip((1 - (ex * ex + ez * ez)) / 0.4, 0, 1) * front)
        cx, cz = (x * s - 0.085) / 0.05, (z - 4.415) / 0.04
        cheek = np.maximum(cheek, np.clip(1 - (cx * cx + cz * cz), 0, 1) * front)
    _write(obj, {'RegLip': lip, 'RegLash': lash, 'RegBrow': brow, 'RegLid': lid, 'RegCheek': cheek})


# ------------------------------------------------------------------ the cowl under the bell
def build_cowl(voxel, Fh):
    """A close silk cowl over the crown, behind the ears and down the nape onto
    the shoulders' backs, its front edge a clean line along the hairline; a soft
    column of jelly rises from its crown into the bell's dome."""
    lo, hi = (-0.34, -0.36, 3.78), (0.34, 0.46, 5.12)
    G, Xg, Yg, Zg = _grid(lo, hi, voxel)
    P = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
    dh = Fh.sample(P).reshape(Xg.shape)
    # the nape and the shoulders' backs (outside the head's grid: a fall of cloth)
    neck = RoundCone((0, 0.07, 4.32), (0, 0.13, 3.86), 0.15, 0.24).dist(Xg, Yg, Zg)
    base = np.minimum(np.where(np.abs(dh) > 1e3, 9.0, dh), neck)
    off, th = 0.012, 0.028
    shell = np.maximum(base - (off + th), -(base - off))
    # the face stays open: in front the cowl starts at the hairline, which
    # sweeps down past the temples to behind the jaw
    o, kk = HEAD_PIVOT, HEAD_SCALE
    Xu, Yu, Zu = o[0] + (Xg - o[0]) / kk, o[1] + (Yg - o[1]) / kk, o[2] + (Zg - o[2]) / kk
    hair = 4.6 + 0.03 * np.clip(1 - np.abs(Xu) / 0.1, 0, 1) - 0.5 * np.clip(np.abs(Xu) - 0.1, 0, 1)
    keep = np.maximum(Yu - 0.005 - 0.06 * np.clip((4.3 - Zu) / 0.1, 0, 1), Zu - hair)
    d = np.maximum(shell, -keep)
    d = np.maximum(d, 3.84 - Zg)
    G.d = d.astype(np.float32)
    # the jelly column into the dome
    G.add(RoundCone((0, 0.08, 4.68), BELL_C + BELL_AXIS * (BELL_H - 0.1), 0.1, 0.05), 0.08, weight=False)
    return G


def cowl_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = ['Spine2', 'Neck', 'Head']
    W = np.zeros((len(P), 3))
    z = P[:, 2]
    h = _sm((z - 4.18) / 0.14)
    n = _sm((z - 3.92) / 0.12)
    W[:, 2] = h
    W[:, 1] = (1 - h) * n
    W[:, 0] = (1 - h) * (1 - n)
    W = R.relax(W, E, iters=3)
    R.write_groups(obj, names, R.cap4(W))


# ------------------------------------------------------------------ hands
def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.1, w + down * 0.4) - 0.14
    hi = np.maximum(w - down * 0.1, w + down * 0.4) + 0.14
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.06, w + down * 0.02, 0.034, 0.032, bone=hand), 0.02)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(Ellipsoid(w + down * 0.07, (0.045, 0.018, 0.06), Rm, bone=hand), 0.02)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.02
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.88, bone=b1), 0.008)
        F.add(RoundCone(mid, tip, r0 * 0.86, r0 * 0.6, bone=b2), 0.006)
    return F


# ------------------------------------------------------------------ the nacre bodice and cuffs
def layers(Fb, voxel):
    rg = X.ramp
    out = []
    noise = Noise(31)
    dent = lambda X_, Y_, Z_: 0.0015 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2)  # noqa: E731

    def bod_mask(X_, Y_, Z_):
        # a sweetheart neckline over the bust, dipping between the breasts;
        # a point at the front of the waist, over the skirt's top
        ax = np.abs(X_)
        top = 3.585 + 0.05 * np.exp(-((ax - 0.11) / 0.07) ** 2) - 0.04 * np.exp(-(ax / 0.035) ** 2)
        top = np.where(Y_ > 0.0, 3.6 + 0.0 * ax, top)
        bot = 2.86 - 0.12 * np.exp(-(ax / 0.1) ** 2) * (Y_ < 0)
        return rg(Z_, bot, bot + 0.03) * (1 - rg(Z_, top - 0.02, top + 0.01))

    def bod_thick(X_, Y_, Z_):
        # carved bands: a rib of nacre every 0.11 down the waist
        s = np.sin((Z_ / 0.11) * math.tau)
        return 0.024 + 0.008 * np.clip(s, 0, 1) * (Z_ < 3.4) + 0.01 * rg(Z_, 3.5, 3.56)

    G = X.layer_field(Fb, (-0.4, -0.35, 2.6), (0.4, 0.3, 3.7), voxel, 0.006, bod_thick, bod_mask, noise=dent)
    out.append(('Bodice', G, 'nacre', 'transfer', '', ('Hips', 'Spine1', 'Spine2')))
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)

        def cu_mask(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return rg(u, 0.62, 0.67) * (1 - rg(u, 0.93, 0.97)) * rg(d, 0.14, 0.1)

        def cu_thick(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return 0.016 + 0.008 * (rg(u, 0.64, 0.67) * (1 - rg(u, 0.69, 0.72)) + rg(u, 0.9, 0.93))
        G = X.layer_field(Fb, np.minimum(el, wr) - 0.2, np.maximum(el, wr) + 0.2, voxel * 0.8, 0.004, cu_thick,
                          cu_mask)
        out.append((_side('Cuff', s), G, 'nacre', 'rigid', _side('Forearm', s), None))
    return out


def bodice_paint(obj):
    """RegGlyph: a crescent cradling a full moon, cut in the bodice's front."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    front = P[:, 1] < -0.1
    u, v = P[:, 0], P[:, 2] - 3.2
    r = np.sqrt(u * u + v * v)
    cres = np.clip((0.085 - r) / 0.006, 0, 1) * np.clip((np.sqrt(u * u + (v - 0.04) ** 2) - 0.072) / 0.006, 0, 1)
    moon = np.clip((0.03 - np.sqrt(u * u + (v + 0.005) ** 2)) / 0.006, 0, 1)
    band = np.clip(1 - np.abs(P[:, 2] - 3.555) / 0.012, 0, 1)
    _write(obj, {'RegGlyph': np.maximum(cres, moon) * front, 'RegBand': band})


# ------------------------------------------------------------------ the bell
def _bell_local(Xg, Yg, Zg):
    px, py, pz = Xg - BELL_C[0], Yg - BELL_C[1], Zg - BELL_C[2]
    a = px * BELL_SIDE[0] + py * BELL_SIDE[1] + pz * BELL_SIDE[2]
    b = px * BELL_FRONT[0] + py * BELL_FRONT[1] + pz * BELL_FRONT[2]
    u = px * BELL_AXIS[0] + py * BELL_AXIS[1] + pz * BELL_AXIS[2]
    return a, b, u


LAPPETS = 16


def build_bell(voxel):
    """The moon jelly's bell: a thick dome of jelly, a flared lip, sixteen
    rounded lappets round the margin, the radial canals raised faintly."""
    lo = BELL_C - 0.95
    hi = BELL_C + 0.95
    lo[2] = 4.0
    hi[2] = 5.45
    G, Xg, Yg, Zg = _grid(lo, hi, voxel)
    a, b, u = _bell_local(Xg, Yg, Zg)
    rho = np.sqrt(a * a + b * b)
    phi = np.arctan2(a, b)
    R, H = BELL_R, BELL_H
    # the outer dome: an ellipse profile flaring out at the lip
    flare = 0.05 * np.exp(-((u + 0.02) / 0.09) ** 2)
    ro = R + flare
    e = np.sqrt((rho / ro) ** 2 + (np.maximum(u, 0) / H) ** 2)
    outer = (e - 1.0) * 0.62
    # the inner (subumbrella) surface: thick at the top, thin at the lip
    ei = np.sqrt((rho / (R - 0.05)) ** 2 + (np.maximum(u + 0.02, 0) / (H - 0.11)) ** 2)
    inner = (ei - 1.0) * 0.56
    d = np.maximum(outer, -inner)
    # the margin: rounded lappets hanging below the lip plane, notched between
    lap = 0.5 - 0.5 * np.cos(phi * LAPPETS)
    cut = -0.075 + 0.07 * lap ** 0.7
    d = np.maximum(d, (cut - u) * 0.8)
    G.d = d.astype(np.float32)
    # raised radial canals, faint, and the ring canal near the margin
    for k in range(LAPPETS):
        ph = 2 * math.pi * (k + 0.5) / LAPPETS
        pts = []
        for i in range(9):
            t = i / 8
            uu = H * (1 - t) * 0.98
            rr = R * np.sqrt(max(0.0, 1 - (uu / H) ** 2)) + 0.004
            pts.append(BELL_C + BELL_AXIS * uu + rr * (BELL_FRONT * math.cos(ph) + BELL_SIDE * math.sin(ph)))
        G.ridge(sdf.Polyline(pts[2:-1], [0.003] * 6), 0.003, k=0.008)
    noise = Noise(17)
    G.displace(lambda X_, Y_, Z_: 0.002 * noise.fbm(X_ * 9, Y_ * 9, Z_ * 9, octaves=3), band=0.05)
    return G


def bell_paint(obj):
    """RegRing (the four glowing gonad rings), RegCanal (radial and ring canals),
    RegRhop (the eight sense spots at the margin), RegIn (the underside),
    RegTop (how far up the dome)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    a, b, u = _bell_local(P[:, 0], P[:, 1], P[:, 2])
    rho = np.sqrt(a * a + b * b)
    phi = np.arctan2(a, b)
    R, H = BELL_R, BELL_H
    # outer or inner surface: the outer ellipse value near 1
    e = np.sqrt((rho / R) ** 2 + (np.maximum(u, 0) / H) ** 2)
    inner = (e < 0.9) & (u > -0.01)
    # rings: seen from above, four horseshoes round the apex (projected on the
    # dome's plan), each open toward the margin
    ring = np.zeros(len(P))
    pr = rho / R
    xs, ys = pr * np.sin(phi), pr * np.cos(phi)
    for k in range(4):
        ang = math.pi / 4 + k * math.pi / 2
        cx, cy = 0.42 * math.sin(ang), 0.42 * math.cos(ang)
        dx, dy = xs - cx, ys - cy
        r = np.sqrt(dx * dx + dy * dy)
        band = np.clip(1 - np.abs(r - 0.2) / 0.05, 0, 1)
        # open on the outward side (a horseshoe)
        out_dot = (dx * math.sin(ang) + dy * math.cos(ang)) / np.maximum(r, 1e-6)
        band = band * np.clip((0.75 - out_dot) / 0.25, 0, 1)
        ring = np.maximum(ring, band)
    ring = ring * (~inner)
    canal = np.zeros(len(P))
    for k in range(LAPPETS):
        ph = 2 * math.pi * (k + 0.5) / LAPPETS
        dphi = np.abs(((phi - ph) + math.pi) % (2 * math.pi) - math.pi)
        canal = np.maximum(canal, np.clip(1 - dphi * rho / 0.008, 0, 1) * np.clip((pr - 0.55) / 0.15, 0, 1))
    rhop = np.zeros(len(P))
    for k in range(8):
        ph = 2 * math.pi * k / 8
        q = BELL_C + R * 0.985 * (BELL_FRONT * math.cos(ph) + BELL_SIDE * math.sin(ph)) + BELL_AXIS * 0.0
        dd = np.linalg.norm(P - q, axis=1)
        rhop = np.maximum(rhop, np.clip((0.035 - dd) / 0.012, 0, 1))
    _write(obj, {'RegRing': ring, 'RegCanal': canal * (~inner), 'RegRhop': rhop, 'RegIn': inner.astype(float),
                 'RegTop': np.clip(u / H, 0, 1)})


def bell_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    _, _, u = _bell_local(P[:, 0], P[:, 1], P[:, 2])
    W = np.zeros((len(P), 2))
    rim = 1 - _sm((u - 0.12) / 0.3)
    W[:, 1] = rim
    W[:, 0] = 1 - rim
    W = R.relax(W, E, iters=2)
    R.write_groups(obj, ['Bell', 'BellRim'], R.cap4(W))


# ------------------------------------------------------------------ hanging layers: weights
def _polyline_param(P, pts):
    best_d = np.full(len(P), 9e9)
    best_s = np.zeros(len(P))
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        m = d < best_d
        best_d[m] = d[m]
        best_s[m] = i + t[m]
    return best_d, best_s


def hang_weights(obj, chains, parent, n_near=2, parent_band=0.5):
    """Smooth weights over follow-through chains: each vertex shares the two
    nearest chains (by distance to their rest polylines); along a chain it
    blends between bone centres; above the first bone's centre it fades into
    `parent` (the hem hangs, the top stays sewn)."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    names = [parent] + [b for ch in chains for b in ch]
    col = {n: i for i, n in enumerate(names)}
    W = np.zeros((len(P), len(names)))
    D, S = [], []
    for ch in chains:
        pts = [REST[ch[0]][0]] + [REST[b][1] for b in ch]
        d, s = _polyline_param(P, pts)
        D.append(d)
        S.append(s)
    D, S = np.array(D), np.array(S)
    order = np.argsort(D, axis=0)[:n_near]
    for r in range(n_near):
        ci = order[r]
        d = D[ci, np.arange(len(P))]
        s = S[ci, np.arange(len(P))]
        w_ch = 1.0 / (d + 0.03) ** 2
        for j in range(max(len(c) for c in chains)):
            centre = j + 0.5
            hat = np.clip(1 - np.abs(s - centre), 0, 1)
            if j == 0:
                hat = np.where(s < centre, 1.0, hat)
            last = np.array([len(chains[c]) - 1 for c in ci])
            hat = np.where((j == last) & (s > centre), 1.0, hat)
            for c in np.unique(ci):
                if j >= len(chains[c]):
                    continue
                m = ci == c
                W[m, col[chains[c][j]]] += w_ch[m] * hat[m]
        pw = np.clip(1 - S[ci, np.arange(len(P))] / parent_band, 0, 1)
        W[:, 0] += w_ch * pw * 1.6
    W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    W = R.relax(W, E, iters=2)
    R.write_groups(obj, names, R.cap4(W))


SKIRT_CHAINS = [[f'Skirt{k}_{j}' for j in (1, 2, 3)] for k in range(SKIRT_N)]
VEIL_CHAINS = [[f'Veil{i}_{j}' for j in (1, 2, 3, 4)] for i in range(len(VEIL_ANG))]
TENT_CHAINS = [[f'Tent{s}1', f'Tent{s}2'] for _, s in TENT_SIDES]
FRILL_CHAINS = [[f'Frill{s}{j}' for j in (1, 2, 3)] for _, s in TENT_SIDES]


# ------------------------------------------------------------------ the skirt
def _hem_z(phi):
    return 0.3 + 0.05 * np.abs(np.sin(phi * 6)) ** 0.8


def build_skirt(voxel):
    G, Xg, Yg, Zg = _grid((-1.05, -1.0, 0.18), (1.05, 1.0, 3.05), voxel)
    phi = np.arctan2(Xg, -(Yg - 0.02))
    r, sq = skirt_radius(Zg)
    t = np.clip((2.95 - Zg) / 2.65, 0, 1)
    # soft vertical folds, deeper toward the hem, the cloth falling in pleats
    fold = (0.028 * np.sin(phi * 11 + 0.6 * np.sin(phi * 3)) + 0.012 * np.sin(phi * 23 + 1.3)) * t ** 0.8
    rr = np.sqrt(Xg ** 2 + ((Yg - 0.02) / sq) ** 2)
    d = (rr - (r + fold)) * 0.8
    shell = np.abs(d) - 0.016
    shell = np.maximum(shell, _hem_z(phi) - Zg)
    shell = np.maximum(shell, Zg - 2.98)
    G.d = shell.astype(np.float32)
    noise = Noise(23)
    G.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 0.8, octaves=3), band=0.05)
    return G


def skirt_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    phi = np.arctan2(P[:, 0], -(P[:, 1] - 0.02))
    hem = np.clip(1 - (P[:, 2] - _hem_z(phi)) / 0.1, 0, 1)
    # the tentacles' light seen through the silk: faint vertical threads
    thread = np.clip(1 - np.abs(np.sin(phi * 9 + 0.4 * np.sin(P[:, 2] * 2.0))) / 0.18, 0, 1) * \
        np.clip((2.6 - P[:, 2]) / 0.6, 0, 1)
    _write(obj, {'RegHem': hem, 'RegThread': thread, 'RegZ': np.clip(P[:, 2] / 3.0, 0, 1)})


def skirt_weights(obj):
    hang_weights(obj, SKIRT_CHAINS, 'Hips', parent_band=0.6)


# ------------------------------------------------------------------ the frilled oral arms (front panels)
def build_frills(voxel):
    """The two frilled oral arms down the front of the skirt: long ribbons of
    jelly a hand out from the silk, their side edges ruffled, widening to the
    hem."""
    G, Xg, Yg, Zg = _grid((-0.7, -1.35, 0.15), (0.7, -0.1, 3.05), voxel)
    d = np.full(Xg.shape, 9.0)
    for s in (1, -1):
        pts = [frill_point(s, z) for z in FRILL_Z]
        zs = np.array([p[2] for p in pts])[::-1]
        xs = np.array([p[0] for p in pts])[::-1]
        ys = np.array([p[1] for p in pts])[::-1]
        xc = np.interp(Zg, zs, xs)
        hz = np.clip((2.98 - Zg) / 2.7, 0, 1)
        yc = np.interp(Zg, zs, ys) - 0.03 * hz
        w = 0.06 + 0.11 * hz ** 0.7
        lx = (Xg - xc) * s
        edge = np.clip(np.abs(lx) / w, 0, 1.2)
        ruf = (0.03 + 0.04 * hz) * np.sin(Zg * 12 + lx * 4) * edge ** 2.2
        # the ribbon curves round the skirt: its edges lie back toward the silk
        bend = 0.0
        dy = np.abs(Yg - (yc + ruf + bend)) - 0.024
        dx = np.abs(lx) - w
        bottom = (0.24 + 0.04 * np.abs(np.sin(lx * 22))) - Zg
        di = np.maximum(np.maximum(dy, dx * 0.6), np.maximum(bottom, Zg - 2.98))
        d = np.minimum(d, di)
    G.d = d.astype(np.float32)
    return G


def frill_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    edge = np.zeros(len(P))
    for s in (1, -1):
        pts = [frill_point(s, z) for z in FRILL_Z]
        zs = np.array([p[2] for p in pts])[::-1]
        xs = np.array([p[0] for p in pts])[::-1]
        xc = np.interp(P[:, 2], zs, xs)
        hz = np.clip((2.98 - P[:, 2]) / 2.7, 0, 1)
        w = 0.06 + 0.11 * hz ** 0.7
        e = np.clip((np.abs(P[:, 0] - xc) / w - 0.72) / 0.25, 0, 1) * (np.sign(P[:, 0]) == s)
        edge = np.maximum(edge, e)
    _write(obj, {'RegEdge': edge, 'RegZ': np.clip(P[:, 2] / 3.0, 0, 1)})


def frill_weights(obj):
    hang_weights(obj, FRILL_CHAINS, 'Hips', n_near=1, parent_band=0.6)


# ------------------------------------------------------------------ the veil
def build_veil(voxel):
    """The jellyfish's frilled arms as a veil: five long ribbons of semi-sheer
    frill falling from under the bell's back margin to the floor, each widening
    and ruffling toward its hem, with gaps between them."""
    G, Xg, Yg, Zg = _grid((-1.3, -0.1, 0.03), (1.3, 1.4, 4.62), voxel)
    d = np.full(Xg.shape, 9.0)
    for i, deg in enumerate(VEIL_ANG):
        pts = np.array([veil_top(deg)] + [veil_point(deg, z) for z in VEIL_Z])
        zs, xs, ys = pts[::-1, 2], pts[::-1, 0], pts[::-1, 1]
        xc = np.interp(Zg, zs, xs)
        yc = np.interp(Zg, zs, ys)
        a = math.radians(deg)
        tang = np.array((math.cos(a), -math.sin(a)))      # across the ribbon (round the body)
        nrm = np.array((math.sin(a), math.cos(a)))         # out from the body
        dx, dy = Xg - xc, Yg - yc
        lx = dx * tang[0] + dy * tang[1]
        ly = dx * nrm[0] + dy * nrm[1]
        t = np.clip((pts[0, 2] - Zg) / (pts[0, 2] - 0.1), 0, 1)
        w = 0.07 + 0.17 * t ** 0.8
        edge = np.clip(np.abs(lx) / w, 0, 1.2)
        ruf = (0.02 + 0.04 * t) * np.sin(Zg * 11 + lx * 5 + i * 1.7) * edge ** 1.8 + 0.03 * np.sin(Zg * 3 + i) * t
        di = np.maximum(np.abs(ly - ruf) - 0.02, (np.abs(lx) - w) * 0.7)
        hem = 0.06 + 0.05 * np.abs(np.sin(lx * 25)) - Zg
        di = np.maximum(di, np.maximum(hem, Zg - pts[0, 2] - 0.02))
        d = np.minimum(d, di)
    G.d = d.astype(np.float32)
    return G


def veil_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    edge = np.zeros(len(P))
    for deg in VEIL_ANG:
        pts = np.array([veil_top(deg)] + [veil_point(deg, z) for z in VEIL_Z])
        d, s = _polyline_param(P, list(pts))
        t = np.clip((pts[0, 2] - P[:, 2]) / (pts[0, 2] - 0.1), 0, 1)
        w = 0.07 + 0.17 * t ** 0.8
        edge = np.maximum(edge, np.clip((d / w - 0.7) / 0.25, 0, 1) * (d < w * 1.3))
    hem = np.clip(1 - (P[:, 2] - 0.06) / 0.14, 0, 1)
    _write(obj, {'RegHem': np.maximum(hem, edge * 0.7), 'RegEdge': edge, 'RegZ': np.clip(P[:, 2] / 4.5, 0, 1),
                 'RegThread': np.zeros(len(P))})


def veil_weights(obj):
    hang_weights(obj, VEIL_CHAINS, 'Head', parent_band=0.3)


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand = 0.011 * k, 0.0042 * k, 0.0042 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    S = [Sculpt('Body', Fb, 'skin', 5200, spots=[((0, -0.12, 3.5), 0.25, 0.5)], tau=0.04),
         Sculpt('Head', Fh, 'skin', 5200, spots=[((0, -0.2, 4.42), 0.14, 1.0)], tau=0.015, paint=head_paint),
         Sculpt('L_Hand', build_hand(1, vhand), 'skin', 900, tau=0.008),
         Sculpt('R_Hand', build_hand(-1, vhand), 'skin', 900, tau=0.008)]
    for name, G, mat, binding, bone, allow in layers(Fb, 0.0065 * k):
        target = 1700 if name == 'Bodice' else 300
        S.append(Sculpt(name, G, mat, target, binding=binding, bone=bone, allow=allow, relax=6,
                        paint=bodice_paint if name == 'Bodice' else None))
    S.append(Sculpt('Cowl', build_cowl(0.008 * k, Fh), 'silk', 1100, binding='own', weigh=cowl_weights))
    S.append(Sculpt('Bell', build_bell(0.011 * k), 'bell', 3600, binding='own', weigh=bell_weights,
                    paint=bell_paint))
    S.append(Sculpt('Skirt', build_skirt(0.015 * k), 'silk', 3000, binding='own', weigh=skirt_weights,
                    paint=skirt_paint))
    S.append(Sculpt('Frills', build_frills(0.011 * k), 'frill', 1800, binding='own', weigh=frill_weights,
                    paint=frill_paint))
    S.append(Sculpt('Veil', build_veil(0.011 * k), 'veil', 3200, binding='own', weigh=veil_weights,
                    paint=veil_paint))
    return S
