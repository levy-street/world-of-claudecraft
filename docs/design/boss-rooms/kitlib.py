"""Shared modelling kit for the Buried Hoard boss-room kits.

The hoard rooms are UNLIT flat colour with hand-painted facets, so every face of
every piece carries its own baked shade in its vertex colours (a key light from
the room's side, a touch of top light, darker toward the floor, a little per-face
variation). Two materials only per kit: KitSolid (everything painted; it takes the
room's day/night grade) and KitGlow (what glows; the runtime breathes it).

A piece's front is -Y here (the game's +Z after export), up is +Z, units are game
yards, and its origin is where the runtime stands it: the floor, the hang point of
something hung, or the wall face of something mounted.

The rooms grade everything down toward dusk, so palettes sit well above the dark
they end up reading as.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

SOLID, GLOW = 0, 1
LIGHT = Vector((-0.42, -0.55, 0.72)).normalized()


class Piece:
    def __init__(self, name, seed=0, warm=(0.0, 0.0, 0.0)):
        """`warm` is a colour the key-lit faces lean toward (firelight, a cold glow)."""
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.stamp = 0
        self.rng = random.Random(sum(ord(c) for c in name) * 131 + seed)
        self.warm = warm

    # ------------------------------------------------------------ painting
    def _paint(self, faces, color, mat):
        for face in faces:
            face.material_index = mat
            for loop in face.loops:
                loop[self.col] = (*color, 1.0)

    def _new_faces(self, before):
        return [f for f in self.bm.faces if f not in before]

    # ---------------------------------------------------------- primitives
    def box(self, center, size, color, mat=SOLID, bevel=0.0, yaw=0.0, pitch=0.0, roll=0.0, taper=1.0):
        """An axis box, optionally tapered toward its top, turned, and chamfered."""
        made = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = made['verts']
        for v in verts:
            k = taper if v.co.z > 0 else 1.0
            v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2]))
        rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
        for v in verts:
            v.co = rot @ v.co + Vector(center)
        faces = list({f for v in verts for f in v.link_faces})
        self._paint(faces, color, mat)
        if bevel > 0:
            edges = list({e for f in faces for e in f.edges})
            out = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES')
            self._paint(out['faces'], color, mat)

    def prism(self, center, sides, r0, r1, height, color, mat=SOLID, axis='Z', phase=0.0, squash=1.0, lean=(0, 0)):
        """A lathe slice: radius r0 at its foot, r1 at its top, which may lean."""
        rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
        rings = []
        for r, z, off in ((r0, 0.0, (0, 0)), (r1, height, lean)):
            rings.append([
                self.bm.verts.new(rot @ Vector((
                    off[0] + math.cos(phase + math.tau * i / sides) * r,
                    off[1] + math.sin(phase + math.tau * i / sides) * r * squash,
                    z,
                )) + Vector(center))
                for i in range(sides)
            ])
        faces = []
        for i in range(sides):
            faces.append(self.bm.faces.new((rings[0][i], rings[0][(i + 1) % sides],
                                            rings[1][(i + 1) % sides], rings[1][i])))
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        if r1 > 1e-4:
            faces.append(self.bm.faces.new(rings[1]))
        self._paint(faces, color, mat)

    def spike(self, center, radius, height, color, sides=5, lean=(0, 0), mat=SOLID, phase=0.0):
        """A faceted spike: an icicle up, or (negative height) one hanging down."""
        self.prism(center, sides, radius, 0.0001, height, color, mat=mat, lean=lean, phase=phase)

    def rock(self, center, size, color, jitter=0.18, subdivisions=1, mat=SOLID):
        """A low-poly boulder: a squashed, shaken icosphere."""
        before = set(self.bm.faces)
        made = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=0.5)
        for v in made['verts']:
            k = 1 + (self.rng.random() - 0.5) * 2 * jitter
            v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2] * k)) + Vector(center)
        self._paint(self._new_faces(before), color, mat)

    def sweep(self, points, r0, r1, color, sides=5, mat=SOLID, squash=1.0):
        """A tube through a polyline, tapering r0 to r1: a rib, a root, a branch."""
        points = [Vector(p) for p in points]
        rings = []
        for i, p in enumerate(points):
            ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
            ahead.normalize()
            side = ahead.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = ahead.cross(Vector((0, 1, 0)))
            side.normalize()
            up = side.cross(ahead).normalized()
            t = i / max(1, len(points) - 1)
            r = r0 + (r1 - r0) * t
            rings.append([
                self.bm.verts.new(p + side * math.cos(math.tau * k / sides) * r
                                  + up * math.sin(math.tau * k / sides) * r * squash)
                for k in range(sides)
            ])
        faces = []
        for i in range(len(rings) - 1):
            for k in range(sides):
                faces.append(self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                                rings[i + 1][(k + 1) % sides], rings[i + 1][k])))
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        faces.append(self.bm.faces.new(rings[-1]))
        self._paint(faces, color, mat)

    def bezier(self, a, b, c, steps=7):
        """Points of a quadratic curve from a, bent toward b, to c."""
        a, b, c = Vector(a), Vector(b), Vector(c)
        return [(1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c for t in (i / steps for i in range(steps + 1))]

    def ring(self, center, radius, thickness, color, segments=16, arc=(0.0, math.tau), tilt=(0.0, 0.0, 0.0), width=None, mat=SOLID):
        """A ring (or an arc of one) of chamfered blocks, in the XZ plane, then tilted."""
        rot = Matrix.Rotation(tilt[2], 4, 'Z') @ Matrix.Rotation(tilt[1], 4, 'Y') @ Matrix.Rotation(tilt[0], 4, 'X')
        span = arc[1] - arc[0]
        count = max(2, round(segments * span / math.tau))
        chord = 2 * radius * math.sin(span / count / 2) * 1.04
        for i in range(count):
            angle = arc[0] + span * (i + 0.5) / count
            local = Vector((math.cos(angle) * radius, 0, math.sin(angle) * radius))
            before = set(self.bm.faces)
            made = bmesh.ops.create_cube(self.bm, size=1.0)
            turn = Matrix.Rotation(-(angle - math.pi / 2), 4, 'Y')
            for v in made['verts']:
                v.co = rot @ (turn @ Vector((v.co.x * chord, v.co.y * (width or thickness), v.co.z * thickness)) + local) + Vector(center)
            self._paint(self._new_faces(before), color, mat)

    def ribbon(self, points, width, color, mat=SOLID, across=(1, 0, 0), taper=1.0):
        """A flat strip through a polyline (drawn double-sided): kelp, cloth, silk."""
        across = Vector(across).normalized()
        rows = []
        for i, p in enumerate(points):
            t = i / max(1, len(points) - 1)
            w = width * (1 + (taper - 1) * t) / 2
            rows.append((self.bm.verts.new(Vector(p) - across * w), self.bm.verts.new(Vector(p) + across * w)))
        faces = [self.bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
                 for i in range(len(rows) - 1)]
        self._paint(faces, color, mat)

    # ---------------------------------------------------------- transforms
    def mark(self):
        """Everything built so far; hand it to `turn` to move only what came after."""
        self.stamp += 1
        for v in self.bm.verts:
            if v[self.gen] == 0:
                v[self.gen] = self.stamp
        return self.stamp

    def turn(self, mark, matrix):
        """Move what was built since `mark`: build a thing upright, then lean it."""
        # Stamped, not remembered: bmesh reuses freed slots and hands out new wrappers,
        # so neither identity nor order says what is new. A vert made since carries no
        # stamp yet, or a later one (a mark taken inside this one).
        for v in self.bm.verts:
            if v[self.gen] == 0 or v[self.gen] > mark:
                v.co = matrix @ v.co

    # ------------------------------------------------------------- finish
    def finish(self, materials, parent):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        floor = min(v.co.z for v in bm.verts)
        for face in bm.faces:
            if face.material_index == GLOW:
                shade, warm = 1.0, 0.0
            else:
                lit = max(0.0, face.normal.dot(LIGHT))
                height = face.calc_center_median().z - floor
                ground = 0.76 + 0.24 * min(1.0, height / 1.6)
                top = 0.1 * max(0.0, face.normal.z)
                shade = (0.6 + 0.4 * lit + top) * ground * (0.94 + 0.12 * self.rng.random())
                warm = lit * 0.5
            for loop in face.loops:
                r, g, b, _ = loop[self.col]
                r, g, b = r * shade + self.warm[0] * warm, g * shade + self.warm[1] * warm, b * shade + self.warm[2] * warm
                # Vertex colours ship linear.
                loop[self.col] = (max(0.0, r) ** 2.2, max(0.0, g) ** 2.2, max(0.0, b) ** 2.2, 1.0)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        for poly in mesh.polygons:
            poly.use_smooth = False
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def build_kit(root_name, builders):
    """Fresh scene, the two kit materials, every piece built under one root."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission in (('KitSolid', 0.0), ('KitGlow', 3.0)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.7
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        materials.append(mat)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    parts = [builder().finish(materials, root) for builder in builders]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        print(f'PIECE {obj.name} triangles {len(mesh.loop_triangles)} size {[round(d, 1) for d in obj.dimensions]}')
        total += len(mesh.loop_triangles)
    print('KIT_TRIANGLES', total)
    return parts


