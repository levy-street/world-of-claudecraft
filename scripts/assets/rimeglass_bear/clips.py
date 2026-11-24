"""Author the Rimeglass Bear's own Idle and Attack over the wolf-rig build.

  blender -b tmp/rimeglass_bear/bear.blend --python scripts/assets/rimeglass_bear/clips.py -- \
      --out tmp/rimeglass_bear/bear_clips.glb [--blend tmp/rimeglass_bear/bear_clips.blend]

The carried wolf Idle and Attack are replaced; every other clip is kept as built.
The body is posed by hand (armature-space turns on the spine, neck, head, ears and
tail, a travelling Pelvis), and the paws are held by IK: planted paws stay on their
rest spot, and the Attack's swiping forepaw follows an authored path. Each frame's
solved pose is then keyed through motion.key_action, the same writer the build uses,
so the clips match the rest of the set (30 fps, from t = 0, a loop's last key equal to
its first).
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'wolf_rig'))
import motion  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--blend')
args = ap.parse_args(argv)

scene = bpy.context.scene
scene.render.fps = motion.FPS
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
motion.set_action(arm, None)
for pb in arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
bpy.context.view_layer.update()

REST = {b.name: b.matrix_local.copy() for b in arm.data.bones}


def confine_ears():
    """Bone heat spread each ear over half the skull and down the neck, so an ear
    flick dragged the face. Keep ear weight only around the ear lobe (full within
    7 cm of its centre, none past 14 cm or below its base); the rest goes to Head."""
    vg = {g.name: g for g in body.vertex_groups}
    head = vg['Head']
    moved = 0
    for side in ('L', 'R'):
        ear, tip = arm.data.bones['Ear_' + side], arm.data.bones['EarTip_' + side]
        centre = (ear.head_local + tip.tail_local) / 2
        base_z = ear.head_local.z - 0.04
        for v in body.data.vertices:
            w_ear = w_tip = 0.0
            for e in v.groups:
                if e.group == vg['Ear_' + side].index:
                    w_ear = e.weight
                elif e.group == vg['EarTip_' + side].index:
                    w_tip = e.weight
            if w_ear + w_tip <= 0.0:
                continue
            d = (v.co - centre).length
            keep = 1.0 - min(max((d - 0.07) / 0.07, 0.0), 1.0)
            if v.co.z < base_z:
                keep = 0.0
            lost = (w_ear + w_tip) * (1.0 - keep)
            if lost <= 0.0:
                continue
            vg['Ear_' + side].add([v.index], w_ear * keep, 'REPLACE')
            vg['EarTip_' + side].add([v.index], w_tip * keep, 'REPLACE')
            head.add([v.index], lost, 'ADD')
            moved += 1
    print('ears confined: moved weight on', moved, 'corners')


confine_ears()
AW = arm.matrix_world.copy()
LEGS = {
    'FL': ('FrontPastern_L', 'FrontPaw_L', 'Forearm_L', +1),
    'FR': ('FrontPastern_R', 'FrontPaw_R', 'Forearm_R', +1),
    'HL': ('HindPastern_L', 'HindPaw_L', 'Shin_L', -1),
    'HR': ('HindPastern_R', 'HindPaw_R', 'Shin_R', -1),
}


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    scene.collection.objects.link(e)
    e.location = loc
    return e


# --------------------------------------------------------------- the leg IK
targets, poles = {}, {}
for leg, (past, paw, mid, knee_dir) in LEGS.items():
    tip = AW @ (REST[past] @ Vector((0, arm.data.bones[past].length, 0)))
    targets[leg] = empty('T_' + leg, tip)
    knee = AW @ REST[mid].to_translation()
    # elbows point back (+Y), stifles forward (-Y)
    poles[leg] = empty('P_' + leg, knee + Vector((0, 0.8 * knee_dir, 0)))
    c = arm.pose.bones[past].constraints.new('IK')
    c.target = targets[leg]
    c.pole_target = poles[leg]
    c.chain_count = 3
    c.use_tail = True


def rest_deviation():
    bpy.context.view_layer.update()
    err = 0.0
    for leg, (past, _paw, mid, _k) in LEGS.items():
        for bn in (past, mid):
            err += (arm.pose.bones[bn].head - REST[bn].to_translation()).length
    return err


for leg, (past, *_r) in LEGS.items():
    c = arm.pose.bones[past].constraints['IK']
    best = min(range(-180, 180, 15), key=lambda a: (setattr(c, 'pole_angle', math.radians(a)), rest_deviation())[1])
    c.pole_angle = math.radians(best)
print('IK rest deviation', round(rest_deviation(), 4))
TARGET_REST = {leg: e.location.copy() for leg, e in targets.items()}


# --------------------------------------------------------------- posing helpers
def turn(bone, rx=0.0, ry=0.0, rz=0.0):
    """Turn a bone by armature-space angles (degrees): rx pitches (positive drops a
    forward-pointing bone's tip), rz yaws (positive swings the muzzle to the bear's
    left, +X), ry rolls. Written in the bone's local rest frame."""
    R = (Matrix.Rotation(math.radians(rz), 3, 'Z') @ Matrix.Rotation(math.radians(rx), 3, 'X')
         @ Matrix.Rotation(math.radians(ry), 3, 'Y'))
    M = REST[bone].to_3x3()
    q = (M.inverted() @ R @ M).to_quaternion()
    pb = arm.pose.bones[bone]
    pb.rotation_quaternion = pb.rotation_quaternion @ q


