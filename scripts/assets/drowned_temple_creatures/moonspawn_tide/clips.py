"""Every clip the Moonspawn ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage lands.
It climbs out of the flooded shore when Ysolei calls it (Rise, its entrance
one-shot), runs low and fast like a lizard, bites (Attack, CONTACT 0.35) and
rakes (Attack2, CONTACT 0.35), and dying pours back into a pool of moonlit
water.
"""
import math

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 1.0, 0.6
WALKREF, RUNREF = 3.0, 8.0


def pose(chest=0.0, head=0.0, jaw=0.0, neck=0.0, tail=0.0, tail_side=0.0, wave=0.0, phase=0.0, legs=None,
         side=0.0):
    out = {'Chest': [('x', chest), ('z', side)], 'Pelvis': [('x', -chest * 0.3), ('z', -side * 0.6)],
           'Neck': [('x', neck), ('z', side * 0.5)], 'Head': [('x', head)], 'Jaw': [('x', -jaw)]}
    for i in range(4):
        out[f'Tail{i + 1}'] = [('x', -tail * (0.4 + 0.2 * i)),
                               ('z', tail_side * (0.5 + 0.2 * i) + wave * math.sin(phase - i * 0.9))]
    if legs:
        for (nm, idx) in (('Front', 0), ('Back', 2)):
            for s, side_ in ((1, 'L'), (-1, 'R')):
                sw, lift = legs[idx + (0 if s > 0 else 1)]
                out[f'{side_}_{nm}Up'] = [('x', sw), ('y', -s * lift * 0.5)]
                out[f'{side_}_{nm}Low'] = [('x', -lift)]
                out[f'{side_}_{nm}Foot'] = [('x', lift * 0.5)]
    return out


def base(rig):
    return Body(rig, pelvis=(0.0, 0.0, 0.0), scale=dict(A.HIDDEN))


def _gait(ph, amp, lift_amp):
    legs = []
    for off in (0.0, 0.5, 0.5, 0.0):        # front L, front R, back L, back R (a trot)
        u = TAU * (ph + off)
        legs.append((amp * math.sin(u), lift_amp * max(0.0, math.cos(u))))
    return legs


def idle(rig, period=3.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        return st.but(pelvis=(0.0, 0.0, 0.02 * math.sin(2 * u)),
                      extra=pose(chest=2 * math.sin(u), head=3 * math.sin(2 * u), neck=-4, jaw=3 + 3 * math.sin(3 * u),
                                 tail=4, wave=10, phase=u, side=3 * math.sin(u)))
    return fn


def run(rig, period, fast=True):
    st = base(rig)

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        return st.but(pelvis=(0.0, 0.0, 0.05 * abs(math.sin(u))),
                      extra=pose(chest=6 + 3 * math.sin(2 * u), neck=6, head=-4, tail=-6, wave=14, phase=u,
                                 side=6 * math.sin(u), legs=_gait(ph, 34 if fast else 22, 30 if fast else 20)))
    return fn


def bite(rig, rake=False):
    st = base(rig)
    rest = st.but(extra=pose())
    coil = st.but(pelvis=(0, 0.1, 0.02), extra=pose(chest=-8, neck=-14, head=-10, jaw=6, tail=10))
    if rake:
        hit = st.but(pelvis=(0, -0.25, 0.04), extra=pose(chest=10, neck=10, head=4, jaw=4, side=-14,
                                                       legs=[(-60, 30), (0, 0), (0, 0), (0, 0)]))
    else:
        hit = st.but(pelvis=(0, -0.3, -0.02), extra=pose(chest=12, neck=18, head=6, jaw=40, tail=-6))
    after = st.but(pelvis=(0, -0.15, 0), extra=pose(chest=6, neck=8, jaw=10))
    return keyed([(0.0, rest, 'inout'), (0.22, coil, 'in'), (0.35, hit, 'out'), (0.5, hit, 'inout'),
                  (0.75, after, 'inout'), (1.0, rest, 'linear')]), 1.0


def rise(rig):
    """It climbs out of the water: under the floor at first, it hauls itself
    up and out, head first, shaking itself as it stands (1.6)."""
    st = base(rig)
    under = st.but(pelvis=(0.0, 0.6, -1.7), extra=pose(chest=-40, neck=-20, head=-10, tail=30))
    claw = st.but(pelvis=(0.0, 0.3, -0.7), extra=pose(chest=-30, neck=10, head=4, jaw=20, tail=24,
                                                       legs=[(-60, 40), (-50, 40), (30, 0), (30, 0)]))
    up = st.but(pelvis=(0.0, 0.0, 0.05), extra=pose(chest=-6, neck=-6, head=-12, jaw=30, side=8, tail=-8))
    rest = st.but(extra=pose())
    keys = [(0.0, under, 'out'), (0.5, claw, 'inout'), (1.0, up, 'inout'), (1.6, rest, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Pool'] = 1.0 - smooth((t - 0.9) / 0.6)
        pv = b.p['pelvis']
        return b.but(scale=sc, offset={'Pool': (-pv[0], -pv[1], -pv[2])})
    return fn, 1.6


def hit(rig):
    st = base(rig)
    rest = st.but(extra=pose())
    jolt = st.but(pelvis=(0, 0.12, 0.02), extra=pose(chest=-10, neck=-14, head=-8, jaw=14, tail=14))
    return keyed([(0.0, rest, 'out'), (0.1, jolt, 'out'), (0.45, rest, 'linear')]), 0.45


def death(rig):
    """It rears, then pours away into a pool of moonlit water, the crescents
    sinking last."""
    st = base(rig)
    rest = st.but(extra=pose())
    rear = st.but(pelvis=(0, 0.1, 0.1), extra=pose(chest=-20, neck=-20, head=-16, jaw=36, tail=20))
    slump = st.but(pelvis=(0, 0.0, -0.5), extra=pose(chest=10, neck=20, head=10, jaw=10, tail=-10,
                                                      legs=[(20, -30)] * 4))
    gone = slump.but(pelvis=(0, 0.0, -2.2))
    seq = keyed([(0.0, rest, 'out'), (0.25, rear, 'inout'), (0.8, slump, 'in'), (2.0, gone, 'out'),
                 (2.2, gone, 'hold')])

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Pool'] = smooth((t - 0.5) / 0.6)
        pv = b.p['pelvis']
        return b.but(scale=sc, offset={'Pool': (-pv[0], -pv[1], -pv[2])})
    return fn, 2.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 3.0), True),
    ('Walk', lambda r: (run(r, WALK_PERIOD, fast=False), WALK_PERIOD), True),
    ('Run', lambda r: (run(r, RUN_PERIOD), RUN_PERIOD), True),
    ('Attack', lambda r: bite(r), False),
    ('Attack2', lambda r: bite(r, rake=True), False),
    ('Cast', lambda r: (idle(r, 2.0), 2.0), True),
    ('Rise', rise, False),
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
