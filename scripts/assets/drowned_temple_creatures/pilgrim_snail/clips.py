"""The Tide Pilgrim's clips, keyed every frame from a small body-language model.

`pose_of(p)` turns a dict of readable numbers into a full pose: how the foot
lifts, surges and pitches, how the neck and head bow, the proboscis curls and
reaches, the moon eyes lift, spread and retract on their stalks, the feelers
curl, a pedal wave runs down the foot and the mantle skirt ripples, how the
shell rocks and shakes on the body (it rides the foot: the body's turn is carried
over to it), the shrine wobbles, the moon pearl dims and the frenzy flare blazes.

Signs (degrees): pitch + leans forward/down (a raised eye stalk is negative);
yaw + turns to its left; roll + drops its left side. Every one-shot starts and
ends on the Idle's first frame. Clips are sampled at 24 fps.

CONTRACT (seconds, at a time scale of 1): Attack bite lands 0.42, Attack2 shell
slam lands 0.55, Frenzy flare peaks 0.35 and the slam lands 0.9, Death: the
body is in by 0.9, the shell is down at 1.55, the pearl is dark at 2.4.
"""
import math

from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

FPS = 24
REST3 = {}
REST_H = {}


def _init(arm):
    for b in arm.data.bones:
        REST3[b.name] = b.matrix_local.to_3x3()
        REST_H[b.name] = Vector(b.head_local)


def qa(axis, deg):
    return Quaternion(Vector(axis), math.radians(deg))


def turn(pitch=0.0, yaw=0.0, roll=0.0):
    return qa((0, 0, 1), yaw) @ qa((1, 0, 0), pitch) @ qa((0, 1, 0), roll)


def local(bone, q):
    m = REST3[bone]
    return (m.inverted() @ q.to_matrix() @ m).to_quaternion()


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------ tracks
class Track:
    """A monotone cubic through (t, value) keys (Fritsch-Carlson: no overshoot)."""

    def __init__(self, keys):
        self.k = sorted(keys)
        n = len(self.k)
        xs = [k[0] for k in self.k]
        ys = [k[1] for k in self.k]
        d = [(ys[i + 1] - ys[i]) / max(1e-9, xs[i + 1] - xs[i]) for i in range(n - 1)]
        m = [0.0] * n
        for i in range(1, n - 1):
            m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2
        for i in range(n - 1):
            if d[i] == 0:
                m[i] = m[i + 1] = 0.0
            else:
                a, b = m[i] / d[i], m[i + 1] / d[i]
                s = a * a + b * b
                if s > 9:
                    tau = 3 / math.sqrt(s)
                    m[i], m[i + 1] = tau * a * d[i], tau * b * d[i]
        self.xs, self.ys, self.m = xs, ys, m

    def __call__(self, t):
        xs, ys, m = self.xs, self.ys, self.m
        if t <= xs[0]:
            return ys[0]
        if t >= xs[-1]:
            return ys[-1]
        i = max(j for j in range(len(xs) - 1) if xs[j] <= t)
        h = xs[i + 1] - xs[i]
        u = (t - xs[i]) / h
        h00 = 2 * u ** 3 - 3 * u ** 2 + 1
        h10 = u ** 3 - 2 * u ** 2 + u
        h01 = -2 * u ** 3 + 3 * u ** 2
        h11 = u ** 3 - u ** 2
        return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]


def tracks(spec):
    """{param: [(t, v), ...]} -> function t -> {param: v} (missing params 0)."""
    tr = {k: Track(v) for k, v in spec.items()}

    def f(t):
        return {k: fn(t) for k, fn in tr.items()}
    return f


# ------------------------------------------------------------------ the pose model
BASE = dict(
    bp=0.0, by=0.0, br=0.0, lift=0.0, surge=0.0, side=0.0,
    np=4.0, ny=0.0, hp=10.0, hy=0.0, hr=0.0,
    sc=8.0, sy=0.0, ex=0.0,
    el=6.0, es=0.0, er=0.0, eL=0.0, eR=0.0, eyL=0.0, eyR=0.0,
    tl=0.0, tc=10.0, ts=0.0, tw1=0.0, tw2=0.0,
    tup=0.0, wave=0.0, wph=0.0, fl=0.0, fw=0.0, fph=0.0,
    shp=0.0, shr=0.0, shy=0.0, shl=0.0, shk=0.0,
    srp=0.0, srr=0.0, sip=0.0, siy=0.0,
    flare=0.0, pearl=1.0, shrink=1.0, headin=1.0,
    rroll=0.0, rpitch=0.0, rx=0.0, rz=0.0,
)
TAIL = ('Tail1', 'Tail2', 'Tail3')


