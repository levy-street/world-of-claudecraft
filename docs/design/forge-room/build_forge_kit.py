"""The Emberforge boss room kit: an ancient black-iron forge chamber, in parts.

The Buried Hoard rooms are generated from a seed (outline, cliffs, floor), so the
room is never one model. This builds the MODULAR kit the runtime scatters over that
room (src/render/hoard_room_kit.ts): one hero piece and seven reusable props.

  Kit_GreatForge   the hero: a furnace the size of a house, set into the back wall
  Kit_Anvil        a tyrant-sized anvil
  Kit_Crucible     a cradle-hung crucible of molten metal
  Kit_IngotStack   a heap of oversized ingots (filler near walls)
  Kit_Vent         a louvred forge vent with its pipes
  Kit_ForgePost    a hexagonal iron post with molten seams (cheap, instanced a lot)
  Kit_ChainHook    a hanging chain and hook; its ORIGIN is the hang point, so the
                   runtime sways it
  Kit_IronBrace    a riveted beam and strut that pins the rock wall

Look: the hoard rooms are UNLIT flat colour with hand-painted facets, so every face
carries its own baked shade in the vertex colours (a key light from the room's
side, darker toward the floor, a little per-face variation). Two materials only:
ForgeSolid (everything painted) and ForgeMolten (what glows; the runtime pulses
it). Front is -Y (the game's +Z after export), up is +Z, units are game yards.

  blender --background --python docs/design/forge-room/build_forge_kit.py
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20260921

# sRGB palette. Mostly dark: the boss, the players and the telegraphs must win.
# Against the room's cliffs (0x292729 to 0x57433d) the iron must read as iron:
# a dark core, and worn edges clearly lighter than the rock.
# (The room grades everything down toward dusk, so these sit well above the
# black they end up reading as.)
IRON = (0.36, 0.335, 0.34)
IRON_WORN = (0.56, 0.49, 0.43)
IRON_EDGE = (0.74, 0.65, 0.56)
STONE = (0.45, 0.41, 0.385)
STONE_LIGHT = (0.6, 0.54, 0.49)
SOOT = (0.075, 0.068, 0.07)
BURNT = (0.29, 0.165, 0.1)
DARK_RED = (0.34, 0.115, 0.075)
MOLTEN = (1.0, 0.47, 0.11)
HOT = (1.0, 0.76, 0.34)

SOLID, GLOW = 0, 1
LIGHT = Vector((-0.42, -0.55, 0.72)).normalized()


class Piece:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.rng = random.Random(hash(name) % 100000 + SEED)

    def _paint(self, faces, color, mat):
        for face in faces:
            face.material_index = mat
            for loop in face.loops:
                loop[self.col] = (*color, 1.0)

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
        return verts

    def prism(self, center, sides, r0, r1, height, color, mat=SOLID, axis='Z', phase=0.0, squash=1.0):
        """A lathe slice: `sides` round, radius r0 at the bottom and r1 at the top."""
        rot = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'Y': Matrix.Rotation(-math.pi / 2, 4, 'X')}[axis]
        rings = []
        for r, z in ((r0, 0.0), (r1, height)):
            rings.append([
                self.bm.verts.new(rot @ Vector((
                    math.cos(phase + math.tau * i / sides) * r,
                    math.sin(phase + math.tau * i / sides) * r * squash,
                    z,
                )) + Vector(center))
                for i in range(sides)
            ])
        faces = []
        for i in range(sides):
            faces.append(self.bm.faces.new((rings[0][i], rings[0][(i + 1) % sides],
                                            rings[1][(i + 1) % sides], rings[1][i])))
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        faces.append(self.bm.faces.new(rings[1]))
        self._paint(faces, color, mat)

    def finish(self, materials, parent):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        floor = min(v.co.z for v in bm.verts)
        for face in bm.faces:
            if face.material_index == GLOW:
                shade = 1.0
            else:
                lit = max(0.0, face.normal.dot(LIGHT))
                height = face.calc_center_median().z - floor
                ground = 0.74 + 0.26 * min(1.0, height / 1.6)
                top = 0.1 * max(0.0, face.normal.z)
                shade = (0.6 + 0.4 * lit + top) * ground * (0.94 + 0.12 * self.rng.random())
            # Forge light: the faces the key light catches run warm, so iron reads
            # as iron against the room's dusk instead of as a black cut-out.
            warm = 0.0 if face.material_index == GLOW else max(0.0, face.normal.dot(LIGHT)) * 0.5
            for loop in face.loops:
                r, g, b, _ = loop[self.col]
                r, g, b = r + 0.13 * warm, g + 0.055 * warm, b + 0.01 * warm
                # Vertex colours ship linear.
                loop[self.col] = ((r * shade) ** 2.2, (g * shade) ** 2.2, (b * shade) ** 2.2, 1.0)
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


def rivets(p, points, size=0.16, color=IRON_EDGE):
    for point in points:
        p.box(point, (size, size, size), color, bevel=size * 0.3)


# ------------------------------------------------------------------ the hero
def great_forge():
    """26 wide, 9 deep, 19 tall. Its back (+Y) is buried in the cliff."""
    p = Piece('Kit_GreatForge')
    # The plinth and its hearth step, in dark stone slabs.
    p.box((0, 1.2, 1.1), (27, 9.5, 2.2), STONE, bevel=0.35)
    p.box((0, -3.3, 0.5), (17, 3.2, 1.0), STONE_LIGHT, bevel=0.25)
    for x in (-10.5, -6.3, -2.1, 2.1, 6.3, 10.5):
        p.box((x, -3.62, 1.35), (3.7, 0.5, 1.4), STONE_LIGHT if int(x) % 2 else STONE, bevel=0.12)
    # The furnace body, black iron, leaning back a touch.
    p.box((0, 1.6, 7.6), (16.5, 7.2, 10.8), IRON, bevel=0.5, taper=0.93)
    # The mouth. Nothing is cut: a soot panel lies on the body's face, the glowing
    # throat lies on the soot, and the jambs and lintel stand proud of both, so the
    # fire reads as deep inside a frame.
    p.box((0, -2.02, 5.6), (9.4, 0.12, 6.9), SOOT)
    p.box((0, -2.1, 5.35), (8.2, 0.1, 5.9), MOLTEN, mat=GLOW)
    p.box((0, -2.16, 3.4), (6.6, 0.1, 1.9), HOT, mat=GLOW)
    p.box((0, -2.75, 2.45), (9.8, 1.5, 0.55), IRON_WORN, bevel=0.14)
    # Its frame: jambs, a lintel, a keystone, and fire bars across the throat.
    for x in (-5.35, 5.35):
        p.box((x, -2.35, 5.7), (1.6, 1.6, 7.2), IRON_WORN, bevel=0.22)
        p.box((x, -2.5, 2.5), (2.1, 2.0, 0.8), IRON_EDGE, bevel=0.16)
        p.box((x, -2.5, 9.15), (2.1, 2.0, 0.7), IRON_EDGE, bevel=0.16)
        rivets(p, [(x, -3.2, z) for z in (3.6, 5.0, 6.4, 7.8)], 0.26)
    p.box((0, -2.35, 9.85), (12.4, 1.7, 1.5), IRON_WORN, bevel=0.24)
    p.box((0, -2.6, 10.1), (2.4, 2.1, 2.3), IRON_EDGE, bevel=0.3, taper=0.8)
    for x in (-3.0, -1.5, 0.0, 1.5, 3.0):
        p.box((x, -2.4, 5.5), (0.34, 0.34, 6.2), SOOT)
    # Buttresses with a molten seam down each, and riveted straps on the body.
    for x in (-9.6, 9.6):
        p.box((x, -0.4, 5.6), (2.6, 4.2, 7.2), IRON_WORN, bevel=0.3, taper=0.78)
        p.box((x, -2.56, 5.2), (0.34, 0.12, 5.2), MOLTEN, mat=GLOW)
    for z in (11.4, 12.6):
        p.box((0, -2.0, z), (16.2, 0.35, 0.5), IRON_EDGE, bevel=0.08)
    rivets(p, [(x, -2.25, 12.0) for x in (-7, -5, -3, 3, 5, 7)], 0.3)
    # The chimney: a collar, a tapered stack with vent slits, a hot crown.
    p.box((0, 2.0, 13.6), (8.4, 6.0, 1.4), IRON_WORN, bevel=0.3)
    p.box((0, 2.2, 17.4), (5.6, 4.6, 6.4), IRON, bevel=0.35, taper=0.72)
    for x in (-1.3, 0.0, 1.3):
        p.box((x, -0.08, 16.6), (0.5, 0.2, 2.2), MOLTEN, mat=GLOW)
    p.box((0, 2.2, 20.9), (4.8, 4.0, 0.9), IRON_EDGE, bevel=0.22)
    p.box((0, 2.2, 21.45), (3.3, 2.7, 0.3), HOT, mat=GLOW)
    # Two great pipes out of its shoulders, up and back into the rock.
    for side in (-1, 1):
        x = side * 8.9
        p.prism((x, 1.2, 9.4), 8, 1.15, 1.15, 5.2, IRON_WORN)
        p.prism((x, 1.2, 14.4), 8, 1.35, 1.35, 0.5, IRON_EDGE)
        p.prism((x, 1.0, 15.6), 8, 1.15, 1.15, 4.6, IRON_WORN, axis='Y')
        p.prism((x, 1.2, 9.1), 8, 1.4, 1.4, 0.45, IRON_EDGE)
    # Flanking slag troughs: the molten runs off to either side, low and thin.
    for side in (-1, 1):
        p.box((side * 11.2, -3.2, 2.3), (4.4, 1.5, 0.36), IRON, bevel=0.1)
        p.box((side * 11.2, -3.2, 2.5), (3.8, 0.9, 0.1), MOLTEN, mat=GLOW)
    return p


# ------------------------------------------------------------------- the props
def anvil():
    """4.6 long (along X), 2.6 tall: a tyrant's anvil."""
    p = Piece('Kit_Anvil')
    p.box((0, 0, 0.35), (3.4, 2.2, 0.7), STONE, bevel=0.16)
    p.box((0, 0, 0.95), (2.6, 1.7, 0.6), IRON_WORN, bevel=0.14)
    p.box((0, 0, 1.55), (1.5, 1.1, 0.8), IRON, bevel=0.12, taper=1.18)
    p.box((0.15, 0, 2.25), (3.3, 1.55, 0.75), IRON, bevel=0.16)
    # The horn, the heel, and a worn bright face.
    p.box((-2.35, 0, 2.27), (1.7, 1.0, 0.5), IRON, bevel=0.2, roll=math.radians(7), taper=0.55)
    p.box((2.15, 0, 2.38), (0.8, 1.35, 0.42), IRON_WORN, bevel=0.1)
    p.box((0.2, 0, 2.64), (2.9, 1.3, 0.06), IRON_EDGE)
    p.box((0, -1.12, 0.72), (2.2, 0.08, 0.12), MOLTEN, mat=GLOW)
    p.box((0, 1.12, 0.72), (2.2, 0.08, 0.12), MOLTEN, mat=GLOW)
    return p


