"""Pearlguard Sentinel: skeleton and sculpts (rest pose), in yards.

A giant of the temple whose body is a colossal clam: two great valves,
bone-white outside with wavy folds and growth rings, nacre inside, stand
gaping front and back from its hips like a breastplate and a back shield.
Between them its soft mantle swells, iridescent blue-violet with glowing
spots like a giant clam's, and in the notch of the front valve its heart
glows: a pearl as big as a head. Arms and legs of thick white and pale-pink
branching coral, fists and feet of nacre stone, a small stone head sunk
between the valves' tops with a slit of moonlight for eyes and a silver
crescent crest. For Pearl Carapace it crouches and the valves close over it.

Axes: yards, +Z up, faces -Y, its left is +X. Rest is an A-pose. The back
valve's crest about 4.6 up.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere

NAME = 'PearlguardSentinel'
PREFIX = 'sentinel'

SHOULDER = np.array((0.98, 0.02, 3.82))
ELBOW = np.array((1.38, 0.08, 3.02))
WRIST = np.array((1.56, -0.04, 2.28))
HAND_TIP = np.array((1.62, -0.12, 1.84))
HIP = np.array((0.46, 0.0, 1.74))
KNEE = np.array((0.54, -0.14, 1.0))
ANKLE = np.array((0.56, 0.06, 0.38))
BALL = np.array((0.57, -0.4, 0.13))
TOE = np.array((0.57, -0.64, 0.11))

HAND = B.Hand(WRIST, HAND_TIP, 0.3, {}, thumb=((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), 0.1, 0.1))
FINGERS = ()
FINGER_FAN = {}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.24, 0.02, 3.72)))

# the valves: hinged low at the hips, gaping front and back
HINGE_F = np.array((0.0, -0.14, 1.74))
HINGE_B = np.array((0.0, 0.14, 1.74))
TILT_F = math.radians(17.0)
TILT_B = math.radians(13.0)
VALVE_W, VALVE_H, VALVE_D = 1.2, 1.5, 0.8     # half-width, half-height (along the valve), bulge
PEARL_AT = np.array((0.0, -0.66, 3.42))
PEARL_R = 0.3
HEAD_C = np.array((0.0, -0.1, 4.28))
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
GRIP_OFFSET_L = (0.0, 0.0, 0.0)
BAKE_CAGE, BAKE_RAY = 0.03, 0.1


def valve_frame(front=True):
    """(hinge, X lateral, U up the valve, N out of it) for a valve."""
    if front:
        a = TILT_F
        U = np.array((0.0, -math.sin(a), math.cos(a)))
        N = np.array((0.0, -math.cos(a), -math.sin(a)))
        return HINGE_F, np.array((1.0, 0, 0)), U, N
    a = TILT_B
    U = np.array((0.0, math.sin(a), math.cos(a)))
    N = np.array((0.0, math.cos(a), -math.sin(a)))
    return HINGE_B, np.array((1.0, 0, 0)), U, N


def _bones():
    hf, _, uf, _ = valve_frame(True)
    hb, _, ub, _ = valve_frame(False)
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0, 1.7), (0, 0, 2.1)),
        ('Spine1', 'Hips', (0, 0, 2.1), (0, 0, 2.8)),
        ('Spine2', 'Spine1', (0, 0, 2.8), (0, 0.0, 3.7)),
        ('Neck', 'Spine2', (0, 0.0, 3.74), (0, -0.04, 4.02)),
        ('Head', 'Neck', (0, -0.04, 4.02), (0, -0.08, 4.5)),
        ('ValveF', 'Hips', tuple(hf), tuple(hf + uf * 1.2)),
        ('ValveB', 'Hips', tuple(hb), tuple(hb + ub * 1.2)),
        ('Pearl', 'Spine2', tuple(PEARL_AT), tuple(PEARL_AT + np.array((0, -0.3, 0)))),
        ('PearlFree', 'Root', tuple(PEARL_AT), tuple(PEARL_AT + np.array((0, 0, 0.4)))),
        ('Shards', 'Root', (0, -1.2, 0.0), (0, -1.2, 0.4)),
    ]
    out += B.arm_leg_bones(L, HAND, FINGERS)
    return B.topo(B.expand(out))


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = (('Spine1', 0.45), ('Spine2', 0.55))
LEFT_ARM = ('L_Clavicle', 'L_UpperArm', 'L_ElbowFix', 'L_Forearm', 'L_Hand')
LIMBS = (('L_UpperArm', 'L_Forearm'), ('R_UpperArm', 'R_Forearm'), ('L_Thigh', 'L_Shin'), ('R_Thigh', 'R_Shin'))
foot_dir = B.foot_dir_fn(REST['L_Foot'][1] - REST['L_Foot'][0])
BALL_OFF = BALL - ANKLE
HEEL_OFF = np.array((0.0, 0.22, -0.26))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_END = ('Death',)
COLLIDE_LEGS = {}
CHAINS = []
POP_SKIP = ('Valve', 'Pearl', 'Shards')
FEET = ('L_Foot', 'R_Foot')
AIM_LIMITS = {'L_Hand': 75.0, 'R_Hand': 75.0, 'L_Foot': 95.0, 'R_Foot': 95.0}
HIDDEN = {'PearlFree': 0.0, 'Shards': 0.0}


def mirror(p):
    return B.mirror(p)


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _side(name, s):
    return ('L_' if s > 0 else 'R_') + name


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


# ------------------------------------------------------------------ the mantle (the soft body inside)
def build_mantle(voxel):
    F = Field((-1.05, -1.0, 1.35), (1.05, 0.8, 4.15), voxel)
    noise = Noise(7)
    F.add(Ellipsoid((0, 0.0, 1.95), (0.62, 0.48, 0.42), bone='Hips'), 0.15)
    F.add(Ellipsoid((0, 0.0, 2.55), (0.82, 0.55, 0.62), bone='Spine1'), 0.2)
    F.add(Ellipsoid((0, -0.04, 3.32), (0.96, 0.6, 0.6), bone='Spine2'), 0.2)
    # the mantle swelling out of the front valve's notch round the pearl, in folds
    F.add(Ellipsoid((0, -0.38, 3.36), (0.78, 0.42, 0.56), bone='Spine2'), 0.12)
    for k in range(7):
        a = math.radians(-75 + 25 * k)
        c = PEARL_AT + np.array((0.5 * math.sin(a), 0.16, 0.42 * math.cos(a) * 0.9))
        F.add(Ellipsoid(c, (0.15, 0.2, 0.13)), 0.08, weight=False)
    # the shoulders: coral knots where the arms leave the body
    for s in (1, -1):
        F.add(Sphere(_m(SHOULDER, s) + np.array((-s * 0.12, 0, -0.05)), 0.32, bone=_side('Clavicle', s)), 0.14)
    F.add(Ellipsoid((0, 0.02, 3.86), (0.5, 0.4, 0.22), bone='Neck'), 0.12)
    F.sub(Sphere(PEARL_AT, PEARL_R + 0.015), 0.05)
    F.displace(lambda X_, Y_, Z_: 0.03 * noise.fbm(X_ * 3.5, Y_ * 3.5, Z_ * 3.5, octaves=3), band=0.08)
    return F


def mantle_paint(obj):
    """RegSpot (the glowing eye-spots of a giant clam's mantle), RegFold (the
    folds round the pearl)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    d = np.linalg.norm(P - PEARL_AT, axis=1)
    fold = np.clip(1 - (d - PEARL_R) / 0.35, 0, 1)
    rng = np.random.default_rng(3)
    spots = np.zeros(len(P))
    for _ in range(46):
        c = np.array((rng.uniform(-0.9, 0.9), rng.uniform(-0.75, -0.2), rng.uniform(2.6, 3.9)))
        spots = np.maximum(spots, np.clip(1 - np.linalg.norm(P - c, axis=1) / 0.045, 0, 1))
    _write(obj, {'RegSpot': spots, 'RegFold': fold})


