"""The Jaguar Maw's head as a carved mass, and its megalith skin
(build_wildheart_entrance.py).

The idol inside the Wildheart Basin (kit/jaguar_head_sculpt.py) is one mass
sculpted as a signed distance field. The idol at the door is the same people's
work seen from outside, so it is sculpted the same way, with the same
primitives: a big cat's skull, broad, with a domed forehead that stands a
step over the brows, on a collared neck that plunges into the rise; heavy
brows driven down over slanted sockets; cheekbones and jowls flaring over the
neck; a short deep muzzle (a broad nose, a whisker pad either side of it)
whose upper jaw overhangs the way in and ends on a level lip line; a lower
jaw of two rami either side of the walk-in lane; the maw cut right through to
the throat; two small round ears on the skull's corners. The broad carving is IN the field (the collar's sunk band, the
dishes of the pelt's rosettes, the panels down the nape, the snarl's furrows),
so it runs across the joints of the stones.

The head's field is never meshed whole (only its rubble core, and each ear's
three stones, through mesh_level). megalith_skin() lays fitted blocks out on a chart
of its surface (rows of uneven height, blocks of uneven width, some two rows
tall), and builds each block as its own patch: a face that follows the carved
surface at the block's own proud or slipped depth, fine enough inside the
block for the weathering to grade across it, and a chamfer down into a deep V
joint. A chart is only a family of rays (rays(U, V) -> origins, directions)
marched through the air to the surface: round the outside, up into the
palate, down onto the jaws, round the throat, up under the brows.

Coordinates are Blender's: X west, Y SOUTH (the face looks +Y), Z up, the
origin at the door. G(lx, lz, y) takes door-local game coordinates.
Deterministic: every draw comes from the rng handed in, and every noise is seeded.
"""
import math
import os
import tempfile

import numpy as np

import jaguar_head_sculpt as js
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, RoundBox, RoundCone, rot

TAU = math.tau
AXIS = (0.0, -8.8)        # the neck's axis (the head collider's centre), Blender XY
NECK_R = 7.85             # inside the collider's 8.05
NECK_TOP = 3.1            # nothing overhangs the footprint below this
BULLET_YC = 6.0           # the outside chart: a cylinder up to here, a dome above
BULLET_R0 = 9.5
JAW_TOP = 2.3
JAW_ROT = 0.4455          # the muzzle colliders' yaw
JAW_C = (3.74, 0.968)     # their centre (lx, lz), mirrored
JAW_HALF = (2.62, 1.2)   # the colliders' 2.83 by 1.45, less the lean's reach at the gum line
HEAD_TOP = 17.2           # the crown: a forehead's height over the brows
MUZZLE_FRONT = -4.35      # lz of the upper lip's front: a short, deep, broad muzzle
LIP_Z = 5.0               # the upper lip's line: the flews are cut level here, over the open jaws
EYE = dict(x=4.35, y=10.8, yaw=0.32, slant=0.30, a=1.85, b=1.02)
EAR = dict(x=7.9, lz=5.6, y=16.0, yaw=0.8, back=0.16, roll=0.3, r=3.1, thick=1.15)
NOSE = dict(lz=-5.15, y=8.3)
COLLAR = dict(r=9.2, z0=3.4, z1=5.95, start=1.0)
# the nape's collapse: where the facing has fallen off the rubble behind it
# (bearing from south toward west, height, half width along the wall, half height)
BREACH = dict(th=2.52, z=7.6, hw=2.5, hh=3.3)


def G(lx, lz, y):
    return (lx, -lz, y)


def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ primitives
class VCyl(js.Prim):
    """A plumb drum about (cx, cy) from z0 to z1."""

    def __init__(self, cx, cy, r, z0, z1):
        self.cx, self.cy, self.r, self.z0, self.z1 = cx, cy, r, z0, z1
        self.lo = np.array((cx - r, cy - r, z0))
        self.hi = np.array((cx + r, cy + r, z1))

    def dist(self, X, Y, Z):
        q = np.sqrt((X - self.cx) ** 2 + (Y - self.cy) ** 2) - self.r
        dz = np.maximum(self.z0 - Z, Z - self.z1)
        return np.minimum(np.maximum(q, dz), 0.0) + np.sqrt(np.maximum(q, 0.0) ** 2 + np.maximum(dz, 0.0) ** 2)


class Corbel(js.Prim):
    """Corbelled courses under the jowls and the nape, where the ground has
    fallen away from the neck: each ring starts `rise` over under(theta), the
    height below which nothing may leave the collider's footprint THERE."""

    def __init__(self, steps, under, top):
        self.steps, self.top = steps, top
        self.table = np.asarray(under, dtype=np.float64)
        r = max(s[0] for s in steps)
        self.lo = np.array((AXIS[0] - r, AXIS[1] - r, float(self.table.min())))
        self.hi = np.array((AXIS[0] + r, AXIS[1] + r, top))

    def under(self, theta):
        n = len(self.table)
        f = (theta % TAU) / TAU * n
        i = np.floor(f).astype(int) % n
        t = f - np.floor(f)
        return self.table[i] * (1 - t) + self.table[(i + 1) % n] * t

    def dist(self, X, Y, Z):
        rho = np.sqrt((X - AXIS[0]) ** 2 + (Y - AXIS[1]) ** 2)
        zu = self.under(np.arctan2(X - AXIS[0], Y - AXIS[1]))
        out = None
        for (r, rise) in self.steps:
            d = np.maximum(np.maximum(rho - r, zu + rise - Z), Z - self.top)
            out = d if out is None else np.minimum(out, d)
        return out


