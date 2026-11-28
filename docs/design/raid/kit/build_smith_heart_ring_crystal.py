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
  - cut into the pieces the burst throws apart, each its own node with its centre as the
    node's translation: the plinth in six sectors, the white-gold heart's shaft, and the
    crystal's own PRISMS, each the element its faces mostly carry (the owner's calls of
    2026-11-18: chunks of each element's crystal floating, and solid crystals, not flat poly
    faces). Tripo's thousand "shells" are only its UV seams: welded, the crystal is a dozen
    solids, and its skin parts into prisms at the inward folds where one prism meets the next
    (`--seam-deg`), so each piece keeps its painted faces and only its base, where it joined
    the rest, is capped (in one colour of the painting round it, as is every hole Tripo
    left). Their union is the crystal; the renderer merges them for the whole crystal's one
    draw.

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
ap.add_argument('--seam-deg', type=float, default=14.0)
ap.add_argument('--paint-size', type=int, default=1024)
ap.add_argument('--min-prism', type=float, default=4.0)
ap.add_argument('--probe-segments', default='')
ap.add_argument('--crown-r', type=float, default=0.15)
ap.add_argument('--crown-z', type=float, default=0.4)
ap.add_argument('--debug-dir', default='')
args = ap.parse_args(argv)

# The veins' bearings (degrees clockwise from north) in the sim's compass: the Hammer's light
# arrives from the south, the Breath's from the north, the Quench's from the east, the Heat's
# from the west (heart_seal_core.ts HEART_SEAL_QUARTERS). The weights' channel order.
VEIN_BEARINGS = (('hammer', 180.0), ('breath', 0.0), ('quench', 90.0), ('heat', 270.0))
ELEMENTS = [name for name, _ in VEIN_BEARINGS]

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

# ---- the solids ---------------------------------------------------------------------------

# Tripo writes its UV seams as separate shells (over a thousand of them); welded, the crystal is
# a dozen solids: the plinth's slab, the heart's shaft, a few fused formations of crystals and
# the loose crystals round them. The UVs stay on the face corners, so the painting is untouched.
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4 * height)
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


# The plinth: the low slab every crystal stands on. The heart: the tall shaft on the axis.
# Everything else is crystal, each face given to an element below.
plinth_ids, heart_ids, body_ids = [], [], []
for i, (c, _) in enumerate(infos):
    r = math.hypot(c.x, c.y)
    top = shell_top(shells[i])
    if top < 0.12 * height:
        plinth_ids.append(i)
    elif max(math.hypot(v.co.x, v.co.y) for f in shells[i] for v in f.verts) <= 0.4 * reach and top >= 0.72 * height:
        # The heart: a tall solid that never leaves the axis (a formation of crystals can
        # stand its centre near the axis too, but it spreads to the plinth's rim).
        heart_ids.append(i)
    else:
        body_ids.append(i)
heart_verts = {v.index for i in heart_ids for f in shells[i] for v in f.verts}
print('solids:', len(shells), 'plinth', len(plinth_ids), 'heart', len(heart_ids), 'crystal', len(body_ids))
if args.debug_dir:
    for i in sorted(range(len(infos)), key=lambda i: -infos[i][1]):
        c, a = infos[i]
        zs = [v.co.z for f in shells[i] for v in f.verts]
        rs = [math.hypot(v.co.x, v.co.y) for f in shells[i] for v in f.verts]
        print(f'  solid {i}: area {a:.1f} faces {len(shells[i])} centre r {math.hypot(c.x, c.y):.2f} z {c.z:.1f} z-span {min(zs):.1f}-{max(zs):.1f} max r {max(rs):.2f}')


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

# ---- the pieces: the plinth's sectors, the heart, each element's prisms ---------------------

bm.faces.ensure_lookup_table()
face_area = {f.index: f.calc_area() for f in bm.faces}
face_centre = {f.index: f.calc_center_median() for f in bm.faces}

# Every crystal face's element: the one its corners weigh most (the painting's hue where it
# carries one, its side of the compass where it does not, so a pale frosted ice crystal on the
# east is still the Quench's).
body_faces = [f for i in body_ids for f in shells[i]]
label = {}
for f in body_faces:
    w = [0.0, 0.0, 0.0, 0.0]
    for v in f.verts:
        wv = v[wlayer]
        for k in range(4):
            w[k] += wv[k]
    label[f.index] = max(range(4), key=lambda k: w[k])
