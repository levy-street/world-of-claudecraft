"""Every clip the Bastion Revenant ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
Every blow: READY (the stance), ANTICIPATION (the weight loads the other way), APEX,
the STRIKE accelerating into contact ('in'), IMPACT jolt, HOLD, RECOVERY ('out')
back to the stance, so every one-shot opens and closes on Idle's first frame.

He is drowned weight moved by the tide's will: heavy, slightly hunched, head carried
low and forward, the cutlass held low in the right fist, the buckler arm hanging.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.44, 0.66, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.8, 0.92, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.34, -0.06, SOLE)
FOOT_R = (-0.33, 0.14, SOLE)


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.02, -0.07), lean=9, neck=9, look=(0, -7), hip_tilt=-3,
                hand_r=(-0.86, -0.28, 2.22), pole_r=(-0.5, 0.9, -0.35), weapon=_n((0.15, -0.88, -0.42)),
                weapon_bend=0.0,
                hand_l=(0.86, -0.06, 2.24), pole_l=(0.55, 0.9, -0.3), hand_dir_l=_n((0.1, -0.12, -1.0)),
                hand_roll_l=-12, fist_l=0.5, spread_l=6,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=8, fyaw_r=12,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), clav_fwd_l=4, clav_fwd_r=4)


def guard(rig):
    """The combat stance: wider, lower, the blade raised across the body."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.06, -0.16), lean=13, neck=6, look=(0, -2), twist=-8,
                  hand_r=(-0.42, -0.62, 2.72), pole_r=(-0.9, 0.4, -0.4), weapon=_n((0.32, -0.5, 0.8)),
                  hand_l=(0.62, -0.5, 2.62), pole_l=(0.8, 0.5, -0.4), hand_dir_l=_n((0.1, -0.7, -0.6)),
                  hand_roll_l=-30, fist_l=0.65,
                  foot_l=(0.44, -0.3, SOLE), foot_r=(-0.4, 0.36, SOLE), fyaw_l=4, fyaw_r=22)


# ------------------------------------------------------------------ loops
def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)              # two slow breaths a loop
        sway = math.sin(u)
        return st.but(lean=st.p['lean'] + 1.2 * br, clav_l=1.5 * br, clav_r=1.5 * br,
                      look=(5.0 * math.sin(u), -7 + 2.0 * math.sin(u * 2 + 0.6)),
                      head_roll=2.0 * math.sin(u),
                      pelvis=(0.012 * sway, 0.02, -0.07 - 0.008 * (1 - math.cos(u * 2)) / 2),
                      hand_l=(0.86, -0.06 + 0.015 * br, 2.24 + 0.012 * br),
                      hand_r=(-0.86, -0.28 + 0.01 * br, 2.22 + 0.01 * br),
                      jaw=2.0 + 2.0 * (1 - math.cos(u * 2)) / 2)
    return fn


