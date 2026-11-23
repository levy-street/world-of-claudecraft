"""Choirmother Selthe: skeleton and sculpts (rest pose), in yards.

The siren matriarch of the moon choir: the Moonlit Siren's queen, much
larger, her face beautiful and terrible, her mouth opening wider than a
human's when she sings. Behind her head and shoulders a vast lionfish fan
opens: long silver rays like the pipes of a cathedral organ, each tipped
with a pearl, sheer fins turquoise going violet between them, her choir
made flesh. Her great fish tail coils round in a pool of moonlit water that
goes with her (she never crawls). The golden Great Conch hangs on her chest:
the only gold in the whole temple. Silver hair floating, pearls in it, fins
for ears, a crescent crown.

Built on the Moonlit Siren's body (siren_base.py): the same torso, arms,
hands, hair and fins; here the head gains a jaw and a mouth, the tail coils
into its pool, and the fan and the conch are added.

Axes: yards, +Z up, faces -Y. The fan's tallest ray about 6.1 up.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
import siren_base as SB
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere, rot_matrix
from siren_base import (ELBOW, FIN_PTS, FINGER_FAN, FINGERS, HAIR_ANG, HAND, HAND_TIP, HEAD_PIVOT, HEAD_SCALE,
                        SHOULDER, WRIST, _m, _polyline_param, _side, _sm, _write, finger_chain, hair_points,
                        hand_frame, hs, hs_inv)

NAME = 'ChoirmotherSelthe'
PREFIX = 'selthe'
HEAD_C = SB.HEAD_C

# the coiled tail: from the hips down and round in its pool, the fluke last
TAIL_PTS = [np.array(p) for p in ((0, 0.03, 2.86), (0, 0.08, 2.08), (0, 0.22, 1.3), (0, 0.4, 0.66), (0.32, 0.58, 0.31),
                                  (0.86, 0.36, 0.26), (0.98, -0.26, 0.23), (0.48, -0.74, 0.2), (-0.22, -0.78, 0.18))]
TAIL_R = (0.32, 0.42, 0.4, 0.34, 0.28, 0.23, 0.18, 0.14, 0.1)
POOL_R = 1.7
POOL_AT = np.array((0.0, 0.0, 0.0))
# the fan: rays from behind the shoulders in a plane leaning back
FAN_O = np.array((0.0, 0.46, 3.66))
FAN_LEAN = math.radians(22.0)
FAN_E1 = np.array((1.0, 0.0, 0.0))
FAN_E2 = np.array((0.0, math.sin(FAN_LEAN), math.cos(FAN_LEAN)))
FAN_N = np.cross(FAN_E1, FAN_E2)
FAN_ANG = tuple(np.linspace(-86.0, 86.0, 11))


def fan_len(a):
    return 2.55 - 1.15 * (abs(a) / 86.0) ** 1.4


def fan_dir(a):
    r = math.radians(a)
    return FAN_E1 * math.sin(r) + FAN_E2 * math.cos(r)


CONCH_AT = np.array((0.0, -0.3, 3.36))
JAW = (hs((0.0, 0.0, 4.4)), hs((0.0, -0.14, 4.27)))
BAKE_CAGE, BAKE_RAY = 0.02, 0.07
GRIP_OFFSET_L = (0.0, 0.0, 0.0)
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.02, 2.82), (0, 0.02, 3.08)),
        ('Spine1', 'Hips', (0, 0.02, 3.08), (0, 0.0, 3.44)),
        ('Spine2', 'Spine1', (0, 0.0, 3.44), (0, 0.02, 3.82)),
        ('Neck', 'Spine2', (0, 0.03, 3.9), (0, 0.02, 4.24)),
        ('Head', 'Neck', (0, 0.02, 4.24), (0, 0.0, 4.74)),
        ('Jaw', 'Head', tuple(JAW[0]), tuple(JAW[1])),
        ('Conch', 'Spine2', tuple(CONCH_AT), tuple(CONCH_AT + np.array((0, 0, -0.4)))),
        ('ConchFree', 'Root', tuple(CONCH_AT), tuple(CONCH_AT + np.array((0, 0, -0.4)))),
        ('Pool', 'Root', tuple(POOL_AT), tuple(POOL_AT + np.array((0, 0, 0.4)))),
    ]
    prev = 'Hips'
    for i in range(len(TAIL_PTS) - 1):
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
    for i, a in enumerate(FAN_ANG):
        out.append((f'Fan{i}', 'Spine2', tuple(FAN_O), tuple(FAN_O + fan_dir(a) * fan_len(a))))
    out += SB._arm_bones()
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = SB.SPINE
LIMBS = SB.LIMBS
HELPERS = SB.HELPERS
ROLL_LIMIT = SB.ROLL_LIMIT
LEFT_ARM = SB.LEFT_ARM
SOLE_Z = 0.3
GROUND = 0.05
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {'Spine2': 0.3, 'Spine1': 0.28}
POP_SKIP = ('Tail', 'L_Fin', 'R_Fin', 'Hair', 'Fan', 'Conch', 'Pool', 'Jaw')
TREMOR_KEYS = SB.TREMOR_KEYS
AIM_LIMITS = SB.AIM_LIMITS
HIDDEN = {'ConchFree': 0.0}
TAIL_CHAIN = [f'Tail{i}' for i in range(1, len(TAIL_PTS))]
FIN_CHAINS = SB.FIN_CHAINS
HAIR_CHAINS = SB.HAIR_CHAINS
FAN_BONES = [f'Fan{i}' for i in range(len(FAN_ANG))]


def _chains():
    from rig import Chain
    out = []
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


# ------------------------------------------------------------------ the matriarch's broad body
# The siren's body (siren_base.build_body) was a slender maiden's: next to the
# chibi player and under her vast fan she read thin. The matriarch keeps the
# siren's joints (every clip still fits) but is built broad and heavy in the
# game's stylized way: a deep ribcage and strong shoulders, thick arms, a
# solid neck under the larger head.
WIDE, DEEP, LIMB = 1.22, 1.3, 1.38


def build_body(voxel):
    lerp = B.lerp
    F = Field((-1.0, -0.6, 2.55), (1.0, 0.55, 4.4), voxel)
    F.add(Ellipsoid((0, 0.03, 2.86), (0.25 * WIDE, 0.19 * DEEP, 0.24), bone='Hips'), 0.12)
    F.add(Ellipsoid((0, 0.02, 3.12), (0.2 * WIDE, 0.145 * DEEP, 0.2), bone='Spine1'), 0.12)
    F.add(Ellipsoid((0, 0.03, 3.48), (0.255 * WIDE, 0.17 * DEEP, 0.28), rot_matrix(rx=-0.06), bone='Spine2'), 0.12)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.12, -0.15, 3.52), s), (0.125, 0.1, 0.11), rot_matrix(rz=0.25 * s), bone='Spine2'),
              0.05)
    F.add(Ellipsoid((0, 0.05, 3.76), (0.36, 0.18, 0.13), bone='Spine2'), 0.1)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.15, 0.17, 3.66), s), (0.13, 0.06, 0.15), bone='Spine2'), 0.06)
        F.add(RoundCone(_m((0.05, -0.07, 3.83), s), _m((0.32, -0.01, 3.86), s), 0.03, 0.04, bone=_side('Clavicle', s)),
              0.04)
        # the trapezius: a strong slope from the neck to the shoulder
        F.add(RoundCone(_m((0.06, 0.07, 3.95), s), _m((0.33, 0.05, 3.87), s), 0.075, 0.085, bone=_side('Clavicle', s)),
              0.09)
    F.add(RoundCone((0, 0.05, 3.8), (0, 0.02, 4.3), 0.105, 0.095, bone='Neck'), 0.07)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(Sphere(sh + np.array((0.02 * s, 0, 0.0)), 0.09 * LIMB, bone=up), 0.06)
        F.add(RoundCone(sh, el, 0.082 * LIMB, 0.056 * LIMB, bone=up), 0.04)
        F.add(Sphere(el + np.array((0, 0.02, 0)), 0.053 * LIMB, bone=_side('ElbowFix', s)), 0.035)
        F.add(RoundCone(el, lerp(el, wr, 0.38), 0.055 * LIMB, 0.064 * LIMB, bone=fo), 0.03)
        F.add(RoundCone(lerp(el, wr, 0.38), wr, 0.064 * LIMB, 0.045 * LIMB, bone=fo), 0.03)
    noise = Noise(5)
    F.displace(lambda X_, Y_, Z_: 0.0015 * noise.fbm(X_ * 12, Y_ * 12, Z_ * 12, octaves=2), band=0.05)
    return F


def body_paint(obj):
    """The siren's RegScale, and RegStripe: the lionfish's bands, deep violet
    and sea-teal, ringing her arms and sweeping round her flanks."""
    SB.body_paint(obj)
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    stripe = np.zeros(len(P))
    for s in (1, -1):
        sh, wr = _m(SHOULDER, s), _m(WRIST, s)
        ax = wr - sh
        L = np.linalg.norm(ax)
        u = ((P - sh) @ ax) / (L * L)
        d = np.linalg.norm(P - sh - np.outer(np.clip(u, 0, 1), ax), axis=1)
        on = (u > 0.12) & (u < 0.96) & (d < 0.16) & (P[:, 0] * s > 0.2)
        band = np.clip((np.abs(np.sin(u * math.pi * 5.5)) - 0.55) / 0.12, 0, 1)
        stripe = np.maximum(stripe, band * on)
    flank = np.clip((np.abs(P[:, 0]) - 0.17) / 0.06, 0, 1) * np.clip((3.42 - P[:, 2]) / 0.05, 0, 1) *         np.clip((P[:, 2] - 3.0) / 0.05, 0, 1)
    band = np.clip((np.abs(np.sin((P[:, 2] * 14 + np.abs(P[:, 0]) * 6))) - 0.6) / 0.12, 0, 1)
    stripe = np.maximum(stripe, band * flank)
    _write(obj, {'RegStripe': stripe})


def _no_stripe(obj):
    _write(obj, {'RegStripe': np.zeros(len(obj.data.vertices))})


def build_hand(side, voxel):
    """The siren's hand, made strong to match the arms: a broader palm and
    thicker fingers ending in sharp nails."""
    w, down, width, palm = hand_frame(side)
    lo = np.minimum(w - down * 0.1, w + down * 0.4) - 0.16
    hi = np.maximum(w - down * 0.1, w + down * 0.4) + 0.16
    F = Field(lo, hi, voxel)
    hand = _side('Hand', side)
    F.add(RoundCone(w - down * 0.06, w + down * 0.02, 0.045, 0.042, bone=hand), 0.02)
    Rm = np.stack([width, palm, down], axis=1)
    F.add(Ellipsoid(w + down * 0.07, (0.058, 0.025, 0.07), Rm, bone=hand), 0.02)
    for f in FINGERS:
        base, mid, tip = finger_chain(side, f)
        r0 = (HAND.fingers[f][4] if f != 'Thumb' else 0.021) * 1.28
        b1, b2 = _side(f + '1', side), _side(f + '2', side)
        F.add(RoundCone(base, mid, r0, r0 * 0.88, bone=b1), 0.008)
        F.add(RoundCone(mid, tip, r0 * 0.86, r0 * 0.4, bone=b2), 0.006)
    return F


# ------------------------------------------------------------------ the head, with a jaw that opens too far
def _head_unscaled(voxel):
    F = Field((-0.25, -0.33, 4.08), (0.25, 0.3, 4.82), voxel)
    noise = Noise(9)
    F.add(RoundCone((0, 0.03, 4.16), (0, 0.02, 4.34), 0.07, 0.072, bone='Neck'), 0.05)
    F.add(Ellipsoid((0, 0.035, 4.53), (0.155, 0.19, 0.2), bone='Head'), 0.06)
    F.add(Ellipsoid((0, -0.07, 4.46), (0.135, 0.13, 0.15), bone='Head'), 0.07)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.094, -0.15, 4.462), s), (0.058, 0.034, 0.024), rot_matrix(rz=0.4 * s, ry=-0.2 * s),
                        bone='Head'), 0.03)
        F.add(Ellipsoid(_m((0.07, -0.13, 4.4), s), (0.05, 0.045, 0.045), bone='Head'), 0.05)
        # the jaw: from below the ear to a small sharp chin, on the Jaw bone
        F.add(RoundCone(_m((0.1, -0.02, 4.37), s), _m((0.036, -0.134, 4.262), s), 0.045, 0.032, bone='Jaw'), 0.06)
    F.add(Ellipsoid((0, -0.148, 4.255), (0.036, 0.032, 0.034), bone='Jaw'), 0.04)
    F.add(Ellipsoid((0, -0.172, 4.55), (0.105, 0.03, 0.03), bone='Head'), 0.04)
    for s in (1, -1):
        # a heavy brow ridge drawn down toward the nose: regal, and a scowl
        F.add(Ellipsoid(_m((0.07, -0.183, 4.538), s), (0.062, 0.026, 0.017), rot_matrix(ry=0.32 * s, rz=0.12 * s),
                        bone='Head'), 0.02)
        F.sub(Ellipsoid(_m((0.066, -0.205, 4.492), s), (0.04, 0.024, 0.02), rot_matrix(rz=0.18 * s)), 0.03)
        F.add(Ellipsoid(_m((0.066, -0.172, 4.498), s), (0.038, 0.024, 0.018), rot_matrix(rx=0.25, rz=0.16 * s),
                        bone='Head'), 0.012)
        F.add(Ellipsoid(_m((0.066, -0.169, 4.474), s), (0.033, 0.02, 0.011), bone='Head'), 0.01)
        F.groove(sdf.Polyline(SB._lid_line(s), [0.0022] * 3), 0.008, k=0.005)
    F.add(RoundCone((0, -0.19, 4.49), (0, -0.228, 4.416), 0.012, 0.015, bone='Head'), 0.02)
    F.add(Sphere((0, -0.23, 4.412), 0.016, bone='Head'), 0.012)
    for s in (1, -1):
        F.add(Sphere(_m((0.016, -0.215, 4.405), s), 0.011, bone='Head'), 0.012)
        F.sub(Sphere(_m((0.011, -0.225, 4.398), s), 0.0055), 0.004)
    # the lips: the upper on the head, the lower on the jaw
    F.add(Ellipsoid((0, -0.195, 4.357), (0.032, 0.012, 0.009), rot_matrix(rx=-0.25), bone='Head'), 0.012)
    F.add(Ellipsoid((0, -0.191, 4.33), (0.029, 0.013, 0.012), bone='Jaw'), 0.012)
    # two small fangs behind the upper lip, bared when she sings
    for s in (1, -1):
        F.add(X.Prism(_m((0.017, -0.178, 4.352), s), _m((0.015, -0.181, 4.322), s), 0.0055, n=5, tip=0.6, tip_a=0.1,
                      bone='Head'), 0.003)
    # the mouth: a deep cavity behind the lips, only seen when the jaw drops
    F.sub(Ellipsoid((0, -0.12, 4.34), (0.05, 0.08, 0.035)), 0.015)
    F.sub(Ellipsoid((0, -0.205, 4.345), (0.024, 0.02, 0.005)), 0.004)
    F.displace(lambda X_, Y_, Z_: 0.0006 * noise.fbm(X_ * 50, Y_ * 50, Z_ * 50, octaves=2), band=0.02)
    return F


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
        F.prims.append((SB._ScaledPrim(prim), k))
    return F


def head_paint(obj):
    """The siren's face masks, RegMouth, and RegStripe: the lionfish marks of
    her face, a band swept down and back from each eye across the cheek and a
    second under it, deep violet, the mask of a queen of the reef."""
    SB.head_paint(obj)
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    P = hs_inv(P)
    # the mouth's glow stays inside it, off the lips
    m = np.clip(1 - np.linalg.norm((P - np.array((0, -0.12, 4.34))) / np.array((0.05, 0.06, 0.035)), axis=1), 0, 1)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    front = np.clip((-y - 0.02) / 0.04, 0, 1)
    stripe = np.zeros(len(P))
    for x0, w in ((0.066, 0.014), (0.118, 0.011)):
        # each band falls from the brow through (or beside) the eye and
        # slants out down the cheek to the jaw, as a lionfish's face is barred
        xc = x0 + 0.3 * np.clip(4.5 - z, 0, None)
        band = np.clip((w - np.abs(ax - xc)) / 0.004, 0, 1)
        band = band * np.clip((z - 4.32) / 0.02, 0, 1) * np.clip((4.6 - z) / 0.02, 0, 1)
        stripe = np.maximum(stripe, band * front)
    _write(obj, {'RegMouth': np.clip(m * 3, 0, 1), 'RegStripe': stripe})


# ------------------------------------------------------------------ the coiled tail
def _tail_path(n=80):
    """A smooth path through the tail's points (Catmull-Rom) with radii."""
    P = TAIL_PTS
    pts, rad = [], []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]
        p1, p2 = P[i], P[i + 1]
        p3 = P[min(i + 2, len(P) - 1)]
        for k in range(10):
            t = k / 10
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            pts.append(q)
            rad.append(TAIL_R[i] + (TAIL_R[i + 1] - TAIL_R[i]) * t)
    pts.append(P[-1])
    rad.append(TAIL_R[-1])
    return pts, rad


