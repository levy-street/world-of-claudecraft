"""Laverock's clips, keyed from a whole-body pose language (adapted from the Balgath
kit's clips.py).

`Body(**params)` turns a few dozen readable numbers into a full pose: where the
pelvis sits and how it tilts, how the spine bends and twists, where the head looks,
where each wrist and ankle is (two-bone IK with poles), how the left hand is turned,
how far the fingers close, the jaw; and `staff`, the direction the thaw-staff points
(the right hand is turned so the shaft runs that way through the fist: the staff
is rigid on the hand, so it can never leave it). The eight skirt panels are aimed
from the legs (they swing out of the way of a stepping knee and a kicking foot,
and pool on the ice when he sinks), then the springs in rig.follow_through carry
them, the sleeves, the cowl's peak and the ledger.

Axes: armature space, yards, +Z up, he faces -Y, his left is +X. A positive `lean`
tips him forward, a positive `twist` turns his chest toward his left, `look`
(yaw, pitch) turns the head (pitch up positive).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector


def _n(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


SH_L = A.SHOULDER
HIP_L = A.HIP
FOOT_L = A.ANKLE
FOOT_R = A.mirror(A.ANKLE)
WRIST_L = A.WRIST


def finger_turns(curl1, curl2, thumb, spread=0.0):
    """Finger curl turns for the LEFT hand (mirrored onto the right by the caller)."""
    w, down, width, palm = A.hand_frame(1)
    out = {}
    axis = tuple(-width)
    for f in ('Index', 'Middle', 'Ring', 'Little'):
        fan = {'Index': 1, 'Middle': 0.3, 'Ring': -0.4, 'Little': -1}[f] * spread
        out[f'L_{f}1'] = [(axis, curl1), (tuple(palm), fan)]
        out[f'L_{f}2'] = [(axis, curl2)]
    base, mid, tip = A.finger_chain(1, 'Thumb')
    mid_base = A.finger_chain(1, 'Middle')[0]
    d_t = _n(mid - base)
    to = _n(mid_base + down * 0.03 - base)
    ax = _n(np.cross(d_t, to))
    out['L_Thumb1'] = [(tuple(ax), thumb)]
    out['L_Thumb2'] = [(tuple(ax), thumb * 0.9)]
    return out


PRONATE_FOREARM = 0.45
HAND_AXIS = {s: tuple(_n(A.REST[s + 'Hand'][1] - A.REST[s + 'Hand'][0])) for s in ('L_', 'R_')}
_W, _D, R_WIDTH_REST, _P = A.hand_frame(-1)
SKIRT_GROUND = 0.1
SKIRT_SINK = 0.45
LEFT_ARM = tuple('L_' + n for n in ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb1', 'Thumb2', 'Index1',
                                     'Index2', 'Middle1', 'Middle2', 'Ring1', 'Ring2', 'Little1', 'Little2'))


class Body:
    """A full-body pose from readable parameters (see the module docstring)."""

    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_tilt=0.0, hip_twist=0.0, hip_roll=0.0,
        lean=0.0, twist=0.0, side=0.0,
        neck=0.0, look=(0.0, 0.0), head_roll=0.0,
        hand_l=None, hand_r=None,
        pole_l=(0.6, 1.0, -0.2), pole_r=None,
        hand_dir_l=None, hand_dir_r=None,
        hand_roll_l=0.0, hand_roll_r=0.0,
        fist_l=0.25, fist_r=1.0,
        spread_l=0.0, spread_r=0.0,
        foot_l=None, foot_r=None,
        foot_dir_l=None, foot_dir_r=None,
        toe_l=0.0, toe_r=0.0,
        knee_l=(0.15, -1.0, 0.0), knee_r=None,
        clav_l=0.0, clav_r=0.0,
        clav_fwd_l=0.0, clav_fwd_r=0.0,
        jaw=0.0,
        staff=(0.0, -0.08, 1.0),      # the staff's up direction (armature); None = rides the hand
        staff_bend=0.0,               # wrist cock: tips the hand's length off the forearm (deg)
        grip_l=-0.5,                  # yards above the right fist where the LEFT hand grips the shaft
        grip_w=0.0,                   # 0 the left hand is free .. 1 it holds the shaft (blended)
    )

    def __init__(self, rig, **kw):
        self.rig = rig
        self.p = dict(self.DEFAULTS)
        for k, v in kw.items():
            if k not in self.p:
                raise KeyError(k)
            self.p[k] = v

    def but(self, **kw):
        b = Body(self.rig)
        b.p = dict(self.p)
        for k, v in kw.items():
            if k not in b.p and not k.startswith('_home_'):
                raise KeyError(k)
            b.p[k] = v
        return b

    def mix(self, other, t):
        b = Body(self.rig)
        b.p = {}
        for k, a in self.p.items():
            o = other.p[k]
            if a is None or o is None:
                b.p[k] = a if t < 0.5 else o
            elif isinstance(a, (tuple, list, np.ndarray)):
                b.p[k] = tuple(float(x) + (float(y) - float(x)) * t for x, y in zip(a, o))
            else:
                b.p[k] = a + (o - a) * t
        return b

    def pose(self, memory=None, resolve=True):
        b = self.cleared() if resolve else self
        return b._solve(memory)

    def cleared(self):
        b = self
        pose = b._solve(None)
        for _ in range(14):
            fix = arm_clearance_fix(b, pose)
            if fix is None:
                break
            b = b.but(**fix)
            pose = b._solve(None)
        return b

    def _tables(self):
        p = self.p
        turns, twist, aims, ik, orient = {}, {}, {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', p['hip_tilt']), ('z', p['hip_twist']), ('y', p['hip_roll'])]
        lean, tw, sd = p['lean'], p['twist'], p['side']
        turns['Spine1'] = [('x', lean * 0.4), ('z', tw * 0.4), ('y', -sd * 0.45)]
        turns['Spine2'] = [('x', lean * 0.6), ('z', tw * 0.6), ('y', -sd * 0.55)]
        yaw, pitch = p['look']
        turns['Neck'] = [('x', p['neck'] - pitch * 0.35), ('z', yaw * 0.4)]
        turns['Head'] = [('x', -pitch * 0.65), ('z', yaw * 0.6), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', p['jaw'])]
        lift_l, fwd_l = girdle(p['hand_l'], 1)
        lift_r, fwd_r = girdle(p['hand_r'], -1)
        set_l = p['clav_fwd_l'] * hang_weight(p['hand_l'], 1)
        set_r = p['clav_fwd_r'] * hang_weight(p['hand_r'], -1)
        turns['L_Clavicle'] = [((0, 1, 0), -(p['clav_l'] + lift_l)), ((0, 0, 1), -(fwd_l + set_l))]
        turns['R_Clavicle'] = [((0, 1, 0), p['clav_r'] + lift_r), ((0, 0, 1), fwd_r + set_r)]
        for side, s in (('L_', 1), ('R_', -1)):
            key = 'hand_l' if s > 0 else 'hand_r'
            tgt = p[key]
            pole = p['pole_l'] if s > 0 else (p['pole_r'] or (-p['pole_l'][0], p['pole_l'][1], p['pole_l'][2]))
            if tgt is not None:
                ik['arm' + side] = (side + 'UpperArm', side + 'Forearm', tuple(tgt), tuple(pole))
            hd = p['hand_dir_l'] if s > 0 else p['hand_dir_r']
            if hd is not None and not (s < 0 and p['staff'] is not None):
                aims[side + 'Hand'] = V(hd)
            roll = p['hand_roll_l'] if s > 0 else p['hand_roll_r']
            if roll and not (s < 0 and p['staff'] is not None):
                twist[side + 'Forearm'] = PRONATE_FOREARM * roll * s
                twist[side + 'Hand'] = (1 - PRONATE_FOREARM) * roll * s
        if p['staff'] is not None:
            # the right hand turns so the shaft runs along `staff`; its length follows
            # the forearm (cocked by staff_bend), squared to the shaft
            orient['R_Hand'] = (None, tuple(_n(p['staff'])), tuple(R_WIDTH_REST), p['staff_bend'])
        for side, s in (('L_', 1), ('R_', -1)):
            f = p['foot_l'] if s > 0 else p['foot_r']
            if f is None:
                f = FOOT_L if s > 0 else FOOT_R
            kp = p['knee_l'] if s > 0 else (p['knee_r'] or (-p['knee_l'][0], p['knee_l'][1], p['knee_l'][2]))
            ik['leg' + side] = (side + 'Thigh', side + 'Shin', tuple(f), tuple(kp))
            fd = p['foot_dir_l'] if s > 0 else p['foot_dir_r']
            rest_fd = A.REST[side + 'Foot'][1] - A.REST[side + 'Foot'][0]
            aims[side + 'Foot'] = V(fd if fd is not None else rest_fd)
            toe = p['toe_l'] if s > 0 else p['toe_r']
            rest_td = A.REST[side + 'Toes'][1] - A.REST[side + 'Toes'][0]
            aims[side + 'Toes'] = V(rest_td)
            if toe:
                turns[side + 'Toes'] = [((1, 0, 0), toe)]
        fl = finger_turns(74 * p['fist_l'] + 6, 88 * p['fist_l'] + 5, 50 * p['fist_l'] + 5, p['spread_l'])
        fr = finger_turns(74 * p['fist_r'] + 6, 88 * p['fist_r'] + 5, 50 * p['fist_r'] + 5, p['spread_r'])
        for k, v in fl.items():
            turns[k] = v
        for k, v in fr.items():
            turns['R_' + k[2:]] = [R._mirror_turn(a, d) for a, d in v]
        return turns, twist, aims, ik, orient

    def _solve(self, memory=None):
        w = float(self.p['grip_w'])
        if w <= 1e-3 or self.p['staff'] is None:
            return self._solve_one(memory, False)
        if w >= 0.999:
            return self._solve_one(memory, True)
        # a hand on its way to the shaft (or leaving it): both solves, the left arm and
        # fingers slerped between them, so the fist travels instead of snapping
        free = self._solve_one(None, False)
        held = self._solve_one(memory, True)
        e = w * w * (3 - 2 * w)
        for name in LEFT_ARM:
            a, b = free[name], held[name]
            if a.dot(b) < 0:
                b = -b
            held[name] = a.slerp(b, e)
        # the blended arm's own frames: the clearance pass and steady_arms read
        # .head/.delta, and left with the held arm's they pushed the FREE wrist and
        # pole out of a body the blended arm never touched (the left arm then
        # snapped straight on the first frame of every two-handed move)
        return refk(held, self.rig, LEFT_ARM)

    def _solve_one(self, memory, grip):
        turns, twist, aims, ik, orient = self._tables()
        first = self.rig.pose(aims=aims, ik=ik, turns=turns, root=self.p['pelvis'], mirror=False, memory=None,
                              twist=twist, orient=orient)
        if grip:
            up = _n(self.p['staff'])
            aims.pop('L_Hand', None)
            twist.pop('L_Forearm', None)
            twist.pop('L_Hand', None)
            pole = self.p['pole_l']
            fl = finger_turns(80, 93, 55, 0.0)
            for k, v in fl.items():
                turns[k] = v
            # The staff and the left shoulder do not depend on the left arm: solved once
            # on a COPY of this frame's limb memory (the final solve below carries it,
            # and the right elbow's turn moves the staff), they fix the grip exactly.
            first = self.rig.pose(aims=aims, ik=ik, turns=turns, root=self.p['pelvis'], mirror=False,
                                  memory=None if memory is None else dict(memory), twist=twist, orient=orient)
            # The left fist's length follows the forearm, squared to the shaft, leaning
            # toward the side the shoulder is on: taken from the forearm alone it spun
            # round the shaft whenever the forearm lay along it (the hauls over the
            # shoulder), and the wrist bent 80 degrees to close round it.
            sh = np.array(first.head['L_UpperArm'])
            s0 = staff_world(first, 0.0)
            ax = staff_world(first, 1.0) - s0
            perp = (s0 - sh) - ax * float(np.dot(s0 - sh, ax))
            perp = perp / max(np.linalg.norm(perp), 1e-6)
            w_, down, width, palm = A.hand_frame(1)
            orient = dict(orient)
            for _ in range(4):
                fo = first.delta['L_Forearm'] @ V(A.REST['L_Forearm'][1] - A.REST['L_Forearm'][0])
                fo = np.array(fo.normalized())
                hand_y = fo - ax * float(np.dot(fo, ax)) + perp * GRIP_SQUARE
                hand_y = hand_y / max(np.linalg.norm(hand_y), 1e-6)
                orient['L_Hand'] = (tuple(hand_y), tuple(up), tuple(A.hand_frame(1)[2]), 0.0)
                q = self.rig._orient_world('L_Hand', Quaternion(), orient['L_Hand'])
                off = -np.array(q @ V(down)) * 0.205 - np.array(q @ V(palm)) * 0.03
                S = staff_world(first, grip_along(first, self.p['grip_l'], off, self.rig))
                ik['armL_'] = ('L_UpperArm', 'L_Forearm', tuple(S + off), tuple(pole))
                first = self.rig.pose(aims=aims, ik=ik, turns=turns, root=self.p['pelvis'], mirror=False,
                                      memory=None if memory is None else dict(memory), twist=twist,
                                      orient=orient)
        aims = dict(aims)
        aims.update(skirt_aims(first))
        return self.rig.pose(aims=aims, ik=ik, turns=turns, root=self.p['pelvis'], mirror=False, memory=memory,
                             twist=twist, orient=orient)

    def head_frame(self):
        pose = self.but(hand_l=None, hand_r=None).pose(resolve=False)
        q = pose.delta['Head']
        return (np.array(q @ V((1, 0, 0))), np.array(q @ V((0, -1, 0))), np.array(q @ V((0, 0, 1))))


GRIP_BEND = 32.0      # degrees of elbow the left arm keeps with its hand on the shaft
GRIP_GAP = 0.24       # yards the left fist keeps below the right one (the hands never overlap)
GRIP_SQUARE = 0.6    # how far the left fist's length leans toward the shoulder's side of the shaft


def grip_along(pose, t0, off, rig):
    """Where on the shaft (yards up from the right grip) the left hand closes: the
    authored `t0`, slid toward the left shoulder only as far as the left arm needs to
    keep GRIP_BEND of elbow. A grip past the arm's reach used to lock the elbow
    straight and leave the fist short of the shaft, wrung round it. `off` is the
    wrist's offset from the grip channel (the hand's own frame). A pure function of
    the pose, so the hand slides smoothly where the reach changes."""
    sh = np.array(pose.head['L_UpperArm'])
    l1, l2 = rig.length['L_UpperArm'], rig.length['L_Forearm']
    reach = math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(math.radians(GRIP_BEND)))

    def dist(t):
        return float(np.linalg.norm(staff_world(pose, t) + off - sh))
    if dist(t0) <= reach:
        return t0
    s0 = staff_world(pose, 0.0)
    up = staff_world(pose, 1.0) - s0
    tc = min(-GRIP_GAP, max(A.STAFF_FOOT_T + 0.6, float(np.dot(sh - off - s0, up))))
    if dist(tc) > reach:
        return tc
    lo, hi = t0, tc            # dist(lo) > reach >= dist(hi)
    for _ in range(30):
        mid = 0.5 * (lo + hi)
        if dist(mid) > reach:
            lo = mid
        else:
            hi = mid
    return hi


def refk(pose, rig, names):
    """Re-derive .head and .delta of `names` and everything below them from the
    pose's LOCAL rotations (after those were blended), parents first."""
    names = set(names)
    for name, parent, h, t in rig.bones:
        if not parent or not (name in names or parent in names):
            continue
        names.add(name)
        rest_m = rig.frames[name]
        loc = (rest_m @ pose[name].to_matrix() @ rest_m.inverted()).to_quaternion()
        dp = pose.delta[parent]
        pose.head[name] = pose.head[parent] + dp @ (rig.rest[name][0] - rig.rest[parent][0])
        pose.delta[name] = dp @ loc
    return pose


