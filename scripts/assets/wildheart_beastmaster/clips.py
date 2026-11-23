"""Every clip the Fanglord Beastmaster ships, with its contact frames.

Times in seconds (24 fps), authored at the kit's size (the build scales the
finished troll up, anatomy.BUILD_SCALE). CONTACT = the frame damage or an
effect lands. He stands tall for a troll, the Beastspear upright at his right
side, the jaguar pelt hanging from his hood down his back.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.3, 0.62, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.78, 1.0, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
QUAKE_STRIKE = 1.5          # the spear and his foot strike the pit floor (the Beast Pit Quake bar's end)
WAR_CRY_PEAK = 0.5          # Call of the Hunt: the roar's peak
WARD_PEAK = 0.55            # Thickhide Ward: the spear thrust toward the jaguar


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.52, -0.08, SOLE)
FOOT_R = (-0.52, 0.16, SOLE)


def stance(rig):
    """Upright for a troll, the spear planted at his right side, blade high."""
    return Body(rig, pelvis=(0.0, 0.03, -0.06), lean=6, neck=6, look=(0, -2), hip_tilt=3,
                hand_r=(-1.08, -0.4, 2.45), pole_r=(-0.5, 0.9, -0.35), weapon=_n((-0.04, -0.06, 1.0)),
                hand_l=(1.26, -0.1, 2.15), pole_l=(0.6, 0.8, -0.3), fist_l=0.7,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=8, fyaw_r=10,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0))


def guard(rig):
    """The spear levelled at the foe in both hands, crouched behind it."""
    return stance(rig).but(pelvis=(0.0, 0.14, -0.3), lean=16, neck=12, look=(0, 8), twist=-14,
                           hand_r=(-0.6, -0.5, 2.55), pole_r=(-0.9, 0.5, -0.3), weapon=_n((0.25, -0.95, 0.18)),
                           grip_w=1.0, grip_l=0.9, foot_l=(0.56, -0.36, SOLE), foot_r=(-0.54, 0.34, SOLE), fyaw_r=20)


def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        return st.but(pelvis=(0.03 * s1, 0.03, -0.06 - 0.015 * (1 - math.cos(2 * u)) / 2), hip_roll=1.5 * s1,
                      side=-1.6 * s1, lean=st.p['lean'] + 1.4 * s2, clav_l=1.5 * s2, clav_r=1.5 * s2,
                      look=(9.0 * s1, -2 + 3 * s2), head_roll=3 * s1, jaw=2 + 3 * max(0.0, s2),
                      fist_l=0.7 + 0.2 * s2)
    return fn


def combat_idle(rig, period=2.0):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        s1 = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * s1, pelvis=(0.0, 0.14, -0.3 - 0.02 * (1 - math.cos(u)) / 2),
                     look=(5 * s1, 8), jaw=6 + 5 * s1)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    base = stance(rig)
    if run:
        base = base.but(hand_r=(-0.8, -0.72, 2.6), weapon=_n((0.18, -0.92, 0.35)), pole_r=(-1.0, 0.3, -0.4),
                        hand_l=(1.15, 0.2, 2.6), pole_l=(0.8, 0.6, -0.3))
    else:
        base = base.but(weapon=_n((-0.06, -0.3, 0.95)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.52, heel_roll=26, toe_up=14)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.52, heel_roll=26,
                                 toe_up=14)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob, lean = -0.24 + 0.09 * math.cos(TAU * (ph * 2 - 0.15)), 22
        else:
            bob, lean = -0.08 + 0.05 * math.cos(TAU * (ph * 2 - 0.1)), 8
        out = st.but(pelvis=(0.05 * s1, 0.03, bob), hip_twist=-9 * s1, hip_roll=4 * s1, lean=lean + 2.5 * c2,
                     twist=7 * s1, neck=8, look=(-4 * s1, 6 if run else -2), foot_l=fl, foot_r=fr, fpitch_l=pl,
                     fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=8)
        if not run:
            sw = 0.3 * s1
            out = out.but(hand_l=(1.2, -0.1 - sw, 2.2 + abs(sw) * 0.25), hand_r=(-1.06, -0.4 + sw * 0.5, 2.47))
        return out
    return fn


def attack(rig):
    """The thrust: the spear drawn back along the hip, then driven forward with a
    long step in. CONTACT 0.54."""
    st = stance(rig)
    g = guard(rig)
    draw = g.but(twist=-28, lean=6, pelvis=(0.04, 0.26, -0.22), hand_r=(-0.82, 0.32, 2.6),
                 weapon=_n((0.2, -0.95, 0.2)), grip_l=1.0, look=(4, 6))
    hit = g.but(twist=22, lean=26, pelvis=(-0.02, -0.4, -0.38), hand_r=(-0.3, -1.45, 2.75),
                weapon=_n((0.07, -0.99, 0.06)), grip_l=0.9, look=(-2, -2), jaw=30,
                foot_l=(0.56, -0.78, SOLE), knee_l=(0.2, -1.0, 0.2))
    keys = [(0.0, st, 'inout'), (0.18, g, 'inout'), (0.4, draw, 'in'), (0.54, hit, 'out'),
            (0.82, hit.but(lean=22), 'inout'), (1.12, g, 'inout'), (1.45, st, 'linear')]
    return keyed(keys), 1.45


def attack2(rig):
    """The sweep: the blade swung low across his front from right to left.
    CONTACT 0.5."""
    st = stance(rig)
    g = guard(rig)
    wind = g.but(twist=-40, lean=8, pelvis=(0.06, 0.16, -0.3), hand_r=(-1.35, 0.1, 2.85), pole_r=(-0.3, 0.9, -0.6),
                 weapon=_n((-0.8, 0.55, 0.2)), grip_l=0.8, look=(-14, 4))
    mid = g.but(twist=0, lean=18, pelvis=(0.0, -0.08, -0.38), hand_r=(-0.6, -1.4, 2.6),
                weapon=_n((-0.15, -1.0, -0.1)), grip_l=0.8, jaw=24)
    sweep = g.but(twist=40, lean=18, pelvis=(-0.08, -0.1, -0.36), hand_r=(0.55, -1.25, 2.55),
                  pole_r=(-0.4, 0.4, -1.0), weapon=_n((0.7, -0.7, -0.12)), grip_l=0.8, look=(16, -6))
    keys = [(0.0, st, 'inout'), (0.3, wind, 'in'), (0.5, mid, 'linear'), (0.64, sweep, 'out'),
            (0.95, sweep.but(lean=14, twist=34), 'inout'), (1.35, st, 'linear')]
    return keyed(keys), 1.35


def quake(rig):
    """Beast Pit Quake (the 1.5 s bar, played from its start at 1x): he hefts the
    spear high in both hands and rears back on one leg, then drives the spear's
    butt down into the pit floor as his raised foot stamps (the 8 yd quake).
    CONTACT 1.50; recovered by 2.4."""
    st = stance(rig)
    heft = st.but(lean=-2, pelvis=(0.0, 0.1, -0.12), hand_r=(-0.5, -0.4, 3.2), pole_r=(-1.0, 0.3, -0.2),
                  weapon=_n((0.0, -0.1, 1.0)), grip_w=1.0, grip_l=0.5, look=(0, 12), jaw=18)
    high = heft.but(lean=-10, neck=-8, pelvis=(0.0, 0.16, 0.06), hand_r=(-0.25, -0.45, 4.5),
                    weapon=_n((0.0, -0.05, 1.0)), look=(0, 26), jaw=40,
                    foot_l=(0.55, -0.4, SOLE + 0.7), knee_l=(0.3, -1.0, 0.4), fpitch_l=20)
    coil = high.but(lean=-4, hand_r=(-0.26, -0.7, 4.3), jaw=34, foot_l=(0.55, -0.45, SOLE + 0.85))
    strike = st.but(lean=32, neck=14, pelvis=(0.0, -0.3, -0.62), hand_r=(-0.22, -1.5, 2.0),
                    weapon=_n((0.0, -0.12, 1.0)), grip_w=1.0, grip_l=0.45, look=(0, -16), jaw=46,
                    foot_l=(0.58, -0.62, SOLE), foot_r=(-0.56, 0.38, SOLE), knee_l=(0.25, -1.0, 0.2),
                    knee_r=(-0.25, -1.0, 0.2))
    keys = [(0.0, st, 'inout'), (0.35, heft, 'inout'), (0.85, high, 'inout'), (1.25, coil, 'in'),
            (QUAKE_STRIKE, strike, 'out'), (1.8, strike.but(lean=28, jaw=30), 'inout'),
            (2.4, st, 'linear')]
    return keyed(keys), 2.4


def war_cry(rig):
    """Call of the Hunt: he throws his head back and roars, the spear thrust high,
    the free fist beating his chest. CONTACT 0.50 (the roar's peak)."""
    st = stance(rig)
    load = st.but(lean=14, pelvis=(0.0, 0.08, -0.2), look=(0, -12), jaw=10, hand_l=(0.5, -0.6, 3.5), fist_l=1.0)
    peak = st.but(lean=-14, neck=-12, pelvis=(0.0, 0.1, 0.02), look=(0, 30), jaw=52, hand_r=(-0.9, -0.3, 4.3),
                  pole_r=(-1.0, 0.3, -0.2), weapon=_n((0.05, -0.15, 1.0)), hand_l=(0.36, -0.62, 3.6), fist_l=1.0,
                  clav_l=10, clav_r=12)
    keys = [(0.0, st, 'inout'), (0.25, load, 'in'), (WAR_CRY_PEAK, peak, 'out'),
            (0.95, peak.but(look=(6, 28), jaw=48), 'inout'), (1.15, peak.but(look=(-6, 28)), 'inout'),
            (1.6, st, 'linear')]
    return keyed(keys), 1.6


def ward(rig):
    """Thickhide Ward: he points the spear at his jaguar off to his left and barks
    the warding word, the free hand open toward it. CONTACT 0.55."""
    st = stance(rig)
    point = st.but(twist=26, lean=6, look=(32, 2), jaw=34, hand_r=(-0.2, -1.0, 3.3), pole_r=(-1.0, 0.3, -0.3),
                   weapon=_n((0.75, -0.6, 0.3)), hand_l=(1.4, -0.8, 3.0), pole_l=(1.0, 0.3, -0.3), fist_l=0.0,
                   spread_l=0.8)
    keys = [(0.0, st, 'inout'), (0.3, point.but(jaw=10), 'in'), (WARD_PEAK, point, 'out'),
            (0.95, point.but(jaw=12), 'inout'), (1.3, st, 'linear')]
    return keyed(keys), 1.3


def cast(rig):
    st = stance(rig)
    up = st.but(lean=-6, neck=-8, look=(0, 20), hand_r=(-0.85, -0.3, 4.1), pole_r=(-1.0, 0.3, -0.2),
                weapon=_n((0.05, -0.1, 1.0)), hand_l=(1.0, -0.6, 3.9), pole_l=(1.0, 0.3, -0.2), fist_l=0.0,
                spread_l=0.6, jaw=20)
    keys = [(0.0, up, 'inout'), (1.0, up.but(look=(4, 24), jaw=28), 'inout'), (2.0, up, 'linear')]
    return keyed(keys), 2.0


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-4, twist=12, pelvis=(0.0, 0.16, -0.1), look=(-12, 14), head_roll=-9, jaw=24,
                  hand_l=(1.3, 0.1, 2.4))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.28, jolt.but(lean=2), 'inout'), (0.62, st, 'linear')]
    return keyed(keys), 0.62


