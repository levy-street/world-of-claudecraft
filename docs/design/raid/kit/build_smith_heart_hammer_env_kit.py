"""The Hammer vein rebuilt from the owner's painted style guide: low-poly pieces
whose painted textures carry the look (docs/design/raid/smith_heart.md, the
Hammer vein's painted rebuild).

  Blender -b --factory-startup --python build_smith_heart_hammer_env_kit.py -- \
      --src tmp/hammer_env --out tmp/hammer_env/smith_heart_hammer_env_kit_components.glb

--src holds models/<name>.glb (the Tripo P2 builds from ChatGPT FRONT, LEFT and
BACK sheets) and tex/<name>.png (the ChatGPT paintings, already sized:
scripts/assets/smith_heart_hammer_env_kit/prepare_sources.mjs).

Every Env_* node is one piece. A rock piece stands with its foot on z 0, its
front plane on y 0 facing Blender -Y (the game's +Z) and its body behind it; an
edge module runs along X with its origin on the lip. The pieces are measured by
HAMMER_ENV_PIECES (src/render/smith_heart/hammer_env_plan_core.ts) and pinned
against the shipped GLB. Tex_* nodes carry the floors' and the sky's paintings.
Deterministic: every draw is the piece's own seeded rng.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def arg(flag):
    argv = sys.argv[sys.argv.index('--') + 1:]
    return argv[argv.index(flag) + 1]


SRC = os.path.abspath(arg('--src'))
OUT = os.path.abspath(arg('--out'))

# The material prefix routes the base colour to UASTC
# (scripts/assets/lib/glb_texture_compression_core.mjs): painted art loses its
# strokes under ETC1S.
PREFIX = 'tripo_material_env_'
MATERIALS = {
    'cliff_tall': 'cliff_tall.png',
    'cliff_wide': 'cliff_wide.png',
    'outcrop': 'outcrop.png',
    'arcade': 'arcade.png',
    'block': 'block.png',
    'cliff': 'cliff.png',
    'iron': 'iron.png',
    'banner': 'banner.png',
    'paving': 'paving.png',
    'arena': 'arena.png',
    'moss': 'moss.png',
    'sky': 'sky.png',
    'paving_n': 'paving_n.png',
    'arena_n': 'arena_n.png',
}
# Yards one repeat of a tile covers.
TILE = {'block': 13.0, 'cliff': 7.0, 'iron': 2.5, 'moss': 5.0, 'paving': 4.5}

root = None
mats = {}


def reset():
    global root
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('SmithHeartHammerEnvKit_ROOT', None)
    bpy.context.scene.collection.objects.link(root)


def material(name):
    m = mats.get(name)
    if m:
        return m
    m = bpy.data.materials.new(PREFIX + name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.95
    bsdf.inputs['Metallic'].default_value = 0.0
    image = bpy.data.images.load(os.path.join(SRC, 'tex', MATERIALS[name]))
    node = m.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    m.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    if name == 'banner':
        m.node_tree.links.new(node.outputs['Alpha'], bsdf.inputs['Alpha'])
        m.blend_method = 'CLIP'
    mats[name] = m
    return m


def glow_material():
    m = mats.get('glow')
    if m:
        return m
    m = bpy.data.materials.new('KitGlow')
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (1.0, 0.45, 0.12, 1)
    mats['glow'] = m
    return m


class Piece:
    """Accumulates faces per material, each face with a box-projected UV."""

    def __init__(self, name, seed):
        self.name = name
        self.rng = random.Random(seed)
        self.parts = {}

    def add_face(self, mat, verts, uvs=None):
        self.parts.setdefault(mat, []).append((verts, uvs))

    def quad_uv(self, verts, mat, off):
        t = TILE[mat]
        n = (Vector(verts[1]) - Vector(verts[0])).cross(Vector(verts[-1]) - Vector(verts[0]))
        a = max(range(3), key=lambda k: abs(n[k]))
        out = []
        for v in verts:
            if a == 2:
                out.append((v[0] / t + off[0], v[1] / t + off[1]))
            elif a == 1:
                out.append((v[0] / t + off[0], v[2] / t + off[1]))
            else:
                out.append((v[1] / t + off[0], v[2] / t + off[1]))
        return out

    def box(self, mat, c, s, jitter=0.0, taper=0.0, rot=None):
        """A box: centre, size, each corner moved a little, the top shrunk."""
        r = self.rng
        off = (r.random(), r.random())
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        corners = []
        for sz in (-1, 1):
            k = 1 - (taper if sz > 0 else 0)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = Vector((
                    sx * hx * k + r.uniform(-jitter, jitter),
                    sy * hy * k + r.uniform(-jitter, jitter),
                    sz * hz + r.uniform(-jitter, jitter),
                ))
                if rot:
                    p = rot @ p
                corners.append(tuple(p + Vector(c)))
        faces = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
        for f in faces:
            vs = [corners[i] for i in f]
            self.add_face(mat, vs, self.quad_uv(vs, mat, off))

    def prism(self, mat, c, radius, height, sides=8, taper=0.0, jag=0.0, rot=None):
        """An upright n-sided drum; `jag` breaks its top into a rough edge."""
        r = self.rng
        off = (r.random(), r.random())
        t = TILE[mat]
        lo, hi = [], []
        for i in range(sides):
            a = i / sides * math.tau
            ca, sa = math.cos(a), math.sin(a)
            lo.append(Vector((ca * radius, sa * radius, -height / 2)))
            hi.append(Vector((
                ca * radius * (1 - taper),
                sa * radius * (1 - taper),
                height / 2 + (r.uniform(-jag, jag) if jag else 0),
            )))
        if rot:
            lo = [rot @ p for p in lo]
            hi = [rot @ p for p in hi]
        lo = [tuple(p + Vector(c)) for p in lo]
        hi = [tuple(p + Vector(c)) for p in hi]
        perim = radius * math.tau
        for i in range(sides):
            j = (i + 1) % sides
            u0 = i / sides * perim / t + off[0]
            u1 = (i + 1) / sides * perim / t + off[0]
            v0 = off[1]
            v1 = height / t + off[1]
            self.add_face(mat, [lo[i], lo[j], hi[j], hi[i]], [(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        cap_uv = [
            (math.cos(i / sides * math.tau) * radius / t + 0.5, math.sin(i / sides * math.tau) * radius / t + 0.5)
            for i in range(sides)
        ]
        self.add_face(mat, list(hi), cap_uv)
        self.add_face(mat, list(reversed(lo)), list(reversed(cap_uv)))

    def link(self, mat, c, along, up, length, width, thick, sides=3):
        """One chain link: an oval ring of `thick` square-ish section."""
        along = Vector(along).normalized()
        up = Vector(up).normalized()
        n = along.cross(up)
        ring = 6
        rings = []
        for i in range(ring):
            a = i / ring * math.tau
            cen = Vector(c) + along * math.cos(a) * length / 2 + up * math.sin(a) * width / 2
            out = (along * math.cos(a) + up * math.sin(a)).normalized()
            section = []
            for k in range(sides):
                b = k / sides * math.tau
                section.append(tuple(cen + out * math.cos(b) * thick + n * math.sin(b) * thick))
            rings.append(section)
        off = (self.rng.random(), self.rng.random())
        for i in range(ring):
            j = (i + 1) % ring
            for k in range(sides):
                m = (k + 1) % sides
                vs = [rings[i][k], rings[i][m], rings[j][m], rings[j][k]]
                self.add_face(mat, vs, self.quad_uv(vs, mat, off))

    def rubble(self, mat, c, radius, flat=0.75):
        """A chunk of stone: a jittered low icosphere."""
        r = self.rng
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
        off = (r.random(), r.random())
        for v in bm.verts:
            v.co *= r.uniform(0.75, 1.15)
            v.co.z *= flat
        for f in bm.faces:
            vs = [tuple(v.co + Vector(c)) for v in f.verts]
            self.add_face(mat, vs, self.quad_uv(vs, mat, off))
        bm.free()

    def build(self):
        node = bpy.data.objects.new(self.name, None)
        bpy.context.scene.collection.objects.link(node)
        node.parent = root
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
            mesh.materials.append(glow_material() if mat == 'glow' else material(mat))
            ob = bpy.data.objects.new(f'{self.name}_{mat}', mesh)
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = node
        return node


# ---- the Tripo pieces -------------------------------------------------------------


def close_mesh(me):
    """A Tripo build's cut seams left as gaps the eye sees through: weld the seams,
    fill what stays open (each new face takes its neighbours' paint) and turn every
    face out, so a rock is one solid from every side."""
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


def import_tripo(name, mat, width, far_ratio=None, target=None):
    """A Tripo build stood on the kit's frame: the front (Tripo's +X) turned to
    -Y, foot on z 0, front plane on y 0, width `width` yards; its base colour the
    sized painting, its PBR maps dropped (the paint carries the light)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, 'models', f'{name}.glb'))
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
    co = [v.co for v in me.vertices]
    mn = Vector((min(c[k] for c in co) for k in range(3)))
    mx = Vector((max(c[k] for c in co) for k in range(3)))
    s = width / (mx.x - mn.x)
    # Foot on z 0, centred on x, the most forward point on y 0.
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-(mn.x + mx.x) / 2, -mn.y, -mn.z)))
    close_mesh(me)
    me.update()
    me.materials.clear()
    me.materials.append(material(mat))
    for p in me.polygons:
        p.use_smooth = True
    node = bpy.data.objects.new(target or f'Env_{name}', None)
    bpy.context.scene.collection.objects.link(node)
    node.parent = root
    mesh_ob.name = f'{node.name}_{mat}'
    mesh_ob.parent = node
    if far_ratio:
        far = mesh_ob.copy()
        far.data = me.copy()
        bpy.context.scene.collection.objects.link(far)
        far.name = f'{node.name}Far_{mat}'
        dec = far.modifiers.new('dec', 'DECIMATE')
        dec.ratio = far_ratio
        bpy.context.view_layer.objects.active = far
        far.select_set(True)
        bpy.ops.object.modifier_apply(modifier=dec.name)
        far.select_set(False)
        node_far = bpy.data.objects.new(f'{node.name}Far', None)
        bpy.context.scene.collection.objects.link(node_far)
        node_far.parent = root
        far.parent = node_far
    return node


