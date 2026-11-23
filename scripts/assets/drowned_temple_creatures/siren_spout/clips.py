"""Every clip the Moonlit Siren ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage or an effect lands.
She never crawls: her waterspout holds her upright and whirls round her tail
(one full turn a loop), the tail sways inside it, the veil fins and the
floating hair drift on follow-through chains; the coral staff rides her right
fist.

The sim: Brine Lash is a petSpell bolt whose 0.6 s windup cue plays the
ATTACK clips (Attack and Attack2 in turn), the lash leaving at the windup's
end; the manifest plays them at their own pace (attackTimeScale 1), so both
release at 0.6. Call the Tide (2.5 s bar) is a bar-locked cast clip (Sing):
the three tide bubbles leave her spout as the bar ends, where the sim raises
the three Tidewisps; a kick crossfades her home before they fly.
"""
import math

import numpy as np

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 2.4, 1.2
WALKREF, RUNREF = 2.5, 7.0
LASH_RELEASE = 0.6                  # petSpell.windup (drowned_temple.ts): the bolt leaves here
SING_BAR = 2.5                      # Call the Tide's cast bar


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


def tail(sway=0.0, fwd=0.0, wave=0.0, phase=0.0, curl=0.0):
    """Turns down the tail: a sideways sway growing to the tip plus a travelling
    wave, a forward (+) or back (-) swing, and the fluke's curl (+ forward)."""
    out = {}
    for i in range(4):
        w = (i + 1) / 4
        y = sway * (0.25 + 0.75 * w) + wave * math.sin(phase - i * 0.9) * (0.4 + w)
        out[f'Tail{i + 1}'] = [('y', y), ('x', -fwd * (0.4 + 0.6 * w))]
    out['Tail5'] = [('x', -curl), ('y', sway * 0.6 + wave * math.sin(phase - 3.6))]
    return out


def fins(spread=0.0, swing=0.0, wave=0.0, phase=0.0):
    """The veil fins at her hips: `spread` opens them out (+), `swing` throws
    them forward (+) or back (-), `wave` ripples them."""
    return {'L_Fin1': [('y', -spread), ('x', -swing + wave * math.sin(phase))],
            'L_Fin2': [('x', wave * 0.6 * math.sin(phase - 0.8))],
            'R_Fin1': [('y', spread), ('x', -swing + wave * math.sin(phase + 1.3))],
            'R_Fin2': [('x', wave * 0.6 * math.sin(phase + 0.5))]}


def hair(lift=0.0, wave=0.0, phase=0.0, stream=0.0):
    """The floating hair: `lift` raises the locks (+), `wave` sways them as
    in a current, `stream` lays them back (+, a glide or a gust)."""
    out = {}
    for i in range(len(A.HAIR_ANG)):
        w = math.sin(phase - i * 1.1)
        out[f'Hair{i}_1'] = [('x', lift + 6 * w * wave / 10 - stream * 0.5), ('z', wave * math.sin(phase + i * 0.7))]
        out[f'Hair{i}_2'] = [('x', wave * 0.8 * math.sin(phase - i * 1.1 - 0.9) - stream * 0.3)]
    return out


def spout(spin=0.0, tilt=0.0, roll=0.0):
    return {'Spout': [((0, 0, 1), spin), ('x', tilt), ('y', roll)]}


def look(sp=None, tl=None, fn=None, hr=None):
    out = {}
    for d in (sp, tl, fn, hr):
        if d:
            out.update(d)
    return out


STAFF_REST = dict(hand_r=(-0.6, -0.2, 3.02), pole_r=(-0.9, 0.7, -0.4), weapon=_n((0.03, -0.1, 1.0)), fist_r=1.0)
LEFT_REST = dict(hand_l=(0.48, -0.3, 2.98), pole_l=(1.0, 0.6, -0.4), hand_dir_l=_n((-0.2, -0.55, -0.8)),
                 hand_roll_l=-20.0, fist_l=0.2, spread_l=0.25)


def stance(rig):
    return Body(rig, pelvis=(0.0, 0.0, 0.0), lean=0, neck=6, look=(0, -4), head_roll=3, clav_l=-1, clav_r=-1,
                scale=dict(A.HIDDEN), **STAFF_REST, **LEFT_REST)


