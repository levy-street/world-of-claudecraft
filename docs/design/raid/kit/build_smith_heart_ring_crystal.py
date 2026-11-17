"""The Smith's Heart ring crystal: the Tripo model made game-ready.

The seal on the Ring's dais is ONE crystal that holds all four elements (the owner's
ask of 2026-11-18): the Hammer's amber, the Quench's ice, the Breath's storm and the Heat's
fire grown together round a white-gold heart, a wide splayed crown of big shards at their own
angles, its plinth spread to the seal's inner circle. This script takes the Tripo P2
multiview build of the ChatGPT turnaround sheet (docs/design/raid/kit/ring_crystal_src/
README.md) and writes the shipping source GLB:

  - turned and mirrored so each element faces its own vein (the sheet's chirality is the
    mirror of the Ring's compass): the Hammer's amber south, the Quench's ice east, the
    Breath's storm north, the Heat's fire west, in the game's own frame (north +z);
  - scaled so its widest reach is `--reach` yards (the seal's inner circle), its plinth's
    centre on the origin, its foot on y = 0;
  - per vertex, two custom attributes: `_weights` (RGBA: red the Hammer, green the Breath,
    blue the Quench, alpha the Heat; the white-gold heart is what is left of 1) lights each
    element on its own, and `_path` (0 at the plinth's rim where the element's river arrives,
    1 at the far tips) is how far along its crystal the element's light has climbed. The
    weights follow the PAINTING (an amber crystal is the Hammer's wherever Tripo stood it:
    its side clusters do not keep to their own compass side), and the compass only where the
    painting has no hue to read (the plain stone plinth: each quarter lights its own channel);
  - cut into pieces along the model's own shells (Tripo builds a heap of separate crystals,
    never one solid): the plinth's stones and the crystals grouped into balanced clusters,
    each piece its own node with its centre as the node's translation, the pieces the burst
    throws apart. Their union is the crystal; the renderer merges them for the whole
    crystal's one draw.

Run (one Blender process; the glTF importer and exporter are Blender's own):

  Blender -b --factory-startup --python docs/design/raid/kit/build_smith_heart_ring_crystal.py \
      -- --src tmp/ring_crystal/crystal2/raw.glb --out tmp/ring_crystal/smith_heart_ring_crystal_src.glb

Then ship it: node scripts/assets/smith_heart_ring_crystal/build.mjs (the KTX2 step, the
media manifest).
"""
import argparse
import colorsys
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--reach', type=float, default=8.6)
ap.add_argument('--squash', type=float, default=1.0)
ap.add_argument('--clusters', type=int, default=14)
ap.add_argument('--crown-r', type=float, default=0.15)
ap.add_argument('--crown-z', type=float, default=0.4)
ap.add_argument('--debug-dir', default='')
args = ap.parse_args(argv)

# The veins' bearings (degrees clockwise from north) in the sim's compass: the Hammer's light
# arrives from the south, the Breath's from the north, the Quench's from the east, the Heat's
# from the west (heart_seal_core.ts HEART_SEAL_QUARTERS). The weights' channel order.
VEIN_BEARINGS = (('hammer', 180.0), ('breath', 0.0), ('quench', 90.0), ('heat', 270.0))

# In Blender's frame (z up) the exporter writes (x, y, z) as glTF (x, z, -y): east is +x and
# SOUTH is +y (glTF -z), so north is -y.


def bearing_of(x, y):
    """Degrees clockwise from north of a Blender (x, y)."""
    return math.degrees(math.atan2(x, -y)) % 360.0


def smoothstep(a, b, x):
    if b == a:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def azimuth_weights(x, y, reach):
    """The compass weights at (x, y): each element on its own vein's side, cos squared, their
    sum 1."""
    r = math.hypot(x, y)
    phi = math.radians(bearing_of(x, y))
    raw = [max(0.0, math.cos(phi - math.radians(deg))) ** 2 for _, deg in VEIN_BEARINGS]
    total = sum(raw) or 1.0
    w = [v / total for v in raw]
    # On the axis the bearing is meaningless: blend to an even share.
    t = smoothstep(0.0, 0.04 * reach, r)
    return [0.25 * (1 - t) + v * t for v in w]