def tex_quad(name, mat):
    p = Piece(name, 1)
    p.add_face(mat, [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [(0, 0), (1, 0), (1, 1), (0, 1)])
    p.build()


# ---- the masonry the plan walks along the terraces ------------------------------


def course(p, mat, x0, x1, y0, y1, z0, z1, blocks):
    """A row of cut blocks between x0 and x1, each its own height and proudness."""
    r = p.rng
    edges = [x0]
    for i in range(1, blocks):
        edges.append(x0 + (x1 - x0) * (i + r.uniform(-0.22, 0.22)) / blocks)
    edges.append(x1)
    for a, b in zip(edges, edges[1:]):
        proud = r.uniform(0, 0.1)
        top = z1 + r.uniform(-0.05, 0.05)
        p.box(mat, ((a + b) / 2, (y0 + y1) / 2 - proud / 2, (z0 + top) / 2), (b - a, y1 - y0 + proud, top - z0), jitter=0.035)


def tier(name, seed, broken=False, aisle=False):
    """A terrace riser cut as the amphitheatre's seats: the steps run forward
    (game +Z, Blender -Y) over the step below, which nobody walks."""
    p = Piece(name, seed)
    r = p.rng
    drop, steps, reach = 7.4, 3, 4.2
    h = drop / steps
    d = reach / steps
    half = 4.8
    for i in range(steps):
        z0 = -drop + i * h
        front = -(reach - d * i)
        if aisle:
            for a, b in ((-half, -1.25), (1.25, half)):
                course(p, 'block', a, b, front, 3.2, z0 - 0.2, z0 + h, 2)
        else:
            if broken and r.random() < 0.3:
                # A run of seats fallen away, the rock behind it showing.
                course(p, 'cliff', -half, half, front + d, 3.2, z0 - 0.2, z0 + h * 0.6, 3)
                p.rubble('block', (r.uniform(-3, 3), front + 0.2, z0 + 0.3), r.uniform(0.5, 0.8))
                continue
            course(p, 'block', -half, half, front, 3.2, z0 - 0.2, z0 + h, 4)
        # The seat's worn nosing, overhanging its riser: its underside is the
        # line of shade that draws each seat from the arena's floor below.
        p.box('paving', (0, front - 0.02, z0 + h - 0.09), (2 * half, 0.86, 0.26), jitter=0.04)
        # Painted shade cut in under the nosing: from the arena's floor the treads
        # are out of sight, and this dark line is what draws each seat.
        p.box('iron', (0, front + 0.02, z0 + h - 0.42), (2 * half, 0.1, 0.42))
        p.box('paving', (0, (front + d + 3.2) / 2, z0 + h + 0.01), (2 * half, 3.2 - front - d, 0.02))
    if aisle:
        # The stair down the middle: twice the steps, a little sunk.
        for i in range(steps * 2):
            z0 = -drop + i * h / 2
            front = -(reach - d * i / 2)
            p.box('block', (0, (front + 3.2) / 2, z0 + h / 4 - 0.1), (2.5, 3.2 - front, h / 2 + 0.2), jitter=0.02)
    p.build()


def rim(name, seed, split=False):
    """The pit's retaining wall: coursed cut stone, flush with the lip (nothing
    proud of the pit's floor past a hand), under a capping course."""
    p = Piece(name, seed)
    drop, half = 7.4, 4.8
    rows = 4
    h = (drop - 0.5) / rows
    for i in range(rows):
        z0 = -drop + i * h
        course(p, 'block', -half, half, -0.1, 3.2, z0, z0 + h, 3 + (i % 2))
    for a, b in ((-half, -1.6), (-1.6, 1.8), (1.8, half)):
        top = p.rng.uniform(-0.06, 0.06)
        p.box('block', ((a + b) / 2, 1.5, -0.25 + top / 2), (b - a, 3.4, 0.5 + top), jitter=0.03)
    # A base course standing a hand proud at the floor (the plan insets the rim 0.22).
    course(p, 'block', -half, half, -0.26, 0.4, -7.0, -5.95, 3)
    p.box('iron', (0, -0.2, -5.9), (2 * half, 0.05, 0.16))
    # The same painted shade under the capping course and the middle course.
    p.box('iron', (0, -0.12, -0.62), (2 * half, 0.04, 0.26))
    p.box('iron', (0, -0.12, -drop / 2), (2 * half, 0.04, 0.16))
    if split:
        p.box('cliff', (0.6, 0.0, -3.2), (1.2, 0.2, 2.8), jitter=0.05)
    p.build()


def stair_tread():
    """One tread down a stair the raid walks: its top on z 0, its nose at the low
    end (Blender -Y), a dark shade cut under the nose, its body running under the next.
    Fourteen yards wide, stretched to its stair. A run of laid stones, not one slab."""
    p = Piece('Env_StairTread', 53)
    r = p.rng
    half, run = 7.0, 1.3
    x = -half
    while x < half:
        w = min(half - x, r.uniform(2.0, 3.6))
        top = r.uniform(-0.03, 0.0)
        c = (x + w / 2, 0.0, top - 0.75)
        p.box('paving', c, (w - 0.05, run, 1.5 + top * 2), jitter=0.015)
        x += w
    p.box('iron', (0, -run / 2 + 0.03, -0.22), (2 * half, 0.05, 0.14))
    p.build()


def walk_layer():
    """The layer of stone under a walk's lip: three dressed courses stepping out under
    the brink (Blender -Y is over the drop), every top under the walk's own height."""
    p = Piece('Env_WalkLayer', 59)
    half = 3.05
    for z0, z1, out in ((-0.78, -0.03, 0.42), (-1.6, -0.78, 0.66), (-2.7, -1.6, 0.92)):
        course(p, 'block', -half, half, -out, 0.5, z0, z1, 3)
    p.build()


def arena_border():
    """Laid stone at the arena wall's foot, on the pit's floor: flat, top only, under the
    telegraphs' lift. Its origin is the wall's top (the pit is seven yards under it)."""
    p = Piece('Env_ArenaBorder', 61)
    r = p.rng
    half, floor = 4.8, -7.0 + 0.03
    x = -half
    while x < half:
        w = min(half - x, r.uniform(1.8, 3.0))
        depth = r.uniform(1.7, 2.5)
        vs = [(x + 0.03, 0.0, floor), (x + w - 0.03, 0.0, floor), (x + w - 0.03, -depth, floor), (x + 0.03, -depth, floor)]
        off = (r.random(), r.random())
        p.add_face('block', vs, p.quad_uv(vs, 'block', off))
        x += w
    p.build()


def kerb(name, seed, broken=False):
    """A worn kerb along the walk's lip: under a hand's height over the walk,
    running along X, the walk on Blender +Y."""
    p = Piece(name, seed)
    r = p.rng
    x = -3.0
    while x < 3.0:
        w = r.uniform(1.3, 2.1)
        b = min(3.0, x + w)
        if broken and r.random() < 0.4:
            p.rubble('block', ((x + b) / 2, 0.55, 0.0), r.uniform(0.28, 0.42))
        else:
            top = r.uniform(0.1, 0.2)
            p.box('block', ((x + b) / 2, 0.5, (top - 0.6) / 2), (b - x - 0.04, 0.95, top + 0.6), jitter=0.04)
        x = b
    p.build()


def chain_rail():
    """A rail module past the lip, over the drop (Blender -Y): a stone footing,
    an iron post with its ring, and a heavy chain sagging to the next post."""
    p = Piece('Env_ChainRail', 7)
    y = -0.65
    p.box('block', (-3.0, y, -0.45), (0.62, 0.62, 0.7), jitter=0.04)
    p.box('iron', (-3.0, y, 0.45), (0.3, 0.3, 1.1), taper=0.12)
    p.box('iron', (-3.0, y, 0.1), (0.42, 0.42, 0.14))
    p.link('iron', (-3.0, y, 1.15), (0, 0, 1), (1, 0, 0), 0.42, 0.42, 0.055, sides=4)
    links = 10
    for i in range(links):
        t0 = i / links
        t1 = (i + 1) / links
        x0 = -2.85 + 5.7 * t0
        x1 = -2.85 + 5.7 * t1
        sag = lambda t: 0.95 - 0.55 * (1 - (2 * t - 1) ** 2)
        c = ((x0 + x1) / 2, y, (sag(t0) + sag(t1)) / 2)
        along = Vector((x1 - x0, 0, sag(t1) - sag(t0)))
        up = Vector((0, 1, 0)) if i % 2 else along.cross(Vector((0, 1, 0)))
        p.link('iron', c, along, up, 0.72, 0.3, 0.05)
    p.build()


def column_broken(name, seed, height):
    p = Piece(name, seed)
    r = p.rng
    p.box('block', (0, 0, 0.35), (4.4, 4.4, 0.7), jitter=0.06)
    p.box('block', (0, 0, 1.0), (3.6, 3.6, 0.7), jitter=0.05)
    z = 1.35
    h = height / 4
    for i in range(4):
        last = i == 3
        p.prism('block', (r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), z + h / 2), 1.42 - i * 0.04, h, 10, jag=0.75 if last else 0)
        z += h
    p.rubble('block', (2.3, -1.2, 0.3), 0.7)
    p.rubble('block', (-1.9, -1.8, 0.25), 0.5)
    p.build()


