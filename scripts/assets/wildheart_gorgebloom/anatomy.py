"""The Gorgebloom's skeleton and sculpted body (rest pose), in yards.

Conventions (shared with the Balgath, Great Saurian and Great Jaguar kits this
builder is adapted from): Blender units are yards, +Z up, the bloom FACES -Y (the
game's +Z after the glTF export), its left is +X. Bones are (name, parent, head,
tail); `L_` bones are mirrored onto `R_` (x -> -x). The origin is the WATERLINE of
the plunge pool under the middle of the bulb: the roots and the vines dive below
z = 0.

A carnivorous flower the size of a house: a fat bulb rooted in a crown of roots,
wrapped at the foot by leathery bracts, four golden pollen sacs on its shoulders,
a thick neck rising forward into the flower head. The head is a calyx cup with a
ring of six great red petals (pale warts) round a gaping lamprey maw (lips,
three rows of thorn-teeth, a glowing gullet). The flower splits across its
middle: the lower half (the lower petals, the lower lip and its teeth) rides the
Jaw, so the whole face gapes when it bites. Four vine tentacles: two long front
vines (the RIGHT one is the lash vine) and two shorter back vines.

The skin is several signed-distance sculpts (the body with the head, and one
per vine), each meshed in one pass through OpenVDB. Every primitive carries a
BONE tag (the skin weights) and a ZONE tag (the bake shader's material zones:
petal, sac, lip, root, bract, sepal, wart, vein, and the carved gullet).
"""
import math

import numpy as np

from sdf import Ellipsoid, Field, Noise, Polyline, RoundCone, Sphere, frame_from

# ------------------------------------------------------------------ landmarks
X = np.array((1.0, 0.0, 0.0))
FACE = np.array((0.0, -1.0, -0.22))
FACE /= np.linalg.norm(FACE)                     # where the maw looks (forward, a little down)
UP_H = np.cross(FACE, X)                          # the head's up (in the face plane)
HC = np.array((0.0, -2.75, 8.05))                   # the flower head's centre
MAW = HC + FACE * 1.2                             # the mouth's centre (MawAnchor)
BULB_C = np.array((0.0, 0.0, 3.2))
BULB_R = np.array((3.0, 2.9, 2.8))
NECK_PTS = [np.array(p) for p in ((0.0, -0.3, 5.4), (0.0, -1.05, 6.85), (0.0, -1.9, 7.6))]
HINGE = HC - FACE * 0.5 - UP_H * 0.15
LIP_A, LIP_B = 1.42, 1.02                          # the maw ellipse (across, up)
PETAL_ANGLES = (92, 164, 228, 312, 16)       # degrees round the face, 90 = top (a little ragged)
PETAL_SCALE = (1.1, 1.0, 0.93, 0.96, 1.03)
PETAL_TWIST = (0.0, 0.12, -0.1, 0.08, -0.12)
PETAL_LEN = (1.4, 1.6, 1.55)
SAC_AZ = {'FL': 56.0, 'FR': -56.0, 'BL': 124.0, 'BR': -124.0}
VINE_AZ = {'Vine': 72.0, 'BackVine': 142.0}
VINE_LEN = {'Vine': (1.9, 1.8, 1.6, 1.5, 1.35, 1.15), 'BackVine': (1.5, 1.4, 1.3, 1.15, 1.0)}
VINE_PITCH = {'Vine': (-36, -27, -8, 0, 5, 24), 'BackVine': (-38, -24, -4, 4, 26)}
VINE_BEND = {'Vine': (0, 9, 17, 24, 32, 46), 'BackVine': (0, -10, -20, -30, -46)}
VINE_RAD = {'Vine': (0.82, 0.72, 0.62, 0.52, 0.42, 0.31, 0.17), 'BackVine': (0.62, 0.53, 0.44, 0.35, 0.25, 0.13)}


def azv(a_deg, r=1.0, z=0.0):
    a = math.radians(a_deg)
    return np.array((math.sin(a) * r, -math.cos(a) * r, z))


