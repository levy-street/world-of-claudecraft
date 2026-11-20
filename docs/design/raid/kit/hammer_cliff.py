"""The Hammer vein's quarried rock as a giant cut it (phase 2C): the worked
faces of the quarry's terraces, the pit's rim and the Gallery's lips, and
the great cliffs crowning the quarry's back wall.

Each is a signed-distance field (the colossi's sculpt primitives,
hammer_sculpt.py) meshed once through OpenVDB, so the rock reads as ONE
cliff cut in benches, never a stack of separate boxes:
  - the face falls in two to four benches, each lower lift standing a little
    proud of the one above, the bench lines running out of true;
  - each bench is cut into blocks of every size (a great monolith beside a
    cluster of small lifts), the joints between them cut deep;
  - long cracks run down through the benches; a block or two has been pulled
    out of the face (a dark notch), another juts out under the lip as an
    overhang;
  - the giant's tool marks: broad drill channels down the splits, chisel
    bands across the larger blocks, a pick's chatter over everything;
  - (where it stands on an unwalked step) broken blocks and spoil fallen at
    its foot.
The finished stone is the RAW kind (shkit.SPiece weathers it: worn crests,
black joints, dust only where it settles); the blocks take a few tones of
the cool granite so neighbouring blocks never read as one paint.

Game yards, +Z up, the face toward -Y, origin on the lip. Deterministic:
every noise is seeded, nothing reads the clock.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Polyline, RoundBox, Sculpt, block
from gwkit import add_sculpt, crystal, mix
from jaguar_head_sculpt import Noise
from shkit import GLOW, QUARRY, QUARRY_DARK, QUARRY_DEEP, QUARRY_PALE, QUARRY_RED, RAW, TAU, VEIN

# The tones a face's blocks take (sRGB) and their kinds.
CLIFF_COLOURS = {
    'q0': QUARRY,
    'q1': mix(QUARRY, QUARRY_DARK, 0.45),
    'q2': QUARRY_DARK,
    'q3': mix(QUARRY, QUARRY_PALE, 0.6),
    'q4': mix(QUARRY, QUARRY_RED, 0.3),
    'q5': (0.47, 0.42, 0.4),             # a warm grey bed (warm and cool greys mix)
    'q6': mix(QUARRY, (0.47, 0.42, 0.4), 0.45),   # a bed a breath warmer than q0
    'deep': mix(QUARRY_DARK, QUARRY_DEEP, 0.6),
    'vein': VEIN,
}
CLIFF_KINDS = {k: RAW for k in CLIFF_COLOURS}
CLIFF_KINDS['vein'] = (RAW, GLOW)
TONES = ('q0', 'q0', 'q1', 'q5', 'q5', 'q2', 'q3', 'q4')
# A bed's neighbours (a lift of the same rock a shade off, never a patchwork).
NEAR_TONES = {'q0': ('q1', 'q5'), 'q1': ('q0', 'q2'), 'q5': ('q0', 'q4'), 'q3': ('q0', 'q5'), 'q6': ('q0', 'q5')}
# The beds of a worked face, top lift down.
LIFT_TONES = ('q0', 'q6', 'q1')


class CliffSculpt(Sculpt):
    """A Sculpt with paint zones: after the nearest-part classification, a
    face whose centre lies in a zone takes the zone's label (a fresh cut face
    painted pale over the mountain's weathered mass)."""

    def __init__(self, lo, hi, voxel):
        super().__init__(lo, hi, voxel)
        self.zones = []

    def zone(self, label, lo, hi):
        self.zones.append((label, np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)))

    def classify(self, centres, default='hide'):
        kind = super().classify(centres, default)
        # The vein's light wins wherever its own surface is (laid in a groove
        # cut into a body, the body's inside would otherwise claim it).
        for label, prim in self.parts:
            if label == 'vein':
                kind[prim.at(centres) < 0.04] = 'vein'
        for label, lo, hi in self.zones:
            inside = np.all((centres >= lo) & (centres <= hi), axis=1)
            kind[inside & (kind != 'vein')] = label
        return kind


def _bound(f, axis, lo=None, hi=None):
    """Intersect the field with lo <= coordinate <= hi on one axis."""
    a = f.axes[axis]
    shape = [1, 1, 1]
    shape[axis] = -1
    A = a.reshape(shape)
    if lo is not None:
        f.d = np.maximum(f.d, (lo - A).astype(np.float32) + np.zeros_like(f.d))
    if hi is not None:
        f.d = np.maximum(f.d, (A - hi).astype(np.float32) + np.zeros_like(f.d))