class Collar(js.Prim):
    """The collar: one course of tall stones standing proud round the neck,
    under the skull's overhang, from behind one jowl round the nape to the
    other. Its face is a sunk band between two rims (the fret stands in it)."""

    def __init__(self):
        r = COLLAR['r']
        self.lo = np.array((AXIS[0] - r, AXIS[1] - r, COLLAR['z0']))
        self.hi = np.array((AXIS[0] + r, AXIS[1] + r, COLLAR['z1']))

    @staticmethod
    def band(Z):
        """1 in the sunk band, 0 on the rims."""
        z0, z1 = COLLAR['z0'], COLLAR['z1']
        return sstep(z0 + 0.3, z0 + 0.44, Z) * sstep(z1 - 0.3, z1 - 0.44, Z)

    def dist(self, X, Y, Z):
        rho = np.sqrt((X - AXIS[0]) ** 2 + (Y - AXIS[1]) ** 2)
        th = np.abs(np.arctan2(X - AXIS[0], Y - AXIS[1]))
        on = sstep(COLLAR['start'] - 0.2, COLLAR['start'] + 0.15, th)
        r = NECK_R - 0.7 + (COLLAR['r'] - NECK_R + 0.7) * on - 0.2 * self.band(Z)
        mid, half = (COLLAR['z0'] + COLLAR['z1']) / 2, (COLLAR['z1'] - COLLAR['z0']) / 2
        qx = rho - r + 0.4
        qz = np.abs(Z - mid) - half + 0.4
        return np.minimum(np.maximum(qx, qz), 0.0) + np.sqrt(np.maximum(qx, 0.0) ** 2 + np.maximum(qz, 0.0) ** 2) - 0.4


class Nose(js.Prim):
    """The nose leather: one dark stone let into the muzzle's front, broad
    across the top and cut in under each wing to the lip's split, as a cat's is."""

    def __init__(self):
        self.box = RoundBox(G(0, NOSE['lz'] + 0.62, NOSE['y']), (1.85, 0.62, 0.95), 0.46, rot(rx=0.28))
        self.cuts = [Ellipsoid(G(s * 2.15, NOSE['lz'] + 0.3, NOSE['y'] - 1.02), (1.1, 1.3, 0.98)) for s in (1, -1)]
        self.lo, self.hi = self.box.lo, self.box.hi

    def dist(self, X, Y, Z):
        d = self.box.dist(X, Y, Z)
        for c in self.cuts:
            d = js.smax(d, -c.dist(X, Y, Z), 0.12)
        return d


class Breach(js.Prim):
    """The collapse in the nape as a volume: an uneven hollow bitten into the
    wall, widest low down where the collar burst."""

    def __init__(self):
        b = BREACH
        self.c = np.array((AXIS[0] + math.sin(b['th']) * 9.3, AXIS[1] + math.cos(b['th']) * 9.3, b['z']))
        self.R = rot(rz=-b['th'])
        self.noise = Noise(41)
        self.lo, self.hi = self.c - 5.0, self.c + 5.0

    def dist(self, X, Y, Z):
        b = BREACH
        Ri = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        a = Ri[0, 0] * px + Ri[0, 1] * py            # along the wall
        o = Ri[1, 0] * px + Ri[1, 1] * py            # out of it
        w = b['hw'] * (1.0 - 0.3 * np.clip(pz / b['hh'], -1.0, 1.0))
        deep = 1.9 * (1.0 - 0.6 * np.clip(pz / b['hh'], 0.0, 1.0))      # shallower toward its top
        k = np.sqrt((a / w) ** 2 + (pz / b['hh']) ** 2 + (o / deep) ** 2)
        return (k - 1.0) * 1.6 + 0.5 * self.noise.fbm(X * 0.45, Y * 0.45, Z * 0.45, 2)


class Maw(js.Prim):
    """The maw and the throat behind it: an arched tunnel along the lane that
    narrows from the open jaws to the throat's window (the engine's flooded
    throat is drawn in a window of half 2.5, spring 3.6 at lz 1.3). Its walls
    drop plumb to under the ground: the jaws' inner faces. The palate is
    ribbed across."""
    FRONT, WINDOW, BACK = -5.4, 1.3, 4.6

    def __init__(self):
        self.lo = np.array((-3.8, -self.BACK, -8.0))
        self.hi = np.array((3.8, 9.5, 7.4))

    @classmethod
    def section(cls, lz):
        t = sstep(cls.FRONT, cls.WINDOW, lz)
        w = 3.3 + (2.5 - 3.3) * t
        spring = 4.6 + (3.6 - 4.6) * t
        rise = 2.1 + (2.5 - 2.1) * t
        return w, spring, rise

    def dist(self, X, Y, Z):
        lz = -Y
        w, spring, rise = self.section(lz)
        rise = rise * (1 + 0.045 * np.sin(lz * TAU / 1.25) * sstep(0.6, -0.4, lz))
        ax = np.abs(X)
        k = np.sqrt((ax / w) ** 2 + (np.maximum(Z - spring, 0.0) / rise) ** 2)
        d = np.where(Z > spring, (k - 1.0) * np.minimum(w, rise), ax - w)
        return np.maximum(d, lz - self.BACK)


# ------------------------------------------------------------------ the field
def _fill(field, prim, slab=24):
    """The first mass, evaluated over the WHOLE grid (so the field is a true
    distance everywhere a ray may start)."""
    ax = field.axes
    for i in range(0, field.shape[0], slab):
        X, Y, Z = np.meshgrid(ax[0][i:i + slab], ax[1], ax[2], indexing='ij')
        field.d[i:i + slab] = prim.dist(X, Y, Z).astype(np.float32)


def jaw_boxes():
    """The lower jaw's two rami: the muzzle colliders' own boxes, a hand
    inside them, from under the ground to the gum line."""
    out = []
    for s in (1, -1):
        c = G(s * JAW_C[0], JAW_C[1], (JAW_TOP - 5.2) / 2)
        out.append(RoundBox(c, (JAW_HALF[0], JAW_HALF[1], (JAW_TOP + 5.2) / 2), 0.22, rot(rz=-s * JAW_ROT)))
    return out


def nose_prim():
    return Nose()