def staff_world(pose, t):
    """Armature-space point `t` yards up the shaft from the right grip."""
    q = pose.delta['Staff']
    return np.array(pose.head['Staff'] + q @ (V(A.STAFF_UP) * t))


def skirt_aims(pose):
    """Aims of the 16 skirt bones from a solved pose: each panel hangs from the waist
    (carried by the Hips), is pushed out wherever a knee or an ankle moves toward it,
    and pools out on the ice instead of passing through it."""
    hh = V(A.REST['Hips'][0])
    H = pose.head['Hips']
    Hd = pose.delta['Hips']

    def placed(p):
        return H + Hd @ (V(p) - hh)
    dk, da = [], []
    for side in ('L_', 'R_'):
        dk.append(pose.head[side + 'Shin'] - placed(A.REST[side + 'Shin'][0]))
        da.append(pose.head[side + 'Foot'] - placed(A.REST[side + 'Foot'][0]))
    out = {}
    for k in range(A.SKIRT_N):
        d = Hd @ V(A.skirt_dir(k))
        d.z = 0.0
        if d.length < 1e-6:
            d = V((0, -1, 0))
        d.normalize()
        W = placed(A.skirt_point(k, 0))
        M = placed(A.skirt_point(k, 1))
        Hm = placed(A.skirt_point(k, 2))
        # gravity: the skirt hangs from the waist whatever the hips' tilt
        L1 = (V(A.skirt_point(k, 1)) - V(A.skirt_point(k, 0))).length
        L2 = (V(A.skirt_point(k, 2)) - V(A.skirt_point(k, 1))).length
        rest1 = V(A.skirt_point(k, 1)) - V(A.skirt_point(k, 0))
        rest2 = V(A.skirt_point(k, 2)) - V(A.skirt_point(k, 1))
        M = (M * 0.4 + (W + rest1) * 0.6)
        push_m = V((0, 0, 0))
        push_h = V((0, 0, 0))
        for a, b in zip(dk, da):
            ah = V((a.x, a.y, 0))
            bh = V((b.x, b.y, 0))
            push_m += d * max(0.0, ah.dot(d)) * 1.05
            push_h += d * max(0.0, bh.dot(d)) * 0.95
        M = M + push_m
        seg1 = M - W
        if seg1.length < 1e-6:
            seg1 = rest1.copy()
        Mt = W + seg1.normalized() * L1
        if Mt.z < SKIRT_GROUND + 0.05:
            Mt.z = SKIRT_GROUND + 0.05
            seg1 = Mt - W
        Mt = W + seg1.normalized() * L1
        Ht = Mt + rest2 * 0.55 + (Hm - M) * 0.45 + push_h + push_m * 0.6
        seg2 = Ht - Mt
        tip = Mt + seg2.normalized() * L2
        if tip.z < SKIRT_GROUND:
            # the cloth crumples where it meets the floor: let it sink a little under
            # it (the floor hides that) rather than spread into a wide disc
            dz = Mt.z - SKIRT_GROUND + SKIRT_SINK
            if dz < L2:
                h = math.sqrt(max(0.0, L2 * L2 - dz * dz))
                hv = V((seg2.x, seg2.y, 0))
                hv = hv.normalized() if hv.length > 1e-6 else d
                seg2 = hv * h + V((0, 0, -dz))
            else:
                seg2 = V((seg2.x, seg2.y, -dz))
        out[f'Skirt{k}_1'] = seg1.normalized()
        out[f'Skirt{k}_2'] = seg2.normalized()
    return out


