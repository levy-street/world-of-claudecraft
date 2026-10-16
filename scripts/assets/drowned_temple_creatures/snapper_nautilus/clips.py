"""Every clip the Lagoon Snapper ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage lands.
It rests on the rim of its great shell, rocking gently, the tentacle crown
rippling; it hauls itself along with the tentacles, the shell rolling a
little with each pull.

The sim: melee swings (Attack, Attack2: the tentacles part and the beak
strikes, CONTACT 0.55); Snap is a 1.5 s cast bar, a frontal bite (Snap: the
tentacles gather, the shell rocks back, then the beak shoots forward with
every tentacle flung open on the bar's end, CONTACT 1.5); Shell Up is a 5 s
self-stun (ShellUp, the rig's stunned loop: every tentacle drawn in, the hood
shut over the aperture, the shell still as a stone).
"""
import math

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 1.6, 0.9
WALKREF, RUNREF = 2.0, 5.0
SNAP_BAR = 1.5


def pose(rock=0.0, roll=0.0, head=0.0, hood=0.0, beak=0.0, spread=0.0, reach=0.0, curl=0.0, wave=0.0, phase=0.0,
         tent_scale=1.0):
    """rock: the shell pitched forward (+) or back (-); head: the animal thrust
    out (+); hood: the hood shut down (+); beak: the beak opened (+); spread:
    the tentacles fanned out (+); reach: the tentacles thrown forward and up
    (+); curl: curled in (+); wave: ripple."""
    out = {'Shell': [('x', rock), ('y', roll)], 'Head': [('x', head)], 'Hood': [('x', hood)],
           'Beak': [('x', -beak)]}
    for i in range(A.N_BUNDLE):
        a = 2 * math.pi * (i + 0.5) / A.N_BUNDLE
        up = math.sin(a)
        side = math.cos(a)
        w = wave * math.sin(phase + i * 0.8)
        out[f'Tent{i}_1'] = [('x', -reach * (0.5 + 0.5 * up) + w), ('z', spread * side), ('y', -spread * up * 0.5)]
        out[f'Tent{i}_2'] = [('x', -curl + w * 0.7)]
        out[f'Tent{i}_3'] = [('x', -curl * 1.2 + w * 0.5)]
    return out


def base(rig):
    return Body(rig, pelvis=(0.0, 0.0, 0.0), scale=dict(A.HIDDEN))


def _tent_scale(b, s):
    sc = dict(b.p['scale'])
    for i in range(A.N_BUNDLE):
        sc[f'Tent{i}_1'] = s
    return b.but(scale=sc)


