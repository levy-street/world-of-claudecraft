"""Every clip the Drowned Sergeant ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
Every blow: READY (the stance), ANTICIPATION (the weight loads the other way), APEX,
the STRIKE accelerating into contact ('in'), IMPACT jolt, HOLD, RECOVERY ('out')
back to the stance, so every one-shot opens and closes on Idle's first frame.

He is the wall's sergeant and still carries himself like it: chest out, chin up,
feet planted wide, the boarding axe shouldered and the left fist on his hip. He
looks his men over, not the floor. He walks with the swagger of the man in charge
and swings the axe with his whole weight: a cleave down off the shoulder, a two-
handed overhead chop. Rally (Rally the Watch) thrusts the axe high and beats his
breastplate with his fist.

  Attack: off the shoulder, a diagonal cleave down to his left. CONTACT 0.74.
  Attack2: both hands up over the helm, a straight chop down. CONTACT 0.86.
  Rally: the axe thrust overhead, two blows of the fist on the breast (0.95, 1.3).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.5, 0.66, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.84, 0.92, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


DOWN_ROLL = 80
FOOT_L = (0.42, -0.08, SOLE)
FOOT_R = (-0.42, 0.12, SOLE)
SHOULDERED = _n((-0.12, 0.5, 0.86))


def stance(rig):
    """At ease the sergeant's way: planted wide, the chest out and the chin up, the
    axe shouldered (the haft on the right pauldron, the head behind it), the left
    fist on the hip with the elbow out."""
    return Body(rig, pelvis=(0.0, 0.0, -0.05), lean=-2, neck=-2, look=(0, 4), hip_tilt=-2,
                hand_r=(-0.44, -0.46, 3.0), pole_r=(-0.9, 0.2, -0.5), weapon=SHOULDERED,
                hand_l=(0.62, 0.02, 2.56), pole_l=(1.0, 0.4, 0.1), hand_dir_l=_n((-0.6, 0.2, -0.75)),
                fist_l=0.95,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=14, fyaw_r=16,
                knee_l=(0.3, -1.0, 0.0), knee_r=(-0.3, -1.0, 0.0), clav_l=-2, clav_r=-2)


def guard(rig):
    """The fight: lower and wider, the axe down off the shoulder into both hands,
    the head of it raised across the body, the helm forward."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.06, -0.2), lean=12, neck=6, look=(0, -4), twist=-10,
                  hand_r=(-0.4, -0.62, 2.62), pole_r=(-0.9, 0.3, -0.5), weapon=_n((0.45, -0.3, 0.84)),
                  grip_l=0.62, grip_w=1.0, pole_l=(0.9, 0.2, -0.5), fist_l=0.9,
                  foot_l=(0.48, -0.32, SOLE), foot_r=(-0.44, 0.36, SOLE), fyaw_l=6, fyaw_r=24)


# ------------------------------------------------------------------ loops
def idle(rig, period=5.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)               # two deep breaths a loop, the chest swelling
        # he looks his line over: slowly to his left, back, and to his right
        scan = 16 * math.sin(u) * smooth(abs(math.sin(u)) * 1.5)
        return st.but(lean=st.p['lean'] - 1.5 * br, clav_l=2.0 * br, clav_r=2.0 * br,
                      look=(scan, 4 + 2 * math.sin(u * 2 + 0.6)), neck=-2 + 1.5 * math.sin(u * 2),
                      pelvis=(0.015 * math.sin(u), 0.0, -0.05 - 0.008 * (1 - math.cos(u * 2)) / 2),
                      hip_roll=1.5 * math.sin(u), twist=3 * math.sin(u))
    return fn


