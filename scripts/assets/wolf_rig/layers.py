"""The tail and the ears: the layers authored over the transferred body.

TAIL. Each frame has a GOAL pose: the tail's own resting curl, carried a little by
what the old clip did with its tail (how far it lifted, dropped or swept it against
its idle carriage, read in the hips' frame, scaled down, clamped and smoothed in
clips.py / animate.py), plus a gentle sway where a clip wants one. The bones then
FOLLOW their goals with drag: every frame each bone turns part of the way toward
its goal direction, the base almost all the way, the tip less, so the tail trails
the body's motion and settles without ever overshooting. A spring chain did the
follow-through first and whipped on the fast clips; a lag cannot. No joint passes
through the ground: the check is the brush's own skin as the game blends it
(tail_skin), which hangs a quarter of a unit off the bones. A loop is run three
cycles and the last one is
sealed (what the cycle fails to close is spread back over it), so a looping tail
never pops.

EARS. Each ear folds back (or perks forward) about the head's cross axis and swivels
about its length on a per-clip curve; its tip follows with the same drag.
"""
import math

import numpy as np
from mathutils import Matrix, Quaternion, Vector

import motion

FPS = 30
TAIL = [f'Tail{i}' for i in range(1, 7)]
# how much of the carriage each tail bone takes (cumulative toward the tip)
TAIL_SHARE = np.array([0.30, 0.24, 0.18, 0.12, 0.09, 0.07])
# how far each tail bone turns toward its goal per frame (1 = rigid), in the hips' frame
TAIL_FOLLOW = np.array([0.9, 0.75, 0.62, 0.52, 0.44, 0.38])
# how much of each bone's world direction carries over from the last frame (trailing)
TAIL_INERTIA = np.array([0.0, 0.04, 0.08, 0.12, 0.16, 0.2])
TAIL_LIFT_MAX = 45.0   # a bone clearing the floor turns up at most to this elevation (degrees)
EAR_FOLLOW = 0.55


# ------------------------------------------------------------------ helpers
def curve(keys, t):
    """Smooth (cosine-eased) interpolation through (time, value) keys; clamped ends."""
    if not keys:
        return 0.0
    if t <= keys[0][0]:
        return keys[0][1]
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            u = (t - t0) / max(1e-9, t1 - t0)
            u = 0.5 - 0.5 * math.cos(math.pi * u)
            return v0 + (v1 - v0) * u
    return keys[-1][1]


def swing(frm, to):
    if frm.length < 1e-9 or to.length < 1e-9:
        return Quaternion()
    return frm.normalized().rotation_difference(to.normalized())


def toward(cur, goal, k):
    """Turn unit direction `cur` the fraction k of the way to `goal`."""
    return Quaternion().slerp(swing(cur, goal), k) @ cur


def rel(arm, name):
    b = arm.data.bones[name]
    return b.parent.matrix_local.inverted() @ b.matrix_local


def turn_of(P, arm, name):
    """A bone's turn away from its rest orientation, in armature space."""
    return P[name].to_quaternion() @ arm.data.bones[name].matrix_local.to_quaternion().inverted()


def wrap(deg):
    return (deg + 180.0) % 360.0 - 180.0


def seal(dirs):
    """Close a looping direction track: spread the end-to-start residual back over
    the cycle (the last frame then equals the first)."""
    K = len(dirs) - 1
    for i in range(len(dirs[0])):
        r = swing(dirs[K][i], dirs[0][i])
        for f in range(1, K + 1):
            dirs[f][i] = Quaternion().slerp(r, f / K) @ dirs[f][i]
    return dirs


# ------------------------------------------------------------------ the old clip's intent
def _tip(old_arm, F, name):
    return F[name] @ Vector((0.0, old_arm.data.bones[name].length, 0.0))


def _rest_aligned(old_arm, F, frame_bone, v):
    turn = F[frame_bone].to_quaternion() @ old_arm.data.bones[frame_bone].matrix_local.to_quaternion().inverted()
    return turn.inverted() @ v