def idle(rig, period=4.0):
    st = M.aim_weapon(stance(rig))

    def fn(t):
        u = TAU * t / period
        s1, s2 = math.sin(u), math.sin(2 * u)
        b = st.but(pelvis=(0.02 * s1, 0.0, 0.05 * math.sin(u - 0.5)), side=-1.8 * s1, lean=1.2 * s2,
                   look=(6 * s1, -4 + 2 * s2), head_roll=3 + 3 * s1, clav_l=-1 + 1.5 * s2, clav_r=-1 + 1.5 * s2,
                   hand_l=(0.48, -0.3, 2.98 + 0.03 * s2),
                   extra=look(spout(spin=360.0 * t / period, tilt=1.5 * s1), tail(sway=7 * s1, wave=5, phase=u),
                              fins(spread=4, wave=6, phase=u), hair(lift=6 + 4 * s2, wave=8, phase=u)))
        return b
    return fn


def glide(rig, period, run=False):
    st = stance(rig)
    lean = 14 if run else 6
    base = M.aim_weapon(st.but(lean=lean, neck=2 if run else 5, look=(0, 6 if run else -2), head_roll=0,
                               hand_r=(-0.56, 0.02, 3.0) if run else (-0.6, -0.12, 3.02),
                               weapon=_n((0.05, 0.6, 0.8)) if run else _n((0.03, 0.12, 1.0)),
                               hand_l=(0.5, 0.25, 2.92) if run else (0.5, -0.05, 2.94),
                               hand_dir_l=_n((0.1, 0.6, -0.8)), hand_roll_l=-10.0))

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        bob = (0.06 if run else 0.04) * math.sin(u * 2 - 1.2)
        b = base.but(pelvis=(0.02 * math.sin(u), 0.0, bob), side=2 * math.sin(u), lean=lean + 1.5 * math.sin(2 * u),
                     extra=look(spout(spin=360.0 * ph, tilt=(16 if run else 8) + 2 * math.sin(2 * u)),
                                tail(sway=8 * math.sin(u), fwd=-(16 if run else 8), wave=7 if run else 5, phase=u),
                                fins(spread=6, swing=-(22 if run else 10), wave=8, phase=u),
                                hair(lift=2, wave=6, phase=u, stream=30 if run else 14)))
        return b
    return fn


def attack(rig):
    """The staff's blow (and Brine Lash's fling): she draws the staff back over
    her right shoulder as the spout rears, then sweeps it down and across in
    front of her (0.6), the water lashing off its head."""
    st = stance(rig)
    draw = M.aim_weapon(st.but(twist=-26, lean=-8, neck=0, look=(-8, 10), head_roll=8, pelvis=(0.0, 0.08, 0.08),
                               hand_r=(-0.62, 0.22, 3.86), pole_r=(-1.0, 0.3, -0.5), weapon=_n((0.25, 0.75, 0.6)),
                               hand_l=(0.5, -0.5, 3.25), hand_dir_l=_n((0.2, -0.9, 0.3)), hand_roll_l=-70,
                               fist_l=0.05, spread_l=0.6,
                               extra=look(spout(spin=40, tilt=-8), tail(sway=-10, fwd=10, curl=12),
                                          fins(spread=12, swing=8), hair(lift=12, stream=-10))))
    strike = M.aim_weapon(st.but(twist=28, lean=18, neck=8, look=(10, -4), head_roll=-6, pelvis=(0.0, -0.18, -0.02),
                                 hand_r=(-0.1, -1.0, 3.1), pole_r=(-1.0, 0.2, -0.7), weapon=_n((0.75, -0.62, -0.2)),
                                 hand_l=(0.6, 0.12, 3.0), hand_dir_l=_n((0.3, 0.7, -0.6)), hand_roll_l=-20,
                                 fist_l=0.2,
                                 extra=look(spout(spin=110, tilt=14), tail(sway=12, fwd=-14, curl=-8),
                                            fins(spread=8, swing=-18), hair(lift=4, stream=24))))
    after = strike.but(lean=13, twist=22, hand_r=(-0.2, -0.86, 3.0),
                       extra=look(spout(spin=150, tilt=8), tail(sway=8, fwd=-8), fins(spread=6, swing=-8),
                                  hair(lift=6, stream=12)))
    rest = M.aim_weapon(st).but(extra=look(spout(spin=200), tail(), fins(spread=4), hair(lift=6)))
    keys = [(0.0, M.aim_weapon(st).but(extra=look(spout(spin=0), tail(), fins(spread=4), hair(lift=6))), 'inout'),
            (0.36, draw, 'in'), (LASH_RELEASE, strike, 'out'), (0.86, after, 'inout'), (1.32, rest, 'linear')]
    return keyed(keys), 1.32