def build_tail(voxel):
    G, Xg, Yg, Zg = X.grid((-1.4, -1.25, -0.05), (1.4, 1.0, 3.12), voxel)
    pts, rad = _tail_path()
    for i in range(len(pts) - 1):
        G.add(RoundCone(pts[i], pts[i + 1], rad[i], rad[i + 1]), 0.04, weight=False)
    # the fluke at the end: two broad lobes lying in the pool, curled up at the tips
    end, before = pts[-1], pts[-4]
    T = (end - before) / np.linalg.norm(end - before)
    Lat = np.cross((0, 0, 1), T)
    Lat /= np.linalg.norm(Lat)
    x = (Xg - end[0]) * Lat[0] + (Yg - end[1]) * Lat[1]
    h = (Xg - end[0]) * T[0] + (Yg - end[1]) * T[1]
    r = np.sqrt(x * x + h * h)
    a = np.degrees(np.arctan2(np.abs(x), np.maximum(h, -0.5)))
    rmax = 0.3 + 0.42 * np.sin(np.radians(np.clip(a, 0, 90))) ** 1.3
    rmax = rmax * (1 - 0.07 * np.abs(np.sin(np.radians(a) * 9)))
    zc = end[2] + 0.02 + 0.22 * np.clip(r / 0.7, 0, 1.3) ** 2
    fl = np.maximum(np.abs(Zg - zc) - 0.016, np.maximum(r - rmax, (8 - a) * 0.01))
    fl = np.maximum(fl, -h - 0.02)
    G.d = sdf.smin(G.d, fl.astype(np.float32), 0.04).astype(np.float32)
    G.d = np.maximum(G.d, Zg - 3.06).astype(np.float32)
    noise = Noise(41)
    G.displace(lambda X_, Y_, Z_: 0.0012 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=2), band=0.03)
    return G


