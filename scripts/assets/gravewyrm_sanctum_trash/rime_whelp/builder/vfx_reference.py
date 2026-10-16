"""Reference renders of Korzul's effects, staged on his real clips over a slab of the
frozen lake (authoring aid; nothing here ships). LOOK targets for the game's effect
layer, anchored on the bones at the clips' contract frames:

  breath    BreathGround at 2.7 s: the Grave Breath from the Mouth bone: a cone of
            deathly fire, shard-gold at the core over grave-green, licking along the
            ice; the plates it covers crack with glowing fractures.
  shard     Idle: the heart-shard in the chest, its rose-gold light through the scales
            and the veins (the emissive map), a soft halo and the light it throws.
  shatter   BreakFree at 1.55 s: the quench-ice bursting off him: the slabs in flight,
            a spray of ice splinters and a burst of frost mist.
  land      Land at 1.20 s: the Crashing Descent: the plate under him cracks in a
            glowing web from the impact, chunks kicked up, a ring of snow-dust.
  inferno   GraveInferno at 8.0 s: the fourth pulse: a ring of grave fire round him at
            14 yd, fire licking up off the ice, embers, the shard blazing.

  blender -b korzul.blend --python vfx_reference.py -- <out_dir> [--samples 64] [--only a,b] [--knight k.glb]
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
OUT = os.path.abspath(argv[0])


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ONLY = opt('--only', 'breath,shard,shatter,land,inferno').split(',')
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Korzul'))
shed = bpy.data.objects.get('KorzulShedIce')
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.08, 0.11, 0.2), ground=False)
scene.cycles.samples = int(opt('--samples', 64))
for o in [o for o in scene.objects if o.name.startswith('PlayerReference')]:
    bpy.data.objects.remove(o, do_unlink=True)
for o in scene.objects:
    if o.type == 'LIGHT':
        o.data.energy *= 0.55          # the polar dusk
FX = []
rng = random.Random(23)


def mat(name, color, rough=0.5, emission=0.0, alpha=1.0, transmission=0.0, ecolor=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = transmission
    if emission:
        b.inputs['Emission Color'].default_value = (*(ecolor or color), 1)
        b.inputs['Emission Strength'].default_value = emission
    b.inputs['Alpha'].default_value = alpha
    return m


ICE_FLOOR = mat('fx_lake', (0.3, 0.45, 0.58), rough=0.35)
ICE_CHUNK = mat('fx_ice', (0.7, 0.88, 0.98), rough=0.08, transmission=0.4)
GOLD = mat('fx_gold', (1.0, 0.68, 0.3), rough=0.4, emission=4.0)
GREEN = mat('fx_green', (0.2, 0.85, 0.45), rough=0.4, emission=1.8)
GREEN_SOFT = mat('fx_green_soft', (0.25, 0.9, 0.5), rough=0.4, emission=3.0, alpha=0.6)
CRACK = mat('fx_crack', (1.0, 0.55, 0.2), rough=0.4, emission=5.0)
ROSE = mat('fx_rose', (1.0, 0.68, 0.45), rough=0.4, emission=10.0)
SNOW = mat('fx_snow', (0.9, 0.95, 1.0), rough=0.9)


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


def lake(cx=0.0, cy=0.0):
    """A slab of the frozen lake: one 18 yd plate and its neighbours (outlined)."""
    me = bpy.data.meshes.new('lake')
    s = 300
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('lake', me)
    me.materials.append(ICE_FLOOR)
    scene.collection.objects.link(o)
    seams = mat('fx_seam', (0.25, 0.4, 0.5), rough=0.6)
    for k in range(6):
        a0, a1 = math.tau * k / 6, math.tau * (k + 1) / 6
        r = 9.5
        p0 = Vector((cx + math.cos(a0) * r, cy + math.sin(a0) * r, 0.02))
        p1 = Vector((cx + math.cos(a1) * r, cy + math.sin(a1) * r, 0.02))
        tube('seam', [p0, p1], 0.08, seams, sides=6, keep=True)
    return o


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    if shed is not None:
        shed.hide_render = name not in ('Frozen', 'FrozenAwaken', 'BreakFree')
    f = act.frame_range[0] + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def bone_point(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def blobs(name, pts, material, r=(0.1, 0.3), stretch=(1.0, 2.5), along=None, sub=1):
    import bmesh
    bm = bmesh.new()
    for i, p in enumerate(pts):
        ax = (along[i] if isinstance(along, list) else (along or Vector((0, 0, 1)))).normalized()
        rot = ax.to_track_quat('Z', 'Y').to_matrix()
        rad = rng.uniform(*r)
        made = bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=rad)
        st = rng.uniform(*stretch)
        for v in made['verts']:
            v.co = rot @ Vector((v.co.x, v.co.y, v.co.z * st)) + Vector(p)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = True
    return track(o)


def tube(name, pts, radii, material, sides=8, keep=False):
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
    me.materials.append(material)
    if keep:
        scene.collection.objects.link(o)
        return o
    return track(o)


def cloud(name, c, radius, height, density=0.5, color=(0.8, 0.9, 1.0), emit=0.0, ecolor=(0.3, 1.0, 0.5)):
    m = bpy.data.materials.new(name + '_m')
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*color, 1)
    if emit:
        vol.inputs['Emission Color'].default_value = (*ecolor, 1)
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
    if emit:
        mul3 = nt.nodes.new('ShaderNodeMath')
        mul3.operation = 'MULTIPLY'
        mul3.inputs[1].default_value = emit
        nt.links.new(mul.outputs[0], mul3.inputs[0])
        nt.links.new(mul3.outputs[0], vol.inputs['Emission Strength'])
    nt.links.new(vol.outputs[0], outn.inputs['Volume'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(c[0], c[1], c[2]))
    o = bpy.context.active_object
    o.scale = (radius, radius, height)
    o.data.materials.append(m)
    return track(o)


def light(c, energy, color, size=2.0):
    ld = bpy.data.lights.new('fxl', 'POINT')
    ld.energy = energy
    ld.color = color
    ld.shadow_soft_size = size
    o = bpy.data.objects.new('fxl', ld)
    o.location = c
    return track(o)


def crack_web(center, radius, n=14, seed=0, material=CRACK, z=0.03, width=0.09):
    r2 = random.Random(seed)
    for k in range(n):
        a = math.tau * k / n + r2.uniform(-0.2, 0.2)
        pts = [Vector((center[0], center[1], z))]
        p = Vector(pts[0])
        ang = a
        L = radius * r2.uniform(0.6, 1.0)
        steps = 8
        for i in range(steps):
            ang += r2.uniform(-0.35, 0.35)
            p = p + Vector((math.cos(ang), math.sin(ang), 0)) * (L / steps)
            pts.append(Vector((p.x, p.y, z)))
        tube(f'crack{k}', pts, [width * (1 - i / (steps + 1)) + 0.02 for i in range(steps + 1)], material, sides=5)
        if r2.random() < 0.6:          # a branch
            j = r2.randint(2, steps - 2)
            q = Vector(pts[j])
            b2 = ang + r2.choice((-1, 1)) * 0.9
            br = [q]
            for i in range(4):
                q = q + Vector((math.cos(b2), math.sin(b2), 0)) * (L / steps)
                br.append(Vector((q.x, q.y, z)))
            tube(f'crackb{k}', br, [width * 0.6 * (1 - i / 5) + 0.015 for i in range(5)], material, sides=5)
    # the concentric ring fractures
    for rr in (radius * 0.35, radius * 0.7):
        ring = [Vector((center[0] + math.cos(math.tau * i / 40) * rr * r2.uniform(0.95, 1.05),
                        center[1] + math.sin(math.tau * i / 40) * rr * r2.uniform(0.95, 1.05), z)) for i in range(41)]
        tube('ringcrack', ring, width * 0.5, material, sides=5)


def shoot(name, az, el, dist, focus, lens=35):
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(OUT, name + '.png'))


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
os.makedirs(OUT, exist_ok=True)
lake()
knight = opt('--knight')

if 'breath' in ONLY:
    act_time('BreathGround', 2.7)
    mouth = bone_point('Mouth')
    tip = bone_point('Mouth', tail=True)
    fwd = (tip - mouth).normalized()
    hit = mouth + fwd * ((mouth.z - 0.2) / max(0.2, -fwd.z)) if fwd.z < -0.05 else mouth + fwd * 22
    core, outer, along = [], [], []
    for _ in range(900):
        t = rng.random() ** 0.7
        spread = 0.12 + 0.5 * t
        d = (fwd + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.6))) * spread).normalized()
        p = mouth + d * (t * 24.0)
        if p.z < 0.3:                   # the fire hits the ice and rolls along it
            p.z = 0.3 + rng.uniform(0, 1.4)
        (core if rng.random() < 0.35 and t < 0.7 else outer).append(p)
        along.append(d)
    blobs('breath_core', core, GOLD, r=(0.25, 0.6), stretch=(1.5, 3.5), along=fwd)
    blobs('breath_outer', outer, GREEN, r=(0.3, 0.9), stretch=(1.2, 3.0), along=fwd)
    for k in range(7):
        c = mouth.lerp(hit, 0.25 + 0.12 * k)
        cloud(f'breath_cloud{k}', (c.x, c.y, max(1.2, c.z)), 1.6 + 0.8 * k, 1.2 + 0.4 * k, density=0.25,
              color=(0.3, 0.9, 0.5), emit=1.2, ecolor=(0.35, 1.0, 0.55))
    light(mouth + fwd * 6, 8000, (0.5, 1.0, 0.6), 6.0)
    light(hit + Vector((0, 0, 2)), 12000, (1.0, 0.75, 0.4), 8.0)
    crack_web((hit.x, hit.y), 9.0, n=16, seed=3)
    kn = stage.place_knight(knight, (hit.x + 5.0, hit.y + 3.0, 0.0)) if knight else []
    shoot('vfx_aliento_mortal', 62, 14, 62.0, (mouth.x * 0.5 + hit.x * 0.5, mouth.y * 0.5 + hit.y * 0.5, 7.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'shard' in ONLY:
    act_time('Idle', 1.0)
    c = bone_point('Shard')
    fwd = (bone_point('Shard', tail=True) - c).normalized()
    light(c + fwd * 1.6, 9000, (1.0, 0.7, 0.45), 1.0)
    light(c + fwd * 0.6 + Vector((0, 0, -1.0)), 3000, (0.35, 0.9, 0.75), 0.6)
    halo = []
    for _ in range(140):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        halo.append(c + fwd * 0.8 + d * rng.uniform(0.6, 3.2))
    blobs('motes', halo, ROSE, r=(0.03, 0.08), stretch=(1.0, 2.0))
    cloud('halo', c + fwd * 1.2, 2.4, 2.4, density=0.05, color=(1.0, 0.8, 0.6), emit=1.6, ecolor=(1.0, 0.7, 0.45))
    for o in scene.objects:
        if o.type == 'LIGHT' and not o.name.startswith('fxl'):
            o.data.energy *= 0.45
    shoot('vfx_esquirla_pecho', 24, 2, 22.0, (c.x, c.y - 1.0, c.z + 1.4), 40)
    for o in scene.objects:
        if o.type == 'LIGHT' and not o.name.startswith('fxl'):
            o.data.energy /= 0.45
    clear_fx()

if 'shatter' in ONLY:
    act_time('BreakFree', 1.55)
    chest = bone_point('Chest')
    pts, dirs = [], []
    for _ in range(520):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-0.6, 0.8), rng.uniform(0.0, 1.2))).normalized()
        p = chest + Vector((rng.uniform(-4, 4), rng.uniform(-7, 9), rng.uniform(-2, 3))) + d * rng.uniform(1.0, 11.0)
        pts.append(p)
        dirs.append(d)
    blobs('splinters', pts, ICE_CHUNK, r=(0.08, 0.45), stretch=(1.5, 4.0), along=dirs, sub=0)
    for k in range(6):
        c = chest + Vector((rng.uniform(-5, 5), rng.uniform(-8, 8), rng.uniform(-1, 3)))
        cloud(f'frost{k}', c, 4.5, 3.0, density=0.35, color=(0.9, 0.95, 1.0))
    falling = [Vector((rng.uniform(-14, 14), rng.uniform(-16, 18), 0.1)) for _ in range(160)]
    blobs('chips', falling, ICE_CHUNK, r=(0.15, 0.5), stretch=(0.3, 0.8), sub=0)
    light(bone_point('Shard') + Vector((0, -2, 0)), 20000, (1.0, 0.75, 0.5), 2.0)
    kn = stage.place_knight(knight, (9.0, -16.0, 0.0)) if knight else []
    shoot('vfx_hielo_estalla', 38, 10, 70.0, (0.0, 0.0, 10.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'land' in ONLY:
    act_time('Land', 1.22)
    c = (bone_point('L_FToes') + bone_point('R_FToes') + bone_point('L_HToes') + bone_point('R_HToes')) / 4
    crack_web((c.x, c.y), 12.0, n=20, seed=9, width=0.14)
    chunks = []
    for _ in range(140):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(3, 13)
        chunks.append(Vector((c.x + math.cos(a) * rr, c.y + math.sin(a) * rr, rng.uniform(0.2, 4.0) * (1.2 - rr / 14))))
    blobs('chunks', chunks, ICE_CHUNK, r=(0.25, 0.8), stretch=(0.5, 1.2), sub=0)
    for k in range(14):
        a = math.tau * k / 14
        cloud(f'dust{k}', (c.x + math.cos(a) * 11, c.y + math.sin(a) * 11, 1.2), 3.2, 1.6, density=0.6,
              color=(0.92, 0.96, 1.0))
    light((c.x, c.y, 1.0), 8000, (1.0, 0.6, 0.3), 10.0)
    kn = stage.place_knight(knight, (c.x + 13.0, c.y - 8.0, 0.0)) if knight else []
    shoot('vfx_aterrizaje_grietas', 40, 22, 72.0, (c.x, c.y, 4.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)

if 'inferno' in ONLY:
    act_time('GraveInferno', 8.0)
    c = bone_point('Chest')
    cen = Vector((c.x, c.y + 2.0, 0.0))
    flames, dirs = [], []
    for _ in range(1400):
        a = rng.uniform(0, math.tau)
        rr = 14.0 * math.sqrt(rng.uniform(0.15, 1.0))
        h = rng.random() ** 2 * (7.0 if rr > 11 else 3.5)
        flames.append(Vector((cen.x + math.cos(a) * rr, cen.y + math.sin(a) * rr, 0.3 + h)))
        dirs.append(Vector((0, 0, 1)))
    blobs('inferno_green', flames[:950], GREEN, r=(0.3, 0.8), stretch=(1.8, 4.0), along=dirs[:950])
    blobs('inferno_gold', flames[950:], GOLD, r=(0.25, 0.6), stretch=(1.8, 4.0), along=dirs[950:])
    ring = [Vector((cen.x + math.cos(math.tau * i / 96) * 14.0, cen.y + math.sin(math.tau * i / 96) * 14.0, 0.05))
            for i in range(97)]
    tube('inferno_ring', ring, 0.35, GOLD, sides=8)
    for k in range(10):
        a = math.tau * k / 10
        cloud(f'inf{k}', (cen.x + math.cos(a) * 12, cen.y + math.sin(a) * 12, 3.5), 4.0, 3.6, density=0.22,
              color=(0.3, 0.9, 0.5), emit=1.0, ecolor=(0.35, 1.0, 0.55))
    embers = [Vector((cen.x + rng.uniform(-16, 16), cen.y + rng.uniform(-16, 16), rng.uniform(1, 22))) for _ in range(300)]
    blobs('embers', embers, ROSE, r=(0.04, 0.1), stretch=(1.0, 3.0))
    crack_web((cen.x, cen.y), 9.0, n=18, seed=21)
    light(bone_point('Shard') + Vector((0, -2, 0)), 12000, (1.0, 0.7, 0.45), 3.0)
    light((cen.x, cen.y, 4.0), 20000, (0.4, 1.0, 0.55), 14.0)
    kn = stage.place_knight(knight, (cen.x + 16.5, cen.y - 6.0, 0.0)) if knight else []
    shoot('vfx_infierno_sepulcral', 36, 18, 86.0, (cen.x, cen.y, 8.0), 35)
    clear_fx()
    for o in kn:
        bpy.data.objects.remove(o, do_unlink=True)
print('VFX_DONE')
