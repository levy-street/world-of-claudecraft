"""Re-import the baked raw GLB and compare sampled skin positions with Rigify.

Run validate_cat(raw_path, report_path) through Blender MCP. The comparison is
bidirectional nearest-vertex distance because glTF splits vertices at normals.
Only the temporary validation objects/actions are removed afterwards.
"""
import hashlib
import json
from pathlib import Path
import bpy
from mathutils.kdtree import KDTree
from motion import reset

def _distance(a, b):
    tree = KDTree(len(a))
    for i, v in enumerate(a):
        tree.insert(v, i)
    tree.balance()
    return max(tree.find(v)[2] for v in b)

def _vertices(mesh):
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [mesh.matrix_world @ v.co for v in evaluated.data.vertices]

def validate_cat(raw_path, report_path):
    source = bpy.data.objects['DruidCat_Rig']
    mesh = bpy.data.objects['Druid_Cat_form']
    actions = {a.name: a for a in bpy.data.actions if a.get('authored_for') == source.name}
    before_objects = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    previous_action = source.animation_data.action
    previous_frame = bpy.context.scene.frame_current
    report = {'raw_sha256': hashlib.sha256(Path(raw_path).read_bytes()).hexdigest(), 'clips': {}}
    try:
        # Export must not silently clear the generated Rigify heel corrections.
        # Comparing two already-damaged rigs would otherwise be self-confirming.
        source.animation_data.action = None
        reset(source)
        source.update_tag()
        bpy.context.view_layer.update()
        neutral = _vertices(mesh)
        report['source_neutral_error_after_export'] = max(
            (p - mesh.matrix_world @ v.co).length for p, v in zip(neutral, mesh.data.vertices))
        assert report['source_neutral_error_after_export'] < .0001, 'Export changed the source bind stance'
        bpy.ops.import_scene.gltf(filepath=str(raw_path))
        added = set(bpy.data.objects) - before_objects
        imported_rig = next(o for o in added if o.type == 'ARMATURE')
        # The importer also creates a mesh used as the flat joints' custom
        # display shape. Compare the skinned cat, never that viewport widget.
        imported_mesh = next(o for o in added if o.type == 'MESH' and any(
            mod.type == 'ARMATURE' and mod.object == imported_rig for mod in o.modifiers))
        imported_actions = set(bpy.data.actions) - before_actions
        for track in imported_rig.animation_data.nla_tracks:
            track.mute = True
        for name, action in actions.items():
            imported = next(a for a in imported_actions if a.name.rsplit('.', 1)[0] == name)
            source.animation_data.action = action
            imported_rig.animation_data.action = imported
            imported_rig.animation_data.action_slot = imported.slots[0]
            last = round(action['duration_seconds'] * 30)
            errors = []
            for frame in sorted({0, round(last * .2), round(last * .4), round(last * .6), round(last * .8), last}):
                bpy.context.scene.frame_set(frame + 1)
                bpy.context.view_layer.update()
                original_points = _vertices(mesh)
                # Author actions start at frame 1; glTF/import starts at zero.
                bpy.context.scene.frame_set(frame)
                bpy.context.view_layer.update()
                imported_points = _vertices(imported_mesh)
                errors.append(max(_distance(original_points, imported_points),
                                  _distance(imported_points, original_points)))
            report['clips'][name] = max(errors)
        report['max_error'] = max(report['clips'].values())
        Path(report_path).write_text(json.dumps(report, indent=2))
        assert len(report['clips']) == 26, 'Incomplete clip comparison'
        assert report['max_error'] < .0001, 'Exported skin differs from the Blender preview'
        return report
    finally:
        for obj in set(bpy.data.objects) - before_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for action in set(bpy.data.actions) - before_actions:
            bpy.data.actions.remove(action)
        source.animation_data.action = previous_action
        bpy.context.scene.frame_set(previous_frame)
        bpy.context.view_layer.update()
