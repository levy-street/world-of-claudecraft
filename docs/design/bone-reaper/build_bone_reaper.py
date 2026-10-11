"""Bonelord Xarreth's arena mechanics: the editable Blender source.

Run headless from the repository root:

    blender --background --python docs/design/bone-reaper/build_bone_reaper.py

It rebuilds both assets from the numbers below and writes, beside this file,
  scythe_components.glb   the Wandering Scythe
  soul_components.glb     one Soul Harvest soul
which the shipping build (scripts/assets/bone_reaper/build.mjs) optimizes into
public/vfx/bone-reaper/.

Original project art authored procedurally from the owner's briefs. No
third-party mesh, texture or reference image is used.

Conventions the runtime relies on (src/render/hoard_bone_reaper.ts):
  - Blender is Z-up; the glTF export turns that into Y-up. Game forward (+Z,
    the direction an angle of 0 faces) is Blender -Y, and game +X is Blender +X.
  - The scythe is modelled at TRUE SCALE, one Blender metre to one game yard,
    lying flat with its PIVOT at the origin and its shaft along game forward.
    The gameplay numbers are copied from src/sim/rift/hoard_bone_reaper_core.ts
    (REACH, BLADE_INNER, BLADE_ARC); tests/hoard_bone_reaper_render.test.ts
    pins that the mesh and the hitbox agree.
  - The blade LEADS the shaft toward game +X, the way the blade turns
    (rotationDirection +1): the runtime only ever rotates the root about Y.
  - Everything that moves or is tinted at runtime is its own named part. Nothing
    is animated here: rotation, travel, glow and break-up are all code.
"""
import math
import os
import random

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- gameplay mirror
REACH = 8.6  # pivot to blade tip
BLADE_INNER = 5.0  # pivot to the blade's heel
BLADE_ARC = 0.62  # radians the blade leads the shaft

# ---------------------------------------------------------------- scythe tunables
SHAFT_START = 0.95
SHAFT_BONES = 5
BONE_RADIUS = 0.28
BONE_KNUCKLE = 0.48
BAND_RADIUS = 0.54
BAND_LENGTH = 0.36
POMMEL_LENGTH = 1.7
HUB_RADIUS = 1.05
HUB_HEIGHT = 0.7
BLADE_STEPS = 16
BLADE_SPINE_THICKNESS = 0.32
BLADE_HEEL_INNER = BLADE_INNER + 0.25
BLADE_EDGE_BAND = 0.2  # share of the blade's width that is the bright edge
FRAGMENTS = 11
SEED = 20260920

# ---------------------------------------------------------------- soul tunables
SOUL_HEIGHT = 2.3
SOUL_HEAD_RADIUS = 0.34
SOUL_CORE_RADIUS = 0.2
SOUL_SIDES = 10
SOUL_WISPS = 3

