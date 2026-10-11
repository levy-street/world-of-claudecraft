"""Build Korzul the Gravewyrm from code (adapted from the Balgath, Great Saurian and
Great Jaguar builders).

  blender -b --factory-startup --python build.py -- <out.glb> [options]

  --voxel V        body sculpt voxel in yards (default 0.075; 0.14 for quick looks)
  --bake N         bake size (default 4096; the shipped maps are halved from it)
  --nobake         clay surfaces, no Cycles bake (pose and rig checks)
  --clips A,B      author only these clips
  --blend path     save the .blend
  --tex dir        write the baked maps to dir
  --stats path     write a JSON of counts and measurements
  --work dir       scratch for the VDB files
  -                as the output skips the export

Pipeline: the body is one signed-distance sculpt (anatomy.py) meshed through
OpenVDB (the HIGH skin) and decimated with the face, the feet and the joints
protected (the LOW skin); each wing arm is its own small sculpt the same way. The
dressing (dressing.py) adds the horns, the crown and the spines, teeth, eyes,
claws, the Smith's shackles and broken chains, the quench-ice, the heart-shard,
the wing fingers and the tattered membranes, each as a high/low pair. Skin
weights come from the sculpts' own primitives (rig.py); rigid parts ride one bone;
fingers and membranes carry their own proximity weights. All the lows share one
UV atlas; Cycles bakes albedo, roughness, metallic, tangent normals, occlusion and
emission from the highs. Two skinned meshes on one armature: Korzul (everything)
and KorzulShedIce (the slabs that burst off in BreakFree; hide it after).
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
MESH_NAMES = {'body': 'RimeWhelp'}
WHELP_HEIGHT = 3.2      # yards to the crown of the head at rest (the drawn height)
EMISSIVE_STRENGTH = 3.0


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


# ------------------------------------------------------------------ geometry
def protect_group(obj, wing=False):
    """Decimator weights: the head, the feet and the joints keep their triangles."""
    P, _ = R.mesh_arrays(obj)
    w = np.zeros(len(P))
    if wing:
        spots = []
        for s in (1, -1):
            spots += [(A._m(A.W_ELBOW, s), 1.4, 0.6), (A._m(A.W_WRIST, s), 1.2, 0.6)]
    else:
        spots = [(A.H((0, -20.0, 15.6)), 4.2, 1.0), (A.H((0, -18.6, 16.2)), 2.6, 0.6)]
        for s in (1, -1):
            m = (lambda p: p) if s > 0 else A.mirror
            spots += [(m(A.FPAW), 2.2, 0.8), (m(A.HPAW), 2.2, 0.8), (m(A.ELBOW), 1.8, 0.5), (m(A.KNEE), 1.9, 0.5),
                      (m(A.WRIST), 1.5, 0.5), (m(A.HOCK), 1.5, 0.5), (m(A.SHOULDER), 2.5, 0.35)]
    for c, r, k in spots:
        d = np.linalg.norm(P - c, axis=1)
        w = np.maximum(w, k * np.clip(1.2 - d / r, 0, 1))
    g = obj.vertex_groups.new(name='Protect')
    for i in np.nonzero(w > 0.02)[0]:
        g.add([int(i)], float(min(1.0, w[i])), 'REPLACE')
    return g


def build_skin(F, name, target_tris, workdir, wing=False):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    log(name, 'high', len(hi.data.polygons), 'faces')
    lo = K.duplicate(hi, name)
    protect_group(lo, wing)
    tris = K.triangles(lo)
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    mod.vertex_group = 'Protect'
    mod.invert_vertex_group = True
    mod.vertex_group_factor = 6.0
    K.apply_mods(lo)
    lo.vertex_groups.clear()
    for o in (hi, lo):
        o['mat'] = 'skin'
        o['binding'] = 'skin'
        o['bone'] = ''
        o['group'] = 'body'
        for p in o.data.polygons:
            p.use_smooth = True
    log(name, 'low', K.triangles(lo), 'tris')
    return hi, lo


def bind_low(obj):
    kind = obj.get('binding', 'rigid')
    if kind in ('skin', 'preset'):
        return
    if kind == 'rigid':
        R.rigid(obj, obj['bone'])
    else:
        raise ValueError(kind)


HEAD_C = A.H((0, -20.0, 16.0))


def uv_boost(obj, center):
    """More texels for the face, the eyes, the shard and the shackles; fewer for the
    membranes, the soles and the hidden undersides."""
    c = np.array(center)
    m = obj.get('mat')
    if m == 'eye':
        return 2.6
    if m == 'shard':
        return 1.6
    if m == 'membrane':
        return 0.32
    if obj.get('group') == 'shed':
        return 0.45
    if np.linalg.norm(c - HEAD_C) < 4.5:
        return 1.7
    if c[2] < 0.4:
        return 0.35
    return {'iron': 0.55, 'rune_iron': 1.0, 'ice': 0.55, 'horn': 0.85, 'tooth': 0.8, 'claw': 0.7, 'mouth': 0.35}.get(m, 1.0)


# ------------------------------------------------------------------ materials
def shipping_material(albedo, normal, orm, emit):
    body = bpy.data.materials.new('RimeWhelpBody')
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
    ie = nt.nodes.new('ShaderNodeTexImage')
    ie.image = emit
    nt.links.new(ie.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = EMISSIVE_STRENGTH
    body.use_backface_culling = False     # the membranes are single sheets
    return body


CLAY = {'skin': (0.3, 0.33, 0.38), 'membrane': (0.22, 0.18, 0.2), 'horn': (0.82, 0.78, 0.68),
        'tooth': (0.85, 0.8, 0.68), 'claw': (0.12, 0.12, 0.13), 'eye': (0.5, 0.85, 1.0), 'mouth': (0.16, 0.26, 0.38),
        'iron': (0.22, 0.23, 0.25), 'rune_iron': (0.25, 0.3, 0.38), 'ice': (0.6, 0.82, 0.95), 'shard': (1.0, 0.7, 0.45)}


def clay_materials():
    out = {}
    for k, c in CLAY.items():
        m = bpy.data.materials.new('Clay_' + k)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*S.srgb(c)[:3], 1)
        b.inputs['Roughness'].default_value = 0.55
        if k in ('eye', 'shard'):
            b.inputs['Emission Color'].default_value = (*S.srgb(c)[:3], 1)
            b.inputs['Emission Strength'].default_value = 4.0
        m.use_backface_culling = False
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
    voxel = float(opt(argv, '--voxel', 0.075))
    bake_size = int(opt(argv, '--bake', 4096))
    nobake = '--nobake' in argv
    fast = voxel >= 0.11
    workdir = opt(argv, '--work', os.path.join(os.path.dirname(os.path.abspath(out)) if out != '-' else HERE, '_work'))
    workdir = os.path.abspath(workdir)
    os.makedirs(workdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    log('sculpt voxel', voxel)
    F = A.build_body(voxel=voxel)
    log('field', F.shape)
    skin_hi, skin_lo = build_skin(F, 'WhelpSkin', 8000 if fast else 10500, workdir)
    skin_bones, skin_W = R.weight_skin(skin_lo, F, tau=0.18)
    highs, lows = [skin_hi], [skin_lo]
    for s in (1, -1):
        WF = A.build_wing(voxel=max(0.055, voxel * 0.8), s=s)
        whi, wlo = build_skin(WF, D.side_name('WingArm', s), 900 if fast else 1300, workdir, wing=True)
        R.weight_skin(wlo, WF, tau=0.14)
        highs.append(whi)
        lows.append(wlo)
    log('skin weights', len(skin_bones), 'bones')
    pairs = D.build_all(F, workdir, fast=fast)
    log('dressing', len(pairs), 'pairs')
    for hi, lo in pairs:
        # a whelp comes in fours: the dressing ships at half Korzul's density
        tris = K.triangles(lo)
        if tris > 300 and lo.get('binding') != 'preset':
            K.decimate(lo, ratio=0.45)
        elif tris > 300:
            K.decimate(lo, ratio=0.6)
    for hi, lo in pairs:
        bind_low(lo)
        highs.append(hi)
        lows.append(lo)
    stats = {'tris': {}, 'parts': len(lows)}
    for o in lows:
        stats['tris'][o.name] = K.triangles(o)
    log('triangles total', sum(stats['tris'].values()))
    top = sorted(stats['tris'].items(), key=lambda kv: -kv[1])[:25]
    log('TOP', top)
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
        res = S.bake_all(highs, joined, size=bake_size, samples=int(opt(argv, '--ao-samples', 24)), out_dir=tex_dir)
        bpy.data.objects.remove(joined, do_unlink=True)
        ao = res['ao'][..., :1]
        albedo = res['albedo'].copy()
        albedo[..., :3] *= (1.0 - 0.5 * (1.0 - ao))
        orm = np.ones_like(albedo)
        orm[..., 1] = res['rough'][..., 0]
        orm[..., 2] = res['metal'][..., 0]
        emit = res['emit'].copy()
        emit[..., 3] = 1.0
        ship = bake_size // 2 if bake_size >= 4096 else bake_size
        k = bake_size // ship
        a_img = to_numpy_image('RimeWhelpAlbedo', downsample(albedo, k) if k > 1 else albedo)
        n_img = to_numpy_image('RimeWhelpNormal', downsample(res['normal'], k) if k > 1 else res['normal'], 'Non-Color')
        o_img = to_numpy_image('RimeWhelpORM', downsample(orm, k * 2), 'Non-Color')
        e_img = to_numpy_image('RimeWhelpEmissive', downsample(emit, k * 2))
        if tex_dir:
            for img, nm in ((a_img, 'albedo'), (n_img, 'normal'), (o_img, 'orm'), (e_img, 'emissive')):
                img.filepath_raw = os.path.join(tex_dir, f'rime_whelp_{nm}_{img.size[0]}.png')
                img.file_format = 'PNG'
                img.save()
        mat = shipping_material(a_img, n_img, o_img, e_img)
        for o in lows:
            o.data.materials.clear()
            o.data.materials.append(mat)
        log('bake done')
    for h in highs:
        h.hide_render = True
        h.hide_viewport = True
    for o in lows:
        col = o.data.color_attributes.get('Col')
        if col is not None:
            o.data.color_attributes.remove(col)
    arm = R.build_armature('RimeWhelp')
    meshes = {}
    groups = {g: [o for o in lows if o.get('group', 'body') == g] for g in MESH_NAMES}
    groups['body'] = [skin_lo] + [o for o in groups['body'] if o is not skin_lo]
    for grp, nm in MESH_NAMES.items():
        if not groups[grp]:
            continue
        ob = join(groups[grp], nm)
        ob.parent = arm
        mod = ob.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        missing = {g.name for g in ob.vertex_groups} - {b.name for b in arm.data.bones}
        if missing:
            raise RuntimeError(f'{nm}: groups with no bone: {missing}')
        meshes[grp] = ob
        stats['tris_' + grp] = K.triangles(ob)
    stats['tris_total'] = sum(stats['tris_' + g] for g in meshes)
    stats['bones'] = len(arm.data.bones)
    log('meshes', {g: stats['tris_' + g] for g in meshes}, stats['bones'], 'bones')
    import clips as C
    only = opt(argv, '--clips')
    names = C.make_clips(arm, only.split(',') if only else None)
    log('clips', len(names))
    if 'Idle' in names:
        R.set_action(arm, bpy.data.actions['Idle'])
        bpy.context.scene.frame_set(13)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = meshes['body'].evaluated_get(dg)
        co = np.array([(ev.matrix_world @ v.co)[:] for v in ev.data.vertices])
        stats['idle_height'] = float(co[:, 2].max())
        stats['idle_minz'] = float(co[:, 2].min())
        stats['length_y'] = float(co[:, 1].max() - co[:, 1].min())
        stats['width_x'] = float(co[:, 0].max() - co[:, 0].min())
        log('IDLE_HEIGHT', round(stats['idle_height'], 2), 'len', round(stats['length_y'], 2), 'width',
            round(stats['width_x'], 2))
    stats['clips'] = {n: round(float(bpy.data.actions[n].get('duration', 0)), 3) for n in names}
    if 'Idle' in names:
        k_ = WHELP_HEIGHT / stats['idle_height']
        rescale(arm, list(meshes.values()), k_)
        stats['scale_from_korzul_kit'] = k_
        R.set_action(arm, bpy.data.actions['Idle'])
        bpy.context.scene.frame_set(13)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = meshes['body'].evaluated_get(dg)
        co = np.array([(ev.matrix_world @ v.co)[:] for v in ev.data.vertices])
        stats['idle_height'] = float(co[:, 2].max())
        stats['idle_minz'] = float(co[:, 2].min())
        stats['length_y'] = float(co[:, 1].max() - co[:, 1].min())
        stats['width_x'] = float(co[:, 0].max() - co[:, 0].min())
        log('SCALED', round(k_, 4), 'IDLE_HEIGHT', round(stats['idle_height'], 3), 'len', round(stats['length_y'], 2))
    drop_unused_bones(arm, list(meshes.values()))
    stats['bones'] = len(arm.data.bones)
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


def rescale(arm, meshes, k):
    """Scale the whole built creature by k: the rest skeleton, the meshes and every
    keyed location (the clips' body offsets), so the clips play the same at the new size."""
    from mathutils import Matrix
    arm.animation_data.action = None
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in arm.data.edit_bones:
        eb.head = eb.head * k
        eb.tail = eb.tail * k
    bpy.ops.object.mode_set(mode='OBJECT')
    for m in meshes:
        m.data.transform(Matrix.Scale(k, 4))
        m.data.update()
    for act in bpy.data.actions:
        for fc in R.fcurves(act):
            if fc.data_path.endswith('.location'):
                for kp in fc.keyframe_points:
                    kp.co[1] *= k
                    kp.handle_left[1] *= k
                    kp.handle_right[1] *= k
                fc.update()


def drop_unused_bones(arm, meshes):
    """Remove the Korzul-kit bones the whelp has no use for (nothing weighted to
    them, no child, not an anchor): the shard and any leftover helpers."""
    used = set()
    for m in meshes:
        names = {g.index: g.name for g in m.vertex_groups}
        for v in m.data.vertices:
            for g in v.groups:
                if g.weight > 0:
                    used.add(names[g.group])
    keep_always = {'Root', 'Mouth', 'TailTip', 'L_WingTip', 'R_WingTip'}
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    gone = []
    for eb in list(arm.data.edit_bones):
        if eb.name in used or eb.name in keep_always or eb.children:
            continue
        if eb.name in ('Shard',) or eb.name.startswith(('IceShed', 'Chain')):
            gone.append(eb.name)
            arm.data.edit_bones.remove(eb)
    bpy.ops.object.mode_set(mode='OBJECT')
    for act in bpy.data.actions:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    for fc in list(cb.fcurves):
                        if any(f'"{g}"' in fc.data_path for g in gone):
                            cb.fcurves.remove(fc)
    log('dropped bones', gone)


def export(path, arm, animations=True):
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
        export_animations=animations, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='NONE', export_image_format='JPEG', export_jpeg_quality=88,
    )
    log('WROTE', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
