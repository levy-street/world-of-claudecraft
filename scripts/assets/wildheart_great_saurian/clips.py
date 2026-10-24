"""The Great Saurian's clips, keyed from a whole-body quadruped pose language.

`Body(**params)` turns a few dozen readable numbers into a full pose: where the
body sits and how it pitches and rolls (about a chosen PIVOT, so it rears about
its hips or tips over its own flank), how the spine bends, how the neck rises
and turns (spread down its four bones), where the head looks and how wide the
jaw opens, how the tail lifts, swings, curls and waves (spread down its seven
bones), and where each of the four feet stands (two-bone IK with poles: the
front elbows bend back, the hind knees forward).

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body (rig.make_clip keys
it), so arcs stay arcs. The howdah pieces fly on ballistic paths in HowdahBreak.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `pitch` + noses up; `roll` + rolls onto its LEFT side; `yaw` + turns
left; `neck_raise` + lifts the neck; `head_pitch` + lifts the nose; `jaw` +
opens; `tail_lift` + lifts the tail; `tail_yaw` + swings it to its LEFT.

CONTRACT lines name the frames the game should read (the encounter's bars, the
splash and shatter VFX).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
FL0 = np.array(A.WRIST)
HL0 = np.array(A.ANKLE)
FOOT_Z = A.WRIST[2]
HAND_DIR = A.REST['L_Hand'][1] - A.REST['L_Hand'][0]
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
# The jaw opens on one continuous skin: past about 20 degrees the cheeks stretch into
# streaks (seen in the round-4 roar close-up), so every authored jaw value is scaled.
JAW_GAIN = 0.45
NECK_W = (0.34, 0.28, 0.22, 0.16)          # how the neck's raise and turn spread down its bones
TAIL_W = (0.24, 0.2, 0.16, 0.13, 0.11, 0.09, 0.07)
FLOWN = ('HowdahBase', 'HowdahRoof', 'HowdahRailL', 'HowdahRailR', 'HowdahRailF', 'HowdahPostFL', 'HowdahPostFR',
         'HowdahPostBL', 'HowdahPostBR', 'Rider')


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def rot_x(v, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def body_matrix(yaw, pitch, roll):
    """The Root's rotation for the Body angles (the rig applies z, then x, then y)."""
    q = Quaternion((0, 0, 1), math.radians(yaw))
    q = Quaternion((1, 0, 0), math.radians(-pitch)) @ q
    q = Quaternion((0, 1, 0), math.radians(roll)) @ q
    return q


