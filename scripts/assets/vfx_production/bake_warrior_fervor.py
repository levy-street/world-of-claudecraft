"""Original torn pressure fan for Warrior power activations, without smoke horns.
Blender --background --python this.py -- --output-dir tmp/warrior-fervor [--full]
Uses the existing power-sprite pivot, but authors thin open sheets and flecks.
No AI images, stock imagery, baked bloom, character mesh or gameplay simulation.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

p = argparse.ArgumentParser()
p.add_argument('--output-dir', required=True)
p.add_argument('--full', action='store_true')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(a.output_dir).resolve()
(out / 'frames').mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
s = bpy.context.scene
s.render.engine = 'CYCLES'
s.cycles.samples = 16
s.cycles.use_denoising = True
s.cycles.max_bounces = 3
s.render.resolution_x = s.render.resolution_y = 248
s.render.resolution_percentage = 100
s.render.film_transparent = True
s.render.image_settings.file_format = 'PNG'
s.render.image_settings.color_mode = 'RGBA'
s.view_settings.view_transform = 'Standard'
s.world.color = (.09, .09, .09)
bpy.ops.object.camera_add(location=(1.45, -12, .8))
camera = bpy.context.object
camera.rotation_euler = (Vector((1.45, 0, .8)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 5.6
s.camera = camera
for position, power, size in [((-2, -5, 4), 170, 3), ((3, -3, -1), 110, 2), ((2, 2, 3), 250, 2)]:
    bpy.ops.object.light_add(type='AREA', location=position)
    lamp = bpy.context.object
    lamp.data.energy, lamp.data.size = power, size
    lamp.rotation_euler = (Vector((1, 0, 0)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()

def material(name, value, emission):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    surface = nodes.get('Principled BSDF')
    surface.inputs['Base Color'].default_value = (value, value, value, 1)
    surface.inputs['Roughness'].default_value = .4
    surface.inputs['Metallic'].default_value = .2
    surface.inputs['Emission Color'].default_value = (value, value, value, 1)
    surface.inputs['Emission Strength'].default_value = emission
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 34
    noise.inputs['Detail'].default_value = 3
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .28
    bump.inputs['Distance'].default_value = .025
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs[0], surface.inputs['Normal'])
    # Broken translucency makes these passing pressure streaks, not solid spikes.
    opacity = nodes.new('ShaderNodeMath')
    opacity.operation = 'MULTIPLY'
    opacity.name = 'Lifetime opacity'
    links.new(noise.outputs['Fac'], opacity.inputs[0])
    opacity.inputs[1].default_value = 1.6
    links.new(opacity.outputs[0], surface.inputs['Alpha'])
    return mat

materials = [material('Dark pressure folds', .15, .04),
             material('Lit pressure skin', .32, .12),
             material('Short charged edges', .65, .3)]
objects = []
for index in range(34):
    verts, faces = [], []
    angle = math.sin(index * 2.399963) * .48
    reach = .32 + (index * 7 % 11) * .075
    start = .05 + (index % 8) * .24
    for step in range(21):
        u = step / 20
        r = start + u * reach
        # Shallow angular shear, never a curling horn or round smoke tube.
        bend = math.sin(u * 2.3 + index) * .08 * u
        broken = .62 + .38 * math.sin(step * 2.7 + index) ** 2
        width = (.018 + (index % 4) * .009) * math.sin(math.pi * u) ** .75 * broken
        for side in [-1, 1]:
            verts.append((math.cos(angle) * r - math.sin(angle) * (bend + side * width),
                          -.018 * index + math.sin(u * 5 + index) * .06,
                          math.sin(angle) * r + math.cos(angle) * (bend + side * width)))
        if step < 20 and (step + index * 3) % 11 != 7:
            faces.append((step * 2, step * 2 + 1, step * 2 + 3, step * 2 + 2))
    mesh = bpy.data.meshes.new('Ragged pressure strip')
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(materials[2 if index % 7 == 0 else 1 if index % 3 == 0 else 0])
    obj = bpy.data.objects.new('Pressure strip %02d' % index, mesh)
    s.collection.objects.link(obj)
    objects.append((obj, index, False))

for index in range(42):
    mesh = bpy.data.meshes.new('Angular shed fleck')
    width = .018 + (index % 3) * .009
    mesh.from_pydata([(-width, 0, 0), (width * 3, 0, width * .3), (0, .025, width)], [], [(0, 1, 2)])
    mesh.materials.append(materials[2 if index % 9 == 0 else 1])
    obj = bpy.data.objects.new('Pressure fleck %02d' % index, mesh)
    s.collection.objects.link(obj)
    objects.append((obj, index, True))

def animate(t):
    fade = max(0, 1 - max(0, t - .2) / .8)
    for mat in materials:
        mat.node_tree.nodes['Lifetime opacity'].inputs[1].default_value = 1.8 * fade ** .7
    for obj, index, fleck in objects:
        grow = min(1, t / .12)
        fade = max(0, 1 - max(0, t - .2) / .8)
        if fleck:
            angle = math.sin(index * 2.399963) * .6
            distance = .15 + t * (1.3 + (index % 11) * .16)
            obj.location = (math.cos(angle) * distance, -.7,
                            math.sin(angle) * distance - .14 * t * t)
            obj.rotation_euler.y = index * 1.7 + t * (index % 5 - 2) * 4
            obj.scale = (grow * fade, grow * fade, grow * fade)
        else:
            angle = math.sin(index * 2.399963) * .48
            travel = min(t, .65) * (1.3 + index % 5 * .14)
            obj.location = (math.cos(angle) * travel, 0, math.sin(angle) * travel)
            obj.scale = (.24 + .76 * grow, 1, grow * (.55 + .45 * fade))
        obj.hide_render = t <= 0 or t >= 1

for frame in (range(1, 65) if a.full else [8, 16, 29, 45]):
    s.frame_set(frame)
    animate((frame - 1) / 63)
    s.render.filepath = str(out / 'frames' / ('%03d.png' % frame))
    bpy.ops.render.render(write_still=True)
animate(.2)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'warrior_fervor.blend'))
(out / 'metadata.json').write_text(json.dumps({
    'frames': 64, 'frame_size': 248, 'gutter': 4, 'camera_span': 5.6,
    'pivot_content_top_origin': [.5 - 1.45 / 5.6, .5 + .8 / 5.6],
    'provenance': 'Original Blender-authored ragged pressure sheets and angular flecks',
    'baked_bloom': False}, indent=2))
