"""The Great Jaguar's clips, keyed from a whole-body big-cat pose language.

`Body(**params)` turns a few dozen readable numbers into a full pose: where the
body sits and how it pitches and rolls (about a chosen PIVOT), how the spine
bends and arches (spread down its three bones), how the neck rises and turns,
where the head looks and how wide the jaw opens, where the ears lie, how the
tail lifts, swings, curls and waves (spread down its eight bones), where each
paw stands (two-bone IK onto the wrist or the hock, the metacarpus or the long
metatarsus aimed onto the paw, the toes flat or curled).

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body, so arcs stay arcs.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `pitch` + noses up; `roll` + rolls onto its LEFT side; `yaw` + turns
left; `arch` + humps the back (the gathered gallop, the stalk's shoulders);
`neck_raise` + lifts the neck; `head_pitch` + lifts the nose; `jaw` + opens
(degrees, as authored); `ears_back` + flattens the ears back; `tail_lift` +
lifts the tail; `tail_yaw` + swings it to its LEFT.

CONTRACT lines name the frames the game should read (the bite lands, the claws
hit, the leap lands).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
FP0 = np.array(A.FPAW)       # left front paw ball, planted
HP0 = np.array(A.HPAW)       # left hind paw ball, planted
PAW_Z = A.FPAW[2]
HAND_DIR = A.REST['L_Hand'][1] - A.REST['L_Hand'][0]
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
FTOE_DIR = A.REST['L_FToes'][1] - A.REST['L_FToes'][0]
HTOE_DIR = A.REST['L_HToes'][1] - A.REST['L_HToes'][0]
L_HAND = float(np.linalg.norm(HAND_DIR))
L_FOOT = float(np.linalg.norm(FOOT_DIR))
JAW_GAIN = 0.9
NECK_W = (0.55, 0.45)
SPINE_W = (0.3, 0.35, 0.35)
TAIL_W = (0.22, 0.18, 0.15, 0.12, 0.1, 0.09, 0.08, 0.06)


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def rot_x(v, deg):
    """Turn a direction about +X: + turns a forward (-Y) vector DOWN."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def body_matrix(yaw, pitch, roll):
    q = Quaternion((0, 0, 1), math.radians(yaw))
    q = Quaternion((1, 0, 0), math.radians(-pitch)) @ q
    q = Quaternion((0, 1, 0), math.radians(roll)) @ q
    return q


def fdir(deg, front=True):
    """The metacarpus (front) or metatarsus (hind) turned by `deg` from rest about
    +X: + folds the front paw back under the wrist / swings the hind foot down."""
    return tuple(rot_x(HAND_DIR if front else FOOT_DIR, deg) / (L_HAND if front else L_FOOT))