def combat_idle(rig, period=2.0):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * br, pelvis=(0.0, 0.06, -0.16 - 0.015 * (1 - math.cos(u)) / 2),
                     hand_r=(-0.42, -0.62, 2.72 + 0.02 * br), look=(3 * math.sin(u), -2), clav_l=1.2 * br,
                     clav_r=1.2 * br)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    st = M.aim_weapon(stance(rig).but(weapon=_n((0.15, -0.88, -0.42))))

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.32)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.31)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.17 + 0.07 * math.cos(TAU * (ph * 2 - 0.15))
            lean, swing = 20, 0.55
        else:
            bob = -0.09 + 0.045 * math.cos(TAU * (ph * 2 - 0.1))
            lean, swing = 12, 0.3
        # the left (free) arm swings against the left leg; the sword arm swings less
        al = -swing * s1
        ar = swing * 0.55 * s1
        return st.but(
            pelvis=(0.03 * s1, 0.02, bob), hip_twist=-7 * s1 * (1.4 if run else 1.0), hip_roll=3.5 * s1,
            lean=lean + 2.5 * c2, twist=6 * s1, neck=8 if not run else 4, look=(-3 * s1, -4 if not run else 0),
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=4, fyaw_r=6,
            hand_l=(0.82, -0.08 + al * 0.9, 2.3 + abs(al) * 0.25 + (0.12 if run else 0)),
            hand_dir_l=_n((0.1, -0.12 + al * 0.6, -1.0)),
            hand_r=(-0.84, -0.32 + ar * 0.8, 2.3 + abs(ar) * 0.2 + (0.14 if run else 0)),
            wrist_r=(st.p['wrist_r'][0] + (8 if run else 0) + 6 * s1, st.p['wrist_r'][1]),
            fist_l=0.55 if run else 0.5)
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """A diagonal overhead hew, right shoulder to left hip. CONTACT 0.70."""
    st = stance(rig)
    load = st.but(twist=-24, lean=2, side=-4, pelvis=(0.03, 0.08, -0.1), look=(10, 4),
                  hand_r=(-0.88, 0.16, 4.22), pole_r=(-1.0, -0.1, 0.3), weapon=_n((0.05, 0.55, -0.83)),
                  hand_l=(0.7, -0.45, 2.75), hand_dir_l=_n((0.2, -0.8, -0.4)), fist_l=0.7,
                  clav_r=10, clav_fwd_l=10)
    apex = load.but(twist=-28, hand_r=(-0.84, 0.12, 4.32), weapon=_n((0.05, 0.62, -0.78)), lean=0)
    hit = st.but(twist=26, lean=24, side=4, pelvis=(-0.04, -0.12, -0.24), look=(-6, -10),
                 hand_r=(0.12, -0.95, 2.4), pole_r=(-0.6, -0.4, -0.6), weapon=_n((0.55, -0.75, -0.3)),
                 hand_l=(0.82, 0.15, 2.45), hand_dir_l=_n((0.3, 0.3, -0.9)), fist_l=0.4)
    follow = hit.but(hand_r=(0.32, -0.8, 2.15), pole_r=(-0.7, 0.2, -0.6), weapon=_n((0.7, -0.45, -0.55)),
                     twist=30, lean=27)
    over = st.but(twist=-6, lean=12, side=0, pelvis=(0.0, -0.02, -0.16), look=(2, -2),
                  hand_r=(-0.5, -0.6, 3.95), pole_r=(-1.0, -0.3, -0.2), weapon=_n((0.2, -0.3, 0.93)),
                  hand_l=(0.8, -0.1, 2.55), hand_dir_l=_n((0.3, 0.0, -0.9)), fist_l=0.5)
    keys = [(0.0, st, 'inout'), (0.36, load, 'out'), (0.5, apex, 'in'), (0.61, over, 'linear'), (0.72, hit, 'out'),
            (0.84, follow, 'auto'), (1.0, follow.but(lean=25), 'inout'), (1.45, st, 'linear')]
    return keyed(keys), 1.45


def attack2(rig):
    """A flat sweep from his right to his left at chest height. CONTACT 0.62."""
    st = stance(rig)
    load = st.but(twist=-34, lean=6, pelvis=(0.04, 0.06, -0.12), look=(14, -2), side=-2,
                  hand_r=(-1.0, 0.25, 3.0), pole_r=(-0.4, 0.6, -0.9), weapon=_n((-0.6, 0.7, 0.4)),
                  hand_l=(0.66, -0.55, 2.7), hand_dir_l=_n((0.1, -0.9, -0.3)), fist_l=0.75, clav_r=6)
    mid = st.but(twist=0, lean=12, hand_r=(-0.35, -1.0, 2.8), pole_r=(-0.8, 0.2, -0.7),
                 weapon=_n((-0.1, -0.95, 0.3)), pelvis=(0.0, -0.06, -0.15),
                 hand_l=(0.8, -0.15, 2.5), hand_dir_l=_n((0.3, -0.3, -0.9)), fist_l=0.6)
    end = st.but(twist=36, lean=14, side=3, pelvis=(-0.04, -0.05, -0.16), look=(-12, -4),
                 hand_r=(0.62, -0.7, 2.62), pole_r=(-0.6, 0.0, -0.8), weapon=_n((0.9, -0.2, 0.2)),
                 hand_l=(0.88, 0.28, 2.4), hand_dir_l=_n((0.3, 0.4, -0.9)), fist_l=0.45)
    keys = [(0.0, st, 'inout'), (0.38, load, 'expoin'), (0.62, mid, 'linear'), (0.78, end, 'out'),
            (0.98, end.but(twist=33), 'inout'), (1.4, st, 'linear')]
    return keyed(keys), 1.4


