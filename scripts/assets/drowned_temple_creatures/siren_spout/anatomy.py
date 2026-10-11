"""Moonlit Siren: skeleton and sculpts (rest pose), in yards.

A priestess of the moon choir the temple's water remade: a tall, slender,
regal woman whose body becomes a fish tail below the waist. She never crawls:
a living waterspout of moonlit water winds round her tail from the floor to
her hips and holds her upright, so she rides it like a candle in its flame.
Long silver hair floats round her head as if she were still under the sea;
fins sweep back where her ears were; a silver crescent crown hangs strings of
pearls over her brow and temples. Fine nacre scales on the shoulders, a
carved nacre bodice, a girdle of pearls where the skin turns to scale. Two
long veil fins fall from her hips like the side panels of a gown, and the
tail ends in a broad fluke curled just above the floor. In her right hand a
staff of white coral taller than she is, crowned with a crescent cradle that
holds a moon pearl.

Axes: yards, +Z up, faces -Y, her left is +X. Rest is an A-pose. Head top
about 4.85; the staff's pearl about 5.2 (scaled in game to 6.0 drawn).
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere, frame_from, rot_matrix

NAME = 'MoonlitSiren'
PREFIX = 'siren'

SHOULDER = np.array((0.37, 0.04, 3.85))
ELBOW = np.array((0.52, 0.1, 3.27))
WRIST = np.array((0.62, 0.02, 2.76))
HAND_TIP = np.array((0.665, -0.05, 2.49))
HEAD_PIVOT = np.array((0.0, 0.02, 4.26))
HEAD_SCALE = 1.2


def hs(p):
    """A rest point of the head sculpt, enlarged about the top of the neck."""
    return HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) * HEAD_SCALE


def hs_inv(p):
    return HEAD_PIVOT + (np.asarray(p, float) - HEAD_PIVOT) / HEAD_SCALE


HEAD_C = hs((0.0, 0.02, 4.5))

HAND = B.Hand(WRIST, HAND_TIP, 0.14, {
    'Index': (0.036, 0.08, 0.0, 0.09, 0.018),
    'Middle': (0.012, 0.02, 0.006, 0.1, 0.0185),
    'Ring': (-0.012, -0.05, 0.0, 0.093, 0.0175),
    'Little': (-0.033, -0.12, -0.012, 0.074, 0.015),
}, thumb=((0.042, 0.035, 0.03), (0.5, 0.65, 0.55), 0.068, 0.058))
FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Little')
FINGER_FAN = {'Index': 1.0, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1.0}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


# ------------------------------------------------------------------ the coral staff in the right fist
_w, _d, _wd, _p = HAND.frame(-1)
GRIP_R = _w + _d * 0.13 + _p * 0.045
WEAPON_AXIS = tuple(unit(_wd + _d * 0.3))
WEAPON_REF = WEAPON_AXIS
_wl, _dl, _wdl, _pl = HAND.frame(1)
WEAPON_REF_L = tuple(unit(_wdl + _dl * 0.3))
GRIP_OFFSET_L = tuple(_dl * 0.13 + _pl * 0.045)
HAFT_BELOW, HAFT_ABOVE = 2.3, 2.05          # butt and crescent horn tips from the right fist
PEARL_Z, PEARL_R = 1.82, 0.135               # the moon pearl in the cradle (staff-local z)
WEAPON_PROBES = (-HAFT_BELOW, 0.8, HAFT_ABOVE)


def staff_matrix():
    """The staff's local frame set in the right fist: +Z up the haft, the
    crescent's horns spread across the palm's normal (held upright, the
    crescent faces forward)."""
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


# ------------------------------------------------------------------ the tail, its fins, the hair
TAIL_PTS = [np.array(p) for p in ((0, 0.03, 2.86), (0, 0.04, 2.15), (0, 0.08, 1.45), (0, 0.1, 0.9),
                                  (0, 0.05, 0.5), (0, -0.04, 0.16))]
# the tail's half-widths (x) and depth squash down its length
TAIL_PROF = ((3.08, 0.17), (2.95, 0.235), (2.7, 0.3), (2.4, 0.295), (1.9, 0.245), (1.4, 0.19), (0.95, 0.135),
             (0.62, 0.09), (0.46, 0.07))
FIN_PTS = [np.array(p) for p in ((0.28, 0.1, 2.8), (0.42, 0.16, 2.05), (0.52, 0.22, 1.28), (0.58, 0.28, 0.52))]
HAIR_ANG = (-66.0, -45.0, -25.0, -8.0, 8.0, 25.0, 45.0, 66.0)   # degrees from straight back, + toward her left


def hair_points(deg):
    """A floating lock's rest path: out of the back of the head, drifting out as
    if under water, then falling in a slow wave toward the middle of the back."""
    a = math.radians(deg)
    back = np.array((math.sin(a), math.cos(a), 0.0))
    top = hs((0.1 * math.sin(a), 0.07 + 0.1 * math.cos(a), 4.53 - 0.05 * abs(math.sin(a))))
    up = np.array((0.0, 0.0, 1.0))
    sp = 1.0 + 0.25 * abs(math.sin(a))
    return [top, top + back * 0.26 * sp - up * 0.06, top + back * 0.4 * sp - up * 0.52,
            top + back * 0.46 * sp - up * 1.36 + np.array((0, 0.06, 0))]


SPOUT_TOP = 2.62
POOL_AT = np.array((0.0, -0.05, 0.0))
BUBBLES = [np.array(p) for p in ((0.42, -0.36, 1.35), (-0.46, -0.3, 1.75), (0.06, 0.48, 1.55))]
BAKE_CAGE, BAKE_RAY = 0.02, 0.07


def _arm_bones():
    out = [
        ('L_Clavicle', 'Spine2', np.array((0.05, -0.02, 3.8)), SHOULDER),
        ('L_UpperArm', 'L_Clavicle', SHOULDER, ELBOW),
        ('L_Forearm', 'L_UpperArm', ELBOW, WRIST),
        ('L_ElbowFix', 'L_UpperArm', ELBOW, lerp(ELBOW, WRIST, 0.3)),
        ('L_Hand', 'L_Forearm', WRIST, HAND_TIP),
    ]
    for f in FINGERS:
        base, mid, tip = HAND.chain(1, f)
        out.append((f'L_{f}1', 'L_Hand', base, mid))
        out.append((f'L_{f}2', f'L_{f}1', mid, tip))
    return out


def _bones():
    pearl = staff_point((0, 0, PEARL_Z))
    ax = np.array(WEAPON_AXIS)
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.02, 2.82), (0, 0.02, 3.08)),
        ('Spine1', 'Hips', (0, 0.02, 3.08), (0, 0.0, 3.44)),
        ('Spine2', 'Spine1', (0, 0.0, 3.44), (0, 0.02, 3.82)),
        ('Neck', 'Spine2', (0, 0.03, 3.9), (0, 0.02, 4.24)),
        ('Head', 'Neck', (0, 0.02, 4.24), (0, 0.0, 4.74)),
        ('Weapon', 'R_Hand', tuple(GRIP_R), tuple(GRIP_R + ax * 1.0)),
        ('Flare', 'Weapon', tuple(pearl), tuple(pearl + ax * 0.3)),
        ('Spout', 'Root', (0, 0, 0), (0, 0, 1.0)),
        ('Pool', 'Root', tuple(POOL_AT), tuple(POOL_AT + np.array((0, 0, 0.4)))),
    ]
    for i, b in enumerate(BUBBLES):
        out.append((f'Bubble{i}', 'Root', tuple(b), tuple(b + np.array((0, 0, 0.3)))))
    prev = 'Hips'
    for i in range(5):
        out.append((f'Tail{i + 1}', prev, tuple(TAIL_PTS[i]), tuple(TAIL_PTS[i + 1])))
        prev = f'Tail{i + 1}'
    prev = 'Hips'
    for j in range(3):
        out.append((f'L_Fin{j + 1}', prev, tuple(FIN_PTS[j]), tuple(FIN_PTS[j + 1])))
        prev = f'L_Fin{j + 1}'
    for i, deg in enumerate(HAIR_ANG):
        pts = hair_points(deg)
        prev = 'Head'
        for j in range(3):
            nm = f'Hair{i}_{j + 1}'
            out.append((nm, prev, tuple(pts[j]), tuple(pts[j + 1])))
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
GROUND = 0.06
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {'Spine2': 0.3, 'Spine1': 0.28}
POP_SKIP = ('Tail', 'Fin', 'L_Fin', 'R_Fin', 'Hair', 'Weapon', 'Flare', 'Spout', 'Pool', 'Bubble')
TREMOR_KEYS = ('Clavicle', 'UpperArm', 'Forearm', 'Hand', 'Spine', 'Neck', 'Head')
AIM_LIMITS = {'L_Hand': 80.0, 'R_Hand': 80.0}
# the props that appear only in one clip ride bones scaled to nothing elsewhere
HIDDEN = {'Flare': 0.0, 'Pool': 0.0, 'Bubble0': 0.0, 'Bubble1': 0.0, 'Bubble2': 0.0}

TAIL_CHAIN = [f'Tail{i}' for i in range(1, 6)]
FIN_CHAINS = [[f'{s}_Fin{j}' for j in (1, 2, 3)] for s in ('L', 'R')]
HAIR_CHAINS = [[f'Hair{i}_{j}' for j in (1, 2, 3)] for i in range(len(HAIR_ANG))]


def _chains():
    from rig import Chain
    out = [Chain(TAIL_CHAIN[:4], 'Hips', gravity=0.0, stiff=0.45, damp=0.35, drag=0.4)]
    for ch in FIN_CHAINS:
        out.append(Chain(ch, 'Hips', gravity=0.35, stiff=0.2, damp=0.18, drag=1.2))
    for ch in HAIR_CHAINS:
        out.append(Chain(ch, 'Head', gravity=0.08, stiff=0.22, damp=0.2, drag=1.3))
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


# ------------------------------------------------------------------ the body: torso, neck, arms
def build_body(voxel):
    F = Field((-0.88, -0.5, 2.6), (0.88, 0.45, 4.36), voxel)
    F.add(Ellipsoid((0, 0.03, 2.86), (0.25, 0.19, 0.24), bone='Hips'), 0.12)
    F.add(Ellipsoid((0, 0.02, 3.12), (0.2, 0.145, 0.2), bone='Spine1'), 0.12)
    F.add(Ellipsoid((0, 0.03, 3.48), (0.255, 0.17, 0.28), rot_matrix(rx=-0.06), bone='Spine2'), 0.12)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.105, -0.11, 3.52), s), (0.105, 0.09, 0.095), rot_matrix(rz=0.25 * s), bone='Spine2'),
              0.05)
    F.add(Ellipsoid((0, 0.05, 3.76), (0.31, 0.14, 0.11), bone='Spine2'), 0.1)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.13, 0.15, 3.66), s), (0.11, 0.05, 0.13), bone='Spine2'), 0.06)
        F.add(RoundCone(_m((0.05, -0.05, 3.83), s), _m((0.31, 0.0, 3.86), s), 0.022, 0.03, bone=_side('Clavicle', s)),
              0.04)
        F.add(RoundCone(_m((0.06, 0.07, 3.93), s), _m((0.31, 0.05, 3.86), s), 0.056, 0.064, bone=_side('Clavicle', s)),
              0.09)
    F.add(RoundCone((0, 0.05, 3.8), (0, 0.02, 4.3), 0.08, 0.071, bone='Neck'), 0.07)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.01 * s, 0, -0.01)), 0.09, bone=up), 0.06)
        F.add(RoundCone(sh, el, 0.082, 0.056, bone=up), 0.04)
        F.add(Sphere(el + np.array((0, 0.02, 0)), 0.053, bone=_side('ElbowFix', s)), 0.035)
        F.add(RoundCone(el, lerp(el, wr, 0.38), 0.055, 0.061, bone=fo), 0.03)
        F.add(RoundCone(lerp(el, wr, 0.38), wr, 0.061, 0.041, bone=fo), 0.03)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.0015 * noise.fbm(X_ * 12, Y_ * 12, Z_ * 12, octaves=2), band=0.05)
    return F


def body_paint(obj):
    """RegScale: where fine nacre scales show through the skin (the shoulders'
    caps, down the outside of the upper arms, the flanks above the girdle)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    sh = np.clip((ax - 0.22) / 0.1, 0, 1) * np.clip((z - 3.2) / 0.3, 0, 1) * np.clip((4.0 - z) / 0.08, 0, 1)
    flank = np.clip((ax - 0.13) / 0.06, 0, 1) * np.clip((3.3 - z) / 0.12, 0, 1) * np.clip((z - 2.85) / 0.05, 0, 1)
    _write(obj, {'RegScale': np.maximum(sh, flank)})


