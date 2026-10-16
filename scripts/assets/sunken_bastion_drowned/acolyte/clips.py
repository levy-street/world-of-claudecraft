"""Every clip the Tidebound Acolyte ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage should land.
He is a priest of the tide and carries himself like one: upright and slow, the
coral staff planted at his right side, the conch held to his belly in the left
hand, the cowled head a little bowed, murmuring the hymn. He walks in a slow
processional step, the staff swinging with it. He fights with the staff: a
two-handed blow brought down from over his shoulder, and a flat sweep of its coral crown.
The Brine Mend is the conch lifted high over his head and tipped, the staff raised
in the other hand, the head thrown back, chanting (a loop over the 2.5 s bar).

  Attack: the staff brought down two-handed. CONTACT 0.66.
  Attack2: the staff swept flat across, the coral crown leading. CONTACT 0.58.
  Mend (Brine Mend's bar): loops, the conch tipped and the staff swayed, 1.25 s a loop.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.5, 0.5, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.8, 0.82, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.3, -0.06, SOLE)
FOOT_R = (-0.3, 0.08, SOLE)
PLANTED = _n((-0.08, -0.12, 0.99))
HOLD_ROLL = 80.0


def stance(rig):
    """Upright and still, the staff planted at his right side, the conch held to his
    belly, the cowled head bowed a little over the hymn."""
    return Body(rig, pelvis=(0.0, 0.0, -0.06), lean=4, neck=12, look=(0, -6),
                hand_r=(-0.8, -0.42, 2.5), pole_r=(-0.8, 0.6, -0.4), weapon=PLANTED,
                hand_l=(0.4, -0.78, 2.66), pole_l=(0.9, 0.5, -0.4), hand_dir_l=_n((-0.3, -0.85, 0.2)),
                hand_roll_l=HOLD_ROLL, fist_l=0.6,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=6, fyaw_r=8,
                knee_l=(0.15, -1.0, 0.0), knee_r=(-0.15, -1.0, 0.0))


def mend_pose(rig, u):
    """The conch held high and tipped, the staff raised, the head thrown back."""
    st = stance(rig)
    sway = math.sin(u)
    return st.but(lean=-6 - 2 * sway, neck=-14, look=(4 * math.cos(u), 22 + 3 * sway), pelvis=(0.0, 0.04, -0.04),
                  hand_l=(0.5 + 0.04 * math.cos(u), -0.35, 4.55 + 0.05 * sway), pole_l=(1.0, 0.0, 0.1),
                  hand_dir_l=_n((-0.5 + 0.15 * sway, -0.3, 0.8)), fist_l=0.7,
                  hand_r=(-0.66, -0.4, 3.3 + 0.05 * math.cos(u)), pole_r=(-1.0, 0.3, -0.2),
                  weapon=_n((-0.15 + 0.06 * math.cos(u), -0.2, 0.97)), clav_l=10, clav_r=4,
                  jaw=8 + 6 * max(0.0, math.sin(u * 2)))


# ------------------------------------------------------------------ loops
def idle(rig, period=5.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        # the hymn under his breath, the head swaying with it, the conch rising a little
        return st.but(lean=st.p['lean'] + 0.8 * br, look=(6 * math.sin(u), -6 + 3 * math.sin(u * 2)),
                      head_roll=4 * math.sin(u), jaw=4 * max(0.0, math.sin(u * 6)),
                      hand_l=(0.4, -0.78, 2.66 + 0.04 * math.sin(u * 2)),
                      pelvis=(0.012 * math.sin(u), 0.0, -0.06 - 0.006 * (1 - math.cos(u * 2)) / 2))
    return fn


def mend_loop(rig, period=1.25):
    def fn(t):
        return M.aim_weapon(mend_pose(rig, TAU * t / period))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The processional walk: a slow even step, the staff swung forward with the
    right foot, the conch held steady; running, the robe hitched, the staff carried
    across the body."""
    base = stance(rig)
    if run:
        base = base.but(hand_r=(-0.55, -0.55, 2.7), weapon=_n((0.55, -0.25, 0.8)), lean=16)
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.3, heel_roll=16, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.3, heel_roll=16, toe_up=6)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.16 if run else -0.08) + (0.06 if run else 0.03) * math.cos(TAU * (ph * 2 - 0.1))
        sw = (0.1 if run else 0.2) * s1
        return st.but(pelvis=(0.025 * s1, 0.0, bob), hip_twist=-6 * s1, hip_roll=3 * s1,
                      lean=st.p['lean'] + 1.5 * c2, twist=4 * s1, look=(-3 * s1, -6),
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=8,
                      hand_r=(st.p['hand_r'][0], st.p['hand_r'][1] + sw, st.p['hand_r'][2] + abs(sw) * 0.2))
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """Both hands on the staff, raised over the right shoulder, brought down hard in
    front of him. CONTACT 0.66."""
    st = stance(rig)
    take = st.but(lean=6, twist=-10, hand_r=(-0.5, -0.5, 2.9), pole_r=(-0.9, 0.3, -0.4),
                  weapon=_n((0.3, -0.3, 0.9)), grip_l=0.6, grip_w=1.0, pole_l=(0.9, 0.3, -0.5), fist_l=0.9)
    up = take.but(lean=-8, neck=0, look=(6, 16), twist=-24, pelvis=(0.03, 0.1, -0.04),
                  hand_r=(-0.5, 0.0, 4.3), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.25, 0.75, 0.6)),
                  pole_l=(1.0, -0.2, 0.3), clav_l=10, clav_r=12, foot_l=(0.32, -0.28, SOLE))
    fall = take.but(lean=10, twist=-4, pelvis=(0.0, -0.06, -0.14), hand_r=(-0.25, -0.72, 3.9),
                    pole_r=(-1.0, -0.2, 0.0), weapon=_n((0.1, -0.2, 0.97)), foot_l=(0.32, -0.42, SOLE))
    hit = take.but(lean=30, neck=14, look=(-2, -16), twist=6, pelvis=(0.0, -0.2, -0.36),
                   hand_r=(-0.15, -1.05, 2.55), pole_r=(-0.9, 0.2, -0.4), weapon=_n((0.1, -0.88, -0.45)),
                   foot_l=(0.32, -0.5, SOLE), knee_l=(0.2, -1.0, 0.1))
    keys = [(0.0, st, 'inout'), (0.24, take, 'inout'), (0.48, up, 'out'), (0.58, fall, 'in'), (0.66, hit, 'out'),
            (0.92, hit.but(lean=28), 'inout'), (1.2, take, 'inout'), (1.5, st, 'linear')]
    return keyed(keys), 1.5


