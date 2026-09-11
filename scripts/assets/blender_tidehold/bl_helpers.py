# Shared helpers for bridge scripts. Loaded with:
#   exec(open('/private/tmp/claude-501/-Users-troy-Documents-Codex/cbf8046f-7d43-48f1-b70b-3b602edd9a6d/scratchpad/bl_helpers.py').read())
import math

import bpy
from mathutils import Matrix, Vector

PACK = '/Users/troy/Documents/woc/carve/public/models/medieval_village_v2'


def win_override():
    win = bpy.context.window_manager.windows[0]
    scr = win.screen
    area = next(a for a in scr.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    return dict(window=win, screen=scr, area=area, region=region)


def import_glb(path):
    """Import a GLB, return the set of new top-level objects."""
    before = set(bpy.data.objects)
    ov = win_override()
    with bpy.context.temp_override(**ov):
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return new


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.actions):
        for x in list(coll):
            if x.users == 0:
                coll.remove(x)


def look_at_matrix(eye, target):
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
    m.col[2][:3] = (-fwd)
    m.col[3][:3] = eye
    return m


def persp_matrix(fov_deg, aspect, near=0.1, far=2000.0):
    f = 1.0 / math.tan(math.radians(fov_deg) / 2.0)
    m = Matrix.Identity(4)
    m[0][0] = f / aspect
    m[1][1] = f
    m[2][2] = (far + near) / (near - far)
    m[2][3] = (2 * far * near) / (near - far)
    m[3][2] = -1.0
    m[3][3] = 0.0
    return m


def render_shot(out_png, eye, target, w=1600, h=1000, fov=45, shading='RENDERED'):
    """Offscreen render of the current scene from eye->target. ABSOLUTE path."""
    import gpu

    bpy.context.view_layer.update()
    bpy.context.evaluated_depsgraph_get()
    ov = win_override()
    space = next(s for s in ov['area'].spaces if s.type == 'VIEW_3D')
    prev_shading = space.shading.type
    space.shading.type = shading
    view = look_at_matrix(eye, target).inverted()
    proj = persp_matrix(fov, w / h)
    off = gpu.types.GPUOffScreen(w, h)
    try:
        off.draw_view3d(
            bpy.context.scene,
            bpy.context.view_layer,
            space,
            ov['region'],
            view,
            proj,
            do_color_management=True,
        )
        buf = off.texture_color.read()
        buf.dimensions = w * h * 4
        img = bpy.data.images.new('shot', w, h, alpha=True)
        img.pixels.foreach_set([v / 255 for v in buf])
        img.filepath_raw = out_png
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
    finally:
        off.free()
        space.shading.type = prev_shading


def ensure_sun():
    if 'ShotSun' not in bpy.data.objects:
        sun = bpy.data.objects.new('ShotSun', bpy.data.lights.new('ShotSun', 'SUN'))
        sun.data.energy = 3.0
        sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
        bpy.context.scene.collection.objects.link(sun)
    w = bpy.context.scene.world or bpy.data.worlds.new('ShotWorld')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.75, 0.8, 0.9, 1)
        bg.inputs[1].default_value = 0.8
