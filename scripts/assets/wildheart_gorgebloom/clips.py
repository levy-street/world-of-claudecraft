"""The Gorgebloom's clips, keyed from a whole-plant pose language.

`Body(**params)` turns a few readable numbers into a full pose: how the bulb
leans, twists and breathes (spread down Base, Bulb1, Bulb2 and the neck), how
the neck bends and the head nods, turns and rolls, how wide the maw gapes (the
lower half of the flower IS the jaw), how the five petals open, curl closed
over the maw, droop (the wilt) and ripple, how the pollen sacs swell, and how
each vine lifts, curls, swings and waves (spline-like: the bend is spread
smoothly down the chain, a travelling wave on top). A ground constraint keeps
every vine joint and petal tip above the water surface (z = 0), so a vine laid
down lies ON the pool and a slam ends flat on it.

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body (Catmull-Rom on
'auto' keys), so arcs stay arcs.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `lean` + leans forward; `lean_side` + leans to its left; `twist` + turns
left; `neck_bend` + bends the neck forward/down; `head_pitch` + nods down;
`jaw` + opens (degrees); `open` + flares the petals back; `curl` + curls the
petal tips closed over the maw; `droop` + wilts them down; `swell` the bulb's
scale; `sac` + swells the pollen sacs. Vines: (lift, curl, swing, bend, wave,
wlift): lift + raises the whole vine at the bulb, curl + curls it up along its
length, swing + carries it toward the FRONT, bend + curves it toward the front
along its length, wave a travelling sideways wave, wlift a travelling vertical
wave.

CONTRACT lines name the frames the game should read.
"""
import math

import numpy as np
from mathutils import Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
BODY_W = {'Base': 0.08, 'Bulb1': 0.3, 'Bulb2': 0.3, 'Neck1': 0.16, 'Neck2': 0.16}
VINE_NAMES = tuple(A.VINES)
PETAL_W_OPEN = (0.5, 0.3, 0.2)
PETAL_W_CURL = (0.15, 0.4, 0.45)
PETAL_W_DROOP = (0.45, 0.3, 0.25)


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def _petal_axes():
    out = []
    for th in A.PETAL_ANGLES:
        r, t = A.petal_frame(th)
        op = np.cross(A.FACE, r)
        op /= np.linalg.norm(op)
        pts = A.petal_points(th)
        d = pts[1] - pts[0]
        dr = np.cross(d, (0, 0, -1.0))
        dr = dr / max(1e-6, np.linalg.norm(dr))
        out.append((tuple(op), tuple(dr)))
    return out


PETAL_AXES = _petal_axes()


def _vine_axes():
    out = {}
    for name, bones in A.VINES.items():
        side = 1 if name.startswith('L_') else -1
        ax = []
        for b in bones:
            h, t = A.REST[b]
            d = t - h
            L = np.cross(d, (0, 0, 1.0))
            L /= np.linalg.norm(L)
            ax.append(tuple(L))       # + lifts the bone's tail up
        out[name] = (side, ax)
    return out


VINE_AXES = _vine_axes()
FLOORS = {}
for _name, _bones in A.VINES.items():
    _kind = 'BackVine' if 'Back' in _name else 'Vine'
    for _i, _b in enumerate(_bones):
        FLOORS[_b] = A.VINE_RAD[_kind][_i + 1] * 0.45
for _k in range(len(A.PETAL_ANGLES)):
    for _b in A.PETALS[_k]:
        FLOORS[_b] = 0.2


