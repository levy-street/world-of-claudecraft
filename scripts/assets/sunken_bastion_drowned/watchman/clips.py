"""Every clip the Drowned Watchman ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
He is a sentry still standing his watch: upright and stiff, the chin up, the
halberd stood at his right side, the left hand on the lantern at his hip. He
walks his round with the pole sloped back over his shoulder in a slow, measured
step; in a fight both hands close on the haft and he works the polearm.

The Halberd Sweep rides a 1.5 s cast bar played 1.05x: the pole is drawn back
over the bar and swept across his front as it ends (CONTACT 1.575 clip time),
the follow-through playing out after.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.5, 0.62, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.78, 0.92, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
SWEEP_T = 1.575


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.36, -0.02, SOLE)
FOOT_R = (-0.35, 0.12, SOLE)


def stance(rig):
    """At attention: the spine straight, the chin up, the halberd stood upright at
    the right foot, the left hand resting on the lantern at the hip."""
    return Body(rig, pelvis=(0.0, 0.02, -0.03), lean=2, neck=-2, look=(0, 2), hip_tilt=2,
                hand_r=(-0.84, -0.28, 2.38), pole_r=(-0.5, 0.9, -0.35), weapon=_n((0.1, -0.35, 0.93)),
                hand_l=(0.66, -0.2, 2.42), pole_l=(0.9, 0.6, -0.2), hand_dir_l=_n((-0.2, -0.3, -0.9)),
                hand_roll_l=-20, fist_l=0.7, spread_l=4,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=6, fyaw_r=8,
                knee_l=(0.15, -1.0, 0.0), knee_r=(-0.15, -1.0, 0.0))


def guard(rig):
    """Both hands on the haft, the blade levelled at the throat height of a man."""
    return stance(rig).but(pelvis=(0.0, 0.1, -0.14), lean=10, neck=6, look=(0, 2), twist=-16,
                           hand_r=(-0.5, -0.4, 2.45), pole_r=(-0.9, 0.4, -0.3), weapon=_n((0.28, -0.86, 0.42)),
                           grip_l=-0.66, grip_w=1.0, pole_l=(0.9, 0.3, -0.4),
                           foot_l=(0.42, -0.24, SOLE), foot_r=(-0.4, 0.3, SOLE), fyaw_r=20)


def idle(rig, period=5.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        scan = smooth((t / period - 0.35) / 0.12) * (1 - smooth((t / period - 0.62) / 0.12))
        return st.but(lean=st.p['lean'] + 0.8 * br, clav_l=1.2 * br, clav_r=1.2 * br,
                      look=(28 * scan * math.sin(u * 0.5 + 0.4) + 2 * math.sin(u), 2 + 1.5 * math.sin(u * 2 + 0.6)),
                      head_roll=1.5 * math.sin(u), neck=-2 + 1.5 * math.sin(u + 1.0),
                      jaw=2 + 2 * (1 - math.cos(u * 2)) / 2,
                      hand_l=(0.66, -0.2 + 0.01 * br, 2.42 + 0.012 * br))
    return fn


def combat_idle(rig, period=2.2):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.2 * br, pelvis=(0.0, 0.1, -0.14 - 0.012 * (1 - math.cos(u)) / 2),
                     look=(3 * math.sin(u), 2))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The round: a stiff, measured march with the pole sloped back over the right
    shoulder (walk), or carried at the port across the body (run)."""
    if run:
        base = guard(rig).but(twist=-6, weapon=_n((0.45, -0.55, 0.7)), hand_r=(-0.5, -0.45, 2.55))
    else:
        base = stance(rig).but(hand_r=(-0.8, -0.32, 2.5), weapon=_n((0.1, -0.35, 0.93)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.34, heel_roll=18, toe_up=4)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.33, heel_roll=18, toe_up=4)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.15 + 0.07 * math.cos(TAU * (ph * 2 - 0.15))
            lean = 18
        else:
            bob = -0.04 + 0.03 * math.cos(TAU * (ph * 2 - 0.1))
            lean = 4
        kw = dict(pelvis=(0.03 * s1, 0.02, bob), hip_twist=-6 * s1, hip_roll=3 * s1, lean=lean + 1.5 * c2,
                  twist=st.p['twist'] + 4 * s1, neck=-2 if not run else 4, look=(-2 * s1, 2 if not run else 0),
                  foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=4, fyaw_r=6)
        if not run:
            al = -0.32 * s1                     # the free arm swings stiffly, the lantern hand
            kw.update(hand_l=(0.76, -0.1 + al * 0.9, 2.4 + abs(al) * 0.2), hand_dir_l=_n((0.1, -0.12 + al * 0.6, -1.0)),
                      fist_l=0.6)
        return st.but(**kw)
    return fn


