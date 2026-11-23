"""Build the Gorgebloom from code (adapted from the Great Jaguar, Great Saurian and
Balgath builders).

  blender -b --factory-startup --python build.py -- <out.glb> [options]

  --voxel V        body sculpt voxel in yards (default 0.032; 0.06 for quick looks)
  --bake N         bake size (default 4096; the shipped maps are halved from it)
  --nobake         clay surfaces, no Cycles bake (pose and rig checks)
  --clips A,B      author only these clips
  --blend path     save the .blend
  --tex dir        write the baked maps to dir
  --stats path     write a JSON of counts and measurements
  --work dir       scratch for the VDB files
  -                as the output skips the export

Pipeline: the body (bulb, roots, sacs, neck, the flower head with its petals and
maw) is one signed-distance sculpt and each vine another (anatomy.py), meshed
through OpenVDB (the HIGH skins) and decimated with the head protected (the LOW
skins). The sculpt writes its material zones onto the highs as colour
attributes. The dressing (dressing.py) adds the thorn-teeth, the thorns and the
remains of its meals, each as a high/low pair. Skin weights come from the
sculpts' own primitives (rig.py); thorns copy the nearest skin weights; teeth and
remains ride one bone. All the lows share one UV atlas; Cycles bakes albedo,
roughness, tangent normals, occlusion and the self-lit glow from the highs. The
lows are joined into ONE skinned mesh, Gorgebloom, on the armature GorgebloomRig.
"""
import json
import os
import sys
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy as A  # noqa: E402
import dressing as D  # noqa: E402
import mesh_kit as K  # noqa: E402
import rig as R  # noqa: E402
import sdf  # noqa: E402
import surface as S  # noqa: E402

T0 = time.time()
MESH_NAMES = {'body': 'Gorgebloom'}


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


# ------------------------------------------------------------------ geometry
def protect_group(obj, spots):
    P, _ = R.mesh_arrays(obj)
    w = np.zeros(len(P))
    for c, r, k in spots:
        d = np.linalg.norm(P - np.asarray(c), axis=1)
        w = np.maximum(w, k * np.clip(1.2 - d / r, 0, 1))
    g = obj.vertex_groups.new(name='Protect')
    for i in np.nonzero(w > 0.02)[0]:
        g.add([int(i)], float(min(1.0, w[i])), 'REPLACE')


def write_zones(obj, F):
    """The sculpt's zone weights as three RGBA colour attributes (ZoneA/B/C)."""
    P, _ = R.mesh_arrays(obj)
    W = A.zone_weights(F, P)
    pad = np.zeros((len(P), 12))
    pad[:, :W.shape[1]] = W
    for k, nm in enumerate(('ZoneA', 'ZoneB', 'ZoneC')):
        at = obj.data.color_attributes.new(nm, 'FLOAT_COLOR', 'POINT')
        at.data.foreach_set('color', pad[:, 4 * k:4 * k + 4].astype(np.float32).ravel())


def build_skin(F, name, target_tris, workdir, mat, spots):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    log(name, 'high', len(hi.data.polygons), 'faces')
    write_zones(hi, F)
    lo = K.duplicate(hi, name)
    for nm in ('ZoneA', 'ZoneB', 'ZoneC'):
        a = lo.data.color_attributes.get(nm)
        if a is not None:
            lo.data.color_attributes.remove(a)
    if spots:
        protect_group(lo, spots)
    tris = K.triangles(lo)
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    if spots:
        mod.vertex_group = 'Protect'
        mod.invert_vertex_group = True
        mod.vertex_group_factor = 5.0
    K.apply_mods(lo)
    lo.vertex_groups.clear()
    for o in (hi, lo):
        o['mat'] = mat
        o['binding'] = 'skin'
        o['bone'] = ''
        o['group'] = 'body'
        for p in o.data.polygons:
            p.use_smooth = True
    log(name, 'low', K.triangles(lo), 'tris')
    return hi, lo


def uv_boost(obj, center):
    c = np.array(center)
    m = obj.get('mat')
    if m == 'plant':
        if np.linalg.norm(c - A.HC) < 5.2:
            return 1.45                       # the flower head and the maw
        if c[2] < 0.15:
            return 0.3                        # under the water
        return 1.0
    if c[2] < 0.1:
        return 0.3
    return {'vine': 0.85, 'tooth': 0.55, 'bone': 0.8, 'cloth': 0.6, 'iron': 0.4}.get(m, 1.0)


