"""Every clip the Mist Chanter ships, with its release frames.

Times in seconds (24 fps). RELEASE = the frame the spell leaves her (the renderer
starts the clip at the windup and launches the bolt 0.6 s later).
She is old and bent and moves like it: hunched over the crooked staff planted in
her right fist, the head thrust forward on the stoop, the left claw held up by her
breast, the fingers never still. She hobbles in short shuffling steps, the staff
swinging forward with her. Her spells come out of the lure: she draws the staff
back and thrusts the glowing lure at you (Attack), or sweeps her claw across and
blows the mist off it (Attack2). The Fog Ward is the staff raised in both hands
over her head, swayed round in a slow circle while she chants.

  Attack: the lure thrust out. RELEASE 0.6.
  Attack2: the claw swept across, the mist blown off it. RELEASE 0.6.
  Ward (the Fog Ward's 2 s bar): loops, one slow circle of the staff a loop.
  Cast: the generic chant, the lure held up before her.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.3, 0.42, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.8, 0.72, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
RELEASE = 0.6


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.3, -0.1, SOLE)
FOOT_R = (-0.3, 0.12, SOLE)
PLANTED = _n((-0.1, -0.2, 0.97))


def stance(rig):
    """Bent over the planted staff, the head thrust forward on the stoop, the left
    claw up by her breast."""
    return Body(rig, pelvis=(0.0, 0.16, -0.24), lean=44, neck=-26, look=(0, 10), hip_tilt=8,
                hand_r=(-0.86, -0.6, 2.2), pole_r=(-0.9, 0.5, -0.3), weapon=PLANTED,
                hand_l=(0.52, -0.86, 2.62), pole_l=(0.9, 0.5, -0.6), hand_dir_l=_n((-0.15, -0.8, 0.55)),
                fist_l=0.35, spread_l=12,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=10, fyaw_r=14,
                knee_l=(0.2, -1.0, 0.0), knee_r=(-0.2, -1.0, 0.0), clav_l=4, clav_r=2)


def chant(rig):
    """The lure held up before her face, the claw weaving under it."""
    st = stance(rig)
    return st.but(lean=30, neck=-18, look=(0, 14), pelvis=(0.0, 0.12, -0.2),
                  hand_r=(-0.62, -0.78, 2.75), pole_r=(-0.9, 0.3, -0.4), weapon=_n((0.0, -0.5, 0.87)),
                  hand_l=(0.36, -0.75, 3.05), hand_dir_l=_n((0.0, -0.4, 0.9)), fist_l=0.2, spread_l=18)


# ------------------------------------------------------------------ loops
def idle(rig, period=4.6):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        # she sways on the staff, tilts her head and mutters; the claw's fingers work
        # (every oscillator starts at zero, so the loop opens on the stance itself:
        # the one-shots begin and end there too)
        return st.but(lean=st.p['lean'] + 1.2 * br, pelvis=(0.03 * math.sin(u), 0.16, -0.24 - 0.01 * br),
                      look=(10 * math.sin(u), 10 + 3 * math.sin(u * 2)), head_roll=7 * math.sin(u),
                      jaw=5 * max(0.0, math.sin(u * 5)), fist_l=0.35 + 0.25 * math.sin(u * 3),
                      spread_l=12 + 6 * math.sin(u * 3),
                      hand_l=(0.52 + 0.02 * math.sin(u * 2), -0.86, 2.62 + 0.03 * math.sin(u * 2)),
                      hip_roll=2 * math.sin(u))
    return fn


def cast_loop(rig, period=1.2):
    c = M.aim_weapon(chant(rig))

    def fn(t):
        u = TAU * t / period
        return c.but(hand_l=(0.36 + 0.06 * math.cos(u), -0.75 + 0.04 * math.sin(u), 3.05 + 0.06 * math.sin(u)),
                     jaw=6 + 6 * max(0.0, math.sin(u * 2)), head_roll=4 * math.sin(u),
                     fist_l=0.25 + 0.15 * math.sin(u * 2))
    return fn


def ward(rig, period=2.0):
    """The Fog Ward: the staff raised in both hands over her head and swayed round in
    a slow circle, the head thrown back, chanting."""
    def pose(u):
        cx, cy = 0.14 * math.cos(u), 0.1 * math.sin(u)
        b = stance(rig).but(lean=4, neck=-16, look=(6 * math.cos(u), 20), pelvis=(0.0, 0.06, -0.12),
                            hand_r=(-0.25 + cx, -0.3 + cy, 4.15), pole_r=(-1.0, 0.0, 0.2),
                            weapon=_n((0.12 * math.cos(u), -0.1 + 0.12 * math.sin(u), 0.98)),
                            grip_l=-0.45, grip_w=1.0, pole_l=(1.0, 0.0, 0.2), fist_l=0.8, clav_l=10, clav_r=10,
                            jaw=10 + 6 * math.sin(u * 2), twist=6 * math.sin(u))
        return M.aim_weapon(b)

    def fn(t):
        return pose(TAU * t / period)
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The hobble: short shuffling steps, a lurch to the side at each, the staff
    swung forward with her; running, a bent scuttle with the staff held across."""
    base = stance(rig)
    if run:
        base = base.but(hand_r=(-0.6, -0.5, 2.45), weapon=_n((0.45, -0.45, 0.77)), lean=36)
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.3, heel_roll=20, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.3, heel_roll=20, toe_up=6)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.3 if run else -0.26) + (0.05 if run else 0.035) * math.cos(TAU * (ph * 2 - 0.1))
        sw = 0.18 * s1
        return st.but(pelvis=(0.05 * s1, 0.16, bob), hip_twist=-7 * s1, hip_roll=5 * s1, side=5 * s1,
                      lean=st.p['lean'] + 2 * c2, twist=5 * s1, look=(-5 * s1, 8), head_roll=-5 * s1,
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=10, fyaw_r=14,
                      hand_r=(st.p['hand_r'][0], st.p['hand_r'][1] - sw, st.p['hand_r'][2] + abs(sw) * 0.3),
                      hand_l=(0.55, -0.8 + 0.12 * s1, 2.6 + 0.05 * abs(s1)), fist_l=0.4)
    return fn


