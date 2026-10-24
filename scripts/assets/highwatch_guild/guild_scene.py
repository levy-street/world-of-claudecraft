"""Review staging for the guild hall: a level pad round it, player-scale figures (2.6 yd to the
crown, the game's player) in the yard, on the porch, at the board, the counter, the table and
in the trophy hall, warm lights in every room, a sun or a night sky, and cameras.

Nothing here is exported: build_guild.py exports the HighwatchGuild_ROOT hierarchy before this
module adds anything. The trophies show and the heroic gilding hide in the review renders.

  blender --background --python scripts/assets/highwatch_guild/build_guild.py -- \
      --save guild.blend --render OUT_DIR [--only name,name]
"""
import math
import os

import bpy
from shiplib import P


def _move(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)



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


def _set_night(night):
    scene = bpy.context.scene
    sun = bpy.data.objects['Sun']
    sun.hide_render = night
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.03, 0.04, 0.08, 1) if night else (0.5, 0.62, 0.8, 1)
    bg.inputs['Strength'].default_value = 0.5 if night else 0.9


FLOOR = 0.6

# name: (camera position, look-at point, lens mm, night?)
CAMERAS = {
    'exterior_day': ((-30.0, 15.0, -52.0), (2.0, 9.0, -4.0), 28, False),
    'exterior_night': ((-24.0, 10.0, -58.0), (2.0, 11.0, -4.0), 28, True),
    'tower_side': ((44.0, 18.0, -34.0), (10.0, 12.0, -4.0), 30, False),
    'porch': ((-5.5, 3.6, -26.0), (0.0, 5.0, -12.0), 24, False),
    'scale': ((8.0, 3.2, -33.0), (0.0, 4.4, -18.0), 28, False),
    'hall_door': ((0.0, 6.4, -9.0), (0.0, 4.4, 8.0), 18, False),
    'hall_board': ((-4.0, 5.2, -6.0), (13.0, 3.6, 1.0), 20, False),
    'hall_counter': ((4.0, 5.0, -6.5), (-13.0, 3.4, 0.0), 20, False),
    'hall_back': ((-2.0, 6.0, -7.0), (2.0, 4.2, 9.0), 18, False),
    'trophy': ((0.0, 4.6, 11.0), (0.0, 5.0, 19.0), 18, False),
    'trophy_left': ((-5.0, 4.2, 12.0), (8.0, 5.0, 15.6), 20, False),
    'trophy_right': ((5.0, 4.2, 12.0), (-8.0, 5.0, 15.6), 20, False),
    'aerial': ((-44.0, 48.0, -54.0), (2.0, 4.0, -2.0), 30, False),
    'back': ((-18.0, 28.0, 52.0), (0.0, 8.0, 6.0), 30, False),
    'gate_day': ((-13.0, 2.6, -37.0), (-8.0, 4.6, -24.3), 26, False),
    'gate_night': ((-13.0, 2.6, -37.0), (-8.0, 4.6, -24.3), 26, True),
    'gate_wide': ((-22.0, 6.0, -44.0), (-4.0, 6.0, -18.0), 26, False),
}
FIGURES = {
    'Yard': (-2.0, 0.11, -23.0), 'Porch': (-1.2, FLOOR, -13.6), 'Board': (9.2, FLOOR, -0.6),
    'Counter': (-9.0, FLOOR, 0.4), 'Table': (7.3, FLOOR, 8.6), 'Fireside': (-9.2, FLOOR, 6.6),
    'Trophy': (1.4, FLOOR, 14.0),
    'Gate': (-7.0, 0.11, -27.0),
}


def sign_preview(coll):
    """Review-only lettering on the gateway's road face (the game paints the localized name
    at runtime, render/highwatch_guild_sign.ts): the name and the line under it."""
    from guild_plan import GATE as G
    ink = _mat('SignInk', (0.95, 0.74, 0.32), 0.4)
    face = G['board_t'] / 2 + 0.05
    for label, dy, size in (('LANTERN HALL', 0.16, 0.56), ("ADVENTURERS' GUILD", -0.34, 0.24)):
        curve = bpy.data.curves.new(f'Sign_{label}', 'FONT')
        curve.body = label
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.size = size
        obj = bpy.data.objects.new(f'SignPreview_{label}', curve)
        coll.objects.link(obj)
        obj.data.materials.append(ink)
        obj.location = P(G['x'], G['text_y'] + dy, G['z'] - face - 0.01)
        obj.rotation_euler = (math.pi / 2, 0.0, math.pi)


def stage(objs):
    scene = bpy.context.scene
    # draw the painted materials as the game does (their colours stored under the headroom)
    import guild_texture as TX
    TX.show_headroom(objs['mats'])
    looks = _collection('Review')
    ground(looks)
    body = _mat('FigureBody', (0.62, 0.12, 0.1), 0.7)
    head = _mat('FigureHead', (0.86, 0.7, 0.56), 0.6)
    for name, (x, y, z) in FIGURES.items():
        figure(name, x, y, z, looks, body, head)
    lights = _collection('GuildLights')
    warm = (1.0, 0.72, 0.42)
    point_light('Fireside', -13.0, FLOOR + 1.4, 6.6, (1.0, 0.6, 0.3), 7000, 1.0, lights)
    for sx in (1, -1):
        point_light(f'Chandelier{sx}', sx * 7.0, FLOOR + 9.8, 0.0, warm, 3800, 1.0, lights)
    point_light('Board', 12.0, FLOOR + 5.6, 0.0, warm, 1600, 0.6, lights)
    point_light('Trophy', 0.0, FLOOR + 1.6, 18.6, (1.0, 0.6, 0.3), 4200, 0.8, lights)
    point_light('TrophyHall', 0.0, FLOOR + 6.6, 15.0, warm, 1800, 0.8, lights)
    point_light('Porch', 0.0, FLOOR + 5.6, -14.4, warm, 900, 0.4, lights)
    point_light('Tower', 18.2, FLOOR + 22.2, -7.6, (1.0, 0.7, 0.36), 4000, 0.6, lights)
    for (lx, lz) in ((9.0, -23.4),):
        point_light('YardLamp', lx, 3.4, lz, warm, 260, 0.2, lights)
    for sx in (-1, 1):
        point_light('GateLantern', -8.0 + sx * 5.45, 4.6, -24.3, warm, 420, 0.25, lights)
    sign_preview(looks)
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
    for obj in objs['pieces'].values():
        if obj.name.startswith('G_INT_TrophyGilt_') and obj.name.endswith('_hidden'):
            obj.hide_render = True
    scene.camera = bpy.data.objects['Cam_exterior_day']
    return looks


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
