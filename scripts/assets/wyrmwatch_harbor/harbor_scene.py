"""Review staging for the Wyrmwatch cliff harbor: the real terrain around the berth, the
water, the ferry pier and its route marker, the ferry lying at the berth, player-scale
figures on the quay, the stair and the top landing, a sun, and cameras.

Nothing here is exported: build_wyrmwatch_harbor.py exports the WyrmwatchHarbor_ROOT
hierarchy before this module adds anything. The terrain patch is the game's own height
field (layout.ts --context writes it), so the model sits in the scene exactly as in game.

  npx tsx scripts/assets/wyrmwatch_harbor/layout.ts --context TERRAIN.json
  blender --background --python scripts/assets/wyrmwatch_harbor/build_wyrmwatch_harbor.py -- \
      --save wyrmwatch_harbor.blend --context TERRAIN.json [--render OUT_DIR]
  blender wyrmwatch_harbor.blend --python scripts/assets/wyrmwatch_harbor/open_harbor.py
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector
from shiplib import P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PLAYER_H = 2.6  # the player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts)
CUTAWAY_OFFSET = (26.0, 0.0, -20.0)  # the house's cutaway copy, out on the water to the north-east


def _mat(name, color, rough=0.8, emit=0.0, alpha=1.0, vertex=False):
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
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m


def _collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def _move(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def _box(name, center, size, mat, coll):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=P(*center))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    o.data.materials.append(mat)
    _move(o, coll)
    return o


def terrain(path, coll):
    """The game's height field around the harbor as a vertex-coloured mesh."""
    with open(path, encoding='utf8') as fh:
        g = json.load(fh)
    nx, nz, step = g['nx'], g['nz'], g['step']
    verts, faces = [], []
    for j in range(nz):
        for i in range(nx):
            verts.append(P(g['x0'] + i * step, g['h'][j * nx + i], g['z0'] + j * step))
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + 1, a + nx + 1, a + nx))
    mesh = bpy.data.meshes.new('Terrain')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for poly in mesh.polygons:
        ys = [mesh.vertices[v].co.z for v in poly.vertices]
        h = sum(ys) / len(ys)
        steep = 1 - poly.normal.z
        if h < 0.5:
            c = (0.62, 0.52, 0.36)          # wet sand and shingle
        elif steep > 0.35:
            c = (0.36, 0.27, 0.21)          # bare cliff rock
        else:
            c = (0.44, 0.38, 0.2) if h > 6 else (0.5, 0.42, 0.28)
        for li in poly.loop_indices:
            col.data[li].color = (c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2, 1)
    obj = bpy.data.objects.new('Terrain', mesh)
    obj.data.materials.append(_mat('TerrainMat', (1, 1, 1), 0.95, vertex=True))
    coll.objects.link(obj)
    return obj


def water(coll):
    bpy.ops.mesh.primitive_plane_add(size=200, location=P(0, 0, 0))
    o = bpy.context.object
    o.name = 'Water'
    o.data.materials.append(_mat('WaterMat', (0.1, 0.42, 0.46), 0.15, alpha=0.72))
    _move(o, coll)
    return o


def pier(layout, coll):
    """The existing ferry pier (the game draws it from its deck): planks and piles, for context."""
    p = layout['pier']
    wood = _mat('PierWood', (0.36, 0.25, 0.16), 0.9)
    x0, x1 = p['x'] - p['hl'], p['x'] + p['hl']
    _box('Pier_Deck', (p['x'], p['top'] - 0.08, p['z']), (x1 - x0, 0.16, p['hw'] * 2), wood, coll)
    x = x0 + 1.0
    while x < x1:
        for s in (-1, 1):
            _box('Pier_Pile', (x, (p['top'] - 3.2) / 2, p['z'] + s * (p['hw'] - 0.3)), (0.3, p['top'] + 3.2, 0.3), wood,
                 coll)
        x += 2.2


def import_glb(path, name, location, yaw, coll):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for o in new:
        _move(o, coll)
    for r in roots:
        r.name = name
        r.location = P(*location)
        r.rotation_mode = 'XYZ'
        r.rotation_euler = (0, 0, yaw)
    return roots


def figure(name, x, y, z, coll, body, head):
    """The chibi player stand-in: 2.6 yd to the crown (the game's player, a person of
    about 1.8 m), big head."""
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


