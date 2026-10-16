"""Review renders for the Wildheart Basin world entrance
(build_wildheart_entrance.py): beauty views with the 1.8 yd scale figure, lit
by the GAME's own fixed sun (it stands north-west, so the idol's face is in
shade all day, as it is in the engine), the lagoon as a plain sheet at the
game's water level, a Blender stand-in for the engine effects (the jade in the
throat and the eyes, the fire bowls), the top-down placement map and the
terrain-fit section profiles."""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402
import entrance_renders as er  # noqa: E402

B = ec.B
FIGURE_HEIGHT = 1.8     # the game's reference character height, in yards
# src/render/gfx.ts SUN_ANCHOR (90, 62, 50) in game axes, as a Blender vector.
GAME_SUN = (0.749, -0.416, 0.516)
# the way in: from the road's end at (-256, 1072), door-local for the door at (-237, 1093)
PATH = [(-19.0, -21.0), (-6.5, -17.0), (-1.6, -14.6), (-1.0, -10.0), (-0.3, -6.5), (0.0, -4.0), (0.0, 0.0)]


def figure(gr, lx, lz, yaw_deg, name):
    """The shared scale knight, resized from the entrance kit's 2.6 to 1.8 yd."""
    if not os.path.exists(ec.BLENDER_KNIGHT):
        return None
    holder = ec.import_knight(gr, lx, lz, yaw_deg=yaw_deg, name=name)
    k = FIGURE_HEIGHT / 2.6
    foot = gr.walk(lx, lz)
    holder.location.z = foot + (holder.location.z - foot) * k
    holder.scale = tuple(v * k for v in holder.scale)
    return holder


def scene(gr, water_y, sockets):
    """The terrain, the lagoon, the scale figures and the effect stand-ins."""
    ec.build_terrain(gr, 'palm', paths=[(PATH, 1.4)])
    mat = bpy.data.materials.new('SceneLagoon')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.03, 0.16, 0.17, 1)
    bsdf.inputs['Roughness'].default_value = 0.08
    bpy.ops.mesh.primitive_plane_add(size=240, location=(0, 0, water_y))
    water = bpy.context.active_object
    water.name = 'Scene_Lagoon'
    water.data.materials.append(mat)
    for (kx, kz, yaw, nm) in ((0.3, -2.6, 0, 'AtMaw'), (-1.4, -13.0, 5, 'AtTusks'), (11.5, 9.0, 30, 'OnBank'), (4.0, 20.5, 200, 'Behind')):
        figure(gr, kx, kz, yaw, 'Knight_' + nm)
    w = sockets['window']
    dark = ec.emissive_material('SceneThroat', (0.004, 0.012, 0.01), strength=1.0)
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(0, w['z'] + 0.06, (w['kerb'] + w['spring'] + w['rise']) / 2))
    th = bpy.context.active_object
    th.name = 'Scene_Throat'
    th.scale = (w['half'] * 2 + 0.6, w['spring'] + w['rise'] - w['kerb'] + 1.0, 1)
    th.rotation_euler = (math.pi / 2, 0, 0)
    th.data.materials.append(dark)
    objs = []
    film = ec.emissive_material('VFX_Throat', (0.08, 0.5, 0.26), strength=1.4)
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(0, w['z'], (w['kerb'] + w['spring'] + w['rise']) / 2))
    f = bpy.context.active_object
    f.name = 'VFX_Window'
    f.scale = (w['half'] * 2, w['spring'] + w['rise'] - w['kerb'], 1)
    f.rotation_euler = (math.pi / 2, 0, 0)
    f.data.materials.append(film)
    objs.append(f)
    lights = [('VFX_Maw', B(0, -0.6, 2.2), 500, (0.35, 1.0, 0.55), 0.6)]
    for i, (x, y, z) in enumerate(sockets['eyes']):
        lights.append((f'VFX_Eye{i}', B(x, z - 0.9, y), 260, (0.35, 1.0, 0.55), 0.4))
    for i, (x, y, z) in enumerate(sockets['braziers']):
        lights.append((f'VFX_Fire{i}', B(x, z, y + 0.5), 420, (1.0, 0.55, 0.2), 0.35))
    for (name, loc, energy, col, size) in lights:
        ld = bpy.data.lights.new(name, 'POINT')
        ld.energy = energy
        ld.color = col
        ld.shadow_soft_size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.scene.collection.objects.link(lo)
        objs.append(lo)
    coll = bpy.data.collections.new('VFX_Reference')
    bpy.context.scene.collection.children.link(coll)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


