"""Every clip the Nacre Templeguard ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect lands.
It stands like a temple knight at its post: the trident upright at its right
side, the scallop shield on its left forearm, the seahorse tail curled behind
its heels, the fan crest opening and closing as if a current moved through it.
"""
import math

import numpy as np
from mathutils import Vector

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, WALK_HALF, WALK_STANCE = 1.3, 0.56, 0.6
RUN_PERIOD, RUN_HALF, RUN_STANCE = 0.8, 0.98, 0.4
WALKREF = round(2 * WALK_HALF / (WALK_STANCE * round(WALK_PERIOD * 24) / 24), 3)
RUNREF = round(2 * RUN_HALF / (RUN_STANCE * round(RUN_PERIOD * 24) / 24), 3)
SOLE = A.SOLE_Z
SWEEP_CAST, HURL_CAST = 1.5, 1.8          # the sim's cast bars (temple.ts): the blow lands at the bar's end


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def tail(sway=0.0, lift=0.0, curl=0.0, phase=0.0, wave=0.0):
    """Turns down the tail: a sideways sway growing to the tip (plus a travelling
    wave), a lift away from the legs, and the tip's curl winding tighter (+)."""
    out = {}
    for i in range(5):
        w = (i + 1) / 5
        y = sway * (0.3 + 0.7 * w) + wave * math.sin(phase - i * 0.8) * (0.4 + w)
        out[f'Tail{i + 1}'] = [('z', y), ('x', lift * (0.5 + 0.5 * w))]
    out['Tail6'] = [('x', -curl), ('z', sway * 0.5)]
    return out


def crest(open_=0.0):
    """The fan crest: + spreads the fins apart (front forward, back fins back)."""
    return {'Crest1': [('x', open_ * 0.7)], 'Crest2': [('x', -open_)]}


def extra(**kw):
    o = tail(**{k: v for k, v in kw.items() if k in ('sway', 'lift', 'curl', 'phase', 'wave')})
    o.update(crest(kw.get('crest', 0.0)))
    return o


FOOT_L = (0.43, -0.04, SOLE)
FOOT_R = (-0.42, 0.16, SOLE)
SHIELD_REST = dict(hand_l=(0.98, -0.12, 2.62), pole_l=(0.8, 0.9, -0.3), hand_dir_l=_n((0.15, -0.25, -1.0)),
                   hand_roll_l=0.0, fist_l=0.85)
SHIELD_UP = dict(hand_l=(0.2, -1.02, 3.02), pole_l=(1.0, 0.1, -0.7), hand_dir_l=_n((-1.0, -0.15, 0.1)),
                 hand_roll_l=-60.0, fist_l=0.85)


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.03, -0.06), lean=5, neck=6, look=(0, -2), hip_tilt=3,
                hand_r=(-1.02, -0.3, 2.58), pole_r=(-0.5, 0.9, -0.35), weapon=_n((-0.1, -0.12, 1.0)),
                foot_l=FOOT_L, foot_r=FOOT_R, fyaw_l=6, fyaw_r=10,
                knee_l=(0.15, -1.0, 0.0), knee_r=(-0.15, -1.0, 0.0),
                scale=dict(A.HIDDEN), extra=extra(lift=4, crest=0.0), **SHIELD_REST)


def guard(rig):
    """The braced battle stance: shield up across the chest, the trident levelled
    underhand at the hip, the head low behind the shield's rim."""
    return stance(rig).but(pelvis=(0.0, 0.12, -0.2), lean=12, neck=10, look=(0, 6), twist=-12,
                           hand_r=(-0.72, -0.38, 2.62), pole_r=(-0.9, 0.5, -0.3), weapon=_n((0.12, -0.95, 0.28)),
                           foot_l=(0.46, -0.32, SOLE), foot_r=(-0.44, 0.34, SOLE), fyaw_r=22,
                           extra=extra(lift=8, sway=-6, crest=12), **SHIELD_UP)