def cut_benches(f, rng, x0, x1, z_top, z_bot, depth, bench=0.55, proud=0.25, notch=0.35, overhang=0.3,
                crack=0.6, chisel=0.45, front_max=None, wmin=1.6, wmax=5.5, vein=None):
    """Sculpt a face of benches into field f (see the module doc). Returns
    the prims (for the noise's reach)."""
    span = z_top - z_bot
    # The body behind every block: the dark of the deep joints and notches.
    f.put('deep', RoundBox(((x0 + x1) / 2, depth * 0.7, (z_top + z_bot) / 2),
                           ((x1 - x0) / 2 + 0.8, depth * 0.35, span / 2 + 0.2), 0.05), 0.0)
    # The benches: two to four lifts down the face.
    # Two or three tall lifts at the SAME heights on every module (phase 2D):
    # the bench lines run on unbroken from module to module round the whole
    # quarry, as a real quarry's benches do, so the seams never read as a
    # grid of blocks; 2C's lifts, random per module, stepped at every seam.
    span = z_top - z_bot
    n_lifts = 2 if span < 9.0 else 3
    zs = [z_top - span * k / n_lifts for k in range(n_lifts)] + [z_bot]
    prims = []
    for i in range(len(zs) - 1):
        zt, zb = zs[i], zs[i + 1]
        # The lift's own bed of the granite, the same on every module (the
        # beds run round the quarry as strata); its face set the same too.
        module_bed = LIFT_TONES[i % len(LIFT_TONES)]
        base_y = -bench * i
        # Phase 2D: each lift is ONE body of rock across the module (2C cut
        # it into a row of blocks, and a row of blocks reads as masonry from
        # across the pit). Now and then the lift steps once along its run
        # (the face taken back a little further on one side); its splits are
        # cut into it, never gaps between boxes.
        bed = module_bed
        spans = [(x0 - 1.2, x1 + 1.2)]
        if rng.random() < 0.35:
            # A stretch of the lift taken back further (a cut not finished
            # flush), the module's ends flush with its neighbours.
            m0 = rng.uniform(x0 + 1.0, x0 + (x1 - x0) * 0.45)
            m1 = rng.uniform(m0 + 2.0, x1 - 1.0)
            spans = [(x0 - 1.2, m0 + 0.05), (m0 - 0.05, m1 + 0.05), (m1 - 0.05, x1 + 1.2)]
        for j, (a, b) in enumerate(spans):
            # The step along the run (if any) takes the face back; the ends
            # stay on the shared face line so neighbours meet flush.
            yo = base_y + (rng.uniform(0.15, proud + 0.2) if j == 1 else 0.0)
            if front_max is not None:
                yo = max(yo, -front_max)
            c = ((a + b) / 2, yo + depth / 2, (zt + zb) / 2)
            size = (b - a, depth, zt - zb + 0.02)
            R = gs.rot(rz=rng.uniform(-0.02, 0.02), rx=rng.uniform(-0.03, 0.02))
            prim = block(rng, c, size, cuts=4, chamfer=(0.95, 0.995), R=R)
            f.put(bed, prim, 0.0)
            prims.append(prim)
        # A boss of harder rock standing out of the lift (never on a rim).
        # Wide and low, its own bed's tone (phase 2D: tall rounded ones, the
        # same at every module, read as rows of headstones across the pit).
        if front_max is None and rng.random() < 0.3:
            w = rng.uniform(2.8, 5.0)
            bx = rng.uniform(x0 + w / 2, x1 - w / 2)
            out = rng.uniform(0.25, 0.5)
            h = (zt - zb) * rng.uniform(0.3, 0.5)
            bz = zb + h / 2
            prim = block(rng, (bx, base_y - out + depth * 0.25, bz), (w, depth * 0.5, h), cuts=5,
                         chamfer=(0.88, 0.97), R=gs.rot(rz=rng.uniform(-0.06, 0.06)))
            f.put(bed, prim, 0.15)
            prims.append(prim)
        # The overhang: the top lift's brink jutting out over a shadowed undercut.
        if i == 0 and rng.random() < overhang:
            w = rng.uniform(2.2, 4.0)
            ox = rng.uniform(x0 + w / 2, x1 - w / 2)
            yo = base_y - rng.uniform(0.5, 1.0)
            if front_max is not None:
                yo = max(yo, -front_max)
            th = rng.uniform(0.9, 1.5)
            prim = block(rng, (ox, yo + depth / 2, zt - th / 2), (w, depth, th), cuts=6, chamfer=(0.85, 0.97))
            f.put(bed, prim, 0.05)
            prims.append(prim)
            f.sub(RoundBox((ox, base_y + 0.4, zt - th - 0.3), (w / 2 * 0.9, 0.7, 0.3), 0.1), 0.05)
        # The splits cut into the lift: a few, slanting a little, some the
        # lift's whole height, some stopping short (a parting the rock
        # barely shows), never a grid of joints.
        for _ in range(int(rng.integers(1, 3))):
            sx = rng.uniform(x0 + 0.8, x1 - 0.8)
            lean = rng.uniform(-0.25, 0.25)
            top = zt if rng.random() < 0.6 else zb + (zt - zb) * rng.uniform(0.4, 0.8)
            deep = rng.random() < 0.4
            f.groove(Polyline([(sx, base_y - 0.05, zb), (sx + lean * (top - zb), base_y - 0.05, top)], 0.02),
                     0.22 if deep else 0.1, 0.08 if deep else 0.05)
        # Chisel bands across the lift (the giant's claw).
        if zt - zb > 1.4 and rng.random() < chisel:
            n = int(rng.integers(3, 6))
            slant = rng.choice([0.0, 0.35, -0.35])
            w0 = rng.uniform(1.6, 3.4)
            bx = rng.uniform(x0 + 0.3, x1 - 0.3 - w0)
            z0 = rng.uniform(zb + 0.3, max(zb + 0.35, zt - 0.3 - n * 0.34))
            for k in range(n):
                zz = z0 + k * 0.34
                f.groove(Polyline([(bx, base_y - 0.02, zz), (bx + w0, base_y - 0.02, zz + slant * w0 * 0.3)], 0.02),
                         0.11, 0.07)
        # A drill channel down the lift, here and there.
        if rng.random() < 0.4:
            xx = rng.uniform(x0 + 0.5, x1 - 0.5)
            f.groove(Polyline([(xx, base_y - 0.03, zb + 0.15), (xx, base_y - 0.03, zt - 0.1)], 0.02), 0.12, 0.07)
        # The parting between lifts, wandering a little (a bedding plane,
        # never a ruled course line).
        line = [(xx, base_y - 0.1, zb + rng.uniform(-0.28, 0.28)) for xx in np.linspace(x0 - 1, x1 + 1, 6)]
        f.groove(Polyline(line, 0.02), 0.2, 0.09)
    # Long cracks down through the benches.
    n_cracks = (1 if rng.random() < crack else 0) + (1 if rng.random() < crack * 0.4 else 0)
    for _ in range(n_cracks):
        cx = rng.uniform(x0 + 1.2, x1 - 1.2)
        pts = []
        z = z_top + 0.2
        while z > z_bot - 0.2:
            pts.append((cx + rng.uniform(-0.35, 0.35), -bench * len(zs), z))
            z -= rng.uniform(0.8, 1.6)
        pts.append((cx, -bench * len(zs), z_bot - 0.3))
        f.groove(Polyline(pts, 0.08), 1.6, 0.26)
    # Natural fractures: the lip broken off here and there along an oblique
    # plane (the rock is never all square cuts).
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    for _ in range(int(rng.integers(0, 2))):
        cx = rng.uniform(x0 + 0.5, x1 - 0.5)
        cz = z_top - rng.uniform(1.6, 2.6)
        n = np.array((rng.uniform(-0.8, 0.8), -1.0, rng.uniform(0.6, 1.4)))
        n /= np.linalg.norm(n)
        off = rng.uniform(0.15, 0.35)
        half = rng.uniform(1.8, 3.2)
        front = (-(n[0] * (X - cx) + n[1] * Y + n[2] * (Z - cz)) - off).astype(np.float32)
        side = (np.abs(X - cx) - half).astype(np.float32)
        below = (cz - Z).astype(np.float32)
        chunk = np.maximum(np.maximum(front, side), below)
        f.d = np.maximum(f.d, -chunk)
    # The lip broken away here and there (phase 2D): chunks spalled off the
    # top edge, so the bench's brink reads as worked rock, never a wall top.
    # (Not on a face carrying the vein's seam in its lip bench: it would hang.)
    for _ in range(0 if vein else int(rng.integers(1, 4))):
        cx = rng.uniform(x0 + 0.6, x1 - 0.6)
        w = rng.uniform(1.4, 3.4)
        h = rng.uniform(0.7, 1.8)
        dp = rng.uniform(0.7, 1.5)
        f.sub(block(rng, (cx, -0.1, z_top - h * 0.3), (w, dp * 2, h * 2), cuts=9, chamfer=(0.6, 0.88),
                    R=gs.rot(rz=rng.uniform(-0.5, 0.5), rx=rng.uniform(-0.4, 0.25), ry=rng.uniform(-0.3, 0.3))), 0.2)
    if vein:
        f.put('vein', Polyline(vein, 0.09), 0.02)
    # Clamp: flat on the lip, the module's ends, the foot, the front.
    f.cut_above(z_top)
    f.cut_below(z_bot)
    _bound(f, 0, x0 - 0.4, x1 + 0.4)
    if front_max is not None:
        _bound(f, 1, -front_max, None)
    return prims


