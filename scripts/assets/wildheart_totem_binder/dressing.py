"""The Totem-Binder's dressing: the Binder's Staff (sculpted in its own frame and
set in the right fist on the never-keyed Weapon bone) with its feathers and bone
charms; the jaguar-skull mask and its red plumes; the tusks; the small gold eyes;
the bone rings in the ears; the necklace of fangs and the jaguar jaw on the left
shoulder; the bone girdle; leather wraps and feathers at the wrists and the
ankles; and the bundle of carved stakes strapped across his back."""
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


# ------------------------------------------------------------------ the staff
def build_staff(workdir, k=1.0):
    F = A.build_staff(0.007 * k)
    M = A.staff_matrix()
    out = [_sculpt(F, 'BinderStaff', 'wood', 'Weapon', M, 2400, workdir)]
    # feathers and bone charms tied below the crown
    sp = A.staff_point
    cz = A.CROWN_AT
    f = K.Part('StaffFeathers', 'quill', bone='Weapon')
    ch = K.Part('StaffCharms', 'bone', bone='Weapon')
    cord = K.Part('StaffCords', 'rope', bone='Weapon')
    for j, a in enumerate((-50, 0, 50, 140)):
        th = math.radians(a)
        top = sp((0.1 * math.cos(th), 0.1 * math.sin(th), cz - 0.42))
        low = sp((0.16 * math.cos(th), 0.16 * math.sin(th), cz - 0.95 - 0.1 * (j % 2)))
        cord.tube([top, low], 0.012, sides=4)
        if j % 2 == 0:
            quill(f, low, low - top, 0.4, 0.05, sides=5)
        else:
            ch.sphere(low, (0.05, 0.05, 0.055), seg=8, rings=6)
            horn(ch, low, low + (low - top) * 0.1, low + (low - top) * 0.3, 0.025, n=5, sides=5)
    out += [_pair(f), _pair(ch), _pair(cord)]
    # the glowing eyes of the carved jaguar
    g = K.Part('StaffEyes', 'glow_eye', bone='Weapon')
    for s in (1, -1):
        g.sphere(sp((0.1 * s, -0.2, cz + 0.07)), (0.035, 0.03, 0.035), seg=8, rings=5)
    out.append(_pair(g))
    return out


