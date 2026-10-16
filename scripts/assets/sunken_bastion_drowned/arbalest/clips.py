"""Every clip the Fogbound Arbalest ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
A marksman of the wall watch: stooped and wary, the knees bent, the head low and
forward, the heavy crossbow carried low across the body in both hands. He moves
in a careful stalking crouch. To shoot he brings the stock up into the shoulder,
lays his cheek on it and holds; at the loose the bolt and the drawn string vanish
(scale) and the loosed string shows, the stock bucks; then he drops the nose,
spins the windlass crank at the butt and a fresh bolt is laid in.

  Shoot (the Rusted Bolt, the auto attack, 0.6 s windup): shouldered by 0.29,
    LOOSE at 0.583, reloaded and back in the carry by 1.85.
  Aim (the Piercing Bolt's 2 s bar): shouldered by 0.42, held still down the lane,
    LOOSE at 2.0 as the bar ends; the reload plays out after (castPlayOut), 3.27.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.25, 0.5, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.72, 0.85, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
SHOOT_LOOSE = 0.583
AIM_LOOSE = 2.0
CRANK_TURN = 0.2

LOADED = {'Bolt': 1.0, 'StringD': 1.0, 'StringR': 0.001}
LOOSED = {'Bolt': 0.001, 'StringD': 0.001, 'StringR': 1.0}


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.4, -0.12, SOLE)
FOOT_R = (-0.38, 0.2, SOLE)


def stance(rig):
    """The low carry: knees bent, stooped, the head forward and searching, the
    crossbow across the body in both hands, the nose down to the left."""
    return Body(rig, pelvis=(0.0, 0.08, -0.16), lean=16, neck=10, look=(0, -4), hip_tilt=6,
                hand_r=(-0.42, -0.5, 2.5), pole_r=(-0.9, 0.5, -0.4), hand_dir_r=_n((0.71, 0.41, -0.57)),
                grip_l=0.5, grip_w=1.0, pole_l=(0.9, 0.3, -0.4), fist_l=0.8,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=8, fyaw_r=16,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), scale=dict(LOADED))


def aim(rig):
    """Shouldered: the butt in the right shoulder, the cheek down on the stock, the
    left hand under the fore-stock, the bolt level down the lane."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.1, -0.12), lean=12, neck=22, look=(4, -14), twist=-12,
                  hand_r=(-0.3, -0.45, 3.2), pole_r=(-1.0, 0.6, -0.2), hand_dir_r=(0.0, -0.5, -0.85),
                  grip_l=0.52, pole_l=(0.9, 0.0, -0.6), foot_l=(0.42, -0.3, SOLE), foot_r=(-0.42, 0.3, SOLE),
                  fyaw_r=26)


def lowered(rig):
    """Nose down to the ground for the reload, the left fist on the stock by the crank."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.06, -0.2), lean=24, neck=8, look=(0, -10), twist=-6,
                  hand_r=(-0.5, -0.3, 2.45), pole_r=(-1.0, 0.6, -0.2), hand_dir_r=_n((0.37, 0.21, -0.91)),
                  grip_l=-0.42)


def idle(rig, period=4.5):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        scan = math.sin(u) * 22 * smooth(abs(math.sin(u)) * 1.4)
        return st.but(lean=st.p['lean'] + 1.0 * br, clav_l=1.2 * br, clav_r=1.2 * br,
                      look=(scan, -4 + 2 * math.sin(u * 2 + 0.6)), neck=10 + 2 * math.sin(u + 1.0),
                      pelvis=(0.02 * math.sin(u), 0.08, -0.16 - 0.01 * br))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The stalk: a low, careful step, the crossbow carried ready (walk); a hunched
    jog with the nose up (run)."""
    base = stance(rig)
    if run:
        base = base.but(hand_dir_r=_n((0.45, -0.3, -0.85)), hand_r=(-0.42, -0.55, 2.62), lean=24)
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.4, heel_roll=20, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.39, heel_roll=20, toe_up=6)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.24 if run else -0.2) + (0.06 if run else 0.025) * math.cos(TAU * (ph * 2 - 0.1))
        return st.but(pelvis=(0.03 * s1, 0.08, bob), hip_twist=-6 * s1, hip_roll=3 * s1,
                      lean=st.p['lean'] + 2 * c2, twist=4 * s1, look=(-3 * s1, -4),
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=10,
                      knee_l=(0.25, -1.0, 0.0), knee_r=(-0.25, -1.0, 0.0))
    return fn


def _crank(b, deg):
    return b.but(extra={'Crank': [('y', deg)]})