class Body:
    DEFAULTS = dict(
        root=(0.0, 0.0, 0.0), root_yaw=0.0,
        lean=0.0, lean_side=0.0, twist=0.0, swell=1.0,
        neck_bend=0.0, neck_yaw=0.0, neck_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0,
        open=0.0, curl=0.0, droop=0.0, pwave=0.0, pphase=0.0,
        sac=0.0, sac_wave=0.0, sac_phase=0.0,
        vphase=0.0,
        **{n: (0.0, 0.0, 0.0, 0.0, 0.0, 0.0) for n in VINE_NAMES},
    )

    def __init__(self, rig, **kw):
        self.rig = rig
        self.p = dict(self.DEFAULTS)
        for k, v in kw.items():
            if k not in self.p:
                raise KeyError(k)
            self.p[k] = v

    def but(self, **kw):
        b = Body(self.rig)
        b.p = dict(self.p)
        for k, v in kw.items():
            if k not in b.p:
                raise KeyError(k)
            b.p[k] = v
        return b

    def vine(self, name, **kw):
        """Change some of one vine's six numbers by name."""
        keys = ('lift', 'curl', 'swing', 'bend', 'wave', 'wlift')
        cur = list(self.p[name])
        for k, v in kw.items():
            cur[keys.index(k)] = v
        return self.but(**{name: tuple(cur)})

    def solve(self, memory=None):
        p = self.p
        turns = {'Root': [('z', p['root_yaw'])]}
        for b, w in BODY_W.items():
            turns[b] = [('x', p['lean'] * w), ('y', p['lean_side'] * w), ('z', p['twist'] * w)]
        turns['Neck1'] += [('x', p['neck_bend'] * 0.5), ('z', p['neck_yaw'] * 0.5), ('y', p['neck_roll'] * 0.5)]
        turns['Neck2'] += [('x', p['neck_bend'] * 0.5), ('z', p['neck_yaw'] * 0.5), ('y', p['neck_roll'] * 0.5)]
        turns['Head'] = [('x', p['head_pitch']), ('z', p['head_yaw']), (tuple(A.FACE), -p['head_roll'])]
        turns['Jaw'] = [('x', p['jaw'])]
        for k, bones in enumerate(A.PETALS):
            op, dr = PETAL_AXES[k]
            wave = p['pwave'] * math.sin(p['pphase'] + k * 1.3)
            for i, b in enumerate(bones):
                turns[b] = [(op, (p['open'] + wave) * PETAL_W_OPEN[i] - p['curl'] * PETAL_W_CURL[i]),
                            (dr, p['droop'] * PETAL_W_DROOP[i])]
        for name in VINE_NAMES:
            side, axes = VINE_AXES[name]
            lift, curl, swing, bend, wave, wlift = p[name]
            bones = A.VINES[name]
            n = len(bones)
            for i, b in enumerate(bones):
                k = i / (n - 1)
                tw = p['vphase'] - i * 0.85 + (0.0 if side > 0 else 1.7) + (0.9 if 'Back' in name else 0.0)
                lft = (lift if i == 0 else 0.0) + curl * (1.0 if i else 0.0) / max(1, n - 1) * 1.6 \
                    + wlift * math.sin(tw) * (0.3 + 0.7 * k)
                yw = (swing if i == 0 else 0.0) + bend * (1.0 if i else 0.0) / max(1, n - 1) * 1.6 \
                    + wave * math.sin(tw + 0.6) * (0.3 + 0.7 * k)
                turns[b] = [(axes[i], lft), ('z', -yw * side)]
        scale = {'BulbSwell': p['swell']}
        for j, s in enumerate(A.SACS):
            scale[s] = 1.0 + p['sac'] + p['sac_wave'] * math.sin(p['sac_phase'] + j * 1.9)
        root = V(p['root'])
        return self.rig.pose(turns=turns, root=tuple(root), scale=scale, floors=FLOORS)


# ------------------------------------------------------------------ interpolation
def lerp_body(b0, b1, u):
    out = b0.but()
    for k, a in b0.p.items():
        o = b1.p[k]
        if isinstance(a, (tuple, list, np.ndarray)):
            out.p[k] = tuple(float(x) + (float(y) - float(x)) * u for x, y in zip(a, o))
        else:
            out.p[k] = a + (o - a) * u
    return out


def cr_body(bs, u):
    u2, u3 = u * u, u * u * u
    w = (0.5 * (-u + 2 * u2 - u3), 0.5 * (2 - 5 * u2 + 3 * u3), 0.5 * (u + 4 * u2 - 3 * u3), 0.5 * (-u2 + u3))
    out = bs[1].but()
    for k in bs[1].p:
        vals = [b.p[k] for b in bs]
        if isinstance(vals[0], (tuple, list, np.ndarray)):
            acc = sum(wi * np.asarray(v, float) for wi, v in zip(w, vals))
            out.p[k] = tuple(acc.tolist())
        else:
            out.p[k] = float(sum(wi * v for wi, v in zip(w, vals)))
    return out


