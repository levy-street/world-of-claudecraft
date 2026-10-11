"""Every clip the Gaol Turnkey ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage should land.
A vast drowned jailer who moves his bulk like a bull: planted wide, the gut thrust
out, the great ring of keys hanging from his right fist and jingling, the chain
wound on his left forearm, the hooded head swinging slowly round his gaol. He
waddles when he walks, the shoulders rolling with the gut. He flails the key ring
up over his head and brings it down (KeySwing), lashes the chain off his forearm
across his front (ChainLash), and when he opens the cells he takes the lantern
from his hip, hoists it high (its light flares at 0.36) and rattles the keys
(LanternRaise). The Iron Cage's bar is the ring held up and shaken at the
prisoner he has picked (Cast, a loop).

  KeySwing: CONTACT 0.72.  ChainLash: CONTACT 0.6.  LanternRaise: the lantern at
  its height at 0.36, back at the hip by 1.45.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.6, 0.6, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.9, 0.72, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
LANTERN_TOP = 0.36

AT_HIP = {'LanternB': 1.0, 'LanternH': 0.001}
IN_HAND = {'LanternB': 0.001, 'LanternH': 1.0}


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.46, -0.06, SOLE)
FOOT_R = (-0.46, 0.1, SOLE)
HANGING = _n((0.15, -0.35, -0.92))


def stance(rig):
    """Planted wide, the gut out, the key ring hanging from the right fist, the
    chained left arm hanging, the hooded head forward a little."""
    return Body(rig, pelvis=(0.0, 0.04, -0.08), lean=-4, neck=10, look=(0, -4), hip_tilt=-4,
                hand_r=(-1.02, -0.2, 2.3), pole_r=(-0.6, 0.9, -0.2), weapon=HANGING,
                hand_l=(1.0, -0.08, 2.3), pole_l=(0.6, 0.9, -0.2), hand_dir_l=_n((0.15, -0.1, -1.0)), fist_l=0.85,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=16, fyaw_r=18,
                knee_l=(0.35, -1.0, 0.0), knee_r=(-0.35, -1.0, 0.0), clav_l=-3, clav_r=-3, scale=dict(AT_HIP))


# ------------------------------------------------------------------ loops
def idle(rig, period=5.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)                     # deep heaving breaths, the gut rising
        return st.but(lean=st.p['lean'] - 2.0 * br, clav_l=-3 + 2 * br, clav_r=-3 + 2 * br,
                      look=(18 * math.sin(u), -4 + 2 * math.sin(u * 2)), head_roll=3 * math.sin(u),
                      pelvis=(0.03 * math.sin(u), 0.04, -0.08 - 0.01 * (1 - math.cos(u * 2)) / 2),
                      hip_roll=2.5 * math.sin(u), twist=4 * math.sin(u),
                      wrist_r=(st.p['wrist_r'][0] + 6 * math.sin(u * 4), st.p['wrist_r'][1]))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The waddle: wide heavy steps, the bulk rolling from side to side, the keys
    swinging; running, a lumbering charge."""
    base = stance(rig)
    if run:
        base = base.but(lean=10, hand_r=(-1.0, -0.4, 2.5), weapon=_n((0.2, -0.8, -0.55)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.46, heel_roll=14, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.46, heel_roll=14, toe_up=6)
        s1 = math.sin(TAU * ph)
        c2 = math.cos(TAU * ph * 2)
        bob = (-0.16 if run else -0.1) + (0.07 if run else 0.05) * math.cos(TAU * (ph * 2 - 0.1))
        sw = (0.3 if run else 0.18) * s1
        roll, sd = (4.0, 3.0) if run else (8.0, 6.0)
        return st.but(pelvis=(0.07 * s1, 0.04, bob), hip_twist=-8 * s1, hip_roll=roll * s1, side=sd * s1,
                      lean=st.p['lean'] + 2.5 * c2, twist=7 * s1, look=(-5 * s1, -4),
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=16, fyaw_r=18,
                      hand_l=(1.0, -0.08 - sw, 2.3 + abs(sw) * 0.25), hand_dir_l=_n((0.15, -0.1 - sw * 0.6, -1.0)),
                      hand_r=(st.p['hand_r'][0], st.p['hand_r'][1] + sw * 0.8, st.p['hand_r'][2] + abs(sw) * 0.2))
    return fn


def cast_loop(rig, period=1.0):
    """The Iron Cage's bar: the key ring held up high and shaken, the left hand
    pointing out at the prisoner he has chosen."""
    def fn(t):
        u = TAU * t / period
        b = stance(rig).but(lean=-8, neck=-4, look=(0, 12), pelvis=(0.0, 0.06, -0.06),
                            hand_r=(-0.7, -0.3, 4.4 + 0.08 * math.sin(u * 2)), pole_r=(-1.0, 0.2, 0.2),
                            weapon=_n((0.15 * math.sin(u * 2), -0.2, 0.97)),
                            hand_l=(0.62, -1.15, 3.15), pole_l=(0.9, 0.3, -0.4), hand_dir_l=_n((0.1, -1.0, 0.1)),
                            fist_l=0.6, clav_r=14, jaw=10)
        return M.aim_weapon(b)
    return fn


# ------------------------------------------------------------------ blows
def key_swing(rig):
    """The ring hauled up over the hood in the right fist, the weight thrown back,
    then flailed down across his front. CONTACT 0.72."""
    st = stance(rig)
    up = st.but(lean=-12, twist=-18, side=-5, pelvis=(0.04, 0.12, -0.04), look=(8, 14),
                hand_r=(-0.62, 0.15, 4.5), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.1, 0.55, 0.83)),
                hand_l=(0.9, -0.45, 2.75), hand_dir_l=_n((0.2, -0.8, -0.4)), clav_r=16,
                foot_l=(0.48, -0.26, SOLE), fyaw_l=8)
    apex = up.but(lean=-14, hand_r=(-0.55, 0.25, 4.6), weapon=_n((0.05, 0.75, 0.66)))
    over = st.but(lean=8, twist=-4, pelvis=(0.0, -0.04, -0.14), hand_r=(-0.45, -0.7, 4.1),
                  pole_r=(-1.0, -0.2, -0.1), weapon=_n((0.2, -0.5, 0.84)), foot_l=(0.48, -0.36, SOLE), fyaw_l=8)
    hit = st.but(lean=26, twist=24, side=5, pelvis=(-0.04, -0.2, -0.34), look=(-6, -12),
                 hand_r=(0.15, -1.15, 2.35), pole_r=(-0.6, -0.4, -0.6), weapon=_n((0.55, -0.7, -0.45)),
                 hand_l=(1.0, 0.25, 2.5), hand_dir_l=_n((0.3, 0.5, -0.8)),
                 foot_l=(0.48, -0.42, SOLE), fyaw_l=8, knee_l=(0.35, -1.0, 0.1))
    follow = hit.but(hand_r=(0.38, -0.95, 2.1), pole_r=(-0.7, 0.2, -0.6), weapon=_n((0.72, -0.45, -0.52)),
                     twist=28, lean=28)
    keys = [(0.0, st, 'inout'), (0.4, up, 'out'), (0.52, apex, 'in'), (0.62, over, 'linear'), (0.72, hit, 'out'),
            (0.88, follow, 'auto'), (1.1, follow.but(lean=27), 'inout'), (1.7, st, 'linear')]
    return keyed(keys), 1.7


