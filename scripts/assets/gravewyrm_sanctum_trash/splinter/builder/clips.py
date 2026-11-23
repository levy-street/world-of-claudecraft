"""Every clip the Glacier Splinter ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
It moves like a glacier calving: heavy, grinding, the crystal fists dragging low,
the core's light breathing in its chest (the Core bone's scale pulses).

Death and Shatter are one story told in two clips: Death (2.0 s) drops it to its
knees while the core swells to bursting; on the 2 s Shatter the game hides the body
(the fx throw the shards), or plays Shatter (0.6 s) first: every piece flung out
from the core, spinning and shrinking to nothing by 0.5 s.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.75, 0.7, 0.62
RUN_PERIOD, RUN_HALF, RUN_STANCE = 1.0, 1.05, 0.42
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
SPIKES = [n for n in A.REST if 'Spike' in n]


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.05, -0.1), lean=12, neck=10, look=(0, 2),
                hand_r=(-1.32, -0.42, 2.3), pole_r=(-0.5, 0.9, -0.4), hand_dir_r=_n((-0.15, -0.3, -1.0)),
                hand_l=(1.32, -0.42, 2.3), pole_l=(0.5, 0.9, -0.4), hand_dir_l=_n((0.15, -0.3, -1.0)),
                foot_l=(0.6, -0.04, SOLE), foot_r=(-0.58, 0.16, SOLE), fyaw_l=10, fyaw_r=12,
                knee_l=(0.25, -1.0, 0.0), knee_r=(-0.25, -1.0, 0.0), clav_fwd_l=6, clav_fwd_r=6)


def guard(rig):
    return stance(rig).but(pelvis=(0.0, 0.1, -0.22), lean=18, neck=6, look=(0, 6), twist=-6,
                           hand_r=(-1.0, -0.95, 2.75), pole_r=(-0.9, 0.4, -0.4), hand_dir_r=_n((0.0, -0.7, -0.7)),
                           hand_l=(1.05, -0.85, 2.7), pole_l=(0.9, 0.4, -0.4), hand_dir_l=_n((0.0, -0.7, -0.7)),
                           foot_l=(0.68, -0.3, SOLE), foot_r=(-0.64, 0.36, SOLE), fyaw_r=22)


def pulse(t, period=1.25, amp=0.05):
    return {'Core': 1.0 + amp * (0.5 - 0.5 * math.cos(TAU * t / period))}


def idle(rig, period=5.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        g = math.sin(u)
        return st.but(lean=st.p['lean'] + 1.2 * math.sin(u * 2), twist=3 * g, look=(6 * g, 2 + 2 * math.sin(2 * u)),
                      pelvis=(0.02 * g, 0.05, -0.1 - 0.01 * (1 - math.cos(2 * u)) / 2), clav_l=1.5 * math.sin(2 * u),
                      clav_r=1.5 * math.sin(2 * u), scale=pulse(t, period / 4))
    return fn


def combat_idle(rig, period=2.0):
    g = guard(rig)

    def fn(t):
        u = TAU * t / period
        return g.but(lean=g.p['lean'] + 1.5 * math.sin(u), look=(4 * math.sin(u), 6), scale=pulse(t, period / 2, 0.07))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    st = stance(rig)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.58)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.57)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        bob = (-0.2 + 0.08 * math.cos(TAU * (ph * 2 - 0.15))) if run else (-0.12 + 0.05 * math.cos(TAU * (ph * 2 - 0.1)))
        lean = 22 if run else 15
        sw = 0.55 if run else 0.36
        al, ar = -sw * s1, sw * s1
        return st.but(
            pelvis=(0.07 * s1, 0.05, bob), hip_twist=-8 * s1, hip_roll=5 * s1, lean=lean + 3 * c2, twist=10 * s1,
            side=3 * s1, look=(-4 * s1, 2),
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=10, fyaw_r=12,
            hand_l=(1.28, -0.42 + al, 2.38 + abs(al) * 0.3 + (0.18 if run else 0)),
            hand_r=(-1.28, -0.42 + ar, 2.38 + abs(ar) * 0.3 + (0.18 if run else 0)),
            hand_dir_l=_n((0.15, -0.3 + al * 0.5, -1.0)), hand_dir_r=_n((-0.15, -0.3 + ar * 0.5, -1.0)),
            scale=pulse(t, period / 2))
    return fn


def attack(rig):
    """The right fist raised and driven down like a falling serac. CONTACT 0.8."""
    st = stance(rig)
    load = st.but(twist=-24, lean=2, side=-6, pelvis=(0.04, 0.12, -0.14), look=(8, 16),
                  hand_r=(-1.05, 0.3, 4.55), pole_r=(-1.0, 0.0, 0.3), hand_dir_r=_n((0.0, -0.3, 0.95)),
                  hand_l=(1.15, -0.65, 2.9), hand_dir_l=_n((0.2, -0.8, -0.4)), clav_r=14, scale={'Core': 1.08})
    hit = st.but(twist=22, lean=32, side=5, pelvis=(-0.04, -0.2, -0.4), look=(-6, -6),
                 hand_r=(-0.3, -1.45, 2.05), pole_r=(-0.9, 0.3, -0.3), hand_dir_r=_n((0.1, -0.4, -0.9)),
                 hand_l=(1.3, 0.1, 2.5), hand_dir_l=_n((0.4, 0.3, -0.85)), scale={'Core': 1.15})
    keys = [(0.0, st, 'inout'), (0.42, load, 'out'), (0.58, load.but(twist=-27), 'in'), (0.8, hit, 'out'),
            (1.08, hit.but(lean=29), 'inout'), (1.6, st, 'linear')]
    return keyed(keys), 1.6


def attack2(rig):
    """A low sweep of the left fist across its front. CONTACT 0.62."""
    st = stance(rig)
    load = st.but(twist=26, lean=14, pelvis=(-0.04, 0.08, -0.18), look=(-12, 4),
                  hand_l=(-0.25, -0.95, 3.0), pole_l=(0.6, 0.2, -0.9), hand_dir_l=_n((-0.6, -0.4, -0.6)),
                  hand_r=(-1.25, 0.05, 2.5))
    hit = st.but(twist=-26, lean=22, pelvis=(0.04, -0.1, -0.26), look=(14, 2),
                 hand_l=(1.85, -0.9, 2.7), pole_l=(0.4, 0.6, -0.8), hand_dir_l=_n((0.8, -0.2, -0.5)),
                 hand_r=(-1.25, -0.75, 2.5), scale={'Core': 1.1})
    keys = [(0.0, st, 'inout'), (0.38, load, 'in'), (0.62, hit, 'out'), (0.86, hit.but(twist=-29), 'inout'),
            (1.35, st, 'linear')]
    return keyed(keys), 1.35


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=4, twist=10, pelvis=(0.0, 0.14, -0.12), look=(-8, 12), hand_l=(1.4, 0.0, 2.5),
                  hand_r=(-1.4, -0.15, 2.5), scale={'Core': 1.12})
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.28, jolt.but(lean=8), 'inout'), (0.62, st, 'linear')]
    return keyed(keys), 0.62


def death(rig):
    """It staggers, drops to its knees and folds over its chest while the core
    swells and flares: the body is held together by nothing now. Knees 0.9; at 2.0 it
    is about to burst (the game's Shatter fires here)."""
    st = stance(rig)
    reel = st.but(lean=-6, look=(0, 22), pelvis=(0.0, 0.16, -0.08), twist=10, scale={'Core': 1.15},
                  hand_l=(1.5, -0.1, 2.9), hand_r=(-1.5, -0.2, 2.8))
    kneel = st.but(pelvis=(0.0, 0.45, -1.2), lean=30, neck=16, look=(0, -12), hip_tilt=10,
                   foot_l=(0.6, 0.95, 0.26), fpitch_l=-60, foot_r=(-0.58, 1.05, 0.26), fpitch_r=-60,
                   knee_l=(0.3, -1.0, -0.4), knee_r=(-0.3, -1.0, -0.4),
                   hand_r=(-0.95, -1.2, 0.85), hand_l=(0.95, -1.2, 0.85), hand_dir_r=_n((0, -0.3, -1)),
                   hand_dir_l=_n((0, -0.3, -1)), scale={'Core': 1.25})
    swell = kneel.but(lean=-10, neck=-14, look=(0, 30), pelvis=(0.0, 0.5, -1.0), hand_r=(-1.6, -0.3, 2.2),
                      hand_l=(1.6, -0.3, 2.2), hand_dir_r=_n((-0.4, 0.2, -0.9)), hand_dir_l=_n((0.4, 0.2, -0.9)),
                      clav_l=12, clav_r=12, scale={'Core': 1.6},
                      extra={n: [('x', -8.0)] for n in SPIKES})
    keys = [(0.0, st, 'out'), (0.35, reel, 'inout'), (0.9, kneel, 'out'), (1.3, kneel.but(scale={'Core': 1.32}), 'inout'),
            (1.85, swell, 'out'), (2.0, swell.but(scale={'Core': 1.75}), 'linear')]
    return keyed(keys), 2.0


def shatter(rig):
    """The burst: from Death's last pose every piece flies out from the core, spinning,
    and shrinks to nothing by 0.5 s (the core goes last, a flash at 0.1)."""
    sw = death(rig)[0](2.0)
    core = np.array(A.CORE_C)
    pieces = [n for n in A.REST if n not in ('Root', 'Core') and not n.endswith(('Fix',))]
    rng = np.random.default_rng(5)

    def fn(t):
        u = smooth(t / 0.5)
        offs, scl, ext = {}, {}, {}
        for n in pieces:
            h = np.array(A.REST[n][0])
            d = h - core
            d = d / (np.linalg.norm(d) + 1e-6) + rng.normal(0, 0.0, 3)
            offs[n] = tuple(d * 2.2 * u + np.array((0, 0, 0.8)) * math.sin(math.pi * min(1.0, u)))
            scl[n] = max(0.001, 1.0 - u)
        scl['Core'] = max(0.001, 1.75 * (1 - smooth(t / 0.18)))
        return sw.but(offset=offs, scale=scl)
    return fn, 0.6


FRACTURE_CRACK = 0.3


def fracture(rig):
    """Fracture (the split at half health; the original and the copy it throws off
    both play it): a crack runs through it, it staggers and every ice piece jolts
    out from the core, the core flaring white-blue, then the pieces grind back
    together and it braces again. CRACK 0.3 (the fx split there), braced by 1.4."""
    st = stance(rig)
    core = np.array(A.CORE_C)
    pieces = [n for n in A.REST if n not in ('Root', 'Core') and not n.endswith(('Fix',))]
    reel = st.but(lean=-8, twist=-14, look=(-10, 20), pelvis=(0.0, 0.2, -0.1), hand_l=(1.6, 0.0, 2.9),
                  hand_r=(-1.6, -0.1, 2.9), scale={'Core': 1.5})
    hunch = st.but(lean=22, twist=8, neck=16, look=(6, -10), pelvis=(0.0, -0.05, -0.32),
                   hand_l=(1.2, -0.7, 1.9), hand_r=(-1.2, -0.7, 1.9), scale={'Core': 1.2})
    seq = keyed([(0.0, st, 'out'), (FRACTURE_CRACK, reel, 'out'), (0.7, hunch, 'inout'), (1.05, hunch, 'inout'),
                 (1.4, st, 'linear')])

    def fn(t):
        b = seq(t)
        # The pieces jolt out from the core on the crack and grind back.
        u = smooth(t / FRACTURE_CRACK) if t < FRACTURE_CRACK else 1.0 - smooth((t - FRACTURE_CRACK) / 0.75)
        offs = {}
        for n in pieces:
            d = np.array(A.REST[n][0]) - core
            d = d / (np.linalg.norm(d) + 1e-6)
            offs[n] = tuple(d * 0.32 * u)
        return b.but(offset=offs)
    return fn, 1.4

CATALOG = [
    ('Idle', lambda r: (idle(r), 5.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.3), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.45, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Hit', hit, False),
    ('Death', death, False),
    ('Shatter', shatter, False),
    ('Fracture', fracture, False),
]


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        write_clip(arm, rig, name, f, dur, loop=loop, follow=False)
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
