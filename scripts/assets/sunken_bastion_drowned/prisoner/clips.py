"""Every clip the Shackled Prisoner ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage should land.
Starved, drowned and maddened: he stands hunched and twitching, the head thrust
forward on its stalk of a neck, the manacled arms hanging in front of him with the
claws working. He lurches when he walks, the left foot dragging its shackle. He
fights like a cornered animal: both manacled fists raised together and brought
down like a hammer (Attack), or a lunge to grab and claw at the throat (Attack2).

  Attack: the two fists hammered down. CONTACT 0.66.
  Attack2: the lunge and the claw. CONTACT 0.48.
  Kneel: Snapped Fetters, the chains broken and down on his knees (1.5 s one-shot).
  KneelLoop: held on his knees while the fetters' grace lasts (a 4 s loop).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.2, 0.45, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.7, 0.8, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.34, -0.04, SOLE)
FOOT_R = (-0.34, 0.1, SOLE)


def stance(rig):
    """Hunched and twitching, the head thrust forward, the manacled arms hanging in
    front, the claws half open."""
    return Body(rig, pelvis=(0.0, 0.1, -0.2), lean=34, neck=-22, look=(0, 6), hip_tilt=8,
                hand_r=(-0.45, -0.75, 2.05), pole_r=(-0.9, 0.6, -0.2), hand_dir_r=_n((0.1, -0.5, -0.85)),
                fist_r=0.35, spread_r=10,
                hand_l=(0.42, -0.72, 2.1), pole_l=(0.9, 0.6, -0.2), hand_dir_l=_n((-0.1, -0.5, -0.85)),
                fist_l=0.4, spread_l=10,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=12, fyaw_r=14,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), clav_l=6, clav_r=6)


# ------------------------------------------------------------------ loops
def idle(rig, period=4.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 3)                      # ragged breathing
        # sudden jerks of the head (a twitch twice a loop), the claws clenching
        twitch = math.sin(u * 2) ** 15
        return st.but(lean=st.p['lean'] + 1.5 * br, clav_l=6 + 2 * br, clav_r=6 + 2 * br,
                      look=(14 * math.sin(u) + 18 * twitch, 6 + 4 * math.sin(u * 2)),
                      head_roll=9 * math.sin(u) + 10 * twitch, jaw=6 * max(0.0, math.sin(u * 4)),
                      fist_l=0.4 + 0.4 * max(0.0, math.sin(u * 3)), fist_r=0.35 + 0.4 * max(0.0, math.sin(u * 3)),
                      pelvis=(0.03 * math.sin(u), 0.1, -0.2 - 0.01 * br), hip_roll=3 * math.sin(u))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The lurch: the right foot steps, the left drags its shackle (low, late), the
    body pitching over each step; running, a frantic loping scramble, arms out."""
    st = stance(rig)
    if run:
        st = st.but(lean=42, hand_r=(-0.55, -0.85, 2.3), hand_l=(0.55, -0.82, 2.35))

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift * (0.6 if not run else 1.0), 1, 0.34,
                                 heel_roll=8, toe_up=2)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.34, heel_roll=16, toe_up=6)
        s1 = math.sin(TAU * ph)
        c2 = math.cos(TAU * ph * 2)
        bob = (-0.26 if run else -0.22) + (0.07 if run else 0.04) * math.cos(TAU * (ph * 2 - 0.1))
        lurch = 0.0 if run else 6 * max(0.0, -s1)          # the body pitches over the dragged foot
        sw = (0.25 if run else 0.12) * s1
        return st.but(pelvis=(0.05 * s1, 0.1, bob), hip_twist=-8 * s1, hip_roll=6 * s1, side=6 * s1 + lurch * 0.5,
                      lean=st.p['lean'] + 3 * c2 + lurch, twist=7 * s1, look=(-6 * s1, 6), head_roll=-6 * s1,
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=12, fyaw_r=14,
                      hand_r=(st.p['hand_r'][0], st.p['hand_r'][1] + sw, st.p['hand_r'][2] + abs(sw) * 0.3),
                      hand_l=(st.p['hand_l'][0], st.p['hand_l'][1] - sw, st.p['hand_l'][2] + abs(sw) * 0.3))
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """Both manacled fists raised together over the head and hammered down on you.
    CONTACT 0.66."""
    st = stance(rig)
    up = st.but(lean=-4, neck=-10, look=(0, 22), pelvis=(0.0, 0.14, -0.08), jaw=24,
                hand_r=(-0.12, -0.55, 4.1), pole_r=(-1.0, 0.2, 0.1), hand_dir_r=_n((0.2, -0.6, 0.75)), fist_r=1.0,
                hand_l=(0.12, -0.55, 4.1), pole_l=(1.0, 0.2, 0.1), hand_dir_l=_n((-0.2, -0.6, 0.75)), fist_l=1.0,
                clav_l=16, clav_r=16, foot_l=(0.34, -0.3, SOLE + 0.1), fpitch_l=6)
    apex = up.but(lean=-8, hand_r=(-0.12, -0.5, 4.25), hand_l=(0.12, -0.5, 4.25))
    slam = st.but(lean=46, neck=-12, look=(0, -8), pelvis=(0.0, -0.2, -0.42), jaw=14,
                  hand_r=(-0.12, -1.1, 2.35), pole_r=(-1.0, 0.2, 0.0), hand_dir_r=_n((0.2, -0.85, -0.45)), fist_r=1.0,
                  hand_l=(0.12, -1.1, 2.35), pole_l=(1.0, 0.2, 0.0), hand_dir_l=_n((-0.2, -0.85, -0.45)), fist_l=1.0,
                  foot_l=(0.34, -0.46, SOLE), knee_l=(0.2, -1.0, 0.1))
    lift = st.but(lean=16, hand_r=(-0.22, -0.78, 3.2), pole_r=(-1.0, 0.3, 0.0), hand_dir_r=_n((0.2, -0.3, 0.9)),
                  hand_l=(0.22, -0.78, 3.2), pole_l=(1.0, 0.3, 0.0), hand_dir_l=_n((-0.2, -0.3, 0.9)),
                  fist_r=0.9, fist_l=0.9, jaw=14)
    keys = [(0.0, st, 'inout'), (0.2, lift, 'linear'), (0.34, up, 'out'), (0.46, apex, 'in'), (0.66, slam, 'out'),
            (0.88, slam.but(lean=44), 'inout'), (1.3, st, 'linear')]
    return keyed(keys), 1.3


