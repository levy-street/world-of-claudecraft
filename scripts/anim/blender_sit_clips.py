"""Author the furniture sitting clips (Sit_Chair_* and Sit_High_*) in headless Blender.

WHAT
    Nine clips on the shared KayKit Rig_Medium skeleton that every player class body and
    every modular body rides: a chair family (sit down, idle, stand up, a relaxed idle
    against a backrest, a conversation loop, a drink loop) and a bar-stool family (hop up,
    idle, slide off). The Blender export is re-seated onto the shipped rest pose by
    scripts/build_sit_anims.mjs, which writes public/models/chars/players/sit_anims.glb.

WHY BLENDER
    No shipped donor clip is anywhere near a chair sit: KayKit ships only Sit_Floor_Down /
    Sit_Floor_Idle, legs out on the ground. So this is the escalation path of the
    blender-anim-pipeline skill: scripted keyframe authoring, no capture.

ANCHOR SPACE (the renderer's contract; every number below is in it)
    The renderer draws a seated body with the rig's root at the SEAT ANCHOR: the point on
    the seat surface under the midpoint of the two hip joints, the body facing +Z. So the
    root bone never moves, the hips bone carries the translation, the seat surface is
    y = 0 and the seated hip-joint midpoint sits at x = z = 0. Chair seats are 0.90 yd
    over their floor, bar stools 1.00 yd. Values are authored in YARDS and converted to rig
    units with S_REF, the renderer's normalization scale of the reference body
    (normScale = 2.6 / measured height: knight.glb and the default modular body both
    measure 1.030; the other class bodies spread from 0.95 to 1.21 and scale their whole
    pose about the anchor, which keeps seated contact exact and moves only the floor).

WHY THE POSES READ THE WAY THEY DO
    The KayKit bodies are chibi: the hip joint of a standing knight is 0.54 yd off the
    floor, the thigh is 0.23 yd and the shin 0.15 yd. Seated with the knees bent over a
    seat edge, the soles hang only about 0.15 yd under the seat surface, so on a 0.90 yd
    chair the feet can never reach the floor (nor the 0.35 yd footrest ring of a bar
    stool). The poses therefore follow the classic MMO answer for a short body on a tall
    seat: the body hops UP onto the seat, sits with the thighs on the board and the lower
    legs hanging over the front edge, and hops DOWN to stand. A chibi is also as deep as
    it is short: the upright torso (or helmet) reaches 0.5 yd behind the hip joints and
    the standing body needs 0.6 yd in front of the anchor for its back to clear the seat.
    Two constraints follow for the furniture data, both in anchor space: the seat's front
    edge sits FRONT_EDGE_Z (0.11 yd) in front of the anchor, so the calves hang clear of
    it, and a backrest the relaxed idle leans on sits at BACKREST_Z (0.65 yd behind).
    - The relaxed idle is a slump, not a lean: the pelvis slides forward and rolls back,
      the chest curls, the head tips, so the big head brushes the backrest instead of
      cutting it. Its recline is SOLVED against the plane on the authoring body.
    - Legs are driven by an analytic two-bone IK against either a planted ankle target
      (standing, crouching, landing: the ankle target is held constant through contact, so
      the feet cannot slide) or thigh/knee angles in anchor space (seated: the thighs stay
      level on the board whatever the pelvis does).
    - Hands either follow a world target (reaching for the seat, gestures, the tankard) or
      stay pinned to a point on the thigh (resting), blended by a weight, so a resting hand
      rides the thigh instead of swimming over it.
    - The seated hip height is not guessed: every seated key pose is CALIBRATED on the
      knight's skinned mesh (the lowest buttock/thigh vertex is put SEAT_LIFT over y = 0,
      which leaves the robed and modular bodies within about a centimetre of the board).
    - Only rigid capes and robe back panels cannot follow a seat (they hang straight off
      the chest and pelvis): `--check` reports them apart from the body.
    - Control values are keyed on F-curves and interpolated by Blender (auto-clamped
      Bezier, a Cycles modifier on loops so the loop seam is smooth), with small per-group
      lags (the head and hands trail the torso) for overlapping action. Loop oscillators
      (breathing) are sines whose periods divide the loop and which are zero at t = 0, so
      every loop's first frame is exactly its base pose.
    - Boundaries are exact by construction: a one-shot ends (or starts) on the very same
      calibrated pose dict the loop starts from, and a loop's last frame re-evaluates its
      first key.

HOW TO RUN (authoring time only, never part of the build)
    node scripts/build_sit_anims.mjs --prep        # tmp/sit/knight_plain.glb (+ review rigs)
    blender --background --python scripts/anim/blender_sit_clips.py
    node scripts/build_sit_anims.mjs --verify Idle # retarget gate, expect < 0.5 deg
    node scripts/build_sit_anims.mjs               # bake public/.../sit_anims.glb + contact report
  Optional review renders (contact sheets of every clip on several bodies):
    blender --background --python scripts/anim/blender_sit_clips.py -- --render tmp/sit/renders
        [--only <clip>] [--rigs knight,mage,rogue,modular] [--cell 380x440]
        [--times 0,1.5] [--views side,front,q34]
  Penetration self-check of every clip against the seat, backrest and floor:
    blender --background --python scripts/anim/blender_sit_clips.py -- --check
"""

import math
import os
import sys

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
TMP = os.path.join(ROOT, 'tmp', 'sit')

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


RIG_PATH = arg('--rig', os.path.join(TMP, 'knight_plain.glb'))
OUT_PATH = arg('--out', os.path.join(TMP, 'sit_raw.glb'))
RENDER_DIR = arg('--render')
CHECK = '--check' in ARGV  # print the furniture/floor penetration of every clip
RENDER_ONLY = arg('--only')  # one clip's sheet
RENDER_RIGS = arg('--rigs')  # comma list of review bodies
RENDER_CELL = arg('--cell', '380x440')
RENDER_TIMES = arg('--times')  # override the sheet's frames (seconds, comma list)
RENDER_VIEWS = arg('--views', 'side,q34')

FPS = 30
# The renderer's normScale for knight.glb and for the default modular body (2.6 yd over the
# measured idle height). Anchor-space yards divide by it to become rig units.
S_REF = 1.0300
CHAIR_SEAT_H = 0.90
HIGH_SEAT_H = 1.00
# The authoring body (knight) rests this far over the seat: the robed and modular bodies
# sit 1.5 to 2 cm lower on the same skeleton, so the split keeps every body within about
# a centimetre of the board (measured by build_sit_anims.mjs on the shipped meshes).
SEAT_LIFT = 0.007
# The seat's front edge the hanging shins must clear, in anchor space (yards).
FRONT_EDGE_Z = 0.11
# The relaxed pose's backrest plane (yards behind the anchor). A seated chibi torso (and a
# helmet) reaches about 0.5 yd behind its hip joints while upright, so a nearer plane would
# cut through the body; this is the tavern chair's back (tavern_furnish.py chair(), r 0.45)
# once its anchor sits FRONT_EDGE_Z behind the seat's front edge.
BACKREST_Z = -0.65
# The relaxed pose leans to this short of the plane: its head turns and breathing then
# brush the backrest instead of pushing through it.
RELAXED_CLEARANCE = 0.02

# ---------------------------------------------------------------------------
# Frames. Anchor space is the renderer's (three.js): +Y up, +Z the body's forward, +X the
# body's left. The glTF importer maps it to Blender as (x, y, z) -> (x, -z, y).
# ---------------------------------------------------------------------------


def to_bl(x, y, z):
    """Anchor-space yards -> Blender armature space, rig units."""
    return Vector((x, -z, y)) / S_REF


def from_bl(v):
    """Blender armature space (rig units) -> anchor-space yards (x, y, z)."""
    return (v.x * S_REF, v.z * S_REF, -v.y * S_REF)


