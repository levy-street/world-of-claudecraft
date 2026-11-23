"""The Drakemaw Raptor's clips: a saddle-broken theropod's whole movement set.

Every clip is solved per frame from a `Body` (pose.py) and keyed at FPS; the
game plays them in place (it owns the travel and the jump's arc), so nothing
here ever moves the root.

FOOT LOCK is the contract the gaits are built on. A planted ball slides back
along the ground at exactly the speed the clip is named for (the manifest's
walkRef / runRef / walkBackRef in yards a second, one model yard per game
yard), so at timeScale 1 the planted foot stands still on the ground while the
body passes over it. A gait's speed is its stance sweep over its stance time
(sweep = speed * duty * period), and the leg only reaches about 1.25 yd from
the front of its stance to the back. So the ridden sprint can only hold 12.6
yd/s with a short duty and real flight between the steps, which is what the
Run is: the legacy baked cycle kept a foot down all the time, and had to
choose between a frantic cadence and feet sliding a quarter of the way.

The clips (CONTRACT lines name what the renderer relies on):
  Idle      8 s loop. Breathing, the weight rolling from foot to foot, a stamp
            of the right foot, bird-like head darts that freeze on a sound, a
            curious tilt, then a calm settle; the tail sways and flicks.
            CONTRACT: at 0.5 s it stands neutral (the renderer sizes the model
            on that frame), soles on the ground.
  Walk      loop at WALK_SPEED. A deliberate strut: the body rides high over
            the planted foot, the head holds still in the world between steps.
  Run       loop at RUN_SPEED: the ridden gait. A sprint with two flights a
            stride: the body levels out, the neck stretches, the head stays
            locked while everything under it pumps, the tail streams out as a
            counterweight, the feet fold up like a bird's in the swing.
  WalkBack  loop at BACK_SPEED: the backpedal. A quick backward bounding
            scramble, upright, the tail lifted clear.
  Jump      0.93 s, played once and HELD on its last frame (the manifest names
            Land): the spring, the tuck, then the legs reaching for the ground.
            CONTRACT: no rise (the game owns the arc), and the held frame keeps
            the feet at ground level so a touchdown never sinks them.
  Land      0.5 s one-shot on a standing touchdown: the impact through the legs,
            the head and the tail, and the settle back to the stance.
"""
import math

from mathutils import Vector

from pose import X_AX, Body, q_axis

FPS = 60
TAU = math.tau
V = Vector

WALK_SPEED = 2.6        # yd/s: the walk band is the bottom of the mount's speeds (slows, starts)
RUN_SPEED = 12.6        # yd/s: RUN_SPEED 7 x (1 + 0.8), the +80% mount at full gallop
BACK_SPEED = 8.19       # yd/s: the ridden speed x BACKPEDAL_MULT 0.65
JUMP_FRAMES = 56        # 0.933 s: a flat mounted jump's airtime is 2 * 7.5 / 16 = 0.9375 s
LAND_FRAMES = 30
IDLE_FRAMES = 8 * FPS


# ------------------------------------------------------------------ curves
def clamp01(x):
    return max(0.0, min(1.0, x))


