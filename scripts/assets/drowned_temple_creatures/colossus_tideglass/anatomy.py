"""Tideglass Colossus: skeleton and sculpts (rest pose), in yards.

A giant of tideglass, the sea-glass the moon's water hardened: a body of
great faceted crystal columns worn smooth at the edges like glass from the
sea, clear turquoise with currents of light running inside it. Geodes of
violet and moon-white crystal burst from its shoulders, elbows and knees;
nacre plates and pearls are set into its chest and brow; silver bands with
moons ring its wrists and ankles. In its chest, held in a silver crescent,
the prism: a great faceted crystal of silver and violet, the eye that casts
the Reflections. Its head is a small crowned crystal with a slit of light.

Axes: yards, +Z up, faces -Y, its left is +X. Rest is an A-pose. The crown's
tips about 6.2 up.
"""
import math

import numpy as np

import biped as B
import sdf
import sdf_ext as X
from biped import lerp, unit
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere
from sdf_ext import Prism

import gem as G

NAME = 'TideglassColossus'
PREFIX = 'colossus'

SHOULDER = np.array((1.38, 0.05, 4.72))
ELBOW = np.array((1.95, 0.16, 3.62))
WRIST = np.array((2.2, 0.0, 2.6))
HAND_TIP = np.array((2.3, -0.1, 2.06))
HIP = np.array((0.62, 0.0, 2.3))
KNEE = np.array((0.72, -0.16, 1.26))
ANKLE = np.array((0.74, 0.08, 0.42))
BALL = np.array((0.76, -0.48, 0.15))
TOE = np.array((0.76, -0.8, 0.13))
HAND = B.Hand(WRIST, HAND_TIP, 0.4, {}, thumb=((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), 0.1, 0.1))
FINGERS = ()
FINGER_FAN = {}


def hand_frame(side=1):
    return HAND.frame(side)


def finger_chain(side, name):
    return HAND.chain(side, name)


L = dict(SHOULDER=SHOULDER, ELBOW=ELBOW, WRIST=WRIST, HAND_TIP=HAND_TIP, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
         BALL=BALL, TOE=TOE, clav_parent='Spine2', clav_head=np.array((0.36, 0.05, 4.62)))
PRISM_AT = np.array((0.0, -0.86, 4.0))
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
GRIP_OFFSET_L = (0.0, 0.0, 0.0)
BAKE_CAGE, BAKE_RAY = 0.05, 0.2


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0, 2.3), (0, 0, 2.8)),
        ('Spine1', 'Hips', (0, 0, 2.8), (0, 0, 3.6)),
        ('Spine2', 'Spine1', (0, 0, 3.6), (0, 0.04, 4.8)),
        ('Neck', 'Spine2', (0, 0.04, 4.86), (0, 0.0, 5.18)),
        ('Head', 'Neck', (0, 0.0, 5.18), (0, -0.06, 5.9)),
        ('Prism', 'Spine2', tuple(PRISM_AT), tuple(PRISM_AT + np.array((0, -0.4, 0)))),
        ('Shards', 'Root', (0, -1.6, 0.0), (0, -1.6, 0.5)),
        ('Pool', 'Root', (0, 0, 0), (0, 0, 0.5)),
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
HEEL_OFF = np.array((0.0, 0.26, -0.3))
SOLE_Z = float(ANKLE[2])
GROUND = 0.04
FREE_END = ('Death',)
COLLIDE_LEGS = {}
CHAINS = []
POP_SKIP = ('Prism', 'Shards', 'Pool')
FEET = ('L_Foot', 'R_Foot')
AIM_LIMITS = {'L_Hand': 75.0, 'R_Hand': 75.0, 'L_Foot': 95.0, 'R_Foot': 95.0}
HIDDEN = {'Shards': 0.0, 'Pool': 0.0}


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


def _geode(F, base, d, r, n, bone, rng, k=0.04, spread=0.5):
    """A cluster of crystal points bursting from `base` along `d`."""
    d = unit(d)
    for i in range(n):
        q = unit(d + rng.normal(0, spread, 3))
        L = r * rng.uniform(2.2, 3.6)
        rr = r * rng.uniform(0.36, 0.55)
        F.add(Prism(base - q * 0.1, base + q * L, rr, n=6, tip=0.38, tip_a=0.05, rot=rng.uniform(0, 1), bone=bone),
              k)


