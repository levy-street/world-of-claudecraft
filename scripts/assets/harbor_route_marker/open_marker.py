"""Open the saved harbor route marker review scene in the Blender window, framed and shaded.

  blender --background --python scripts/assets/harbor_route_marker/build_harbor_route_marker.py -- \
      --save harbor_route_marker.blend
  blender harbor_route_marker.blend --python scripts/assets/harbor_route_marker/open_marker.py

Shows the exported sign pointing right with a sample destination, its turned instance pointing
left with another, and a player-scale figure beside each, in Material Preview. Nothing else
runs: the timer only sets the shading and frames the view once the window exists.
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
            space.clip_end = 1000
            region = next(r for r in area.regions if r.type == 'WINDOW')
            with bpy.context.temp_override(window=window, area=area, region=region):
                bpy.ops.object.select_all(action='DESELECT')
                picks = []
                root = bpy.data.objects.get('HarborRouteMarker_ROOT')
                if root is not None:
                    picks += [root] + list(root.children_recursive)
                for name in ('HarborRouteMarker_LeftCopy', 'PlayerReference_2p6yd_body',
                             'PlayerReference_2p6yd_Left_body'):
                    obj = bpy.data.objects.get(name)
                    if obj is not None:
                        picks.append(obj)
                for obj in picks:
                    if obj.visible_get():
                        obj.select_set(True)
                bpy.ops.view3d.view_axis(type='FRONT')
                bpy.ops.view3d.view_orbit(angle=0.35, type='ORBITRIGHT')
                bpy.ops.view3d.view_orbit(angle=0.12, type='ORBITUP')
                bpy.ops.view3d.view_selected()
                bpy.ops.object.select_all(action='DESELECT')
            return None
    return None


if not bpy.app.background:
    bpy.app.timers.register(start, first_interval=1.0)
