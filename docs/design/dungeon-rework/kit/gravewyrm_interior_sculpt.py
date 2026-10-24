"""The Gravewyrm Sanctum's interior AAA pass: carved and cleaved masses
(build_gravewyrm_sanctum_interior.py).

The Sanctum kit (build_gravewyrm_sanctum_kit.py) and the Seal Gate at the door
(entrance/sanctum_gate_sculpt.py) sculpt the Smith's stone and the glacier as
signed distance fields meshed through OpenVDB. This module sculpts the
interior's second pass the same way, on the same libraries:

  lock_spur_field()    the rock pedestal the Lock Terrace stands on, rising out
                       of the gulf: cleaved slate strata stacked round the
                       terrace, buttresses and ledges, frozen seeps pouring off
                       the rim, icicles under every ledge; flat a hand under
                       the terrace floor (never over the walk), notched under
                       the Chain Bridge's deck
  seal_pillar_field()  a seal pillar of the Smith's black stone: a stepped
                       plinth and roll, a battered and coursed shaft bound in
                       riveted iron, the tool's relief in a sunk panel, a rune
                       column, a corbelled crown with the chain's eye; the
                       cracked variant split by a fissure, a corner sheared
  lock_curb_field()    the terrace's rim kerb: cut curb stones round the arena
                       (knee low, walk-over), incised marks, drifts banked
  lip_rock_field()     a lip module: a slab of cleaved slate hanging from a
                       walkway's edge into the gulf (under the floor only)

Coordinates: Blender's (X east, Y SOUTH, Z up). G(lx, lz, y) takes game-local
coordinates (lx east, lz north, y up). Deterministic: seeded generators and
seeded noise only.
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'entrance'))

import gravewyrm_sculpt as gs  # noqa: E402
import sanctum_gate_sculpt as sg  # noqa: E402
from gravewyrm_sculpt import Sculpt  # noqa: E402
from jaguar_head_sculpt import Ellipsoid, Noise, Prim, RoundBox, RoundCone, Torus  # noqa: E402
from sanctum_gate_sculpt import (  # noqa: E402
    Convex, Extrude, Frame, ao_and_edge, carve_glyph, ellipse, frustum, glyph_strokes, groove_polyline, mix,
    rect, sstep,
)

STONE, GLOW, GLASS = 0, 1, 2


def G(lx, lz, y):
    return np.array((lx, -lz, y), dtype=np.float64)


# ------------------------------------------------------------------ palette (sRGB)
SLATE = (0.36, 0.39, 0.44)
SLATE_DARK = (0.22, 0.24, 0.28)
SLATE_PALE = (0.55, 0.58, 0.63)
SLATE_DEEP = (0.07, 0.08, 0.1)
BLACK = (0.19, 0.2, 0.235)          # the Smith's black stone
BLACK_EDGE = (0.33, 0.35, 0.39)
BLACK_DEEP = (0.06, 0.065, 0.08)
IRON = (0.27, 0.28, 0.31)
IRON_DARK = (0.12, 0.125, 0.14)
RUST = (0.33, 0.24, 0.18)
RIME = (0.9, 0.95, 0.985)
FROST = (0.7, 0.8, 0.88)
SNOW_SHADE = (0.6, 0.69, 0.8)
ICE_CLEAR = (0.5, 0.78, 0.92)
ICE_DEEP = (0.15, 0.4, 0.6)
ICE_PALE = (0.8, 0.92, 0.97)
ICE_GLASS = (0.62, 0.86, 0.98)
RUNE = (0.353, 0.722, 1.0)          # the Smith's rune blue #5AB8FF (held dim by the slot)
RUNE_DIM = (0.18, 0.38, 0.56)
RUNE_DEAD = (0.05, 0.06, 0.08)


# ------------------------------------------------------------------ helpers
class Cylinder(Prim):
    """A vertical capped cylinder (Blender Z), radius r, z0..z1."""

    def __init__(self, cx, cy, r, z0, z1):
        self.cx, self.cy, self.r, self.z0, self.z1 = cx, cy, r, z0, z1
        self.lo = np.array((cx - r, cy - r, z0))
        self.hi = np.array((cx + r, cy + r, z1))

    def dist(self, X, Y, Z):
        d = np.sqrt((X - self.cx) ** 2 + (Y - self.cy) ** 2) - self.r
        h = np.maximum(self.z0 - Z, Z - self.z1)
        return np.sqrt(np.maximum(d, 0) ** 2 + np.maximum(h, 0) ** 2) + np.minimum(np.maximum(d, h), 0)


class Profiled(Prim):
    """A solid of revolution round Blender Z whose radius follows a profile
    [(z, r)...] (linear between), optionally scalloped by `wobble(theta, z)`."""

    def __init__(self, profile, wobble=None):
        self.zs = np.array([p[0] for p in profile], dtype=np.float64)
        self.rs = np.array([p[1] for p in profile], dtype=np.float64)
        self.wobble = wobble
        R = float(self.rs.max()) + 3.0
        self.lo = np.array((-R, -R, self.zs.min()))
        self.hi = np.array((R, R, self.zs.max()))

    def dist(self, X, Y, Z):
        r = np.sqrt(X * X + Y * Y)
        rr = np.interp(Z, self.zs, self.rs)
        if self.wobble is not None:
            rr = rr + self.wobble(np.arctan2(Y, X), Z)
        d = r - rr
        h = np.maximum(self.zs.min() - Z, Z - self.zs.max())
        return np.maximum(d * 0.85, h)


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array(((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0)))


def ice_chain(f, pts, r0, r1, label='ice', k=0.25):
    """A tapering run of round cones (a frozen seep, an icicle) along pts."""
    n = len(pts)
    for i in range(n - 1):
        ra = r0 + (r1 - r0) * i / (n - 1)
        rb = r0 + (r1 - r0) * (i + 1) / (n - 1)
        f.put(label, RoundCone(pts[i], pts[i + 1], ra, rb), k)


def icicle(f, top, length, r, rng, label='ice'):
    """One icicle hanging from `top` (Blender coords), a slight kink."""
    a = np.asarray(top, dtype=np.float64)
    mid = a + np.array((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), -length * 0.55))
    tip = a + np.array((rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), -length))
    f.put(label, RoundCone(a, mid, r, r * 0.55), 0.04)
    f.put(label, RoundCone(mid, tip, r * 0.55, 0.012), 0.03)


def rock_paint(field, seed, base=SLATE, dark=SLATE_DARK, pale=SLATE_PALE, deep=SLATE_DEEP, rime=RIME,
               snow_up=0.62, strata=2.6, ice=True):
    """Cleaved slate: banded strata (alternating tone every few yards),
    baked occlusion into every crevice, pale worn arrises, rime and snow on
    whatever faces up, glacier ice where the sculpt labelled it."""
    n1, n2 = Noise(seed), Noise(seed + 5)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        z = P[:, 2]
        band = 0.5 + 0.5 * np.sin(z * (2 * math.pi / strata) + 1.7 * n1.fbm(P[:, 0] * 0.08, P[:, 1] * 0.08, z * 0.05, 2))
        tone = 0.5 + 0.5 * n1.fbm(P[:, 0] * 0.22, P[:, 1] * 0.22, z * 0.3, 3)
        c = mix(dark, base, np.clip(band * 0.55 + tone * 0.45, 0, 1))
        c = mix(c, pale, np.clip(edge * 0.8, 0, 1))
        streak = 0.9 + 0.14 * (0.5 + 0.5 * n2.fbm(P[:, 0] * 1.8, P[:, 1] * 1.8, z * 0.12, 2))
        c = c * streak[:, None]
        c = mix(deep, c, np.clip(ao ** 1.7, 0, 1))
        up = np.clip(N[:, 2], 0, 1)
        patch = 0.5 + 0.5 * n2.fbm(P[:, 0] * 0.9 + 3, P[:, 1] * 0.9, z * 0.9, 2)
        snow = sstep(snow_up, 0.93, up + (patch - 0.5) * 0.45) * np.clip(0.35 + ao, 0, 1)
        c = mix(c, rime, snow)
        # frost blooms creeping up from below the lip (the gulf's breath)
        frost = np.clip(0.35 * patch * (1 - np.clip(ao, 0, 1)) + 0.15 * up, 0, 0.45)
        c = mix(c, FROST, frost * 0.5)
        if ice:
            labels = field.classify(P, default='rock')
            is_ice = (labels == 'ice').astype(np.float64)
            ic = mix(ICE_DEEP, ICE_CLEAR, np.clip(ao ** 1.2 * 0.8 + edge * 0.3, 0, 1))
            ic = mix(ic, ICE_PALE, np.clip(edge * 0.6 + up * 0.4, 0, 1))
            c = mix(c, ic, is_ice)
        return c

    return paint


def mat_by_label(field, labels_glass=('glass',), labels_glow=('glow',)):
    def pick(C):
        labels = field.classify(C, default='rock')
        out = np.full(len(C), STONE, dtype=int)
        out[np.isin(labels, labels_glass)] = GLASS
        out[np.isin(labels, labels_glow)] = GLOW
        return out
    return pick


# ------------------------------------------------------------------ the Lock Terrace's pedestal
LOCK_R = 22.0                    # the terrace's walked radius (sim LOCK_TERRACE.r)
SPUR_TOP = -0.14                 # a hand under the floor
# The radius of the pedestal's outer face by depth (y down from the floor).
SPUR_PROFILE = [(-58.0, 11.0), (-44.0, 15.5), (-30.0, 20.5), (-18.0, 24.5), (-9.0, 25.8), (-3.5, 24.6),
                (-1.2, 23.4), (0.2, 22.9)]
# The Chain Bridge's corridor (game-local about the terrace centre): its deck
# leaves the rim at lz 21 (h 0) and falls 6 yd over 27 yd north.
BRIDGE_HALF = 7.5


def bridge_deck_y(lz):
    return -6.0 * max(0.0, lz - 21.0) / 27.0


def spur_radius(y):
    zs = [p[0] for p in SPUR_PROFILE]
    rs = [p[1] for p in SPUR_PROFILE]
    return float(np.interp(y, zs, rs))


class BridgeNotch(Prim):
    """Everything over the Chain Bridge's deck (less a clearance) inside its
    corridor: cut out so the deck and its hanging chain never meet rock."""

    def __init__(self, clear=2.4):
        self.clear = clear
        self.lo = np.array((-BRIDGE_HALF - 1, -40.0, -30.0))
        self.hi = np.array((BRIDGE_HALF + 1, -14.0, 6.0))

    def dist(self, X, Y, Z):
        lz = -Y
        deck = -6.0 * np.maximum(0.0, lz - 21.0) / 27.0 - self.clear
        dx = np.abs(X) - BRIDGE_HALF
        dz = 15.5 - lz
        dy = deck - Z
        return np.maximum(np.maximum(dx, dz), dy)


def spur_lobes(theta, z):
    """The pedestal's plan wobble (yards): three broad lobes and a finer
    scallop, drifting with depth, so it never reads as a turned drum."""
    n = _LOBE_NOISE
    return (1.9 * np.sin(3 * theta + 0.8 + z * 0.02) + 1.1 * np.sin(5 * theta + 2.1 - z * 0.035)
            + 1.6 * n.fbm(np.cos(theta) * 1.4, np.sin(theta) * 1.4, z * 0.04, 3))


_LOBE_NOISE = Noise(41)


def lock_spur_field(rng, voxel=0.32):
    """The Lock Terrace's rock pedestal (origin: the terrace's centre on its
    floor). Returns the Sculpt."""
    R = 32.0
    f = Sculpt((-R, -R, -60.0), (R, R, 0.6), voxel)

    def lobed(a, y):
        # the lobes swell outward under the rim, never inside the floor
        return float(spur_lobes(np.array(a), np.array(y))) * float(np.clip(-y / 4.0, 0.0, 1.0))

    core = [(z, max(4.0, r - 3.0)) for (z, r) in SPUR_PROFILE]
    f.put('rock', Profiled(core, lambda t, z: spur_lobes(t, z) * np.clip(-z / 4.0, 0.0, 1.0)), 0.0)
    # strata of cleaved blocks, dipping a few degrees, each course proud or
    # shy of its neighbours; one block in seven left out (a recess)
    y = SPUR_TOP
    course = 0
    dip = gs.rot(0.06, -0.04, 0.0)
    while y > -58.0:
        h = rng.uniform(1.5, 2.6) if y > -10 else rng.uniform(2.6, 4.6)
        yc = y - h / 2
        proud = (0.9 if course % 2 else -0.5) + rng.uniform(-0.45, 0.45)
        n = max(10, int(2 * math.pi * spur_radius(yc) / rng.uniform(4.5, 8.0)))
        phase = rng.uniform(0, 2 * math.pi)
        for k in range(n):
            if rng.random() < 0.14 and y < -2.0:
                continue
            a = phase + 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / n
            rk = spur_radius(yc) + lobed(a, yc) + proud + rng.uniform(-0.9, 0.9)
            w = 2 * math.pi * rk / n * rng.uniform(1.0, 1.35)
            depth = rng.uniform(5.0, 7.5)
            c = (math.cos(a) * (rk - depth / 2 + 0.6), math.sin(a) * (rk - depth / 2 + 0.6), yc)
            Rm = rot_z(a) @ dip @ gs.rot(rng.uniform(-0.12, 0.12), rng.uniform(-0.1, 0.1), rng.uniform(-0.08, 0.08))
            top_tilt = 0.3 if y < -1.0 else 0.0
            f.put('rock', gs.block(rng, c, (depth, w, h * rng.uniform(1.0, 1.2)), cuts=8,
                                   chamfer=(0.6, 0.93), R=Rm, top_tilt=top_tilt), 0.25)
        y -= h
        course += 1
    # buttresses: great cleaved ribs down the flanks, breaking the courses
    # (never on the bridge side)
    for k in range(13):
        a = 2 * math.pi * (k + 0.5) / 13 + rng.uniform(-0.1, 0.1)
        ca, sa = math.cos(a), math.sin(a)
        lx, lz = ca, -sa
        if lz > 0.5 and abs(lx) < 0.55:
            continue
        top = rng.uniform(-2.6, -1.0)
        bottom = rng.uniform(-48.0, -26.0)
        yj = top
        j = 0
        while yj > bottom:
            hj = rng.uniform(4.0, 7.5)
            rj = spur_radius(yj - hj / 2) + lobed(a, yj - hj / 2) + rng.uniform(1.6, 2.8) - j * 0.1
            c = (ca * rj, sa * rj, yj - hj / 2)
            f.put('rock', gs.block(rng, c, (rng.uniform(4.0, 6.0), rng.uniform(3.6, 5.6), hj * 1.1), cuts=7,
                                   chamfer=(0.66, 0.9), R=rot_z(a + rng.uniform(-0.15, 0.15)), top_tilt=0.4), 0.3)
            yj -= hj
            j += 1
    # vertical fractures down the faces
    for k in range(26):
        a = rng.uniform(0, 2 * math.pi)
        y0 = rng.uniform(-6.0, -1.0)
        pts = []
        for j in range(7):
            yj = y0 - j * rng.uniform(2.5, 4.0)
            aj = a + rng.uniform(-0.03, 0.03)
            rj = spur_radius(yj) + lobed(aj, yj) + 1.5
            pts.append((math.cos(aj) * rj, math.sin(aj) * rj, yj))
        groove_polyline(f, pts, 0.35, 0.22)
    # the lip: rock teeth just under the floor's edge, overhanging the drum
    for k in range(52):
        a = 2 * math.pi * (k + rng.uniform(-0.25, 0.25)) / 52
        r0 = LOCK_R + rng.uniform(0.35, 1.2)
        c = (math.cos(a) * (r0 - 1.5), math.sin(a) * (r0 - 1.5), SPUR_TOP - rng.uniform(0.5, 0.9))
        f.put('rock', gs.block(rng, c, (3.2, rng.uniform(2.6, 3.8), rng.uniform(1.0, 1.6)), cuts=5,
                               chamfer=(0.75, 0.95), R=rot_z(a)), 0.12)
    # frozen seeps pouring off the rim into the gulf: broad at the lip, a
    # rope of ice down the face, icicle fringes
    seeps = [-2.3, -0.4, 3.55, 2.5, 1.0, 4.4]
    for a in seeps:
        a += rng.uniform(-0.06, 0.06)
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for j in range(11):
            yj = SPUR_TOP - 0.4 - j * 4.0
            aj = a + 0.03 * math.sin(j * 1.7)
            rj = spur_radius(yj) + lobed(aj, yj) + 1.9 + 0.45 * math.sin(j * 1.3)
            pts.append(np.array((math.cos(aj) * rj, math.sin(aj) * rj, yj)))
        ice_chain(f, pts, 2.1, 0.7, 'ice', 0.7)
        for j in range(3):
            off = (j - 1) * 1.6
            q = np.array((ca * (spur_radius(-1.2) + 1.0) - sa * off, sa * (spur_radius(-1.2) + 1.0) + ca * off, -0.7))
            f.put('ice', Ellipsoid(q, (1.6, 1.6, 0.55), rot_z(a)), 0.5)
        for j in range(9):
            off = rng.uniform(-2.2, 2.2)
            rj = spur_radius(-1.0) + lobed(a, -1.0) + 2.4
            icicle(f, (ca * rj - sa * off, sa * rj + ca * off, SPUR_TOP - 1.0), rng.uniform(1.6, 4.2),
                   rng.uniform(0.18, 0.32), rng)
    # icicles under the upper ledges (where the eye sees them from the
    # terrace and the wings)
    for k in range(90):
        a = rng.uniform(0, 2 * math.pi)
        yk = rng.uniform(-12.0, -1.4)
        rk = spur_radius(yk) + lobed(a, yk) + rng.uniform(1.0, 2.2)
        icicle(f, (math.cos(a) * rk, math.sin(a) * rk, yk), rng.uniform(0.8, 3.0), rng.uniform(0.1, 0.24), rng)
    gs.slate_noise(f, 811, amp=0.6, scale=1.6)
    f.cut_above(SPUR_TOP)
    f.sub(BridgeNotch(), 0.6)
    return f


# ------------------------------------------------------------------ the seal pillars
P_TIERS = [  # (half, y0, y1, chamfer)
    (2.95, -0.6, 0.55, 0.14),
    (2.62, 0.55, 1.12, 0.12),
]
P_ROLL = dict(half=2.42, y0=1.12, y1=1.52, r=0.17)
P_SHAFT = dict(hb=2.08, ht=1.78, y0=1.52, y1=12.0, ch=0.3)
P_COURSES = [1.62, 1.48, 1.55, 1.5, 1.6, 1.42, 1.3]
P_BANDS = [2.25, 7.15, 11.2]
P_CAP = [  # (half, y0, y1, chamfer)
    (1.98, 12.0, 12.38, 0.1),
    (2.28, 12.38, 12.86, 0.12),
    (2.56, 12.86, 13.42, 0.14),
]
P_CROWN = dict(hb=2.4, ht=1.25, y0=13.42, y1=13.92)
P_EYE = dict(y=14.12, R=0.46, r=0.14)
P_PANEL = dict(v0=2.85, v1=6.75, w=2.15, depth=0.16, frame=0.14)
P_RUNES = dict(v0=7.75, step=1.02, size=0.76, n=3)
TOOL_GLYPH = {'Hammer': 0, 'Tongs': 3, 'Anvil': 5, 'Bellows': 7}


def shaft_half(y):
    t = (y - P_SHAFT['y0']) / (P_SHAFT['y1'] - P_SHAFT['y0'])
    return P_SHAFT['hb'] + (P_SHAFT['ht'] - P_SHAFT['hb']) * t


def pillar_front_frame():
    """The pillar's front (game +lz, toward Korgath) as a carving frame: u to
    the viewer's right (game -lx... seen from the front, right is -lx when
    facing -lz; here the viewer looks along -lz so right is +lx), v up, w out."""
    yb, yt = P_SHAFT['y0'], P_SHAFT['y1']
    hb, ht = P_SHAFT['hb'], P_SHAFT['ht']
    slope = (ht - hb) / (yt - yb)           # the face leans back as it rises
    O = G(0.0, hb - slope * yb, 0.0)
    W = np.array((0.0, -1.0, -slope))       # out of the face: game +lz is Blender -Y
    return Frame(O, (1.0, 0.0, 0.0), W)


def tool_shapes(tool):
    """The tool's relief outline in panel frame (u, v about the centre),
    sized for a 2.15 by 3.9 panel."""
    out = []
    if tool == 'Hammer':
        ha = math.radians(100)
        out.append(rect(0.0, -0.25, 0.24, 3.0, ha - math.pi / 2))
        hc = (math.cos(ha) * 1.35, -0.25 + math.sin(ha) * 1.35)
        out.append(rect(hc[0], hc[1], 1.45, 0.62, ha - math.pi / 2))
        out.append(rect(hc[0], hc[1], 0.62, 0.84, ha - math.pi / 2))
        out.append(rect(math.cos(ha) * -1.4, -0.25 + math.sin(ha) * -1.4, 0.34, 0.4, ha - math.pi / 2))
    elif tool == 'Tongs':
        for sgn in (-1, 1):
            a = math.radians(90 + sgn * 9)
            out.append(rect(sgn * 0.12, -0.55, 0.15, 2.6, a - math.pi / 2))
            a2 = math.radians(90 - sgn * 24)
            out.append(rect(sgn * 0.3, 1.12, 0.17, 0.95, a2 - math.pi / 2))
        out.append(ellipse(0.0, 0.62, 0.22, 0.22, n=14))
    elif tool == 'Anvil':
        anvil = [(u * 1.35, v * 1.25 + 0.2) for (u, v) in (
            (-0.6, -1.3), (-0.14, -1.3), (-0.08, -1.2), (0.08, -1.2), (0.14, -1.3), (0.6, -1.3), (0.52, -1.16),
            (0.3, -1.02), (0.24, -0.8), (0.3, -0.64), (0.5, -0.57), (0.7, -0.55), (0.7, -0.2), (-0.3, -0.2),
            (-0.55, -0.25), (-0.75, -0.32), (-0.92, -0.38), (-0.72, -0.45), (-0.45, -0.51), (-0.3, -0.57),
            (-0.24, -0.8), (-0.3, -1.02), (-0.52, -1.16))]
        out.append(anvil)
        out.append([(-0.22, 0.42), (0.22, 0.42), (0.12, 1.2), (0.0, 1.45), (-0.12, 1.2)])
    else:  # Bellows
        out.append(ellipse(0.0, 0.1, 0.78, 1.05, n=24, squeeze=0.55))
        out.append(rect(-0.32, 1.28, 0.14, 0.7, 0.18))
        out.append(rect(0.32, 1.28, 0.14, 0.7, -0.18))
        out.append([(-0.15, -0.92), (0.15, -0.92), (0.06, -1.62), (-0.06, -1.62)])
    return out


def seal_pillar_field(tool, rng, cracked=False, voxel=0.05):
    """A seal pillar (origin: its base centre on the terrace floor; front,
    game +lz, toward Korgath). Returns (field, info)."""
    E = 3.4
    f = Sculpt((-E, -E, -0.7), (E, E, 14.8), voxel)
    for (h, y0, y1, ch) in P_TIERS:
        f.put('stone', frustum(-h, h, -h, h, y0, y1, top_in=(0.07,) * 4, chamfer=ch), 0.02)
    f.put('stone', RoundBox(G(0, 0, (P_ROLL['y0'] + P_ROLL['y1']) / 2),
                            (P_ROLL['half'], P_ROLL['half'], (P_ROLL['y1'] - P_ROLL['y0']) / 2), P_ROLL['r']), 0.03)
    hb, ht = P_SHAFT['hb'], P_SHAFT['ht']
    inset = hb - ht
    f.put('stone', frustum(-hb, hb, -hb, hb, P_SHAFT['y0'], P_SHAFT['y1'] + 0.02, top_in=(inset,) * 4,
                           chamfer=P_SHAFT['ch'], chamfer_top=P_SHAFT['ch'] * 0.85), 0.02)
    for (h, y0, y1, ch) in P_CAP:
        f.put('stone', frustum(-h, h, -h, h, y0, y1, chamfer=ch), 0.02)
    # dentils under the cornice, four corner brackets
    for side in range(4):
        a = side * math.pi / 2
        ca, sa = math.cos(a), math.sin(a)
        for j in range(-3, 4):
            u = j * 0.5
            px, py = u * ca + 2.06 * sa, -u * sa + 2.06 * ca
            f.put('stone', RoundBox((px, py, 12.2), (0.13 + 0.06 * abs(sa), 0.13 + 0.06 * abs(ca), 0.17), 0.03), 0.01)
    for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        f.put('stone', RoundBox(G(sx * 1.95, sz * 1.95, 11.75), (0.3, 0.3, 0.55), 0.06), 0.03)
    cr = P_CROWN
    f.put('stone', frustum(-cr['hb'], cr['hb'], -cr['hb'], cr['hb'], cr['y0'], cr['y1'],
                           top_in=((cr['hb'] - cr['ht']),) * 4, chamfer=0.12), 0.03)
    f.put('stone', frustum(-1.3, 1.3, -1.3, 1.3, cr['y1'] - 0.02, cr['y1'] + 0.22, top_in=(0.25,) * 4,
                           chamfer=0.08), 0.02)
    # the chain's eye on its boss (a little anvil of iron): an iron ring
    # standing across the crown
    f.put('iron', RoundBox(G(0, 0, cr['y1'] + 0.32), (0.55, 0.3, 0.12), 0.04), 0.02)
    f.put('iron', RoundBox(G(0, 0, cr['y1'] + 0.22), (0.3, 0.24, 0.12), 0.04), 0.02)
    f.put('iron', Torus(G(0, 0, P_EYE['y'] + 0.25), P_EYE['R'], P_EYE['r'], (1.0, 0.0, 0.0)), 0.02)
    # coursed ashlar
    y = P_SHAFT['y0']
    for h in P_COURSES[:-1]:
        y += h
        f.groove(sg.Slab(G(0, 0, y), (0, 0, 1), (-E, -E, y - 0.4), (E, E, y + 0.4)), 0.07, 0.032)
    y = P_SHAFT['y0']
    for k, h in enumerate(P_COURSES):
        for side in range(4):
            if side == 0:
                continue                       # the front carries the panel
            off = (0.75 if (k + side) % 2 else -0.8) + rng.uniform(-0.15, 0.15)
            a = side * math.pi / 2
            n = np.array((math.sin(a), math.cos(a), 0.0))
            t = np.array((math.cos(a), -math.sin(a), 0.0))
            P0 = t * off
            lo = np.minimum(P0 - n * 3.5, P0 + n * 3.5) - 0.3
            hi = np.maximum(P0 - n * 3.5, P0 + n * 3.5) + 0.3
            lo[2], hi[2] = y + 0.06, y + h - 0.06
            f.groove(sg.Slab(P0, t, lo, hi), 0.06, 0.03)
        y += h
    # riveted iron bands
    for yb in P_BANDS:
        hh = shaft_half(yb) + 0.11
        f.put('iron', RoundBox(G(0, 0, yb), (hh, hh, 0.19), 0.05), 0.02)
        for side in range(4):
            for j in range(-2, 3):
                u = j * hh * 0.42
                a = side * math.pi / 2
                ca, sa = math.cos(a), math.sin(a)
                px, py = u * ca + hh * sa, -u * sa + hh * ca
                f.put('iron', Ellipsoid((px, py, yb), (0.09, 0.09, 0.09)), 0.01)
    # the sunk relief panel on the front and its raised frame
    fr = pillar_front_frame()
    pv0, pv1, pw = P_PANEL['v0'], P_PANEL['v1'], P_PANEL['w']
    vc = (pv0 + pv1) / 2
    fw = P_PANEL['frame']
    f.put('stone', Extrude(fr, rect(0.0, vc, pw + 2 * fw, (pv1 - pv0) + 2 * fw), -0.2, 0.06, r=0.03), 0.01)
    f.sub(Extrude(fr, rect(0.0, vc, pw, pv1 - pv0), -P_PANEL['depth'], 0.4, r=0.02), 0.012)
    for shape in tool_shapes(tool):
        pts = [(u, vc + v) for (u, v) in shape]
        f.put('relief', Extrude(fr, pts, -P_PANEL['depth'] - 0.05, -0.02, r=0.05), 0.015)
    # the rune column over the panel (channels; the builder lays the inlay)
    strokes = []
    g0 = TOOL_GLYPH[tool]
    for k in range(P_RUNES['n']):
        st = glyph_strokes(fr, g0 + k * 2, 0.0, P_RUNES['v0'] + k * P_RUNES['step'], P_RUNES['size'])
        carve_glyph(f, fr, st, 0.065)
        strokes.append(st)
    # the same three marks small on each flank, unlit
    for side in (1, -1):
        a = side * math.pi / 2
        O = G(side * (hb + 0.0), 0.0, 0.0)
        frs = Frame(O, (0.0, side * 1.0, 0.0), (side * 1.0, 0.0, 0.0))
        for k in range(3):
            st = glyph_strokes(frs, g0 + k, 0.0, 3.2 + k * 2.3, 0.62)
            carve_glyph(f, frs, st, 0.05)
    # weathering: chipped arrises, erosion
    for yk in np.linspace(P_SHAFT['y0'] + 0.5, P_SHAFT['y1'] - 0.5, 9):
        for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            if rng.random() < 0.4:
                hh = shaft_half(yk)
                rr = rng.uniform(0.14, 0.32)
                f.sub(Ellipsoid(G(sx * hh, sz * hh, yk + rng.uniform(-0.4, 0.4)),
                                (rr * rng.uniform(0.8, 1.4), rr * rng.uniform(0.8, 1.4), rr * rng.uniform(0.7, 1.3))), 0.04)
    for (h, y0, y1, ch) in P_TIERS + P_CAP:
        for (sx, sz) in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            if rng.random() < 0.5:
                rr = rng.uniform(0.15, 0.3)
                f.sub(Ellipsoid(G(sx * h, sz * h, y1 - 0.05), (rr, rr, rr * 0.8)), 0.04)
    for k in range(3):
        u0 = rng.uniform(-1.0, 1.0)
        v0 = rng.uniform(8.0, 11.0) if k else rng.uniform(1.8, 2.6)
        path = sg.crack_path(rng, (u0, v0), (rng.uniform(-0.4, 0.4), -1.0), rng.uniform(0.7, 1.6), 6, 0.5)
        groove_polyline(f, [fr.at(u, v, 0.0) for (u, v) in path], 0.05, 0.035)
    if cracked:
        # the fissure: a jagged split down the front and round the flank, a
        # corner of the crown and the upper shaft sheared away
        path = sg.crack_path(rng, (0.35, 12.2), (-0.25, -1.0), 9.5, 14, 0.55)
        pts = [fr.at(u, v, 0.0) for (u, v) in path]
        for a, b in zip(pts[:-1], pts[1:]):
            f.sub(RoundCone(a, b, 0.3, 0.22), 0.05)
            f.sub(RoundCone(a - fr.W * 0.7, b - fr.W * 0.7, 0.2, 0.14), 0.04)
            f.sub(RoundCone(a - fr.W * 1.6, b - fr.W * 1.6, 0.1, 0.08), 0.03)
        nrm = np.array((0.62, -0.55, 0.56))
        nrm /= np.linalg.norm(nrm)
        P0 = G(1.2, 1.2, 12.9)
        f.sub(Convex([(tuple(-nrm), float(-nrm @ P0))], (0.0, -3.4, 9.0), (3.4, 0.0, 15.0)), 0.04)
        f.sub(gs.block(rng, G(-1.95, -1.2, 9.2), (1.1, 1.3, 1.6), cuts=6, chamfer=(0.6, 0.85)), 0.05)
        for (bx, bz, s) in ((2.55, 1.9, 0.75), (-2.4, 2.45, 0.55), (2.7, -1.6, 0.45)):
            f.put('stone', gs.block(rng, G(bx, bz, 0.55 + s * 0.35), (s * 1.3, s, s * 0.8), cuts=6,
                                    chamfer=(0.7, 0.9), R=rot_z(rng.uniform(0, math.pi))), 0.03)
    n1, n2 = Noise(171 + len(tool)), Noise(191 + len(tool))
    f.displace(lambda X, Y, Z: 0.018 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 2)
               + 0.008 * n2.fbm(X * 4.0, Y * 4.0, Z * 4.0, 2), band=0.3)
    # rime lodged on every ledge
    for (h, y0, y1, ch) in P_TIERS:
        for k in range(9):
            side = rng.integers(0, 4)
            a = side * math.pi / 2
            u = rng.uniform(-h + 0.3, h - 0.3)
            ca, sa = math.cos(a), math.sin(a)
            r0 = h - rng.uniform(0.08, 0.35)
            px, py = u * ca + r0 * sa, -u * sa + r0 * ca
            f.put('rime', Ellipsoid((px, py, y1 + 0.01), (rng.uniform(0.3, 0.6), rng.uniform(0.2, 0.32), 0.08)), 0.06)
    for (h, y0, y1, ch) in P_CAP[1:]:
        for k in range(6):
            side = rng.integers(0, 4)
            a = side * math.pi / 2
            u = rng.uniform(-h + 0.3, h - 0.3)
            ca, sa = math.cos(a), math.sin(a)
            r0 = h - rng.uniform(0.05, 0.25)
            px, py = u * ca + r0 * sa, -u * sa + r0 * ca
            f.put('rime', Ellipsoid((px, py, y1 + 0.01), (rng.uniform(0.25, 0.5), 0.2, 0.07)), 0.05)
    f.put('rime', Ellipsoid(G(0, 0, cr['y1'] - 0.02), (1.15, 1.15, 0.12)), 0.08)
    # icicles under the crown's corbels and the bands
    for (yk, hk, n) in ((12.0, 2.0, 7), (P_BANDS[2] - 0.19, shaft_half(P_BANDS[2]) + 0.11, 5),
                        (P_BANDS[1] - 0.19, shaft_half(P_BANDS[1]) + 0.11, 3)):
        for side in range(4):
            a = side * math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            for j in range(n):
                if rng.random() < 0.35:
                    continue
                u = rng.uniform(-hk + 0.25, hk - 0.25)
                px, py = u * ca + (hk - 0.05) * sa, -u * sa + (hk - 0.05) * ca
                icicle(f, (px, py, yk + 0.02), rng.uniform(0.25, 0.95), rng.uniform(0.05, 0.1), rng)
    return f, {'frame': fr, 'strokes': strokes}


def pillar_paint(field, cracked, frame=None):
    n1 = Noise(1201)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='stone')
        if frame is not None:
            u, v, w = frame.local(P[:, 0], P[:, 1], P[:, 2])
            vc = (P_PANEL['v0'] + P_PANEL['v1']) / 2
            sunk = (np.abs(u) < P_PANEL['w'] / 2) & (np.abs(v - vc) < (P_PANEL['v1'] - P_PANEL['v0']) / 2) & (w < -0.1)
            ao = np.where(sunk & (labels != 'relief'), ao * 0.55, ao)
        tone = 0.88 + 0.24 * (0.5 + 0.5 * n1.fbm(P[:, 0] * 0.5, P[:, 1] * 0.5, P[:, 2] * 0.4, 3))
        c = mix(BLACK, BLACK_EDGE, np.clip(edge * 0.85, 0, 1)) * tone[:, None]
        c = mix(c, BLACK_EDGE, (labels == 'relief') * 0.45)
        iron = (labels == 'iron').astype(np.float64)
        ic = mix(IRON_DARK, IRON, np.clip(edge + 0.3, 0, 1))
        rust = 0.5 + 0.5 * n1.fbm(P[:, 0] * 3.0, P[:, 1] * 3.0, P[:, 2] * 3.0, 2)
        ic = mix(ic, RUST, np.clip(rust - 0.55, 0, 1) * 0.8)
        c = mix(c, ic, iron)
        c = mix(BLACK_DEEP, c, np.clip(ao ** 1.8, 0, 1))
        up = np.clip(N[:, 2], 0, 1)
        patch = 0.5 + 0.5 * n1.fbm(P[:, 0] * 1.4 + 3, P[:, 1] * 1.4, P[:, 2] * 1.4, 2)
        snow = sstep(0.62, 0.95, up + (patch - 0.5) * 0.3) * np.clip(0.3 + ao, 0, 1)
        rime = (labels == 'rime').astype(np.float64)
        c = mix(c, RIME, np.maximum(snow, rime * (0.8 + 0.2 * patch)))
        ice = (labels == 'ice').astype(np.float64)
        c = mix(c, mix(ICE_CLEAR, ICE_PALE, np.clip(edge + 0.2, 0, 1)), ice)
        # frost climbing the foot (the terrace's cold) and in every joint
        foot = np.clip(1.0 - P[:, 2] / 3.0, 0, 1)
        c = mix(c, FROST, foot * 0.25 * patch + (1 - np.clip(ao, 0, 1)) * 0.12)
        if cracked:
            c = c * (0.92 + 0.08 * np.clip(ao, 0, 1))[:, None]
        return c

    return paint


# ------------------------------------------------------------------ the terrace's kerb
CURB = dict(r0=20.7, r1=21.75, h=0.3, bury=0.35)


def curb_gaps():
    """Game-local (lx, lz, radius) clear circles: the two chain stairs' mouths
    and the Chain Bridge's landing."""
    return [(-21.4, 1.0, 6.4), (21.4, 1.0, 6.4), (0.0, 21.5, 7.0)]


