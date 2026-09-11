# Deepglass arena asset toolkit, shared helpers.
# exec()'d at the top of each asset script (the bridge runs each call in a
# fresh namespace, so nothing persists between calls).
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Euler

OUT_DIR = "/Users/troy/Documents/woc/deepglass/tmp/asset_src/deepglass"
os.makedirs(OUT_DIR, exist_ok=True)

TAU = math.pi * 2

# --- palette (linear-ish; these are the game's sRGB hexes converted) ---------
def srgb(hexv):
    def c(u):
        u = u / 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return (c((hexv >> 16) & 255), c((hexv >> 8) & 255), c(hexv & 255), 1.0)

STONE      = srgb(0xa8a29a)
STONE_DARK = srgb(0x6e6960)
BRASS      = srgb(0xd6a24e)
BRASS_DARK = srgb(0x8a6529)
RUNE_CYAN  = srgb(0x5fd0e8)
RUNE_WARM  = srgb(0xffb14a)


# --- context ----------------------------------------------------------------
def ctx_override():
    """The addon's execute_code context has no window; every bpy.ops call that
    reads active/selected objects needs this."""
    win = bpy.context.window_manager.windows[0]
    scr = win.screen
    area = next((a for a in scr.areas if a.type == 'VIEW_3D'), scr.areas[0])
    region = next((r for r in area.regions if r.type == 'WINDOW'), area.regions[0])
    return dict(window=win, screen=scr, area=area, region=region)


def activate(objs):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                bpy.data.node_groups, bpy.data.cameras, bpy.data.lights):
        for d in list(blk):
            if d.users == 0:
                blk.remove(d)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    # CPU only: the Metal backend crashes Blender 5.1 inside
    # MetalKernelPipeline::compile while serialising its binary archive.
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = True
    sc.render.threads_mode = 'AUTO'


# --- mesh building ----------------------------------------------------------
def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    for m in mats:
        ob.data.materials.append(m)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def set_face_mat(bm, faces, idx):
    for f in faces:
        f.material_index = idx


def lathe(bm, profile, segs=32, mat=0, close_bottom=True, close_top=True,
          smooth=True, arc=TAU, origin=(0.0, 0.0, 0.0)):
    """Revolve a (r, z) profile around +Z. Returns the created faces."""
    ox, oy, oz = origin
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segs):
            a = arc * i / segs
            ring.append(bm.verts.new((ox + math.cos(a) * r, oy + math.sin(a) * r, oz + z)))
        rings.append(ring)
    faces = []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            if a[i].co.xy.length < 1e-7 and a[j].co.xy.length < 1e-7:
                continue
            if b[i].co.xy.length < 1e-7 and b[j].co.xy.length < 1e-7:
                continue
            try:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mat
                f.smooth = smooth
                faces.append(f)
            except ValueError:
                pass
    if close_bottom and profile[0][0] > 1e-6:
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = mat
        faces.append(f)
    if close_top and profile[-1][0] > 1e-6:
        f = bm.faces.new(rings[-1])
        f.material_index = mat
        faces.append(f)
    bm.verts.index_update()
    return faces