def attack2(rig):
    """A lunge: he gathers, springs forward and claws at the throat with both hands,
    then drags back. CONTACT 0.48."""
    st = stance(rig)
    gather = st.but(lean=40, pelvis=(0.0, 0.22, -0.32), look=(0, 14), jaw=10,
                    hand_r=(-0.4, -0.45, 2.25), hand_l=(0.4, -0.45, 2.3), fist_r=0.2, fist_l=0.2, spread_r=20,
                    spread_l=20, foot_r=(-0.34, 0.24, SOLE))
    lunge = st.but(lean=30, neck=-26, look=(0, 10), pelvis=(0.0, -0.32, -0.2), jaw=30,
                   hand_r=(-0.22, -1.35, 3.0), pole_r=(-0.9, 0.2, -0.3), hand_dir_r=_n((0.2, -0.9, 0.35)),
                   hand_l=(0.22, -1.35, 3.05), pole_l=(0.9, 0.2, -0.3), hand_dir_l=_n((-0.2, -0.9, 0.35)),
                   fist_r=0.1, fist_l=0.1, spread_r=24, spread_l=24, foot_l=(0.34, -0.6, SOLE),
                   knee_l=(0.2, -1.0, 0.1), foot_r=(-0.34, 0.3, SOLE + 0.04), fpitch_r=-20)
    rake = lunge.but(hand_r=(-0.2, -1.2, 2.55), hand_l=(0.2, -1.2, 2.6), fist_r=0.8, fist_l=0.8, lean=36)
    keys = [(0.0, st, 'inout'), (0.3, gather, 'expoin'), (0.48, lunge, 'out'), (0.66, rake, 'inout'),
            (0.95, gather.but(foot_l=(0.34, -0.4, SOLE)), 'inout'), (1.3, st, 'linear')]
    return keyed(keys), 1.3


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=20, twist=14, pelvis=(0.0, 0.2, -0.16), look=(-12, 20), head_roll=-12, jaw=22,
                  hand_r=(-0.6, -0.4, 2.4), hand_l=(0.55, -0.5, 2.5), fist_r=0.1, fist_l=0.1)
    keys = [(0.0, st, 'out'), (0.11, jolt, 'out'), (0.25, jolt.but(lean=26), 'inout'), (0.55, st, 'linear')]
    return keyed(keys), 0.55


