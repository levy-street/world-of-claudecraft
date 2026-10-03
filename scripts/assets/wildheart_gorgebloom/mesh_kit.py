"""Small bmesh modelling kit for Balgath's dressing (gear, eye, teeth, chains).

A `Part` is one object with one surface kind (`mat`: skin, stone, leather, iron,
rope, tooth, hide, eye, mouth, glow) and a binding: `rigid` to one bone, or
`transfer` (weights copied from the nearest skin vertices, for gear that rides the
flesh: the belt, the bandolier). Optional `glow` colours are vertex colours on the
emissive material.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


def V(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


class Part:
    def __init__(self, name, mat, bone=None, binding='rigid', smooth=True):
        self.name = name
        self.mat = mat
        self.bone = bone
        self.binding = binding
        self.smooth = smooth
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.sharp = []

    # ------------------------------------------------------------ helpers
    def _faces_since(self, before):
        return [f for f in self.bm.faces if f not in before]

    def _paint(self, faces, color):
        c = (*srgb_to_linear(color), 1.0)
        for f in faces:
            for lp in f.loops:
                lp[self.col] = c

    # ------------------------------------------------------------ primitives
    def tube(self, points, radii, sides=10, cap=True, color=(1, 1, 1), up=(0, 0, 1), squash=1.0, closed=False,
             twist=0.0):
        """A tube along points, radii per station; parallel-transported frames."""
        pts = [V(p) for p in points]
        n = len(pts)
        if not hasattr(radii, '__len__'):
            radii = [radii] * n
        before = set(self.bm.faces)
        tang = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[(i - 1) % n]
            else:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tang.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
        side = tang[0].cross(V(up))
        if side.length < 1e-4:
            side = tang[0].orthogonal()
        side.normalize()
        rings = []
        for i in range(n):
            if i > 0:
                side = side - tang[i] * side.dot(tang[i])
                if side.length < 1e-6:
                    side = tang[i].orthogonal()
                side.normalize()
            upv = tang[i].cross(side).normalized()
            r = radii[i]
            tw = twist * i
            ring = []
            for k in range(sides):
                a = math.tau * k / sides + tw
                ring.append(self.bm.verts.new(pts[i] + side * math.cos(a) * r + upv * math.sin(a) * r * squash))
            rings.append(ring)
        segs = n if closed else n - 1
        for i in range(segs):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for k in range(sides):
                self.bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
        if cap and not closed:
            if radii[0] > 1e-4:
                self.bm.faces.new(list(reversed(rings[0])))
            if radii[-1] > 1e-4:
                self.bm.faces.new(rings[-1])
        faces = self._faces_since(before)
        self._paint(faces, color)
        return faces

    def sphere(self, c, radii, rot=None, seg=16, rings=10, color=(1, 1, 1), cut=None):
        """A UV ellipsoid; `rot` a 3x3 (numpy or Matrix). `cut`=(axis, min_dot) keeps
        only the part where the unit-sphere point's dot with axis >= min_dot."""
        before = set(self.bm.faces)
        made = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1.0)
        R = Matrix(np.asarray(rot).tolist()) if rot is not None else Matrix.Identity(3)
        verts = made['verts']
        if cut is not None:
            ax, md = V(cut[0]).normalized(), cut[1]
            kill = [v for v in verts if v.co.normalized().dot(ax) < md]
            bmesh.ops.delete(self.bm, geom=kill, context='VERTS')
            verts = [v for v in verts if v.is_valid]
        for v in verts:
            v.co = R @ Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + V(c)
        faces = self._faces_since(before)
        self._paint(faces, color)
        return faces

    def torus(self, c, axis, R, r, seg=12, sides=6, color=(1, 1, 1), squash=(1.0, 1.0), roll=0.0):
        """A torus (a chain link when squashed along one in-plane axis)."""
        ax = V(axis).normalized()
        e1 = ax.orthogonal().normalized()
        if roll:
            e1 = Matrix.Rotation(roll, 3, ax) @ e1
        e2 = ax.cross(e1).normalized()
        pts = [V(c) + e1 * math.cos(math.tau * i / seg) * R * squash[0] + e2 * math.sin(math.tau * i / seg) * R * squash[1]
               for i in range(seg)]
        return self.tube(pts, [r] * seg, sides=sides, closed=True, color=color, up=tuple(ax))

    def box(self, c, half, rot=None, color=(1, 1, 1), bevel=0.0, segments=2):
        before = set(self.bm.faces)
        made = bmesh.ops.create_cube(self.bm, size=2.0)
        R = Matrix(np.asarray(rot).tolist()) if rot is not None else Matrix.Identity(3)
        verts = made['verts']
        for v in verts:
            v.co = R @ Vector((v.co.x * half[0], v.co.y * half[1], v.co.z * half[2])) + V(c)
        faces = self._faces_since(before)
        if bevel > 0:
            edges = list({e for f in faces for e in f.edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=segments, affect='EDGES', profile=0.5)
            faces = self._faces_since(before)
        self._paint(faces, color)
        return faces

    def grid(self, rows, cols, fn, color=(1, 1, 1), two_sided=False):
        """A sheet: fn(u, v) -> point, u along rows (0..1), v across (0..1)."""
        before = set(self.bm.faces)
        vs = [[self.bm.verts.new(V(fn(r / rows, c / cols))) for c in range(cols + 1)] for r in range(rows + 1)]
        for r in range(rows):
            for c in range(cols):
                self.bm.faces.new((vs[r][c], vs[r][c + 1], vs[r + 1][c + 1], vs[r + 1][c]))
        faces = self._faces_since(before)
        self._paint(faces, color)
        return faces, vs

    def add_mesh(self, mesh_obj):
        """Absorb an existing mesh object's geometry (its world transform applied)."""
        tmp = bmesh.new()
        tmp.from_mesh(mesh_obj.data)
        tmp.transform(mesh_obj.matrix_world)
        me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me)
        tmp.free()
        before = set(self.bm.faces)
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        faces = self._faces_since(before)
        self._paint(faces, (1, 1, 1))
        return faces

    # ------------------------------------------------------------ out
    def to_object(self):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.smooth = self.smooth
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj['mat'] = self.mat
        obj['bone'] = self.bone or ''
        obj['binding'] = self.binding
        return obj


def obj_from_bm(name, bm, mat, bone=None, binding='rigid', smooth=True):
    for f in bm.faces:
        f.smooth = smooth
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj['mat'] = mat
    obj['bone'] = bone or ''
    obj['binding'] = binding
    return obj


def decimate(obj, ratio=None, target=None, symmetric=False):
    """Collapse-decimate an object to a ratio or a triangle target (applied)."""
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if target is not None:
        ratio = min(1.0, target / max(1, tris))
    if ratio >= 0.999:
        return obj
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    if symmetric:
        mod.use_symmetry = True
        mod.symmetry_axis = 'X'
    apply_mods(obj)
    return obj


def apply_mods(obj):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def duplicate(obj, name):
    o2 = obj.copy()
    o2.data = obj.data.copy()
    o2.name = name
    o2.data.name = name
    bpy.context.scene.collection.objects.link(o2)
    for k in obj.keys():
        o2[k] = obj[k]
    return o2


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
