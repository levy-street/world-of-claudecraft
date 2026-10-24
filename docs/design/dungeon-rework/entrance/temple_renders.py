"""Review renders for the Drowned Temple world entrance
(build_temple_entrance.py): beauty views with the 1.8 yd scale figure standing
on the stair's own walk surface, lit by the GAME's fixed sun, Blender stand-ins
for what the engine draws (the mirror's water, the gate's film, the moon in
the pool, and for the dusk and night views the moonrise's lights), the
top-down placement map and the terrain-fit section profiles."""
import math
import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402
import entrance_renders as er  # noqa: E402

B = ec.B
FIGURE_HEIGHT = 1.8     # the game's reference character height, in yards
# src/render/gfx.ts SUN_ANCHOR (90, 62, 50) in game axes, as a Blender vector.
GAME_SUN = (0.749, -0.416, 0.516)


def figure(gr, walk, lx, lz, yaw_deg, name):
    """The shared scale knight, resized to 1.8 yd, on the walk surface."""
    if not os.path.exists(ec.BLENDER_KNIGHT):
        return None
    holder = ec.import_knight(gr, lx, lz, yaw_deg=yaw_deg, name=name)
    k = FIGURE_HEIGHT / 2.6
    foot = gr.walk(lx, lz)
    holder.location.z = walk(lx, lz) + (holder.location.z - foot) * k
    holder.scale = tuple(v * k for v in holder.scale)
    return holder


def _collect(objs, name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)


def _glossy(name, rgb, rough=0.04):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Roughness'].default_value = rough
    return m


