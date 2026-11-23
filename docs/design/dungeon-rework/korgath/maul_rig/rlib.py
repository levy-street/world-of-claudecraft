"""Render helpers for the Korgath AAA pass (Blender 5.2, background)."""
import os
import bpy, math, os
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, '..', '..', '..', '..', '..', 'tmp', 'korgath_aaa')

BODY_TEX = os.path.join(TMP, 'korgath_tex.glb')


def reset(fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = fps


def load_body(path=BODY_TEX):
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        for l in nt.links:
            if l.to_socket == bsdf.inputs['Base Color'] and l.from_node.type == 'TEX_IMAGE':
                nt.nodes.active = l.from_node
            elif l.to_socket == bsdf.inputs['Base Color']:
                # walk back one node (a mix/multiply) to the image
                for l2 in nt.links:
                    if l2.to_node == l.from_node and l2.from_node.type == 'TEX_IMAGE':
                        nt.nodes.active = l2.from_node
    return arm


def import_actions(path, suffix):
    """Import a clip GLB, rename its actions with a suffix, delete its objects."""
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [a for a in bpy.data.actions if a not in acts_before]
    for a in new:
        import re
        a.name = re.sub(r'\.\d+$', '', a.name.split('_Korgath')[0]) + suffix
        a.use_fake_user = True
    for o in set(bpy.data.objects) - before:
        bpy.data.objects.remove(o, do_unlink=True)
    return new


def use_action(arm, act):
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    try:
        if act.slots and ad.action_slot is None:
            ad.action_slot = act.slots[0]
        elif act.slots and ad.action_slot not in list(act.slots):
            ad.action_slot = act.slots[0]
    except AttributeError:
        pass


def setup_bench(res=(1000, 1000), bg=(0.16, 0.17, 0.2)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.background_type = 'VIEWPORT'
    sh.background_color = bg
    sc.display.light_direction = (0.4, -0.5, 0.75)


def floor(size=60, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    fl = bpy.context.active_object
    fl.name = 'ReviewFloor'
    m = bpy.data.materials.new('ReviewFloorM')
    m.diffuse_color = (0.22, 0.25, 0.3, 1)
    fl.data.materials.append(m)
    return fl


def camera(name, loc, target, lens=35):
    d = bpy.data.cameras.new(name)
    d.lens = lens
    d.clip_start = 0.05
    d.clip_end = 1000
    c = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(c)
    c.location = Vector(loc)
    dirv = Vector(target) - c.location
    c.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
    return c


def render(cam, path):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


def bone_pos(arm, name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


# Standard views around the body (he faces -Y in Blender, his left is +X).
VIEWS = {
    'frente': (Vector((0, -1, 0.18)), 1.0),
    'lado': (Vector((1, 0, 0.12)), 1.0),
    'lado_der': (Vector((-1, 0, 0.12)), 1.0),
    'tres_cuartos': (Vector((0.75, -0.75, 0.3)), 1.0),
    'tres_cuartos_der': (Vector((-0.75, -0.75, 0.3)), 1.0),
}


def view_cam(name, view, target, dist, lens=35):
    d, _ = VIEWS[view]
    return camera(name, Vector(target) + d.normalized() * dist, target, lens)


def contact_sheet(paths, out, cols, cell=400, labels=None):
    """Compose PNGs into one sheet with Blender's image API (no PIL)."""
    imgs = [bpy.data.images.load(p) for p in paths]
    rows = (len(imgs) + cols - 1) // cols
    W, H = cols * cell, rows * cell
    sheet = bpy.data.images.new('sheet', W, H, alpha=False)
    px = [0.1] * (W * H * 4)
    import array
    buf = array.array('f', px)
    for i, im in enumerate(imgs):
        iw, ih = im.size
        src = array.array('f', [0.0] * (iw * ih * 4))
        im.pixels.foreach_get(src)
        c, r = i % cols, rows - 1 - i // cols
        for y in range(cell):
            sy = int(y * ih / cell)
            row_base = ((r * cell + y) * W + c * cell) * 4
            srow = sy * iw * 4
            for x in range(cell):
                sx = int(x * iw / cell) * 4
                o = row_base + x * 4
                buf[o:o + 4] = src[srow + sx:srow + sx + 4]
    sheet.pixels.foreach_set(buf)
    sheet.filepath_raw = out
    sheet.file_format = 'PNG'
    sheet.save()
    print('SHEET', out)