def build_head(under, voxel=0.13):
    """The head's mass, before the sockets and the relief. `under` is the
    corbel table: for 72 bearings round the neck (from south, toward west),
    the height below which nothing may overhang there.

    A big cat's head, not a reptile's: a high domed cranium whose forehead
    stands a clear step over the brows; a short muzzle as deep as it is long
    and more than half the skull's width, whose bridge falls from that step to
    a broad nose; whisker pads round either side of the nose, running back
    into cheeks and jowls wider than the skull; small round ears on the
    skull's corners (build_ear)."""
    f = js.Field((-13.0, -20.6, -6.6), (13.0, 8.0, HEAD_TOP + 0.26), voxel)
    _fill(f, Ellipsoid(G(0, 8.6, 8.8), (8.7, 10.0, 8.4)))
    f.add(VCyl(AXIS[0], AXIS[1], NECK_R, -7.0, 4.6), 0.5)
    # where the ground has fallen away, corbelled courses carry the collar
    f.add(Corbel([(8.2, 0.0), (8.6, 0.85), (9.0, 1.7)], under, COLLAR['z0'] + 0.5), 0.2)
    f.add(Collar(), 0.3)
    # the cheeks: the jowl hung over the neck, the masseter over it, the head's
    # widest; the cheekbone, a hard crest from under the eye back toward the ear
    for s in (1, -1):
        f.add(Ellipsoid(G(s * 6.6, 5.4, 5.9), (4.0, 5.4, 2.4)), 1.0)
        f.add(Ellipsoid(G(s * 7.3, 3.6, 7.3), (3.5, 5.2, 3.5)), 1.2)
        f.add(Ellipsoid(G(s * 8.2, 2.6, 9.2), (2.5, 4.6, 1.2), rot(rx=-0.24, rz=-s * 0.12)), 0.7)
    # the occiput swelling over the collar, and the ridge down the skull's back
    f.add(Ellipsoid(G(0, 13.8, 9.6), (7.4, 5.0, 5.2)), 1.6)
    f.add(RoundCone(G(0, 7.5, 16.0), G(0, 17.6, 9.8), 1.3, 1.5), 1.0)
    # the forehead: a dome standing right over the brows (the step a cat's
    # profile has between its forehead and its nose)
    f.add(Ellipsoid(G(0, 2.6, 12.6), (6.8, 4.9, 4.4)), 1.4)
    # the brows: heavy ridges driven down at the bridge, over the eyes
    for s in (1, -1):
        f.add(RoundCone(G(s * 1.1, -0.9, 11.9), G(s * 7.9, 1.9, 13.1), 1.45, 0.95), 0.7)
        f.add(RoundCone(G(s * 5.6, 1.3, 12.9), G(s * 8.6, 3.8, 12.4), 0.95, 0.7), 0.9)
    # the muzzle: a deep block under a broad flat bridge, the whisker pads
    # round either side of the nose, each run back into its cheek so the
    # flank is one slope (no crease for a chart to miss)
    f.add(RoundBox(G(0, -1.55, 6.45), (4.2, 2.8, 2.15), 1.5), 1.4)
    f.add(RoundBox(G(0, -2.3, 8.2), (2.1, 2.55, 1.45), 1.0, rot(rx=-0.3)), 1.0)
    for s in (1, -1):
        f.add(Ellipsoid(G(s * 2.6, -3.0, 6.5), (2.7, 1.8, 2.05)), 0.7)
        f.add(Ellipsoid(G(s * 5.2, -0.5, 6.5), (2.1, 2.3, 2.0)), 1.0)
    f.add(nose_prim(), 0.3)
    # the upper lip's line: the flews end level, with a hard edge, over the
    # open jaws (the face above it and the palate under it meet on that edge)
    f.sub(RoundBox(G(0, -2.9, LIP_Z - 1.3), (7.4, 3.3, 1.3), 0.08), 0.08)
    # the lower jaw, and the hinges that carry it into the jowls
    for (s, box) in zip((1, -1), jaw_boxes()):
        f.add(box, 0.3)
        c, sn = math.cos(JAW_ROT), math.sin(JAW_ROT)
        hx, hz = s * (JAW_C[0] + 1.45 * c - 0.35 * sn), JAW_C[1] + 1.45 * sn + 0.35 * c
        f.add(RoundBox(G(hx, hz, 0.2), (1.15, 0.9, 5.3), 0.3, rot(rz=-s * JAW_ROT)), 0.7)
    return f


def carve_maw(f):
    maw = Maw()
    f.sub(maw, 0.3)
    # the gums: a ridge inside the upper lip, another along each ramus
    front = MUZZLE_FRONT + 0.3
    w0, s0, _ = Maw.section(front)
    pts = []
    for lz in (-0.7, -1.7, -2.7, front + 0.5):
        w, sp, rise = Maw.section(lz)
        zg = LIP_Z + 0.22
        pts.append(G(w * math.sqrt(max(0.1, 1 - ((zg - sp) / rise) ** 2)) - 0.05, lz, zg))
    arc = [G(math.cos(a) * (w0 - 0.15), front - 0.25 * math.sin(a), s0 - 0.3 + math.sin(a) * 2.05)
           for a in (0.55, 0.9, 1.3)]
    f.add(Polyline(pts + arc, 0.3), 0.6)
    f.add(Polyline([(-x, y, z) for (x, y, z) in pts + arc], 0.3), 0.6)
    for s in (1, -1):
        row = []
        for lz in (-0.15, 0.45, 1.05):
            w, _sp, _r = Maw.section(lz)
            row.append(G(s * (w + 0.5), lz, JAW_TOP - 0.05))
        f.add(Polyline(row, 0.34), 0.25)
    return maw


def eye_frames(f):
    """Where the eyes sit: for each, the socket's floor and its facing, found
    on the uncarved face. Returns [(sign, centre, normal)]."""
    out = []
    for s in (1, -1):
        n = np.array((s * math.sin(EYE['yaw']), math.cos(EYE['yaw']), -0.07))
        n /= np.linalg.norm(n)
        o = np.array((G(s * EYE['x'], 0, EYE['y']))) + n * 6.0
        p, hit = march(f, o[None, :], -n[None, :], np.zeros(1), 9.0)
        out.append((s, p[0], n))
    return out


def carve_sockets(f, frames):
    for (s, c, n) in frames:
        R = rot(ry=-s * EYE['slant'], rz=-s * EYE['yaw'])
        f.sub(Ellipsoid(c - n * 0.25, (EYE['a'] + 0.7, 1.45, EYE['b'] + 0.45), R), 0.45)