def column_whole(name, seed, height):
    p = Piece(name, seed)
    p.box('block', (0, 0, 0.35), (4.4, 4.4, 0.7), jitter=0.06)
    p.box('block', (0, 0, 1.0), (3.6, 3.6, 0.7), jitter=0.05)
    z = 1.35
    h = height / 3
    for i in range(3):
        p.prism('block', (0, 0, z + h / 2), 1.42 - i * 0.05, h, 10)
        z += h
    p.box('block', (0, 0, z + 0.35), (3.5, 3.5, 0.7), jitter=0.05)
    p.box('block', (0, 0, z + 1.0), (4.2, 4.2, 0.6), jitter=0.07)
    p.build()


def column_fallen():
    p = Piece('Env_ColumnFallen', 23)
    r = p.rng
    x = -5.0
    for i, (ln, gap) in enumerate(((3.4, 0.25), (3.0, 0.7), (2.6, 0.0))):
        tilt = Matrix.Rotation(math.pi / 2 + r.uniform(-0.05, 0.05), 3, 'Y') @ Matrix.Rotation(r.uniform(0, 3), 3, 'Z')
        p.prism('block', (x + ln / 2, r.uniform(-0.3, 0.3) * i, 1.15), 1.25, ln, 10, jag=0.25 if i == 2 else 0, rot=tilt)
        x += ln + gap
    p.rubble('block', (-2.0, -1.8, 0.3), 0.6)
    p.rubble('block', (2.2, 1.8, 0.35), 0.75)
    p.rubble('block', (5.6, -0.8, 0.25), 0.5)
    p.build()


