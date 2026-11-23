"""The Great Saurian's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Balgath kit this builder is adapted from): Blender
units are yards, +Z up, the creature FACES -Y (the game's +Z after the glTF
export), its left is +X. Bones are (name, parent, head, tail); `L_` bones are
mirrored onto `R_` (x -> -x).

A chunky war-sauropod: a barrel of a body as big as a house on four pillar legs
with elephant pads, a deep S-necked neck rising to a small crested head, and a
long tail ending in a bony club. Authored at its in-game size: the head stands
about 14 yards up at idle, the back (where the howdah rides) about 10.5.

Bones beside the body:
  * ElbowFix / KneeFix: joint helpers, half their twin's bend (rig.py keys them).
  * Saddle and the Howdah* bones: every howdah piece on its own bone, so the
    HowdahBreak clip can throw the pieces off the back; Rider is the seated troll.
  * BannerL1/L2, BannerR1/R2, Charm1/Charm2: dangling chains the follow-through
    springs carry (the Sunbone banners and the bone charms under the throat).
"""
import math

import numpy as np

from sdf import Capsule, Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, frame_from, rot_matrix

# ------------------------------------------------------------------ landmarks
SHOULDER = np.array((2.6, -3.3, 6.6))
ELBOW = np.array((2.75, -2.85, 3.6))
WRIST = np.array((2.8, -3.3, 1.1))
FPAD = np.array((2.8, -3.5, 0.66))
HIP = np.array((2.5, 3.2, 6.6))
KNEE = np.array((2.7, 2.55, 3.5))
ANKLE = np.array((2.75, 3.2, 1.1))
HPAD = np.array((2.75, 3.0, 0.66))
EYE = np.array((0.94, -10.45, 13.9))     # the left eye's centre
EYE_R = 0.25

NECK_PTS = [np.array(p) for p in ((0, -4.0, 8.3), (0, -5.9, 9.5), (0, -7.4, 10.9), (0, -8.5, 12.2), (0, -9.2, 13.3))]
TAIL_PTS = [np.array(p) for p in ((0, 3.4, 7.4), (0, 5.6, 7.3), (0, 7.7, 6.7), (0, 9.7, 5.9), (0, 11.6, 5.0),
                                  (0, 13.4, 4.2), (0, 15.1, 3.6), (0, 16.7, 3.2))]
TAIL_R = [2.35, 1.85, 1.46, 1.14, 0.88, 0.68, 0.54, 0.46]
NECK_R = [2.45, 1.85, 1.48, 1.22, 1.1]

# The howdah: a bamboo platform on the saddle blanket over the back.
HOWDAH_C = np.array((0.0, -0.6, 11.15))    # centre of the platform's top
HOWDAH_HALF = (2.15, 2.25)                  # half width (x) and half length (y)
POST_H = 2.9                                # corner post height above the platform


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    return [
        ('L_Scapula', 'Spine2', (1.2, -3.0, 8.6), tuple(SHOULDER)),
        ('L_UpperArm', 'L_Scapula', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_ElbowFix', 'L_UpperArm', tuple(ELBOW), tuple(_lerp(ELBOW, WRIST, 0.3))),
        ('L_Hand', 'L_Forearm', tuple(WRIST), (2.8, -4.4, 0.4)),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), (2.75, 2.2, 0.4)),
        ('L_Eye', 'Head', tuple(EYE), tuple(EYE + np.array((0.25, -0.1, 0)))),
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


