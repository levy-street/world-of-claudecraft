"""The Beastmaster's dressing: the Beastspear (sculpted in its own frame and set
in the right fist on the never-keyed Weapon bone) with fangs and feathers tied
under its blade; the jaguar-head hood and its fangs; the heavy tusks (the left
one broken); the small gold eyes; bone rings in the ears; the necklace of fangs;
bone pauldrons on both shoulders; the pelt's forelegs knotted across his chest
and a harness of cord; the bone girdle; wraps and feathers at the wrists and the
ankles."""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf


def _pair(part):
    o = part.to_object()
    return (K.duplicate(o, o.name + '_hi'), o)


def _sculpt(F, name, mat, bone, M, target, workdir, binding='rigid'):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    hi.data.transform(Matrix(M.tolist()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = K.duplicate(hi, name)
    tris = K.triangles(lo)
    if tris > target:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = binding
    return hi, lo


def horn(part, base, ctrl, tip, r0, n=8, sides=7, r_tip=0.006):
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        p = (1 - t) ** 2 * np.asarray(base) + 2 * (1 - t) * t * np.asarray(ctrl) + t * t * np.asarray(tip)
        pts.append(p)
        rr.append(r0 * (1 - t) ** 0.75 + r_tip)
    part.tube(pts, rr, sides=sides)


def quill(part, base, direction, length, width, bend=(0, 0, 0), sides=6, n=7, flat=0.45):
    d = np.asarray(direction, float)
    d = d / np.linalg.norm(d)
    b = np.asarray(base, float)
    pts, rr = [], []
    for i in range(n):
        t = i / (n - 1)
        pts.append(b + d * length * t + np.asarray(bend) * length * t * t)
        rr.append(width * (0.55 + 1.4 * t) * (1 - t) ** 1.1 + 0.004)
    part.tube(pts, rr, sides=sides, squash=flat)


# ------------------------------------------------------------------ the spear
def build_staff(workdir, k=1.0):
    F = A.build_staff(0.007 * k)
    M = A.staff_matrix()
    out = [_sculpt(F, 'Beastspear', 'wood', 'Weapon', M, 2200, workdir)]
    sp = A.staff_point
    bz = A.BLADE_AT
    f = K.Part('SpearFeathers', 'quill', bone='Weapon')
    ch = K.Part('SpearFangs', 'tooth', bone='Weapon')
    cord = K.Part('SpearCords', 'rope', bone='Weapon')
    for j, a in enumerate((-60, 60, 180)):
        th = math.radians(a)
        top = sp((0.09 * math.cos(th), 0.09 * math.sin(th), bz - 0.75))
        low = sp((0.14 * math.cos(th), 0.14 * math.sin(th), bz - 1.15 - 0.08 * j))
        cord.tube([top, low], 0.012, sides=4)
        if j < 2:
            quill(f, low, low - top, 0.38, 0.05, sides=5)
        else:
            horn(ch, low, low + (low - top) * 0.15, low + (low - top) * 0.5, 0.03, n=6, sides=6)
    out += [_pair(f), _pair(ch), _pair(cord)]
    return out


# ------------------------------------------------------------------ the head
def build_face():
    out = []
    # tusks curling up out of the lower jaw
    t = K.Part('Tusks', 'tooth', bone='Jaw')
    for s in (1, -1):
        b = np.array((0.14 * s, -0.98, 4.56))
        if s > 0:
            # the left tusk broken off short, its stump jagged
            horn(t, b, b + np.array((0.04 * s, -0.05, 0.08)), b + np.array((0.06 * s, -0.05, 0.16)), 0.058, n=6,
                 sides=7, r_tip=0.03)
        else:
            horn(t, b, b + np.array((0.1 * s, -0.12, 0.22)), b + np.array((0.16 * s, -0.04, 0.46)), 0.058, n=9,
                 sides=8)
    out.append(_pair(t))
    # small deep eyes, burning gold
    e = K.Part('EyeGlow', 'glow_eye', bone='Eyes')
    for s in (1, -1):
        e.sphere(A._m(A.EYE, s) + np.array((0, 0.0, 0.0)), (0.035, 0.022, 0.024), seg=10, rings=6)
    out.append(_pair(e))
    # bone rings down each ear
    for s, side in ((1, 'L_'), (-1, 'R_')):
        r = K.Part(f'{side}EarRings', 'bone', bone=side + 'Ear')
        for u in (0.25, 0.45):
            c = A.lerp(A._m((0.3, -0.52, 4.92), s), A._m((0.84, -0.16, 5.12), s), u) + np.array((0, 0.0, -0.06))
            r.torus(c, (1.0, 0.4, 0.0), 0.05, 0.012, seg=12, sides=5)
        out.append(_pair(r))
    return out


def build_mask(workdir, k=1.0):
    """The jaguar-head hood: the great cat's head worn over his own, its ears up,
    its upper fangs over his brow (the pelt falls from it down his back)."""
    F = sdf.Field((-0.7, -1.45, 4.65), (0.7, 0.55, 5.75), 0.0075 * k)
    c = np.array((0.0, -0.44, 5.36))
    F.add(sdf.Ellipsoid(c, (0.42, 0.48, 0.3)), 0.06)                                        # the cat's cranium
    F.add(sdf.Ellipsoid(c + np.array((0, -0.5, -0.04)), (0.22, 0.3, 0.17)), 0.07)          # the muzzle, long
    F.add(sdf.Ellipsoid(c + np.array((0, -0.78, 0.0)), (0.12, 0.07, 0.08)), 0.03)          # the nose leather
    F.add(sdf.RoundCone(c + np.array((0, -0.2, 0.22)), c + np.array((0, -0.7, 0.1)), 0.1, 0.07), 0.05)  # bridge
    for s in (1, -1):
        F.add(sdf.Ellipsoid(c + np.array((0.24 * s, -0.36, -0.06)), (0.13, 0.2, 0.13)), 0.05)  # jowls
        F.add(sdf.Ellipsoid(c + np.array((0.28 * s, 0.02, 0.32)), (0.12, 0.05, 0.16),
                            sdf.rot_matrix(rx=0.15, ry=-0.35 * s)), 0.03)                    # ears, up
        F.add(sdf.Ellipsoid(c + np.array((0.17 * s, -0.42, 0.13)), (0.12, 0.08, 0.05),
                            sdf.rot_matrix(ry=-0.4 * s)), 0.03)                               # a scowling brow
        F.sub(sdf.Ellipsoid(c + np.array((0.16 * s, -0.48, 0.07)), (0.065, 0.045, 0.03)), 0.012)  # dead eye slits
    # the pelt's edge flaring round the face and down the nape
    F.add(sdf.Ellipsoid(c + np.array((0, 0.32, -0.28)), (0.48, 0.3, 0.3)), 0.08)
    F.sub(sdf.Ellipsoid(c + np.array((0, 0.0, -0.22)), (0.36, 0.44, 0.2)), 0.03)             # hollow underneath
    out = [_sculpt(F, 'JaguarHood', 'pelt', 'Head', np.eye(4), 1800, workdir)]
    fangs = K.Part('HoodFangs', 'tooth', bone='Head')
    for s in (1, -1):
        b = c + np.array((0.12 * s, -0.7, -0.14))
        horn(fangs, b, b + np.array((0, -0.03, -0.1)), b + np.array((0.0, 0.0, -0.24)), 0.042, n=7, sides=6)
    out.append(_pair(fangs))
    return out


# ------------------------------------------------------------------ the body's gear
def build_necklace():
    cord = K.Part('NeckCord', 'rope', binding='transfer')
    fangs = K.Part('NeckFangs', 'tooth', binding='transfer')
    pts = []
    for i in range(17):
        a = math.radians(-100 + 200 * i / 16)
        pts.append(np.array((0.42 * math.sin(a), -0.38 * math.cos(a) - 0.02, 3.94 - 0.18 * math.cos(a) ** 2)))
    cord.tube(pts, 0.016, sides=5)
    for i in range(2, 15, 2):
        p = pts[i]
        horn(fangs, p, p + np.array((0, -0.03, -0.08)), p + np.array((0, -0.01, -0.17)), 0.03, n=6, sides=6)
    return [_pair(cord), _pair(fangs)]


def build_shoulder_jaw():
    """Bone pauldrons on both shoulders: a great curved plate of skull bone, a row
    of fangs along its rim."""
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        p = K.Part(f'{side}Pauldron', 'bone', bone=side + 'Clavicle')
        sh = A._m(A.SHOULDER, s) + np.array((0.06 * s, 0.0, 0.3))
        p.sphere(sh, (0.36, 0.38, 0.16), rot=sdf.rot_matrix(ry=-0.45 * s), seg=14, rings=7, cut=((0, 0, 1), -0.2))
        for k in range(5):
            a = math.radians(-60 + 30 * k)
            b = sh + np.array((0.3 * s * math.cos(a) + 0.08 * s, 0.3 * math.sin(a), -0.08))
            horn(p, b, b + np.array((0.04 * s, 0, -0.06)), b + np.array((0.06 * s, 0.0, -0.16)), 0.03, n=5, sides=5)
        out.append(_pair(p))
    return out


def build_girdle():
    """A girdle of bone plates round the hips over the loincloth's top."""
    p = K.Part('Girdle', 'bone', binding='transfer')
    belt = K.Part('Belt', 'rope', binding='transfer')
    ring = []
    for i in range(24):
        a = math.tau * i / 24
        ring.append(np.array((0.56 * math.sin(a), 0.12 - 0.5 * math.cos(a), 2.44)))
    belt.tube(ring, 0.04, sides=6, closed=True)
    for i in range(0, 24, 2):
        a = math.tau * i / 24
        c = np.array((0.6 * math.sin(a), 0.12 - 0.54 * math.cos(a), 2.4))
        n = np.array((math.sin(a), -math.cos(a), 0.0))
        p.sphere(c, (0.07, 0.07, 0.11), rot=sdf.frame_from(n), seg=8, rings=5)
    return [_pair(p), _pair(belt)]


def build_wraps():
    out = []
    for s, side in ((1, 'L_'), (-1, 'R_')):
        w = K.Part(f'{side}Wraps', 'rope', binding='transfer')
        f = K.Part(f'{side}WrapFeathers', 'quill', binding='transfer')
        el, wr = A._m(A.ELBOW, s), A._m(A.WRIST, s)
        ax = A.unit(wr - el)
        for u in (0.68, 0.8, 0.9):
            w.torus(A.lerp(el, wr, u), tuple(ax), 0.16 - 0.03 * u, 0.025, seg=14, sides=5)
        kn, an = A._m(A.KNEE, s), A._m(A.ANKLE, s)
        ax2 = A.unit(an - kn)
        for u in (0.7, 0.82):
            w.torus(A.lerp(kn, an, u), tuple(ax2), 0.16, 0.025, seg=14, sides=5)
        b = A.lerp(kn, an, 0.72) + np.array((0.15 * s, 0.05, 0.0))
        quill(f, b, (0.25 * s, 0.3, -1.0), 0.42, 0.05, sides=5)
        quill(f, b + np.array((0, 0.06, 0)), (0.35 * s, 0.5, -1.0), 0.36, 0.045, sides=5)
        out += [_pair(w), _pair(f)]
    return out


def build_bundle():
    """The pelt's forelegs knotted across his chest, the paws hanging, and a
    harness of cord with bone plates across the other way."""
    legs = K.Part('PeltForelegs', 'pelt', binding='transfer')
    paws = K.Part('PeltClaws', 'tooth', binding='transfer')
    knot = np.array((0.0, -0.66, 3.62))
    for s in (1, -1):
        pts = [np.array((0.62 * s, 0.1, 4.12)), np.array((0.5 * s, -0.42, 3.96)), np.array((0.18 * s, -0.66, 3.72)),
               knot + np.array((0.04 * s, -0.04, -0.02)), knot + np.array((-0.12 * s, -0.08, -0.3))]
        legs.tube(pts, [0.12, 0.11, 0.1, 0.09, 0.08], sides=9)
        paw = knot + np.array((-0.14 * s, -0.1, -0.4))
        legs.sphere(paw, (0.11, 0.1, 0.09), seg=10, rings=6)
        for j in (-1, 0, 1):
            b = paw + np.array((0.05 * j, -0.06, -0.06))
            horn(paws, b, b + np.array((0, -0.04, -0.04)), b + np.array((0, -0.02, -0.12)), 0.022, n=5, sides=5)
    straps = K.Part('Harness', 'rope', binding='transfer')
    plates = K.Part('HarnessPlates', 'bone', binding='transfer')
    for s in (1, -1):
        pts = [np.array((0.4 * s, 0.4, 4.08)), np.array((0.42 * s, -0.2, 4.02)), np.array((0.15 * s, -0.66, 3.5)),
               np.array((-0.28 * s, -0.62, 2.95)), np.array((-0.5 * s, 0.0, 2.75))]
        straps.tube(pts, 0.035, sides=5)
        for u in (0.35, 0.6):
            c = A.lerp(pts[2], pts[3], u) + np.array((0, -0.05, 0))
            plates.sphere(c, (0.09, 0.04, 0.11), seg=8, rings=5)
    return [_pair(legs), _pair(paws), _pair(straps), _pair(plates)]


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    return (build_staff(workdir) + build_face() + build_mask(workdir) + build_necklace() + build_shoulder_jaw()
            + build_girdle() + build_wraps() + build_bundle())
