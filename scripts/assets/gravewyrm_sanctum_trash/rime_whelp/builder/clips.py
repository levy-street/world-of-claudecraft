"""Korzul's clips, keyed from a whole-body great-wyrm pose language.

`Body(**params)` turns a few dozen readable numbers into a full pose: where the
body sits and how it pitches and rolls (about a chosen PIVOT), how the spine bends
and arches, how the neck rises, coils (an S) and turns, where the head looks and
how wide the jaw opens, how the tail lifts, swings, curls and waves (spread down
its twelve bones), where each foot stands (two-bone IK), and how each wing folds,
beats, sweeps, flexes and fans (forward kinematics: never a flip).

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body, so arcs stay arcs.

Axes: armature space, yards, +Z up, he faces -Y, his left is +X.
Signs: `pitch` + noses up; `roll` + rolls onto his LEFT side; `yaw` + turns left;
`neck_raise` + lifts the neck; `neck_s` + coils it into a deeper S (the base up,
the top forward and down); `head_pitch` + lifts the nose; `jaw` + opens (deg);
`tail_lift` + lifts the tail; `tail_yaw` + swings it to his LEFT. Wings: `fold`
0 spread (rest) to 1 folded on the flanks; `beat` + raises the wing (deg);
`sweep` + swings it forward (deg); `flex` + folds the hand back (deg); `fan` 1 is
the rest spread of the fingers, below 1 closes them.

CONTRACT lines name the frames the game should read.
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
FP0 = np.array(A.FPAW)
HP0 = np.array(A.HPAW)
PAW_Z = float(A.FPAW[2])
HAND_DIR = A.REST['L_Hand'][1] - A.REST['L_Hand'][0]
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
FTOE_DIR = A.REST['L_FToes'][1] - A.REST['L_FToes'][0]
HTOE_DIR = A.REST['L_HToes'][1] - A.REST['L_HToes'][0]
L_HAND = float(np.linalg.norm(HAND_DIR))
L_FOOT = float(np.linalg.norm(FOOT_DIR))
JAW_GAIN = 0.6
NECK_W = (0.22, 0.2, 0.17, 0.15, 0.14, 0.12)
NECK_SW = (0.34, 0.24, 0.08, -0.12, -0.24, -0.3)
SPINE_W = (0.3, 0.35, 0.35)
TAIL_W = (0.16, 0.14, 0.12, 0.1, 0.09, 0.08, 0.07, 0.06, 0.06, 0.05, 0.04, 0.03)
FLY_H = 6.0           # the hover: the Root rides this high in every airborne clip (chest about 16 yd up)
ICE_BONES = [b[0] for b in A.ICE_SHED]
WING = ('Humerus', 'WElbowFix', 'WForearm', 'WHand', 'Thumb', 'F1a', 'F1b', 'F2a', 'F2b', 'F3a', 'F3b', 'F4a', 'F4b')


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def rot_x(v, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def body_matrix(yaw, pitch, roll):
    q = Quaternion((0, 0, 1), math.radians(yaw))
    q = Quaternion((1, 0, 0), math.radians(-pitch)) @ q
    q = Quaternion((0, 1, 0), math.radians(roll)) @ q
    return q


def fdir(deg, front=True):
    return tuple(rot_x(HAND_DIR if front else FOOT_DIR, deg) / (L_HAND if front else L_FOOT))


def tdir(deg, front=True):
    d = rot_x(FTOE_DIR if front else HTOE_DIR, deg)
    return tuple(d / np.linalg.norm(d))


# ------------------------------------------------------------------ the folded wing
def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


FOLD_DIRS = {  # left wing, armature space, body at rest: (direction, membrane normal)
    'Humerus': ((0.36, 0.42, 0.83), (1.0, 0.0, -0.2)),
    'WForearm': ((0.14, -0.86, -0.49), (1.0, 0.1, 0.1)),
    'WHand': ((0.28, -0.25, -0.93), (0.95, 0.0, 0.3)),
    'Thumb': ((0.25, -0.62, -0.74), (0.95, 0.0, 0.3)),
    'F1a': ((0.06, 0.975, -0.2), (0.95, 0.0, 0.32)), 'F1b': ((0.05, 0.985, -0.17), (0.95, 0.0, 0.32)),
    'F2a': ((0.1, 0.95, -0.3), (0.95, 0.0, 0.32)), 'F2b': ((0.09, 0.94, -0.33), (0.95, 0.0, 0.32)),
    'F3a': ((0.13, 0.9, -0.42), (0.95, 0.0, 0.32)), 'F3b': ((0.12, 0.87, -0.47), (0.95, 0.0, 0.32)),
    'F4a': ((0.16, 0.8, -0.58), (0.95, 0.0, 0.32)), 'F4b': ((0.14, 0.74, -0.66), (0.95, 0.0, 0.32)),
}


def fold_quats(rig):
    """Local turns (in each bone's parent-carried armature axes) that take each wing
    bone from rest to the folded pose: {bone: Quaternion}, both sides."""
    out = {}
    for s, pre in ((1, 'L_'), (-1, 'R_')):
        delta = {'Chest': Quaternion()}
        for b in WING:
            name = pre + b
            parent = rig.parent[name]
            if b == 'WElbowFix':
                continue
            h, t = rig.rest[name]
            rest_y = (t - h).normalized()
            rf = rig._frame(rest_y, Vector((0, 0, 1)))
            d, up = FOLD_DIRS[b]
            d = Vector(tuple(_unit((d[0] * s, d[1], d[2]))))
            up = Vector(tuple(_unit((up[0] * s, up[1], up[2]))))
            wf = rig._frame(d, up)
            dq = (wf @ rf.transposed()).to_quaternion()
            delta[name] = dq
            dp = delta.get(parent, Quaternion())
            out[name] = dp.inverted() @ dq
    return out


# ------------------------------------------------------------------ the pose language
class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0), pivot=(0.0, 1.0, 10.0),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_pitch=0.0, hip_roll=0.0, hip_yaw=0.0,
        spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0, arch=0.0,
        neck_raise=0.0, neck_s=0.0, neck_yaw=0.0, neck_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0,
        tail_lift=0.0, tail_yaw=0.0, tail_curl=0.0, tail_droop=0.0, tail_wave=0.0, tail_phase=0.0, tail_flick=0.0,
        scap_l=0.0, scap_r=0.0,
        fl=tuple(FP0), fr=tuple(A.mirror(FP0)), hl=tuple(HP0), hr=tuple(A.mirror(HP0)),
        fd_fl=0.0, fd_fr=0.0, fd_hl=0.0, fd_hr=0.0,
        td_fl=0.0, td_fr=0.0, td_hl=0.0, td_hr=0.0,
        pole_f=(0.1, 1.0, 0.0), pole_h=(0.1, -1.0, 0.0),
        fold_l=1.0, fold_r=1.0, beat_l=0.0, beat_r=0.0, sweep_l=0.0, sweep_r=0.0, flex_l=0.0, flex_r=0.0,
        fan_l=1.0, fan_r=1.0, tipw_l=0.0, tipw_r=0.0, twist_l=0.0, twist_r=0.0,
        ice=0.0, ground=1.0,
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
            if k not in b.p:
                raise KeyError(k)
            b.p[k] = v
        return b

    def root(self):
        p = self.p
        q = body_matrix(p['yaw'], p['pitch'], p['roll'])
        piv = V(p['pivot'])
        return V(p['pelvis']) + piv - q @ piv, q

    def to_world(self, rest_point):
        root, q = self.root()
        return np.array(q @ V(rest_point) + root)

    def _wing(self, side, turns, locq):
        p = self.p
        k = side[0].lower()
        s = 1 if side == 'L_' else -1
        fold = max(0.0, min(1.0, p['fold_' + k]))
        beat, sweep, flex, fan = p['beat_' + k], p['sweep_' + k], p['flex_' + k], p['fan_' + k]
        tipw, twist = p['tipw_' + k], p['twist_' + k]
        FQ = self.rig.fold_q

        def t(axis, deg):
            a = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
            if s < 0:
                return ((a[0], -a[1], -a[2]), deg)
            return (a, deg)
        for b in WING:
            name = side + b
            if b == 'WElbowFix':
                continue
            locq[name] = Quaternion().slerp(FQ[name], fold)
        turns[side + 'Humerus'] = [t('x', twist), t('z', sweep), t('y', -beat)]
        turns[side + 'WForearm'] = [t('z', flex * 0.45), t('y', -tipw * 0.4)]
        turns[side + 'WHand'] = [t('z', flex * 0.55), t('y', -tipw * 0.35)]
        for j, f in enumerate(('F1', 'F2', 'F3', 'F4')):
            close = (fan - 1.0) * (0.0, 9.0, 20.0, 30.0)[j]
            turns[side + f + 'a'] = [t('z', close), t('y', -tipw * 0.25)]
            turns[side + f + 'b'] = [t('y', -tipw * 0.3)]

    def solve(self, memory=None):
        p = self.p
        turns, aims, ik, locq = {}, {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', -p['hip_pitch']), ('z', p['hip_yaw']), ('y', p['hip_roll'])]
        arch = (p['arch'] * 0.55, 0.0, -p['arch'] * 0.7)
        for (b, w), ar in zip((('Spine1', SPINE_W[0]), ('Spine2', SPINE_W[1]), ('Chest', SPINE_W[2])), arch):
            turns[b] = [('x', -(p['spine_pitch'] * w + ar)), ('z', p['spine_yaw'] * w), ('y', p['spine_roll'] * w)]
        for i, (w, sw) in enumerate(zip(NECK_W, NECK_SW)):
            turns[f'Neck{i + 1}'] = [('x', -(p['neck_raise'] * w + p['neck_s'] * sw)), ('z', p['neck_yaw'] * w),
                                     ('y', p['neck_roll'] * w)]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        n = len(TAIL_W)
        for i, w in enumerate(TAIL_W):
            k = i / (n - 1)
            wave = p['tail_wave'] * math.sin(p['tail_phase'] - i * 0.55) * (0.3 + 0.7 * k)
            yaw = p['tail_yaw'] * w + p['tail_curl'] * k * 0.12 + wave
            lift = p['tail_lift'] * w - p['tail_droop'] * k * 0.12 + p['tail_flick'] * max(0.0, k - 0.6) * 0.8
            if i < 3:                  # the tail root counters a nose-up pitch, so the tail clears the ice
                lift += max(0.0, p['pitch']) * (0.5, 0.3, 0.2)[i] * p['ground']
            turns[f'Tail{i + 1}'] = [('x', lift), ('z', -yaw)]
        turns['L_Scapula'] = [('x', -p['scap_l'])]
        turns['R_Scapula'] = [('x', -p['scap_r'])]
        for side, s, key_f, key_h in (('L_', 1, 'fl', 'hl'), ('R_', -1, 'fr', 'hr')):
            pf = (p['pole_f'][0] * s, p['pole_f'][1], p['pole_f'][2])
            ph = (p['pole_h'][0] * s, p['pole_h'][1], p['pole_h'][2])
            hd = np.array(fdir(p['fd_' + key_f], True))
            fd = np.array(fdir(p['fd_' + key_h], False))
            ff, fh = np.array(p[key_f], float), np.array(p[key_h], float)
            if p['ground'] > 0.5:      # a foot target never sinks under the ice (spline overshoot)
                ff[2] = max(ff[2], PAW_Z)
                fh[2] = max(fh[2], PAW_Z)
            wrist = ff - hd * L_HAND
            hock = fh - fd * L_FOOT
            ik['f' + side] = (side + 'UpperArm', side + 'Forearm', tuple(wrist), pf)
            ik['h' + side] = (side + 'Thigh', side + 'Shin', tuple(hock), ph)
            aims[side + 'Hand'] = V(tuple(hd))
            aims[side + 'Foot'] = V(tuple(fd))
            aims[side + 'FToes'] = V(tdir(p['td_' + key_f], True))
            aims[side + 'HToes'] = V(tdir(p['td_' + key_h], False))
            self._wing(side, turns, locq)
        root, _ = self.root()
        ice = max(1e-4, min(1.0, p['ice']))
        scale = {b: ice for b in ICE_BONES}
        return self.rig.pose(aims=aims, ik=ik, turns=turns, root=tuple(root), mirror=False, memory=memory,
                             locq=locq, scale=scale)


# ------------------------------------------------------------------ interpolation
def lerp_body(b0, b1, u):
    out = b0.but()
    for k, a in b0.p.items():
        o = b1.p[k]
        if isinstance(a, (tuple, list, np.ndarray)):
            out.p[k] = tuple(float(x) + (float(y) - float(x)) * u for x, y in zip(a, o))
        else:
            out.p[k] = a + (o - a) * u
    return out


def cr_body(bs, u):
    u2, u3 = u * u, u * u * u
    w = (0.5 * (-u + 2 * u2 - u3), 0.5 * (2 - 5 * u2 + 3 * u3), 0.5 * (u + 4 * u2 - 3 * u3), 0.5 * (-u2 + u3))
    out = bs[1].but()
    for k in bs[1].p:
        vals = [b.p[k] for b in bs]
        if isinstance(vals[0], (tuple, list, np.ndarray)):
            acc = sum(wi * np.asarray(v, float) for wi, v in zip(w, vals))
            out.p[k] = tuple(acc.tolist())
        else:
            out.p[k] = float(sum(wi * v for wi, v in zip(w, vals)))
    # the folds and the ice must not overshoot their range
    for k in ('fold_l', 'fold_r', 'ice'):
        out.p[k] = max(0.0, min(1.0, out.p[k]))
    return out


EASE_FN = {
    'in': lambda u: u ** 3,
    'quadin': lambda u: u * u,
    'out': lambda u: 1 - (1 - u) ** 3,
    'quadout': lambda u: 1 - (1 - u) ** 2,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'linear': lambda u: u,
}


def sample(seq, t, loop=False):
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
        return lerp_body(b0, b1, EASE_FN[ease](u))
    if loop:
        bm = seq[i - 1][1] if i > 0 else seq[-2][1]
        bp = seq[i + 2][1] if i + 2 < n else seq[1][1]
    else:
        bm = seq[i - 1][1] if i > 0 else b0
        bp = seq[i + 2][1] if i + 2 < n else b1
    return cr_body([bm, b0, b1, bp], u)


# The wings are 25 yards long: a fold or a beat keyed fast whips the finger tips
# round faster than the eye reads weight. Their parameters are low-passed per frame
# (a Gaussian, circular on loops) before the solve, so the wings follow through.
WING_SMOOTH = {'fold_l': 3.0, 'fold_r': 3.0, 'beat_l': 1.4, 'beat_r': 1.4, 'sweep_l': 1.4, 'sweep_r': 1.4,
               'tipw_l': 1.2, 'tipw_r': 1.2, 'flex_l': 2.0, 'flex_r': 2.0, 'fan_l': 2.0, 'fan_r': 2.0}


def _lowpass(bodies, loop):
    n = len(bodies)
    if n < 4:
        return bodies
    for k, sig in WING_SMOOTH.items():
        x = np.array([b.p[k] for b in bodies], float)
        r = int(math.ceil(3 * sig))
        w = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2)
        w /= w.sum()
        if loop:
            core = x[:-1]
            pad = np.concatenate([core[-r:], core, core[:r]]) if len(core) > r else np.pad(core, r, mode='wrap')
            y = np.convolve(pad, w, mode='valid')
            y = np.append(y, y[0])
        else:
            y = np.convolve(np.pad(x, r, mode='edge'), w, mode='valid')
        for b, v in zip(bodies, y):
            b.p[k] = float(v)
    return bodies


def keys_of(seq, loop=False, post=None):
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out, memory = [], {}
    bodies = _lowpass([sample(seq, f / R.FPS, loop).but() for f in range(nfr + 1)], loop)
    if loop:
        for f in range(nfr + 1):
            bodies[f].solve(memory)
    poses = []
    for f in range(nfr + 1):
        t = f / R.FPS
        b = bodies[f]
        pose = b.solve(memory)
        if post:
            post(pose, t, b)
        poses.append(pose)
    poses = steady(poses, seq[0][1].rig)
    return [(f / R.FPS, p, 'linear') for f, p in enumerate(poses)]


# ------------------------------------------------------------------ steadying (the Balgath tremor fix)
STEADY_BONES = [s + b for s in ('L_', 'R_') for b in ('UpperArm', 'ElbowFix', 'Forearm', 'Hand', 'FToes', 'Thigh',
                                                          'KneeFix', 'Shin', 'Foot', 'HockFix', 'HToes')]
STEADY_LIMIT = 1.0


def steady(poses, rig, passes=24):
    """Take any frame-to-frame zig-zag out of the IK limbs (jitter.py's pattern: an
    angular acceleration flipping against both neighbours); a single hard stop is one
    flip and keeps its snap. Works on the LOCAL turn, parents first."""
    import jitter as J
    n = len(poses)
    if n < 5:
        return poses

    def aligned(qs):
        qs = [Quaternion(q) for q in qs]
        for i in range(1, len(qs)):
            if qs[i].dot(qs[i - 1]) < 0:
                qs[i].negate()
        return qs

    for name in STEADY_BONES:
        parent = rig.parent[name]
        rest_m = rig.frames[name]
        local = aligned([(rest_m @ p[name].to_matrix() @ rest_m.inverted()).to_quaternion() for p in poses])
        touched = False
        for _ in range(passes):
            world = aligned([p.delta[parent] @ q for p, q in zip(poses, local)])
            flagged = J.zigzag_frames(world, STEADY_LIMIT)
            if not flagged:
                break
            new = list(local)
            for i in flagged:
                if 0 < i < n - 1:
                    new[i] = local[i - 1].slerp(local[i + 1], 0.5).slerp(local[i], 0.5)
            local = new
            touched = True
        if touched:
            for p, q in zip(poses, local):
                p[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
                p.delta[name] = p.delta[parent] @ q
    return poses


# ------------------------------------------------------------------ stance and gaits
def stance(rig):
    """Standing on the lake: the neck in a proud S, the head low and level, the wings
    folded on the flanks, the tail low in a long curve."""
    return Body(rig, neck_raise=-4.0, neck_s=6.0, head_pitch=-8.0, tail_lift=4.0, tail_droop=4.0, tail_yaw=6.0,
                tail_curl=10.0, jaw=2.0)


def gait_foot(phase, stance_frac, half, lift, rest, front, reach=0.0, famp=None):
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        y = rest[1] - half + 2 * half * u
        z = PAW_Z
        heel = smooth((u - 0.7) / 0.3)
        fd = (-24 if front else -20) * heel
        td = -10 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = rest[1] + half - (2 * half + reach) * e + reach * smooth((u - 0.75) / 0.25)
        z = PAW_Z + lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.6
        if front:
            fold = math.sin(math.pi * min(1.0, max(0.0, u - 0.06) / 0.56)) if u < 0.62 else 0.0
        else:
            fold = math.sin(math.pi * min(1.0, u * 1.25)) if u < 0.8 else 0.0
        carry = 1.0 - smooth(u / 0.22)          # the push-off's wrist and toe turn eases out, no jump
        fd = (famp if famp is not None else (34 if front else 26)) * fold - (6 if front else 3) * smooth((u - 0.75) / 0.25)
        fd += (-24 if front else -20) * carry
        td = fd * 0.5 + 10 * fold * smooth(u / 0.3) - 10 * carry
    return (rest[0], y, z), fd, td


def gait_body(rig, ph, period, speed, stance_frac, lift, phases, base, wave=5.0, bob=0.2, roll=1.8):
    half = speed * stance_frac * period / 2
    kw = {}
    for key, rest, front in (('fl', FP0, True), ('fr', A.mirror(FP0), True), ('hl', HP0, False),
                             ('hr', A.mirror(HP0), False)):
        f, fd, td = gait_foot((ph - phases[key]) % 1.0, stance_frac, half, lift, rest, front)
        kw[key] = f
        kw['fd_' + key] = fd
        kw['td_' + key] = td
    w = TAU * ph
    p0 = base.p
    return base.but(
        pelvis=(p0['pelvis'][0] + 0.18 * math.sin(w - 0.6), p0['pelvis'][1], p0['pelvis'][2] - bob * math.cos(2 * w)),
        roll=p0['roll'] - roll * math.sin(w - 0.6), hip_roll=2.0 * math.sin(w), spine_roll=-1.8 * math.sin(w),
        spine_yaw=2.2 * math.sin(w), hip_yaw=-2.6 * math.sin(w),
        scap_l=p0['scap_l'] + 5 * math.sin(w - TAU * phases['fl']),
        scap_r=p0['scap_r'] + 5 * math.sin(w - TAU * phases['fr']),
        neck_raise=p0['neck_raise'] + 1.6 * math.cos(2 * w), neck_yaw=-3.0 * math.sin(w),
        head_pitch=p0['head_pitch'] - 2.0 * math.cos(2 * w), head_yaw=2.4 * math.sin(w),
        tail_yaw=p0['tail_yaw'] * 0.3 + 6 * math.sin(w), tail_wave=wave, tail_phase=w,
        beat_l=p0['beat_l'] + 2.0 * math.cos(2 * w + 0.6), beat_r=p0['beat_r'] + 2.0 * math.cos(2 * w + 0.6), **kw)


WALK_PERIOD, WALK_SPEED, WALK_STANCE = 2.2, 4.8, 0.66
WALK_PHASES = dict(hl=0.0, fl=0.25, hr=0.5, fr=0.75)


def walk(rig):
    base = stance(rig).but(neck_raise=-7, head_pitch=-4)
    nfr = int(round(WALK_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, WALK_PERIOD, WALK_SPEED, WALK_STANCE, 1.5, WALK_PHASES, base),
            'linear') for i in range(nfr + 1)]
    return keys_of(seq)


def idle(rig, period=6.0):
    """Breathing (three slow heavy breaths, the wings lifting with each), the neck
    swaying, the head turning to scan the shore, a tail sweep with a curl of the tip."""
    base = stance(rig)
    seq = []
    n = 24
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(3 * w)
        look = smooth((ph - 0.3) / 0.12) * (1 - smooth((ph - 0.6) / 0.12))
        seq.append((period * ph, base.but(
            pelvis=(0.1 * math.sin(w), 0.0, -0.08 * br), spine_pitch=0.8 * br, arch=1.0 * br, scap_l=1.5 * br,
            scap_r=1.5 * br, neck_raise=-4 + 2.5 * math.sin(w + 0.4) + 1.2 * br, neck_s=6 + 1.5 * math.sin(w),
            neck_yaw=5 * math.sin(w) + 12 * look, head_yaw=4 * math.sin(w + 0.9) + 12 * look,
            head_pitch=-8 + 2.5 * math.sin(2 * w + 0.5), head_roll=-4 * look, jaw=2 + 3 * max(0.0, br),
            tail_yaw=6 + 8 * math.sin(w + 1.2), tail_wave=4, tail_phase=w, tail_lift=4 + 1.5 * br,
            tail_curl=10 + 6 * math.sin(w), beat_l=2.5 * br, beat_r=2.5 * br), 'auto'))
    return keys_of(seq, loop=True)


def lifted(b, key, rest, offset, fd, td):
    return b.but(**{key: tuple(b.to_world(np.asarray(rest) + np.asarray(offset))), 'fd_' + key: fd,
                    'td_' + key: fd + td})


# ------------------------------------------------------------------ strikes
BITE_T = 0.62


def bite(rig):
    """Bite (the auto attack). CONTRACT: the jaws close on the target at 0.62 s."""
    st = stance(rig)
    gather = st.but(pelvis=(0, 0.6, -0.3), neck_raise=10, neck_s=16, head_pitch=6, jaw=26, tail_lift=8, arch=3,
                    scap_l=5, scap_r=5)
    lunge = st.but(pelvis=(0, -1.3, -0.8), pitch=-3, neck_raise=-14, neck_s=-6, head_pitch=-12, jaw=38, arch=-3,
                   tail_lift=10, scap_l=-6, scap_r=-6)
    snap = lunge.but(pelvis=(0, -1.5, -0.85), jaw=3, neck_raise=-17, head_pitch=-16)
    shake = [(0.84, snap.but(neck_yaw=9, head_yaw=7, head_roll=10, jaw=4)),
             (1.02, snap.but(neck_yaw=-8, head_yaw=-6, head_roll=-9, jaw=4))]
    seq = [(0.0, st, 'auto'), (0.32, gather, 'inout'), (0.5, lunge, 'quadin'), (BITE_T, snap, 'inout')]
    seq += [(t, b, 'auto') for t, b in shake]
    seq += [(1.3, st.but(pelvis=(0, -0.5, -0.2), jaw=8), 'auto'), (1.7, st, 'auto')]
    return keys_of(seq)


CLAW_T = 0.76


def claw(rig):
    """Claw: the right forefoot rakes across the front, from his right to his left.
    CONTRACT: the claws pass through the target in front of him at 0.76 s."""
    st = stance(rig)
    rp = A.mirror(FP0)
    load = st.but(pelvis=(0.5, 0.6, -0.2), pitch=5, pivot=(0, 6.0, 1.0), roll=-5, neck_raise=4, neck_s=8,
                  head_pitch=-2, head_yaw=-12, neck_yaw=-6, jaw=20, tail_yaw=-18, beat_r=10)
    load = lifted(load, 'fr', rp, (-1.4, 0.0, 4.2), 50, -30)
    cock = load.but(pitch=8, roll=-7, head_yaw=-16, jaw=28)
    cock = lifted(cock, 'fr', rp, (-2.6, 0.4, 5.6), 40, -40)
    strike = st.but(pelvis=(-0.3, -0.8, -0.5), pitch=3, pivot=(0, 6.0, 1.0), roll=4, neck_raise=-6, neck_s=2,
                    head_pitch=-10, head_yaw=10, neck_yaw=8, jaw=30, tail_yaw=18, beat_r=-4)
    strike = lifted(strike, 'fr', rp, (0.0, -4.0, 2.2), 10, -30)
    follow = strike.but(pelvis=(-0.4, -0.8, -0.6), roll=5, head_yaw=14, neck_yaw=12, jaw=22, tail_yaw=22)
    follow = lifted(follow, 'fr', rp, (2.6, -2.8, 1.0), 30, 10)
    land = st.but(pelvis=(0, -0.5, -0.3), jaw=10, fr=(rp[0] + 0.8, rp[1] - 1.2, PAW_Z))
    return keys_of([(0.0, st, 'auto'), (0.28, load, 'auto'), (0.5, cock, 'in'), (CLAW_T, strike, 'linear'),
                    (0.92, follow, 'quadout'), (1.25, land, 'auto'), (1.7, st.but(fr=land.p['fr']), 'auto'),
                    (2.0, st, 'auto')])


TAIL_T = 1.05


def tail_swipe(rig):
    """TailSwipe (Tail Sweep): a rear 120 degree cone. He cocks the tail to his left,
    turns his hips and whips it across behind him to his right. CONTRACT: the tail
    sweeps through the rear cone 0.85 to 1.25 s (hit at 1.05 s)."""
    st = stance(rig)
    cock = st.but(yaw=-8, pelvis=(0.3, 0.2, -0.3), hip_yaw=8, spine_yaw=-6, tail_yaw=48, tail_curl=30, tail_lift=12,
                  neck_yaw=-14, head_yaw=-16, head_pitch=-4, jaw=10, beat_l=6, beat_r=6)
    whip = st.but(yaw=10, pelvis=(-0.3, 0.0, -0.5), hip_yaw=-14, spine_yaw=8, tail_yaw=-62, tail_curl=-40, tail_lift=12,
                  tail_flick=-20, neck_yaw=16, head_yaw=14, jaw=22, beat_l=-4, beat_r=-4)
    over = whip.but(yaw=12, tail_yaw=-72, tail_curl=-55, hip_yaw=-16, tail_flick=-20, tail_lift=14)
    return keys_of([(0.0, st, 'auto'), (0.55, cock, 'inout'), (TAIL_T, whip, 'linear'), (1.3, over, 'out'),
                    (1.75, st.but(yaw=4, tail_yaw=-20, tail_curl=-10), 'auto'), (2.3, st, 'auto')])


BUFFET_T = 1.1


def wing_buffet(rig):
    """WingBuffet (Wing Gale): he rears onto his hind legs, raises both wings high and
    drives them down and forward. CONTRACT: the gust leaves at 1.10 s (everyone in
    front pushed back); the forefeet come down at 1.6 s."""
    st = stance(rig)
    hips = (0, 7.0, 9.0)
    rise = st.but(pitch=14, pivot=hips, pelvis=(0, 0.8, 0.2), neck_raise=14, neck_s=10, head_pitch=4, jaw=20,
                  fold_l=0.0, fold_r=0.0, beat_l=55, beat_r=55, sweep_l=-18, sweep_r=-18, fan_l=0.9, fan_r=0.9,
                  tail_lift=26, tail_droop=-4)
    rise = lifted(rise, 'fl', FP0, (0.0, -0.8, 2.6), 50, 20)
    rise = lifted(rise, 'fr', A.mirror(FP0), (0.0, -0.8, 2.6), 50, 20)
    drive = st.but(pitch=10, pivot=hips, pelvis=(0, 0.2, 0.0), neck_raise=-2, neck_s=2, head_pitch=-12, jaw=34,
                   fold_l=0.0, fold_r=0.0, beat_l=-34, beat_r=-34, sweep_l=26, sweep_r=26, tipw_l=-20, tipw_r=-20,
                   tail_lift=22)
    drive = lifted(drive, 'fl', FP0, (0.0, -1.4, 1.8), 40, 20)
    drive = lifted(drive, 'fr', A.mirror(FP0), (0.0, -1.4, 1.8), 40, 20)
    land = st.but(pelvis=(0, -1.2, -0.6), neck_raise=-6, jaw=12, fold_l=0.3, fold_r=0.3, beat_l=-10, beat_r=-10,
                  fl=(FP0[0], FP0[1] - 1.2, PAW_Z), fr=(-FP0[0], FP0[1] - 1.2, PAW_Z))
    return keys_of([(0.0, st, 'auto'), (0.4, st.but(fold_l=0.5, fold_r=0.5, beat_l=20, beat_r=20), 'auto'),
                    (0.75, rise, 'inout'), (BUFFET_T, drive, 'out'), (1.65, land, 'out'),
                    (2.5, st.but(fl=land.p['fl'], fr=land.p['fr']), 'auto'), (2.9, st, 'auto')])


ROAR_T = 1.1


def roar(rig):
    """Roar: he draws back, rears with the wings half open and roars at the sky.
    CONTRACT: the roar peaks at 1.10 s (the shout ring), held with a shake to 2.2 s."""
    st = stance(rig)
    hips = (0, 7.0, 9.0)
    load = st.but(pelvis=(0, 0.6, -0.6), neck_raise=-12, neck_s=14, head_pitch=-14, jaw=6, tail_lift=2,
                  scap_l=6, scap_r=6, fold_l=0.8, fold_r=0.8, beat_l=8, beat_r=8)
    peak = st.but(pitch=9, pivot=hips, pelvis=(0, -0.4, 0.3), neck_raise=20, neck_s=-4, head_pitch=22, jaw=46,
                  tail_lift=22, tail_wave=8, fold_l=0.45, fold_r=0.45, beat_l=26, beat_r=26, sweep_l=8, sweep_r=8,
                  arch=-4)
    peak = lifted(peak, 'fl', FP0, (0.0, -0.4, 1.2), 30, 10)
    seq = [(0.0, st, 'auto'), (0.45, load, 'in'), (ROAR_T, peak, 'out')]
    for k, t in enumerate((1.4, 1.7, 2.0)):
        sg = 1 if k % 2 == 0 else -1
        seq.append((t, peak.but(head_yaw=5 * sg, head_roll=6 * sg, neck_yaw=-4 * sg, jaw=44 + 2 * sg,
                                tail_phase=1.6 * (k + 1), beat_l=30 + 4 * sg, beat_r=30 - 4 * sg), 'auto'))
    seq += [(2.2, peak.but(jaw=38), 'auto'), (2.8, st.but(neck_raise=0, jaw=10, fold_l=0.8, fold_r=0.8), 'auto'),
            (3.3, st, 'auto')]
    return keys_of(seq)


BREATH_START, BREATH_END = 2.0, 3.4


def breath_ground(rig):
    """BreathGround (Grave Breath): the 2 s cast is a long inhale, the neck coiled
    back and the chest swelling with shard-light; then he thrusts the head out and
    pours deathly fire along the ground, sweeping it a little across the cone.
    CONTRACT: the breath starts at 2.00 s and ends at 3.40 s (the Mouth bone is the
    origin; it points about 30 degrees below level, 20 yd ahead at the ground)."""
    st = stance(rig)
    coil = st.but(pelvis=(0, 1.0, 0.1), neck_raise=10, neck_s=20, head_pitch=10, jaw=4, arch=-5, scap_l=6, scap_r=6,
                  fold_l=0.92, fold_r=0.92, beat_l=12, beat_r=12, tail_lift=10)
    deep = coil.but(pelvis=(0, 1.2, 0.3), neck_raise=14, neck_s=22, head_pitch=14, jaw=14, arch=-7, beat_l=18,
                    beat_r=18)
    pour = st.but(pelvis=(0, -1.0, -0.6), pitch=-2, neck_raise=-10, neck_s=-2, head_pitch=-16, jaw=44, arch=3,
                  fold_l=0.9, fold_r=0.9, beat_l=14, beat_r=14, sweep_l=6, sweep_r=6, tail_lift=6)
    seq = [(0.0, st, 'auto'), (0.8, coil, 'auto'), (1.6, deep, 'inout'), (BREATH_START, pour.but(head_yaw=-8, neck_yaw=-6), 'auto'),
           (2.7, pour.but(head_yaw=6, neck_yaw=5), 'auto'), (BREATH_END, pour.but(head_yaw=-2, jaw=40), 'out'),
           (3.9, st.but(jaw=8), 'auto'), (4.3, st, 'auto')]
    return keys_of(seq)


RIME_T, RIME_END = 0.60, 1.05


def rime_breath(rig):
    """RimeBreath (Rime Breath, a 0.6 s bar): a quick coil, the throat swelling and
    the wings flaring, then the head snaps forward with the jaws wide and puffs a
    short 60 degree cone of frost at the one it fights.
    CONTRACT: the frost leaves the jaws at 0.60 s (the bar's end) and stops at 1.05 s."""
    st = stance(rig)
    coil = st.but(pelvis=(0, 0.9, 0.0), neck_raise=12, neck_s=20, head_pitch=12, jaw=10, arch=-4, scap_l=6, scap_r=6,
                  fold_l=0.7, fold_r=0.7, beat_l=16, beat_r=16, tail_lift=10)
    puff = st.but(pelvis=(0, -1.1, -0.5), pitch=-2, neck_raise=-10, neck_s=-4, head_pitch=-12, jaw=46, arch=3,
                  fold_l=0.6, fold_r=0.6, beat_l=24, beat_r=24, sweep_l=8, sweep_r=8, tail_lift=8)
    seq = [(0.0, st, 'auto'), (0.42, coil, 'inout'), (RIME_T, puff, 'quadin'),
           (0.82, puff.but(head_yaw=6, neck_yaw=4, jaw=44), 'auto'), (RIME_END, puff.but(head_yaw=-4, jaw=36), 'out'),
           (1.4, st.but(jaw=8), 'auto'), (1.7, st, 'auto')]
    return keys_of(seq)


# ------------------------------------------------------------------ flight
def hover_pose(rig, ph=0.0, h=FLY_H, pitch=8.0):
    """The airborne base: the legs tucked, the tail hanging in a long curve, the neck
    arched to look down; `ph` the wingbeat phase (0 = the top of the upstroke)."""
    st = stance(rig)
    w = TAU * ph
    up = math.cos(w)                      # +1 wings high, -1 wings low
    b = st.but(pelvis=(0, 0.0, h + 0.55 * math.sin(w + 0.6)), pitch=pitch + 1.5 * math.sin(w + 0.4),
               pivot=(0, 1.0, 10.0), neck_raise=-6 + 2.0 * math.sin(w + 1.2), neck_s=12, head_pitch=-22,
               jaw=6, fold_l=0.0, fold_r=0.0, beat_l=8 + 46 * up, beat_r=8 + 46 * up,
               sweep_l=-4 + 10 * math.sin(w), sweep_r=-4 + 10 * math.sin(w), tipw_l=18 * math.sin(w + 0.9),
               tipw_r=18 * math.sin(w + 0.9), fan_l=1.0 - 0.12 * max(0.0, up), fan_r=1.0 - 0.12 * max(0.0, up),
               tail_lift=-6, tail_droop=14, tail_wave=5, tail_phase=w, arch=2.5 * math.sin(w + 0.6))
    b = lifted(b, 'fl', FP0, (0.0, 1.6, 3.6), 70, 40)
    b = lifted(b, 'fr', A.mirror(FP0), (0.0, 1.6, 3.6), 70, 40)
    b = lifted(b, 'hl', HP0, (0.0, 2.6, 2.6), -45, 40)
    b = lifted(b, 'hr', A.mirror(HP0), (0.0, 2.6, 2.6), -45, 40)
    return b


FLY_PERIOD = 1.6


def fly_idle(rig):
    """FlyIdle: the hover (Root at FLY_H = 6 yd): one great beat every 1.6 s, the
    body rising on each downstroke. Loops."""
    n = 16
    seq = [(FLY_PERIOD * 2 * i / n, hover_pose(rig, 2 * i / n), 'linear') for i in range(n + 1)]
    return keys_of(seq, loop=True)


FWD_PERIOD = 1.3


def fly_forward(rig):
    """FlyForward: level flight (Root at FLY_H), the body pitched nose-down, the neck
    stretched out, the legs trailing, the tail streaming. In place: the game moves
    him. Loops."""
    n = 13
    seq = []
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        up = math.cos(w)
        b = hover_pose(rig, ph, pitch=-8.0).but(
            neck_raise=-16 + 1.5 * math.sin(w + 1.0), neck_s=-2, head_pitch=-6, beat_l=6 + 50 * up, beat_r=6 + 50 * up,
            sweep_l=-14 + 12 * math.sin(w), sweep_r=-14 + 12 * math.sin(w), tail_lift=6, tail_droop=0,
            tail_wave=4, pelvis=(0, 0.0, FLY_H + 0.4 * math.sin(w + 0.6)))
        b = lifted(b, 'hl', HP0, (0.0, 4.2, 3.2), -70, 50)
        b = lifted(b, 'hr', A.mirror(HP0), (0.0, 4.2, 3.2), -70, 50)
        b = lifted(b, 'fl', FP0, (0.0, 2.4, 3.8), 80, 40)
        b = lifted(b, 'fr', A.mirror(FP0), (0.0, 2.4, 3.8), 80, 40)
        seq.append((FWD_PERIOD * ph, b, 'linear'))
    return keys_of(seq, loop=True)


AIR_START, AIR_END = 1.0, 2.6


def breath_air(rig):
    """BreathAir (Plunging Fire): hanging over the marked plate he rears back to draw
    breath, then drives his head straight down and pours fire onto the whole plate,
    sweeping it from one edge to the other. CONTRACT: the breath starts at 1.00 s and
    ends at 2.60 s; the Mouth bone points almost straight down. Starts and ends on
    the FlyIdle pose (two wingbeats, 3.2 s)."""
    n = 32
    seq = []
    for i in range(n + 1):
        t = 3.2 * i / n
        ph = t / FLY_PERIOD
        b = hover_pose(rig, ph)
        inhale = smooth(t / 0.75) * (1 - smooth((t - 0.6) / 0.45))
        pour = smooth((t - 0.6) / 0.45) * (1 - smooth((t - 2.6) / 0.5))
        sweep = math.sin(math.pi * max(0.0, min(1.0, (t - 1.0) / 1.6)) - math.pi / 2)
        b = b.but(pitch=b.p['pitch'] + 10 * inhale - 4 * pour, neck_raise=b.p['neck_raise'] + 14 * inhale - 20 * pour,
                  neck_s=b.p['neck_s'] + 10 * inhale + 14 * pour, head_pitch=b.p['head_pitch'] + 30 * inhale - 46 * pour,
                  jaw=6 + 8 * inhale + 40 * pour, head_yaw=16 * sweep * pour, neck_yaw=10 * sweep * pour,
                  arch=b.p['arch'] - 5 * inhale)
        seq.append((t, b, 'linear'))
    return keys_of(seq)


TAKEOFF_GALE, TAKEOFF_LIFT = 1.0, 1.1


def take_off(rig):
    """TakeOff: he crouches, throws his wings up, and the first downbeat (the Wing
    Gale, 1.00 s) launches him; the feet leave the ice at 1.10 s; two more beats carry
    him up to the hover (Root at FLY_H) by 2.80 s, ending on the FlyIdle pose."""
    st = stance(rig)
    crouch = st.but(pelvis=(0, 0.4, -2.0), neck_raise=-10, neck_s=12, head_pitch=-6, jaw=10, arch=4,
                    fold_l=0.2, fold_r=0.2, beat_l=40, beat_r=40, sweep_l=-10, sweep_r=-10, tail_lift=10,
                    pole_f=(0.3, 1.0, 0.0))
    gale = st.but(pelvis=(0, 0.0, 1.2), pitch=10, neck_raise=4, neck_s=8, head_pitch=-4, jaw=30, fold_l=0.0,
                  fold_r=0.0, beat_l=-36, beat_r=-36, sweep_l=16, sweep_r=16, tipw_l=-18, tipw_r=-18, tail_lift=-4)
    gale = gale.but(hl=(HP0[0], HP0[1] + 0.3, PAW_Z), hr=(-HP0[0], HP0[1] + 0.3, PAW_Z), fd_hl=-40, fd_hr=-40)
    gale = lifted(gale, 'fl', FP0, (0.0, 0.2, 1.8), 50, 20)
    gale = lifted(gale, 'fr', A.mirror(FP0), (0.0, 0.2, 1.8), 50, 20)
    up1 = hover_pose(rig, 0.0, h=2.6, pitch=14)
    down1 = hover_pose(rig, 0.5, h=4.4, pitch=12)
    up2 = hover_pose(rig, 1.0, h=5.6, pitch=10)
    end = hover_pose(rig, 0.0)
    return keys_of([(0.0, st, 'auto'), (0.3, st.but(fold_l=0.6, fold_r=0.6, beat_l=12, beat_r=12), 'auto'),
                    (0.62, crouch, 'inout'), (TAKEOFF_GALE, gale, 'auto'),
                    (1.55, up1, 'auto'), (2.0, down1, 'auto'), (2.45, up2.but(beat_l=40, beat_r=40), 'auto'),
                    (2.8, end, 'auto')])


LAND_HIND, LAND_IMPACT = 1.05, 1.2


def land(rig):
    """Land (Crashing Descent): from the hover he drops, flares the wings to brake and
    slams down. CONTRACT: the hind feet touch at 1.05 s; the forefeet and the chest
    hit at 1.20 s (the impact: 12 yd ring, the plate cracks); settled into the stance
    and the wings folded by 2.60 s."""
    st = stance(rig)
    start = hover_pose(rig, 0.0)
    flare = hover_pose(rig, 0.25, h=4.0, pitch=18).but(beat_l=40, beat_r=40, sweep_l=18, sweep_r=18, neck_raise=0,
                                                       head_pitch=-6, jaw=24)
    reach = st.but(pelvis=(0, 0.0, 2.4), pitch=12, neck_raise=0, neck_s=6, head_pitch=-2, jaw=30, fold_l=0.0,
                   fold_r=0.0, beat_l=30, beat_r=30, sweep_l=12, sweep_r=12, tail_lift=6)
    reach = lifted(reach, 'fl', FP0, (0.0, -0.6, 2.4), 30, 10)
    reach = lifted(reach, 'fr', A.mirror(FP0), (0.0, -0.6, 2.4), 30, 10)
    reach = reach.but(hl=(HP0[0], HP0[1] - 0.6, PAW_Z + 1.0), hr=(-HP0[0], HP0[1] - 0.6, PAW_Z + 1.0))
    hind = st.but(pelvis=(0, -0.2, 0.6), pitch=8, neck_raise=-4, head_pitch=-4, jaw=34, fold_l=0.0, fold_r=0.0,
                  beat_l=10, beat_r=10, sweep_l=8, sweep_r=8, hl=(HP0[0], HP0[1] - 0.6, PAW_Z),
                  hr=(-HP0[0], HP0[1] - 0.6, PAW_Z))
    hind = lifted(hind, 'fl', FP0, (0.0, -1.0, 1.0), 20, 0)
    hind = lifted(hind, 'fr', A.mirror(FP0), (0.0, -1.0, 1.0), 20, 0)
    impact = st.but(pelvis=(0, -0.8, -2.4), pitch=-3, neck_raise=-16, neck_s=4, head_pitch=-10, jaw=40, arch=5,
                    fold_l=0.1, fold_r=0.1, beat_l=-14, beat_r=-14, sweep_l=4, sweep_r=4, tipw_l=16, tipw_r=16,
                    fl=(FP0[0] + 0.4, FP0[1] - 1.6, PAW_Z), fr=(-FP0[0] - 0.4, FP0[1] - 1.6, PAW_Z),
                    hl=(HP0[0], HP0[1] - 0.6, PAW_Z), hr=(-HP0[0], HP0[1] - 0.6, PAW_Z), pole_f=(0.35, 1.0, 0.0),
                    tail_lift=-6)
    settle = st.but(pelvis=(0, -0.8, -0.8), fl=impact.p['fl'], fr=impact.p['fr'], hl=impact.p['hl'],
                    hr=impact.p['hr'], fold_l=0.6, fold_r=0.6, beat_l=6, beat_r=6, jaw=14, neck_raise=-6)
    return keys_of([(0.0, start, 'auto'), (0.55, flare, 'auto'), (0.92, reach, 'quadin'), (LAND_HIND, hind, 'in'),
                    (LAND_IMPACT, impact, 'out'), (1.7, settle, 'auto'),
                    (2.3, st.but(fl=impact.p['fl'], fr=impact.p['fr'], hl=impact.p['hl'], hr=impact.p['hr']), 'auto'),
                    (2.6, st.but(fl=impact.p['fl'], fr=impact.p['fr'], hl=impact.p['hl'], hr=impact.p['hr']), 'auto')])


INFERNO_PULSES = (2.0, 4.0, 6.0, 8.0)


def grave_inferno(rig):
    """GraveInferno: the 8 s channel. He rears with the wings spread wide and the
    shard blazing; four escalating pulses, each a heave of the wings down onto the
    ice and a roar to the sky. CONTRACT: pulses at 2.00, 4.00, 6.00 and 8.00 s
    (14 yd ring each, stronger each time); the channel ends at 8.0 s; back in the
    stance at 9.0 s. Stationary (Doused: stop the clip and play Hit when the plate
    breaks under him)."""
    st = stance(rig)
    hips = (0, 7.0, 9.0)
    mantle = st.but(pitch=8, pivot=hips, pelvis=(0, 0.2, 0.2), neck_raise=10, neck_s=4, head_pitch=6, jaw=24,
                    fold_l=0.0, fold_r=0.0, beat_l=26, beat_r=26, sweep_l=-6, sweep_r=-6, arch=-4, tail_lift=16,
                    tail_wave=4)
    mantle = lifted(mantle, 'fl', FP0, (0.0, -0.3, 0.9), 20, 0)
    seq = [(0.0, st, 'auto'), (0.4, st.but(fold_l=0.6, fold_r=0.6, beat_l=12, beat_r=12), 'auto'),
           (1.0, mantle, 'auto')]
    for k, tp in enumerate(INFERNO_PULSES):
        e = 0.7 + 0.12 * k
        draw = mantle.but(pitch=10 + 3 * k * e, neck_raise=14 + 4 * k, neck_s=10, head_pitch=4, jaw=12,
                          tail_lift=18 + 3 * k * e,
                          beat_l=40 + 10 * k, beat_r=40 + 10 * k, sweep_l=-14, sweep_r=-14, arch=-6, tail_phase=k * 1.4)
        hit = mantle.but(pitch=2, pelvis=(0, 0.0, -0.4 - 0.25 * k), neck_raise=24 + 3 * k, neck_s=-8,
                         head_pitch=30 + 4 * k, jaw=46, beat_l=-12 - 3 * k, beat_r=-12 - 3 * k, sweep_l=10, sweep_r=10,
                         tipw_l=14, tipw_r=14, arch=4, tail_phase=k * 1.4 + 0.7, tail_lift=14)
        seq.append((tp - 0.45, draw, 'in'))
        seq.append((tp, hit, 'out'))
        if k < 3:
            seq.append((tp + 0.8, mantle.but(jaw=26, head_pitch=10 + 3 * k, neck_raise=12 + 2 * k,
                                             tail_phase=k * 1.4 + 1.4), 'auto'))
    seq += [(8.6, mantle.but(jaw=20, beat_l=10, beat_r=10, fold_l=0.4, fold_r=0.4), 'auto'), (9.4, st, 'auto')]
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(pelvis=(0.4, 0.6, -0.4), roll=3, arch=4, neck_raise=8, neck_yaw=-12, head_pitch=8, head_yaw=-8,
                    jaw=24, tail_yaw=16, tail_flick=24, spine_yaw=-4, beat_l=10, beat_r=10)
    back = st.but(pelvis=(-0.1, 0.15, -0.1), roll=-1.0, neck_yaw=3, jaw=8)
    return keys_of([(0.0, st, 'auto'), (0.12, flinch, 'out'), (0.4, back, 'inout'), (0.8, st, 'auto')])


DEATH_IMPACT, DEATH_GIVE, DEATH_REST = 2.2, 2.6, 5.0


def death(rig):
    """Death: a last shriek at the sky, the legs give, it crashes onto its left side on
    the ice and lies still, one wing across its flank. CONTRACT: the body hits the
    ice at DEATH_IMPACT (2.20 s); at rest from 2.75 s (the Hoarfrost Pop fires on
    the death itself)."""
    st = stance(rig)
    hips = (0, 7.0, 9.0)
    rear = st.but(pitch=8, pivot=hips, neck_raise=18, head_pitch=24, jaw=48, fold_l=0.6, fold_r=0.6, beat_l=20,
                  beat_r=20, tail_lift=16)
    stagger = st.but(pelvis=(0.6, 0.2, -1.4), roll=6, pitch=-4, neck_raise=-6, neck_yaw=10, head_pitch=-6, jaw=30,
                     fold_l=0.6, fold_r=0.3, beat_l=4, beat_r=24, tail_lift=4,
                     fl=(FP0[0] + 0.6, FP0[1] - 0.6, PAW_Z), fr=(-FP0[0] - 0.4, FP0[1] - 0.8, PAW_Z),
                     pole_f=(0.4, 1.0, 0.0))
    left = (3.6, 0.0, 0.0)

    def lying(roll, center, neck, head_p, jaw, sink=0.0, tail=0.0):
        b = st.but(ground=0.0, roll=roll, pivot=left, neck_raise=neck, neck_yaw=22, neck_roll=8, neck_s=-4, head_pitch=head_p,
                   head_roll=14, jaw=jaw, tail_lift=-6, tail_yaw=tail, tail_droop=10, fold_l=0.75, fold_r=0.15,
                   beat_l=-10, beat_r=40, sweep_r=10, fan_r=0.9)
        q = body_matrix(0.0, 0.0, roll)
        piv, c = V(left), V((0.0, 0.0, 10.0))
        b = b.but(pelvis=tuple(V(center) - (q @ c + piv - q @ piv) + V((0, 0, -sink))))
        feet = {}
        for key, rest, out in (('fl', FP0, (-1.8, -2.0, 1.6)), ('fr', A.mirror(FP0), (-0.3, -1.6, 0.8)),
                               ('hl', HP0, (-1.8, 1.6, 1.6)), ('hr', A.mirror(HP0), (-0.3, 1.6, 0.8))):
            w_ = np.array(b.to_world(rest + np.array(out)), float)
            w_[2] = max(w_[2], PAW_Z + 1.2)         # never into the ice, whatever the roll
            feet[key] = tuple(w_)
            feet['fd_' + key] = 40.0
            feet['td_' + key] = 60.0
        return b.but(**feet)
    slump = lying(30, (1.8, 0.0, 7.5), -14, -8, 26)
    hitg = lying(68, (3.6, 0.0, 5.05), -24, -10, 20)
    bounce = lying(64, (3.5, 0.0, 5.3), -22, -8, 22)
    rest = lying(66, (3.55, 0.0, 5.12), -26, -12, 14)
    seq = [(0.0, st, 'auto'), (0.8, rear, 'auto'), (1.4, stagger, 'in'), (1.8, slump, 'in'),
           (DEATH_IMPACT, hitg, 'out'), (2.35, bounce, 'inout'), (2.75, rest, 'inout'), (3.2, rest, 'linear')]
    return keys_of(seq)


# ------------------------------------------------------------------ the ice
def frozen_pose(rig):
    """Held in the quench: crouched low and coiled, the neck curled back to his left
    and the head turned toward the lake, the left wing half spread, the right folded,
    the tail wrapped round to his right; the eight slabs of quench-ice still on him."""
    st = stance(rig)
    b = st.but(pelvis=(0.0, 0.6, -2.3), pitch=-3, neck_raise=-8, neck_s=22, neck_yaw=46, neck_roll=-8,
               head_yaw=30, head_pitch=-14, head_roll=-10, jaw=8, arch=6, spine_yaw=10, hip_yaw=-6,
               tail_yaw=-70, tail_curl=-90, tail_lift=6, tail_droop=-2, fold_l=0.45, fold_r=1.0, beat_l=26,
               sweep_l=-10, fan_l=0.8, flex_l=10, ice=1.0, scap_l=6, scap_r=8,
               fl=(FP0[0] + 0.3, FP0[1] - 2.0, PAW_Z), fr=(-FP0[0] - 0.6, FP0[1] - 1.0, PAW_Z),
               hl=(HP0[0] + 0.5, HP0[1] - 1.6, PAW_Z), hr=(-HP0[0] - 0.4, HP0[1] - 1.0, PAW_Z),
               td_fl=-10, td_fr=-14, pole_f=(0.45, 1.0, 0.0), pole_h=(0.35, -1.0, 0.0))
    return b


def frozen(rig):
    """Frozen: the still pose inside the ice (2 s hold; loop it or sample frame 0)."""
    b = frozen_pose(rig)
    return keys_of([(0.0, b, 'linear'), (2.0, b, 'linear')], loop=True)


AWAKEN_T = 1.5


def frozen_awaken(rig):
    """FrozenAwaken: the twitch inside the ice (showpiece stages 3 and 4): still, then
    the claws of the right forefoot clench, the jaw parts, the head turns a hair
    toward the shore and the tail tip shivers; back to still. CONTRACT: the twitch
    peaks at 1.50 s; frames 0 and the end are exactly the Frozen pose."""
    b = frozen_pose(rig)
    tw = b.but(td_fr=-34, td_fl=-18, jaw=14, head_yaw=34, head_pitch=-11, neck_yaw=48, tail_flick=-18,
               beat_l=28, scap_r=10)
    tw2 = tw.but(td_fr=-28, jaw=11, head_yaw=33, tail_flick=12)
    return keys_of([(0.0, b, 'auto'), (1.0, b, 'auto'), (AWAKEN_T, tw, 'out'), (1.8, tw2, 'auto'), (2.6, b, 'inout'),
                    (3.0, b, 'linear')])


BURST_T, BREAK_SLAM = 1.4, 2.9


def break_free(rig):
    """BreakFree: from the Frozen pose he strains, the ice holds, then bursts: the
    eight slabs fly off him, the wings snap open, he rears and roars, and his forefeet
    come down on the lake. CONTRACT: the strain shudders 0.5 to 1.3 s; the ice
    bursts at 1.40 s (the slabs fly and are gone by 2.6 s); the forefeet slam at
    2.90 s; in the stance at 4.4 s."""
    fz = frozen_pose(rig)
    st = stance(rig)
    hips = (0, 7.0, 9.0)
    seq = [(0.0, fz, 'auto'), (0.45, fz, 'auto')]
    for k, t in enumerate((0.6, 0.75, 0.9, 1.05, 1.2)):
        sg = 1 if k % 2 == 0 else -1
        e = (k + 1) / 5
        seq.append((t, fz.but(pelvis=(0.12 * sg * e, 0.6, -2.3 + 0.2 * e), roll=1.5 * sg * e, neck_s=22 - 4 * e,
                              neck_yaw=46 - 8 * e, jaw=8 + 10 * e, beat_l=26 + 6 * sg * e, td_fr=-20, td_fl=-20,
                              arch=6 - 2 * e), 'auto'))
    burst = st.but(pitch=12, pivot=hips, pelvis=(0, 0.6, 0.4), neck_raise=22, neck_s=-6, neck_yaw=10, head_pitch=24,
                   jaw=48, fold_l=0.0, fold_r=0.0, beat_l=48, beat_r=48, sweep_l=-6, sweep_r=-6, arch=-6, ice=1.0,
                   tail_lift=26, tail_yaw=-30, tail_curl=-30, tail_wave=10)
    burst = lifted(burst, 'fl', FP0, (0.0, -1.0, 3.2), 40, 0)
    burst = lifted(burst, 'fr', A.mirror(FP0), (0.0, -1.0, 3.4), 40, 0)
    rear = burst.but(pitch=14, neck_raise=24, head_pitch=26, jaw=46, beat_l=30, beat_r=30, sweep_l=6, sweep_r=6,
                     tail_phase=1.5)
    rear = lifted(rear, 'fl', FP0, (0.0, -1.4, 3.6), 24, 0)
    rear = lifted(rear, 'fr', A.mirror(FP0), (0.0, -1.4, 3.8), 24, 0)
    slam = st.but(pelvis=(0, -1.2, -1.2), pitch=-3, neck_raise=-12, neck_s=4, head_pitch=-12, jaw=44, arch=4,
                  fold_l=0.2, fold_r=0.2, beat_l=-10, beat_r=-10, sweep_l=6, sweep_r=6, tail_yaw=-10, tipw_l=12,
                  tipw_r=12,
                  fl=(FP0[0] + 0.3, FP0[1] - 1.4, PAW_Z), fr=(-FP0[0] - 0.3, FP0[1] - 1.4, PAW_Z),
                  pole_f=(0.3, 1.0, 0.0))
    half = burst.but(fold_l=0.3, fold_r=0.78, beat_l=34, beat_r=16, jaw=36, neck_raise=12, pitch=7)
    seq += [(BURST_T, half, 'auto'), (1.85, burst, 'out'), (2.2, rear, 'auto'), (2.6, rear.but(pitch=6, head_pitch=4, neck_raise=8), 'quadin'),
            (BREAK_SLAM, slam, 'out'), (3.6, st.but(fl=slam.p['fl'], fr=slam.p['fr'], fold_l=0.7, fold_r=0.7, jaw=14),
                                        'auto'),
            (4.4, st.but(fl=slam.p['fl'], fr=slam.p['fr']), 'auto')]
    rng = np.random.default_rng(77)
    flights = []
    for b in ICE_BONES:
        h = A.REST[b][0]
        out = np.array((h[0], h[1] - 1.0, 0.0))
        if np.linalg.norm(out[:1]) < 0.5:
            out[0] = rng.choice((-1.0, 1.0)) * 1.5
        out /= max(1e-6, np.linalg.norm(out))
        v = out * rng.uniform(5.0, 8.0) + np.array((0, 0, rng.uniform(5.0, 8.0)))
        spin = (rng.normal(size=3), rng.uniform(200, 420))
        flights.append((b, v, spin))

    def post(pose, t, body):
        if t < BURST_T:
            return
        dt = t - BURST_T
        for b, v, (ax, deg) in flights:
            off = v * dt + np.array((0, 0, -7.5 * dt * dt))
            pose.loc[b] = tuple(off)
            axis = Vector(tuple(ax)).normalized()
            pose[b] = Quaternion(axis, math.radians(deg * dt))
            pose.scale[b] = max(1e-4, 1.0 - smooth((dt - 0.75) / 0.45))
        if t > 2.6:
            for b in ICE_BONES:
                pose.scale[b] = 1e-4
    keys = keys_of(seq, post=post)
    return keys


# ------------------------------------------------------------------ catalog
NO_TAIL_SPRING = ('Death', 'Frozen', 'FrozenAwaken')
RUN_PERIOD, RUN_SPEED, RUN_STANCE = 0.75, 24.0, 0.38
RUN_PHASES = dict(hl=0.0, hr=0.12, fl=0.5, fr=0.62)


def run(rig):
    """A whelp's bounding run: the hind pair drives, the fore pair reaches, the back
    flexes, the wings held half-open for balance."""
    base = stance(rig).but(neck_raise=-12, head_pitch=-6, fold_l=0.75, fold_r=0.75, tail_lift=6)
    nfr = int(round(RUN_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, RUN_PERIOD, RUN_SPEED, RUN_STANCE, 3.2, RUN_PHASES, base,
                                 wave=9.0, bob=0.55, roll=1.2), 'linear') for i in range(nfr + 1)]
    return keys_of(seq)


CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Run', run, True, RUN_SPEED),
    ('Attack', bite, False, 0.0),
    ('Attack2', claw, False, 0.0),
    ('Roar', roar, False, 0.0),
    ('RimeBreath', rime_breath, False, 0.0),
    ('Hit', hit, False, 0.0),
    ('Death', death, False, 0.0),
]


def make_clips(arm, only=None):
    rig = R.Rig(arm)
    rig.fold_q = fold_quats(rig)
    made = []
    for name, fn, loop, wind in CATALOG:
        if only and name not in only:
            continue
        keys = fn(rig)
        act = R.make_clip(arm, name, keys)
        act['loop'] = bool(loop)
        skip = ('Tail10',) if name in NO_TAIL_SPRING else ()
        if name in ('Frozen', 'FrozenAwaken'):
            skip = skip + ('Belly',)
        R.follow_through(arm, act, loop=loop, wind=wind, skip=skip)
        made.append(name)
    return made