def _howdah_bones():
    c = HOWDAH_C
    hx, hy = HOWDAH_HALF
    top = c[2] + POST_H
    out = [
        ('Saddle', 'Spine1', (0, c[1], 10.4), (0, c[1], 11.1)),
        ('HowdahBase', 'Saddle', tuple(c + (0, 0, -0.25)), tuple(c + (0, 0, 0.45))),
        ('HowdahRoof', 'Saddle', (0, c[1], top), (0, c[1], top + 0.8)),
        ('HowdahRailL', 'Saddle', (hx, c[1], c[2] + 0.5), (hx, c[1], c[2] + 1.2)),
        ('HowdahRailR', 'Saddle', (-hx, c[1], c[2] + 0.5), (-hx, c[1], c[2] + 1.2)),
        ('HowdahRailF', 'Saddle', (0, c[1] - hy, c[2] + 0.5), (0, c[1] - hy, c[2] + 1.2)),
        ('Rider', 'Saddle', (0, c[1] - 0.25, c[2] + 0.1), (0, c[1] - 0.25, c[2] + 1.6)),
    ]
    for tag, sx, sy in (('FL', 1, -1), ('FR', -1, -1), ('BL', 1, 1), ('BR', -1, 1)):
        p = np.array((sx * hx, c[1] + sy * hy, c[2]))
        out.append(('HowdahPost' + tag, 'Saddle', tuple(p), tuple(p + (0, 0, POST_H))))
    # The banners hang from the crossbars of the tall back poles (on the BL/BR posts).
    for side, sx in (('L', 1), ('R', -1)):
        a = np.array((sx * (hx + 0.24), c[1] + hy + 0.6, top + 1.95))
        out.append((f'Banner{side}1', f'HowdahPost{"B" + side}', tuple(a), tuple(a + (0, 0, -1.25))))
        out.append((f'Banner{side}2', f'Banner{side}1', tuple(a + (0, 0, -1.25)), tuple(a + (0, 0, -2.5))))
    return out


BONES = _expand([
    ('Root', None, (0, 0, 0), (0, 0, 1.0)),
    ('Hips', 'Root', (0, 3.4, 7.4), (0, 1.2, 7.7)),
    ('Spine1', 'Hips', (0, 1.2, 7.7), (0, -1.6, 8.0)),
    ('Spine2', 'Spine1', (0, -1.6, 8.0), tuple(NECK_PTS[0])),
    ('Belly', 'Spine1', (0, -0.2, 5.6), (0, -0.2, 4.3)),
    ('Neck1', 'Spine2', tuple(NECK_PTS[0]), tuple(NECK_PTS[1])),
    ('Neck2', 'Neck1', tuple(NECK_PTS[1]), tuple(NECK_PTS[2])),
    ('Neck3', 'Neck2', tuple(NECK_PTS[2]), tuple(NECK_PTS[3])),
    ('Neck4', 'Neck3', tuple(NECK_PTS[3]), tuple(NECK_PTS[4])),
    ('Head', 'Neck4', tuple(NECK_PTS[4]), (0, -11.9, 13.3)),
    ('Jaw', 'Head', (0, -9.6, 13.0), (0, -11.8, 12.75)),
    ('Charm1', 'Neck2', (0, -6.5, 8.0), (0, -6.55, 7.0)),
    ('Charm2', 'Charm1', (0, -6.55, 7.0), (0, -6.6, 6.0)),
] + [(f'Tail{i + 1}', 'Hips' if i == 0 else f'Tail{i}', tuple(TAIL_PTS[i]), tuple(TAIL_PTS[i + 1]))
     for i in range(7)] + _howdah_bones() + _bones_left())


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
HOWDAH_BONES = [n for n in REST if n.startswith(('Howdah', 'Banner', 'Saddle', 'Rider'))]


