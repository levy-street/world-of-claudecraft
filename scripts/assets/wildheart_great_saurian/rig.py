"""The Great Saurian's armature, skin weights, pose solver, clip keying and
follow-through (adapted from the Balgath kit).

Skin weights come from the sculpt (sdf.skin_weights: each vertex is shared by the
bones whose primitives it lies between, in the proportion the sculpt blends them),
then are relaxed over the mesh and capped at four influences, the glTF limit.

Poses are authored the organic-kit way (aims in armature space, two-bone IK onto
targets with a pole, rest-frame turns, a moving Root) plus keyed bone SCALES (the
eye's flare). The two joint helpers (ElbowFix, KneeFix) are never authored: every
key gives them half their twin's bend, so the elbow and the knee skin follow the
bisector and keep their volume.

Keys are written at fractional frames from times in seconds, so the encounter's
contract frames (the smash lands at 1.18 s, the corpse at 1.80 s) are exact, and
each key names the easing of the segment that LEAVES it: 'auto' (Bezier), 'in'
(accelerate into the next key: a blow), 'out' (decelerate: a recoil settling),
'inout', 'linear', 'hold'.

`follow_through` runs damped springs over the dangling parts (the hide aprons, the
tally cord, the shackle chain, the gut) on top of the authored motion: gravity,
inertia, the drag of the march, and a push out of the thighs.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

import anatomy as A
import sdf

FPS = 24
HELPERS = {'L_ElbowFix': 'L_Forearm', 'R_ElbowFix': 'R_Forearm', 'L_KneeFix': 'L_Shin', 'R_KneeFix': 'R_Shin'}


# ------------------------------------------------------------------ armature
def build_armature(name='GreatSaurian'):
    data = bpy.data.armatures.new(name + 'Rig')
    arm = bpy.data.objects.new(name + 'Rig', data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head, tail in A.BONES:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = 0.0
    for bname, parent, head, tail in A.BONES:
        if parent:
            data.edit_bones[bname].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    data.display_type = 'STICK'
    return arm


# ------------------------------------------------------------------ weights
def mesh_arrays(obj):
    me = obj.data
    P = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', P)
    P = P.reshape(-1, 3)
    E = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    return P, E.reshape(-1, 2)


def relax(W, E, iters=4, alpha=0.5):
    n = len(W)
    deg = np.bincount(E.ravel(), minlength=n).astype(float)
    deg[deg == 0] = 1
    for _ in range(iters):
        acc = np.zeros_like(W)
        np.add.at(acc, E[:, 0], W[E[:, 1]])
        np.add.at(acc, E[:, 1], W[E[:, 0]])
        W = (1 - alpha) * W + alpha * acc / deg[:, None]
    return W


def cap4(W):
    if W.shape[1] > 4:
        idx = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W[W < 0.01] = 0
    s = W.sum(axis=1, keepdims=True)
    return W / np.maximum(s, 1e-9)


def write_groups(obj, bones, W):
    obj.vertex_groups.clear()
    groups = {b: obj.vertex_groups.new(name=b) for b in bones}
    for j, b in enumerate(bones):
        col = W[:, j]
        nz = np.nonzero(col > 0)[0]
        g = groups[b]
        for i in nz:
            g.add([int(i)], float(col[i]), 'REPLACE')


def jaw_split(P, bones, W):
    """The mouth opens on a slit the soft-min weights would smear across: in front
    of the hinge, the skin above the mouth line is Head and below it Jaw, outright.
    Behind the hinge the sculpt's own blend is kept."""
    if 'Jaw' not in bones or 'Head' not in bones:
        return W
    jh, hh = bones.index('Jaw'), bones.index('Head')
    y, z = P[:, 1], P[:, 2]
    line = 13.2 - 0.09 * (-11.1 - y)          # the mouth line (anatomy.py's slit, rx=-0.09)
    near = (y < -9.4) & (z > 12.2) & (z < 14.2) & (np.abs(P[:, 0]) < 1.6)
    t = np.clip((-9.4 - y) / 0.7, 0, 1)        # 0 at the hinge, 1 a little in front of it
    w_head = np.where(z > line, 1.0, 0.0)
    for i in np.nonzero(near)[0]:
        tot = W[i, jh] + W[i, hh]
        if tot < 0.5:
            continue
        hard_h = tot * w_head[i]
        W[i, hh] = W[i, hh] * (1 - t[i]) + hard_h * t[i]
        W[i, jh] = W[i, jh] * (1 - t[i]) + (tot - hard_h) * t[i]
    return W


