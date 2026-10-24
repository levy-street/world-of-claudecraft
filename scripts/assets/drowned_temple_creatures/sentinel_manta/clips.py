"""Every clip the Moonmantle Ray ships, with its contact frames.

Times in seconds (24 fps). CONTACT = the frame damage lands. The root stays
on the floor; the body glides a yard over it. Its wings never stop: a slow
wave rolls along each from the root to the tip, the leading edge lifting as
the wing rises, while the tail sways behind and the heart pearl breathes.

The sim (the Pearlguard Sentinel's record, unchanged): two melee swings
(Attack: a cut with the right wing's edge, CONTACT 0.42; Attack2: the tail
arched over its back and lashed down in front, CONTACT 0.5); Onrush is its
charge (Run, the Lunar Glide: risen, the wings swept back and folded down
like an arrowhead, darting); Pearl Slam is a 1.5 s cast bar (Slam, the Tidal
Wingbeat: it rears up on its tail, the wings opened to their full height,
and drives them down as the bar ends, CONTACT 1.5); Pearl Carapace is an 8 s
ward: while it holds, the rig swaps to its cocoon stance (ShellClose wraps
the wings down under its belly, ShellIdle / ShellWalk / ShellAttack / ShellHit
hold it, ShellOpen bursts it open). Dying, it sinks slowly to the floor,
the light in its wings going out from the tips inward, the pearl last.

Walk and Run have no feet to match: WALKREF and RUNREF are the glide speeds
the wingbeats are authored for (its wander and its chase), and the tail's
stream behind it is drawn for them.
"""
import math

import anatomy as A
import motion as M
from motion import EASE_FN, Body, smooth, write_clip

TAU = math.tau
NW = A.N_WING
WALK_PERIOD, RUN_PERIOD, IDLE_PERIOD = 2.4, 0.8, 4.0
WALKREF, RUNREF = 2.4, 6.5
ATTACK_CONTACT, ATTACK2_CONTACT, SLAM_BAR = 0.42, 0.5, 1.5
W_AMP = (0.3, 0.6, 0.85, 1.0, 1.0)            # how much of a wave each wing segment carries


def _z(n):
    return (0.0,) * n


P0 = dict(
    pelvis=(0.0, 0.0, 0.0),     # the root's offset (the whole body)
    pitch=0.0,                  # nose up +
    roll=0.0,                   # bank: left wing down +
    yaw=0.0,                    # turn to its left +
    head=0.0,                   # the head up +
    hip=0.0,                    # the rear up +
    flapL=_z(NW), flapR=_z(NW),     # each wing segment up +
    twistL=_z(NW), twistR=_z(NW),   # its leading edge up +
    sweepL=0.0, sweepR=0.0,         # the whole wing swept back +
    tailUp=_z(6), tailSide=_z(6),   # each tail segment up +, to its left +
    lobe=0.0,                   # the lobes opened + (curled -)
    lobeUp=0.0,                 # the lobes tipped up +
    pearl=1.0, dark=0.0, eye=1.0,
    glow=(1.0,) * NW,
)


def P(base=None, **kw):
    p = dict(P0 if base is None else base)
    for k, v in kw.items():
        if k not in P0:
            raise KeyError(k)
        p[k] = tuple(float(x) for x in v) if isinstance(v, (tuple, list)) else v
    return p


def mix(a, b, u):
    out = {}
    for k, va in a.items():
        vb = b[k]
        if isinstance(va, tuple):
            out[k] = tuple(x + (y - x) * u for x, y in zip(va, vb))
        else:
            out[k] = va + (vb - va) * u
    return out


def add(p, **kw):
    """Add offsets to a pose (tuples elementwise)."""
    out = dict(p)
    for k, v in kw.items():
        if isinstance(p[k], tuple):
            out[k] = tuple(x + y for x, y in zip(p[k], v))
        else:
            out[k] = p[k] + v
    return out