def tail_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    pts, rad = _tail_path()
    d, s = _polyline_param(P, pts)
    idx = np.clip(np.round(s).astype(int), 0, len(pts) - 1)
    cz = np.array([pts[i][2] for i in idx])
    rr = np.array([rad[i] for i in idx])
    fluke = np.clip((d - rr * 1.15) / 0.1, 0, 1) * (s > len(pts) - 8)
    belly = np.clip((cz - P[:, 2]) / (rr + 1e-3) * 1.5, 0, 1) * (1 - fluke)
    x = P[:, 0] - pts[-1][0]
    y = P[:, 1] - pts[-1][1]
    a = np.degrees(np.arctan2(np.abs(x), np.abs(y) + 1e-3))
    ray = np.clip(1 - np.abs(np.sin(np.radians(a) * 9)) / 0.18, 0, 1) * fluke
    _write(obj, {'RegFluke': fluke, 'RegRay': ray, 'RegBelly': belly, 'RegZ': np.clip(P[:, 2] / 3.0, 0, 1)})


def tail_weights(obj):
    """Each vertex rides the tail bone nearest along the coil, blended across
    each joint; the top fades into the hips."""
    import rig as R
    P, E = R.mesh_arrays(obj)
    chain = TAIL_CHAIN
    pts = [REST[chain[0]][0]] + [REST[b][1] for b in chain]
    d, s = _polyline_param(P, pts)
    names = ['Hips'] + chain
    W = np.zeros((len(P), len(names)))
    for j in range(len(chain)):
        centre = j + 0.5
        hat = np.clip(1 - np.abs(s - centre), 0, 1)
        if j == len(chain) - 1:
            hat = np.where(s > centre, 1.0, hat)
        if j == 0:
            hat = np.where(s < centre, 1.0, hat)
        W[:, j + 1] = hat
    W[:, 0] = np.clip(1 - s / 0.3, 0, 1) * 1.5
    W /= np.maximum(W.sum(axis=1, keepdims=True), 1e-9)
    W = R.relax(W, E, iters=2)
    R.write_groups(obj, names, R.cap4(W))