def rot(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def body_euler(p, y, r):
    """Body-axis rotation: pitch + bends forward, yaw + turns to the body's left, roll +
    tilts toward the left shoulder (Blender: +X left, -Y forward, +Z up)."""
    return rot('Z', y) @ rot('X', p) @ rot('Y', r)


def T(v):
    return Matrix.Translation(v)


# ---------------------------------------------------------------------------
# The rig: rest data and the pose solver.
# ---------------------------------------------------------------------------


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.bones = list(arm.data.bones)  # parents come before children
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.head = {b.name: b.head_local.copy() for b in self.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in self.bones}
        h = self.head
        self.mid_rest = (h['upperleg.l'] + h['upperleg.r']) / 2
        self.leg = {}
        for s in 'lr':
            H, K, A = h[f'upperleg.{s}'], h[f'lowerleg.{s}'], h[f'foot.{s}']
            self.leg[s] = {
                'L1': (K - H).length,
                'L2': (A - K).length,
                'hinge': (K - H).cross(A - K).normalized(),
                'ball': h[f'toes.{s}'] - A,  # ankle -> ball of the foot, rest
            }
            S, E, W = h[f'upperarm.{s}'], h[f'lowerarm.{s}'], h[f'hand.{s}']
            self.leg[s]['arm'] = {
                'L1': (E - S).length,
                'L2': (W - E).length,
                'hinge': (E - S).cross(W - E).normalized(),
            }

    # -- helpers ---------------------------------------------------------------
    def G(self, parent_g, bone, D):
        """Rest->posed rigid map of `bone`, turned by D about its own head."""
        hb = self.head[bone]
        return parent_g @ T(hb) @ D @ T(-hb)

    @staticmethod
    def ik(Hj, A, L1, L2, pole):
        """Two-bone IK: the knee/elbow position for root Hj, end A, a bend toward `pole`."""
        d_vec = A - Hj
        d = d_vec.length
        lo, hi = abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995
        clamped = d > hi or d < lo
        d = min(max(d, lo), hi)
        u = d_vec.normalized()
        A = Hj + u * d
        cos_a = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
        sin_a = math.sqrt(max(0.0, 1 - cos_a * cos_a))
        v = pole - u * pole.dot(u)
        if v.length < 1e-6:
            v = Vector((0, -1, 0)) - u * (-u.y)
        v.normalize()
        return Hj + (u * cos_a + v * sin_a) * L1, A, clamped

    @staticmethod
    def frame_map(h0, d0, h1, d1):
        """The rotation taking the orthonormal pair (hinge h0, segment d0) onto (h1, d1)."""
        def basis(h, d):
            d = d.normalized()
            h = (h - d * h.dot(d)).normalized()
            c = h.cross(d)
            return Matrix((h, d, c)).transposed()
        return (basis(h1, d1) @ basis(h0, d0).transposed()).to_4x4()

    def solve(self, p):
        """Posed armature-space matrices for every bone from a control dict."""
        h = self.head
        posed = {}
        G = {'root': Matrix.Identity(4)}
        Rp = body_euler(p['pelvis.p'], p['pelvis.y'], p['pelvis.r'])
        mid = to_bl(p['hip.x'], p['hip.y'], p['hip.z'])
        G['hips'] = T(mid) @ Rp @ T(-self.mid_rest)
        G['spine'] = self.G(G['hips'], 'spine', body_euler(p['spine.p'], p['spine.y'], p['spine.r']))
        G['chest'] = self.G(G['spine'], 'chest', body_euler(p['chest.p'], p['chest.y'], p['chest.r']))
        G['head'] = self.G(G['chest'], 'head', body_euler(p['head.p'], p['head.y'], p['head.r']))
        for n in ('root', 'hips', 'spine', 'chest', 'head'):
            posed[n] = G[n] @ self.rest[n]
        self.clamped = []
        for s in 'lr':
            self._leg(p, s, G, posed)
            self._arm(p, s, G, posed)
        return posed

    def _leg(self, p, s, G, posed):
        """Seated/free mode (plant = 0): thigh and shin angles in ANCHOR space (so a thigh
        stays level on the board whatever the pelvis does) and the foot relative to the
        shin. Planted mode (plant = 1): an ankle target, a knee pole and a world foot. The
        two are blended by `plant`, then one IK solve places the chain."""
        L = self.leg[s]
        h = self.head
        side = 1 if s == 'l' else -1
        Hj = (G['hips'] @ h[f'upperleg.{s}'].to_4d()).to_3d()
        down = Vector((0, 0, -1))
        splay = rot('Z', side * p[f'{s}.splay'])
        shin_pitch = p[f'{s}.thigh'] - p[f'{s}.knee']  # the shin's forward swing off vertical
        K_fk = Hj + ((splay @ rot('X', -p[f'{s}.thigh'])).to_3x3() @ down) * L['L1']
        A_fk = K_fk + ((splay @ rot('X', -shin_pitch)).to_3x3() @ down) * L['L2']
        u = (A_fk - Hj).normalized()
        pole_fk = (K_fk - Hj) - u * (K_fk - Hj).dot(u)
        foot_fk = splay @ rot('X', -shin_pitch) @ rot('X', p[f'{s}.flex'])
        A_pl = to_bl(side * p[f'{s}.ax'], p[f'{s}.ay'], p[f'{s}.az'])
        pole_pl = to_bl(side * p[f'{s}.kx'], p[f'{s}.ky'], 1.0)
        foot_pl = rot('Z', side * p[f'{s}.fy']) @ rot('X', p[f'{s}.fp'])
        tip = p[f'{s}.tip']
        if tip:
            # up on the ball of the foot: pivot the planted foot about its ball, so the
            # ball stays exactly where the flat foot put it at every pitch
            ball = A_pl + (foot_pl.to_3x3() @ L['ball'])
            foot_pl = foot_pl @ rot('X', tip)
            A_pl = ball - (foot_pl.to_3x3() @ L['ball'])
        w = p[f'{s}.plant']
        A = A_fk.lerp(A_pl, w)
        pole = pole_fk.normalized().lerp(pole_pl.normalized(), w)
        Rf = foot_fk.to_quaternion().slerp(foot_pl.to_quaternion(), w).to_matrix().to_4x4()
        K, A, clamped = self.ik(Hj, A, L['L1'], L['L2'], pole)
        if clamped:
            self.clamped.append(f'leg.{s}')
        hinge = (K - Hj).cross(A - K)
        if hinge.length < 1e-6:
            hinge = splay.to_3x3() @ Vector((1, 0, 0))
        Rth = self.frame_map(L['hinge'], h[f'lowerleg.{s}'] - h[f'upperleg.{s}'], hinge, K - Hj)
        Rsh = self.frame_map(L['hinge'], h[f'foot.{s}'] - h[f'lowerleg.{s}'], hinge, A - K)
        posed[f'upperleg.{s}'] = T(Hj) @ Rth @ self.rest[f'upperleg.{s}'].to_3x3().to_4x4()
        posed[f'lowerleg.{s}'] = T(K) @ Rsh @ self.rest[f'lowerleg.{s}'].to_3x3().to_4x4()
        posed[f'foot.{s}'] = T(A) @ Rf @ self.rest[f'foot.{s}'].to_3x3().to_4x4()
        g_foot = posed[f'foot.{s}'] @ self.rest[f'foot.{s}'].inverted()
        # the toes stay flat on the floor while the heel is up
        g_toes = self.G(g_foot, f'toes.{s}', rot('X', p[f'{s}.toes'] - w * p[f'{s}.tip']))
        posed[f'toes.{s}'] = g_toes @ self.rest[f'toes.{s}']

    def _arm(self, p, s, G, posed):
        """World mode (onthigh = 0): a hand target, a finger direction and a palm normal (anchor
        space, x mirrored for the right side, see hand_dirs()). Thigh mode (onthigh = 1): the hand rests on a point of the
        thigh's top, fingers along the thigh. Blended by `onthigh`, then one IK solve."""
        L = self.leg[s]['arm']
        h = self.head
        side = 1 if s == 'l' else -1
        Sj = (G['chest'] @ h[f'upperarm.{s}'].to_4d()).to_3d()

        def fingers_palm(az, el, roll, fwd, lat, up):
            a, e = math.radians(az), math.radians(el)
            f = (fwd * math.cos(a) + lat * math.sin(a)) * math.cos(e) + up * math.sin(e)
            f.normalize()
            ref = -up - f * (-up).dot(f)
            if ref.length < 1e-4:
                ref = -fwd - f * (-fwd).dot(f)
            ref.normalize()
            palm = Quaternion(f, math.radians(-side * roll)) @ ref
            return f, palm

        fwd_w, lat_w, up_w = Vector((0, -1, 0)), Vector((side, 0, 0)), Vector((0, 0, 1))
        W_w = to_bl(p[f'{s}.hx'] * side, p[f'{s}.hy'], p[f'{s}.hz'])
        f_w = to_bl(p[f'{s}.dx'] * side, p[f'{s}.dy'], p[f'{s}.dz']).normalized()
        n_w = to_bl(p[f'{s}.nx'] * side, p[f'{s}.ny'], p[f'{s}.nz']).normalized()
        th0 = posed[f'upperleg.{s}'].translation.copy()
        th1 = posed[f'lowerleg.{s}'].translation.copy()
        along = (th1 - th0).normalized()
        up_t = lat_w.cross(along)
        if up_t.z < 0:
            up_t = -up_t
        up_t.normalize()
        lat_t = along.cross(up_t).normalized()
        if lat_t.dot(lat_w) < 0:
            lat_t = -lat_t
        W_t = th0.lerp(th1, p[f'{s}.tu']) + lat_t * (p[f'{s}.tx'] / S_REF) + up_t * (p[f'{s}.ty'] / S_REF)
        f_t, n_t = fingers_palm(p[f'{s}.taz'], p[f'{s}.tel'], p[f'{s}.troll'], along, lat_t, up_t)
        w = p[f'{s}.onthigh']
        W = W_w.lerp(W_t, w)
        rest_rot = self.rest[f'hand.{s}'].to_3x3()
        # the rest finger axis is the hand bone's own direction; its palm, straight down
        R_w = self.frame_map(Vector((0, 0, -1)), rest_rot.col[1], n_w, f_w)
        R_t = self.frame_map(Vector((0, 0, -1)), rest_rot.col[1], n_t, f_t)
        Rh = R_w.to_quaternion().slerp(R_t.to_quaternion(), w).to_matrix().to_4x4()
        pole = to_bl(p[f'{s}.ex'] * side, p[f'{s}.ey'], p[f'{s}.ez'])
        E, W, clamped = self.ik(Sj, W, L['L1'], L['L2'], pole)
        if clamped:
            self.clamped.append(f'arm.{s}')
        hinge = (E - Sj).cross(W - E)
        if hinge.length < 1e-6:
            hinge = L['hinge']
        Ru = self.frame_map(L['hinge'], h[f'lowerarm.{s}'] - h[f'upperarm.{s}'], hinge, E - Sj)
        Rl = self.frame_map(L['hinge'], h[f'hand.{s}'] - h[f'lowerarm.{s}'], hinge, W - E)
        posed[f'upperarm.{s}'] = T(Sj) @ Ru @ self.rest[f'upperarm.{s}'].to_3x3().to_4x4()
        posed[f'lowerarm.{s}'] = T(E) @ Rl @ self.rest[f'lowerarm.{s}'].to_3x3().to_4x4()
        # KayKit never animates the wrist bone (every shipped clip keeps it at rest), so it
        # rides the forearm rigidly and the hand bone carries the whole hand orientation.
        wrist_head = E + (Rl @ (h[f'wrist.{s}'] - h[f'lowerarm.{s}']).to_4d()).to_3d()
        posed[f'wrist.{s}'] = T(wrist_head) @ Rl @ self.rest[f'wrist.{s}'].to_3x3().to_4x4()
        posed[f'hand.{s}'] = T(W) @ Rh @ rest_rot.to_4x4()
        g_hand = posed[f'hand.{s}'] @ self.rest[f'hand.{s}'].inverted()
        posed[f'handslot.{s}'] = g_hand @ self.rest[f'handslot.{s}']

    def apply(self, posed):
        """Write the posed matrices into the pose bones' local channels."""
        for b in self.bones:
            n = b.name
            pn = self.parent[n]
            if pn:
                basis = self.rest[n].inverted() @ self.rest[pn] @ posed[pn].inverted() @ posed[n]
            else:
                basis = self.rest[n].inverted() @ posed[n]
            loc, q, _ = basis.decompose()
            pb = self.arm.pose.bones[n]
            pb.rotation_mode = 'QUATERNION'
            prev = pb.rotation_quaternion
            if prev.dot(q) < 0:
                q.negate()
            pb.location = loc
            pb.rotation_quaternion = q
            pb.scale = (1, 1, 1)


# ---------------------------------------------------------------------------
# Control parameters. Every pose is a complete dict of these; F-curves interpolate them.
# Positions are anchor-space yards, angles degrees; a leading `l.` / `r.` is per side,
# and every per-side x (and yaw) is mirrored so one number reads the same on both sides.
# ---------------------------------------------------------------------------

BODY_KEYS = ['hip.x', 'hip.y', 'hip.z', 'pelvis.p', 'pelvis.y', 'pelvis.r',
             'spine.p', 'spine.y', 'spine.r', 'chest.p', 'chest.y', 'chest.r',
             'head.p', 'head.y', 'head.r']
LEG_FREE = ('splay', 'thigh', 'knee', 'flex', 'toes')
LEG_PLANT = ('plant', 'ax', 'ay', 'az', 'kx', 'ky', 'fp', 'fy', 'tip')
ARM_WORLD = ('hx', 'hy', 'hz', 'dx', 'dy', 'dz', 'nx', 'ny', 'nz', 'ex', 'ey', 'ez')
ARM_THIGH = ('onthigh', 'tu', 'tx', 'ty', 'taz', 'tel', 'troll')
SIDE_KEYS = LEG_FREE + LEG_PLANT + ARM_WORLD + ARM_THIGH
ALL_KEYS = BODY_KEYS + [f'{s}.{k}' for s in 'lr' for k in SIDE_KEYS]

# Overlapping action for the one-shots: how far (seconds) each group trails the key times.
LAGS = {'head': 0.07, 'chest': 0.03, 'arm': 0.05, 'leg': 0.04}


def lag_group(k):
    if k.startswith('head.'):
        return 'head'
    if k.startswith('chest.'):
        return 'chest'
    if k[:2] in ('l.', 'r.'):
        tail = k[2:]
        if tail in LEG_FREE and tail != 'toes':  # toes stay locked to the foot's pitch
            return 'leg'
        if tail in ARM_WORLD or tail in ARM_THIGH:
            return 'arm'
    return None


def P(base, *overlays, **kw):
    """A pose: `base`, then overlay dicts, then keyword overrides. `l_thigh=90` sets
    'l.thigh', `b_thigh=90` sets both sides, `hip_y=0.1` sets 'hip.y'."""
    out = dict(base)
    for o in overlays:
        out.update(o)
    for k, v in kw.items():
        head, _, tail = k.partition('_')
        if head == 'b':
            out[f'l.{tail}'] = v
            out[f'r.{tail}'] = v
        else:
            out[f'{head}.{tail}'] = v
    return out


def hand_dirs(az, el, roll):
    """Finger direction + palm normal (anchor space, as the left side sees it; the right
    mirrors) from an azimuth off the body's forward (+ outward), an elevation (+ up) and a
    roll about the fingers (+ turns the thumb up, the palm toward the midline)."""
    a, e = math.radians(az), math.radians(el)
    f = Vector((math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)))
    ref = Vector((0, -1, 0)) - f * (-f.y)
    if ref.length < 1e-4:
        ref = Vector((0, 0, -1)) - f * (-f.z)
    ref.normalize()
    n = Quaternion(f, math.radians(-roll)) @ ref
    return {'dx': f.x, 'dy': f.y, 'dz': f.z, 'nx': n.x, 'ny': n.y, 'nz': n.z}


