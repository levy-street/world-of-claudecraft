"""The Snarlvine Lasher's clips (and the Thorn Sprout's), keyed from a whole-body
treant pose language with creaking plant weight.

`Body(**params)` turns readable numbers into a full pose: where the body sits and
how it pitches, rolls and turns (about the hips), how the spine LEANS (+ hunches
forward) and twists, where the neck and the face look, how wide the maw opens,
where each root foot stands (two-bone IK onto the ankle, the foot and the
root-claws aimed), where each wrist reaches (two-bone IK, given as an offset from
the shoulder in CHEST space so the arms ride the body), and the shape of each
whip-vine: a heading on the ground plane and an elevation for its first bone,
a curl added bone by bone, a 3D writhing wave travelling down it, an extension
(the vine grows: every bone scaled), and an UNROLL toward a lane direction that
straightens the whip from the wrist to the tip (the lash). The vine never goes
through the floor: the solver walks it from the wrist and flattens any bone that
would dig in, so a resting vine lies on the ground and curls up at its end.

Every clip is a list of keys in SECONDS with the easing of the segment leaving
each key; every frame is solved from the interpolated Body.

Axes: armature space, yards, +Z up, it faces -Y, its left is +X.
Signs: `pitch` + leans the whole body back (face up); `lean` + hunches the spine
forward; `yaw` + turns to its left; `roll` + leans onto its left; `head_pitch` +
lifts the face; `jaw` + opens; vine `h` (heading, deg) 0 is straight ahead,
+ swings OUT to its own side (mirrored for the right vine), 180 is behind; vine
`e` (elevation, deg) -90 straight down, 0 level, + up.

CONTRACT lines name the frames the game should read.
"""
import math

import numpy as np
from mathutils import Quaternion, Vector

import anatomy as A
import rig as R