def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        return st.but(pelvis=(0.025 * s1, 0.03, -0.06 - 0.012 * (1 - math.cos(2 * u)) / 2),
                      hip_roll=1.5 * s1, side=-1.6 * s1, lean=st.p['lean'] + 1.2 * s2, clav_l=1.2 * s2,
                      clav_r=1.2 * s2, look=(7.0 * s1, -2 + 2.5 * s2), head_roll=2.5 * s1,
                      extra=extra(lift=4 + 2 * s2, sway=7 * s1, wave=4, phase=u - math.pi * 0.0, curl=8 * s2,
                                  crest=10 * (1 - math.cos(u)) / 2))
    return fn


def combat_idle(rig, period=2.0):
    g = M.aim_weapon(guard(rig))

    def fn(t):
        u = TAU * t / period
        s1 = math.sin(u)
        return g.but(lean=g.p['lean'] + 1.5 * s1, pelvis=(0.0, 0.12, -0.2 - 0.015 * (1 - math.cos(u)) / 2),
                     look=(4 * s1, 6), extra=extra(lift=8, sway=-6 + 5 * s1, wave=5, phase=u, crest=12 + 4 * s1))
    return fn


def gait(rig, period, half, stance_frac, lift, run=False):
    base = stance(rig)
    if run:
        # the Onrush read: the trident couched like a lance, the shield up, leaning in
        base = base.but(hand_r=(-0.62, -0.6, 2.75), weapon=_n((0.1, -1.0, 0.06)), pole_r=(-1.0, 0.3, -0.4),
                        **SHIELD_UP)
    else:
        base = base.but(weapon=_n((-0.06, -0.3, 0.95)))
    st = M.aim_weapon(base)

    def fn(t):
        ph = (t / period) % 1.0
        fl, pl, tl = M.gait_foot(ph, stance_frac, -half, half, lift, 1, 0.42, heel_roll=26, toe_up=14)
        fr, pr, tr = M.gait_foot((ph + 0.5) % 1.0, stance_frac, -half, half, lift, -1, 0.42, heel_roll=26, toe_up=14)
        c2 = math.cos(TAU * ph * 2)
        s1 = math.sin(TAU * ph)
        if run:
            bob = -0.2 + 0.08 * math.cos(TAU * (ph * 2 - 0.15))
            lean, sw = 20, 0.0
        else:
            bob = -0.08 + 0.045 * math.cos(TAU * (ph * 2 - 0.1))
            lean, sw = 6, 0.22
        out = st.but(
            pelvis=(0.04 * s1, 0.04, bob), hip_twist=-8 * s1, hip_roll=4 * s1, lean=lean + 2.5 * c2,
            twist=6 * s1 - (10 if run else 0), neck=8 if run else 6, look=(-4 * s1, 4 if run else -2),
            foot_l=fl, foot_r=fr, fpitch_l=pl, fpitch_r=pr, toe_l=tl, toe_r=tr, fyaw_l=4, fyaw_r=6,
            extra=extra(sway=9 * s1, lift=(14 if run else 6), wave=7 if run else 5, phase=TAU * ph,
                        curl=6 * c2, crest=(18 if run else 6)))
        if not run:
            ar = sw * 0.6 * s1
            out = out.but(hand_r=(-1.0, -0.3 + ar, 2.6 + abs(ar) * 0.2),
                          hand_l=(0.98, -0.12 - sw * s1, 2.64 + abs(sw * s1) * 0.25))
        return out
    return fn