EASE_FN = {
    'in': lambda u: u ** 3,
    'quadin': lambda u: u * u,
    'out': lambda u: 1 - (1 - u) ** 3,
    'quadout': lambda u: 1 - (1 - u) ** 2,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
    'linear': lambda u: u,
}


def sample(seq, t, loop=False):
    n = len(seq)
    if t <= seq[0][0]:
        return seq[0][1]
    if t >= seq[-1][0]:
        return seq[-1][1]
    i = max(j for j in range(n - 1) if seq[j][0] <= t)
    t0, b0, ease = seq[i]
    t1, b1, _ = seq[i + 1]
    u = (t - t0) / max(1e-9, t1 - t0)
    if ease != 'auto':
        return lerp_body(b0, b1, EASE_FN[ease](u))
    if loop:
        bm = seq[i - 1][1] if i > 0 else seq[-2][1]
        bp = seq[i + 2][1] if i + 2 < n else seq[1][1]
    else:
        bm = seq[i - 1][1] if i > 0 else b0
        bp = seq[i + 2][1] if i + 2 < n else b1
    return cr_body([bm, b0, b1, bp], u)


def keys_of(seq, loop=False):
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out = []
    for f in range(nfr + 1):
        t = f / R.FPS
        out.append((t, sample(seq, t, loop).solve(), 'linear'))
    return out


# ------------------------------------------------------------------ stance
def stance(rig):
    """At rest in the pool: the maw a little open, the petals relaxed, the vines
    lying on the water with their tips raised."""
    vines = {n: (0.0, 6.0, 0.0, 0.0, 0.0, 0.0) for n in VINE_NAMES}
    return Body(rig, jaw=4.0, **vines)


def with_vines(b, **kw):
    """kw: field=value applied to every vine (e.g. lift=10)."""
    for n in VINE_NAMES:
        b = b.vine(n, **kw)
    return b


def idle(rig, period=4.0):
    """Two slow breaths (the bulb swells, the maw breathes open), the head scanning
    the terrace, the petals and vines swaying on a slow ripple, the sacs pulsing."""
    base = stance(rig)
    seq = []
    n = 16
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        br = math.sin(2 * w)
        b = base.but(swell=1.0 + 0.035 * br, lean=1.2 * math.sin(w), lean_side=1.0 * math.sin(w + 1.1),
                     twist=3.0 * math.sin(w + 0.4), neck_bend=-2 + 2.5 * math.sin(w + 0.8),
                     head_yaw=7 * math.sin(w + 0.2), head_pitch=2 * math.sin(2 * w + 0.6), head_roll=3 * math.sin(w),
                     jaw=5 + 5 * max(0.0, br), open=3 * br, pwave=4.0, pphase=w, sac=0.04, sac_wave=0.1,
                     sac_phase=2 * w, vphase=w)
        for nm in VINE_NAMES:
            b = b.vine(nm, lift=4 + 3 * math.sin(w + len(nm)), curl=8 + 5 * math.sin(w + 1.0), wave=7, wlift=5)
        seq.append((period * ph, b, 'auto'))
    return keys_of(seq, loop=True)


def turn(rig, period=1.6):
    """Turn (loop while its facing swings round to a new target): the head leads,
    the bulb follows with a lag, the roots stay, the vines drag across the water
    and the petals ripple with the motion."""
    base = stance(rig)
    seq = []
    n = 8
    for i in range(n + 1):
        ph = i / n
        w = TAU * ph
        b = base.but(twist=7 * math.sin(w), lean_side=3 * math.sin(w - 0.6), head_yaw=9 * math.sin(w + 0.7),
                     neck_yaw=5 * math.sin(w + 0.4), lean=1.5 * math.sin(2 * w), jaw=6, pwave=7, pphase=w,
                     swell=1.0 + 0.02 * math.sin(2 * w), sac_wave=0.08, sac_phase=w * 2, vphase=w * 1.5)
        for nm in VINE_NAMES:
            b = b.vine(nm, swing=10 * math.sin(w - 1.0), lift=6, curl=8, wave=10, wlift=4)
        seq.append((period * ph, b, 'auto'))
    return keys_of(seq, loop=True)


