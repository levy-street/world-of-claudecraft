"""Open the saved harbormaster gear review scene in the Blender window, framed and shaded.

  node scripts/assets/harbormaster_gear/extract_reference.mjs
  blender --background --python scripts/assets/harbormaster_gear/build_harbormaster_gear.py -- \
      --save capitana.blend
  blender capitana.blend --python scripts/assets/harbormaster_gear/open_gear.py

Shows the exported tricorne, pipe and spyglass on the harbormaster's own composed body (the
fitting reference) in Material Preview. Nothing else runs: the timer only sets the shading and
frames the view once the window exists.
"""
import bpy


def start():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.shading.use_scene_world = True
            space.shading.use_scene_lights = True
            space.overlay.show_extras = False
            region = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.ops.object.select_all(action='DESELECT')
                picks = []
                for name in ('HarbormasterTricorne_ROOT', 'HarbormasterSpyglass_ROOT'):
                    root = bpy.data.objects.get(name)
                    if root is not None:
                        picks += [root] + list(root.children_recursive)
                ref = bpy.data.collections.get('HarbormasterBody_Reference')
                if ref is not None:
                    picks += list(ref.objects)
                for obj in picks:
                    if obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_orbit(angle=0.6, type='ORBITRIGHT')
                bpy.ops.view3d.view_orbit(angle=0.2, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
