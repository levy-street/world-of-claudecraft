# Painted WOC armour: the Blender half of paint_armor.mjs (read that header for the whole
# recipe, the inputs and the exact command).
#
# Stages, each its own short headless Blender process so one stage's buffers are gone before
# the next allocates its own:
#
#   bake       import the Blender-ready copy of one set (its medium file, decoded, written by
#              paint_armor.mjs) and bake, in the set's ONE full-layout atlas UVs at the top
#              file's size (Cycles, CPU, Emit, a wide margin): coverage, the painted key
#              (the shading normal and the normal-mapped normal against a key from above and
#              slightly in front, and the up-facing term), ambient occlusion at two reaches,
#              the convex-edge measure (a Bevel-node normal against the shading normal), and
#              the brushwork tile projected triplanar in world space (so its strokes run on
#              across the atlas's UV seams). Every face first gets a `paint_side` attribute
#              (mark_outward_sides): a shell shipped inside out is read from its outer side.
#              Float EXRs.
#   twin       no render: for every texel of a thin plate (a flap, a pauldron's shell: two
#              faces a few millimetres apart), the plate's other side, found by a ray cast into
#              the texel's own shell, and whether the texel's side is the one the camera sees:
#              bake_twin.exr. Skinning bends a flap's two faces apart unevenly, so its inner face
#              pokes through the outer one in a pose, and the inside of a pauldron is a deep
#              crease the paint takes near black; the composite paints a plate's hidden or
#              occluded side like its seen side (composite_armor.py, step 10).
#   composite  numpy only (composite_armor.py): the painted colour atlas at the top file's
#              size, and the low file's when the low layout is the full layout.
#   transfer   for a set whose low file has a layout of its own (the glowing shaman sets):
#              the painted full atlas, sampled through the full layout (TEXCOORD_0), baked
#              into the low layout (TEXCOORD_1 of the Blender copy) at the low file's size,
#              and filled past its margin by the composite's push-pull.
#   render     a look check, never shipped: the set under a warm sun and a cool sky (Eevee,
#              front and back three-quarter and a chest close-up) with the ORIGINAL and the
#              PAINTED colour atlas over the file's own normal and data maps, metal capped and
#              roughness floored as the game draws them.
#
#   blender -b --factory-startup --python bake_armor.py -- <stage> <job.json>
#
# The job JSON is written by paint_armor.mjs. Every step is deterministic: no randomness
# anywhere (Cycles' sampling is seeded the same every run).
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np

# ------------------------------------------------------------------ image io

def load(path):
    """An image file as float32 [H, W, 4], TOP row first, values as stored (no colour
    transform: every map here is handled as data)."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def save(path, arr, fmt='PNG'):
    """Write [H, W, C] (top row first). PNG is 8-bit RGB (or RGBA for 4 channels), OPEN_EXR
    is float RGBA."""
    arr = np.asarray(arr, np.float32)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    h, w, c = arr.shape
    rgba = np.ones((h, w, 4), np.float32)
    if c == 1:
        rgba[:, :, :3] = arr
    else:
        rgba[:, :, :min(c, 4)] = arr[:, :, :4]
    img = bpy.data.images.new('io', w, h, alpha=(c == 4), float_buffer=(fmt == 'OPEN_EXR'))
    img.colorspace_settings.name = 'Non-Color'
    px = rgba[::-1]
    if fmt == 'PNG':
        # round to the byte grid here so the write is exact
        px = np.round(np.clip(px, 0, 1) * 255) / 255
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == 'PNG':
        img.alpha_mode = 'NONE' if c != 4 else 'STRAIGHT'
    img.save()
    bpy.data.images.remove(img)


# ------------------------------------------------------------------ the scene

def import_set(job):
    """Import the Blender-ready copy of the set; drop what the importer adds that is not
    armour (the bone display shape), and return the armour meshes."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job['blenderGlb'])
    scene = bpy.context.scene
    for o in list(scene.objects):
        if o.type == 'MESH' and not o.data.materials:
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in scene.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('no armour mesh in the set')
    # the importer names TEXCOORD_n's layer; every piece must agree (the bake nodes name it)
    layers = {tuple(u.name for u in o.data.uv_layers) for o in meshes}
    if len(layers) != 1:
        raise SystemExit(f'the pieces carry different UV layers: {layers}')
    names = next(iter(layers))
    job['uvFull'] = names[0]
    job['uvLow'] = names[1] if len(names) > 1 else None
    return scene, meshes


