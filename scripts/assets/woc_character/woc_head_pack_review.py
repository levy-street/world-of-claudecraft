# WOC head pack review: the fit checks and review renders woc_head_pack.py runs after it
# exports a pack (never during a build, so no render state can leak into the export).
#
#   cover_pokes     every piece against every helm / hood: a vertex pokes through when an
#                   outward-facing cover surface lies between it and the head centre AND nothing
#                   of the cover lies further out along the same ray (a face seen through a visor
#                   opening, or a vertex behind an inward-facing lining, is not counted; a piece
#                   hanging below a rim IS, so read the list with the renders).
#   neck_profile    the head's neck against each body: radial rays from the neck axis at
#                   fixed heights, head surface radius vs body surface radius per sector, so a
#                   neck that flares out through the collar or shoulders shows as a negative
#                   margin below the collar top.
#   render_review   ortho review renders (front / three-quarter / side / back) of the default
#                   look, the neck close up, every hairstyle, every beard (plus its chin
#                   morph at 0 and 1), every hair and beard under each cover, the bald crown,
#                   the piercings and the brow / mouth libraries, plus an index.json that the
#                   contact-sheet step reads.
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def log(*a):
    print('[head_review]', *a, flush=True)


def world_co(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = obj.evaluated_get(dg)
    me = oe.to_mesh()
    a = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    M = np.array(oe.matrix_world)
    co = a.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]
    me.calc_loop_triangles()
    t = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', t)
    oe.to_mesh_clear()
    return co, t.reshape(-1, 3)


def bvh_of(obj):
    co, tri = world_co(obj)
    return BVHTree.FromPolygons([tuple(p) for p in co], [tuple(x) for x in tri]), co


# ----------------------------------------------------------------------------- cover pokes

def cover_pokes(pieces, covers, centre, eps=0.0003):
    """{cover: {node: {verts_poking, verts, max_poke_m, poke_bbox}}} for the given piece objects
    (evaluated, so live shape key values count). `centre` is the head centre (world)."""
    out = {}
    c = Vector(centre)
    for cob in covers:
        bvh, _ = bvh_of(cob)
        res = {}
        for nm, o in pieces.items():
            co, _t = world_co(o)
            n_out, worst, pts = 0, 0.0, []
            for p in co:
                pv = Vector(p)
                d = pv - c
                r = d.length
                if r < 1e-6:
                    continue
                n = d / r
                hit_in = bvh.ray_cast(pv, -n, r)
                if hit_in[0] is None:
                    continue  # no cover between the vertex and the head centre
                if hit_in[1].dot(n) <= 0.0:
                    continue  # the surface faces the head: a lining the vertex sits inside of
                if bvh.ray_cast(pv + n * 1e-5, n, 2.0)[0] is not None:
                    continue  # cover further out: hidden inside the shell
                depth = (pv - hit_in[0]).length
                if depth <= eps:
                    continue
                n_out += 1
                worst = max(worst, depth)
                pts.append(p)
            if n_out:
                pts = np.array(pts)
                res[nm] = {'verts_poking': n_out, 'verts': len(co), 'max_poke_m': round(worst, 4),
                           'poke_bbox': [pts.min(0).round(4).tolist(), pts.max(0).round(4).tolist()]}
        out[cob.name] = res
        log('cover %s: %d pieces poke; worst %s' % (
            cob.name, len(res), sorted(((v['max_poke_m'], k) for k, v in res.items()), reverse=True)[:6]))
    return out


# ----------------------------------------------------------------------------- neck

def neck_profile(head_obj, bodies, axis_xy, levels, sectors=24):
    """Radial margin (body surface radius minus head surface radius, metres) per height and
    sector from the neck axis. Negative = the head's neck is outside the body there."""
    hbvh, hco = bvh_of(head_obj)
    out = {'axis_xy': [round(float(x), 4) for x in axis_xy], 'levels': [round(z, 4) for z in levels],
           'head_min_z': round(float(hco[:, 2].min()), 4), 'bodies': {}}
    for b in bodies:
        bbvh, _ = bvh_of(b)
        rows = []
        worst = None
        for z in levels:
            row = []
            for k in range(sectors):
                a = 2 * math.pi * k / sectors
                o = Vector((axis_xy[0], axis_xy[1], z))
                dv = Vector((math.sin(a), -math.cos(a), 0.0))  # k=0 faces front (-Y)
                hh = hbvh.ray_cast(o, dv, 0.5)
                bh = bbvh.ray_cast(o, dv, 0.5)
                hr = None if hh[0] is None else (hh[0] - o).length
                br = None if bh[0] is None else (bh[0] - o).length
                m = None if (hr is None or br is None) else round(br - hr, 4)
                row.append({'head_r': None if hr is None else round(hr, 4),
                            'body_r': None if br is None else round(br, 4), 'margin': m})
                if m is not None and (worst is None or m < worst[0]):
                    worst = (m, round(z, 4), round(math.degrees(a), 1))
            rows.append(row)
        neg = sum(1 for row in rows for s in row if s['margin'] is not None and s['margin'] < -0.0005)
        out['bodies'][b.name] = {
            'rows': rows, 'sectors_outside_body': neg,
            'worst_margin': None if worst is None else {'margin_m': worst[0], 'z': worst[1], 'azimuth_deg': worst[2]},
        }
    return out


