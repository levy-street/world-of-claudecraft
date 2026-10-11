"""Korzul the Gravewyrm: skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Balgath, Great Saurian and Great Jaguar kits this
builder is adapted from): Blender units are yards, +Z up, the wyrm FACES -Y (the
game's +Z after the glTF export), its left is +X. Bones are (name, parent, head,
tail); `L_` bones are mirrored onto `R_` (x -> -x).

A six-limbed great wyrm, not a wyvern (the Hollow Crypt's Knellwyrm walks on its
wings; Korzul stands on four clawed legs and carries a separate pair of wings).
Living flesh and scale, gaunt from twelve centuries in the quench: the ribs show
through the flanks, the waist is tucked, the hips stand out.

Bones beside the skeleton:
  * ElbowFix / KneeFix / HockFix / WElbowFix: joint helpers that take half their
    twin's bend (rig.py keys them), so the joints keep their volume.
  * Belly: the slack gut (a spring).
  * Shard: the anchor of the swallowed heart-shard in the chest (glow, VFX).
  * Mouth: the breath origin (child of Head, at the front of the jaws).
  * Chain bones (ChainFL*, ChainFR*, ChainHR*, ChainNk*): the Smith's broken
    chains hanging from the shackles (springs); Chain*End leaves mark the ends.
  * IceShed1..8: the slabs of quench-ice still fused to him in the Frozen pose;
    they burst off in BreakFree and stay scaled to zero in every other clip.
  * L_WingTip / R_WingTip, TailTip: leaf anchors.
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, rot_matrix

# ------------------------------------------------------------------ landmarks
SHOULDER = np.array((3.3, -5.0, 9.0))
ELBOW = np.array((3.75, -2.85, 5.2))
WRIST = np.array((3.65, -4.55, 1.75))
FPAW = np.array((3.65, -5.35, 0.62))
FTOE = np.array((3.65, -7.25, 0.42))
HIP = np.array((2.9, 7.6, 9.0))
KNEE = np.array((3.45, 4.5, 5.4))
HOCK = np.array((3.3, 8.7, 2.45))
HPAW = np.array((3.3, 7.45, 0.62))
HTOE = np.array((3.3, 5.45, 0.42))

# the wing (left), spread at rest
W_SHOULDER = np.array((2.0, -3.4, 12.2))
W_ELBOW = np.array((7.6, -1.6, 15.2))
W_WRIST = np.array((15.6, 0.6, 14.6))
W_KNUCKLE = np.array((16.6, 0.4, 14.55))
W_THUMB = np.array((17.0, -1.7, 14.2))
WS = 0.78


def _ws(p):
    return W_SHOULDER + (np.asarray(p, float) - W_SHOULDER) * WS


W_ELBOW, W_WRIST, W_KNUCKLE, W_THUMB = _ws(W_ELBOW), _ws(W_WRIST), _ws(W_KNUCKLE), _ws(W_THUMB)
FINGERS = {  # name: points from the knuckle out
    'F1': [W_KNUCKLE, np.array((21.8, 2.0, 14.1)), np.array((25.4, 5.0, 13.3))],
    'F2': [W_KNUCKLE, np.array((20.2, 5.5, 13.9)), np.array((21.9, 9.4, 13.0))],
    'F3': [W_KNUCKLE, np.array((17.4, 8.2, 13.6)), np.array((17.6, 12.4, 12.7))],
    'F4': [W_KNUCKLE, np.array((14.4, 7.0, 13.4)), np.array((12.4, 11.0, 12.9))],
}
FINGERS = {k: [_ws(p) if n else W_KNUCKLE for n, p in enumerate(v)] for k, v in FINGERS.items()}

NECK_PTS = [np.array(p, float) for p in ((0, -7.2, 11.6), (0, -9.0, 13.2), (0, -10.3, 14.9), (0, -11.6, 16.2),
                                          (0, -13.1, 17.1), (0, -14.7, 17.45), (0, -16.2, 17.3))]
NECK_R = [2.7, 2.4, 2.15, 1.95, 1.8, 1.68, 1.6]
# Rime Whelp: the same family's YOUNG form: a shorter neck, a bigger head with big
# eyes and stubby horns, a shorter tail, smaller wings (the whole body is scaled to
# its game size after the build, build.py WHELP_HEIGHT)
NECK_PTS = [NECK_PTS[0] + (p - NECK_PTS[0]) * 0.6 for p in NECK_PTS]
_HEAD_OLD = np.array((0, -17.4, 16.3))   # the head was drawn about this base, then moved and grown
HK = 1.8


def H(p):
    """A head-space point carried onto the head's final base and scaled about it."""
    return NECK_PTS[-1] + (np.asarray(p, float) - _HEAD_OLD) * HK


