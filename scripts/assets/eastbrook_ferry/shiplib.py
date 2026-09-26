"""Modelling helpers for the Eastbrook ferry (and the transport ship variants to come).

Everything here is authored in the GAME frame, the one the sim's hull layout
(src/sim/content/transport_ships.ts) uses: yards, origin at the waterline centre,
+x to PORT, +y up, +z toward the BOW. `P()` converts a game-frame point to Blender
(x, -z, y), so the glTF exporter's +Y-up conversion hands the runtime exactly the
game frame again (Blender -Y is glTF +Z).

The ship is hand-painted in its vertex colours: every face carries its own albedo,
a soft top-to-bottom gradient, a little per-face wear, and lighter bevel faces for
edge highlights. The game lights it (sun + sky), so nothing here bakes a light
direction. Materials stay shared and few: FerryWood, FerryIron, FerryCloth,
FerryRope and FerryGlow, all texture-free.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

WOOD, IRON, CLOTH, ROPE, GLOW = 0, 1, 2, 3, 4
MATERIAL_NAMES = ('FerryWood', 'FerryIron', 'FerryCloth', 'FerryRope', 'FerryGlow')

# face tags
PLAIN, EDGE, FLAT = 0, 1, 2


def P(x, y, z):
    """Game frame (x port, y up, z bow) to Blender (x, -z, y)."""
    return Vector((x, -z, y))


def G(v):
    """Blender vector back to the game frame."""
    return Vector((v.x, v.z, -v.y))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def mix(c0, c1, t):
    return tuple(lerp(a, b, t) for a, b in zip(c0, c1))


def scale_color(c, k):
    return tuple(max(0.0, min(1.0, v * k)) for v in c)


def rot_matrix(yaw=0.0, pitch=0.0, roll=0.0):
    """A game-frame rotation (yaw about +y, pitch about +x, roll about +z) as a
    Blender-frame matrix."""
    # game y is Blender z, game x is Blender x, game z is Blender -y
    return (Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X')
            @ Matrix.Rotation(-roll, 4, 'Y'))


class Piece:
    """One exported mesh object, built in a bmesh with per-corner colours."""

    def __init__(self, name, seed=0, wear=0.06, gradient=0.16, facing=True):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.tag = self.bm.faces.layers.int.new('tag')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.soft = self.bm.faces.layers.int.new('soft')
        self.facing = facing
        self.closed = []
        self.stamp = 0
        self.rng = random.Random(sum(ord(c) * (i + 1) for i, c in enumerate(name)) * 7919 + seed)
        self.seed_offset = (sum(ord(c) for c in name) % 97) * 0.731 + seed
        self.wear = wear
        self.gradient = gradient

    # ------------------------------------------------------------ painting
    def paint(self, faces, color, mat, tag=PLAIN):
        for f in faces:
            f.material_index = mat
            f[self.tag] = tag
            for loop in f.loops:
                loop[self.col] = (*color, 1.0)
        return faces

    def _new_faces(self, before):
        return [f for f in self.bm.faces if f not in before]

    # ------------------------------------------------------------ raw faces
    def face(self, pts, color, mat=WOOD, tag=PLAIN):
        verts = [self.bm.verts.new(P(*p) if not isinstance(p, Vector) else p) for p in pts]
        f = self.bm.faces.new(verts)
        self.paint([f], color, mat, tag)
        return f

    def surface(self, rows, color_fn, mat=WOOD, outward=None, skip=None, tag=PLAIN, soft=True):
        """A quad grid through rows of game-frame points (rows[i][j]). color_fn(i, j)
        paints face (i, j) and may return (color, mat) to override the material.
        `outward(center)` returns a game-frame direction each face should face; a
        face pointing the other way is flipped. `skip(i, j)` leaves a hole."""
        grid = [[self.bm.verts.new(P(*p)) for p in row] for row in rows]
        faces = []
        for i in range(len(grid) - 1):
            for j in range(len(grid[i]) - 1):
                if skip and skip(i, j):
                    continue
                quad = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
                # drop degenerate corners (a row pinched to a point)
                uniq = []
                for v in quad:
                    if all((v.co - u.co).length > 1e-6 for u in uniq):
                        uniq.append(v)
                if len(uniq) < 3:
                    continue
                try:
                    f = self.bm.faces.new(uniq)
                except ValueError:
                    continue
                got = color_fn(i, j)
                if isinstance(got, tuple) and len(got) == 2 and isinstance(got[0], tuple):
                    c, m = got
                else:
                    c, m = got, mat
                self.paint([f], c, m, tag)
                f[self.soft] = 1 if soft else 0
                if outward is not None:
                    f.normal_update()
                    want = outward(G(f.calc_center_median()))
                    if f.normal.dot(P(*want)) < 0:
                        f.normal_flip()
                faces.append(f)
        bmesh.ops.remove_doubles(self.bm, verts=[v for row in grid for v in row], dist=1e-5)
        return faces

    # ---------------------------------------------------------- primitives
    def box(self, center, size, color, mat=WOOD, bevel=0.0, yaw=0.0, pitch=0.0, roll=0.0,
            taper=1.0, edge_color=None):
        """A game-frame box (size x, y, z), optionally tapered toward its top,
        turned, and chamfered; chamfer faces read as a lighter edge highlight."""
        made = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = made['verts']
        sx, sy, sz = size
        for v in verts:
            g = G(v.co)  # unit cube in game frame
            k = taper if g.y > 0 else 1.0
            v.co = P(g.x * sx * k, g.y * sy, g.z * sz)
        rot = rot_matrix(yaw, pitch, roll)
        c = P(*center)
        for v in verts:
            v.co = rot @ v.co + c
        # bmesh elements hash by address: order sets by index so every run
        # builds (and shades) the same faces in the same order
        self.bm.faces.index_update()
        self.bm.edges.index_update()
        faces = sorted({f for v in verts for f in v.link_faces}, key=lambda f: f.index)
        self.paint(faces, color, mat)
        self.closed.extend(faces)
        if bevel > 0:
            edges = sorted({e for f in faces for e in f.edges}, key=lambda e: e.index)
            out = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES',
                                  profile=0.5)
            ec = edge_color if edge_color is not None else scale_color(color, 1.25)
            self.paint(out['faces'], ec, mat, EDGE)
            self.closed.extend(out['faces'])
        return faces

    def prism(self, base, sides, r0, r1, length, color, mat=WOOD, axis=(0, 1, 0), phase=0.0,
              squash=1.0, cap0=True, cap1=True, color1=None, soft=None):
        """A lathe slice along a game-frame axis: radius r0 at `base`, r1 at the far end."""
        a = Vector(axis).normalized()
        ref = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 0, 1))
        u = a.cross(ref).normalized()
        w = a.cross(u).normalized()
        b = Vector(base)
        rings = []
        for r, off in ((r0, 0.0), (r1, length)):
            ring = []
            for i in range(sides):
                ang = phase + math.tau * i / sides
                p = b + a * off + u * math.cos(ang) * r + w * math.sin(ang) * r * squash
                ring.append(self.bm.verts.new(P(*p)))
            rings.append(ring)
        faces = []
        for i in range(sides):
            f = self.bm.faces.new((rings[0][i], rings[0][(i + 1) % sides],
                                   rings[1][(i + 1) % sides], rings[1][i]))
            f[self.soft] = 1 if (soft if soft is not None else sides >= 6) else 0
            faces.append(f)
        caps = []
        if cap0:
            caps.append(self.bm.faces.new(list(reversed(rings[0]))))
        if cap1 and r1 > 1e-4:
            caps.append(self.bm.faces.new(rings[1]))
        self.paint(faces + caps, color, mat)
        if color1 is not None and caps:
            self.paint(caps, color1, mat, EDGE)
        self.closed.extend(faces + caps)
        return faces + caps

    def cylinder(self, a, b, r, color, mat=WOOD, sides=8, r1=None, phase=0.0, caps=True, soft=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        return self.prism(a, sides, r, r if r1 is None else r1, d.length, color, mat,
                          axis=d.normalized(), phase=phase, cap0=caps, cap1=caps, soft=soft)

    def sweep(self, points, r0, r1, color, sides=6, mat=WOOD, squash=1.0, caps=True, up=None,
              radii=None, phase=0.0, color_fn=None):
        """A tube through a game-frame polyline, tapering r0 to r1 (or `radii`).
        `color_fn(ring, side)` paints each side face (ring = segment index)."""
        pts = [Vector(p) for p in points]
        rings = []
        for i, p in enumerate(pts):
            ahead = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            ahead.normalize()
            ref = Vector(up) if up is not None else Vector((0, 1, 0))
            side = ahead.cross(ref)
            if side.length < 1e-4:
                side = ahead.cross(Vector((1, 0, 0)))
            side.normalize()
            upv = side.cross(ahead).normalized()
            t = i / max(1, len(pts) - 1)
            r = radii[i] if radii is not None else r0 + (r1 - r0) * t
            ring = []
            for k in range(sides):
                ang = phase + math.tau * k / sides
                q = p + side * math.cos(ang) * r + upv * math.sin(ang) * r * squash
                ring.append(self.bm.verts.new(P(*q)))
            rings.append(ring)
        faces = []
        painted = []
        for i in range(len(rings) - 1):
            for k in range(sides):
                f = self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                       rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
                f[self.soft] = 1
                faces.append(f)
                if color_fn is not None:
                    painted.append((f, color_fn(i, k)))
        if caps:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            if (radii[-1] if radii is not None else r1) > 1e-4:
                faces.append(self.bm.faces.new(rings[-1]))
        self.paint(faces, color, mat)
        for f, c in painted:
            self.paint([f], c, mat)
        self.closed.extend(faces)
        return faces

    def loft(self, rings, color_fn, mat=WOOD, cap0=True, cap1=True):
        """A closed tube through explicit rings of game-frame points (equal counts):
        a skull, a jaw, a carved scroll. color_fn(ring, side)."""
        vs = [[self.bm.verts.new(P(*q)) for q in ring] for ring in rings]
        n = len(vs[0])
        faces = []
        for i in range(len(vs) - 1):
            for k in range(n):
                f = self.bm.faces.new((vs[i][k], vs[i][(k + 1) % n], vs[i + 1][(k + 1) % n], vs[i + 1][k]))
                f[self.soft] = 1
                self.paint([f], color_fn(i, k), mat)
                faces.append(f)
        if cap0:
            f = self.bm.faces.new(list(reversed(vs[0])))
            self.paint([f], color_fn(0, 0), mat)
            faces.append(f)
        if cap1:
            f = self.bm.faces.new(vs[-1])
            self.paint([f], color_fn(len(vs) - 2, 0), mat)
            faces.append(f)
        self.closed.extend(faces)
        return faces

    def beam(self, points, width, height, color, mat=WOOD, up=(0, 1, 0), caps=True,
             edge_color=None, offset=(0.0, 0.0)):
        """A rectangular bar through a polyline: `width` across (horizontal side
        vector), `height` along `up`. offset shifts the section (across, up)."""
        pts = [Vector(p) for p in points]
        upref = Vector(up).normalized()
        rings = []
        for i, p in enumerate(pts):
            ahead = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            ahead.normalize()
            side = ahead.cross(upref)
            if side.length < 1e-4:
                side = ahead.cross(Vector((1, 0, 0)))
            side.normalize()
            upv = side.cross(ahead).normalized()
            c = p + side * offset[0] + upv * offset[1]
            hw, hh = width / 2, height / 2
            ring = [c + side * sx * hw + upv * sy * hh
                    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            rings.append([self.bm.verts.new(P(*q)) for q in ring])
        faces = []
        tops = []
        for i in range(len(rings) - 1):
            for k in range(4):
                f = self.bm.faces.new((rings[i][k], rings[i][(k + 1) % 4],
                                       rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
                faces.append(f)
                if k == 2:
                    tops.append(f)
        if caps:
            faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            faces.append(self.bm.faces.new(rings[-1]))
        self.paint(faces, color, mat)
        if edge_color is not None:
            self.paint(tops, edge_color, mat, EDGE)
        self.closed.extend(faces)
        return faces

    def ring(self, center, radius, thickness, color, segments=16, axis=(0, 0, 1), mat=WOOD,
             depth=None):
        """A torus of box segments around `axis` (a wheel rim, a coil, a hoop)."""
        a = Vector(axis).normalized()
        ref = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0))
        u = a.cross(ref).normalized()
        w = a.cross(u).normalized()
        c = Vector(center)
        pts = [c + (u * math.cos(math.tau * i / segments) + w * math.sin(math.tau * i / segments)) * radius
               for i in range(segments + 1)]
        # a closed loop of beams: `up` is the axis so the section lies flat
        return self.beam(pts, depth if depth is not None else thickness, thickness, color, mat,
                         up=tuple(a), caps=False)

    def rock_blob(self, center, size, color, mat=WOOD, jitter=0.15, subdivisions=1):
        before = set(self.bm.faces)
        made = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=0.5)
        for v in made['verts']:
            g = G(v.co)
            k = 1 + (self.rng.random() - 0.5) * 2 * jitter
            v.co = P(center[0] + g.x * size[0] * k, center[1] + g.y * size[1] * k,
                     center[2] + g.z * size[2] * k)
        faces = self._new_faces(before)
        self.paint(faces, color, mat)
        self.closed.extend(faces)
        return faces

    # ---------------------------------------------------------- transforms
    def mark(self):
        """Everything built so far; hand it to `turn` to move only what came after."""
        self.stamp += 1
        for v in self.bm.verts:
            if v[self.gen] == 0:
                v[self.gen] = self.stamp
        return self.stamp

    def turn(self, mark, matrix):
        """Apply a Blender-frame matrix to what was built since `mark`."""
        for v in self.bm.verts:
            if v[self.gen] == 0 or v[self.gen] > mark:
                v.co = matrix @ v.co

    def _noise(self, c):
        """A per-face value in [0, 1) from its position: stable whatever the face order."""
        k = math.sin(round(c.x, 3) * 12.9898 + round(c.y, 3) * 78.233 + round(c.z, 3) * 37.719
                     + self.seed_offset) * 43758.5453
        return k - math.floor(k)

    # ------------------------------------------------------------- finish
    def finish(self, materials, parent, location=(0.0, 0.0, 0.0), smooth_shading=None):
        """smooth_shading: None smooths the curved faces (surfaces, sweeps, round
        prisms) and keeps boxes flat; True or False forces every face."""
        """Shade, convert, link. `location` (game frame) becomes the object's
        origin: vertices are stored relative to it, so an animated sail swings
        about its yard and a flag about its staff."""
        bm = self.bm
        closed = [f for f in self.closed if f.is_valid]
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=closed)
        bm.normal_update()
        # Deterministic element order: bmesh operators (bevel) emit faces in hash
        # order, which differs run to run. Sorting by position (ties broken by the
        # faces around a vertex) makes every export of the same source identical.
        def rkey(v):
            return (round(v.x, 4), round(v.y, 4), round(v.z, 4))

        def sort_seq(seq, key):
            # BMElemSeq.sort wants a number: rank the elements by the tuple key
            seq.index_update()
            order = sorted(range(len(seq)), key=lambda i: key(seq[i]))
            rank = [0] * len(seq)
            for r, i in enumerate(order):
                rank[i] = r
            seq.sort(key=lambda e: rank[e.index])
            seq.index_update()

        bm.faces.ensure_lookup_table()
        sort_seq(bm.faces, lambda f: (f.material_index, rkey(f.calc_center_median()), rkey(f.normal)))
        bm.faces.ensure_lookup_table()
        bm.verts.ensure_lookup_table()
        sort_seq(bm.verts, lambda v: (rkey(v.co), tuple(sorted(f.index for f in v.link_faces))))
        bm.verts.ensure_lookup_table()
        sort_seq(bm.faces, lambda f: (f.material_index, rkey(f.calc_center_median()), rkey(f.normal),
                                      tuple(sorted(v.index for v in f.verts))))
        bm.faces.ensure_lookup_table()
        if len(bm.verts):
            ys = [G(v.co).y for v in bm.verts]
            lo, hi = min(ys), max(ys)
        else:
            lo, hi = 0.0, 1.0
        span = max(0.5, hi - lo)
        for f in bm.faces:
            tag = f[self.tag]
            if tag == FLAT or f.material_index == GLOW:
                shade = 1.0
            else:
                h = (G(f.calc_center_median()).y - lo) / span
                n = G(f.normal)
                shade = (1 - self.gradient) + self.gradient * smooth(h)
                if self.facing:
                    shade *= 1 + 0.07 * max(0.0, n.y) - 0.12 * max(0.0, -n.y)
                shade *= 1 + (self._noise(f.calc_center_median()) - 0.5) * 2 * self.wear
                if tag == EDGE:
                    shade *= 1.08
            for loop in f.loops:
                r, g, b, _ = loop[self.col]
                loop[self.col] = (max(0.0, min(1.0, r * shade)) ** 2.2,
                                  max(0.0, min(1.0, g * shade)) ** 2.2,
                                  max(0.0, min(1.0, b * shade)) ** 2.2, 1.0)
        soft_flags = [f[self.soft] for f in bm.faces]
        origin = P(*location)
        for v in bm.verts:
            v.co -= origin
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        for poly, flag in zip(mesh.polygons, soft_flags):
            poly.use_smooth = bool(flag) if smooth_shading is None else smooth_shading
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        # `origin` is a game-frame WORLD point; a nested parent (a flag segment
        # hung on the previous one) must not add its own offset to it
        if parent is not None:
            bpy.context.view_layer.update()
            obj.location = parent.matrix_world.inverted() @ origin
        else:
            obj.location = origin
        return obj


def make_materials():
    specs = (
        # name, roughness, metallic, emission, double sided
        ('FerryWood', 0.82, 0.0, 0.0, False),
        ('FerryIron', 0.55, 0.35, 0.0, False),
        ('FerryCloth', 0.92, 0.0, 0.0, True),
        ('FerryRope', 0.95, 0.0, 0.0, False),
        ('FerryGlow', 0.5, 0.0, 2.2, False),
    )
    mats = []
    for name, rough, metal, emission, double in specs:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = not double
        mats.append(mat)
    return mats


def empty(name, parent, location=(0.0, 0.0, 0.0), display='PLAIN_AXES', size=0.5):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = size
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    if parent is not None:
        bpy.context.view_layer.update()
        obj.location = parent.matrix_world.inverted() @ P(*location)
    else:
        obj.location = P(*location)
    return obj


def triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(depsgraph).to_mesh()
    mesh.calc_loop_triangles()
    n = len(mesh.loop_triangles)
    obj.evaluated_get(depsgraph).to_mesh_clear()
    return n