def rubble_heap(name, seed, count, spread):
    p = Piece(name, seed)
    r = p.rng
    for _ in range(count):
        a = r.uniform(0, math.tau)
        d = r.uniform(0, spread)
        p.rubble('block' if r.random() < 0.6 else 'cliff',
                 (math.cos(a) * d, math.sin(a) * d, r.uniform(0.1, 0.5)), r.uniform(0.4, 1.05))
    p.build()


def boulder(name, seed, radius):
    """A fallen block's rock, on its layout collider (a body can touch it): a
    rounded stone, faceted a little, moss on what faces up."""
    p = Piece(name, seed)
    r = p.rng
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    off = (r.random(), r.random())
    for v in bm.verts:
        v.co *= 1 + 0.12 * math.sin(v.co.x * 3.1 + seed) * math.cos(v.co.y * 2.7) + r.uniform(-0.03, 0.03)
        v.co.z *= 0.88
    c = Vector((0, 0, radius * 0.7))
    for f in bm.faces:
        vs = [tuple(v.co + c) for v in f.verts]
        up = f.normal.normalized().z > 0.62
        p.add_face('moss' if up else 'cliff', vs, p.quad_uv(vs, 'moss' if up else 'cliff', off))
    bm.free()
    p.build()


def anchor():
    """The masons' great iron ring on its stone block."""
    p = Piece('Env_Anchor', 31)
    p.box('block', (0, 0, 0.75), (2.4, 2.0, 1.5), jitter=0.07)
    # A pier down into the rock, for one set past a lip.
    p.box('block', (0, 0, -3.0), (2.1, 1.8, 6.0), jitter=0.08)
    p.box('block', (0, 0, 1.75), (1.8, 1.5, 0.5), jitter=0.05)
    p.box('iron', (0, -0.2, 2.15), (0.5, 0.5, 0.5))
    p.link('iron', (0, -0.2, 3.1), (0, 0, 1), (1, 0, 0), 1.5, 1.3, 0.17, sides=4)
    p.build()


