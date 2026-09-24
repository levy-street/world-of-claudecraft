"""A flying hoard boss with membrane wings: a rig and an airborne clip set, in Blender.

The winged sibling of quadruped_rig.py (same spec format, same weighting, same
one-GLB-per-clip output that assemble.mjs merges). A bat never touches the floor,
so every clip here is a flying pose around the rest origin; the game lifts the
body with its VISUALS `hover`:

  * the spec places the skeleton by hand (Z up, facing +X, "X.*" bones mirrored
    to .L at +Y and .R at -Y): Root, Body (an unweighted pivot at the centre of
    mass that pitches the whole bat), Hips, Spine, Chest, Neck, Head, Jaw, Ear,
    Tail1..2, three-bone hind legs, and each wing as WingUpper (shoulder to
    elbow), WingFore (elbow to wrist), Thumb, FingerA1..3 (the leading edge) and
    FingerB1..2 (the trailing finger); the membrane weights blend across the
    finger bones so it follows them;
  * turns are written in the bat's REST frame at the bone's head and carried by
    the parent, so a wing beat stays a wing beat however the body is pitched;
    left-side turns are mirrored for the right wing;
  * clips: Idle (hover, slow beats), Walk and Run (flying forward, pitched, faster
    beats), Attack (lunging bite and talon rake, the bite closes at ~40%), Hit,
    Death (crumples, falls and lies face down on the floor the spec's hover
    implies), Cast (reared back screech, wings flared, loops) and Dive (wings
    folded back tight, body pitched into the dive, loops).

  blender --background --python bat_rig.py -- <raw.glb> <out dir> --spec <spec.json> [--blend file]
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
if SPEC.get('rotateZ'):
    mesh_obj.data.transform(Matrix.Rotation(math.radians(SPEC['rotateZ']), 4, 'Z'))
for o in list(scene.objects):
    if o is not mesh_obj:
        bpy.data.objects.remove(o, do_unlink=True)
mesh_obj.name = SPEC['name']

# ---------------------------------------------------------------- skeleton
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
# As quadruped_rig.py: distance to each bone's segment over its radius, the three
# nearest blended, smoothed over the welded surface; small loose shells are rigid.
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
SIDE_GAP = MOTION.get('sideGap', 0.03)


def seg_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def raw_weights(p):
    scored = []
    for name, a, b, radius in SKIN:
        if name.endswith('.L') and p.y < -SIDE_GAP:
            continue
        if name.endswith('.R') and p.y > SIDE_GAP:
            continue
        scored.append((seg_distance(p, a, b) / radius, name))
    scored.sort()
    out = {}
    for d, name in scored[:3]:
        out[name] = 1.0 / max(d, 0.05) ** 4
    total = sum(out.values())
    return {n: w / total for n, w in out.items()}


weights = [raw_weights(p) for p in welded]
for _ in range(MOTION.get('smooth', 3)):
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

# ------------------------------------------------------------------- posing
REST = {b.name: b.matrix_local.copy() for b in arm_data.bones}
HEAD = {b.name: b.head_local.copy() for b in arm_data.bones}
ORDER = [b.name for b in arm_data.bones]
AXES = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}


def apply_pose(pose):
    """pose: bone -> {'turn': [(axis, degrees), ...], 'move': (x, y, z)}. Turns are
    about REST-frame axes through the bone's rest head (first one innermost) and are
    carried by the parent's pose, so they read the same however the body is posed."""
    for name in ORDER:
        spec = pose.get(name, {})
        rot = Matrix.Identity(4)
        for axis, degrees in spec.get('turn', []):
            about = AXES[axis] if isinstance(axis, str) else Vector(axis)
            rot = Matrix.Rotation(math.radians(degrees), 4, about) @ rot
        head = HEAD[name]
        local = Matrix.Translation(Vector(spec.get('move', (0, 0, 0)))) @ Matrix.Translation(head) @ rot @ Matrix.Translation(-head)
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = REST[name].inverted() @ local @ REST[name]


