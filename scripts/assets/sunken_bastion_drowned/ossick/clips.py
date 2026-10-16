"""Every clip Gaoler Ossick ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
A hulking drowned gaoler who carries his bulk like an ape: hunched over, the
hump of his shoulders up past his ears, the caged head thrust forward and
looking up from under the brank, the cudgel hanging from his right fist almost
to the flags and the left fist hanging empty beside the shackles at his hip.
He breathes like a bellows. He lumbers when he walks, rolling from foot to foot.

His blows: the cudgel swung across from his right shoulder (Attack), the left
fist and its manacle hammered down (Attack2). His bars are bar-locked (the
release on the bar's end) and play their follow-through out after it:

  AnchorHurl (Drowned Anchor, 1.8 s bar): he reaches over his left shoulder for
    the anchor on his back (taken at 0.36), hauls it off and swings it round low
    beside him on its shank, whirls it up behind him and hurls it one-handed
    overarm, letting go at 1.8; the follow-through plays out to 2.6.
  ShackleHeave (Shackle Pair, 1.2 s bar): he thrusts the cudgel through his belt
    and snatches the shackles off his hip (0.2), swings them back low past his
    right hip in both fists and heaves them up and out across his front,
    letting go at 1.2; the follow-through and the cudgel drawn again play out
    to 2.05.
  CudgelSlam (Gaoler's Cudgel, 1.0 s bar): the cudgel hauled straight up over his
    head and brought down on the flags before him, the impact at 1.0; the
    recovery plays out to 1.75.

  Attack: CONTACT 0.72.  Attack2: CONTACT 0.55.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.7, 0.6, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.95, 0.78, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
HURL, HEAVE, SLAM = 1.8, 1.2, 1.0

# Which of the twin props shows: slung on him, or in a fist.
SLUNG = {'AnchorB': 1.0, 'AnchorH': 0.001, 'ShackleB': 1.0, 'ShackleH': 0.001, 'Weapon': 1.0, 'CudgelB': 0.001}
ANCHOR_OUT = dict(SLUNG, AnchorB=0.001, AnchorH=1.0)
ANCHOR_GONE = dict(SLUNG, AnchorB=0.001, AnchorH=0.001)
SHACKLE_OUT = dict(SLUNG, ShackleB=0.001, ShackleH=1.0, Weapon=0.001, CudgelB=1.0)
SHACKLE_GONE = dict(SLUNG, ShackleB=0.001, ShackleH=0.001, Weapon=0.001, CudgelB=1.0)
CUDGEL_BACK = dict(SLUNG, ShackleB=0.001)

def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.5, -0.1, SOLE)
FOOT_R = (-0.5, 0.12, SOLE)
HANGING = _n((0.1, -0.55, -0.83))


def stance(rig):
    """Hunched like an ape: the back bowed, the head thrust forward and looking up,
    the cudgel hanging low from the right fist, the left fist hanging, the knees
    bent under the weight, the feet wide."""
    return Body(rig, pelvis=(0.0, 0.1, -0.22), lean=22, neck=24, look=(0, 22), hip_tilt=6,
                hand_r=(-1.0, -0.45, 2.05), pole_r=(-0.6, 0.9, -0.2), weapon=HANGING,
                hand_l=(1.0, -0.4, 2.05), pole_l=(0.6, 0.9, -0.2), hand_dir_l=_n((0.1, -0.35, -1.0)), fist_l=0.8,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=18, fyaw_r=20,
                knee_l=(0.4, -1.0, 0.0), knee_r=(-0.4, -1.0, 0.0), clav_l=6, clav_r=6, scale=dict(SLUNG))


# ------------------------------------------------------------------ loops
def idle(rig, period=4.6):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)                     # heaving like a bellows, the hump rising
        return st.but(lean=st.p['lean'] - 2.5 * br, clav_l=6 + 3 * br, clav_r=6 + 3 * br,
                      look=(16 * math.sin(u), 22 + 3 * math.sin(u * 2)), head_roll=4 * math.sin(u),
                      pelvis=(0.03 * math.sin(u), 0.1, -0.22 - 0.015 * (1 - math.cos(u * 2)) / 2),
                      hip_roll=2.5 * math.sin(u), twist=5 * math.sin(u), jaw=6 + 4 * br,
                      wrist_r=(st.p['wrist_r'][0] + 4 * math.sin(u * 2), st.p['wrist_r'][1]))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The lumber: wide heavy steps, the bulk rolling side to side, the arms swinging
    long; running, a charging bull, the head down."""
    base = stance(rig)
    if run:
        base = base.but(lean=30, neck=30, look=(0, 30), hand_r=(-1.05, -0.2, 2.2), weapon=_n((0.2, -0.75, -0.6)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.5, heel_roll=14, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.5, heel_roll=14, toe_up=6)
        s1 = math.sin(TAU * ph)
        c2 = math.cos(TAU * ph * 2)
        bob = (-0.3 if run else -0.24) + (0.08 if run else 0.06) * math.cos(TAU * (ph * 2 - 0.1))
        sw = (0.34 if run else 0.24) * s1
        roll, sd = (5.0, 3.0) if run else (9.0, 7.0)
        return st.but(pelvis=(0.08 * s1, 0.1, bob), hip_twist=-9 * s1, hip_roll=roll * s1, side=sd * s1,
                      lean=st.p['lean'] + 3.0 * c2, twist=9 * s1, look=(-6 * s1, st.p['look'][1]),
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=16, fyaw_r=18,
                      hand_l=(1.0, -0.4 - sw, 2.05 + abs(sw) * 0.3), hand_dir_l=_n((0.1, -0.35 - sw * 0.6, -1.0)),
                      hand_r=(st.p['hand_r'][0], st.p['hand_r'][1] + sw, st.p['hand_r'][2] + abs(sw) * 0.25))
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """The cudgel hauled up over the right shoulder and swung down across his front.
    CONTACT 0.72."""
    st = stance(rig)
    up = st.but(lean=4, twist=-22, side=-5, pelvis=(0.04, 0.16, -0.16), look=(8, 26),
                hand_r=(-0.7, 0.15, 4.2), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.1, 0.55, 0.83)),
                hand_l=(0.95, -0.6, 2.5), hand_dir_l=_n((0.2, -0.8, -0.4)), clav_r=16,
                foot_l=(0.52, -0.3, SOLE), fyaw_l=8)
    apex = up.but(lean=2, hand_r=(-0.62, 0.25, 4.3), weapon=_n((0.05, 0.75, 0.66)))
    over = st.but(lean=16, twist=-4, pelvis=(0.0, -0.02, -0.26), hand_r=(-0.45, -0.75, 3.85),
                  pole_r=(-1.0, -0.2, -0.1), weapon=_n((0.2, -0.5, 0.84)), foot_l=(0.52, -0.42, SOLE), fyaw_l=8)
    hit = st.but(lean=34, twist=26, side=5, pelvis=(-0.04, -0.24, -0.42), look=(-6, 6),
                 hand_r=(0.15, -1.2, 2.2), pole_r=(-0.6, -0.4, -0.6), weapon=_n((0.55, -0.7, -0.45)),
                 hand_l=(1.05, 0.2, 2.3), hand_dir_l=_n((0.3, 0.5, -0.8)),
                 foot_l=(0.52, -0.5, SOLE), fyaw_l=8, knee_l=(0.4, -1.0, 0.1))
    follow = hit.but(hand_r=(0.38, -1.0, 1.95), weapon=_n((0.72, -0.45, -0.52)), twist=30, lean=36)
    keys = [(0.0, st, 'inout'), (0.4, up, 'out'), (0.52, apex, 'in'), (0.62, over, 'linear'), (0.72, hit, 'out'),
            (0.88, follow, 'auto'), (1.1, follow.but(lean=35), 'inout'), (1.7, st, 'linear')]
    return keyed(keys), 1.7