def foot_dir(pitch, front=True, yaw=0.0):
    d = HAND_DIR if front else FOOT_DIR
    d = rot_x(d, pitch)
    if yaw:
        c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        d = np.array((d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]))
    return tuple(d)


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, -0.35), pivot=(0.0, 3.2, 5.9),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_pitch=0.0, hip_roll=0.0, hip_yaw=0.0,
        spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0,
        neck_raise=0.0, neck_yaw=0.0, neck_roll=0.0, neck_curl=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=2.0,
        tail_lift=0.0, tail_yaw=0.0, tail_curl=0.0, tail_droop=0.0, tail_wave=0.0, tail_phase=0.0,
        scap_l=0.0, scap_r=0.0,
        fl=tuple(FL0), fr=tuple(A.mirror(FL0)), hl=tuple(HL0), hr=tuple(A.mirror(HL0)),
        fdir_fl=foot_dir(0), fdir_fr=foot_dir(0), fdir_hl=foot_dir(0, False), fdir_hr=foot_dir(0, False),
        pole_f=(0.15, 1.0, 0.0), pole_h=(0.15, -1.0, 0.0),
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
        """Where a rest-space point rides with the whole-body turn (a limp foot)."""
        root, q = self.root()
        return np.array(q @ V(rest_point) + root)

    def solve(self, memory=None):
        p = self.p
        turns, aims, ik = {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', -p['hip_pitch']), ('z', p['hip_yaw']), ('y', p['hip_roll'])]
        for b, w in (('Spine1', 0.45), ('Spine2', 0.55)):
            turns[b] = [('x', -p['spine_pitch'] * w), ('z', p['spine_yaw'] * w), ('y', p['spine_roll'] * w)]
        for i, w in enumerate(NECK_W):
            curl = p['neck_curl'] * (1.0 if i < 2 else -1.2)
            turns[f'Neck{i + 1}'] = [('x', -(p['neck_raise'] * w + curl * w)), ('z', p['neck_yaw'] * w),
                                     ('y', p['neck_roll'] * w)]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        for i, w in enumerate(TAIL_W):
            k = i / 6.0
            wave = p['tail_wave'] * math.sin(p['tail_phase'] - i * 0.75) * (0.4 + 0.6 * k)
            yaw = p['tail_yaw'] * w + p['tail_curl'] * k * 0.22 + wave
            lift = p['tail_lift'] * w - p['tail_droop'] * k * 0.2
            turns[f'Tail{i + 1}'] = [('x', lift), ('z', -yaw)]
        turns['L_Scapula'] = [('x', -p['scap_l'])]
        turns['R_Scapula'] = [('x', -p['scap_r'])]
        for side, s in (('L_', 1), ('R_', -1)):
            pf = (p['pole_f'][0] * s, p['pole_f'][1], p['pole_f'][2])
            ph = (p['pole_h'][0] * s, p['pole_h'][1], p['pole_h'][2])
            ik['f' + side] = (side + 'UpperArm', side + 'Forearm', tuple(p['fl' if s > 0 else 'fr']), pf)
            ik['h' + side] = (side + 'Thigh', side + 'Shin', tuple(p['hl' if s > 0 else 'hr']), ph)
            aims[side + 'Hand'] = V(p['fdir_fl' if s > 0 else 'fdir_fr'])
            aims[side + 'Foot'] = V(p['fdir_hl' if s > 0 else 'fdir_hr'])
        root, _ = self.root()
        pose = self.rig.pose(aims=aims, ik=ik, turns=turns, root=tuple(root), mirror=False, memory=memory)
        return pose


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
    """Catmull-Rom through four Bodies."""
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
    return out


EASE_FN = {
    'in': lambda u: u ** 3,
    'quadin': lambda u: u * u,
    'out': lambda u: 1 - (1 - u) ** 3,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'backout': lambda u: 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2,
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


def keys_of(seq, loop=False, post=None):
    """[(t, Body, ease)] -> per-frame [(t, Pose, 'linear')]. `post(pose, t, body)`
    may override bones after the solve (the flying howdah)."""
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out, memory = [], {}
    if loop:
        for f in range(nfr + 1):
            sample(seq, f / R.FPS, loop).solve(memory)
    for f in range(nfr + 1):
        t = f / R.FPS
        b = sample(seq, t, loop)
        pose = b.solve(memory)
        if post:
            post(pose, t, b)
        out.append((t, pose, 'linear'))
    return out


# ------------------------------------------------------------------ stance and gait
def stance(rig):
    return Body(rig, neck_raise=0.0, head_pitch=-4.0, tail_lift=2.0, tail_droop=6.0)


def gait_foot(phase, stance_frac, half, lift, rest, front):
    """Ankle target, foot direction for one foot at `phase` (0 = touchdown). The
    planted pad slides back at the walking speed; the swing lifts it flat-ish,
    sole turned back as it leaves the water."""
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        y = rest[1] - half + 2 * half * u
        z = FOOT_Z
        pitch = -10 * smooth((u - 0.82) / 0.18)
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = rest[1] + half - 2 * half * e
        z = FOOT_Z + lift * math.sin(math.pi * u) ** 1.2
        pitch = -24 * (1 - smooth(u * 1.8)) + 8 * smooth((u - 0.55) / 0.45)
    return (rest[0] * 1.02, y, z), foot_dir(pitch, front)


def gait_body(rig, ph, period, speed, stance_frac, lift, phases, base=None, run=False):
    base = base or stance(rig)
    half = speed * stance_frac * period / 2
    kw = {}
    for key, rest, front in (('fl', FL0, True), ('fr', A.mirror(FL0), True), ('hl', HL0, False),
                             ('hr', A.mirror(HL0), False)):
        f, d = gait_foot((ph - phases[key]) % 1.0, stance_frac, half, lift, rest, front)
        kw[key] = f
        kw['fdir_' + key] = d
    w = TAU * ph
    # weight rides over the planted side; the front and back halves roll apart
    sway = 0.16 * math.sin(w - 0.6)
    bob = -0.07 * math.cos(2 * w) - 0.04 * math.cos(4 * w) - (0.25 if run else 0.0)
    if run:
        bob = -0.55 - 0.18 * math.cos(2 * w - 0.5)
    return base.but(
        pelvis=(sway, 0.0, -0.35 + bob), roll=-2.2 * math.sin(w - 0.6), hip_roll=2.5 * math.sin(w),
        spine_roll=-2.5 * math.sin(w), spine_yaw=2.0 * math.sin(w), hip_yaw=-2.5 * math.sin(w),
        scap_l=5 * math.sin(w - TAU * phases['fl']), scap_r=5 * math.sin(w - TAU * phases['fr']),
        neck_raise=(-10 if run else -2) + 1.5 * math.cos(2 * w), neck_yaw=-3.0 * math.sin(w),
        head_pitch=(4 if run else -4) - 2.0 * math.cos(2 * w), head_yaw=2.5 * math.sin(w),
        tail_yaw=4 * math.sin(w), tail_wave=(4 if run else 6), tail_phase=w, tail_lift=(8 if run else 3),
        jaw=(10 if run else 3) + 2 * math.cos(2 * w), **kw)


WALK_PERIOD, WALK_SPEED, WALK_STANCE = 2.8, 2.2, 0.7     # 2.2 yd/s: the slow wade (walkRef)
RUN_PERIOD, RUN_SPEED, RUN_STANCE = 1.3, 5.4, 0.48       # 5.4 yd/s: the charging amble (runRef)
WALK_PHASES = dict(hl=0.0, fl=0.25, hr=0.5, fr=0.75)
RUN_PHASES = dict(hl=0.0, fr=0.08, hr=0.5, fl=0.58)


def walk(rig):
    nfr = int(round(WALK_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, WALK_PERIOD, WALK_SPEED, WALK_STANCE, 1.05, WALK_PHASES),
            'linear') for i in range(nfr + 1)]
    return keys_of(seq)


def run(rig):
    nfr = int(round(RUN_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, RUN_PERIOD, RUN_SPEED, RUN_STANCE, 1.55, RUN_PHASES,
                                 run=True), 'linear') for i in range(nfr + 1)]
    return keys_of(seq)