def idle(rig, period=4.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        return st.but(pelvis=(0.0, 0.0, 0.0),
                      extra=pose(rock=2.5 * math.sin(u), roll=1.5 * math.sin(2 * u), head=2 * math.sin(2 * u),
                                 beak=3 + 3 * math.sin(3 * u), wave=8, phase=u * 2, spread=4))
    return fn


def crawl(rig, period, run=False):
    st = base(rig)

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        pull = math.sin(u)
        return st.but(pelvis=(0.0, -0.05 * pull, 0.03 * max(0.0, math.sin(2 * u))),
                      extra=pose(rock=(6 if run else 4) * pull + (6 if run else 2), head=4 * pull,
                                 reach=(14 if run else 10) * math.sin(u + 1.2), curl=8 * max(0.0, -pull),
                                 wave=10, phase=u * 2, spread=6))
    return fn


def _strike(rig, dur=1.2, contact=0.55):
    st = base(rig)
    rest = st.but(extra=pose(spread=4))
    gather = st.but(pelvis=(0, 0.08, 0), extra=pose(rock=-8, head=-6, spread=-10, curl=20, beak=10))
    hit = st.but(pelvis=(0, -0.22, 0), extra=pose(rock=8, head=14, spread=26, reach=18, beak=30))
    keys = [(0.0, rest, 'inout'), (0.36, gather, 'in'), (contact, hit, 'out'), (0.8, hit.but(extra=pose(
        rock=5, head=8, spread=18, reach=10, beak=12)), 'inout'), (dur, rest, 'linear')]
    return keyed(keys), dur


def snap(rig):
    """Snap (the 1.5 s bar): the tentacles gather in and the shell rocks back,
    coiling; on the bar's end the beak shoots out with every tentacle flung
    open in a fan (CONTACT 1.5); recovered 2.2."""
    st = base(rig)
    T = SNAP_BAR
    rest = st.but(extra=pose(spread=4))
    coil = st.but(pelvis=(0, 0.16, 0.02), extra=pose(rock=-14, head=-10, hood=-6, spread=-14, curl=30, beak=16))
    lunge = st.but(pelvis=(0, -0.4, -0.02), extra=pose(rock=14, head=22, hood=-4, spread=44, reach=34, beak=46))
    keys = [(0.0, rest, 'inout'), (0.9, coil, 'inout'), (1.35, coil.but(pelvis=(0, 0.2, 0.03)), 'in'),
            (T, lunge, 'out'), (1.8, lunge.but(extra=pose(rock=8, head=12, spread=30, reach=16, beak=20)), 'inout'),
            (2.2, rest, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        if t < T:
            ex = dict(b.p['extra'])
            for i in range(A.N_BUNDLE):
                lst = list(ex.get(f'Tent{i}_1', []))
                lst.append(('z', 3 * math.sin(TAU * t / 0.12 + i)))
                ex[f'Tent{i}_1'] = lst
            b = b.but(extra=ex)
        return b
    return fn, 2.2


def shell_up(rig, period=3.0):
    """Shell Up (the stunned loop): tentacles drawn in, the hood shut down over
    the aperture, the shell still as a stone but for a slow breath."""
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        b = st.but(pelvis=(0.0, 0.06, 0.0), extra=pose(rock=-6 + 0.6 * math.sin(u), head=-22, hood=52, spread=-20,
                                                         curl=60, beak=0))
        return _tent_scale(b, 0.35)
    return fn


def cast(rig, period=2.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        return st.but(extra=pose(rock=-4 + 2 * math.sin(u), head=-4, spread=10, reach=6, wave=12, phase=u * 2, beak=8))
    return fn


def hit(rig):
    st = base(rig)
    rest = st.but(extra=pose(spread=4))
    jolt = st.but(pelvis=(0, 0.14, 0), extra=pose(rock=-10, head=-10, hood=10, spread=-12, curl=24))
    return keyed([(0.0, rest, 'out'), (0.12, jolt, 'out'), (0.55, rest, 'linear')]), 0.55


def death(rig):
    """The tentacles thrash then go slack; the shell tips onto its side and
    rolls half a turn, coming to rest with the slack crown spilled out."""
    st = base(rig)
    rest = st.but(extra=pose(spread=4))
    thrash = st.but(pelvis=(0, 0.05, 0.05), extra=pose(rock=-12, head=-8, spread=40, reach=30, beak=40))
    tip = st.but(pelvis=(0.0, 0.0, 0.12), roll=40, extra=pose(rock=-4, head=-12, spread=10, curl=-10))
    over = st.but(pelvis=(0.0, 0.05, 0.5), roll=84, yaw=-30, extra=pose(rock=-20, head=-20, hood=10, spread=-6,
                                                                       curl=-20, reach=-20))
    keys = [(0.0, rest, 'out'), (0.3, thrash, 'inout'), (0.9, tip, 'in'), (1.6, over, 'out'), (2.4, over, 'hold')]
    return keyed(keys), 2.4


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (crawl(r, WALK_PERIOD), WALK_PERIOD), True),
    ('Run', lambda r: (crawl(r, RUN_PERIOD, run=True), RUN_PERIOD), True),
    ('Attack', lambda r: _strike(r), False),
    ('Attack2', lambda r: _strike(r, 1.1, 0.5), False),
    ('Cast', lambda r: (cast(r), 2.0), True),
    ('Snap', snap, False),
    ('ShellUp', lambda r: (shell_up(r), 3.0), True),
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