ATTACK_T = 0.5


def attack(rig):
    """Attack (the melee bite on the tank). CONTRACT: the maw snaps shut on the
    target at 0.50 s."""
    st = stance(rig)
    rear = st.but(lean=-4, neck_bend=-10, head_pitch=-12, jaw=28, open=10, swell=1.03)
    strike = st.but(lean=15, neck_bend=20, head_pitch=12, jaw=-4, open=-4, curl=14)
    hold = strike.but(jaw=0, curl=10, neck_bend=18)
    return keys_of([(0.0, st, 'auto'), (0.3, rear, 'in'), (ATTACK_T, strike, 'quadout'), (0.66, hold, 'auto'),
                    (1.2, st, 'auto')])


GORGE_T = 1.5


def gorge(rig):
    """Gorge (the 1.5 s bar on the tank, then the heavy bite). It rears back and
    gapes, the petals flaring wide, then throws its whole weight down onto the
    tank, the petals clamping over him, shakes him and swallows.
    CONTRACT: the bite lands at 1.50 s (the end of the bar)."""
    st = stance(rig)
    rear = st.but(lean=-6, neck_bend=-16, head_pitch=-18, jaw=30, open=16, swell=1.05, sac=0.08)
    gape = st.but(lean=-9, neck_bend=-24, head_pitch=-22, jaw=50, open=32, swell=1.09, sac=0.12, curl=-6)
    bite = st.but(lean=30, neck_bend=30, head_pitch=16, jaw=-6, open=-12, curl=34, swell=1.0)
    bite = with_vines(bite, lift=8, curl=14)
    shake1 = bite.but(head_yaw=12, head_roll=14, neck_yaw=6, jaw=-2)
    shake2 = bite.but(head_yaw=-12, head_roll=-14, neck_yaw=-6, jaw=-2)
    swallow = st.but(lean=6, neck_bend=14, head_pitch=6, jaw=2, curl=12, swell=1.1)
    return keys_of([(0.0, st, 'auto'), (0.6, rear, 'auto'), (1.25, gape, 'in'), (GORGE_T, bite, 'quadout'),
                    (1.72, shake1, 'auto'), (1.92, shake2, 'auto'), (2.2, swallow, 'auto'), (2.7, st, 'auto')])


SEED_T = 1.5


def seed_rain(rig):
    """Seed Rain (the 1.5 s bar, then six pods). The bulb swells and the petals
    curl shut over the clenched maw while the head tips back to aim high; at the
    end of the bar it heaves, the maw blows open and the petals snap wide.
    CONTRACT: the pods leave the maw at 1.50 s (MawAnchor; six projectiles)."""
    st = stance(rig)
    gather = st.but(swell=1.08, head_pitch=-8, jaw=-3, curl=18, sac=0.1, neck_bend=-4)
    load = st.but(swell=1.17, lean=-4, neck_bend=-12, head_pitch=-24, jaw=-5, curl=30, sac=0.16, twist=-3)
    pre = load.but(swell=1.2, head_pitch=-20, neck_bend=-8, twist=0)
    launch = st.but(swell=0.93, lean=-6, neck_bend=-16, head_pitch=-34, jaw=44, open=30, curl=-12, sac=0.0)
    launch = with_vines(launch, lift=10, wave=6)
    after = launch.but(jaw=34, open=22, swell=0.97, head_pitch=-26)
    rec = st.but(jaw=14, open=8, neck_bend=-4)
    return keys_of([(0.0, st, 'auto'), (0.5, gather, 'auto'), (1.1, load, 'auto'), (1.38, pre, 'in'),
                    (SEED_T, launch, 'quadout'), (1.64, after, 'auto'), (2.0, rec, 'auto'), (2.6, st, 'auto')])


POLLEN_T = 0.55