def tdir(deg, front=True):
    """The toes turned by `deg` about +X from rest (+ curls them down)."""
    d = rot_x(FTOE_DIR if front else HTOE_DIR, deg)
    return tuple(d / np.linalg.norm(d))


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0), pivot=(0.0, 2.0, 2.8),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_pitch=0.0, hip_roll=0.0, hip_yaw=0.0,
        spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0, arch=0.0,
        neck_raise=0.0, neck_yaw=0.0, neck_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0,
        ears_back=0.0, ears_out=0.0, ear_l=0.0, ear_r=0.0,
        tail_lift=0.0, tail_yaw=0.0, tail_curl=0.0, tail_droop=0.0, tail_wave=0.0, tail_phase=0.0, tail_flick=0.0,
        scap_l=0.0, scap_r=0.0,
        fl=tuple(FP0), fr=tuple(A.mirror(FP0)), hl=tuple(HP0), hr=tuple(A.mirror(HP0)),
        fd_fl=0.0, fd_fr=0.0, fd_hl=0.0, fd_hr=0.0,          # metacarpus / metatarsus turn (deg)
        td_fl=0.0, td_fr=0.0, td_hl=0.0, td_hr=0.0,          # toe curl (deg)
        pole_f=(0.1, 1.0, 0.0), pole_h=(0.1, -1.0, 0.0),
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
        """Where a rest-space point rides with the whole-body turn (a lifted paw)."""
        root, q = self.root()
        return np.array(q @ V(rest_point) + root)

    def solve(self, memory=None):
        p = self.p
        turns, aims, ik = {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', -p['hip_pitch']), ('z', p['hip_yaw']), ('y', p['hip_roll'])]
        arch = (p['arch'] * 0.55, 0.0, -p['arch'] * 0.7)
        for (b, w), ar in zip((('Spine1', SPINE_W[0]), ('Spine2', SPINE_W[1]), ('Spine3', SPINE_W[2])), arch):
            turns[b] = [('x', -(p['spine_pitch'] * w + ar)), ('z', p['spine_yaw'] * w), ('y', p['spine_roll'] * w)]
        for i, w in enumerate(NECK_W):
            turns[f'Neck{i + 1}'] = [('x', -p['neck_raise'] * w), ('z', p['neck_yaw'] * w), ('y', p['neck_roll'] * w)]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        turns['L_Ear'] = [('x', -(p['ears_back'] + p['ear_l'])), ('y', p['ears_out'])]
        turns['R_Ear'] = [('x', -(p['ears_back'] + p['ear_r'])), ('y', -p['ears_out'])]
        n = len(TAIL_W)
        for i, w in enumerate(TAIL_W):
            k = i / (n - 1)
            wave = p['tail_wave'] * math.sin(p['tail_phase'] - i * 0.7) * (0.35 + 0.65 * k)
            yaw = p['tail_yaw'] * w + p['tail_curl'] * k * 0.2 + wave
            lift = p['tail_lift'] * w - p['tail_droop'] * k * 0.18 + p['tail_flick'] * max(0.0, k - 0.55) * 0.9
            turns[f'Tail{i + 1}'] = [('x', lift), ('z', -yaw)]
        turns['L_Scapula'] = [('x', -p['scap_l'])]
        turns['R_Scapula'] = [('x', -p['scap_r'])]
        for side, s, key_f, key_h in (('L_', 1, 'fl', 'hl'), ('R_', -1, 'fr', 'hr')):
            pf = (p['pole_f'][0] * s, p['pole_f'][1], p['pole_f'][2])
            ph = (p['pole_h'][0] * s, p['pole_h'][1], p['pole_h'][2])
            hd = np.array(fdir(p['fd_' + key_f], True))
            fd = np.array(fdir(p['fd_' + key_h], False))
            wrist = np.asarray(p[key_f]) - hd * L_HAND
            hock = np.asarray(p[key_h]) - fd * L_FOOT
            ik['f' + side] = (side + 'UpperArm', side + 'Forearm', tuple(wrist), pf)
            ik['h' + side] = (side + 'Thigh', side + 'Shin', tuple(hock), ph)
            aims[side + 'Hand'] = V(tuple(hd))
            aims[side + 'Foot'] = V(tuple(fd))
            aims[side + 'FToes'] = V(tdir(p['td_' + key_f], True))
            aims[side + 'HToes'] = V(tdir(p['td_' + key_h], False))
        root, _ = self.root()
        return self.rig.pose(aims=aims, ik=ik, turns=turns, root=tuple(root), mirror=False, memory=memory)


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


def keys_of(seq, loop=False, post=None):
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


# ------------------------------------------------------------------ stance and gaits
def stance(rig):
    """Standing alert: head a little up, tail low in a loose J."""
    return Body(rig, neck_raise=4.0, head_pitch=-3.0, tail_lift=14.0, tail_droop=-6, ears_back=-4)


def gait_foot(phase, stance_frac, half, lift, rest, front, reach=0.0, famp=None):
    """Paw target and metacarpus/metatarsus + toe turns for one paw at `phase`
    (0 = touchdown). The planted paw slides back at the gait speed, the toes flat;
    in the swing the front paw folds back under the wrist and the hind foot hangs,
    the toes curl, and both reach forward before touching down."""
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        y = rest[1] - half + 2 * half * u
        z = PAW_Z
        heel = smooth((u - 0.7) / 0.3)                 # the push-off: the wrist / hock rises
        fd = (-28 if front else -22) * heel
        td = -10 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = rest[1] + half - (2 * half + reach) * e + reach * smooth((u - 0.75) / 0.25)
        z = PAW_Z + lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.6
        if front:   # the carpus folds once the paw is up and opens before it reaches forward
            fold = math.sin(math.pi * min(1.0, max(0.0, u - 0.06) / 0.56)) if u < 0.62 else 0.0
        else:
            fold = math.sin(math.pi * min(1.0, u * 1.25)) if u < 0.8 else 0.0
        fd = (famp if famp is not None else (90 if front else 45)) * fold - (8 if front else 4) * smooth((u - 0.75) / 0.25)
        td = fd + 35 * fold * smooth(u / 0.3)    # the toes follow the folding paw, curled
    return (rest[0], y, z), fd, td


def gait_body(rig, ph, period, speed, stance_frac, lift, phases, base, wave=6.0, bob=0.06, roll=1.6, reach=0.0,
              head_counter=True):
    half = speed * stance_frac * period / 2
    kw = {}
    for key, rest, front in (('fl', FP0, True), ('fr', A.mirror(FP0), True), ('hl', HP0, False),
                             ('hr', A.mirror(HP0), False)):
        f, fd, td = gait_foot((ph - phases[key]) % 1.0, stance_frac, half, lift, rest, front, reach)
        kw[key] = f
        kw['fd_' + key] = fd
        kw['td_' + key] = td
    w = TAU * ph
    p0 = base.p
    return base.but(
        pelvis=(p0['pelvis'][0] + 0.05 * math.sin(w - 0.6), p0['pelvis'][1], p0['pelvis'][2] - bob * math.cos(2 * w)),
        roll=p0['roll'] - roll * math.sin(w - 0.6), hip_roll=2.2 * math.sin(w), spine_roll=-2.0 * math.sin(w),
        spine_yaw=2.4 * math.sin(w), hip_yaw=-3.0 * math.sin(w),
        scap_l=p0['scap_l'] + 6 * math.sin(w - TAU * phases['fl']),
        scap_r=p0['scap_r'] + 6 * math.sin(w - TAU * phases['fr']),
        neck_raise=p0['neck_raise'] + 1.5 * math.cos(2 * w), neck_yaw=-2.5 * math.sin(w),
        head_pitch=p0['head_pitch'] + (-2.0 * math.cos(2 * w) if head_counter else 0), head_yaw=2.0 * math.sin(w),
        tail_yaw=5 * math.sin(w), tail_wave=wave, tail_phase=w, **kw)


WALK_PERIOD, WALK_SPEED, WALK_STANCE = 1.6, 2.4, 0.64
STALK_PERIOD, STALK_SPEED, STALK_STANCE = 2.2, 1.6, 0.7
RUN_PERIOD, RUN_SPEED = 0.625, 9.0
WALK_PHASES = dict(hl=0.0, fl=0.22, hr=0.5, fr=0.72)


def walk(rig):
    base = stance(rig).but(neck_raise=-2, head_pitch=0)
    nfr = int(round(WALK_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, WALK_PERIOD, WALK_SPEED, WALK_STANCE, 0.42, WALK_PHASES, base),
            'linear') for i in range(nfr + 1)]
    return keys_of(seq)