def combat_idle(rig, period=2.2):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * br, pelvis=(0.0, 0.06, -0.2 - 0.02 * (1 - math.cos(u)) / 2),
                     hand_r=(-0.4, -0.62, 2.62 + 0.03 * br), look=(4 * math.sin(u), -4), clav_l=1.5 * br,
                     clav_r=1.5 * br, twist=-10 + 2 * br)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """Walk: the swagger, the axe on the shoulder, the shoulders rolling with each
    step, the free arm swinging wide. Run: the axe down in the fist, low and heavy."""
    base = stance(rig)
    if run:
        base = base.but(hand_r=(-0.78, -0.36, 2.4), pole_r=(-0.6, 0.8, -0.3), weapon=_n((0.2, -0.75, 0.62)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.4)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.4)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        al = -(0.55 if run else 0.42) * s1
        if run:
            bob = -0.2 + 0.08 * math.cos(TAU * (ph * 2 - 0.15))
            lean, look = 18, (-3 * s1, -2)
        else:
            bob = -0.08 + 0.05 * math.cos(TAU * (ph * 2 - 0.1))
            lean, look = 1, (-4 * s1, 3)
        return st.but(
            pelvis=(0.04 * s1, 0.0, bob), hip_twist=-9 * s1, hip_roll=4.5 * s1,
            lean=lean + 2.5 * c2, twist=9 * s1, side=2.5 * s1, look=look,
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=10, fyaw_r=12,
            hand_l=(0.78, -0.06 + al * 0.9, 2.42 + abs(al) * 0.28 + (0.12 if run else 0)),
            hand_dir_l=_n((0.15, -0.1 + al * 0.7, -1.0)), pole_l=(0.5, 1.0, -0.3), fist_l=0.85,
            clav_r=2 * s1, clav_l=-2 * s1)
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """Off the shoulder: the axe heaved up and back over the right shoulder, then a
    diagonal cleave down across to his left knee, the whole weight behind it, the
    left fist flung back. CONTACT 0.74."""
    st = stance(rig)
    load = st.but(twist=-26, lean=-6, side=-5, pelvis=(0.04, 0.1, -0.08), look=(10, 6),
                  hand_r=(-0.7, 0.05, 4.05), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.1, 0.65, 0.75)),
                  hand_l=(0.75, -0.45, 2.85), pole_l=(0.8, 0.5, -0.4), hand_dir_l=_n((0.2, -0.8, -0.4)), fist_l=0.9,
                  clav_r=12, foot_l=(0.44, -0.24, SOLE), fyaw_l=6)
    apex = load.but(twist=-30, lean=-8, hand_r=(-0.66, 0.1, 4.2), weapon=_n((0.05, 0.75, 0.66)))
    over = st.but(twist=-4, lean=10, side=0, pelvis=(0.0, -0.04, -0.16), look=(2, -2),
                  hand_r=(-0.42, -0.62, 3.95), pole_r=(-1.0, -0.2, -0.2), weapon=_n((0.2, -0.45, 0.87)),
                  hand_l=(0.82, 0.0, 2.6), hand_dir_l=_n((0.3, 0.1, -0.9)), fist_l=0.8,
                  foot_l=(0.46, -0.3, SOLE), fyaw_l=6)
    hit = st.but(twist=28, lean=28, side=5, pelvis=(-0.04, -0.16, -0.3), look=(-6, -12),
                 hand_r=(0.18, -1.02, 2.3), pole_r=(-0.6, -0.4, -0.6), weapon=_n((0.55, -0.7, -0.45)),
                 hand_l=(0.88, 0.32, 2.5), pole_l=(0.6, 1.0, 0.0), hand_dir_l=_n((0.3, 0.5, -0.8)), fist_l=0.8,
                 foot_l=(0.46, -0.36, SOLE), fyaw_l=6)
    follow = hit.but(hand_r=(0.38, -0.86, 2.08), pole_r=(-0.7, 0.2, -0.6), weapon=_n((0.72, -0.4, -0.57)),
                     twist=32, lean=30)
    keys = [(0.0, st, 'inout'), (0.38, load, 'out'), (0.54, apex, 'in'), (0.64, over, 'linear'), (0.74, hit, 'out'),
            (0.88, follow, 'auto'), (1.08, follow.but(lean=29), 'inout'), (1.6, st, 'linear')]
    return keyed(keys), 1.6