def chain_lash(rig):
    """The chained left arm drawn back and up, then whipped flat across his front to
    his right, the chain's free end cracking out. CONTACT 0.6."""
    st = stance(rig)
    draw = st.but(twist=24, lean=-4, side=4, pelvis=(-0.04, 0.08, -0.1), look=(-10, 6),
                  hand_l=(1.15, 0.35, 3.6), pole_l=(0.6, 0.5, 0.8), hand_dir_l=_n((0.5, 0.5, 0.7)), fist_l=1.0,
                  clav_l=14, foot_r=(-0.48, -0.2, SOLE), fyaw_r=8)
    lash = st.but(twist=-26, lean=18, side=-4, pelvis=(0.04, -0.16, -0.26), look=(12, -6),
                  hand_l=(-0.2, -1.3, 2.9), pole_l=(0.6, 0.2, -0.9), hand_dir_l=_n((-0.6, -0.75, -0.2)), fist_l=1.0,
                  foot_r=(-0.48, -0.32, SOLE), fyaw_r=8, knee_r=(-0.35, -1.0, 0.1))
    follow = lash.but(twist=-32, hand_l=(-0.55, -1.0, 2.6), hand_dir_l=_n((-0.9, -0.3, -0.3)))
    keys = [(0.0, st, 'inout'), (0.36, draw, 'out'), (0.48, draw.but(twist=27), 'in'), (0.6, lash, 'out'),
            (0.8, follow, 'inout'), (1.05, follow.but(lean=16), 'inout'), (1.5, st, 'linear')]
    return keyed(keys), 1.5


