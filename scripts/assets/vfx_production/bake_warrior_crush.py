"""Original shield compression, folded blunt plates and unequal falling chips.

Blender 5.2 --background --python scripts/assets/vfx_production/bake_warrior_crush.py
  -- --output-dir tmp/warrior-crush [--preview]
No simulations, generated imagery, character models or external source assets.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.output_dir).resolve()
(out / 'frames').mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 3
scene.cycles.transparent_max_bounces = 8
scene.cycles.seed = 2147
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.render.resolution_x = scene.render.resolution_y = 496
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.view_transform = 'Standard'
scene.world.color = (.13, .15, .18)
scene.frame_start, scene.frame_end = 1, 64

bpy.ops.object.camera_add(location=(0, -15, 0))
camera = bpy.context.object
camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 8.2
scene.camera = camera
for position, power, size in [((-3, -5, 4), 680, 3), ((3, -4, 1), 420, 2), ((0, 1, 4), 850, 2)]:
    bpy.ops.object.light_add(type='AREA', location=position)
    lamp = bpy.context.object
    lamp.data.energy = power
    lamp.data.size = size
    lamp.rotation_euler = (-lamp.location).to_track_quat('-Z', 'Y').to_euler()


def h(index, salt=0):
    return (math.sin(index * 127.1 + salt * 19.17 + 3.7) * 43758.5453) % 1


fades = []


def material(name, color, metal, roughness, emission, role):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    principled = nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = (*color, 1)
    principled.inputs['Metallic'].default_value = metal
    principled.inputs['Roughness'].default_value = roughness
    principled.inputs['Emission Color'].default_value = (*color, 1)
    principled.inputs['Emission Strength'].default_value = emission
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 48
    noise.inputs['Detail'].default_value = 2
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .15
    bump.inputs['Distance'].default_value = .012
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], principled.inputs['Normal'])
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(principled.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes.get('Material Output').inputs['Surface'])
    fades.append((mix.inputs[0], role))
    return mat


plate_materials = [
    material('Dark fractured bevel', (.026, .037, .049), .72, .36, .03, 'plate'),
    material('Cold silver face', (.18, .23, .28), .83, .32, .035, 'plate'),
    material('Folded steel highlight', (.34, .41, .48), .76, .26, .06, 'plate'),
]
chip_materials = [
    material('Chip dark edge', (.045, .065, .082), .7, .35, .04, 'chip'),
    material('Chip silver face', (.48, .58, .67), .78, .24, .19, 'chip'),
    material('Chip cold glint', (.7, .79, .86), .64, .2, .27, 'chip'),
]
seed_materials = [
    material('Short contact bevel', (.13, .19, .25), .6, .28, .15, 'seed'),
    material('Short contact face', (.65, .76, .85), .5, .22, 1.2, 'seed'),
    material('Short contact glint', (.84, .92, 1), .3, .2, 2, 'seed'),
]
objects = []


def folded_plate(name, index, width, height, materials, role):
    # A blunt asymmetric six-sided plate, its inset face folded across a ridge.
    # Explicit dark bevel faces keep separation visible in the small atlas cells.
    outline = [(-.52, -.25), (-.4, .46), (.13, .53), (.52, .2), (.39, -.43), (-.12, -.49)]
    points = [(x * width * (1 + (h(index + k, 2) - .5) * .22),
               z * height * (1 + (h(index + k, 7) - .5) * .24))
              for k, (x, z) in enumerate(outline)]
    depth = min(width, height) * .12
    vertices = [(x, depth * .2, z) for x, z in points]
    vertices += [(x * .9, -depth * (.4 + .3 * (k % 2)), z * .9)
                 for k, (x, z) in enumerate(points)]
    vertices.append((width * .04, -depth, height * .06))
    faces = []
    face_materials = []
    for k in range(6):
        nxt = (k + 1) % 6
        faces.append((k, nxt, nxt + 6, k + 6))
        face_materials.append(0)
        faces.append((k + 6, nxt + 6, 12))
        face_materials.append(2 if k in (1, 2) else 1)
    faces.append(tuple(reversed(range(6))))
    face_materials.append(0)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for mat in materials:
        mesh.materials.append(mat)
    for polygon, material_index in zip(mesh.polygons, face_materials):
        polygon.material_index = material_index
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    objects.append((obj, role, index))
    return obj


for i in range(18):
    folded_plate('Blunt shoulder plate ' + str(i), i,
                 (.2 + h(i, 1) * .18) if i < 4 else (.12 + h(i, 1) * .18),
                 .09 + h(i, 4) * .15, plate_materials, 'plate')
for i in range(90):
    folded_plate('Unequal tumbling chip ' + str(i), i + 31,
                 .025 + h(i, 3) * .095, .021 + h(i, 8) * .07, chip_materials, 'chip')
folded_plate('Compressed contact seed', 113, .46, .22, seed_materials, 'seed')


def animate(t):
    for socket, role in fades:
        if role == 'seed':
            alpha = max(0, 1 - t / .13) ** 1.5
        elif role == 'plate':
            alpha = max(0, 1 - max(0, t - .24) / .76) ** .7
        else:
            alpha = max(0, 1 - t) ** .65
        socket.default_value = alpha
    for obj, role, i in objects:
        obj.hide_render = t <= 0 or t >= 1
        if role == 'seed':
            gain = min(1, t / .022) * max(0, 1 - t / .13)
            obj.location = (0, -.22, 0)
            obj.scale = (gain, gain, gain)
            continue
        side = 1 if i % 2 else -1
        launch = max(0, t - h(i, 11) * (.012 if role == 'plate' else .035))
        kick = 1 - math.exp(-launch * (13 if role == 'plate' else 11))
        gain = min(1, launch / .024)
        if role == 'plate':
            # Two broad fractured shoulders recoil sideways and away from camera.
            # Height is independent of travel: these are plates, not radial rays.
            travel = (.68 + h(i, 5) * 1.75) * kick + launch * .16
            rise = (-.25 + h(i, 6) * 1.1) * kick
            obj.location = (side * travel, .06 + launch * (.4 + h(i, 9) * .8),
                            rise - launch * launch * (.55 + h(i, 10) * .7))
            obj.rotation_euler = (
                (h(i, 3) - .5) * .5 + launch * (h(i, 4) - .5) * 2.4,
                side * (.12 + h(i, 2) * .48) + launch * (h(i, 8) - .5) * 3.1,
                (h(i, 1) - .5) * .5 + launch * (h(i, 12) - .5) * 2.2,
            )
        else:
            travel = (.25 + h(i, 4) * 2.6) * kick + launch * .12
            rise = (h(i, 7) - .37) * 2.55 * kick
            obj.location = (side * travel, -.15 + launch * (h(i, 1) * 1.3),
                            rise - launch * launch * (1.05 + h(i, 9) * .7))
            obj.rotation_euler = (
                h(i, 5) * 2 + launch * (h(i, 8) - .5) * 13,
                h(i, 6) * 2 + launch * (h(i, 3) - .5) * 17,
                h(i, 2) * 2 + launch * (h(i, 10) - .5) * 11,
            )
        obj.scale = (gain, gain, gain)


rendered = [1, 7, 15, 27, 43, 64] if args.preview else list(range(1, 65))
for frame in rendered:
    scene.frame_set(frame)
    animate((frame - 1) / 63)
    scene.render.filepath = str(out / 'frames' / f'{frame:03d}.png')
    bpy.ops.render.render(write_still=True)
animate(.12)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'warrior_crush.blend'))
metadata = {
    'frames': 64, 'grid': [8, 8], 'frame_size': 496, 'gutter': 8, 'camera_span': 8.2,
    'provenance': 'Original Blender-authored folded geometry and material animation',
    'style': 'Paired fractured compression shoulders, 18 blunt folded steel plates, '
             '90 unequal tumbling chips, dark bevels, tiny early-expiring contact seed',
    'renderer': {'engine': 'CYCLES', 'device': 'CPU', 'samples': 16, 'threads': 4},
    'rendered_frames': rendered,
    'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'frame_sha256': {str(frame): hashlib.sha256(
        (out / 'frames' / f'{frame:03d}.png').read_bytes()).hexdigest() for frame in rendered},
}
(out / 'metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
