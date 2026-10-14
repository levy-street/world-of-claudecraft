# The LOD twin of a town building (exec'd by bl_town.py after bl_town_lib.py,
# same globals). SPACEY, 2026-09-26: "create low poly low qul 80% less polygons
# versions for 300yd and beyond insure the buildings all look the same at
# that far distance ... cook them neatly in blender", then "300 imposters and
# then 500yd dont even render the bulding at all" and "dont render any of the
# extra indoors or bonus assets at that 300yds".
#
# The twin is the building's OUTSIDE as a few hundred clean faces: while a
# building is built, its walls, roofs, drums, cones, columns and big blocks
# each record a coarse envelope of themselves (ENV, bl_town_lib env_*). Here
# that envelope becomes one mesh with its own UVs, and the full building is
# baked onto it with Cycles (selected -> active: each texel takes whatever the
# detailed exterior shows within 0.4 yd of it) as TWO maps: the albedo exactly
# as the game draws it (tiling map x vertex tint, then the smart layer's grime,
# worn edges, painted occlusion and moss from the building's own mask, the
# same formula as src/render/assets/town_smart_material.ts) and the emission
# (lit windows, lanterns). One material, one draw. Interiors, furniture,
# kit props, stalls, awnings and window-box plants are never baked in.
import math

import bmesh
import bpy
from mathutils import Vector

LOD_EXTRUDE = 0.4          # how far outside the envelope a bake ray starts
LOD_REACH = 0.9            # ... and how far it may travel inward
LOD_MISS = (0.32, 0.3, 0.28)