# ------------------------------------------------------------------ the pool she rides
def build_pool(voxel):
    G, Xg, Yg, Zg = X.grid((-POOL_R - 0.3, -POOL_R - 0.3, -0.06), (POOL_R + 0.3, POOL_R + 0.3, 0.42), voxel)
    r = np.sqrt(Xg * Xg + Yg * Yg)
    surf = 0.06 + 0.012 * np.sin(r * 14) * np.clip(1 - r / POOL_R, 0, 1)
    d = np.maximum(Zg - surf, -Zg - 0.02)
    d = np.maximum(d, r - POOL_R)
    rim = np.sqrt((r - POOL_R) ** 2 + ((Zg - 0.06) / 1.4) ** 2) - 0.08
    d = sdf.smin(d, rim, 0.05)
    for k in range(18):
        a = 2 * math.pi * (k + 0.37 * math.sin(k * 2.3)) / 18
        h = 0.14 + 0.12 * abs(math.sin(k * 1.7))
        b = np.array((POOL_R * math.sin(a), -POOL_R * math.cos(a), 0.05))
        t = b + np.array((0.12 * math.sin(a), -0.12 * math.cos(a), h))
        d = sdf.smin(d, RoundCone(b, t, 0.05, 0.012).dist(Xg, Yg, Zg), 0.04)
    G.d = d.astype(np.float32)
    noise = Noise(83)
    G.displace(lambda X_, Y_, Z_: 0.005 * noise.fbm(X_ * 3, Y_ * 3, Z_ * 3, octaves=3), band=0.04)
    return G


