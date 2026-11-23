"""The Snarlvine Lasher's skeleton and sculpted body (rest pose), in yards, plus
its Thorn Sprout variant (same skeleton, same clips, a different sculpt).

Conventions (shared with the Jaguar, Saurian and Balgath kits this builder is
adapted from): Blender units are yards, +Z up, the creature FACES -Y (the game's
+Z after the glTF export), its left is +X. Bones are (name, parent, head, tail);
`L_` bones are mirrored onto `R_` (x -> -x).

The Lasher is a hunched treant-like walker about 5.7 yards tall at the hump,
built as one distance field: core masses (the bone-tagged primitives that also
give the skin weights) wrapped in BRAIDED VINE STRANDS that run up from the root
feet, through the hips, cross over the chest (left leg to right arm and back) and
out down the long whip-vine arms. The strands are blended with a small radius so
the crevices between them stay deep (that is where the sap glows).

The variant is chosen by the environment (LASHER_VARIANT=lasher|sprout) so every
module of the builder sees the same one. The Sprout is sculpted in the same
"lasher units" (the same skeleton) and scaled by SPROUT_SCALE at the end
(build.py), so every clip is authored once.

Bones beside the body:
  * ElbowFix / KneeFix: joint helpers, half their twin's bend.
  * L_Vine1..7 / R_Vine1..7: the whip-vine arms (the RIGHT one is the lash arm).
  * L_Tendril1..2 / R_Tendril1..2, BackVine1..2: springs (follow-through).
  * Jaw: the lower lip of the face knot (the Sprout's maw).
"""
import math
import os

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

VARIANT = os.environ.get('LASHER_VARIANT', 'lasher')
SPROUT = VARIANT == 'sprout'
SPROUT_SCALE = 0.5            # the Sprout ships at half the Lasher's size (about 2.9 yd)

# ------------------------------------------------------------------ landmarks
HIP = np.array((0.62, 0.15, 2.55))
KNEE = np.array((0.88, -0.14, 1.42))
ANKLE = np.array((0.98, 0.18, 0.44))
FOOT_T = np.array((1.02, -0.36, 0.15))     # the root foot's ball (Foot tail)
TOE_T = np.array((1.08, -0.98, 0.08))      # the front root-claws' tip
SHOULDER = np.array((1.2, -0.2, 4.72))
ELBOW = np.array((1.62, -0.02, 3.5))
WRIST = np.array((1.78, -0.55, 2.4))
VINE_PTS = [np.array(p) for p in ((1.78, -0.55, 2.4), (1.95, -0.76, 1.74), (2.1, -0.98, 1.12), (2.22, -1.26, 0.58),
                                  (2.3, -1.72, 0.27), (2.34, -2.34, 0.18), (2.36, -2.96, 0.25), (2.34, -3.48, 0.47))]
VINE_R = [0.31, 0.27, 0.23, 0.2, 0.17, 0.14, 0.11, 0.075]
NVINE = 7
HEAD_C = np.array((0.0, -1.22, 4.74))
EYE = np.array((0.2, -1.6, 4.84))        # the left eye hollow's glowing core
EYE_R = 0.042
TENDRIL_L = [np.array(p) for p in ((0.3, -0.88, 5.12), (0.66, -0.48, 5.62), (0.86, 0.12, 5.92))]
BACKVINE = [np.array(p) for p in ((0.0, 0.62, 4.62), (0.0, 0.98, 3.92), (0.0, 1.1, 3.12))]
JAW_HINGE = np.array((0.0, -1.0, 4.52))

if SPROUT:
    HEAD_C = np.array((0.0, -1.12, 4.92))
    EYE = np.array((0.36, -1.48, 5.42))
    EYE_R = 0.07
    MOUTH = dict(y_front=-2.0, y_corner=-0.85, z=4.86, x_max=0.95, z_lo=4.0, z_hi=5.7)
