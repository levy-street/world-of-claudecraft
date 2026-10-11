"""Hoarfrost's ICE AGE: the editable Blender source for the fallen-icicle pillars.

Run headless from the repository root:

    blender --background --python docs/design/ice-age/build_ice_age.py

It rebuilds every pillar variant from the numbers below and writes, beside this
file, ice_pillar_components.glb, which the shipping build
(scripts/assets/ice_age/build.mjs) optimizes into public/vfx/ice-age/.

Original project art authored procedurally from the owner's brief. No
third-party mesh, texture or reference image is used.

Conventions the runtime relies on (src/render/hoard_ice_age.ts):
  - Blender is Z-up; the glTF export turns that into Y-up. One Blender metre is
    one game yard. Each pillar stands on the origin, embedded a little below the
    floor so no seam ever shows on uneven ground.
  - The footprint is built to PILLAR_RADIUS, copied from
    src/sim/rift/hoard_ice_age_core.ts (ICE_AGE.pillarRadius): what reads as
    cover IS the cover. tests/hoard_ice_age_render.test.ts pins that the mesh
    stays inside it.
  - DESTRUCTION-READY: the body is modelled as separate closed CHUNKS that sit
    together as the intact pillar. The runtime throws them apart on a scripted
    arc; nothing is simulated and nothing is animated here.
  - Everything the runtime tints or moves is its own named part:
      IcePillar_<V>_Chunk_<nn>   a piece of the body (outer ice, inner deep ice)
      IcePillar_<V>_Cracks       glowing seams along every chunk boundary
      IcePillar_<V>_Shards       the smaller icicles driven in around the base
      IcePillar_<V>_Base         the frost and snow thrown up at the foot
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
PILLAR_RADIUS = 2.6  # ICE_AGE.pillarRadius

# ---------------------------------------------------------------- tunables
EMBED_DEPTH = 0.8  # how far below the floor the body starts
SUB_RINGS = 2  # facet rows per tier
CRACK_WIDTH = 0.055
CRACK_LIFT = 0.03
TWIST_PER_ROW = 0.11  # the facets spiral a little, like a grown crystal
SEAM_JITTER = 0.55  # how far a seam's corners wander up and down
COVER_LIMIT = PILLAR_RADIUS * 1.12  # nothing solid reaches past the lee's own width
BASE_RADIUS = PILLAR_RADIUS * 1.12
BASE_HEIGHT = 0.55

# One row per variant: a different silhouette, never just a recolour.
VARIANTS = [
    # name, seed, sides, height, lean (x, y per metre), tier wedges, girth profile
    ('A', 11, 6, 10.6, (0.04, -0.025), (3, 3, 2), (0.82, 1.0, 0.7, 0.3)),
    ('B', 23, 5, 9.0, (-0.06, 0.035), (2, 3, 2), (0.9, 0.96, 0.62, 0.26)),
    ('C', 37, 7, 11.8, (0.02, 0.055), (3, 2, 2), (0.78, 0.98, 0.76, 0.34)),
]

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('Ice', (0.42, 0.72, 0.96), 0.0, 0.16, 0.3),
    ('IceDeep', (0.12, 0.36, 0.8), 0.0, 0.3, 0.7),
    ('Frost', (0.93, 0.97, 1.0), 0.0, 0.85, 0.1),
    ('IceGlow', (0.7, 0.95, 1.0), 0.0, 0.4, 3.0),
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


def build_rings(rng, sides, height, lean, girth):
    """The body as stacked irregular polygons: rings[row][side] -> (x, y, z).

    The widest row sits low (a fallen icicle drives its mass into the floor) and
    the top is the snapped root: ragged, every corner at its own height.
    """
    tiers = len(girth) - 1
    rows = tiers * SUB_RINGS + 1
    spin = rng.uniform(0, math.tau)
    corner_bias = [rng.uniform(0.7, 1.12) for _ in range(sides)]
    rings = []
    for row in range(rows):
        t = row / (rows - 1)
        z = -EMBED_DEPTH + (height + EMBED_DEPTH) * t
        at = t * tiers
        lo = min(tiers - 1, int(at))
        g = girth[lo] + (girth[lo + 1] - girth[lo]) * (at - lo)
        ring = []
        for side in range(sides):
            angle = spin + math.tau * side / sides + row * TWIST_PER_ROW
            radius = PILLAR_RADIUS * 0.94 * g * corner_bias[side] * rng.uniform(0.9, 1.08)
            radius = min(radius, PILLAR_RADIUS * 0.98)
            if row == rows - 1:
                wander = rng.uniform(-2.2, 0.6)  # the snapped root: ragged
            elif row > 0:
                wander = rng.uniform(-SEAM_JITTER, SEAM_JITTER)
            else:
                wander = 0.0
            zz = max(0.15, z) if row > 0 else z
            top_ragged = wander
            ring.append(
                (
                    math.cos(angle) * radius + lean[0] * max(0.0, z),
                    math.sin(angle) * radius + lean[1] * max(0.0, z),
                    zz + top_ragged,
                )
            )
        rings.append(ring)
    return rings


def wedge_bounds(sides, wedges, offset):
    """Split the ring's sides into `wedges` runs: [(first, last_exclusive), ...]."""
    cuts = [(offset + round(sides * k / wedges)) for k in range(wedges + 1)]
    return [(cuts[k], cuts[k + 1]) for k in range(wedges)]


