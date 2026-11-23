"""Every clip Knight-Commander Olen ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage should land.
He holds the wall the way he held it alive. At ease he stands square and tall,
the tower shield carried at his left side with its sigil to the enemy, the
longsword's point set on the flags by his right foot and his fist on the pommel,
the crested helm turning slowly over his drowned garrison. In the fight the
shield comes up before him, the fist at his brow and the board from his eyes to
his thighs, the sword cocked over its rim. He marches; he charges bent in behind
the shield (Run: his Oathbound Charge crosses its lane in it). His blows: a chop
down over the shield's rim (Attack), the shield driven into the enemy (Attack2),
a broad reaping sweep of the blade (Attack3, his Reaping Arc).

OathCharge is the Oathbound Charge's bar (2.5 s, bar-locked): he stamps his front
foot down and plants himself (0.35), thrusts the sword to the sky and roars his
oath with the shield lowered to his side (0.6 to 1.5), drops in behind the shield
with the blade levelled and coils (1.5 to 2.2), and leans out into the charge as
the bar ends (2.5), the pose the Run takes up.

Stunned (Breached, a loop): crashed into a buttress, he reels on his feet, the
shield hanging, the sword's point dragging, the crested head lolling.

The fallen paladin's kit (src/sim/encounters/sunken_bastion/olen.ts), each on its
bar and bar-locked, starting on the guard:
  Consecrate (Hallowed Brine, 1.2 s): the sword hauled up high over the shield's
  rim, point down, then driven into the flags before him (PLANT 0.9), held there as
  the brine wells up on the bar's end, wrenched free after it.
  ShieldThrow (Rebounding Bulwark, 1.5 s): the tower shield swung back across his
  body, then hurled sidearm (RELEASE 1.3); from the release the Shield bone is
  scaled away (the board has left the fist) to the clip's end.
  ShieldCatch (0.6 s, the gesture when it flies home): the left arm snaps out, the
  shield is back in the fist at CATCH 0.12 and he gives a step under its weight.
  Judgement (Sentence of the Tide, 1.0 s): the blade levelled at the marked player
  and held there, a commander's sentence (POINT 0.45).
  OathKneel (Unbroken Oath, 1.5 s): down onto his right knee (DOWN 1.1), the sword
  planted point-down before him and his fist on its pommel, the shield stood upright
  on its foot at his left side, the crested head bowed.
  OathVigil (a loop, 2.4 s): the vigil kept in the bubble, breathing, the cloak and
  the crest stirring.

  Attack: CONTACT 0.7.  Attack2: CONTACT 0.48.  Attack3: CONTACT 0.78.
  OathCharge: 2.5 (bar-locked: the launch on the bar's end; retired with the charge).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.45, 0.64, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.8, 0.92, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
OATH = 2.5
CONSECRATE, PLANT = 1.2, 0.9
THROW, RELEASE = 1.5, 1.3
CATCH_DUR, CATCH = 0.6, 0.12
JUDGE, POINT = 1.0, 0.45
KNEEL, DOWN = 1.5, 1.1
VIGIL = 2.4
# The shield in the fist, or gone from it (the Shield bone's keyed scale).
HELD = {'Shield': 1.0}
GONE = {'Shield': 0.001}


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


FOOT_L = (0.44, -0.16, SOLE)
FOOT_R = (-0.42, 0.14, SOLE)
POINT_DOWN = _n((-0.08, -0.12, -1.0))
LEVELLED = _n((0.2, -0.96, -0.2))                 # the blade levelled forward past the shield (the charge)
# The tower shield rides its upright grip in the left fist (anatomy.shield_matrix):
# the board's up runs through the fist toward the thumb, its face is the back of
# the hand, so the fist's aim and roll set the board (tuned with a probe of the
# posed board). At his side: the forearm forward, the thumb up, the sigil turned
# out and to the front. Up before him: the fist across his front at the chest,
# the board upright from his eyes to his thighs, facing the enemy.
SIDE_DIR, SIDE_ROLL = _n((-0.65, -0.72, 0.25)), -10.0
GUARD_DIR, GUARD_ROLL = _n((-0.72, -0.62, 0.25)), -50.0
CHARGE_DIR, CHARGE_ROLL = _n((-0.85, -0.45, 0.25)), -50.0
SIDE_L = dict(hand_l=(0.95, -0.6, 2.55), pole_l=(0.6, 1.0, -0.3), hand_dir_l=SIDE_DIR, hand_roll_l=SIDE_ROLL,
              fist_l=1.0)
GUARD_L = dict(hand_l=(0.62, -0.82, 3.05), pole_l=(1.0, 0.3, -0.5), hand_dir_l=GUARD_DIR, hand_roll_l=GUARD_ROLL,
               fist_l=1.0)


def stance(rig):
    """At ease, as a commander stands: square and tall, chest out, the shield at his
    left side with its sigil to the front, the sword's point on the flags by his
    right foot and the right fist on its pommel."""
    return Body(rig, pelvis=(0.0, 0.02, -0.04), lean=-3, neck=-3, look=(0, 2), hip_tilt=-2,
                hand_r=(-0.6, -0.62, 2.28), pole_r=(-1.0, 0.4, -0.2), weapon=POINT_DOWN,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=12, fyaw_r=16,
                knee_l=(0.25, -1.0, 0.0), knee_r=(-0.25, -1.0, 0.0), clav_l=-1, clav_r=-1, **SIDE_L)


def guard(rig):
    """The fight: lower and wider, the shield up before him, the sword cocked over
    its rim, the helm forward over the board."""
    st = stance(rig)
    return st.but(pelvis=(0.0, 0.08, -0.2), lean=10, neck=4, look=(4, -2), twist=-8, hip_tilt=0,
                  hand_r=(-0.62, -0.6, 3.15), pole_r=(-1.0, 0.5, -0.3), weapon=_n((0.3, -0.85, 0.42)),
                  foot_l=(0.46, -0.38, SOLE), foot_r=(-0.44, 0.34, SOLE), fyaw_l=4, fyaw_r=26, **GUARD_L)


# ------------------------------------------------------------------ loops
def idle(rig, period=5.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)                     # two slow breaths a loop
        scan = 14 * math.sin(u) * smooth(abs(math.sin(u)) * 1.5)
        return st.but(lean=st.p['lean'] - 1.2 * br, clav_l=-1 + 1.5 * br, clav_r=-1 + 1.5 * br,
                      look=(scan, 2 + 1.5 * math.sin(u * 2 + 0.6)), neck=-3 + 1.0 * math.sin(u * 2),
                      pelvis=(0.012 * math.sin(u), 0.02, -0.04 - 0.006 * (1 - math.cos(u * 2)) / 2),
                      hip_roll=1.2 * math.sin(u), twist=2.5 * math.sin(u))
    return fn


def combat_idle(rig, period=2.2):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.2 * br, pelvis=(0.0, 0.08, -0.2 - 0.02 * (1 - math.cos(u)) / 2),
                     look=(4 + 3 * math.sin(u), -2), clav_l=1.0 * br, clav_r=1.0 * br, twist=-8 + 1.5 * br,
                     hand_r=(-0.62, -0.6, 3.15 + 0.03 * br))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    """The march: even heavy strides, the shield carried at his side, the sword low
    before him. Running (and the Oathbound Charge): bent in behind the raised
    shield, the sword drawn back low, the strides long."""
    if run:
        base = stance(rig).but(lean=24, neck=-14, look=(0, 6), pelvis=(0.0, 0.0, -0.16),
                               hand_l=(0.32, -0.98, 3.05), pole_l=(1.0, 0.3, -0.5), hand_dir_l=CHARGE_DIR,
                               hand_roll_l=CHARGE_ROLL, fist_l=1.0,
                               hand_r=(-0.75, -0.35, 2.8), pole_r=(-0.8, 0.6, -0.2), weapon=LEVELLED)
    else:
        base = stance(rig).but(hand_r=(-0.7, -0.5, 2.5), pole_r=(-0.9, 0.5, -0.2), weapon=_n((0.05, -0.75, -0.66)),
                               lean=1)
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.4, heel_roll=18, toe_up=8)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.4, heel_roll=18, toe_up=8)
        s1 = math.sin(TAU * ph)
        c2 = math.cos(TAU * ph * 2)
        if run:
            bob = -0.2 + 0.08 * math.cos(TAU * (ph * 2 - 0.15))
            return st.but(pelvis=(0.03 * s1, 0.0, bob), hip_twist=-7 * s1, hip_roll=3 * s1,
                          lean=st.p['lean'] + 2.5 * c2, twist=4 * s1, look=(-2 * s1, 6),
                          foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=4, fyaw_r=8,
                          hand_l=(0.32, -0.98 - 0.04 * s1, 3.05 + 0.04 * c2))
        bob = -0.08 + 0.045 * math.cos(TAU * (ph * 2 - 0.1))
        sw = 0.16 * s1
        return st.but(pelvis=(0.035 * s1, 0.02, bob), hip_twist=-7 * s1, hip_roll=3.5 * s1,
                      lean=st.p['lean'] + 1.5 * c2, twist=5 * s1, side=1.5 * s1, look=(-3 * s1, 2),
                      foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=8, fyaw_r=12,
                      hand_l=(0.95, -0.6 - sw * 0.4, 2.55 + abs(sw) * 0.12),
                      hand_r=(-0.7, -0.5 + sw, 2.5 + abs(sw) * 0.2))
    return fn


def stunned(rig, period=2.4):
    """Breached: reeling on his feet after the crash, the knees soft, the shield arm
    hanging, the sword's point dragging on the flags, the crested head lolling in
    a slow circle."""
    base = stance(rig).but(pelvis=(0.0, 0.1, -0.3), lean=16, neck=18, look=(0, -14), hip_tilt=4,
                           hand_l=(0.98, -0.42, 2.3), pole_l=(0.6, 1.0, -0.3), hand_dir_l=_n((-0.5, -0.8, -0.2)),
                           hand_roll_l=-12, fist_l=0.8,
                           hand_r=(-0.78, -0.2, 2.2), pole_r=(-1.0, 0.5, -0.3), weapon=_n((-0.1, -0.6, -0.8)),
                           foot_l=(0.48, -0.1, SOLE), foot_r=(-0.46, 0.22, SOLE), knee_l=(0.4, -1.0, 0.0),
                           knee_r=(-0.4, -1.0, 0.0))
    st = M.aim_weapon(base)

    def fn(t):
        u = TAU * t / period
        return st.but(pelvis=(0.07 * math.sin(u), 0.1 + 0.04 * math.cos(u), -0.3 - 0.03 * math.sin(u * 2)),
                      side=5 * math.sin(u), roll=2.5 * math.sin(u), lean=16 + 3 * math.cos(u),
                      look=(16 * math.sin(u + 0.8), -14 + 8 * math.cos(u + 0.8)), head_roll=10 * math.sin(u + 0.4),
                      twist=6 * math.sin(u + 0.3))
    return fn


# ------------------------------------------------------------------ blows
def attack(rig):
    """The sword hauled up over his right shoulder behind the helm, then chopped
    down over the shield's rim, the whole weight behind it. CONTACT 0.7."""
    g = guard(rig)
    load = g.but(twist=-20, lean=-2, pelvis=(0.03, 0.12, -0.12), look=(8, 8),
                 hand_r=(-0.72, 0.12, 4.3), pole_r=(-1.0, 0.0, 0.3), weapon=_n((0.4, 0.6, 0.7)), clav_r=14,
                 foot_l=(0.46, -0.34, SOLE))
    apex = load.but(twist=-24, hand_r=(-0.68, 0.16, 4.38), weapon=_n((0.68, 0.57, 0.45)))
    over = g.but(twist=-6, lean=8, hand_r=(-0.45, -0.6, 4.15), pole_r=(-1.0, -0.2, -0.2),
                 weapon=_n((0.1, -0.5, 0.86)), foot_l=(0.46, -0.42, SOLE))
    hit = g.but(twist=22, lean=26, pelvis=(-0.03, -0.18, -0.34), look=(-4, -12),
                hand_r=(-0.2, -1.05, 2.25), pole_r=(-1.0, 0.2, -0.4), weapon=_n((0.3, -0.81, -0.51)),
                hand_l=(0.48, -0.82, 2.95), foot_l=(0.46, -0.5, SOLE), knee_l=(0.25, -1.0, 0.1))
    follow = hit.but(hand_r=(-0.05, -0.98, 2.12), weapon=_n((0.55, -0.7, -0.45)), lean=28)
    keys = [(0.0, g, 'inout'), (0.38, load, 'out'), (0.52, apex, 'in'), (0.62, over, 'linear'), (0.7, hit, 'out'),
            (0.88, follow, 'auto'), (1.1, follow.but(lean=27), 'inout'), (1.6, g, 'linear')]
    return keyed(keys), 1.6