def neck_summary(prof):
    s = {}
    for name, b in prof['bodies'].items():
        per = []
        for z, row in zip(prof['levels'], b['rows']):
            ms = [x['margin'] for x in row if x['margin'] is not None]
            per.append({'z': z, 'min_margin_m': min(ms) if ms else None,
                        'sectors_hit': len(ms), 'sectors_outside': sum(1 for m in ms if m < -0.0005)})
        s[name] = {'sectors_outside_body': b['sectors_outside_body'], 'worst': b['worst_margin'], 'per_level': per}
    return s


# ----------------------------------------------------------------------------- renders

class Stage:
    """One ortho camera, one sun and a flat world; `shot` shows only the given objects."""

    def __init__(self, out_dir, res=512):
        scene = bpy.context.scene
        self.scene = scene
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        try:
            scene.render.engine = 'BLENDER_EEVEE'
        except TypeError:
            scene.render.engine = 'BLENDER_EEVEE_NEXT'
        try:
            scene.eevee.taa_render_samples = 8
        except Exception:
            pass
        scene.render.resolution_x = res
        scene.render.resolution_y = res
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
        scene.render.image_settings.file_format = 'PNG'
        world = bpy.data.worlds.new('headpack_world')
        world.use_nodes = True
        bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
        bg.inputs[0].default_value = (0.35, 0.37, 0.42, 1)
        bg.inputs[1].default_value = 1.0
        scene.world = world
        cam_data = bpy.data.cameras.new('headpack_cam')
        cam_data.type = 'ORTHO'
        self.cam = bpy.data.objects.new('headpack_cam', cam_data)
        scene.collection.objects.link(self.cam)
        scene.camera = self.cam
        sun_d = bpy.data.lights.new('headpack_sun', 'SUN')
        sun_d.energy = 3.0
        self.sun = bpy.data.objects.new('headpack_sun', sun_d)
        scene.collection.objects.link(self.sun)
        self.sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
        self.index = []
        self.all_objs = [o for o in scene.objects]

    VIEWS = {'front': (0.0, -1.0, 0.0), 'q3': (0.7, -0.7, 0.05), 'side': (1.0, 0.0, 0.0),
             'back': (0.0, 1.0, 0.0), 'q3_high': (0.6, -0.6, 0.55), 'back_q3': (-0.65, 0.7, 0.2)}

    def shot(self, group, label, objs, views, target, scale):
        keep = set(objs) | {self.cam, self.sun}
        for o in self.all_objs:
            try:
                o.hide_render = o not in keep
            except ReferenceError:
                pass
        for o in objs:
            o.hide_render = False
        self.cam.data.ortho_scale = scale
        files = []
        for v in views:
            dv = Vector(self.VIEWS[v]).normalized()
            self.cam.location = Vector(target) + dv * 2.0
            self.cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
            fn = '%s__%s__%s.png' % (group, label, v)
            self.scene.render.filepath = os.path.join(self.out_dir, fn)
            bpy.ops.render.render(write_still=True)
            files.append(fn)
        self.index.append({'group': group, 'label': label, 'views': list(views), 'files': files})

    def write_index(self, extra):
        with open(os.path.join(self.out_dir, 'index.json'), 'w') as f:
            json.dump({'renders': self.index, **extra}, f, indent=1)


def set_keys(objs, values):
    """Shape key values by name on every piece that carries them (every other key to 0)."""
    for o in objs:
        sk = o.data.shape_keys if o.type == 'MESH' else None
        if not sk:
            continue
        for kb in sk.key_blocks[1:]:
            kb.value = values.get(kb.name, 0.0)
    bpy.context.view_layer.update()


