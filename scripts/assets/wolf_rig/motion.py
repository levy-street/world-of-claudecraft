"""Carry the shipped clips from the old dog rig onto the new wolf skeleton.

The old skeleton fitted the body badly but its MOTION is the clip set the game has
always played, so every clip keeps its timing and its silhouette: each new bone
takes the turn its old counterpart made away from the rest pose (in armature
space, so the two rigs' different bone axes do not matter), and the Pelvis rides
rigidly on the old Hips. Two things are deliberately NOT copied:

- The old root lift. Every old clip raised the root bone 0.555 above the model's
  ground (the game hid it: it grounds a creature by its idle pose). The new Root
  never moves; the old Hips are read relative to the old root.
- The tail and the ears. The old ears and tail sat outside the body at rest (the
  tail ran straight back past the tail tip), so their turns are relative to a pose
  the body never had. Those layers are authored in layers.py from what the old
  clip MEANT (the tail's carriage), not copied. The old jaw is not carried at all:
  the mouth stays shut as modeled.

Timing. The old clips were keyed at 30 fps starting one frame in (t = 1/30), so in
three.js each loop held its first pose for a frame at the wrap. The new clips are
keyed from t = 0 at 30 fps over the same durations, and a loop's last key equals
its first: an open old loop (Walk, Sneak, Gallop: the cycle runs straight on into
its first key) is read one frame ahead and wrapped; a closed one (Idle) is
stretched one frame to fill the same duration.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

FPS = 30
# Blender's glTF importer puts a key at frame = t * (the scene's fps at import time).
# build.py imports at FPS; an interactive session that imported at 24 sets this to 24.
IMPORT_FPS = FPS

# new bone <- old bone (a turn from rest is copied)
MAP = {
    'Spine1': 'Spine_1', 'Spine2': 'Spine_2', 'Chest': 'Spine_2001',
    'Neck1': 'Spine_3', 'Neck2': 'Spine_4', 'Head': 'Head',
}
for _s in ('L', 'R'):
    MAP.update({
        f'Scapula_{_s}': f'Front_Leg_Shoulder_{_s}', f'Humerus_{_s}': f'Front_Leg_Upper_{_s}',
        f'Forearm_{_s}': f'Front_Leg_Lower_{_s}', f'FrontPastern_{_s}': f'Front_Leg_Ankle_{_s}',
        f'FrontPaw_{_s}': f'Front_Leg_Foot_{_s}',
        f'Thigh_{_s}': f'Back_Leg_Upper_{_s}', f'Shin_{_s}': f'Back_Leg_Lower_{_s}',
        f'HindPastern_{_s}': f'Back_Leg_Ankle_{_s}', f'HindPaw_{_s}': f'Back_Leg_Foot_{_s}',
    })


# ------------------------------------------------------------------ reading the old clip
def set_action(arm, act):
    ad = arm.animation_data_create()
    ad.action = act
    if hasattr(ad, 'action_slot') and act is not None and len(act.slots):
        ad.action_slot = act.slots[0]


def old_key_count(act):
    f0, f1 = act.frame_range
    return int(round((f1 - f0) * FPS / IMPORT_FPS)) + 1


def pose_at(arm, t):
    """Armature-space bone matrices of `arm` at old-clip time t, root lift removed."""
    f = t * IMPORT_FPS
    bpy.context.scene.frame_set(int(math.floor(f)), subframe=float(f - math.floor(f)))
    lift = arm.pose.bones['root'].matrix.to_translation() - arm.data.bones['root'].matrix_local.to_translation()
    drop = Matrix.Translation(-lift)
    return {pb.name: drop @ pb.matrix for pb in arm.pose.bones}


def quat_angle(a, b):
    return math.degrees(2 * math.acos(min(1.0, abs((a @ b.inverted()).w))))


def reference(old_arm, act, loop):
    """Old poses for every new key (t = 0 .. T at 30 fps). Returns (T, frames)."""
    set_action(old_arm, act)
    K = old_key_count(act)
    T = K / FPS
    first, last = pose_at(old_arm, 1 / FPS), pose_at(old_arm, K / FPS)
    closed = max(quat_angle(first[n].to_quaternion(), last[n].to_quaternion()) for n in first) < 1.0
    frames = []
    for k in range(K + 1):
        tau = k / FPS
        if not loop:
            t = max(tau, 1 / FPS)
        elif closed:
            t = 1 / FPS + tau * (K - 1) / K
        else:
            t = 1 / FPS + tau
            if t > T + 1e-9:
                t -= T
        frames.append(pose_at(old_arm, t))
    if loop:
        frames[-1] = frames[0]
    return T, frames, closed


def clear_ground(old_arm, frames, baselines, paw_slack=0.15, nose_clear=0.1, sigma=2.5):
    """Lift a one-shot clip's old body so it never goes through the floor.

    The old Jump keeps its hips at one height the whole clip and pivots the body
    about them, so its landing dive put the forepaws 0.67 below the ground and the
    nose deeper still; on a rig whose paws must stay on the ground that crushed the
    legs up under the face. Every old bone is raised (smoothly) by whatever the
    frame needs to keep the paws within `paw_slack` of their ground and the nose
    `nose_clear` above it. Ordinary clips need nothing and are returned untouched."""
    ground = min(baselines.values()) - 0.05  # the old pad joints stand ~5 cm off the floor
    need = []
    for F in frames:
        paws = max(baselines[leg] - F[LEGS[leg][4]].to_translation().z - paw_slack for leg in LEGS)
        nose = (F['Headtip'] @ Vector((0.0, old_arm.data.bones['Headtip'].length, 0.0))).z
        need.append(max(0.0, paws, ground + nose_clear - nose))
    need = np.array(need)
    if need.max() < 1e-3:
        return frames
    lift = np.maximum(_smooth_series(need, sigma, False), need)
    return [{n: Matrix.Translation((0.0, 0.0, float(h))) @ m for n, m in F.items()} for F, h in zip(frames, lift)]


# ------------------------------------------------------------------ transfer
def hierarchy(arm):
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)

    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return out


# The old shoulder bone swung far further than a shoulder blade does (the Jump lifts
# it so far the chest folded into the face); the new Scapula takes this share of its
# turn and the leg's IK reaches the paw's path with the rest of the leg.
SCAPULA_SHARE = 0.55


def transfer(new_arm, old_arm, frames):
    """Posed armature-space matrices of the new rig for every reference frame."""
    rest_old = {b.name: b.matrix_local.copy() for b in old_arm.data.bones}
    rest_new = {b.name: b.matrix_local.copy() for b in new_arm.data.bones}
    rel = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy()
           for b in new_arm.data.bones}
    hips_rest_inv = rest_old['Hips'].inverted()
    order = hierarchy(new_arm)
    out = []
    for P_old in frames:
        P = {}
        for n in order:
            bone = new_arm.data.bones[n]
            if bone.parent is None:
                P[n] = rest_new[n].copy()
                continue
            follow = P[bone.parent.name] @ rel[n]
            if n == 'Pelvis':
                P[n] = (P_old['Hips'] @ hips_rest_inv) @ rest_new[n]
            elif n in MAP:
                o = MAP[n]
                turn = P_old[o].to_quaternion() @ rest_old[o].to_quaternion().inverted()
                if n.startswith('Scapula'):
                    # damp the swing relative to the chest, not the world
                    chest = P['Chest'].to_quaternion() @ rest_new['Chest'].to_quaternion().inverted()
                    own = chest.inverted() @ turn
                    turn = chest @ Quaternion().slerp(own, SCAPULA_SHARE)
                P[n] = Matrix.LocRotScale(follow.to_translation(), turn @ rest_new[n].to_quaternion(), None)
            else:
                P[n] = follow
        out.append(P)
    return out


def rehang(new_arm, P, names):
    """Re-seat `names` (in hierarchy order) on their parents' posed tails, keeping
    each one's armature-space turn: what a leg's lower segments need after an IK
    change above them."""
    for n in names:
        b = new_arm.data.bones[n]
        rel = b.parent.matrix_local.inverted() @ b.matrix_local
        pos = (P[b.parent.name] @ rel).to_translation()
        P[n] = Matrix.LocRotScale(pos, P[n].to_quaternion(), None)


def descendants(arm, name):
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)

    walk(arm.data.bones[name])
    return out


def turn_subtree(arm, P, name, q, pivot=None):
    """Turn a bone and everything below it about the bone's head (or `pivot`)."""
    h = P[name].to_translation() if pivot is None else pivot
    M = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h)
    for n in descendants(arm, name):
        P[n] = M @ P[n]


