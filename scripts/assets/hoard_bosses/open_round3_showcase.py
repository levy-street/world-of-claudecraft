"""Open the third playtest round in the Blender window.

The Hoarfrost Warden plays his authored clips back to back (idle, the Ice Age
channel, its blast, the Whiteout Gust frontal, the two-fisted slam), each named by
a timeline marker, and the Emberforge Tyrant stands beside him in his T-pose with
the new forge gauntlets.

Two steps, because rebuilding a scene inside a live window resets the window:

  blender --background --python open_round3_showcase.py -- <warden fixed dir> <ember gauntlets.glb> --save round3.blend
  blender round3.blend --python open_round3_showcase.py
"""
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
BUILD = len(args) >= 2
background = bpy.app.background


def build():
    fixed, ember = args[0], args[1]
    save = args[args.index('--save') + 1] if '--save' in args else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24

    def load(path):
        before = set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        return [o for o in scene.objects if o not in before]

    # ---- the Warden: one rig, every clip
    CLIPS = [('Idle', 'anim_preset_biped_idle.glb', 1), ('IceAge', 'authored_iceage.glb', 1),
             ('IceAgeRelease', 'authored_release.glb', 1), ('Idle ', 'anim_preset_biped_idle.glb', 0),
             ('FrostFrontal', 'authored_frontal.glb', 2), ('Attack (slam)', 'anim_preset_biped_slash.glb', 2)]
    warden = None
    actions = {}
    for name, file, _ in CLIPS:
        if file in actions:
            continue
        objects = load(fixed + '/' + file)
        rig = next(o for o in objects if o.type == 'ARMATURE')
        action = rig.animation_data.action
        action.name = file
        action.use_fake_user = True
        actions[file] = action
        if warden is None:
            warden = rig
            for o in objects:
                if o.type == 'MESH' and o.find_armature() is not rig:
                    bpy.data.objects.remove(o, do_unlink=True)
        else:
            for o in objects:
                bpy.data.objects.remove(o, do_unlink=True)
    warden.animation_data.action = None
    track = warden.animation_data.nla_tracks.new()
    track.name = 'Round 3'
    cursor = 1
    for name, file, repeat in CLIPS:
        action = actions[file]
        length = int(action.frame_range[1] - action.frame_range[0])
        strip = track.strips.new(name, cursor, action)
        if name.startswith('Idle'):
            strip.action_frame_end = action.frame_range[0] + 48  # two seconds of it is plenty
            length = 48
            repeat = 1
        strip.repeat = max(1, repeat)
        scene.timeline_markers.new(name.strip(), frame=cursor)
        cursor += length * max(1, repeat) + 10
    scene.frame_start, scene.frame_end = 1, cursor
    scene.frame_set(1)

    # The floor goes under the Warden's feet, wherever his rig puts them.
    bpy.context.view_layer.update()
    body = next(o for o in scene.objects if o.type == 'MESH' and o.find_armature() is warden)
    floor_z = min((body.matrix_world @ Vector(c)).z for c in body.bound_box)

    # ---- Emberforge and his gauntlets, beside him (his raw is centred on its middle)
    for o in load(ember):
        if o.parent is None:
            o.location = Vector((0.0, -1.35, floor_z + 0.5 * 1.05))
            o.scale = (1.05, 1.05, 1.05)

    for name, energy, rot in (('Key', 3.5, (0.9, 0, 1.2)), ('Fill', 1.6, (1.1, 0, -1.2))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = rot
        scene.collection.objects.link(light)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, -0.6, floor_z))
    bpy.context.object.name = 'Floor'
    warden.hide_set(True)
    for o in scene.objects:
        if o.type == 'EMPTY':
            o.hide_set(True)

    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)
        print('SAVED', save)


if BUILD:
    build()


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
                bpy.ops.view3d.view_axis(type='RIGHT')
                bpy.ops.view3d.view_orbit(angle=0.55, type='ORBITLEFT')
                bpy.ops.view3d.view_orbit(angle=0.2, type='ORBITUP')
                bpy.ops.object.select_all(action='DESELECT')
                for o in bpy.context.scene.objects:
                    # Frame the two bosses, never the floor under them.
                    if o.type == 'MESH' and o.name != 'Floor' and not o.hide_get():
                        o.select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
                bpy.ops.screen.animation_play()
            return None
    return None


if not background:
    bpy.app.timers.register(start, first_interval=1.0)