SCYTHE_MATERIALS = [
    # name, colour, metallic, roughness, emission strength
    ('Bone', (0.78, 0.74, 0.62), 0.0, 0.7, 0.0),
    ('BoneDark', (0.36, 0.33, 0.27), 0.0, 0.82, 0.0),
    ('DarkMetal', (0.06, 0.07, 0.085), 0.8, 0.42, 0.0),
    ('BladeEdge', (0.62, 0.7, 0.72), 0.9, 0.22, 0.0),
    ('NecroGlow', (0.45, 1.0, 0.78), 0.0, 0.4, 5.0),
]
SOUL_MATERIALS = [
    ('SoulCore', (0.92, 1.0, 1.0), 0.0, 0.4, 8.0),
    ('SoulBody', (0.55, 0.92, 0.95), 0.0, 0.5, 2.0),
    ('SoulVoid', (0.02, 0.06, 0.09), 0.0, 0.9, 0.0),
    ('SoulWisp', (0.62, 1.0, 0.92), 0.0, 0.5, 3.0),
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


def polar(radius, ahead, z=0.0):
    """Game polar (radius from the pivot, angle AHEAD of the shaft) to Blender."""
    return (radius * math.sin(ahead), -radius * math.cos(ahead), z)


# ---------------------------------------------------------------- bmesh helpers
def add_lathe(bm, along, profile, sides, mat, wobble=0.0, rng=None, spin=0.0):
    """A solid of revolution about the shaft axis (Blender -Y). `profile` is a list
    of (distance from the pivot, radius); `wobble` breaks the symmetry."""
    rings = []
    for distance, radius in profile:
        ring = []
        ox = (rng.uniform(-wobble, wobble) if rng else 0.0)
        oz = (rng.uniform(-wobble, wobble) if rng else 0.0)
        for index in range(sides):
            angle = spin + math.tau * index / sides
            ring.append(
                bm.verts.new(
                    (
                        ox + math.cos(angle) * radius,
                        -(along + distance),
                        oz + math.sin(angle) * radius,
                    )
                )
            )
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for index in range(sides):
            nxt = (index + 1) % sides
            bm.faces.new([a[index], a[nxt], b[nxt], b[index]]).material_index = mat
    bm.faces.new(list(reversed(rings[0]))).material_index = mat
    bm.faces.new(rings[-1]).material_index = mat


def add_spike(bm, base_center, tip, radius, sides, mat):
    cx, cy, cz = base_center
    tx, ty, tz = tip
    # An orthonormal frame around the spike's axis.
    ax, ay, az = tx - cx, ty - cy, tz - cz
    length = math.sqrt(ax * ax + ay * ay + az * az) or 1.0
    ax, ay, az = ax / length, ay / length, az / length
    ux, uy, uz = (0.0, 0.0, 1.0) if abs(az) < 0.9 else (1.0, 0.0, 0.0)
    # u = normalize(up - axis * dot)
    dot = ux * ax + uy * ay + uz * az
    ux, uy, uz = ux - ax * dot, uy - ay * dot, uz - az * dot
    ul = math.sqrt(ux * ux + uy * uy + uz * uz) or 1.0
    ux, uy, uz = ux / ul, uy / ul, uz / ul
    vx, vy, vz = ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux
    ring = []
    for index in range(sides):
        angle = math.tau * index / sides
        c, s = math.cos(angle) * radius, math.sin(angle) * radius
        ring.append(bm.verts.new((cx + ux * c + vx * s, cy + uy * c + vy * s, cz + uz * c + vz * s)))
    apex = bm.verts.new(tip)
    for index in range(sides):
        nxt = (index + 1) % sides
        bm.faces.new([ring[index], ring[nxt], apex]).material_index = mat
    bm.faces.new(list(reversed(ring))).material_index = mat


def finish(name, bm, materials, parent, bevel=0.0, smooth=False):
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
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(38)
    return obj


# ---------------------------------------------------------------- the scythe
def bone_profile(length):
    """A long bone: flared knuckles at both ends, a slim waist, never symmetric."""
    k, r = BONE_KNUCKLE, BONE_RADIUS
    return [
        (0.0, k * 0.72),
        (length * 0.05, k),
        (length * 0.13, k * 0.86),
        (length * 0.24, r * 1.12),
        (length * 0.55, r),
        (length * 0.8, r * 1.2),
        (length * 0.9, k * 0.92),
        (length * 0.97, k * 1.06),
        (length, k * 0.7),
    ]


def build_shaft(mats, root):
    rng = random.Random(SEED)
    bm = bmesh.new()
    order = [mats['Bone'], mats['BoneDark'], mats['DarkMetal']]
    span = (REACH - 0.35) - SHAFT_START
    step = span / SHAFT_BONES
    for index in range(SHAFT_BONES):
        start = SHAFT_START + index * step
        length = step - BAND_LENGTH * 0.55
        add_lathe(
            bm, start, bone_profile(length), 8, index % 2, wobble=0.045, rng=rng,
            spin=rng.uniform(0, math.tau),
        )
        # The dark metal band that binds each joint, cracked and never square.
        band_at = start + length - BAND_LENGTH * 0.2
        add_lathe(
            bm,
            band_at,
            [(0.0, BAND_RADIUS * 0.9), (BAND_LENGTH * 0.2, BAND_RADIUS),
             (BAND_LENGTH * 0.8, BAND_RADIUS * rng.uniform(0.92, 1.05)), (BAND_LENGTH, BAND_RADIUS * 0.88)],
            7, 2, spin=rng.uniform(0, math.tau),
        )
    # The counterweight behind the pivot: a short bone and a metal spike.
    add_lathe(bm, -POMMEL_LENGTH, bone_profile(POMMEL_LENGTH - 0.75), 8, 1, wobble=0.04, rng=rng)
    add_spike(bm, (0, POMMEL_LENGTH - 0.05, 0), (0, POMMEL_LENGTH + 0.9, 0.06), 0.3, 6, 2)
    return finish('Scythe_Shaft', bm, order, root, bevel=0.0)


def build_hub(mats, root):
    bm = bmesh.new()
    order = [mats['BoneDark'], mats['Bone'], mats['DarkMetal']]
    # A vertebra-like knot the whole weapon turns on.
    sides = 10
    rings = []
    for z, radius in ((-HUB_HEIGHT / 2, HUB_RADIUS * 0.78), (-HUB_HEIGHT * 0.2, HUB_RADIUS),
                      (HUB_HEIGHT * 0.2, HUB_RADIUS), (HUB_HEIGHT / 2, HUB_RADIUS * 0.74)):
        rings.append([
            bm.verts.new((math.cos(math.tau * i / sides) * radius, math.sin(math.tau * i / sides) * radius, z))
            for i in range(sides)
        ])
    for a, b in zip(rings, rings[1:]):
        for i in range(sides):
            n = (i + 1) % sides
            bm.faces.new([a[i], a[n], b[n], b[i]]).material_index = 0
    bm.faces.new(list(reversed(rings[0]))).material_index = 0
    bm.faces.new(rings[-1]).material_index = 2
    # Bone spurs radiating from it, uneven on purpose.
    rng = random.Random(SEED + 1)
    for index in range(7):
        angle = math.tau * index / 7 + rng.uniform(-0.18, 0.18)
        if abs(math.sin(angle)) < 0.35 and math.cos(angle) < 0:
            continue  # leave the shaft's side clear
        reach = HUB_RADIUS + rng.uniform(0.5, 0.95)
        add_spike(
            bm,
            (math.sin(angle) * HUB_RADIUS * 0.8, -math.cos(angle) * HUB_RADIUS * 0.8, 0),
            (math.sin(angle) * reach, -math.cos(angle) * reach, rng.uniform(-0.12, 0.2)),
            0.17, 5, 1,
        )
    return finish('Scythe_Hub', bm, order, root, bevel=0.03)


def build_hub_core(mats, root):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.34)
    for face in bm.faces:
        face.material_index = 0
    obj = finish('Scythe_HubCore', bm, [mats['NecroGlow']], root)
    obj.location = (0, 0, HUB_HEIGHT / 2 + 0.2)
    return obj