def shift_subtree(arm, P, name, v):
    M = Matrix.Translation(v)
    for n in descendants(arm, name):
        P[n] = M @ P[n]


# ------------------------------------------------------------------ planting the paws
# Each leg: (upper, middle, lower, paw) on the new rig, and the old bone whose head
# is the same point of the paw (the pad joint) on the old rig.
LEGS = {}
for _s in ('L', 'R'):
    LEGS[f'front_{_s}'] = (f'Humerus_{_s}', f'Forearm_{_s}', f'FrontPastern_{_s}', f'FrontPaw_{_s}',
                           f'Front_Leg_Foot_{_s}')
    LEGS[f'hind_{_s}'] = (f'Thigh_{_s}', f'Shin_{_s}', f'HindPastern_{_s}', f'HindPaw_{_s}',
                          f'Back_Leg_Foot_{_s}')


def _swing(frm, to):
    """The smallest turn taking direction frm onto direction to."""
    return frm.normalized().rotation_difference(to.normalized())


def two_bone(A, B0, C, l1, l2):
    """Knee/elbow position for a two-bone chain from A reaching C, bending on the
    side the reference joint B0 bends (its pole)."""
    AC = C - A
    d = AC.length
    d = min(max(d, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    u = AC.normalized()
    side = (B0 - A) - u * (B0 - A).dot(u)
    if side.length < 1e-6:
        side = u.orthogonal()
    v = side.normalized()
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    return A + (u * ca + v * sa) * l1, A + u * d


def _skin_rows(new_arm, rows):
    """Pack skin points [(world rest position, [(bone, weight)])] for skin_low."""
    rest = {b.name: b.matrix_local for b in new_arm.data.bones}
    bones = sorted({b for _, ws in rows for b, _ in ws})
    n = len(rows)
    W = np.zeros((n, len(bones)))
    local = np.zeros((len(bones), n, 4))
    for i, (_w, ws) in enumerate(rows):
        total = sum(x for _, x in ws) or 1.0
        for b, x in ws:
            W[i, bones.index(b)] = x / total
    for j, b in enumerate(bones):
        inv = np.array(rest[b].inverted())
        for i, (w, _ws) in enumerate(rows):
            local[j, i] = inv @ np.array((w.x, w.y, w.z, 1.0))
    return bones, W, local


def paw_skin(new_arm, body, ground_z, margin=0.03):
    """Per leg, the skin the floor checks watch, each point kept with ALL its
    weights so it is skinned the way the game does (a linear blend; a rigid
    estimate missed how far a folded hock lifts the heel, and a sitting wolf's hind
    paws floated 3 cm while it said they were down):
      'sole'  the points under the paw that touch the ground at rest
      'limb'  the shin or forearm and the pastern (the paw itself is the sole's:
              opening a hock cannot lift a toe, and counting Greyjaw's claws here
              snapped his standing hock straight)"""
    names = {g.index: g.name for g in body.vertex_groups}
    M = body.matrix_world
    out = {}
    for leg, (_up, mid, low, paw, _old) in LEGS.items():
        sole, limb = [], []
        for v in body.data.vertices:
            if not v.groups:
                continue
            owner = names[max(v.groups, key=lambda g: g.weight).group]
            if owner not in (mid, low, paw):
                continue
            w = M @ v.co
            row = (w, [(names[g.group], g.weight) for g in v.groups if g.weight > 0.0])
            if owner != paw:
                limb.append(row)
            if owner != mid and w.z < ground_z + margin:
                sole.append(row)
        out[leg] = {'sole': _skin_rows(new_arm, sole), 'limb': _skin_rows(new_arm, limb)}
    return out


TORSO = ('Pelvis', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head')


def torso_skin(new_arm, body):
    """The skin of the trunk, neck and head, the shoulders and the haunches (every
    point a body bone, a scapula, a humerus or a thigh holds the most of), packed
    for skin_low: the body itself never goes through the floor either."""
    names = {g.index: g.name for g in body.vertex_groups}
    keep = set(TORSO) | {f'{b}_{s}' for b in ('Scapula', 'Humerus', 'Thigh') for s in ('L', 'R')}
    M = body.matrix_world
    rows = []
    for v in body.data.vertices:
        if v.groups and names[max(v.groups, key=lambda g: g.weight).group] in keep:
            rows.append((M @ v.co, [(names[g.group], g.weight) for g in v.groups if g.weight > 0.0]))
    return _skin_rows(new_arm, rows)


def skin_low(P, pts):
    """The lowest skinned height of a set of skin points in posed frame P."""
    bones, W, local = pts
    if not bones:
        return None
    z = np.zeros(W.shape[0])
    for j, b in enumerate(bones):
        row = np.array(P[b])[2]
        z += W[:, j] * (local[j] @ row)
    return float(z.min())


def leg_baselines(old_arm, idle_frames):
    """The old pad joints' height while standing in Idle: the old clips' ground."""
    out = {}
    for leg, (*_, old_pad) in LEGS.items():
        out[leg] = min(f[old_pad].to_translation().z for f in idle_frames)
    return out


# Every leg joint bends about the body's cross axis (the Chest's for a front leg,
# the Pelvis's for a hind leg). An elbow sits on the same side of its leg's reach
# (the line from the shoulder to the paw) whichever way the leg points, as a hinge
# does: behind it for a leg reaching down, under it for a leg reaching forward; a
# knee the other way. (An elbow aimed at a fixed "back" in the chest's frame could
# not choose between up and down when the Jump's forelegs reached straight forward,
# and flipped 126 degrees in a frame.) The wrist and the hock keep the old clip's
# bend, held inside these limits (degrees about the cross axis; + folds a front paw
# back, - closes a hock), so neither can fold the wrong way or open past straight.
# The old leg bones sat elsewhere, so copying their turns and then reaching for the
# paw with the upper leg alone left the lower joints' angles to drift across: the
# Gallop's wrists flipped forward and the Howl's hocks opened past straight.
LEG_HINGE = {'front': 'Chest', 'hind': 'Pelvis'}
BEND_SIDE = {'front': 1.0, 'hind': -1.0}   # the elbow / knee lies at side * (cross axis x reach)
LOW_LIMITS = {'front': (-35.0, 125.0), 'hind': (-155.0, -12.0)}
FOLD_SIGN = {'front': 1.0, 'hind': -1.0}   # which way the wrist / hock folds the paw in
Y_AXIS = Vector((0.0, 1.0, 0.0))
# The wrist/hock bend the clip asks for is changed only as far as the paw's target
# needs. NEAR: in the Gallop's tuck the old paw came within 0.2 of the old shoulder,
# and this forearm is longer than its upper arm, so at the clip's wrist bend the
# IK stood the upper arm up past the shoulder (the elbow at the withers) and then
# snapped it back down; the wrist now folds in, as a real one does, until the paw
# is in reach with the elbow no more than ELBOW_RISE_MAX degrees above level behind
# the shoulder (a knee: above level in front of the hip), about where the old
# clip's elbow went. FAR: late in a hind swing the clip's hock stayed folded while
# the paw reached forward for the ground, 33 cm out of reach, and snapped open at
# touch-down; the hock now opens until the paw is in reach. The fold is planned
# over the whole clip and eased (REACH_SMOOTH, frames): folding frame by frame
# snapped a wrist 76 degrees as the Sneak's paw came 9 cm nearer the shoulder.
# Only the hard limits (the paw in reach at all) are held frame by frame after that.
REACH_MARGIN = 0.06
REACH_SMOOTH = 1.5
ELBOW_RISE_MAX = 0.0


def _lower_len(lm, ll, theta):
    """The straight-line length of the lower leg (middle bone + pastern) at bend theta."""
    return math.sqrt(max(0.0, lm * lm + ll * ll + 2.0 * lm * ll * math.cos(math.radians(theta))))


def _bend_for(lm, ll, c):
    """The bend (degrees, 0..180) at which the lower leg is c long."""
    return math.degrees(math.acos(min(1.0, max(-1.0, (c * c - lm * lm - ll * ll) / (2.0 * lm * ll)))))


def _bend_to_reach(kind, theta, r, L, lo, hi, body=None):
    """The wrist/hock bend `theta` for a target at `r` from the leg root (see
    above). With the hinge bone's turn `body`, the elbow or knee is also kept from
    rising; without it only the hard limits hold."""
    l1, lm, ll = L['l_up'], L['l_mid'], L['l_low']
    s = FOLD_SIGN[kind]
    fold = s * theta  # + folds the paw in
    d = r.length
    near = l1 + d - REACH_MARGIN
    if body is not None and d > 1e-6:
        level = body @ Vector((0.0, BEND_SIDE[kind], 0.0))  # behind an elbow, before a knee
        up = body @ Vector((0.0, 0.0, 1.0))
        room = ELBOW_RISE_MAX - math.degrees(math.atan2(r.dot(up), r.dot(level)))
        if 0.0 <= room <= 180.0:  # the upper bone may turn this far off the reach
            near = min(near, math.sqrt(max(0.0, l1 * l1 + d * d - 2.0 * l1 * d * math.cos(math.radians(room)))))
    if _lower_len(lm, ll, theta) > near:
        fold = max(fold, _bend_for(lm, ll, near) if near > 0.0 else 180.0)
    far = d - l1
    if _lower_len(lm, ll, fold) < far:
        fold = math.copysign(min(abs(fold), _bend_for(lm, ll, far)), fold)
    return min(max(s * fold, lo), hi)


# The old clips' wrists and hocks flicked: the Gallop's front wrists swung 110
# degrees in one frame at lift-off. Each leg's bend is eased over its neighbours
# (sigma, frames) before the IK uses it.
BEND_SMOOTH = 1.0


def _bend_series(new_arm, poses, leg, loop):
    """Per frame, the wrist/hock bend the transferred clip asks for: inside the
    joint limits, unwrapped, eased over BEND_SMOOTH frames."""
    kind = leg.split('_')[0]
    _up, mid, low, _paw, _old = LEGS[leg]
    bones = new_arm.data.bones
    hinge = LEG_HINGE[kind]
    lo, hi = LOW_LIMITS[kind]
    raw = []
    for P in poses:
        body = P[hinge].to_quaternion() @ bones[hinge].matrix_local.to_quaternion().inverted()
        n = body @ Vector((1.0, 0.0, 0.0))
        raw.append(_signed(P[mid].to_quaternion() @ Y_AXIS, P[low].to_quaternion() @ Y_AXIS, n))
    raw = np.clip(np.degrees(np.unwrap(np.radians(raw))), lo, hi)
    return np.clip(_smooth_series(raw, BEND_SMOOTH, loop), lo, hi)


def _signed(a, b, n):
    """Signed angle in degrees turning direction a onto b about axis n."""
    a, b = a.normalized(), b.normalized()
    return math.degrees(math.atan2(a.cross(b).dot(n), a.dot(b)))


def _bend_side(kind, n, S, aim):
    """Where an elbow or knee lies off the reach from S toward `aim` (a point)."""
    u = aim - S
    if u.length < 1e-9:
        u = Vector((0.0, 0.0, -1.0))
    side = n.cross(u.normalized()) * BEND_SIDE[kind]
    return side if side.length > 1e-6 else n.orthogonal()


# The paw keeps the old clip's curl against the pastern, eased the same way (sigma,
# frames): the old paw bones flicked up to 50 degrees a frame, hidden in game by
# skin that rode the forearm instead.
CURL_SMOOTH = 1.0


def _curl_series(poses, leg, loop):
    """Per frame, the paw's turn against its pastern in the transferred clip, eased."""
    _up, _mid, low, paw, _old = LEGS[leg]
    qs = []
    for P in poses:
        q = P[low].to_quaternion().inverted() @ P[paw].to_quaternion()
        if qs and q.dot(qs[-1]) < 0.0:
            q = Quaternion((-q.w, -q.x, -q.y, -q.z))
        qs.append(q)
    Q = np.array([tuple(q) for q in qs])
    if loop and Q[-1].dot(Q[0]) < 0.0:
        Q[-1] = -Q[-1]
    eased = np.column_stack([_smooth_series(Q[:, c], CURL_SMOOTH, loop) for c in range(4)])
    return [Quaternion(tuple(q)).normalized() for q in eased]


def _solve_leg(new_arm, P, leg, target, L, plant, flat_q, yaw=None, stand=False, open_deg=0.0, bend=None,
               curl=None):
    """Pose one leg so its pad joint lands on `target`. Returns the miss distance.

    The wrist/hock keeps the old clip's bend (`bend`, eased: _bend_series; inside
    its limits, opened toward straight by `open_deg`, and folded or opened as far
    as the reach needs: _bend_to_reach) and the upper two bones reach for the pad.
    A planted paw in a gait (`stand`) turns the pastern from there toward its
    standing angle (turned with the body) as far as it is planted (`plant`, which
    eases in and out over a stride's contact), so the whole pad lies on the ground
    as it does at rest: kept at the old bend, a planted hind heel dipped 5 cm into
    the floor and the floor check then lifted the toes off it. (A sitting wolf's
    hind feet lie flat along the ground, so outside a gait the old bend stands.)"""
    up, mid, low, paw, _old = LEGS[leg]
    kind = leg.split('_')[0]
    bones = new_arm.data.bones
    hinge = LEG_HINGE[kind]
    body = P[hinge].to_quaternion() @ bones[hinge].matrix_local.to_quaternion().inverted()
    n = body @ Vector((1.0, 0.0, 0.0))
    q_up0, q_mid0, q_low0, q_paw0 = (P[b].to_quaternion() for b in (up, mid, low, paw))
    d_up0, d_mid0, d_low0 = (q @ Y_AXIS for q in (q_up0, q_mid0, q_low0))
    lo, hi = LOW_LIMITS[kind]
    lm, ll = L['l_mid'], L['l_low']
    S = P[up].to_translation()
    # the leg in the air: the clip's bend (planned by plant_legs, or read off the
    # pose), and the upper bone and the lower leg (as one rigid piece) reaching for
    # the pad
    if bend is None:
        theta = _bend_to_reach(kind, min(max(_signed(d_mid0, d_low0, n), lo), hi), target - S, L, lo, hi, body)
    else:
        theta = _bend_to_reach(kind, min(max(bend, lo), hi), target - S, L, lo, hi)
    if open_deg > 0.0:
        theta = math.copysign(max(abs(theta) - open_deg, 0.0), theta)
        theta = min(max(theta, lo), hi)
    rad = math.radians(theta)
    cx, cy = lm + ll * math.cos(rad), ll * math.sin(rad)
    alpha = math.degrees(math.atan2(cy, cx))
    side = _bend_side(kind, n, S, target)
    E, T = two_bone(S, S + side, target, L['l_up'], math.hypot(cx, cy))
    u = (T - S).normalized()
    # the bend plane from the side (as two_bone bends), never from the elbow: a leg
    # reaching its full length has the elbow on the reach line, where the plane
    # through it turns at random from one frame to the next
    plane = u.cross(side - u * side.dot(u))
    if plane.length < 1e-6:
        plane = n.copy()
    plane.normalize()
    if plane.dot(n) < 0.0:
        plane.negate()
    d_mid = Quaternion(plane, math.radians(-alpha)) @ (T - E).normalized()
    d_low = Quaternion(plane, rad) @ d_mid
    miss = (T - target).length
    if stand and plant > 0.0:
        standing = (yaw or Quaternion()) @ L['low_rest_dir']
        d_low = Quaternion().slerp(_swing(d_low, standing), plant) @ d_low
        wrist = target - d_low * ll
        E, T = two_bone(S, S + _bend_side(kind, n, S, wrist), wrist, L['l_up'], lm)
        d_mid = (T - E).normalized()
        theta = _signed(d_mid, d_low, n)
        if theta < lo or theta > hi:  # never past a joint limit, even planted
            d_low = Quaternion(n, math.radians(min(max(theta, lo), hi) - theta)) @ d_low
        miss = ((T + d_low * ll) - target).length
    P[up] = Matrix.LocRotScale(S, _swing(d_up0, E - S) @ q_up0, None)
    P[mid] = Matrix.LocRotScale(E, _swing(d_mid0, d_mid) @ q_mid0, None)
    W = E + d_mid * lm
    q_low = _swing(d_low0, d_low) @ q_low0
    P[low] = Matrix.LocRotScale(W, q_low, None)
    q_paw = q_low @ (q_low0.inverted() @ q_paw0 if curl is None else curl)
    if plant > 0.0:
        q_paw = q_paw.slerp(flat_q, plant)
    P[paw] = Matrix.LocRotScale(W + d_low * ll, q_paw, None)
    return miss


STAND_DEADZONE = 0.035   # an old paw this close to its ground was standing (the old
STEP_GAIN = 1.3          # idle bobbed its paws 3 cm); real lifts keep their height
STEP_BOOST_MAX = 0.05    # ...but the gain adds at most this much (a 30% boost on the
                         # Gallop's 0.9 swing raised its forepaws to the shoulder)
GAIT_STEP_MIN = 0.035    # a gait's swing lifts at least this high at its peak


def _boost(h):
    """A paw lift `h` with the step gain applied, the gain capped."""
    return h + min(h * (STEP_GAIN - 1.0), STEP_BOOST_MAX)


def _gait_contacts(frames, old_pad):
    """Stance and swing of one paw in a looping gait, from the stride itself: the
    paw stands while it slides back under the body and swings while it travels
    forward (an in-place gait's ground passes backward). Standing frames sit on the
    ground; a swing lifts off, arcs and sets down, as high as the old swing went.
    Returns per frame (lift, plant, settle): plant is the contact itself (1 on the
    ground), settle eases it in and out over the frames either side (the paw
    flattens and the pastern stands over two frames, not one: switching in a frame
    snapped the Gallop's paws 74 degrees at touch-down). The last frame repeats
    the first."""
    n = len(frames)
    K = n - 1
    Y = np.array([F[old_pad].to_translation().y for F in frames[:K]])
    Z = np.array([F[old_pad].to_translation().z for F in frames[:K]])
    vy = (np.roll(Y, -1) - np.roll(Y, 1)) * 0.5
    stance = vy > 0.1 * np.abs(vy).max()
    for _ in range(2):  # drop one-frame blips either way
        prev, nxt = np.roll(stance, 1), np.roll(stance, -1)
        stance = np.where((prev == nxt) & (stance != prev), prev, stance)
    if stance.all() or not stance.any():
        flat = np.ones(n) if stance.all() else np.zeros(n)
        return np.zeros(n), flat, flat
    ground = Z[stance].min()
    lift = np.zeros(K)
    start = int(np.argmax(stance & ~np.roll(stance, -1))) + 1  # first frame after a stance
    f = start % K
    run = []
    for _ in range(K + 1):
        if not stance[f]:
            run.append(f)
        elif run:
            peak = max(GAIT_STEP_MIN, _boost(float(Z[run].max() - ground)))
            m = len(run)
            for k, g in enumerate(run):
                lift[g] = peak * math.sin(math.pi * (k + 1) / (m + 1))
            run = []
        f = (f + 1) % K
    plant = stance.astype(float)
    settle = 0.25 * np.roll(plant, 1) + 0.5 * plant + 0.25 * np.roll(plant, -1)
    return np.append(lift, lift[0]), np.append(plant, plant[0]), np.append(settle, settle[0])


def _smooth_series(v, sigma, loop):
    """Gaussian-smooth a per-frame series (wrapping for a loop, whose last frame
    repeats its first)."""
    v = np.asarray(v, float)
    if sigma <= 0 or len(v) < 3:
        return v
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    if loop:
        core = v[:-1]
        padded = np.concatenate([core[-r:], core, core[:r]])
        out = np.convolve(padded, k, mode='valid')
        return np.concatenate([out, out[:1]])
    padded = np.concatenate([np.full(r, v[0]), v, np.full(r, v[-1])])
    return np.convolve(padded, k, mode='valid')


# The old bone each new hinge bone (Chest / Pelvis) takes its turn from.
OLD_HINGE = {'front': 'Spine_2001', 'hind': 'Hips'}


# The old paws whipped between the Gallop's tuck and reach (a forepaw crossed 25 cm
# in a frame) where the old skin, weighted to the forearm rather than the paw,
# never showed it; on a rig whose paws carry their own skin that read as a flick.
# The swing path is eased over its neighbours (sigma, frames).
SWING_SMOOTH = 1.0


def _swing_offset(F, leg, L):
    """(turn, moved): the old chest's (hips') turn in frame F, and the old paw's
    change from its rest place against it, read in its own frame."""
    old_pad = LEGS[leg][4]
    hinge = F[L['old_hinge']]
    turn = hinge.to_quaternion() @ L['old_hinge_rest_q'].inverted()
    moved = turn.inverted() @ (F[old_pad].to_translation() - hinge.to_translation()) - L['old_hinge_to_pad']
    curl = turn.inverted() @ F[old_pad].to_quaternion() @ L['old_pad_rest_q'].inverted()
    return turn, moved + curl @ L['pad_gap'] - L['pad_gap']


def _untuck(S, target, turn, c):
    """A swinging paw kept from folding up against its shoulder: nearer than 2c it is
    let down, in the chest's frame, to the soft distance c + r^2 / 4c (equal to r at
    2c, never under c). Greyjaw's shoulder sits lower in his body than the pack
    wolf's, so the old Gallop's tuck brought his forepaw to within 8 cm of the joint
    and the upper arm flipped round it in a frame; let down, the paw tucks under the
    elbow instead. A paw above the shoulder is left alone (the clamp fades out over
    c / 2 above it)."""
    rel = turn.inverted() @ (target - S)
    r = rel.length
    if c <= 0.0 or r >= 2.0 * c:
        return target
    want = c + r * r / (4.0 * c)
    low = -math.sqrt(max(want * want - rel.x * rel.x - rel.y * rel.y, 0.0))
    fade = min(max(1.0 - rel.z / (0.5 * c), 0.0), 1.0)
    rel = Vector((rel.x, rel.y, rel.z + (min(rel.z, low) - rel.z) * fade))
    return S + turn @ rel


def _contact(pad, L, contact_lo, contact_hi):
    """(lift, plant) of a paw outside a gait: how far its old pad joint rose off its
    ground (boosted), and how planted that leaves it (1 on the ground, 0 lifted)."""
    lift = _boost(max(0.0, pad.z - L['baseline'] - STAND_DEADZONE))
    return lift, 1.0 - min(1.0, max(0.0, (lift - contact_lo) / (contact_hi - contact_lo)))


# Outside a gait the planting eases over its neighbours too (sigma, frames): a paw
# switching from lifted to planted in a frame flattened 48 degrees at once as the
# Jump landed.
SETTLE_SMOOTH = 1.0


def _leg_target(P, F, i, leg, L, contact_lo, contact_hi):
    """Where leg's pad joint goes in frame i: (target, lift, plant, settle, stand).

    A planted paw's target is on the GROUND (the old paw's path across it); a paw in
    the air follows the BODY instead: where the old paw was against the old chest
    (hips), as a change from rest read in the chest's (hips') own frame, carried by
    the new chest (hips). Both skeletons sit in the same mesh but the old shoulder
    joint was 23 cm lower in it, so following the old paw's offset from the old
    shoulder instead swung the Gallop's forepaws out in front of the chest where
    the old wolf kept them tucked under it. The two rigs' pad joints are different
    points of the same paw (22 cm apart), so the gap between them turns with the
    old paw as it curls, not with the chest. Pinning swinging paws to the ground too
    folded the Gallop's forelegs up into the face once the body came down."""
    up, _mid, _low, _paw, old_pad = LEGS[leg]
    pad = F[old_pad].to_translation()
    d = pad - L['old_rest_pad']
    if L['gait'] is not None:
        lift, plant, settle = (float(s[i]) for s in L['gait'])
    else:
        lift, plant = _contact(pad, L, contact_lo, contact_hi)
        settle = float(L['settle'][i]) if L.get('settle') is not None else plant
    on_ground = L['rest_pad'].copy()
    on_ground.x += d.x
    on_ground.y += d.y
    on_ground.z += lift
    turn, moved = _swing_offset(F, leg, L)
    if L.get('swing') is not None:
        moved = L['swing'][i]  # eased over the clip (plant_legs)
    from_root = P[L['hinge']].to_translation() + turn @ (L['hinge_to_pad'] + moved)
    target = from_root.lerp(on_ground, settle)
    stand = L['gait'] is not None
    if stand:
        target.z = on_ground.z  # a gait's paw height is its planned step, stance and swing
    # last, so it also governs a gait's planned step: Greyjaw's Gallop arc lifted
    # his forepaw to the height of his shoulder joint
    target = _untuck(P[up].to_translation(), target, turn, L['tuck'])
    return target, lift, plant, settle, stand


def _plant_frame(new_arm, P, F, i, legs, skin, ground_z, contact_lo, contact_hi):
    """Solve all four legs of frame i (targets: _leg_target). Returns how far the
    body must come down for every planted paw to reach the ground (0 when they all
    do). No part of a lower leg ever goes through the floor: a hind leg folded
    under the rearing body put the Death's hock 8 cm into it."""
    bones = new_arm.data.bones
    body = P['Pelvis'].to_quaternion() @ bones['Pelvis'].matrix_local.to_quaternion().inverted()
    yaw = Quaternion((0, 0, 1), body.to_euler('ZXY').z)
    need = 0.0
    for leg, L in legs.items():
        target, lift, plant, settle, stand = _leg_target(P, F, i, leg, L, contact_lo, contact_hi)
        flat = yaw @ L['paw_rest_q']
        bend, curl = float(L['bend'][i]), L['curl'][i]
        _solve_leg(new_arm, P, leg, target, L, settle, flat, yaw, stand, bend=bend, curl=curl)
        # Never through the floor, and a planted paw ON it: move the leg by whatever
        # the sole sinks (any paw) or floats (a planted one), scaled by the planting.
        low_z = skin_low(P, skin[leg]['sole'])
        for _ in range(3):
            if low_z is None:
                break
            gap = ground_z + (lift if stand else 0.0) - low_z
            if low_z < ground_z - 1e-4:
                fix = ground_z - low_z
            elif plant > 0.5 and abs(gap) > 1e-3:
                fix = gap * plant
            else:
                break
            target.z += fix
            _solve_leg(new_arm, P, leg, target, L, settle, flat, yaw, stand, bend=bend, curl=curl)
            low_z = skin_low(P, skin[leg]['sole'])
        # a planted paw the straightened leg could not bring down to the ground
        if plant > 0.5 and low_z is not None:
            need = max(need, low_z - ground_z - lift)
        # The rest of the lower leg stays above it too. A folded wrist or hock that
        # dips through first opens toward straight, as little as clears it, so the
        # paw keeps its path (raising the paw instead made the folded leg jump about
        # from frame to frame); only what opening cannot clear raises the paw.
        limb_z = skin_low(P, skin[leg]['limb'])
        opened = 0.0
        if limb_z is not None and limb_z < ground_z - 1e-3 and not stand:
            def clear(a):
                _solve_leg(new_arm, P, leg, target, L, settle, flat, yaw, stand, a, bend, curl)
                return skin_low(P, skin[leg]['limb']) >= ground_z - 1e-3
            lo_a, opened = 0.0, 180.0
            if clear(opened):
                for _ in range(10):
                    mid_a = 0.5 * (lo_a + opened)
                    if clear(mid_a):
                        opened = mid_a
                    else:
                        lo_a = mid_a
                clear(opened)
            limb_z = skin_low(P, skin[leg]['limb'])
        for _ in range(4):
            if limb_z is None or limb_z >= ground_z - 1e-3:
                break
            target.z += ground_z - limb_z
            _solve_leg(new_arm, P, leg, target, L, settle, flat, yaw, stand, opened, bend, curl)
            limb_z = skin_low(P, skin[leg]['limb'])
    return need


def plant_legs(new_arm, old_arm, poses, frames, baselines, skin, ground_z, loop=False, gait=False,
               contact_lo=0.004, contact_hi=0.03, tuck_min=0.0):
    """Make every paw follow its old paw's path, planted flat on the ground while
    the old paw stood (in a gait: while it slid back under the body), never through
    the ground, and down ON it: where a planted paw cannot reach (the old Gallop
    carried the hips higher than these hind legs reach), the body comes down that
    far, smoothed over the clip. `tuck_min` (a share of a front leg's reach; the
    anatomy table's, 0 for none) keeps a swinging forepaw off its shoulder
    (_untuck). Returns the largest body drop applied."""
    rest_old = {b.name: b.matrix_local for b in old_arm.data.bones}
    bones = new_arm.data.bones
    legs = {}
    for leg, (up, mid, low, paw, old_pad) in LEGS.items():
        kind = leg.split('_')[0]
        hinge, old_hinge = LEG_HINGE[kind], OLD_HINGE[kind]
        legs[leg] = {
            'rest_pad': bones[paw].head_local.copy(),
            'old_rest_pad': rest_old[old_pad].to_translation(),
            'hinge': hinge,
            'hinge_to_pad': bones[paw].head_local - bones[hinge].head_local,
            'old_hinge': old_hinge,
            'old_hinge_rest_q': rest_old[old_hinge].to_quaternion(),
            'old_hinge_to_pad': rest_old[old_pad].to_translation() - rest_old[old_hinge].to_translation(),
            'old_pad_rest_q': rest_old[old_pad].to_quaternion(),
            'pad_gap': bones[paw].head_local - rest_old[old_pad].to_translation(),
            'l_up': bones[up].length, 'l_mid': bones[mid].length, 'l_low': bones[low].length,
            'paw_rest_q': bones[paw].matrix_local.to_quaternion(),
            'low_rest_dir': bones[low].matrix_local.to_quaternion() @ Y_AXIS,
            'baseline': baselines[leg],
            'gait': _gait_contacts(frames, old_pad) if gait and loop else None,
            'tuck': tuck_min * (bones[paw].head_local - bones[up].head_local).length if kind == 'front' else 0.0,
        }
    snapshot = [{k: m.copy() for k, m in P.items()} for P in poses]
    for leg, L in legs.items():
        moved = np.array([tuple(_swing_offset(F, leg, L)[1]) for F in frames])
        eased = np.column_stack([_smooth_series(moved[:, c], SWING_SMOOTH, loop) for c in range(3)])
        L['swing'] = [Vector(v) for v in eased]
        L['curl'] = _curl_series(snapshot, leg, loop)
        if L['gait'] is None:
            plants = [_contact(F[LEGS[leg][4]].to_translation(), L, contact_lo, contact_hi)[1] for F in frames]
            L['settle'] = _smooth_series(plants, SETTLE_SMOOTH, loop)
    for leg, L in legs.items():
        # the clip's bend, eased, then folded or opened for the reach and eased again
        kind = leg.split('_')[0]
        lo, hi = LOW_LIMITS[kind]
        hinge = LEG_HINGE[kind]
        bend = _bend_series(new_arm, snapshot, leg, loop)
        reach = []
        for i, (P, F) in enumerate(zip(snapshot, frames)):
            target = _leg_target(P, F, i, leg, L, contact_lo, contact_hi)[0]
            body = P[hinge].to_quaternion() @ bones[hinge].matrix_local.to_quaternion().inverted()
            reach.append(_bend_to_reach(kind, bend[i], target - P[LEGS[leg][0]].to_translation(), L, lo, hi, body))
        # eased in and out, but never folded less than the reach needs (easing
        # alone halved the Gallop tuck's fold, which only lasts three frames)
        fold = FOLD_SIGN[kind] * np.array(reach)
        fold = np.maximum(_smooth_series(fold, REACH_SMOOTH, loop), fold)
        L['bend'] = np.clip(FOLD_SIGN[kind] * fold, lo, hi)
    need = np.array([_plant_frame(new_arm, P, F, i, legs, skin, ground_z, contact_lo, contact_hi)
                     for i, (P, F) in enumerate(zip(poses, frames))])

    def replant(shift):
        for i, (P, F) in enumerate(zip(poses, frames)):
            P.clear()
            P.update(snapshot[i])
            if shift[i] != 0.0:
                shift_subtree(new_arm, P, 'Pelvis', Vector((0.0, 0.0, float(shift[i]))))
            _plant_frame(new_arm, P, F, i, legs, skin, ground_z, contact_lo, contact_hi)

    drop = _held_ease(need, loop)
    if drop.max() >= 2e-3:
        replant(-drop)
    else:
        drop = np.zeros(len(need))
    # The body never goes through the floor either: where the trunk, the haunches
    # or the head would (Greyjaw sat 5 cm into the ground to howl), it comes up by
    # as much, eased the same way, and the paws plant again (a few rounds: the
    # replanted thighs fold a little lower under the raised hips).
    if skin.get('torso') is not None:
        rise = np.zeros(len(poses))
        for _ in range(3):
            sink = np.array([max(0.0, ground_z - skin_low(P, skin['torso'])) for P in poses])
            if sink.max() < 2e-3:
                break
            rise = rise + _held_ease(sink, loop)
            replant(rise - drop)
    return float(drop.max())


def _held_ease(v, loop):
    """A per-frame amount held over its neighbours, eased, and never under itself
    (so the easing never leaves the frame that needs the most short of it)."""
    v = np.asarray(v, float)
    n = len(v)
    held = v.copy()
    for k in range(n):
        for j in (k - 1, k + 1):
            if loop:
                j = j % (n - 1)
            if 0 <= j < n:
                held[k] = max(held[k], v[j])
    return np.maximum(_smooth_series(held, 1.0, loop), v)


# ------------------------------------------------------------------ keying
def basis(new_arm, P):
    """Pose-bone basis (location, quaternion) for every bone of one posed frame."""
    out = {}
    for b in new_arm.data.bones:
        rel = (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local
        par = P[b.parent.name] if b.parent else Matrix.Identity(4)
        B = rel.inverted() @ par.inverted() @ P[b.name]
        out[b.name] = (B.to_translation(), B.to_quaternion())
    return out


def _fcurve(act, arm, path, index, group):
    if hasattr(act, 'fcurve_ensure_for_datablock'):
        return act.fcurve_ensure_for_datablock(arm, path, index=index, group_name=group)
    return act.fcurves.new(path, index=index, action_group=group)


def key_action(new_arm, name, poses, moving=('Pelvis',)):
    """Write a new action from posed frames (one per 1/30 s). Rotation keys for
    every deforming bone; location keys only for the bones in `moving`."""
    act = bpy.data.actions.get(name)
    if act:
        bpy.data.actions.remove(act)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    set_action(new_arm, act)
    frames = [basis(new_arm, P) for P in poses]
    xs = np.array([1 + k * bpy.context.scene.render.fps / FPS for k in range(len(frames))], float)
    for b in new_arm.data.bones:
        if b.parent is None:
            continue
        qs = [frames[k][b.name][1] for k in range(len(frames))]
        for k in range(1, len(qs)):  # keep the quaternions on one hemisphere
            if qs[k].dot(qs[k - 1]) < 0:
                qs[k] = Quaternion((-qs[k].w, -qs[k].x, -qs[k].y, -qs[k].z))
        Q = np.array([tuple(q) for q in qs])
        path = f'pose.bones["{b.name}"]'
        for i in range(4):
            fc = _fcurve(act, new_arm, path + '.rotation_quaternion', i, b.name)
            fc.keyframe_points.add(len(xs))
            fc.keyframe_points.foreach_set('co', np.column_stack([xs, Q[:, i]]).ravel())
            fc.update()
        if b.name in moving:
            L = np.array([tuple(frames[k][b.name][0]) for k in range(len(frames))])
            for i in range(3):
                fc = _fcurve(act, new_arm, path + '.location', i, b.name)
                fc.keyframe_points.add(len(xs))
                fc.keyframe_points.foreach_set('co', np.column_stack([xs, L[:, i]]).ravel())
                fc.update()
    for pb in new_arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return act
