"""The Tide Pilgrim (mob id drowned_pilgrim): skeleton and sculpts (rest pose), in yards.

A giant sacred sea snail of the moon-and-tide temple: a broad, wet foot with a
scalloped mantle skirt, a conch's head (two stalked moon eyes, two feelers and a
striking proboscis), a snorkel siphon, and a heavy turban shell of carved nacre:
spiral cords, a crown of knobs on every shoulder, and on the body whorl a band of
carved plates, each with a glowing moon glyph. The spire is cut flat and carries
a small round shrine (columns, a ribbed dome, a silver crescent finial) where a
moon pearl burns; strands of pearls hang from it down the whorls.

Axes: yards, +Z up, faces -Y, its left is +X. GS scales the whole design.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import BIG, Ellipsoid, Field, Noise, RoundBox, RoundCone, Sphere, Torus, smax, smin

NAME = 'TidePilgrim'
PREFIX = 'pilgrim'
GS = 1.15            # global scale of the design (tuned against the 2.6 yd knight)


def g(*v):
    return np.array(v, dtype=float) * GS


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def lerp(a, b, t):
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


# ------------------------------------------------------------------ the shell's geometry
# A helicoid snail shell carried on the back: the coil's axis points to the
# snail's left, up and a little back, so the spiral reads from its left side
# and from behind, and the spire rises up and out where the shrine stands.
SHELL_AXIS = unit((0.86, 0.22, 0.46))
_down = np.array((0.0, -0.6, -1.0))
SE1 = unit(_down - SHELL_AXIS * float(_down @ SHELL_AXIS))
SE2 = np.cross(SHELL_AXIS, SE1)
R0, RHO0, Q = 0.78 * GS, 0.64 * GS, 0.64   # spiral radius, tube radius, shrink per turn
HC = 0.5 * GS / (1 - Q)                   # the axial climb (0.5 over the first whorl)
TMAX = 3.4                                # the spire is cut flat here (the shrine)
PHI0 = 0.0                                # the aperture (t = 0) sits low and in front
APERTURE = g(-0.3, -0.02, 0.68)            # where the body enters the shell
SHELL_BASE = APERTURE - SE1 * R0          # the axis passes here at the aperture whorl


def _centre_shell():
    global SHELL_BASE
    ts = np.linspace(0, TMAX, 200)
    pts = np.array([spiral_point(t) for t in ts])
    w = np.array([spiral(t)[2] ** 2 for t in ts])
    mx = float((pts[:, 0] * w).sum() / w.sum())
    SHELL_BASE = SHELL_BASE - np.array((mx - 0.04 * GS, 0.0, 0.0))


def spiral(t):
    """Centre radius, axial height and tube radius of whorl position t (turns)."""
    s = Q ** t
    return R0 * s, HC * (1 - s), RHO0 * s


def spiral_point(t, psi=None, off=0.0):
    """World point of the whorl centre at t (or of its surface at tube angle psi,
    psi 0 = outward, +pi/2 = toward the apex)."""
    R, H, rho = spiral(t)
    ang = PHI0 - 2 * math.pi * t
    radial = math.cos(ang) * SE1 + math.sin(ang) * SE2
    c = SHELL_BASE + radial * R + SHELL_AXIS * H
    if psi is None:
        return c
    return c + (radial * math.cos(psi) + SHELL_AXIS * math.sin(psi)) * (rho + off)


_centre_shell()


def shell_coords(X_, Y_, Z_):
    """(distance to the whorl tube, t, psi, rho) of points, by testing the whorls that
    cross the point's meridian on both sides of the axis."""
    px, py, pz = X_ - SHELL_BASE[0], Y_ - SHELL_BASE[1], Z_ - SHELL_BASE[2]
    u = px * SE1[0] + py * SE1[1] + pz * SE1[2]
    v = px * SE2[0] + py * SE2[1] + pz * SE2[2]
    h = px * SHELL_AXIS[0] + py * SHELL_AXIS[1] + pz * SHELL_AXIS[2]
    r = np.sqrt(u * u + v * v)
    ang = np.arctan2(v, u)
    best = np.full(np.shape(X_), BIG)
    bt = np.zeros(np.shape(X_))
    bpsi = np.zeros(np.shape(X_))
    brho = np.ones(np.shape(X_))
    for side in (1.0, -1.0):
        a = ang if side > 0 else ang + math.pi
        t0 = np.mod((PHI0 - a) / (2 * math.pi), 1.0)
        rs = r * side
        for k in range(int(math.ceil(TMAX)) + 1):
            t = t0 + k
            ok = t <= TMAX
            s = Q ** t
            R, H, rho = R0 * s, HC * (1 - s), RHO0 * s
            dr, dh = rs - R, h - H
            d = np.sqrt(dr * dr + dh * dh) - rho
            d = np.where(ok, d, BIG)
            m = d < best
            best = np.where(m, d, best)
            bt = np.where(m, t, bt)
            bpsi = np.where(m, np.arctan2(dh, dr), bpsi)
            brho = np.where(m, rho, brho)
    return best, bt, bpsi, brho