VIEWS = {
    'road': dict(name='desde_el_camino', cam=(-13.0, -27.0, ('eye', 2.6)), target=(0.0, 1.0, 8.0), lens=21),
    'apron': dict(name='subiendo_la_calzada', cam=(-0.8, -12.5, ('eye', 1.7)), target=(0.0, 0.5, 6.4), lens=17),
    'west': dict(name='desde_la_orilla_oeste', cam=(27.0, -3.0, ('eye', 1.7)), target=(0.5, 5.0, 7.0), lens=21),
    'back': dict(name='por_detras_desde_el_agua', cam=(11.0, 36.0, -3.6), target=(0.0, 8.0, 7.5), lens=24),
    'eyes': dict(name='los_ojos_de_cerca', cam=(2.0, -9.5, ('eye', 4.0)), target=(1.2, 1.0, 9.6), lens=30),
    'maw': dict(name='las_fauces_de_cerca', cam=(1.3, -4.6, ('eye', 1.75)), target=(0.0, 0.8, 2.6), lens=18),
    'ring': dict(name='desde_el_anillo_de_columnas', cam=(-14.0, -8.0, ('eye', 2.2)), target=(0.0, 1.5, 6.0), lens=22),
    'air': dict(name='vista_aerea', cam=(9.0, -31.0, 31.0), target=(1.0, 2.0, 2.0), lens=28),
    'far': dict(name='de_lejos_el_arbol_entero', cam=(-14.0, -52.0, ('eye', 3.0)), target=(0.0, 6.0, 12.0), lens=30),
    'dusk': {'name': 'atardecer_referencia_de_efectos', 'cam': (-12.0, -25.0, ('eye', 2.6)), 'target': (0.0, 0.0, 6.2),
             'lens': 22, 'sky': 'dusk', 'sky_strength': 0.5, 'sun_strength': 1.0, 'sun_color': (1.0, 0.6, 0.4),
             'sun_dir': (0.85, -0.3, 0.16), 'vfx': True, 'glare': True},
    'night': {'name': 'noche_referencia_de_efectos', 'cam': (-0.8, -10.5, ('eye', 2.2)), 'target': (0.0, 0.5, 5.2),
              'lens': 17, 'sky': 'night', 'sky_strength': 1.6, 'sun_strength': 0.5, 'sun_color': (0.55, 0.65, 1.0),
              'sun_dir': (-0.4, 0.5, 0.6), 'vfx': True, 'glare': True},
}


def run(out, GR, surr, colliders, mode, tag=''):
    """mode: 'all', 'maps', or a comma list of view keys (road,apron,west...)."""
    rd = os.path.join(out, 'renders', tag) if tag else os.path.join(out, 'renders')
    day = {'sky': 'day', 'sky_strength': 1.15, 'sun_dir': GAME_SUN, 'sun_strength': 4.2, 'sun_color': (1.0, 0.95, 0.84)}
    keys = list(VIEWS) if mode in ('all', 'maps') else [k for k in mode.split(',') if k in VIEWS]
    views = []
    for i, k in enumerate(keys):
        v = dict(day, **VIEWS[k]) if 'sky' not in VIEWS[k] else dict(VIEWS[k])
        v['name'] = f'{list(VIEWS).index(k) + 1:02d}_{v["name"]}'
        v.setdefault('res', (1440, 810))
        v.setdefault('samples', 32)
        views.append(v)
    cfg = {
        'name': 'wildheart_basin', 'out': out, 'views': views,
        'map_half': 30, 'map_title': 'Wildheart Basin entrance (the Jaguar Maw): door (-237, 1093)',
        'new_colliders': [dict(c, topLocalY=c['top']) for c in colliders],
        'new_paths': [(PATH, 1.2)], 'exit_drop': (0, -4),
        'extra_labels': [('maw = door', 0, 3.4, (1, 1, 1)), ('exit drop', 0, -4.7, (1, 0.7, 0.2)),
                         ('fire bowls', 6.6, -3.3, (1, 0.5, 0.5)), ('tusks', 7.0, -11.6, (1, 0.5, 0.5)),
                         ('fallen ear', -9.6, 2.8, (1, 0.5, 0.5))],
        'sections': [
            {'name': 'NS_por_las_fauces', 'axis': 'z', 'at': 0.0, 'span': (-24.0, 24.0), 'ylim': (-8.0, 26.0),
             'labels': [('S', -23.0, 24.0), ('N', 23.0, 24.0)]},
            {'name': 'EW_por_la_cara', 'axis': 'x', 'at': 1.2, 'span': (-20.0, 22.0), 'ylim': (-8.0, 26.0),
             'labels': [('E', -19.0, 24.0), ('W', 21.0, 24.0)]},
        ],
    }
    os.makedirs(rd, exist_ok=True)
    if mode != 'maps':
        _beauty(cfg, GR, rd)
    if mode in ('all', 'maps'):
        er.placement_map(cfg, GR, surr)
        er.sections(cfg, GR)


def _beauty(cfg, GR, rd):
    """entrance_renders.beauty with an output directory of its own."""
    vfx = er._vfx_objects()
    for v in cfg['views']:
        er._clear_world_lights()
        ec.setup_world(sky=v.get('sky', 'day'), strength=v.get('sky_strength', 1.0),
                       sun_dir=v.get('sun_dir', (-0.5, 0.6, 0.65)), sun_strength=v.get('sun_strength', 4.5),
                       sun_color=v.get('sun_color', (1.0, 0.95, 0.88)), mist=v.get('mist'))
        ec.setup_eevee(res=v['res'], samples=v['samples'])
        er._set_hidden(vfx, not v.get('vfx', False))
        cx, cz, cy = v['cam']
        if isinstance(cy, tuple):
            cy = GR.walk(cx, cz) + cy[1]
        tx, tz, ty = v['target']
        cam = ec.add_camera('cam_' + v['name'], B(cx, cz, cy), B(tx, tz, ty), lens=v.get('lens', 35))
        ec.set_glare(v.get('glare', False))
        ec.render(cam, os.path.join(rd, v['name'] + '.png'))
        ec.set_glare(False)
    er._set_hidden(vfx, True)