def keyed(seq):
    """fn(t) over [(t, pose, ease)], each segment eased by its first key."""
    def fn(t):
        if t <= seq[0][0]:
            return seq[0][1]
        for (t0, a, e), (t1, b, _) in zip(seq, seq[1:]):
            if t0 <= t <= t1:
                return mix(a, b, EASE_FN[e]((t - t0) / max(1e-9, t1 - t0)))
        return seq[-1][1]
    return fn


def wave(ph, amp, lag=0.55, tw=0.0, w=W_AMP, ka=(1.0, 1.0)):
    """A wingbeat: a wave rolling from root to tip, the leading edge lifting
    on the way up. Returns (flapL, flapR, twistL, twistR) offsets."""
    fl = tuple(amp * w[i] * math.sin(ph - lag * i) for i in range(NW))
    tws = tuple(tw * w[i] * math.cos(ph - lag * i) for i in range(NW))
    return (tuple(x * ka[0] for x in fl), tuple(x * ka[1] for x in fl), tws, tws)


def beat(p, ph, amp, lag=0.55, tw=0.0, w=W_AMP):
    fl, fr, tl, tr = wave(ph, amp, lag, tw, w)
    return add(p, flapL=fl, flapR=fr, twistL=tl, twistR=tr)


def sway(p, ph, side, up, lag=0.8, harm=1):
    """The tail's travelling sway (side to side) and ripple (up and down)."""
    s = tuple(side * (0.3 + 0.7 * i / 5) * math.sin(ph - lag * i) for i in range(6))
    u = tuple(up * (0.4 + 0.6 * i / 5) * math.sin(harm * 2 * ph - 0.7 * i) for i in range(6))
    return add(p, tailSide=s, tailUp=u)


def to_body(rig, p):
    ex = {
        'Body': [('x', -p['pitch']), ('y', p['roll']), ('z', p['yaw'])],
        'Head': [('x', -p['head'])],
        'Hip': [('x', p['hip'])],
    }
    for i in range(NW):
        ex[f'L_Wing{i + 1}'] = [('x', -p['twistL'][i]), ('y', -p['flapL'][i]), ('z', p['sweepL'] if i == 0 else 0.0)]
        ex[f'R_Wing{i + 1}'] = [('x', -p['twistR'][i]), ('y', p['flapR'][i]), ('z', -p['sweepR'] if i == 0 else 0.0)]
    for i in range(6):
        ex[f'Tail{i + 1}'] = [('x', p['tailUp'][i]), ('z', -p['tailSide'][i])]
    ex['L_Lobe1'] = [('x', -p['lobeUp']), ('y', 0.4 * p['lobe'])]
    ex['R_Lobe1'] = [('x', -p['lobeUp']), ('y', -0.4 * p['lobe'])]
    ex['L_Lobe2'] = [('y', p['lobe'])]
    ex['R_Lobe2'] = [('y', -p['lobe'])]
    sc = {'Pearl': p['pearl'], 'PearlDark': p['dark'], 'EyeGlow': p['eye']}
    for i in range(NW):
        sc[f'L_Glow{i + 1}'] = p['glow'][i]
        sc[f'R_Glow{i + 1}'] = p['glow'][i]
    return Body(rig, pelvis=tuple(p['pelvis']), extra=ex, scale=sc)


# ------------------------------------------------------------------ the poses
HOVER = P(flapL=(5, 1, -2, 0, 6), flapR=(5, 1, -2, 0, 6), tailUp=(-1, -1, 0, 0, 0, 0), lobe=-4)


def idle_p(t, period=IDLE_PERIOD):
    """Hovering: one slow wingbeat every four seconds rolling out to the tips,
    the body riding it a hand's breadth up and down, the tail swaying."""
    ph = TAU * t / period
    p = beat(HOVER, ph, 8.0, lag=0.55, tw=4.0)
    p = sway(p, ph, 6.0, 2.0)
    return add(p, pelvis=(0.0, 0.0, -0.07 * math.sin(ph - 1.1)), pitch=1.5 * math.sin(ph - 0.5),
               head=1.5 * math.sin(ph), lobe=3.0 * math.sin(ph + 0.6), pearl=0.05 * math.sin(2 * ph))