# ------------------------------------------------------------------ the face
EYE = np.array((0.066, -0.165, 4.488))


def _lid_line(s):
    """The narrow eye's slit: a gentle almond, inner to outer corner, a little
    upswept (cold, not asleep)."""
    return [np.array((s * 0.032, -0.181, 4.488)), np.array((s * 0.066, -0.193, 4.482)),
            np.array((s * 0.104, -0.17, 4.5))]


def _head_unscaled(voxel):
    F = Field((-0.25, -0.33, 4.08), (0.25, 0.3, 4.82), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, 0.03, 4.16), (0, 0.02, 4.34), 0.07, 0.072, bone='Neck'), 0.05)
    F.add(Ellipsoid((0, 0.035, 4.53), (0.155, 0.19, 0.2), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.07, 4.445), (0.135, 0.13, 0.168), bone='Head'), 0.07)
    for s in (1, -1):
        # high, sharp cheekbones; leaner cheeks than the acolyte's
        F.add(Ellipsoid(_m((0.088, -0.15, 4.46), s), (0.048, 0.03, 0.026), rot_matrix(rz=0.35 * s), bone='Head'),
              0.035)
        F.add(Ellipsoid(_m((0.068, -0.138, 4.395), s), (0.052, 0.045, 0.05), bone='Head'), 0.06)
        F.add(RoundCone(_m((0.108, -0.01, 4.38), s), _m((0.038, -0.136, 4.262), s), 0.048, 0.034, bone='Head'), 0.07)
    F.add(Ellipsoid((0, -0.147, 4.26), (0.038, 0.033, 0.033), bone='Head'), 0.045)
    F.add(Ellipsoid((0, -0.172, 4.548), (0.1, 0.03, 0.03), bone='Head'), 0.04)
    for s in (1, -1):
        F.sub(Ellipsoid(_m((0.066, -0.205, 4.492), s), (0.04, 0.024, 0.02), rot_matrix(rz=0.18 * s)), 0.03)
        # heavy lids over narrow eyes: the slit between them glows
        F.add(Ellipsoid(_m((0.066, -0.172, 4.498), s), (0.038, 0.024, 0.018), rot_matrix(rx=0.25, rz=0.16 * s),
                        bone='Head'), 0.012)
        F.add(Ellipsoid(_m((0.066, -0.169, 4.474), s), (0.033, 0.02, 0.011), bone='Head'), 0.01)
        F.groove(sdf.Polyline(_lid_line(s), [0.0022] * 3), 0.008, k=0.005)
    F.add(RoundCone((0, -0.19, 4.49), (0, -0.228, 4.416), 0.012, 0.015, bone='Head'), 0.02)
    F.add(Sphere((0, -0.23, 4.412), 0.016, bone='Head'), 0.012)
    for s in (1, -1):
        F.add(Sphere(_m((0.016, -0.215, 4.405), s), 0.011, bone='Head'), 0.012)
        F.sub(Sphere(_m((0.011, -0.225, 4.398), s), 0.0055), 0.004)
    # the lips: parted a little (she is always half singing)
    F.add(Ellipsoid((0, -0.195, 4.357), (0.03, 0.012, 0.009), rot_matrix(rx=-0.25), bone='Head'), 0.012)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.012, -0.195, 4.359), s), (0.016, 0.01, 0.008), bone='Head'), 0.008)
    F.add(Ellipsoid((0, -0.191, 4.33), (0.027, 0.013, 0.012), bone='Head'), 0.012)
    F.sub(Ellipsoid((0, -0.205, 4.344), (0.022, 0.012, 0.0045)), 0.004)
    F.sub(Ellipsoid((0, -0.213, 4.308), (0.022, 0.008, 0.006)), 0.008)
    F.groove(sdf.Polyline([np.array((0, -0.217, 4.39)), np.array((0, -0.215, 4.368))], [0.002, 0.002]), 0.0025,
             k=0.006)
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
    """RegLip, RegLash (the glowing eye slit), RegBrow, RegCheek, RegLid."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    P = hs_inv(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    front = np.clip((-y - 0.15) / 0.02, 0, 1)
    lu, lv = x / 0.037, (z - 4.344) / 0.022
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
        lash = np.maximum(lash, np.clip((0.009 - d) / 0.003, 0, 1) * front)
        bx = (x * s - 0.072) / 0.052
        bz = z - (4.548 + 0.016 * (1 - bx * bx) + 0.01 * bx)
        brow = np.maximum(brow, np.clip((1 - bx * bx) * 3, 0, 1) * np.clip((0.0055 - np.abs(bz)) / 0.002, 0, 1)
                          * front)
        ex, ez = (x * s - 0.07) / 0.046, (z - 4.5) / 0.024
        lid = np.maximum(lid, np.clip((1 - (ex * ex + ez * ez)) / 0.4, 0, 1) * front)
        cx, cz = (x * s - 0.088) / 0.05, (z - 4.43) / 0.04
        cheek = np.maximum(cheek, np.clip(1 - (cx * cx + cz * cz), 0, 1) * front)
    _write(obj, {'RegLip': lip, 'RegLash': lash, 'RegBrow': brow, 'RegLid': lid, 'RegCheek': cheek})


# ------------------------------------------------------------------ the fin ears
def build_fins(voxel):
    """Two fins where her ears were: fans of five silver rays with a thin
    membrane between, sweeping back and up from beside the cheekbones, their
    edges scalloped between the rays."""
    lo, hi = hs((-0.5, -0.12, 4.28)), hs((0.5, 0.5, 5.02))
    G, Xg, Yg, Zg = _grid(lo, hi, voxel)
    d = np.full(Xg.shape, 9.0)
    rays = np.radians(np.array((-25.0, 0.0, 22.0, 44.0, 64.0)))
    for s in (1, -1):
        root = hs((s * 0.158, 0.03, 4.47))
        u = Yg - root[1]                     # back
        v = Zg - root[2]                     # up
        r = np.sqrt(u * u + v * v)
        a = np.arctan2(v, u)                 # 0 = straight back, + up
        L = 0.44 * HEAD_SCALE
        t = np.clip(r / L, 0, 1.3)
        flare = s * (0.02 + 0.2 * t ** 1.2)
        w = (Xg - root[0] - flare) * s
        # the edge: scalloped between the rays, longest along the upper rays
        ang = (a - rays[0]) / (rays[-1] - rays[0])
        between = np.abs(np.sin((a - rays[0]) / (rays[1] - rays[0]) * math.pi))
        edge = L * (0.72 + 0.28 * np.clip(ang, 0, 1)) * (1 - 0.12 * between)
        sector = np.maximum(rays[0] - 0.06 - a, a - rays[-1] - 0.06) * r
        th = 0.007 + 0.008 * np.exp(-((between) / 0.18) ** 2) * (1 - t)
        dm = np.maximum(np.abs(w) - th, np.maximum(r - edge, sector))
        d = np.minimum(d, dm)
    G.d = d.astype(np.float32)
    return G


def fin_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    ray = np.zeros(len(P))
    tip = np.zeros(len(P))
    rays = np.radians(np.array((-25.0, 0.0, 22.0, 44.0, 64.0)))
    for s in (1, -1):
        root = hs((s * 0.158, 0.03, 4.47))
        m = np.sign(P[:, 0]) == s
        u, v = P[:, 1] - root[1], P[:, 2] - root[2]
        r = np.sqrt(u * u + v * v)
        a = np.arctan2(v, u)
        dr = np.min(np.abs(a[:, None] - rays[None, :]), axis=1) * r
        ray = np.maximum(ray, np.clip(1 - dr / 0.012, 0, 1) * m)
        tip = np.maximum(tip, np.clip((r / (0.44 * HEAD_SCALE) - 0.45) / 0.5, 0, 1) * m)
    _write(obj, {'RegRay': ray, 'RegTip': tip})


# ------------------------------------------------------------------ the hair
def build_hair_cap(voxel, Fh):
    """Her hair close over the skull, parted at the centre and swept back from
    a clean hairline, gathered at the back of the head where the floating
    locks leave it."""
    lo, hi = (-0.32, -0.34, 4.18), (0.32, 0.42, 5.0)
    G, Xg, Yg, Zg = _grid(lo, hi, voxel)
    P = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
    dh = Fh.sample(P).reshape(Xg.shape)
    dh = np.where(np.abs(dh) > 1e3, 9.0, dh)
    bun = Ellipsoid(hs((0, 0.16, 4.6)), (0.17, 0.12, 0.15)).dist(Xg, Yg, Zg)
    base = sdf.smin(dh, bun, 0.06)
    off = 0.008
    o, kk = HEAD_PIVOT, HEAD_SCALE
    Xu, Yu, Zu = o[0] + (Xg - o[0]) / kk, o[1] + (Yg - o[1]) / kk, o[2] + (Zg - o[2]) / kk
    # volume: fuller on the crown and the back
    th = 0.03 + 0.025 * np.clip((Yu + 0.05) / 0.2, 0, 1) + 0.01 * np.clip((Zu - 4.6) / 0.1, 0, 1)
    # strands: shallow grooves swept back from the parting
    phi = np.arctan2(Xu, Zu - 4.42)
    th = th + 0.004 * np.sin(phi * 40)
    shell = np.maximum(base - (off + th), -(base - off))
    hair = 4.6 + 0.03 * np.clip(1 - np.abs(Xu) / 0.1, 0, 1) - 0.42 * np.clip(np.abs(Xu) - 0.1, 0, 1)
    keep = np.maximum(Yu - 0.01 - 0.05 * np.clip((4.32 - Zu) / 0.1, 0, 1), Zu - hair)
    d = np.maximum(shell, -keep)
    d = np.maximum(d, (4.28 - Zg) - 0.0 * Yg)
    G.d = d.astype(np.float32)
    return G


def _ribbon(Xg, Yg, Zg, pts, width, thick, across, ruffle=0.0, phase=0.0, strands=0.0):
    """A flat ribbon along a polyline: `width(s)`, `thick(s)` (s from 0 to the
    last segment), lying across `across` (its broad face normal to the path
    and to `across`)."""
    P = np.stack([Xg.ravel(), Yg.ravel(), Zg.ravel()], axis=1)
    d, s = _polyline_param(P, pts)
    n = len(pts) - 1
    seg = np.clip(np.floor(s).astype(int), 0, n - 1)
    t = s - seg
    A_ = np.array([pts[i] for i in seg])
    B_ = np.array([pts[i + 1] for i in seg])
    T = B_ - A_
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    C = A_ + (B_ - A_) * t[:, None]
    acr = np.asarray(across, float)
    acr = acr - T * (T @ acr)[:, None]
    acr /= np.linalg.norm(acr, axis=1, keepdims=True)
    N = np.cross(T, acr)
    D = P - C
    lx = np.sum(D * acr, axis=1)
    ln = np.sum(D * N, axis=1)
    along = np.sum(D * T, axis=1)
    w = width(s)
    th = thick(s)
    edge = np.clip(np.abs(lx) / np.maximum(w, 1e-4), 0, 1.3)
    ruf = ruffle * np.sin(s * 7 + lx * 9 + phase) * edge ** 2 + strands * np.sin(lx * 110 + phase)
    dd = np.maximum(np.abs(ln - ruf) - th, (np.abs(lx) - w) * 0.8)
    # past the ends
    dd = np.maximum(dd, np.where(s <= 1e-4, -along, np.where(s >= n - 1e-4, along, -9.0)))
    return dd.reshape(Xg.shape), s.reshape(Xg.shape), (lx / np.maximum(w, 1e-4)).reshape(Xg.shape)


def build_hair_locks(voxel):
    lo, hi = (-1.3, -0.25, 3.1), (1.3, 1.3, 5.1)
    G, Xg, Yg, Zg = _grid(lo, hi, voxel)
    d = np.full(Xg.shape, 9.0)
    for i, deg in enumerate(HAIR_ANG):
        pts = hair_points(deg)
        a = math.radians(deg)
        across = (math.cos(a), -math.sin(a), 0.0)
        width = lambda s: np.interp(s, (0, 1, 2, 3), (0.1, 0.16, 0.15, 0.04))  # noqa: E731
        thick = lambda s: np.interp(s, (0, 1, 2, 3), (0.034, 0.028, 0.022, 0.011))  # noqa: E731
        di, _, _ = _ribbon(Xg, Yg, Zg, pts, width, thick, across, ruffle=0.025, phase=i * 1.9, strands=0.004)
        d = np.minimum(d, di)
    G.d = d.astype(np.float32)
    return G


def hair_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    tip = np.zeros(len(P))
    for deg in HAIR_ANG:
        pts = hair_points(deg)
        d, s = _polyline_param(P, pts)
        tip = np.maximum(tip, np.clip((s - 1.6) / 1.4, 0, 1) * (d < 0.2))
    _write(obj, {'RegTip': tip})


def hair_weights(obj):
    hang_weights(obj, HAIR_CHAINS, 'Head', parent_band=0.35)


# ------------------------------------------------------------------ the nacre bodice and cuffs
def layers(Fb, voxel):
    rg = X.ramp
    out = []
    noise = Noise(31)
    dent = lambda X_, Y_, Z_: 0.0015 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=2)  # noqa: E731

    def bod_mask(X_, Y_, Z_):
        # a high, straight neckline over the bust held by the pearl collar; the
        # lower edge dips to a point over the girdle in front
        ax = np.abs(X_)
        top = 3.6 + 0.04 * np.exp(-((ax - 0.11) / 0.07) ** 2) - 0.03 * np.exp(-(ax / 0.035) ** 2)
        top = np.where(Y_ > 0.0, 3.58 + 0.0 * ax, top)
        bot = 2.98 - 0.1 * np.exp(-(ax / 0.1) ** 2) * (Y_ < 0)
        return rg(Z_, bot, bot + 0.03) * (1 - rg(Z_, top - 0.02, top + 0.01))

    def bod_thick(X_, Y_, Z_):
        # overlapping scale rows of carved nacre down the waist
        s = np.sin((Z_ / 0.085) * math.tau + 3 * np.sin(np.arctan2(X_, -Y_) * 6))
        return 0.022 + 0.007 * np.clip(s, 0, 1) * (Z_ < 3.42) + 0.01 * rg(Z_, 3.5, 3.56)

    G = X.layer_field(Fb, (-0.4, -0.35, 2.8), (0.4, 0.3, 3.7), voxel, 0.006, bod_thick, bod_mask, noise=dent)
    out.append(('Bodice', G, 'nacre', 'transfer', '', ('Hips', 'Spine1', 'Spine2')))
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)

        def cu_mask(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return rg(u, 0.55, 0.6) * (1 - rg(u, 0.93, 0.97)) * rg(d, 0.14, 0.1)

        def cu_thick(X_, Y_, Z_, el=el, wr=wr):
            d, u = X.seg_dist(X_, Y_, Z_, el, wr)
            return 0.016 + 0.01 * (rg(u, 0.57, 0.6) * (1 - rg(u, 0.62, 0.65)) + rg(u, 0.9, 0.93))
        G = X.layer_field(Fb, np.minimum(el, wr) - 0.2, np.maximum(el, wr) + 0.2, voxel * 0.8, 0.004, cu_thick,
                          cu_mask)
        out.append((_side('Cuff', s), G, 'nacre', 'rigid', _side('Forearm', s), None))
    return out


def bodice_paint(obj):
    """RegGlyph: a crescent cradling a full moon, cut in the bodice's front;
    RegBand: the rim under the bust."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    front = P[:, 1] < -0.1
    u, v = P[:, 0], P[:, 2] - 3.24
    r = np.sqrt(u * u + v * v)
    cres = np.clip((0.085 - r) / 0.006, 0, 1) * np.clip((np.sqrt(u * u + (v - 0.04) ** 2) - 0.072) / 0.006, 0, 1)
    moon = np.clip((0.03 - np.sqrt(u * u + (v + 0.005) ** 2)) / 0.006, 0, 1)
    band = np.clip(1 - np.abs(P[:, 2] - 3.555) / 0.012, 0, 1)
    _write(obj, {'RegGlyph': np.maximum(cres, moon) * front, 'RegBand': band})