def env_object(tag):
    """The recorded envelope as one mesh object (flat faces, degenerates gone)."""
    bm = bmesh.new()
    for pts in ENV:
        vs = [bm.verts.new(Vector(p)) for p in pts]
        try:
            bm.faces.new(vs)
        except ValueError:
            pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges[:])
    for f in list(bm.faces):
        if f.calc_area() < 1e-4:
            bm.faces.remove(f)
    bm.normal_update()
    me = bpy.data.meshes.new(f'{tag}_lod')
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(f'{tag}__lod', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _src_nodes(m):
    """(base colour image, emission image, bsdf, mask image) of a town material."""
    base = emi = mask = None
    bsdf = None
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                bsdf = n
            elif n.type == 'TEX_IMAGE' and n.image is not None:
                nm = n.image.name
                if nm.startswith('mask_'):
                    mask = n.image
                elif 'Emissive' in nm:
                    emi = n.image
                elif 'Normal' in nm or 'ORM' in nm:
                    continue
                elif base is None:
                    base = n.image
    return base, emi, bsdf, mask


def _bake_variant(m, kind):
    """An emission-only stand-in for `m` whose colour is its game albedo
    (kind 'albedo') or its game emission (kind 'emit')."""
    v = bpy.data.materials.new(f'{m.name}~{kind}')
    v.use_nodes = True
    nt = v.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    L.new(em.outputs['Emission'], out.inputs['Surface'])
    base_img, emi_img, bsdf, mask_img = _src_nodes(m)

    def uvmap(name):
        u = nt.nodes.new('ShaderNodeUVMap')
        u.uv_map = name
        return u.outputs['UV']

    def tex(img, uv='UVMap'):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        L.new(uvmap(uv), t.inputs['Vector'])
        return t.outputs['Color']

    def vmath(op, a, b=None, scale=None):
        n = nt.nodes.new('ShaderNodeVectorMath')
        n.operation = op
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (tuple, list)):
                n.inputs[i].default_value = x
            else:
                L.new(x, n.inputs[i])
        if scale is not None:
            n.inputs['Scale'].default_value = scale
        return n.outputs['Vector'] if op != 'DOT_PRODUCT' else n.outputs['Value']

    def fmath(op, a, b=None, clamp=False):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                L.new(x, n.inputs[i])
        return n.outputs[0]

    def mix(a, b, fac):
        n = nt.nodes.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = 'MIX'
        if isinstance(fac, (int, float)):
            n.inputs['Factor'].default_value = fac
        else:
            L.new(fac, n.inputs['Factor'])
        for sock, x in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(x, (tuple, list)):
                sock.default_value = (x[0], x[1], x[2], 1.0)
            else:
                L.new(x, sock)
        return n.outputs[2]

    def smooth(e0, e1, x):
        n = nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        n.clamp = True
        n.inputs['From Min'].default_value = e0
        n.inputs['From Max'].default_value = e1
        L.new(x, n.inputs['Value'])
        return n.outputs['Result']

    if kind == 'emit':
        if emi_img is not None:
            col = tex(emi_img)
            strength = bsdf.inputs['Emission Strength'].default_value if bsdf else 1.0
        elif bsdf is not None:
            col = None
            c = bsdf.inputs['Emission Color'].default_value
            strength = bsdf.inputs['Emission Strength'].default_value
            em.inputs['Color'].default_value = (c[0], c[1], c[2], 1.0)
        else:
            col, strength = None, 0.0
        if col is not None:
            L.new(col, em.inputs['Color'])
        em.inputs['Strength'].default_value = strength
        return v
    # albedo: the map (or the flat colour) x the vertex tint
    if base_img is not None:
        col = tex(base_img)
    else:
        rgb = nt.nodes.new('ShaderNodeRGB')
        c = bsdf.inputs['Base Color'].default_value if bsdf else (0.5, 0.5, 0.5, 1.0)
        rgb.outputs['Color'].default_value = (c[0], c[1], c[2], 1.0)
        col = rgb.outputs['Color']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    col = vmath('MULTIPLY', col, vc.outputs['Color'])
    smart = m.get('townSmart') if m else None
    if smart and mask_img is not None:
        s = {k: (list(smart[k]) if hasattr(smart[k], '__len__') else float(smart[k])) for k in smart.keys()}
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        L.new(tex(mask_img, 'UVMask'), sep.inputs['Color'])
        R, G, B = sep.outputs['Red'], sep.outputs['Green'], sep.outputs['Blue']
        lum = vmath('DOT_PRODUCT', col, (0.299, 0.587, 0.114))
        # grime: toward the dirt colour
        dirt = fmath('MULTIPLY', G, s['dirtAmt'], clamp=True)
        dirty = vmath('SCALE', vmath('MULTIPLY', col, tuple(s['dirt'])), scale=2.2)
        col = mix(col, dirty, fmath('MULTIPLY', dirt, 0.85))
        # worn edges: a painted, value-aware highlight
        edge = fmath('MULTIPLY', B, s['edgeAmt'] * 2.0, clamp=True)
        ecol = nt.nodes.new('ShaderNodeVectorMath')
        ecol.operation = 'SCALE'
        ecol.inputs[0].default_value = tuple(s['edge'])
        L.new(fmath('ADD', fmath('MULTIPLY', lum, 0.6), 0.55), ecol.inputs['Scale'])
        col = mix(col, ecol.outputs['Vector'], fmath('MULTIPLY', edge, 0.6))
        # the occlusion painted in
        ao = fmath('ADD', 1.0, fmath('MULTIPLY', fmath('SUBTRACT', fmath('ADD', fmath('MULTIPLY', R, 0.75), 0.25), 1.0),
                                     s['aoDiffuse']))
        col = vmath('MULTIPLY', col, _vec3(nt, L, ao))
        # moss on up-facing grime
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        nz = nt.nodes.new('ShaderNodeSeparateXYZ')
        L.new(geo.outputs['Normal'], nz.inputs['Vector'])
        moss = fmath('MULTIPLY', fmath('MULTIPLY', smooth(0.25, 0.85, nz.outputs['Z']), smooth(0.5, 0.92, G)),
                     s['mossAmt'] * 1.4, clamp=True)
        mcol = nt.nodes.new('ShaderNodeVectorMath')
        mcol.operation = 'SCALE'
        mcol.inputs[0].default_value = tuple(s['moss'])
        L.new(fmath('ADD', fmath('MULTIPLY', lum, 0.5), 0.7), mcol.inputs['Scale'])
        col = mix(col, mcol.outputs['Vector'], moss)
    L.new(col, em.inputs['Color'])
    return v


def _vec3(nt, L, f):
    c = nt.nodes.new('ShaderNodeCombineXYZ')
    for k in ('X', 'Y', 'Z'):
        L.new(f, c.inputs[k])
    return c.outputs['Vector']


def lod_sources(objs):
    """The detailed exterior the twin is baked from: every hand-built part
    outside the interior groups and the street clutter (ENV_NOT)."""
    out = []
    for o in objs:
        nm = o.name.split('__')[-1].split('.')[0]
        if str(o.get('grp', 'L0')).startswith('INT') or nm in ENV_NOT or len(o.data.polygons) == 0:
            continue
        out.append(o)
    return out


