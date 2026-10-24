"""Every clip the Ogre Sledge-Hauler ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
He is a beast of burden: hunched, the head low between the shoulders, the arms
hanging forward with the knuckles by the knees, the haul hook swinging off his
right fist. The ice block exists only in IceBlockToss (the Weapon bone is scaled
to nothing everywhere else).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.625, 0.72, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.875, 1.1, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
HIDE = {'Weapon': 0.001}
SHOW = {'Weapon': 1.0}
TOSS_RELEASE = 1.25


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.6, -0.04, SOLE)
FOOT_R = (-0.58, 0.18, SOLE)


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.06, -0.12), lean=16, neck=16, look=(0, 8), hip_tilt=6,
                hand_r=(-1.28, -0.5, 2.45), pole_r=(-0.5, 0.9, -0.4), hand_dir_r=_n((-0.1, -0.25, -1.0)), fist_r=0.95,
                hand_l=(1.3, -0.45, 2.42), pole_l=(0.5, 0.9, -0.4), hand_dir_l=_n((0.1, -0.25, -1.0)), fist_l=0.55,
                hand_roll_l=-15, hand_roll_r=-10, foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=12, fyaw_r=14,
                knee_l=(0.25, -1.0, 0.0), knee_r=(-0.25, -1.0, 0.0), clav_fwd_l=6, clav_fwd_r=6, scale=HIDE)


def guard(rig):
    return stance(rig).but(pelvis=(0.0, 0.12, -0.26), lean=22, neck=12, look=(0, 12), twist=-8,
                           hand_r=(-1.05, -0.95, 2.85), pole_r=(-0.9, 0.4, -0.4), hand_dir_r=_n((0.0, -0.6, -0.8)),
                           hand_l=(1.05, -0.9, 2.75), pole_l=(0.9, 0.4, -0.4), hand_dir_l=_n((0.0, -0.6, -0.8)),
                           fist_l=0.9, foot_l=(0.7, -0.32, SOLE), foot_r=(-0.66, 0.38, SOLE), fyaw_r=24)


def idle(rig, period=4.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        return st.but(lean=st.p['lean'] + 1.8 * br, clav_l=2 * br, clav_r=2 * br,
                      look=(7 * math.sin(u), 8 + 3 * math.sin(u * 2 + 0.6)), head_roll=3 * math.sin(u),
                      pelvis=(0.015 * math.sin(u), 0.06, -0.12 - 0.012 * (1 - math.cos(2 * u)) / 2),
                      jaw=3 + 3 * (1 - math.cos(u * 2)) / 2,
                      hand_l=(1.3, -0.45 + 0.02 * br, 2.42 + 0.02 * br), hand_r=(-1.28, -0.5 + 0.02 * br, 2.45))
    return fn


def combat_idle(rig, period=1.8):
    g = guard(rig)

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 2 * br, pelvis=(0.03 * math.sin(u), 0.12, -0.26 - 0.02 * (1 - math.cos(u)) / 2),
                     look=(5 * math.sin(u), 12), jaw=6 + 4 * (1 - math.cos(u)) / 2, clav_l=2 * br, clav_r=2 * br)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    st = stance(rig)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.58)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.57)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.24 + 0.1 * math.cos(TAU * (ph * 2 - 0.15))
            lean, swing = 26, 0.6
        else:
            bob = -0.14 + 0.06 * math.cos(TAU * (ph * 2 - 0.1))
            lean, swing = 18, 0.42
        al, ar = -swing * s1, swing * s1
        return st.but(
            pelvis=(0.07 * s1, 0.06, bob), hip_twist=-9 * s1, hip_roll=5 * s1, lean=lean + 3 * c2, twist=9 * s1,
            side=3 * s1, neck=14, look=(-5 * s1, 6),
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=10, fyaw_r=12,
            hand_l=(1.25, -0.45 + al * 1.0, 2.5 + abs(al) * 0.3 + (0.2 if run else 0)),
            hand_r=(-1.25, -0.5 + ar * 1.0, 2.52 + abs(ar) * 0.3 + (0.2 if run else 0)),
            hand_dir_l=_n((0.1, -0.25 + al * 0.5, -1.0)), hand_dir_r=_n((-0.1, -0.25 + ar * 0.5, -1.0)),
            fist_l=0.85 if run else 0.55)
    return fn


def attack(rig):
    """The haul-fist hammer: the right fist swung up over the shoulder and brought
    down like a sledge, the hook whipping round after it. CONTACT 0.78."""
    st = stance(rig)
    load = st.but(twist=-26, lean=4, side=-6, pelvis=(0.04, 0.12, -0.16), look=(10, 18),
                  hand_r=(-1.1, 0.35, 4.9), pole_r=(-1.0, 0.0, 0.3), hand_dir_r=_n((0.0, 0.2, 1.0)), fist_r=1.0,
                  hand_l=(1.15, -0.7, 3.0), hand_dir_l=_n((0.2, -0.8, -0.4)), fist_l=0.8, clav_r=16)
    hit = st.but(twist=22, lean=34, side=6, pelvis=(-0.04, -0.2, -0.42), look=(-6, -4),
                 hand_r=(-0.25, -1.55, 2.2), pole_r=(-0.9, 0.3, -0.3), hand_dir_r=_n((0.05, -0.95, -0.3)), fist_r=1.0,
                 hand_l=(1.3, 0.1, 2.6), hand_dir_l=_n((0.4, 0.3, -0.85)), fist_l=0.6)
    keys = [(0.0, st, 'inout'), (0.42, load, 'out'), (0.56, load.but(twist=-29), 'in'), (0.78, hit, 'out'),
            (1.05, hit.but(lean=31), 'inout'), (1.6, st, 'linear')]
    return keyed(keys), 1.6


def attack2(rig):
    """A backhand sweep of the left arm, low across his front. CONTACT 0.6."""
    st = stance(rig)
    load = st.but(twist=26, lean=14, pelvis=(-0.04, 0.08, -0.2), look=(-14, 8),
                  hand_l=(-0.2, -1.0, 3.2), pole_l=(0.6, 0.2, -0.9), hand_dir_l=_n((-0.6, -0.4, -0.6)), fist_l=1.0,
                  hand_r=(-1.25, 0.1, 2.6))
    hit = st.but(twist=-24, lean=22, pelvis=(0.04, -0.1, -0.28), look=(16, 4),
                 hand_l=(1.9, -0.9, 2.9), pole_l=(0.4, 0.6, -0.8), hand_dir_l=_n((0.8, -0.2, -0.5)), fist_l=1.0,
                 hand_r=(-1.25, -0.8, 2.6))
    keys = [(0.0, st, 'inout'), (0.36, load, 'in'), (0.6, hit, 'out'), (0.82, hit.but(twist=-28), 'inout'),
            (1.3, st, 'linear')]
    return keyed(keys), 1.3


def ice_block_toss(rig):
    """The Ice Block Toss: he squats, rips a block out of the glacier (0.24 to 0.48),
    heaves it up over his head (to 0.95), leans back to load the throw and hurls it:
    RELEASE 1.25 (the block leaves his hands and his own block mesh vanishes on the
    same frame: the fx fly theirs from 60 percent of the 2 s bar, landing on its
    end), follow-through to 2.05."""
    st = stance(rig)
    acr = _n((1.0, 0.0, 0.0))
    squat = st.but(pelvis=(0.0, -0.1, -0.85), lean=42, neck=6, look=(0, -10), hip_tilt=14,
                   hand_r=(-0.62, -1.25, 1.02), pole_r=(-0.9, 0.4, -0.3), weapon=acr,
                   hand_l=(0.62, -1.25, 1.02), pole_l=(0.9, 0.4, -0.3), grip_l=2 * A.BLOCK_HALF, grip_w=1.0,
                   knee_l=(0.4, -1.0, 0.0), knee_r=(-0.4, -1.0, 0.0), scale={'Weapon': 0.001})
    rip = squat.but(pelvis=(0.0, -0.05, -0.62), lean=32, look=(0, 0), hand_r=(-0.6, -1.15, 1.45),
                    scale={'Weapon': 1.0})
    chest = st.but(pelvis=(0.0, 0.05, -0.2), lean=8, look=(0, 12), hand_r=(-0.6, -1.0, 3.3),
                   pole_r=(-1.0, 0.2, -0.4), weapon=acr, pole_l=(1.0, 0.2, -0.4), grip_l=2 * A.BLOCK_HALF, grip_w=1.0,
                   scale={'Weapon': 1.0})
    over = chest.but(lean=-10, pelvis=(0.0, 0.2, -0.1), look=(0, 22), hand_r=(-0.6, 0.2, 6.05),
                     pole_r=(-1.0, -0.5, 0.2), pole_l=(1.0, -0.5, 0.2), clav_l=18, clav_r=18)
    load = over.but(lean=-16, pelvis=(0.0, 0.32, -0.18), hand_r=(-0.6, 0.6, 5.95))
    throw = chest.but(lean=34, pelvis=(0.0, -0.3, -0.36), look=(0, 0), hand_r=(-0.6, -1.5, 3.7),
                      pole_r=(-1.0, 0.3, -0.2), pole_l=(1.0, 0.3, -0.2), foot_l=(0.6, -0.4, SOLE), scale={'Weapon': 1.0})
    empty = throw.but(grip_w=0.0, weapon=None, hand_r=(-1.0, -1.4, 3.0), hand_dir_r=_n((0.0, -0.8, -0.6)),
                      hand_l=(1.0, -1.4, 3.0), hand_dir_l=_n((0.0, -0.8, -0.6)), fist_l=0.2, fist_r=0.4,
                      spread_l=18, scale={'Weapon': 0.001})
    keys = [(0.0, st, 'inout'), (0.24, squat, 'inout'), (0.48, rip, 'inout'), (0.72, chest, 'inout'),
            (0.95, over, 'inout'), (1.12, load, 'expoin'), (TOSS_RELEASE, throw, 'linear'),
            (TOSS_RELEASE + 0.05, empty, 'out'), (1.6, empty.but(lean=30), 'inout'), (2.05, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if TOSS_RELEASE - 1e-6 <= t <= TOSS_RELEASE + 0.05:
            b = b.but(scale={'Weapon': 1.0 if t < TOSS_RELEASE + 0.02 else 0.001})
        return b
    return fn, 2.05


def enrage(rig):
    """Below 30 percent: he rears up, beats his chest with both fists and bellows.
    Beats at 0.55 and 0.85, the bellow peaks 1.3, back in stance by 2.2."""
    st = stance(rig)
    rear = st.but(lean=-6, neck=-8, look=(0, 28), pelvis=(0.0, 0.08, 0.0), jaw=10,
                  hand_r=(-0.5, -0.9, 3.9), hand_l=(0.5, -0.9, 3.9), pole_r=(-1.0, 0.0, -0.3), pole_l=(1.0, 0.0, -0.3),
                  hand_dir_r=_n((0.3, 0.3, -0.9)), hand_dir_l=_n((-0.3, 0.3, -0.9)), fist_l=1.0, fist_r=1.0)
    beat = rear.but(hand_r=(-0.35, -1.0, 3.75), hand_l=(0.35, -1.0, 3.75), lean=-2)
    bellow = st.but(lean=-12, neck=-18, look=(0, 34), jaw=36, pelvis=(0.0, 0.16, 0.02), clav_l=20, clav_r=20,
                    hand_r=(-1.7, -0.3, 3.4), hand_l=(1.7, -0.3, 3.4), pole_r=(-0.5, 0.8, -0.5),
                    pole_l=(0.5, 0.8, -0.5), fist_l=0.1, fist_r=0.4, spread_l=20)
    keys = [(0.0, st, 'inout'), (0.4, rear, 'in'), (0.55, beat, 'out'), (0.7, rear, 'in'), (0.85, beat, 'out'),
            (1.3, bellow, 'inout'), (1.7, bellow.but(look=(4, 30)), 'inout'), (2.2, st, 'linear')]
    return keyed(keys), 2.2


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=6, twist=12, pelvis=(0.0, 0.16, -0.14), look=(-10, 18), head_roll=-8, jaw=16,
                  hand_l=(1.4, 0.0, 2.6), hand_r=(-1.35, -0.2, 2.6))
    keys = [(0.0, st, 'out'), (0.14, jolt, 'out'), (0.3, jolt.but(lean=10), 'inout'), (0.66, st, 'linear')]
    return keyed(keys), 0.66


def death(rig):
    """He sags to his knees, sways, and falls face down on the ice. Knees 1.0, on the
    ice 1.85, still from 2.3."""
    st = stance(rig)
    sag = st.but(lean=6, neck=-6, look=(0, 24), jaw=24, pelvis=(0.0, 0.18, -0.2), hand_l=(1.5, -0.2, 2.8),
                 hand_dir_l=_n((0.4, 0.0, -0.9)), fist_l=0.2)
    kneel = st.but(pelvis=(0.0, 0.5, -1.4), lean=26, neck=20, look=(0, -10), hip_tilt=10,
                   foot_l=(0.6, 1.0, 0.24), fpitch_l=-60, foot_r=(-0.58, 1.1, 0.24), fpitch_r=-60,
                   knee_l=(0.3, -1.0, -0.4), knee_r=(-0.3, -1.0, -0.4),
                   hand_r=(-0.9, -1.2, 1.0), hand_l=(0.9, -1.2, 1.0), hand_dir_r=_n((0, -0.3, -1)),
                   hand_dir_l=_n((0, -0.3, -1)), fist_l=0.3, fist_r=0.7, jaw=16)
    down = st.but(pitch=80, pelvis=(0.0, 0.0, 0.25), lean=8, neck=-14, look=(28, 6), hip_tilt=-6,
                  foot_l=(0.62, 0.35, 0.3), fpitch_l=-55, foot_r=(-0.62, 0.5, 0.28), fpitch_r=-55,
                  knee_l=(0.3, 0.0, -1.0), knee_r=(-0.3, 0.0, -1.0),
                  hand_r=(-1.4, -3.0, 0.3), pole_r=(-0.4, 0.2, 1.0), hand_dir_r=_n((-0.2, -0.9, -0.3)),
                  hand_l=(1.6, -2.5, 0.3), pole_l=(0.4, 0.2, 1.0), hand_dir_l=_n((0.2, -0.9, -0.3)),
                  fist_l=0.4, fist_r=0.6, jaw=12)
    keys = [(0.0, st, 'out'), (0.4, sag, 'inout'), (1.0, kneel, 'out'), (1.3, kneel.but(lean=40), 'quadin'),
            (1.85, down, 'out'), (2.3, down.but(look=(30, 4)), 'hold'), (2.6, down.but(look=(30, 4)), 'hold')]
    return keyed(keys), 2.6


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 1.8), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.3), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.5, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('IceBlockToss', ice_block_toss, False),
    ('Enrage', enrage, False),
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