class SpiralShell(sdf.Prim):
    def __init__(self, bone='Shell'):
        self.bone = bone
        pts = []
        for t in np.linspace(0, TMAX, 120):
            for psi in np.linspace(-math.pi, math.pi, 24):
                pts.append(spiral_point(t, psi, 0.22 * GS))
        pts = np.array(pts)
        self.lo = pts.min(axis=0) - 0.05 * GS
        self.hi = pts.max(axis=0) + 0.05 * GS

    def dist(self, X_, Y_, Z_):
        return shell_coords(X_, Y_, Z_)[0]


# The carved plate band on the outer face of the body whorl and the next.
PLATES_PER_TURN = 10
PLATE_PSI = (math.radians(-95), math.radians(-30))
PLATE_T = (0.06, 1.9)
KNOBS_PER_TURN = 6
KNOB_PSI = math.radians(48)


def plate_uv(t, psi):
    """(inside, plate index, fu, fv) of shell coordinates: fu along the spiral and fv
    across the band, both 0..1 inside a plate."""
    fv = (psi - PLATE_PSI[0]) / (PLATE_PSI[1] - PLATE_PSI[0])
    inside = (fv > 0) & (fv < 1) & (t > PLATE_T[0]) & (t < PLATE_T[1])
    x = t * PLATES_PER_TURN
    idx = np.floor(x)
    fu = x - idx
    return inside, idx, fu, fv


def glyph_mask(idx, fu, fv):
    """Soft 0..1 moon glyph in plate-local coordinates: a crescent on even plates,
    a ringed full moon on odd ones."""
    x = (fu - 0.5) * 1.15
    y = (fv - 0.5)
    w = 0.035
    d1 = np.sqrt(x * x + y * y)
    # crescent: inside a disc of 0.30, outside a disc of 0.26 shifted to its horns
    d2 = np.sqrt((x - 0.12) ** 2 + (y - 0.05) ** 2)
    cres = np.clip((0.30 - d1) / w, 0, 1) * np.clip((d2 - 0.25) / w, 0, 1)
    # full moon: a ring and its pearl
    ring = np.clip((0.045 - np.abs(d1 - 0.27)) / w * 1.4, 0, 1)
    dot = np.clip((0.13 - d1) / w, 0, 1)
    full = np.maximum(ring, dot)
    even = np.mod(idx, 2) < 0.5
    return np.where(even, cres, full)


def plate_frame(fu, fv):
    """0 in the groove between plates, 1 on a plate's face (a bevelled border)."""
    e = np.minimum(np.minimum(fu, 1 - fu) * 1.15, np.minimum(fv, 1 - fv))
    return np.clip((e - 0.03) / 0.05, 0, 1)


def shell_detail(X_, Y_, Z_):
    d, t, psi, rho = shell_coords(X_, Y_, Z_)
    s = Q ** t
    out = np.zeros_like(d)
    # spiral cords round the tube (fine, everywhere)
    cords = np.maximum(0.0, np.cos(psi * 15.0)) ** 6
    inside0 = plate_uv(t, psi)[0]
    out -= 0.010 * GS * cords * (0.4 + 0.6 * s) * (1 - 0.8 * inside0)
    # growth lines across the whorl
    gl = np.maximum(0.0, np.cos(t * 2 * math.pi * 48)) ** 10
    out -= 0.006 * GS * gl * s
    # the crown: a knob on the shoulder every 1/9 turn, pointed outward and up
    kx = t * KNOBS_PER_TURN
    kf = kx - np.floor(kx + 0.5)
    kd = np.sqrt((kf * 1.0) ** 2 + ((psi - KNOB_PSI) / 1.1) ** 2)
    knob = np.clip(1.0 - kd / 0.2, 0, 1) ** 1.6 * (t > 0.12) * (t < TMAX - 0.05)
    out -= 0.3 * GS * knob * (0.35 + 0.65 * s)
    # the carved plates: raised faces, sunk seams, the glyph cut into each
    inside, idx, fu, fv = plate_uv(t, psi)
    fr = plate_frame(fu, fv)
    gm = glyph_mask(idx, fu, fv)
    band = inside.astype(float)
    out -= band * (0.024 * GS * fr * s ** 0.5)
    out += band * (0.016 * GS * (1 - fr))
    out += band * fr * gm * 0.012 * GS
    return out