def crucible():
    """A 4.2 wide cradle with a bowl of molten metal hung in it, 3.6 tall."""
    p = Piece('Kit_Crucible')
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        p.box((sx * 1.75, sy * 1.45, 1.55), (0.42, 0.42, 3.1), IRON_WORN, bevel=0.08,
              roll=math.radians(-sx * 7), pitch=math.radians(sy * 6))
        p.box((sx * 1.95, sy * 1.6, 0.18), (0.95, 0.95, 0.36), STONE, bevel=0.1)
    for sy in (-1, 1):
        p.box((0, sy * 1.32, 2.95), (4.0, 0.34, 0.34), IRON_EDGE, bevel=0.07)
    # The bowl: a ten-sided lathe, a thick rim, the metal, a lip and a drip.
    p.prism((0, 0, 0.95), 10, 0.85, 1.55, 0.9, IRON)
    p.prism((0, 0, 1.85), 10, 1.55, 1.85, 1.05, IRON)
    p.prism((0, 0, 2.9), 10, 2.02, 2.02, 0.3, IRON_WORN)
    p.prism((0, 0, 3.12), 10, 1.62, 1.62, 0.1, MOLTEN, mat=GLOW)
    p.prism((0, 0, 3.16), 10, 0.85, 0.85, 0.08, HOT, mat=GLOW)
    p.box((0, -2.05, 2.98), (0.75, 0.7, 0.3), IRON_WORN, bevel=0.08)
    p.box((0, -2.22, 2.2), (0.24, 0.12, 1.6), MOLTEN, mat=GLOW)
    p.box((0, -2.3, 0.06), (1.3, 0.95, 0.1), MOLTEN, mat=GLOW)
    for a in range(4):
        angle = math.tau * (a + 0.5) / 4
        rivets(p, [(math.cos(angle) * 2.0, math.sin(angle) * 2.0, 3.05)], 0.22)
    return p