def weight_skin(obj, field, tau=0.2, relax_iters=5):
    P, E = mesh_arrays(obj)
    bones, W = sdf.skin_weights(field.prims, P, tau=tau)
    W = relax(W, E, iters=relax_iters)
    W = jaw_split(P, bones, W)
    W = cap4(W)
    write_groups(obj, bones, W)
    return bones, W


def transfer_weights(obj, skin, skin_bones, skin_W, k=6):
    P, _ = mesh_arrays(obj)
    SP, _ = mesh_arrays(skin)
    tree = kdtree.KDTree(len(SP))
    for i, p in enumerate(SP):
        tree.insert(Vector(p), i)
    tree.balance()
    W = np.zeros((len(P), len(skin_bones)))
    for i, p in enumerate(P):
        hits = tree.find_n(Vector(p), k)
        tot = 0.0
        for co, idx, dist in hits:
            w = 1.0 / (dist + 0.03) ** 2
            W[i] += skin_W[idx] * w
            tot += w
        W[i] /= tot
    W = cap4(W)
    write_groups(obj, skin_bones, W)


def rigid(obj, bone):
    obj.vertex_groups.clear()
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')


def nearest_segment(obj, bones):
    P, _ = mesh_arrays(obj)
    segs = [(b, A.REST[b][0], A.REST[b][1]) for b in bones]
    obj.vertex_groups.clear()
    groups = {b: obj.vertex_groups.new(name=b) for b in bones}
    for i, p in enumerate(P):
        best, bd = None, 1e9
        for b, h, t in segs:
            ab = t - h
            u = np.clip((p - h) @ ab / (ab @ ab), 0, 1)
            d = np.linalg.norm(p - (h + ab * u))
            if d < bd:
                best, bd = b, d
        groups[best].add([i], 1.0, 'REPLACE')


def loin_weights(obj, bones, z_top, z_bot):
    P, _ = mesh_arrays(obj)
    obj.vertex_groups.clear()
    g = [obj.vertex_groups.new(name=b) for b in bones]
    for i, p in enumerate(P):
        t = np.clip((z_top - p[2]) / (z_top - z_bot), 0, 1)
        w0 = max(0.0, 1 - t / 0.16)
        w2 = np.clip((t - 0.45) / 0.45, 0, 1)
        w1 = max(0.0, 1 - w0 - w2)
        for gg, w in zip(g, (w0, w1, w2)):
            if w > 1e-3:
                gg.add([i], float(w), 'REPLACE')