def pose_of(p):
    q = dict(BASE)
    q.update(p)
    p = q
    pose = R.Pose()
    pose.scale = {}
    pose.loc = {}
    # root: the whole body (death's topple rides it)
    pose['Root'] = local('Root', turn(pitch=p['rpitch'], roll=p['rroll']))
    pose.root = Vector((p['side'] + p['rx'], p['surge'], p['lift'] + p['rz']))
    qb = turn(pitch=p['bp'], yaw=p['by'], roll=p['br'])
    pose['Body'] = local('Body', qb)
    pose.scale['Body'] = p['shrink']
    # neck and head
    # the foot stays on the floor: the rear and the front of the sole are levelled
    # against the body's pitch (a rear lifts the head, not the tail into the floor)
    pose['Neck1'] = local('Neck1', turn(pitch=p['np'] * 0.45 - max(0.0, p['bp']), yaw=p['ny'] * 0.45))
    pose['Neck2'] = local('Neck2', turn(pitch=p['np'] * 0.55, yaw=p['ny'] * 0.55))
    pose.scale['Neck1'] = p['headin']
    pose['Head'] = local('Head', turn(pitch=p['hp'], yaw=p['hy'], roll=p['hr']))
    for b, w in (('Snout1', 0.3), ('Snout2', 0.35), ('Snout3', 0.35)):
        pose[b] = local(b, turn(pitch=p['sc'] * w, yaw=p['sy'] * w))
    pose.loc['Snout2'] = (0.0, p['ex'] * 0.5, 0.0)
    pose.loc['Snout3'] = (0.0, p['ex'] * 0.5, 0.0)
    # eyes: lift (negative pitch raises them back), spread outward, retract (shrink)
    for s, side in ((1, 'L_'), (-1, 'R_')):
        own = p['eL'] if s > 0 else p['eR']
        oy = p['eyL'] if s > 0 else p['eyR']
        er = p['er']
        pose[side + 'Eye1'] = local(side + 'Eye1', turn(pitch=(p['el'] + own) * 0.55 - er * 35, yaw=(p['es'] + oy) * s * 0.6))
        pose[side + 'Eye2'] = local(side + 'Eye2', turn(pitch=(p['el'] + own) * 0.45 - er * 25, yaw=(p['es'] + oy) * s * 0.4))
        sc = 1.0 - 0.7 * er
        pose.scale[side + 'Eye1'] = max(0.25, sc)
        pose.scale[side + 'Eye2'] = 1.0
        # the mantle skirt: a travelling ripple plus a lift of both edges
        for i, fb in enumerate(('Frill1', 'Frill2', 'Frill3')):
            ph = p['fph'] - i * 1.9 + (0.0 if s > 0 else 0.9)
            r = p['fw'] * math.sin(ph) + p['fl']
            pose[side + fb] = local(side + fb, turn(roll=-r * s))
    # the foot: a pedal wave running back, the tail tip lifting
    for i, b in enumerate(TAIL):
        w = p['wave'] * math.sin(p['wph'] - i * 1.6)
        lev = -min(0.0, p['bp']) if i == 0 else 0.0
        pose[b] = local(b, turn(pitch=w + p['tup'] * (0.25 + 0.25 * i) + lev))
    # the shell rides the body (the body's turn carried over about the body's pivot)
    bh, sh = REST_H['Body'], REST_H['Shell']
    k = math.sin(p['shk'] * 1.0)
    qs = qb @ turn(pitch=p['shp'] + p['shk'] * 0.0, yaw=p['shy'], roll=p['shr'])
    pose['Shell'] = local('Shell', qs)
    moved = bh + qb @ (sh - bh) - sh
    moved += Vector(tuple(A.SHELL_AXIS)) * p['shl']
    pose.loc['Shell'] = tuple(REST3['Shell'].inverted() @ moved)
    _ = k
    pose['Shrine'] = local('Shrine', turn(pitch=p['srp'], roll=p['srr']))
    pose.scale['Pearl'] = max(0.0, p['pearl'])
    pose.scale['Flare'] = max(0.0, p['flare'])
    return pose