# ------------------------------------------------------------------ the glass body
# Every block of the body is a cut gem (gem.py): a convex polytope round an
# ellipsoid or a cone, so the giant reads as hard faceted sea-glass, never as
# a soft body. The blocks meet with a tight fillet: those seams are where the
# light inside it breaks through (RegSeam). The spires stay hexagonal prisms.
JOIN = 0.035
BLOCKS = []   # the body's gem blocks (seams are where two of them meet)
SPIRES = []   # the violet crystal spires


def _block(F, prim, k=JOIN):
    F.add(prim, k)
    BLOCKS.append(prim)


def _spire(F, prim, k=0.012):
    F.add(prim, k)
    SPIRES.append(prim)


def build_body(voxel):
    """Massive cut-glass blocks: a deep barrel chest under a hunched back, a
    narrower waist, boulder pauldrons, columns of crystal for limbs with
    forearms heavier than the upper arms, and violet spires bursting from the
    shoulders, the spine, the elbows and the knees."""
    BLOCKS.clear()
    SPIRES.clear()
    F = Field((-3.0, -1.7, 0.2), (3.0, 2.6, 7.6), voxel)
    rng = np.random.default_rng(3)
    _block(F, G.gem_ellipsoid((0, 0.06, 4.15), (1.38, 0.95, 1.02), n=30, seed=1, chip=0.05, bone='Spine2'))
    _block(F, G.gem_ellipsoid((0, 0.52, 4.72), (1.08, 0.72, 0.72), n=20, seed=2, chip=0.05, bone='Spine2'))
    for s in (1, -1):
        # the pectoral slabs over the prism, a step down to the ribs
        _block(F, G.gem_ellipsoid((s * 0.62, -0.6, 4.58), (0.58, 0.3, 0.38), n=14, seed=4 + s, chip=0.03,
                                  bone='Spine2'))
        _block(F, G.gem_ellipsoid((s * 0.95, -0.25, 3.72), (0.42, 0.5, 0.45), n=12, seed=6 + s, chip=0.03,
                                  bone='Spine2'))
    _block(F, G.gem_ellipsoid((0, 0.0, 3.3), (0.8, 0.6, 0.7), n=18, seed=8, bone='Spine1'))
    _block(F, G.gem_ellipsoid((0, -0.4, 3.42), (0.52, 0.26, 0.3), n=12, seed=9, bone='Spine1'))
    _block(F, G.gem_ellipsoid((0, -0.36, 2.98), (0.5, 0.24, 0.28), n=12, seed=10, bone='Spine1'))
    _block(F, G.gem_ellipsoid((0, 0.02, 2.5), (0.96, 0.64, 0.48), n=18, seed=11, bone='Hips'))
    _block(F, G.gem_column((0, 0.08, 4.7), (0, -0.04, 5.12), 0.42, 0.34, sides=6, seed=12, bone='Neck'))
    for s in (1, -1):
        sh, el, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(WRIST, s)
        hp, kn, an = _m(HIP, s), _m(KNEE, s), _m(ANKLE, s)
        cl = _side('Clavicle', s)
        # boulder pauldrons, set high so the head sinks between them
        _block(F, G.gem_ellipsoid(sh + np.array((-s * 0.04, 0.04, 0.16)), (0.74, 0.7, 0.62), n=16, seed=20 + s,
                                  chip=0.06, bone=cl))
        _block(F, G.gem_column(sh, el, 0.48, 0.38, sides=7, seed=22 + s, bone=_side('UpperArm', s)))
        _block(F, G.gem_ellipsoid(el, (0.42, 0.42, 0.4), n=12, seed=24 + s, bone=_side('ElbowFix', s)))
        _block(F, G.gem_column(el, wr, 0.42, 0.6, sides=8, seed=26 + s, bone=_side('Forearm', s)))
        _block(F, G.gem_ellipsoid(hp, (0.52, 0.52, 0.5), n=12, seed=28 + s, bone=_side('Thigh', s)))
        _block(F, G.gem_column(hp, kn, 0.58, 0.45, sides=8, seed=30 + s, bone=_side('Thigh', s)))
        _block(F, G.gem_ellipsoid(kn + np.array((0, -0.08, 0)), (0.46, 0.46, 0.44), n=12, seed=32 + s,
                                  bone=_side('KneeFix', s)))
        _block(F, G.gem_column(kn, an, 0.48, 0.42, sides=7, seed=34 + s, bone=_side('Shin', s)))
    # the crystal spires (violet): great clusters on the shoulders, a ridge
    # down the spine, and smaller bursts at the elbows, forearms and knees
    for s in (1, -1):
        sh, el, kn, wr = _m(SHOULDER, s), _m(ELBOW, s), _m(KNEE, s), _m(WRIST, s)
        _big_spires(F, sh + np.array((s * 0.3, 0.24, 0.38)), (s * 0.75, 0.35, 1.0), _side('Clavicle', s), rng,
                    n=7, length=(1.5, 2.6), radius=(0.2, 0.34), spread=0.32)
        _big_spires(F, el + np.array((s * 0.2, 0.28, 0.05)), (s * 0.6, 1.0, 0.2), _side('ElbowFix', s), rng,
                    n=4, length=(0.7, 1.2), radius=(0.12, 0.2))
        _big_spires(F, (el + wr) * 0.5 + np.array((s * 0.4, 0.22, 0.0)), (s * 1.0, 0.4, 0.2), _side('Forearm', s),
                    rng, n=3, length=(0.45, 0.8), radius=(0.1, 0.15))
        _big_spires(F, kn + np.array((s * 0.05, -0.34, 0.05)), (s * 0.3, -1.0, 0.6), _side('KneeFix', s), rng,
                    n=3, length=(0.4, 0.7), radius=(0.1, 0.15))
    # the socket the prism sits in: a cut bowl in the chest, lined with nacre
    F.sub(G.gem_ellipsoid(PRISM_AT + np.array((0, -0.42, 0.0)), (0.66, 0.5, 0.66), n=18, seed=13, chip=0.0,
                          bevel=0.01), 0.03)
    for z, n, ln in ((5.05, 6, (1.6, 2.6)), (4.5, 5, (1.3, 2.1)), (3.95, 4, (0.9, 1.5)), (3.4, 3, (0.6, 1.0))):
        _big_spires(F, np.array((0.0, 0.78 + 0.12 * (z - 3.3), z)), (0.0, 1.0, 0.75),
                    'Spine2' if z > 3.6 else 'Spine1', rng, n=n, length=ln, radius=(0.15, 0.26), spread=0.55)
    return F


