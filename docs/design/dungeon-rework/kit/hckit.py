"""Modelling library for the Hollow Crypt kit (open-air necropolis).

Unlike the Buried Hoard kits (unlit, baked facets), this kit is LIT in game:
vertex colours carry ALBEDO plus weathering (grime toward the ground, damp
darkening in crevices, cold lichen on upward faces, worn highlights on edges),
never a baked light direction. The moon, lanterns and the soul column light it.

Three materials: KitStone (lit, everything solid), KitGlow (unlit emissive:
flames, soul light, runes), KitSilk (translucent frost silk).

Conventions (as the boss-room kits): Blender units are game yards, +Z up, a
piece's front faces -Y (the game's +Z after the glTF export), its origin is
where the runtime stands it. Edge pieces run along X with their OUTER (chasm)
side toward -Y.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

STONE, GLOW, SILK = 0, 1, 2

# ---- palette (sRGB, converted to linear at finish) -------------------------------
BONE = (0.92, 0.88, 0.78)          # bone ivory #D9D0BC (lifted: lit by a night moon)
BONE_OLD = (0.78, 0.73, 0.62)
UMBER = (0.42, 0.34, 0.26)         # grave-earth umber #4A3B2C
STONE_PALE = (0.8, 0.78, 0.74)
STONE_MID = (0.66, 0.64, 0.62)
STONE_DARK = (0.46, 0.46, 0.49)
STONE_BLUE = (0.6, 0.63, 0.7)
SLATE = (0.32, 0.33, 0.38)
IRON = (0.26, 0.25, 0.27)
TIMBER = (0.42, 0.31, 0.22)
TALLOW = (0.91, 0.84, 0.62)
TALLOW_OLD = (0.78, 0.68, 0.46)
AMBER = (1.0, 0.65, 0.29)          # tallow amber #E8A64A, as light
VIOLET = (0.48, 0.31, 0.63)        # Gravecaller violet #7B4FA0
SOUL = (0.44, 0.84, 0.66)          # soul green #6FD6A8
RIME = (0.81, 0.89, 0.94)          # rime white-blue #CFE3F0
MOSS = (0.24, 0.3, 0.26)
CLOTH = (0.25, 0.14, 0.3)


def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


class Piece:
    def __init__(self, name, seed=0, weather=1.0, lichen=0.35):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.stamp = 0
        self.rng = random.Random(sum(ord(c) for c in name) * 131 + seed)
        self.weather = weather
        self.lichen = lichen

    # ------------------------------------------------------------ painting
    def _paint(self, faces, color, mat):
        for face in faces:
            face.material_index = mat
            for loop in face.loops:
                loop[self.col] = (*color, 1.0)

    def _new_faces(self, before):
        return [f for f in self.bm.faces if f not in before]

    def vary(self, color, amount=0.08):
        k = 1 + (self.rng.random() - 0.5) * 2 * amount
        return tuple(max(0.0, min(1.0, c * k)) for c in color)

    # ---------------------------------------------------------- primitives
    def box(self, center, size, color, mat=STONE, bevel=0.0, yaw=0.0, pitch=0.0, roll=0.0, taper=1.0):
        before = set(self.bm.faces)
        made = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = made['verts']
        for v in verts:
            k = taper if v.co.z > 0 else 1.0
            v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2]))
        rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
        for v in verts:
            v.co = rot @ v.co + Vector(center)
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        if bevel > 0:
            edges = list({e for f in faces for e in f.edges})
            out = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES', clamp_overlap=True)
            self._paint(out['faces'], color, mat)
        return faces

    def prism(self, center, sides, r0, r1, height, color, mat=STONE, phase=0.0, squash=1.0, lean=(0, 0),
              axis=None, cap_top=True):
        """A lathe slice from radius r0 (foot) to r1 (top), optionally along an arbitrary axis."""
        before = set(self.bm.faces)
        rings = []
        for r, z, off in ((r0, 0.0, (0, 0)), (r1, height, lean)):
            ring = []
            for i in range(sides):
                a = phase + math.tau * i / sides
                ring.append(Vector((off[0] + math.cos(a) * r, off[1] + math.sin(a) * r * squash, z)))
            rings.append(ring)
        rot = Matrix.Identity(4)
        if axis is not None:
            ax = Vector(axis).normalized()
            rot = ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        rv = [[self.bm.verts.new(rot @ p + Vector(center)) for p in ring] for ring in rings]
        for i in range(sides):
            self.bm.faces.new((rv[0][i], rv[0][(i + 1) % sides], rv[1][(i + 1) % sides], rv[1][i]))
        self.bm.faces.new(list(reversed(rv[0])))
        if r1 > 1e-4 and cap_top:
            self.bm.faces.new(rv[1])
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def lathe(self, center, profile, sides, color, mat=STONE, phase=0.0, smooth=True):
        """A turned solid from a (radius, z) profile, bottom to top: balusters, capitals, candles.
        Its turned flanks shade smooth (a faceted drum under the moon reads as stripes)."""
        before = set(self.bm.faces)
        rings = []
        for r, z in profile:
            rings.append([self.bm.verts.new(Vector(center) + Vector((
                math.cos(phase + math.tau * i / sides) * r,
                math.sin(phase + math.tau * i / sides) * r, z))) for i in range(sides)])
        for a, b in zip(rings, rings[1:]):
            for i in range(sides):
                f = self.bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
                f.smooth = smooth
        self.bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-4:
            self.bm.faces.new(rings[-1])
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def rock(self, center, size, color, jitter=0.22, subdivisions=2, mat=STONE, flat_bottom=False):
        before = set(self.bm.faces)
        made = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=0.5)
        for v in made['verts']:
            k = 1 + (self.rng.random() - 0.5) * 2 * jitter
            co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2] * k))
            if flat_bottom and co.z < 0:
                co.z *= 0.2
            v.co = co + Vector(center)
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def sweep(self, points, r0, r1, color, sides=6, mat=STONE, squash=1.0, cap=True):
        points = [Vector(p) for p in points]
        before = set(self.bm.faces)
        rings = []
        for i, p in enumerate(points):
            ahead = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
            if ahead.length < 1e-6:
                ahead = Vector((0, 0, 1))
            ahead.normalize()
            side = ahead.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = ahead.cross(Vector((0, 1, 0)))
            side.normalize()
            up = side.cross(ahead).normalized()
            t = i / max(1, len(points) - 1)
            r = r0 + (r1 - r0) * t
            rings.append([self.bm.verts.new(p + side * math.cos(math.tau * k / sides) * r
                                            + up * math.sin(math.tau * k / sides) * r * squash)
                          for k in range(sides)])
        for i in range(len(rings) - 1):
            for k in range(sides):
                self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                   rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
        if cap:
            self.bm.faces.new(list(reversed(rings[0])))
            self.bm.faces.new(rings[-1])
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def bezier(self, a, b, c, steps=8):
        a, b, c = Vector(a), Vector(b), Vector(c)
        return [(1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c for t in (i / steps for i in range(steps + 1))]

    def spike(self, base, radius, height, color, sides=5, lean=(0, 0), mat=STONE, phase=0.0):
        return self.prism(base, sides, radius, 0.0001, height, color, mat=mat, lean=lean, phase=phase)

    def plane(self, corners, color, mat=STONE):
        before = set(self.bm.faces)
        vs = [self.bm.verts.new(Vector(c)) for c in corners]
        self.bm.faces.new(vs)
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    # ---------------------------------------------------------- composites
    def bone(self, a, b, r, color=BONE, knob=1.9):
        """A long bone: a waisted shaft with a knuckle at each end."""
        a, b = Vector(a), Vector(b)
        mid = (a + b) / 2
        self.sweep([a, a.lerp(b, 0.2), mid, a.lerp(b, 0.8), b], r * 1.05, r * 1.05, self.vary(color), sides=6)
        for end in (a, b):
            self.box(end, (r * knob * 1.8, r * knob * 1.3, r * knob * 1.3), self.vary(color), yaw=0.4)

    def skull(self, pos, size=0.5, yaw=0.0, color=BONE):
        """A skull: cranium, cheek block, jaw, and two dark eye sockets facing -Y."""
        pos = Vector(pos)
        rot = Matrix.Rotation(yaw, 4, 'Z')
        mark = self.mark()
        self.rock(Vector((0, 0, size * 0.55)), (size * 1.0, size * 1.1, size * 0.95), self.vary(color, 0.05), jitter=0.06, subdivisions=1)
        self.box((0, -size * 0.28, size * 0.22), (size * 0.72, size * 0.55, size * 0.42), self.vary(color, 0.05))
        self.box((0, -size * 0.2, size * 0.02), (size * 0.55, size * 0.5, size * 0.16), BONE_OLD)
        for sx in (-1, 1):
            self.box((sx * size * 0.2, -size * 0.52, size * 0.5), (size * 0.26, size * 0.12, size * 0.22), (0.05, 0.04, 0.05))
        self.box((0, -size * 0.55, size * 0.3), (size * 0.1, size * 0.1, size * 0.12), (0.06, 0.05, 0.05))
        self.turn(mark, Matrix.Translation(pos) @ rot)

    def candle(self, pos, height, radius, color=TALLOW, flame=True, drips=3):
        """A tallow candle with drips and a flame (glow)."""
        x, y, z = pos
        self.lathe((x, y, z), [(radius * 1.12, 0), (radius, radius * 0.4), (radius, height * 0.92), (radius * 0.86, height)], 8, self.vary(color, 0.05))
        for i in range(drips):
            a = self.rng.random() * math.tau
            dh = height * (0.25 + self.rng.random() * 0.5)
            self.prism((x + math.cos(a) * radius, y + math.sin(a) * radius, z + height - dh), 5,
                       radius * 0.22, radius * 0.18, dh, TALLOW_OLD)
        if flame:
            self.prism((x, y, z + height), 6, radius * 0.35, 0.0001, radius * 1.6 + 0.15, AMBER, mat=GLOW)

    def voussoir_arch(self, span, spring, rise, thickness, depth, color, pointed=True, blocks=13, broken=0.0,
                      center=(0, 0, 0), keystone=True, keep=None):
        """An arch of individual voussoir blocks in the XZ plane (local), springing at +-span/2."""
        cx, cy, cz = center
        half = span / 2
        pts = []
        steps = blocks // 2
        if pointed:
            # An equilateral gothic arch: each arc centred on the opposite springer.
            apex = span * math.sin(math.pi * 2 / 3)
            zs = rise / apex
            left = []
            for i in range(steps + 1):
                phi = math.pi - (math.pi / 3) * (i / steps)
                left.append((half + span * math.cos(phi), span * math.sin(phi) * zs))
            pts = left + [(-x, z) for (x, z) in reversed(left[:-1])]
        else:
            for i in range(blocks + 1):
                a = math.pi * (1 - i / blocks)
                pts.append((math.cos(a) * half, math.sin(a) * rise))
        # Order left to right.
        pts.sort(key=lambda p: p[0])
        n = len(pts) - 1
        drop = int(n * broken)
        for i in range(n):
            if broken > 0 and i >= n - drop:
                continue
            if keep is not None and i not in keep:
                continue
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            ang = math.atan2(z1 - z0, x1 - x0)
            length = math.hypot(x1 - x0, z1 - z0) * 1.02
            key = keystone and i == n // 2
            self.box((cx + mx, cy, cz + spring + mz), (length, depth * (1.12 if key else 1.0), thickness * (1.25 if key else 1.0)),
                     self.vary(color, 0.1), bevel=min(0.08, thickness * 0.1), roll=-ang)

    def masonry(self, x0, x1, z0, z1, depth, course, color, y=0.0, ruin=0.0, jitter=0.03, mortar=0.04, bevel=True,
                spread=0.14):
        """A wall of individual blocks in courses between x0..x1 and z0..z1 (face toward -Y)."""
        z = z0
        row = 0
        while z < z1 - 1e-3:
            h = min(course, z1 - z)
            # A ruined top: the courses thin out and end raggedly.
            top_frac = (z - z0) / max(1e-3, (z1 - z0))
            x = x0 - (course * 0.5 if row % 2 else 0)
            while x < x1 - 1e-3:
                w = course * (1.2 + self.rng.random() * 1.1)
                a = max(x0, x)
                b = min(x1, x + w)
                if b - a > 0.15:
                    if ruin > 0 and top_frac > 1 - ruin and self.rng.random() < (top_frac - (1 - ruin)) / ruin * 1.2:
                        x += w
                        continue
                    c = self.vary(color, spread)
                    off = (self.rng.random() - 0.5) * jitter
                    self.box(((a + b) / 2, y + off, z + h / 2), (b - a - mortar, depth, h - mortar), c,
                             bevel=min(0.06, h * 0.12) if bevel else 0.0)
                x += w
            z += h
            row += 1

    def column(self, base, height, radius, color, sides=10, capital=True, plinth=True, broken=0.0):
        x, y, z = base
        cur = z
        if plinth:
            self.box((x, y, cur + radius * 0.5), (radius * 3.0, radius * 3.0, radius), self.vary(color, 0.06), bevel=0.06)
            self.lathe((x, y, cur + radius), [(radius * 1.35, 0), (radius * 1.35, radius * 0.25), (radius * 1.1, radius * 0.45), (radius, radius * 0.6)], sides, color)
            cur += radius * 1.6
        top = z + height - (radius * 1.4 if capital else 0)
        shaft_h = (top - cur) * (1 - broken)
        drums = max(2, int(shaft_h / (radius * 2.2)))
        # Drums share one facet phase and a near-identical tone: a per-drum
        # twist or a wide tone step reads as a checkerboard up the shaft. The
        # joint reads from the chamfer at each drum's top edge.
        sides = max(sides, 16)
        for i in range(drums):
            h = shaft_h / drums
            entasis = 1.0 + 0.05 * math.sin(math.pi * (i + 0.5) / drums)
            self.lathe((x, y, cur + i * h), [(radius * entasis * 0.975, 0), (radius * entasis, 0.05),
                                             (radius * entasis * 0.995, h - 0.06), (radius * entasis * 0.97, h)], sides,
                       self.vary(color, 0.02))
        if broken > 0:
            tip = cur + shaft_h
            for i in range(4):
                a = self.rng.random() * math.tau
                self.spike((x + math.cos(a) * radius * 0.4, y + math.sin(a) * radius * 0.4, tip), radius * 0.45,
                           radius * (0.4 + self.rng.random() * 0.6), color, sides=4)
            return
        if capital:
            cz = top
            self.lathe((x, y, cz), [(radius * 0.98, 0), (radius * 1.25, radius * 0.6), (radius * 1.45, radius * 0.9)], sides, color)
            self.box((x, y, cz + radius * 1.15), (radius * 3.1, radius * 3.1, radius * 0.5), self.vary(color, 0.05), bevel=0.06)

    # ---------------------------------------------------------- transforms
    def mark(self):
        self.stamp += 1
        for v in self.bm.verts:
            if v[self.gen] == 0:
                v[self.gen] = self.stamp
        return self.stamp

    def turn(self, mark, matrix):
        for v in self.bm.verts:
            if v[self.gen] == 0 or v[self.gen] > mark:
                v.co = matrix @ v.co

    # ------------------------------------------------------------- finish
    def finish(self, materials, parent):
        """Weathered stone: albedo times a SMOOTH weathering field sampled per
        vertex (never a per-face random, which reads as a checkerboard on turned
        shafts): low-frequency tone drift, rain streaks running down, grime
        toward the ground, damp in the underside, lichen creeping over the
        upward faces. Turned solids (shafts, drums, balusters) shade smooth."""
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        floor = min(v.co.z for v in bm.verts) if bm.verts else 0.0
        top = max(v.co.z for v in bm.verts) if bm.verts else 1.0
        span = max(0.5, top - floor)
        for face in bm.faces:
            if face.material_index != STONE:
                for loop in face.loops:
                    r, g, b, _ = loop[self.col]
                    loop[self.col] = (*srgb_to_linear((r, g, b)), 1.0)
                continue
            n = face.normal
            under = 0.84 if n.z < -0.3 else 1.0
            for loop in face.loops:
                p = loop.vert.co
                height = p.z - floor
                # Grime and damp gathered in the bottom yard and a half.
                ground = 0.72 + 0.28 * min(1.0, height / 1.6)
                # Broad tone drift across the stone (about two-yard features).
                tone = 0.9 + 0.2 * _fbm(p.x * 0.55, p.y * 0.55, p.z * 0.55)
                # Rain streaks: stretched noise, long in Z, thin in XY.
                streak = 0.93 + 0.1 * _fbm(p.x * 2.4 + 7.1, p.y * 2.4 - 3.3, p.z * 0.22)
                k = ground * under * tone * streak
                k = 1 - (1 - k) * self.weather
                patch = _fbm(p.x * 0.9 + 11.0, p.y * 0.9 - 5.0, p.z * 0.9)
                lichen = max(0.0, n.z) * self.lichen * max(0.0, patch * 1.6 - 0.45)                     * min(1.0, height / span + 0.3)
                r, g, b, _ = loop[self.col]
                r, g, b = r * k, g * k, b * k
                r = r * (1 - lichen) + MOSS[0] * lichen
                g = g * (1 - lichen) + MOSS[1] * lichen
                b = b * (1 - lichen) + MOSS[2] * lichen
                loop[self.col] = (*srgb_to_linear((max(0.0, r), max(0.0, g), max(0.0, b))), 1.0)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def _hash3(x, y, z):
    h = math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return h - math.floor(h)


def _vnoise(x, y, z):
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    u, v, w = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf), zf * zf * (3 - 2 * zf)

    def lerp(a, b, t):
        return a + (b - a) * t

    c = [[[_hash3(xi + i, yi + j, zi + k) for k in (0, 1)] for j in (0, 1)] for i in (0, 1)]
    x00 = lerp(c[0][0][0], c[1][0][0], u)
    x10 = lerp(c[0][1][0], c[1][1][0], u)
    x01 = lerp(c[0][0][1], c[1][0][1], u)
    x11 = lerp(c[0][1][1], c[1][1][1], u)
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)


def _fbm(x, y, z):
    """Two octaves of smooth value noise in [0, 1)."""
    return (_vnoise(x, y, z) * 2 + _vnoise(x * 2.07 + 17.0, y * 2.07, z * 2.07)) / 3


def build_kit(root_name, builders):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitSilk', 0.0, 0.55)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        if alpha < 1.0:
            bsdf.inputs['Alpha'].default_value = alpha
        materials.append(mat)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []
    total = 0
    for builder in builders:
        obj = builder().finish(materials, root)
        parts.append(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        total += tris
        print(f'PIECE {obj.name} triangles {tris} size {[round(d, 1) for d in obj.dimensions]}')
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
