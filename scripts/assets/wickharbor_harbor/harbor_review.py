"""Review staging for Wickharbor's wooden harbor: the real terrain round the whole harbor, the
water, the Wickharbor ferry wharf (its own model, in the same wood) at its berth, the ferry lying
there, player-scale figures on every deck and stair, a sun, and cameras.

Nothing here is exported: build_wickharbor_harbor.py exports the WickharborHarbor_ROOT hierarchy
before this module adds anything. The terrain patch is the game's own height field (layout.ts
--context writes it), so the model sits in the scene exactly as in game. The helpers are the
Wyrmwatch harbor's review staging (scripts/assets/wyrmwatch_harbor/harbor_scene.py).

  npx tsx scripts/assets/wickharbor_harbor/layout.ts --context CONTEXT.json
  blender --background --python scripts/assets/wickharbor_harbor/build_wickharbor_harbor.py -- \
      --save puerto_wickharbor.blend --context CONTEXT.json [--render OUT_DIR]
  blender puerto_wickharbor.blend --python scripts/assets/wickharbor_harbor/open_harbor.py
"""
import math
import os

import bpy

import harbor_scene as HS
from shiplib import P

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def stage(objs, context_path):
    import build_wickharbor_harbor as B

    layout = B.LAYOUT
    ctx = HS._collection('Context (not exported)')
    if context_path:
        HS.terrain(context_path, ctx)
    HS.water(ctx)
    wo = layout['wharfOrigin']
    wharf = os.path.join(ROOT, 'scripts', 'assets', 'wickharbor_wharf', 'wickharbor_wharf_source.glb')
    if os.path.exists(wharf):
        HS.import_glb(wharf, 'WickharborWharf', (wo['x'], 0.0, wo['z']), 0.0, ctx)
    body = HS._mat('FigureBody', (0.78, 0.18, 0.14), 0.7)
    head = HS._mat('FigureHead', (0.93, 0.74, 0.58), 0.6)
    ref = HS._collection('Player reference (2.6 yd = the game player)')
    d = B.DECKS
    spots = {
        'Boardwalk': ('boardwalk', 1.5, 0.0),
        'PierNorth': ('pierNorth', 4.0, 0.2),
        'PierMiddle': ('pierMiddle', 1.0, 0.4),
        'QuayNorth': ('quayNorth', 0.0, 0.0),
        'QuaySouth': ('quaySouth', -2.0, 0.0),
        'StairSouth': ('stairSouth', 0.0, 0.0),
        'StairNorth': ('stairNorth', 0.0, 0.0),
        'BeaconDock': ('beaconPier', 3.0, 0.0),
        'BeaconStair': ('beaconStair', -1.0, 0.0),
    }
    for name, (deck, a, c) in spots.items():
        x, z = B.at(d[deck], a, c)
        HS.figure(f'PlayerReference_{name}', x, B.surf(d[deck], a), z, ref, body, head)
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
        'wide': ((52.0, 38.0, 30.0), (8.0, 1.0, -2.0), 30),
        'boardwalk': ((10.0, 7.0, 16.0), (-1.0, 1.5, -6.0), 32),
        'piers': ((34.0, 12.0, 14.0), (6.0, 1.0, 0.0), 30),
        'stairs': ((12.0, 8.0, 0.0), (-6.0, 3.0, -1.0), 30),
        'beacon': ((70.0, 16.0, -4.0), (44.0, 3.0, -26.0), 30),
        'beacon_stair': ((24.0, 14.0, -40.0), (42.0, 3.0, -24.0), 30),
        'wharf_join': ((-4.0, 6.5, 14.0), (0.5, 1.5, 8.5), 30),
        'pier_north_root': ((8.0, 5.0, -2.0), (2.5, 1.0, -8.0), 30),
        'stair_south_foot': ((4.0, 4.5, 9.5), (-2.0, 1.4, 4.4), 30),
        'owner': ((-20.0, 20.0, 4.0), (10.0, 0.0, 6.0), 26),
        'quay_from_sea': ((42.0, 11.0, 16.0), (8.0, 1.5, 8.0), 28),
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
        if name == 'wide':
            bpy.context.scene.camera = co


def save(path):
    HS.save(path)
