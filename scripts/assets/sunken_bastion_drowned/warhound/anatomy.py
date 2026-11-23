"""The Bastion Warhound's skeleton and sculpted body (rest pose), in yards.

One of the garrison's war mastiffs, drowned with its handlers when the sea took
the fortress and risen with them: a huge, deep-chested hound gone gaunt in the
water, the hide slack and sloughing, the ribs standing out of the flanks and,
on the left, a hole torn through to the bone; the hip bones and the spine
knuckles poke through the loin. A broad mastiff head with a heavy scowling
brow, cropped ears, the lips drawn back off the teeth in a snarl and the left
cheek eaten open; sea light in the sunken eyes and in the throat.

The quadruped rig and pose language are the Great Jaguar's (Wildheart Basin
kit), reshaped for a dog: a square body, the elbow under the chest, a long
muzzle carried forward and low, a shorter, lower tail.

Conventions: Blender units are yards, +Z up, the hound FACES -Y (the game's +Z
after the glTF export), its left is +X. Bones are (name, parent, head, tail);
`L_` bones are mirrored onto `R_` (x -> -x).

Bones beside the body:
  * ElbowFix / KneeFix / HockFix: joint helpers (rig.py keys them half a bend).
  * Belly: the slack gut (a spring).
  * Charm1/Charm2: the broken chain hanging from the collar's ring (a spring chain).
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

# ------------------------------------------------------------------ landmarks
SHOULDER = np.array((0.62, -1.55, 2.35))
ELBOW = np.array((0.68, -1.25, 1.45))
WRIST = np.array((0.66, -1.42, 0.45))
FPAW = np.array((0.66, -1.6, 0.16))        # the front paw's ball (Hand tail)
FTOE = np.array((0.66, -1.92, 0.11))       # the front toes' tip
HIP = np.array((0.6, 1.1, 2.5))
KNEE = np.array((0.72, 0.6, 1.6))
HOCK = np.array((0.66, 1.45, 0.85))
HPAW = np.array((0.66, 1.22, 0.16))        # the hind paw's ball (Foot tail)
HTOE = np.array((0.66, 0.9, 0.11))
HEAD_C = np.array((0.0, -2.82, 3.62))
HK = 1.3


def H(p):
    """A head-space point scaled about the head centre (the head is sculpted at HK times
    its first size: a heavy mastiff head that reads from the camera)."""
    return HEAD_C + (np.asarray(p, float) - _HC0) * HK


_HC0 = np.array((0.0, -2.95, 3.7))         # the head centre the sculpt below is written about
EYE = H((0.175, -3.15, 3.8))               # the left eye's centre
EYE_R = 0.056 * HK
EYE_DIR = np.array((0.42, -1.0, 0.05)) / np.linalg.norm((0.42, -1.0, 0.05))

NECK_PTS = [np.array(p) for p in ((0, -1.85, 3.15), (0, -2.2, 3.4), (0, -2.48, 3.54))]
TAIL_PTS = [np.array(p) for p in ((0, 1.55, 2.95), (0, 1.78, 2.92), (0, 1.98, 2.82), (0, 2.16, 2.66), (0, 2.3, 2.46),
                                  (0, 2.4, 2.24), (0, 2.47, 2.02), (0, 2.52, 1.82), (0, 2.55, 1.66))]
TAIL_R = [0.28, 0.24, 0.2, 0.17, 0.15, 0.13, 0.115, 0.1, 0.085]   # docked short, the end ragged

# The mouth: the slit the jaw opens on (rig.jaw_split reads it).
JAW_HINGE = H((0.0, -2.88, 3.46))
MOUTH = dict(y_front=float(H((0, -3.8, 0))[1]), y_corner=float(H((0, -3.02, 0))[1]), z=float(H((0, 0, 3.465))[2]),
             x_max=0.3 * HK, z_lo=float(H((0, 0, 3.12))[2]), z_hi=float(H((0, 0, 3.8))[2]))

# The ragged hole torn through the left flank (the ribs show through it).
FLANK_HOLE = np.array((0.74, -0.72, 2.32))
FLANK_HOLE_R = (0.2, 0.42, 0.3)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    return [
        ('L_Scapula', 'Spine3', (0.36, -1.25, 2.98), tuple(SHOULDER)),
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
        ('L_Ear', 'Head', tuple(H((0.22, -2.82, 3.96))), tuple(H((0.29, -2.78, 4.26)))),
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
    ('Hips', 'Root', (0, 1.35, 2.85), (0, 0.5, 2.95)),
    ('Spine1', 'Hips', (0, 0.5, 2.95), (0, -0.35, 3.0)),
    ('Spine2', 'Spine1', (0, -0.35, 3.0), (0, -1.35, 3.05)),
    ('Spine3', 'Spine2', (0, -1.35, 3.05), tuple(NECK_PTS[0])),
    ('Belly', 'Spine1', (0, -0.2, 2.1), (0, -0.2, 1.75)),
    ('Neck1', 'Spine3', tuple(NECK_PTS[0]), tuple(NECK_PTS[1])),
    ('Neck2', 'Neck1', tuple(NECK_PTS[1]), tuple(NECK_PTS[2])),
    ('Head', 'Neck2', tuple(NECK_PTS[2]), tuple(H((0, -3.62, 3.62)))),
    ('Jaw', 'Head', tuple(JAW_HINGE), tuple(H((0, -3.66, 3.3)))),
    ('Charm1', 'Neck1', (0, -2.12, 2.94), (0, -2.14, 2.58)),
    ('Charm2', 'Charm1', (0, -2.14, 2.58), (0, -2.16, 2.22)),
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
    F = Field((-1.4, -4.05, -0.12), (1.4, 2.95, 4.6), voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, -0.95, 2.46), (0.8, 1.05, 0.8), bone='Spine2'), 0.3)            # the deep rib cage
    F.add(Ellipsoid((0, -1.45, 2.95), (0.54, 0.5, 0.38), bone='Spine3'), 0.24)          # withers
    F.add(Ellipsoid((0, -1.78, 2.28), (0.56, 0.38, 0.6), rot_matrix(rx=0.25), bone='Spine3'), 0.26)  # breast
    F.add(Ellipsoid((0, 0.22, 2.66), (0.5, 0.6, 0.38), bone='Spine1'), 0.3)             # the loin, tucked up
    F.add(Ellipsoid((0, -0.15, 2.2), (0.42, 0.55, 0.24), bone='Belly'), 0.26)           # the slack gut
    F.add(Ellipsoid((0, 0.98, 2.62), (0.66, 0.68, 0.56), bone='Hips'), 0.3)             # pelvis
    F.add(Ellipsoid((0, 1.35, 2.85), (0.48, 0.44, 0.3), bone='Hips'), 0.22)             # croup
    for a, b, bone in (((0, -1.6, 3.12), (0, -0.3, 3.04), 'Spine2'), ((0, -0.3, 3.04), (0, 0.55, 3.0), 'Spine1'),
                       ((0, 0.55, 3.0), (0, 1.48, 2.94), 'Hips')):
        F.add(RoundCone(a, b, 0.17, 0.17, bone=bone), 0.26)                              # the back line

    for s in (1, -1):
        F.add(Ellipsoid(_m((0.46, -1.4, 2.76), s), (0.24, 0.42, 0.56), rot_matrix(rx=-0.35), bone=_side('Scapula', s)),
              0.16)
        F.add(Ellipsoid(_m((0.6, -1.6, 2.15), s), (0.3, 0.42, 0.52), rot_matrix(rx=0.2), bone=_side('UpperArm', s)),
              0.14)                                                                         # shoulder muscle
        F.add(Ellipsoid(_m((0.56, 0.96, 2.36), s), (0.36, 0.62, 0.68), rot_matrix(rx=0.3), bone=_side('Thigh', s)),
              0.18)                                                                         # the haunch
        F.add(Ellipsoid(_m((0.46, -0.78, 2.44), s), (0.36, 0.92, 0.66), bone='Spine2'), 0.24)   # flank over the ribs

    # ---------------------------------------------------------------- neck
    F.add(RoundCone((0, -1.62, 2.86), NECK_PTS[1] + (0, 0, -0.1), 0.62, 0.52, bone='Neck1'), 0.26)
    F.add(RoundCone(NECK_PTS[1] + (0, 0, -0.1), (0, -2.55, 3.5), 0.52, 0.46, bone='Neck2'), 0.18)
    F.add(Ellipsoid((0, -2.16, 3.0), (0.4, 0.42, 0.34), rot_matrix(rx=0.4), bone='Neck1'), 0.2)       # dewlap
    F.add(Ellipsoid((0, -2.0, 3.52), (0.36, 0.48, 0.27), rot_matrix(rx=-0.45), bone='Neck1'), 0.2)    # nape

    # ---------------------------------------------------------------- head (a broad mastiff skull)
    k = HK

    def E(c, r, bone='Head', rot=None, blend=0.06):
        F.add(Ellipsoid(H(c), np.array(r) * k, rot, bone=bone), blend * k)

    E((0, -2.9, 3.82), (0.36, 0.34, 0.26), blend=0.12)                                 # cranium, broad and flat
    E((0, -2.76, 3.86), (0.26, 0.24, 0.22), blend=0.1)                                 # occiput
    E((0, -3.08, 3.9), (0.27, 0.14, 0.1), blend=0.06)                                  # the stop: a hard brow shelf
    E((0, -3.36, 3.6), (0.19, 0.34, 0.16), blend=0.08)                               # the muzzle, broad and deep
    E((0, -3.56, 3.6), (0.16, 0.2, 0.15), blend=0.06)                                # square to the nose
    F.add(RoundCone(H((0, -3.06, 3.77)), H((0, -3.66, 3.69)), 0.11 * k, 0.085 * k, bone='Head'), 0.06 * k)  # bridge
    E((0, -3.72, 3.665), (0.09, 0.055, 0.065), blend=0.03)                           # nose leather
    E((0, -3.05, 3.97), (0.06, 0.2, 0.05), blend=0.04)                                 # forehead furrow ridge
    for s in (1, -1):
        E(_m((0.25, -3.0, 3.66), s), (0.18, 0.24, 0.2), blend=0.09)                    # cheek
        E(_m((0.15, -3.12, 3.89), s), (0.15, 0.1, 0.07), rot=rot_matrix(ry=-0.45 * s, rx=0.15), blend=0.035)  # brow
        E(_m((0.15, -3.42, 3.45), s), (0.075, 0.27, 0.12), blend=0.04)                 # flew, hanging over the jaw
        E(_m((0.2, -2.96, 3.42), s), (0.16, 0.26, 0.14), bone='Jaw', blend=0.07)       # masseter
        E(_m((0.12, -3.0, 4.02), s), (0.06, 0.18, 0.05), rot=rot_matrix(rz=0.3 * s), blend=0.035)
    # the jaw
    E((0, -3.26, 3.37), (0.14, 0.34, 0.085), bone='Jaw', rot=rot_matrix(rx=0.04), blend=0.06)
    E((0, -3.5, 3.37), (0.1, 0.08, 0.07), bone='Jaw', blend=0.05)                      # chin, under the flews
    # the mouth slit, the snarl (the lips drawn back off the side teeth), sockets, nostrils
    F.sub(Ellipsoid(H((0, -3.4, 3.465)), np.array((0.22, 0.4, 0.02)) * k), 0.015)
    for s in (1, -1):
        F.sub(Ellipsoid(H(_m((0.2, -3.36, 3.48), s)), np.array((0.055, 0.2, 0.05)) * k), 0.02)
        F.sub(Sphere(_m(EYE, s) + (0, -0.012, 0.004), EYE_R + 0.035), 0.03)
        F.sub(Ellipsoid(H(_m((0.045, -3.77, 3.68), s)), np.array((0.028, 0.04, 0.024)) * k), 0.015)
    # the crabs' work: the left cheek eaten open to the teeth
    F.sub(Ellipsoid(H((0.22, -3.08, 3.47)), np.array((0.05, 0.13, 0.04)) * k, rot_matrix(rz=0.15)), 0.012)

    # ---------------------------------------------------------------- ears (cropped, erect)
    for s in (1, -1):
        ec = H(_m((0.25, -2.81, 4.1), s))
        R = rot_matrix(rx=0.1, ry=-0.25 * s, rz=0.35 * s)
        F.add(Ellipsoid(ec, np.array((0.1, 0.04, 0.18)) * k, R, bone=_side('Ear', s)), 0.05)
        F.sub(Ellipsoid(ec + R @ np.array((0, -0.03, 0.02)) * k, np.array((0.065, 0.03, 0.13)) * k, R), 0.015)
    F.sub(Sphere(H((0.33, -2.81, 4.22)), 0.05), 0.012)                                  # a torn notch

    # ---------------------------------------------------------------- legs
    def leg(s):
        sh, el, wr, fp = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s), _m(FPAW, s)
        ua, fa, hand, ft = _side('UpperArm', s), _side('Forearm', s), _side('Hand', s), _side('FToes', s)
        F.add(RoundCone(sh + (0, 0, 0.1), el, 0.4, 0.27, bone=ua), 0.14)
        F.add(Ellipsoid(_lerp(sh, el, 0.55) + np.array((0.03 * s, 0.15, 0)), (0.25, 0.27, 0.42), seg_frame(sh, el),
                        bone=ua), 0.1)                                                      # triceps
        F.add(Sphere(el + np.array((0, 0.09, 0.02)), 0.22, bone=_side('ElbowFix', s)), 0.08)
        F.add(RoundCone(el, wr, 0.29, 0.2, bone=fa), 0.1)
        F.add(Ellipsoid(_lerp(el, wr, 0.25) + np.array((0, -0.05, 0)), (0.3, 0.29, 0.4), seg_frame(el, wr), bone=fa),
              0.09)
        F.add(RoundCone(wr, fp + (0, 0.02, 0.04), 0.21, 0.23, bone=hand), 0.07)
        F.add(Ellipsoid(fp + np.array((0, 0.0, 0.02)), (0.28, 0.28, 0.14), bone=hand), 0.07)
        for k, a in enumerate(np.linspace(-40, 40, 4)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            c = fp + d * 0.24 + np.array((0, -0.06, -0.03))
            F.add(Ellipsoid(c, (0.1, 0.125, 0.095), frame_from(d), bone=ft), 0.035)
        hp, kn, hk, hpw = _m(HIP, s), _m(KNEE, s), _m(HOCK, s), _m(HPAW, s)
        th_, sn, fo, ht = _side('Thigh', s), _side('Shin', s), _side('Foot', s), _side('HToes', s)
        F.add(RoundCone(hp + (0, 0.05, 0.15), kn, 0.5, 0.27, bone=th_), 0.16)
        F.add(Ellipsoid(_lerp(hp, kn, 0.45) + np.array((0.03 * s, 0.28, -0.05)), (0.3, 0.36, 0.52), seg_frame(hp, kn),
                        bone=th_), 0.1)                                                     # hamstring
        F.add(Ellipsoid(_lerp(hp, kn, 0.55) + np.array((0, -0.14, 0)), (0.24, 0.22, 0.4), seg_frame(hp, kn),
                        bone=th_), 0.1)                                                     # quadriceps
        F.add(Sphere(kn + np.array((0, -0.05, 0.0)), 0.2, bone=_side('KneeFix', s)), 0.08)
        F.add(RoundCone(kn, hk, 0.29, 0.18, bone=sn), 0.09)
        F.add(Ellipsoid(_lerp(kn, hk, 0.3) + np.array((0, 0.13, 0.05)), (0.21, 0.23, 0.36), seg_frame(kn, hk), bone=sn),
              0.09)                                                                         # calf
        F.add(Sphere(hk + np.array((0, 0.04, 0.02)), 0.15, bone=_side('HockFix', s)), 0.05)
        F.add(RoundCone(hk, hpw + (0, 0.02, 0.04), 0.18, 0.21, bone=fo), 0.07)
        F.add(Ellipsoid(hpw + np.array((0, 0.0, 0.02)), (0.26, 0.26, 0.13), bone=fo), 0.07)
        for k, a in enumerate(np.linspace(-38, 38, 4)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            c = hpw + d * 0.22 + np.array((0, -0.05, -0.035))
            F.add(Ellipsoid(c, (0.095, 0.115, 0.09), frame_from(d), bone=ht), 0.035)
    for s in (1, -1):
        leg(s)

    # ---------------------------------------------------------------- tail
    for i in range(8):
        F.add(RoundCone(TAIL_PTS[i], TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'),
              0.24 if i == 0 else 0.08)

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


def _ridge_line(F, pts, height, k):
    F.ridge(Polyline(pts, 0.003), height, k=k)


SCAR_LINES = []   # the projected scar polylines (surface.py paints them)
RIB_Y = [-1.38, -1.18, -0.98, -0.78, -0.58, -0.4, -0.24]


def _rib_path(F, y, s, top=2.95, bot=1.85):
    pts = []
    for k in range(7):
        u = k / 6
        z = top + (bot - top) * u
        yy = y + 0.12 * u            # the ribs sweep back as they come down
        pts.append(_project(F, (0, yy, z), (1.6 * s, yy + 0.05, z - 0.1 * u)))
    return pts


def _skin_detail(F, noise, seed):
    SCAR_LINES.clear()
    rng = np.random.default_rng(seed)
    # the starved ribs standing out of both flanks (deeper on the left)
    for s in (1, -1):
        for i, y in enumerate(RIB_Y):
            pts = _rib_path(F, y, s)
            _ridge_line(F, pts, 0.022 if s > 0 else 0.016, 0.035)
            if i + 1 < len(RIB_Y):
                g = _rib_path(F, (y + RIB_Y[i + 1]) / 2, s)
                _groove_line(F, g, 0.028 if s > 0 else 0.02, 0.03)
    # the hole torn through the left flank: the hide gone, the ribs bare inside it
    hc = FLANK_HOLE
    F.sub(Ellipsoid(hc + (0.12, 0, 0), FLANK_HOLE_R), 0.05)
    for y in RIB_Y[1:6]:
        a = np.array((0.36, y - 0.05, 2.72))
        b = np.array((0.66, y + 0.03, 2.3))
        c = np.array((0.58, y + 0.1, 1.95))
        F.add(Polyline([a, b, c], 0.045, bone='Spine2'), 0.02)
    F.add(Ellipsoid(hc + (-0.12, 0, 0), (0.12, 0.38, 0.26), bone='Spine2'), 0.06)          # the dark cavity wall
    # torn hide edges round the hole
    for k in range(10):
        th = math.tau * k / 10
        p = hc + np.array((0.05, math.cos(th) * FLANK_HOLE_R[1] * 1.05, math.sin(th) * FLANK_HOLE_R[2] * 1.05))
        q = _project(F, p - (0.6, 0, 0), p + (0.4, 0, 0))
        F.add(Ellipsoid(q, (0.03, 0.06 + 0.03 * rng.random(), 0.05), bone='Spine2'), 0.02)
    # the spine knuckles and the hip points through the loin
    for y in np.linspace(-0.6, 1.1, 7):
        z = 3.15 - 0.04 * abs(y - 0.3)
        F.add(Ellipsoid((0, y, z), (0.06, 0.07, 0.05), bone='Spine1' if y < 0.5 else 'Hips'), 0.04)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.42, 0.62, 2.98), s), (0.1, 0.12, 0.08), bone='Hips'), 0.06)
        F.add(Ellipsoid(_m((0.38, 1.6, 2.86), s), (0.08, 0.1, 0.07), bone='Hips'), 0.05)
    # the docked tail's ragged end
    F.sub(Sphere(TAIL_PTS[8] + (0.03, 0.06, -0.05), 0.07), 0.02)
    # neck skin folds (loose, waterlogged)
    for t, dz in ((0.2, 0.0), (0.5, 0.05), (0.78, 0.08)):
        c = _lerp((0, -1.9, 3.05), (0, -2.45, 3.42), t)
        for s in (1, -1):
            pts = [_project(F, c + (0, 0, dz), c + np.array((1.2 * s, 0.1 * math.sin(k), 0.8 - k * 0.3)))
                   for k in range(6)]
            _groove_line(F, pts, 0.016, 0.03)
    # the wrinkles of the scowl and the muzzle
    for s in (1, -1):
        for k in range(3):
            y0 = -3.2 - 0.1 * k
            _groove_line(F, [_project(F, H((0.02 * s, y0, 3.6)), H((0.02 * s, y0, 4.2))),
                             _project(F, H((0.12 * s, y0 + 0.03, 3.55)), H((0.4 * s, y0 + 0.03, 4.0))),
                             _project(F, H((0.18 * s, y0 + 0.06, 3.5)), H((0.6 * s, y0 + 0.06, 3.6)))], 0.014, 0.02)
    # toe clefts on every paw
    for s in (1, -1):
        for pw in (FPAW, HPAW):
            p = _m(pw, s)
            for a in np.linspace(-26, 26, 3):
                th = math.radians(a)
                d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
                _groove_line(F, [p + d * 0.09 + (0, 0, 0.16), p + d * 0.32 + (0, 0, 0.08)], 0.016, 0.02)
    # an old slash down the right shoulder
    sh = [_project(F, (-0.2, -1.7, 2.6), (-1.5, -1.8, 2.9)), _project(F, (-0.2, -1.5, 2.4), (-1.5, -1.45, 2.4)),
          _project(F, (-0.2, -1.25, 2.2), (-1.5, -1.15, 1.95))]
    _scar(F, sh, width=0.03, depth=0.02)
    SCAR_LINES.append(sh)
    # sores where the hide has sloughed off: shallow pits with a lip
    for _ in range(26):
        y = rng.uniform(-1.6, 1.4)
        z = rng.uniform(1.9, 3.0)
        s = 1 if rng.random() < 0.5 else -1
        q = _project(F, (0, y, z), (1.6 * s, y, z))
        r = rng.uniform(0.05, 0.11)
        F.sub(Sphere(q + np.array((0.02 * s, 0, 0)), r), 0.02)
    # hide: lumpy, waterlogged, the coat matted into short wet clumps
    F.displace(lambda X, Y, Z: 0.012 * noise.fbm(X * 1.8, Y * 1.8, Z * 1.8, octaves=3)
               + 0.006 * noise.fbm(X * 9 + 3, Y * 3.0, Z * 9, octaves=2)
               + 0.003 * noise(X * 30 + 7, Y * 8.0, Z * 30), band=0.12)


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