def attack2(rig):
    """Both hands on the haft, the axe hauled up over the helm, a straight chop down
    in front of him, the knees giving with it. CONTACT 0.86."""
    st = stance(rig)
    take = st.but(lean=6, twist=-6, hand_r=(-0.36, -0.6, 3.15), pole_r=(-0.9, 0.2, -0.5), weapon=_n((0.3, -0.2, 0.93)),
                  grip_l=0.6, grip_w=1.0, pole_l=(0.9, 0.2, -0.5), fist_l=0.9)
    up = take.but(lean=-10, neck=-6, look=(0, 12), pelvis=(0.0, 0.1, -0.02), twist=0,
                  hand_r=(-0.12, -0.05, 4.62), pole_r=(-1.0, -0.2, 0.3), weapon=_n((0.05, 0.85, 0.52)),
                  pole_l=(1.0, -0.2, 0.3), clav_l=12, clav_r=12, foot_l=(0.44, -0.3, SOLE + 0.14), fpitch_l=6)
    apex = up.but(lean=-12, weapon=_n((0.05, 0.95, 0.3)), hand_r=(-0.1, 0.0, 4.7))
    fall = take.but(lean=8, pelvis=(0.0, -0.06, -0.18), hand_r=(-0.12, -0.75, 4.2), pole_r=(-1.0, -0.2, 0.0),
                    weapon=_n((-0.1, -0.1, 0.99)), foot_l=(0.46, -0.48, SOLE + 0.04))
    chop = take.but(lean=32, neck=10, look=(0, -14), pelvis=(0.0, -0.22, -0.42), twist=0,
                    hand_r=(-0.1, -1.1, 2.55), pole_r=(-0.9, 0.2, -0.4), weapon=_n((0.05, -0.85, -0.52)),
                    pole_l=(0.9, 0.2, -0.4), foot_l=(0.46, -0.52, SOLE), knee_l=(0.3, -1.0, 0.1),
                    knee_r=(-0.3, -1.0, 0.1))
    keys = [(0.0, st, 'inout'), (0.26, take, 'inout'), (0.58, up, 'out'), (0.7, apex, 'in'), (0.79, fall, 'linear'),
            (0.86, chop, 'out'), (1.14, chop.but(lean=30), 'inout'), (1.5, take.but(foot_l=(0.46, -0.48, SOLE)), 'inout'),
            (1.85, st, 'linear')]
    return keyed(keys), 1.85