def dress(gr, stats, walk):
    """Scale figures, the engine's water as stand-ins (always shown), and the
    moonrise's lights (shown in the dusk and night views only)."""
    for (kx, kz, yaw, nm) in ((0.7, -7.4, 4, 'OnStair'), (2.6, -17.6, 12, 'Wading'), (-1.2, -2.0, 0, 'AtGate'),
                              (3.8, 9.4, 150, 'ByPool')):
        figure(gr, walk, kx, kz, yaw, 'Knight_' + nm)
    lv = stats['levels']
    water = []
    # the mirror
    bm = bmesh.new()
    st = stats['mirror']['step']
    for (x, z) in stats['mirror']['cells']:
        vs = [bm.verts.new(B(x + u, z + v, lv['water'])) for (u, v) in ((0, 0), (st, 0), (st, st), (0, st))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('WATER_Mirror')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('WATER_Mirror', me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(_glossy('WaterMirror', (0.012, 0.03, 0.035)))
    water.append(ob)
    # the gate's film: the ring's own circle, cut by the floor
    bm = bmesh.new()
    c = B(0, 0.05, lv['ringCentre'])
    r = lv['ringInner'] + 0.05
    hub = bm.verts.new((c.x, c.y, c.z))
    pts = []
    for i in range(48):
        a = math.tau * i / 48
        x, zz = math.cos(a) * r, math.sin(a) * r
        zz = max(zz, lv['dais'] + 0.5 - lv['ringCentre'])
        pts.append(bm.verts.new((c.x + x, c.y, c.z + zz)))
    for i in range(48):
        f = bm.faces.new((hub, pts[i], pts[(i + 1) % 48]))
        f.normal_update()
        if f.normal.y < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('WATER_Film')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('WATER_Film', me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(ec.emissive_material('FilmMat', (0.2, 0.36, 0.95), strength=2.4))
    water.append(ob)
    # the pool: dark water and the moon it holds
    pool = stats['sockets']['pool']
    for (nm, rad, dz, mat) in (('WATER_Pool', pool['r'] + 0.05, 0.0, _glossy('PoolMat', (0.008, 0.016, 0.03))),
                               ('WATER_PoolMoon', 1.15, 0.01, ec.emissive_material('PoolMoon', (0.86, 0.92, 1.0), strength=2.6)),
                               ('WATER_PoolHalo', 1.9, 0.005, ec.emissive_material('PoolHalo', (0.16, 0.22, 0.36), strength=1.0))):
        bpy.ops.mesh.primitive_circle_add(vertices=40, radius=rad, fill_type='NGON',
                                          location=B(pool['lx'], pool['lz'], pool['water'] + dz))
        o = bpy.context.active_object
        o.name = nm
        o.data.materials.append(mat)
        water.append(o)
    _collect(water, 'Water_Reference')
    # the moonrise at its crest: the gate's light, the pool's, the shaft over the crown
    objs = []
    for (name, loc, energy, col, size) in (('VFX_Gate', B(0, -1.6, lv['ringCentre']), 2600, (0.66, 0.78, 1.0), 2.0),
                                           ('VFX_GateLow', B(0, -6.0, lv['dais'] - 1.4), 500, (0.66, 0.78, 1.0), 1.0),
                                           ('VFX_Pool', B(pool['lx'], pool['lz'], pool['water'] + 1.0), 420, (0.8, 0.88, 1.0), 1.0),
                                           ('VFX_Foot', B(0, -14.5, lv['water'] + 0.6), 300, (0.62, 0.8, 1.0), 1.0)):
        ld = bpy.data.lights.new(name, 'POINT')
        ld.energy = energy
        ld.color = col
        ld.shadow_soft_size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.scene.collection.objects.link(lo)
        objs.append(lo)
    top = lv['ringCentre'] + lv['ringOuter']
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=1.1, radius2=2.4, depth=18, location=B(0, 0, top + 9.5))
    sh = bpy.context.active_object
    sh.name = 'VFX_Shaft'
    sh.data.materials.append(ec.emissive_material('ShaftMat', (0.5, 0.62, 0.9), strength=0.5, alpha=0.1))
    objs.append(sh)
    _collect(objs, 'VFX_Reference')


def run(out, GR, surr, colliders, mode, walk, tag=''):
    rd = os.path.join(out, 'renders', tag) if tag else os.path.join(out, 'renders')
    day = {'sky': 'day', 'sky_strength': 1.0, 'sun_dir': GAME_SUN, 'sun_strength': 4.2, 'sun_color': (1.0, 0.95, 0.86)}
    res = (1600, 900)
    views = [
        dict(day, name='01_desde_la_otra_orilla', cam=(3.0, -50.0, ('eye', 2.0)), target=(0.0, -4.0, 2.0), lens=30),
        dict(day, name='02_a_medio_camino', cam=(-5.0, -25.5, ('eye', 1.9)), target=(0.5, -3.0, 2.0), lens=24),
        dict(day, name='03_al_pie_de_la_escalera', cam=(2.4, -20.5, ('walk', 1.75)), target=(0.0, -3.0, 1.2), lens=22),
        dict(day, name='04_la_puerta_lunar', cam=(1.6, -9.6, ('walk', 1.75)), target=(0.0, 0.0, 5.2), lens=18),
        dict(day, name='05_el_estanque_lunar', cam=(5.4, 6.4, ('eye', 2.4)), target=(0.0, 13.6, 4.3), lens=22),
        dict(day, name='06_desde_detras', cam=(-3.0, 24.0, ('eye', 2.4)), target=(0.0, 3.0, 5.5), lens=24),
        dict(day, name='07_tres_cuartos_suroeste', cam=(21.0, -22.0, 4.0), target=(0.0, -7.0, 0.0), lens=26),
        dict(day, name='08_tres_cuartos_sureste', cam=(-22.0, -19.0, 3.0), target=(0.0, -7.0, 0.0), lens=26),
        dict(day, name='09_penitente_de_cerca', cam=(-2.6, -20.4, ('eye', 1.9)), target=(-6.7, -15.7, -2.9), lens=24),
        dict(day, name='10_el_anillo_y_los_cuernos', cam=(2.4, -6.4, ('walk', 1.7)), target=(-0.6, 0.0, 9.2), lens=24),
        dict(day, name='11_columnata_y_peldanos', cam=(1.7, -12.2, ('walk', 1.6)), target=(-3.4, -6.6, -0.6), lens=22),
        dict(day, name='12_la_presa_desde_la_poza', cam=(12.0, -36.0, ('eye', 1.9)), target=(1.0, -22.0, -5.0), lens=22),
        dict(day, name='13_camara_de_juego_subiendo', cam=(0.6, -15.5, ('walk', 4.6)), target=(0.2, -7.0, -2.4), lens=20),
        {'name': '14_atardecer_referencia_de_efectos', 'cam': (2.4, -20.5, ('walk', 1.75)), 'target': (0.0, -3.0, 1.2), 'lens': 22,
         'sky': 'dusk', 'sky_strength': 0.45, 'sun_strength': 1.0, 'sun_color': (1.0, 0.6, 0.4),
         'sun_dir': (0.85, -0.3, 0.16), 'vfx': True, 'glare': True},
        {'name': '15_noche_referencia_de_efectos', 'cam': (3.0, -50.0, ('eye', 2.0)), 'target': (0.0, -4.0, 2.0), 'lens': 30,
         'sky': 'night', 'sky_strength': 1.6, 'sun_strength': 0.5, 'sun_color': (0.55, 0.65, 1.0),
         'sun_dir': (-0.4, 0.5, 0.6), 'vfx': True, 'glare': True},
    ]
    if mode == 'quick':
        views = [views[i] for i in (0, 2, 3, 6, 8, 9, 10, 11)]
    for v in views:
        v.setdefault('res', res)
        v.setdefault('samples', 40)
    cfg = {
        'name': 'drowned_temple', 'out': out, 'views': views,
        'map_half': 34, 'map_title': 'Drowned Temple entrance (the Moon Stair): door (-70, 792)',
        'new_colliders': [dict(c, topLocalY=c['top']) for c in colliders],
        'new_paths': [], 'exit_drop': (0, -4),
        'extra_labels': [('moongate = door', 0, 3.4, (1, 1, 1)), ('moon stair', 6.5, -7.0, (1, 0.5, 0.5)),
                         ('mirror (engine water)', -12.0, -20.0, (0.5, 0.8, 1.0)), ('weir', -8.0, -30.5, (1, 0.5, 0.5)),
                         ('moon pool', 0, 18.6, (0.5, 0.8, 1.0)), ('exit drop', 0, -4.7, (1, 0.7, 0.2))],
        'sections': [
            {'name': 'NS_por_la_puerta', 'axis': 'z', 'at': 0.0, 'span': (-34.0, 22.0), 'ylim': (-13.0, 16.0),
             'labels': [('S', -33.0, 14.5), ('N', 21.0, 14.5)]},
            {'name': 'EW_por_la_escalera', 'axis': 'x', 'at': -7.0, 'span': (-14.0, 14.0), 'ylim': (-8.0, 10.0),
             'labels': [('E', -13.0, 8.5), ('W', 13.0, 8.5)]},
            {'name': 'EW_por_el_espejo', 'axis': 'x', 'at': -20.0, 'span': (-28.0, 18.0), 'ylim': (-14.0, 4.0),
             'labels': [('E', -27.0, 2.5), ('W', 17.0, 2.5)]},
        ],
    }
    os.makedirs(rd, exist_ok=True)
    if mode in ('all', 'beauty', 'quick'):
        _beauty(cfg, GR, rd, walk)
    if mode in ('all', 'maps'):
        cfg['out'] = out if not tag else os.path.join(out, 'renders', tag, '..', '..')
        er.placement_map(cfg, GR, surr)
        er.sections(cfg, GR)


def _beauty(cfg, GR, rd, walk):
    """entrance_renders.beauty with an output directory and the walk surface."""
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
            cy = max(GR.walk(cx, cz), walk(cx, cz)) + cy[1]
        tx, tz, ty = v['target']
        cam = ec.add_camera('cam_' + v['name'], B(cx, cz, cy), B(tx, tz, ty), lens=v.get('lens', 35))
        ec.set_glare(v.get('glare', False))
        ec.render(cam, os.path.join(rd, v['name'] + '.png'))
        ec.set_glare(False)
    er._set_hidden(vfx, True)
