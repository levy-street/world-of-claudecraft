"""Build the Snarlvine Lasher (or, with LASHER_VARIANT=sprout, the Thorn Sprout)
from code (adapted from the Great Jaguar, Great Saurian and Balgath builders).

  LASHER_VARIANT=lasher|sprout blender -b --factory-startup --python build.py -- <out.glb> [options]

  --voxel V        skin sculpt voxel in yards (default 0.02; 0.035 for quick looks)
  --bake N         bake size (default 2048)
  --nobake         clay surfaces, no Cycles bake (pose and rig checks)
  --clips A,B      author only these clips
  --blend path     save the .blend
  --tex dir        write the baked maps to dir
  --stats path     write a JSON of counts and measurements
  --work dir       scratch for the VDB files
  -                as the output skips the export

Pipeline: the body is one signed-distance sculpt (anatomy.py: core masses wrapped
in braided vine strands) meshed through OpenVDB (the HIGH skin) and decimated
with the face, the feet and the joints protected (the LOW skin). The dressing
(dressing.py) adds bark plates, moss, thorns, the branch crown, flowers, the sap
eyes, the maw and its teeth, each as a high/low pair. Skin weights come from the
sculpt's own core primitives (rig.py); thorns, moss and flowers copy the nearest
skin weights; plates and teeth ride one bone. All the lows share one UV atlas;
Cycles bakes albedo, roughness, tangent normals, occlusion and the EMISSIVE sap
glow from the highs. The lows are joined into ONE skinned mesh on one armature.
The Sprout is built in Lasher units (the same skeleton and clip code) and scaled
by anatomy.SPROUT_SCALE at the end: vertices, bones and every location key.
"""
import json
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anatomy as A  # noqa: E402
import dressing as D  # noqa: E402
import mesh_kit as K  # noqa: E402
import rig as R  # noqa: E402
import sdf  # noqa: E402
import surface as S  # noqa: E402

T0 = time.time()
NAME = 'ThornSprout' if A.SPROUT else 'SnarlvineLasher'
TAG = 'sprout' if A.SPROUT else 'lasher'
S.SPROUT = A.SPROUT


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


# ------------------------------------------------------------------ geometry
def protect_group(obj):
    P, _ = R.mesh_arrays(obj)
    w = np.zeros(len(P))
    spots = [(A.HEAD_C + np.array((0, -0.3, 0)), 0.75, 1.0), (A.HEAD_C, 1.1, 0.5)]
    for s in (1, -1):
        m = (lambda p: p) if s > 0 else A.mirror
        spots += [(m(A.FOOT_T), 0.6, 0.7), (m(A.ELBOW), 0.5, 0.5), (m(A.KNEE), 0.5, 0.5), (m(A.WRIST), 0.45, 0.6),
                  (m(A.SHOULDER), 0.5, 0.4)]
    for c, r, k in spots:
        d = np.linalg.norm(P - c, axis=1)
        w = np.maximum(w, k * np.clip(1.2 - d / r, 0, 1))
    g = obj.vertex_groups.new(name='Protect')
    for i in np.nonzero(w > 0.02)[0]:
        g.add([int(i)], float(min(1.0, w[i])), 'REPLACE')
    return g


def build_skin(F, target_tris, workdir):
    hi = sdf.to_mesh(F, NAME + 'Skin_hi', bpy, workdir=workdir)
    log('skin high', len(hi.data.polygons), 'faces')
    lo = K.duplicate(hi, NAME + 'Skin')
    protect_group(lo)
    tris = K.triangles(lo)
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    mod.vertex_group = 'Protect'
    mod.invert_vertex_group = True
    mod.vertex_group_factor = 5.0
    K.apply_mods(lo)
    lo.vertex_groups.clear()
    for o in (hi, lo):
        o['mat'] = 'vine'
        o['binding'] = 'skin'
        o['bone'] = ''
        o['group'] = 'body'
        for p in o.data.polygons:
            p.use_smooth = True
    log('skin low', K.triangles(lo), 'tris')
    return hi, lo


def build_dressing(F, workdir, fast=False):
    v = 0.03 if fast else 0.02
    pairs = []
    pairs += D.build_bark(F, voxel=v, workdir=workdir)
    log('bark', len(pairs))
    if not A.SPROUT:
        pairs += [D.build_moss(F, voxel=0.04 if fast else 0.03, workdir=workdir)]
        pairs += D.build_flowers(F)
    pairs += D.build_thorns(F)
    pairs += D.build_crown(F)
    pairs += D.build_face(F)
    log('dressing', len(pairs), 'pairs')
    return pairs


def bind_low(obj, skin, skin_bones, skin_W):
    kind = obj.get('binding', 'rigid')
    if kind == 'skin':
        return
    if kind == 'rigid':
        R.rigid(obj, obj['bone'])
    elif kind == 'transfer':
        R.transfer_weights(obj, skin, skin_bones, skin_W)
    else:
        raise ValueError(kind)


def uv_boost(obj, center):
    c = np.array(center)
    m = obj.get('mat')
    if m == 'sap':
        return 0.5
    if m == 'vine' and np.linalg.norm(c - A.HEAD_C) < 0.85:
        return 1.7
    if c[2] < 0.08:
        return 0.35
    return {'thorn': 0.55, 'moss': 0.6, 'petal': 0.9, 'pollen': 0.4, 'maw': 0.45, 'bark': 1.0}.get(m, 1.0)


