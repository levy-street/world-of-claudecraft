"""Render review stills of a built creature .blend (authoring aid).

  blender -b <creature.blend> --python render_views.py -- <out_dir> <Clip:frame:az:el:dist:fx:fy:fz> ...

az/el in degrees (az 0 = looking from the creature's front, -Y), dist in yards,
(fx, fy, fz) the focus point. Adds a player-sized reference figure beside it
when the scene has none.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from organic_kit import player_reference, setup_preview  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out_dir = argv[0]
os.makedirs(out_dir, exist_ok=True)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
if not any(o.type == 'LIGHT' for o in scene.objects):
    setup_preview((0, 0, 3), 20)
if not any(o.name.startswith('PlayerReference') for o in scene.objects):
    player_reference(scene, (6.0, 0, 0), 2.6)
if scene.camera is None:
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
cam = scene.camera
cam.data.lens = 40
scene.render.resolution_x, scene.render.resolution_y = 1280, 900
for spec in argv[1:]:
    name, frame, az, el, dist, fx, fy, fz = spec.split(':')
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    scene.frame_set(int(frame))
    az, el, dist = math.radians(float(az)), math.radians(float(el)), float(dist)
    focus = Vector((float(fx), float(fy), float(fz)))
    offset = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = focus + offset
    cam.rotation_euler = (focus - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out_dir, f'{name}_{frame}_{int(math.degrees(az))}.png')
    bpy.ops.render.render(write_still=True)
    print('VIEW', scene.render.filepath)