def _shot(rig, t_up, t_loose, holds):
    """The shot and the reload from a loose at t_loose: the kick, the settle, the nose
    dropped, three turns of the crank, the fresh bolt, back to the carry."""
    st = stance(rig)
    a = aim(rig)
    a_b = a.but(twist=-13, look=(5, -9), lean=11)
    kick = a.but(lean=4, pelvis=(0.0, 0.2, -0.08), look=(4, -4), hand_r=(-0.3, -0.36, 3.32),
                 hand_dir_r=_n((0.0, -0.71, -0.71)), jaw=16, scale=dict(LOOSED))
    settle = a.but(scale=dict(LOOSED))
    low = lowered(rig)
    keys = [(0.0, st, 'inout'), (t_up, a, 'inout')]
    keys += holds(a, a_b)
    keys += [(t_loose - 0.008, a, 'linear'), (t_loose, kick, 'out'), (t_loose + 0.08, kick, 'inout'),
             (t_loose + 0.21, settle, 'inout'), (t_loose + 0.38, _crank(low.but(scale=dict(LOOSED)), 0), 'linear')]
    # three turns of the crank, a fifth of a second each (75 degrees a frame, slow
    # enough to read as turning, never as a strobe)
    for i in range(1, 4):
        keys.append((t_loose + 0.38 + CRANK_TURN * i, _crank(low.but(scale=dict(LOOSED)), 360 * i), 'linear'))
    t_bolt = t_loose + 0.38 + 3 * CRANK_TURN + 0.04
    keys += [(t_bolt, _crank(low.but(scale=dict(LOOSED)), 1080), 'linear'),
             (t_bolt + 0.01, _crank(low, 1080), 'inout'),
             (t_bolt + 0.25, _crank(st, 1080), 'linear')]
    return keyed(keys), t_bolt + 0.25


def shoot(rig):
    """Shoot (the Rusted Bolt): up to the shoulder over the 0.6 s windup, LOOSE at
    0.583, the kick, the reload, the carry by 1.85."""
    return _shot(rig, 0.29, SHOOT_LOOSE, lambda a, a_b: [(0.54, a_b, 'inout')])


def aim_clip(rig):
    """Aim (the Piercing Bolt's 2 s bar): shouldered by 0.42, held rock steady down the
    lane, LOOSE at 2.0, the reload playing out to 3.27."""
    return _shot(rig, 0.42, AIM_LOOSE, lambda a, a_b: [(1.17, a_b, 'inout'), (1.96, a, 'inout')])


def cast_loop(rig, period=1.0):
    a = M.aim_weapon(aim(rig))

    def fn(t):
        u = TAU * t / period
        return a.but(twist=-12 - 1 * math.sin(u), look=(4 + math.sin(u), -8), lean=10 + 0.5 * math.sin(u))
    return fn


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=4, twist=12, pelvis=(0.0, 0.18, -0.2), look=(-10, 12), head_roll=-8, jaw=14)
    keys = [(0.0, st, 'out'), (0.12, jolt, 'out'), (0.26, jolt.but(lean=10), 'inout'), (0.58, st, 'linear')]
    return keyed(keys), 0.58


def death(rig):
    """Shot through, he staggers, sinks to his knees still clutching the crossbow and
    pitches forward onto it, face down. Knees 0.85, down 1.55, still from 2.0."""
    st = stance(rig)
    stag = st.but(lean=-6, pelvis=(0.0, 0.25, -0.1), look=(0, 18), twist=10, jaw=20,
                  foot_r=(-0.38, 0.45, SOLE), fyaw_r=22)
    kneel = st.but(pelvis=(0.0, 0.42, -1.12), lean=26, neck=18, look=(0, -20), hip_tilt=8,
                   foot_l=(0.4, 0.9, 0.24), fpitch_l=-48, foot_r=(-0.38, 1.0, 0.24), fpitch_r=-48,
                   knee_l=(0.2, -1.0, -0.4), knee_r=(-0.2, -1.0, -0.4), hand_r=(-0.35, -0.7, 1.9),
                   hand_dir_r=_n((0.5, -0.4, -0.75)), jaw=16)
    down = st.but(pitch=78, pelvis=(0.0, 0.0, 0.0), lean=10, neck=-10, look=(25, 8), hip_tilt=-10,
                  foot_l=(0.4, 0.25, 0.22), fpitch_l=-55, foot_r=(-0.42, 0.4, 0.2), fpitch_r=-55,
                  knee_l=(0.2, 0.0, -1.0), knee_r=(-0.2, 0.0, -1.0),
                  hand_r=(-0.6, -2.4, 0.3), hand_dir_r=_n((-0.99, 0.1, 0.09)), pole_r=(-0.4, 0.2, 1.0),
                  pole_l=(0.4, 0.2, 1.0), jaw=10)
    # the head turns to the side on the way down (never on the impact frame), then
    # settles
    keys = [(0.0, st, 'out'), (0.3, stag, 'inout'), (0.85, kneel, 'out'),
            (1.15, kneel.but(lean=46, neck=2, look=(16, 0)), 'quadin'),
            (1.55, down, 'out'), (1.8, down.but(look=(27, 7)), 'inout'), (2.0, down.but(look=(28, 6)), 'hold'),
            (2.4, down.but(look=(28, 6)), 'hold')]

    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if t > 0.85:
            b = b.but(grip_w=1 - smooth((t - 0.85) / 0.4))
        return b
    return fn, 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.5), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.2), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.4, run=True), RUN_PERIOD), True),
    ('Shoot', shoot, False),
    ('Aim', aim_clip, False),
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