V = Vector
TAU = math.tau
FL0 = np.array(A.FOOT_T)            # the left root foot's ball, planted
FOOT_DIR = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
TOE_DIR = A.REST['L_Toes'][1] - A.REST['L_Toes'][0]
L_FOOT = float(np.linalg.norm(FOOT_DIR))
SH_TO_WR = A.WRIST - A.SHOULDER     # the rest wrist offset from the shoulder
VINE_LEN = [float(np.linalg.norm(A.VINE_PTS[i + 1] - A.VINE_PTS[i])) for i in range(A.NVINE)]
JAW_GAIN = 1.0
SPINE_W = (0.3, 0.35, 0.35)
FLOOR = 0.1
MAX_BEND = 80.0
NV = A.NVINE


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def rot_x(v, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def body_matrix(yaw, pitch, roll):
    q = Quaternion((0, 0, 1), math.radians(yaw))
    q = Quaternion((1, 0, 0), math.radians(-pitch)) @ q
    q = Quaternion((0, 1, 0), math.radians(roll)) @ q
    return q


def fdir(deg):
    d = rot_x(FOOT_DIR, deg)
    return d / np.linalg.norm(d)


def tdir(deg):
    d = rot_x(TOE_DIR, deg)
    return d / np.linalg.norm(d)


def dir_from(h, e, s):
    hr, er = math.radians(h), math.radians(e)
    return np.array((s * math.sin(hr) * math.cos(er), -math.cos(hr) * math.cos(er), math.sin(er)))


VINE_KEYS = ('h', 'e', 'curl', 'ycurl', 'wave', 'ph', 'ext', 'lh', 'le', 'un', 'stiff')


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0), pivot=(0.0, 0.1, 2.6),
        yaw=0.0, pitch=0.0, roll=0.0, hip_yaw=0.0, hip_roll=0.0,
        lean=0.0, spine_yaw=0.0, spine_roll=0.0,
        neck_pitch=0.0, neck_yaw=0.0, head_pitch=0.0, head_yaw=0.0, head_roll=0.0, jaw=0.0,
        shrug_l=0.0, shrug_r=0.0, root_s=1.0, body_s=1.0,
        lf=tuple(FL0), rf=tuple(A.mirror(FL0)), fd_l=0.0, fd_r=0.0, td_l=0.0, td_r=0.0,
        pole_k=(0.3, -1.0, 0.0),
        wl=tuple(SH_TO_WR), wr=tuple(A.mirror(SH_TO_WR)), pole_a=(0.55, 1.0, -0.1),
    )
    for side in ('l', 'r'):
        DEFAULTS.update({f'v{side}_h': 8.0, f'v{side}_e': -78.0, f'v{side}_curl': 24.0, f'v{side}_ycurl': 0.0,
                         f'v{side}_wave': 0.0, f'v{side}_ph': 0.0, f'v{side}_ext': 1.0, f'v{side}_lh': 0.0,
                         f'v{side}_le': 0.0, f'v{side}_un': 0.0, f'v{side}_stiff': 0.0})

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

    def vine(self, side, **kw):
        """Set vine params of one side: b.vine('r', h=0, e=-5, ...)."""
        return self.but(**{f'v{side}_{k}': v for k, v in kw.items()})

    def root(self):
        p = self.p
        q = body_matrix(p['yaw'], p['pitch'], p['roll'])
        piv = V(p['pivot'])
        return V(p['pelvis']) + piv - q @ piv, q

    # -------------------------------------------------------------- vines
    def vine_dirs(self, side, wrist, prev_dir=None):
        p = self.p
        s = 1 if side == 'l' else -1
        g = lambda k: p[f'v{side}_{k}']  # noqa: E731
        h, e = g('h'), g('e')
        un = g('un')
        ext = g('ext')
        dirs = []
        pos = np.asarray(wrist, float)
        cum = 1.0
        for i in range(NV):
            k = i / (NV - 1)
            amp = g('wave') * (0.25 + 0.75 * k) * (1.0 - g('stiff'))
            ww = amp * math.sin(g('ph') - i * 0.95)
            wv = amp * 0.6 * math.cos(g('ph') * 1.3 - i * 0.8)
            w = smooth(un * (NV + 1.5) - i)
            # the unroll blends ANGLES, so a coil held behind and above (elevation
            # past 90) swings over the top into the lane instead of flipping
            d = dir_from((h + ww) * (1 - w) + g('lh') * w, (e + wv) * (1 - w) + g('le') * w, s)
            cum *= ext
            ln = VINE_LEN[i] * cum
            # never through the floor: flatten the bone onto it
            zmin = FLOOR + 0.04 * (1 - k)
            if pos[2] + d[2] * ln < zmin:
                hz = math.sqrt(max(1e-6, d[0] ** 2 + d[1] ** 2))
                want = max(-1.0, min(1.0, (zmin - pos[2]) / ln))
                horiz = math.sqrt(max(0.0, 1 - want * want))
                d = np.array((d[0] / hz * horiz, d[1] / hz * horiz, want))
            if prev_dir is not None:
                # a vine joint bends so far and no further: turn from where the
                # parent points toward the shape by at most MAX_BEND
                pv = np.asarray(prev_dir, float)
                ang = math.acos(max(-1.0, min(1.0, float(pv @ d))))
                lim = math.radians(MAX_BEND)
                if ang > lim:
                    ax = np.cross(pv, d)
                    if np.linalg.norm(ax) < 1e-4:
                        ax = np.cross(pv, (0, 0, 1.0))
                        if np.linalg.norm(ax) < 1e-4:
                            ax = np.array((1.0, 0, 0))
                    ax /= np.linalg.norm(ax)
                    d = np.array(Quaternion(V(tuple(ax)), lim) @ V(tuple(pv)))
                    if pos[2] + d[2] * ln < zmin:
                        d[2] = max(d[2], (zmin - pos[2]) / ln)
                    d /= np.linalg.norm(d)
            prev_dir = d
            dirs.append(d)
            pos = pos + d * ln
            e += g('curl')
            h += g('ycurl')
        return dirs

    # -------------------------------------------------------------- solve
    def _solve_once(self, memory, vine_aims, arm_targets):
        p = self.p
        turns, aims, ik, scale = {}, {}, {}, {}
        turns['Root'] = [('z', p['yaw']), ('x', -p['pitch']), ('y', p['roll'])]
        turns['Hips'] = [('z', p['hip_yaw']), ('y', p['hip_roll'])]
        for b, w in zip(('Spine1', 'Spine2', 'Chest'), SPINE_W):
            turns[b] = [('x', p['lean'] * w), ('z', p['spine_yaw'] * w), ('y', p['spine_roll'] * w)]
        turns['Neck'] = [('x', -p['neck_pitch']), ('z', p['neck_yaw'])]
        turns['Head'] = [('x', -p['head_pitch']), ('z', p['head_yaw']), ('y', p['head_roll'])]
        turns['Jaw'] = [('x', JAW_GAIN * p['jaw'])]
        turns['L_Shoulder'] = [('y', -p['shrug_l'])]
        turns['R_Shoulder'] = [('y', p['shrug_r'])]
        for side, s, kf in (('L_', 1, 'l'), ('R_', -1, 'r')):
            pk = (p['pole_k'][0] * s, p['pole_k'][1], p['pole_k'][2])
            fd = fdir(p['fd_' + kf])
            ankle = np.asarray(p[kf + 'f']) - fd * L_FOOT
            ik['h' + side] = (side + 'Thigh', side + 'Shin', tuple(ankle), pk)
            aims[side + 'Foot'] = V(tuple(fd))
            aims[side + 'Toes'] = V(tuple(tdir(p['td_' + kf])))
            if arm_targets is not None:
                pa = (p['pole_a'][0] * s, p['pole_a'][1], p['pole_a'][2])
                ik['a' + side] = (side + 'UpperArm', side + 'Forearm', tuple(arm_targets[kf]), pa)
            if vine_aims is not None:
                for i, d in enumerate(vine_aims[kf]):
                    aims[f'{side}Vine{i + 1}'] = V(tuple(d))
            ext = p[f'v{kf}_ext']
            if abs(ext - 1.0) > 1e-4:
                for i in range(NV):
                    scale[f'{side}Vine{i + 1}'] = ext
        if abs(p['root_s'] - 1.0) > 1e-4:
            scale['Root'] = p['root_s']
        if abs(p['body_s'] - 1.0) > 1e-4:
            for b in ('Spine1', 'Spine2'):
                scale[b] = p['body_s']
        root, _ = self.root()
        return self.rig.pose(aims=aims, ik=ik, turns=turns, root=tuple(root), mirror=False, memory=memory,
                             scale=scale)

    def solve(self, memory=None):
        p = self.p
        first = self._solve_once(dict(memory) if memory is not None else None, None, None)
        dq = first.delta['Chest']
        targets = {}
        for kf, side in (('l', 'L_'), ('r', 'R_')):
            sh = first.head[side + 'UpperArm']
            targets[kf] = np.array(sh + dq @ V(p['w' + kf]))
            targets[kf][2] = max(targets[kf][2], 0.35)
        second = self._solve_once(dict(memory) if memory is not None else None, None, targets)
        vines = {}
        for kf, side in (('l', 'L_'), ('r', 'R_')):
            wr = second.head[side + 'Vine1']
            fa = A.REST[side + 'Forearm']
            fdir_w = second.delta[side + 'Forearm'] @ V(tuple((fa[1] - fa[0]) / np.linalg.norm(fa[1] - fa[0])))
            vines[kf] = self.vine_dirs(kf, np.array(wr), np.array(fdir_w))
        return self._solve_once(memory, vines, targets)


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
    'hold': lambda u: 0.0,
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


