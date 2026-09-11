# Renders the trunk row that build_trunks.py (run with a `KEEP = True` line
# prepended) left standing, so the six foundation trunks can be eyeballed
# without opening the editor.
#
# The Blender window here is not composited, so the viewport never redraws and
# every ops-based render comes back empty or stale. The reliable path is to draw
# a GPUOffScreen ourselves with matrices we build (see the BlenderMCP notes):
# view = inverse of the camera's world matrix, projection hand-rolled.

import math
import os
import traceback

import bpy
import gpu
from mathutils import Matrix, Vector

OUT = "/Users/troy/Documents/woc/dryrun/tmp/trunks_shot.png"
W, H = 1800, 700
log = []


def look_at(eye, target, up=Vector((0.0, 0.0, 1.0))):
    f = (target - eye).normalized()
    r = f.cross(up).normalized()
    u = r.cross(f).normalized()
    m = Matrix.Identity(4)
    m[0][0], m[0][1], m[0][2] = r.x, r.y, r.z
    m[1][0], m[1][1], m[1][2] = u.x, u.y, u.z
    m[2][0], m[2][1], m[2][2] = -f.x, -f.y, -f.z
    m[0][3] = -r.dot(eye)
    m[1][3] = -u.dot(eye)
    m[2][3] = f.dot(eye)
    return m


def ortho(half_w, half_h, near, far):
    m = Matrix.Identity(4)
    m[0][0] = 1.0 / half_w
    m[1][1] = 1.0 / half_h
    m[2][2] = -2.0 / (far - near)
    m[2][3] = -(far + near) / (far - near)
    return m


def main():
    coll = bpy.data.collections.get("_woc_trunk_build")
    if not coll:
        log.append("no _woc_trunk_build collection - run build_trunks.py with KEEP first")
        return
    objs = list(coll.objects)
    log.append(f"{len(objs)} objects: {[o.name for o in objs]}")

    win = bpy.context.window_manager.windows[0]
    scr = win.screen
    area = next((a for a in scr.areas if a.type == "VIEW_3D"), None)
    if not area:
        log.append("no VIEW_3D area")
        return
    space = area.spaces.active
    region = next((r for r in area.regions if r.type == "WINDOW"), None)

    xs = [o.location.x for o in objs]
    center = Vector(((min(xs) + max(xs)) / 2.0, 0.0, 6.5))
    eye = center + Vector((0.0, -60.0, 2.0))
    view = look_at(eye, center)
    half_h = 11.5
    proj = ortho(half_h * (W / H), half_h, 0.1, 400.0)

    prev_shading = space.shading.type
    prev_light = space.shading.light
    prev_color = space.shading.color_type
    space.shading.type = "SOLID"
    space.shading.light = "MATCAP"
    space.shading.color_type = "OBJECT"
    bpy.context.view_layer.update()
    bpy.context.evaluated_depsgraph_get()

    offs = gpu.types.GPUOffScreen(W, H)
    try:
        offs.draw_view3d(
            bpy.context.scene,
            bpy.context.view_layer,
            space,
            region,
            view,
            proj,
            do_color_management=True,
        )
        buf = offs.texture_color.read()
        buf.dimensions = W * H * 4
    finally:
        offs.free()
        space.shading.type = prev_shading
        space.shading.light = prev_light
        space.shading.color_type = prev_color

    img = bpy.data.images.get("_trunk_shot")
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("_trunk_shot", W, H, alpha=True)
    img.pixels.foreach_set([v / 255.0 for v in buf])
    img.filepath_raw = OUT
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    log.append(f"wrote {OUT}")


try:
    main()
except Exception:
    log.append(traceback.format_exc())
print("\n".join(log))