def lantern_raise(rig):
    """Opening the cells: the left fist takes the lantern off his hip, hoists it high
    over the hood (its light flares at the top, 0.36), holds it there while the
    right fist rattles the keys, then hangs it back at his hip."""
    st = stance(rig)
    reach = st.but(lean=4, twist=10, look=(16, -10), hand_l=(0.74, -0.16, 2.62), pole_l=(0.9, 0.6, -0.3),
                   hand_dir_l=_n((0.0, 0.0, -1.0)), fist_l=0.9)
    high = st.but(lean=-10, neck=-8, look=(4, 20), pelvis=(0.0, 0.06, -0.06), clav_l=16,
                  hand_l=(0.5, -0.45, 4.65), pole_l=(1.0, 0.0, 0.2), hand_dir_l=_n((0.0, 0.0, 1.0)), fist_l=1.0,
                  hand_r=(-0.8, -0.5, 3.3), pole_r=(-1.0, 0.3, -0.2), weapon=_n((0.1, -0.3, 0.95)),
                  scale=dict(IN_HAND), jaw=12)

    def rattle(t):
        return high.but(hand_r=(-0.8, -0.5, 3.3 + 0.06 * math.sin(TAU * t * 6)),
                        weapon=_n((0.1 + 0.2 * math.sin(TAU * t * 6), -0.3, 0.95)))
    keys = [(0.0, st, 'inout'), (0.15, reach, 'linear'), (0.16, reach.but(scale=dict(IN_HAND)), 'out'),
            (LANTERN_TOP, high, 'linear')]
    for i in range(1, 6):
        keys.append((LANTERN_TOP + 0.12 * i, rattle(0.12 * i + 0.04), 'inout'))
    keys += [(1.3, reach.but(scale=dict(IN_HAND)), 'linear'), (1.44, reach.but(scale=dict(IN_HAND)), 'linear'),
             (1.45, reach, 'inout'), (1.75, st, 'linear')]
    return keyed(keys), 1.75


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-12, twist=10, pelvis=(0.0, 0.12, -0.06), look=(-8, 12), head_roll=-6, jaw=14,
                  hand_l=(1.05, 0.12, 2.4))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.28, jolt.but(lean=-8), 'inout'), (0.65, st, 'linear')]
    return keyed(keys), 0.65


def death(rig):
    """He sways, drops the keys' weight to his knees, then topples forward full
    length onto his belly with a slam. Knees 1.0, down 1.55, still from 2.0."""
    st = stance(rig)
    sway = st.but(lean=-14, pelvis=(0.0, 0.2, -0.06), look=(0, 18), twist=10, jaw=18,
                  foot_r=(-0.46, 0.36, SOLE), fyaw_r=20)
    kneel = st.but(pelvis=(0.0, 0.42, -1.1), lean=20, neck=18, look=(0, -16), hip_tilt=8,
                   foot_l=(0.46, 0.85, 0.24), fpitch_l=-48, foot_r=(-0.46, 0.95, 0.24), fpitch_r=-48,
                   knee_l=(0.3, -1.0, -0.4), knee_r=(-0.3, -1.0, -0.4),
                   hand_r=(-0.8, -0.6, 1.5), weapon=_n((0.2, -0.5, -0.84)), hand_l=(0.8, -0.6, 1.5), jaw=14)
    down = st.but(pitch=80, pelvis=(0.0, 0.0, 0.0), lean=8, neck=-12, look=(22, 8), hip_tilt=-10,
                  foot_l=(0.46, 0.25, 0.24), fpitch_l=-55, foot_r=(-0.46, 0.4, 0.22), fpitch_r=-55,
                  knee_l=(0.3, 0.0, -1.0), knee_r=(-0.3, 0.0, -1.0),
                  hand_r=(-1.1, -2.4, 0.3), pole_r=(-0.4, 0.2, 1.0), weapon=_n((-0.6, -0.3, -0.1)),
                  hand_l=(1.1, -2.3, 0.3), pole_l=(0.4, 0.2, 1.0), jaw=10)
    # the head turns aside on the way down, never on the impact frame
    keys = [(0.0, st, 'out'), (0.32, sway, 'inout'), (1.0, kneel, 'out'),
            (1.25, kneel.but(lean=40, neck=2, look=(18, 0)), 'quadin'), (1.55, down, 'out'),
            (1.8, down.but(look=(23, 7)), 'inout'), (2.0, down.but(look=(24, 6)), 'hold'),
            (2.4, down.but(look=(24, 6)), 'hold')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.24), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.4, run=True), RUN_PERIOD), True),
    ('KeySwing', key_swing, False),
    ('ChainLash', chain_lash, False),
    ('LanternRaise', lantern_raise, False),
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
