"""Every clip the Glimmerscale Lurker ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage lands.
It holds its front half reared, the raptorial arms folded like jackknives
under its head, the eyes on their stalks turning each its own way, the
antennae sweeping, the tail fan twitching.

The sim: its swings are melee (Attack, Attack2: the arms snap out at 0.16,
the fastest strike in the sea); Pounce is a 0.6 s leap (the jump slot plays
Leap in the air, the land slot plays Land on touchdown); Glimmer Venom is a
2.0 s cast bar (Spit: it rears back with the glowing bolus swelling in its
mouth and spits it as the bar ends).
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 1.2, 0.66
WALKREF, RUNREF = 2.6, 7.2
STRIKE = 0.16
SPIT_BAR = 2.0


def _axis(b):
    h, t = A.REST[b]
    d = t - h
    return tuple(d / np.linalg.norm(d))


AX_EYE_L, AX_EYE_R = _axis('L_Eye'), _axis('R_Eye')


def pose(chest=0.0, head=0.0, arm_l=0.0, arm_r=0.0, fore_l=0.0, fore_r=0.0, club_l=0.0, club_r=0.0,
         spread_l=0.0, spread_r=0.0, eye_l=(0.0, 0.0, 0.0), eye_r=(0.0, 0.0, 0.0), ant=0.0, ant_wave=0.0,
         abd_side=0.0, abd_lift=0.0, wave=0.0, phase=0.0, tail=0.0, legs=None, scale_ant=0.0):
    """Extra turns. chest/head: pitch (+ forward and down, - rearing); arm: the
    merus swing (- forward and up); fore: the propodus unfolding (+); club: the
    dactyl opening (+); spread: the arm swung out sideways; eye: (spin, nod,
    swivel); abd_side/abd_lift: the abdomen curving sideways or up (+ up, the
    tail rising); wave: a travelling side wave down it; tail: the fan's flick
    (+ up); legs: [(swing, lift)] per leg L1..3 then R1..3."""
    out = {'Chest': [('x', chest)], 'Head': [('x', head)]}
    for side, arm, fore, club, spread in (('L', arm_l, fore_l, club_l, spread_l),
                                          ('R', arm_r, fore_r, club_r, spread_r)):
        s = 1 if side == 'L' else -1
        out[f'{side}_Merus'] = [('x', arm), ('y', -s * spread)]
        out[f'{side}_Propodus'] = [('x', fore)]
        out[f'{side}_Dactyl'] = [('x', club)]
    out['L_Eye'] = [(AX_EYE_L, eye_l[0]), ('x', eye_l[1]), ('z', eye_l[2])]
    out['R_Eye'] = [(AX_EYE_R, eye_r[0]), ('x', eye_r[1]), ('z', eye_r[2])]
    for s, side in ((1, 'L'), (-1, 'R')):
        out[f'{side}_Ant1'] = [('x', -ant + ant_wave * math.sin(phase + s)), ('z', s * ant_wave * 0.5 * math.cos(phase))]
        out[f'{side}_Scale'] = [('y', -s * scale_ant)]
    for i in range(6):
        w = (i + 1) / 6
        out[f'Abd{i + 1}'] = [('z', abd_side * 0.5 + wave * math.sin(phase - i * 0.9) * (0.4 + 0.6 * w)),
                              ('x', -abd_lift * (0.3 + 0.7 * w))]
    out['Tail'] = [('x', -tail)]
    if legs:
        for i, (sw, lift) in enumerate(legs[:3]):
            out[f'L_Leg{i + 1}a'] = [('z', sw), ('y', -lift)]
            out[f'L_Leg{i + 1}b'] = [('y', lift * 0.6)]
        for i, (sw, lift) in enumerate(legs[3:]):
            out[f'R_Leg{i + 1}a'] = [('z', -sw), ('y', lift)]
            out[f'R_Leg{i + 1}b'] = [('y', -lift * 0.6)]
    return out


def base(rig):
    return Body(rig, pelvis=(0.0, 0.0, 0.0), scale=dict(A.HIDDEN))


def eyes(u, k=1.0):
    """The eyes' restless turning, each its own rhythm (whole multiples of the
    loop's phase, so a looping clip closes)."""
    return ((80 * math.sin(u) + 40 * math.sin(3 * u)) * k, 14 * math.sin(2 * u), 18 * math.sin(u + 1.0)),         ((70 * math.sin(u + 2.0) + 45 * math.sin(2 * u)) * k, 12 * math.sin(3 * u + 0.4), 16 * math.sin(u + 2.2))