def move_pelvis(dx=0.0, dy=0.0, dz=0.0):
    M = REST['Pelvis'].to_3x3()
    arm.pose.bones['Pelvis'].location = M.inverted() @ Vector((dx, dy, dz))


PLANTED = {leg: True for leg in LEGS}
FLAT = {leg: 0.0 for leg in LEGS}  # an FK paw eased flat onto the ground (0..1)


def ik_on(leg, on):
    past, paw = LEGS[leg][0], LEGS[leg][1]
    arm.pose.bones[past].constraints['IK'].influence = 1.0 if on else 0.0
    PLANTED[leg] = on


def reset():
    for leg in LEGS:
        ik_on(leg, True)
        FLAT[leg] = 0.0
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    for leg, e in targets.items():
        e.location = TARGET_REST[leg]


def ss(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def track(t, keys):
    """Piecewise smoothstep through (time, value) keys; value may be a tuple."""
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = ss((t - t0) / (t1 - t0))
            if isinstance(v0, tuple):
                return tuple(a + (b - a) * u for a, b in zip(v0, v1))
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def capture():
    bpy.context.view_layer.update()
    # a planted paw keeps its rest turn (flat on the ground) wherever its leg goes
    for leg, (_past, paw, _mid, _k) in LEGS.items():
        w = 1.0 if PLANTED[leg] else FLAT[leg]
        if w > 0.0:
            pb = arm.pose.bones[paw]
            q = pb.matrix.to_quaternion().slerp(REST[paw].to_quaternion(), w)
            pb.matrix = Matrix.LocRotScale(pb.head.copy(), q, None)
            bpy.context.view_layer.update()
    return {pb.name: pb.matrix.copy() for pb in arm.pose.bones}


def pulse(t, at, width):
    """A smooth 0 -> 1 -> 0 bump centred at `at`."""
    d = abs(t - at) / width
    return 0.0 if d >= 1 else 0.5 * (1 + math.cos(math.pi * d))


# --------------------------------------------------------------- Idle (3 s loop)
IDLE_T = 3.0


def idle_pose(t):
    reset()
    w = 2 * math.pi / IDLE_T
    breath = math.sin(2 * w * t)  # two slow breaths per loop
    sway = math.sin(w * t)
    sniff = pulse(t, 1.95, 0.55)  # the head comes up to scent the air
    nods = sniff * math.sin(2 * math.pi * 7.0 * (t - 1.95))  # three quick sniffs
    move_pelvis(dx=0.018 * sway, dz=0.010 * breath - 0.008)
    turn('Pelvis', ry=-1.5 * sway)
    turn('Spine1', rx=-0.6 * breath)
    turn('Spine2', rx=-1.0 * breath, ry=1.0 * sway)
    turn('Chest', rx=-1.6 * breath, ry=1.5 * sway, rz=-1.5 * sway)
    turn('Neck1', rz=3.0 * sway, rx=-6.0 * sniff)
    turn('Neck2', rz=3.5 * sway, rx=-6.0 * sniff)
    turn('Head', rz=4.0 * sway + 3.0 * math.sin(w * t * 2 + 0.7), rx=-8.0 * sniff + 2.2 * nods + 1.0 * breath)
    turn('Ear_L', rz=-22.0 * pulse(t, 0.9, 0.12), rx=-8.0 * sniff)
    turn('Ear_R', rz=22.0 * pulse(t, 2.45, 0.12), rx=-8.0 * sniff)
    turn('EarTip_L', rz=-10.0 * pulse(t, 0.93, 0.12))
    turn('EarTip_R', rz=10.0 * pulse(t, 2.48, 0.12))
    for i in range(1, 7):
        name = f'Tail{i}'
        if name in arm.pose.bones:
            turn(name, rz=3.0 * math.sin(w * t - 0.4 * i))
    return capture()


# --------------------------------------------------------------- Attack (1.0 s): a bite
ATK_T = 1.0


def attack_pose(t):
    """Rock back with the head up and the ears pinned, lunge with the head thrust
    forward, snap shut (a sharp nod), worry the bite with two short shakes, and
    settle back. Every paw stays planted."""
    reset()
    keys_body = [(0.0, 0.0), (0.28, 1.0), (0.40, -1.0), (0.62, -0.85), (1.0, 0.0)]
    lean = track(t, keys_body)  # +1 rocked back, -1 lunged
    move_pelvis(dy=0.08 * lean if lean > 0 else 0.13 * lean,
                dz=0.025 * max(lean, 0.0) - 0.005 * max(-lean, 0.0))
    pitch = track(t, [(0.0, 0.0), (0.28, -7.0), (0.40, 4.0), (0.62, 3.0), (1.0, 0.0)])
    turn('Pelvis', rx=0.3 * pitch)
    turn('Spine1', rx=0.4 * pitch)
    turn('Spine2', rx=0.5 * pitch)
    turn('Chest', rx=0.7 * pitch)
    # neck: raised on the wind-up, stretched long and level on the lunge
    neck = track(t, [(0.0, 0.0), (0.28, -14.0), (0.40, -4.0), (0.62, -3.0), (1.0, 0.0)])
    head = track(t, [(0.0, 0.0), (0.28, -16.0), (0.38, -8.0), (0.43, 7.0), (0.50, 2.0),
                     (0.62, 3.0), (1.0, 0.0)])
    shake = math.sin(2 * math.pi * (t - 0.46) / 0.14) * pulse(t, 0.60, 0.16) if t > 0.44 else 0.0
    turn('Neck1', rx=0.5 * neck, rz=3.0 * shake)
    turn('Neck2', rx=0.5 * neck, rz=4.0 * shake)
    turn('Head', rx=head, rz=7.0 * shake, ry=-6.0 * shake)
    pin = track(t, [(0.0, 0.0), (0.22, -32.0), (0.70, -32.0), (1.0, 0.0)])
    turn('Ear_L', rx=pin)
    turn('Ear_R', rx=pin)
    return capture()


def build(name, fn, length, loop):
    n = int(round(length * motion.FPS))
    poses = [fn(k / motion.FPS) for k in range(n + 1)]
    if loop:
        poses[-1] = poses[0]
    return poses


idle = build('Idle', idle_pose, IDLE_T, True)
atk = build('Attack', attack_pose, ATK_T, False)

# drop the IK rig, then key the solved poses
reset()
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
for e in list(targets.values()) + list(poles.values()):
    bpy.data.objects.remove(e, do_unlink=True)
motion.key_action(arm, 'Idle', idle)
motion.key_action(arm, 'Attack', atk)
motion.set_action(arm, None)
for pb in arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
for o in bpy.context.view_layer.objects:
    o.select_set(o in (arm, body))
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(args.out), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
    export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True,
    export_def_bones=False, export_leaf_bone=False, export_skins=True, export_influence_nb=4,
    export_all_influences=False, export_morph=False, export_optimize_animation_size=False,
    export_reset_pose_bones=True, export_bake_animation=False, export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO')
print('CLIPS wrote', args.out, 'idle', len(idle), 'attack', len(atk))
