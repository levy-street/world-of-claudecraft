"""Open the saved Wyrmwatch cliff harbor review scene in the Blender window, framed and shaded.

  npx tsx scripts/assets/wyrmwatch_harbor/layout.ts --context TERRAIN.json
  blender --background --python scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py -- \
      --save wyrmwatch_harbor.blend --context TERRAIN.json
  blender wyrmwatch_harbor.blend --python scripts/assets/wyrmwatch_harbor/open_harbor.py

Shows the harbor on the game's own terrain with the pier, the route marker, the ferry at the
berth and player-scale figures, in Material Preview. Nothing else runs: the timer only sets
the shading and frames the view once the window exists.
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
                root = bpy.data.objects.get('WyrmwatchHarbor_ROOT')
                picks = []
                if root is not None:
                    picks = [o for o in root.children if not o.name.startswith('PathStone')]
                for obj in picks:
                    if obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='RIGHT')
                bpy.ops.view3d.view_orbit(angle=0.55, type='ORBITLEFT')
                bpy.ops.view3d.view_orbit(angle=0.35, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