# the three panels down the nape (centre height, half height), and the strip's half width
NAPE_PANELS = ((7.95, 1.25), (10.75, 1.15), (13.3, 1.0))
NAPE_HALF = 1.95
# the whisker pads' pits (lx, y), mirrored
WHISKERS = ((1.5, 7.05), (2.6, 7.25), (3.7, 7.0), (2.0, 6.0), (3.1, 6.05), (4.1, 5.9))


class Relief:
    """What the builders cut into the stone, as patterns over space near the
    surface, each in [0, 1]: the collar's sunk band, a shallow dish under each
    rosette of the pelt, the sunk panels down the nape in their raised frames.
    carve() cuts them into the field; the skin reads the same patterns to
    darken what is sunk. What stands IN them (the dark stones of each
    rosette, the fret in the collar's band, the signs in the panels) is let
    in by the builder as stones of its own, so it is cut as sharp as a
    megalith's edge and reads from the road."""

    def __init__(self, rosettes):
        self.rosettes = rosettes        # [(centre, normal, radius, phase)]

    @staticmethod
    def collar(X, Y, Z):
        rho = np.sqrt((X - AXIS[0]) ** 2 + (Y - AXIS[1]) ** 2)
        th = np.abs(np.arctan2(X - AXIS[0], Y - AXIS[1]))
        return Collar.band(Z) * (th > COLLAR['start'] + 0.12) * (rho > NECK_R + 0.35)

    def dishes(self, X, Y, Z):
        out = np.zeros_like(X)
        P = np.stack([X, Y, Z], axis=1)
        for (c, _n, r, _ph) in self.rosettes:
            v = P - c
            d2 = np.einsum('ij,ij->i', v, v)
            near = np.nonzero(d2 < (r + 0.8) ** 2)[0]
            if len(near):
                out[near] = np.maximum(out[near], sstep(r + 0.75, r + 0.3, np.sqrt(d2[near])))
        return out

    @staticmethod
    def nape(X, Y, Z):
        """(frame, panel) of the panels down the back of the skull."""
        cx, cy = AXIS
        th = np.arctan2(X - cx, Y - cy)
        back = (math.pi - np.abs(th)) * COLLAR['r']
        behind = Y < cy - 4.0
        frame = np.zeros_like(X)
        panel = np.zeros_like(X)
        for (zc, hh) in NAPE_PANELS:
            m = np.maximum(back - NAPE_HALF, np.abs(Z - zc) - hh)
            inner = sstep(-0.3, -0.5, m)
            frame = np.maximum(frame, sstep(0.08, -0.04, m) * (1.0 - inner))
            panel = np.maximum(panel, inner)
        return frame * behind, panel * behind

    def carve(self, f):
        def dish(X, Y, Z):
            return 0.1 * self.dishes(X, Y, Z)
        f.displace(dish, band=0.5)

        def nape(X, Y, Z):
            frame, panel = self.nape(X, Y, Z)
            return 0.3 * panel - 0.12 * frame
        f.displace(nape, band=0.6)

    def shade(self, P):
        """How much darker (or lighter) the carving leaves each point."""
        X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
        frame, panel = self.nape(X, Y, Z)
        return (1.0 - 0.14 * self.dishes(X, Y, Z)) * (1.0 - 0.4 * panel) * (1.0 + 0.1 * frame) \
            * (1.0 - 0.3 * self.collar(X, Y, Z))


def carve_relief(f, relief, seed=7):
    """Cut the builders' relief into the field, then the snarl, the lip's
    split, the nostrils and the whisker pits; break the nape open; then
    weather, crack and chip it. Returns the whisker pits' places."""
    relief.carve(f)

    def cut(pts, depth, width):
        q = f.snap(np.array(pts, dtype=np.float64), lift=0.0, steps=6)
        f.groove(Polyline([tuple(v) for v in q], 0.05), depth, width)
    # the snarl: the nose's skin drawn up in furrows across the bridge
    for k in range(3):
        lz = -3.9 + k * 1.0
        y = 10.34 + 0.31 * (lz + 0.29)
        cut([G(-2.0, lz + 0.55, y - 0.6), G(-0.9, lz + 0.12, y), G(0.9, lz + 0.12, y), G(2.0, lz + 0.55, y - 0.6)], 0.36, 0.4)
    for s in (1, -1):
        # the furrow that parts each whisker pad from the bridge
        cut([G(s * 2.0, -4.7, 8.5), G(s * 3.0, -3.1, 8.75), G(s * 4.0, -1.3, 9.0)], 0.34, 0.42)
        # the forehead knit over the bridge
        cut([G(s * 0.9, -2.2, 13.2), G(s * 1.3, -1.6, 14.6), G(s * 1.9, -0.4, 16.0)], 0.26, 0.36)
        # the fold behind each whisker pad: it is what parts a cat's muzzle from its cheek
        cut([G(s * 4.3, -1.4, 8.8), G(s * 5.5, -2.0, 7.6), G(s * 5.95, -2.0, 6.4), G(s * 5.8, -1.8, 5.4)], 0.3, 0.6)
        # the shadow line cut under the cheekbone
        cut([G(s * 5.4, -0.9, 7.95), G(s * 8.8, 1.2, 7.9), G(s * 10.2, 5.0, 8.3)], 0.4, 0.45)
    # the nostrils, and the split of the lip under the nose
    for s in (1, -1):
        f.sub(Ellipsoid(G(s * 0.9, NOSE['lz'] + 0.02, NOSE['y'] + 0.02), (0.55, 0.5, 0.3), rot(ry=s * 0.5)), 0.12)
    cut([G(0, NOSE['lz'] + 0.3, NOSE['y'] - 0.9), G(0, MUZZLE_FRONT - 0.35, 7.0), G(0, MUZZLE_FRONT - 0.1, 6.4)], 0.4, 0.3)
    O = np.array([(s * x, 9.0, y) for s in (1, -1) for (x, y) in WHISKERS], dtype=np.float64)
    pits, _hit = march(f, O, np.tile(np.array((0.0, -1.0, 0.0)), (len(O), 1)), np.zeros(len(O)), 17.0)
    for q in pits:
        f.sub(Ellipsoid(q, (0.34, 0.34, 0.34)), 0.1)
    # the collapse
    f.sub(Breach(), 0.22)
    # centuries
    n1, n2 = Noise(seed), Noise(seed + 12)
    f.displace(lambda X, Y, Z: 0.11 * n1.fbm(X * 0.23, Y * 0.23, Z * 0.23, 3) + 0.045 * n1.fbm(X * 0.9 + 9, Y * 0.9, Z * 0.9, 2),
               band=0.6)
    f.displace(lambda X, Y, Z: 0.5 * np.maximum(0.0, n2.ridged(X * 0.16, Y * 0.16, Z * 0.12, 3) - 1.12), band=0.6)
    rng = np.random.default_rng(seed)
    for (x, lz, y, r) in ((-9.7, 3.6, 12.9, 1.0), (-4.6, -0.6, 15.0, 0.9), (4.6, -3.9, 4.7, 0.5), (-6.6, -0.6, 2.2, 0.8),
                          (-8.6, 11.0, 3.6, 1.1), (2.5, 17.8, 5.2, 1.0), (9.9, 5.6, 3.9, 0.9), (-3.6, -4.5, 7.9, 0.45)):
        f.sub(Ellipsoid(G(x, lz, y), (r * rng.uniform(1.0, 1.5), r, r * rng.uniform(0.8, 1.2))), 0.3)
    return pits


