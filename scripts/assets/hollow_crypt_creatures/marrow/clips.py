"""Every clip Sexton Marrow ships, with its key moments.

Times in seconds (24 fps). He is the sexton still at his work: stooped low over
the yard, the skull thrust forward under the hood, the long spade in both fists.
At rest (Idle, a loop) he digs: the spade lifted, driven into the earth, levered,
a shovelful heaved up and flung off to his left, and his skull lifts to look
round the yard. In a fight (CombatIdle) the spade comes up at the ready, its
blade raised beside his head, the T-grip low at his left hip. He walks with the
spade over his shoulder and runs (and strides to the bell rope) in a long lope
with it held across him. Every combat one-shot starts and ends on CombatIdle.

  Attack (CONTACT 0.6): the spade hauled up over his right shoulder and chopped
  down, edge first, in front of him.
  Attack2 (CONTACT 0.55): the spade drawn back on his right and swept flat across
  his front at waist height.
  Shovelful (the 1.2 s bar, bar-locked): the blade stabbed into the earth (0.42),
  levered out heaped with grave dirt (0.62), swung back low (0.85) and heaved
  up and forward, the dirt FLUNG at 1.0 (the load's Dirt bone scaled away on
  that frame); the follow-through plays out to 1.7.
  Measure (the 1.0 s bar, bar-locked): the spade lifted and levelled at the mark
  like a measuring rod, LEVELLED from 0.5 to the bar's end, the skull cocked
  over the haft sighting down it (a tick of the rod at 0.75); back by 1.4.
  BellRing (a 1.0 s loop, played three times): the spade stood in the earth at
  his right (SpadeStuck shown, the held one hidden), both fists high on the
  rope on his own axis, hauled down to his chest, BOTTOMED at 0.9 (the rope's
  pull curve, crypt_boss_fx_core.ts ropePull), the rope snatching them back up
  in the last tenth.
  GravediggersBlow (the 0.8 s bar, bar-locked): the spade swung high over his
  head and smashed down flat in front of him, IMPACT 0.7; recovered by 1.3.
  Hit: a jolt from the guard. Death: struck upright, the knees go, he folds onto
  them and slumps forward into a heap of bones and cloth (down 1.25, still from
  1.6), the soul light in his sockets going out (gone by 2.0).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.6, 0.82, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.92, 1.12, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
HIDE = 0.001

SHOVEL, FLING = 1.2, 1.0
MEASURE, LEVEL = 1.0, 0.5
BELL, PULL_BOTTOM = 1.0, 0.9
BLOW, IMPACT = 0.8, 0.7
DIG = 4.4

HELD = {'Dirt': HIDE, 'SpadeStuck': HIDE, 'Weapon': 1.0, 'Eyes': 1.0}
LOADED = {'Dirt': 1.0}
EMPTY = {'Dirt': HIDE}
STOOD = {'Weapon': HIDE, 'SpadeStuck': 1.0, 'Dirt': HIDE}


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))




FOOT_L = (0.48, -0.1, SOLE)
FOOT_R = (-0.46, 0.2, SOLE)


def stoop(rig):
    """The sexton's carriage: the knees soft, the back bowed, the skull thrust out
    and lifted to see; the spade in both fists before him, blade down."""
    return Body(rig, pelvis=(0.0, 0.06, -0.22), lean=24, neck=18, look=(0, 14), hip_tilt=4,
                hand_r=(-0.18, -1.02, 2.75), pole_r=(-1.0, 0.6, -0.3), weapon=_n((0.06, -0.45, -0.89)),
                grip_l=-1.05, grip_w=1.0, pole_l=(1.0, 0.4, -0.4),
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=10, fyaw_r=14,
                knee_l=(0.35, -1.0, 0.0), knee_r=(-0.35, -1.0, 0.0), scale=dict(HELD))


def guard(rig):
    """At the ready: lower and wider, the spade levelled at the enemy like a pike,
    the dished blade forward at chest height, the T-grip back at his left hip."""
    return stoop(rig).but(pelvis=(0.0, 0.1, -0.24), lean=22, neck=10, look=(4, 16), twist=-10,
                          hand_r=(-0.5, -0.95, 3.3), pole_r=(-1.0, 0.3, -0.5), weapon=_n((-0.42, -0.5, 0.76)),
                          grip_l=-1.0, pole_l=(1.0, 0.2, -0.6),
                          foot_l=(0.5, -0.3, SOLE), foot_r=(-0.5, 0.34, SOLE), fyaw_r=24)


# ------------------------------------------------------------------ loops
def _dig_keys(rig):
    st = stoop(rig)
    ready = st
    lift = st.but(lean=16, neck=12, look=(0, 6), pelvis=(0.0, 0.08, -0.1),
                  hand_r=(-0.2, -1.15, 3.0), weapon=_n((0.02, -0.62, -0.78)))
    drive = st.but(lean=30, neck=20, look=(0, 0), pelvis=(0.0, 0.0, -0.3), hip_tilt=8,
                   hand_r=(-0.16, -1.02, 2.12), weapon=_n((0.05, -0.4, -0.92)))
    push = drive.but(lean=33, pelvis=(0.0, -0.02, -0.34), hand_r=(-0.16, -1.0, 1.98))
    lever = st.but(lean=26, neck=18, look=(0, 2), pelvis=(0.0, 0.1, -0.28),
                   hand_r=(-0.16, -0.72, 2.3), weapon=_n((0.05, -0.62, -0.78)), scale=dict(LOADED))
    heave = st.but(lean=18, neck=12, look=(4, 8), pelvis=(0.0, 0.06, -0.16), twist=-6,
                   hand_r=(-0.25, -0.98, 2.95), weapon=_n((0.2, -0.78, -0.59)), scale=dict(LOADED))
    toss = st.but(lean=16, neck=10, look=(24, 8), pelvis=(0.02, 0.04, -0.14), twist=30, side=4,
                  hand_r=(0.3, -0.98, 3.1), weapon=_n((0.82, -0.5, -0.05)), scale=dict(LOADED))
    flung = toss.but(twist=36, look=(28, 12), hand_r=(0.42, -0.9, 3.25), weapon=_n((0.86, -0.32, 0.28)),
                     scale=dict(EMPTY))
    look = st.but(lean=12, neck=4, look=(-22, 20), pelvis=(0.0, 0.06, -0.1), head_roll=6,
                  hand_r=(-0.2, -1.0, 2.82))
    look2 = look.but(look=(18, 18), head_roll=-4)
    return [(0.0, ready, 'inout'), (0.75, lift, 'in'), (1.08, drive, 'out'),
            (1.35, push, 'inout'), (1.62, push.but(lean=32), 'inout'), (2.05, lever, 'inout'),
            (2.55, heave, 'inout'), (3.0, toss, 'linear'), (3.08, toss.but(scale=dict(LOADED)), 'linear'),
            (3.12, flung, 'out'), (3.45, flung.but(twist=26), 'inout'), (3.75, look, 'inout'),
            (4.05, look2, 'inout'), (DIG, ready, 'linear')]


def idle(rig):
    seq = keyed(_dig_keys(rig))

    def fn(t):
        b = seq(t)
        u = TAU * t / DIG
        return b.but(jaw=3 + 3 * (1 - math.cos(u * 2)) / 2, clav_l=1.0 * math.sin(u * 2), clav_r=1.0 * math.sin(u * 2))
    return fn


def combat_idle(rig, period=2.4):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * br, pelvis=(0.0, 0.1, -0.24 - 0.025 * (1 - math.cos(u)) / 2),
                     look=(4 + 4 * math.sin(u * 0.5), 16 + 2 * br), clav_l=1.2 * br, clav_r=1.2 * br,
                     twist=-10 + 2 * math.sin(u + 0.6), jaw=4 + 3 * (1 - math.cos(u)) / 2,
                     hand_r=(-0.5, -0.95, 3.3 + 0.04 * br))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The walk: a slow stooped plod, the spade over his right shoulder with the
    blade behind, the left arm hanging and swinging. The run (and the stride to
    the bell rope): a long hunched lope, the spade held in both fists across him."""
    if run:
        base = stoop(rig).but(lean=34, neck=24, look=(0, 22), pelvis=(0.0, 0.0, -0.26), twist=-8,
                              hand_r=(-0.5, -0.95, 3.25), pole_r=(-1.0, 0.4, -0.4), weapon=_n((-0.55, -0.55, 0.62)),
                              grip_l=-1.0, grip_w=1.0)
    else:
        base = stoop(rig).but(lean=18, neck=14, look=(0, 10), grip_w=0.0,
                              hand_r=(-0.62, -0.62, 4.15), pole_r=(-1.0, -0.2, -0.6),
                              weapon=_n((-0.08, 0.72, 0.69)),
                              hand_l=(1.05, -0.2, 2.75), pole_l=(0.6, 1.0, -0.3), hand_dir_l=_n((0.15, -0.2, -1.0)),
                              fist_l=0.45, spread_l=6)
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.44, heel_roll=20, toe_up=6)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.42, heel_roll=20, toe_up=6)
        s1 = math.sin(TAU * ph)
        c2 = math.cos(TAU * ph * 2)
        if run:
            bob = -0.44 + 0.1 * math.cos(TAU * (ph * 2 - 0.15))
            return st.but(pelvis=(0.04 * s1, 0.0, bob), hip_twist=-8 * s1, hip_roll=3 * s1,
                          lean=st.p['lean'] + 3 * c2, twist=-8 + 5 * s1, look=(-3 * s1, 22 - 2 * c2),
                          foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=8,
                          knee_l=(0.3, -1.0, 0.0), knee_r=(-0.3, -1.0, 0.0),
                          hand_r=(-0.5, -0.95 - 0.04 * s1, 3.25 + 0.05 * c2))
        bob = -0.14 + 0.05 * math.cos(TAU * (ph * 2 - 0.1))
        sw = 0.34 * s1
        return st.but(pelvis=(0.05 * s1, 0.06, bob), hip_twist=-8 * s1, hip_roll=4 * s1,
                      lean=st.p['lean'] + 2 * c2, twist=6 * s1, side=2.5 * s1, look=(-4 * s1, 10),
                      head_roll=2 * s1,
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=8, fyaw_r=10,
                      knee_l=(0.3, -1.0, 0.0), knee_r=(-0.3, -1.0, 0.0),
                      hand_l=(1.05, -0.2 + sw, 2.75 + abs(sw) * 0.25),
                      hand_dir_l=_n((0.15, -0.2 + sw * 0.7, -1.0)),
                      hand_r=(-0.62, -0.62 + 0.03 * s1, 4.15 + 0.03 * c2))
    return fn


