"""The Smith's Quarry as the game places it, for review in Blender.

Two steps (the second opens a window on the saved scene, no splash):
  1. blender -b --factory-startup --python open_quarry_in_blender.py -- \
         --scene tmp/smith_heart_hammer_scene.json --save tmp/smith_heart_quarry.blend [--render out.png]
     (the JSON from: npx tsx scripts/smith_heart_hammer_scene_export.ts tmp/smith_heart_hammer_scene.json)
  2. blender tmp/smith_heart_quarry.blend --python open_quarry_in_blender.py
     (sets the viewport to Material Preview, frames the quarry from the pit's
     descent, as the raid first sees it)

The kit comes from smith_heart_hammer_kit_components.glb (built by
build_smith_heart_hammer_kit.py); every piece is linked once per placement
(shared mesh data). The floors are a height grid of the walked field. Game
(x, y, z) is Blender (x, -z, y); a placement's yaw turns the piece's front
(Blender -Y) to the game heading. A 2 yd blue figure stands on the pit floor
for scale.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, 'smith_heart_hammer_kit_components.glb')


def arg(flag):
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return argv[argv.index(flag) + 1] if flag in argv else None


def g2b(x, y, z):
    return Vector((x, -z, y))


def material(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def build(scene_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=KIT)
    kit = {o.name: o for o in bpy.data.objects if o not in before and o.name.startswith('Kit_')}
    for o in list(bpy.data.objects):
        if o not in before:
            o.hide_set(True) if o.name.startswith('Kit_') else None
            o.hide_render = True
    # The glow slot as the game draws it: the vein's light, never white.
    glow = bpy.data.materials.get('KitGlow')
    if glow and glow.use_nodes:
        b = glow.node_tree.nodes.get('Principled BSDF')
        if b:
            b.inputs['Emission Strength'].default_value = 1.2
    data = json.load(open(scene_path))
    coll = bpy.data.collections.new('SmithsQuarry')
    bpy.context.scene.collection.children.link(coll)
    for i, p in enumerate(data['placements']):
        src = kit.get(p['piece'])
        if not src:
            continue
        o = src.copy()
        o.name = f"{p['piece']}.{i:03d}"
        o.parent = None
        o.location = g2b(p['x'], p['y'], p['z'])
        o.rotation_mode = 'XYZ'
        o.rotation_euler = (0, 0, p['rot'])
        s = p.get('scale', 1)
        o.scale = (s * p.get('stretch', 1), s, s)
        o.hide_render = False
        coll.objects.link(o)
    # The walked floors.
    g = data['grid']
    rows = g['heights']
    verts, faces, index = [], [], {}
    for j, row in enumerate(rows):
        for i, h in enumerate(row):
            if h is None:
                continue
            index[(i, j)] = len(verts)
            verts.append(g2b(g['x0'] + i * g['step'], h, g['z0'] + j * g['step']))
    for (i, j), a in index.items():
        b, c, d = index.get((i + 1, j)), index.get((i + 1, j + 1)), index.get((i, j + 1))
        if None not in (b, c, d):
            zs = [verts[k].z for k in (a, b, c, d)]
            # A quad across a step's riser is not floor (the kit draws it).
            if max(zs) - min(zs) < 1.5:
                faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new('QuarryFloor')
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    floor = bpy.data.objects.new('QuarryFloor', mesh)
    floor.data.materials.append(material('Bedrock', (0.3, 0.3, 0.31)))
    coll.objects.link(floor)
    # Scale figure on the pit floor.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=2.0, location=tuple(g2b(-6, 15, -172)))
    fig = bpy.context.view_layer.objects.active
    fig.name = 'ScaleFigure_2yd'
    fig.data.materials.append(material('Figure', (0.1, 0.25, 0.6), 0.5))
    # The quarry's dusk (phase 2C): a warm low key from the south-west, a cool
    # slate-violet sky fill.
    world = bpy.data.worlds.new('QuarryDusk')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.3, 0.3, 0.36, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    bpy.context.scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.6
    sun.data.color = (1.0, 0.83, 0.63)
    d = g2b(-0.5, 0.62, -0.6).normalized()
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.lens = 24
    cam.data.clip_end = 2000
    cam.location = g2b(-46, 36, -186)
    look = g2b(30, 26, -180)
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'Standard'
    return cam


def frame_viewport():
    """On opening: Material Preview, looking through the scene camera."""
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'MATERIAL'
                    space.clip_end = 2000
                    space.region_3d.view_perspective = 'CAMERA'
    return None


def main():
    scene_path = arg('--scene')
    if scene_path:
        build(scene_path)
        out = arg('--render')
        if out:
            bpy.context.scene.render.resolution_x = 1600
            bpy.context.scene.render.resolution_y = 900
            bpy.context.scene.render.filepath = out
            bpy.ops.render.render(write_still=True)
        save = arg('--save')
        if save:
            bpy.ops.wm.save_as_mainfile(filepath=save)
    else:
        bpy.app.timers.register(frame_viewport, first_interval=1.0)


if __name__ == '__main__':
    main()