# Speckle out: a face takes the element most of its neighbours carry (its own counts twice).
for _ in range(4):
    nxt = {}
    for f in body_faces:
        votes = [0, 0, 0, 0]
        votes[label[f.index]] += 2
        for e in f.edges:
            for g in e.link_faces:
                if g is not f and g.index in label:
                    votes[label[g.index]] += 1
        nxt[f.index] = max(range(4), key=lambda k: votes[k])
    label = nxt
if args.debug_dir:
    for i in body_ids:
        hist = [0, 0, 0, 0]
        for f in shells[i]:
            hist[label[f.index]] += 1
        print(f'  solid {i} faces per element hammer/breath/quench/heat: {hist}')


def angle_about(c, mean):
    """A face centre's bearing round the axis, relative to `mean` (degrees, -180 to 180)."""
    return (bearing_of(c.x, c.y) - mean + 180.0) % 360.0 - 180.0


# ---- the crystal's prisms: its skin split at the folds ---------------------------------------
# Tripo paints its crystals as one skin (a fused formation is one surface over many prisms),
# so a chunk cut along colour reads as a jagged flat sheet once it flies (the owner's review of
# 2026-11-18). The burst's chunks are cut along the crystal's own FOLDS instead: an edge whose
# neighbour face stands in front of it (an inward crease, sharper than `--seam-deg`) is where
# one prism meets the next, so the skin floods into its prisms across every other edge.
bm.normal_update()
seam_cos = math.cos(math.radians(args.seam_deg))


def fold(e):
    if len(e.link_faces) != 2:
        return True
    f1, f2 = e.link_faces
    if f1.index not in label or f2.index not in label:
        return True
    if f1.normal.dot(f2.normal) > seam_cos:
        return False
    return f1.normal.dot(face_centre[f2.index] - face_centre[f1.index]) > 1e-6


seg_of = {}
segments = []
for f in body_faces:
    if f.index in seg_of:
        continue
    stack = [f]
    comp = []
    while stack:
        a = stack.pop()
        if a.index in seg_of:
            continue
        seg_of[a.index] = len(segments)
        comp.append(a.index)
        for e in a.edges:
            if fold(e):
                continue
            for g in e.link_faces:
                if g.index in label and g.index not in seg_of:
                    stack.append(g)
    segments.append(comp)
# A shard too small to fly alone (a sliver, or a few big flat faces that would read as a lone
# polygon) joins the neighbour it shares the most edge with.
for _ in range(60):
    area_of = [sum(face_area[fi] for fi in comp) for comp in segments]
    small = [n for n in range(len(segments)) if segments[n] and (area_of[n] < args.min_prism or len(segments[n]) < 24)]
    if not small:
        break
    moved = False
    for n in small:
        if not segments[n]:
            continue
        border = {}
        for fi in segments[n]:
            for e in bm.faces[fi].edges:
                for g in e.link_faces:
                    m = seg_of.get(g.index)
                    if m is not None and m != n and segments[m]:
                        border[m] = border.get(m, 0) + 1
        if not border:
            continue
        to = max(border, key=lambda m: (border[m], -m))
        for fi in segments[n]:
            seg_of[fi] = to
        segments[to] = segments[to] + segments[n]
        segments[n] = []
        moved = True
    if not moved:
        break
segments = [comp for comp in segments if comp]
seg_of = {fi: n for n, comp in enumerate(segments) for fi in comp}
seg_area = [sum(face_area[fi] for fi in comp) for comp in segments]
print('prisms:', len(segments), 'areas', sorted((round(a, 1) for a in seg_area), reverse=True)[:30])