def lock_curb_field(rng, voxel=0.05):
    """The curb stones round the Lock Terrace (origin: the terrace centre on
    its floor), knee low; drifts banked against them."""
    E = 22.6
    f = Sculpt((-E, -E, -CURB['bury'] - 0.1), (E, E, 0.75), voxel)
    gaps = curb_gaps()
    rm = (CURB['r0'] + CURB['r1']) / 2
    n = 52
    for k in range(n):
        a = 2 * math.pi * k / n
        lx, lz = math.cos(a) * rm, math.sin(a) * rm
        if any(math.hypot(lx - gx, lz - gz) < gr for (gx, gz, gr) in gaps):
            continue
        L = 2 * math.pi * rm / n - 0.12
        w = CURB['r1'] - CURB['r0']
        h = CURB['h'] + rng.uniform(-0.05, 0.06)
        c = G(lx, lz, (h - CURB['bury']) / 2)
        # radial (local X across) and tangential (local Y along) in Blender
        Rm = rot_z(-a)
        tilt = gs.rot(rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05), 0.0)
        f.put('stone', gs.block(rng, c, (w, L, h + CURB['bury']), cuts=4, chamfer=(0.86, 0.97), R=Rm @ tilt), 0.02)
        # an incised mark on every fourth stone's top
        if k % 4 == 0:
            O = G(lx, lz, h - 0.01)
            fr = Frame(O, (-math.sin(a), -math.cos(a), 0.0), (0.0, 0.0, 1.0))
            st = glyph_strokes(fr, k // 4, 0.0, -0.3, 0.6)
            for (p0, p1) in st:
                a0 = fr.at(p0[0], p0[1], 0.0)
                a1 = fr.at(p1[0], p1[1], 0.0)
                f.sub(RoundCone(a0, a1, 0.035, 0.035), 0.01)
        # chips off the arrises
        for j in range(2):
            if rng.random() < 0.6:
                t = rng.uniform(-L / 2, L / 2)
                side = rng.choice((CURB['r0'], CURB['r1']))
                px = math.cos(a) * side - math.sin(a) * t
                pz = math.sin(a) * side + math.cos(a) * t
                rr = rng.uniform(0.08, 0.16)
                f.sub(Ellipsoid(G(px, pz, h), (rr, rr, rr)), 0.02)
    # drifts banked against the curb's inner face and in the pillars' lee
    for k in range(26):
        a = rng.uniform(0, 2 * math.pi)
        r = CURB['r0'] - rng.uniform(0.2, 0.9)
        lx, lz = math.cos(a) * r, math.sin(a) * r
        if any(math.hypot(lx - gx, lz - gz) < gr for (gx, gz, gr) in gaps):
            continue
        f.put('snow', Ellipsoid(G(lx, lz, -0.06), (rng.uniform(0.7, 1.6), rng.uniform(0.5, 0.9), rng.uniform(0.18, 0.3))), 0.18)
    n1 = Noise(1709)
    f.displace(lambda X, Y, Z: 0.02 * n1.fbm(X * 2.0, Y * 2.0, Z * 2.0, 2), band=0.2)
    f.cut_below(-CURB['bury'])
    return f


def curb_paint(field):
    n1 = Noise(1777)

    def paint(P, N):
        ao, edge = ao_and_edge(field, P, N)
        labels = field.classify(P, default='stone')
        tone = 0.86 + 0.26 * (0.5 + 0.5 * n1.fbm(P[:, 0] * 0.6, P[:, 1] * 0.6, P[:, 2], 2))
        c = mix(SLATE_DARK, SLATE, np.clip(edge * 0.9 + 0.2, 0, 1)) * tone[:, None]
        c = mix(SLATE_DEEP, c, np.clip(ao ** 1.6, 0, 1))
        up = np.clip(N[:, 2], 0, 1)
        patch = 0.5 + 0.5 * n1.fbm(P[:, 0] * 1.1, P[:, 1] * 1.1, 1.0, 2)
        c = mix(c, FROST, up * patch * 0.35)
        snow = (labels == 'snow').astype(np.float64)
        sc = mix(SNOW_SHADE, RIME, np.clip(up * 0.8 + ao * 0.3, 0, 1))
        return mix(c, sc, snow)

    return paint


# ------------------------------------------------------------------ lip modules
def lip_rock_field(variant, rng, voxel=0.12):
    """A lip module: cleaved slate hanging from a walkway's edge (origin on
    the lip, top a hand under the floor; the module runs along local X, its
    drop face toward game +lz, i.e. Blender -Y). 6.4 long, 18 deep."""
    f = Sculpt((-4.4, -5.2, -18.5), (4.4, 1.4, 0.4), voxel)
    top = -0.14
    dip = gs.rot(0.0, (0.08 if variant % 2 else -0.1), 0.0)
    # the hidden back: a slab under the walk's edge
    f.put('rock', RoundBox(G(0.0, 0.6, -9.0), (3.3, 1.0, 9.2), 0.3), 0.0)
    y = top
    course = 0
    while y > -18.0:
        h = rng.uniform(1.4, 2.6) if y > -5 else rng.uniform(2.4, 4.0)
        out = 1.5 + (0.6 if (course + variant) % 2 else -0.15) + rng.uniform(-0.4, 0.4) - max(0.0, (-y - 8.0)) * 0.1
        x = -3.5 + rng.uniform(-0.4, 0.2)
        while x < 3.4:
            w = rng.uniform(2.0, 3.8)
            if rng.random() < 0.12 and y < -3:
                x += w
                continue
            o = out + rng.uniform(-0.5, 0.5)
            c = G(x + w / 2, o - 0.4, y - h / 2)
            f.put('rock', gs.block(rng, c, (w * 1.1, 2.8 + rng.uniform(0, 0.8), h * 1.1), cuts=6,
                                   chamfer=(0.7, 0.94), R=dip, top_tilt=0.25), 0.16)
            x += w
        y -= h
        course += 1
    for k in range(2):
        px = rng.uniform(-2.5, 2.5)
        pts = [G(px + rng.uniform(-0.1, 0.1), 2.0 + 0.3 * math.sin(j), -0.6 - j * 2.2) for j in range(7)]
        groove_polyline(f, pts, 0.25, 0.16)
    for k in range(10):
        px = rng.uniform(-3.0, 3.0)
        py = rng.uniform(-5.5, -0.8)
        icicle(f, G(px, 2.3 + rng.uniform(0, 0.6), py), rng.uniform(0.6, 2.0), rng.uniform(0.09, 0.17), rng)
    gs.slate_noise(f, 900 + variant, amp=0.28, scale=1.0)
    f.cut_above(top)
    # never behind the lip (the walkway's own body)
    f.sub(Convex([((0.0, -1.0, 0.0), -0.35)], (-5.0, 0.3, -20.0), (5.0, 2.0, 1.0)), 0.0)
    return f
