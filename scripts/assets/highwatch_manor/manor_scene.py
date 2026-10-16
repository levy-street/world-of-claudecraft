"""Review staging for the Highwatch manor: a level pad of grass round it, player-scale figures
(2.6 yd to the crown, the game's player) at the gate, on the porch, by the hearth, at the high
table, in each wing, warm lights in every room, a sun or a night sky, and cameras.

Nothing here is exported: build_manor.py exports the HighwatchManor_ROOT hierarchy before this
module adds anything.

  blender --background --python scripts/assets/highwatch_manor/build_manor.py -- \
      --save manor.blend --render OUT_DIR [--only name,name]
"""
import math
import os

import bpy
from shiplib import P

PLAYER_H = 2.6
FLOOR = 0.6

# name: (camera position, look-at point, lens mm, night?)
CAMERAS = {
    'exterior_day': ((-34.0, 16.0, -62.0), (0.0, 9.0, -6.0), 30, False),
    'exterior_night': ((-26.0, 12.0, -70.0), (0.0, 12.0, -4.0), 30, True),
    'porch': ((-5.5, 3.6, -27.0), (0.0, 5.0, -12.0), 24, False),
    'great_hall': ((7.5, 6.8, -9.0), (-2.0, 4.0, 6.0), 18, False),
    'great_hall_dais': ((-3.0, 6.0, -8.8), (1.0, 5.5, 14.0), 18, False),
    'dining': ((15.0, 5.6, -6.4), (21.0, 2.2, 4.6), 18, False),
    'library': ((-14.8, 5.4, -6.2), (-21.0, 2.8, 2.0), 18, False),
    'chapel': ((-18.8, 4.2, 5.8), (-18.8, 3.4, 12.4), 20, False),
    'kitchen': ((22.8, 5.2, 9.0), (17.4, 1.8, 13.6), 18, False),
    'scale': ((9.0, 3.4, -36.0), (0.0, 4.6, -18.0), 28, False),
    'aerial': ((-48.0, 52.0, -58.0), (0.0, 4.0, -4.0), 30, False),
    'east_side': ((-52.0, 20.0, 8.0), (-16.0, 8.0, 2.0), 30, False),
    'back': ((10.0, 26.0, 52.0), (0.0, 8.0, 4.0), 30, False),
}
FIGURES = {
    'Gate': (0.0, 0.0, -29.6), 'Path': (1.2, 0.0, -22.4), 'Porch': (-1.2, FLOOR, -14.0),
    'Hearth': (3.6, FLOOR, -4.0), 'Dais': (-1.4, FLOOR + 0.4, 11.0), 'Dining': (16.2, FLOOR, -1.2),
    'Library': (-16.2, FLOOR, -3.0), 'Chapel': (-18.8, FLOOR, 6.6), 'Kitchen': (21.4, FLOOR, 10.4),
}


def _mat(name, color, rough=0.8, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
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


def ground(coll):
    bpy.ops.mesh.primitive_plane_add(size=200, location=P(0, -0.02, -10))
    g = bpy.context.object
    g.name = 'Pad'
    g.data.materials.append(_mat('PadMat', (0.24, 0.32, 0.18), 0.95))
    _move(g, coll)


def figure(name, x, y, z, coll, body, head):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42, depth=1.45, location=P(x, y + 0.72, z))
    b = bpy.context.object
    b.name = f'Figure_{name}_body'
    b.data.materials.append(body)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.58, location=P(x, y + 1.98, z))
    h = bpy.context.object
    h.name = f'Figure_{name}_head'
    h.data.materials.append(head)
    for o in (b, h):
        _move(o, coll)


def point_light(name, x, y, z, color, energy, radius, coll):
    light = bpy.data.lights.new(name, 'POINT')
    light.color = color
    light.energy = energy
    light.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, light)
    obj.location = P(x, y, z)
    coll.objects.link(obj)
    return obj


def stage(objs):
    scene = bpy.context.scene
    looks = _collection('Review')
    ground(looks)
    body = _mat('FigureBody', (0.62, 0.12, 0.1), 0.7)
    head = _mat('FigureHead', (0.86, 0.7, 0.56), 0.6)
    for name, (x, y, z) in FIGURES.items():
        figure(name, x, y, z, looks, body, head)
    lights = _collection('ManorLights')
    warm = (1.0, 0.72, 0.42)
    point_light('Hearth', 0.0, FLOOR + 1.6, 0.0, (1.0, 0.6, 0.3), 9000, 1.2, lights)
    for sx in (1, -1):
        point_light(f'HallChandelier{sx}', sx * 6.5, FLOOR + 9.8, 0.0, warm, 3500, 1.0, lights)
    point_light('Lantern', 0.0, 21.8, 0.0, (1.0, 0.78, 0.46), 6000, 1.5, lights)
    point_light('Dais', 0.0, FLOOR + 3.0, 13.4, warm, 1800, 0.6, lights)
    point_light('Dining', 18.9, FLOOR + 7.2, 0.2, warm, 3000, 0.8, lights)
    point_light('Kitchen', 20.3, FLOOR + 1.4, 13.0, (1.0, 0.56, 0.26), 2600, 0.6, lights)
    point_light('Library', -18.9, FLOOR + 7.2, -1.0, warm, 2600, 0.8, lights)
    point_light('Chapel', -18.8, FLOOR + 2.6, 10.6, warm, 1200, 0.4, lights)
    point_light('Porch', 0.0, FLOOR + 5.6, -14.4, warm, 900, 0.4, lights)
    for (lx, lz) in ((-3.9, -25.6), (3.9, -25.6), (-3.9, -21.2), (3.9, -21.2)):
        point_light('GardenLamp', lx, 3.4, lz, warm, 250, 0.2, lights)
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('Sun', sun)
    so.rotation_euler = (math.radians(52), math.radians(8), math.radians(-38))
    looks.objects.link(so)
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.5, 0.62, 0.8, 1)
    bg.inputs['Strength'].default_value = 0.9
    scene.world = world
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [
        i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    for name, (pos, look, lens, _night) in CAMERAS.items():
        cam = bpy.data.cameras.new(name)
        cam.lens = lens
        cam.clip_end = 1000
        co = bpy.data.objects.new(f'Cam_{name}', cam)
        co.location = P(*pos)
        d = P(*look) - P(*pos)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        looks.objects.link(co)
    scene.camera = bpy.data.objects['Cam_exterior_day']
    return looks


def _set_night(night):
    scene = bpy.context.scene
    sun = bpy.data.objects['Sun']
    sun.hide_render = night
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.03, 0.04, 0.08, 1) if night else (0.5, 0.62, 0.8, 1)
    bg.inputs['Strength'].default_value = 0.5 if night else 0.9


def render_all(out_dir, only=None):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    wanted = set(only.split(',')) if only else None
    for name, (_pos, _look, _lens, night) in CAMERAS.items():
        if wanted and name not in wanted:
            continue
        _set_night(night)
        scene.camera = bpy.data.objects[f'Cam_{name}']
        scene.render.filepath = os.path.join(out_dir, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', name)
    _set_night(False)


def save(path):
    bpy.context.scene.camera = bpy.data.objects['Cam_exterior_day']
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)