# ------------------------------------------------------------------ bones (rest)
def _bones():
    L = []

    def b(name, parent, h, t):
        L.append((name, parent, tuple(g(*h)), tuple(g(*t))))

    b('Root', None, (0, 0, 0), (0, -0.4, 0))
    b('Body', 'Root', (0, 0.55, 0.42), (0, -0.25, 0.45))
    b('Neck1', 'Body', (0, -0.25, 0.45), (0, -1.0, 0.62))
    b('Neck2', 'Neck1', (0, -1.0, 0.62), (0, -1.45, 0.98))
    b('Head', 'Neck2', (0, -1.45, 0.98), (0, -1.85, 1.1))
    b('Snout1', 'Head', (0, -1.84, 1.0), (0, -2.1, 0.92))
    b('Snout2', 'Snout1', (0, -2.1, 0.92), (0, -2.32, 0.8))
    b('Snout3', 'Snout2', (0, -2.32, 0.8), (0, -2.46, 0.66))
    for s, p in ((1, 'L_'), (-1, 'R_')):
        b(p + 'Eye1', 'Head', (0.17 * s, -1.62, 1.2), (0.3 * s, -1.78, 1.56))
        b(p + 'Eye2', p + 'Eye1', (0.3 * s, -1.78, 1.56), (0.42 * s, -1.92, 1.92))
        b(p + 'Frill1', 'Neck1', (0.62 * s, -1.25, 0.16), (0.72 * s, -0.3, 0.2))
        b(p + 'Frill2', 'Body', (0.74 * s, -0.3, 0.2), (0.74 * s, 0.8, 0.2))
        b(p + 'Frill3', 'Tail1', (0.7 * s, 0.8, 0.18), (0.42 * s, 1.95, 0.12))
    b('Tail1', 'Body', (0, 0.55, 0.42), (0, 1.25, 0.32))
    b('Tail2', 'Tail1', (0, 1.25, 0.32), (0, 1.85, 0.2))
    b('Tail3', 'Tail2', (0, 1.85, 0.2), (0, 2.35, 0.08))
    L.append(('Shell', 'Root', tuple(SHELL_BASE), tuple(SHELL_BASE + SHELL_AXIS * 0.6 * GS)))
    top = shrine_origin()
    L.append(('Shrine', 'Shell', tuple(top), tuple(top + np.array((0, 0, 0.5)) * GS)))
    pc = shrine_pearl()
    L.append(('Pearl', 'Shrine', tuple(pc), tuple(pc + np.array((0, 0, 0.2)) * GS)))
    L.append(('Flare', 'Shrine', tuple(pc), tuple(pc + np.array((0, -0.2, 0)) * GS)))
    return L


_SHRINE_O = None


def shell_top():
    """The highest point of the shell's outer surface (the body whorl's crest)."""
    best = None
    for t in np.linspace(0.0, 1.6, 81):
        for psi in np.linspace(-1.5, 1.5, 61):
            p = spiral_point(t, psi)
            if best is None or p[2] > best[2]:
                best = p
    return best


def shrine_origin():
    """The plinth's underside centre: on the crest of the shell, over the foot."""
    global _SHRINE_O
    if _SHRINE_O is None:
        top = shell_top()
        _SHRINE_O = np.array((top[0], top[1], top[2] + 0.02 * GS))
    return _SHRINE_O


SHRINE = dict(plinth_r=0.42, plinth_h=0.1, col_r=0.038, col_ring=0.315, col_h=0.44, dome_r=0.38, dome_h=0.28)


def shrine_pearl():
    o = shrine_origin()
    return o + np.array((0, 0, SHRINE['plinth_h'] + 0.32)) * GS


BONES = _bones()
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
FEET = ()
SOLE_Z = 0.0
GROUND = 0.0
FREE_END = ('Death',)
TREMOR_KEYS = ('Neck', 'Head', 'Eye', 'Snout', 'Tent', 'Body', 'Tail', 'Shell', 'Shrine')
POP_SKIP = ('Flare', 'Pearl')


# ------------------------------------------------------------------ the foot and the head
FOOT = [  # (y, z centre, half width, half height, bone)
    (2.36, 0.07, 0.12, 0.07, 'Tail3'),
    (1.95, 0.12, 0.34, 0.15, 'Tail3'),
    (1.45, 0.2, 0.55, 0.26, 'Tail2'),
    (0.9, 0.3, 0.72, 0.42, 'Tail1'),
    (0.3, 0.36, 0.8, 0.52, 'Body'),
    (-0.35, 0.36, 0.78, 0.5, 'Body'),
    (-0.95, 0.3, 0.68, 0.4, 'Neck1'),
    (-1.42, 0.2, 0.56, 0.22, 'Neck1'),
]


