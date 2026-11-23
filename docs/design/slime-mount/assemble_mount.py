"""Assemble the static slime mount: a clean Blender jelly body with the Tripo
tack (saddle, blanket, straps, buckles, stirrups) sat on it.

blender --background --python assemble_mount.py -- <slime_tripo.glb> <out.glb>

The Tripo model is one shell: jelly skin and tack welded together, with the
jelly's lighting and highlights baked into its texture. The jelly faces are
told apart by colour (bright sky blue; the blanket is a dark navy), dropped,
and replaced by a smooth body fitted to them: a low-order surface r(theta, phi)
around the body centre, least squares on rays to the old skin, so the body
under the saddle (which Tripo never built) is filled by the fit. The tack is
kept whole, and the body is tucked just under it wherever a ray from the body
centre meets the tack first (the fit alone would bulge up through the seat).

Turned so the mount faces Blender -Y (glTF +Z) and scaled to SPAN model units
nose to tail, sat on the ground at z = 0. The body keeps the material name
`slime` and an equirect UV layout build_mount.py paints into:
u = (phi + pi) / 2pi with phi = 0 at the front, v = 1 - theta / 180.
"""
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

src_glb, out_glb = sys.argv[sys.argv.index("--") + 1 :]
SPAN = 8.0  # nose to tail, model units
SEGMENTS, RINGS = 64, 40
GAP = 0.012  # of the mean radius: how far the body tucks under the tack
ORDER = 7  # cos(k theta), k < ORDER, in the body fit


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src_glb)
src = next(o for o in bpy.context.scene.objects if o.type == "MESH")
src.data.transform(src.matrix_world)
src.matrix_world = Matrix.Identity(4)
mesh = src.data

# Tripo built it facing +X: turn it to face -Y, then scale it to SPAN long.
mesh.transform(Matrix.Rotation(-math.pi / 2, 4, "Z"))
ys = [v.co.y for v in mesh.vertices]
mesh.transform(Matrix.Scale(SPAN / (max(ys) - min(ys)), 4))

# --- tell jelly from tack ---------------------------------------------------------
# Colour alone is noisy: the glossy leather and blanket carry blue glints, and the
# jelly carries white highlights. So the jelly is grown from the bottom of the
# shell through sky-blue faces (glints inside the tack are never reached), then
# let a little further through paler blue at its edge (the fringe where the
# blanket meets the jelly); what is left is the tack, minus lone specks and
# white highlight chips.
tex = next(n.image for n in mesh.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and "Color" in n.image.name)
TW, TH = tex.size
tpx = np.array(tex.pixels[:], dtype=np.float32).reshape(TH, TW, 4)
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)  # glTF splits every UV seam
bm.faces.ensure_lookup_table()
uv_layer = bm.loops.layers.uv.active


def mean_colour(f):
    acc, n = np.zeros(3), 0
    uvs = [loop[uv_layer].uv.copy() for loop in f.loops]
    for i in range(1, len(uvs) - 1):
        for wa, wb in ((0.33, 0.33), (0.6, 0.2), (0.2, 0.6), (0.2, 0.2)):
            u = uvs[0] * (1 - wa - wb) + uvs[i] * wa + uvs[i + 1] * wb
            x, y = min(TW - 1, int(u.x % 1 * TW)), min(TH - 1, int(u.y % 1 * TH))
            acc += tpx[y, x, :3]
            n += 1
    return acc / max(n, 1)


colour = {f: mean_colour(f) for f in bm.faces}


def sky(c):
    """Sky-blue jelly: blue high and well clear of red. The navy blanket stays
    under blue 0.5; the leather and brass carry more red than blue."""
    r, g, b = c
    return b > 0.55 and b - r > 0.3 and g > 0.3


def pale(c):
    """Paler jelly at its edges. Sky blue carries green well over red; the navy
    blanket keeps green near red, so it never passes."""
    r, g, b = c
    return b > 0.4 and g - r > 0.12 and b - r > 0.12


def grow(seeds, ok):
    region, stack = set(seeds), list(seeds)
    while stack:
        f = stack.pop()
        for e in f.edges:
            for g in e.link_faces:
                if g not in region and ok(g):
                    region.add(g)
                    stack.append(g)
    return region


lowest = min(bm.faces, key=lambda f: f.calc_center_median().z)
jelly = grow([lowest], lambda f: sky(colour[f]))
for _ in range(4):
    jelly |= {g for f in jelly for e in f.edges for g in e.link_faces if g not in jelly and pale(colour[g])}
zs = [v.co.z for f in jelly for v in f.verts]
zmin, zmax = min(zs), max(zs)
C = Vector((0.0, 0.0, zmin + 0.45 * (zmax - zmin)))
print("JELLY faces", len(jelly), "of", len(bm.faces), "centre", tuple(round(v, 3) for v in C))

# --- fit the body: r(theta, phi) = sum c_k,m cos(k theta) cos(m phi) -----------------
# phi = 0 at the front (-Y); only cos(m phi) terms, so the body is mirror-symmetric
# left to right as the concept is.
jbm = bm.copy()
jbm.faces.ensure_lookup_table()
bmesh.ops.delete(jbm, geom=[jbm.faces[f.index] for f in bm.faces if f not in jelly], context="FACES")
jbvh = BVHTree.FromBMesh(jbm)


