"""The Templeguard's hard dressing: the trident (sculpted in its own frame and set in
the right fist on the never-keyed Weapon bone), its thrown twin (the Thrown bone,
seen only in Hurl), the water trident that re-forms in the fist (Water), the
scallop shield (Shield, on the left forearm), the moon slits of the eyes, the
glowing pearls, the light that bursts out of it as it dies (Burst), the heap of
pearls and nacre shards it collapses into (Pearls), and the pearls and the moon
pendant at its gorget."""
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


def _sculpt(F, name, mat, bone, M, target, workdir, paint=None):
    hi = sdf.to_mesh(F, name + '_hi', bpy, workdir=workdir)
    if paint is not None:
        paint(hi)
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
    for nm in [a.name for a in lo.data.attributes if a.name.startswith('Reg')]:
        lo.data.attributes.remove(lo.data.attributes[nm])
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = 'rigid'
    return hi, lo


def build_tridents(workdir, k=1.0):
    F = A.build_trident(0.0055 * k)
    M = A.trident_matrix()
    held = _sculpt(F, 'Trident', 'trident', 'Weapon', M, 2000, workdir, paint=A.trident_paint)
    thrown = _sculpt(F, 'ThrownTrident', 'trident', 'Thrown', M, 1100, workdir, paint=A.trident_paint)
    return [held, thrown]


def _weapon_point(M, local):
    return (M @ np.array((*local, 1.0)))[:3]


def build_trident_pearls():
    """The moon pearl where the tines meet, on both tridents (flat glow)."""
    M = A.trident_matrix()
    out = []
    for name, bone in (('TridentPearl', 'Weapon'), ('ThrownPearl', 'Thrown')):
        p = K.Part(name, 'glow_pearl', bone=bone)
        c = _weapon_point(M, (0.0, -0.07, A.CRES_C - A.CRES_R + 0.08))
        p.sphere(c, (0.09, 0.09, 0.09), seg=14, rings=8)
        out.append(_pair(p))
    return out


def build_water():
    """The water trident that re-forms in the fist after the throw: a simplified
    trident of glowing water, scaled up from the grip on the Water bone."""
    M = A.trident_matrix()
    HB, HA, cz, R = A.HAFT_BELOW, A.HAFT_ABOVE, A.CRES_C, A.CRES_R
    p = K.Part('WaterTrident', 'glow_water', bone='Water')
    pt = lambda x, z: _weapon_point(M, (x, 0.0, z))  # noqa: E731
    p.tube([pt(0, -HB), pt(0, cz - R)], [0.08, 0.09], sides=8)
    arc = [pt(R * math.cos(math.pi + math.pi * i / 12), cz + R * math.sin(math.pi + math.pi * i / 12)) for i in range(13)]
    p.tube([pt(-R - 0.02, cz + 0.5)] + arc + [pt(R + 0.02, cz + 0.5)], 0.06, sides=7)
    p.tube([pt(0, cz - R), pt(0, HA)], [0.08, 0.014], sides=8)
    return [_pair(p)]


def build_shield(workdir, k=1.0):
    F = A.build_shield(0.0075 * k)
    M = A.shield_matrix()
    hi, lo = _sculpt(F, 'Shield', 'shell', 'Shield', M, 2000, workdir, paint=A.shield_paint)
    # the boss: a silver crescent and a pearl at the shield's heart
    c_loc = np.array((0.0, -0.05, 0.27))
    sil = K.Part('ShieldBoss', 'silver', bone='Shield')
    R3 = A.SH_FRAME
    pts, rad = [], []
    for i in range(17):
        a = math.radians(200 + 140 * i / 16)
        q = c_loc + np.array((0.2 * math.cos(a), 0.2 * math.sin(a) + 0.02, 0.0))
        pts.append(A.SH_C + R3 @ q)
        kk = math.sin(math.pi * i / 16)
        rad.append(0.015 + 0.04 * kk)
    sil.tube(pts, rad, sides=8, up=tuple(A.SH_N))
    pe = K.Part('ShieldPearl', 'pearl', bone='Shield')
    pe.sphere(A.SH_C + R3 @ (c_loc + np.array((0, 0.06, 0.02))), (0.075, 0.075, 0.075), seg=14, rings=8)
    return [(hi, lo), _pair(sil), _pair(pe)]


