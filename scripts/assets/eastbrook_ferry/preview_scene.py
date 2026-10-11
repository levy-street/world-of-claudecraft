"""Review staging for the Eastbrook ferry: water, sky, the Eastbrook pier's T-head, player-scale
figures, the sim's collision volumes (optional), and the owner's review cameras.

Nothing here is exported: build_eastbrook_ferry.py exports the TransportShip_ROOT hierarchy
before this module adds anything to the scene.
"""
import json
import math
import os

import bpy
from mathutils import Vector
from shiplib import P

PLAYER_H = 2.6  # the player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts)
PIER_DECK = 2.64
PIER_EDGE_X = 8.0
PIER_HW = 2.2
GANGWAY_Z = 0.8


def _mat(name, color, rough=0.8, emit=0.0, alpha=1.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except AttributeError:
            pass
    return m


def _box(name, center, size, mat, coll):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=P(*center))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    o.data.materials.append(mat)
    for c in o.users_collection:
        c.objects.unlink(o)
    coll.objects.link(o)
    return o


def _collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def figure(name, x, y, z, coll, mat_body, mat_head, facing=0.0):
    """A chibi-proportioned player stand-in: 2.6 yd to the crown, big head like the game's."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.42, depth=1.45, location=P(x, y + 0.72, z))
    body = bpy.context.object
    body.name = f'{name}_body'
    body.data.materials.append(mat_body)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.58, location=P(x, y + 1.98, z))
    head = bpy.context.object
    head.name = f'{name}_head'
    head.data.materials.append(mat_head)
    for o in (body, head):
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)
    return body, head


def show_lod(objs, index):
    """Preview one LOD at a time (the runtime shows exactly one)."""
    for k, lod in enumerate(objs['lods']):
        for o in [lod] + list(lod.children_recursive):
            o.hide_render = k != index
            o.hide_set(k != index)


def stage(objs, collision=None):
    scene = bpy.context.scene
    show_lod(objs, 0)
    coll = _collection('Preview (not exported)')
    water = _mat('Water', (0.07, 0.24, 0.3), rough=0.12, alpha=0.82)
    bpy.ops.mesh.primitive_plane_add(size=400, location=P(0, 0, 0))
    w = bpy.context.object
    w.name = 'Water'
    w.data.materials.append(water)
    for c in w.users_collection:
        c.objects.unlink(w)
    coll.objects.link(w)
    seabed = _mat('Seabed', (0.22, 0.2, 0.14))
    _box('Seabed', (0, -3.6, 0), (400, 0.2, 400), seabed, coll)
    # the Eastbrook ferry pier's T-head: plank deck on stilts, reaching away to +x
    wood = _mat('PierWood', (0.42, 0.3, 0.2))
    post = _mat('PierPost', (0.26, 0.19, 0.13))
    _box('Pier_Deck', (PIER_EDGE_X + 10, PIER_DECK - 0.12, GANGWAY_Z), (20, 0.24, 2 * PIER_HW), wood, coll)
    for k in range(6):
        for s in (-1, 1):
            _box(f'Pier_Post_{k}_{s}', (PIER_EDGE_X + 0.3 + k * 3.8, -0.6, GANGWAY_Z + s * (PIER_HW - 0.25)),
                 (0.36, 6.4, 0.36), post, coll)
    body = _mat('FigureBody', (0.55, 0.12, 0.1))
    head = _mat('FigureHead', (0.93, 0.75, 0.6))
    spots = [
        ('Figure_Pier', PIER_EDGE_X + 3.0, PIER_DECK, GANGWAY_Z),
        ('Figure_Gangplank', 7.0, 2.97, GANGWAY_Z),
        ('Figure_Gangway', 4.0, 3.3, GANGWAY_Z),
        ('Figure_Waist_1', -1.5, 3.3, 4.5),
        ('Figure_Waist_2', 1.8, 3.3, -1.0),
        ('Figure_Waist_3', -2.0, 3.3, 0.2),
        ('Figure_Stair', 3.72, 4.8, -5.2),
        ('Figure_Door', 0.0, 3.3, -6.6),
        ('Figure_Captain', 0.0, 6.3, -12.2),
        ('Figure_Captain_2', 2.4, 6.3, -9.0),
        ('Figure_Forecastle', 1.2, 4.5, 12.0),
    ]
    for name, x, y, z in spots:
        figure(name, x, y, z, coll, body, head)
    if collision and os.path.exists(collision):
        ccoll = _collection('Collision (sim volumes, not exported)')
        colmat = _mat('CollisionWire', (1.0, 0.3, 0.1), emit=1.0)
        with open(collision, encoding='utf-8') as fh:
            vols = json.load(fh)
        for v in vols:
            h = v['top'] + 3.0
            cy = v['top'] - h / 2
            if v['shape'] == 'circle':
                bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=v['r'], depth=h, location=P(v['x'], cy, v['z']))
                o = bpy.context.object
            else:
                bpy.ops.mesh.primitive_cube_add(size=1.0, location=P(v['x'], cy, v['z']))
                o = bpy.context.object
                o.scale = (2 * v['hw'], 2 * v['hd'], h)
                o.rotation_euler = (0, 0, v.get('rot', 0.0))
            o.name = f"COL_{v['id']}"
            o.display_type = 'WIRE'
            o.hide_render = True
            o.data.materials.append(colmat)
            for c in o.users_collection:
                c.objects.unlink(o)
            ccoll.objects.link(o)
            o.hide_set(True)  # unhide the collection's objects to review the walkable volumes
    # sky and sun
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'LINEAR'
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.62, 0.72, 0.8, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.28, 0.46, 0.72, 1)
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    # map view direction z (-1..1) to 0..1
    math_node = nt.nodes.new('ShaderNodeMapRange')
    math_node.inputs['From Min'].default_value = -1.0
    math_node.inputs['From Max'].default_value = 1.0
    nt.links.new(coord.outputs['Generated'], sep.inputs[0])
    sep2 = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Window'], sep2.inputs[0])
    nt.links.new(sep2.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.6
    sun.data.angle = math.radians(4)
    sun.data.color = (1.0, 0.95, 0.86)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))
    coll.objects.link(sun)
    fill = bpy.data.objects.new('SkyFill', bpy.data.lights.new('SkyFill', 'SUN'))
    fill.data.energy = 0.7
    fill.data.color = (0.7, 0.8, 1.0)
    fill.rotation_euler = (math.radians(-60), 0, math.radians(200))
    fill.data.use_shadow = False
    coll.objects.link(fill)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.lens = 32
    cam.data.clip_end = 1000
    coll.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    try:
        scene.eevee.use_shadows = True
    except AttributeError:
        pass
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.frame_set(0)
    return cam


VIEWS = {
    # name: camera position, look-at (game frame), lens
    'shore': ((42.0, 5.5, -4.0), (0.0, 9.0, 1.0), 30),
    'three_quarter': ((30.0, 15.0, 34.0), (0.0, 8.5, 1.0), 30),
    'deck': ((0.0, 3.3 + 2.0 + 4.6, -10.5), (0.0, 5.6, 4.0), 30),
    'deck_captain': ((1.5, 6.3 + 2.0, -13.5), (0.0, 5.0, 6.0), 26),
    'bow_figurehead': ((5.5, 5.8, 22.5), (0.0, 5.2, 16.8), 38),
    'stern': ((-13.0, 8.0, -28.0), (0.0, 6.0, -14.5), 32),
    'gameplay_pier': ((PIER_EDGE_X + 13.0, 9.5, GANGWAY_Z - 4.0), (PIER_EDGE_X + 1.0, 4.6, GANGWAY_Z), 34),
    'far': ((150.0, 20.0, -60.0), (0.0, 10.0, 0.0), 30),
    'mid': ((70.0, 14.0, 40.0), (0.0, 10.0, 0.0), 30),
}


def render_all(out_dir, only=None):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    cam = scene.camera
    names = only.split(',') if only else list(VIEWS)
    for name in names:
        pos, at, lens = VIEWS[name]
        cam.location = P(*pos)
        cam.data.lens = lens
        direction = P(*at) - P(*pos)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out_dir, f'ferry_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)
