"""Reference renders of the Great Saurian's effects, staged on its real clips in a
ford (authoring aid; nothing here ships). LOOK targets for the game's effect
layer (render/wildheart_basin/basin_fx*.ts), anchored on the bones at the clips'
contract frames:

  stomp    Stomp at 2.00 s: a crown of water thrown up round both forefeet, the
           shockwave ring racing out over the ford (12 yd, the encounter's radius),
           ripple rings and a mist.
  tail     TailSwipe at 1.00 s: a curtain of spray thrown off the club along the
           rear arc it sweeps (the 120 degree cone, 12 yd), droplets flung outward.
  howdah   HowdahBreak at 0.95 s: the howdah bursting, bamboo splinters and bone
           shards flung out from the saddle, a puff of dust and thatch.

  blender -b great_saurian.blend --python vfx_reference.py -- <out_dir> [--samples 64] [--only a,b]
"""
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as R  # noqa: E402
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ONLY = opt('--only', 'stomp,tail,howdah').split(',')
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('GreatSaurian'))
for o in scene.objects:
    if o.name.endswith('_hi') or '_hi.' in o.name:
        o.hide_render = True
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.32, 0.4, 0.36), ground=False)
scene.cycles.samples = int(opt('--samples', 64))
for o in scene.objects:
    if o.type == 'LIGHT' and o.name == 'fill':
        o.data.angle = 0.03      # a soft sun mirrors in the glassy ford as a white disc
        o.data.energy = 0.6
    if o.type == 'LIGHT' and o.name == 'key':
        o.data.energy = 4.2
        o.data.color = (1.0, 0.9, 0.72)
WATER_Z = 0.6
FX = []
rng = random.Random(7)


def mat_principled(name, color, rough=0.5, transmission=0.0, emission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['IOR'].default_value = 1.33
    if emission:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emission
    b.inputs['Alpha'].default_value = alpha
    return m


WATER = mat_principled('fx_water', (0.12, 0.3, 0.27), rough=0.06, transmission=0.85)
BED = mat_principled('fx_bed', (0.16, 0.14, 0.09), rough=0.95)
SPRAY = mat_principled('fx_spray', (0.86, 0.93, 0.92), rough=0.15, transmission=0.55, emission=0.25)
FOAM = mat_principled('fx_foam', (0.9, 0.95, 0.93), rough=0.6, emission=0.35, alpha=0.85)
SHARD = mat_principled('fx_shard', (0.62, 0.55, 0.32), rough=0.6)
BONE = mat_principled('fx_bone', (0.82, 0.76, 0.62), rough=0.5)
DUST = None


def plane(name, z, mat, size=300):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    scene.collection.objects.link(o)
    return o


plane('bed', -0.2, BED)
plane('water', WATER_Z, WATER)
stage.place_knight(opt('--knight'), (9.0, -9.0, WATER_Z - 0.6)) if opt('--knight') else None


def compositor_glare():
    try:
        ng = bpy.data.node_groups.new('VfxComp', 'CompositorNodeTree')
        rl = ng.nodes.new('CompositorNodeRLayers')
        g = ng.nodes.new('CompositorNodeGlare')
        try:
            g.glare_type = 'FOG_GLOW'
        except Exception:  # noqa: BLE001
            g.inputs['Type'].default_value = 'Fog Glow'
        out = ng.nodes.new('NodeGroupOutput')
        ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        ng.links.new(rl.outputs['Image'], g.inputs['Image'])
        ng.links.new(g.outputs['Image'], out.inputs[0])
        scene.compositing_node_group = ng
        scene.render.use_compositing = True
    except Exception as e:  # noqa: BLE001
        print('GLARE_SKIPPED', e)


compositor_glare()


def track(o):
    FX.append(o)
    scene.collection.objects.link(o)
    return o


def clear_fx():
    for o in FX:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    FX.clear()


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f = act.frame_range[0] + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def bone_point(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def droplet_cloud(name, points, mat, r=(0.05, 0.16)):
    """Many small icospheres (spray droplets) in one object."""
    import bmesh
    bm = bmesh.new()
    for p in points:
        rad = rng.uniform(*r)
        made = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rad)
        stretch = rng.uniform(1.0, 2.2)
        for v in made['verts']:
            v.co = Vector((v.co.x, v.co.y, v.co.z * stretch)) + Vector(p)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    return track(o)


def ring(name, c, radius, tube, mat, squash=0.35):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=96, minor_segments=10,
                                     location=(c[0], c[1], c[2]))
    o = bpy.context.active_object
    o.scale = (1, 1, squash)
    o.data.materials.append(mat)
    scene.collection.objects.unlink(o)
    for coll in o.users_collection:
        coll.objects.unlink(o)
    return track(o)