def chatter(f, seed, prims, amp=0.05):
    """The pick's chatter and the stone's own unevenness over the cut faces."""
    n1, n2 = Noise(seed), Noise(seed + 5)

    def fn(X, Y, Z):
        # The rock's own broad swell over the cut (a face is never a plane),
        # then the pick's chatter.
        return (amp * 2.6 * n1.fbm(X * 0.3 + 3.1, Y * 0.3, Z * 0.42, 2)
                + amp * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 3) + amp * 0.5 * n2.ridged(X * 2.6 + Z, Y * 2.6, Z * 2.6, 2))
    f.displace(fn, band=0.4)


def foot_spoil(p, rng, x0, x1, z_bot, y_foot):
    """Broken blocks and spoil fallen at a face's foot (an unwalked step);
    rng is the piece's own (Python) generator."""
    for k in range(rng.randint(4, 7)):
        s = rng.uniform(0.45, 1.5)
        x = rng.uniform(x0 + 0.5, x1 - 0.5)
        # Lying where they fell, broken and low (phase 2D: stood up, the
        # same few blocks at every module's foot read as rows of headstones).
        crystal(p, (x, y_foot - rng.uniform(0.3, 1.8), z_bot + s * 0.16), (s * 1.3, s * 1.1, s * 0.5),
                p.vary(QUARRY if k % 3 else QUARRY_PALE, 0.06), n=14, boxy=0.55, jitter=0.28,
                yaw=rng.uniform(0, TAU), pitch=rng.uniform(-0.15, 0.15), roll=rng.uniform(-0.15, 0.15),
                floor=z_bot)
    # A talus of fine spoil along the foot, in heaps.
    x = x0 + rng.uniform(0.3, 1.2)
    while x < x1 - 1.0:
        w = rng.uniform(1.8, 3.2)
        crystal(p, (x + w / 2, y_foot - 0.5 + rng.uniform(-0.4, 0.4), z_bot + 0.1), (w, rng.uniform(1.4, 2.2), 0.7),
                QUARRY_DARK, n=14, boxy=0.7, jitter=0.12, floor=z_bot, yaw=rng.uniform(-0.3, 0.3))
        x += w * rng.uniform(1.0, 1.8)


