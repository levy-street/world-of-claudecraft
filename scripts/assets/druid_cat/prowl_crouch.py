"""Stalk crouch post-pass over the baked ProwlIdle / ProwlWalk actions.

The Codex revision chain (v3 to v11) re-authored the prowl body motion on the
control rig but never lowered it: both prowl actions stand at the Idle / Walk
height. Rather than re-bake them through a kernel that no longer matches their
lineage, this pass edits the baked CONTROL curves in place: a constant torso
drop (through the paw IK, so every leg folds while the paws stay planted) and a
constant neck / head pitch so the stalk reads low and forward. Rig-unit depths
were measured headless on the v2 rig: -0.09 is the deepest idle drop that keeps
the hocks above the ground plane (-0.11 sinks them 2 cm); the wider gait
stance takes -0.125 with the mesh still on the plane and the paw IK error
unchanged from the plain walk.

Run from Blender with the rig file open and this directory on sys.path:
    import prowl_crouch; prowl_crouch.apply(bpy.data.objects['DruidCat_Rig'])
then export through export.export_cat with the rig at unit scale.
"""
import math
import bpy
from mathutils import Quaternion, Vector

PROWL_CROUCH = -0.09
PROWL_WALK_CROUCH = -0.125
PROWL_NECK_PITCH = 10
PROWL_HEAD_PITCH = 8
CROUCH_BY_ACTION = {'ProwlIdle': PROWL_CROUCH, 'ProwlWalk': PROWL_WALK_CROUCH}
PITCH_BY_BONE = {'neck': PROWL_NECK_PITCH, 'head': PROWL_HEAD_PITCH}


def _fcurves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    yield curve


def _curves_for(action, bone, path):
    wanted = 'pose.bones["%s"].%s' % (bone, path)
    found = {c.array_index: c for c in _fcurves(action) if c.data_path == wanted}
    if not found:
        raise RuntimeError('%s has no %s curves for %s' % (action.name, path, bone))
    return found


def _shift_location(action, rig, bone, world_target_z):
    """Move the bone's keyed height so its MEAN world z over the clip equals
    world_target_z, keeping the authored bob. The v11 gait kernel already
    lowers the stalking torso a little, so a plain add would over-sink it."""
    basis = rig.pose.bones[bone].bone.matrix_local.to_3x3()
    curves = _curves_for(action, bone, 'location')
    keys = {i: list(c.keyframe_points) for i, c in curves.items()}
    count = len(keys[0])
    mean_z = sum((basis @ Vector([keys[i][k].co[1] for i in range(3)])).z for k in range(count)) / count
    local = basis.inverted() @ Vector((0, 0, world_target_z - mean_z))
    for index, curve in curves.items():
        for key in curve.keyframe_points:
            key.co[1] += local[index]
            key.handle_left[1] += local[index]
            key.handle_right[1] += local[index]


def _pitch_rotation(action, rig, bone, degrees):
    basis = rig.pose.bones[bone].bone.matrix_local.to_quaternion()
    pitch = Quaternion((1, 0, 0), math.radians(degrees))
    curves = _curves_for(action, bone, 'rotation_quaternion')
    keys = {i: list(c.keyframe_points) for i, c in curves.items()}
    count = len(keys[0])
    for k in range(count):
        q = Quaternion([keys[i][k].co[1] for i in range(4)])
        # motion.rotate authors local = basis^-1 @ world @ basis, and its world
        # rotations pre-multiply, so an extra world pitch lands as
        # basis^-1 @ pitch @ basis @ local.
        q2 = basis.inverted() @ pitch @ basis @ q
        for i in range(4):
            key = keys[i][k]
            delta = q2[i] - key.co[1]
            key.co[1] = q2[i]
            key.handle_left[1] += delta
            key.handle_right[1] += delta


def apply(rig):
    for name, depth in CROUCH_BY_ACTION.items():
        action = bpy.data.actions[name]
        _shift_location(action, rig, 'torso', depth)
        for bone, degrees in PITCH_BY_BONE.items():
            _pitch_rotation(action, rig, bone, degrees)
        action['stalk_crouch'] = depth
    return list(CROUCH_BY_ACTION)