def add_chunked(F, prim, slab=24):
    """F.add(prim, 0) in z slabs, so a big primitive never needs the whole grid at once."""
    nz = F.shape[2]
    for z0 in range(0, nz, slab):
        z1 = min(nz, z0 + slab)
        X_, Y_, Z_ = np.meshgrid(F.axes[0], F.axes[1], F.axes[2][z0:z1], indexing='ij')
        d = prim.dist(X_, Y_, Z_).astype(np.float32)
        F.d[:, :, z0:z1] = np.minimum(F.d[:, :, z0:z1], d)
    F.prims.append((prim, 0.0))


def build_body(voxel):
    F = Field(g(-1.25, -2.85, -0.05), g(1.25, 2.6, 2.25), voxel)
    for y, z, rx, rz, bone in FOOT:
        F.add(Ellipsoid(g(0, y, z), g(rx, 0.42, rz), bone=bone), 0.3 * GS)
    # the hump under the shell and the mantle that fills its aperture
    F.add(Ellipsoid(g(0.12, 0.45, 0.7), g(0.72, 1.0, 0.5), bone='Body'), 0.25 * GS)
    ap = spiral_point(0.02)
    F.add(Ellipsoid(ap + g(0, -0.05, -0.08), g(0.55, 0.5, 0.55), bone='Body'), 0.2 * GS)
    # the scalloped mantle skirt round the foot
    for s, side in ((1, 'L_'), (-1, 'R_')):
        for i, y in enumerate(np.linspace(-1.3, 2.05, 23)):
            # half width of the foot at y, interpolated from the stations
            ys = [f[0] for f in FOOT][::-1]
            rxs = [f[2] for f in FOOT][::-1]
            rx = float(np.interp(y, ys, rxs))
            zc = 0.12 + 0.02 * (1 if i % 2 else -1)
            bone = side + ('Frill1' if y < -0.3 else 'Frill2' if y < 0.8 else 'Frill3')
            F.add(Ellipsoid(g(s * (rx + 0.02), y, zc), g(0.13, 0.17, 0.035), bone=bone), 0.05 * GS)
    # neck, head and proboscis
    F.add(RoundCone(g(0, -0.55, 0.6), g(0, -1.05, 0.78), 0.46 * GS, 0.4 * GS, bone='Neck1'), 0.2 * GS)
    F.add(RoundCone(g(0, -1.05, 0.78), g(0, -1.48, 1.0), 0.4 * GS, 0.34 * GS, bone='Neck2'), 0.14 * GS)
    F.add(Ellipsoid(g(0, -1.66, 1.05), g(0.4, 0.36, 0.3), bone='Head'), 0.12 * GS)
    F.add(Ellipsoid(g(0, -1.62, 1.2), g(0.28, 0.22, 0.12), bone='Head'), 0.08 * GS)     # brow
    # the snout: a broad, down-turned conch's snout ending in a fleshy mouth disc
    F.add(Ellipsoid(g(0, -1.98, 0.97), g(0.29, 0.3, 0.2), bone='Snout1'), 0.1 * GS)
    F.add(Ellipsoid(g(0, -2.2, 0.85), g(0.27, 0.24, 0.17), bone='Snout2'), 0.08 * GS)
    F.add(Ellipsoid(g(0, -2.38, 0.72), g(0.25, 0.17, 0.15), bone='Snout3'), 0.06 * GS)
    # brow and cheek pads round the eye stalks
    for s_ in (1, -1):
        F.add(Ellipsoid(g(0.2 * s_, -1.72, 1.12), g(0.14, 0.16, 0.1), bone='Head'), 0.07 * GS)
        F.add(Ellipsoid(g(0.24 * s_, -2.06, 0.86), g(0.1, 0.2, 0.12), bone='Snout1'), 0.06 * GS)
    tip = g(0, -2.46, 0.6)
    ax = unit((0, -0.55, -1.0))
    # the mouth: thick everted lips round a deep, ringed throat
    F.add(Torus(tip, ax, 0.15 * GS, 0.06 * GS, bone='Snout3', squash=0.8), 0.04 * GS)
    F.sub(Ellipsoid(tip + ax * 0.04 * GS, g(0.12, 0.1, 0.12)), 0.03 * GS)
    for i in range(3):
        F.groove(Torus(tip - ax * (0.02 + 0.05 * i) * GS, ax, (0.09 - 0.012 * i) * GS, 0.004 * GS), 0.012 * GS,
                 0.012 * GS)
    # a ring of oral tentacles round the lips, curling down and in
    for i in range(7):
        a_ = math.pi * (0.1 + 0.8 * i / 6)
        side = np.array((math.cos(a_), 0.0, 0.0))
        o = tip + np.array((math.cos(a_) * 0.15, -math.sin(a_) * 0.04, -math.sin(a_) * 0.02)) * GS * 1.0
        d = unit(np.array((math.cos(a_) * 0.5, -0.45, -0.75)))
        L = (0.22 + 0.08 * math.sin(a_)) * GS
        p1 = o + d * L * 0.55
        p2 = o + d * L + np.array((-math.cos(a_) * 0.06, -0.02, 0.05)) * GS
        F.add(RoundCone(o, p1, 0.035 * GS, 0.024 * GS, bone='Snout3'), 0.02 * GS)
        F.add(RoundCone(p1, p2, 0.024 * GS, 0.01 * GS, bone='Snout3'), 0.012 * GS)
        _ = side
    # skin folds: soft rolls across the neck and the snout's top
    for i, (y, z, r) in enumerate(((-0.75, 0.82, 0.48), (-0.98, 0.92, 0.44), (-1.2, 1.0, 0.4), (-1.42, 1.08, 0.36))):
        F.ridge(Torus(g(0, y, z), (0, 1.0, -0.35), r * GS, 0.01 * GS), 0.035 * GS, 0.03 * GS)
    for i, y in enumerate((-1.94, -2.08, -2.22)):
        F.groove(Torus(g(0, y, 0.98 - 0.12 * i), (0, 1.0, -0.6), (0.27 - 0.02 * i) * GS, 0.005 * GS), 0.02 * GS,
                 0.018 * GS)
    # eye stalks with their bulbs, the feelers
    for s, p in ((1, 'L_'), (-1, 'R_')):
        e0, e1, e2 = g(0.17 * s, -1.62, 1.2), g(0.3 * s, -1.78, 1.56), g(0.42 * s, -1.92, 1.92)
        F.add(RoundCone(e0, e1, 0.085 * GS, 0.06 * GS, bone=p + 'Eye1'), 0.07 * GS)
        F.add(RoundCone(e1, e2, 0.06 * GS, 0.052 * GS, bone=p + 'Eye2'), 0.03 * GS)
        F.add(Sphere(e2 + g(0.0, -0.02, 0.04), 0.115 * GS, bone=p + 'Eye2'), 0.05 * GS)
    # the pedal groove: a crease along each flank just above the skirt
    for s_ in (1, -1):
        pts = [g(s_ * (rx + 0.0), y, 0.24) for y, z, rx, rz, b_ in FOOT[1:-1]]
        for p0, p1 in zip(pts, pts[1:]):
            F.groove(RoundCone(p0, p1, 0.005 * GS, 0.005 * GS), 0.03 * GS, 0.03 * GS)
    # the flat sole
    zs = F.axes[2][None, None, :]
    F.d = smax(F.d, -(zs - 0.0), 0.05 * GS).astype(np.float32)
    # wet skin: soft tubercles and wrinkles
    nz = Noise(11)
    nz2 = Noise(12)

    def skin(X_, Y_, Z_):
        a = 0.010 * GS * nz.fbm(X_ * 3.2 / GS, Y_ * 3.2 / GS, Z_ * 3.2 / GS, octaves=3)
        tub = np.clip(nz2(X_ * 11 / GS, Y_ * 11 / GS, Z_ * 11 / GS) - 0.25, 0, 1)
        return a - 0.03 * GS * tub
    F.displace(skin, band=0.12 * GS)
    return F