def sculpt_face(bpy, p, name, seed, x0, x1, z_top, z_bot, depth, target, foot=True, voxel=0.075, **kw):
    """A sculpted face module into piece p (see cut_benches for kw)."""
    rng = np.random.default_rng(seed)
    front = kw.get('front_max')
    ylo = -(front + 0.2) if front is not None else -4.5
    f = Sculpt((x0 - 1.0, ylo, z_bot - 0.4), (x1 + 1.0, depth + 0.4, z_top + 0.3), voxel)
    prims = cut_benches(f, rng, x0, x1, z_top, z_bot, depth, **kw)
    chatter(f, seed, prims)
    f.cut_above(z_top)
    if front is not None:
        _bound(f, 1, -front, None)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, CLIFF_COLOURS, CLIFF_KINDS, smooth=False)
    if foot:
        foot_spoil(p, p.rng, x0, x1, z_bot, -kw.get('bench', 0.55) * 3)
    return p


def great_cliff(bpy, p, variant, target=12600):
    """A crown of the quarry's back wall (stands on the top step, the face
    toward the pit, -Y; origin at its foot): the mountain's own craggy rock,
    its natural fractures and leaning slabs breaking the skyline, the lower
    half cut away by the Smith in great flat benches (the giant's quarry cut
    into the living mountain), the cut faces split into a few huge blocks on
    deep joints, broad drill channels down them, a great block half split out
    of the face on its drill line, the vein's light in a seam."""
    seed = {'A': 401, 'B': 409, 'C': 419}[variant]
    rng = np.random.default_rng(seed)
    W, D, Hh = {'A': (30.0, 13.0, 26.0), 'B': (24.0, 12.0, 21.0), 'C': (34.0, 14.0, 28.0)}[variant]
    f = CliffSculpt((-W / 2 - 4, -10, -2), (W / 2 + 4, D + 3, Hh + 8), 0.22)
    # The mountain: craggy masses along one ridge (taller than any peak: the
    # crest below carves the skyline), each leaning back into the mountain.
    k = int(rng.integers(5, 8))
    for i in range(k):
        t = (i + 0.5) / k
        x = -W / 2 + t * W + rng.uniform(-1.5, 1.5)
        w = W / k * rng.uniform(1.5, 2.1)
        f.put('q2' if i % 2 else 'q1',
              block(rng, (x, D * 0.55 + rng.uniform(-1.0, 1.0), Hh * 0.6), (w, D * rng.uniform(1.0, 1.3), Hh * 1.25),
                    cuts=12, chamfer=(0.7, 0.9), R=gs.rot(rx=rng.uniform(0.05, 0.12), ry=rng.uniform(-0.08, 0.08),
                                                         rz=rng.uniform(-0.12, 0.12)), top_tilt=0.3), 1.4)
    # The crest (phase 2D): a mountain's silhouette, never a wall's top. Low
    # shoulders at the ends (each massif stands on its own), two or three
    # peaks of unequal height, a notch or two cut deep between them, a slow
    # fracture along the line, and the summit falling back away from the pit.
    peaks = []
    xs = np.sort(rng.uniform(-W * 0.38, W * 0.38, int(rng.integers(2, 4))))
    for i, c in enumerate(xs):
        # (centre, height, width on its left, width on its right): a peak's
        # two flanks never match.
        peaks.append((c, Hh * rng.uniform(0.08, 0.17) * (1.4 if i == len(xs) // 2 else 1.0),
                      W * rng.uniform(0.14, 0.26), W * rng.uniform(0.14, 0.26)))
    notches = []
    for i in range(len(xs) - 1):
        if rng.random() < 0.8:
            notches.append(((xs[i] + xs[i + 1]) / 2 + rng.uniform(-1.5, 1.5), Hh * rng.uniform(0.1, 0.18),
                            W * rng.uniform(0.04, 0.065)))
    tilt = rng.uniform(-0.14, 0.14)
    nc = Noise(seed + 11)
    yr = D * 0.4

    def crest(X, Y):
        t = np.clip(X / (W / 2), -1.4, 1.4)
        # A long ridge sagging to lower shoulders at the ends (each massif
        # stands on its own) and tilted one way.
        z = Hh * 0.74 * (1 - 0.34 * np.abs(t) ** 2.6) * (1 + tilt * t)
        for (c, a, wl, wr) in peaks:
            w = np.where(X < c, wl, wr)
            r2 = ((X - c) / w) ** 2 + ((Y - yr) / (0.9 * w)) ** 2
            z = z + a * np.maximum(0.0, 1 - r2)
        for (c, a, w) in notches:
            z = z - a * np.maximum(0.0, 1 - np.abs(X - c) / w)
        # The ridge's crags: a slow swell and a sharp, broken jag along it.
        z = z + 1.4 * nc.fbm(X * 0.08, Y * 0.05, 0.0, 2) + 2.2 * (nc.ridged(X * 0.16, Y * 0.1, 3.0, 2) - 0.5)
        # The summit stands back of the face: the crest falls steeply to the
        # face's brink and gently away behind the ridge.
        return z - np.maximum(0.0, Y - yr) * 0.5 - np.maximum(0.0, yr - Y) * 0.75

    X2 = f.axes[0][:, None, None]
    Y2 = f.axes[1][None, :, None]
    Z2 = f.axes[2][None, None, :]
    f.d = np.maximum(f.d, ((Z2 - crest(X2, Y2)) * 0.6).astype(np.float32))
    # The tallest peak's overhang: a slab of the summit jutting out over the
    # cut, its underside in shadow (the low sun rims its lip).
    pc, pa, pw, _pw = max(peaks, key=lambda q: q[1])
    top = float(crest(np.array(pc), np.array(D * 0.1)))
    f.put('q2', block(rng, (pc + pw * 0.15, D * 0.1, top - 2.6), (pw * 0.9, 6.0, 2.6), cuts=5, chamfer=(0.8, 0.95),
                      R=gs.rot(rx=-0.18, rz=rng.uniform(-0.1, 0.1))), 0.5)
    # The Smith's cut: great flat benches taken out of the front, stepping
    # back as they rise; each cut face pale (fresh), split into a few huge
    # blocks on deep joints, drill channels down the splits.
    z = 0.0
    y = 0.6
    benches = int(rng.integers(2, 4))
    floors = []
    for b in range(benches):
        h = Hh * rng.uniform(0.18, 0.28)
        x0b = -W / 2 + rng.uniform(1, 5)
        x1b = W / 2 - rng.uniform(1, 5)
        # Take away everything in front of the cut, above the bench's floor.
        f.sub(RoundBox(((x0b + x1b) / 2, y - 6, z + h + Hh), ((x1b - x0b) / 2, 6, Hh), 0.05), 0.0)
        # The fresh cut faces and the bench's floor, painted pale.
        f.zone('q3' if b % 2 == 0 else 'q0', (x0b - 0.3, y - 0.6, z - 0.4), (x1b + 0.3, y + 0.6, z + h + 0.2))
        f.zone('q0', (x0b - 0.3, y - 12.5, z - 0.6), (x1b + 0.3, y + 0.4, z + 0.6))
        xx = x0b + rng.uniform(2, 4)
        while xx < x1b - 1.5:
            f.groove(Polyline([(xx, y - 0.1, z), (xx + rng.uniform(-0.3, 0.3), y - 0.1, z + h)], 0.05), 0.6, 0.16)
            if rng.random() < 0.5:
                for kk in range(int(rng.integers(3, 6))):
                    dx = xx + 0.6 + kk * 0.5
                    f.groove(Polyline([(dx, y - 0.05, z + 0.3), (dx, y - 0.05, z + h - 0.3)], 0.03), 0.16, 0.07)
            xx += rng.uniform(4.0, 8.0)
        zz = z + h * rng.uniform(0.4, 0.6)
        f.groove(Polyline([(x0b, y - 0.1, zz), (x1b, y - 0.1, zz + rng.uniform(-0.4, 0.4))], 0.05), 0.5, 0.15)
        z += h
        y_next = y + rng.uniform(2.0, 3.5)
        floors.append((x0b, x1b, y, y_next, z))
        y = y_next
    # The great block half split out of the lowest cut, on its drill line.
    gx = rng.uniform(-W / 4, W / 4)
    f.put('q3', block(rng, (gx, -1.6, 2.4), (6.5, 4.0, 4.8), cuts=4, chamfer=(0.9, 0.99), R=gs.rot(rz=0.12, rx=-0.05)),
          0.0)
    for kk in range(9):
        xx = gx - 2.8 + kk * 0.7
        f.groove(Polyline([(xx, -3.7, 4.9), (xx, -3.7, 0.2)], 0.03), 0.18, 0.08)
    # A cleft down the natural rock above the cuts.
    cx = rng.uniform(-W / 3, W / 3)
    pts = []
    zz = Hh + 6
    while zz > z:
        pts.append((cx + rng.uniform(-0.8, 0.8), y - 2 + rng.uniform(-0.5, 0.5), zz))
        zz -= rng.uniform(2, 4)
    f.groove(Polyline(pts, 0.25), 2.4, 0.5)
    # The vein's light in a seam across the lowest cut.
    seam = []
    for kk in range(7):
        t = kk / 6
        seam.append((-W / 2 + 3 + t * (W - 6), 0.45, 1.4 + Hh * 0.08 * (1 + math.sin(t * 5.0 + seed))))
    f.groove(Polyline(seam, 0.1), 0.5, 0.22)
    f.put('vein', Polyline([(x, yy - 0.05, zz2) for (x, yy, zz2) in seam], 0.14), 0.02)
    n1, n2 = Noise(seed), Noise(seed + 7)
    # The weather on the mountain's own rock: broad fracture facets and
    # ledges over the slopes (the summit's back never a smooth plane), the
    # finer chatter over everything.
    f.displace(lambda X, Y, Z: 0.55 * n1.ridged(X * 0.11, Y * 0.11, Z * 0.16, 2) * np.clip((Z - 6.0) / 8.0, 0.0, 1.0)
               + 0.16 * n1.fbm(X * 0.3, Y * 0.3, Z * 0.3, 3)
               + 0.07 * n2.ridged(X * 1.1 + Z * 0.5, Y * 1.1, Z * 1.1, 2), band=1.6)
    f.cut_below(0.0)
    verts, faces = gs.mesh_sculpt(f, bpy, 'GreatCliff' + variant, target)
    add_sculpt(p, f, verts, faces, CLIFF_COLOURS, CLIFF_KINDS, smooth=False)
    foot_spoil(p, p.rng, -W / 2 + 2, W / 2 - 2, 0.0, -4.5)
    # Scree (phase 2D): spalls fallen from the face lying in heaps on the
    # benches and against the foot of each riser, every stone set on the rock
    # the field finds under it (nothing hangs in the air).
    def ground(x, y):
        zs = np.arange(Hh + 6, 0.0, -0.25)
        P = np.stack([np.full_like(zs, x), np.full_like(zs, y), zs], axis=1)
        d = f.sample(P)
        hit = np.nonzero(d < 0)[0]
        return float(zs[hit[0]]) if len(hit) else None

    for (xa, xb, y0, y1, zf) in floors:
        for _ in range(int(rng.integers(2, 4))):
            cx = float(rng.uniform(xa + 2, xb - 2))
            cy = float(rng.uniform(y0 + 0.3, y1 - 0.3))
            for j in range(int(rng.integers(5, 9))):
                x = cx + float(rng.uniform(-2.2, 2.2))
                y = cy + float(rng.uniform(-0.8, 0.8))
                g = ground(x, y)
                if g is None or g < 1.0:
                    continue
                # Only where the rock lies flat (a bench, never a face).
                gx, gy = ground(x + 0.7, y), ground(x, y - 0.7)
                if gx is None or gy is None or max(abs(gx - g), abs(gy - g)) > 0.45:
                    continue
                sz = float(rng.uniform(0.35, 1.1)) * (1.5 if j == 0 else 1.0)
                crystal(p, (x, y, g + sz * 0.3), (sz * 1.3, sz, sz * 0.7),
                        p.vary(QUARRY_DARK if j % 2 else QUARRY, 0.06), n=12, boxy=0.45, jitter=0.18,
                        yaw=float(rng.uniform(0, TAU)), pitch=float(rng.uniform(-0.4, 0.4)), floor=g - 0.1)
    return p


def cut_stone(bpy, p, name, seed, c, size, yaw=0.0, drill=True, fresh=True, target=1400):
    """A quarried block (phase 2D: 2C's were dressed boxes and read as a
    blockout's cubes): split out of the bed on every face, so each face
    heaves a little and carries the pick's chatter, the corners knocked
    soft, the drill line it was split on still down one face as half-pipes,
    that face fresh and paler. c its centre, size its (x, y, z), turned by
    yaw about +Z; the drilled face toward its local -Y."""
    rng = np.random.default_rng(seed)
    c = np.asarray(c, dtype=np.float64)
    hx, hy, hz = (s / 2 for s in size)
    R = gs.rot(rz=yaw)
    r = math.sqrt(hx * hx + hy * hy + hz * hz) + 0.6
    f = CliffSculpt(tuple(c - r), tuple(c + r), 0.07)
    f.put('q1', block(rng, tuple(c), size, cuts=8, chamfer=(0.9, 0.985), R=R), 0.0)

    def at(x, y, z):
        return tuple(c + R @ np.array((x, y, z)))

    if fresh and abs(yaw) < 1e-6:
        f.zone('q3', (c[0] - hx - 0.3, c[1] - hy - 0.3, c[2] - hz - 0.3), (c[0] + hx + 0.3, c[1] - hy + 0.35,
                                                                          c[2] + hz + 0.3))
    if drill:
        n = int((2 * hx - 0.5) / 0.48)
        for k in range(n):
            x = -hx + 0.35 + k * 0.48
            f.groove(Polyline([at(x, -hy - 0.03, -hz + 0.25), at(x, -hy - 0.03, hz - 0.2)], 0.02), 0.1, 0.06)
    n1 = Noise(seed)
    f.displace(lambda X, Y, Z: 0.1 * n1.fbm(X * 0.55, Y * 0.55, Z * 0.55, 2)
               + 0.035 * n1.ridged(X * 2.2, Y * 2.2, Z * 2.2, 2), band=0.45)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, CLIFF_COLOURS, CLIFF_KINDS, smooth=False)
    return p