def build_chunk(name, rings, row_from, row_to, side_from, side_to, lean, mats, parent, top):
    sides = len(rings[0])
    bm = bmesh.new()
    columns = [s % sides for s in range(side_from, side_to + 1)]
    grid = [[bm.verts.new(rings[row][s]) for s in columns] for row in range(row_from, row_to + 1)]

    def axis(row):
        z = sum(v[2] for v in rings[row]) / sides
        return bm.verts.new((lean[0] * max(0.0, z), lean[1] * max(0.0, z), z))

    core = [axis(row) for row in range(row_from, row_to + 1)]
    if top:
        # The snapped root rises to a rough crown rather than a flat lid.
        crown = core[-1].co
        core[-1].co = (crown[0], crown[1], crown[2] + 1.9)
    outer = 0
    deep = 1
    for r in range(len(grid) - 1):
        for c in range(len(columns) - 1):
            face = bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
            face.material_index = outer
        for edge in (0, len(columns) - 1):
            face = bm.faces.new((core[r], grid[r][edge], grid[r + 1][edge], core[r + 1]))
            face.material_index = deep
    for r, exposed in ((0, False), (len(grid) - 1, top)):
        for c in range(len(columns) - 1):
            face = bm.faces.new((core[r], grid[r][c], grid[r][c + 1]))
            face.material_index = outer if exposed else deep
    return finish(name, bm, [mats['Ice'], mats['IceDeep']], parent)


def ribbon(bm, points, center_of):
    """A thin glowing seam along `points`, lifted just off the ice."""
    for a, b in zip(points, points[1:]):
        along = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        length = math.sqrt(sum(v * v for v in along)) or 1.0
        along = tuple(v / length for v in along)
        quads = []
        for p in (a, b):
            cx, cy = center_of(p[2])
            out = (p[0] - cx, p[1] - cy, 0.0)
            norm = math.hypot(out[0], out[1]) or 1.0
            out = (out[0] / norm, out[1] / norm, 0.0)
            side = (
                along[1] * out[2] - along[2] * out[1],
                along[2] * out[0] - along[0] * out[2],
                along[0] * out[1] - along[1] * out[0],
            )
            lifted = tuple(p[i] + out[i] * CRACK_LIFT for i in range(3))
            quads.append(
                (
                    tuple(lifted[i] - side[i] * CRACK_WIDTH / 2 for i in range(3)),
                    tuple(lifted[i] + side[i] * CRACK_WIDTH / 2 for i in range(3)),
                )
            )
        verts = [bm.verts.new(v) for v in (quads[0][0], quads[0][1], quads[1][1], quads[1][0])]
        bm.faces.new(verts)


def build_cracks(name, rings, tier_wedges, lean, mats, parent):
    sides = len(rings[0])
    bm = bmesh.new()

    def center_of(z):
        return (lean[0] * max(0.0, z), lean[1] * max(0.0, z))

    for tier, wedges in enumerate(tier_wedges):
        row_from = tier * SUB_RINGS
        row_to = row_from + SUB_RINGS
        for first, _last in wedge_bounds(sides, wedges, tier):
            seam = [rings[row][first % sides] for row in range(row_from, row_to + 1)]
            ribbon(bm, [p for p in seam if p[2] > 0.05], center_of)
        if tier > 0:
            loop = [rings[row_from][s % sides] for s in range(sides + 1)]
            ribbon(bm, loop, center_of)
    return finish(name, bm, [mats['IceGlow']], parent)


def add_spike(bm, base, tip, radius, sides, rng):
    ring = []
    spin = rng.uniform(0, math.tau)
    for side in range(sides):
        angle = spin + math.tau * side / sides
        ring.append(
            bm.verts.new(
                (
                    base[0] + math.cos(angle) * radius * rng.uniform(0.85, 1.15),
                    base[1] + math.sin(angle) * radius * rng.uniform(0.85, 1.15),
                    base[2],
                )
            )
        )
    apex = bm.verts.new(tip)
    for side in range(sides):
        bm.faces.new((ring[side], ring[(side + 1) % sides], apex))


