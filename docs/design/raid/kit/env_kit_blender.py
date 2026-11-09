"""The painted kits' shared Blender build (the Breath's build_smith_heart_breath_env_kit.py
and the Quench's build_smith_heart_quench_env_kit.py): the kit's root and its painted
materials, low-poly pieces whose faces are box-projected onto a tiling painting, the Tripo
builds stood on the kit's frame, the Tex_* carrier quads and the export.

Every Env_* node is one piece; the runtime bakes each on its own (src/render/smith_heart/
env_kit_bake.ts). A material is named PREFIX + its painting: the prefix routes the base
colour to UASTC (scripts/assets/lib/glb_texture_compression_core.mjs), since painted art
loses its strokes under ETC1S, and the runtime reads the painting's name past it.
Deterministic: every draw is the piece's own seeded rng.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

PREFIX = 'tripo_material_env_'


class EnvKit:
    """One kit being built: its root node, its paintings (tex/<name>.png under `src`) and
    the yards one repeat of each tiling painting covers on the low-poly pieces."""

    def __init__(self, src, root_name, tile):
        self.src = src
        self.root_name = root_name
        self.tile = tile
        self.root = None
        self.mats = {}

    def reset(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.mats = {}
        self.root = bpy.data.objects.new(self.root_name, None)
        bpy.context.scene.collection.objects.link(self.root)

    def material(self, name):
        m = self.mats.get(name)
        if m:
            return m
        m = bpy.data.materials.new(PREFIX + name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Roughness'].default_value = 0.95
        bsdf.inputs['Metallic'].default_value = 0.0
        image = bpy.data.images.load(os.path.join(self.src, 'tex', f'{name}.png'))
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        m.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        self.mats[name] = m
        return m

    def piece(self, name, seed):
        return Piece(self, name, seed)

    def node(self, name):
        node = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(node)
        node.parent = self.root
        return node

    def import_mesh(self, name):
        """A Tripo build's one mesh in world space (the frame Tripo gave it, its other
        objects dropped), turned so its front (Tripo's +X) faces -Y."""
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(self.src, 'models', f'{name}.glb'))
        new = [o for o in bpy.data.objects if o not in before]
        mesh_ob = next(o for o in new if o.type == 'MESH')
        mesh_ob.parent = None
        bpy.context.view_layer.update()
        me = mesh_ob.data
        world = mesh_ob.matrix_world.copy()
        me.transform(world)
        mesh_ob.matrix_world = Matrix.Identity(4)
        me.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
        for o in new:
            if o is not mesh_ob:
                bpy.data.objects.remove(o)
        return mesh_ob

    def finish_tripo(self, mesh_ob, name, target, far_ratio=None):
        """A placed Tripo mesh closed, painted with its graded atlas and hung under its own
        Env_* node (and, with `far_ratio`, a decimated copy under <target>Far)."""
        me = mesh_ob.data
        close_mesh(me)
        me.update()
        me.materials.clear()
        me.materials.append(self.material(name))
        for p in me.polygons:
            p.use_smooth = True
        node = self.node(target)
        mesh_ob.name = f'{target}_{name}'
        mesh_ob.parent = node
        if far_ratio:
            far = mesh_ob.copy()
            far.data = me.copy()
            bpy.context.scene.collection.objects.link(far)
            far.name = f'{target}Far_{name}'
            dec = far.modifiers.new('dec', 'DECIMATE')
            dec.ratio = far_ratio
            bpy.context.view_layer.objects.active = far
            far.select_set(True)
            bpy.ops.object.modifier_apply(modifier=dec.name)
            far.select_set(False)
            far.parent = self.node(f'{target}Far')
        return node

    def import_tripo(self, name, target, width=None, height=None, centred=False, far_ratio=None):
        """A Tripo build stood on the kit's frame: the front turned to -Y, foot on z 0,
        centred on x and either its front plane on y 0 (a rock) or centred on y (a
        standing stone), `width` yards across or `height` yards tall; its base colour the
        graded atlas, its PBR maps dropped (the paint carries the light)."""
        mesh_ob = self.import_mesh(name)
        me = mesh_ob.data
        mn, mx = bounds(me)
        s = width / (mx.x - mn.x) if width else height / (mx.z - mn.z)
        y0 = -(mn.y + mx.y) / 2 if centred else -mn.y
        me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-(mn.x + mx.x) / 2, y0, -mn.z)))
        return self.finish_tripo(mesh_ob, name, target, far_ratio)

    def tex_quad(self, name, mat):
        p = self.piece(name, 1)
        p.add_face(mat, [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)])
        p.build()

    def export(self, out):
        bpy.ops.export_scene.gltf(
            filepath=out,
            export_format='GLB',
            export_apply=True,
            export_yup=True,
            export_extras=True,
            export_image_format='WEBP',
        )
        print('WROTE', out)