def HR(r):
    return np.asarray(r, float) * HK
TAIL_PTS = [np.array(p, float) for p in ((0, 8.2, 10.2), (0, 10.2, 9.95), (0, 12.2, 9.4), (0, 14.2, 8.55),
                                          (0, 16.1, 7.5), (0, 17.9, 6.35), (0, 19.7, 5.2), (0, 21.4, 4.1),
                                          (0, 23.1, 3.1), (0, 24.8, 2.3), (0, 26.5, 1.65), (0, 28.1, 1.2),
                                          (0, 29.7, 0.95))]
TAIL_R = [2.45, 2.2, 1.95, 1.7, 1.48, 1.28, 1.1, 0.94, 0.8, 0.66, 0.54, 0.43, 0.32]
TAIL_PTS = [TAIL_PTS[0] + (p - TAIL_PTS[0]) * 0.66 for p in TAIL_PTS]
TAIL_R = [r * 0.95 for r in TAIL_R]
HEAD_BASE = NECK_PTS[-1]
SNOUT = H((0, -22.9, 15.3))

# head landmarks
EYE = H((1.0, -19.5, 16.66))
EYE_R = 0.23 * HK * 1.22
EYE_DIR = np.array((0.62, -0.72, 0.12)) / np.linalg.norm((0.62, -0.72, 0.12))
JAW_HINGE = H((0.0, -18.2, 15.35))
JAW_TIP = H((0.0, -22.55, 14.6))
MOUTH = dict(y_front=float(H((0, -23.0, 0))[1]), y_corner=float(H((0, -18.9, 0))[1]), z=float(H((0, 0, 15.12))[2]),
             x_max=1.45 * HK, z_lo=float(H((0, 0, 13.6))[2]), z_hi=float(H((0, 0, 16.4))[2]))
SHARD_C = np.array((0.0, -7.55, 8.15))      # where the heart-shard breaks through the sternum


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


CHAINS = {}
SHACKLES = {}

ICE_SHED = []


def _bones_left():
    out = [
        ('L_Scapula', 'Chest', (1.55, -3.7, 11.6), tuple(SHOULDER)),
        ('L_UpperArm', 'L_Scapula', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_ElbowFix', 'L_UpperArm', tuple(ELBOW), tuple(_lerp(ELBOW, WRIST, 0.3))),
        ('L_Hand', 'L_Forearm', tuple(WRIST), tuple(FPAW)),
        ('L_FToes', 'L_Hand', tuple(FPAW), tuple(FTOE)),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(HOCK)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, HOCK, 0.3))),
        ('L_Foot', 'L_Shin', tuple(HOCK), tuple(HPAW)),
        ('L_HockFix', 'L_Shin', tuple(HOCK), tuple(_lerp(HOCK, HPAW, 0.3))),
        ('L_HToes', 'L_Foot', tuple(HPAW), tuple(HTOE)),
        # the wing
        ('L_Humerus', 'Chest', tuple(W_SHOULDER), tuple(W_ELBOW)),
        ('L_WForearm', 'L_Humerus', tuple(W_ELBOW), tuple(W_WRIST)),
        ('L_WElbowFix', 'L_Humerus', tuple(W_ELBOW), tuple(_lerp(W_ELBOW, W_WRIST, 0.25))),
        ('L_WHand', 'L_WForearm', tuple(W_WRIST), tuple(W_KNUCKLE)),
        ('L_Thumb', 'L_WHand', tuple(W_WRIST), tuple(W_THUMB)),
    ]
    for f, pts in FINGERS.items():
        out.append((f'L_{f}a', 'L_WHand', tuple(pts[0]), tuple(pts[1])))
        out.append((f'L_{f}b', f'L_{f}a', tuple(pts[1]), tuple(pts[2])))
    f1 = FINGERS['F1']
    d = (f1[2] - f1[1]) / np.linalg.norm(f1[2] - f1[1])
    out.append(('L_WingTip', 'L_F1b', tuple(f1[2]), tuple(f1[2] + d * 0.6)))
    return out


