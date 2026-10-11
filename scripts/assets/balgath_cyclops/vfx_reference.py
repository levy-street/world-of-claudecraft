"""Reference renders of Balgath's effects, staged on his real clips (authoring aid).

  blender -b balgath.blend --python vfx_reference.py -- <out_dir> [--boulder boulder.glb] [--only a,b]
         [--frames N]   (with N > 1, also renders N frames around each beat for a short video)

These are LOOK targets for the game's effect layer (balgath_fx.ts and friends), not
shipping assets: the eye flare, the eye beam, the stomp's dust ring and debris,
the smash's shockwaves and cracked ground, the boulder's trail, the death dust, and
the starwake fissures. Each effect is anchored to the bone it comes from (the eye
core, a fist, a heel) at the clip's contract frame, so the timing and placement
shown here are the ones the game will read.
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


TEAL = (0.37, 0.91, 0.82)
TEAL_HOT = (0.85, 1.0, 0.97)
DUST = (0.36, 0.31, 0.25)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Balgath'))
for o in scene.objects:
    if '_hi' in o.name:
        o.hide_render = True
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.11, 0.13, 0.16), exposure=-0.3)
scene.cycles.samples = int(opt('--samples', 96))
scene.cycles.volume_step_rate = 2.0
# a dusk fen: dim cool sky, a low warm key
for o in scene.objects:
    if o.type == 'LIGHT':
        if o.name == 'key':
            o.data.energy = 2.6
            o.data.color = (1.0, 0.78, 0.55)
            o.rotation_euler = (math.radians(68), 0, math.radians(140))
        elif o.name == 'fill':
            o.data.energy = 0.6
FX = []


def track(o):
    FX.append(o)
    return o


def clear_fx():
    for o in FX:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    FX.clear()


def compositor_glare():
    """Bloom and star streaks on the emissive parts (Blender 5 compositor group)."""
    ng = bpy.data.node_groups.new('VfxComp', 'CompositorNodeTree')
    rl = ng.nodes.new('CompositorNodeRLayers')
    g1 = ng.nodes.new('CompositorNodeGlare')
    g2 = ng.nodes.new('CompositorNodeGlare')
    for g, kind in ((g1, 'FOG_GLOW'), (g2, 'STREAKS')):
        try:
            g.glare_type = kind
        except Exception:  # noqa: BLE001
            g.inputs['Type'].default_value = kind.replace('_', ' ').title()
        for name, val in (('Threshold', 1.0 if kind == 'FOG_GLOW' else 2.5), ('Size', 0.6), ('Strength', 0.9),
                          ('Streaks', 6), ('Fade', 0.88)):
            if name in g.inputs:
                try:
                    g.inputs[name].default_value = val
                except Exception:  # noqa: BLE001
                    pass
    out = ng.nodes.new('NodeGroupOutput')
    ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    ng.links.new(rl.outputs['Image'], g1.inputs['Image'])
    ng.links.new(g1.outputs['Image'], g2.inputs['Image'])
    ng.links.new(g2.outputs['Image'], out.inputs[0])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True


try:
    compositor_glare()
except Exception as e:  # noqa: BLE001
    print('GLARE_SKIPPED', e)


# ------------------------------------------------------------------ materials
def emit_mat(name, color, strength, soft=True, alpha=1.0):
    """Emission that fades at grazing angles (soft) and with vertex alpha."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    fac = None
    if soft:
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.5
        inv = nt.nodes.new('ShaderNodeMath')
        inv.operation = 'SUBTRACT'
        inv.inputs[0].default_value = 1.0
        nt.links.new(lw.outputs['Facing'], inv.inputs[1])
        pw = nt.nodes.new('ShaderNodeMath')
        pw.operation = 'POWER'
        pw.inputs[1].default_value = 2.5
        nt.links.new(inv.outputs[0], pw.inputs[0])
        fac = pw.outputs[0]
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Alpha'
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = alpha
    if fac is not None:
        m2 = nt.nodes.new('ShaderNodeMath')
        m2.operation = 'MULTIPLY'
        nt.links.new(fac, m2.inputs[0])
        nt.links.new(attr.outputs['Fac'], m2.inputs[1])
        nt.links.new(m2.outputs[0], mul.inputs[0])
    else:
        nt.links.new(attr.outputs['Fac'], mul.inputs[0])
    nt.links.new(mul.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def dust_mat(name, color=DUST, density=1.2, scale=1.4):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*color, 1)
    vol.inputs['Anisotropy'].default_value = 0.2
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    # radial falloff inside the unit domain
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')
    fall.inputs[1].default_value = 1.0
    fall.inputs[2].default_value = 0.35
    nt.links.new(ln.outputs['Value'], fall.inputs[0])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs[1].default_value = 0.42
    ramp.inputs[2].default_value = 0.7
    nt.links.new(nz.outputs['Fac'], ramp.inputs[0])
    m1 = nt.nodes.new('ShaderNodeMath')
    m1.operation = 'MULTIPLY'
    nt.links.new(fall.outputs[0], m1.inputs[0])
    nt.links.new(ramp.outputs[0], m1.inputs[1])
    m2 = nt.nodes.new('ShaderNodeMath')
    m2.operation = 'MULTIPLY'
    m2.inputs[1].default_value = density * 3.5
    nt.links.new(m1.outputs[0], m2.inputs[0])
    nt.links.new(m2.outputs[0], vol.inputs['Density'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    return m


def rock_mat():
    m = bpy.data.materials.new('fx_rock')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.22, 0.2, 0.17, 1)
    b.inputs['Roughness'].default_value = 0.9
    return m


ROCK = rock_mat()


# ------------------------------------------------------------------ primitives
def ring(c, r_in, r_out, mat, segs=96, z=0.04, alpha_in=0.0, alpha_peak=1.0):
    me = bpy.data.meshes.new('ring')
    verts, faces = [], []
    rows = 6
    for i in range(rows + 1):
        r = r_in + (r_out - r_in) * i / rows
        for k in range(segs):
            a = math.tau * k / segs
            verts.append((c[0] + math.cos(a) * r, c[1] + math.sin(a) * r, z))
    for i in range(rows):
        for k in range(segs):
            a, b = i * segs + k, i * segs + (k + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    me.from_pydata(verts, [], faces)
    al = me.attributes.new('Alpha', 'FLOAT', 'POINT')
    for i in range(rows + 1):
        u = i / rows
        val = alpha_peak * (u ** 3) * (1.0 if u < 1 else 0.0) if u > 0 else alpha_in
        for k in range(segs):
            al.data[i * segs + k].value = val
    o = bpy.data.objects.new('fx_ring', me)
    me.materials.append(mat)
    scene.collection.objects.link(o)
    return track(o)


def blob(c, size, mat, name='fx_blob', alpha=1.0, seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1.0, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    al = o.data.attributes.new('Alpha', 'FLOAT', 'POINT')
    for d in al.data:
        d.value = alpha
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return track(o)


def glow_disc(c, radius, color, strength, name='fx_glow', falloff=2.2):
    """A camera-facing disc with a soft radial falloff: the bloom core of a flare."""
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.0, fill_type='TRIFAN', location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = (radius, radius, radius)
    m = bpy.data.materials.new(name + '_mat')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    inv.use_clamp = True
    nt.links.new(ln.outputs['Value'], inv.inputs[1])
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = falloff
    nt.links.new(inv.outputs[0], pw.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(pw.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    o.data.materials.append(m)
    con = o.constraints.new('TRACK_TO')
    con.target = cam
    con.track_axis = 'TRACK_Z'
    con.up_axis = 'UP_Y'
    return track(o)


def dust_cloud(c, size, density=1.0, color=DUST, seed=1, scale=1.4):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1.0, location=c)
    o = bpy.context.active_object
    o.name = 'fx_dust'
    o.scale = size
    o.rotation_euler = (0, 0, seed)
    o.data.materials.append(dust_mat(f'dust{seed}', color, density, scale))
    return track(o)


def chunks(c, n, radius, height, size=(0.15, 0.45), seed=1, spread_up=1.0):
    rnd = random.Random(seed)
    for i in range(n):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.3, 1.0) * radius
        h = rnd.uniform(0.2, 1.0) * height * spread_up
        s = rnd.uniform(*size)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=s, location=(c[0] + math.cos(a) * r,
                                                                               c[1] + math.sin(a) * r, c[2] + h))
        o = bpy.context.active_object
        o.name = 'fx_chunk'
        o.scale = (rnd.uniform(0.6, 1.3), rnd.uniform(0.6, 1.3), rnd.uniform(0.5, 1.0))
        o.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
        o.data.materials.append(ROCK)
        track(o)


def cracks(c, radius, color, strength, seed=1, width=0.12, n=9):
    rnd = random.Random(seed)
    mat = emit_mat(f'crack{seed}', color, strength, soft=False)
    for i in range(n):
        a = math.tau * i / n + rnd.uniform(-0.25, 0.25)
        pts = [Vector((c[0], c[1], 0.03))]
        p = Vector((c[0], c[1], 0.03))
        ln = radius * rnd.uniform(0.6, 1.0)
        steps = 8
        for k in range(steps):
            a += rnd.uniform(-0.35, 0.35)
            p = p + Vector((math.cos(a), math.sin(a), 0)) * ln / steps
            pts.append(p.copy())
        me = bpy.data.meshes.new('crack')
        verts, faces = [], []
        for k, q in enumerate(pts):
            t = k / steps
            w = width * (1 - t) + 0.02
            d = (pts[min(k + 1, steps)] - pts[max(k - 1, 0)]).normalized()
            side = Vector((-d.y, d.x, 0)) * w
            verts += [tuple(q + side), tuple(q - side)]
        for k in range(steps):
            faces.append((2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2))
        me.from_pydata(verts, [], faces)
        al = me.attributes.new('Alpha', 'FLOAT', 'POINT')
        for k in range(len(verts)):
            al.data[k].value = 1.0 - (k // 2) / (steps + 1) * 0.7
        o = bpy.data.objects.new('fx_crack', me)
        me.materials.append(mat)
        scene.collection.objects.link(o)
        track(o)


def beam(a, b, radius, mat_core, mat_glow):
    a, b = Vector(a), Vector(b)
    d = b - a
    for r, m in ((radius, mat_glow), (radius * 0.32, mat_core)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=d.length, location=(a + b) / 2)
        o = bpy.context.active_object
        o.name = 'fx_beam'
        o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        al = o.data.attributes.new('Alpha', 'FLOAT', 'POINT')
        for v, dd in zip(o.data.vertices, al.data):
            dd.value = 1.0
        o.data.materials.append(m)
        for p in o.data.polygons:
            p.use_smooth = True
        track(o)


# ------------------------------------------------------------------ anchors
def at(clip, t):
    act = bpy.data.actions[clip]
    R.set_action(arm, act)
    f = act.frame_range[0] + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    bpy.context.view_layer.update()


def bone_pt(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def eye_pt():
    pb = arm.pose.bones['EyeCore']
    return arm.matrix_world @ pb.head, (arm.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()


def shoot(name, az, el, dist, focus, lens=40):
    stage.aim(cam, az, el, dist, focus, lens)
    stage.still(os.path.join(OUT, f'vfx_{name}.png'))


# ------------------------------------------------------------------ the effects
def fx_eye_flare(k=1.0):
    e, fwd = eye_pt()
    glow_disc(e + fwd * 0.9, 3.2 * k, TEAL, 3.0 * k, 'fx_halo', falloff=3.0)
    glow_disc(e + fwd * 1.0, 1.1 * k, TEAL_HOT, 14.0 * k, 'fx_core', falloff=2.0)
    for i in range(10):
        a = math.tau * i / 10
        p = e + fwd * 0.4 + Vector((math.cos(a), 0, math.sin(a))) * (1.1 + 0.4 * (i % 3)) * k
        blob(p, (0.05, 0.05, 0.05), emit_mat(f'mote{i}', TEAL, 25.0), 'fx_mote')
    return e


def fx_eye_beam(length=42.0):
    e, fwd = eye_pt()
    end = e + fwd * length
    end.z = 0.2
    fx_eye_flare(1.1)
    beam(e + fwd * 0.4, end, 1.25, emit_mat('beam_core', TEAL_HOT, 45.0), emit_mat('beam_glow', TEAL, 7.0))
    ring((end.x, end.y), 0.4, 4.5, emit_mat('beam_hit', TEAL, 9.0, soft=False))
    dust_cloud((end.x, end.y, 1.2), (4.0, 4.0, 2.0), density=0.8, color=(0.3, 0.42, 0.4), seed=3)
    # the scorched line the glare leaves on the ground
    start = Vector((e.x, e.y, 0)) + fwd * 4
    me = bpy.data.meshes.new('scorch')
    d = (Vector((end.x, end.y, 0)) - Vector((start.x, start.y, 0)))
    side = Vector((-d.y, d.x, 0)).normalized() * 2.5
    v = [tuple(Vector((start.x, start.y, 0.03)) + side), tuple(Vector((start.x, start.y, 0.03)) - side),
         tuple(Vector((end.x, end.y, 0.03)) - side), tuple(Vector((end.x, end.y, 0.03)) + side)]
    me.from_pydata(v, [], [(0, 1, 2, 3)])
    al = me.attributes.new('Alpha', 'FLOAT', 'POINT')
    for i, dd in enumerate(al.data):
        dd.value = 0.15 if i < 2 else 0.45
    o = bpy.data.objects.new('fx_scorch', me)
    me.materials.append(emit_mat('scorch', (0.2, 0.7, 0.62), 1.2, soft=False))
    scene.collection.objects.link(o)
    track(o)
    return e, end


def fx_impact(c, scale=1.0, seed=1, teal=False):
    col = TEAL if teal else (1.0, 0.86, 0.66)
    ring((c[0], c[1]), 3.0 * scale, 6.2 * scale, emit_mat(f'shock{seed}', col, 6.0, soft=False))
    ring((c[0], c[1]), 7.0 * scale, 9.6 * scale, emit_mat(f'shock2{seed}', col, 3.0, soft=False), alpha_peak=0.6)
    dust_cloud((c[0], c[1], 1.6 * scale), (6.0 * scale, 6.0 * scale, 3.0 * scale), density=2.6, seed=seed)
    dust_cloud((c[0], c[1], 0.8 * scale), (9.0 * scale, 9.0 * scale, 1.2 * scale), density=0.6, seed=seed + 7,
               scale=2.2)
    chunks((c[0], c[1], 0.3), int(26 * scale), 4.5 * scale, 4.5 * scale, seed=seed)


SCENES = {}


def scene_def(fn):
    SCENES[fn.__name__] = fn
    return fn


@scene_def
def eye_flare():
    at('Balgath_Wake', 2.3)
    e = fx_eye_flare(0.55)
    shoot('eye_flare_close', 20, 4, 9, (e.x, e.y - 0.5, e.z - 0.4), 50)
    clear_fx()
    at('Balgath_EyeFlare', 1.3)
    e = fx_eye_flare(1.25)
    shoot('eye_flare_peak', 35, 6, 26, (0.5, -2.5, 7.0), 40)
    clear_fx()


@scene_def
def eye_beam():
    at('Balgath_EyeFlare', 1.3)
    e, end = fx_eye_beam()
    shoot('eye_beam', 62, 10, 46, ((e.x + end.x) / 2, (e.y + end.y) / 2, 5.0), 32)
    shoot('eye_beam_front', 18, 14, 34, (e.x, e.y - 8, 4.0), 30)
    clear_fx()


@scene_def
def stomp():
    at('Balgath_Stomp', 0.76)
    heel = bone_pt('R_Foot')
    fx_impact(heel, 1.0, seed=11)
    shoot('stomp_dust', 30, 10, 38, (heel.x + 1.0, heel.y, 4.5), 38)
    clear_fx()


@scene_def
def smash():
    at('Balgath_Smash', 1.24)
    l, r = bone_pt('L_Hand', True), bone_pt('R_Hand', True)
    c = (l + r) / 2
    fx_impact(c, 1.25, seed=21)
    cracks(c, 9.0, (0.95, 0.55, 0.25), 6.0, seed=21)
    shoot('smash_shockwave', 28, 12, 44, (c.x, c.y + 1.5, 4.0), 36)
    clear_fx()


@scene_def
def boulder():
    path = opt('--boulder')
    at('Balgath_Toss', 1.45)
    start = (bone_pt('L_Hand', True) + bone_pt('R_Hand', True)) / 2 + Vector((0, -1.4, 0.6))
    at('Balgath_Toss', 1.62)
    land = Vector((2.0, -34.0, 0.0))
    pts = []
    for i in range(9):
        t = i / 8
        p = start.lerp(land, t)
        p.z = start.z * (1 - t) + 7.0 * math.sin(math.pi * t) + land.z * t
        pts.append(p)
    head = pts[3]
    rock = None
    if path and os.path.exists(path):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        rock = next((o for o in new if o.name.startswith('boulder')), None)
        for o in new:
            if o is not rock:
                bpy.data.objects.remove(o, do_unlink=True)
    if rock is None:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
        rock = bpy.context.active_object
        rock.data.materials.append(ROCK)
    rock.location = head
    rock.scale = (1.4, 1.4, 1.4)
    track(rock)
    for i, p in enumerate(pts[:3]):
        k = (i + 1) / 4
        dust_cloud(p, (1.4 + k, 1.4 + k, 1.2 + k), density=0.5 + 0.4 * k, seed=40 + i)
        chunks(p, 4, 1.2, 0.6, size=(0.08, 0.2), seed=60 + i, spread_up=0.5)
    ring((land.x, land.y), 0.4, 3.4, emit_mat('toss_mark', (1.0, 0.45, 0.2), 2.5, soft=False))
    shoot('boulder_trail', 78, 8, 40, (1.0, -12.0, 9.0), 30)
    clear_fx()


@scene_def
def death_dust():
    at('Balgath_Death', 1.95)
    hips = bone_pt('Hips')
    chest = bone_pt('Spine2')
    c = (hips + chest) / 2
    dust_cloud((c.x, c.y, 2.2), (10.0, 9.0, 4.0), density=2.0, color=(0.46, 0.4, 0.32), seed=81)
    dust_cloud((c.x, c.y, 1.0), (15.0, 13.0, 1.8), density=1.6, seed=82, scale=2.4)
    dust_cloud((c.x - 3.0, c.y + 2.0, 4.0), (5.0, 5.0, 4.0), density=2.0, seed=83)
    chunks((c.x, c.y, 0.3), 30, 7.0, 3.5, seed=81)
    ring((c.x, c.y), 4.0, 11.5, emit_mat('death_ring', (0.9, 0.82, 0.68), 0.9, soft=False), alpha_peak=0.6)
    e, fwd = eye_pt()
    blob(e + fwd * 0.2, (0.25, 0.25, 0.25), emit_mat('ember', TEAL, 3.0), 'fx_ember')
    shoot('death_dust', 50, 14, 44, (c.x, c.y - 1.0, 2.5), 34)
    clear_fx()


@scene_def
def starwake():
    at('Balgath_Starwake', 1.47)
    l, r = bone_pt('L_Hand', True), bone_pt('R_Hand', True)
    c = (l + r) / 2
    cracks(c, 14.0, TEAL, 18.0, seed=91, width=0.22, n=11)
    ring((c.x, c.y), 0.5, 6.5, emit_mat('star_ring', TEAL, 5.0, soft=False))
    dust_cloud((c.x, c.y, 1.2), (5.0, 5.0, 2.0), density=0.9, color=(0.3, 0.38, 0.36), seed=93)
    fx_eye_flare(1.0)
    shoot('starwake', 30, 16, 40, (c.x, c.y + 2.0, 4.0), 34)
    clear_fx()


only = opt('--only')
for name, fn in SCENES.items():
    if only and name not in only.split(','):
        continue
    fn()
    print('VFX', name)
print('VFX_DONE')