def smooth(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def smoother(x):
    x = clamp01(x)
    return x * x * x * (x * (6 * x - 15) + 10)


def bump(x, c, w):
    """A Gaussian bump of height 1 at c, width w."""
    return math.exp(-((x - c) / w) ** 2)


def cyc_bump(ph, c, w):
    """A periodic Gaussian on the unit circle (phase in cycles)."""
    d = (ph - c + 0.5) % 1.0 - 0.5
    return math.exp(-(d / w) ** 2)


def lerp(a, b, t):
    return a + (b - a) * t


def keys_curve(t, pts):
    """Piecewise smoothstep through [(t, value), ...]."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return lerp(v0, v1, smooth((t - t0) / max(1e-9, t1 - t0)))
    return pts[-1][1]


# ------------------------------------------------------------------ the stance
def stance(rig):
    """Standing ready under a rider: a little lower and more level than the
    model's sculpted pose, the neck forward of upright, the head level, the
    tail carried off the ground, the forelimbs folded to the chest."""
    return Body(
        pelvis=(0.0, 0.0, -0.05), pitch=-3.0,
        spine_pitch=1.0, neck_pitch=-4.0, head_pitch=5.0,
        tail_lift=-1.0,
        arm_l=-6.0, arm_r=-6.0, elbow_l=12.0, elbow_r=12.0, hand_l=10.0, hand_r=10.0,
        ball_l=tuple(rig.rest_ball('L_')), ball_r=tuple(rig.rest_ball('R_')),
    )


# ------------------------------------------------------------------ gaits
class Gait:
    """A locomotion cycle. Phase 0 is the left foot's touchdown; the right foot
    runs half a cycle behind. Speeds are signed (+ forward, - backward)."""

    def __init__(self, **kw):
        self.speed = 0.0
        self.frames = 48
        self.duty = 0.6
        self.track = 0.42           # each ball's distance from the midline
        self.y_c = 0.0              # the stance's centre, from the rest ball (+ back)
        self.lift = 0.4             # how high the ball rises in the swing
        self.lift_peak = 0.4        # where in the swing it peaks (0..1)
        self.reach = 0.0            # how far past the landing spot the foot reaches, then settles
        self.meta_land = -6.0       # metatarsus at touchdown (- reaching)
        self.meta_mid = 0.0
        self.meta_off = 30.0        # at toe-off: the heel lifted over the ball
        self.heel_from = 0.55       # stance fraction where the heel starts to rise
        self.meta_fold = 70.0       # the swing's fold: the foot tucked up under the ankle
        self.fold_at = 0.22         # swing fraction where the fold is complete...
        self.unfold = (0.3, 0.8)    # ...and the span over which it opens out again as the foot comes through
        self.meta_reach = -16.0     # late swing: reaching out for the next step
        self.toe_curl = 55.0        # the swing's clench
        self.toe_open = -12.0       # spread just before the strike
        self.peel = 0.3             # yards the ball rises before the toes leave the ground's attitude
        self.curl_at = 0.22         # swing fraction by which the clench is in
        self.__dict__.update(kw)

    @property
    def period(self):
        return self.frames / FPS

    @property
    def sweep(self):
        return self.speed * self.duty * self.period


def gait_foot(g, phi, rest, side):
    """Ball target, metatarsus, toes and planted-ness for one foot at phase phi."""
    s = g.sweep
    x = side * g.track
    y0 = rest[1] + g.y_c
    if phi < g.duty:
        u = phi / g.duty
        y = y0 - s / 2 + s * u
        heel = smooth((u - g.heel_from) / (1.0 - g.heel_from))
        meta = lerp(lerp(g.meta_land, g.meta_mid, smooth(u / 0.4)), g.meta_off, heel)
        return (x, y, rest[2]), meta, 0.0, 1.0
    u = (phi - g.duty) / (1.0 - g.duty)
    e = smoother(u)
    over = g.reach * math.sin(math.pi * clamp01((u - 0.55) / 0.45))
    y = y0 + s / 2 - s * e - over * (1 if s >= 0 else -1)
    rise = math.sin(math.pi * clamp01(u)) ** 0.8
    skew = 1.0 + (0.5 - g.lift_peak) * 2.0 * math.cos(math.pi * u)
    z = rest[2] + g.lift * rise * max(0.0, skew)
    fold = math.sin(math.pi * clamp01(u / 0.75))
    u0, u1 = g.unfold
    meta = lerp(lerp(g.meta_off, g.meta_fold, smooth(u / g.fold_at)), g.meta_reach, smooth((u - u0) / (u1 - u0)))
    meta = lerp(meta, g.meta_land, smooth((u - 0.88) / 0.12))
    toe = g.toe_curl * fold * smooth(u / g.curl_at) + g.toe_open * smooth((u - 0.7) / 0.18) * (1 - smooth((u - 0.94) / 0.06))
    # The toe-off and the strike: the toes keep the ground's attitude until the
    # ball is `peel` up and take it back on the way down, so the folding foot
    # never swings them into the floor (a lift timed by the swing's clock alone
    # did, with the ball still low); they only clench once they are off it.
    planted = 1.0 - smooth((z - rest[2]) / g.peel)
    return (x, y, z), meta, toe * (1.0 - planted), clamp01(planted)


def gait_cycle(rig, g, body_fn):
    """Bodies for one loop (frames 0..N inclusive; N is frame 0 again)."""
    rest_l, rest_r = rig.rest_ball('L_'), rig.rest_ball('R_')
    out = []
    for f in range(g.frames + 1):
        ph = (f / g.frames) % 1.0
        fl = gait_foot(g, ph, rest_l, 1.0)
        fr = gait_foot(g, (ph - 0.5) % 1.0, rest_r, -1.0)
        b = body_fn(ph, fl, fr)
        b.set(ball_l=fl[0], meta_l=fl[1], toe_l=fl[2], planted_l=fl[3],
              ball_r=fr[0], meta_r=fr[1], toe_r=fr[2], planted_r=fr[3])
        out.append(b)
    return out


# ------------------------------------------------------------------ locomotion bodies
def walk(rig):
    """The strut. A duty of 0.62 keeps both feet down through each push (a walk,
    never a jog); the body rides an inverted pendulum, high over each planted
    foot and low through the double support, swaying onto the standing leg; the
    hips swing each thigh through and the chest twists back against them; the
    head holds its world attitude between steps, the neck soaking up the bob;
    the tail swings opposite the hips a beat late and waves down its length."""
    g = Gait(speed=WALK_SPEED, frames=48, duty=0.62, track=0.42, y_c=0.04, lift=0.46, lift_peak=0.34,
             reach=0.04, meta_land=0.0, meta_mid=0.0, meta_off=26.0, heel_from=0.58, meta_fold=46.0,
             fold_at=0.38, unfold=(0.44, 0.86), meta_reach=-12.0, toe_curl=40.0, toe_open=-10.0,
             peel=0.34, curl_at=0.4)
    base = stance(rig)
    w_mid = TAU * g.duty / 2          # mid-stance of the left foot

    def body(ph, fl, fr):
        w = TAU * ph
        p0 = base.p
        bob = 0.045 * math.cos(2 * (w - w_mid))           # highest over the planted foot
        return base.but(
            pelvis=(0.06 * math.cos(w - w_mid), 0.0, p0['pelvis'][2] + bob - 0.01),
            yaw=-4.0 * math.cos(w), roll=-1.6 * math.cos(w - w_mid), pitch=p0['pitch'] - 1.2 * math.cos(2 * (w - w_mid) + 0.6),
            spine_yaw=3.0 * math.cos(w), spine_roll=1.0 * math.cos(w - w_mid),
            neck_pitch=p0['neck_pitch'] - 2.5 * math.cos(2 * (w - w_mid)), neck_yaw=-1.0 * math.cos(w),
            head_lock=0.7, head_world=(0.0, -2.0, 0.0),
            tail_yaw=6.0 * math.cos(w - 1.0), tail_wave=5.0, tail_phase=w - 0.4, tail_lag=0.6,
            tail_lift=p0['tail_lift'] - 3.0 * math.cos(2 * (w - w_mid) - 0.9),
            arm_l=p0['arm_l'] + 4.0 * math.sin(w), arm_r=p0['arm_r'] - 4.0 * math.sin(w),
            elbow_l=p0['elbow_l'] + 5.0 * math.cos(2 * (w - w_mid) - 1.2),
            elbow_r=p0['elbow_r'] + 5.0 * math.cos(2 * (w - w_mid) - 1.2),
        )
    return gait_cycle(rig, g, body), g


def run(rig):
    """The sprint. Duty 0.22 at 2.2 strides a second: each foot is down for a
    tenth of a second and the body flies twice a stride. It levels out (the
    spine near horizontal under the rider), compresses into each footfall and
    rebounds off it, rolling a little over the standing leg; the neck stretches
    forward and the head stays locked level while the body pumps under it; the
    tail streams out straight behind, a counterweight that whips a little after
    each compression; the forelimbs are clamped tight to the chest; in the
    swing each foot folds up under the knee with the toes clenched, then
    unfolds and reaches out for the strike."""
    g = Gait(speed=RUN_SPEED, frames=27, duty=0.22, track=0.36, y_c=-0.02, lift=0.62, lift_peak=0.38,
             reach=0.08, meta_land=0.0, meta_mid=2.0, meta_off=42.0, heel_from=0.45, meta_fold=82.0,
             fold_at=0.3, unfold=(0.34, 0.78), meta_reach=-22.0, toe_curl=70.0, toe_open=-16.0,
             peel=0.44, curl_at=0.34)
    base = stance(rig).but(pitch=-13.0, spine_pitch=-2.0, neck_pitch=-24.0, head_pitch=0.0, tail_lift=-9.0,
                           arm_l=-14.0, arm_r=-14.0, elbow_l=58.0, elbow_r=58.0, hand_l=34.0, hand_r=34.0,
                           out_l=-3.0, out_r=-3.0)
    w_mid = TAU * g.duty / 2

    def body(ph, fl, fr):
        w = TAU * ph
        p0 = base.p
        c2 = math.cos(2 * (w - w_mid))                     # +1 at each mid-stance (the deepest compression)
        bob = -0.075 * c2 + 0.02 * math.cos(4 * (w - w_mid))
        return base.but(
            pelvis=(0.035 * math.cos(w - w_mid), 0.03 * math.sin(2 * (w - w_mid)), p0['pelvis'][2] - 0.05 + bob),
            yaw=-4.5 * math.cos(w), roll=-2.2 * math.cos(w - w_mid),
            pitch=p0['pitch'] - 2.2 * math.cos(2 * (w - w_mid) - 0.5),
            spine_yaw=3.2 * math.cos(w), spine_pitch=p0['spine_pitch'] + 1.5 * c2,
            neck_pitch=p0['neck_pitch'] + 4.0 * c2, neck_yaw=-1.2 * math.cos(w),
            head_lock=0.85, head_world=(0.0, -6.0, 0.0),
            tail_yaw=4.0 * math.cos(w - 1.1), tail_wave=3.0, tail_phase=w - 0.6, tail_lag=0.5,
            tail_lift=p0['tail_lift'] + 4.5 * math.cos(2 * (w - w_mid) - 1.1),
            tail_wave_lift=2.0, tail_tip=2.5 * math.cos(2 * (w - w_mid) - 1.8),
            elbow_l=p0['elbow_l'] + 6.0 * math.cos(2 * (w - w_mid) - 1.0),
            elbow_r=p0['elbow_r'] + 6.0 * math.cos(2 * (w - w_mid) - 1.0),
            hand_l=p0['hand_l'] + 6.0 * math.cos(2 * (w - w_mid) - 1.4),
            hand_r=p0['hand_r'] + 6.0 * math.cos(2 * (w - w_mid) - 1.4),
        )
    return gait_cycle(rig, g, body), g


def walk_back(rig):
    """The backpedal: a quick backward bounding scramble at the full backpedal
    speed. Upright and a little sat back, the tail lifted clear of the ground it
    is backing into, the head steady and looking ahead, the forelimbs held out
    for balance; each foot reaches back for the ground and pushes off forward."""
    g = Gait(speed=-BACK_SPEED, frames=30, duty=0.28, track=0.44, y_c=-0.1, lift=0.42, lift_peak=0.45,
             reach=0.05, meta_land=6.0, meta_mid=0.0, meta_off=0.0, heel_from=0.6, meta_fold=26.0,
             fold_at=0.3, unfold=(0.38, 0.85), meta_reach=16.0, toe_curl=32.0, toe_open=-8.0,
             peel=0.36, curl_at=0.42)
    base = stance(rig).but(pitch=4.0, neck_pitch=0.0, head_pitch=0.0, tail_lift=14.0,
                           arm_l=6.0, arm_r=6.0, elbow_l=26.0, elbow_r=26.0, out_l=6.0, out_r=6.0)
    w_mid = TAU * g.duty / 2

    def body(ph, fl, fr):
        w = TAU * ph
        p0 = base.p
        c2 = math.cos(2 * (w - w_mid))
        return base.but(
            pelvis=(0.04 * math.cos(w - w_mid), 0.0, p0['pelvis'][2] - 0.04 - 0.05 * c2),
            yaw=3.0 * math.cos(w), roll=-1.8 * math.cos(w - w_mid),
            pitch=p0['pitch'] + 1.5 * math.cos(2 * (w - w_mid) - 0.4),
            spine_yaw=-2.0 * math.cos(w),
            neck_pitch=p0['neck_pitch'] + 2.5 * c2,
            head_lock=0.8, head_world=(0.0, 0.0, 0.0),
            tail_yaw=-4.0 * math.cos(w - 1.0), tail_wave=3.0, tail_phase=w - 0.5,
            tail_lift=p0['tail_lift'] + 3.0 * math.cos(2 * (w - w_mid) - 1.0),
            elbow_l=p0['elbow_l'] + 5.0 * math.cos(2 * (w - w_mid) - 1.0),
            elbow_r=p0['elbow_r'] + 5.0 * math.cos(2 * (w - w_mid) - 1.0),
        )
    return gait_cycle(rig, g, body), g


# ------------------------------------------------------------------ authored timelines
EASE = {
    'linear': lambda u: u,
    'smooth': smooth,
    'in': lambda u: u * u * u,
    'out': lambda u: 1 - (1 - u) ** 3,
    'inout': lambda u: 0.5 - 0.5 * math.cos(math.pi * u),
}


def lerp_body(b0, b1, u):
    out = b0.but()
    for k, a in b0.p.items():
        o = b1.p[k]
        if a is None or o is None:
            out.p[k] = o if u >= 0.5 else a
        elif isinstance(a, (tuple, list)):
            out.p[k] = tuple(float(x) + (float(y) - float(x)) * u for x, y in zip(a, o))
        elif isinstance(a, bool):
            out.p[k] = o if u >= 0.5 else a
        else:
            out.p[k] = a + (o - a) * u
    return out


def timeline(keys, frames):
    """Bodies for frames 0..N from [(t_seconds, Body, ease leaving the key)]."""
    out = []
    for f in range(frames + 1):
        t = f / FPS
        if t <= keys[0][0]:
            out.append(keys[0][1].but())
            continue
        for (t0, b0, ease), (t1, b1, _) in zip(keys, keys[1:]):
            if t <= t1:
                out.append(lerp_body(b0, b1, EASE[ease]((t - t0) / max(1e-9, t1 - t0))))
                break
        else:
            out.append(keys[-1][1].but())
    return out


def lifted(rig, side, dy=0.0, dz=0.0, dx=0.0):
    r = rig.rest_ball(side)
    return (r[0] + dx, r[1] + dy, r[2] + dz)


def ball_for_ankle(rig, side, off, meta):
    """The ball target that puts a leg's ankle at `off` (x out from the body, y
    back, z up, yards) from its rest hip joint with its metatarsus at `meta`.
    A tucked leg authored by where its ankle goes keeps its reach honest: placing
    the ball high with the foot folded back otherwise sends the ankle out in
    front of the chest, past where the leg can reach."""
    sign = 1.0 if side == 'L_' else -1.0
    ankle = rig.head[side + 'Thigh'] + V((off[0] * sign, off[1], off[2]))
    m_dir = q_axis(X_AX, meta) @ rig.dir[side + 'Foot']
    return tuple(ankle + m_dir * rig.length[side + 'Foot'])


def idle(rig):
    """Eight seconds at rest under a rider. Two slow breaths (the chest lifts on
    the quicker inhale); the weight rolls onto the left foot and back over to
    the right; at 1.3 s, weighted left, it picks up its right foot and stamps it
    down where it stood; from 2.6 s the head darts to new sounds and freezes on
    each (left and down, then right and up with the neck lifting, alert, the
    tail tip flicking), cocks curiously, then eases back to centre and settles
    for the rest of the loop. CONTRACT: neutral at 0.5 s, and frame N is frame 0."""
    base = stance(rig)
    p0 = base.p
    rest_l, rest_r = rig.rest_ball('L_'), rig.rest_ball('R_')
    look = [(0.0, (0, 0, 0)), (2.6, (0, 0, 0)), (2.76, (31, -5, 9)), (2.86, (28, -4, 8)), (3.9, (28, -4, 8)),
            (4.04, (-21, 7, -5)), (4.14, (-18, 6, -4)), (4.9, (-18, 6, -4)), (5.12, (-9, 2, -19)),
            (5.7, (-9, 2, -19)), (6.2, (0, -3, 0)), (7.6, (0, 0, 0)), (8.0, (0, 0, 0))]

    def look_at(t):
        vals = []
        for i in range(3):
            vals.append(keys_curve(t, [(tt, v[i]) for tt, v in look]))
        return vals

    out = []
    for f in range(IDLE_FRAMES + 1):
        t = f / FPS
        # breathing: two breaths, a quicker inhale than exhale
        bp = (t % 4.0) / 4.0
        breath = smooth(bp / 0.4) if bp < 0.4 else 1.0 - smooth((bp - 0.4) / 0.6)
        shift = math.sin(TAU * t / 8.0)                   # + over the left foot
        # the right foot's stamp
        lift = keys_curve(t, [(1.25, 0.0), (1.5, 1.0), (1.7, 1.1), (1.8, 0.0)])
        jolt = bump(t, 1.84, 0.05)
        alert = keys_curve(t, [(3.9, 0.0), (4.05, 1.0), (4.9, 1.0), (5.3, 0.0)])
        yaw, pitch, roll = look_at(t)
        flick = bump(t, 4.08, 0.06) - 0.55 * bump(t, 4.22, 0.07)
        tail_w = TAU * t / 4.0
        fr = lifted(rig, 'R_', dy=0.02 * lift, dz=0.44 * lift)
        peel_r = 1.0 - smooth(0.44 * lift / 0.3)          # the toes leave the ground's attitude as the foot rises
        out.append(base.but(
            pelvis=(0.055 * shift - 0.02 * lift, 0.0, p0['pelvis'][2] + 0.012 * breath - 0.03 * jolt + 0.01 * alert),
            roll=0.9 * shift + 0.6 * lift, yaw=1.2 * shift, pitch=p0['pitch'] + 0.6 * alert - 0.8 * jolt,
            spine_pitch=p0['spine_pitch'] + 1.0 * breath + 1.5 * alert,
            neck_pitch=p0['neck_pitch'] + 0.6 * breath + 7.0 * alert + 0.35 * pitch,
            neck_yaw=0.4 * yaw, neck_roll=0.3 * roll,
            head_pitch=p0['head_pitch'] + 0.65 * pitch - 2.0 * jolt,
            head_yaw=0.6 * yaw, head_roll=0.7 * roll,
            tail_yaw=7.0 * math.sin(tail_w + 0.5), tail_wave=4.0, tail_phase=tail_w,
            tail_lift=p0['tail_lift'] + 1.2 * breath + 2.5 * alert, tail_tip=24.0 * flick,
            arm_l=p0['arm_l'] + 2.0 * breath, arm_r=p0['arm_r'] + 2.0 * breath,
            hand_l=p0['hand_l'] + 12.0 * bump(t, 3.05, 0.22) + 8.0 * bump(t, 7.0, 0.3),
            hand_r=p0['hand_r'] + 12.0 * bump(t, 3.2, 0.22) + 8.0 * bump(t, 7.1, 0.3),
            ball_l=tuple(rest_l), ball_r=fr,
            meta_r=34.0 * lift, toe_r=38.0 * lift * (1.0 - peel_r), planted_r=peel_r,
        ))
    return out


def jump(rig):
    """The jump, held on its last frame (the manifest names Land, so the game
    plays it once and clamps it while the body is in the air): the legs uncoil
    off the ground (the first frames sit under the 0.22 s crossfade from the
    gait), fold up tight under the belly with the toes clenched as it rises, ride
    the apex tucked with the tail cocked up, then drop and reach forward for the
    ground, toes spread, head dipping to watch the landing. The game owns the arc;
    the hips never rise here. CONTRACT: the held frame's balls sit at ground
    level and the clip ends inside a flat jump's 0.9375 s airtime."""
    st = stance(rig)
    launch = st.but(pitch=6.0, spine_pitch=2.0, neck_pitch=-6.0, head_pitch=4.0, tail_lift=-6.0,
                    arm_l=-12.0, arm_r=-12.0, elbow_l=30.0, elbow_r=30.0,
                    ball_l=lifted(rig, 'L_', dy=0.2, dz=0.0), ball_r=lifted(rig, 'R_', dy=0.16, dz=0.0),
                    meta_l=46.0, meta_r=42.0, toe_l=0.0, toe_r=0.0, planted_l=1.0, planted_r=1.0)
    # the legs by where each ankle goes from its hip (out, back, up), the right a beat behind
    def legs(off_l, off_r, meta_l, meta_r):
        return dict(ball_l=ball_for_ankle(rig, 'L_', off_l, meta_l), ball_r=ball_for_ankle(rig, 'R_', off_r, meta_r),
                    meta_l=meta_l, meta_r=meta_r)
    rise = st.but(pitch=5.0, spine_pitch=2.0, neck_pitch=-8.0, head_pitch=2.0, tail_lift=8.0,
                  arm_l=-16.0, arm_r=-16.0, elbow_l=50.0, elbow_r=50.0, hand_l=30.0, hand_r=30.0,
                  toe_l=22.0, toe_r=20.0, planted_l=0.0, planted_r=0.0,
                  **legs((0.07, -0.18, -0.5), (0.07, -0.14, -0.52), 45.0, 42.0))
    tuck = st.but(pitch=1.0, spine_pitch=1.0, neck_pitch=-10.0, head_pitch=0.0, tail_lift=12.0, tail_tip=10.0,
                  arm_l=-18.0, arm_r=-18.0, elbow_l=62.0, elbow_r=62.0, hand_l=38.0, hand_r=38.0,
                  toe_l=58.0, toe_r=55.0, planted_l=0.0, planted_r=0.0,
                  **legs((0.06, -0.42, -0.52), (0.06, -0.38, -0.54), 70.0, 68.0))
    apex = tuck.but(pitch=-1.0, tail_lift=10.0, tail_tip=4.0,
                    **legs((0.06, -0.45, -0.48), (0.06, -0.41, -0.5), 72.0, 70.0))
    reach = st.but(pitch=-5.0, spine_pitch=0.0, neck_pitch=-8.0, head_pitch=-6.0, tail_lift=3.0,
                   arm_l=-4.0, arm_r=-4.0, elbow_l=30.0, elbow_r=30.0, out_l=10.0, out_r=10.0, hand_l=4.0, hand_r=4.0,
                   toe_l=-12.0, toe_r=-10.0, planted_l=0.0, planted_r=0.0,
                   **legs((0.07, -0.26, -0.84), (0.07, -0.22, -0.85), -6.0, -5.0))
    # the held frame: the ankles a few centimetres over their standing height, the
    # metatarsus level, the toes spread; the balls just clear of the ground
    ready = reach.but(pitch=-4.0, head_pitch=-9.0, tail_lift=1.0,
                      toe_l=-6.0, toe_r=-5.0, planted_l=0.5, planted_r=0.45,
                      **legs((0.069, -0.06, -0.875), (0.069, -0.03, -0.872), 0.0, 0.0))
    end = JUMP_FRAMES / FPS
    return timeline([(0.0, launch, 'out'), (0.13, rise, 'out'), (0.32, tuck, 'inout'), (0.5, apex, 'inout'),
                     (0.7, reach, 'out'), (0.85, ready, 'smooth'), (end, ready, 'linear')], JUMP_FRAMES)