# ------------------------------------------------------------------ the head
def build_face():
    out = []
    # tusks curling up out of the lower jaw
    t = K.Part('Tusks', 'tooth', bone='Jaw')
    for s in (1, -1):
        b = np.array((0.13 * s, -0.98, 4.56))
        horn(t, b, b + np.array((0.06 * s, -0.08, 0.14)), b + np.array((0.1 * s, -0.04, 0.3)), 0.042, n=8, sides=7)
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
    """The jaguar-skull mask: the great cat's upper jaw and brow worn over his head,
    its fangs hanging over his brow, red plumes fanned behind."""
    F = sdf.Field((-0.6, -1.45, 4.75), (0.6, 0.35, 5.6), 0.0075 * k)
    c = np.array((0.0, -0.5, 5.36))
    F.add(sdf.Ellipsoid(c, (0.36, 0.42, 0.18)), 0.05)                                     # the cranium cap
    F.add(sdf.Ellipsoid(c + np.array((0, -0.42, -0.06)), (0.24, 0.24, 0.12)), 0.05)        # the muzzle
    for s in (1, -1):
        F.add(sdf.Ellipsoid(c + np.array((0.28 * s, -0.3, 0.02)), (0.14, 0.2, 0.1)), 0.04)  # cheek arches
        F.sub(sdf.Sphere(c + np.array((0.16 * s, -0.42, 0.06)), 0.08), 0.015)                # eye sockets
        F.add(sdf.Ellipsoid(c + np.array((0.2 * s, 0.05, 0.13)), (0.1, 0.08, 0.06)), 0.03)  # brow knobs
    F.sub(sdf.Ellipsoid(c + np.array((0, -0.68, 0.02)), (0.07, 0.05, 0.05)), 0.015)        # the nasal hole
    # hollow underneath: it sits on the head
    F.sub(sdf.Ellipsoid(c + np.array((0, 0.05, -0.16)), (0.3, 0.38, 0.16)), 0.03)
    out = [_sculpt(F, 'JaguarMask', 'bone', 'Head', np.eye(4), 1500, workdir)]
    fangs = K.Part('MaskFangs', 'tooth', bone='Head')
    for s in (1, -1):
        b = c + np.array((0.13 * s, -0.64, -0.08))
        horn(fangs, b, b + np.array((0, -0.04, -0.08)), b + np.array((0.0, -0.02, -0.17)), 0.034, n=7, sides=6)
    out.append(_pair(fangs))
    plumes = K.Part('MaskPlumes', 'quill', bone='Plume')
    for i in range(7):
        u = i / 6 - 0.5
        a = math.pi * (0.5 + u * 0.9)
        d = np.array((math.cos(a), 0.9, math.sin(a) * 1.1))
        base = c + np.array((0, 0.28, 0.05)) + d * np.array((0.16, 0.0, 0.08))
        quill(plumes, base, d, 1.05 - 0.35 * abs(u), 0.1, bend=(0, 0.2, -0.3), sides=6)
    out.append(_pair(plumes))
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
    """A jaguar's lower jaw lashed over the left shoulder, its fangs up."""
    p = K.Part('ShoulderJaw', 'bone', bone='L_Clavicle')
    sh = A.SHOULDER + np.array((0.0, 0.0, 0.32))
    pts = [sh + np.array((-0.28, -0.22, -0.02)), sh + np.array((0.0, -0.3, 0.04)), sh + np.array((0.24, -0.06, 0.02)),
           sh + np.array((0.22, 0.22, -0.04))]
    p.tube(pts, [0.07, 0.08, 0.075, 0.06], sides=8)
    for u in (0.15, 0.35):
        b = A.lerp(pts[0], pts[1], u * 2) + np.array((0, 0, 0.05))
        horn(p, b, b + np.array((0, -0.02, 0.1)), b + np.array((0.02, 0.0, 0.22)), 0.035, n=6, sides=6)
    return [_pair(p)]


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
    """The bundle of carved stakes strapped across his back (rigid on Bundle), the
    straps over the chest copying the skin."""
    st = K.Part('Stakes', 'wood', bone='Bundle')
    caps = K.Part('StakeCaps', 'bone', bone='Bundle')
    for j, (dx, dy, h) in enumerate(((-0.18, 0.0, 1.5), (0.0, 0.08, 1.75), (0.18, 0.0, 1.4), (0.08, -0.08, 1.6))):
        b = np.array((dx, 0.66 + dy, 2.95))
        t = b + np.array((dx * 0.4, 0.06, h))
        st.tube([b, A.lerp(b, t, 0.5), t], [0.07, 0.075, 0.06], sides=7)
        caps.sphere(t + np.array((0, 0, 0.06)), (0.09, 0.09, 0.1), seg=8, rings=6)
        if j % 2 == 0:
            caps.torus(A.lerp(b, t, 0.3), (0, 0, 1), 0.08, 0.02, seg=10, sides=4)
    straps = K.Part('BundleStraps', 'rope', binding='transfer')
    for s in (1, -1):
        pts = [np.array((0.3 * s, 0.55, 4.05)), np.array((0.32 * s, 0.1, 4.12)), np.array((0.18 * s, -0.45, 3.7)),
               np.array((-0.22 * s, -0.5, 3.1)), np.array((-0.36 * s, 0.1, 2.9)), np.array((-0.2 * s, 0.55, 2.95))]
        straps.tube(pts, 0.035, sides=5)
    return [_pair(st), _pair(caps), _pair(straps)]


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    return (build_staff(workdir) + build_face() + build_mask(workdir) + build_necklace() + build_shoulder_jaw()
            + build_girdle() + build_wraps() + build_bundle())