def death(rig):
    """He staggers, drops to one knee leaning on the spear, roars a last time, and
    falls forward onto his face. Still from 2.6."""
    st = stance(rig)
    reel = st.but(lean=-12, neck=-14, look=(0, 24), pelvis=(0.0, 0.14, -0.06), twist=8, jaw=40,
                  hand_l=(0.4, -0.58, 3.5), pole_l=(0.8, 0.5, -0.4), fist_l=0.6)
    kneel = st.but(pelvis=(0.0, 0.1, -1.0), lean=14, neck=10, look=(0, -10), jaw=20,
                   foot_l=(0.52, -0.4, SOLE), foot_r=(-0.52, 0.4, SOLE), fpitch_r=-40,
                   knee_l=(0.2, -1.0, 0.2), hand_r=(-0.8, -0.7, 2.1), weapon=_n((0.0, -0.15, 1.0)),
                   hand_l=(0.9, -0.5, 1.6), pole_l=(0.8, 0.3, 0.6), fist_l=0.3)
    roar = kneel.but(lean=-4, look=(0, 26), jaw=50)
    face = st.but(pelvis=(0.0, 0.2, -1.42), lean=86, neck=20, look=(14, -20), head_roll=16, side=8, jaw=26,
                  foot_l=(0.52, 1.05, SOLE + 0.1), foot_r=(-0.5, 1.1, SOLE + 0.1), fpitch_l=-95, fpitch_r=-95,
                  knee_l=(0.2, -1.0, -0.6), hand_r=(-1.3, -1.5, 0.22), weapon=_n((0.5, -0.86, -0.05)),
                  pole_r=(-0.6, 0.2, 1.0), hand_l=(1.3, -1.45, 0.2), pole_l=(0.6, 0.2, 1.0), fist_l=0.2, fist_r=0.4)
    keys = [(0.0, st, 'out'), (0.3, reel, 'inout'), (0.85, kneel, 'quadin'), (1.25, roar, 'inout'),
            (1.6, kneel.but(lean=22), 'inout'), (2.15, face, 'out'), (2.6, face.but(lean=84, look=(16, -22)), 'hold'),
            (3.0, face.but(lean=84, look=(16, -22)), 'hold')]
    return keyed(keys), 3.0


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.32), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.52, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Quake', quake, False),
    ('WarCry', war_cry, False),
    ('Ward', ward, False),
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
        M.STATEFUL_IK = name in ('Quake', 'Attack', 'Attack2')
        write_clip(arm, rig, name, f, dur, loop=loop, wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run'
                                                            else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
