"""The Sanctum trash kit's pose language and clip writer (bipeds; the quadruped and
the winged whelp drive the same writer with their own pose function).

`Body(rig, **params)` turns readable numbers into a whole pose: where the pelvis sits
and how it tilts, how the spine bends and twists (spread over the creature's
`A.SPINE` bones), where the head looks, where each wrist and ankle is (two-bone IK
with poles), how each hand is turned, how far the fingers close, and `weapon`, the
direction the weapon points (the right hand is turned so the rigid weapon runs that
way: the weapon bone is never keyed, so it can never leave the fist). `grip_w` closes
the LEFT hand on the haft `grip_l` yards along it. `extra` adds rest-frame turns to
any bone (a tail, a crest, a wing) and `scale` keys bone scales (a core flaring).

A clip is a list of keys (t, Body, ease): the writer samples the PARAMETERS every
frame (eased per segment, never a slerp of solved bones), solves IK per frame with a
shared memory (so a bend never flips), and keys every bone every frame. Planted feet
therefore stay exactly where their targets say.

Axes: armature space, yards, +Z up, the creature faces -Y, its left is +X. Positive
`lean` tips it forward, positive `twist` turns the chest toward its left, `look`
(yaw, pitch) turns the head (pitch up positive).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau


def _n(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def finger_turns(curl1, curl2, thumb, spread=0.0):
    """Finger curl turns for the LEFT hand (mirrored for the right by the caller)."""
    if not getattr(A, 'FINGERS', None):
        return {}
    w, down, width, palm = A.hand_frame(1)
    out = {}
    axis = tuple(-width)
    for f in A.FINGERS:
        if f == 'Thumb':
            continue
        fan = A.FINGER_FAN.get(f, 0.0) * spread
        out[f'L_{f}1'] = [(axis, curl1), (tuple(palm), fan)]
        out[f'L_{f}2'] = [(axis, curl2)]
    if 'Thumb' in A.FINGERS:
        base, mid, tip = A.finger_chain(1, 'Thumb')
        ref = A.finger_chain(1, A.FINGERS[2])[0]
        d_t = _n(mid - base)
        to = _n(ref + down * 0.03 - base)
        ax = _n(np.cross(d_t, to))
        out['L_Thumb1'] = [(tuple(ax), thumb)]
        out['L_Thumb2'] = [(tuple(ax), thumb * 0.9)]
    return out


PRONATE = 0.45
POLE_SEARCH = False
STATEFUL_IK = False
PRONATE_MAP = {'R_Forearm': ('R_Hand', 0.5), 'L_Forearm': ('L_Hand', 0.5)}


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_tilt=0.0, hip_twist=0.0, hip_roll=0.0,
        lean=0.0, twist=0.0, side=0.0,
        neck=0.0, look=(0.0, 0.0), head_roll=0.0, jaw=0.0,
        hand_l=None, hand_r=None,
        pole_l=(0.5, 1.0, -0.3), pole_r=None,
        hand_dir_l=None, hand_dir_r=None,
        hand_roll_l=0.0, hand_roll_r=0.0,
        fist_l=0.3, fist_r=1.0,
        spread_l=0.0, spread_r=0.0,
        weapon=None, weapon_bend=0.0, weapon_max=55.0, wrist_r=(0.0, 0.0), wrist_l=(0.0, 0.0),
        grip_l=0.4, grip_w=0.0,
        foot_l=None, foot_r=None,
        fpitch_l=0.0, fpitch_r=0.0, fyaw_l=0.0, fyaw_r=0.0,
        toe_l=0.0, toe_r=0.0,
        knee_l=(0.15, -1.0, 0.0), knee_r=None,
        clav_l=0.0, clav_r=0.0, clav_fwd_l=0.0, clav_fwd_r=0.0,
        extra=None, scale=None, offset=None,
    )

    def __init__(self, rig, **kw):
        self.rig = rig
        self.p = dict(self.DEFAULTS)
        self.p['extra'] = {}
        self.p['scale'] = {}
        self.p['offset'] = {}
        for k, v in kw.items():
            if k not in self.p:
                raise KeyError(k)
            self.p[k] = v

    def but(self, **kw):
        b = Body(self.rig)
        b.p = dict(self.p)
        for k, v in kw.items():
            if k not in b.p:
                raise KeyError(k)
            if k in ('extra', 'scale', 'offset'):
                merged = dict(self.p[k])
                merged.update(v)
                v = merged
            b.p[k] = v
        return b

    def mix(self, other, t):
        b = Body(self.rig)
        b.p = {}
        for k, a in self.p.items():
            o = other.p[k]
            if k == 'extra':
                keys = set(a) | set(o)
                out = {}
                for bone in keys:
                    la, lo = a.get(bone, []), o.get(bone, [])
                    axes = {}
                    for ax, d in la:
                        axes.setdefault(ax, [0.0, 0.0])[0] += d
                    for ax, d in lo:
                        axes.setdefault(ax, [0.0, 0.0])[1] += d
                    out[bone] = [(ax, d0 + (d1 - d0) * t) for ax, (d0, d1) in axes.items()]
                b.p[k] = out
            elif k == 'scale':
                keys = set(a) | set(o)
                b.p[k] = {bone: a.get(bone, 1.0) + (o.get(bone, 1.0) - a.get(bone, 1.0)) * t for bone in keys}
            elif k == 'offset':
                keys = set(a) | set(o)
                z3 = (0.0, 0.0, 0.0)
                b.p[k] = {bone: tuple(x + (y - x) * t for x, y in zip(a.get(bone, z3), o.get(bone, z3)))
                          for bone in keys}
            elif a is None or o is None:
                b.p[k] = a if t < 0.5 else o
            elif isinstance(a, (tuple, list, np.ndarray)):
                b.p[k] = tuple(float(x) + (float(y) - float(x)) * t for x, y in zip(a, o))
            else:
                b.p[k] = a + (o - a) * t
        return b

    # ------------------------------------------------------------ solve
    def _tables(self):
        p = self.p
        turns, twist, aims, ik, orient = {}, {}, {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', p['hip_tilt']), ('z', p['hip_twist']), ('y', p['hip_roll'])]
        for bone, w in A.SPINE:
            turns[bone] = [('x', p['lean'] * w), ('z', p['twist'] * w), ('y', -p['side'] * w)]
        yaw, pitch = p['look']
        if 'Neck' in A.REST:
            turns['Neck'] = [('x', p['neck'] - pitch * 0.35), ('z', yaw * 0.4)]
            turns['Head'] = [('x', -pitch * 0.65), ('z', yaw * 0.6), ('y', p['head_roll'])]
        else:
            turns['Head'] = [('x', p['neck'] - pitch), ('z', yaw), ('y', p['head_roll'])]
        if 'Jaw' in A.REST:
            turns['Jaw'] = [('x', p['jaw'])]
        if 'L_Clavicle' in A.REST:
            turns['L_Clavicle'] = [((0, 1, 0), -p['clav_l']), ((0, 0, 1), -p['clav_fwd_l'])]
            turns['R_Clavicle'] = [((0, 1, 0), p['clav_r']), ((0, 0, 1), p['clav_fwd_r'])]
        has_weapon = p['weapon'] is not None and 'Weapon' in A.REST
        for side, s in (('L_', 1), ('R_', -1)):
            if side + 'UpperArm' not in A.REST:
                continue
            tgt = p['hand_l'] if s > 0 else p['hand_r']
            pole = p['pole_l'] if s > 0 else (p['pole_r'] or (-p['pole_l'][0], p['pole_l'][1], p['pole_l'][2]))
            if tgt is not None:
                ik['arm' + side] = (side + 'UpperArm', side + 'Forearm', tuple(tgt), tuple(pole))
            hd = p['hand_dir_l'] if s > 0 else p['hand_dir_r']
            if hd is not None and not (s < 0 and has_weapon):
                aims[side + 'Hand'] = V(hd)
            roll = p['hand_roll_l'] if s > 0 else p['hand_roll_r']
            if roll and not (s < 0 and has_weapon):
                twist[side + 'Forearm'] = PRONATE * roll * s
                twist[side + 'Hand'] = (1 - PRONATE) * roll * s
            dev, flex = p['wrist_l'] if s > 0 else p['wrist_r']
            if (dev or flex) and not (s < 0 and has_weapon) and hd is None:
                w_, down_, width_, palm_ = A.hand_frame(s)
                # deviation turns the hand in its own plane (toward the thumb +), flexion
                # folds it toward the palm (+)
                turns[side + 'Hand'] = [(tuple(palm_ * s), dev), (tuple(width_ * s), flex)]
        if has_weapon:
            orient['R_Hand'] = (None, tuple(_n(p['weapon'])), tuple(A.WEAPON_REF), p['weapon_bend'])
        for side, s in (('L_', 1), ('R_', -1)):
            if side + 'Thigh' not in A.REST:
                continue
            f = p['foot_l'] if s > 0 else p['foot_r']
            if f is None:
                f = A.ANKLE if s > 0 else A.mirror(A.ANKLE)
            kp = p['knee_l'] if s > 0 else (p['knee_r'] or (-p['knee_l'][0], p['knee_l'][1], p['knee_l'][2]))
            ik['leg' + side] = (side + 'Thigh', side + 'Shin', tuple(f), tuple(kp))
            pitch_ = p['fpitch_l'] if s > 0 else p['fpitch_r']
            yaw_ = p['fyaw_l'] if s > 0 else p['fyaw_r']
            aims[side + 'Foot'] = V(A.foot_dir(pitch_, s, yaw_))
            if side + 'Toes' in A.REST:
                rest_td = A.REST[side + 'Toes'][1] - A.REST[side + 'Toes'][0]
                aims[side + 'Toes'] = V(A.foot_dir(0.0, s, yaw_, rest_td))
                toe = p['toe_l'] if s > 0 else p['toe_r']
                if toe:
                    turns[side + 'Toes'] = [((1, 0, 0), toe)]
        if getattr(A, 'FINGERS', None):
            fl = finger_turns(74 * p['fist_l'] + 6, 88 * p['fist_l'] + 5, 50 * p['fist_l'] + 5, p['spread_l'])
            fr = finger_turns(74 * p['fist_r'] + 6, 88 * p['fist_r'] + 5, 50 * p['fist_r'] + 5, p['spread_r'])
            for k, v in fl.items():
                turns[k] = v
            for k, v in fr.items():
                turns['R_' + k[2:]] = [R._mirror_turn(a, d) for a, d in v]
        for bone, lst in (p['extra'] or {}).items():
            turns[bone] = list(turns.get(bone, [])) + list(lst)
        return turns, twist, aims, ik, orient

    def pose(self, memory=None):
        out = self._pose(memory)
        offs = self.p.get('offset') or {}
        if offs:
            loc = {}
            for bone, v in offs.items():
                par = self.rig.parent[bone]
                dp = out.delta[par] if par else Quaternion()
                rm = self.rig.frames[bone]
                loc[bone] = tuple(rm.inverted() @ (dp.inverted() @ V(v)))
            out.loc = loc
        return out

    def _pose(self, memory=None):
        turns, twist, aims, ik, orient = self._tables()
        sc = dict(self.p['scale'] or {})
        kw = dict(aims=aims, ik=ik, turns=turns, root=self.p['pelvis'], mirror=False, twist=twist,
                  orient=orient, scale=sc, pronate=PRONATE_MAP)
        if POLE_SEARCH and 'R_Hand' in orient and 'armR_' in ik:
            kw = self._best_pole(kw, memory, 'R_')
        if 'R_Hand' in orient and self.p['weapon_max'] is not None:
            # the blade goes where it is asked only as far as the wrist can take it
            # from where the fist naturally carries it (no forearm or wrist roll)
            k0 = dict(kw)
            o0 = dict(kw['orient'])
            o0.pop('R_Hand')
            k0['orient'] = o0
            nat = V(self.rig.pose(memory=None, **k0).delta['R_Hand'] @ V(A.WEAPON_AXIS)).normalized()
            want = V(_n(self.p['weapon']))
            ang = nat.angle(want)
            lim = math.radians(self.p['weapon_max'])
            if ang > lim:
                ax = nat.cross(want)
                if ax.length < 1e-6:
                    ax = nat.orthogonal()
                want = Quaternion(ax.normalized(), lim) @ nat
            o1 = dict(kw['orient'])
            r = o1['R_Hand']
            o1['R_Hand'] = (r[0], tuple(want), r[2], r[3])
            kw['orient'] = o1
            self._wdir = tuple(want)
        w = float(self.p['grip_w'])
        if w <= 1e-3 or 'Weapon' not in A.REST:
            return self.rig.pose(memory=memory, **kw)
        first = self.rig.pose(memory=None, **kw)
        held = self._grip(first, kw, memory)
        if w >= 0.999:
            return held
        free = self.rig.pose(memory=None, **kw)
        e = w * w * (3 - 2 * w)
        for name in A.LEFT_ARM:
            a, b = free[name], held[name]
            if a.dot(b) < 0:
                b = -b
            held[name] = a.slerp(b, e)
        return held

    def _grip(self, first, kw, memory):
        """Close the left fist on the haft `grip_l` yards from the right grip: the
        wrist is solved onto the haft and the hand is swung (never rolled) so its
        length crosses the haft square, the fingers curled round it."""
        up = (first.delta['R_Hand'] @ V(A.WEAPON_AXIS)).normalized()
        kw = dict(kw)
        twist = dict(kw['twist'])
        twist.pop('L_Forearm', None)
        twist.pop('L_Hand', None)
        kw['twist'] = twist
        turns = dict(kw['turns'])
        for k, v in finger_turns(78, 92, 50, 0.0).items():
            turns[k] = v
        turns.pop('L_Hand', None)
        kw['turns'] = turns
        ik = dict(kw['ik'])
        aims = dict(kw['aims'])
        pose = first
        for _ in range(3):
            fd = pose.head['L_Hand'] - pose.head['L_Forearm']
            d = fd - up * fd.dot(up)
            if d.length > 1e-4:
                aims['L_Hand'] = d.normalized()
            kw['aims'] = aims
            S = weapon_world(pose, self.p['grip_l'])
            q = pose.delta['L_Hand']
            tgt = np.array(S) - np.array(q @ V(A.GRIP_OFFSET_L))
            ik['armL_'] = ('L_UpperArm', 'L_Forearm', tuple(tgt), tuple(self.p['pole_l']))
            kw['ik'] = ik
            pose = self.rig.pose(memory=None, **kw)
        return self.rig.pose(memory=memory, **kw)

    def _best_pole(self, kw, memory, side):
        """Turn the elbow's pole round the shoulder-to-wrist line until the oriented
        hand needs the least wrist and forearm roll (the elbow goes where the grip
        wants it), never far from the authored pole and never far from last frame's."""
        key = 'arm' + side
        up, lo, tgt, pole = kw['ik'][key]
        first = self.rig.pose(memory=None, **kw)
        sh = first.head[up]
        axis = (V(tgt) - sh)
        if axis.length < 1e-4:
            return kw
        axis.normalize()
        prev = memory.get('#pole' + side).x if memory is not None and ('#pole' + side) in memory else None

        def tw(q):
            a = math.degrees(2 * math.atan2(q.y, q.w))
            return abs((a + 180) % 360 - 180)
        best = None
        for th in range(-150, 151, 10):
            p2 = Quaternion(axis, math.radians(th)) @ V(pole)
            ik = dict(kw['ik'])
            ik[key] = (up, lo, tgt, tuple(p2))
            k2 = dict(kw)
            k2['ik'] = ik
            pz = self.rig.pose(memory=None, **k2)
            c = max(tw(pz[side + 'Hand']), tw(pz[side + 'Forearm']) * 0.9, tw(pz[up]) * 0.8) + 0.12 * abs(th)
            if prev is not None:
                c += 0.5 * abs(th - prev)
            if best is None or c < best[0]:
                best = (c, th, k2)
        if memory is not None:
            memory['#pole' + side] = V((best[1], 0.0, 0.0))
        return best[2]


