"""Keying solved poses into Blender actions, and measuring what was keyed.

Every bone but the parentless Root gets a rotation key on every frame (the glTF
exporter resets an unkeyed pose bone while it samples, and Root is never
animated); the Hips also take their location. Keys are linear: the clip is
dense, solved per frame, so the curve between two keys is the solve's own.
Loops repeat their first frame as their last, so the last key closes the loop.
"""
import bpy
from mathutils import Quaternion, Vector

FPS_DEFAULT = 60


def fcurves(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if act is not None and act.slots:
        arm.animation_data.action_slot = act.slots[0]


def make_action(arm, rig, name, bodies, fps=FPS_DEFAULT, loop=True):
    """Solve `bodies` (one per frame, frame 0..N) and key them as action `name`.
    Returns (action, stats) where stats carries the legs' worst stretch."""
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new(id_type='OBJECT', name=arm.name)
    strip = act.layers.new('Layer').strips.new(type='KEYFRAME')
    cb = strip.channelbags.new(slot)
    bones = [pb.name for pb in arm.pose.bones if pb.name != 'Root']
    rot = {b: [] for b in bones}
    loc = []
    reach = 0.0
    clamped, clamp_max = 0, 0.0
    last = {}
    for b in bodies:
        pose = rig.solve(b)
        reach = max(reach, *pose.reach.values()) if pose.reach else reach
        turn = max((abs(x) for v in pose.clamp.values() for x in v), default=0.0)
        if turn > 1e-6:
            clamped += 1
            clamp_max = max(clamp_max, turn)
        for name_b in bones:
            q = Quaternion(pose[name_b])
            prev = last.get(name_b)
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            last[name_b] = q
            rot[name_b].append(q)
        loc.append(Vector(pose.hips_loc))
    n = len(bodies)

    def put(path, index, values, group):
        fc = cb.fcurves.new(path, index=index, group_name=group)
        fc.keyframe_points.add(n)
        co = []
        for f, v in enumerate(values):
            co += [float(f), float(v)]
        fc.keyframe_points.foreach_set('co', co)
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()

    for name_b in bones:
        path = f'pose.bones["{name_b}"].rotation_quaternion'
        for i in range(4):
            put(path, i, [q[i] for q in rot[name_b]], name_b)
    for i in range(3):
        put('pose.bones["Hips"].location', i, [v[i] for v in loc], 'Hips')
    act['frames'] = n - 1
    act['fps'] = fps
    act['loop'] = bool(loop)
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, n - 1
    # how often the ground clamp had to step in (a well-authored clip barely needs it)
    return act, {'max_reach': round(reach, 4), 'frames': n - 1, 'clamped_frames': clamped,
                 'clamp_max_deg': round(clamp_max, 1)}


def sample_bones(arm, act, names, frames=None):
    """Armature-space heads of `names` on each frame of `act` (evaluated, not solved)."""
    scene = bpy.context.scene
    set_action(arm, act)
    n = int(act['frames'])
    out = {nm: [] for nm in names}
    for f in (frames if frames is not None else range(n + 1)):
        scene.frame_set(f)
        for nm in names:
            out[nm].append(arm.pose.bones[nm].head.copy())
    return out