def hue_weights(h, s, v):
    """What element a painted texel is, by hue (degrees), and how much of a hue it carries:
    ((hammer, breath, quench, heat), carried, pale_warm). Amber is the Hammer's, red and
    orange the Heat's, cyan and sky blue the Quench's, indigo and violet the Breath's."""
    carried = smoothstep(0.18, 0.40, s) * smoothstep(0.10, 0.25, v)
    hh = h - 360.0 if h >= 345 else h  # crimson wraps to the red end
    heat = (1.0 - smoothstep(22, 34, hh)) if hh < 60 else 0.0
    heat = max(heat, smoothstep(320, 345, h))
    amber = smoothstep(22, 34, hh) * (1.0 - smoothstep(60, 76, hh)) if 0 <= hh < 90 else 0.0
    ice = smoothstep(150, 175, h) * (1.0 - smoothstep(214, 232, h))
    storm = smoothstep(214, 232, h) * (1.0 - smoothstep(320, 345, h))
    w = [amber, storm, ice, heat]
    total = sum(w)
    if total < 1e-6:
        w = [0.25, 0.25, 0.25, 0.25]
        total = 1.0
    w = [x / total for x in w]
    pale = smoothstep(22, 32, h) * (1.0 - smoothstep(66, 78, h)) * (1.0 - smoothstep(0.30, 0.46, s)) * smoothstep(0.62, 0.78, v)
    return w, carried, pale


def weights_at(x, y, z, height, reach, hsv):
    """The element weights at a vertex: (hammer, breath, quench, heat), their sum 1 on the
    clusters, 0 on the heart (the white-gold shaft standing over them). `hsv` is the painted
    texel (hue degrees, saturation, value) the vertex sits on, or None."""
    r = math.hypot(x, y)
    az = azimuth_weights(x, y, reach)
    if hsv is None:
        w = az
        pale = 0.0
    else:
        col, carried, pale = hue_weights(*hsv)
        w = [carried * col[k] + (1.0 - carried) * az[k] for k in range(4)]
    hn = z / height
    # The heart: the tall central shaft over the clusters, on the axis (by place, not by
    # colour: its gold reads as amber on a texel).
    centre = 1.0 - smoothstep(args.crown_r * reach * 0.9, args.crown_r * reach * 1.6, r)
    crown = centre * smoothstep(args.crown_z - 0.12, args.crown_z + 0.06, hn)
    crown = max(crown, smoothstep(0.84, 0.92, hn) * centre)
    return [v * (1.0 - crown) for v in w]


# ---- import, turn, scale ------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.src)
src_obj = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name != 'Icosphere'][0]
bm = bmesh.new()
bm.from_mesh(src_obj.data)
bm.transform(src_obj.matrix_world)
# Tripo's own split normals would no longer match the turned and mirrored mesh: the exporter
# writes normals from the geometry's own shading instead (shade_smooth_by_angle below).
for kind in (bm.loops.layers.float_vector, bm.verts.layers.float_vector):
    for name in [n for n in kind.keys() if n == 'custom_normal']:
        kind.remove(kind[name])