def stalk(rig):
    """The low prowl: the belly near the ground, the shoulder blades rolling high,
    the head level and locked on its prey, the ears pricked, the tail low with a
    twitching tip."""
    base = stance(rig).but(pelvis=(0, 0.0, -0.75), arch=-4, neck_raise=-12, head_pitch=8, ears_back=-6,
                           tail_lift=4, tail_droop=-8, scap_l=8, scap_r=8, pole_f=(0.35, 1.0, 0.0),
                           pole_h=(0.3, -1.0, 0.0))
    nfr = int(round(STALK_PERIOD * R.FPS))
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        b = gait_body(rig, ph, STALK_PERIOD, STALK_SPEED, STALK_STANCE, 0.34, WALK_PHASES, base, wave=3.0, bob=0.03,
                      roll=1.0, head_counter=False)
        w = TAU * ph
        # the head stays locked on: counter the body's sway, and the tip twitches
        b = b.but(head_yaw=-1.0 * math.sin(w), neck_yaw=0.6 * math.sin(w),
                  tail_flick=10 * math.sin(4 * w) * smooth(abs(math.sin(w))), scap_l=10 + 10 * math.sin(w - TAU * 0.22),
                  scap_r=10 + 10 * math.sin(w - TAU * 0.72))
        # the paws spread a little wider in the crouch
        for key in ('fl', 'fr', 'hl', 'hr'):
            x, y, z = b.p[key]
            b.p[key] = (x * 1.12, y, z)
        seq.append((i / R.FPS, b, 'linear'))
    return keys_of(seq)