def death(rig):
    """The sea takes him back: he claws at the collar, his legs go, he drops to his
    knees and topples onto his side, curling up. Down at 1.4, still from 1.8."""
    st = stance(rig)
    claw = st.but(lean=10, neck=-6, look=(0, 24), pelvis=(0.0, 0.16, -0.16), jaw=30,
                  hand_r=(-0.12, -0.42, 3.45), hand_dir_r=_n((0.5, -0.2, 0.7)), fist_r=0.7,
                  hand_l=(0.12, -0.42, 3.42), hand_dir_l=_n((-0.5, -0.2, 0.7)), fist_l=0.7)
    knees = st.but(pelvis=(0.0, 0.3, -1.15), lean=30, neck=-6, look=(0, -4), hip_tilt=8,
                   foot_l=(0.34, 0.7, 0.24), fpitch_l=-48, foot_r=(-0.34, 0.8, 0.24), fpitch_r=-48,
                   knee_l=(0.2, -1.0, -0.4), knee_r=(-0.2, -1.0, -0.4),
                   hand_r=(-0.3, -0.7, 1.6), hand_l=(0.3, -0.7, 1.6), jaw=20)
    down = st.but(roll=-84, pelvis=(0.0, 0.0, 0.0), lean=40, neck=10, look=(-14, -10),
                  foot_l=(0.3, 0.45, 0.6), fpitch_l=-40, foot_r=(-0.3, 0.55, 0.45), fpitch_r=-40,
                  knee_l=(0.2, -1.0, -0.4), knee_r=(-0.2, -1.0, -0.4),
                  hand_r=(-0.25, -0.85, 2.6), pole_r=(-0.9, 0.3, -0.3), hand_l=(0.2, -0.9, 2.5), fist_r=0.6, fist_l=0.5,
                  jaw=12)
    keys = [(0.0, st, 'out'), (0.3, claw, 'inout'), (0.75, knees, 'out'), (1.0, knees.but(lean=36), 'quadin'),
            (1.4, down, 'out'), (1.8, down.but(look=(-16, -12)), 'hold'), (2.1, down.but(look=(-16, -12)), 'hold')]
    return keyed(keys), 2.1


def _kneeling(rig, breath=0.0, sway=0.0):
    """Down on both knees, the shins flat behind him, the head bowed and the freed
    hands loose on his thighs (the Death clip's knees, sat upright)."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.32, -1.15 - 0.012 * breath), lean=14 + 1.6 * breath, neck=8,
                  look=(5 * sway, -30), head_roll=3 * sway, hip_tilt=6, hip_roll=1.2 * sway,
                  foot_l=(0.34, 0.72, 0.24), fpitch_l=-48, foot_r=(-0.34, 0.8, 0.24), fpitch_r=-48,
                  fyaw_l=6, fyaw_r=8, knee_l=(0.2, -1.0, -0.4), knee_r=(-0.2, -1.0, -0.4),
                  hand_r=(-0.42, -0.5, 1.16), pole_r=(-0.9, 0.5, 0.0), hand_dir_r=_n((0.05, -0.55, -0.8)),
                  fist_r=0.15, spread_r=6,
                  hand_l=(0.42, -0.48, 1.18), pole_l=(0.9, 0.5, 0.0), hand_dir_l=_n((-0.05, -0.55, -0.8)),
                  fist_l=0.15, spread_l=6,
                  jaw=3, clav_l=2 + 2 * breath, clav_r=2 + 2 * breath)


def kneel(rig):
    """Snapped Fetters: the chains break (the arms flung wide, the head thrown back
    with a gasp), the madness goes out of him, he sags and drops to his knees, the
    head bowed. Down at 1.0, settled (KneelLoop's pose) at 1.5."""
    st = stance(rig)
    snap = st.but(lean=-6, neck=-6, look=(0, 28), pelvis=(0.0, 0.12, -0.12), jaw=30, head_roll=0,
                  hand_r=(-1.5, -0.35, 3.1), pole_r=(-0.6, 0.8, -0.3), hand_dir_r=_n((-0.6, -0.2, 0.3)),
                  fist_r=0.0, spread_r=26,
                  hand_l=(1.5, -0.35, 3.1), pole_l=(0.6, 0.8, -0.3), hand_dir_l=_n((0.6, -0.2, 0.3)),
                  fist_l=0.0, spread_l=26, clav_l=14, clav_r=14)
    flung = snap.but(look=(0, 32), hand_r=(-1.58, -0.3, 3.22), hand_l=(1.58, -0.3, 3.22), jaw=26)
    sag = st.but(lean=28, neck=-24, look=(0, -10), pelvis=(0.0, 0.22, -0.5), jaw=8,
                 hand_r=(-0.55, -0.55, 1.75), hand_dir_r=_n((0.0, -0.3, -0.95)), fist_r=0.1,
                 hand_l=(0.55, -0.55, 1.78), hand_dir_l=_n((0.0, -0.3, -0.95)), fist_l=0.1,
                 knee_l=(0.2, -1.0, -0.1), knee_r=(-0.2, -1.0, -0.1))
    down = _kneeling(rig).but(lean=22, neck=0)
    keys = [(0.0, st, 'out'), (0.14, snap, 'out'), (0.34, flung, 'inout'), (0.72, sag, 'in'),
            (1.0, down, 'out'), (1.5, _kneeling(rig), 'linear')]
    return keyed(keys), 1.5


def kneel_loop(rig, period=4.0):
    """Held on his knees while the fetters' grace lasts: slow breaths, the bowed head
    swaying a little."""
    def fn(t):
        u = TAU * t / period
        return _kneeling(rig, breath=math.sin(u * 2), sway=math.sin(u))
    return fn


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.22), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.36, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Hit', hit, False),
    ('Death', death, False),
    ('Kneel', kneel, False),
    ('KneelLoop', lambda r: (kneel_loop(r), 4.0), True),
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
