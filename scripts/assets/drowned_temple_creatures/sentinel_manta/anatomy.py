"""Moonmantle Ray (the Pearlguard Sentinel): skeleton and sculpts (rest pose), in yards.

A giant sacred manta, a temple guardian made of moonlight, gliding about a
yard over the flags. A broad swept disc: its back pearl white and silver,
nine raised nacre plates set in an arc from wingtip to wingtip, each carved
with a phase of the moon (new moon on its left tip, full moon on its right);
its wings thin out to edges like clear water with a filament of cyan light
running inside them; underneath it is deep turquoise strewn with points of
light like stars. Its two cephalic lobes curl up and in like a silver
crescent moon, cupping its heart, a great glowing pearl; small cold eyes
with a slit of light on the corners of its head. A long thin whip of a tail
ends in a spindle of tide-glass.

Axes: yards, +Z up, faces -Y, its left is +X. The disc's mid-plane rests at
Z0 (its belly a yard over the floor); the wings span about 6.1 tip to tip.
The skin weights do not come from the sculpt's shapes but from carrier slabs
(one per bone, never meshed), so each wing bends smoothly across its five
joints; the rim light rides twin Glow bones that its death puts out from the
tips inward.
"""
import math

import numpy as np

import sdf
import sdf_ext as X
from sdf import Ellipsoid, Field, Noise, RoundBox, RoundCone, Sphere, frame_from

NAME = 'MoonmantleRay'
PREFIX = 'manta'

Z0 = 1.25                     # the disc's mid-plane at rest
S = 3.05                      # half span (the wingtip's x)
WING_X = (0.5, 1.05, 1.6, 2.12, 2.6, S)   # the wing joints, root to tip
N_WING = len(WING_X) - 1
EDGE_CHORD = 0.42             # the wing bones run along this chord fraction
PLATE_N = 9
PEARL_AT = np.array((0.0, -1.5, Z0 + 0.54))
PEARL_R = 0.24
HEART_K = 1.08                # the sculpted pearl's radius over PEARL_R
CRESCENT_R = 0.36             # the pearl's cradle and the lobes' inner arcs share this circle
# the lobes run forward from the head's corners, then sweep up round the
# pearl as the two horns of a crescent moon, the tips flicking out at about
# the pearl's crown (never closing over it); the silver cradle under the
# pearl (CRADLE) joins them into one crescent seen from the front
LOBE = [np.array(p) for p in ((0.42, -1.2, Z0 + 0.02), (0.45, -1.38, Z0 + 0.12), (0.42, -1.43, Z0 + 0.3),
                              (0.39, -1.43, Z0 + 0.62), (0.31, -1.44, Z0 + 0.84))]
LOBE_W = (0.12, 0.14, 0.15, 0.1, 0.014)       # each blade's width across its curve
LOBE_T = (0.05, 0.042, 0.036, 0.03, 0.01)     # and its thickness: flat blades
EYE_AT = np.array((0.5, -1.12, Z0 + 0.19))
EYE_R = 0.075
TAIL = [np.array((0.0, 1.0 + 0.56 * i, Z0 - 0.04 - 0.012 * i)) for i in range(7)]
TAIL_R = (0.1, 0.075, 0.058, 0.046, 0.036, 0.028, 0.022)
CRYSTAL_LEN = 0.5
GILL_Y0, GILL_DY, GILL_X = -0.86, 0.15, (0.26, 0.6)
BAKE_CAGE, BAKE_RAY = 0.012, 0.045


# ------------------------------------------------------------------ the planform (top view, x >= 0)
def y_le(u):
    """The leading edge's y at span fraction u (0 the centre, 1 the tip)."""
    u = np.clip(u, 0.0, 1.0)
    return -1.28 + 0.3 * u + 1.8 * u ** 2.3


def y_te(u):
    """The trailing edge: bowed forward along the wing (the sickle), drawn back
    at the centre over the pelvic fins and the root of the tail."""
    u = np.clip(u, 0.0, 1.0)
    return (1.02 - 0.22 * u - 0.52 * np.sin(np.pi * u) ** 1.1 * (1 - 0.35 * u)
            + 0.38 * np.exp(-(u * S / 0.32) ** 2))


