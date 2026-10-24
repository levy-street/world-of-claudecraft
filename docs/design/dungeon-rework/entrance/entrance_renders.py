"""Review renders shared by every entrance: beauty views (Eevee), the top-down
placement map and terrain-fit section profiles.

cfg = {
  'name': str, 'out': dir, 'views': [ {name, cam:(lx,lz,y or ('eye',h)), target:(lx,lz,y), lens, sky, sun_dir,
            sun_strength, vfx:bool, res} ],
  'map_half': 26, 'map_labels': [...], 'sections': [ {name, axis:'x'|'z', at:float, span:(a,b), ylim:(lo,hi)} ],
  'new_colliders': [...], 'extra_markers': [ (label, lx, lz, rgb) ], 'paths': [(pts, width)],
}
"""
import math
import os

import bpy
from mathutils import Vector

import entrance_common as ec

B = ec.B


def _set_hidden(objs, hidden):
    for o in objs:
        o.hide_render = hidden


def _vfx_objects():
    c = bpy.data.collections.get('VFX_Reference')
    return list(c.all_objects) if c else []


def _knights():
    out = []
    for o in bpy.data.objects:
        if o.name.startswith('Knight'):
            out.append(o)
            out.extend(o.children_recursive)
    return out


def _clear_world_lights():
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT' and o.name.startswith('Sun'):
            bpy.data.objects.remove(o, do_unlink=True)


def beauty(cfg, GR):
    out = cfg['out']
    rd = os.path.join(out, 'renders')
    os.makedirs(rd, exist_ok=True)
    vfx = _vfx_objects()
    for v in cfg['views']:
        _clear_world_lights()
        ec.setup_world(sky=v.get('sky', 'storm'), strength=v.get('sky_strength', 1.0),
                       sun_dir=v.get('sun_dir', (-0.5, 0.6, 0.65)), sun_strength=v.get('sun_strength', 4.5),
                       sun_color=v.get('sun_color', (1.0, 0.95, 0.88)), mist=v.get('mist'))
        ec.setup_eevee(res=v.get('res', (1920, 1080)), samples=v.get('samples', 48))
        _set_hidden(vfx, not v.get('vfx', False))
        for name in v.get('hide', ()):
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render = True
        cx, cz, cy = v['cam']
        if isinstance(cy, tuple):
            cy = GR.walk(cx, cz) + cy[1]
        tx, tz, ty = v['target']
        cam = ec.add_camera('cam_' + v['name'], B(cx, cz, cy), B(tx, tz, ty), lens=v.get('lens', 35))
        ec.set_glare(v.get('glare', False))
        ec.render(cam, os.path.join(rd, v['name'] + '.png'))
        ec.set_glare(False)
        for name in v.get('hide', ()):
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render = False
    _set_hidden(vfx, True)