# ------------------------------------------------------------------ clips
TAU = math.tau


def wave(t, T, n, amp, ph=0.0):
    """A loop-safe sine: n cycles over the clip, zero at t = 0."""
    return amp * (math.sin(TAU * n * t / T + ph) - math.sin(ph))


def pw(t, T, n, amp, ph=0.0):
    """A loop-safe, never-negative swell: 0 at t = 0, up to amp."""
    return amp * 0.5 * (1 - math.cos(TAU * n * t / T))


def idle(t):
    T = 4.0
    return dict(
        lift=pw(t, T, 1, 0.03 * A.GS),
        bp=wave(t, T, 1, -1.2, 0.3),
        np=4.0 + wave(t, T, 1, 3.0, 0.9),
        hp=10.0 + wave(t, T, 1, 3.5, 1.4) + wave(t, T, 2, 0.8),
        hy=wave(t, T, 1, 3.0, 0.5),
        sc=8.0 + wave(t, T, 2, 4.0, 0.2),
        sy=wave(t, T, 1, 6.0, 2.1),
        el=6.0 + wave(t, T, 1, 4.0, 1.8),
        eL=wave(t, T, 2, 5.0, 0.4),
        eR=wave(t, T, 1, 6.0, 2.6),
        eyL=wave(t, T, 1, 9.0, 1.1),
        eyR=wave(t, T, 2, 6.0, 3.0),
        tc=10.0 + wave(t, T, 2, 9.0, 0.7),
        tw1=wave(t, T, 1, 8.0, 0.2),
        tw2=wave(t, T, 1, 8.0, 2.4),
        fw=4.0, fph=TAU * 2 * t / T,
        fl=wave(t, T, 1, 2.0, 1.0),
        shp=wave(t, T, 1, 2.4, 0.6),
        shl=wave(t, T, 1, 0.02 * A.GS, 0.4),
        srp=wave(t, T, 1, 1.2, 1.6),
        sip=wave(t, T, 1, 6.0, 0.9),
        siy=wave(t, T, 2, 4.0, 0.1),
        tup=pw(t, T, 1, 3.0),
    )


def cast(t):
    """Praying (the clip-map's generic cast): bows lower, the eyes lifted to the shrine."""
    T = 2.0
    b = idle(t * 2.0)
    b.update(
        bp=2.0 + wave(t, T, 1, 1.5),
        hp=4.0 + wave(t, T, 1, 3.0, 0.5),
        np=4.0 + wave(t, T, 1, 2.0, 1.0),
        el=-26.0 + wave(t, T, 1, 5.0, 0.3),
        es=10.0,
        pearl=1.0,
        shp=wave(t, T, 1, 3.0, 0.8),
    )
    return b


def glide(t, T, k):
    """Walk (k = 1) and Run (k ~ 1.8): the foot glides on a pedal wave, the head
    pushes forward, the shell sways a beat behind."""
    ph = TAU * t / T
    return dict(
        surge=wave(t, T, 1, -0.05 * k * A.GS, 0.0),
        lift=pw(t, T, 2, 0.02 * k * A.GS),
        bp=wave(t, T, 1, 1.0 * k, 1.0),
        np=4.0 - 4.0 * k + wave(t, T, 1, 3.0 * k, 0.6),
        ny=wave(t, T, 1, 4.0, 1.2),
        hp=10.0 - 6.0 * k + wave(t, T, 1, 3.0 * k, 1.1),
        hy=wave(t, T, 1, 3.0, 2.0),
        sc=8.0 - 4.0 * k + wave(t, T, 1, 5.0, 1.6),
        sy=wave(t, T, 1, 7.0, 2.4),
        el=6.0 + 6.0 * k + wave(t, T, 1, 4.0 * k, 1.5),
        es=6.0 * (k - 1.0),
        eL=wave(t, T, 2, 3.0, 0.4),
        eR=wave(t, T, 2, 3.0, 1.9),
        eyL=wave(t, T, 1, 5.0, 0.3),
        eyR=wave(t, T, 1, 5.0, 2.8),
        tc=14.0 + 6.0 * k + wave(t, T, 2, 6.0, 0.7),
        ts=6.0 * k,
        tw1=wave(t, T, 1, 10.0, 0.2),
        tw2=wave(t, T, 1, 10.0, 2.4),
        wave=1.1 * k, wph=ph * 2.0,
        fw=6.0 * k, fph=ph * 2.0,
        tup=3.0 * k + wave(t, T, 1, 1.5, 0.5),
        shp=wave(t, T, 2, 1.6 * k, 1.4),
        shy=wave(t, T, 1, 2.6 * k, 1.9),
        shr=wave(t, T, 1, 2.0 * k, 0.8),
        shl=wave(t, T, 2, 0.015 * k * A.GS, 1.0),
        srp=wave(t, T, 2, 1.5 * k, 2.0),
        srr=wave(t, T, 1, 1.5 * k, 2.6),
        sip=wave(t, T, 1, 8.0, 1.2),
        siy=wave(t, T, 1, 6.0, 0.4),
    )