def crown(name, c, r0, r1, h, mat, n=48):
    """A crown splash: a jagged, flaring wall of water opening upward."""
    import bmesh
    bm = bmesh.new()
    rows = 6
    verts = []
    for i in range(rows + 1):
        t = i / rows
        row = []
        for k in range(n):
            a = math.tau * k / n
            jag = 1.0 + (0.35 * math.sin(a * 7 + 1.3) + 0.25 * math.sin(a * 13)) * t
            rr = r0 + (r1 - r0) * t ** 1.4
            z = c[2] + h * t * jag
            row.append(bm.verts.new((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, z)))
        verts.append(row)
    for i in range(rows):
        for k in range(n):
            bm.faces.new((verts[i][k], verts[i][(k + 1) % n], verts[i + 1][(k + 1) % n], verts[i + 1][k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    mod = o.modifiers.new('sol', 'SOLIDIFY')
    mod.thickness = 0.06
    return track(o)


def mist(name, c, radius, height, density=0.25):
    m = bpy.data.materials.new(name + '_m')
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.9, 0.95, 0.95, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 2.5
    nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')
    fall.inputs[1].default_value = 1.0
    fall.inputs[2].default_value = 0.3
    nt.links.new(ln.outputs['Value'], fall.inputs[0])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(fall.outputs[0], mul.inputs[0])
    nt.links.new(nz.outputs['Fac'], mul.inputs[1])
    mul2 = nt.nodes.new('ShaderNodeMath')
    mul2.operation = 'MULTIPLY'
    mul2.inputs[1].default_value = density
    nt.links.new(mul.outputs[0], mul2.inputs[0])
    nt.links.new(mul2.outputs[0], vol.inputs['Density'])
    nt.links.new(vol.outputs[0], outn.inputs['Volume'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(c[0], c[1], c[2]))
    o = bpy.context.active_object
    o.scale = (radius, radius, height)
    o.data.materials.append(m)
    for coll in o.users_collection:
        coll.objects.unlink(o)
    return track(o)


def shards(name, origin, n, speed, t, mat, size=(0.5, 1.4), up=4.0):
    """Splinters flung out from a point, frozen `t` seconds after the burst."""
    import bmesh
    bm = bmesh.new()
    for _ in range(n):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.0, 1.0))).normalized()
        v = d * speed * rng.uniform(0.5, 1.2) + Vector((0, 0, up))
        p = Vector(origin) + v * t + Vector((0, 0, -6.5 * t * t))
        ln = rng.uniform(*size)
        made = bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=0.07, radius2=0.01, depth=ln)
        axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        rot = axis.to_track_quat('Z', 'Y').to_matrix()
        for vv in made['verts']:
            vv.co = rot @ vv.co + p
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    return track(o)


def shoot(name, az, el, dist, focus, lens=35):
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(OUT, name + '.png'))