def _a2(rig):
    st = stance(rig)
    load = st.but(twist=-28, lean=6, pelvis=(0.03, 0.06, -0.1), look=(12, -2),
                  hand_r=(-0.85, -0.1, 2.85), pole_r=(-0.5, 0.6, -0.8), weapon=_n((-0.98, 0.17, 0.0)),
                  hand_l=(0.4, -0.5, 2.7), fist_l=0.7)
    swing = st.but(twist=26, lean=14, pelvis=(-0.03, -0.1, -0.16), look=(-10, -4),
                   hand_r=(-0.1, -0.95, 2.8), pole_r=(-0.6, 0.0, -0.8), weapon=_n((0.0, -1.0, 0.0)),
                   hand_l=(0.6, 0.0, 2.55), fist_l=0.6, foot_l=(0.32, -0.3, SOLE))
    return st, load, swing


def attack2(rig):
    """The staff swung flat across from his right, the coral crown leading, at the
    ribs. CONTACT 0.58."""
    st, load, swing = _a2(rig)
    follow = swing.but(twist=32, hand_r=(0.2, -0.85, 2.75), weapon=_n((0.44, -0.9, 0.0)))
    keys = [(0.0, st, 'inout'), (0.36, load, 'expoin'), (0.58, swing, 'out'), (0.8, follow, 'inout'),
            (1.3, st, 'linear')]
    return keyed(keys), 1.3


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-6, twist=10, pelvis=(0.0, 0.12, -0.08), look=(-8, 12), head_roll=-6, jaw=12)
    keys = [(0.0, st, 'out'), (0.12, jolt, 'out'), (0.26, jolt.but(lean=-2), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """The tide lets go of him: he clutches the conch to his breast, staggers back,
    his knees fold and he falls back onto the stones, the staff rolling from his
    hand. Down at 1.45, still from 1.9."""
    st = stance(rig)
    clutch = st.but(lean=-10, neck=-6, look=(0, 20), pelvis=(0.0, 0.18, -0.08), jaw=20,
                    hand_l=(0.15, -0.45, 3.1), hand_dir_l=_n((-0.7, -0.3, 0.4)), fist_l=0.9,
                    foot_r=(-0.3, 0.42, SOLE), fyaw_r=16)
    sag = clutch.but(pelvis=(0.0, 0.5, -0.9), lean=8, neck=10, look=(4, 6),
                     foot_l=(0.32, -0.2, SOLE), knee_l=(0.2, -1.0, 0.2), knee_r=(-0.2, -1.0, 0.2),
                     hand_r=(-0.9, -0.2, 1.8), weapon=_n((-0.6, -0.3, 0.74)))
    down = st.but(pitch=-80, pelvis=(0.0, 0.0, 0.0), lean=-6, neck=-8, look=(18, 10), hip_tilt=0,
                  foot_l=(0.34, -0.3, 0.3), fpitch_l=40, foot_r=(-0.36, -0.2, 0.3), fpitch_r=40,
                  knee_l=(0.2, 0.0, 1.0), knee_r=(-0.2, 0.0, 1.0),
                  hand_l=(0.25, -0.5, 3.05), hand_dir_l=_n((-0.6, -0.4, 0.4)), fist_l=0.6,
                  hand_r=(-1.1, 0.3, 2.6), pole_r=(-0.5, -0.2, -1.0), weapon=_n((-0.95, 0.3, 0.0)))
    keys = [(0.0, st, 'out'), (0.3, clutch, 'inout'), (0.8, sag, 'quadin'), (1.45, down, 'out'),
            (1.9, down.but(look=(20, 8)), 'hold'), (2.2, down.but(look=(20, 8)), 'hold')]
    return keyed(keys), 2.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.2), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.36, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Mend', lambda r: (mend_loop(r), 1.25), True),
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