def keys_of(seq, loop=False, post=None):
    end = seq[-1][0]
    nfr = int(round(end * R.FPS))
    out, memory = [], {}
    if loop:
        for f in range(nfr + 1):
            sample(seq, f / R.FPS, loop).solve(memory)
    for f in range(nfr + 1):
        t = f / R.FPS
        b = sample(seq, t, loop)
        if post:
            b = post(b, t)
        pose = b.solve(memory)
        out.append((t, pose, 'linear'))
    return out


def writhe(b, t, amp=10.0, speed=1.0, seed=0.0):
    """The vines never lie still: a slow 3D wave down both arms, offset per side."""
    return b.but(vl_ph=b.p['vl_ph'] + TAU * speed * t + seed, vr_ph=b.p['vr_ph'] + TAU * speed * t + 2.1 + seed,
                 vl_wave=max(b.p['vl_wave'], amp), vr_wave=max(b.p['vr_wave'], amp))


# ------------------------------------------------------------------ stance and gaits
def stance(rig):
    """The hunched guard: knees bent, the spine hunched forward, the face up and
    glaring, the arms hanging forward, the vines lying on the ground ahead."""
    return Body(rig, pelvis=(0, 0, -0.14), lean=16.0, neck_pitch=-4.0, head_pitch=14.0,
                wl=(0.38, -0.55, -2.05), wr=(-0.38, -0.55, -2.05), vl_h=14, vr_h=14, vl_e=-76, vr_e=-76,
                vl_curl=15, vr_curl=15, vl_ycurl=-3, vr_ycurl=-3, shrug_l=4, shrug_r=4)