def angles(d):
    th = math.acos(max(-1.0, min(1.0, d.z / d.length)))
    ph = math.atan2(d.x, -d.y)  # 0 at the front, + toward the left (+X)
    return th, ph


def basis(th, ph):
    return [math.cos(k * th) * math.cos(m * ph) for k in range(ORDER) for m in range(4)]


rows, rhs = [], []
for i in range(1, 60):
    th = math.pi * i / 60
    for j in range(96):
        ph = 2 * math.pi * j / 96
        d = Vector((math.sin(th) * math.sin(ph), -math.sin(th) * math.cos(ph), math.cos(th)))
        hit, _, idx, _ = jbvh.ray_cast(C, d)
        if hit is None:
            continue
        rows.append(basis(th, ph))
        rhs.append((hit - C).length)
coef, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
print("FIT rays", len(rhs), "rms", round(float(np.sqrt(np.mean((np.array(rows) @ coef - rhs) ** 2))), 4))


def r_fit(th, ph):
    return float(np.dot(basis(th, ph), coef))


R_MEAN = float(np.mean(rhs))

# --- the tack: drop the jelly, keep every other face, press it clear -----------------
bmesh.ops.delete(bm, geom=list(jelly), context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
seen, parts = set(), []
for f0 in bm.faces:
    if f0 not in seen:
        part = grow([f0], lambda f: True)
        seen |= part
        parts.append(part)


def span(part):
    vs = [v.co for f in part for v in f.verts]
    return max((max(c[k] for c in vs) - min(c[k] for c in vs)) for k in range(3))


def chip(part):
    """A baked highlight or bubble glint: pale all over, never leather or navy."""
    c = sum((colour[f] for f in part), np.zeros(3)) / len(part)
    return min(c) > 0.42 or pale(c)


drop = [p for p in parts if span(p) < 0.03 * SPAN or chip(p)]
bmesh.ops.delete(bm, geom=[f for p in drop for f in p], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
print("TACK parts kept", len(parts) - len(drop), "dropped", len(drop), sum(len(p) for p in drop), "faces")
tack_bvh = BVHTree.FromBMesh(bm)


def r_body(th, ph):
    d = Vector((math.sin(th) * math.sin(ph), -math.sin(th) * math.cos(ph), math.cos(th)))
    r = r_fit(th, ph)
    hit, *_ = tack_bvh.ray_cast(C, d, r + GAP * R_MEAN)
    return r if hit is None else min(r, (hit - C).length - GAP * R_MEAN)


for f in bm.faces:
    f.smooth = True
bm.to_mesh(mesh)
mesh.update()
mesh.materials[0].name = "tack"
src.name = "slime_tack"

# --- the new body -----------------------------------------------------------------
verts, faces, uvs = [], [], []
for i in range(RINGS + 1):
    th = math.pi * i / RINGS
    for j in range(SEGMENTS + 1):  # a seam column, so the UVs never wrap
        ph = -math.pi + 2 * math.pi * j / SEGMENTS
        d = Vector((math.sin(th) * math.sin(ph), -math.sin(th) * math.cos(ph), math.cos(th)))
        verts.append(C + d * r_body(th, ph))
for i in range(RINGS):
    for j in range(SEGMENTS):
        a = i * (SEGMENTS + 1) + j
        b, c, d_ = a + 1, a + SEGMENTS + 2, a + SEGMENTS + 1
        if i == 0:
            faces.append((a, c, d_))
        elif i == RINGS - 1:
            faces.append((a, b, d_))
        else:
            faces.append((a, b, c, d_))
body_mesh = bpy.data.meshes.new("slime_body")
body_mesh.from_pydata([tuple(v) for v in verts], [], faces)
uvl = body_mesh.uv_layers.new(name="UVMap")
for p in body_mesh.polygons:
    for li in p.loop_indices:
        vi = body_mesh.loops[li].vertex_index
        i, j = divmod(vi, SEGMENTS + 1)
        uvl.data[li].uv = (j / SEGMENTS, 1 - i / RINGS)
body_mesh.validate()
mid = body_mesh.polygons[len(body_mesh.polygons) // 2]
if mid.normal.dot(mid.center - C) < 0:
    for p in body_mesh.polygons:
        p.flip()
for p in body_mesh.polygons:
    p.use_smooth = True
body = bpy.data.objects.new("slime_body", body_mesh)
bpy.context.scene.collection.objects.link(body)
mat = bpy.data.materials.new("slime")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.3
bsdf.inputs["Metallic"].default_value = 0.0
img = bpy.data.images.new("SlimeColor", 8, 4)  # build_mount.py paints the real one
tn = mat.node_tree.nodes.new("ShaderNodeTexImage")
tn.image = img
mat.node_tree.links.new(tn.outputs[0], bsdf.inputs["Base Color"])
body_mesh.materials.append(mat)

# Sit it on the ground, centred.
lo = min(v.co.z for v in body_mesh.vertices)
shift = Matrix.Translation((0, 0, -lo))
for ob in (body, src):
    ob.data.transform(shift)

bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
src.select_set(True)
bpy.context.view_layer.objects.active = src
bpy.ops.object.join()
src.name = "slime"
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB")
ext = [max(v.co[k] for v in src.data.vertices) - min(v.co[k] for v in src.data.vertices) for k in range(3)]
print("EXPORTED", out_glb, len(src.data.polygons), "faces, size", [round(e, 2) for e in ext])
