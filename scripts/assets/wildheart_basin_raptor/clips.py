"""The Basin Raptor's clips, keyed from a whole-body biped saurian pose language
(adapted from the Great Jaguar's).

`Body(**params)` turns a few dozen readable numbers into a full pose: where the
body sits and how it pitches and rolls (about a chosen PIVOT), how the spine
bends (spread down its two bones), how the neck rises and turns, where the head
looks and how wide the jaw opens, how the crest flares, how the arms reach and
the claws open, how the tail lifts, swings and waves (spread down its eight
bones), where each foot stands (two-bone IK onto the ankle, the long metatarsus
aimed onto the ball of the foot, the toes flat or curled, the sickle cocked or
slashing).

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body, so arcs stay arcs.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `pitch` + noses up; `roll` + rolls onto its LEFT side; `yaw` + turns
left; `spine_pitch` + lifts the chest; `neck_raise` + lifts the neck;
`head_pitch` + lifts the snout; `jaw` + opens (degrees); `crest` + flares the
quills up; `arm_*` + swings the arm forward and up; `elbow_*` + folds the
forearm up; `out_*` + spreads the arm out; `claw_*` + curls the hand; `sk_*` +
swings the sickle forward and down (the slash); `tail_lift` + lifts the tail;
`tail_yaw` + swings it to its LEFT.

CONTRACT lines name the frames the game reads (the bite lands, the sickle cuts,
the pounce lands).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
FL0 = np.array(A.FOOT_T)       # left foot ball, planted
PAW_Z = A.FOOT_T[2]
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
TOE_DIR = A.REST['L_Toes'][1] - A.REST['L_Toes'][0]
L_FOOT = float(np.linalg.norm(FOOT_DIR))
JAW_GAIN = 0.9
NECK_W = (0.55, 0.45)
SPINE_W = (0.45, 0.55)
TAIL_W = (0.2, 0.18, 0.15, 0.13, 0.11, 0.09, 0.08, 0.06)


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


def fdir(deg):
    """The metatarsus turned by `deg` from rest about +X (+ swings the foot down
    and back under the ankle)."""
    return tuple(rot_x(FOOT_DIR, deg) / L_FOOT)


def tdir(deg):
    """The toes turned by `deg` about +X from rest (+ curls them down)."""
    d = rot_x(TOE_DIR, deg)
    return tuple(d / np.linalg.norm(d))


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0), pivot=(0.0, 0.3, 2.7),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_pitch=0.0, hip_roll=0.0, hip_yaw=0.0,
        spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0,
        neck_raise=0.0, neck_yaw=0.0, neck_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0, crest=0.0,
        arm_l=0.0, arm_r=0.0, elbow_l=0.0, elbow_r=0.0, out_l=0.0, out_r=0.0, claw_l=0.0, claw_r=0.0,
        tail_lift=0.0, tail_yaw=0.0, tail_curl=0.0, tail_droop=0.0, tail_wave=0.0, tail_phase=0.0, tail_flick=0.0,
        fl=tuple(FL0), fr=tuple(A.mirror(FL0)),
        fd_l=0.0, fd_r=0.0, td_l=0.0, td_r=0.0, sk_l=0.0, sk_r=0.0,
        pole=(0.1, -1.0, 0.0),
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
        """Where a rest-space point rides with the whole-body turn (a lifted foot)."""
        root, q = self.root()
        return np.array(q @ V(rest_point) + root)

    def solve(self, memory=None):
        p = self.p
        turns, aims, ik = {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', -p['hip_pitch']), ('z', p['hip_yaw']), ('y', p['hip_roll'])]
        for b, w in (('Spine1', SPINE_W[0]), ('Spine2', SPINE_W[1])):
            turns[b] = [('x', -p['spine_pitch'] * w), ('z', p['spine_yaw'] * w), ('y', p['spine_roll'] * w)]
        for i, w in enumerate(NECK_W):
            turns[f'Neck{i + 1}'] = [('x', -p['neck_raise'] * w), ('z', p['neck_yaw'] * w), ('y', p['neck_roll'] * w)]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        turns['Crest'] = [('x', p['crest'])]
        n = len(TAIL_W)
        for i, w in enumerate(TAIL_W):
            k = i / (n - 1)
            wave = p['tail_wave'] * math.sin(p['tail_phase'] - i * 0.7) * (0.35 + 0.65 * k)
            yaw = p['tail_yaw'] * w + p['tail_curl'] * k * 0.2 + wave
            lift = p['tail_lift'] * w - p['tail_droop'] * k * 0.18 + p['tail_flick'] * max(0.0, k - 0.55) * 0.9
            turns[f'Tail{i + 1}'] = [('x', lift), ('z', -yaw)]
        for side, s, key in (('L_', 1, 'l'), ('R_', -1, 'r')):
            turns[side + 'UpperArm'] = [('x', -p['arm_' + key]), ('y', -s * p['out_' + key])]
            turns[side + 'Forearm'] = [('x', -p['elbow_' + key])]
            turns[side + 'Hand'] = [('x', p['claw_' + key])]
            turns[side + 'Sickle'] = [('x', p['sk_' + key])]
            pole = (p['pole'][0] * s, p['pole'][1], p['pole'][2])
            fd = np.array(fdir(p['fd_' + key]))
            ankle = np.asarray(p['f' + key]) - fd * L_FOOT
            ik[key] = (side + 'Thigh', side + 'Shin', tuple(ankle), pole)
            aims[side + 'Foot'] = V(tuple(fd))
            aims[side + 'Toes'] = V(tdir(p['td_' + key]))
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
    """Standing alert: the body level, the neck up in its S, the head scanning,
    the arms folded, the crest half up, the tail held out stiff."""
    return Body(rig, neck_raise=4.0, head_pitch=-4.0, crest=6.0, tail_lift=4.0, arm_l=18, arm_r=18, elbow_l=30,
                elbow_r=30, claw_l=10, claw_r=10, sk_l=-6, sk_r=-6)


def gait_foot(phase, stance_frac, half, lift, rest, reach=0.0, famp=50):
    """Foot target and metatarsus + toe turns for one foot at `phase` (0 =
    touchdown). The planted foot slides back at the gait speed, the toes flat; in
    the swing the metatarsus folds up under the ankle, the toes curl like a bird's,
    and the foot reaches forward before touching down."""
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        y = rest[1] - half + 2 * half * u
        z = PAW_Z
        heel = smooth((u - 0.65) / 0.35)               # the push-off: the ankle rises
        fd = -24 * heel
        td = -14 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = rest[1] + half - (2 * half + reach) * e + reach * smooth((u - 0.75) / 0.25)
        z = PAW_Z + lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.6
        fold = math.sin(math.pi * min(1.0, u * 1.25)) if u < 0.8 else 0.0
        fd = famp * fold - 6 * smooth((u - 0.75) / 0.25)
        td = 40 * fold * smooth(u / 0.3) - 10 * smooth((u - 0.8) / 0.2)
    return (rest[0], y, z), fd, td


def gait_body(rig, ph, period, speed, stance_frac, lift, base, wave=5.0, bob=0.08, roll=2.0, reach=0.0, famp=50,
              sway=0.08, head_lock=0.6):
    half = speed * stance_frac * period / 2
    kw = {}
    for key, rest, phase0 in (('l', FL0, 0.0), ('r', A.mirror(FL0), 0.5)):
        f, fd, td = gait_foot((ph - phase0) % 1.0, stance_frac, half, lift, rest, reach, famp)
        kw['f' + key] = f
        kw['fd_' + key] = fd
        kw['td_' + key] = td
    w = TAU * ph
    p0 = base.p
    # the body sways over the planted foot and bobs twice a stride (lowest just
    # after each touchdown); the head is held steady against it, bird-like
    bobz = -bob * math.cos(2 * (w - 0.35))
    return base.but(
        pelvis=(p0['pelvis'][0] + sway * math.cos(w), p0['pelvis'][1], p0['pelvis'][2] + bobz),
        roll=p0['roll'] + roll * math.cos(w), hip_roll=-2.0 * math.cos(w), hip_yaw=3.0 * math.sin(w),
        spine_yaw=-2.0 * math.sin(w), spine_roll=-1.5 * math.cos(w),
        neck_yaw=1.5 * math.sin(w) * (1 - head_lock), head_yaw=-1.0 * math.sin(w) * head_lock,
        neck_raise=p0['neck_raise'] - 3.0 * math.cos(2 * (w - 0.35)) * head_lock,
        head_pitch=p0['head_pitch'] + 2.5 * math.cos(2 * (w - 0.35)) * head_lock,
        tail_yaw=p0['tail_yaw'] - 4 * math.sin(w), tail_wave=wave, tail_phase=w,
        arm_l=p0['arm_l'] + 6 * math.sin(w), arm_r=p0['arm_r'] - 6 * math.sin(w), **kw)


WALK_PERIOD, WALK_SPEED, WALK_STANCE = 1.1, 2.6, 0.62
RUN_PERIOD, RUN_SPEED, RUN_STANCE = 0.52, 8.0, 0.34


def walk(rig):
    base = stance(rig).but(neck_raise=0, head_pitch=-2, crest=4)
    nfr = int(round(WALK_PERIOD * R.FPS))
    seq = [(i / R.FPS, gait_body(rig, (i / nfr) % 1.0, WALK_PERIOD, WALK_SPEED, WALK_STANCE, 0.42, base), 'linear')
           for i in range(nfr + 1)]
    return keys_of(seq)


def run(rig):
    """The sprint: pitched forward, the neck stretched low and level, the jaws a
    little open, the tail up as a straight counterweight, the arms tucked; long
    flight phases with the feet folded under."""
    base = stance(rig).but(pitch=-7, pivot=(0, 0.3, 2.7), pelvis=(0, 0, -0.06), neck_raise=-16, head_pitch=6,
                           jaw=10, crest=-6, tail_lift=10, arm_l=40, arm_r=40, elbow_l=60, elbow_r=60, claw_l=20,
                           claw_r=20)
    nfr = int(round(RUN_PERIOD * R.FPS))
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        b = gait_body(rig, ph, RUN_PERIOD, RUN_SPEED, RUN_STANCE, 0.78, base, wave=4.0, bob=0.0, roll=1.2,
                      reach=0.3, famp=70, sway=0.04, head_lock=0.9)
        # the flight: the body rises after each push-off and drops into the landing
        w = TAU * ph
        lift = 0.16 * math.sin(2 * (w - TAU * 0.12))
        pz = b.p['pelvis']
        b = b.but(pelvis=(pz[0], pz[1], -0.06 + lift), pitch=-7 + 2.0 * math.sin(2 * w),
                  jaw=10 + 4 * math.sin(2 * w))
        seq.append((i / R.FPS, b, 'linear'))
    return keys_of(seq)


def idle(rig, period=6.0):
    """Breathing, the weight shifting from foot to foot, the head darting to new
    sounds and freezing there (a bird's look), a slow tail sway with a flick, the
    crest twitching, the claws flexing, and a jaw clack."""
    base = stance(rig)
    seq = []
    n = 24
    # the head's darts: (start, yaw, pitch, roll)
    looks = [(0.0, 0, 0, 0), (0.12, 22, 4, -8), (0.3, 22, 4, -8), (0.34, -14, -2, 6), (0.55, -14, -2, 6),
             (0.6, 4, 8, 0), (0.85, 4, 8, 0), (0.9, 0, 0, 0)]

    def look_at(ph):
        for (t0, y0, p0, r0), (t1, y1, p1, r1) in zip(looks, looks[1:]):
            if t0 <= ph <= t1:
                u = smooth((ph - t0) / max(1e-6, t1 - t0) * 3.0)   # a quick dart, then a hold
                return y0 + (y1 - y0) * u, p0 + (p1 - p0) * u, r0 + (r1 - r0) * u
        return 0, 0, 0
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(4 * w)
        ly, lp, lr = look_at(ph)
        flick = math.exp(-((ph - 0.7) / 0.04) ** 2) - 0.6 * math.exp(-((ph - 0.77) / 0.04) ** 2)
        clack = math.exp(-((ph - 0.46) / 0.025) ** 2)
        crest = 6 + 10 * math.exp(-((ph - 0.33) / 0.04) ** 2)
        seq.append((period * ph, base.but(
            pelvis=(0.05 * math.sin(w), 0.0, -0.03 * br), spine_pitch=0.8 * br, roll=1.2 * math.sin(w),
            neck_raise=4 + 2.0 * math.sin(w + 0.4) + 1.0 * br, neck_yaw=0.45 * ly, head_yaw=0.55 * ly,
            head_pitch=-4 + lp, head_roll=lr, jaw=1.5 + 1.5 * max(0.0, br) + 14 * clack, crest=crest,
            claw_l=10 + 12 * math.sin(2 * w), claw_r=10 + 12 * math.sin(2 * w + 1.5),
            tail_yaw=8 * math.sin(w + 1.2), tail_wave=5, tail_phase=w, tail_lift=4 + 2 * br,
            tail_flick=36 * flick, sk_l=-6 + 6 * math.sin(2 * w), sk_r=-6 + 6 * math.sin(2 * w + 2)), 'auto'))
    return keys_of(seq, loop=True)


# ------------------------------------------------------------------ strikes
def lifted(b, key, rest, offset, fd, td):
    """A foot carried off the ground with the body: rest + offset rides the body turn."""
    return b.but(**{'f' + key: tuple(b.to_world(np.asarray(rest) + np.asarray(offset))), 'fd_' + key: fd,
                    'td_' + key: td})


BITE_T = 0.42


def bite(rig):
    """Bite (the plain swing). CONTRACT: the jaws snap shut on the target at
    0.42 s; a tearing shake 0.48 to 0.75."""
    st = stance(rig)
    gather = st.but(pelvis=(0, 0.25, -0.12), pitch=3, neck_raise=12, head_pitch=14, jaw=20, crest=18,
                    tail_lift=8, tail_flick=-18, arm_l=30, arm_r=30)
    lunge = st.but(pelvis=(0, -0.45, -0.24), pitch=-8, neck_raise=-18, head_pitch=-14, jaw=46, crest=10,
                   tail_lift=14, arm_l=50, arm_r=50, elbow_l=45, elbow_r=45, claw_l=-10, claw_r=-10,
                   fl=(FL0[0], FL0[1] - 0.35, PAW_Z))
    snap = lunge.but(pelvis=(0, -0.52, -0.28), jaw=0, neck_raise=-22, head_pitch=-18)
    shake = [(0.52, snap.but(neck_yaw=12, head_yaw=10, head_roll=16, jaw=3)),
             (0.62, snap.but(neck_yaw=-12, head_yaw=-10, head_roll=-16, jaw=3)),
             (0.74, snap.but(neck_yaw=5, head_yaw=4, head_roll=6, jaw=5, neck_raise=-14))]
    seq = [(0.0, st, 'auto'), (0.18, gather, 'in'), (0.34, lunge, 'quadout'), (BITE_T, snap, 'auto')]
    seq += [(t, b, 'auto') for t, b in shake]
    seq += [(1.0, st.but(pelvis=(0, -0.2, -0.06), fl=lunge.p['fl'], jaw=6), 'auto'),
            (1.25, st.but(fl=lunge.p['fl']), 'auto')]
    return keys_of(seq)


SLASH_T = 0.46


def slash(rig):
    """Sickle slash (the second swing): it rocks back onto its left foot, the right
    leg comes up with the sickle cocked high, then it kicks forward and rakes the
    sickle down through the target. CONTRACT: the sickle cuts through the target
    in front of it at 0.46 s, high to low."""
    st = stance(rig)
    rock = st.but(pelvis=(0.18, 0.3, -0.05), pitch=10, roll=-6, neck_raise=8, head_pitch=4, jaw=22, crest=20,
                  tail_lift=-6, tail_droop=6, arm_l=50, arm_r=50, out_l=12, out_r=12, claw_l=-15, claw_r=-15,
                  fl=(FL0[0] - 0.08, FL0[1] + 0.05, PAW_Z))
    rock = lifted(rock, 'r', A.mirror(FL0), (0.1, -0.55, 1.05), 35, 30)
    rock = rock.but(sk_r=-38)
    kick = st.but(pelvis=(0.15, 0.1, 0.05), pitch=14, roll=-8, neck_raise=4, head_pitch=-2, jaw=34, crest=24,
                  tail_lift=-10, arm_l=55, arm_r=55, out_l=18, out_r=18, fl=rock.p['fl'])
    kick = lifted(kick, 'r', A.mirror(FL0), (0.0, -1.35, 1.5), -10, -20)
    kick = kick.but(sk_r=-45)
    cut = st.but(pelvis=(0.1, -0.15, -0.08), pitch=4, roll=-5, neck_raise=-6, head_pitch=-8, jaw=30, crest=20,
                 tail_lift=6, arm_l=45, arm_r=45, fl=rock.p['fl'])
    cut = lifted(cut, 'r', A.mirror(FL0), (0.0, -1.4, 0.55), 40, 10)
    cut = cut.but(sk_r=55)
    land = st.but(pelvis=(0.0, -0.2, -0.1), jaw=10, crest=10, fl=rock.p['fl'],
                  fr=(A.mirror(FL0)[0], FL0[1] - 0.6, PAW_Z), sk_r=0)
    return keys_of([(0.0, st, 'auto'), (0.2, rock, 'auto'), (0.36, kick, 'in'), (SLASH_T, cut, 'linear'),
                    (0.6, cut.but(pelvis=(0.05, -0.2, -0.12), sk_r=40), 'quadout'), (0.82, land, 'auto'),
                    (1.2, st.but(fr=land.p['fr'], fl=rock.p['fl']), 'auto')])


POUNCE_LAND = 0.6


def pounce(rig):
    """Pounce (the trash kit's leap, wildheart_pounce: the sim carries it 0.6 s
    along a 3 yd arc from the windup's tick, so there is no crouch to wait on):
    it springs at once, folds its legs up, throws both sickles forward with the
    jaws gaping and the arms spread, the tail stiff behind, and lands claws first
    on its victim. CONTRACT: airborne from 0.0, the feet strike at 0.60 s, it
    has its feet back under it by 0.95 s."""
    st = stance(rig)
    spring = st.but(pelvis=(0, -0.2, 0.1), pitch=14, neck_raise=-8, head_pitch=-4, jaw=30, crest=30,
                    tail_lift=-8, arm_l=60, arm_r=60, out_l=20, out_r=20, claw_l=-25, claw_r=-25,
                    fd_l=-40, fd_r=-40, td_l=-30, td_r=-30,
                    fl=(FL0[0], FL0[1] + 0.25, PAW_Z), fr=(-FL0[0], FL0[1] + 0.25, PAW_Z))
    tuck = st.but(pelvis=(0, 0.0, 0.35), pitch=6, neck_raise=-10, head_pitch=-6, jaw=44, crest=34, tail_lift=6,
                  arm_l=75, arm_r=75, out_l=30, out_r=30, elbow_l=20, elbow_r=20, claw_l=-30, claw_r=-30,
                  sk_l=-40, sk_r=-40)
    tuck = lifted(tuck, 'l', FL0, (0.0, -0.35, 1.05), 60, 50)
    tuck = lifted(tuck, 'r', A.mirror(FL0), (0.0, -0.3, 1.1), 60, 50)
    strike = st.but(pelvis=(0, 0.1, 0.25), pitch=-4, neck_raise=-14, head_pitch=-10, jaw=50, crest=34,
                    tail_lift=14, arm_l=80, arm_r=80, out_l=24, out_r=24, claw_l=-30, claw_r=-30, sk_l=-45, sk_r=-45)
    strike = lifted(strike, 'l', FL0, (0.05, -1.0, 0.75), 10, -10)
    strike = lifted(strike, 'r', A.mirror(FL0), (-0.05, -0.95, 0.7), 10, -10)
    land = st.but(pelvis=(0, -0.35, -0.45), pitch=-10, neck_raise=-20, head_pitch=-14, jaw=20, crest=26,
                  tail_lift=18, arm_l=60, arm_r=60, claw_l=-10, claw_r=-10, sk_l=50, sk_r=50,
                  fl=(FL0[0], FL0[1] - 0.7, PAW_Z), fr=(-FL0[0], FL0[1] - 0.6, PAW_Z), pole=(0.25, -1.0, 0.0))
    settle = st.but(pelvis=(0, -0.3, -0.25), pitch=-4, neck_raise=-8, jaw=12, crest=16, tail_lift=10,
                    fl=land.p['fl'], fr=land.p['fr'], sk_l=10, sk_r=10)
    return keys_of([(0.0, st, 'auto'), (0.06, spring, 'quadout'), (0.24, tuck, 'auto'), (0.48, strike, 'quadin'),
                    (POUNCE_LAND, land, 'out'), (0.78, settle, 'auto'),
                    (0.95, st.but(fl=land.p['fl'], fr=land.p['fr'], pelvis=(0, -0.3, 0.0)), 'auto')])


SCREECH_T = 0.55


def screech(rig):
    """Screech (the Pack Frenzy: a packmate fell and it flies into its frenzy; also
    its flourish): it rears up, the crest flared, the arms spread, and screams at
    the sky with the jaws wide, then snaps its head down at its prey. CONTRACT:
    the scream peaks at 0.55 s, held with a shake to 1.1 s."""
    st = stance(rig)
    load = st.but(pelvis=(0, 0.2, -0.22), pitch=-4, neck_raise=-16, head_pitch=-8, jaw=10, crest=-10,
                  tail_lift=-4, tail_flick=-30, arm_l=30, arm_r=30)
    peak = st.but(pelvis=(0, 0.3, 0.12), pitch=18, spine_pitch=10, neck_raise=26, head_pitch=26, jaw=56, crest=42,
                  tail_lift=-10, tail_wave=8, arm_l=70, arm_r=70, out_l=30, out_r=30, claw_l=-35, claw_r=-35,
                  fl=(FL0[0], FL0[1] + 0.25, PAW_Z), fr=(-FL0[0], FL0[1] + 0.25, PAW_Z))
    seq = [(0.0, st, 'auto'), (0.3, load, 'in'), (SCREECH_T, peak, 'out')]
    for k, t in enumerate((0.72, 0.88, 1.02)):
        sg = 1 if k % 2 == 0 else -1
        seq.append((t, peak.but(head_yaw=7 * sg, head_roll=9 * sg, neck_yaw=-4 * sg, jaw=52 + 3 * sg,
                                tail_phase=1.6 * (k + 1)), 'auto'))
    down = st.but(pelvis=(0, -0.2, -0.15), pitch=-6, neck_raise=-14, head_pitch=-10, jaw=30, crest=30,
                  tail_lift=14, arm_l=45, arm_r=45, fl=peak.p['fl'], fr=peak.p['fr'])
    seq += [(1.22, down, 'quadout'), (1.6, st.but(fl=peak.p['fl'], fr=peak.p['fr'], crest=14), 'auto')]
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(pelvis=(0.12, 0.2, -0.1), roll=5, pitch=4, neck_raise=10, neck_yaw=-14, head_pitch=8,
                    head_yaw=-10, jaw=24, crest=30, tail_yaw=12, tail_flick=30, spine_yaw=-5, arm_l=40, arm_r=40)
    back = st.but(pelvis=(-0.04, 0.05, -0.03), roll=-1.2, neck_yaw=3, jaw=8, crest=12)
    return keys_of([(0.0, st, 'auto'), (0.1, flinch, 'out'), (0.3, back, 'inout'), (0.62, st, 'auto')])


def death(rig):
    """Death: a last snap, the legs buckle, it drops onto its belly and rolls onto
    its left side, the neck flopping, the head down last. CONTRACT: the body hits
    the ground at 1.10 s (the dust), the head at 1.30 s, at rest from 1.8 s."""
    st = stance(rig)
    left = (0.7, 0.0, 0.0)
    rear = st.but(pelvis=(0, 0.1, 0.1), pitch=10, neck_raise=18, head_pitch=22, jaw=46, crest=40, tail_lift=-6)
    buckle = st.but(pelvis=(0.1, 0.1, -0.85), pitch=-8, neck_raise=-6, head_pitch=-4, jaw=30, crest=10,
                    tail_lift=-4, fl=(FL0[0] + 0.15, FL0[1] - 0.2, PAW_Z), fr=(-FL0[0] - 0.12, FL0[1] - 0.3, PAW_Z),
                    pole=(0.35, -1.0, 0.0))

    def lying(roll, center, neck, head_p, jaw, tail):
        b = st.but(roll=roll, pivot=left, neck_raise=neck, neck_yaw=12, neck_roll=8, head_pitch=head_p, head_roll=12,
                   jaw=jaw, crest=-4, tail_lift=-6, tail_yaw=tail, tail_droop=8, arm_l=10, arm_r=40, elbow_l=50,
                   elbow_r=30, claw_l=40, claw_r=40)
        q = body_matrix(0.0, 0.0, roll)
        piv, c = V(left), V((0.0, 0.0, 2.6))
        b = b.but(pelvis=tuple(V(center) - (q @ c + piv - q @ piv)))
        k = min(1.0, abs(roll) / 70.0)
        feet = {}
        for key, rest, out in (('l', FL0, (0.15, -0.35, 0.5)), ('r', A.mirror(FL0), (-0.1, -0.6, 0.3))):
            wpt = b.to_world(rest + np.array(out))
            g = np.array((rest[0] + out[0] * 1.3, rest[1] + out[1], PAW_Z))
            feet['f' + key] = tuple(g * (1 - k) + wpt * k)
            feet['fd_' + key] = 40.0
            feet['td_' + key] = 60.0
        return b.but(**feet)
    slump = lying(28, (0.5, 0.0, 2.0), -12, -6, 26, -4)
    hitg = lying(78, (1.2, 0.0, 1.25), -16, -10, 20, -10)
    bounce = lying(72, (1.18, 0.0, 1.36), -14, -8, 22, -9)
    headdown = lying(78, (1.2, 0.0, 1.27), -26, -14, 16, -10)
    rest = lying(78, (1.2, 0.0, 1.28), -25, -14, 12, -12)
    return keys_of([(0.0, st, 'auto'), (0.22, rear, 'auto'), (0.62, buckle, 'in'), (0.9, slump, 'in'),
                    (1.1, hitg, 'out'), (1.2, bounce, 'inout'), (1.3, headdown, 'out'), (1.8, rest, 'inout'),
                    (2.4, rest, 'linear')])


NO_TAIL_SPRING = ('Pounce', 'Death')   # big root motion: the authored tail reads cleaner

CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Run', run, True, RUN_SPEED),
    ('Bite', bite, False, 0.0),
    ('Slash', slash, False, 0.0),
    ('Pounce', pounce, False, 0.0),
    ('Screech', screech, False, 0.0),
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
        R.follow_through(arm, act, loop=loop, wind=wind, skip=('Tail6',) if name in NO_TAIL_SPRING else ())
        made.append(name)
    return made