# ------------------------------------------------------------------ the coral limbs
def _branchlets(F, a, b, r, bone, rng, n, length=0.36):
    for i in range(n):
        u = rng.uniform(0.15, 0.85)
        p = a + (b - a) * u
        d = rng.normal(0, 1, 3)
        ax = unit(b - a)
        d = d - ax * (d @ ax)
        d = unit(d) * 0.8 + ax * 0.35 * rng.choice((-1, 1))
        d = unit(d)
        base = p + d * r * 0.7
        tip = base + d * length * rng.uniform(0.6, 1.1)
        F.add(RoundCone(base, tip, 0.085, 0.03, bone=bone), 0.04)
        if rng.uniform() < 0.5:
            t2 = tip + unit(d + rng.normal(0, 0.5, 3)) * 0.16
            F.add(RoundCone(tip, t2, 0.035, 0.015, bone=bone), 0.02)


def build_limbs(voxel):
    F = Field((-2.05, -1.1, 0.25), (2.05, 0.8, 4.35), voxel)
    rng = np.random.default_rng(17)
    noise = Noise(19)
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        up, fo = _side('UpperArm', s), _side('Forearm', s)
        F.add(RoundCone(sh, el, 0.27, 0.23, bone=up), 0.06)
        F.add(Sphere(el, 0.25, bone=_side('ElbowFix', s)), 0.06)
        F.add(RoundCone(el, wr, 0.24, 0.3, bone=fo), 0.06)
        _branchlets(F, sh, el, 0.25, up, rng, 5)
        _branchlets(F, el, wr, 0.26, fo, rng, 5)
        # coral crown on the shoulder
        for k in range(4):
            a = math.radians(30 + 35 * k)
            base = sh + np.array((s * 0.1, 0.1 * math.cos(a), 0.15))
            tip = base + np.array((s * 0.18 * math.sin(a), 0.2 * math.cos(a), 0.34 + 0.08 * (k % 2)))
            F.add(RoundCone(base, tip, 0.07, 0.025, bone=up), 0.04)
        th, sn = _side('Thigh', s), _side('Shin', s)
        F.add(Sphere(hp, 0.34, bone=th), 0.08)
        F.add(RoundCone(hp, kn, 0.34, 0.29, bone=th), 0.06)
        F.add(Sphere(kn + np.array((0, -0.06, 0)), 0.3, bone=_side('KneeFix', s)), 0.06)
        F.add(RoundCone(kn, an, 0.3, 0.25, bone=sn), 0.06)
        _branchlets(F, hp, kn, 0.32, th, rng, 4, 0.18)
        _branchlets(F, kn, an, 0.28, sn, rng, 4, 0.16)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.ridged(X_ * 6, Y_ * 6, Z_ * 6, octaves=2), band=0.05)
    return F


