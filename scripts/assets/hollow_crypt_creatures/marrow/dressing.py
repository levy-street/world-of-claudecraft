"""Sexton Marrow's hard dressing: the long spade (sculpted in its own frame and set
in the right fist on the never-keyed Weapon bone), the earth crusted on its blade,
the shovelful of grave dirt it carries (its own Dirt bone, shown by a keyed
scale), the same spade planted in the yard while he rings the bell (SpadeStuck,
under Root, shown by a keyed scale), the hooded tin lantern on its spring bone at
the hip, and the soul light deep in the sockets (on the Eyes bone)."""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix

import anatomy as A
import mesh_kit as K
import sdf
import sdf_ext as X
from sdf import Ellipsoid, Field, Noise, Polyline, RoundBox, RoundCone, Sphere, Torus


def _workdir():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    d = argv[argv.index('--work') + 1] if '--work' in argv else os.path.join(os.getcwd(), '_work')
    os.makedirs(d, exist_ok=True)
    return d


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
    if M is not None:
        hi.data.transform(Matrix(M.tolist()))
    for p in hi.data.polygons:
        p.use_smooth = True
    lo = _decimate_pair(hi, name, target)
    for o in (hi, lo):
        o['mat'] = mat
        o['bone'] = bone
        o['binding'] = 'rigid'
    return hi, lo


# ------------------------------------------------------------------ the spade (local frame: +Z from the fist to the blade)
def spade_matrix():
    """The spade's frame in the right fist: +Z down the haft to the blade, +Y the
    blade's hollow face (the palm's side, turned BLADE_ROLL about the haft)."""
    ax = np.array(A.WEAPON_AXIS)
    w, down, width, palm = A.HAND.frame(-1)
    edge = A.unit(np.cross(palm, ax))
    flat = A.unit(np.cross(ax, edge))
    r = math.radians(A.BLADE_ROLL)
    y = flat * math.cos(r) + edge * math.sin(r)
    x = np.cross(y, ax)             # a proper (right-handed) frame: a mirrored one turns the normals inside out
    M = np.eye(4)
    M[:3, 0] = x
    M[:3, 1] = y
    M[:3, 2] = ax
    M[:3, 3] = A.GRIP_R
    return M


def stuck_matrix():
    """The planted spade: the blade's tip at STUCK_TIP, the haft up STUCK_DIR."""
    z = -np.array(A.STUCK_DIR)
    origin = A.STUCK_TIP - z * (A.SOCKET + A.BLADE_LEN)
    R_ = A.frame_xz(z, (0.6, -0.8, 0.0))
    M = np.eye(4)
    M[:3, :3] = R_
    M[:3, 3] = origin
    return M


_CYL_R = 0.9          # the blade's dish: a slice of a cylinder this wide, hollow toward +Y


def _blade_y(x):
    return _CYL_R - math.sqrt(_CYL_R * _CYL_R - x * x)


def _outline():
    S0, L_ = A.SOCKET, A.BLADE_LEN
    return X.Inter(RoundBox((0, 0, S0 + L_ / 2), (A.BLADE_HALF, 0.4, L_ / 2), radius=0.0),
                   Ellipsoid((0, 0, S0 + 0.24), (0.4, 2.0, 0.8)), 0.0)