def hand(side, x, y, z, az=0.0, el=0.0, roll=0.0, ex=0.6, ey=-0.3, ez=-0.7):
    """World-mode overrides for one arm ('l', 'r', or 'b' for a mirrored pair): the hand
    bone's head at (x, y, z) yards (x outward), fingers/palm by hand_dirs(), the elbow
    pointing along (ex, ey, ez) (ex outward)."""
    d = hand_dirs(az, el, roll)
    kv = {'onthigh': 0.0, 'hx': x, 'hy': y, 'hz': z, 'ex': ex, 'ey': ey, 'ez': ez, **d}
    sides = 'lr' if side == 'b' else side
    return {f'{s}.{k}': v for s in sides for k, v in kv.items()}


def rest_on_thigh(side, tu=0.62, tx=0.0, ty=0.075, taz=-8.0, tel=-4.0, troll=0.0,
                  ex=0.75, ey=-0.1, ez=-0.65):
    """Thigh-mode overrides: the hand lies on the thigh's top, `tu` of the way to the knee."""
    kv = {'onthigh': 1.0, 'tu': tu, 'tx': tx, 'ty': ty, 'taz': taz, 'tel': tel,
          'troll': troll, 'ex': ex, 'ey': ey, 'ez': ez}
    sides = 'lr' if side == 'b' else side
    return {f'{s}.{k}': v for s in sides for k, v in kv.items()}


