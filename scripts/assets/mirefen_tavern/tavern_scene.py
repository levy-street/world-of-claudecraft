"""Review staging for the Mirefen tavern: the game's own terrain round the building, the road
past its door, player-scale figures outside and in (the doorway, by a table, by the fire, at
the bar, on the stage, in the tower's nook, in a booth), a roof-off cutaway copy of the building
beside it with the same figures, warm lights inside, a sun, and cameras.

Nothing here is exported: build_tavern.py exports the MirefenTavern_ROOT hierarchy before
this module adds anything. The terrain patch is the game's height field in the tavern's
frame (layout.ts --context writes it), so the model sits in the scene as it does in game.

  npx tsx scripts/assets/mirefen_tavern/layout.ts --context TERRAIN.json
  blender --background --python scripts/assets/mirefen_tavern/build_tavern.py -- \
      --save taberna.blend --context TERRAIN.json [--render OUT_DIR]
  blender taberna.blend --python scripts/assets/mirefen_tavern/open_tavern.py
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix
from shiplib import P

PLAYER_H = 2.6  # the player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts)
CUTAWAY_OFFSET = (0.0, 0.0, 70.0)  # the roof-off copy, across the road in front of the door
CUT_KEEP = ('TavernFrame', 'TavernFurnishings', 'TavernLights', 'TavernTrim', 'TavernClutter', 'BarPillar',
            'HallWallBack', 'HallWallLeft', 'WingWallBack', 'WingWallWest')


def _mat(name, color, rough=0.8, emit=0.0, vertex=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if vertex:
        attr = m.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        m.node_tree.links.new(attr.outputs['Color'], b.inputs['Base Color'])
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def _collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def _move(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def terrain(path, coll, road_z):
    """The game's height field round the tavern as a vertex-coloured mesh, the road tinted."""
    with open(path, encoding='utf8') as fh:
        g = json.load(fh)
    nx, nz, step = g['nx'], g['nz'], g['step']
    verts, faces = [], []
    for j in range(nz):
        for i in range(nx):
            verts.append(P(g['x0'] + i * step, g['h'][j * nx + i] - 0.05, g['z0'] + j * step))
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + 1, a + nx + 1, a + nx))
    mesh = bpy.data.meshes.new('Terrain')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in mesh.polygons:
        c = poly.center
        gz = -c.y  # Blender -y is the game's +z
        if abs(gz - road_z) < 3.0:
            rgb = (0.52, 0.44, 0.32)
        elif c.z < -3.9:
            rgb = (0.28, 0.34, 0.3)
        else:
            rgb = (0.34, 0.42, 0.22)
        for li in poly.loop_indices:
            col.data[li].color = (rgb[0] ** 2.2, rgb[1] ** 2.2, rgb[2] ** 2.2, 1)
    obj = bpy.data.objects.new('Terrain', mesh)
    obj.data.materials.append(_mat('TerrainMat', (1, 1, 1), 0.95, vertex=True))
    coll.objects.link(obj)
    return obj