# ------------------------------------------------------------------ posing
def _axis(a):
    if isinstance(a, str):
        return {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[a]
    return Vector(a)


def _mirror_turn(a, deg):
    v = _axis(a)
    return ((v.x, -v.y, -v.z), deg)


def two_bone(root, l1, l2, target, pole, prev=None, max_step=20.0):
    """Directions of an upper and a lower bone reaching `target`, the joint bent
    toward `pole`. With `prev` (the joint's previous bend direction) the bend may
    turn at most `max_step` degrees per call: as a target sweeps past its pole the
    bend would otherwise flip to the far side in one frame."""
    d = Vector(target) - root
    dist = max(1e-4, min(d.length, (l1 + l2) * 0.9995))
    dn = d.normalized()
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    a = math.acos(cos_a)
    p = Vector(pole) - dn * Vector(pole).dot(dn)
    if p.length < 1e-6:
        p = dn.orthogonal()
    p.normalize()
    if prev is not None:
        pp = prev - dn * prev.dot(dn)
        if pp.length > 1e-4:
            pp.normalize()
            ang = pp.angle(p)
            lim = math.radians(max_step)
            if ang > lim:
                axis = pp.cross(p)
                if axis.length < 1e-6:
                    axis = dn
                p = (Quaternion(axis.normalized(), lim) @ pp).normalized()
                p = (p - dn * p.dot(dn)).normalized()
    d1 = dn * math.cos(a) + p * math.sin(a)
    joint = root + d1 * l1
    d2 = (root + dn * dist - joint).normalized()
    two_bone.last_bend = p
    return d1, d2


class Pose(dict):
    """{bone: local Quaternion}, plus .root (Vector) and .scale ({bone: float})."""


class Rig:
    def __init__(self, arm):
        self.bones = A.BONES
        self.rest = {n: (Vector(h), Vector(t)) for n, _, h, t in A.BONES}
        self.parent = {n: p for n, p, _, _ in A.BONES}
        self.frames = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
        self.length = {n: (t - h).length for n, (h, t) in self.rest.items()}
        # the rest bend direction of each two-bone limb (where the joint points)
        self.rest_bend = {}
        for up, lo in (('L_UpperArm', 'L_Forearm'), ('R_UpperArm', 'R_Forearm'), ('L_Thigh', 'L_Shin'),
                       ('R_Thigh', 'R_Shin')):
            root, joint, tip = self.rest[up][0], self.rest[lo][0], self.rest[lo][1]
            line = (tip - root).normalized()
            off = joint - (root + line * (joint - root).dot(line))
            self.rest_bend[up] = off.normalized()

    # How far an upper limb may roll about its own length, relative to the clavicle or
    # the pelvis (degrees). Past it the arm reads as wrung like a towel: the elbow is
    # turned round instead, keeping the hand where it was asked to be.
    ROLL_LIMIT = {'L_UpperArm': 22.0, 'R_UpperArm': 22.0, 'L_Thigh': 22.0, 'R_Thigh': 22.0}

    def roll_of(self, name, d1, bend, dp):
        q = dp.inverted() @ self._limb_rotation(name, d1, bend)
        rest_m = self.frames[name]
        local = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        if local.w < 0:
            local.negate()
        return math.degrees(2 * math.atan2(local.y, local.w))

    ROLL_STEP = 11.0   # degrees per frame an upper limb may roll (the elbow swings round, never snaps)

    def _limit_roll(self, name, lo, root, tgt, bend, dp, prev=None):
        """Turn the bend plane round the root-to-target line until the upper bone's
        roll is within ROLL_LIMIT and, with `prev` (last frame's roll), within
        ROLL_STEP of it. The roll is unwrapped against `prev` first, so a pose past
        +180 is not read as -180 and clamped to the far limit."""
        l1, l2 = self.length[name], self.length[lo]
        d1, d2 = two_bone(root, l1, l2, tgt, bend)
        lim = self.ROLL_LIMIT.get(name)
        if lim is None:
            return d1, d2, bend, None
        dn = (Vector(tgt) - root).normalized()

        def unwrap(r):
            if prev is None:
                return r
            return r + 360.0 * round((prev - r) / 360.0)

        lo_r, hi_r = -lim, lim
        if prev is not None:
            lo_r, hi_r = max(lo_r, prev - self.ROLL_STEP), min(hi_r, prev + self.ROLL_STEP)
            if lo_r > hi_r:
                lo_r = hi_r = max(-lim, min(lim, prev))
        roll = unwrap(self.roll_of(name, d1, bend, dp))
        for _ in range(12):
            want = max(lo_r, min(hi_r, roll))
            over = roll - want
            if abs(over) < 0.5:
                break
            trial = (Quaternion(dn, math.radians(-over)) @ bend).normalized()
            t1, t2 = two_bone(root, l1, l2, tgt, trial)
            tb = two_bone.last_bend.copy()
            r2 = unwrap(self.roll_of(name, t1, tb, dp))
            if abs(r2 - want) > abs(over):        # the roll runs against the turn here
                trial = (Quaternion(dn, math.radians(over)) @ bend).normalized()
                t1, t2 = two_bone(root, l1, l2, tgt, trial)
                tb = two_bone.last_bend.copy()
                r2 = unwrap(self.roll_of(name, t1, tb, dp))
            d1, d2, bend, roll = t1, t2, tb, r2
        return d1, d2, bend, roll

    @staticmethod
    def _frame(y, z):
        y = y.normalized()
        z = (z - y * z.dot(y)).normalized()
        x = y.cross(z)
        return Matrix((x, y, z)).transposed()

    def _limb_rotation(self, bone, direction, bend):
        """Armature rotation taking `bone` from rest to point along `direction` with its
        bend plane facing `bend`: swing AND twist from one frame, so an arm raised
        overhead (straight against its rest direction) never spins on its axis."""
        h, t = self.rest[bone]
        rest_y = (t - h).normalized()
        upper = bone if bone in self.rest_bend else self.parent[bone]
        r = self._frame(rest_y, self.rest_bend[upper])
        w = self._frame(direction, bend)
        return (w @ r.transposed()).to_quaternion()

    def _mirror(self, table, kind):
        out = dict(table)
        for k, v in table.items():
            if k.startswith('L_') and 'R_' + k[2:] not in table:
                if kind == 'aim':
                    out['R_' + k[2:]] = Vector((-v[0], v[1], v[2]))
                elif kind == 'turns':
                    out['R_' + k[2:]] = [_mirror_turn(a, d) for a, d in v]
                else:
                    out['R_' + k[2:]] = v
        return out

    LIMITS = {'L_Hand': 70.0, 'R_Hand': 70.0, 'L_Foot': 70.0, 'R_Foot': 70.0}

    def pose(self, aims=None, ik=None, turns=None, root=(0, 0, 0), scale=None, mirror=True, memory=None,
             twist=None):
        """aims {bone: armature dir}; ik {key: (upper, lower, target, pole)};
        turns {bone: [(axis, deg)]} (rest-frame axes, applied after the aim, carried
        by the parent); root: Root bone offset; scale {bone: s}."""
        aims = {k: Vector(v) for k, v in (aims or {}).items()}
        turns = dict(turns or {})
        if mirror:
            aims = self._mirror(aims, 'aim')
            turns = self._mirror(turns, 'turns')
        ik = dict(ik or {})
        ik_upper = {u: (lo, Vector(tgt), Vector(pole)) for u, lo, tgt, pole in ik.values()}
        limb_rot = {}
        delta, head, out = {}, {}, Pose()
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                head[name] = head[parent] + delta[parent] @ (rh - self.rest[parent][0])
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if name in ik_upper:
                lo, tgt, pole = ik_upper[name]
                prev = memory.get(name) if memory is not None else None
                d1, d2 = two_bone(head[name], self.length[name], self.length[lo], tgt, pole, prev, max_step=12.0)
                bend = two_bone.last_bend.copy()
                prev_roll = memory.get(name + '#roll') if memory is not None else None
                d1, d2, bend, roll = self._limit_roll(name, lo, head[name], tgt, bend, dp,
                                                      None if prev_roll is None else prev_roll.x)
                if memory is not None and roll is not None:
                    memory[name + '#roll'] = Vector((roll, 0.0, 0.0))
                if memory is not None:
                    memory[name] = bend
                limb_rot[name] = self._limb_rotation(name, d1, bend)
                limb_rot[lo] = self._limb_rotation(lo, d2, bend)
            if name in HELPERS:
                # the joint helper points along the bisector of the joint's bend
                twin = HELPERS[name]
                d_lo = delta[twin] @ (self.rest[twin][1] - self.rest[twin][0]).normalized()
                pr = self.parent[name]
                d_up = delta[pr] @ (self.rest[pr][1] - self.rest[pr][0]).normalized()
                bis = d_lo + d_up
                if bis.length > 1e-6:
                    aims[name] = bis.normalized()
            q = Quaternion()
            if name in limb_rot:
                q = dp.inverted() @ limb_rot[name]
            elif name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                lim = self.LIMITS.get(name)
                if lim is not None and r0.angle(want) > math.radians(lim):
                    # a wrist or an ankle bends so far and no further
                    axis = r0.cross(want)
                    if axis.length < 1e-6:
                        axis = r0.orthogonal()
                    want = Quaternion(axis.normalized(), math.radians(lim)) @ r0
                q = r0.rotation_difference(want)
            for a, deg in turns.get(name, []):
                q = Quaternion(_axis(a).normalized(), math.radians(deg)) @ q
            if twist and name in twist:
                # a roll about the bone's own length (pronation): applied in the bone's
                # rest frame first, so it stays a pure twist whatever the swing
                q = q @ Quaternion((rt - rh).normalized(), math.radians(twist[name]))
            delta[name] = dp @ q
            rest_m = self.frames[name]
            out[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        out.root = Vector(root)
        out.loc = {}
        out.scale = dict(scale or {})
        out.head = head
        out.delta = delta
        return out


# ------------------------------------------------------------------ keying
EASE = {
    'auto': ('BEZIER', 'AUTO'),
    'in': ('CUBIC', 'EASE_IN'),
    'out': ('CUBIC', 'EASE_OUT'),
    'inout': ('SINE', 'EASE_IN_OUT'),
    'quadin': ('QUAD', 'EASE_IN'),
    'expoin': ('EXPO', 'EASE_IN'),
    'backout': ('BACK', 'EASE_OUT'),
    'linear': ('LINEAR', 'AUTO'),
    'hold': ('CONSTANT', 'AUTO'),
}


def fcurves(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def frame_of(t):
    return 1.0 + t * FPS


def make_clip(arm, name, keys):
    """keys: [(t_seconds, Pose, ease)]. Returns the action."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    last = {}
    ease_at = {}
    for t, pose, ease in keys:
        f = frame_of(t)
        ease_at[round(f, 4)] = ease
        for pb in arm.pose.bones:
            q = pose.get(pb.name, Quaternion())
            q = Quaternion(q)
            prev = last.get(pb.name)
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            last[pb.name] = q
            pb.rotation_quaternion = q
            pb.location = (0, 0, 0)
            s = pose.scale.get(pb.name, 1.0)
            pb.scale = (s, s, s)
        rb = arm.pose.bones['Root']
        rb.location = rb.bone.matrix_local.to_3x3().inverted() @ pose.root
        for bname, d in getattr(pose, 'loc', {}).items():
            pb = arm.pose.bones[bname]
            par = pose.delta.get(pb.parent.name) if pb.parent else None
            frame = (par.to_matrix() if par is not None else Matrix.Identity(3)) @ pb.bone.matrix_local.to_3x3()
            pb.location = frame.inverted() @ Vector(d)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('scale', frame=f)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            ease = ease_at.get(round(kp.co[0], 4), 'auto')
            interp, easing = EASE[ease]
            kp.interpolation = interp
            kp.easing = easing
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
        fc.update()
    act['duration'] = max(t for t, _, _ in keys)
    return act


def set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]


# ------------------------------------------------------------------ follow-through
class Chain:
    def __init__(self, bones, parent, gravity=0.7, stiff=0.18, damp=0.12, drag=1.0, collide=False, mass=1.0):
        self.bones, self.parent = bones, parent
        self.gravity, self.stiff, self.damp, self.drag, self.collide, self.mass = gravity, stiff, damp, drag, collide, mass


CHAINS = [
    Chain(['BannerL1', 'BannerL2'], 'HowdahPostBL', gravity=0.8, stiff=0.12, damp=0.1, drag=1.4),
    Chain(['BannerR1', 'BannerR2'], 'HowdahPostBR', gravity=0.8, stiff=0.12, damp=0.1, drag=1.4),
    Chain(['Charm1', 'Charm2'], 'Neck2', gravity=0.9, stiff=0.1, damp=0.1, drag=0.6),
    Chain(['Belly'], 'Spine1', gravity=0.0, stiff=0.3, damp=0.2, drag=0.0),
]
DOWN = Vector((0, 0, -1))


def _seg_dist(p, a, b):
    ab = b - a
    u = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    c = a + ab * u
    return (p - c).length, c


def follow_through(arm, act, loop=False, wind=0.0, passes=None):
    """Simulate the dangling chains over an authored clip and key them every frame.
    `wind` (yards/s) is the march's drag toward +Y (the body moves to -Y)."""
    scene = bpy.context.scene
    set_action(arm, act)
    f0, f1 = act.frame_range
    frames = list(range(int(math.floor(f0)), int(math.ceil(f1)) + 1))
    dt = 1.0 / FPS
    bones = arm.pose.bones
    rest3 = {b.name: b.bone.matrix_local.to_3x3() for b in bones}
    rest_dir = {b.name: (Vector(A.REST[b.name][1]) - Vector(A.REST[b.name][0])).normalized() for b in bones}
    length = {b.name: (Vector(A.REST[b.name][1]) - Vector(A.REST[b.name][0])).length for b in bones}
    # sample the authored parents once
    samples = []
    for f in frames:
        scene.frame_set(f)
        rec = {}
        for c in CHAINS:
            pb = bones[c.parent]
            rec[c.parent] = (pb.matrix.copy())
        for leg in ('L_Thigh', 'R_Thigh', 'L_Shin', 'R_Shin'):
            pb = bones[leg]
            rec[leg] = (pb.head.copy(), pb.tail.copy())
        for c in CHAINS:
            for b in c.bones:
                rec['anim_' + b] = bones[b].matrix.copy()
        samples.append(rec)
    n_pass = passes or (3 if loop else 1)
    state = {}
    result = {}
    for c in CHAINS:
        tips = None
        prev = None
        keys = []
        for p_i in range(n_pass):
            keys = []
            for fi, f in enumerate(frames):
                rec = samples[fi]
                pm = rec[c.parent]
                p_delta = pm.to_3x3() @ rest3[c.parent].inverted()
                head = None
                parent_delta = p_delta.to_quaternion()
                local_keys = []
                new_tips = []
                for j, b in enumerate(c.bones):
                    am = rec['anim_' + b]
                    if head is None:
                        head = am.translation.copy()
                    a_dir = (am.to_3x3() @ rest3[b].inverted()) @ rest_dir[b]
                    target_dir = a_dir.lerp(DOWN, c.gravity).normalized() if c.gravity > 0 else a_dir
                    if wind and c.drag:
                        target_dir = (target_dir + Vector((0, 1, 0)) * wind * 0.045 * c.drag).normalized()
                    T = head + target_dir * length[b]
                    if tips is None or len(new_tips) >= len(tips):
                        X, Xp = T.copy(), T.copy()
                    else:
                        X, Xp = tips[j]
                    vel = (X - Xp) * (1.0 - c.damp)
                    Xn = X + vel + (T - X) * c.stiff
                    # keep the bone's length
                    Xn = head + (Xn - head).normalized() * length[b]
                    if c.collide:
                        for leg in ('L_Thigh', 'R_Thigh', 'L_Shin', 'R_Shin'):
                            a, bb = rec[leg]
                            rad = 1.32 if 'Thigh' in leg else 1.0
                            d, cpt = _seg_dist(Xn, a, bb)
                            if d < rad:
                                Xn = cpt + (Xn - cpt).normalized() * rad
                        Xn = head + (Xn - head).normalized() * length[b]
                    if Xn.z < 0.15:          # the ford's bed
                        Xn.z = 0.15
                        Xn = head + (Xn - head).normalized() * length[b]
                    new_tips.append((Xn, X))
                    want = (Xn - head).normalized()
                    cur = parent_delta @ rest_dir[b]
                    swing = cur.rotation_difference(want)
                    delta_b = swing @ parent_delta
                    q = parent_delta.inverted() @ delta_b
                    rm = rest3[b]
                    local = (rm.inverted() @ q.to_matrix() @ rm).to_quaternion()
                    local_keys.append((b, local))
                    parent_delta = delta_b
                    head = Xn
                tips = new_tips
                keys.append((f, local_keys))
        result[c.bones[0]] = keys
    # write the keys (replace the authored ones on these bones)
    fcs = fcurves(act)
    names = {b for c in CHAINS for b in c.bones}
    for fc in list(fcs):
        for b in names:
            if fc.data_path == f'pose.bones["{b}"].rotation_quaternion':
                fc.keyframe_points.clear()
    last = {}
    for c in CHAINS:
        for f, lks in result[c.bones[0]]:
            for b, q in lks:
                prev = last.get(b)
                if prev is not None and prev.dot(q) < 0:
                    q = -q
                last[b] = q
                pb = bones[b]
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=f)
    for fc in fcurves(act):
        for b in names:
            if fc.data_path == f'pose.bones["{b}"].rotation_quaternion':
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    return act
