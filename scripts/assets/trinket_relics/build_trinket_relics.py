# Builds the Crucible raid trinket relic models in Blender, headless, from
# nothing but this script (no reference image, no sculpt, no texture).
#
#   blender --background --factory-startup --python \
#     scripts/assets/trinket_relics/build_trinket_relics.py -- [--preview <dir>]
#
# Writes the raw GLB to tmp/asset_src/trinket_relics/trinket_relics-raw.glb,
# then feed it to the optimizer:
#
#   node scripts/assets/build_assets.mjs scripts/assets/specs/trinket_relics.json
#   node scripts/build_media_manifest.mjs generate
#
# One GLB, three root nodes the renderer clones by name
# (src/render/trinket_relics.ts):
#   KindlingOrb       molten rock plates over a glowing core (Kindling Orb)
#   LastFlameLantern  iron lantern with a golden flame (Last Flame Lantern)
#   TemperHammer      a smith's hammer with a white-hot face (Forgefather's Temper)
#
# Two materials shared by all three: Body (lit, COLOR_0 carries the rock, iron
# and wood colours) and Glow (unlit at runtime, COLOR_0 carries the ember,
# flame and hot-steel colours). NO textures, so the KTX2 texture gate has
# nothing to convert and the file stays a few KB. Every random draw goes
# through one seeded generator walked in index order, so a rebuild reproduces
# the same shapes and colours. The Blender exporter's vertex ORDER is not
# byte-stable from run to run, though, so a re-export re-pins the bytes and
# sha256 in tests/trinket_relics.test.ts (its structural pins must hold).
#
# Axes: Blender is Z-up; the glTF exporter writes Y-up. Every model is centred
# on X/Y; the orb is centred at its origin (it floats), the lantern stands on
# Z=0, the hammer's origin is its grip end (it swings about the hand).

import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_DIR = os.path.join(ROOT, 'tmp', 'asset_src', 'trinket_relics')
OUT = os.path.join(OUT_DIR, 'trinket_relics-raw.glb')

rng = random.Random(0x7E1C5)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hexv):
    r = ((hexv >> 16) & 255) / 255.0
    g = ((hexv >> 8) & 255) / 255.0
    b = (hexv & 255) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


BASALT = lin(0x3A302B)
BASALT_HOT = lin(0x8A3312)
EMBER = lin(0xFF7A1E)
EMBER_CORE = lin(0xFFC24A)
IRON = lin(0x3C3F45)
IRON_EDGE = lin(0x6E6960)
BRASS = lin(0x9C7A3C)
WAX = lin(0xE9DDBF)
FLAME = lin(0xFFD36A)
FLAME_TIP = lin(0xFF8A2A)
WOOD = lin(0x7A5230)
LEATHER = lin(0x3A2616)
STEEL = lin(0x5E636B)
HOT_STEEL = lin(0xFF9A3A)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_materials():
    body = bpy.data.materials.new('Body')
    body.use_nodes = True
    nt = body.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.82
    bsdf.inputs['Metallic'].default_value = 0.0

    glow = bpy.data.materials.new('Glow')
    glow.use_nodes = True
    nt = glow.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 4.0
    return body, glow


def new_object(name, bm, mats):
    # Triangulate here, with fixed methods, rather than leave it to the
    # exporter: its own n-gon split is not stable from run to run.
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='FIXED', ngon_method='EAR_CLIP')
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in mats:
        mesh.materials.append(m)
    return obj


def ordered(bm, elems):
    """BMesh elements hash by address, so a set iterates in a different order
    every run; walk them by index so the seeded draws land identically."""
    bm.verts.index_update()
    bm.faces.index_update()
    return sorted(elems, key=lambda e: e.index)


def paint(bm, layer, face, color):
    for loop in face.loops:
        loop[layer] = color


# ---------------------------------------------------------------- orb