def idle(rig, period=6.0):
    """Breathing (two slow breaths), the neck swaying as it looks over the ford, the
    head turning to a sound, the tail swishing, a chew."""
    base = stance(rig)
    seq = []
    n = 16
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(2 * w)
        chew = max(0.0, math.sin(TAU * (ph * 3 - 0.2))) * (1.0 if 0.5 < ph < 0.85 else 0.0)
        seq.append((period * ph, base.but(
            pelvis=(0.07 * math.sin(w), 0.0, -0.35 - 0.05 * br), spine_pitch=0.8 * br, scap_l=1.2 * br, scap_r=1.2 * br,
            neck_raise=2.5 * math.sin(w + 0.4) + 1.0 * br, neck_yaw=9 * math.sin(w), neck_curl=2 * math.sin(2 * w + 1),
            head_yaw=6 * math.sin(w + 0.9) - 9 * smooth((ph - 0.3) / 0.08) * (1 - smooth((ph - 0.48) / 0.1)),
            head_pitch=-4 + 3 * math.sin(2 * w + 0.5), head_roll=2 * math.sin(w),
            jaw=2 + 7 * chew, tail_yaw=7 * math.sin(w + 1.2), tail_wave=5, tail_phase=2 * w, tail_lift=2 + br,
            tail_droop=6), 'auto'))
    return keys_of(seq, loop=True)


# ------------------------------------------------------------------ strikes
def rear_feet(b, tuck_f=(0.0, 0.7, 1.3), tuck_r=None, pivot=None):
    """Front feet carried up with a reared body, elbows folded (`tuck` back, up)."""
    tuck_r = tuck_r if tuck_r is not None else tuck_f
    out = {}
    for key, rest, tk in (('fl', FL0, tuck_f), ('fr', A.mirror(FL0), tuck_r)):
        p = rest + np.array((0.0, tk[1], tk[2] - 0.35)) + np.array((tk[0] * np.sign(rest[0]), 0, 0))
        out[key] = tuple(b.to_world(p))
        out['fdir_' + key] = foot_dir(-55, True)
    return b.but(**out)


