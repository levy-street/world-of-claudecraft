"""Presentation-only objects, kept outside the export collection."""
import math
import bpy
from mathutils import Vector
from primitives import collection, empty, ico, material, attach, curves, ring


def setup(scene, cfg):
    coll = collection('PREVIEW_ONLY_DoNotExport', scene.collection)
    graphite = material('Preview_Graphite', (.028, .041, .065), metallic=.25)
    armor = material('Preview_BossArmor', (.09, .14, .21), metallic=.65)
    trim = material('Preview_BossTrim', (.12, .29, .4), emission=.25, metallic=.6)
    boss = empty('PREVIEW_StationaryBoss', coll)
    # Faceted sentinel proxy, grounded feet and a broad readable upper silhouette.
    for side in (-1, 1):
        ico(f'PREVIEW_Boot_{side}', coll, boss, (side * .31, -.12, .28), (.29, .43, .28), armor)
        ico(f'PREVIEW_Leg_{side}', coll, boss, (side * .30, 0, .75), (.25, .27, .55), armor)
        ico(f'PREVIEW_Shoulder_{side}', coll, boss, (side * .73, 0, 1.97), (.43, .38, .31), armor, 1)
        ico(f'PREVIEW_Arm_{side}', coll, boss, (side * .90, -.1, 1.52), (.23, .27, .44), armor)
    ico('PREVIEW_Torso', coll, boss, (0, 0, 1.5), (.58, .35, .7), armor, 2)
    ico('PREVIEW_Helm', coll, boss, (0, 0, 2.28), (.30, .31, .38), armor, 1)
    ico('PREVIEW_ChestSigil', coll, boss, (0, -.345, 1.7), (.13, .025, .23), trim, 1)
    bpy.ops.mesh.primitive_plane_add(size=200)
    ground = attach(bpy.context.object, 'PREVIEW_Ground', coll)
    ground.data.materials.append(graphite)
    # Very faint range references, not a noisy environment.
    gridmat = material('Preview_FloorEtching', (.035, .058, .075), .25)
    curves('PREVIEW_RangeEtchings', [ring(r, .008, points=128) for r in (3.2, 6, 9)], .008, gridmat, coll)
    dummy = empty('PREVIEW_PlayerScale_1_8m', coll, location=(-3.8, -5.1, 0))
    playermat = material('Preview_Player', (.28, .26, .20), metallic=.2)
    ico('PREVIEW_PlayerTorso', coll, dummy, (0, 0, .95), (.23, .20, .50), playermat)
    ico('PREVIEW_PlayerHead', coll, dummy, (0, 0, 1.61), (.18,) * 3, playermat)
    for side in (-1, 1):
        ico(f'PREVIEW_PlayerLeg_{side}', coll, dummy, (side * .12, 0, .32), (.105, .12, .32), playermat)
    world = bpy.data.worlds.new('Preview_NightStudio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.035, .055, .10, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.world = world
    for name, pos, energy, color, size in [
        ('Key', (1, -4, 10), 1800, (.48, .67, 1), 9),
        ('Rim', (-4, 5, 7), 2300, (.15, .40, 1), 7),
        ('Fill', (7, 1, 5), 1000, (.55, .48, .40), 8),
    ]:
        data = bpy.data.lights.new('PREVIEW_' + name, 'AREA')
        data.energy, data.color, data.shape, data.size = energy, color, 'DISK', size
        obj = bpy.data.objects.new('PREVIEW_' + name, data)
        coll.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera = bpy.data.cameras.new('GameplayCamera')
    cam = bpy.data.objects.new('PREVIEW_GameplayCamera', camera)
    coll.objects.link(cam)
    cam.location = (12, -18, 15)
    cam.rotation_euler = (Vector((0, 0, .65)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    camera.type = 'PERSP'
    camera.lens = 42
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    tree = bpy.data.node_groups.new('OrbitalLightning_SubtleBloom', 'CompositorNodeTree')
    scene.compositing_node_group = tree
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    source = tree.nodes.new('CompositorNodeRLayers')
    glare = tree.nodes.new('CompositorNodeGlare')
    glare.inputs['Type'].default_value = 'Fog Glow'
    glare.inputs['Quality'].default_value = 'High'
    glare.inputs['Strength'].default_value = .35
    output = tree.nodes.new('NodeGroupOutput')
    tree.links.new(source.outputs['Image'], glare.inputs['Image'])
    tree.links.new(glare.outputs['Image'], output.inputs['Image'])
    source.location = (-300, 0)
    output.location = (300, 0)