def bell_ring(rig, period=BELL):
    """The Burial Toll: the spade stood in the earth at his right, both fists high
    on the rope on his own axis (he stands back from it), hauled down to his chest
    on the rope's pull curve, bottomed at 0.9, snatched back up in the last tenth."""
    top_z, bot_z = 5.35, 3.8
    base = stoop(rig).but(weapon=None, grip_w=0.0, scale=dict(STOOD), pole_r=(-1.0, 0.3, -0.6),
                          pole_l=(1.0, 0.3, -0.6), hand_dir_l=_n((0.0, -0.3, 1.0)), hand_dir_r=_n((0.0, -0.3, 1.0)),
                          fist_l=1.0, fist_r=1.0, foot_l=(0.5, 0.55, SOLE), foot_r=(-0.5, 0.9, SOLE),
                          fyaw_l=12, fyaw_r=18)

    def pull(k):
        return math.sin(k / PULL_BOTTOM * math.pi / 2) if k < PULL_BOTTOM else 1 - (k - PULL_BOTTOM) / (1 - PULL_BOTTOM)

    def fn(t):
        k = (t % period) / period
        p = pull(k)
        e = smooth(p)
        z = top_z - (top_z - bot_z) * p
        pel = (0.0, 0.78 + 0.04 * e, -0.06 - 0.3 * e)
        dirh = _n((0.0, -0.15, 1.0))           # the fists run up the rope, top and bottom
        return base.but(pelvis=pel, lean=8 + 22 * e, neck=-6 + 20 * e, look=(0, 30 - 26 * e), hip_tilt=2 + 6 * e,
                        hand_l=(0.07, -0.02 - 0.06 * e, z), hand_r=(-0.07, -0.02 - 0.06 * e, z + 0.2 - 0.05 * e),
                        hand_dir_l=dirh, hand_dir_r=dirh, jaw=4 + 10 * e,
                        knee_l=(0.4, -1.0, 0.1), knee_r=(-0.4, -1.0, 0.1),
                        offset={'SpadeStuck': (-pel[0], -pel[1], -pel[2])})
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """The spade hauled up over his right shoulder and chopped down edge first in
    front of him, the whole stooped weight behind it. CONTACT 0.6."""
    g = guard(rig)
    load = g.but(twist=-24, lean=8, pelvis=(0.03, 0.16, -0.18), look=(10, 22),
                 hand_r=(-0.55, -0.35, 4.75), pole_r=(-1.0, 0.0, 0.3), weapon=_n((-0.25, 0.55, 0.8)), clav_r=12)
    over = g.but(twist=-8, lean=14, hand_r=(-0.4, -0.9, 4.7), pole_r=(-1.0, -0.2, -0.2),
                 weapon=_n((-0.1, -0.35, 0.93)))
    hit = g.but(twist=16, lean=40, neck=18, pelvis=(-0.03, -0.18, -0.44), look=(-4, 4),
                hand_r=(-0.2, -1.3, 2.3), pole_r=(-1.0, 0.2, -0.4), weapon=_n((0.05, -0.62, -0.78)),
                foot_l=(0.5, -0.55, SOLE), knee_l=(0.3, -1.0, 0.1))
    follow = hit.but(hand_r=(-0.2, -1.25, 2.2), weapon=_n((0.08, -0.55, -0.83)), lean=42)
    keys = [(0.0, g, 'inout'), (0.32, load, 'out'), (0.46, load.but(twist=-27), 'in'),
            (0.54, over, 'linear'), (0.6, hit, 'out'), (0.78, follow, 'auto'),
            (1.0, follow.but(lean=40), 'inout'), (1.45, g, 'linear')]
    return keyed(keys), 1.45


