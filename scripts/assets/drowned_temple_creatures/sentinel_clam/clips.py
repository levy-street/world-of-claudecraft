"""Every clip the Pearlguard Sentinel ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage lands.
It stands like a temple giant on short coral legs, its clam valves breathing
open and shut a finger's width, the heart pearl pulsing in the front notch.

The sim: two melee swings (Attack: an overhead hammer fist, CONTACT 0.55;
Attack2: a backhand, CONTACT 0.5); Onrush is a charge (Run: head down
between half-closed valves); Pearl Slam is a 1.5 s cast bar (Slam: both fists
raised, driven into the floor as the bar ends, CONTACT 1.5); Pearl Carapace
is an 8 s absorb aura: while it holds, the rig swaps to its shell stance
(ShellClose enters it, ShellIdle / ShellWalk / ShellAttack / ShellHit hold it,
ShellOpen leaves it; temple_fx sends the stance gestures off the aura).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.5, 0.5, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.9, 0.8, 0.45
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
SLAM_BAR = 1.5


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def valves(front=0.0, back=0.0):
    """+ opens a valve wider (the front leans forward, the back leans back)."""
    return {'ValveF': [('x', front)], 'ValveB': [('x', -back)]}


FOOT_L = (0.6, -0.04, SOLE)
FOOT_R = (-0.6, 0.12, SOLE)
ARMS_REST = dict(hand_l=(1.5, -0.12, 2.32), hand_r=(-1.5, -0.08, 2.34), pole_l=(1.0, 0.6, -0.3),
                 pole_r=(-1.0, 0.6, -0.3), hand_dir_l=_n((0.15, -0.15, -1.0)), hand_dir_r=_n((-0.15, -0.15, -1.0)))


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.0, -0.05), lean=4, neck=6, look=(0, -4), foot_l=FOOT_L, foot_r=FOOT_R,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), scale=dict(A.HIDDEN), extra=valves(),
                **ARMS_REST)


def shell(rig):
    """The closed clam: crouched low, arms drawn in, head bowed inside, both
    valves shut over it."""
    return stance(rig).but(pelvis=(0.0, 0.1, -1.05), lean=4, neck=38, look=(0, -30),
                           foot_l=(0.62, -0.12, SOLE), foot_r=(-0.62, -0.02, SOLE), knee_l=(0.3, -1.0, 0.2),
                           knee_r=(-0.3, -1.0, 0.2), hand_l=(0.74, -0.18, 1.55), hand_r=(-0.74, -0.18, 1.55),
                           pole_l=(1.0, 0.3, -0.4), pole_r=(-1.0, 0.3, -0.4), hand_dir_l=_n((-0.3, -0.2, -0.9)),
                           hand_dir_r=_n((0.3, -0.2, -0.9)), extra=valves(-12, -44))


def _pulse(b, t, period, k=0.05):
    sc = dict(b.p['scale'])
    sc['Pearl'] = 1.0 + k * math.sin(TAU * t / period)
    return b.but(scale=sc)


def idle(rig, period=4.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        b = st.but(pelvis=(0.02 * s1, 0.0, -0.05 - 0.02 * (1 - math.cos(2 * u)) / 2), side=-1.5 * s1,
                   lean=4 + 1.2 * s2, look=(6 * s1, -4 + 2 * s2), clav_l=1.5 * s2, clav_r=1.5 * s2,
                   extra=valves(2.5 + 2.5 * s2, 2 + 2 * s2))
        return _pulse(b, t, period / 2)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    base = stance(rig)
    if run:
        # the Onrush: head down between the half-closed valves, fists forward
        base = base.but(lean=24, neck=18, look=(0, -14), hand_l=(1.0, -0.9, 2.6), hand_r=(-1.0, -0.9, 2.6),
                        pole_l=(1.0, 0.4, -0.5), pole_r=(-1.0, 0.4, -0.5), extra=valves(-12, -6))

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.6, heel_roll=20, toe_up=10)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.6, heel_roll=20, toe_up=10)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.18 if run else -0.08) + (0.06 if run else 0.05) * math.cos(TAU * (ph * 2 - 0.1))
        out = base.but(pelvis=(0.06 * s1, 0.0, bob), hip_twist=-6 * s1, hip_roll=5 * s1, side=-3 * s1,
                       lean=base.p['lean'] + 2 * c2, twist=5 * s1, foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr,
                       toe_l=tl, toe_r=tr)
        if not run:
            sw = 0.25 * s1
            out = out.but(hand_l=(1.5, -0.12 - sw, 2.34 + abs(sw) * 0.2), hand_r=(-1.5, -0.08 + sw, 2.36 + abs(sw) * 0.2),
                          extra=valves(3 + 2 * c2, 2 + 2 * c2))
        return _pulse(out, t, period)
    return fn


def attack(rig):
    """The hammer fist: the right fist raised high over the shoulder, the valves
    flaring, then brought down in front with the body behind it. CONTACT 0.55."""
    st = stance(rig)
    up = st.but(twist=-16, lean=-6, pelvis=(0.03, 0.12, -0.02), look=(-6, 10), hand_r=(-1.0, 0.25, 4.6),
                pole_r=(-1.0, 0.4, 0.3), hand_dir_r=_n((0.0, 0.3, 1.0)), extra=valves(10, 8))
    down = st.but(twist=18, lean=30, pelvis=(-0.03, -0.3, -0.34), look=(4, -8), hand_r=(-0.5, -1.6, 1.4),
                  pole_r=(-1.0, 0.0, 0.6), hand_dir_r=_n((0.1, -0.5, -0.85)), foot_l=(0.6, -0.5, SOLE),
                  knee_l=(0.2, -1.0, 0.2), extra=valves(-4, 2))
    keys = [(0.0, st, 'inout'), (0.38, up, 'in'), (0.55, down, 'out'), (0.85, down.but(lean=26), 'inout'),
            (1.4, st, 'linear')]
    return keyed(keys), 1.4


def attack2(rig):
    """The backhand: the left fist drawn across the chest, then swept out wide
    and back. CONTACT 0.5."""
    st = stance(rig)
    load = st.but(twist=24, lean=6, pelvis=(0.0, 0.08, -0.08), look=(10, 2), hand_l=(-0.4, -0.8, 3.2),
                  pole_l=(1.0, 0.2, -0.4), hand_dir_l=_n((-1.0, -0.2, 0.0)), extra=valves(6, 4))
    sweep = st.but(twist=-28, lean=16, pelvis=(0.0, -0.18, -0.2), look=(-10, -2), hand_l=(1.8, -0.9, 3.0),
                   pole_l=(1.0, 0.4, -0.2), hand_dir_l=_n((1.0, -0.3, 0.0)), foot_l=(0.62, -0.42, SOLE),
                   extra=valves(2, 4))
    keys = [(0.0, st, 'inout'), (0.34, load, 'in'), (0.5, sweep, 'out'), (0.8, sweep.but(twist=-24), 'inout'),
            (1.3, st, 'linear')]
    return keyed(keys), 1.3


def slam(rig):
    """Pearl Slam (the 1.5 s bar): both fists raised high, the valves flung wide
    and the pearl blazing, held; as the bar ends both fists are driven into the
    floor before it (CONTACT 1.5) and a ring of nacre shards bursts round it;
    recovered 2.3."""
    st = stance(rig)
    T = SLAM_BAR
    raise_ = st.but(lean=-10, neck=-4, look=(0, 16), pelvis=(0.0, 0.1, 0.05), hand_l=(0.7, 0.1, 4.9),
                    hand_r=(-0.7, 0.1, 4.9), pole_l=(1.0, 0.2, 0.4), pole_r=(-1.0, 0.2, 0.4),
                    hand_dir_l=_n((-0.2, 0.2, 1.0)), hand_dir_r=_n((0.2, 0.2, 1.0)), extra=valves(16, 12))
    hold = raise_.but(lean=-13, pelvis=(0.0, 0.14, 0.08), hand_l=(0.66, 0.22, 5.0), hand_r=(-0.66, 0.22, 5.0))
    smash = st.but(lean=40, neck=14, look=(0, -14), pelvis=(0.0, -0.32, -0.62), hand_l=(0.5, -1.65, 0.45),
                   hand_r=(-0.5, -1.65, 0.45), pole_l=(1.0, 0.2, 0.5), pole_r=(-1.0, 0.2, 0.5),
                   hand_dir_l=_n((-0.1, -0.3, -1.0)), hand_dir_r=_n((0.1, -0.3, -1.0)),
                   foot_l=(0.66, -0.3, SOLE), foot_r=(-0.66, 0.3, SOLE), knee_l=(0.3, -1.0, 0.2),
                   knee_r=(-0.3, -1.0, 0.2), extra=valves(-6, 0))
    keys = [(0.0, st, 'inout'), (0.55, raise_, 'inout'), (1.3, hold, 'in'), (T, smash, 'out'),
            (1.8, smash.but(lean=36), 'inout'), (2.3, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Pearl'] = 1.0 + 0.12 * smooth((t - 0.3) / 0.8) * (1 - smooth((t - T) / 0.3))
        sc['Shards'] = smooth((t - T) / 0.12) * (1.0 - smooth((t - 2.0) / 0.3)) if t >= T else 0.0
        return b.but(scale=sc)
    return fn, 2.3


def cast(rig, period=2.4):
    st = stance(rig)
    up = st.but(lean=-6, neck=-6, look=(0, 18), hand_l=(1.2, -0.5, 3.6), hand_r=(-1.2, -0.5, 3.6),
                pole_l=(1.0, 0.3, -0.3), pole_r=(-1.0, 0.3, -0.3), extra=valves(12, 10))

    def fn(t):
        u = TAU * t / period
        return _pulse(up.but(lean=-6 + 2 * math.sin(u), extra=valves(12 + 3 * math.sin(2 * u), 10)), t, period / 2,
                      0.08)
    return fn


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-8, twist=10, pelvis=(0.0, 0.14, -0.1), look=(-8, 10), extra=valves(-6, -4))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.3, jolt.but(lean=-2), 'inout'), (0.62, st, 'linear')]
    return keyed(keys), 0.62


def shell_close(rig):
    st, sh = stance(rig), shell(rig)
    keys = [(0.0, st, 'inout'), (0.35, st.but(lean=14, pelvis=(0, 0.02, -0.4), extra=valves(8, 6)), 'in'),
            (0.8, sh, 'out'), (1.0, sh, 'linear')]
    return keyed(keys), 1.0


def shell_open(rig):
    st, sh = stance(rig), shell(rig)
    keys = [(0.0, sh, 'inout'), (0.4, sh.but(pelvis=(0, 0.04, -0.6), extra=valves(6, 6)), 'out'),
            (1.0, st, 'linear')]
    return keyed(keys), 1.0


def shell_idle(rig, period=3.0):
    sh = shell(rig)

    def fn(t):
        u = TAU * t / period
        b = sh.but(pelvis=(0.0, 0.1, -1.05 + 0.02 * math.sin(u)), extra=valves(-12 + 1.5 * (1 + math.sin(u)),
                                                                                -44 + 1.5 * (1 + math.sin(u))))
        return _pulse(b, t, period)
    return fn


def shell_walk(rig, period=1.6):
    sh = shell(rig)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, 0.6, -0.25, 0.25, 0.12, 1, 0.62, heel_roll=10, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, 0.6, -0.25, 0.25, 0.12, -1, 0.62, heel_roll=10, toe_up=6)
        s1 = math.sin(TAU * ph)
        return sh.but(pelvis=(0.05 * s1, 0.1, -1.05 + 0.03 * math.cos(TAU * ph * 2)), side=-3 * s1,
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr)
    return fn


def shell_attack(rig):
    """Shut, it rams: the shell lurches forward, the valves part a crack and a
    fist punches out through the gap (CONTACT 0.4), then it shuts again."""
    sh = shell(rig)
    punch = sh.but(pelvis=(0.0, -0.1, -0.88), lean=8, hand_r=(-0.3, -1.5, 2.0), pole_r=(-1.0, 0.2, -0.4),
                   hand_dir_r=_n((0.1, -1.0, 0.1)), extra=valves(-2, -36))
    keys = [(0.0, sh, 'inout'), (0.28, sh.but(pelvis=(0.0, 0.18, -1.07), extra=valves(-13, -46)), 'in'),
            (0.4, punch, 'out'), (0.65, punch, 'inout'), (1.0, sh, 'linear')]
    return keyed(keys), 1.0


def shell_hit(rig):
    sh = shell(rig)
    jolt = sh.but(pelvis=(0.0, 0.2, -1.07), lean=-4)
    return keyed([(0.0, sh, 'out'), (0.12, jolt, 'out'), (0.5, sh, 'linear')]), 0.5


def death(rig):
    """The valves fly open (0.25), the heart pearl tumbles out of the notch,
    rolls away across the floor and goes dark (0.4 to 1.6); the giant sags to
    its knees and topples back between its open valves, its coral giving way,
    nacre shards scattering (from 1.2). Still from 2.8."""
    st = stance(rig)
    burst = st.but(lean=-14, neck=-12, look=(0, 24), pelvis=(0.0, 0.1, 0.0), hand_l=(1.8, 0.1, 3.0),
                   hand_r=(-1.8, 0.1, 3.0), pole_l=(1.0, 0.3, 0.3), pole_r=(-1.0, 0.3, 0.3), extra=valves(36, 30))
    kneel = st.but(pelvis=(0.0, 0.1, -1.0), lean=10, neck=12, look=(0, -12), foot_l=(0.6, 0.3, SOLE),
                   foot_r=(-0.6, 0.36, SOLE), fpitch_l=-30, fpitch_r=-30, knee_l=(0.2, -1.0, -0.3),
                   knee_r=(-0.2, -1.0, -0.3), hand_l=(1.4, -0.4, 1.0), hand_r=(-1.4, -0.4, 1.0), extra=valves(44, 38))
    fallen = st.but(pelvis=(0.0, 0.5, -1.25), lean=-62, neck=-10, look=(10, 20), head_roll=14, side=6,
                    foot_l=(0.66, -0.4, SOLE), foot_r=(-0.6, -0.3, SOLE), fpitch_l=-10, fpitch_r=-10,
                    knee_l=(0.3, -1.0, 0.4), knee_r=(-0.3, -1.0, 0.4), hand_l=(1.9, 0.6, 0.35),
                    hand_r=(-1.9, 0.7, 0.35), pole_l=(1.0, 0.0, 1.0), pole_r=(-1.0, 0.0, 1.0), extra=valves(70, -40))
    keys = [(0.0, st, 'out'), (0.25, burst, 'inout'), (1.0, kneel, 'quadin'), (2.0, fallen, 'out'),
            (2.8, fallen, 'hold'), (3.0, fallen, 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        out = t >= 0.4
        sc['Pearl'] = 0.0 if out else 1.0 + 0.2 * smooth(t / 0.25)
        sc['PearlFree'] = 1.0 if out else 0.0
        sc['Shards'] = smooth((t - 1.2) / 0.5)
        # the pearl: from the notch to the floor before it, rolling a little away
        pv = b.p['pelvis']
        u = smooth((t - 0.4) / 0.5)
        r = smooth((t - 0.9) / 0.9)
        dz = -(A.PEARL_AT[2] - A.PEARL_R) * u
        dy = -0.4 * u - 1.1 * r
        off = {'PearlFree': (-pv[0] + 0.25 * r, -pv[1] + dy, -pv[2] + dz),
               'Shards': (-pv[0], -pv[1], -pv[2])}
        ex = dict(b.p['extra'])
        ex['PearlFree'] = [('x', -300 * r)]
        return b.but(scale=sc, offset=off, extra=ex)
    return fn, 3.0


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.2), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.3, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda r: (cast(r), 2.4), True),
    ('Slam', slam, False),
    ('Hit', hit, False),
    ('ShellClose', shell_close, False),
    ('ShellIdle', lambda r: (shell_idle(r), 3.0), True),
    ('ShellWalk', lambda r: (shell_walk(r), 1.6), True),
    ('ShellAttack', shell_attack, False),
    ('ShellHit', shell_hit, False),
    ('ShellOpen', shell_open, False),
    ('Death', death, False),
]


def _floor_props(f):
    def g(t):
        b = f(t)
        pv = b.p['pelvis']
        off = dict(b.p['offset'] or {})
        for bone in ('Shards',):
            if bone not in off:
                off[bone] = (-pv[0], -pv[1], -pv[2])
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
        f = _floor_props(f)
        M.STATEFUL_IK = True
        write_clip(arm, rig, name, f, dur, loop=loop,
                   wind=(WALKREF if name in ('Walk', 'ShellWalk') else RUNREF if name == 'Run' else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
