"""The frozen-pose variant for the Calving Face showpiece: Korzul held in the quench,
baked to a STATIC mesh (no armature, no clips: the cheapest thing that can sit
inside the translucent ice shell of the kit), with the eight slabs of quench-ice
on him as a second mesh.

  blender -b korzul.blend --python frozen.py -- <out.glb> [--clip Frozen] [--t 0.0]

The skinned GLB can do the same live: play `Frozen` (or `FrozenAwaken` for the
twitch) on the full model and keep `KorzulShedIce` visible. Use this static file
when the dragon in the ice never has to move (stages 0 to 3); swap to the skinned
model for stage 4 (the eye that tracks the group) and the BreakFree at stage 5.
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as R  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(argv[0])


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.name.startswith('Korzul'))
act = bpy.data.actions[opt('--clip', 'Frozen')]
R.set_action(arm, act)
bpy.context.scene.frame_set(int(act.frame_range[0] + float(opt('--t', 0.0)) * R.FPS))
dg = bpy.context.evaluated_depsgraph_get()
made = []
for src in [o for o in arm.children if o.type == 'MESH']:
    ev = src.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    o = bpy.data.objects.new(src.name + 'Frozen', me)
    o.matrix_world = src.matrix_world.copy()
    bpy.context.scene.collection.objects.link(o)
    o.vertex_groups.clear()
    made.append(o)
for o in bpy.context.selected_objects:
    o.select_set(False)
for o in made:
    o.select_set(True)
bpy.context.view_layer.objects.active = made[0]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
                          export_animations=False, export_skins=False, export_cameras=False, export_lights=False,
                          export_vertex_color='NONE', export_image_format='JPEG', export_jpeg_quality=88)
print('FROZEN_WROTE', out, os.path.getsize(out), [o.name for o in made])