def attack2(rig):
    """The spade drawn back on his right and swept flat across his front at waist
    height, the hips turning through it. CONTACT 0.55."""
    g = guard(rig)
    wind = g.but(twist=-38, lean=18, side=-4, pelvis=(0.05, 0.16, -0.3), look=(18, 14), hip_twist=-10,
                 hand_r=(-1.05, 0.1, 3.3), pole_r=(-0.3, 1.0, -0.6), weapon=_n((-0.85, 0.45, 0.25)),
                 foot_r=(-0.5, 0.42, SOLE), fyaw_r=34)
    mid = g.but(twist=0, lean=22, pelvis=(0.0, -0.04, -0.34), hip_twist=6,
                hand_r=(-0.7, -1.2, 3.05), pole_r=(-0.8, 0.3, -0.4), weapon=_n((-0.75, -0.65, 0.05)))
    hit = g.but(twist=34, lean=24, side=4, pelvis=(-0.04, -0.12, -0.36), look=(-16, 10), hip_twist=14,
                hand_r=(0.35, -1.25, 3.0), pole_r=(-0.4, -0.6, -0.6), weapon=_n((0.55, -0.83, 0.05)),
                foot_l=(0.5, -0.5, SOLE), fyaw_l=-10)
    follow = hit.but(twist=40, hand_r=(0.7, -0.9, 2.9), weapon=_n((0.88, -0.45, -0.1)))
    keys = [(0.0, g, 'inout'), (0.36, wind, 'out'), (0.46, wind.but(twist=-41), 'in'),
            (0.51, mid, 'linear'), (0.55, hit, 'out'), (0.72, follow, 'auto'),
            (0.95, follow.but(lean=23), 'inout'), (1.4, g, 'linear')]
    return keyed(keys), 1.4


