"""Transfer continuous heat weights from a watertight voxel proxy to the UV-split source.

Only the disposable proxy is remeshed. The original vertices, UVs, material
assignment and texture remain intact. Normalize and limit the shipping skin
to four influences after transfer.
"""
import bpy
import json

mesh = bpy.data.objects['Druid_Cat_form']
rig = bpy.data.objects['DruidCat_Rig']
proxy = bpy.data.objects.get('DruidCat_WeightProxy')
if proxy is None:
    proxy = mesh.copy()
    proxy.data = mesh.data.copy()
    proxy.name = 'DruidCat_WeightProxy'
    bpy.context.collection.objects.link(proxy)
    proxy.parent = None
    for mod in list(proxy.modifiers):
        proxy.modifiers.remove(mod)
    proxy.vertex_groups.clear()
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    proxy.data.remesh_voxel_size = .008
    bpy.ops.object.voxel_remesh()
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
assert all(v.groups for v in proxy.data.vertices), 'Proxy heat weights failed'

bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
transfer = mesh.modifiers.new('Heat weight transfer', 'DATA_TRANSFER')
transfer.object = proxy
transfer.use_vert_data = True
transfer.data_types_verts = {'VGROUP_WEIGHTS'}
transfer.vert_mapping = 'POLYINTERP_NEAREST'
transfer.layers_vgroup_select_src = 'ALL'
transfer.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.modifier_apply(modifier=transfer.name)
for vertex in mesh.data.vertices:
    weights = sorted([(g.group, g.weight) for g in vertex.groups if g.weight > 1e-6], key=lambda p: -p[1])[:4]
    assert weights, f'Unweighted source vertex {vertex.index}'
    total = sum(w for _, w in weights)
    for group_id in [group.group for group in vertex.groups]:
        mesh.vertex_groups[group_id].remove([vertex.index])
    for group, weight in weights:
        mesh.vertex_groups[group].add([vertex.index], weight / total, 'REPLACE')
proxy.hide_set(True)
proxy.hide_render = True
assert all(len(v.groups) <= 4 for v in mesh.data.vertices)
for name in ['thigh_parent.L','thigh_parent.R','front_thigh_parent.L','front_thigh_parent.R']:
    rig.pose.bones[name]['IK_Stretch'] = 0.0
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print(json.dumps({'vertices': len(mesh.data.vertices), 'max_influences': max(len(v.groups) for v in mesh.data.vertices), 'unweighted': sum(not v.groups for v in mesh.data.vertices)}))