def walk(t):
    return glide(t, 1.6, 1.0)


def run(t):
    return glide(t, 1.0, 1.8)


def _one(spec, base_t=0.0):
    """One-shot params: tracks on top of the Idle's first frame."""
    f = tracks(spec)
    b0 = idle(base_t)

    def g(t):
        out = dict(b0)
        for k, v in f(t).items():
            out[k] = out.get(k, BASE.get(k, 0.0)) + v
        return out
    return g


def Z(*ts):
    return [(t, 0.0) for t in ts]


ATTACK = _one({
    # the proboscis strike: rear back and coil, then dart the snout straight out
    'bp': [(0, 0), (0.3, -6), (0.42, 2), (0.62, 1), (1.1, 0)],
    'lift': [(0, 0), (0.3, 0.04 * A.GS), (0.42, 0.0), (1.1, 0)],
    'surge': [(0, 0), (0.3, 0.1 * A.GS), (0.42, -0.2 * A.GS), (0.65, -0.15 * A.GS), (1.1, 0)],
    'np': [(0, 0), (0.3, -14), (0.42, -2), (0.65, -2), (1.1, 0)],
    'hp': [(0, 0), (0.3, -20), (0.42, -6), (0.65, -4), (1.1, 0)],
    'sc': [(0, 0), (0.3, 34), (0.42, -22), (0.62, -16), (1.1, 0)],
    'ex': [(0, 0), (0.3, -0.03 * A.GS), (0.42, 0.18 * A.GS), (0.65, 0.12 * A.GS), (1.1, 0)],
    'el': [(0, 0), (0.3, -12), (0.48, 2), (0.8, 2), (1.1, 0)],
    'es': [(0, 0), (0.3, 8), (0.45, 14), (1.1, 0)],
    'shp': [(0, 0), (0.3, -3), (0.48, 4), (0.75, -1), (1.1, 0)],
    'srp': [(0, 0), (0.3, -2), (0.5, 3), (0.8, -1), (1.1, 0)],
    'fl': [(0, 0), (0.42, 6), (1.1, 0)],
})

ATTACK2 = _one({
    # the shell bash: rear the front up, the shell rocks back, then crashes it down
    'bp': [(0, 0), (0.4, -14), (0.55, 7), (0.78, 4), (1.3, 0)],
    'lift': [(0, 0), (0.4, 0.06 * A.GS), (0.55, 0.0), (1.3, 0)],
    'surge': [(0, 0), (0.4, 0.06 * A.GS), (0.55, -0.14 * A.GS), (0.8, -0.1 * A.GS), (1.3, 0)],
    'np': [(0, 0), (0.4, -12), (0.55, -4), (0.8, -3), (1.3, 0)],
    'hp': [(0, 0), (0.4, -10), (0.55, -4), (1.3, 0)],
    'sc': [(0, 0), (0.4, 16), (0.6, 6), (1.3, 0)],
    'shp': [(0, 0), (0.4, -9), (0.55, 11), (0.72, 7), (0.95, 9), (1.3, 0)],
    'shl': [(0, 0), (0.4, 0.04 * A.GS), (0.55, 0.0), (1.3, 0)],
    'el': [(0, 0), (0.4, -18), (0.55, 4), (1.3, 0)],
    'er': [(0, 0), (0.45, 0), (0.55, 0.35), (0.8, 0.2), (1.3, 0)],
    'tup': [(0, 0), (0.4, 8), (0.55, -2), (1.3, 0)],
    'fl': [(0, 0), (0.4, -4), (0.55, 10), (1.3, 0)],
    'srp': [(0, 0), (0.4, -4), (0.6, 7), (0.8, -2), (1.3, 0)],
})