def run(rig):
    """The rotary gallop: the hind pair lands (left then right), drives, the fore
    pair lands (right then left), then the gathered flight with the back humped
    and the hind legs swinging under the chest. The spine extends at the hind
    push-off and flexes in the flight."""
    nfr = int(round(RUN_PERIOD * R.FPS))
    base = stance(rig).but(neck_raise=-8, head_pitch=6, ears_back=10, tail_lift=18, tail_droop=-10)
    ph_of = dict(hl=0.0, hr=0.07, fr=0.38, fl=0.45)
    st = 0.3
    half = RUN_SPEED * st * RUN_PERIOD / 2
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        kw = {}
        for key, rest, front in (('fl', FP0, True), ('fr', A.mirror(FP0), True), ('hl', HP0, False),
                                 ('hr', A.mirror(HP0), False)):
            r = np.array(rest, float)
            r[1] += -0.35 if front else 0.15
            f, fd, td = gait_foot((ph - ph_of[key]) % 1.0, st, half, 0.9 if front else 0.8, r, front, 0.25,
                                  famp=60 if front else 40)
            kw[key] = f
            kw['fd_' + key] = fd
            kw['td_' + key] = td
        w = TAU * ph
        # arch: + humped (gathered, flight ~0.85), - extended (hind push-off ~0.25)
        arch = 9 * math.cos(TAU * (ph - 0.85))
        lift = 0.28 * smooth((ph - 0.72) / 0.12) * (1 - smooth((ph - 0.94) / 0.06)) + 0.12 * math.sin(TAU * (ph - 0.1))
        pitch = 4.0 * math.sin(TAU * (ph - 0.15))
        b = base.but(pelvis=(0.0, 0.0, -0.18 + lift), pitch=pitch, pivot=(0, 0.0, 2.8), arch=arch,
                     hip_pitch=-3 * math.cos(TAU * (ph - 0.85)), spine_yaw=1.5 * math.sin(w), hip_yaw=-2 * math.sin(w),
                     neck_raise=-8 - 6 * math.cos(TAU * (ph - 0.5)), head_pitch=6 + 6 * math.cos(TAU * (ph - 0.5)),
                     scap_l=8 * math.sin(w - TAU * 0.45), scap_r=8 * math.sin(w - TAU * 0.38),
                     tail_wave=7, tail_phase=w, tail_lift=18 + 6 * math.sin(w), jaw=8 + 3 * math.sin(2 * w), **kw)
        seq.append((i / R.FPS, b, 'linear'))
    return keys_of(seq)


def idle(rig, period=5.0):
    """Breathing (three slow breaths), the weight shifting between the forepaws, the
    head scanning for prey, the ears turning to sounds, a slow tail sway with a
    sharp flick of the tip."""
    base = stance(rig)
    seq = []
    n = 20
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(3 * w)
        look = smooth((ph - 0.25) / 0.12) * (1 - smooth((ph - 0.55) / 0.12))
        flick = math.exp(-((ph - 0.72) / 0.05) ** 2) - 0.6 * math.exp(-((ph - 0.8) / 0.05) ** 2)
        seq.append((period * ph, base.but(
            pelvis=(0.04 * math.sin(w), 0.0, -0.025 * br), spine_pitch=0.8 * br, arch=0.8 * br, scap_l=1.5 * br,
            scap_r=1.5 * br, neck_raise=4 + 2.0 * math.sin(w + 0.4) + 1.0 * br, neck_yaw=6 * math.sin(w) + 10 * look,
            head_yaw=4 * math.sin(w + 0.9) + 14 * look, head_pitch=-3 + 2 * math.sin(2 * w + 0.5), head_roll=-5 * look,
            jaw=1.5 + 1.5 * max(0.0, br), ear_l=-10 * look + 6 * math.exp(-((ph - 0.12) / 0.03) ** 2),
            ear_r=8 * look, tail_yaw=10 * math.sin(w + 1.2), tail_wave=6, tail_phase=w, tail_lift=14 + 2 * br,
            tail_flick=40 * flick, tail_curl=6 * math.sin(w)), 'auto'))
    return keys_of(seq, loop=True)


# ------------------------------------------------------------------ strikes
def lifted(b, key, rest, offset, fd, td):
    """A paw carried off the ground with the body: rest + offset rides the body turn."""
    return b.but(**{key: tuple(b.to_world(np.asarray(rest) + np.asarray(offset))), 'fd_' + key: fd,
                    'td_' + key: fd + td})


BITE_T = 0.5