def mirror(p):
    return np.array((-p[0], p[1], p[2]))


def _lerp(a, b, t):
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


def bulb_surface(a_deg, z):
    """The point of the main bulb ellipsoid's surface at azimuth a and height z."""
    dz = (z - BULB_C[2]) / BULB_R[2]
    k = math.sqrt(max(0.0, 1 - dz * dz))
    a = math.radians(a_deg)
    return np.array((math.sin(a) * BULB_R[0] * k, -math.cos(a) * BULB_R[1] * k, z))


# ------------------------------------------------------------------ petals
def petal_frame(theta_deg):
    th = math.radians(theta_deg)
    r = math.cos(th) * X + math.sin(th) * UP_H         # radial in the face plane
    t = -math.sin(th) * X + math.cos(th) * UP_H         # tangent round the ring
    return r, t


def petal_points(theta_deg):
    r, t = petal_frame(theta_deg)
    k = PETAL_ANGLES.index(theta_deg) if theta_deg in PETAL_ANGLES else 0
    sc, tw = PETAL_SCALE[k], PETAL_TWIST[k]
    p0 = HC + r * 1.85 + FACE * 0.05
    dirs = [r + FACE * 1.25, r + FACE * 0.62 + t * tw, r + FACE * 0.02 + t * tw * 2]
    pts = [p0]
    for d, ln0 in zip(dirs, PETAL_LEN):
        ln = ln0 * sc
        d = d / np.linalg.norm(d)
        pts.append(pts[-1] + d * ln)
    return pts


def petal_parent(theta_deg):
    return 'Jaw' if math.sin(math.radians(theta_deg)) < -0.1 else 'Head'


# ------------------------------------------------------------------ vines
def vine_points(kind, side):
    """Rest joint positions of a vine: out of the bulb, down to the pool, along
    the water, the tip curling up. side +1 left, -1 right."""
    az = VINE_AZ[kind] * side
    z0 = 2.2 if kind == 'Vine' else 1.75
    p = bulb_surface(az, z0)
    out = azv(az)
    p = p - out * 0.55
    pts = [p]
    for ln, pitch, bend in zip(VINE_LEN[kind], VINE_PITCH[kind], VINE_BEND[kind]):
        a = math.radians(az + bend * side * (-1 if kind == 'Vine' else 1))
        o = np.array((math.sin(a), -math.cos(a), 0.0))
        pr = math.radians(pitch)
        d = o * math.cos(pr) + np.array((0, 0, math.sin(pr)))
        pts.append(pts[-1] + d * ln)
    return pts


def _side(s):
    return 'L_' if s > 0 else 'R_'


# ------------------------------------------------------------------ bones
def _bones():
    b = [
        ('Root', None, (0, 0, 0), (0, 0, 1.0)),
        ('Base', 'Root', (0, 0, 0.2), (0, 0, 1.6)),
        ('Bulb1', 'Base', (0, 0, 1.6), (0, 0, 3.4)),
        ('BulbSwell', 'Bulb1', tuple(BULB_C), tuple(BULB_C + (0, 0, 0.9))),
        ('Bulb2', 'Bulb1', (0, 0, 3.4), tuple(NECK_PTS[0])),
        ('Neck1', 'Bulb2', tuple(NECK_PTS[0]), tuple(NECK_PTS[1])),
        ('Neck2', 'Neck1', tuple(NECK_PTS[1]), tuple(NECK_PTS[2])),
        ('Head', 'Neck2', tuple(NECK_PTS[2]), tuple(MAW)),
        ('Jaw', 'Head', tuple(HINGE), tuple(HC + FACE * 1.0 - UP_H * 1.3)),
        ('MawAnchor', 'Head', tuple(MAW), tuple(MAW + FACE * 0.6)),
    ]
    for k, th in enumerate(PETAL_ANGLES):
        pts = petal_points(th)
        par = petal_parent(th)
        for i in range(3):
            b.append((f'Petal{k}_{i + 1}', par if i == 0 else f'Petal{k}_{i}', tuple(pts[i]), tuple(pts[i + 1])))
    for key, az in SAC_AZ.items():
        a = bulb_surface(az, 4.75)
        o = azv(az)
        b.append((f'Sac_{key}', 'Bulb2', tuple(a - o * 0.2), tuple(a + o * 1.7 + (0, 0, -0.45))))
    for kind in ('Vine', 'BackVine'):
        for s in (1, -1):
            pts = vine_points(kind, s)
            for i in range(len(pts) - 1):
                nm = f'{_side(s)}{kind}{i + 1}'
                par = 'Bulb1' if i == 0 else f'{_side(s)}{kind}{i}'
                b.append((nm, par, tuple(pts[i]), tuple(pts[i + 1])))
    tip = vine_points('Vine', -1)
    d = tip[-1] - tip[-2]
    d /= np.linalg.norm(d)
    b.append(('LashTip', 'R_Vine6', tuple(tip[-1]), tuple(tip[-1] + d * 0.35)))
    return b