def tail_swipe(rig):
    """Tail Swipe. CONTRACT: the bar is 1.0 s; the tail sweeps through the middle of
    the rear cone at 1.00 s (the hit and the water spray), from its left to its
    right, the tip whipping past at 1.15 s."""
    st = stance(rig)
    coil = st.but(pelvis=(0.15, 0.1, -0.5), roll=-2, hip_yaw=8, spine_yaw=6, neck_yaw=28, neck_raise=4, head_yaw=18,
                  head_pitch=0, jaw=8, tail_yaw=30, tail_curl=10, tail_lift=8, tail_droop=0)
    cock = coil.but(pelvis=(0.25, 0.15, -0.55), roll=-3.5, hip_yaw=14, spine_yaw=9, neck_yaw=38, head_yaw=22,
                    jaw=14, tail_yaw=52, tail_curl=22, tail_lift=12)
    strike = st.but(pelvis=(-0.2, 0.0, -0.6), roll=3, hip_yaw=-12, spine_yaw=-8, neck_yaw=-14, neck_raise=2,
                    head_yaw=-10, jaw=24, tail_yaw=-4, tail_curl=26, tail_lift=6, tail_droop=0)
    follow = st.but(pelvis=(-0.3, 0.0, -0.55), roll=3.5, hip_yaw=-16, spine_yaw=-10, neck_yaw=-22, head_yaw=-12,
                    jaw=18, tail_yaw=-52, tail_curl=-22, tail_lift=8, tail_droop=0)
    settle = follow.but(pelvis=(-0.15, 0.0, -0.45), roll=1.5, hip_yaw=-8, tail_yaw=-36, tail_curl=-8, jaw=8,
                        neck_yaw=-10)
    return keys_of([(0.0, st, 'auto'), (0.35, coil, 'auto'), (0.72, cock, 'in'), (1.0, strike, 'linear'),
                    (1.16, follow, 'out'), (1.5, settle, 'auto'), (2.4, st, 'auto')])


def stomp(rig):
    """Earthshaking Stomp. CONTRACT: the 2.0 s bar is the rear; both front feet slam
    the ford at 2.00 s (the shockwave and the splash), the body jolts at 2.12 s."""
    st = stance(rig)
    hips = (0.0, 3.2, 5.9)
    crouch = st.but(pelvis=(0, 0.25, -0.75), pitch=-2.5, pivot=hips, neck_raise=-9, head_pitch=-10, tail_lift=-2,
                    jaw=4, spine_pitch=-2)
    rise = st.but(pelvis=(0, 0.55, -0.55), pitch=17, pivot=hips, neck_raise=12, head_pitch=10, jaw=22, tail_lift=17,
                  tail_droop=-6, spine_pitch=4, scap_l=10, scap_r=10)
    rise = rear_feet(rise, (0.1, 0.6, 1.1), (0.1, 0.7, 1.5))
    apex = st.but(pelvis=(0, 0.6, -0.5), pitch=23, pivot=hips, neck_raise=20, head_pitch=14, jaw=34, tail_lift=22,
                  tail_droop=-8, spine_pitch=6, scap_l=14, scap_r=14)
    apex = rear_feet(apex, (0.15, 0.4, 1.9), (0.1, 0.8, 1.4))
    hang = apex.but(pitch=23.5, jaw=30)
    hang = rear_feet(hang, (0.15, 0.5, 1.7), (0.15, 0.6, 1.8))
    impact = st.but(pelvis=(0, -0.2, -0.85), pitch=-1.5, pivot=hips, neck_raise=-12, neck_curl=-4, head_pitch=-14,
                    jaw=12, tail_lift=6, spine_pitch=-3, fl=(FL0[0] + 0.15, FL0[1] - 0.35, FOOT_Z),
                    fr=(-FL0[0] - 0.15, FL0[1] - 0.35, FOOT_Z), scap_l=-6, scap_r=-6)
    jolt = impact.but(pelvis=(0, -0.25, -0.95), pitch=-2.2, neck_raise=-17, head_pitch=-18, jaw=8, spine_pitch=-4)
    hold = impact.but(pelvis=(0, -0.15, -0.7), pitch=-0.8, neck_raise=-6, head_pitch=-6, jaw=6, spine_pitch=-1)
    return keys_of([(0.0, st, 'auto'), (0.45, crouch, 'auto'), (1.15, rise, 'auto'), (1.6, apex, 'auto'),
                    (1.74, hang, 'in'), (2.0, impact, 'out'), (2.12, jolt, 'inout'), (2.5, hold, 'inout'),
                    (3.2, st.but(fl=impact.p['fl'], fr=impact.p['fr']), 'auto')])