def _gripped(seq, t0, t1, t2, dur):
    """Ease the left hand onto the haft over [0, t0] and off it over [t1, t2]."""
    def fn(t):
        b = seq(t)
        if t < t0:
            b = b.but(grip_w=smooth(t / t0))
        elif t > t1:
            b = b.but(grip_w=1 - smooth((t - t1) / max(1e-3, t2 - t1)))
        return b
    return fn, dur


def attack(rig):
    """A two-handed thrust with the top spike, a step in behind it. CONTACT 0.5."""
    st = stance(rig)
    g = guard(rig)
    draw = g.but(twist=-26, lean=6, pelvis=(0.03, 0.22, -0.14), hand_r=(-0.62, 0.18, 2.62),
                 weapon=_n((0.25, -0.95, 0.15)), grip_l=-0.66, look=(4, 0))
    lunge = g.but(twist=8, lean=22, pelvis=(0.0, -0.34, -0.28), hand_r=(-0.22, -1.22, 2.6), pole_r=(-0.9, 0.2, -0.4),
                  weapon=_n((0.1, -0.99, 0.02)), grip_l=-0.66, look=(0, -4), foot_l=(0.42, -0.62, SOLE),
                  knee_l=(0.2, -1.0, 0.2))
    keys = [(0.0, st, 'inout'), (0.18, g, 'inout'), (0.36, draw, 'in'), (0.5, lunge, 'out'),
            (0.78, lunge.but(lean=20), 'inout'), (1.06, g, 'inout'), (1.4, st, 'linear')]
    seq = keyed(keys)
    fn, dur = _gripped(seq, 0.18, 1.06, 1.3, 1.4)

    def stepped(t):
        b = fn(t)
        for t0, t1 in ((0.36, 0.5), (0.78, 1.06)):
            if t0 < t < t1:
                u = (t - t0) / (t1 - t0)
                f = b.p['foot_l']
                b = b.but(foot_l=(f[0], f[1], f[2] + 0.2 * math.sin(math.pi * u)))
        return b
    return stepped, dur


def attack2(rig):
    """The pole raised over the right shoulder and hewn down with the axe blade.
    CONTACT 0.76."""
    st = stance(rig)
    g = guard(rig)
    load = g.but(twist=-30, lean=-2, pelvis=(0.03, 0.12, -0.06), look=(8, 10), hand_r=(-0.62, 0.02, 3.9),
                 pole_r=(-1.0, -0.2, 0.2), pole_l=(1.0, -0.3, 0.0), weapon=_n((0.15, 0.55, 0.82)), grip_l=-0.58)
    hit = g.but(twist=20, lean=28, pelvis=(-0.02, -0.18, -0.28), look=(-4, -14), hand_r=(-0.12, -1.0, 2.35),
                pole_r=(-0.8, 0.3, -0.5), pole_l=(0.8, 0.3, -0.5), weapon=_n((0.15, -0.75, -0.62)), grip_l=-0.58)
    keys = [(0.0, st, 'inout'), (0.22, g, 'inout'), (0.5, load, 'in'), (0.76, hit, 'out'),
            (1.0, hit.but(lean=25), 'inout'), (1.28, g, 'inout'), (1.6, st, 'linear')]
    return _gripped(keyed(keys), 0.22, 1.28, 1.53, 1.6)


def _sweep_poses(rig):
    g = guard(rig)
    drawn = g.but(twist=-42, lean=6, pelvis=(0.06, 0.2, -0.2), look=(18, 2), hand_r=(-0.95, 0.35, 2.75),
                  pole_r=(-0.5, 0.7, -0.6), weapon=_n((-0.55, 0.75, 0.38)), grip_l=-0.7,
                  foot_l=(0.48, -0.3, SOLE), foot_r=(-0.48, 0.42, SOLE), fyaw_r=30)
    drawn_b = drawn.but(twist=-46, look=(20, 4), lean=7, hand_r=(-0.98, 0.4, 2.8))
    swept = g.but(twist=40, lean=14, pelvis=(-0.06, -0.12, -0.24), look=(-16, -6), hand_r=(0.55, -0.85, 2.5),
                  pole_r=(-0.6, 0.0, -0.8), weapon=_n((0.92, -0.3, 0.12)), grip_l=-0.7,
                  foot_l=(0.48, -0.3, SOLE), foot_r=(-0.48, 0.42, SOLE), fyaw_r=30)
    return g, drawn, drawn_b, swept


