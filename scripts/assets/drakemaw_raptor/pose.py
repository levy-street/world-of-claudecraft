"""The Drakemaw Raptor's pose solver: a handful of readable numbers to a pose.

A `Body` names the pose the way an animator thinks of it: where the hips sit
and how they pitch, roll and yaw; how the spine and the neck bend; where the
head looks (and how firmly it holds its attitude in the world while the body
moves under it, the way a bird's does); how the tail lifts, swings and waves;
where each foot's ball is planted, how its metatarsus tilts and its toes curl;
how the forearms fold. `Rig.solve(body)` turns it into one local rotation per
bone plus the Hips' offset, ready to key.

Axes are armature space in yards: +Z up, the raptor faces -Y, its left is +X.
Angles are degrees, and every one of them reads the same way, +:
  pitch: noses up (the hips, the spine, the neck, the head; the neck tilts back)
  roll: rolls onto its LEFT side          yaw: turns its nose to its LEFT
  tail_lift: lifts the tail               tail_yaw: swings the tail to its LEFT
  meta (per foot): tilts the metatarsus so the ball swings BACK under the
    ankle (and on into the folded swing); - reaches the foot forward. It is
    measured against the GROUND (the heading), never the body's pitch, so a
    planted foot keeps its attitude while the body rocks over it
  toe (per foot): curls the toes down. A planted foot's toes lie flat on the
    ground at their rest attitude plus `toe`; a lifted foot's curl from the
    metatarsus
  arm: swings the upper arm forward; elbow: folds the forearm up toward it;
  hand: curls the claws in; out: spreads the arm away from the chest
Each bone's delta is an armature-space rotation over its rest pose, carried
down the chain; the local quaternion is rest^-1 * parent^-1 * delta * rest.
A leg is two-bone IK from the hip joint onto the ankle, the knee bending toward
a pole ahead of it; the ankle sits where the metatarsus, at its tilt, reaches
the ball. Twist comes from a frame built on the knee's bend plane (the thigh,
the shin) or on the lateral axis (the metatarsus, the toes), so no leg wrings.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import anatomy as A

V = Vector
X_AX, Y_AX, Z_AX = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))

# how a turn spreads down a chain
SPINE_W = (0.45, 0.55)
NECK_W = (0.5, 0.5)
TAIL_W = (0.24, 0.2, 0.17, 0.15, 0.13, 0.11)


def q_axis(axis, deg):
    return Quaternion(V(axis), math.radians(deg))


def body_rotation(yaw, pitch, roll):
    """Yaw about +Z, then pitch about the turned lateral axis, then roll about the
    turned long axis (+ rolls the left side down)."""
    q = q_axis(Z_AX, yaw)
    q = q_axis(q @ X_AX, -pitch) @ q
    q = q_axis(q @ Y_AX, roll) @ q
    return q


def turns(parent_delta, *tw):
    """Rotations about rest-frame axes, applied in order, carried by the parent."""
    q = Quaternion()
    for ax, deg in tw:
        q = q_axis(ax, deg) @ q
    return parent_delta @ q


class Body:
    DEFAULTS = dict(
        pelvis=(0.0, 0.0, 0.0),            # Hips head offset from rest (yards)
        yaw=0.0, pitch=0.0, roll=0.0,      # the hips, and all they carry
        spine_pitch=0.0, spine_yaw=0.0, spine_roll=0.0,
        neck_pitch=0.0, neck_yaw=0.0, neck_roll=0.0,
        head_pitch=0.0, head_yaw=0.0, head_roll=0.0,
        head_lock=0.0,                     # 0: the head rides the neck; 1: it holds head_world
        head_world=(0.0, 0.0, 0.0),        # (yaw, pitch, roll) from rest that a locked head holds
        tail_lift=0.0, tail_yaw=0.0, tail_roll=0.0,
        tail_wave=0.0, tail_wave_lift=0.0, tail_phase=0.0, tail_lag=0.55, tail_tip=0.0,
        arm_l=0.0, arm_r=0.0, elbow_l=0.0, elbow_r=0.0, hand_l=0.0, hand_r=0.0, out_l=0.0, out_r=0.0,
        ball_l=None, ball_r=None,          # armature-space ball targets (None: rest, riding the body)
        meta_l=0.0, meta_r=0.0, toe_l=0.0, toe_r=0.0,
        planted_l=True, planted_r=True,
        knee_out=0.0,                      # turns the knee further out than its rest bow (degrees)
        heading=0.0,                       # the travel heading the feet keep (the hips' yaw is a twist)
    )

    def __init__(self, **kw):
        self.p = dict(self.DEFAULTS)
        self.set(**kw)

    def set(self, **kw):
        for k, v in kw.items():
            if k not in self.p:
                raise KeyError(k)
            self.p[k] = v
        return self

    def but(self, **kw):
        b = Body()
        b.p = dict(self.p)
        return b.set(**kw)


class Pose(dict):
    """{bone: local Quaternion}; .hips_loc is the Hips' pose location, .head the
    posed bone heads, .delta the armature-space deltas, .reach each leg's
    hip-to-ankle stretch as a fraction of the thigh plus the shin."""


class Rig:
    def __init__(self, arm):
        self.order = [n for n, _, _, _ in A.BONES]
        self.parent = dict(A.PARENT)
        self.head = {n: V(h) for n, (h, _) in A.REST.items()}
        self.tail = {n: V(t) for n, (_, t) in A.REST.items()}
        self.rest = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
        self.length = {n: (self.tail[n] - self.head[n]).length for n in self.order}
        self.dir = {n: (self.tail[n] - self.head[n]).normalized() for n in self.order}
        # The knee's bend direction is never a fixed pole: a pole the hip-to-ankle
        # line can swing through flips the knee plane mid-swing. It is the leg
        # line crossed with the lateral axis (in the leg's own plane, at right
        # angles to the line, so it is defined at every leg angle), turned out
        # about the line by the knee's measured rest splay.
        self.knee_side, self.splay = {}, {}
        for s in ('L_', 'R_'):
            hip, knee, ank = self.head[s + 'Thigh'], self.head[s + 'Shin'], self.head[s + 'Foot']
            line = (ank - hip).normalized()
            off = knee - (hip + line * (knee - hip).dot(line))
            self.knee_side[s] = off.normalized()
            p0 = line.cross(X_AX).normalized()
            ang = p0.angle(self.knee_side[s])
            self.splay[s] = math.degrees(ang) * (1.0 if p0.cross(self.knee_side[s]).dot(line) > 0 else -1.0)
        # the knee's hinge axis at rest: square to the thigh and the shin alike, so
        # it twists them steadily however deep the knee folds (the bend direction
        # itself runs along the thigh or the shin when the knee folds tight)
        self.hinge = {}
        for s in ('L_', 'R_'):
            line = (self.head[s + 'Foot'] - self.head[s + 'Thigh']).normalized()
            self.hinge[s] = line.cross(self.knee_side[s]).normalized()
        # {side: {'Foot': [rest points], 'Toes': [rest points]}}: the sole, heel and
        # claw vertices each foot bone carries (rig.foot_ground_points); with them
        # set, solve() keeps every one of them out of the ground
        self.ground = None

    @staticmethod
    def _frame(y, z):
        y = y.normalized()
        z = (z - y * z.dot(y)).normalized()
        x = y.cross(z)
        return Matrix((x, y, z)).transposed()

    def _delta(self, bone, direction, ref, rest_ref):
        """Armature rotation taking `bone` from rest to point along `direction`, its
        reference axis turned from `rest_ref` to `ref`: swing and twist from one
        frame, so the bone never spins on its own length."""
        r = self._frame(self.dir[bone], rest_ref)
        w = self._frame(direction, ref)
        return (w @ r.transposed()).to_quaternion()

    @staticmethod
    def two_bone(root, l1, l2, target, pole):
        d = target - root
        dist = max(1e-5, min(d.length, (l1 + l2) * 0.9995))
        dn = d.normalized()
        cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
        a = math.acos(cos_a)
        p = pole - dn * pole.dot(dn)
        if p.length < 1e-6:
            p = dn.orthogonal()
        p.normalize()
        d1 = dn * math.cos(a) + p * math.sin(a)
        joint = root + d1 * l1
        d2 = (root + dn * dist - joint).normalized()
        return d1, d2, p, d.length / (l1 + l2)

    def rest_ball(self, side):
        return self.head[side + 'Toes'].copy()

    GROUND_EPS = 0.002   # how far (yards) a foot's sample point may sit under the ground on a key
    GROUND_STEP = 1.5    # degrees the clamp turns the metatarsus or the toes per pass

    def _leg(self, s, hip, ball, meta, toe, planted, q_head, lateral, yaw, knee_out):
        """One leg: two-bone IK from the hip onto the ankle that puts the
        metatarsus, at its tilt, on the ball; then the toes."""
        sign = 1.0 if s == 'L_' else -1.0
        m_dir = q_axis(lateral, meta) @ (q_head @ self.dir[s + 'Foot'])
        ankle = ball - m_dir * self.length[s + 'Foot']
        # the knee follows half the hips' twist; the rest of its aim is the heading
        line = (ankle - hip).normalized()
        lat = q_axis(Z_AX, 0.5 * yaw) @ lateral
        pole = q_axis(line, self.splay[s] + sign * knee_out) @ line.cross(lat).normalized()
        l1, l2 = self.length[s + 'Thigh'], self.length[s + 'Shin']
        d1, d2, bend, reach = self.two_bone(hip, l1, l2, ankle, pole)
        hinge = line.cross(bend).normalized()
        d_foot = self._delta(s + 'Foot', m_dir, lateral, X_AX)
        # planted 1: the toes lie on the ground at their rest attitude (plus
        # `toe`); 0: they ride the metatarsus; between: the peel and the strike
        curl = q_axis(lateral, toe)
        flat = curl @ (q_head @ self.dir[s + 'Toes'])
        carried = curl @ (d_foot @ self.dir[s + 'Toes'])
        t_dir = Quaternion().slerp(carried.rotation_difference(flat), planted) @ carried
        ankle_at = hip + d1 * l1 + d2 * l2
        return dict(thigh=self._delta(s + 'Thigh', d1, hinge, self.hinge[s]),
                    shin=self._delta(s + 'Shin', d2, hinge, self.hinge[s]), foot=d_foot,
                    toes=self._delta(s + 'Toes', t_dir, lateral, X_AX), reach=reach,
                    ankle=ankle_at, ball=ankle_at + m_dir * self.length[s + 'Foot'])

    def _lowest(self, s, leg, q_head):
        """The lowest sole point (and whether it lies ahead of the ball along the
        heading) and the lowest claw point, posed."""
        g = self.ground[s]
        a0, b0 = self.head[s + 'Foot'], self.head[s + 'Toes']
        fwd = q_head @ V((0.0, -1.0, 0.0))
        foot = min(((leg['ankle'] + leg['foot'] @ (q - a0)) for q in g['Foot']), key=lambda v: v.z)
        toes = min(((leg['ball'] + leg['toes'] @ (q - b0)) for q in g['Toes']), key=lambda v: v.z)
        return foot.z, (foot - leg['ball']).dot(fwd) > 0.0, toes.z, (toes - leg['ball']).dot(fwd) > 0.0

    META_CAP = 30.0      # the most the clamp turns the metatarsus either way (degrees)
    TOE_CAP = 45.0       # the most it uncurls the toes

    def solve_leg(self, s, hip, ball, meta, toe, planted, q_head, lateral, yaw, knee_out):
        """The leg, kept out of the ground: while the sole would sink the
        metatarsus turns to lift it (the heel up over the ball when the low point
        is behind it, the toe end up when it is ahead), and while a claw would dig
        in the toes turn to lift it (uncurling when they point ahead, curling on
        back when a folded foot has them pointing behind). Only the tilts move,
        never the ball, so a planted foot keeps its lock; the metatarsus never
        turns past a full leg's reach, nor either tilt past its cap. Returns the
        leg and the (meta, toe) it settled on."""
        leg = self._leg(s, hip, ball, meta, toe, planted, q_head, lateral, yaw, knee_out)
        if not self.ground:
            return leg, meta, toe
        meta0, toe0 = meta, toe
        for _ in range(60):
            foot, foot_ahead, toes, toes_ahead = self._lowest(s, leg, q_head)
            moved = False
            if foot < -self.GROUND_EPS:
                step = -self.GROUND_STEP if foot_ahead else self.GROUND_STEP
                if abs(meta + step - meta0) <= self.META_CAP:
                    trial = self._leg(s, hip, ball, meta + step, toe, planted, q_head, lateral, yaw, knee_out)
                    if trial['reach'] <= 0.985:
                        meta, leg, moved = meta + step, trial, True
            if toes < -self.GROUND_EPS:
                step = -self.GROUND_STEP if toes_ahead else self.GROUND_STEP
                if abs(toe + step - toe0) <= self.TOE_CAP:
                    toe += step
                    leg = self._leg(s, hip, ball, meta, toe, planted, q_head, lateral, yaw, knee_out)
                    moved = True
            if not moved:
                break
        return leg, meta, toe

    def solve(self, body):
        p = body.p
        delta, head = {}, {}
        out = Pose()
        out.reach = {}
        out.clamp = {}     # per leg: how far the ground clamp turned (meta, toe)
        hips_off = V(p['pelvis'])
        q_body = body_rotation(p['yaw'], p['pitch'], p['roll'])
        q_head = q_axis(Z_AX, p['heading'])    # what a planted foot answers to: never the hips' twist
        lateral = q_head @ X_AX
        legs = {}

        for name in self.order:
            par = self.parent[name]
            dp = delta[par] if par else Quaternion()
            head[name] = head[par] + dp @ (self.head[name] - self.head[par]) if par else self.head[name].copy()
            if name == 'Root':
                d = Quaternion()
            elif name == 'Hips':
                head[name] = self.head[name] + hips_off
                d = q_body
            elif name in ('Spine1', 'Spine2'):
                w = SPINE_W[0 if name == 'Spine1' else 1]
                d = turns(dp, (Z_AX, p['spine_yaw'] * w), (X_AX, -p['spine_pitch'] * w), (Y_AX, p['spine_roll'] * w))
            elif name in ('Neck1', 'Neck2'):
                w = NECK_W[0 if name == 'Neck1' else 1]
                d = turns(dp, (Z_AX, p['neck_yaw'] * w), (X_AX, -p['neck_pitch'] * w), (Y_AX, p['neck_roll'] * w))
            elif name == 'Head':
                carried = turns(dp, (Z_AX, p['head_yaw']), (X_AX, -p['head_pitch']), (Y_AX, p['head_roll']))
                if p['head_lock'] > 0:
                    hw = p['head_world']
                    held = body_rotation(hw[0], hw[1], hw[2])
                    d = carried.slerp(held, p['head_lock'])
                else:
                    d = carried
            elif name == 'Saddle':
                d = dp
            elif name.startswith('Tail'):
                i = int(name[4:]) - 1
                k = i / (len(TAIL_W) - 1)
                w = TAIL_W[i]
                ph = p['tail_phase'] - i * p['tail_lag']
                env = 0.45 + 0.55 * k
                wave = p['tail_wave'] * math.sin(ph) * env
                wave_l = p['tail_wave_lift'] * math.sin(ph + 0.9) * env
                tip = p['tail_tip'] * max(0.0, k - 0.5) * 2.0
                d = turns(dp, (Z_AX, -(p['tail_yaw'] * w + wave)), (X_AX, p['tail_lift'] * w + wave_l + tip),
                          (Y_AX, p['tail_roll'] * w))
            elif name[2:] in ('UpperArm', 'Forearm', 'Hand'):
                key = 'l' if name[0] == 'L' else 'r'
                sign = 1.0 if key == 'l' else -1.0
                if name.endswith('UpperArm'):
                    d = turns(dp, (X_AX, -p['arm_' + key]), (Y_AX, -sign * p['out_' + key]))
                elif name.endswith('Forearm'):
                    d = turns(dp, (X_AX, -p['elbow_' + key]))
                else:
                    d = turns(dp, (X_AX, p['hand_' + key]))
            elif name[2:] == 'Thigh':
                s = name[:2]
                key = 'l' if s == 'L_' else 'r'
                ball = p['ball_' + key]
                if ball is None:
                    ball = head['Hips'] + q_body @ (self.head[s + 'Toes'] - self.head['Hips'])
                planted = max(0.0, min(1.0, float(p['planted_' + key])))
                leg, meta, toe = self.solve_leg(s, head[name], V(ball), p['meta_' + key], p['toe_' + key],
                                                planted, q_head, lateral, p['yaw'], p['knee_out'])
                d = leg['thigh']
                legs[s + 'Shin'], legs[s + 'Foot'], legs[s + 'Toes'] = leg['shin'], leg['foot'], leg['toes']
                out.reach[key] = leg['reach']
                out.clamp[key] = (meta - p['meta_' + key], toe - p['toe_' + key])
            elif name[2:] in ('Shin', 'Foot', 'Toes'):
                d = legs[name]
            else:
                raise KeyError(name)
            delta[name] = d
            q = dp.inverted() @ d
            rm = self.rest[name]
            out[name] = (rm.inverted() @ q.to_matrix() @ rm).to_quaternion()
        out.hips_loc = self.rest['Hips'].inverted() @ hips_off
        out.head = head
        out.delta = delta
        return out