def attack3(rig):
    """A step in and a heavy one-handed slam straight down, the free hand flung out
    for balance. CONTACT 0.86 (the blade strikes level with his knees)."""
    st = stance(rig)
    gather = st.but(twist=-6, lean=6, hand_r=(-0.62, -0.45, 2.75), pole_r=(-0.9, 0.3, -0.5),
                    weapon=_n((0.1, -0.5, 0.85)), hand_l=(0.8, -0.3, 2.6), fist_l=0.6)
    raise_ = gather.but(lean=-6, pelvis=(0.0, 0.1, -0.04), look=(0, 12), hand_r=(-0.32, -0.2, 4.6),
                        pole_r=(-1.0, -0.3, 0.2), weapon=_n((0.0, 0.75, 0.65)), clav_r=14,
                        hand_l=(1.1, -0.1, 3.0), hand_dir_l=_n((0.8, -0.2, -0.5)), fist_l=0.2, spread_l=14,
                        foot_l=(0.36, -0.34, SOLE + 0.2), fpitch_l=8)
    strike = gather.but(lean=30, pelvis=(0.0, -0.24, -0.34), look=(0, -16), hand_r=(-0.2, -1.0, 2.3),
                        pole_r=(-0.8, 0.2, -0.5), weapon=_n((0.15, -0.9, -0.4)),
                        hand_l=(1.05, 0.05, 2.35), hand_dir_l=_n((0.6, 0.2, -0.75)), fist_l=0.3,
                        foot_l=(0.38, -0.58, SOLE), fpitch_l=0, knee_l=(0.2, -1.0, 0.1))
    back = gather.but(foot_l=(0.38, -0.58, SOLE))
    fall = gather.but(lean=14, pelvis=(0.0, -0.1, -0.2), hand_r=(-0.3, -0.75, 3.55), pole_r=(-0.8, -0.4, -0.3),
                      weapon=_n((0.2, -0.5, 0.85)), hand_l=(1.1, -0.05, 2.75), hand_dir_l=_n((0.7, -0.1, -0.6)),
                      fist_l=0.25, foot_l=(0.37, -0.5, SOLE + 0.08))
    keys = [(0.0, st, 'inout'), (0.28, gather, 'out'), (0.62, raise_, 'in'), (0.76, fall, 'linear'), (0.86, strike, 'out'),
            (1.12, strike.but(lean=28), 'inout'), (1.36, back, 'inout'),
            (1.53, back.but(foot_l=(0.36, -0.32, SOLE + 0.16), fpitch_l=6), 'inout'), (1.7, st, 'linear')]
    return keyed(keys), 1.7


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-4, twist=10, pelvis=(0.0, 0.12, -0.1), look=(-8, 10), head_roll=-6,
                  hand_r=(-0.92, -0.1, 2.36), hand_l=(0.95, 0.15, 2.38), jaw=12)
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.27, jolt.but(lean=2), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """Staggers back, drops to both knees on the sword, then pitches forward onto
    the ice. Knees 0.95, body hits the ice 1.9, still from 2.3."""
    st = stance(rig)
    stag = st.but(lean=-10, pelvis=(0.0, 0.22, -0.08), look=(0, 18), twist=8, jaw=18,
                  hand_l=(1.0, 0.1, 2.6), hand_dir_l=_n((0.4, 0.2, -0.8)), fist_l=0.2,
                  foot_r=(-0.33, 0.36, SOLE), fyaw_r=18)
    kneel = st.but(pelvis=(0.0, 0.42, -1.12), lean=24, neck=18, look=(0, -20), hip_tilt=8,
                   foot_l=(0.34, 0.9, 0.16), fpitch_l=-62, foot_r=(-0.33, 1.0, 0.16), fpitch_r=-62,
                   knee_l=(0.2, -1.0, -0.4), knee_r=(-0.2, -1.0, -0.4),
                   hand_r=(-0.5, -0.7, 1.95), weapon=_n((0.3, -0.65, -0.7)), pole_r=(-0.8, 0.4, -0.3),
                   hand_l=(0.7, -0.35, 1.5), hand_dir_l=_n((0.2, -0.3, -0.9)), fist_l=0.3, jaw=14)
    tip = kneel.but(pelvis=(0.0, 0.2, -1.2), lean=48, look=(0, -30), hand_r=(-0.62, -0.95, 1.2),
                    weapon=_n((0.6, -0.5, -0.62)), hand_l=(0.8, -1.0, 1.0))
    down = st.but(pitch=78, pelvis=(0.0, 0.0, 0.0), lean=10, neck=-10, look=(25, 8), hip_tilt=-10,
                  foot_l=(0.36, 0.25, 0.22), fpitch_l=-55, foot_r=(-0.4, 0.4, 0.2), fpitch_r=-55,
                  knee_l=(0.2, 0.0, -1.0), knee_r=(-0.2, 0.0, -1.0),
                  hand_r=(-1.0, -2.6, 0.22), weapon=_n((0.25, -0.97, 0.0)), pole_r=(-0.4, 0.2, 1.0),
                  hand_l=(1.05, -2.2, 0.22), hand_dir_l=_n((0.2, -0.95, -0.1)), pole_l=(0.4, 0.2, 1.0),
                  fist_l=0.4, jaw=10)
    lift = st.but(lean=-6, pelvis=(0.0, 0.12, -0.06), look=(0, 12), jaw=12,
                  foot_r=(-0.33, 0.26, SOLE + 0.18), fpitch_r=6)
    keys = [(0.0, st, 'out'), (0.14, lift, 'inout'), (0.28, stag, 'inout'), (0.95, kneel, 'out'), (1.3, tip, 'quadin'),
            (1.9, down, 'out'), (2.3, down.but(look=(28, 6)), 'hold'), (2.6, down.but(look=(28, 6)), 'hold')]
    return keyed(keys), 2.6