def bite(rig):
    """Bite (the auto-attack on its prey). CONTRACT: the jaws close on the target at
    0.50 s (the blood spray and the bleed); a tearing shake 0.55 to 0.85."""
    st = stance(rig)
    gather = st.but(pelvis=(0, 0.25, -0.18), arch=5, neck_raise=8, head_pitch=10, jaw=14, ears_back=26,
                    tail_lift=6, tail_flick=-20, scap_l=6, scap_r=6)
    lunge = st.but(pelvis=(0, -0.55, -0.32), pitch=-4, arch=-5, neck_raise=-10, head_pitch=-12, jaw=34,
                   ears_back=34, tail_lift=18, scap_l=-6, scap_r=-6,
                   fl=(FP0[0] + 0.05, FP0[1] - 0.5, PAW_Z), fd_fl=0, td_fl=0)
    lunge_mid = lifted(lunge, 'fl', FP0, (0.05, -0.45, 0.55), 20, 0)
    snap = lunge.but(pelvis=(0, -0.62, -0.36), jaw=0, neck_raise=-13, head_pitch=-16, ears_back=30)
    shake = [(0.62, snap.but(neck_yaw=14, head_yaw=10, head_roll=14, jaw=3, pelvis=(0.06, -0.55, -0.34))),
             (0.74, snap.but(neck_yaw=-14, head_yaw=-10, head_roll=-14, jaw=3, pelvis=(-0.06, -0.55, -0.34))),
             (0.86, snap.but(neck_yaw=6, head_yaw=4, head_roll=6, jaw=4, neck_raise=-8))]
    seq = [(0.0, st, 'auto'), (0.22, gather, 'in'), (0.38, lunge_mid, 'linear'), (0.46, lunge, 'quadout'),
           (BITE_T, snap, 'auto')]
    seq += [(t, b, 'auto') for t, b in shake]
    seq += [(1.1, st.but(pelvis=(0, -0.3, -0.1), fl=lunge.p['fl'], jaw=6, ears_back=10), 'auto'),
            (1.4, st.but(fl=lunge.p['fl']), 'auto')]
    return keys_of(seq)


CLAW_T = 0.46


def claw(rig):
    """Claw (a raking swipe of the right forepaw across the front). CONTRACT: the
    claws rake through the target in front of it at 0.46 s (the claw slash VFX),
    from its right to its left."""
    st = stance(rig)
    load = st.but(pelvis=(0.12, 0.3, -0.05), pitch=7, pivot=(0, 1.8, 0.3), roll=-4, arch=3, neck_raise=4,
                  head_pitch=6, head_yaw=-10, jaw=18, ears_back=30, tail_yaw=-14, tail_lift=22)
    load = lifted(load, 'fr', A.mirror(FP0), (-0.55, -0.1, 1.55), 95, -40)
    cock = load.but(pitch=11, roll=-6, head_yaw=-16, jaw=26)
    cock = lifted(cock, 'fr', A.mirror(FP0), (-1.05, 0.0, 1.95), 70, -45)
    strike = st.but(pelvis=(-0.08, -0.25, -0.15), pitch=4, pivot=(0, 1.8, 0.3), roll=3, arch=-3, neck_raise=-4,
                    head_pitch=-6, head_yaw=8, neck_yaw=6, jaw=28, ears_back=34, tail_yaw=12, tail_lift=10)
    strike = lifted(strike, 'fr', A.mirror(FP0), (-0.1, -1.25, 1.05), 20, -35)
    follow = strike.but(pelvis=(-0.12, -0.25, -0.18), roll=5, head_yaw=14, neck_yaw=10, jaw=20, tail_yaw=18)
    follow = lifted(follow, 'fr', A.mirror(FP0), (0.85, -0.85, 0.45), 40, 10)
    land = st.but(pelvis=(0, -0.15, -0.12), jaw=10, ears_back=14, fr=(A.mirror(FP0)[0] + 0.25, FP0[1] - 0.45, PAW_Z))
    return keys_of([(0.0, st, 'auto'), (0.2, load, 'auto'), (0.34, cock, 'in'), (CLAW_T, strike, 'linear'),
                    (0.58, follow, 'quadout'), (0.86, land, 'auto'), (1.3, st.but(fr=land.p['fr']), 'auto')])


LEAP_TAKEOFF, LEAP_LAND, LEAP_HIND = 1.0, 1.5, 1.62


