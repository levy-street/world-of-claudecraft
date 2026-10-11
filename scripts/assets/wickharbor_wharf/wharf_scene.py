"""Review staging for the Wickharbor ferry wharf: the real terrain around the berth, the water,
the town's harbor decks the wharf joins (the shore boardwalk, the two north piers and the bluff
stairs, drawn as plain slabs), the route marker, the ferry lying at the berth, player-scale
figures, a sun, and cameras (one from the owner's report angle over the pier's root).

Nothing here is exported: build_wickharbor_wharf.py exports the WickharborWharf_ROOT hierarchy
before this module adds anything. The terrain patch is the game's own height field (layout.ts
--context writes it, with the harbor decks), so the model sits in the scene exactly as in game.
The helpers are the Wyrmwatch harbor's review staging (scripts/assets/wyrmwatch_harbor/
harbor_scene.py).

  npx tsx scripts/assets/wickharbor_wharf/layout.ts --context CONTEXT.json
  blender --background --python scripts/assets/wickharbor_wharf/build_wickharbor_wharf.py -- \
      --save muelle_wickharbor.blend --context CONTEXT.json [--render OUT_DIR]
  blender muelle_wickharbor.blend --python scripts/assets/wickharbor_wharf/open_wharf.py
"""
import json
import math
import os

import bpy
from mathutils import Matrix

import harbor_scene as HS
from shiplib import P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def harbor_decks(decks, coll):
    """The town's plank decks (the game draws them from the same rectangles) as slabs: a
    level deck flat at its height, a stair or ramp tilted from end to end."""
    wood = HS._mat('HarborDeckContext', (0.54, 0.41, 0.29), 0.9)
    for i, d in enumerate(decks):
        length = 2 * d['hl']
        rise = d['y1'] - d['y0']
        mid = (d['y0'] + d['y1']) / 2
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        o = bpy.context.object
        o.name = f'TownDeck_{i}'
        # Blender +Y turned onto the deck's +along (game (sin, cos) is Blender (sin, -cos)),
        # tilted so its far end stands at y1
        o.matrix_world = (Matrix.Translation(P(d['x'], mid - 0.08, d['z']))
                          @ Matrix.Rotation(d['rot'] + math.pi, 4, 'Z')
                          @ Matrix.Rotation(math.atan2(rise, length), 4, 'X')
                          @ Matrix.Diagonal((2 * d['hw'], math.hypot(length, rise), 0.16, 1.0)))
        o.data.materials.append(wood)
        HS._move(o, coll)


def stage(objs, context_path):
    import build_wickharbor_wharf as B

    layout = B.LAYOUT
    ctx = HS._collection('Context (not exported)')
    if context_path:
        HS.terrain(context_path, ctx)
        with open(context_path, encoding='utf8') as fh:
            harbor_decks(json.load(fh).get('harborDecks', []), ctx)
    HS.water(ctx)
    m = layout['marker']
    land = B.W2(21.5, 0.0)  # the berth's landing on the pier
    if m:
        yaw = math.atan2(-(land[1] - m['z']), land[0] - m['x'])
        src = os.path.join(ROOT, 'scripts', 'assets', 'harbor_route_marker', 'harbor_route_marker_source.glb')
        HS.import_glb(src, 'RouteMarker', (m['x'], layout['level'], m['z']), yaw, ctx)
    ship = os.path.join(ROOT, 'scripts', 'assets', 'eastbrook_ferry', 'eastbrook_ferry_source.glb')
    berth = layout['berth']
    if os.path.exists(ship):
        HS.import_glb(ship, 'Ferry_AtBerth', (berth['x'], 0.0, berth['z']), berth['rot'], ctx)
    body = HS._mat('FigureBody', (0.78, 0.18, 0.14), 0.7)
    head = HS._mat('FigureHead', (0.93, 0.74, 0.58), 0.6)
    ref = HS._collection('Player reference (2.6 yd = the game player)')
    level = layout['level']
    spots = {
        'Pier': (B.W2(8.6, 0.4), level),
        'BerthHead': (B.W2(28.0, 0.0), level),
        'Arm': (B.W2(11.05, 5.0), level),
        'Flight': (B.W2(11.05, 10.6), (B.FLIGHT['near'] + B.FLIGHT['far']) / 2),
        'Boardwalk': (B.W2(11.8, 14.5), layout['boardwalk']['top']),
    }
    for name, ((x, z), y) in spots.items():
        HS.figure(f'PlayerReference_{name}', x, y, z, ref, body, head)
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
    # the owner's report angle: over the shoulder of a player by the route marker, looking
    # out across the pier's root toward the ferry
    player = B.W2(8.6, 0.6)
    cams = {
        'owner': ((player[0] - 8.5, 14.0, player[1] + 7.0), (player[0] + 5.0, 3.0, player[1] - 3.0), 22),
        'overhead': ((16.0, 42.0, 10.0), (16.0, 2.0, 3.0), 30),
        'sea': ((46.0, 10.0, 24.0), (14.0, 3.0, 2.0), 32),
        'berth': ((36.0, 8.0, -8.0), (16.0, 3.0, 4.0), 32),
        'flight': ((4.0, 7.0, -12.0), (13.0, 2.0, -4.0), 30),
        'bluff': ((-9.0, 10.0, 3.0), (18.0, 2.0, 4.0), 30),
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
        if name == 'owner':
            bpy.context.scene.camera = co


def save(path):
    HS.save(path)
