"""Build Balgath, the cyclops foreman of the Mirefen barrows, from code.

  blender -b --factory-startup --python build.py -- <out.glb> [options]

  --voxel V        skin sculpt voxel in yards (default 0.03; 0.05 for quick looks)
  --bake N         bake size (default 4096; the shipped maps are halved from it)
  --nobake         clay surfaces, no Cycles bake (pose and rig checks)
  --clips A,B      author only these clips
  --blend path     save the .blend
  --tex dir        write the baked maps (raw, full size) to dir
  --stats path     write a JSON of counts and measurements
  --form out.glb   also write the Knucklebone form (decimated body, form clips)
  -                as the output skips the export

Pipeline: the body is one signed-distance sculpt (anatomy.py) meshed through
OpenVDB at --voxel (the HIGH skin) and decimated with the face, hands and joints
protected (the LOW skin, about 30k triangles). The dressing (dressing.py) adds the
barrowhide slabs, the gear and the eye, each as a high/low pair. Skin weights come
from the sculpt's own primitives (rig.py). All the lows share one UV atlas; Cycles
bakes albedo, roughness, metallic, tangent normals and occlusion from the highs.
The clips (clips.py) are keyed on the armature, the follow-through springs run over
each, and the GLB is exported with every clip as an action. A clip-only change does
not need this whole run: reclip.py re-keys the clips on the saved --blend and exports
both bodies again, gated on arm tremor (jitter.py).
"""
import json
import math
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


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