def ingot_stack():
    """About 4.2 x 3.0 x 1.9: three uneven courses of trapezoid ingots."""
    p = Piece('Kit_IngotStack')
    rng = random.Random(SEED + 7)
    courses = (((-1.35, -0.75), (0.1, -0.85), (1.45, -0.7), (-0.7, 0.75), (0.8, 0.8)),
               ((-0.7, -0.35), (0.75, -0.3), (0.1, 0.75)),
               ((0.05, 0.05),))
    for level, course in enumerate(courses):
        for i, (x, y) in enumerate(course):
            warm = (level + i) % 4 == 0
            p.box((x + rng.uniform(-0.12, 0.12), y + rng.uniform(-0.1, 0.1), 0.3 + level * 0.58),
                  (1.35, 0.72, 0.56), BURNT if warm else (IRON if (i + level) % 2 else IRON_WORN),
                  bevel=0.07, taper=0.78, yaw=rng.uniform(-0.22, 0.22) + (math.pi / 2 if level == 1 else 0))
    # One fresh ingot, still hot, fallen off the heap.
    p.box((2.35, 0.55, 0.3), (1.35, 0.72, 0.56), DARK_RED, bevel=0.07, taper=0.78, yaw=0.9)
    p.box((2.35, 0.55, 0.6), (0.95, 0.4, 0.04), MOLTEN, mat=GLOW, yaw=0.9)
    return p