def pounce(rig):
    """Pounce / Leap (also Heel!: the arc leap back to its master). In place: the
    game carries the jaguar across the ground between the takeoff and the landing;
    the clip carries the height of the arc (apex about 2.3 yd at 1.25 s).
    CONTRACT: the haunches wiggle 0.3 to 0.75, the hind paws leave the ground at
    1.00 s, the forepaws LAND at 1.50 s (the dust burst; the hit if it pounces on a
    player), the hind paws at 1.62 s."""
    st = stance(rig)
    hips = (0, 1.9, 2.9)
    crouch = st.but(pelvis=(0, 0.3, -0.6), pitch=-2, pivot=hips, arch=-3, neck_raise=-14, head_pitch=12,
                    ears_back=10, tail_lift=-2, tail_droop=-4, scap_l=10, scap_r=10, pole_f=(0.35, 1.0, 0.0))
    seq = [(0.0, st, 'auto'), (0.3, crouch, 'auto')]
    for k, t in enumerate((0.42, 0.54, 0.66)):
        sg = 1 if k % 2 == 0 else -1
        seq.append((t, crouch.but(hip_yaw=7 * sg, hip_roll=-5 * sg, spine_yaw=-7 * sg, spine_roll=5 * sg,
                                  pelvis=(0.05 * sg, 0.3, -0.6), tail_flick=25 * sg,
                                  tail_yaw=10 * sg), 'auto'))
    load = crouch.but(pelvis=(0, 0.4, -0.72), pitch=-3, arch=4, neck_raise=-16, head_pitch=14, ears_back=26, jaw=10,
                      tail_lift=4)
    seq.append((0.8, load, 'in'))
    # the drive: the hind legs straighten, the forepaws already off and reaching
    drive = st.but(pelvis=(0, -0.4, 0.55), pitch=24, pivot=hips, arch=-8, neck_raise=6, head_pitch=-2, jaw=24,
                   ears_back=30, tail_lift=10, scap_l=-10, scap_r=-10,
                   hl=(HP0[0], HP0[1] + 0.05, PAW_Z), hr=(-HP0[0], HP0[1] + 0.05, PAW_Z), fd_hl=-40, fd_hr=-40,
                   td_hl=-25, td_hr=-25)
    drive = lifted(drive, 'fl', FP0, (0.0, -0.75, 0.25), 20, 10)
    drive = lifted(drive, 'fr', A.mirror(FP0), (0.0, -0.7, 0.2), 25, 10)
    seq.append((LEAP_TAKEOFF, drive, 'quadout'))
    apex = st.but(pelvis=(0, 0.0, 2.3), pitch=4, pivot=(0, 0, 2.8), arch=-6, neck_raise=0, head_pitch=-6, jaw=34,
                  ears_back=34, tail_lift=2, tail_droop=-14)
    apex = lifted(apex, 'fl', FP0, (0.05, -0.95, 0.35), 15, -20)
    apex = lifted(apex, 'fr', A.mirror(FP0), (-0.05, -0.9, 0.3), 15, -20)
    apex = lifted(apex, 'hl', HP0, (0.0, 0.85, 0.35), -45, -30)
    apex = lifted(apex, 'hr', A.mirror(HP0), (0.0, 0.85, 0.35), -45, -30)
    seq.append((1.25, apex, 'quadin'))
    reach = st.but(pelvis=(0, -0.2, 0.55), pitch=-14, pivot=(0, 0, 2.8), arch=-4, neck_raise=-4, head_pitch=-8, jaw=38,
                   ears_back=34, tail_lift=16)
    reach = lifted(reach, 'hl', HP0, (0.0, 0.6, 0.45), -30, 10)
    reach = lifted(reach, 'hr', A.mirror(HP0), (0.0, 0.6, 0.45), -30, 10)
    reach = reach.but(fl=(FP0[0], FP0[1] - 0.6, PAW_Z + 0.08), fr=(-FP0[0], FP0[1] - 0.55, PAW_Z + 0.05),
                      td_fl=-15, td_fr=-15)
    seq.append((1.44, reach, 'linear'))
    land = st.but(pelvis=(0, -0.3, -0.7), pitch=-10, pivot=(0, 0, 2.8), arch=6, neck_raise=-14, head_pitch=-4, jaw=26,
                  ears_back=30, tail_lift=24, fl=(FP0[0], FP0[1] - 0.6, PAW_Z), fr=(-FP0[0], FP0[1] - 0.55, PAW_Z),
                  pole_f=(0.3, 1.0, 0.0))
    land = lifted(land, 'hl', HP0, (0.0, 0.3, 0.35), -20, 20)
    land = lifted(land, 'hr', A.mirror(HP0), (0.0, 0.3, 0.35), -20, 20)
    seq.append((LEAP_LAND, land, 'quadout'))
    settle = st.but(pelvis=(0, -0.3, -0.75), pitch=-3, pivot=(0, 0, 2.8), arch=8, neck_raise=-10, jaw=18, ears_back=24,
                    tail_lift=20, fl=land.p['fl'], fr=land.p['fr'],
                    hl=(HP0[0], HP0[1] - 0.25, PAW_Z), hr=(-HP0[0], HP0[1] - 0.25, PAW_Z), pole_f=(0.3, 1.0, 0.0))
    seq.append((LEAP_HIND, settle, 'out'))
    seq.append((2.0, st.but(pelvis=(0, -0.3, -0.15), fl=land.p['fl'], fr=land.p['fr'], hl=settle.p['hl'],
                            hr=settle.p['hr'], jaw=8, ears_back=8), 'auto'))
    seq.append((2.4, st.but(pelvis=(0, -0.3, 0.0), fl=land.p['fl'], fr=land.p['fr'], hl=settle.p['hl'],
                            hr=settle.p['hr']), 'auto'))
    return keys_of(seq)


