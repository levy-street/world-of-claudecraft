"""The Sunbone totems' skeleton and sculpted bodies (rest pose), in yards.

The Totem-Binder plants two kinds in turn (sim/content/wildheart.ts):

  sun    The Sunbone Totem: a carved post of dark ironwood on a root-bound
         basalt plinth, three jaguar faces stacked up it, crowned by a SUN of
         bone: a disc of carved bone ringed with bone rays, a jaguar skull at its
         heart whose eyes burn green-gold (its mending pulse), red plumes behind,
         bone charms hanging from a crossbar.
  dread  The Sunbone Dread Totem: the same post crowned by a great tusked troll
         skull painted red, its jaw on its own bone (it chatters for the
         Rattling Dread), red light in its sockets, curling horns and strings of
         bone rattles hanging from the crossbar.

The variant is chosen by the environment (TOTEM_VARIANT=sun|dread) so every
module sees the same one. Conventions: yards, +Z up, faces -Y, its left is +X.

Bones: Root, Post (the shaft, it shudders and leans), Crown (the sun or the
skull), Jaw (the carved maw of the crown), and two hanging charm chains
(L_Charm1/2, R_Charm1/2, springs).
"""
import math
import os

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, Torus, rot_matrix

VARIANT = os.environ.get('TOTEM_VARIANT', 'sun')
DREAD = VARIANT == 'dread'

POST_TOP = 4.55
CROWN_C = np.array((0.0, -0.05, 5.25))      # the crown's centre (the sun's skull, the dread skull)
BAR_Z = 4.25                                # the crossbar the charms hang from
FACES = (1.05, 2.15, 3.2)                   # the carved jaguar faces' brow heights
EYE_SKULL = np.array((0.16, -0.5, 5.33)) if not DREAD else np.array((0.2, -0.55, 5.36))


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(float(x) for x in head), tuple(float(x) for x in tail)))
        if name.startswith('L_'):
            m = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            twin_parent = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], twin_parent, m(head), m(tail)))
    return out


JAW_HINGE = np.array((0.0, -0.18, 5.08)) if not DREAD else np.array((0.0, -0.12, 5.02))
BONES = _expand([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Post', 'Root', (0, 0, 0.5), (0, 0, POST_TOP)),
    ('Crown', 'Post', (0, 0, POST_TOP), (0, 0, POST_TOP + 1.2)),
    ('Jaw', 'Crown', tuple(JAW_HINGE), tuple(JAW_HINGE + np.array((0, -0.55, -0.12)))),
    ('L_Charm1', 'Post', (0.78, -0.05, BAR_Z - 0.05), (0.78, -0.05, BAR_Z - 0.75)),
    ('L_Charm2', 'L_Charm1', (0.78, -0.05, BAR_Z - 0.75), (0.78, -0.05, BAR_Z - 1.45)),
])
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
PARENT = {n: p for n, p, _, _ in BONES}
HEAD_C = CROWN_C
MOUTH = dict(y_front=-1.0, y_corner=0.0, z=float(JAW_HINGE[2]) - 0.02, x_max=0.5, z_lo=4.6, z_hi=5.6)

GLOWS = []      # (centre, radius) of the burning spots (surface.py lights them)


