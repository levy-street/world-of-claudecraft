"""Every clip Balgath ships, with the encounter's timing contract written next to it.

Times are seconds from the clip's start. CONTRACT lines are the frames the game reads
(src/render/characters/manifest.ts, the BALGATH ClipMap and its time scales; the
windup and fuse constants; balgath_ranged_fx_core.ts; balgath_death_fx_core.ts):
change one and the blow stops landing with its blast.

Every blow is built the same way: a READY beat, an ANTICIPATION that loads the
weight the opposite way, a held APEX, the STRIKE accelerating into its contact
frame ('in' easing), a jolt and overshoot on IMPACT, a HOLD while the weight
settles, and a RECOVERY that eases back to the stance.
"""
import math

import numpy as np

import anatomy as A
from clips import Body, blend, hang, keys_of, stance

TAU = math.tau


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def L(p):
    return tuple(p)


def M(p):
    """Mirror a point to his right side."""
    return (-p[0], p[1], p[2])


# ------------------------------------------------------------------ locomotion
REST_ANKLE = np.array(A.ANKLE)
BALL_OFF = np.array(A.BALL) - REST_ANKLE                   # ankle -> ball of the foot
HEEL_OFF = np.array((0.0, 0.62, -0.92))                    # ankle -> back of the heel
SOLE_Z = 0.98                                              # ankle height with the sole flat


