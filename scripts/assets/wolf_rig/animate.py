"""Build every wolf clip on a new rig: transfer, plant the paws, then the layers.

  build_all(new_arm, old_arm, body, ground_z, old_action)

`old_action(name)` returns the old rig's action for a clip name (the glTF
animation names, as Blender imported them). Clips are written as actions named
exactly as the game expects them.
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import clips as C
import layers
import motion

FPS = motion.FPS
SMOOTH_FRAMES = 2.0     # the tail carriage is eased over this many frames (sigma)


def flinch(arm, poses, side):
    """A hit react on the idle stance: shoved away from the blow, the head snapping
    aside and down, then a small rebound and settle."""
    recoil = []
    for k, P in enumerate(poses):
        t = k / FPS
        r = layers.curve([(0.0, 0.0), (0.07, 1.0), (0.17, 0.82), (0.36, -0.22), (0.52, 0.06), (0.7, 0.0)], t)
        recoil.append(r)
        push = max(r, 0.0)
        motion.shift_subtree(arm, P, 'Pelvis', Vector((-side * 0.07 * r, 0.025 * r, -0.045 * push)))
        motion.turn_subtree(arm, P, 'Pelvis', Quaternion((0, 1, 0), math.radians(-side * 7.0 * r)))
        motion.turn_subtree(arm, P, 'Chest', Quaternion((0, 0, 1), math.radians(-side * 11.0 * r)) @
                            Quaternion((0, 1, 0), math.radians(-side * 6.0 * r)))
        motion.turn_subtree(arm, P, 'Neck1', Quaternion((0, 0, 1), math.radians(-side * 13.0 * r)) @
                            Quaternion((1, 0, 0), math.radians(7.0 * r)))
        motion.turn_subtree(arm, P, 'Head', Quaternion((0, 0, 1), math.radians(-side * 20.0 * r)) @
                            Quaternion((1, 0, 0), math.radians(12.0 * r)))
    return np.array(recoil)


STOOD_WITHIN = 0.08  # a paw whose lowest point in a clip comes this near the idle
                     # ground stood on that lowest point (the old Sit and Howl kept
                     # their hind paws a few centimetres up the whole clip)


def clip_baselines(old_arm, frames, idle_base, gait):
    """Where each old paw stood in this clip: in a gait, and for any paw that comes
    near the ground at all, its own lowest point in the clip; a paw that never comes
    near it (the Fall) keeps the idle ground and stays in the air. Never below the
    idle ground: the old Death sank a hind paw 13 cm through the floor as it fell,
    and taking that as the ground read the paw standing at the start as lifted."""
    out = {}
    for leg, (*_, old_pad) in motion.LEGS.items():
        low = max(min(F[old_pad].to_translation().z for F in frames), idle_base[leg])
        out[leg] = low if gait or low - idle_base[leg] < STOOD_WITHIN else idle_base[leg]
    return out


def build_clip(recipe, new_arm, old_arm, skin, tail, ground_z, idle_frames, idle_raw, idle_base, old_action,
               name_prefix='', tuck_min=0.0):
    r = recipe
    if r.source:
        T, frames, _closed = motion.reference(old_arm, old_action(r.source), r.loop)
        if not r.loop:
            frames = motion.clear_ground(old_arm, frames, idle_base)
    else:
        n = int(round(r.length * FPS)) + 1
        frames = [idle_frames[0]] * n
        T = r.length
    poses = motion.transfer(new_arm, old_arm, frames)
    recoil = flinch(new_arm, poses, r.hit_side) if r.hit_side else None
    motion.plant_legs(new_arm, old_arm, poses, frames, clip_baselines(old_arm, frames, idle_base, r.gait),
                      skin, ground_z, loop=r.loop, gait=r.gait, tuck_min=tuck_min)
    n = len(poses)
    ts = np.arange(n) / FPS

    # the tail: the old clip's carriage, scaled down, clamped, eased
    pitch, yaw = layers.intent(old_arm, frames, idle_raw)
    tail_pitch = np.where(pitch > 0, pitch * r.tail_up, pitch * r.tail_down)
    tail_yaw = np.clip(yaw * r.tail_yaw, -r.tail_yaw_max, r.tail_yaw_max)
    if recoil is not None:
        tail_pitch = tail_pitch - 16.0 * np.maximum(recoil, 0.0)
        tail_yaw = tail_yaw - r.hit_side * 8.0 * recoil
    tail_pitch = np.clip(tail_pitch, r.tail_lo, r.tail_hi)
    amp, cycles = r.tail_sway
    tail_yaw = tail_yaw + amp * np.sin(2 * math.pi * cycles * ts / max(T, 1e-6))
    limp = np.array([layers.curve(r.limp, t) for t in ts])
    tail_pitch = motion._smooth_series(tail_pitch, SMOOTH_FRAMES, r.loop)
    tail_yaw = motion._smooth_series(tail_yaw, SMOOTH_FRAMES, r.loop)

    # the ears
    if recoil is not None:
        fold = [34.0 * max(v, 0.0) for v in recoil]
        layers.apply_ears(new_arm, poses, fold, [0.0] * n, r.loop)
    else:
        sw = [layers.curve(r.swivel, t) for t in ts]
        layers.apply_ears(new_arm, poses, [layers.curve(r.ears_L, t) for t in ts], sw, r.loop, sides=('L',))
        layers.apply_ears(new_arm, poses, [layers.curve(r.ears_right, t) for t in ts], sw, r.loop, sides=('R',))

    layers.apply_tail(new_arm, poses, tail_pitch, tail_yaw, r.loop, ground_z, tail,
                      follow_scale=(1.0 - 0.5 * limp) if limp.any() else None,
                      limp=limp if limp.any() else None)
    act = motion.key_action(new_arm, name_prefix + r.name, poses)
    return act, T


def build_all(new_arm, old_arm, body, ground_z, old_action, only=None, name_prefix='', tuck_min=0.0):
    skin = motion.paw_skin(new_arm, body, ground_z)
    skin['torso'] = motion.torso_skin(new_arm, body)
    tail = layers.tail_skin(new_arm, body)
    _T, idle_frames, _ = motion.reference(old_arm, old_action('Idle'), loop=True)
    idle_raw = layers.raw_intent(old_arm, idle_frames)
    idle_base = motion.leg_baselines(old_arm, idle_frames)
    out = {}
    for r in C.RECIPES:
        if only and r.name not in only:
            continue
        out[r.name] = build_clip(r, new_arm, old_arm, skin, tail, ground_z, idle_frames, idle_raw, idle_base,
                                 old_action, name_prefix, tuck_min)
    return out
