"""The Hammer vein's SCULPTED pieces (build_smith_heart_hammer_kit.py): the
three colossi the Smith left half-carved in his quarry, and the rough
statues on the Gallery's rims.

Each is a signed-distance field (the Gravewyrm Sanctum's sculpt primitives,
gravewyrm_sculpt.py and jaguar_head_sculpt.py) meshed once through OpenVDB.
The Smith's likeness is carved MONUMENTAL, the way a giant cuts stone: big
dressed planes, squared limbs, a square braided beard banded in bronze, a
heavy brow over deep sockets, a topknot bound in a bronze ring, a leather
apron gone to stone, bronze bracers and belt. Down to a line he is finished;
below and behind it he is still the raw block he is being cut from: benches,
drill lines, pick marks, a seam of the Hammer's ochre light. The finished
stone is the DRESSED kind, the block the RAW kind (shkit.SPiece weathers
both).

The three colossi (game yards, origin at the base centre of the block, the
figure facing -Y, toward the pit; S is the figure's scale, a man is 1.9 S):
  ColossusVigil     kneels on both knees, his hammer planted head-down before
                    his knees, both hands stacked on its pommel, his head bowed
                    over the pit (a guardian at his post)
  ColossusWaking    head, shoulders and arms out of a wall of uncut rock, his
                    hands flat on its lip as if pushing himself free, looking
                    down into the pit
  ColossusBearer    kneels on one knee, the hammer across his right shoulder,
                    his left forearm on his raised knee, his head up, looking
                    out over the pit

Deterministic: every noise is seeded, nothing reads the clock.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Ellipsoid, Planes, Polyline, RoundBox, RoundCone, Sculpt, block, rot
from gwkit import add_sculpt
from jaguar_head_sculpt import Noise, Torus
from shkit import (
    BRONZE, DRESSED, DRESSED_SHADE, DRESSED_STONE, GLOW, GRANITE_DARK, METAL, QUARRY, QUARRY_DARK, QUARRY_PALE, RAW,
    VEIN_DIM,
)

UP = np.array((0.0, 0.0, 1.0))
TAU = 2 * math.pi
TAU3 = TAU / 3


def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def frame(z_axis, x_hint=(1.0, 0.0, 0.0)):
    """A rotation (columns: local x, y, z in world) with local z along
    `z_axis` and local x as near `x_hint` as it can be."""
    z = _n(z_axis)
    x = np.asarray(x_hint, dtype=np.float64) - z * (np.asarray(x_hint) @ z)
    if np.linalg.norm(x) < 1e-4:
        x = np.array((0.0, 1.0, 0.0)) - z * z[1]
    x = _n(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)


def bone(f, label, a, b, w, d, k, round_=None, x_hint=(1.0, 0.0, 0.0), taper=None):
    """A squared limb from a to b: a rounded box w across (along x_hint) and
    d deep. `taper` (0..1) narrows its far end by stacking a second box."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    L = float(np.linalg.norm(b - a))
    R = frame(b - a, x_hint)
    r = round_ if round_ is not None else min(w, d) * 0.3
    if taper:
        m = (a + b) / 2
        f.put(label, RoundBox((a + m) / 2, (w / 2, d / 2, L / 4 + r), r, R), k)
        f.put(label, RoundBox((m + b) / 2, (w / 2 * taper, d / 2 * taper, L / 4 + r * taper), r * taper, R), k)
        return
    f.put(label, RoundBox((a + b) / 2, (w / 2, d / 2, L / 2), r, R), k)


# The labels a colossus is painted by (sRGB) and their face kinds. The
# figure's labels stay one stone (the blends between them never read as
# blotches); only the bronze, the hammer and the raw block differ.
COLOSSUS_COLOURS = {
    'skin': DRESSED_STONE,
    'beard': (0.66, 0.63, 0.58),
    'hair': (0.64, 0.61, 0.57),
    'apron': (0.6, 0.57, 0.53),
    'bronze': BRONZE,
    'hammer': GRANITE_DARK,
    'haft': (0.47, 0.46, 0.45),
    'raw': QUARRY,
    'rawd': QUARRY_DARK,
    'cut': QUARRY_PALE,
    'vein': VEIN_DIM,
}
COLOSSUS_KINDS = {
    'skin': DRESSED, 'beard': DRESSED, 'hair': DRESSED, 'apron': DRESSED, 'bronze': METAL, 'hammer': DRESSED,
    'haft': DRESSED, 'raw': RAW, 'rawd': RAW, 'cut': RAW, 'vein': (RAW, GLOW),
}