# ------------------------------------------------------------------ the Slab
SLAB_COLOURS = {
    'shade': mix(QUARRY, (0.58, 0.56, 0.53), 0.55),   # the slab's dressed granite
    'border': (0.62, 0.6, 0.56),                        # its dressed border, a shade paler
    'split': QUARRY_PALE,
    'vein': (0.86, 0.56, 0.22),                         # the rune's light (RUNE_OCHRE)
}


def _slab_kinds():
    from shkit import DRESSED, PAINT
    return {'shade': DRESSED, 'border': DRESSED, 'split': RAW, 'vein': (PAINT, GLOW)}


def slab_half_sculpt(bpy, p, side, split, W, H, T, strokes, target=2600):
    """One half of the Slab sculpted (phase 2D: 2C's was a box with boxes on
    it and read as a white board): living granite, a raised dressed border
    round a sunken field the pick has dressed in short bands, the vein's
    hammer rune cut deep into both faces with its light in the groove, the
    split down the middle torn rough. side -1 the west half, +1 the east;
    `split` the split's (x, z) points bottom to top; `strokes` the rune's
    ((x0, z0), (x1, z1)) strokes, both halves sharing them."""
    seed = 1191 if side < 0 else 1193
    rng = np.random.default_rng(seed)
    hb = T / 2 + 0.16
    f = CliffSculpt((-W / 2 - 0.6, -hb - 0.6, -0.4), (W / 2 + 0.6, hb + 0.6, H + 0.6), 0.06)
    f.put('shade', RoundBox((0.0, 0.0, H / 2), (W / 2, hb, H / 2), 0.14), 0.0)
    # The sunken field inside the border, on both faces.
    for yf in (-1, 1):
        f.sub(RoundBox((0.0, yf * (hb + 0.02), H / 2), (W / 2 - 0.9, 0.18, H / 2 - 0.9), 0.08), 0.04)
    # The rune: deep strokes, the light laid in their floor.
    for yf in (-1, 1):
        y = yf * (T / 2 - 0.02)
        for (x0, z0), (x1, z1) in strokes:
            f.groove(Polyline([(x0, y, z0), (x1, y, z1)], 0.02), 0.3, 0.13)
        for (x0, z0), (x1, z1) in strokes:
            f.put('vein', Polyline([(x0, y - yf * 0.16, z0), (x1, y - yf * 0.16, z1)], 0.075), 0.0)
    # The pick's dressing over the field: short bands of strokes, each its
    # own way, never a ruled grid.
    for yf in (-1, 1):
        y = yf * (T / 2 - 0.01)
        for _ in range(9):
            cx = rng.uniform(-W / 2 + 1.6, W / 2 - 1.6)
            cz = rng.uniform(1.6, H - 1.6)
            a = rng.choice([0.0, 0.5, -0.5, 1.2])
            for kk in range(int(rng.integers(4, 7))):
                ox = math.cos(a + math.pi / 2) * kk * 0.2
                oz = math.sin(a + math.pi / 2) * kk * 0.2
                L = rng.uniform(0.5, 0.9)
                f.groove(Polyline([(cx + ox, y, cz + oz), (cx + ox + math.cos(a) * L, y, cz + oz + math.sin(a) * L)],
                                  0.01), 0.035, 0.03)
    # The paler dressed border (a zone over the field's frame).
    for yf in (-1, 1):
        for (lo, hi) in (((-W, -hb - 1, -1), (-W / 2 + 0.95, hb + 1, H + 1)),
                         ((W / 2 - 0.95, -hb - 1, -1), (W, hb + 1, H + 1)),
                         ((-W, -hb - 1, -1), (W, hb + 1, 0.95)),
                         ((-W, -hb - 1, H - 0.95), (W, hb + 1, H + 1))):
            f.zone('border', lo, hi)
    # The split: this half keeps its own side of the torn line.
    zs = np.array([q[1] for q in split])
    xs = np.array([q[0] for q in split])
    X = f.axes[0][:, None, None]
    Z = f.axes[2][None, None, :]
    sx = np.interp(Z, zs, xs)
    f.d = np.maximum(f.d, (side * (sx - X)).astype(np.float32) * 0.9)
    n1 = Noise(seed)

    # The torn faces rough, the dressed faces barely weathered.
    def fn(Xp, Yp, Zp):
        s = np.interp(Zp, zs, xs)
        torn = np.clip(1.0 - np.abs(Xp - s) / 0.6, 0.0, 1.0)
        return 0.02 * n1.fbm(Xp * 1.4, Yp * 1.4, Zp * 1.4, 2) + torn * 0.12 * n1.ridged(Xp * 2.4, Yp * 2.4, Zp * 2.4, 2)

    f.displace(fn, band=0.3)
    f.cut_below(0.0)
    _bound(f, 0, -W / 2, W / 2)
    verts, faces = gs.mesh_sculpt(f, bpy, 'SlabHalf' + ('L' if side < 0 else 'R'), target)
    add_sculpt(p, f, verts, faces, SLAB_COLOURS, _slab_kinds(), smooth=False)
    return p