# The sheet's turnaround puts the amber front on +x, the ice on +y, the storm on -x and the
# fire on -y; the Ring needs amber +y (south), ice +x (east), storm -y (north) and fire -x
# (west): swap x and y, a mirror (the winding is turned back below).
swap = Matrix(((0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
bm.transform(swap)
bmesh.ops.reverse_faces(bm, faces=bm.faces[:])

zmin = min(v.co.z for v in bm.verts)
zmax = max(v.co.z for v in bm.verts)
# The plinth's own centre: the middle of its low vertices, not the bounds' middle.
low = [v for v in bm.verts if v.co.z - zmin < 0.08 * (zmax - zmin)]
cx = (min(v.co.x for v in low) + max(v.co.x for v in low)) / 2
cy = (min(v.co.y for v in low) + max(v.co.y for v in low)) / 2
bm.transform(Matrix.Translation((-cx, -cy, -zmin)))
raw_reach = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
scale = args.reach / raw_reach
bm.transform(Matrix.Diagonal((scale, scale, scale * args.squash, 1.0)))
reach = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
height = max(v.co.z for v in bm.verts)
# The plinth's own rim: how far its low stones reach.
plinth_r = max(math.hypot(v.co.x, v.co.y) for v in bm.verts if v.co.z < 0.05 * height)
print(f'crystal: height {height:.3f} yd, reach {reach:.3f} yd, plinth {plinth_r:.3f} yd, scale {scale:.3f}')
# What a body (about two yards tall) can touch: the wall's reach.
low_reach = max(math.hypot(v.co.x, v.co.y) for v in bm.verts if v.co.z < 2.4)
print(f'footprint under two yards high: {low_reach:.3f} yd')

# ---- the shells and their pieces ----------------------------------------------------------

bm.faces.ensure_lookup_table()
bm.faces.index_update()
bm.verts.ensure_lookup_table()
bm.verts.index_update()
seen = {}
shells = []
for f in bm.faces:
    if f.index in seen:
        continue
    stack = [f]
    comp = []
    while stack:
        a = stack.pop()
        if a.index in seen:
            continue
        seen[a.index] = len(shells)
        comp.append(a)
        for e in a.edges:
            for g in e.link_faces:
                if g.index not in seen:
                    stack.append(g)
    shells.append(comp)


def shell_info(comp):
    vs = {v.index: v for f in comp for v in f.verts}
    n = len(vs)
    c = Vector((sum(v.co.x for v in vs.values()) / n, sum(v.co.y for v in vs.values()) / n, sum(v.co.z for v in vs.values()) / n))
    return c, sum(f.calc_area() for f in comp)


infos = [shell_info(c) for c in shells]
def shell_top(comp):
    return max(v.co.z for f in comp for v in f.verts)


plinth_ids, heart_ids, body_ids = [], [], []
for i, (c, _) in enumerate(infos):
    r = math.hypot(c.x, c.y)
    if c.z < 0.1 * height and r > 0.45 * reach:
        plinth_ids.append(i)
    elif r <= args.crown_r * reach * 2.6 and shell_top(shells[i]) >= 0.72 * height:
        # The heart: the tall shells on the axis (Tripo builds its shaft as a few of them).
        heart_ids.append(i)
    else:
        body_ids.append(i)
heart_verts = {v.index for i in heart_ids for f in shells[i] for v in f.verts}
print('shells:', len(shells), 'plinth', len(plinth_ids), 'heart', len(heart_ids), 'body', len(body_ids))
if args.debug_dir:
    near = sorted(range(len(infos)), key=lambda i: -infos[i][1])
    for i in near[:14]:
        c, a = infos[i]
        zs = [v.co.z for f in shells[i] for v in f.verts]
        rs = [math.hypot(v.co.x, v.co.y) for f in shells[i] for v in f.verts]
        print(f'  shell {i}: area {a:.1f} centre r {math.hypot(c.x, c.y):.2f} z {c.z:.1f} z-span {min(zs):.1f}-{max(zs):.1f} max r {max(rs):.2f}')



# ---- the weights and the path (custom attributes) -----------------------------------------

# The painting, blurred a little (a texel's neighbours are the same crystal): read as raw bytes.
src_paint = None
for m in src_obj.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and 'color' in n.name.lower() + n.label.lower() + n.image.name.lower():
                src_paint = n.image
        if src_paint is None:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    link = n.inputs['Base Color'].links
                    if link and link[0].from_node.type == 'TEX_IMAGE':
                        src_paint = link[0].from_node.image
kept_space = src_paint.colorspace_settings.name
src_paint.colorspace_settings.name = 'Non-Color'
pw, ph = src_paint.size
buf = np.empty(pw * ph * 4, dtype=np.float32)
src_paint.pixels.foreach_get(buf)
src_paint.colorspace_settings.name = kept_space
rgb = buf.reshape(ph, pw, 4)[..., :3]
R = 5
pad = np.pad(rgb, ((R, R), (R, R), (0, 0)), mode='edge')
cs = np.cumsum(np.cumsum(pad, axis=0), axis=1)
cs = np.pad(cs, ((1, 0), (1, 0), (0, 0)))
k = 2 * R + 1
blur = (cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k])[:ph, :pw] / (k * k)
uv_layer = bm.loops.layers.uv.active


def texel(v):
    uv = v.link_loops[0][uv_layer].uv
    px = min(pw - 1, max(0, int(uv.x * pw)))
    py = min(ph - 1, max(0, int(uv.y * ph)))
    r, g, b = (float(c) for c in blur[py, px])
    h, sat, val = colorsys.rgb_to_hsv(r, g, b)
    return (h * 360.0, sat, val)


wlayer = bm.verts.layers.float_color.new('_weights')
player = bm.verts.layers.float.new('_path')
entries = []
for _, deg in VEIN_BEARINGS:
    b = math.radians(deg)
    entries.append(Vector((math.sin(b) * plinth_r, -math.cos(b) * plinth_r, 0.0)))
dist = []
for v in bm.verts:
    w = weights_at(v.co.x, v.co.y, v.co.z, height, reach, texel(v))
    if v.index in heart_verts:
        w = [0.0, 0.0, 0.0, 0.0]
    v[wlayer] = (w[0], w[1], w[2], w[3])
    s = sum(w)
    if s > 0.02:
        d = sum(w[k] * (v.co - entries[k]).length for k in range(4)) / s
    else:
        d = -1.0
    dist.append(d)
real = sorted(d for d in dist if d >= 0)
top = real[int(len(real) * 0.995)]
for v, d in zip(bm.verts, dist):
    v[player] = 1.0 if d < 0 else max(0.0, min(1.0, d / top))
print('weights and path written on', len(bm.verts), 'vertices (path scale', round(top, 2), 'yd)')

if args.debug_dir:
    # Each weight as a grey ramp over the model, from the four sides (Workbench).
    os.makedirs(args.debug_dir, exist_ok=True)
    dme = bpy.data.meshes.new('dbg')
    bm.to_mesh(dme)
    dob = bpy.data.objects.new('dbg', dme)
    bpy.context.scene.collection.objects.link(dob)
    for ch in range(5):
        attr = dme.color_attributes.new(f'ch{ch}', 'FLOAT_COLOR', 'POINT')
        wl = dme.attributes['_weights']
        for i in range(len(dme.vertices)):
            wv = wl.data[i].color
            val = wv[ch] if ch < 4 else max(0.0, 1.0 - (wv[0] + wv[1] + wv[2] + wv[3]))
            attr.data[i].color = (val, val, val, 1.0)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'
    sc.display.shading.color_type = 'VERTEX'
    sc.render.resolution_x = 360
    sc.render.resolution_y = 360
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.0, 0.0, 0.1)
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 2.2 * reach
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    mid = Vector((0, 0, height * 0.45))
    for view, d in (('S', (0, 1)), ('E', (1, 0)), ('N', (0, -1)), ('W', (-1, 0))):
        cam.location = mid + Vector((d[0] * 60, d[1] * 60, 0))
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        for ch in range(5):
            dme.color_attributes.active_color = dme.color_attributes[f'ch{ch}']
            dme.color_attributes.render_color_index = list(dme.color_attributes.keys()).index(f'ch{ch}')
            sc.render.filepath = os.path.join(args.debug_dir, f'{view}_{ch}.png')
            bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(dob, do_unlink=True)

def space(c):
    return Vector((c.x / reach, c.y / reach, 1.4 * c.z / height))


def kmeans(ids, k, iters=60):
    """Deterministic, area-weighted k-means over the shells' centres (farthest-point start)."""
    if len(ids) <= k:
        return [[i] for i in ids]
    pts = {i: space(infos[i][0]) for i in ids}
    first = max(ids, key=lambda i: infos[i][1])
    centres = [pts[first]]
    while len(centres) < k:
        far = max(ids, key=lambda i: min((pts[i] - c).length for c in centres))
        centres.append(pts[far])
    groups = [[] for _ in centres]
    for _ in range(iters):
        groups = [[] for _ in centres]
        for i in ids:
            groups[min(range(len(centres)), key=lambda j: (pts[i] - centres[j]).length)].append(i)
        moved = False
        for j, g in enumerate(groups):
            if not g:
                continue
            tot = sum(infos[i][1] for i in g) or 1.0
            c = sum((pts[i] * infos[i][1] for i in g), Vector((0, 0, 0))) / tot
            if (c - centres[j]).length > 1e-6:
                moved = True
            centres[j] = c
        if not moved:
            break
    return [g for g in groups if g]


plinth_groups = kmeans(plinth_ids, 6)
body_groups = kmeans(body_ids, args.clusters)
groups = [('plinth', g) for g in plinth_groups] + [('body', g) for g in body_groups]
if heart_ids:
    groups.append(('heart', heart_ids))
print('pieces:', [(kind, len(g)) for kind, g in groups])

# ---- the material: the painting alone -----------------------------------------------------

paint = None
for m in src_obj.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and 'color' in n.name.lower() + n.label.lower() + n.image.name.lower():
                paint = n.image
        if paint is None:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    link = n.inputs['Base Color'].links
                    if link and link[0].from_node.type == 'TEX_IMAGE':
                        paint = link[0].from_node.image
print('painting:', paint.name if paint else None, tuple(paint.size) if paint else None)
mat = bpy.data.materials.new('SmithHeartRingCrystal')
mat.use_nodes = True
nodes = mat.node_tree.nodes
for n in list(nodes):
    nodes.remove(n)
out_node = nodes.new('ShaderNodeOutputMaterial')
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
tex = nodes.new('ShaderNodeTexImage')
tex.image = paint
mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
mat.node_tree.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])