else:
    MOUTH = dict(y_front=-1.8, y_corner=-1.3, z=4.48, x_max=0.34, z_lo=4.15, z_hi=4.72)


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    out = [
        ('L_Shoulder', 'Chest', (0.35, -0.15, 4.6), tuple(SHOULDER)),
        ('L_UpperArm', 'L_Shoulder', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_ElbowFix', 'L_UpperArm', tuple(ELBOW), tuple(_lerp(ELBOW, WRIST, 0.3))),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), tuple(FOOT_T)),
        ('L_Toes', 'L_Foot', tuple(FOOT_T), tuple(TOE_T)),
        ('L_Tendril1', 'Head', tuple(TENDRIL_L[0]), tuple(TENDRIL_L[1])),
        ('L_Tendril2', 'L_Tendril1', tuple(TENDRIL_L[1]), tuple(TENDRIL_L[2])),
    ]
    for i in range(NVINE):
        out.append((f'L_Vine{i + 1}', 'L_Forearm' if i == 0 else f'L_Vine{i}', tuple(VINE_PTS[i]),
                    tuple(VINE_PTS[i + 1])))
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
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 0.15, 2.6), (0, 0.12, 3.2)),
    ('Spine1', 'Hips', (0, 0.12, 3.2), (0, 0.02, 3.8)),
    ('Spine2', 'Spine1', (0, 0.02, 3.8), (0, -0.2, 4.4)),
    ('Chest', 'Spine2', (0, -0.2, 4.4), (0, -0.5, 4.95)),
    ('Neck', 'Chest', (0, -0.5, 4.88), (0, -0.85, 4.8)),
    ('Head', 'Neck', (0, -0.85, 4.8), (0, -1.55, 4.72)),
    ('Jaw', 'Head', tuple(JAW_HINGE), (0, -1.55, 4.26)),
    ('BackVine1', 'Chest', tuple(BACKVINE[0]), tuple(BACKVINE[1])),
    ('BackVine2', 'BackVine1', tuple(BACKVINE[1]), tuple(BACKVINE[2])),
] + _bones_left())


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


