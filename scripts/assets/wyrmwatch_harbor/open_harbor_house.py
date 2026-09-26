"""Open the saved Wyrmwatch cliff harbor review scene framed on the Harbormaster's House: the
house on its stilts and, out on the water beside it, its cutaway copy (walls on the door and
sea sides and the roof left off) with player-scale figures inside, in Material Preview.

  npx tsx scripts/assets/wyrmwatch_harbor/layout.ts --context TERRAIN.json
  blender --background --python scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py -- \
      --save house.blend --context TERRAIN.json
  blender house.blend --python scripts/assets/wyrmwatch_harbor/open_harbor_house.py

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
                    if obj.name.startswith('House') and obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_orbit(angle=0.6, type='ORBITRIGHT')
                bpy.ops.view3d.view_orbit(angle=0.45, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