def _pitch_yaw(v):
    return math.degrees(math.atan2(v.z, math.hypot(v.x, v.y))), math.degrees(math.atan2(v.x, v.y))


def raw_intent(old_arm, frames):
    rows = []
    for F in frames:
        tail = _rest_aligned(old_arm, F, 'Hips', _tip(old_arm, F, 'Tail_Tip') - F['Tail_Base'].to_translation())
        rows.append(_pitch_yaw(tail))
    return np.array(rows)


def intent(old_arm, frames, idle_raw):
    """Per frame: the old tail's pitch (+ raised) and yaw (+ toward the wolf's left)
    against its idle carriage, in degrees."""
    ref = idle_raw.mean(axis=0)
    A = raw_intent(old_arm, frames)
    pitch = A[:, 0] - ref[0]
    yaw = np.array([wrap(v) for v in (A[:, 1] - ref[1])])
    return pitch, yaw


# ------------------------------------------------------------------ ears
def apply_ears(arm, poses, fold_deg, swivel_deg, loop, sides=('L', 'R')):
    """fold: + lays the ears back, - perks them forward. swivel: + turns the
    openings outward. The tips follow the bases with drag."""
    for side, sgn in (('L', 1.0), ('R', -1.0)):
        if side not in sides:
            continue
        ear, tip = f'Ear_{side}', f'EarTip_{side}'
        r_ear, r_tip = rel(arm, ear), rel(arm, tip)
        rest_q = arm.data.bones[ear].matrix_local.to_quaternion()
        goals = []
        for P, fold, sw in zip(poses, fold_deg, swivel_deg):
            head_turn = turn_of(P, arm, 'Head')
            pos = (P['Head'] @ r_ear).to_translation()
            q = head_turn @ Quaternion((1, 0, 0), math.radians(-fold)) @ rest_q @ \
                Quaternion((0, 1, 0), math.radians(sw * sgn))
            P[ear] = Matrix.LocRotScale(pos, q, None)
            goals.append(P[ear] @ r_tip)
        dirs = _follow([[g.to_quaternion() @ Vector((0, 1, 0))] for g in goals], [EAR_FOLLOW], loop)
        for P, g, d in zip(poses, goals, dirs):
            gq = g.to_quaternion()
            P[tip] = Matrix.LocRotScale(g.to_translation(), swing(gq @ Vector((0, 1, 0)), d[0]) @ gq, None)


# ------------------------------------------------------------------ drag
def _follow(goal_dirs, follow, loop, chain=None):
    """Lag each direction toward its goal, frame by frame. `chain` (optional) is a
    callback that may correct one frame's directions (the ground)."""
    n = len(goal_dirs)
    state = [Vector(d) for d in goal_dirs[0]]

    def step(f):
        nonlocal state
        state = [toward(state[i], goal_dirs[f][i], follow[i]) for i in range(len(state))]
        if chain:
            state = chain(f, state)
        return [Vector(d) for d in state]

    if not loop:
        return [step(f) for f in range(n)]
    K = n - 1
    out = []
    for cycle in range(3):
        rec = []
        for f in range(K):
            rec.append(step(f))
        out = rec
    out.append([Vector(d) for d in step(0)])  # the cycle's end, = frame 0 once sealed
    return seal(out)


# ------------------------------------------------------------------ tail
def tail_goal(arm, P, pitch, yaw):
    """The goal chain for one frame: rest curl carried by (pitch, yaw) degrees,
    the share growing toward the tip. Returns the base joint and bone turns."""
    bones = arm.data.bones
    base = (P['Pelvis'] @ rel(arm, 'Tail1')).to_translation()
    body = turn_of(P, arm, 'Pelvis')
    quats = []
    cum = 0.0
    for i, name in enumerate(TAIL):
        cum += TAIL_SHARE[i]
        c = Quaternion((0, 0, 1), math.radians(-yaw * cum)) @ Quaternion((1, 0, 0), math.radians(pitch * cum))
        quats.append(body @ c @ bones[name].matrix_local.to_quaternion())
    return base, quats