def shovelful(rig):
    """Shovelful: the blade stabbed into the earth (0.42), levered out heaped with
    grave dirt (0.62), swung back low on his right (0.85) and heaved up and forward,
    the load FLUNG at 1.0 (the Dirt bone scaled away on that frame)."""
    g = guard(rig)
    raise_ = g.but(twist=-4, lean=18, neck=12, look=(0, 8), pelvis=(0.0, 0.08, -0.16),
                   hand_r=(-0.2, -1.15, 3.05), pole_r=(-1.0, 0.6, -0.3), weapon=_n((0.02, -0.62, -0.78)), grip_l=-1.05)
    stab = raise_.but(lean=32, neck=20, look=(0, 2), pelvis=(0.0, 0.0, -0.34), hip_tilt=8,
                      hand_r=(-0.2, -1.05, 2.12), weapon=_n((0.04, -0.42, -0.91)))
    scoop = raise_.but(lean=28, neck=16, pelvis=(0.0, 0.08, -0.32), look=(0, 6),
                       hand_r=(-0.25, -0.86, 2.4), weapon=_n((0.05, -0.7, -0.7)), scale=dict(LOADED))
    coil = scoop.but(twist=-24, lean=24, side=-3, pelvis=(0.05, 0.16, -0.36), look=(8, 14), hip_twist=-8,
                     hand_r=(-0.6, -0.62, 2.7), pole_r=(-0.8, 0.8, -0.3), weapon=_n((-0.35, -0.35, -0.87)),
                     foot_r=(-0.5, 0.42, SOLE))
    heave = g.but(twist=6, lean=8, neck=10, pelvis=(0.0, -0.12, -0.2), look=(0, 20), hip_twist=4,
                  hand_r=(-0.2, -1.25, 3.45), pole_r=(-1.0, 0.2, -0.5), weapon=_n((0.04, -0.82, 0.57)),
                  grip_l=-1.05, foot_l=(0.5, -0.5, SOLE), knee_l=(0.3, -1.0, 0.1), scale=dict(LOADED))
    flung = heave.but(lean=4, look=(0, 24), hand_r=(-0.2, -1.2, 3.6), weapon=_n((0.03, -0.62, 0.78)),
                      scale=dict(EMPTY))
    after = flung.but(lean=6, hand_r=(-0.25, -1.1, 3.7), weapon=_n((0.0, -0.45, 0.89)))
    keys = [(0.0, g, 'inout'), (0.24, raise_, 'in'), (0.42, stab, 'out'),
            (0.5, stab, 'inout'), (0.62, scoop, 'inout'), (0.85, coil, 'expoin'),
            (FLING - 0.01, heave, 'linear'), (FLING, flung, 'out'), (SHOVEL, after, 'inout'),
            (1.7, g, 'linear')]
    return keyed(keys), 1.7