def build_orb(body, glow):
    """Cracked basalt plates floating a hair off a molten core: the gaps
    between plates ARE the glowing cracks, so no texture is needed."""
    R = 0.2
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=R)
    layer = bm.loops.layers.color.new('Col')
    # Plate seeds: Voronoi cells over the sphere.
    seeds = []
    for _ in range(14):
        v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if v.length < 1e-3:
            v = Vector((0, 0, 1))
        seeds.append(v.normalized())
    plate_of = {}
    for f in bm.faces:
        c = f.calc_center_median().normalized()
        plate_of[f] = max(range(len(seeds)), key=lambda i: c.dot(seeds[i]))
    split = [e for e in bm.edges if len(e.link_faces) == 2
             and plate_of[e.link_faces[0]] != plate_of[e.link_faces[1]]]
    bmesh.ops.split_edges(bm, edges=split)
    bm.faces.ensure_lookup_table()
    # Group faces by plate (after the split each plate is its own island).
    plates = {}
    for f in bm.faces:
        c = f.calc_center_median().normalized()
        p = max(range(len(seeds)), key=lambda i: c.dot(seeds[i]))
        plates.setdefault(p, []).append(f)
    for p, faces in plates.items():
        verts = {v for f in faces for v in f.verts}
        centre = sum((v.co for v in ordered(bm, verts)), Vector()) / len(verts)
        bump = rng.uniform(0.02, 0.05)
        edge_verts = {v for v in verts if any(e.is_boundary for e in v.link_edges)}
        for v in ordered(bm, verts):
            d = v.co - centre
            v.co = centre + d * 0.9
            v.co = v.co.normalized() * (R * (1.0 + bump) + rng.uniform(-0.006, 0.006))
        for f in faces:
            for loop in f.loops:
                hot = 1.0 if loop.vert in edge_verts else 0.0
                loop[layer] = mix(BASALT, BASALT_HOT, 0.55 * hot + rng.uniform(0, 0.12))
            f.material_index = 0
    # Molten core, a touch smaller than the plates' inner face.
    core = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=R * 0.93)
    for v in core['verts']:
        v.co *= 1.0 + rng.uniform(-0.03, 0.03)
    core_faces = {f for v in core['verts'] for f in v.link_faces}
    for f in ordered(bm, core_faces):
        f.material_index = 1
        for loop in f.loops:
            loop[layer] = mix(EMBER, EMBER_CORE, rng.uniform(0.0, 0.6))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj = new_object('KindlingOrb', bm, [body, glow])
    return obj


# ---------------------------------------------------------------- lantern

def box(bm, layer, cx, cy, cz, sx, sy, sz, color, mat=0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
    faces = {f for v in r['verts'] for f in v.link_faces}
    for f in faces:
        f.material_index = mat
        paint(bm, layer, f, color)
    return faces


def cyl(bm, layer, cx, cy, z0, z1, r0, r1, segs, color, mat=0, cap=True, rot=0.0):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                              radius1=r0, radius2=r1, depth=z1 - z0)
    cr, sr = math.cos(rot), math.sin(rot)
    for v in r['verts']:
        x, y = v.co.x * cr - v.co.y * sr, v.co.x * sr + v.co.y * cr
        v.co = Vector((cx + x, cy + y, v.co.z + (z0 + z1) / 2))
    faces = {f for v in r['verts'] for f in v.link_faces}
    for f in faces:
        f.material_index = mat
        paint(bm, layer, f, color)
    return faces