def _topo(bones):
    out, placed = [], set()
    pending = list(bones)
    while pending:
        rest = []
        for b in pending:
            if b[1] is None or b[1] in placed:
                out.append(b)
                placed.add(b[0])
            else:
                rest.append(b)
        if len(rest) == len(pending):
            raise RuntimeError(f'unparented bones: {[b[0] for b in rest]}')
        pending = rest
    return out


BONES = _topo(_bones())
REST = {n: (np.array(h, dtype=float), np.array(t, dtype=float)) for n, _, h, t in BONES}
PARENT = {n: p for n, p, _, _ in BONES}
PETALS = [[f'Petal{k}_{i + 1}' for i in range(3)] for k in range(len(PETAL_ANGLES))]
VINES = {f'{_side(s)}{kind}': [f'{_side(s)}{kind}{i + 1}' for i in range(len(VINE_LEN[kind]))]
         for kind in ('Vine', 'BackVine') for s in (1, -1)}
SACS = [f'Sac_{k}' for k in SAC_AZ]

# zone channels: three RGBA colour attributes on the high meshes
ZONES = ('petal', 'sac', 'lip', 'gullet', 'root', 'bract', 'sepal', 'wart', 'vein')


# ------------------------------------------------------------------ zone-tagged field
class ZField(Field):
    """A Field whose primitives also carry a material ZONE (the bake shader's masks)."""

    def __init__(self, lo, hi, voxel):
        super().__init__(lo, hi, voxel)
        self.zprims = []     # (prim, zone)
        self.zsubs = []      # carved cavities: (prim, zone)

    def addz(self, prim, k, zone=None):
        self.add(prim, k)
        if zone:
            self.zprims.append((prim, zone))

    def subz(self, prim, k, zone=None):
        self.sub(prim, k)
        if zone:
            self.zsubs.append((prim, zone))


def zone_weights(F, P, tau=0.035):
    """Per-vertex zone weights (n, len(ZONES)) from the sculpt's zone primitives:
    a zone owns a vertex in proportion to how close its nearest primitive is."""
    n = len(P)
    W = np.zeros((n, len(ZONES)))
    best = {}
    for prim, z in F.zprims:
        d = prim.dist_pts(P)
        best[z] = d if z not in best else np.minimum(best[z], d)
    for prim, z in F.zsubs:
        d = np.abs(prim.dist_pts(P))
        best[z] = d if z not in best else np.minimum(best[z], d)
    for z, d in best.items():
        # a zone covers the surface within a soft margin of its primitives
        W[:, ZONES.index(z)] = np.clip(1.0 - (d - 0.01) / tau, 0.0, 1.0)
    return W