# ---- one object per piece -----------------------------------------------------------------

bpy.ops.object.select_all(action='DESELECT')
bpy.data.objects.remove(src_obj, do_unlink=True)
root = bpy.data.objects.new('SmithHeartRingCrystal', None)
bpy.context.scene.collection.objects.link(root)
made = []
for i, (kind, ids) in enumerate(groups):
    keep = {f.index for k in ids for f in shells[k]}
    piece = bm.copy()
    piece.faces.ensure_lookup_table()
    drop = [f for f in piece.faces if f.index not in keep]
    bmesh.ops.delete(piece, geom=drop, context='FACES')
    loose = [v for v in piece.verts if not v.link_faces]
    bmesh.ops.delete(piece, geom=loose, context='VERTS')
    centre = Vector((0, 0, 0))
    for v in piece.verts:
        centre += v.co
    centre /= max(1, len(piece.verts))
    piece.transform(Matrix.Translation(-centre))
    me = bpy.data.meshes.new(f'Piece_{i:02d}_{kind}')
    piece.to_mesh(me)
    piece.free()
    me.materials.append(mat)
    # Tripo's split normals (now stale, the mesh was turned and mirrored) go; the shading below
    # rebuilds them from the geometry.
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    ob = bpy.data.objects.new(f'Piece_{i:02d}_{kind}', me)
    ob.location = centre
    ob.parent = root
    bpy.context.scene.collection.objects.link(ob)
    made.append(ob)
bm.free()

# Shading: smooth where the facets are shallow, sharp across the crystal's edges.
for ob in made:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    except Exception as e:  # noqa: BLE001
        print('shade_smooth_by_angle failed', e)
        bpy.ops.object.shade_smooth()
    ob.select_set(False)

print('pieces made', len(made), 'triangles', sum(len(o.data.polygons) for o in made))

# ---- export -------------------------------------------------------------------------------

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
kw = dict(filepath=args.out, export_format='GLB', use_selection=False, export_apply=False,
          export_cameras=False, export_lights=False, export_yup=True)
# The weights and the path ride custom attributes (`_weights` and `_path`, glTF `_WEIGHTS` and
# `_PATH`), never COLOR_0: the exporter's vertex colour rules (material-driven, one default
# white set) are not worth depending on.
kw['export_attributes'] = True
kw['export_vertex_color'] = 'NONE'
bpy.ops.export_scene.gltf(**kw)
print('wrote', args.out, os.path.getsize(args.out), 'bytes')