def attack2(rig):
    """The left fist and its manacle raised and hammered down before him. CONTACT 0.55."""
    st = stance(rig)
    raise_ = st.but(twist=20, lean=12, side=5, pelvis=(-0.04, 0.12, -0.18), look=(-8, 26),
                    hand_l=(0.85, -0.3, 4.15), pole_l=(1.0, 0.2, 0.3), hand_dir_l=_n((0.0, -0.3, 1.0)), fist_l=1.0,
                    clav_l=16, foot_r=(-0.52, -0.2, SOLE), fyaw_r=8)
    smash = st.but(twist=-20, lean=36, side=-4, pelvis=(0.04, -0.22, -0.42), look=(10, 4),
                   hand_l=(0.35, -1.3, 2.1), pole_l=(0.6, 0.2, -0.9), hand_dir_l=_n((-0.2, -0.6, -0.8)), fist_l=1.0,
                   foot_r=(-0.52, -0.32, SOLE), fyaw_r=8, knee_r=(-0.4, -1.0, 0.1))
    keys = [(0.0, st, 'inout'), (0.36, raise_, 'out'), (0.44, raise_.but(lean=10), 'expoin'), (0.55, smash, 'out'),
            (0.78, smash.but(lean=34), 'inout'), (1.4, st, 'linear')]
    return keyed(keys), 1.4