REST = idle_p(0.0)

GLIDE = P(HOVER, pitch=-3.0, head=-1.0, flapL=(2, 1, 0, 0, 0), flapR=(2, 1, 0, 0, 0), tailUp=(-3, 0, 0, 0, 0, 0),
          lobe=-8)


def walk_p(t, period=WALK_PERIOD):
    """The slow glide: deep, unhurried wingbeats, the body rising on each
    downstroke, the tail streaming straight behind."""
    ph = TAU * t / period
    p = beat(GLIDE, ph, 15.0, lag=0.6, tw=8.0)
    p = sway(p, ph, 4.0, 2.5)
    return add(p, pelvis=(0.0, 0.0, -0.1 * math.sin(ph - 1.2)), pitch=2.0 * math.sin(ph - 0.6),
               head=1.5 * math.sin(ph), pearl=0.05 * math.sin(ph))


DART = P(pelvis=(0.0, 0.0, 0.45), pitch=-7.0, head=-4.0, sweepL=26.0, sweepR=26.0, flapL=(-2, -6, -8, -8, -6),
         flapR=(-2, -6, -8, -8, -6), twistL=(-2, -3, -3, -2, -2), twistR=(-2, -3, -3, -2, -2),
         tailUp=(-6, -2, 0, 0, 0, 0), lobe=-20, lobeUp=-8)


def run_p(t, period=RUN_PERIOD):
    """The Lunar Glide (the charge, and its chase): risen, the wings swept back
    and folded down like an arrowhead, only their tips beating fast."""
    ph = TAU * t / period
    p = beat(DART, ph, 5.0, lag=0.5, tw=3.0, w=(0.1, 0.3, 0.6, 1.0, 1.0))
    p = sway(p, ph, 2.0, 1.5)
    return add(p, pelvis=(0.0, 0.0, -0.04 * math.sin(ph - 1.0)), pitch=1.0 * math.sin(ph))


def attack():
    """The wing cut: it banks left, the right wing swinging high and back,
    then rolls hard right and slices the wing's edge down across its front,
    lunging forward behind it. CONTACT 0.42."""
    T = 1.25
    wind = P(REST, pelvis=(0.25, 0.2, 0.45), pitch=6.0, roll=18.0, yaw=20.0, head=4.0,
             flapL=(4, 3, 2, 1, 0), flapR=(10, 12, 10, 6, 4), twistR=(4, 6, 6, 4, 2), sweepR=10.0, lobe=-6)
    cut = P(REST, pelvis=(-0.2, -0.5, 0.22), pitch=-4.0, roll=-22.0, yaw=-26.0, head=-4.0,
            flapL=(4, 4, 3, 2, 1), flapR=(2, 1, 0, 0, 0), twistR=(-8, -8, -6, -4, -2), sweepR=-14.0, lobe=-10)
    follow = P(cut, pelvis=(-0.1, -0.35, 0.1), roll=-14.0, yaw=-14.0, flapR=(3, 2, 1, 0, 0), sweepR=-6.0)
    seq = keyed([(0.0, REST, 'inout'), (0.28, wind, 'in'), (ATTACK_CONTACT, cut, 'out'), (0.72, follow, 'inout'),
                 (T, REST, 'linear')])
    return seq, T


