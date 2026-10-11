"""Open the saved Eastbrook ferry review scene in the Blender window, framed and shaded.

  blender --background --python scripts/assets/eastbrook_ferry/build_eastbrook_ferry.py -- \
      --save eastbrook_ferry.blend --collision ferry_collision.json
  blender eastbrook_ferry.blend --python scripts/assets/eastbrook_ferry/open_ferry.py

Shows the full-detail ship (LOD0) with the preview water, sky, pier and player-scale
figures; the reduced LODs and the sim's collision boxes stay in their own collections,
hidden, for the outliner. Press space to play the idle clip (bob, sails, flags).
"""
import bpy


def start():
    scene = bpy.context.scene
    scene.frame_set(0)
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
                root = bpy.data.objects.get('TransportShip_ROOT')
                if root is not None:
                    for o in [root] + list(root.children_recursive):
                        if o.visible_get():
                            o.select_set(True)
                bpy.ops.view3d.view_selected()
                bpy.ops.view3d.view_axis(type='RIGHT')
                bpy.ops.view3d.view_orbit(angle=0.55, type='ORBITLEFT')
                bpy.ops.view3d.view_orbit(angle=0.3, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