def girdle(target, s):
    if target is None:
        return 0.0, 0.0
    sh = np.array(A.SHOULDER) * (1, 1, 1)
    sh[0] *= s
    d = _n(np.asarray(target, float) - sh)
    elev = math.degrees(math.acos(max(-1.0, min(1.0, -d[2]))))
    lift = 22.0 * smoothstep((elev - 75.0) / 95.0)
    across = -d[0] * s
    fwd = 14.0 * smoothstep((across + 0.1) / 0.7) * smoothstep((-d[1] + 0.2) / 0.8)
    return lift, fwd


def hang_weight(target, s):
    if target is None:
        return 1.0
    sh = np.array(A.SHOULDER) * (s, 1, 1)
    d = _n(np.asarray(target, float) - sh)
    elev = math.degrees(math.acos(max(-1.0, min(1.0, -d[2]))))
    return 1.0 - smoothstep((elev - 40.0) / 30.0)


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------ body clearance
# The bones of the cassock an arm must stay out of (the robe sculpt's own
# primitives: the bodice, the skirt cone, the collar and the cowl), and the arm's
# own girth along its length INCLUDING its sleeve.
COLLIDE = ('Hips', 'Spine1', 'Spine2', 'Neck', 'Head')
ARM_SAMPLES = (('UpperArm', 0.66, 0.12, 0.33), ('UpperArm', 0.85, 0.115, 0.42), ('Forearm', 0.0, 0.11, 0.5),
               ('Forearm', 0.25, 0.12, 0.62), ('Forearm', 0.5, 0.14, 0.75), ('Forearm', 0.75, 0.16, 0.87),
               ('Hand', 0.0, 0.05, 1.0), ('Hand', 0.45, 0.045, 1.0), ('Hand', 0.85, 0.035, 1.0))