def pollinate(rig):
    """Pollinate: the four pollen sacs swell taut, then squeeze in a convulsive
    heave that blasts the pollen out; the petals shudder.
    CONTRACT: the pollen bursts from the sacs at 0.55 s (Sac_FL, Sac_FR, Sac_BL, Sac_BR)."""
    st = stance(rig)
    swell = st.but(sac=0.42, lean=-3, neck_bend=-6, head_pitch=-6, open=10, swell=1.06, jaw=10)
    burst = st.but(sac=-0.18, lean=4, neck_bend=8, head_pitch=8, open=22, swell=0.96, jaw=26, pwave=10, pphase=1.0,
                   head_roll=6)
    burst = with_vines(burst, lift=12, wave=8)
    shudder = burst.but(sac=0.06, head_roll=-6, pwave=10, pphase=3.0, lean=1)
    return keys_of([(0.0, st, 'auto'), (0.42, swell, 'in'), (POLLEN_T, burst, 'quadout'), (0.75, shudder, 'auto'),
                    (1.1, st.but(sac=0.02, pwave=5, pphase=5.0), 'auto'), (1.8, st, 'auto')])


LASH_T = 1.5


def vine_lash(rig):
    """Vine Lash (the 1.5 s bar along its locked facing, then the slam). The right
    front vine rears up over its shoulder, coils back, then whips over and slams
    flat along the lane in front of it.
    CONTRACT: the vine hits the ground at 1.50 s (the lane impact; tip = LashTip)."""
    st = stance(rig)
    nm = 'R_Vine'
    rise = st.but(twist=-4, lean_side=2, head_yaw=-6).vine(nm, lift=36, curl=6, swing=-6, bend=-14, wave=4)
    coil = st.but(twist=-9, lean_side=4, lean=-3, head_yaw=-4).vine(nm, lift=48, curl=10, swing=-14, bend=-24, wave=3)
    cocked = coil.but(twist=-11, lean=-4).vine(nm, lift=53, curl=12, swing=-17, bend=-27)
    slam = st.but(twist=8, lean=6, head_yaw=4, jaw=20).vine(nm, lift=-30, curl=-44, swing=78, bend=-26)
    drag = slam.but(twist=6, jaw=12).vine(nm, lift=-28, curl=-40, swing=74, bend=-24, wave=4)
    back = st.but(twist=2).vine(nm, lift=10, curl=10, swing=30, bend=-8)
    return keys_of([(0.0, st, 'auto'), (0.55, rise, 'auto'), (1.15, coil, 'auto'), (1.36, cocked, 'in'),
                    (LASH_T, slam, 'quadout'), (1.8, drag, 'auto'), (2.15, back, 'auto'), (2.6, st, 'auto')])


SPIT_T = 0.45


def bloom_spit(rig):
    """Bloom Spit (a glob spat at a far target). CONTRACT: the glob leaves the maw at
    0.45 s (MawAnchor)."""
    st = stance(rig)
    recoil = st.but(neck_bend=-12, head_pitch=-10, swell=1.06, jaw=-4, curl=12, lean=-3)
    spit = st.but(neck_bend=12, head_pitch=4, jaw=32, open=16, curl=-8, lean=4, swell=0.97)
    return keys_of([(0.0, st, 'auto'), (0.3, recoil, 'in'), (SPIT_T, spit, 'quadout'),
                    (0.62, spit.but(jaw=22), 'auto'), (1.3, st, 'auto')])


ROAR_T = 0.8


def roar(rig):
    """Roar: it draws in, then rears back with the petals flared fully open, the
    maw at its widest and the vines thrashing up off the water.
    CONTRACT: the roar peaks at 0.80 s (the shout ring), held with a shake to 1.6 s."""
    st = stance(rig)
    load = st.but(neck_bend=8, head_pitch=10, jaw=4, curl=20, swell=1.06, lean=3)
    peak = st.but(lean=-8, neck_bend=-22, head_pitch=-26, jaw=52, open=44, curl=-14, sac=0.25, swell=1.04)
    peak = with_vines(peak, lift=30, curl=16, wave=10, wlift=8)
    seq = [(0.0, st, 'auto'), (0.35, load, 'in'), (ROAR_T, peak, 'out')]
    for k, t in enumerate((1.0, 1.2, 1.4)):
        sg = 1 if k % 2 == 0 else -1
        seq.append((t, peak.but(head_roll=8 * sg, head_yaw=5 * sg, jaw=50 + 2 * sg, pwave=10, pphase=1.5 * (k + 1),
                                vphase=1.4 * (k + 1)), 'auto'))
    seq += [(1.6, peak.but(jaw=46), 'auto'), (2.0, st.but(jaw=12, open=6), 'auto'), (2.4, st, 'auto')]
    return keys_of(seq)