def anchor_hurl(rig):
    """The Drowned Anchor: the anchor taken off his back over the left shoulder
    (0.36), swung round low beside him, whirled up behind and hurled overarm, let
    go on the bar's end (1.8); the follow-through and back to the stance by 2.6."""
    st = stance(rig)
    reach = st.but(lean=14, twist=14, look=(18, 18), pelvis=(0.0, 0.12, -0.2),
                   hand_l=(0.55, 0.45, 3.95), pole_l=(1.0, 0.0, 0.4), hand_dir_l=_n((-0.1, 0.4, 0.9)), fist_l=0.9,
                   clav_l=18)
    taken = reach.but(scale=dict(ANCHOR_OUT))
    low = st.but(lean=20, twist=-6, look=(10, 18), pelvis=(0.03, 0.12, -0.3), scale=dict(ANCHOR_OUT),
                 hand_l=(1.15, -0.3, 2.95), pole_l=(1.0, 0.5, -0.2), hand_dir_l=_n((0.4, -0.2, 0.9)), fist_l=1.0,
                 foot_l=(0.54, -0.2, SOLE), foot_r=(-0.52, 0.3, SOLE))
    swing = low.but(twist=-14, hand_l=(1.25, -0.8, 3.35), hand_dir_l=_n((0.3, -0.6, 0.75)), look=(0, 22))
    back = st.but(lean=4, twist=30, side=8, look=(-4, 26), pelvis=(-0.05, 0.22, -0.18), scale=dict(ANCHOR_OUT),
                  hand_l=(1.0, 0.55, 4.25), pole_l=(1.0, 0.3, 0.6), hand_dir_l=_n((0.2, 0.7, 0.7)), fist_l=1.0,
                  clav_l=20, hand_r=(-0.9, -0.7, 2.45), weapon=_n((0.2, -0.7, -0.68)),
                  foot_l=(0.54, -0.42, SOLE), foot_r=(-0.52, 0.42, SOLE), fyaw_l=-4)
    cock = back.but(twist=34, lean=2, hand_l=(1.0, 0.6, 4.35))
    throw = st.but(lean=36, twist=-26, side=-6, look=(6, 14), pelvis=(0.05, -0.3, -0.38), scale=dict(ANCHOR_OUT),
                   hand_l=(0.25, -1.35, 3.6), pole_l=(1.0, 0.0, 0.2), hand_dir_l=_n((-0.1, -0.8, 0.55)), fist_l=0.6,
                   clav_l=12, hand_r=(-1.0, 0.0, 2.3), weapon=_n((0.0, -0.4, -0.92)),
                   foot_l=(0.54, -0.62, SOLE), foot_r=(-0.52, 0.42, SOLE), knee_l=(0.4, -1.0, 0.1))
    gone = throw.but(scale=dict(ANCHOR_GONE), fist_l=0.2)
    follow = gone.but(lean=40, twist=-30, hand_l=(-0.1, -1.1, 2.6), hand_dir_l=_n((-0.3, -0.6, -0.75)))
    end = st.but(scale=dict(ANCHOR_GONE))
    keys = [(0.0, st, 'inout'), (0.34, reach, 'linear'), (0.36, taken, 'inout'), (0.75, low, 'inout'),
            (1.05, swing, 'inout'), (1.45, back, 'out'), (1.6, cock, 'expoin'), (HURL - 0.01, throw, 'linear'),
            (HURL, gone, 'out'), (2.05, follow, 'inout'), (2.6, end, 'linear')]
    return keyed(keys), 2.6


