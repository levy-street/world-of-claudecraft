"""Shared humanoid skeleton helpers for the Sanctum trash kit.

A creature's anatomy module fills a `Landmarks` (left side; the right is mirrored)
and calls `humanoid_bones` for the standard chain (Root, Hips, the spine, neck, head,
jaw, clavicles, arms with the ElbowFix helper, hands, fingers, legs with the KneeFix
helper, feet, toes) plus its own extra bones. Axes: yards, +Z up, faces -Y, left +X.
"""
import math

import numpy as np


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def lerp(a, b, t):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


class Hand:
    """Rest hand geometry (left side): wrist, hand tip, palm length, finger table
    {name: (spread, fan, back, length, radius)} and the thumb."""

    def __init__(self, wrist, tip, palm_len, fingers, thumb, forward=(0.0, -1.0, 0.0)):
        self.wrist, self.tip, self.palm_len = np.asarray(wrist, float), np.asarray(tip, float), palm_len
        self.fingers, self.thumb, self.forward = fingers, thumb, np.asarray(forward, float)

    def frame(self, side=1):
        w = self.wrist if side > 0 else mirror(self.wrist)
        tip = self.tip if side > 0 else mirror(self.tip)
        down = unit(tip - w)
        width = self.forward - down * (self.forward @ down)
        width = unit(width)
        palm = unit(np.cross(down, width) * side)
        return w, down, width, palm

    def chain(self, side, name):
        w, down, width, palm = self.frame(side)
        if name == 'Thumb':
            at, d0, l1, l2 = self.thumb
            base = w + down * at[0] + width * at[1] + palm * at[2]
            d = unit(down * d0[0] + width * d0[1] + palm * d0[2])
            mid = base + d * l1
            d2 = unit(d + down * 0.35 + palm * 0.15)
            tip = mid + d2 * l2
            return base, mid, tip
        spread, fan, back, length, _r = self.fingers[name]
        base = w + down * (self.palm_len + back) + width * spread + palm * 0.02
        d = unit(down + width * fan + palm * 0.14)
        mid = base + d * length
        d2 = unit(d + palm * 0.28)
        tip = mid + d2 * length * 0.86
        return base, mid, tip


def foot_dir_fn(rest_foot_vec):
    rest_fd = np.asarray(rest_foot_vec, float)

    def foot_dir(pitch, s, yaw=0.0, base=None):
        fd = np.asarray(base if base is not None else rest_fd, float).copy()
        fd = np.array((fd[0] * s if base is None else fd[0], fd[1], fd[2]))
        c, sn = math.cos(math.radians(-pitch)), math.sin(math.radians(-pitch))
        fd = np.array((fd[0], fd[1] * c - fd[2] * sn, fd[1] * sn + fd[2] * c))
        if yaw:
            cy, sy = math.cos(math.radians(yaw * s)), math.sin(math.radians(yaw * s))
            fd = np.array((fd[0] * cy - fd[1] * sy, fd[0] * sy + fd[1] * cy, fd[2]))
        return tuple(fd)
    return foot_dir


def expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(float(x) for x in head), tuple(float(x) for x in tail)))
        if name.startswith('L_'):
            m = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            twin_parent = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], twin_parent, tuple(float(x) for x in m(head)),
                        tuple(float(x) for x in m(tail))))
    return out


def topo(bones):
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


def arm_leg_bones(L, hand, finger_names):
    """Left arm and leg chains from landmarks L (dict of np arrays)."""
    out = [
        ('L_Clavicle', L['clav_parent'], L['clav_head'], L['SHOULDER']),
        ('L_UpperArm', 'L_Clavicle', L['SHOULDER'], L['ELBOW']),
        ('L_Forearm', 'L_UpperArm', L['ELBOW'], L['WRIST']),
        ('L_ElbowFix', 'L_UpperArm', L['ELBOW'], lerp(L['ELBOW'], L['WRIST'], 0.3)),
        ('L_Hand', 'L_Forearm', L['WRIST'], L['HAND_TIP']),
        ('L_Thigh', 'Hips', L['HIP'], L['KNEE']),
        ('L_Shin', 'L_Thigh', L['KNEE'], L['ANKLE']),
        ('L_KneeFix', 'L_Thigh', L['KNEE'], lerp(L['KNEE'], L['ANKLE'], 0.3)),
        ('L_Foot', 'L_Shin', L['ANKLE'], L['BALL']),
        ('L_Toes', 'L_Foot', L['BALL'], L['TOE']),
    ]
    for f in finger_names:
        base, mid, tip = hand.chain(1, f)
        out.append((f'L_{f}1', 'L_Hand', base, mid))
        out.append((f'L_{f}2', f'L_{f}1', mid, tip))
    return out