def build_spade(voxel):
    """An ash haft gone grey, a T-grip, a twine wrap where the top hand works, the
    iron straps riveted up from the socket, and the broad dished iron blade with
    its trodden lip, its edge nicked and worn bright."""
    S0, L_, T = A.SOCKET, A.BLADE_LEN, A.HAFT_TOP
    F = Field((-0.45, -0.22, -T - 0.14), (0.45, 0.32, S0 + L_ + 0.06), voxel)
    noise = Noise(3)
    F.add(RoundCone((0, 0, -T), (0, 0, S0 + 0.04), A.HAFT_R, A.HAFT_R * 0.93), 0.01)
    F.add(RoundCone((-0.2, 0, -T - 0.04), (0.2, 0, -T - 0.04), 0.05, 0.05), 0.03)         # the T-grip
    F.add(Sphere((0, 0, -T - 0.04), 0.07), 0.02)
    for z in (-T + 0.1, -T + 0.16):
        F.add(Torus((0, 0, z), (0, 0, 1), A.HAFT_R + 0.003, 0.011), 0.004)                 # iron ferrule bands
    for k in range(9):                                                                     # the twine wrap
        z = -1.18 + k * 0.035
        F.add(Torus((0, 0, z), (0, 0.06 * math.sin(k), 1), A.HAFT_R + 0.002, 0.01), 0.003)
    F.groove(Polyline([(0.057, -0.02, -0.7), (0.06, -0.01, -0.3), (0.058, 0.0, 0.2)], 0.002), 0.007, k=0.007)
    # the socket and the straps
    F.add(RoundCone((0, 0, S0 - 0.12), (0, 0, S0 + 0.08), A.HAFT_R + 0.01, A.HAFT_R + 0.024), 0.01)
    for sy in (1, -1):
        F.add(RoundBox((0, (A.HAFT_R - 0.002) * sy, S0 - 0.3), (0.027, 0.009, 0.25), radius=0.004), 0.008)
        for z in (S0 - 0.48, S0 - 0.3, S0 - 0.12):
            F.add(Sphere((0, (A.HAFT_R + 0.009) * sy, z), 0.014), 0.003)
    # the blade: a dished slab inside the outline, the trodden lip, the frog on the back
    shell = X.Shell(RoundCone((0, _CYL_R, S0 - 0.6), (0, _CYL_R, S0 + L_ + 0.6), _CYL_R, _CYL_R), 0.03)
    F.add(X.Inter(shell, _outline(), 0.0), 0.006)
    lip = [(x, _blade_y(x) - 0.004, S0 + 0.015) for x in np.linspace(-A.BLADE_HALF + 0.01, A.BLADE_HALF - 0.01, 9)]
    F.add(Polyline(lip, 0.022), 0.01)
    F.add(RoundBox((0, -0.022, S0 + 0.16), (0.06, 0.016, 0.17), radius=0.01), 0.012)
    rng = np.random.default_rng(9)
    for k in range(7):                                                                     # nicks in the edge
        a = rng.uniform(-1.2, 1.2)
        x = 0.38 * math.sin(a)
        z = S0 + 0.24 + 0.78 * math.cos(a) * 0.98
        F.sub(Sphere((x, _blade_y(x), z), rng.uniform(0.012, 0.024)), 0.004)
    F.displace(lambda X_, Y_, Z_: 0.002 * noise.fbm(X_ * 30, Y_ * 30, Z_ * 30, octaves=2), band=0.03)
    return F


def build_crust(voxel):
    """Grave earth caked on the blade's lower half, both faces, thickest in the dish."""
    S0, L_ = A.SOCKET, A.BLADE_LEN
    F = Field((-0.45, -0.16, S0 - 0.05), (0.45, 0.28, S0 + L_ + 0.06), voxel)
    rng = np.random.default_rng(21)
    outline = _outline()
    n = 0
    tries = 0
    while n < 40 and tries < 600:
        tries += 1
        x = rng.uniform(-0.34, 0.34)
        z = S0 + rng.uniform(0.22, L_ - 0.02)
        if float(outline.dist(np.array([x]), np.array([0.0]), np.array([z]))[0]) > -0.01:
            continue
        face = 1 if rng.random() < 0.65 else -1
        y = _blade_y(x) + face * 0.02
        r = rng.uniform(0.04, 0.08)
        F.add(Ellipsoid((x, y, z), (r, r * 0.25, r * rng.uniform(0.8, 1.4))), 0.025)
        n += 1
    noise = Noise(12)
    F.displace(lambda X_, Y_, Z_: 0.006 * noise.fbm(X_ * 20, Y_ * 20, Z_ * 20, octaves=2), band=0.04)
    # keep it on the blade (never past the outline)
    F.intersect(X.Inter(outline, RoundBox((0, 0.05, S0 + L_ / 2), (0.45, 0.2, L_ / 2 + 0.02), radius=0.0)), 0.006)
    return F


def build_load(voxel):
    """The shovelful: a heaped mound of dark grave earth on the dish, clods and a
    knuckle bone in it (shown only while he carries it)."""
    S0 = A.SOCKET
    c = np.array((0.0, _blade_y(0.0) + 0.05, A.DIRT_AT))
    F = Field(c - np.array((0.38, 0.12, 0.42)), c + np.array((0.38, 0.3, 0.42)), voxel)
    F.add(Ellipsoid(c + np.array((0, 0.05, 0)), (0.27, 0.12, 0.32)), 0.04)
    rng = np.random.default_rng(14)
    for _ in range(14):
        p = c + np.array((rng.uniform(-0.18, 0.18), rng.uniform(0.04, 0.12), rng.uniform(-0.22, 0.22)))
        r = rng.uniform(0.03, 0.06)
        F.add(Ellipsoid(p, (r, r * 0.8, r)), 0.02)
    F.add(RoundCone(c + np.array((-0.08, 0.12, -0.05)), c + np.array((0.06, 0.13, 0.08)), 0.018, 0.015), 0.01)
    F.add(Sphere(c + np.array((0.065, 0.13, 0.085)), 0.025), 0.008)
    noise = Noise(15)
    F.displace(lambda X_, Y_, Z_: 0.01 * noise.fbm(X_ * 14, Y_ * 14, Z_ * 14, octaves=3), band=0.05)
    # flat underneath, where it sits in the dish
    F.intersect(X.Plane((0, _blade_y(0.0) + 0.01, 0), (0, -1, 0), lo=c - 1, hi=c + 1), 0.01)
    return F


