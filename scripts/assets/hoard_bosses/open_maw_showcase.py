"""Open the Abyssal Maw in the Blender window with every clip played back to back.

  blender <maw.blend> --python open_maw_showcase.py

The clips are laid end to end on one NLA track (loops repeated so they read), a
timeline marker names each one, and playback starts on its own.
"""
import bpy

arm = bpy.data.objects['MawRig']
scene = bpy.context.scene
ORDER = [('Idle', 1), ('Walk', 3), ('Run', 4), ('Attack', 2), ('Cast', 1), ('Hit', 2), ('Death', 1)]

arm.animation_data.action = None
for track in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(track)
track = arm.animation_data.nla_tracks.new()
track.name = 'Showcase'
for marker in list(scene.timeline_markers):
    scene.timeline_markers.remove(marker)
cursor = 1
for name, repeat in ORDER:
    action = bpy.data.actions[name]
    length = int(action.frame_range[1] - action.frame_range[0])
    strip = track.strips.new(name, cursor, action)
    strip.repeat = repeat
    scene.timeline_markers.new(name, frame=cursor)
    cursor += length * repeat + 8
    if name == 'Death':
        cursor += 24
scene.frame_start, scene.frame_end = 1, cursor
scene.frame_set(1)

for name, energy, rot in (('Key', 3.5, (0.9, 0, 1.2)), ('Fill', 1.5, (1.1, 0, -1.2))):
    if name not in bpy.data.objects:
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = rot
        scene.collection.objects.link(light)
if 'Floor' not in bpy.data.objects:
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -0.341))
    bpy.context.object.name = 'Floor'
arm.hide_set(True)  # show the beast, not the bones


def start():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.overlay.show_overlays = False
            region = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_orbit(angle=0.9, type='ORBITRIGHT')
                bpy.ops.view3d.view_orbit(angle=0.25, type='ORBITUP')
                bpy.ops.object.select_all(action='DESELECT')
                bpy.data.objects['AbyssalMaw'].select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
                bpy.ops.screen.animation_play()
            return None
    return None


bpy.app.timers.register(start, first_interval=1.0)
