"""Lagoon Snapper: skeleton and sculpts (rest pose), in yards.

A giant nautilus the moon-water made sacred: a great spiral shell standing
like a wheel, striped in turquoise and white like a tiger's coat, its
aperture rimmed with pure nacre that glows, silver crescent medallions with
pearls set in its navel on both sides and small carved moons along its
keel. From the aperture the animal looks out: a thick fleshy hood above, a
great lidless eye on each side, and a crown of dozens of tentacles it drags
itself with, around a curved parrot beak of blue-black bone.

Axes: yards, +Z up, faces -Y, its left is +X. The shell's crown about 2.15 up.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import Ellipsoid, Field, Noise, RoundCone, Sphere

NAME = 'LagoonSnapper'
PREFIX = 'snapper'

# the shell: a logarithmic spiral in the side (y, z) plane, growing three times a turn
B_GROW = math.log(3.0) / (2 * math.pi)
THETA_END = math.radians(290.0)        # the aperture (0 = front, 90 = up, 180 = back)
SHELL_C = np.array((0.0, 0.32, 1.37))
HR, HX = 0.45, 0.56                    # the whorl's radial and lateral half sizes over its radius


def whorl_r(theta):
    return np.exp(B_GROW * (theta - THETA_END))


def spiral_point(theta, rho=None):
    r = whorl_r(theta) if rho is None else rho
    return SHELL_C + np.array((0.0, -r * math.cos(theta), r * math.sin(theta)))


AP = spiral_point(THETA_END)            # the aperture's centre
HEAD = (np.array((0.0, -0.02, 0.48)), np.array((0.0, -0.36, 0.5)))
HOOD = (np.array((0.0, 0.05, 0.86)), np.array((0.0, -0.42, 0.9)))
BEAK = (np.array((0.0, -0.34, 0.42)), np.array((0.0, -0.62, 0.36)))
EYE = np.array((0.4, -0.2, 0.62))
N_BUNDLE = 8
BAKE_CAGE, BAKE_RAY = 0.025, 0.08


def bundle_points(i):
    """A tentacle bundle's rest path: from a ring round the beak, forward and
    down to the floor (the lower ones drag on it, the upper reach forward)."""
    a = 2 * math.pi * (i + 0.5) / N_BUNDLE
    up = math.sin(a)                     # + upper, - lower
    side = math.cos(a)
    root = np.array((0.24 * side, -0.32, 0.46 + 0.2 * up))
    p1 = root + np.array((0.32 * side, -0.38, -0.05 + 0.08 * up))
    p2 = p1 + np.array((0.3 * side, -0.36, -0.22 + 0.06 * up))
    p3 = p2 + np.array((0.22 * side, -0.32, -0.12))
    p2[2] = max(p2[2], 0.08)
    p3[2] = max(p3[2] - 0.15 * (1 - up), 0.04)
    return [root, p1, p2, p3]


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.5)),
        ('Body', 'Root', tuple(SHELL_C), tuple(SHELL_C + np.array((0, 0, 0.5)))),
        ('Shell', 'Body', tuple(SHELL_C), tuple(SHELL_C + np.array((0, 0, 0.6)))),
        ('Head', 'Body', tuple(HEAD[0]), tuple(HEAD[1])),
        ('Hood', 'Head', tuple(HOOD[0]), tuple(HOOD[1])),
        ('Beak', 'Head', tuple(BEAK[0]), tuple(BEAK[1])),
    ]
    for i in range(N_BUNDLE):
        pts = bundle_points(i)
        prev = 'Head'
        for j in range(3):
            out.append((f'Tent{i}_{j + 1}', prev, tuple(pts[j]), tuple(pts[j + 1])))
            prev = f'Tent{i}_{j + 1}'
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
GROUND = 0.03
FEET = ()
FREE_END = ('Death',)
COLLIDE_LEGS = {}
POP_SKIP = ('Tent',)
TREMOR_KEYS = ('Head', 'Hood', 'Beak')
AIM_LIMITS = {}
HIDDEN = {}
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
BUNDLES = [[f'Tent{i}_{j}' for j in (1, 2, 3)] for i in range(N_BUNDLE)]


def hand_frame(side=1):
    raise NotImplementedError


def _chains():
    from rig import Chain
    return [Chain(ch, 'Head', gravity=0.25, stiff=0.2, damp=0.18, drag=1.2) for ch in BUNDLES]


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


def _shell_polar(Xg, Yg, Zg):
    u = -(Yg - SHELL_C[1])
    v = Zg - SHELL_C[2]
    rho = np.sqrt(u * u + v * v)
    phi = np.mod(np.arctan2(v, u), 2 * math.pi)
    return rho, phi, Xg - SHELL_C[0]


# ------------------------------------------------------------------ the shell
def build_shell(voxel):
    """The spiral: the visible outer whorl and the turn inside it, each a tube
    whose cross-section grows with it; hollow at the aperture, its lip a
    thickened rim."""
    G, Xg, Yg, Zg = X.grid((-0.75, -1.15, -0.05), (0.75, 1.75, 2.25), voxel)
    rho, phi, x = _shell_polar(Xg, Yg, Zg)
    d = np.full(Xg.shape, 9.0, dtype=np.float64)
    hollow = np.full(Xg.shape, 9.0, dtype=np.float64)
    for k in (-2, -1, 0):
        th = phi + 2 * math.pi * k
        th = np.where(th > THETA_END, th - 2 * math.pi, th)
        if k != 0:
            th = phi + 2 * math.pi * k
        Rc = whorl_r(th)
        hr, hx = HR * Rc, HX * Rc
        # the whorl swells outward (a rounder back than belly)
        e = np.sqrt(((rho - Rc) / hr) ** 2 + (x / hx) ** 2)
        dk = (e - 1.0) * np.minimum(hr, hx)
        live = th <= THETA_END
        dk = np.where(live, dk, 9.0)
        d = np.minimum(d, dk)
        if k == 0:
            ei = np.sqrt(((rho - Rc) / (hr - 0.07)) ** 2 + (x / (hx - 0.07)) ** 2)
            hollow = np.where(live & (th > THETA_END - 0.9), (ei - 1.0) * np.minimum(hr, hx), 9.0)
    d = np.maximum(d, -hollow)
    G.d = d.astype(np.float32)
    # the aperture's lip: a thick rolled rim
    pts = []
    Rc = float(whorl_r(THETA_END))
    for i in range(33):
        a = 2 * math.pi * i / 32
        r = Rc + HR * Rc * math.cos(a) * 0.98
        q = spiral_point(THETA_END, r) + np.array((HX * Rc * math.sin(a) * 0.98, 0.0, 0.0))
        pts.append(q)
    G.add(sdf.Polyline(pts, [0.045] * len(pts)), 0.03, weight=False)
    # growth lines across the whorl, faint
    noise = Noise(5)
    G.displace(lambda X_, Y_, Z_: 0.003 * noise.fbm(X_ * 6, Y_ * 6, Z_ * 6, octaves=3)
               + 0.0012 * np.sin(_shell_polar(X_, Y_, Z_)[1] * 60), band=0.04)
    return G


def shell_paint(obj):
    """RegStripe (the tiger stripes, from the navel out, fading toward the
    aperture), RegRim (the nacre lip and the inside of the aperture),
    RegGlyph (carved moons along the keel), RegIn."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    rho, phi, x = _shell_polar(P[:, 0], P[:, 1], P[:, 2])
    th = np.where(phi > THETA_END, phi - 2 * math.pi, phi)
    Rc = whorl_r(th)
    # stripes: wavy radial bands, older shell only
    wav = phi * 9 + 2.2 * np.sin(rho * 3.0) + 0.6 * np.sin(x * 6)
    stripe = np.clip((np.sin(wav) - 0.1) / 0.3, 0, 1) * np.clip((THETA_END - 0.9 - th) / 1.4, 0, 1)
    rim = np.clip((th - (THETA_END - 0.25)) / 0.15, 0, 1)
    ei = np.sqrt(((rho - Rc) / (HR * Rc)) ** 2 + (x / (HX * Rc)) ** 2)
    inside = ((ei < 0.9) & (th > THETA_END - 0.9)).astype(float)
    glyph = np.zeros(len(P))
    for k in range(6):
        tk = THETA_END - 0.6 - k * 0.75
        c = spiral_point(tk, float(whorl_r(tk) * (1 + HR * 0.96)))
        dd = np.linalg.norm(P - c, axis=1) / (0.1 * float(whorl_r(tk)) + 0.04)
        c2 = c + np.array((0, 0.0, 0.0))
        dv = (P - c2)
        r1 = np.sqrt(dv[:, 0] ** 2 + dv[:, 1] ** 2 + dv[:, 2] ** 2) / (0.12 * float(whorl_r(tk)) + 0.05)
        cres = np.clip((1 - dd) / 0.2, 0, 1) * np.clip((r1 * 1.0 - 0.0), 0, 1)
        glyph = np.maximum(glyph, cres * np.clip(1 - np.abs(x) / 0.06, 0, 1))
    _write(obj, {'RegStripe': stripe, 'RegRim': np.maximum(rim, inside), 'RegGlyph': glyph, 'RegIn': inside})


