"""The Prisoner's hard dressing: only the sea light in his eyes (his irons are
sculpted with the body)."""
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
    """The staff: a gnarled driftwood pole, knotted and bent, its crown curling over
    into a hook; a line off the hook to the lure (a glowing bulb on a fleshy stalk);
    rags and shells tied under the crown."""
    M = A.staff_matrix()
    B_, T_ = A.STAFF_BELOW, A.STAFF_ABOVE
    out = []

    def part(name, mat, build, target):
        p = K.Part(name + '_src', mat, bone='Weapon')
        build(p)
        o = p.to_object()
        o.data.transform(Matrix(M.tolist()))
        lo = _decimate_pair(o, name, target)
        hi = K.duplicate(o, name + '_hi')
        bpy.data.objects.remove(o, do_unlink=True)
        for x in (hi, lo):
            x['mat'] = mat
            x['bone'] = 'Weapon'
            x['binding'] = 'rigid'
        out.append((hi, lo))

    def wood(p):
        rng = np.random.default_rng(3)
        zs = np.linspace(-B_, T_ - 0.3, 9)
        pts = [(0.025 * math.sin(z * 2.3) + rng.uniform(-0.01, 0.01), 0.02 * math.cos(z * 1.7), z) for z in zs]
        pts += [(0.03, 0.0, T_ - 0.1), (0.14, 0.0, T_ + 0.04), (0.3, 0.0, T_ + 0.06), (0.43, 0.0, T_ - 0.05),
                (0.46, 0.0, T_ - 0.2)]
        rr = [0.045 - 0.012 * (i / len(pts)) for i in range(len(pts))]
        rr[-1] = 0.022
        p.tube(pts, rr, sides=9)
        for z in (-1.4, -0.6, 0.55, 1.05):                                   # knots
            p.sphere((0.03 * math.sin(z * 2.3), 0.02 * math.cos(z * 1.7), z), (0.055, 0.05, 0.07), seg=8, rings=5)
        p.tube([(0.0, 0.0, T_ - 0.62), (-0.12, 0.02, T_ - 0.42), (-0.16, 0.03, T_ - 0.3)], [0.022, 0.016, 0.008],
               sides=5)                                                       # a snag of branch
    part('Staff', 'wood', wood, 1800)

    def line(p):
        top = (0.46, 0.0, T_ - 0.21)
        bot = tuple(A.LURE + np.array((0.0, 0.0, 0.09)))
        p.tube([top, ((top[0] + bot[0]) / 2 + 0.01, 0.0, (top[2] + bot[2]) / 2), bot], [0.007, 0.007, 0.007], sides=4)
        # rags and shells tied under the crown
        for z, a in ((T_ - 0.45, 0.0), (T_ - 0.55, 1.6)):
            p.torus((0.0, 0.0, z), (0, 0, 1), 0.055, 0.016, seg=10, sides=5)
            p.box((0.05 * math.cos(a), 0.05 * math.sin(a), z - 0.14), (0.02, 0.008, 0.13))
        p.sphere((-0.05, 0.04, T_ - 0.62), (0.03, 0.012, 0.028), seg=8, rings=5)
        p.sphere((0.05, -0.04, T_ - 0.66), (0.026, 0.012, 0.024), seg=8, rings=5)
    part('StaffRags', 'rope', line, 500)

    def stalk(p):
        c = A.LURE
        p.tube([tuple(c + np.array((0.0, 0.0, 0.1))), tuple(c + np.array((0.0, 0.0, 0.04)))], [0.016, 0.03], sides=6)
    part('LureStalk', 'flesh', stalk, 120)

    def bulb(p):
        p.sphere(tuple(A.LURE), (0.075, 0.075, 0.085), seg=12, rings=8)
    part('Lure', 'glow_lure', bulb, 200)
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
    return build_eyes()