def pool_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    r = np.sqrt(P[:, 0] ** 2 + P[:, 1] ** 2)
    edge = np.clip((r - (POOL_R - 0.15)) / 0.12, 0, 1)
    _write(obj, {'RegEdge': edge, 'RegIn': np.zeros(len(P)), 'RegZ': np.clip(1 - r / POOL_R, 0, 1) * 0.6,
                 'RegBase': np.zeros(len(P))})


# ------------------------------------------------------------------ the lionfish fan
def _fan_local(Xg, Yg, Zg):
    px, py, pz = Xg - FAN_O[0], Yg - FAN_O[1], Zg - FAN_O[2]
    u = px * FAN_E1[0] + py * FAN_E1[1] + pz * FAN_E1[2]
    v = px * FAN_E2[0] + py * FAN_E2[1] + pz * FAN_E2[2]
    w = px * FAN_N[0] + py * FAN_N[1] + pz * FAN_N[2]
    return u, v, w


def build_fan_membrane(voxel):
    """The sheer fins between the rays, pleated like a hand fan, deeply cut
    between the rays (a lionfish's), long toward the centre."""
    lo = np.minimum.reduce([FAN_O - 0.3] + [FAN_O + fan_dir(a) * fan_len(a) for a in FAN_ANG]) - 0.2
    hi = np.maximum.reduce([FAN_O + 0.3] + [FAN_O + fan_dir(a) * fan_len(a) for a in FAN_ANG]) + 0.2
    G, Xg, Yg, Zg = X.grid(lo, hi, voxel)
    u, v, w = _fan_local(Xg, Yg, Zg)
    rho = np.sqrt(u * u + v * v)
    ang = np.degrees(np.arctan2(u, v))
    A = np.array(FAN_ANG)
    gap = A[1] - A[0]
    frac = np.clip((ang - A[0]) / gap, 0, len(A) - 1 - 1e-6)
    i0 = np.floor(frac).astype(int)
    t = frac - i0
    L0 = np.array([fan_len(a) for a in A])[i0]
    L1 = np.array([fan_len(a) for a in A])[np.minimum(i0 + 1, len(A) - 1)]
    Lr = L0 + (L1 - L0) * t
    # cut deep between the rays: the membrane reaches 92% at a ray, 58% midway
    reach = Lr * (0.95 - 0.2 * np.sin(math.pi * t) ** 1.5)
    pleat = 0.05 * np.sin(math.pi * t) * np.where(i0 % 2 == 0, 1.0, -1.0) * np.clip(rho / 1.2, 0, 1)
    d = np.maximum(np.abs(w - pleat) - 0.014, rho - reach)
    d = np.maximum(d, (A[0] - 1 - ang) * 0.02)
    d = np.maximum(d, (ang - A[-1] - 1) * 0.02)
    d = np.maximum(d, 0.25 - rho)
    G.d = d.astype(np.float32)
    return G