def idle(rig, period=4.0):
    """Idle (loop 4.0 s): two slow creaking breaths, the hump swelling, the face
    turning to glare, the vines writhing on the ground and lifting their tips."""
    base = stance(rig)
    seq = []
    n = int(round(period * R.FPS))
    for i in range(n + 1):
        t = i / R.FPS
        w = TAU * t / period
        b = base.but(pelvis=(0, 0.02 * math.sin(w), -0.14 + 0.03 * math.sin(2 * w)),
                     lean=16 + 2.5 * math.sin(2 * w), shrug_l=4 + 3 * math.sin(2 * w), shrug_r=4 + 3 * math.sin(2 * w + 0.3),
                     head_yaw=9 * math.sin(w), head_roll=-4 * math.sin(w + 0.4), head_pitch=14 + 3 * math.sin(2 * w + 1),
                     neck_yaw=5 * math.sin(w - 0.3), jaw=4 + 3 * math.sin(2 * w),
                     spine_yaw=3 * math.sin(w), roll=1.2 * math.sin(w),
                     wl=(0.38 + 0.05 * math.sin(w), -0.55 - 0.08 * math.sin(w + 1), -2.05 + 0.05 * math.sin(2 * w)),
                     wr=(-0.38 - 0.05 * math.sin(w + 2), -0.55 - 0.08 * math.sin(w + 3), -2.05 + 0.05 * math.sin(2 * w + 1)),
                     vl_h=14 + 8 * math.sin(w), vr_h=14 + 8 * math.sin(w + 2), vl_curl=15 + 4 * math.sin(2 * w),
                     vr_curl=15 + 4 * math.sin(2 * w + 1.5))
        b = b.but(vl_wave=14, vr_wave=14, vl_ph=w * 2, vr_ph=w * 2 + 2.1)
        seq.append((t, b, 'linear'))
    return keys_of(seq, loop=True)


def gait_foot(phase, stance_frac, half, lift, rest):
    rest = np.asarray(rest, float)
    if phase < stance_frac:
        u = phase / stance_frac
        y = rest[1] - half + 2 * half * u
        z = rest[2]
        heel = smooth((u - 0.65) / 0.35)
        fd = 25 * heel
        td = -15 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = rest[1] + half - 2 * half * e
        z = rest[2] + lift * math.sin(math.pi * u) ** 0.8
        fd = 30 * math.sin(math.pi * min(1.0, u * 1.3)) - 12 * smooth((u - 0.7) / 0.3)
        td = 20 * math.sin(math.pi * u)
    return (rest[0], y, z), fd, td


def gait(rig, period, speed, stance_frac, lift, base, lurch=0.2, roll=5.0, bob=0.12, swing=0.45, run=False):
    half = speed * stance_frac * period / 2
    nfr = int(round(period * R.FPS))
    seq = []
    for i in range(nfr + 1):
        ph = (i / nfr) % 1.0
        w = TAU * ph
        kw = {}
        for key, rest, off in (('l', FL0, 0.0), ('r', A.mirror(FL0), 0.5)):
            f, fd, td = gait_foot((ph - off) % 1.0, stance_frac, half, lift, rest)
            kw[key + 'f'] = f
            kw['fd_' + key] = fd
            kw['td_' + key] = td
        p0 = base.p
        # the weight lurches over the planted foot; the body drops at each heavy footfall
        lx = lurch * math.cos(w)
        drop = -bob * (0.5 + 0.5 * math.cos(2 * w)) ** 2
        sw = math.sin(w)
        b = base.but(pelvis=(lx, p0['pelvis'][1], p0['pelvis'][2] + drop), roll=-roll * math.cos(w),
                     spine_roll=roll * 0.8 * math.cos(w), yaw=4 * sw, spine_yaw=-7 * sw, hip_yaw=-3 * sw,
                     head_yaw=-3 * sw, head_roll=2 * math.cos(w), lean=p0['lean'] + 3 * (0.5 + 0.5 * math.cos(2 * w)),
                     shrug_l=p0['shrug_l'] + 4 * sw, shrug_r=p0['shrug_r'] - 4 * sw,
                     wl=(p0['wl'][0], p0['wl'][1] + swing * sw, p0['wl'][2] + 0.1 * abs(sw)),
                     wr=(p0['wr'][0], p0['wr'][1] - swing * sw, p0['wr'][2] + 0.1 * abs(sw)),
                     vl_ph=w * (2 if run else 1), vr_ph=w * (2 if run else 1) + 2.0,
                     vl_h=p0['vl_h'] + 10 * sw, vr_h=p0['vr_h'] - 10 * sw, **kw)
        seq.append((i / R.FPS, b, 'linear'))
    return keys_of(seq)


