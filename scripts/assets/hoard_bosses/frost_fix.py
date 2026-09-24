"""Hoarfrost Warden, playtest fixes on Tripo's own biped rig.

He keeps Tripo's rig (the local KayKit rig does not fit his proportions: huge
shoulders over short legs), and two things are repaired per retargeted clip:

  * Jelly arms. His arms are rigid ice gauntlets, but the auto-rig smeared them
    over the twist chains and the hand. The twist bones and the hand are folded
    into their parent arm bone and the arm weights are sharpened, so each
    gauntlet moves as one solid piece.
  * Forearms held out in front. The presets were authored for a slim A-pose and
    retarget onto his wide stance as a permanent "carrying a tray" pose. Every
    arm rotation is relaxed toward his generated rest pose (arms at his sides),
    which keeps a share of the motion as life.

  --attack replaces the clip with an AUTHORED one, named by --author:
      slam      (default) the two-fisted overhead slam, his melee Attack
      iceage    the Ice Age cast: a heavy stance, arms opening wide, then a long
                held channel with slow frost pulses (5.5 s, longer than any cast)
      release   the Ice Age blast: the held arms are thrown down and out
      frontal   Whiteout Gust: fists drawn to the chest, then both arms driven
                forward; the release lands 0.72 s in

  blender --background --python frost_fix.py -- <in.glb> <out.glb> <relax 0..1> [--attack <fixed idle.glb>]
"""
import math
import sys

import bpy
from mathutils import Matrix, Quaternion

args = sys.argv[sys.argv.index('--') + 1:]
src, dst, relax = args[0], args[1], float(args[2])
attack = '--attack' in args
idle_src = args[args.index('--attack') + 1] if attack else None
author = args[args.index('--author') + 1] if '--author' in args else 'slam'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
meshes = [o for o in scene.objects if o.type == 'MESH' and o.find_armature() is arm]
for o in list(scene.objects):
    if o.type == 'MESH' and o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)

# ---- weights
FOLD = {}
for s in ('L_', 'R_'):
    for twist in ('UpperarmTwist01', 'UpperarmTwist02'):
        FOLD[s + twist] = s + 'Upperarm'
    for twist in ('ForearmTwist01', 'ForearmTwist02', 'Hand'):
        FOLD[s + twist] = s + 'Forearm'
