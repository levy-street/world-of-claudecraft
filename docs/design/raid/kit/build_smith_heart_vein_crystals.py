"""The vein crystals' Blender step: the four Tripo builds (tmp/arena_crystals/raw/<vein>.glb, one
textured mesh each) made into ONE source GLB for the game
(tmp/arena_crystals/out/smith_heart_vein_crystals_src.glb, shipped by
scripts/assets/specs/smith_heart_vein_crystals.json). Sources and prompts:
docs/design/raid/kit/vein_crystals_src/README.md.

Per vein: the mesh is set in the frame the painter reads (the collar's middle on the origin, its
underside on the floor, its radius 1, front toward -Y here so +Z in glTF), then parted into two
objects: <Vein>_Collar (the ring of slabs, plus a lid over the socket the crystal grows out of, so
the collar alone covers the floor) and <Vein>_Crystal (everything else, roots included: it is hidden
until the guardian dies and grows by its own scale from the floor). The four paintings are laid into
one 1024 atlas, a quadrant each, and every part shares the one material.

Run from the repo root:
  Blender -b --python docs/design/raid/kit/build_smith_heart_vein_crystals.py -- [vein ...]
"""
import os, sys, math
import bpy, bmesh
import numpy as np
from mathutils import Vector

J = os.path.abspath(os.path.join('tmp', 'arena_crystals'))
VEINS = ['hammer', 'breath', 'quench', 'heat']
QUAD = {'hammer': (0, 0), 'breath': (1, 0), 'quench': (0, 1), 'heat': (1, 1)}
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
want = [v for v in VEINS if not argv or v in argv]
ATLAS = 1024
HALF = ATLAS // 2
# The slab ring: a face is the collar's when it lies under the cut and out past this share of the radius.
RING_IN = 0.5
LID_R = 0.66
CORE_R = 0.2

bpy.ops.wm.read_factory_settings(use_empty=True)
atlas = np.zeros((ATLAS, ATLAS, 4), dtype=np.float32)
atlas[:, :, 3] = 1.0
made = []
report = {}