def zc_of(x):
    """The wing's mid-surface sags a little toward the tips."""
    u = np.clip(np.abs(x) / S, 0, 1)
    return Z0 - 0.1 * u ** 2


def chord_y(x, c):
    u = np.abs(x) / S
    return y_le(u) + c * (y_te(u) - y_le(u))


def outline(n=140):
    """The closed outline (both halves), counter-clockwise, as (N, 2)."""
    us = np.linspace(0.0, 1.0, n) ** 0.8
    xs = us * S
    le = np.stack([xs, y_le(us)], axis=1)
    te = np.stack([xs[::-1], y_te(us[::-1])], axis=1)
    right = np.concatenate([le, te[1:]])
    left = right[::-1].copy()
    left[:, 0] *= -1
    return np.concatenate([right, left[1:-1]])


def dist2d(Q, poly=None):
    """Signed 2D distance of points Q (M, 2) to the planform (negative inside)."""
    poly = outline() if poly is None else poly
    A = poly
    B = np.roll(poly, -1, axis=0)
    AB = B - A
    L2 = np.maximum((AB ** 2).sum(axis=1), 1e-12)
    out = np.empty(len(Q))
    for s in range(0, len(Q), 6000):
        q = Q[s:s + 6000]
        px = q[:, None, 0] - A[None, :, 0]
        py = q[:, None, 1] - A[None, :, 1]
        t = np.clip((px * AB[None, :, 0] + py * AB[None, :, 1]) / L2[None, :], 0, 1)
        dx = px - AB[None, :, 0] * t
        dy = py - AB[None, :, 1] * t
        out[s:s + 6000] = np.sqrt((dx * dx + dy * dy).min(axis=1))
    ax = np.abs(Q[:, 0])
    u = ax / S
    inside = (ax <= S) & (Q[:, 1] >= y_le(u)) & (Q[:, 1] <= y_te(u))
    return np.where(inside, -out, out)