WALK_PERIOD, WALK_SPEED, WALK_STANCE = 1.9, 2.0, 0.62
RUN_PERIOD, RUN_SPEED, RUN_STANCE = 0.96, 5.5, 0.42


def walk(rig):
    """Walk (loop 1.9 s, walkRef 2.0 yd/s): a rooted, lurching stride. Each foot
    is torn up and planted heavily, the weight rolls over it, the vines drag and
    sway behind the arms. CONTRACT: footfalls left 0.00, right 0.95."""
    base = stance(rig).but(lean=20, vl_wave=12, vr_wave=12, vl_h=24, vr_h=24, vl_e=-72, vr_e=-72, vl_curl=16,
                           vr_curl=16, vl_ycurl=6, vr_ycurl=6)
    return gait(rig, WALK_PERIOD, WALK_SPEED, WALK_STANCE, 0.5, base, lurch=0.22, roll=5.5, bob=0.14, swing=0.4)


def run(rig):
    """Run (loop 0.96 s, runRef 5.5 yd/s): a lumbering charge, hunched low, the
    arms pumping, the vines whipping behind. CONTRACT: footfalls left 0.00, right
    0.48."""
    base = stance(rig).but(lean=30, pelvis=(0, 0, -0.3), head_pitch=26, pitch=-4,
                           wl=(0.45, -0.3, -1.7), wr=(-0.45, -0.3, -1.7), vl_wave=20, vr_wave=20,
                           vl_h=150, vr_h=150, vl_e=-55, vr_e=-55, vl_curl=8, vr_curl=8, vl_ycurl=-4, vr_ycurl=-4)
    return gait(rig, RUN_PERIOD, RUN_SPEED, RUN_STANCE, 0.7, base, lurch=0.15, roll=4, bob=0.2, swing=0.7, run=True)


def _clip(rig, keys, writhe_amp=8.0, writhe_speed=0.6):
    """keys: [(t, Body, ease)] -> per-frame keys with a gentle writhe on top."""
    seq = list(keys)
    return keys_of(seq, post=lambda b, t: b.but(vl_ph=b.p['vl_ph'] + TAU * writhe_speed * t,
                                                 vr_ph=b.p['vr_ph'] + TAU * writhe_speed * t + 2.1,
                                                 vl_wave=max(b.p['vl_wave'], writhe_amp * (1 - b.p['vl_stiff'])),
                                                 vr_wave=max(b.p['vr_wave'], writhe_amp * (1 - b.p['vr_stiff']))))


def attack(rig):
    """Attack (1.4 s): the vine swipe. The right arm draws out wide to its right
    and back, the whip held out low; then the body wrenches round and the vine
    sweeps across the front from its right to its left. CONTRACT: the vine
    crosses the middle of the front cone at 0.55 s (hit)."""
    s0 = stance(rig)
    wind = s0.but(yaw=-22, spine_yaw=-18, lean=12, head_yaw=10, shrug_r=18, wr=(-1.35, 0.55, -0.9),
                  pole_a=(0.55, 1.0, 0.4)).vine('r', h=110, e=-12, curl=4, ycurl=-2, stiff=0.6)
    sweep = s0.but(yaw=8, spine_yaw=12, lean=22, head_yaw=-6, shrug_r=10, wr=(-0.4, -1.75, -1.2),
                   jaw=18).vine('r', h=8, e=-14, curl=3, ycurl=-14, stiff=0.7, ext=1.04)
    thru = s0.but(yaw=22, spine_yaw=22, lean=24, head_yaw=-12, wr=(0.75, -1.1, -1.5), jaw=8).vine(
        'r', h=-85, e=-30, curl=10, ycurl=-12, stiff=0.4)
    return _clip(rig, [(0.0, s0, 'auto'), (0.42, wind, 'in'), (0.55, sweep, 'out'), (0.72, thru, 'auto'),
                       (1.05, s0.but(lean=18), 'auto'), (1.4, s0, 'auto')])