def attack(rig):
    """Melee (the auto-attack): a crushing head-ram and bite. CONTRACT: the blow lands
    at 0.62 s."""
    st = stance(rig)
    wind = st.but(pelvis=(0.05, 0.4, -0.4), neck_raise=13, neck_yaw=9, neck_curl=6, head_pitch=16, jaw=24,
                  spine_pitch=2, tail_lift=6)
    strike = st.but(pelvis=(-0.05, -0.45, -0.5), neck_raise=-16, neck_yaw=-4, neck_curl=-4, head_pitch=-14, jaw=30,
                    spine_pitch=-2, scap_l=-4, scap_r=-4, tail_lift=-2)
    bite = strike.but(jaw=3, neck_raise=-18, head_pitch=-16)
    return keys_of([(0.0, st, 'auto'), (0.36, wind, 'in'), (0.62, strike, 'linear'), (0.68, bite, 'out'),
                    (0.9, bite.but(neck_raise=-12, jaw=6), 'auto'), (1.5, st, 'auto')])


def roar(rig):
    """Roar: rocks back onto its haunches, the neck thrown up, the jaw wide, a shake
    of the head at the peak. CONTRACT: the roar peaks at 1.00 s."""
    st = stance(rig)
    hips = (0.0, 3.2, 5.9)
    load = st.but(pelvis=(0, -0.2, -0.55), neck_raise=-12, neck_curl=4, head_pitch=-14, jaw=6, tail_lift=-3)
    peak = st.but(pelvis=(0, 0.45, -0.5), pitch=6, pivot=hips, neck_raise=22, neck_curl=-6, head_pitch=30, jaw=44,
                  spine_pitch=3, tail_lift=14, tail_droop=-4, tail_wave=8)
    seq = [(0.0, st, 'auto'), (0.5, load, 'in'), (1.0, peak, 'out')]
    for k, t in enumerate((1.3, 1.6, 1.9)):
        sgn = 1 if k % 2 == 0 else -1
        seq.append((t, peak.but(head_yaw=8 * sgn, head_roll=6 * sgn, neck_yaw=-5 * sgn, jaw=40 + 4 * sgn,
                                tail_phase=1.5 * (k + 1)), 'auto'))
    seq += [(2.4, st.but(neck_raise=4, head_pitch=6, jaw=12), 'auto'), (3.0, st, 'auto')]
    return keys_of(seq)


def enrage(rig):
    """Enrage (below a fifth of its health): rears a little, stamps the left then the
    right forefoot, thrashes its head and lashes its tail. CONTRACT: the stamps land
    at 0.85 s and 1.35 s."""
    st = stance(rig)
    hips = (0.0, 3.2, 5.9)
    crouch = st.but(pelvis=(0, 0.1, -0.65), neck_raise=-12, head_pitch=-16, jaw=10, tail_lift=-2)
    up_l = st.but(pelvis=(0, 0.3, -0.45), pitch=7, pivot=hips, neck_raise=12, head_pitch=14, jaw=32, tail_lift=12,
                  tail_yaw=18)
    up_l = up_l.but(fl=tuple(up_l.to_world(FL0 + np.array((0.0, 0.3, 1.5)))), fdir_fl=foot_dir(-40))
    down_l = st.but(pelvis=(0, -0.1, -0.7), pitch=-1, pivot=hips, neck_raise=-6, head_pitch=-8, jaw=24, tail_yaw=-16,
                    fl=(FL0[0], FL0[1] - 0.4, FOOT_Z))
    up_r = down_l.but(pelvis=(0, 0.2, -0.5), pitch=6, neck_raise=10, head_pitch=12, jaw=34, tail_yaw=20)
    up_r = up_r.but(fr=tuple(up_r.to_world(A.mirror(FL0) + np.array((0.0, 0.3, 1.5)))), fdir_fr=foot_dir(-40))
    down_r = down_l.but(fr=(-FL0[0], FL0[1] - 0.4, FOOT_Z), tail_yaw=-18)
    seq = [(0.0, st, 'auto'), (0.3, crouch, 'auto'), (0.62, up_l, 'in'), (0.85, down_l, 'out'), (1.12, up_r, 'in'),
           (1.35, down_r, 'out')]
    for k, t in enumerate((1.55, 1.75, 1.95, 2.15)):
        sgn = 1 if k % 2 == 0 else -1
        seq.append((t, down_r.but(neck_yaw=20 * sgn, head_yaw=12 * sgn, head_roll=8 * sgn, neck_raise=4, jaw=38,
                                  tail_yaw=-28 * sgn, tail_curl=-14 * sgn), 'auto'))
    seq.append((2.7, st.but(fl=down_l.p['fl'], fr=down_r.p['fr'], jaw=10), 'auto'))
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(pelvis=(0.18, 0.1, -0.45), roll=3.5, neck_raise=7, neck_yaw=-11, head_pitch=9, head_yaw=-6, jaw=16,
                    tail_yaw=9, spine_yaw=-3)
    back = st.but(pelvis=(-0.05, 0.0, -0.38), roll=-1.2, neck_yaw=3, jaw=6)
    return keys_of([(0.0, st, 'auto'), (0.1, flinch, 'out'), (0.32, back, 'inout'), (0.7, st, 'auto')])


