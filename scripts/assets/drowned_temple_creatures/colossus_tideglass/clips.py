"""Every clip the Tideglass Colossus ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or the effect lands.
It stands like a temple giant of glass, the prism in its chest pulsing, light
running through it; it walks its foe down with a heavy stride.

The sim (encounters/drowned_temple/tideglass_colossus.ts): melee swings
(Attack: a hammer of both fists, CONTACT 0.6; Attack2: a backhand sweep,
CONTACT 0.55); Prism Flare is a 2.0 s bar (Flare: arms flung wide, chest
thrust out, the prism blazing on the bar's end, where the Reflections rise);
Moonlight Lance is a 2.0 s bar on one player (Lance: it turns and levels the
prism along its pointing arm, the lance leaving on the bar's end); Resonant
Slam is a 1.5 s bar (Slam: both fists raised and driven into the floor on
the bar's end, a ring of broken crystal round it). Heroic's swap of the
Reflections arrives as a windup cue (PrismPulse: the prism flares, a hand
raised to it).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.8, 0.75, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 1.2, 1.05, 0.5
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
FLARE_BAR, LANCE_BAR, SLAM_BAR = 2.0, 2.0, 1.5


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.78, -0.04, SOLE)
FOOT_R = (-0.78, 0.14, SOLE)
ARMS = dict(hand_l=(2.1, -0.15, 2.65), hand_r=(-2.1, -0.1, 2.67), pole_l=(1.0, 0.6, -0.3), pole_r=(-1.0, 0.6, -0.3),
            hand_dir_l=_n((0.15, -0.15, -1.0)), hand_dir_r=_n((-0.15, -0.15, -1.0)))


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.0, -0.06), lean=5, neck=6, look=(0, -6), foot_l=FOOT_L, foot_r=FOOT_R,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), scale=dict(A.HIDDEN), **ARMS)


def _prism(b, s):
    sc = dict(b.p['scale'])
    sc['Prism'] = s
    return b.but(scale=sc)


def idle(rig, period=4.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        b = st.but(pelvis=(0.03 * s1, 0.0, -0.06 - 0.025 * (1 - math.cos(2 * u)) / 2), side=-1.2 * s1,
                   lean=5 + 1.0 * s2, look=(6 * s1, -6 + 2 * s2), clav_l=1.2 * s2, clav_r=1.2 * s2)
        return _prism(b, 1.0 + 0.05 * math.sin(2 * u))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    base = stance(rig)
    if run:
        base = base.but(lean=16, neck=10, look=(0, -8))

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.78, heel_roll=20, toe_up=10)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.78, heel_roll=20, toe_up=10)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.22 if run else -0.12) + (0.08 if run else 0.06) * math.cos(TAU * (ph * 2 - 0.1))
        sw = (0.45 if run else 0.32) * s1
        out = base.but(pelvis=(0.08 * s1, 0.0, bob), hip_twist=-7 * s1, hip_roll=5 * s1, side=-3 * s1,
                       lean=base.p['lean'] + 2 * c2, twist=6 * s1, foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr,
                       toe_l=tl, toe_r=tr, hand_l=(2.05, -0.15 - sw, 2.7 + abs(sw) * 0.2),
                       hand_r=(-2.05, -0.1 + sw, 2.72 + abs(sw) * 0.2))
        return _prism(out, 1.0 + 0.04 * c2)
    return fn


def attack(rig):
    """The hammer: both fists raised over its head, then brought down before it
    with its whole weight behind them. CONTACT 0.6."""
    st = stance(rig)
    up = st.but(lean=-8, pelvis=(0.0, 0.14, 0.0), look=(0, 12), hand_l=(0.55, 0.3, 6.7), hand_r=(-0.55, 0.3, 6.7),
                pole_l=(1.0, 0.3, 0.4), pole_r=(-1.0, 0.3, 0.4), hand_dir_l=_n((-0.3, 0.2, 1.0)),
                hand_dir_r=_n((0.3, 0.2, 1.0)))
    down = st.but(lean=34, neck=12, look=(0, -12), pelvis=(0.0, -0.4, -0.5), hand_l=(0.45, -2.3, 1.2),
                  hand_r=(-0.45, -2.3, 1.2), pole_l=(1.0, 0.2, 0.5), pole_r=(-1.0, 0.2, 0.5),
                  hand_dir_l=_n((-0.1, -0.4, -0.9)), hand_dir_r=_n((0.1, -0.4, -0.9)), foot_l=(0.8, -0.6, SOLE),
                  knee_l=(0.3, -1.0, 0.2))
    keys = [(0.0, st, 'inout'), (0.42, up, 'in'), (0.6, down, 'out'), (0.95, down.but(lean=30), 'inout'),
            (1.6, st, 'linear')]
    return keyed(keys), 1.6


def attack2(rig):
    """The backhand sweep: the right arm drawn across its chest, then swept out
    wide across its front. CONTACT 0.55."""
    st = stance(rig)
    load = st.but(twist=26, lean=6, look=(12, 2), pelvis=(0.0, 0.1, -0.1), hand_r=(0.7, -1.2, 4.0),
                  pole_r=(-1.0, -0.2, 0.4), hand_dir_r=_n((1.0, -0.2, 0.2)))
    sweep = st.but(twist=-30, lean=14, look=(-12, -2), pelvis=(0.0, -0.24, -0.2), hand_r=(-2.7, -1.2, 3.4),
                   pole_r=(-1.0, 0.4, 0.2), hand_dir_r=_n((-1.0, -0.3, 0.0)), foot_r=(-0.82, -0.36, SOLE))
    keys = [(0.0, st, 'inout'), (0.36, load, 'in'), (0.55, sweep, 'out'), (0.9, sweep.but(twist=-26), 'inout'),
            (1.5, st, 'linear')]
    return keyed(keys), 1.5


def flare(rig):
    """Prism Flare (the 2.0 s bar): it draws its arms in round its chest, then
    flings them wide and thrusts the prism out, blazing, as the bar ends; the
    flash holds a moment; recovered 2.7."""
    st = stance(rig)
    T = FLARE_BAR
    gather = st.but(lean=10, neck=10, look=(0, -12), hand_l=(0.7, -1.0, 4.0), hand_r=(-0.7, -1.0, 4.0),
                    pole_l=(1.0, -0.2, -0.5), pole_r=(-1.0, -0.2, -0.5), hand_dir_l=_n((-0.6, -0.5, 0.4)),
                    hand_dir_r=_n((0.6, -0.5, 0.4)))
    blaze = st.but(lean=-16, neck=-10, look=(0, 22), pelvis=(0.0, 0.18, 0.04), hand_l=(3.0, 0.3, 4.9),
                   hand_r=(-3.0, 0.3, 4.9), pole_l=(1.0, 0.0, -0.6), pole_r=(-1.0, 0.0, -0.6),
                   hand_dir_l=_n((1.0, 0.0, 0.3)), hand_dir_r=_n((-1.0, 0.0, 0.3)), clav_l=12, clav_r=12)
    keys = [(0.0, st, 'inout'), (1.1, gather, 'inout'), (1.75, gather.but(lean=14), 'in'), (T, blaze, 'out'),
            (2.3, blaze.but(lean=-13), 'inout'), (2.7, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        g = smooth((t - 0.6) / 1.2)
        burst = smooth((t - T + 0.06) / 0.1) * (1 - smooth((t - 2.25) / 0.4))
        return _prism(b, 1.0 + 0.12 * g * (1 - burst) + 0.45 * burst)
    return fn, 2.7


def lance(rig):
    """Moonlight Lance (the 2.0 s bar): it turns square on its victim, lifts
    its left arm to point along the line and leans the prism into it, the light
    gathering; the lance leaves on the bar's end; recovered 2.6."""
    st = stance(rig)
    T = LANCE_BAR
    aim = st.but(lean=12, neck=4, look=(0, -2), twist=-8, pelvis=(0.0, -0.05, -0.12), hand_l=(0.7, -2.6, 4.2),
                 pole_l=(1.0, 0.2, -0.6), hand_dir_l=_n((0.0, -1.0, 0.1)), hand_r=(-1.6, 0.4, 3.0),
                 foot_l=(0.8, -0.4, SOLE), knee_l=(0.3, -1.0, 0.1))
    fire = aim.but(lean=18, pelvis=(0.0, -0.18, -0.16), hand_l=(0.66, -2.75, 4.15))
    keys = [(0.0, st, 'inout'), (0.6, aim, 'inout'), (1.85, aim.but(lean=10, pelvis=(0, 0.0, -0.12)), 'in'),
            (T, fire, 'out'), (2.25, fire, 'inout'), (2.6, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        g = smooth((t - 0.4) / 1.4)
        shot = smooth((t - T + 0.04) / 0.08) * (1 - smooth((t - 2.15) / 0.3))
        return _prism(b, 1.0 + 0.2 * g * (1 - shot) + 0.35 * shot)
    return fn, 2.6


def slam(rig):
    """Resonant Slam (the 1.5 s bar): both fists raised high and held, then
    driven into the floor before it as the bar ends (CONTACT 1.5), a ring of
    broken crystal standing up round it; recovered 2.3."""
    st = stance(rig)
    T = SLAM_BAR
    up = st.but(lean=-12, pelvis=(0.0, 0.16, 0.05), look=(0, 16), hand_l=(0.8, 0.2, 7.0), hand_r=(-0.8, 0.2, 7.0),
                pole_l=(1.0, 0.2, 0.4), pole_r=(-1.0, 0.2, 0.4), hand_dir_l=_n((-0.2, 0.2, 1.0)),
                hand_dir_r=_n((0.2, 0.2, 1.0)))
    smash = st.but(lean=44, neck=14, look=(0, -14), pelvis=(0.0, -0.5, -0.9), hand_l=(0.7, -2.2, 0.55),
                   hand_r=(-0.7, -2.2, 0.55), pole_l=(1.0, 0.2, 0.5), pole_r=(-1.0, 0.2, 0.5),
                   hand_dir_l=_n((-0.1, -0.3, -1.0)), hand_dir_r=_n((0.1, -0.3, -1.0)), foot_l=(0.86, -0.4, SOLE),
                   foot_r=(-0.86, 0.4, SOLE), knee_l=(0.3, -1.0, 0.2), knee_r=(-0.3, -1.0, 0.2))
    keys = [(0.0, st, 'inout'), (0.6, up, 'inout'), (1.32, up.but(lean=-15), 'in'), (T, smash, 'out'),
            (1.85, smash.but(lean=40), 'inout'), (2.3, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Shards'] = smooth((t - T) / 0.12) * (1.0 - smooth((t - 2.0) / 0.3)) if t >= T else 0.0
        return b.but(scale=sc)
    return fn, 2.3


def prism_pulse(rig):
    st = stance(rig)
    raise_ = st.but(lean=-4, look=(0, 6), hand_r=(-0.8, -1.3, 4.3), pole_r=(-1.0, 0.2, -0.5),
                    hand_dir_r=_n((0.6, -0.6, 0.4)))
    seq = keyed([(0.0, st, 'inout'), (0.4, raise_, 'inout'), (1.0, raise_, 'inout'), (1.5, st, 'linear')])

    def fn(t):
        return _prism(seq(t), 1.0 + 0.35 * math.sin(math.pi * min(1.0, t / 1.4)))
    return fn, 1.5


def cast(rig, period=2.4):
    st = stance(rig)
    up = st.but(lean=-6, look=(0, 14), hand_l=(1.6, -0.8, 4.4), hand_r=(-1.6, -0.8, 4.4), pole_l=(1.0, 0.3, -0.3),
                pole_r=(-1.0, 0.3, -0.3))

    def fn(t):
        u = TAU * t / period
        return _prism(up.but(lean=-6 + 2 * math.sin(u)), 1.1 + 0.08 * math.sin(2 * u))
    return fn


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-7, twist=8, pelvis=(0.0, 0.16, -0.12), look=(-6, 10))
    keys = [(0.0, st, 'out'), (0.14, jolt, 'out'), (0.32, jolt.but(lean=-2), 'inout'), (0.7, st, 'linear')]
    return keyed(keys), 0.7


def death(rig):
    """The prism cracks and flares (0.3), the giant staggers, drops to its
    knees and topples forward; its glass bursts into broken crystal and a pool
    of moonlit water spreads under it (from 1.8). Still from 3.2."""
    st = stance(rig)
    crack = st.but(lean=-14, neck=-12, look=(0, 24), pelvis=(0.0, 0.12, -0.04), hand_l=(2.4, 0.2, 3.2),
                   hand_r=(-2.4, 0.2, 3.2))
    kneel = st.but(pelvis=(0.0, 0.12, -1.25), lean=14, neck=12, look=(0, -14), foot_l=(0.8, 0.4, SOLE),
                   foot_r=(-0.8, 0.46, SOLE), fpitch_l=-30, fpitch_r=-30, knee_l=(0.2, -1.0, -0.3),
                   knee_r=(-0.2, -1.0, -0.3), hand_l=(1.8, -0.6, 1.3), hand_r=(-1.8, -0.6, 1.3))
    fallen = st.but(pelvis=(0.0, -0.4, -1.7), lean=80, neck=20, look=(10, -20), head_roll=14, side=8,
                    foot_l=(0.8, 1.2, SOLE + 0.1), foot_r=(-0.8, 1.3, SOLE + 0.1), fpitch_l=-90, fpitch_r=-90,
                    knee_l=(0.2, -1.0, -0.6), knee_r=(-0.2, -1.0, -0.6), hand_l=(2.4, -2.0, 0.4),
                    hand_r=(-2.4, -2.0, 0.4), pole_l=(1.0, 0.2, 1.0), pole_r=(-1.0, 0.2, 1.0))
    keys = [(0.0, st, 'out'), (0.35, crack, 'inout'), (1.1, kneel, 'quadin'), (2.0, fallen, 'out'),
            (3.2, fallen, 'hold'), (3.4, fallen, 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Prism'] = (1.0 + 0.6 * smooth((t - 0.2) / 0.15)) * (1 - smooth((t - 0.6) / 0.6))
        sc['Shards'] = smooth((t - 1.8) / 0.5)
        sc['Pool'] = smooth((t - 1.9) / 0.9)
        pv = b.p['pelvis']
        off = {'Shards': (-pv[0], -pv[1], -pv[2]), 'Pool': (-pv[0], -pv[1], -pv[2])}
        return b.but(scale=sc, offset=off)
    return fn, 3.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.3), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.42, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda r: (cast(r), 2.4), True),
    ('Flare', flare, False),
    ('Lance', lance, False),
    ('Slam', slam, False),
    ('PrismPulse', prism_pulse, False),
    ('Hit', hit, False),
    ('Death', death, False),
]


def _floor(f):
    def g(t):
        b = f(t)
        pv = b.p['pelvis']
        off = dict(b.p['offset'] or {})
        for bone in ('Shards', 'Pool'):
            off.setdefault(bone, (-pv[0], -pv[1], -pv[2]))
        return b.but(offset=off)
    return g


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        f = _floor(f)
        M.STATEFUL_IK = True
        write_clip(arm, rig, name, f, dur, loop=loop,
                   wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run' else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