def attack2(rig):
    """The shield driven into the enemy with the left shoulder behind it and a step
    in, the sword held as the guard holds it. CONTACT 0.48."""
    g = M.aim_weapon(guard(rig))
    gather = g.but(twist=6, lean=6, pelvis=(-0.03, 0.14, -0.22), look=(-4, 0), hand_r=(-0.62, -0.52, 3.12),
                   hand_l=(0.72, -0.5, 3.1), foot_r=(-0.44, 0.42, SOLE))
    bash = g.but(twist=-6, lean=20, pelvis=(0.0, -0.36, -0.26), look=(6, -4), hand_r=(-0.62, -1.1, 2.98),
                 hand_l=(0.3, -1.38, 3.2), hand_dir_l=CHARGE_DIR, hand_roll_l=CHARGE_ROLL, clav_fwd_l=-14,
                 foot_l=(0.46, -0.78, SOLE), knee_l=(0.25, -1.0, 0.1))
    keys = [(0.0, g, 'inout'), (0.3, gather, 'expoin'), (0.48, bash, 'out'), (0.7, bash.but(lean=20), 'inout'),
            (1.25, g, 'linear')]
    return keyed(keys), 1.25


def attack3(rig):
    """The Reaping Arc: the blade swung back low on his right and swept round flat
    at the height of a man's waist, the shield lifted clear, the hips turning
    through it. CONTACT 0.78."""
    g = guard(rig)
    wind = g.but(twist=-34, lean=6, side=-4, pelvis=(0.05, 0.14, -0.26), look=(14, -2), hip_twist=-10,
                 hand_r=(-1.0, 0.25, 3.1), pole_r=(-0.3, 1.0, -0.6), weapon=_n((-0.9, 0.3, 0.3)),
                 hand_l=(0.8, -0.6, 3.25), foot_r=(-0.46, 0.4, SOLE), fyaw_r=34)
    cock = wind.but(twist=-38, hand_r=(-1.0, 0.3, 3.1), weapon=_n((-0.81, 0.55, 0.2)))
    mid = g.but(twist=0, lean=12, pelvis=(0.0, -0.04, -0.3), hip_twist=6,
                hand_r=(-0.62, -1.1, 2.9), pole_r=(-0.8, 0.3, -0.4), weapon=_n((-0.75, -0.65, 0.05)),
                hand_l=(0.88, -0.5, 3.2))
    hit = g.but(twist=30, lean=14, side=4, pelvis=(-0.04, -0.12, -0.32), look=(-16, -6), hip_twist=14,
                hand_r=(0.45, -1.1, 2.85), pole_r=(-0.4, -0.6, -0.6), weapon=_n((0.55, -0.83, 0.05)),
                hand_l=(0.95, -0.4, 3.1), foot_l=(0.46, -0.48, SOLE), fyaw_l=-10)
    follow = hit.but(twist=36, hand_r=(0.75, -0.75, 2.75), weapon=_n((0.88, -0.45, -0.1)))
    keys = [(0.0, g, 'inout'), (0.42, wind, 'out'), (0.58, cock, 'in'), (0.7, mid, 'linear'), (0.78, hit, 'out'),
            (0.95, follow, 'auto'), (1.18, follow.but(lean=13), 'inout'), (1.75, g, 'linear')]
    return keyed(keys), 1.75