def build_shards(name, rng, lean, mats, parent):
    """Two or three great spires fused to the body's flanks, and the small
    icicles driven into the floor around it: a cluster, never a lone post."""
    bm = bmesh.new()
    spin = rng.uniform(0, math.tau)
    spires = rng.randint(2, 3)
    for index in range(spires):
        angle = spin + math.tau * index / spires + rng.uniform(-0.3, 0.3)
        height = rng.uniform(4.6, 7.4)
        at = PILLAR_RADIUS * rng.uniform(0.34, 0.5)
        reach = min(COVER_LIMIT * 0.97, at + height * rng.uniform(0.16, 0.26))
        base = (math.cos(angle) * at, math.sin(angle) * at, -0.4)
        tip = (
            math.cos(angle) * reach + lean[0] * height,
            math.sin(angle) * reach + lean[1] * height,
            height,
        )
        add_spike(bm, base, tip, rng.uniform(0.95, 1.3), 5, rng)
    count = rng.randint(4, 6)
    for index in range(count):
        angle = spin + 0.5 + math.tau * index / count + rng.uniform(-0.25, 0.25)
        radius = rng.uniform(0.3, 0.55)
        at = PILLAR_RADIUS * rng.uniform(0.7, 0.86)
        height = rng.uniform(1.2, 2.8)
        base = (math.cos(angle) * at, math.sin(angle) * at, -0.3)
        reach = min(COVER_LIMIT * 0.97, at + height * rng.uniform(0.2, 0.45))
        tip = (math.cos(angle) * reach, math.sin(angle) * reach, height)
        add_spike(bm, base, tip, radius, 4, rng)
    return finish(name, bm, [mats['Ice']], parent)


def build_base(name, rng, mats, parent):
    bm = bmesh.new()
    sides = 14
    center = bm.verts.new((0, 0, BASE_HEIGHT))
    inner = []
    outer = []
    for side in range(sides):
        angle = math.tau * side / sides
        r_in = BASE_RADIUS * rng.uniform(0.5, 0.64)
        r_out = BASE_RADIUS * rng.uniform(0.86, 1.0)
        inner.append(
            bm.verts.new(
                (math.cos(angle) * r_in, math.sin(angle) * r_in, BASE_HEIGHT * rng.uniform(0.5, 0.9))
            )
        )
        outer.append(bm.verts.new((math.cos(angle) * r_out, math.sin(angle) * r_out, -0.05)))
    for side in range(sides):
        nxt = (side + 1) % sides
        bm.faces.new((center, inner[side], inner[nxt]))
        bm.faces.new((inner[side], outer[side], outer[nxt], inner[nxt]))
    return finish(name, bm, [mats['Frost']], parent)


def build_variant(spec, mats, offset_x=0.0):
    letter, seed, sides, height, lean, tier_wedges, girth = spec
    rng = random.Random(seed)
    root = bpy.data.objects.new(f'IcePillar_{letter}_ROOT', None)
    root.location = (offset_x, 0, 0)
    bpy.context.scene.collection.objects.link(root)
    rings = build_rings(rng, sides, height, lean, girth)
    parts = []
    index = 0
    for tier, wedges in enumerate(tier_wedges):
        row_from = tier * SUB_RINGS
        row_to = row_from + SUB_RINGS
        for first, last in wedge_bounds(sides, wedges, tier):
            parts.append(
                build_chunk(
                    f'IcePillar_{letter}_Chunk_{index:02d}',
                    rings,
                    row_from,
                    row_to,
                    first,
                    last,
                    lean,
                    mats,
                    root,
                    top=tier == len(tier_wedges) - 1,
                )
            )
            index += 1
    parts.append(build_cracks(f'IcePillar_{letter}_Cracks', rings, tier_wedges, lean, mats, root))
    parts.append(build_shards(f'IcePillar_{letter}_Shards', rng, lean, mats, root))
    parts.append(build_base(f'IcePillar_{letter}_Base', rng, mats, root))
    return root, parts


def build_all(spacing=0.0):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(MATERIALS)
    parts = []
    for index, spec in enumerate(VARIANTS):
        _root, made = build_variant(spec, mats, offset_x=spacing * (index - 1))
        parts.extend(made)
    return parts


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
    export(build_all(), 'ice_pillar_components.glb', 'ICE_PILLARS')
