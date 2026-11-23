"""Review renders and objective checks of a built Korzul .blend (authoring aid).

  blender -b korzul.blend --python review.py -- <out_dir> <mode> [args] [--knight k.glb] [+cycles]

  views                      the turnaround at Idle (front, 3/4, side, back, top, face, low) with the knight
  closeup                    the head (front, 3/4, side, roaring, breathing) and the chest shard
  sheet  Clip,Clip [N]       N evenly spaced frames per clip (prefix_<Clip>_<i>.png)
  frames Clip:t,Clip:t       stills at times in seconds
  video  Clip                every frame of a clip (for the MP4s)
  checks [Clip,Clip]         the objective gate: ground penetration, planted-foot slide,
                             joint pops, TREMOR (jitter.py, every animated bone), limb
                             ROLL (abs and per-frame step)
  probe  Clip:t,...          anchor positions at times
"""
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig as R  # noqa: E402
import stage  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:]
out, mode = os.path.abspath(argv[0]), argv[1]
rest = list(argv[2:])


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Korzul'))
meshes = [o for o in scene.objects if o.type == 'MESH' and o.parent == arm]
body = next(o for o in meshes if o.name == 'Korzul')
shed = next((o for o in meshes if o.name == 'KorzulShedIce'), None)
for o in scene.objects:
    if o.name.endswith('_hi') or '_hi.' in o.name:
        o.hide_render = True
NEEDS_STAGE = mode in ('views', 'closeup', 'sheet', 'frames', 'video')
if NEEDS_STAGE:
    cam = stage.setup(knight=opt('--knight'), engine='CYCLES' if '+cycles' in rest else 'EEVEE',
                      res=(int(opt('--w', 1280)), int(opt('--h', 860))), ref_height=float(opt('--refh', 2.6)),
                      sky=(0.2, 0.24, 0.32))
    if '+cycles' in rest:
        scene.cycles.samples = int(opt('--samples', 48))