ARM_GROUPS = {s + b for s in ('L_', 'R_') for b in ('Upperarm', 'Forearm')}
for mesh in meshes:
    names = {g.index: g.name for g in mesh.vertex_groups}
    index = {g.name: g for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        weights = {}
        for g in v.groups:
            name = FOLD.get(names[g.group], names[g.group])
            weights[name] = weights.get(name, 0.0) + g.weight
        if sum(w for n, w in weights.items() if n in ARM_GROUPS) > 0.5:
            weights = {n: w ** 4 for n, w in weights.items()}
        total = sum(weights.values()) or 1.0
        for g in list(v.groups):
            mesh.vertex_groups[g.group].remove([v.index])
        for name, w in weights.items():
            if w / total > 1e-4:
                index[name].add([v.index], w / total, 'REPLACE')

# ---- clip
ARM_BONES = [s + b for s in ('L_', 'R_') for b in (
    'Clavicle', 'Upperarm', 'UpperarmTwist01', 'UpperarmTwist02',
    'Forearm', 'ForearmTwist01', 'ForearmTwist02', 'Hand')]
action = arm.animation_data.action
name = action.name
f0, f1 = action.frame_range


def curves(act):
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


if not attack:
    identity = Quaternion()
    for bone in ARM_BONES:
        path = 'pose.bones["%s"].rotation_quaternion' % bone
        quad = sorted((c for c in curves(action) if c.data_path == path), key=lambda c: c.array_index)
        if len(quad) != 4:
            continue
        for k in range(len(quad[0].keyframe_points)):
            q = Quaternion([quad[i].keyframe_points[k].co[1] for i in range(4)])
            if q.w < 0:
                q.negate()
            q = q.slerp(identity, relax)
            for i in range(4):
                point = quad[i].keyframe_points[k]
                point.co[1] = q[i]
                point.handle_left[1] = q[i]
                point.handle_right[1] = q[i]
        for c in quad:
            c.update()
else:
    arm.animation_data.action = None
    bpy.data.actions.remove(action)
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action
    mw = arm.matrix_world

    def swing(bone, *turns):
        """Turn a bone from its REST pose about world axes through its head; the
        turns apply in order (the first is innermost)."""
        pb = arm.pose.bones[bone]
        pivot = mw @ pb.head
        rot = Matrix.Identity(4)
        for axis, degrees in turns:
            rot = Matrix.Rotation(math.radians(degrees), 4, axis) @ rot
        world = Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot)
        pb.matrix = mw.inverted() @ world @ mw @ pb.matrix
        bpy.context.view_layer.update()

    # The stance every key starts from is the first frame of his (fixed) idle:
    # the presets carry bone offsets of their own, so the rig's bare rest pose
    # is NOT how he stands.
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=idle_src)
    extra = [o for o in scene.objects if o not in before]
    donor = next(o for o in extra if o.type == 'ARMATURE')
    scene.frame_set(1)
    bpy.context.view_layer.update()
    stance = {pb.name: pb.matrix_basis.copy() for pb in donor.pose.bones}
    donor_action = donor.animation_data.action if donor.animation_data else None
    for o in extra:
        bpy.data.objects.remove(o, do_unlink=True)
    if donor_action:
        bpy.data.actions.remove(donor_action)

    def reset():
        for pb in arm.pose.bones:
            pb.matrix_basis = stance[pb.name]
        bpy.context.view_layer.update()

    def key_all(frame):
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)
            pb.keyframe_insert('scale', frame=frame)

    if author == 'slam':
        # He faces +X: a NEGATIVE turn about +Y lifts a hanging arm forward and up.
        # frame: (arms forward-up, spine lean forward, hips drop)
        KEYS = [(1, 0, 0, 0.0), (5, -150, -12, 0.0), (7, -160, -14, 0.0), (10, -48, 26, -0.035),
                (14, -44, 24, -0.035), (24, 0, 0, 0.0)]
        for frame, lift, lean, drop in KEYS:
            for pb in arm.pose.bones:
                pb.matrix_basis = stance[pb.name]
            bpy.context.view_layer.update()
            swing('Spine01', ('Y', lean))
            for side, inward in (('L_', -1), ('R_', 1)):
                # Fists together: over his head, then down in front of him.
                swing(side + 'Upperarm', ('X', inward * 12 if lift else 0), ('Y', lift))
            for pb in arm.pose.bones:
                pb.rotation_mode = 'QUATERNION'
                pb.keyframe_insert('rotation_quaternion', frame=frame)
                pb.keyframe_insert('location', frame=frame)
                pb.keyframe_insert('scale', frame=frame)
            hip = arm.pose.bones['Hip']
            # Drop along the armature's up axis, whatever the bone's own axes are.
            hip.matrix = Matrix.Translation((0, 0, drop)) @ hip.matrix
            bpy.context.view_layer.update()
            hip.keyframe_insert('location', frame=frame)
        scene.frame_start, scene.frame_end = 1, 24
    else:
        FPS = 24

        def ease(a, b, t):
            t = min(1.0, max(0.0, (t - a) / (b - a)))
            return t * t * (3 - 2 * t)

        def pulse(t, hz, lag=0.0):
            return math.sin(2 * math.pi * (t * hz - lag))

        THIGH, CALF = 0.19, 0.125  # his leg segments, for keeping the feet planted

        def body(crouch=0.0, widen=0.0, lean=0.0, chest=0.0, head=0.0, shift=0.0):
            """Legs and trunk. crouch 0..1 bends the knees and drops (and eases back)
            the hips by what the bend takes, so the feet stay where they stand."""
            thigh, calf = 24 * crouch, 42 * crouch
            net = calf - thigh
            drop = THIGH * (1 - math.cos(math.radians(thigh))) + CALF * (1 - math.cos(math.radians(net)))
            slide = THIGH * math.sin(math.radians(thigh)) - CALF * math.sin(math.radians(net))
            hip = arm.pose.bones['Hip']
            hip.matrix = Matrix.Translation((shift - slide, 0, -drop)) @ hip.matrix
            bpy.context.view_layer.update()
            for side, out in (('L_', 1), ('R_', -1)):
                swing(side + 'Thigh', ('Y', -thigh), ('X', out * 7 * widen))
                swing(side + 'Calf', ('Y', calf))
                swing(side + 'Foot', ('Y', -net), ('X', -out * 7 * widen))
            swing('Spine01', ('Y', lean))
            swing('Spine02', ('Y', chest))
            swing('Head', ('Y', head))

        def arms(abduct=0.0, forward=0.0, back=0.0, raise_forearm=0.0, flex=0.0, shrug=0.0):
            """abduct: out to the side; forward: the raised arm brought round to the
            front; back: the upper arm drawn behind him; raise_forearm: the forearm
            lifted on from an abducted arm; flex: the elbow bent forward."""
            for side, out in (('L_', 1), ('R_', -1)):
                swing(side + 'Clavicle', ('X', out * shrug))
                swing(side + 'Upperarm', ('X', out * abduct), ('Y', back), ('Z', -out * forward))
                swing(side + 'Forearm', ('X', out * raise_forearm), ('Y', -flex))

        def clip_iceage(t):  # seconds
            gather = ease(0.0, 0.32, t) * (1 - ease(0.3, 0.75, t))  # the chest closes first
            open_ = ease(0.25, 1.0, t)
            held = ease(0.9, 1.4, t)
            breath = held * pulse(t, 0.55)
            surge = held * max(0.0, pulse(t, 1.0, 0.1)) ** 3  # a slow frost pulse a second
            body(crouch=0.55 * ease(0.0, 0.9, t) + 0.06 * surge, widen=open_,
                 lean=7 * gather - 9 * open_ - 1.2 * breath - 1.5 * surge,
                 chest=5 * gather - 7 * open_ - 1.0 * breath,
                 head=4 * gather - 13 * open_ + 1.2 * breath, shift=-0.012 * surge)
            arms(abduct=10 * gather + 60 * open_ + 2.5 * breath + 3 * surge, forward=24 * open_,
                 raise_forearm=-6 * gather + 34 * open_ + 3 * breath, shrug=9 * open_ + 1.5 * surge)

        def clip_release(t):
            out = ease(0.0, 0.14, t)
            back = ease(0.5, 1.1, t)
            live = 1 - back
            body(crouch=(0.55 + 0.45 * out) * live, widen=live, lean=(-9 + 29 * out) * live,
                 chest=(-7 + 17 * out) * live, head=(-13 + 25 * out) * live, shift=0.02 * out * live)
            arms(abduct=(60 - 18 * out) * live, forward=(24 + 40 * out) * live,
                 raise_forearm=(34 - 40 * out) * live, shrug=(9 - 6 * out) * live)

        def clip_frontal(t):
            wind = ease(0.0, 0.5, t)
            fire = ease(0.6, 0.72, t)
            back = ease(1.0, 1.5, t)
            live = 1 - back
            body(crouch=(0.6 * wind + 0.4 * fire) * live, widen=0.5 * wind * live,
                 lean=(-9 * wind + 33 * fire) * live, chest=(-5 * wind + 14 * fire) * live,
                 head=(7 * wind + 5 * fire) * live, shift=(-0.02 * wind + 0.055 * fire) * live)
            arms(abduct=(24 * wind - 14 * fire) * live, back=(20 * wind - 100 * fire) * live,
                 flex=(108 * wind - 98 * fire) * live, shrug=(-6 * wind + 10 * fire) * live)

        fn, seconds = {'iceage': (clip_iceage, 5.5), 'release': (clip_release, 1.1),
                       'frontal': (clip_frontal, 1.5)}[author]
        frames = round(seconds * FPS)
        for f in range(frames + 1):
            reset()
            fn(f / FPS)
            key_all(f + 1)
        scene.frame_start, scene.frame_end = 1, frames + 1

bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
for o in meshes:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB', use_selection=True, export_yup=True,
    export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_optimize_animation_size=False,
)
print('WROTE', dst, 'ACTION', name)
