"""Arm jitter of a clip, the Blender twin of arm_jitter.mjs (same bones, same measure).

Every arm bone's armature-space rotation is sampled once per frame (24 fps) and
differenced twice: the velocity w_i (rotation vector of q_(i+1) q_i^-1, degrees per
frame) and the acceleration a_i = w_(i+1) - w_i (degrees per frame^2). `max_accel` is
the largest |a_i| (a blow landing is a big one, by design). `tremor` is a frame whose
acceleration flips direction against BOTH neighbours, scored by the smallest of the
three: one impact is one flip and scores near nothing, a limb flipping between two
poses on alternate frames scores its whole swing. A clip fails past TREMOR_LIMIT.
"""
import math

import numpy as np

BONES = tuple(s + b for s in ('L_', 'R_') for b in ('Clavicle', 'UpperArm', 'Forearm', 'Hand'))
TREMOR_LIMIT = 2.5


def _rotvec(q):
    """Rotation vector (degrees) of a mathutils Quaternion, shortest way round."""
    if q.w < 0:
        q = -q
    axis, ang = q.to_axis_angle()
    return np.array(axis) * math.degrees(ang)


def rotation_jitter(qs):
    """(max_accel, accel_frame, tremor, tremor_frame) of a list of Quaternions."""
    w = [_rotvec(b @ a.inverted()) for a, b in zip(qs, qs[1:])]
    acc = [w[i + 1] - w[i] for i in range(len(w) - 1)]
    max_accel, accel_frame = 0.0, 0
    for i, v in enumerate(acc):
        n = float(np.linalg.norm(v))
        if n > max_accel:
            max_accel, accel_frame = n, i + 1
    tremor, tremor_frame = 0.0, 0
    for i in range(1, len(acc) - 1):
        if acc[i - 1] @ acc[i] < 0 and acc[i] @ acc[i + 1] < 0:
            s = float(min(np.linalg.norm(acc[i - 1]), np.linalg.norm(acc[i]), np.linalg.norm(acc[i + 1])))
            if s > tremor:
                tremor, tremor_frame = s, i + 1
    return max_accel, accel_frame, tremor, tremor_frame


def zigzag_frames(qs, limit):
    """Frame indices (into qs) sitting in a zig-zag scored above `limit`: the three
    frames whose accelerations alternate."""
    w = [_rotvec(b @ a.inverted()) for a, b in zip(qs, qs[1:])]
    acc = [w[i + 1] - w[i] for i in range(len(w) - 1)]
    out = set()
    for i in range(1, len(acc) - 1):
        if acc[i - 1] @ acc[i] < 0 and acc[i] @ acc[i + 1] < 0:
            s = min(np.linalg.norm(acc[i - 1]), np.linalg.norm(acc[i]), np.linalg.norm(acc[i + 1]))
            if s > limit:
                out.update((i, i + 1, i + 2))
    return sorted(out)


def clip_jitter(scene, arm, act, fps=24):
    """{'tremor', 'bone', 't', 'max_accel'} for one action on the armature."""
    import rig as R
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    series = {b: [] for b in BONES}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        for b in BONES:
            series[b].append(arm.pose.bones[b].matrix.to_quaternion())
    worst = {'tremor': 0.0, 'bone': '', 't': 0.0, 'max_accel': 0.0}
    for b, qs in series.items():
        ma, _, tr, tf = rotation_jitter(qs)
        worst['max_accel'] = max(worst['max_accel'], ma)
        if tr > worst['tremor']:
            worst.update(tremor=tr, bone=b, t=tf / fps)
    return worst