def oath_charge(rig):
    """The Oathbound Charge's bar: the front foot stamped down and planted (0.35),
    the sword thrust to the sky and the oath roared with the shield lowered to his
    side (0.6 to 1.5), down in behind the shield with the blade levelled and
    coiled (1.5 to 2.2), leaning out into the charge as the bar ends (2.5)."""
    g = M.aim_weapon(guard(rig))
    lift = g.but(lean=2, pelvis=(0.03, 0.08, -0.12), foot_l=(0.48, -0.42, SOLE + 0.3), fpitch_l=10,
                 knee_l=(0.3, -1.0, 0.2), hand_r=(-0.66, -0.58, 3.3), look=(0, 4))
    stamp = g.but(lean=12, pelvis=(0.0, -0.06, -0.32), foot_l=(0.52, -0.62, SOLE), knee_l=(0.3, -1.0, 0.1),
                  foot_r=(-0.48, 0.42, SOLE), hand_l=(0.42, -0.95, 3.0))
    roar = g.but(lean=-14, neck=-16, look=(0, 26), pelvis=(0.0, 0.04, -0.2), twist=4,
                 hand_r=(-0.55, -0.25, 5.05), pole_r=(-1.0, 0.2, 0.2), weapon=_n((0.05, -0.12, 0.99)), clav_r=18,
                 clav_l=4, **SIDE_L,
                 foot_l=(0.52, -0.62, SOLE), foot_r=(-0.48, 0.42, SOLE), jaw=22)
    roar2 = roar.but(lean=-16, look=(4, 30), hand_r=(-0.5, -0.3, 5.12))
    coil = g.but(lean=30, neck=-16, look=(0, 8), pelvis=(0.0, 0.18, -0.48), twist=-6,
                 hand_l=(0.32, -1.0, 3.05), hand_dir_l=CHARGE_DIR, hand_roll_l=CHARGE_ROLL,
                 hand_r=(-0.7, -0.8, 2.75), pole_r=(-0.8, 0.6, -0.2), weapon=LEVELLED,
                 foot_l=(0.5, -0.66, SOLE), foot_r=(-0.46, 0.62, M.planted_ankle_z(-22)), fpitch_r=-22,
                 knee_l=(0.25, -1.0, 0.2), knee_r=(-0.25, -1.0, -0.2))
    lower = roar2.but(lean=4, look=(0, 10), hand_r=(-0.6, -0.65, 3.7), pole_r=(-1.0, 0.3, -0.2),
                      weapon=_n((0.15, -0.75, 0.64)))
    launch = coil.but(lean=34, pelvis=(0.0, 0.02, -0.4), hand_l=(0.32, -1.06, 3.08))
    keys = [(0.0, g, 'inout'), (0.22, lift, 'expoin'), (0.35, stamp, 'out'), (0.62, roar, 'out'),
            (1.5, roar2, 'inout'), (1.72, lower, 'inout'), (1.95, coil, 'inout'), (2.2, coil.but(lean=31), 'inout'), (OATH, launch, 'linear'),
            (OATH + 0.12, launch.but(lean=35), 'linear')]
    # a beat past the bar's end so the bar-locked clip never wraps at the launch
    return keyed(keys), OATH + 0.12