# A limp tail drapes: each bone heads down off the rump (the base steeply, the tip
# barely) and away from the body, and the ground lays it along the floor. Aimed in
# the WORLD, not the hips' frame: a wolf dead on its back would otherwise point its
# "drooping" tail at the sky.
DRAPE_DOWN = np.array([1.6, 1.1, 0.7, 0.45, 0.3, 0.2])


def drape_dirs(arm, P, fallback):
    away = (P['Tail1'].to_translation() if 'Tail1' in P else (P['Pelvis'] @ rel(arm, 'Tail1')).to_translation()) \
        - P['Pelvis'].to_translation()
    away.z = 0.0
    if away.length < 1e-4:
        away = Vector((fallback.x, fallback.y, 0.0))
    away.normalize()
    return [(away + Vector((0.0, 0.0, -k))).normalized() for k in DRAPE_DOWN]


def tail_skin(arm, body, inner=0.35):
    """The tail's skin for the floor check: every vertex a tail bone holds the most
    of, with ALL its weights (motion.skin_low's packing: it is skinned the way the
    game blends it), plus which tail bone owns it and whether it sits in the ring
    round that bone's root (the inner `inner` of its length).

    Per tail bone i, the check watches the skin bone i moves: its own and all of
    the tail beyond it. Watching skin a bone cannot lift (the bones before it) sent
    it to its lift limit and kinked the tail. Bone 1's root ring is the rump, which
    no tail turn can lift."""
    names = {g.index: g.name for g in body.vertex_groups}
    M = body.matrix_world
    rows, owner, ring = [], [], []
    for v in body.data.vertices:
        if not v.groups:
            continue
        top = names[max(v.groups, key=lambda g: g.weight).group]
        if top not in TAIL:
            continue
        bone = arm.data.bones[top]
        w = M @ v.co
        rows.append((w, [(names[g.group], g.weight) for g in v.groups if g.weight > 0.0]))
        owner.append(TAIL.index(top))
        ring.append((bone.matrix_local.inverted() @ w).y < inner * bone.length)
    bones, W, local = motion._skin_rows(arm, rows)
    owner, ring = np.array(owner), np.array(ring)
    watch = [(owner >= i) & ~((owner == 0) & ring) for i in range(len(TAIL))]
    return bones, W, local, watch