FINGER_SAMPLES = tuple((f + k, t, r) for f in ('Index', 'Middle', 'Ring', 'Thumb')
                       for k, t, r in (('1', 1.0, 0.018), ('2', 1.0, 0.016)))
STONE_SAMPLES = ()
ARMPIT_SLACK = 0.07
ARMPIT_BONES = ('Spine1', 'Spine2')
CLEAR_MARGIN = 0.025
RESOLVE_CAP = 0.45
PUSH_MIN_BEND = 20.0
_BODY_PRIMS = None


def body_prims():
    global _BODY_PRIMS
    if _BODY_PRIMS is None:
        d = {}
        for F in (A.build_robe(voxel=0.06, detail=False), A.build_surplice(voxel=0.06, detail=False)):
            for prim, _ in F.prims:
                if prim.bone in COLLIDE and not isinstance(prim, A.Polyline):
                    d.setdefault(prim.bone, []).append(prim)
        _BODY_PRIMS = d
    return _BODY_PRIMS


def body_distance(pose, P, slack=None):
    out = np.full(len(P), 50.0)
    for bone, plist in body_prims().items():
        Rm = np.array(pose.delta[bone].to_matrix())
        Q = np.array(A.REST[bone][0]) + (P - np.array(pose.head[bone])) @ Rm
        extra = slack if slack is not None and bone in ARMPIT_BONES else 0.0
        for prim in plist:
            out = np.minimum(out, prim.dist_pts(Q) + extra)
    return out


def armpit_slack(pose, side, samples):
    bone = side + 'UpperArm'
    d = pose.delta['Spine2'].inverted() @ (pose.delta[bone] @ (V(A.REST[bone][1]) - V(A.REST[bone][0])).normalized())
    hang = smoothstep((-d.z - 0.35) / 0.3) * (1.0 - smoothstep((-d.y - 0.3) / 0.3))
    return np.array([ARMPIT_SLACK * hang if u < 0.5 else 0.0 for _, _, u in samples])


def arm_points(pose, side):
    pts = []
    for seg, t, r in FINGER_SAMPLES:
        bone = side + seg
        h = np.array(pose.head[bone])
        d = np.array(pose.delta[bone] @ (V(A.REST[bone][1]) - V(A.REST[bone][0])))
        pts.append((h + d * t, r, 1.0))
    for seg, t, r, u in ARM_SAMPLES:
        bone = side + seg
        h = np.array(pose.head[bone])
        d = np.array(pose.delta[bone] @ (V(A.REST[bone][1]) - V(A.REST[bone][0])))
        pts.append((h + d * t, r, u))
    return pts


