"""The Sunbone totems' clips. A totem never walks: it rises out of the ground
where it is planted, stands creaking, flares (the Sunbone Totem's mending pulse)
or rattles (the Dread Totem's fear), shudders when struck and topples to pieces.

`Pose(**params)`: `sink` (yards the whole totem stands below its mark: the
rise), `lean` and `side` (degrees the post leans forward / to its left),
`twist` (the post turning on its base), `crown` (the crown's nod, + down),
`crown_roll`, `jaw` (degrees open), `charm` (the chains' swing), `flare` (the
crown's scale: it swells on a pulse).

CONTRACT lines name the frames the game reads.
"""
import math

from mathutils import Vector

import anatomy as A
import rig as R

TAU = math.tau
LEAD = 1.0 / R.FPS


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


class Pose(dict):
    DEFAULTS = dict(sink=0.0, lean=0.0, side=0.0, twist=0.0, crown=0.0, crown_roll=0.0, jaw=0.0, charm=0.0,
                    charm_side=0.0, flare=1.0)

    def __init__(self, **kw):
        super().__init__(self.DEFAULTS)
        for k, v in kw.items():
            if k not in self.DEFAULTS:
                raise KeyError(k)
            self[k] = v

    def but(self, **kw):
        p = Pose(**self)
        for k, v in kw.items():
            if k not in self.DEFAULTS:
                raise KeyError(k)
            p[k] = v
        return p

    def solve(self, rig):
        turns = {
            'Post': [('x', self['lean']), ('y', -self['side']), ('z', self['twist'])],
            'Crown': [('x', self['crown']), ('y', self['crown_roll'])],
            'Jaw': [('x', self['jaw'])],
            'L_Charm1': [('x', self['charm']), ('y', self['charm_side'])],
            'R_Charm1': [('x', self['charm']), ('y', -self['charm_side'])],
            'L_Charm2': [('x', self['charm'] * 0.6)],
            'R_Charm2': [('x', self['charm'] * 0.6)],
        }
        return rig.pose(turns=turns, root=(0.0, 0.0, -self['sink']), mirror=False, scale={'Crown': self['flare']})


def lerp_pose(a, b, u):
    return Pose(**{k: a[k] + (b[k] - a[k]) * u for k in a})


EASE = {
    'in': lambda u: u ** 3,
    'out': lambda u: 1 - (1 - u) ** 3,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'linear': lambda u: u,
    'backout': lambda u: 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2,
}


def keys_of(rig, seq, loop=False):
    """seq: [(t, Pose, ease)]: sampled every frame, eased per segment."""
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out = []
    for f in range(nfr + 1):
        t = f / R.FPS
        i = max([j for j in range(len(seq) - 1) if seq[j][0] <= t] or [0])
        t0, p0, ease = seq[i]
        t1, p1, _ = seq[min(i + 1, len(seq) - 1)]
        u = 0.0 if t1 <= t0 else min(1.0, max(0.0, (t - t0) / (t1 - t0)))
        out.append((t, lerp_pose(p0, p1, EASE.get(ease, EASE['inout'])(u)).solve(rig), 'linear'))
    return out


REST = Pose()


def idle(rig, period=4.0):
    """It creaks: the post settles a hair, the crown nods, the charms sway in the
    jungle air; the dread skull's jaw works now and then."""
    seq = []
    n = 16
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        clack = math.exp(-((ph - 0.6) / 0.04) ** 2) if A.DREAD else 0.0
        seq.append((period * ph, Pose(lean=0.6 * math.sin(w), side=0.5 * math.sin(w + 1.3),
                                      crown=1.5 * math.sin(w + 0.6), crown_roll=1.2 * math.sin(w + 2.0),
                                      jaw=3 + 12 * clack, charm=8 * math.sin(w + 0.4),
                                      charm_side=6 * math.sin(w * 2 + 1.0)), 'inout'))
    return keys_of(rig, seq, loop=True)


RISE_UP = 0.62


