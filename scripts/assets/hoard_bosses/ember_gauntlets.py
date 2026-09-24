"""Emberforge Tyrant: replace the generated hands with rigid FORGE GAUNTLETS.

The rig has no finger bones, and the generated open hands read as rubber gloves
(playtest). Each hand is one welded shell of the generated mesh, so it is found
by connectivity and removed whole; a closed black-iron war mitten is modelled in
its place: a wrist cuff, a molten seam, a chamfered fist, a back plate, four
forged knuckle wedges with molten seams between them, and a thumb plate. Nothing
is meant to bend, so nothing looks as if it should.

The gauntlets share the body's one material. Three swatches (dark iron, worn iron,
molten orange) are painted into unused corners of the atlas, in the colour map AND
flat into the normal and occlusion/roughness/metal maps, and every gauntlet face
maps onto one of them.

Input is the T-pose raw (faces +X, arms along Y, up Z); output goes to the
pipeline's rig-manual.

  blender --background --python ember_gauntlets.py -- <in.glb> <out.glb>
"""
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
body = next(o for o in scene.objects if o.type == 'MESH')
world = body.matrix_world.copy()
body.parent = None
body.data.transform(world)
body.matrix_world = Matrix.Identity(4)
for o in list(scene.objects):
    if o is not body:
        bpy.data.objects.remove(o, do_unlink=True)

# ------------------------------------------------------ remove the old hands
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.verts.ensure_lookup_table()
label = {}
shells = []
for v in bm.verts:
    if v.index in label:
        continue
    stack, group = [v], []
    label[v.index] = len(shells)
    while stack:
        cur = stack.pop()
        group.append(cur)
        for e in cur.link_edges:
            other = e.other_vert(cur)
            if other.index not in label:
                label[other.index] = len(shells)
                stack.append(other)
    shells.append(group)
hands = {}
for g, group in enumerate(shells):
    ys = [v.co.y for v in group]
    if len(group) >= 40 and min(abs(y) for y in ys) >= 0.36:
        side = 1 if ys[0] > 0 else -1
        hands[g] = side
tree = kdtree.KDTree(len(bm.verts))
for v in bm.verts:
    tree.insert(v.co, v.index)
