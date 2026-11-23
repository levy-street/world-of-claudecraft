"""The Gorgebloom's armature, skin weights, pose solver, clip keying and
follow-through (adapted from the Great Jaguar / Balgath kit).

Skin weights come from the sculpts (sdf.skin_weights: each vertex is shared by
the bones whose primitives it lies between, in the proportion the sculpt blends
them), relaxed over the mesh and capped at four influences, the glTF limit.

Poses are FK: per-bone turns about armature-space axes carried by the parent,
aims (a bone pointed along a direction), keyed bone SCALES (the bulb's breath,
the pulsing pollen sacs) and bone offsets. Keys are written at fractional frames
from times in seconds, so the contact frames are exact.

`follow_through` runs damped springs over the petal tips and the vine ends on top
of the authored motion: they lag the turn and overshoot it.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

import anatomy as A
import sdf

FPS = 24


# ------------------------------------------------------------------ armature
def build_armature(name='Gorgebloom'):
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


def weight_skin(obj, field, tau=0.06, relax_iters=4):
    P, E = mesh_arrays(obj)
    bones, W = sdf.skin_weights(field.prims, P, tau=tau)
    W = relax(W, E, iters=relax_iters)
    W = cap4(W)
    write_groups(obj, bones, W)
    return bones, W


def transfer_weights(obj, skin, skin_bones, skin_W, k=6):
    """Weights copied from the nearest skin vertices (`skin` may be a list of
    (object, bones, W) to search several skins at once)."""
    if isinstance(skin, list):
        allb = sorted({b for _, bb, _ in skin for b in bb})
        idx = {b: i for i, b in enumerate(allb)}
        SPs, Ws = [], []
        for o, bb, WW in skin:
            p, _ = mesh_arrays(o)
            SPs.append(p)
            M = np.zeros((len(p), len(allb)))
            for j, bn in enumerate(bb):
                M[:, idx[bn]] = WW[:, j]
            Ws.append(M)
        SP, skin_W, skin_bones = np.concatenate(SPs), np.concatenate(Ws), allb
    else:
        SP, _ = mesh_arrays(skin)
    P, _ = mesh_arrays(obj)
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
    """{bone: local Quaternion}, plus .root, .scale, .loc, .head, .tail."""


class Rig:
    def __init__(self, arm):
        self.bones = A.BONES
        self.rest = {n: (Vector(h), Vector(t)) for n, _, h, t in A.BONES}
        self.parent = {n: p for n, p, _, _ in A.BONES}
        self.frames = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
        self.length = {n: (t - h).length for n, (h, t) in self.rest.items()}

    def pose(self, aims=None, turns=None, root=(0, 0, 0), scale=None, loc=None, floors=None):
        """aims {bone: armature dir}; turns {bone: [(axis, deg)]} (armature-space
        axes, carried by the parent, applied after the aim); root: Root offset;
        scale {bone: s}; loc {bone: armature-space offset of the bone's head}."""
        aims = {k: Vector(v) for k, v in (aims or {}).items()}
        turns = dict(turns or {})
        delta, head, tail, out = {}, {}, {}, Pose()
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                head[name] = head[parent] + delta[parent] @ (rh - self.rest[parent][0])
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if loc and name in loc:
                head[name] = head[name] + Vector(loc[name])
            q = Quaternion()
            if name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                q = r0.rotation_difference(want)
            for a, deg in turns.get(name, []):
                if deg:
                    q = Quaternion(_axis(a).normalized(), math.radians(deg)) @ q
            delta[name] = dp @ q
            tail[name] = head[name] + delta[name] @ (rt - rh)
            fl = floors.get(name) if floors else None
            if fl is not None and tail[name].z < fl:
                # the ground: raise the bone about its head until its tail rests on it
                d = tail[name] - head[name]
                ln = d.length
                cur = math.asin(max(-1.0, min(1.0, d.z / ln)))
                want = math.asin(max(-1.0, min(1.0, (fl - head[name].z) / ln)))
                ax = d.cross(Vector((0, 0, 1)))
                if ax.length > 1e-6 and want > cur:
                    delta[name] = Quaternion(ax.normalized(), want - cur) @ delta[name]
                    q = dp.inverted() @ delta[name]
                    tail[name] = head[name] + delta[name] @ (rt - rh)
            rest_m = self.frames[name]
            out[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        out.root = Vector(root)
        out.loc = dict(loc or {})
        out.scale = dict(scale or {})
        out.head = head
        out.tail = tail
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
    def __init__(self, bones, parent, gravity=0.7, stiff=0.18, damp=0.12, drag=1.0, collide=False, mass=1.0,
                 mix=1.0, floor=0.12):
        self.bones, self.parent, self.mix, self.floor = bones, parent, mix, floor
        self.gravity, self.stiff, self.damp, self.drag, self.collide, self.mass = gravity, stiff, damp, drag, collide, mass


def _chains():
    out = []
    for k in range(len(A.PETALS)):
        out.append(Chain(A.PETALS[k][1:], A.PETALS[k][0], gravity=0.05, stiff=0.32, damp=0.22, drag=0.0, mix=0.55,
                         floor=-5.0))
    for name, bones in A.VINES.items():
        out.append(Chain(bones[-3:], bones[-4], gravity=0.0, stiff=0.38, damp=0.3, drag=0.0, mix=0.55, floor=0.18))
    return out


CHAINS = _chains()
DOWN = Vector((0, 0, -1))


def _seg_dist(p, a, b):
    ab = b - a
    u = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    c = a + ab * u
    return (p - c).length, c


def follow_through(arm, act, loop=False, wind=0.0, passes=None, skip=()):
    """Simulate the dangling chains over an authored clip and key them every frame.
    `wind` (yards/s) is the march's drag toward +Y (the body moves to -Y)."""
    scene = bpy.context.scene
    chains = [c for c in CHAINS if c.bones[0] not in skip]
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
        for c in chains:
            pb = bones[c.parent]
            rec[c.parent] = (pb.matrix.copy())
        for c in chains:
            for b in c.bones:
                rec['anim_' + b] = bones[b].matrix.copy()
        samples.append(rec)
    n_pass = passes or (3 if loop else 1)
    state = {}
    result = {}
    for c in chains:
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
                        target_dir = (target_dir + Vector((0, 1, 0)) * wind * 0.02 * c.drag).normalized()
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
                    if Xn.z < c.floor:       # the ground
                        Xn.z = c.floor
                        Xn = head + (Xn - head).normalized() * length[b]
                    new_tips.append((Xn, X))
                    want = (Xn - head).normalized()
                    if c.mix < 1.0:
                        want = (a_dir * (1.0 - c.mix) + want * c.mix).normalized()
                        Xn = head + want * length[b]
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
    names = {b for c in chains for b in c.bones}
    for fc in list(fcs):
        for b in names:
            if fc.data_path == f'pose.bones["{b}"].rotation_quaternion':
                fc.keyframe_points.clear()
    last = {}
    for c in chains:
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
