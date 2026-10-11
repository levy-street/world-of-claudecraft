"""Export reusable mesh components, excluding every preview object.

The .blend remains the animation source. These static GLBs are engine input pieces,
not a claim that glTF preserves animated emission, visibility or curve deformation.
"""
from pathlib import Path
import json
import struct
import bpy
from mathutils import Matrix

HERE = Path(__file__).resolve().parent
source_scene = bpy.context.scene
export_scene = bpy.data.scenes.new('TEMP_ComponentExport')
results = []
root = bpy.data.objects['OrbitalLightning_ROOT']
charge_frame = round((root['summon_duration'] + root['charge_duration'] * .65) * source_scene.render.fps) + 1
impact_frame = source_scene.timeline_markers['FIRE_01'].frame + 1
groups = [
    ('orb_components', charge_frame, 'Orb_01', ['Core', 'OuterEnergy', 'LocalArcs', 'Sparks']),
    ('impact_components', impact_frame, 'Impact_01', ['ImpactCore', 'RadialBurst', 'GroundArcs', 'Sparks', 'Crown']),
]
for label, frame, anchor_name, suffixes in groups:
    bpy.context.window.scene = source_scene
    source_scene.frame_set(frame)
    bpy.context.view_layer.update()
    anchor = bpy.data.objects[anchor_name]
    origin = anchor.matrix_world.translation.copy()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    copies = []
    for suffix in suffixes:
        obj = bpy.data.objects[f'{anchor_name}_{suffix}']
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
        assert mesh and len(mesh.vertices), f'Empty export {obj.name}'
        mesh.transform(Matrix.Translation(-origin) @ obj.matrix_world)
        coordinates = [v.co for v in mesh.vertices]
        extent = max((max(v[k] for v in coordinates) - min(v[k] for v in coordinates)) for k in range(3))
        assert extent > .001, f'Degenerate export {obj.name}'
        copy = bpy.data.objects.new(suffix, mesh)
        export_scene.collection.objects.link(copy)
        # Freeze evaluated material properties, then remove shader animation.
        for slot in copy.material_slots:
            mat = slot.material.copy()
            mat.animation_data_clear()
            mat.node_tree.animation_data_clear()
            slot.material = mat
        copies.append(copy)
    bpy.context.window.scene = export_scene
    bpy.ops.object.select_all(action='DESELECT')
    for obj in copies:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    path = HERE / (label + '.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, use_active_scene=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_yup=True)
    binary = path.read_bytes()
    chunk_length = struct.unpack_from('<I', binary, 12)[0]
    gltf = json.loads(binary[20:20 + chunk_length])
    assert {node['name'] for node in gltf['nodes']} == set(suffixes), 'Unexpected export objects'
    assert not gltf.get('animations') and not gltf.get('cameras')
    triangles = 0
    for obj in copies:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    results.append({'file': path.name, 'triangles': triangles, 'meshes': len(copies),
                    'bytes': path.stat().st_size, 'pivot': 'local center, glTF Y-up',
                    'animation': False, 'preview_objects': False})
    for obj in copies:
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.window.scene = source_scene
(HERE / 'exports.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
