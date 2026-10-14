# Warden Colossus: the giant cliff statue beside the Deepglass fjord falls
# (SPACEY, 2026-09-18: "an epic waterfall with some giant statues sticking out of
# the high up mountain, look at howling fjord"). A hooded Warden resting both
# hands on a greatsword, built from primitives + a skin-modifier body, fused by
# a voxel remesh, weathered, decimated and box-mapped with the kit's grey stone.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python \
#       scripts/assets/deepglass/bl_warden_colossus.py -- <out.glb> <stone.jpg> [preview.png]
#
# Blender Z-up, figure 10 units tall, facing -Y (= +Z in the GLB after export).
import bpy, bmesh, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, STONE = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
parts = []

def add(obj):
    parts.append(obj)
    return obj

def prim(op, **kw):
    before = set(bpy.data.objects)
    op(**kw)
    return add((set(bpy.data.objects) - before).pop())

# --- plinth + back slab (the slab is what buries into the cliff) -------------
p = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, -0.3, 0.3)); p.scale = (5.2, 4.8, 0.6)
p = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, -0.2, 0.75)); p.scale = (4.5, 4.0, 0.35)
s = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, 1.75, 4.2)); s.scale = (4.2, 1.5, 8.2)

# --- robe: a lathe-like cone stack, flattened front to back ------------------
robe = prim(bpy.ops.mesh.primitive_cone_add, vertices=28, radius1=2.0, radius2=1.05, depth=4.6, location=(0, 0, 3.2))
robe.scale = (1.12, 0.9, 1.0)
# robe folds: a ring of thin vertical wedges
for i in range(11):
    a = -math.pi * 0.05 + i * (math.pi * 1.1 / 10) + math.pi
    r = 1.62
    f = prim(bpy.ops.mesh.primitive_cone_add, vertices=6, radius1=0.26, radius2=0.1, depth=4.2,
             location=(math.cos(a) * r * 1.0, math.sin(a) * r * 0.8, 3.0))
    f.rotation_euler = (math.sin(a) * 0.17, -math.cos(a) * 0.17, a)

# --- body: skin-modifier skeleton -------------------------------------------
verts = [
    ((0, 0, 4.9), 1.25), ((0, 0, 6.0), 1.35), ((0, 0, 7.0), 1.55), ((0, 0, 7.9), 0.6), ((0, 0.05, 8.55), 0.7),
    ((1.7, 0, 7.3), 0.72), ((2.0, -0.6, 6.0), 0.56), ((1.15, -1.45, 5.5), 0.46), ((0.3, -1.62, 5.6), 0.42),
    ((-1.7, 0, 7.3), 0.72), ((-2.0, -0.6, 6.0), 0.56), ((-1.15, -1.45, 5.5), 0.46), ((-0.3, -1.62, 5.9), 0.42),
]
edges = [(0, 1), (1, 2), (2, 3), (3, 4), (2, 5), (5, 6), (6, 7), (7, 8), (2, 9), (9, 10), (10, 11), (11, 12)]
me = bpy.data.meshes.new('body')
me.from_pydata([v for v, _ in verts], edges, [])
body = bpy.data.objects.new('body', me)
scene.collection.objects.link(body)
add(body)
mod = body.modifiers.new('skin', 'SKIN')
for i, (_, r) in enumerate(verts):
    sv = me.skin_vertices[0].data[i]
    sv.radius = (r, r * 0.85)
me.skin_vertices[0].data[0].use_root = True
sub = body.modifiers.new('sub', 'SUBSURF'); sub.levels = 2

# --- pauldrons, hood, cowl ---------------------------------------------------
for sx in (1, -1):
    pa = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=20, ring_count=12, radius=0.92, location=(sx * 1.78, 0.0, 7.5))
    pa.scale = (1.0, 1.0, 0.9)
    # a layered plate under each pauldron
    pl = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=16, ring_count=10, radius=0.8, location=(sx * 2.0, -0.1, 6.95))
    pl.scale = (0.9, 1.0, 0.7)