def blade_radii(t):
    """Inner and outer radius of the blade at arc fraction t (0 heel, 1 tip)."""
    outer = REACH - 0.05 - 0.55 * (t ** 2.2)
    inner = BLADE_HEEL_INNER + (outer - BLADE_HEEL_INNER) * (t ** 0.82)
    return inner, outer


# Chips out of the cutting edge: (arc fraction, depth). An old blade.
CHIPS = [(0.18, 0.2), (0.41, 0.13), (0.63, 0.24), (0.8, 0.1)]


def build_blade(mats, root):
    bm = bmesh.new()
    order = [mats['DarkMetal'], mats['BladeEdge'], mats['Bone']]
    rows = []
    for step in range(BLADE_STEPS + 1):
        t = step / BLADE_STEPS
        ahead = BLADE_ARC * t
        inner, outer = blade_radii(t)
        for at, depth in CHIPS:
            inner += depth * max(0.0, 1 - abs(t - at) / 0.035)
        inner = min(inner, outer - 0.02)
        band = inner + (outer - inner) * BLADE_EDGE_BAND
        thick = BLADE_SPINE_THICKNESS * (1 - 0.72 * t)
        rows.append({
            'spine_top': bm.verts.new(polar(outer, ahead, thick / 2)),
            'spine_bot': bm.verts.new(polar(outer, ahead, -thick / 2)),
            'band_top': bm.verts.new(polar(band, ahead, thick * 0.3)),
            'band_bot': bm.verts.new(polar(band, ahead, -thick * 0.3)),
            'edge': bm.verts.new(polar(inner, ahead, 0.0)),
        })
    for a, b in zip(rows, rows[1:]):
        bm.faces.new([a['spine_top'], b['spine_top'], b['band_top'], a['band_top']]).material_index = 0
        bm.faces.new([a['band_top'], b['band_top'], b['edge'], a['edge']]).material_index = 1
        bm.faces.new([a['band_bot'], b['band_bot'], b['spine_bot'], a['spine_bot']]).material_index = 0
        bm.faces.new([a['edge'], b['edge'], b['band_bot'], a['band_bot']]).material_index = 1
        bm.faces.new([a['spine_bot'], b['spine_bot'], b['spine_top'], a['spine_top']]).material_index = 0
    heel = rows[0]
    bm.faces.new([heel['spine_top'], heel['band_top'], heel['edge'], heel['band_bot'], heel['spine_bot']]).material_index = 0
    tip = rows[-1]
    bm.faces.new([tip['spine_bot'], tip['band_bot'], tip['edge'], tip['band_top'], tip['spine_top']]).material_index = 0
    # Bone spurs up the spine, raked back against the turn: a weapon grown, not forged.
    for t in (0.1, 0.27, 0.44, 0.6, 0.75):
        _, outer = blade_radii(t)
        ahead = BLADE_ARC * t
        add_spike(bm, polar(outer - 0.12, ahead, 0.0), polar(outer + 0.3, ahead - 0.085, 0.16), 0.15, 5, 2)
    # The bone jaw that grips the blade to the shaft, and its metal collar.
    add_lathe(bm, REACH - 1.25, [(0.0, 0.34), (0.2, 0.5), (0.95, 0.52), (1.2, 0.36)], 8, 0)
    add_spike(bm, polar(REACH - 0.2, -0.02, 0.0), polar(REACH + 0.85, -0.06, 0.12), 0.26, 6, 0)
    return finish('Scythe_Blade', bm, order, root, bevel=0.0)