# ------------------------------------------------------------------ materials
def shipping_material(albedo, normal, orm, glow):
    body = bpy.data.materials.new('GorgebloomBody')
    body.use_nodes = True
    nt = body.node_tree
    bsdf = nt.nodes['Principled BSDF']
    ia = nt.nodes.new('ShaderNodeTexImage')
    ia.image = albedo
    nt.links.new(ia.outputs['Color'], bsdf.inputs['Base Color'])
    io = nt.nodes.new('ShaderNodeTexImage')
    io.image = orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(io.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    inn = nt.nodes.new('ShaderNodeTexImage')
    inn.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(inn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    ig = nt.nodes.new('ShaderNodeTexImage')
    ig.image = glow
    nt.links.new(ig.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return body


CLAY = {'plant': (0.42, 0.5, 0.25), 'vine': (0.3, 0.38, 0.18), 'tooth': (0.9, 0.86, 0.75), 'bone': (0.82, 0.76, 0.62),
        'cloth': (0.4, 0.33, 0.25), 'iron': (0.3, 0.3, 0.3)}


def clay_materials():
    out = {}
    for k, c in CLAY.items():
        m = bpy.data.materials.new('Clay_' + k)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*S.srgb(c)[:3], 1)
        b.inputs['Roughness'].default_value = 0.6
        out[k] = m
    return out


def to_numpy_image(name, arr, colorspace='sRGB'):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels[:] = arr.astype(np.float32).ravel()
    img.pack()
    return img


def downsample(arr, k=2):
    h, w, c = arr.shape
    return arr.reshape(h // k, k, w // k, k, c).mean(axis=(1, 3))


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# ------------------------------------------------------------------ main
def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    voxel = float(opt(argv, '--voxel', 0.032))
    bake_size = int(opt(argv, '--bake', 4096))
    nobake = '--nobake' in argv
    fast = voxel >= 0.05
    workdir = opt(argv, '--work', os.path.join(os.path.dirname(os.path.abspath(out)) if out != '-' else HERE, '_work'))
    workdir = os.path.abspath(workdir)
    os.makedirs(workdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    log('sculpt voxel', voxel)
    F = A.build_body(voxel=voxel)
    log('field', F.shape)
    spots = [(A.MAW, 2.4, 1.0), (A.HC, 4.6, 0.55)] + [(A.REST[s][1], 1.4, 0.4) for s in A.SACS]
    body_hi, body_lo = build_skin(F, 'BloomSkin', 15000 if fast else 27000, workdir, 'plant', spots)
    skins = {'body': (body_lo, F)}
    pairs = [(body_hi, body_lo)]
    for name in A.VINES:
        G = A.build_vine(name, voxel=max(0.024, voxel * 0.8))
        tgt = (2600 if 'Back' not in name else 1700) if not fast else 1200
        hi, lo = build_skin(G, name + 'Skin', tgt, workdir, 'vine', None)
        skins[name] = (lo, G)
        pairs.append((hi, lo))
    del F
    W = {}
    for key, (lo, G) in skins.items():
        W[key] = R.weight_skin(lo, G)
    log('skin weights')
    dress = []
    dress += D.build_teeth()
    dress += D.build_vine_thorns()
    dress += D.build_bulb_thorns(A.build_body(voxel=0.06, detail=False))
    dress += D.build_dead(workdir=workdir)
    log('dressing', len(dress), 'pairs')
    for hi, lo in dress:
        kind = lo.get('binding', 'rigid')
        if kind == 'rigid':
            R.rigid(lo, lo['bone'])
        elif kind == 'transfer':
            sk = skins[lo['skin']][0]
            bones, WW = W[lo['skin']]
            R.transfer_weights(lo, sk, bones, WW)
        else:
            raise ValueError(kind)
    pairs += dress
    lows = [lo for _, lo in pairs]
    highs = [hi for hi, _ in pairs]
    stats = {'tris': {}, 'parts': len(lows)}
    for o in lows:
        stats['tris'][o.name] = K.triangles(o)
    log('triangles total', sum(stats['tris'].values()))
    log('TOP', sorted(stats['tris'].items(), key=lambda kv: -kv[1])[:20])
    if nobake:
        clay = clay_materials()
        for o in lows:
            o.data.materials.clear()
            o.data.materials.append(clay[o['mat']])
    else:
        S.unwrap(lows, scale_fn=uv_boost)
        log('uv done')
        bake_mats = S.bake_materials()
        for h in highs:
            h.data.materials.clear()
            h.data.materials.append(bake_mats[h['mat']])
        tex_dir = opt(argv, '--tex')
        if tex_dir:
            os.makedirs(tex_dir, exist_ok=True)
        joined = K.duplicate(lows[0], 'BakeLow')
        others = [K.duplicate(o, o.name + '_bk') for o in lows[1:]]
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for o in [joined] + others:
            o.select_set(True)
        bpy.context.view_layer.objects.active = joined
        bpy.ops.object.join()
        res = S.bake_all(highs, joined, size=bake_size, samples=48 if bake_size >= 2048 else 16, out_dir=tex_dir,
                         cage=0.26, ray=0.6)
        bpy.data.objects.remove(joined, do_unlink=True)
        ao = res['ao'][..., :1]
        albedo = res['albedo'].copy()
        albedo[..., :3] *= (1.0 - 0.55 * (1.0 - ao))
        orm = np.ones_like(albedo)
        orm[..., 1] = res['rough'][..., 0]
        orm[..., 2] = res['metal'][..., 0]
        glow = res['glow'].copy()
        glow[..., 3] = 1.0
        ship = bake_size // 2 if bake_size >= 4096 else bake_size
        k = bake_size // ship
        a_img = to_numpy_image('BloomAlbedo', downsample(albedo, k) if k > 1 else albedo)
        n_img = to_numpy_image('BloomNormal', downsample(res['normal'], k) if k > 1 else res['normal'], 'Non-Color')
        o_img = to_numpy_image('BloomORM', downsample(orm, k * 2), 'Non-Color')
        g_img = to_numpy_image('BloomGlow', downsample(glow, k * 2))
        if tex_dir:
            for img, nm in ((a_img, 'albedo'), (n_img, 'normal'), (o_img, 'orm'), (g_img, 'glow')):
                img.filepath_raw = os.path.join(tex_dir, f'gorgebloom_{nm}_{img.size[0]}.png')
                img.file_format = 'PNG'
                img.save()
        mat = shipping_material(a_img, n_img, o_img, g_img)
        for o in lows:
            o.data.materials.clear()
            o.data.materials.append(mat)
        log('bake done')
    for h in highs:
        h.hide_render = True
        h.hide_viewport = True
    for o in lows:
        for nm in ('Col', 'ZoneA', 'ZoneB', 'ZoneC'):
            col = o.data.color_attributes.get(nm)
            if col is not None:
                o.data.color_attributes.remove(col)
    arm = R.build_armature()
    ob = join(lows, MESH_NAMES['body'])
    ob.parent = arm
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    missing = {g.name for g in ob.vertex_groups} - {b.name for b in arm.data.bones}
    if missing:
        raise RuntimeError(f'groups with no bone: {missing}')
    stats['tris_body'] = K.triangles(ob)
    stats['tris_total'] = stats['tris_body']
    stats['bones'] = len(arm.data.bones)
    log('mesh', stats['tris_body'], 'tris', stats['bones'], 'bones')
    import clips as C
    only = opt(argv, '--clips')
    names = C.make_clips(arm, only.split(',') if only else None)
    log('clips', len(names))
    if 'Idle' in names:
        R.set_action(arm, bpy.data.actions['Idle'])
        bpy.context.scene.frame_set(13)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        co = np.array([(ev.matrix_world @ v.co)[:] for v in ev.data.vertices])
        stats['idle_height'] = float(co[:, 2].max())
        stats['idle_minz'] = float(co[:, 2].min())
        stats['length_y'] = float(co[:, 1].max() - co[:, 1].min())
        stats['width_x'] = float(co[:, 0].max() - co[:, 0].min())
        stats['idle_min_y'] = float(co[:, 1].min())
        log('IDLE height', round(stats['idle_height'], 2), 'width', round(stats['width_x'], 2), 'length',
            round(stats['length_y'], 2))
    stats['clips'] = {n: round(float(bpy.data.actions[n].get('duration', 0)), 3) for n in names}
    if out != '-':
        export(out, arm)
        stats['glb_bytes'] = os.path.getsize(out)
    if opt(argv, '--stats'):
        with open(opt(argv, '--stats'), 'w') as f:
            json.dump(stats, f, indent=1)
    if opt(argv, '--blend'):
        if 'Idle' in names:
            R.set_action(arm, bpy.data.actions['Idle'])
        bpy.ops.wm.save_as_mainfile(filepath=opt(argv, '--blend'))
        log('saved blend')
    log('DONE')


def export(path, arm):
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    for c in arm.children:
        c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='NONE', export_image_format='JPEG', export_jpeg_quality=88,
    )
    log('WROTE', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