def _chain_bones():
    out = []
    for name, (parent, anchor, pts) in CHAINS.items():
        prev, p0 = parent, np.array(anchor, float)
        for i, p in enumerate(pts):
            nm = f'{name}{i + 1}'
            out.append((nm, prev, tuple(p0), tuple(p)))
            prev, p0 = nm, np.array(p, float)
        last = np.array(pts[-1], float)
        d = last - np.array(pts[-2] if len(pts) > 1 else anchor, float)
        d /= np.linalg.norm(d)
        out.append((name + 'End', prev, tuple(last), tuple(last + d * 0.4)))
    return out


def _expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(head), tuple(tail)))
        if name.startswith('L_'):
            m = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            twin_parent = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], twin_parent, m(head), m(tail)))
    return out


BONES = _expand([
    ('Root', None, (0, 0, 0), (0, 0, 1.5)),
    ('Hips', 'Root', tuple(TAIL_PTS[0]), (0, 4.6, 10.6)),
    ('Spine1', 'Hips', (0, 4.6, 10.6), (0, 0.6, 11.0)),
    ('Spine2', 'Spine1', (0, 0.6, 11.0), (0, -3.4, 11.4)),
    ('Chest', 'Spine2', (0, -3.4, 11.4), tuple(NECK_PTS[0])),
    ('Belly', 'Spine1', (0, 1.6, 8.6), (0, 1.6, 7.4)),
    ('Shard', 'Chest', tuple(SHARD_C), tuple(SHARD_C + np.array((0, -1.0, 0)))),
] + [(f'Neck{i + 1}', 'Chest' if i == 0 else f'Neck{i}', tuple(NECK_PTS[i]), tuple(NECK_PTS[i + 1]))
     for i in range(6)] + [
    ('Head', 'Neck6', tuple(HEAD_BASE), tuple(SNOUT)),
    ('Jaw', 'Head', tuple(JAW_HINGE), tuple(JAW_TIP)),
    ('Mouth', 'Head', tuple(H((0, -22.75, 15.08))), tuple(H((0, -23.6, 15.03)))),
] + [(f'Tail{i + 1}', 'Hips' if i == 0 else f'Tail{i}', tuple(TAIL_PTS[i]), tuple(TAIL_PTS[i + 1]))
     for i in range(12)] + [
    ('TailTip', 'Tail12', tuple(TAIL_PTS[12]), tuple(TAIL_PTS[12] + np.array((0, 0.6, -0.05)))),
] + _bones_left() + _chain_bones() + ICE_SHED)


def _topo(bones):
    out, placed = [], set()
    pending = list(bones)
    while pending:
        rest = []
        for b in pending:
            if b[1] is None or b[1] in placed:
                out.append(b)
                placed.add(b[0])
            else:
                rest.append(b)
        if len(rest) == len(pending):
            raise RuntimeError(f'unparented bones: {[b[0] for b in rest]}')
        pending = rest
    return out


BONES = _topo(BONES)
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
PARENT = {n: p for n, p, _, _ in BONES}