# ------------------------------------------------------------------ the animal: hood, flesh, beak
def build_flesh(voxel):
    F = Field((-0.75, -0.95, -0.05), (0.75, 0.6, 1.25), voxel)
    noise = Noise(13)
    F.add(Ellipsoid((0, -0.02, 0.5), (0.5, 0.34, 0.4), bone='Head'), 0.1)
    # the hood: a thick fleshy cap lapping over the aperture's top
    F.add(Ellipsoid((0, -0.14, 0.86), (0.52, 0.42, 0.2), bone='Hood'), 0.1)
    F.add(Ellipsoid((0, -0.42, 0.82), (0.36, 0.14, 0.15), bone='Hood'), 0.08)
    # the eye sockets' swellings
    for s in (1, -1):
        F.add(Ellipsoid((s * EYE[0], EYE[1] + 0.04, EYE[2]), (0.15, 0.16, 0.16), bone='Head'), 0.06)
        F.sub(Sphere((s * (EYE[0] + 0.02), EYE[1], EYE[2]), 0.11), 0.03)
    # the crown's base: a ring of tentacle roots round the beak
    for i in range(N_BUNDLE):
        root = bundle_points(i)[0]
        F.add(Sphere(root, 0.1, bone='Head'), 0.06)
    F.displace(lambda X_, Y_, Z_: 0.012 * noise.ridged(X_ * 7, Y_ * 7, Z_ * 7, octaves=2), band=0.05)
    return F