def free_legs(side='b', splay=6.0, thigh=90.0, knee=92.0, flex=20.0, toes=0.0):
    kv = {'plant': 0.0, 'splay': splay, 'thigh': thigh, 'knee': knee, 'flex': flex, 'toes': toes}
    sides = 'lr' if side == 'b' else side
    return {f'{s}.{k}': v for s in sides for k, v in kv.items()}


ZERO = {k: 0.0 for k in ALL_KEYS}
for _s in 'lr':
    ZERO.update({f'{_s}.dz': 1.0, f'{_s}.ny': -1.0, f'{_s}.kx': 0.15, f'{_s}.ky': 0.3,
                 f'{_s}.ez': -1.0,
                 f'{_s}.ex': 0.5, f'{_s}.tu': 0.6})


# ---------------------------------------------------------------------------
# Scene plumbing, measurement and calibration
# ---------------------------------------------------------------------------


def import_rig(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER')
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH']
    return arm, meshes


def evaluated_verts(meshes, groups):
    """(mesh, dominant group, anchor-space yards) for every skinned vertex, posed."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in meshes:
        if o.name not in groups:
            names = {g.index: g.name for g in o.vertex_groups}
            top = []
            for v in o.data.vertices:
                best = max(v.groups, key=lambda g: g.weight, default=None)
                top.append(names.get(best.group) if best else None)
            groups[o.name] = top
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        mw = o.matrix_world
        for v, g in zip(me.vertices, groups[o.name]):
            out.append((o.name, g, from_bl(mw @ v.co)))
        oe.to_mesh_clear()
    return out


SEAT_GROUPS = {'hips', 'upperleg.l', 'upperleg.r'}


def draped(name):
    """A cape or a back piece: stiff geometry hanging off the chest, never a seat contact."""
    return 'Cape' in name or 'Back' in name


class Author:
    def __init__(self, arm, meshes):
        self.rig = Rig(arm)
        self.arm = arm
        self.meshes = meshes
        self.groups = {}

    def pose(self, p):
        self.rig.apply(self.rig.solve(p))
        bpy.context.view_layer.update()

    def verts(self, p):
        self.pose(p)
        return evaluated_verts(self.meshes, self.groups)

    def seat_contact(self, p):
        """Lowest buttock/thigh skin over the board (z up to the front edge)."""
        return min(c[1] for n, g, c in self.verts(p)
                   if g in SEAT_GROUPS and not draped(n) and c[2] <= FRONT_EDGE_Z)

    def back_contact(self, p):
        """Rearmost upper-back or head skin above the seat (a helmet or a big head leans on
        the backrest before the shoulders do)."""
        return min(c[2] for n, g, c in self.verts(p)
                   if g in ('chest', 'spine', 'head') and not draped(n) and c[1] > 0.3)

    def calibrate_seat(self, p):
        """Put the lowest buttock/thigh vertex SEAT_LIFT over the seat. The hips bone
        carries every other joint, so one step is exact."""
        p['hip.y'] += SEAT_LIFT - self.seat_contact(p)
        return p

    def calibrate_back(self, p, recline):
        """Scale the pose's recline angles (`recline`: key -> degrees at scale 1) until the
        upper back meets the backrest plane, re-seating the pelvis at every step."""
        lo, hi = 0.0, 3.0
        for _ in range(18):
            mid = (lo + hi) / 2
            q = dict(p)
            for k, v in recline.items():
                q[k] = p[k] + v * mid
            self.calibrate_seat(q)
            if self.back_contact(q) > BACKREST_Z + RELAXED_CLEARANCE:
                lo = mid
            else:
                hi = mid
        for k, v in recline.items():
            p[k] = p[k] + v * hi
        return self.calibrate_seat(p)

    def standing_from_idle(self, seat_h, stand_z):
        """The shipped Idle's first frame as control values, moved onto the floor in front
        of the seat: the standing pose the one-shots start or end on, so the renderer's
        crossfade from the stock Idle into Sit_*_Down blends two near-identical poses."""
        rig = self.rig
        act = bpy.data.actions['Idle']
        ad = self.arm.animation_data or self.arm.animation_data_create()
        ad.action = act
        if act.slots:
            ad.action_slot = act.slots[0]
        bpy.context.scene.frame_set(0)
        bpy.context.view_layer.update()
        M = {b.name: self.arm.pose.bones[b.name].matrix.copy() for b in rig.bones}
        ad.action = None
        for pb in self.arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        p = dict(ZERO)

        def body(R):
            e = R.to_euler('YXZ')
            return math.degrees(e.x), math.degrees(e.z), math.degrees(e.y)

        g = {n: M[n] @ rig.rest[n].inverted() for n in M}
        mid = (M['upperleg.l'].translation + M['upperleg.r'].translation) / 2
        _, y, z = from_bl(mid)
        p.update({'hip.x': 0.0, 'hip.y': y - seat_h, 'hip.z': z + stand_z})
        p['pelvis.p'], p['pelvis.y'], p['pelvis.r'] = body(g['hips'].to_3x3())
        for n, par in (('spine', 'hips'), ('chest', 'spine'), ('head', 'chest')):
            p[f'{n}.p'], p[f'{n}.y'], p[f'{n}.r'] = body((g[par].inverted() @ g[n]).to_3x3())
        for s in 'lr':
            side = 1 if s == 'l' else -1
            ax, ay, az = from_bl(M[f'foot.{s}'].translation)
            e = g[f'foot.{s}'].to_3x3().to_euler('XYZ')
            H, K, A = (M[f'{b}.{s}'].translation for b in ('upperleg', 'lowerleg', 'foot'))
            u = (A - H).normalized()
            kp = (K - H) - u * (K - H).dot(u)
            p.update({f'{s}.plant': 1.0, f'{s}.ax': ax * side, f'{s}.ay': ay - seat_h,
                      f'{s}.az': az + stand_z,
                      f'{s}.kx': (side * kp.x / -kp.y) if kp.y < -1e-6 else 0.2,
                      f'{s}.ky': (kp.z / -kp.y) if kp.y < -1e-6 else 0.3,
                      f'{s}.fp': math.degrees(e.x), f'{s}.fy': side * math.degrees(e.z)})
            p[f'{s}.toes'] = math.degrees(
                (g[f'foot.{s}'].inverted() @ g[f'toes.{s}']).to_3x3().to_euler('XYZ').x)
            hx, hy, hz = from_bl(M[f'hand.{s}'].translation)
            fx, fy, fz = from_bl(M[f'hand.{s}'].to_3x3().col[1].normalized())
            nx, ny, nz = from_bl((g[f'hand.{s}'].to_3x3() @ Vector((0, 0, -1))).normalized())
            S, E, Wj = (M[f'{b}.{s}'].translation for b in ('upperarm', 'lowerarm', 'hand'))
            u = (Wj - S).normalized()
            ex, ey, ez = from_bl(((E - S) - u * (E - S).dot(u)).normalized())
            p.update({f'{s}.onthigh': 0.0, f'{s}.hx': hx * side, f'{s}.hy': hy - seat_h,
                      f'{s}.hz': hz + stand_z, f'{s}.dx': fx * side, f'{s}.dy': fy,
                      f'{s}.dz': fz, f'{s}.nx': nx * side, f'{s}.ny': ny, f'{s}.nz': nz,
                      f'{s}.ex': ex * side, f'{s}.ey': ey, f'{s}.ez': ez})
        return p


# ---------------------------------------------------------------------------
# Timeline machinery: keys -> F-curves (Blender interpolates) -> a baked action
# ---------------------------------------------------------------------------


class Clip:
    def __init__(self, name, dur, keys, loop=False, osc=None):
        self.name = name
        self.dur = dur
        self.frames = int(round(dur * FPS))
        self.keys = list(keys)
        self.loop = loop
        self.osc = osc
        if loop:
            # a loop closes on its own first pose, every channel
            self.keys.append((dur, self.keys[0][1]))


def control_curves(clip):
    """Key every control value on a throwaway Empty and hand back its F-curves."""
    ctl = bpy.data.objects.new(f'ctl_{clip.name}', None)
    bpy.context.scene.collection.objects.link(ctl)
    act = bpy.data.actions.new(f'ctl_{clip.name}')
    ctl.animation_data_create()
    ctl.animation_data.action = act
    for k in ALL_KEYS:
        ctl[k] = 0.0
    for t, pose in clip.keys:
        for k in ALL_KEYS:
            ctl[k] = float(pose[k])  # an int would turn the property (and its curve) integer
            ctl.keyframe_insert(f'["{k}"]', frame=t * FPS)
    cb = anim_utils.action_get_channelbag_for_slot(act, ctl.animation_data.action_slot)
    curves = {}
    for k in ALL_KEYS:
        fc = cb.fcurves.find(f'["{k}"]')
        if clip.loop:
            fc.modifiers.new('CYCLES')
        fc.update()
        curves[k] = fc
    return ctl, curves


def lag_window(t, dur):
    """Lags fade in and out over the first and last 0.15 s, so a one-shot's first and last
    frames stay exactly on their key poses."""
    ramp = 0.15
    w = min(1.0, t / ramp, (dur - t) / ramp)
    w = max(0.0, w)
    return w * w * (3 - 2 * w)


def sample(clip, curves, t):
    p = {}
    for k in ALL_KEYS:
        tt = t
        if not clip.loop:
            g = lag_group(k)
            if g:
                tt = min(clip.dur, max(0.0, t - LAGS[g] * lag_window(t, clip.dur)))
        p[k] = curves[k].evaluate(tt * FPS)
    if clip.osc:
        for k, v in clip.osc(t).items():
            p[k] += v
    return p


def bake(author, clip):
    """Evaluate the controls every frame, solve the rig, and key every bone."""
    arm = author.arm
    ctl, curves = control_curves(clip)
    act = bpy.data.actions.new(clip.name)
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    clamps = {}
    for f in range(clip.frames + 1):
        t = f / FPS
        # a loop's last frame IS its first (the closing key re-evaluates key 0 exactly)
        p = sample(clip, curves, 0.0 if (clip.loop and f == clip.frames) else t)
        posed = author.rig.solve(p)
        for c in author.rig.clamped:
            clamps.setdefault(c, []).append(f)
        author.rig.apply(posed)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if pb.name == 'hips':
                pb.keyframe_insert('location', frame=f)
    ad.action = None
    bpy.data.objects.remove(ctl)
    act.use_fake_user = True
    if clamps:
        for c, fs in sorted(clamps.items()):
            print(f'  note: {clip.name} {c} at full extension, frames {fs[0]}..{fs[-1]} ({len(fs)})')
    return act


# ---------------------------------------------------------------------------
# The poses. Every number here is anchor-space yards or degrees.
# ---------------------------------------------------------------------------

# The standing body's hip line in front of the seat. A chibi torso is as deep behind the
# hips as it is tall over them, so the body stands this far out for its back to clear the
# seat's front edge (the heels land near z = 0.57).
STAND_Z = 0.62


def tiptoe(p, deg, sides='lr'):
    """Up on the balls of the feet by `deg` (the solver pivots each planted foot about its
    ball, so the ball does not move while the heel lifts)."""
    q = dict(p)
    for s in sides:
        q[f'{s}.tip'] = p[f'{s}.tip'] + deg
    return q


def build_poses(author):
    """Every named pose, the seated ones calibrated on the knight's mesh."""
    A = author
    poses = {}
    poses['stand_chair'] = A.standing_from_idle(CHAIR_SEAT_H, STAND_Z)
    poses['stand_high'] = A.standing_from_idle(HIGH_SEAT_H, STAND_Z)

    # Upright on a chair: thighs level on the board, shins hanging just past vertical,
    # feet relaxed toes-down, hands resting on the thighs near the knees, eyes level.
    seated = P(ZERO, free_legs(splay=7, thigh=89, knee=79, flex=28),
               rest_on_thigh('b', tu=0.62, taz=-14),
               pelvis_p=-3, spine_p=3, chest_p=2, head_p=-2)
    poses['sit'] = A.calibrate_seat(seated)

    # Perched on a bar stool: pelvis rolled forward, leaning in over the thighs, hands near
    # the knees with the elbows out, the lower legs swinging free (the ring is out of reach).
    high = P(ZERO, free_legs(splay=9, thigh=84, knee=82, flex=30),
             rest_on_thigh('b', tu=0.8, ty=0.08, taz=-18, ex=0.9, ey=-0.1, ez=-0.4),
             pelvis_p=3, spine_p=6, chest_p=6, head_p=-11, l_knee=70, r_knee=76)
    poses['high'] = A.calibrate_seat(high)

    # Slouched back against a backrest: the pelvis slides a little forward and rolls back,
    # the lower back rounds while the chest curls forward (a slump, not a lean: the big head
    # would meet the backrest long before a straight back did), the head tips to one side,
    # the knees fall open and the legs stretch out, one hand on the belly, one on a thigh.
    relaxed = P(ZERO, free_legs(splay=15, thigh=84, knee=66, flex=16),
                rest_on_thigh('l', tu=0.55, ty=0.085, taz=-22, ex=0.9, ey=0.0, ez=-0.3),
                hand('r', 0.10, 0.36, 0.20, az=-75, el=-15, roll=10, ex=0.9, ey=-0.4, ez=-0.1),
                hip_z=0.06, pelvis_p=-6, spine_p=0, chest_p=5, head_p=2, head_r=-5, head_y=4,
                l_knee=58, r_knee=70, l_splay=17)
    poses['relaxed'] = A.calibrate_back(relaxed, {'pelvis.p': -6.0, 'spine.p': -2.0,
                                                  'chest.p': -1.0, 'head.p': 8.0})
    return poses


def breathing(amp=0.8, period=3.0):
    def osc(t):
        s = math.sin(2 * math.pi * t / period)
        return {'chest.p': amp * s, 'head.p': -0.5 * amp * s, 'spine.p': 0.3 * amp * s}
    return osc


def combine(*oscs):
    def osc(t):
        out = {}
        for o in oscs:
            for k, v in o(t).items():
                out[k] = out.get(k, 0.0) + v
        return out
    return osc


def hop_up(A, stand, sit, hands_z, hands_x, times):
    """Standing in front of a seat higher than the hips: glance back, set both hands on the
    seat's front edge, crouch, spring up onto the toes and back, clear the edge high, land
    on the seat with the legs swinging forward, settle into `sit`."""
    t_glance, t_reach, t_push, t_apex, t_land, t_settle, t_end = times
    rise = sit['hip.y'] - stand['hip.y']
    glance = P(stand, hand('l', 0.24, -0.12, 0.30, az=25, el=-25, ex=0.5, ey=0.2, ez=0.6),
               head_y=34, head_p=6, chest_y=10, spine_y=4, hip_y=stand['hip.y'] - 0.02)
    on_edge = hand('b', hands_x, 0.055, hands_z, az=15, el=-5, ex=0.4, ey=0.3, ez=0.8)
    reach = P(stand, on_edge, head_y=10, head_p=8, chest_y=3, chest_p=8, spine_p=6,
              hip_y=stand['hip.y'] - 0.10, hip_z=STAND_Z - 0.03)
    push = tiptoe(P(reach, hip_y=stand['hip.y'] + 0.02, hip_z=STAND_Z - 0.05, chest_p=5,
                    spine_p=3, head_y=0, head_p=2), 35)
    apex = P(ZERO, free_legs(splay=8, thigh=62, knee=58, flex=35),
             hand('b', 0.30, 0.36, 0.16, az=30, el=-40, ex=0.6, ey=0.2, ez=0.6),
             hip_y=stand['hip.y'] + rise + 0.18, hip_z=0.27, pelvis_p=-4, spine_p=4,
             chest_p=3, head_p=2)
    land = A.calibrate_seat(P(sit, free_legs(splay=8, thigh=96, knee=55, flex=12),
                              hand('b', 0.30, 0.40, 0.30, az=20, el=-20, roll=30,
                                   ex=0.8, ey=-0.3, ez=-0.4),
                              pelvis_p=-2, spine_p=2, chest_p=1, head_p=5))
    land['hip.y'] -= 0.008  # the landing squashes into the seat for a frame or two
    settle = A.calibrate_seat(P(sit, free_legs(splay=sit['l.splay'], thigh=sit['l.thigh'],
                                               knee=sit['l.knee'] + 2, flex=sit['l.flex'] + 4),
                                pelvis_p=sit['pelvis.p'] + 1, spine_p=sit['spine.p'] + 2,
                                chest_p=sit['chest.p'] + 2, head_p=sit['head.p'] - 2,
                                b_ty=sit['l.ty'] + 0.03))
    return [(0.0, stand), (t_glance, glance), (t_reach, reach), (t_push, push),
            (t_apex, apex), (t_land, land), (t_settle, settle), (t_end, sit)]


def slide_off(A, sit, stand, times):
    """Seated high above the floor: lean in and push on the knees, slide forward to the
    front edge, clear it, drop to the floor, absorb, rise to `stand`."""
    t_prep, t_scoot, t_clear, t_touch, t_rise, t_end = times
    prep = A.calibrate_seat(P(sit, free_legs(splay=8, thigh=sit['l.thigh'], knee=80, flex=20),
                              rest_on_thigh('b', tu=0.95, ty=0.08, taz=-10, ex=0.8, ey=0.1,
                                            ez=-0.5),
                              spine_p=sit['spine.p'] + 6, chest_p=sit['chest.p'] + 4,
                              head_p=6))
    scoot = P(prep, free_legs(splay=8, thigh=70, knee=62, flex=26),
              hip_y=sit['hip.y'] + 0.02, hip_z=0.15, pelvis_p=6, spine_p=9, chest_p=6,
              head_p=6)
    clear = P(scoot, free_legs(splay=8, thigh=35, knee=25, flex=30), b_tu=1.0,
              hip_y=sit['hip.y'] - 0.01, hip_z=0.40, pelvis_p=6, spine_p=8, chest_p=4,
              head_p=0)
    balance = hand('b', 0.26, -0.10, 0.72, az=-10, el=0, roll=40, ex=0.8, ey=-0.3, ez=-0.4)
    touch = P(stand, balance, hip_y=stand['hip.y'] - 0.12, hip_z=STAND_Z - 0.03, spine_p=10,
              chest_p=6, head_p=-6)
    rise = P(stand, hip_y=stand['hip.y'] - 0.03, spine_p=4, chest_p=3, head_p=-2)
    return [(0.0, sit), (t_prep, prep), (t_scoot, scoot), (t_clear, clear), (t_touch, touch),
            (t_rise, rise), (t_end, stand)]


def clips(author, poses):
    A = author
    SIT, HIGH, REL = poses['sit'], poses['high'], poses['relaxed']
    STC, STH = poses['stand_chair'], poses['stand_high']

    def seat(p):
        return A.calibrate_seat(p)

    out = []
    out.append(Clip('Sit_Chair_Down', 1.2,
                    hop_up(A, STC, SIT, 0.13, 0.30, (0.22, 0.42, 0.54, 0.68, 0.82, 0.98, 1.2))))

    # -- Sit_Chair_Idle: breathing, a slow look round, small weight shifts, lazy legs ------
    kl, kr = SIT['l.knee'], SIT['r.knee']
    look_l = seat(P(SIT, head_y=20, head_p=-4, head_r=2, chest_y=4, l_knee=kl - 6))
    look_l2 = seat(P(SIT, head_y=24, head_p=-1, head_r=4, chest_y=5, l_knee=kl - 3))
    shift_r = seat(P(SIT, head_y=-12, head_p=-3, pelvis_r=-1.8, hip_x=-0.008, r_knee=kr - 7,
                     chest_y=-3, chest_r=1))
    back = seat(P(SIT, head_y=-4, head_p=-2))
    out.append(Clip('Sit_Chair_Idle', 6.0, [
        (0.0, SIT), (1.3, look_l), (2.5, look_l2), (3.4, SIT), (4.4, shift_r), (5.3, back)],
        loop=True, osc=combine(breathing(), lambda t: {
            'l.knee': -1.5 * (1 - math.cos(2 * math.pi * t / 6.0)),
            'r.knee': -1.2 * (1 - math.cos(2 * math.pi * t / 3.0))})))

    out.append(Clip('Sit_Chair_StandUp', 0.9,
                    slide_off(A, SIT, STC, (0.16, 0.30, 0.40, 0.56, 0.70, 0.9))))

    # -- Sit_Chair_Relaxed_Idle: back on the backrest, legs out, hands in the lap ---------
    r1 = seat(P(REL, head_y=14, head_p=REL['head.p'] - 2, l_knee=REL['l.knee'] - 4))
    r2 = seat(P(REL, head_y=9, head_r=-3))
    r3 = seat(P(REL, head_y=-7, head_p=REL['head.p'] + 2, r_knee=REL['r.knee'] + 5))
    out.append(Clip('Sit_Chair_Relaxed_Idle', 6.0, [
        (0.0, REL), (1.8, r1), (3.1, r2), (4.5, r3)],
        loop=True, osc=combine(breathing(1.1, 3.0), lambda t: {
            'l.knee': -1.8 * (1 - math.cos(2 * math.pi * t / 6.0))})))

    # -- Sit_Chair_Talk: turned to a companion on the left, gestures, nods, a laugh -------
    turn = seat(P(SIT, chest_y=10, spine_y=4, head_y=26, head_p=-2))
    # open-handed gestures, palms turned up, out to the side the body faces into
    talk = {'ex': 0.9, 'ey': -0.5, 'ez': -0.1}
    g1 = seat(P(turn, hand('r', 0.24, 0.44, 0.30, az=10, el=10, roll=130, **talk), head_p=2))
    g2 = seat(P(turn, hand('r', 0.36, 0.50, 0.24, az=40, el=20, roll=140, **talk),
                head_p=5, head_r=4))
    g3 = seat(P(turn, hand('r', 0.22, 0.42, 0.30, az=0, el=5, roll=120, **talk), head_p=-1))
    g4 = seat(P(turn, hand('r', 0.30, 0.48, 0.28, az=25, el=15, roll=140, **talk),
                hand('l', 0.26, 0.46, 0.30, az=20, el=15, roll=140, **talk),
                head_p=3, head_r=6, chest_y=12))
    listen = seat(P(turn, head_y=24, head_r=5, head_p=0))
    nod = seat(P(listen, head_p=9))
    # the laugh: a hand to the belly, the chest folding forward in three quick bounces
    belly = hand('r', 0.10, 0.34, 0.20, az=-75, el=-15, roll=10, ex=0.9, ey=-0.4, ez=-0.1)
    laugh = seat(P(turn, belly, chest_p=7, spine_p=5, head_p=-3, head_y=16, head_r=-6))
    laugh2 = seat(P(laugh, chest_p=12, spine_p=6, head_p=2))
    fwd = seat(P(turn, chest_p=8, spine_p=5, head_p=4, head_y=14))
    out.append(Clip('Sit_Chair_Talk', 7.0, [
        (0.0, SIT), (0.6, turn), (1.1, g1), (1.6, g2), (2.1, g3), (2.7, g4), (3.3, turn),
        (3.9, listen), (4.2, nod), (4.5, listen), (4.9, laugh), (5.1, laugh2), (5.3, laugh),
        (5.5, laugh2), (5.9, fwd), (6.5, turn)],
        loop=True, osc=breathing(0.7, 3.5)))

    # -- Sit_Chair_Drink: the right hand lifts a tankard to the mouth and back ------------
    mug = {'ex': 0.9, 'ey': -0.6, 'ez': 0.0}
    lift = seat(P(SIT, hand('r', 0.12, 0.42, 0.26, az=-20, el=5, roll=85, **mug), head_p=0))
    sip = seat(P(SIT, hand('r', 0.03, 0.87, 0.36, az=-50, el=25, roll=85, **mug),
                 head_p=-8, chest_p=6))
    sip2 = seat(P(sip, head_p=-10, chest_p=6))
    lower = seat(P(SIT, hand('r', 0.13, 0.44, 0.27, az=-15, el=5, roll=85, **mug), head_p=-2))
    out.append(Clip('Sit_Chair_Drink', 4.0, [
        (0.0, SIT), (0.5, lift), (1.0, sip), (1.7, sip2), (2.2, lower), (2.9, SIT)],
        loop=True, osc=breathing(0.6, 4.0)))

    # -- Sit_High_*: the stool is 1.00 yd and round, so the hop is higher ---------------
    out.append(Clip('Sit_High_Down', 1.0,
                    hop_up(A, STH, HIGH, 0.08, 0.22, (0.16, 0.34, 0.45, 0.58, 0.70, 0.84, 1.0))))
    hl = seat(P(HIGH, head_y=20, head_p=-12, chest_y=4))
    hl2 = seat(P(HIGH, head_y=16, head_p=-9, head_r=3, chest_y=3))
    hr = seat(P(HIGH, head_y=-14, head_p=-12, pelvis_r=-1.5, hip_x=-0.006, chest_y=-3))
    out.append(Clip('Sit_High_Idle', 6.0, [
        (0.0, HIGH), (1.4, hl), (2.6, hl2), (3.5, HIGH), (4.5, hr), (5.4, HIGH)],
        loop=True, osc=combine(breathing(0.7, 3.0), lambda t: {
            'l.knee': -3.0 * (1 - math.cos(2 * math.pi * t / 3.0)),
            'r.knee': -2.2 * (1 - math.cos(2 * math.pi * t / 2.0))})))
    out.append(Clip('Sit_High_StandUp', 0.8,
                    slide_off(A, HIGH, STH, (0.12, 0.24, 0.33, 0.48, 0.62, 0.8))))
    return out




# ---------------------------------------------------------------------------
# Self-check: does any frame push the skin into the furniture or the floor?
# ---------------------------------------------------------------------------

STOOL_CZ = FRONT_EDGE_Z - 0.42  # a 0.42 yd stool whose front rim is on the edge line


def furniture_check(author, clip, stage):
    """Deepest penetration (yards) of the body into the seat board, the backrest, and the
    floor, over the clip, sampled on the authoring body. Capes are reported apart: they
    are stiff geometry hanging off the chest and cannot follow a seat."""
    arm = author.arm
    act = bpy.data.actions[clip.name]
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    floor = -(CHAIR_SEAT_H if stage == 'chair' else HIGH_SEAT_H)
    worst = {'seat': (0.0, None), 'back': (0.0, None), 'floor': (0.0, None), 'cape': (0.0, None)}
    step = 1 if not clip.loop else 3
    for f in range(0, clip.frames + 1, step):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        for n, g, (x, y, z) in evaluated_verts(author.meshes, author.groups):
            if not g:
                continue  # stray unweighted vertices: three.js skins them to nothing
            if stage == 'chair':
                in_seat = abs(x) <= 0.42 and BACKREST_Z <= z <= FRONT_EDGE_Z and -0.12 <= y < 0
                back = (BACKREST_Z - z) if (z < BACKREST_Z and y > 0 and abs(x) < 0.42
                                            and z > BACKREST_Z - 0.05) else 0.0
            else:
                in_seat = x * x + (z - STOOL_CZ) ** 2 <= 0.42 ** 2 and -0.12 <= y < 0
                back = 0.0
            depth = -y if in_seat else 0.0
            key = 'cape' if draped(n) else 'seat'
            if depth > worst[key][0]:
                worst[key] = (depth, f'{g}@{f}')
            if back > worst['back'][0] and not draped(n):
                worst['back'] = (back, f'{g}@{f}')
            if g and y < floor and floor - y > worst['floor'][0]:
                worst['floor'] = (floor - y, f'{g}@{f}')
    ad.action = None
    print('  check ' + clip.name + ': ' + ', '.join(
        f'{k} {v[0]:.3f}' + (f' ({v[1]})' if v[1] else '') for k, v in worst.items()))

# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def export(path):
    """Every action (the nine authored clips AND the rig's own KayKit clips, which the
    retarget's --verify gate diffs against the shipped originals) on the rig, per frame."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=False,
        export_anim_single_armature=True,
        export_def_bones=False,
        export_materials='NONE',
        export_image_format='NONE',
    )


# ---------------------------------------------------------------------------
# Review renders: contact sheets of each clip on several bodies, on simple furniture
# ---------------------------------------------------------------------------

REVIEW_RIGS = [('knight', 'knight_plain.glb'), ('mage', 'mage_plain.glb'),
               ('rogue', 'rogue_plain.glb'), ('modular', 'modular_plain.glb')]
# The default modular look (modular.ts DEFAULT_LOOK: the knight kit over the male body).
MODULAR_SHOWN = {'M_Head', 'Armor_knight_Head', 'Armor_knight_Head1', 'Armor_knight_Chest',
                 'Armor_knight_ArmL', 'Armor_knight_ArmR', 'Armor_knight_HandL',
                 'Armor_knight_HandR', 'Armor_knight_LegL', 'Armor_knight_LegR',
                 'Armor_knight_FootL', 'Armor_knight_FootR', 'Armor_knight_Back',
                 'M_Eye_round', 'M_Brow_soft', 'M_Mouth_neutral'}
# Clip -> (stage, frames to show in seconds)
SHEETS = {
    'Sit_Chair_Down': ('chair', [0.0, 0.2, 0.4, 0.52, 0.62, 0.7, 0.8, 0.95, 1.2]),
    'Sit_Chair_Idle': ('chair', [0.0, 1.3, 2.5, 4.4, 5.3]),
    'Sit_Chair_StandUp': ('chair', [0.0, 0.16, 0.32, 0.42, 0.52, 0.62, 0.9]),
    'Sit_Chair_Relaxed_Idle': ('chair', [0.0, 1.8, 3.1, 4.5]),
    'Sit_Chair_Talk': ('chair', [0.6, 1.6, 2.7, 4.2, 4.9, 5.9]),
    'Sit_Chair_Drink': ('chair', [0.0, 0.5, 1.0, 1.7, 2.2, 2.9]),
    'Sit_High_Down': ('high', [0.0, 0.16, 0.32, 0.43, 0.5, 0.6, 0.68, 0.83, 1.0]),
    'Sit_High_Idle': ('high', [0.0, 1.4, 2.6, 4.5]),
    'Sit_High_StandUp': ('high', [0.0, 0.13, 0.27, 0.37, 0.46, 0.62, 0.8]),
}


def solid(name, verts_min, verts_max, color, coll):
    """An axis-aligned box from anchor-space corners."""
    a, b = to_bl(*verts_min), to_bl(*verts_max)
    lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
    hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    o.scale = hi - lo
    o.location = (lo + hi) / 2
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    o.data.materials.append(mat)
    for c in o.users_collection:
        c.objects.unlink(o)
    coll.objects.link(o)
    return o


def cylinder(name, x, z, r, y0, y1, color, coll):
    c = to_bl(x, (y0 + y1) / 2, z)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r / S_REF, depth=(y1 - y0) / S_REF,
                                        location=c)
    o = bpy.context.object
    o.name = name
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    o.data.materials.append(mat)
    for cc in o.users_collection:
        cc.objects.unlink(o)
    coll.objects.link(o)
    return o


def build_stages():
    wood, dark, floor = (0.62, 0.42, 0.24, 1), (0.36, 0.22, 0.12, 1), (0.55, 0.55, 0.52, 1)
    stages = {}
    c = bpy.data.collections.new('stage_chair')
    bpy.context.scene.collection.children.link(c)
    fy = -CHAIR_SEAT_H
    solid('floor_c', (-2, fy - 0.02, -2), (2, fy, 2), floor, c)
    solid('seat_c', (-0.42, -0.12, BACKREST_Z), (0.42, 0.0, FRONT_EDGE_Z), wood, c)
    for x in (-0.36, 0.36):
        for z in (BACKREST_Z + 0.05, FRONT_EDGE_Z - 0.06):
            solid('leg_c', (x - 0.05, fy, z - 0.05), (x + 0.05, -0.12, z + 0.05), dark, c)
    solid('back_c', (-0.42, 0.0, BACKREST_Z - 0.05), (0.42, 1.3, BACKREST_Z), dark, c)
    stages['chair'] = c
    h = bpy.data.collections.new('stage_high')
    bpy.context.scene.collection.children.link(h)
    fy = -HIGH_SEAT_H
    cz = FRONT_EDGE_Z - 0.42  # the stool's centre, its front rim on the edge line
    solid('floor_h', (-2, fy - 0.02, -2), (2, fy, 2), floor, h)
    cylinder('seat_h', 0.0, cz, 0.42, -0.12, 0.0, wood, h)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.3
        cylinder('leg_h', math.sin(a) * 0.3, cz + math.cos(a) * 0.3, 0.05, fy, -0.12, dark, h)
    # the brief's footrest ring (0.35 yd over the floor, radius 0.29): out of a chibi's reach
    bpy.ops.mesh.primitive_torus_add(major_radius=0.29 / S_REF, minor_radius=0.03 / S_REF,
                                     location=to_bl(0, fy + 0.35, cz))
    ring = bpy.context.object
    mat = bpy.data.materials.new('ring')
    mat.diffuse_color = dark
    ring.data.materials.append(mat)
    for cc in ring.users_collection:
        cc.objects.unlink(ring)
    h.objects.link(ring)
    stages['high'] = h
    return stages


def render_sheets(author, out_dir):
    import numpy as np

    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new('w')
    cw, ch = (int(v) for v in RENDER_CELL.split('x'))
    scene.render.resolution_x, scene.render.resolution_y = cw, ch
    scene.render.image_settings.file_format = 'PNG'
    stages = build_stages()

    rigs = [(n, author.arm, author.meshes) if n == 'knight' else None for n, _ in REVIEW_RIGS]
    knight_img = None
    for o in author.meshes:
        for slot in o.material_slots:
            if slot.material and slot.material.node_tree:
                for nd in slot.material.node_tree.nodes:
                    if nd.type == 'TEX_IMAGE' and nd.image:
                        knight_img = nd.image
    for i, (n, fname) in enumerate(REVIEW_RIGS):
        if n == 'knight':
            continue
        path = os.path.join(TMP, fname)
        if not os.path.exists(path) or (RENDER_RIGS and n not in RENDER_RIGS.split(',')):
            rigs[i] = None
            continue
        arm, meshes = import_rig(path)
        if n == 'modular':
            for o in meshes:
                o.hide_render = o.name not in MODULAR_SHOWN
                for slot in o.material_slots:
                    m = slot.material
                    if not m:
                        continue
                    if m.name.startswith('knight') and knight_img and m.node_tree:
                        tex = m.node_tree.nodes.new('ShaderNodeTexImage')
                        tex.image = knight_img
                        m.node_tree.nodes.active = tex
                    elif m.name.startswith('mod_skin'):
                        m.diffuse_color = (0.86, 0.62, 0.47, 1)
                    else:
                        m.diffuse_color = (0.12, 0.1, 0.1, 1)
        rigs[i] = (n, arm, meshes)
    rigs = [r for r in rigs if r and (not RENDER_RIGS or r[0] in RENDER_RIGS.split(','))]
    if RENDER_RIGS and 'knight' not in RENDER_RIGS.split(','):
        for o in author.meshes:
            o.hide_render = True

    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def place(view, stage):
        centre = to_bl(0.0, 0.66, 0.12)
        cam_data.sensor_fit = 'VERTICAL'
        if view == 'side':
            cam_data.type = 'ORTHO'
            cam_data.ortho_scale = 3.55 / S_REF
            cam.location = centre + Vector((6.0, 0, 0))
        elif view == 'front':
            cam_data.type = 'PERSP'
            cam_data.lens = 50
            cam.location = centre + to_bl(0.6, 0.9, 6.6) * S_REF
        else:
            cam_data.type = 'PERSP'
            cam_data.lens = 50
            cam.location = centre + to_bl(3.9, 1.6, 5.2) * S_REF
        d = centre - cam.location
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    for clip_name, (stage, times) in SHEETS.items():
        act = bpy.data.actions.get(clip_name)
        if not act or (RENDER_ONLY and clip_name != RENDER_ONLY):
            continue
        for sname, coll in stages.items():
            coll.hide_render = sname != stage
        rows = []
        if RENDER_TIMES:
            times = [float(v) for v in RENDER_TIMES.split(',')]
        for view in RENDER_VIEWS.split(','):
            place(view, stage)
            for n, arm, meshes in rigs:
                row = []
                for other_n, other_arm, other_meshes in rigs:
                    for o in other_meshes:
                        if other_n == 'modular':
                            o.hide_render = (other_n != n) or o.name not in MODULAR_SHOWN
                        else:
                            o.hide_render = other_n != n
                ad = arm.animation_data or arm.animation_data_create()
                ad.action = act
                if act.slots:
                    ad.action_slot = act.slots[0]
                for t in times:
                    scene.frame_set(int(round(t * FPS)))
                    fp = os.path.join(out_dir, '_cell.png')
                    scene.render.filepath = fp
                    bpy.ops.render.render(write_still=True)
                    img = bpy.data.images.load(fp)
                    px = np.array(img.pixels[:], dtype=np.float32).reshape(
                        img.size[1], img.size[0], 4)
                    bpy.data.images.remove(img)
                    row.append(px)
                rows.append(np.concatenate(row, axis=1))
        if len(times) == 1:
            # one frame: a row per body, a column per view
            nb = len(rigs)
            rows = [np.concatenate([rows[v * nb + b] for v in range(len(rows) // nb)], axis=1)
                    for b in range(nb)]
        sheet = np.concatenate(rows[::-1], axis=0)  # pixel rows run bottom-up
        hgt, wid = sheet.shape[:2]
        out = bpy.data.images.new(clip_name, wid, hgt)
        out.pixels = sheet.ravel()
        out.filepath_raw = os.path.join(out_dir, f'{clip_name}.png')
        out.file_format = 'PNG'
        out.save()
        bpy.data.images.remove(out)
        print(f'sheet {clip_name}: {len(rigs)} bodies x {len(times)} frames x 2 views')


# ---------------------------------------------------------------------------


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    # Before the import: the importer turns the rig's clip times into frames at the scene
    # rate, and the exporter turns frames back into seconds at it (the factory 24 fps
    # would stretch every authored clip by a quarter).
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    arm, meshes = import_rig(RIG_PATH)
    author = Author(arm, meshes)
    poses = build_poses(author)
    for name in ('sit', 'high', 'relaxed'):
        p = poses[name]
        print(f'pose {name}: hip y {p["hip.y"]:.4f} yd, seat contact {author.seat_contact(p):+.4f}')
    print(f'pose relaxed: back {author.back_contact(poses["relaxed"]):+.4f} yd '
          f'(plane {BACKREST_Z}), pelvis {poses["relaxed"]["pelvis.p"]:.1f} deg')
    for clip in clips(author, poses):
        bake(author, clip)
        print(f'baked {clip.name}: {clip.frames + 1} frames, {clip.dur:.2f} s'
              f'{" (loop)" if clip.loop else ""}')
        if CHECK:
            furniture_check(author, clip, 'high' if 'High' in clip.name else 'chair')
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    if RENDER_DIR:
        render_sheets(author, RENDER_DIR)
    else:
        export(OUT_PATH)
        print(f'wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
