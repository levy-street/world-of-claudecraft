"""Buried Hoard reward chest: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/reward-chest/build_chest.py

It rebuilds the whole chest from the numbers below and writes
docs/design/reward-chest/chest_components.glb, the file the shipping build
(scripts/assets/reward_chest/build.mjs) optimizes into the game asset.

Original project art authored procedurally from the owner's brief. No third-party
mesh, texture or reference image is used.

Conventions the runtime relies on (src/render/hoard_reward_chest.ts):
  - Blender is Z-up with the chest FRONT toward -Y; the glTF export turns that
    into Y-up with the front toward +Z, the game's forward.
  - Chest_Lid has its origin ON the hinge line (back top edge of the base), so
    the runtime opens it with one rotation about X and nothing else.
  - Materials are named, flat colours, no textures: Wood, WoodDark, Metal,
    MetalLight are ordinary surfaces; Glow (clasp gem, strap inlays) and
    InnerGlow (the light inside) are the two the runtime tints by rarity.
"""
import math
import os

import bmesh
import bpy

# ---------------------------------------------------------------- tunables (metres)
CHEST_WIDTH = 1.5
CHEST_DEPTH = 0.96
BASE_HEIGHT = 0.64
FOOT_HEIGHT = 0.09
BASE_TAPER = 0.93  # footprint of the base bottom relative to its top
LID_OVERHANG = 0.055  # "slightly oversized lid"
LID_LIP = 0.11  # vertical wall before the arch starts
LID_RISE = 0.4  # arch height above the lip
LID_FACETS = 6
STRAP_X = 0.46
STRAP_WIDTH = 0.18
RIVET_RADIUS = 0.042
STRAP_PROUD = 0.03
INLAY_WIDTH = 0.04
CORNER = 0.2
BEVEL = 0.016

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chest_components.glb')

MATERIALS = [
    # name, colour (linear-ish sRGB picked to sit with the WoC palette), metallic, roughness, emission
    ('Wood', (0.33, 0.15, 0.065), 0.0, 0.8, 0.0),
    ('WoodDark', (0.13, 0.06, 0.03), 0.0, 0.88, 0.0),
    ('Metal', (0.075, 0.085, 0.105), 0.55, 0.5, 0.0),
    # The trim that says "treasure": warm brass on every rim, rivet and clasp.
    ('MetalLight', (0.72, 0.47, 0.13), 0.75, 0.34, 0.0),
    ('Glow', (0.55, 0.78, 1.0), 0.0, 0.4, 3.0),
    ('InnerGlow', (0.75, 0.9, 1.0), 0.0, 0.4, 6.0),
]
MAT = {name: index for index, (name, *_rest) in enumerate(MATERIALS)}


def make_materials():
    out = []
    for name, color, metallic, roughness, emission in MATERIALS:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.diffuse_color = (*color, 1)
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
        out.append(mat)
    return out


