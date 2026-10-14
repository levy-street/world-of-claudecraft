# Deepglass ice: bergs, floes, a glacier face and ice spires for the fjord
# (SPACEY, 2026-09-19: "also make some ice glacia models"). Same budget discipline
# as the trees, chunky faceted forms, flat-shaded, under 1200 triangles each,
# wearing the repository's own painted Snow002 ice.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python \
#       scripts/assets/deepglass/bl_dg_ice.py -- <out_dir> [preview.png]
#   node scripts/assets/deepglass/finish_dg_ice.mjs <out_dir>
#
# Blender Z-up, one unit = one yard, waterline at z = 0 for the floating pieces
# (a berg carries its own draft below, so it reads right half-submerged) and the
# ground at z = 0 for the grounded ones.
import bpy, bmesh, sys, os, math, random, json
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT_DIR = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'tree_tex')

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Ice reads as ICE through its shading, not its albedo: a cool blue body, a
# white crust on everything facing up, and a hard specular. Vertex colour
# carries the crust so one material covers every piece.
ICE_DEEP = (0.42, 0.62, 0.78)
ICE_MID = (0.66, 0.80, 0.90)
ICE_CRUST = (0.97, 0.99, 1.0)


def ice_material():
    mat = bpy.data.materials.new('Ice_dg')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(TEX, 'dg_ice.png'))
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs[6])
    nt.links.new(col.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.22
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


ICE = ice_material()


def facet(obj, rng, amount, cuts=0):
    """Chip a primitive into faceted ice: subdivide, then push every vertex
    along its own direction. Flat-shaded afterwards, so each face catches the
    light on its own, the read that makes low-poly ice look like ice."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        n = v.co.normalized() if v.co.length > 1e-5 else Vector((0, 0, 1))
        v.co += n * rng.uniform(-amount, amount)
        v.co.z += rng.uniform(-amount, amount) * 0.4
    bm.to_mesh(me)
    bm.free()


def paint(obj, waterline=None):
    """Vertex colour: blue at depth, white crust on up-facing surfaces. A
    `waterline` also darkens everything under it, so a floating piece reads as
    one solid berg rather than a lit shape sitting on the water."""
    me = obj.data
    if not me.color_attributes:
        me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    col = me.color_attributes['Color']
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    span = max(1e-4, hi - lo)
    for poly in me.polygons:
        up = max(0.0, poly.normal.z)
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            t = (v.co.z - lo) / span
            base = [ICE_DEEP[i] + (ICE_MID[i] - ICE_DEEP[i]) * t for i in range(3)]
            crust = up ** 1.6 * (0.35 + 0.65 * t)
            c = [base[i] + (ICE_CRUST[i] - base[i]) * crust for i in range(3)]
            if waterline is not None and v.co.z < waterline:
                sink = min(1.0, (waterline - v.co.z) / max(0.6, span * 0.5))
                c = [x * (1 - 0.45 * sink) for x in c]
            col.data[li].color = (c[0], c[1], c[2], 1.0)


def finish(obj, name, rng, waterline=None):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(ICE)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_flat()
    # box-project so the painted ice reads at world scale on every face
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=6.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    paint(obj, waterline)
    return obj


def prim(op, **kw):
    before = set(bpy.data.objects)
    op(**kw)
    return (set(bpy.data.objects) - before).pop()


def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


META = {}


def berg(name, seed, width, height, lumps):
    """A floating berg: a squat mass with a proper draft under the waterline
    and a couple of shoulders, so it reads from a boat and from the shore."""
    rng = random.Random(seed)
    parts = []
    for i in range(lumps):
        a = rng.uniform(0, math.tau)
        r = width * rng.uniform(0.0, 0.34)
        p = prim(bpy.ops.mesh.primitive_ico_sphere_add, subdivisions=2,
                 radius=width * rng.uniform(0.26, 0.44),
                 location=(math.cos(a) * r, math.sin(a) * r,
                           rng.uniform(-height * 0.28, height * 0.22)))
        p.scale = (rng.uniform(0.9, 1.35), rng.uniform(0.9, 1.35), rng.uniform(0.42, 0.72))
        bpy.ops.object.transform_apply(scale=True)
        facet(p, rng, width * 0.05)
        parts.append(p)
    # the draft: a cone hanging below, what makes it float rather than sit
    keel = prim(bpy.ops.mesh.primitive_cone_add, vertices=9, radius1=width * 0.42, radius2=width * 0.1,
                depth=height * 0.9, location=(0, 0, -height * 0.5))
    facet(keel, rng, width * 0.05)
    parts.append(keel)
    obj = join(parts, name)
    m = obj.modifiers.new('rem', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = max(0.28, width * 0.075)
    bpy.ops.object.modifier_apply(modifier='rem')
    d = obj.modifiers.new('dec', 'DECIMATE')
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    d.ratio = min(1.0, 900 / max(1, tris))
    bpy.ops.object.modifier_apply(modifier='dec')
    finish(obj, name, rng, waterline=0.0)
    META[name] = {'kind': 'berg'}
    return obj


def floe(name, seed, width):
    """A flat drift floe: a thin slab with a snow crust, barely proud of the
    water. The reference's fjord is scattered with these."""
    rng = random.Random(seed)
    p = prim(bpy.ops.mesh.primitive_cylinder_add, vertices=11, radius=width * 0.5,
             depth=width * 0.14, location=(0, 0, 0))
    p.scale = (1.0, rng.uniform(0.6, 0.95), 1.0)
    bpy.ops.object.transform_apply(scale=True)
    facet(p, rng, width * 0.045, cuts=1)
    finish(p, name, rng, waterline=-width * 0.02)
    META[name] = {'kind': 'floe'}
    return p


def glacier(name, seed, width, height, depth):
    """A glacier face: a stepped wall of ice to stand at a fjord head, with
    calving fractures down the front. Origin at the foot, front facing -Y."""
    rng = random.Random(seed)
    parts = []
    steps = 4
    for i in range(steps):
        t = i / (steps - 1)
        w = width * (1 - t * 0.22)
        p = prim(bpy.ops.mesh.primitive_cube_add, size=1,
                 location=(rng.uniform(-1, 1) * width * 0.04, depth * 0.5 * t,
                           height * (0.14 + 0.72 * t) * 0.5))
        p.scale = (w, depth * (0.34 + t * 0.4), height * (0.28 + 0.72 * t))
        bpy.ops.object.transform_apply(scale=True)
        facet(p, rng, width * 0.035, cuts=2)
        parts.append(p)
    # calving fractures: thin wedges standing off the face
    for i in range(7):
        x = rng.uniform(-0.45, 0.45) * width
        h = height * rng.uniform(0.35, 0.85)
        p = prim(bpy.ops.mesh.primitive_cone_add, vertices=5, radius1=width * rng.uniform(0.05, 0.1),
                 radius2=width * 0.02, depth=h, location=(x, -depth * 0.12, h * 0.5))
        p.rotation_euler = (rng.uniform(-0.12, 0.12), 0, rng.uniform(0, 3.14))
        facet(p, rng, width * 0.02)
        parts.append(p)
    obj = join(parts, name)
    d = obj.modifiers.new('dec', 'DECIMATE')
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    d.ratio = min(1.0, 1100 / max(1, tris))
    bpy.ops.object.modifier_apply(modifier='dec')
    finish(obj, name, rng)
    META[name] = {'kind': 'glacier'}
    return obj


def spire(name, seed, height, base):
    """A shard of ice driven up out of the ground: the fjord's ice pillars."""
    rng = random.Random(seed)
    parts = []
    for i in range(3):
        a = rng.uniform(0, math.tau)
        r = base * rng.uniform(0, 0.4)
        h = height * rng.uniform(0.55, 1.0)
        p = prim(bpy.ops.mesh.primitive_cone_add, vertices=6, radius1=base * rng.uniform(0.3, 0.5),
                 radius2=base * 0.04, depth=h,
                 location=(math.cos(a) * r, math.sin(a) * r, h * 0.45))
        p.rotation_euler = (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, 3.14))
        facet(p, rng, base * 0.05, cuts=1)
        parts.append(p)
    obj = join(parts, name)
    finish(obj, name, rng)
    META[name] = {'kind': 'spire'}
    return obj


