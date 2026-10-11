"""Nyxaris's BOUND PULSARS: the editable Blender source for the orb.

Run headless from the repository root:

    blender --background --python docs/design/pulsars/build_pulsars.py

It rebuilds the orb from the numbers below and writes, beside this file,
  pulsar_components.glb        the whole orb, every moving part its own node
  pulsar_core_components.glb   the nucleus alone: the body of the attackable mob
which the shipping build (scripts/assets/pulsars/build.mjs) optimizes into
public/vfx/pulsars/.

Original project art authored procedurally from the owner's brief: a small
spinning star caged in broken armour, with the two polar jets a pulsar is named
for. No third-party mesh, texture or reference image is used.

Conventions the runtime relies on (src/render/hoard_pulsars.ts):
  - Blender is Z-up; the glTF export turns that into Y-up. Game forward (+Z, the
    way an angle of 0 faces) is Blender -Y. One Blender metre is one game yard.
  - The orb is centred on the origin and built to ORB_RADIUS. The runtime places,
    scales, hovers and spins it; nothing is animated here.
  - Everything that moves or is tinted at runtime is its own named node:
      PulsarOrb_ROOT
        Core
          CoreEnergy       the nucleus
          CoreJets         the two polar needles (the runtime spins and stretches)
        Shell
          Fragment_01..04  broken armour plates (they part, shake and fly off)
        Details
          EnergyRing_A/B   the gyroscope rings (each turns on its own axis)
          RuneFragments    the plates that orbit outside the shell
        VFXGeometry
          ArcSegments      crackling filaments between nucleus and shell
          BeamEmitter      the focusing lens the beam leaves by (faces forward)
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- tunables
ORB_RADIUS = 1.0  # the shell's outer radius
CORE_RADIUS = 0.44
JET_LENGTH = 1.55
JET_RADIUS = 0.085
SHELL_THICKNESS = 0.1
SHELL_GAP = math.radians(40)  # the open sky between two plates: the star must show
SHELL_ELEVATION = math.radians(36)  # how far a plate reaches toward the poles
SHELL_COLUMNS = 6
SHELL_ROWS = 6
RING_RADII = (0.7, 0.8)
RING_SECTION = 0.04
RING_SEGMENTS = 28
RUNES = 3
RUNE_ORBIT = 1.36
ARCS = 5
SEED = 20260921

MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('PulsarCore', (0.55, 0.85, 1.0), 0.0, 0.3, 3.2),
    ('PulsarGlow', (0.1, 0.45, 1.0), 0.0, 0.4, 1.8),
    ('PulsarShell', (0.1, 0.17, 0.36), 0.8, 0.3, 0.0),
    ('PulsarRune', (0.12, 0.26, 0.55), 0.6, 0.4, 0.5),
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


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def finish(name, bm, materials, parent, smooth=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in materials:
        mesh.materials.append(mat)
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def sphere_point(radius, azimuth, elevation):
    c = math.cos(elevation)
    return (radius * c * math.cos(azimuth), radius * c * math.sin(azimuth), radius * math.sin(elevation))


def build_core(mats, parent):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=CORE_RADIUS)
    rng = random.Random(SEED)
    # A little unstable: never a perfect ball.
    for vert in bm.verts:
        k = rng.uniform(0.9, 1.12)
        vert.co = (vert.co.x * k, vert.co.y * k, vert.co.z * k)
    return finish('CoreEnergy', bm, [mats['PulsarCore']], parent)


def build_jets(mats, parent):
    bm = bmesh.new()
    for sign in (1, -1):
        ring = []
        for side in range(4):
            angle = math.tau * side / 4 + math.pi / 4
            ring.append(
                bm.verts.new(
                    (math.cos(angle) * JET_RADIUS, math.sin(angle) * JET_RADIUS, sign * CORE_RADIUS * 0.7)
                )
            )
        tip = bm.verts.new((0, 0, sign * JET_LENGTH))
        for side in range(4):
            bm.faces.new((ring[side], ring[(side + 1) % 4], tip))
    return finish('CoreJets', bm, [mats['PulsarCore']], parent)


def build_fragment(index, rng, mats, parent):
    """One armour plate: a patch of a sphere shell with two corners broken off."""
    start = math.tau * index / 4 + SHELL_GAP / 2
    end = math.tau * (index + 1) / 4 - SHELL_GAP / 2
    low = -SHELL_ELEVATION * rng.uniform(0.8, 1.0)
    high = SHELL_ELEVATION * rng.uniform(0.8, 1.0)
    last_c, last_r = SHELL_COLUMNS - 1, SHELL_ROWS - 1
    broken = {(0, last_r), (1, last_r), (0, last_r - 1), (last_c, 0), (last_c - 1, 0)}
    if rng.random() < 0.5:
        broken = {(0, 0), (1, 0), (0, 1), (last_c, last_r), (last_c, last_r - 1)}
    bm = bmesh.new()
    outer = {}
    inner = {}
    for c in range(SHELL_COLUMNS + 1):
        for r in range(SHELL_ROWS + 1):
            az = start + (end - start) * c / SHELL_COLUMNS
            el = low + (high - low) * r / SHELL_ROWS
            outer[(c, r)] = bm.verts.new(sphere_point(ORB_RADIUS, az, el))
            inner[(c, r)] = bm.verts.new(sphere_point(ORB_RADIUS - SHELL_THICKNESS, az, el))
    cells = [
        (c, r) for c in range(SHELL_COLUMNS) for r in range(SHELL_ROWS) if (c, r) not in broken
    ]
    kept = set(cells)
    for c, r in cells:
        face = bm.faces.new((outer[(c, r)], outer[(c + 1, r)], outer[(c + 1, r + 1)], outer[(c, r + 1)]))
        face.material_index = 0
        face = bm.faces.new((inner[(c, r + 1)], inner[(c + 1, r + 1)], inner[(c + 1, r)], inner[(c, r)]))
        face.material_index = 1
        # Close the rim wherever a neighbour is missing: the plate's glowing edge.
        for (dc, dr), (a, b) in (
            ((-1, 0), ((c, r), (c, r + 1))),
            ((1, 0), ((c + 1, r + 1), (c + 1, r))),
            ((0, -1), ((c + 1, r), (c, r))),
            ((0, 1), ((c, r + 1), (c + 1, r + 1))),
        ):
            if (c + dc, r + dr) in kept:
                continue
            face = bm.faces.new((outer[a], outer[b], inner[b], inner[a]))
            face.material_index = 1
    return finish(f'Fragment_{index + 1:02d}', bm, [mats['PulsarShell'], mats['PulsarGlow']], parent)


def build_ring(name, radius, tilt, mats, parent):
    bm = bmesh.new()
    rows = []
    for seg in range(RING_SEGMENTS):
        angle = math.tau * seg / RING_SEGMENTS
        ring = []
        for corner in range(4):
            ca = math.tau * corner / 4 + math.pi / 4
            r = radius + math.cos(ca) * RING_SECTION
            z = math.sin(ca) * RING_SECTION
            ring.append(bm.verts.new((math.cos(angle) * r, math.sin(angle) * r, z)))
        rows.append(ring)
    for seg in range(RING_SEGMENTS):
        nxt = (seg + 1) % RING_SEGMENTS
        for corner in range(4):
            cn = (corner + 1) % 4
            bm.faces.new((rows[seg][corner], rows[nxt][corner], rows[nxt][cn], rows[seg][cn]))
    obj = finish(name, bm, [mats['PulsarGlow']], parent)
    obj.rotation_euler = tilt
    return obj


def build_runes(mats, parent):
    bm = bmesh.new()
    for index in range(RUNES):
        angle = math.tau * index / RUNES
        cx = math.cos(angle) * RUNE_ORBIT
        cy = math.sin(angle) * RUNE_ORBIT
        tangent = (-math.sin(angle), math.cos(angle))
        half_w, half_h, half_t = 0.13, 0.27, 0.025
        radial = (math.cos(angle), math.sin(angle))
        points = []
        for depth in (-half_t, half_t):
            for u, v in ((0, half_h), (half_w, 0), (0, -half_h), (-half_w, 0)):
                points.append(
                    bm.verts.new(
                        (
                            cx + tangent[0] * u + radial[0] * depth,
                            cy + tangent[1] * u + radial[1] * depth,
                            v,
                        )
                    )
                )
        bm.faces.new(points[0:4])
        bm.faces.new(points[7:3:-1])
        for side in range(4):
            nxt = (side + 1) % 4
            bm.faces.new((points[side], points[side + 4], points[nxt + 4], points[nxt]))
    return finish('RuneFragments', bm, [mats['PulsarRune']], parent)


def build_arcs(mats, parent):
    rng = random.Random(SEED + 7)
    bm = bmesh.new()
    for _ in range(ARCS):
        az = rng.uniform(0, math.tau)
        el = rng.uniform(-0.9, 0.9)
        steps = 5
        previous = None
        for step in range(steps + 1):
            t = step / steps
            radius = CORE_RADIUS * 0.95 + (ORB_RADIUS - SHELL_THICKNESS - CORE_RADIUS) * t
            wobble = 0.0 if step in (0, steps) else 0.22
            p = sphere_point(radius, az + rng.uniform(-wobble, wobble), el + rng.uniform(-wobble, wobble))
            width = 0.028 * (1 - 0.5 * t)
            a = bm.verts.new((p[0], p[1], p[2] + width))
            b = bm.verts.new((p[0], p[1], p[2] - width))
            if previous:
                bm.faces.new((previous[0], a, b, previous[1]))
            previous = (a, b)
    return finish('ArcSegments', bm, [mats['PulsarCore']], parent)


def build_emitter(mats, parent):
    """The lens the beam leaves by: a ring and a short focusing cone, facing game
    forward (Blender -Y)."""
    bm = bmesh.new()
    sides = 12
    y0 = -(ORB_RADIUS - 0.06)
    y1 = -(ORB_RADIUS + 0.16)
    outer = []
    inner = []
    lip = []
    for side in range(sides):
        angle = math.tau * side / sides
        outer.append(bm.verts.new((math.cos(angle) * 0.3, y0, math.sin(angle) * 0.3)))
        inner.append(bm.verts.new((math.cos(angle) * 0.19, y0, math.sin(angle) * 0.19)))
        lip.append(bm.verts.new((math.cos(angle) * 0.24, y1, math.sin(angle) * 0.24)))
    for side in range(sides):
        nxt = (side + 1) % sides
        face = bm.faces.new((outer[side], outer[nxt], lip[nxt], lip[side]))
        face.material_index = 0
        face = bm.faces.new((lip[side], lip[nxt], inner[nxt], inner[side]))
        face.material_index = 1
    return finish('BeamEmitter', bm, [mats['PulsarShell'], mats['PulsarGlow']], parent)


def build_orb():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(MATERIALS)
    rng = random.Random(SEED)
    root = empty('PulsarOrb_ROOT')
    core = empty('Core', root)
    shell = empty('Shell', root)
    details = empty('Details', root)
    vfx = empty('VFXGeometry', root)
    parts = [build_core(mats, core), build_jets(mats, core)]
    parts += [build_fragment(index, rng, mats, shell) for index in range(4)]
    parts.append(build_ring('EnergyRing_A', RING_RADII[0], (math.radians(28), 0, 0), mats, details))
    parts.append(build_ring('EnergyRing_B', RING_RADII[1], (0, math.radians(-44), math.radians(30)), mats, details))
    parts.append(build_runes(mats, details))
    parts.append(build_arcs(mats, vfx))
    parts.append(build_emitter(mats, vfx))
    return parts


def build_core_only():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The mob's BODY is lit by the game (its visual's selfIllumination) and is what
    # its target portrait renders: at the orb's own emission it blows out to a white
    # disc, so the body keeps the colour and lets its facets shade.
    mats = make_materials([('PulsarCore', (0.2, 0.52, 1.0), 0.1, 0.25, 0.6)])
    root = empty('PulsarCore_ROOT')
    return [build_core(mats, root)]


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
    export(build_orb(), 'pulsar_components.glb', 'PULSAR')
    export(build_core_only(), 'pulsar_core_components.glb', 'PULSAR_CORE')