def arm_clearance_fix(b, pose):
    fix = {}
    eps = 0.01
    for side, hk, pk in (('L_', 'hand_l', 'pole_l'), ('R_', 'hand_r', 'pole_r')):
        samples = arm_points(pose, side)
        P = np.array([p for p, _, _ in samples])
        slack = armpit_slack(pose, side, samples)
        d = body_distance(pose, P, slack)
        pen = np.array([r for _, r, _ in samples]) + CLEAR_MARGIN - d
        if pen.max() <= 0.0:
            continue
        grads = np.zeros_like(P)
        for a in range(3):
            e = np.zeros(3)
            e[a] = eps
            grads[:, a] = (body_distance(pose, P + e, slack) - body_distance(pose, P - e, slack)) / (2 * eps)
        grads /= np.maximum(np.linalg.norm(grads, axis=1, keepdims=True), 1e-6)
        wrist_shift = np.zeros(3)
        elbow_push = np.zeros(3)
        for (p, r, u), pe, g in zip(samples, pen, grads):
            if pe <= 0:
                continue
            wrist_shift += g * pe * min(1.0, u / 0.75)
            elbow_push += g * pe * max(0.0, 1.0 - abs(u - 0.5) * 2.5)
        wrist = np.array(pose.head[side + 'Hand'])
        tgt = np.array(b.p[hk]) if b.p[hk] is not None else wrist
        new = tgt + wrist_shift * 1.25
        home = np.array(b.p.get('_home_' + hk, tuple(tgt)))
        sh = np.array(pose.head[side + 'UpperArm'])
        l1, l2 = b.rig.length[side + 'UpperArm'], b.rig.length[side + 'Forearm']
        reach = math.sqrt(l1 * l1 + l2 * l2 + 2 * l1 * l2 * math.cos(math.radians(PUSH_MIN_BEND)))
        reach = max(reach, float(np.linalg.norm(home - sh)))
        lower_in = any(pe > 0 and u >= 0.5 for (_, _, u), pe in zip(samples, pen))
        if not lower_in and np.linalg.norm(new - sh) > reach:
            new = sh + (new - sh) / np.linalg.norm(new - sh) * reach
        off = new - home
        if np.linalg.norm(off) > RESOLVE_CAP:
            new = home + off / np.linalg.norm(off) * RESOLVE_CAP
        fix[hk] = tuple(new)
        fix['_home_' + hk] = tuple(home)
        if np.linalg.norm(elbow_push) > 1e-6:
            pole = b.p[pk] if b.p[pk] is not None else (-b.p['pole_l'][0], b.p['pole_l'][1], b.p['pole_l'][2])
            pv = _n(pole) + _n(elbow_push) * min(1.0, np.linalg.norm(elbow_push) * 6)
            fix[pk] = tuple(_n(pv))
    return fix or None


# ------------------------------------------------------------------ clip helpers
EASE_FN = {
    'in': lambda u: u ** 3,
    'quadin': lambda u: u * u,
    'expoin': lambda u: (2 ** (10 * u) - 1) / 1023.0,
    'out': lambda u: 1 - (1 - u) ** 3,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'backout': lambda u: 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2,
    'linear': lambda u: u,
    'hold': lambda u: 0.0,
}
LIMB_ROOT = {'hand_l': 'L_UpperArm', 'hand_r': 'R_UpperArm', 'foot_l': 'L_Thigh', 'foot_r': 'R_Thigh'}
VIA = {'hand_l': _n((0.45, -1.0, 0.0)), 'hand_r': _n((-0.45, -1.0, 0.0)), 'foot_l': _n((0, -1.0, 0.0)),
       'foot_r': _n((0, -1.0, 0.0))}
NUMERIC_SKIP = set(LIMB_ROOT)
# Directions blended on the sphere, each with the way round it takes when two keys
# point nearly apart. The staff swings OVER the top: lerped as a plain vector, a
# heave from over the shoulder (head behind him) to the strike (head on the ice in
# front) summed to almost nothing halfway, and the shaft spun round sideways through
# the fists in two frames (the Soulfire Trench).
DIR_VIA = {'staff': _n((0.0, -0.15, 1.0))}


def _roots(b):
    pose = b.but(hand_l=None, hand_r=None).pose(resolve=False)
    return {k: np.array(pose.head[bone]) for k, bone in LIMB_ROOT.items()}


def _target(b, key):
    v = b.p[key]
    if v is not None:
        return np.asarray(v, float)
    # a hanging limb: where it actually is in the pose
    pose = b.pose(resolve=False)
    bone = {'hand_l': 'L_Hand', 'hand_r': 'R_Hand', 'foot_l': 'L_Foot', 'foot_r': 'R_Foot'}[key]
    return np.array(pose.head[bone])


def resolved(b):
    """The same Body with every defaulted direction written out, so two keys can be
    blended without a parameter snapping from 'default' to a value halfway."""
    p = b.p
    if all(p[k] is not None for k in ('hand_dir_l', 'hand_dir_r', 'pole_r', 'knee_r', 'foot_dir_l', 'foot_dir_r')):
        return b
    out = b.but()
    q = out.p
    if q['pole_r'] is None:
        q['pole_r'] = (-q['pole_l'][0], q['pole_l'][1], q['pole_l'][2])
    if q['knee_r'] is None:
        q['knee_r'] = (-q['knee_l'][0], q['knee_l'][1], q['knee_l'][2])
    for side, key in (('L_', 'foot_dir_l'), ('R_', 'foot_dir_r')):
        if q[key] is None:
            q[key] = tuple((A.REST[side + 'Foot'][1] - A.REST[side + 'Foot'][0]).tolist())
    if q['hand_dir_l'] is None or q['hand_dir_r'] is None:
        pose = out.pose(resolve=False)
        for side, key in (('L_', 'hand_dir_l'), ('R_', 'hand_dir_r')):
            if q[key] is None:
                rd = V(A.REST[side + 'Hand'][1]) - V(A.REST[side + 'Hand'][0])
                q[key] = tuple(pose.delta[side + 'Hand'] @ rd.normalized())
    return out