def attack2(rig):
    """Attack2 (1.3 s): the thorn stab. The left vine coils tight beside the
    face, the body coils back, then it drives the thorned tip straight into the
    target. CONTRACT: the stab lands at 0.50 s."""
    s0 = stance(rig)
    coil = s0.but(yaw=-14, pitch=4, lean=8, shrug_l=16, wl=(0.25, -0.2, -0.75), head_pitch=20, jaw=14,
                  pole_a=(0.9, 0.7, 0.0)).vine('l', h=30, e=140, curl=-40, ycurl=8, stiff=0.7)
    stab = s0.but(yaw=10, pitch=-6, lean=30, shrug_l=6, wl=(-0.25, -2.25, -0.7), head_pitch=8, jaw=4,
                  pelvis=(0, -0.2, -0.22)).vine('l', h=-6, e=-14, curl=2, lh=-8, le=-14, un=1.0, stiff=1.0, ext=1.07)
    hold = stab.but(lean=27, wl=(-0.2, -2.1, -0.8)).vine('l', un=1.0, ext=1.05)
    return _clip(rig, [(0.0, s0, 'auto'), (0.38, coil, 'in'), (0.5, stab, 'hold'), (0.62, hold, 'inout'),
                       (1.0, s0.but(lean=18).vine('l', curl=10), 'auto'), (1.3, s0, 'auto')])


def lash_cast(rig):
    """LashCast (2.4 s): Entangling Lash. The wind-up fills the 1.5 s cast bar:
    the Lasher turns its right side back, plants its left vine on the ground,
    raises the right arm high and the whip circles overhead in a slow coil while
    the face splits open; at the end of the bar the body wrenches forward and the
    whip UNROLLS from the wrist to the tip, flat along the lane in front of it,
    and slams down. CONTRACT: the wind-up 0.00 to 1.36; the whip unrolls 1.36 to
    1.50; the tip slams the lane at 1.50 (the root lands, lane impact);
    the whip lies along the lane 1.50 to 1.80 (a recoil ripple runs down it);
    it is dragged back 1.80 to 2.40."""
    s0 = stance(rig)
    turn = s0.but(yaw=-24, spine_yaw=-16, lean=8, pitch=3, head_pitch=22, head_yaw=10, shrug_r=26, jaw=14,
                  wr=(-0.75, 0.85, 1.55), wl=(0.75, -1.2, -1.95), pole_a=(0.9, 0.2, -0.6)).vine(
        'r', h=10, e=140, curl=24, ycurl=10, stiff=0.0, wave=10)
    coil = turn.but(yaw=-30, spine_yaw=-22, pitch=5, lean=4, head_pitch=26, jaw=24, shrug_r=32,
                    wr=(-0.8, 1.0, 1.7), roll=-3).vine('r', h=-15, e=132, curl=30, ycurl=14, wave=16)
    tense = coil.but(yaw=-33, spine_yaw=-25, pelvis=(0, 0.1, -0.24), jaw=28).vine('r', h=-25, e=128, curl=32,
                                                                               ycurl=16, wave=12)
    snap = s0.but(yaw=16, spine_yaw=12, lean=34, pitch=-8, head_pitch=10, jaw=30, shrug_r=4, pelvis=(0, -0.3, -0.3),
                  wr=(-0.25, -2.05, -1.4), pole_a=(0.7, 0.8, -0.2)).vine(
        'r', h=-4, e=-6, curl=0, ycurl=0, lh=-5, le=-4, un=1.0, ext=1.14, stiff=1.0, wave=0)
    held = snap.but(lean=30, jaw=16, wr=(-0.2, -2.0, -1.45)).vine('r', le=-3, ext=1.12, wave=6, stiff=0.5)
    back = s0.but(lean=18, jaw=6).vine('r', h=20, e=-60, curl=20, un=0.0, ext=1.0, stiff=0.2)
    keys = [(0.0, s0, 'auto'), (0.35, turn, 'auto'), (0.85, coil, 'auto'), (1.28, tense, 'quadin'),
            (1.36, tense.but(yaw=-28).vine('r', un=0.0), 'in'), (1.5, snap, 'hold'), (1.56, snap, 'out'),
            (1.8, held, 'inout'), (2.15, back, 'auto'), (2.4, s0, 'auto')]

    def post(b, t):
        # the coil spins overhead through the wind-up (the bar), the unroll
        # carries the spin into the lane
        if t < 1.42:
            b = b.vine('r', ph=TAU * 1.4 * t, wave=max(b.p['vr_wave'], 10))
        if 1.36 <= t <= 1.5:
            u = (t - 1.36) / 0.14
            b = b.vine('r', un=u, stiff=u, ext=1.0 + 0.14 * u)
        b = b.vine('l', ph=TAU * 0.5 * t, wave=8)
        return b
    return keys_of(keys, post=post)


