"""The Spore Toad's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Basin Raptor and Great Jaguar kits this builder is
adapted from): Blender units are yards, +Z up, the toad FACES -Y (the game's +Z
after the glTF export), its left is +X. Bones are (name, parent, head, tail);
`L_` bones are mirrored onto `R_` (x -> -x).

A squat, warty swamp toad as big as a boar and then some, at its in-game size:
it sits about 3.1 yards high at the eyes and 3.7 to the tops of the spore caps
on its back (the KayKit knight is 2.6), 4.4 yards across and 5 long. A broad,
flat head split by a mouth from ear to ear, two great bulging eyes on top, a
throat sac that swells before the tongue, a back crusted with warts and with
the glowing puffballs and fungal caps the basin's spores have grown in its
hide. The front legs prop the chest up; the hind legs fold in a zigzag beside
the body onto long webbed feet.

Bones beside the body:
  * Throat: the throat sac (keyed scale: it swells before the Snaring Tongue).
  * Tongue: the tongue in the mouth (it lolls; the lash itself is the fx).
  * Belly: the hanging gut (a spring).
  * Sac1..Sac3: the three big spore puffballs on the back (keyed scale: they
    pulse, and burst on the death).
  * KneeFix: the hind knee's helper, half its twin's bend.
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, rot_matrix

# The build scales the finished toad (vertices, bones, location keys) by this.
BUILD_SCALE = 1.2

# ------------------------------------------------------------------ landmarks
SHOULDER = np.array((1.0, -1.15, 1.3))
ELBOW = np.array((1.6, -1.3, 0.78))
WRIST = np.array((1.5, -1.82, 0.28))
HAND_T = np.array((1.55, -2.22, 0.1))
HIP = np.array((1.05, 1.1, 1.0))
KNEE = np.array((2.0, 0.25, 0.78))
ANKLE = np.array((1.66, 1.45, 0.4))
FOOT_T = np.array((1.6, 0.6, 0.12))       # the ball of the long foot
TOE_T = np.array((1.75, -0.38, 0.08))
HEAD_C = np.array((0.0, -1.62, 1.97))
EYE = np.array((0.78, -1.72, 2.65))         # the left eye's centre
EYE_R = 0.33
EYE_DIR = np.array((0.55, -0.72, 0.42)) / np.linalg.norm((0.55, -0.72, 0.42))
JAW_HINGE = np.array((0.0, -0.75, 1.67))
MOUTH = dict(y_front=-2.75, y_corner=-0.9, z=1.69, x_max=1.5, z_lo=1.05, z_hi=2.35)
# The three big spore puffballs on its back (centre, radius).
SACS = [(np.array((0.62, 0.05, 2.43)), 0.42), (np.array((-0.55, 0.4, 2.33)), 0.38),
        (np.array((0.05, 0.95, 2.17)), 0.34)]


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _bones_left():
    return [
        ('L_UpperArm', 'Spine', tuple(SHOULDER), tuple(ELBOW)),
        ('L_Forearm', 'L_UpperArm', tuple(ELBOW), tuple(WRIST)),
        ('L_Hand', 'L_Forearm', tuple(WRIST), tuple(HAND_T)),
        ('L_Thigh', 'Hips', tuple(HIP), tuple(KNEE)),
        ('L_Shin', 'L_Thigh', tuple(KNEE), tuple(ANKLE)),
        ('L_KneeFix', 'L_Thigh', tuple(KNEE), tuple(_lerp(KNEE, ANKLE, 0.3))),
        ('L_Foot', 'L_Shin', tuple(ANKLE), tuple(FOOT_T)),
        ('L_Toes', 'L_Foot', tuple(FOOT_T), tuple(TOE_T)),
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
    ('Hips', 'Root', (0, 1.5, 1.2), (0, 0.25, 1.5)),
    ('Spine', 'Hips', (0, 0.25, 1.5), (0, -0.75, 1.77)),
    ('Head', 'Spine', (0, -0.75, 1.77), (0, -2.6, 1.95)),
    ('Jaw', 'Head', tuple(JAW_HINGE), (0, -2.6, 1.51)),
    ('Tongue', 'Jaw', (0, -1.0, 1.63), (0, -2.2, 1.65)),
    ('Throat', 'Spine', (0, -1.0, 1.2), (0, -1.75, 0.9)),
    ('Belly', 'Hips', (0, 0.35, 0.65), (0, 0.35, 0.2)),
    ('Sac1', 'Spine', tuple(SACS[0][0] - (0, 0, 0.3)), tuple(SACS[0][0] + (0, 0, 0.2))),
    ('Sac2', 'Hips', tuple(SACS[1][0] - (0, 0, 0.3)), tuple(SACS[1][0] + (0, 0, 0.2))),
    ('Sac3', 'Hips', tuple(SACS[2][0] - (0, 0, 0.3)), tuple(SACS[2][0] + (0, 0, 0.2))),
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


# ------------------------------------------------------------------ helpers
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


# ------------------------------------------------------------------ body sculpt
WARTS = []   # (centre, radius) of the big warts (surface.py tints them)


def build_body(voxel=0.02, detail=True, seed=31):
    """The whole skin as one distance field (rest pose)."""
    F = Field((-2.6, -2.95, -0.12), (2.6, 2.4, 3.4), voxel)
    noise = Noise(seed)
    rng = np.random.default_rng(seed)

    # ---------------------------------------------------------------- body
    F.add(Ellipsoid((0, 0.55, 1.2), (1.5, 1.35, 1.05), rot_matrix(rx=-0.3), bone='Hips'), 0.4)    # the haunch bulk
    F.add(Ellipsoid((0, -0.45, 1.5), (1.42, 1.1, 0.95), rot_matrix(rx=-0.35), bone='Spine'), 0.4)  # the chest
    F.add(Ellipsoid((0, 0.35, 0.65), (1.2, 1.2, 0.55), bone='Belly'), 0.4)                          # the gut
    F.add(Ellipsoid((0, 1.35, 1.0), (1.05, 0.55, 0.7), bone='Hips'), 0.3)                          # the rump
    for s in (1, -1):
        F.add(Ellipsoid(_m((1.05, 0.2, 1.75), s), (0.55, 1.1, 0.62), rot_matrix(rx=-0.25), bone='Spine'), 0.35)
        # a dorsolateral ridge of glands down each side of the back
        F.add(RoundCone(_m((0.72, -1.2, 2.35), s), _m((0.82, 0.9, 2.0), s), 0.2, 0.14, bone='Spine'), 0.18)

    # ---------------------------------------------------------------- head
    # broad and flat, the mouth ear to ear, the jaw a heavy shovel
    F.add(Ellipsoid(HEAD_C + (0, 0.1, 0.06), (1.42, 1.02, 0.55), bone='Head'), 0.3)
    F.add(Ellipsoid((0, -2.25, 1.87), (1.0, 0.55, 0.38), bone='Head'), 0.22)                    # the snout's lip
    for s in (1, -1):
        # the great parotoid glands behind the eyes
        F.add(Ellipsoid(_m((0.95, -1.05, 2.33), s), (0.42, 0.5, 0.3), rot_matrix(rz=0.3 * s), bone='Head'), 0.16)
        # the eye turrets
        F.add(Sphere(_m(EYE, s) + (0, 0.05, -0.12), EYE_R + 0.12, bone='Head'), 0.18)
        # a heavy brow lid over each eye, slanting down to the snout: a glare
        F.add(Ellipsoid(_m(EYE, s) + np.array((-0.04 * s, 0.06, 0.2)), (0.34, 0.3, 0.11),
                        rot_matrix(rx=0.45, ry=-0.35 * s), bone='Head'), 0.08)
        F.add(Ellipsoid(_m((0.42, -2.55, 2.05), s), (0.12, 0.1, 0.08), bone='Head'), 0.06)       # nostril knob
    F.add(Ellipsoid((0, -1.72, 1.47), (1.36, 0.95, 0.24), bone='Jaw'), 0.2)                       # the jaw
    F.add(Ellipsoid((0, -2.25, 1.51), (0.95, 0.5, 0.2), bone='Jaw'), 0.15)
    # the throat sac
    F.add(Ellipsoid((0, -1.45, 1.07), (1.0, 0.75, 0.42), bone='Throat'), 0.3)
    # the mouth: a long slit from corner to corner, round the front of the head
    F.sub(Ellipsoid((0, -1.95, MOUTH['z']), (1.42, 0.92, 0.03)), 0.025)
    for s in (1, -1):
        F.sub(Sphere(_m(EYE, s) + (0, -0.04, 0.06), EYE_R * 0.92), 0.03)
        F.sub(Ellipsoid(_m((0.42, -2.66, 2.07), s), (0.05, 0.05, 0.04)), 0.02)

    # ---------------------------------------------------------------- front legs
    for s in (1, -1):
        sh, el, wr, ht = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s), _m(HAND_T, s)
        F.add(RoundCone(sh, el, 0.46, 0.34, bone=_side('UpperArm', s)), 0.2)
        F.add(RoundCone(el, wr, 0.34, 0.24, bone=_side('Forearm', s)), 0.12)
        F.add(Ellipsoid(_lerp(el, wr, 0.3) + np.array((0.04 * s, 0.05, 0)), (0.3, 0.28, 0.38), seg_frame(el, wr),
                        bone=_side('Forearm', s)), 0.1)
        F.add(Ellipsoid(wr + np.array((0, -0.12, -0.12)), (0.26, 0.3, 0.14), bone=_side('Hand', s)), 0.08)
        # four splayed fingers with round pads
        for a in (-50, -18, 14, 44):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            p0 = wr + np.array((0, -0.1, -0.16))
            p1 = p0 + d * 0.32 + np.array((0, 0, -0.08))
            p2 = p0 + d * 0.55 + np.array((0, 0, -0.1))
            F.add(Polyline([p0, p1, p2], [0.1, 0.08, 0.075], bone=_side('Hand', s)), 0.05)
            F.add(Sphere(p2 + d * 0.04, 0.1, bone=_side('Hand', s)), 0.04)

    # ---------------------------------------------------------------- hind legs
    for s in (1, -1):
        hp, kn, an, ft, tt = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s), _m(FOOT_T, s), _m(TOE_T, s)
        F.add(RoundCone(hp, kn, 0.62, 0.36, bone=_side('Thigh', s)), 0.3)
        F.add(Ellipsoid(_lerp(hp, kn, 0.4) + np.array((0.1 * s, 0.05, 0.1)), (0.55, 0.5, 0.7), seg_frame(hp, kn),
                        bone=_side('Thigh', s)), 0.2)                                         # the drumstick
        F.add(Sphere(kn, 0.36, bone=_side('KneeFix', s)), 0.12)
        F.add(RoundCone(kn, an, 0.36, 0.22, bone=_side('Shin', s)), 0.14)
        F.add(RoundCone(an, ft, 0.22, 0.2, bone=_side('Foot', s)), 0.1)
        # the long webbed toes
        for a in (-26, -6, 14, 32):
            th = math.radians(a)
            d = np.array((math.sin(th) * s, -math.cos(th), 0.0))
            p0 = ft
            p1 = ft + d * 0.45 + np.array((0, 0, -0.03))
            p2 = ft + d * 0.85 + np.array((0, 0, -0.04))
            F.add(Polyline([p0, p1, p2], [0.13, 0.09, 0.07], bone=_side('Toes', s)), 0.06)
            F.add(Sphere(p2 + d * 0.03, 0.09, bone=_side('Toes', s)), 0.04)
        # the web between the toes
        F.add(Ellipsoid(ft + np.array((0.06 * s, -0.45, -0.03)), (0.42, 0.42, 0.05), bone=_side('Toes', s)), 0.08)

    # ---------------------------------------------------------------- warts
    WARTS.clear()
    for _ in range(70):
        u, v = rng.uniform(-1, 1), rng.uniform(-0.9, 1.0)
        c = np.array((1.35 * u, 0.15 + 1.2 * v, 1.25 + 1.2 * math.sqrt(max(0.0, 1 - u * u * 0.8))))
        r = rng.uniform(0.07, 0.17)
        WARTS.append((c, r))
    for c, r in WARTS:
        # pushed down onto the surface
        d = c - np.array((0, 0.2, 1.05))
        d /= np.linalg.norm(d)
        p = c
        for _ in range(30):
            if F.sample(p[None])[0] < 0:
                break
            p = p - d * 0.05
        F.add(Sphere(p, r), 0.05, weight=False)

    # flat soles: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (5, 6, 1.0), radius=0.0), 0.02)

    if detail:
        F.displace(lambda X, Y, Z: 0.016 * noise.fbm(X * 1.6, Y * 1.6, Z * 1.6, octaves=3)
                   + 0.012 * noise.ridged(X * 7 + 3, Y * 7, Z * 7, octaves=2)
                   - 0.006 * noise(X * 22, Y * 22, Z * 22), band=0.14)
    return F


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
