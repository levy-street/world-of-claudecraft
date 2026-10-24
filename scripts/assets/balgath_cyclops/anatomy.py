"""Balgath's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Hollow Crypt organic kit): Blender units are yards,
+Z up, the creature FACES -Y (the game's +Z after the glTF export), his left is +X.
Bones are (name, parent, head, tail); `L_` bones are mirrored onto `R_` (x -> -x).
The hand bones keep the shipped rig's names (`L_Hand`, `R_Hand`, `Head`): the
renderer's fist glows and the eye glow look those names up.

He is authored at his in-game size: a hunched 13.4 yards at idle (the shipped
`BALGATH_SCALE` 4.2 times the 3.2-unit visual height), about five players tall.
The rest pose stands him straight with the arms hanging out at 40 degrees, the
pose every skin weight is computed in.

Proportions are a heavy giant's, not a man's scaled up: a small head thrust
forward and low between a trapezius hump, shoulders three heads wide, a barrel gut,
forearms thicker than the upper arms, short thick legs and broad flat feet. Hands
reach to the knee so a fist can strike the ground without a full crouch.
"""
import math

import numpy as np

from sdf import (Capsule, Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from,
                 rot_matrix)

# ------------------------------------------------------------------ landmarks
EYE = np.array((0.0, -2.02, 12.72))      # the Barrowglass: centre of the eyeball
EYE_R = 0.56                              # eyeball radius
SHOULDER = np.array((2.6, 0.2, 10.5))
ELBOW = np.array((4.55, 0.45, 8.0))
WRIST = np.array((5.9, -0.35, 5.35))
HAND_TIP = np.array((6.32, -0.62, 4.05))
HIP = np.array((1.32, 0.3, 6.2))
KNEE = np.array((1.48, -0.12, 3.45))
ANKLE = np.array((1.56, 0.36, 0.98))
BALL = np.array((1.64, -1.12, 0.34))
TOE = np.array((1.68, -1.95, 0.3))


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def hand_frame(side=1):
    """(origin, down, width, palm) of a hand at rest. `width` points toward the
    index finger (forward), `palm` is the palm's normal (toward the thigh)."""
    w = WRIST if side > 0 else mirror(WRIST)
    tip = HAND_TIP if side > 0 else mirror(HAND_TIP)
    down = tip - w
    down /= np.linalg.norm(down)
    width = np.array((0.0, -1.0, 0.0))
    width -= down * (width @ down)
    width /= np.linalg.norm(width)
    palm = np.cross(down, width) * side
    palm /= np.linalg.norm(palm)
    return w, down, width, palm


def finger_chain(side, name):
    """Rest stations (base, mid, tip) of a finger, and its curl axis."""
    w, down, width, palm = hand_frame(side)
    if name == 'Thumb':
        base = w + down * 0.45 + width * 0.54 + palm * 0.37
        d = down * 0.55 + width * 0.55 + palm * 0.62
        d /= np.linalg.norm(d)
        mid = base + d * 0.6
        d2 = d + down * 0.35
        d2 /= np.linalg.norm(d2)
        tip = mid + d2 * 0.52
        return base, mid, tip
    spread = {'Index': 0.8, 'Middle': 0.0, 'Ring': -0.78}[name]
    fan = {'Index': 0.12, 'Middle': 0.0, 'Ring': -0.12}[name]
    base = w + down * 1.5 + width * spread + palm * 0.06
    d = down + width * fan + palm * 0.18
    d /= np.linalg.norm(d)
    length = {'Index': 0.86, 'Middle': 0.95, 'Ring': 0.82}[name]
    mid = base + d * length
    d2 = d + palm * 0.32
    d2 /= np.linalg.norm(d2)
    tip = mid + d2 * length * 0.86
    return base, mid, tip


FINGERS = ('Thumb', 'Index', 'Middle', 'Ring')