def hit(rig):
    g = guard(rig)
    jolt = g.but(lean=-6, twist=12, pelvis=(0.0, 0.16, -0.14), look=(-8, 10), head_roll=-6,
                 hand_l=(0.55, -0.7, 3.2))
    keys = [(0.0, g, 'out'), (0.12, jolt, 'out'), (0.26, jolt.but(lean=-2), 'inout'), (0.6, g, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """His oath breaks: he reels, the shield arm falls, he sinks to one knee with
    the sword's point set in the stones and bows his crested head over the hilt,
    holds there, then topples onto his back. Kneel 0.9, down 2.0, still from 2.4."""
    g = guard(rig)
    reel = g.but(lean=-10, pelvis=(0.0, 0.2, -0.08), look=(0, 18), twist=10, foot_r=(-0.42, 0.42, SOLE),
                 fyaw_r=20, **SIDE_L)
    kneel = g.but(pelvis=(0.0, 0.2, -0.95), lean=12, neck=20, look=(0, -18), twist=0,
                  foot_l=(0.46, -0.42, SOLE), knee_l=(0.3, -1.0, 0.1),
                  foot_r=(-0.42, 0.8, 0.24), fpitch_r=-48, knee_r=(-0.2, -1.0, -0.4),
                  hand_r=(-0.32, -0.8, 2.15), pole_r=(-0.9, 0.3, -0.4), weapon=_n((0.05, -0.15, -0.99)),
                  hand_l=(1.02, -0.5, 1.95), pole_l=(0.6, 1.0, -0.3), hand_dir_l=SIDE_DIR,
                  hand_roll_l=SIDE_ROLL, fist_l=0.9)
    bow = kneel.but(lean=20, neck=26, look=(0, -26))
    down = g.but(pitch=-82, pelvis=(0.0, 0.0, 0.0), lean=-6, neck=-8, look=(16, 10), twist=0,
                 foot_l=(0.4, -0.3, 0.3), fpitch_l=40, foot_r=(-0.4, -0.2, 0.3), fpitch_r=40,
                 knee_l=(0.25, 0.0, 1.0), knee_r=(-0.25, 0.0, 1.0),
                 hand_r=(-1.1, 0.2, 2.6), pole_r=(-0.5, -0.2, -1.0), weapon=_n((-0.95, 0.3, 0.0)),
                 hand_l=(1.3, -0.3, 0.42), pole_l=(0.4, 0.2, 1.0), hand_dir_l=_n((0.2, -1.0, -0.5)),
                 hand_roll_l=20.0, fist_l=0.7)
    keys = [(0.0, g, 'out'), (0.3, reel, 'inout'), (0.9, kneel, 'out'), (1.3, bow, 'inout'), (1.55, bow, 'quadin'),
            (2.0, down, 'out'), (2.2, down.but(look=(18, 9)), 'inout'), (2.4, down.but(look=(18, 9)), 'hold'),
            (2.7, down.but(look=(18, 9)), 'hold')]
    return keyed(keys), 2.7


# ------------------------------------------------------------------ the fallen paladin
def consecrate(rig):
    """Hallowed Brine: the sword hauled up high over the shield's rim, point down,
    then driven into the flags before him (PLANT 0.9), held planted through the
    bar's end (when the brine wells up round the blade), wrenched free after it."""
    g = M.aim_weapon(guard(rig)).but(scale=dict(HELD))
    lift = g.but(lean=-8, neck=-10, look=(0, 18), pelvis=(0.0, 0.08, -0.08), twist=-4,
                 hand_r=(-0.5, -0.6, 4.85), pole_r=(-1.0, 0.2, 0.3), weapon=_n((0.05, -0.15, 0.99)),
                 clav_r=18, **SIDE_L)
    apex = lift.but(lean=-11, look=(0, 22), hand_r=(-0.46, -0.62, 4.95))
    over = g.but(lean=12, neck=0, look=(0, 0), pelvis=(0.0, 0.0, -0.36), twist=0,
                 hand_r=(-0.3, -1.25, 3.6), pole_r=(-1.0, 0.1, -0.2), weapon=_n((0.0, -0.75, -0.66)),
                 weapon_max=80.0, clav_r=8, **SIDE_L)
    drive = g.but(lean=30, neck=-8, look=(0, -24), pelvis=(0.0, -0.1, -0.7), twist=0, hip_tilt=4,
                  hand_r=(-0.22, -1.24, 2.0), pole_r=(-1.0, 0.3, -0.5), weapon=_n((0.0, -0.06, -1.0)),
                  weapon_max=80.0, clav_r=4, hand_l=(0.98, -0.42, 2.25), pole_l=(0.6, 1.0, -0.3),
                  hand_dir_l=SIDE_DIR, hand_roll_l=SIDE_ROLL, fist_l=1.0,
                  knee_l=(0.3, -1.0, 0.1), knee_r=(-0.3, -1.0, -0.1))
    held = drive.but(lean=32, pelvis=(0.0, -0.11, -0.74), look=(0, -20))
    pull = drive.but(lean=14, pelvis=(0.0, -0.02, -0.4), look=(0, -6), hand_r=(-0.4, -1.05, 2.95),
                     weapon=_n((0.1, -0.5, -0.86)))
    level = apex.but(lean=0, look=(0, 8), pelvis=(0.0, 0.04, -0.2), hand_r=(-0.4, -1.05, 4.35),
                     pole_r=(-1.0, 0.1, 0.0), weapon=_n((0.02, -0.96, 0.28)), weapon_max=80.0)
    keys = [(0.0, g, 'inout'), (0.42, lift, 'out'), (0.6, apex, 'inout'), (0.72, level, 'inout'),
            (0.8, over, 'linear'),
            (PLANT, drive, 'out'), (1.02, held, 'inout'), (CONSECRATE, held.but(lean=31), 'inout'),
            (1.42, pull, 'inout'), (1.75, g, 'linear')]
    return keyed(keys), 1.75


def shield_throw(rig):
    """Rebounding Bulwark: the tower shield drawn back across his body to the right
    and coiled behind it, then hurled sidearm out to his left-front with the whole
    turn of the hips (RELEASE 1.3); from the release the board is gone from the fist
    (the Shield bone scaled away) to the clip's end."""
    g = M.aim_weapon(guard(rig)).but(scale=dict(HELD))
    draw = g.but(twist=-30, lean=8, side=-3, pelvis=(0.05, 0.12, -0.26), look=(18, 0), hip_twist=-12,
                 hand_l=(-0.12, -0.78, 3.1), pole_l=(1.0, 0.6, -0.4), hand_dir_l=GUARD_DIR,
                 hand_roll_l=GUARD_ROLL, clav_fwd_l=10,
                 hand_r=(-0.9, -0.2, 2.75), pole_r=(-1.0, 0.6, -0.2), weapon=_n((-0.2, -0.6, -0.77)))
    coil = draw.but(twist=-40, hip_twist=-16, lean=12, look=(24, -2), hand_l=(-0.32, -0.5, 3.05),
                    pelvis=(0.07, 0.16, -0.32))
    sling = g.but(twist=10, lean=12, hip_twist=4, pelvis=(0.0, -0.06, -0.3), look=(-6, 0),
                  hand_l=(0.7, -1.2, 3.2), pole_l=(0.6, 0.4, -0.8), hand_dir_l=_n((-0.2, -0.95, 0.2)),
                  hand_roll_l=-90, knee_l=(0.3, -1.0, 0.1),
                  hand_r=(-0.9, -0.2, 2.75), pole_r=(-1.0, 0.6, -0.2), weapon=_n((-0.2, -0.6, -0.77)))
    loose = g.but(twist=32, lean=16, side=4, hip_twist=14, pelvis=(-0.04, -0.2, -0.34), look=(-22, 2),
                  hand_l=(1.55, -1.25, 3.3), pole_l=(0.2, 0.6, -0.9), hand_dir_l=_n((0.75, -0.6, 0.2)),
                  hand_roll_l=-90, fist_l=1.0,
                  hand_r=(-0.9, -0.2, 2.75), pole_r=(-1.0, 0.6, -0.2), weapon=_n((-0.2, -0.6, -0.77)),
                  knee_l=(0.3, -1.0, 0.1))
    flung = loose.but(scale=dict(GONE), fist_l=0.15, twist=36, hand_l=(1.7, -1.05, 3.25))
    after = flung.but(twist=20, lean=10, hand_l=(1.25, -0.9, 2.95), look=(-14, 4), pelvis=(-0.02, -0.08, -0.28))
    bare = g.but(scale=dict(GONE), fist_l=0.25, hand_l=(0.95, -0.7, 2.75), pole_l=(0.6, 1.0, -0.3))
    keys = [(0.0, g, 'inout'), (0.5, draw, 'inout'), (0.9, coil, 'inout'), (1.02, coil.but(twist=-42), 'inout'),
            (1.2, sling, 'linear'), (RELEASE - 0.02, loose, 'linear'), (RELEASE, flung, 'out'),
            (THROW, after, 'inout'), (1.85, bare, 'linear')]
    return keyed(keys), 1.85


def shield_catch(rig):
    """The shield flies home: the left arm snaps out empty, the board is back in the
    fist at CATCH 0.12 and its weight drives the arm back and rocks him on his
    heels, then the guard."""
    g = M.aim_weapon(guard(rig)).but(scale=dict(HELD))
    reach = g.but(scale=dict(GONE), fist_l=0.2, twist=14, lean=6, hand_l=(1.25, -1.15, 3.25),
                  pole_l=(0.4, 0.6, -0.8), hand_dir_l=_n((0.5, -0.8, 0.25)), hand_roll_l=-70, look=(-18, 4))
    caught = reach.but(scale=dict(HELD), fist_l=0.5)
    give = g.but(twist=-6, lean=-6, pelvis=(0.0, 0.2, -0.16), look=(-6, 6), hand_l=(0.85, -0.55, 3.0))
    keys = [(0.0, reach, 'linear'), (CATCH - 0.01, reach, 'linear'), (CATCH, caught, 'out'), (0.3, give, 'inout'),
            (CATCH_DUR, g, 'linear')]
    return keyed(keys), CATCH_DUR


def judgement(rig):
    """Sentence of the Tide: the blade drawn back by his ear, then levelled at the
    marked player at arm's length (POINT 0.45) and held there, the shield lowered to
    his side and the helm square to the doomed."""
    g = M.aim_weapon(guard(rig)).but(scale=dict(HELD))
    draw = g.but(twist=-12, lean=-2, look=(6, 4), hand_r=(-0.7, -0.15, 3.85), pole_r=(-1.0, 0.0, 0.2),
                 weapon=_n((0.05, -0.8, 0.6)), clav_r=10)
    point = g.but(twist=14, lean=6, neck=-4, look=(-6, 0), pelvis=(0.0, -0.1, -0.22), hip_twist=6,
                  hand_r=(-1.05, -1.05, 3.5), pole_r=(-0.6, 0.6, -0.5), weapon=_n((0.12, -0.99, 0.0)),
                  weapon_max=80.0, clav_r=8, **SIDE_L)
    keys = [(0.0, g, 'inout'), (0.24, draw, 'inout'), (POINT, point, 'out'),
            (0.75, point.but(lean=7, hand_r=(-1.05, -1.08, 3.52)), 'inout'),
            (JUDGE, point.but(lean=6), 'inout'), (1.15, point.but(lean=6), 'hold')]
    return keyed(keys), 1.15


def _vigil_base(g):
    """Down on his right knee: the left foot planted before him, the right knee on
    the flags, the sword's point set in the stones before him and his right fist on
    its pommel, the shield stood upright on its foot at his left side, the head
    bowed."""
    return g.but(pelvis=(0.0, 0.22, -0.98), lean=10, neck=22, look=(0, -20), twist=0, hip_tilt=0, side=0,
                 foot_l=(0.46, -0.46, SOLE), knee_l=(0.3, -1.0, 0.1), fyaw_l=6,
                 foot_r=(-0.42, 0.82, 0.24), fpitch_r=-50, knee_r=(-0.2, -1.0, -0.4), fyaw_r=10,
                 hand_r=(-0.22, -0.95, 2.18), pole_r=(-0.9, 0.3, -0.4), weapon=_n((0.03, -0.1, -0.99)),
                 hand_l=(1.05, -0.32, 1.62), pole_l=(0.7, 0.9, -0.3), hand_dir_l=SIDE_DIR, hand_roll_l=SIDE_ROLL,
                 fist_l=1.0, clav_l=0, clav_r=2)


def oath_kneel(rig):
    """The Unbroken Oath: he straightens, turns the sword point-down, and sinks onto
    his right knee (DOWN 1.1), the point set in the stones and the shield stood on its
    foot at his side, and bows his head over the hilt."""
    g = M.aim_weapon(guard(rig)).but(scale=dict(HELD))
    rise = g.but(lean=-4, neck=-6, look=(0, 10), pelvis=(0.0, 0.06, -0.06), twist=0,
                 hand_r=(-0.35, -1.0, 3.6), pole_r=(-1.0, 0.2, -0.2), weapon=_n((0.02, -0.25, -0.97)), **SIDE_L)
    knee = _vigil_base(g)
    bow = knee.but(neck=26, look=(0, -26), lean=12)
    sink = knee.but(pelvis=(0.0, 0.2, -0.8), lean=14, neck=12, look=(0, -8), hand_r=(-0.24, -1.0, 2.35),
                    foot_r=(-0.43, 0.62, SOLE + 0.22), fpitch_r=-30, knee_r=(-0.25, -1.0, -0.2))
    keys = [(0.0, g, 'inout'), (0.4, rise, 'inout'), (0.8, sink, 'expoin'), (DOWN, knee, 'out'),
            (KNEEL, bow, 'inout'), (1.65, bow, 'hold')]
    return keyed(keys), 1.65


def oath_vigil(rig, period=VIGIL):
    """The vigil kept in the water bubble: knelt and still, the breath rising and
    falling in the plate, the bowed head lifting a hair and sinking (the cloak is
    the kit's cloth, settling on the flags behind him)."""
    # the kneel's last pose (its bow), the blade's direction resolved into the wrist
    base = M.aim_weapon(_vigil_base(guard(rig).but(scale=dict(HELD))).but(neck=26, look=(0, -26), lean=12))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return base.but(lean=12 - 1.2 * br, neck=26 - 2.0 * br, look=(1.5 * math.sin(u), -26 + 2.5 * br),
                        clav_l=0.8 * br, clav_r=2 + 0.8 * br, pelvis=(0.0, 0.22, -0.98 + 0.012 * br))
    return fn


CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.2), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.24), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.42, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Attack3', attack3, False),
    ('OathCharge', oath_charge, False),
    ('Stunned', lambda r: (stunned(r), 2.4), True),
    ('Hit', hit, False),
    ('Death', death, False),
    ('Consecrate', consecrate, False),
    ('ShieldThrow', shield_throw, False),
    ('ShieldCatch', shield_catch, False),
    ('Judgement', judgement, False),
    ('OathKneel', oath_kneel, False),
    ('OathVigil', lambda r: (oath_vigil(r), VIGIL), True),
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