def export_kit(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    )
    print('WROTE', path)


def preview(parts, layout, out_png, background=(0.03, 0.035, 0.04), player=(-14, -8)):
    """A review render the way the game draws it: unlit, the painted facets carrying
    the shading. `layout` maps a piece name to (x, y, z, yaw)."""
    scene = bpy.context.scene
    for mat in bpy.data.materials:
        tree = mat.node_tree
        for node in list(tree.nodes):
            if node.type not in ('OUTPUT_MATERIAL', 'VERTEX_COLOR'):
                tree.nodes.remove(node)
        out = next(n for n in tree.nodes if n.type == 'OUTPUT_MATERIAL')
        col = next(n for n in tree.nodes if n.type == 'VERTEX_COLOR')
        emit = tree.nodes.new('ShaderNodeEmission')
        emit.inputs['Strength'].default_value = 2.0 if mat.name == 'KitGlow' else 1.0
        tree.links.new(col.outputs['Color'], emit.inputs['Color'])
        tree.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (*background, 1)
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=160, location=(0, 0, 0))
    ground = bpy.data.materials.new('ground')
    ground.use_nodes = True
    ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (background[0] * 1.6, background[1] * 1.6, background[2] * 1.6, 1)
    bpy.context.object.data.materials.append(ground)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=1.8, location=(player[0], player[1], 0.9))
    who = bpy.data.materials.new('player')
    who.use_nodes = True
    who.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1, 0.85, 0.2, 1)
    who.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.5
    bpy.context.object.data.materials.append(who)
    by_name = {obj.name: obj for obj in parts}
    for name, (x, y, z, yaw) in layout.items():
        by_name[name].location = (x, y, z)
        by_name[name].rotation_euler = (0, 0, yaw)
    light = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    light.data.energy = 0.5
    light.rotation_euler = (0.9, 0, 0.6)
    scene.collection.objects.link(light)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 35
    scene.collection.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    cam.location = Vector((3, -50, 19))
    cam.rotation_euler = (Vector((1, 0, 6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out_png)
    # `-- --preview --save file.blend` also keeps the laid-out scene, to open in the
    # Blender window with open_kit.py.
    if '--save' in sys.argv:
        target = sys.argv[sys.argv.index('--save') + 1]
        bpy.ops.wm.save_as_mainfile(filepath=target)
        print('SAVED', target)


def here(file):
    return os.path.dirname(os.path.abspath(file))
