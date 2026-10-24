"""Every clip the Pale Choir Acolyte ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect lands.
She hovers a hand's breadth above the floor and never walks: she glides, the
bell above her pulsing like a swimming moon jelly, the skirt, the frilled oral
arms and the veil of tentacles swaying behind (all on follow-through chains).

The sim: her Pale Hymn is a petSpell bolt whose 0.6 s windup cue plays the
ATTACK clips (Attack and Attack2 in turn, the renderer's triggerAttack), the
bolt leaving at the windup's end; the manifest plays them at their own pace
(attackTimeScale 1), so both throw at 0.6. Lullaby (2.0 s bar) and Pale Mending
(2.5 s bar) are bar-locked cast clips whose peak lands just before the bar's
end; on the bar's end (or a kick) the body crossfades home, so an interrupted
hymn reads as broken, never as finished.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 2.4, 1.2
WALKREF, RUNREF = 2.5, 7.0
HYMN_RELEASE = 0.6                  # petSpell.windup (temple.ts): the bolt leaves here
LULLABY_BAR, MEND_BAR = 2.0, 2.5    # the sim's cast bars (temple.ts trashKit)
AX = tuple(A.BELL_AXIS)


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def bell(pulse=1.0, size=1.0, spin=0.0, tilt=0.0, roll=0.0):
    """The bell: `pulse` scales the margin (under 1 the margin draws in: a
    contraction), `size` the whole dome, `spin` turns it round its own axis
    (the rings wheel), `tilt` nods it forward (+) and `roll` cants it sideways."""
    ex = {'Bell': [(AX, spin), ('x', tilt), ('y', roll)]}
    return ex, {'Bell': size, 'BellRim': pulse}


def hang(veil=0.0, veil_side=0.0, tent=0.0, frill=0.0, frill_side=0.0, phase=0.0, wave=0.0):
    """Authored turns on the hanging chains' roots (the follow-through rides on
    top): `veil` lifts the veil away behind (+), `tent` and `frill` swing the
    face tentacles and the oral arms forward (+), `wave` ripples them."""
    out = {}
    for i in range(len(A.VEIL_ANG)):
        w = wave * math.sin(phase - i * 0.9)
        out[f'Veil{i}_1'] = [('x', veil + w), ('y', veil_side)]
        out[f'Veil{i}_2'] = [('x', w * 0.6)]
    for s, side in A.TENT_SIDES:
        out[f'Tent{side}1'] = [('x', -tent + wave * 0.6 * math.sin(phase + s)), ('y', -s * tent * 0.15)]
        out[f'Frill{side}1'] = [('x', -frill + wave * 0.4 * math.sin(phase + 1.3 * s)), ('y', frill_side)]
        out[f'Frill{side}2'] = [('x', -frill * 0.4)]
    return out


def look(**kw):
    """One dict of extra turns and scales from the bell and the hanging layers."""
    b = {k[2:]: v for k, v in kw.items() if k.startswith('b_')}
    h = {k: v for k, v in kw.items() if not k.startswith('b_')}
    ex, sc = bell(**b)
    ex.update(hang(**h))
    return ex, sc


def with_look(body, **kw):
    ex, sc = look(**kw)
    s = dict(A.HIDDEN)
    s.update(body.p['scale'] or {})
    s.update(sc)
    return body.but(extra=ex, scale=s)


HAND_REST = dict(hand_l=(0.17, -0.34, 3.06), hand_r=(-0.15, -0.36, 3.1), pole_l=(1.0, 0.7, -0.4),
                 pole_r=(-1.0, 0.7, -0.4), hand_dir_l=_n((-0.55, -0.55, -0.35)), hand_dir_r=_n((0.55, -0.6, -0.3)),
                 hand_roll_l=-30.0, hand_roll_r=-30.0, fist_l=0.25, fist_r=0.3)


def stance(rig):
    b = Body(rig, pelvis=(0.0, 0.0, 0.0), lean=2, neck=8, look=(0, -6), head_roll=6, clav_l=-2, clav_r=-2,
             scale=dict(A.HIDDEN), **HAND_REST)
    return with_look(b)


def idle(rig, period=4.0):
    st = stance(rig)

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        pulse = 0.5 - 0.5 * math.cos(2 * u)          # two slow beats a loop
        b = st.but(pelvis=(0.02 * s1, 0.0, 0.05 * (math.sin(u - 0.6) + math.sin(0.6))), side=-2.0 * s1, lean=2 + 1.2 * s2,
                   look=(4 * s1, -6 + 2 * s2), head_roll=6 + 3 * s1, clav_l=-2 + 1.5 * s2, clav_r=-2 + 1.5 * s2,
                   hand_l=(0.17, -0.34, 3.06 + 0.02 * s2), hand_r=(-0.15, -0.36, 3.1 + 0.02 * s2))
        return with_look(b, b_pulse=1.0 - 0.08 * pulse, b_size=1.0 + 0.015 * pulse, veil=3 * s1, wave=5,
                         phase=u, tent=2 * s2, frill=2 * s1)
    return fn


def glide(rig, period, run=False):
    st = stance(rig)
    lean = 16 if run else 7
    base = st.but(lean=lean, neck=4 if run else 8, look=(0, 4 if run else -4), head_roll=0 if run else 4,
                  hand_l=(0.4, 0.3, 2.86) if run else (0.38, 0.06, 2.84),
                  hand_r=(-0.4, 0.3, 2.86) if run else (-0.38, 0.06, 2.84),
                  pole_l=(0.6, -0.4, 0.2), pole_r=(-0.6, -0.4, 0.2),
                  hand_dir_l=_n((0.15, 0.7, -0.7)), hand_dir_r=_n((-0.15, 0.7, -0.7)),
                  hand_roll_l=-10.0, hand_roll_r=-10.0, fist_l=0.2, fist_r=0.2)

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        # one bell beat per cycle: the contraction drives her on (a swimming jelly)
        beat = math.sin(math.pi * min(1.0, (ph / 0.35))) if ph < 0.35 else 0.0
        bob = (0.06 if run else 0.04) * math.sin(u - 1.2)
        b = base.but(pelvis=(0.015 * math.sin(u), 0.0, bob), lean=lean + (3 if run else 1.5) * beat,
                     side=2 * math.sin(u), head_roll=(0 if run else 4) + 3 * math.sin(u))
        return with_look(b, b_pulse=1.0 - (0.14 if run else 0.09) * beat, b_size=1.0 - 0.02 * beat,
                         b_tilt=(-6 if run else -2), veil=(14 if run else 6) + 3 * beat, wave=7 if run else 5,
                         phase=u, tent=-6 if run else -2, frill=-4 if run else -1)
    return fn


def attack(rig):
    """The Pale Hymn's throw (and her lash up close): the bell draws in, her
    hands gather at her breast while a frost dart forms at her fingertips, then
    the bell snaps open, both arms drive forward and the dart flies (0.6); the
    face tentacles and the frilled oral arms lash out after it."""
    st = stance(rig)
    gather = with_look(st.but(lean=-6, neck=-2, look=(0, 6), head_roll=0, pelvis=(0, 0.06, 0.04),
                              hand_l=(0.1, -0.3, 3.5), hand_r=(-0.1, -0.32, 3.48), pole_l=(1.0, 0.3, -0.6),
                              pole_r=(-1.0, 0.3, -0.6), hand_dir_l=_n((-0.6, -0.3, 0.75)),
                              hand_dir_r=_n((0.6, -0.3, 0.75)), hand_roll_l=-60, hand_roll_r=-60, fist_l=0.35,
                              fist_r=0.35),
                       b_pulse=0.8, b_size=0.94, b_tilt=-6, veil=10, tent=-10, frill=-6)
    throw = with_look(st.but(lean=16, neck=10, look=(0, 2), head_roll=-4, pelvis=(0, -0.16, 0.0),
                             hand_l=(0.2, -1.02, 3.55), hand_r=(-0.16, -1.04, 3.58), pole_l=(1.0, 0.2, -0.8),
                             pole_r=(-1.0, 0.2, -0.8), hand_dir_l=_n((-0.1, -1.0, 0.15)),
                             hand_dir_r=_n((0.1, -1.0, 0.15)), hand_roll_l=-80, hand_roll_r=-80, fist_l=0.05,
                             fist_r=0.05, spread_l=0.5, spread_r=0.5),
                      b_pulse=1.14, b_size=1.04, b_tilt=10, veil=-6, tent=55, frill=40)
    follow = with_look(throw.but(lean=12, hand_l=(0.26, -0.86, 3.4), hand_r=(-0.22, -0.88, 3.42)),
                       b_pulse=1.06, b_tilt=6, veil=0, tent=30, frill=24)
    keys = [(0.0, st, 'inout'), (0.36, gather, 'in'), (HYMN_RELEASE, throw, 'out'), (0.88, follow, 'inout'),
            (1.4, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Dart'] = smooth((t - 0.14) / 0.3) if t < HYMN_RELEASE else 0.0
        return b.but(scale=sc)
    return fn, 1.4


def attack2(rig):
    """The hand strike: her right hand drawn up beside her face, the dart
    forming in it, then slashed forward and across with the chest turning into
    it (0.6) while the veil swirls round behind her."""
    st = stance(rig)
    draw = with_look(st.but(twist=-24, lean=-2, look=(-10, 4), head_roll=10, pelvis=(0.03, 0.05, 0.03),
                            hand_r=(-0.42, -0.06, 3.86), pole_r=(-1.0, 0.4, -0.4), hand_dir_r=_n((0.25, -0.35, 0.9)),
                            hand_roll_r=-40, fist_r=0.15, spread_r=0.3, hand_l=(0.2, -0.46, 3.3),
                            hand_dir_l=_n((-0.5, -0.8, 0.2)), hand_roll_l=-50, fist_l=0.2),
                     b_pulse=0.86, b_roll=-6, veil=8, veil_side=-10, tent=-8, frill=-4)
    strike = with_look(st.but(twist=24, lean=14, look=(10, 0), head_roll=-8, pelvis=(-0.04, -0.14, 0.0),
                              hand_r=(0.12, -1.06, 3.42), pole_r=(-1.0, 0.0, -0.9), hand_dir_r=_n((0.5, -0.85, -0.1)),
                              hand_roll_r=-90, fist_r=0.0, spread_r=0.6, hand_l=(0.36, -0.2, 3.12),
                              hand_dir_l=_n((0.1, 0.4, -1.0)), hand_roll_l=-10, fist_l=0.2),
                       b_pulse=1.12, b_roll=8, b_tilt=6, veil=2, veil_side=16, tent=40, frill=30, frill_side=10)
    after = with_look(strike.but(twist=18, lean=10, hand_r=(0.04, -0.92, 3.3)), b_pulse=1.04, b_roll=5,
                      veil_side=10, tent=22, frill=16)
    keys = [(0.0, st, 'inout'), (0.34, draw, 'in'), (HYMN_RELEASE, strike, 'out'), (0.86, after, 'inout'),
            (1.36, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Dart'] = smooth((t - 0.12) / 0.3) if t < HYMN_RELEASE else 0.0
        return b.but(scale=sc)
    return fn, 1.36


def hit(rig):
    st = stance(rig)
    jolt = with_look(st.but(lean=-8, twist=10, pelvis=(0.0, 0.14, 0.03), look=(-8, 12), head_roll=-10,
                            hand_l=(0.3, -0.24, 3.2), hand_r=(-0.28, -0.26, 3.22)),
                     b_pulse=0.78, b_size=0.95, b_tilt=-8, veil=-8, tent=20, frill=14)
    keys = [(0.0, st, 'out'), (0.12, jolt, 'out'), (0.28, jolt.but(lean=-3), 'inout'), (0.62, st, 'linear')]
    return keyed(keys), 0.62


def cast(rig, period=2.4):
    """The generic channel: hands cupped and raised at her breast, face lifted
    to the moon, the bell beating twice a loop."""
    st = stance(rig)
    up = st.but(lean=-3, neck=-2, look=(0, 14), head_roll=4, hand_l=(0.13, -0.38, 3.36), hand_r=(-0.13, -0.38, 3.36),
                hand_dir_l=_n((-0.5, -0.6, 0.6)), hand_dir_r=_n((0.5, -0.6, 0.6)), hand_roll_l=-70, hand_roll_r=-70,
                fist_l=0.25, fist_r=0.25)

    def fn(t):
        u = TAU * t / period
        beat = 0.5 - 0.5 * math.cos(2 * u)
        b = up.but(pelvis=(0, 0, 0.05 * math.sin(u)), look=(3 * math.sin(u), 14 + 2 * math.sin(2 * u)),
                   head_roll=4 + 4 * math.sin(u))
        return with_look(b, b_pulse=1.0 - 0.12 * beat, b_size=1.0 + 0.03 * beat, veil=2, wave=3, phase=u,
                         frill=4 * math.sin(u))
    return fn


def lullaby(rig):
    """Lullaby (the 2.0 s bar): the bell opens wide, the four rings wheel round
    its crown, her head tips to one side and she sways side to side with her
    arms open, palms up, rocking the target to sleep; the song lands at the
    bar's end (peak 1.8). The bell turns half round in the bar and settles back
    by symmetry (four rings, sixteen lappets) before the bar ends."""
    st = stance(rig)
    T = LULLABY_BAR
    period = 0.95

    def open_pose(sw):
        return st.but(lean=-2, neck=4, look=(10 * sw, 8), head_roll=16 * sw, side=7 * sw,
                      pelvis=(0.07 * sw, 0.0, 0.08), twist=4 * sw,
                      hand_l=(0.58 + 0.04 * sw, -0.5, 3.3 + 0.07 * sw), hand_r=(-0.58 + 0.04 * sw, -0.5, 3.3 - 0.07 * sw),
                      pole_l=(1.0, 0.6, -0.6), pole_r=(-1.0, 0.6, -0.6), hand_dir_l=_n((0.3, -0.85, 0.15)),
                      hand_dir_r=_n((-0.3, -0.85, 0.15)), hand_roll_l=-95, hand_roll_r=-95, fist_l=0.08, fist_r=0.08,
                      spread_l=0.4, spread_r=0.4)

    def fn(t):
        if t <= T:
            # into the song (0.35 s), then the rocking, two and a bit swings
            e = smooth(t / 0.35)
            sw = math.sin(TAU * max(0.0, t - 0.2) / (2 * period)) * smooth((t - 0.2) / 0.3)
            b = st.mix(open_pose(sw), e)
            spin = 180.0 * smooth((t - 0.15) / 1.7) if t < 1.9 else 0.0
            beat = 0.5 - 0.5 * math.cos(TAU * t / period)
            return with_look(b, b_pulse=1.0 + 0.16 * e - 0.05 * beat, b_size=1.0 + 0.07 * e, b_spin=spin,
                             b_roll=5 * sw, veil=6 + 4 * sw, veil_side=5 * sw, wave=5, phase=TAU * t / period,
                             tent=10 * e, frill=8 * e, frill_side=8 * sw)
        # the recovery the crossfade usually stands in for (the seam home)
        u = smooth((t - T) / 0.45)
        sw = math.sin(TAU * (T - 0.2) / (2 * period))
        b = open_pose(sw).mix(st, u)
        return with_look(b, b_pulse=1.16 - 0.16 * u, b_size=1.07 - 0.07 * u, b_roll=5 * sw * (1 - u),
                         veil=(6 + 4 * sw) * (1 - u), veil_side=5 * sw * (1 - u), tent=10 * (1 - u),
                         frill=8 * (1 - u))
    return fn, T + 0.45


def mend(rig):
    """Pale Mending (the 2.5 s bar): she turns her hands to the hurt packmate
    (she faces it), palms out and fingers spread, her frilled oral arms and
    face tentacles stretching toward it; a ball of cyan light gathers between
    her hands and swells, and at the bar's end (2.4) she pushes it out to the
    ally and it is gone."""
    st = stance(rig)
    T = MEND_BAR
    reach = with_look(st.but(lean=10, neck=6, look=(0, 2), head_roll=-6, pelvis=(0, -0.1, 0.06),
                             hand_l=(0.2, -0.72, 3.36), hand_r=(-0.2, -0.72, 3.36), pole_l=(1.0, 0.4, -0.7),
                             pole_r=(-1.0, 0.4, -0.7), hand_dir_l=_n((-0.35, -0.8, 0.4)),
                             hand_dir_r=_n((0.35, -0.8, 0.4)), hand_roll_l=-60, hand_roll_r=-60, fist_l=0.0,
                             fist_r=0.0, spread_l=0.8, spread_r=0.8),
                      b_pulse=1.06, b_tilt=6, veil=4, tent=45, frill=60)
    push = with_look(reach.but(lean=18, pelvis=(0, -0.2, 0.04), hand_l=(0.18, -0.98, 3.42),
                               hand_r=(-0.18, -0.98, 3.42), hand_dir_l=_n((-0.2, -1.0, 0.2)),
                               hand_dir_r=_n((0.2, -1.0, 0.2)), hand_roll_l=-85, hand_roll_r=-85),
                     b_pulse=1.16, b_size=1.04, b_tilt=10, veil=-4, tent=70, frill=85)
    keys = [(0.0, st, 'inout'), (0.55, reach, 'inout'), (2.1, reach.but(lean=12, pelvis=(0, -0.12, 0.08)), 'in'),
            (2.38, push, 'out'), (T, push, 'inout'), (T + 0.5, st, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        if t < 2.38:
            g = smooth((t - 0.3) / 1.0) * (0.75 + 0.25 * smooth((t - 1.3) / 1.0))
            sc['Light'] = g * (1.0 + 0.06 * math.sin(TAU * t / 0.5))
        else:
            sc['Light'] = 1.25 * (1.0 - smooth((t - 2.38) / 0.12))
        pulse = 0.5 - 0.5 * math.cos(TAU * t / 0.8)
        sc['BellRim'] = sc.get('BellRim', 1.0) - 0.06 * pulse * (t < T)
        return b.but(scale=sc)
    return fn, T + 0.5


def death(rig):
    """She dies as water: a jolt, the bell draws in hard and crumples, her head
    bows and her arms fall; then she sinks straight down through the floor as
    if she were poured away (1.0 to 2.7), the veil and the hem spreading on the
    floor round her, until only the crumpled bell lies in a pool of moonlit
    water (from 1.0) that settles by 3.0."""
    st = stance(rig)
    jolt = with_look(st.but(lean=-12, neck=-10, look=(0, 26), pelvis=(0, 0.1, 0.06), head_roll=-6,
                            hand_l=(0.5, -0.1, 3.3), hand_r=(-0.5, -0.1, 3.3), fist_l=0.05, fist_r=0.05,
                            spread_l=0.6, spread_r=0.6),
                     b_pulse=0.72, b_size=0.94, b_tilt=-10, veil=-10, tent=30, frill=20)
    slump = with_look(st.but(lean=34, neck=24, look=(4, -26), head_roll=14, pelvis=(0, -0.05, -0.45),
                             hand_l=(0.42, -0.2, 2.75), hand_r=(-0.44, -0.18, 2.75), hand_dir_l=_n((0.1, 0.0, -1.0)),
                             hand_dir_r=_n((-0.1, 0.0, -1.0)), fist_l=0.4, fist_r=0.4),
                      b_pulse=0.62, b_size=0.86, b_tilt=24, b_roll=10, veil=0, tent=0, frill=0)
    # hand targets are armature-space: they sink with her
    sunk = with_look(slump.but(lean=14, neck=4, look=(4, -6), head_roll=8, pelvis=(0, -0.1, -3.98),
                               hand_l=(0.5, -0.3, 2.75 - 3.98), hand_r=(-0.5, -0.28, 2.75 - 3.98)),
                     b_pulse=0.8, b_size=0.82, b_tilt=-8, b_roll=10, veil=-10)
    keys = [(0.0, st, 'out'), (0.22, jolt, 'inout'), (0.95, slump, 'inout'), (2.7, sunk, 'out'),
            (3.0, sunk, 'hold'), (3.2, sunk, 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Pool'] = smooth((t - 0.9) / 1.2)
        # the veil and the face tentacles run into the pool as she goes under
        melt = 1.0 - 0.97 * smooth((t - 1.5) / 1.1)
        for i in range(len(A.VEIL_ANG)):
            sc[f'Veil{i}_1'] = melt
        for _, side in A.TENT_SIDES:
            sc[f'Tent{side}1'] = melt
        return b.but(scale=sc)
    return fn, 3.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (glide(r, WALK_PERIOD), WALK_PERIOD), True),
    ('Run', lambda r: (glide(r, RUN_PERIOD, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda r: (cast(r), 2.4), True),
    ('Lullaby', lullaby, False),
    ('Mend', mend, False),
    ('Hit', hit, False),
    ('Death', death, False),
]


def _floor_pool(f):
    """The pool rides the Root (which carries the pelvis): hold it on the floor."""
    def g(t):
        b = f(t)
        pv = b.p['pelvis']
        return b.but(offset={'Pool': (-pv[0], -pv[1], -pv[2])})
    return g


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        f = _floor_pool(f)
        M.STATEFUL_IK = False
        write_clip(arm, rig, name, f, dur, loop=loop,
                   wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run' else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
