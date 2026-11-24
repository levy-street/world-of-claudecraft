"""Replace a Tripo biped's Death clip with a topple (headless Blender).

blender -b --factory-startup --python scripts/assets/quartered_isle_creatures/topple_death.py -- \
    <in.glb> <out.glb> [--direction back|forward]

Tripo's defeat_02 preset is a stagger that ends standing, so a corpse stayed upright. The
new Death keeps the stagger's opening, then pivots the whole rig over around the base of
its feet so it lands flat (stiff, like the rock and ice bodies it is for), with a small
settle bounce. Every other clip is exported unchanged.
"""
import math
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :]
SRC, OUT = argv[0], argv[1]
DIRECTION = argv[argv.index('--direction') + 1] if '--direction' in argv else 'back'
STAGGER_END = 0.55  # seconds of defeat_02 kept, then held
TOPPLE_START, TOPPLE_END = 0.35, 1.15  # the fall
SETTLE_END = 1.45  # the bounce has died out
FALL_DEG = 88.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
# Keep the importer's frame rate: the exporter turns frames back into seconds with it.
FPS = sc.render.fps / sc.render.fps_base
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
death = next(a for a in bpy.data.actions if a.name.split('|')[-1] == 'Death' or a.name == 'Death')
root_name = next(b.name for b in arm.data.bones if b.parent is None)
print('root bone', root_name, 'death action', death.name, 'frames', tuple(death.frame_range))

# Bake the opening of the stagger (all bones) into a new action, then hold its last pose.
arm.animation_data.action = death
f0 = death.frame_range[0]
hold_frame = f0 + STAGGER_END * FPS
new = bpy.data.actions.new('Death')
arm.animation_data.action = new
# Copy the stagger by sampling: set the old action, read pose, key it on the new one.
end_frame = int(round(SETTLE_END * FPS)) + 1
pose_keys = {}
for f in range(0, end_frame):
    arm.animation_data.action = death
    sc.frame_set(int(min(f0 + f, hold_frame)))
    pose_keys[f] = {
        pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy())
        for pb in arm.pose.bones
    }
arm.animation_data.action = new

# Feet pivot and the fall axis, in the armature's space, from the rest pose's bone heads
# (the skinned mesh's own coordinates are not in this space). The glTF rig faces +X.
sc.frame_set(int(f0))
heads = [arm.pose.bones[b.name].head for b in arm.data.bones]
floor = min(h.z for h in heads)
xs = [h.x for h in heads]
depth = max(xs) - min(xs)
centre_x = sum(xs) / len(xs)
pivot = Vector((centre_x + (-0.5 if DIRECTION == 'back' else 0.5) * depth, 0.0, floor))
sign = -1.0 if DIRECTION == 'back' else 1.0  # +angle about +Y tips the top toward +X


def ease_in(t):
    return t * t * t  # a heavy body accelerates as it goes over


def angle_at(t):
    if t <= TOPPLE_START:
        return 0.0
    if t <= TOPPLE_END:
        return FALL_DEG * ease_in((t - TOPPLE_START) / (TOPPLE_END - TOPPLE_START))
    # settle: a small damped rebound off the ground
    u = (t - TOPPLE_END) / (SETTLE_END - TOPPLE_END)
    return FALL_DEG - 6.0 * math.sin(min(u, 1.0) * math.pi) * (1.0 - min(u, 1.0) * 0.5)


root_pb = arm.pose.bones[root_name]
for f in range(0, end_frame):
    t = f / FPS
    for name, (loc, rot, scl) in pose_keys[f].items():
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl
    bpy.context.view_layer.update()
    # Pivot the root's armature-space matrix around the feet.
    a = math.radians(sign * angle_at(t))
    tilt = Matrix.Translation(pivot) @ Matrix.Rotation(a, 4, 'Y') @ Matrix.Translation(-pivot)
    root_pb.matrix = tilt @ root_pb.matrix
    bpy.context.view_layer.update()
    for pb in arm.pose.bones:
        for path in ('location', 'rotation_quaternion', 'scale'):
            pb.keyframe_insert(path, frame=f)

# Drop the old Death so the exporter writes the new one under the game's clip name.
bpy.data.actions.remove(death)
new.name = 'Death'
new.use_fake_user = True
for a in bpy.data.actions:
    a.use_fake_user = True
arm.animation_data.action = None
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_image_format='AUTO',
)
print('TOPPLED', OUT, 'pivot', tuple(round(v, 3) for v in pivot), 'frames', end_frame)