ROAR_T = 0.85


def roar(rig):
    """Roar: it sinks onto its forelegs, ears flat, then throws the head forward
    and up with the jaws wide, the tail lashing. CONTRACT: the roar peaks at 0.85 s
    (the shout ring), held with a shake to 1.6 s."""
    st = stance(rig)
    load = st.but(pelvis=(0, 0.2, -0.3), pitch=-3, pivot=(0, 1.9, 2.9), arch=6, neck_raise=-14, head_pitch=-10,
                  jaw=8, ears_back=36, tail_lift=4, tail_flick=-30, scap_l=10, scap_r=10)
    peak = st.but(pelvis=(0, -0.25, 0.1), pitch=6, pivot=(0, 1.9, 2.9), arch=-6, neck_raise=12, head_pitch=14, jaw=42,
                  ears_back=44, tail_lift=24, tail_wave=10, scap_l=-4, scap_r=-4, spine_pitch=2)
    seq = [(0.0, st, 'auto'), (0.4, load, 'in'), (ROAR_T, peak, 'out')]
    for k, t in enumerate((1.05, 1.25, 1.45)):
        sg = 1 if k % 2 == 0 else -1
        seq.append((t, peak.but(head_yaw=6 * sg, head_roll=7 * sg, neck_yaw=-4 * sg, jaw=40 + 2 * sg,
                                tail_phase=1.6 * (k + 1)), 'auto'))
    seq += [(1.6, peak.but(jaw=36), 'auto'), (2.1, st.but(neck_raise=2, jaw=10, ears_back=10), 'auto'),
            (2.6, st, 'auto')]
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(pelvis=(0.14, 0.18, -0.15), roll=4, arch=5, neck_raise=8, neck_yaw=-12, head_pitch=6, head_yaw=-8,
                    jaw=20, ears_back=40, tail_yaw=12, tail_flick=30, spine_yaw=-4)
    back = st.but(pelvis=(-0.04, 0.05, -0.04), roll=-1.2, neck_yaw=3, jaw=8, ears_back=16)
    return keys_of([(0.0, st, 'auto'), (0.1, flinch, 'out'), (0.32, back, 'inout'), (0.7, st, 'auto')])


def stunned(rig, period=2.4):
    """Stunned (a dazed loop): the stance splayed and wobbling, the head hanging and
    lolling in a slow circle, the jaw slack, the ears drooped out, the tail limp."""
    base = stance(rig).but(pelvis=(0, 0.1, -0.35), arch=4, neck_raise=-22, head_pitch=-14, jaw=10, ears_back=12,
                           ears_out=30, tail_lift=4, tail_droop=6,
                           fl=(FP0[0] + 0.2, FP0[1] - 0.15, PAW_Z), fr=(-FP0[0] - 0.25, FP0[1] - 0.05, PAW_Z),
                           hl=(HP0[0] + 0.15, HP0[1], PAW_Z), hr=(-HP0[0] - 0.2, HP0[1] + 0.05, PAW_Z),
                           pole_f=(0.4, 1.0, 0.0))
    seq = []
    n = 12
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        seq.append((period * ph, base.but(
            pelvis=(0.12 * math.sin(w), 0.1, -0.35 - 0.08 * math.sin(2 * w + 0.5)), roll=4 * math.sin(w),
            spine_roll=-3 * math.sin(w), hip_roll=-2 * math.sin(w + 0.4), neck_yaw=14 * math.sin(w + 0.6),
            neck_raise=-22 + 5 * math.cos(w + 0.6), head_roll=-16 * math.sin(w + 1.2), head_yaw=8 * math.sin(w + 1.4),
            head_pitch=-14 + 6 * math.cos(w + 1.0), jaw=8 + 5 * math.sin(2 * w), ear_l=8 * math.sin(w),
            ear_r=-8 * math.sin(w), tail_yaw=5 * math.sin(w + 2), tail_wave=2, tail_phase=w), 'auto'))
    return keys_of(seq, loop=True)