# ------------------------------------------------------------------ the howdah breaking
BURST = 0.9
RIDER_LAND = 1.8
GRAV = np.array((0.0, 0.0, -13.0))
# initial velocity (yd/s) and spin (axis, deg/s) of each piece when it bursts
FLIGHT = {
    'HowdahRoof': ((0.6, 2.2, 9.0), ((1, 0.3, 0.2), 190)),
    'HowdahBase': ((-3.4, 0.6, 5.0), ((0.2, 1, 0), -120)),
    'HowdahRailL': ((5.6, -0.4, 6.0), ((0, 1, 0.3), 260)),
    'HowdahRailR': ((-6.0, 0.6, 5.5), ((0.1, 1, -0.2), -300)),
    'HowdahRailF': ((0.8, -5.5, 6.5), ((1, 0, 0.3), -280)),
    'HowdahPostFL': ((4.8, -3.5, 7.0), ((0.4, 1, 0), 330)),
    'HowdahPostFR': ((-4.6, -3.2, 7.4), ((0.5, -1, 0.2), 360)),
    'HowdahPostBL': ((4.2, 3.0, 8.0), ((1, -0.3, 0.2), -240)),
    'HowdahPostBR': ((-4.4, 3.6, 7.6), ((1, 0.4, 0), 260)),
}
RIDER_TARGET = np.array((-6.2, 5.6, 0.25))      # behind its right flank, on the ford's bed
WATER_Z = 0.35


def _flight_state(rig, body_at_burst):
    pose = body_at_burst.solve({})
    st = {}
    for b in FLOWN:
        st[b] = (np.array(pose.head[b]), pose.delta[b].copy())
    return st


def howdah_post(rig, state):
    """Throw the howdah pieces off along ballistic paths after the burst; each lands in
    the ford, drifts, sinks and is gone (scale 0) by 3.3 s. Before it, a rattle."""
    rng = np.random.default_rng(3)
    phase = {b: rng.uniform(0, 6) for b in FLOWN}
    axes = {b: rng.normal(size=3) for b in FLOWN}

    def place(pose, b, P, Q, s=1.0):
        dp = pose.delta['Saddle']
        pose.loc[b] = tuple(P - np.array(pose.head[b]))
        q_arm = dp.inverted() @ Q
        rm = rig.frames[b]
        pose[b] = (rm.inverted() @ q_arm.to_matrix() @ rm).to_quaternion()
        if s != 1.0:
            pose.scale[b] = s

    def post(pose, t, body):
        if t < BURST:
            if t > 0.5:
                amp = 3.5 * smooth((t - 0.5) / 0.3)
                rm_saddle = pose.delta['Saddle']
                for b in FLOWN:
                    if b == 'Rider':
                        continue
                    ax = axes[b] / np.linalg.norm(axes[b])
                    q = Quaternion(V(ax), math.radians(amp * math.sin(t * 38 + phase[b])))
                    rm = rig.frames[b]
                    pose[b] = (rm.inverted() @ q.to_matrix() @ rm).to_quaternion()
            return
        dt = t - BURST
        for b in FLOWN:
            P0, Q0 = state[b]
            if b == 'Rider':
                T = RIDER_LAND - BURST
                v = (RIDER_TARGET - P0 - 0.5 * GRAV * T * T) / T
                tt = min(dt, T)
                P = P0 + v * tt + 0.5 * GRAV * tt * tt
                Q = Quaternion(V((0, 0, 1)), math.radians(-70 * smooth(tt / T))) @ Q0
                s = 1.0 if dt < T + 0.04 else 0.0
                place(pose, b, P, Q, s)
                continue
            v, (axis, spin) = FLIGHT[b]
            v = np.array(v, float)
            ax = np.array(axis, float)
            ax /= np.linalg.norm(ax)
            # time to reach the water
            a, bq, c = 0.5 * GRAV[2], v[2], P0[2] - WATER_Z
            t_hit = (-bq - math.sqrt(bq * bq - 4 * a * c)) / (2 * a)
            if dt <= t_hit:
                P = P0 + v * dt + 0.5 * GRAV * dt * dt
                ang = spin * dt
            else:
                Ph = P0 + v * t_hit + 0.5 * GRAV * t_hit * t_hit
                drift = 1.0 - math.exp(-(dt - t_hit) * 2.5)
                P = Ph + np.array((v[0], v[1], 0)) * 0.16 * drift
                P[2] = WATER_Z - 0.9 * smooth((dt - t_hit - 0.3) / 1.1)
                ang = spin * t_hit + spin * 0.12 * drift
            Q = Quaternion(V(ax), math.radians(ang)) @ Q0
            s = 1.0 - smooth((t - 2.6) / 0.7)
            place(pose, b, P, Q, max(0.0, s))
    return post