def bounds(me):
    co = [v.co for v in me.vertices]
    mn = Vector((min(c[k] for c in co) for k in range(3)))
    mx = Vector((max(c[k] for c in co) for k in range(3)))
    return mn, mx


class Piece:
    """Accumulates faces per material, each face with a box-projected UV. A tiling
    painting tiles across but not up a face's height (masonry courses do not line up top
    to bottom), so a face's v offset keeps the whole face inside one repeat."""

    def __init__(self, kit, name, seed):
        self.kit = kit
        self.name = name
        self.rng = random.Random(seed)
        self.parts = {}

    def add_face(self, mat, verts, uvs=None):
        self.parts.setdefault(mat, []).append((verts, uvs))

    def quad_uv(self, verts, mat, off):
        t = self.kit.tile[mat]
        n = (Vector(verts[1]) - Vector(verts[0])).cross(Vector(verts[-1]) - Vector(verts[0]))
        a = max(range(3), key=lambda k: abs(n[k]))
        raw = []
        for v in verts:
            if a == 2:
                raw.append((v[0] / t, v[1] / t))
            elif a == 1:
                raw.append((v[0] / t, v[2] / t))
            else:
                raw.append((v[1] / t, v[2] / t))
        lo = min(u[1] for u in raw)
        hi = max(u[1] for u in raw)
        # The v span placed wholly inside [0, 1] at the face's own offset.
        room = max(0.0, 1.0 - (hi - lo))
        dv = off[1] * room - lo
        return [(u[0] + off[0], u[1] + dv) for u in raw]

    def box(self, mat, c, s, jitter=0.0, taper=0.0, top=None, rot=0.0):
        """A box: centre, size, each corner moved a little, the top shrunk; `top` paints
        the upward face with another painting (a coping's stone)."""
        r = self.rng
        off = (r.random(), r.random())
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        cr, sr = math.cos(rot), math.sin(rot)
        corners = []
        for sz in (-1, 1):
            k = 1 - (taper if sz > 0 else 0)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                x = sx * hx * k + r.uniform(-jitter, jitter)
                y = sy * hy * k + r.uniform(-jitter, jitter)
                corners.append(Vector((
                    c[0] + x * cr - y * sr,
                    c[1] + x * sr + y * cr,
                    c[2] + sz * hz + r.uniform(-jitter, jitter) * 0.6,
                )))
        faces = [
            ((0, 3, 2, 1), mat),  # bottom
            ((4, 5, 6, 7), top or mat),  # top
            ((0, 1, 5, 4), mat),
            ((1, 2, 6, 5), mat),
            ((2, 3, 7, 6), mat),
            ((3, 0, 4, 7), mat),
        ]
        for idx, m in faces:
            vs = [tuple(corners[i]) for i in idx]
            self.add_face(m, vs, self.quad_uv(vs, m, off))

    def build(self):
        node = self.kit.node(self.name)
        for mat, faces in self.parts.items():
            mesh = bpy.data.meshes.new(f'{self.name}_{mat}')
            verts, polys, loops = [], [], []
            for vs, uvs in faces:
                base = len(verts)
                verts.extend(vs)
                polys.append(tuple(range(base, base + len(vs))))
                loops.extend(uvs if uvs else [(0, 0)] * len(vs))
            mesh.from_pydata(verts, [], polys)
            mesh.update()
            uv = mesh.uv_layers.new(name='UVMap')
            for i, l in enumerate(loops):
                uv.data[i].uv = l
            for p in mesh.polygons:
                p.use_smooth = False
            mesh.materials.append(self.kit.material(mat))
            ob = bpy.data.objects.new(f'{self.name}_{mat}', mesh)
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = node
        return node


def close_mesh(me):
    """A Tripo build's cut seams left as gaps the eye sees through: weld the seams,
    fill what stays open (each new face takes its neighbours' paint) and turn every
    face out, so a piece is one solid from every side."""
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.02)
    open_edges = [e for e in bm.edges if e.is_boundary]
    made = bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)['faces']
    new = set(made)
    for f in made:
        for loop in f.loops:
            other = next((o for o in loop.vert.link_loops if o.face not in new), None)
            if other and uv:
                loop[uv].uv = other[uv].uv
    bmesh.ops.triangulate(bm, faces=made)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    left = sum(1 for e in bm.edges if e.is_boundary)
    print(f'CLOSED {me.name}: {len(open_edges)} open edges, {len(made)} fills, {left} left, {len(bm.faces)} faces')
    bm.to_mesh(me)
    bm.free()