def _bones_left():
    out = [
        ('L_Clavicle', 'Spine2', (0.45, -0.05, 10.3), tuple(SHOULDER)),
        ('L_UpperArm', 'L_Clavicle', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        # The elbow helper takes half the forearm's bend (keyed by rig.py), so the
        # skin at the joint follows the bisector instead of collapsing.
        ('L_ElbowFix', 'L_UpperArm', tuple(ELBOW), tuple(_lerp(ELBOW, WRIST, 0.3))),
        ('L_Hand', 'L_Forearm', tuple(WRIST), tuple(HAND_TIP)),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), tuple(BALL)),
        ('L_Toes', 'L_Foot', tuple(BALL), tuple(TOE)),
    ]
    for f in FINGERS:
        base, mid, tip = finger_chain(1, f)
        out.append((f'L_{f}1', 'L_Hand', tuple(base), tuple(mid)))
        out.append((f'L_{f}2', f'L_{f}1', tuple(mid), tuple(tip)))
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
    ('Root', None, (0, 0, 0), (0, 0, 1.0)),
    ('Hips', 'Root', (0, 0.25, 6.4), (0, 0.25, 7.3)),
    ('Spine1', 'Hips', (0, 0.25, 7.3), (0, 0.15, 8.9)),
    ('Spine2', 'Spine1', (0, 0.15, 8.9), (0, 0.0, 10.5)),
    ('Neck', 'Spine2', (0, 0.05, 10.5), (0, -0.75, 11.75)),
    ('Head', 'Neck', (0, -0.75, 11.75), (0, -0.95, 13.2)),
    # The gut on its own bone: the follow-through springs let it sway and jolt.
    ('Belly', 'Spine1', (0, -0.6, 7.55), (0, -1.95, 7.25)),
    ('Jaw', 'Head', (0, -1.0, 11.98), (0, -2.15, 11.4)),
    ('Brow', 'Head', (0, -1.55, 13.15), (0, -2.45, 13.3)),
    # The eye: the core's keyed scale is the iris flare (flares on the wake and the
    # glare, gutters out on the death), the lids close over it on their hinge.
    ('EyeCore', 'Head', tuple(EYE), tuple(EYE + (0, -0.7, 0))),
    ('LidUp', 'Head', tuple(EYE), tuple(EYE + (0, 0, 0.7))),
    ('LidLo', 'Head', tuple(EYE), tuple(EYE + (0, 0, -0.7))),
    # The hide apron front and back, the tally string on his right hip, the broken
    # chain hanging from the right shackle: all carried by the follow-through
    # springs rig.py simulates over every clip.
    ('LoinF1', 'Hips', (0, -2.0, 6.55), (0, -2.22, 5.15)),
    ('LoinF2', 'LoinF1', (0, -2.22, 5.15), (0, -2.3, 3.85)),
    ('LoinB1', 'Hips', (0, 1.85, 6.6), (0, 2.1, 5.25)),
    ('LoinB2', 'LoinB1', (0, 2.1, 5.25), (0, 2.18, 4.05)),
    ('Tally1', 'Hips', (-2.12, -0.75, 6.55), (-2.3, -0.85, 5.5)),
    ('Tally2', 'Tally1', (-2.3, -0.85, 5.5), (-2.36, -0.9, 4.45)),
    ('R_Chain1', 'R_Forearm', (-5.62, -0.05, 5.85), (-5.75, -0.1, 4.95)),
    ('R_Chain2', 'R_Chain1', (-5.75, -0.1, 4.95), (-5.82, -0.12, 4.05)),
] + _bones_left())


def _topo(bones):
    """Parents before children (the pose solver walks the list in order)."""
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


# ------------------------------------------------------------------ body sculpt
def _sym(fn):
    """Call fn(side) for both sides (side = +1 left, -1 right)."""
    for s in (1, -1):
        fn(s)