def tube_along(bm, pts, radius, segs=8, mat=0, smooth=True, caps=True,
               up=Vector((0, 0, 1)), radii=None):
    """Sweep a circular tube along a polyline of Vectors."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == n - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        ref = up if abs(t.dot(up)) < 0.94 else Vector((1, 0, 0))
        nx = (ref - t * ref.dot(t))
        if nx.length < 1e-6:
            nx = Vector((1, 0, 0))
        nx.normalize()
        if prev_n is not None:
            # minimise twist: project the previous frame forward
            proj = (prev_n - t * prev_n.dot(t))
            if proj.length > 1e-6:
                nx = proj.normalized()
        prev_n = nx
        ny = t.cross(nx).normalized()
        r = radius if radii is None else radii[i]
        ring = []
        for k in range(segs):
            a = TAU * k / segs
            ring.append(bm.verts.new(p + nx * (math.cos(a) * r) + ny * (math.sin(a) * r)))
        rings.append(ring)
    faces = []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mat
            f.smooth = smooth
            faces.append(f)
    if caps:
        f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mat; faces.append(f)
        f = bm.faces.new(rings[-1]); f.material_index = mat; faces.append(f)
    bm.verts.index_update()
    return faces


def torus(bm, R, r, major=48, minor=10, mat=0, center=(0, 0, 0), axis='Z', arc=TAU):
    cx, cy, cz = center
    rings = []
    steps = major if abs(arc - TAU) < 1e-6 else major + 1
    for i in range(steps):
        a = arc * i / major
        if axis == 'Z':
            c = Vector((math.cos(a), math.sin(a), 0))
            up = Vector((0, 0, 1))
        elif axis == 'X':
            c = Vector((0, math.cos(a), math.sin(a)))
            up = Vector((1, 0, 0))
        else:
            c = Vector((math.cos(a), 0, math.sin(a)))
            up = Vector((0, 1, 0))
        ring = []
        for k in range(minor):
            b = TAU * k / minor
            p = Vector((cx, cy, cz)) + c * (R + math.cos(b) * r) + up * (math.sin(b) * r)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    faces = []
    wrap = abs(arc - TAU) < 1e-6
    for i in range(len(rings) - (0 if wrap else 1)):
        a = rings[i]; b = rings[(i + 1) % len(rings)]
        for k in range(minor):
            j = (k + 1) % minor
            f = bm.faces.new((a[k], a[j], b[j], b[k]))
            f.material_index = mat
            f.smooth = True
            faces.append(f)
    bm.verts.index_update()
    return faces


def box(bm, size, center=(0, 0, 0), mat=0, rot=None):
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    pts = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
           (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    M = rot if rot is not None else Matrix.Identity(3)
    C = Vector(center)
    vs = [bm.verts.new(C + M @ Vector(p)) for p in pts]
    idx = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    faces = []
    for q in idx:
        f = bm.faces.new([vs[i] for i in q])
        f.material_index = mat
        f.smooth = False
        faces.append(f)
    bm.verts.index_update()
    return faces


def bevel_obj(ob, width=0.02, segments=2, angle_deg=35):
    m = ob.modifiers.new("bev", 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle_deg)
    m.harden_normals = False
    with bpy.context.temp_override(**ctx_override()):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_auto_smooth(ob, angle=40):
    for p in ob.data.polygons:
        p.use_smooth = True
    mod = ob.modifiers.new("smoothbyangle", 'SMOOTH_BY_ANGLE') if 'SMOOTH_BY_ANGLE' in \
        [i.identifier for i in bpy.types.Modifier.bl_rna.properties['type'].enum_items] else None
    if mod:
        mod.angle = math.radians(angle)


# --- materials --------------------------------------------------------------
def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    out.location = (600, 0)
    bsdf.location = (300, 0)
    return nt, bsdf


def mat_stone(name, base=STONE, dark=STONE_DARK, scale=6.0, rough=(0.62, 0.92), bump=0.28):
    """Carved stone: large-scale mottle + voronoi chip grain + fine bump."""
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)

    n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.location = (-1150, 200)
    n1.inputs['Scale'].default_value = scale * 0.5
    n1.inputs['Detail'].default_value = 6.0
    n1.inputs['Roughness'].default_value = 0.55
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector'])

    v1 = nt.nodes.new('ShaderNodeTexVoronoi'); v1.location = (-1150, -100)
    v1.feature = 'F1'; v1.distance = 'EUCLIDEAN'
    v1.inputs['Scale'].default_value = scale * 2.4
    v1.inputs['Randomness'].default_value = 0.9
    nt.links.new(tc.outputs['Object'], v1.inputs['Vector'])

    n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.location = (-1150, -400)
    n2.inputs['Scale'].default_value = scale * 14.0
    n2.inputs['Detail'].default_value = 8.0
    nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])

    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-900, 200)
    ramp.color_ramp.interpolation = 'B_SPLINE'
    ramp.color_ramp.elements[0].position = 0.34
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].position = 0.66
    ramp.color_ramp.elements[1].color = base
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])

    # voronoi cell tint: subtle per-block colour variation, like set stone
    cellmix = nt.nodes.new('ShaderNodeMixRGB'); cellmix.location = (-620, 120)
    cellmix.blend_type = 'MULTIPLY'
    cellmix.inputs['Fac'].default_value = 0.30
    nt.links.new(ramp.outputs['Color'], cellmix.inputs['Color1'])
    cellramp = nt.nodes.new('ShaderNodeValToRGB'); cellramp.location = (-900, -100)
    cellramp.color_ramp.elements[0].position = 0.0
    cellramp.color_ramp.elements[0].color = (0.72, 0.72, 0.72, 1)
    cellramp.color_ramp.elements[1].position = 1.0
    cellramp.color_ramp.elements[1].color = (1.25, 1.25, 1.25, 1)
    nt.links.new(v1.outputs['Distance'], cellramp.inputs['Fac'])
    nt.links.new(cellramp.outputs['Color'], cellmix.inputs['Color2'])
    nt.links.new(cellmix.outputs['Color'], bsdf.inputs['Base Color'])

    rr = nt.nodes.new('ShaderNodeMapRange'); rr.location = (-620, -260)
    rr.inputs['To Min'].default_value = rough[0]
    rr.inputs['To Max'].default_value = rough[1]
    nt.links.new(n2.outputs['Fac'], rr.inputs['Value'])
    nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.0

    bmp = nt.nodes.new('ShaderNodeBump'); bmp.location = (0, -300)
    bmp.inputs['Strength'].default_value = bump
    bmp.inputs['Distance'].default_value = 0.06
    bmix = nt.nodes.new('ShaderNodeMixRGB'); bmix.location = (-330, -420)
    bmix.blend_type = 'MIX'; bmix.inputs['Fac'].default_value = 0.45
    nt.links.new(v1.outputs['Distance'], bmix.inputs['Color1'])
    nt.links.new(n2.outputs['Fac'], bmix.inputs['Color2'])
    nt.links.new(bmix.outputs['Color'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def mat_brass(name, base=BRASS, dark=BRASS_DARK, scale=9.0, rough_lo=0.22, rough_hi=0.55,
              patina=0.35, bump=0.16, metallic=0.82):
    """Cast brass: polished high points, verdigris settling in the low ones."""
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-1400, 0)

    grime = nt.nodes.new('ShaderNodeTexNoise'); grime.location = (-1150, 150)
    grime.inputs['Scale'].default_value = scale
    grime.inputs['Detail'].default_value = 7.0
    grime.inputs['Roughness'].default_value = 0.6
    nt.links.new(tc.outputs['Object'], grime.inputs['Vector'])

    fine = nt.nodes.new('ShaderNodeTexNoise'); fine.location = (-1150, -200)
    fine.inputs['Scale'].default_value = scale * 22.0
    fine.inputs['Detail'].default_value = 4.0
    nt.links.new(tc.outputs['Object'], fine.inputs['Vector'])

    wave = nt.nodes.new('ShaderNodeTexWave'); wave.location = (-1150, -480)
    wave.wave_type = 'RINGS'
    wave.inputs['Scale'].default_value = scale * 1.4
    wave.inputs['Distortion'].default_value = 3.0
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])

    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-850, 150)
    ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position = 0.30
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].position = 0.70
    ramp.color_ramp.elements[1].color = base
    nt.links.new(grime.outputs['Fac'], ramp.inputs['Fac'])

    verd = nt.nodes.new('ShaderNodeMixRGB'); verd.location = (-560, 150)
    verd.blend_type = 'MIX'
    verd.inputs['Color2'].default_value = srgb(0x3f7a63)
    nt.links.new(ramp.outputs['Color'], verd.inputs['Color1'])
    vfac = nt.nodes.new('ShaderNodeMapRange'); vfac.location = (-850, -80)
    vfac.inputs['From Min'].default_value = 0.45
    vfac.inputs['From Max'].default_value = 0.95
    vfac.inputs['To Min'].default_value = 0.0
    vfac.inputs['To Max'].default_value = patina
    vfac.clamp = True
    nt.links.new(grime.outputs['Fac'], vfac.inputs['Value'])
    nt.links.new(vfac.outputs['Result'], verd.inputs['Fac'])
    nt.links.new(verd.outputs['Color'], bsdf.inputs['Base Color'])

    rr = nt.nodes.new('ShaderNodeMapRange'); rr.location = (-560, -220)
    rr.inputs['To Min'].default_value = rough_lo
    rr.inputs['To Max'].default_value = rough_hi
    rmix = nt.nodes.new('ShaderNodeMixRGB'); rmix.location = (-800, -300)
    rmix.blend_type = 'MIX'; rmix.inputs['Fac'].default_value = 0.5
    nt.links.new(grime.outputs['Fac'], rmix.inputs['Color1'])
    nt.links.new(fine.outputs['Fac'], rmix.inputs['Color2'])
    nt.links.new(rmix.outputs['Color'], rr.inputs['Value'])
    nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    # Not a full 1.0: the game lights this with a sky PMREM that goes dim at
    # night, and a pure metal with nothing to reflect renders as a black hole.
    bsdf.inputs['Metallic'].default_value = metallic

    bmp = nt.nodes.new('ShaderNodeBump'); bmp.location = (0, -320)
    bmp.inputs['Strength'].default_value = bump
    bmp.inputs['Distance'].default_value = 0.04
    bmix = nt.nodes.new('ShaderNodeMixRGB'); bmix.location = (-330, -460)
    bmix.blend_type = 'ADD'; bmix.inputs['Fac'].default_value = 0.35
    nt.links.new(fine.outputs['Fac'], bmix.inputs['Color1'])
    nt.links.new(wave.outputs['Fac'], bmix.inputs['Color2'])
    nt.links.new(bmix.outputs['Color'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def mat_rune(name, color=RUNE_CYAN, strength=3.0):
    """Glowing arcane inlay. Dark base so an unlit engine still reads a channel."""
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    tc = nt.nodes.new('ShaderNodeTexCoord'); tc.location = (-900, 0)
    n = nt.nodes.new('ShaderNodeTexNoise'); n.location = (-700, -150)
    n.inputs['Scale'].default_value = 30.0
    n.inputs['Detail'].default_value = 4.0
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-450, -150)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    mul = nt.nodes.new('ShaderNodeMixRGB'); mul.location = (-200, 0)
    mul.blend_type = 'MULTIPLY'; mul.inputs['Fac'].default_value = 1.0
    mul.inputs['Color1'].default_value = color
    nt.links.new(ramp.outputs['Color'], mul.inputs['Color2'])
    nt.links.new(mul.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = strength
    bsdf.inputs['Base Color'].default_value = (color[0] * 0.25, color[1] * 0.25, color[2] * 0.25, 1)
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


# --- UV + bake --------------------------------------------------------------
def uv_project(objs, angle=66, island_margin=0.006):
    with bpy.context.temp_override(**ctx_override()):
        activate(objs)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle),
                                 island_margin=island_margin,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')


def _img(name, size, is_data=False, fill=(0, 0, 0, 1)):
    im = bpy.data.images.get(name)
    if im:
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False,
                             is_data=is_data)
    im.generated_color = fill
    return im


def _target_nodes(objs, image):
    """Point every material of every object at `image` as the active bake target."""
    made = []
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            n = m.node_tree.nodes.get('BAKE_TARGET')
            if n is None:
                n = m.node_tree.nodes.new('ShaderNodeTexImage')
                n.name = 'BAKE_TARGET'
                n.location = (900, 400)
            n.image = image
            n.select = True
            m.node_tree.nodes.active = n
            made.append((m, n))
    return made


def _clear_targets(made):
    for m, n in made:
        try:
            m.node_tree.nodes.remove(n)
        except Exception:
            pass


def bake_pass(objs, image, bake_type, samples=24, **kw):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = 12
    sc.render.bake.use_clear = True
    made = _target_nodes(objs, image)
    try:
        with bpy.context.temp_override(**ctx_override()):
            activate(objs)
            if bake_type == 'DIFFUSE':
                sc.render.bake.use_pass_direct = False
                sc.render.bake.use_pass_indirect = False
                sc.render.bake.use_pass_color = True
            bpy.ops.object.bake(type=bake_type, **kw)
    finally:
        _clear_targets(made)


def bake_value(objs, image, get_socket, samples=8):
    """Bake an arbitrary Principled scalar input by routing it through Emission."""
    stash = []
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
            if not bsdf or not out:
                continue
            sock = get_socket(bsdf)
            em = nt.nodes.new('ShaderNodeEmission')
            em.location = (300, 400)
            em.inputs['Strength'].default_value = 1.0
            if sock.is_linked:
                nt.links.new(sock.links[0].from_socket, em.inputs['Color'])
            else:
                v = sock.default_value
                if hasattr(v, '__len__'):
                    em.inputs['Color'].default_value = (v[0], v[1], v[2], 1)
                else:
                    em.inputs['Color'].default_value = (v, v, v, 1)
            prev = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            stash.append((nt, em, out, prev))
    try:
        bake_pass(objs, image, 'EMIT', samples=samples)
    finally:
        for nt, em, out, prev in stash:
            try:
                nt.nodes.remove(em)
                if prev:
                    nt.links.new(prev, out.inputs['Surface'])
            except Exception:
                pass


def save_img(im, path, colorspace=None):
    # NEVER assign colorspace_settings here: on a GENERATED image that
    # re-runs the generator and silently throws the bake away (black PNGs).
    # The colour space is fixed at creation via _img(is_data=...).
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    return path


def multiply_ao(color_img, ao_img, amount=0.75):
    """Fold the AO bake into the base colour (the engine reads no occlusion map)."""
    import numpy as np
    n = color_img.size[0] * color_img.size[1] * 4
    c = np.empty(n, dtype=np.float32); color_img.pixels.foreach_get(c)
    a = np.empty(n, dtype=np.float32); ao_img.pixels.foreach_get(a)
    ao = a.reshape(-1, 4)[:, 0]
    ao = 1.0 - (1.0 - ao) * amount
    c = c.reshape(-1, 4)
    c[:, 0:3] *= ao[:, None]
    color_img.pixels.foreach_set(c.reshape(-1))
    color_img.update()


def bake_asset(objs, tag, size=1024, samples=24, ao_amount=0.7):
    """Full PBR bake of `objs` into one texture set. Returns a dict of file paths."""
    base = _img(tag + "_base", size)
    rough = _img(tag + "_rough", size, is_data=True)
    metal = _img(tag + "_metal", size, is_data=True)
    emis = _img(tag + "_emis", size)
    norm = _img(tag + "_norm", size, is_data=True, fill=(0.5, 0.5, 1.0, 1))
    ao = _img(tag + "_ao", size, is_data=True, fill=(1, 1, 1, 1))

    # Base colour goes through EMIT, NOT the DIFFUSE pass. A metal has no
    # diffuse albedo, so a DIFFUSE bake writes every brass texel near-black and
    # the asset ships looking like cast iron. Routing the Base Color socket
    # through an Emission shader reads the true albedo at any metalness.
    bake_value(objs, base, lambda b: b.inputs['Base Color'], samples=max(4, samples // 3))
    bake_pass(objs, ao, 'AO', samples=max(samples, 48))
    bake_pass(objs, rough, 'ROUGHNESS', samples=8)
    bake_pass(objs, norm, 'NORMAL', samples=8)
    bake_value(objs, metal, lambda b: b.inputs['Metallic'], samples=4)

    # Emission: colour * strength, routed through Emission so bake EMIT sees it.
    bake_pass(objs, emis, 'EMIT', samples=8)

    if ao_amount > 0:
        multiply_ao(base, ao, ao_amount)

    paths = {
        'base': save_img(base, f"{OUT_DIR}/{tag}_base.png", 'sRGB'),
        'rough': save_img(rough, f"{OUT_DIR}/{tag}_rough.png", 'Non-Color'),
        'metal': save_img(metal, f"{OUT_DIR}/{tag}_metal.png", 'Non-Color'),
        'emis': save_img(emis, f"{OUT_DIR}/{tag}_emis.png", 'sRGB'),
        'norm': save_img(norm, f"{OUT_DIR}/{tag}_norm.png", 'Non-Color'),
    }
    return paths, dict(base=base, rough=rough, metal=metal, emis=emis, norm=norm)


def baked_material(tag, imgs, emissive_strength=1.0):
    """Collapse an asset to ONE Principled material fed by the baked maps,     exactly what the glTF exporter wants."""
    mat = bpy.data.materials.new(tag + "_baked")
    nt, bsdf = _nodes(mat)

    def tex(img, cs, loc):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.location = loc
        return n

    tb = tex(imgs['base'], 'sRGB', (-600, 300))
    tr = tex(imgs['rough'], 'Non-Color', (-600, 0))
    tm = tex(imgs['metal'], 'Non-Color', (-600, -260))
    te = tex(imgs['emis'], 'sRGB', (-600, -520))
    tn = tex(imgs['norm'], 'Non-Color', (-600, -780))
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.location = (-300, -780)
    nt.links.new(tn.outputs['Color'], nmap.inputs['Color'])

    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(tm.outputs['Color'], bsdf.inputs['Metallic'])
    nt.links.new(te.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = emissive_strength
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def apply_baked(objs, mat):
    for ob in objs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.material_index = 0


# --- export -----------------------------------------------------------------
def export_glb(objs, path):
    with bpy.context.temp_override(**ctx_override()):
        activate(objs)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT',
            export_image_format='WEBP',
            export_image_quality=92,
            export_animations=False,
            export_extras=True,
        )
    return path


# --- offscreen preview render ----------------------------------------------
def render_preview(path, cam_pos, target, size=(900, 700), fov=42.0, shading='RENDERED'):
    """draw_view3d into an offscreen buffer, the only reliable shot path when
    the Blender window is not composited."""
    import gpu
    from gpu_extras.presets import draw_texture_2d
    win = bpy.context.window_manager.windows[0]
    scr = win.screen
    area = next((a for a in scr.areas if a.type == 'VIEW_3D'), None)
    if area is None:
        return "no VIEW_3D area"
    space = area.spaces.active
    region = next((r for r in area.regions if r.type == 'WINDOW'), None)
    # 'RENDERED' under Cycles kicks off an async viewport render that has not
    # produced a pixel by the time draw_view3d returns, EEVEE draws inline.
    prev_engine = bpy.context.scene.render.engine
    if shading == 'RENDERED':
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    space.shading.type = shading
    space.shading.use_scene_lights = True
    space.shading.use_scene_world = True
    space.overlay.show_overlays = False

    w, h = size
    eye = Vector(cam_pos); tgt = Vector(target)
    fwd = (tgt - eye).normalized()
    up_hint = Vector((0, 0, 1))
    if abs(fwd.dot(up_hint)) > 0.98:
        up_hint = Vector((0, 1, 0))
    right = fwd.cross(up_hint).normalized()
    up = right.cross(fwd).normalized()
    cam_m = Matrix((
        (right.x, up.x, -fwd.x, eye.x),
        (right.y, up.y, -fwd.y, eye.y),
        (right.z, up.z, -fwd.z, eye.z),
        (0, 0, 0, 1),
    ))
    view = cam_m.inverted()
    aspect = w / h
    near, far = 0.1, 2000.0
    f = 1.0 / math.tan(math.radians(fov) / 2.0)
    proj = Matrix((
        (f / aspect, 0, 0, 0),
        (0, f, 0, 0),
        (0, 0, (far + near) / (near - far), (2 * far * near) / (near - far)),
        (0, 0, -1, 0),
    ))

    bpy.context.view_layer.update()
    bpy.context.evaluated_depsgraph_get()

    off = gpu.types.GPUOffScreen(w, h)
    try:
        off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, region,
                        view, proj, do_color_management=True)
        with off.bind():
            fb = gpu.state.active_framebuffer_get()
            buf = fb.read_color(0, 0, w, h, 4, 0, 'FLOAT')
        buf.dimensions = w * h * 4
        im = bpy.data.images.get('__preview')
        if im:
            bpy.data.images.remove(im)
        im = bpy.data.images.new('__preview', w, h)
        im.pixels.foreach_set([v for v in buf])
        im.filepath_raw = path
        im.file_format = 'PNG'
        im.save()
    finally:
        off.free()
        bpy.context.scene.render.engine = prev_engine
    return path


def studio_lights():
    """Three-point rig so RENDERED previews and the AO bake both look sane."""
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("W")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        # Bright enough that metals have something to reflect, otherwise every
        # brass part previews as a black silhouette and cannot be judged.
        bg.inputs['Color'].default_value = (0.16, 0.26, 0.33, 1)
        bg.inputs['Strength'].default_value = 1.0
    specs = [((14, -18, 16), 2600, 0.55), ((-20, -8, 8), 900, 0.9), ((4, 20, 14), 1400, 0.7)]
    for i, (p, e, r) in enumerate(specs):
        ld = bpy.data.lights.new(f"key{i}", 'AREA')
        ld.energy = e
        ld.size = r * 14
        ob = bpy.data.objects.new(f"key{i}", ld)
        ob.location = p
        d = Vector((0, 0, 0)) - Vector(p)
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(ob)


print("dg_lib loaded")