def build_shell(voxel):
    P = SpiralShell()
    F = Field(P.lo, P.hi + g(0, 0, 0.1), voxel)
    add_chunked(F, P)
    # the aperture's flared outer lip, a thick rolled rim
    a0 = spiral_point(0.0)
    R, H, rho = spiral(0.0)
    ang = PHI0
    radial = math.cos(ang) * SE1 + math.sin(ang) * SE2
    tang = unit(spiral_point(0.0) - spiral_point(0.01))
    _ = (radial, R, H)
    F.add(Torus(a0 + tang * 0.02 * GS, tang, rho * 1.0, 0.075 * GS), 0.06 * GS)
    # the socket under the shrine: the cut spire grows a short carved collar
    top = shrine_origin()
    F.add(RoundCone(top - g(0, 0, 0.3), top + g(0, 0, 0.02), 0.36 * GS, 0.34 * GS), 0.1 * GS)
    F.add(Torus(top + g(0, 0, -0.04), (0, 0, 1), 0.34 * GS, 0.05 * GS), 0.04 * GS)
    F.displace(shell_detail, band=0.25 * GS)
    return F


def shell_paint(obj):
    """Write the shell coordinates the bake reads: RegPlate (on a plate face),
    RegGlyph (inside a glyph), RegSeam (in a plate seam), RegKnob, RegLip."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    d, t, psi, rho = shell_coords(P[:, 0], P[:, 1], P[:, 2])
    inside, idx, fu, fv = plate_uv(t, psi)
    fr = plate_frame(fu, fv)
    gm = glyph_mask(idx, fu, fv)
    kx = t * KNOBS_PER_TURN
    kf = kx - np.floor(kx + 0.5)
    kd = np.sqrt(kf ** 2 + ((psi - KNOB_PSI) / 1.1) ** 2)
    knob = np.clip(1.0 - kd / 0.2, 0, 1) ** 1.6 * (t > 0.12)
    lip = np.clip(1.0 - t / 0.06, 0, 1) + (d > 0.03 * GS)
    vals = {
        'RegPlate': inside * fr,
        'RegGlyph': inside * fr * gm,
        'RegSeam': inside * (1 - fr),
        'RegKnob': knob,
        'RegLip': np.clip(lip, 0, 1),
        'RegT': t / TMAX,
        'RegPsi': psi,
    }
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


# ------------------------------------------------------------------ the shrine
def _cyl(c, r, h, rad=0.01):
    """A capped, rounded cylinder standing on c (z-up)."""
    c = np.asarray(c, float)
    return RoundCone(c + np.array((0, 0, rad)), c + np.array((0, 0, h - rad)), r, r)


class Cylinder(sdf.Prim):
    def __init__(self, c, r, h, rad=0.01, bone=None):
        self.c, self.r, self.h, self.rad, self.bone = np.asarray(c, float), float(r), float(h), float(rad), bone
        self.lo = self.c - np.array((r, r, 0)) - rad
        self.hi = self.c + np.array((r, r, h)) + rad

    def dist(self, X_, Y_, Z_):
        dx = np.sqrt((X_ - self.c[0]) ** 2 + (Y_ - self.c[1]) ** 2) - (self.r - self.rad)
        dz = np.abs(Z_ - (self.c[2] + self.h / 2)) - (self.h / 2 - self.rad)
        out = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(dx, dz), 0)
        return out - self.rad


def col_points():
    o = shrine_origin()
    n = 6
    out = []
    for i in range(n):
        a = math.tau * (i + 0.5) / n
        out.append(o + np.array((math.cos(a), math.sin(a), 0)) * SHRINE['col_ring'] * GS)
    return out


def build_shrine(voxel):
    o = shrine_origin()
    S = {k: v * GS for k, v in SHRINE.items()}
    F = Field(o - np.array((0.62, 0.62, 0.15)) * GS, o + np.array((0.62, 0.62, 1.22)) * GS, voxel)
    ph = S['plinth_h']
    F.add(Cylinder(o, S['plinth_r'], ph, 0.025 * GS, bone='Shrine'), 0.0)
    F.add(Cylinder(o + np.array((0, 0, ph)), S['plinth_r'] * 0.86, 0.05 * GS, 0.015 * GS, bone='Shrine'), 0.01 * GS)
    F.sub(Torus(o + np.array((0, 0, ph * 0.5)), (0, 0, 1), S['plinth_r'] + 0.005 * GS, 0.022 * GS), 0.008 * GS)
    base = o + np.array((0, 0, ph + 0.05 * GS))
    for c in col_points():
        cb = np.array((c[0], c[1], base[2]))
        F.add(Cylinder(cb, 0.075 * GS, 0.06 * GS, 0.015 * GS, bone='Shrine'), 0.008 * GS)
        F.add(Cylinder(cb, S['col_r'], S['col_h'], 0.01 * GS, bone='Shrine'), 0.01 * GS)
        # fluting: four shallow grooves
        for k in range(4):
            a = math.tau * k / 4 + 0.3
            d = np.array((math.cos(a), math.sin(a), 0)) * S['col_r']
            F.sub(RoundCone(cb + d + np.array((0, 0, 0.1 * GS)), cb + d + np.array((0, 0, S['col_h'] - 0.1 * GS)),
                            0.011 * GS, 0.011 * GS), 0.004 * GS)
        F.add(Cylinder(cb + np.array((0, 0, S['col_h'] - 0.06 * GS)), 0.07 * GS, 0.06 * GS, 0.015 * GS,
                       bone='Shrine'), 0.008 * GS)
    top = base[2] + S['col_h']
    oc = np.array((o[0], o[1], top))
    F.add(Cylinder(oc, S['dome_r'] * 0.98, 0.07 * GS, 0.02 * GS, bone='Shrine'), 0.01 * GS)
    dome = Ellipsoid(oc + np.array((0, 0, 0.06 * GS)), (S['dome_r'] * 0.92, S['dome_r'] * 0.92, S['dome_h']), bone='Shrine')
    F.add(X.Inter(dome, X.Plane(oc + np.array((0, 0, 0.05 * GS)), (0, 0, -1))), 0.01 * GS)
    for k in range(8):
        a = math.tau * k / 8
        p0 = oc + np.array((math.cos(a) * S['dome_r'] * 0.9, math.sin(a) * S['dome_r'] * 0.9, 0.08 * GS))
        p1 = oc + np.array((math.cos(a) * S['dome_r'] * 0.45, math.sin(a) * S['dome_r'] * 0.45, 0.06 * GS + S['dome_h'] * 0.86))
        p2 = oc + np.array((0, 0, 0.06 * GS + S['dome_h'] * 1.0))
        F.add(RoundCone(p0, p1, 0.022 * GS, 0.018 * GS, bone='Shrine'), 0.015 * GS)
        F.add(RoundCone(p1, p2, 0.018 * GS, 0.014 * GS, bone='Shrine'), 0.015 * GS)
    # a little offering bowl at the front edge of the plinth
    bw = o + np.array((0, -S['plinth_r'] * 0.72, ph + 0.05 * GS))
    bowl = X.Diff(Sphere(bw + np.array((0, 0, 0.06 * GS)), 0.1 * GS, bone='Shrine'),
                  Sphere(bw + np.array((0, 0, 0.11 * GS)), 0.09 * GS))
    F.add(X.Inter(bowl, X.Plane(bw + np.array((0, 0, 0.1 * GS)), (0, 0, 1))), 0.005 * GS)
    nz = Noise(21)
    F.displace(lambda X_, Y_, Z_: 0.002 * GS * nz.fbm(X_ * 20, Y_ * 20, Z_ * 20, octaves=2), band=0.05 * GS)
    return F


def finial_top():
    o = shrine_origin()
    return o + np.array((0, 0, (SHRINE['plinth_h'] + 0.05 + SHRINE['col_h'] + 0.06 + SHRINE['dome_h']) * GS))


def build_finial(voxel):
    """The silver: a standing crescent on the dome, the pearl's cup, the plinth band."""
    o = shrine_origin()
    ft = finial_top()
    F = Field(o - np.array((0.6, 0.6, 0.1)) * GS, ft + np.array((0.4, 0.4, 0.6)) * GS, voxel)
    F.add(RoundCone(ft - np.array((0, 0, 0.03)) * GS, ft + np.array((0, 0, 0.12)) * GS, 0.05 * GS, 0.025 * GS,
                    bone='Shrine'), 0.02 * GS)
    cc = ft + np.array((0, 0, 0.3)) * GS
    # a crescent standing in the x-z plane: build it as a disc minus a shifted disc
    class Disc(sdf.Prim):
        def __init__(self, c, r, t):
            self.c, self.r, self.t, self.bone = c, r, t, 'Shrine'
            self.lo, self.hi = c - r - 0.05, c + r + 0.05

        def dist(self, X_, Y_, Z_):
            dr = np.sqrt((X_ - self.c[0]) ** 2 + (Z_ - self.c[2]) ** 2) - self.r
            dy = np.abs(Y_ - self.c[1]) - self.t
            return np.sqrt(np.maximum(dr, 0) ** 2 + np.maximum(dy, 0) ** 2) + np.minimum(np.maximum(dr, dy), 0)

    F.add(X.Diff(Disc(cc, 0.21 * GS, 0.022 * GS), Disc(cc + np.array((0.07, 0, 0.08)) * GS, 0.19 * GS, 0.1 * GS),
                 0.01 * GS, bone='Shrine'), 0.01 * GS)
    pc = shrine_pearl()
    cup = pc - np.array((0, 0, 0.17)) * GS
    F.add(RoundCone(np.array((pc[0], pc[1], o[2] + (SHRINE['plinth_h'] + 0.04) * GS)), cup, 0.07 * GS, 0.03 * GS,
                    bone='Shrine'), 0.02 * GS)
    F.add(X.Inter(X.Shell(Sphere(pc, 0.18 * GS), 0.03 * GS), X.Plane(pc - np.array((0, 0, 0.06)) * GS, (0, 0, 1))),
          0.01 * GS)
    F.add(Torus(o + np.array((0, 0, (SHRINE['plinth_h'] + 0.02))) * GS, (0, 0, 1), SHRINE['plinth_r'] * 0.9 * GS,
                0.018 * GS, bone='Shrine'), 0.005 * GS)
    return F


