"""Every clip the Tidewisp ships.

Times in seconds (24 fps). It floats, rocking and breathing, its crescent
swaying and the motes circling; moving, it leans into its rush, its point
streaming back, the crescent turning (faster when it runs at its mark) and
the trail of drops falling behind. The sim's Tidewisp Burst fires when it
reaches its mark and it dies there: Death is the burst, a swell and then a
ring of frost and spray as the drop is gone (the same burst when it is killed
on the way).
"""
import math

import anatomy as A
import motion as M
from motion import Body, keyed, smooth, write_clip

TAU = math.tau
WALK_PERIOD, RUN_PERIOD = 1.6, 0.8
WALKREF, RUNREF = 2.5, 7.0


def look(lean=0.0, roll=0.0, moon=0.0, orbit=0.0, trail=0.0, wave=0.0, phase=0.0):
    out = {'Hips': [('x', lean), ('y', roll)],
           'Moon': [((0, 1, 0), moon)],
           'Orbit': [((0, 0, 1), orbit)]}
    for i in range(4):
        out[f'Trail{i + 1}'] = [('x', trail * (0.5 + 0.15 * i) + wave * math.sin(phase - i * 0.9)),
                                ('y', wave * 0.6 * math.cos(phase - i * 0.9))]
    return out


def base(rig):
    return Body(rig, pelvis=(0.0, 0.0, 0.0), scale=dict(A.HIDDEN))


def idle(rig, period=3.0):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        return st.but(pelvis=(0.0, 0.0, 0.08 * math.sin(u)),
                      extra=look(lean=4 * math.sin(u * 2), roll=5 * math.sin(u), moon=22 * math.sin(u),
                                 orbit=360.0 * t / period, trail=4, wave=10, phase=u),
                      scale={'Hips': 1.0 + 0.03 * math.sin(2 * u)})
    return fn


def rush(rig, period, run=False):
    st = base(rig)

    def fn(t):
        ph = (t / period) % 1.0
        u = TAU * ph
        return st.but(pelvis=(0.0, 0.0, 0.05 * math.sin(2 * u)),
                      extra=look(lean=(-26 if run else -14) + 3 * math.sin(2 * u), roll=4 * math.sin(u),
                                 moon=(720.0 if run else 360.0) * ph, orbit=(720.0 if run else 360.0) * ph,
                                 trail=-(30 if run else 16), wave=8, phase=u),
                      scale={'Hips': 1.0 + 0.02 * math.sin(2 * u)})
    return fn


def pulse(rig, dur=0.8):
    st = base(rig)
    a = st.but(extra=look(moon=0, orbit=0, trail=4), scale={'Hips': 1.0})
    b = st.but(pelvis=(0, 0, 0.12), extra=look(lean=-10, moon=60, orbit=120, trail=-12), scale={'Hips': 1.16})
    c = st.but(extra=look(moon=90, orbit=200, trail=4), scale={'Hips': 1.0})
    return keyed([(0.0, a, 'inout'), (0.3, b, 'out'), (dur, c, 'linear')]), dur


def hit(rig):
    st = base(rig)
    a = st.but(extra=look(trail=4), scale={'Hips': 1.0})
    b = st.but(pelvis=(0, 0.14, 0.04), extra=look(lean=14, roll=-8, moon=-40, trail=14), scale={'Hips': 0.9})
    c = st.but(extra=look(trail=4, moon=0, orbit=60), scale={'Hips': 1.0})
    return keyed([(0.0, a, 'out'), (0.12, b, 'out'), (0.5, c, 'linear')]), 0.5


def cast(rig, period=1.6):
    st = base(rig)

    def fn(t):
        u = TAU * t / period
        return st.but(extra=look(moon=360.0 * t / period, orbit=720.0 * t / period, trail=4, wave=8, phase=u),
                      scale={'Hips': 1.0 + 0.08 * (0.5 - 0.5 * math.cos(2 * u))})
    return fn


def death(rig):
    """The burst: it swells (0.15), then is gone in a ring of frost and a spray
    of drops flung out across 3 yards, which fade by 1.1."""
    st = base(rig)

    def fn(t):
        swell = smooth(t / 0.15)
        gone = smooth((t - 0.15) / 0.12)
        hips = (1.0 + 0.3 * swell) * (1.0 - gone)
        ring = smooth((t - 0.12) / 0.5) * 2.6 * (1.0 - smooth((t - 0.8) / 0.35))
        sc = {'Hips': max(hips, 0.0), 'Burst': ring}
        return st.but(extra=look(moon=200 * t, orbit=500 * t, trail=-10), scale=sc)
    return fn, 1.2


CATALOG = [
    ('Idle', lambda r: (idle(r), 3.0), True),
    ('Walk', lambda r: (rush(r, WALK_PERIOD), WALK_PERIOD), True),
    ('Run', lambda r: (rush(r, RUN_PERIOD, run=True), RUN_PERIOD), True),
    ('Attack', lambda r: pulse(r, 0.8), False),
    ('Attack2', lambda r: pulse(r, 0.7), False),
    ('Cast', lambda r: (cast(r), 1.6), True),
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