def howdah_break(rig):
    """HowdahBreak (at half health). It tenses, bucks and rolls hard; CONTRACT: the
    howdah bursts at 0.90 s (the shatter VFX), the pieces hit the ford at about 1.4 to
    1.9 s, the rider lands behind its right flank at 1.80 s and the render-only rider
    is gone (scale 0) at 1.84 s, when the real Howdah Hexcaller takes its place. Every
    piece has sunk out of sight (scale 0) by 3.30 s; after this clip the game hides the
    GreatSaurianHowdah and GreatSaurianRider meshes for good."""
    st = stance(rig)
    tense = st.but(pelvis=(0, 0.1, -0.7), neck_raise=-12, head_pitch=-12, spine_pitch=-3, tail_lift=-4, jaw=8)
    buck = st.but(pelvis=(0.2, -0.1, -0.1), roll=-9, spine_pitch=5, neck_raise=14, head_pitch=16, jaw=30, tail_lift=16,
                  hip_roll=-5, neck_yaw=10)
    burst = st.but(pelvis=(-0.25, 0.0, -0.25), roll=11, spine_roll=4, neck_raise=8, neck_yaw=-24, head_yaw=-10,
                   head_pitch=10, jaw=36, tail_yaw=-20, tail_lift=10)
    shake = [(1.15, st.but(pelvis=(0.2, 0, -0.45), roll=-9, neck_yaw=22, head_yaw=10, jaw=28, tail_yaw=18)),
             (1.4, st.but(pelvis=(-0.15, 0, -0.42), roll=6.5, neck_yaw=-16, head_yaw=-8, jaw=24, tail_yaw=-14)),
             (1.65, st.but(pelvis=(0.08, 0, -0.4), roll=-3.5, neck_yaw=9, jaw=20, tail_yaw=8))]
    howl = st.but(neck_raise=18, head_pitch=24, jaw=40, pelvis=(0, 0.2, -0.4), tail_lift=10, tail_wave=6)
    seq = [(0.0, st, 'auto'), (0.42, tense, 'in'), (0.75, buck, 'auto'), (BURST, burst, 'auto')]
    seq += [(t, b, 'auto') for t, b in shake]
    seq += [(2.05, howl, 'auto'), (2.6, howl.but(jaw=30, head_yaw=6), 'auto'), (3.8, st, 'auto')]
    state = _flight_state(rig, sample(seq, BURST))
    return keys_of(seq, post=howdah_post(rig, state))