# ------------------------------------------------------------------ body + head
def build_body(voxel=0.035, detail=True, seed=23):
    F = ZField((-5.95, -7.4, -0.95), (5.95, 5.95, 14.6), voxel)
    noise = Noise(seed)
    rng = np.random.default_rng(seed)

    # ---------------------------------------------------------------- root crown
    F.addz(Ellipsoid((0, 0, 0.45), (3.55, 3.45, 1.05), bone='Base'), 0.5, 'root')
    for k in range(10):
        az = 18 + 36 * k + rng.uniform(-8, 8)
        r0, r1, r2, r3 = 2.5, 3.6 + rng.uniform(-0.2, 0.3), 4.7 + rng.uniform(-0.3, 0.3), 5.5 + rng.uniform(-0.2, 0.3)
        hump = 1.05 + rng.uniform(-0.15, 0.3)
        tw = rng.uniform(-10, 10)
        pts = [azv(az, r0, 1.0), azv(az + tw * 0.3, r1, hump), azv(az + tw, r2, 0.35), azv(az + tw * 1.4, r3, -0.6)]
        rad = [0.62, 0.5, 0.36, 0.22]
        F.addz(Polyline(pts, rad, bone='Root'), 0.18, 'root')
        if k % 3 == 1:     # a fork
            q = [pts[1], azv(az + tw + 14, r2 - 0.2, 0.6), azv(az + tw + 22, r3 - 0.4, -0.5)]
            F.addz(Polyline(q, [0.36, 0.26, 0.16], bone='Root'), 0.12, 'root')
    for k in range(10):    # smaller rootlets between the great roots
        az = 36 * k + rng.uniform(-6, 6)
        pts = [azv(az, 3.0, 0.6), azv(az, 3.9, 0.45), azv(az + 6, 4.5, -0.4)]
        F.addz(Polyline(pts, [0.3, 0.22, 0.12], bone='Root'), 0.12, 'root')

    # ---------------------------------------------------------------- bulb
    F.addz(Ellipsoid(BULB_C, BULB_R, bone='BulbSwell'), 0.6)
    F.addz(Ellipsoid((0, 0, 1.75), (3.15, 3.1, 1.25), bone='Bulb1'), 0.7)
    F.addz(Ellipsoid((0, -0.2, 4.95), (2.2, 2.15, 1.35), bone='Bulb2'), 0.7)
    # lobes: the bulb is not a ball, it bulges between its ribs
    for k in range(6):
        az = 30 + 60 * k
        o = azv(az)
        Rl = np.stack([np.cross((0, 0, 1.0), o), o, np.array((0, 0, 1.0))], axis=1)
        F.addz(Ellipsoid(bulb_surface(az, 3.0) * (0.6, 0.6, 1.0), (1.55, 1.32, 2.0), Rl, bone='BulbSwell'), 0.5)
    # bracts: leathery leaves wrapping the foot of the bulb, tips curling out
    for az in (0, 32, -32, 105, -105, 165, -165):
        o = azv(az)
        b0 = bulb_surface(az, 0.7) + o * 0.15
        b1 = bulb_surface(az, 2.2) + o * 0.35
        b2 = bulb_surface(az, 3.3) + o * 0.75 + (0, 0, 0.15)
        tip = b2 + o * 0.55 + (0, 0, 0.35)
        t = np.cross(o, (0, 0, 1.0))
        for a, b, w, th in ((b0, b1, 0.95, 0.2), (b1, b2, 0.8, 0.16), (b2, tip, 0.42, 0.12)):
            d = b - a
            ln = np.linalg.norm(d)
            d = d / ln
            n = np.cross(t, d)
            R = np.stack([t, d, n / np.linalg.norm(n)], axis=1)
            F.addz(Ellipsoid((a + b) / 2, (w, ln * 0.62, th), R, bone='Bulb1'), 0.12, 'bract')

    # ---------------------------------------------------------------- pollen sacs
    for key, az in SAC_AZ.items():
        h, t = REST[f'Sac_{key}']
        o = azv(az)
        c = _lerp(h, t, 0.62)
        F.addz(RoundCone(h - o * 0.3, c, 0.5, 0.42, bone=f'Sac_{key}'), 0.25, 'sac')
        d = (t - h) / np.linalg.norm(t - h)
        F.addz(Ellipsoid(c, (1.0, 1.3, 1.0), frame_from(d) @ np.array([[1, 0, 0], [0, 0, 1], [0, 1, 0]]),
                         bone=f'Sac_{key}'), 0.18, 'sac')
        # lumps: seed pods pressing under the sac's skin
        for j in range(5):
            u = rng.normal(size=3)
            u /= np.linalg.norm(u)
            F.addz(Sphere(c + u * 0.78, 0.36, bone=f'Sac_{key}'), 0.15, 'sac')

    # ---------------------------------------------------------------- vine roots (the stubs out of the bulb)
    for kind in ('Vine', 'BackVine'):
        for s in (1, -1):
            pts = vine_points(kind, s)
            o = azv(VINE_AZ[kind] * s)
            r0 = VINE_RAD[kind][0]
            F.addz(RoundCone(pts[0] - o * 0.6 + (0, 0, 0.2), _lerp(pts[0], pts[1], 0.45), r0 * 1.35, r0 * 1.05,
                             bone=f'{_side(s)}{kind}1'), 0.35)

    # ---------------------------------------------------------------- neck
    F.addz(RoundCone((0, 0.0, 4.6), NECK_PTS[1], 1.45, 1.12, bone='Neck1'), 0.55)
    F.addz(RoundCone(NECK_PTS[1], NECK_PTS[2], 1.12, 1.02, bone='Neck2'), 0.3)
    F.addz(RoundCone(NECK_PTS[2], HC - FACE * 0.6, 1.02, 1.1, bone='Head'), 0.3)

    # ---------------------------------------------------------------- head: calyx, sepals, petals, maw
    Rh = np.stack([X, UP_H, FACE], axis=1)
    F.addz(Ellipsoid(HC - FACE * 0.35, (2.3, 2.1, 1.45), Rh, bone='Head'), 0.35)
    F.addz(Ellipsoid(HC - FACE * 0.05 - UP_H * 0.95, (2.0, 1.15, 1.2), Rh, bone='Jaw'), 0.3)   # the lower calyx
    for k, th in enumerate(PETAL_ANGLES):                  # sepals behind the petals, curling back
        r, t = petal_frame(th + 36)
        a = HC - FACE * 0.9 + r * 1.7
        b = a + (r * 1.0 - FACE * 0.7) * 1.05
        tip = b + (r * 0.5 - FACE * 0.9) * 0.55
        for p, q, w, thk in ((a, b, 0.5, 0.16), (b, tip, 0.26, 0.1)):
            d = (q - p) / np.linalg.norm(q - p)
            n = np.cross(t, d)
            R = np.stack([t, d, n / np.linalg.norm(n)], axis=1)
            F.addz(Ellipsoid((p + q) / 2, (w, np.linalg.norm(q - p) * 0.6, thk), R, bone='Head'), 0.1, 'sepal')
    for k, th in enumerate(PETAL_ANGLES):
        pts = petal_points(th)
        r, t = petal_frame(th)
        segl = [np.linalg.norm(pts[i + 1] - pts[i]) for i in range(3)]
        total = sum(segl)
        nst = 26
        for j in range(nst + 1):
            s = j / nst
            # arc-length station along the three bones
            acc, i = s * total, 0
            while i < 2 and acc > segl[i]:
                acc -= segl[i]
                i += 1
            a, b = pts[i], pts[i + 1]
            d = (b - a) / segl[i]
            c = a + d * min(acc, segl[i])
            n = np.cross(t, d)
            n /= np.linalg.norm(n)
            if n @ FACE < 0:
                n = -n                                   # n: the petal's FRONT (the maw side)
            # a broad leaf: wide from the base, widest past the middle, a pointed tip
            w = 1.25 + 0.45 * math.sin(math.pi * min(1.0, s / 0.6) / 2) if s < 0.6 else                 1.7 * ((1 - s) / 0.4) ** 0.75 + 0.12
            thk = 0.42 - 0.28 * s
            R = np.stack([t, d, n], axis=1)
            bone = f'Petal{k}_{i + 1}'
            step = total / nst
            F.addz(Ellipsoid(c, (w * 0.62, step * 1.9, thk), R, bone=bone), 0.12, 'petal')
            for sg in (1, -1):    # the dished blade: the halves rise toward the maw side
                F.addz(Ellipsoid(c + t * sg * w * 0.55 + n * (0.14 * w), (w * 0.5, step * 1.9, thk * 0.85), R,
                                 bone=bone), 0.12, 'petal')
            # the pale warts on the petal's face
            if 0.1 < s < 0.93:
                for _ in range(1 + (j % 2)):
                    u = rng.uniform(-0.85, 0.85)
                    rr = rng.uniform(0.07, 0.16) * (1.2 - 0.5 * s)
                    # a pale wart: a zone the bake paints (and domes in the normal map); sculpted
                    # spheres this small meshed into pits at the voxel size and baked dark
                    cc = c + t * u * w * 0.95 + n * (thk * 0.92 + 0.14 * w * min(1.0, abs(u) * 1.6) - rr * 0.35)
                    F.zprims.append((Sphere(cc, rr, bone=bone), 'wart'))   # painted + bumped, not sculpted
        # the petal's midrib under the face
        F.addz(Polyline([pts[0], pts[1], pts[2]], [0.2, 0.15, 0.09], bone=f'Petal{k}_1'), 0.12, 'petal')
    # the lips: a ring of fleshy beads round the gaping maw
    lipc = MAW - FACE * 0.12
    for k in range(16):
        a = math.tau * k / 16
        p = lipc + X * math.cos(a) * LIP_A + UP_H * math.sin(a) * LIP_B
        bone = 'Head' if math.sin(a) > -0.05 else 'Jaw'
        F.addz(Ellipsoid(p, (0.44, 0.38, 0.42), Rh, bone=bone), 0.18, 'lip')
    # the maw: the cavity and the gullet down the neck
    F.subz(Ellipsoid(HC + FACE * 0.55, (1.22, 0.86, 1.3), Rh), 0.12, 'gullet')
    F.subz(RoundCone(HC + FACE * 0.1, HC - FACE * 0.95 - UP_H * 0.1, 0.8, 0.5), 0.14, 'gullet')

    if detail:
        _detail(F, noise, rng)
    return F