# ---------------------------------------------------------------- bmesh helpers
def add_box(bm, center, size, mat, taper=1.0):
    """Axis-aligned box; `taper` scales the BOTTOM footprint (a heavier top)."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    verts = []
    for dz, scale in ((-sz, taper), (sz, 1.0)):
        for dx, dy in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            verts.append(bm.verts.new((cx + dx * scale, cy + dy * scale, cz + dz)))
    quads = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for quad in quads:
        face = bm.faces.new([verts[i] for i in quad])
        face.material_index = mat


def lid_profile(grow=0.0):
    """(y, z) points of the lid cross-section in LID space: the hinge is the
    origin, the lid reaches toward -Y. `grow` pushes it outward (straps)."""
    half = CHEST_DEPTH / 2 + LID_OVERHANG + grow
    points = [(-half, 0.0), (-half, LID_LIP)]
    for step in range(1, LID_FACETS):
        angle = math.pi * step / LID_FACETS
        points.append((-math.cos(angle) * half, LID_LIP + math.sin(angle) * (LID_RISE + grow)))
    points += [(half, LID_LIP), (half, 0.0)]
    # Into lid space: the hinge sits on the back top edge of the base.
    return [(y - CHEST_DEPTH / 2, z) for y, z in points]


def add_extrusion(bm, profile, x0, x1, mat, under_mat=None):
    """Extrude a closed (y, z) profile along X, capped at both ends."""
    near = [bm.verts.new((x0, y, z)) for y, z in profile]
    far = [bm.verts.new((x1, y, z)) for y, z in profile]
    count = len(profile)
    for index in range(count):
        nxt = (index + 1) % count
        face = bm.faces.new([near[index], near[nxt], far[nxt], far[index]])
        # The closing edge is the underside of the lid.
        face.material_index = under_mat if (under_mat is not None and nxt == 0) else mat
    bm.faces.new(list(reversed(near))).material_index = mat
    bm.faces.new(far).material_index = mat


def add_prism(bm, sides, radius, depth, center, mat, spin=0.0, squash=1.0):
    """A flat prism whose axis is Y (it sits on the chest front)."""
    cx, cy, cz = center
    front, back = [], []
    for index in range(sides):
        angle = spin + math.tau * index / sides
        x = cx + math.cos(angle) * radius
        z = cz + math.sin(angle) * radius * squash
        front.append(bm.verts.new((x, cy - depth / 2, z)))
        back.append(bm.verts.new((x, cy + depth / 2, z)))
    for index in range(sides):
        nxt = (index + 1) % sides
        bm.faces.new([front[nxt], front[index], back[index], back[nxt]]).material_index = mat
    bm.faces.new(front).material_index = mat
    bm.faces.new(list(reversed(back))).material_index = mat


def add_gem(bm, center, radius, depth, mat):
    """A faceted gem pointing out of the clasp (toward -Y)."""
    cx, cy, cz = center
    ring = []
    for index in range(6):
        angle = math.tau * index / 6 + math.pi / 6
        ring.append(bm.verts.new((cx + math.cos(angle) * radius, cy, cz + math.sin(angle) * radius)))
    tip = bm.verts.new((cx, cy - depth, cz))
    back = bm.verts.new((cx, cy + depth * 0.4, cz))
    for index in range(6):
        nxt = (index + 1) % 6
        bm.faces.new([ring[nxt], ring[index], tip]).material_index = mat
        bm.faces.new([ring[index], ring[nxt], back]).material_index = mat


def finish(name, bm, materials, parent, location=(0, 0, 0), bevel=BEVEL):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    if bevel > 0:
        # One-segment chamfers: clean bevels that catch the light, flat shaded.
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
    return obj


# ---------------------------------------------------------------- the chest
def build_base(materials, root):
    bm = bmesh.new()
    body_h = BASE_HEIGHT - FOOT_HEIGHT
    body_z = FOOT_HEIGHT + body_h / 2
    add_box(bm, (0, 0, body_z), (CHEST_WIDTH, CHEST_DEPTH, body_h), MAT['Wood'], BASE_TAPER)
    # Broad readable panels: two dark plank seams on the long faces.
    for seam in (0.36, 0.66):
        z = FOOT_HEIGHT + body_h * seam
        add_box(bm, (0, 0, z), (CHEST_WIDTH * 0.985, CHEST_DEPTH + 0.012, 0.028), MAT['WoodDark'])
    # Heavy skirt and a lighter top rim: exaggerated, readable edges.
    add_box(bm, (0, 0, FOOT_HEIGHT + 0.07), (CHEST_WIDTH * BASE_TAPER + 0.09, CHEST_DEPTH * BASE_TAPER + 0.09, 0.14), MAT['Metal'])
    add_box(bm, (0, 0, BASE_HEIGHT - 0.045), (CHEST_WIDTH + 0.05, CHEST_DEPTH + 0.05, 0.09), MAT['MetalLight'])
    # Chunky feet.
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(
                bm,
                (sx * (CHEST_WIDTH / 2 - 0.16), sy * (CHEST_DEPTH / 2 - 0.13), FOOT_HEIGHT / 2 + 0.01),
                (0.3, 0.26, FOOT_HEIGHT + 0.02),
                MAT['Metal'],
                0.82,
            )
    # Reinforced corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(
                bm,
                (sx * (CHEST_WIDTH / 2 - CORNER / 2 + 0.03), sy * (CHEST_DEPTH / 2 - CORNER / 2 + 0.03), body_z),
                (CORNER, CORNER, body_h * 0.98),
                MAT['Metal'],
                BASE_TAPER,
            )
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_box(
                bm,
                (sx * (CHEST_WIDTH / 2 - CORNER / 2 + 0.035), sy * (CHEST_DEPTH / 2 - CORNER / 2 + 0.035), FOOT_HEIGHT + body_h * 0.2),
                (CORNER + 0.02, CORNER + 0.02, 0.07),
                MAT['MetalLight'],
            )
    # Straps on the front and back, each with a glowing inlay down its centre.
    for sx in (-1, 1):
        for sy in (-1, 1):
            y = sy * (CHEST_DEPTH / 2 + STRAP_PROUD / 2 - 0.004)
            add_box(bm, (sx * STRAP_X, y, body_z), (STRAP_WIDTH, STRAP_PROUD + 0.02, body_h * 0.97), MAT['Metal'])
            add_box(
                bm,
                (sx * STRAP_X, sy * (CHEST_DEPTH / 2 + STRAP_PROUD + 0.004), body_z + 0.02),
                (INLAY_WIDTH, 0.014, body_h * 0.5),
                MAT['Glow'],
            )
            # Fat brass rivets above and below the inlay: readable from far away.
            for rz in (FOOT_HEIGHT + body_h * 0.12, FOOT_HEIGHT + body_h * 0.9):
                add_prism(
                    bm,
                    6,
                    RIVET_RADIUS,
                    0.03,
                    (sx * STRAP_X, sy * (CHEST_DEPTH / 2 + STRAP_PROUD + 0.012), rz),
                    MAT['MetalLight'],
                )
    return finish('Chest_Base', bm, materials, root)


def build_lid(materials, root):
    bm = bmesh.new()
    half_w = CHEST_WIDTH / 2 + LID_OVERHANG
    # The shell: its underside is InnerGlow, so the gap reads as lit from within.
    add_extrusion(bm, lid_profile(), -half_w, half_w, MAT['Wood'], MAT['InnerGlow'])
    # A lighter lip all round the lid, matching the base rim.
    lip_y = -CHEST_DEPTH / 2
    add_box(
        bm,
        (0, lip_y, LID_LIP * 0.42),
        (CHEST_WIDTH + LID_OVERHANG * 2 + 0.045, CHEST_DEPTH + LID_OVERHANG * 2 + 0.045, LID_LIP * 0.7),
        MAT['MetalLight'],
    )
    # Straps over the arch (continuing the base straps) plus heavy end bands.
    for sx in (-1, 1):
        add_extrusion(bm, lid_profile(STRAP_PROUD), sx * STRAP_X - STRAP_WIDTH / 2, sx * STRAP_X + STRAP_WIDTH / 2, MAT['Metal'])
        add_extrusion(
            bm,
            lid_profile(STRAP_PROUD + 0.012),
            sx * STRAP_X - INLAY_WIDTH / 2,
            sx * STRAP_X + INLAY_WIDTH / 2,
            MAT['Glow'],
        )
        # Inset from the lid end, so the wooden end cap stays visible.
        end = sx * (half_w - 0.13)
        add_extrusion(bm, lid_profile(STRAP_PROUD * 0.8), end - 0.06, end + 0.06, MAT['Metal'])
        add_extrusion(bm, lid_profile(STRAP_PROUD * 0.8 + 0.01), end - 0.018, end + 0.018, MAT['MetalLight'])
    # The hasp: comes down from the lid front over the clasp.
    front = -CHEST_DEPTH - LID_OVERHANG
    add_box(bm, (0, front - 0.018, LID_LIP * 0.2), (0.24, 0.05, LID_LIP * 1.5), MAT['MetalLight'])
    return finish('Chest_Lid', bm, materials, root, location=(0, CHEST_DEPTH / 2, BASE_HEIGHT))


def build_lock(materials, root):
    bm = bmesh.new()
    y = -CHEST_DEPTH / 2 - 0.03
    z = BASE_HEIGHT - 0.2
    add_prism(bm, 6, 0.2, 0.07, (0, y, z), MAT['Metal'], spin=math.pi / 6, squash=1.12)
    add_prism(bm, 6, 0.145, 0.085, (0, y - 0.004, z), MAT['MetalLight'], spin=math.pi / 6, squash=1.12)
    add_gem(bm, (0, y - 0.04, z), 0.115, 0.11, MAT['Glow'])
    return finish('Chest_Lock', bm, materials, root, bevel=0.008)


def build_inner_glow(materials, root):
    bm = bmesh.new()
    add_box(bm, (0, 0, BASE_HEIGHT - 0.012), (CHEST_WIDTH - 0.1, CHEST_DEPTH - 0.1, 0.024), MAT['InnerGlow'])
    return finish('Chest_InnerGlow', bm, materials, root, bevel=0)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = make_materials()
    root = bpy.data.objects.new('ClueRewardChest_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    parts = [
        build_base(materials, root),
        build_lid(materials, root),
        build_lock(materials, root),
        build_inner_glow(materials, root),
    ]
    return root, parts


def triangle_count(parts):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
    return total


if __name__ == '__main__':
    root, parts = build()
    print(f'CHEST_TRIANGLES {triangle_count(parts)}')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f'WROTE {OUT}')