# ------------------------------------------------------------------ helpers
def _m(p, s):
    p = np.asarray(p, dtype=float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def seg_frame(a, b):
    """Rotation whose z column runs a -> b and whose x column is the body's lateral axis."""
    z = np.asarray(b, float) - np.asarray(a, float)
    z /= np.linalg.norm(z)
    x = np.array((1.0, 0, 0))
    x = x - z * (x @ z)
    if np.linalg.norm(x) < 1e-6:
        x = np.array((0, 1.0, 0)) - z * z[1]
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def neck_at(t):
    """A point and radius along the neck polyline, t in 0..1."""
    seg = t * (len(NECK_PTS) - 1)
    i = min(int(seg), len(NECK_PTS) - 2)
    u = seg - i
    return _lerp(NECK_PTS[i], NECK_PTS[i + 1], u), NECK_R[i] + (NECK_R[i + 1] - NECK_R[i]) * u


def tail_at(t):
    seg = t * (len(TAIL_PTS) - 1)
    i = min(int(seg), len(TAIL_PTS) - 2)
    u = seg - i
    return _lerp(TAIL_PTS[i], TAIL_PTS[i + 1], u), TAIL_R[i] + (TAIL_R[i + 1] - TAIL_R[i]) * u


# ------------------------------------------------------------------ body sculpt
BODY_BOX = ((-7.2, -24.4, -0.2), (7.2, 31.2, 21.0))


def build_body(voxel=0.075, detail=True, seed=23):
    """The whole skin (wings excepted) as one distance field (rest pose)."""
    F = Field(BODY_BOX[0], BODY_BOX[1], voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, -2.9, 9.55), (3.25, 5.0, 3.05), bone='Chest'), 0.8)            # the deep ribcage
    F.add(Ellipsoid((0, -4.6, 11.4), (2.2, 2.6, 1.55), bone='Chest'), 0.7)             # withers
    F.add(Ellipsoid((0, -6.7, 8.5), (2.55, 1.9, 2.55), rot_matrix(rx=0.3), bone='Chest'), 0.7)  # breast
    F.add(Ellipsoid((0, -3.9, 6.75), (1.25, 3.6, 0.9), bone='Chest'), 0.6)             # the keel
    F.add(Ellipsoid((0, 1.3, 9.85), (2.35, 3.4, 2.0), bone='Spine2'), 0.9)              # waist, tucked (gaunt)
    F.add(Ellipsoid((0, 1.6, 8.35), (1.65, 2.6, 1.0), bone='Belly'), 0.8)               # the slack gut
    F.add(Ellipsoid((0, 4.6, 10.15), (2.4, 2.6, 1.9), bone='Spine1'), 0.8)              # loin
    F.add(Ellipsoid((0, 7.6, 9.75), (2.65, 2.6, 2.05), bone='Hips'), 0.8)               # pelvis
    F.add(Ellipsoid((0, 8.8, 10.5), (1.7, 1.8, 1.2), bone='Hips'), 0.6)                 # croup
    for a, b, bone, r in (((0, -7.0, 11.9), (0, -3.4, 12.25), 'Chest', 0.75),
                          ((0, -3.4, 12.25), (0, 0.6, 11.85), 'Spine2', 0.62),
                          ((0, 0.6, 11.85), (0, 4.6, 11.55), 'Spine1', 0.62),
                          ((0, 4.6, 11.55), (0, 8.4, 11.2), 'Hips', 0.7)):
        F.add(RoundCone(a, b, r, r, bone=bone), 0.7)                                     # the back line

    def torso_side(s):
        F.add(Ellipsoid(_m((1.85, -4.3, 11.25), s), (0.95, 1.7, 2.0), rot_matrix(rx=-0.45), bone=_side('Scapula', s)),
              0.45)                                                                     # shoulder blade
        F.add(Ellipsoid(_m((3.2, -5.1, 8.75), s), (1.4, 1.75, 2.1), rot_matrix(rx=0.18), bone=_side('UpperArm', s)),
              0.45)                                                                     # deltoid
        F.add(Ellipsoid(_m((2.75, 7.15, 8.65), s), (1.45, 2.5, 2.6), rot_matrix(rx=0.3), bone=_side('Thigh', s)),
              0.55)                                                                     # haunch
        F.add(Ellipsoid(_m((2.15, -1.8, 9.6), s), (1.25, 3.4, 2.3), bone='Chest'), 0.7)   # flank over the ribs
        F.add(Ellipsoid(_m((1.6, 6.3, 11.0), s), (0.9, 1.6, 0.8), bone='Hips'), 0.4)      # the hip bone pokes out
    for s in (1, -1):
        torso_side(s)

    # ---------------------------------------------------------------- neck
    for i in range(6):
        a, b = NECK_PTS[i], NECK_PTS[i + 1]
        F.add(RoundCone(a + (0, 0, -0.35 if i == 0 else 0), b, NECK_R[i], NECK_R[i + 1], bone=f'Neck{i + 1}'),
              0.6 if i == 0 else 0.35)
    for i in range(5):                                                                   # throat (the soft underside)
        c = _lerp(NECK_PTS[i], NECK_PTS[i + 1], 0.5)
        F.add(Ellipsoid(c + (0, 0, -NECK_R[i] * 0.42), (NECK_R[i] * 0.72, NECK_R[i] * 0.62, 1.2),
                        seg_frame(NECK_PTS[i], NECK_PTS[i + 1]), bone=f'Neck{i + 1}'), 0.35)
    for i in range(6):                                                                   # nape muscle bands
        c = _lerp(NECK_PTS[i], NECK_PTS[i + 1], 0.5)
        for s in (1, -1):
            F.add(Ellipsoid(c + _m((NECK_R[i] * 0.42, 0.0, NECK_R[i] * 0.3), s),
                            (NECK_R[i] * 0.48, NECK_R[i] * 0.55, 1.25),
                            seg_frame(NECK_PTS[i], NECK_PTS[i + 1]), bone=f'Neck{i + 1}'), 0.3)

    # ---------------------------------------------------------------- head
    # A long wedge of a skull: a flat crown, a heavy brow that scowls down over
    # deep-set eyes, cheekbones that flare back toward the crown of spikes, a long
    # narrowing muzzle with the nostrils at its tip, a deep hard lower jaw.
    k = HK
    F.add(Ellipsoid(H((0, -18.3, 16.5)), HR((1.5, 1.95, 1.18)), bone='Head'), 0.35)          # cranium, flat
    F.add(Ellipsoid(H((0, -17.5, 16.35)), HR((1.3, 1.25, 1.15)), bone='Neck6'), 0.45)        # occiput into the neck
    F.add(Ellipsoid(H((0, -20.3, 16.05)), HR((1.08, 2.45, 0.78)), rot_matrix(rx=0.16), bone='Head'), 0.3)  # muzzle
    F.add(Ellipsoid(H((0, -22.35, 15.42)), HR((0.64, 1.05, 0.46)), rot_matrix(rx=0.16), bone='Head'), 0.25)  # snout tip
    F.add(RoundCone(H((0, -18.6, 17.25)), H((0, -22.45, 15.95)), 0.48 * k, 0.24 * k, bone='Head'), 0.25)  # nasal ridge
    for j in range(4):                                                                     # bosses down the ridge
        F.add(Sphere(H((0, -19.4 - 0.85 * j, 17.0 - 0.3 * j)), 0.2 * k, bone='Head'), 0.12)
    for s in (1, -1):
        # the heavy brow: a hard ridge over the eye from the nose bridge to the horn root
        F.add(RoundCone(H(_m((0.5, -20.9, 16.62), s)), H(_m((1.18, -18.75, 17.3), s)), 0.17 * k, 0.27 * k,
                        bone='Head'), 0.12)
        F.add(RoundCone(H(_m((1.18, -18.75, 17.3), s)), H(_m((1.05, -17.9, 17.25), s)), 0.27 * k, 0.22 * k,
                        bone='Head'), 0.1)
        F.add(Ellipsoid(H(_m((1.3, -18.8, 15.98), s)), HR((0.52, 1.5, 0.5)), rot_matrix(rz=-0.12 * s), bone='Head'), 0.2)
        F.add(Ellipsoid(H(_m((1.25, -18.25, 15.35), s)), HR((0.6, 1.0, 0.7)), bone='Jaw'), 0.25)    # masseter
        F.add(Ellipsoid(H(_m((0.36, -22.6, 15.62), s)), HR((0.26, 0.4, 0.22)), bone='Head'), 0.1)    # nostril boss
        F.add(Ellipsoid(H(_m((0.78, -20.9, 15.28), s)), HR((0.36, 1.85, 0.3)), bone='Head'), 0.18)    # upper lip ridge
        F.add(RoundCone(H(_m((1.45, -18.6, 16.15), s)), H(_m((1.75, -16.9, 16.6), s)), 0.28 * k, 0.12 * k,
                        bone='Head'), 0.12)                                                 # back-swept cheekbone
    # the lower jaw: deep and long, narrowing to a hard chin
    F.add(Ellipsoid(H((0, -19.85, 14.78)), HR((0.95, 2.55, 0.42)), rot_matrix(rx=-0.02), bone='Jaw'), 0.22)
    F.add(Ellipsoid(H((0, -21.75, 14.74)), HR((0.46, 0.55, 0.3)), bone='Jaw'), 0.15)
    for s in (1, -1):
        F.add(RoundCone(H(_m((1.05, -18.4, 15.0), s)), H(_m((0.45, -21.9, 14.85), s)), 0.34 * k, 0.18 * k, bone='Jaw'),
              0.16)
    # the mouth line, the eye sockets, the nostrils
    F.sub(Ellipsoid(H((0, -21.0, 15.12)), HR((1.42, 2.3, 0.07))), 0.05)
    for s in (1, -1):
        F.sub(Ellipsoid(_m(EYE, s) + _m((0.05, -0.05, 0), s), (EYE_R + 0.1, EYE_R + 0.16, EYE_R * 0.8 + 0.06)), 0.08)
        F.sub(Ellipsoid(H(_m((0.38, -22.8, 15.72), s)), HR((0.12, 0.2, 0.1))), 0.05)

    # ---------------------------------------------------------------- legs
    def leg(s):
        sh, el, wr, fp = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s), _m(FPAW, s)
        ua, fa, hand, ft = _side('UpperArm', s), _side('Forearm', s), _side('Hand', s), _side('FToes', s)
        F.add(RoundCone(sh + (0, 0, 0.4), el, 1.85, 1.2, bone=ua), 0.45)
        F.add(Ellipsoid(_lerp(sh, el, 0.5) + np.array((0.12 * s, 0.55, 0)), (1.15, 1.2, 1.8), seg_frame(sh, el),
                        bone=ua), 0.3)                                                    # triceps
        F.add(Sphere(el + np.array((0, 0.32, 0.05)), 1.08, bone=_side('ElbowFix', s)), 0.3)
        F.add(RoundCone(el, wr, 1.3, 0.88, bone=fa), 0.3)
        F.add(Ellipsoid(_lerp(el, wr, 0.3) + np.array((0.05 * s, -0.25, 0)), (1.28, 1.15, 1.5), seg_frame(el, wr),
                        bone=fa), 0.25)                                                   # forearm mass
        F.add(RoundCone(wr, fp + (0, 0.05, 0.12), 0.88, 0.85, bone=hand), 0.2)
        F.add(Ellipsoid(fp + np.array((0, 0.05, 0.05)), (1.1, 1.1, 0.58), bone=hand), 0.2)   # the hand's pad
        for k, a in enumerate(np.linspace(-38, 38, 3)):                                    # three long front fingers
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            base = fp + d * 0.45
            tip = fp + d * (1.55 if k == 1 else 1.35) + np.array((0, 0, -0.18))
            F.add(RoundCone(base, tip, 0.42, 0.27, bone=ft), 0.12)
            F.add(Sphere(_lerp(base, tip, 0.55) + (0, 0, 0.14), 0.33, bone=ft), 0.08)       # the knuckle
        F.add(RoundCone(fp + _m((0.55, 0.35, 0.1), s), fp + _m((0.95, 0.85, -0.12), s), 0.25, 0.17, bone=hand), 0.1)
        hp, kn, hk, hpw = _m(HIP, s), _m(KNEE, s), _m(HOCK, s), _m(HPAW, s)
        th_, sn, fo, ht = _side('Thigh', s), _side('Shin', s), _side('Foot', s), _side('HToes', s)
        F.add(RoundCone(hp + (0, 0.2, 0.5), kn, 2.2, 1.25, bone=th_), 0.5)
        F.add(Ellipsoid(_lerp(hp, kn, 0.45) + np.array((0.1 * s, 0.95, -0.15)), (1.3, 1.4, 2.1), seg_frame(hp, kn),
                        bone=th_), 0.3)                                                   # hamstring
        F.add(Ellipsoid(_lerp(hp, kn, 0.55) + np.array((0, -0.45, 0)), (0.9, 0.85, 1.5), seg_frame(hp, kn),
                        bone=th_), 0.3)                                                   # quadriceps
        F.add(Sphere(kn + np.array((0, -0.2, 0.0)), 1.0, bone=_side('KneeFix', s)), 0.3)
        F.add(RoundCone(kn, hk, 1.22, 0.76, bone=sn), 0.25)
        F.add(Ellipsoid(_lerp(kn, hk, 0.3) + np.array((0, 0.45, 0.15)), (1.0, 1.05, 1.5), seg_frame(kn, hk), bone=sn),
              0.25)                                                                       # calf
        F.add(Sphere(hk + np.array((0, 0.18, 0.05)), 0.76, bone=_side('HockFix', s)), 0.18)
        F.add(RoundCone(hk, hpw + (0, 0.05, 0.12), 0.76, 0.8, bone=fo), 0.2)
        F.add(Ellipsoid(hpw + np.array((0, 0.05, 0.05)), (1.02, 1.05, 0.56), bone=fo), 0.2)
        for k, a in enumerate(np.linspace(-34, 34, 3)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            base = hpw + d * 0.42
            tip = hpw + d * (1.5 if k == 1 else 1.3) + np.array((0, 0, -0.18))
            F.add(RoundCone(base, tip, 0.4, 0.26, bone=ht), 0.12)
            F.add(Sphere(_lerp(base, tip, 0.55) + (0, 0, 0.14), 0.32, bone=ht), 0.08)
        F.add(RoundCone(hpw + _m((0.15, 0.6, 0.1), s), hpw + _m((0.25, 1.25, -0.1), s), 0.24, 0.16, bone=fo), 0.1)
    for s in (1, -1):
        leg(s)

    # ---------------------------------------------------------------- tail
    for i in range(12):
        F.add(RoundCone(TAIL_PTS[i], TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'),
              0.8 if i == 0 else 0.3)
    F.add(Ellipsoid(TAIL_PTS[12] + (0, 0.1, 0.0), (0.42, 0.75, 0.3), bone='Tail12'), 0.15)   # a flattened tail-end

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (12, 40, 1.0), radius=0.0), 0.05)
    if detail:
        _skin_detail(F, noise, seed)
    return F