def shackle_heave(rig):
    """The Shackle Pair: the cudgel thrust through his belt and the shackles snatched
    off his hip (0.2), both fists on the chain swung back low past his right hip
    with the whole bulk wound round, then heaved up and out across his front, let
    go on the bar's end (1.2); the follow-through, and the cudgel drawn again
    from his belt (1.72) by 2.05."""
    st = stance(rig)
    stow = st.but(lean=26, twist=6, look=(10, 16), hand_r=(-0.76, -0.2, 2.78), pole_r=(-0.6, 0.9, -0.2),
                  hand_l=(0.78, -0.25, 2.55), hand_dir_l=_n((-0.1, -0.2, -1.0)), fist_l=0.9)
    taken = stow.but(scale=dict(SHACKLE_OUT))
    over = st.but(lean=26, twist=-36, side=-4, look=(26, 14), pelvis=(0.04, 0.16, -0.32), hip_twist=-10,
                  scale=dict(SHACKLE_OUT),
                  hand_l=(-0.3, 0.42, 2.6), pole_l=(1.0, 0.4, -0.3), hand_dir_l=_n((-0.4, 0.5, -0.75)), fist_l=1.0,
                  hand_r=(-0.62, 0.38, 2.62), pole_r=(-0.8, 0.6, -0.3),
                  foot_l=(0.54, -0.36, SOLE), foot_r=(-0.52, 0.36, SOLE), fyaw_r=30)
    load = over.but(twist=-42, lean=28, hand_l=(-0.36, 0.5, 2.56), hand_r=(-0.66, 0.46, 2.58))
    heave = st.but(lean=16, twist=26, side=4, look=(-8, 24), pelvis=(-0.03, -0.24, -0.26), hip_twist=12,
                   scale=dict(SHACKLE_OUT),
                   hand_l=(0.3, -1.3, 3.45), pole_l=(1.0, 0.0, -0.4), hand_dir_l=_n((0.1, -0.8, 0.55)), fist_l=0.7,
                   hand_r=(0.02, -1.3, 3.4), pole_r=(-1.0, 0.0, -0.4),
                   foot_l=(0.54, -0.62, SOLE), foot_r=(-0.52, 0.36, SOLE), knee_l=(0.4, -1.0, 0.1))
    gone = heave.but(scale=dict(SHACKLE_GONE), fist_l=0.2)
    follow = gone.but(lean=22, twist=32, hand_l=(0.6, -1.0, 3.2), hand_r=(0.2, -1.1, 3.1),
                      hand_dir_l=_n((0.3, -0.8, 0.2)))
    draw = st.but(lean=24, look=(-6, 18), hand_r=(-0.76, -0.2, 2.78), pole_r=(-0.6, 0.9, -0.2),
                  scale=dict(SHACKLE_GONE))
    drawn = draw.but(scale=dict(CUDGEL_BACK))
    keys = [(0.0, st, 'inout'), (0.19, stow, 'linear'), (0.2, taken, 'inout'), (0.52, over, 'inout'),
            (0.86, load, 'expoin'), (HEAVE - 0.01, heave, 'linear'), (HEAVE, gone, 'out'), (1.42, follow, 'inout'),
            (1.71, draw, 'linear'), (1.72, drawn, 'inout'), (2.0, st.but(scale=dict(CUDGEL_BACK)), 'linear'),
            (2.05, st, 'linear')]
    return keyed(keys), 2.05