HIT = _one({
    'er': [(0, 0), (0.1, 0.7), (0.25, 0.55), (0.55, 0)],
    'np': [(0, 0), (0.08, -9), (0.55, 0)],
    'hp': [(0, 0), (0.08, -12), (0.55, 0)],
    'bp': [(0, 0), (0.08, -3), (0.55, 0)],
    'surge': [(0, 0), (0.08, 0.06 * A.GS), (0.55, 0)],
    'sc': [(0, 0), (0.08, 28), (0.55, 0)],
    'tc': [(0, 0), (0.08, 30), (0.55, 0)],
    'shp': [(0, 0), (0.08, -5), (0.22, 2), (0.55, 0)],
    'srp': [(0, 0), (0.1, -3), (0.3, 2), (0.55, 0)],
    'fl': [(0, 0), (0.08, 6), (0.55, 0)],
})

FRENZY = _one({
    # rears up, eyes thrust high, the shrine blazes violet, shudders, slams down
    'bp': [(0, 0), (0.35, -16), (0.75, -14), (0.9, 6), (1.1, 3), (1.5, 0)],
    'lift': [(0, 0), (0.35, 0.06 * A.GS), (0.9, 0.0), (1.5, 0)],
    'np': [(0, 0), (0.35, -22), (0.75, -20), (0.9, -5), (1.5, 0)],
    'hp': [(0, 0), (0.35, -16), (0.75, -14), (0.9, -2), (1.5, 0)],
    'sc': [(0, 0), (0.35, -14), (0.9, 6), (1.5, 0)],
    'ex': [(0, 0), (0.35, 0.1 * A.GS), (0.9, 0), (1.5, 0)],
    'el': [(0, 0), (0.35, -34), (0.75, -30), (0.9, 6), (1.5, 0)],
    'es': [(0, 0), (0.35, 22), (0.75, 20), (1.0, 4), (1.5, 0)],
    'tl': [(0, 0), (0.35, 20), (0.9, -6), (1.5, 0)],
    'ts': [(0, 0), (0.35, 22), (1.5, 0)],
    'tup': [(0, 0), (0.35, 12), (0.9, -2), (1.5, 0)],
    'fl': [(0, 0), (0.35, -8), (0.9, 12), (1.5, 0)],
    'shp': [(0, 0), (0.35, -6), (0.75, -5), (0.9, 9), (1.1, 4), (1.5, 0)],
    'srp': [(0, 0), (0.35, 2), (0.9, 4), (1.5, 0)],
    'flare': [(0, 0), (0.12, 0.0), (0.32, 1.3), (0.45, 1.0), (1.15, 1.05), (1.42, 0.0), (1.5, 0.0)],
})

_FRENZY_KEYS = FRENZY


def FRENZY(t):  # noqa: F811
    p = _FRENZY_KEYS(t)
    env = smooth((t - 0.3) / 0.1) * (1 - smooth((t - 0.65) / 0.15))
    p['shp'] = p.get('shp', 0.0) + env * 3.5 * math.sin(TAU * 4.0 * (t - 0.3))
    p['shr'] = p.get('shr', 0.0) + env * 3.0 * math.sin(TAU * 4.0 * (t - 0.3) + 1.3)
    return p


