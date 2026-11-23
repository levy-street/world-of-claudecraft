"""Evaluate a Korgath one-handed maul clip spec on the control rig, bake it.

A spec (dict):
  length: frames (last frame = length)
  base: optional body clip name: its own frames are the body, the maul and the
        right arm (only the left arm is re-solved, by 'left_w')
  body: {frame: {'hips': (dx,dy,dz, rx,ry,rz), 'spine': (rx,ry,rz), 'chest':..., 'neck':...,
                 'head':..., 'clavicle.r':..., 'clavicle.l':...}}   world-axis degrees
  body_ease: {frame: ease}
  maul: {frame: (P(world Vector), D(Vector toward the head), N(face Vector))}, P = the
        haft point at the right fist (the grip slides by right_s)
  maul_ease: {frame: ease}
  right_s: {frame: s}   the fist's place on the haft (hammer units, 0.42 = Idle)
  right_phi: {frame: deg} | 'auto'   the fist's roll round the haft
  left_off: {frame: (dx,dy,dz)}   the free left hand, world offset from Idle's
            hand carried by the chest; left_rot {frame: (rx,ry,rz)} its turn
  left_w: {frame: 0..1}   (base clips) how much the counterbalance replaces the
            clip's own left arm
  left_curl: {frame: deg}   extra curl of the left fingers on Idle's (a loose fist)
  pole_r / pole_l: {frame: Vector | 'idle'}   elbow direction hints (world)
"""
import os
import bpy, math, sys
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kanim
from kanim import Track, EASE, euler_deg, maul_frame

BODY_KEYS = ('hips', 'spine', 'chest', 'neck', 'head', 'clavicle.r', 'clavicle.l')


def sval(x, f):
    if isinstance(x, dict):
        return Track(x, kind='scalar').at(f) if len(x) > 1 else list(x.values())[0]
    return x if isinstance(x, (int, float)) else 0.0


def wrist_cost(rig, P, side):
    """How far the wrist is from the T-pose's straight hand on forearm (degrees)."""
    lo, ha = 'lowerarm.' + side, 'hand.' + side
    rel = P[lo].to_3x3().normalized().inverted() @ P[ha].to_3x3().normalized()
    rel0 = rig.rest[lo].to_3x3().normalized().inverted() @ rig.rest[ha].to_3x3().normalized()
    return math.degrees((rel0.inverted() @ rel).to_quaternion().angle)


def _poles(rig, d, sd):
    return {f: (rig.idle_pole[sd].copy() if isinstance(v, str) else v) for f, v in d.items()}


def evaluate(rig, spec, verbose=True, only=None):
    L = spec['length']
    base = spec.get('base')
    frames = {}
    report = []
    if not base:
        bt = {k: Track({f: Vector(v.get(k, (0, 0, 0, 0, 0, 0) if k == 'hips' else (0, 0, 0))) for f, v in spec['body'].items()},
                       spec.get('body_ease')) for k in BODY_KEYS}
        mt_p = Track({f: v[0] for f, v in spec['maul'].items()}, spec.get('maul_ease'))
        qs = {f: kanim.frame_from(v[1], v[2]).to_quaternion() for f, v in spec['maul'].items()}
        prev = None
        for f in sorted(qs):
            if prev is not None and prev.dot(qs[f]) < 0:
                qs[f] = -qs[f]
            prev = qs[f]
        mt_q = Track(qs, spec.get('maul_ease'), kind='quat')
        pr = Track(_poles(rig, spec['pole_r'], 'r'))
    pl = Track(_poles(rig, spec['pole_l'], 'l'))
    lo = Track({f: Vector(v) for f, v in spec.get('left_off', {0: (0, 0, 0)}).items()}, spec.get('left_ease'))
    lr = Track({f: Vector(v) for f, v in spec.get('left_rot', {0: (0, 0, 0)}).items()}, spec.get('left_ease'))
    lw = spec.get('left_w')

    def body_pose(f):
        P = {n: m.copy() for n, m in rig.P0.items()}
        h = bt['hips'].at(f)
        rig.translate(P, 'hips', Vector(h[:3]))
        rig.rotate(P, 'hips', euler_deg(h[3:]))
        for k in BODY_KEYS[1:]:
            e = bt[k].at(f)
            if any(abs(x) > 1e-6 for x in e):
                rig.rotate(P, k, euler_deg(e))
        # the apron hangs: it keeps most of its fall when the pelvis pitches,
        # and trails the hips' motion a little (secondary motion)
        hp = bt['hips'].at(f); hv = bt['hips'].at(f) - bt['hips'].at(max(0, f - 2))
        for cl in ('cloth.front.1', 'cloth.back.1'):
            if cl in P:
                rig.rotate(P, cl, euler_deg((-0.65 * hp[3] - 18.0 * hv[1] - 1.5 * hv[3], 0, -0.4 * hp[5])))
        for cl in ('cloth.front.2', 'cloth.back.2'):
            if cl in P:
                rig.rotate(P, cl, euler_deg((-12.0 * hv[1] - 1.0 * hv[3], 0, 0)))
        return P

    def maul_at(f):
        q = mt_q.at(f).to_matrix()
        s = sval(spec['right_s'], f)
        # P is the haft point under the fist: the frame's haft y = s sits there
        return maul_frame(rig, mt_p.at(f), q @ Vector((0, 1, 0)), q @ Vector((1, 0, 0)), s)

    for f in (only if only is not None else range(L + 1)):
        er = 0.0
        if base:
            P = rig.pose_of(base, f)
        else:
            P = body_pose(f)
            for s in ('l', 'r'):
                foot = rig.P0['foot.' + s].copy()
                rig.ik2(P, 'upperleg.' + s, 'lowerleg.' + s, 'foot.' + s, foot.translation, rig.idle_knee[s],
                        end_rot=foot, twist_share=0.0)
            H = maul_at(f)
            phi = sval(spec['right_phi'], f)
            Tr = H @ rig.G_right(sval(spec['right_s'], f), phi).inverted()
            er = rig.ik2(P, 'upperarm.r', 'lowerarm.r', 'hand.r', Tr.translation, pr.at(f), end_rot=Tr)
            P['hammer'] = H
        # the free left hand: Idle's hand carried by the chest, plus the offset
        carry = P['chest'] @ rig.P0['chest'].inverted() @ rig.P0['hand.l']
        tgt = Matrix.Translation(Vector(lo.at(f))) @ carry
        rot = euler_deg(lr.at(f))
        tgt = Matrix.Translation(tgt.translation) @ (rot @ tgt.to_3x3()).to_4x4()
        if lw is not None:
            w = min(1.0, max(0.0, sval(lw, f)))
            own = P['hand.l'].copy()
            pos = own.translation.lerp(tgt.translation, w)
            q = own.to_quaternion().slerp(tgt.to_quaternion(), w)
            tgt = Matrix.Translation(pos) @ (q.to_matrix() @ Matrix.Diagonal(own.to_scale()).to_3x3()).to_4x4()
            S, E, T = (P[b + '.l'].translation for b in ('upperarm', 'lowerarm', 'hand'))
            d = (T - S).normalized()
            own_pole = ((E - S) - d * (E - S).dot(d)).normalized()
            pole = own_pole.lerp(pl.at(f), w)
        else:
            pole = pl.at(f)
        el = rig.ik2(P, 'upperarm.l', 'lowerarm.l', 'hand.l', tgt.translation, pole, end_rot=tgt)
        report.append((f, round(er, 3), round(el, 3), round(wrist_cost(rig, P, 'r')), round(wrist_cost(rig, P, 'l'))))
        frames[f] = P
    if verbose:
        bad = [r for r in report if r[1] > 0.02 or r[2] > 0.02]
        print('REACH misses (frame, right, left):', [(r[0], r[1], r[2]) for r in bad] or 'none')
        print('WRIST deg r:', [r[3] for r in report])
    return frames, report