# ------------------------------------------------------------------ hanging layers: weights
def hang_weights(obj, chains, parent, n_near=2, parent_band=0.5):
    """Smooth weights over follow-through chains (see the acolyte's builder)."""
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
    n_near = min(n_near, len(chains))
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


# ------------------------------------------------------------------ the fish tail and its fluke
def _tail_centre(z):
    zs = np.array([p[2] for p in TAIL_PTS])[::-1]
    ys = np.array([p[1] for p in TAIL_PTS])[::-1]
    return np.interp(z, zs, ys)


def _tail_radius(z):
    zs = np.array([p[0] for p in TAIL_PROF])[::-1]
    rs = np.array([p[1] for p in TAIL_PROF])[::-1]
    return np.interp(z, zs, rs)


FLUKE_TIP = np.array((0.0, 0.04, 0.5))


def _fluke_plane(Xg, Yg, Zg):
    """Fluke coordinates: r and angle a (0 straight down, 90 sideways) about the
    tail's tip in the x-z plane, and the plate's offset off its curl."""
    x = Xg - FLUKE_TIP[0]
    h = FLUKE_TIP[2] - Zg
    r = np.sqrt(x * x + h * h)
    a = np.degrees(np.arctan2(np.abs(x), h))
    yc = FLUKE_TIP[1] - 0.05 - 0.3 * np.clip(r / 0.8, 0, 1.2) ** 2
    return x, h, r, a, Yg - yc