def surfaces(x, y):
    """(top, bottom) of the disc over the planform point (x, y): a domed body
    (thick forward, at the shoulders), thin cambered wings with an airfoil
    across the chord, a flatter belly."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    u = np.clip(np.abs(x) / S, 0, 1)
    le, te = y_le(u), y_te(u)
    c = np.clip((y - le) / np.maximum(te - le, 1e-4), 0, 1)
    af = np.sqrt(c) * (1 - c) / 0.385
    wt = np.maximum((0.13 * (1 - u) ** 1.3 + 0.012) * af, 0.013)
    by = np.clip(1 - ((y + 0.12) / 1.42) ** 2, 0, 1) ** 0.55
    B = np.exp(-(x / 0.7) ** 2) * by
    # the shoulders: a broad muscle mass either side of the spine behind the
    # head, where the wings' great strokes are driven from
    sh = np.exp(-((np.abs(x) - 0.62) / 0.3) ** 2) * np.exp(-((y + 0.42) / 0.5) ** 2)
    zc = zc_of(x)
    return zc + wt + 0.56 * B + 0.1 * sh, zc - 0.8 * wt - 0.34 * B - 0.03 * sh


# ------------------------------------------------------------------ bones
def wing_head(i):
    x = WING_X[i]
    return np.array((x, float(chord_y(x, EDGE_CHORD)), float(zc_of(x))))


def _bones():
    out = [
        ('Root', None, (0, 0, 0), (0, 0, 0.5)),
        ('Body', 'Root', (0, 0.0, Z0), (0, -0.75, Z0)),
        ('Head', 'Body', (0, -0.75, Z0), (0, -1.3, Z0)),
        ('Pearl', 'Head', tuple(PEARL_AT), tuple(PEARL_AT + np.array((0, 0, 0.25)))),
        ('PearlDark', 'Head', tuple(PEARL_AT), tuple(PEARL_AT + np.array((0, 0, 0.25)))),
        ('EyeGlow', 'Head', (0, -1.08, Z0 + 0.1), (0, -1.08, Z0 + 0.3)),
        ('L_Lobe1', 'Head', tuple(LOBE[0]), tuple(LOBE[2])),
        ('L_Lobe2', 'L_Lobe1', tuple(LOBE[2]), tuple(LOBE[4])),
        ('Hip', 'Body', (0, 0.55, Z0), (0, 1.0, Z0)),
    ]
    prev = 'Hip'
    for i in range(6):
        out.append((f'Tail{i + 1}', prev, tuple(TAIL[i]), tuple(TAIL[i + 1])))
        prev = f'Tail{i + 1}'
    prev = 'Body'
    for i in range(N_WING):
        h, t = wing_head(i), wing_head(i + 1)
        out.append((f'L_Wing{i + 1}', prev, tuple(h), tuple(t)))
        out.append((f'L_Glow{i + 1}', f'L_Wing{i + 1}', tuple(h), tuple(t)))
        prev = f'L_Wing{i + 1}'
    return _topo(_expand(out))


def _expand(bones):
    out = []
    for name, parent, head, tail in bones:
        out.append((name, parent, tuple(float(x) for x in head), tuple(float(x) for x in tail)))
        if name.startswith('L_'):
            mp = lambda p: (-p[0], p[1], p[2])  # noqa: E731
            tp = 'R_' + parent[2:] if parent and parent.startswith('L_') else parent
            out.append(('R_' + name[2:], tp, mp(head), mp(tail)))
    return out


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
        pending = rest
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
GROUND = 0.0
FEET = ()
FREE_START = ('ShellOpen', 'ShellIdle', 'ShellWalk', 'ShellAttack', 'ShellHit')
FREE_END = ('Death', 'ShellClose', 'ShellIdle', 'ShellWalk', 'ShellAttack', 'ShellHit')
COLLIDE_LEGS = {}
POP_SKIP = ('Pearl', 'PearlDark', 'EyeGlow', 'L_Glow', 'R_Glow')
TREMOR_KEYS = ('Body', 'Head', 'Wing', 'Tail', 'Lobe')
AIM_LIMITS = {}
HIDDEN = {'PearlDark': 0.0}
WEAPON_AXIS = (0.0, 0.0, 1.0)
WEAPON_REF = WEAPON_AXIS
CHAINS = []


def hand_frame(side=1):
    raise NotImplementedError


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _write(obj, vals):
    me = obj.data
    for nm, arr in vals.items():
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.asarray(arr, dtype=np.float32).ravel().tolist())


def _smax(a, b, k):
    k = np.maximum(k, 1e-6)
    h = np.clip(0.5 - 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


# ------------------------------------------------------------------ the crescent lobes
LOBE_STATIONS = np.linspace(0.0, 1.0, 14)


def _catmull(pts, u):
    n = len(pts) - 1
    f = min(n - 1e-6, max(0.0, u * n))
    i = int(f)
    t = f - i
    p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def lobe_curve(s, u):
    return _m(_catmull(LOBE, u), s)


def lobe_stations(s):
    """(centre, frame, half width, half thickness) of the blade stations along
    one lobe: flat blades whose faces look forward, so from the front the
    pair draws a crescent moon round the pearl."""
    out = []
    n = len(LOBE_STATIONS)
    for j, u in enumerate(LOBE_STATIONS):
        c = lobe_curve(s, u)
        tg = lobe_curve(s, min(1.0, u + 0.02)) - lobe_curve(s, max(0.0, u - 0.02))
        tg /= np.linalg.norm(tg)
        # the blade lies flat where the lobe runs forward and turns its face
        # forward as it rises
        ay = abs(tg[1])
        f = np.array((0.0, -(1 - ay), ay))
        f = f - tg * (f @ tg)
        f /= np.linalg.norm(f)
        w = np.cross(tg, f)
        R = np.stack([w, tg, f], axis=1)
        k = u * (len(LOBE_W) - 1)
        i = min(int(k), len(LOBE_W) - 2)
        a = k - i
        width = LOBE_W[i] + (LOBE_W[i + 1] - LOBE_W[i]) * a
        thick = LOBE_T[i] + (LOBE_T[i + 1] - LOBE_T[i]) * a
        along = max(0.05, min(0.14, width * 0.9 + 0.05))
        out.append((c, R, width, thick, along))
    _ = n
    return out


def cradle_stations():
    """(centre, frame, half width, half thickness, half length) of the silver
    crescent under the pearl: an arc in the plane just behind the pearl's
    centre, broadest at the bottom, narrowing up each side into the lobes."""
    out = []
    c0 = PEARL_AT + np.array((0.0, 0.05, 0.0))
    for a in np.linspace(math.radians(208), math.radians(332), 15):
        f = math.sin(math.pi * (a - math.radians(208)) / math.radians(124))
        rad = np.array((math.cos(a), 0.0, math.sin(a)))
        tg = np.array((-math.sin(a), 0.0, math.cos(a)))
        fwd = np.array((0.0, -1.0, 0.0))
        w = 0.05 + 0.06 * f
        R = np.stack([rad, tg, fwd], axis=1)
        out.append((c0 + rad * (CRESCENT_R - 0.01 + w * 0.6), R, w, 0.04, 0.07))
    return out


# the crescent: the band between an outer circle and an inner one set higher,
# in the plane just behind the pearl's centre; its horns close at about the
# pearl's crown and sweep back toward the body
CRESCENT_RO, CRESCENT_OZ = 0.5, -0.08       # outer circle radius, its centre's height over the pearl's
CRESCENT_RI, CRESCENT_IZ = 0.36, 0.14       # inner circle
CRESCENT_TH = 0.045                         # half thickness at its belly (thinner toward the horns)
CRESCENT_BEND = 0.32                        # the horns' sweep back


class Crescent(sdf.Prim):
    def __init__(self):
        self.bone = None
        self.c = PEARL_AT + np.array((0.0, 0.03, 0.0))
        self.lo = self.c - np.array((CRESCENT_RO + 0.1, 0.3, CRESCENT_RO + 0.2))
        self.hi = self.c + np.array((CRESCENT_RO + 0.1, 0.3, CRESCENT_RO + 0.1))

    def front_y(self, x):
        return self.c[1] + CRESCENT_BEND * x * x - CRESCENT_TH

    def dist(self, X_, Y_, Z_):
        x = X_ - self.c[0]
        z = Z_ - self.c[2]
        y = Y_ - (self.c[1] + CRESCENT_BEND * x * x)
        d_out = np.sqrt(x * x + (z - CRESCENT_OZ) ** 2) - CRESCENT_RO
        d_in = CRESCENT_RI - np.sqrt(x * x + (z - CRESCENT_IZ) ** 2)
        d2 = _smax(d_out, d_in, 0.025)
        th = CRESCENT_TH * (0.45 + 0.55 * np.clip((0.25 - z) / 0.6, 0, 1))
        return _smax(d2, np.abs(y) - th, 0.018)


# ------------------------------------------------------------------ the moon plates
def plates():
    """(centre xy, radius, phase) of the nine plates, left tip (new moon) to
    right tip (full moon)."""
    out = []
    for i in range(PLATE_N):
        x = 2.28 - 4.56 * i / (PLATE_N - 1)
        y = float(chord_y(x, 0.4))
        r = 0.31 - 0.028 * abs(i - (PLATE_N - 1) / 2)
        out.append((np.array((x, y)), r, i / (PLATE_N - 1)))
    return out


def moon_masks(P2, centre, r, phase):
    """(plate, lit, ring) masks of one plate at points P2 (M, 2). The glyph is a
    moon disc of radius 0.62 r, lit from -X (toward the full moon) as far as
    its phase; its outline is carved whatever the phase, so the new moon reads
    as a dark disc in a ring."""
    d = P2 - centre
    rr = np.sqrt((d ** 2).sum(axis=1))
    plate = np.clip((r * 1.0 - rr) / 0.03, 0, 1)
    rg = 0.62 * r
    a = -d[:, 0]                      # toward the lit side
    b = d[:, 1]
    half = np.sqrt(np.clip(rg * rg - b * b, 0, None))
    lit = (a > math.cos(math.pi * phase) * half) & (rr < rg)
    disc = np.clip((rg - rr) / 0.012, 0, 1)
    lit = lit.astype(float) * disc
    ring = np.clip(1 - np.abs(rr - rg) / 0.016, 0, 1) + np.clip(1 - np.abs(rr - 0.92 * r) / 0.013, 0, 1)
    return plate, lit, np.clip(ring, 0, 1), disc


CRESCENT = Crescent()


# ------------------------------------------------------------------ the disc (one skinned body)
def build_body(voxel):
    lo = np.array((-S - 0.12, -2.08, Z0 - 0.45))
    hi = np.array((S + 0.12, 1.68, Z0 + 0.98))
    F = Field(lo, hi, voxel)
    xs, ys, zs = F.axes
    Xg, Yg = np.meshgrid(xs, ys, indexing='ij')
    Q = np.stack([Xg.ravel(), Yg.ravel()], axis=1)
    d2 = dist2d(Q).reshape(Xg.shape).astype(np.float32)
    top, bot = surfaces(Xg, Yg)
    top = top.astype(np.float32)
    bot = bot.astype(np.float32)
    k2 = np.clip(0.45 * (top - bot), 0.004, 0.07).astype(np.float32)
    Z = zs.astype(np.float32)[None, None, :]
    slab = np.maximum(Z - top[..., None], bot[..., None] - Z)
    D = _smax(d2[..., None], slab, k2[..., None])
    F.d = np.minimum(F.d, D.astype(np.float32))
    del slab, D
    # the nacre plates: raised a little proud of the back, their rims and the
    # outline of each moon carved in
    for (c, r, phase) in plates():
        tp, bt = surfaces(c[0], c[1])
        tp, bt = float(tp), float(bt)
        th = tp - bt
        h = min(0.08, 0.45 * th)
        eps = 0.02
        gx = (float(surfaces(c[0] + eps, c[1])[0]) - float(surfaces(c[0] - eps, c[1])[0])) / (2 * eps)
        gy = (float(surfaces(c[0], c[1] + eps)[0]) - float(surfaces(c[0], c[1] - eps)[0])) / (2 * eps)
        n = np.array((-gx, -gy, 1.0))
        n /= np.linalg.norm(n)
        R = frame_from(n, up=(0, 1, 0))
        cen = np.array((c[0], c[1], tp)) - n * h * 0.45
        F.add(Ellipsoid(cen, (r, r * 0.9, h), R), 0.012, weight=False)
        for rad, depth in ((0.92 * r, 0.018), (0.62 * r, 0.014)):
            ring = [np.array((c[0], c[1], 0.0)) + R[:, 0] * rad * math.cos(a) + R[:, 1] * rad * 0.9 * math.sin(a)
                    for a in np.linspace(0, math.tau, 41)]
            ring = [p + np.array((0, 0, float(surfaces(p[0], p[1])[0]) + h * 0.5)) for p in ring]
            F.groove(sdf.Polyline(ring, [0.008] * len(ring)), depth, k=0.013)
        # eight carved ticks round the rim: the temple's hours of the tide
        for j in range(8):
            a = math.tau * (j + 0.5) / 8
            pa = np.array((c[0], c[1], 0.0)) + R[:, 0] * 0.7 * r * math.cos(a) + R[:, 1] * 0.7 * r * 0.9 * math.sin(a)
            pb = np.array((c[0], c[1], 0.0)) + R[:, 0] * 0.86 * r * math.cos(a) + R[:, 1] * 0.86 * r * 0.9 * math.sin(a)
            seg = [q + np.array((0, 0, float(surfaces(q[0], q[1])[0]) + h * 0.5)) for q in (pa, pb)]
            F.groove(sdf.Polyline(seg, [0.006, 0.006]), 0.012, k=0.01)
    # the mouth: a wide slot across the blunt front of the head
    F.sub(RoundBox((0.0, -1.32, Z0 - 0.04), (0.34, 0.09, 0.028), radius=0.02), 0.03)
    # gill slits under the head, five a side
    for s in (1, -1):
        for j in range(5):
            y = GILL_Y0 + GILL_DY * j
            pts = []
            for x in np.linspace(GILL_X[0], GILL_X[1], 8):
                pts.append(np.array((s * x, y + 0.08 * (x - GILL_X[0]), float(surfaces(x, y)[1]) - 0.004)))
            F.groove(sdf.Polyline(pts, [0.012] * len(pts)), 0.04, k=0.016)
            if j < 4:
                bar = [q + np.array((0, GILL_DY * 0.5, -0.002)) for q in pts]
                F.ridge(sdf.Polyline(bar, [0.01] * len(bar)), 0.012, k=0.014)
    # the belly: a shallow keel down the middle and the paired ridges of the
    # pectoral girdle
    keel = [np.array((0.0, y, float(surfaces(0.0, y)[1]) + 0.002)) for y in np.linspace(-0.9, 0.6, 12)]
    F.ridge(sdf.Polyline(keel, [0.02] * 12), 0.02, k=0.03)
    for s in (1, -1):
        rib = [np.array((s * x, -0.25 + 0.25 * x * x, float(surfaces(s * x, -0.25 + 0.25 * x * x)[1]) + 0.002))
               for x in np.linspace(0.12, 0.62, 8)]
        F.ridge(sdf.Polyline(rib, [0.016] * 8), 0.016, k=0.025)
        # the eye socket
        F.sub(Sphere(_m(EYE_AT, s), EYE_R * 0.9), 0.02)
    # the cephalic lobes: two short flat stalks from the head's corners run
    # forward into one great silver crescent moon standing round the pearl,
    # its horns swept back. The crescent is one cut blade (Crescent); the
    # lobe and cradle stations under it still carry its skin weights (the
    # horns ride the Lobe bones, its belly the head) but are not meshed.
    for s, side in ((1, 'L'), (-1, 'R')):
        for j, (c, R, w, t, al) in enumerate(lobe_stations(s)):
            bone = f'{side}_Lobe1' if j < len(LOBE_STATIONS) // 2 else f'{side}_Lobe2'
            prim = Ellipsoid(c, (w, al, t), R, bone=bone)
            if j < 5:
                F.add(prim, 0.06 if j < 2 else 0.045)
            else:
                F.prims.append((prim, 0.0))
    for c, R, w, t, al in cradle_stations():
        F.prims.append((Ellipsoid(c, (w, al, t), R, bone='Head'), 0.0))
    F.add(CRESCENT, 0.03, weight=False)
    # a line engraved round the crescent's face, between its edges
    arc = []
    for a in np.linspace(math.radians(28), math.radians(-208), 47):
        rr = 0.5 * (CRESCENT_RO + CRESCENT_RI)
        x, z = rr * math.cos(a), rr * math.sin(a) + 0.5 * (CRESCENT_OZ + CRESCENT_IZ)
        if (x * x + (z - CRESCENT_IZ) ** 2) < (CRESCENT_RI + 0.035) ** 2:
            continue
        arc.append(np.array((x, CRESCENT.front_y(x) - 0.002, PEARL_AT[2] + z)))
    F.groove(sdf.Polyline(arc, [0.006] * len(arc)), 0.012, k=0.01)
    # the dorsal fin at the root of the tail, and the pelvic fins either side
    R = sdf.rot_matrix(rx=-0.5)
    F.add(Ellipsoid((0.0, 1.08, Z0 + 0.16), (0.022, 0.2, 0.13), R, bone='Hip'), 0.04)
    for s in (1, -1):
        F.add(Ellipsoid((s * 0.27, 1.34, Z0 - 0.05), (0.15, 0.24, 0.025), sdf.rot_matrix(rz=s * 0.35), bone='Hip'),
              0.04)
    # skin weight carriers: one slab per bone, never meshed
    big = 0.7
    car = [('Head', (-0.5, -2.2), (0.5, -0.75)), ('Body', (-0.5, -0.75), (0.5, 0.55)),
           ('Hip', (-0.5, 0.55), (0.5, 1.8))]
    for i in range(N_WING):
        x0 = WING_X[i]
        x1 = WING_X[i + 1] if i < N_WING - 1 else S + 0.4
        car.append((f'L_Wing{i + 1}', (x0, -2.2), (x1, 1.8)))
        car.append((f'R_Wing{i + 1}', (-x1, -2.2), (-x0, 1.8)))
    for bone, (x0, y0), (x1, y1) in car:
        c = ((x0 + x1) / 2, (y0 + y1) / 2, Z0)
        F.prims.append((RoundBox(c, ((x1 - x0) / 2, (y1 - y0) / 2, big), radius=0.0, bone=bone), 0.0))
    noise = Noise(17)
    F.displace(lambda X_, Y_, Z_: 0.0012 * noise.fbm(X_ * 18, Y_ * 18, Z_ * 18, octaves=2), band=0.03)
    return F


def body_paint(obj):
    """RegRim (the clear wing edge), RegPlate / RegMoon / RegRing (the nacre
    plates, the lit part of each moon, the carved outlines), RegLobe (the
    silver crescent), RegMouth, RegGill, RegSpan (the span fraction, 0 at the
    centre: the stars and the sheen key on it)."""
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    d2 = dist2d(P[:, :2])
    wing = X.ramp(np.abs(x), 0.55, 0.95)
    rim = np.clip(1 - (-d2) / 0.34, 0, 1) * wing
    top, bot = surfaces(x, y)
    on_top = (z > (top + bot) * 0.5).astype(float)
    plate = np.zeros(len(P))
    lit = np.zeros(len(P))
    ring = np.zeros(len(P))
    disc = np.zeros(len(P))
    for c, r, ph in plates():
        p_, l_, g_, d_ = moon_masks(P[:, :2], c, r, ph)
        plate = np.maximum(plate, p_ * on_top)
        lit = np.maximum(lit, l_ * on_top)
        ring = np.maximum(ring, g_ * on_top * p_)
        disc = np.maximum(disc, d_ * on_top)
    lobe = np.zeros(len(P))
    for s in (1, -1):
        for c, R, w, t, al in lobe_stations(s):
            dd = np.linalg.norm(P - c, axis=1)
            lobe = np.maximum(lobe, np.clip((w + 0.06 - dd) / 0.05, 0, 1) * (y < -1.24))
    lobe = np.maximum(lobe, np.clip(1 - (CRESCENT.dist_pts(P) - 0.004) / 0.02, 0, 1))
    mouth = (np.abs(x) < 0.36) * (y < -1.2) * np.clip(1 - np.abs(z - (Z0 - 0.04)) / 0.06, 0, 1)
    mouth = mouth * X.ramp(-y, 1.22, 1.3)
    gill = np.zeros(len(P))
    for s in (1, -1):
        for j in range(5):
            yy = GILL_Y0 + GILL_DY * j
            on = (np.abs(x) > GILL_X[0] - 0.02) & (np.abs(x) < GILL_X[1] + 0.02) & (z < (top + bot) * 0.5)
            gill = np.maximum(gill, np.clip(1 - np.abs(y - (yy + 0.08 * (np.abs(x) - GILL_X[0]))) / 0.028, 0, 1) * on)
    _write(obj, {'RegRim': rim, 'RegPlate': plate, 'RegMoon': lit, 'RegRing': ring, 'RegDisc': disc, 'RegLobe': lobe,
                 'RegMouth': mouth, 'RegGill': gill, 'RegSpan': np.clip(np.abs(x) / S, 0, 1)})


# ------------------------------------------------------------------ the tail and its tide-glass
def build_tail(voxel):
    lo = np.array((-0.2, TAIL[0][1] - 0.2, TAIL[-1][2] - 0.2))
    hi = np.array((0.2, TAIL[-1][1] + 0.2, TAIL[0][2] + 0.2))
    F = Field(lo, hi, voxel)
    for i in range(6):
        F.add(RoundCone(TAIL[i], TAIL[i + 1], TAIL_R[i], TAIL_R[i + 1], bone=f'Tail{i + 1}'), 0.02)
    # a faint keel of fine ridges down its top, like a whip's braid
    for i in range(5):
        a, b = TAIL[i], TAIL[i + 1]
        F.ridge(sdf.Polyline([a + np.array((0, 0, TAIL_R[i] * 0.85)), b + np.array((0, 0, TAIL_R[i + 1] * 0.85))],
                             [0.004, 0.004]), 0.006, k=0.008)
    return F


def crystal_axis():
    a = TAIL[-1]
    d = (TAIL[-1] - TAIL[-2]) / np.linalg.norm(TAIL[-1] - TAIL[-2])
    return a - d * 0.06, a + d * CRYSTAL_LEN


def build_crystal(voxel):
    a, b = crystal_axis()
    F = Field(np.minimum(a, b) - 0.15, np.maximum(a, b) + 0.15, voxel)
    F.add(X.Prism(a, b, 0.08, n=6, tip=0.42, tip_a=0.25, rot=0.3), 0.0, weight=False)
    # two smaller shards set at its waist, like a cluster of sea-glass
    d = (b - a) / np.linalg.norm(b - a)
    for k, (sx, sz) in enumerate(((1, 0.6), (-1, -0.4))):
        side = np.array((sx * 0.06, 0.0, sz * 0.05))
        F.add(X.Prism(a + d * 0.12 + side * 0.5, a + d * 0.3 + side * 1.6, 0.035, n=5, tip=0.4, rot=0.2 * k),
              0.0, weight=False)
    return F


def crystal_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    a, b = crystal_axis()
    d = (b - a) / np.linalg.norm(b - a)
    u = (P - a) @ d / np.linalg.norm(b - a)
    _write(obj, {'RegAlong': np.clip(u, 0, 1)})


# ------------------------------------------------------------------ the heart pearl
def build_heart(voxel):
    """The heart pearl: a great pearl with the growth lines of its nacre
    sculpted round it and a crescent carved on its face."""
    r = PEARL_R * HEART_K
    F = Field(PEARL_AT - r - 0.1, PEARL_AT + r + 0.1, voxel)
    F.add(Sphere(PEARL_AT, r), 0.0, weight=False)
    for dz in (-0.55, -0.15, 0.3):
        rr = r * math.sqrt(1 - dz * dz)
        ring = [PEARL_AT + np.array((rr * math.cos(a), rr * math.sin(a), dz * r)) for a in np.linspace(0, math.tau, 49)]
        F.groove(sdf.Polyline(ring, [0.003] * len(ring)), 0.004, k=0.006)
    arc = []
    for a in np.linspace(math.radians(120), math.radians(420), 25):
        q = np.array((0.42 * r * math.cos(a), 0.0, 0.42 * r * math.sin(a) - 0.06 * r))
        q[1] = -math.sqrt(max(0.0, r * r - q[0] ** 2 - q[2] ** 2))
        arc.append(PEARL_AT + q)
    F.groove(sdf.Polyline(arc[:13], [0.006] * 13), 0.008, k=0.008)
    return F


def heart_paint(obj):
    from rig import mesh_arrays
    P, _ = mesh_arrays(obj)
    d = P - PEARL_AT
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    _write(obj, {'RegFront': np.clip(-d[:, 1], 0, 1)})


# ------------------------------------------------------------------ the sculpt list
def fields(k=1.0):
    from build_core import Sculpt
    head_c = (0.0, -1.3, Z0 + 0.2)
    S_ = [Sculpt('Body', build_body(0.016 * k), 'mantle', 17000, tau=0.09, relax=5, paint=body_paint,
                 spots=[(head_c, 0.55, 0.9), (tuple(PEARL_AT), 0.62, 0.9), (tuple(_m(EYE_AT, 1)), 0.15, 0.8), (tuple(_m(EYE_AT, -1)), 0.15, 0.8)]),
          Sculpt('Tail', build_tail(0.007 * k), 'mantle_tail', 1600, tau=0.12, relax=3),
          Sculpt('HeartPearl', build_heart(0.005 * k), 'heart', 1400, binding='rigid', bone='Pearl',
                 paint=heart_paint),
          Sculpt('TideGlass', build_crystal(0.005 * k), 'glass', 500, binding='rigid', bone='Tail6',
                 paint=crystal_paint)]
    return S_


_ = (X, Sphere)