def build_ear(sign, broken, bpy, voxel=0.1, tris=(170, 230, 170)):
    """One ear: small, thick and round, as a big cat's is, set on the skull's
    corner and turned a little outward, a deep hollow in its face. Three
    stones, one on another, each hewn whole (meshed from the form, not laid
    out in blocks). The east one has lost a corner of its top stone. Returns
    ([(vertices, polygons)], centre, frame)."""
    e = EAR
    r, t = e['r'], e['thick']
    c = np.array(G(sign * e['x'], e['lz'], e['y']))
    R = rot(rx=e['back'], ry=sign * e['roll'], rz=-sign * e['yaw'])
    face = R @ np.array((0.0, 1.0, 0.0))
    f = js.Field(c - (r + 1.7), c + (r + 1.7), voxel)
    _fill(f, Ellipsoid(c, (r, t, r), R))
    # the root, thick, run down into the skull
    f.add(Ellipsoid(c + R @ np.array((0.0, -0.15, -r * 0.8)), (r * 0.92, t * 1.35, r * 0.75), R), 0.7)
    # the hollow, and the fold inside it
    f.sub(Ellipsoid(c + face * (t * 0.95) + R @ np.array((0.0, 0.0, -0.25)), (r - 0.72, t * 0.85, r - 0.62), R), 0.22)
    f.add(RoundCone(c + face * 0.15 + R @ np.array((-sign * 0.5, 0.0, -1.6)),
                    c + face * 0.2 + R @ np.array((-sign * 0.2, 0.0, 0.9)), 0.3, 0.14), 0.2)
    nz = Noise(31 + (0 if sign > 0 else 5))
    if broken:
        n = np.array((sign * 0.8, 0.0, 1.0))
        n /= np.linalg.norm(n)
        q = c + np.array((0.0, 0.0, 2.0))

        class Half(js.Prim):
            lo, hi = c - 9.0, c + 9.0

            def dist(self, X, Y, Z):
                return -((X - q[0]) * n[0] + (Y - q[1]) * n[1] + (Z - q[2]) * n[2]) \
                    + 0.35 * nz.fbm(X * 1.1, Y * 1.1, Z * 1.1, 2)
        f.sub(Half(), 0.12)
    f.displace(lambda X, Y, Z: 0.08 * nz.fbm(X * 0.5, Y * 0.5, Z * 0.5, 3), band=0.6)
    # the beds between the three stones, a little out of level
    X, Y, Z = np.meshgrid(f.axes[0], f.axes[1], f.axes[2], indexing='ij')
    up = R @ np.array((sign * 0.06, 0.0, 1.0))
    up /= np.linalg.norm(up)
    zl = ((X - c[0]) * up[0] + (Y - c[1]) * up[1] + (Z - c[2]) * up[2]).astype(np.float32)
    beds = (-9.0, -1.2, 0.85, 9.0)
    stones = []
    for i in range(3):
        slab = np.maximum(beds[i] - zl, zl - beds[i + 1]) + np.float32(0.03)

        class Stone:
            d = js.smax(f.d, slab, 0.1)
            voxel = f.voxel
            lo = f.lo
        if float(Stone.d.min()) > -0.25:
            continue
        stones.append(mesh_level(Stone, bpy, tris[i]))
    return stones, c, R, beds


_MESHED = [0]


def mesh_level(field, bpy, target_tris):
    """The zero set of a field as (vertices, polygons), decimated to
    target_tris: js.mesh_field, with a volume file of its own for every call.
    Blender keeps a volume by its path, so a second mesh read from the same
    file would be the first one again."""
    import bmesh
    import openvdb as vdb

    _MESHED[0] += 1
    g = vdb.FloatGrid(background=float(js.BIG))
    g.copyFromArray(field.d)
    g.transform = vdb.createLinearTransform(voxelSize=field.voxel)
    g.name = 'density'
    path = os.path.join(tempfile.gettempdir(), 'wildheart_entrance_%d_%d.vdb' % (os.getpid(), _MESHED[0]))
    vdb.write(path, grids=[g])
    before = set(bpy.data.objects)
    bpy.ops.object.volume_import(filepath=path)
    vol = [o for o in bpy.data.objects if o not in before][0]
    me = bpy.data.meshes.new('WildheartSculpt')
    ob = bpy.data.objects.new('WildheartSculpt', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('v2m', 'VOLUME_TO_MESH')
    mod.object = vol
    mod.grid_name = 'density'
    mod.threshold = 0.0
    mod.adaptivity = 0.0
    mod.resolution_mode = 'GRID'
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    ob.modifiers.clear()
    ob.data = mesh
    data = vol.data
    bpy.data.objects.remove(vol, do_unlink=True)
    bpy.data.volumes.remove(data)
    mesh.calc_loop_triangles()
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, target_tris / max(1, len(mesh.loop_triangles)))
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.update()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bm = bmesh.new()
    bm.from_mesh(out)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    verts = np.array([tuple(v.co) for v in bm.verts]) + field.lo
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob, do_unlink=True)
    for m in (me, mesh, out):
        bpy.data.meshes.remove(m)
    try:
        os.remove(path)
    except OSError:
        pass
    return verts, faces