DEATH = _one({
    # a jolt, the eyes and the head pull in, the foot shrinks under the shell,
    # the shell topples onto its left side, settles, and the moon pearl goes dark
    'er': [(0, 0), (0.12, 0.6), (0.5, 1.0), (2.6, 1.0)],
    'np': [(0, 0), (0.12, -12), (0.9, -30), (2.6, -30)],
    'hp': [(0, 0), (0.12, -14), (0.9, -36), (2.6, -36)],
    'sc': [(0, 0), (0.12, 26), (0.7, 70), (2.6, 70)],
    'tc': [(0, 0), (0.2, 40), (0.8, 60), (2.6, 60)],
    'headin': [(0, 0), (0.25, 0), (0.95, -0.45), (2.6, -0.45)],
    'shrink': [(0, 0), (0.3, 0), (1.0, -0.38), (2.6, -0.38)],
    'tup': [(0, 0), (0.3, 6), (0.9, 30), (2.6, 30)],
    'fl': [(0, 0), (0.3, 10), (0.9, 30), (2.6, 30)],
    'bp': [(0, 0), (0.12, -4), (0.9, -2), (2.6, -2)],
    'shp': [(0, 0), (0.12, -5), (0.4, 2), (0.9, 0), (2.6, 0)],
    'rroll': [(0, 0), (0.9, 0), (1.15, 18), (1.55, 74), (1.72, 66), (1.92, 72), (2.6, 72)],
    'rx': [(0, 0), (0.9, 0), (1.55, -0.45 * A.GS), (2.6, -0.45 * A.GS)],
    'srp': [(0, 0), (1.55, 0), (1.62, 6), (1.8, -3), (2.0, 0), (2.6, 0)],
    'pearl': [(0, 0), (1.9, 0), (2.4, -1.0), (2.6, -1.0)],
})


CATALOG = [
    ('Idle', idle, 4.0, True),
    ('Walk', walk, 1.6, True),
    ('Run', run, 1.0, True),
    ('Cast', cast, 2.0, True),
    ('Attack', ATTACK, 1.1, False),
    ('Attack2', ATTACK2, 1.3, False),
    ('Hit', HIT, 0.55, False),
    ('Frenzy', FRENZY, 1.5, False),
    ('Death', DEATH, 2.6, False),
]


def make_clip(arm, name, fn, dur, loop):
    n = int(round(dur * FPS))
    keys = []
    for i in range(n + 1):
        t = i / FPS
        tt = t if not loop or i < n else 0.0
        p = fn(tt) if not loop else fn(tt if i < n else 0.0)
        keys.append((t, pose_of(p), 'linear'))
    act = R.make_clip(arm, name, keys)
    act['duration'] = dur
    if loop:
        act['loop'] = 1
    return act


_MASK = {}


def _min_z(arm):
    """Lowest point of the shell and the body (the shrine's hanging pearls and
    pendants are left out: they may lie on the floor, the shell must)."""
    import bpy
    import numpy as np
    dg = bpy.context.evaluated_depsgraph_get()
    lo = 99.0
    for m in arm.children:
        if m.type != 'MESH':
            continue
        if m.name not in _MASK:
            skip = {m.vertex_groups[n].index for n in ('Shrine', 'Pearl', 'Flare') if n in m.vertex_groups}
            keep = np.ones(len(m.data.vertices), bool)
            for v in m.data.vertices:
                if v.groups and max(v.groups, key=lambda g: g.weight).group in skip:
                    keep[v.index] = False
            _MASK[m.name] = keep
        ev = m.evaluated_get(dg)
        co = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)[_MASK[m.name]]
        co = co @ np.array(m.matrix_world)[:3, :3].T + np.array(m.matrix_world)[:3, 3]
        lo = min(lo, float(co[:, 2].min()))
    return lo


def _grounded_death(arm, dur):
    """Author the Death, then measure how far the toppled shell sinks under (or
    floats over) the floor on every frame of the fall and lift the root to rest
    it ON the floor; the bounce is kept by the authored roll."""
    import bpy
    act = make_clip(arm, 'Death', DEATH, dur, False)
    R.set_action(arm, act)
    scene = bpy.context.scene
    n = int(round(dur * FPS))
    rest_z = None
    fix = []
    for i in range(n + 1):
        scene.frame_set(1 + i)
        z = _min_z(arm)
        if rest_z is None:
            rest_z = z
        t = i / FPS
        w = smooth((t - 0.85) / 0.35)
        fix.append((t, (rest_z - z) * w))
    bpy.data.actions.remove(act)
    corr = Track(fix)

    def fn(t):
        p = DEATH(t)
        p['rz'] = p.get('rz', 0.0) + corr(t)
        return p
    return make_clip(arm, 'Death', fn, dur, False)


def make_clips(arm, only=None):
    _init(arm)
    names = []
    for name, fn, dur, loop in CATALOG:
        if only and name not in only:
            continue
        if name == 'Death':
            _grounded_death(arm, dur)
        else:
            make_clip(arm, name, fn, dur, loop)
        names.append(name)
    return names