def choose_phi(rig, spec, step=15, lim=25.0, verbose=True):
    """The fist's roll round the haft for the straightest wrist, smooth in time
    (a Viterbi pass over the maul keys: the haft never spins in the fist)."""
    if spec.get('base') or spec.get('right_phi') != 'auto':
        return
    keys = sorted(spec['maul'])
    cand = [float(p) for p in range(-180, 180, step)]
    cost = {}
    for p in cand:
        spec['right_phi'] = p
        fr, rep = evaluate(rig, spec, verbose=False, only=keys)
        for r in rep:
            cost[(r[0], p)] = wrist_cost(rig, fr[r[0]], 'r') + 300 * r[1]

    def d(p, q):
        return abs((q - p + 180) % 360 - 180)
    # the first and last keys sit on Idle (roll 0)
    best = {0.0: (0.0, [0.0])}
    for k in keys[1:]:
        nb = {}
        for q in cand:
            if k == keys[-1] and q != 0.0:
                continue
            opts = [(c + 0.15 * d(p, q), path) for p, (c, path) in best.items() if d(p, q) <= lim]
            if opts:
                c, path = min(opts, key=lambda x: x[0])
                nb[q] = (c + cost[(k, q)], path + [q])
        best = nb
    c, path = min(best.values(), key=lambda x: x[0])
    un = [path[0]]
    for q in path[1:]:
        un.append(un[-1] + ((q - un[-1] + 180) % 360 - 180))
    spec['right_phi'] = dict(zip(keys, un))
    if verbose:
        print('PHI', {k: round(v) for k, v in spec['right_phi'].items()}, 'cost', round(c))


def bake(rig, frames, spec, name):
    arm = rig.arm
    act = bpy.data.actions.get(name)
    if act:
        act.name = name + '_old'
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.use(act)
    curl = Track(spec.get('left_curl', {0: 0.0}), kind='scalar')
    lw = spec.get('left_w')
    prevq = {}
    for f in sorted(frames):
        B = rig.to_basis(frames[f])
        # the right fist: the modeled grip (its rest) the whole clip
        B['fingers.r'] = Matrix()
        # the left fingers: Idle's relaxed curl (blended from the clip's own on a base clip)
        fl = (rig.fl_idle.to_quaternion() @ Quaternion(rig.fl_idle.to_quaternion().axis, math.radians(curl.at(f)))).to_matrix().to_4x4()
        if lw is not None:
            w = min(1.0, max(0.0, sval(lw, f)))
            fl = B['fingers.l'].to_quaternion().slerp(fl.to_quaternion(), w).to_matrix().to_4x4()
        B['fingers.l'] = fl
        for n in rig.bones:
            pb = arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            loc, q, sc = B[n].decompose()
            if n in prevq and prevq[n].dot(q) < 0:
                q = -q
            prevq[n] = q
            pb.location = loc
            pb.rotation_quaternion = q
            pb.scale = (1, 1, 1)
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('scale', frame=f)
    return act