def opt(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


# ------------------------------------------------------------------ geometry
def protect_group(obj):
    """Weights for the decimator: the face, the eye, the hands and the joints keep
    their triangles."""
    P, _ = R.mesh_arrays(obj)
    w = np.zeros(len(P))
    spots = [(np.array((0, -1.9, 12.3)), 1.7, 1.0)]
    for s in (1, -1):
        m = (lambda p: p) if s > 0 else A.mirror
        w_, down, width, palm = A.hand_frame(s)
        spots += [(w_ + down * 0.9, 1.7, 1.0), (m(A.ELBOW), 1.1, 0.7), (m(A.KNEE), 1.2, 0.7),
                  (m(A.SHOULDER) + np.array((0.3 * s, 0, 0)), 1.4, 0.5), (m(A.HIP), 1.3, 0.5),
                  (m(A.BALL), 1.0, 0.6), (m(A.WRIST), 0.9, 0.6)]
    for c, r, k in spots:
        d = np.linalg.norm(P - c, axis=1)
        w = np.maximum(w, k * np.clip(1.2 - d / r, 0, 1))
    g = obj.vertex_groups.new(name='Protect')
    for i in np.nonzero(w > 0.02)[0]:
        g.add([int(i)], float(min(1.0, w[i])), 'REPLACE')
    return g


def build_skin(F, target_tris, workdir):
    hi = sdf.to_mesh(F, 'BalgathSkin_hi', bpy, workdir=workdir)
    log('skin high', len(hi.data.polygons), 'faces')
    lo = K.duplicate(hi, 'BalgathSkin')
    protect_group(lo)
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
        for p in o.data.polygons:
            p.use_smooth = True
    log('skin low', K.triangles(lo), 'tris')
    return hi, lo


def build_dressing(F, workdir, fast=False):
    pairs = []
    noise = sdf.Noise(5)
    for i, slab in enumerate(D.slab_specs()):
        hi, lo, q, n, glow = D.build_slab(F, slab, i, voxel=0.03 if fast else 0.02, noise=noise, workdir=workdir)
        sh = A.SHOULDER if q[0] > 0 else A.mirror(A.SHOULDER)
        if np.linalg.norm(q - sh) < 1.9 and slab.bone is None:
            # Stone over the shoulder joint. On the TOP of the shoulder it belongs to
            # the girdle (rigid on the clavicle, which lifts when the arm goes over
            # the head); on the arm the old binding drove the pauldron into the
            # trapezius and the jaw. On the side of the deltoid it rides the skin.
            side = 'L_' if q[0] > 0 else 'R_'
            for o in (hi, lo) + (tuple(glow) if glow else ()):
                if n[2] > 0.55:
                    o['binding'] = 'rigid'
                    o['bone'] = side + 'Clavicle'
                else:
                    o['binding'] = 'transfer'
        pairs.append((hi, lo))
        if glow:
            pairs.append(glow)
    log('slabs', len(pairs))
    pairs.append(D.build_belt(F, voxel=0.04 if fast else 0.025, workdir=workdir))
    b_lo, b_hi = D.build_buckle(F)
    pairs.append((b_hi, b_lo))
    # Two turns of rope round the waist above the belt, crossing at the knot.
    for k, (dz, ph) in enumerate(((0.36, 0.0), (0.5, 1.7))):
        def z_of(th, dz=dz, ph=ph):
            y = -math.cos(th) * 2.0
            return D.belt_center(y) + dz + 0.07 * math.sin(th * 2 + ph)
        path = D._ring_path(F, z_of, offset=0.12, n=44)
        pairs.append(D.rope_parts(path, 0.1, f'WaistRope{k}', bone='Hips', binding='transfer'))
    # The knot on his right flank and its two tails.
    knot = D.surface_along(F, (-1.0, -0.6, D.belt_center(-0.8) + 0.45), (-1, -0.5, 0))
    kp = K.Part('RopeKnot', 'rope', bone='Hips', binding='transfer')
    kp.sphere(knot + np.array((-0.1, -0.05, 0)), (0.2, 0.17, 0.22), seg=10, rings=7)
    kpo = kp.to_object()
    pairs.append((K.duplicate(kpo, 'RopeKnot_hi'), kpo))
    for j, (dx, ln) in enumerate(((-0.05, 1.1), (0.12, 0.8))):
        a = knot + np.array((dx - 0.12, -0.12, -0.1))
        tail = [a, a + np.array((-0.06, -0.06, -ln * 0.5)), a + np.array((-0.04, -0.04, -ln))]
        pairs.append(D.rope_parts(tail, 0.08, f'RopeTail{j}', bone='Hips', binding='transfer', closed=False))
    pairs += D.build_tally(workdir=workdir)
    pairs.append(D.build_apron(F, front=True))
    pairs.append(D.build_apron(F, front=False))
    # The bandolier: a work-gang chain from over his left shoulder, across the chest
    # to the right hip, and back up across the back.
    guide = [(1.25, 0.3, 11.2), (1.35, -0.6, 10.9), (1.0, -1.3, 10.1), (0.2, -1.7, 9.3), (-0.6, -1.9, 8.6),
             (-1.3, -1.6, 7.9), (-1.75, -0.8, 7.55), (-1.9, 0.3, 7.7), (-1.5, 1.0, 8.4), (-0.6, 1.2, 9.4),
             (0.4, 1.3, 10.3), (1.1, 1.0, 11.0)]
    centre = np.array((0, -0.1, 0))
    pts = []
    for g in guide:
        g = np.asarray(g, float)
        inside = np.array((g[0] * 0.3, centre[1] + g[1] * 0.2, g[2]))
        s = D.surface_along(F, inside, g - inside, max_dist=6)
        pts.append(s + D.normal_at(F, s) * 0.13)
    pts.append(pts[0])
    dense = []
    for a, b in zip(pts, pts[1:]):
        for k in range(4):
            q = a + (b - a) * k / 4
            # re-project onto the surface so the chain lies on him
            nn = D.normal_at(F, q)
            dd = F.sample(q[None])[0]
            dense.append(q - nn * (dd - 0.13))
    ch = D.chain(dense, link_len=0.4, R=0.15, r=0.05, name='Bandolier', bone='Spine2', binding='transfer', seg=6,
                 sides=4)
    pairs.append((K.duplicate(ch, 'Bandolier_hi'), ch))
    # A trophy shackle hanging off the bandolier over his sternum.
    sp = K.Part('TrophyShackle', 'iron', bone='Spine2', binding='transfer')
    c = D.surface_along(F, (0.05, -0.5, 9.0), (0.1, -1, -0.1)) + np.array((0, -0.22, 0))
    sp.torus(c, (0, 1, 0.1), 0.32, 0.075, seg=16, sides=6, squash=(1.0, 1.25))
    sp.tube([c + np.array((-0.36, 0, 0.32)), c + np.array((0.36, 0, 0.32))], 0.06, sides=6)
    spo = sp.to_object()
    pairs.append((K.duplicate(spo, 'TrophyShackle_hi'), spo))
    for s in (1, -1):
        pairs += D.build_wrist_iron(s)
    pairs += D.build_eye()
    pairs += D.build_teeth()
    log('dressing', len(pairs), 'pairs')
    return pairs


def stony_attribute(skin_hi, slabs, reach=0.9):
    """How close each skin vertex is to a barrowhide slab (1 at the stone's edge,
    0 a yard off): the skin shader greys and cracks the hide there, so the stone
    reads as growing out of him rather than stuck on."""
    from mathutils import kdtree
    pts = []
    for o in slabs:
        if o.data.polygons and len(o.data.vertices) > 400:  # not the nails
            pts += [tuple(v.co) for v in list(o.data.vertices)[::3]]
    tree = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    attr = skin_hi.data.attributes.new('Stony', 'FLOAT', 'POINT')
    for v, a in zip(skin_hi.data.vertices, attr.data):
        co, idx, d = tree.find(v.co)
        a.value = max(0.0, 1.0 - d / reach) ** 1.5
    log('stony attribute')


def bind_low(obj, F, skin, skin_bones, skin_W):
    kind = obj.get('binding', 'rigid')
    if kind == 'skin':
        return
    if kind == 'rigid':
        R.rigid(obj, obj['bone'])
    elif kind == 'transfer':
        R.transfer_weights(obj, skin, skin_bones, skin_W)
    elif kind == 'loin':
        R.loin_weights(obj, obj['loin_bones'].split(','), obj['z_top'], obj['z_bot'])
    elif kind == 'tally':
        R.nearest_segment(obj, ['Tally1', 'Tally2'])
    elif kind == 'chain':
        R.nearest_segment(obj, ['R_Forearm', 'R_Chain1', 'R_Chain2'])
    else:
        raise ValueError(kind)


def uv_boost(obj, center):
    """More texels for the face, the eye and the fists; fewer for the soles."""
    c = np.array(center)
    if obj.get('mat') in ('eye',):
        return 2.4
    if np.linalg.norm(c - np.array((0, -1.9, 12.4))) < 1.5:
        return 2.0
    for s in (1, -1):
        w, down, width, palm = A.hand_frame(s)
        if np.linalg.norm(c - (w + down * 0.9)) < 1.4:
            return 1.45
    if c[2] < 0.12:
        return 0.4
    return {'iron': 0.4, 'rope': 0.5, 'leather': 0.7, 'hide': 0.8, 'tooth': 1.2, 'mouth': 0.3}.get(obj.get('mat'), 1.0)


# ------------------------------------------------------------------ materials
def shipping_materials(albedo, normal, orm, glow_strength=4.0):
    body = bpy.data.materials.new('BalgathBody')
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
    glow = bpy.data.materials.new('BalgathGlow')
    glow.use_nodes = True
    g = glow.node_tree.nodes['Principled BSDF']
    vc = glow.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    glow.node_tree.links.new(vc.outputs['Color'], g.inputs['Base Color'])
    glow.node_tree.links.new(vc.outputs['Color'], g.inputs['Emission Color'])
    g.inputs['Emission Strength'].default_value = glow_strength
    g.inputs['Roughness'].default_value = 0.3
    return body, glow


def clay_materials():
    cols = {'skin': (0.5, 0.48, 0.43), 'stone': (0.6, 0.6, 0.58), 'leather': (0.25, 0.15, 0.09),
            'hide': (0.42, 0.31, 0.2), 'iron': (0.14, 0.14, 0.15), 'rope': (0.48, 0.39, 0.25),
            'tooth': (0.8, 0.73, 0.56), 'eye': (0.85, 0.85, 0.78), 'mouth': (0.15, 0.04, 0.04)}
    out = {}
    for k, c in cols.items():
        m = bpy.data.materials.new('Clay_' + k)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*S.srgb(c)[:3], 1)
        b.inputs['Roughness'].default_value = 0.6
        b.inputs['Metallic'].default_value = 0.8 if k == 'iron' else 0.0
        out[k] = m
    return out