WING_BOX = ((0.4, -5.4, 10.2), (18.4, 3.0, 17.0))


def build_wing(voxel=0.06, s=1, seed=31):
    """One wing's arm (humerus, forearm, hand) as its own field; the fingers are tubes
    (dressing) and the membrane a skinned sheet. The root buries itself in the back."""
    lo, hi = np.array(WING_BOX[0]), np.array(WING_BOX[1])
    if s < 0:
        lo, hi = np.array((-hi[0], lo[1], lo[2])), np.array((-lo[0], hi[1], hi[2]))
    F = Field(lo, hi, voxel)
    sh, el, wr, kn = _m(W_SHOULDER, s), _m(W_ELBOW, s), _m(W_WRIST, s), _m(W_KNUCKLE, s)
    hu, fa, hd = _side('Humerus', s), _side('WForearm', s), _side('WHand', s)
    F.add(Ellipsoid(_m((1.55, -3.5, 11.6), s), (0.9, 1.6, 1.0), bone='Chest'), 0.3)    # root buried in the back
    F.add(Sphere(sh, 1.15, bone=hu), 0.5)
    F.add(RoundCone(sh, el, 1.05, 0.62, bone=hu), 0.4)
    F.add(Ellipsoid(_lerp(sh, el, 0.38) + _m((0.0, -0.25, 0.25), s), (0.85, 0.9, 1.9), seg_frame(sh, el), bone=hu), 0.3)
    F.add(Sphere(el, 0.72, bone=_side('WElbowFix', s)), 0.25)
    F.add(RoundCone(el, wr, 0.62, 0.42, bone=fa), 0.2)
    F.add(Ellipsoid(_lerp(el, wr, 0.22) + _m((0, -0.12, 0.05), s), (0.6, 0.7, 1.7), seg_frame(el, wr), bone=fa), 0.2)
    F.add(RoundCone(wr, kn, 0.48, 0.5, bone=hd), 0.15)
    F.add(Ellipsoid(kn, (0.58, 0.55, 0.45), bone=hd), 0.15)                              # the knuckle
    F.add(RoundCone(wr + _m((0.1, -0.1, 0), s), _m(W_THUMB, s), 0.36, 0.2, bone=_side('Thumb', s)), 0.12)
    noise = Noise(seed)
    F.displace(lambda X, Y, Z: 0.018 * noise.fbm(X * 1.4, Y * 1.4, Z * 1.4, octaves=3)
               + 0.008 * noise(X * 9 + 2, Y * 9, Z * 9), band=0.1)
    return F


