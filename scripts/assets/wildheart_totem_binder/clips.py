"""Every clip the Sunbone Totem-Binder ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect lands.
He stands hunched over his staff, the carved jaguar crown above his head, the
bundle of stakes on his back; the plumes of his mask and his loincloth swing.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.3, 0.6, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.78, 1.0, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
PLANT_IMPACT = 1.5          # the staff's butt strikes the earth (the Plant Totem bar's end)


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def plume(lift=0.0):
    return {'Plume': [('x', lift)]}


FOOT_L = (0.5, -0.06, SOLE)
FOOT_R = (-0.5, 0.14, SOLE)


def stance(rig):
    """Hunched over his staff: the staff planted upright at his right side, the left
    arm hanging long, the head thrust forward."""
    return Body(rig, pelvis=(0.0, 0.04, -0.1), lean=10, neck=8, look=(0, -4), hip_tilt=4,
                hand_r=(-1.1, -0.42, 2.38), pole_r=(-0.5, 0.9, -0.35), weapon=_n((-0.05, -0.08, 1.0)),
                hand_l=(1.28, -0.12, 2.1), pole_l=(0.6, 0.8, -0.3), fist_l=0.45,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=8, fyaw_r=10,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), extra=plume(0))


def guard(rig):
    """The fighting crouch: the staff held across the body in both hands, crown
    toward the foe."""
    return stance(rig).but(pelvis=(0.0, 0.12, -0.28), lean=16, neck=12, look=(0, 8), twist=-10,
                           hand_r=(-0.62, -0.62, 2.55), pole_r=(-0.9, 0.5, -0.3), weapon=_n((0.35, -0.75, 0.55)),
                           grip_w=1.0, grip_l=0.7, foot_l=(0.54, -0.34, SOLE), foot_r=(-0.52, 0.32, SOLE),
                           fyaw_r=20, extra=plume(10))


def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        return st.but(pelvis=(0.03 * s1, 0.04, -0.1 - 0.015 * (1 - math.cos(2 * u)) / 2), hip_roll=1.5 * s1,
                      side=-1.6 * s1, lean=st.p['lean'] + 1.4 * s2, clav_l=1.5 * s2, clav_r=1.5 * s2,
                      look=(10.0 * s1, -4 + 3 * s2), head_roll=3 * s1, jaw=2 + 2 * max(0.0, s2),
                      hand_l=(1.28 + 0.03 * s1, -0.12 - 0.04 * s2, 2.1), fist_l=0.45 + 0.15 * s2,
                      extra=plume(4 * s1))
    return fn


def combat_idle(rig, period=2.0):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        s1 = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * s1, pelvis=(0.0, 0.12, -0.28 - 0.02 * (1 - math.cos(u)) / 2),
                     look=(5 * s1, 8), jaw=6 + 4 * s1, extra=plume(10 + 4 * s1))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    base = stance(rig)
    if run:
        base = base.but(hand_r=(-0.82, -0.7, 2.6), weapon=_n((0.2, -0.9, 0.38)), pole_r=(-1.0, 0.3, -0.4),
                        hand_l=(1.15, 0.2, 2.6), pole_l=(0.8, 0.6, -0.3))
    else:
        base = base.but(weapon=_n((-0.08, -0.35, 0.93)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.5, heel_roll=26, toe_up=14)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.5, heel_roll=26,
                                 toe_up=14)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.24 + 0.09 * math.cos(TAU * (ph * 2 - 0.15))
            lean = 24
        else:
            bob = -0.1 + 0.05 * math.cos(TAU * (ph * 2 - 0.1))
            lean = 12
        out = st.but(pelvis=(0.05 * s1, 0.04, bob), hip_twist=-9 * s1, hip_roll=4 * s1, lean=lean + 2.5 * c2,
                     twist=7 * s1, neck=10, look=(-4 * s1, 6 if run else -2), foot_l=fl, foot_r=fr, fpitch_l=pl,
                     fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=8, extra=plume(16 if run else 6 + 4 * c2))
        if not run:
            sw = 0.28 * s1
            out = out.but(hand_l=(1.22, -0.1 - sw, 2.15 + abs(sw) * 0.25), hand_r=(-1.08, -0.42 + sw * 0.5, 2.4))
        return out
    return fn


def attack(rig):
    """The overhead smash: the staff swung up behind his head in both hands and
    brought down crown first on his foe, a step in. CONTACT 0.56."""
    st = stance(rig)
    g = guard(rig)
    up = g.but(lean=-4, twist=-6, pelvis=(0.0, 0.2, -0.12), look=(0, 18), neck=-4,
               hand_r=(-0.3, 0.1, 4.6), pole_r=(-1.0, 0.2, -0.3), weapon=_n((0.0, 0.85, 0.52)), grip_l=0.6,
               jaw=26, extra=plume(-10))
    smash = g.but(lean=30, twist=4, pelvis=(0.0, -0.4, -0.42), look=(0, -12), hand_r=(-0.25, -1.3, 2.4),
                  pole_r=(-0.9, 0.3, -0.3), weapon=_n((0.05, -0.85, -0.52)), grip_l=0.6, jaw=34,
                  foot_l=(0.54, -0.72, SOLE), knee_l=(0.2, -1.0, 0.2), extra=plume(24))
    keys = [(0.0, st, 'inout'), (0.18, g, 'inout'), (0.4, up, 'in'), (0.56, smash, 'out'),
            (0.84, smash.but(lean=26), 'inout'), (1.15, g, 'inout'), (1.45, st, 'linear')]
    return keyed(keys), 1.45


def attack2(rig):
    """The butt jab: the staff reversed and driven butt first into his foe's gut,
    a twist of the hips behind it. CONTACT 0.48."""
    st = stance(rig)
    g = guard(rig)
    load = g.but(twist=22, lean=8, pelvis=(0.04, 0.24, -0.24), hand_r=(-0.7, 0.2, 2.9),
                 weapon=_n((0.1, 0.9, 0.42)), grip_l=0.6, look=(-6, 6), extra=plume(6))
    jab = g.but(twist=-24, lean=24, pelvis=(0.0, -0.34, -0.34), hand_r=(-0.3, -0.5, 2.7),
                weapon=_n((0.05, 0.85, 0.5)), grip_l=0.5, look=(4, 0), jaw=24, foot_l=(0.54, -0.7, SOLE),
                knee_l=(0.2, -1.0, 0.2), extra=plume(18))
    keys = [(0.0, st, 'inout'), (0.16, g, 'inout'), (0.34, load, 'in'), (0.48, jab, 'out'),
            (0.74, jab.but(lean=20), 'inout'), (1.05, g, 'inout'), (1.35, st, 'linear')]
    return keyed(keys), 1.35


def plant_totem(rig):
    """Plant Totem (the 1.5 s bar, played from its start at 1x): he hefts the staff
    up in both hands and raises it high over his head, the head thrown back
    chanting, the plumes flared; at the bar's end he drives it straight down butt
    first into the earth two yards before him, crouched over it, and the totem
    rises there. CONTACT 1.50 (the strike), held to 1.85, recovered by 2.5."""
    st = stance(rig)
    heft = st.but(lean=4, pelvis=(0.0, 0.08, -0.2), hand_r=(-0.5, -0.5, 3.0), pole_r=(-1.0, 0.3, -0.2),
                  weapon=_n((0.0, -0.1, 1.0)), grip_w=1.0, grip_l=0.45, look=(0, 10), jaw=10, extra=plume(10))
    high = heft.but(lean=-10, neck=-10, pelvis=(0.0, 0.14, 0.0), hand_r=(-0.25, -0.55, 4.55),
                    pole_r=(-1.0, 0.1, -0.3), weapon=_n((0.0, -0.06, 1.0)), look=(0, 30), jaw=34, extra=plume(-14))
    chant = high.but(lean=-12, look=(0, 34), jaw=40, extra=plume(-20), hand_r=(-0.24, -0.6, 4.62))
    coil = high.but(lean=-4, look=(0, 20), jaw=30, pelvis=(0.0, 0.1, 0.05), hand_r=(-0.26, -0.82, 4.4),
                    extra=plume(-6))
    strike = st.but(lean=36, neck=14, pelvis=(0.0, -0.32, -0.62), hand_r=(-0.2, -1.62, 1.95),
                    pole_r=(-1.0, 0.4, -0.2), weapon=_n((0.0, -0.12, 1.0)), grip_w=1.0, grip_l=0.4,
                    look=(0, -20), jaw=46, foot_l=(0.56, -0.66, SOLE), foot_r=(-0.56, 0.36, SOLE),
                    knee_l=(0.25, -1.0, 0.2), knee_r=(-0.25, -1.0, 0.2), extra=plume(30))
    keys = [(0.0, st, 'inout'), (0.3, heft, 'inout'), (0.75, high, 'inout'), (1.05, chant, 'inout'),
            (1.3, coil, 'in'), (PLANT_IMPACT, strike, 'out'), (1.85, strike.but(lean=33, jaw=30), 'inout'),
            (2.2, strike.but(lean=20, pelvis=(0.0, -0.2, -0.3), hand_r=(-0.6, -1.0, 2.3), grip_w=0.0),
             'inout'), (2.55, st, 'linear')]
    return keyed(keys), 2.55


def cast(rig):
    """The generic cast channel: the staff raised high, the free hand open to the sky."""
    st = stance(rig)
    up = st.but(lean=-6, neck=-8, look=(0, 22), hand_r=(-0.85, -0.3, 4.1), pole_r=(-1.0, 0.3, -0.2),
                weapon=_n((0.05, -0.1, 1.0)), hand_l=(1.0, -0.6, 4.0), pole_l=(1.0, 0.3, -0.2), fist_l=0.0,
                spread_l=0.6, jaw=20, extra=plume(-10))
    keys = [(0.0, up, 'inout'), (1.0, up.but(look=(4, 26), jaw=28), 'inout'), (2.0, up, 'linear')]
    return keyed(keys), 2.0


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-4, twist=12, pelvis=(0.0, 0.16, -0.12), look=(-12, 14), head_roll=-9, jaw=24,
                  hand_l=(1.3, 0.1, 2.4), extra=plume(-14))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.28, jolt.but(lean=2), 'inout'), (0.62, st, 'linear')]
    return keyed(keys), 0.62


def death(rig):
    """He reels back clutching his chest, drops to his knees leaning on the staff,
    then the staff slips and he pitches forward onto his face. Still from 2.4."""
    st = stance(rig)
    reel = st.but(lean=-12, neck=-14, look=(0, 24), pelvis=(0.0, 0.14, -0.06), twist=8, jaw=36,
                  hand_l=(0.4, -0.58, 3.5), pole_l=(0.8, 0.5, -0.4), fist_l=0.6, extra=plume(-20))
    kneel = st.but(pelvis=(0.0, 0.1, -1.05), lean=18, neck=12, look=(0, -14), jaw=20,
                   foot_l=(0.5, 0.2, SOLE), foot_r=(-0.5, 0.3, SOLE), fpitch_l=-30, fpitch_r=-30,
                   knee_l=(0.2, -1.0, -0.3), hand_r=(-0.8, -0.8, 2.0), weapon=_n((0.0, -0.2, 1.0)),
                   hand_l=(0.9, -0.6, 1.5), pole_l=(0.8, 0.3, 0.6), fist_l=0.3, extra=plume(8))
    face = st.but(pelvis=(0.0, 0.2, -1.42), lean=86, neck=20, look=(14, -20), head_roll=16, side=8, jaw=26,
                  foot_l=(0.52, 1.05, SOLE + 0.1), foot_r=(-0.5, 1.1, SOLE + 0.1), fpitch_l=-95, fpitch_r=-95,
                  knee_l=(0.2, -1.0, -0.6), hand_r=(-1.3, -1.5, 0.22), weapon=_n((0.5, -0.86, -0.05)),
                  pole_r=(-0.6, 0.2, 1.0), hand_l=(1.3, -1.45, 0.2), pole_l=(0.6, 0.2, 1.0), fist_l=0.2, fist_r=0.4,
                  extra=plume(-30))
    keys = [(0.0, st, 'out'), (0.3, reel, 'inout'), (0.9, kneel, 'quadin'), (1.25, kneel.but(lean=24), 'inout'),
            (1.85, face, 'out'), (2.4, face.but(lean=84, look=(16, -22)), 'hold'),
            (2.8, face.but(lean=84, look=(16, -22)), 'hold')]
    return keyed(keys), 2.8


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.32), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.52, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('PlantTotem', plant_totem, False),
    ('Cast', cast, True),
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
        M.STATEFUL_IK = name in ('PlantTotem', 'Attack')
        write_clip(arm, rig, name, f, dur, loop=loop, wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run'
                                                            else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