hood = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=24, ring_count=16, radius=1.0, location=(0, 0.12, 8.62))
hood.scale = (0.98, 1.08, 1.12)
peak = prim(bpy.ops.mesh.primitive_cone_add, vertices=16, radius1=0.78, radius2=0.05, depth=1.3, location=(0, 0.42, 9.5))
peak.rotation_euler = (0.55, 0, 0)
cowl = prim(bpy.ops.mesh.primitive_cone_add, vertices=24, radius1=1.75, radius2=0.72, depth=1.5, location=(0, 0.1, 7.75))
cowl.scale = (1.0, 0.9, 1.0)
# the face void: a sphere subtracted from the hood front after the fuse
void = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=20, ring_count=12, radius=0.66, location=(0, -0.62, 8.5))
void.scale = (0.8, 0.9, 1.05)
parts.remove(void)

# --- greatsword --------------------------------------------------------------
SY = -1.78
b = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, SY, 3.0)); b.scale = (0.78, 0.26, 4.5)
fu = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, SY - 0.1, 3.0)); fu.scale = (0.22, 0.2, 4.2)
t = prim(bpy.ops.mesh.primitive_cone_add, vertices=4, radius1=0.56, radius2=0.0, depth=0.95, location=(0, SY, 0.95))
t.rotation_euler = (math.pi, 0, math.pi / 4); t.scale = (1.0, 0.46, 1.0)
g = prim(bpy.ops.mesh.primitive_cube_add, size=1, location=(0, SY, 5.35)); g.scale = (3.0, 0.42, 0.4)
for sx in (1, -1):
    e = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=12, ring_count=8, radius=0.34, location=(sx * 1.55, SY, 5.35))
h = prim(bpy.ops.mesh.primitive_cylinder_add, vertices=12, radius=0.2, depth=1.3, location=(0, SY, 6.1))
pm = prim(bpy.ops.mesh.primitive_uv_sphere_add, segments=12, ring_count=8, radius=0.38, location=(0, SY, 6.9))

# --- fuse ---------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join()
statue = bpy.context.view_layer.objects.active
statue.name = 'WardenColossus'
rm = statue.modifiers.new('remesh', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.075; rm.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier='remesh')
bo = statue.modifiers.new('face', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = void; bo.solver = 'EXACT'
bpy.ops.object.modifier_apply(modifier='face')
bpy.data.objects.remove(void, do_unlink=True)
# weathering: broad erosion + fine pitting
for name, scale, strength in (('erode', 1.4, 0.16), ('pit', 0.28, 0.035)):
    tex = bpy.data.textures.new(name, 'CLOUDS'); tex.noise_scale = scale; tex.noise_depth = 3
    dm = statue.modifiers.new(name, 'DISPLACE'); dm.texture = tex; dm.strength = strength; dm.mid_level = 0.5
    bpy.ops.object.modifier_apply(modifier=name)
dec = statue.modifiers.new('dec', 'DECIMATE'); dec.ratio = 1.0
tris = sum(len(p.vertices) - 2 for p in statue.data.polygons)
dec.ratio = min(1.0, 14000 / max(1, tris))
bpy.ops.object.modifier_apply(modifier='dec')
bpy.ops.object.shade_smooth()

# --- box-mapped stone ----------------------------------------------------------
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.cube_project(cube_size=4.5)
bpy.ops.object.mode_set(mode='OBJECT')
mat = bpy.data.materials.new('WardenColossusStone'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
img = bpy.data.images.load(STONE)
img.scale(1024, 1024)
tn = mat.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img
mat.node_tree.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.92
bsdf.inputs['Metallic'].default_value = 0.0
statue.data.materials.clear(); statue.data.materials.append(mat)

# origin at the plinth base centre
statue.location = (0, 0, 0)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print('COLOSSUS tris', sum(len(p.vertices) - 2 for p in statue.data.polygons), 'dims', tuple(round(v, 2) for v in statue.dimensions))

if PREVIEW:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.render.resolution_x = 700; scene.render.resolution_y = 900
    cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam)
    cam.location = (5.5, -19.0, 6.0); cam_d.lens = 50
    direction = Vector((0, 0, 5.0)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun_d = bpy.data.lights.new('sun', 'SUN'); sun_d.energy = 3.5
    sun = bpy.data.objects.new('sun', sun_d); scene.collection.objects.link(sun); sun.rotation_euler = (0.9, 0.1, 0.6)
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.55, 0.7, 1); world.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)

bpy.ops.object.select_all(action='DESELECT'); statue.select_set(True); bpy.context.view_layer.objects.active = statue
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_image_format='WEBP', export_image_quality=82)
print('COLOSSUS written', OUT)