def lod_bake(tag, objs, out_dir=None, samples=4, keep=False):
    """Build, unwrap, bake and (out_dir) export the twin: returns the object."""
    sc = bpy.context.scene
    lod = env_object(tag)
    if len(lod.data.polygons) == 0:
        bpy.data.objects.remove(lod, do_unlink=True)
        return None
    area = sum(p.area for p in lod.data.polygons)
    N = 1024 if area > 900 else 512
    # 1. its own UVs
    for o in bpy.context.scene.objects:
        o.select_set(False)
    lod.select_set(True)
    bpy.context.view_layer.objects.active = lod
    lod.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # 2. the target material: one image node per pass, the active one is baked
    imgs = {}
    for kind, n in (('albedo', N), ('emit', N // 2)):
        im = bpy.data.images.get(f'lod_{kind}_{tag}')
        if im is not None:
            bpy.data.images.remove(im)
        im = bpy.data.images.new(f'lod_{kind}_{tag}', n, n, alpha=False)
        im.generated_color = (*LOD_MISS, 1.0) if kind == 'albedo' else (0.0, 0.0, 0.0, 1.0)
        imgs[kind] = im
    tm = bpy.data.materials.new(f'town_lod_{tag}')
    nt, bsdf = _nodes(tm)
    t_col = nt.nodes.new('ShaderNodeTexImage')
    t_col.image = imgs['albedo']
    t_emi = nt.nodes.new('ShaderNodeTexImage')
    t_emi.image = imgs['emit']
    nt.links.new(t_col.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(t_emi.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    lod.data.materials.append(tm)
    # 3. bake both passes from the detailed exterior
    src = lod_sources(objs)
    saved = {o.name: [sl.material for sl in o.material_slots] for o in src}
    variants = {}
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    bk = sc.render.bake
    # every scene setting this bake touches goes back afterwards: the smart
    # mask bake of the NEXT building reads the scene's defaults (a leaked
    # selected_to_active once baked twelve black masks)
    was = (sc.cycles.samples, bk.use_selected_to_active, bk.cage_extrusion, bk.max_ray_distance, bk.margin)
    sc.cycles.samples = samples
    bk.use_selected_to_active = True
    bk.cage_extrusion = LOD_EXTRUDE
    bk.max_ray_distance = LOD_REACH
    bk.margin = 8
    for kind in ('albedo', 'emit'):
        for o in src:
            for sl, m in zip(o.material_slots, saved[o.name]):
                if m is None:
                    continue
                key = (m.name, kind)
                if key not in variants:
                    variants[key] = _bake_variant(m, kind)
                sl.material = variants[key]
        for n in nt.nodes:
            n.select = False
        node = t_col if kind == 'albedo' else t_emi
        node.select = True
        nt.nodes.active = node
        for o in bpy.context.scene.objects:
            o.select_set(o in src)
        lod.select_set(True)
        bpy.context.view_layer.objects.active = lod
        bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=LOD_EXTRUDE,
                            max_ray_distance=LOD_REACH, margin=8, use_clear=False, target='IMAGE_TEXTURES')
    for o in src:
        for sl, m in zip(o.material_slots, saved[o.name]):
            sl.material = m
    for v in variants.values():
        bpy.data.materials.remove(v)
    (sc.cycles.samples, bk.use_selected_to_active, bk.cage_extrusion, bk.max_ray_distance, bk.margin) = was
    for im in imgs.values():
        im.pack()
    lod['grp'] = 'L0'
    if out_dir:
        for im, fn in ((imgs['albedo'], 'albedo'), (imgs['emit'], 'emit')):
            im.filepath_raw = f'{out_dir}/tidehold_{tag}.lod_{fn}.png'
            im.file_format = 'PNG'
            im.save()
        export_glb([lod], f'{out_dir}/tidehold_{tag}.lod.glb')
        tris = sum(len(p.vertices) - 2 for p in lod.data.polygons)
        LOG.append(f'  lod {tag}: {tris} tris, {N}px, envelope {area:.0f} yd2, {len(src)} sources')
        if not keep:
            bpy.data.objects.remove(lod, do_unlink=True)
            return None
    return lod
