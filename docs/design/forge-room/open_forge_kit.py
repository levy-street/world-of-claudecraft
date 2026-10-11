"""Open the laid-out forge kit in the Blender window, shaded as the game draws it.

  blender --background --python docs/design/forge-room/preview.py -- --save kit.blend
  blender kit.blend --python docs/design/forge-room/open_forge_kit.py
"""
import bpy


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
                bpy.ops.view3d.view_orbit(angle=0.35, type='ORBITUP')
                bpy.ops.object.select_all(action='DESELECT')
                for o in bpy.context.scene.objects:
                    if o.name.startswith('Kit_'):
                        o.select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
