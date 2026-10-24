"""Reference renders of the Great Jaguar's effects, staged on its real clips in the
Beast Pits (authoring aid; nothing here ships). LOOK targets for the game's
effect layer, anchored on the bones at the clips' contract frames:

  bite    Bite at 0.50 s: the jaws close on the prey: a spray of dark blood thrown
          forward and down off the fangs, two pale snap arcs, a red mist, drops
          spattering the sand (the bleed starts here).
  leap    Pounce at 1.50 s: the forepaws land: a ring of sand blasted out from the
          paws, a dust cloud, flung pebbles, and the dust trail of the arc behind.
  bond    Idle: the jade spirit cord from the collar's jade ring (BondAnchor) to the
          Beastmaster (a stand-in figure 10 yd away): a sagging braided cord of
          jade light with spirit wisps (Pack Bond).

  blender -b great_jaguar.blend --python vfx_reference.py -- <out_dir> [--samples 64] [--only a,b] [--knight k.glb]
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


ONLY = opt('--only', 'bite,leap,bond').split(',')
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('GreatJaguar'))
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.3, 0.36, 0.3), ground=False)
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


SAND = mat_principled('fx_sand', (0.42, 0.33, 0.2), rough=0.95)
BLOOD = mat_principled('fx_blood', (0.28, 0.01, 0.01), rough=0.15, transmission=0.2)
SNAP = mat_principled('fx_snap', (1.0, 0.86, 0.75), rough=0.5, emission=3.0)
DUSTM = mat_principled('fx_dust', (0.6, 0.5, 0.36), rough=1.0)
PEBBLE = mat_principled('fx_pebble', (0.32, 0.27, 0.2), rough=0.9)
JADE = mat_principled('fx_jade', (0.25, 1.0, 0.6), rough=0.3, emission=7.0)
JADE_SOFT = mat_principled('fx_jade_soft', (0.2, 0.9, 0.55), rough=0.3, emission=2.5, alpha=0.5)


def plane(name, z, mat, size=200):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(name, me)
    me.materials.append(mat)
    scene.collection.objects.link(o)
    return o


plane('sand', 0.0, SAND)


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

if 'bite' in ONLY:
    kn = stage.place_knight(knight, (0.0, -6.4, 0.0)) if knight else []
    act_time('Bite', 0.52)
    jaw = bone_point('Jaw', tail=True)
    head = bone_point('Head', tail=True)
    mouth = (jaw + head) * 0.5
    fwd = Vector((0, -1, -0.25)).normalized()
    pts = []
    for _ in range(420):
        d = (fwd + Vector((rng.uniform(-0.7, 0.7), rng.uniform(-0.3, 0.3), rng.uniform(-0.4, 0.6)))).normalized()
        q = mouth + d * rng.uniform(0.2, 2.2)
        q.z -= 0.25 * (q - mouth).length ** 2
        pts.append(q)
    droplets('blood', pts, BLOOD, r=(0.018, 0.06), stretch=(1.2, 3.0), along=fwd)
    spl = [Vector((mouth.x + rng.uniform(-1.4, 1.4), mouth.y - rng.uniform(0.5, 2.6), 0.01)) for _ in range(70)]
    droplets('spatter', spl, BLOOD, r=(0.05, 0.14), stretch=(0.08, 0.12))
    for k, (r0, tilt) in enumerate(((0.55, 0.35), (0.42, -0.4))):
        arc = []
        for i in range(24):
            a = -1.2 + 2.4 * i / 23
            arc.append(mouth + Vector((math.sin(a) * r0, -0.25 - 0.15 * math.cos(a), math.cos(a) * r0 * tilt)))
        tube(f'snap{k}', arc, [0.004 + 0.03 * math.sin(math.pi * i / 23) for i in range(24)], SNAP, sides=6)
    cloud('bloodmist', mouth + Vector((0, -0.8, -0.2)), 0.9, 0.6, density=0.6, color=(0.5, 0.05, 0.04))
    shoot('vfx_mordisco_sangre', 62, 8, 9.5, (mouth.x, mouth.y - 0.6, mouth.z - 0.6), 40)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'leap' in ONLY:
    act_time('Pounce', 1.52)
    paws = [bone_point('L_FToes'), bone_point('R_FToes')]
    mid = (paws[0] + paws[1]) * 0.5
    for k in range(12):                              # the sand blasted out in a ring of puffs
        a = math.tau * k / 12
        cloud(f'ring{k}', (mid.x + math.cos(a) * 2.3, mid.y - 0.2 + math.sin(a) * 2.3, 0.35), 0.75, 0.45, density=0.9)
    ring('blast2', (mid.x, mid.y - 0.2, 0.03), 3.6, 0.06, DUSTM, squash=0.3)
    for p in paws:
        cloud('puff', (p.x, p.y - 0.2, 0.5), 1.4, 0.8, density=1.2)
    cloud('dust', (mid.x, mid.y + 1.0, 0.9), 3.6, 1.3, density=0.5)
    pts = []
    for _ in range(240):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.8, 3.8)
        pts.append(Vector((mid.x + math.cos(a) * rr, mid.y - 0.2 + math.sin(a) * rr,
                           rng.uniform(0.05, 1.6) * (1.2 - rr / 4.5))))
    droplets('pebbles', pts, PEBBLE, r=(0.025, 0.07), stretch=(0.8, 1.4))
    # the dust trail of the arc behind it (the path it flew)
    trail = [Vector((0, 2.0 + 1.6 * i, 0.4 + 1.4 * math.sin(math.pi * (1 - i / 7)))) for i in range(8)]
    for i, p in enumerate(trail):
        cloud(f'trail{i}', p, 0.9 - 0.08 * i, 0.6, density=0.25 - 0.025 * i)
    shoot('vfx_salto_polvo', 55, 10, 15.5, (0.0, -1.5, 1.4), 35)
    clear_fx()

if 'bond' in ONLY:
    act_time('Idle', 1.0)
    master_at = Vector((7.5, -6.5, 0.0))
    kn = stage.place_knight(knight, tuple(master_at), 3.0) if knight else []
    a = bone_point('BondAnchor') + Vector((0, 0, 0.1))
    b = master_at + Vector((0, 0, 1.9))
    pts = []
    n = 60
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= 1.1 * math.sin(math.pi * t)            # the cord sags between them
        pts.append(p)
    tube('cord_core', pts, [0.06 - 0.025 * (i / n) for i in range(n + 1)], JADE, sides=10)
    for k in range(3):                                   # three braided strands round the core
        strand = []
        for i, p in enumerate(pts):
            t = i / n
            ang = t * 18.0 + k * math.tau / 3
            tang = (pts[min(i + 1, n)] - pts[max(i - 1, 0)]).normalized()
            s = tang.orthogonal().normalized()
            u = tang.cross(s)
            strand.append(p + (s * math.cos(ang) + u * math.sin(ang)) * (0.16 - 0.06 * t))
        tube(f'strand{k}', strand, 0.02, JADE_SOFT, sides=6)
    wisps = []
    for i in range(160):
        t = rng.random()
        p = pts[int(t * n)]
        wisps.append(p + Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), rng.uniform(-0.2, 0.6))))
    droplets('wisps', wisps, JADE, r=(0.015, 0.04), stretch=(1.0, 3.0))
    ring('anchor_glow', (a.x, a.y, a.z), 0.24, 0.03, JADE, squash=1.0)
    ring('ground_glow', (a.x, a.y, 0.02), 2.0, 0.05, JADE_SOFT, squash=0.3)
    ring('ground_glow2', (b.x, b.y, 0.02), 1.2, 0.05, JADE_SOFT, squash=0.3)
    for o in scene.objects:
        if o.type == 'LIGHT':
            o.data.energy *= 0.45
    shoot('vfx_cordon_jade', 20, 12, 21.0, (3.4, -3.8, 2.2), 35)
    clear_fx()
print('VFX_DONE')
