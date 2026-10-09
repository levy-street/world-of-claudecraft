"""Reference renders of the Snarlvine Lasher's and the Thorn Sprout's effects,
staged on their real clips (authoring aid; nothing here ships). LOOK targets for
the game's effect layer, anchored on the clips' contract frames:

  lash    LashCast at 1.52 s (the whip has just slammed the lane): the whip
          lies along the lane; from its tip a thorned tendril of glowing vine
          runs on along the ground to the end of the 20 yd x 2 yd lane, the soil
          cracks open along it, leaves and dirt burst where the whip landed, sap
          droplets splash.
  roots   Entangling Lash's root (2 s): the rooted player on the lane, glowing
          thorned vines spiralling up his legs out of a cracked ring of soil.
  pod     (Sprout .blend) Emerge at 0.40 s: the red seed pod split open, its
          shell shards flung out, a spray of loam and a puff of spores, the
          Sprout bursting up out of it.

  blender -b <lasher|sprout>.blend --python vfx_reference.py -- <out_dir> [--samples 64] [--knight k.glb]
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


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.endswith('Rig'))
SPROUT = arm.name.startswith('ThornSprout')
for o in scene.objects:
    if o.name.endswith('_hi') or '_hi.' in o.name:
        o.hide_render = True
cam = stage.setup(engine='CYCLES', res=(1600, 900), sky=(0.26, 0.3, 0.26), ground=False)
scene.cycles.samples = int(opt('--samples', 64))
for o in [o for o in scene.objects if o.name.startswith('PlayerReference')]:
    bpy.data.objects.remove(o, do_unlink=True)
rng = random.Random(7)
SAPC = (0.62, 1.0, 0.16)


def mat(name, color, rough=0.5, emission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emission
    b.inputs['Alpha'].default_value = alpha
    return m


LOAM = mat('fx_loam', (0.17, 0.12, 0.07), rough=0.95)
DIRT = mat('fx_dirt', (0.22, 0.15, 0.08), rough=0.95)
VINE = mat('fx_vine', (0.12, 0.2, 0.05), rough=0.6)
SAP = mat('fx_sap', SAPC, rough=0.2, emission=9.0)
SAP_SOFT = mat('fx_sap_soft', SAPC, rough=0.3, emission=2.5, alpha=0.45)
LEAF = mat('fx_leaf', (0.14, 0.28, 0.05), rough=0.6)
THORN = mat('fx_thorn', (0.3, 0.12, 0.06), rough=0.4)
CRACK = mat('fx_crack', (0.02, 0.015, 0.01), rough=1.0)
POD = mat('fx_pod', (0.55, 0.05, 0.04), rough=0.35)
POD_IN = mat('fx_pod_in', (0.85, 0.75, 0.45), rough=0.5)
SPORE = mat('fx_spore', (0.75, 0.85, 0.3), rough=1.0, emission=0.6, alpha=0.35)


def link(o, m):
    o.data.materials.append(m)
    scene.collection.objects.link(o)
    return o


def plane(name, z, m, size=200):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    return link(bpy.data.objects.new(name, me), m)


def tube(name, pts, radii, m, sides=8):
    import bmesh
    from mesh_kit import Part
    p = Part(name, 'x')
    p.tube(pts, radii, sides=sides)
    o = p.to_object()
    o.data.materials.append(m)
    return o


def blob(name, c, r, m, squash=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=c)
    o = bpy.context.active_object
    o.name = name
    o.scale = squash
    o.data.materials.append(m)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f = act.frame_range[0] + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def thorned_tendril(name, pts, r0, glow=True):
    rad = [r0 * (1 - 0.6 * i / (len(pts) - 1)) + 0.02 for i in range(len(pts))]
    tube(name, pts, rad, VINE, sides=9)
    if glow:
        tube(name + '_sap', [Vector(p) + Vector((0, 0, r0 * 0.6)) for p in pts], [r * 0.28 for r in rad], SAP, sides=6)
    for i in range(1, len(pts) - 1):
        for _ in range(2):
            a = rng.uniform(0, math.tau)
            base = Vector(pts[i]) + Vector((math.cos(a) * rad[i], 0, math.sin(a) * rad[i] + rad[i] * 0.3))
            out = Vector((math.cos(a), rng.uniform(-0.3, 0.3), abs(math.sin(a)) + 0.3)).normalized()
            tube(name + f'_t{i}', [base, base + out * rad[i] * 1.6], [rad[i] * 0.35, 0.004], THORN, sides=5)


def knight(at):
    k = opt('--knight')
    if not k:
        return
    stage.place_knight(k, at, 2.6)


def lash_scene():
    plane('loam', 0.0, LOAM)
    act_time('LashCast', 1.52)
    bpy.context.view_layer.update()
    tip = arm.matrix_world @ arm.pose.bones['R_Vine7'].tail
    x0 = tip.x
    # the tendril runs on from the whip tip to the end of the 20 yd lane, weaving
    pts = []
    for i in range(26):
        y = tip.y + (-20.0 - tip.y) * i / 25
        pts.append(Vector((x0 * (1 - i / 25) + 0.35 * math.sin(i * 0.9), y, 0.1 + 0.06 * math.sin(i * 1.7))))
    thorned_tendril('lane_tendril', pts, 0.16)
    for k in range(2):     # two thinner runners braided round it
        side = [p + Vector((0.3 * math.sin(i * 0.8 + k * 3.1), 0, 0.08 + 0.06 * math.cos(i * 0.8 + k * 3.1)))
                for i, p in enumerate(pts)]
        thorned_tendril(f'runner{k}', side, 0.07, glow=False)
    # cracked soil along the lane, glowing sap seeping in the cracks
    for i in range(70):
        y = rng.uniform(tip.y + 1, -20.5)
        x = rng.uniform(-1.0, 1.0)
        L = rng.uniform(0.4, 1.4)
        a = rng.uniform(-0.8, 0.8)
        p0 = Vector((x, y, 0.012))
        p1 = p0 + Vector((math.sin(a) * L, math.cos(a) * L * 0.5, 0))
        tube(f'crack{i}', [p0, p1], [0.05, 0.01], CRACK if i % 3 else SAP, sides=4)
    # the impact where the whip landed: a burst of loam, leaves and sap
    for i in range(70):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.3, 2.4)
        h = rng.uniform(0.1, 1.9) * (1.2 - d / 2.6)
        blob(f'dirt{i}', (tip.x + math.cos(a) * d, tip.y + math.sin(a) * d * 0.7, max(0.05, h)), rng.uniform(0.04, 0.13),
             DIRT)
    for i in range(36):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.2, 2.8)
        c = (tip.x + math.cos(a) * d, tip.y + math.sin(a) * d, rng.uniform(0.2, 2.4))
        blob(f'leaf{i}', c, 0.12, LEAF, squash=(1.0, 0.45, 0.08))
        bpy.context.active_object.rotation_euler = (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3))
    for i in range(28):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.2, 1.6)
        blob(f'sap{i}', (tip.x + math.cos(a) * d, tip.y + math.sin(a) * d, rng.uniform(0.2, 1.4)),
             rng.uniform(0.03, 0.07), SAP)
    blob('scorch', (tip.x, tip.y, 0.0), 1.4, CRACK, squash=(1.2, 1.2, 0.03))
    blob('sapring', (tip.x, tip.y, 0.0), 1.0, SAP, squash=(1.0, 1.0, 0.012))
    # the lane's edges (2 yd wide) marked by thorn shoots breaking the soil
    for i in range(24):
        y = tip.y - 1 - i * (19.0 + tip.y) / 24
        for sx in (-1, 1):
            base = Vector((sx * rng.uniform(0.85, 1.05), y + rng.uniform(-0.3, 0.3), 0.0))
            tube(f'shoot{i}{sx}', [base, base + Vector((sx * 0.1, 0, rng.uniform(0.3, 0.6)))], [0.06, 0.004], THORN,
                 sides=5)
    return tip


def roots_on(at):
    """Glowing thorned vines spiralling up the rooted player's legs."""
    c = Vector(at)
    for k in range(4):
        pts = []
        for i in range(22):
            t = i / 21
            a = k * math.pi / 2 + t * 4.2
            r = 0.55 - 0.18 * t
            pts.append(c + Vector((math.cos(a) * r, math.sin(a) * r, t * 1.5)))
        thorned_tendril(f'root{k}', pts, 0.075)
    for i in range(16):
        a = math.tau * i / 16
        p0 = c + Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 0.01))
        tube(f'ring{i}', [p0, c + Vector((math.cos(a + 0.4) * 1.3, math.sin(a + 0.4) * 1.3, 0.01))], [0.05, 0.012],
             SAP if i % 2 else CRACK, sides=4)
    blob('glow', c + Vector((0, 0, 0.0)), 1.15, SAP_SOFT, squash=(1, 1, 0.02))