def brazier():
    p = Piece('Env_Brazier', 37)
    p.box('block', (0, 0, 0.3), (1.9, 1.9, 0.6), jitter=0.04)
    p.prism('block', (0, 0, 1.0), 0.55, 0.9, 8, taper=0.1)
    p.prism('iron', (0, 0, 1.65), 0.75, 0.42, 8, taper=-0.28)
    p.build()


def coals():
    p = Piece('Env_BrazierCoals', 41)
    r = p.rng
    for _ in range(6):
        a = r.uniform(0, math.tau)
        c = (math.cos(a) * r.uniform(0, 0.45), math.sin(a) * r.uniform(0, 0.45), 1.86)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r.uniform(0.2, 0.32))
        for f in bm.faces:
            p.add_face('glow', [tuple(v.co + Vector(c)) for v in f.verts])
        bm.free()
    p.build()


def banner(name, seed, height, width):
    """A hung banner: a cloth strip with a shallow fold, a crossbar over it. The
    painting's cut edge makes the tatters."""
    p = Piece(name, seed)
    rows = 3
    columns = 2
    grid = []
    for j in range(rows + 1):
        row = []
        for i in range(columns + 1):
            u = i / columns
            v = j / rows
            x = (u - 0.5) * width
            y = math.sin(u * math.tau) * 0.08 + math.sin(v * 3.1) * 0.12
            row.append(((x, y, -v * height), (u, 1 - v)))
        grid.append(row)
    for j in range(rows):
        for i in range(columns):
            a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
            p.add_face('banner', [d[0], c[0], b[0], a[0]], [d[1], c[1], b[1], a[1]])
    p.box('iron', (0, 0.05, 0.08), (width + 0.5, 0.14, 0.14))
    p.build()


