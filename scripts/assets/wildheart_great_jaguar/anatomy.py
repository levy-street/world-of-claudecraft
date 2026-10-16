"""The Great Jaguar's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Balgath and Great Saurian kits this builder is
adapted from): Blender units are yards, +Z up, the cat FACES -Y (the game's +Z
after the glTF export), its left is +X. Bones are (name, parent, head, tail);
`L_` bones are mirrored onto `R_` (x -> -x).

A heavy, KayKit-chunky big cat at its in-game size: about 3.4 yards at the
withers, the head top about 4.4 yards at an alert idle (the KayKit knight is
2.6), 7.6 yards nose to rump plus a 4.6-yard tail. Digitigrade legs: the front
leg is scapula, upper arm, forearm, a short metacarpus (Hand) and the toes; the
hind leg is thigh, shin, a long metatarsus (Foot, the hock held off the ground)
and the toes.

Bones beside the body:
  * ElbowFix / KneeFix / HockFix: joint helpers, half their twin's bend (rig.py
    keys them), so the elbow, the stifle and the hock keep their volume.
  * Belly: the primordial pouch (a spring).
  * Charm1/Charm2: the bone charms under the throat (a spring chain).
  * EarCharmL: the bone charm hanging from the left ear (a spring).
  * BondAnchor: the collar's bone ring where the jade spirit cord attaches.
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

# ------------------------------------------------------------------ landmarks
SHOULDER = np.array((0.72, -2.08, 2.38))
ELBOW = np.array((0.8, -1.7, 1.36))
WRIST = np.array((0.8, -2.04, 0.44))
FPAW = np.array((0.8, -2.26, 0.17))       # the front paw's ball (Hand tail)
FTOE = np.array((0.8, -2.62, 0.12))       # the front toes' tip
HIP = np.array((0.72, 1.97, 2.62))
KNEE = np.array((0.84, 1.39, 1.62))
HOCK = np.array((0.8, 2.39, 0.9))
HPAW = np.array((0.8, 2.05, 0.17))         # the hind paw's ball (Foot tail)
HTOE = np.array((0.8, 1.71, 0.12))
HEAD_C = np.array((0.0, -4.3, 3.95))
HK = 1.16                                  # the head is sculpted at HK times its first size


def H(p):
    """A head-space point scaled about the head centre."""
    return HEAD_C + (np.asarray(p, float) - HEAD_C) * HK


EYE = H((0.265, -4.455, 4.04))             # the left eye's centre
EYE_R = 0.077 * HK
EYE_DIR = np.array((0.28, -1.0, 0.04)) / np.linalg.norm((0.28, -1.0, 0.04))

NECK_PTS = [np.array(p) for p in ((0, -2.5, 3.28), (0, -3.18, 3.68), (0, -3.74, 3.94))]
TAIL_PTS = [np.array(p) for p in ((0, 2.60, 3.04), (0, 3.15, 2.86), (0, 3.60, 2.5), (0, 3.93, 2.02), (0, 4.15, 1.5),
                                  (0, 4.33, 1.02), (0, 4.57, 0.66), (0, 4.91, 0.5), (0, 5.27, 0.6))]
TAIL_R = [0.36, 0.3, 0.26, 0.23, 0.21, 0.195, 0.185, 0.18, 0.15]

# The mouth: the slit the jaw opens on (rig.jaw_split reads it).
JAW_HINGE = H((0.0, -3.98, 3.62))
MOUTH = dict(y_front=float(H((0, -5.05, 0))[1]), y_corner=float(H((0, -4.22, 0))[1]),
             z=float(H((0, 0, 3.585))[2]), x_max=0.48 * HK, z_lo=3.0, z_hi=4.15)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    return [
        ('L_Scapula', 'Spine3', (0.42, -1.72, 3.22), tuple(SHOULDER)),
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
        ('L_Ear', 'Head', tuple(H((0.36, -3.86, 4.24))), tuple(H((0.48, -3.88, 4.55)))),
    ]


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
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 2.2, 3.0), (0, 0.9, 3.1)),
    ('Spine1', 'Hips', (0, 0.9, 3.1), (0, -0.45, 3.15)),
    ('Spine2', 'Spine1', (0, -0.45, 3.15), (0, -1.85, 3.12)),
    ('Spine3', 'Spine2', (0, -1.85, 3.12), tuple(NECK_PTS[0])),
    ('Belly', 'Spine1', (0, 0.1, 2.3), (0, 0.1, 1.9)),
    ('Neck1', 'Spine3', tuple(NECK_PTS[0]), tuple(NECK_PTS[1])),
    ('Neck2', 'Neck1', tuple(NECK_PTS[1]), tuple(NECK_PTS[2])),
    ('Head', 'Neck2', tuple(NECK_PTS[2]), tuple(H((0, -4.95, 3.86)))),
    ('Jaw', 'Head', tuple(JAW_HINGE), tuple(H((0, -4.9, 3.42)))),
    ('Charm1', 'Neck1', (0, -3.02, 2.98), (0, -3.05, 2.62)),
    ('Charm2', 'Charm1', (0, -3.05, 2.62), (0, -3.08, 2.26)),
    ('BondAnchor', 'Neck1', (0, -2.78, 4.02), (0, -2.78, 4.3)),
    ('EarCharmL', 'L_Ear', tuple(H((0.5, -3.86, 4.3))), tuple(H((0.55, -3.87, 4.02)))),
] + [(f'Tail{i + 1}', 'Hips' if i == 0 else f'Tail{i}', tuple(TAIL_PTS[i]), tuple(TAIL_PTS[i + 1]))
     for i in range(8)] + _bones_left())


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
    """Rotation whose z column runs a -> b and whose x column is the body's lateral
    axis (+X), for limbs and neck segments lying in a YZ plane."""
    z = np.asarray(b, float) - np.asarray(a, float)
    z /= np.linalg.norm(z)
    x = np.array((1.0, 0, 0))
    x = x - z * (x @ z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


# ------------------------------------------------------------------ body sculpt
def build_body(voxel=0.02, detail=True, seed=17):
    """The whole skin as one distance field (rest pose)."""
    F = Field((-1.75, -5.3, -0.12), (1.75, 6.05, 4.95), voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, -1.45, 2.5), (1.08, 1.32, 0.95), bone='Spine2'), 0.32)          # rib cage, deep
    F.add(Ellipsoid((0, -2.05, 3.06), (0.68, 0.62, 0.42), bone='Spine3'), 0.25)         # withers
    F.add(Ellipsoid((0, -2.42, 2.22), (0.7, 0.5, 0.72), rot_matrix(rx=0.25), bone='Spine3'), 0.28)  # chest front
    F.add(Ellipsoid((0, 0.25, 2.66), (0.86, 1.25, 0.7), bone='Spine1'), 0.38)            # the loin, tucked
    F.add(Ellipsoid((0, 0.1, 2.08), (0.62, 1.05, 0.34), bone='Belly'), 0.32)             # the belly pouch
    F.add(Ellipsoid((0, 1.8, 2.76), (0.93, 0.95, 0.7), bone='Hips'), 0.34)               # pelvis
    F.add(Ellipsoid((0, 2.25, 3.0), (0.6, 0.6, 0.38), bone='Hips'), 0.25)               # croup
    for a, b, bone in (((0, -2.3, 3.36), (0, -0.6, 3.24), 'Spine2'), ((0, -0.6, 3.24), (0, 1.0, 3.24), 'Spine1'),
                       ((0, 1.0, 3.24), (0, 2.4, 3.22), 'Hips')):
        F.add(RoundCone(a, b, 0.2, 0.2, bone=bone), 0.3)                                  # the back line

    def torso_side(s):
        # the shoulder blade rides high on the withers (it rolls up when it stalks)
        F.add(Ellipsoid(_m((0.56, -1.98, 2.86), s), (0.3, 0.5, 0.66), rot_matrix(rx=-0.42), bone=_side('Scapula', s)),
              0.18)
        # the big shoulder muscle over the upper arm
        F.add(Ellipsoid(_m((0.74, -2.12, 2.18), s), (0.38, 0.5, 0.6), rot_matrix(rx=0.2), bone=_side('UpperArm', s)),
              0.16)
        F.add(Ellipsoid(_m((0.7, 1.77, 2.36), s), (0.43, 0.8, 0.8), rot_matrix(rx=0.3), bone=_side('Thigh', s)),
              0.2)                                                                         # the haunch
        F.add(Ellipsoid(_m((0.62, -0.6, 2.56), s), (0.4, 1.2, 0.7), bone='Spine2'), 0.26)  # flank over the ribs
    for s in (1, -1):
        torso_side(s)

    # ---------------------------------------------------------------- neck
    F.add(RoundCone((0, -2.3, 2.96), NECK_PTS[1] + (0, 0, -0.12), 0.74, 0.58, bone='Neck1'), 0.3)
    F.add(RoundCone(NECK_PTS[1] + (0, 0, -0.12), (0, -3.8, 3.82), 0.58, 0.5, bone='Neck2'), 0.2)
    F.add(Ellipsoid((0, -3.0, 3.02), (0.44, 0.55, 0.38), rot_matrix(rx=0.35), bone='Neck1'), 0.22)   # throat
    F.add(Ellipsoid((0, -2.86, 3.7), (0.42, 0.62, 0.3), rot_matrix(rx=-0.45), bone='Neck1'), 0.22)   # nape muscle

    # ---------------------------------------------------------------- head
    # A broad, heavy big-cat head: wide jowls, a deep muzzle, a hard brow that
    # scowls toward the nose, a domed skull between the ears.
    k = HK
    F.add(Ellipsoid(H((0, -4.02, 4.02)), np.array((0.5, 0.54, 0.44)) * k, bone='Head'), 0.14)          # cranium
    F.add(Ellipsoid(H((0, -4.33, 4.1)), np.array((0.42, 0.3, 0.28)) * k, rot_matrix(rx=0.25), bone='Head'), 0.12)
    F.add(Ellipsoid(H((0, -4.6, 3.74)), np.array((0.32, 0.31, 0.25)) * k, bone='Head'), 0.1)            # muzzle
    F.add(RoundCone(H((0, -4.3, 4.12)), H((0, -4.82, 3.9)), 0.17 * k, 0.125 * k, bone='Head'), 0.1)    # nose bridge
    F.add(Ellipsoid(H((0, -4.88, 3.88)), np.array((0.12, 0.07, 0.07)) * k, bone='Head'), 0.05)        # nose leather
    for s in (1, -1):
        F.add(Ellipsoid(H(_m((0.37, -4.24, 3.84), s)), np.array((0.3, 0.37, 0.28)) * k, bone='Head'), 0.12)  # jowl
        F.add(Ellipsoid(H(_m((0.16, -4.75, 3.69), s)), np.array((0.165, 0.15, 0.14)) * k, bone='Head'), 0.06)
        F.add(Ellipsoid(H(_m((0.24, -4.46, 4.14), s)), np.array((0.22, 0.14, 0.085)) * k,
                        rot_matrix(ry=-0.5 * s, rx=-0.1), bone='Head'), 0.05)                           # the scowl
        # a heavy upper lid slanting down to the nose: the eye narrows to a glare
        F.add(Ellipsoid(_m(EYE, s) + np.array((0.0, -0.012, 0.05 * k)), np.array((0.105, 0.07, 0.04)) * k,
                        rot_matrix(ry=-0.4 * s, rx=-0.15), bone='Head'), 0.025)
        F.add(Ellipsoid(H(_m((0.3, -4.1, 3.5), s)), np.array((0.2, 0.36, 0.17)) * k, bone='Jaw'), 0.1)  # masseter
        # cheek ruff: fur tufts sweeping back off the jowls
        for c, r, rz in (((0.5, -3.98, 3.7), (0.17, 0.32, 0.21), 0.5), ((0.47, -3.78, 3.52), (0.15, 0.32, 0.17), 0.6),
                         ((0.44, -3.72, 3.82), (0.13, 0.28, 0.16), 0.4)):
            F.add(Ellipsoid(H(_m(c, s)), np.array(r) * k, rot_matrix(rz=rz * s, rx=-0.2), bone='Head'), 0.07)
    # the jaw
    F.add(Ellipsoid(H((0, -4.48, 3.47)), np.array((0.29, 0.44, 0.14)) * k, rot_matrix(rx=0.06), bone='Jaw'), 0.08)
    F.add(Ellipsoid(H((0, -4.8, 3.49)), np.array((0.18, 0.13, 0.12)) * k, bone='Jaw'), 0.06)            # chin
    # mouth slit, eye sockets, nostrils
    F.sub(Ellipsoid(H((0, -4.62, 3.585)), np.array((0.36, 0.42, 0.022)) * k), 0.02)
    for s in (1, -1):
        F.sub(Sphere(_m(EYE, s) + (0, -0.02, 0), EYE_R + 0.03), 0.035)
        F.sub(Ellipsoid(H(_m((0.06, -4.95, 3.86), s)), np.array((0.035, 0.05, 0.03)) * k), 0.02)

    # ---------------------------------------------------------------- ears
    for s in (1, -1):
        ec = H(_m((0.43, -3.86, 4.33), s))
        R = rot_matrix(rx=0.15, ry=-0.5 * s, rz=0.45 * s)
        F.add(Ellipsoid(ec, np.array((0.155, 0.06, 0.15)) * k, R, bone=_side('Ear', s)), 0.06)
        F.sub(Ellipsoid(ec + R @ np.array((0, -0.045, 0.015)), np.array((0.105, 0.04, 0.105)) * k, R), 0.02)
    # the old torn notch in the left ear
    F.sub(Sphere(H((0.57, -3.86, 4.42)), 0.05), 0.015)

    # ---------------------------------------------------------------- legs
    def leg(s):
        sh, el, wr, fp = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s), _m(FPAW, s)
        ua, fa, hand, ft = _side('UpperArm', s), _side('Forearm', s), _side('Hand', s), _side('FToes', s)
        F.add(RoundCone(sh + (0, 0, 0.12), el, 0.52, 0.38, bone=ua), 0.16)
        F.add(Ellipsoid(_lerp(sh, el, 0.55) + np.array((0.04 * s, 0.2, 0)), (0.31, 0.34, 0.5), seg_frame(sh, el),
                        bone=ua), 0.12)                                                     # triceps
        F.add(Sphere(el + np.array((0, 0.11, 0.02)), 0.29, bone=_side('ElbowFix', s)), 0.1)
        F.add(RoundCone(el, wr, 0.41, 0.3, bone=fa), 0.12)
        F.add(Ellipsoid(_lerp(el, wr, 0.27) + np.array((0, -0.07, 0)), (0.4, 0.36, 0.46), seg_frame(el, wr), bone=fa),
              0.1)                                                                          # heavy forearm
        F.add(RoundCone(wr, fp + (0, 0.02, 0.04), 0.3, 0.32, bone=hand), 0.08)
        F.add(Ellipsoid(fp + np.array((0, 0.02, 0.02)), (0.35, 0.34, 0.17), bone=hand), 0.08)   # the paw's palm
        for k, a in enumerate(np.linspace(-46, 46, 4)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            c = fp + d * 0.29 + np.array((0, -0.08, -0.035))
            F.add(Ellipsoid(c, (0.12, 0.15, 0.11), frame_from(d), bone=ft), 0.04)           # toes
        hp, kn, hk, hpw = _m(HIP, s), _m(KNEE, s), _m(HOCK, s), _m(HPAW, s)
        th_, sn, fo, ht = _side('Thigh', s), _side('Shin', s), _side('Foot', s), _side('HToes', s)
        F.add(RoundCone(hp + (0, 0.05, 0.2), kn, 0.62, 0.36, bone=th_), 0.18)
        F.add(Ellipsoid(_lerp(hp, kn, 0.45) + np.array((0.04 * s, 0.34, -0.05)), (0.37, 0.44, 0.64), seg_frame(hp, kn),
                        bone=th_), 0.12)                                                    # hamstring
        F.add(Ellipsoid(_lerp(hp, kn, 0.55) + np.array((0, -0.16, 0)), (0.3, 0.28, 0.48), seg_frame(hp, kn),
                        bone=th_), 0.12)                                                    # quadriceps
        F.add(Sphere(kn + np.array((0, -0.06, 0.0)), 0.26, bone=_side('KneeFix', s)), 0.1)
        F.add(RoundCone(kn, hk, 0.35, 0.23, bone=sn), 0.1)
        F.add(Ellipsoid(_lerp(kn, hk, 0.3) + np.array((0, 0.16, 0.06)), (0.28, 0.3, 0.44), seg_frame(kn, hk), bone=sn),
              0.1)                                                                          # calf
        F.add(Sphere(hk + np.array((0, 0.05, 0.02)), 0.2, bone=_side('HockFix', s)), 0.06)  # the point of the hock
        F.add(RoundCone(hk, hpw + (0, 0.02, 0.04), 0.23, 0.28, bone=fo), 0.08)
        F.add(Ellipsoid(hpw + np.array((0, 0.02, 0.02)), (0.31, 0.31, 0.16), bone=fo), 0.08)
        for k, a in enumerate(np.linspace(-42, 42, 4)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            c = hpw + d * 0.26 + np.array((0, -0.07, -0.04))
            F.add(Ellipsoid(c, (0.11, 0.135, 0.1), frame_from(d), bone=ht), 0.04)
    for s in (1, -1):
        leg(s)

    # ---------------------------------------------------------------- tail
    for i in range(8):
        F.add(RoundCone(TAIL_PTS[i], TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'),
              0.28 if i == 0 else 0.1)
    F.add(Ellipsoid(TAIL_PTS[8] + (0, -0.05, 0.0), (0.15, 0.2, 0.15), bone='Tail8'), 0.06)   # the tip, a little full

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (4, 8, 1.0), radius=0.0), 0.02)

    if detail:
        _skin_detail(F, noise, seed)
    return F


# ------------------------------------------------------------------ detail
def _project(F, origin, toward, inset=0.008):
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 3.0:
        t += F.voxel * 0.5
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return np.asarray(toward, float)


def _scar(F, pts, width=0.025, depth=0.016):
    line = Polyline(pts, 0.004)
    F.ridge(line, depth * 1.3, k=width * 1.5)
    F.groove(line, depth * 0.9, k=width * 0.45)


def _groove_line(F, pts, depth, k):
    F.groove(Polyline(pts, 0.003), depth, k=k)


SCAR_LINES = []   # the projected scar polylines (surface.py paints them)
SCARS = [  # the old claw rake across the muzzle: (from, to) aimed at the head centre
    ((0.42, -4.42, 4.32), (-0.05, -4.98, 3.78)),
    ((0.47, -4.33, 4.15), (0.02, -4.9, 3.6)),
    ((0.5, -4.24, 3.98), (0.12, -4.78, 3.48)),
]


def _skin_detail(F, noise, seed):
    SCAR_LINES.clear()
    rng = np.random.default_rng(seed)
    hc = HEAD_C
    # the claw rake across the muzzle: three parallel scars from over the left eye
    # down across the nose bridge to the right lip
    for a, b in SCARS:
        a, b = H(a), H(b)
        pts = []
        for t in np.linspace(0, 1, 7):
            p = _lerp(a, b, t)
            pts.append(_project(F, hc + (p - hc) * 0.3, p + (p - hc) * 0.6))
        _scar(F, pts, width=0.024, depth=0.016)
        SCAR_LINES.append(pts)
    # a pale slash across the right shoulder
    sh = [_project(F, (-0.2, -2.3, 2.6), (-1.5, -2.4, 3.0)), _project(F, (-0.2, -2.0, 2.5), (-1.5, -1.95, 2.55)),
          _project(F, (-0.2, -1.6, 2.4), (-1.5, -1.5, 2.1))]
    _scar(F, sh, width=0.03, depth=0.018)
    SCAR_LINES.append(sh)
    # neck skin folds (loose skin behind the jowls)
    for t, dz in ((0.25, 0.0), (0.55, 0.05)):
        c = _lerp((0, -2.6, 3.2), (0, -3.6, 3.75), t)
        for s in (1, -1):
            pts = [_project(F, c + (0, 0, dz), c + np.array((1.2 * s, 0.1 * math.sin(k), 0.9 - k * 0.32)))
                   for k in range(6)]
            _groove_line(F, pts, 0.012, 0.03)
    # toe clefts on every paw
    for s in (1, -1):
        for pw, n in ((FPAW, 4), (HPAW, 4)):
            p = _m(pw, s)
            for a in np.linspace(-30, 30, 3):
                th = math.radians(a)
                d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
                _groove_line(F, [p + d * 0.12 + (0, 0, 0.2), p + d * 0.42 + (0, 0, 0.1)], 0.02, 0.025)
    # muscle separation: the triceps and the shoulder, the haunch and the hamstring
    for s in (1, -1):
        _groove_line(F, [_project(F, _m((0.3, -2.1, 2.5), s), _m((1.3, -2.25, 2.7), s)),
                         _project(F, _m((0.3, -1.95, 2.0), s), _m((1.3, -1.95, 1.9), s)),
                         _project(F, _m((0.3, -1.85, 1.6), s), _m((1.3, -1.8, 1.45), s))], 0.012, 0.04)
        _groove_line(F, [_project(F, _m((0.3, 1.65, 2.9), s), _m((1.3, 1.85, 2.9), s)),
                         _project(F, _m((0.3, 2.0, 2.3), s), _m((1.3, 2.25, 2.2), s)),
                         _project(F, _m((0.3, 1.85, 1.8), s), _m((1.3, 2.05, 1.6), s))], 0.012, 0.045)
    # Fur: long soft clumps combed back along the body, and finer strands
    F.displace(lambda X, Y, Z: 0.012 * noise.fbm(X * 1.6, Y * 1.6, Z * 1.6, octaves=3)
               + 0.007 * noise.fbm(X * 11 + 3, Y * 3.0, Z * 11, octaves=2)
               + 0.0035 * noise(X * 34 + 7, Y * 9.0, Z * 34), band=0.12)


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