def hit(rig):
    """Hit (0.6 s): it rocks back on its roots, the face jerks up, the vines jolt."""
    s0 = stance(rig)
    rock = s0.but(pitch=7, lean=6, head_pitch=26, jaw=20, pelvis=(0, 0.12, -0.12), shrug_l=12, shrug_r=12).vine(
        'l', wave=24, ph=1.0).vine('r', wave=24, ph=2.5)
    return _clip(rig, [(0.0, s0, 'auto'), (0.1, rock, 'out'), (0.32, s0.but(lean=19, head_pitch=10), 'auto'),
                       (0.6, s0, 'auto')])


def death(rig):
    """Death (3.2 s): it collapses into a pile of vines. It reels back, the knees
    go, it sinks straight down onto its roots, the hump folds forward over its
    knees, the face drops to the ground and the vines go limp and spread out;
    the body unravels a little as it settles. CONTRACT: the knees buckle at 0.55,
    the pile hits the ground at 1.45 (thud, leaves and dust), at rest from 2.4."""
    s0 = stance(rig)
    reel = s0.but(pitch=9, lean=4, head_pitch=34, jaw=32, pelvis=(0, 0.15, -0.1), shrug_l=16, shrug_r=16,
                  wl=(0.7, -0.2, -1.6), wr=(-0.7, -0.1, -1.6)).vine('l', wave=26).vine('r', wave=26)
    buckle = s0.but(pitch=-4, lean=30, head_pitch=4, jaw=18, pelvis=(0, -0.1, -0.85), pole_k=(0.8, -1.0, 0.0),
                    wl=(0.9, -0.9, -1.9), wr=(-0.9, -0.8, -1.9), roll=3)
    pile = s0.but(pitch=-22, lean=46, neck_pitch=-20, head_pitch=-12, head_roll=14, jaw=26,
                  pelvis=(0, -0.45, -1.62), pole_k=(1.0, -0.6, 0.0), roll=4, yaw=6,
                  wl=(1.25, -1.0, -1.2), wr=(-1.3, -0.7, -1.3), shrug_l=-14, shrug_r=-14, body_s=0.94).vine(
        'l', h=60, e=-40, curl=12, ycurl=10, stiff=0.6).vine('r', h=50, e=-40, curl=12, ycurl=-8, stiff=0.6)
    rest = pile.but(pitch=-25, lean=50, pelvis=(0, -0.5, -1.72), head_pitch=-16, jaw=20, body_s=0.9).vine(
        'l', h=70, curl=8).vine('r', h=62, curl=8)
    seq = [(0.0, s0, 'auto'), (0.3, reel, 'auto'), (0.55, reel.but(pitch=4, lean=10, pelvis=(0, 0.1, -0.3)), 'in'),
           (1.0, buckle, 'in'), (1.45, pile, 'out'), (1.75, pile.but(pelvis=(0, -0.45, -1.55), lean=42), 'inout'),
           (2.4, rest, 'linear'), (3.2, rest, 'linear')]

    def post(b, t):
        amp = 18 * max(0.0, 1 - t / 2.2)
        return b.vine('l', ph=TAU * 0.8 * t, wave=amp).vine('r', ph=TAU * 0.8 * t + 2, wave=amp)
    return keys_of(seq, post=post)