def attack2():
    """The tail lash: it dips its head and lifts its rear, the tail arching
    up over its back like a scorpion's, then whips it over and down in front
    of its head. CONTACT 0.5."""
    T = 1.4
    arch = P(REST, pelvis=(0.0, 0.15, 0.1), pitch=-10.0, hip=8.0, head=-4.0, flapL=(6, 4, 2, 1, 0),
             flapR=(6, 4, 2, 1, 0), tailUp=(30, 36, 40, 40, 34, 26), lobe=-6)
    lash = P(REST, pelvis=(0.0, -0.3, -0.05), pitch=-16.0, hip=12.0, head=-6.0, flapL=(-2, -3, -3, -2, -1),
             flapR=(-2, -3, -3, -2, -1), tailUp=(46, 52, 56, 52, 44, 32), lobe=-10)
    back = P(REST, pitch=-6.0, hip=4.0, tailUp=(20, 18, 12, 6, 2, 0))
    seq = keyed([(0.0, REST, 'inout'), (0.32, arch, 'in'), (ATTACK2_CONTACT, lash, 'out'), (0.8, back, 'inout'),
                 (T, REST, 'linear')])
    return seq, T


CHANNEL = P(HOVER, pelvis=(0.0, 0.0, 0.25), pitch=8.0, head=4.0, flapL=(14, 10, 6, 4, 2), flapR=(14, 10, 6, 4, 2),
            tailUp=(4, 2, 0, 0, 0, 0), lobe=12, lobeUp=6, pearl=1.12)


def cast_p(t, period=2.4):
    ph = TAU * t / period
    p = beat(CHANNEL, ph, 4.0, lag=0.5, tw=2.0)
    p = sway(p, ph, 4.0, 1.5)
    return add(p, pelvis=(0.0, 0.0, 0.04 * math.sin(ph)), pearl=0.08 * math.sin(2 * ph))


def slam():
    """The Tidal Wingbeat (the 1.5 s bar): it rises and rears back on its
    tail until it stands taller than any player, the starry belly to its foe
    and both wings opened wide and high over it, held; as the bar ends
    (1.5) it brings the wings down hard in front of it, its body diving
    after them; recovered 2.4."""
    T = SLAM_BAR
    rise = P(REST, pelvis=(0.0, 0.35, 1.4), pitch=58.0, head=6.0, sweepL=-34.0, sweepR=-34.0,
             flapL=(-4, -2, 2, 4, 4), flapR=(-4, -2, 2, 4, 4), twistL=(4, 4, 2, 0, 0), twistR=(4, 4, 2, 0, 0),
             tailUp=(4, 12, 20, 16, 6, 2), lobe=10, pearl=1.1)
    hold = P(rise, pelvis=(0.0, 0.42, 1.85), pitch=72.0, sweepL=-54.0, sweepR=-54.0, flapL=(-6, -4, 2, 6, 8),
             flapR=(-6, -4, 2, 6, 8), tailUp=(6, 12, 20, 18, 10, 6), lobe=16, pearl=1.22)
    smash = P(REST, pelvis=(0.0, -0.55, -0.2), pitch=-12.0, head=-8.0, sweepL=8.0, sweepR=8.0,
              flapL=(-10, -10, -8, -5, -3), flapR=(-10, -10, -8, -5, -3), twistL=(-6, -6, -4, -2, 0),
              twistR=(-6, -6, -4, -2, 0), tailUp=(-12, -6, -2, 0, 0, 0), lobe=-12, pearl=1.05)
    settle = P(smash, pelvis=(0.0, -0.4, -0.05), pitch=-6.0, flapL=(-4, -4, -3, -2, -1), flapR=(-4, -4, -3, -2, -1))
    seq = keyed([(0.0, REST, 'inout'), (0.6, rise, 'inout'), (1.22, hold, 'expoin'), (T, smash, 'out'),
                 (1.85, settle, 'inout'), (2.4, REST, 'linear')])
    return seq, 2.4


def hit():
    T = 0.6
    jolt = P(REST, pelvis=(0.0, 0.25, 0.08), pitch=10.0, head=6.0, flapL=(8, 6, 2, 0, -2), flapR=(8, 6, 2, 0, -2),
             tailUp=(6, 4, 0, -2, -2, -2), lobe=-14)
    return keyed([(0.0, REST, 'out'), (0.12, jolt, 'out'), (0.3, P(jolt, pitch=4.0), 'inout'), (T, REST, 'linear')]), T


