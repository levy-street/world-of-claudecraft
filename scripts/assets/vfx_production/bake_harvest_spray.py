"""Author the receiving spray for Red Harvest, separate from its blade membrane.

Blender 5.2 --background --python this.py -- --output-dir tmp/harvest-spray
Deterministic torn surfaces and ballistic streaks, not a fluid simulation.
64 straight-alpha frames; centred emission pivot; no baked bloom or AI imagery.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output_dir).resolve()
frames = output / 'frames'
frames.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 2
scene.cycles.transparent_max_bounces = 12
scene.render.resolution_x = scene.render.resolution_y = 248
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world.color = (0, 0, 0)
scene.frame_start, scene.frame_end = 1, 64
bpy.ops.object.camera_add(location=(0, -12, 0))
camera = bpy.context.object
camera.rotation_euler = Vector((0, 1, 0)).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 8
scene.camera = camera

materials = []
for name, colour, opacity in [
    ('Scarlet torn film', (.44, .008, .023), .72),
    ('Burgundy fibres', (.15, .002, .01), .88),
    ('Thin red veil', (.32, .004, .017), .42),
]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    mix = nodes.new('ShaderNodeMixShader')
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs[0].default_value = (*colour, 1)
    mix.inputs[0].default_value = opacity
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    materials.append(mat)

rng = random.Random(17092026)
strands = []
for index in range(140):
    sheet = index < 9
    columns, rows = (28, 4) if sheet else (5, 1)
    verts = [(0, 0, 0)] * ((columns + 1) * (rows + 1))
    faces = []
    for i in range(columns):
        for j in range(rows):
            # Long irregular holes and broken trailing edges are actual geometry.
            if sheet and j > 0 and rng.random() < .20 + j * .09:
                continue
            n = i * (rows + 1) + j
            faces.append((n, n + 1, n + rows + 2, n + rows + 1))
    mesh = bpy.data.meshes.new('Torn membrane' if sheet else 'Detached streak')
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new('%s %03d' % (mesh.name, index), mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(materials[index % 3])
    angle = rng.uniform(-.58, .62)
    if index % 5 == 0:
        angle += math.pi
    speed = rng.uniform(1.1, 3.65) * (.7 if index % 5 == 0 else 1)
    width = rng.uniform(.14, .36) if sheet else rng.uniform(.008, .027)
    delay = rng.uniform(0, .10) if sheet else rng.uniform(0, .22)
    strands.append((obj, columns, rows, angle, speed, width, delay, sheet, rng.random()))

def pose(frame):
    t = (frame - 1) / 63
    for obj, columns, rows, angle, speed, width, delay, sheet, seed in strands:
        age = max(0, (t - delay) / (1 - delay))
        travel = 1 - (1 - age) ** 2
        head = speed * travel
        tail = head * (max(0, (age - .12) / .88) if sheet else .80 + seed * .13)
        fade = min(1, age / .055) * max(0, 1 - age) ** .6
        if frame in (1, 64) or t <= delay:
            fade = 0
        for i in range(columns + 1):
            u = i / columns
            along = tail + (head - tail) * u
            taper = math.sin(math.pi * u) ** .55
            flutter = .78 + .15 * math.sin(u * 39 + seed * 7) + .07 * math.sin(u * 89)
            for j in range(rows + 1):
                v = j / rows - .5
                across = v * width * taper * flutter * fade
                x = math.cos(angle) * along - math.sin(angle) * across
                z = math.sin(angle) * along + math.cos(angle) * across - age * age * .32
                y = seed * .16 + math.sin(u * 8 + seed * 17) * width * .18
                if fade == 0:
                    x = y = z = 0
                obj.data.vertices[i * (rows + 1) + j].co = (x, y, z)
        obj.data.update()

pose(19)
scene['authoring'] = 'Original torn sheets and directional ballistic flecks; rerun script to render animation'
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'harvest_spray.blend'))
rendered = []
for frame in ([5, 14, 29, 48] if args.preview else range(1, 65)):
    pose(frame)
    scene.render.filepath = str(frames / ('%03d.png' % frame))
    bpy.ops.render.render(write_still=True)
    rendered.append(frame)
    print('HARVEST_SPRAY_FRAME', frame, flush=True)
(output / 'metadata.json').write_text(json.dumps({
    'frames': 64, 'grid': [8, 8], 'content_px': 248, 'gutter_px': 4,
    'alpha': 'straight', 'pivot': [.5, .5], 'source': 'Blender authored directional spray',
    'baked_bloom': False, 'rendered_frames': rendered,
}, indent=2))