# ------------------------------------------------------------------ death
def death(rig):
    """Death: it staggers, the forelegs buckle, it sinks onto its belly and rolls onto
    its left side into the ford, the neck slamming down last. CONTRACT: the body hits
    the water at 2.70 s (the big splash), the neck at 2.85 s, at rest from 3.40 s."""
    st = stance(rig)
    hips = (0.0, 3.2, 5.9)
    left_belly = (2.4, 0.0, 0.3)
    stagger = st.but(pelvis=(-0.2, 0.15, -0.5), roll=-3.5, neck_raise=12, head_pitch=20, jaw=30, tail_lift=6)
    buckle = st.but(pelvis=(0.1, 0.2, -1.0), pitch=-8, pivot=hips, neck_raise=-6, head_pitch=-4, jaw=22, tail_lift=-2,
                    fl=(FL0[0] + 0.5, FL0[1] - 0.6, FOOT_Z), fr=(-FL0[0] - 0.5, FL0[1] - 0.6, FOOT_Z),
                    fdir_fl=foot_dir(-30), fdir_fr=foot_dir(-30))
    sink = st.but(pelvis=(0.3, 0.2, -2.6), pitch=-3, pivot=hips, neck_raise=-10, head_pitch=-6, jaw=16,
                  fl=(FL0[0] + 1.6, FL0[1] - 1.2, FOOT_Z), fr=(-FL0[0] - 1.6, FL0[1] - 1.2, FOOT_Z),
                  hl=(HL0[0] + 1.5, HL0[1] + 0.9, FOOT_Z), hr=(-HL0[0] - 1.5, HL0[1] + 0.9, FOOT_Z),
                  fdir_fl=foot_dir(-50), fdir_fr=foot_dir(-50), fdir_hl=foot_dir(-50, False),
                  fdir_hr=foot_dir(-50, False), tail_lift=-6, tail_droop=10)

    def lying(roll, center, neck, jaw, tail):
        b = st.but(roll=roll, pivot=left_belly, neck_raise=neck, neck_yaw=12 + neck * -0.3,
                   neck_roll=8, head_pitch=-6, head_roll=12, jaw=jaw, tail_lift=2, tail_yaw=tail, tail_droop=4)
        # place the barrel's centre where it lies, whatever the pivot did
        q = body_matrix(0.0, 0.0, roll)
        piv, c = V(left_belly), V((0.0, 0.0, 7.0))
        b = b.but(pelvis=tuple(V(center) - (q @ c + piv - q @ piv)))
        k = min(1.0, abs(roll) / 60.0)
        feet = {}
        # every leg goes limp in the body's own frame: on its side they all stick
        # out across the ford, the left ones lying under the right
        for key, rest, out in (('fl', FL0, (-2.4, -1.0, 1.9)), ('fr', A.mirror(FL0), (-0.5, -1.1, 1.5)),
                               ('hl', HL0, (-2.4, 1.0, 1.9)), ('hr', A.mirror(HL0), (-0.5, 1.0, 1.5))):
            w = b.to_world(rest + np.array(out))
            g = np.array((rest[0] + out[0] * 1.4, rest[1] + out[1], FOOT_Z))
            feet[key] = tuple(g * (1 - k) + w * k)
            feet['fdir_' + key] = foot_dir(-60, key.startswith('f'))
        return b.but(**feet)
    roll1 = lying(34, (1.5, 0.2, 4.6), -14, 14, -4)
    hitw = lying(72, (3.3, 0.2, 3.45), -24, 10, -10)
    bounce = lying(67, (3.25, 0.2, 3.75), -20, 12, -9)
    slam = lying(70, (3.3, 0.2, 3.55), -30, 18, -10)
    rest = lying(70, (3.3, 0.2, 3.6), -29, 8, -10)
    return keys_of([(0.0, st, 'auto'), (0.38, stagger, 'auto'), (0.95, buckle, 'in'), (1.55, sink, 'auto'),
                    (2.15, roll1, 'in'), (2.7, hitw, 'out'), (2.85, slam, 'out'), (3.05, bounce, 'inout'),
                    (3.4, rest, 'inout'), (4.4, rest, 'linear')])


CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Run', run, True, RUN_SPEED),
    ('Attack', attack, False, 0.0),
    ('TailSwipe', tail_swipe, False, 0.0),
    ('Stomp', stomp, False, 0.0),
    ('Roar', roar, False, 0.0),
    ('HowdahBreak', howdah_break, False, 0.0),
    ('Enrage', enrage, False, 0.0),
    ('Hit', hit, False, 0.0),
    ('Death', death, False, 0.0),
]


def make_clips(arm, only=None):
    rig = R.Rig(arm)
    made = []
    for name, fn, loop, wind in CATALOG:
        if only and name not in only:
            continue
        keys = fn(rig)
        act = R.make_clip(arm, name, keys)
        R.follow_through(arm, act, loop=loop, wind=wind)
        made.append(name)
    return made