def halberd_sweep(rig):
    """Halberd Sweep (1.5 s bar at 1.05x): the pole drawn far back over the right
    side and held, shuddering with effort, then swept flat across his whole front
    as the bar ends. CONTACT 1.575; recovered by 2.2."""
    st = stance(rig)
    g, drawn, drawn_b, swept = _sweep_poses(rig)
    keys = [(0.0, st, 'inout'), (0.22, g, 'inout'), (0.6, drawn, 'inout'), (1.0, drawn_b, 'inout'),
            (1.38, drawn, 'expoin'), (SWEEP_T, swept, 'out'), (1.85, swept.but(twist=44, lean=16), 'inout'),
            (2.2, g, 'inout'), (2.45, st, 'linear')]
    return _gripped(keyed(keys), 0.22, 2.2, 2.42, 2.45)


def cast_loop(rig, period=1.0):
    g, drawn, drawn_b, swept = _sweep_poses(rig)
    d0 = M.aim_weapon(drawn)

    def fn(t):
        u = TAU * t / period
        return d0.but(twist=-44 + 2 * math.sin(u), lean=6.5 + 0.5 * math.sin(u), look=(19 + math.sin(u), 3))
    return fn


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-6, twist=12, pelvis=(0.0, 0.14, -0.08), look=(-10, 12), head_roll=-8, jaw=14,
                  hand_l=(0.95, 0.15, 2.45))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.27, jolt.but(lean=0), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def _down(rig, weapon=(-0.6, 0.0, -0.8)):
    st = stance(rig)
    return st.but(pitch=-80, pelvis=(0.0, 0.8, 0.0), lean=-6, neck=-14, look=(14, 18), jaw=26,
                  foot_l=(0.4, -0.4, 0.3), foot_r=(-0.42, -0.25, 0.32), fpitch_l=50, fpitch_r=55,
                  knee_l=(0.2, 0.0, 1.0), knee_r=(-0.2, 0.0, 1.0),
                  hand_r=(-1.05, 2.0, 0.28), weapon=_n(weapon), pole_r=(-0.3, 0.2, 1.0),
                  hand_l=(1.1, 2.3, 0.3), hand_dir_l=_n((0.4, 0.9, -0.1)), pole_l=(0.4, 0.2, 1.0), fist_l=0.3)


def death(rig):
    """The watch ends: struck upright, he totters back a step, the halberd toppling
    out of his hand, and falls flat on his back. Hits the ground 1.4, still from 1.9."""
    st = stance(rig)
    stag = st.but(lean=-12, pelvis=(0.0, 0.26, -0.06), look=(0, 22), jaw=24, twist=6,
                  hand_l=(1.0, 0.0, 2.9), hand_dir_l=_n((0.4, 0.1, 0.9)), fist_l=0.1, spread_l=20,
                  foot_r=(-0.35, 0.5, SOLE), weapon=_n((0.4, -0.2, 0.9)))
    sag = st.but(pelvis=(0.0, 0.5, -0.5), lean=-20, look=(0, 30), jaw=30, knee_l=(0.2, -1.0, 0.0),
                 knee_r=(-0.2, -1.0, 0.0), foot_r=(-0.35, 0.5, SOLE), weapon=_n((0.8, 0.2, 0.55)),
                 hand_r=(-0.95, 0.3, 2.1), hand_l=(1.0, 0.2, 2.2), hand_dir_l=_n((0.6, 0.3, -0.7)), fist_l=0.2)
    down = _down(rig, (0.98, -0.21, 0.0))
    keys = [(0.0, st, 'out'), (0.3, stag, 'inout'), (0.85, sag, 'quadin'), (1.4, down, 'out'),
            (1.9, down.but(look=(18, 14)), 'hold'), (2.4, down.but(look=(18, 14)), 'hold')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.2), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.22), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.42, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('HalberdSweep', halberd_sweep, False),
    ('Cast', lambda r: (cast_loop(r), 1.0), True),
    ('Hit', hit, False),
    ('Death', death, False),
]


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        write_clip(arm, rig, name, f, dur, loop=loop, wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run'
                                                            else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
