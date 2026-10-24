"""Review renders for the Hollow Crypt world entrance (build_crypt_entrance.py):
beauty views with the 1.8 yd scale figure, the Blender reference of the engine
effects (soul light, grave mist, candle flames, wisps, the rose window's pale
shaft), the top-down placement map and the terrain-fit section profiles."""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402
import entrance_renders as er  # noqa: E402

B = ec.B
FIGURE_HEIGHT = 1.8     # the game's reference character height, in yards


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


def vfx_reference(sockets, candles, sill):
    """Stand-ins for the engine's effects, in their own collection (hidden in
    the day views, never exported)."""
    objs = []
    rng = random.Random(11)
    flame = ec.emissive_material('VFX_Flame', (0.62, 0.34, 1.0), strength=14.0)
    core = ec.emissive_material('VFX_FlameCore', (0.95, 0.85, 1.0), strength=22.0)
    for (lx, y, lz, _h) in candles:
        for (mat, r, hh) in ((flame, 0.035, 0.16), (core, 0.016, 0.08)):
            bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=r, radius2=0.0, depth=hh, location=B(lx, lz, y + hh / 2))
            o = bpy.context.active_object
            o.name = 'VFX_Flame'
            o.data.materials.append(mat)
            objs.append(o)
    lights = [('VFX_SoulLight', sockets['soul_light'], 130, (0.5, 0.42, 1.0), 0.6),
              ('VFX_SillGlow', sockets['mist'], 30, (0.6, 0.45, 1.0), 0.3),
              ('VFX_Rose', [sockets['rose'][0], sockets['rose'][1], sockets['rose'][2] + 1.2], 300, (0.7, 0.78, 1.0), 1.5)]
    for k, (lx, y, lz, _h) in enumerate(candles):
        if k % 4 == 0:
            lights.append((f'VFX_Candle{k}', [lx, y + 0.1, lz], 9, (0.75, 0.5, 1.0), 0.1))
    for (name, s, energy, col, size) in lights:
        ld = bpy.data.lights.new(name, 'POINT')
        ld.energy = energy
        ld.color = col
        ld.shadow_soft_size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = B(s[0], s[2], s[1])
        bpy.context.scene.collection.objects.link(lo)
        objs.append(lo)
    # The stair's glow: a dim violet sheet deep in the arch, and the mist as a
    # true low volume spilling over the sill and down the nave.
    w = sockets['well']
    film = ec.emissive_material('VFX_StairGlow', (0.16, 0.08, 0.42), strength=0.45)
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(0, w['z1'] - 0.05, 1.9))
    f = bpy.context.active_object
    f.name = 'VFX_StairGlow'
    f.scale = (w['x1'] - w['x0'], 3.6, 1)
    f.rotation_euler = (math.pi / 2, 0, 0)
    f.data.materials.append(film)
    objs.append(f)
    mist = bpy.data.materials.new('VFX_Mist')
    mist.use_nodes = True
    nt = mist.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.55
    noise.inputs['Detail'].default_value = 3.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.75
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 0.42
    vol.inputs['Color'].default_value = (0.62, 0.6, 0.95, 1)
    vol.inputs['Emission Color'].default_value = (0.3, 0.22, 0.75, 1)
    vol.inputs['Emission Strength'].default_value = 0.05
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], mul.inputs[0])
    nt.links.new(mul.outputs[0], vol.inputs['Density'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    for (lx, lz, sx, sz, h) in ((0, -3.0, 9.0, 8.0, 0.55), (0, 1.5, 2.5, 4.0, 1.2), (-2.5, -12, 12.0, 12.0, 0.4),
                                (-14.5, -9.0, 8.0, 7.0, 0.45), (14.2, -16.5, 8.0, 7.0, 0.45)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=B(lx, lz, h / 2 + 0.05))
        c = bpy.context.active_object
        c.name = 'VFX_MistVolume'
        c.scale = (sx, sz, h)
        c.data.materials.append(mist)
        objs.append(c)
    # Will-o-wisps in the nave and the yard.
    wisp = ec.emissive_material('VFX_Wisp', (0.55, 0.85, 0.95), strength=30.0)
    for _ in range(9):
        lx, lz = rng.uniform(-7, 7), rng.uniform(-20, -4)
        y = rng.uniform(1.0, 3.4)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.045, location=B(lx, lz, y))
        o = bpy.context.active_object
        o.name = 'VFX_Wisp'
        o.data.materials.append(wisp)
        objs.append(o)
        ld = bpy.data.lights.new('VFX_WispL', 'POINT')
        ld.energy = 7
        ld.color = (0.55, 0.85, 0.95)
        lo = bpy.data.objects.new('VFX_WispL', ld)
        lo.location = B(lx, lz, y)
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
    day = {'sky': 'day', 'sky_strength': 0.95, 'sun_dir': (0.55, 0.62, 0.52), 'sun_strength': 5.0,
           'sun_color': (1.0, 0.93, 0.8)}
    res = (1600, 900)
    views = [
        dict(day, name='01_llegada_a_la_altura_de_los_ojos', cam=(-9.0, -50.0, ('eye', 1.75)), target=(0.0, -16.0, 6.5), lens=30),
        dict(day, name='02_llegada_por_la_puerta_del_cementerio', cam=(-6.6, -39.5, ('eye', 2.0)), target=(0.0, -20.0, 6.2), lens=26),
        dict(day, name='03_fachada_sur_de_cerca', cam=(-7.0, -31.0, ('eye', 1.75)), target=(0.6, -22.0, 6.6), lens=22),
        dict(day, name='04_la_nave_hacia_la_escalera', cam=(2.4, -18.6, ('eye', 3.0)), target=(0.0, 0.0, 3.2), lens=26),
        dict(day, name='05_boca_de_la_escalera', cam=(-3.4, -8.0, ('eye', 1.8)), target=(0.0, 0.3, 3.0), lens=24),
        dict(day, name='06_escalera_camara_de_juego', cam=(0.7, -10.0, ('eye', 4.4)), target=(0.0, -0.4, 1.5), lens=30),
        dict(day, name='07_tres_cuartos_suroeste', cam=(26.0, -42.0, 15.0), target=(0.0, -10.0, 4.5), lens=32),
        dict(day, name='08_tres_cuartos_noreste', cam=(-21.0, 21.0, 13.0), target=(0.0, -4.0, 3.5), lens=28),
        dict(day, name='09_cementerio_este', cam=(-24.0, -17.0, ('eye', 2.2)), target=(-9.0, -8.0, 3.2), lens=28),
        {'name': '10_atardecer_efectos_referencia', 'cam': (-5.6, -11.6, ('eye', 2.6)), 'target': (0.0, 0.4, 2.8), 'lens': 28,
         'sky': 'dusk', 'sky_strength': 0.5, 'sun_strength': 0.9, 'sun_color': (1.0, 0.62, 0.42),
         'sun_dir': (0.85, 0.4, 0.14), 'vfx': True, 'glare': True},
        {'name': '11_noche_desde_el_camino_referencia', 'cam': (-7.5, -40.0, ('eye', 1.9)), 'target': (0.0, -18.0, 6.5),
         'lens': 26, 'sky': 'night', 'sky_strength': 1.4, 'sun_strength': 0.5, 'sun_color': (0.55, 0.65, 1.0),
         'sun_dir': (-0.4, 0.5, 0.6), 'vfx': True, 'glare': True},
    ]
    if mode == 'quick':
        views = [views[i] for i in (0, 2, 3, 4, 5, 6, 7, 9)]
    for v in views:
        v.setdefault('res', res)
        v.setdefault('samples', 40)
    cfg = {
        'name': 'hollow_crypt', 'out': out, 'views': views,
        'map_half': 30, 'map_title': 'Hollow Crypt entrance (the Fallen Chapel): door (80, 90)',
        'new_colliders': [dict(c, topLocalY=c['top']) for c in colliders],
        'new_paths': [(path, 0.9)], 'exit_drop': (0, -4),
        'extra_labels': [('stair-house = door', 0, 7.2, (1, 1, 1)), ('south gable + rose window', 0, -24.6, (1, 0.5, 0.5)),
                         ('lychgate', -2.5, -33.4, (1, 0.5, 0.5)), ('exit drop', 0, -4.7, (1, 0.7, 0.2)),
                         ('vestry nook', -6.0, -7.4, (1, 0.5, 0.5)), ('font', 5.4, -21.0, (1, 0.5, 0.5)),
                         ('yew', -5.2, 7.6, (1, 0.5, 0.5))],
        'sections': [
            {'name': 'NS_nave_y_escalera', 'axis': 'z', 'at': 0.0, 'span': (-36.0, 12.0), 'ylim': (-2.0, 18.0),
             'labels': [('S', -35.0, 16.5), ('N', 10.5, 16.5), ('gable', -22.0, -1.5), ('stair-house', 2.3, -1.5)]},
            {'name': 'EW_nave', 'axis': 'x', 'at': -12.0, 'span': (-17.0, 17.0), 'ylim': (-2.0, 10.0),
             'labels': [('E', -16.0, 9.0), ('W', 16.0, 9.0)]},
            {'name': 'EW_escalera', 'axis': 'x', 'at': 2.3, 'span': (-12.0, 12.0), 'ylim': (-2.0, 10.0),
             'labels': [('E', -11.0, 9.0), ('W', 11.0, 9.0)]},
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