def build_eyes():
    """Moonlight slits, no pupil: each a thin glowing blade set in the socket."""
    out = []
    p = K.Part('EyeGlow', 'glow_eye', bone='Eyes')
    for s in (1, -1):
        c = A.EYE * np.array((s, 1, 1)) + np.array((-0.006 * s, 0, 0))
        R = sdf.rot_matrix(rx=0.25)
        p.sphere(c, (0.02, 0.09, 0.02), rot=R, seg=10, rings=6)
    out.append(_pair(p))
    return out


def build_burst():
    """The light escaping as it dies: rays and a core, scaled from nothing on Burst."""
    c = np.array((0.0, -0.3, 3.5))
    p = K.Part('DeathBurst', 'glow_burst', bone='Burst')
    rng = np.random.default_rng(7)
    for i in range(18):
        d = rng.normal(0, 1, 3)
        d[1] = -abs(d[1]) * 0.5 - 0.2
        d /= np.linalg.norm(d)
        L_ = rng.uniform(0.55, 1.1)
        p.tube([c + d * 0.12, c + d * L_ * 0.5, c + d * L_], [0.075, 0.04, 0.003], sides=5)
    p.sphere(c, (0.26, 0.26, 0.26), seg=14, rings=9)
    p.torus(c, (0, 1, 0), 0.62, 0.025, seg=36, sides=6)
    return [_pair(p)]


def build_heap():
    """What is left of it: pearls spilt round its fall and broken nacre shards."""
    rng = np.random.default_rng(11)
    pearls = K.Part('HeapPearls', 'pearl', bone='Pearls')
    shards = K.Part('HeapShards', 'shell', bone='Pearls')
    c0 = A.PEARLS_AT
    for i in range(20):
        a = rng.uniform(0, math.tau)
        r = 0.25 + 0.95 * math.sqrt(rng.uniform(0, 1))
        rr = rng.uniform(0.04, 0.075)
        p = c0 + np.array((math.cos(a) * r * 1.2, math.sin(a) * r * 0.8, rr * 0.9))
        pearls.sphere(p, (rr, rr, rr), seg=7, rings=5)
    for i in range(7):
        a = rng.uniform(0, math.tau)
        r = 0.3 + 0.8 * rng.uniform(0, 1)
        p = c0 + np.array((math.cos(a) * r * 1.2, math.sin(a) * r * 0.8, 0.03))
        R = sdf.rot_matrix(rx=rng.uniform(-0.3, 0.3), ry=rng.uniform(-0.3, 0.3), rz=rng.uniform(0, 3))
        shards.box(p, (rng.uniform(0.1, 0.18), rng.uniform(0.07, 0.12), 0.02), rot=R)
    return [_pair(pearls), _pair(shards)]


def build_gorget_jewels():
    """Pearls round the gorget's lower rim and a silver crescent pendant at the throat."""
    pearls = K.Part('GorgetPearls', 'pearl', bone='Spine2')
    for i in range(15):
        a = math.radians(-80 + 160 * i / 14)
        p = np.array((0.52 * math.sin(a), -0.47 * math.cos(a) + 0.02, 3.88 - 0.05 * math.cos(a)))
        pearls.sphere(p, (0.035, 0.035, 0.035), seg=6, rings=4)
    sil = K.Part('MoonPendant', 'silver', bone='Spine2')
    c = np.array((0.0, -0.6, 3.72))
    pts, rad = [], []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        pts.append(c + np.array((0.1 * math.cos(a), 0.0, 0.1 * math.sin(a))))
        rad.append(0.01 + 0.022 * math.sin(math.pi * i / 12))
    sil.tube(pts, rad, sides=7, up=(0, -1, 0))
    return [_pair(pearls), _pair(sil)]


def build(sculpts):
    workdir = os.path.join(os.getcwd(), '_work')
    os.makedirs(workdir, exist_ok=True)
    return (build_tridents(workdir) + build_trident_pearls() + build_water() + build_shield(workdir) + build_eyes()
            + build_burst() + build_heap() + build_gorget_jewels())