# ------------------------------------------------------------------ materials
def shipping_material(albedo, normal, orm, emit):
    body = bpy.data.materials.new(NAME + 'Body')
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
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return body


CLAY = {'vine': (0.3, 0.33, 0.18), 'bark': (0.3, 0.24, 0.17), 'moss': (0.25, 0.4, 0.1), 'thorn': (0.4, 0.2, 0.12),
        'petal': (0.65, 0.06, 0.05), 'pollen': (0.9, 0.7, 0.15), 'sap': (0.7, 1.0, 0.2), 'maw': (0.15, 0.04, 0.03)}


def clay_materials():
    out = {}
    for k, c in CLAY.items():
        m = bpy.data.materials.new('Clay_' + k)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*S.srgb(c)[:3], 1)
        b.inputs['Roughness'].default_value = 0.6
        if k == 'sap':
            b.inputs['Emission Color'].default_value = (*S.srgb(c)[:3], 1)
            b.inputs['Emission Strength'].default_value = 4.0
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


def scale_all(arm, meshes, k):
    """Scale the built creature by k: the vertices, the bones and every location
    key (pose locations are in the bones' rest frames, so they scale by k)."""
    for ob in meshes:
        ob.data.transform(Matrix.Scale(k, 4))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for eb in arm.data.edit_bones:
        eb.head = eb.head * k
        eb.tail = eb.tail * k
    bpy.ops.object.mode_set(mode='OBJECT')
    for act in bpy.data.actions:
        for fc in R.fcurves(act):
            if fc.data_path.endswith('.location'):
                for kp in fc.keyframe_points:
                    kp.co[1] *= k
                    kp.handle_left[1] *= k
                    kp.handle_right[1] *= k
                fc.update()


# ------------------------------------------------------------------ main
def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    voxel = float(opt(argv, '--voxel', 0.02))
    bake_size = int(opt(argv, '--bake', 2048))
    nobake = '--nobake' in argv
    fast = voxel >= 0.03
    workdir = opt(argv, '--work', os.path.join(os.path.dirname(os.path.abspath(out)) if out != '-' else HERE, '_work'))
    workdir = os.path.abspath(workdir)
    os.makedirs(workdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    log('variant', A.VARIANT, 'voxel', voxel)
    F = A.build_body(voxel=voxel)
    log('field', F.shape)
    skin_hi, skin_lo = build_skin(F, (6500 if A.SPROUT else 15000) if not fast else 8000, workdir)
    pairs = build_dressing(F, workdir, fast=fast)
    skin_bones, skin_W = R.weight_skin(skin_lo, F)
    log('skin weights', len(skin_bones), 'bones')
    lows = [skin_lo] + [lo for _, lo in pairs]
    highs = [skin_hi] + [hi for hi, _ in pairs]
    for lo in lows[1:]:
        bind_low(lo, skin_lo, skin_bones, skin_W)
    stats = {'variant': A.VARIANT, 'tris': {}, 'parts': len(lows)}
    for o in lows:
        stats['tris'][o.name] = K.triangles(o)
    log('triangles total', sum(stats['tris'].values()))
    log('TOP', sorted(stats['tris'].items(), key=lambda kv: -kv[1])[:12])
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
        res = S.bake_all(highs, joined, size=bake_size, samples=32, out_dir=tex_dir)
        bpy.data.objects.remove(joined, do_unlink=True)
        ao = res['ao'][..., :1]
        albedo = res['albedo'].copy()
        albedo[..., :3] *= (1.0 - 0.6 * (1.0 - ao))
        emit = res['emit'].copy()
        albedo[..., :3] = np.maximum(albedo[..., :3], emit[..., :3] * 0.55)
        orm = np.ones_like(albedo)
        orm[..., 1] = res['rough'][..., 0]
        orm[..., 2] = res['metal'][..., 0]
        a_img = to_numpy_image(NAME + 'Albedo', albedo)
        n_img = to_numpy_image(NAME + 'Normal', res['normal'], 'Non-Color')
        o_img = to_numpy_image(NAME + 'ORM', downsample(orm, 2), 'Non-Color')
        e_img = to_numpy_image(NAME + 'Emissive', downsample(emit, 2))
        if tex_dir:
            for img, nm in ((a_img, 'albedo'), (n_img, 'normal'), (o_img, 'orm'), (e_img, 'emissive')):
                img.filepath_raw = os.path.join(tex_dir, f'{TAG}_{nm}_{img.size[0]}.png')
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
    arm = R.build_armature(NAME)
    ob = join(lows, NAME)
    ob.parent = arm
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    missing = {g.name for g in ob.vertex_groups} - {b.name for b in arm.data.bones}
    if missing:
        raise RuntimeError(f'{NAME}: groups with no bone: {missing}')
    stats['tris_total'] = K.triangles(ob)
    stats['bones'] = len(arm.data.bones)
    log('mesh', stats['tris_total'], 'tris', stats['bones'], 'bones')
    import clips as C
    only = opt(argv, '--clips')
    names = C.make_clips(arm, only.split(',') if only else None)
    log('clips', names)
    if A.SPROUT:
        scale_all(arm, [ob], A.SPROUT_SCALE)
        log('scaled by', A.SPROUT_SCALE)
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
        log('IDLE_HEIGHT', round(stats['idle_height'], 2), 'len', round(stats['length_y'], 2), 'wid',
            round(stats['width_x'], 2))
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