# ------------------------------------------------------------------ spells
def attack(rig):
    """Chilling Mist off the lure: she draws the staff back over her shoulder,
    rears, and thrusts the glowing lure out at you. RELEASE 0.6."""
    st = stance(rig)
    draw = st.but(lean=10, neck=-10, look=(4, 14), twist=-22, pelvis=(0.03, 0.18, -0.14),
                  hand_r=(-0.72, 0.05, 3.05), pole_r=(-1.0, 0.2, -0.2), weapon=_n((0.25, 0.55, 0.8)),
                  hand_l=(0.55, -0.7, 3.0), hand_dir_l=_n((0.1, -0.8, 0.4)), fist_l=0.15, spread_l=20,
                  foot_l=(0.32, -0.3, SOLE))
    thrust = st.but(lean=34, neck=-18, look=(-2, 10), twist=14, pelvis=(-0.02, -0.16, -0.26),
                    hand_r=(-0.3, -1.12, 2.95), pole_r=(-0.9, 0.2, -0.4), weapon=_n((0.15, -0.85, 0.5)),
                    hand_l=(0.62, -0.4, 2.5), hand_dir_l=_n((0.4, 0.3, -0.85)), fist_l=0.5, jaw=22,
                    foot_l=(0.32, -0.46, SOLE), knee_l=(0.2, -1.0, 0.1))
    keys = [(0.0, st, 'inout'), (0.36, draw, 'out'), (0.48, draw.but(twist=-25, lean=8), 'in'),
            (RELEASE, thrust, 'out'), (0.82, thrust.but(lean=32, jaw=14), 'inout'), (1.35, st, 'linear')]
    return keyed(keys), 1.35