def death(rig):
    """Death: a last snarl, the forelegs buckle, it slumps onto its chest and rolls
    onto its left side, the head dropping last. CONTRACT: the body hits the ground
    at 1.55 s (the dust), the head at 1.72 s, at rest from 2.2 s."""
    st = stance(rig)
    left = (0.9, 0.0, 0.0)
    rear = st.but(pelvis=(0, 0.15, 0.1), pitch=4, pivot=(0, 1.9, 2.9), neck_raise=16, head_pitch=18, jaw=36,
                  ears_back=40, tail_lift=20)
    buckle = st.but(pelvis=(0.1, 0.1, -0.9), pitch=-12, pivot=(0, 1.9, 2.9), neck_raise=-8, head_pitch=-4, jaw=24,
                    ears_back=24, tail_lift=2, fl=(FP0[0] + 0.25, FP0[1] - 0.35, PAW_Z),
                    fr=(-FP0[0] - 0.2, FP0[1] - 0.45, PAW_Z), fd_fl=-30, fd_fr=-30, pole_f=(0.4, 1.0, 0.0))

    def lying(roll, center, neck, head_p, jaw, tail):
        b = st.but(roll=roll, pivot=left, neck_raise=neck, neck_yaw=10, neck_roll=6, head_pitch=head_p, head_roll=10,
                   jaw=jaw, ears_back=20, ears_out=20, tail_lift=-4, tail_yaw=tail, tail_droop=8)
        q = body_matrix(0.0, 0.0, roll)
        piv, c = V(left), V((0.0, 0.0, 2.6))
        b = b.but(pelvis=tuple(V(center) - (q @ c + piv - q @ piv)))
        k = min(1.0, abs(roll) / 70.0)
        feet = {}
        for key, rest, out in (('fl', FP0, (0.15, -0.45, 0.4)), ('fr', A.mirror(FP0), (-0.1, -0.55, 0.22)),
                               ('hl', HP0, (0.15, 0.4, 0.4)), ('hr', A.mirror(HP0), (-0.1, 0.55, 0.22))):
            wpt = b.to_world(rest + np.array(out))
            g = np.array((rest[0] + out[0] * 1.3, rest[1] + out[1], PAW_Z))
            feet[key] = tuple(g * (1 - k) + wpt * k)
            feet['fd_' + key] = 40.0
            feet['td_' + key] = 70.0
        return b.but(**feet)
    slump = lying(30, (0.7, 0.0, 2.3), -12, -6, 20, -4)
    hitg = lying(80, (1.45, 0.0, 1.62), -14, -8, 16, -10)
    bounce = lying(74, (1.42, 0.0, 1.72), -12, -6, 18, -9)
    headdown = lying(80, (1.45, 0.0, 1.64), -24, -12, 14, -10)
    rest = lying(80, (1.45, 0.0, 1.65), -23, -12, 10, -12)
    return keys_of([(0.0, st, 'auto'), (0.3, rear, 'auto'), (0.8, buckle, 'in'), (1.2, slump, 'in'),
                    (1.55, hitg, 'out'), (1.65, bounce, 'inout'), (1.72, headdown, 'out'), (2.2, rest, 'inout'),
                    (3.0, rest, 'linear')])


NO_TAIL_SPRING = ('Pounce', 'Death')   # big root motion: the authored tail reads cleaner

CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Run', run, True, RUN_SPEED),
    ('Stalk', stalk, True, STALK_SPEED),
    ('Pounce', pounce, False, 0.0),
    ('Bite', bite, False, 0.0),
    ('Claw', claw, False, 0.0),
    ('Roar', roar, False, 0.0),
    ('Hit', hit, False, 0.0),
    ('Stunned', stunned, True, 0.0),
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
        R.follow_through(arm, act, loop=loop, wind=wind, skip=('Tail6',) if name in NO_TAIL_SPRING else ())
        made.append(name)
    return made