def build_body(voxel=0.016, detail=True, seed=41):
    F = Field((-1.45, -1.2, -0.12), (1.45, 1.0, 6.75), voxel)
    noise = Noise(seed)
    GLOWS.clear()
    # ---------------------------------------------------------------- the plinth: basalt, roots
    F.add(RoundBox((0, 0, 0.22), (0.78, 0.72, 0.24), rot=rot_matrix(rz=0.3), radius=0.14, bone='Root'), 0.1)
    F.add(RoundBox((0, 0, 0.5), (0.58, 0.55, 0.12), rot=rot_matrix(rz=-0.2), radius=0.08, bone='Root'), 0.08)
    rng = np.random.default_rng(seed)
    for k in range(6):
        a = math.tau * k / 6 + rng.uniform(-0.3, 0.3)
        d = np.array((math.cos(a), math.sin(a), 0.0))
        p0 = d * 0.35 + np.array((0, 0, 0.7))
        p1 = d * 0.8 + np.array((0, 0, 0.35))
        p2 = d * 1.25 + np.array((0, 0, 0.02))
        F.add(Polyline([p0, p1, p2], [0.14, 0.1, 0.05], bone='Root'), 0.05)
    # ---------------------------------------------------------------- the post
    F.add(RoundCone((0, 0, 0.45), (0, 0, POST_TOP), 0.5, 0.42, bone='Post'), 0.06)
    # the three carved jaguar faces stacked up the front
    for z in FACES:
        F.add(Ellipsoid((0, -0.36, z), (0.48, 0.2, 0.14), bone='Post'), 0.05)                 # the brow ridge
        F.add(Ellipsoid((0, -0.5, z - 0.32), (0.2, 0.2, 0.16), bone='Post'), 0.06)             # the snout
        F.add(Ellipsoid((0, -0.42, z - 0.55), (0.34, 0.16, 0.08), bone='Post'), 0.05)          # the lower jaw
        for s in (1, -1):
            F.add(Ellipsoid(_m((0.34, -0.3, z - 0.2), s), (0.16, 0.14, 0.2), bone='Post'), 0.05)   # cheeks
            F.add(Ellipsoid(_m((0.28, -0.12, z + 0.2), s), (0.12, 0.08, 0.14), bone='Post'), 0.04)  # ears
            e = _m((0.18, -0.42, z - 0.08), s)
            F.sub(Ellipsoid(e, (0.08, 0.06, 0.05), rot_matrix(ry=0.4 * s)), 0.02)                # eye slits
            GLOWS.append((e + np.array((0, 0.02, 0)), 0.07))
        F.sub(RoundBox((0, -0.55, z - 0.45), (0.22, 0.12, 0.035), radius=0.0), 0.015)            # the mouth slit
    # bands of carved rings between the faces
    for z in (0.62, 1.62, 2.7, 3.72, 4.42):
        F.add(Torus((0, 0, z), (0, 0, 1), 0.45, 0.06, bone='Post'), 0.04)
    # the crossbar the charms hang from
    F.add(RoundCone((-0.92, 0.0, BAR_Z), (0.92, 0.0, BAR_Z), 0.11, 0.11, bone='Post'), 0.06)
    for s in (1, -1):
        F.add(Sphere(_m((0.95, 0.0, BAR_Z), s), 0.14, bone='Post'), 0.04)
    # ---------------------------------------------------------------- the crown
    # the neck: the post carved on up into the crown's socket
    F.add(RoundCone((0, 0, POST_TOP - 0.15), (0, 0.06, POST_TOP + 0.5), 0.4, 0.3, bone='Crown'), 0.08)
    if not DREAD:
        # the bone sun: a disc behind a jaguar skull, ringed with bone rays
        F.add(Ellipsoid(CROWN_C + np.array((0, 0.18, 0.0)), (0.86, 0.14, 0.86), bone='Crown'), 0.04)
        F.add(Torus(CROWN_C + np.array((0, 0.1, 0)), (0, 1, 0), 0.82, 0.09, bone='Crown'), 0.03)
        for k in range(14):
            a = math.tau * k / 14
            d = np.array((math.cos(a), 0.0, math.sin(a)))
            if d[2] < -0.75:
                continue
            ln = 0.5 if k % 2 == 0 else 0.32
            F.add(RoundCone(CROWN_C + d * 0.86 + np.array((0, 0.1, 0)), CROWN_C + d * (0.86 + ln) + np.array((0, 0.12, 0)),
                            0.1, 0.02, bone='Crown'), 0.03)
        # the jaguar skull at its heart: a broad cranium, a short muzzle, fangs
        F.add(Ellipsoid(CROWN_C + np.array((0, -0.18, 0.1)), (0.36, 0.34, 0.3), bone='Crown'), 0.08)
        F.add(Ellipsoid(CROWN_C + np.array((0, -0.48, -0.04)), (0.2, 0.2, 0.15), bone='Crown'), 0.06)
        for s in (1, -1):
            F.add(Ellipsoid(CROWN_C + _m((0.26, -0.26, -0.08), s), (0.14, 0.2, 0.12), bone='Crown'), 0.05)
        F.add(Ellipsoid(JAW_HINGE + np.array((0, -0.28, -0.07)), (0.24, 0.3, 0.07), bone='Jaw'), 0.04)
        for s in (1, -1):
            e = _m(EYE_SKULL, s)
            F.sub(Sphere(e, 0.09), 0.02)
            GLOWS.append((e + np.array((0, 0.03, 0)), 0.09))
        F.sub(Ellipsoid(CROWN_C + np.array((0, -0.62, 0.0)), (0.07, 0.06, 0.05)), 0.02)       # the nose hole
    else:
        # the tusked troll skull, big and long-jawed, horns curling back
        F.add(Ellipsoid(CROWN_C + np.array((0, -0.12, 0.18)), (0.48, 0.48, 0.42), bone='Crown'), 0.08)
        F.add(Ellipsoid(CROWN_C + np.array((0, -0.5, 0.02)), (0.3, 0.32, 0.22), bone='Crown'), 0.08)   # the snout
        for s in (1, -1):
            F.add(Ellipsoid(CROWN_C + _m((0.3, -0.36, 0.22), s), (0.22, 0.18, 0.1), rot_matrix(ry=-0.5 * s),
                            bone='Crown'), 0.04)                                                     # the brow
            F.add(Ellipsoid(CROWN_C + _m((0.36, -0.2, -0.05), s), (0.18, 0.22, 0.16), bone='Crown'), 0.05)
            hp = [CROWN_C + _m(p, s) for p in ((0.32, 0.0, 0.45), (0.7, 0.2, 0.75), (0.95, 0.5, 0.6),
                                                  (0.98, 0.65, 0.3), (0.85, 0.55, 0.12))]
            F.add(Polyline(hp, [0.16, 0.13, 0.1, 0.07, 0.03], bone='Crown'), 0.05)                     # horns
        F.add(Ellipsoid(JAW_HINGE + np.array((0, -0.38, -0.08)), (0.3, 0.4, 0.1), bone='Jaw'), 0.05)
        for s in (1, -1):
            e = _m(EYE_SKULL, s)
            F.sub(Sphere(e, 0.12), 0.02)
            GLOWS.append((e + np.array((0, 0.04, 0)), 0.12))
        F.sub(Ellipsoid(CROWN_C + np.array((0, -0.78, 0.0)), (0.1, 0.06, 0.07)), 0.02)
    # the mouth slit of the crown's skull
    F.sub(RoundBox(JAW_HINGE + np.array((0, -0.4, 0.0)), (0.32, 0.38, 0.02), radius=0.0), 0.015)
    # flat underside: nothing below the floor
    F.sub(RoundBox((0, 0, -1.0), (4, 4, 1.0), radius=0.0), 0.02)
    if detail:
        # wood grain up the post, pitting on the stone and the bone
        F.displace(lambda X, Y, Z: 0.008 * noise.fbm(X * 2.2, Y * 2.2, Z * 2.2, octaves=3)
                   - 0.007 * noise.ridged(X * 18 + 3, Y * 18, Z * 2.5, octaves=2), band=0.1)
    return F


def bone_of_point(F, p):
    from sdf import skin_weights
    bones, W = skin_weights(F.prims, np.asarray([p], dtype=float), tau=0.04)
    return bones[int(np.argmax(W[0]))]
