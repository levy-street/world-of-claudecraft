"""Shared helpers for the Lantern Hall Destrier build (build_steed.py).

Everything is authored in the valorsteed body's own REST frame (the mesh-local
space its vertices are stored in, shared with the armature), through L(x, f, u):
x is the horse's left (+) / right (-), f runs forward toward the nose, u runs up
from the hooves. The frame's numbers were read off the shipped valorsteed.glb:
the hooves rest on z 96.28 and the body's mid-girth sits on y 33.96, and the
nose points toward -y.

Original procedural work for this project: no imported meshes beyond our own
valorsteed body and rig, no reference art.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

Y0, Z0 = 33.96, 96.28


def L(x, f, u):
    return Vector((x, Y0 - f, Z0 + u))


def fu(v):
    """Inverse of L: (x, f, u) of a rest-frame point."""
    return v.x, Y0 - v.y, v.z - Z0


# ---------------------------------------------------------------------------
# Palette (linear vertex colours) and the material set. Every colour lives in
# the COLOR_0 attribute; the materials only carry the surface response (metal,
# roughness, emission), so the whole steed is a handful of draws.
# ---------------------------------------------------------------------------
PAL = {
    'coat': (0.028, 0.03, 0.036),
    'coat_light': (0.075, 0.078, 0.088),
    'coat_dark': (0.009, 0.009, 0.012),
    'mane': (0.035, 0.034, 0.04),
    'sock': (0.86, 0.84, 0.80),
    'muzzle': (0.07, 0.065, 0.07),
    'hoof': (0.11, 0.09, 0.08),
    'oak': (0.30, 0.165, 0.07),
    'oak_dark': (0.16, 0.085, 0.035),
    'oak_light': (0.42, 0.25, 0.11),
    'iron': (0.075, 0.08, 0.095),
    'iron_dark': (0.03, 0.032, 0.04),
    'steel': (0.2, 0.21, 0.235),
    'gold': (0.9, 0.55, 0.12),
    'gold_dark': (0.48, 0.30, 0.09),
    'blue': (0.025, 0.06, 0.20),
    'blue_dark': (0.012, 0.03, 0.10),
    'garnet': (0.30, 0.025, 0.035),
    'cream': (0.82, 0.74, 0.58),
    'leather': (0.17, 0.075, 0.03),
    'leather_dark': (0.08, 0.035, 0.015),
    'glass': (1.0, 0.62, 0.22),
    'flame': (1.0, 0.85, 0.5),
}

MATS = {}


def make_materials():
    def m(name, metal, rough, emit=None, strength=0.0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        b = nt.nodes['Principled BSDF']
        b.inputs['Metallic'].default_value = metal
        b.inputs['Roughness'].default_value = rough
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Color'
        nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
        if emit is not None:
            b.inputs['Emission Color'].default_value = (*emit, 1)
            b.inputs['Emission Strength'].default_value = strength
        MATS[name] = mat
        return mat

    m('steed_hide', 0.0, 0.78)
    m('steed_hair', 0.0, 0.7)
    m('steed_hoof', 0.0, 0.5)
    m('steed_eye', 0.0, 0.15)
    m('steed_cloth', 0.0, 0.9)
    m('steed_wood', 0.0, 0.62)
    m('steed_iron', 0.85, 0.42)
    m('steed_gold', 1.0, 0.3)
    m('steed_leather', 0.0, 0.55)
    # the lit glass: the renderer pins any material whose name carries `Glow` to
    # its calibrated emissive (characters/assets.ts buildTintedClone)
    m('lantern_Glow', 0.0, 0.2, emit=(1.0, 0.46, 0.13), strength=6.0)
    return MATS


# ---------------------------------------------------------------------------
# A tiny mesh builder: geometry is accumulated per material with a corner colour
# and a single-bone (rigid) or copied (skinned) weight set, then written out as
# one object per call to `flush`.
# ---------------------------------------------------------------------------
class Part:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []  # (indices, material, colour)
        self.weights = []  # per vertex: dict bone -> weight
        self.smooth = []

    def v(self, co, w):
        self.verts.append(Vector(co))
        self.weights.append(w)
        return len(self.verts) - 1

    def f(self, idx, mat, col, smooth=False):
        self.faces.append((tuple(idx), mat, col))
        self.smooth.append(smooth)


def rigid(bone):
    return {bone: 1.0}


def box(p, center, size, mat, col, w, rot=None, smooth=False):
    """Axis box in the rest frame, optionally rotated by a 3x3 matrix about its centre."""
    c = Vector(center)
    hx, hy, hz = (s / 2 for s in size)
    R = rot or Matrix.Identity(3)
    corners = [Vector((sx * hx, sy * hy, sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    ids = [p.v(c + R @ k, w) for k in corners]
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for q in quads:
        p.f([ids[i] for i in q], mat, col, smooth)
    return ids


def frame_from(a, b, up=Vector((0, 0, 1))):
    """Orthonormal frame whose local Z runs a->b."""
    z = (Vector(b) - Vector(a)).normalized()
    x = up.cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def tube(p, a, b, r, mat, col, w, sides=8, r2=None, cap=True, smooth=True):
    """A cylinder/frustum from a to b."""
    R = frame_from(a, b)
    a, b = Vector(a), Vector(b)
    r2 = r if r2 is None else r2
    ring_a, ring_b = [], []
    for i in range(sides):
        t = 2 * math.pi * i / sides
        d = Vector((math.cos(t), math.sin(t), 0))
        ring_a.append(p.v(a + R @ (d * r), w))
        ring_b.append(p.v(b + R @ (d * r2), w))
    for i in range(sides):
        j = (i + 1) % sides
        p.f([ring_a[i], ring_a[j], ring_b[j], ring_b[i]], mat, col, smooth)
    if cap:
        p.f(list(reversed(ring_a)), mat, col)
        p.f(ring_b, mat, col)
    return ring_a, ring_b


def torus(p, center, axis, R_, r, mat, col, w, seg=12, sides=6):
    c = Vector(center)
    M = frame_from(c, c + Vector(axis))
    rings = []
    for i in range(seg):
        t = 2 * math.pi * i / seg
        ctr = Vector((math.cos(t) * R_, math.sin(t) * R_, 0))
        radial = Vector((math.cos(t), math.sin(t), 0))
        ring = []
        for k in range(sides):
            s = 2 * math.pi * k / sides
            q = ctr + radial * (math.cos(s) * r) + Vector((0, 0, math.sin(s) * r))
            ring.append(p.v(c + M @ q, w))
        rings.append(ring)
    for i in range(seg):
        a, b = rings[i], rings[(i + 1) % seg]
        for k in range(sides):
            kk = (k + 1) % sides
            p.f([a[k], b[k], b[kk], a[kk]], mat, col, True)


def sphere(p, center, r, mat, col, w, seg=10, rings=6, scale=(1, 1, 1)):
    c = Vector(center)
    top = p.v(c + Vector((0, 0, r * scale[2])), w)
    bot = p.v(c - Vector((0, 0, r * scale[2])), w)
    grid = []
    for i in range(1, rings):
        phi = math.pi * i / rings
        row = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            row.append(p.v(c + Vector((math.sin(phi) * math.cos(t) * r * scale[0],
                                       math.sin(phi) * math.sin(t) * r * scale[1],
                                       math.cos(phi) * r * scale[2])), w))
        grid.append(row)
    for k in range(seg):
        kk = (k + 1) % seg
        p.f([top, grid[0][kk], grid[0][k]], mat, col, True)
        p.f([bot, grid[-1][k], grid[-1][kk]], mat, col, True)
    for i in range(len(grid) - 1):
        for k in range(seg):
            kk = (k + 1) % seg
            p.f([grid[i][k], grid[i][kk], grid[i + 1][kk], grid[i + 1][k]], mat, col, True)


def flush(p, arm, body, bevel=0.0, solid=None):
    """Write a Part out as a skinned child of the armature."""
    me = bpy.data.meshes.new(p.name)
    me.from_pydata([tuple(v) for v in p.verts], [], [list(f[0]) for f in p.faces])
    me.update()
    ob = bpy.data.objects.new(p.name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm
    ob.matrix_world = body.matrix_world.copy()
    mats = []
    for _, mat, _ in p.faces:
        if mat not in mats:
            mats.append(mat)
    for mat in mats:
        me.materials.append(MATS[mat])
    col = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    for poly, (idx, mat, c), sm in zip(me.polygons, p.faces, p.smooth):
        poly.material_index = mats.index(mat)
        poly.use_smooth = sm
        # a face takes one colour, or one per corner (a list, for gradients down a lock of hair)
        per_corner = isinstance(c, list)
        for k, li in enumerate(poly.loop_indices):
            col.data[li].color = (*(c[k] if per_corner else c), 1.0)
    groups = {}
    for i, w in enumerate(p.weights):
        for bone, wt in w.items():
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([i], wt, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    if bevel:
        b = ob.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = 1
        b.limit_method = 'ANGLE'
        b.angle_limit = math.radians(40)
    return ob


# ---------------------------------------------------------------------------
# Body sampling: rays and nearest-point queries against the valorsteed body in
# its rest pose, and weight transfer so a conforming piece deforms exactly as
# the hide beneath it does.
# ---------------------------------------------------------------------------
class BodySampler:
    def __init__(self, body, skip_prefixes=()):
        self.body = body
        names = {g.index: g.name for g in body.vertex_groups}
        bm = bmesh.new()
        bm.from_mesh(body.data)
        if skip_prefixes:
            # drop the hair (mane, forelock, tail) so rays find the hide beneath it
            dl = bm.verts.layers.deform.active
            bad = set()
            for v in bm.verts:
                d = v[dl]
                if d:
                    g = max(d.items(), key=lambda kv: kv[1])[0]
                    if names[g].startswith(skip_prefixes):
                        bad.add(v.index)
            drop = [f for f in bm.faces if any(v.index in bad for v in f.verts)]
            bmesh.ops.delete(bm, geom=drop, context='FACES_ONLY')
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        self.bm = bm
        self.bvh = BVHTree.FromBMesh(bm)
        self.vw = []
        for v in body.data.vertices:
            self.vw.append({names[g.group]: g.weight for g in v.groups if g.weight > 1e-4})

    def ray(self, origin, direction):
        hit = self.bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        return hit if hit[0] is not None else None

    def nearest(self, co):
        return self.bvh.find_nearest(Vector(co))

    def weights_at(self, co, keep=None):
        loc, nrm, fi, _ = self.bvh.find_nearest(Vector(co))
        face = self.bm.faces[fi]
        a, b, c = (v.co for v in face.verts)
        # barycentric of loc on the triangle
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01 or 1e-9
        bv = (d11 * d20 - d01 * d21) / den
        bw = (d00 * d21 - d01 * d20) / den
        bu = 1 - bv - bw
        out = {}
        for vert, k in zip(face.verts, (bu, bv, bw)):
            k = max(0.0, k)
            for bone, wt in self.vw[vert.index].items():
                if keep and bone not in keep:
                    continue
                out[bone] = out.get(bone, 0) + wt * k
        out = {b: w for b, w in out.items() if w > 1e-6}
        if not out:
            # nothing under this point belongs to the kept bones: bind it to the first
            return {sorted(keep)[0]: 1.0} if keep else {}
        top = sorted(out.items(), key=lambda kv: -kv[1])[:4]
        s = sum(w for _, w in top) or 1
        return {b: w / s for b, w in top}