def attack2(rig):
    """Chilling Mist off the claw: she gathers the mist in her left claw by her
    mouth, then sweeps it out across and blows it at you. RELEASE 0.6."""
    st = stance(rig)
    gather = st.but(lean=22, neck=-6, look=(14, 12), twist=12, hand_l=(0.12, -0.55, 3.45),
                    hand_dir_l=_n((-0.5, -0.5, 0.7)), fist_l=0.7, spread_l=4, jaw=6)
    sweep = st.but(lean=32, neck=-16, look=(-6, 10), twist=-16, pelvis=(0.02, -0.08, -0.24),
                   hand_l=(0.2, -1.15, 3.0), pole_l=(1.0, 0.2, -0.3), hand_dir_l=_n((-0.2, -0.95, 0.1)),
                   fist_l=0.05, spread_l=24, jaw=24, foot_l=(0.32, -0.36, SOLE))
    keys = [(0.0, st, 'inout'), (0.38, gather, 'out'), (0.5, gather.but(lean=24), 'in'), (RELEASE, sweep, 'out'),
            (0.86, sweep.but(lean=30, jaw=12), 'inout'), (1.35, st, 'linear')]
    return keyed(keys), 1.35


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=16, twist=12, pelvis=(0.0, 0.2, -0.16), look=(-10, 20), head_roll=-10, jaw=18,
                  hand_l=(0.6, -0.3, 3.05), fist_l=0.1, spread_l=24)
    keys = [(0.0, st, 'out'), (0.12, jolt, 'out'), (0.27, jolt.but(lean=20), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """The spell goes out of her: she clutches at her breast, the staff slides away
    from her, her knees go and she sinks into the heap of her skirts, then slumps
    forward over them. Down at 1.5, still from 1.9."""
    st = stance(rig)
    clutch = st.but(lean=14, neck=-4, look=(0, 22), pelvis=(0.0, 0.16, -0.18), jaw=26,
                    hand_l=(0.12, -0.5, 3.2), hand_dir_l=_n((-0.6, 0.2, 0.3)), fist_l=0.8,
                    hand_r=(-0.8, -0.5, 2.15), weapon=_n((-0.35, -0.3, 0.89)))
    sink = st.but(pelvis=(0.0, 0.2, -1.25), lean=34, neck=4, look=(0, -6), hip_tilt=10,
                  foot_l=(0.36, -0.55, 0.14), fpitch_l=-30, foot_r=(-0.36, -0.45, 0.14), fpitch_r=-30,
                  knee_l=(0.3, -1.0, 0.2), knee_r=(-0.3, -1.0, 0.2),
                  hand_l=(0.4, -0.9, 1.25), hand_dir_l=_n((0.1, -0.5, -0.85)), fist_l=0.3,
                  hand_r=(-0.9, -0.6, 1.3), pole_r=(-0.8, 0.4, -0.4), weapon=_n((-0.75, -0.25, 0.6)), jaw=18)
    slump = sink.but(pelvis=(0.0, 0.1, -1.6), lean=70, neck=20, look=(14, -10), head_roll=12,
                     hand_l=(0.6, -1.3, 0.55), hand_dir_l=_n((0.3, -0.7, -0.6)), fist_l=0.2, spread_l=16,
                     hand_r=(-1.05, -0.9, 0.5), weapon=_n((-0.9, -0.3, 0.3)), jaw=12)
    keys = [(0.0, st, 'out'), (0.3, clutch, 'inout'), (0.62, clutch.but(look=(0, 16)), 'inout'), (1.0, sink, 'out'),
            (1.5, slump, 'out'), (1.9, slump.but(look=(16, -12)), 'hold'), (2.2, slump.but(look=(16, -12)), 'hold')]
    return keyed(keys), 2.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.6), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.2), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.3, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda r: (cast_loop(r), 1.2), True),
    ('Ward', lambda r: (ward(r), 2.0), True),
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