def fan_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    u, v, w = _fan_local(P[:, 0], P[:, 1], P[:, 2])
    rho = np.sqrt(u * u + v * v)
    ang = np.degrees(np.arctan2(u, v))
    A = np.array(FAN_ANG)
    frac = np.clip((ang - A[0]) / (A[1] - A[0]), 0, len(A) - 1 - 1e-6)
    i0 = np.floor(frac).astype(int)
    t = frac - i0
    L = np.array([fan_len(a) for a in A])[i0]
    tip = np.clip(rho / L, 0, 1)
    ray = np.clip(1 - np.minimum(t, 1 - t) * (A[1] - A[0]) * math.pi / 180 * rho / 0.03, 0, 1)
    _write(obj, {'RegTip': tip, 'RegRay': ray})


def fan_weights(obj):
    import rig as R
    P, E = R.mesh_arrays(obj)
    u, v, w = _fan_local(P[:, 0], P[:, 1], P[:, 2])
    ang = np.degrees(np.arctan2(u, v))
    A = np.array(FAN_ANG)
    frac = np.clip((ang - A[0]) / (A[1] - A[0]), 0, len(A) - 1 - 1e-6)
    i0 = np.floor(frac).astype(int)
    t = frac - i0
    W = np.zeros((len(P), len(A)))
    W[np.arange(len(P)), i0] = 1 - t
    W[np.arange(len(P)), np.minimum(i0 + 1, len(A) - 1)] += t
    W = R.relax(W, E, iters=1)
    R.write_groups(obj, FAN_BONES, R.cap4(W))