def coarse_normal(field, P, h=0.45):
    """The surface's facing at P read over a hand's breadth, so the relief,
    the joints and the chips do not tip it: what the charts that share a
    surface agree on."""
    g = np.zeros_like(P)
    for a in range(3):
        e = np.zeros(3)
        e[a] = h
        g[:, a] = field.sample(P + e) - field.sample(P - e)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def liner(field, bpy, depth=0.36, target_tris=2600):
    """The head's rubble core: the field's own level set a hand under the
    joints' bottoms, meshed whole through OpenVDB at half the field's
    resolution and decimated hard. It is never seen as a surface; it is what
    stands behind every joint, chip and seam of the skin, so that none of
    them is a hole. Returns (vertices, polygons)."""
    class Half:
        d = np.ascontiguousarray(field.d[::2, ::2, ::2]) + np.float32(depth)
        voxel = field.voxel * 2
        lo = field.lo
    return mesh_level(Half, bpy, target_tris)


# ------------------------------------------------------------------ rays
def march(field, O, D, L, tmax, iters=120, step_max=0.3):
    """March each ray from O along D (unit) through the air to the level set
    L of the field. Returns (points, hit). A ray that starts inside the stone,
    or leaves tmax without meeting it, is a miss."""
    n = len(O)
    t = np.zeros(n)
    tmax = np.broadcast_to(np.asarray(tmax, dtype=np.float64), (n,)).copy()
    L = np.asarray(L, dtype=np.float64)
    hit = np.zeros(n, dtype=bool)
    lo = np.zeros(n)
    alive = np.ones(n, dtype=bool)
    d0 = field.sample(O) - L
    alive &= d0 > 0.0
    crossed = np.zeros(n, dtype=bool)
    for _ in range(iters):
        idx = np.nonzero(alive)[0]
        if not len(idx):
            break
        d = field.sample(O[idx] + D[idx] * t[idx, None]) - L[idx]
        inside = d <= 0.0
        crossed[idx[inside]] = True
        alive[idx[inside]] = False
        go = idx[~inside]
        lo[go] = t[go]
        t[go] += np.clip(d[~inside] * 0.7, 0.012, step_max)
        gone = go[t[go] > tmax[go]]
        alive[gone] = False
    idx = np.nonzero(crossed)[0]
    if len(idx):
        a, b = lo[idx].copy(), t[idx].copy()
        for _ in range(12):
            m = (a + b) / 2
            d = field.sample(O[idx] + D[idx] * m[:, None]) - L[idx]
            a = np.where(d > 0, m, a)
            b = np.where(d > 0, b, m)
        t[idx] = (a + b) / 2
        hit[idx] = True
    return O + D * t[:, None], hit


class Bullet:
    """The outside chart: plumb rings of level rays below BULLET_YC, a dome of
    rays through one centre above it. U is the bearing (0 south, toward
    west), V the height (above the cylinder, R0 times the elevation)."""
    wrap = True
    u0, u1 = 0.0, TAU
    per_u = 8.0

    def __init__(self, far=17.0):
        self.far = far
        self.tmax = far - 0.4

    def rays(self, U, V):
        phi = np.maximum(V - BULLET_YC, 0.0) / BULLET_R0
        cp, sp = np.cos(phi), np.sin(phi)
        out = np.stack([cp * np.sin(U), cp * np.cos(U), sp], axis=1)
        base = np.stack([np.full_like(U, AXIS[0]), np.full_like(U, AXIS[1]), np.minimum(V, BULLET_YC)], axis=1)
        return base + out * self.far, -out


class Plane:
    """A flat chart: rays along `d` from the plane through `o` spanned by eu, ev."""
    wrap = False

    def __init__(self, o, eu, ev, d, u, v, tmax):
        self.o, self.eu, self.ev, self.d = (np.asarray(q, dtype=np.float64) for q in (o, eu, ev, d))
        (self.u0, self.u1), (self.v0, self.v1) = u, v
        self.tmax = tmax

    def rays(self, U, V):
        O = self.o + U[:, None] * self.eu + V[:, None] * self.ev
        return O, np.broadcast_to(self.d, O.shape).copy()


class Annulus:
    """The chart of what overhangs the neck (the jowls, the nape, the corbels):
    plumb rays UP from a ring round the neck's axis, U the bearing, V the radius."""
    wrap = False
    per_u = 9.0

    def __init__(self, z, u, v, tmax):
        self.z, self.tmax = z, tmax
        (self.u0, self.u1), (self.v0, self.v1) = u, v

    def rays(self, U, V):
        O = np.stack([AXIS[0] + V * np.sin(U), AXIS[1] + V * np.cos(U), np.full_like(U, self.z)], axis=1)
        return O, np.tile(np.array((0.0, 0.0, 1.0)), (len(U), 1))


class Tunnel:
    """The throat's chart: rays out from the lane's axis, U along it (lz), V
    the arc round it (rho0 times the angle from the west horizon over the top)."""
    wrap = False
    rho0 = 3.0

    def __init__(self, z, u, a, tmax=5.2):
        self.z = z
        self.u0, self.u1 = u
        self.v0, self.v1 = a[0] * self.rho0, a[1] * self.rho0
        self.tmax = tmax

    def rays(self, U, V):
        a = V / self.rho0
        O = np.stack([np.zeros_like(U), -U, np.full_like(U, self.z)], axis=1)
        return O, np.stack([np.cos(a), np.zeros_like(a), np.sin(a)], axis=1)