if args.probe_segments:
    # The prisms pulled apart, each its own flat colour (Workbench), from four sides.
    os.makedirs(args.probe_segments, exist_ok=True)
    pm = bpy.data.meshes.new('probe')
    pb = bmesh.new()
    pcol = pb.loops.layers.float_color.new('seg')
    vmap = {}
    for n, comp in enumerate(segments):
        cen = sum((face_centre[fi] * face_area[fi] for fi in comp), Vector((0, 0, 0))) / max(1e-9, seg_area[n])
        flat = Vector((cen.x, cen.y, 0.0))
        off = flat.normalized() * 4.0 if flat.length > 0.1 else Vector((0, 0, 0))
        off.z = 0.25 * cen.z
        rgb = colorsys.hsv_to_rgb((n * 0.61803) % 1.0, 0.75, 0.95)
        for fi in comp:
            f = bm.faces[fi]
            vs = []
            for v in f.verts:
                key = (n, v.index)
                if key not in vmap:
                    vmap[key] = pb.verts.new(v.co + off)
                vs.append(vmap[key])
            try:
                nf = pb.faces.new(vs)
            except ValueError:
                continue
            for lo in nf.loops:
                lo[pcol] = (rgb[0], rgb[1], rgb[2], 1.0)
    pb.to_mesh(pm)
    pm.color_attributes.active_color = pm.color_attributes['seg']
    pm.color_attributes.render_color_index = list(pm.color_attributes.keys()).index('seg')
    pob = bpy.data.objects.new('probe', pm)
    bpy.context.scene.collection.objects.link(pob)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'VERTEX'
    sc.display.shading.show_backface_culling = False
    sc.render.resolution_x = 800
    sc.render.resolution_y = 640
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.02, 0.02, 0.05)
    cd = bpy.data.cameras.new('cam')
    cd.type = 'ORTHO'
    cd.ortho_scale = 34
    cam = bpy.data.objects.new('cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    mid = Vector((0, 0, 8))
    for view, d in (('S', (0, 1)), ('E', (1, 0)), ('N', (0, -1)), ('W', (-1, 0))):
        cam.location = mid + Vector((d[0] * 60, d[1] * 60, 18))
        cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(args.probe_segments, f'{view}.png')
        bpy.ops.render.render(write_still=True)
    sys.exit(0)

groups = []
# The plinth in six sectors round the axis.
plinth_faces = [f.index for i in plinth_ids for f in shells[i]]
for k in range(6):
    sector = [fi for fi in plinth_faces if int(((bearing_of(face_centre[fi].x, face_centre[fi].y) + 30.0) % 360.0) // 60.0) == k]
    if sector:
        groups.append(('plinth', None, sector))
# Each prism is one piece of the burst, the element its faces mostly carry; an element's prisms
# in order round its own bearing (so they keep their places side by side as they settle).
bearings = {name: deg for name, deg in VEIN_BEARINGS}
prisms = []
for comp in segments:
    votes = [0.0, 0.0, 0.0, 0.0]
    for fi in comp:
        votes[label[fi]] += face_area[fi]
    lab = max(range(4), key=lambda k: votes[k])
    area = sum(face_area[fi] for fi in comp)
    cen = sum((face_centre[fi] * face_area[fi] for fi in comp), Vector((0, 0, 0))) / max(1e-9, area)
    prisms.append((lab, angle_about(cen, bearings[ELEMENTS[lab]]), comp))
for lab, _, comp in sorted(prisms, key=lambda p: (p[0], p[1])):
    groups.append(('body', ELEMENTS[lab], comp))
heart = [f.index for i in heart_ids for f in shells[i]]
if heart:
    groups.append(('heart', None, heart))
print('pieces:', [(kind, el, len(g), round(sum(face_area[fi] for fi in g), 1)) for kind, el, g in groups])

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

# ---- one object per piece, every opening capped ------------------------------------------


def paint_at(uv):
    px = min(pw - 1, max(0, int(uv.x * pw)))
    py = min(ph - 1, max(0, int(uv.y * ph)))
    return blur[py, px]


def cap(piece):
    """Close every opening of a piece (its cuts, and the holes Tripo left) so it reads as a
    solid once it flies: each run of open edges is walked into a loop and fanned from a new
    vertex at its middle (Tripo's mesh carries non-manifold edges, so the openings are not
    always clean loops; a run that dead-ends is fanned as it stands). A cap is one colour: the
    texel round its rim nearest the rim's mean colour (a broken crystal shows its own colour
    inside); its middle vertex carries the rim's mean weights and path. Returns (caps made,
    open edges left)."""
    uvl = piece.loops.layers.uv.active
    wl = piece.verts.layers.float_color['_weights']
    pl = piece.verts.layers.float['_path']
    open_edges = {e for e in piece.edges if len(e.link_faces) == 1}
    if not open_edges:
        return 0, 0
    at = {}
    for e in open_edges:
        for v in e.verts:
            at.setdefault(v, []).append(e)
    used = set()
    caps = 0
    for start_e in sorted(open_edges, key=lambda e: e.index):
        if start_e in used:
            continue
        # Walk a run of open edges: at each vertex take an unused open edge, until the run
        # closes or dead-ends.
        used.add(start_e)
        a, b = start_e.verts
        ring = [a, b]
        cur = b
        while True:
            nxt = [e for e in at[cur] if e not in used]
            if not nxt:
                break
            e = min(nxt, key=lambda e: e.index)
            used.add(e)
            cur = e.other_vert(cur)
            if cur is ring[0]:
                break
            ring.append(cur)
        if len(ring) < 3:
            continue
        mid = Vector((0, 0, 0))
        for v in ring:
            mid += v.co
        mid /= len(ring)
        uvs = []
        for v in ring:
            for lo in v.link_loops:
                uvs.append(lo[uvl].uv.copy())
                break
        cols = [paint_at(uv) for uv in uvs]
        mean_col = sum(cols) / len(cols)
        uv = uvs[min(range(len(uvs)), key=lambda j: float(((cols[j] - mean_col) ** 2).sum()))]
        c = piece.verts.new(mid)
        wsum = [0.0, 0.0, 0.0, 0.0]
        psum = 0.0
        for v in ring:
            for k in range(4):
                wsum[k] += v[wl][k]
            psum += v[pl]
        c[wl] = tuple(x / len(ring) for x in wsum)
        c[pl] = psum / len(ring)
        closed = ring[0] in [e.other_vert(ring[-1]) for e in at[ring[-1]]]
        pairs = list(zip(ring, ring[1:])) + ([(ring[-1], ring[0])] if closed else [])
        for p, q in pairs:
            try:
                f = piece.faces.new((c, q, p))
            except ValueError:
                continue
            for lo in f.loops:
                lo[uvl].uv = uv
        caps += 1
    return caps, sum(1 for e in piece.edges if len(e.link_faces) == 1)


bpy.ops.object.select_all(action='DESELECT')
bpy.data.objects.remove(src_obj, do_unlink=True)
root = bpy.data.objects.new('SmithHeartRingCrystal', None)
bpy.context.scene.collection.objects.link(root)
made = []
open_left = 0
for i, (kind, element, keep_ids) in enumerate(groups):
    keep = set(keep_ids)
    piece = bm.copy()
    piece.faces.ensure_lookup_table()
    drop = [f for f in piece.faces if f.index not in keep]
    bmesh.ops.delete(piece, geom=drop, context='FACES')
    loose = [v for v in piece.verts if not v.link_faces]
    bmesh.ops.delete(piece, geom=loose, context='VERTS')
    caps, left = cap(piece)
    open_left += left
    centre = Vector((0, 0, 0))
    for v in piece.verts:
        centre += v.co
    centre /= max(1, len(piece.verts))
    piece.transform(Matrix.Translation(-centre))
    name = f'Piece_{i:02d}_{kind}' + (f'_{element}' if element else '')
    me = bpy.data.meshes.new(name)
    piece.to_mesh(me)
    piece.free()
    me.materials.append(mat)
    # Tripo's split normals (now stale, the mesh was turned and mirrored) go; the shading below
    # rebuilds them from the geometry.
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    ob = bpy.data.objects.new(name, me)
    ob.location = centre
    ob.parent = root
    bpy.context.scene.collection.objects.link(ob)
    made.append(ob)
    print(f'  {name}: {len(me.polygons)} faces, {caps} caps, {left} open edges left')
bm.free()
print('open edges left over all pieces:', open_left)

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

# The painting ships at `--paint-size` (1024: the owner's call of 2026-11-18, a 2048 painting
# on one centrepiece was half its megabyte); the weights and the caps read it at full size above.
if paint and max(paint.size) > args.paint_size:
    paint.scale(args.paint_size, args.paint_size)
    print('painting scaled to', tuple(paint.size))

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