def pixels(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def sample(px, uv):
    h, w = px.shape[:2]
    x = min(w - 1, max(0, int(uv[0] % 1.0 * w)))
    y = min(h - 1, max(0, int(uv[1] % 1.0 * h)))
    return px[y, x, :3]


for vein in want:
    src = os.path.join(J, 'raw', vein + '.glb')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=src)
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for x in [x for x in bpy.data.objects if x not in before and x is not o]:
        bpy.data.objects.remove(x)
    me = o.data
    img = next(n.image for n in me.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    px = pixels(img)

    # ---- the frame: collar centred, on the floor, radius 1 ----
    co = np.array([v.co[:] for v in me.vertices])
    z0, z1 = co[:, 2].min(), co[:, 2].max()
    H = z1 - z0
    low = co[co[:, 2] < z0 + 0.05 * H]
    cx, cy = (low[:, 0].min() + low[:, 0].max()) / 2, (low[:, 1].min() + low[:, 1].max()) / 2
    # Tripo squeezes some builds along one axis (a collar 0.73 by 1.0): the collar is round on every
    # sheet, so each axis is scaled to bring its half width to 1, the height by the gentler of the two.
    hx, hy = (low[:, 0].max() - low[:, 0].min()) / 2, (low[:, 1].max() - low[:, 1].min()) / 2
    kx, ky = 1.0 / hx, 1.0 / hy
    k = min(kx, ky)
    R = max(hx, hy)
    for v in me.vertices:
        v.co = Vector(((v.co.x - cx) * kx, (v.co.y - cy) * ky, (v.co.z - z0) * k))
    me.update()

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    # The slabs' tops: faces turned up, out in the ring, in the lowest part of the model.
    Hn = H * k
    tops = [f for f in bm.faces if f.normal.z > 0.75 and RING_IN < math.hypot(*f.calc_center_median()[:2]) < 1.05
            and f.calc_center_median().z < 0.2 * Hn]
    heights = np.array([f.calc_center_median().z for f in tops])
    areas = np.array([f.calc_area() for f in tops])
    order = np.argsort(heights)
    cum = np.cumsum(areas[order]) / areas.sum()
    z_top = float(heights[order][np.searchsorted(cum, 0.5)])
    z_cut = float(heights[order][np.searchsorted(cum, 0.95)]) + 0.02
    collar_faces = [f for f in bm.faces if max(v.co.z for v in f.verts) <= z_cut
                    and math.hypot(*f.calc_center_median()[:2]) >= RING_IN]
    collar_set = set(collar_faces)
    # Texels for the lid: the slabs' own dark granite, and the collar's lit seam for the socket's core.
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    top_uv = [(lum(sample(px, l[uvl].uv)), tuple(l[uvl].uv)) for f in tops if f in collar_set for l in f.loops]
    top_uv.sort()
    dark_uv = top_uv[int(len(top_uv) * 0.12)][1]
    seam = []
    for f in collar_faces:
        for l in f.loops:
            c = sample(px, l[uvl].uv)
            mx, mn = max(c), min(c)
            seam.append((mx * (mx - mn), tuple(l[uvl].uv)))
    seam.sort()
    bright_uv = seam[int(len(seam) * 0.985)][1]

    def part(name, faces):
        nb = bmesh.new()
        nb.from_mesh(me)
        nb.faces.ensure_lookup_table()
        keep = {f.index for f in faces}
        bmesh.ops.delete(nb, geom=[f for f in nb.faces if f.index not in keep], context='FACES')
        return nb

    cb = part(vein, collar_faces)
    xb = part(vein, [f for f in bm.faces if f not in collar_set])
    # The lid: a low dome over the socket, dark stone with the element's light at its middle.
    cuv = cb.loops.layers.uv.active
    lid_z = z_top - 0.05
    N = 14
    centre = cb.verts.new((0, 0, lid_z + 0.05))
    inner = [cb.verts.new((CORE_R * math.cos(2 * math.pi * i / N), CORE_R * math.sin(2 * math.pi * i / N), lid_z + 0.035)) for i in range(N)]
    outer = [cb.verts.new((LID_R * math.cos(2 * math.pi * i / N), LID_R * math.sin(2 * math.pi * i / N), lid_z)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N
        f = cb.faces.new((centre, inner[i], inner[j]))
        for l in f.loops:
            l[cuv].uv = bright_uv
        f = cb.faces.new((inner[i], outer[i], outer[j], inner[j]))
        for l in f.loops:
            l[cuv].uv = dark_uv
    bmesh.ops.triangulate(cb, faces=cb.faces[:])
    bmesh.ops.recalc_face_normals(cb, faces=cb.faces[:])

    # The slabs' own texels (their UV triangles, in the painting's own layout), for the regrade below.
    mask = np.zeros((HALF, HALF), dtype=bool)
    for f in collar_faces:
        uv = np.array([[l[uvl].uv.x % 1.0, l[uvl].uv.y % 1.0] for l in f.loops]) * HALF
        for i in range(1, len(uv) - 1):
            a_, b_, c_ = uv[0], uv[i], uv[i + 1]
            x0, x1 = int(max(0, np.floor(min(a_[0], b_[0], c_[0])) - 1)), int(min(HALF - 1, np.ceil(max(a_[0], b_[0], c_[0])) + 1))
            y0, y1 = int(max(0, np.floor(min(a_[1], b_[1], c_[1])) - 1)), int(min(HALF - 1, np.ceil(max(a_[1], b_[1], c_[1])) + 1))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (b_[1] - c_[1]) * (a_[0] - c_[0]) + (c_[0] - b_[0]) * (a_[1] - c_[1])
            if abs(d) < 1e-9:
                continue
            w0 = ((b_[1] - c_[1]) * (gx - c_[0]) + (c_[0] - b_[0]) * (gy - c_[1])) / d
            w1 = ((c_[1] - a_[1]) * (gx - c_[0]) + (a_[0] - c_[0]) * (gy - c_[1])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -0.6 / HALF * 60) & (w1 >= -0.6 / HALF * 60) & (w2 >= -0.6 / HALF * 60)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside

    qx, qy = QUAD[vein]
    names = {'collar': vein.capitalize() + '_Collar', 'crystal': vein.capitalize() + '_Crystal'}
    for key, b in (('collar', cb), ('crystal', xb)):
        u = b.loops.layers.uv.active
        for f in b.faces:
            for l in f.loops:
                l[u].uv = ((l[u].uv.x % 1.0 + qx) / 2, (l[u].uv.y % 1.0 + qy) / 2)
        m2 = bpy.data.meshes.new(names[key])
        b.to_mesh(m2)
        b.free()
        ob = bpy.data.objects.new(names[key], m2)
        bpy.context.scene.collection.objects.link(ob)
        for p in m2.polygons:
            p.use_smooth = True
        made.append(ob)
        cc = np.array([v.co[:] for v in m2.vertices])
        report[names[key]] = (len(m2.polygons), np.round(cc.min(0), 3).tolist(), np.round(cc.max(0), 3).tolist())
    bm.free()
    # The painting into its quadrant (2048 -> 512 by block mean).
    h, w = px.shape[:2]
    s = h // HALF
    small = px[:HALF * s, :HALF * s].reshape(HALF, s, HALF, s, 4).mean(axis=(1, 3))
    # Every collar the same dark granite (Tripo painted the Heat's purple in its fire's light): the
    # slabs keep their own value and strokes, cooled to one grey-blue; the lit seams keep their colour.
    rgb = small[:, :, :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    glow = np.clip((mx * (mx - mn) - 0.22) / 0.25, 0, 1)[:, :, None]
    L = (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2])[:, :, None]
    granite = np.clip(L * np.array([0.82, 0.9, 1.16]) * 0.92, 0, 1)
    rgb[mask] = (granite * (1 - glow) + rgb * glow)[mask]
    atlas[qy * HALF:(qy + 1) * HALF, qx * HALF:(qx + 1) * HALF] = small
    report[vein] = dict(R=round(R, 4), squeeze=round(hx / hy, 3), z_top=round(z_top, 3), z_cut=round(z_cut, 3), height=round(Hn, 3), dark=np.round(sample(px, dark_uv), 2).tolist(),
                        bright=np.round(sample(px, bright_uv), 2).tolist())
    bpy.data.objects.remove(o)

# ---- one material, one painting ----
os.makedirs(os.path.join(J, 'out'), exist_ok=True)
aimg = bpy.data.images.new('vein_crystals_paint', ATLAS, ATLAS, alpha=False)
aimg.pixels.foreach_set(atlas.ravel())
aimg.filepath_raw = os.path.join(J, 'out', 'vein_crystals_paint.png')
aimg.file_format = 'PNG'
aimg.save()
mat = bpy.data.materials.new('VeinCrystals')
mat.use_nodes = True
nt = mat.node_tree
pr = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = aimg
nt.links.new(tex.outputs['Color'], pr.inputs['Base Color'])
pr.inputs['Roughness'].default_value = 0.62
pr.inputs['Metallic'].default_value = 0.0
for ob in made:
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob.data.set_sharp_from_angle(angle=math.radians(32))
for x in bpy.data.objects:
    x.select_set(x in made)
bpy.context.view_layer.objects.active = made[0]
out = os.path.join(J, 'out', 'smith_heart_vein_crystals_src.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_animations=False, export_materials='EXPORT', export_image_format='AUTO', export_tangents=False,
                          export_texcoords=True, export_normals=True, export_cameras=False, export_lights=False, export_extras=False,
                          export_vertex_color='NONE', export_attributes=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(J, 'out', 'vein_crystals.blend'))
for k, v in report.items():
    print('REPORT', k, v)
print('WROTE', out, round(os.path.getsize(out) / 1e3), 'KB')