def _m(p, s):
    p = np.asarray(p, dtype=float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _along_rot(a, b):
    """Rotation whose z column runs a -> b (orients an ellipsoid along a limb)."""
    return frame_from(np.asarray(b) - np.asarray(a))


def build_body(voxel=0.035, detail=True, seed=7):
    """The whole skin as one distance field (rest pose)."""
    F = Field((-7.6, -3.4, -0.25), (7.6, 2.9, 14.4), voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, 0.18, 6.55), (2.05, 1.5, 1.15), bone='Hips'), 0.4)
    F.add(Ellipsoid((0, -0.55, 7.75), (2.3, 2.05, 1.85), rot_matrix(rx=0.12), bone='Belly'), 0.5)
    F.add(Ellipsoid((0, -0.85, 7.12), (1.95, 1.75, 1.2), bone='Belly'), 0.5)            # the hanging gut
    F.add(Ellipsoid((0, 0.85, 7.75), (1.8, 0.95, 1.45), bone='Spine1'), 0.45)           # lower back
    F.add(Ellipsoid((0, 0.12, 9.55), (2.7, 1.85, 1.85), rot_matrix(rx=-0.12), bone='Spine2'), 0.45)
    F.add(Ellipsoid((0, 0.95, 10.55), (2.2, 1.2, 1.3), rot_matrix(rx=-0.3), bone='Spine2'), 0.6)        # the upper-back hump
    F.add(Ellipsoid((0, 0.75, 9.15), (0.42, 0.5, 1.4), bone='Spine2'), 0.25)            # spinal ridge (erectors)

    def torso_side(s):
        F.add(Ellipsoid(_m((1.2, -1.32, 9.9), s), (1.42, 0.8, 1.05), rot_matrix(ry=0.28 * s, rz=0.12 * s),
                        bone='Spine2'), 0.22)                                                  # pec
        F.add(Ellipsoid(_m((2.1, 0.5, 9.1), s), (0.95, 1.1, 1.6), rot_matrix(ry=0.22 * s), bone='Spine2'),
              0.3)                                                                            # lat
        F.add(RoundCone(_m((0.4, 0.3, 11.3), s), _m((2.35, 0.35, 10.85), s), 1.0, 0.7, bone='Spine2'),
              0.45)                                                                            # trapezius
        F.add(Ellipsoid(_m((1.88, -0.12, 7.7), s), (0.82, 1.25, 1.15), bone='Spine1'), 0.45)  # flank
        F.add(Ellipsoid(_m((0.95, 1.05, 6.12), s), (1.05, 0.85, 1.12), bone='Hips'), 0.32)    # glute
        F.add(Ellipsoid(_m((0.7, 0.85, 8.55), s), (0.55, 0.45, 0.95), bone='Spine1'), 0.3)   # lower erector
    _sym(torso_side)
    F.add(Ellipsoid((0, -0.62, 5.98), (0.95, 0.72, 0.72), bone='Hips'), 0.35)

    # ---------------------------------------------------------------- neck and head
    F.add(RoundCone((0, 0.18, 10.7), (0, -0.82, 11.82), 1.08, 0.9, bone='Neck'), 0.55)
    _sym(lambda s: F.add(RoundCone(_m((0.62, -0.92, 10.72), s), _m((0.78, -0.72, 11.95), s), 0.32, 0.26,
                                   bone='Neck'), 0.3))
    F.add(Ellipsoid((0, -1.18, 12.5), (1.22, 1.2, 1.02), rot_matrix(rx=-0.15), bone='Head'), 0.35)
    F.add(Ellipsoid((0, -0.9, 12.82), (1.12, 1.05, 0.8), bone='Head'), 0.35)
    F.add(Ellipsoid((0, -2.0, 11.98), (0.95, 0.66, 0.46), bone='Head'), 0.25)            # the muzzle
    _sym(lambda s: F.add(Ellipsoid(_m((0.8, -1.98, 12.28), s), (0.46, 0.4, 0.34), bone='Head'), 0.2))  # cheek
    F.add(Ellipsoid((0, -2.55, 12.14), (0.4, 0.3, 0.24), rot_matrix(rx=0.25), bone='Head'), 0.14)            # nose
    _sym(lambda s: F.add(Ellipsoid(_m((0.3, -2.45, 12.04), s), (0.22, 0.21, 0.16), bone='Head'), 0.1))
    F.add(Ellipsoid((0, -2.46, 11.76), (0.7, 0.3, 0.18), bone='Head'), 0.12)             # upper lip
    # The jaw: a heavy underbite, the lower lip pushed out past the upper.
    F.add(Ellipsoid((0, -1.85, 11.34), (1.12, 0.82, 0.5), rot_matrix(rx=0.2), bone='Jaw'), 0.3)
    F.add(Ellipsoid((0, -2.5, 11.24), (0.72, 0.42, 0.42), bone='Jaw'), 0.22)              # chin
    _sym(lambda s: F.add(Ellipsoid(_m((0.98, -1.3, 11.55), s), (0.42, 0.66, 0.56), bone='Jaw'), 0.25))
    F.add(Ellipsoid((0, -2.68, 11.56), (0.74, 0.3, 0.19), bone='Jaw'), 0.1)              # lower lip
    _sym(lambda s: F.add(Ellipsoid(_m((0.98, -2.0, 11.2), s), (0.38, 0.44, 0.38), bone='Jaw'), 0.2))   # jowl
    # Ears: small, ragged, swept back.
    _sym(lambda s: F.add(Ellipsoid(_m((1.12, -0.98, 12.48), s), (0.13, 0.36, 0.44), rot_matrix(rx=0.4),
                                   bone='Head'), 0.1))
    # The heavy brow, on its own bone so it can knit down into a glare.
    # A scowling V: each brow a heavy ridge sloping down to a knot over the nose,
    # overhanging the eye, the outer ends swept up and back into the skull.
    # A heavy shelf of brow over the eye, notched in the middle into a scowl; the
    # two halves rise a little to the outer corners and sink into the skull.
    F.add(Ellipsoid((0, -2.2, 13.26), (1.14, 0.58, 0.33), rot_matrix(rx=0.24), bone='Brow'), 0.22)
    _sym(lambda s: F.add(Ellipsoid(_m((0.52, -2.44, 13.26), s), (0.52, 0.36, 0.25), rot_matrix(rx=0.3, ry=-0.32 * s),
                                   bone='Brow'), 0.14))
    F.add(Sphere((0, -2.62, 13.1), 0.21, bone='Brow'), 0.14)                               # the knot
    # The socket the Barrowglass sits in, the mouth line, the nostrils.
    F.sub(Sphere(EYE + (0, -0.04, 0.0), EYE_R + 0.075), 0.11)
    F.sub(Ellipsoid((0, -2.62, 11.665), (0.63, 0.45, 0.042)), 0.035)
    # the sneer: the left upper lip hitched up off a broken fang
    F.sub(Ellipsoid((0.42, -2.78, 11.8), (0.22, 0.24, 0.13), rot_matrix(ry=-0.4)), 0.05)
    _sym(lambda s: F.sub(Sphere(_m((0.16, -2.75, 12.03), s), 0.075), 0.04))

    # ---------------------------------------------------------------- arms
    def arm(s):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        rot_ua = _along_rot(sh, el)
        F.add(Ellipsoid(_m((3.02, 0.08, 10.45), s), (1.25, 1.3, 1.3), rot_matrix(ry=-0.45 * s), bone=up), 0.26)
        F.add(RoundCone(sh, el, 1.05, 0.8, bone=up), 0.3)
        ax = (el - sh) / np.linalg.norm(el - sh)
        fwd = np.array((0.0, -1.0, 0.0))
        out = np.cross(ax, fwd) * -s
        F.add(Ellipsoid(_lerp(sh, el, 0.48) + fwd * 0.36, (0.72, 0.7, 1.15), rot_ua, bone=up), 0.18)   # biceps
        F.add(Ellipsoid(_lerp(sh, el, 0.42) - fwd * 0.38 + out * 0.18, (0.72, 0.68, 1.2), rot_ua, bone=up), 0.18)
        F.add(Sphere(el - fwd * 0.3 + out * 0.05, 0.5, bone=_side('ElbowFix', s)), 0.3)          # the elbow
        p1 = _lerp(el, wr, 0.33)
        F.add(RoundCone(el, p1, 0.9, 1.2, bone=fo), 0.3)
        F.add(RoundCone(p1, wr, 1.2, 0.74, bone=fo), 0.3)
        rot_fa = _along_rot(el, wr)
        F.add(Ellipsoid(_lerp(el, wr, 0.24) + out * 0.42 + fwd * 0.2, (0.62, 0.58, 1.05), rot_fa, bone=fo), 0.16)
        # The hand: a broad slab of a palm, knuckles like cobbles, three thick fingers.
        w, down, width, palm = hand_frame(s)
        hand = _side('Hand', s)
        R = np.stack([width, palm, down], axis=1)
        F.add(RoundBox(w + down * 0.8, (0.74, 0.27, 0.62), R, radius=0.3, bone=hand), 0.2)
        F.add(Ellipsoid(w + down * 0.5 + width * 0.38 + palm * 0.22, (0.36, 0.3, 0.46), R, bone=hand), 0.18)
        F.add(Ellipsoid(w + down * 0.75 - width * 0.42 + palm * 0.1, (0.3, 0.28, 0.52), R, bone=hand), 0.15)
        for f in FINGERS:
            base, mid, tip = finger_chain(s, f)
            r0 = 0.37 if f == 'Thumb' else 0.32
            b1, b2 = _side(f + '1', s), _side(f + '2', s)
            F.add(Sphere(base - palm * 0.16, r0 + 0.07, bone=hand), 0.07)                       # knuckle
            F.add(RoundCone(base, mid, r0, r0 * 0.88, bone=b1), 0.07)
            F.add(Sphere(mid, r0 * 0.92, bone=b2), 0.05)
            F.add(RoundCone(mid, tip, r0 * 0.88, r0 * 0.74, bone=b2), 0.05)
    _sym(arm)

    # ---------------------------------------------------------------- legs
    def leg(s):
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sh = _side('Thigh', s), _side('Shin', s)
        F.add(RoundCone(hp + (0, 0, 0.12), kn, 1.4, 1.02, bone=th), 0.45)
        rot = _along_rot(hp, kn)
        F.add(Ellipsoid(_lerp(hp, kn, 0.42) + np.array((0.12 * s, -0.48, 0)), (0.92, 0.8, 1.35), rot, bone=th), 0.24)
        F.add(Ellipsoid(_lerp(hp, kn, 0.45) + np.array((0.3 * s, 0.5, 0)), (0.72, 0.68, 1.15), rot, bone=th), 0.35)
        kf = _side('KneeFix', s)
        F.add(Sphere(kn + np.array((0, -0.46, 0.06)), 0.5, bone=kf), 0.22)                     # kneecap
        F.add(Sphere(kn, 0.86, bone=kf), 0.3)
        F.add(RoundCone(kn, an, 0.9, 0.62, bone=sh), 0.35)
        rs = _along_rot(kn, an)
        F.add(Ellipsoid(_lerp(kn, an, 0.3) + np.array((0.05 * s, 0.42, 0)), (0.82, 0.7, 1.2), rs, bone=sh), 0.22)
        F.add(Sphere(an, 0.6, bone=sh), 0.25)
        foot = _side('Foot', s)
        F.add(Ellipsoid(an + np.array((0, 0.26, -0.42)), (0.64, 0.68, 0.52), bone=foot), 0.3)    # heel
        F.add(RoundBox(_m((1.6, -0.42, 0.44), s), (0.58, 0.8, 0.16), radius=0.28, bone=foot), 0.3)
        toes = _side('Toes', s)
        for k, (dx, ln, r) in enumerate(((0.56, 0.85, 0.28), (0.0, 0.94, 0.28), (-0.54, 0.78, 0.25))):
            a = _m((1.64 + dx, -1.0, 0.34), s)
            b = _m((1.66 + dx * 1.12, -1.0 - ln, 0.28), s)
            F.add(RoundCone(a, b, r, r * 0.86, bone=toes), 0.1)
    _sym(leg)

    if detail:
        _skin_detail(F, noise, seed)
    return F