def build_tail(voxel):
    G, Xg, Yg, Zg = _grid((-0.95, -0.7, 0.0), (0.95, 0.6, 3.14), voxel)
    yc = _tail_centre(Zg)
    rx = _tail_radius(Zg)
    ry = rx * (0.78 + 0.08 * np.clip((Zg - 1.0) / 1.5, 0, 1))
    e = np.sqrt((Xg / rx) ** 2 + ((Yg - yc) / ry) ** 2)
    body = (e - 1.0) * np.minimum(rx, ry)
    body = np.maximum(body, Zg - 3.1)
    body = np.maximum(body, 0.44 - Zg)
    tip = Sphere(FLUKE_TIP, 0.072).dist(Xg, Yg, Zg)
    body = sdf.smin(body, tip, 0.05)
    # the fluke: two broad lobes, longest to the sides, curled forward at the ends
    x, h, r, a, off = _fluke_plane(Xg, Yg, Zg)
    rmax = 0.34 + 0.46 * np.sin(np.radians(np.clip(a, 0, 90))) ** 1.4
    rmax = rmax * (1 - 0.07 * np.abs(np.sin(np.radians(a) * 9)))
    notch = np.clip((14 - a) / 14, 0, 1)
    rmin = 0.0 + 0.3 * notch
    th = 0.016 + 0.012 * np.exp(-((np.abs(np.sin(np.radians(a) * 9))) / 0.25) ** 2) * (1 - np.clip(r / rmax, 0, 1))
    fl = np.maximum(np.abs(off) - th, np.maximum(r - rmax, rmin - r))
    fl = np.maximum(fl, (5 - a) * 0.01)
    fl = np.maximum(fl, -h - 0.02)
    d = sdf.smin(body, fl, 0.04)
    G.d = d.astype(np.float32)
    noise = Noise(41)
    G.displace(lambda X_, Y_, Z_: 0.0012 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=2), band=0.03)
    return G


