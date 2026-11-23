"""The Sunbone totems' dressing: the crown skull's fangs (and the dread skull's
tusks), the red plumes fanned behind the sun, the feathers tied under the
crossbar, the bone charms (sun) or bone rattles (dread) hanging from it on two
spring chains, and the burning gem in the sun skull's brow.

Each item returns (high, low) objects; rigid parts ride one bone, the charms
are split along their chain.
"""
import math

import numpy as np

import anatomy as A
from mesh_kit import Part, duplicate


def pair(part_obj, group='body'):
    part_obj['group'] = group
    hi = duplicate(part_obj, part_obj.name + '_hi')
    hi['group'] = group
    return hi, part_obj


def horn(part, base, ctrl, tip, r0, n=8, sides=7, r_tip=0.006):
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


def quill(part, base, direction, length, width, bend=(0, 0, 0), sides=6, n=7, flat=0.45):
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    b = np.asarray(base, float)
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        pts.append(b + d * length * t + np.asarray(bend) * length * t * t)
        rr.append(width * (0.55 + 1.4 * t) * (1 - t) ** 1.1 + 0.004)
    part.tube(pts, rr, sides=sides, squash=flat)


def build_fangs():
    out = []
    C, J = A.CROWN_C, A.JAW_HINGE
    up = Part('CrownFangs', 'tooth', bone='Crown')
    low = Part('JawFangs', 'tooth', bone='Jaw')
    if not A.DREAD:
        for s in (1, -1):
            b = C + np.array((0.12 * s, -0.6, -0.1))
            horn(up, b, b + np.array((0, -0.03, -0.12)), b + np.array((0, 0.02, -0.26)), 0.045, sides=6)
            b = J + np.array((0.1 * s, -0.5, -0.05))
            horn(low, b, b + np.array((0, -0.02, 0.06)), b + np.array((0, 0.0, 0.14)), 0.035, sides=6)
    else:
        for s in (1, -1):
            # the great tusks curling up out of the lower jaw
            b = J + np.array((0.22 * s, -0.62, -0.06))
            horn(low, b, b + np.array((0.12 * s, -0.3, 0.2)), b + np.array((0.24 * s, -0.25, 0.62)), 0.09,
                 n=9, sides=8)
            for k in range(3):
                b = C + np.array(((0.08 + 0.08 * k) * s, -0.74 + 0.08 * k, -0.14))
                horn(up, b, b + np.array((0, -0.02, -0.08)), b + np.array((0, 0.01, -0.18)), 0.035, n=5, sides=6)
    out.append(pair(up.to_object()))
    out.append(pair(low.to_object()))
    return out


def build_plumes():
    """Red plumes: fanned behind the sun (or bristling from the dread skull's crown)."""
    p = Part('Plumes', 'quill', bone='Crown')
    C = A.CROWN_C
    n = 9 if not A.DREAD else 7
    for i in range(n):
        u = i / (n - 1) - 0.5
        a = math.pi * (0.5 + u * (1.4 if not A.DREAD else 0.9))
        d = np.array((math.cos(a), 0.45, math.sin(a)))
        base = C + np.array((0, 0.32, 0.1)) + d * np.array((0.3, 0.0, 0.3))
        quill(p, base, d, (1.15 if not A.DREAD else 0.9) - 0.35 * abs(u), 0.1, bend=(0, 0.25, -0.15), sides=6)
    return [pair(p.to_object())]


def build_feathers():
    """Feathers tied in a bunch under each end of the crossbar."""
    p = Part('Feathers', 'quill', bone='Post')
    for s in (1, -1):
        for k in range(3):
            base = np.array((0.66 * s, -0.1, A.BAR_Z - 0.08))
            d = np.array((0.15 * s + 0.12 * (k - 1), -0.15, -1.0))
            quill(p, base, d, 0.7, 0.07, bend=(0.1 * s, -0.05, 0.05), sides=5)
    return [pair(p.to_object())]


def build_charms():
    """Two hanging chains: cords with carved bones and a small skull (sun), or
    strings of bone rattles and finger bones (dread)."""
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        top = A._m(A.REST['L_Charm1'][0], s)
        bot = A._m(A.REST['L_Charm2'][1], s)
        rope = Part(f'{side}CharmCord', 'rope', bone=side + 'Charm1', binding='charm')
        bones_ = Part(f'{side}CharmBones', 'bone', bone=side + 'Charm1', binding='charm')
        rope.tube([top, A._lerp(top, bot, 0.5) + np.array((0, -0.02, 0)), bot], 0.018, sides=5)
        if not A.DREAD:
            for t in (0.3, 0.62):
                c = A._lerp(top, bot, t)
                bones_.tube([c + np.array((-0.1, 0, 0.02)), c + np.array((0.1, 0, -0.02))], [0.035, 0.025, 0.035],
                            sides=6)
            sk = bot + np.array((0, 0, -0.06))
            bones_.sphere(sk, (0.1, 0.11, 0.1), seg=12, rings=8)
            bones_.sphere(sk + np.array((0, -0.06, -0.06)), (0.07, 0.07, 0.05), seg=10, rings=6)
        else:
            for k in range(6):
                c = A._lerp(top, bot, 0.15 + 0.15 * k)
                bones_.sphere(c, (0.07, 0.07, 0.06), seg=8, rings=5)            # the rattle gourds of bone
                for j in (-1, 1):
                    b = c + np.array((0.05 * j, 0, 0))
                    horn(bones_, b, b + np.array((0.04 * j, 0, -0.05)), b + np.array((0.05 * j, 0, -0.14)), 0.02,
                         n=4, sides=5)
        out.append(pair(rope.to_object()))
        out.append(pair(bones_.to_object()))
    return out


def build_gem():
    if A.DREAD:
        return []
    p = Part('SunGem', 'glow', bone='Crown')
    p.sphere(A.CROWN_C + np.array((0, -0.43, 0.32)), (0.08, 0.05, 0.08), seg=10, rings=6)
    return [pair(p.to_object())]
