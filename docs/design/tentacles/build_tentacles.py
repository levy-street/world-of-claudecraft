"""The Abyssal Maw's TENTACLES: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/tentacles/build_tentacles.py

It rebuilds every part from the numbers below and writes, beside this file:

    tentacle_components.glb   what the effect draws (src/render/hoard_tentacles.ts)
    trunk_components.glb      the attackable mob's own body (the root collar)

which the shipping build (scripts/assets/tentacles/build.mjs) optimizes into
public/vfx/tentacles/.

Original project art authored procedurally. No third-party mesh, texture or
reference image is used.

Conventions the runtime relies on:
  - Blender is Z-up; the glTF export turns that into Y-up. One Blender metre is
    one game yard.
  - A tentacle is NOT one mesh. It is a chain of one SEGMENT drawn many times
    (instanced), each copy placed, turned and scaled along a curve the runtime
    bends every frame (the rise, the sway, the lash, the sweep, the death). So:
      Tentacle_Seg    ONE segment of unit radius and unit length, its axis up
                      (+Z here), its base ring on the origin. The belly (pale
                      skin and the glowing suckers) faces -Y, which the export
                      turns into the runtime's +Z: the side the chain bends toward.
      Tentacle_Tip    the last link: a hooked, tapering point, same frame.
  - What breaks the floor where it rises, authored at full size on the origin:
      Tentacle_Rubble the ring of heaved flagstones
      Tentacle_Pool   the black water welling up between them
  - The mob's body is only the ROOT COLLAR the chain grows out of
    (Trunk_Collar, under TentacleTrunk_ROOT): targeting, the nameplate and the
    health bar are the ordinary ones, and the living part is the effect.
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
ERUPT_RADIUS = 3.2  # TENTACLES.eruptRadius: the rubble stays inside it
SWEEP_INNER_RADIUS = 2.4  # TENTACLES.sweepInnerRadius: the collar stays inside it

# ---------------------------------------------------------------- tunables
SIDES = 12
SEG_BULGE = 1.07
SEG_NECK = 0.95
SUCKER_RADIUS = 0.3
COLLAR_RADIUS = 1.45
COLLAR_HEIGHT = 1.5
SLABS = 11
SEED = 20260922

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('AbyssSkin', (0.05, 0.16, 0.19), 0.1, 0.42, 0.0),
    ('AbyssUnder', (0.46, 0.55, 0.5), 0.0, 0.6, 0.0),
    ('AbyssSucker', (0.25, 1.0, 0.82), 0.0, 0.4, 4.0),
    ('AbyssStone', (0.2, 0.21, 0.22), 0.0, 0.9, 0.0),
    ('AbyssWater', (0.01, 0.05, 0.07), 0.2, 0.12, 0.3),
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


def belly(angle):
    """How far round toward the belly (-Y) a bearing is: 1 dead on it, 0 on the back."""
    return max(0.0, -math.sin(angle))


def skin_rows(bm, profile, sides, squash=0.9):
    """A lathed skin whose belly third is the pale underside. `profile` is
    (radius, z) pairs; the cross-section is a little flattened front to back."""
    rows = []
    for radius, z in profile:
        rows.append([
            bm.verts.new((
                math.cos(math.tau * i / sides) * radius,
                math.sin(math.tau * i / sides) * radius * squash,
                z,
            ))
            for i in range(sides)
        ])
    for r in range(len(rows) - 1):
        for i in range(sides):
            face = bm.faces.new((rows[r][i], rows[r][(i + 1) % sides], rows[r + 1][(i + 1) % sides], rows[r + 1][i]))
            middle = math.tau * (i + 0.5) / sides
            face.material_index = 1 if belly(middle) > 0.62 else 0
    return rows


def sucker(bm, z, radius, surface, squash=0.9):
    """A raised cup on the belly at height z: a rim in the pale skin and a glowing
    well inside it."""
    y = -surface * squash
    ring = 8
    outer = []
    inner = []
    for i in range(ring):
        a = math.tau * i / ring
        outer.append(bm.verts.new((math.cos(a) * radius, y - 0.02, z + math.sin(a) * radius)))
        inner.append(bm.verts.new((math.cos(a) * radius * 0.62, y - 0.13, z + math.sin(a) * radius * 0.62)))
    for i in range(ring):
        face = bm.faces.new((outer[i], outer[(i + 1) % ring], inner[(i + 1) % ring], inner[i]))
        face.material_index = 1
    well = bm.verts.new((0, y - 0.05, z))
    for i in range(ring):
        face = bm.faces.new((inner[i], inner[(i + 1) % ring], well))
        face.material_index = 2


def ridge(bm, z, height, surface, squash=0.9):
    """A low fin on the back (+Y): the spine that catches the light on a bend."""
    y = surface * squash
    a = bm.verts.new((-0.16, y - 0.04, z - 0.2))
    b = bm.verts.new((0.16, y - 0.04, z - 0.2))
    c = bm.verts.new((0, y - 0.04, z + 0.26))
    top = bm.verts.new((0, y + height, z + 0.12))
    for tri in ((a, b, top), (b, c, top), (c, a, top)):
        bm.faces.new(tri).material_index = 0


def build_segment(mats, root):
    bm = bmesh.new()
    profile = [
        (SEG_NECK, 0.0),
        (SEG_BULGE, 0.3),
        (SEG_BULGE, 0.62),
        (SEG_NECK, 1.0),
    ]
    skin_rows(bm, profile, SIDES)
    sucker(bm, 0.47, SUCKER_RADIUS, SEG_BULGE)
    ridge(bm, 0.47, 0.2, SEG_BULGE)
    return finish('Tentacle_Seg', bm, [mats['AbyssSkin'], mats['AbyssUnder'], mats['AbyssSucker']], root)


def build_tip(mats, root):
    """The last link, 2.6 radii long, hooking toward the belly as it thins."""
    bm = bmesh.new()
    rows = []
    steps = 7
    for s in range(steps + 1):
        t = s / steps
        radius = SEG_NECK * (1 - t) ** 0.8 + 0.02
        hook = -0.55 * t * t
        z = 2.6 * t
        rows.append([
            bm.verts.new((
                math.cos(math.tau * i / SIDES) * radius,
                math.sin(math.tau * i / SIDES) * radius * 0.9 + hook,
                z,
            ))
            for i in range(SIDES)
        ])
    for r in range(steps):
        for i in range(SIDES):
            face = bm.faces.new((rows[r][i], rows[r][(i + 1) % SIDES], rows[r + 1][(i + 1) % SIDES], rows[r + 1][i]))
            middle = math.tau * (i + 0.5) / SIDES
            face.material_index = 1 if belly(middle) > 0.62 else 0
    bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary and all(v.co.z > 2.5 for v in e.verts)])
    sucker(bm, 0.55, SUCKER_RADIUS * 0.8, SEG_NECK * 0.93)
    return finish('Tentacle_Tip', bm, [mats['AbyssSkin'], mats['AbyssUnder'], mats['AbyssSucker']], root)


def slab(bm, rng, bearing, distance, length, width, thickness, tilt):
    """One heaved flagstone: a wedge levered up on its inner edge, leaning out."""
    ux, uy = math.cos(bearing), math.sin(bearing)
    vx, vy = -uy, ux
    corners = []
    for along, across in ((0, -1), (0, 1), (1, 0.8), (1, -0.8)):
        skew = (rng.random() - 0.5) * 0.25
        a = distance + along * length
        c = across * width * (0.5 + skew * 0.3)
        rise = (1 - along) * math.sin(tilt) * length * 0.75 + rng.random() * 0.06
        corners.append((ux * a + vx * c, uy * a + vy * c, rise))
    top = [bm.verts.new((x, y, z + thickness)) for x, y, z in corners]
    bottom = [bm.verts.new((x, y, max(-0.2, z - 0.15))) for x, y, z in corners]
    bm.faces.new(top).material_index = 0
    bm.faces.new(list(reversed(bottom))).material_index = 0
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top[i], bottom[i], bottom[j], top[j])).material_index = 0


def build_rubble(mats, root):
    rng = random.Random(SEED)
    bm = bmesh.new()
    for i in range(SLABS):
        bearing = math.tau * (i + (rng.random() - 0.5) * 0.5) / SLABS
        length = 0.9 + rng.random() * 0.7
        distance = 1.45 + rng.random() * 0.25
        # Never past the warning circle the players were shown.
        length = min(length, ERUPT_RADIUS - 0.1 - distance)
        slab(bm, rng, bearing, distance, length, 0.9 + rng.random() * 0.5, 0.22 + rng.random() * 0.12, math.radians(24 + rng.random() * 26))
    # Loose chips thrown between them.
    for _ in range(14):
        bearing = rng.random() * math.tau
        distance = 1.3 + rng.random() * 1.5
        size = 0.12 + rng.random() * 0.16
        made = bmesh.ops.create_cube(bm, size=size)
        for v in made['verts']:
            v.co.x += math.cos(bearing) * distance
            v.co.y += math.sin(bearing) * distance
            v.co.z += size * 0.4
    return finish('Tentacle_Rubble', bm, [mats['AbyssStone']], root)


def build_pool(mats, root):
    bm = bmesh.new()
    rng = random.Random(SEED + 1)
    ring = [
        bm.verts.new((math.cos(math.tau * i / 20) * (2.0 + rng.random() * 0.35), math.sin(math.tau * i / 20) * (2.0 + rng.random() * 0.35), 0.03))
        for i in range(20)
    ]
    bm.faces.new(ring)
    return finish('Tentacle_Pool', bm, [mats['AbyssWater']], root)


def feeler(bm, bearing, reach, length, radius):
    """A small curled tentacle on the collar's rim, leaning out and hooking over:
    the body alone then still reads as the Maw's tentacle (its target portrait is a
    render of this body, and the living chain never covers the rim)."""
    ux, uy = math.cos(bearing), math.sin(bearing)
    sides = 6
    steps = 6
    rows = []
    for s in range(steps + 1):
        t = s / steps
        out = reach + 0.75 * t * t
        z = 0.55 + length * (t - 0.28 * t * t * t)
        r = radius * (1 - t) ** 0.8 + 0.02
        rows.append([
            bm.verts.new((
                ux * out + (math.cos(math.tau * i / sides) * ux - math.sin(math.tau * i / sides) * uy) * r,
                uy * out + (math.cos(math.tau * i / sides) * uy + math.sin(math.tau * i / sides) * ux) * r,
                z + math.cos(math.tau * i / sides) * r * 0.5 * t,
            ))
            for i in range(sides)
        ])
    for r in range(steps):
        for i in range(sides):
            face = bm.faces.new((rows[r][i], rows[r][(i + 1) % sides], rows[r + 1][(i + 1) % sides], rows[r + 1][i]))
            # The outward face is the pale underside, with a glowing sucker band.
            outward = math.cos(math.tau * (i + 0.5) / sides)
            face.material_index = (2 if r % 2 == 1 else 1) if outward > 0.6 else 0
    bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary and all(v.co.z > 0.55 + length * 0.7 for v in e.verts)])


def build_collar(mats, root):
    """The root it grows out of: a thick, folded sleeve of skin, wider than the
    chain's first link so the join is never seen."""
    bm = bmesh.new()
    rng = random.Random(SEED + 2)
    profile = [
        (COLLAR_RADIUS * 1.12, 0.0),
        (COLLAR_RADIUS * 1.2, 0.25),
        (COLLAR_RADIUS * 1.02, 0.55),
        (COLLAR_RADIUS * 1.1, 0.8),
        (COLLAR_RADIUS * 0.92, 1.1),
        (COLLAR_RADIUS * 0.98, 1.3),
        (COLLAR_RADIUS * 0.8, COLLAR_HEIGHT),
    ]
    rows = skin_rows(bm, profile, 14, squash=0.95)
    for row in rows[1:-1]:
        for v in row:
            v.co.x *= 1 + (rng.random() - 0.5) * 0.07
            v.co.y *= 1 + (rng.random() - 0.5) * 0.07
    for z in (0.45, 1.0):
        sucker(bm, z, 0.34, COLLAR_RADIUS * 1.06, squash=0.95)
    for k in range(5):
        feeler(bm, math.tau * (k + 0.35) / 5, COLLAR_RADIUS * 0.98, 2.3 + 0.5 * rng.random(), 0.46)
    return finish('Trunk_Collar', bm, [mats['AbyssSkin'], mats['AbyssUnder'], mats['AbyssSucker']], root)


def fresh(root_name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(MATERIALS)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    return mats, root


def build_tentacle():
    mats, root = fresh('Tentacle_ROOT')
    return [build_segment(mats, root), build_tip(mats, root), build_rubble(mats, root), build_pool(mats, root)]


def build_trunk():
    mats, root = fresh('TentacleTrunk_ROOT')
    for name in ('AbyssStone', 'AbyssWater'):
        bpy.data.materials.remove(mats[name])
    return [build_collar(mats, root)]


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
    assert COLLAR_RADIUS * 1.2 < SWEEP_INNER_RADIUS
    export(build_tentacle(), 'tentacle_components.glb', 'TENTACLE')
    export(build_trunk(), 'trunk_components.glb', 'TRUNK')