# ------------------------------------------------------------------ helpers
def _m(p, s):
    p = np.asarray(p, dtype=float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _along_rot(a, b):
    return frame_from(np.asarray(b) - np.asarray(a))


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
def build_body(voxel=0.05, detail=True, seed=11):
    """The whole skin as one distance field (rest pose)."""
    F = Field((-5.6, -12.6, -0.3), (5.6, 18.4, 15.2), voxel)
    noise = Noise(seed)

    # ---------------------------------------------------------------- torso
    F.add(Ellipsoid((0, -2.6, 7.6), (3.0, 2.9, 2.6), bone='Spine2'), 0.7)
    F.add(Ellipsoid((0, 0.2, 7.35), (3.2, 3.1, 2.7), bone='Spine1'), 0.9)
    F.add(Ellipsoid((0, 3.1, 7.45), (2.65, 2.7, 2.35), bone='Hips'), 0.8)
    F.add(Ellipsoid((0, -0.3, 6.05), (2.55, 3.5, 1.8), bone='Belly'), 0.7)          # the hanging belly
    F.add(Ellipsoid((0, -2.9, 9.15), (1.85, 2.15, 1.3), rot_matrix(rx=0.15), bone='Spine2'), 0.8)  # withers
    F.add(Ellipsoid((0, 3.3, 8.95), (1.65, 1.85, 1.05), bone='Hips'), 0.7)           # the sacral hump
    for a, b, bone in (((0, -4.3, 9.7), (0, -1.6, 10.25), 'Spine2'), ((0, -1.6, 10.25), (0, 1.4, 10.0), 'Spine1'),
                       ((0, 1.4, 10.0), (0, 4.6, 9.55), 'Hips')):
        F.add(Capsule(a, b, 0.55, bone=bone), 0.6)                                      # the dorsal ridge

    def torso_side(s):
        F.add(Ellipsoid(_m((2.15, -3.15, 7.5), s), (1.3, 1.75, 2.15), rot_matrix(rx=0.1), bone=_side('Scapula', s)),
              0.55)                                                                       # shoulder mass
        F.add(Ellipsoid(_m((2.05, 3.3, 6.75), s), (1.4, 2.05, 2.35), rot_matrix(rx=-0.15), bone=_side('Thigh', s)),
              0.6)                                                                        # haunch
        F.add(Ellipsoid(_m((2.35, 0.1, 7.1), s), (0.9, 2.6, 1.7), bone='Spine1'), 0.6)  # flank
    for s in (1, -1):
        torso_side(s)

    # ---------------------------------------------------------------- neck
    for i in range(4):
        a, b = NECK_PTS[i], NECK_PTS[i + 1]
        bone = f'Neck{i + 1}'
        F.add(RoundCone(a, b, NECK_R[i], NECK_R[i + 1], bone=bone), 0.9 if i == 0 else 0.45)
        # deeper than wide: a throat keel under each segment
        R = seg_frame(a, b)
        mid = _lerp(a, b, 0.5)
        down = -R[:, 1]
        rr = (NECK_R[i] + NECK_R[i + 1]) / 2
        F.add(Ellipsoid(mid + down * rr * 0.32, (rr * 0.82, rr * 0.92, np.linalg.norm(b - a) * 0.62), R, bone=bone),
              0.4)
        # and a crest of neck muscle along the top
        F.add(Ellipsoid(mid - down * rr * 0.45, (rr * 0.55, rr * 0.55, np.linalg.norm(b - a) * 0.6), R, bone=bone),
              0.35)

    # ---------------------------------------------------------------- head
    # A heavy, wedge-headed war-beast: a domed nasal arch, a brow that overhangs the
    # eye, a rounded tapering snout, jaw muscles bulging behind the mouth.
    F.add(Ellipsoid((0, -9.85, 13.72), (1.22, 1.3, 1.02), bone='Head'), 0.4)                # cranium
    F.add(Ellipsoid((0, -11.15, 13.48), (0.88, 1.1, 0.56), rot_matrix(rx=-0.05), bone='Head'), 0.45)  # snout
    F.add(Ellipsoid((0, -11.85, 13.42), (0.66, 0.42, 0.44), bone='Head'), 0.3)              # the muzzle's front
    F.add(Ellipsoid((0, -10.25, 14.45), (0.68, 1.0, 0.64), rot_matrix(rx=0.35), bone='Head'), 0.4)   # nasal arch
    F.add(Ellipsoid((0, -11.05, 14.0), (0.44, 0.7, 0.32), rot_matrix(rx=0.42), bone='Head'), 0.3)    # nose ridge
    for s in (1, -1):
        F.add(Ellipsoid(_m((0.8, -10.55, 14.2), s), (0.5, 0.7, 0.3), rot_matrix(rx=-0.28, rz=0.22 * s),
                        bone='Head'), 0.2)                                                  # the brow shelf
        F.add(Sphere(_m((0.62, -11.05, 14.12), s), 0.22, bone='Head'), 0.14)                 # brow knot
        F.add(Ellipsoid(_m((0.92, -9.85, 13.3), s), (0.52, 0.88, 0.6), bone='Head'), 0.3)   # jaw muscle
        F.add(Ellipsoid(_m((0.52, -11.75, 13.72), s), (0.26, 0.3, 0.2), bone='Head'), 0.14)  # nostril rims
    # the jaw: a heavy lower mandible hinged under the eye
    F.add(Ellipsoid((0, -10.85, 12.98), (0.8, 1.15, 0.32), rot_matrix(rx=0.04), bone='Jaw'), 0.28)
    F.add(Ellipsoid((0, -9.85, 12.92), (0.98, 0.78, 0.55), bone='Jaw'), 0.32)
    F.add(Ellipsoid((0, -10.5, 12.72), (0.58, 0.9, 0.28), bone='Jaw'), 0.25)                   # chin keel
    F.add(Ellipsoid((0, -11.7, 12.98), (0.6, 0.38, 0.26), bone='Jaw'), 0.2)                    # the lower lip's front
    # mouth line, eye sockets, nostrils
    F.sub(Ellipsoid((0, -11.1, 13.2), (0.9, 1.15, 0.035), rot_matrix(rx=-0.09)), 0.03)
    for s in (1, -1):
        F.sub(Sphere(_m(EYE, s), EYE_R + 0.07), 0.07)
        F.sub(Ellipsoid(_m((0.46, -11.85, 13.74), s), (0.11, 0.14, 0.09)), 0.04)

    # ---------------------------------------------------------------- legs
    def leg(s):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        ua, fa, hand = _side('UpperArm', s), _side('Forearm', s), _side('Hand', s)
        F.add(RoundCone(sh + (0, 0, 0.35), el, 1.8, 1.32, bone=ua), 0.6)
        R = seg_frame(sh, el)
        F.add(Ellipsoid(_lerp(sh, el, 0.4) + np.array((0.18 * s, -0.4, 0)), (1.25, 1.15, 1.55), R, bone=ua), 0.35)
        F.add(Sphere(el + np.array((0, 0.4, 0.05)), 1.05, bone=_side('ElbowFix', s)), 0.35)
        F.add(RoundCone(el, wr, 1.3, 1.15, bone=fa), 0.4)
        F.add(Ellipsoid(_lerp(el, wr, 0.3) + np.array((0, -0.3, 0)), (1.15, 1.0, 1.1), seg_frame(el, wr), bone=fa), 0.3)
        F.add(RoundCone(wr, _m(FPAD, s), 1.15, 1.25, bone=hand), 0.3)
        F.add(Ellipsoid(_m(FPAD, s), (1.42, 1.5, 0.7), bone=hand), 0.35)
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        th, sn, ft = _side('Thigh', s), _side('Shin', s), _side('Foot', s)
        F.add(RoundCone(hp + (0, 0.2, 0.45), kn, 2.1, 1.42, bone=th), 0.7)
        F.add(Ellipsoid(_lerp(hp, kn, 0.35) + np.array((0.2 * s, 0.4, 0)), (1.55, 1.45, 1.9), seg_frame(hp, kn),
                        bone=th), 0.4)
        F.add(Sphere(kn + np.array((0, -0.42, 0.05)), 1.12, bone=_side('KneeFix', s)), 0.35)
        F.add(RoundCone(kn, an, 1.38, 1.18, bone=sn), 0.4)
        F.add(Ellipsoid(_lerp(kn, an, 0.3) + np.array((0, 0.35, 0)), (1.18, 1.05, 1.15), seg_frame(kn, an), bone=sn), 0.3)
        F.add(RoundCone(an, _m(HPAD, s), 1.18, 1.28, bone=ft), 0.3)
        F.add(Ellipsoid(_m(HPAD, s), (1.45, 1.6, 0.7), bone=ft), 0.35)
    for s in (1, -1):
        leg(s)

    # ---------------------------------------------------------------- tail
    for i in range(7):
        F.add(RoundCone(TAIL_PTS[i], TAIL_PTS[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'),
              0.9 if i == 0 else 0.4)
        R = seg_frame(TAIL_PTS[i], TAIL_PTS[i + 1])
        mid = _lerp(TAIL_PTS[i], TAIL_PTS[i + 1], 0.5)
        r = (TAIL_R[i] + TAIL_R[i + 1]) / 2
        F.add(Ellipsoid(mid - R[:, 1] * r * 0.38, (r * 0.62, r * 0.6, np.linalg.norm(TAIL_PTS[i + 1] - TAIL_PTS[i]) * 0.6),
                        R, bone=f'Tail{i + 1}'), 0.3)                                       # the tail's dorsal muscle
    F.add(Ellipsoid((0, 16.6, 3.25), (1.0, 1.35, 0.85), bone='Tail7'), 0.3)                    # the club
    F.add(Ellipsoid((0, 17.6, 3.15), (0.78, 0.75, 0.66), bone='Tail7'), 0.3)

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 3, -1.0), (8, 18, 1.02), radius=0.0), 0.05)

    if detail:
        _skin_detail(F, noise, seed)
    return F