def idle(rig, period=4.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        el, er = eyes(u)
        tw = 4 * math.sin(u * 6) * (0.5 + 0.5 * math.sin(u))
        return st.but(pelvis=(0.0, 0.0, 0.02 * math.sin(u)),
                      extra=pose(chest=-2 + 3 * math.sin(u), head=2 * math.sin(2 * u), arm_l=2 * math.sin(u),
                                 arm_r=2 * math.sin(u + 1), eye_l=el, eye_r=er, ant=6, ant_wave=10, phase=u,
                                 wave=3, tail=6 + tw, scale_ant=8 * math.sin(2 * u)))
    return fn


def gait(rig, period, run=False):
    st = base(rig)

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        legs = []
        for side_off in (0.0, 0.5):
            for i in range(3):
                p = u + TAU * (side_off + i * 0.33)
                legs.append(((22 if run else 16) * math.sin(p), max(0.0, math.cos(p)) * (22 if run else 14)))
        el, er = eyes(u, 0.4)
        return st.but(pelvis=(0.0, 0.0, 0.03 * math.sin(2 * u) - (0.08 if run else 0.0)),
                      extra=pose(chest=(14 if run else 4) + 2 * math.sin(2 * u), head=-6 if run else -2,
                                 arm_l=4, arm_r=4, eye_l=el, eye_r=er, ant=-14 if run else -6, ant_wave=8, phase=u,
                                 wave=(10 if run else 7), tail=(4 if run else 2) + 6 * math.sin(2 * u), legs=legs,
                                 scale_ant=-10))
    return fn


def _strike(rig, both, side='L'):
    st = base(rig)
    cock = pose(chest=-10, head=-6, arm_l=12 if (both or side == 'L') else 2, arm_r=12 if (both or side == 'R') else 2,
                fore_l=-6, fore_r=-6, ant=10, tail=10, abd_lift=-3)
    hit_l = both or side == 'L'
    hit_r = both or side == 'R'
    snap = pose(chest=12, head=4, arm_l=-62 if hit_l else 4, arm_r=-62 if hit_r else 4, fore_l=150 if hit_l else 0,
                fore_r=150 if hit_r else 0, club_l=20 if hit_l else 0, club_r=20 if hit_r else 0, ant=-12, tail=-4,
                abd_lift=4)
    back = pose(chest=6, head=2, arm_l=-20 if hit_l else 2, arm_r=-20 if hit_r else 2, fore_l=50 if hit_l else 0,
                fore_r=50 if hit_r else 0, ant=-4, tail=2)
    rest = pose()
    a = st.but(extra=rest)
    b = st.but(pelvis=(0, 0.08, -0.02), extra=cock)
    c = st.but(pelvis=(0, -0.22, -0.04), extra=snap)
    d = st.but(pelvis=(0, -0.1, 0.0), extra=back)
    return keyed([(0.0, a, 'inout'), (0.1, b, 'in'), (STRIKE, c, 'out'), (0.36, d, 'inout'), (0.84, a, 'linear')]), 0.84


def spit(rig):
    """Glimmer Venom (the 2.0 s bar): it rears up and back, the head thrown
    back, the arms drawn in, the glowing bolus swelling in its mouth; as the
    bar ends (1.9 to 2.0) the head snaps forward and the bolus is gone."""
    st = base(rig)
    T = SPIT_BAR
    rest = st.but(extra=pose())
    rear = st.but(pelvis=(0, 0.12, 0.04), extra=pose(chest=-22, head=-26, arm_l=-6, arm_r=-6, fore_l=-10,
                                                     fore_r=-10, ant=18, tail=16, abd_lift=-6, scale_ant=18))
    snap = st.but(pelvis=(0, -0.16, -0.02), extra=pose(chest=14, head=16, arm_l=4, arm_r=4, ant=-14, tail=-6,
                                                       scale_ant=-10))
    seq = keyed([(0.0, rest, 'inout'), (0.5, rear, 'inout'), (1.85, rear.but(pelvis=(0, 0.14, 0.06)), 'in'),
                 (2.0, snap, 'out'), (2.5, rest, 'linear')])

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Venom'] = smooth((t - 0.3) / 1.3) * (1.0 + 0.07 * math.sin(TAU * t / 0.25)) if t < 1.96 else 0.0
        el, er = eyes(t * 4, 0.6)
        ex = dict(b.p['extra'])
        ex['L_Eye'] = [(AX_EYE_L, el[0]), ('x', el[1])]
        ex['R_Eye'] = [(AX_EYE_R, er[0]), ('x', er[1])]
        return b.but(scale=sc, extra=ex)
    return fn, 2.5


def leap(rig):
    """Pounce in the air (the jump slot, looping for the 0.6 s flight): the
    body stretched long, the arms flung open forward ready to land on its prey,
    the legs tucked, the tail fan spread and lifted."""
    st = base(rig)

    def fn(t):
        u = TAU * t / 0.6
        return st.but(extra=pose(chest=6, head=-4, arm_l=-70, arm_r=-70, fore_l=110, fore_r=110, club_l=30,
                                 club_r=30, spread_l=22, spread_r=22, ant=-24, abd_lift=10, tail=22 + 4 * math.sin(u),
                                 legs=[(30, 30)] * 6, scale_ant=-20))
    return fn


def land(rig):
    """Pounce's landing (the land slot): it slams down claws first, the body
    compressing, then gathers itself back into its reared stance."""
    st = base(rig)
    imp = st.but(pelvis=(0, -0.1, -0.16), extra=pose(chest=26, head=10, arm_l=-40, arm_r=-40, fore_l=120,
                                                    fore_r=120, spread_l=14, spread_r=14, ant=-10, abd_lift=-4,
                                                    tail=-8))
    settle = st.but(pelvis=(0, -0.04, -0.04), extra=pose(chest=8, head=2, arm_l=-10, arm_r=-10, fore_l=30,
                                                        fore_r=30, tail=4))
    rest = st.but(extra=pose())
    return keyed([(0.0, imp, 'out'), (0.22, settle, 'inout'), (0.62, rest, 'linear')]), 0.62


def cast(rig, period=2.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        el, er = eyes(u, 0.7)
        return st.but(extra=pose(chest=-12 + 3 * math.sin(u), head=-10, eye_l=el, eye_r=er, ant=12, ant_wave=10,
                                 phase=u, tail=10, scale_ant=10))
    return fn


def hit(rig):
    st = base(rig)
    a = st.but(extra=pose())
    b = st.but(pelvis=(0, 0.16, 0.02), extra=pose(chest=-14, head=-10, arm_l=10, arm_r=10, fore_l=-8, fore_r=-8,
                                                 ant=20, tail=20, abd_lift=-6))
    return keyed([(0.0, a, 'out'), (0.1, b, 'out'), (0.5, a, 'linear')]), 0.5


def death(rig):
    """It rears in a spasm, drops flat, then rolls over onto its back, the legs
    and arms curling closed; the glow spots down its flanks go out one by one
    (1.2 to 2.2)."""
    st = base(rig)
    rest = st.but(extra=pose())
    spasm = st.but(pelvis=(0, 0.08, 0.06), extra=pose(chest=-26, head=-20, arm_l=-30, arm_r=-30, fore_l=60,
                                                      fore_r=60, ant=24, tail=26, abd_lift=-10))
    flat = st.but(pelvis=(0, -0.05, -0.02), extra=pose(chest=46, head=16, arm_l=10, arm_r=10, ant=-6, tail=-4,
                                                       abd_lift=0))
    curl = pose(chest=40, head=12, arm_l=30, arm_r=30, fore_l=-10, fore_r=-10, ant=-20, abd_lift=-8, tail=-10,
                legs=[(10, -50)] * 3 + [(10, -50)] * 3)
    over = st.but(pelvis=(0, 0.0, 0.92), roll=172, extra=curl)
    keys = [(0.0, rest, 'out'), (0.25, spasm, 'inout'), (0.75, flat, 'in'), (1.4, over, 'out'),
            (2.4, over.but(pelvis=(0, 0.0, 0.88)), 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        for j, g in enumerate(A.GLOW_SEG):
            sc[f'Glow{g}'] = 1.0 - smooth((t - 1.2 - 0.25 * j) / 0.15)
        return b.but(scale=sc)
    return fn, 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (gait(r, WALK_PERIOD), WALK_PERIOD), True),
    ('Run', lambda r: (gait(r, RUN_PERIOD, run=True), RUN_PERIOD), True),
    ('Attack', lambda r: _strike(r, True), False),
    ('Attack2', lambda r: _strike(r, False, 'R'), False),
    ('Cast', lambda r: (cast(r), 2.0), True),
    ('Spit', spit, False),
    ('Leap', lambda r: (leap(r), 0.6), True),
    ('Land', land, False),
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
        M.STATEFUL_IK = False
        write_clip(arm, rig, name, f, dur, loop=loop,
                   wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run' else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