def blend(bodies, weights):
    """A weighted combination of Bodies. Numbers and vectors combine linearly; the
    wrist and ankle targets combine RELATIVE to their shoulder and hip, with the
    reach length combined separately, so a fist sweeps an arc round the shoulder
    instead of cutting a straight line through the head."""
    all_none = {k for k in bodies[0].p if all(b.p[k] is None for b in bodies)}
    bodies = [resolved(b) for b in bodies]
    out = Body(bodies[0].rig)
    out.p = {}
    for k in bodies[0].p:
        if k in all_none:
            out.p[k] = None
            continue
        vals = [b.p[k] for b in bodies]
        if k in NUMERIC_SKIP:
            continue
        if any(v is None for v in vals):
            j = int(np.argmax(weights))
            out.p[k] = vals[j]
            continue
        arr = [np.asarray(v, float) for v in vals]
        if k in DIR_VIA:
            units = [a / max(np.linalg.norm(a), 1e-9) for a in arr]
            d = sum(w * u for w, u in zip(weights, units))
            opp = 0.0
            for i in range(len(units)):
                for j in range(i + 1, len(units)):
                    opp += abs(weights[i] * weights[j]) * max(0.0, -float(units[i] @ units[j]))
            d = d + np.asarray(DIR_VIA[k]) * opp * 4.0
            if np.linalg.norm(d) < 1e-6:
                d = units[int(np.argmax(weights))]
            out.p[k] = tuple((d / np.linalg.norm(d)).tolist())
            continue
        acc = sum(w * a for w, a in zip(weights, arr))
        out.p[k] = tuple(acc.tolist()) if np.ndim(acc) else float(acc)
    for k in NUMERIC_SKIP:
        out.p[k] = None
    roots_out = _roots(out)
    for k in LIMB_ROOT:
        if all(b.p[k] is None for b in bodies):
            continue
        rels, lens = [], []
        for b in bodies:
            r = _roots(b)[k]
            rel = _target(b, k) - r
            rels.append(rel)
            lens.append(np.linalg.norm(rel))
        units = [r / max(l, 1e-6) for r, l in zip(rels, lens)]
        d = sum(w * u for w, u in zip(weights, units))
        # Two reaches pointing apart (a fist from the hip to over the head) would
        # cancel halfway and flip; route them through the front instead.
        via = VIA[k]
        opp = 0.0
        for i in range(len(units)):
            for j in range(i + 1, len(units)):
                opp += abs(weights[i] * weights[j]) * max(0.0, -float(units[i] @ units[j]))
        d = d + via * opp * 4.0
        ln = sum(w * l for w, l in zip(weights, lens))
        if np.linalg.norm(d) < 1e-6:
            d = rels[int(np.argmax(weights))]
        d = d / np.linalg.norm(d)
        out.p[k] = tuple((roots_out[k] + d * ln).tolist())
    return out


def _cr_weights(u):
    u2, u3 = u * u, u * u * u
    return (0.5 * (-u + 2 * u2 - u3), 0.5 * (2 - 5 * u2 + 3 * u3), 0.5 * (u + 4 * u2 - 3 * u3), 0.5 * (-u2 + u3))


def sample(seq, t, loop=False):
    """The Body at time t of a key list [(t, Body, ease)]."""
    n = len(seq)
    if t <= seq[0][0]:
        return seq[0][1]
    if t >= seq[-1][0]:
        return seq[-1][1]
    i = max(j for j in range(n - 1) if seq[j][0] <= t)
    t0, b0, ease = seq[i]
    t1, b1, _ = seq[i + 1]
    u = (t - t0) / max(1e-9, t1 - t0)
    if ease != 'auto':
        e = EASE_FN[ease](u)
        return blend([b0, b1], [1 - e, e])
    if loop:
        bm = seq[i - 1][1] if i > 0 else seq[-2][1]
        bp = seq[i + 2][1] if i + 2 < n else seq[1][1]
    else:
        bm = seq[i - 1][1] if i > 0 else b0
        bp = seq[i + 2][1] if i + 2 < n else b1
    return blend([bm, b0, b1, bp], _cr_weights(u))


# Frames (sigma) the clearance corrections are smoothed over in a dense clip.
CLEAR_SMOOTH = 3.0
END_PIN = 6.0
CLEAR_KEYS = (('hand_l', False), ('hand_r', False), ('pole_l', True), ('pole_r', True))


def _explicit(b, key):
    v = b.p[key]
    if v is None and key == 'pole_r':
        v = (-b.p['pole_l'][0], b.p['pole_l'][1], b.p['pole_l'][2])
    return None if v is None else np.asarray(v, float)


def _smooth_rows(rows, sigma, loop):
    """Gaussian-smooth a (frames, 3) series along time; a loop wraps round."""
    n = len(rows)
    r = int(math.ceil(sigma * 3))
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    out = np.zeros_like(rows)
    for i in range(n):
        acc, tot = np.zeros(rows.shape[1]), 0.0
        for k, wk in zip(range(-r, r + 1), w):
            j = i + k
            if loop:
                j %= n
            elif j < 0 or j >= n:
                continue
            acc += rows[j] * wk
            tot += wk
        out[i] = acc / tot
    return out


def _dilate_rows(rows, r, loop):
    """Each frame takes the largest correction within r frames of it, so the smoothed
    push is already whole when the arm reaches the flesh (smoothing alone would ease
    it in late, and the arm would sink in at the onset)."""
    n = len(rows)
    norms = np.linalg.norm(rows, axis=1)
    out = rows.copy()
    for i in range(n):
        best = i
        for k in range(-r, r + 1):
            j = i + k
            if loop:
                j %= n
            elif j < 0 or j >= n:
                continue
            if norms[j] > norms[best] + 1e-9:
                best = j
        out[i] = rows[best]
    return out


