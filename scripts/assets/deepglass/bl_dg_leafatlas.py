# Render the Deepglass foliage atlas from REAL needle geometry instead of
# painting it (SPACEY, 2026-09-19: "these are cooked ... cook up some truely nice
# semi realistic leaves for the atlas"). An analytic brush pass can fake a
# silhouette but not the way light falls along a needle or the depth of a spray
# where near needles cross far ones, up close its blades read as aloe, not
# spruce. So: build a conifer spray out of thousands of tiny needle meshes,
# light it, and render it orthographically to a transparent 512 cell.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python \
#       scripts/assets/deepglass/bl_dg_leafatlas.py -- <out_dir>
#   python3 scripts/assets/deepglass/make_tree_atlas.py      # composites them
#
# Cells rendered (one PNG each): tuft_a/b/c, spire, frond, and snow twins.
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
os.makedirs(OUT, exist_ok=True)

R = 512
# The spray is modelled in a box this wide/tall and shot dead-on, so one
# Blender unit maps to a fixed number of pixels in every cell.
BOX = 2.0

NEEDLE_DARK = (0.055, 0.085, 0.062, 1)
NEEDLE_LIT = (0.075, 0.125, 0.078, 1)
WOOD = (0.10, 0.075, 0.055, 1)
SNOW_COL = (0.82, 0.87, 0.92, 1)


def leaf_material():
    m = bpy.data.materials.new('leaf')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    c = nt.nodes.new('ShaderNodeVertexColor')
    c.layer_name = 'Color'
    nt.links.new(c.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.52
    b.inputs['Metallic'].default_value = 0.0
    return m


def scene_reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.render.resolution_x = R
    sc.render.resolution_y = R
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    return sc


def mat(name, base, rough=0.55, translucent=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = base
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0.0
    if translucent and 'Transmission Weight' in b.inputs:
        b.inputs['Transmission Weight'].default_value = 0.0
    return m


# The War Within reference (Alex Creamer's broadleaf set) is not needles: it is
# dense sprigs of small rounded leaves on visible twigs, in greens that range
# from deep shadow to bright yellow-green within one cluster. That variation is
# the whole look, so every leaf carries its own vertex colour.
LEAF_GREENS = [
    (0.075, 0.130, 0.050), (0.120, 0.205, 0.068), (0.180, 0.290, 0.090),
    (0.250, 0.375, 0.112), (0.330, 0.470, 0.140), (0.420, 0.560, 0.180),
]


def leaf_mesh(bm, clay, base, direction, length, width, up, col, tilt):
    """One leaf: a small pointed oval, flat, tilted out of the sprig's plane so
    a cluster catches light at many angles instead of reading as one card."""
    d = direction.normalized()
    side = d.cross(up)
    if side.length < 1e-5:
        side = d.cross(Vector((1, 0, 0)))
    side.normalize()
    # roll the blade around its own axis so leaves face many ways
    side = (Matrix.Rotation(tilt, 3, d) @ side)
    verts = []
    # a six-point oval: narrow at the stalk, widest at 45%, pointed at the tip
    for t, w in ((0.0, 0.10), (0.25, 0.85), (0.55, 1.0), (0.8, 0.72), (1.0, 0.0)):
        p = base + d * length * t
        if w <= 0.001:
            verts.append([bm.verts.new(p)])
        else:
            verts.append([bm.verts.new(p + side * width * w),
                          bm.verts.new(p - side * width * w)])
    for i in range(len(verts) - 1):
        a, b = verts[i], verts[i + 1]
        f = bm.faces.new((a[0], b[0], a[1])) if len(b) == 1 else \
            bm.faces.new((a[0], b[0], b[1], a[1]))
        for lp in f.loops:
            lp[clay] = (col[0], col[1], col[2], 1.0)


def twig(bm, root, direction, length, radius):
    d = direction.normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    s = d.cross(up).normalized()
    k = s.cross(d).normalized()
    rings = []
    for i in range(4):
        t = i / 3
        p = root + d * length * t
        r = radius * (1 - t * 0.75)
        rings.append([bm.verts.new(p + s * math.cos(a) * r + k * math.sin(a) * r)
                      for a in (0, 2.09, 4.19)])
    for i in range(3):
        for j in range(3):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % 3],
                          rings[i + 1][(j + 1) % 3], rings[i + 1][j]))