def build_diadem(voxel):
    """Moon jewelry on the head: a silver band across the brow between the eye stalks
    with a crescent at the front, and a ring on each stalk."""
    F = Field(g(-0.5, -2.1, 0.85), g(0.5, -1.3, 1.65), voxel)
    pts = [g(0.24, -1.5, 1.2), g(0.16, -1.72, 1.29), g(0, -1.8, 1.31), g(-0.16, -1.72, 1.29), g(-0.24, -1.5, 1.2)]
    for i in range(4):
        F.add(RoundCone(pts[i], pts[i + 1], 0.028 * GS, 0.028 * GS, bone='Head'), 0.015 * GS)
    # the brow crescent
    cc = g(0, -1.84, 1.42)

    class Disc(sdf.Prim):
        def __init__(self, c, r, t):
            self.c, self.r, self.t, self.bone = c, r, t, 'Head'
            self.lo, self.hi = c - r - 0.05, c + r + 0.05

        def dist(self, X_, Y_, Z_):
            dr = np.sqrt((X_ - self.c[0]) ** 2 + (Z_ - self.c[2]) ** 2) - self.r
            dy = np.abs(Y_ - self.c[1]) - self.t
            return np.sqrt(np.maximum(dr, 0) ** 2 + np.maximum(dy, 0) ** 2) + np.minimum(np.maximum(dr, dy), 0)

    F.add(X.Diff(Disc(cc, 0.16 * GS, 0.026 * GS), Disc(cc + g(0.0, 0, 0.075), 0.145 * GS, 0.1 * GS), 0.008 * GS,
                 bone='Head'), 0.01 * GS)
    return F