# ------------------------------------------------------------------ the cocoon
COCOON = P(pelvis=(0.0, 0.0, 0.3), pitch=6.0, head=4.0, flapL=(-74, -52, -50, -48, -44),
           flapR=(-82, -62, -60, -58, -50), twistL=(0, 1, 2, 2, 2), twistR=(0, 1, 2, 2, 2), sweepL=0.0, sweepR=0.0,
           tailUp=(2, 2, 2, 2, 0, 0), tailSide=(14, 20, 24, 26, 24, 20), lobe=-16, lobeUp=4, pearl=1.12)


def cocoon_p(t, period=3.0, k=1.0):
    ph = TAU * t / period
    b = 1.5 * k * (1 + math.sin(ph))
    p = add(COCOON, flapL=(b, b, b, b, b), flapR=(b, b, b, b, b))
    p = sway(p, ph, 4.0 * k, 1.0 * k)
    return add(p, pelvis=(0.0, 0.0, 0.05 * k * math.sin(ph)), roll=1.5 * k * math.sin(ph + 0.4),
               pearl=0.08 * math.sin(ph))


def shell_close():
    """It lifts its wings high, then sweeps them down and wraps them under
    its belly: a floating cocoon of nacre, the moon plates of its back facing
    out, the pearl glowing at its front."""
    T = 1.0
    flare = P(REST, pelvis=(0.0, 0.0, 0.3), pitch=4.0, flapL=(26, 20, 14, 10, 8), flapR=(26, 20, 14, 10, 8),
              lobe=-10, pearl=1.08)
    c0 = cocoon_p(0.0)
    # the tips roll under first, so the wing never hangs straight down
    roll = P(c0, pelvis=(0.0, 0.0, 0.5), flapL=(-6, -40, -48, -46, -42), flapR=(-6, -46, -56, -54, -48))
    return keyed([(0.0, REST, 'inout'), (0.3, flare, 'inout'), (0.55, roll, 'inout'), (0.85, c0, 'out'),
                  (T, c0, 'linear')]), T


def shell_open():
    """The cocoon bursts: the wings flung wide and up past their rest, a beat
    of light, then it settles back into its hover."""
    T = 1.0
    c0 = cocoon_p(0.0)
    burst = P(REST, pelvis=(0.0, 0.0, 0.18), pitch=-2.0, flapL=(14, 8, 2, -2, -6), flapR=(14, 8, 2, -2, -6),
              twistL=(-4, -6, -6, -4, -2), twistR=(-4, -6, -6, -4, -2), lobe=12, pearl=1.25)
    unroll = P(c0, pelvis=(0.0, 0.0, 0.5), flapL=(-6, -40, -48, -46, -42), flapR=(-6, -46, -56, -54, -48))
    return keyed([(0.0, c0, 'inout'), (0.16, unroll, 'out'), (0.36, burst, 'inout'), (T, REST, 'linear')]), T


def shell_walk_p(t, period=1.6):
    ph = TAU * t / period
    p = cocoon_p(t * 3.0 / period * 1.0, period=3.0, k=0.6)
    return add(p, pitch=-5.0 + 1.0 * math.sin(2 * ph), roll=2.5 * math.sin(ph), pelvis=(0.0, 0.0, 0.03 * math.sin(2 * ph)))


def shell_attack():
    """Shut, it rams: the cocoon draws back, lurches forward nose first, the
    wings cracking open a finger's width at its lower edge. CONTACT 0.4."""
    T = 1.0
    c0 = cocoon_p(0.0)
    draw = add(c0, pelvis=(0.0, 0.25, 0.04), pitch=6.0)
    ram = add(c0, pelvis=(0.0, -0.55, -0.08), pitch=-14.0, flapL=(6, 6, 4, 2, 0), flapR=(6, 6, 4, 2, 0))
    return keyed([(0.0, c0, 'inout'), (0.26, draw, 'in'), (0.4, ram, 'out'), (0.62, ram, 'inout'),
                  (T, c0, 'linear')]), T