# ------------------------------------------------------------------ the golden conch (local: +Z along the spire)
def build_conch(voxel):
    """The Great Conch: a heavy spiral shell, its whorls crowned with knobs,
    the body whorl swelling to a flared, lipped aperture."""
    F = Field((-0.3, -0.3, -0.42), (0.3, 0.3, 0.32), voxel)
    F.add(RoundCone((0, 0, -0.36), (0, 0, 0.26), 0.012, 0.17), 0.06)
    F.add(Ellipsoid((0, 0.03, 0.12), (0.19, 0.17, 0.2)), 0.06)
    for k in range(26):
        u = k / 25
        a = 2 * math.pi * 3.2 * u
        z = -0.34 + 0.6 * u
        r = 0.02 + 0.17 * u
        F.ridge(sdf.Polyline([np.array((r * math.cos(a), r * math.sin(a), z)),
                              np.array((r * math.cos(a + 0.24), r * math.sin(a + 0.24), z + 0.023))],
                             [0.006, 0.006]), 0.02, k=0.015)
        if k % 3 == 0 and u > 0.25:
            F.add(Sphere(np.array(((r + 0.02) * math.cos(a), (r + 0.02) * math.sin(a), z)), 0.018 + 0.02 * u), 0.02)
    # the aperture: a flared lip opening to the front
    F.add(Ellipsoid((0, -0.15, 0.1), (0.14, 0.05, 0.22)), 0.04)
    F.sub(Ellipsoid((0, -0.19, 0.1), (0.09, 0.08, 0.17)), 0.03)
    return F