# ------------------------------------------------------------------ detail
def _project(F, origin, toward, inset=0.025):
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 5.0:
        t += F.voxel * 0.6
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return np.asarray(toward, float)


def _scar(F, pts, width=0.06, depth=0.04):
    line = Polyline(pts, 0.01)
    F.ridge(line, depth * 1.4, k=width * 1.6)
    F.groove(line, depth * 0.8, k=width * 0.5)


def _ring(F, center, axis, radius, n=28, depth=0.06, k=0.07, wobble=0.0, rng=None, arc=None):
    """A crease ringing a limb or the neck: points round `axis` at `center`,
    projected onto the skin from inside."""
    ax = np.asarray(axis, float)
    ax /= np.linalg.norm(ax)
    e1 = np.cross(ax, (1.0, 0, 0))
    if np.linalg.norm(e1) < 1e-3:
        e1 = np.cross(ax, (0, 0, 1.0))
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(ax, e1)
    pts = []
    a0, a1 = arc if arc else (0.0, math.tau)
    for i in range(n + 1):
        th = a0 + (a1 - a0) * i / n
        off = ax * (wobble * math.sin(th * 3 + (rng.uniform(0, 6) if rng is not None else 0)))
        p = center + off + (e1 * math.cos(th) + e2 * math.sin(th)) * radius * 1.6
        pts.append(_project(F, center + off, p))
    F.groove(Polyline(pts, 0.008), depth, k=k)