def placement_map(cfg, GR, surr):
    """Top-down, north up, east right. Terrain with 1 yd contours, every
    surrounding feature from the probe, the static colliders already in the
    world (grey), the new set piece colliders (red), the door trigger, the
    exit drop and the 20 yd mob-clear ring."""
    out = os.path.join(cfg['out'], 'renders')
    half = cfg.get('map_half', 26)
    made = []
    made.append(ec.contour_lines(GR, half + 2, interval=1.0, rgb=(0.95, 0.95, 0.9)))
    door_y = 0.0
    made.append(ec.marker_disc('mk_trigger', 0, 0, door_y, 2.0, (1.0, 1.0, 1.0), ring=True))
    made.append(ec.marker_disc('mk_clear20', 0, 0, GR.h(0, 0), 20.0, (1.0, 0.55, 0.2), ring=True, sides=96))
    ex = cfg.get('exit_drop', (0, -4))
    made.append(ec.marker_disc('mk_exit', ex[0], ex[1], GR.h(*ex), 0.7, (1.0, 0.6, 0.1)))
    colors = {
        'npc': (1.0, 0.9, 0.2), 'groundObject': (0.2, 0.9, 1.0), 'gatherNode': (0.3, 1.0, 0.3),
        'worldBoss': (1.0, 0.2, 0.9), 'dungeonDoor': (1.0, 1.0, 1.0),
    }
    for f in surr['feats']:
        lx, lz = f['x'] - GR.dx, f['z'] - GR.dz
        if abs(lx) > half * 1.6 or abs(lz) > half * 1.6:
            continue
        k = f['kind']
        y = GR.h(lx, lz) if abs(lx) < 60 and abs(lz) < 60 else 0
        if k == 'camp':
            made.append(ec.marker_disc('mk_camp_' + f['mobId'][:12], lx, lz, y, f['r'], (1.0, 0.25, 0.2), ring=True,
                                       sides=64))
            made.append(ec.text_label('lb_camp' + str(len(made)), f"{f['mobId']} camp r{f['r']}", lx, lz - 2, y + 3,
                                      size=1.3, rgb=(1, 0.4, 0.3)))
        elif k in colors:
            made.append(ec.marker_disc('mk_' + k + str(len(made)), lx, lz, y, 0.6, colors[k]))
            label = f.get('name') or f.get('id') or k
            made.append(ec.text_label('lb_' + str(len(made)), label[:26], lx, lz - 1.4, y + 3, size=0.9,
                                      rgb=colors[k]))
        elif k.startswith('prop:'):
            raw = f.get('raw', {})
            if 'ringR' in raw:
                made.append(ec.marker_disc('mk_ring' + str(len(made)), lx, lz, y, raw['ringR'], (0.8, 0.8, 0.8),
                                           ring=True, sides=48))
            made.append(ec.marker_disc('mk_prop' + str(len(made)), lx, lz, y, 0.35, (0.75, 0.75, 0.75)))
    # Roads.
    for r in surr['roads']:
        pts = [(p['x'] - GR.dx, p['z'] - GR.dz) for p in r['pts']]
        dense = []
        for a, b in zip(pts, pts[1:]):
            n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 1.0))
            for i in range(n):
                t = i / n
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                dense.append(B(x, z, GR.h(x, z) + 0.3))
        dense.append(B(pts[-1][0], pts[-1][1], GR.h(*pts[-1]) + 0.3))
        made.append(ec.polyline_tube('mk_road' + str(r['idx']), [tuple(v) for v in dense], 0.35, (0.9, 0.6, 0.3)))
    for (pts, w) in cfg.get('new_paths', ()):
        dense = []
        for a, b in zip(pts, pts[1:]):
            n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 1.0))
            for i in range(n):
                t = i / n
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                dense.append(B(x, z, GR.h(x, z) + 0.3))
        made.append(ec.polyline_tube('mk_newpath', [tuple(v) for v in dense], 0.25, (1.0, 0.85, 0.5)))
    # Existing colliders.
    for i, c in enumerate(surr['colliders']):
        lx, lz = c['x'] - GR.dx, c['z'] - GR.dz
        y = GR.h(lx, lz) if abs(lx) < 60 and abs(lz) < 60 else 0
        if c['type'] == 'circle':
            made.append(ec.marker_disc(f'mk_col{i}', lx, lz, y + 0.4, max(c['r'], 0.3), (0.6, 0.6, 0.65), ring=True))
        else:
            made.append(ec.marker_box(f'mk_col{i}', lx, lz, y + 0.4, c['hw'], c['hd'], c['rot'], (0.6, 0.6, 0.65)))
    # New colliders (red), drawn above the set piece.
    for i, c in enumerate(cfg.get('new_colliders', ())):
        top = c.get('topLocalY', 10) + 0.5
        if c['type'] == 'circle':
            made.append(ec.marker_disc(f'mk_new{i}', c['lx'], c['lz'], top, c['r'], (1.0, 0.1, 0.1), ring=True))
        else:
            made.append(ec.marker_box(f'mk_new{i}', c['lx'], c['lz'], top, c['hw'], c['hd'], c['rot'],
                                      (1.0, 0.1, 0.1)))
    for (label, lx, lz, rgb) in cfg.get('extra_labels', ()):
        made.append(ec.text_label('lbx' + str(len(made)), label, lx, lz, 30, size=1.0, rgb=rgb))
    # Compass.
    made.append(ec.text_label('lb_N', 'N', 0, half - 1.5, 40, size=2.2, rgb=(1, 1, 1)))
    made.append(ec.text_label('lb_E', 'E (-x)', -half + 3, 0, 40, size=1.4, rgb=(1, 1, 1)))
    made.append(ec.text_label('lb_W', 'W (+x)', half - 3, 0, 40, size=1.4, rgb=(1, 1, 1)))
    made.append(ec.text_label('lb_title', cfg.get('map_title', cfg['name']), 0, -half + 1.5, 40, size=1.3,
                              rgb=(1, 1, 1)))
    _set_hidden(_vfx_objects(), True)
    _set_hidden(_knights(), True)
    _clear_world_lights()
    ec.setup_world(sky='day', strength=0.8, sun_dir=(0.2, 0.3, 1.0), sun_strength=3.0)
    ec.setup_eevee(res=(1800, 1800), samples=24)
    data = bpy.data.cameras.new('cam_map')
    data.type = 'ORTHO'
    data.ortho_scale = half * 2
    data.clip_end = 1000
    cam = bpy.data.objects.new('cam_map', data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0, 0, 300)
    cam.rotation_euler = (0, 0, math.pi)
    ec.render(cam, os.path.join(out, 'placement_map.png'))
    # Wide context map.
    data.ortho_scale = half * 5
    for o in made:
        if o.name.startswith('lb_'):
            o.scale = (2, 2, 2)
    ec.render(cam, os.path.join(out, 'placement_map_wide.png'))
    for o in made:
        bpy.data.objects.remove(o, do_unlink=True)
    _set_hidden(_knights(), False)