os.makedirs(OUT, exist_ok=True)
if 'stomp' in ONLY:
    act_time('Stomp', 2.04)
    feet = [bone_point('L_Hand'), bone_point('R_Hand')]
    mid = (feet[0] + feet[1]) * 0.5
    for i, f in enumerate(feet):
        c = (f.x, f.y - 0.3, WATER_Z)
        crown(f'crown{i}', c, 1.3, 3.2, 4.2, SPRAY)
        pts = []
        for _ in range(260):
            a = rng.uniform(0, math.tau)
            rr = rng.uniform(1.2, 4.8)
            pts.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, WATER_Z + rng.uniform(0.3, 6.0) * (1.1 - rr / 6)))
        droplet_cloud(f'drops{i}', pts, SPRAY)
    ring('shock', (mid.x, mid.y, WATER_Z + 0.05), 9.0, 0.45, FOAM, squash=0.5)
    for rr in (5.0, 12.0, 14.5):
        ring(f'ripple{rr}', (mid.x, mid.y, WATER_Z + 0.02), rr, 0.12, FOAM, squash=0.3)
    mist('mist', (mid.x, mid.y, WATER_Z + 1.2), 8.0, 2.6)
    shoot('vfx_pisoton_onda_y_salpicadura', 38, 14, 62, (0.0, -2.0, 5.0))
    clear_fx()
if 'tail' in ONLY:
    path = []
    for k in range(13):
        tt = 0.8 + k * 0.035
        act_time('TailSwipe', tt)
        path.append(bone_point('Tail7', tail=True))
    act_time('TailSwipe', 1.02)
    import bmesh
    bm = bmesh.new()
    rows = []
    for k, p in enumerate(path):
        w = k / (len(path) - 1)
        h = 4.2 * math.sin(math.pi * min(1.0, w * 1.1)) ** 0.7 + 0.5
        lean = Vector((p.x, p.y - 3.0, 0)).normalized() * 0.8
        rows.append([bm.verts.new((p.x, p.y, WATER_Z)), bm.verts.new((p.x + lean.x, p.y + lean.y, WATER_Z + h))])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    me = bpy.data.meshes.new('curtain')
    bm.to_mesh(me)
    bm.free()
    cur = bpy.data.objects.new('curtain', me)
    me.materials.append(SPRAY)
    cur.modifiers.new('sol', 'SOLIDIFY').thickness = 0.05
    track(cur)
    pts = []
    for p in path:
        for _ in range(45):
            out = Vector((p.x, p.y - 3.0, 0)).normalized()
            q = p + out * rng.uniform(0.0, 4.5)
            pts.append((q.x + rng.uniform(-0.6, 0.6), q.y + rng.uniform(-0.6, 0.6), WATER_Z + rng.uniform(0.2, 4.5)))
    droplet_cloud('tdrops', pts, SPRAY)
    for p in path[::3]:
        ring('wake', (p.x, p.y, WATER_Z + 0.02), 1.4, 0.15, FOAM, squash=0.3)
    shoot('vfx_coletazo_rocio_de_agua', 140, 18, 58, (0.0, 10.0, 3.5))
    clear_fx()
if 'howdah' in ONLY:
    act_time('HowdahBreak', 1.05)
    c = bone_point('Saddle')
    c = Vector((c.x, c.y, c.z + 1.4))
    shards('splinters', c, 220, 11.0, 0.18, SHARD, size=(0.6, 1.8))
    shards('boneshards', c, 60, 9.0, 0.18, BONE, size=(0.35, 0.9))
    dust = mat_principled('fx_dust', (0.55, 0.47, 0.33), rough=1.0)
    pts = []
    for _ in range(320):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.3, 1))).normalized()
        q = c + d * rng.uniform(0.5, 3.6)
        pts.append((q.x, q.y, q.z))
    droplet_cloud('thatch', pts, dust, r=(0.04, 0.12))
    shoot('vfx_palanquin_estalla', 40, 10, 40, (c.x, c.y, c.z - 1.0))
    clear_fx()
print('VFX_DONE')
