"""The Spore Toad's clips, keyed from a whole-body toad pose language (adapted
from the Basin Raptor's).

`Body(**params)` turns readable numbers into a full pose: where the body sits
and how it pitches and rolls about a PIVOT, how the back bends, where the head
looks and how wide the jaw opens, how far the tongue lolls, how the throat sac
and the spore puffballs swell (keyed bone scales), where each hand and foot
stands (two-bone IK onto the wrist and the ankle, the hand and the long foot
aimed, the toes flat or curled).

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `pitch` + noses up; `roll` + rolls onto its LEFT side; `yaw` + turns
left; `spine_pitch` + lifts the chest; `head_pitch` + lifts the snout; `jaw` +
opens (degrees); `tongue` + lolls the tongue out and down; `throat` the throat
sac's scale (1 at rest); `sacs` the puffballs' scale (1 at rest), `sac1..3`
multiply it per sac; `body` the whole body's scale (the death's bloat).

CONTRACT lines name the frames the game reads (the bite, the slam, the tongue's
release on the bar's end, the burst).
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
HL0 = np.array(A.HAND_T)       # left hand's tip, planted
FL0 = np.array(A.FOOT_T)       # left foot's ball, planted
HAND_DIR = A.REST['L_Hand'][1] - A.REST['L_Hand'][0]
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
TOE_DIR = A.REST['L_Toes'][1] - A.REST['L_Toes'][0]
L_HAND = float(np.linalg.norm(HAND_DIR))
L_FOOT = float(np.linalg.norm(FOOT_DIR))
GROUND = 0.1
JAW_GAIN = 0.9


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


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0), pivot=(0.0, 0.4, 1.4),
        yaw=0.0, pitch=0.0, roll=0.0,
        hip_pitch=0.0, spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0, tongue=0.0,
        throat=1.0, sacs=1.0, sac1=1.0, sac2=1.0, sac3=1.0, body=1.0,
        hl=tuple(HL0), hr=tuple(A.mirror(HL0)), fl=tuple(FL0), fr=tuple(A.mirror(FL0)),
        hd_l=0.0, hd_r=0.0, fd_l=0.0, fd_r=0.0, td_l=0.0, td_r=0.0,
        pole_f=(0.7, 0.7, 0.0), pole_h=(1.0, -0.5, 0.25),
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

    def solve(self, memory=None):
        p = self.p
        turns, aims, ik = {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('x', -p['hip_pitch'])]
        turns['Spine'] = [('x', -p['spine_pitch']), ('z', p['spine_yaw']), ('y', p['spine_roll'])]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        turns['Tongue'] = [('x', p['tongue'])]
        for side, s, key in (('L_', 1, 'l'), ('R_', -1, 'r')):
            pf = (p['pole_f'][0] * s, p['pole_f'][1], p['pole_f'][2])
            ph = (p['pole_h'][0] * s, p['pole_h'][1], p['pole_h'][2])
            hd = unit(rot_x(HAND_DIR, p['hd_' + key]))
            fd = unit(rot_x(FOOT_DIR, p['fd_' + key]))
            wrist = np.asarray(p['h' + key]) - hd * L_HAND
            ankle = np.asarray(p['f' + key]) - fd * L_FOOT
            ik['f' + key] = (side + 'UpperArm', side + 'Forearm', tuple(wrist), pf)
            ik['h' + key] = (side + 'Thigh', side + 'Shin', tuple(ankle), ph)
            aims[side + 'Hand'] = V(tuple(hd))
            aims[side + 'Foot'] = V(tuple(fd))
            aims[side + 'Toes'] = V(tuple(unit(rot_x(TOE_DIR, p['td_' + key]))))
        root, _ = self.root()
        scale = {'Throat': p['throat'], 'Root': p['body']}
        for k in (1, 2, 3):
            scale[f'Sac{k}'] = p['sacs'] * p[f'sac{k}']
        return self.rig.pose(aims=aims, ik=ik, turns=turns, root=tuple(root), mirror=False, memory=memory,
                             scale=scale)


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


def keys_of(seq, loop=False):
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out, memory = [], {}
    if loop:
        for f in range(nfr + 1):
            sample(seq, f / R.FPS, loop).solve(memory)
    for f in range(nfr + 1):
        t = f / R.FPS
        out.append((t, sample(seq, t, loop).solve(memory), 'linear'))
    return out


# ------------------------------------------------------------------ stance and gaits
def stance(rig):
    """Sitting squat and heavy, the head up, the throat a little full."""
    return Body(rig, head_pitch=2.0, throat=1.05)


def lifted(b, key, rest, offset, d=0.0, td=0.0):
    """A hand ('h') or foot ('f') carried with the body: rest + offset."""
    kind, side = key[0], key[1]
    kw = {key: tuple(b.to_world(np.asarray(rest) + np.asarray(offset)))}
    if kind == 'h':
        kw['hd_' + side] = d
    else:
        kw['fd_' + side] = d
        kw['td_' + side] = td
    return b.but(**kw)


def step(phase, stance_frac, half, lift, rest, reach=0.0):
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        return (rest[0], rest[1] - half + 2 * half * u, rest[2]), 0.0
    u = (phase - stance_frac) / (1 - stance_frac)
    e = smooth(u)
    y = rest[1] + half - (2 * half + reach) * e + reach * smooth((u - 0.75) / 0.25)
    z = rest[2] + lift * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.7
    return (rest[0], y, z), math.sin(math.pi * u)


WALK_PERIOD, WALK_SPEED = 1.6, 2.0
RUN_PERIOD, RUN_SPEED = 0.8, 5.0


def walk(rig):
    """The crawl: diagonal pairs (left hand with right foot), the heavy body
    rolling over each planted pair, the throat and the sacs wobbling."""
    base = stance(rig)
    nfr = int(round(WALK_PERIOD * R.FPS))
    st = 0.7
    half = WALK_SPEED * st * WALK_PERIOD / 2
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        w = TAU * ph
        kw = {}
        for key, rest, off in (('hl', HL0, 0.0), ('fr', A.mirror(FL0), 0.04), ('hr', A.mirror(HL0), 0.5),
                               ('fl', FL0, 0.54)):
            f, sw = step((ph - off) % 1.0, st, half, 0.45 if key[0] == 'h' else 0.4, rest)
            kw[key] = f
            if key[0] == 'h':
                kw['hd_' + key[1]] = 30 * sw
            else:
                kw['fd_' + key[1]] = 25 * sw
                kw['td_' + key[1]] = 30 * sw
        seq.append((i / R.FPS, base.but(
            pelvis=(0.08 * math.sin(w), 0.0, -0.05 * math.cos(2 * w)), roll=3 * math.sin(w), spine_yaw=4 * math.sin(w),
            head_yaw=-3 * math.sin(w), throat=1.05 + 0.05 * math.sin(2 * w), sac1=1 + 0.04 * math.sin(2 * w + 1),
            sac2=1 + 0.04 * math.sin(2 * w + 2), sac3=1 + 0.04 * math.sin(2 * w + 3), **kw), 'linear'))
    return keys_of(seq)


def run(rig):
    """The hop: the hind legs drive (0.0 to 0.35, every foot planted and sliding
    back), it flies with the legs trailing then swinging under (0.35 to 0.75),
    the hands land first (0.75), then the feet."""
    base = stance(rig)
    nfr = int(round(RUN_PERIOD * R.FPS))
    stride = RUN_SPEED * RUN_PERIOD
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        # ground contact: the planted limbs slide back over the contact span
        kw = {}
        for key, rest, t_on, t_off in (('fl', FL0, 0.82, 0.35), ('fr', A.mirror(FL0), 0.82, 0.35),
                                       ('hl', HL0, 0.75, 0.3), ('hr', A.mirror(HL0), 0.75, 0.3)):
            on = (ph - t_on) % 1.0
            span = (t_off - t_on) % 1.0
            rest = np.asarray(rest, float)
            slide = RUN_SPEED * span * RUN_PERIOD
            if on <= span:
                u = on / span
                kw[key] = (rest[0], rest[1] - slide * 0.5 + slide * u, rest[2])
                d = 0.0
            else:
                u = (on - span) / (1 - span)
                e = smooth(u)
                y = rest[1] + slide * 0.5 - slide * e
                if key[0] == 'f':
                    y += 0.9 * math.sin(math.pi * min(1.0, u * 1.6)) * (1 - e)    # the legs trail out behind
                kw[key] = (rest[0], y, rest[2] + 0.6 * math.sin(math.pi * u))
                d = math.sin(math.pi * u)
            if key[0] == 'h':
                kw['hd_' + key[1]] = 40 * d
            else:
                kw['fd_' + key[1]] = -50 * d
                kw['td_' + key[1]] = -30 * d
        air = smooth((ph - 0.3) / 0.12) * (1 - smooth((ph - 0.72) / 0.1))
        lift = 0.75 * math.sin(math.pi * min(1.0, max(0.0, (ph - 0.3) / 0.48)))
        pitch = 14 * math.sin(TAU * (ph - 0.15)) if ph < 0.8 else -8 * math.sin(math.pi * (ph - 0.8) / 0.2)
        seq.append((i / R.FPS, base.but(
            pelvis=(0.0, 0.0, lift - 0.15 * (1 - air)), pitch=pitch, pivot=(0, 0.4, 1.4),
            head_pitch=2 - 6 * air, throat=1.05 + 0.15 * (1 - air), sacs=1.0 + 0.06 * math.sin(TAU * ph * 2), **kw),
            'linear'))
    del stride
    return keys_of(seq)


def idle(rig, period=5.0):
    """Breathing slow, the throat pumping fast like a frog's, the puffballs
    swelling and easing in turn (spores puffing out), the head turning, a lick."""
    base = stance(rig)
    seq = []
    n = 30
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(2 * w)
        lick = math.exp(-((ph - 0.62) / 0.05) ** 2)
        look = smooth((ph - 0.2) / 0.1) * (1 - smooth((ph - 0.45) / 0.1))
        seq.append((period * ph, base.but(
            pelvis=(0.0, 0.0, 0.04 * br), spine_pitch=1.2 * br, head_yaw=14 * look, head_roll=-6 * look,
            head_pitch=2 + 2 * br + 4 * lick, jaw=1.5 + 14 * lick, tongue=22 * lick,
            throat=1.05 + 0.16 * max(0.0, math.sin(10 * w)), sac1=1 + 0.08 * math.sin(w),
            sac2=1 + 0.08 * math.sin(w + 2.1), sac3=1 + 0.08 * math.sin(w + 4.2)), 'auto'))
    return keys_of(seq, loop=True)


BITE_T = 0.45


def bite(rig):
    """Bite: it rocks back, then lunges forward off its hind legs with the jaws
    wide and slams them shut. CONTRACT: the jaws shut on the target at 0.45 s."""
    st = stance(rig)
    load = st.but(pelvis=(0, 0.3, -0.12), pitch=8, head_pitch=10, jaw=10, throat=1.2)
    lunge = st.but(pelvis=(0, -0.7, 0.05), pitch=-6, head_pitch=4, jaw=36, throat=0.95,
                   hl=(HL0[0], HL0[1] - 0.5, HL0[2]), hr=(-HL0[0], HL0[1] - 0.5, HL0[2]))
    snap = lunge.but(pelvis=(0, -0.78, -0.05), jaw=0, head_pitch=-10)
    back = st.but(hl=lunge.p['hl'], hr=lunge.p['hr'], pelvis=(0, -0.2, 0))
    return keys_of([(0.0, st, 'auto'), (0.2, load, 'in'), (0.36, lunge, 'quadout'), (BITE_T, snap, 'auto'),
                    (0.62, snap.but(jaw=4, head_pitch=-4), 'auto'), (1.0, back, 'auto'), (1.25, st.but(
                        hl=lunge.p['hl'], hr=lunge.p['hr']), 'auto')])


SLAM_T = 0.58


def slam(rig):
    """Belly slam: it rears up on its hind legs, the hands off the ground, and
    crashes down onto its target. CONTRACT: the chest hits at 0.58 s."""
    st = stance(rig)
    rear = st.but(pelvis=(0, 0.3, 0.55), pitch=30, pivot=(0, 1.2, 0.6), head_pitch=8, jaw=26, throat=1.3,
                  sacs=1.1)
    rear = lifted(rear, 'hl', HL0, (0.1, -0.2, 0.3), 40)
    rear = lifted(rear, 'hr', A.mirror(HL0), (-0.1, -0.2, 0.3), 40)
    crash = st.but(pelvis=(0, -0.55, -0.4), pitch=-10, pivot=(0, 1.2, 0.6), head_pitch=-12, jaw=12, throat=0.9,
                   sacs=1.15, hl=(HL0[0] + 0.25, HL0[1] - 0.6, HL0[2]), hr=(-HL0[0] - 0.25, HL0[1] - 0.6, HL0[2]))
    return keys_of([(0.0, st, 'auto'), (0.32, rear, 'out'), (0.48, rear.but(pitch=24), 'in'), (SLAM_T, crash, 'out'),
                    (0.7, crash.but(pelvis=(0, -0.5, -0.32), sacs=1.0), 'auto'),
                    (1.2, st.but(hl=crash.p['hl'], hr=crash.p['hr']), 'auto')])


TONGUE_FIRE = 1.5


def tongue(rig):
    """Snaring Tongue (a 1.5 s bar, played at 1x from its start): the throat sac
    swells huge as it sucks in air and rocks back, the head draws up, then it
    snaps its head forward and down along the lane and the jaws fly open as the
    tongue fires; it braces and hauls (the reel) with the mouth wide, the throat
    pumping, then shuts. CONTRACT: the jaws are wide at the bar's end, 1.50 s,
    held open to 2.35 s, shut by 2.65 s."""
    st = stance(rig)
    swell = st.but(pelvis=(0, 0.25, 0.08), pitch=7, head_pitch=12, jaw=3, throat=1.7, sacs=1.05)
    full = swell.but(pelvis=(0, 0.32, 0.12), pitch=9, head_pitch=16, throat=1.95, jaw=5)
    aim = st.but(pelvis=(0, -0.35, -0.06), pitch=-4, head_pitch=-6, jaw=14, throat=1.6,
                 hl=(HL0[0], HL0[1] - 0.2, HL0[2]), hr=(-HL0[0], HL0[1] - 0.2, HL0[2]))
    fire = aim.but(pelvis=(0, -0.48, -0.1), jaw=34, tongue=26, throat=1.0, head_pitch=6)
    haul = fire.but(pelvis=(0, 0.2, 0.04), pitch=6, head_pitch=10, jaw=31, tongue=18, throat=1.15)
    haul2 = haul.but(pelvis=(0, 0.3, 0.06), throat=0.95, jaw=32)
    shut = st.but(pelvis=(0, 0.1, 0), jaw=0, tongue=0, throat=1.1, hl=aim.p['hl'], hr=aim.p['hr'])
    seq = [(0.0, st, 'auto')]
    # the throat pumps three times as it fills
    for k, t in enumerate((0.25, 0.5, 0.75, 1.0)):
        u = (k + 1) / 4
        seq.append((t, lerp_body(st, swell, u).but(throat=1.05 + 0.7 * u + (0.12 if k % 2 == 0 else -0.05)), 'auto'))
    seq += [(1.22, full, 'auto'), (1.38, aim, 'in'), (TONGUE_FIRE, fire, 'out'), (1.85, haul, 'auto'),
            (2.2, haul2, 'auto'), (2.35, haul2.but(jaw=29), 'in'), (2.65, shut, 'out'),
            (3.1, st.but(hl=aim.p['hl'], hr=aim.p['hr']), 'auto')]
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(pelvis=(0.1, 0.25, 0.05), roll=-5, pitch=6, head_pitch=10, head_yaw=-10, jaw=22, throat=1.3,
                    sacs=1.12)
    return keys_of([(0.0, st, 'auto'), (0.1, flinch, 'out'), (0.32, st.but(sacs=0.97, throat=0.98), 'inout'),
                    (0.6, st, 'auto')])


BURST_T = 0.85


def death(rig):
    """Death (the Spore Burst): it staggers and bloats, every puffball swelling
    and the body puffing up, then the puffballs burst (the spore cloud) and it
    collapses flat, deflated, onto its belly, legs splayed, the tongue out.
    CONTRACT: the puffballs burst at 0.85 s; flat at 1.45 s."""
    st = stance(rig)
    stagger = st.but(pelvis=(0.1, 0.1, 0.05), roll=6, head_pitch=12, jaw=30, throat=1.4, sacs=1.25, body=1.05)
    bloat = st.but(pelvis=(0.0, 0.0, 0.18), roll=-3, pitch=6, head_pitch=18, jaw=32, tongue=10, throat=1.8,
                   sacs=1.65, body=1.14)
    burst = bloat.but(sacs=0.25, throat=1.0, body=1.05, jaw=34, tongue=30, head_pitch=14)
    spread = dict(hl=(HL0[0] + 0.5, HL0[1] - 0.3, HL0[2]), hr=(-HL0[0] - 0.5, HL0[1] - 0.3, HL0[2]),
                  fl=(FL0[0] + 0.6, FL0[1] + 0.5, FL0[2]), fr=(-FL0[0] - 0.6, FL0[1] + 0.5, FL0[2]),
                  pole_f=(1.0, 0.3, 0.2), pole_h=(1.0, -0.2, 0.6))
    flat = st.but(pelvis=(0, -0.1, -0.78), pitch=-4, head_pitch=-14, head_roll=8, jaw=24, tongue=40, throat=0.7,
                  sacs=0.22, body=0.94, **spread)
    bounce = flat.but(pelvis=(0, -0.1, -0.68))
    rest = flat.but(pelvis=(0, -0.1, -0.8), jaw=20)
    return keys_of([(0.0, st, 'auto'), (0.3, stagger, 'auto'), (0.78, bloat, 'in'), (BURST_T, burst, 'out'),
                    (1.25, flat.but(pelvis=(0, -0.1, -0.5)), 'in'), (1.45, flat, 'out'), (1.58, bounce, 'inout'),
                    (1.75, rest, 'out'), (2.4, rest, 'linear')])


CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Run', run, True, RUN_SPEED),
    ('Bite', bite, False, 0.0),
    ('Slam', slam, False, 0.0),
    ('Tongue', tongue, False, 0.0),
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