def rally(rig):
    """Rally the Watch: he plants his feet, thrusts the axe up overhead at arm's
    length, throws his head back, beats his breastplate twice with the left fist
    (0.95 and 1.3) and lowers the axe back onto his shoulder."""
    st = stance(rig)
    gather = st.but(lean=6, pelvis=(0.0, 0.04, -0.14), look=(0, -6), hand_r=(-0.5, -0.5, 3.2),
                    weapon=_n((0.0, 0.2, 0.98)), foot_l=(0.5, -0.12, SOLE), foot_r=(-0.5, 0.14, SOLE))
    high = gather.but(lean=-12, neck=-14, look=(0, 22), pelvis=(0.0, 0.02, -0.06), clav_r=16, clav_l=6,
                      hand_r=(-0.62, -0.25, 5.0), pole_r=(-1.0, 0.0, 0.2), weapon=_n((0.05, -0.1, 0.99)),
                      hand_l=(0.36, -0.52, 3.2), pole_l=(1.0, 0.0, -0.4), hand_dir_l=_n((-0.6, -0.3, 0.2)),
                      fist_l=1.0)
    pull = high.but(hand_l=(0.62, -0.62, 3.42), hand_dir_l=_n((-0.3, -0.5, 0.4)), lean=-10)
    beat = high.but(hand_l=(0.26, -0.42, 3.15), lean=-13, jaw=20)
    keys = [(0.0, st, 'inout'), (0.3, gather, 'inout'), (0.62, high, 'out'), (0.8, pull, 'in'), (0.95, beat, 'out'),
            (1.12, pull, 'in'), (1.3, beat, 'out'), (1.75, high.but(look=(0, 18)), 'inout'), (2.3, st, 'linear')]
    return keyed(keys), 2.3


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-8, twist=12, pelvis=(0.0, 0.12, -0.08), look=(-8, 14), head_roll=-6,
                  hand_l=(0.8, 0.2, 2.6), hand_dir_l=_n((0.3, 0.4, -0.8)), fist_l=0.6)
    keys = [(0.0, st, 'out'), (0.12, jolt, 'out'), (0.26, jolt.but(lean=-4), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """He will not go down at once: struck, he reels, drops to his right knee with
    the axe head planted on the stones and both fists on the haft, holds there a
    beat (0.75 to 1.3) and then topples over onto his left side. Down at 2.0, still
    from 2.3."""
    st = stance(rig)
    reel = st.but(lean=-12, pelvis=(0.0, 0.2, -0.06), look=(6, 18), twist=12,
                  hand_l=(0.95, 0.15, 2.7), hand_dir_l=_n((0.4, 0.2, -0.8)), fist_l=0.3,
                  foot_r=(-0.42, 0.36, SOLE), fyaw_r=20)
    kneel = st.but(pelvis=(0.0, 0.2, -0.95), lean=18, neck=14, look=(0, -16), hip_tilt=-6,
                   foot_l=(0.44, -0.42, SOLE), fpitch_l=0, knee_l=(0.3, -1.0, 0.1),
                   foot_r=(-0.42, 0.8, 0.24), fpitch_r=-48, knee_r=(-0.2, -1.0, -0.4),
                   hand_r=(-0.3, -0.85, 2.15), pole_r=(-0.9, 0.3, -0.4), weapon=_n((0.05, -0.15, -0.99)),
                   grip_l=0.3, grip_w=1.0, pole_l=(0.9, 0.3, -0.4), fist_l=0.9)
    sag = kneel.but(lean=26, neck=20, look=(4, -24), pelvis=(0.0, 0.22, -1.0))
    tip = sag.but(roll=24, lean=22, grip_w=0.0,
                  hand_l=(1.05, -0.3, 1.7), hand_dir_l=_n((0.5, -0.3, -0.8)), fist_l=0.3, pole_l=(0.4, 1.0, 0.0),
                  hand_r=(-0.5, -0.9, 1.9), weapon=_n((0.4, -0.5, -0.77)))
    down = st.but(roll=DOWN_ROLL, pelvis=(0.0, 0.0, 0.0), lean=12, neck=6, look=(10, -8), hip_tilt=0,
                  foot_l=(0.46, -0.25, 0.25), fpitch_l=-20, foot_r=(-0.4, 0.15, 0.3), fpitch_r=-20,
                  knee_l=(0.3, -1.0, 0.0), knee_r=(-0.3, -1.0, 0.0),
                  hand_r=(-0.8, -1.0, 2.0), pole_r=(-0.9, 0.3, -0.2), weapon=_n((0.3, -0.95, 0.0)),
                  hand_l=(1.05, -0.3, 1.7), hand_dir_l=_n((0.5, -0.3, -0.8)), pole_l=(0.4, 1.0, 0.0),
                  fist_l=0.4, grip_w=0.0)
    keys = [(0.0, st, 'out'), (0.3, reel, 'inout'), (0.75, kneel, 'out'), (1.05, sag, 'inout'), (1.3, sag, 'quadin'),
            (1.55, tip, 'inout'), (1.98, down, 'out'), (2.3, down.but(look=(12, -6)), 'hold'),
            (2.6, down.but(look=(12, -6)), 'hold')]
    return keyed(keys), 2.6


CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.2), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.26), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.42, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Hit', hit, False),
    ('Death', death, False),
    ('Rally', rally, False),
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