def plait(f, label, a, b, side, w0, w1, turns=2.0, phase=0.0):
    """A three-strand plait from a to b: each strand swings across the
    braid (along `side`) and in and out of it at twice the rate, a third of
    a turn behind the last, so the three cross over and under one another
    and the surface reads as the plait's slanting lobes. w0 the braid's half
    width at a, w1 at b."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    d = _n(b - a)
    u = np.asarray(side, dtype=np.float64)
    u = _n(u - d * float(u @ d))
    v = np.cross(d, u)
    n = max(8, int(turns * 14))
    for k in range(3):
        ph = phase + k * TAU3
        pts, rad = [], []
        for i in range(n + 1):
            t = i / n
            th = TAU * turns * t + ph
            w = w0 + (w1 - w0) * t
            pts.append(a + (b - a) * t + u * (w * 0.5 * math.sin(th)) + v * (w * 0.28 * math.sin(2 * th)))
            rad.append(w * 0.5)
        f.put(label, Polyline(pts, rad), 0.0015 * w0 / 0.04)


# ------------------------------------------------------------------ the figure
class Smith:
    """The Smith's likeness from a few joints (yards). The body frame: the
    figure faces `facing` (unit, horizontal), `right` is its right hand's
    side. Every measure is a fraction of S (a man is 1.9 S tall)."""

    def __init__(self, f, S, facing=(0.0, -1.0, 0.0)):
        self.f = f
        self.fh = None
        self.S = S
        self.fw = _n(facing)
        self.right = _n(np.cross(UP, self.fw))   # facing -Y: right is -X
        self.k = 0.035 * S
        # The braids' lengths (the middle one, the corners'), fractions of S.
        self.braid = (0.3, 0.21)

    def P(self, x, y, z):
        """A point in the body frame (x to his right, y forward, z up), S units."""
        return (self.right * x + self.fw * y + UP * z) * self.S

    def torso(self, pelvis, chest, lean_fw=0.0):
        S, f, k = self.S, self.f, self.k
        pelvis, chest = np.asarray(pelvis), np.asarray(chest)
        spine = _n(chest - pelvis)
        Rt = np.stack([self.right, np.cross(spine, self.right), spine], axis=1)
        # The hips and the barrel of the chest, squared.
        f.put('skin', RoundBox(pelvis, np.array((0.25, 0.17, 0.13)) * S, 0.06 * S, Rt), k)
        f.put('skin', RoundBox((pelvis + chest) / 2 + self.fw * 0.03 * S, np.array((0.23, 0.17, 0.16)) * S,
                               0.07 * S, Rt), k * 1.4)
        f.put('skin', RoundBox(chest, np.array((0.31, 0.2, 0.2)) * S, 0.08 * S, Rt), k * 1.2)
        # The pectoral slabs, the shoulder mass, the trapezius rising to the neck.
        for s in (-1, 1):
            f.put('skin', RoundBox(chest + self.fw * 0.13 * S + self.right * s * 0.13 * S + spine * 0.04 * S,
                                   np.array((0.13, 0.06, 0.1)) * S, 0.04 * S, Rt), k * 0.6)
            f.put('skin', Ellipsoid(chest + self.right * s * 0.17 * S + spine * 0.15 * S - self.fw * 0.04 * S,
                                    np.array((0.14, 0.12, 0.07)) * S, Rt), k)
        # The gut's carved plates.
        for i in range(3):
            for s in (-1, 1):
                f.put('skin', RoundBox(pelvis + spine * (0.1 + i * 0.075) * S + self.fw * 0.17 * S
                                       + self.right * s * 0.05 * S, np.array((0.045, 0.03, 0.03)) * S, 0.02 * S, Rt),
                      k * 0.3)
        neck = chest + spine * 0.2 * S
        f.put('skin', RoundCone(chest + spine * 0.1 * S, neck, 0.11 * S, 0.095 * S), k)
        # The belt and its square bronze buckle (the hammer mark cut in it).
        belt = pelvis + spine * 0.1 * S
        f.put('bronze', RoundBox(belt, np.array((0.27, 0.19, 0.03)) * S, 0.03 * S, Rt), k * 0.25)
        buckle = belt + self.fw * 0.19 * S
        f.put('bronze', RoundBox(buckle, np.array((0.07, 0.025, 0.06)) * S, 0.01 * S, Rt), 0.004 * S)
        f.sub(RoundBox(buckle + self.fw * 0.025 * S + spine * 0.015 * S, np.array((0.04, 0.01, 0.008)) * S, 0.002 * S,
                       Rt), 0.002 * S)
        f.sub(RoundBox(buckle + self.fw * 0.025 * S - spine * 0.01 * S, np.array((0.008, 0.01, 0.025)) * S, 0.002 * S,
                       Rt), 0.002 * S)
        # The apron: a stiff stone sheet from the belt over the thighs.
        f.put('apron', RoundBox(belt + self.fw * 0.17 * S - spine * 0.2 * S, np.array((0.2, 0.025, 0.2)) * S,
                                0.015 * S, Rt), k * 0.4)
        self.chest, self.spine, self.neck, self.Rt = chest, spine, neck, Rt
        return neck

    def head_field(self, look, voxel, scale=1.35):
        """Give the head its own finer field (a face must read up close): the
        skull, the face, the hair and the beard down to the chest. Call after
        torso()."""
        S0 = self.S
        look = _n(look)
        c = self.neck + self.spine * 0.15 * S0 + look * 0.05 * S0
        low = self.chest + self.fw * 0.25 * S0 - self.spine * 0.12 * S0
        r = 0.33 * S0 * scale / 1.35
        tail = low - UP * (self.braid[0] + 0.1) * S0 + self.fw * 0.12 * S0
        lo = np.minimum(np.minimum(c - r, low - 0.16 * S0), tail - 0.06 * S0)
        hi = np.maximum(np.maximum(c + r, low + 0.16 * S0), tail + 0.06 * S0)
        self.fh = Sculpt(tuple(lo), tuple(hi), voxel)
        return self.fh

    def head(self, look, scale=1.35):
        """The head over the neck, looking along `look` (phase 2C, carved as
        a master mason would): a squared skull, two heavy brow masses knitted
        into a frown over deep sockets, heavy upper lids and drilled pupils
        (the statue's gaze), crow's feet, angular cheekbones, a broad nose
        with its wings and nostrils, the folds from the nose to the
        moustache, a lower lip under two sweeping hanks of moustache, a full
        beard combed in strands and cut in five plaited braids banded in
        bronze, the hair swept back from a furrowed brow to a topknot in a
        bronze ring. The head is meshed apart at a finer grain when the
        figure has a head field (`self.fh`)."""
        S0, k = self.S, self.k
        f = self.fh if self.fh is not None else self.f
        S = S0 * scale
        look = _n(look)
        left = _n(np.cross(UP, look))
        hup = _n(np.cross(look, left))
        # Rh columns: local x across the face, local y back toward the nape
        # (the face toward -y), local z up the crown.
        Rh = np.stack([left, -look, hup], axis=1)

        def H(x, y, z):
            """A point in the head's frame: x across, y FORWARD, z up (S units)."""
            return c + (left * x + look * y + hup * z) * S

        def groove(pts, depth, width):
            f.groove(Polyline([H(*q) for q in pts], 0.0015 * S), depth * S, width * S)

        c = self.neck + self.spine * 0.15 * S0 + look * 0.05 * S0
        # The skull: squared, the face its flat front at y 0.1; the temples
        # pressed in a little.
        f.put('skin', RoundBox(c, np.array((0.09, 0.1, 0.118)) * S, 0.05 * S, Rh), k * 0.5)
        for s in (-1, 1):
            f.sub(Ellipsoid(H(s * 0.1, 0.06, 0.03), np.array((0.016, 0.03, 0.03)) * S, Rh), 0.01 * S)
        # The jaw, broad, under the beard.
        f.put('skin', RoundBox(H(0, 0.01, -0.08), np.array((0.088, 0.075, 0.05)) * S, 0.03 * S, Rh), k * 0.4)
        # The brow: two heavy masses knitted down toward the nose (a stern
        # frown), the furrow between them, two lines across the forehead.
        for s in (-1, 1):
            f.put('skin', RoundCone(H(s * 0.014, 0.11, 0.024), H(s * 0.08, 0.094, 0.045), 0.019 * S, 0.011 * S),
                  k * 0.4)
            f.put('skin', Ellipsoid(H(s * 0.045, 0.1, 0.045), np.array((0.035, 0.018, 0.016)) * S, Rh), k * 0.4)
        groove([(0, 0.122, 0.06), (0, 0.124, 0.03)], 0.007, 0.004)
        for s in (-1, 1):
            groove([(s * 0.008, 0.121, 0.055), (s * 0.016, 0.121, 0.032)], 0.004, 0.003)
        for z in (0.072, 0.092):
            groove([(-0.062, 0.104, z - 0.004), (0, 0.11, z + 0.003), (0.062, 0.104, z - 0.004)], 0.005, 0.0035)
        for s in (-1, 1):
            # Deep sockets under the brow, the eyeball a dome in each, a heavy
            # upper lid over it, the pupil drilled (the gaze reads from afar).
            f.sub(RoundBox(H(s * 0.042, 0.114, 0.002), np.array((0.029, 0.036, 0.017)) * S, 0.008 * S, Rh),
                  0.004 * S)
            f.put('skin', Ellipsoid(H(s * 0.042, 0.083, -0.001), np.array((0.016, 0.013, 0.011)) * S, Rh), 0.002 * S)
            f.put('skin', Ellipsoid(H(s * 0.042, 0.089, 0.008), np.array((0.02, 0.011, 0.0065)) * S, Rh),
                  0.003 * S)
            f.sub(Ellipsoid(H(s * 0.04, 0.097, -0.002), np.array((0.0055, 0.006, 0.0055)) * S, Rh), 0.001 * S)
            # Crow's feet.
            for j in (-1, 0, 1):
                groove([(s * 0.064, 0.088, j * 0.007), (s * 0.082, 0.078, j * 0.013)], 0.003, 0.0025)
            # The cheekbones, angular, a hollow under each.
            f.put('skin', RoundBox(H(s * 0.06, 0.09, -0.03), np.array((0.026, 0.02, 0.016)) * S, 0.01 * S, Rh),
                  k * 0.15)
            f.sub(Ellipsoid(H(s * 0.066, 0.1, -0.058), np.array((0.016, 0.01, 0.014)) * S, Rh), 0.006 * S)
            # The ears.
            f.put('skin', Ellipsoid(H(s * 0.098, -0.005, -0.005), np.array((0.014, 0.026, 0.038)) * S, Rh), k * 0.1)
            f.sub(Ellipsoid(H(s * 0.107, 0.0, -0.002), np.array((0.006, 0.014, 0.022)) * S, Rh), 0.002 * S)
        # The nose: a broad bridge from the brow to a heavy tip, its wings,
        # the nostrils cut under.
        f.put('skin', RoundCone(H(0, 0.114, 0.018), H(0, 0.142, -0.034), 0.014 * S, 0.021 * S), k * 0.08)
        for s in (-1, 1):
            f.put('skin', Ellipsoid(H(s * 0.021, 0.125, -0.042), np.array((0.016, 0.015, 0.012)) * S, Rh), k * 0.08)
            f.sub(Ellipsoid(H(s * 0.012, 0.133, -0.052), np.array((0.006, 0.006, 0.004)) * S, Rh), 0.002 * S)
            # The fold from the nose's wing down to the moustache.
            groove([(s * 0.034, 0.12, -0.036), (s * 0.05, 0.112, -0.062), (s * 0.058, 0.104, -0.08)], 0.006, 0.004)
        # The lower lip, under the moustache, the mouth's line above it.
        f.put('skin', Ellipsoid(H(0, 0.118, -0.086), np.array((0.026, 0.011, 0.008)) * S, Rh), 0.003 * S)
        groove([(-0.028, 0.124, -0.079), (0, 0.127, -0.08), (0.028, 0.124, -0.079)], 0.004, 0.003)
        # The moustache: two heavy hanks sweeping from under the nose round
        # the mouth and down into the beard, combed in strands.
        for s in (-1, 1):
            pts = [H(s * 0.006, 0.134, -0.058), H(s * 0.036, 0.13, -0.066), H(s * 0.06, 0.118, -0.092),
                   H(s * 0.068, 0.106, -0.13), H(s * 0.064, 0.1, -0.17)]
            f.put('beard', Polyline(pts, [0.012 * S, 0.016 * S, 0.016 * S, 0.012 * S, 0.008 * S]), k * 0.1)
            for j in (-1, 1):
                groove([(s * 0.02, 0.146, -0.062 + j * 0.005), (s * 0.05, 0.136, -0.08 + j * 0.006),
                        (s * 0.068, 0.12, -0.12 + j * 0.006)], 0.003, 0.0025)
        # The beard: a core over the jaw down onto the chest, and over it the
        # carved locks, two layers of them, each a waving tapered lock
        # standing out on its own (the shadow between locks is what reads).
        top = H(0, 0.065, -0.075)
        low = self.chest + self.fw * 0.25 * S0 - self.spine * 0.12 * S0
        L = float(np.linalg.norm(top - low))
        down = _n(low - top)
        f.put('beard', RoundBox((top + low) / 2, (0.085 * S, 0.045 * S, L / 2), 0.04 * S, frame(top - low, left)),
              k * 0.35)
        f.put('beard', RoundBox(H(0, 0.05, -0.065), np.array((0.1, 0.06, 0.05)) * S, 0.035 * S, Rh), k * 0.3)
        for layer, (fwd, xs, r0) in enumerate(((0.035, np.linspace(-0.088, 0.088, 7), 0.024),
                                               (0.062, np.linspace(-0.06, 0.06, 5), 0.022))):
            for i, x in enumerate(xs):
                a = H(x * (1.0 if layer == 0 else 0.9), 0.1 + layer * 0.016 - 0.03 * abs(x) / 0.09,
                      -0.072 - layer * 0.022)
                b = low + left * x * S * 0.75 + self.fw * fwd * S0 - self.spine * 0.02 * S0 * (i % 2)
                wave = left * (0.012 * S if (i + layer) % 2 else -0.012 * S)
                mid = (a + b) / 2 + look * 0.03 * S + wave
                tip = b + down * 0.035 * S - wave * 0.6
                f.put('beard', Polyline([a, mid, b, tip], [r0 * 0.85 * S, r0 * S, r0 * 0.8 * S, 0.006 * S]),
                      k * 0.05)
                # The strand cut down the middle of the lock.
                f.groove(Polyline([a + look * r0 * 0.8 * S, mid + look * r0 * 0.9 * S, b + look * r0 * 0.7 * S],
                                  0.0015 * S), 0.006 * S, 0.004 * S)
        # The braids (phase 2D): the beard's locks gather into three true
        # plaits, each three strands crossing over and under one another
        # (the diagonal lobes of a plait, never a string of beads), a long
        # one down the middle and two shorter at the corners, bound at the
        # top and near the end in bronze and ending in a combed tassel. They
        # hang (stone hair falls, whatever the lean) and are thick enough to
        # read across the pit.
        hang = _n(-UP * 0.94 + self.fw * 0.18 + self.spine * -0.12)
        for s, length, w0 in ((0, self.braid[0], 0.042), (-1, self.braid[1], 0.034), (1, self.braid[1], 0.034)):
            a = low + left * s * 0.085 * S + self.fw * 0.035 * S0 + UP * 0.03 * S0
            b = a + hang * length * S0
            # The gather: the locks above narrow into the braid's head.
            f.put('beard', RoundCone(a + UP * 0.07 * S0 - self.fw * 0.01 * S0, a, w0 * 1.25 * S, w0 * 0.95 * S),
                  0.01 * S)
            plait(f, 'beard', a, b, left, w0 * S, w0 * 0.62 * S, turns=2.2 if s == 0 else 1.7, phase=0.7 * s)
            # The bronze band: one short sleeve hugging the plait over its
            # end (more than one, and the plait reads as a string of beads).
            q = a + (b - a) * 0.84
            r = w0 * S * 0.55
            f.put('bronze', RoundCone(q - hang * 0.01 * S, q + hang * 0.01 * S, r, r * 0.96), 0.003 * S)
            # The tassel: the strands loosed under the last band into a
            # combed brush, its locks fanning a little, cut blunt.
            w = w0 * 0.62 * S
            for j in range(5):
                e = (j - 2) / 2.0
                q0 = b + left * e * w * 0.45 + self.fw * (0.25 - abs(e) * 0.3) * w
                q1 = b + hang * (0.07 - 0.012 * abs(e)) * S0 + left * e * w * 0.95 + self.fw * (0.3 - abs(e) * 0.5) * w
                f.put('beard', RoundCone(q0, q1, w * 0.42, w * 0.22), 0.05 * w)
        # The hair: swept back from the brow over the crown (it never covers
        # the face), combed in strands, a topknot bound in bronze.
        f.put('hair', RoundBox(H(0, -0.025, 0.06), np.array((0.098, 0.085, 0.075)) * S, 0.05 * S, Rh), k * 0.25)
        knot = H(0, -0.06, 0.16)
        f.put('hair', RoundCone(H(0, -0.03, 0.1), knot, 0.055 * S, 0.042 * S), k * 0.2)
        f.put('hair', Ellipsoid(knot + (hup * 0.03 - look * 0.02) * S, np.array((0.048, 0.048, 0.04)) * S, Rh), k * 0.2)
        f.put('bronze', Torus(knot, 0.048 * S, 0.012 * S, hup - look * 0.4), 0.004 * S)
        for i in range(7):
            x = -0.072 + i * 0.024
            g0 = H(x, 0.062, 0.1)
            g1 = H(x * 0.45, -0.07, 0.145)
            f.groove(Polyline([g0, (g0 + g1) / 2 + hup * 0.03 * S, g1], 0.0025 * S), 0.009 * S, 0.005 * S)
        self.headc = c
        return c

    def hand(self, wrist, along, palm, curl=1.0, spread=0.0, label='skin'):
        """A hand from the wrist: `along` the way the fingers point when
        straight, `palm` the palm's outward normal. curl 1 a closed grip
        round a haft, 0 flat and splayed on the ground. Four fingers in three
        joints, the knuckles standing proud, the thumb opposed."""
        S, k = self.S, self.k
        f = self.f
        u = _n(along)
        n = _n(palm)
        side = _n(np.cross(n, u))
        w = np.asarray(wrist, dtype=np.float64)
        R = np.stack([side, u, n], axis=1)
        # The palm and the back of the hand.
        pc = w + u * 0.055 * S
        f.put(label, RoundBox(pc, np.array((0.054, 0.05, 0.026)) * S, 0.02 * S, R), k * 0.25)
        lens = (0.032, 0.024, 0.019)
        for j, x in enumerate((-0.036, -0.012, 0.012, 0.036)):
            base = w + u * 0.1 * S + side * x * S
            # The knuckle.
            f.put(label, Ellipsoid(base - n * 0.008 * S, np.array((0.012, 0.012, 0.011)) * S, R), 0.004 * S)
            d = _n(u + side * spread * (j - 1.5) * 0.18)
            p0 = base
            ang = 0.0
            scale = 1.0 if j in (1, 2) else 0.9
            for seg, L in enumerate(lens):
                ang += curl * (0.95 if seg == 0 else 1.15)
                dd = _n(d * math.cos(ang) + n * math.sin(ang))
                p1 = p0 + dd * L * S * scale
                r = 0.0155 * S * (1 - seg * 0.12)
                f.put(label, RoundCone(p0, p1, r, r * 0.9), 0.003 * S)
                p0 = p1
        # The thumb: from the palm's side, opposed.
        t0 = w + u * 0.035 * S + side * 0.05 * S
        t1 = t0 + _n(u * 0.6 + side * 0.6 + n * 0.4 * curl) * 0.035 * S
        t2 = t1 + _n(u * 0.9 - side * 0.5 * curl + n * 0.5 * curl) * 0.03 * S
        f.put(label, RoundCone(t0, t1, 0.018 * S, 0.016 * S), 0.004 * S)
        f.put(label, RoundCone(t1, t2, 0.016 * S, 0.013 * S), 0.003 * S)

    def arm(self, side, shoulder, elbow, hand, fist_dir=None, palm=None, curl=1.0, spread=0.0):
        """A squared arm: the deltoid, the upper arm, the forearm in a bronze
        bracer, the hand (fingers and thumb when `palm` is given, the rough
        fist of the roughing-out stage otherwise)."""
        S, f, k = self.S, self.f, self.k
        sh, el, ha = (np.asarray(v, dtype=np.float64) for v in (shoulder, elbow, hand))
        f.put('skin', Ellipsoid(sh, np.array((0.12, 0.12, 0.1)) * S), k)
        bone(f, 'skin', sh, el, 0.15 * S, 0.15 * S, k, round_=0.06 * S, x_hint=self.fw)
        bone(f, 'skin', el, ha, 0.13 * S, 0.12 * S, k * 0.8, round_=0.05 * S, x_hint=self.fw, taper=0.86)
        for t in (0.45, 0.62, 0.79):
            q = el + (ha - el) * t
            d = _n(ha - el)
            bone(f, 'bronze', q - d * 0.035 * S, q + d * 0.035 * S, 0.142 * S * (1.02 - t * 0.12),
                 0.132 * S * (1.02 - t * 0.12), 0.002 * S, round_=0.04 * S, x_hint=self.fw)
        fd = _n(fist_dir if fist_dir is not None else ha - el)
        if palm is not None:
            self.hand(ha - fd * 0.015 * S, fd, palm, curl=curl, spread=spread)
            return
        f.put('skin', RoundBox(ha + fd * 0.06 * S, np.array((0.07, 0.06, 0.075)) * S, 0.03 * S, frame(fd, self.fw)),
              k * 0.4)

    def leg(self, hip, knee, foot, toe_dir=None):
        S, f, k = self.S, self.f, self.k
        hp, kn, ft = (np.asarray(v, dtype=np.float64) for v in (hip, knee, foot))
        bone(f, 'skin', hp, kn, 0.19 * S, 0.19 * S, k, round_=0.07 * S, x_hint=self.right)
        f.put('skin', Ellipsoid(kn, np.array((0.1, 0.1, 0.09)) * S), k * 0.5)
        bone(f, 'skin', kn, ft, 0.14 * S, 0.14 * S, k, round_=0.055 * S, x_hint=self.right)
        td = _n(toe_dir if toe_dir is not None else self.fw)
        f.put('apron', RoundBox(ft + td * 0.08 * S - UP * 0.02 * S, np.array((0.07, 0.13, 0.05)) * S, 0.03 * S,
                                frame(td, self.right)), k * 0.4)


def raw_block(f, rng, c, size, k=0.6, cuts=4, R=None, label='raw', top_tilt=0.08, chamfer=(0.86, 0.97)):
    """A quarried block: flat split faces, a few knocked-off corners, sharp."""
    prim = block(rng, c, size, cuts=cuts, chamfer=chamfer, R=R, top_tilt=top_tilt)
    f.put(label, prim, k)
    return prim


class _Near:
    """The union of a few prims' distances (where the rock is raw)."""

    def __init__(self, prims):
        self.prims = prims

    def dist(self, X, Y, Z):
        out = None
        for p in self.prims:
            d = p.dist(X, Y, Z)
            out = d if out is None else np.minimum(out, d)
        return out


def quarry_noise(f, seed, S, near=(), grain=0.0038):
    """Weather the sculpt: a whisper of grain over the carving (it stays
    crisp); within reach of the raw prims a hewn, broken surface and pick
    chatter."""
    n1, n2, n3 = Noise(seed), Noise(seed + 3), Noise(seed + 9)
    region = _Near(list(near)) if near else None

    def fn(X, Y, Z):
        out = grain * S * n1.fbm(X * 2.4, Y * 2.4, Z * 2.4, 2)
        if region is not None:
            d = region.dist(X, Y, Z)
            w = np.clip(1.0 - np.maximum(d, 0.0) / (0.04 * S), 0.0, 1.0)
            rough = 0.022 * S * n2.fbm(X * 0.4, Y * 0.4, Z * 0.4, 3) \
                + 0.008 * S * n3.ridged(X * 1.4 + Z * 1.4, Y * 1.4 - Z * 1.4, X * 0.3, 2)
            out = out + w * rough
        return out
    f.displace(fn, band=0.06 * S)


def drill_grooves(f, pts_list, S, depth=0.014, width=0.007):
    """Vertical plug-and-feather channels down split faces."""
    for a, b in pts_list:
        f.groove(Polyline([a, b], 0.002 * S), depth * S, width * S)


def bench_lines(f, a, b, zs, S, depth=0.01, width=0.008):
    """Horizontal tool lines across a face from a to b at each height in zs
    (the bench cuts the quarrymen worked down in)."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    for z in zs:
        f.groove(Polyline([a + UP * z, b + UP * z], 0.002 * S), depth * S, width * S)


# The figure's own stone where a bronze part sits (the bronze is its own
# shell over it: bronze_shell).
STONE_COLOURS = dict(COLOSSUS_COLOURS, bronze=DRESSED_STONE)
STONE_KINDS = dict(COLOSSUS_KINDS, bronze=DRESSED)


def bronze_shell(bpy, p, f, name, target, subs=()):
    """Mesh the field's bronze parts (bands, bracers, belt, rings) as their
    own crisp shell, a hair proud of the stone they wrap (phase 2D): painted
    per face on the figure's decimated mesh, a thin band broke into a
    zigzag of bronze and stone triangles. `subs` are cavities the shell
    keeps too (a bowl's hollow)."""
    prims = [prim for (label, prim) in f.parts if label == 'bronze']
    if not prims:
        return
    vox = f.voxel * 0.7
    lo = np.min([q.lo for q in prims], axis=0) - vox * 4
    hi = np.max([q.hi for q in prims], axis=0) + vox * 4
    g = Sculpt(tuple(lo), tuple(hi), vox)
    for q in prims:
        g.put('bronze', q, vox * 0.5)
    for q in subs:
        g.sub(q, vox)
    # Proud of the stone by more than its weathering, so no stone grain
    # pokes through the bronze.
    g.d -= np.float32(vox * 2.6)
    verts, faces = gs.mesh_sculpt(g, bpy, name + 'Bronze', target)
    add_sculpt(p, g, verts, faces, {'bronze': BRONZE}, {'bronze': METAL})


def mesh_colossus(bpy, p, f, name, target, fh=None, head_target=7000, S=17.0, shell=1400):
    """Mesh the body (and the head's finer field apart, when given, with the
    same stone grain) into p, the bronze as its own shells."""
    head_shell = shell // 3 if fh is not None else 0
    body = target - (head_target if fh is not None else 0) - shell
    verts, faces = gs.mesh_sculpt(f, bpy, name, body)
    add_sculpt(p, f, verts, faces, STONE_COLOURS, STONE_KINDS)
    bronze_shell(bpy, p, f, name, shell - head_shell)
    if fh is not None:
        quarry_noise(fh, len(name), S, grain=0.0022)
        verts, faces = gs.mesh_sculpt(fh, bpy, name + 'Head', head_target)
        add_sculpt(p, fh, verts, faces, STONE_COLOURS, STONE_KINDS)
        bronze_shell(bpy, p, fh, name + 'Head', head_shell)


def claw_band(f, a, step, stroke, n, S, depth=0.007, width=0.0045):
    """A band of claw-chisel strokes: n parallel grooves, the first from a
    along `stroke`, each next one `step` further (the roughing-out stage's
    marks where the masons stopped)."""
    a, step, stroke = (np.asarray(v, dtype=np.float64) for v in (a, step, stroke))
    for i in range(n):
        q = a + step * i
        f.groove(Polyline([q, q + stroke], 0.0015 * S), depth * S, width * S)


def pointing(f, pts, S, r=0.009):
    """The pointing machine's drill holes: a grid of deep pocks the masons
    measured the figure into the block by."""
    for q in pts:
        f.sub(Ellipsoid(q, np.array((r, r, r)) * S), 0.002 * S)


def hammer(f, head_c, axis, haft_top, S, head_len=0.34, head_r=0.085):
    """The Smith's great hammer: an octagonal head along `axis` with flared
    faces and a bronze collar, a haft to `haft_top` banded in bronze, a
    ringed pommel."""
    head_c = np.asarray(head_c, dtype=np.float64)
    ax = _n(axis)
    R = frame(ax, UP if abs(ax[2]) < 0.9 else np.array((1.0, 0, 0)))
    oct_n = [tuple(R @ np.array((math.cos(a), math.sin(a), 0.0)))
             for a in [math.pi / 8 + i * math.pi / 4 for i in range(8)]]
    for s in (-1, 1):
        c = head_c + ax * s * head_len * 0.3 * S
        N = oct_n + [tuple(ax), tuple(-ax)]
        D = [head_r * S] * 8 + [head_len * 0.21 * S, head_len * 0.21 * S]
        f.put('hammer', Planes(c, N, D), 0.006 * S)
        f.put('hammer', Planes(head_c + ax * s * head_len * 0.47 * S, N, [head_r * 1.12 * S] * 8
                               + [head_len * 0.04 * S] * 2), 0.006 * S)
    f.put('bronze', Planes(head_c, oct_n + [tuple(ax), tuple(-ax)], [head_r * 1.08 * S] * 8
                           + [head_len * 0.09 * S] * 2), 0.004 * S)
    top = np.asarray(haft_top, dtype=np.float64)
    d = _n(top - head_c)
    f.put('haft', RoundCone(head_c + d * head_r * S, top, 0.034 * S, 0.03 * S), 0.006 * S)
    for t in (0.3, 0.6, 0.86):
        q = head_c + (top - head_c) * t
        f.put('bronze', RoundCone(q - d * 0.014 * S, q + d * 0.014 * S, 0.042 * S, 0.042 * S), 0.003 * S)
    f.put('bronze', Ellipsoid(top + d * 0.03 * S, np.array((0.05, 0.05, 0.05)) * S), 0.004 * S)
    f.put('bronze', Torus(top + d * 0.085 * S, 0.04 * S, 0.012 * S, np.cross(d, UP) + np.array((1e-3, 0, 0))),
          0.003 * S)


# ------------------------------------------------------------------ the colossi
def colossus_vigil(bpy, p, S=17.0, target=19400):
    """Kneels on both knees, the hammer planted head-down before his knees,
    both hands stacked on its pommel, the head bowed over the pit. The block
    still holds his shins, his knees and his back to the shoulder blades."""
    rng = np.random.default_rng(71)
    f = Sculpt((-0.84 * S, -0.72 * S, -0.06 * S), (0.84 * S, 0.8 * S, 1.62 * S), 0.009 * S)
    m = Smith(f, S)
    P = m.P
    pelvis = P(0, 0.02, 0.62)
    chest = P(0, 0.1, 0.98)
    m.torso(pelvis, chest)
    look = _n(m.fw * 0.93 - UP * 0.36)
    # His braids fall behind his stacked hands: shorter, so they end at them.
    m.braid = (0.22, 0.16)
    fh = m.head_field(look, 0.0048 * S)
    m.head(look)
    # The hammer planted before his knees, the haft rising to his hands.
    head_c = P(0, 0.5, 0.1)
    grip = P(0, 0.43, 0.78)
    hammer(f, head_c, m.right, grip + UP * 0.03 * S, S)
    for s in (1, -1):
        sh = P(s * 0.3, 0.06, 1.08)
        el = P(s * 0.3, 0.3, 0.86)
        ha = P(s * 0.08, 0.43, 0.8 + (0.07 if s > 0 else 0.0))
        # Both hands stacked over the pommel, fingers wrapped round it.
        m.arm(s, sh, el, ha, fist_dir=-m.right * s, palm=-UP + m.fw * 0.2, curl=1.05)
    for s in (1, -1):
        m.leg(P(s * 0.13, 0.02, 0.56), P(s * 0.15, 0.24, 0.1), P(s * 0.15, -0.28, 0.07), toe_dir=-m.fw)
    # The block: his shins and knees still in it, a mass behind him to his
    # shoulder blades (he is cut out of the terrace), benches stepping down
    # at the sides, a spall split off at his left.
    near = [
        raw_block(f, rng, P(0, 0.05, 0.08), np.array((1.05, 0.95, 0.2)) * S, k=0.01 * S, cuts=3, top_tilt=0.02),
        # The thighs roughed out of one block: the masons stopped at the belt.
        raw_block(f, rng, P(0, 0.12, 0.34), np.array((0.62, 0.44, 0.5)) * S, k=0.015 * S, cuts=8, top_tilt=0.12, chamfer=(0.8, 0.95)),
        raw_block(f, rng, P(0, -0.42, 0.55), np.array((1.3, 0.55, 1.1)) * S, k=0.01 * S),
        raw_block(f, rng, P(0.58, -0.05, 0.25), np.array((0.35, 0.8, 0.5)) * S, k=0.01 * S, label='rawd'),
        raw_block(f, rng, P(-0.6, -0.15, 0.32), np.array((0.3, 0.7, 0.64)) * S, k=0.01 * S),
    ]
    # Bench cuts and the drill lines along the block's front edge.
    drill_grooves(f, [(P(x, 0.5, 0.0), P(x, 0.5, 0.17)) for x in np.linspace(-0.46, 0.46, 13)], S)
    drill_grooves(f, [(P(0.42, 0.4 - y, 0.5), P(0.42, 0.4 - y, 0.18)) for y in np.linspace(0, 0.5, 6)], S)
    bench_lines(f, P(-0.75, -0.16, 0), P(-0.75, 0.2, 0), (0.18 * S, 0.36 * S, 0.54 * S), S)
    bench_lines(f, P(0.75, -0.4, 0), P(0.75, 0.3, 0), (0.12 * S, 0.3 * S), S)
    bench_lines(f, P(-0.6, -0.15, 0), P(0.6, -0.15, 0), (0.75 * S, 0.95 * S), S)
    # Where the masons stopped: claw strokes slanting across the roughed-out
    # thighs, the pointing holes still in the block either side.
    claw_band(f, P(-0.28, 0.345, 0.14), P(0.045, 0, 0), P(0.06, 0, 0.3), 12, S)
    pointing(f, [P(x, 0.53, z) for x in (-0.42, -0.3, 0.3, 0.42) for z in (0.06, 0.13)], S)
    pointing(f, [P(0.76, y, z) for y in (-0.2, -0.05, 0.1) for z in (0.25, 0.38)], S)
    # A seam of the Hammer's light through the block, under his knees.
    f.put('vein', Polyline([P(-0.5, 0.42, 0.05), P(-0.2, 0.5, 0.12), P(0.15, 0.5, 0.07), P(0.48, 0.38, 0.14)],
                           0.012 * S), 0.004 * S)
    quarry_noise(f, 71, S, near=near)
    mesh_colossus(bpy, p, f, 'ColossusVigil', target, fh=fh)
    return p


def colossus_waking(bpy, p, S=17.0, target=19000):
    """Half out of a wall of uncut rock: his hips still in it, his torso
    heaved forward out of it, both hands planted on the ground before him
    as if pushing himself free, his head bowed to the pit. Low and broad:
    from the pit floor the whole of him reads over the step below."""
    rng = np.random.default_rng(73)
    f = Sculpt((-0.98 * S, -0.75 * S, -0.06 * S), (0.98 * S, 0.9 * S, 1.5 * S), 0.009 * S)
    m = Smith(f, S)
    P = m.P
    m.torso(P(0, -0.22, 0.55), P(0, 0.16, 0.84))
    look = _n(m.fw * 0.72 - UP * 0.69)
    fh = m.head_field(look, 0.0048 * S)
    m.head(look)
    for s in (1, -1):
        # Both hands flat on the step, fingers splayed, heaving.
        m.arm(s, P(s * 0.32, 0.22, 0.94), P(s * 0.5, 0.42, 0.52), P(s * 0.42, 0.62, 0.115),
              fist_dir=m.fw + m.right * s * 0.25, palm=-UP, curl=0.18, spread=1.0)
    near = [
        # The wall he is heaving out of, past his shoulders at the sides.
        raw_block(f, rng, P(0, -0.5, 0.6), np.array((1.85, 0.6, 1.2)) * S, k=0.01 * S),
        raw_block(f, rng, P(0.74, -0.15, 0.55), np.array((0.4, 0.75, 1.1)) * S, k=0.012 * S, label='rawd'),
        raw_block(f, rng, P(-0.76, -0.2, 0.5), np.array((0.38, 0.7, 1.0)) * S, k=0.012 * S),
        # The floor he pushes on: a low bench the masons left.
        raw_block(f, rng, P(0, 0.45, 0.03), np.array((1.6, 0.8, 0.1)) * S, k=0.01 * S, cuts=3, top_tilt=0.02),
        # His hips and thighs still one with the rock.
        raw_block(f, rng, P(0, -0.12, 0.42), np.array((0.72, 0.5, 0.5)) * S, k=0.02 * S, cuts=8, top_tilt=0.15,
                  chamfer=(0.8, 0.95)),
    ]
    bench_lines(f, P(-0.85, -0.2, 0), P(0.85, -0.2, 0), (0.95 * S, 1.1 * S), S)
    drill_grooves(f, [(P(0.94, -0.15 + y, 0.1), P(0.94, -0.15 + y, 1.1)) for y in np.linspace(-0.3, 0.3, 4)], S)
    drill_grooves(f, [(P(-0.94, -0.2 + y, 0.1), P(-0.94, -0.2 + y, 0.95)) for y in np.linspace(-0.3, 0.3, 4)], S)
    f.put('vein', Polyline([P(-0.9, 0.2, 0.12), P(-0.5, 0.82, 0.1), P(-0.1, 0.84, 0.11), P(0.3, 0.84, 0.1),
                            P(0.7, 0.5, 0.12)], 0.013 * S), 0.004 * S)
    f.put('vein', Polyline([P(0.6, -0.22, 1.16), P(0.75, 0.2, 0.8), P(0.95, 0.1, 0.5)], 0.01 * S), 0.004 * S)
    # Claw strokes where the rock gives way to his hips; pointing holes in
    # the wall beside his shoulders.
    claw_band(f, P(-0.34, 0.12, 0.3), P(0.05, 0, 0), P(0.05, 0.02, 0.26), 14, S)
    pointing(f, [P(x, 0.1, z) for x in (-0.72, -0.62, 0.62, 0.72) for z in (0.8, 0.95, 1.1)], S)
    quarry_noise(f, 73, S, near=near)
    mesh_colossus(bpy, p, f, 'ColossusWaking', target, fh=fh)
    return p


def colossus_bearer(bpy, p, S=17.0, target=19400):
    """Kneels on one knee, the hammer across his right shoulder, his left
    forearm on his raised knee, his head up, looking out over the pit. His
    trailing leg and his back are still the block."""
    rng = np.random.default_rng(79)
    f = Sculpt((-0.86 * S, -0.8 * S, -0.06 * S), (0.86 * S, 0.82 * S, 1.66 * S), 0.009 * S)
    m = Smith(f, S)
    P = m.P
    m.torso(P(0, 0.0, 0.62), P(0, 0.05, 0.98))
    look = _n(m.fw * 0.97 - UP * 0.16 + m.right * -0.12)
    fh = m.head_field(look, 0.0048 * S)
    m.head(look)
    # His raised left knee, the trailing right knee on the ground.
    m.leg(P(-0.13, 0.02, 0.56), P(-0.17, 0.46, 0.56), P(-0.17, 0.5, 0.06))
    m.leg(P(0.13, 0.0, 0.56), P(0.16, 0.12, 0.08), P(0.16, -0.38, 0.06), toe_dir=-m.fw)
    # The left forearm across the raised knee, the right fist on the haft.
    m.arm(-1, P(-0.31, 0.0, 1.08), P(-0.24, 0.36, 0.66), P(-0.08, 0.58, 0.62), fist_dir=m.fw * 0.4 - UP * 0.9,
          palm=-m.fw + m.right * 0.3, curl=0.55, spread=0.4)
    m.arm(1, P(0.31, 0.0, 1.08), P(0.45, 0.26, 0.86), P(0.3, 0.26, 1.08), fist_dir=-m.right, palm=-m.fw,
          curl=1.05)
    hammer(f, P(0.34, -0.42, 1.34), m.right, P(0.28, 0.5, 0.94), S)
    near = [
        raw_block(f, rng, P(0, 0.0, 0.08), np.array((1.15, 1.2, 0.2)) * S, k=0.01 * S, cuts=3, top_tilt=0.02),
        raw_block(f, rng, P(0.1, -0.52, 0.48), np.array((1.3, 0.48, 0.96)) * S, k=0.012 * S),
        # The trailing leg roughed out, never freed.
        raw_block(f, rng, P(0.16, -0.16, 0.26), np.array((0.34, 0.66, 0.36)) * S, k=0.015 * S, cuts=8,
                  chamfer=(0.8, 0.95)),
        raw_block(f, rng, P(-0.66, -0.3, 0.3), np.array((0.34, 0.6, 0.6)) * S, k=0.01 * S, label='rawd'),
    ]
    bench_lines(f, P(-0.58, 0.6, 0), P(0.58, 0.6, 0), (0.1 * S,), S)
    bench_lines(f, P(-0.55, -0.28, 0), P(0.65, -0.28, 0), (0.62 * S, 0.8 * S), S)
    drill_grooves(f, [(P(x, 0.6, 0.0), P(x, 0.6, 0.18)) for x in np.linspace(-0.5, 0.5, 11)], S)
    f.put('vein', Polyline([P(-0.56, 0.2, 0.15), P(-0.3, 0.6, 0.1), P(0.2, 0.6, 0.14), P(0.55, 0.3, 0.12)],
                           0.012 * S), 0.004 * S)
    # Claw strokes over the trailing leg still in the block; pointing holes
    # in the block at his back.
    claw_band(f, P(0.02, 0.18, 0.12), P(0.04, 0, 0), P(0.05, 0, 0.26), 8, S)
    pointing(f, [P(x, -0.27, z) for x in (-0.5, -0.38, 0.4, 0.52) for z in (0.75, 0.88)], S)
    quarry_noise(f, 79, S, near=near)
    mesh_colossus(bpy, p, f, 'ColossusBearer', target, fh=fh)
    return p


# ------------------------------------------------------------------ the Gallery
def rough_statue(bpy, p, variant, S=6.6, target=6000):
    """The Smith's work left rough on the Gallery's rims (14 yd, collider
    r 3.2): A stands with his arms folded over his chest, roughed out to the
    waist, the rest still the block; B kneels, both hands on his knees, the
    block behind him. The carving is coarser than the colossi's (the
    roughing-out stage), the block wears its drill lines."""
    rng = np.random.default_rng(83 + ord(variant))
    f = Sculpt((-0.5 * S, -0.5 * S, -0.04 * S), (0.5 * S, 0.5 * S, 2.25 * S), 0.012 * S)
    m = Smith(f, S)
    m.k = 0.06 * S
    m.braid = (0.2, 0.14)
    P = m.P
    if variant == 'A':
        m.torso(P(0, 0.0, 1.06), P(0, 0.02, 1.42))
        m.head(_n(m.fw * 0.97 - UP * 0.2), scale=1.3)
        for s in (1, -1):
            m.arm(s, P(s * 0.3, 0.0, 1.52), P(s * 0.34, 0.18, 1.2), P(-s * 0.12, 0.2, 1.36), fist_dir=-m.right * s)
        near = [raw_block(f, rng, P(0, 0.0, 0.52), np.array((0.66, 0.6, 1.04)) * S, k=0.03 * S, cuts=6,
                          chamfer=(0.82, 0.95), top_tilt=0.2)]
        drill_grooves(f, [(P(x, 0.3, 0.05), P(x, 0.3, 0.9)) for x in np.linspace(-0.25, 0.25, 5)], S)
    else:
        m.torso(P(0, 0.0, 0.62), P(0, 0.06, 0.98))
        m.head(_n(m.fw * 0.95 - UP * 0.3), scale=1.3)
        for s in (1, -1):
            m.arm(s, P(s * 0.3, 0.04, 1.08), P(s * 0.34, 0.12, 0.76), P(s * 0.18, 0.3, 0.56), fist_dir=-UP)
            m.leg(P(s * 0.13, 0.02, 0.56), P(s * 0.15, 0.3, 0.42), P(s * 0.15, 0.32, 0.06))
        near = [raw_block(f, rng, P(0, -0.05, 0.22), np.array((0.68, 0.7, 0.44)) * S, k=0.03 * S, cuts=6,
                          chamfer=(0.82, 0.95)),
                raw_block(f, rng, P(0, -0.2, 0.75), np.array((0.6, 0.34, 0.7)) * S, k=0.03 * S, cuts=6)]
    quarry_noise(f, 83 + ord(variant), S, near=near, grain=0.006)
    verts, faces = gs.mesh_sculpt(f, bpy, 'RoughStatue' + variant, target)
    add_sculpt(p, f, verts, faces, STONE_COLOURS, STONE_KINDS)
    bronze_shell(bpy, p, f, 'RoughStatue' + variant, 900)
    return p


def lookout_statue(bpy, p, S=4.4, target=5000):
    """A kneeling Smith on a corbel at the Balcony's side (7.5 yd): his
    hands hold out a bronze bowl of the vein's coals over the drop, his head
    bowed toward the heart of the mountain."""
    rng = np.random.default_rng(89)
    f = Sculpt((-0.75 * S, -0.9 * S, -0.5 * S), (0.75 * S, 0.7 * S, 1.75 * S), 0.012 * S)
    m = Smith(f, S)
    m.braid = (0.18, 0.13)
    P = m.P
    m.torso(P(0, 0.0, 0.62), P(0, 0.08, 0.98))
    m.head(_n(m.fw * 0.9 - UP * 0.42))
    for s in (1, -1):
        m.arm(s, P(s * 0.3, 0.04, 1.08), P(s * 0.32, 0.32, 0.88), P(s * 0.16, 0.56, 0.86), fist_dir=-UP)
        m.leg(P(s * 0.13, 0.02, 0.56), P(s * 0.15, 0.24, 0.1), P(s * 0.15, -0.28, 0.07), toe_dir=-m.fw)
    bowl = P(0, 0.6, 0.86)
    f.put('bronze', Ellipsoid(bowl, np.array((0.32, 0.32, 0.12)) * S), 0.02 * S)
    hollow = Ellipsoid(bowl + UP * 0.08 * S, np.array((0.27, 0.27, 0.1)) * S)
    f.sub(hollow, 0.01 * S)
    f.put('vein', Ellipsoid(bowl + UP * 0.03 * S, np.array((0.24, 0.24, 0.05)) * S), 0.01 * S)
    near = [raw_block(f, rng, P(0, 0.0, -0.22), np.array((1.2, 1.2, 0.5)) * S, k=0.02 * S, cuts=3, top_tilt=0.02),
            raw_block(f, rng, P(0, -0.05, 0.08), np.array((0.8, 0.9, 0.18)) * S, k=0.02 * S, cuts=3, top_tilt=0.02)]
    quarry_noise(f, 89, S, near=near)
    verts, faces = gs.mesh_sculpt(f, bpy, 'LookoutStatue', target)
    add_sculpt(p, f, verts, faces, STONE_COLOURS, STONE_KINDS)
    bronze_shell(bpy, p, f, 'LookoutStatue', 900, subs=(hollow,))
    return p


# ------------------------------------------------------------------ the rock
BIGF = 60.0


def _rock_mass(f, rng, blocks, k=0.4):
    out = []
    for (lab, c, size, R) in blocks:
        prim = block(rng, c, size, cuts=6, chamfer=(0.78, 0.95), R=R, top_tilt=0.25)
        f.put(lab, prim, k)
        out.append(prim)
    return out


def cleft_gate(bpy, p, target=11000):
    """The instance side of the Cleft (origin on the landing's height at the
    crack's foot, the landing toward -Y): two flanks of Stormcrag's ochre
    granite leaning together to a crack open to the sky, a chockstone jammed
    high in it, and at its foot the way back to the world cut as a doorway
    of the Smith's dressed stone: jambs, a lintel with his hammer rune, three
    steps, the vein's seam running out of it toward the Gallery."""
    rng = np.random.default_rng(97)
    f = Sculpt((-30, -8, -46), (30, 22, 66), 0.36)
    blocks = []
    for s in (-1, 1):
        # Tall slabs of each flank, leaning in over the crack, staggered so
        # the crack between them narrows toward the sky.
        for i in range(5):
            x = s * (8.5 + i * 4.2 + rng.uniform(-0.8, 0.8))
            h = rng.uniform(70, 96) - i * 6
            lean = -s * (0.1 + 0.04 * (4 - i)) + rng.uniform(-0.03, 0.03)
            blocks.append(('raw' if (i + (s > 0)) % 2 else 'rawd', (x, 4 + i * 1.5 + rng.uniform(-1.5, 1.5),
                                                                    -46 + h / 2),
                           (rng.uniform(5.5, 8.5), 16 + i * 1.5, h),
                           rot(ry=lean, rz=rng.uniform(-0.12, 0.12) + s * 0.08)))
        # Broken shoulders and fallen spalls at the flanks' foot.
        for i in range(3):
            blocks.append(('rawd', (s * rng.uniform(9, 16), rng.uniform(-3, 1), rng.uniform(-2, 2)),
                           (rng.uniform(3, 5), rng.uniform(3, 4), rng.uniform(2, 4)),
                           rot(rz=rng.uniform(0, 3), rx=rng.uniform(-0.3, 0.3))))
    # The crack's dark back, far in.
    blocks.append(('rawd', (0, 19, 10), (22, 6, 112), None))
    # The chockstone jammed in the crack.
    blocks.append(('raw', (0.5, 5, 30), (11, 8, 7), rot(rx=0.2, ry=0.3)))
    near = _rock_mass(f, rng, blocks, k=1.2)
    # The doorway cut into the rock at the crack's foot.
    f.sub(RoundBox((0, -1, 5.5), (3.6, 6, 5.6), 0.3), 0.2)
    for s in (-1, 1):
        f.put('skin', RoundBox((s * 4.6, -2.6, 5.4), (1.0, 0.9, 5.6), 0.12), 0.05)
        f.put('skin', RoundBox((s * 4.6, -2.7, 0.4), (1.3, 1.1, 0.5), 0.1), 0.05)
    f.put('skin', RoundBox((0, -2.7, 12.0), (6.4, 1.1, 1.1), 0.15), 0.06)
    f.put('apron', RoundBox((0, -2.9, 13.4), (7.0, 1.2, 0.35), 0.08), 0.04)
    for i in range(3):
        f.put('skin', RoundBox((0, -3.6 - i * 1.1, 0.85 - i * 0.4), (4.4 + i * 0.4, 0.6, 0.35), 0.08), 0.04)
    # The hammer rune cut into the lintel, its light in it.
    for (a, b) in (((0, -3.75, 11.0), (0, -3.75, 12.6)), ((-1.4, -3.75, 12.6), (1.4, -3.75, 12.6)),
                   ((-1.4, -3.75, 13.0), (1.4, -3.75, 13.0))):
        f.groove(Polyline([a, b], 0.05), 0.25, 0.12)
        f.put('vein', Polyline([np.asarray(a) + (0, 0.18, 0), np.asarray(b) + (0, 0.18, 0)], 0.09), 0.01)
    f.put('vein', Polyline([(-0.6, -2.0, 0.05), (0.8, -5.0, 0.0), (-0.4, -8.0, 0.0)], 0.12), 0.01)
    # Keep the landing clear: nothing in front of the door's step.
    Y = f.axes[1][None, :, None]
    f.d = np.maximum(f.d, (-(Y + 7.8) + np.zeros_like(f.d)).astype(np.float32))
    quarry_noise(f, 97, 30.0, near=near, grain=0.0)
    verts, faces = gs.mesh_sculpt(f, bpy, 'CleftGate', target)
    add_sculpt(p, f, verts, faces, COLOSSUS_COLOURS, COLOSSUS_KINDS, smooth=False)
    return p


def collapse_overhang(bpy, p, target=7000):
    """The Gallery's collapse spot (origin on the path's rim, the path toward
    -Y, its run along X): a great leaning flake of rock rising out of the
    chasm and hanging out over the path ten yards up, split from the mountain
    by a dark crack, boulders loose on its top. The iron straps, chains and
    the masons' warning are the builder's."""
    rng = np.random.default_rng(101)
    f = Sculpt((-14, -12, -34), (14, 16, 24), 0.3)
    blocks = [
        ('raw', (0, 6, -14), (22, 9, 36), rot(rx=-0.12)),
        ('rawd', (0, 2.5, 8), (24, 8, 10), rot(rx=-0.42)),
        ('raw', (-2, -2.0, 13.5), (20, 9, 5.5), rot(rx=-0.15, ry=0.05)),
        ('rawd', (5, -4.0, 12.0), (8, 7, 4.5), rot(rx=0.2, rz=0.3)),
        ('raw', (0, 12, 0), (26, 7, 46), None),
    ]
    near = _rock_mass(f, rng, blocks, k=0.8)
    for (c, r) in (((-6, -1.5, 17.5), 1.8), ((3, 0.5, 17.8), 2.2), ((7.5, -3, 15.8), 1.4)):
        f.put('rawd', Ellipsoid(c, (r * 1.2, r, r * 0.85), rot(rz=rng.uniform(0, 3))), 0.15)
    # The crack that frees the flake from the mountain.
    f.groove(Polyline([(-13, 8.5, 18), (-6, 7.5, 6), (0, 8.2, -4), (7, 7.6, 4), (13, 8.4, 16)], 0.2), 0.9, 0.5)
    # Keep the path clear: nothing under nine yards over the path's side (-Y).
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    f.d = np.maximum(f.d, np.where(Y < 1.0, (9.0 - Z) + np.zeros_like(f.d), -BIGF).astype(np.float32))
    quarry_noise(f, 101, 30.0, near=near, grain=0.0)
    verts, faces = gs.mesh_sculpt(f, bpy, 'CollapseOverhang', target)
    add_sculpt(p, f, verts, faces, COLOSSUS_COLOURS, COLOSSUS_KINDS, smooth=False)
    return p


def geode_rock(bpy, p, variant):
    """The rock of an ochre geode (collider r 2, 4 tall). A: a split boulder
    open toward -Y and up; B: a low block split by a seam. The crystals are
    faceted hulls the builder adds."""
    rng = np.random.default_rng(107 + ord(variant))
    f = Sculpt((-2.6, -2.6, -0.4), (2.6, 2.6, 3.4), 0.06)
    if variant == 'A':
        shell = Ellipsoid((0, 0.2, 1.25), (2.2, 2.0, 1.55))
        f.put('rawd', shell, 0.1)
        f.sub(Ellipsoid((0, 0.1, 1.35), (1.75, 1.55, 1.15)), 0.1)
        f.sub(RoundBox((0, -1.6, 2.4), (2.6, 1.6, 1.5), 0.2, rot(rx=0.55)), 0.15)
    else:
        f.put('rawd', block(rng, (0, 0, 0.55), (4.0, 3.2, 1.2), cuts=6, top_tilt=0.15), 0.1)
        f.sub(RoundBox((0, 0, 1.2), (1.6, 0.35, 0.5), 0.15, rot(rz=0.3)), 0.1)
    f.cut_below(0.0)
    n1 = Noise(107 + ord(variant))
    f.displace(lambda X, Y, Z: 0.06 * n1.fbm(X * 0.9, Y * 0.9, Z * 0.9, 3), band=0.3)
    verts, faces = gs.mesh_sculpt(f, bpy, 'Geode' + variant, 1800)
    add_sculpt(p, f, verts, faces, COLOSSUS_COLOURS, COLOSSUS_KINDS, smooth=False)
    return p