def _m(p, s):
    p = np.asarray(p, dtype=float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def seg_frame(a, b):
    z = np.asarray(b, float) - np.asarray(a, float)
    z /= np.linalg.norm(z)
    x = np.array((1.0, 0, 0))
    x = x - z * (x @ z)
    if np.linalg.norm(x) < 1e-4:
        x = np.array((0, 1.0, 0)) - z * z[1]
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


# ------------------------------------------------------------------ braided strands
def _frames(path):
    """Parallel-transported (tangent, side, up) frames along a polyline."""
    P = [np.asarray(p, float) for p in path]
    n = len(P)
    T = []
    for i in range(n):
        t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T.append(t / max(1e-9, np.linalg.norm(t)))
    side = np.cross(T[0], (0, 0, 1.0))
    if np.linalg.norm(side) < 1e-3:
        side = np.cross(T[0], (0, 1.0, 0))
    side /= np.linalg.norm(side)
    out = []
    for i in range(n):
        side = side - T[i] * (side @ T[i])
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(T[i], (1.0, 0, 0))
        side /= np.linalg.norm(side)
        up = np.cross(T[i], side)
        out.append((T[i], side, up))
    return out


def resample(path, step):
    """A polyline resampled every `step` yards, plus the arc length of each point."""
    P = [np.asarray(p, float) for p in path]
    seg = [np.linalg.norm(b - a) for a, b in zip(P, P[1:])]
    L = float(sum(seg))
    n = max(2, int(math.ceil(L / step)) + 1)
    out, s_out = [], []
    for k in range(n):
        s = L * k / (n - 1)
        acc = 0.0
        for i, ln in enumerate(seg):
            if acc + ln >= s - 1e-9 or i == len(seg) - 1:
                u = (s - acc) / max(ln, 1e-9)
                out.append(P[i] + (P[i + 1] - P[i]) * min(1.0, max(0.0, u)))
                break
            acc += ln
        s_out.append(s)
    return out, s_out


def braid(F, path, radius, n, strand_r, turns_per_yd, phase0=0.0, k=0.05, step=0.11, wobble=0.0, seed=0,
          taper=None):
    """`n` strands twisting round `path` at `radius(s)` (callable of arc length or a
    number), each a chain of round cones blended in with a SMALL radius so the
    grooves between them read. Strands carry no bone (the core gives weights)."""
    pts, ss = resample(path, step)
    fr = _frames(pts)
    rng = np.random.default_rng(seed)
    L = ss[-1]
    out_lines = []
    for j in range(n):
        ph = phase0 + math.tau * j / n + rng.uniform(-0.15, 0.15)
        line, rads = [], []
        wob = rng.uniform(0, 10)
        for (p, s, (t, side, up)) in zip(pts, ss, fr):
            r = radius(s) if callable(radius) else radius
            a = ph + math.tau * turns_per_yd * s
            rr = r * (1.0 + wobble * math.sin(s * 3.1 + wob))
            line.append(p + side * math.cos(a) * rr + up * math.sin(a) * rr)
            sr = strand_r(s) if callable(strand_r) else strand_r
            if taper is not None:
                sr *= taper(s / L)
            rads.append(sr)
        for a, b, ra, rb in zip(line, line[1:], rads, rads[1:]):
            F.add(RoundCone(a, b, ra, rb), k, weight=False)
        out_lines.append((line, rads))
    return out_lines


STRANDS = []   # every strand line (dressing reads them to seat thorns on the ropes)


def _vine_arm_path(s):
    return [_m(p, s) for p in [SHOULDER + (0, 0, 0.05), _lerp(SHOULDER, ELBOW, 0.5), ELBOW, _lerp(ELBOW, WRIST, 0.5)]
            + VINE_PTS]


def _leg_path(s):
    return [_m(p, s) for p in (TOE_T + (0, 0.3, 0.06), FOOT_T + (0, 0, 0.06), ANKLE, _lerp(ANKLE, KNEE, 0.5), KNEE,
                               _lerp(KNEE, HIP, 0.5), HIP)]


def arm_radius_fn(s_sign):
    """The bundle radius along the arm path (arc length in yards)."""
    path = _vine_arm_path(s_sign)
    pts, ss = resample(path, 0.05)
    Ltot = ss[-1]
    l_sh = np.linalg.norm(ELBOW - SHOULDER) + 0.05
    l_el = l_sh + np.linalg.norm(WRIST - ELBOW)
    vine_len = Ltot - l_el

    def f(s):
        if s < l_sh:
            return 0.34 - 0.06 * s / l_sh
        if s < l_el:
            return 0.28 - 0.05 * (s - l_sh) / (l_el - l_sh)
        u = (s - l_el) / vine_len
        return 0.2 * (1 - u) + 0.05 * u
    return f, Ltot


# ------------------------------------------------------------------ body sculpt
def build_body(voxel=0.02, detail=True, seed=17):
    F = Field((-2.85, -3.9, -0.12), (2.85, 1.7, 6.5), voxel)
    noise = Noise(seed)
    STRANDS.clear()
    sp = SPROUT

    # ---------------------------------------------------------------- core masses (weights)
    F.add(Ellipsoid((0, 0.15, 2.72), (0.82, 0.6, 0.55), bone='Hips'), 0.3)
    F.add(RoundCone((0, 0.12, 2.95), (0, 0.0, 3.8), 0.6, 0.72, bone='Spine1'), 0.3)
    F.add(Ellipsoid((0, -0.1, 4.12), (0.98, 0.78, 0.72), bone='Spine2'), 0.35)
    F.add(Ellipsoid((0, -0.05, 4.92), (1.15, 0.74, 0.6), rot_matrix(rx=-0.3), bone='Chest'), 0.3)
    F.add(Ellipsoid((0, 0.25, 5.2), (0.78, 0.6, 0.46), bone='Chest'), 0.3)          # the hump behind the head
    F.add(RoundCone((0, -0.42, 4.82), (0, -0.85, 4.78), 0.5, 0.46, bone='Neck'), 0.2)
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.95, -0.15, 4.86), s), (0.58, 0.52, 0.52), bone=_side('Shoulder', s)), 0.25)
    # head: a gnarled burl, the brow a heavy shelf over two deep hollows
    if not sp:
        F.add(Ellipsoid(HEAD_C, (0.48, 0.45, 0.46), bone='Head'), 0.16)
        F.add(Ellipsoid((0, -1.62, 4.72), (0.12, 0.13, 0.17), rot_matrix(rx=-0.25), bone='Head'), 0.06)  # snout knot
        F.add(Ellipsoid((0, -1.6, 5.0), (0.12, 0.12, 0.1), bone='Head'), 0.05)                         # brow knot
        for s in (1, -1):
            # the brow: two heavy shelves slanting DOWN to the middle (a scowl)
            F.add(Ellipsoid(_m((0.21, -1.6, 4.95), s), (0.26, 0.14, 0.085), rot_matrix(ry=0.52 * s, rx=0.15),
                            bone='Head'), 0.05)
            F.add(Ellipsoid(_m((0.38, -1.32, 4.62), s), (0.2, 0.24, 0.22), bone='Head'), 0.08)        # cheek burls
            F.add(Ellipsoid(_m((0.26, -1.05, 5.08), s), (0.2, 0.22, 0.18), bone='Head'), 0.1)         # crown knots
        F.add(Ellipsoid((0, -1.3, 4.34), (0.4, 0.34, 0.2), bone='Jaw'), 0.1)                         # the jaw knot
        F.add(Ellipsoid((0, -1.56, 4.3), (0.22, 0.14, 0.12), bone='Jaw'), 0.06)
        # a beard of hanging roots under the jaw
        for k, (x, y, l) in enumerate(((0.0, -1.55, 0.62), (0.18, -1.48, 0.5), (-0.18, -1.48, 0.55), (0.3, -1.3, 0.38),
                                       (-0.3, -1.3, 0.42))):
            a = np.array((x, y, 4.3))
            pts = [a, a + np.array((0.03 * np.sign(x + 1e-3), -0.06, -l * 0.5)), a + np.array((0.0, 0.02, -l))]
            F.add(Polyline(pts, [0.07, 0.05, 0.015], bone='Jaw'), 0.04)
    else:
        # the Sprout: a fat seed-bud of a head split by a maw from ear to ear
        F.add(Ellipsoid(HEAD_C + (0, 0, 0.12), (0.92, 0.92, 0.72), bone='Head'), 0.2)
        F.add(Ellipsoid((0, -1.5, 5.25), (0.7, 0.55, 0.42), bone='Head'), 0.15)
        F.add(Ellipsoid((0, -1.3, 4.42), (0.78, 0.8, 0.36), bone='Jaw'), 0.12)
        F.add(Ellipsoid((0, -1.75, 4.5), (0.5, 0.3, 0.28), bone='Jaw'), 0.1)
    # arms
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        F.add(RoundCone(sh, el, 0.42, 0.33, bone=_side('UpperArm', s)), 0.18)
        F.add(Sphere(el + np.array((0.04 * s, 0.08, 0)), 0.36, bone=_side('ElbowFix', s)), 0.1)
        F.add(RoundCone(el, wr, 0.34, 0.27, bone=_side('Forearm', s)), 0.12)
        F.add(Ellipsoid(_lerp(el, wr, 0.4) + np.array((0.06 * s, 0.04, 0)), (0.36, 0.34, 0.42), seg_frame(el, wr),
                        bone=_side('Forearm', s)), 0.1)                                      # forearm burl
        nv = 4 if sp else NVINE
        for i in range(nv):
            a, b = _m(VINE_PTS[i], s), _m(VINE_PTS[i + 1], s)
            ra, rb = VINE_R[i] * 0.62, VINE_R[i + 1] * 0.62
            if sp and i == nv - 1:
                rb = 0.02
            F.add(RoundCone(a, b, ra, rb, bone=_side(f'Vine{i + 1}', s)), 0.06)
    # legs: thick trunks onto root feet
    for s in (1, -1):
        hp, kn, an, ft, tt = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(FOOT_T, s), _m(TOE_T, s)
        F.add(RoundCone(hp + (0, 0, 0.1), kn, 0.62, 0.46, bone=_side('Thigh', s)), 0.2)
        F.add(Sphere(kn + np.array((0.02 * s, -0.08, 0)), 0.42, bone=_side('KneeFix', s)), 0.1)
        F.add(RoundCone(kn, an, 0.45, 0.4, bone=_side('Shin', s)), 0.12)
        F.add(Ellipsoid(_lerp(an, ft, 0.4) + np.array((0, 0, -0.05)), (0.44, 0.55, 0.26), bone=_side('Foot', s)), 0.12)
        # root claws: three forward, one back, curling into the ground
        for k, a in enumerate((-36, 0, 26)):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            p0 = ft + np.array((0, 0, 0.06))
            p1 = ft + d * 0.42 + np.array((0, 0, 0.04))
            p2 = ft + d * 0.78 + np.array((0, 0, -0.02))
            F.add(Polyline([p0, p1, p2], [0.17, 0.12, 0.05], bone=_side('Toes', s)), 0.06)
        back = an + np.array((0.0, 0.5, -0.36))
        F.add(RoundCone(an + np.array((0, 0.1, -0.1)), back, 0.2, 0.06, bone=_side('Foot', s)), 0.06)
    # the back vine and the tendrils carry their own small cores (spring bones)
    if not sp:
        F.add(Polyline(BACKVINE, [0.16, 0.11, 0.05], bone='BackVine1'), 0.08)
        F.prims[-1] = (Polyline(BACKVINE[:2], [0.16, 0.11], bone='BackVine1'), 0.08)
        F.prims.append((Polyline(BACKVINE[1:], [0.11, 0.05], bone='BackVine2'), 0.08))
    for s in (1, -1):
        T = [_m(p, s) for p in TENDRIL_L]
        if sp:
            T = [T[0], _lerp(T[0], T[1], 0.6)]
        F.add(Polyline(T, [0.14, 0.09, 0.025][:len(T)], bone=_side('Tendril1', s)), 0.06)
        if not sp:
            F.prims[-1] = (Polyline(T[:2], [0.14, 0.09], bone=_side('Tendril1', s)), 0.06)
            F.prims.append((Polyline(T[1:], [0.09, 0.025], bone=_side('Tendril2', s)), 0.06))

    # ---------------------------------------------------------------- braided vine strands
    sr = 0.105 if not sp else 0.12
    for s in (1, -1):
        # legs: a bundle twisting up each trunk into the hips
        leg = _leg_path(s)
        braid(F, leg, lambda u: 0.36, 6, sr, 0.45 * s, phase0=0.3 * s, seed=11 + s, wobble=0.12)
        # the long run: root foot -> hips -> across the chest -> the OPPOSITE arm
        # (the braids cross over the chest), and the same side's arm
        arm_o = _vine_arm_path(-s)
        arm_s = _vine_arm_path(s)
        torso = [_m((0.55, -0.3, 2.75), s), _m((0.42, -0.62, 3.4), s), _m((0.05, -0.86, 4.05), s),
                 _m((-0.5, -0.82, 4.55), s), _m((-0.95, -0.55, 4.85), s)]
        f_arm, L_arm = arm_radius_fn(-s)
        nv = 4 if sp else NVINE
        arm_end = (len(arm_o) - (NVINE - nv)) if sp else len(arm_o)
        path = torso + arm_o[1:arm_end]
        pts, ss = resample(path, 0.05)
        L_t = resample(torso, 0.05)[1][-1]
        rfn = lambda u, L_t=L_t, f_arm=f_arm: 0.17 if u < L_t else f_arm(u - L_t + 0.05)  # noqa: E731
        lines = braid(F, path, rfn, 3, lambda u, L_t=L_t: 0.12 if u < L_t else 0.105, 0.55,
                      phase0=1.1 * s, seed=21 + s, taper=lambda t: 1.0 - 0.55 * max(0.0, t - 0.55) / 0.45)
        STRANDS.extend(lines)
        # the back and shoulders: strands over the hump into the same-side arm
        back = [_m((0.3, 0.62, 2.9), s), _m((0.42, 0.78, 3.8), s), _m((0.48, 0.66, 4.7), s), _m((0.85, 0.2, 5.15), s)]
        path = back + arm_s[1:arm_end]
        L_b = resample(back, 0.05)[1][-1]
        f_arm2, _ = arm_radius_fn(s)
        rfn2 = lambda u, L_b=L_b, f_arm2=f_arm2: 0.17 if u < L_b else f_arm2(u - L_b + 0.05)  # noqa: E731
        lines = braid(F, path, rfn2, 3, 0.11, -0.5, phase0=0.4 * s, seed=31 + s,
                      taper=lambda t: 1.0 - 0.55 * max(0.0, t - 0.55) / 0.45)
        STRANDS.extend(lines)
    # strands wrapping the belly and the ribs (horizontal-ish girdles that read as
    # vines grown round the core)
    for z, rx, ry, n in ((3.25, 0.72, 0.62, 2), (3.75, 0.8, 0.7, 2), (4.25, 0.98, 0.78, 1)):
        ring = [np.array((rx * math.cos(a), -0.05 + ry * math.sin(a), z + 0.12 * math.sin(2 * a + z)))
                for a in np.linspace(0, math.tau, 40)]
        braid(F, ring, 0.06, n, 0.09, 1.2, seed=int(z * 10), step=0.1)
    # a gnarled sap-split down the chest: two thick strands framing a crack
    for s in (1, -1):
        crack = [_m((0.12, -0.72, 4.6), s), _m((0.16, -0.78, 4.15), s), _m((0.1, -0.7, 3.7), s),
                 _m((0.12, -0.55, 3.25), s)]
        F.add(Polyline(crack, [0.11, 0.13, 0.12, 0.09]), 0.06, weight=False)

    # ---------------------------------------------------------------- the face hollows
    if not sp:
        for s in (1, -1):
            e = _m(EYE, s)
            R = rot_matrix(ry=0.4 * s)
            F.sub(Ellipsoid(e + np.array((0, -0.05, -0.01)), (0.12, 0.12, 0.065), R), 0.03)  # a slanted slit
            F.sub(Ellipsoid(e + np.array((0, 0.07, -0.01)), (0.09, 0.1, 0.07), R), 0.03)    # deep behind it
        F.sub(Ellipsoid((0, -1.64, 4.47), (0.3, 0.22, 0.065)), 0.025)                       # the maw slit
        F.sub(Ellipsoid((0, -1.46, 4.47), (0.22, 0.24, 0.1)), 0.04)
    else:
        for s in (1, -1):
            e = _m(EYE, s)
            F.sub(Sphere(e + np.array((0, -0.03, 0.0)), 0.14), 0.04)
        # the maw: a deep split right round the front of the bud
        F.sub(Ellipsoid((0, -1.45, MOUTH['z']), (0.86, 0.85, 0.07)), 0.03)
        F.sub(Ellipsoid((0, -1.15, MOUTH['z']), (0.6, 0.6, 0.18)), 0.06)

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (5, 8, 1.0), radius=0.0), 0.02)

    if detail:
        _detail(F, noise)
    return F


def _detail(F, noise):
    """Bark grain: fine ridged fibres stretched along Z (the strands mostly run up
    the body), knots, and a soft lumpy fbm."""
    F.displace(lambda X, Y, Z: 0.012 * noise.fbm(X * 1.8, Y * 1.8, Z * 1.8, octaves=3)
               - 0.008 * noise.ridged(X * 16 + 3, Y * 16, Z * 3.5, octaves=2)
               + 0.003 * noise(X * 40 + 7, Y * 40, Z * 40), band=0.12)


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