def rise(rig):
    """Rise (its entrance: the Binder has just driven it into the ground): it
    bursts up out of the earth with a jolt, overshoots, and settles, the charms
    flung up and dropping. CONTRACT: up out of the ground at 0.62 s, still by
    1.4 s."""
    under = Pose(sink=6.6, lean=-6, crown=-10, charm=-40)
    seq = [(0.0, under, 'in'), (0.12, under.but(sink=6.2), 'out'), (RISE_UP, Pose(sink=-0.25, lean=4, crown=8,
                                                                                   charm=-60, flare=1.06), 'out'),
           (0.82, Pose(sink=0.05, lean=-2, crown=-5, charm=35), 'inout'),
           (1.05, Pose(lean=1, crown=3, charm=-18), 'inout'), (1.4, Pose(charm=4), 'inout')]
    return keys_of(rig, seq)


PULSE_T = 0.3


def pulse(rig):
    """Pulse (the Sunbone Totem's mending, every 2 s): the crown swells and lifts,
    the post shudders, the charms jump. CONTRACT: the flare peaks at 0.30 s."""
    seq = [(0.0, REST, 'out'), (PULSE_T, Pose(flare=1.12, crown=-6, lean=-1.5, charm=-22, jaw=10), 'inout'),
           (0.55, Pose(flare=0.98, crown=2, lean=0.8, charm=14, jaw=2), 'inout'), (0.9, REST, 'inout')]
    return keys_of(rig, seq)


RATTLE_END = 2.0


def rattle(rig):
    """Rattle (the Dread Totem's Rattling Dread, a 2 s bar: played over the bar):
    the post trembles harder and harder, the skull's jaw chatters, the rattles
    thrash; on the bar's end the skull throws its jaws wide and the whole totem
    jolts back (the fear bursts out). CONTRACT: the scream at 2.00 s."""
    seq = []
    n = 24
    for i in range(n + 1):
        t = 1.8 * i / n
        k = 0.25 + 0.75 * (t / 1.8)
        sg = 1 if i % 2 == 0 else -1
        seq.append((t, Pose(side=2.5 * k * sg, twist=1.5 * k * sg, crown=-3 * k, crown_roll=6 * k * sg,
                            jaw=(26 if i % 2 == 0 else 4) * (0.5 + 0.5 * k), charm=28 * k * sg,
                            charm_side=20 * k * -sg, flare=1.0 + 0.04 * k), 'linear'))
    seq += [(RATTLE_END, Pose(lean=-5, crown=-14, jaw=46, charm=-50, flare=1.1), 'out'),
            (2.35, Pose(lean=2, crown=4, jaw=20, charm=30), 'inout'), (2.8, Pose(jaw=4), 'inout')]
    return keys_of(rig, seq)


def hit(rig):
    seq = [(0.0, REST, 'out'), (0.08, Pose(lean=-3, side=2, crown=6, charm=-25, jaw=10), 'out'),
           (0.3, Pose(lean=1.5, side=-1, crown=-3, charm=15), 'inout'), (0.6, REST, 'inout')]
    return keys_of(rig, seq)


def death(rig):
    """Death (it crumbles with its Binder, or when broken): the crown cracks and
    lolls, the post sags, topples forward to its left and sinks into the earth.
    CONTRACT: down at 1.0 s, under the ground by 2.2 s."""
    seq = [(0.0, REST, 'out'), (0.18, Pose(crown=14, crown_roll=10, jaw=30, side=3, charm=-30), 'inout'),
           (0.45, Pose(lean=10, side=8, crown=22, crown_roll=16, jaw=34, charm=20), 'in'),
           (1.0, Pose(lean=68, side=22, crown=30, crown_roll=20, jaw=40, charm=70, sink=0.3), 'out'),
           (1.15, Pose(lean=64, side=20, crown=26, crown_roll=18, jaw=36, charm=50, sink=0.4), 'inout'),
           (1.5, Pose(lean=66, side=21, crown=28, jaw=38, charm=60, sink=0.6), 'in'),
           (2.2, Pose(lean=70, side=22, crown=30, jaw=38, charm=60, sink=2.6, flare=0.9), 'linear')]
    return keys_of(rig, seq)


CATALOG = [('Idle', idle, True), ('Rise', rise, False), ('Hit', hit, False), ('Death', death, False)]
CATALOG += [('Pulse', pulse, False)] if not A.DREAD else [('Rattle', rattle, False)]


def make_clips(arm, only=None):
    rig = R.Rig(arm)
    made = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        act = R.make_clip(arm, name, fn(rig))
        R.follow_through(arm, act, loop=loop)
        made.append(name)
    return made


_ = Vector
