"""The Arbalest's hard dressing: the windlass crossbow (the stock and the steel prod
ride the never-keyed Weapon bone; the bolt, the drawn string, the loosed string and
the windlass crank ride their own bones so the clips can show the shot and the
reload), the quiver of bolts at the right hip, and the sea-light eyes."""
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


def build_crossbow(workdir, k=1.0):
    """Built in the crossbow frame (+Z down the stock, +X up, +Y across), then set by
    crossbow_matrix. Rigid parts, one bone each."""
    M = A.crossbow_matrix()
    B, N, P, E, S_, U = A.XB_BUTT, A.XB_NUT, A.XB_PROD, A.XB_NOSE, A.XB_SPAN, A.XB_UP
    out = []

    def part(name, mat, bone, build, target):
        p = K.Part(name + '_src', mat, bone=bone)
        build(p)
        o = p.to_object()
        o.data.transform(Matrix(M.tolist()))
        lo = _decimate_pair(o, name, target)
        hi = K.duplicate(o, name + '_hi')
        bpy.data.objects.remove(o, do_unlink=True)
        for x in (hi, lo):
            x['mat'] = mat
            x['bone'] = bone
            x['binding'] = 'rigid'
        out.append((hi, lo))

    def stock(p):
        # the tiller: a heavy wooden beam, the butt flaring, iron bands and the trigger
        p.tube([(0, 0, B), (0.01, 0, B + 0.25), (0.02, 0, 0.0), (0.03, 0, E)], [0.075, 0.06, 0.05, 0.045], sides=8,
               squash=0.7)
        p.box((0.02, 0, B + 0.03), (0.09, 0.06, 0.06))
        for z in (B + 0.32, 0.15, 0.6):
            p.torus((0.02, 0, z), (0, 0, 1), 0.055, 0.012, seg=10, sides=5)
        p.tube([(-0.04, 0, 0.12), (-0.12, 0, 0.18), (-0.15, 0, 0.3)], [0.015, 0.014, 0.012], sides=5)
        p.box((U - 0.02, 0, N), (0.03, 0.045, 0.04))
    part('Crossbow', 'wood', 'Weapon', stock, 1400)

    def prod(p):
        pts, rr = [], []
        for t in np.linspace(-1, 1, 13):
            pts.append((U * 0.6, S_ * t, P + 0.12 * (1 - t * t)))
            rr.append(0.035 * (1 - 0.5 * abs(t)) + 0.01)
        p.tube(pts, rr, sides=7, squash=0.6)
        for s in (-1, 1):
            p.sphere((U * 0.6, S_ * s, P), (0.025, 0.025, 0.025), seg=8, rings=5)
        p.torus((U * 0.3, 0, P + 0.1), (0, 1, 0), 0.07, 0.016, seg=10, sides=5)
        p.torus((0.02, 0, E + 0.06), (0, 1, 0), 0.08, 0.014, seg=12, sides=5)
    part('Prod', 'steel', 'Weapon', prod, 900)

    def strings(p, z_mid):
        for s in (-1, 1):
            p.tube([(U * 0.6, S_ * s, P), (U * 0.6, 0.03 * s, z_mid)], [0.009, 0.009], sides=4)
    part('StringDrawn', 'rope', 'StringD', lambda p: strings(p, N), 120)
    part('StringLoosed', 'rope', 'StringR', lambda p: strings(p, P - 0.06), 120)

    def bolt(p):
        p.tube([(U, 0, N - 0.02), (U, 0, E + 0.02)], [0.016, 0.014], sides=6)
        p.tube([(U, 0, E + 0.02), (U, 0, E + 0.14)], [0.03, 0.002], sides=4)
        for a in (0, 2.1, 4.2):
            p.box((U + 0.03 * math.cos(a), 0.03 * math.sin(a), N + 0.06), (0.004, 0.025, 0.06))
    part('Bolt', 'steel', 'Bolt', bolt, 300)

    def crank(p):
        c = (0.0, 0.07, B + 0.12)
        p.tube([c, (0.0, 0.18, B + 0.12)], [0.03, 0.03], sides=8)
        p.tube([(0.0, 0.18, B + 0.12), (0.16, 0.2, B + 0.12)], [0.014, 0.014], sides=5)
        p.tube([(0.16, 0.2, B + 0.12), (0.16, 0.3, B + 0.12)], [0.022, 0.022], sides=6)
    part('Crank', 'plate', 'Crank', crank, 300)
    return out


def build_quiver(workdir, k=1.0):
    """A leather quiver hung at the right hip, mouth up and back, a fistful of bolts in it."""
    base = np.array((-0.52, 0.18, 1.95))
    top = np.array((-0.6, 0.32, 2.62))
    q = K.Part('Quiver', 'leather', bone='Hips')
    q.tube([base, (base + top) / 2, top], [0.1, 0.11, 0.115], sides=10)
    q.torus(top, tuple(A.unit(top - base)), 0.115, 0.015, seg=12, sides=5)
    q.torus(base + (top - base) * 0.3, tuple(A.unit(top - base)), 0.108, 0.012, seg=12, sides=5)
    o = q.to_object()
    b = K.Part('QuiverBolts', 'steel', bone='Hips')
    rng = np.random.default_rng(9)
    for i in range(7):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.02, 0.07)
        p0 = top + np.array((r * math.cos(a), r * math.sin(a), -0.15))
        p1 = p0 + A.unit(top - base + np.array((rng.normal(0, 0.1), rng.normal(0, 0.1), 0))) * 0.35
        b.tube([p0, p1], [0.012, 0.012], sides=5)
        for j in range(3):
            aa = j * 2.1
            b.box(p1 + np.array((0.02 * math.cos(aa), 0.02 * math.sin(aa), -0.04)), (0.003, 0.016, 0.04))
    bo = b.to_object()
    return [(K.duplicate(o, o.name + '_hi'), o), (K.duplicate(bo, bo.name + '_hi'), bo)]


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
    return build_crossbow(workdir, k) + build_quiver(workdir, k) + build_eyes()
