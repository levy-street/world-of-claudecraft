"""Every clip the Sanctum Scaleguard ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect should land.
It is a sentinel: upright, the halberd stood at its right side, the tail low and
alive behind it. In a fight both hands close on the haft.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.25, 0.6, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.75, 0.95, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def tail(yaw=0.0, lift=0.0, curl=0.0, phase=0.0, wave=0.0):
    """Rest-frame turns down the tail: a yaw that grows toward the tip (plus a
    travelling wave), a lift and a sideways curl."""
    out = {}
    for i in range(4):
        w = (i + 1) / 4
        y = yaw * (0.4 + 0.6 * w) + wave * math.sin(phase - i * 0.9) * (0.5 + w)
        out[f'Tail{i + 1}'] = [('z', y), ('x', -lift * (0.6 + 0.4 * w)), ('y', curl * w)]
    return out


FOOT_L = (0.38, -0.02, SOLE)
FOOT_R = (-0.37, 0.16, SOLE)


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.04, -0.05), lean=6, neck=4, look=(0, -4), hip_tilt=4,
                hand_r=(-0.86, -0.3, 2.3), pole_r=(-0.5, 0.9, -0.35), weapon=_n((0.05, -0.12, 1.0)),
                hand_l=(0.82, -0.1, 2.3), pole_l=(0.55, 0.9, -0.3), hand_dir_l=_n((0.1, -0.15, -1.0)),
                hand_roll_l=-10, fist_l=0.45, spread_l=10,
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=8, fyaw_r=10,
                knee_l=(0.15, -1.0, 0.0), knee_r=(-0.15, -1.0, 0.0), extra=tail(lift=6, curl=6))


def guard(rig):
    """Both hands on the haft, the blade low and forward, the head down and watching."""
    return stance(rig).but(pelvis=(0.0, 0.1, -0.16), lean=12, neck=10, look=(0, 4), twist=-14,
                           hand_r=(-0.5, -0.45, 2.42), pole_r=(-0.9, 0.4, -0.3), weapon=_n((0.3, -0.85, 0.42)),
                           grip_l=-0.62, grip_w=1.0, pole_l=(0.9, 0.3, -0.4),
                           fyaw_r=18,
                           extra=tail(yaw=-8, lift=6))


def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u * 2)
        return st.but(lean=st.p['lean'] + 1.2 * br, clav_l=1.5 * br, clav_r=1.5 * br,
                      look=(8.0 * math.sin(u), -4 + 3.0 * math.sin(u * 2 + 0.6)), head_roll=3.0 * math.sin(u),
                      neck=4 + 2 * math.sin(u + 1.0), jaw=1.5 + 1.5 * (1 - math.cos(u * 2)) / 2,
                      scale={'Throat': 1.0 + 0.04 * (1 - math.cos(u * 2)) / 2},
                      extra=tail(lift=6, curl=6, yaw=6 * math.sin(u), wave=5, phase=u))
    return fn


def combat_idle(rig, period=2.0):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        br = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * br, pelvis=(0.0, 0.1, -0.16 - 0.012 * (1 - math.cos(u)) / 2),
                     look=(4 * math.sin(u), 4), extra=tail(yaw=-8 + 5 * math.sin(u), lift=6, wave=6, phase=u))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    st = M.aim_weapon(stance(rig).but(weapon=_n((0.1, -0.35, 0.93)) if not run else _n((0.2, -0.7, 0.68))))

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.36, heel_roll=24, toe_up=0)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.35, heel_roll=24, toe_up=0)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.16 + 0.07 * math.cos(TAU * (ph * 2 - 0.15))
            lean, swing = 22, 0.5
        else:
            bob = -0.08 + 0.04 * math.cos(TAU * (ph * 2 - 0.1))
            lean, swing = 10, 0.28
        al = -swing * s1
        ar = swing * 0.5 * s1
        return st.but(
            pelvis=(0.035 * s1, 0.04, bob), hip_twist=-8 * s1, hip_roll=4 * s1, lean=lean + 2.5 * c2, twist=7 * s1,
            neck=6 if run else 4, look=(-4 * s1, -2),
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=6, fyaw_r=8,
            hand_l=(0.8, -0.08 + al * 0.9, 2.36 + abs(al) * 0.25 + (0.15 if run else 0)),
            hand_dir_l=_n((0.1, -0.12 + al * 0.6, -1.0)),
            hand_r=(-0.8, -0.34 + ar * 0.8, 2.36 + abs(ar) * 0.2 + (0.2 if run else 0)),
            extra=tail(yaw=10 * s1, lift=(8 if run else 2), wave=8 if run else 5, phase=TAU * ph))
    return fn


def attack(rig):
    """Both hands, the halberd raised over the right shoulder and hewn down with the
    axe blade. CONTACT 0.76."""
    st = stance(rig)
    g = guard(rig)
    load = g.but(twist=-28, lean=0, pelvis=(0.03, 0.12, -0.08), look=(8, 8), hand_r=(-0.62, 0.0, 3.85),
                 pole_r=(-1.0, -0.2, 0.2), pole_l=(1.0, -0.3, 0.0), weapon=_n((0.15, 0.55, 0.82)), grip_l=-0.55,
                 extra=tail(yaw=14, lift=10))
    hit = g.but(twist=20, lean=28, pelvis=(-0.02, -0.18, -0.28), look=(-4, -14), hand_r=(-0.12, -1.0, 2.35),
                pole_r=(-0.8, 0.3, -0.5), pole_l=(0.8, 0.3, -0.5), weapon=_n((0.15, -0.75, -0.62)), grip_l=-0.55,
                extra=tail(yaw=-16, lift=14))
    keys = [(0.0, st, 'inout'), (0.22, g, 'inout'), (0.5, load, 'in'), (0.76, hit, 'out'),
            (1.0, hit.but(lean=25), 'inout'), (1.28, g, 'inout'), (1.6, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if t < 0.22:
            b = b.but(grip_w=smooth(t / 0.22))
        elif t > 1.28:
            b = b.but(grip_w=1 - smooth((t - 1.28) / 0.25))
        return b
    return fn, 1.6


def attack2(rig):
    """A two-handed thrust with the top spike, the tail flung out behind. CONTACT 0.52."""
    st = stance(rig)
    g = guard(rig)
    draw = g.but(twist=-24, lean=6, pelvis=(0.03, 0.2, -0.14), hand_r=(-0.62, 0.15, 2.65),
                 weapon=_n((0.25, -0.95, 0.15)), grip_l=-0.62, look=(4, 0), extra=tail(yaw=8, lift=4))
    lunge = g.but(twist=8, lean=24, pelvis=(0.0, -0.32, -0.3), hand_r=(-0.22, -1.2, 2.6), pole_r=(-0.9, 0.2, -0.4),
                  weapon=_n((0.12, -0.99, 0.0)), grip_l=-0.62, look=(0, -4), foot_l=(0.4, -0.6, SOLE),
                  knee_l=(0.2, -1.0, 0.2), extra=tail(yaw=-4, lift=22))
    keys = [(0.0, st, 'inout'), (0.18, g, 'inout'), (0.38, draw, 'in'), (0.52, lunge, 'out'),
            (0.8, lunge.but(lean=22), 'inout'), (1.08, g, 'inout'), (1.4, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if t < 0.18:
            b = b.but(grip_w=smooth(t / 0.18))
        elif t > 1.08:
            b = b.but(grip_w=1 - smooth((t - 1.08) / 0.25))
        for t0, t1 in ((0.38, 0.52), (0.8, 1.08)):      # the lunging foot leaves the ice to step
            if t0 < t < t1:
                u = (t - t0) / (t1 - t0)
                fl = b.p['foot_l']
                b = b.but(foot_l=(fl[0], fl[1], fl[2] + 0.2 * math.sin(math.pi * u)))
        return b
    return fn, 1.4


def cinder_breath(rig):
    """The 2 s Cinder Breath bar: it rears back, the throat swells and the slits blaze;
    at the bar's end the head drives forward, jaws wide, and the cone of cinders
    pours out from 2.0 to 2.55 (fire the breath VFX at 2.0); recovered by 2.8."""
    st = stance(rig)
    rear = st.but(lean=-14, neck=-22, look=(0, 32), pelvis=(0.0, 0.16, -0.04), jaw=10, clav_l=10, clav_r=10,
                  hand_l=(0.95, 0.1, 2.6), hand_dir_l=_n((0.4, 0.3, -0.85)), fist_l=0.8,
                  scale={'Throat': 1.28}, extra=tail(lift=10, yaw=-6))
    swell = rear.but(lean=-18, neck=-26, look=(0, 36), jaw=14, scale={'Throat': 1.4}, extra=tail(lift=14, yaw=6))
    breathe = st.but(lean=28, neck=30, look=(0, -18), pelvis=(0.0, -0.22, -0.18), jaw=40,
                     hand_l=(0.95, -0.4, 2.55), hand_dir_l=_n((0.5, -0.5, -0.7)), fist_l=0.2, spread_l=18,
                     scale={'Throat': 1.05}, extra=tail(lift=16))
    keys = [(0.0, st, 'inout'), (0.6, rear, 'inout'), (1.75, swell, 'expoin'), (2.0, breathe, 'linear'),
            (2.5, breathe.but(neck=26, look=(6, -12)), 'inout'), (2.85, st, 'linear')]
    return keyed(keys), 2.85


LASH_T = 1.0


def counterweight_lash(rig):
    """The 1 s Counterweight Lash bar: it plants both feet, glances back over its left
    shoulder and coils the spiked tail out to its right, the body wound against it;
    on the bar's end the tail whips across the whole cone behind it, right to left,
    the torso snapping round the other way as the counterweight. CONTACT 1.0 (the
    sweep crosses the rear from 0.92 to 1.1); recovered by 1.7."""
    st = stance(rig)
    g = M.aim_weapon(guard(rig))
    coil = g.but(twist=12, lean=4, pelvis=(0.04, 0.14, -0.2), look=(-38, 6), neck=2, hip_twist=10,
                 extra=tail(yaw=-46, lift=16, curl=-12))
    wind = coil.but(twist=16, look=(-40, 8), hip_twist=14, pelvis=(0.05, 0.16, -0.24),
                    extra=tail(yaw=-58, lift=22, curl=-16))
    whip = g.but(twist=-12, lean=10, pelvis=(-0.05, 0.04, -0.26), look=(-8, 6), hip_twist=-16,
                 extra=tail(yaw=50, lift=10, curl=14, wave=10, phase=0.6))
    follow = whip.but(twist=-10, look=(10, 2), hip_twist=-12, extra=tail(yaw=58, lift=6, curl=16, wave=6, phase=1.6))
    keys = [(0.0, st, 'inout'), (0.3, g, 'inout'), (0.62, coil, 'inout'), (0.86, wind, 'inout'),
            (LASH_T, whip.but(twist=-6, extra=tail(yaw=14, lift=18, curl=4)), 'inout'),
            (1.3, follow, 'inout'), (1.7, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if t < 0.3:
            b = b.but(grip_w=smooth(t / 0.3))
        elif t > 1.4:
            b = b.but(grip_w=1 - smooth((t - 1.4) / 0.3))
        return b
    return fn, 1.7


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-6, twist=12, pelvis=(0.0, 0.14, -0.08), look=(-10, 12), head_roll=-8, jaw=14,
                  hand_l=(0.95, 0.15, 2.45), extra=tail(yaw=-12, lift=8))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.27, jolt.but(lean=0), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """Rears back gasping a last cinder, folds at the knees and falls on its left side,
    the halberd clattering down beside it. Knees 0.9, on the ice 1.7, still from 2.2."""
    st = stance(rig)
    rear = st.but(lean=-12, neck=-16, look=(0, 30), jaw=30, pelvis=(0.0, 0.1, -0.06),
                  hand_l=(0.9, -0.3, 3.1), hand_dir_l=_n((0.2, -0.4, 0.9)), fist_l=0.1, spread_l=20,
                  extra=tail(lift=18))
    fold = st.but(pelvis=(0.0, 0.12, -0.55), lean=26, neck=10, look=(0, -10), jaw=12,
                  knee_l=(0.15, -1.0, 0.0), knee_r=(-0.15, -1.0, 0.0), hand_r=(-0.7, -0.6, 1.5), weapon=_n((0.4, -0.6, 0.7)),
                  hand_l=(0.7, -0.55, 1.3), hand_dir_l=_n((0.1, -0.4, -0.9)), extra=tail(lift=-4))
    down = st.but(roll=82, pelvis=(-1.7, 0.0, 0.66), lean=14, neck=-6, look=(10, 10), hip_tilt=6, jaw=18,
                  foot_l=(-0.98, 0.3, 0.42), foot_r=(-1.14, 0.45, 0.76), fpitch_l=-20, fpitch_r=-20,
                  knee_l=(0.2, -1.0, 0.4), knee_r=(0.2, -1.0, 0.4),
                  hand_r=(0.9, -0.85, 0.66), weapon=_n((-0.2, -0.98, 0.0)), pole_r=(0.0, 0.5, 1.0),
                  hand_l=(1.35, -1.25, 0.52), hand_dir_l=_n((0.3, -0.9, -0.2)), pole_l=(0.0, 0.3, 1.0), fist_l=0.3,
                  extra=dict(tail(yaw=20, curl=-10, lift=-10), L_Foot=[('y', 78.0)], R_Foot=[('y', 78.0)]))
    keys = [(0.0, st, 'out'), (0.35, rear, 'inout'), (0.9, fold, 'quadin'), (1.7, down, 'out'),
            (2.2, down.but(look=(-14, 8), jaw=22), 'hold'), (2.6, down.but(look=(-14, 8), jaw=22), 'hold')]
    return keyed(keys), 2.6


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.28), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.45, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('CinderBreath', cinder_breath, False),
    ('CounterweightLash', counterweight_lash, False),
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