def render(name, az, el, dist, focus, lens=40):
    stage.aim(cam, az, el, dist, focus, lens)
    path = os.path.join(OUT, name)
    stage.still(path)
    print('VFX', path)


os.makedirs(OUT, exist_ok=True)
if not SPROUT:
    tip = lash_scene()
    knight((0.0, -15.0, 0.0))
    roots_on((0.0, -15.0, 0.0))
    render('vfx_latigazo_carril_y_raices.png', -38, 16, 19.0, (0.0, -9.0, 1.2), 32)
    render('vfx_latigazo_impacto.png', -62, 12, 9.0, (tip.x, tip.y, 0.9), 40)
    render('vfx_raices_jugador.png', -30, 10, 5.5, (0.0, -15.0, 1.2), 45)
else:
    plane('loam', 0.0, LOAM)
    act_time('Emerge', 0.4)
    c = Vector((0, 0, 0))
    # the split pod: shell shards flung outward, the pale pith inside
    for i in range(9):
        a = math.tau * i / 9 + rng.uniform(-0.2, 0.2)
        d = rng.uniform(0.5, 1.2)
        o = blob(f'shell{i}', (math.cos(a) * d, math.sin(a) * d, rng.uniform(0.1, 0.9)), 0.32, POD,
                 squash=(1.0, 0.6, 0.18))
        o.rotation_euler = (rng.uniform(-1, 1), rng.uniform(-1, 1), a)
        blob(f'pith{i}', o.location + Vector((0, 0, 0.04)), 0.22, POD_IN, squash=(1.0, 0.55, 0.1))
    for i in range(80):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.2, 1.9)
        blob(f'loam{i}', (math.cos(a) * d, math.sin(a) * d, rng.uniform(0.05, 1.8) * (1.3 - d / 2.2)),
             rng.uniform(0.03, 0.09), DIRT)
    for i in range(40):
        blob(f'spore{i}', (rng.uniform(-1.2, 1.2), rng.uniform(-1.2, 1.2), rng.uniform(0.3, 2.2)), rng.uniform(0.02, 0.05),
             SAP)
    for i in range(14):
        a = rng.uniform(0, math.tau)
        base = Vector((math.cos(a) * 0.4, math.sin(a) * 0.4, 0))
        tube(f'burstthorn{i}', [base, base + Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, rng.uniform(0.4, 0.9)))],
             [0.05, 0.004], THORN, sides=5)
    blob('crater', (0, 0, 0.0), 1.1, CRACK, squash=(1, 1, 0.05))
    knight((2.2, -0.6, 0.0))
    render('vfx_brote_revienta_la_vaina.png', -35, 12, 6.5, (0.0, -0.3, 1.0), 40)
print('VFX_DONE')