def vent():
    """A 4.4 wide, 5.2 tall louvred vent with two pipes into the wall behind it."""
    p = Piece('Kit_Vent')
    p.box((0, 0.2, 0.3), (4.8, 3.4, 0.6), STONE, bevel=0.14)
    p.box((0, 0.3, 2.3), (4.2, 2.8, 3.4), IRON, bevel=0.22)
    p.box((0, -1.05, 2.3), (3.2, 0.3, 2.3), MOLTEN, mat=GLOW)
    for i in range(6):
        p.box((0, -1.2, 1.35 + i * 0.38), (3.4, 0.5, 0.13), IRON_WORN, pitch=math.radians(-32))
    p.box((0, -1.22, 3.62), (3.9, 0.5, 0.36), IRON_EDGE, bevel=0.08)
    p.box((0, -1.22, 0.98), (3.9, 0.5, 0.36), IRON_EDGE, bevel=0.08)
    for x in (-1.85, 1.85):
        p.box((x, -1.22, 2.3), (0.36, 0.5, 2.9), IRON_EDGE, bevel=0.08)
        rivets(p, [(x, -1.5, z) for z in (1.4, 2.3, 3.2)], 0.17)
    # The piston housing on top, and the pipes.
    p.box((0, 0.3, 4.35), (2.6, 2.0, 0.7), IRON_WORN, bevel=0.14)
    p.prism((0, 0.3, 4.7), 8, 0.62, 0.62, 0.9, IRON_EDGE)
    for x in (-1.25, 1.25):
        p.prism((x, 0.9, 4.0), 8, 0.42, 0.42, 1.6, IRON_WORN)
        p.prism((x, 0.75, 5.4), 8, 0.42, 0.42, 2.4, IRON_WORN, axis='Y')
        p.prism((x, 0.9, 5.2), 8, 0.55, 0.55, 0.3, IRON_EDGE)
    return p


def forge_post():
    """A 4.4 tall hexagonal post: cheap, and instanced a lot."""
    p = Piece('Kit_ForgePost')
    p.prism((0, 0, 0), 6, 0.95, 0.8, 0.5, STONE)
    p.prism((0, 0, 0.5), 6, 0.58, 0.5, 3.1, IRON)
    p.prism((0, 0, 1.05), 6, 0.62, 0.62, 0.14, MOLTEN, mat=GLOW)
    p.prism((0, 0, 2.85), 6, 0.57, 0.57, 0.14, MOLTEN, mat=GLOW)
    p.prism((0, 0, 3.6), 6, 0.78, 0.86, 0.42, IRON_WORN)
    p.prism((0, 0, 4.02), 6, 0.62, 0.3, 0.4, IRON_EDGE)
    p.box((0, -0.62, 3.2), (0.2, 0.36, 0.42), IRON_EDGE, bevel=0.05)
    return p