def _skin_detail(F, noise, seed):
    rng = np.random.default_rng(seed)
    # neck folds: the deep transverse creases of a sauropod's neck, on the underside
    for i in range(4):
        a, b = NECK_PTS[i], NECK_PTS[i + 1]
        for t in (0.3, 0.75):
            c = _lerp(a, b, t)
            _ring(F, c, b - a, NECK_R[i], depth=0.05 if i < 2 else 0.04, k=0.08, wobble=0.1, rng=rng,
                  arc=(math.pi * 0.15, math.pi * 1.85))
    # joint creases (elbows, knees, wrists, ankles)
    for s in (1, -1):
        for a, b, r in ((ELBOW, WRIST, 1.25), (KNEE, ANKLE, 1.3)):
            a, b = _m(a, s), _m(b, s)
            for t in (-0.08, 0.04, 0.14):
                _ring(F, _lerp(a, b, t), b - a, r, depth=0.05, k=0.06, wobble=0.08, rng=rng)
        for a, r in ((WRIST, 1.18), (ANKLE, 1.2)):
            a = _m(a, s)
            for dz in (0.0, 0.25, 0.5):
                _ring(F, a + np.array((0, 0, dz)), (0, 0, 1), r, depth=0.045, k=0.05, wobble=0.06, rng=rng)
    # tail rings: banded like an old crocodile's
    for i in range(1, 7):
        a, b = TAIL_PTS[i], TAIL_PTS[i + 1]
        for t in (0.3, 0.75):
            _ring(F, _lerp(a, b, t), b - a, TAIL_R[i], depth=0.045, k=0.06, wobble=0.06, rng=rng)
    # belly plates: transverse grooves across the underside
    for y in np.arange(-3.6, 3.4, 0.62):
        pts = [_project(F, (0, y, 6.6), (x, y + 0.05 * math.sin(x * 2), 2.5)) for x in np.linspace(-2.3, 2.3, 13)]
        F.groove(Polyline(pts, 0.008), 0.055, k=0.06)
    # Leathery hide: low swells and a finer pebbling
    F.displace(lambda X, Y, Z: 0.045 * noise.fbm(X * 0.7, Y * 0.7, Z * 0.7, octaves=3)
               + 0.012 * noise.fbm(X * 4.0 + 11, Y * 4.0, Z * 4.0, octaves=2), band=0.35)

    def folds(X, Y, Z):
        r = noise.ridged(X * 1.4 + 3.1, Y * 1.1, Z * 2.6, octaves=2)
        flank = np.exp(-((np.abs(X) - 2.8) / 0.9) ** 2) * np.exp(-((Z - 6.4) / 1.6) ** 2)
        return -0.022 * r * (0.3 + 1.2 * flank)
    F.displace(folds, band=0.3)
    # Scars: three raking claw marks down the left flank, a spear scar on the right
    # shoulder, a long slash across the neck, and one over the right brow.
    for k in range(3):
        y0 = -0.9 + k * 0.55
        _scar(F, [_project(F, (0, y0, 7.6), (4, y0 - 0.2, 9.0)), _project(F, (0, y0 + 0.6, 7.0), (4, y0 + 0.5, 7.2)),
                  _project(F, (0, y0 + 1.1, 6.4), (4, y0 + 1.1, 5.3))], width=0.08, depth=0.06)
    _scar(F, [_project(F, (-1.5, -3.2, 7.6), (-4, -3.9, 8.1)), _project(F, (-1.5, -3.0, 7.4), (-4, -3.1, 7.5)),
              _project(F, (-1.5, -2.6, 7.2), (-4, -2.4, 6.6))], width=0.07, depth=0.05)
    _scar(F, [_project(F, NECK_PTS[1], NECK_PTS[1] + np.array((3, -0.3, 1.2))),
              _project(F, _lerp(NECK_PTS[1], NECK_PTS[2], 0.5), _lerp(NECK_PTS[1], NECK_PTS[2], 0.5) + np.array((3, 0, 0))),
              _project(F, NECK_PTS[2], NECK_PTS[2] + np.array((2.5, 0.4, -1.5)))], width=0.06, depth=0.045)
    hc = np.array((0, -10.2, 13.6))
    _scar(F, [_project(F, hc, (-0.9, -9.8, 14.6)), _project(F, hc, (-0.95, -10.4, 14.1)),
              _project(F, hc, (-1.0, -11.0, 13.4))], width=0.035, depth=0.03)


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.12)
    return bones[int(np.argmax(W[0]))]