SHED_CLIPS = ('Frozen', 'FrozenAwaken', 'BreakFree')


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    if shed is not None:
        shed.hide_render = name not in SHED_CLIPS
    f0, f1 = act.frame_range
    f = f0 + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def bone_world(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def clip_frame(name):
    """A fixed camera focus and distance that hold the whole clip."""
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    zs = []
    for f in range(f0, f1 + 1, 3):
        scene.frame_set(f)
        zs.append(bone_world('Chest').z)
    zc = 0.5 * (min(zs) + max(zs))
    span = max(zs) - min(zs)
    return (0.0, 2.0, max(8.0, zc - 1.5)), 84.0 + span * 1.6


if mode == 'views':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
        stage.aim(cam, az, el, dist, focus, lens)
        stage.still(os.path.join(out, f'{name}.png'))
elif mode == 'closeup':
    for clip, t, tag in (('Idle', 0.5, ''), ('Roar', 1.15, '_roar'), ('BreathGround', 2.4, '_breath')):
        if clip not in bpy.data.actions:
            continue
        act_time(clip, t)
        head = arm.pose.bones['Head']
        c = arm.matrix_world @ (head.head * 0.45 + head.tail * 0.55)
        for name, az, el, dist, dz, lens in (('head_front', 0, 6, 15.0, 0.4, 50), ('head_threeq', 38, 10, 15.5, 0.4, 50),
                                              ('head_side', 88, 4, 16.0, 0.2, 45)):
            if tag and name != 'head_threeq':
                continue
            stage.aim(cam, az, el, dist, (c.x, c.y, c.z + dz), lens)
            stage.still(os.path.join(out, f'{name}{tag}.png'))
    act_time('Idle', 0.5)
    c = bone_world('Shard')
    stage.aim(cam, 22, 4, 14.0, (c.x, c.y - 0.5, c.z + 0.6), 45)
    stage.still(os.path.join(out, 'pecho_esquirla.png'))
    c = bone_world('L_Forearm', tail=True)
    stage.aim(cam, 50, 8, 12.0, (c.x, c.y, c.z + 0.6), 45)
    stage.still(os.path.join(out, 'grillete_cadena.png'))
elif mode in ('sheet', 'frames', 'video'):
    az = float(opt('--az', 35))
    el = float(opt('--el', 10))
    if mode == 'sheet':
        clips = rest[0].split(',')
        n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 8
        prefix = opt('--prefix', 'korzul')
        for c in clips:
            focus, dist = clip_frame(c)
            act = bpy.data.actions[c]
            dur = (act.frame_range[1] - act.frame_range[0]) / R.FPS
            for i in range(n):
                t = dur * i / max(1, n - 1)
                act_time(c, t)
                stage.aim(cam, az, el, dist, focus, 45)
                stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
    elif mode == 'frames':
        for spec in rest[0].split(','):
            c, t = spec.split(':')
            focus, dist = clip_frame(c)
            act_time(c, float(t))
            stage.aim(cam, az, el, float(opt('--dist', dist)), focus, 45)
            stage.still(os.path.join(out, f'{c}_{float(t):.2f}.png'))
    else:
        c = rest[0]
        focus, dist = clip_frame(c)
        act = bpy.data.actions[c]
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        stage.aim(cam, az, el, dist, focus, 45)
        for i, f in enumerate(range(f0, f1 + 1)):
            act_time(c, (f - f0) / R.FPS)
            stage.still(os.path.join(out, f'{c}_{i:04d}.png'))
elif mode == 'probe':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        rows = []
        for b in ('Mouth', 'Shard', 'Head', 'L_WingTip', 'R_WingTip', 'TailTip', 'ChainFLEnd', 'ChainNkEnd', 'Root',
                  'L_FToes', 'R_FToes', 'L_HToes', 'R_HToes'):
            p = bone_world(b)
            rows.append(f'{b}=({p.x:.2f},{p.y:.2f},{p.z:.2f})')
        print('PROBE', c, t, ' '.join(rows))
elif mode == 'checks':
    import numpy as np
    import jitter as J
    names = rest[0].split(',') if rest and not rest[0].startswith('-') else [
        a.name for a in bpy.data.actions if a.get('duration')]
    SPRING = ('Chain', 'Belly', 'Tail10', 'Tail11', 'Tail12', 'TailTip', 'IceShed')
    AIR = ('TakeOff', 'FlyIdle', 'FlyForward', 'BreathAir', 'Land')
    SINK = ('Death', 'Frozen', 'FrozenAwaken')
    LIM_ABS = {'UpperArm': 60.0, 'Forearm': 60.0, 'Thigh': 60.0, 'Shin': 60.0, 'Hand': 70.0, 'Foot': 70.0}
    LIM_STEP = 14.0
    POP_LIMIT = 24.0          # degrees a bone may turn in one frame (armature space)
    WING_POP_LIMIT = 32.0     # the ends of a 25-yard wing unfurling
    TREMOR_LIMIT = J.TREMOR_LIMIT
    bones = [pb for pb in arm.pose.bones if not pb.name.startswith(SPRING)]
    gname = {g.index: g.name for g in body.vertex_groups}
    low_grp = ''
    fails = 0
    for c in names:
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        minz, minz_t = 99.0, 0.0
        worst_pop, pop_bone, pop_t = 0.0, '', 0.0
        series = {pb.name: [] for pb in bones}
        roll_abs, roll_step, prev_tw = {}, {}, {}
        feet = {b: [] for b in ('L_FToes', 'R_FToes', 'L_HToes', 'R_HToes')}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            t = (f - f0) / R.FPS
            if (f - f0) % 3 == 0 and c not in SINK:
                dg = bpy.context.evaluated_depsgraph_get()
                ev = body.evaluated_get(dg)
                co = np.empty(len(ev.data.vertices) * 3)
                ev.data.vertices.foreach_get('co', co)
                co = co.reshape(-1, 3)
                iz = int(np.argmin(co[:, 2]))
                mz = float(co[iz, 2])
                if mz < minz:
                    minz, minz_t = mz, t
                    vg = body.data.vertices[iz].groups
                    low_grp = gname[max(vg, key=lambda g: g.weight).group] if len(vg) else '?'
            for pb in bones:
                q = pb.matrix.to_quaternion()
                s = series[pb.name]
                if s:
                    ang = math.degrees(s[-1].rotation_difference(q).angle)
                    ang = min(ang, 360 - ang)
                    if ang > worst_pop:
                        worst_pop, pop_bone, pop_t = ang, pb.name, t
                s.append(q)
            for side in ('L_', 'R_'):
                for b in LIM_ABS:
                    pb = arm.pose.bones[side + b]
                    q = pb.rotation_quaternion
                    tw = math.degrees(2 * math.atan2(q.y, q.w))
                    tw = (tw + 180) % 360 - 180
                    key = side + b
                    if abs(tw) > abs(roll_abs.get(key, (0, 0))[0]):
                        roll_abs[key] = (tw, t)
                    if key in prev_tw:
                        d = abs((tw - prev_tw[key] + 180) % 360 - 180)
                        if d > roll_step.get(key, (0, 0))[0]:
                            roll_step[key] = (d, t)
                    prev_tw[key] = tw
            for fb in feet:
                feet[fb].append(bone_world(fb))
        slide = []
        for fb, pts in feet.items():
            for a, b in zip(pts, pts[1:]):
                if a.z < 0.66 and b.z < 0.66:
                    slide.append((b - a).length * R.FPS)
        sl = max(slide) if slide else 0.0
        tremor, tr_bone, tr_t = 0.0, '', 0.0
        for b, qs in series.items():
            _, _, tr, tf = J.rotation_jitter(qs)
            if tr > tremor:
                tremor, tr_bone, tr_t = tr, b, tf / R.FPS
        bad = []
        if c not in AIR and c not in SINK and minz < -0.4:
            bad.append(f'GROUND {minz:.2f}@{minz_t:.2f}:{low_grp}')
        wing_bone = pop_bone[2:].startswith(('F1', 'F2', 'F3', 'F4', 'WingTip', 'WHand', 'Thumb'))
        if worst_pop > (WING_POP_LIMIT if wing_bone else POP_LIMIT):
            bad.append(f'POP {pop_bone} {worst_pop:.0f}@{pop_t:.2f}')
        if tremor > TREMOR_LIMIT:
            bad.append(f'TREMOR {tr_bone} {tremor:.1f}@{tr_t:.2f}')
        for k, (v, t) in roll_abs.items():
            if abs(v) > LIM_ABS[k[2:]]:
                bad.append(f'{k} roll {v:.0f}@{t:.2f}')
        for k, (v, t) in roll_step.items():
            if v > LIM_STEP:
                bad.append(f'{k} roll-step {v:.0f}@{t:.2f}')
        fails += bool(bad)
        print(f'CHECK {c:13s} n={f1 - f0 + 1:3d} minz={minz:6.2f} pop={worst_pop:5.1f}@{pop_bone} '
              f'tremor={tremor:4.2f}@{tr_bone} slide={sl:5.2f} {"OK" if not bad else "FAIL " + "; ".join(bad)}')
    print('CHECKS_FAILED', fails)
print('REVIEW_DONE', mode)