def apply_tail(arm, poses, pitch, yaw, loop, ground_z, skin, follow_scale=None, limp=None):
    """The drag works in the hips' frame: the tail turns WITH the body (a body that
    pitches hard, rearing in the Jump or rolling in the Death, must not whip it), and
    eases toward each new carriage; only a touch of world inertia, growing toward
    the tip, trails the body's own motion. `limp` (per frame, 0..1) hands the goal
    over to the drape. `skin` is tail_skin's, kept above the floor."""
    lengths = [arm.data.bones[n].length for n in TAIL]
    goals = [tail_goal(arm, P, p, y) for P, p, y in zip(poses, pitch, yaw)]
    goal_dirs = [[q @ Vector((0, 1, 0)) for q in gq] for _base, gq in goals]
    if limp is not None:
        for f, lm in enumerate(limp):
            if lm <= 0.0:
                continue
            drape = drape_dirs(arm, poses[f], goal_dirs[f][0])
            goal_dirs[f] = [toward(g, d, float(lm)) for g, d in zip(goal_dirs[f], drape)]
    bodies = [turn_of(P, arm, 'Pelvis') for P in poses]
    scale = np.ones(len(poses)) if follow_scale is None else np.asarray(follow_scale, float)
    n = len(poses)
    up = Vector((0.0, 0.0, 1.0))
    lift_max = math.radians(TAIL_LIFT_MAX)
    s_bones, s_W, s_local, watch = skin
    s_tail = [TAIL.index(b) if b in TAIL else -1 for b in s_bones]

    def skin_low(f, dirs, m):
        """The lowest point of the watched skin `m` with the tail heading `dirs`."""
        rows, x = [], goals[f][0]
        for k, d in enumerate(dirs):
            gq = goals[f][1][k]
            R = (swing(gq @ Vector((0, 1, 0)), d) @ gq).to_matrix()
            rows.append(np.array((R[2][0], R[2][1], R[2][2], x.z)))
            x = x + d * lengths[k]
        z = np.zeros(int(m.sum()))
        for j, b in enumerate(s_bones):
            row = rows[s_tail[j]] if s_tail[j] >= 0 else np.array(poses[f][b])[2]
            z += s_W[m, j] * (s_local[j][m] @ row)
        return float(z.min()) if len(z) else ground_z

    def flat(f, k, d):
        """Bone k heading d, raised to level if it points down."""
        if d.z >= 0.0:
            return d
        h = Vector((d.x, d.y, 0.0))
        if h.length < 1e-6:
            h = Vector((goal_dirs[f][k].x, goal_dirs[f][k].y, 0.0))
        return h.normalized() if h.length > 1e-6 else Vector((0.0, 1.0, 0.0))

    def lift(f, i, d, lowest):
        """Bone i heading d turned up in its own vertical plane, as little as makes
        lowest(direction) clear the floor (or as near as the lift limit allows)."""
        if lowest(d) >= ground_z:
            return d
        h = Vector((d.x, d.y, 0.0))
        if h.length < 1e-6:
            h = Vector((goal_dirs[f][i].x, goal_dirs[f][i].y, 0.0))
        h = h.normalized() if h.length > 1e-6 else Vector((0.0, 1.0, 0.0))
        lo = math.atan2(d.z, math.hypot(d.x, d.y))
        hi = max(lo, lift_max)

        def at(a):
            return h * math.cos(a) + up * math.sin(a)

        if lowest(at(hi)) >= ground_z:
            for _ in range(14):
                mid = 0.5 * (lo + hi)
                if lowest(at(mid)) < ground_z:
                    lo = mid
                else:
                    hi = mid
        else:  # no lift clears it: take the one that comes closest
            hi = max((lo + (hi - lo) * k / 8.0 for k in range(9)), key=lambda a: lowest(at(a)))
        return at(hi).normalized()

    def ground(f, dirs):
        """Turn each bone (root to tip) up in its own vertical plane, as little as
        clears its skin off the floor AND leaves the rest of the tail room to lie
        level along it: each bone comes down only as far as the bones after it
        can follow. Clearing one bone at a time instead let the root dive at the
        floor and left the next bone no room but straight up (a 100 degree kink
        where a sitting wolf's tail met the ground). A second sweep checks the tail
        as it finally lies (a tip that bent below level pulled the skin it shares
        with the bone before it a centimetre or two down)."""
        for lookahead in (True, False):
            for i in range(len(dirs)):
                def lowest(d, i=i, lookahead=lookahead):
                    later = [flat(f, k, dirs[k]) if lookahead else dirs[k] for k in range(i + 1, len(dirs))]
                    return skin_low(f, dirs[:i] + [d] + later, watch[i])

                dirs[i] = lift(f, i, dirs[i], lowest)
        return dirs

    world = [Vector(d) for d in goal_dirs[0]]
    local = [bodies[0].inverted() @ d for d in world]

    def step(f):
        nonlocal world, local
        inv = bodies[f].inverted()
        out = []
        for i in range(len(TAIL)):
            local[i] = toward(local[i], inv @ goal_dirs[f][i], TAIL_FOLLOW[i] * scale[f])
            carried = bodies[f] @ local[i]
            out.append(toward(world[i], carried, 1.0 - TAIL_INERTIA[i]))
        out = ground(f, out)
        world = out
        local = [inv @ d for d in out]
        return [Vector(d) for d in out]

    if not loop:
        dirs = [step(f) for f in range(n)]
    else:
        K = n - 1
        for _cycle in range(3):
            dirs = [step(f) for f in range(K)]
        dirs.append(step(0))
        dirs = seal(dirs)
    for P, (base, gq), d in zip(poses, goals, dirs):
        x = base.copy()
        for i, name in enumerate(TAIL):
            q = swing(gq[i] @ Vector((0, 1, 0)), d[i]) @ gq[i]
            P[name] = Matrix.LocRotScale(x, q, None)
            x = x + d[i] * lengths[i]