# ------------------------------------------------------------------ the Thorn Sprout's own clips
def emerge(rig):
    """Emerge (1.8 s): it bursts out of the seed pod. It starts curled tiny in the
    pod under the loam, punches up at full size with its maw split wide and its
    vines flung out, staggers, shakes itself and settles. CONTRACT: the burst at
    0.30 (pod splits, thorns and dirt), full height at 0.55, ready at 1.8."""
    s0 = stance(rig)
    pod = s0.but(root_s=0.18, pelvis=(0, 0, -0.45), lean=55, head_pitch=-30, jaw=0,
                 wl=(0.0, -0.8, -1.0), wr=(0.0, -0.8, -1.0)).vine('l', e=0, curl=-60).vine('r', e=0, curl=-60)
    burst = s0.but(root_s=1.06, pelvis=(0, 0, 0.35), lean=-10, pitch=8, head_pitch=40, jaw=42, shrug_l=30, shrug_r=30,
                   wl=(1.0, 0.3, 0.2), wr=(-1.0, 0.3, 0.2)).vine('l', h=80, e=40, curl=-10, wave=30).vine(
        'r', h=80, e=40, curl=-10, wave=30)
    stag = s0.but(root_s=1.0, pelvis=(0.1, 0.05, -0.2), lean=24, roll=6, head_pitch=6, jaw=22, head_roll=-14)
    shake = s0.but(lean=18, head_yaw=-16, head_roll=12, jaw=12, roll=-4)
    seq = [(0.0, pod, 'hold'), (0.28, pod, 'in'), (0.55, burst, 'out'), (0.85, stag, 'auto'), (1.15, shake, 'auto'),
           (1.4, s0.but(head_yaw=10), 'auto'), (1.8, s0, 'auto')]

    def post(b, t):
        return b.vine('l', ph=TAU * 1.5 * t, wave=max(b.p['vl_wave'], 12)).vine(
            'r', ph=TAU * 1.5 * t + 2, wave=max(b.p['vr_wave'], 12))
    return keys_of(seq, post=post)


def bite(rig):
    """Bite (1.0 s): it rears back with the maw split wide and lunges, the jaws
    slamming shut. CONTRACT: the jaws close on the target at 0.42 s."""
    s0 = stance(rig)
    rear = s0.but(pitch=8, lean=0, head_pitch=34, jaw=46, pelvis=(0, 0.2, -0.1), shrug_l=14, shrug_r=14)
    lunge = s0.but(pitch=-10, lean=40, head_pitch=-4, jaw=0, pelvis=(0, -0.55, -0.3), wl=(0.5, -1.3, -1.6),
                   wr=(-0.5, -1.3, -1.6))
    return _clip(rig, [(0.0, s0, 'auto'), (0.28, rear, 'in'), (0.42, lunge, 'out'),
                       (0.55, lunge.but(jaw=6, head_roll=8), 'auto'), (1.0, s0, 'auto')], writhe_amp=12)


def wither(rig):
    """Wither (2.0 s, the Sprout when the Gorgebloom dies): it shudders, droops,
    folds down onto its roots and shrivels into the loam. CONTRACT: gone (scale
    near zero) at 1.9."""
    s0 = stance(rig)
    shud = s0.but(pitch=4, head_pitch=20, jaw=24, shrug_l=12, shrug_r=12).vine('l', wave=20).vine('r', wave=20)
    droop = s0.but(lean=48, head_pitch=-30, jaw=10, pelvis=(0, -0.2, -0.9), root_s=0.8, pole_k=(0.8, -1.0, 0))
    gone = droop.but(root_s=0.06, pelvis=(0, -0.2, -1.2), lean=60)
    return _clip(rig, [(0.0, s0, 'auto'), (0.3, shud, 'auto'), (1.0, droop, 'in'), (1.9, gone, 'linear'),
                       (2.0, gone, 'linear')], writhe_amp=10)


LASHER_CATALOG = [('Idle', idle, True, 0.0), ('Walk', walk, True, 2.0), ('Run', run, True, 5.5),
                  ('Attack', attack, False, 0.0), ('Attack2', attack2, False, 0.0), ('LashCast', lash_cast, False, 0.0),
                  ('Hit', hit, False, 0.0), ('Death', death, False, 0.0)]
SPROUT_CATALOG = [('Emerge', emerge, False, 0.0), ('Idle', idle, True, 0.0), ('Walk', walk, True, 2.0),
                  ('Run', run, True, 5.5), ('Bite', bite, False, 0.0), ('Hit', hit, False, 0.0),
                  ('Death', death, False, 0.0), ('Wither', wither, False, 0.0)]
CATALOG = SPROUT_CATALOG if A.SPROUT else LASHER_CATALOG
NO_VINE_SPRING = {'LashCast': ('R_Vine5',), 'Attack2': ('L_Vine5',)}


def make_clips(arm, only=None):
    rig = R.Rig(arm)
    made = []
    for name, fn, loop, wind in CATALOG:
        if only and name not in only:
            continue
        keys = fn(rig)
        act = R.make_clip(arm, name, keys)
        R.follow_through(arm, act, loop=loop, wind=wind, skip=NO_VINE_SPRING.get(name, ()))
        made.append(name)
    return made
