"""The Sanctum trash build driver (shared by every creature; adapted from the Velkhar
and Korgath builders).

  blender -b --factory-startup --python <creature>/build.py -- <out.glb> [options]

  --k K            voxel multiplier for every sculpt (1.0 final, 1.6 quick looks)
  --bake N         bake size (default 2048; shipped at the bake size, ORM halved)
  --nobake         clay surfaces, no Cycles bake (pose and rig checks)
  --clips A,B      author only these clips
  --blend path     save the .blend
  --tex dir        write the baked maps to dir
  --stats path     write a JSON of counts and measurements
  --work dir       scratch for the VDB files
  --variant name   a creature-defined variant (the Bonewalker of the Boneguard)

A creature module (the caller's `anatomy`, `dressing`, `shading`, `clips`) gives:
  anatomy.NAME, anatomy.BONES, anatomy.fields(k, variant) -> [Sculpt]
  dressing.build(fields, variant) -> [(hi, lo)] parts (each lo tagged mat/binding/bone)
  shading.KINDS, shading.shade(mat, kind), shading.GLOWS {mat: (srgb, strength, name)}
  shading.uv_boost(obj, centre) -> texel scale
  clips.make_clips(arm, only) -> [clip names]

Pipeline: every sculpt is a signed-distance field meshed through OpenVDB (HIGH) and
decimated with protected spots (LOW); skin weights come from each sculpt's own
primitives; the dressing's lows are rigid on one bone, copy the nearest skin
weights, or carry their own. All baked lows share one UV atlas; Cycles bakes albedo,
roughness, metal, tangent normals, occlusion and emission from the highs. Glow parts
keep flat emissive materials. The lows join into ONE skinned mesh on one armature
(separate parts stay their own meshes when tagged `separate`).
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np

import mesh_kit as K
import rig as R
import sdf
import surface as S

T0 = time.time()


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


class Sculpt:
    """One signed-distance sculpt to mesh: its field, surface kind, low triangle
    budget, protected spots ((centre, radius, strength)) and weight temperature."""

    def __init__(self, name, field, mat, target, spots=(), tau=0.05, binding='skin', relax=4, zcut=None,
                 keep=None, bone='', allow=None, paint=None, separate=None, weigh=None):
        self.name, self.F, self.mat, self.target, self.spots = name, field, mat, target, spots
        self.tau, self.binding, self.relax, self.zcut, self.keep = tau, binding, relax, zcut, keep
        self.bone, self.allow, self.paint, self.separate, self.weigh = bone, allow, paint, separate, weigh


# ------------------------------------------------------------------ geometry
def protect(obj, spots):
    P, _ = R.mesh_arrays(obj)
    w = np.zeros(len(P))
    for c, r, k in spots:
        d = np.linalg.norm(P - np.asarray(c), axis=1)
        w = np.maximum(w, k * np.clip(1.2 - d / r, 0, 1))
    g = obj.vertex_groups.new(name='Protect')
    for i in np.nonzero(w > 0.02)[0]:
        g.add([int(i)], float(min(1.0, w[i])), 'REPLACE')


def cut_verts(obj, keep_fn):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    kill = [v for v in bm.verts if not keep_fn(v.co)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()


def mesh_part(sc, workdir):
    hi = sdf.to_mesh(sc.F, sc.name + '_hi', bpy, workdir=workdir)
    if sc.keep is not None:
        cut_verts(hi, sc.keep)
    if sc.paint is not None:
        sc.paint(hi)
    lo = K.duplicate(hi, sc.name)
    for nm in [a.name for a in lo.data.attributes if a.name.startswith('Reg')]:
        lo.data.attributes.remove(lo.data.attributes[nm])
    if sc.spots:
        protect(lo, sc.spots)
    tris = K.triangles(lo)
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, sc.target / max(1, tris))
    mod.use_collapse_triangulate = True
    if sc.spots:
        mod.vertex_group = 'Protect'
        mod.invert_vertex_group = True
        mod.vertex_group_factor = 5.0
    K.apply_mods(lo)
    lo.vertex_groups.clear()
    for o in (hi, lo):
        o['mat'] = sc.mat
        o['binding'] = 'skin'
        o['bone'] = ''
        for p in o.data.polygons:
            p.use_smooth = True
    log(sc.name, 'high', len(hi.data.polygons), 'low', K.triangles(lo))
    return hi, lo


def weight_field(obj, F, tau=0.05, relax=4):
    P, E = R.mesh_arrays(obj)
    bones, W = sdf.skin_weights(F.prims, P, tau=tau)
    W = R.relax(W, E, iters=relax)
    W = R.cap4(W)
    R.write_groups(obj, bones, W)
    return bones, W


def bind_low(obj, skin, sb, sW):
    kind = obj.get('binding', 'rigid')
    if kind in ('skin', 'own'):
        return
    if kind == 'rigid':
        R.rigid(obj, obj['bone'])
    elif kind == 'transfer':
        allow = obj['allow'].split(',') if obj.get('allow') else None
        transfer_allowed(obj, skin, sb, sW, allow, int(obj.get('relax', 0)))
        if obj.get('swap'):
            # a piece that rides twin bones (same rest, keyed only in scale):
            # the weights move from each bone to its twin, 'A>B' by prefix
            for pair in str(obj['swap']).split(','):
                a, b = pair.split('>')
                for g in obj.vertex_groups:
                    if g.name.startswith(a):
                        g.name = b + g.name[len(a):]
    elif kind == 'chain':
        R.nearest_segment(obj, obj['chain_bones'].split(','))
    else:
        raise ValueError(kind)


def transfer_allowed(obj, skin, sb, sW, allow=None, relax=0):
    """Copy the nearest skin weights; with `allow`, keep only those bones (a plate
    rides the bones it covers, never a finger it hovers near), then relax them over
    the mesh so a plate bends as one stiff piece."""
    from mathutils import Vector, kdtree
    P, E = R.mesh_arrays(obj)
    SP, _ = R.mesh_arrays(skin)
    tree = kdtree.KDTree(len(SP))
    for i, p in enumerate(SP):
        tree.insert(Vector(p), i)
    tree.balance()
    W = np.zeros((len(P), len(sb)))
    for i, p in enumerate(P):
        tot = 0.0
        for co, idx, dist in tree.find_n(Vector(p), 8):
            w = 1.0 / (dist + 0.03) ** 2
            W[i] += sW[idx] * w
            tot += w
        W[i] /= tot
    if allow:
        keep = np.array([b in allow for b in sb])
        W[:, ~keep] = 0.0
        empty = W.sum(axis=1) < 1e-6
        if empty.any():
            W[empty, sb.index(allow[0])] = 1.0
        W /= W.sum(axis=1, keepdims=True)
    if relax:
        W = R.relax(W, E, iters=relax)
    W = R.cap4(W)
    R.write_groups(obj, sb, W)


# ------------------------------------------------------------------ materials
def shipping_material(name, albedo, normal, orm, emit=None, emit_strength=5.0):
    body = bpy.data.materials.new(name)
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
    if emit is not None:
        ie = nt.nodes.new('ShaderNodeTexImage')
        ie.image = emit
        nt.links.new(ie.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    return body


def glow_materials(glows):
    out = {}
    for k, (c, strength, name) in glows.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        lin = S.srgb(c)
        b.inputs['Base Color'].default_value = lin
        b.inputs['Emission Color'].default_value = lin
        b.inputs['Emission Strength'].default_value = strength
        b.inputs['Roughness'].default_value = 0.4
        out[k] = m
    return out


def clay_materials(kinds):
    out = {}
    for k in kinds:
        m = bpy.data.materials.new('Clay_' + k)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.5, 0.5, 0.52, 1)
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


# ------------------------------------------------------------------ main
def run(A, D, SH, C):
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    k = float(opt(argv, '--k', 1.0))
    bake_size = int(opt(argv, '--bake', 2048))
    nobake = '--nobake' in argv
    variant = opt(argv, '--variant', None)
    workdir = os.path.abspath(opt(argv, '--work', os.path.join(
        os.path.dirname(os.path.abspath(out)) if out != '-' else os.getcwd(), '_work')))
    os.makedirs(workdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    if hasattr(A, 'set_variant'):
        A.set_variant(variant)
    name = A.NAME
    prefix = A.PREFIX
    log(name, 'voxel multiplier', k, 'variant', variant)
    sculpts = A.fields(k)
    log('fields', len(sculpts))
    skins = []
    skin_bind = None
    for sc in sculpts:
        hi, lo = mesh_part(sc, workdir)
        if sc.binding == 'skin':
            bones, W = weight_field(lo, sc.F, sc.tau, sc.relax)
            if skin_bind is None:
                skin_bind = (lo, bones, W)
        else:
            lo['binding'] = sc.binding
            lo['bone'] = sc.bone
            if sc.allow:
                lo['allow'] = ','.join(sc.allow)
            lo['relax'] = sc.relax
        if sc.binding == 'own':
            sc.weigh(lo)
        if sc.separate:
            lo['separate'] = sc.separate
        skins.append((hi, lo))
    pairs = D.build(sculpts)
    log('dressing', len(pairs), 'pairs')
    lows = [lo for _, lo in skins] + [lo for _, lo in pairs]
    highs = [hi for hi, _ in skins] + [hi for hi, _ in pairs]
    for lo in lows:
        bind_low(lo, *skin_bind)
    glow_lows = [o for o in lows if str(o.get('mat')).startswith('glow')]
    baked_lows = [o for o in lows if not str(o.get('mat')).startswith('glow')]
    stats = {'tris': {o.name: K.triangles(o) for o in lows}, 'parts': len(lows)}
    log('triangles total', sum(stats['tris'].values()))
    glows = glow_materials(SH.GLOWS)
    if nobake:
        clay = clay_materials(SH.KINDS)
        for o in baked_lows:
            o.data.materials.clear()
            o.data.materials.append(clay[o['mat']])
    else:
        S.unwrap(baked_lows, scale_fn=SH.uv_boost)
        log('uv done')
        bake_mats = S.bake_materials(SH.shade, SH.KINDS)
        bake_highs = [h for h in highs if not str(h.get('mat')).startswith('glow')]
        for h in bake_highs:
            h.data.materials.clear()
            h.data.materials.append(bake_mats[h['mat']])
        tex_dir = opt(argv, '--tex')
        if tex_dir:
            os.makedirs(tex_dir, exist_ok=True)
        joined = K.duplicate(baked_lows[0], 'BakeLow')
        others = [K.duplicate(o, o.name + '_bk') for o in baked_lows[1:]]
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for o in [joined] + others:
            o.select_set(True)
        bpy.context.view_layer.objects.active = joined
        bpy.ops.object.join()
        for h in highs:
            if str(h.get('mat')).startswith('glow'):
                h.hide_render = True
        res = S.bake_all(bake_highs, joined, size=bake_size, samples=32, cage=getattr(A, 'BAKE_CAGE', 0.03),
                         ray=getattr(A, 'BAKE_RAY', 0.12), out_dir=tex_dir, prefix=prefix)
        bpy.data.objects.remove(joined, do_unlink=True)
        ao = res['ao'][..., :1]
        albedo = res['albedo'].copy()
        albedo[..., :3] *= (1.0 - 0.5 * (1.0 - ao))
        orm = np.ones_like(albedo)
        orm[..., 1] = res['rough'][..., 0]
        orm[..., 2] = res['metal'][..., 0]
        emit = res['emit'].copy()
        emit[..., 3] = 1.0
        has_emit = float(emit[..., :3].max()) > 0.02
        a_img = to_numpy_image(name + 'Albedo', albedo)
        n_img = to_numpy_image(name + 'Normal', res['normal'], 'Non-Color')
        o_img = to_numpy_image(name + 'ORM', downsample(orm, 2), 'Non-Color')
        e_img = to_numpy_image(name + 'Emissive', downsample(emit, 2)) if has_emit else None
        if tex_dir:
            maps = [(a_img, 'albedo'), (n_img, 'normal'), (o_img, 'orm')] + ([(e_img, 'emissive')] if e_img else [])
            for img, nm in maps:
                img.filepath_raw = os.path.join(tex_dir, f'{prefix}_{nm}_{img.size[0]}.png')
                img.file_format = 'PNG'
                img.save()
        mat = shipping_material(name + 'Body', a_img, n_img, o_img, e_img, getattr(SH, 'EMIT_STRENGTH', 5.0))
        for o in baked_lows:
            o.data.materials.clear()
            o.data.materials.append(mat)
        log('bake done')
    for o in glow_lows:
        o.data.materials.clear()
        o.data.materials.append(glows[o['mat']])
    for h in highs:
        h.hide_render = True
        h.hide_viewport = True
    for o in lows:
        col = o.data.color_attributes.get('Col')
        if col is not None:
            o.data.color_attributes.remove(col)
    separate = [o for o in lows if o.get('separate')]
    joined_lows = [o for o in lows if not o.get('separate')]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in joined_lows:
        o.select_set(True)
    bpy.context.view_layer.objects.active = joined_lows[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name
    body.data.name = name
    arm = R.build_armature(name)
    for o in [body] + separate:
        if o.get('separate'):
            o.name = o['separate']
            o.data.name = o['separate']
        o.parent = arm
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        missing = {g.name for g in o.vertex_groups} - {b.name for b in arm.data.bones}
        if missing:
            raise RuntimeError(f'groups with no bone: {missing}')
        unweighted = 0
        for v in o.data.vertices:
            if not v.groups or sum(g.weight for g in v.groups) < 1e-4:
                unweighted += 1
        if unweighted:
            raise RuntimeError(f'{o.name}: {unweighted} vertices carry no weight')
    stats['tris_total'] = K.triangles(body) + sum(K.triangles(o) for o in separate)
    stats['tris_body'] = K.triangles(body)
    stats['bones'] = len(arm.data.bones)
    stats['materials'] = sorted({m.name for o in [body] + separate for m in o.data.materials})
    log('body', stats['tris_total'], 'tris,', stats['bones'], 'bones')
    only = opt(argv, '--clips')
    names = C.make_clips(arm, only.split(',') if only else None)
    log('clips', len(names))
    R.set_action(arm, bpy.data.actions['Idle'])
    bpy.context.scene.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    co = np.array([(ev.matrix_world @ v.co)[:] for v in ev.data.vertices])
    stats['idle_height'] = float(co[:, 2].max() - co[:, 2].min())
    stats['idle_minz'] = float(co[:, 2].min())
    stats['idle_extent_y'] = [float(co[:, 1].min()), float(co[:, 1].max())]
    stats['idle_extent_x'] = [float(co[:, 0].min()), float(co[:, 0].max())]
    stats['clips'] = {n: round(float(bpy.data.actions[n].get('duration', 0)), 3) for n in names}
    for k_ in ('walkRef', 'runRef'):
        if hasattr(C, k_.upper()):
            stats[k_] = getattr(C, k_.upper())
    log('IDLE_HEIGHT', round(stats['idle_height'], 3), 'MINZ', round(stats['idle_minz'], 3))
    if out != '-':
        export(out, arm)
        stats['glb_bytes'] = os.path.getsize(out)
    if opt(argv, '--stats'):
        with open(opt(argv, '--stats'), 'w') as f:
            json.dump(stats, f, indent=1)
    if opt(argv, '--blend'):
        R.set_action(arm, bpy.data.actions['Idle'])
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt(argv, '--blend')))
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
        filepath=os.path.abspath(path), export_format='GLB', use_selection=True, export_apply=False,
        export_yup=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_image_format='JPEG', export_jpeg_quality=90,
    )
    log('WROTE', path, os.path.getsize(path), 'bytes')
