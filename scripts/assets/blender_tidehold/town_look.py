# Offscreen look shots of whatever is in the open Blender GUI, from a chosen
# eye -> target, in Material Preview shading (and point the live viewport
# there too, so SPACEY sees the same angle). Prepend globals:
#   SHOTS = [(abs_png, (ex, ey, ez), (tx, ty, tz), fov), ...]
import math
import traceback
LOG = []
try:
    import bpy
    import gpu
    from mathutils import Matrix, Vector

    def win_ov():
        win = bpy.context.window_manager.windows[0]
        area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
        region = next(r for r in area.regions if r.type == 'WINDOW')
        return win, area, region

    def look_at(eye, target):
        eye = Vector(eye)
        fwd = (Vector(target) - eye).normalized()
        right = fwd.cross(Vector((0, 0, 1)))
        if right.length < 1e-6:
            right = Vector((1, 0, 0))
        right.normalize()
        up = right.cross(fwd)
        m = Matrix.Identity(4)
        m.col[0][:3] = right
        m.col[1][:3] = up
        m.col[2][:3] = -fwd
        m.col[3][:3] = eye
        return m

    def persp(fov, aspect, near=0.1, far=3000.0):
        f = 1.0 / math.tan(math.radians(fov) / 2.0)
        m = Matrix.Identity(4)
        m[0][0] = f / aspect
        m[1][1] = f
        m[2][2] = (far + near) / (near - far)
        m[2][3] = (2 * far * near) / (near - far)
        m[3][2] = -1.0
        m[3][3] = 0.0
        return m

    win, area, region = win_ov()
    space = area.spaces.active
    space.shading.type = 'MATERIAL'
    space.overlay.show_overlays = False
    bpy.context.view_layer.update()
    bpy.context.evaluated_depsgraph_get()
    W, H = 1400, 880
    for (out, eye, target, fov) in SHOTS:
        view = look_at(eye, target).inverted()
        proj = persp(fov, W / H)
        off = gpu.types.GPUOffScreen(W, H)
        off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, region, view, proj,
                        do_color_management=True)
        buf = off.texture_color.read()
        buf.dimensions = W * H * 4
        img = bpy.data.images.get('town_look') or bpy.data.images.new('town_look', W, H, alpha=True)
        if img.size[0] != W:
            img.scale(W, H)
        img.pixels.foreach_set([v / 255.0 if isinstance(v, int) else v for v in buf])
        img.filepath_raw = out
        img.file_format = 'PNG'
        img.save()
        off.free()
        LOG.append('shot ' + out)
    # leave the live viewport on the last angle
    (out, eye, target, fov) = SHOTS[-1]
    r3d = space.region_3d
    r3d.view_location = Vector(target)
    d = Vector(eye) - Vector(target)
    r3d.view_distance = d.length
    r3d.view_rotation = look_at(eye, target).to_quaternion()
    space.overlay.show_overlays = True
    area.tag_redraw()
except Exception:
    LOG.append(traceback.format_exc())
print('\n'.join(LOG))
