"""Glimmerscale Lurker: skeleton and sculpts (rest pose), in yards.

A giant mantis shrimp the moon-water made sacred: a long, low, armoured
torpedo of overlapping shell segments whose front half rears up, two huge
eyes on stalks that never stop turning (each crowned with a silver crescent
band and a glowing midband), long antennae and paddle scales, two raptorial
arms folded like jackknives under its head (club-heeled smashers), three pairs
of short walking legs, and a tail fan of carved nacre paddles. Its shell is
iridescent (turquoise to violet, pearl at the plate edges), each tergite
carries a carved moon glyph, and glow spots run down its flanks.

Axes: yards, +Z up, faces -Y. Eyes' crowns about 2.65 up; about 4.7 long from
the folded claws to the tail fan.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere, rot_matrix

import gem as G

NAME = 'GlimmerscaleLurker'
PREFIX = 'lurker'

# the abdomen's centreline (segment joints), from the thorax back to the fan
ABD = [np.array(p) for p in ((0, 0.52, 0.56), (0, 0.98, 0.52), (0, 1.44, 0.47), (0, 1.88, 0.43), (0, 2.3, 0.39),
                             (0, 2.7, 0.36), (0, 3.08, 0.34))]
ABD_W = (0.57, 0.57, 0.55, 0.52, 0.48, 0.43)     # each segment's half-width
ABD_H = (0.25, 0.24, 0.23, 0.21, 0.19, 0.17)     # and half-height
TAIL = (np.array((0, 3.08, 0.34)), np.array((0, 3.62, 0.3)))
CHEST = (np.array((0, 0.02, 0.74)), np.array((0, -0.36, 1.44)))
HEAD = (np.array((0, -0.36, 1.44)), np.array((0, -0.62, 1.9)))
EYE_BASE = np.array((0.15, -0.64, 1.96))
EYE_TOP = np.array((0.22, -0.72, 2.42))
ANT = [np.array(p) for p in ((0.07, -0.74, 1.9), (0.16, -1.02, 2.22), (0.3, -1.16, 2.58), (0.5, -1.08, 2.88))]
SCALE_B = (np.array((0.2, -0.76, 1.84)), np.array((0.38, -1.0, 1.96)))
# the raptorial arm, folded: merus down, propodus back up along it, the dactyl
# club folded down again; the club's heel is the striking face
SHOULDER = np.array((0.21, -0.5, 1.42))
KNEE = np.array((0.27, -0.92, 0.94))
WRIST = np.array((0.28, -0.6, 1.38))
CLAW_TIP = np.array((0.29, -0.86, 1.06))
LEG_Y = (0.06, 0.34, 0.62)
VENOM_AT = np.array((0.0, -0.78, 1.55))
GLOW_SEG = (1, 2, 3, 4)                         # the abdominal segments with lit flank spots
BAKE_CAGE, BAKE_RAY = 0.025, 0.09


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def leg_points(i):
    y = LEG_Y[i]
    base = np.array((0.28, y, 0.42))
    knee = np.array((0.47, y + 0.02, 0.3))
    foot = np.array((0.52, y + 0.16, 0.02))
    return base, knee, foot


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.5)),
        ('Body', 'Root', tuple(ABD[0]), tuple(CHEST[0])),
        ('Chest', 'Body', tuple(CHEST[0]), tuple(CHEST[1])),
        ('Head', 'Chest', tuple(HEAD[0]), tuple(HEAD[1])),
        ('L_Eye', 'Head', tuple(EYE_BASE), tuple(EYE_TOP)),
        ('L_Scale', 'Head', tuple(SCALE_B[0]), tuple(SCALE_B[1])),
        ('L_Merus', 'Chest', tuple(SHOULDER), tuple(KNEE)),
        ('L_Propodus', 'L_Merus', tuple(KNEE), tuple(WRIST)),
        ('L_Dactyl', 'L_Propodus', tuple(WRIST), tuple(CLAW_TIP)),
        ('Venom', 'Head', tuple(VENOM_AT), tuple(VENOM_AT + np.array((0, -0.3, 0)))),
    ]
    prev = 'Head'
    for j in range(3):
        out.append((f'L_Ant{j + 1}', prev, tuple(ANT[j]), tuple(ANT[j + 1])))
        prev = f'L_Ant{j + 1}'
    for i in range(3):
        b, k, f = leg_points(i)
        out.append((f'L_Leg{i + 1}a', 'Body', tuple(b), tuple(k)))
        out.append((f'L_Leg{i + 1}b', f'L_Leg{i + 1}a', tuple(k), tuple(f)))
    prev = 'Body'
    for i in range(6):
        out.append((f'Abd{i + 1}', prev, tuple(ABD[i]), tuple(ABD[i + 1])))
        prev = f'Abd{i + 1}'
    out.append(('Tail', 'Abd6', tuple(TAIL[0]), tuple(TAIL[1])))
    for g in GLOW_SEG:
        c = (ABD[g - 1] + ABD[g]) * 0.5
        out.append((f'Glow{g}', f'Abd{g}', tuple(c), tuple(c + np.array((0, 0, 0.3)))))
    return _topo(_expand(out))


def _expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(float(x) for x in head), tuple(float(x) for x in tail)))
        if name.startswith('L_'):
            mp = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            tp = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], tp, mp(head), mp(tail)))
    return out


def _topo(bones):
    out, placed = [], set()
    pending = list(bones)
    while pending:
        rest = []
        for b in pending:
            if b[1] is None or b[1] in placed:
                out.append(b)
                placed.add(b[0])
            else:
                rest.append(b)
        pending = rest
    return out


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
SPINE = ()
LIMBS = ()
HELPERS = {}
ROLL_LIMIT = {}
LEFT_ARM = ()
FINGERS = ()
FINGER_FAN = {}
SOLE_Z = 0.02
GROUND = 0.0
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {}
POP_SKIP = ('Ant', 'L_Ant', 'R_Ant', 'Venom', 'Glow', 'L_Eye', 'R_Eye')
TREMOR_KEYS = ('Chest', 'Head', 'Merus', 'Propodus')
AIM_LIMITS = {}
HIDDEN = {'Venom': 0.0}
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
ANT_CHAINS = [[f'{s}_Ant{j}' for j in (1, 2, 3)] for s in ('L', 'R')]


def hand_frame(side=1):
    raise NotImplementedError


def _chains():
    from rig import Chain
    return [Chain(ch, 'Head', gravity=0.05, stiff=0.2, damp=0.16, drag=1.4) for ch in ANT_CHAINS]


class _Lazy(list):
    def __iter__(self):
        if not len(self):
            self.extend(_chains())
        return list.__iter__(self)

    def __bool__(self):
        return True


CHAINS = _Lazy()


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def _seg_frame(a, b):
    d = b - a
    d = d / np.linalg.norm(d)
    side = np.array((1.0, 0.0, 0.0))
    up = np.cross(d, side)
    up = up / np.linalg.norm(up)
    if up[2] < 0:
        up = -up
    return np.stack([side, d, up], axis=1)


# ------------------------------------------------------------------ the shell, arms and legs (one skinned body)
def build_body(voxel):
    F = Field((-1.05, -1.25, -0.05), (1.05, 3.8, 2.15), voxel)
    noise = Noise(11)
    # the abdomen: six overlapping tergites, each a dome swelling at its back
    # edge over the next, a lateral keel running down each side
    for i in range(6):
        a, b = ABD[i], ABD[i + 1]
        c = a + (b - a) * 0.55
        R = _seg_frame(a, b)
        L = np.linalg.norm(b - a)
        F.add(G.gem_ellipsoid(c, (ABD_W[i], L * 0.74, ABD_H[i]), n=16, seed=60 + i, rot=R, bevel=0.025, chip=0.012,
                              bone=f'Abd{i + 1}'), 0.025)
        # the tergite's back lip, standing proud over the next plate
        lip = [b + np.array((x * ABD_W[i] * 0.95, -0.03, ABD_H[i] * (0.82 - 0.55 * x * x))) for x in
               np.linspace(-1, 1, 11)]
        F.ridge(sdf.Polyline(lip, [0.015] * 11), 0.035, k=0.025)
        if i < 5:
            gr = [b + np.array((x * ABD_W[i] * 0.9, 0.03, ABD_H[i] * (0.7 - 0.5 * x * x))) for x in
                  np.linspace(-1, 1, 11)]
            F.groove(sdf.Polyline(gr, [0.012] * 11), 0.045, k=0.022)
        for s in (1, -1):
            # the plate's back corner drawn out into a short spine
            k0 = b + np.array((s * ABD_W[i] * 0.86, -0.12, -ABD_H[i] * 0.05))
            k1 = b + np.array((s * ABD_W[i] * 1.0, 0.07, -ABD_H[i] * 0.15))
            F.add(RoundCone(k0, k1, 0.04, 0.008, bone=f'Abd{i + 1}'), 0.025)
        # the dorsal keel, a low ridge down the middle of each plate
        F.ridge(sdf.Polyline([a + np.array((0, 0.06, ABD_H[i] * 0.96)), b + np.array((0, -0.02, ABD_H[i] * 0.9))],
                             [0.012, 0.012]), 0.025, k=0.03)
        for s in (1, -1):
            # the carinae: two more keels a side, running the plate's length
            for fx in (0.38, 0.72):
                zt = ABD_H[i] * math.sqrt(max(0.0, 1 - fx * fx)) * 0.97
                F.ridge(sdf.Polyline([a + np.array((s * fx * ABD_W[i], 0.1, zt)),
                                      b + np.array((s * fx * ABD_W[i] * 0.97, -0.04, zt * 0.92))], [0.01, 0.01]),
                        0.02, k=0.022)
            # the pleuron: a plate hanging down the flank, its back corner
            # drawn into a hook, a groove along its upper edge
            pc = a + (b - a) * 0.55 + np.array((s * ABD_W[i] * 0.93, 0.0, -ABD_H[i] * 0.42))
            F.add(Ellipsoid(pc, (0.07, L * 0.46, ABD_H[i] * 0.5), rot_matrix(ry=-0.3 * s), bone=f'Abd{i + 1}'), 0.02)
            F.add(RoundCone(pc + np.array((s * 0.02, L * 0.3, -ABD_H[i] * 0.3)),
                            pc + np.array((s * 0.05, L * 0.55, -ABD_H[i] * 0.6)), 0.035, 0.006, bone=f'Abd{i + 1}'),
                  0.02)
            F.groove(sdf.Polyline([pc + np.array((s * 0.05, -L * 0.42, ABD_H[i] * 0.42)),
                                   pc + np.array((s * 0.05, L * 0.42, ABD_H[i] * 0.42))], [0.008, 0.008]), 0.02,
                     k=0.016)
            # a swimmeret folded under the belly
            sw = a + (b - a) * 0.5 + np.array((s * 0.16, 0.0, -ABD_H[i] * 0.95))
            F.add(Ellipsoid(sw, (0.1, 0.05, 0.025), rot_matrix(rx=0.5), bone=f'Abd{i + 1}'), 0.02)
    # the belly under the abdomen, softer
    F.add(RoundCone(ABD[0] + np.array((0, 0, -0.1)), ABD[6] + np.array((0, 0, -0.06)), 0.22, 0.14, bone='Abd3'), 0.08)
    # the thorax and the reared carapace
    F.add(G.gem_ellipsoid((0, 0.28, 0.56), (0.56, 0.42, 0.28), n=18, seed=70, bevel=0.025, chip=0.015, bone='Body'), 0.06)
    Rc = _seg_frame(CHEST[0], CHEST[1])
    F.add(G.gem_ellipsoid((CHEST[0] + CHEST[1]) * 0.5, (0.5, 0.5, 0.36), n=20, seed=71, rot=Rc, bevel=0.025, chip=0.015,
                          bone='Chest'), 0.06)
    # the carapace shield: a broad plate over the chest, its rim standing proud
    sh_c = (CHEST[0] + CHEST[1]) * 0.5 + Rc[:, 2] * 0.12
    F.add(G.gem_ellipsoid(sh_c, (0.55, 0.56, 0.22), n=22, seed=72, rot=Rc, bevel=0.025, chip=0.012, bone='Chest'), 0.03)
    # the shield's carinae and the groove round its rim
    for fx in (-0.5, -0.22, 0.0, 0.22, 0.5):
        pts = []
        for v in np.linspace(-0.85, 0.85, 9):
            zz = 0.22 * math.sqrt(max(0.0, 1 - fx * fx * 0.9 - v * v * 0.9))
            pts.append(sh_c + Rc @ np.array((fx * 0.55, v * 0.56, zz * 0.97)))
        F.ridge(sdf.Polyline(pts, [0.01] * 9), 0.02, k=0.02)
    rim = [sh_c + Rc @ np.array((0.53 * math.cos(t_), 0.54 * math.sin(t_), -0.02))
           for t_ in np.linspace(0, math.tau, 41)]
    F.groove(sdf.Polyline(rim, [0.01] * 41), 0.03, k=0.02)
    # the head: a narrow front, the rostral plate between the eyes
    Rh = _seg_frame(HEAD[0], HEAD[1])
    F.add(G.gem_ellipsoid((HEAD[0] + HEAD[1]) * 0.5, (0.3, 0.3, 0.24), n=16, seed=73, rot=Rh, bevel=0.025, chip=0.012,
                          bone='Head'), 0.05)
    F.add(Ellipsoid(HEAD[1] + np.array((0, -0.02, -0.06)), (0.15, 0.12, 0.08), Rh, bone='Head'), 0.05)
    # the rostrum: a short keeled spine pointing forward between the eyes
    F.add(X.Prism(HEAD[1] + np.array((0, 0.06, 0.0)), HEAD[1] + np.array((0, -0.24, -0.05)), 0.05, n=4, tip=0.6,
                  tip_a=0.2, rot=0.785, bone='Head'), 0.02)
    # the mouth: a cleft under the head, the maxillipeds folded round it
    for s in (1, -1):
        F.add(RoundCone(_m((0.1, -0.56, 1.42), s), _m((0.12, -0.74, 1.3), s), 0.045, 0.03, bone='Head'), 0.03)
    F.sub(Ellipsoid((0, -0.72, 1.52), (0.07, 0.06, 0.05)), 0.03)
    # the raptorial arms: thick merus, the propodus folded back up along it, the
    # club dactyl folded down with its heel swelling at the bend
    for s in (1, -1):
        sh, kn, wr, tp = _m(SHOULDER, s), _m(KNEE, s), _m(WRIST, s), _m(CLAW_TIP, s)
        side = 'L_' if s > 0 else 'R_'
        F.add(Sphere(sh, 0.12, bone=side + 'Merus'), 0.05)
        F.add(G.gem_column(sh, kn, 0.11, 0.1, sides=6, seed=80 + s, bevel=0.025, chip=0.01, bone=side + 'Merus'), 0.03)
        F.add(Ellipsoid(kn + (sh - kn) * 0.45 + np.array((s * 0.02, -0.03, 0)), (0.11, 0.13, 0.22),
                        rot_matrix(rx=0.35), bone=side + 'Merus'), 0.06)
        F.add(G.gem_column(kn, wr, 0.085, 0.075, sides=6, seed=82 + s, bevel=0.02, chip=0.008,
                           bone=side + 'Propodus'), 0.025)
        # the club: a heavy rounded heel at the bend, tapering to a hooked tip
        F.add(Sphere(wr + (tp - wr) * 0.15 + np.array((0, -0.04, 0.02)), 0.11, bone=side + 'Dactyl'), 0.04)
        F.add(G.gem_column(wr, tp, 0.095, 0.035, sides=6, seed=84 + s, bevel=0.02, chip=0.008,
                           bone=side + 'Dactyl'), 0.03)
        F.add(RoundCone(tp, tp + np.array((0, 0.06, -0.08)), 0.035, 0.012, bone=side + 'Dactyl'), 0.02)
        # the joints ringed in plate: the shoulder, the knee (the carpus knob)
        F.add(sdf.Torus(sh + (kn - sh) * 0.12, tuple(kn - sh), 0.11, 0.022, bone=side + 'Merus'), 0.015)
        F.add(Sphere(kn + np.array((s * 0.03, -0.04, -0.02)), 0.095, bone=side + 'Propodus'), 0.03)
        F.add(sdf.Torus(kn + (wr - kn) * 0.12, tuple(wr - kn), 0.082, 0.018, bone=side + 'Propodus'), 0.012)
        # the groove in the merus the folded propodus lies in, and its outer keel
        mg = [sh + (kn - sh) * u + np.array((0, -0.1, 0.0)) for u in np.linspace(0.18, 0.9, 6)]
        F.groove(sdf.Polyline(mg, [0.012] * 6), 0.03, k=0.02)
        mk = [sh + (kn - sh) * u + np.array((s * 0.1, 0.02, 0.0)) for u in np.linspace(0.12, 0.88, 6)]
        F.ridge(sdf.Polyline(mk, [0.012] * 6), 0.025, k=0.02)
        # the comb of the propodus: a row of short spines down its inner edge
        for u in np.linspace(0.22, 0.86, 5):
            c0 = kn + (wr - kn) * u + np.array((-s * 0.03, -0.06, 0.0))
            F.add(RoundCone(c0, c0 + np.array((-s * 0.02, -0.07, -0.02)), 0.018, 0.004, bone=side + 'Propodus'),
                  0.01)
        # the heel of the smasher club: ringed like the face of a hammer
        hh = wr + (tp - wr) * 0.15 + np.array((0, -0.04, 0.02))
        hd = np.array((0.0, -0.75, -0.35))
        F.ridge(sdf.Torus(hh + hd * 0.08, tuple(hd), 0.07, 0.006), 0.012, k=0.012)
        F.ridge(sdf.Torus(hh + hd * 0.1, tuple(hd), 0.035, 0.006), 0.012, k=0.012)
        # the walking legs: short, jointed, tucked under the thorax
        for i in range(3):
            b, k, f = leg_points(i)
            b, k, f = _m(b, s), _m(k, s), _m(f, s)
            F.add(Sphere(b, 0.09, bone=f'{side}Leg{i + 1}a'), 0.03)
            F.add(G.gem_column(b, k, 0.08, 0.06, sides=5, seed=90 + i, bevel=0.015, chip=0.006,
                               bone=f'{side}Leg{i + 1}a'), 0.02)
            F.add(sdf.Torus(b + (k - b) * 0.55, tuple(k - b), 0.07, 0.012, bone=f'{side}Leg{i + 1}a'), 0.01)
            F.add(Sphere(k, 0.066, bone=f'{side}Leg{i + 1}b'), 0.015)
            F.add(G.gem_column(k, k + (f - k) * 0.55, 0.058, 0.045, sides=5, seed=93 + i, bevel=0.012, chip=0.005,
                               bone=f'{side}Leg{i + 1}b'), 0.012)
            F.add(Sphere(k + (f - k) * 0.55, 0.048, bone=f'{side}Leg{i + 1}b'), 0.012)
            F.add(RoundCone(k + (f - k) * 0.55, f, 0.044, 0.012, bone=f'{side}Leg{i + 1}b'), 0.012)
            # a spur at the knee
            F.add(RoundCone(k + np.array((s * 0.03, 0.0, 0.03)), k + np.array((s * 0.1, 0.04, 0.08)), 0.02, 0.004,
                            bone=f'{side}Leg{i + 1}a'), 0.01)
    # the tail fan: a keeled telson with marginal spines, two paddles a side
    t0, t1 = TAIL
    F.add(Ellipsoid(t0 + (t1 - t0) * 0.6, (0.3, 0.42, 0.065), bone='Tail'), 0.04)
    F.ridge(sdf.Polyline([t0 + np.array((0, 0.05, 0.05)), t1 + np.array((0, -0.05, 0.03))], [0.015, 0.01]), 0.03,
            k=0.03)
    for k in range(5):
        a = math.radians(-50 + 25 * k)
        base = t1 + np.array((0.2 * math.sin(a), -0.05, 0.0))
        F.add(RoundCone(base, base + np.array((0.14 * math.sin(a), 0.16 * math.cos(a), 0.01)), 0.03, 0.006,
                        bone='Tail'), 0.02)
    for s in (1, -1):
        for j, (ang, ln, w) in enumerate(((28.0, 0.8, 0.2), (58.0, 0.68, 0.17))):
            a = math.radians(ang)
            d = np.array((s * math.sin(a), math.cos(a), 0.0))
            c = t0 + np.array((s * 0.12, 0.05, 0.0)) + d * ln * 0.5
            R = np.stack([np.cross(d, (0, 0, 1)), d, (0, 0, 1)], axis=1)
            F.add(Ellipsoid(c, (w, ln * 0.5, 0.045), R, bone='Tail'), 0.03)
    pit = Noise(23)
    F.displace(lambda X_, Y_, Z_: 0.002 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=2)
               + 0.0035 * np.abs(pit.fbm(X_ * 38, Y_ * 38, Z_ * 38, octaves=2)), band=0.04)
    return F


def body_paint(obj):
    """RegEdge (the pearl rims at each plate's back edge and the paddles'
    margins), RegGlyph (a carved crescent on each tergite and on the carapace),
    RegBelly (underneath), RegSeg (which segment: drives the iridescent shift),
    RegClaw (the clubs' heels)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    edge = np.zeros(len(P))
    glyph = np.zeros(len(P))
    seg = np.zeros(len(P))
    for i in range(6):
        a, b = ABD[i], ABD[i + 1]
        u = (y - a[1]) / (b[1] - a[1])
        inside = (u >= -0.05) & (u <= 1.05) & (np.abs(x) < ABD_W[i] * 1.1)
        edge = np.maximum(edge, np.clip(1 - np.abs(u - 0.97) / 0.07, 0, 1) * inside * (z > a[2] - 0.05))
        seg = np.where(inside, i / 5.0, seg)
        # the crescent glyph on the plate's top, horns toward the head
        cx, cy = x / 0.16, (y - (a[1] + (b[1] - a[1]) * 0.5)) / 0.16
        r = np.sqrt(cx * cx + cy * cy)
        r2 = np.sqrt(cx * cx + (cy + 0.35) ** 2)
        cres = np.clip((1 - r) / 0.12, 0, 1) * np.clip((r2 - 0.78) / 0.12, 0, 1)
        top = np.clip((z - (a[2] + ABD_H[i] * 0.6)) / 0.05, 0, 1)
        glyph = np.maximum(glyph, cres * top * inside)
    # the carapace's moon: a full moon in a crescent, carved in the shield
    Rc = _seg_frame(CHEST[0], CHEST[1])
    c = (CHEST[0] + CHEST[1]) * 0.5 + Rc[:, 2] * 0.3
    q = (P - c) @ Rc
    r = np.sqrt((q[:, 0] / 0.2) ** 2 + (q[:, 1] / 0.2) ** 2)
    r2 = np.sqrt((q[:, 0] / 0.2) ** 2 + (q[:, 1] / 0.2 + 0.3) ** 2)
    moon = np.clip((0.45 - r) / 0.08, 0, 1)
    ring = np.clip((1 - r) / 0.1, 0, 1) * np.clip((r2 - 0.85) / 0.1, 0, 1)
    glyph = np.maximum(glyph, np.maximum(moon, ring) * (q[:, 2] > 0.05))
    belly = np.clip((0.42 - z) / 0.15, 0, 1) * (y > 0.2)
    tail = np.clip((y - 3.1) / 0.1, 0, 1)
    edge = np.maximum(edge, tail * np.clip((np.linalg.norm(P - TAIL[0], axis=1) - 0.45) / 0.12, 0, 1))
    seg = np.where(y < 0.5, np.clip((0.5 - y) / 1.2, 0, 1) * -0.4, seg)
    claw = np.zeros(len(P))
    for s in (1, -1):
        h = _m(WRIST, s) + (_m(CLAW_TIP, s) - _m(WRIST, s)) * 0.15
        claw = np.maximum(claw, np.clip(1 - np.linalg.norm(P - h, axis=1) / 0.16, 0, 1))
    _write(obj, {'RegEdge': edge, 'RegGlyph': glyph, 'RegBelly': belly, 'RegSeg': seg * 0.5 + 0.5,
                 'RegClaw': claw})


# ------------------------------------------------------------------ the eyes
def build_eye(side, voxel):
    """An eye on its stalk: a ringed stalk and a long two-lobed eye whose
    midband (the glowing seam) runs round it like a moon's terminator."""
    b, t = _m(EYE_BASE, side), _m(EYE_TOP, side)
    F = Field(np.minimum(b, t) - 0.25, np.maximum(b, t) + 0.3, voxel)
    d = (t - b) / np.linalg.norm(t - b)
    F.add(RoundCone(b - d * 0.05, t - d * 0.05, 0.06, 0.05), 0.02)
    for k in range(3):
        F.add(sdf.Torus(b + d * (0.08 + 0.1 * k), tuple(d), 0.06, 0.012), 0.01)
    e = t + d * 0.1
    R = np.stack([np.cross(d, (0, 1, 0)) / np.linalg.norm(np.cross(d, (0, 1, 0))), np.cross(
        d, np.cross(d, (0, 1, 0))) / np.linalg.norm(np.cross(d, np.cross(d, (0, 1, 0)))), d], axis=1)
    F.add(Ellipsoid(e, (0.13, 0.15, 0.2), R), 0.04)
    # the midband: a groove round the eye's waist, two lobes above and below
    pts = []
    for i in range(33):
        a = 2 * math.pi * i / 32
        pts.append(e + R @ np.array((0.135 * math.cos(a), 0.155 * math.sin(a), 0.0)))
    F.groove(sdf.Polyline(pts, [0.008] * len(pts)), 0.025, k=0.02)
    return F


def eye_paint(side):
    def paint(obj):
        from rig import mesh_arrays
        P, _ = mesh_arrays(obj)
        b, t = _m(EYE_BASE, side), _m(EYE_TOP, side)
        d = (t - b) / np.linalg.norm(t - b)
        e = t + d * 0.1
        u = (P - e) @ d
        mid = np.clip(1 - np.abs(u) / 0.035, 0, 1)
        eye = np.clip((u + 0.16) / 0.04, 0, 1)
        _write(obj, {'RegMid': mid * eye, 'RegEye': eye})
    return paint


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    S = [Sculpt('Body', build_body(0.011 * k), 'shell', 17000, tau=0.035, paint=body_paint,
                spots=[(tuple((HEAD[0] + HEAD[1]) * 0.5), 0.35, 0.8)])]
    for s, side in ((1, 'L'), (-1, 'R')):
        S.append(Sculpt(f'{side}_EyeMesh', build_eye(s, 0.007 * k), 'eye', 1300, binding='rigid', bone=f'{side}_Eye',
                        paint=eye_paint(s)))
    return S


_ = X