def conch_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    inside = np.clip(1 - np.linalg.norm((P - np.array((0, -0.17, 0.1))) / np.array((0.1, 0.07, 0.18)), axis=1), 0,
                     1)
    _write(obj, {'RegIn': np.clip(inside * 3, 0, 1)})


def conch_matrix():
    """The conch hanging on her chest: spire down and out, aperture forward."""
    M = np.eye(4)
    R = rot_matrix(rx=-0.35, rz=0.4)
    M[:3, :3] = R * 1.15
    M[:3, 3] = CONCH_AT + np.array((0, -0.05, -0.05))
    return M


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    vb, vh, vhand = 0.011 * k, 0.0042 * k, 0.0042 * k
    Fb = build_body(vb)
    Fh = build_head(vh)
    S = [Sculpt('Body', Fb, 'skin', 5000, spots=[((0, -0.12, 3.5), 0.25, 0.5)], tau=0.04, paint=body_paint),
         Sculpt('Head', Fh, 'skin', 5600, spots=[((0, -0.2, 4.42), 0.14, 1.0)], tau=0.012, paint=head_paint),
         Sculpt('L_Hand', build_hand(1, vhand), 'skin', 900, tau=0.008, paint=_no_stripe),
         Sculpt('R_Hand', build_hand(-1, vhand), 'skin', 900, tau=0.008, paint=_no_stripe)]
    for name, G, mat, binding, bone, allow in SB.layers(Fb, 0.0065 * k):
        target = 1800 if name == 'Bodice' else 300
        S.append(Sculpt(name, G, mat, target, binding=binding, bone=bone, allow=allow, relax=6,
                        paint=SB.bodice_paint if name == 'Bodice' else None))
    S.append(Sculpt('HairCap', SB.build_hair_cap(0.0075 * k, Fh), 'hair', 1500, binding='rigid', bone='Head'))
    S.append(Sculpt('Hair', SB.build_hair_locks(0.011 * k), 'hair', 2800, binding='own', weigh=SB.hair_weights,
                    paint=SB.hair_paint))
    S.append(Sculpt('Fins', SB.build_fins(0.006 * k), 'fin', 900, binding='rigid', bone='Head', paint=SB.fin_paint))
    S.append(Sculpt('Tail', build_tail(0.013 * k), 'scales', 5200, binding='own', weigh=tail_weights,
                    paint=tail_paint))
    S.append(Sculpt('VeilFins', SB.build_veil_fins(0.011 * k), 'fin', 1800, binding='own', weigh=SB.veil_fin_weights,
                    paint=SB.veil_fin_paint))
    S.append(Sculpt('Fan', build_fan_membrane(0.012 * k), 'fin', 4200, binding='own', weigh=fan_weights,
                    paint=fan_paint))
    S.append(Sculpt('PoolWater', build_pool(0.02 * k), 'water', 2600, binding='rigid', bone='Pool',
                    paint=pool_paint))
    return S


_ = (ELBOW, FINGERS, FINGER_FAN, HAND, HAND_TIP, SHOULDER, WRIST, finger_chain, hand_frame, _side, _sm,
     HEAD_PIVOT, Sphere)