def build_lantern(body, glow):
    bm = bmesh.new()
    layer = bm.loops.layers.color.new('Col')
    # Footed base plate and the floor of the cage.
    cyl(bm, layer, 0, 0, 0.0, 0.035, 0.15, 0.14, 8, IRON)
    box(bm, layer, 0, 0, 0.05, 0.2, 0.2, 0.03, IRON_EDGE)
    # Four corner posts.
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(bm, layer, sx * 0.088, sy * 0.088, 0.24, 0.022, 0.022, 0.36, IRON)
    # Mid and top rails.
    for z in (0.25, 0.42):
        for sx in (-1, 1):
            box(bm, layer, sx * 0.088, 0, z, 0.016, 0.18, 0.016, IRON_EDGE)
            box(bm, layer, 0, sx * 0.088, z, 0.18, 0.016, 0.016, IRON_EDGE)
    # Hip roof, brass cap and hanging ring.
    cyl(bm, layer, 0, 0, 0.42, 0.56, 0.16, 0.03, 4, IRON, rot=math.pi / 4)
    cyl(bm, layer, 0, 0, 0.56, 0.6, 0.035, 0.025, 6, BRASS)
    ring = bmesh.ops.create_circle(bm, cap_ends=False, segments=8, radius=0.05)
    ring_verts = ring['verts']
    for v in ring_verts:
        v.co = Vector((v.co.x, 0.0, 0.65 + v.co.y))
    ring_geom = bmesh.ops.extrude_edge_only(
        bm, edges=[e for e in bm.edges if all(v in ring_verts for v in e.verts)])
    new_verts = [g for g in ring_geom['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in new_verts:
        v.co.y += 0.018
    for f in {f for v in new_verts for f in v.link_faces}:
        f.material_index = 0
        paint(bm, layer, f, BRASS)
    # Candle stub and the flame (a teardrop, the Glow bucket).
    cyl(bm, layer, 0, 0, 0.065, 0.16, 0.035, 0.032, 8, WAX)
    flame = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.06)
    for v in flame['verts']:
        z = v.co.z / 0.06  # -1..1
        taper = 1.0 - max(0.0, z) * 0.75
        v.co = Vector((v.co.x * taper, v.co.y * taper, 0.235 + v.co.z * 1.4))
    for f in {f for v in flame['verts'] for f in v.link_faces}:
        f.material_index = 1
        for loop in f.loops:
            t = max(0.0, min(1.0, (loop.vert.co.z - 0.16) / 0.13))
            loop[layer] = mix(FLAME, FLAME_TIP, t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_object('LastFlameLantern', bm, [body, glow])


# ---------------------------------------------------------------- hammer

def build_hammer(body, glow):
    """Grip end at the origin, haft up +Z, head across X, striking face -X...
    the renderer swings it about the grip."""
    bm = bmesh.new()
    layer = bm.loops.layers.color.new('Col')
    cyl(bm, layer, 0, 0, 0.0, 0.52, 0.026, 0.022, 6, WOOD)
    cyl(bm, layer, 0, 0, 0.02, 0.2, 0.031, 0.031, 6, LEATHER)
    cyl(bm, layer, 0, 0, -0.03, 0.02, 0.036, 0.032, 6, IRON)
    # Head: a squared block with a chamfered back and the hot striking face.
    box(bm, layer, 0.0, 0, 0.58, 0.2, 0.1, 0.12, STEEL)
    box(bm, layer, 0.13, 0, 0.58, 0.07, 0.08, 0.09, IRON_EDGE)
    box(bm, layer, -0.115, 0, 0.58, 0.035, 0.108, 0.128, HOT_STEEL, mat=1)
    # Heat seams glowing out of both cheeks behind the striking face,
    # longest nearest the face, as if the heat were creeping back up the head.
    for sy in (-1, 1):
        for dz, length in ((-0.03, 0.12), (0.0, 0.085), (0.03, 0.05)):
            box(bm, layer, -0.1 + length / 2, sy * 0.051, 0.58 + dz, length, 0.004, 0.011,
                EMBER, mat=1)
    # Iron bands where the haft enters the head.
    box(bm, layer, 0, 0, 0.505, 0.07, 0.07, 0.03, IRON)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_object('TemperHammer', bm, [body, glow])


# ---------------------------------------------------------------- preview

def preview(objs, out_dir):
    scene = bpy.context.scene
    # Cycles on the CPU: headless EEVEE can stall waiting on a GPU context.
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('PreviewWorld')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.028, 0.035, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    try:
        scene.view_settings.view_transform = 'Standard'
    except TypeError:
        pass
    key = bpy.data.lights.new('Key', 'SUN')
    key.energy = 4.5
    key_obj = bpy.data.objects.new('Key', key)
    key_obj.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(key_obj)
    fill = bpy.data.lights.new('Fill', 'SUN')
    fill.energy = 1.5
    fill_obj = bpy.data.objects.new('Fill', fill)
    fill_obj.rotation_euler = (math.radians(70), 0, math.radians(-140))
    scene.collection.objects.link(fill_obj)
    cam = bpy.data.cameras.new('Cam')
    cam.lens = 60
    cam_obj = bpy.data.objects.new('Cam', cam)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    shots = {
        'KindlingOrb': ('orbe.png', Vector((0, 0, 0)), 0.9),
        'LastFlameLantern': ('farol.png', Vector((0, 0, 0.33)), 1.75),
        'TemperHammer': ('martillo.png', Vector((0, 0, 0.32)), 1.9),
    }
    for obj in objs:
        for o in objs:
            o.hide_render = o is not obj
        name, target, dist = shots[obj.name]
        eye = target + Vector((0.62, -0.78, 0.42)).normalized() * dist
        cam_obj.location = eye
        cam_obj.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview_dir = None
    if '--preview' in argv:
        preview_dir = argv[argv.index('--preview') + 1]
    reset()
    body, glow = make_materials()
    objs = [build_orb(body, glow), build_lantern(body, glow), build_hammer(body, glow)]
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_vertex_color='ACTIVE',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_yup=True,
    )
    print('wrote', OUT)
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        preview(objs, preview_dir)


main()
