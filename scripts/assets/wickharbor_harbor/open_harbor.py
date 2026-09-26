"""Open the saved Wickharbor harbor review scene in the Blender window, framed and shaded.

  npx tsx scripts/assets/wickharbor_harbor/layout.ts --context CONTEXT.json
  blender --background --python scripts/assets/wickharbor_harbor/build_wickharbor_harbor.py -- \
      --save puerto_wickharbor.blend --context CONTEXT.json
  blender puerto_wickharbor.blend --python scripts/assets/wickharbor_harbor/open_harbor.py

Shows the whole harbor on the game's own terrain with the ferry wharf beside it and player-scale
figures on every deck, in Material Preview. Nothing else runs: the timer only sets
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
                root = bpy.data.objects.get('WickharborHarbor_ROOT')
                for obj in (root.children if root is not None else []):
                    if obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='TOP')
                bpy.ops.view3d.view_orbit(angle=0.9, type='ORBITDOWN')
                bpy.ops.view3d.view_orbit(angle=0.5, type='ORBITLEFT')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