def render_review(ctx, opts):
    """Every review render for one built pack. Leaves every piece's shape keys at 0."""
    T, L = ctx['T'], ctx['L']
    P = ctx['piece_objs']
    stage = Stage(opts['review'])
    body = bpy.data.objects[T['body']]
    chest = [bpy.data.objects[n] for n in T.get('chest', []) if n in bpy.data.objects]
    covers = [bpy.data.objects[n] for n in T['covers'] if n in bpy.data.objects]
    v1 = ctx.get('v1_objs', {})
    defaults = dict(T['defaults'])
    centre = Vector(ctx['head_centre'])
    target = Vector((centre.x, centre.y, centre.z - 0.02))
    neck_t = Vector((centre.x, centre.y + 0.01, ctx['collar_z'] - 0.005))
    prefix = 'type_%s' % opts['type']
    CHIN = 0.65

    def look_nodes(look, hair=True, piercing=None):
        out = ['WocHead_%s_base' % L]
        for slot in T['slots']:
            if slot == 'hair' and not hair:
                continue
            out += ctx['variant_nodes'](slot, look.get(slot))
        for site in (piercing or []):
            out.append('WocHead_%s_piercing_%s' % (L, site))
        return [P[n] for n in out if n in P]

    def keys_for(look, chin=CHIN, bald=None):
        vals = {'FS_Chin_Softness': chin}
        hair = look.get('hair')
        if bald is None:
            bald = hair in (None, 'bald')
        if bald:
            vals['FS_Bald_Crown'] = 1.0
        elif hair:
            vals['FS_Tuck_' + hair] = 1.0
        return vals

    allp = list(P.values())
    four = ('front', 'q3', 'side', 'back')

    # 1. the default look, new vs the v1 pack, body and collar in frame
    set_keys(allp, keys_for(defaults))
    stage.shot(prefix, 'look_default', [body] + look_nodes(defaults), four, target, 0.42)
    if v1:
        v1_look = [o for n, o in v1.items() if n in ctx['v1_default_nodes']]
        stage.shot(prefix, 'look_v1', [body] + v1_look, four, target, 0.42)
    stage.shot(prefix, 'look_old_rigid', [body] + [bpy.data.objects[n] for n in T['old_pieces']],
               ('front', 'q3', 'side'), target, 0.42)
    # 2. the neck close up (default hair kept for the silhouette), plain body and with the chest
    ncl = ('front', 'q3', 'side', 'back', 'q3_high', 'back_q3')
    stage.shot(prefix, 'neck_new', [body] + look_nodes(defaults), ncl, neck_t, 0.2)
    if v1:
        stage.shot(prefix, 'neck_v1', [body] + v1_look, ncl, neck_t, 0.2)
    if chest:
        stage.shot(prefix, 'neck_new_chest', [body] + chest + look_nodes(defaults), ncl, neck_t, 0.24)
    # 3. every hairstyle (clean shaven so the jaw line reads), then bald
    for h in T['slots']['hair']:
        look = dict(defaults, hair=h, beard='none')
        set_keys(allp, keys_for(look))
        stage.shot(prefix, 'hair_%s' % h, [body] + look_nodes(look), four, target, 0.42)
    look = dict(defaults, hair='bald', beard='none')
    set_keys(allp, keys_for(look))
    stage.shot(prefix, 'hair_bald', [body] + look_nodes(look), four, target, 0.42)
    # 4. every beard on the default hair, then its chin morph at 0 and 1 (side close up)
    for b in T['slots']['beard']:
        look = dict(defaults, beard=b)
        set_keys(allp, keys_for(look))
        stage.shot(prefix, 'beard_%s' % b, [body] + look_nodes(look), ('front', 'q3', 'side'), target, 0.42)
        for chin in (0.0, 1.0):
            set_keys(allp, keys_for(look, chin=chin))
            stage.shot(prefix, 'beardchin_%s_%d' % (b, int(chin * 100)), [body] + look_nodes(look),
                       ('side', 'q3'), Vector((centre.x, centre.y - 0.03, centre.z - 0.04)), 0.22)
    # 5. every hair and every beard under every cover (hair shown even though the catalog hides
    #    it under a helm, so a pose that ever shows it is covered too)
    for cob in covers:
        look = dict(defaults, beard='none')
        set_keys(allp, keys_for(look))
        stage.shot(prefix, 'cover_%s_face' % cob.name, [body, cob] + look_nodes(look, hair=False),
                   ('front', 'q3', 'side'), target, 0.42)
        for h in T['slots']['hair']:
            look = dict(defaults, hair=h, beard='none')
            set_keys(allp, keys_for(look))
            stage.shot(prefix, 'cover_%s_hair_%s' % (cob.name, h), [body, cob] + look_nodes(look),
                       ('front', 'side', 'back'), target, 0.42)
        for b in T['slots']['beard']:
            look = dict(defaults, beard=b)
            set_keys(allp, keys_for(look))
            stage.shot(prefix, 'cover_%s_beard_%s' % (cob.name, b),
                       [body, cob] + look_nodes(look, hair=False), ('front', 'q3', 'side'), target, 0.42)
    # 6. piercings (the full preset) at chin 0 and 1, close up on the lip
    full = ['lobe_l', 'lobe_r', 'rim_l', 'rim_r', 'nostril', 'septum', 'brow', 'lip']
    look = dict(defaults, beard='none')
    for chin in (0.0, 1.0):
        set_keys(allp, keys_for(look, chin=chin))
        stage.shot(prefix, 'piercing_all_chin%d' % int(chin * 100), [body] + look_nodes(look, piercing=full),
                   ('front', 'q3', 'side'), Vector((centre.x, centre.y - 0.03, centre.z - 0.02)), 0.2)
    # 7. the brow and mouth libraries, close up
    face_t = Vector((centre.x, centre.y - 0.04, centre.z - 0.01))
    for slot in ('brows', 'mouth'):
        for v in T['slots'][slot]:
            look = dict(defaults, beard='none', **{slot: v})
            set_keys(allp, keys_for(look))
            stage.shot(prefix, '%s_%s' % (slot, v), look_nodes(look), ('front', 'q3'), face_t, 0.16)
    set_keys(allp, {})
    stage.write_index({'type': opts['type'], 'chin_default': CHIN})
    log('renders written to', opts['review'], len(stage.index), 'shots')
