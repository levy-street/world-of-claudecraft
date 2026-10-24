"""Review renders for the Sunken Bastion world entrance
(build_bastion_entrance.py): beauty views with the 1.8 yd scale figure, lit by
the GAME's own fixed sun (it stands north-west, so the gate's road face is in
shade all day, as it is in the engine), a Blender stand-in for the engine
effects (the green pulse behind the door, the rosette's pale core), the
top-down placement map and the terrain-fit section profiles."""
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


def vfx_reference(sockets):
    """Stand-ins for the engine's effects, in their own collection (hidden in
    the day views, never exported)."""
    objs = []
    w = sockets['window']
    film = ec.emissive_material('VFX_Water', (0.05, 0.42, 0.2), strength=1.6)
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(0, w['z'] - 0.02, (w['kerb'] + w['spring'] + w['rise']) / 2))
    f = bpy.context.active_object
    f.name = 'VFX_Window'
    f.scale = (w['half'] * 2, w['spring'] + w['rise'] - w['kerb'], 1)
    f.rotation_euler = (math.pi / 2, 0, 0)
    f.data.materials.append(film)
    objs.append(f)
    pl = sockets['pulse_light']
    ro = sockets['rosette']
    for (name, loc, energy, col, size) in (('VFX_Pulse', B(pl[0], pl[2], pl[1]), 420, (0.35, 1.0, 0.5), 0.5),
                                           ('VFX_PulseOut', B(0, -4.4, 0.6), 260, (0.35, 1.0, 0.5), 1.0),
                                           ('VFX_Rose', B(ro[0], ro[2] - 0.9, ro[1]), 160, (0.75, 0.9, 1.0), 0.4)):
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


def run(out, GR, surr, colliders, mode, path, tag=''):
    rd = os.path.join(out, 'renders', tag) if tag else os.path.join(out, 'renders')
    day = {'sky': 'fog', 'sky_strength': 1.0, 'sun_dir': GAME_SUN, 'sun_strength': 4.0, 'sun_color': (1.0, 0.95, 0.86)}
    res = (1600, 900)
    views = [
        dict(day, name='01_desde_el_camino_a_40', cam=(-19.4, -35.0, ('eye', 1.75)), target=(0.0, -2.0, 2.5), lens=30),
        dict(day, name='02_desde_el_camino_a_20', cam=(-9.5, -18.5, ('eye', 1.75)), target=(0.0, -2.0, 3.2), lens=24),
        dict(day, name='03_la_puerta_de_cerca', cam=(-1.5, -9.2, ('eye', 1.75)), target=(0.0, -2.6, 2.6), lens=20),
        dict(day, name='04_tres_cuartos_suroeste', cam=(19.0, -21.0, -3.0), target=(1.0, -1.0, 3.0), lens=28),
        dict(day, name='05_tres_cuartos_sureste', cam=(-21.0, -17.0, 1.5), target=(-1.0, -1.0, 2.6), lens=28),
        dict(day, name='06_linea_de_marea_de_cerca', cam=(3.6, -7.6, ('eye', 1.7)), target=(4.6, -3.4, 0.6), lens=24),
        dict(day, name='07_desde_la_loma_por_detras', cam=(-9.0, 15.5, ('eye', 2.2)), target=(0.5, -1.0, 4.0), lens=26),
        dict(day, name='08_roseton_y_rastrillo', cam=(-2.2, -8.6, ('eye', 1.75)), target=(0.0, -3.4, 5.2), lens=30),
        dict(day, name='09_camara_de_juego_en_la_puerta', cam=(1.0, -13.5, ('eye', 4.2)), target=(0.3, -3.6, 0.2), lens=22),
        dict(day, name='10_el_patio_y_la_puerta_interior', cam=(0.5, -3.4, ('eye', 1.75)), target=(0.0, 0.2, 2.1), lens=16),
        {'name': '11_atardecer_referencia_de_efectos', 'cam': (-4.5, -13.5, ('eye', 1.8)), 'target': (0.0, -2.0, 3.0), 'lens': 24,
         'sky': 'dusk', 'sky_strength': 0.45, 'sun_strength': 1.0, 'sun_color': (1.0, 0.6, 0.4),
         'sun_dir': (0.85, -0.3, 0.16), 'vfx': True, 'glare': True},
        {'name': '12_noche_referencia_de_efectos', 'cam': (-9.5, -18.5, ('eye', 1.75)), 'target': (0.0, -2.0, 3.2), 'lens': 24,
         'sky': 'night', 'sky_strength': 1.6, 'sun_strength': 0.5, 'sun_color': (0.55, 0.65, 1.0),
         'sun_dir': (-0.4, 0.5, 0.6), 'vfx': True, 'glare': True},
    ]
    if mode == 'quick':
        views = [views[i] for i in (0, 1, 2, 3, 5, 6, 7, 10)]
    for v in views:
        v.setdefault('res', res)
        v.setdefault('samples', 40)
    cfg = {
        'name': 'sunken_bastion', 'out': out, 'views': views,
        'map_half': 26, 'map_title': 'Sunken Bastion entrance (the Drowned Gate Tower): door (45, 515)',
        'new_colliders': [dict(c, topLocalY=c['top']) for c in colliders],
        'new_paths': [(path, 1.2)], 'exit_drop': (0, -4),
        'extra_labels': [('inner arch = door', 0, 7.6, (1, 1, 1)), ('outer arch + portcullis', 0, -5.6, (1, 0.5, 0.5)),
                         ('exit drop', 0, -4.7, (1, 0.7, 0.2)), ('curtain wall', -17.5, 8.4, (1, 0.5, 0.5)),
                         ('fallen stones', -11.0, -11.6, (1, 0.5, 0.5)), ('winch', 3.6, -1.6, (1, 0.5, 0.5))],
        'sections': [
            {'name': 'NS_por_la_puerta', 'axis': 'z', 'at': 0.0, 'span': (-20.0, 10.0), 'ylim': (-12.0, 12.0),
             'labels': [('S', -19.0, 10.5), ('N', 9.0, 10.5)]},
            {'name': 'EW_por_las_torres', 'axis': 'x', 'at': -1.2, 'span': (-22.0, 14.0), 'ylim': (-9.0, 13.0),
             'labels': [('E', -21.0, 11.5), ('W', 13.0, 11.5)]},
        ],
    }
    os.makedirs(rd, exist_ok=True)
    if mode in ('all', 'beauty', 'quick'):
        _beauty(cfg, GR, rd)
    if mode in ('all', 'maps'):
        cfg['out'] = out if not tag else os.path.join(out, 'renders', tag, '..', '..')
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