# ------------------------------------------------------------------ detail
def _project(F, origin, toward, inset=0.02):
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 9.0:
        t += F.voxel * 0.5
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return np.asarray(toward, float)


def _groove_line(F, pts, depth, k):
    F.groove(Polyline(pts, 0.01), depth, k=k)


def _ridge_line(F, pts, h, k):
    F.ridge(Polyline(pts, 0.01), h, k=k)


SCAR_LINES = []   # the projected scar polylines (surface.py paints them)
RIB_LINES = []


def _skin_detail(F, noise, seed):
    SCAR_LINES.clear()
    RIB_LINES.clear()
    # the ribs showing through the flanks (gaunt): ridges with grooves between
    for s in (1, -1):
        for k in range(8):
            y0 = -6.3 + k * 1.05
            pts = []
            for j in range(7):
                u = j / 6
                ang = math.radians(12 + 108 * u)
                o = np.array((0.0, y0 + 0.5 * u, 9.6))
                tow = o + np.array((math.sin(ang) * 6 * s, 0.5 + 0.9 * u, math.cos(ang) * 6))
                pts.append(_project(F, o, tow))
            if k >= 2:
                _ridge_line(F, pts[1:-1], 0.075, 0.2)
                RIB_LINES.append(pts[1:-1])
    # the belly's transverse plates: grooves across the underside of the chest and waist
    for k in range(18):
        y = -7.6 + 0.92 * k
        pts = [_project(F, (0, y, 9.0), (x, y + 0.1 * abs(x), 3.0)) for x in np.linspace(-2.2, 2.2, 7)]
        _groove_line(F, pts, 0.045, 0.07)
    # the throat's plates up the underside of the neck
    for k in range(12):
        t = 0.04 + k * 0.08
        c, r = neck_at(t)
        pts = [_project(F, c, c + np.array((x, 0, -r * 1.8))) for x in np.linspace(-r * 0.8, r * 0.8, 6)]
        _groove_line(F, pts, 0.04, 0.06)
    # the tail's underside plates
    for k in range(20):
        t = 0.03 + k * 0.048
        c, r = tail_at(t)
        pts = [_project(F, c, c + np.array((x, 0, -r * 1.8))) for x in np.linspace(-r * 0.75, r * 0.75, 5)]
        _groove_line(F, pts, 0.035, 0.05)
    # old wounds of the Smith's war: three long gouges down the left flank, a burn
    # scar across the right shoulder
    for k in range(3):
        a = np.array((4.0, -3.4 + 1.1 * k, 12.0))
        b = np.array((4.0, -1.1 + 1.3 * k, 7.4))
        pts = [_project(F, (0, *_lerp(a, b, t)[1:]), _lerp(a, b, t) + np.array((2.0, 0, 0))) for t in np.linspace(0, 1, 9)]
        F.ridge(Polyline(pts, 0.01), 0.06, k=0.16)
        F.groove(Polyline(pts, 0.01), 0.07, k=0.06)
        SCAR_LINES.append(pts)
    sh = [_project(F, (0, -6.0, 10.6), (-6.0, -6.4, 11.4)), _project(F, (0, -5.0, 10.0), (-6.0, -5.0, 10.6)),
          _project(F, (0, -4.0, 9.2), (-6.0, -3.6, 9.0)), _project(F, (0, -3.2, 8.4), (-6.0, -2.6, 7.6))]
    F.ridge(Polyline(sh, 0.01), 0.05, k=0.2)
    SCAR_LINES.append(sh)
    # muscle separations on the legs
    for s in (1, -1):
        _groove_line(F, [_project(F, _m((2.0, -5.4, 9.0), s), _m((6.0, -5.6, 9.4), s)),
                         _project(F, _m((2.2, -4.8, 7.4), s), _m((6.0, -4.6, 7.0), s)),
                         _project(F, _m((2.4, -4.2, 6.0), s), _m((6.0, -4.0, 5.6), s))], 0.05, 0.12)
        _groove_line(F, [_project(F, _m((1.6, 6.4, 10.0), s), _m((6.0, 6.9, 10.0), s)),
                         _project(F, _m((1.6, 7.6, 8.2), s), _m((6.0, 8.2, 8.0), s)),
                         _project(F, _m((1.8, 7.2, 6.6), s), _m((6.0, 7.6, 6.2), s))], 0.05, 0.14)
    # scaled hide: big soft scale bulges (the fine scales are in the bake)
    F.displace(lambda X, Y, Z: 0.05 * noise.fbm(X * 0.55, Y * 0.55, Z * 0.55, octaves=3)
               + 0.018 * noise.fbm(X * 3.2 + 3, Y * 3.2, Z * 3.2, octaves=2), band=0.3)


