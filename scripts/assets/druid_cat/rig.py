"""Fit Rigify's animal IK/FK rig to the supplied cat in Blender's -Y forward frame.

Run through Blender MCP in a saved copy of the source scene. Coordinates are
measured landmarks on this source mesh, in Blender metres. Never re-fit a rig
against an already posed mesh.
"""
import bpy
import json
from rigify.metarigs.Basic import basic_quadruped

mesh = bpy.data.objects['Druid_Cat_form']
assert mesh.type == 'MESH' and not mesh.modifiers, 'Expected the unrigged source'
assert 'DruidCat_Metarig' not in bpy.data.objects, 'Rig already exists'
bpy.ops.object.select_all(action='DESELECT')
arm = bpy.data.armatures.new('DruidCat_Metarig')
meta = bpy.data.objects.new('DruidCat_Metarig', arm)
bpy.context.collection.objects.link(meta)
meta.select_set(True)
bpy.context.view_layer.objects.active = meta
basic_quadruped.create(meta)

spine = {
    'spine.004': ((0,.17,.405), (0,.11,.422)),
    'spine.005': ((0,.11,.422), (0,-.02,.419)),
    'spine.006': ((0,-.02,.419), (0,-.14,.43)),
    'spine.007': ((0,-.14,.43), (0,-.235,.445)),
    'spine.008': ((0,-.235,.445), (0,-.285,.475)),
    'spine.009': ((0,-.285,.475), (0,-.33,.50)),
    'spine.010': ((0,-.33,.50), (0,-.375,.51)),
    'spine.011': ((0,-.375,.51), (0,-.465,.485)),
    'spine.003': ((0,.17,.405), (0,.235,.30)),
    'spine.002': ((0,.235,.30), (0,.30,.19)),
    'spine.001': ((0,.30,.19), (0,.39,.14)),
    'spine': ((0,.39,.14), (0,.485,.16)),
}
limbs = {
    'pelvis': ((0,.11,.415), (.085,.15,.43)),
    'thigh': ((.082,.145,.405), (.082,.105,.27)),
    'shin': ((.082,.105,.27), (.082,.20,.12)),
    'foot': ((.082,.20,.12), (.082,.185,.044)),
    'toe': ((.082,.185,.044), (.082,.11,.023)),
    'shoulder': ((.035,-.235,.475), (.084,-.23,.425)),
    'breast': ((.032,-.20,.40), (.032,-.25,.315)),
    'front_thigh': ((.084,-.23,.425), (.084,-.19,.25)),
    'front_shin': ((.084,-.19,.25), (.084,-.235,.095)),
    'front_foot': ((.084,-.235,.095), (.084,-.24,.043)),
    'front_toe': ((.084,-.24,.043), (.084,-.305,.022)),
}
bpy.ops.object.mode_set(mode='EDIT')
for name, (head, tail) in spine.items():
    bone = arm.edit_bones[name]
    bone.head, bone.tail = head, tail
    bone.roll = 0
for side, sign in [('L', 1), ('R', -1)]:
    for name, (head, tail) in limbs.items():
        bone = arm.edit_bones[name + '.' + side]
        bone.head = (sign*head[0], head[1], head[2])
        bone.tail = (sign*tail[0], tail[1], tail[2])
        bone.roll = 0
for name, head, tail in [
    ('jaw', (0,-.388,.473), (0,-.47,.441)),
    ('ear.L', (.066,-.347,.546), (.077,-.342,.624)),
    ('ear.R', (-.066,-.347,.546), (-.077,-.342,.624)),
]:
    bone = arm.edit_bones.new(name)
    bone.head, bone.tail = head, tail
    bone.parent = arm.edit_bones['spine.011']
bpy.ops.object.mode_set(mode='OBJECT')
for name in ['jaw', 'ear.L', 'ear.R']:
    bone = meta.pose.bones[name]
    bone.rigify_type = 'basic.super_copy'
    bone.rigify_parameters.make_control = True
    bone.rigify_parameters.make_deform = True
    arm.collections['Spine'].assign(bone)
meta.data.rigify_rig_basename = 'DruidCat'
bpy.ops.pose.rigify_generate()
rig = bpy.context.object
rig.name = 'DruidCat_Rig'
rig.show_in_front = True
# glTF skins evaluate linear joints. Keep the editable rig on the same
# deformation model instead of previewing unexportable B-Bone spline bending.
for bone in rig.data.bones:
    if bone.use_deform:
        bone.bbone_segments = 1

# The source has UV-split seams. weights.py transfers heat weights from a
# watertight proxy, avoiding the heat solver's failure on disconnected edges.
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
for name in ['thigh_parent.L', 'thigh_parent.R', 'front_thigh_parent.L', 'front_thigh_parent.R']:
    rig.pose.bones[name]['IK_Stretch'] = 0.0
meta.hide_set(True)
meta.hide_render = True
bpy.context.scene.render.fps = 30
bpy.context.scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print(json.dumps({
    'rig': rig.name,
    'deform_bones': [b.name for b in rig.data.bones if b.use_deform],
    'controls': [b.name for b in rig.pose.bones if not b.name.startswith(('DEF-','ORG-','MCH-'))],
    'unweighted_vertices': sum(not v.groups for v in mesh.data.vertices),
}, indent=2))
