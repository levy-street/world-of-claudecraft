"""The Abyssal Maw: a rig and a clip set of his own, authored in Blender.

Tripo's quadruped auto-rig folded his head under his chest and ships a single
walk preset, so the generated model (raw, textured, facing +X, up +Z) is rigged
here instead:

  * a hand-placed skeleton: hips, spine, chest, head, JAW, a three-bone tail, four
    three-bone legs, four two-bone chin tentacles and the two-bone lure;
  * weights by distance to each bone's segment over that bone's radius, smoothed
    over the welded surface; small loose shells (teeth, eyes, studs) are rigid;
  * clips keyed procedurally from world-axis turns: Idle, Walk, Run, Attack (a
    lunging bite), Cast (a roar), Hit, Death.

One GLB per clip is written; assemble.mjs beside this file merges them into the
shipped model.

  blender --background --python maw_rig.py -- <raw.glb> <out dir> [--blend file]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, kdtree

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
BLEND = args[args.index('--blend') + 1] if '--blend' in args else None
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
for o in list(scene.objects):
    if o is not mesh_obj:
        bpy.data.objects.remove(o, do_unlink=True)
mesh_obj.name = 'AbyssalMaw'

# ---------------------------------------------------------------- skeleton
# name: (parent, head, tail, radius). He faces +X, +Y is his left, +Z is up.
BONES = [
    ('Root', None, (0, 0, -0.34), (0, 0, -0.24), 0.0),
    ('Hips', 'Root', (-0.2, 0, 0.04), (-0.05, 0, 0.07), 0.2),
    ('Spine', 'Hips', (-0.05, 0, 0.07), (0.1, 0, 0.1), 0.22),
    ('Chest', 'Spine', (0.1, 0, 0.1), (0.2, 0, 0.12), 0.22),
    ('Head', 'Chest', (0.2, 0, 0.13), (0.4, 0, 0.17), 0.17),
    ('Jaw', 'Head', (0.22, 0, 0.03), (0.37, 0, -0.05), 0.1),
    ('Lure1', 'Head', (0.36, 0, 0.22), (0.4, 0, 0.29), 0.03),
    ('Lure2', 'Lure1', (0.4, 0, 0.29), (0.49, 0, 0.24), 0.03),
    ('Tail1', 'Hips', (-0.2, 0, 0.04), (-0.3, 0, 0.06), 0.12),
    ('Tail2', 'Tail1', (-0.3, 0, 0.06), (-0.38, 0, 0.14), 0.09),
    ('Tail3', 'Tail2', (-0.38, 0, 0.14), (-0.49, 0, 0.2), 0.1),
]
for side, s in (('L', 1), ('R', -1)):
    BONES += [
        ('HindThigh.' + side, 'Hips', (-0.15, 0.17 * s, -0.02), (-0.15, 0.17 * s, -0.14), 0.085),
        ('HindShin.' + side, 'HindThigh.' + side, (-0.15, 0.17 * s, -0.14), (-0.166, 0.17 * s, -0.23), 0.06),
        ('HindFoot.' + side, 'HindShin.' + side, (-0.166, 0.17 * s, -0.23), (-0.14, 0.17 * s, -0.33), 0.055),
        ('ForeUpper.' + side, 'Chest', (0.1, 0.18 * s, 0.06), (0.115, 0.18 * s, -0.09), 0.095),
        ('ForeLower.' + side, 'ForeUpper.' + side, (0.115, 0.18 * s, -0.09), (0.12, 0.18 * s, -0.24), 0.065),
        ('ForeFoot.' + side, 'ForeLower.' + side, (0.12, 0.18 * s, -0.24), (0.14, 0.18 * s, -0.33), 0.055),
        ('TentIn1.' + side, 'Chest', (0.27, 0.06 * s, -0.02), (0.29, 0.07 * s, -0.14), 0.04),
        ('TentIn2.' + side, 'TentIn1.' + side, (0.29, 0.07 * s, -0.14), (0.3, 0.08 * s, -0.26), 0.04),
        ('TentOut1.' + side, 'Chest', (0.24, 0.12 * s, -0.02), (0.25, 0.2 * s, -0.15), 0.04),
        ('TentOut2.' + side, 'TentOut1.' + side, (0.25, 0.2 * s, -0.15), (0.25, 0.29 * s, -0.2), 0.04),
    ]

arm_data = bpy.data.armatures.new('MawRig')
arm = bpy.data.objects.new('MawRig', arm_data)
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
            rot = Matrix.Rotation(math.radians(degrees), 4, AXES[axis]) @ rot
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


# He carries his head HIGH so the mouth and the teeth read from a player's camera
# (playtest): every clip starts from this.
HEAD_UP = {'Chest': -7.0, 'Head': -11.0}


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


def clip_idle(t):
    pose = stance(chest=1.5 * wave(t), head=2.5 * wave(t, 1, 0.15), head_yaw=4 * wave(t, 1, 0.4),
                  jaw=3 + 3 * wave(t, 1, 0.3))
    pose['Hips'] = {'move': (0, 0, -0.006 * (1 + wave(t)))}
    soft_parts(pose, t)
    return pose


def gait(t, stride, bob, lean, tail):
    pose = stance(chest=lean + 1.5 * wave(t, 2), head=-lean * 0.6 + 2 * wave(t, 2, 0.2),
                  head_yaw=-3 * wave(t), jaw=2)
    pose['Hips'] = {'move': (0, 0, -bob * (1 + wave(t, 2))), 'turn': [('Z', 3 * wave(t))]}
    pose['Spine'] = {'turn': [('Z', -3 * wave(t))]}
    for kind, side, phase in (('fore', 'L', 0.0), ('hind', 'R', 0.0), ('fore', 'R', 0.5), ('hind', 'L', 0.5)):
        leg(pose, kind, side, stride * wave(t, 1, phase), max(0.0, math.cos(2 * math.pi * (t - phase))))
    soft_parts(pose, t, tail=tail, tent=1.6)
    return pose


def clip_walk(t):
    return gait(t, 20, 0.006, 0, 1.2)


def clip_run(t):
    return gait(t, 30, 0.012, 5, 1.6)


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
    pose['Lure1']['turn'].append(('Y', 30 * up))
    pose['Lure2']['turn'].append(('Y', 25 * up + 8 * shake))
    return pose


def clip_hit(t):
    jolt = ease(0.0, 0.18, t) * (1 - ease(0.25, 1.0, t))
    pose = stance(chest=-7 * jolt, head=-16 * jolt, head_yaw=9 * jolt, jaw=12 * jolt)
    pose['Hips'] = {'move': (-0.04 * jolt, 0, -0.01 * jolt), 'turn': [('Y', -4 * jolt)]}
    soft_parts(pose, t, tail=2.0, tent=2.5, freq=2.0)
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
    pose['Hips'] = {'move': (0, -0.05 * fall, -0.19 * fall + 0.012 * math.sin(math.pi * settle)),
                    'turn': [('X', -78 * fall), ('Z', 8 * fall)]}
    for side, s in (('L', 1), ('R', -1)):
        leg(pose, 'fore', side, 12 * fall * s, 0.55 * fall)
        leg(pose, 'hind', side, -10 * fall * s, 0.5 * fall)
    live = 1 - fall
    soft_parts(pose, t, tail=2.0 * live, tent=2.0 * live, freq=3.0)
    for i in (1, 2, 3):
        pose['Tail%d' % i]['turn'].append(('Y', 10 * fall))
    return pose


# name: (function, seconds)
CLIPS = {
    'Idle': (clip_idle, 3.0),
    'Walk': (clip_walk, 1.0),
    'Run': (clip_run, 0.62),
    'Attack': (clip_attack, 1.0),
    'Cast': (clip_cast, 1.5),
    'Hit': (clip_hit, 0.55),
    'Death': (clip_death, 1.7),
}

os.makedirs(OUT, exist_ok=True)
arm.animation_data_create()
for clip, (fn, seconds) in CLIPS.items():
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True  # keep every clip in the saved .blend
    arm.animation_data.action = action
    frames = max(2, round(seconds * FPS))
    for f in range(frames + 1):
        apply_pose(fn(f / frames))
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            pb.keyframe_insert('location', frame=f + 1)
    scene.frame_start, scene.frame_end = 1, frames + 1
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh_obj.select_set(True)
    path = os.path.join(OUT, 'maw_%s.glb' % clip.lower())
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
