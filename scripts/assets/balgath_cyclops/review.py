"""Review renders of a built Balgath .blend (authoring aid; nothing here ships).

  blender -b balgath.blend --python review.py -- <out_dir> <mode> [args] [--knight k.glb] [+cycles]

  views                      the standard turnaround at Idle (front, 3/4, side, back, face, low)
  sheet  Clip,Clip [N]       N evenly spaced frames per clip (prefix_<Clip>_<i>.png)
  frames Clip:t,Clip:t       stills at times in seconds
  video  Clip [W]            every frame of a clip (for the MP4s)
  closeup                    the face and the eye, lit close
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
rest = [a for a in argv[2:]]


def opt(name, default=None):
    return rest[rest.index(name) + 1] if name in rest else default


scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE' and o.name.startswith('Balgath'))
for o in scene.objects:
    if '_hi' in o.name:
        o.hide_render = True
cam = stage.setup(knight=opt('--knight'), engine='CYCLES' if '+cycles' in rest else 'EEVEE',
                  res=(int(opt('--w', 1280)), int(opt('--h', 960))), ref_height=float(opt('--refh', 2.6)))
if '+cycles' in rest:
    scene.cycles.samples = int(opt('--samples', 48))


def act_time(name, t):
    act = bpy.data.actions[name]
    R.set_action(arm, act)
    f0, f1 = act.frame_range
    f = f0 + t * R.FPS
    scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def cam_default(az=32, el=9, dist=42, focus=(1.5, 0, 6.6), lens=45):
    stage.aim(cam, az, el, dist, focus, lens)


if mode == 'views':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    for name, az, el, dist, focus, lens in stage.STANDARD_VIEWS:
        stage.aim(cam, az, el, dist, focus, lens)
        stage.still(os.path.join(out, f'{name}.png'))
elif mode == 'closeup':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    head = arm.pose.bones['Head']
    c = arm.matrix_world @ head.head
    for name, az, el, dist, dz, lens in (('face_front', 0, 3, 6.0, 0.6, 50), ('face_threeq', 35, 6, 6.5, 0.5, 50),
                                          ('eye', 8, 2, 3.0, 0.95, 60), ('face_side', 85, 4, 7.0, 0.5, 45)):
        stage.aim(cam, az, el, dist, (c.x, c.y - 1.0, c.z + dz), lens)
        stage.still(os.path.join(out, f'{name}.png'))
elif mode == 'hands':
    act_time(opt('--clip', 'Idle'), float(opt('--t', 0.5)))
    for side in ('L_', 'R_'):
        pb = arm.pose.bones[side + 'Hand']
        c = arm.matrix_world @ pb.tail
        stage.aim(cam, 35 if side == 'L_' else -35, 8, 9.0, (c.x, c.y, c.z + 0.6), 45)
        stage.still(os.path.join(out, f'hand_{side[0]}.png'))
    pb = arm.pose.bones['L_Foot']
    c = arm.matrix_world @ pb.tail
    stage.aim(cam, 25, 14, 8.0, (c.x, c.y + 0.6, c.z + 0.5), 45)
    stage.still(os.path.join(out, 'foot_L.png'))
elif mode == 'sheet':
    clips = rest[0].split(',')
    n = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 4
    prefix = opt('--prefix', 'balgath')
    az = float(opt('--az', 32))
    for c in clips:
        act = bpy.data.actions[c]
        dur = (act.frame_range[1] - act.frame_range[0]) / R.FPS
        for i in range(n):
            t = dur * (i + 0.5) / n if n > 1 else dur / 2
            act_time(c, t)
            cam_default(az=az, dist=float(opt('--dist', 34)), focus=(1.0, 0, 6.2))
            stage.still(os.path.join(out, f'{prefix}_{c}_{i}.png'))
elif mode == 'frames':
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        cam_default(az=float(opt('--az', 32)), dist=float(opt('--dist', 44)))
        stage.still(os.path.join(out, f'{c}_{float(t):.2f}.png'))
elif mode == 'video':
    c = rest[0]
    act = bpy.data.actions[c]
    R.set_action(arm, act)
    f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
    cam_default(az=float(opt('--az', 32)), dist=float(opt('--dist', 44)), focus=(1.0, 0, 6.4))
    for i, f in enumerate(range(f0, f1 + 1)):
        scene.frame_set(f)
        stage.still(os.path.join(out, f'{c}_{i:04d}.png'))
print('REVIEW_DONE', mode)

if mode == 'probe':
    # world positions of the fists, feet and head at chosen times (contract checks)
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        rows = []
        for b in ('L_Hand', 'R_Hand', 'L_Foot', 'R_Foot', 'Head', 'Hips'):
            pb = arm.pose.bones[b]
            p = arm.matrix_world @ (pb.tail if 'Hand' in b else pb.head)
            rows.append(f'{b}=({p.x:.2f},{p.y:.2f},{p.z:.2f})')
        print('PROBE', c, t, ' '.join(rows))

if mode == 'analyze':
    # Objective checks per clip: ground penetration, planted-foot slide, joint pops.
    import numpy as np
    body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm)
    names = rest[0].split(',') if rest and not rest[0].startswith('--') else sorted(
        a.name for a in bpy.data.actions if a.get('duration'))
    for c in names:
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        minz, worst_pop, pop_bone, minz_t, pop_t = 99.0, 0.0, '', 0.0, 0.0
        prevq = {}
        feet = {'L_Foot': [], 'R_Foot': []}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            if (f - f0) % 3 == 0:
                dg = bpy.context.evaluated_depsgraph_get()
                ev = body.evaluated_get(dg)
                n = len(ev.data.vertices)
                co = np.empty(n * 3)
                ev.data.vertices.foreach_get('co', co)
                mz = float(co.reshape(-1, 3)[:, 2].min())
                if mz < minz:
                    minz, minz_t = mz, (f - f0) / R.FPS
            for pb in arm.pose.bones:
                q = pb.matrix.to_quaternion()
                if pb.name in prevq:
                    ang = math.degrees(prevq[pb.name].rotation_difference(q).angle)
                    ang = min(ang, 360 - ang)
                    if ang > worst_pop and not pb.name.startswith(('Loin', 'Tally', 'R_Chain', 'Belly')):
                        worst_pop, pop_bone, pop_t = ang, pb.name, (f - f0) / R.FPS
                prevq[pb.name] = q
            for fb in feet:
                feet[fb].append(arm.pose.bones[fb].head.copy())
        slide = []
        for fb, pts in feet.items():
            for a, b in zip(pts, pts[1:]):
                if a.z < 1.02 and b.z < 1.02:
                    slide.append((b - a).length * R.FPS)
        sl = (min(slide), max(slide)) if slide else (0, 0)
        print(f'ANALYZE {c:22s} n={f1 - f0 + 1:3d} minz={minz:6.2f}@{minz_t:4.2f} pop={worst_pop:5.1f}@{pop_bone}@{pop_t:4.2f} '
              f'planted_speed=[{sl[0]:.2f},{sl[1]:.2f}]')

if mode == 'lowest':
    import numpy as np
    body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm)
    gname = {g.index: g.name for g in body.vertex_groups}
    for spec in rest[0].split(','):
        c, t = spec.split(':')
        act_time(c, float(t))
        dg = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(dg)
        zs = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', zs)
        zs = zs.reshape(-1, 3)
        order = np.argsort(zs[:, 2])[:400:40]
        out = []
        for i in order:
            v = body.data.vertices[int(i)]
            g = max(v.groups, key=lambda gg: gg.weight) if v.groups else None
            out.append(f'{zs[i, 2]:.2f}:{gname[g.group] if g else "?"}')
        print('LOWEST', c, t, ' '.join(out))

if mode == 'rot':
    # per-frame rotation steps of a bone chain around a time window
    c, t0, t1 = rest[0], float(rest[1]), float(rest[2])
    bones = rest[3].split(',')
    act = bpy.data.actions[c]
    R.set_action(arm, act)
    prev = {}
    f = act.frame_range[0] + t0 * R.FPS
    while f <= act.frame_range[0] + t1 * R.FPS:
        scene.frame_set(int(f))
        row = []
        for b in bones:
            q = arm.pose.bones[b].matrix.to_quaternion()
            if b in prev:
                a = math.degrees(prev[b].rotation_difference(q).angle)
                row.append(f'{b}:{min(a, 360 - a):5.1f}')
            prev[b] = q
        print('ROT', int(f), ' '.join(row))
        f += 1

if mode == 'checks':
    # Objective arm checks per clip (authoring gate):
    #  * TREMOR: the zig-zag part of each arm bone's angular acceleration, frame to
    #    frame (jitter.py; the shipped GLB gets the same measure from arm_jitter.mjs).
    #    A held pose must hold still: a limb flipping between two poses on alternate
    #    frames reads as a shake however small each step is.
    #  * ROLL: the twist of each arm bone about its own length, relative to its parent
    #    (swing-twist split of the keyed local rotation). Fails past an anatomical
    #    range or on a per-frame jump (the candy-wrapper and the spinning forearm).
    #  * CLEARANCE: how far the forearm, hand and lower upper arm stay from the body,
    #    measured against the sculpt's own primitives posed on their bones (the same
    #    probes the ground check uses, so it sees the real flesh, not a bone line).
    import numpy as np
    import anatomy as A
    import jitter as J
    F = A.build_body(voxel=0.15, detail=False)
    BODY = {'Hips', 'Spine1', 'Spine2', 'Belly', 'Neck', 'Head', 'Jaw', 'Brow',
            'L_Thigh', 'R_Thigh', 'L_KneeFix', 'R_KneeFix'}
    prims = {}
    for p, k in F.prims:
        if p.bone in BODY:
            prims.setdefault(p.bone, []).append(p)
    body = next(o for o in scene.objects if o.type == 'MESH' and o.parent == arm)
    gname = {g.index: g.name for g in body.vertex_groups}
    ARM_BONES = ('Forearm', 'ElbowFix', 'Hand', 'Index1', 'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2',
                 'Thumb1', 'Thumb2', 'UpperArm')
    sel = {'L_': [], 'R_': []}
    TORSO_W = {'Spine1', 'Spine2', 'Belly', 'Hips', 'Neck', 'L_Clavicle', 'R_Clavicle'}
    for v in body.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda gg: gg.weight)
        n = gname[g.group]
        side, rest_name = n[:2], n[2:]
        # skin shared with the torso (the armpit folds, the junction over the pec and
        # the lat) bunches when the arm moves; it cannot pass inside the torso it is
        # part of, so only skin that is purely arm is measured
        if any(gname[gg.group] in TORSO_W and gg.weight >= 0.05 for gg in v.groups):
            continue
        if side in sel and rest_name in ARM_BONES:
            if rest_name == 'UpperArm':
                sh = A.SHOULDER if side == 'L_' else A.mirror(A.SHOULDER)
                if np.linalg.norm(np.array(v.co) - sh) < 2.0:   # deltoid and armpit
                    continue
            sel[side].append(v.index)
    # The inner upper arm presses on the chest wall and the lat in a forward crouch
    # (the closed armpit): that compression is allowed up to ARMPIT_ALLOW. The
    # forearm, elbow, hand and fingers must stay clear outright.
    ARMPIT_ALLOW = 0.45
    def upper_region(i):
        # the upper arm and the inner fold of the elbow (at least 40% upper arm)
        for g in body.data.vertices[i].groups:
            if gname[g.group].endswith('UpperArm') and g.weight >= 0.4:
                return True
        return False
    upper = {sd: np.array([upper_region(i) for i in ix]) for sd, ix in sel.items()}
    LIM_ABS = {'UpperArm': 80.0, 'Forearm': 75.0, 'Hand': 75.0}
    LIM_STEP = 14.0
    names = rest[0].split(',') if rest and not rest[0].startswith('-') else sorted(
        a.name for a in bpy.data.actions if a.get('duration'))
    fails = 0
    for c in names:
        act = bpy.data.actions[c]
        R.set_action(arm, act)
        f0, f1 = int(act.frame_range[0]), int(math.ceil(act.frame_range[1]))
        worst_abs, worst_step, worst_clear = {}, {}, (9.0, '', 0.0)
        worst_vert = [None]
        worst_arm = (9.0, '', 0.0)
        worst_vert_ua = [None]
        prev = {}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            t = (f - f0) / R.FPS
            for side in ('L_', 'R_'):
                for b in LIM_ABS:
                    pb = arm.pose.bones[side + b]
                    q = pb.rotation_quaternion
                    tw = math.degrees(2 * math.atan2(q.y, q.w))
                    tw = (tw + 180) % 360 - 180
                    key = side + b
                    if abs(tw) > abs(worst_abs.get(key, (0, 0))[0]):
                        worst_abs[key] = (tw, t)
                    if key in prev:
                        d = abs((tw - prev[key] + 180) % 360 - 180)
                        if d > worst_step.get(key, (0, 0))[0]:
                            worst_step[key] = (d, t)
                    prev[key] = tw
            dg = bpy.context.evaluated_depsgraph_get()
            ev = body.evaluated_get(dg)
            co = np.empty(len(ev.data.vertices) * 3)
            ev.data.vertices.foreach_get('co', co)
            co = co.reshape(-1, 3)
            for side, idx in sel.items():
                P = co[idx]
                for bone, plist in prims.items():
                    pb = arm.pose.bones[bone]
                    M = np.array(pb.bone.matrix_local) @ np.linalg.inv(np.array(pb.matrix))
                    Q = P @ M[:3, :3].T + M[:3, 3]
                    for p in plist:
                        d = p.dist_pts(Q)
                        ua = upper[side]
                        if ua.any():
                            j = int(np.argmin(np.where(ua, d, 9.0)))
                            if ua[j] and d[j] < worst_arm[0]:
                                worst_arm = (float(d[j]), f'{side}arm-{bone}', t)
                                vj = body.data.vertices[idx[j]]
                                worst_vert_ua[0] = (tuple(round(x, 2) for x in vj.co),
                                                    [(gname[g.group], round(g.weight, 2)) for g in vj.groups])
                        d = np.where(ua, 9.0, d)
                        i = int(np.argmin(d))
                        if d[i] < worst_clear[0]:
                            vi = idx[i]
                            vg = max(body.data.vertices[vi].groups, key=lambda gg: gg.weight)
                            worst_clear = (float(d[i]), f'{side}arm-{bone}', t)
                            worst_vert[0] = (gname[vg.group], tuple(round(x, 2) for x in body.data.vertices[vi].co))
        bad = []
        for k, (v, t) in worst_abs.items():
            if abs(v) > LIM_ABS[k[2:]]:
                bad.append(f'{k} roll {v:.0f}@{t:.2f}')
        for k, (v, t) in worst_step.items():
            if v > LIM_STEP:
                bad.append(f'{k} roll-step {v:.0f}@{t:.2f}')
        jit = J.clip_jitter(scene, arm, act)
        if jit['tremor'] > J.TREMOR_LIMIT:
            bad.append(f"TREMOR {jit['bone']} {jit['tremor']:.1f}@{jit['t']:.2f}")
        if worst_clear[0] < 0.0:
            bad.append(f'INSIDE {worst_clear[1]} {worst_clear[0]:.2f}@{worst_clear[2]:.2f}')
        if worst_arm[0] < -ARMPIT_ALLOW:
            bad.append(f'INSIDE(upper arm) {worst_arm[1]} {worst_arm[0]:.2f}@{worst_arm[2]:.2f}')
        fails += bool(bad)
        ua = max(abs(worst_abs.get(s + 'UpperArm', (0, 0))[0]) for s in ('L_', 'R_'))
        fa = max(abs(worst_abs.get(s + 'Forearm', (0, 0))[0]) for s in ('L_', 'R_'))
        st = max((v for v, _ in worst_step.values()), default=0)
        if '--why' in rest:
            print('  WORST_VERT', worst_vert[0], ' UPPER', worst_vert_ua[0])
        print(f'CHECK {c:22s} {"FAIL" if bad else "ok  "} upperRoll={ua:4.0f} foreRoll={fa:4.0f} step={st:4.0f} '
              f'tremor={jit["tremor"]:4.1f} '
              f'clear={worst_clear[0]:5.2f}({worst_clear[1]}@{worst_clear[2]:.2f}) {"; ".join(bad)}')
    print('CHECK_FAILS', fails)