def sections(cfg, GR):
    """Section profiles: an ortho camera whose near clip IS the section plane,
    with the sampled terrain line drawn on it in red (and the walk surface in
    yellow where it differs)."""
    out = os.path.join(cfg['out'], 'renders')
    _set_hidden(_vfx_objects(), True)
    for s in cfg.get('sections', ()):
        made = []
        a0, a1 = s['span']
        pts, wpts = [], []
        n = int((a1 - a0) / 0.25)
        for i in range(n + 1):
            t = a0 + (a1 - a0) * i / n
            if s['axis'] == 'x':      # line along lx at lz = at; view from the south
                lx, lz = t, s['at'] - 0.03
            else:                     # line along lz at lx = at; view from the east
                lx, lz = s['at'] - 0.03, t
            pts.append(tuple(B(lx, lz, GR.h(lx, lz))))
            wpts.append(tuple(B(lx, lz, GR.walk(lx, lz))))
        made.append(ec.polyline_tube('sec_ground', pts, 0.07, (1.0, 0.1, 0.1), emission=3.0))
        if any(abs(a[2] - b[2]) > 0.02 for a, b in zip(pts, wpts)):
            made.append(ec.polyline_tube('sec_walk', wpts, 0.05, (1.0, 0.9, 0.1), emission=3.0))
        # Door level reference line.
        if s['axis'] == 'x':
            made.append(ec.polyline_tube('sec_zero', [tuple(B(a0, s['at'] - 0.05, 0)), tuple(B(a1, s['at'] - 0.05, 0))],
                                         0.025, (0.3, 0.9, 1.0), emission=2.0))
        else:
            made.append(ec.polyline_tube('sec_zero', [tuple(B(s['at'] - 0.05, a0, 0)), tuple(B(s['at'] - 0.05, a1, 0))],
                                         0.025, (0.3, 0.9, 1.0), emission=2.0))
        for k, (txt, u, y) in enumerate(s.get('labels', ())):
            if s['axis'] == 'x':
                lb = ec.text_label(f'sec_lb{k}', txt, u, s['at'] - 0.2, y, size=0.9, rgb=(1, 1, 1), rot_z=0)
                lb.rotation_euler = (math.pi / 2, 0, math.pi)
            else:
                lb = ec.text_label(f'sec_lb{k}', txt, s['at'] - 0.2, u, y, size=0.9, rgb=(1, 1, 1), rot_z=0)
                lb.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
            made.append(lb)
        _clear_world_lights()
        ec.setup_world(sky='fog', strength=1.2, sun_dir=(-0.3, 0.8, 0.6), sun_strength=3.0)
        ec.setup_eevee(res=(2000, 1100), samples=24)
        lo, hi = s['ylim']
        mid = (a0 + a1) / 2
        data = bpy.data.cameras.new('cam_sec')
        data.type = 'ORTHO'
        data.ortho_scale = max(a1 - a0, (hi - lo) * 2000 / 1100)
        D = 200
        data.clip_start = D + (0.0 if s['axis'] == 'x' else 0.0)
        data.clip_end = D + 200
        cam = bpy.data.objects.new('cam_sec', data)
        bpy.context.scene.collection.objects.link(cam)
        yc = (lo + hi) / 2
        if s['axis'] == 'x':
            # Camera south of the plane, looking north (Blender -Y).
            cam.location = B(mid, s['at'] - D, yc)
            cam.rotation_euler = (math.pi / 2, 0, math.pi)
        else:
            # Camera east of the plane (game -x), looking west (Blender +X).
            cam.location = B(s['at'] - D, mid, yc)
            cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
        ec.render(cam, os.path.join(out, 'profile_' + s['name'] + '.png'))
        bpy.data.objects.remove(cam, do_unlink=True)
        for o in made:
            bpy.data.objects.remove(o, do_unlink=True)
