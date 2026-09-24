"""Review renders of the forge kit, shown the way the game draws it: unlit, the
painted facets carrying all the shading, against the room's dark.

  blender --background --python docs/design/forge-room/preview.py [-- --save kit.blend]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_forge_kit  # noqa: E402

parts = {obj.name: obj for obj in build_forge_kit.build()}
scene = bpy.context.scene
# Unlit: every material becomes its vertex colour, emitted.
for mat in bpy.data.materials:
    tree = mat.node_tree
    for node in list(tree.nodes):
        if node.type not in ('OUTPUT_MATERIAL', 'VERTEX_COLOR'):
            tree.nodes.remove(node)
    out = next(n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL')
    col = next(n for n in tree.nodes if n.type == 'VERTEX_COLOR')
    emit = tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Strength'].default_value = 2.2 if mat.name == 'ForgeMolten' else 1.0
    tree.links.new(col.outputs['Color'], emit.inputs['Color'])
    tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.035, 0.022, 0.018, 1)
scene.world = world
bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, 0))
floor = bpy.context.object
ground = bpy.data.materials.new('ground')
ground.use_nodes = True
ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.035, 0.03, 1)
floor.data.materials.append(ground)
# A player-sized marker, so the scale reads.
bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=1.8, location=(-16, -6, 0.9))
marker = bpy.context.object
who = bpy.data.materials.new('player')
who.use_nodes = True
who.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.2, 0.6, 1, 1)
who.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.5
marker.data.materials.append(who)

layout = {
    'Kit_GreatForge': (0, 8, 0, 0),
    'Kit_IronBrace': (-19, 9, 0, 0),
    'Kit_Vent': (19, 8, 0, 0),
    'Kit_Crucible': (-10, -7, 0, 0.5),
    'Kit_Anvil': (-2, -8, 0, -0.3),
    'Kit_IngotStack': (6, -8, 0, 0.4),
    'Kit_ForgePost': (13, -8, 0, 0),
    'Kit_ChainHook': (17, -6, 8, 0),
}
for name, (x, y, z, yaw) in layout.items():
    parts[name].location = (x, y, z)
    parts[name].rotation_euler = (0, 0, yaw)
light = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
light.data.energy = 0.6
light.rotation_euler = (0.9, 0, 0.6)
scene.collection.objects.link(light)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 35
scene.collection.objects.link(cam)
scene.camera = cam
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
# `-- --save file.blend` writes the laid-out scene instead of rendering it, for
# opening in the Blender window (open_forge_kit.py).
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if '--save' in ARGS:
    bpy.ops.wm.save_as_mainfile(filepath=ARGS[ARGS.index('--save') + 1])
    print('SAVED', ARGS[ARGS.index('--save') + 1])
    sys.exit(0)
for tag, loc, aim in (('kit', (4, -46, 17), (1, 0, 6)), ('forge', (-9, -24, 5), (0, 6, 8))):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(HERE, f'forge_{tag}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)
