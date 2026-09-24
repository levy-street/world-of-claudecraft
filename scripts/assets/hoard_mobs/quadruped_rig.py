"""A four-legged hoard mob: a rig and a clip set of its own, authored in Blender.

The generic twin of scripts/assets/hoard_bosses/maw_rig.py. Tripo's quadruped
auto-rig ships one walk preset and folds odd bodies, so a generated creature (raw,
textured, up +Z, turned to face +X by the spec's "rotateZ" when it does not) is
rigged here from a small JSON spec instead:

  * the spec places the skeleton by hand: Hips, Spine, Chest, Head, optional Jaw,
    Tail1..3, Lure1..2, and four three-bone legs (ForeUpper/ForeLower/ForeFoot,
    HindThigh/HindShin/HindFoot, .L and .R). A bone the spec leaves out is simply
    never posed;
  * weights by distance to each bone's segment over that bone's radius, smoothed
    over the welded surface; small loose shells (teeth, spines, studs) are rigid;
  * limbs that stand out from the body instead of under it (a spider's legs, an
    elemental's arms) are listed in the spec's "sideLimbs" and walk it instead;
  * clips keyed procedurally from world-axis turns: Idle, Walk, Run, Attack (a
    lunging bite), Cast, Hit, Death, tuned by the spec's "motion" numbers. A spec
    may opt into a clawed Attack, a rear-up Cast and a burrower's Burrow,
    Underground and Emerge (see "opt-in styles and clips" below).

One GLB per clip is written; assemble.mjs beside this file merges them into the
shipped model.

  blender --background --python quadruped_rig.py -- <raw.glb> <out dir> --spec <spec.json> [--blend file]
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, kdtree

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
BLEND = args[args.index('--blend') + 1] if '--blend' in args else None
with open(args[args.index('--spec') + 1], encoding='utf-8') as handle:
    SPEC = json.load(handle)
MOTION = SPEC.get('motion', {})
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
scene.render.fps = FPS
mesh_obj = next(o for o in scene.objects if o.type == 'MESH')
world = mesh_obj.matrix_world.copy()
mesh_obj.parent = None
mesh_obj.data.transform(world)
mesh_obj.matrix_world = Matrix.Identity(4)
# Tripo does not always lay a creature along +X: the spec may turn it there.
if SPEC.get('rotateZ'):
    mesh_obj.data.transform(Matrix.Rotation(math.radians(SPEC['rotateZ']), 4, 'Z'))
for o in list(scene.objects):
    if o is not mesh_obj:
        bpy.data.objects.remove(o, do_unlink=True)
mesh_obj.name = SPEC['name']

# ---------------------------------------------------------------- skeleton
# name: (parent, head, tail, radius). It faces +X, +Y is its left, +Z is up. A bone
# named "X.*" in the spec is written once and mirrored to .L (+Y) and .R (-Y).
BONES = []
for name, parent, head, tail, radius in SPEC['bones']:
    if name.endswith('.*'):
        for side, sign in (('L', 1), ('R', -1)):
            mirror = lambda p: (p[0], p[1] * sign, p[2])
            BONES.append((name[:-1] + side, parent[:-1] + side if parent.endswith('.*') else parent,
                          mirror(head), mirror(tail), radius))
    else:
        BONES.append((name, parent, tuple(head), tuple(tail), radius))

arm_data = bpy.data.armatures.new(SPEC['name'] + 'Rig')
arm = bpy.data.objects.new(SPEC['name'] + 'Rig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail, _ in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(head), Vector(tail)
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------- weights
bm = bmesh.new()
bm.from_mesh(mesh_obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.verts.ensure_lookup_table()
welded = [v.co.copy() for v in bm.verts]
neighbours = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
label = [-1] * len(bm.verts)
shells = []
for v in bm.verts:
    if label[v.index] >= 0:
        continue
    stack, group = [v.index], []
    label[v.index] = len(shells)
    while stack:
        cur = stack.pop()
        group.append(cur)
        for other in neighbours[cur]:
            if label[other] < 0:
                label[other] = len(shells)
                stack.append(other)
    shells.append(group)
bm.free()

SKIN = [(n, Vector(h), Vector(t), r) for n, _, h, t, r in BONES if r > 0]


def seg_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def raw_weights(p):
    scored = []
    for name, a, b, radius in SKIN:
        # A left bone never takes a vertex well over on the right, and vice versa.
        if name.endswith('.L') and p.y < -0.03:
            continue
        if name.endswith('.R') and p.y > 0.03:
            continue
        scored.append((seg_distance(p, a, b) / radius, name))
    scored.sort()
    out = {}
    for d, name in scored[:3]:
        out[name] = 1.0 / max(d, 0.05) ** 4
    total = sum(out.values())
    return {n: w / total for n, w in out.items()}


weights = [raw_weights(p) for p in welded]
for _ in range(3):
    smoothed = []
    for i, own in enumerate(weights):
        acc = dict(own)
        for j in neighbours[i]:
            for n, w in weights[j].items():
                acc[n] = acc.get(n, 0.0) + w
        total = sum(acc.values())
        smoothed.append({n: w / total for n, w in acc.items()})
    weights = smoothed
for group in shells:
    if len(group) > 60:
        continue
    acc = {}
    for i in group:
        for n, w in weights[i].items():
            acc[n] = acc.get(n, 0.0) + w
    best = max(acc, key=acc.get)
    for i in group:
        weights[i] = {best: 1.0}

tree = kdtree.KDTree(len(welded))
for i, co in enumerate(welded):
    tree.insert(co, i)
tree.balance()
groups = {n: mesh_obj.vertex_groups.new(name=n) for n, *_ in SKIN}
for v in mesh_obj.data.vertices:
    picked = sorted(weights[tree.find(v.co)[1]].items(), key=lambda kv: -kv[1])[:4]
    total = sum(w for _, w in picked)
    for n, w in picked:
        if w / total > 0.01:
            groups[n].add([v.index], w / total, 'REPLACE')
mesh_obj.parent = arm
mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# ------------------------------------------------------------------- clips
REST = {b.name: b.matrix_local.copy() for b in arm_data.bones}
PARENT = {b.name: (b.parent.name if b.parent else None) for b in arm_data.bones}
ORDER = [b.name for b in arm_data.bones]
AXES = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}


def apply_pose(pose):
    """pose: bone -> {'turn': [(axis, degrees), ...], 'move': (x, y, z)}; turns
    are about WORLD axes through the bone's posed head, first one innermost."""
    posed = {}
    for name in ORDER:
        parent = PARENT[name]
        base = REST[name] if parent is None else posed[parent] @ REST[parent].inverted() @ REST[name]
        spec = pose.get(name, {})
        rot = Matrix.Identity(4)
        for axis, degrees in spec.get('turn', []):
            # A world axis by name, or any axis as a vector (a leg that points sideways).
            about = AXES[axis] if isinstance(axis, str) else Vector(axis)
            rot = Matrix.Rotation(math.radians(degrees), 4, about) @ rot
        pivot = base.to_translation()
        final = Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot) @ base
        final = Matrix.Translation(Vector(spec.get('move', (0, 0, 0)))) @ final
        posed[name] = final
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = base.inverted() @ final


