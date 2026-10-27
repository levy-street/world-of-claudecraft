"""The Ring and the heart seal as the game places them, for review in Blender
(phase 2F).

Two steps (the second opens a window on the saved scene, no splash):
  1. blender -b --factory-startup --python open_ring_in_blender.py -- \
         --scene tmp/smith_heart_ring_scene.json --save tmp/smith_heart_ring.blend \
         [--render out.png] [--render-seal out.png]
     (the JSON from: npx tsx scripts/smith_heart_ring_scene_export.ts tmp/smith_heart_ring_scene.json)
  2. blender tmp/smith_heart_ring.blend --python open_ring_in_blender.py
     (sets the viewport to Material Preview through the Balcony's camera)

The pieces come from smith_heart_ring_kit_components.glb and
smith_heart_rock_kit_components.glb (built by their build_*.py); every piece
is linked once per placement (shared mesh data), placed by the game's own
matrix (turned, stretched, risen and sheared as heart_kit.ts does). Game
(x, y, z) is Blender (x, -z, y). The seal's and the spires' crystal carries a
grey facet shade the game colours: here each takes its vein's colour, the
Hammer's and the Breath's lit, the other two dark. A 2 yd blue figure stands
on the dais for scale.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
KITS = {
    'ring': os.path.join(HERE, 'smith_heart_ring_kit_components.glb'),
    'rock': os.path.join(HERE, 'smith_heart_rock_kit_components.glb'),
}
# Game (x, y, z) to Blender (x, -z, y), and back.
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


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


def placement_matrix(p):
    """heart_kit.ts heartKitPlacementMatrix, in the game frame: T R Shear S."""
    s = p.get('scale', 1)
    S = Matrix.Diagonal((s * p.get('stretch', 1), s * p.get('rise', 1), s, 1))
    Sh = Matrix.Identity(4)
    Sh[1][0] = p.get('shear', 0) or 0
    R = Matrix.Rotation(p['rot'], 4, 'Y')
    T = Matrix.Translation((p['x'], p['y'], p['z']))
    return T @ R @ Sh @ S


def import_kit(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    out = {}
    for o in bpy.data.objects:
        if o in before:
            continue
        if o.name.startswith('Kit_'):
            out[o.name.split('.')[0]] = o
        o.hide_set(True)
        o.hide_render = True
    return out


def glow_material(base, rgb, lit):
    """The crystal in its vein's colour (lit: burning; dark: smoky)."""
    key = f'Crystal_{rgb[0]:.2f}_{rgb[1]:.2f}_{rgb[2]:.2f}_{int(lit)}'
    m = bpy.data.materials.get(key)
    if m:
        return m
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = ''  # the mesh's own (the glTF import names it)
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(col.outputs['Color'], mul.inputs[6])
    k = 1.0 if lit else 0.18
    mul.inputs[7].default_value = (rgb[0] * k, rgb[1] * k, rgb[2] * k, 1)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 3.0 if lit else 1.0
    nt.links.new(mul.outputs[2], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def hex_rgb(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)


def build(scene_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kits = {k: import_kit(v) for k, v in KITS.items()}
    for kit in kits.values():
        for o in kit.values():
            for slot in o.material_slots:
                m = slot.material
                if m and 'Glow' in m.name and m.use_nodes:
                    b = m.node_tree.nodes.get('Principled BSDF')
                    if b:
                        b.inputs['Emission Strength'].default_value = 1.4
    data = json.load(open(scene_path))
    coll = bpy.data.collections.new('TheRing')
    bpy.context.scene.collection.children.link(coll)
    for i, p in enumerate(data['placements']):
        src = kits[p['kit']].get(p['piece'])
        if not src:
            continue
        o = src.copy()
        o.name = f"{p['piece']}.{i:04d}"
        o.parent = None
        o.matrix_world = C @ placement_matrix(p) @ CI
        o.hide_render = False
        if 'tint' in p:
            # The crystal slot in its vein's colour (a copy of the mesh's
            # slots per object: the mesh data stays shared).
            for k, slot in enumerate(o.material_slots):
                if slot.material and 'Glow' in slot.material.name:
                    slot.link = 'OBJECT'
                    slot.material = glow_material(slot.material, hex_rgb(p['tint']), p.get('lit', False))
        coll.objects.link(o)
    # The walked floors (the Balcony's and the veins' walks the kit leaves).
    g = data['grid']
    rows = g['heights']
    verts, faces, index = [], [], {}
    for j, row in enumerate(rows):
        for i, h in enumerate(row):
            if h is None:
                continue
            index[(i, j)] = len(verts)
            verts.append(g2b(g['x0'] + i * g['step'], h - 0.03, g['z0'] + j * g['step']))
    for (i, j), a in index.items():
        b, c, d = index.get((i + 1, j)), index.get((i + 1, j + 1)), index.get((i, j + 1))
        if None not in (b, c, d):
            zs = [verts[k].z for k in (a, b, c, d)]
            if max(zs) - min(zs) < 1.5:
                faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new('WalkedFloors')
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    floor = bpy.data.objects.new('WalkedFloors', mesh)
    floor.data.materials.append(material('Paving', (0.36, 0.35, 0.34)))
    coll.objects.link(floor)
    # Scale figure on the dais.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=2.0, location=tuple(g2b(4, -3, -12)))
    fig = bpy.context.view_layer.objects.active
    fig.name = 'ScaleFigure_2yd'
    fig.data.materials.append(material('Figure', (0.1, 0.25, 0.6), 0.5))
    # The Ring's light (phase 2F): the low warm sun from the south-west, a
    # neutral grey sky fill.
    world = bpy.data.worlds.new('RingDusk')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.32, 0.36, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.75
    bpy.context.scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.4
    sun.data.color = (1.0, 0.85, 0.68)
    d = g2b(-0.42, 0.72, -0.55).normalized()
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(sun)
    cams = {}
    for name, at, look in (('Camera_Balcony', (0, 34, -96), (0, -2, 6)),
                           ('Camera_Seal', (16, 9, -24), (0, -1, 2))):
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        cam.data.lens = 22 if name == 'Camera_Balcony' else 26
        cam.data.clip_end = 3000
        cam.location = g2b(*at)
        cam.rotation_euler = (g2b(*look) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(cam)
        cams[name] = cam
    bpy.context.scene.camera = cams['Camera_Balcony']
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'Standard'
    for attr, value in (('taa_render_samples', 24), ('use_shadows', True)):
        try:
            setattr(sc.eevee, attr, value)
        except (AttributeError, TypeError):
            pass
    return cams


def frame_viewport():
    """On opening: Material Preview, looking through the scene camera."""
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'MATERIAL'
                    space.clip_end = 3000
                    space.region_3d.view_perspective = 'CAMERA'
    return None


def main():
    scene_path = arg('--scene')
    if scene_path:
        cams = build(scene_path)
        sc = bpy.context.scene
        sc.render.resolution_x = 1600
        sc.render.resolution_y = 900
        for flag, cam in (('--render', 'Camera_Balcony'), ('--render-seal', 'Camera_Seal')):
            out = arg(flag)
            if out:
                sc.camera = cams[cam]
                sc.render.filepath = out
                bpy.ops.render.render(write_still=True)
        sc.camera = cams['Camera_Balcony']
        save = arg('--save')
        if save:
            bpy.ops.wm.save_as_mainfile(filepath=save)
    else:
        bpy.app.timers.register(frame_viewport, first_interval=1.0)


if __name__ == '__main__':
    main()