def spray(rng, spine_len, side_count, side_len, needle_len, droop, spread=1.0):
    """A conifer spray lying roughly in the XZ plane: a main twig, side twigs,
    and needles set in a spiral around every twig so the spray has real depth."""
    bmw = bmesh.new()
    bmn = bmesh.new()
    clay = bmn.loops.layers.color.new('Color')
    up = Vector((0, 1, 0))

    def clothe(root, d, length, nlen):
        n = max(14, int(length / (nlen * 0.19)))
        for i in range(n):
            t = (i + 0.5) / n
            p = root + d * length * t
            # spiral phyllotaxis around the twig, flattened toward the plane
            ang = i * 2.399
            side = d.cross(up)
            if side.length < 1e-5:
                side = d.cross(Vector((1, 0, 0)))
            side.normalize()
            k = side.cross(d).normalized()
            out = (side * math.cos(ang) + k * math.sin(ang) * 0.42).normalized()
            # leaves stand OUT from the twig and lift slightly, the way a
            # broadleaf sprig carries them
            nd = (out * 0.95 + d * 0.38).normalized()
            ln = nlen * rng.uniform(0.62, 1.15)
            col = LEAF_GREENS[min(len(LEAF_GREENS) - 1,
                                  int(abs(rng.gauss(0.5, 0.26)) * len(LEAF_GREENS)))]
            leaf_mesh(bmn, clay, p, nd, ln, ln * rng.uniform(0.26, 0.36), up, col,
                      rng.uniform(-1.2, 1.2))

    main_d = Vector((0, 0, -1))
    twig(bmw, Vector((0, 0, 0)), main_d, spine_len, 0.012)
    clothe(Vector((0, 0, 0)), main_d, spine_len, needle_len)
    for i in range(side_count):
        t = 0.1 + 0.85 * (i / max(1, side_count - 1))
        root = main_d * spine_len * t
        for sgn in (-1, 1):
            if rng.random() < 0.12:
                continue
            a = rng.uniform(0.55, 1.0) * spread
            d = Vector((math.sin(a) * sgn, rng.uniform(-0.22, 0.22),
                        -math.cos(a) * droop)).normalized()
            ln = side_len * (1.05 - t * 0.55) * rng.uniform(0.82, 1.18)
            twig(bmw, root, d, ln, 0.008)
            clothe(root, d, ln, needle_len)
    return bmw, bmn


def build_cell(name, seed, kind, snow):
    sc = scene_reset()
    rng = random.Random(seed)
    if kind == 'spire':
        bmw, bmn = spray(rng, 1.4, 10, 0.46, 0.2, 0.3, spread=0.85)
    elif kind == 'frond':
        bmw, bmn = spray(rng, 1.0, 9, 0.72, 0.22, 0.6, spread=1.3)
    else:
        lens = {'a': (1.4, 12, 0.6), 'b': (1.25, 10, 0.54), 'c': (1.05, 8, 0.48)}[kind]
        bmw, bmn = spray(rng, lens[0], lens[1], lens[2], 0.21, 0.7)
    objs = []
    for bm, m, nm in ((bmw, mat('wood', WOOD, 0.8), 'w'), (bmn, leaf_material(), 'n')):
        me = bpy.data.meshes.new(nm)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(nm, me)
        o.data.materials.append(m)
        sc.collection.objects.link(o)
        objs.append(o)
    if snow:
        # a thin snow shell over the needle mass, pushed up against gravity
        src = objs[1]
        sn = src.copy()
        sn.data = src.data.copy()
        sn.data.materials.clear()
        sn.data.materials.append(mat('snow', SNOW_COL, 0.75))
        sn.location = (0, -0.012, 0.018)
        sn.scale = (1.015, 0.55, 1.015)
        sc.collection.objects.link(sn)
        objs.append(sn)
    # ORTHOGRAPHIC, dead-on: the cell must be a flat cut-out with no perspective
    cam_d = bpy.data.cameras.new('c')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = BOX
    cam = bpy.data.objects.new('c', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    # the spray hangs from the origin downward; frame it
    cam.location = (0, -4, -BOX * 0.42)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    key = bpy.data.lights.new('k', 'AREA')
    key.energy = 520
    key.size = 4
    ko = bpy.data.objects.new('k', key)
    sc.collection.objects.link(ko)
    ko.location = (2.2, -3.2, 2.4)
    ko.rotation_euler = (0.85, 0.2, 0.62)
    fill = bpy.data.lights.new('f', 'AREA')
    fill.energy = 130
    fill.size = 6
    fo = bpy.data.objects.new('f', fill)
    sc.collection.objects.link(fo)
    fo.location = (-2.6, -3.0, -1.2)
    fo.rotation_euler = (-0.5, -0.4, -0.5)
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.58, 0.66, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    sc.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('LEAFCELL', name)


CELLS = [
    ('tuft_a', 31, 'a', False),
    ('tuft_b', 32, 'b', False),
    ('tuft_c', 33, 'c', False),
    ('spire', 34, 'spire', False),
    ('tuft_a_snow', 31, 'a', True),
    ('tuft_b_snow', 32, 'b', True),
    ('spire_snow', 34, 'spire', True),
    ('frond', 36, 'frond', False),
]
for nm, sd, kd, sn in CELLS:
    build_cell(nm, sd, kd, sn)
print('LEAFATLAS done')
