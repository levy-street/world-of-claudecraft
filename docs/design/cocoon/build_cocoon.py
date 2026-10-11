"""Broodmother Vysska's COCOONS: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/cocoon/build_cocoon.py

It rebuilds both cocoons from the numbers below and writes, beside this file:

    silk_cocoon_components.glb    the cocoon a wrapped PLAYER stands inside
    brood_cocoon_components.glb   the brood cocoon she spins for a lone player

which the shipping build (scripts/assets/cocoon/build.mjs) optimizes into
public/models/creatures/. Both are the BODIES of attackable mobs
(src/render/characters/manifest.ts), so targeting, the nameplate and the health
bar are the ordinary ones; the web mark, the hanging strand, the rescue ring and
her feeding are runtime effects (src/render/hoard_cocoon.ts).

Original project art authored procedurally. No third-party mesh, texture or
reference image is used.

Conventions the runtime relies on:
  - Blender is Z-up; the glTF export turns that into Y-up. One Blender metre is
    one game yard. Each cocoon stands on the origin.
  - The silk cocoon is TALL and hollow-looking: it is drawn round a standing
    player, so it clears a two yard figure and stays inside COCOON_RADIUS.
      Silk_Wrap      the wound body: a lathed, lumpy shell with a shoulder bulge
      Silk_Bands     tighter windings crossing it (paler)
      Silk_Threads   anchor threads from its sides down to the floor
  - The brood cocoon is squat and ALIVE: a clutch showing through the silk.
      Brood_Sac      the sagging sac
      Brood_Eggs     glowing eggs pressing through it (they pulse at runtime)
      Brood_Threads  anchor threads
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
COCOON_RADIUS = 1.5  # COCOON.cocoonRadius

# ---------------------------------------------------------------- tunables
SILK_HEIGHT = 3.5
SILK_RADIUS = 1.2
BROOD_HEIGHT = 2.5
BROOD_RADIUS = 1.45
SIDES = 14
SEED = 20260924

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('Silk', (0.78, 0.8, 0.7), 0.0, 0.7, 0.0),
    ('SilkPale', (0.93, 0.94, 0.88), 0.0, 0.55, 0.15),
    ('BroodSac', (0.5, 0.56, 0.36), 0.0, 0.6, 0.0),
    ('BroodGlow', (0.72, 1.0, 0.25), 0.0, 0.4, 4.0),
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


def shell(bm, profile, sides, rng, lump):
    """A lathed shell, each vertex pushed in or out a little so it reads as wound
    silk and never as a turned vase. Closed top and bottom."""
    rows = []
    for radius, z in profile:
        row = []
        for i in range(sides):
            a = math.tau * i / sides
            r = radius * (1 + (rng.random() - 0.5) * lump)
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rows.append(row)
    for r in range(len(rows) - 1):
        for i in range(sides):
            bm.faces.new((rows[r][i], rows[r][(i + 1) % sides], rows[r + 1][(i + 1) % sides], rows[r + 1][i]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[-1])
    return rows


def winding(bm, profile_radius, z0, z1, turns, width, sides=28, proud=0.04):
    """One band of silk wound up the body: a ribbon spiralling from z0 to z1,
    lying just proud of the shell (`profile_radius(z)` is the shell's radius)."""
    steps = int(sides * turns)
    previous = None
    for s in range(steps + 1):
        t = s / steps
        a = math.tau * turns * t
        z = z0 + (z1 - z0) * t
        r = profile_radius(z) + proud
        low = bm.verts.new((math.cos(a) * r, math.sin(a) * r, z - width / 2))
        high = bm.verts.new((math.cos(a) * r, math.sin(a) * r, z + width / 2))
        if previous:
            bm.faces.new((previous[0], low, high, previous[1]))
        previous = (low, high)


def threads(bm, rng, count, top_radius, top_z, reach):
    """Anchor threads: thin tapering blades from the body out to the floor."""
    for n in range(count):
        a = math.tau * (n + rng.random() * 0.6) / count
        z = top_z * (0.35 + rng.random() * 0.5)
        out = min(reach, top_radius + 0.9 + rng.random() * 0.9)
        sx, sy = math.cos(a), math.sin(a)
        px, py = -sy * 0.05, sx * 0.05
        a0 = bm.verts.new((sx * top_radius * 0.9 + px, sy * top_radius * 0.9 + py, z))
        a1 = bm.verts.new((sx * top_radius * 0.9 - px, sy * top_radius * 0.9 - py, z))
        tip = bm.verts.new((sx * out, sy * out, 0.02))
        bm.faces.new((a0, a1, tip))
        lift = bm.verts.new((sx * top_radius * 0.9, sy * top_radius * 0.9, z + 0.1))
        bm.faces.new((a1, a0, lift))
        bm.faces.new((a0, tip, lift))
        bm.faces.new((tip, a1, lift))


def interpolate(profile):
    def radius_at(z):
        for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / max(1e-6, z1 - z0)
                return r0 + (r1 - r0) * t
        return profile[-1][0]
    return radius_at


def fresh(root_name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(MATERIALS)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    return mats, root


def build_silk():
    mats, root = fresh('SilkCocoon_ROOT')
    for name in ('BroodSac', 'BroodGlow'):
        bpy.data.materials.remove(mats[name])
    rng = random.Random(SEED)
    # Feet bound tight, a swell at the hips and the shoulders, a drawn-in neck, a
    # knotted crown where the strand takes its weight.
    profile = [
        (SILK_RADIUS * 0.5, 0.0),
        (SILK_RADIUS * 0.72, 0.35),
        (SILK_RADIUS * 0.9, 1.0),
        (SILK_RADIUS * 0.84, 1.6),
        (SILK_RADIUS * 1.0, 2.2),
        (SILK_RADIUS * 0.8, 2.75),
        (SILK_RADIUS * 0.5, 3.15),
        (SILK_RADIUS * 0.22, SILK_HEIGHT),
    ]
    parts = []
    bm = bmesh.new()
    shell(bm, profile, SIDES, rng, 0.12)
    parts.append(finish('Silk_Wrap', bm, [mats['Silk']], root))
    bm = bmesh.new()
    radius_at = interpolate(profile)
    winding(bm, radius_at, 0.3, 3.0, 3.2, 0.2)
    winding(bm, radius_at, 3.05, 0.5, 2.4, 0.16)
    parts.append(finish('Silk_Bands', bm, [mats['SilkPale']], root))
    bm = bmesh.new()
    threads(bm, rng, 7, SILK_RADIUS, SILK_HEIGHT * 0.8, COCOON_RADIUS)
    parts.append(finish('Silk_Threads', bm, [mats['SilkPale']], root))
    return parts


def build_brood():
    mats, root = fresh('BroodCocoon_ROOT')
    for name in ('Silk',):
        bpy.data.materials.remove(mats[name])
    rng = random.Random(SEED + 7)
    profile = [
        (BROOD_RADIUS * 0.7, 0.0),
        (BROOD_RADIUS * 1.0, 0.45),
        (BROOD_RADIUS * 0.98, 1.1),
        (BROOD_RADIUS * 0.78, 1.7),
        (BROOD_RADIUS * 0.45, 2.2),
        (BROOD_RADIUS * 0.15, BROOD_HEIGHT),
    ]
    parts = []
    bm = bmesh.new()
    shell(bm, profile, SIDES, rng, 0.16)
    parts.append(finish('Brood_Sac', bm, [mats['BroodSac']], root))
    bm = bmesh.new()
    radius_at = interpolate(profile)
    for n in range(9):
        a = math.tau * (n + rng.random() * 0.5) / 9
        z = 0.45 + rng.random() * 1.2
        r = radius_at(z) - 0.12
        made = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.27 + rng.random() * 0.1)
        for v in made['verts']:
            v.co.x += math.cos(a) * r
            v.co.y += math.sin(a) * r
            v.co.z += z
    parts.append(finish('Brood_Eggs', bm, [mats['BroodGlow']], root))
    bm = bmesh.new()
    threads(bm, rng, 8, BROOD_RADIUS * 0.95, BROOD_HEIGHT * 0.7, COCOON_RADIUS + 0.9)
    winding(bm, radius_at, 0.25, 2.1, 2.2, 0.14)
    parts.append(finish('Brood_Threads', bm, [mats['SilkPale']], root))
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
    assert SILK_RADIUS * 1.06 < COCOON_RADIUS
    export(build_silk(), 'silk_cocoon_components.glb', 'SILK')
    export(build_brood(), 'brood_cocoon_components.glb', 'BROOD')
