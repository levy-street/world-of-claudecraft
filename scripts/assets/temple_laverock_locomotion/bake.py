"""Bake two locomotion actions on Laverock's original, warped IK skeleton.

Run through export.mjs. The source body, textures and non-locomotion clips stay
in temple_laverock.glb; this export contains an armature and two actions only.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import warp as WP

prims = WP.clip_body_prims()
WP.commit()
WP.patch_clips(prims)
import anatomy as A
import clips as C
import clip_library as L
import rig as R


def close_loop(arm, action, frames):
    """Remove the IK bend-memory and cloth-spring drift over the whole cycle.

    Smoothstep has zero endpoint slope, so it corrects a drift without adding
    a hard last-frame snap. Feet already close and receive no measurable turn.
    """
    R.set_action(arm, action)
    poses = []
    for frame in range(frames + 1):
        bpy.context.scene.frame_set(frame + 1)
        poses.append({pb.name: pb.rotation_quaternion.copy() for pb in arm.pose.bones})
    for pb in arm.pose.bones:
        correction = poses[-1][pb.name].inverted() @ poses[0][pb.name]
        if correction.w < 0:
            correction.negate()
        previous = None
        for frame, pose in enumerate(poses):
            q = pose[pb.name] @ Quaternion().slerp(correction, L.smooth(frame / frames))
            if previous is not None and previous.dot(q) < 0:
                q.negate()
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=frame + 1)
            previous = q
    for curve in R.fcurves(action):
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'


def body(rig, phase, running):
    half = 0.90
    stance = 0.4 if running else 0.6
    lift = 0.34 if running else 0.20
    left, ld, lt = L.gait_foot(phase, stance, -half, half, lift, 1)
    right, rd, rt = L.gait_foot((phase + 0.5) % 1.0, stance, -half, half, lift, -1)
    swing = math.cos(math.tau * phase)
    sway = math.cos(math.tau * (phase - 0.3))
    base = L.stance(rig).but(
        pelvis=(0.02 * sway, 0.0, (-0.3 if running else -0.27) - 0.015 * math.cos(2 * math.tau * phase)),
        hip_twist=-6 * swing, hip_roll=-2 * sway, hip_tilt=0,
        lean=L.STOOP + (7 if running else 3), twist=4 * swing,
        side=-sway, look=(-2 * swing, 0), neck=L.STOOP_NECK,
        foot_l=left, foot_r=right, foot_dir_l=ld, foot_dir_r=rd, toe_l=lt, toe_r=rt,
        hand_l=L.wp((0.3, -0.3 - 0.04 * swing, 2.05 + 0.01 * swing)),
    )
    if running:
        # A hurried step carries the staff clear, rather than using it as a
        # third planted leg between short running contacts.
        return base.but(hand_r=(-0.8, -0.45, 2.7), staff=(0.0, -0.16, 1.0))
    q = (phase - 0.5) % 1.0
    plant = 0.32
    front, back = -0.95, -0.95 + 2 * half * plant / stance
    if q < plant:
        u = q / plant
        foot = (-1.0, front + (back - front) * u, 0.0)
        top = (-0.86, foot[1] + 0.25 - 0.2 * u, 3.0)
    else:
        u = (q - plant) / (1 - plant)
        e = L.smooth(u)
        foot = (-1.0, back + (front - back) * e, 0.22 * math.sin(math.pi * u))
        top = (-0.86, foot[1] + 0.05 + 0.2 * e, 3.0)
    return L.aimed(base.but(hand_r=(-0.8, foot[1] + 0.2, 2.72)), foot, top)


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
arm = R.build_armature()
rig = R.Rig(arm)
bpy.context.scene.render.fps = 24
reports = {}
for name, running, frames, stance in [('Walk', False, 29, 0.6), ('Run', True, 18, 0.4)]:
    keys = C.keys_of(
        [(i / 24, body(rig, (i / frames) % 1.0, running), 'linear') for i in range(frames + 1)],
        loop=True,
    )
    action = R.make_clip(arm, name, keys)
    R.follow_through(arm, action, loop=True, wind=0.0)
    close_loop(arm, action, frames)
    reports[name] = {'duration': frames / 24, 'stance': stance}

arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)
    pb.scale = (1, 1, 1)
arm.select_set(True)
raw = sys.argv[sys.argv.index('--') + 1]
bpy.ops.export_scene.gltf(
    filepath=raw, export_format='GLB', use_selection=True, export_apply=False,
    export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_anim_slide_to_zero=True,
    export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
)
with open(raw + '.json', 'w', encoding='utf8') as out:
    json.dump(reports, out, indent=2)