def measure(rig):
    """Measured for the Grave: the spade lifted and levelled at the mark like a
    measuring rod, LEVELLED from 0.5, the skull cocked over the haft sighting down
    it, a tick of the rod at 0.75; back to the guard by 1.4."""
    g = guard(rig)
    lift = g.but(twist=-6, lean=14, look=(0, 18), hand_r=(-0.3, -1.0, 4.15), pole_r=(-1.0, 0.2, -0.3),
                 weapon=_n((0.0, -0.75, 0.66)), grip_l=-1.05)
    level = g.but(twist=4, lean=26, neck=22, look=(-3, -4), head_roll=14, pelvis=(0.0, 0.04, -0.24),
                  hand_r=(-0.1, -1.35, 3.3), pole_r=(-1.0, 0.2, -0.3), weapon=_n((0.03, -0.9, -0.43)),
                  grip_l=-1.05, pole_l=(1.0, 0.0, -0.6))
    tick = level.but(hand_r=(-0.1, -1.33, 3.24), weapon=_n((0.03, -0.86, -0.51)), head_roll=17, look=(-3, -8))
    keys = [(0.0, g, 'inout'), (0.28, lift, 'inout'), (LEVEL, level, 'inout'),
            (0.66, level, 'inout'), (0.75, tick, 'inout'), (0.86, level, 'inout'),
            (MEASURE, level.but(head_roll=13), 'inout'), (1.4, g, 'linear')]
    return keyed(keys), 1.4


def gravediggers_blow(rig):
    """Gravedigger's Blow: the spade swung high over his skull and smashed down
    flat in front of him, IMPACT 0.7; recovered by 1.3."""
    g = guard(rig)
    up = g.but(twist=-6, lean=2, neck=2, look=(0, 30), pelvis=(0.0, 0.16, -0.1),
               hand_r=(-0.35, -0.3, 5.5), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.0, 0.5, 0.86)), clav_r=14, clav_l=10,
               grip_l=-0.95)
    apex = up.but(lean=-4, look=(0, 34), hand_r=(-0.3, -0.18, 5.6), weapon=_n((0.0, 0.7, 0.71)))
    down = g.but(twist=0, lean=16, look=(0, 14), hand_r=(-0.2, -1.1, 4.9), pole_r=(-1.0, 0.1, 0.05),
                 weapon=_n((0.0, -0.55, 0.83)), grip_l=-0.95)
    smash = g.but(twist=4, lean=42, neck=20, look=(0, 0), pelvis=(0.0, -0.22, -0.48), hip_tilt=8,
                  hand_r=(-0.15, -1.35, 2.2), pole_r=(-1.0, 0.2, -0.4), weapon=_n((0.0, -0.7, -0.71)),
                  grip_l=-0.95, foot_l=(0.5, -0.6, SOLE), knee_l=(0.3, -1.0, 0.1), knee_r=(-0.3, -1.0, 0.1))
    keys = [(0.0, g, 'inout'), (0.3, up, 'out'), (0.5, apex, 'in'), (0.62, down, 'linear'),
            (IMPACT, smash, 'out'), (0.86, smash.but(lean=43), 'inout'), (1.3, g, 'linear')]
    return keyed(keys), 1.3