class Sphere:
    """A chart round one centre: U the bearing round `axis` (the pole), V the
    polar arc from the pole (r0 times the angle). Marches inward from `far`."""
    wrap = True
    u0, u1 = 0.0, TAU
    per_u = 1.5

    def __init__(self, c, R, r0, v, far=5.6, pole='y'):
        self.c, self.R, self.r0, self.far, self.pole = np.asarray(c), R, r0, far, pole
        self.v0, self.v1 = v
        self.tmax = far - 0.3

    def rays(self, U, V):
        th = V / self.r0
        # the pole is the frame's +Y (the ear's face) or its +Z (its tip)
        if self.pole == 'z':
            loc = np.stack([np.sin(th) * np.cos(U), np.sin(th) * np.sin(U), np.cos(th)], axis=1)
        else:
            loc = np.stack([np.sin(th) * np.cos(U), np.cos(th), np.sin(th) * np.sin(U)], axis=1)
        out = loc @ self.R.T
        return self.c + out * self.far, -out


# ------------------------------------------------------------------ the skin
def _row_arc(field, chart, v, n):
    """The surface's running length along U at height v (n samples)."""
    U = chart.u0 + (chart.u1 - chart.u0) * np.arange(n + 1) / n
    O, D = chart.rays(U, np.full(n + 1, v))
    P, hit = march(field, O, D, np.zeros(n + 1), chart.tmax)
    seg = np.linalg.norm(P[1:] - P[:-1], axis=1)
    miss = getattr(chart, 'per_u', 1.0) * (chart.u1 - chart.u0) / n
    seg = np.where(hit[1:] & hit[:-1], np.minimum(seg, 0.9), miss)
    return U, np.concatenate([[0.0], np.cumsum(seg)])


def _joints(rng, U, S, width, wrap):
    """Joint positions (U) along a row whose running length is S(U)."""
    total = S[-1]
    cuts = []
    s = rng.uniform(0.0, width[1]) if wrap else 0.0
    start = s
    while True:
        cuts.append(s)
        s += rng.uniform(*width)
        if s > start + total - width[0] * 0.65:
            break
    if not wrap:
        cuts.append(total)
    return [float(np.interp(c % total if wrap else c, S, U)) for c in cuts], cuts


def lay_out(field, chart, rng, rows, width, tall=0.16, samples=420):
    """Fitted blocks over a chart: `rows` are the bed joints (V), each row cut
    into blocks of `width(v)` yards; in each pair of rows some blocks stand
    two rows tall. Returns [(ua, ub, va, vb, length)] (ub > ua, past u1 when
    a block of a wrapped chart crosses the seam)."""
    span = chart.u1 - chart.u0
    per_row = []
    for i in range(len(rows) - 1):
        v = (rows[i] + rows[i + 1]) / 2
        U, S = _row_arc(field, chart, v, samples)
        us, _ = _joints(rng, U, S, width(v), chart.wrap)
        us = sorted(us)
        if chart.wrap:
            us = us + [us[0] + span]
        per_row.append((us, U, S))
    blocks = []

    def length(U, S, ua, ub):
        total = S[-1]
        a = float(np.interp((ua - chart.u0) % span + chart.u0, U, S)) if chart.wrap else float(np.interp(ua, U, S))
        b = float(np.interp((ub - chart.u0) % span + chart.u0, U, S)) if chart.wrap else float(np.interp(ub, U, S))
        ln = b - a
        if chart.wrap and (ln <= 0 or ub - ua > span * 0.9):
            ln += total
        return max(ln, 0.05)

    i = 0
    while i < len(per_row):
        us, U, S = per_row[i]
        pair = i + 1 < len(per_row) and tall > 0
        taken = []
        if pair:
            us2, U2, S2 = per_row[i + 1]
            for k in range(len(us) - 1):
                if rng.random() < tall and (not taken or taken[-1][1] <= us[k]):
                    taken.append((us[k], us[k + 1]))
            keep = []
            for (a, b) in zip(us2, us2[1:]):
                keep.append([a, b])
            # the upper row gives way to each tall block: its joints inside the
            # block go, the blocks cut by it are trimmed to its sides
            out = []
            for (a, b) in keep:
                segs = [(a, b)]
                for (ta, tb) in taken:
                    for shift in ((0.0, -span, span) if chart.wrap else (0.0,)):
                        ta2, tb2 = ta + shift, tb + shift
                        nxt = []
                        for (x0, x1) in segs:
                            if tb2 <= x0 or ta2 >= x1:
                                nxt.append((x0, x1))
                                continue
                            if ta2 - x0 > 1e-6:
                                nxt.append((x0, ta2))
                            if x1 - tb2 > 1e-6:
                                nxt.append((tb2, x1))
                        segs = nxt
                out.extend(segs)
            for (a, b) in out:
                blocks.append((a, b, rows[i + 1], rows[i + 2], length(U2, S2, a, b)))
        for k in range(len(us) - 1):
            a, b = us[k], us[k + 1]
            if (a, b) in taken:
                blocks.append((a, b, rows[i], rows[i + 2], length(U, S, a, b)))
            else:
                blocks.append((a, b, rows[i], rows[i + 1], length(U, S, a, b)))
        i += 2 if pair else 1
    return blocks


