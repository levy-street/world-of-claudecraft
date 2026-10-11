"""Review renders and objective checks of a built trash creature .blend (authoring
aid; nothing here ships).

  blender -b x.blend --python review.py -- <out_dir> <mode> [args] [--knight k.glb] [+cycles]

  views                 front, side, three-quarter, back, low, at Idle, the knight beside it
  closeup               the head and the weapon hand, lit close
  sheet Clip,Clip [N]   N frames per clip (prefix_<Clip>_<i>.png)
  frames Clip:t,..      stills at times
  video Clip            every frame of a clip
  analyze [Clips]       per clip: lowest vertex, joint pops, planted-foot speed
  checks [Clips]        per clip: tremor (every limb bone), arm roll, weapon lock,
                        weapon above the ice, seams against Idle's first frame

The creature's builder dir must be on sys.path first (its anatomy.py names the
bones the checks read). Framing comes from the Idle bounds.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:]
out, mode = argv[0], argv[1]
rest = list(argv[2:])


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


if opt('--builder'):
    sys.path.insert(0, opt('--builder'))
sys.path.insert(1, HERE)
import rig as R  # noqa: E402
import stage  # noqa: E402

scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and not o.name.startswith('Knight'))
meshes = [o for o in scene.objects if o.type == 'MESH' and o.parent == arm]
body = max(meshes, key=lambda o: len(o.data.vertices))
for o in scene.objects:
    if o.name.endswith('_hi'):
        o.hide_render = True


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f0 = act.frame_range[0]
    f = f0 + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def bounds():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        Mw = np.array(m.matrix_world)
        pts.append(co @ Mw[:3, :3].T + Mw[:3, 3])
    P = np.concatenate(pts)
    return P.min(axis=0), P.max(axis=0)


if mode in ('views', 'closeup', 'sheet', 'frames', 'video'):
    act_time('Idle', 0.0)
    lo, hi = bounds()
    H = float(hi[2] - lo[2])
    span = float(max(hi[0] - lo[0], hi[1] - lo[1], H))
    ref_x = float(lo[0]) - 1.6
    knight_at = (float(opt('--kx', ref_x)), float(opt('--ky', 0.0)), 0.0)
    cam = stage.setup(knight=opt('--knight'), engine='CYCLES' if '+cycles' in rest else 'EEVEE',
                      res=(int(opt('--w', 1280)), int(opt('--h', 960))), ref_at=knight_at,
                      ref_height=2.6 * H / float(opt('--drawn')) if opt('--drawn') else 2.6,
                      sky=(0.16, 0.2, 0.26))
    if '+cycles' in rest:
        scene.cycles.samples = int(opt('--samples', 48))
    cx = (float(lo[0]) + float(hi[0]) + knight_at[0] - 0.4) / 2 if opt('--knight') else 0.0
    focus = Vector((cx * 0.5, 0.0, H * 0.48))
    dist = float(opt('--dist', span * 1.75 + 1.5))


def framing(az, el=8, d=None, f=None, lens=45):
    stage.aim(cam, az, el, d or dist, f or focus, lens)


if mode == 'views':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.0)))
    for name, az, el in (('front', 0, 6), ('threeq', 38, 10), ('side', 90, 6), ('back', 180, 8),
                         ('threeq_back', 215, 12)):
        framing(az, el)
        stage.still(os.path.join(out, f'{name}.png'))
    framing(30, -6, dist * 0.62, Vector((focus.x, focus.y, H * 0.55)), 28)
    stage.still(os.path.join(out, 'low.png'))
elif mode == 'closeup':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.0)))
    hb = opt('--head', 'Head')
    c = arm.matrix_world @ arm.pose.bones[hb].head
    hd = float(opt('--hd', 1.0))
    for name, az, el, d in (('head_front', 0, 4, 2.4), ('head_threeq', 35, 8, 2.6), ('head_side', 85, 4, 2.8)):
        stage.aim(cam, az, el, d * hd, (c.x, c.y - 0.1 * hd, c.z + 0.18 * hd), 50)
        stage.still(os.path.join(out, f'{name}.png'))
    for b in (opt('--hand', 'R_Hand'), opt('--hand2', 'L_Hand')):
        if b not in arm.pose.bones:
            continue
        c = arm.matrix_world @ arm.pose.bones[b].tail
        stage.aim(cam, 30 if b.startswith('L') else -30, 10, 3.0 * hd, (c.x, c.y, c.z), 45)
        stage.still(os.path.join(out, f'hand_{b}.png'))
    stage.aim(cam, 25, 22, dist * 0.33, Vector((focus.x, focus.y, H * 0.2)), 45)
    stage.still(os.path.join(out, 'feet.png'))
elif mode == 'sheet':
    clips = rest[0].split(',')
    n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 6
    prefix = opt('--prefix', 'clip')
    az = float(opt('--az', 35))
    for c in clips:
        act = bpy.data.actions[c]
        dur = float(act.get('duration', (act.frame_range[1] - act.frame_range[0]) / R.FPS))
        for i in range(n):
            t = dur * i / (n - 1) if n > 1 else 0.0
            if act.get('loop'):
                t = dur * i / n
            act_time(c, t)
            framing(az, 10)
            stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
elif mode == 'frames':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        framing(float(opt('--az', 35)), float(opt('--el', 10)))
        stage.still(os.path.join(out, f'{c}_{float(t):.2f}.png'))
elif mode == 'video':
    c = rest[0]
    act = bpy.data.actions[c]
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    framing(float(opt('--az', 35)), 10)
    for i, f in enumerate(range(f0, f1 + 1)):
        scene.frame_set(f)
        stage.still(os.path.join(out, f'{c}_{i:04d}.png'))


# ------------------------------------------------------------------ objective checks
def clip_names():
    if rest and not rest[0].startswith('-'):
        return rest[0].split(',')
    return sorted(a.name for a in bpy.data.actions if a.get('duration') is not None)


def world_verts():
    dg = bpy.context.evaluated_depsgraph_get()
    out_ = []
    for m in meshes:
        ev = m.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', co)
        out_.append(co.reshape(-1, 3))
    return np.concatenate(out_)


if mode == 'analyze':
    import anatomy as A
    feet = [b for b in getattr(A, 'FEET', ('L_Foot', 'R_Foot')) if b in arm.pose.bones]
    sole = getattr(A, 'SOLE_Z', 0.2)
    for c in clip_names():
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        minz, minz_t, worst_pop, pop_bone, pop_t = 99.0, 0.0, 0.0, '', 0.0
        low_who = '?'
        prevq = {}
        track = {b: [] for b in feet}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            t = (f - f0) / R.FPS
            co = world_verts()
            mz = float(co[:, 2].min())
            if mz < minz:
                minz, minz_t = mz, t
                j = int(co[:, 2].argmin())
                low_who = '?'
                acc = 0
                for m in meshes:
                    nv = len(m.data.vertices)
                    if j < acc + nv:
                        v = m.data.vertices[j - acc]
                        if v.groups:
                            g = max(v.groups, key=lambda gg: gg.weight)
                            low_who = m.vertex_groups[g.group].name
                        break
                    acc += nv
            for pb in arm.pose.bones:
                q = pb.matrix.to_quaternion()
                if pb.name in prevq:
                    ang = math.degrees(prevq[pb.name].rotation_difference(q).angle)
                    ang = min(ang, 360 - ang)
                    skip = pb.name.startswith(tuple(getattr(A, 'POP_SKIP', ('Tab',))))
                    if ang > worst_pop and not skip:
                        worst_pop, pop_bone, pop_t = ang, pb.name, t
                prevq[pb.name] = q
            for b in feet:
                pb = arm.pose.bones[b]
                track[b].append((pb.head.copy(), pb.tail.copy()))
        loop = bool(act.get('loop'))
        speeds = []
        for b, pts in track.items():
            for (h0, t0), (h1, t1) in zip(pts, pts[1:]):
                # planted: the foot bone's head (ankle) near its rest height and the toe end down
                if h0.z < sole + 0.03 and h1.z < sole + 0.03 and t0.z < sole and t1.z < sole:
                    speeds.append(((h1 - h0).length * R.FPS, (Vector((h1.x, h1.y, 0)) - Vector((h0.x, h0.y, 0)))))
        if speeds:
            sp = [s for s, _ in speeds]
            slide = f'planted_speed=[{min(sp):.2f},{max(sp):.2f}] n={len(sp)}'
        else:
            slide = 'planted_speed=-'
        print(f'ANALYZE {c:14s} loop={int(loop)} minz={minz:6.3f}@{minz_t:4.2f}({low_who}) pop={worst_pop:5.1f}@{pop_bone}@{pop_t:4.2f}'
              f' {slide}', flush=True)

if mode == 'checks':
    import anatomy as A
    import jitter as J
    limb = [b.name for b in arm.pose.bones if any(k in b.name for k in getattr(
        A, 'TREMOR_KEYS', ('Clavicle', 'UpperArm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Foot', 'Spine', 'Neck', 'Head')))]
    J.BONES = tuple(limb)
    LIM = getattr(A, 'ROLL_GATE', {'UpperArm': 80.0, 'Forearm': 75.0, 'Hand': 75.0})
    has_weapon = 'Weapon' in arm.pose.bones
    act_time('Idle', 0.0)
    seam_bones = [b for b in arm.pose.bones.keys() if any(k in b for k in ('UpperArm', 'Forearm', 'Hand', 'Spine',
                                                                             'Thigh', 'Shin', 'Head', 'Root'))]
    idle0 = {b: arm.pose.bones[b].matrix.to_quaternion() for b in seam_bones}
    fails = 0
    for c in clip_names():
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        worst_roll, worst_step, lock, tipz = {}, {}, 0.0, 9.0
        prev = {}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            t = (f - f0) / R.FPS
            for side in ('L_', 'R_'):
                for b, lim in LIM.items():
                    if side + b not in arm.pose.bones:
                        continue
                    q = arm.pose.bones[side + b].rotation_quaternion
                    tw = math.degrees(2 * math.atan2(q.y, q.w))
                    tw = (tw + 180) % 360 - 180
                    key = side + b
                    if abs(tw) > abs(worst_roll.get(key, (0, 0))[0]):
                        worst_roll[key] = (tw, t)
                    if key in prev:
                        d = abs((tw - prev[key] + 180) % 360 - 180)
                        if d > worst_step.get(key, (0, 0))[0]:
                            worst_step[key] = (d, t)
                    prev[key] = tw
            if has_weapon:
                pb = arm.pose.bones['Weapon']
                lock = max(lock, math.degrees(pb.rotation_quaternion.rotation_difference((1, 0, 0, 0)).angle),
                           pb.location.length * 100)
                ax = Vector(A.WEAPON_AXIS)
                Mw = pb.matrix @ pb.bone.matrix_local.inverted()
                for u in getattr(A, 'WEAPON_PROBES', (-0.5, 1.0, 2.0)):
                    p = Mw @ (Vector(A.REST['Weapon'][0]) + ax * u)
                    tipz = min(tipz, p.z)
        bad = []
        for k, (v, t) in worst_roll.items():
            if abs(v) > LIM[k[2:]]:
                bad.append(f'{k} roll {v:.0f}@{t:.2f}')
        step_gate = 14.0 if act.get('loop') else 30.0
        for k, (v, t) in worst_step.items():
            if v > step_gate:
                bad.append(f'{k} roll-step {v:.0f}@{t:.2f}')
        jit = J.clip_jitter(scene, arm, act)
        if jit['tremor'] > J.TREMOR_LIMIT:
            bad.append(f"TREMOR {jit['bone']} {jit['tremor']:.1f}@{jit['t']:.2f}")
        if has_weapon and lock > 0.5:
            bad.append(f'WEAPON MOVES IN THE FIST {lock:.2f}')
        if has_weapon and tipz < -0.02 and c != 'Death':
            bad.append(f'weapon under the ice {tipz:.2f}')
        seams = []
        if not act.get('loop'):
            for edge in ('start', 'end'):
                if edge == 'end' and c in getattr(A, 'FREE_END', ('Death',)):
                    continue
                if edge == 'start' and c in getattr(A, 'FREE_START', ()):
                    continue
                tt = 0.0 if edge == 'start' else float(act['duration'])
                act_time(c, tt)
                gap = max(math.degrees(arm.pose.bones[b].matrix.to_quaternion().rotation_difference(idle0[b]).angle)
                          for b in seam_bones)
                gap = min(gap, 360 - gap)
                seams.append(f'{edge}={gap:.1f}')
                if gap > 3.0:
                    bad.append(f'seam {edge} {gap:.1f}')
        fails += bool(bad)
        ua = max([abs(v) for k, (v, _) in worst_roll.items() if 'UpperArm' in k] or [0])
        print(f'CHECK {c:14s} {"FAIL" if bad else "ok  "} tremor={jit["tremor"]:4.2f}@{jit["bone"] or "-"} '
              f'maxAccel={jit["max_accel"]:5.1f} upperRoll={ua:4.0f} weaponLock={lock:.3f} weaponMinZ={tipz:5.2f} '
              f'{" ".join(seams)} {"; ".join(bad)}', flush=True)
    print('CHECK_FAILS', fails)
print('REVIEW_DONE', mode)