def hit(rig):
    st = stance(rig)
    flinch = st.but(lean=-5, lean_side=3, neck_bend=-9, head_pitch=-10, head_yaw=-6, jaw=22, open=12, curl=-4,
                    swell=0.97, pwave=8, pphase=1.0)
    back = st.but(lean=1, neck_bend=2, jaw=8, open=3, pwave=4, pphase=2.5)
    return keys_of([(0.0, st, 'auto'), (0.1, flinch, 'out'), (0.32, back, 'inout'), (0.7, st, 'auto')])


DEATH_SPLASH = 2.7


def death(rig):
    """Death: a last shriek, then it wilts: the petals droop and hang, the bulb
    deflates, the neck folds and the whole bloom collapses forward into the pool,
    sinking; the vines go limp on the water.
    CONTRACT: the head hits the water at 2.70 s (the splash), at rest from 3.4 s."""
    st = stance(rig)
    shriek = st.but(neck_bend=-20, head_pitch=-26, jaw=50, open=36, swell=1.05, lean=-5)
    shriek = with_vines(shriek, lift=24, curl=14, wave=10)
    shudder = shriek.but(head_roll=8, jaw=40, open=26, pwave=10, pphase=2.0)
    wilt = st.but(neck_bend=22, head_pitch=14, jaw=26, open=-6, droop=34, swell=0.93, lean=6, curl=-6)
    wilt = with_vines(wilt, lift=-14, curl=-4)
    sag = st.but(root=(0.0, -0.2, -0.6), neck_bend=52, head_pitch=30, jaw=22, droop=70, swell=0.86, lean=12,
                 curl=-10, sac=-0.25)
    sag = with_vines(sag, lift=-24, curl=-8)
    splash = sag.but(root=(0.0, -0.4, -1.45), neck_bend=64, head_pitch=34, droop=96, lean=22, swell=0.8, jaw=18,
                     sac=-0.35)
    bounce = splash.but(root=(0.0, -0.4, -1.3), lean=20, neck_bend=60)
    rest = splash.but(root=(0.0, -0.45, -1.6), lean=23, droop=100, swell=0.78, jaw=14)
    return keys_of([(0.0, st, 'auto'), (0.35, shriek, 'out'), (0.75, shudder, 'auto'), (1.5, wilt, 'inout'),
                    (2.25, sag, 'in'), (DEATH_SPLASH, splash, 'out'), (2.9, bounce, 'inout'), (3.4, rest, 'inout'),
                    (4.2, rest, 'linear')])


NO_SPRING = {
    'VineLash': ('R_Vine4',),
    'Death': tuple(f'Petal{k}_2' for k in range(len(A.PETAL_ANGLES))),
}

CATALOG = [
    ('Idle', idle, True),
    ('Turn', turn, True),
    ('Attack', attack, False),
    ('SeedRain', seed_rain, False),
    ('Pollinate', pollinate, False),
    ('VineLash', vine_lash, False),
    ('Gorge', gorge, False),
    ('BloomSpit', bloom_spit, False),
    ('Roar', roar, False),
    ('Hit', hit, False),
    ('Death', death, False),
]


def make_clips(arm, only=None):
    rig = R.Rig(arm)
    made = []
    for name, fn, loop in CATALOG:
        if only and name not in only:
            continue
        keys = fn(rig)
        act = R.make_clip(arm, name, keys)
        R.follow_through(arm, act, loop=loop, skip=NO_SPRING.get(name, ()))
        made.append(name)
    return made