def figure(name, x, y, z, coll, body, head):
    """The chibi player stand-in: 2.6 yd to the crown, big head."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42, depth=1.45, location=P(x, y + 0.72, z))
    b = bpy.context.object
    b.name = f'{name}_body'
    b.data.materials.append(body)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.58, location=P(x, y + 1.98, z))
    h = bpy.context.object
    h.name = f'{name}_head'
    h.data.materials.append(head)
    for o in (b, h):
        _move(o, coll)


def point_light(name, x, y, z, color, energy, radius, coll):
    light = bpy.data.lights.new(name, 'POINT')
    light.color = color
    light.energy = energy
    light.shadow_soft_size = radius
    light.use_shadow = energy >= 2500
    obj = bpy.data.objects.new(name, light)
    obj.location = P(x, y, z)
    coll.objects.link(obj)
    return obj


SPOTS = {
    'Doorway': (0.0, 0.0, 13.0),
    'Table': (-10.4, 0.0, 3.4),
    'Hearth': (0.0, -0.45, 5.4),
    'Bar': (8.0, 0.5, -5.2),
    'Stage': (-11.4, 0.45, -10.4),
    'Nook': (-1.5, 0.0, -16.0),
    'Booth': (-11.4, 0.0, -4.6),
}


def stage(objs, context_path):
    import build_tavern as B

    layout = B.LAYOUT
    road_z = 24.0
    ctx = _collection('Context (not exported)')
    if context_path:
        terrain(context_path, ctx, road_z)
    body = _mat('FigureBody', (0.78, 0.18, 0.14), 0.7)
    head = _mat('FigureHead', (0.93, 0.74, 0.58), 0.6)
    ref = _collection('Player reference (2.6 yd = the game player)')
    T = layout['tower']
    spots = dict(SPOTS)
    spots['Road'] = (3.0, B.ground(3.0, 22.0), 22.0)
    for name, (fx, fy, fz) in spots.items():
        figure(f'PlayerReference_{name}', fx, fy, fz, ref, body, head)
    # the roof-off cutaway copy across the road, the same figures inside it
    cut = _collection('Cutaway, roof and near walls off (not exported)')
    for name in CUT_KEEP:
        src = objs['pieces'][name]
        dup = src.copy()
        dup.name = f'{name}_Cutaway'
        dup.parent = None
        cut.objects.link(dup)
        dup.matrix_world = Matrix.Translation(P(*CUTAWAY_OFFSET)) @ src.matrix_world
    for name, (fx, fy, fz) in spots.items():
        if name == 'Road':
            continue
        figure(f'PlayerReference_Cutaway{name}', fx + CUTAWAY_OFFSET[0], fy + CUTAWAY_OFFSET[1],
               fz + CUTAWAY_OFFSET[2], cut, body, head)
    # warm light inside: the hearth, the wall fire, the chandelier, the lanterns
    lit = _collection('Warm lights (not exported)')
    pit = layout['pit']
    for (ox, oz) in ((0.0, 0.0), CUTAWAY_OFFSET[::2]):
        point_light('Hearth', pit['x'] + ox, 1.4, pit['z'] + oz, (1.0, 0.55, 0.25), 9000, 1.2, lit)
        fire = next(q for q in layout['props'] if q['kind'] == 'fireplace')
        point_light('WallFire', fire['x'] - 1.6 + ox, 1.2, fire['z'] + oz, (1.0, 0.55, 0.25), 2500, 0.6, lit)
        c = layout['chandelier']
        point_light('Chandelier', c['x'] + ox, c['y'] - 0.3, c['z'] + oz, (1.0, 0.75, 0.45), 3500, 1.0, lit)
        for q in layout['lanterns']:
            point_light('Lantern', q['x'] + ox, q['y'] - 0.2, q['z'] + oz, (1.0, 0.72, 0.42), 1500, 0.4, lit)
        point_light('Nook', T['x'] + ox, 4.0, T['z'] + oz, (1.0, 0.72, 0.42), 1800, 0.5, lit)
        st = layout['stage']
        point_light('Stage', (st['x0'] + st['x1']) / 2 + ox, 1.2, st['z1'] + oz, (1.0, 0.7, 0.4), 1600, 0.4, lit)
        point_light('Kitchen', 9.5 + ox, 1.4, -17.0 + oz, (1.0, 0.55, 0.25), 900, 0.4, lit)
    # sun and sky: a warm marsh afternoon
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.4
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-150))
    ctx.objects.link(so)
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    bpy.context.scene.world = world
    oz = CUTAWAY_OFFSET[2]
    cams = {
        'exterior_road': ((30.0, 5.5, 40.0), (0.0, 9.0, 2.0), 30),
        'exterior_north': ((52.0, 16.0, -6.0), (2.0, 8.0, -8.0), 32),
        'exterior_aerial': ((-42.0, 44.0, 40.0), (0.0, 4.0, -6.0), 30),
        'cutaway': ((30.0, 40.0, oz + 38.0), (0.0, 1.0, oz - 7.0), 30),
        'doorway': ((0.0, 4.6, 16.5), (0.0, 3.2, -8.0), 26),
        'hearth': ((-6.5, 6.0, 12.0), (0.0, 0.2, 1.5), 28),
        'bar': ((-1.0, 5.2, 4.5), (9.0, 2.6, -8.5), 28),
        'stage': ((-4.0, 5.0, -1.0), (-12.3, 1.8, -11.5), 26),
        'nook': ((-1.5, 4.8, -9.0), (-1.5, 1.2, -20.0), 22),
        'roof': ((0.0, 3.0, 11.0), (0.0, 13.0, -6.0), 20),
        'scale_table': ((-4.5, 3.8, 9.0), (-11.5, 1.8, 2.0), 30),
        'scale_door': ((6.0, 3.2, 24.0), (0.0, 3.0, 13.0), 32),
        'front_road': ((2.0, 2.5, 46.0), (0.0, 6.0, 12.0), 28),
        'jetty': ((-7.0, 1.0, 21.0), (-9.0, 5.8, 14.0), 26),
        'terrace': ((-2.0, 3.0, 25.0), (-10.0, -2.0, 17.5), 30),
        'stable': ((-20.0, 3.0, 19.0), (-23.0, -1.5, 2.5), 26),
        'dog': ((-1.6, 1.6, 18.2), (-3.4, 0.1, 15.9), 30),
        'woodpile': ((26.0, 3.0, 14.0), (17.0, 1.0, 5.0), 30),
    }
    for name, (eye, look, lens) in cams.items():
        cam = bpy.data.cameras.new(f'Cam_{name}')
        cam.lens = lens
        cam.clip_start = 0.1
        cam.clip_end = 1000
        co = bpy.data.objects.new(f'Cam_{name}', cam)
        co.location = P(*eye)
        direction = P(*look) - P(*eye)
        co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        ctx.objects.link(co)
        if name == 'exterior_road':
            bpy.context.scene.camera = co


def render(out_dir, only=None):
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [
        v.identifier for v in type(scene.view_settings).bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    os.makedirs(out_dir, exist_ok=True)
    for o in bpy.data.objects:
        if o.type != 'CAMERA':
            continue
        name = o.name.replace('Cam_', '')
        if only and name not in only:
            continue
        scene.camera = o
        scene.render.filepath = os.path.join(out_dir, f'tavern_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)
    if '--render' in sys.argv:
        only = None
        if '--only' in sys.argv:
            only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
        render(sys.argv[sys.argv.index('--render') + 1], only)