def build_spades(workdir, k=1.0):
    M = spade_matrix()
    v = 0.0045 * k
    Fs, Fc = build_spade(v), build_crust(v * 1.2)
    out = [_rigid_pair(Fs, 'Spade', M, 'spade', 'Weapon', 3600, workdir),
           _rigid_pair(Fc, 'SpadeCrust', M, 'dirt', 'Weapon', 700, workdir),
           _rigid_pair(build_load(v * 1.3), 'SpadeLoad', M, 'dirt', 'Dirt', 650, workdir)]
    Ms = stuck_matrix()
    out.append(_rigid_pair(Fs, 'StuckSpade', Ms, 'stuck', 'SpadeStuck', 2200, workdir))
    out.append(_rigid_pair(Fc, 'StuckCrust', Ms, 'dirt', 'SpadeStuck', 450, workdir))
    return out


# ------------------------------------------------------------------ the hooded lantern
def build_lantern(workdir, k=1.0):
    """A tin lantern: a round punched-tin body with three horn windows, a conical
    hood with a broad brim pulled down over it, a vented crown and a ring on the
    S-hook; the tallow glow inside shows through the windows and the punched stars.
    Drawn at LS times a hand lantern, so it reads at the hip of a giant."""
    c = A.LANTERN_C
    LS = 1.32

    def q(v):
        return c + np.array(v, float) * LS

    F = Field(q((-0.26, -0.26, -0.26)), q((0.26, 0.26, 0.5)), 0.0045 * k)
    body = X.Shell(RoundCone(q((0, 0, -0.16)), q((0, 0, 0.15)), 0.13 * LS, 0.13 * LS), 0.016)
    F.add(X.Inter(body, RoundBox(c, (0.3 * LS, 0.3 * LS, 0.16 * LS), radius=0.0), 0.0), 0.004)
    for j in range(3):                                                       # the horn windows
        a = math.tau * j / 3 - math.pi / 2
        p = q((0.13 * math.cos(a), 0.13 * math.sin(a), -0.01))
        F.sub(RoundBox(p, (0.06 * LS, 0.06 * LS, 0.09 * LS), A.frame_xz((0, 0, 1), (-math.sin(a), math.cos(a), 0)),
                       radius=0.014), 0.004)
    for j in range(3):                                                       # punched stars on the tin between them
        a = math.tau * (j + 0.5) / 3 - math.pi / 2
        for dz in (-0.07, -0.02, 0.03, 0.08):
            for da in (-0.18, 0.18) if dz in (-0.02, 0.08) else (0.0,):
                p = q((0.135 * math.cos(a + da), 0.135 * math.sin(a + da), dz))
                F.sub(Sphere(p, 0.017), 0.002)
    F.add(Torus(q((0, 0, -0.16)), (0, 0, 1), 0.135 * LS, 0.017), 0.004)                     # the foot ring
    F.add(RoundCone(q((0, 0, -0.18)), q((0, 0, -0.16)), 0.12 * LS, 0.13 * LS), 0.004)
    F.add(Torus(q((0, 0, 0.15)), (0, 0, 1), 0.135 * LS, 0.015), 0.004)
    hood = X.Shell(RoundCone(q((0, 0, 0.13)), q((0, 0, 0.33)), 0.2 * LS, 0.035 * LS), 0.02)
    F.add(X.Inter(hood, RoundBox(q((0, 0, 0.25)), (0.3 * LS, 0.3 * LS, 0.12 * LS), radius=0.0), 0.0), 0.004)
    F.add(Torus(q((0, 0, 0.135)), (0, 0, 1), 0.198 * LS, 0.015), 0.004)                    # the brim's rolled edge
    F.add(RoundCone(q((0, 0, 0.32)), q((0, 0, 0.39)), 0.04 * LS, 0.03 * LS), 0.006)          # vented crown
    F.add(Torus(q((0, 0, 0.44)), (0, 1, 0), 0.05 * LS, 0.014), 0.004)                      # the ring
    out = [_rigid_pair(F, 'Lantern', None, 'tin', 'Lantern', 1500, workdir)]
    g = K.Part('LanternGlow', 'glow_lantern', bone='Lantern')
    g.tube([tuple(q((0, 0, -0.15))), tuple(q((0, 0, 0.13)))], [0.115 * LS, 0.115 * LS], sides=12)
    go = g.to_object()
    out.append((K.duplicate(go, go.name + '_hi'), go))
    return out


def build_eyes():
    p = K.Part('EyeGlow', 'glow_eye', bone='Eyes')
    for s in (1, -1):
        cc = A.EYE * np.array((s, 1, 1))
        p.sphere(tuple(cc), (A.EYE_R, A.EYE_R * 0.8, A.EYE_R * 1.05), seg=10, rings=6)
    o = p.to_object()
    return [(K.duplicate(o, o.name + '_hi'), o)]


def build(sculpts):
    workdir = _workdir()
    k = getattr(A, 'VOXEL_K', 1.0)
    return build_spades(workdir, k) + build_lantern(workdir, k) + build_eyes()