def megalith_skin(piece, field, chart, blocks, rng, tone, cell=0.4, gap=0.13, depth=0.26, proud=(-0.03, 0.09),
                  keep=None, flag=None, chip=0.3, shade=None, height=None, kind=None, mat=0, jump=1.3, joint=0.3):
    """Build the blocks as patches on `piece` (a Ruin): see the module's head.
    tone(P) is a block's colour at its middle; cell(P) or a number the size
    of a facet inside a block; flag(P) marks points no block may use (a cell
    with one is left out); keep(P, N) decides per facet (centres, normals) for
    the charts that share a surface; shade(P) multiplies the vertices' colours;
    height(vb - va, v) is a row's real height where V is not yards; joint is
    how dark a joint's bottom is."""
    from mathutils import Vector
    specs = []          # per block: (index range, nu, nv, tone)
    Us, Vs, Ls = [], [], []
    for (ua, ub, va, vb, ln) in blocks:
        vm = (va + vb) / 2
        hgt = height(vb - va, vm) if height else vb - va
        c = cell if not callable(cell) else cell((ua + ub) / 2, vm)
        nu = max(1, min(16, int(round(ln / c))))
        nv = max(1, min(12, int(round(hgt / c))))
        g = min(gap, 0.3 * ln, 0.3 * hgt)
        gu = g * (ub - ua) / ln
        gv = g * (vb - va) / hgt
        lvl = rng.uniform(*proud)
        if rng.random() < 0.07:
            lvl = proud[0] - 0.09
        start = len(Us)
        chipped = rng.randrange(4) if rng.random() < chip else -1
        for j in range(nv + 1):
            for i in range(nu + 1):
                u = ua + gu + (ub - ua - 2 * gu) * i / nu
                v = va + gv + (vb - va - 2 * gv) * j / nv
                lv = lvl + 0.03 * math.sin(math.pi * i / nu) * math.sin(math.pi * j / nv)
                corner = (i in (0, nu)) and (j in (0, nv))
                if corner and chipped == (1 if i else 0) + (2 if j else 0):
                    lv -= rng.uniform(0.1, 0.24)
                    u += (0.35 if i == 0 else -0.35) * (ub - ua - 2 * gu) / nu
                    v += (0.35 if j == 0 else -0.35) * (vb - va - 2 * gv) / nv
                Us.append(u)
                Vs.append(v)
                Ls.append(lv)
        # the joint's bottom: the block's own outline, a touch past it, sunk
        ou, ov = 0.25 * gu, 0.25 * gv
        ring = []
        for i in range(nu + 1):
            ring.append((ua - ou + (ub - ua + 2 * ou) * i / nu, va - ov))
        for j in range(1, nv + 1):
            ring.append((ub + ou, va - ov + (vb - va + 2 * ov) * j / nv))
        for i in range(nu - 1, -1, -1):
            ring.append((ua - ou + (ub - ua + 2 * ou) * i / nu, vb + ov))
        for j in range(nv - 1, 0, -1):
            ring.append((ua - ou, va - ov + (vb - va + 2 * ov) * j / nv))
        for (u, v) in ring:
            Us.append(u)
            Vs.append(v)
            Ls.append(-depth)
        specs.append((start, nu, nv, len(ring)))
    U, V, L = np.array(Us), np.array(Vs), np.array(Ls)
    if chart.wrap:
        U = (U - chart.u0) % (chart.u1 - chart.u0) + chart.u0
    O, D = chart.rays(U, V)
    P, hit = march(field, O, D, L, chart.tmax)
    bad = ~hit
    if flag is not None:
        bad |= flag(P)
    K = shade(P) if shade is not None else None
    bm, col = piece.bm, piece.col
    made = 0
    for (start, nu, nv, nring) in specs:
        w = nu + 1
        centre = P[start + (nv // 2) * w + nu // 2]
        base = tone(centre)

        def grid(i, j, start=start, w=w):
            return start + j * w + i
        r0 = start + (nv + 1) * w
        # the face's outline in the ring's order
        edge = [grid(i, 0) for i in range(nu + 1)] + [grid(nu, j) for j in range(1, nv + 1)] + \
            [grid(i, nv) for i in range(nu - 1, -1, -1)] + [grid(0, j) for j in range(nv - 1, 0, -1)]
        quads = [((grid(i, j), grid(i + 1, j), grid(i + 1, j + 1), grid(i, j + 1)), False)
                 for j in range(nv) for i in range(nu)]
        quads += [((edge[k], edge[(k + 1) % nring], r0 + (k + 1) % nring, r0 + k), True) for k in range(nring)]
        cen = np.array([P[list(q)].mean(axis=0) for (q, _s) in quads])
        nrm = np.array([np.cross(P[q[2]] - P[q[0]], P[q[3]] - P[q[1]]) for (q, _s) in quads])
        nl = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = nrm / np.maximum(nl, 1e-9)
        flip = np.einsum('ij,ij->i', nrm, D[[q[0] for (q, _s) in quads]]) > 0
        nrm[flip] *= -1
        ok = np.array([not bad[list(q)].any() for (q, _s) in quads]) & (nl[:, 0] > 1e-7)
        # a facet that bridges two surfaces across a gap (its rays met the
        # muzzle on one side and the cheek behind it on the other) is no stone
        qi = np.array([q for (q, _s) in quads])
        long = np.max(np.linalg.norm(P[qi] - P[np.roll(qi, 1, axis=1)], axis=2), axis=1)
        off = np.abs(field.sample(cen) - L[qi].mean(axis=1))
        ok &= ~((long > jump) & (off > 0.2))
        nf = nu * nv
        if keep is not None:
            ok[:nf] &= keep(cen[:nf], nrm[:nf])
        # a joint's chamfer goes with the facet it borders
        adj = [k for k in range(nu)] + [j * nu + nu - 1 for j in range(nv)] + \
            [(nv - 1) * nu + nu - 1 - m for m in range(nu)] + [(nv - 1 - m) * nu for m in range(nv)]
        ok[nf:] &= ok[:nf][adj]
        if not ok.any():
            continue
        verts = {}
        edge_set = set(edge)
        k_tone = 1.0 + 0.05 * (rng.random() - 0.5)
        for qi, (q, skirt) in enumerate(quads):
            if not ok[qi]:
                continue
            order = q[::-1] if flip[qi] else q
            vs = []
            for idx in order:
                if idx not in verts:
                    verts[idx] = bm.verts.new(Vector(P[idx]))
                vs.append(verts[idx])
            try:
                face = bm.faces.new(vs)
            except ValueError:
                continue
            face.material_index = mat
            face[piece.kindL] = piece.kind if kind is None else kind
            jit = k_tone * (0.97 + 0.06 * rng.random())
            for loop, idx in zip(face.loops, order):
                if idx >= r0:
                    k = joint
                elif idx in edge_set:
                    k = 1.09 * jit
                else:
                    k = jit
                if K is not None:
                    k *= K[idx]
                loop[col] = (min(1.0, base[0] * k), min(1.0, base[1] * k), min(1.0, base[2] * k), 1.0)
            made += 1
    return made