def build_cracks(mats, root):
    """Glowing fractures across the blade's upper face: thin raised ribbons."""
    rng = random.Random(SEED + 2)
    bm = bmesh.new()
    lift = BLADE_SPINE_THICKNESS / 2 + 0.012
    for start_t in (0.07, 0.2, 0.34, 0.5, 0.66, 0.8):
        t = start_t
        inner, outer = blade_radii(t)
        radius = outer - 0.12
        points = []
        while radius > inner + 0.25 and len(points) < 8:
            points.append((radius, BLADE_ARC * t))
            radius -= rng.uniform(0.28, 0.55)
            t = min(0.97, max(0.02, t + rng.uniform(-0.035, 0.05)))
            inner, _ = blade_radii(t)
        width = 0.045
        for (r0, a0), (r1, a1) in zip(points, points[1:]):
            da = width / max(r0, 0.1)
            quad = [polar(r0, a0 - da, lift), polar(r0, a0 + da, lift),
                    polar(r1, a1 + da * 0.7, lift * 0.8), polar(r1, a1 - da * 0.7, lift * 0.8)]
            bm.faces.new([bm.verts.new(p) for p in quad]).material_index = 0
    return finish('Scythe_Cracks', bm, [mats['NecroGlow']], root)


def build_fragments(mats, root):
    """Bone shards adrift around the blade. One mesh: the runtime bobs the node."""
    rng = random.Random(SEED + 3)
    bm = bmesh.new()
    for _ in range(FRAGMENTS):
        radius = rng.uniform(BLADE_INNER - 0.4, REACH + 0.5)
        ahead = rng.uniform(-0.25, BLADE_ARC + 0.2)
        center = polar(radius, ahead, rng.uniform(-0.55, 0.85))
        size = rng.uniform(0.12, 0.26)
        top = (center[0] + rng.uniform(-size, size), center[1] + rng.uniform(-size, size), center[2] + size * 2.2)
        add_spike(bm, center, top, size, 4, rng.randint(0, 1))
    return finish('Scythe_Fragments', bm, [mats['Bone'], mats['BoneDark']], root)


def build_scythe():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(SCYTHE_MATERIALS)
    root = bpy.data.objects.new('WanderingScythe_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    return [
        build_shaft(mats, root),
        build_hub(mats, root),
        build_hub_core(mats, root),
        build_blade(mats, root),
        build_cracks(mats, root),
        build_fragments(mats, root),
    ]


# ---------------------------------------------------------------- the soul
def soul_body_profile():
    """(height, radius, drift back) up the ghost: a trailing tail, a swelling
    body, shoulders and a head. The drift bends the tail away behind it."""
    h, r = SOUL_HEIGHT, SOUL_HEAD_RADIUS
    return [
        (0.0, 0.01, 1.35),
        (h * 0.08, 0.045, 1.05),
        (h * 0.18, 0.1, 0.74),
        (h * 0.3, 0.17, 0.46),
        (h * 0.43, 0.25, 0.24),
        (h * 0.55, 0.31, 0.09),
        (h * 0.64, 0.27, 0.02),
        # A gaunt neck, a narrow jaw, hollow cheeks, then the long cranium.
        (h * 0.7, 0.15, 0.0),
        (h * 0.745, r * 0.62, -0.02),
        (h * 0.8, r * 0.86, -0.02),
        (h * 0.87, r, 0.0),
        (h * 0.94, r * 0.9, 0.03),
        (h * 0.985, r * 0.55, 0.05),
        (h, r * 0.12, 0.06),
    ]