def cleared_track(bodies, loop=False):
    """Every frame's Body pushed out of the flesh, with the pushes smoothed in time.

    The clearance pass decides each frame alone: a wrist grazing the gut gets a push
    one frame and none the next, the elbow is shoved round on another, and the arm
    jerks between them (a 15 to 30 deg/frame^2 rattle through the blind stagger, the
    clobber, the swipe). So the frame-by-frame corrections (the wrist offsets and the
    pole changes) are widened to their neighbourhood's largest and then low-passed
    across the clip before the pose is solved: the arm eases clear of the body over a
    few frames before it would touch, instead of being kicked out of it."""
    res = [b.cleared() for b in bodies]
    out = [b.but() for b in bodies]
    for key, is_dir in CLEAR_KEYS:
        orig = [_explicit(b, key) for b in bodies]
        new = [_explicit(r, key) for r in res]
        if any(o is None or q is None for o, q in zip(orig, new)):
            for o, r in zip(out, res):
                o.p[key] = r.p[key]
            continue
        delta = np.array([q - o for o, q in zip(orig, new)])
        if not np.abs(delta).max() > 1e-9:
            continue
        sm = _smooth_rows(_dilate_rows(delta, int(math.ceil(CLEAR_SMOOTH * 2)), loop), CLEAR_SMOOTH, loop)
        if not loop:
            # A clip's first and last frames are the poses the mixer crossfades with
            # (the stance, or the clip's documented end pose): they keep their OWN push
            # (none, for the stance), and the eased push fades in over END_PIN frames.
            # Widened and smoothed across the seam, a push from the wind-up reached back
            # into frame 0 and the clip began off the stance.
            n = len(sm)
            for i in range(n):
                w = smoothstep(min(i, n - 1 - i) / END_PIN)
                sm[i] = delta[i] + (sm[i] - delta[i]) * w
        for o, base, d in zip(out, orig, sm):
            v = base + d
            if is_dir:
                v = v / max(np.linalg.norm(v), 1e-9)
            o.p[key] = tuple(v.tolist())
    return out


def keys_of(seq, loop=False, dense=True, ease_clear=True):
    """seq: [(t, Body, ease)] -> per-frame [(t, Pose, 'linear')]: every frame is
    solved from the interpolated BODY (arcs, not quaternion blends), out of the
    flesh by a time-smoothed clearance (cleared_track; `ease_clear=False` keeps each
    frame's own push), then steadied (steady_arms)."""
    if not dense:
        return [(t, b.pose(), e) for t, b, e in seq]
    end = seq[-1][0]
    nfr = int(round(end * 24))
    times = [f / 24 for f in range(nfr + 1)]
    bodies = [sample(seq, t, loop) for t in times]
    # A clip whose length is not a whole number of frames: when the frame grid stops
    # short of the end, the end pose is keyed at its own time; when the grid's last frame
    # already lies past it, that frame IS the end pose (sample() holds it) and stays the
    # last key, so nothing after it can be eased off the pose.
    if nfr / 24 < end - 1e-6:
        times.append(end)
        bodies.append(seq[-1][1])
    # a loop's last frame IS its first: smooth over the cycle without counting it twice
    cyc = bodies[:-1] if loop and len(bodies) > 2 else bodies
    track = cleared_track(cyc, loop=loop) if ease_clear else [b.cleared() for b in cyc]
    if len(cyc) < len(bodies):
        track = track + [track[0]]
    memory = {}
    if loop:   # settle the bend memory over one pass so the loop seam matches
        for b in track:
            b._solve(memory)
    poses = [b._solve(memory) for b in track]
    if not loop:
        poses = settle_tail(poses, track, bodies[0].rig)
    # the left arm is left as solved where the fist holds the shaft: eased on its own
    # there it came off the shaft (a seventh of a yard in the Soulfire Trench's stroke)
    held = frozenset(i for i, b in enumerate(track) if b.p['staff'] is not None and float(b.p['grip_w']) >= 0.999)
    poses = steady_arms(poses, bodies[0].rig, held=held)
    return [(t, p, 'linear') for t, p in zip(times, poses)]


TAIL_MAX = 24          # frames the settle may take
TAIL_RATE = 1.0        # degrees per frame it adds to an arm bone (more only if TAIL_MAX is too short)