def textured(job, material):
    """Whether a Blender material is one of the file's atlas materials (the importer may add
    a .001 suffix to a repeated name)."""
    if material is None:
        return False
    name = material.name
    for want in job['atlasMaterials']:
        if name == want or (name.startswith(want + '.') and name[len(want) + 1:].isdigit()):
            return True
    return False


def world_box(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = np.full(3, 1e9)
    hi = np.full(3, -1e9)
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        m = np.array(ev.matrix_world, np.float64)
        w = co @ m[:3, :3].T + m[:3, 3]
        lo = np.minimum(lo, w.min(0))
        hi = np.maximum(hi, w.max(0))
        ev.to_mesh_clear()
    return lo, hi


def new_float_image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 0)
    return img


def data_image(path, name):
    img = bpy.data.images.load(path)
    img.name = name
    img.colorspace_settings.name = 'Non-Color'
    return img


class Nodes:
    """A thin helper over a material node tree."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()

    def new(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def value(self, v):
        n = self.new('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def vec(self, xyz):
        n = self.new('ShaderNodeCombineXYZ')
        for i, v in enumerate(xyz):
            n.inputs[i].default_value = v
        return n.outputs[0]

    def math(self, op, a, b=None, c=None):
        n = self.new('ShaderNodeMath', operation=op)
        for i, x in enumerate((a, b, c)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                self.link(x, n.inputs[i])
        return n.outputs[0]

    def vmath(self, op, a, b=None):
        n = self.new('ShaderNodeVectorMath', operation=op)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (tuple, list)):
                n.inputs[i].default_value = x
            else:
                self.link(x, n.inputs[i])
        return n.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else n.outputs['Vector']

    def unit(self, x):
        """[-1, 1] to [0, 1]."""
        return self.math('MULTIPLY_ADD', x, 0.5, 0.5)

    def rgb(self, r, g, b):
        n = self.new('ShaderNodeCombineColor', mode='RGB')
        for i, x in enumerate((r, g, b)):
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                self.link(x, n.inputs[i])
        return n.outputs[0]


def bake_material(job, target, mode, imgs):
    """The armour's bake material for one pass: an Emission whose colour carries that pass's
    measures, the target image the active node."""
    mat = bpy.data.materials.new(f'paintbake_{mode}')
    N = Nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    emit = N.new('ShaderNodeEmission')
    N.link(emit.outputs['Emission'], out.inputs['Surface'])
    geo = N.new('ShaderNodeNewGeometry')
    n_raw = geo.outputs['Normal']
    # the face's side (mark_outward_sides): +1 out, -1 for an inside-out face, so every
    # measure reads the normal a double-sided draw shows the viewer
    side = N.new('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name='paint_side')
    s = side.outputs['Fac']
    flip = N.new('ShaderNodeVectorMath', operation='SCALE')
    N.link(n_raw, flip.inputs[0])
    N.link(s, flip.inputs['Scale'])
    n_geo = flip.outputs['Vector']
    p = job['paintBake']
    key = np.array(p['keyDir'], np.float64)
    key = tuple((key / np.linalg.norm(key)).tolist())
    if mode == 'cover':
        emit.inputs['Color'].default_value = (1, 1, 1, 1)
    elif mode == 'frame':
        uv = N.new('ShaderNodeUVMap', uv_map=job['uvFull'])
        ntex = N.new('ShaderNodeTexImage', image=imgs['normal'], interpolation='Linear',
                     extension='EXTEND')
        N.link(uv.outputs['UV'], ntex.inputs['Vector'])
        nmap = N.new('ShaderNodeNormalMap', space='TANGENT', uv_map=job['uvFull'])
        N.link(ntex.outputs['Color'], nmap.inputs['Color'])
        # an inside-out face keeps its relief and turns its base normal out: the mapped
        # normal reflected across the face's plane, mapped - (1 - side) (mapped . n) n
        n_mapped = nmap.outputs['Normal']
        along = N.math('MULTIPLY', N.math('SUBTRACT', 1.0, s), N.vmath('DOT_PRODUCT', n_mapped, n_raw))
        back = N.new('ShaderNodeVectorMath', operation='SCALE')
        N.link(n_raw, back.inputs[0])
        N.link(along, back.inputs['Scale'])
        n_map = N.vmath('SUBTRACT', n_mapped, back.outputs['Vector'])
        k_geo = N.unit(N.vmath('DOT_PRODUCT', n_geo, key))
        k_map = N.unit(N.vmath('DOT_PRODUCT', n_map, key))
        up = N.unit(N.vmath('DOT_PRODUCT', n_geo, (0.0, 0.0, 1.0)))
        N.link(N.rgb(k_geo, k_map, up), emit.inputs['Color'])
    elif mode == 'occl':
        aos = []
        for dist in (p['aoShort'], p['aoLong']):
            ao = N.new('ShaderNodeAmbientOcclusion', samples=p['aoSamples'], inside=False,
                       only_local=False)
            ao.inputs['Distance'].default_value = dist
            N.link(n_geo, ao.inputs['Normal'])
            aos.append(ao.outputs['AO'])
        bev = N.new('ShaderNodeBevel', samples=p['bevelSamples'])
        bev.inputs['Radius'].default_value = p['bevelRadius']
        # the bevel leans off the stored normal the same way on either side of a face
        edge = N.math('MULTIPLY', N.vmath('LENGTH', N.vmath('SUBTRACT', bev.outputs['Normal'], n_raw)), 0.5)
        N.link(N.rgb(aos[0], aos[1], edge), emit.inputs['Color'])
    elif mode == 'brush':
        # triplanar in world space at one scale for every piece: the strokes run on across
        # the atlas's UV seams instead of breaking at every island
        pos = N.vmath('SCALE', geo.outputs['Position'])
        pos.node.inputs['Scale'].default_value = 1.0 / p['brushTileUnits']
        sep = N.new('ShaderNodeSeparateXYZ')
        N.link(pos, sep.inputs[0])
        nrm = N.new('ShaderNodeSeparateXYZ')
        N.link(n_geo, nrm.inputs[0])
        axes = (('Y', 'Z', 'X'), ('X', 'Z', 'Y'), ('X', 'Y', 'Z'))
        acc = None
        wsum = None
        for i, (a, b, n_axis) in enumerate(axes):
            c = N.new('ShaderNodeCombineXYZ')
            N.link(sep.outputs[a], c.inputs[0])
            N.link(sep.outputs[b], c.inputs[1])
            # each face of the box reads the tile at its own offset (no visible mirror seam)
            c.inputs[2].default_value = 0.0
            off = N.vmath('ADD', c.outputs[0], (0.37 * i, 0.61 * i, 0.0))
            t = N.new('ShaderNodeTexImage', image=imgs['brush'], interpolation='Linear',
                      extension='REPEAT')
            N.link(off, t.inputs['Vector'])
            w = N.math('POWER', N.math('ABSOLUTE', nrm.outputs[n_axis]), p['brushBlendPower'])
            term = N.math('MULTIPLY', t.outputs['Color'], w)
            acc = term if acc is None else N.math('ADD', acc, term)
            wsum = w if wsum is None else N.math('ADD', wsum, w)
        val = N.math('DIVIDE', acc, N.math('MAXIMUM', wsum, 1e-4))
        N.link(N.rgb(val, val, val), emit.inputs['Color'])
    elif mode == 'transfer':
        uv = N.new('ShaderNodeUVMap', uv_map=job['uvFull'])
        t = N.new('ShaderNodeTexImage', image=imgs['painted'], interpolation='Closest',
                  extension='EXTEND')
        N.link(uv.outputs['UV'], t.inputs['Vector'])
        N.link(t.outputs['Color'], emit.inputs['Color'])
    else:
        raise SystemExit(f'unknown bake mode {mode}')
    tgt = N.new('ShaderNodeTexImage', image=target)
    N.nt.nodes.active = tgt
    return mat


def skip_material(dummy):
    mat = bpy.data.materials.new('skip')
    N = Nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    emit = N.new('ShaderNodeEmission')
    N.link(emit.outputs['Emission'], out.inputs['Surface'])
    tgt = N.new('ShaderNodeTexImage', image=dummy)
    N.nt.nodes.active = tgt
    return mat


def assign(job, meshes, mat, skip):
    for o in meshes:
        for i, m in enumerate(o.data.materials):
            o.data.materials[i] = mat if job['_textured'][o.name][i] else skip


def setup_cycles(scene, job):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.cycles.seed = 0
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = int(job.get('threads', 5))
    scene.render.bake.margin_type = 'ADJACENT_FACES'


def run_bake(scene, meshes, target, w, h, samples, margin, out_path, uv_layer=''):
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='EMIT', margin=margin, use_clear=True, uv_layer=uv_layer)
    a = np.empty(w * h * 4, np.float32)
    target.pixels.foreach_get(a)
    arr = a.reshape(h, w, 4)[::-1].copy()
    save(out_path, arr, fmt='OPEN_EXR')
    return arr


def mark_outward_sides(meshes, reach, eps=2e-4):
    """Give every face a `paint_side` attribute: +1 where its normal points out of its piece,
    -1 where it points in. Some shipped pieces are wound and shaded inside out (the female
    warrior's boots, gauntlets and shoulders): the game draws every armour material double
    sided, which turns their normals to the viewer, but a bake has no viewer, so an inside-out
    face would take the key from below and its occlusion from inside its own shell. Decided
    per connected shell by an area-weighted vote of rays cast both ways off each face: a face
    whose normal ray escapes and whose reverse ray meets geometry votes out, the opposite votes
    in; a thin open sheet (both escape) does not vote. Returns {object name: [shells, flipped]}."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    bms = []
    verts = []
    polys = []
    for o in meshes:
        # object space, so a face's normal is the one the renderer derives (a mirrored piece's
        # normals go through the inverse transpose below, never off a re-wound world mesh)
        bm = bmesh.new()
        bm.from_object(o, dg)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        m = o.matrix_world
        base = len(verts)
        verts.extend(m @ v.co for v in bm.verts)
        polys.extend(tuple(base + v.index for v in f.verts) for f in bm.faces)
        bms.append(bm)
    tree = BVHTree.FromPolygons(verts, polys)
    report = {}
    for o, bm in zip(meshes, bms):
        if len(bm.faces) != len(o.data.polygons):
            raise SystemExit(f'{o.name}: the evaluated mesh has other faces')
        shell = [-1] * len(bm.faces)
        shells = 0
        for f in bm.faces:
            if shell[f.index] >= 0:
                continue
            stack = [f]
            shell[f.index] = shells
            while stack:
                g = stack.pop()
                for e in g.edges:
                    for h in e.link_faces:
                        if shell[h.index] < 0:
                            shell[h.index] = shells
                            stack.append(h)
            shells += 1
        vote = [0.0] * shells
        m = o.matrix_world
        nm = m.to_3x3().inverted_safe().transposed()
        for f in bm.faces:
            n = (nm @ f.normal).normalized()
            c = m @ f.calc_center_median()
            out_hit = tree.ray_cast(c + n * eps, n, reach)[0] is not None
            in_hit = tree.ray_cast(c - n * eps, -n, reach)[0] is not None
            if in_hit and not out_hit:
                vote[shell[f.index]] += f.calc_area()
            elif out_hit and not in_hit:
                vote[shell[f.index]] -= f.calc_area()
        side = [1.0 if vote[shell[i]] >= 0 else -1.0 for i in range(len(bm.faces))]
        attr = o.data.attributes.get('paint_side') or o.data.attributes.new('paint_side', 'FLOAT', 'FACE')
        attr.data.foreach_set('value', side)
        report[o.name] = [shells, sum(1 for v in vote if v < 0)]
        bm.free()
    return report


def remember_textured(job, meshes):
    job['_textured'] = {o.name: [textured(job, m) for m in o.data.materials] for o in meshes}
    if not any(any(v) for v in job['_textured'].values()):
        raise SystemExit('no atlas material found on the set')


def stage_bake(job):
    scene, meshes = import_set(job)
    remember_textured(job, meshes)
    setup_cycles(scene, job)
    sides = mark_outward_sides(meshes, job['paintBake']['sideReach'])
    print('SIDES ' + json.dumps(sides), flush=True)
    lo, hi = world_box(meshes)
    W, H = job['atlasSize']
    target = new_float_image('target', W, H)
    dummy = new_float_image('dummy', 8, 8)
    skip = skip_material(dummy)
    imgs = {
        'normal': data_image(job['normalPng'], 'normal_atlas'),
        'brush': data_image(job['brushPng'], 'brush_tile'),
    }
    p = job['paintBake']
    passes = [
        ('cover', 4, 0),
        ('frame', p['frameSamples'], p['margin']),
        ('occl', p['occlSamples'], p['margin']),
        ('brush', p['brushSamples'], p['margin']),
    ]
    for mode, samples, margin in passes:
        mat = bake_material(job, target, mode, imgs)
        assign(job, meshes, mat, skip)
        run_bake(scene, meshes, target, W, H, samples, margin,
                 os.path.join(job['work'], f'bake_{mode}.exr'))
        print(f'baked {mode} {W}x{H} samples {samples} margin {margin}', flush=True)
    json.dump({'box': [lo.tolist(), hi.tolist()], 'objects': [o.name for o in meshes],
               'sides': sides, 'stamp': job['bakeStamp']},
              open(os.path.join(job['work'], 'bake.json'), 'w'), indent=1)


def stage_twin(job):
    """bake_twin.exr at the full layout's size (top row first): for each texel of a thin plate
    (a flap, a pauldron's shell: two faces a few millimetres apart), RG the texel (column, row:
    centre coordinates) of the plate's other side, B the gap to it, A the texel's triangle's
    visibility vote (-1 its side is seen, +1 hidden) plus 2 on a skinned piece or 5 on a rigid
    one (a helm, a pauldron: their two faces cannot part, but a pauldron's inside can still be
    a near-black crease); A 0: no plate. A ray leaves the
    texel's surface point into its own shell (against the outward normal, `paint_side`
    applied), or failing that the other way (a sheet wound the other way round), and must meet,
    within twin.reach, a face of the same piece lying near parallel to it. A side counts as seen
    when its ray onward, away from the plate, leaves the whole set (twin.escape): the inner face
    of a flap looks at the skirt behind it, the outer face at open air; each triangle takes the
    vote of its texels. The composite decides which side takes the other's paint (the vote and
    the occlusion together, composite_armor.py step 10)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    scene, meshes = import_set(job)
    mark_outward_sides(meshes, job['paintBake']['sideReach'])
    W, H = job['atlasSize']
    reach = job['twin']['reach']
    escape = job['twin']['escape']
    out = np.zeros((H, W, 4), np.float32)
    dg = bpy.context.evaluated_depsgraph_get()
    pieces = []
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        m = ev.matrix_world
        nm = m.to_3x3().inverted_safe().transposed()
        side = o.data.attributes['paint_side'].data
        uvl = me.uv_layers[job['uvFull']].data
        co = [m @ v.co for v in me.vertices]
        tris = me.loop_triangles
        pieces.append({
            'rigid': not any(md.type == 'ARMATURE' for md in o.modifiers),
            'P': np.array([[co[i][:] for i in t.vertices] for t in tris], np.float64).reshape(-1, 3, 3),
            # texel space, rows from the top
            'U': np.array([[(uvl[li].uv[0] * W, (1 - uvl[li].uv[1]) * H) for li in t.loops] for t in tris],
                          np.float64).reshape(-1, 3, 2),
            'N': np.array([((nm @ me.polygons[t.polygon_index].normal).normalized()
                            * side[t.polygon_index].value)[:] for t in tris], np.float64).reshape(-1, 3),
        })
        ev.to_mesh_clear()

    def bvh(ps):
        tri = np.concatenate([q['P'] for q in ps]) if ps else np.zeros((0, 3, 3))
        return BVHTree.FromPolygons([Vector(v) for v in tri.reshape(-1, 3)],
                                    [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(tri))])

    whole = bvh(pieces)
    hidden = 0
    plates = 0
    for q in pieces:
        P, U, N = q['P'], q['U'], q['N']
        base = 5.0 if q['rigid'] else 2.0
        own = bvh([q])
        for i in range(len(P)):
            a, b, c = U[i]
            x0, x1 = int(np.floor(min(a[0], b[0], c[0]))), int(np.ceil(max(a[0], b[0], c[0])))
            y0, y1 = int(np.floor(min(a[1], b[1], c[1]))), int(np.ceil(max(a[1], b[1], c[1])))
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
            area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
            if x1 < x0 or y1 < y0 or abs(area) < 1e-12:
                continue
            ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
            px, py = xs + 0.5, ys + 0.5
            w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area
            w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            n = Vector(N[i])
            twins = []
            vote = 0
            for yy, xx, q0, q1, q2 in zip(ys[inside], xs[inside], w0[inside], w1[inside], w2[inside]):
                p = Vector(q0 * P[i, 0] + q1 * P[i, 1] + q2 * P[i, 2])
                # into the shell first; a sheet wound the other way round has its twin outward
                for ray in (-n, n):
                    hit, _, j, dist = own.ray_cast(p + ray * 1e-5, ray, reach)
                    if hit is not None and j != i and abs(float(np.dot(N[j], N[i]))) > 0.3:
                        break
                else:
                    continue
                # the seen side looks out of the whole set, away from the plate
                seen_self = whole.ray_cast(p - ray * 1e-4, -ray, escape)[0] is None
                seen_twin = whole.ray_cast(hit + ray * 1e-4, ray, escape)[0] is None
                vote += int(seen_twin and not seen_self) - int(seen_self and not seen_twin)
                # the hit's barycentric weights in its triangle, then its texel
                A, B, C = (Vector(P[j, k]) for k in range(3))
                v0, v1, v2 = B - A, C - A, hit - A
                d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
                d20, d21 = v2.dot(v0), v2.dot(v1)
                den = d00 * d11 - d01 * d01
                if abs(den) < 1e-18:
                    continue
                s = (d11 * d20 - d01 * d21) / den
                t = (d00 * d21 - d01 * d20) / den
                twins.append((yy, xx, (1 - s - t) * U[j, 0] + s * U[j, 1] + t * U[j, 2], dist))
            plates += len(twins)
            # a triangle's visibility is the vote of its texels (a strap hanging in front of a
            # flap blocks a few of the seen side's rays: the triangle still decides)
            share = vote / max(len(twins), 1)
            hidden += len(twins) if share > 0 else 0
            for yy, xx, tx, dist in twins:
                out[yy, xx] = (tx[0], tx[1], dist, base + share)
    save(os.path.join(job['work'], 'bake_twin.exr'), out, fmt='OPEN_EXR')
    json.dump({'stamp': job['twinStamp'], 'plateTexels': plates, 'hiddenTexels': hidden},
              open(os.path.join(job['work'], 'twin.json'), 'w'), indent=1)
    print(f'twin {W}x{H}: {plates} texels of a thin plate, {hidden} of them voted hidden', flush=True)


def stage_transfer(job):
    """The painted full atlas into the low layout (TEXCOORD_1), at the low file's size."""
    scene, meshes = import_set(job)
    remember_textured(job, meshes)
    setup_cycles(scene, job)
    if not job['uvLow']:
        raise SystemExit('the Blender copy carries no low layout (TEXCOORD_1)')
    for o in meshes:
        # the bake writes through the ACTIVE layer: the low layout
        o.data.uv_layers.active = o.data.uv_layers[job['uvLow']]
    w, h = job['lowSize']
    target = new_float_image('target', w, h)
    dummy = new_float_image('dummy', 8, 8)
    skip = skip_material(dummy)
    imgs = {'painted': data_image(job['paintedFullPng'], 'painted')}
    mat = bake_material(job, target, 'transfer', imgs)
    assign(job, meshes, mat, skip)
    # the full atlas is twice the low one's size: sixteen samples per texel average a 2 x 2
    # footprint, the box filter the identical-layout sets take
    arr = run_bake(scene, meshes, target, w, h, 16, job['paintBake']['lowMargin'],
                   os.path.join(job['work'], 'bake_transfer.exr'), uv_layer=job['uvLow'])
    # past the margin the target is empty: fill it from the islands beside it (the same
    # push-pull the composite fills its light terms with), so no mip pulls black in
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import composite_armor
    baked = (arr[..., 3] > 0.5).astype(np.float32)
    rgb = composite_armor.push_pull(np.clip(arr[..., :3], 0, 1), baked)
    save(os.path.join(job['out'], 'low.png'), rgb)
    print(f'baked transfer {w}x{h}, {baked.mean():.4f} of it baked', flush=True)


# ------------------------------------------------------------------ render (look check)

def game_material(job, name, color_img, normal_img, data_img):
    """A Principled material close to what the game draws: the colour atlas, the normal map,
    roughness from the data atlas's green floored the way the runtime floors it, metal from
    its blue capped at the runtime's cap, and the data red as occlusion on the colour."""
    r = job['render']
    mat = bpy.data.materials.new(name)
    N = Nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    N.link(bsdf.outputs['BSDF'], out.inputs['Surface'])
    uv = N.new('ShaderNodeUVMap', uv_map=job['uvFull'])
    col = N.new('ShaderNodeTexImage', image=color_img, interpolation='Linear')
    nrm = N.new('ShaderNodeTexImage', image=normal_img, interpolation='Linear')
    dat = N.new('ShaderNodeTexImage', image=data_img, interpolation='Linear')
    for t in (col, nrm, dat):
        N.link(uv.outputs['UV'], t.inputs['Vector'])
    N.link(col.outputs['Color'], bsdf.inputs['Base Color'])
    nm = N.new('ShaderNodeNormalMap', space='TANGENT', uv_map=job['uvFull'])
    N.link(nrm.outputs['Color'], nm.inputs['Color'])
    N.link(nm.outputs['Normal'], bsdf.inputs['Normal'])
    sep = N.new('ShaderNodeSeparateColor', mode='RGB')
    N.link(dat.outputs['Color'], sep.inputs[0])
    metal = N.math('MULTIPLY', sep.outputs['Blue'], r['metalCap'])
    N.link(metal, bsdf.inputs['Metallic'])
    floor = N.math('MULTIPLY_ADD', sep.outputs['Blue'], r['metalRoughFloor'] - r['roughFloor'], r['roughFloor'])
    N.link(N.math('MAXIMUM', sep.outputs['Green'], floor), bsdf.inputs['Roughness'])
    return mat


def stage_render(job):
    scene, meshes = import_set(job)
    remember_textured(job, meshes)
    r = job['render']
    lo, hi = world_box(meshes)
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = r['size'][0]
    scene.render.resolution_y = r['size'][1]
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.eevee.taa_render_samples = 32
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*r['skyColor'], 1)
    bg.inputs['Strength'].default_value = r['skyStrength']
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = r['sunEnergy']
    sun_data.color = r['sunColor']
    sun_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new('sun', sun_data)
    scene.collection.objects.link(sun)
    d = np.array(r['sunDir'], np.float64)
    d /= np.linalg.norm(d)
    # a sun shines along its local -Z: aim -Z at -d (the light travels from d toward the set)
    sun.rotation_euler = mathutils.Vector(d.tolist()).to_track_quat('Z', 'Y').to_euler()
    fill_data = bpy.data.lights.new('fill', 'SUN')
    fill_data.energy = r['fillEnergy']
    fill_data.color = r['fillColor']
    fill = bpy.data.objects.new('fill', fill_data)
    scene.collection.objects.link(fill)
    fd = np.array(r['fillDir'], np.float64)
    fd /= np.linalg.norm(fd)
    fill.rotation_euler = mathutils.Vector(fd.tolist()).to_track_quat('Z', 'Y').to_euler()
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    height = float(hi[2] - lo[2])
    width = float(hi[0] - lo[0])
    full_scale = max(height, width * r['size'][1] / r['size'][0]) * 1.06
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    normal_img = data_image(job['normalPng'], 'normal_atlas')
    data_img = data_image(job['dataPng'], 'data_atlas')
    looks = {}
    for tag, path in job['renderLooks'].items():
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = 'sRGB'
        looks[tag] = game_material(job, f'look_{tag}', img, normal_img, data_img)
    for tag, mat in looks.items():
        for o in meshes:
            for i, m in enumerate(o.data.materials):
                if job['_textured'][o.name][i]:
                    o.data.materials[i] = mat
        for view, (az, share, at) in r['views'].items():
            a = math.radians(az)
            cam_data.ortho_scale = full_scale * share
            centre = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2] + height * at])
            # the set faces -Y; azimuth 0 is straight in front, positive to the set's left
            dist = height * 4
            cam.location = (centre[0] + dist * math.sin(a), centre[1] - dist * math.cos(a),
                            centre[2] + dist * math.tan(math.radians(r['elevation'])))
            look_at = mathutils.Vector(centre.tolist()) - cam.location
            cam.rotation_euler = look_at.to_track_quat('-Z', 'Y').to_euler()
            scene.render.filepath = os.path.join(job['renderDir'], f"{job['set']}_{tag}_{view}.png")
            bpy.ops.render.render(write_still=True)
            print('rendered', scene.render.filepath, flush=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    stage, job_path = argv[0], argv[1]
    job = json.load(open(job_path))
    if stage == 'bake':
        stage_bake(job)
    elif stage == 'twin':
        stage_twin(job)
    elif stage == 'transfer':
        stage_transfer(job)
    elif stage == 'render':
        stage_render(job)
    elif stage == 'composite':
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import composite_armor  # the numpy stage lives beside this file
        composite_armor.run(job)
    else:
        raise SystemExit(f'unknown stage {stage}')