def cudgel_slam(rig):
    """The Gaoler's Cudgel: the cudgel hauled straight up over the caged head in the
    right fist, the left fist flung forward, then brought straight down on the
    flags before him with his whole bulk behind it, the impact on the bar's end
    (1.0); up again by 1.75."""
    st = stance(rig)
    take = st.but(lean=14, look=(0, 26), hand_r=(-0.8, -0.2, 3.5), pole_r=(-1.0, 0.0, -0.2),
                  weapon=_n((0.1, 0.4, 0.91)), hand_l=(0.8, -0.7, 2.9), hand_dir_l=_n((0.1, -0.8, -0.5)))
    up = take.but(lean=-6, neck=8, look=(0, 34), pelvis=(0.0, 0.18, -0.12),
                  hand_r=(-0.85, 0.12, 4.38), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.1, 0.55, 0.83)), clav_r=18,
                  hand_l=(0.85, -0.95, 3.4), hand_dir_l=_n((0.0, -0.9, 0.3)), foot_l=(0.52, -0.3, SOLE))
    apex = up.but(lean=-8, hand_r=(-0.8, 0.22, 4.45), weapon=_n((0.05, 0.75, 0.66)))
    fall = st.but(lean=14, pelvis=(0.0, -0.04, -0.28), hand_r=(-0.45, -0.75, 3.9), pole_r=(-1.0, -0.2, -0.1),
                  weapon=_n((0.2, -0.5, 0.84)), hand_l=(0.9, -0.5, 3.0), foot_l=(0.52, -0.45, SOLE))
    smash = st.but(lean=44, neck=22, look=(0, 8), pelvis=(0.0, -0.28, -0.6),
                   hand_r=(-0.15, -1.25, 2.1), pole_r=(-0.6, -0.4, -0.6), weapon=_n((0.3, -0.8, -0.5)),
                   hand_l=(1.0, -0.2, 2.4), hand_dir_l=_n((0.3, 0.3, -0.9)),
                   foot_l=(0.52, -0.6, SOLE), knee_l=(0.4, -1.0, 0.1), knee_r=(-0.4, -1.0, 0.1))
    keys = [(0.0, st, 'inout'), (0.2, take, 'inout'), (0.52, up, 'out'), (0.68, apex, 'in'), (0.86, fall, 'linear'),
            (SLAM, smash, 'out'), (1.22, smash.but(lean=42), 'inout'), (1.75, st, 'linear')]
    return keyed(keys), 1.75


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=8, twist=12, pelvis=(0.0, 0.2, -0.18), look=(-10, 30), head_roll=-8, jaw=18,
                  hand_l=(1.1, 0.0, 2.2))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.28, jolt.but(lean=12), 'inout'), (0.65, st, 'linear')]
    return keyed(keys), 0.65


def death(rig):
    """He rears up and roars, drops to his knees with the weight of the sea in him,
    and topples forward full length onto his face. Knees 1.0, down 1.55, still
    from 2.0."""
    st = stance(rig)
    rear = st.but(lean=-10, neck=-4, pelvis=(0.0, 0.22, -0.06), look=(0, 34), twist=10, jaw=24,
                  hand_l=(1.2, -0.1, 2.6), foot_r=(-0.5, 0.4, SOLE), fyaw_r=20)
    kneel = st.but(pelvis=(0.0, 0.42, -1.1), lean=26, neck=24, look=(0, 0), hip_tilt=8,
                   foot_l=(0.5, 0.85, 0.24), fpitch_l=-48, foot_r=(-0.5, 0.95, 0.24), fpitch_r=-48,
                   knee_l=(0.3, -1.0, -0.4), knee_r=(-0.3, -1.0, -0.4),
                   hand_r=(-0.85, -0.7, 1.4), weapon=_n((-0.6, -0.7, -0.2)), hand_l=(0.85, -0.7, 1.4), jaw=18)
    down = st.but(pitch=80, pelvis=(0.0, 0.0, 0.0), lean=8, neck=-12, look=(22, 8), hip_tilt=-10,
                  foot_l=(0.5, 0.25, 0.24), fpitch_l=-55, foot_r=(-0.5, 0.4, 0.22), fpitch_r=-55,
                  knee_l=(0.3, 0.0, -1.0), knee_r=(-0.3, 0.0, -1.0),
                  hand_r=(-1.2, -2.4, 0.35), pole_r=(-0.4, 0.2, 1.0), weapon=_n((-0.7, -0.7, 0.0)),
                  hand_l=(1.2, -2.3, 0.35), pole_l=(0.4, 0.2, 1.0), jaw=10)
    keys = [(0.0, st, 'out'), (0.32, rear, 'inout'), (1.0, kneel, 'out'),
            (1.25, kneel.but(lean=46, neck=8, look=(18, 0)), 'quadin'), (1.55, down, 'out'),
            (1.8, down.but(look=(23, 7)), 'inout'), (2.0, down.but(look=(24, 6)), 'hold'),
            (2.4, down.but(look=(24, 6)), 'hold')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.6), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.24), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.4, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('AnchorHurl', anchor_hurl, False),
    ('ShackleHeave', shackle_heave, False),
    ('CudgelSlam', cudgel_slam, False),
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