def settle_tail(poses, track, rig):
    """Land a clip's last frame exactly on its end pose.

    The per-frame bend and roll limits (the memory) let the elbow trail a fast
    recovery: the wrist is back on the stance but the elbow is still swinging round to
    it, so the clip ended up to 29 degrees of arm roll short of the stance and the
    crossfade to Idle (0.1 s) had to finish the move. The end pose is solved on its own
    (no memory: exactly what the next clip starts from), and what the forward solve
    still lacks on each arm bone is turned in evenly over the last frames, as many as
    the difference needs at TAIL_RATE (none, when the forward solve already lands). A
    constant extra turn per frame, so the roll steps the rig allows are not exceeded."""
    n = len(poses)
    kmax = min(TAIL_MAX, n - 1)
    if kmax < 2:
        return poses
    names = [side + part for side in ('L_', 'R_') for part in ('UpperArm', 'ElbowFix', 'Forearm', 'Hand')]

    def local(p, name):
        rest_m = rig.frames[name]
        return (rest_m @ p[name].to_matrix() @ rest_m.inverted()).to_quaternion()

    end = track[-1]._solve(None)
    lack = {}
    for name in names:
        q = local(poses[-1], name).inverted() @ local(end, name)
        if q.w < 0:
            q.negate()
        lack[name] = q
    gap = max(math.degrees(q.angle) for q in lack.values())
    if gap < 0.01:
        return poses
    k = max(2, min(kmax, int(math.ceil(gap / TAIL_RATE))))
    for j in range(k):
        w = (j + 1) / k
        p = poses[n - k + j]
        for name in names:
            rest_m = rig.frames[name]
            m = local(p, name) @ Quaternion().slerp(lack[name], w)
            p[name] = (rest_m.inverted() @ m.to_matrix() @ rest_m).to_quaternion()
            p.delta[name] = p.delta[rig.parent[name]] @ m
    return poses
    names = [side + part for side in ('L_', 'R_') for part in ('UpperArm', 'ElbowFix', 'Forearm', 'Hand')]

    def local(p, name):
        rest_m = rig.frames[name]
        return (rest_m @ p[name].to_matrix() @ rest_m.inverted()).to_quaternion()

    memory = {}
    back = [None] * kmax
    for j in range(kmax - 1, -1, -1):
        back[j] = track[n - kmax + j]._solve(memory)
    gap = max(math.degrees(local(poses[-1], nm).rotation_difference(local(back[-1], nm)).angle) for nm in names)
    gap = min(gap, 360.0 - gap)
    if gap < 0.01:
        return poses
    k = max(2, min(kmax, int(math.ceil(gap / TAIL_RATE))))
    for j in range(k):
        w = (j + 1) / k
        p, q = poses[n - k + j], back[kmax - k + j]
        for name in names:
            rest_m = rig.frames[name]
            a, c = local(p, name), local(q, name)
            if a.dot(c) < 0:
                c.negate()
            m = a.slerp(c, w)
            p[name] = (rest_m.inverted() @ m.to_matrix() @ rest_m).to_quaternion()
            p.delta[name] = p.delta[rig.parent[name]] @ m
    return poses
    memory = {}
    back = [None] * k
    for j in range(k - 1, -1, -1):
        back[j] = track[n - k + j]._solve(memory)
    for j in range(k):
        w = 1.0 if times[n - k + j] >= times[-1] - 1e-9 else smoothstep((j + 1) / k)
        p, q = poses[n - k + j], back[j]
        for side in ('L_', 'R_'):
            for part in ('UpperArm', 'ElbowFix', 'Forearm', 'Hand'):
                name = side + part
                rest_m = rig.frames[name]
                a = (rest_m @ p[name].to_matrix() @ rest_m.inverted()).to_quaternion()
                c = (rest_m @ q[name].to_matrix() @ rest_m.inverted()).to_quaternion()
                if a.dot(c) < 0:
                    c.negate()
                m = a.slerp(c, w)
                p[name] = (rest_m.inverted() @ m.to_matrix() @ rest_m).to_quaternion()
                p.delta[name] = p.delta[rig.parent[name]] @ m
    return poses


# The arm chain, parents first (anatomy.BONES), steadied by steady_arms.
ARM_CHAIN = ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand')
STEADY_LIMIT = 1.0      # deg/frame^2 of zig-zag left in place (jitter.TREMOR_LIMIT gates at 2.5)


def steady_arms(poses, rig, passes=24, held=frozenset()):
    """Take the frame-to-frame zig-zag out of each arm bone's armature-space turn.

    A fast blow still leaves the solver a frame or two where the bend and roll limits
    (rig.two_bone, Rig._limit_roll) catch up with a target that outran them: the limb
    lurches one way and back on alternate frames. Each arm bone, parents first, is
    scanned for that pattern (jitter.py: an acceleration flipping against both
    neighbours) and only the flagged frames are eased toward their neighbours (a
    1-2-1 slerp), until none is left above STEADY_LIMIT. The easing works on the
    bone's LOCAL turn, so its roll steps never grow past the rig's (review.py's
    roll-step check); only a zig-zag the parent hands down whole is eased in
    armature space. A single hard stop or recoil is one flip, not a zig-zag, so the
    blows keep their snap; the fingers, the chains and everything else ride on the
    steadied bones unchanged. The left arm is not eased on the `held` frames (both
    hands on the shaft), where it must stay closed on the staff."""
    import jitter as J
    n = len(poses)
    if n < 5:
        return poses

    def ease(qs, flagged, keep=frozenset()):
        new = list(qs)
        for i in flagged:
            if 0 < i < n - 1 and i not in keep:
                new[i] = qs[i - 1].slerp(qs[i + 1], 0.5).slerp(qs[i], 0.5)
        return new

    def aligned(qs):
        qs = [Quaternion(q) for q in qs]
        for i in range(1, len(qs)):
            if qs[i].dot(qs[i - 1]) < 0:
                qs[i].negate()
        return qs

    for side in ('L_', 'R_'):
        for part in ARM_CHAIN:
            name = side + part
            parent = rig.parent[name]
            rest_m = rig.frames[name]
            local = aligned([(rest_m @ p[name].to_matrix() @ rest_m.inverted()).to_quaternion() for p in poses])

            def world(loc):
                return aligned([p.delta[parent] @ q for p, q in zip(poses, loc)])

            touched = False
            for _ in range(passes):
                flagged = J.zigzag_frames(world(local), STEADY_LIMIT)
                if not flagged:
                    break
                local = ease(local, flagged, held if side == 'L_' else frozenset())
                touched = True
            qs = world(local)
            for _ in range(passes):
                flagged = J.zigzag_frames(qs, STEADY_LIMIT)
                if not flagged:
                    break
                qs = ease(qs, flagged, held if side == 'L_' else frozenset())
                touched = True
            for p, q in zip(poses, qs):
                p.delta[name] = q
                if touched:
                    loc = p.delta[parent].inverted() @ q
                    p[name] = (rest_m.inverted() @ loc.to_matrix() @ rest_m).to_quaternion()
    return poses






def make_clips(arm, only=None):
    rig = R.Rig(arm)
    made = []
    import clip_library as L
    for name, fn, loop, wind in L.CATALOG:
        if only and name not in only:
            continue
        keys = fn(rig)
        act = R.make_clip(arm, name, keys)
        R.follow_through(arm, act, loop=loop, wind=wind)
        made.append(name)
    return made