def slab_frame_sculpt(bpy, p, y, target=4800):
    """The Slab's frame sculpted (phase 2D): two monoliths and a lintel of
    the same dressed granite as the slab, their arrises chamfered and worn,
    a band and a cap cut round each jamb, a cornice over the lintel; the
    tool glyphs, the lintel's rune and the rock at the jambs' feet stay the
    piece's own (hammer_pieces.slab_frame)."""
    rng = np.random.default_rng(1197)
    f = CliffSculpt((-13.5, y - 3.0, -21.0), (13.5, y + 3.0, 19.6), 0.1)
    for s in (-1, 1):
        x = s * 9.7
        f.put('shade', block(rng, (x, y, -3.0), (2.8, 3.2, 34.0), cuts=4, chamfer=(0.96, 0.995)), 0.0)
        f.put('border', RoundBox((x, y, 13.6), (1.7, 1.9, 0.4), 0.08), 0.06)
        for zz in (2.0, 7.0):
            f.put('border', RoundBox((x, y, zz), (1.55, 1.75, 0.25), 0.06), 0.04)
    f.put('border', RoundBox((0.0, y, 15.4), (11.8, 1.8, 1.4), 0.12), 0.08)
    f.put('shade', RoundBox((0.0, y, 17.2), (12.5, 2.1, 0.4), 0.08), 0.05)
    f.put('border', block(rng, (0.0, y + 0.3, 18.0), (21.0, 3.2, 0.9), cuts=4, chamfer=(0.94, 0.99)), 0.05)
    n1 = Noise(1197)
    f.displace(lambda X, Y, Z: 0.035 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 2)
               + 0.03 * n1.ridged(X * 2.0, Y * 2.0, Z * 0.6, 2), band=0.3)
    verts, faces = gs.mesh_sculpt(f, bpy, 'SlabFrame', target)
    add_sculpt(p, f, verts, faces, SLAB_COLOURS, _slab_kinds(), smooth=False)
    return p