def build_soul_body(mats, root):
    bm = bmesh.new()
    rings = []
    for z, radius, back in soul_body_profile():
        ring = []
        for index in range(SOUL_SIDES):
            angle = math.tau * index / SOUL_SIDES
            # A slight flattening front to back makes it read as a figure, not a pin.
            ring.append(bm.verts.new((math.cos(angle) * radius, back + math.sin(angle) * radius * 0.82, z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for index in range(SOUL_SIDES):
            nxt = (index + 1) % SOUL_SIDES
            bm.faces.new([a[index], a[nxt], b[nxt], b[index]]).material_index = 0
    bm.faces.new(list(reversed(rings[0]))).material_index = 0
    bm.faces.new(rings[-1]).material_index = 0
    return finish('SpectralBody', bm, [mats['SoulBody']], root, smooth=True)


def build_soul_core(mats, root):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=SOUL_CORE_RADIUS)
    for face in bm.faces:
        face.material_index = 0
    obj = finish('SoulCore', bm, [mats['SoulCore']], root)
    obj.location = (0, 0, SOUL_HEIGHT * 0.56)
    return obj


def build_soul_face(mats, root):
    """The impression of a skull: two hollow eyes and a long mouth, set just proud
    of the head toward the front (Blender -Y, the way it travels)."""
    bm = bmesh.new()
    head_z = SOUL_HEIGHT * 0.875
    front = -SOUL_HEAD_RADIUS * 0.82 - 0.02
    def patch(cx, cz, w, h, tilt):
        pts = []
        # A convex kite: a hollow socket, never a folded quad.
        for dx, dz in ((0.0, -h), (w, 0.1 * h), (0.0, h), (-w, 0.1 * h)):
            x = cx + dx * math.cos(tilt) - dz * math.sin(tilt)
            z = cz + dx * math.sin(tilt) + dz * math.cos(tilt)
            # Wrap onto the head's curve so it never floats off the silhouette.
            y = front + (x * x) * 0.9
            pts.append(bm.verts.new((x, y, z)))
        bm.faces.new(pts).material_index = 0
    patch(-0.135, head_z + 0.02, 0.075, 0.13, 0.55)
    patch(0.135, head_z + 0.02, 0.075, 0.13, -0.55)
    # A long mouth, open in a silent scream.
    patch(0.0, head_z - 0.21, 0.07, 0.2, 0.0)
    return finish('FaceHint', bm, [mats['SoulVoid']], root)


def build_soul_wisps(mats, root):
    """Ribbons that coil round the body: the runtime spins this node."""
    bm = bmesh.new()
    for wisp in range(SOUL_WISPS):
        phase = math.tau * wisp / SOUL_WISPS
        steps = 12
        last = None
        for step in range(steps + 1):
            t = step / steps
            angle = phase + t * math.tau * 0.85
            radius = 0.56 - 0.3 * t
            z = SOUL_HEIGHT * (0.1 + 0.6 * t)
            width = 0.055 * math.sin(math.pi * t) + 0.006
            a = bm.verts.new((math.cos(angle) * radius, math.sin(angle) * radius, z - width))
            b = bm.verts.new((math.cos(angle) * radius, math.sin(angle) * radius, z + width))
            if last:
                bm.faces.new([last[0], a, b, last[1]]).material_index = 0
            last = (a, b)
    return finish('OuterWisps', bm, [mats['SoulWisp']], root)


def build_soul():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials(SOUL_MATERIALS)
    root = bpy.data.objects.new('SoulHarvest_Soul_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    return [
        build_soul_body(mats, root),
        build_soul_core(mats, root),
        build_soul_face(mats, root),
        build_soul_wisps(mats, root),
    ]


# ---------------------------------------------------------------- export
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
    export(build_scythe(), 'scythe_components.glb', 'SCYTHE')
    export(build_soul(), 'soul_components.glb', 'SOUL')