def _pitched(v, deg):
    c, s = math.cos(math.radians(-deg)), math.sin(math.radians(-deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def planted_ankle_z(pitch):
    """Ankle height that keeps the foot ON the ground at a pitch: a raised toe
    (heel strike, pitch > 0) rocks on the heel, a raised heel on the ball."""
    if pitch >= 0:
        heel = _pitched(HEEL_OFF, pitch)
        return SOLE_Z + (HEEL_OFF[2] - heel[2])
    ball = _pitched(BALL_OFF, pitch)
    return SOLE_Z + (BALL_OFF[2] - ball[2])


def gait_foot(phase, stance_frac, y_front, y_back, lift, side, x_out=1.75, toe_off=0.45):
    """Ankle target, foot direction and toe bend for one foot at `phase` (0 = heel
    strike). The planted foot slides back LINEARLY (no skating at the matched rate),
    rolls from heel to ball, and never sinks below the ground."""
    s = 1 if side > 0 else -1
    if phase < stance_frac:
        u = phase / stance_frac
        y = y_front + (y_back - y_front) * u
        heel = max(0.0, (u - 0.72) / 0.28)
        pitch = 14 * max(0.0, 1 - u / 0.14) - 38 * heel
        z = planted_ankle_z(pitch)
        toe = 34 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = y_back + (y_front - y_back) * e
        pitch = -38 * (1 - smooth(u * 1.6)) + 18 * smooth((u - 0.45) / 0.55)
        base = planted_ankle_z(pitch)
        z = base + lift * math.sin(math.pi * u) ** 1.3
        toe = 34 * (1 - smooth(u * 2.5))
    return (x_out * s, y, z), foot_dir(pitch, s), -toe


def foot_dir(pitch, s, yaw=0.0):
    rest_fd = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
    fd = np.array((0.1 * s, rest_fd[1], rest_fd[2]))
    c, sn = math.cos(math.radians(-pitch)), math.sin(math.radians(-pitch))
    fd = np.array((fd[0], fd[1] * c - fd[2] * sn, fd[1] * sn + fd[2] * c))
    if yaw:
        cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        fd = np.array((fd[0] * cy - fd[1] * sy, fd[0] * sy + fd[1] * cy, fd[2]))
    return tuple(fd)


def walk_body(rig, ph, half, base=None):
    base = base or stance(rig)
    fl, dl, tl = gait_foot(ph, 0.6, -half + 0.2, half + 0.2, 1.05, 1)
    fr, dr, tr = gait_foot((ph + 0.5) % 1.0, 0.6, -half + 0.2, half + 0.2, 1.05, -1)
    c1 = math.cos(TAU * ph)
    c3 = math.cos(TAU * (ph - 0.3))
    cl = math.cos(TAU * (ph - 0.5))
    bob = -0.5 - 0.2 * math.cos(2 * TAU * ph)
    sway = 0.26 * c3
    # A heavy, grounded march: the pelvis turns and rolls with the stride, and the
    # spine takes most of it back out, so the shoulder line only rolls a little
    # (measured: about 5 degrees of yaw and 4 of roll, peak to peak, down from 18
    # and 15). The chest used to ADD its
    # twist and side bend to the pelvis's (16 + 3.5 degrees on top of 7 + 4.5): the
    # great shoulders swung like a sprinter's.
    return base.but(
        pelvis=(sway, 0.15, bob), hip_twist=-7 * c1, hip_roll=-4.5 * c3,
        hip_tilt=6, lean=15 + 1.0 * math.cos(2 * TAU * ph), twist=10 * c1,
        side=-3.0 * c3, look=(-3 * c1, 9 + 1.5 * math.cos(2 * TAU * ph)), neck=5,
        # The arms swing from the stance's hang, opposite the legs: the fist rises and
        # the elbow folds as it comes forward, drops and opens as it goes back (never a
        # straight rod, never a locked elbow).
        hand_l=(6.1, -1.6 - 1.2 * cl, 5.35 + 0.5 * max(0, cl) + 0.22 * min(0, cl)),
        hand_r=(-6.0, -1.7 - 1.2 * c1, 5.3 + 0.5 * max(0, c1) + 0.22 * min(0, c1)),
        foot_l=fl, foot_r=fr, foot_dir_l=dl, foot_dir_r=dr, toe_l=tl, toe_r=tr,
        jaw=3 + 2 * math.cos(2 * TAU * ph), fist_l=0.55, fist_r=0.6)


def run_body(rig, ph, half, base=None):
    base = base or stance(rig)
    fl, dl, tl = gait_foot(ph, 0.36, -half - 0.1, half - 0.1, 2.0, 1, toe_off=0.6)
    fr, dr, tr = gait_foot((ph + 0.5) % 1.0, 0.36, -half - 0.1, half - 0.1, 2.0, -1, toe_off=0.6)
    c1 = math.cos(TAU * ph)
    c18 = math.cos(TAU * (ph - 0.18))
    bob = -0.85 + 0.4 * math.cos(2 * TAU * (ph - 0.43))
    # As the walk: the spine counters the pelvis, so the shoulders roll with the
    # strides (measured on the shoulder line: about 5 degrees of yaw and 2 of roll,
    # peak to peak, down from 22 and 20). The leaning spine bends about tipped axes,
    # so its counter-roll leads the pelvis's a little (the 0.1 phase is measured).
    return base.but(
        pelvis=(0.16 * c18, 0.4, bob), hip_twist=-10 * c1,
        hip_roll=-5 * c18, hip_tilt=12, lean=26 + 2 * math.cos(2 * TAU * (ph - 0.2)),
        twist=11 * c1, side=-6.5 * math.cos(TAU * (ph - 0.1)), look=(-1 * c1, 22), neck=8,
        hand_l=(4.6, -1.0 - 1.8 * math.cos(TAU * (ph - 0.5)), 6.0 + 0.8 * max(0, math.cos(TAU * (ph - 0.5)))),
        hand_r=(-4.6, -1.0 - 1.8 * c1, 6.0 + 0.8 * max(0, c1)),
        pole_l=(0.5, 1.0, -0.6),
        foot_l=fl, foot_r=fr, foot_dir_l=dl, foot_dir_r=dr, toe_l=tl, toe_r=tr, knee_l=(0.1, -1, 0.2),
        jaw=10 + 4 * math.cos(2 * TAU * ph), fist_l=0.95, fist_r=0.95, brow=6)


WALK_PERIOD, WALK_STRIDE = 1.75, 7.35     # 4.2 yd/s natural pace (walkRef)
RUN_PERIOD, RUN_STRIDE = 1.0, 8.38        # 8.38 yd/s (runRef)


def walk(rig):
    nfr = int(round(WALK_PERIOD * 24))
    half = WALK_STRIDE * 0.6 / 2
    return keys_of([(i / 24, walk_body(rig, (i / nfr) % 1.0, half), 'linear') for i in range(nfr + 1)], loop=True)


def run(rig):
    nfr = int(round(RUN_PERIOD * 24))
    half = RUN_STRIDE * 0.35 / 2
    return keys_of([(i / 24, run_body(rig, (i / nfr) % 1.0, half), 'linear') for i in range(nfr + 1)], loop=True)


def idle(rig, period=4.0):
    """Breathing: the chest swells and the shoulders rise, the gut follows; the head
    sways as he looks over the raid; the fists flex."""
    base = stance(rig)
    hl, hr = base.p['hand_l'], base.p['hand_r']
    keys = []
    for i in range(9):
        ph = i / 8
        br = math.sin(TAU * ph)
        b = base.but(
            pelvis=(0.04 * math.sin(TAU * ph), 0.1, -0.36 - 0.06 * br),
            lean=12 - 1.8 * br, neck=4 + 1.0 * br,
            clav_l=base.p['clav_l'] + 2.5 * br, clav_r=base.p['clav_r'] + 2.5 * br,
            look=(7 * math.sin(TAU * ph + 0.6), 9 + 2 * math.sin(TAU * ph * 2)),
            hand_l=(hl[0], hl[1], hl[2] + 0.12 * br), hand_r=(hr[0], hr[1], hr[2] + 0.12 * br),
            fist_l=base.p['fist_l'] + 0.1 * math.sin(TAU * ph + 1),
            fist_r=base.p['fist_r'] + 0.1 * math.sin(TAU * ph + 2.5),
            jaw=2 + 2 * max(0, -br), brow=6 + 2 * br)
        keys.append((period * ph, b, 'auto'))
    # one slow, heavy blink
    from clips import sample
    blink = []
    for t, lu, ll in ((2.0, 18, 7), (2.1, 74, 26), (2.24, 74, 26), (2.42, 18, 7)):
        blink.append((t, sample(keys, t, loop=True).but(lid_up=lu, lid_lo=ll), 'inout'))
    seq = [k for k in keys if k[0] < 2.0] + blink + [k for k in keys if k[0] > 2.42]
    seq = [(t, b, 'auto' if not (2.0 <= t < 2.42) else e) for t, b, e in seq]
    return keys_of(seq, loop=True)


# ------------------------------------------------------------------ melee
def swipe(rig):
    """Auto-attack: a backhand with the right fist. He coils the fist up in front of
    his left shoulder (well forward of the chest, elbow raised), then the hips and
    chest uncoil and the fist sweeps out in a wide flat arc IN FRONT of him, ahead of
    the gut, to finish out past his right side. The elbow leads, the arm opens from
    it, the forearm rolls palm-down through the hit. Swing carried by the torso: the
    shoulder line turns about 70 degrees between coil and follow-through."""
    st = stance(rig)
    coil = st.but(twist=30, lean=12, hip_twist=12, side=-3, look=(18, 8), pelvis=(0.3, 0.1, -0.45),
                  hand_r=(0.1, -6.6, 10.6), pole_r=(0.1, -0.35, 1.0), fist_r=1.0, clav_r=8, hand_roll_r=10,
                  brow=12, jaw=6, foot_r=(-1.75, 0.0, 0.98))
    coil = hang(coil, 'l', (-0.2, -0.3, 0.3))            # the off arm: a relaxed hang, counter-swinging
    sweep = st.but(twist=2, lean=18, hip_twist=-6, look=(0, 4), pelvis=(0.0, -0.1, -0.55),
                   hand_r=(-2.6, -7.0, 11.8), pole_r=(-0.3, 0.3, 1.0), fist_r=1.0, hand_roll_r=30,
                   brow=16, jaw=12)
    sweep = hang(sweep, 'l', (0.0, 0.3, 0.35))
    strike = st.but(twist=-30, lean=18, hip_twist=-14, side=3, look=(-16, 4), pelvis=(-0.3, 0.0, -0.6),
                    hand_r=(-7.2, -4.0, 9.8), pole_r=(-0.4, 0.6, 0.7), fist_r=1.0, hand_roll_r=40,
                    brow=16, jaw=16)
    strike = hang(strike, 'l', (0.1, 0.9, 0.4))
    follow = hang(strike.but(twist=-40, hand_r=(-6.9, -1.4, 8.6), pole_r=(-0.3, 0.8, 0.5), look=(-20, 2),
                             hand_roll_r=35, jaw=10), 'l', (0.1, 0.9, 0.4))
    return keys_of([(0, st, 'auto'), (0.24, coil, 'in'), (0.33, sweep, 'linear'), (0.4, strike, 'out'),
                    (0.54, follow, 'auto'), (0.85, st, 'auto')])


def punch(rig):
    """Attack variant: a straight heavy left, stepping into it. The fist chambers by
    the chest with the elbow down and back, the hips fire first, then the chest turns
    and the shoulder drives the fist out along one straight line down at the target,
    the forearm pronating so the knuckles land palm-down. The elbow stays under the
    arm the whole way (no roll of the upper arm); the weight goes forward onto the
    stepping left foot and the trailing heel lifts."""
    st = stance(rig)
    pole = (0.45, 0.45, -0.8)
    load = st.but(twist=26, lean=8, hip_twist=12, pelvis=(0.15, 0.45, -0.5), hand_l=(3.0, -1.6, 9.0),
                  pole_l=pole, fist_l=1.0, hand_roll_l=0, clav_l=8, look=(-6, 10), brow=10, jaw=4,
                  hand_r=(-5.0, -2.6, 6.6), foot_l=(1.75, 0.3, 0.98))
    drive = st.but(twist=14, lean=16, hip_twist=-10, pelvis=(0.1, -0.2, -0.75), hand_l=(2.4, -3.6, 8.0),
                   pole_l=pole, fist_l=1.0, hand_roll_l=25, clav_l=4, look=(0, 6), brow=14, jaw=8,
                   hand_r=(-5.2, -1.6, 6.4), foot_l=(1.85, -1.0, 0.98))
    hit = st.but(twist=-22, lean=28, hip_twist=-14, side=2, pelvis=(0.05, -0.9, -1.0), hand_l=(1.1, -7.6, 6.0),
                 pole_l=pole, fist_l=1.0, hand_roll_l=60, clav_l=-2, look=(4, 0), brow=18, jaw=16,
                 foot_l=(1.9, -1.5, 0.98), foot_r=(-1.8, 1.0, 0.98),
                 foot_dir_r=foot_dir(-18, -1), toe_r=-20)
    hit = hang(hit, 'r', (0.2, 1.3, 0.9), fist_r=0.9)    # the counter arm: drawn back, bent, palm in
    settle = hang(hit.but(lean=31, pelvis=(0.05, -0.95, -1.08), hand_l=(1.2, -7.3, 5.6), jaw=10), 'r',
                  (0.2, 1.2, 0.8))
    return keys_of([(0, st, 'auto'), (0.28, load, 'inout'), (0.37, drive, 'in'), (0.5, hit, 'out'),
                    (0.64, settle, 'inout'), (1.0, st, 'auto')])


def clobber(rig):
    """Attack variant: both fists clubbed down together in front of him."""
    st = stance(rig)
    up = st.but(lean=-4, hip_tilt=-4, pelvis=(0, 0.3, -0.25), hand_l=(2.2, -1.6, 15.1), hand_r=(-2.2, -1.6, 15.1),
                pole_l=(1.0, 0.4, 0.2), fist_l=1.0, fist_r=1.0, clav_l=14, clav_r=14, look=(0, 18), jaw=10, brow=6)
    down = st.but(lean=36, hip_tilt=10, pelvis=(0, -0.3, -1.05), hand_l=(1.7, -6.8, 4.1), hand_r=(-1.7, -6.8, 4.1),
                  pole_l=(1.0, 0.2, -0.3), fist_l=1.0, fist_r=1.0, look=(0, 0), jaw=18, brow=18)
    return keys_of([(0, st, 'auto'), (0.42, up, 'in'), (0.6, down, 'out'), (0.72, down.but(lean=38), 'auto'),
                    (1.1, st, 'auto')])


def crouch_reach(st, **kw):
    """A deep crouch that brings the shoulders low enough for the fists to meet the fen."""
    base = dict(hip_tilt=24, lean=46, pelvis=(0, -0.6, -1.9), neck=-16, look=(0, 24),
                foot_l=(2.05, -0.3, 0.98), foot_r=(-2.05, -0.3, 0.98), knee_l=(0.45, -1.0, 0.0),
                foot_dir_l=foot_dir(4, 1, -8), foot_dir_r=foot_dir(4, -1, 8))
    base.update(kw)
    return st.but(**base)


def smash(rig):
    """Barrow Smash (mob_pulse_windup): both fists overhead, then into the ground.
    CONTRACT: the fists land at 1.18 s of 1.75 s (played at 0.98: lands on the 1.2 s
    windup). The fist glow (both) burns until the impact."""
    st = stance(rig)
    dip = st.but(lean=22, hip_tilt=8, pelvis=(0, 0.15, -0.95), hand_l=(4.2, 0.6, 4.6), hand_r=(-4.2, 0.6, 4.6),
                 fist_l=0.9, fist_r=0.9, look=(0, 2), brow=8)
    raise_ = st.but(lean=-12, hip_tilt=-6, pelvis=(0, 0.45, -0.2), hand_l=(2.1, 0.6, 15.7),
                    hand_r=(-2.1, 0.6, 15.7), pole_l=(1.0, 0.6, 0.1), fist_l=1.0, fist_r=1.0, clav_l=22, clav_r=22,
                    look=(0, 26), neck=-4, jaw=26, brow=-6, eye=1.35,
                    foot_l=(2.05, 0.1, 0.98), foot_r=(-2.05, 0.1, 0.98))
    apex = raise_.but(lean=-16, pelvis=(0, 0.55, -0.1), hand_l=(1.8, 1.8, 15.6), hand_r=(-1.8, 1.8, 15.6), eye=1.5,
                      jaw=30)
    impact = crouch_reach(st, hand_l=(1.8, -5.3, 1.65), hand_r=(-1.8, -5.3, 1.65), pole_l=(1.0, 0.3, -0.4),
                          fist_l=1.0, fist_r=1.0,
                          jaw=24, brow=22, eye=1.2)
    jolt = impact.but(pelvis=(0, -0.65, -2.05), lean=48, look=(0, 18), jaw=20)
    hold = impact.but(pelvis=(0, -0.55, -1.8), lean=44, look=(0, 26), jaw=12, brow=16, eye=1.0)
    return keys_of([(0, st, 'auto'), (0.28, dip, 'auto'), (0.7, raise_, 'out'), (0.86, apex, 'in'),
                    (1.18, impact, 'out'), (1.24, jolt, 'auto'), (1.4, hold, 'inout'), (1.75, st, 'auto')])


def stomp(rig):
    """Barrow Stomp (mob_stomp_windup): the right knee drawn high, then driven down.
    CONTRACT: the heel lands at 0.70 s of 1.30 s (played at 0.58: 1.2 s windup)."""
    st = stance(rig)
    shift = st.but(pelvis=(0.55, 0.1, -0.5), hip_roll=5, side=-5, hand_l=(5.6, -0.6, 5.6), hand_r=(-5.2, -1.4, 6.6),
                   look=(0, 6))
    lift = st.but(pelvis=(0.75, 0.2, -0.2), hip_roll=9, hip_tilt=-4, side=-8, lean=6,
                  foot_r=(-1.85, -1.6, 3.9), foot_dir_r=foot_dir(-30, -1), knee_r=(-0.2, -1.0, 0.4),
                  hand_l=(6.3, -1.0, 8.4), hand_r=(-6.0, -0.8, 8.6), pole_l=(0.7, 0.8, -0.4), fist_l=1.0, fist_r=1.0,
                  look=(0, 14), jaw=16, brow=10, eye=1.2, clav_l=12, clav_r=12)
    impact = st.but(pelvis=(0.1, -0.1, -1.35), hip_tilt=10, lean=26, foot_r=(-1.9, -1.55, 0.98),
                    foot_dir_r=foot_dir(4, -1), knee_r=(-0.3, -1.0, 0.0), hand_l=(5.4, -2.6, 4.4),
                    hand_r=(-5.6, -2.4, 4.3), fist_l=1.0, fist_r=1.0, look=(0, -4), jaw=22, brow=22, eye=1.3)
    jolt = impact.but(pelvis=(0.1, -0.1, -1.55), lean=29)
    settle = st.but(foot_r=(-1.9, -1.55, 0.98), pelvis=(0.05, 0.0, -0.75), lean=18, jaw=8, brow=10)
    return keys_of([(0, st, 'auto'), (0.16, shift, 'auto'), (0.5, lift, 'quadin'), (0.7, impact, 'out'),
                    (0.76, jolt, 'auto'), (0.95, settle, 'inout'), (1.3, st.but(foot_r=(-1.8, -0.6, 0.98)), 'auto')])


def hammer(rig):
    """Barrow Hammer (mob_balgath_hammer): the right fist raised over a player and
    brought down. CONTRACT: lands at 1.30 s of 1.7 s (unscaled). Right fist glows."""
    st = stance(rig)
    load = st.but(twist=18, lean=4, hip_twist=8, pelvis=(-0.2, 0.3, -0.35), hand_r=(-5.4, 1.2, 15.0),
                  pole_r=(-1.0, 0.4, 0.3), fist_r=1.0, clav_r=20,
                  fist_l=0.1, spread_l=8, look=(-6, 20), jaw=12, brow=6)
    load = hang(load, 'l', (0.3, -1.5, 1.5))             # the off arm out in front for balance, elbow bent
    apex = load.but(twist=24, hand_r=(-5.1, 2.2, 15.5), lean=-2, look=(-8, 22), eye=1.3, jaw=18)
    impact = st.but(twist=-12, lean=30, hip_tilt=12, hip_twist=-6, pelvis=(-0.3, -0.7, -1.4),
                    hand_r=(-4.6, -6.2, 1.8), pole_r=(-1.0, 0.3, -0.3), fist_r=1.0,
                    fist_l=0.7, look=(4, 20), neck=-12, jaw=22, brow=22, eye=1.15,
                    foot_r=(-2.0, -1.2, 0.98), foot_l=(1.9, 0.6, 0.98), knee_l=(0.4, -1, 0))
    impact = hang(impact, 'l', (0.2, 0.7, 0.3))          # the off arm thrown back, bent, palm in
    jolt = impact.but(pelvis=(-0.3, -0.75, -1.5), lean=32)
    return keys_of([(0, st, 'auto'), (0.45, load, 'out'), (0.98, apex, 'in'), (1.3, impact, 'out'),
                    (1.36, jolt, 'auto'), (1.48, impact.but(lean=28, jaw=10), 'inout'), (1.7, st, 'auto')])


def cleave(rig):
    """Barrow Cleave (mob_balgath_cleave): the low arm dragged across the ground in
    front of him. CONTRACT: the arm crosses his front (the blow) at 1.50 s of 2.5 s
    (unscaled). Right fist glows."""
    st = stance(rig)
    wind = crouch_reach(st, twist=40, hip_twist=16, lean=32, pelvis=(0.3, 0.0, -1.45),
                        hand_r=(-8.7, -0.6, 5.2), pole_r=(-1.0, 0.6, 0.3), fist_r=1.0, hand_l=(7.2, -1.4, 5.4),
                        pole_l=(1.0, 0.6, 0.2), fist_l=0.3, spread_l=8, look=(-10, 18), jaw=10, brow=10)
    coil = wind.but(twist=46, hand_r=(-8.6, 0.3, 5.0), eye=1.2, jaw=16)
    mid = crouch_reach(st, twist=8, hip_twist=4, lean=46, pelvis=(0.0, -0.4, -1.95),
                       hand_r=(-0.4, -6.4, 2.8), pole_r=(-1.0, 0.0, 0.2), fist_r=1.0,
                       hand_l=(5.8, -2.4, 4.4), fist_l=0.5, look=(0, 18), jaw=26, brow=22, eye=1.25)
    through = crouch_reach(st, twist=34, hip_twist=14, lean=42, pelvis=(0.4, -0.3, -1.8),
                           hand_r=(3.6, -6.2, 2.4), pole_r=(-0.6, 0.6, 0.4), fist_r=1.0,
                           hand_l=(5.2, 1.0, 4.6), look=(16, 14), jaw=18, brow=18)
    side_ = crouch_reach(st, twist=20, hip_twist=6, lean=40, pelvis=(0.15, -0.2, -1.7), hand_r=(-6.6, -3.0, 3.4),
                         pole_r=(-1.0, 0.3, 0.2), fist_r=1.0, hand_l=(6.0, -3.4, 4.4), fist_l=0.4, look=(-4, 18), jaw=22,
                         brow=18, eye=1.2)
    out = st.but(lean=24, hip_tilt=10, pelvis=(0.15, 0.0, -1.0), twist=20, hand_r=(-7.8, -0.8, 6.2),
                 pole_r=(-1.0, 0.6, 0.2), fist_r=1.0, hand_l=(5.8, -2.6, 5.0), look=(-6, 12), brow=8)
    return keys_of([(0, st, 'auto'), (0.32, out, 'auto'), (0.62, wind, 'auto'), (1.15, coil, 'quadin'), (1.36, side_, 'linear'), (1.5, mid, 'linear'),
                    (1.72, through, 'out'), (2.0, through.but(twist=30, jaw=8), 'inout'), (2.5, st, 'auto')])


def barrowsweep(rig):
    """Barrowsweep (mob_warpath_swipe): the backhand thrown mid-run at whoever chases
    him. The legs ARE the Run cycle (one cycle, so at the 0.75 playback the composite
    advances at the same rate the real run would and cannot skate)."""
    half = RUN_STRIDE * 0.35 / 2
    nfr = int(round(RUN_PERIOD * 24))
    keys = []
    for i in range(nfr + 1):
        t = i / 24
        ph = (i / nfr) % 1.0
        b = run_body(rig, ph, half)
        # the upper body: wind (0-0.35), the backhand round behind (0.35-0.6), recover
        w = smooth(t / 0.32) * (1 - smooth((t - 0.32) / 0.18))
        h = smooth((t - 0.32) / 0.2) * (1 - smooth((t - 0.66) / 0.34))
        # (the throwing shoulder is authored level and unset, as the fold was tuned: the
        # stance's raised, set-back shoulder presses the folded biceps into the chest)
        wind = b.but(twist=34, side=0, look=(10, 16), hand_r=(-0.1, -6.4, 10.2), fist_r=1.0, pole_r=(0.1, -0.35, 1.0),
                     jaw=10, brow=6, clav_r=-4, clav_fwd_r=0)
        back = b.but(twist=-58, side=0, look=(-40, 16), hand_r=(-5.8, 3.4, 8.2), fist_r=1.0, pole_r=(-0.3, 1.0, -0.4),
                     jaw=26, brow=18, clav_r=-4, clav_fwd_r=0)
        b = blend([b, wind, back], [1 - w - h, w, h])
        # keep the run's legs exactly (the blend must not re-route the planted foot)
        legs = run_body(rig, ph, half)
        b.p.update({k: legs.p[k] for k in ('foot_l', 'foot_r', 'foot_dir_l', 'foot_dir_r', 'toe_l', 'toe_r',
                                           'pelvis', 'hip_twist', 'hip_roll', 'hip_tilt')})
        keys.append((t, b, 'linear'))
    # Each frame keeps its own clearance push: the backhand blends three upper bodies
    # within a third of a second, and an eased push carries one pose's elbow into the
    # next, folding the throwing arm's biceps into his chest (review.py `checks`).
    # The steadying pass still takes any shake out.
    return keys_of(keys, ease_clear=False)


def barrowfall(rig):
    """Barrowfall (mob_warpath_wreck, and his camp wreck): the two-fisted slam on the
    landmark he ran to. CONTRACT: the fists land at 1.40 s of 2.80 s (unscaled; the
    Starwake cast plays it at 0.56 so they land at 2.5 s). Both fists glow."""
    st = stance(rig)
    plant = st.but(lean=24, hip_tilt=10, pelvis=(0, -0.2, -0.9), foot_l=(2.2, -0.5, 0.98), foot_r=(-2.2, 0.3, 0.98),
                   hand_l=(4.6, 0.6, 5.2), hand_r=(-4.6, 0.6, 5.2), fist_l=1.0, fist_r=1.0, look=(0, 12), jaw=8)
    rise = st.but(lean=-14, hip_tilt=-8, pelvis=(0, 0.7, 0.2), foot_l=(2.2, -0.5, 0.98), foot_r=(-2.2, 0.3, 0.98),
                  hand_l=(1.8, 1.2, 16.4), hand_r=(-1.8, 1.2, 16.4), pole_l=(1.0, 0.7, 0.2), fist_l=1.0, fist_r=1.0,
                  clav_l=14, clav_r=14, look=(0, 30), neck=-6, jaw=32, brow=-8, eye=1.6, toe_l=-20, toe_r=-20)
    apex = rise.but(lean=-20, pelvis=(0, 0.95, 0.35), hand_l=(1.6, 2.6, 16.3), hand_r=(-1.6, 2.6, 16.3), eye=1.8)
    impact = crouch_reach(st, lean=52, hip_tilt=28, pelvis=(0, -1.0, -2.25), foot_l=(2.2, -0.5, 0.98),
                          foot_r=(-2.2, 0.3, 0.98), hand_l=(1.9, -6.7, 1.65), hand_r=(-1.9, -6.7, 1.65),
                          pole_l=(1.0, 0.3, -0.4), fist_l=1.0, fist_r=1.0, jaw=30, brow=24, eye=1.4)
    jolt = impact.but(pelvis=(0, -1.05, -2.45), lean=55, jaw=22)
    heave = impact.but(pelvis=(0, -0.9, -2.15), lean=50, look=(0, 30), jaw=6, brow=16, eye=1.0, clav_l=6, clav_r=6)
    heave2 = heave.but(clav_l=-2, clav_r=-2, pelvis=(0, -0.9, -2.2), jaw=14)
    return keys_of([(0, st, 'auto'), (0.32, plant, 'auto'), (0.82, rise, 'out'), (1.04, apex, 'in'),
                    (1.4, impact, 'out'), (1.47, jolt, 'auto'), (1.75, heave, 'inout'), (2.05, heave2, 'inout'),
                    (2.8, st, 'auto')])


def toss(rig):
    """Boulder Toss (mob_balgath_boulder): stoop, rip a boulder out of the fen, heave
    it overhead and hurl it. CONTRACT (balgath_ranged_fx_core.ts): the rock is in the
    ground until 0.55 s (RIP), held over his head by 1.1 s (LIFT), leaves his hands at
    1.45 s (RELEASE); he is standing again at 2.2 s. The renderer draws the boulder
    at his hands: low in front (1.3 x his scale forward) and overhead (3.35 x)."""
    rest = stance(rig)
    # The heave is authored on the shoulders it was tuned with (level, no set, the
    # elbows a little wider): overhead, his upper arms pass the head with nothing to
    # spare, and the resting stance's broad set-back shoulders close that gap.
    st = rest.but(pole_l=(0.8, 1.0, 0.1), clav_l=-4, clav_r=-4, clav_fwd_l=0, clav_fwd_r=0)
    rock_low = np.array((0.0, -5.0, 1.5))
    rock_high = np.array((0.0, -0.5, 16.6))
    grip = 1.55
    dig = crouch_reach(st, lean=50, hip_tilt=26, pelvis=(0, -0.8, -2.15), hand_l=L(rock_low + (grip, 0.3, 0.1)),
                       hand_r=L(rock_low + (-grip, 0.3, 0.1)), pole_l=(1.0, 0.3, -0.5), fist_l=0.25, fist_r=0.25,
                       spread_l=10, spread_r=10, hand_dir_l=(-0.75, -0.3, -0.45), hand_dir_r=(0.75, -0.3, -0.45), jaw=6,
                       brow=12)
    strain = dig.but(pelvis=(0, -0.7, -2.0), lean=46, hand_l=L(rock_low + (grip, 0.2, 0.25)),
                     hand_r=L(rock_low + (-grip, 0.2, 0.25)), jaw=24, brow=26, look=(0, 30), fist_l=0.4, fist_r=0.4)
    rip = st.but(lean=30, hip_tilt=14, pelvis=(0, -0.3, -1.3), hand_l=L(rock_low + (grip + 0.3, -0.6, 2.4)),
                 hand_r=L(rock_low + (-grip - 0.3, -0.6, 2.4)), pole_l=(1.0, 0.3, -0.5), hand_dir_l=(-0.9, 0, -0.3),
                 hand_dir_r=(0.9, 0, -0.3), fist_l=0.45, fist_r=0.45, jaw=28, brow=20, look=(0, 20),
                 foot_l=(2.05, -0.3, 0.98), foot_r=(-2.05, -0.3, 0.98))
    chest = st.but(lean=6, hip_tilt=2, pelvis=(0, 0.2, -0.6), hand_l=(2.0, -5.2, 10.0), hand_r=(-2.0, -5.2, 10.0),
                   hand_dir_l=(-0.9, 0, 0.3), hand_dir_r=(0.9, 0, 0.3), fist_l=0.45, fist_r=0.45, jaw=18, brow=14,
                   look=(0, 16), foot_l=(2.05, -0.3, 0.98), foot_r=(-2.05, -0.3, 0.98))
    over = st.but(lean=-14, hip_tilt=-6, pelvis=(0, 0.6, -0.15), hand_l=L(rock_high + (grip, 0.0, -0.1)),
                  hand_r=L(rock_high + (-grip, 0.0, -0.1)), pole_l=(1.0, 0.5, 0.0), hand_dir_l=(-0.85, 0, 0.5),
                  hand_dir_r=(0.85, 0, 0.5), fist_l=0.45, fist_r=0.45, clav_l=20, clav_r=20, look=(0, 30), jaw=20,
                  brow=4, eye=1.3, foot_l=(2.05, -0.3, 0.98), foot_r=(-2.05, 0.4, 0.98))
    cock = over.but(lean=-24, hip_tilt=-10, pelvis=(0, 0.9, -0.3), hand_l=L(rock_high + (grip, 1.4, -0.4)),
                    hand_r=L(rock_high + (-grip, 1.4, -0.4)), jaw=26, eye=1.45)
    release = st.but(lean=34, hip_tilt=14, pelvis=(0, -0.7, -0.9), hand_l=(3.5, -6.6, 9.6), hand_r=(-3.5, -6.6, 9.6),
                     pole_l=(1.0, 0.4, -0.5), fist_l=0.0, fist_r=0.0, spread_l=12, spread_r=12, jaw=34, brow=24,
                     eye=1.5, look=(0, 14), foot_l=(2.05, -1.2, 0.98), foot_r=(-2.05, 0.7, 0.98))
    follow = release.but(lean=40, hand_l=(3.8, -5.8, 5.8), hand_r=(-3.8, -5.8, 5.8), jaw=14, brow=12, eye=1.1)
    return keys_of([(0, rest, 'auto'), (0.32, dig, 'auto'), (0.5, strain, 'auto'), (0.55, strain, 'out'),
                    (0.78, rip, 'auto'), (0.94, chest, 'auto'), (1.1, over, 'auto'), (1.28, cock, 'in'),
                    (1.45, release, 'out'), (1.65, follow, 'inout'), (2.2, rest, 'auto')])


def eye_flare(rig):
    """Foreman's Glare (mob_balgath_glare) and his only channel (the cast slot): he
    hunches into it and the eye burns down a line. CONTRACT: the stretch peaks at
    1.30 s of 2.60 s (played at 0.52: the peak lands a beat before the 2.6 s glare)."""
    st = stance(rig)
    gather = st.but(lean=22, hip_tilt=8, pelvis=(0, 0.3, -0.85), neck=8, look=(0, -6), lid_up=34, lid_lo=12, eye=0.7,
                    brow=26, hand_l=(4.0, -1.8, 6.4), hand_r=(-4.0, -1.8, 6.4), fist_l=1.0, fist_r=1.0, clav_l=12,
                    clav_r=12, jaw=0)
    snap = st.but(lean=30, hip_tilt=10, pelvis=(0, -0.3, -0.9), neck=22, look=(0, 6), lid_up=-14, lid_lo=-8, eye=1.7,
                  brow=-10, hand_l=(5.4, 1.4, 6.8), hand_r=(-5.4, 1.4, 6.8), fist_l=0.0, fist_r=0.0, spread_l=18,
                  spread_r=18, jaw=20, clav_l=4, clav_r=4)
    peak = snap.but(neck=26, look=(0, 8), eye=2.0, lid_up=-16, jaw=26, hand_l=(5.8, 2.2, 7.4), hand_r=(-5.8, 2.2, 7.4))
    hold = peak.but(eye=1.8, neck=24, jaw=22)
    return keys_of([(0, st, 'auto'), (0.62, gather, 'quadin'), (1.0, snap, 'out'), (1.3, peak, 'auto'),
                    (1.78, hold, 'inout'), (2.6, st, 'auto')])


def roar(rig):
    """The enrage bellow (flourish) and the Barrow Burden's call: the breath drawn in,
    then the whole body thrown into the roar, arms flung wide, shaking with it."""
    st = stance(rig)
    inhale = st.but(lean=26, hip_tilt=8, pelvis=(0, 0.3, -0.95), neck=14, look=(0, -14), hand_l=(3.2, -1.8, 7.0),
                    hand_r=(-3.2, -1.8, 7.0), fist_l=1.0, fist_r=1.0, clav_l=-8, clav_r=-8, lid_up=20, brow=20)
    roar_ = st.but(lean=-14, hip_tilt=-8, pelvis=(0, 0.5, -0.3), neck=-6, look=(0, 30), jaw=38, brow=-12, eye=1.6,
                   lid_up=-14, hand_l=(7.0, 1.6, 10.2), hand_r=(-7.0, 1.6, 10.2), pole_l=(0.4, 1.0, -0.4),
                   fist_l=1.0, fist_r=1.0, clav_l=18, clav_r=18, foot_l=(2.0, 0.1, 0.98), foot_r=(-2.0, 0.1, 0.98))
    keys = [(0, st, 'auto'), (0.4, inhale, 'quadin'), (0.62, roar_, 'out')]
    for i in range(6):                                   # the shudder of the roar
        t = 0.78 + i * 0.14
        k = (1 if i % 2 else -1) * (1 - i / 7)
        keys.append((t, roar_.but(pelvis=(0.06 * k, 0.5, -0.3 + 0.04 * k), look=(4 * k, 30 + 2 * k),
                                  jaw=36 + 2 * k, clav_l=18 + 3 * k, clav_r=18 - 3 * k), 'auto'))
    keys += [(1.7, roar_.but(jaw=24, eye=1.3), 'inout'), (2.2, st, 'auto')]
    return keys_of(keys)


def burden(rig):
    """Barrow Burden (the soak): both palms pressed down on an unseen weight; he
    strains under it as it settles on the raid."""
    st = stance(rig)
    lift = st.but(lean=4, pelvis=(0, 0.3, -0.4), hand_l=(3.4, -3.6, 9.4), hand_r=(-3.4, -3.6, 9.4),
                  hand_dir_l=(0, -0.6, -0.1), hand_dir_r=(0, -0.6, -0.1), hand_roll_l=-70, hand_roll_r=-70,
                  fist_l=0.05, fist_r=0.05, spread_l=14, spread_r=14, look=(0, 22), jaw=8, eye=1.3, brow=8)
    press = st.but(lean=30, hip_tilt=12, pelvis=(0, -0.2, -1.5), hand_l=(2.4, -4.0, 4.4), hand_r=(-2.4, -4.0, 4.4),
                   hand_dir_l=(0, -0.7, -0.2), hand_dir_r=(0, -0.7, -0.2), hand_roll_l=-70, hand_roll_r=-70,
                   fist_l=0.05, fist_r=0.05, spread_l=16, spread_r=16, look=(0, 20), jaw=22, brow=26, eye=1.5,
                   foot_l=(2.1, -0.2, 0.98), foot_r=(-2.1, -0.2, 0.98))
    strain = press.but(pelvis=(0, -0.25, -1.62), lean=32, jaw=28, clav_l=6, clav_r=6)
    return keys_of([(0, st, 'auto'), (0.55, lift, 'inout'), (1.0, press, 'out'), (1.3, strain, 'inout'),
                    (1.55, press, 'inout'), (2.2, st, 'auto')])


def starwake(rig):
    """Wake of the Fallen Star (its cast bar): arms raised to call the star down,
    the eye burning, then both fists driven into the fen on one knee. CONTRACT: the
    fists land at 1.40 s of 2.80 s, the same beat as Barrowfall, so it can take the
    Starwake cast slot at the same 0.56 time scale (landing on the 2.5 s bar)."""
    st = stance(rig)
    call = st.but(lean=-18, hip_tilt=-8, pelvis=(0, 0.6, -0.2), neck=-10, look=(0, 40), hand_l=(3.4, 0.4, 16.8),
                  hand_r=(-3.4, 0.4, 16.8), pole_l=(1.0, 0.4, 0.2), hand_roll_l=60, hand_roll_r=60, fist_l=0.1,
                  fist_r=0.1, spread_l=16, spread_r=16, clav_l=24, clav_r=24, jaw=24, eye=2.1, lid_up=-14, brow=-10)
    apex = call.but(lean=-22, pelvis=(0, 0.75, -0.1), hand_l=(2.9, 1.0, 17.1), hand_r=(-2.9, 1.0, 17.1), eye=2.3,
                    jaw=30)
    fists = apex.but(fist_l=1.0, fist_r=1.0, hand_roll_l=0, hand_roll_r=0, hand_l=(1.9, 1.8, 16.8),
                     hand_r=(-1.9, 1.8, 16.8))
    kneel = Body(rig, pelvis=(0.2, -0.6, -2.45), hip_tilt=22, lean=40, neck=-14, look=(0, 30),
                 foot_l=(1.9, -2.2, 0.98), foot_dir_l=foot_dir(4, 1), knee_l=(0.2, -1.0, 0.1),
                 foot_r=(-1.9, 2.4, 1.75), foot_dir_r=(-0.05, 0.25, -1.0), toe_r=-45, knee_r=(-0.1, -0.2, -1.0),
                 hand_l=(1.8, -5.2, 1.65), hand_r=(-1.8, -5.2, 1.65), pole_l=(1.0, 0.3, -0.4),
                 fist_l=1.0, fist_r=1.0,
                 jaw=28, brow=24, eye=1.8)
    jolt = kneel.but(pelvis=(0.2, -0.65, -2.6), lean=43)
    hold = kneel.but(eye=1.4, jaw=12, look=(0, 36))
    return keys_of([(0, st, 'auto'), (0.62, call, 'out'), (0.9, apex, 'auto'), (1.04, fists, 'in'),
                    (1.4, kneel, 'out'), (1.47, jolt, 'auto'), (1.95, hold, 'inout'), (2.8, st, 'auto')])


# ------------------------------------------------------------------ reactions
def hit(rig):
    st = stance(rig)
    flinch = st.but(lean=-2, hip_tilt=-5, pelvis=(0.15, 0.75, -0.3), neck=-12, look=(-16, 26), lid_up=30, brow=24,
                    jaw=16, twist=-10, clav_l=12, clav_r=12, head_roll=10, side=4)
    flinch = hang(hang(flinch, 'l', (0.2, 0.5, 0.7)), 'r', (0.1, -0.5, 1.2))
    return keys_of([(0, st, 'auto'), (0.08, flinch, 'out'), (0.24, flinch.but(lean=4, look=(-10, 18)), 'inout'),
                    (0.62, st, 'auto')])


def blinded(rig):
    """The Shardpike in the eye (mob_eye_ward_blinded): the head snaps back, both
    hands clap over the eye, he reels back two steps and doubles over, shaking it.
    Ends in the BlindedLoop pose (the 14 s window plays that loop)."""
    st = stance(rig)
    snap = st.but(lean=-14, hip_tilt=-8, pelvis=(0, 0.7, -0.25), neck=-12, look=(8, 34), lid_up=60, lid_lo=20,
                  eye=0.3, jaw=30, brow=30, hand_l=(5.4, -1.2, 9.0), hand_r=(-5.4, -1.2, 9.0), fist_l=0.0,
                  fist_r=0.0, spread_l=20, spread_r=20, clav_l=16, clav_r=16, head_roll=-8)
    hold = blinded_hold(rig)
    clutch = cover_eye(hold.but(pelvis=(0, 1.2, -0.6), lean=10, foot_l=(1.8, 1.4, 0.98), foot_r=(-1.8, 0.2, 0.98)))
    reel = cover_eye(hold.but(pelvis=(-0.2, 1.4, -0.95), lean=24, foot_l=(1.8, 1.4, 0.98), foot_r=(-1.8, 1.8, 0.98),
                              head_roll=10))
    shake1 = cover_eye(reel.but(look=(-14, -8), head_roll=-10, pelvis=(0.2, 1.2, -1.0)))
    shake2 = cover_eye(reel.but(look=(12, -10), head_roll=12, pelvis=(-0.1, 1.0, -1.05)))
    end = blinded_hold(rig)
    return keys_of([(0, st, 'auto'), (0.12, snap, 'out'), (0.42, clutch, 'auto'), (0.85, reel, 'inout'),
                    (1.25, shake1, 'inout'), (1.6, shake2, 'inout'), (2.0, shake1, 'inout'), (2.6, end, 'auto')])


def cover_eye(b, both=True, reach=1.0):
    """Put the hands over the eye wherever the head is in this pose."""
    e = b.eye_point()
    x, f, u = b.head_frame()
    kw = dict(hand_l=tuple(e + f * 1.35 * reach + x * 0.75 - u * 1.2), pole_l=tuple(x * 1.0 - u * 0.6 + f * 0.2),
              hand_dir_l=tuple(-x * 0.55 + u * 0.75 - f * 0.1), fist_l=0.15, spread_l=8)
    if both:
        kw.update(hand_r=tuple(e + f * 1.55 * reach - x * 0.85 - u * 1.05), pole_r=tuple(-x * 1.0 - u * 0.6 + f * 0.2),
                  hand_dir_r=tuple(x * 0.6 + u * 0.7 - f * 0.1), fist_r=0.3, spread_r=6)
    return b.but(**kw)


def blinded_hold(rig):
    b = stance(rig).but(lean=30, hip_tilt=10, pelvis=(0, 0.6, -1.05), neck=10, look=(0, -14), lid_up=72, lid_lo=24,
                        eye=0.25, jaw=16, brow=28, clav_l=10, clav_r=10)
    return cover_eye(b)


def blinded_loop(rig, period=4.0):
    """The blind window held: hunched round the eye, swaying, the free hand groping."""
    base = blinded_hold(rig)
    keys = []
    for i in range(8):
        ph = i / 8
        s = math.sin(TAU * ph)
        c = math.cos(TAU * ph)
        keys.append((period * ph, base.but(pelvis=(0.25 * s, 0.6, -1.05 + 0.05 * c), side=4 * s, hip_roll=-3 * s,
                                          look=(10 * s, -14 + 4 * c), head_roll=6 * s,
                                          jaw=12 + 6 * max(0, s)), 'auto'))
        b = keys[-1][1]
        b = cover_eye(b, both=(i % 4 >= 2))
        if i % 4 < 2:
            b = b.but(hand_r=(-3.8 - 1.2 * c, -3.4 - 0.8 * s, 7.4 + 0.6 * s), pole_r=(-1.0, 0.4, -0.4), fist_r=0.3,
                      hand_dir_r=None, spread_r=14)
        keys[-1] = (keys[-1][0], b, 'auto')
    keys.append((period, keys[0][1], 'auto'))
    return keys_of(keys, loop=True)


def mend(rig, period=4.8):
    """Barrowmend (his regen while unharried): the left forearm held out in front of
    him, the right hand scoops fen mud from the ground and smears it along the top
    of that forearm, working it in. Slow breaths, the eye half-lidded. Every
    contact is ON the surface: the hand rides the top of the forearm, never into it."""
    st = stance(rig)
    base = st.but(lean=4, hip_tilt=2, pelvis=(0, 0.2, -0.7), look=(4, -2), neck=0, lid_up=36, eye=0.8, twist=10,
                  hand_l=(4.6, -7.6, 6.4), pole_l=(1.0, 0.5, -0.3), fist_l=0.35, hand_roll_l=20,
                  hand_r=(-4.4, -2.8, 6.4), pole_r=(-1.0, 0.4, -0.4), fist_r=0.4)
    scoop = base.but(hand_r=(-2.8, -5.6, 2.2), pole_r=(-1.0, 0.3, -0.3), fist_r=0.3, lean=36, hip_tilt=16,
                     pelvis=(0, -0.2, -1.7), look=(-8, 2), hand_roll_r=40)
    lift = base.but(hand_r=(-1.6, -8.0, 8.2), pole_r=(-1.0, 0.0, -0.4), fist_r=0.3, hand_roll_r=60, look=(8, -8))
    smear_a = base.but(twist=12, hip_twist=4, hand_r=(2.6, -8.8, 7.4), pole_r=(-0.8, -0.2, -0.6), fist_r=0.1, spread_r=10, hand_roll_r=70,
                       look=(10, -10))
    smear_b = smear_a.but(hand_r=(3.3, -8.4, 7.4), look=(2, -4))
    return keys_of([(0, base, 'auto'), (0.8, scoop, 'inout'), (1.4, lift, 'auto'), (1.9, smear_a, 'auto'),
                    (2.5, smear_b, 'auto'), (3.1, smear_a, 'auto'), (3.7, smear_b.but(hand_r=(3.0, -9.0, 7.1)), 'inout'),
                    (period, base, 'auto')],
                   loop=True)


def death(rig):
    """Death: the eye gutters out, he staggers, his knees go and he topples backward
    about his heels. CONTRACT: his back hits the fen at 1.80 s (BALGATH_DEATH_IMPACT_SEC,
    deathTimeScale 1); the last frame is the corpse the renderer holds for the whole
    corpse window, so it is a settled resting pose."""
    st = stance(rig)
    shock = st.but(lean=-8, hip_tilt=-4, pelvis=(0, 0.6, -0.25), neck=-14, look=(0, 36), jaw=30, brow=24, eye=0.55,
                   lid_up=20, hand_l=(5.8, -1.6, 8.4), hand_r=(-5.8, -1.6, 8.4), fist_l=0.1, fist_r=0.1,
                   spread_l=16, spread_r=16, clav_l=14, clav_r=14)
    buckle = st.but(lean=6, hip_tilt=4, pelvis=(0, 1.4, -1.7), neck=-8, look=(6, 30), jaw=24, eye=0.3, lid_up=34,
                    hand_l=(6.0, 1.0, 6.8), hand_r=(-6.0, 1.2, 7.2), fist_l=0.0, fist_r=0.0,
                    foot_l=(1.8, 1.5, 0.98), foot_r=(-1.8, 0.4, 0.98), knee_l=(0.3, -1.0, 0.0))
    # falling: the whole body turns about the heels (Root pitch, negative = backward)
    tip = Body(rig, pitch=-30, pelvis=(0, -1.0, -1.0), lean=2, neck=-14, look=(0, 30), jaw=26, eye=0.15, lid_up=40,
               hand_l=(6.6, 1.4, 9.6), hand_r=(-6.4, 1.2, 10.0), fist_l=0.0, fist_r=0.0, spread_l=12, spread_r=12,
               foot_l=(1.8, 1.7, 0.98), foot_r=(-1.8, 1.4, 0.98), pole_l=(0.6, 1.0, 0.4))
    fall = Body(rig, pitch=-66, pelvis=(0, -0.4, 1.8), neck=-18, look=(4, 34), jaw=28, eye=0.05, lid_up=46,
                hand_l=(7.0, 4.6, 6.4), hand_r=(-6.8, 4.2, 6.8), fist_l=0.0, fist_r=0.0, spread_l=14, spread_r=14,
                foot_l=(1.8, 1.4, 1.3), foot_r=(-1.8, 1.0, 1.7), pole_l=(0.6, 1.0, 0.4))
    lie = Body(rig, pitch=-90, pelvis=(0, -0.8, 4.0), neck=-10, look=(10, 18), head_roll=8, jaw=22, eye=0.02, lid_up=52,
               lid_lo=10, hand_l=(7.4, 6.6, 1.2), hand_r=(-7.2, 6.0, 1.3), pole_l=(0.4, 0.2, 1.0),
               hand_dir_l=(0.4, 0.6, 0.05), hand_dir_r=(-0.4, 0.6, 0.05), fist_l=0.0, fist_r=0.0, spread_l=10,
               spread_r=10, foot_l=(2.3, 2.0, 0.9), foot_r=(-2.1, 2.3, 0.9), knee_l=(0.3, -0.2, 1.0),
               foot_dir_l=(0.2, -0.3, 1.2), foot_dir_r=(-0.2, -0.3, 1.2))
    bounce = lie.but(pelvis=(0, -0.8, 4.3), neck=-18, look=(8, 28), jaw=26)
    rest_ = lie.but(neck=-6, look=(16, 10), head_roll=14, jaw=16, lid_up=56, lid_lo=14,
                    foot_l=(2.5, 2.5, 0.9), foot_r=(-2.3, 2.8, 0.9),
                    hand_l=(7.6, 6.8, 1.15), hand_r=(-7.4, 6.2, 1.2), fist_l=0.25, fist_r=0.3)
    return keys_of([(0, st, 'auto'), (0.2, shock, 'out'), (0.62, buckle, 'inout'), (1.05, tip, 'quadin'),
                    (1.45, fall, 'expoin'), (1.8, lie, 'out'), (1.95, bounce, 'inout'), (2.2, lie, 'inout'),
                    (3.0, rest_, 'auto')])


def sleep_body(rig, br=0.0):
    """The mound: sat on his heels, curled forward over his knees, arms folded under
    his head, the stone of his back to the sky."""
    return Body(rig, pelvis=(0, 1.3, -3.35 + 0.06 * br), hip_tilt=38, lean=46 - 2.5 * br, neck=20, look=(14, -20),
                head_roll=12, foot_l=(1.9, 1.6, 1.0), foot_r=(-1.9, 1.6, 1.0), foot_dir_l=(0.05, 1.0, -0.2),
                foot_dir_r=(-0.05, 1.0, -0.2), toe_l=0, toe_r=0, knee_l=(0.35, -1.0, -0.2),
                hand_l=(1.6, -5.6, 1.4), hand_r=(-1.2, -5.0, 1.0), pole_l=(1.0, 0.2, 0.2), hand_dir_l=(-0.8, 0.0, -0.3),
                hand_dir_r=(0.9, -0.2, -0.2), fist_l=0.4, fist_r=0.5, lid_up=72, lid_lo=24, eye=0.2,
                jaw=3 + 2 * br, clav_l=-4 + 3 * br, clav_r=-4 + 3 * br)


def sleep(rig, period=3.8):
    keys = []
    for i in range(8):
        ph = i / 8
        keys.append((period * ph, sleep_body(rig, math.sin(TAU * ph)), 'auto'))
    keys.append((period, keys[0][1], 'auto'))
    # Each frame keeps its own clearance push: Wake starts from this loop's exact first
    # pose (the asset suite pins the seam), and Wake keeps its own pushes too.
    return keys_of(keys, loop=True, ease_clear=False)


def wake(rig):
    """Dawn: he stirs, levers himself up out of the mound on his fists, opens the eye
    (it FLARES), stands, and shakes the night off his shoulders."""
    st = stance(rig)
    s0 = sleep_body(rig)
    stir = s0.but(lean=40, neck=10, look=(0, -6), eye=0.4, lid_up=60)
    push = Body(rig, pelvis=(0, 0.8, -3.0), hip_tilt=34, lean=40, neck=0, look=(0, 10), foot_l=(1.9, 1.4, 1.2),
                foot_r=(-1.9, 1.4, 1.0), foot_dir_l=(0.05, 0.8, -0.6), foot_dir_r=(-0.05, 0.8, -0.6), toe_l=0,
                toe_r=0, knee_l=(0.35, -1.0, -0.2), hand_l=(2.4, -3.6, 1.7), hand_r=(-2.4, -3.6, 1.7),
                pole_l=(1.0, 0.4, 0.0), hand_dir_l=(-0.1, -0.3, -1.0), hand_dir_r=(0.1, -0.3, -1.0), fist_l=1.0,
                fist_r=1.0, lid_up=40, eye=0.6, jaw=6, brow=10)
    knee = Body(rig, pelvis=(0.2, -0.2, -2.3), hip_tilt=18, lean=26, look=(0, 16),
                foot_l=(1.9, -1.8, 0.98), knee_l=(0.2, -1.0, 0.1), foot_r=(-1.9, 2.2, 1.75), foot_dir_r=(-0.05, 0.25, -1.0),
                toe_r=-45, knee_r=(-0.1, -0.2, -1.0), hand_l=(3.0, -2.6, 5.0), hand_r=(-3.4, -3.0, 1.0),
                hand_dir_r=(0.1, -0.3, -1.0), fist_l=0.8, fist_r=1.0, lid_up=12, eye=1.0, jaw=8)
    flare = knee.but(lid_up=-16, lid_lo=-8, eye=2.2, brow=-8, look=(0, 26), jaw=20)
    stand = st.but(lean=-6, hip_tilt=-4, pelvis=(0, 0.3, -0.2), look=(0, 22), clav_l=16, clav_r=16, eye=1.6,
                   hand_l=(5.8, -0.6, 6.4), hand_r=(-5.8, -0.6, 6.4), fist_l=1.0, fist_r=1.0, jaw=16)
    shake_a = stand.but(look=(-14, 16), head_roll=-8, clav_l=4, clav_r=20, eye=1.3)
    shake_b = stand.but(look=(12, 14), head_roll=8, clav_l=20, clav_r=4, eye=1.2)
    step = push.but(foot_l=(1.9, -0.2, 2.4), foot_dir_l=foot_dir(-10, 1), pelvis=(0.1, 0.3, -2.7), lean=34)
    # He shoves himself up off his thigh: each frame keeps its own clearance push, or an
    # eased one lets the bracing fist sink into the thigh as he rises (review.py checks).
    return keys_of(ease_clear=False, seq=[(0, s0, 'auto'), (0.55, stir, 'inout'), (1.3, push, 'inout'), (1.68, step, 'auto'), (2.0, knee, 'auto'),
                    (2.3, flare, 'out'), (2.85, stand, 'inout'), (3.2, shake_a, 'inout'), (3.5, shake_b, 'inout'),
                    (3.95, st, 'auto')])


def jump(rig):
    st = stance(rig)
    load = st.but(pelvis=(0, 0.2, -1.6), hip_tilt=16, lean=30, hand_l=(5.0, 1.6, 4.6), hand_r=(-5.0, 1.6, 4.6),
                  fist_l=1.0, fist_r=1.0, jaw=6)
    air = st.but(pelvis=(0, 0.0, 2.6), lean=4, foot_l=(1.8, -0.8, 2.6), foot_r=(-1.8, 0.4, 3.0),
                 foot_dir_l=foot_dir(-20, 1), foot_dir_r=foot_dir(-30, -1), hand_l=(5.2, -2.0, 10.0),
                 hand_r=(-5.2, -2.0, 10.0), jaw=14, eye=1.2)
    land = st.but(pelvis=(0, -0.1, -1.7), hip_tilt=14, lean=28, hand_l=(5.2, -2.0, 4.0), hand_r=(-5.2, -2.0, 4.0),
                  fist_l=1.0, fist_r=1.0, jaw=18, brow=14)
    return keys_of([(0, st, 'auto'), (0.4, load, 'quadin'), (0.62, air.but(pelvis=(0, 0.0, 1.0)), 'out'),
                    (0.95, air, 'quadin'), (1.25, land, 'out'), (1.5, land.but(pelvis=(0, -0.1, -1.5)), 'inout'),
                    (2.0, st, 'auto')])


def rest_pose(rig, period=1.0):
    b = Body(rig, fist_l=0.0, fist_r=0.0)
    return keys_of([(0, b, 'auto'), (period, b, 'auto')])


# name, builder, loops, march drag (yards/s)
CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, 4.2),
    ('Run', run, True, 8.4),
    ('Balgath_Swipe', swipe, False, 0.0),
    ('Balgath_Punch', punch, False, 0.0),
    ('Balgath_Clobber', clobber, False, 0.0),
    ('Balgath_Smash', smash, False, 0.0),
    ('Balgath_Stomp', stomp, False, 0.0),
    ('Balgath_Hammer', hammer, False, 0.0),
    ('Balgath_Cleave', cleave, False, 0.0),
    ('Balgath_Barrowsweep', barrowsweep, True, 8.4),
    ('Balgath_Barrowfall', barrowfall, False, 0.0),
    ('Balgath_Toss', toss, False, 0.0),
    ('Balgath_EyeFlare', eye_flare, False, 0.0),
    ('Balgath_Roar', roar, False, 0.0),
    ('Balgath_Burden', burden, False, 0.0),
    ('Balgath_Starwake', starwake, False, 0.0),
    ('Balgath_Blinded', blinded, False, 0.0),
    ('Balgath_BlindedLoop', blinded_loop, True, 0.0),
    ('Balgath_Mend', mend, True, 0.0),
    ('Hit', hit, False, 0.0),
    ('Balgath_Death', death, False, 0.0),
    ('Balgath_Sleep', sleep, True, 0.0),
    ('Balgath_Wake', wake, False, 0.0),
    ('Jump', jump, False, 0.0),
]