def chain_hook():
    """A 6.4 long chain and hook, hanging DOWN from its origin."""
    p = Piece('Kit_ChainHook')
    p.box((0, 0, -0.12), (0.7, 0.7, 0.24), IRON_EDGE, bevel=0.06)
    z = -0.3
    for i in range(9):
        turned = i % 2 == 1
        w, d = (0.14, 0.5) if turned else (0.5, 0.14)
        for side in (-1, 1):
            if turned:
                p.box((0, side * 0.2, z - 0.28), (0.13, 0.13, 0.62), IRON_WORN)
            else:
                p.box((side * 0.2, 0, z - 0.28), (0.13, 0.13, 0.62), IRON_WORN)
        p.box((0, 0, z), (w, d, 0.13), IRON_WORN)
        p.box((0, 0, z - 0.56), (w, d, 0.13), IRON_WORN)
        z -= 0.47
    # The hook: a shank, a swept belly of short blocks, a point.
    p.box((0, 0, z - 0.45), (0.3, 0.3, 0.9), IRON, bevel=0.06)
    cx, cz, radius = 0.55, z - 0.95, 0.55
    for k in range(6):
        angle = math.pi + k * math.pi / 5
        p.box((cx + math.cos(angle) * radius, 0, cz + math.sin(angle) * radius),
              (0.3, 0.3, 0.46), IRON, roll=-(angle + math.pi / 2) + math.pi / 2, bevel=0.05)
    p.box((cx + radius + 0.02, 0, cz + 0.42), (0.2, 0.22, 0.6), IRON_EDGE, taper=0.3)
    return p


def iron_brace():
    """A 10 tall riveted beam with a raking strut: it pins the rock wall."""
    p = Piece('Kit_IronBrace')
    p.box((0, 0.2, 0.4), (2.4, 1.7, 0.8), STONE, bevel=0.16)
    p.box((0, 0.35, 5.2), (1.25, 0.9, 9.6), IRON, bevel=0.12)
    p.box((0, -0.05, 5.2), (1.7, 0.22, 9.2), IRON_WORN)
    p.box((0, -1.35, 3.0), (0.8, 0.7, 6.4), IRON_WORN, bevel=0.1, pitch=math.radians(-24))
    p.box((0, -2.55, 0.35), (1.6, 1.3, 0.7), STONE_LIGHT, bevel=0.14)
    for z in (2.0, 5.0, 8.0):
        p.box((0, 0.2, z), (2.3, 1.2, 0.55), IRON_EDGE, bevel=0.1)
        rivets(p, [(-0.85, -0.45, z), (0.85, -0.45, z)], 0.2)
    p.box((0, -0.2, 9.6), (0.32, 0.12, 0.9), MOLTEN, mat=GLOW)
    p.box((0, 0.3, 10.2), (2.0, 1.4, 0.5), IRON_EDGE, bevel=0.12)
    return p


BUILDERS = (great_forge, anvil, crucible, ingot_stack, vent, forge_post, chain_hook, iron_brace)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission in (('ForgeSolid', 0.0), ('ForgeMolten', 3.0)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
        bsdf.inputs['Roughness'].default_value = 0.7
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        materials.append(mat)
    root = bpy.data.objects.new('ForgeKit_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    parts = []
    for i, builder in enumerate(BUILDERS):
        obj = builder().finish(materials, root)
        parts.append(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        dims = [round(d, 1) for d in obj.dimensions]
        print(f'PIECE {obj.name} triangles {len(mesh.loop_triangles)} size {dims}')
        total += len(mesh.loop_triangles)
    print('KIT_TRIANGLES', total)
    return parts


if __name__ == '__main__':
    build()
    bpy.ops.object.select_all(action='SELECT')
    out = os.path.join(HERE, 'forge_kit_components.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
    )
    print('WROTE', out)
