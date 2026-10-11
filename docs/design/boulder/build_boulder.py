"""Grask's ROLLING BOULDER: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/boulder/build_boulder.py

It rebuilds the boulder from the numbers below and writes, beside this file,
boulder_components.glb, which the shipping build
(scripts/assets/boulder/build.mjs) optimizes into public/vfx/boulder/.

Original project art authored procedurally. No third-party mesh, texture or
reference image is used.

Conventions the runtime relies on (src/render/hoard_boulder.ts):
  - Blender is Z-up; the glTF export turns that into Y-up. One Blender metre is
    one game yard.
  - The boulder is centred on the origin, so the runtime rolls it by turning the
    root about its own middle and lifts it by its radius. Its radius is
    BOULDER_RADIUS, copied from src/sim/rift/hoard_boulder_core.ts: the rock on
    screen is as wide as the rock that hits.
  - Everything the runtime treats on its own is its own named part:
      Boulder_Rock      the faceted mass
      Boulder_Bands     two crude iron bands hammered round it (it is HIS boulder)
      Boulder_Cracks    glowing fissures (they flare as it gathers pace)
      Boulder_Shard_NN  the pieces it breaks into, each ABOUT ITS OWN CENTRE at
                        the place it sat in the whole rock, so the runtime can
                        swap the rock for them and throw each one outward
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
BOULDER_RADIUS = 2.3  # BOULDER.boulderRadius

# ---------------------------------------------------------------- tunables
SUBDIVISIONS = 2
LUMP = 0.13  # how far a vertex may sit off the true sphere, as a share of the radius
SHARDS = 9
SEED = 20260923

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('BoulderStone', (0.27, 0.23, 0.19), 0.0, 0.92, 0.0),
    ('BoulderIron', (0.12, 0.11, 0.11), 0.8, 0.55, 0.0),
    ('BoulderGlow', (1.0, 0.55, 0.12), 0.0, 0.4, 5.0),
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


def finish(name, bm, materials, parent, location=(0, 0, 0)):
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
    return obj


def lumpy(bm, radius, lump, rng, squash=(1, 1, 1)):
    """Push every vertex of a sphere in or out by a seeded amount: never past
    `radius`, so the silhouette stays inside the hitbox."""
    for v in bm.verts:
        direction = v.co.normalized()
        scale = radius * (1 - lump * rng.random())
        v.co = Vector((direction.x * scale * squash[0], direction.y * scale * squash[1], direction.z * scale * squash[2]))


def build_rock(mats, root, rng):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=SUBDIVISIONS, radius=1)
    lumpy(bm, BOULDER_RADIUS, LUMP, rng)
    return finish('Boulder_Rock', bm, [mats['BoulderStone']], root)


def build_bands(mats, root):
    """Two iron bands, crossed: flat rings just proud of the rock."""
    bm = bmesh.new()
    sides = 20
    for tilt, width in ((0.35, 0.34), (-1.15, 0.28)):
        # Sunk well into the rock, so a band is never seen floating off a hollow.
        inner = BOULDER_RADIUS * 0.8
        outer = BOULDER_RADIUS * 1.0
        rings = []
        for half in (-width / 2, width / 2):
            for r in (inner, outer):
                ring = []
                for i in range(sides):
                    a = math.tau * i / sides
                    # A ring round the X axis, tilted about Y.
                    rr = math.sqrt(max(0.0, r * r - half * half))
                    p = Vector((half, math.cos(a) * rr, math.sin(a) * rr))
                    c, s = math.cos(tilt), math.sin(tilt)
                    ring.append(bm.verts.new((p.x * c + p.z * s, p.y, -p.x * s + p.z * c)))
                rings.append(ring)
        # rings: [left inner, left outer, right inner, right outer]
        li, lo, ri, ro = rings
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((lo[i], lo[j], ro[j], ro[i]))
            bm.faces.new((li[i], lo[i], lo[j], li[j]))
            bm.faces.new((ri[j], ro[j], ro[i], ri[i]))
    return finish('Boulder_Bands', bm, [mats['BoulderIron']], root)


def build_cracks(mats, root, rng):
    """Fissures: glowing blades set RADIALLY into the rock, wandering. Only the
    edge that breaks the surface shows, so a crack always lies exactly on the
    rock however lumpy it is there."""
    bm = bmesh.new()
    for _ in range(7):
        direction = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        side = direction.orthogonal().normalized()
        up = direction.cross(side)
        heading = rng.random() * math.tau
        point = direction.copy()
        for _step in range(4):
            along = (side * math.cos(heading) + up * math.sin(heading)).normalized()
            nxt = (point + along * 0.32).normalized()
            deep = BOULDER_RADIUS * 0.7
            lip = BOULDER_RADIUS * 0.965
            quad = [
                bm.verts.new(point * deep),
                bm.verts.new(point * lip),
                bm.verts.new(nxt * lip),
                bm.verts.new(nxt * deep),
            ]
            bm.faces.new(quad)
            point = nxt
            heading += rng.uniform(-0.9, 0.9)
    return finish('Boulder_Cracks', bm, [mats['BoulderGlow']], root)


def build_shards(mats, root, rng):
    """The pieces it breaks into: chunky lumps spread through the rock's volume."""
    out = []
    for n in range(SHARDS):
        a = math.tau * n / SHARDS + rng.uniform(-0.2, 0.2)
        lift = rng.uniform(-0.55, 0.75)
        distance = BOULDER_RADIUS * rng.uniform(0.35, 0.6)
        centre = (math.cos(a) * distance * math.cos(lift), math.sin(a) * distance * math.cos(lift), math.sin(lift) * distance)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
        size = BOULDER_RADIUS * rng.uniform(0.3, 0.46)
        lumpy(bm, size, 0.35, rng, squash=(1, rng.uniform(0.6, 1), rng.uniform(0.55, 0.9)))
        out.append(finish(f'Boulder_Shard_{n:02d}', bm, [mats['BoulderStone']], root, centre))
    return out


def build_boulder():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(SEED)
    mats = make_materials(MATERIALS)
    root = bpy.data.objects.new('Boulder_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    return [build_rock(mats, root, rng), build_bands(mats, root), build_cracks(mats, root, rng), *build_shards(mats, root, rng)]


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
    export(build_boulder(), 'boulder_components.glb', 'BOULDER')