def build_rings(voxel):
    """Silver rings round each eye stalk and the siphon (rigid to their bones)."""
    out = []
    for s, p in ((1, 'L_'), (-1, 'R_')):
        e0, e1 = g(0.17 * s, -1.62, 1.2), g(0.3 * s, -1.78, 1.56)
        c = lerp(e0, e1, 0.55)
        F = Field(c - 0.16 * GS, c + 0.16 * GS, voxel)
        F.add(Torus(c, unit(e1 - e0), 0.075 * GS, 0.022 * GS, bone=p + 'Eye1'), 0.0)
        F.add(Torus(c + unit(e1 - e0) * 0.06 * GS, unit(e1 - e0), 0.07 * GS, 0.016 * GS, bone=p + 'Eye1'), 0.0)
        out.append((p + 'EyeRing', F, p + 'Eye1'))
    return out


def build_operculum(voxel):
    """The operculum on the back of the foot: a carved nacre door with a spiral."""
    c = g(0, 1.32, 0.5)
    n = unit((0, 0.35, 1.0))
    F = Field(c - 0.4 * GS, c + 0.4 * GS, voxel)
    disc = Ellipsoid(c, (0.3 * GS, 0.36 * GS, 0.045 * GS), sdf.frame_from(n) @ np.eye(3), bone='Tail1')
    F.add(disc, 0.0)
    # a carved spiral groove on it
    for i in range(40):
        a0, a1 = i * 0.3, (i + 1) * 0.3
        r0, r1 = 0.02 + 0.02 * a0, 0.02 + 0.02 * a1
        e1v = np.array((1.0, 0, 0))
        e2v = np.cross(n, e1v)
        p0 = c + n * 0.04 * GS + (e1v * math.cos(a0) + e2v * math.sin(a0)) * r0 * GS * 1.0
        p1 = c + n * 0.04 * GS + (e1v * math.cos(a1) + e2v * math.sin(a1)) * r1 * GS * 1.0
        if r1 > 0.27:
            break
        F.sub(RoundCone(p0, p1, 0.012 * GS, 0.012 * GS), 0.006 * GS)
    return F