def _big_spires(F, base, d, bone, rng, n=5, length=(0.6, 1.2), radius=(0.12, 0.2), spread=0.42):
    d = unit(d)
    for i in range(n):
        q = unit(d + rng.normal(0, spread, 3))
        L = rng.uniform(*length)
        rr = rng.uniform(*radius)
        _spire(F, Prism(base - q * 0.25, base + q * L, rr, n=6, tip=0.34, tip_a=0.05, rot=rng.uniform(0, 1),
                        bone=bone))


def _near(prims, P):
    """Per vertex: distance to the nearest of `prims` and to the second nearest."""
    if not prims:
        return np.full(len(P), 9.0), np.full(len(P), 9.0)
    D = np.stack([p.dist_pts(P) for p in prims])
    D.sort(axis=0)
    return D[0], (D[1] if len(prims) > 1 else np.full(len(P), 9.0))


def body_paint(obj):
    """RegSeam (where two glass blocks meet: the fracture seams, lit from
    inside), RegGeode (the violet spires), RegNacre (the nacre plates set in
    the chest round the prism)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    d1, d2 = _near(BLOCKS, P)
    seam = np.clip(1 - np.abs(d2 - d1) / 0.022, 0, 1) * (d1 < 0.035)
    s1, _ = _near(SPIRES, P)
    geode = np.clip(1 - (s1 - 0.005) / 0.03, 0, 1) * (s1 < d1 + 0.02)
    d = np.linalg.norm(P - PRISM_AT, axis=1)
    nacre = np.clip((0.86 - d) / 0.06, 0, 1) * np.clip((d - 0.46) / 0.04, 0, 1) * (P[:, 1] < -0.62)
    _write(obj, {'RegSeam': seam, 'RegGeode': geode, 'RegNacre': nacre})


def limb_paint(obj):
    z = np.zeros(len(obj.data.vertices))
    _write(obj, {'RegSeam': z, 'RegGeode': z, 'RegNacre': z})


def build_fist(side, voxel):
    """A fist of cut glass: a heavy faceted block, the knuckles driven out as
    a row of violet crystal points, a slab of a thumb."""
    w, down, width, palm = hand_frame(side)
    c = w + down * 0.44
    F = Field(c - 1.1, c + 1.1, voxel)
    rng = np.random.default_rng(31 + side)
    rot = np.stack([width, palm, down], axis=1)
    F.add(G.gem_ellipsoid(c, (0.46, 0.42, 0.5), n=16, seed=40 + side, rot=rot, chip=0.04), JOIN)
    F.add(G.gem_column(w - down * 0.12, c, 0.38, 0.42, sides=7, seed=42 + side), JOIN)
    F.add(G.gem_ellipsoid(c - palm * 0.32 + width * 0.25 * side + down * 0.05, (0.16, 0.14, 0.3), n=10,
                          seed=44 + side, rot=rot), JOIN)
    for i in range(5):
        a = (i - 2) / 2.0
        q = unit(down * 0.85 + width * a * 0.55 - palm * 0.35 + rng.normal(0, 0.08, 3))
        b = c + q * 0.36
        F.add(Prism(b - q * 0.12, b + q * rng.uniform(0.32, 0.5), rng.uniform(0.09, 0.13), n=6, tip=0.42,
                    tip_a=0.1, rot=i), 0.01)
    for i in range(3):
        q = unit(palm * 0.7 + width * rng.normal(0, 0.5) + down * 0.2)
        b = c + q * 0.32
        F.add(Prism(b - q * 0.1, b + q * rng.uniform(0.26, 0.4), rng.uniform(0.08, 0.12), n=6, tip=0.4,
                    tip_a=0.1, rot=i), 0.01)
    return F


def fist_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    side = 1 if P[:, 0].mean() > 0 else -1
    w, down, width, palm = hand_frame(side)
    c = w + down * 0.44
    r = np.linalg.norm(P - c, axis=1)
    geode = np.clip((r - 0.62) / 0.12, 0, 1)
    z = np.zeros(len(P))
    _write(obj, {'RegSeam': z, 'RegGeode': geode, 'RegNacre': z})


def build_foot(side, voxel):
    an, ba, to = _m(ANKLE, side), _m(BALL, side), _m(TOE, side)
    F = Field(np.minimum(an, to) - 0.8, np.maximum(an, to) + 0.8, voxel)
    F.add(G.gem_ellipsoid((an + to) * 0.5 + np.array((0, 0.12, -0.08)), (0.5, 0.6, 0.32), n=16, seed=50 + side,
                          chip=0.04), JOIN)
    F.add(G.gem_ellipsoid(an + np.array((0, 0.04, 0.04)), (0.4, 0.4, 0.36), n=12, seed=52 + side), JOIN)
    F.sub(Ellipsoid(np.array((an[0], 0.0, -0.5)), (2.0, 2.0, 0.55)), 0.01)
    return F


HEAD_C = np.array((0.0, -0.3, 5.4))


def _slit_pts(s):
    """An eye slit under the brow, slanting up and out (the scowl)."""
    out = []
    for u in np.linspace(0.0, 1.0, 7):
        x = s * (0.08 + 0.2 * u)
        z = -0.06 + 0.1 * u
        y = -0.41 * math.sqrt(max(0.05, 1 - (x / 0.4) ** 2 - (z / 0.42) ** 2))
        out.append(HEAD_C + np.array((x, y, z)))
    return out


def build_head(voxel):
    """A low wedge of a head sunk between the pauldrons: a faceted skull, a
    heavy brow slab over two slanting slits of light, a jaw of glass, and a
    crown of three crystal horns swept back."""
    F = Field(HEAD_C - 0.9, HEAD_C + 1.1, voxel)
    F.add(G.gem_ellipsoid(HEAD_C, (0.44, 0.42, 0.42), n=16, seed=70, chip=0.03), JOIN)
    F.add(G.gem_ellipsoid(HEAD_C + np.array((0, -0.2, -0.24)), (0.32, 0.28, 0.18), n=12, seed=71), JOIN)
    for s in (1, -1):
        # the brow: two slabs meeting low over the nose, a scowl
        F.add(G.gem_column(HEAD_C + np.array((s * 0.02, -0.4, 0.04)), HEAD_C + np.array((s * 0.44, -0.27, 0.2)),
                           0.1, 0.09, sides=5, seed=72 + s, rings=((0.0, 1.0),)), 0.02)
    rng = np.random.default_rng(71)
    for dx, h, back, r in ((0.0, 0.8, 0.42, 0.13), (0.24, 0.6, 0.5, 0.11), (-0.24, 0.6, 0.5, 0.11)):
        b = HEAD_C + np.array((dx, 0.0, 0.28))
        F.add(Prism(b, b + np.array((dx * 1.2, back, h)), r, n=5, tip=0.5, rot=0.3), 0.03)
    for i in range(6):
        a = math.radians(-120 + 240 * i / 5)
        d = np.array((math.sin(a), 0.4 + 0.6 * abs(math.cos(a)), 0.3))
        b = HEAD_C + d * np.array((0.3, 0.3, 0.2))
        F.add(Prism(b, b + unit(d + np.array((0, 0.3, 0.5))) * rng.uniform(0.2, 0.32), 0.07, n=5, tip=0.45,
                    tip_a=0.1, rot=i), 0.02)
    for s in (1, -1):
        F.groove(sdf.Polyline(_slit_pts(s), [0.02] * 7), 0.06, k=0.034)
    return F


def head_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    slit = np.zeros(len(P))
    for s in (1, -1):
        pts = _slit_pts(s)
        for a, b in zip(pts[:-1], pts[1:]):
            ab = b - a
            t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
            d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
            slit = np.maximum(slit, np.clip(1 - (d - 0.035) / 0.03, 0, 1))
    horn = np.clip((P[:, 2] - (HEAD_C[2] + 0.4)) / 0.12, 0, 1)
    _write(obj, {'RegSlit': slit, 'RegHorn': horn})


def build_prism(voxel):
    """The prism, the eye: a great cut gem of silver and violet, a brilliant's
    crown of facets pointing out of the chest."""
    F = Field(PRISM_AT - 0.8, PRISM_AT + 0.8, voxel)
    F.add(Prism(PRISM_AT + np.array((0, 0.35, 0)), PRISM_AT + np.array((0, -0.44, 0)), 0.5, n=10, tip=0.55,
                tip_a=0.08, rot=0.2), 0.008)
    return F


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    S = [Sculpt('Glass', build_body(0.015 * k), 'glass', 22000, tau=0.08, paint=body_paint)]
    for s, side in ((1, 'L'), (-1, 'R')):
        S.append(Sculpt(f'{side}_Fist', build_fist(s, 0.014 * k), 'glass', 2000, binding='rigid',
                        bone=f'{side}_Hand', paint=fist_paint))
        S.append(Sculpt(f'{side}_Sole', build_foot(s, 0.016 * k), 'glass', 1200, binding='rigid',
                        bone=f'{side}_Foot', paint=limb_paint))
    S.append(Sculpt('CrystalHead', build_head(0.01 * k), 'head', 2400, binding='rigid', bone='Head',
                    paint=head_paint))
    S.append(Sculpt('PrismEye', build_prism(0.009 * k), 'prism', 700, binding='rigid', bone='Prism'))
    return S


_ = (lerp, RoundCone, X, Sphere, Noise)