def shell_hit():
    T = 0.5
    c0 = cocoon_p(0.0)
    jolt = add(c0, pelvis=(0.0, 0.2, 0.05), pitch=8.0, roll=-3.0)
    return keyed([(0.0, c0, 'out'), (0.12, jolt, 'out'), (T, c0, 'linear')]), T


# ------------------------------------------------------------------ death
def death():
    """A last flare of its wings, then it sinks slowly to the flags: the
    wings drooping, then lying draped over the floor, the tail laid out
    behind. The light in its wings goes out from the tips inward (1.0 to
    2.6), its eyes at 2.4, the heart pearl last (2.5 to 2.9). Still from 3.0."""
    T = 3.2
    flare = P(REST, pelvis=(0.0, 0.05, 0.2), pitch=14.0, head=8.0, flapL=(16, 12, 8, 4, 2), flapR=(16, 12, 8, 4, 2),
              tailUp=(6, 4, 2, 0, 0, 0), lobe=10)
    sink = P(REST, pelvis=(0.0, 0.0, -0.55), pitch=-4.0, head=-3.0, flapL=(-2, -3, -3, -3, -2),
             flapR=(-2, -3, -3, -3, -2), tailUp=(-4, -3, -2, 0, 0, 0), lobe=-6)
    down = P(REST, pelvis=(0.0, 0.05, -(A.Z0 - 0.45)), pitch=-1.0, head=-4.0, flapL=(-2, -2, -1, 0, 1),
             flapR=(-2, -2, -1, 0, 1), tailUp=(-10, 8, 2, 1, 0, 0), tailSide=(2, 4, 6, 6, 4, 2), lobe=-14,
             lobeUp=-6)
    seq = keyed([(0.0, REST, 'out'), (0.35, flare, 'inout'), (1.6, sink, 'inout'), (2.7, down, 'out'),
                 (T, down, 'hold')])

    def fn(t):
        p = dict(seq(t))
        p['glow'] = tuple(1.0 - smooth((t - (1.0 + 0.36 * (NW - 1 - i))) / 0.4) for i in range(NW))
        p['eye'] = 1.0 - smooth((t - 2.3) / 0.3)
        fade = smooth((t - 2.5) / 0.4)
        p['pearl'] = p['pearl'] * (1.0 - fade)
        p['dark'] = fade
        return p
    return fn, T


# ------------------------------------------------------------------ the catalogue
def _loop(pf, dur):
    return pf, dur


CATALOG = [
    ('Idle', lambda: (idle_p, IDLE_PERIOD), True),
    ('Walk', lambda: (walk_p, WALK_PERIOD), True),
    ('Run', lambda: (run_p, RUN_PERIOD), True),
    ('Attack', attack, False),
    ('Attack2', attack2, False),
    ('Cast', lambda: (cast_p, 2.4), True),
    ('Slam', slam, False),
    ('Hit', hit, False),
    ('ShellClose', shell_close, False),
    ('ShellIdle', lambda: (cocoon_p, 3.0), True),
    ('ShellWalk', lambda: (shell_walk_p, 1.6), True),
    ('ShellAttack', shell_attack, False),
    ('ShellHit', shell_hit, False),
    ('ShellOpen', shell_open, False),
    ('Death', death, False),
]


def make_clips(arm, only=None):
    import rig as R
    rig = R.Rig(arm)
    names = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        pf, dur = fn()
        M.STATEFUL_IK = False
        write_clip(arm, rig, name, lambda t, pf=pf: to_body(rig, pf(t)), dur, loop=loop, follow=False)
        names.append(name)
        print('CLIP', name, dur, flush=True)
    return names
