"""Review renders and objective checks of a built Snarlvine Lasher / Thorn Sprout .blend (authoring aid).

  blender -b saurian.blend --python review.py -- <out_dir> <mode> [args] [--knight k.glb] [+cycles]

  views                      the turnaround at Idle (front, 3/4, side, back, face, low) with the knight
  closeup                    the head lit close (front, 3/4, side, open-mouthed at the roar)
  sheet  Clip,Clip [N]       N evenly spaced frames per clip (prefix_<Clip>_<i>.png)
  frames Clip:t,Clip:t       stills at times in seconds
  video  Clip                every frame of a clip (for the MP4s)
  analyze [Clip,Clip]        ground penetration, planted-foot slide, joint pops per clip
  probe  Clip:t,...          bone positions at times
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
out, mode = argv[0], argv[1]
rest = list(argv[2:])


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.endswith('Rig'))
NAME = arm.name[:-3]
KS = 0.5 if NAME == 'ThornSprout' else 1.0
stage.VIEW_K = KS
meshes = [o for o in scene.objects if o.type == 'MESH' and o.parent == arm]
body = next(o for o in meshes if o.name == NAME)
for o in scene.objects:
    if o.name.endswith('_hi') or '_hi.' in o.name:
        o.hide_render = True
NEEDS_STAGE = mode in ('views', 'closeup', 'sheet', 'frames', 'video')
if NEEDS_STAGE:
    cam = stage.setup(knight=opt('--knight'), ref_at=(2.3, 0.5, 0.0) if KS < 1 else (3.6, 0.9, 0.0), engine='CYCLES' if '+cycles' in rest else 'EEVEE',
                      res=(int(opt('--w', 1280)), int(opt('--h', 860))), ref_height=float(opt('--refh', 2.6)),
                      sky=(0.24, 0.27, 0.3))
    if '+cycles' in rest:
        scene.cycles.samples = int(opt('--samples', 48))


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f0, f1 = act.frame_range
    f = f0 + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def cam_default(az=35, el=10, dist=17, focus=(0.0, -1.6, 2.4), lens=45):
    stage.aim(cam, az, el, dist * KS, tuple(c * KS for c in focus), lens)


if mode == 'views':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    for name, az, el, dist, focus, lens in stage.standard_views(KS):
        stage.aim(cam, az, el, dist, focus, lens)
        stage.still(os.path.join(out, f'{name}.png'))
elif mode == 'closeup':
    for clip, t, tag in (('Idle', 0.5, ''), ('LashCast', 1.0, '_lash'), ('Bite', 0.3, '_bite'), ('Attack2', 0.36, '_stab')):
        if clip not in bpy.data.actions:
            continue
        act_time(clip, t)
        head = arm.pose.bones['Head']
        c = arm.matrix_world @ ((head.head + head.tail) * 0.5)
        for name, az, el, dist, dz, lens in (('head_front', 0, 4, 3.0, 0.0, 50), ('head_threeq', 38, 8, 3.2, 0.0, 50),
                                              ('head_side', 88, 4, 3.4, 0.0, 45)):
            if tag and name != 'head_threeq':
                continue
            stage.aim(cam, az, el, dist * KS, (c.x, c.y, c.z + dz), lens)
            stage.still(os.path.join(out, f'{name}{tag}.png'))
    act_time('Idle', 0.5)
    pb = arm.pose.bones['R_Vine3']
    c = arm.matrix_world @ pb.head
    stage.aim(cam, -40, 18, 4.2 * KS, (c.x, c.y - 0.6 * KS, c.z), 45)
    stage.still(os.path.join(out, 'brazo_latigo.png'))
    pb = arm.pose.bones['L_Foot']
    c = arm.matrix_world @ pb.head
    stage.aim(cam, 35, 14, 3.4 * KS, (c.x, c.y - 0.2 * KS, c.z - 0.1 * KS), 45)
    stage.still(os.path.join(out, 'pie_raiz.png'))
    pb = arm.pose.bones['Chest']
    c = arm.matrix_world @ pb.head
    stage.aim(cam, 150, 30, 4.6 * KS, (c.x, c.y + 0.3 * KS, c.z + 0.6 * KS), 40)
    stage.still(os.path.join(out, 'joroba_musgo.png'))
elif mode == 'sheet':
    clips = rest[0].split(',')
    n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 8
    prefix = opt('--prefix', 'lasher')
    for c in clips:
        act = bpy.data.actions[c]
        dur = (act.frame_range[1] - act.frame_range[0]) / R.FPS
        for i in range(n):
            t = dur * i / max(1, n - 1)
            act_time(c, t)
            cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 17)))
            stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
elif mode == 'frames':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 17)))
        stage.still(os.path.join(out, f'{c}_{float(t):.2f}.png'))
elif mode == 'video':
    c = rest[0]
    act = bpy.data.actions[c]
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 17)))
    for i, f in enumerate(range(f0, f1 + 1)):
        scene.frame_set(f)
        stage.still(os.path.join(out, f'{c}_{i:04d}.png'))
elif mode == 'probe':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        rows = []
        for b in ('L_Toes', 'R_Toes', 'Head', 'Jaw', 'Hips', 'R_Vine7', 'L_Vine7'):
            pb = arm.pose.bones[b]
            p = arm.matrix_world @ pb.head
            rows.append(f'{b}=({p.x:.2f},{p.y:.2f},{p.z:.2f})')
        print('PROBE', c, t, ' '.join(rows))
elif mode == 'analyze':
    import numpy as np
    names = rest[0].split(',') if rest and not rest[0].startswith('-') else sorted(
        a.name for a in bpy.data.actions if a.get('duration'))
    SPRING = ('L_Tendril', 'R_Tendril', 'BackVine', 'L_Vine5', 'L_Vine6', 'L_Vine7', 'R_Vine5', 'R_Vine6', 'R_Vine7')
    for c in names:
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        minz, worst_pop, pop_bone, minz_t, pop_t = 99.0, 0.0, '', 0.0, 0.0
        prevq = {}
        feet = {b: [] for b in ('L_Toes', 'R_Toes')}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            if (f - f0) % 2 == 0:
                dg = bpy.context.evaluated_depsgraph_get()
                ev = body.evaluated_get(dg)
                co = np.empty(len(ev.data.vertices) * 3)
                ev.data.vertices.foreach_get('co', co)
                mz = float(co.reshape(-1, 3)[:, 2].min())
                if mz < minz:
                    minz, minz_t = mz, (f - f0) / R.FPS
            for pb in arm.pose.bones:
                q = pb.matrix.to_quaternion()
                if pb.name in prevq:
                    ang = math.degrees(prevq[pb.name].rotation_difference(q).angle)
                    ang = min(ang, 360 - ang)
                    if ang > worst_pop and not pb.name.startswith(SPRING):
                        worst_pop, pop_bone, pop_t = ang, pb.name, (f - f0) / R.FPS
                prevq[pb.name] = q
            for fb in feet:
                feet[fb].append(arm.pose.bones[fb].head.copy())
        slide = []
        for fb, pts in feet.items():
            for a, b in zip(pts, pts[1:]):
                if a.z < 0.2 * KS and b.z < 0.2 * KS:
                    slide.append((b - a).length * R.FPS)
        sl = (min(slide), max(slide)) if slide else (0, 0)
        print(f'ANALYZE {c:12s} n={f1 - f0 + 1:3d} minz={minz:6.2f}@{minz_t:4.2f} pop={worst_pop:5.1f}@{pop_bone}@{pop_t:4.2f} '
              f'planted_speed=[{sl[0]:.2f},{sl[1]:.2f}]')
print('REVIEW_DONE', mode)