def to_numpy_image(name, arr, colorspace='sRGB', size=None):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels[:] = arr.astype(np.float32).ravel()
    if size and size != w:
        img.scale(size, size)
    img.pack()
    return img


def downsample(arr, k=2):
    h, w, c = arr.shape
    return arr.reshape(h // k, k, w // k, k, c).mean(axis=(1, 3))


# ------------------------------------------------------------------ main
def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    voxel = float(opt(argv, '--voxel', 0.03))
    bake_size = int(opt(argv, '--bake', 4096))
    nobake = '--nobake' in argv
    fast = voxel >= 0.045
    workdir = opt(argv, '--work', os.path.join(os.path.dirname(os.path.abspath(out)) if out != '-' else HERE, '_work'))
    os.makedirs(workdir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = R.FPS
    log('sculpt voxel', voxel)
    F = A.build_body(voxel=voxel)
    log('field', F.shape)
    skin_hi, skin_lo = build_skin(F, 25000 if not fast else 16000, workdir)
    pairs = build_dressing(F, workdir, fast=fast)
    stony_attribute(skin_hi, [hi for hi, _ in pairs if hi.name.startswith('Slab')])
    skin_bones, skin_W = R.weight_skin(skin_lo, F)
    log('skin weights', len(skin_bones), 'bones')
    lows = [skin_lo] + [lo for _, lo in pairs]
    highs = [skin_hi] + [hi for hi, _ in pairs]
    for lo in lows[1:]:
        bind_low(lo, F, skin_lo, skin_bones, skin_W)
    glow_lows = [o for o in lows if o.get('mat') == 'glow']
    baked_lows = [o for o in lows if o.get('mat') != 'glow']
    stats = {'tris': {}, 'parts': len(lows)}
    for o in lows:
        stats['tris'][o.name] = K.triangles(o)
    log('triangles total', sum(stats['tris'].values()))
    # Material index per kind on the lows (kept through the join for the final split).
    if nobake:
        clay = clay_materials()
        for o in baked_lows:
            o.data.materials.clear()
            o.data.materials.append(clay[o['mat']])
        body_mat = None
        glow_mat = shipping_materials(None, None, None)[1]
    else:
        S.unwrap(baked_lows + glow_lows, scale_fn=uv_boost)
        log('uv done')
        bake_mats = S.bake_materials()
        for h in highs:
            if h.get('mat') == 'glow':
                continue
            h.data.materials.clear()
            h.data.materials.append(bake_mats[h['mat']])
        tex_dir = opt(argv, '--tex')
        if tex_dir:
            os.makedirs(tex_dir, exist_ok=True)
        bake_highs = [h for h in highs if h.get('mat') != 'glow']
        joined = K.duplicate(baked_lows[0], 'BakeLow')
        others = [K.duplicate(o, o.name + '_bk') for o in baked_lows[1:]]
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for o in [joined] + others:
            o.select_set(True)
        bpy.context.view_layer.objects.active = joined
        bpy.ops.object.join()
        res = S.bake_all(bake_highs, joined, size=bake_size, samples=48 if bake_size >= 2048 else 16, out_dir=tex_dir)
        bpy.data.objects.remove(joined, do_unlink=True)
        for h in highs:
            h.hide_render = True
            h.hide_viewport = True
        ao = res['ao'][..., :1]
        albedo = res['albedo'].copy()
        albedo[..., :3] *= (1.0 - 0.6 * (1.0 - ao))
        orm = np.ones_like(albedo)
        orm[..., 0] = 1.0
        orm[..., 1] = res['rough'][..., 0]
        orm[..., 2] = res['metal'][..., 0]
        ship = bake_size // 2 if bake_size >= 4096 else bake_size
        k = bake_size // ship
        a_img = to_numpy_image('BalgathAlbedo', downsample(albedo, k) if k > 1 else albedo)
        n_img = to_numpy_image('BalgathNormal', downsample(res['normal'], k) if k > 1 else res['normal'], 'Non-Color')
        # roughness and metal are broad masks: half the albedo's resolution is plenty
        o_img = to_numpy_image('BalgathORM', downsample(orm, k * 2), 'Non-Color')
        if tex_dir:
            for img, nm in ((a_img, 'albedo'), (n_img, 'normal'), (o_img, 'orm')):
                img.filepath_raw = os.path.join(tex_dir, f'balgath_{nm}_{img.size[0]}.png')
                img.file_format = 'PNG'
                img.save()
            full = to_numpy_image('BalgathAlbedoFull', albedo)
            full.filepath_raw = os.path.join(tex_dir, f'balgath_albedo_{bake_size}.png')
            full.file_format = 'PNG'
            full.save()
        body_mat, glow_mat = shipping_materials(a_img, n_img, o_img)
        for o in baked_lows:
            o.data.materials.clear()
            o.data.materials.append(body_mat)
        log('bake done')
    for h in highs:
        h.hide_render = True
        h.hide_viewport = True
    for o in glow_lows:
        o.data.materials.clear()
        o.data.materials.append(glow_mat)
    # whiten the vertex colours of everything baked (glTF multiplies COLOR_0)
    for o in baked_lows:
        col = o.data.color_attributes.get('Col')
        if col is not None:
            o.data.color_attributes.remove(col)
    # join everything into one skinned mesh
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in lows:
        o.select_set(True)
    bpy.context.view_layer.objects.active = skin_lo
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'Balgath'
    body.data.name = 'Balgath'
    if body.data.color_attributes.get('Col') is not None:
        ca = body.data.color_attributes['Col']
        body.data.color_attributes.active_color = ca
        # the joined baked parts got default colours: make them white
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(body.data)
        lay = bm.loops.layers.float_color.get('Col') or bm.loops.layers.color.get('Col')
        glow_idx = [i for i, m in enumerate(body.data.materials) if m and 'Glow' in m.name]
        for f in bm.faces:
            if f.material_index not in glow_idx:
                for lp in f.loops:
                    lp[lay] = (1, 1, 1, 1)
        bm.to_mesh(body.data)
        bm.free()
    arm = R.build_armature()
    body.parent = arm
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    bones_used = {g.name for g in body.vertex_groups}
    missing = bones_used - {b.name for b in arm.data.bones}
    if missing:
        raise RuntimeError(f'groups with no bone: {missing}')
    stats['tris_total'] = K.triangles(body)
    stats['bones'] = len(arm.data.bones)
    log('body', stats['tris_total'], 'tris,', stats['bones'], 'bones')
    import clips as C
    only = opt(argv, '--clips')
    names = C.make_clips(arm, only.split(',') if only else None)
    log('clips', len(names))
    # measurements the VISUALS row needs
    R.set_action(arm, bpy.data.actions['Idle'])
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    co = np.array([(ev.matrix_world @ v.co)[:] for v in ev.data.vertices])
    stats['idle_height'] = float(co[:, 2].max() - co[:, 2].min())
    stats['idle_minz'] = float(co[:, 2].min())
    stats['clips'] = {n: round(float(bpy.data.actions[n].get('duration', 0)), 3) for n in names}
    log('IDLE_HEIGHT', round(stats['idle_height'], 3), 'MINZ', round(stats['idle_minz'], 3))
    if out != '-':
        export(out, arm)
        stats['glb_bytes'] = os.path.getsize(out)
    if opt(argv, '--stats'):
        with open(opt(argv, '--stats'), 'w') as f:
            json.dump(stats, f, indent=1)
    if opt(argv, '--blend'):
        R.set_action(arm, bpy.data.actions['Idle'])
        bpy.ops.wm.save_as_mainfile(filepath=opt(argv, '--blend'))
        log('saved blend')
    if opt(argv, '--form'):
        import form
        form.build_form(body, arm, opt(argv, '--form'))
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
        export_anim_slide_to_zero=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_image_format='JPEG', export_jpeg_quality=86,
    )
    log('WROTE', path, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