def fields(k=1.0):
    from build_core import Sculpt
    vb, vs, vsh, vd = 0.013 * k * GS, 0.011 * k * GS, 0.0065 * k * GS, 0.005 * k * GS
    Fb = build_body(vb)
    S = [
        Sculpt('Body', Fb, 'flesh', 9000, spots=[(g(0, -1.8, 1.1), 0.5 * GS, 1.0), (g(0.42, -1.92, 1.92), 0.2 * GS, 1.0),
                                                 (g(-0.42, -1.92, 1.92), 0.2 * GS, 1.0)], tau=0.03 * GS),
        Sculpt('Shell', build_shell(vs), 'nacre', 9000, binding='rigid', bone='Shell', paint=shell_paint),
        Sculpt('Shrine', build_shrine(vsh), 'marble', 3200, binding='rigid', bone='Shrine'),
        Sculpt('Silver', build_finial(vd), 'silver', 1200, binding='rigid', bone='Shrine'),
        Sculpt('Diadem', build_diadem(vd), 'silver', 700, binding='rigid', bone='Head'),
        Sculpt('Operculum', build_operculum(vd * 1.4), 'nacre', 500, binding='rigid', bone='Tail1'),
    ]
    for name, F, bone in build_rings(vd):
        S.append(Sculpt(name, F, 'silver', 260, binding='rigid', bone=bone))
    return S