def flesh_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    hood = np.clip((P[:, 2] - 0.72) / 0.1, 0, 1)
    _write(obj, {'RegHood': hood})


def build_beak(voxel):
    """The parrot beak: a hooked upper mandible over a shorter lower one."""
    c = BEAK[0]
    F = Field(c - 0.4, c + 0.4, voxel)
    up = [c + np.array((0, 0.02, 0.06)), c + np.array((0, -0.16, 0.06)), c + np.array((0, -0.27, -0.02)),
          c + np.array((0, -0.25, -0.12))]
    F.add(sdf.Polyline(up, [0.09, 0.075, 0.045, 0.012]), 0.03)
    lo = [c + np.array((0, 0.0, -0.06)), c + np.array((0, -0.14, -0.08)), c + np.array((0, -0.2, -0.04))]
    F.add(sdf.Polyline(lo, [0.08, 0.055, 0.018]), 0.03)
    F.sub(Ellipsoid(c + np.array((0, -0.14, -0.02)), (0.05, 0.06, 0.02)), 0.01)
    return F


def build_eye(side, voxel):
    c = np.array((side * (EYE[0] + 0.02), EYE[1], EYE[2]))
    F = Field(c - 0.2, c + 0.2, voxel)
    F.add(Ellipsoid(c, (0.1, 0.11, 0.11)), 0.02)
    return F


def eye_paint(side):
    def paint(obj):
        from rig import mesh_arrays
        P, _ = mesh_arrays(obj)
        c = np.array((side * (EYE[0] + 0.02), EYE[1], EYE[2]))
        d = P - c
        out = d[:, 0] * side
        # a horizontal slit of light across the dark lens, a glowing ring round it
        slit = np.clip(1 - np.abs(d[:, 2]) / 0.016, 0, 1) * np.clip(1 - np.abs(d[:, 1]) / 0.07, 0, 1) * (out > 0.04)
        ring = np.clip(1 - np.abs(np.sqrt(d[:, 1] ** 2 + d[:, 2] ** 2) - 0.085) / 0.012, 0, 1) * (out > 0.0)
        _write(obj, {'RegSlit': slit, 'RegRing': ring})
    return paint


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    S = [Sculpt('Flesh', build_flesh(0.012 * k), 'flesh', 5200, tau=0.06, paint=flesh_paint),
         Sculpt('Shell', build_shell(0.014 * k), 'shell', 9000, binding='rigid', bone='Shell', paint=shell_paint),
         Sculpt('Beak', build_beak(0.007 * k), 'beak', 1200, binding='rigid', bone='Beak')]
    for s, side in ((1, 'L'), (-1, 'R')):
        S.append(Sculpt(f'{side}_Eye', build_eye(s, 0.006 * k), 'eye', 700, binding='rigid', bone='Head',
                        paint=eye_paint(s)))
    return S


_ = RoundCone