def limbs_paint(obj):
    """RegPink (where the white coral blushes pink, toward the extremities)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    n = Noise(23)
    v = n.fbm(P[:, 0] * 1.5, P[:, 1] * 1.5, P[:, 2] * 1.5, octaves=2)
    _write(obj, {'RegPink': np.clip(v * 2.5 + 0.4, 0, 1)})


# ------------------------------------------------------------------ fists, feet, head (nacre stone)
def build_fist(side, voxel):
    w, down, width, palm = hand_frame(side)
    c = w + down * 0.3
    F = Field(c - 0.6, c + 0.6, voxel)
    R = np.stack([width, palm, down], axis=1)
    F.add(Ellipsoid(c, (0.34, 0.33, 0.38), R), 0.06)
    for k in range(4):
        q = c + down * 0.22 + width * (-0.21 + 0.14 * k) + palm * -0.2
        F.add(Sphere(q, 0.11), 0.05)
    F.add(Ellipsoid(c + palm * 0.22 + width * 0.18 * side, (0.12, 0.14, 0.2), R), 0.05)
    F.add(RoundCone(w - down * 0.05, c, 0.27, 0.3), 0.06)
    noise = Noise(31 + side)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=3), band=0.05)
    return F


def build_foot(side, voxel):
    an, ba, to = _m(ANKLE, side), _m(BALL, side), _m(TOE, side)
    F = Field(np.minimum(an, to) - 0.5, np.maximum(an, to) + 0.5, voxel)
    F.add(Ellipsoid((an + ba) * 0.5 + np.array((0, 0.08, -0.08)), (0.34, 0.46, 0.2)), 0.08)
    F.add(Ellipsoid(ba + np.array((0, -0.08, -0.02)), (0.33, 0.26, 0.13)), 0.06)
    F.add(Sphere(an, 0.27), 0.08)
    noise = Noise(41 + side)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.fbm(X_ * 5, Y_ * 5, Z_ * 5, octaves=3), band=0.05)
    return F


def build_head(voxel):
    """A small stone head sunk between the valves: a rounded helm, a heavy brow,
    one slit of moonlight across the face."""
    F = Field(HEAD_C - 0.5, HEAD_C + 0.55, voxel)
    F.add(Ellipsoid(HEAD_C, (0.3, 0.3, 0.3)), 0.06)
    F.add(Ellipsoid(HEAD_C + np.array((0, -0.18, 0.08)), (0.31, 0.16, 0.1)), 0.05)
    F.add(Ellipsoid(HEAD_C + np.array((0, -0.16, -0.14)), (0.22, 0.16, 0.12)), 0.06)
    pts = [HEAD_C + np.array((x, -0.31 + 0.12 * x * x, 0.0)) for x in np.linspace(-0.2, 0.2, 9)]
    F.groove(sdf.Polyline(pts, [0.008] * 9), 0.05, k=0.025)
    noise = Noise(51)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 8, Y_ * 8, Z_ * 8, octaves=3), band=0.04)
    return F


def head_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0] - HEAD_C[0], P[:, 1] - HEAD_C[1], P[:, 2] - HEAD_C[2]
    slit = np.clip(1 - np.abs(z) / 0.03, 0, 1) * np.clip((0.22 - np.abs(x)) / 0.03, 0, 1) * (y < -0.18)
    _write(obj, {'RegSlit': slit})


def stone_paint(obj):
    _write(obj, {'RegSlit': np.zeros(len(obj.data.vertices))})


# ------------------------------------------------------------------ the valves
def _valve_local(Xg, Yg, Zg, front):
    H, Xa, U, N = valve_frame(front)
    px, py, pz = Xg - H[0], Yg - H[1], Zg - H[2]
    x = px * Xa[0] + py * Xa[1] + pz * Xa[2]
    v = px * U[0] + py * U[1] + pz * U[2]
    w = px * N[0] + py * N[1] + pz * N[2]
    return x, v, w


FOLDS = 11


def _valve_top(x, front):
    ax = np.abs(x) / VALVE_W
    if front:
        return 1.5 + 1.25 * np.clip(ax, 0, 1) ** 1.25
    return 2.95 - 0.25 * ax ** 2


def build_valve(front, voxel):
    """A giant clam's valve: a thick bowl bulging outward, radial folds fanning
    from the hinge (the margin zigzags with them), growth rings, nacre inside.
    The front valve's top dips in a deep notch where the pearl shows."""
    H, Xa, U, N = valve_frame(front)
    lo = np.minimum(H - 1.4, H + U * 3.1 + N * 1.0) - 0.2
    hi = np.maximum(H + 1.4, H + U * 3.1 + N * 1.0) + 0.2
    lo[0], hi[0] = -1.5, 1.5
    G, Xg, Yg, Zg = X.grid(lo, hi, voxel)
    x, v, w = _valve_local(Xg, Yg, Zg, front)
    cv = VALVE_H - 0.05
    phi = np.arctan2(x, np.maximum(v + 0.25, 1e-3))          # the fan round the hinge
    fold = np.cos(phi * FOLDS)
    r_hinge = np.sqrt(x * x + (v + 0.25) ** 2)
    ramp = np.clip(r_hinge / 2.4, 0, 1)
    bulge = VALVE_D * (1 + 0.16 * fold * ramp)
    e = np.sqrt((x / VALVE_W) ** 2 + ((v - cv) / (VALVE_H + 0.15)) ** 2 + (w / bulge) ** 2)
    outer = (e - 1.0) * 0.55
    ei = np.sqrt((x / (VALVE_W - 0.13)) ** 2 + ((v - cv) / (VALVE_H + 0.02)) ** 2 + (w / (bulge - 0.13)) ** 2)
    inner = (ei - 1.0) * 0.5
    d = np.maximum(outer, -inner)
    # the opening plane, zigzagging with the folds
    zig = 0.24 * fold * ramp
    d = np.maximum(d, (zig - w) * 0.8)
    # the top margin (the front's notch)
    d = np.maximum(d, (v - _valve_top(x, front)) * 0.8)
    d = np.maximum(d, (-0.3 - v) * 0.8)
    G.d = d.astype(np.float32)
    # growth rings, faint
    rings = np.sin(r_hinge * 16.0)
    G.d = (G.d + 0.008 * np.clip(rings, -0.2, 1.0) * (np.abs(G.d) < 0.05)).astype(np.float32)
    noise = Noise(61 if front else 67)
    G.displace(lambda X_, Y_, Z_: 0.008 * noise.fbm(X_ * 4, Y_ * 4, Z_ * 4, octaves=3), band=0.05)
    return G