tree.balance()
hand_of = [hands.get(label[tree.find(v.co)[1]]) for v in body.data.vertices]
wrist = {}
for side in (1, -1):
    pts = [body.data.vertices[i].co for i, s in enumerate(hand_of) if s == side]
    near = sorted(pts, key=lambda p: abs(p.y))[:max(6, len(pts) // 8)]
    wrist[side] = sum(near, Vector()) / len(near)
bm.free()
print('HAND SHELLS', len(hands), 'WRISTS', {s: tuple(round(c, 3) for c in w) for s, w in wrist.items()})

bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
doomed = [f for f in bm.faces if all(hand_of[v.index] is not None for v in f.verts)]
removed = len(doomed)
bmesh.ops.delete(bm, geom=doomed, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(body.data)
bm.free()

# ------------------------------------------------------- swatches in the atlas
material = body.data.materials[0]
images = {}
for node in material.node_tree.nodes:
    if node.type != 'TEX_IMAGE' or not node.image:
        continue
    name = node.image.name
    kind = 'color' if name.startswith('Color') else 'normal' if name.startswith('Normal') else 'orm'
    images[kind] = node.image
size = images['color'].size[0]
cover = np.zeros((size, size), dtype=bool)
uv = body.data.uv_layers.active.data
for poly in body.data.polygons:
    us = [uv[i].uv.x * size for i in poly.loop_indices]
    vs = [uv[i].uv.y * size for i in poly.loop_indices]
    x0, x1 = int(max(0, min(us) - 3)), int(min(size - 1, max(us) + 3))
    y0, y1 = int(max(0, min(vs) - 3)), int(min(size - 1, max(vs) + 3))
    cover[y0:y1 + 1, x0:x1 + 1] = True  # bounding boxes: generous, and cheap
SW = 40
free = []
for y in range(4, size - SW - 4, SW):
    for x in range(4, size - SW - 4, SW):
        if not cover[y:y + SW, x:x + SW].any():
            free.append((x, y))
            if len(free) == 3:
                break
    if len(free) == 3:
        break
if len(free) < 3:
    raise SystemExit('no free atlas room for the swatches')
# sRGB colours as the colour map stores them.
SWATCH = {'iron': (0.085, 0.08, 0.085), 'worn': (0.23, 0.215, 0.21), 'molten': (1.0, 0.5, 0.1)}
PLACE = dict(zip(SWATCH, free))
for kind, image in images.items():
    if tuple(image.size) != (size, size):
        image.scale(size, size)
    px = np.array(image.pixels[:], dtype=np.float32).reshape(size, size, 4)
    for name, (x, y) in PLACE.items():
        if kind == 'color':
            value = (*SWATCH[name], 1.0)
        elif kind == 'normal':
            value = (0.5, 0.5, 1.0, 1.0)
        else:  # occlusion, roughness, metal
            value = (1.0, 0.85, 0.0, 1.0) if name == 'molten' else (1.0, 0.5, 0.85, 1.0)
        px[y:y + SW, x:x + SW] = value
    image.pixels = px.reshape(-1).tolist()
    image.pack()
CENTRE = {n: ((x + SW / 2) / size, (y + SW / 2) / size) for n, (x, y) in PLACE.items()}
print('SWATCHES', PLACE)

# ------------------------------------------------------------ the gauntlet
# Local frame: a = along the hand from the wrist, b = toward the character's
# front, c = up. Boxes are (a0, a1, b0, b1, c0, c1, swatch, chamfer).
# Slightly over a real hand against his forearm: heavy, not comic.
SCALE = 0.88
KNUCKLE_B = (-0.057, -0.019, 0.019, 0.057)
PARTS = [
    (-0.035, 0.03, -0.074, 0.074, -0.066, 0.066, 'iron', 0.02),      # cuff
    (0.018, 0.034, -0.082, 0.082, -0.074, 0.074, 'worn', 0.022),     # cuff rim
    (0.03, 0.046, -0.06, 0.06, -0.054, 0.054, 'molten', 0.012),      # wrist seam
    (0.042, 0.168, -0.08, 0.08, -0.07, 0.07, 'iron', 0.03),          # fist
    (0.052, 0.15, -0.064, 0.064, 0.066, 0.084, 'worn', 0.008),       # back plate
    (0.06, 0.14, -0.05, 0.05, 0.08, 0.088, 'molten', 0.0),           # its forge channel
    (0.066, 0.134, -0.042, 0.042, 0.084, 0.094, 'iron', 0.004),      # channel cover
    (0.058, 0.128, 0.076, 0.104, -0.04, 0.04, 'worn', 0.01),         # thumb plate
    (0.15, 0.176, -0.07, 0.07, -0.05, 0.062, 'molten', 0.0),         # glow behind the knuckles
]
for b in KNUCKLE_B:
    PARTS.append((0.152, 0.196, b - 0.016, b + 0.016, -0.03, 0.076, 'worn', 0.009))


def add_box(out, spec, frame, mirror):
    a0, a1, b0, b1, c0, c1, swatch, chamfer = spec
    a0, a1, b0, b1, c0, c1, chamfer = (SCALE * n for n in (a0, a1, b0, b1, c0, c1, chamfer))
    part = bmesh.new()
    bmesh.ops.create_cube(part, size=1.0)
    for v in part.verts:
        v.co = Vector(((a0 + a1) / 2 + v.co.x * (a1 - a0), (b0 + b1) / 2 + v.co.y * (b1 - b0),
                       (c0 + c1) / 2 + v.co.z * (c1 - c0)))
    if chamfer > 0:
        bmesh.ops.bevel(part, geom=list(part.edges), offset=chamfer, segments=1, affect='EDGES')
    origin, a_axis, b_axis, c_axis = frame
    for v in part.verts:
        v.co = origin + a_axis * v.co.x + b_axis * v.co.y + c_axis * v.co.z
    if mirror:
        bmesh.ops.reverse_faces(part, faces=list(part.faces))
    temp = bpy.data.meshes.new('part')
    part.to_mesh(temp)
    part.free()
    start = len(out.faces)
    out.from_mesh(temp)
    bpy.data.meshes.remove(temp)
    out.faces.ensure_lookup_table()
    return [(f, swatch) for f in list(out.faces)[start:]]


gaunt = bmesh.new()
tagged = []
for side in (1, -1):
    # The generated forearm sweeps a little forward of the arm line; the fist
    # follows it part of the way so it sits square on the bracer.
    a_axis = Vector((0.55, side * 0.83, 0.05)).normalized()
    c_axis = Vector((0, 0, 1))
    b_axis = a_axis.cross(c_axis).normalized() * -side  # toward +X, his front
    c_axis = (a_axis.cross(b_axis) * side).normalized()
    if c_axis.z < 0:
        c_axis = -c_axis
    frame = (wrist[side], a_axis, b_axis, c_axis)
    handed = (a_axis.cross(b_axis)).dot(c_axis) < 0
    for spec in PARTS:
        tagged += add_box(gaunt, spec, frame, handed)
uv_layer = gaunt.loops.layers.uv.new('UVMap')
for face, swatch in tagged:
    face.smooth = False
    face.material_index = 0
    u, v = CENTRE[swatch]
    for k, loop in enumerate(face.loops):
        # A tiny spread inside the swatch so no UV triangle is degenerate.
        loop[uv_layer].uv = (u + 0.004 * math.cos(k * 2.1), v + 0.004 * math.sin(k * 2.1))
bmesh.ops.triangulate(gaunt, faces=list(gaunt.faces))
tris = len(gaunt.faces)
gaunt_mesh = bpy.data.meshes.new('ForgeGauntlets')
gaunt.to_mesh(gaunt_mesh)
gaunt.free()
gaunt_mesh.materials.append(material)
gaunt_obj = bpy.data.objects.new('ForgeGauntlets', gaunt_mesh)
scene.collection.objects.link(gaunt_obj)
# The body's UV layer name must match for the join to keep both sets of UVs.
gaunt_mesh.uv_layers[0].name = body.data.uv_layers.active.name
bpy.ops.object.select_all(action='DESELECT')
gaunt_obj.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print('REMOVED FACES', removed, 'ADDED TRIANGLES', tris)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True)
print('WROTE', dst)