SPECS = [
    lambda: berg('ice_berg_a', 21, 9.0, 6.0, 4),
    lambda: berg('ice_berg_b', 22, 14.0, 9.0, 5),
    lambda: berg('ice_berg_small', 23, 5.0, 3.4, 3),
    lambda: floe('ice_floe_a', 24, 7.0),
    lambda: floe('ice_floe_b', 25, 11.0),
    lambda: glacier('ice_glacier_face', 26, 26.0, 16.0, 14.0),
    lambda: spire('ice_spire_a', 27, 9.0, 2.4),
    lambda: spire('ice_spire_b', 28, 14.0, 3.2),
]

os.makedirs(OUT_DIR, exist_ok=True)
built = []
for spec in SPECS:
    obj = spec()
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    d = obj.dimensions
    META[obj.name].update({'tris': tris, 'dims': [round(d.x, 3), round(d.z, 3), round(d.y, 3)]})
    print('DGICE', obj.name, 'tris', tris, 'dims', round(d.x, 2), round(d.y, 2), round(d.z, 2))
    assert tris < 1400, (obj.name, tris)
    built.append(obj)

for obj in built:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR, obj.name + '.glb'), export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False, export_image_format='WEBP',
                              export_image_quality=88)

json.dump(META, open(os.path.join(OUT_DIR, 'dg_ice.json'), 'w'), indent=1)

if PREVIEW:
    for i, obj in enumerate(built):
        obj.location = ((i % 4) * 22 - 33, (i // 4) * -26, 0)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.2))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('sea')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.16, 0.22, 1)
    g.data.materials.append(gm)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 28
    scene.render.resolution_x = 1700
    scene.render.resolution_y = 850
    cam_d = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_d)
    scene.collection.objects.link(cam)
    cam.location = (0, -74, 26)
    cam_d.lens = 44
    cam.rotation_euler = (Vector((0, -13, 4)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun_d = bpy.data.lights.new('sun', 'SUN')
    sun_d.energy = 3.0
    sun = bpy.data.objects.new('sun', sun_d)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.9, 0.1, 0.7)
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.70, 0.82, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
print('DGICE done')