def rise(rig):
    """The flourish: hunched and streaming where the tide left him, he jerks loose,
    heaves upright (water thrown off at 0.45 and 1.05) and settles into the stance."""
    st = stance(rig)
    frozen = st.but(pelvis=(0.0, 0.1, -0.42), lean=40, neck=24, look=(0, -30), hip_tilt=10,
                    hand_r=(-0.6, -0.6, 1.92), weapon=_n((0.1, -0.8, -0.55)), hand_l=(0.55, -0.6, 1.8),
                    hand_dir_l=_n((0.0, -0.4, -0.9)), fist_l=0.9, clav_l=-6, clav_r=-6, knee_l=(0.2, -1.0, 0.2))
    crack = frozen.but(lean=34, twist=8, look=(10, -18), pelvis=(0.03, 0.1, -0.36), clav_l=4)
    heave = st.but(lean=-6, neck=-6, look=(0, 16), pelvis=(0.0, 0.0, 0.02), clav_l=14, clav_r=14, jaw=20,
                   hand_l=(1.05, -0.1, 2.5), hand_dir_l=_n((0.5, -0.2, -0.8)), fist_l=0.1, spread_l=20,
                   hand_r=(-1.0, -0.3, 2.4))
    keys = [(0.0, frozen, 'hold'), (0.3, frozen, 'expoin'), (0.45, crack, 'out'), (0.75, crack.but(twist=-6), 'expoin'),
            (1.05, heave, 'out'), (1.55, heave.but(lean=3, jaw=6), 'inout'), (2.4, st, 'linear')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.26), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.42, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Attack3', attack3, False),
    ('Hit', hit, False),
    ('Death', death, False),
    ('Rise', rise, False),
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