def land(rig):
    """A standing touchdown: the feet strike where they stand, the body drops
    through deep knees, the nose dips and the head lags it, the tail whips down
    and back up, the forelimbs swing on; it rebounds a touch and settles into
    the stance it idles in."""
    st = stance(rig)
    p0 = st.p
    contact = st.but(pitch=-4.0, head_pitch=-6.0, tail_lift=1.0, arm_l=-4.0, arm_r=-4.0, elbow_l=30.0,
                     elbow_r=30.0, out_l=10.0, out_r=10.0, meta_l=0.0, meta_r=0.0)
    impact = st.but(pelvis=(0.0, 0.03, p0['pelvis'][2] - 0.3), pitch=-8.0, spine_pitch=-2.5, neck_pitch=-14.0,
                    head_pitch=-4.0, tail_lift=-11.0, tail_tip=-6.0, arm_l=10.0, arm_r=10.0, elbow_l=34.0,
                    elbow_r=34.0, hand_l=24.0, hand_r=24.0, meta_l=10.0, meta_r=10.0)
    rebound = st.but(pelvis=(0.0, 0.0, p0['pelvis'][2] - 0.06), pitch=-2.0, neck_pitch=-2.0, head_pitch=8.0,
                     tail_lift=8.0, tail_tip=6.0, elbow_l=20.0, elbow_r=20.0)
    settle = st.but(pelvis=(0.0, 0.0, p0['pelvis'][2] - 0.07), pitch=-3.6, head_pitch=4.0, tail_lift=-2.0)
    return timeline([(0.0, contact, 'out'), (0.09, impact, 'out'), (0.22, rebound, 'inout'),
                     (0.34, settle, 'inout'), (LAND_FRAMES / FPS, st, 'linear')], LAND_FRAMES)


# ------------------------------------------------------------------ the set
CLIPS = {
    # name: (builder, loops)
    'Idle': (lambda rig: idle(rig), True),
    'Walk': (lambda rig: walk(rig)[0], True),
    'Run': (lambda rig: run(rig)[0], True),
    'WalkBack': (lambda rig: walk_back(rig)[0], True),
    'Jump': (lambda rig: jump(rig), False),
    'Land': (lambda rig: land(rig), False),
}
GAITS = {'Walk': lambda rig: walk(rig)[1], 'Run': lambda rig: run(rig)[1], 'WalkBack': lambda rig: walk_back(rig)[1]}


def make_clips(arm, rig, only=None):
    import keys as K
    stats = {}
    for name, (fn, loops) in CLIPS.items():
        if only and name not in only:
            continue
        act, st = K.make_action(arm, rig, name, fn(rig), fps=FPS, loop=loops)
        stats[name] = dict(st, seconds=round(st['frames'] / FPS, 4), loop=loops)
    return stats
