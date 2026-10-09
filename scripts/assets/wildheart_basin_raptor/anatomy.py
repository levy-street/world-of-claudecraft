"""The Basin Raptor's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Great Jaguar and Great Saurian kits this builder is
adapted from): Blender units are yards, +Z up, the raptor FACES -Y (the game's
+Z after the glTF export), its left is +X. Bones are (name, parent, head, tail);
`L_` bones are mirrored onto `R_` (x -> -x).

A chunky, KayKit-heavy pack hunter of the basin floor at its in-game size: about
2.6 yards at the hip, the head top about 4.3 yards at an alert idle (the KayKit
knight is 2.6), 8.3 yards from the snout to the tail tip. The body is held
level, the tail stiff behind it as the counterweight. Digitigrade legs: thigh,
shin, a long metatarsus (Foot, the ankle held high) and two forward toes; the
inner toe carries the raised SICKLE claw on its own bone. Short powerful arms
folded under the chest end in three hooked claws.

Bones beside the body:
  * KneeFix / AnkleFix: joint helpers, half their twin's bend (rig.py keys
    them), so the knee and the ankle keep their volume.
  * Sickle: the raised killing claw on the inner toe (it lifts to strike).
  * Charm1/Charm2: the Sunbone fang charm hanging from the collar (a spring).
  * Crest: the quill crest behind the skull (a stiff spring).
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, rot_matrix

# ------------------------------------------------------------------ landmarks
HIP = np.array((0.52, 0.55, 2.58))
KNEE = np.array((0.6, -0.42, 1.72))
ANKLE = np.array((0.58, 0.42, 0.72))
FOOT_T = np.array((0.56, 0.06, 0.16))      # the ball of the foot (Foot tail)
TOE_T = np.array((0.58, -0.62, 0.09))      # the forward toes' tip
SICKLE_B = np.array((0.42, 0.02, 0.24))    # the sickle toe's knuckle (Sickle head)
SICKLE_T = np.array((0.4, -0.28, 0.5))     # its raised claw's base
SHOULDER = np.array((0.42, -1.42, 2.66))
ELBOW = np.array((0.56, -1.5, 2.12))
WRIST = np.array((0.48, -1.9, 1.98))
HAND_T = np.array((0.46, -2.22, 1.86))
HEAD_C = np.array((0.0, -2.62, 4.0))
HK = 1.18                                  # the head is sculpted at HK times its first size


def H(p):
    """A head-space point scaled about the head centre."""
    return HEAD_C + (np.asarray(p, float) - HEAD_C) * HK


EYE = H((0.29, -2.72, 4.13))               # the left eye's centre
EYE_R = 0.085 * HK
EYE_DIR = np.array((0.55, -0.82, 0.12)) / np.linalg.norm((0.55, -0.82, 0.12))
SNOUT_T = H((0.0, -3.42, 3.86))

NECK_PTS = [np.array(p) for p in ((0, -1.4, 3.12), (0, -1.86, 3.56), (0, -2.12, 3.94))]
TAIL_PTS = [np.array(p) for p in ((0, 0.95, 2.86), (0, 1.55, 2.92), (0, 2.15, 2.95), (0, 2.72, 2.94), (0, 3.25, 2.9),
                                  (0, 3.74, 2.84), (0, 4.18, 2.78), (0, 4.56, 2.72), (0, 4.9, 2.66))]
TAIL_R = [0.56, 0.44, 0.35, 0.28, 0.22, 0.17, 0.13, 0.1, 0.07]

# The mouth: the slit the jaw opens on (rig.jaw_split reads it).
JAW_HINGE = H((0.0, -2.36, 3.86))
MOUTH = dict(y_front=float(H((0, -3.45, 0))[1]), y_corner=float(H((0, -2.48, 0))[1]),
             z=float(H((0, 0, 3.83))[2]), x_max=0.42 * HK, z_lo=3.4, z_hi=4.3)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    return [
        ('L_UpperArm', 'Spine2', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_Hand', 'L_Forearm', tuple(WRIST), tuple(HAND_T)),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), tuple(FOOT_T)),
        ('L_AnkleFix', 'L_Shin', tuple(ANKLE), tuple(_lerp(ANKLE, FOOT_T, 0.3))),
        ('L_Toes', 'L_Foot', tuple(FOOT_T), tuple(TOE_T)),
        ('L_Sickle', 'L_Foot', tuple(SICKLE_B), tuple(SICKLE_T)),
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
    ('Hips', 'Root', (0, 0.95, 2.82), (0, 0.0, 2.8)),
    ('Spine1', 'Hips', (0, 0.0, 2.8), (0, -0.8, 2.86)),
    ('Spine2', 'Spine1', (0, -0.8, 2.86), tuple(NECK_PTS[0])),
    ('Neck1', 'Spine2', tuple(NECK_PTS[0]), tuple(NECK_PTS[1])),
    ('Neck2', 'Neck1', tuple(NECK_PTS[1]), tuple(NECK_PTS[2])),
    ('Head', 'Neck2', tuple(NECK_PTS[2]), tuple(H((0, -3.3, 3.95)))),
    ('Jaw', 'Head', tuple(JAW_HINGE), tuple(H((0, -3.28, 3.7)))),
    ('Crest', 'Head', tuple(H((0, -2.3, 4.34))), tuple(H((0, -1.85, 4.57)))),
    ('Charm1', 'Neck1', (0, -2.14, 3.0), (0, -2.2, 2.74)),
    ('Charm2', 'Charm1', (0, -2.2, 2.74), (0, -2.24, 2.5)),
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
def build_body(voxel=0.018, detail=True, seed=23):
    """The whole skin as one distance field (rest pose)."""
    F = Field((-1.3, -3.62, -0.12), (1.3, 5.1, 4.75), voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, 0.62, 2.78), (0.6, 0.78, 0.55), bone='Hips'), 0.3)              # pelvis
    F.add(Ellipsoid((0, 0.95, 3.0), (0.36, 0.5, 0.3), bone='Hips'), 0.22)                # the rump's crest
    F.add(Ellipsoid((0, -0.42, 2.66), (0.74, 1.0, 0.68), bone='Spine1'), 0.36)          # the barrel
    F.add(Ellipsoid((0, -0.5, 2.28), (0.5, 0.82, 0.36), bone='Spine1'), 0.3)             # the belly
    F.add(Ellipsoid((0, -1.18, 2.78), (0.66, 0.6, 0.64), rot_matrix(rx=-0.35), bone='Spine2'), 0.3)  # chest
    F.add(Ellipsoid((0, -1.42, 2.46), (0.42, 0.42, 0.36), rot_matrix(rx=0.3), bone='Spine2'), 0.26)  # the keel
    for a, b, bone in (((0, -1.3, 3.18), (0, -0.4, 3.12), 'Spine2'), ((0, -0.4, 3.12), (0, 0.5, 3.1), 'Spine1'),
                       ((0, 0.5, 3.1), (0, 1.15, 3.12), 'Hips')):
        F.add(RoundCone(a, b, 0.2, 0.2, bone=bone), 0.3)                                  # the back line
    for s in (1, -1):
        # the great drumstick of the thigh, tucked up under the hip
        F.add(Ellipsoid(_m((0.5, 0.28, 2.32), s), (0.44, 0.66, 0.74), rot_matrix(rx=0.62), bone=_side('Thigh', s)),
              0.24)
        F.add(Ellipsoid(_m((0.46, 0.72, 2.6), s), (0.34, 0.48, 0.5), rot_matrix(rx=0.2), bone=_side('Thigh', s)),
              0.2)                                                                         # the rump muscle
        F.add(Ellipsoid(_m((0.46, -0.5, 2.62), s), (0.3, 0.9, 0.52), bone='Spine1'), 0.28)   # flank over the ribs
        F.add(Ellipsoid(_m((0.34, -1.3, 2.64), s), (0.26, 0.36, 0.36), rot_matrix(rx=-0.2), bone='Spine2'), 0.2)

    # ---------------------------------------------------------------- neck
    F.add(RoundCone((0, -1.2, 2.98), NECK_PTS[1] + (0, 0.02, -0.06), 0.56, 0.42, bone='Neck1'), 0.3)
    F.add(RoundCone(NECK_PTS[1] + (0, 0.02, -0.06), (0, -2.22, 3.92), 0.42, 0.36, bone='Neck2'), 0.2)
    F.add(Ellipsoid((0, -1.86, 3.36), (0.36, 0.42, 0.42), rot_matrix(rx=-0.55), bone='Neck1'), 0.22)   # throat
    F.add(Ellipsoid((0, -1.62, 3.5), (0.32, 0.42, 0.26), rot_matrix(rx=-0.7), bone='Neck1'), 0.2)      # nape muscle

    # ---------------------------------------------------------------- head
    # A big, blocky saurian head: a deep skull behind the eyes, a long square
    # snout, a heavy brow shelf over the eye, bulging jaw muscles, a low bony
    # crest down the nose.
    k = HK
    F.add(Ellipsoid(H((0, -2.48, 4.02)), np.array((0.46, 0.55, 0.42)) * k, bone='Head'), 0.16)          # cranium
    for s in (1, -1):
        # the snout: two tapering halves side by side, wider than tall
        F.add(RoundCone(H(_m((0.12, -2.6, 3.97), s)), H(_m((0.08, -3.28, 3.9), s)), 0.25 * k, 0.15 * k,
                        bone='Head'), 0.12)
    F.add(RoundCone(H((0, -2.5, 4.26)), H((0, -3.22, 4.0)), 0.14 * k, 0.08 * k, bone='Head'), 0.1)    # nasal ridge
    F.add(Ellipsoid(H((0, -3.3, 3.92)), np.array((0.19, 0.13, 0.12)) * k, bone='Head'), 0.08)          # blunt tip
    for s in (1, -1):
        F.add(Ellipsoid(H(_m((0.27, -2.36, 3.88), s)), np.array((0.22, 0.32, 0.26)) * k, bone='Head'), 0.12)  # jaw muscle
        # the brow: a heavy shelf slanting DOWN toward the snout (the scowl)
        F.add(Ellipsoid(H(_m((0.29, -2.74, 4.2), s)), np.array((0.14, 0.28, 0.07)) * k,
                        rot_matrix(rx=0.5, ry=-0.5 * s), bone='Head'), 0.03)
        F.add(Ellipsoid(H(_m((0.21, -3.08, 3.98), s)), np.array((0.1, 0.32, 0.1)) * k, bone='Head'), 0.06)   # cheek
        F.add(Ellipsoid(H(_m((0.31, -2.4, 4.12), s)), np.array((0.15, 0.17, 0.15)) * k, bone='Head'), 0.07)  # skull boss
        # a short keratin horn swept back from behind each eye
        F.add(RoundCone(H(_m((0.3, -2.5, 4.18), s)), H(_m((0.36, -2.12, 4.3), s)), 0.08 * k, 0.025 * k,
                        bone='Head'), 0.04)
    # the jaw: a deep lower jaw with a chin
    for s in (1, -1):
        F.add(RoundCone(H(_m((0.15, -2.45, 3.7), s)), H(_m((0.09, -3.24, 3.73), s)), 0.18 * k, 0.11 * k,
                        bone='Jaw'), 0.1)
    F.add(Ellipsoid(H((0, -2.5, 3.65)), np.array((0.3, 0.26, 0.18)) * k, bone='Jaw'), 0.1)
    F.add(Ellipsoid(H((0, -3.2, 3.72)), np.array((0.15, 0.12, 0.09)) * k, bone='Jaw'), 0.06)
    # mouth slit, eye sockets, nostrils
    F.sub(RoundBox(H((0, -2.98, 3.83)), np.array((0.36, 0.5, 0.012)) * k, radius=0.0), 0.02)
    for s in (1, -1):
        F.sub(Sphere(_m(EYE, s) + (0, -0.01, 0), EYE_R + 0.03), 0.03)
        F.sub(Ellipsoid(H(_m((0.1, -3.38, 3.98), s)), np.array((0.04, 0.05, 0.03)) * k), 0.02)

    # ---------------------------------------------------------------- arms
    for s in (1, -1):
        sh, el, wr, ht = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s), _m(HAND_T, s)
        ua, fa, hd = _side('UpperArm', s), _side('Forearm', s), _side('Hand', s)
        F.add(RoundCone(sh, el, 0.24, 0.17, bone=ua), 0.12)
        F.add(Ellipsoid(_lerp(sh, el, 0.4) + np.array((0.03 * s, 0.06, 0)), (0.2, 0.21, 0.27), seg_frame(sh, el),
                        bone=ua), 0.08)
        F.add(RoundCone(el, wr, 0.17, 0.13, bone=fa), 0.08)
        F.add(RoundCone(wr, _lerp(wr, ht, 0.45), 0.13, 0.12, bone=hd), 0.05)
        d = (ht - wr) / np.linalg.norm(ht - wr)
        for dx, dz, ln in ((0.07, 0.03, 0.32), (0.0, -0.02, 0.36), (-0.07, -0.04, 0.26)):
            a = _lerp(wr, ht, 0.4) + np.array((dx * s, 0.0, dz))
            F.add(Polyline([a, a + d * ln * 0.55 + np.array((0, 0, -0.02)), a + d * ln + np.array((0, 0, -0.08))],
                           [0.065, 0.055, 0.04], bone=hd), 0.03)

    # ---------------------------------------------------------------- legs
    for s in (1, -1):
        hp, kn, an, ft = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(FOOT_T, s)
        th_, sn, fo, to_ = _side('Thigh', s), _side('Shin', s), _side('Foot', s), _side('Toes', s)
        F.add(RoundCone(hp + (0, 0, 0.1), kn, 0.52, 0.3, bone=th_), 0.2)
        F.add(Sphere(kn + np.array((0, -0.04, 0.02)), 0.27, bone=_side('KneeFix', s)), 0.1)
        F.add(RoundCone(kn, an, 0.3, 0.17, bone=sn), 0.1)
        F.add(Ellipsoid(_lerp(kn, an, 0.32) + np.array((0, 0.1, 0.03)), (0.27, 0.29, 0.46), seg_frame(kn, an),
                        bone=sn), 0.1)                                                       # the drumstick's calf
        F.add(Sphere(an + np.array((0, 0.04, 0.0)), 0.18, bone=_side('AnkleFix', s)), 0.05)
        F.add(RoundCone(an, ft + (0, 0, 0.03), 0.17, 0.18, bone=fo), 0.06)
        F.add(Ellipsoid(ft + np.array((0, -0.02, 0.0)), (0.21, 0.24, 0.15), bone=fo), 0.06)     # the foot's pad
        # two forward toes, splayed
        for a in (-12, 12):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            p0 = ft + np.array((0, 0, 0.01))
            p1 = ft + d * 0.34 + np.array((0, 0, -0.02))
            p2 = ft + d * 0.62 + np.array((0, 0, -0.04))
            F.add(Polyline([p0, p1, p2], [0.13, 0.11, 0.08], bone=to_), 0.05)
        # the sickle toe: up and forward, its knuckle cocked
        sb, st_ = _m(SICKLE_B, s), _m(SICKLE_T, s)
        F.add(Polyline([ft + np.array((-0.08 * s, 0.04, 0.03)), sb, st_], [0.12, 0.11, 0.085],
                       bone=_side('Sickle', s)), 0.05)
        # the small dewclaw behind
        F.add(RoundCone(ft + np.array((0.03 * s, 0.12, 0.05)), ft + np.array((0.06 * s, 0.32, 0.03)), 0.06, 0.03,
                        bone=fo), 0.04)

    # ---------------------------------------------------------------- tail
    for i in range(8):
        F.add(RoundCone(TAIL_PTS[i], TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'),
              0.3 if i == 0 else 0.1)
    # the root muscle broad and deep
    F.add(Ellipsoid((0, 1.4, 2.82), (0.42, 0.7, 0.4), bone='Tail1'), 0.25)

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (4, 8, 1.0), radius=0.0), 0.02)

    if detail:
        _skin_detail(F, noise)
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


def _skin_detail(F, noise):
    SCAR_LINES.clear()
    # an old claw rake down the left flank
    for k in range(3):
        a, b = np.array((0.3, -0.85 + 0.16 * k, 3.2)), np.array((0.3, -0.45 + 0.16 * k, 2.3))
        pts = [_project(F, _lerp(a, b, t) * np.array((0.2, 1, 1)), _lerp(a, b, t) + np.array((1.2, 0, 0)))
               for t in np.linspace(0, 1, 6)]
        _scar(F, pts, width=0.024, depth=0.016)
        SCAR_LINES.append(pts)
    # skin folds round the neck and the throat
    for t in (0.25, 0.5, 0.75):
        c = _lerp((0, -1.4, 3.05), (0, -2.05, 3.8), t)
        for s in (1, -1):
            pts = [_project(F, c, c + np.array((1.2 * s, 0.05 * math.sin(k), 0.9 - k * 0.36))) for k in range(6)]
            _groove_line(F, pts, 0.014, 0.025)
    # the lip lines
    for s in (1, -1):
        _groove_line(F, [_project(F, _m((0.05, -2.5, 3.84), s), _m((0.6, -2.5, 3.84), s)),
                         _project(F, _m((0.05, -2.9, 3.86), s), _m((0.6, -2.9, 3.86), s)),
                         _project(F, _m((0.05, -3.3, 3.86), s), _m((0.6, -3.3, 3.86), s))], 0.01, 0.02)
    # tail rings: armoured bands across the top
    for y in np.arange(1.7, 4.7, 0.36):
        for s in (1, -1):
            c = np.array((0.0, y, 2.85))
            pts = [_project(F, c, c + np.array((1.0 * s * math.sin(a), 0, math.cos(a)))) for a in np.linspace(0, 1.4, 5)]
            _groove_line(F, pts, 0.01, 0.02)
    # Scales: pebbly fbm (the bake's bump carries the scale pattern itself)
    F.displace(lambda X, Y, Z: 0.01 * noise.fbm(X * 2.0, Y * 2.0, Z * 2.0, octaves=3)
               - 0.004 * noise.ridged(X * 14 + 3, Y * 14, Z * 14, octaves=2), band=0.12)


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