def weapon_world(pose, t):
    """Armature-space point `t` yards along the weapon from the right grip."""
    q = pose.delta['Weapon']
    return np.array(pose.head['Weapon'] + q @ (V(A.WEAPON_AXIS) * t))


# ------------------------------------------------------------------ easing and sampling
EASE_FN = {
    'auto': lambda u: u * u * (3 - 2 * u),
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'in': lambda u: u ** 2.2,
    'quadin': lambda u: u * u,
    'expoin': lambda u: u ** 3.2,
    'out': lambda u: 1 - (1 - u) ** 2.2,
    'backout': lambda u: 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2,
    'linear': lambda u: u,
    'hold': lambda u: 0.0,
}


def sample(seq, t):
    """The Body at time t of a key list [(t, Body, ease)]: the segment's two keys
    mixed with the ease named on the segment's FIRST key."""
    if t <= seq[0][0]:
        return seq[0][1]
    for (t0, b0, e0), (t1, b1, _) in zip(seq, seq[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / max(1e-9, t1 - t0)
            return b0.mix(b1, EASE_FN[e0](u))
    return seq[-1][1]


def write_clip(arm, rig, name, fn, duration, loop=False, follow=True, wind=0.0):
    """Key `fn(t) -> Body` (or a pose dict) every frame over `duration` seconds."""
    n = int(round(duration * R.FPS))
    memory = {}
    keys = []
    # a loop is solved twice so the IK memory on frame 0 already knows the end
    passes = (0, 1) if loop else (1,)
    for p_ in passes:
        keys = []
        for i in range(n + 1):
            # a loop's last frame is exactly its first (the cycle is fitted to whole frames)
            t = i * duration / n if loop else i / R.FPS
            b = fn(t)
            pose = b.pose(memory if STATEFUL_IK else None) if isinstance(b, Body) else b
            keys.append((i / R.FPS, pose, 'linear'))
    steady(keys, loop)
    soften(keys, loop)
    act = R.make_clip(arm, name, keys)
    act['duration'] = n / R.FPS
    act['loop'] = bool(loop)
    if follow and R.CHAINS:
        R.follow_through(arm, act, loop=loop, wind=wind)
    return act


STEADY_KEYS = ('Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand')
STEADY_LIMIT = 0.8


def _rv(q):
    if q.w < 0:
        q = -q
    ax, ang = q.to_axis_angle()
    return np.array(ax) * math.degrees(ang)


def steady(keys, loop=False, passes=80):
    """Take the zig-zag out of the arm bones: wherever a bone's angular acceleration
    flips against both neighbours by more than STEADY_LIMIT (deg/frame^2), the frame is
    eased toward the midpoint of its neighbours. An impact (one flip) is left alone."""
    names = [n for n in keys[0][1].keys() if any(k in n for k in STEADY_KEYS)]
    n = len(keys)
    if n < 5:
        return
    for name in names:
        qs = [Quaternion(k[1][name]) for k in keys]
        for _ in range(passes):
            w = [_rv(qs[i + 1] @ qs[i].inverted()) for i in range(n - 1)]
            acc = [w[i + 1] - w[i] for i in range(n - 2)]
            bad = set()
            for i in range(1, len(acc) - 1):
                if acc[i - 1] @ acc[i] < 0 and acc[i] @ acc[i + 1] < 0:
                    s_ = min(np.linalg.norm(acc[i - 1]), np.linalg.norm(acc[i]), np.linalg.norm(acc[i + 1]))
                    if s_ > STEADY_LIMIT:
                        bad.update((i, i + 1, i + 2))
            bad = [i for i in sorted(bad) if 0 < i < n - 1]
            if not bad:
                break
            new = list(qs)
            for i in bad:
                a, b = qs[i - 1], qs[i + 1]
                if a.dot(b) < 0:
                    b = -b
                mid = a.slerp(b, 0.5)
                q = qs[i]
                if q.dot(mid) < 0:
                    mid = -mid
                new[i] = q.slerp(mid, 0.6)
            qs = new
        for k, q in zip(keys, qs):
            k[1][name] = q


SOFT_KEYS = ('Spine', 'Neck', 'Head', 'Clavicle', 'UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'Thumb', 'Index',
             'Middle', 'Ring', 'Little', 'Finger', 'Tail', 'Wing', 'Crest', 'Jaw')


def soften(keys, loop=False, passes=2):
    """A light [1 2 1] filter over the upper body's local rotations (never the legs,
    so planted feet stay planted): no zig-zag survives it, a blow keeps its snap."""
    n = len(keys)
    if n < 4:
        return
    names = [nm for nm in keys[0][1].keys() if any(k in nm for k in SOFT_KEYS)]
    for name in names:
        qs = [Quaternion(k[1][name]) for k in keys]
        for _ in range(passes):
            new = list(qs)
            for i in range(n):
                if not loop and (i == 0 or i == n - 1):
                    continue
                a, b = qs[(i - 1) % n], qs[(i + 1) % n]
                if loop and (i == 0 or i == n - 1):
                    a, b = qs[(i - 1) % (n - 1)], qs[(i + 1) % (n - 1)]
                q = qs[i]
                if a.dot(q) < 0:
                    a = -a
                if b.dot(q) < 0:
                    b = -b
                avg = Quaternion((a.w + 2 * q.w + b.w, a.x + 2 * q.x + b.x, a.y + 2 * q.y + b.y, a.z + 2 * q.z + b.z))
                avg.normalize()
                new[i] = avg
            qs = new
        for k, q in zip(keys, qs):
            k[1][name] = q


def keyed(seq):
    """fn(t) for a key list (weapon directions resolved into wrist angles first)."""
    seq = aimed_keys(seq)
    for t, b, e in seq:
        if getattr(b, 'aim_err', 0) > 25:
            print(f'AIM_WARN key {t:.2f} misses its weapon direction by {b.aim_err:.0f} deg', flush=True)
    return lambda t: sample(seq, t)


# ------------------------------------------------------------------ gait helpers
def _pitched(v, deg):
    c, s = math.cos(math.radians(-deg)), math.sin(math.radians(-deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def planted_ankle_z(pitch):
    """Ankle height that keeps the sole on the ground when the foot pitches (heel down
    for positive pitch: toes up; ball down for negative: heel up)."""
    if pitch >= 0:
        heel = _pitched(A.HEEL_OFF, pitch)
        return A.SOLE_Z + (A.HEEL_OFF[2] - heel[2])
    ball = _pitched(A.BALL_OFF, pitch)
    return A.SOLE_Z + (A.BALL_OFF[2] - ball[2])


def gait_foot(phase, stance_frac, y_front, y_back, lift, side, x_out, heel_roll=30.0, toe_up=12.0):
    """(ankle target, foot pitch, toe turn) of one foot of an in-place gait cycle."""
    s = 1 if side > 0 else -1
    if phase < stance_frac:
        u = phase / stance_frac
        y = y_front + (y_back - y_front) * u
        heel = max(0.0, (u - 0.74) / 0.26)
        pitch = toe_up * max(0.0, 1 - u / 0.14) - heel_roll * heel
        z = planted_ankle_z(pitch)
        toe = heel_roll * 0.95 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = y_back + (y_front - y_back) * e
        pitch = -heel_roll * (1 - smooth(u * 1.6)) + toe_up * smooth((u - 0.45) / 0.55)
        z = planted_ankle_z(pitch) + lift * math.sin(math.pi * u) ** 1.3
        toe = heel_roll * 0.95 * (1 - smooth(u * 2.5))
    return (x_out * s, y, z), pitch, -toe


# ------------------------------------------------------------------ aiming a rigid weapon by the wrist
def aim_weapon(b, roll_lim=110.0, dev_lim=40.0, flex_lim=55.0, prev=None):
    """Turn a Body that names a `weapon` direction into one that reaches it with the
    right forearm's roll (`hand_roll_r`) and the wrist's deviation and flexion
    (`wrist_r`), each within an anatomical range: the weapon then simply rides the
    fist, so it can never twist the wrist like a towel. Keys are resolved once and
    the frames between interpolate these angles (continuous by construction)."""
    if b.p['weapon'] is None:
        return b
    want = V(_n(b.p['weapon']))
    base = b.but(weapon=None, hand_roll_r=0.0, wrist_r=(0.0, 0.0), hand_dir_r=None)
    pose = base.pose({})
    Df = pose.delta['R_Forearm']
    fa = (V(A.REST['R_Forearm'][1]) - V(A.REST['R_Forearm'][0])).normalized()
    ha = (V(A.REST['R_Hand'][1]) - V(A.REST['R_Hand'][0])).normalized()
    w_, down_, width_, palm_ = A.hand_frame(-1)
    pa, wa = V(palm_ * -1), V(width_ * -1)
    ax = V(A.WEAPON_AXIS)
    best = None
    rolls = np.arange(-roll_lim, roll_lim + 0.1, 10.0)
    devs = np.arange(-dev_lim, dev_lim + 0.1, 8.0)
    flexs = np.arange(-flex_lim, flex_lim + 0.1, 11.0)
    for r in rolls:
        Df2 = Df @ Quaternion(fa, math.radians(PRONATE * r * -1))
        tw_h = Quaternion(ha, math.radians((1 - PRONATE) * r * -1))
        for d in devs:
            Qp = Quaternion(pa, math.radians(d))
            for f in flexs:
                q = Quaternion(wa, math.radians(f)) @ Qp @ tw_h
                blade = Df2 @ q @ ax
                c = math.degrees(blade.angle(want)) + 0.22 * abs(r) + 0.2 * abs(d) + 0.14 * abs(f)
                if prev is not None:
                    c += 0.05 * (abs(r - prev[0]) + abs(d - prev[1]) + abs(f - prev[2]))
                if best is None or c < best[0]:
                    best = (c, r, d, f, math.degrees(blade.angle(want)))
    _, r, d, f, err = best
    out = b.but(weapon=None, hand_roll_r=float(r), wrist_r=(float(d), float(f)))
    out.aim_err = err
    return out


def aimed_keys(keys):
    """Resolve every key's weapon direction into wrist angles (see aim_weapon)."""
    out = []
    prev = None
    memo = {}
    for t, b, e in keys:
        if id(b) in memo:
            out.append((t, memo[id(b)], e))
            continue
        nb = aim_weapon(b, prev=None)
        memo[id(b)] = nb
        if nb is not b:
            prev = (nb.p['hand_roll_r'], nb.p['wrist_r'][0], nb.p['wrist_r'][1])
        out.append((t, nb, e))
    return out