def attack2(rig):
    """Brine Lash: she levels the staff at her target, the moon pearl flaring
    as water gathers on it, her left hand flung back; then she cracks it
    forward like a whip (0.6) and the pearl's light leaves with the lash."""
    st = stance(rig)
    aim = M.aim_weapon(st.but(twist=-10, lean=-4, look=(-4, 6), head_roll=4, pelvis=(0.0, 0.1, 0.06),
                              hand_r=(-0.5, -0.3, 3.5), pole_r=(-1.0, 0.2, -0.6), weapon=_n((0.05, 0.35, 0.94)),
                              hand_l=(0.62, 0.3, 3.3), hand_dir_l=_n((0.4, 0.6, 0.6)), hand_roll_l=-40,
                              fist_l=0.0, spread_l=0.7,
                              extra=look(spout(spin=30, tilt=-6), tail(sway=-6, fwd=8, curl=10),
                                         fins(spread=14, swing=6), hair(lift=16, stream=-6))))
    crack = M.aim_weapon(st.but(twist=12, lean=16, neck=6, look=(2, 0), head_roll=-4, pelvis=(0.0, -0.16, 0.0),
                                hand_r=(-0.3, -1.05, 3.4), pole_r=(-1.0, 0.0, -0.6), weapon=_n((0.1, -0.98, 0.12)),
                                hand_l=(0.6, 0.25, 3.1), hand_dir_l=_n((0.3, 0.6, -0.5)), hand_roll_l=-20,
                                fist_l=0.2,
                                extra=look(spout(spin=100, tilt=14), tail(sway=8, fwd=-12, curl=-6),
                                           fins(spread=8, swing=-16), hair(lift=6, stream=22))))
    after = crack.but(lean=11, hand_r=(-0.36, -0.9, 3.3),
                      extra=look(spout(spin=140, tilt=8), tail(sway=5, fwd=-6), fins(spread=6, swing=-6),
                                 hair(lift=6, stream=10)))
    rest = M.aim_weapon(st).but(extra=look(spout(spin=190), tail(), fins(spread=4), hair(lift=6)))
    keys = [(0.0, M.aim_weapon(st).but(extra=look(spout(spin=0), tail(), fins(spread=4), hair(lift=6))), 'inout'),
            (0.4, aim, 'in'), (LASH_RELEASE, crack, 'out'), (0.84, after, 'inout'), (1.3, rest, 'linear')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        if t < LASH_RELEASE:
            sc['Flare'] = smooth((t - 0.12) / 0.4) * (1.0 + 0.1 * math.sin(TAU * t / 0.18))
        else:
            sc['Flare'] = 1.2 * (1.0 - smooth((t - LASH_RELEASE) / 0.14))
        return b.but(scale=sc)
    return fn, 1.3


def hit(rig):
    st = M.aim_weapon(stance(rig))
    jolt = st.but(lean=-9, twist=10, pelvis=(0.0, 0.16, 0.04), look=(-8, 12), head_roll=-10,
                  hand_l=(0.6, -0.1, 3.2),
                  extra=look(spout(spin=25, tilt=-8, roll=4), tail(sway=-10, fwd=12, curl=10),
                             fins(spread=12, swing=10), hair(lift=14, stream=-12)))
    base = st.but(extra=look(spout(spin=0), tail(), fins(spread=4), hair(lift=6)))
    end = st.but(extra=look(spout(spin=60), tail(), fins(spread=4), hair(lift=6)))
    keys = [(0.0, base, 'out'), (0.12, jolt, 'out'), (0.28, jolt.but(lean=-4), 'inout'), (0.62, end, 'linear')]
    return keyed(keys), 0.62


def cast(rig, period=2.4):
    """The generic channel: the staff raised before her, her left hand on her
    heart, face lifted, the spout whirling."""
    st = stance(rig)
    up = M.aim_weapon(st.but(lean=-3, neck=-2, look=(0, 14), head_roll=4, hand_r=(-0.42, -0.42, 3.4),
                             weapon=_n((0.05, -0.15, 1.0)), hand_l=(0.12, -0.3, 3.5),
                             hand_dir_l=_n((-0.7, -0.3, 0.6)), hand_roll_l=-70, fist_l=0.1))

    def fn(t):
        u = TAU * t / period
        return up.but(pelvis=(0, 0, 0.05 * math.sin(u)), look=(3 * math.sin(u), 14 + 2 * math.sin(2 * u)),
                      head_roll=4 + 4 * math.sin(u),
                      extra=look(spout(spin=360.0 * t / period), tail(sway=5 * math.sin(u), wave=4, phase=u),
                                 fins(spread=6, wave=5, phase=u), hair(lift=10, wave=7, phase=u)))
    return fn


def sing(rig):
    """Call the Tide (the 2.5 s bar): she draws in, then throws her arms wide,
    the staff raised high, her head back, and sings; the spout swells and
    whirls faster, and three bubbles of tide gather in it, rise and, as the bar
    ends (2.5), fly out round her to where the sim raises the three Tidewisps."""
    st = stance(rig)
    T = SING_BAR
    gather = M.aim_weapon(st.but(lean=8, neck=12, look=(0, -14), head_roll=0, pelvis=(0, 0.04, -0.05),
                                 hand_r=(-0.32, -0.36, 3.22), weapon=_n((0.2, -0.1, 0.97)),
                                 hand_l=(0.22, -0.34, 3.3), hand_dir_l=_n((-0.6, -0.4, 0.6)), hand_roll_l=-60,
                                 fist_l=0.3))
    open_ = M.aim_weapon(st.but(lean=-12, neck=-6, look=(0, 30), head_roll=-4, pelvis=(0, 0.06, 0.14),
                                hand_r=(-0.86, -0.2, 4.3), pole_r=(-1.0, 0.4, 0.2), weapon=_n((-0.3, -0.1, 0.95)),
                                hand_l=(0.98, -0.3, 3.72), pole_l=(1.0, 0.3, -0.5), hand_dir_l=_n((0.6, -0.2, 0.4)),
                                hand_roll_l=-110, fist_l=0.0, spread_l=0.8, clav_l=8, clav_r=8))

    def fn(t):
        if t <= T:
            g = smooth(t / 0.4) * (1 - smooth((t - 0.45) / 0.45))
            o = smooth((t - 0.45) / 0.55)
            b = st.mix(gather, g) if o <= 0 else gather.mix(open_, o)
            if o <= 0:
                b = M.aim_weapon(st).mix(gather, smooth(t / 0.4))
            sw = math.sin(TAU * t / 1.1)
            b = b.but(pelvis=(0.0, 0.06 * o, 0.14 * o + 0.03 * sw * o), look=(4 * sw * o, 30 * o - 14 * (1 - o) * g),
                      head_roll=-4 * o + 3 * sw * o,
                      extra=look(spout(spin=360.0 * (t / T) * 1.6, tilt=-4 * o),
                                 tail(sway=6 * sw, wave=6 + 4 * o, phase=TAU * t / 0.9, curl=10 * o),
                                 fins(spread=6 + 16 * o, wave=8, phase=TAU * t / 0.9),
                                 hair(lift=8 + 22 * o, wave=10, phase=TAU * t / 0.9)))
            sc = dict(b.p['scale'])
            sc['Spout'] = 1.0 + 0.16 * o + 0.03 * sw * o
            off = {}
            for i, p in enumerate(A.BUBBLES):
                born = 0.55 + 0.18 * i
                g_i = smooth((t - born) / 0.6)
                fly = smooth((t - 2.2) / 0.3)
                out = np.array((p[0], p[1], 0.0))
                out = out / max(1e-6, np.linalg.norm(out))
                rise = 0.55 * smooth((t - born) / 1.4) + 1.0 * fly
                off[f'Bubble{i}'] = tuple(out * (2.4 * fly) + np.array((0, 0, rise)))
                sc[f'Bubble{i}'] = g_i * (1.0 - smooth((t - 2.38) / 0.12)) * (1.0 + 0.06 * math.sin(TAU * t / 0.4 + i))
            return b.but(scale=sc, offset=off)
        # the recovery the crossfade usually stands in for
        u = smooth((t - T) / 0.5)
        b = open_.mix(M.aim_weapon(st), u)
        return b.but(extra=look(spout(spin=576.0 + 120 * u), tail(), fins(spread=22 - 18 * u),
                                hair(lift=30 - 24 * u)),
                     scale={'Spout': 1.16 - 0.16 * u})
    return fn, T + 0.5


def death(rig):
    """She dies as water: a jolt, the waterspout breaks and falls away under
    her (0.4 to 1.0), she drops into its pool with her arms flung up, then
    slumps and sinks through the foam until only the pool and the foam
    remain (3.0). The staff goes down with her."""
    st = stance(rig)
    base = M.aim_weapon(st).but(extra=look(spout(spin=0), tail(), fins(spread=4), hair(lift=6)))
    jolt = M.aim_weapon(st.but(lean=-14, neck=-10, look=(0, 28), pelvis=(0, 0.12, 0.08), head_roll=-6,
                               hand_l=(0.62, -0.1, 3.5), fist_l=0.0, spread_l=0.6,
                               extra=look(spout(spin=40, tilt=-10), tail(fwd=14, curl=14), fins(spread=16, swing=12),
                                          hair(lift=22))))
    drop = M.aim_weapon(st.but(lean=6, neck=-4, look=(0, 18), pelvis=(0, 0.05, -1.95), head_roll=10,
                               hand_r=(-0.7, 0.0, 3.6 - 1.95), weapon=_n((-0.4, 0.3, 0.86)),
                               hand_l=(0.7, -0.1, 3.7 - 1.95), fist_l=0.0, spread_l=0.6,
                               extra=look(spout(spin=60), tail(fwd=-30, curl=-20, sway=10), fins(spread=40, swing=-20),
                                          hair(lift=34))))
    slump = M.aim_weapon(st.but(lean=36, neck=26, look=(4, -26), pelvis=(0, -0.05, -2.4), head_roll=14,
                                hand_r=(-0.72, -0.4, 2.9 - 2.4), weapon=_n((-0.6, -0.2, 0.75)),
                                hand_l=(0.5, -0.3, 2.9 - 2.4), hand_dir_l=_n((0.1, 0.0, -1.0)), fist_l=0.4,
                                extra=look(spout(spin=60), tail(fwd=-30, curl=-20, sway=10),
                                           fins(spread=40, swing=-20), hair(lift=10))))
    sunk = slump.but(lean=12, neck=6, pelvis=(0, -0.1, -4.6), hand_r=(-0.7, -0.4, 2.9 - 4.6),
                     hand_l=(0.5, -0.3, 2.9 - 4.6))
    keys = [(0.0, base, 'out'), (0.22, jolt, 'inout'), (0.95, drop, 'in'), (1.5, slump, 'inout'),
            (2.9, sunk, 'out'), (3.2, sunk, 'hold')]
    seq = keyed(keys)

    def fn(t):
        b = seq(t)
        sc = dict(b.p['scale'])
        sc['Spout'] = 1.0 - smooth((t - 0.35) / 0.65)
        sc['Pool'] = smooth((t - 0.6) / 0.8)
        melt = 1.0 - 0.95 * smooth((t - 1.6) / 1.2)
        for ch in A.HAIR_CHAINS:
            sc[ch[0]] = melt
        return b.but(scale=sc)
    return fn, 3.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 4.0), True),
    ('Walk', lambda r: (glide(r, WALK_PERIOD), WALK_PERIOD), True),
    ('Run', lambda r: (glide(r, RUN_PERIOD, run=True), RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda r: (cast(r), 2.4), True),
    ('Sing', sing, False),
    ('Hit', hit, False),
    ('Death', death, False),
]


def _on_floor(f):
    """The spout and the pool ride the Root (which carries the pelvis): hold
    them on the floor, so she bobs in her spout and the pool stays put."""
    def g(t):
        b = f(t)
        pv = b.p['pelvis']
        off = dict(b.p['offset'] or {})
        for bone in ('Pool', 'Spout'):
            o = off.get(bone, (0.0, 0.0, 0.0))
            off[bone] = (o[0] - pv[0], o[1] - pv[1], o[2] - pv[2])
        for i in range(len(A.BUBBLES)):
            o = off.get(f'Bubble{i}', (0.0, 0.0, 0.0))
            off[f'Bubble{i}'] = (o[0] - pv[0], o[1] - pv[1], o[2] - pv[2])
        return b.but(offset=off)
    return g


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        f, dur = fn(rig)
        f = _on_floor(f)
        M.STATEFUL_IK = False
        write_clip(arm, rig, name, f, dur, loop=loop,
                   wind=(WALKREF if name == 'Walk' else RUNREF if name == 'Run' else 0.0))
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