def wave(t, freq=1.0, lag=0.0):
    return math.sin(2 * math.pi * (t * freq - lag))


def ease(a, b, t):
    t = max(0.0, min(1.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)


# How high it carries its head at rest (negative raises it): every clip starts here.
HEAD_UP = {'Chest': MOTION.get('chestUp', 0.0), 'Head': MOTION.get('headUp', 0.0)}


def stance(chest=0.0, head=0.0, head_yaw=0.0, jaw=0.0):
    return {
        'Chest': {'turn': [('Y', HEAD_UP['Chest'] + chest)]},
        'Head': {'turn': [('Y', HEAD_UP['Head'] + head), ('Z', head_yaw)]},
        'Jaw': {'turn': [('Y', jaw)]},
    }


def soft_parts(pose, t, tail=1.0, tent=1.0, freq=1.0):
    for i, amp in enumerate((6, 9, 12)):
        pose['Tail%d' % (i + 1)] = {'turn': [('Z', tail * amp * wave(t, freq, 0.12 * i))]}
    for side, s in (('L', 1), ('R', -1)):
        for k, chain in enumerate(('TentIn', 'TentOut')):
            for j in (1, 2):
                lag = 0.15 * j + 0.2 * k + (0.1 if s < 0 else 0)
                pose['%s%d.%s' % (chain, j, side)] = {'turn': [
                    ('X', tent * 7 * j * wave(t, freq, lag)),
                    ('Y', tent * 5 * j * wave(t, freq, lag + 0.25)),
                ]}
    pose['Lure1'] = {'turn': [('Y', 6 * wave(t, freq, 0.1))]}
    pose['Lure2'] = {'turn': [('Y', 9 * wave(t, freq, 0.3)), ('X', 5 * wave(t, freq, 0.2))]}


def leg(pose, kind, side, swing, lift):
    """swing: degrees forward (+) or back (-); lift 0..1 folds the leg off the ground."""
    upper, lower, foot = (('ForeUpper', 'ForeLower', 'ForeFoot') if kind == 'fore'
                          else ('HindThigh', 'HindShin', 'HindFoot'))
    fold = 1 if kind == 'fore' else -1
    pose['%s.%s' % (upper, side)] = {'turn': [('Y', -swing - fold * 14 * lift)]}
    pose['%s.%s' % (lower, side)] = {'turn': [('Y', fold * 34 * lift)]}
    pose['%s.%s' % (foot, side)] = {'turn': [('Y', swing * 0.6 - fold * 16 * lift)]}


# Limbs that stand OUT from the body instead of under it (a spider's legs, a
# floating elemental's arms), from the spec: {"upper", "lower", "dir": [x, y],
# "side": 1 | -1, "phase": 0..1}. They swing about the vertical and lift about the
# horizontal axis square to the way they point. When a spec lists them, they walk
# the creature instead of the four legs underneath.
SIDE_LIMBS = SPEC.get('sideLimbs', [])


def side_limb(pose, limb, swing, lift):
    out = Vector((limb['dir'][0], limb['dir'][1], 0)).normalized()
    hinge = tuple(out.cross(Vector((0, 0, 1))))
    pose[limb['upper']] = {'turn': [('Z', -swing * limb['side']), (hinge, 16 * lift)]}
    pose[limb['lower']] = {'turn': [(hinge, -22 * lift)]}


def step_limbs(pose, t, stride):
    for limb in SIDE_LIMBS:
        phase = limb.get('phase', 0.0)
        side_limb(pose, limb, stride * wave(t, 1, phase), max(0.0, math.cos(2 * math.pi * (t - phase))))


def hold_limbs(pose, swing=0.0, lift=0.0, fore_only=False):
    for limb in SIDE_LIMBS:
        if fore_only and limb['dir'][0] <= 0:
            continue
        side_limb(pose, limb, swing, lift)


def clip_idle(t):
    pose = stance(chest=1.5 * wave(t), head=2.5 * wave(t, 1, 0.15), head_yaw=4 * wave(t, 1, 0.4),
                  jaw=3 + 3 * wave(t, 1, 0.3))
    pose['Hips'] = {'move': (0, 0, -MOTION.get('idleBob', 0.006) * (1 + wave(t)))}
    soft_parts(pose, t)
    for k, limb in enumerate(SIDE_LIMBS):
        side_limb(pose, limb, 2.5 * wave(t, 1, 0.13 * k), 0.12 * (1 + wave(t, 1, 0.21 * k)))
    return pose


def gait(t, stride, bob, lean, tail):
    pose = stance(chest=lean + 1.5 * wave(t, 2), head=-lean * 0.6 + 2 * wave(t, 2, 0.2),
                  head_yaw=-3 * wave(t), jaw=2)
    pose['Hips'] = {'move': (0, 0, -bob * (1 + wave(t, 2))), 'turn': [('Z', 3 * wave(t))]}
    pose['Spine'] = {'turn': [('Z', -3 * wave(t))]}
    for kind, side, phase in (('fore', 'L', 0.0), ('hind', 'R', 0.0), ('fore', 'R', 0.5), ('hind', 'L', 0.5)):
        leg(pose, kind, side, stride * wave(t, 1, phase), max(0.0, math.cos(2 * math.pi * (t - phase))))
    step_limbs(pose, t, stride)
    soft_parts(pose, t, tail=tail, tent=1.6)
    return pose


def clip_walk(t):
    return gait(t, MOTION.get('walkStride', 20), MOTION.get('bob', 0.006), 0, 1.2)


def clip_run(t):
    return gait(t, MOTION.get('runStride', 30), MOTION.get('bob', 0.006) * 2, 5, 1.6)


def clip_attack(t):
    back = ease(0.0, 0.26, t) * (1 - ease(0.26, 0.4, t))
    bite = ease(0.28, 0.42, t) * (1 - ease(0.58, 1.0, t))
    snap = ease(0.36, 0.44, t) * (1 - ease(0.62, 0.9, t))
    pose = stance(chest=-12 * back + 12 * bite, head=-20 * back + 16 * bite, jaw=20 * back - 24 * snap)
    pose['Hips'] = {'move': (-0.035 * back + 0.085 * bite, 0, -0.02 * bite), 'turn': [('Y', 4 * bite - 3 * back)]}
    for side in ('L', 'R'):
        leg(pose, 'fore', side, -10 * back + 16 * bite, 0.0)
        leg(pose, 'hind', side, 8 * back - 14 * bite, 0.0)
    soft_parts(pose, t, tail=1.5, tent=1.0 + 2.0 * bite, freq=2.0)
    hold_limbs(pose, swing=-14 * back + 26 * bite, lift=1.6 * back, fore_only=True)
    return pose


def clip_cast(t):
    up = ease(0.0, 0.22, t) * (1 - ease(0.74, 1.0, t))
    shake = up * wave(t, 9)
    pose = stance(chest=-15 * up, head=-24 * up + 2 * shake, head_yaw=3 * shake, jaw=24 * up + 3 * shake)
    pose['Hips'] = {'move': (-0.02 * up, 0, -0.012 * up), 'turn': [('Y', -5 * up)]}
    soft_parts(pose, t, tail=1.0 + up, tent=1.0, freq=2.0)
    for side, s in (('L', 1), ('R', -1)):
        for chain, flare in (('TentIn', 22), ('TentOut', 38)):
            pose['%s1.%s' % (chain, side)]['turn'].append(('X', -s * flare * up))
            pose['%s2.%s' % (chain, side)]['turn'].append(('X', -s * flare * 0.6 * up))
        leg(pose, 'fore', side, -6 * up, 0.0)
    hold_limbs(pose, swing=-8 * up, lift=1.3 * up)
    pose['Lure1']['turn'].append(('Y', 30 * up))
    pose['Lure2']['turn'].append(('Y', 25 * up + 8 * shake))
    return pose


def clip_hit(t):
    jolt = ease(0.0, 0.18, t) * (1 - ease(0.25, 1.0, t))
    pose = stance(chest=-7 * jolt, head=-16 * jolt, head_yaw=9 * jolt, jaw=12 * jolt)
    pose['Hips'] = {'move': (-0.04 * jolt, 0, -0.01 * jolt), 'turn': [('Y', -4 * jolt)]}
    soft_parts(pose, t, tail=2.0, tent=2.5, freq=2.0)
    hold_limbs(pose, swing=-10 * jolt, lift=0.8 * jolt)
    for side in ('L', 'R'):
        leg(pose, 'fore', side, -8 * jolt, 0.0)
        leg(pose, 'hind', side, 6 * jolt, 0.0)
    return pose


def clip_death(t):
    stagger = ease(0.0, 0.3, t)
    fall = ease(0.25, 0.7, t)
    settle = ease(0.7, 1.0, t)
    pose = stance(chest=-10 * stagger * (1 - fall) + 8 * fall, head=-18 * stagger * (1 - fall) + 20 * fall,
                  head_yaw=12 * fall, jaw=22 * stagger - 8 * settle)
    pose['Hips'] = {'move': (0, -0.05 * fall, -MOTION.get('deathDrop', 0.19) * fall + 0.012 * math.sin(math.pi * settle)),
                    'turn': [('X', -MOTION.get('deathRoll', 78) * fall), ('Z', 8 * fall)]}
    for side, s in (('L', 1), ('R', -1)):
        leg(pose, 'fore', side, 12 * fall * s, 0.55 * fall)
        leg(pose, 'hind', side, -10 * fall * s, 0.5 * fall)
    hold_limbs(pose, swing=0.0, lift=MOTION.get('deathCurl', 2.2) * fall)
    live = 1 - fall
    soft_parts(pose, t, tail=2.0 * live, tent=2.0 * live, freq=3.0)
    for i in (1, 2, 3):
        pose['Tail%d' % i]['turn'].append(('Y', 10 * fall))
    return pose


# ------------------------------------------------ opt-in styles and clips
# A spec may ask for a clawed swipe instead of the bite ("attackStyle": "claws"),
# a rear-up-and-slam instead of the roar ("castStyle": "rear"), and a burrower's
# extra clips ("extraClips": ["Burrow", "Underground", "Emerge"]). The rear-up
# and the burrow turn and sink the Root bone, whose head the spec places on the
# floor under the hind feet: every turn of it pivots there. A spec without these
# keys writes exactly what it always did.
ROOT = 'Root'


def root_pose(pose, pitch=0.0, sink=0.0):
    """pitch: degrees nose-up about the Root head (the hind feet); sink: down."""
    pose[ROOT] = {'turn': [('Y', -pitch)], 'move': (0, 0, -sink)}


def fore_claw(pose, side, s, swing, lift, sweep):
    """A front leg by leg(), plus sweep degrees swinging its paw out (+) or in (-)."""
    leg(pose, 'fore', side, swing, lift)
    pose['ForeUpper.%s' % side]['turn'].append(('Z', s * sweep))


def clip_attack_claws(t):
    # Wind up (claws raised and spread), strike at ~40%, hold, recover.
    back = ease(0.0, 0.3, t) * (1 - ease(0.3, 0.42, t))
    strike = ease(0.3, 0.42, t) * (1 - ease(0.6, 1.0, t))
    pose = stance(chest=-10 * back + 9 * strike, head=-14 * back + 10 * strike)
    pose['Hips'] = {'move': (-0.03 * back + 0.06 * strike, 0, -0.015 * strike),
                    'turn': [('Y', -4 * back + 3 * strike)]}
    for side, s in (('L', 1), ('R', -1)):
        fore_claw(pose, side, s, 58 * back + 18 * strike, 1.1 * back, 16 * back - 14 * strike)
        leg(pose, 'hind', side, 6 * back - 10 * strike, 0.0)
    soft_parts(pose, t, tail=1.5, freq=2.0)
    return pose


def clip_cast_rear(t):
    # Rears up on the hind legs, claws high, roars; slams the claws down at ~55%.
    rear = ease(0.0, 0.34, t) * (1 - ease(0.5, 0.6, t))
    slam = ease(0.52, 0.6, t) * (1 - ease(0.72, 1.0, t))
    shake = rear * wave(t, 9)
    pose = stance(chest=-8 * rear + 8 * slam, head=-18 * rear + 2 * shake + 8 * slam,
                  head_yaw=3 * shake)
    root_pose(pose, pitch=MOTION.get('rearPitch', 38) * rear - 3 * slam)
    for side, s in (('L', 1), ('R', -1)):
        fore_claw(pose, side, s, 60 * rear + 26 * slam, 1.1 * rear, 12 * rear - 6 * slam)
        leg(pose, 'hind', side, -12 * rear, 0.0)
    soft_parts(pose, t, tail=1.0 + rear, freq=2.0)
    # The tail lifts as the body tips back, so it never ploughs into the floor.
    pose['Tail1']['turn'].append(('Y', 0.8 * MOTION.get('rearPitch', 38) * rear))
    return pose


BURROW_DEPTH = MOTION.get('burrowDepth', 0.0)


def sunk_pose(wobble=0.0):
    """The fully sunk pose Burrow ends on, Underground holds and Emerge starts from."""
    pose = stance(head=12)
    root_pose(pose, sink=BURROW_DEPTH)
    for side, s in (('L', 1), ('R', -1)):
        fore_claw(pose, side, s, 30 + 6 * wobble * s, 0.6, 0.0)
        leg(pose, 'hind', side, -10, 0.0)
    soft_parts(pose, 0.0, tail=0.0)
    return pose


def clip_burrow(t):
    # Head and claws dig in, the body sinks its full height, then holds sunk.
    if t >= 0.9:
        return sunk_pose()
    dig = ease(0.0, 0.15, t) * (1 - ease(0.75, 0.9, t))
    sink = ease(0.15, 0.85, t)
    settle = ease(0.75, 0.9, t)
    pose = stance(chest=14 * dig + 4 * wave(t, 5) * dig, head=(22 + 5 * wave(t, 5, 0.2)) * dig + 12 * settle,
                  head_yaw=6 * wave(t, 2.5) * dig)
    root_pose(pose, pitch=-10 * dig, sink=BURROW_DEPTH * sink)
    pose['Hips'] = {'turn': [('Z', 5 * wave(t, 2.5) * dig)]}
    for side, s in (('L', 1), ('R', -1)):
        paddle = wave(t, 5, 0.0 if s > 0 else 0.5)
        fore_claw(pose, side, s, (20 + 34 * paddle) * dig + 30 * settle,
                  (0.5 + 0.5 * max(0.0, paddle)) * dig + 0.6 * settle, 10 * paddle * dig)
        leg(pose, 'hind', side, -10 * settle + 8 * wave(t, 5, 0.25) * dig, 0.0)
    soft_parts(pose, t, tail=2.0 * (1 - settle), freq=3.0)
    return pose


def clip_underground(t):
    return sunk_pose(wobble=wave(t))


def clip_emerge(t):
    # Bursts up out of the ground head and claws first, lands, settles to Idle.
    if t <= 0.0:
        return sunk_pose()
    rise = ease(0.0, 0.45, t)
    burst = ease(0.0, 0.3, t) * (1 - ease(0.45, 0.65, t))
    land = ease(0.5, 0.65, t) * (1 - ease(0.7, 1.0, t))
    under = 1 - rise
    pose = stance(chest=-10 * burst + 6 * land, head=12 * under - 20 * burst + 6 * land)
    root_pose(pose, pitch=24 * burst - 2 * land, sink=BURROW_DEPTH * under - 0.03 * burst)
    for side, s in (('L', 1), ('R', -1)):
        fore_claw(pose, side, s, 30 * under + 55 * burst + 16 * land,
                  0.6 * under + 1.0 * burst, 10 * burst)
        leg(pose, 'hind', side, -10 * under - 10 * burst, 0.0)
    soft_parts(pose, t, tail=2.0 * burst + 1.0 * land, freq=2.0)
    return pose


# name: (function, seconds)
CLIPS = {
    'Idle': (clip_idle, 3.0),
    'Walk': (clip_walk, 1.0),
    'Run': (clip_run, 0.62),
    'Attack': (clip_attack_claws if SPEC.get('attackStyle') == 'claws' else clip_attack,
               MOTION.get('attackSeconds', 1.0)),
    'Cast': (clip_cast_rear if SPEC.get('castStyle') == 'rear' else clip_cast,
             MOTION.get('castSeconds', 1.5)),
    'Hit': (clip_hit, 0.55),
    'Death': (clip_death, 1.7),
}
EXTRA_CLIPS = {
    'Burrow': (clip_burrow, MOTION.get('burrowSeconds', 1.1)),
    'Underground': (clip_underground, 1.0),
    'Emerge': (clip_emerge, MOTION.get('emergeSeconds', 0.8)),
}
for extra in SPEC.get('extraClips', []):
    CLIPS[extra] = EXTRA_CLIPS[extra]
# A few degrees nose-up on every clip seats hind feet a hair shorter than the
# front claws (pivoting on the Root head, under the hind feet).
GROUND_TILT = MOTION.get('groundTilt', 0.0)

os.makedirs(OUT, exist_ok=True)
arm.animation_data_create()
for clip, (fn, seconds) in CLIPS.items():
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True  # keep every clip in the saved .blend
    arm.animation_data.action = action
    frames = max(2, round(seconds * FPS))
    for f in range(frames + 1):
        pose = fn(f / frames)
        if GROUND_TILT:
            pose.setdefault(ROOT, {}).setdefault('turn', []).append(('Y', -GROUND_TILT))
        apply_pose(pose)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            pb.keyframe_insert('location', frame=f + 1)
    scene.frame_start, scene.frame_end = 1, frames + 1
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh_obj.select_set(True)
    path = os.path.join(OUT, '%s_%s.glb' % (SPEC['key'], clip.lower()))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS',
        export_optimize_animation_size=False,
    )
    print('WROTE', path, frames + 1, 'frames')
if BLEND:
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print('SAVED', BLEND)
