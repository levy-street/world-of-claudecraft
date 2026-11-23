"""Open the saved Mirefen tavern review scene framed on the building and its roof-off copy, in
Material Preview with the scene's lights.

  npx tsx scripts/assets/mirefen_tavern/layout.ts --context TERRAIN.json
  blender --background --python scripts/assets/mirefen_tavern/build_tavern.py -- \
      --save taberna.blend --context TERRAIN.json
  blender taberna.blend --python scripts/assets/mirefen_tavern/open_tavern.py

Nothing else runs: the timer only sets the shading and frames the view once the window exists.
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
            space.overlay.show_overlays = True
            space.overlay.show_extras = False
            space.clip_end = 2000
            region = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.ops.object.select_all(action='DESELECT')
                for obj in bpy.data.objects:
                    if obj.type == 'MESH' and obj.name != 'Terrain' and obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_orbit(angle=0.7, type='ORBITRIGHT')
                bpy.ops.view3d.view_orbit(angle=0.55, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


bpy.app.timers.register(start, first_interval=1.0)
