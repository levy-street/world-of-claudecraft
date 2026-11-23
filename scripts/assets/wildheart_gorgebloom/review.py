"""Review renders and objective checks of a built Gorgebloom .blend (authoring aid).

  blender -b gorgebloom.blend --python review.py -- <out_dir> <mode> [args] [--knight k.glb] [+cycles]

  views                      the turnaround at Idle (front, 3/4, side, back, face, low) with the knight
  closeup                    the maw (rest, roar, gorge), a pollen sac, the lash club, the roots
  sheet  Clip,Clip [N]       N evenly spaced frames per clip (prefix_<Clip>_<i>.png)
  frames Clip:t,Clip:t       stills at times in seconds
  video  Clip                every frame of a clip (for the MP4s)
  analyze [Clip,Clip]        vine/petal water penetration, joint pops, the anchors at the contact frames
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
out, mode = argv[0], argv[1]
rest = list(argv[2:])


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Gorgebloom'))
body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm)
for o in scene.objects:
    if o.name.endswith('_hi') or '_hi.' in o.name:
        o.hide_render = True
NEEDS_STAGE = mode in ('views', 'closeup', 'sheet', 'frames', 'video')
if NEEDS_STAGE:
    cam = stage.setup(knight=opt('--knight'), engine='CYCLES' if '+cycles' in rest else 'EEVEE',
                      res=(int(opt('--w', 1280)), int(opt('--h', 860))), ref_height=float(opt('--refh', 2.6)),
                      sky=(0.24, 0.27, 0.3))
    if '+cycles' in rest:
        scene.cycles.samples = int(opt('--samples', 48))
    if mode == 'closeup':
        for o in [o for o in scene.objects if o.name.startswith('PlayerReference')]:
            bpy.data.objects.remove(o, do_unlink=True)


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f0, f1 = act.frame_range
    f = f0 + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def cam_default(az=35, el=10, dist=40, focus=(0.0, -1.0, 6.0), lens=45):
    stage.aim(cam, az, el, dist, focus, lens)


def bone_pt(name, tail=False):
    pb = arm.pose.bones[name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)


if mode == 'views':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
        stage.aim(cam, az, el, dist, focus, lens)
        stage.still(os.path.join(out, f'{name}.png'))
elif mode == 'closeup':
    for clip, t, tag in (('Idle', 0.5, ''), ('Roar', 0.85, '_roar'), ('Gorge', 1.25, '_gorge')):
        if clip not in bpy.data.actions:
            continue
        act_time(clip, t)
        c = bone_pt('MawAnchor')
        for name, az, el, dist, lens in (('maw_front', 0, 4, 9.0, 45), ('maw_threeq', 35, 10, 10.0, 45)):
            if tag and name != 'maw_threeq':
                continue
            stage.aim(cam, az, el, dist, (c.x, c.y, c.z), lens)
            stage.still(os.path.join(out, f'{name}{tag}.png'))
    act_time('Idle', 0.5)
    c = bone_pt('Sac_FL', tail=True)
    stage.aim(cam, 55, 10, 6.5, (c.x, c.y, c.z), 45)
    stage.still(os.path.join(out, 'saco_polen.png'))
    c = bone_pt('LashTip')
    stage.aim(cam, -30, 22, 6.0, (c.x, c.y, c.z + 0.3), 45)
    stage.still(os.path.join(out, 'latigo_punta.png'))
    stage.aim(cam, 20, 14, 12.0, (0.5, -3.5, 0.8), 40)
    stage.still(os.path.join(out, 'raices_restos.png'))
elif mode == 'sheet':
    clips = rest[0].split(',')
    n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 8
    prefix = opt('--prefix', 'gorgebloom')
    for c in clips:
        act = bpy.data.actions[c]
        dur = (act.frame_range[1] - act.frame_range[0]) / R.FPS
        for i in range(n):
            t = dur * i / max(1, n - 1)
            act_time(c, t)
            cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 40)))
            stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
elif mode == 'frames':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 40)))
        stage.still(os.path.join(out, f'{c}_{float(t):.2f}.png'))
elif mode == 'video':
    c = rest[0]
    act = bpy.data.actions[c]
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    cam_default(az=float(opt('--az', 35)), dist=float(opt('--dist', 40)))
    for i, f in enumerate(range(f0, f1 + 1)):
        scene.frame_set(f)
        stage.still(os.path.join(out, f'{c}_{i:04d}.png'))
elif mode == 'probe':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        rows = []
        for b in ('MawAnchor', 'Head', 'LashTip', 'Sac_FL', 'R_Vine3', 'Petal0_3'):
            p = bone_pt(b, tail=b.startswith('Petal'))
            rows.append(f'{b}=({p.x:.2f},{p.y:.2f},{p.z:.2f})')
        print('PROBE', c, t, ' '.join(rows))
elif mode == 'analyze':
    import numpy as np
    names = rest[0].split(',') if rest and not rest[0].startswith('-') else [
        a.name for a in bpy.data.actions if a.get('duration')]
    SPRING = ('Petal', 'L_Vine', 'R_Vine', 'L_BackVine', 'R_BackVine')
    for c in names:
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        worst_pop, pop_bone, pop_t = 0.0, '', 0.0
        low_vine, low_t, low_b = 99.0, 0.0, ''
        prevq = {}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            for pb in arm.pose.bones:
                q = pb.matrix.to_quaternion()
                if pb.name in prevq:
                    ang = math.degrees(prevq[pb.name].rotation_difference(q).angle)
                    ang = min(ang, 360 - ang)
                    if ang > worst_pop and not pb.name.startswith(SPRING):
                        worst_pop, pop_bone, pop_t = ang, pb.name, (f - f0) / R.FPS
                prevq[pb.name] = q
                if 'Vine' in pb.name:
                    z = (arm.matrix_world @ pb.tail).z
                    if z < low_vine and c != 'Death':
                        low_vine, low_t, low_b = z, (f - f0) / R.FPS, pb.name
        print(f'ANALYZE {c:10s} n={f1 - f0 + 1:3d} pop={worst_pop:5.1f}@{pop_bone}@{pop_t:4.2f} '
              f'lowest_vine_joint={low_vine:5.2f}@{low_b}@{low_t:4.2f}')
print('REVIEW_DONE', mode)
