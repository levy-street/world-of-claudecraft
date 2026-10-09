"""Reference renders of the Gorgebloom's effects, staged on its real clips in the
plunge pool (authoring aid; nothing here ships). LOOK targets for the game's effect
layer, anchored on the bones at the clips' contact frames:

  pods    SeedRain, launch at 1.50 s (still at 1.62): six fat red pods lobbed in glowing
          arcs from MawAnchor onto the loam beds, gold landing rings, sap spatter.
  pollen  Pollinate, burst at 0.55 s (still at 0.60): gold pollen (#E8E05A) blasted from
          the four sacs (Sac_FL, Sac_FR, Sac_BL, Sac_BR tails), a drifting haze.
  lash    VineLash, impact at 1.50 s (still at 1.52): the club (LashTip) slams the
          30 x 4 yd lane, a water sheet and shock rings, thorns bursting along the lane.
  wilt    Death, splash at 2.70 s (still at 2.75): the head hits the pool, a crown
          splash and ripples, torn petal scraps, the last pollen.

  blender -b gorgebloom.blend --python vfx_reference.py -- <out_dir> [--samples 64] [--only a,b] [--knight k.glb]
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


ONLY = opt('--only', 'pods,pollen,lash,wilt').split(',')
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Gorgebloom'))
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.26, 0.33, 0.3), ground=False)
scene.cycles.samples = int(opt('--samples', 64))
for o in [o for o in scene.objects if o.name.startswith('PlayerReference')]:
    bpy.data.objects.remove(o, do_unlink=True)   # the stage's stand-in capsule
FX = []
rng = random.Random(11)


def mat_principled(name, color, rough=0.5, emission=0.0, alpha=1.0, transmission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = transmission
    if emission:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emission
    b.inputs['Alpha'].default_value = alpha
    return m


def plane(name, z, mat, size=200):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    scene.collection.objects.link(o)
    return o


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
    if o.name not in scene.collection.objects:
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


def droplets(name, pts, mat, r=(0.02, 0.06), stretch=(1.0, 2.5), along=None):
    import bmesh
    bm = bmesh.new()
    ax = (along or Vector((0, 0, 1))).normalized()
    rot = ax.to_track_quat('Z', 'Y').to_matrix()
    for p in pts:
        rad = rng.uniform(*r)
        made = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rad)
        st = rng.uniform(*stretch)
        for v in made['verts']:
            v.co = rot @ Vector((v.co.x, v.co.y, v.co.z * st)) + Vector(p)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    return track(o)


def tube(name, pts, radii, mat, sides=10):
    import bmesh
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        s = t.orthogonal().normalized()
        u = t.cross(s).normalized()
        r = radii[i] if hasattr(radii, '__len__') else radii
        rings.append([bm.verts.new(p + (s * math.cos(a) + u * math.sin(a)) * r)
                      for a in (math.tau * k / sides for k in range(sides))])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    return track(o)


def ring(name, c, radius, tube_r, mat, squash=0.35):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube_r, major_segments=72, minor_segments=10,
                                     location=(c[0], c[1], c[2]))
    o = bpy.context.active_object
    o.scale = (1, 1, squash)
    o.data.materials.append(mat)
    return track(o)


def cloud(name, c, radius, height, density=0.5, color=(0.62, 0.52, 0.38)):
    m = bpy.data.materials.new(name + '_m')
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*color, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.0
    nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')
    fall.inputs[1].default_value = 1.0
    fall.inputs[2].default_value = 0.35
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
    return track(o)


def shoot(name, az, el, dist, focus, lens=35):
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(OUT, name + '.png'))


os.makedirs(OUT, exist_ok=True)
knight = opt('--knight')

WATER = mat_principled('fx_water', (0.025, 0.05, 0.045), rough=0.08)
LOAM = mat_principled('fx_loam', (0.16, 0.11, 0.07), rough=0.95)
SEED = mat_principled('fx_seed', (0.55, 0.06, 0.04), rough=0.35, emission=0.6)
SEEDGLOW = mat_principled('fx_seedglow', (1.0, 0.45, 0.1), rough=0.5, emission=6.0)
POLLEN = mat_principled('fx_pollen', (0.91, 0.88, 0.35), rough=0.6, emission=5.0)
POLLEN_SOFT = mat_principled('fx_pollen_soft', (0.91, 0.88, 0.35), rough=0.6, emission=1.6, alpha=0.6)
SPRAY = mat_principled('fx_spray', (0.75, 0.85, 0.82), rough=0.2, emission=0.4)
THORN = mat_principled('fx_thorn', (0.18, 0.42, 0.08), rough=0.5, emission=2.5)
SLIME = mat_principled('fx_slime', (0.35, 0.75, 0.12), rough=0.1, emission=1.5)
PETAL = mat_principled('fx_petal', (0.5, 0.05, 0.04), rough=0.5)
plane('water', 0.0, WATER)


def loam_bed(c, r):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=0.1, location=(c[0], c[1], 0.02), vertices=48)
    o = bpy.context.active_object
    o.data.materials.append(LOAM)
    return track(o)


os.makedirs(OUT, exist_ok=True)
knight = opt('--knight')

if 'pods' in ONLY:
    # Seed Rain at 1.62 s: six pods in arcs from the maw onto the terrace (1 s flight)
    act_time('SeedRain', 1.62)
    m = bone_point('MawAnchor')
    kn = stage.place_knight(knight, (5.0, -11.0, 0.0)) if knight else []
    for k in range(6):
        az = -70 + 28 * k + rng.uniform(-6, 6)
        dist = rng.uniform(9, 16)
        land = Vector((math.sin(math.radians(az)) * dist, -math.cos(math.radians(az)) * dist, 0.15))
        loam_bed(land, 2.0)
        arc = []
        n = 40
        prog = rng.uniform(0.35, 0.75)                     # how far along its arc each pod is
        for i in range(n + 1):
            t = i / n * prog
            p = m.lerp(land, t)
            p.z += 7.0 * math.sin(math.pi * t)
            arc.append(p)
        tube(f'trail{k}', arc, [0.02 + 0.13 * (i / n) for i in range(n + 1)], SEEDGLOW, sides=8)
        pod = arc[-1]
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=pod)
        o = bpy.context.active_object
        o.scale = (0.85, 0.85, 1.2)
        o.data.materials.append(SEED)
        track(o)
        ring(f'land{k}', (land.x, land.y, 0.09), 1.6, 0.06, SEEDGLOW, squash=0.3)
        droplets(f'sap{k}', [pod + Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(-0.5, 0.3)))
                             for _ in range(30)], SLIME, r=(0.03, 0.07))
    cloud('maw_spray', m + Vector((0, -1.2, 0.8)), 1.6, 1.2, density=0.5, color=(0.6, 0.55, 0.2))
    shoot('vfx_lluvia_semillas', 30, 18, 34.0, (0.0, -6.5, 4.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'pollen' in ONLY:
    # Pollinate at 0.60 s: golden pollen blasted from the four sacs
    act_time('Pollinate', 0.6)
    for s in ('Sac_FL', 'Sac_FR', 'Sac_BL', 'Sac_BR'):
        c = bone_point(s, tail=True)
        h = bone_point(s)
        out_d = (c - h).normalized()
        for j in range(3):
            cloud(f'pc_{s}{j}', c + out_d * (1.0 + 1.3 * j) + Vector((0, 0, 0.6 * j)), 1.2 + 0.7 * j, 0.9 + 0.5 * j,
                  density=1.4 - 0.35 * j, color=(0.91, 0.88, 0.35))
        pts = []
        for _ in range(260):
            d = (out_d + Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), rng.uniform(-0.2, 1.0)))).normalized()
            pts.append(c + d * rng.uniform(0.6, 5.0))
        droplets(f'grains_{s}', pts, POLLEN, r=(0.02, 0.06))
        ring(f'puff_{s}', (c.x, c.y, c.z), 1.0, 0.05, POLLEN_SOFT, squash=1.0)
    haze = [Vector((rng.uniform(-9, 9), rng.uniform(-11, 4), rng.uniform(0.3, 6.0))) for _ in range(500)]
    droplets('haze', haze, POLLEN_SOFT, r=(0.015, 0.04))
    shoot('vfx_polen', 40, 12, 30.0, (0.0, -1.0, 5.0), 35)
    clear_fx()

if 'lash' in ONLY:
    # Vine Lash at 1.52 s: the club slams the 30 yd lane ahead (2 yd either side)
    act_time('VineLash', 1.52)
    tip = bone_point('LashTip')
    kn = stage.place_knight(knight, (1.2, -16.0, 0.0)) if knight else []
    lane = [Vector((0.0, -2.0 - i, 0.04)) for i in range(31)]
    for sg in (1, -1):
        tube(f'edge{sg}', [p + Vector((2.0 * sg, 0, 0)) for p in lane], 0.06, THORN, sides=6)
    for i in range(0, 30, 2):                           # thorns bursting up along the lane
        for j in range(3):
            b = Vector((rng.uniform(-1.8, 1.8), -2.5 - i - rng.uniform(0, 2), 0.0))
            ln = rng.uniform(0.5, 1.4) * (1.2 - i / 40)
            tube(f'th{i}_{j}', [b, b + Vector((rng.uniform(-0.2, 0.2), 0.0, ln * 0.6)),
                                b + Vector((rng.uniform(-0.3, 0.3), -0.2, ln))], [0.12, 0.07, 0.01], THORN, sides=5)
    spray = []
    for _ in range(500):                                # the slam's water sheet
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.3, 3.5)
        spray.append(Vector((tip.x + math.cos(a) * rr, tip.y + math.sin(a) * rr,
                             rng.uniform(0.1, 3.2) * (1.15 - rr / 4.0))))
    droplets('spray', spray, SPRAY, r=(0.03, 0.09), stretch=(1.0, 2.5))
    ring('shock', (tip.x, tip.y, 0.05), 3.4, 0.08, SPRAY, squash=0.3)
    ring('shock2', (tip.x, tip.y, 0.05), 5.2, 0.05, SPRAY, squash=0.3)
    cloud('mist', tip + Vector((0, 0, 1.0)), 3.0, 1.6, density=0.5, color=(0.7, 0.8, 0.78))
    shoot('vfx_latigo_impacto', 55, 16, 30.0, (-0.5, -9.0, 2.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'wilt' in ONLY:
    # Death at 2.75 s: the head hits the pool, a crown splash, petals torn loose, the glow going out
    act_time('Death', 2.75)
    m = bone_point('MawAnchor')
    spray = []
    for _ in range(600):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(1.0, 5.0)
        spray.append(Vector((m.x + math.cos(a) * rr, m.y + math.sin(a) * rr, rng.uniform(0.1, 4.0) * (1.2 - rr / 5.5))))
    droplets('crown', spray, SPRAY, r=(0.04, 0.11), stretch=(1.0, 2.2))
    for k, rr in enumerate((3.0, 5.0, 7.5)):
        ring(f'ripple{k}', (m.x, m.y, 0.03), rr, 0.05, SPRAY, squash=0.25)
    for k in range(9):                                  # torn petal scraps floating down
        c = m + Vector((rng.uniform(-5, 5), rng.uniform(-5, 4), rng.uniform(1.0, 6.0)))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=c)
        o = bpy.context.active_object
        o.scale = (1.2, 0.7, 0.06)
        o.rotation_euler = (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0, 6))
        o.data.materials.append(PETAL)
        track(o)
    pts = [m + Vector((rng.uniform(-4, 4), rng.uniform(-4, 4), rng.uniform(0.2, 5))) for _ in range(150)]
    droplets('last_pollen', pts, POLLEN_SOFT, r=(0.02, 0.05))
    cloud('splash_mist', m + Vector((0, 0, 1.2)), 4.0, 2.0, density=0.35, color=(0.7, 0.8, 0.78))
    shoot('vfx_marchitarse', 35, 14, 30.0, (0.0, -2.0, 2.5), 35)
    clear_fx()
print('VFX_DONE')