# ------------------------------------------------------------------ detail
def _scar(F, pts, width=0.05, depth=0.03):
    """A healed slash: a raised keloid welt with a fine crease down its middle."""
    line = Polyline(pts, 0.01)
    F.ridge(line, depth * 1.4, k=width * 1.6)
    F.groove(line, depth * 0.8, k=width * 0.5)


def _vein(F, rng, a, b, r_of_t, around, wander=0.6, width=0.032, height=0.028):
    """A vein winding down a limb from a to b at the limb's surface."""
    a, b = np.asarray(a), np.asarray(b)
    ax = (b - a) / np.linalg.norm(b - a)
    e1 = np.cross(ax, (0, 0, 1.0))
    if np.linalg.norm(e1) < 1e-3:
        e1 = np.cross(ax, (1.0, 0, 0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    pts = []
    th = around
    for i in range(14):
        t = i / 13
        th += rng.normal(0, wander * 0.18)
        p = a + (b - a) * t + (e1 * math.cos(th) + e2 * math.sin(th)) * (r_of_t(t) - 0.04)
        pts.append(p)
    F.ridge(Polyline(pts, 0.01), height, k=width)


def _project(F, origin, toward, inset=0.025):
    """The skin point on the ray from an inside origin toward a point."""
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 4.0:
        t += F.voxel * 0.6
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return np.asarray(toward, float)


def _face_detail(F):
    """The lines of a face that has squinted into the fen wind for an age."""
    hc = np.array((0.0, -1.15, 12.55))

    def line(pts, depth=0.035, k=0.045, ridge=0.0):
        P = [_project(F, hc, p) for p in pts]
        poly = Polyline(P, 0.008)
        F.groove(poly, depth, k=k)
        if ridge:
            F.ridge(Polyline([p + (p - hc) / np.linalg.norm(p - hc) * k * 1.2 for p in P], 0.008), ridge, k=k * 1.3)

    for z, w in ((13.62, 0.6), (13.78, 0.72), (13.93, 0.62)):          # forehead furrows
        line([(-w, -2.0 + 0.25 * w, z + 0.05), (-w * 0.4, -2.2, z - 0.03), (0, -2.25, z),
              (w * 0.45, -2.2, z - 0.02), (w, -2.0 + 0.25 * w, z + 0.06)], depth=0.03)
    line([(0.0, -2.42, 13.7), (0.0, -2.55, 13.42), (0.02, -2.66, 13.28)], depth=0.09, k=0.07)   # the scowl
    line([(-0.18, -2.55, 13.55), (-0.14, -2.62, 13.28)], depth=0.03)
    for s in (1, -1):
        line([(0.42 * s, -2.5, 12.04), (0.62 * s, -2.42, 11.86), (0.78 * s, -2.28, 11.6), (0.86 * s, -2.1, 11.3)],
             depth=0.085, k=0.06, ridge=0.035)                            # nasolabial folds
        line([(0.62 * s, -2.2, 11.35), (0.74 * s, -1.95, 11.05)], depth=0.06, k=0.05)  # jowl crease
        line([(1.0 * s, -1.9, 12.25), (0.95 * s, -2.05, 11.85)], depth=0.05, k=0.05)   # cheek
        for k in range(3):                                                # crow's feet
            a = math.radians(-25 + 25 * k)
            c = np.array((0.66 * s, -2.12, 12.72))
            line([c, c + np.array((0.32 * s * math.cos(a), 0.18, 0.32 * math.sin(a)))], depth=0.025, k=0.035)
        line([(0.2 * s, -2.42, 12.12), (0.45 * s, -2.32, 12.08), (0.66 * s, -2.12, 12.2)], depth=0.025)  # under-eye
    line([(0.0, -2.62, 12.0), (0.0, -2.6, 11.84)], depth=0.025, k=0.04)  # philtrum
    nc = np.array((0.0, -0.3, 10.9))
    for z in (10.75, 10.95, 11.15):                                     # neck folds under the jaw
        pts = [(x, -1.5, z + 0.04 * abs(x)) for x in (-0.8, -0.4, 0.0, 0.4, 0.8)]
        P = [_project(F, nc, p) for p in pts]
        F.groove(Polyline(P, 0.008), 0.035, k=0.05)
    F.sub(Sphere(_project(F, (0, -0.6, 7.3), (0, -3.0, 7.35)), 0.09), 0.05)   # navel


def _body_detail(F):
    """Muscle separations a sculptor would cut: deltoid from biceps, the pec's
    lower border, the clavicles, the forearm's two masses, the knee."""
    def cut(center, pts, depth=0.05, k=0.08):
        P = [_project(F, center, p) for p in pts]
        F.groove(Polyline(P, 0.01), depth, k=k)

    def ridge(center, pts, height=0.04, k=0.09):
        P = [_project(F, center, p, inset=-0.02) for p in pts]
        F.ridge(Polyline(P, 0.01), height, k=k)

    chest = np.array((0.0, 0.1, 9.6))
    cut(chest, [(0.0, -2.2, 10.4), (0.0, -2.4, 9.6), (0.0, -2.5, 9.0)], depth=0.06)          # sternum line
    for s in (1, -1):
        cut(chest, [(0.3 * s, -2.35, 9.0), (1.0 * s, -2.25, 8.85), (1.8 * s, -1.85, 9.0), (2.4 * s, -1.2, 9.5)],
            depth=0.07, k=0.09)                                                             # pec border
        ridge(chest, [(0.4 * s, -1.4, 10.75), (1.3 * s, -1.25, 10.8), (2.2 * s, -1.0, 10.75)], 0.05)  # clavicle
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        ua = _lerp(sh, el, 0.5)
        cut(ua, [_m((3.35, -1.25, 10.3), s), _m((3.8, -0.75, 9.4), s), _m((4.05, -0.3, 8.9), s)], depth=0.06)  # deltoid
        cut(ua, [_m((3.5, 1.0, 9.4), s), _m((4.0, 1.0, 8.9), s)], depth=0.045)            # triceps head
        fa = _lerp(el, wr, 0.35)
        ax = (wr - el) / np.linalg.norm(wr - el)
        out = np.cross(ax, (0, -1.0, 0)) * -s
        cut(fa, [_lerp(el, wr, 0.12) + out * 1.0 - np.array((0, 0.6, 0)), _lerp(el, wr, 0.45) + out * 1.2
                 - np.array((0, 0.75, 0)), _lerp(el, wr, 0.8) + out * 0.8 - np.array((0, 0.5, 0))], depth=0.05)
        # the grooves between the fingers, so a clenched fist still reads as separate fingers
        w, down, width, palm = hand_frame(s)
        hc = w + down * 0.9
        chains = {f: finger_chain(s, f) for f in FINGERS}
        for fa, fb in (('Index', 'Middle'), ('Middle', 'Ring')):
            (a0, a1, a2), (b0, b1, b2) = chains[fa], chains[fb]
            pts = [(a0 + b0) / 2 - down * 0.25, (a0 + b0) / 2, (a1 + b1) / 2]
            P = [_project(F, hc, p - palm * 0.6, inset=0.0) for p in pts]
            F.groove(Polyline(P, 0.01), 0.07, k=0.055)
        kn = _m(KNEE, s)
        cut(kn, [kn + np.array((-0.6 * s, -1.0, 0.45)), kn + np.array((0, -1.2, 0.62)), kn + np.array((0.6 * s, -1.0, 0.45))],
            depth=0.05)                                                                     # above the kneecap


def _skin_detail(F, noise, seed):
    rng = np.random.default_rng(seed)
    _face_detail(F)
    _body_detail(F)
    # Lumpy, leathery hide all over: low broad swells, finer pebbling on top.
    F.displace(lambda X, Y, Z: 0.024 * noise.fbm(X * 1.1, Y * 1.1, Z * 1.1, octaves=3)
               + 0.008 * noise.fbm(X * 6.0 + 11, Y * 6.0, Z * 6.0, octaves=2), band=0.3)
    # Hide folds: ridged creases, strongest at the belly's underside and the joints.
    def folds(X, Y, Z):
        r = noise.ridged(X * 2.2 + 3.1, Y * 2.2, Z * 5.5, octaves=2)
        belly = np.exp(-(((Y + 1.8) / 1.0) ** 2 + ((Z - 6.95) / 0.9) ** 2))
        neck = np.exp(-((X / 1.2) ** 2 + ((Y + 0.4) / 1.1) ** 2 + ((Z - 11.0) / 0.7) ** 2))
        return -0.016 * r * (0.25 + 1.4 * belly + 1.2 * neck)
    F.displace(folds, band=0.25)
    # Knuckle and elbow wrinkles: horizontal creases across the joints.
    for s in (1, -1):
        for c, rad in ((_m(ELBOW, s), 0.9), (_m(KNEE, s), 0.9), (_m(WRIST, s), 0.7)):
            lo, hi = c - rad, c + rad

            def creases(X, Y, Z, c=c, rad=rad):
                d2 = ((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2) / rad ** 2
                return 0.02 * np.sin(Z * 26.0 + noise(X * 3, Y * 3, Z * 3) * 3.0) * np.exp(-d2 * 2.0)
            F.displace(creases, band=0.2, region=(lo, hi))
    # Scars: one across the chest from the left pec to the right of the gut, one over
    # the right brow and cheek (it never crosses the eye), two on the right arm.
    _scar(F, [(1.75, -1.72, 10.3), (0.9, -2.0, 9.6), (0.0, -2.38, 8.75), (-0.8, -2.5, 8.0), (-1.4, -2.38, 7.5)],
          width=0.06, depth=0.035)
    _scar(F, [(1.25, -1.82, 9.25), (0.65, -2.08, 8.85), (0.15, -2.3, 8.45)], width=0.045, depth=0.025)
    _scar(F, [(-0.95, -2.26, 13.55), (-0.85, -2.42, 13.05), (-0.92, -2.3, 12.4), (-1.05, -2.0, 11.95)],
          width=0.04, depth=0.025)
    # the old gouge across the brow ridge, where a pike once glanced off the stone
    _scar(F, [(0.95, -2.2, 13.62), (0.45, -2.68, 13.36), (-0.1, -2.8, 13.22), (-0.55, -2.64, 13.42)],
          width=0.05, depth=0.06)
    _scar(F, [(-3.55, -0.55, 9.95), (-3.95, -0.45, 9.25), (-4.25, -0.25, 8.75)], width=0.045, depth=0.03)
    _scar(F, [(-5.0, -0.85, 7.0), (-5.45, -0.9, 6.55)], width=0.04, depth=0.025)
    # Veins down the forearms and over the biceps.
    for s in (1, -1):
        el, wr = _m(ELBOW, s), _m(WRIST, s)
        r_fore = lambda t: 1.02 - 0.4 * max(0.0, t - 0.33) / 0.67 if t > 0.33 else 0.84 + 0.18 * t / 0.33  # noqa: E731
        for k in range(3):
            _vein(F, rng, _lerp(el, wr, 0.12), _lerp(el, wr, 0.95), r_fore, around=-1.2 + 1.1 * k + (0.6 if s < 0 else 0))
        sh = _m(SHOULDER, s)
        _vein(F, rng, _lerp(sh, el, 0.25), _lerp(sh, el, 0.9), lambda t: 0.92 - 0.12 * t, around=1.9, width=0.03,
              height=0.022)


def bone_of_point(F, p):
    """The bone whose primitives own a rest-pose point (for rigid dressing)."""
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.12)
    return bones[int(np.argmax(W[0]))]