def attack(rig):
    """The lunging thrust: the trident drawn back along the hip, then driven
    forward behind the shield's rim with a step in. CONTACT 0.56."""
    st = stance(rig)
    g = guard(rig)
    draw = g.but(twist=-24, lean=6, pelvis=(0.04, 0.24, -0.16), look=(4, 6), hand_r=(-0.8, 0.28, 2.58),
                 pole_r=(-0.9, 0.5, -0.3), weapon=_n((0.16, -0.95, 0.24)), extra=extra(lift=10, sway=10, crest=24))
    hit = g.but(twist=22, lean=24, pelvis=(-0.02, -0.34, -0.32), look=(-2, -2), hand_r=(-0.32, -1.42, 2.86),
                pole_r=(-0.9, 0.4, -0.3), weapon=_n((0.07, -0.99, 0.08)), foot_l=(0.46, -0.72, SOLE),
                knee_l=(0.2, -1.0, 0.2), extra=extra(lift=16, sway=-12, crest=22))
    keys = [(0.0, st, 'inout'), (0.2, g, 'inout'), (0.42, draw, 'in'), (0.56, hit, 'out'),
            (0.84, hit.but(lean=21), 'inout'), (1.14, g, 'inout'), (1.45, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if 0.38 < t < 0.56:
            u = (t - 0.38) / 0.18
            fl = b.p['foot_l']
            b = b.but(foot_l=(fl[0], fl[1], fl[2] + 0.18 * math.sin(math.pi * u)))
        return b
    return fn, 1.45


def attack2(rig):
    """The shield bash: the scallop pulled in with the left shoulder back, then
    driven forward with the whole shoulder behind it, a step in. CONTACT 0.52."""
    st = stance(rig)
    g = guard(rig)
    load = g.but(twist=16, lean=4, pelvis=(0.03, 0.2, -0.16), hand_l=(0.6, -0.6, 3.0), look=(-4, 2),
                 extra=extra(lift=8, sway=8, crest=20))
    bash = g.but(twist=-30, lean=20, pelvis=(0.04, -0.36, -0.3), hand_l=(0.22, -1.42, 3.12), pole_l=(1.0, 0.2, -0.5),
                 look=(10, -4), hand_r=(-0.86, 0.02, 2.6), weapon=_n((0.2, -0.9, 0.38)), foot_l=(0.48, -0.74, SOLE),
                 knee_l=(0.2, -1.0, 0.2), extra=extra(lift=18, sway=-14, crest=26))
    keys = [(0.0, st, 'inout'), (0.18, g, 'inout'), (0.38, load, 'in'), (0.52, bash, 'out'),
            (0.78, bash.but(lean=17), 'inout'), (1.06, g, 'inout'), (1.4, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if 0.34 < t < 0.52:
            u = (t - 0.34) / 0.18
            fl = b.p['foot_l']
            b = b.but(foot_l=(fl[0], fl[1], fl[2] + 0.2 * math.sin(math.pi * u)))
        return b
    return fn, 1.4


def trident_sweep(rig):
    """The 1.5 s Trident Sweep bar: the trident drawn far back to the right, the
    body coiled low and the crest flared; at the bar's end (1.5) the tines sweep
    across its whole front from right to left (CONTACT 1.5 to 1.72); recovered 2.35."""
    st = stance(rig)
    g = guard(rig)
    draw = g.but(twist=-40, lean=8, pelvis=(0.06, 0.14, -0.34), hip_twist=-12, look=(-16, 4),
                 hand_r=(-1.45, 0.05, 2.95), pole_r=(-0.3, 0.9, -0.6), weapon=_n((-0.72, 0.62, 0.2)),
                 foot_l=(0.52, -0.42, SOLE), foot_r=(-0.56, 0.38, SOLE), hand_l=(0.0, -1.0, 3.0),
                 extra=extra(lift=10, sway=16, crest=30))
    coil = draw.but(twist=-46, pelvis=(0.07, 0.16, -0.4), look=(-18, 2), hand_r=(-1.45, 0.2, 3.0), hand_l=(-0.05, -0.98, 3.0),
                    extra=extra(lift=12, sway=20, crest=34))
    mid = draw.but(twist=0, lean=16, pelvis=(0.0, -0.06, -0.36), hip_twist=0, look=(0, -4),
                   hand_r=(-0.7, -1.45, 2.8), pole_r=(-0.9, 0.2, -0.6), weapon=_n((-0.15, -1.0, -0.06)),
                   hand_l=(0.3, -1.02, 3.02),
                   extra=extra(lift=14, sway=0, crest=30))
    sweep = draw.but(twist=38, lean=18, pelvis=(-0.08, -0.1, -0.34), hip_twist=12, look=(18, -6),
                     hand_r=(0.5, -1.3, 2.7), pole_r=(-0.4, 0.4, -1.0), weapon=_n((0.68, -0.72, -0.1)),
                     hand_l=(0.7, -0.8, 3.0),
                     extra=extra(lift=16, sway=-20, crest=26))
    keys = [(0.0, st, 'inout'), (0.45, draw, 'inout'), (1.32, coil, 'in'), (1.5, mid, 'linear'),
            (1.68, sweep, 'out'), (1.95, sweep.but(lean=14, twist=34), 'inout'), (2.35, st, 'linear')]
    return keyed(keys), 2.35


def _hurl_bodies(rig):
    st = stance(rig)
    raise_ = st.but(twist=-30, lean=-6, pelvis=(0.05, 0.2, -0.1), look=(-6, 6), hip_twist=-10,
                    hand_r=(-0.8, 0.36, 4.22), pole_r=(-1.0, 0.6, -0.5), weapon=_n((0.05, -0.97, 0.18)),
                    hand_l=(0.55, -1.25, 3.55), pole_l=(1.0, 0.0, -0.6), hand_dir_l=_n((-0.2, -1.0, 0.1)),
                    hand_roll_l=-40, foot_l=(0.48, -0.42, SOLE), foot_r=(-0.44, 0.32, SOLE),
                    extra=extra(lift=10, sway=12, crest=28))
    coil = raise_.but(twist=-40, lean=-10, pelvis=(0.06, 0.26, -0.16), hand_r=(-0.78, 0.55, 4.2),
                      extra=extra(lift=12, sway=16, crest=34))
    throw = raise_.but(twist=26, lean=22, pelvis=(-0.02, -0.3, -0.26), look=(0, -4), hip_twist=10,
                       hand_r=(-0.46, -2.12, 3.72), pole_r=(-1.0, 0.3, -0.5), weapon=_n((0.1, -0.97, -0.1)),
                       hand_l=(0.95, 0.0, 2.9), pole_l=(0.8, 0.9, -0.3), hand_dir_l=_n((0.1, -0.2, -1.0)),
                       hand_roll_l=0, foot_l=(0.48, -0.66, SOLE), knee_l=(0.2, -1.0, 0.2),
                       extra=extra(lift=16, sway=-12, crest=30))
    follow = throw.but(twist=34, lean=26, hand_r=(-0.02, -2.0, 2.85), pole_r=(-0.8, 0.2, -0.8),
                       weapon=_n((0.4, -0.9, -0.2)), extra=extra(lift=14, sway=-16, crest=24))
    call = st.but(lean=10, twist=6, pelvis=(0.0, -0.1, -0.16), hand_r=(-0.7, -0.75, 2.95), pole_r=(-0.9, 0.4, -0.3),
                  weapon=_n((0.05, -0.2, 1.0)), foot_l=(0.48, -0.5, SOLE), fist_r=0.15,
                  extra=extra(lift=8, crest=16))
    over = coil.mix(throw, 0.45).but(hand_r=(-1.02, -0.32, 4.45), weapon=_n((0.05, -0.97, 0.12)))
    return st, raise_, coil, over, throw, follow, call


def hurl(rig):
    """Skewering Trident (the 1.8 s bar): the trident raised over the shoulder like a
    javelin, the shield arm pointed down the lane, the body coiled back; at the
    bar's end (1.8) it throws (CONTACT 1.8). The trident flies straight down the
    lane and bursts into spray; in the open fist a trident of water re-forms and
    hardens back to nacre (2.3 to 2.95). Recovered 3.2."""
    st, raise_, coil, over, throw, follow, call = _hurl_bodies(rig)
    T = HURL_CAST
    keys = [(0.0, st, 'inout'), (0.55, raise_, 'inout'), (1.58, coil, 'in'), (1.7, over, 'linear'), (T, throw, 'out'),
            (2.15, follow, 'inout'), (2.6, call, 'inout'), (2.95, call.but(fist_r=1.0), 'inout'),
            (3.2, st, 'linear')]
    seq = keyed(keys)
    # where the fist's trident is at the release: the thrown twin starts there
    rel = seq(T).pose(None)
    head = rel.head['Weapon']
    dq = rel.delta['Weapon']
    axis_w = (dq @ Vector(A.WEAPON_AXIS)).normalized()
    # it flies level down the lane (the sim's line runs straight out of its facing)
    lane = Vector((0.0, -1.0, -0.03)).normalized()
    dq = axis_w.rotation_difference(lane) @ dq
    axis_w = lane
    ax, ang = dq.to_axis_angle()
    turn = [((ax.x, ax.y, ax.z), math.degrees(ang))]
    fly_end = T + 0.3

    def fn(t):
        b = seq(t)
        sc = dict(A.HIDDEN)
        # the held trident leaves the fist at the release, the water one grows back
        if t >= T:
            sc['Weapon'] = 0.0
        if 2.3 <= t:
            u = smooth((t - 2.3) / 0.35)
            sc['Water'] = 1.08 * u
            v = smooth((t - 2.62) / 0.3)
            sc['Weapon'] = v
            sc['Water'] = sc['Water'] * (1 - smooth((t - 2.78) / 0.22))
        # the thrown one flies down the lane, then bursts
        off = Vector((0, 0, 0))
        if T <= t <= fly_end + 0.05:
            u = (t - T) / (fly_end - T)
            dist = 13.0 * min(1.0, u) ** 0.85
            off = axis_w * dist
            sc['Thrown'] = 1.0 if u < 0.82 else max(0.0, 1.0 - (u - 0.82) / 0.2)
        here = Vector(b.p['pelvis'])
        v = head + off - Vector(A.GRIP_R) - here
        b = b.but(scale=sc, offset={'Thrown': tuple(v)}, extra={'Thrown': turn})
        return b
    return fn, 3.2


def cast(rig):
    """The generic cast channel: the trident raised to the moon, the head lifted."""
    st = stance(rig)
    up = st.but(lean=-6, neck=-8, look=(0, 22), hand_r=(-0.8, -0.3, 4.2), pole_r=(-1.0, 0.3, -0.2),
                weapon=_n((0.05, -0.15, 1.0)), extra=extra(lift=8, crest=30))
    keys = [(0.0, up, 'inout'), (1.0, up.but(look=(4, 26), extra=extra(lift=10, crest=38)), 'inout'),
            (2.0, up, 'linear')]
    return keyed(keys), 2.0


def hit(rig):
    st = stance(rig)
    jolt = st.but(lean=-6, twist=12, pelvis=(0.0, 0.14, -0.1), look=(-10, 12), head_roll=-8,
                  hand_l=(1.05, 0.05, 2.75), extra=extra(sway=-12, lift=10, crest=-10))
    keys = [(0.0, st, 'out'), (0.13, jolt, 'out'), (0.27, jolt.but(lean=0), 'inout'), (0.6, st, 'linear')]
    return keyed(keys), 0.6


def death(rig):
    """It cracks and the light inside escapes (a burst from its chest, 0.15 to 1.4);
    the knees give (0.9), it slumps forward onto the floor in a heap of plate
    (1.75), the pauldrons slide off and pearls spill round it (1.5 to 2.0), its
    moon eyes go out (2.1). Still from 2.4."""
    st = stance(rig)
    crack = st.but(lean=-10, neck=-14, look=(0, 26), pelvis=(0.0, 0.1, -0.08), twist=6,
                   hand_l=(1.05, 0.0, 2.85), hand_r=(-1.0, -0.1, 2.75), clav_l=8, clav_r=8,
                   extra=extra(lift=14, crest=40, curl=-10))
    kneel = st.but(pelvis=(0.0, 0.1, -1.05), lean=18, neck=10, look=(0, -14),
                   foot_l=(0.43, 0.2, SOLE), foot_r=(-0.42, 0.3, SOLE), fpitch_l=-30, fpitch_r=-30,
                   knee_l=(0.2, -1.0, -0.3), hand_r=(-0.95, -0.6, 1.6), weapon=_n((0.2, -0.6, 0.78)),
                   hand_l=(0.95, -0.6, 1.55), hand_dir_l=_n((0.1, -0.4, -0.9)), fist_l=0.4,
                   extra=dict(extra(lift=0, crest=10), Tail1=[('x', 48.0)], Tail2=[('x', 12.0)], Tail3=[('x', 6.0)]))
    heap = st.but(pelvis=(0.0, 0.18, -1.3), lean=84, neck=22, look=(16, -22), head_roll=18, side=10,
                  foot_l=(0.5, 1.0, SOLE + 0.1), foot_r=(-0.48, 1.04, SOLE + 0.1), fpitch_l=-95, fpitch_r=-95,
                  knee_l=(0.2, -1.0, -0.6), hand_r=(-1.15, -1.3, 0.22), weapon=_n((0.42, -0.9, -0.04)),
                  pole_r=(-0.6, 0.2, 1.0), hand_l=(1.15, -1.4, 0.2), hand_dir_l=_n((0.3, -0.9, -0.3)),
                  pole_l=(0.6, 0.2, 1.0), fist_l=0.2, fist_r=0.3,
                  extra=dict(extra(lift=0, crest=-14, sway=8, curl=-20),
                             Tail1=[('x', 72.0), ('z', 8.0)], Tail2=[('x', 12.0)], Tail3=[('x', 8.0)]))
    keys = [(0.0, st, 'out'), (0.32, crack, 'inout'), (0.9, kneel, 'quadin'), (1.75, heap, 'out'),
            (2.4, heap.but(lean=82, look=(18, -24)), 'hold'), (2.8, heap.but(lean=82, look=(18, -24)), 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(A.HIDDEN)
        u = (t - 0.12) / 1.38
        sc['Burst'] = 1.7 * smooth(u / 0.22) * (1 - smooth((u - 0.32) / 0.68)) if 0.0 < u < 1.0 else 0.0
        sc['Pearls'] = smooth((t - 1.45) / 0.45)
        sc['Eyes'] = 1.0 - smooth((t - 1.8) / 0.5)
        # the pauldrons slide off the slumped shoulders and come to rest on the floor
        u = smooth((t - 1.5) / 0.55)
        off = {'L_Pauldron': (0.38 * u, -0.1 * u, -0.95 * u), 'R_Pauldron': (-0.4 * u, 0.05 * u, -0.9 * u)}
        ex = {'L_Pauldron': [('y', -40 * u), ('x', 25 * u)], 'R_Pauldron': [('y', 45 * u), ('x', -20 * u)]}
        return b.but(scale=sc, offset=off, extra=ex)
    return fn, 2.8


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('CombatIdle', lambda r: (combat_idle(r), 2.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD, WALK_HALF, WALK_STANCE, 0.3), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, RUN_HALF, RUN_STANCE, 0.5, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('TridentSweep', trident_sweep, False),
    ('Hurl', hurl, False),
    ('Cast', cast, True),
    ('Hit', hit, False),
    ('Death', death, False),
]


def _floor_pearls(f):
    """The death heap rides the Root (which carries the pelvis): hold it on the floor."""
    def g(t):
        b = f(t)
        pv = b.p['pelvis']
        return b.but(offset={'Pearls': (-pv[0], -pv[1], -pv[2])})
    return g


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        f = _floor_pearls(f)
        # the throw carries the fist from behind the head past the shoulder: solve it
        # with the frame-to-frame IK memory so the elbow never flips on the way
        M.STATEFUL_IK = name in ('Hurl',)
        write_clip(arm, rig, name, f, dur, loop=loop, wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run'
                                                            else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