# ------------------------------------------------------------------ detail
def _project(F, origin, toward, inset=0.01):
    o = np.asarray(origin, float)
    d = np.asarray(toward, float) - o
    d /= np.linalg.norm(d)
    t, prev = 0.0, F.sample(o[None])[0]
    while t < 6.0:
        t += F.voxel * 0.5
        v = F.sample((o + d * t)[None])[0]
        if prev < 0 <= v:
            return o + d * (t - inset)
        prev = v
    return None


VEIN_LINES = []


def _detail(F, noise, rng):
    VEIN_LINES.clear()
    # veins up the bulb from the foot to the neck: raised, meandering
    for k in range(11):
        az0 = 360 * k / 11 + rng.uniform(-8, 8)
        pts = []
        for j, z in enumerate(np.linspace(1.4, 5.9, 9)):
            az = az0 + 9 * math.sin(j * 0.9 + k)
            c = np.array((0, -0.15 * (z > 5), z))
            p = _project(F, c, c + azv(az, 5.0))
            if p is not None:
                pts.append(p)
        if len(pts) > 2:
            line = Polyline(pts, 0.004)
            F.ridge(line, 0.05, k=0.05)
            F.zprims.append((Polyline(pts, 0.06), 'vein'))
            VEIN_LINES.append(pts)
    # fibres along the neck
    for k in range(12):
        az = 30 * k
        pts = []
        for t in np.linspace(0.0, 1.0, 7):
            c = _lerp((0, -0.1, 5.0), HC - FACE * 0.9, t)
            p = _project(F, c, c + azv(az, 3.0) * (1, 1, 1) + (0, 0, 0.0))
            if p is not None:
                pts.append(p)
        if len(pts) > 2:
            F.groove(Polyline(pts, 0.003), 0.03, k=0.045)
    # throat rings down the gullet
    for k in range(5):
        c = HC + FACE * (0.9 - 0.42 * k)
        rad = 1.05 - 0.1 * k
        ring = [c + X * math.cos(a) * rad + UP_H * math.sin(a) * rad * 0.75 for a in np.linspace(0, math.tau, 20)]
        F.ridge(Polyline(ring, 0.004), 0.05, k=0.05)
    # flesh: lumpy bulb, finer wrinkles
    F.displace(lambda X_, Y, Z: 0.05 * noise.fbm(X_ * 0.6, Y * 0.6, Z * 0.6, octaves=3)
               + 0.012 * noise.fbm(X_ * 4 + 3, Y * 4, Z * 1.5, octaves=2)
               + 0.004 * noise(X_ * 20 + 7, Y * 20, Z * 8), band=0.15)


