"""Bake evaluated Rigify deformation through Blender's glTF exporter.

Call export_cat(raw_glb_path) through Blender MCP after reviewing the source
actions. The optimizer spec consumes tmp/asset_src/druid_cat_form.glb.
"""
from pathlib import Path
import bpy

def export_cat(path):
    rig = bpy.data.objects['DruidCat_Rig']
    mesh = bpy.data.objects['Druid_Cat_form']
    destination = Path(path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    rig.hide_set(False)
    mesh.hide_set(False)
    rig.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    # The rest frame: Idle, or Idle_Look once the compact set retired Idle.
    rig.animation_data.action = bpy.data.actions.get('Idle') or bpy.data.actions['Idle_Look']
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(
        filepath=str(destination), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_anim_single_armature=True, export_def_bones=True,
        # Rigify's stretched spine has rotated descendants. Baking world-space
        # joints avoids unrepresentable parent shear in glTF's local TRS graph.
        export_hierarchy_flatten_bones=True,
        export_force_sampling=True, export_bake_animation=True,
        export_frame_range=False, export_frame_step=1,
        export_anim_slide_to_zero=True, export_rest_position_armature=True,
        export_skins=True, export_all_influences=False,
        export_morph=False, export_yup=True, export_extras=False,
        export_optimize_animation_size=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print('Saved baked cat:', destination)
