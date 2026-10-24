"""The Acolyte's hard dressing: the coral-crowned staff (built in the staff's own
frame, then set in the right fist on the never-keyed Weapon bone) with the pearl of
sea light in its crown, the great conch in the left hand, and the sea-light eyes."""
import math
import os

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf
from sdf import Field


def _decimate_pair(hi, name, target):
    lo = K.duplicate(hi, name)
    tris = K.triangles(lo)
    if tris > target:
        mod = lo.modifiers.new('dec', 'DECIMATE')
        mod.ratio = target / tris
        mod.use_collapse_triangulate = True
        K.apply_mods(lo)
    return lo


def _rigid_pair(F, name, M, mat, bone, target, workdir):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    hi.data.transform(Matrix(M.tolist()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = _decimate_pair(hi, name, target)
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = 'rigid'
    return hi, lo


def build_staff(workdir, k=1.0):
    """The staff: a straight sea-bleached pole bound in cord, crowned with a knot of
    branching coral that cups a pearl of sea light; shells tied under the crown."""
    M = A.staff_matrix()
    B_, T_ = A.STAFF_BELOW, A.STAFF_ABOVE
    out = []

    def part(name, mat, build, target, bone='Weapon', Mx=M):
        p = K.Part(name + '_src', mat, bone=bone)
        build(p)
        o = p.to_object()
        o.data.transform(Matrix(Mx.tolist()))
        lo = _decimate_pair(o, name, target)
        hi = K.duplicate(o, name + '_hi')
        bpy.data.objects.remove(o, do_unlink=True)
        for x in (hi, lo):
            x['mat'] = mat
            x['bone'] = bone
            x['binding'] = 'rigid'
        out.append((hi, lo))

    def pole(p):
        p.tube([(0.0, 0.0, -B_), (0.01, 0.0, 0.0), (0.0, 0.0, T_)], [0.038, 0.042, 0.036], sides=9)
        for z in (-0.25, 0.25, T_ - 0.35):
            p.torus((0.0, 0.0, z), (0, 0, 1), 0.044, 0.012, seg=10, sides=5)
    part('Staff', 'wood', pole, 1200)

    def coral(p):
        rng = np.random.default_rng(14)
        base = np.array((0.0, 0.0, T_ - 0.04))
        for i in range(6):
            a = i * math.tau / 6 + rng.uniform(-0.2, 0.2)
            d = np.array((math.cos(a), math.sin(a), 0.0))
            mid = base + d * 0.1 + np.array((0, 0, 0.14))
            tip = base + d * (0.16 + rng.uniform(0, 0.06)) + np.array((0, 0, 0.3 + rng.uniform(0, 0.1)))
            p.tube([tuple(base), tuple(mid), tuple(tip)], [0.03, 0.022, 0.01], sides=6)
            twig = mid + d * 0.04 + np.array((0, 0, 0.04))
            p.tube([tuple(twig), tuple(twig + d * 0.08 + np.array((0, 0, 0.1)))], [0.012, 0.005], sides=5)
        for z, a in ((T_ - 0.42, 0.0), (T_ - 0.5, 2.0)):
            p.sphere((0.05 * math.cos(a), 0.05 * math.sin(a), z), (0.03, 0.012, 0.028), seg=8, rings=5)
            p.box((0.04 * math.cos(a), 0.04 * math.sin(a), z + 0.05), (0.006, 0.006, 0.05))
    part('Coral', 'coral', coral, 1100)

    def pearl(p):
        p.sphere(tuple(A.PEARL), (0.075, 0.075, 0.075), seg=12, rings=8)
    part('Pearl', 'glow_lure', pearl, 200)

    # the conch, in the left hand's frame (its mouth opening toward the fingers)
    w, down, width, palm = A.hand_frame(1)
    Mh = np.eye(4)
    Mh[:3, 0] = width
    Mh[:3, 1] = palm
    Mh[:3, 2] = down
    Mh[:3, 3] = w + down * 0.1 + palm * 0.16

    def conch(p):
        # a great horned conch: the spire, the body whorl swelling to the flared lip,
        # a spiral ridge winding up it and a crown of knobs on the shoulder
        L0, L1 = -0.34, 0.24
        zs = np.linspace(L0, L1, 12)
        rad = [0.012 + 0.14 * ((z - L0) / (L1 - L0)) ** 1.3 for z in zs]
        p.tube([(0.0, 0.0, z) for z in zs], rad, sides=12)
        helix = []
        for i in range(60):
            t = i / 59
            z = L0 + (L1 - L0) * t
            r = 0.012 + 0.14 * t ** 1.3 + 0.008
            a_ = t * 5.0 * math.tau
            helix.append((r * math.cos(a_), r * math.sin(a_), z))
        p.tube(helix, [0.012] * len(helix), sides=4)
        for i in range(7):
            a_ = i * math.tau / 7
            p.tube([(0.12 * math.cos(a_), 0.12 * math.sin(a_), 0.1), (0.17 * math.cos(a_), 0.17 * math.sin(a_), 0.04)],
                   [0.03, 0.006], sides=5)
        p.sphere((0.05, 0.0, L1 + 0.02), (0.2, 0.07, 0.15), seg=12, rings=6)           # the flared lip
    part('Conch', 'shell', conch, 900, bone='L_Hand', Mx=Mh)
    return out


def build_eyes():
    out = []
    p = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((0, -0.002, 0))
        p.sphere(c + np.array((0, -0.006, 0)), (A.EYE_R * 1.05, A.EYE_R * 0.85, A.EYE_R * 0.95), seg=10, rings=6)
    o = p.to_object()
    out.append((K.duplicate(o, o.name + '_hi'), o))
    return out


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_staff(workdir, k) + build_eyes()
