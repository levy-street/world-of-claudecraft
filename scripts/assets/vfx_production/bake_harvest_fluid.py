"""Red Harvest liquid breakup, simulated offline with Blender Mantaflow.

blender --background --python this.py -- --output-dir tmp/harvest-fluid --preview
Reuse a finished cache with --render-only. Shipping output is a sprite, not a
runtime fluid solver. The camera and source remain fixed for all 64 frames.
"""
import argparse
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', required=True)
parser.add_argument('--resolution', type=int, default=96)
parser.add_argument('--preview', action='store_true')
parser.add_argument('--render-only', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.output_dir).resolve()
out.mkdir(parents=True, exist_ok=True)
blend = out / 'harvest_fluid.blend'

if args.render_only:
    bpy.ops.wm.open_mainfile(filepath=str(blend))
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, 64
    scene.render.fps = 64
    scene.gravity = (0, 0, -9.81)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 3))
    domain = bpy.context.object
    domain.name = 'Harvest_Mantaflow'
    domain.scale = (6, 2.2, 6)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = domain.modifiers.new('Real liquid simulation', 'FLUID')
    mod.fluid_type = 'DOMAIN'
    bpy.context.view_layer.update()
    settings = mod.domain_settings
    settings.domain_type = 'LIQUID'
    settings.resolution_max = args.resolution
    settings.cache_type = 'MODULAR'
    settings.cache_directory = str(out / 'cache')
    settings.cache_frame_start, settings.cache_frame_end = 1, 64
    settings.use_mesh = True
    settings.mesh_scale = 2
    settings.use_diffusion = True
    settings.surface_tension = 0.04
    settings.time_scale = 0.8
    settings.timesteps_max = 8
    for side in ('front', 'back', 'left', 'right', 'top', 'bottom'):
        setattr(settings, 'use_collision_border_' + side, False)
    mat = bpy.data.materials.new('Crimson liquid with wet highlights')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.24, 0.003, 0.018, 1)
    bsdf.inputs['Roughness'].default_value = 0.34
    bsdf.inputs['Specular IOR Level'].default_value = 0.28
    bsdf.inputs['Emission Color'].default_value = (0.25, 0.003, 0.016, 1)
    bsdf.inputs['Emission Strength'].default_value = 0.16
    domain.data.materials.append(mat)
    for polygon in domain.data.polygons:
        polygon.use_smooth = True
    # Two unequal extraction streams, three lower transverse splashes, two fines.
    jets = [(-0.65, 0.2, (-4.4, 0.4, 13.5), 0.23),
            (0.6, 0.15, (5.1, -0.2, 11.8), 0.25),
            (-0.55, -0.45, (-6.5, 0.1, 4.2), 0.18),
            (0.55, -0.45, (6.8, -0.3, 3.3), 0.2),
            (0, 0.65, (1.6, 0.6, 8.2), 0.18),
            (-0.1, -0.4, (-2.3, 1.1, 10.0), 0.14),
            (0.1, 0.05, (3.0, -0.7, 7.5), 0.15)]
    for index, (x, y, velocity, radius) in enumerate(jets):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=(x, y, 0))
        emitter = bpy.context.object
        emitter.name = 'Harvest_source_%d' % index
        emitter.hide_render = True
        flow_mod = emitter.modifiers.new('Short liquid impulse', 'FLUID')
        flow_mod.fluid_type = 'FLOW'
        bpy.context.view_layer.update()
        flow = flow_mod.flow_settings
        flow.flow_type = 'LIQUID'
        flow.flow_behavior = 'INFLOW'
        flow.use_initial_velocity = True
        flow.velocity_coord = velocity
        flow.surface_distance = 0.7
        flow.use_inflow = True
        flow.keyframe_insert('use_inflow', frame=1)
        flow.keyframe_insert('use_inflow', frame=3 + index % 3)
        flow.use_inflow = False
        flow.keyframe_insert('use_inflow', frame=4 + index % 3)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 3
    scene.render.resolution_x = scene.render.resolution_y = 248
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.world.color = (0.15, 0.15, 0.15)
    bpy.ops.object.camera_add(location=(0, -20, 3))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, 3)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 14
    scene.camera = camera
    for position, energy, size in [((-4, -5, 7), 1000, 4), ((4, -2, 3), 700, 3), ((1, 3, 6), 1200, 3)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        lamp = bpy.context.object
        lamp.data.energy, lamp.data.size = energy, size
        lamp.rotation_euler = (Vector((0, 0, 3)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.objects.active = domain
    bpy.ops.object.select_all(action='DESELECT')
    domain.select_set(True)
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    print('HARVEST_BAKE_DATA', flush=True)
    bpy.ops.fluid.bake_data()
    print('HARVEST_BAKE_MESH', flush=True)
    bpy.ops.fluid.bake_mesh()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))

scene = bpy.context.scene
domain = bpy.data.objects['Harvest_Mantaflow']
frames = out / 'frames'
frames.mkdir(exist_ok=True)
counts = []
for frame in ([8, 20, 36, 52] if args.preview else range(1, 65)):
    scene.frame_set(frame)
    evaluated = domain.evaluated_get(bpy.context.evaluated_depsgraph_get())
    vertices = len(evaluated.data.vertices)
    counts.append({'frame': frame, 'vertices': vertices})
    domain.hide_render = frame in (1, 64)
    scene.render.filepath = str(frames / ('%03d.png' % frame))
    bpy.ops.render.render(write_still=True)
    print('HARVEST_FLUID_FRAME', frame, vertices, flush=True)
assert any(row['vertices'] > 100 for row in counts), 'Mantaflow produced no liquid mesh'
(out / 'metadata.json').write_text(json.dumps({
    'frames': 64, 'grid': [8, 8], 'content_px': 248, 'gutter_px': 4,
    'alpha': 'straight', 'pivot': [0.5, 0.5 + 3 / 14],
    'source': 'Blender Mantaflow liquid simulation, Cycles render',
    'resolution': domain.modifiers[0].domain_settings.resolution_max,
    'baked_bloom': False, 'mesh_evidence': counts,
}, indent=2))
