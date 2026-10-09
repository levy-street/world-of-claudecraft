"""The Lady of the Bonechill: the Hollow Crypt's second boss (the sim keeps the
spider placeholder's id, `rimeweb`; src/sim/encounters/hollow_crypt/lady.ts).

  blender -b --factory-startup --python build_lady.py -- <out.glb> [--sheet dir] [--blend out.blend]
      [--fast] [--nobake] [--work dir] [--clips A,B]

The ghost of a bride buried in the ravine's ice, drawn tall and floating: about
six and a half yards from the frozen hem to the crown, the hem hanging half a yard
over the floor. A pale, gaunt, beautiful-but-dead face with hollow eyes burning
cold white-blue, frozen tears on the cheeks, under a short blusher veil; a crown of
ice thorns over the brow; a long tattered bridal veil streaming back from the crown
as if under water; an off-shoulder bodice of frozen lace with a cracked, glowing
heart; sheer sleeves with long trailing angel tails; long thin arms and clawed
fingers; rime crystals on the shoulders; a wide tattered gown over a darker
underskirt, its hem crusted with frost and hung with icicles. Cold white, pale ice
blue and a faint violet in the folds; the glow is cold, never green.

How she is built (the organic kit, organic_kit.py, plus the Sunken Bastion drowned
kit's signed-distance sculpting, sunken_bastion_drowned/kit/sdf.py):
  * The flesh (head, neck, bodice, arms, hands) is SCULPTED as signed-distance
    fields and meshed through OpenVDB: one field for the body, finer ones for the
    head and each hand, cut under a frozen choker and inside the lace cuffs. The
    skin weights come from the sculpt's own primitives (a soft-min over them), so
    the elbow, the jaw and the fingers bend as flesh. Vertex colours paint the
    regions (skin, lips, hollow sockets, hair, the lace bodice).
  * The gown, the underskirt, the veil, the blusher, the sleeves and their tails
    are membranes (organic_kit.Membrane) weighted across hanging spar bones and
    carry a per-vertex ALPHA: solid at the bodice, translucent down the skirt,
    fading out at the torn tips. The bake folds that alpha into the albedo's alpha
    channel, so the shipping `CreatureGhostVeil` material is an alpha-BLENDED,
    double-sided image material (no transmission, no vertex alpha at runtime: the
    far-LOD bake keeps it).
  * The crown, the rime, the icicles, the claws, the cuffs, the choker and the
    sash are rigid parts; the eyes, the tears and the heart's cracks are on the
    vertex-coloured `CreatureGlow` material.
  * Cycles bakes one albedo (with AO, its shadows pushed toward violet) and a
    normal map; the head and hands get a larger share of the atlas.

Clips (24 fps; every one-shot starts and ends on CombatIdle):
  Idle          a slow float: bowed in mourning, the gown and veil drifting.
  CombatIdle    hovering, leaning in, arms half raised, the claws curled.
  Walk, Run     the gliding drift (no steps): leaning in, arms trailing, the
                gown and veil streaming back.
  Attack        a raking sweep of the right claw across her front (contact 0.54 s).
  Attack2       both claws raised overhead and raked down (contact 0.58 s).
  Hit           a recoil, the head snapped back, the gown rippling.
  Death         a silent scream, then she rises and dissolves (the whole figure
                shrinks to nothing as the gown scatters; the game adds the snow).
  Wail          the Bride's Lament (3 s) and the Bridal Freeze (2.5 s, played at
                1.2): she draws in, then throws her head back and screams, arms
                spread, the blusher and veil blown back; the peak is the end.
  EmbraceReach  the Frozen Embrace's 1.2 s bar: a coil, then a lunge reaching both
                arms to the victim's spot (1.5 yd ahead, about 2.7 to 3 yd up),
                closing round them on the last frame.
  EmbraceHold   a 2 s loop: the arms wrapped round the held body (1.5 yd ahead,
                its feet 1.4 yd over hers), cradling and rocking, the gown swirling.
  Release       0.6 s: the arms open, letting go.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'sunken_bastion_drowned', 'kit')))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
import sdf  # noqa: E402
from creature_kit import _fcurves, expand_bones  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from organic_kit import (  # noqa: E402
    BODY, GLOW, MEMBRANE, Membrane, Part, Rig, _node, _sock, bind, build_armature, export, join, new_scene,
    srgb_to_linear, triangles, two_bone,
)

# ------------------------------------------------------------------ palette (sRGB)
SKIN = (0.74, 0.8, 0.93)
SKIN_HI = (0.93, 0.96, 1.0)
SKIN_SHADE = (0.58, 0.58, 0.8)      # the violet in the hollows of a dead face
SOCKET = (0.1, 0.07, 0.19)
LIPS = (0.5, 0.52, 0.76)
MOUTH = (0.05, 0.03, 0.1)
HAIR = (0.86, 0.89, 0.97)
HAIR_SH = (0.6, 0.64, 0.84)
SATIN = (0.93, 0.95, 1.0)           # the bodice
SATIN_SH = (0.66, 0.7, 0.92)
LACE = (0.97, 0.98, 1.0)
FROST_TIP = (0.46, 0.56, 0.84)      # frostbitten fingertips
CLAW = (0.2, 0.25, 0.46)
ICE = (0.66, 0.84, 1.0)
ICE_DEEP = (0.34, 0.5, 0.86)
ICE_HI = (0.93, 0.97, 1.0)
GOWN_TOP = (0.87, 0.92, 1.0)
GOWN_MID = (0.84, 0.9, 1.0)
GOWN_LOW = (0.75, 0.83, 1.0)
GOWN_FOLD = (0.64, 0.6, 0.92)      # violet in the folds
FROST = (0.93, 0.97, 1.0)
UNDER = (0.62, 0.64, 0.92)
UNDER_LOW = (0.54, 0.54, 0.88)
VEIL_TOP = (0.9, 0.94, 1.0)
VEIL_TAIL = (0.68, 0.78, 1.0)
GLOW_EYE = (0.76, 0.91, 1.0)
GLOW_HOT = (0.97, 1.0, 1.0)
GLOW_DEEP = (0.36, 0.58, 1.0)

GHOST = MEMBRANE   # material index 2: the alpha-blended ghost cloth
SKIRT = 14         # gown spars round the waist
VEIL = 7           # veil spars across the back of the crown
NECK_CUT = 6.08    # the head field meets the body field here, under the choker


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def _n(v):
    return Vector(v).normalized()


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ landmarks (left side)
SH = V(0.5, 0.04, 5.74)       # shoulder joint
EL = V(1.0, 0.14, 4.72)       # elbow
WR = V(1.22, -0.1, 3.72)      # wrist
FORE_DIR = _n(WR - EL)
H_L = _n(FORE_DIR + V(0.0, -0.12, 0.0))          # wrist to knuckles
N_L = _n(V(-1.0, 0.15, 0.0) - H_L * H_L.dot(V(-1.0, 0.15, 0.0)))   # palm normal, toward the body
A_L = H_L.cross(N_L).normalized()                # across the hand, the little finger's side
T_L = -A_L                                       # the thumb's side (forward)
KN = WR + H_L * 0.25
# index, middle, ring, little: (offset toward the thumb, length scale, fan)
FINGERS = [(0.072, 0.95, 0.1), (0.024, 1.0, 0.03), (-0.024, 0.97, -0.03), (-0.068, 0.82, -0.1)]
SEG = (0.17, 0.13, 0.11)
CURL = (math.radians(10), math.radians(20), math.radians(24))


def finger_points(i, side=1):
    """The joints of finger `i` (knuckle to tip) and its last direction, at rest."""
    off, sc, fan = FINGERS[i]
    k = KN + T_L * off
    d = _n(H_L + T_L * fan)
    pts = [k]
    for j, ln in enumerate(SEG):
        axis = d.cross(N_L).normalized()
        d = (Matrix.Rotation(CURL[j], 3, axis) @ d).normalized()
        pts.append(pts[-1] + d * ln * sc)
    return pts, d


def thumb_points():
    base = WR + H_L * 0.08 + T_L * 0.06 + N_L * 0.025
    d = _n(H_L * 0.7 + T_L * 0.55 + N_L * 0.3)
    pts = [base]
    for j, ln in enumerate((0.11, 0.09, 0.075)):
        axis = d.cross(N_L).normalized()
        d = (Matrix.Rotation(math.radians(8 + 6 * j), 3, axis) @ d).normalized()
        pts.append(pts[-1] + d * ln)
    return pts, d


def _mean(vs):
    out = Vector((0, 0, 0))
    for v in vs:
        out += v
    return out / len(vs)


FING_HEAD = _mean([finger_points(i)[0][0] for i in range(4)])
FING_MID = _mean([finger_points(i)[0][2] for i in range(4)])
FING_TIP = _mean([finger_points(i)[0][3] for i in range(4)])
THUMB = thumb_points()[0]


# --------------------------------------------------------------------- gown and veil spars
def skirt_angle(k):
    return math.tau * k / SKIRT


def skirt_stations(k, waist):
    """The k-th gown spar: the waist point (on the body) then hips, knee, calf,
    hem. The back of the gown trails into a floating train."""
    a = skirt_angle(k)
    sa, ca = math.sin(a), math.cos(a)
    bk = max(0.0, -ca)
    return [
        Vector(waist),
        V(sa * 0.5, -ca * 0.4 + 0.04, 4.2),
        V(sa * 0.82, -ca * 0.74 + 0.05 + 0.2 * bk, 3.1),
        V(sa * 1.04, -ca * 0.98 + 0.06 + 0.62 * bk * bk, 2.0),
        V(sa * 1.22, -ca * 1.15 + 0.08 + 1.4 * bk * bk, 0.72 + 0.32 * bk),
    ]


def veil_stations(k):
    """The k-th veil spar, from the back of the crown streaming back and up."""
    s = -1.0 + 2.0 * k / (VEIL - 1)
    phi = s * 1.25
    return [
        V(math.sin(phi) * 0.235, 0.05 + math.cos(phi) * 0.27, 6.8 - 0.04 * abs(s)),
        V(s * 0.44, 0.52, 6.0),
        V(s * 0.8, 0.68, 5.0),
        V(s * 1.0, 1.2, 3.85),
        V(s * 1.15, 2.1, 2.95),
        V(s * 1.26, 3.15, 2.25),
    ]


BLUSH = [V(0, -0.25, 6.8), V(0, -0.38, 6.45), V(0, -0.43, 5.92)]

# The waist ring and the skirt bones need the sculpted waist; the ring is
# re-projected onto the meshed body (WAIST below is the analytic first guess).
WAIST_Z = 4.74


def waist_guess(k):
    a = skirt_angle(k)
    return V(math.sin(a) * 0.255, -math.cos(a) * 0.2 + 0.03, WAIST_Z)


def _skirt_bones(waist):
    out = []
    for k in range(SKIRT):
        st = skirt_stations(k, waist[k])
        parent = 'Hips'
        for j, tag in enumerate('abcd'):
            out.append((f'Skirt{k}{tag}', parent, tuple(st[j]), tuple(st[j + 1])))
            parent = f'Skirt{k}{tag}'
    return out


def _veil_bones():
    out = []
    for k in range(VEIL):
        st = veil_stations(k)
        parent = 'Head'
        for j, tag in enumerate('abcde'):
            out.append((f'Veil{k}{tag}', parent, tuple(st[j]), tuple(st[j + 1])))
            parent = f'Veil{k}{tag}'
    return out


TRAIL_HEAD = EL.lerp(WR, 0.55) + _n(A_L + V(0.35, 0, 0)) * 0.06
TRAIL_DOWN = _n(V(0.05, 0.18, -1.0))


def make_bones(waist):
    return expand_bones([
        ('Root', None, (0, 0, 0), (0, 0, 0.6)),
        ('Hips', 'Root', (0, 0.03, 4.32), (0, 0.03, WAIST_Z)),
        ('Spine', 'Hips', (0, 0.03, WAIST_Z), (0, 0.02, 5.22)),
        ('Chest', 'Spine', (0, 0.02, 5.22), (0, 0.02, 5.82)),
        ('Neck', 'Chest', (0, 0.02, 5.82), (0, -0.01, 6.24)),
        ('Head', 'Neck', (0, -0.01, 6.24), (0, -0.03, 6.95)),
        ('Jaw', 'Head', (0, -0.03, 6.37), (0, -0.2, 6.21)),
        ('Blush1', 'Head', tuple(BLUSH[0]), tuple(BLUSH[1])),
        ('Blush2', 'Blush1', tuple(BLUSH[1]), tuple(BLUSH[2])),
        ('Arm.L', 'Chest', tuple(SH), tuple(EL)),
        ('Fore.L', 'Arm.L', tuple(EL), tuple(WR)),
        ('Hand.L', 'Fore.L', tuple(WR), tuple(FING_HEAD)),
        ('Fing.L', 'Hand.L', tuple(FING_HEAD), tuple(FING_MID)),
        ('FingT.L', 'Fing.L', tuple(FING_MID), tuple(FING_TIP)),
        ('Thumb.L', 'Hand.L', tuple(THUMB[0]), tuple(THUMB[2])),
        ('Trail1.L', 'Fore.L', tuple(TRAIL_HEAD), tuple(TRAIL_HEAD + TRAIL_DOWN * 0.75)),
        ('Trail2.L', 'Trail1.L', tuple(TRAIL_HEAD + TRAIL_DOWN * 0.75), tuple(TRAIL_HEAD + TRAIL_DOWN * 1.5)),
    ] + _skirt_bones(waist) + _veil_bones())


# ------------------------------------------------------------------ the sculpt
class SP:
    """A sculpt primitive: the sdf primitive, its blend radius, its bone (the skin
    weights), its region (the vertex paint) and its weight temperature."""

    def __init__(self, prim, k, bone, region='skin', tau=0.05, sub=False):
        self.prim, self.k, self.bone, self.region, self.tau, self.sub = prim, k, bone, region, tau, sub


def _mirror_prim(p):
    """The .R twin of a .L primitive (x -> -x)."""
    m = np.diag([-1.0, 1.0, 1.0])
    q = p.prim
    if isinstance(q, sdf.RoundCone):
        new = sdf.RoundCone(q.a * [-1, 1, 1], q.b * [-1, 1, 1], q.ra, q.rb)
    elif isinstance(q, sdf.Ellipsoid):
        new = sdf.Ellipsoid(q.c * [-1, 1, 1], q.r, m @ q.R @ m)
    else:
        raise TypeError(type(q))
    bone = p.bone[:-2] + '.R' if p.bone.endswith('.L') else p.bone
    return SP(new, p.k, bone, p.region, p.tau, p.sub)


def _frame(x, y, z):
    return np.array([list(x), list(y), list(z)]).T


def sculpt_prims():
    E, RC, S = sdf.Ellipsoid, sdf.RoundCone, sdf.Sphere
    P = []

    def add(prim, k, bone, region='skin', tau=0.05, sub=False):
        P.append(SP(prim, k, bone, region, tau, sub))

    # --- the head: a long oval skull, a high forehead, blade cheekbones over sunken
    # cheeks, deep sockets, a fine straight nose, thin parted lips, a narrow chin.
    hd = 0.012
    add(E((0, 0.03, 6.62), (0.212, 0.252, 0.245)), 0.0, 'Head', 'hair', hd)
    add(E((0, -0.1, 6.64), (0.176, 0.14, 0.17)), 0.06, 'Head', 'skin', hd)
    add(E((0, -0.1, 6.46), (0.165, 0.168, 0.2)), 0.07, 'Head', 'skin', hd)
    add(E((0, 0.2, 6.4), (0.1, 0.09, 0.09)), 0.06, 'Head', 'hair', hd)                     # the low chignon
    for s in (-1, 1):
        add(E((s * 0.128, -0.17, 6.475), (0.066, 0.055, 0.038)), 0.04, 'Head', 'cheek', hd)  # cheekbones
        add(E((s * 0.074, -0.218, 6.582), (0.07, 0.03, 0.022)), 0.035, 'Head', 'skin', hd)  # brow
        add(E((s * 0.072, -0.236, 6.528), (0.046, 0.016, 0.01)), 0.01, 'Head', 'lid', hd)   # upper lid
        add(E((s * 0.018, -0.268, 6.442), (0.014, 0.013, 0.011)), 0.01, 'Head', 'skin', hd)  # alae
    add(RC((0, -0.25, 6.55), (0, -0.282, 6.462), 0.011, 0.015), 0.02, 'Head', 'skin', hd)  # nose
    add(E((0, -0.284, 6.452), (0.018, 0.017, 0.015)), 0.014, 'Head', 'skin', hd)
    add(E((0, -0.2, 6.365), (0.098, 0.08, 0.058)), 0.05, 'Head', 'skin', hd)                # upper jaw
    add(E((0, -0.258, 6.338), (0.048, 0.02, 0.013)), 0.012, 'Head', 'lips', hd)             # upper lip
    add(E((0, -0.11, 6.3), (0.1, 0.1, 0.06)), 0.06, 'Jaw', 'skin', hd)                      # mandible
    add(E((0, -0.205, 6.245), (0.04, 0.04, 0.036)), 0.04, 'Jaw', 'skin', hd)                # chin
    for s in (-1, 1):
        add(RC((s * 0.125, -0.02, 6.39), (s * 0.045, -0.18, 6.255), 0.026, 0.022), 0.04, 'Jaw', 'skin', hd)
    add(E((0, -0.246, 6.3), (0.04, 0.02, 0.015)), 0.012, 'Jaw', 'lips', hd)                 # lower lip
    # hollows: the sockets, the sunken cheeks and temples, the parted mouth
    for s in (-1, 1):
        add(E((s * 0.074, -0.236, 6.5), (0.058, 0.05, 0.04)), 0.024, 'Head', 'socket', hd, sub=True)
        add(E((s * 0.118, -0.215, 6.372), (0.05, 0.05, 0.06)), 0.04, 'Head', 'skin', hd, sub=True)
        add(E((s * 0.198, -0.1, 6.6), (0.035, 0.06, 0.07)), 0.04, 'Head', 'skin', hd, sub=True)
    add(E((0, -0.268, 6.319), (0.04, 0.04, 0.0065)), 0.006, 'Head', 'mouth', hd, sub=True)
    add(E((0, -0.2, 6.312), (0.036, 0.06, 0.026)), 0.01, 'Head', 'mouth', hd, sub=True)
    # --- the neck: long and thin, its tendons drawn, the collarbones sharp
    add(RC((0, 0.03, 5.78), (0, 0.0, 6.32), 0.1, 0.084), 0.08, 'Neck', 'skin', 0.05)
    for s in (-1, 1):
        add(RC((s * 0.072, 0.0, 6.22), (s * 0.024, -0.075, 5.86), 0.021, 0.017), 0.03, 'Neck', 'skin', 0.04)
        add(RC((s * 0.035, -0.15, 5.82), (s * 0.38, -0.04, 5.86), 0.019, 0.016), 0.04, 'Chest', 'skin', 0.05)
        add(E((s * 0.2, 0.06, 5.86), (0.18, 0.1, 0.07)), 0.08, 'Chest', 'skin', 0.06)          # trapezius
        add(E((s * 0.17, 0.2, 5.5), (0.11, 0.06, 0.13)), 0.06, 'Chest', 'bodice', 0.06)        # shoulder blades
        add(E((s * 0.13, -0.155, 5.36), (0.12, 0.09, 0.1)), 0.07, 'Chest', 'bodice', 0.06)     # bust
    add(E((0, 0.02, 5.42), (0.36, 0.235, 0.43)), 0.1, 'Chest', 'bodice', 0.07)               # ribcage
    add(E((0, 0.03, 4.98), (0.24, 0.18, 0.36)), 0.14, 'Spine', 'bodice', 0.08)                # waist
    add(E((0, 0.04, 4.5), (0.3, 0.22, 0.3)), 0.12, 'Hips', 'bodice', 0.08)                    # hips
    # --- the arms: long and thin, bony at the elbow
    add(E((0.48, 0.04, 5.7), (0.085, 0.085, 0.1)), 0.14, 'Arm.L', 'skin', 0.05)               # deltoid
    add(E((0.34, 0.04, 5.76), (0.14, 0.1, 0.08)), 0.1, 'Chest', 'skin', 0.06)                 # shoulder slope
    add(RC(tuple(SH), tuple(EL), 0.08, 0.058), 0.07, 'Arm.L', 'skin', 0.05)
    add(S(tuple(EL), 0.05), 0.03, 'Fore.L', 'skin', 0.04)
    add(RC(tuple(EL), tuple(WR), 0.056, 0.04), 0.04, 'Fore.L', 'skin', 0.04)
    # --- the hand: a long palm, four long jointed fingers, the thumb
    ht = 0.014
    add(RC(tuple(WR - H_L * 0.03), tuple(WR + H_L * 0.05), 0.04, 0.042), 0.02, 'Hand.L', 'hand', ht)
    add(E(tuple(WR + H_L * 0.14 + N_L * 0.004), (0.082, 0.03, 0.12), _frame(A_L, N_L, H_L)), 0.03, 'Hand.L',
        'hand', ht)
    add(E(tuple(WR + H_L * 0.08 + T_L * 0.045 + N_L * 0.02), (0.04, 0.03, 0.05), _frame(A_L, N_L, H_L)),
        0.025, 'Hand.L', 'hand', ht)
    for i in range(4):
        pts, _ = finger_points(i)
        add(RC(tuple(WR + H_L * 0.05 + T_L * FINGERS[i][0] * 0.6), tuple(pts[0]), 0.015, 0.017), 0.015,
            'Hand.L', 'hand', ht)
        add(S(tuple(pts[0]), 0.025), 0.012, 'Hand.L', 'hand', ht)
        radii = (0.022, 0.019, 0.0165, 0.012)
        bones = ('Fing.L', 'Fing.L', 'FingT.L')
        for j in range(3):
            add(RC(tuple(pts[j]), tuple(pts[j + 1]), radii[j], radii[j + 1]), 0.008, bones[j], 'finger', ht)
            if j < 2:
                add(S(tuple(pts[j + 1]), radii[j + 1] * 1.12), 0.006, bones[j], 'finger', ht)
    tp, _ = thumb_points()
    for j in range(3):
        add(RC(tuple(tp[j]), tuple(tp[j + 1]), 0.024 - 0.004 * j, 0.02 - 0.004 * j), 0.01, 'Thumb.L', 'finger', ht)
    out = []
    for p in P:
        out.append(p)
        if p.bone.endswith('.L'):
            out.append(_mirror_prim(p))
    return out


def mesh_field(prims, lo, hi, voxel, name, work):
    f = sdf.Field(lo, hi, voxel)
    for p in prims:
        if not p.sub:
            f.add(p.prim, p.k, weight=False)
    for p in prims:
        if p.sub:
            f.sub(p.prim, p.k)
    ob = sdf.to_mesh(f, name, bpy, workdir=work)
    print('FIELD', name, f.shape, len(ob.data.vertices))
    return ob


def cut(obj, drop):
    """Delete every vertex for which drop(co) is true."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    gone = [v for v in bm.verts if drop(v.co)]
    bmesh.ops.delete(bm, geom=gone, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()


def decimate(obj, target, symmetric=False):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    ratio = min(1.0, target / max(1, tris))
    if ratio < 0.999:
        mod = obj.modifiers.new('dec', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        if symmetric:
            mod.use_symmetry = True
            mod.symmetry_axis = 'X'
        for o in bpy.context.selected_objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True


def skin(obj, prims, uv_boost=0.0):
    """Skin weights (a soft-min over the sculpt's primitives, each with its own
    temperature), the region paint, the lace mask and the atlas boost."""
    me = obj.data
    n = len(me.vertices)
    P = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    P = P.reshape(-1, 3)
    adds = [p for p in prims if not p.sub]
    D = np.stack([p.prim.dist_pts(P) for p in adds])
    dmin = D.min(axis=0)
    E = np.stack([np.exp(-(D[j] - dmin) / adds[j].tau) for j in range(len(adds))])
    bones = sorted({p.bone for p in adds})
    W = np.zeros((n, len(bones)))
    for j, p in enumerate(adds):
        W[:, bones.index(p.bone)] += E[j]
    W /= W.sum(axis=1, keepdims=True)
    W[W < 0.01] = 0
    W /= W.sum(axis=1, keepdims=True)
    for b, name in enumerate(bones):
        idx = np.nonzero(W[:, b])[0]
        if len(idx) == 0:
            continue
        g = obj.vertex_groups.new(name=name)
        for i in idx:
            g.add([int(i)], float(W[i, b]), 'REPLACE')
    region = [adds[j].region for j in D.argmin(axis=0)]
    cols = np.zeros((n, 4))
    lace = np.zeros(n)
    for i in range(n):
        c, lm = paint(Vector(P[i]), region[i])
        cols[i, :3] = srgb_to_linear(c)
        cols[i, 3] = 1.0
        lace[i] = lm
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    li = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', li)
    attr.data.foreach_set('color', cols[li].ravel())
    la = me.attributes.new('LaceMask', 'FLOAT', 'POINT')
    la.data.foreach_set('value', lace)
    ub = me.attributes.new('UvBoost', 'FLOAT', 'POINT')
    ub.data.foreach_set('value', np.full(n, uv_boost))


def paint(p, region):
    """The vertex colour (sRGB) and lace mask of a sculpt vertex at rest."""
    x, y, z = p
    ax = abs(x)
    if region in ('hand', 'finger'):
        s = 1.0 if x > 0 else -1.0
        q = Vector((ax, y, z))
        d = (q - WR).dot(H_L)
        c = lerp(SKIN, FROST_TIP, ss(0.28, 0.62, d) * 0.85)
        # the knuckles and the backs of the fingers a shade bluer
        if (q - WR).dot(N_L) < -0.01:
            c = lerp(c, SKIN_SHADE, 0.25)
        del s
        return c, 0.0
    if z > 6.0:
        # the face: hollows violet, the sockets near black, the lips a dead blue
        c = SKIN
        c = lerp(c, SKIN_HI, 0.35 * ss(6.55, 6.75, z) * ss(-0.15, -0.24, y))      # the forehead catches the light
        sock = 0.0
        for s in (-1, 1):
            q = ((x - s * 0.074) / 0.06) ** 2 + ((y + 0.236) / 0.06) ** 2 + ((z - 6.5) / 0.045) ** 2
            sock = max(sock, 1.0 - ss(0.5, 1.6, q))
        hollow = 0.0
        for s in (-1, 1):
            q = ((x - s * 0.118) / 0.07) ** 2 + ((z - 6.37) / 0.08) ** 2
            hollow = max(hollow, 1.0 - ss(0.2, 1.2, q)) * ss(-0.1, -0.2, y)
        c = lerp(c, SKIN_SHADE, 0.55 * hollow)
        c = lerp(c, SOCKET, sock ** 1.3)
        if region == 'lips' or (abs(x) < 0.05 and 6.29 < z < 6.35 and y < -0.22):
            c = lerp(c, LIPS, 0.85)
        if region == 'mouth' or (abs(x) < 0.04 and 6.3 < z < 6.33 and y > -0.262):
            c = MOUTH
        # the hair: a cap of frost-white hair swept back under the veil
        front = 6.74 - 0.18 * ss(0.12, 0.2, ax) - 0.12 * ss(-0.1, 0.05, y)
        if region == 'hair' or (z > front and y > -0.2) or (y > 0.02 and z > 6.3):
            if not (region in ('skin', 'cheek', 'lid', 'lips', 'mouth') and y < -0.12):
                c = lerp(HAIR, HAIR_SH, 0.35 * ss(6.9, 6.5, z) + 0.2 * ss(0.1, 0.3, y))
        return c, 0.0
    # the body: skin above the off-shoulder neckline, the lace bodice below it
    neck_line = 5.6 - 0.07 * math.exp(-(x / 0.07) ** 2) * (1.0 if y < 0 else 0.0) + 0.03 * ss(0.2, 0.4, ax)
    if region == 'bodice' or (z < neck_line and ax < 0.42):
        c = lerp(SATIN, SATIN_SH, 0.25 * ss(5.0, 4.3, z) + 0.15 * ss(0.05, 0.25, y))
        trim = 1.0 - ss(0.0, 0.035, abs(z - neck_line))
        c = lerp(c, LACE, trim)
        return c, 1.0 - trim
    c = lerp(SKIN, SKIN_SHADE, 0.2 * ss(5.9, 5.75, z) * ss(0.1, 0.3, ax))
    return c, 0.0


def sculpt(work, fast):
    prims = sculpt_prims()
    v_body = 0.016 if fast else 0.0125
    v_fine = 0.009 if fast else 0.0058
    body = mesh_field(prims, (-1.45, -0.42, 3.56), (1.45, 0.42, 6.2), v_body, 'LadyBodySculpt', work)
    head = mesh_field(prims, (-0.3, -0.36, 5.98), (0.3, 0.36, 6.98), v_fine, 'LadyHeadSculpt', work)
    hands = []
    for tag in ('.L', '.R'):
        own = [p for p in prims if p.bone in ('Hand' + tag, 'Fing' + tag, 'FingT' + tag, 'Thumb' + tag)]
        lo = np.min([p.prim.lo for p in own], axis=0) - 0.06
        hi = np.max([p.prim.hi for p in own], axis=0) + 0.06
        hands.append(mesh_field(prims, lo, hi, v_fine, 'LadyHandSculpt' + tag[1], work))
    # the cuts: the head above the choker, each hand beyond the wrist, the body between
    head_lo = NECK_CUT - 0.006

    def beyond_wrist(co):
        q = Vector((abs(co.x), co.y, co.z))
        return (q - WR).dot(H_L) > 0.004

    cut(body, lambda co: co.z > NECK_CUT + 0.006 or beyond_wrist(co))
    cut(head, lambda co: co.z < head_lo)
    for h in hands:
        cut(h, lambda co: (Vector((abs(co.x), co.y, co.z)) - WR).dot(H_L) < -0.006)
    decimate(body, 4200 if fast else 10500, symmetric=True)
    decimate(head, 2500 if fast else 6400, symmetric=True)
    for h in hands:
        decimate(h, 1200 if fast else 2600)
    skin(body, prims)
    skin(head, prims, uv_boost=1.0)
    for h in hands:
        skin(h, prims, uv_boost=1.0)
    for o in [body, head] + hands:
        lo = [min(v.co[i] for v in o.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) for i in range(3)]
        print('SCULPT', o.name, len(o.data.polygons), [round(c, 3) for c in lo], [round(c, 3) for c in hi])
    return body, head, hands


# ------------------------------------------------------------------ projection helpers
class Surface:
    """Ray casts onto the sculpted flesh (rest pose), to seat the rigid dressing."""

    def __init__(self, objs):
        self.trees = []
        dg = bpy.context.evaluated_depsgraph_get()
        for o in objs:
            self.trees.append(BVHTree.FromObject(o, dg))

    def cast(self, origin, direction, offset=0.0):
        best = None
        for t in self.trees:
            hit = t.ray_cast(Vector(origin), Vector(direction).normalized())
            if hit[0] is not None and (best is None or hit[3] < best[3]):
                best = hit
        if best is None:
            return None
        loc, nrm = best[0], best[1]
        if nrm.dot(Vector(direction)) > 0:
            nrm = -nrm
        return loc + nrm * offset, nrm

    def front(self, x, z, offset=0.004):
        return self.cast((x, -2.0, z), (0, 1, 0), offset)

    def around(self, center, theta, offset=0.01):
        """Out from the torso's axis at angle theta (0 dead ahead)."""
        c = Vector(center)
        return self.cast(c, (math.sin(theta), -math.cos(theta), 0), offset)


# ------------------------------------------------------------------ ghost cloth
class Cloth(Membrane):
    """A membrane with a per-vertex alpha (the ghost's translucency) and its own
    material slot; `rings` builds a closed sleeve or ribbon tube with per-ring
    weights."""

    def __init__(self, name, color, seed=1, mat=GHOST):
        super().__init__(name, color, seed)
        self.alpha = []
        self.mat = mat

    def ghost_panel(self, a, b, alpha, recolor=None, **kw):
        base = len(self.verts)
        super().panel(a, b, **kw)
        rows, cols = kw.get('rows', 10), kw.get('cols', 8)
        i = base
        for r in range(rows + 1):
            for c in range(cols + 1):
                u, v = r / rows, c / cols
                co = self.verts[i][0]
                self.alpha.append(alpha(u, v, co))
                if recolor is not None:
                    self.cols_rgb[i] = recolor(u, v, co, self.cols_rgb[i])
                i += 1
        return base

    def rings(self, rings, closed=True):
        """rings: [(points, {bone: w}, colour, alpha)], each ring the same count."""
        base = len(self.verts)
        n = len(rings[0][0])
        for pts, w, col, al in rings:
            for p in pts:
                self.verts.append((Vector(p), dict(w)))
                self.cols_rgb.append(col)
                self.alpha.append(al)
        for i in range(len(rings) - 1):
            for k in range(n if closed else n - 1):
                a = base + i * n + k
                b = base + i * n + (k + 1) % n
                self.faces.append((a, b, b + n, a + n))
        return base

    def to_object(self, materials):
        obj = super().to_object(materials)
        mesh = obj.data
        col = mesh.color_attributes['Col']
        for poly in mesh.polygons:
            poly.material_index = self.mat
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                r, g, b = srgb_to_linear(self.cols_rgb[vi])
                col.data[li].color = (r, g, b, self.alpha[vi] if self.mat == GHOST else 1.0)
        return obj


def _spar(points, bones):
    """Stations at points, the mid-points between them bound to the next bone."""
    out = [(tuple(points[0]), bones[0])]
    for j in range(1, len(points)):
        a, b = Vector(points[j - 1]), Vector(points[j])
        out.append((tuple(a.lerp(b, 0.5)), bones[j]))
        out.append((tuple(b), bones[j]))
    return out


def build_cloth(waist):
    cloths = []
    # --- the gown: hip to a torn, frosted hem; violet in the folds, translucent below
    gown = Cloth('Gown', GOWN_TOP, seed=11)
    spars = []
    for k in range(SKIRT):
        st = skirt_stations(k, waist[k])
        spars.append(_spar(st, ['Hips'] + [f'Skirt{k}{t}' for t in 'abcd']))

    def gown_alpha(u, v, co):
        a = 0.95 - 0.55 * ss(4.4, 1.6, co.z)
        a *= 1.0 - 0.75 * ss(0.72, 1.0, u)          # the torn tips fade out
        frost = ss(0.8, 0.9, u) * (1.0 - ss(0.96, 1.0, u))
        return max(0.06, min(1.0, a + 0.22 * frost))

    def gown_color(u, v, co, c):
        base = lerp(GOWN_TOP, GOWN_MID, ss(4.4, 2.6, co.z))
        base = lerp(base, GOWN_LOW, ss(2.6, 1.0, co.z))
        fold = 1.0 - math.sin(math.pi * v)          # the spars are the fold valleys
        base = lerp(base, GOWN_FOLD, 0.55 * fold ** 2)
        base = lerp(base, FROST, 0.75 * ss(0.8, 0.92, u))
        return base

    for k in range(SKIRT):
        gown.ghost_panel(spars[k], spars[(k + 1) % SKIRT], gown_alpha, gown_color, rows=26, cols=8,
                         scallop=0.06, tear=1.25, shade=1.0, reach=1.0)
    cloths.append(gown)
    # --- the underskirt: shorter, darker, deeper violet, inside the gown
    under = Cloth('Underskirt', UNDER, seed=13)
    us = []
    for k in range(SKIRT):
        st = skirt_stations(k, waist[k])
        a = skirt_angle(k)
        inward = V(math.sin(a), -math.cos(a), 0)
        pts = [st[0]] + [p - inward * (0.08 + 0.06 * j) + V(0, 0, 0.08 * j) for j, p in enumerate(st[1:], 1)]
        us.append(_spar(pts, ['Hips'] + [f'Skirt{k}{t}' for t in 'abcd']))

    def under_alpha(u, v, co):
        return max(0.05, (0.9 - 0.5 * ss(4.0, 1.4, co.z)) * (1.0 - 0.8 * ss(0.65, 1.0, u)))

    def under_color(u, v, co, c):
        return lerp(lerp(UNDER, UNDER_LOW, ss(3.5, 1.2, co.z)), GOWN_FOLD, 0.3 * (1 - math.sin(math.pi * v)))

    for k in range(SKIRT):
        under.ghost_panel(us[k], us[(k + 1) % SKIRT], under_alpha, under_color, rows=18, cols=5, scallop=0.1,
                          tear=1.4, shade=1.0, reach=0.86)
    cloths.append(under)
    # --- the veil: from the crown, streaming back; a lace border down its edges
    veil = Cloth('Veil', VEIL_TOP, seed=19)
    vs = [_spar(veil_stations(k), ['Head'] + [f'Veil{k}{t}' for t in 'abcde']) for k in range(VEIL)]

    def veil_alpha_for(k):
        def fn(u, v, co):
            edge = (k == 0 and v < 0.2) or (k == VEIL - 2 and v > 0.8)
            a = 0.7 - 0.38 * ss(0.1, 0.7, u)
            a *= 1.0 - 0.85 * ss(0.7, 1.0, u)
            return max(0.04, min(1.0, a + (0.18 if edge else 0.0) * (1 - u)))
        return fn

    def veil_color_for(k):
        def fn(u, v, co, c):
            base = lerp(VEIL_TOP, VEIL_TAIL, ss(0.15, 0.9, u))
            base = lerp(base, GOWN_FOLD, 0.35 * (1.0 - math.sin(math.pi * v)) ** 2)
            if (k == 0 and v < 0.2) or (k == VEIL - 2 and v > 0.8):
                base = lerp(base, LACE, 0.8)
            return base
        return fn

    for k in range(VEIL - 1):
        veil.ghost_panel(vs[k], vs[k + 1], veil_alpha_for(k), veil_color_for(k), rows=30, cols=7,
                         scallop=0.03, tear=0.95, shade=1.0)
    cloths.append(veil)
    # --- the blusher: the short veil over the face (it blows back in the wail)
    blush = Cloth('Blusher', VEIL_TOP, seed=23)
    bs = []
    for x in (-1.0, 0.0, 1.0):
        pts = [V(x * 0.2, -0.25 - 0.012 * (1 - abs(x)), 6.8 - 0.02 * abs(x)), V(x * 0.27, -0.38 + 0.07 * abs(x), 6.45),
               V(x * 0.37, -0.43 + 0.1 * abs(x), 6.04), V(x * 0.43, -0.41 + 0.12 * abs(x), 5.8)]
        bs.append([(tuple(pts[0]), 'Head'), (tuple(pts[1]), 'Blush1'), (tuple(pts[2]), 'Blush2'),
                   (tuple(pts[3]), 'Blush2')])

    def blush_alpha(u, v, co):
        return max(0.05, (0.34 + 0.14 * ss(0.85, 1.0, u)) * (1.0 - 0.6 * ss(0.92, 1.0, u)))

    def blush_color(u, v, co, c):
        return lerp(VEIL_TOP, LACE, 0.7 * ss(0.86, 0.97, u))

    for k in range(2):
        blush.ghost_panel(bs[k], bs[k + 1], blush_alpha, blush_color, rows=16, cols=7, scallop=0.0, tear=0.3,
                          shade=1.0)
    cloths.append(blush)
    # --- the sleeves: sheer tubes from below the shoulder to a lace cuff, and the
    # long angel tails hanging from the forearms
    for s, tag in ((1, '.L'), (-1, '.R')):
        sl = Cloth('Sleeve' + tag, SATIN, seed=29 + s)
        m = Vector((s, 1, 1))
        rings = []
        n = 12
        for i in range(15):
            t = i / 14
            if t < 0.5:
                c = SH.lerp(EL, -0.06 + t / 0.5 * 1.06)
                d = _n(EL - SH)
                r = 0.08 + (0.058 - 0.08) * (t / 0.5) + 0.05 * (1 - ss(0.0, 0.18, t))
            else:
                c = EL.lerp(WR + H_L * 0.04, (t - 0.5) / 0.5)
                d = FORE_DIR
                r = 0.056 + (0.04 - 0.056) * (t - 0.5) / 0.5
            r += 0.032 + 0.11 * ss(0.78, 1.0, t)
            e = abs(t - 0.5)
            w = {'Arm' + tag: 1.0} if t < 0.4 else ({'Fore' + tag: 1.0} if t > 0.6 else
                                                     {'Arm' + tag: 0.5 - (t - 0.5) * 5, 'Fore' + tag: 0.5 + (t - 0.5) * 5})
            if t > 0.97:
                w = {'Fore' + tag: 0.6, 'Hand' + tag: 0.4}
            del e
            u1 = d.orthogonal().normalized()
            u2 = d.cross(u1).normalized()
            pts = []
            for k in range(n):
                ang = math.tau * k / n
                p = c + (u1 * math.cos(ang) + u2 * math.sin(ang)) * r
                pts.append(Vector((p.x * m.x, p.y, p.z)))
            al = 0.4 + 0.42 * ss(0.9, 1.0, t) + 0.35 * (1 - ss(0.0, 0.08, t))
            col = lerp(SATIN, LACE, ss(0.9, 1.0, t) + (1 - ss(0.0, 0.08, t)))
            rings.append((pts, w, col, min(0.95, al)))
        if s < 0:
            rings = [(list(reversed(p)), w, c, a) for p, w, c, a in rings]
        sl.rings(rings)
        cloths.append(sl)
        tl = Cloth('SleeveTail' + tag, SATIN, seed=37 + s)
        out = _n(A_L + V(0.35, 0, 0))
        e1 = EL.lerp(WR, 0.2) + out * 0.07
        e2 = EL.lerp(WR, 0.95) + out * 0.09
        mm = lambda p: Vector((p.x * s, p.y, p.z))  # noqa: E731
        spar1 = [(tuple(mm(e1)), 'Fore' + tag), (tuple(mm(e1 + TRAIL_DOWN * 0.75)), 'Trail1' + tag),
                 (tuple(mm(e1 + TRAIL_DOWN * 1.5)), 'Trail2' + tag)]
        spar2 = [(tuple(mm(e2)), 'Fore' + tag), (tuple(mm(e2 + TRAIL_DOWN * 0.75)), 'Trail1' + tag),
                 (tuple(mm(e2 + TRAIL_DOWN * 1.6)), 'Trail2' + tag)]

        def tail_alpha(u, v, co):
            return max(0.04, 0.55 * (1.0 - 0.85 * ss(0.4, 1.0, u)))

        def tail_color(u, v, co, c):
            return lerp(SATIN, VEIL_TAIL, ss(0.2, 0.9, u))

        a_, b_ = (spar1, spar2) if s > 0 else (spar2, spar1)
        tl.ghost_panel(a_, b_, tail_alpha, tail_color, rows=14, cols=7, scallop=0.15, tear=1.1, shade=1.0)
        cloths.append(tl)
    return cloths


# ------------------------------------------------------------------ rigid dressing
def build_parts(surf_body, surf_head, waist):
    parts = []

    def part(name, bone, **kw):
        p = Part(name, bone, **kw)
        parts.append(p)
        return p

    # --- the crown of ice thorns over the brow
    cr = part('Crown', 'Head', smooth=False)
    band = []
    for i in range(33):
        a = math.tau * i / 32
        band.append(V(math.sin(a) * 0.205, -0.005 - math.cos(a) * 0.236, 6.79 + 0.04 * (1 + math.cos(a + math.pi)) * 0.5))
    cr.tube(band, [0.022] * 33, ICE_DEEP, sides=6, cap=False)
    spikes = 17
    for i in range(spikes):
        a = math.tau * i / spikes
        front = (0.5 + 0.5 * math.cos(a)) ** 2.2
        h = 0.13 + 0.44 * front + 0.05 * math.sin(i * 2.7)
        if i == 0:
            h = 0.68
        base = V(math.sin(a) * 0.205, -0.005 - math.cos(a) * 0.236, 6.79 + 0.02 * (1 - math.cos(a)))
        radial = V(math.sin(a), -math.cos(a), 0)
        d = _n(V(0, 0, 1) + radial * (0.22 + 0.15 * (1 - front)))
        r0 = 0.032 + 0.012 * front
        pts = [base - d * 0.02, base + d * h * 0.35, base + d * h * 0.75, base + d * h]
        cr.tube(pts, [r0, r0 * 0.75, r0 * 0.38, 0.0015], [ICE_DEEP, ICE, ICE, ICE_HI], sides=5, roll=0.3 * i)
        if front > 0.25:
            # a smaller thorn leaning out of each tall one's foot
            d2 = _n(d + radial * 0.5 + V(math.cos(a), math.sin(a), 0) * 0.3 * (1 if i % 2 else -1))
            b2 = base + d * h * 0.18
            cr.tube([b2, b2 + d2 * h * 0.3, b2 + d2 * h * 0.5], [r0 * 0.55, r0 * 0.3, 0.001], [ICE, ICE, ICE_HI],
                    sides=4)
    gem = part('CrownGem', 'Head')
    gem.blob((0, -0.252, 6.82), (0.05, 0.03, 0.075), GLOW_EYE, mat=GLOW, segments=10, rings=8)
    gem.blob((0, -0.262, 6.82), (0.022, 0.014, 0.04), GLOW_HOT, mat=GLOW, segments=8, rings=6)
    for i, a in enumerate((0.0, 0.33, -0.33)):
        front = (0.5 + 0.5 * math.cos(a)) ** 2.2
        h = 0.68 if i == 0 else 0.13 + 0.44 * front
        base = V(math.sin(a) * 0.205, -0.005 - math.cos(a) * 0.236, 6.79 + 0.02 * (1 - math.cos(a)))
        radial = V(math.sin(a), -math.cos(a), 0)
        d = _n(V(0, 0, 1) + radial * 0.22)
        pts = [base + d * 0.06 + radial * 0.02 + d * h * t for t in (0.0, 0.3, 0.6)]
        gem.tube([p + radial * 0.012 * (1 - k * 0.4) for k, p in enumerate(pts)], [0.007, 0.005, 0.001],
                 GLOW_EYE, mat=GLOW, sides=4)
    # --- the eyes: cold white-blue fire deep in the hollow sockets
    for s, tag in ((1, 'L'), (-1, 'R')):
        ey = part('Eye' + tag, 'Head')
        c = V(s * 0.074, -0.226, 6.5)
        ey.blob(c, (0.088, 0.024, 0.05), GLOW_DEEP, mat=GLOW, segments=12, rings=8, rot=(0, s * 0.12, 0))
        ey.blob(c + V(0, -0.006, 0.002), (0.06, 0.018, 0.032), GLOW_EYE, mat=GLOW, segments=10, rings=6,
                rot=(0, s * 0.12, 0))
        ey.blob(c + V(s * 0.004, -0.012, 0.003), (0.028, 0.012, 0.018), GLOW_HOT, mat=GLOW, segments=8, rings=6)
        # a frozen tear down each cheek
        pts = []
        for i, (dx, z) in enumerate(((0.0, 6.47), (0.006, 6.43), (0.01, 6.39), (0.012, 6.35), (0.016, 6.31))):
            hit = surf_head.front(s * (0.07 + dx), z, offset=0.003)
            if hit is not None:
                pts.append(hit[0])
        if len(pts) > 2:
            ey.tube(pts, [0.0045, 0.004, 0.0035, 0.003, 0.0015][:len(pts)], GLOW_EYE, mat=GLOW, sides=4)
            ey.blob(pts[-1], (0.012, 0.009, 0.016), GLOW_EYE, mat=GLOW, segments=6, rings=5)
    # --- the cracked heart: cold light breaking through the bodice over the heart
    hc = part('HeartCracks', 'Chest')
    centre = V(0.11, 0, 5.43)
    paths = [((0.0, 0.0), (0.03, 0.06), (0.02, 0.13), (0.05, 0.19)), ((0.0, 0.0), (-0.05, 0.04), (-0.09, 0.1)),
             ((0.0, 0.0), (0.06, -0.03), (0.1, -0.09), (0.15, -0.12)), ((0.0, 0.0), (-0.02, -0.07), (-0.06, -0.14)),
             ((0.03, 0.06), (0.08, 0.09)), ((0.06, -0.03), (0.05, -0.1))]
    core = surf_body.front(centre.x, centre.z, offset=0.004)
    if core is not None:
        hc.blob(core[0], (0.05, 0.02, 0.05), GLOW_EYE, mat=GLOW, segments=10, rings=6)
        hc.blob(core[0] - V(0, 0.004, 0), (0.024, 0.012, 0.024), GLOW_HOT, mat=GLOW, segments=8, rings=5)
    for path in paths:
        pts = []
        for dx, dz in path:
            hit = surf_body.front(centre.x + dx, centre.z + dz, offset=0.004)
            if hit is not None:
                pts.append(hit[0])
        if len(pts) >= 2:
            hc.tube(pts, [0.008] + [0.006] * (len(pts) - 2) + [0.0015], [GLOW_HOT] + [GLOW_EYE] * (len(pts) - 1),
                    mat=GLOW, sides=4)
    # --- the lace trim along the off-shoulder neckline: a rolled edge with scallops
    nl = part('Neckline', 'Chest')
    pts = []
    for i in range(41):
        th = math.tau * i / 40
        z = 5.6 + 0.03 * ss(0.2, 0.4, abs(math.sin(th)) * 0.4)
        for _ in range(2):
            hit = surf_body.around((0, 0.02, z), th, offset=0.006)
            if hit is None:
                break
            x, y = hit[0].x, hit[0].y
            z = 5.6 - 0.07 * math.exp(-(x / 0.07) ** 2) * (1.0 if y < 0 else 0.0) + 0.03 * ss(0.2, 0.4, abs(x))
        hit = surf_body.around((0, 0.02, z), th, offset=0.008)
        if hit is not None:
            pts.append(hit[0])
    if len(pts) > 8:
        pts.append(pts[0])
        nl.tube(pts, [0.017] * len(pts), LACE, sides=6, cap=False)
        for i, p in enumerate(pts[:-1]):
            q = pts[i + 1]
            mid = p.lerp(q, 0.5)
            out = Vector((mid.x, mid.y - 0.02, 0)).normalized()
            nl.blob(mid - Vector((0, 0, 0.022)) + out * 0.006, (0.05, 0.016, 0.03), LACE, segments=6, rings=4,
                    rot=(0, 0, math.atan2(out.x, -out.y)))
    # --- the frozen choker under the jaw (it hides where the head meets the body)
    ch = part('Choker', 'Neck')
    ring = []
    for i in range(29):
        a = math.tau * i / 28
        hit = surf_body.around((0, 0.013, NECK_CUT - 0.004), a, offset=0.0)
        ring.append(hit[0] + V(math.sin(a), -math.cos(a), 0) * 0.012 if hit else
                    V(math.sin(a) * 0.1, 0.013 - math.cos(a) * 0.1, NECK_CUT))
    ring[-1] = ring[0]
    ch.tube(ring, [0.024] * 29, LACE, sides=7, cap=False)
    ch.tube([p + V(0, 0, 0.026) for p in ring], [0.009] * 29, ICE, sides=5, cap=False)
    ch.tube([p - V(0, 0, 0.026) for p in ring], [0.009] * 29, ICE, sides=5, cap=False)
    front_pt = ring[0]
    ch.tube([front_pt, front_pt + V(0, -0.012, -0.05), front_pt + V(0, -0.02, -0.11)], [0.006, 0.005, 0.004],
            ICE, sides=4)
    ch.blob(front_pt + V(0, -0.022, -0.14), (0.04, 0.03, 0.06), GLOW_EYE, mat=GLOW, segments=8, rings=6)
    # --- the lace cuffs at the wrists (they hide where the hands meet the arms)
    for s, tag in ((1, '.L'), (-1, '.R')):
        cf = part('Cuff' + tag, 'Fore' + tag)
        u1 = H_L.orthogonal().normalized()
        u2 = H_L.cross(u1).normalized()
        pts = []
        for i in range(25):
            a = math.tau * i / 24
            p = WR + H_L * 0.0 + (u1 * math.cos(a) + u2 * math.sin(a)) * 0.052
            pts.append(V(p.x * s, p.y, p.z))
        cf.tube(pts, [0.016] * 25, LACE, sides=6, cap=False)
        for i in range(8):
            a = math.tau * (i + 0.5) / 8
            p = WR + H_L * 0.012 + (u1 * math.cos(a) + u2 * math.sin(a)) * 0.066
            cf.blob(V(p.x * s, p.y, p.z), (0.024, 0.024, 0.024), ICE, segments=6, rings=4)
    # --- the claws: long hooked nails of dark ice
    for s, tag in ((1, '.L'), (-1, '.R')):
        cl = part('Claws' + tag, 'FingT' + tag)
        for i in range(4):
            pts, d = finger_points(i)
            tip = pts[-1]
            axis = d.cross(N_L).normalized()
            d1 = (Matrix.Rotation(math.radians(18), 3, axis) @ d).normalized()
            d2 = (Matrix.Rotation(math.radians(40), 3, axis) @ d).normalized()
            c_pts = [tip - d * 0.03, tip + d1 * 0.05, tip + d1 * 0.05 + d2 * 0.075]
            c_pts = [V(p.x * s, p.y, p.z) for p in c_pts]
            cl.tube(c_pts, [0.0145, 0.01, 0.0012], [CLAW, CLAW, ICE_HI], sides=6, squash=0.8)
        tp, td = thumb_points()
        axis = td.cross(N_L).normalized()
        d1 = (Matrix.Rotation(math.radians(25), 3, axis) @ td).normalized()
        c_pts = [tp[-1] - td * 0.025, tp[-1] + td * 0.04, tp[-1] + td * 0.04 + d1 * 0.06]
        th = part('ThumbClaw' + tag, 'Thumb' + tag)
        th.tube([V(p.x * s, p.y, p.z) for p in c_pts], [0.014, 0.009, 0.0012], [CLAW, CLAW, ICE_HI], sides=6,
                squash=0.8)
    # --- rime on the shoulders: clusters of ice crystals grown out of the frost
    rm = part('Rime', 'Chest', smooth=False)
    import random
    rng = random.Random(71)
    for s in (1, -1):
        for (cx, cy, n_, big) in ((0.3, 0.05, 6, 1.0), (0.42, 0.03, 5, 0.8), (0.2, 0.1, 4, 0.6), (0.36, 0.16, 4, 0.7)):
            hit = surf_body.cast((s * cx, cy, 7.5), (0, 0, -1), offset=-0.01)
            if hit is None:
                continue
            base, nrm = hit
            for q in range(n_):
                lean = V(s * (0.25 + 0.5 * rng.random()), (rng.random() - 0.5) * 0.7, 0)
                d = _n(nrm * 1.0 + V(0, 0, 0.8) + lean)
                h = (0.1 + 0.2 * rng.random()) * big + (0.08 if q == 0 else 0)
                r0 = (0.022 + 0.018 * rng.random()) * (0.6 + 0.4 * big)
                b = base + V((rng.random() - 0.5) * 0.06, (rng.random() - 0.5) * 0.06, 0)
                rm.tube([b - d * 0.02, b + d * h * 0.55, b + d * h], [r0, r0 * 0.6, 0.0015], [ICE_DEEP, ICE, ICE_HI],
                        sides=4 + (q % 2), roll=rng.random())
    # --- the sash at the waist and the frozen roses pinned to it
    sh_ = part('Sash', 'Hips')
    ring = [waist[k % SKIRT] for k in range(SKIRT + 1)]
    pts = []
    for i in range(SKIRT * 2 + 1):
        a = math.tau * i / (SKIRT * 2)
        hit = surf_body.around((0, 0.03, WAIST_Z), a, offset=0.012)
        pts.append(hit[0] if hit else V(math.sin(a) * 0.26, 0.03 - math.cos(a) * 0.2, WAIST_Z))
    pts[-1] = pts[0]
    del ring
    sh_.tube(pts, [0.034] * len(pts), SATIN, sides=8, cap=False)
    sh_.tube([p + V(0, 0, 0.036) for p in pts], [0.008] * len(pts), LACE, sides=4, cap=False)
    sh_.tube([p - V(0, 0, 0.036) for p in pts], [0.008] * len(pts), LACE, sides=4, cap=False)
    corsage = surf_body.around((0, 0.03, WAIST_Z), 0.55, offset=0.04)
    if corsage is not None:
        c0 = corsage[0]
        for j, (dx, dz, sc) in enumerate(((0.0, 0.03, 1.0), (0.07, -0.03, 0.8), (-0.05, -0.05, 0.65))):
            rc = c0 + V(dx, -0.02, dz)
            for ring_i, (rad, cnt, h) in enumerate(((0.012, 3, 0.04), (0.03, 5, 0.035), (0.05, 6, 0.03))):
                for q in range(cnt):
                    a = math.tau * q / cnt + ring_i * 0.6 + j
                    p = rc + V(math.cos(a) * rad * sc, -h * 0.4 * sc, math.sin(a) * rad * sc)
                    sh_.blob(p, (0.05 * sc * (0.7 + 0.15 * ring_i), 0.02 * sc, 0.045 * sc * (0.7 + 0.15 * ring_i)),
                             lerp(ICE_HI, ICE, 0.3 * ring_i), segments=6, rings=4,
                             rot=(0.3, 0.0, a))
        for q in range(5):
            a = -0.9 + q * 0.45
            d = _n(V(math.cos(a), -0.4, math.sin(a) - 0.4))
            sh_.tube([c0, c0 + d * 0.09, c0 + d * 0.16], [0.015, 0.01, 0.001], [ICE_DEEP, ICE, ICE_HI], sides=4,
                     squash=0.35)
    # --- icicles and rime crust along the gown's hem (rigid on the last skirt bones)
    for k in range(SKIRT):
        st = skirt_stations(k, waist[k])
        hem, above = st[4], st[3]
        d_hem = _n(hem - above)
        ic = part(f'Icicles{k}', f'Skirt{k}d', smooth=False)
        a = skirt_angle(k)
        tang = V(math.cos(a), math.sin(a), 0)
        for q, (off, ln) in enumerate(((0.0, 0.42), (0.11, 0.24), (-0.1, 0.3))):
            ln *= 0.8 + 0.4 * ((k * 7 + q * 3) % 5) / 5
            b = hem - d_hem * 0.04 + tang * off
            tipd = _n(V(0, 0, -1) + d_hem * 0.25)
            ic.tube([b + tipd * -0.02, b + tipd * ln * 0.4, b + tipd * ln], [0.03 - 0.005 * q, 0.017, 0.001],
                    [ICE_HI, ICE, ICE_HI], sides=5, roll=0.5 * k)
        for q in range(3):
            b = hem - d_hem * (0.08 + 0.06 * q) + tang * (0.06 * (q - 1))
            out_ = _n(V(math.sin(a), -math.cos(a), 0.3) + tang * (0.4 * (q - 1)))
            ic.tube([b, b + out_ * (0.06 + 0.03 * q)], [0.018, 0.001], [ICE, ICE_HI], sides=4)
    return parts


# ------------------------------------------------------------------ materials
def make_materials():
    body = bpy.data.materials.new('CreatureBody')
    glow = bpy.data.materials.new('CreatureGlow')
    veil = bpy.data.materials.new('CreatureGhostVeil')
    for m in (body, glow, veil):
        m.use_nodes = True
    body.use_backface_culling = True
    veil.use_backface_culling = False
    try:
        veil.surface_render_method = 'BLENDED'
    except (AttributeError, TypeError):
        pass
    nt = glow.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 3.0
    _bake_shader(body, 'flesh')
    _bake_shader(veil, 'cloth')
    return [body, glow, veil]


def _mul(nt, a, b, loc, fac=1.0):
    m = _node(nt, 'ShaderNodeMix', loc)
    m.data_type = 'RGBA'
    m.blend_type = 'MULTIPLY'
    m.inputs['Factor'].default_value = fac
    nt.links.new(a, _sock(m.inputs, 'A'))
    nt.links.new(b, _sock(m.inputs, 'B'))
    return _sock(m.outputs, 'Result')


def _ramp(nt, src, loc, p0, c0, p1, c1):
    r = nt.nodes.new('ShaderNodeValToRGB')
    r.location = loc
    r.color_ramp.elements[0].position = p0
    r.color_ramp.elements[0].color = c0
    r.color_ramp.elements[1].position = p1
    r.color_ramp.elements[1].color = c1
    nt.links.new(src, r.inputs['Fac'])
    return r.outputs['Color']


def _bake_shader(mat, kind):
    """The bake-time surface: the vertex paint times a soft mottle, plus (flesh)
    a lace pattern where the LaceMask says bodice, faint veins and pores, or
    (cloth) a fine weave and frost sparkle toward the hem; a bump for the normal map."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = nt.nodes.get('Material Output')
    bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (800, 0))
    bsdf.inputs['Roughness'].default_value = 0.7
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    vc.location = (-900, 300)
    tex = _node(nt, 'ShaderNodeTexCoord', (-1400, 0))
    obj_co = tex.outputs['Object']
    sep = _node(nt, 'ShaderNodeSeparateXYZ', (-1200, -500))
    nt.links.new(obj_co, sep.inputs['Vector'])
    mott = _node(nt, 'ShaderNodeTexNoise', (-900, 0), Scale=4.0 if kind == 'flesh' else 1.5, Detail=4.0,
                 Roughness=0.55)
    nt.links.new(obj_co, mott.inputs['Vector'])
    mr = _node(nt, 'ShaderNodeMapRange', (-700, 0))
    mr.inputs['To Min'].default_value = 0.95 if kind == 'flesh' else 0.88
    mr.inputs['To Max'].default_value = 1.06
    nt.links.new(mott.outputs['Fac'], mr.inputs['Value'])
    col = _mul(nt, vc.outputs['Color'], mr.outputs['Result'], (-450, 200))
    bump_h = None
    if kind == 'flesh':
        # lace: a cell network (the threads) and rosettes, only on the bodice
        lace_m = _node(nt, 'ShaderNodeAttribute', (-900, -250))
        lace_m.attribute_name = 'LaceMask'
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.location = (-900, -450)
        vor.feature = 'DISTANCE_TO_EDGE'
        vor.inputs['Scale'].default_value = 42.0
        nt.links.new(obj_co, vor.inputs['Vector'])
        threads = _ramp(nt, vor.outputs['Distance'], (-650, -450), 0.0, (1, 1, 1, 1), 0.045, (0, 0, 0, 1))
        wave = _node(nt, 'ShaderNodeTexWave', (-900, -700), Scale=9.0, Distortion=2.0, Detail=1.0)
        wave.wave_type = 'RINGS'
        nt.links.new(obj_co, wave.inputs['Vector'])
        rose = _ramp(nt, wave.outputs['Fac'], (-650, -700), 0.82, (0, 0, 0, 1), 0.95, (1, 1, 1, 1))
        add = _node(nt, 'ShaderNodeMath', (-400, -550))
        add.operation = 'MAXIMUM'
        nt.links.new(threads, add.inputs[0])
        nt.links.new(rose, add.inputs[1])
        lace_amt = _node(nt, 'ShaderNodeMath', (-250, -450))
        lace_amt.operation = 'MULTIPLY'
        nt.links.new(add.outputs['Value'], lace_amt.inputs[0])
        nt.links.new(lace_m.outputs['Fac'], lace_amt.inputs[1])
        mix = _node(nt, 'ShaderNodeMix', (-150, 150))
        mix.data_type = 'RGBA'
        nt.links.new(lace_amt.outputs['Value'], mix.inputs['Factor'])
        nt.links.new(col, _sock(mix.inputs, 'A'))
        _sock(mix.inputs, 'B').default_value = (*srgb_to_linear(LACE), 1)
        col = _sock(mix.outputs, 'Result')
        # the gaps between the threads a little deeper (satin under the lace)
        gaps = _node(nt, 'ShaderNodeMapRange', (-250, -250))
        gaps.inputs['To Min'].default_value = 1.0
        gaps.inputs['To Max'].default_value = 0.86
        nt.links.new(lace_m.outputs['Fac'], gaps.inputs['Value'])
        col = _mul(nt, col, gaps.outputs['Result'], (0, 150))
        # faint veins under the dead skin (never on the lace)
        vein = nt.nodes.new('ShaderNodeTexVoronoi')
        vein.location = (-900, -950)
        vein.feature = 'DISTANCE_TO_EDGE'
        vein.inputs['Scale'].default_value = 6.0
        nt.links.new(obj_co, vein.inputs['Vector'])
        vline = _ramp(nt, vein.outputs['Distance'], (-650, -950), 0.0, (0.9, 0.88, 0.97, 1), 0.015, (1, 1, 1, 1))
        col = _mul(nt, col, vline, (150, 150), fac=0.7)
        bump_h = lace_amt.outputs['Value']
    else:
        weave = _node(nt, 'ShaderNodeTexNoise', (-900, -300), Scale=70.0, Detail=1.0, Roughness=0.4)
        nt.links.new(obj_co, weave.inputs['Vector'])
        wr = _node(nt, 'ShaderNodeMapRange', (-700, -300))
        wr.inputs['To Min'].default_value = 0.93
        wr.inputs['To Max'].default_value = 1.03
        nt.links.new(weave.outputs['Fac'], wr.inputs['Value'])
        col = _mul(nt, col, wr.outputs['Result'], (-250, 150))
        # frost sparkle: specks of white rime, thick at the hem, gone by the knee
        spk = _node(nt, 'ShaderNodeTexNoise', (-900, -600), Scale=95.0, Detail=0.0)
        nt.links.new(obj_co, spk.inputs['Vector'])
        specks = _ramp(nt, spk.outputs['Fac'], (-650, -600), 0.6, (0, 0, 0, 1), 0.72, (1, 1, 1, 1))
        low = _node(nt, 'ShaderNodeMapRange', (-650, -850))
        low.inputs['From Min'].default_value = 2.2
        low.inputs['From Max'].default_value = 0.6
        nt.links.new(sep.outputs['Z'], low.inputs['Value'])
        fm = _node(nt, 'ShaderNodeMath', (-400, -700))
        fm.operation = 'MULTIPLY'
        nt.links.new(specks, fm.inputs[0])
        nt.links.new(low.outputs['Result'], fm.inputs[1])
        mix = _node(nt, 'ShaderNodeMix', (-50, 150))
        mix.data_type = 'RGBA'
        nt.links.new(fm.outputs['Value'], mix.inputs['Factor'])
        nt.links.new(col, _sock(mix.inputs, 'A'))
        _sock(mix.inputs, 'B').default_value = (*srgb_to_linear(FROST), 1)
        col = _sock(mix.outputs, 'Result')
        bump_h = weave.outputs['Fac']
    nt.links.new(col, bsdf.inputs['Base Color'])
    bump = _node(nt, 'ShaderNodeBump', (500, -300), Strength=0.25, Distance=0.02)
    nt.links.new(bump_h, bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])


def _cycles(scene, samples):
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == backend
                    scene.cycles.device = 'GPU'
                    break
            except TypeError:
                continue
    except Exception:  # noqa: BLE001
        pass


def bake_ghost(obj, size=2048, samples=40, nrm_size=1024):
    """organic_kit.bake_surface's recipe for a ghost: unwrap (the face and hands
    first scaled up so they take a larger share of the atlas), bake the albedo, the
    AO (folded in with its shadows pushed toward violet), the bump as a normal map,
    and the vertex ALPHA into the albedo's alpha channel; then swap the bake shaders
    for the shipping image materials (the veil alpha-blended, double sided)."""
    scene = bpy.context.scene
    _cycles(scene, samples)
    me = obj.data
    boost = me.attributes.get('UvBoost')
    keep = [v.co.copy() for v in me.vertices]
    if boost is not None:
        vals = np.empty(len(me.vertices))
        boost.data.foreach_get('value', vals)
        # grow each boosted island about its own centre before the unwrap
        for centre, pick in ((V(0, -0.05, 6.5), lambda co: co.z > 5.9),
                             (WR + H_L * 0.25, lambda co: co.x > 0.5),
                             (Vector((-WR.x, WR.y, WR.z)) + Vector((-H_L.x, H_L.y, H_L.z)) * 0.25,
                              lambda co: co.x < -0.5)):
            for i, v in enumerate(me.vertices):
                if vals[i] > 0.5 and pick(v.co):
                    v.co = centre + (v.co - centre) * 2.4
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.003, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for v, co in zip(me.vertices, keep):
        v.co = co
    albedo = bpy.data.images.new(obj.name + '_albedo', size, size, alpha=True)
    ao = bpy.data.images.new(obj.name + '_ao', size, size, alpha=False)
    alpha = bpy.data.images.new(obj.name + '_alpha', size, size, alpha=False)
    nrm = bpy.data.images.new(obj.name + '_normal', nrm_size, nrm_size, alpha=False)
    nrm.colorspace_settings.name = 'Non-Color'
    alpha.colorspace_settings.name = 'Non-Color'
    baked = [m for m in me.materials if m and m.name != 'CreatureGlow']

    def target(img):
        for m in me.materials:
            nt = m.node_tree
            node = nt.nodes.get('BakeTarget') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'BakeTarget'
            node.image = img
            node.location = (1100, 400)
            nt.nodes.active = node

    scene.render.bake.margin = 6
    scene.render.bake.use_selected_to_active = False
    target(albedo)
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6)
    target(ao)
    scene.world = scene.world or bpy.data.worlds.new('bakeworld')
    bpy.ops.object.bake(type='AO', margin=6)
    target(nrm)
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=6)
    # the alpha: each baked material emits its vertex alpha
    for m in baked:
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type not in ('OUTPUT_MATERIAL',) and n.name != 'BakeTarget':
                nt.nodes.remove(n)
        out = nt.nodes.get('Material Output')
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'Col'
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(vc.outputs['Alpha'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    target(alpha)
    bpy.ops.object.bake(type='EMIT', margin=6)
    def px(img):
        buf = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        return buf.reshape(-1, 4)

    a = px(albedo)
    o = px(ao)[:, 0:1]
    al = px(alpha)[:, 0]
    print('BAKE_MEANS albedo', a[:, :3].mean(0), 'ao', o.mean(), 'alpha', al.mean())
    cloth = (al < 0.985)[:, None]
    shade = np.where(cloth, 0.42, 0.8) * (1.0 - o)
    violet = np.where(cloth, np.array(srgb_to_linear((0.78, 0.72, 0.98)), dtype=np.float32),
                      np.array(srgb_to_linear((0.6, 0.52, 0.95)), dtype=np.float32))
    a[:, 0:3] *= 1.0 - shade * (1.0 - violet)
    a[:, 0:3] *= 1.0 - 0.25 * shade
    a[:, 3] = np.clip(al, 0.0, 1.0)
    albedo.pixels.foreach_set(a.ravel())
    albedo.update()
    for m in baked:
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != 'OUTPUT_MATERIAL':
                nt.nodes.remove(n)
        out = nt.nodes.get('Material Output')
        bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (300, 0))
        bsdf.inputs['Roughness'].default_value = 0.75
        img = nt.nodes.new('ShaderNodeTexImage')
        img.name = 'Albedo'
        img.image = albedo
        img.location = (-200, 200)
        nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
        if m.name == 'CreatureGhostVeil':
            nt.links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
        nimg = nt.nodes.new('ShaderNodeTexImage')
        nimg.image = nrm
        nimg.location = (-200, -200)
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.location = (50, -200)
        nt.links.new(nimg.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    glow = me.materials['CreatureGlow']
    node = glow.node_tree.nodes.get('BakeTarget')
    if node:
        glow.node_tree.nodes.remove(node)
    bpy.data.images.remove(ao)
    bpy.data.images.remove(alpha)
    # the texture carries the colour and the alpha now: whiten the baked faces'
    # vertex colours (a glTF loader multiplies COLOR_0 in), keep the glow's
    col = me.color_attributes.get('Col')
    gi = [i for i, m in enumerate(me.materials) if m and m.name == 'CreatureGlow']
    for poly in me.polygons:
        if poly.material_index in gi:
            continue
        for li in poly.loop_indices:
            col.data[li].color = (1.0, 1.0, 1.0, 1.0)
    albedo.file_format = 'PNG'
    albedo.pack()
    nrm.pack()
    return albedo, nrm


# ------------------------------------------------------------------ posing
class LadyRig(Rig):
    """The organic kit's Rig with a roll about each aimed bone's own axis (the
    palms) and keyed scales (the death)."""

    def pose(self, aims=None, ik=None, turns=None, root=(0, 0, 0), rolls=None, scales=None):
        aims = self._mirror({k: Vector(v) for k, v in (aims or {}).items()}, 'aim')
        turns = self._mirror(turns or {}, 'turns')
        rolls = dict(rolls or {})
        for k in list(rolls):
            if k.endswith('.L') and k[:-2] + '.R' not in rolls:
                rolls[k[:-2] + '.R'] = -rolls[k]
        ik = dict(ik or {})
        ik_upper = {u: (lo, Vector(tgt), Vector(pole)) for u, lo, tgt, pole in ik.values()}
        delta, head, out = {}, {}, {}
        reach = {}
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                ph = self.rest[parent][0]
                head[name] = head[parent] + delta[parent] @ (rh - ph)
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if name in ik_upper:
                lo, tgt, pole = ik_upper[name]
                l1 = (rt - rh).length
                l2 = (self.rest[lo][1] - self.rest[lo][0]).length
                d1, d2 = two_bone(head[name], l1, l2, tgt, pole)
                aims[name] = d1
                aims[lo] = d2
                reach[name] = (tgt - head[name]).length - (l1 + l2)
            q = Quaternion()
            if name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                q = r0.rotation_difference(want)
                if name in rolls:
                    q = Quaternion(want, math.radians(rolls[name])) @ q
            for a, deg in turns.get(name, []):
                ax = Vector(a) if not isinstance(a, str) else {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)),
                                                              'z': Vector((0, 0, 1))}[a]
                q = Quaternion(ax.normalized(), math.radians(deg)) @ q
            delta[name] = dp @ q
            rest_m = self.rest_matrix(name)
            out[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        out['__root'] = Vector(root)
        out['__scale'] = dict(scales or {})
        out['__head'] = head
        out['__delta'] = delta
        out['__reach'] = reach
        return out


def key_pose(arm, pose, frame):
    scales = pose.get('__scale', {})
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        q = pose.get(pb.name)
        pb.rotation_quaternion = q if q is not None else (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        s = scales.get(pb.name, 1.0)
        pb.scale = (s, s, s)
    rb = arm.pose.bones.get('Root')
    root = pose.get('__root')
    if rb is not None and root is not None:
        rb.location = rb.bone.matrix_local.to_3x3().inverted() @ root
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)
        pb.keyframe_insert('scale', frame=frame)


def clip(arm, name, keys):
    """keys: [(frame, pose)]. Every bone's quaternion keys are kept on one
    hemisphere (the Morthen v2 fix: q and -q are one turn, but the curves
    interpolate the components, so a key on the far side spins the long way)."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    # keys are authored from frame 1; the clip starts at time 0 (no frozen first frame)
    for frame, pose in keys:
        key_pose(arm, pose, frame - 1)
    quat = {}
    for fc in _fcurves(act):
        if fc.data_path.endswith('rotation_quaternion'):
            quat.setdefault(fc.data_path, {})[fc.array_index] = fc
    for chans in quat.values():
        if len(chans) != 4:
            continue
        fcs = [chans[i] for i in range(4)]
        prev = None
        for k in range(len(fcs[0].keyframe_points)):
            q = [fc.keyframe_points[k].co[1] for fc in fcs]
            if prev is not None and sum(x * y for x, y in zip(prev, q)) < 0:
                q = [-c for c in q]
                for fc, c in zip(fcs, q):
                    fc.keyframe_points[k].co[1] = c
            prev = q
        for fc in fcs:
            fc.update()
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
    return act


REACH_LOG = []


def make_clips(arm, bones, waist):
    rig = LadyRig(bones).attach(arm)
    rest = rig.rest
    clips = []
    fing_axis = H_L.cross(N_L).normalized()
    thumb_dir = _n(THUMB[2] - THUMB[0])
    thumb_axis = thumb_dir.cross(N_L).normalized()
    skirt_rest = {}
    for k in range(SKIRT):
        for t in 'abcd':
            h_, t_ = rest[f'Skirt{k}{t}']
            skirt_rest[(k, t)] = (t_ - h_).normalized()
    veil_rest = {}
    for k in range(VEIL):
        for t in 'bcde':
            h_, t_ = rest[f'Veil{k}{t}']
            veil_rest[(k, t)] = (t_ - h_).normalized()

    def add(name, keys):
        for f, pose in keys:
            for b, over in pose['__reach'].items():
                if over > 0.02:
                    REACH_LOG.append((name, f, b, round(over, 3)))
        clip(arm, name, keys)
        clips.append(name)

    def stance(root=(0, 0, 0), yaw=0.0, tilt=0.0, lean=0.0, side=0.0, twist=0.0, nod=0.0, turn=0.0, roll=0.0,
               jaw=3.0, wl=(1.0, -0.3, 3.85), wr=None, pivot=False, pole_l=(1.0, 0.7, -0.2), pole_r=None,
               hl=(0.12, -0.25, -1.0), hr=None, hroll_l=0.0, hroll_r=None, curl_l=0.35, curl_r=None,
               thumb_l=0.3, thumb_r=None, ph=0.0, wave=1.0, stream=0.0, lift=0.0, flare=0.0, swirl=0.0,
               veil_stream=None, veil_lift=None, veil_wave=None, blush=0.0, tails=None, scale=1.0, hips_sway=0.0):
        """One pose, body first. Wrist targets `wl`/`wr` are in the body's frame
        (moved with the root and its yaw and tilt) unless `pivot`, then in the
        floor frame (the Embrace's fixed spot). Every cloth bone gets a world
        direction: its rest hang, pushed back by `stream`, floated up by `lift`,
        flared out by `flare`, swirled `swirl` degrees round her and rippled by a
        wave travelling down it at phase `ph`."""
        wr = (-wl[0], wl[1], wl[2]) if wr is None else wr
        pole_r = (-pole_l[0], pole_l[1], pole_l[2]) if pole_r is None else pole_r
        hr = (-hl[0], hl[1], hl[2]) if hr is None else hr
        hroll_r = -hroll_l if hroll_r is None else hroll_r
        curl_r = curl_l if curl_r is None else curl_r
        thumb_r = thumb_l if thumb_r is None else thumb_r
        veil_stream = stream if veil_stream is None else veil_stream
        veil_lift = lift if veil_lift is None else veil_lift
        veil_wave = wave if veil_wave is None else veil_wave
        tails = stream if tails is None else tails
        rr = Quaternion(Vector((0, 0, 1)), math.radians(yaw)) @ Quaternion(Vector((1, 0, 0)), math.radians(tilt))
        ry = Quaternion(Vector((0, 0, 1)), math.radians(yaw))
        at = Vector(root)
        back = ry @ Vector((0, 1, 0))
        up = Vector((0, 0, 1))
        turns = {
            'Root': [('x', tilt), ('z', yaw)],
            'Hips': [('z', hips_sway)],
            'Spine': [('x', lean * 0.45), ('y', side * 0.4), ('z', twist * 0.4)],
            'Chest': [('x', lean * 0.55), ('y', side * 0.6), ('z', twist * 0.6)],
            'Neck': [('x', nod * 0.4), ('z', turn * 0.4), ('y', roll * 0.4)],
            'Head': [('x', nod * 0.6), ('z', turn * 0.6), ('y', roll * 0.6)],
            'Jaw': [('x', jaw)],
            'Fing.L': [(tuple(fing_axis), curl_l * 50.0)],
            'FingT.L': [(tuple(fing_axis), curl_l * 62.0)],
            'Thumb.L': [(tuple(thumb_axis), thumb_l * 35.0)],
            'Fing.R': [(tuple(_mirror_axis(fing_axis)), curl_r * 50.0)],
            'FingT.R': [(tuple(_mirror_axis(fing_axis)), curl_r * 62.0)],
            'Thumb.R': [(tuple(_mirror_axis(thumb_axis)), thumb_r * 35.0)],
            # the blusher: a flutter at rest; blown up and back over the crown by `blush`
            'Blush1': [('x', -blush * 165.0 + 3.0 * math.sin(ph * 1.3) * wave)],
            'Blush2': [('x', -blush * 95.0 + 5.0 * math.sin(ph * 1.3 - 0.8) * wave * (1 + blush))],
        }
        aims = {}
        # the gown: each spar bone a world direction
        for k in range(SKIRT):
            a = skirt_angle(k)
            radial = Vector((math.sin(a), -math.cos(a), 0))
            tang = Vector((math.cos(a), math.sin(a), 0))
            fr = math.cos(a)
            for j, t in enumerate('abcd'):
                d = rr @ skirt_rest[(k, t)]
                v = d.copy()
                v += (rr @ radial) * flare * (0.3 + 0.28 * j)
                v += back * stream * (0.12 + 0.3 * j) * (0.6 + 0.4 * fr)
                v += up * lift * (0.05 + 0.2 * j)
                w1 = math.sin(ph - j * 0.85 + k * 0.75)
                w2 = math.sin(ph * 0.8 - j * 0.7 + k * 1.3 + 1.1)
                v += (rr @ radial) * wave * (0.04 + 0.07 * j) * w1
                v += (rr @ tang) * wave * (0.03 + 0.06 * j) * w2
                if swirl:
                    v = Matrix.Rotation(math.radians(swirl * (0.15 + 0.22 * j)), 3, 'Z') @ v
                aims[f'Skirt{k}{t}'] = tuple(v.normalized())
        # the veil: streaming back from the crown, rippling down its length
        for k in range(VEIL):
            s = -1.0 + 2.0 * k / (VEIL - 1)
            for j, t in enumerate('bcde', 1):
                d = ry @ veil_rest[(k, t)]
                v = d.copy()
                v += back * veil_stream * (0.15 + 0.22 * j)
                v += up * veil_lift * (0.08 + 0.12 * j)
                v += (ry @ Vector((1, 0, 0))) * veil_wave * (0.05 + 0.06 * j) * math.sin(ph * 1.1 - j * 0.9 + k * 0.6)
                v += up * veil_wave * (0.06 + 0.07 * j) * math.sin(ph - j * 1.05 + k * 0.45 + 0.7)
                v += (ry @ Vector((1, 0, 0))) * s * flare * 0.25 * j
                if swirl:
                    v = Matrix.Rotation(math.radians(-swirl * 0.1 * j), 3, 'Z') @ v
                aims[f'Veil{k}{t}'] = tuple(v.normalized())
        # the sleeve tails: hanging, streaming, rippling
        for side, tag in ((1, '.L'), (-1, '.R')):
            for j, t in enumerate(('Trail1', 'Trail2')):
                v = Vector((0.05 * side, 0.12, -1.0))
                v += back * tails * (0.3 + 0.35 * j)
                v += up * lift * 0.2 * (j + 1)
                v += Vector((side, 0, 0)) * wave * 0.12 * math.sin(ph * 1.2 - j * 1.1 + side)
                v += back * wave * 0.1 * math.sin(ph - j * 0.9)
                aims[t + tag] = tuple(v.normalized())
        # the arms: IK to the wrist targets, the hands aimed and rolled
        if pivot:
            wlw, wrw = Vector(wl), Vector(wr)
        else:
            wlw, wrw = at + rr @ Vector(wl), at + rr @ Vector(wr)
        ik = {'arm.L': ('Arm.L', 'Fore.L', tuple(wlw), tuple(rr @ Vector(pole_l))),
              'arm.R': ('Arm.R', 'Fore.R', tuple(wrw), tuple(rr @ Vector(pole_r)))}
        aims['Hand.L'] = tuple(rr @ _n(hl))
        aims['Hand.R'] = tuple(rr @ _n(hr))
        rolls = {'Hand.L': hroll_l, 'Hand.R': hroll_r}
        scales = {'Root': scale} if scale != 1.0 else {}
        return rig.pose(aims=aims, ik=ik, turns=turns, root=root, rolls=rolls, scales=scales)

    # ------------------------------------------------------------------ rest loops
    def idle(ph, **kw):
        base = dict(root=(0.02 * math.sin(ph), 0.0, 0.12 * math.sin(ph)), nod=14 + 3 * math.sin(ph),
                    roll=4 * math.sin(ph + 1.2), turn=3 * math.sin(ph + 2.0), lean=4 + 2 * math.sin(ph + 0.7),
                    side=2 * math.sin(ph + 1.6), jaw=3, wl=(1.1 + 0.03 * math.sin(ph + 1), -0.3, 3.8 + 0.06 * math.sin(ph - 0.6)),
                    hl=(0.16, -0.32, -1.0), hroll_l=10.0, curl_l=0.38 + 0.06 * math.sin(ph), ph=ph, wave=1.0, stream=0.15,
                    lift=0.15, flare=0.05, veil_stream=0.1, veil_lift=0.2)
        base.update(kw)
        return stance(**base)

    def combat(ph, **kw):
        base = dict(root=(0.0, -0.04, 0.1 * math.sin(ph)), lean=9 + 2 * math.sin(ph), nod=-3 + 3 * math.sin(ph + 1.0),
                    turn=2 * math.sin(ph + 2.0), jaw=6 + 3 * math.sin(ph * 2), side=2 * math.sin(ph + 1.5),
                    wl=(1.15 + 0.04 * math.sin(ph + 0.5), -0.95, 4.85 + 0.06 * math.sin(ph - 0.4)),
                    pole_l=(1.0, 0.7, -0.2), hl=(0.2, -1.0, 0.5), hroll_l=-30.0, curl_l=0.62 + 0.08 * math.sin(ph * 2),
                    thumb_l=0.5, ph=ph * 2, wave=1.25, stream=0.2, lift=0.25, flare=0.18, veil_stream=0.2,
                    veil_lift=0.35)
        base.update(kw)
        return stance(**base)

    keys = [(1 + i * 10, idle(math.tau * i / 8)) for i in range(8)]
    keys.append((81, idle(0.0)))
    add('Idle', keys)
    keys = [(1 + i * 8, combat(math.tau * i / 6)) for i in range(6)]
    keys.append((49, combat(0.0)))
    add('CombatIdle', keys)
    ready = combat(0.0)

    # The glide: no steps, she drifts, leaning in, arms trailing, cloth streaming.
    def glide(ph, run=False, **kw):
        base = dict(root=(0, 0, 0.06 * math.sin(ph)), lean=14 + 2 * math.sin(ph), nod=2, jaw=4,
                    wl=(0.92, 0.32, 4.05 + 0.05 * math.sin(ph)), pole_l=(1.0, 0.2, -0.6), hl=(0.1, 0.55, -1.0),
                    curl_l=0.35, ph=ph, wave=1.1, stream=0.75, lift=0.22, flare=0.0, veil_stream=0.85,
                    veil_lift=0.25, tails=0.9)
        if run:
            base.update(lean=27 + 2 * math.sin(ph), tilt=5, nod=-10, wl=(0.85, 0.95, 4.5 + 0.05 * math.sin(ph)),
                        hl=(0.15, 1.0, -0.45), pole_l=(1.0, -0.2, -0.6), curl_l=0.22, wave=1.4, stream=1.35,
                        lift=0.3, veil_stream=1.6, veil_lift=0.35, tails=1.6, root=(0, 0, 0.08 * math.sin(ph)))
        base.update(kw)
        return stance(**base)

    add('Walk', [(1 + i * 10, glide(math.tau * i / 4)) for i in range(4)] + [(41, glide(0.0))])
    add('Run', [(1 + i * 6, glide(math.tau * i / 4, run=True)) for i in range(4)] + [(25, glide(0.0, run=True))])

    # ---------------------------------------------------------------- the claw strikes
    # Attack: the right claw drawn high and back, then raked across her front.
    a_wind = stance(root=(0, 0.2, 0.22), yaw=-14, lean=-8, twist=-36, side=-4, nod=-6, turn=-14, jaw=14,
                    wr=(-1.55, 0.35, 6.05), pole_r=(-1.0, 0.3, -0.6), hr=(-0.3, 0.25, 1.0), hroll_r=0.0, curl_r=-0.2,
                    thumb_r=-0.2, wl=(0.95, -0.8, 4.65), hl=(0.25, -1.0, 0.2), hroll_l=-30, curl_l=0.6,
                    ph=0.6, wave=1.2, stream=0.25, lift=0.3, flare=0.2, swirl=-18)
    a_hold = stance(root=(0, 0.22, 0.24), yaw=-15, lean=-9, twist=-39, side=-5, nod=-7, turn=-15, jaw=16,
                    wr=(-1.6, 0.4, 6.15), pole_r=(-1.0, 0.3, -0.6), hr=(-0.3, 0.3, 1.0), curl_r=-0.25, thumb_r=-0.2,
                    wl=(0.95, -0.82, 4.62), hl=(0.25, -1.0, 0.2), hroll_l=-30, curl_l=0.6,
                    ph=0.9, wave=1.2, stream=0.25, lift=0.32, flare=0.22, swirl=-22)
    a_mid = stance(root=(0, -0.25, 0.06), yaw=-2, lean=8, twist=-6, nod=0, turn=-4, jaw=24,
                   wr=(-1.05, -1.35, 5.3), pole_r=(-1.0, 0.4, -0.3), hr=(0.5, -0.8, -0.2), curl_r=0.1,
                   wl=(1.0, -0.6, 4.5), hl=(0.3, -1.0, 0.0), curl_l=0.55, ph=1.4, wave=1.3, stream=0.3,
                   lift=0.3, flare=0.25, swirl=-8)
    a_hit = stance(root=(0, -0.6, -0.1), yaw=10, lean=24, twist=26, side=4, nod=6, turn=8, jaw=34,
                   wr=(0.15, -2.1, 4.55), pole_r=(-0.8, 0.6, 0.2), hr=(0.85, -0.45, -0.3), hroll_r=20, curl_r=0.45,
                   wl=(1.2, 0.45, 4.6), hl=(0.2, -0.6, -0.8), curl_l=0.5, ph=2.0, wave=1.4, stream=0.45,
                   lift=0.25, flare=0.35, swirl=14)
    a_follow = stance(root=(0, -0.62, -0.14), yaw=12, lean=24, twist=30, side=4, nod=8, turn=12, jaw=26,
                      wr=(0.9, -1.15, 3.9), pole_r=(-0.6, 0.8, 0.3), hr=(0.6, 0.2, -1.0), curl_r=0.7,
                      wl=(1.2, 0.5, 4.5), hl=(0.2, 0.4, -1.0), curl_l=0.45, ph=2.4, wave=1.4, stream=0.4,
                      lift=0.22, flare=0.3, swirl=24)
    a_rec = stance(root=(0, -0.15, -0.02), yaw=5, lean=14, twist=12, nod=2, turn=4, jaw=12,
                   wr=(-0.5, -1.1, 4.1), pole_r=(-1.0, 0.6, -0.3), hr=(-0.1, -1.0, -0.1), curl_r=0.6,
                   wl=(1.0, -0.8, 4.5), hl=(0.25, -1.0, 0.2), hroll_l=-30, curl_l=0.6, ph=3.2, wave=1.3,
                   stream=0.25, lift=0.25, flare=0.2, swirl=10)
    add('Attack', [(1, ready), (6, a_wind), (10, a_hold), (13, a_mid), (14, a_hit), (18, a_follow), (24, a_rec),
                   (33, ready)])
    # Attack2: both claws thrown up overhead, then raked down through her front.
    b_dip = stance(root=(0, 0.05, -0.12), lean=16, nod=10, jaw=6, wl=(0.85, -0.6, 4.2), hl=(0.1, -0.6, -1.0),
                   curl_l=0.75, ph=0.4, wave=1.0, stream=0.15, lift=0.1, flare=-0.05)
    b_up = stance(root=(0, 0.2, 0.38), lean=-16, nod=-20, jaw=22, wl=(0.72, 0.22, 7.0), pole_l=(1.0, 0.3, -0.3),
                  hl=(0.1, 0.15, 1.0), hroll_l=0.0, curl_l=-0.3, thumb_l=-0.2, ph=1.0, wave=1.3, stream=0.2,
                  lift=0.5, flare=0.45, veil_lift=0.5)
    b_hold = stance(root=(0, 0.22, 0.42), lean=-18, nod=-22, jaw=26, wl=(0.75, 0.3, 7.05), pole_l=(1.0, 0.3, -0.3),
                    hl=(0.1, 0.25, 1.0), curl_l=-0.35, thumb_l=-0.25, ph=1.3, wave=1.3, stream=0.2, lift=0.55,
                    flare=0.5, veil_lift=0.55)
    b_mid = stance(root=(0, -0.3, 0.2), lean=10, nod=0, jaw=32, wl=(0.6, -1.5, 5.4), pole_l=(1.0, 0.4, 0.0),
                   hl=(0.0, -1.0, -0.4), curl_l=0.0, ph=1.8, wave=1.4, stream=0.35, lift=0.45, flare=0.45)
    b_hit = stance(root=(0, -0.62, -0.12), lean=30, nod=12, jaw=36, wl=(0.45, -1.95, 4.1), pole_l=(1.0, 0.5, 0.3),
                   hl=(0.0, -0.55, -1.0), curl_l=0.55, ph=2.3, wave=1.5, stream=0.5, lift=0.3, flare=0.5)
    b_follow = stance(root=(0, -0.64, -0.18), lean=33, nod=16, jaw=28, wl=(0.55, -1.45, 3.65), pole_l=(1.0, 0.5, 0.4),
                      hl=(0.05, -0.2, -1.0), curl_l=0.75, ph=2.7, wave=1.4, stream=0.4, lift=0.2, flare=0.4)
    b_rec = stance(root=(0, -0.2, -0.04), lean=18, nod=6, jaw=12, wl=(0.9, -1.0, 4.2), pole_l=(1.0, 0.6, -0.3),
                   hl=(0.2, -1.0, 0.0), hroll_l=-20, curl_l=0.65, ph=3.4, wave=1.3, stream=0.25, lift=0.25,
                   flare=0.25)
    add('Attack2', [(1, ready), (5, b_dip), (10, b_up), (12, b_hold), (14, b_mid), (15, b_hit), (19, b_follow),
                    (25, b_rec), (33, ready)])
    # Hit: knocked back, the head snapped up, the arms flung out, the cloth rippling.
    h1 = stance(root=(0, 0.38, 0.12), lean=-16, nod=-22, turn=8, roll=-8, jaw=20, wl=(1.3, 0.15, 4.9),
                pole_l=(1.0, 0.6, -0.3), hl=(0.6, 0.2, -0.6), curl_l=0.2, ph=1.0, wave=1.6, stream=-0.4, lift=0.45,
                flare=0.5, veil_lift=0.5)
    h2 = stance(root=(0, 0.3, 0.08), lean=-8, nod=-12, turn=5, roll=-5, jaw=14, wl=(1.15, -0.2, 4.7),
                pole_l=(1.0, 0.6, -0.3), hl=(0.4, -0.5, -0.4), curl_l=0.4, ph=1.8, wave=1.5, stream=-0.2,
                lift=0.35, flare=0.35)
    add('Hit', [(1, ready), (3, h1), (7, h2), (15, ready)])
    # Death: a silent scream, then she rises and dissolves to nothing, the gown scattering.
    d_rear = stance(root=(0, 0.1, 0.4), lean=-20, nod=-34, jaw=34, wl=(1.85, 0.1, 6.5), pole_l=(1.0, 0.3, -0.5),
                    hl=(0.5, 0.0, 1.0), curl_l=-0.4, thumb_l=-0.3, ph=1.0, wave=1.6, stream=0.0, lift=0.7,
                    flare=0.7, blush=0.8, veil_lift=0.6)
    d_rise = stance(root=(0, 0.05, 0.9), lean=-22, nod=-38, jaw=38, wl=(1.95, 0.05, 6.8), pole_l=(1.0, 0.3, -0.5),
                    hl=(0.5, 0.1, 1.0), curl_l=-0.45, thumb_l=-0.3, ph=2.2, wave=2.0, stream=0.0, lift=1.6,
                    flare=0.7, blush=1.0, veil_lift=1.0, scale=0.92)
    d_go1 = stance(root=(0, 0.0, 1.6), lean=-18, nod=-30, jaw=30, wl=(2.0, 0.0, 6.9), pole_l=(1.0, 0.3, -0.5),
                   hl=(0.6, 0.0, 1.0), curl_l=-0.3, ph=3.4, wave=2.4, lift=2.3, flare=0.8, blush=1.0,
                   veil_lift=1.4, swirl=40, scale=0.7)
    d_go2 = stance(root=(0, 0.0, 2.35), lean=-12, nod=-20, jaw=20, wl=(1.9, 0.0, 6.6), pole_l=(1.0, 0.3, -0.5),
                   hl=(0.6, 0.0, 1.0), curl_l=-0.2, ph=4.6, wave=2.6, lift=2.8, flare=0.9, blush=1.0,
                   veil_lift=1.7, swirl=80, scale=0.38)
    d_go3 = stance(root=(0, 0.0, 2.85), lean=-6, nod=-10, jaw=10, wl=(1.8, 0.0, 6.4), pole_l=(1.0, 0.3, -0.5),
                   hl=(0.6, 0.0, 1.0), curl_l=0.0, ph=5.6, wave=2.6, lift=3.0, flare=0.9, blush=1.0,
                   veil_lift=1.8, swirl=120, scale=0.12)
    d_end = stance(root=(0, 0.0, 3.1), lean=0, nod=0, jaw=4, wl=(1.6, 0.0, 6.0), pole_l=(1.0, 0.3, -0.5),
                   hl=(0.6, 0.0, 1.0), ph=6.3, wave=2.6, lift=3.0, flare=0.9, blush=1.0, veil_lift=1.8,
                   swirl=150, scale=0.01)
    add('Death', [(1, ready), (8, d_rear), (18, d_rise), (32, d_go1), (44, d_go2), (54, d_go3), (61, d_end)])

    # ---------------------------------------------------------------- the wail
    # The Bride's Lament (3 s, the clip's length) and the Bridal Freeze (2.5 s,
    # played faster): she draws in, then rises into the scream; the peak is the end.
    w_in = stance(root=(0, 0.05, -0.05), lean=16, nod=26, roll=6, jaw=2, wl=(-0.28, -0.5, 5.3), wr=(0.3, -0.56, 5.18),
                  pole_l=(1.0, 0.0, -0.8), hl=(-0.4, -0.2, 1.0), hr=(0.4, -0.2, 1.0), hroll_l=0, curl_l=0.65,
                  ph=0.5, wave=0.6, stream=-0.1, lift=0.0, flare=-0.2, veil_stream=-0.15, veil_lift=0.05)
    w_in2 = stance(root=(0, 0.06, -0.08), lean=18, nod=29, roll=5, jaw=2, wl=(-0.3, -0.48, 5.28),
                   wr=(0.32, -0.54, 5.15), pole_l=(1.0, 0.0, -0.8), hl=(-0.4, -0.2, 1.0), hr=(0.4, -0.2, 1.0),
                   curl_l=0.7, ph=1.0, wave=0.5, stream=-0.12, lift=0.0, flare=-0.22, veil_stream=-0.15,
                   veil_lift=0.05)
    w_open = stance(root=(0, 0.02, 0.18), lean=2, nod=4, jaw=10, wl=(1.5, -0.55, 5.2), pole_l=(1.0, 0.4, -0.5),
                    hl=(0.6, -0.6, 0.3), curl_l=0.2, ph=1.8, wave=1.0, stream=0.1, lift=0.3, flare=0.3, blush=0.3,
                    veil_stream=0.3, veil_lift=0.3)
    w_rise = stance(root=(0, 0.06, 0.34), lean=-9, nod=-22, jaw=26, wl=(1.7, -0.25, 6.5), pole_l=(1.0, 0.3, -0.5),
                    hl=(0.6, -0.1, 0.8), curl_l=-0.3, thumb_l=-0.3, ph=2.8, wave=1.4, stream=0.5, lift=0.65,
                    flare=0.7, blush=0.8, veil_stream=1.0, veil_lift=0.6)
    w_peak = stance(root=(0, 0.1, 0.46), lean=-17, nod=-38, jaw=38, wl=(1.65, 0.05, 7.1), pole_l=(1.0, 0.3, -0.5),
                    hl=(0.65, 0.05, 0.8), curl_l=-0.5, thumb_l=-0.4, ph=3.8, wave=1.7, stream=0.75, lift=0.9,
                    flare=1.0, blush=1.0, veil_stream=1.4, veil_lift=0.8)

    def tremble(i, ph):
        k = 1 if i % 2 else -1
        return stance(root=(0.015 * k, 0.1, 0.46 + 0.02 * k), lean=-17 - k, nod=-38 + 2 * k, roll=2 * k, jaw=38 + 3 * k,
                      wl=(1.65 + 0.04 * k, 0.05, 7.1 + 0.05 * k), wr=(-1.65 + 0.04 * k, 0.05, 7.1 - 0.05 * k),
                      pole_l=(1.0, 0.3, -0.5), hl=(0.65, 0.05, 0.8), curl_l=-0.5 - 0.06 * k, thumb_l=-0.4, ph=ph,
                      wave=1.8, stream=0.8, lift=0.95, flare=1.05 + 0.06 * k, blush=1.0, veil_stream=1.5,
                      veil_lift=0.85)
    add('Wail', [(1, ready), (10, w_in), (20, w_in2), (34, w_open), (48, w_rise), (60, w_peak), (64, tremble(1, 4.2)),
                 (68, tremble(2, 4.6)), (73, tremble(3, 5.0))])

    # ---------------------------------------------------------------- the embrace
    # The held body: 1.5 yd ahead of her floor point, its feet 1.4 over hers, a
    # 2.6 yd player whose chest is about 3 yd over her floor. Wrist targets here
    # are in the floor frame (pivot=True), where the sim holds the victim.
    hold_kw = dict(root=(0, -0.32, -0.6), lean=48, nod=20, jaw=5, pivot=True, wl=(-0.22, -1.96, 3.2),
                   wr=(0.26, -1.92, 3.08), pole_l=(1.0, 0.25, 0.1), pole_r=(-1.0, 0.25, -0.1), hl=(-1.0, -0.35, 0.1),
                   hr=(1.0, -0.35, -0.1), hroll_l=-70.0, hroll_r=70.0, curl_l=0.8, thumb_l=0.6, wave=1.3,
                   stream=-0.2, lift=-0.2, flare=0.25, veil_stream=0.5, veil_lift=-0.3, tails=-0.1)
    r_coil = stance(root=(0, 0.25, 0.12), lean=-6, nod=12, jaw=8, wl=(1.3, 0.3, 4.8), pole_l=(1.0, 0.4, -0.5),
                    hl=(0.3, 0.6, -0.4), curl_l=0.45, ph=0.6, wave=1.0, stream=0.0, lift=0.2, flare=0.2)
    r_lunge = stance(root=(0, -0.42, -0.4), lean=40, nod=18, jaw=22, pivot=True, wl=(0.5, -1.85, 3.3),
                     pole_l=(1.0, 0.3, 0.2), hl=(-0.25, -1.0, -0.2), hroll_l=-40, curl_l=-0.2, thumb_l=-0.2, ph=1.5,
                     wave=1.4, stream=0.6, lift=0.2, flare=0.35, veil_stream=0.9)
    r_arrive = stance(root=(0, -0.36, -0.55), lean=46, nod=20, jaw=14, pivot=True, wl=(0.36, -2.0, 3.2),
                      wr=(-0.4, -1.98, 2.95), pole_l=(1.0, 0.25, 0.1), hl=(-0.8, -0.5, 0.0), hr=(0.8, -0.5, 0.0),
                      hroll_l=-60, curl_l=0.2, thumb_l=0.1, ph=2.1, wave=1.4, stream=0.3, lift=0.05, flare=0.3,
                      veil_stream=0.7)
    def cradle(i):
        """The hold's rock at quarter `i` of the 2 s loop (i = 4 is i = 0 again)."""
        ph = math.tau * i / 4
        kw = dict(hold_kw)
        kw.update(root=(0.05 * math.sin(ph), -0.32, -0.6 + 0.05 * math.sin(ph * 2)), yaw=4 * math.sin(ph), roll=6 * math.sin(ph),
                  nod=20 + 3 * math.sin(ph), lean=48 + 2 * math.sin(ph), swirl=18 * math.sin(ph), ph=ph * 2,
                  hips_sway=6 * math.sin(ph))
        return stance(**kw)

    hold = [cradle(0)]
    add('EmbraceReach', [(1, ready), (7, r_coil), (17, r_lunge), (23, r_arrive), (29, hold[0])])
    add('EmbraceHold', [(1 + i * 12, cradle(i)) for i in range(5)])
    rel1 = stance(root=(0, -0.2, 0.12), lean=14, nod=6, jaw=12, wl=(1.6, -1.0, 4.6), pole_l=(1.0, 0.4, -0.3),
                  hl=(0.7, -0.6, 0.2), curl_l=-0.3, thumb_l=-0.2, ph=1.2, wave=1.4, stream=0.2, lift=0.4, flare=0.45)
    add('Release', [(1, hold[0]), (7, rel1), (15, ready)])
    return clips


def _mirror_axis(v):
    return (v[0], -v[1], -v[2])


# ------------------------------------------------------------------ preview
def preview_emission(mats, strength=0.32):
    """Blender preview only (after the export): the game lifts the authored atlas by
    VisualDef.selfIllumination; here the image drives the emission the same way."""
    for m in mats:
        if m.name not in ('CreatureBody', 'CreatureGhostVeil'):
            continue
        nt = m.node_tree
        img = nt.nodes.get('Albedo')
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if img is None or bsdf is None:
            continue
        nt.links.new(img.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = strength


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    fast = '--fast' in argv
    work = argv[argv.index('--work') + 1] if '--work' in argv else None
    new_scene()
    mats = make_materials()
    body, head, hands = sculpt(work, fast)
    surf_body = Surface([body])
    surf_head = Surface([head])
    waist = []
    for k in range(SKIRT):
        hit = surf_body.around((0, 0.03, WAIST_Z), skirt_angle(k), offset=0.02)
        waist.append(hit[0] if hit else waist_guess(k))
    bones = make_bones(waist)
    parts = build_parts(surf_body, surf_head, waist)
    cloths = build_cloth(waist)
    flesh = [body, head] + hands
    for o in flesh:
        for m in mats:
            o.data.materials.append(m)
    objects = flesh + [p.to_object(mats) for p in parts] + [c.to_object(mats) for c in cloths]
    lady = join(objects, 'LadyBonechill')
    print('TRIANGLES', triangles(lady))
    if '--nobake' not in argv:
        bake_ghost(lady, size=512 if fast else 2048, samples=12 if fast else 40, nrm_size=256 if fast else 1024)
    arm = build_armature('LadyBonechill', bones)
    bind(lady, arm)
    clips = make_clips(arm, bones, waist)
    for name, f, b, over in REACH_LOG:
        print('REACH', name, f, b, over)
    # The game measures her half a second into Idle (src/render/characters/assets.ts).
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(12)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = lady.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3), 'MAXZ', round(max(zs), 3))
    # The Embrace: where the hands are in the hold (the victim's chest is about (0, -1.5, 3)).
    arm.animation_data.action = bpy.data.actions['EmbraceHold']
    bpy.context.scene.frame_set(0)
    for b in ('Hand.L', 'Hand.R'):
        pb = arm.pose.bones[b]
        print('EMBRACE', b, [round(c, 2) for c in (arm.matrix_world @ pb.head)])
    arm.animation_data.action = bpy.data.actions['EmbraceReach']
    bpy.context.scene.frame_set(16)
    for b in ('Hand.L', 'Hand.R'):
        pb = arm.pose.bones[b]
        print('REACH_HANDS', b, [round(c, 2) for c in (arm.matrix_world @ pb.tail)])
    for pb in arm.pose.bones:
        pb.scale = (1, 1, 1)
    if out != '-':
        export(out, arm, image_format='AUTO', extras=True)
    preview_emission(mats)
    if '--blend' in argv:
        arm.animation_data.action = bpy.data.actions['Idle']
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