def tail_paint(obj):
    """RegFluke (the fins' membrane), RegRay (its rays), RegBelly (the paler
    front), RegZ (how far down)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    rx = _tail_radius(np.clip(z, 0.46, 3.1))
    yc = _tail_centre(z)
    e = np.sqrt((x / rx) ** 2 + ((y - yc) / (rx * 0.8)) ** 2)
    fluke = np.clip((e - 1.25) / 0.3, 0, 1) * (z < 0.55) + (z < 0.43)
    fluke = np.clip(fluke, 0, 1)
    xx, h, r, a, off = _fluke_plane(x, y, z)
    ray = np.clip(1 - np.abs(np.sin(np.radians(a) * 9)) / 0.18, 0, 1) * fluke
    belly = np.clip((-(y - yc) / (rx * 0.8) - 0.3) / 0.4, 0, 1) * (1 - fluke)
    _write(obj, {'RegFluke': fluke, 'RegRay': ray, 'RegBelly': belly, 'RegZ': np.clip(z / 3.0, 0, 1)})


def tail_weights(obj):
    hang_weights(obj, [TAIL_CHAIN], 'Hips', n_near=1, parent_band=0.3)


# ------------------------------------------------------------------ the veil fins at the hips
def build_veil_fins(voxel):
    """Two long veil fins from the hips, falling at her sides like the panels of
    a gown: membranes with silver rays, widening and ruffling to a scalloped hem."""
    G, Xg, Yg, Zg = _grid((-1.05, -0.4, 0.25), (1.05, 0.75, 2.95), voxel)
    d = np.full(Xg.shape, 9.0)
    for s in (1, -1):
        pts = [_m(p, s) for p in FIN_PTS]
        across = (0.0, 1.0, 0.0)
        width = lambda q: np.interp(q, (0, 1, 2, 3), (0.06, 0.17, 0.26, 0.3))  # noqa: E731
        thick = lambda q: np.interp(q, (0, 1, 2, 3), (0.02, 0.016, 0.014, 0.012))  # noqa: E731
        di, q, lx = _ribbon(Xg, Yg, Zg, pts, width, thick, across, ruffle=0.04, phase=1.3 * s)
        # the hem: scalloped between the rays
        di = np.maximum(di, (FIN_PTS[3][2] - 0.04 * np.abs(np.sin(lx * 4.7))) - Zg)
        d = np.minimum(d, di)
    G.d = d.astype(np.float32)
    return G


def veil_fin_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    ray = np.zeros(len(P))
    tip = np.zeros(len(P))
    for s in (1, -1):
        m = np.sign(P[:, 0]) == s
        pts = [_m(p, s) for p in FIN_PTS]
        d, q = _polyline_param(P, pts)
        w = np.interp(q, (0, 1, 2, 3), (0.06, 0.17, 0.26, 0.3))
        dy = P[:, 1] - np.interp(q, (0, 1, 2, 3), [p[1] for p in pts])
        lx = dy / np.maximum(w, 1e-4)
        ray = np.maximum(ray, np.clip(1 - np.abs(np.sin(lx * 4.7 * 0.5 * math.pi / 1.0)) / 0.15, 0, 1) * m)
        tip = np.maximum(tip, np.clip((q - 1.2) / 1.6, 0, 1) * m)
    _write(obj, {'RegRay': ray, 'RegTip': tip})


def veil_fin_weights(obj):
    hang_weights(obj, FIN_CHAINS, 'Hips', n_near=1, parent_band=0.4)


# ------------------------------------------------------------------ the waterspout
SPOUT_N = 3
SPOUT_TURNS = 1.15


def spout_radius(z):
    return 0.84 - 0.42 * np.clip(z / SPOUT_TOP, 0, 1) ** 0.8


def build_spout(voxel):
    """The living waterspout that holds her up: three helical bands of moonlit
    water winding round her tail from the floor to her hips, their edges
    cresting into foam, thinning into spray at the top; a ring of water and a
    crown of splashes on the floor."""
    G, Xg, Yg, Zg = _grid((-1.05, -1.05, 0.0), (1.05, 1.05, SPOUT_TOP + 0.15), voxel)
    rho = np.sqrt(Xg * Xg + Yg * Yg)
    phi = np.arctan2(Xg, -Yg)
    zt = np.clip(Zg / SPOUT_TOP, 0, 1)
    rz = spout_radius(Zg)
    d = np.full(Xg.shape, 9.0)
    for k in range(SPOUT_N):
        th0 = 2 * math.pi * k / SPOUT_N
        theta = th0 + 2 * math.pi * SPOUT_TURNS * zt
        dphi = np.angle(np.exp(1j * (phi - theta)))
        # half-width across the band, thinning to spray at the top
        hw = (0.3 + 0.04 * np.sin(Zg * 5 + k)) * (1 - _sm((zt - 0.78) / 0.22) * 0.85)
        pitch = math.atan2(SPOUT_TOP, 2 * math.pi * SPOUT_TURNS * 0.6)
        across = np.abs(dphi) * rho * math.sin(pitch)
        edge = np.clip(across / np.maximum(hw, 1e-3), 0, 1.4)
        thick = 0.035 + 0.03 * edge ** 4                  # the cresting edges stand proud
        wave = 0.025 * np.sin(Zg * 9 + dphi * 6 + k * 2.1)
        db = np.maximum(np.abs(rho - rz - wave - 0.05 * edge ** 2) - thick, across - hw)
        db = np.maximum(db, Zg - SPOUT_TOP)
        d = np.minimum(d, db)
    # the ring of water on the floor and its crown of splashes
    ring = np.sqrt((rho - 0.82) ** 2 / 1.0 + ((Zg - 0.03) / 0.6) ** 2) - 0.07
    d = sdf.smin(d, ring, 0.06)
    for k in range(14):
        a = 2 * math.pi * (k + 0.3 * math.sin(k * 2.7)) / 14
        r0, r1 = 0.82, 0.98 + 0.06 * math.sin(k * 1.9)
        h = 0.2 + 0.14 * abs(math.sin(k * 2.3))
        a0 = np.array((r0 * math.sin(a), -r0 * math.cos(a), 0.04))
        a1 = np.array((r1 * math.sin(a), -r1 * math.cos(a), h))
        sp = RoundCone(a0, a1, 0.045, 0.012).dist(Xg, Yg, Zg)
        d = sdf.smin(d, sp, 0.04)
    d = np.maximum(d, -Zg + 0.0)
    G.d = d.astype(np.float32)
    noise = Noise(57)
    G.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 2.5, octaves=3), band=0.05)
    return G


def spout_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    rho = np.sqrt(x * x + y * y)
    phi = np.arctan2(x, -y)
    zt = np.clip(z / SPOUT_TOP, 0, 1)
    ratio = np.full(len(P), 9.0)
    for k in range(SPOUT_N):
        theta = 2 * math.pi * k / SPOUT_N + 2 * math.pi * SPOUT_TURNS * zt
        dphi = np.abs(np.angle(np.exp(1j * (phi - theta))))
        hw = (0.3 + 0.04 * np.sin(z * 5 + k)) * (1 - _sm((zt - 0.78) / 0.22) * 0.85)
        pitch = math.atan2(SPOUT_TOP, 2 * math.pi * SPOUT_TURNS * 0.6)
        across = dphi * rho * math.sin(pitch)
        ratio = np.minimum(ratio, across / np.maximum(hw, 1e-3))
    # the band each point sits on (the nearest): foam only on its cresting edges
    edge = np.clip((ratio - 0.84) / 0.14, 0, 1) * (z > 0.2)
    inner = (rho < spout_radius(z) - 0.01).astype(float)
    base = np.clip(1 - z / 0.35, 0, 1)
    _write(obj, {'RegEdge': np.maximum(edge, base * 0.5), 'RegIn': inner, 'RegZ': zt, 'RegBase': base})


def spout_weights(obj):
    import rig as R
    R.rigid(obj, 'Spout')


# ------------------------------------------------------------------ the coral staff (local: +Z up the haft)
def build_staff(voxel):
    """White coral, a little twisted, nubbed with small branchlets; two silver
    bands (the grip and under the head); at the top the coral parts into a
    crescent cradle (horns up) round the moon pearl, with fine branchlets
    curling off the horns."""
    lo, hi = (-0.32, -0.2, -HAFT_BELOW - 0.08), (0.32, 0.2, HAFT_ABOVE + 0.1)
    F = Field(lo, hi, voxel)
    top = PEARL_Z - PEARL_R - 0.06
    F.add(RoundCone((0, 0, -HAFT_BELOW), (0, 0, top), 0.04, 0.05), 0.02)
    F.add(Sphere((0, 0, -HAFT_BELOW + 0.02), 0.06), 0.04)
    # the twist: three welts winding round the haft
    for k in range(3):
        pts, rr = [], []
        for i in range(40):
            z = -HAFT_BELOW + 0.1 + (top - (-HAFT_BELOW) - 0.15) * i / 39
            a = 2 * math.pi * k / 3 + z * 2.4
            r = 0.043 + 0.004 * (z / HAFT_ABOVE)
            pts.append(np.array((r * math.cos(a), r * math.sin(a), z)))
            rr.append(0.004)
        F.ridge(sdf.Polyline(pts, rr), 0.01, k=0.012)
    # nubs
    rng = np.random.default_rng(7)
    for i in range(9):
        z = -HAFT_BELOW + 0.35 + (top - 0.6 + HAFT_BELOW) * i / 8 + rng.uniform(-0.08, 0.08)
        if abs(z) < 0.3:
            continue
        a = rng.uniform(0, 2 * math.pi)
        base = np.array((0.04 * math.cos(a), 0.04 * math.sin(a), z))
        tip = base + np.array((0.07 * math.cos(a), 0.07 * math.sin(a), 0.06))
        F.add(RoundCone(base, tip, 0.022, 0.012), 0.015)
    # the silver bands (painted silver)
    for z in (0.17, -0.17, top - 0.12):
        F.add(sdf.Torus((0, 0, z), (0, 0, 1), 0.052, 0.016), 0.012)
    # the crescent cradle: two horns rising round the pearl, swelling at their roots
    for s in (1, -1):
        pts, rr = [], []
        for i in range(16):
            u = i / 15
            ang = math.radians(-80 + 150 * u)        # from below the pearl round its side and up
            rad = PEARL_R + 0.055 + 0.03 * math.sin(math.pi * u)
            pts.append(np.array((s * rad * math.cos(ang), 0.0, PEARL_Z + rad * math.sin(ang) * 1.05)))
            rr.append(0.045 * (1 - u) ** 0.8 + 0.008)
        F.add(sdf.Polyline(pts, rr), 0.03)
        # branchlets curling off the horn
        for j, u in enumerate((0.45, 0.72)):
            ang = math.radians(-80 + 150 * u)
            rad = PEARL_R + 0.055
            b0 = np.array((s * rad * math.cos(ang), 0.0, PEARL_Z + rad * math.sin(ang)))
            b1 = b0 + np.array((s * 0.08, (0.03 if j else -0.03), 0.05))
            b2 = b1 + np.array((s * 0.03, 0.0, 0.06))
            F.add(sdf.Polyline([b0, b1, b2], [0.016, 0.011, 0.006]), 0.012)
    F.add(Sphere((0, 0, PEARL_Z - PEARL_R - 0.03), 0.06), 0.04)
    F.sub(Sphere((0, 0, PEARL_Z), PEARL_R + 0.012), 0.01)
    noise = Noise(61)
    F.displace(lambda X_, Y_, Z_: 0.0022 * noise.ridged(X_ * 28, Y_ * 28, Z_ * 9, octaves=2), band=0.03)
    return F


def staff_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    z = P[:, 2]
    r = np.sqrt(P[:, 0] ** 2 + P[:, 1] ** 2)
    top = PEARL_Z - PEARL_R - 0.06
    band = np.zeros(len(P))
    for zz in (0.17, -0.17, top - 0.12):
        band = np.maximum(band, np.clip(1 - np.abs(z - zz) / 0.03, 0, 1) * (r < 0.08))
    _write(obj, {'RegSilver': np.clip(band * 2, 0, 1), 'RegZ': np.clip((z + HAFT_BELOW) / (HAFT_BELOW + HAFT_ABOVE), 0, 1)})


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand = 0.011 * k, 0.0042 * k, 0.0042 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    S = [Sculpt('Body', Fb, 'skin', 5000, spots=[((0, -0.12, 3.5), 0.25, 0.5)], tau=0.04, paint=body_paint),
         Sculpt('Head', Fh, 'skin', 5000, spots=[((0, -0.2, 4.42), 0.14, 1.0)], tau=0.015, paint=head_paint),
         Sculpt('L_Hand', build_hand(1, vhand), 'skin', 900, tau=0.008),
         Sculpt('R_Hand', build_hand(-1, vhand), 'skin', 900, tau=0.008)]
    for name, G, mat, binding, bone, allow in layers(Fb, 0.0065 * k):
        target = 1800 if name == 'Bodice' else 300
        S.append(Sculpt(name, G, mat, target, binding=binding, bone=bone, allow=allow, relax=6,
                        paint=bodice_paint if name == 'Bodice' else None))
    S.append(Sculpt('HairCap', build_hair_cap(0.0075 * k, Fh), 'hair', 1500, binding='rigid', bone='Head'))
    S.append(Sculpt('Hair', build_hair_locks(0.011 * k), 'hair', 2800, binding='own', weigh=hair_weights,
                    paint=hair_paint))
    S.append(Sculpt('Fins', build_fins(0.006 * k), 'fin', 900, binding='rigid', bone='Head', paint=fin_paint))
    S.append(Sculpt('Tail', build_tail(0.012 * k), 'scales', 4200, binding='own', weigh=tail_weights,
                    paint=tail_paint))
    S.append(Sculpt('VeilFins', build_veil_fins(0.011 * k), 'fin', 1800, binding='own', weigh=veil_fin_weights,
                    paint=veil_fin_paint))
    S.append(Sculpt('Spout', build_spout(0.014 * k), 'water', 4200, binding='own', weigh=spout_weights,
                    paint=spout_paint))
    return S


# ------------------------------------------------------------------ hands
def build_hand(side, voxel):
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.1, w + down * 0.4) - 0.14
    hi = np.maximum(w - down * 0.1, w + down * 0.4) + 0.14
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.06, w + down * 0.02, 0.035, 0.033, bone=hand), 0.02)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(Ellipsoid(w + down * 0.07, (0.047, 0.019, 0.062), Rm, bone=hand), 0.02)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = HAND.fingers[f][4] if f != 'Thumb' else 0.021
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.88, bone=b1), 0.008)
        F.add(RoundCone(mid, tip, r0 * 0.86, r0 * 0.55, bone=b2), 0.006)
    return F


_ = frame_from