def valve_paint(front):
    def paint(obj):
        from rig import mesh_arrays
        P, _ = mesh_arrays(obj)
        x, v, w = _valve_local(P[:, 0], P[:, 1], P[:, 2], front)
        cv = VALVE_H - 0.05
        phi = np.arctan2(x, np.maximum(v + 0.25, 1e-3))
        fold = np.cos(phi * FOLDS)
        r_hinge = np.sqrt(x * x + (v + 0.25) ** 2)
        bulge = VALVE_D * (1 + 0.2 * fold * np.clip(r_hinge / 2.4, 0, 1))
        e = np.sqrt((x / VALVE_W) ** 2 + ((v - cv) / (VALVE_H + 0.15)) ** 2 + (w / bulge) ** 2)
        inside = (e < 0.94).astype(float)
        rim = np.clip(1 - (w - 0.24 * fold * np.clip(r_hinge / 2.4, 0, 1)) / 0.07, 0, 1) * (1 - inside)
        ring = np.clip(np.sin(r_hinge * 16.0) * 2, 0, 1)
        glyph = np.zeros(len(P))
        if not front:
            # a full moon held in a crescent, carved on the back valve
            cx, cy = x / 0.42, (v - 1.6) / 0.42
            r = np.sqrt(cx * cx + cy * cy)
            r2 = np.sqrt(cx * cx + (cy - 0.3) ** 2)
            moon = np.clip((0.42 - r) / 0.08, 0, 1)
            cres = np.clip((1 - r) / 0.1, 0, 1) * np.clip((r2 - 0.86) / 0.1, 0, 1)
            glyph = np.maximum(moon, cres) * (1 - inside) * (w > 0.4)
        _write(obj, {'RegIn': inside, 'RegRim': rim, 'RegRing': ring, 'RegFold': fold * 0.5 + 0.5,
                     'RegGlyph': glyph})
    return paint


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    S = [Sculpt('Mantle', build_mantle(0.016 * k), 'mantle', 5200, tau=0.08, paint=mantle_paint),
         Sculpt('Limbs', build_limbs(0.016 * k), 'coral', 9000, tau=0.06, paint=limbs_paint)]
    for s, side in ((1, 'L'), (-1, 'R')):
        S.append(Sculpt(f'{side}_Fist', build_fist(s, 0.012 * k), 'stone', 1500, binding='rigid',
                        bone=f'{side}_Hand', paint=stone_paint))
        S.append(Sculpt(f'{side}_Sole', build_foot(s, 0.014 * k), 'stone', 1100, binding='rigid',
                        bone=f'{side}_Foot', paint=stone_paint))
    S.append(Sculpt('StoneHead', build_head(0.008 * k), 'stone', 1800, binding='rigid', bone='Head',
                    paint=head_paint))
    S.append(Sculpt('ValveFront', build_valve(True, 0.016 * k), 'shell', 4200, binding='rigid', bone='ValveF',
                    paint=valve_paint(True)))
    S.append(Sculpt('ValveBack', build_valve(False, 0.016 * k), 'shell', 4600, binding='rigid', bone='ValveB',
                    paint=valve_paint(False)))
    return S


_ = (lerp, Sphere, RoundCone)