# ------------------------------------------------------------------ vines
def build_vine(name, voxel=0.03, seed=5):
    """One vine tentacle as its own sculpt: a tapering stem, knotted at the joints,
    a club of thorny knuckles at the tip."""
    bones = VINES[name]
    kind = 'BackVine' if 'Back' in name else 'Vine'
    pts = [REST[b][0] for b in bones] + [REST[bones[-1]][1]]
    rad = VINE_RAD[kind]
    lo = np.min(pts, axis=0) - 1.0
    hi = np.max(pts, axis=0) + 1.0
    F = ZField(lo, hi, voxel)
    noise = Noise(seed + len(name))
    for i, b in enumerate(bones):
        F.addz(RoundCone(pts[i], pts[i + 1], rad[i], rad[i + 1], bone=b), 0.12)
        if 0 < i:   # a knot at each joint
            d = pts[i + 1] - pts[i - 1]
            F.addz(Ellipsoid(pts[i], (rad[i] * 1.18, rad[i] * 1.18, rad[i] * 0.7), frame_from(d), bone=b), 0.12, 'vein')
    # the club: thorny knuckles round the tip
    tip, pre = pts[-1], pts[-2]
    d = (tip - pre) / np.linalg.norm(tip - pre)
    F.addz(Ellipsoid(_lerp(pre, tip, 0.7), (rad[-2] * 1.35, rad[-2] * 1.35, np.linalg.norm(tip - pre) * 0.45),
                     frame_from(d), bone=bones[-1]), 0.14)
    # helical fibres twisting along the vine
    rng = np.random.default_rng(seed)
    for k in range(3):
        ph = math.tau * k / 3 + rng.uniform(0, 0.5)
        line = []
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            dd = (b - a) / np.linalg.norm(b - a)
            e1 = np.cross(dd, (0, 0, 1.0))
            if np.linalg.norm(e1) < 1e-3:
                e1 = np.cross(dd, (1.0, 0, 0))
            e1 /= np.linalg.norm(e1)
            e2 = np.cross(dd, e1)
            for t in np.linspace(0, 1, 5, endpoint=False):
                ang = ph + (i + t) * 2.2
                r = (rad[i] + (rad[i + 1] - rad[i]) * t) * 1.0
                line.append(_lerp(a, b, t) + (e1 * math.cos(ang) + e2 * math.sin(ang)) * r)
        F.ridge(Polyline(line, 0.004), 0.035, k=0.04)
    F.displace(lambda X_, Y, Z: 0.02 * noise.fbm(X_ * 1.5, Y * 1.5, Z * 1.5, octaves=2)
               + 0.005 * noise(X_ * 18, Y * 18, Z * 18), band=0.1)
    return F