def nearest_bone(p, candidates=None):
    """The bone whose rest segment is nearest a point (for rigid dressing)."""
    p = np.asarray(p, float)
    best, bd = None, 1e9
    for n, (h, t) in REST.items():
        if candidates is not None and n not in candidates:
            continue
        ab = t - h
        u = np.clip((p - h) @ ab / max(1e-9, ab @ ab), 0, 1)
        d = np.linalg.norm(p - (h + ab * u))
        if d < bd:
            best, bd = n, d
    return best


# ------------------------------------------------------------------ review/gate hooks (kit review.py)
# The whelp is built at the Korzul kit's size and scaled down at the end (build.py
# WHELP_HEIGHT); WHELP_K is that factor, measured on the build (stats.json).
WHELP_K = 0.172
FEET = ('L_FToes', 'R_FToes', 'L_HToes', 'R_HToes')
SOLE_Z = 0.62 * WHELP_K + 0.03
TREMOR_KEYS = ('Scapula', 'UpperArm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Foot', 'Neck', 'Head', 'Spine', 'Chest',
               'Humerus', 'WForearm', 'WHand')
ROLL_GATE = {}
POP_SKIP = ('Tail1', 'Belly', 'F1', 'F2', 'F3', 'F4', 'Thumb', 'WingTip')
FREE_END = ('Death',)