def stage(objs, context_path):
    import build_wyrmwatch_harbor as B

    layout = B.LAYOUT
    ctx = _collection('Context (not exported)')
    if context_path:
        terrain(context_path, ctx)
    water(ctx)
    pier(layout, ctx)
    m = layout['marker']
    if m:
        land = (13.5, -5.8)  # the berth's landing, model frame
        yaw = math.atan2(-(land[1] - m['z']), land[0] - m['x'])
        src = os.path.join(ROOT, 'scripts', 'assets', 'harbor_route_marker', 'harbor_route_marker_source.glb')
        import_glb(src, 'RouteMarker', (m['x'], layout['pier']['top'], m['z']), yaw, ctx)
    ship = os.path.join(ROOT, 'scripts', 'assets', 'eastbrook_ferry', 'eastbrook_ferry_source.glb')
    if os.path.exists(ship):
        import_glb(ship, 'Ferry_AtBerth', (25.0, 0.0, -5.0), math.pi, ctx)
    body = _mat('FigureBody', (0.78, 0.18, 0.14), 0.7)
    head = _mat('FigureHead', (0.93, 0.74, 0.58), 0.6)
    ref = _collection('Player reference (2.6 yd = the game player)')
    d = {q['id']: q for q in layout['decks']}
    figure('PlayerReference_Quay', 5.2, d['southQuay']['near'], -1.0, ref, body, head)
    figure('PlayerReference_Yard', 0.6, d['northYard']['near'], -11.5, ref, body, head)
    figure('PlayerReference_Stair', 1.4, 7.05, 8.9, ref, body, head)
    figure('PlayerReference_Top', 0.2, d['topLanding']['near'], 3.4, ref, body, head)
    # the Harbormaster's House: figures inside it (by the hearth, at the chart table) and in
    # its doorway, and a cutaway copy of it out on the water to the east (the walls on the
    # door and sea sides and the roof left off) with the same figures, so the room reads
    house = layout['house']
    hf = house['floor']
    hearth = next(q for q in house['props'] if q['kind'] == 'hearth')
    table = next(q for q in house['props'] if q['kind'] == 'chartTable')
    spots = {
        'Hearth': (hearth['x'] + hearth['hw'] + 1.3, hearth['z'] + 0.4),
        'Table': (table['x'] - 0.4, table['z'] + table['hd'] + 0.8),
        'Door': (house['door']['x'], house['z'] + house['hd'] + 0.9),
    }
    for name, (fx, fz) in spots.items():
        figure(f'PlayerReference_House{name}', fx, hf, fz, ref, body, head)
    cut = _collection('House cutaway (not exported)')
    for name in ('HouseFrame', 'HouseWallNorth', 'HouseWallWest', 'HouseFurnishings'):
        src = objs['pieces'][name]
        dup = src.copy()
        dup.name = f'{name}_Cutaway'
        dup.parent = None
        cut.objects.link(dup)
        dup.matrix_world = Matrix.Translation(P(*CUTAWAY_OFFSET)) @ src.matrix_world
    for name, (fx, fz) in spots.items():
        figure(f'PlayerReference_Cutaway{name}', fx + CUTAWAY_OFFSET[0], hf, fz + CUTAWAY_OFFSET[2], cut, body,
               head)
    # sun and sky: the game's warm afternoon
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = (math.radians(48), math.radians(12), math.radians(-35))
    ctx.objects.link(so)
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    bpy.context.scene.world = world
    cams = {
        'sea': ((27.0, 12.0, -36.0), (2.0, 4.5, 2.0), 40),
        'yard': ((9.0, 7.5, -25.0), (-0.5, 4.0, -13.0), 45),
        'quay': ((9.5, 4.2, -8.5), (2.5, 6.5, 8.0), 55),
        'top': ((-10.0, 17.0, 8.0), (6.0, 4.0, -2.0), 50),
        'south': ((12.0, 9.0, 30.0), (3.0, 5.0, 8.0), 45),
        'gate': ((-12.0, 11.0, 4.5), (0.0, 11.0, 3.4), 50),
        'wide': ((48.0, 32.0, 30.0), (-6.0, 5.0, -1.0), 35),
        'house': ((12.0, 12.0, -38.0), (3.0, 7.0, -19.0), 32),
        'cutaway': ((40.0, 20.0, -10.0), (29.0, 3.5, -39.0), 30),
    }
    for name, (eye, look, lens) in cams.items():
        cam = bpy.data.cameras.new(f'Cam_{name}')
        cam.lens = lens
        cam.clip_end = 1000
        co = bpy.data.objects.new(f'Cam_{name}', cam)
        co.location = P(*eye)
        direction = P(*look) - P(*eye)
        co.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        ctx.objects.link(co)
        if name == 'sea':
            bpy.context.scene.camera = co


def render(out_dir):
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    os.makedirs(out_dir, exist_ok=True)
    for o in bpy.data.objects:
        if o.type == 'CAMERA':
            scene.camera = o
            scene.render.filepath = os.path.join(out_dir, f"{o.name.replace('Cam_', 'harbor_')}.png")
            bpy.ops.render.render(write_still=True)
            print('RENDERED', scene.render.filepath)


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)
    if '--render' in sys.argv:
        render(sys.argv[sys.argv.index('--render') + 1])