def hit(rig):
    g = guard(rig)
    jolt = g.but(lean=10, twist=4, pelvis=(0.0, 0.2, -0.18), look=(-10, 30), head_roll=-8, jaw=18,
                 hand_r=(-0.6, -0.7, 3.8))
    keys = [(0.0, g, 'out'), (0.12, jolt, 'out'), (0.26, jolt.but(lean=12), 'inout'),
            (0.6, g, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """Struck upright, the knees go, he folds down onto them and slumps forward and
    over into a heap of bones and cloth (down 1.25, still from 1.6), the spade
    falling flat, the soul light in his sockets going out (gone by 2.0)."""
    g = guard(rig)
    reel = g.but(lean=4, neck=-4, pelvis=(0.0, 0.3, -0.14), look=(0, 36), jaw=28, twist=8,
                 hand_r=(-0.62, -0.6, 3.5), weapon=_n((-0.5, -0.3, 0.81)), foot_r=(-0.5, 0.6, SOLE))
    buckle = g.but(lean=26, neck=26, pelvis=(0.0, 0.3, -1.05), look=(0, 10), jaw=24, twist=6,
                   foot_l=(0.5, 0.0, SOLE), foot_r=(-0.5, 0.35, SOLE),
                   knee_l=(0.3, -1.0, 0.0), knee_r=(-0.3, -1.0, 0.0),
                   hand_r=(-0.7, -1.0, 2.2), weapon=_n((-0.4, -0.8, -0.45)))
    kneel = g.but(lean=50, neck=34, pelvis=(0.0, 0.62, -2.08), look=(0, -6), jaw=22, twist=4, hip_tilt=10,
                  foot_l=(0.48, 0.95, 0.24), fpitch_l=-60, foot_r=(-0.48, 1.0, 0.24), fpitch_r=-60,
                  knee_l=(0.3, -1.0, -0.4), knee_r=(-0.3, -1.0, -0.4),
                  hand_r=(-0.85, -1.45, 0.75), pole_r=(-1.0, 0.4, 0.2), weapon=_n((-0.35, -0.9, -0.1)),
                  grip_w=0.3)
    heap = kneel.but(lean=78, neck=42, side=-14, pelvis=(-0.1, 0.62, -2.25), roll=-6, look=(-10, -20), jaw=30,
                     hand_r=(-1.1, -1.4, 0.32), weapon=_n((-0.3, -0.95, 0.0)), grip_w=0.0,
                     hand_l=(0.9, -1.4, 0.35), pole_l=(1.0, 0.4, 0.4), hand_dir_l=_n((0.3, -0.6, -0.4)), fist_l=0.25,
                     fist_r=0.6, clav_l=-6, clav_r=-6, head_roll=-18)
    settle = heap.but(lean=80, neck=44, look=(-12, -22), pelvis=(-0.1, 0.62, -2.28))
    dark = settle.but(scale={'Eyes': HIDE})
    keys = [(0.0, g, 'out'), (0.25, reel, 'inout'), (0.6, buckle, 'quadin'), (0.95, kneel, 'quadin'),
            (1.25, heap, 'out'), (1.42, settle.but(lean=79), 'inout'), (1.6, settle, 'inout'),
            (2.0, dark, 'hold'), (2.4, dark, 'hold')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), DIG), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.4), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.3), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.5, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Shovelful', shovelful, False),
    ('Measure', measure, False),
    ('BellRing', lambda r: (bell_ring(r), BELL), True),
    ('GravediggersBlow', gravediggers_blow, False),
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