# ---- the whole kit ----------------------------------------------------------------


def main():
    reset()
    import_tripo('cliff_tall', 'cliff_tall', 40, far_ratio=0.45, target='Env_CliffTall')
    import_tripo('cliff_wide', 'cliff_wide', 64, far_ratio=0.45, target='Env_CliffWide')
    import_tripo('outcrop', 'outcrop', 48, far_ratio=0.5, target='Env_Outcrop')
    import_tripo('arcade', 'arcade', 30, far_ratio=0.5, target='Env_Arcade')
    tier('Env_TierA', 11)
    tier('Env_TierB', 12, aisle=True)
    tier('Env_TierC', 13, broken=True)
    rim('Env_RimA', 14)
    rim('Env_RimB', 15, split=True)
    stair_tread()
    walk_layer()
    arena_border()
    kerb('Env_KerbA', 16)
    kerb('Env_KerbB', 17, broken=True)
    chain_rail()
    column_broken('Env_ColumnBrokenA', 18, 9.5)
    column_broken('Env_ColumnBrokenB', 19, 5.5)
    column_whole('Env_ColumnWhole', 20, 11)
    column_fallen()
    rubble_heap('Env_RubbleA', 24, 9, 2.2)
    rubble_heap('Env_RubbleB', 25, 16, 3.6)
    boulder('Env_BoulderA', 26, 1.25)
    boulder('Env_BoulderB', 27, 1.3)
    anchor()
    brazier()
    coals()
    banner('Env_BannerTall', 43, 9, 3)
    banner('Env_BannerShort', 44, 5.5, 2.2)
    for name in ('paving', 'arena', 'moss', 'sky', 'paving_n', 'arena_n'):
        tex_quad(f'Tex_{name.capitalize()}', name)
    # A stale report beats none: what the kit measures, read by the plan's pin.
    report = {}
    bpy.context.view_layer.update()
    for node in root.children:
        mn = [1e9] * 3
        mx = [-1e9] * 3
        tris = 0
        for ob in node.children:
            eval_me = ob.data
            for v in eval_me.vertices:
                w = ob.matrix_world @ v.co
                for k in range(3):
                    mn[k] = min(mn[k], w[k])
                    mx[k] = max(mx[k], w[k])
            tris += sum(len(p.vertices) - 2 for p in eval_me.polygons)
        report[node.name] = {'min': [round(x, 2) for x in mn], 'max': [round(x, 2) for x in mx], 'tris': tris}
    print('REPORT ' + json.dumps(report))
    bpy.ops.object.select_all(action='SELECT')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_image_format='AUTO',
        export_tangents=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'))


main()
