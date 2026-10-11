"""Emberforge's FORGE HAMMER: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/forge-hammer/build_forge_hammer.py

It rebuilds the hammer from the numbers below and writes, beside this file,
forge_hammer_components.glb, which the shipping build
(scripts/assets/forge_hammer/build.mjs) optimizes into public/vfx/forge-hammer/.

Original project art authored procedurally. No third-party mesh, texture or
reference image is used.

Conventions the runtime relies on (src/render/hoard_forge_hammer.ts):
  - Blender is Z-up; the glTF export turns that into Y-up. One Blender metre is
    one game yard.
  - The hammer hangs HEAD DOWN, the way it falls: the striking face sits on the
    origin, so the runtime places the root on the floor where it lands and only
    ever moves it up and down. The head's footprint stays inside IMPACT_RADIUS,
    copied from src/sim/rift/hoard_forge_hammer_core.ts.
  - Everything the runtime tints is its own named part:
      Hammer_Head     the block, chamfered and scarred
      Hammer_Face     the molten striking face and its rim (glows hottest)
      Hammer_Runes    forge marks cut into the cheeks (they flare on impact)
      Hammer_Collar   the banded socket the haft drives into
      Hammer_Haft     the haft, wrapped
      Hammer_Pommel   the ring at its end
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
IMPACT_RADIUS = 4.5  # FORGE_HAMMER.impactRadius

# ---------------------------------------------------------------- tunables
HEAD_WIDTH = 5.2  # across the two faces (x)
HEAD_DEPTH = 3.3  # y
HEAD_HEIGHT = 3.4  # z
CHAMFER = 0.5
FACE_INSET = 0.28
HAFT_RADIUS = 0.42
HAFT_LENGTH = 7.6
WRAPS = 5
SEED = 20260921

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('ForgeIron', (0.13, 0.12, 0.13), 0.85, 0.5, 0.0),
    ('ForgeIronWorn', (0.26, 0.2, 0.17), 0.7, 0.62, 0.0),
    ('Molten', (1.0, 0.42, 0.08), 0.0, 0.4, 5.0),
    ('Leather', (0.2, 0.11, 0.07), 0.0, 0.85, 0.0),
]


def make_materials(table):
    out = {}
    for name, color, metallic, roughness, emission in table:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.diffuse_color = (*color, 1)
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
        bsdf.inputs['Emission Strength'].default_value = emission
        out[name] = mat
    return out


def finish(name, bm, materials, parent):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def chamfered_block(bm, half_x, half_y, z0, z1, chamfer, mat_index, jitter=None):
    """An octagonal-section block: a box with its four vertical edges cut."""
    ring = [
        (half_x - chamfer, half_y),
        (half_x, half_y - chamfer),
        (half_x, -half_y + chamfer),
        (half_x - chamfer, -half_y),
        (-half_x + chamfer, -half_y),
        (-half_x, -half_y + chamfer),
        (-half_x, half_y - chamfer),
        (-half_x + chamfer, half_y),
    ]
    rows = []
    for z, squeeze in ((z0, 0.9), (z0 + chamfer, 1.0), (z1 - chamfer, 1.0), (z1, 0.86)):
        row = []
        for x, y in ring:
            dx = jitter.uniform(-0.04, 0.04) if jitter else 0.0
            row.append(bm.verts.new((x * squeeze + dx, y * squeeze, z)))
        rows.append(row)
    n = len(ring)
    for r in range(len(rows) - 1):
        for i in range(n):
            face = bm.faces.new((rows[r][i], rows[r][(i + 1) % n], rows[r + 1][(i + 1) % n], rows[r + 1][i]))
            face.material_index = mat_index
    top = bm.faces.new(list(reversed(rows[-1])))
    top.material_index = mat_index
    return rows[0]


def build_head(mats, root):
    rng = random.Random(SEED)
    bm = bmesh.new()
    bottom = chamfered_block(bm, HEAD_WIDTH / 2, HEAD_DEPTH / 2, FACE_INSET, HEAD_HEIGHT, CHAMFER, 0, rng)
    # A worn band round the middle, where generations of blows have polished it.
    for face in bm.faces:
        z = sum(v.co.z for v in face.verts) / len(face.verts)
        if 1.2 < z < 2.3:
            face.material_index = 1
    del bottom
    return finish('Hammer_Head', bm, [mats['ForgeIron'], mats['ForgeIronWorn']], root)


def build_face(mats, root):
    """The striking face: a molten slab under the head, a finger proud of it all
    round, so the glow reads as a rim from any angle."""
    bm = bmesh.new()
    hx = HEAD_WIDTH / 2 * 0.9 + 0.12
    hy = HEAD_DEPTH / 2 * 0.9 + 0.12
    # A thin slab: its own chamfer must stay well under its thickness.
    chamfered_block(bm, hx, hy, 0.0, FACE_INSET + 0.02, 0.08, 0)
    lowest = min(v.co.z for v in bm.verts)
    ring = [v for v in bm.verts if abs(v.co.z - lowest) < 1e-6]
    ring.sort(key=lambda v: math.atan2(v.co.y, v.co.x))
    bm.faces.new(ring)
    return finish('Hammer_Face', bm, [mats['Molten']], root)


def build_runes(mats, root):
    """Forge marks cut into both cheeks: three bars and a chevron, as thin glowing
    inlays a hair proud of the iron."""
    bm = bmesh.new()
    lift = 0.03
    for side in (1, -1):
        y = side * (HEAD_DEPTH / 2 + lift)

        def bar(x0, z0, x1, z1, width=0.13):
            dx, dz = x1 - x0, z1 - z0
            length = math.hypot(dx, dz) or 1.0
            nx, nz = -dz / length * width / 2, dx / length * width / 2
            verts = [
                bm.verts.new((x0 - nx, y, z0 - nz)),
                bm.verts.new((x0 + nx, y, z0 + nz)),
                bm.verts.new((x1 + nx, y, z1 + nz)),
                bm.verts.new((x1 - nx, y, z1 - nz)),
            ]
            bm.faces.new(verts if side > 0 else list(reversed(verts)))

        for x in (-1.5, 0.0, 1.5):
            bar(x, 0.9, x, 2.0)
        bar(-1.9, 2.5, 0.0, 3.0)
        bar(0.0, 3.0, 1.9, 2.5)
    return finish('Hammer_Runes', bm, [mats['Molten']], root)


def lathe(bm, profile, sides, mat_index):
    rows = []
    for radius, z in profile:
        rows.append([
            bm.verts.new((math.cos(math.tau * i / sides) * radius, math.sin(math.tau * i / sides) * radius, z))
            for i in range(sides)
        ])
    for r in range(len(rows) - 1):
        for i in range(sides):
            face = bm.faces.new((rows[r][i], rows[r][(i + 1) % sides], rows[r + 1][(i + 1) % sides], rows[r + 1][i]))
            face.material_index = mat_index
    return rows


def build_collar(mats, root):
    bm = bmesh.new()
    z = HEAD_HEIGHT
    rows = lathe(bm, [(1.15, z - 0.05), (1.2, z + 0.25), (0.95, z + 0.4), (1.0, z + 0.75), (0.7, z + 0.9)], 10, 0)
    bm.faces.new(list(reversed(rows[-1])))
    return finish('Hammer_Collar', bm, [mats['ForgeIron']], root)


def build_haft(mats, root):
    bm = bmesh.new()
    z0 = HEAD_HEIGHT + 0.85
    profile = [(HAFT_RADIUS, z0)]
    step = HAFT_LENGTH / (WRAPS * 2)
    for i in range(WRAPS * 2):
        z = z0 + step * (i + 1)
        profile.append((HAFT_RADIUS * (1.22 if i % 2 == 0 else 1.0), z))
    rows = lathe(bm, profile, 8, 0)
    for r in range(len(rows) - 1):
        if r % 2 == 0:
            for face in bm.faces:
                zs = [v.co.z for v in face.verts]
                if min(zs) >= profile[r][1] - 1e-6 and max(zs) <= profile[r + 1][1] + 1e-6:
                    face.material_index = 1
    return finish('Hammer_Haft', bm, [mats['ForgeIronWorn'], mats['Leather']], root)


def build_pommel(mats, root):
    bm = bmesh.new()
    z = HEAD_HEIGHT + 0.85 + HAFT_LENGTH
    lathe(bm, [(HAFT_RADIUS, z), (0.85, z + 0.2), (0.95, z + 0.55), (0.6, z + 0.85), (0.05, z + 1.0)], 8, 0)
    return finish('Hammer_Pommel', bm, [mats['ForgeIron']], root)


def build_hammer():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(MATERIALS)
    root = bpy.data.objects.new('ForgeHammer_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    return [
        build_head(mats, root),
        build_face(mats, root),
        build_runes(mats, root),
        build_collar(mats, root),
        build_haft(mats, root),
        build_pommel(mats, root),
    ]


def triangle_count(parts):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
    return total


def export(parts, filename, label):
    print(f'{label}_TRIANGLES {triangle_count(parts)}')
    print(f'{label}_NODES {sorted(obj.name for obj in bpy.context.scene.objects)}')
    bpy.ops.object.select_all(action='SELECT')
    out = os.path.join(HERE, filename)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print(f'WROTE {out}')


if __name__ == '__main__':
    assert math.hypot(HEAD_WIDTH / 2, HEAD_DEPTH / 2) < IMPACT_RADIUS
    export(build_hammer(), 'forge_hammer_components.glb', 'FORGE_HAMMER')
