"""The Blade of Lantern Hall: the guild's sword appearance, sold by its quartermaster.

A broad steel blade with a fuller of banked lantern-fire running up its heart, gilt cheeks at
the ricasso, a crossguard whose quillons sweep up like the brackets lanterns hang from with a
small caged lantern burning at its centre, a blue leather grip and a lantern-cap pommel.

Authored at the Season 1 sword frame (cinderbrand.glb): blade up +Z in Blender (+Y in glTF),
the grip at the origin, the pommel at z -0.37 and the tip at z 1.66. The look is painted into a
single 512 albedo with an ORM map: the weapon VFX derives its glow from the albedo's warm,
bright, saturated texels (src/render/weapon_vfx.ts, the emissive window), so everything meant
to burn is painted hot amber and everything gilt is kept deep enough to stay metal.

Original procedural work for this project (no imported meshes, no reference art).

  blender --background --factory-startup --python \
      scripts/assets/lantern_hall_steed/build_sword.py -- public/models/weapons/lantern_hall_sword.glb [out.blend]

Written straight to its shipping path, like the Season 1 skins (no meshopt or quantization pass:
the skin family ships plain glTF with WebP textures, and the weapon VFX derives its glow from the
albedo canvas).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
BLEND = args[1] if len(args) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

# (base colour sRGB, roughness, metallic). The fire is the only paint inside the VFX window.
SURF = {
    'steel': ((0.62, 0.65, 0.70), 0.32, 0.9),
    'steel_edge': ((0.86, 0.88, 0.92), 0.22, 0.95),
    'steel_dark': ((0.30, 0.32, 0.36), 0.45, 0.85),
    'gold': ((0.62, 0.40, 0.12), 0.3, 1.0),
    'gold_dark': ((0.36, 0.22, 0.06), 0.4, 1.0),
    'fire': ((1.0, 0.62, 0.16), 0.5, 0.0),
    'fire_hot': ((1.0, 0.84, 0.46), 0.5, 0.0),
    'leather': ((0.05, 0.10, 0.30), 0.7, 0.0),
    'leather_dark': ((0.025, 0.05, 0.16), 0.75, 0.0),
    'iron': ((0.16, 0.17, 0.19), 0.5, 0.8),
}
MATS = {}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


for name, (col, rough, metal) in SURF.items():
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[srgb_to_lin(c) for c in col], 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m

BM = bmesh.new()
FACE_MAT = []
ORDER = list(SURF)


def add_face(vs, mat, smooth=False):
    f = BM.faces.new(vs)
    f.material_index = ORDER.index(mat)
    f.smooth = smooth
    return f


def V(co):
    return BM.verts.new(Vector(co))


def loft(rings, mat, smooth=False, cap0=True, cap1=True, mats=None):
    """Join successive rings (lists of points with equal length) into a closed surface."""
    vr = [[V(p) for p in r] for r in rings]
    n = len(rings[0])
    for k in range(len(vr) - 1):
        for i in range(n):
            j = (i + 1) % n
            add_face([vr[k][i], vr[k][j], vr[k + 1][j], vr[k + 1][i]], (mats[k] if mats else mat), smooth)
    if cap0:
        add_face(list(reversed(vr[0])), mats[0] if mats else mat)
    if cap1:
        add_face(vr[-1], mats[-1] if mats else mat)
    return vr


def ring(cz, rx, ry, sides, x0=0.0, y0=0.0, rot=0.0):
    return [Vector((x0 + math.cos(rot + 2 * math.pi * i / sides) * rx,
                    y0 + math.sin(rot + 2 * math.pi * i / sides) * ry, cz)) for i in range(sides)]


def tube(a, b, r, mat, sides=8, r2=None, smooth=True):
    a, b = Vector(a), Vector(b)
    z = (b - a).normalized()
    x = Vector((0, 0, 1)).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    r2 = r if r2 is None else r2
    ra = [a + (x * math.cos(t) + y * math.sin(t)) * r for t in (2 * math.pi * i / sides for i in range(sides))]
    rb = [b + (x * math.cos(t) + y * math.sin(t)) * r2 for t in (2 * math.pi * i / sides for i in range(sides))]
    loft([ra, rb], mat, smooth)


def torus(c, axis, R, r, mat, seg=12, sides=6):
    c = Vector(c)
    z = Vector(axis).normalized()
    x = Vector((0, 0, 1)).cross(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x.normalize()
    y = z.cross(x)
    rings = []
    for i in range(seg + 1):
        t = 2 * math.pi * i / seg
        radial = x * math.cos(t) + y * math.sin(t)
        rings.append([c + radial * (R + r * math.cos(s)) + z * (r * math.sin(s))
                      for s in (2 * math.pi * k / sides for k in range(sides))])
    loft(rings, mat, True, False, False)


# ---------------------------------------------------------------------------
# The blade: a broad lozenge section that swells a little below the middle and
# runs to a strong point. Edge bevels in bright steel, the flats in steel, and a
# fuller of lantern-fire inlaid up both faces.
# ---------------------------------------------------------------------------
BLADE_Z0, BLADE_Z1 = 0.24, 1.66


def blade_width(t):
    # t 0 at the ricasso, 1 at the point
    base = 0.14 + 0.03 * math.sin(math.pi * min(1.0, t * 1.5))
    if t > 0.82:
        base *= max(0.0, (1 - t) / 0.18) ** 0.8
    return max(base, 0.002)


def blade():
    rings, mats = [], []
    steps = 22
    for k in range(steps + 1):
        t = k / steps
        z = BLADE_Z0 + (BLADE_Z1 - BLADE_Z0) * t
        w = blade_width(t)
        th = 0.034 * (1 - 0.75 * t)
        bev = min(w * 0.22, 0.03)
        # an 8-point section: edge tip, bevel shoulder, flat, ridge... both faces
        rings.append([Vector(p) for p in (
            (w, 0, z), (w - bev, th * 0.55, z), (w * 0.35, th, z), (-w * 0.35, th, z),
            (-w + bev, th * 0.55, z), (-w, 0, z), (-w + bev, -th * 0.55, z), (-w * 0.35, -th, z),
            (w * 0.35, -th, z), (w - bev, -th * 0.55, z))])
        mats.append('steel')
    vr = loft(rings, 'steel', False, True, True, mats)
    # paint the edge bevels bright
    for f in BM.faces:
        if f.material_index == ORDER.index('steel'):
            xs = [abs(v.co.x) for v in f.verts]
            zs = [v.co.z for v in f.verts]
            if min(zs) >= BLADE_Z0 - 1e-6:
                w = blade_width((sum(zs) / len(zs) - BLADE_Z0) / (BLADE_Z1 - BLADE_Z0))
                if min(xs) > w * 0.5:
                    f.material_index = ORDER.index('steel_edge')
    # the fuller: a burning channel up both faces, a gilt border round it
    for side in (1, -1):
        rr = []
        steps = 16
        for k in range(steps + 1):
            t = 0.14 + 0.6 * k / steps
            z = BLADE_Z0 + (BLADE_Z1 - BLADE_Z0) * t
            th = 0.034 * (1 - 0.75 * t) + 0.0015
            fw = 0.032 * (1 - 0.55 * (k / steps)) if k < steps else 0.004
            rr.append((z, th, fw))
        for (z0, th0, w0), (z1, th1, w1) in zip(rr, rr[1:]):
            # gilt border
            for (wa, wb, mat, lift) in ((w0 + 0.012, w1 + 0.012, 'gold', 0.0012), (w0, w1, 'fire', 0.0024)):
                q = [V((-wa, side * (th0 + lift), z0)), V((wa, side * (th0 + lift), z0)),
                     V((wb, side * (th1 + lift), z1)), V((-wb, side * (th1 + lift), z1))]
                add_face(q if side > 0 else list(reversed(q)), mat)
            # the hot core line down the middle
            q = [V((-w0 * 0.3, side * (th0 + 0.0032), z0)), V((w0 * 0.3, side * (th0 + 0.0032), z0)),
                 V((w1 * 0.3, side * (th1 + 0.0032), z1)), V((-w1 * 0.3, side * (th1 + 0.0032), z1))]
            add_face(q if side > 0 else list(reversed(q)), 'fire_hot')
    # gilt cheeks at the ricasso: a pointed arch plate each face, the guild lantern engraved
    for side in (1, -1):
        th = 0.034 + 0.003
        pts = [(-0.09, 0.25), (0.09, 0.25), (0.09, 0.31), (0.05, 0.36), (0.0, 0.385), (-0.05, 0.36), (-0.09, 0.31)]
        top = [V((x, side * (th + 0.006), z)) for x, z in pts]
        bot = [V((x, side * th, z)) for x, z in pts]
        add_face(top if side < 0 else list(reversed(top)), 'gold')
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            q = [bot[i], bot[j], top[j], top[i]]
            add_face(q if side > 0 else list(reversed(q)), 'gold_dark')
        # the engraved lantern: a lit pane under a peaked cap
        lp = [(-0.022, 0.27), (0.022, 0.27), (0.022, 0.315), (-0.022, 0.315)]
        q = [V((x, side * (th + 0.0072), z)) for x, z in lp]
        add_face(q if side < 0 else list(reversed(q)), 'fire')
        cap = [(-0.032, 0.315), (0.032, 0.315), (0.0, 0.345)]
        q = [V((x, side * (th + 0.0072), z)) for x, z in cap]
        add_face(q if side < 0 else list(reversed(q)), 'gold_dark')


blade()


# ---------------------------------------------------------------------------
# The guard: the quillons sweep out and up like a lantern bracket and curl into
# scrolls; at the centre a little hexagonal lantern burns in a gilt cage.
# ---------------------------------------------------------------------------
def guard():
    # the guard block the blade seats in
    loft([ring(0.1, 0.075, 0.05, 8, rot=math.pi / 8), ring(0.2, 0.06, 0.042, 8, rot=math.pi / 8)], 'gold_dark')
    for sgn in (1, -1):
        pts = []
        for k in range(10):
            t = k / 9
            x = sgn * (0.06 + 0.24 * t)
            z = 0.15 + 0.11 * t * t
            pts.append(Vector((x, 0, z)))
        for k, (a, b) in enumerate(zip(pts, pts[1:])):
            r0 = 0.034 * (1 - 0.45 * k / 9)
            r1 = 0.034 * (1 - 0.45 * (k + 1) / 9)
            tube(a, b, r0, 'gold', sides=8, r2=r1)
        # the scroll at each tip, and a hanging ring like a lantern hook
        torus(pts[-1] + Vector((sgn * 0.02, 0, 0.018)), (0, 1, 0), 0.03, 0.011, 'gold', seg=12, sides=6)
        torus(pts[5] + Vector((0, 0, -0.04)), (0, 1, 0), 0.016, 0.005, 'gold_dark', seg=10, sides=5)
    # the lantern at the heart of the guard, its glass facing out of both flats
    cz0, cz1 = 0.04, 0.215
    R = 0.085
    loft([ring(cz0, R, R, 6), ring(cz0 + 0.016, R + 0.006, R + 0.006, 6)], 'gold')
    loft([ring(cz1 - 0.016, R + 0.006, R + 0.006, 6), ring(cz1, R, R, 6)], 'gold')
    loft([ring(cz0 + 0.012, R - 0.012, R - 0.012, 6), ring(cz1 - 0.012, R - 0.012, R - 0.012, 6)], 'fire_hot',
         smooth=False)
    # a hotter flame core seen through each pane
    loft([ring(cz0 + 0.04, 0.03, 0.03, 6), ring(cz0 + 0.1, 0.045, 0.045, 6), ring(cz1 - 0.02, 0.012, 0.012, 6)],
         'fire', smooth=True)
    for k in range(6):
        a = 2 * math.pi * k / 6
        x, y = math.cos(a) * (R - 0.004), math.sin(a) * (R - 0.004)
        tube((x, y, cz0 + 0.01), (x, y, cz1 - 0.01), 0.009, 'gold_dark', sides=5)
    # peaked cap under the blade root
    loft([ring(cz1, R + 0.008, R + 0.008, 6), ring(cz1 + 0.035, 0.03, 0.03, 6)], 'gold_dark', cap0=False)


guard()


# ---------------------------------------------------------------------------
# Grip and pommel: blue leather in a raised spiral wrap between gilt ferrules,
# and a lantern-cap pommel with a ring.
# ---------------------------------------------------------------------------
def grip():
    loft([ring(-0.3, 0.032, 0.03, 10), ring(0.06, 0.03, 0.028, 10)], 'leather', smooth=True)
    for k in range(9):
        z = -0.28 + k * 0.04
        torus((0, 0, z), (0.25, 0, 1), 0.031, 0.006, 'leather_dark', seg=12, sides=5)
    loft([ring(0.035, 0.04, 0.038, 10), ring(0.065, 0.045, 0.042, 10)], 'gold')
    loft([ring(-0.32, 0.042, 0.04, 10), ring(-0.29, 0.038, 0.036, 10)], 'gold')
    # pommel: an inverted lantern cap with a lit drop and a ring
    loft([ring(-0.32, 0.038, 0.038, 6), ring(-0.34, 0.06, 0.06, 6), ring(-0.36, 0.05, 0.05, 6),
          ring(-0.375, 0.016, 0.016, 6)], 'gold', mats=['gold', 'gold_dark', 'gold'])
    torus((0, 0, -0.39), (0, 1, 0), 0.02, 0.006, 'gold', seg=10, sides=5)
    for k in range(6):
        a = 2 * math.pi * k / 6 + math.pi / 6
        c = Vector((math.cos(a) * 0.058, math.sin(a) * 0.058, -0.348))
        torus(c, (math.cos(a), math.sin(a), 0), 0.007, 0.004, 'fire', seg=8, sides=4)


grip()

me = bpy.data.meshes.new('lantern_hall_sword')
BM.normal_update()
BM.to_mesh(me)
BM.free()
for name in ORDER:
    me.materials.append(MATS[name])
ob = bpy.data.objects.new('lantern_hall_sword', me)
bpy.context.scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')
print('SWORD verts', len(me.vertices), 'faces', len(me.polygons))

# ---------------------------------------------------------------------------
# Bake the look into one albedo and one ORM (occlusion 1, roughness, metal), the
# Season 1 sword's texture set, then swap the per-part materials for one.
# ---------------------------------------------------------------------------
SIZE = 512
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.cycles.device = 'CPU'


def bake_to(img_name, value_of, colorspace, grain=False):
    img = bpy.data.images.new(img_name, SIZE, SIZE, alpha=False)
    img.colorspace_settings.name = colorspace
    saved = {}
    for name, m in MATS.items():
        nt = m.node_tree
        out = nt.nodes['Material Output']
        saved[name] = out.inputs['Surface'].links[0].from_socket
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (*value_of(name), 1)
        if grain and not name.startswith('fire'):
            # forge grain: a fine streaked noise along the blade, so the steel and gilt read as
            # worked metal rather than flat paint
            noise = nt.nodes.new('ShaderNodeTexNoise')
            noise.inputs['Scale'].default_value = 38.0
            noise.inputs['Detail'].default_value = 6.0
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (1.0, 1.0, 0.18)
            tcn = nt.nodes.new('ShaderNodeTexCoord')
            nt.links.new(tcn.outputs['Object'], mp.inputs['Vector'])
            nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
            mr = nt.nodes.new('ShaderNodeMapRange')
            mr.inputs['To Min'].default_value = 0.78
            mr.inputs['To Max'].default_value = 1.18
            nt.links.new(noise.outputs['Fac'], mr.inputs['Value'])
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            mul.inputs['A'].default_value = (*value_of(name), 1)
            nt.links.new(mr.outputs['Result'], mul.inputs['B'])
            nt.links.new(mul.outputs['Result'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.nodes.active = tex
    bpy.ops.object.bake(type='EMIT', margin=4)
    for name, m in MATS.items():
        nt = m.node_tree
        out = nt.nodes['Material Output']
        nt.links.new(saved[name], out.inputs['Surface'])
    return img


albedo = bake_to('lantern_hall_sword_color', lambda n: [srgb_to_lin(c) for c in SURF[n][0]], 'sRGB', grain=True)
orm = bake_to('lantern_hall_sword_orm', lambda n: (1.0, SURF[n][1], SURF[n][2]), 'Non-Color')


def bake_normal():
    """A tangent-space normal map of the forge grain: the same streaked noise that marks the
    albedo, raised as a faint hammered relief on the metal (the Season 1 skins all ship a normal
    map; the weapon material path expects one)."""
    img = bpy.data.images.new('lantern_hall_sword_normal', SIZE, SIZE, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    for name, m in MATS.items():
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 38.0
        noise.inputs['Detail'].default_value = 6.0
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0, 1.0, 0.18)
        tcn = nt.nodes.new('ShaderNodeTexCoord')
        nt.links.new(tcn.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.0 if name.startswith(('fire', 'leather')) else 0.12
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.nodes.active = tex
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=4)
    return img


normal = bake_normal()

final = bpy.data.materials.new('lantern_hall_sword')
final.use_nodes = True
# a closed solid: single-sided, so the skin keeps the default (culled) weapon material path
final.use_backface_culling = True
nt = final.node_tree
b = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexImage')
tc.image = albedo
nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
to = nt.nodes.new('ShaderNodeTexImage')
to.image = orm
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(to.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
# occlusion from the ORM's red channel, the Season 1 skins' slot layout (the exporter reads it off
# a 'glTF Material Output' group's Occlusion input)
gltf_out = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
gltf_out.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
grp = nt.nodes.new('ShaderNodeGroup')
grp.node_tree = gltf_out
nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
tn = nt.nodes.new('ShaderNodeTexImage')
tn.image = normal
nm = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
me.materials.clear()
me.materials.append(final)
for poly in me.polygons:
    poly.material_index = 0

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_apply=True,
                          use_selection=True)
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
print('BUILT', OUT)