def side_axis(axis, side):
    """A left-side turn axis, mirrored across the XZ plane for the right side."""
    v = AXES[axis] if isinstance(axis, str) else Vector(axis)
    return tuple(v) if side == 'L' else (-v.x, v.y, -v.z)


def add(pose, bone, *turns, move=None):
    entry = pose.setdefault(bone, {'turn': []})
    entry['turn'].extend(turns)
    if move is not None:
        old = entry.get('move', (0, 0, 0))
        entry['move'] = tuple(o + m for o, m in zip(old, move))


def wave(t, freq=1.0, lag=0.0):
    return math.sin(2 * math.pi * (t * freq - lag))


def ease(a, b, t):
    t = max(0.0, min(1.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mix(a, b, k):
    return a + (b - a) * k


# ------------------------------------------------------------------- pieces
def wing(pose, side, flap=0.0, sweep=0.0, twist=0.0, elbow=0.0, fold_a=0.0, fold_b=0.0, thumb=0.0):
    """One wing, left-side sense (mirrored for R). flap: + raises the wing, - beats it
    down; sweep: + brings it forward; twist: + turns the leading edge down; elbow: +
    folds the forearm in; fold_a / fold_b: + folds the leading / trailing finger
    toward the forearm (negative fans them open)."""
    s = side
    add(pose, 'WingUpper.' + s, (side_axis('Y', s), twist), (side_axis('Z', s), -sweep), (side_axis('X', s), flap))
    add(pose, 'WingFore.' + s, (side_axis('X', s), elbow))
    add(pose, 'FingerA1.' + s, (side_axis('X', s), -fold_a))
    add(pose, 'FingerA2.' + s, (side_axis('X', s), -0.45 * fold_a))
    add(pose, 'FingerA3.' + s, (side_axis('X', s), -0.35 * fold_a))
    add(pose, 'FingerB1.' + s, (side_axis('X', s), -fold_b))
    add(pose, 'FingerB2.' + s, (side_axis('X', s), -0.4 * fold_b))
    add(pose, 'Thumb.' + s, (side_axis('Y', s), thumb))


def beat(pose, p, top, bottom, sweep=8.0, fold=1.0, twist=6.0, extra=None):
    """A full wing beat at phase p (0 top of the stroke, 0.5 bottom). The downstroke
    reaches forward with the wing spread; the upstroke folds it at the elbow and
    fingers so the membrane never scoops air back up."""
    c = math.cos(2 * math.pi * p)
    down = (1 - c) / 2
    power = max(0.0, math.sin(2 * math.pi * p))
    recover = max(0.0, -math.sin(2 * math.pi * p))
    extra = extra or {}
    for s in ('L', 'R'):
        wing(pose, s,
             flap=mix(top, bottom, down) + extra.get('flap', 0.0),
             sweep=sweep * power - 0.4 * sweep * recover + extra.get('sweep', 0.0),
             twist=twist * power - twist * 0.6 * recover + extra.get('twist', 0.0),
             elbow=fold * 22 * recover + extra.get('elbow', 0.0),
             fold_a=fold * 34 * recover + extra.get('fold_a', 0.0),
             fold_b=fold * 16 * recover + extra.get('fold_b', 0.0),
             thumb=extra.get('thumb', 0.0))
    return c


def body(pose, pitch=0.0, move=(0, 0, 0), roll=0.0, yaw=0.0):
    add(pose, 'Body', ('Y', pitch), ('X', roll), ('Z', yaw), move=move)


def head(pose, neck=0.0, head_pitch=0.0, yaw=0.0, jaw=0.0, ears=0.0, ear_lag=0.0):
    add(pose, 'Neck', ('Y', neck), ('Z', yaw * 0.4))
    add(pose, 'Head', ('Y', head_pitch), ('Z', yaw * 0.6))
    add(pose, 'Jaw', ('Y', jaw))
    for s in ('L', 'R'):
        add(pose, 'Ear.' + s, (side_axis('X', s), -ears))


def legs(pose, swing=0.0, knee=0.0, curl=0.0, spread=0.0, lag=(0.0, 0.0)):
    """Hanging hind legs. swing: + trails the legs back, - rakes the talons forward;
    knee: + bends the shin up behind; curl: + clenches the talons; lag: per-side
    extra swing (L, R) so the dangling legs do not move as one."""
    for k, s in enumerate(('L', 'R')):
        add(pose, 'HindThigh.' + s, ('Y', swing + lag[k]), (side_axis('X', s), -spread))
        add(pose, 'HindShin.' + s, ('Y', -knee))
        add(pose, 'HindFoot.' + s, ('Y', curl))


def tail(pose, lift=0.0, sway=0.0):
    add(pose, 'Tail1', ('Y', -lift), ('Z', sway))
    add(pose, 'Tail2', ('Y', -lift * 0.6), ('Z', sway * 1.4))


# -------------------------------------------------------------------- clips
BOB = MOTION.get('bob', 0.016)


def flight(t, beats, top, bottom, pitch, bob, sweep, legs_back, head_counter, fold=1.0):
    pose = {}
    p = (t * beats) % 1.0
    beat(pose, p, top, bottom, sweep=sweep, fold=fold)
    lift = -math.cos(2 * math.pi * (p - 0.12))
    body(pose, pitch=pitch + 2.5 * math.sin(2 * math.pi * (p - 0.2)), move=(0, 0, bob * lift))
    add(pose, 'Chest', ('Y', -1.5 * math.sin(2 * math.pi * (p - 0.25))))
    head(pose, neck=-head_counter * 0.4, head_pitch=-head_counter * 0.6 - 2.0 * lift,
         yaw=3.0 * wave(t, 1, 0.2), jaw=4 + 2 * wave(t, 1, 0.3), ears=4 * math.sin(2 * math.pi * (p - 0.3)))
    legs(pose, swing=legs_back + 5 * math.sin(2 * math.pi * (p - 0.35)), knee=8 + 4 * math.sin(2 * math.pi * (p - 0.45)),
         curl=10, lag=(2 * wave(t, 1), -2 * wave(t, 1)))
    tail(pose, lift=4 * math.sin(2 * math.pi * (p - 0.4)), sway=3 * wave(t, 1, 0.1))
    return pose


def clip_idle(t):
    return flight(t, 2, MOTION.get('idleTop', 14), MOTION.get('idleBottom', -44), MOTION.get('idlePitch', 8),
                  BOB, 8, 4, 8)


def clip_walk(t):
    return flight(t, 2, 18, -52, MOTION.get('walkPitch', 22), BOB * 0.9, 12, 18, 22)


def clip_run(t):
    return flight(t, 2, 22, -60, MOTION.get('runPitch', 34), BOB * 0.8, 16, 30, 32, fold=1.2)


def clip_attack(t):
    # Rear up and open wide (0 to 0.3), lunge in with one hard downstroke and a talon
    # rake (0.3 to 0.45, the bite closes at ~0.4), then fall back to the hover.
    wind = ease(0.0, 0.3, t) * (1 - ease(0.3, 0.42, t))
    lunge = ease(0.3, 0.42, t) * (1 - ease(0.58, 1.0, t))
    gape = ease(0.05, 0.3, t) * (1 - ease(0.36, 0.41, t))
    pose = {}
    p = (t - 0.3) % 1.0
    beat(pose, p, 14 + 10 * wind, -54, sweep=14, extra={'fold_a': -10 * wind, 'fold_b': -6 * wind})
    body(pose, pitch=8 - 16 * wind + 30 * lunge, move=(-0.04 * wind + 0.14 * lunge, 0, 0.025 * wind - 0.03 * lunge))
    head(pose, neck=-10 * wind + 12 * lunge, head_pitch=-16 * wind - 14 * lunge, jaw=34 * gape + 5,
         ears=14 * wind + 8 * lunge)
    legs(pose, swing=10 * wind - 44 * lunge + 4, knee=8 + 14 * wind - 6 * lunge, curl=10 - 20 * wind + 26 * lunge)
    tail(pose, lift=10 * wind - 6 * lunge)
    return pose


def clip_hit(t):
    jolt = ease(0.0, 0.15, t) * (1 - ease(0.25, 1.0, t))
    pose = {}
    p = (t * 0.9) % 1.0
    beat(pose, p, 14, -40, extra={'flap': 18 * jolt, 'elbow': 20 * jolt, 'fold_a': 16 * jolt})
    body(pose, pitch=8 - 16 * jolt, move=(-0.05 * jolt, 0, 0.01 * jolt), roll=6 * jolt)
    head(pose, neck=-8 * jolt, head_pitch=-18 * jolt, yaw=10 * jolt, jaw=6 + 18 * jolt, ears=-10 * jolt)
    legs(pose, swing=4 + 16 * jolt, knee=8 + 12 * jolt, curl=10 + 12 * jolt)
    tail(pose, lift=-8 * jolt, sway=6 * jolt)
    return pose


DEATH_DROP = [0.0]  # calibrated below so the body comes to rest on the floor


def clip_death(t, drop=None):
    drop = DEATH_DROP[0] if drop is None else drop
    shock = ease(0.0, 0.18, t) * (1 - ease(0.3, 0.55, t))
    limp = ease(0.12, 0.6, t)
    fall = ease(0.22, 0.78, t) ** 1.6
    land = ease(0.7, 0.86, t)
    settle = ease(0.78, 1.0, t)
    bounce = 0.02 * math.sin(math.pi * ease(0.78, 0.94, t)) * land
    pose = {}
    # A last ragged beat, then the wings go slack and fall open as it hits.
    p = (t * 1.6) % 1.0
    live = 1 - limp
    for s in ('L', 'R'):
        stroke = 30 * math.cos(2 * math.pi * p) * live
        wing(pose, s,
             flap=stroke + 20 * shock - 30 * limp * (1 - settle) - 6 * settle,
             sweep=MOTION.get('deathSweep', 22) * land,
             twist=-10 * limp,
             elbow=30 * limp * (1 - land) + 8 * land,
             fold_a=26 * limp * (1 - land) + 4 * land,
             fold_b=14 * limp * (1 - land))
    pitch = MOTION.get('deathPitch', 82)
    body(pose, pitch=8 - 20 * shock + (pitch - 8) * fall, roll=8 * fall,
         move=(0.02 * fall, 0, 0.04 * shock - drop * fall + bounce))
    head(pose, neck=-12 * shock + 6 * fall, head_pitch=-22 * shock - 10 * fall, yaw=MOTION.get('deathHeadYaw', 38) * fall,
         jaw=6 + 28 * shock - 10 * settle, ears=-12 * limp)
    legs(pose, swing=6 + 30 * limp, knee=10 + 45 * limp, curl=10 + 30 * limp, spread=6 * limp)
    tail(pose, lift=MOTION.get('deathTail', 45) * fall, sway=10 * fall)
    return pose


def clip_cast(t):
    # The screech: reared back, wings flung wide, jaw at full gape, a tremor through
    # everything; a slow shallow beat keeps it aloft. Periodic, so it loops.
    pose = {}
    shake = wave(t, 9)
    c = math.cos(2 * math.pi * t)
    for s in ('L', 'R'):
        wing(pose, s, flap=6 + 12 * c + 1.5 * shake, sweep=-6 + 4 * math.sin(2 * math.pi * t), twist=-6,
             elbow=-8 + 6 * max(0.0, -math.sin(2 * math.pi * t)), fold_a=-14, fold_b=-8, thumb=-10)
    body(pose, pitch=-20 + 2 * c, move=(-0.035, 0, 0.012 * -c), roll=0.8 * shake)
    head(pose, neck=-14, head_pitch=-26 + 2.5 * shake, yaw=2 * wave(t, 2), jaw=36 + 4 * shake, ears=20 + 3 * shake)
    legs(pose, swing=-10, knee=4, curl=-18 + 4 * shake)
    tail(pose, lift=14 + 3 * c)
    return pose


def clip_dive(t):
    # Wings folded back tight along the body, the body pitched into the dive, head
    # level with the line of travel; a buffeting tremor so the loop never freezes.
    pose = {}
    buff = wave(t, 4)
    for s in ('L', 'R'):
        # Flapped down past the hips (body -Z, which the pitch turns into "back"), the
        # elbow opened so the forearm trails in line, the finger fan closed so the whole wing trails as one blade.
        wing(pose, s, flap=MOTION.get('diveFlap', -108) + 3 * buff, sweep=MOTION.get('diveSweep', 0),
             twist=MOTION.get('diveTwist', 0), elbow=MOTION.get('diveElbow', -40),
             fold_a=MOTION.get('diveFoldA', 30), fold_b=MOTION.get('diveFoldB', 0))
    pitch = MOTION.get('divePitch', 62)
    body(pose, pitch=pitch + 1.5 * wave(t, 2), roll=1.5 * wave(t, 1))
    head(pose, neck=-pitch * 0.4, head_pitch=-pitch * 0.5 + 1.5 * buff, jaw=12, ears=-18)
    legs(pose, swing=MOTION.get('diveLegs', 55), knee=20, curl=24, lag=(2 * wave(t, 2), -2 * wave(t, 2, 0.3)))
    # The tail drops against the pitch so it trails straight back, not up.
    tail(pose, lift=MOTION.get('diveTail', 40), sway=2 * wave(t, 1, 0.2))
    return pose


# name: (function, seconds)
CLIPS = {
    'Idle': (clip_idle, MOTION.get('idleSeconds', 2.2)),
    'Walk': (clip_walk, MOTION.get('walkSeconds', 1.1)),
    'Run': (clip_run, MOTION.get('runSeconds', 0.8)),
    'Attack': (clip_attack, 1.0),
    'Cast': (clip_cast, 1.5),
    'Hit': (clip_hit, 0.55),
    'Death': (clip_death, 1.8),
    'Dive': (clip_dive, 1.0),
}

# ---------------------------------------------------------- floor for Death
depsgraph = bpy.context.evaluated_depsgraph_get()


def lowest(pose):
    apply_pose(pose)
    bpy.context.view_layer.update()
    ev = mesh_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    lo = min((ev.matrix_world @ v.co).z for v in me.vertices)
    hi = max((ev.matrix_world @ v.co).z for v in me.vertices)
    ev.to_mesh_clear()
    return lo, hi


# The game measures the body mid-Idle (0.5 s) and sets its lowest point `hover`
# above the floor; with hover = hoverFrac * height the floor sits hoverFrac of that
# posed height under the Idle's lowest point.
idle_lo, idle_hi = lowest(clip_idle(0.5 / CLIPS['Idle'][1]))
floor = idle_lo - MOTION.get('hoverFrac', 0.35) * (idle_hi - idle_lo)
dead_lo, _ = lowest(clip_death(1.0, drop=0.0))
DEATH_DROP[0] = dead_lo - floor
print('IDLE_BOUNDS', round(idle_lo, 4), round(idle_hi, 4), 'FLOOR', round(floor, 4), 'DEATH_DROP', round(DEATH_DROP[0], 4))

os.makedirs(OUT, exist_ok=True)
arm.animation_data_create()
ONLY = [c for c in os.environ.get('BAT_CLIPS', '').split(',') if c]
for clip, (fn, seconds) in CLIPS.items():
    if ONLY and clip not in ONLY:
        continue
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True
    arm.animation_data.action = action
    frames = max(2, round(seconds * FPS))
    prev = {}
    for f in range(frames + 1):
        apply_pose(fn(f / frames))
        for pb in arm.pose.bones:
            # Keep each track on one hemisphere so no key interpolates the long way.
            q = pb.rotation_quaternion.copy()
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[pb.name] = q
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
