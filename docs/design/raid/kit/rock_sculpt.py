"""The Smith's Heart's mountain rock kit, SCULPTED (build_smith_heart_rock_kit.py).

Phase 2E: the raid's mountain is one heightfield, and from the walks its
walls read as huge flat faceted planes. This kit is the rock that skins it:
modular faces of Stormcrag's own granite (never the quarry's worked benches:
this is the mountain as the weather left it), stacked up the slope in bands
by the runtime (src/render/smith_heart/heart_rock_plan_core.ts) so the
heightfield only ever shows as the dark between them.

Each piece is a signed-distance field (the sculpt primitives of
jaguar_head_sculpt.py and gravewyrm_sculpt.py) meshed once through OpenVDB:
  - the face is a few great leaning slabs of every width, each its own bed of
    the granite, the joints between them cut deep (big readable planes, the
    three-value read: lit tops, mid faces, dark joints);
  - the beds step back as they rise, so ledges run across the face and the
    low sun catches them; a parting cut along each;
  - wedges broken off the corners along oblique planes, a crack or two down
    through the beds, now and then an overhang over a shadowed undercut;
  - the crest broken into teeth and shoulders, falling back into the
    mountain; scree and boulders lying on the ledges (each stone set on the
    rock the field finds under it, nothing hangs);
  - the weather (RockPiece.finish): worn crests chipped pale, joints and
    hollows deep cool grey (never black), rain streaks under every ledge,
    the warm dust and a rust lichen only where they settle, on the tops.

Frame (the kit's): yards, +Z up, the face toward -Y. A face piece's origin is
on its FRONT plane at its foot's centre: nothing of it stands in front of
y = 0 (the runtime keeps that plane on the clearance line, so no camera
behind a player at a lip is ever inside rock), the body runs back to +Y.

Deterministic: every noise is seeded, nothing reads the clock.
"""
import math

import numpy as np

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Planes, Polyline, RoundBox, Sculpt, block
from gwkit import add_sculpt, crystal, mix, sstep
from hckit import STONE, _fbm
from jaguar_head_sculpt import Noise, smax
from shkit import DUST, GRIME, QUARRY_RED, RAW, SPiece, TAU

# ---- the granite (sRGB) ------------------------------------------------------------
# Stormcrag's granite as the mountain wears it: cool mid greys with a warm
# grey bed here and there (warm and cool greys mix, M5), a paler weathered
# skin on the big slabs, the dark of the joints a cool blue-grey. The warm
# lives in the low sun, the dust and a little rust lichen on the tops.
GRANITE = (0.4, 0.39, 0.39)
GRANITE_COOL = (0.35, 0.35, 0.37)
GRANITE_WARM = (0.44, 0.41, 0.38)
GRANITE_PALE = (0.5, 0.48, 0.46)
GRANITE_DARK = (0.29, 0.29, 0.31)
GRANITE_DEEP = (0.19, 0.19, 0.21)
LICHEN = (0.62, 0.45, 0.24)
LICHEN_GREY = (0.6, 0.6, 0.55)

ROCK_COLOURS = {
    'g0': GRANITE,
    'g1': GRANITE_COOL,
    'g2': GRANITE_WARM,
    'g3': mix(GRANITE, GRANITE_PALE, 0.5),
    'g4': mix(GRANITE_COOL, GRANITE_DARK, 0.5),
    'g5': mix(GRANITE, GRANITE_WARM, 0.5),
    'deep': mix(GRANITE_DARK, GRANITE_DEEP, 0.25),
    'body': mix(GRANITE_COOL, GRANITE_DARK, 0.55),
}
ROCK_KINDS = {k: RAW for k in ROCK_COLOURS}
BED_TONES = ('g0', 'g5', 'g1', 'g2', 'g0', 'g3', 'g4')


# ---- the weather ----------------------------------------------------------------------
class RockPiece(SPiece):
    """SPiece with the mountain's own weather on its RAW faces: the big value
    groups first (pale worn crests, mid faces, deep cool joints), rain
    streaks hanging under every ledge, lichen and dust only on the tops."""

    def __init__(self, name, seed=0, **kw):
        kw.setdefault('ao', 0.8)
        super().__init__(name, seed=seed, **kw)

    def finish(self, materials, parent):
        import bmesh
        from mathutils import Vector
        bm = self.bm
        if getattr(self, 'front_zero', None) is not None and bm.verts:
            # The front plane: the most forward rock at y = 0 (read off the
            # sculpt, so a piece's far build shares its near build's frame).
            y0 = self.front_zero
            for v in bm.verts:
                v.co.y -= y0
        # The winding first, on the closed sculpt (an open shell's would be
        # guessed, and could turn a whole piece inside out).
        free = [f for f in bm.faces if not f[self.keep]]
        if free:
            bmesh.ops.recalc_face_normals(bm, faces=free)
        if getattr(self, 'open_back', False) and bm.faces:
            # The back of the piece (deep in the mountain, never seen from a
            # walk) is left open: a camera zoomed far out behind a player at
            # the rim of an arena stands behind the rock and must see through
            # it, as it does through the heightfield (faces culled from
            # inside), never a flat wall.
            bm.normal_update()
            back = max(v.co.y for v in bm.verts)
            gone = [f for f in bm.faces
                    if f.normal.y > 0.7 and f.calc_center_median().y > back * 0.7]
            bmesh.ops.delete(bm, geom=gone, context='FACES')
        bm.normal_update()
        bm.verts.index_update()
        floor = min(v.co.z for v in bm.verts) if bm.verts else 0.0
        top = max(v.co.z for v in bm.verts) if bm.verts else 1.0
        span = max(0.5, top - floor)
        conv = [0.0] * len(bm.verts)
        for v in bm.verts:
            if not v.link_edges:
                continue
            mean = Vector()
            length = 0.0
            for e in v.link_edges:
                mean += e.other_vert(v).co
                length += e.calc_length()
            n = len(v.link_edges)
            mean /= n
            length = max(1e-3, length / n)
            conv[v.index] = max(-1.0, min(1.0, (v.co - mean).dot(v.normal) / length * 1.6))
        occ = self._bake_ao(span) if self.ao > 0 else None
        # Rain streaks: under every overhanging face (a downward normal) the
        # face below darkens in vertical runs. Sampled per vertex from the
        # nearest overhang above it (a coarse column test on the mesh).
        overhang = []
        for f in bm.faces:
            if f.normal.z < -0.35 and f.calc_area() > 0.05:
                c = f.calc_center_median()
                overhang.append((c.x, c.y, c.z))
        oh = np.array(overhang) if overhang else np.zeros((0, 3))
        for face in bm.faces:
            if face.material_index != STONE:
                continue
            fn = face.normal
            for loop in face.loops:
                n = loop.vert.normal if face.smooth else fn
                p = loop.vert.co
                c = conv[loop.vert.index]
                r, g, b, _ = loop[self.col]
                col = (r, g, b)
                height = p.z - floor
                up = max(0.0, n.z)
                # Broad tone drift (the slab's own weathered skin), the beds,
                # a soft darkening down to the foot (the mountain's shade).
                tone = 0.86 + 0.26 * _fbm(p.x * 0.09 + 3.0, p.y * 0.09, p.z * 0.07)
                bed = 0.96 + 0.06 * math.sin(p.z * 1.3 + _fbm(p.x * 0.05, p.y * 0.05, p.z * 0.05) * 6.0)
                foot = 0.8 + 0.2 * min(1.0, height / max(3.0, span * 0.3))
                under = 0.82 if n.z < -0.3 else 1.0
                # Chipped light edges and deep joints: the convexity carries
                # the value range (big groups, never a speckle).
                wear = 1.0 + 0.4 * max(0.0, c) - 0.55 * max(0.0, -c)
                k = tone * bed * foot * under * wear
                col = tuple(ch * k for ch in col)
                # Rain streaks under an overhang, on the faces that stand
                # upright below it.
                if len(oh) and abs(n.z) < 0.6:
                    dx = oh[:, 0] - p.x
                    dy = oh[:, 1] - p.y
                    dz = oh[:, 2] - p.z
                    near = (np.abs(dx) < 1.6) & (np.abs(dy) < 2.2) & (dz > 0.3) & (dz < 9.0)
                    if near.any():
                        fade = 1.0 - float(dz[near].min()) / 9.0
                        run = 0.55 + 0.45 * _fbm(p.x * 1.7 + 9.0, p.y * 1.7, 0.0)
                        col = mix(col, GRIME, min(0.42, 0.42 * fade * run))
                # Iron stain in a few beds.
                stain = sstep(0.66, 0.84, _fbm(p.x * 0.1 + 3.0, p.y * 0.1, p.z * 0.45))
                col = mix(col, QUARRY_RED, stain * 0.16)
                # The tops: warm dust drifts and rust and grey lichen, only
                # where they settle (M6).
                patch = _fbm(p.x * 0.6 + 11.0, p.y * 0.6 - 5.0, p.z * 0.6)
                dust = sstep(0.6, 0.93, n.z) * (0.35 + 0.65 * patch)
                col = mix(col, DUST, min(0.32, dust * 0.36 * self.dust))
                lich = sstep(0.4, 0.8, n.z) * sstep(0.55, 0.75, _fbm(p.x * 0.9 - 7.0, p.y * 0.9, p.z * 0.9))
                col = mix(col, LICHEN if patch > 0.5 else LICHEN_GREY, min(0.45, lich * 0.55))
                if occ is not None:
                    o = occ[loop.vert.index] * self.ao
                    col = tuple(ch * (1 - 0.7 * o) for ch in col)
                # Never black (L6): the deepest joint keeps a cool grey.
                col = tuple(max(lo, ch) for ch, lo in zip(col, (0.1, 0.1, 0.125)))
                loop[self.col] = (min(1.0, col[0]), min(1.0, col[1]), min(1.0, col[2]), 1.0)
        # Crisp where the rock breaks, soft over a slab's swell: smooth
        # shading with every edge sharper than SHARP marked (the big planes
        # read as planes, the decimation never as facets).
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b2 = e.link_faces
                if a.normal.angle(b2.normal, 0.0) > SHARP:
                    e.smooth = False
        mesh = __import__('bpy').data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        bpy = __import__('bpy')
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


SHARP = math.radians(28)


def RP(name, **kw):
    return RockPiece('Kit_' + name, **kw)


# A piece's near and far builds mesh the SAME sculpt (built once per run).
_FIELDS = {}


def _sculpt_once(key, build):
    if key not in _FIELDS:
        _FIELDS[key] = build()
    return _FIELDS[key]


def front_of(f):
    """The most forward y the sculpt's rock reaches (its front plane)."""
    inside = np.nonzero((f.d < 0).any(axis=(0, 2)))[0]
    return float(f.axes[1][inside[0]]) if len(inside) else 0.0


# ---- field helpers ---------------------------------------------------------------------
def _axes(f):
    return f.axes[0][:, None, None], f.axes[1][None, :, None], f.axes[2][None, None, :]


def clamp_front(f, y0=0.0, k=0.25):
    """Nothing in front of the plane y = y0 (softly rounded where it bites)."""
    _X, Y, _Z = _axes(f)
    f.d = smax(f.d, (y0 - Y).astype(np.float32) + np.zeros_like(f.d), k)


def clamp_below(f, z0=0.0):
    _X, _Y, Z = _axes(f)
    f.d = np.maximum(f.d, (z0 - Z).astype(np.float32))


class Lens(Planes):
    """The part of a ball (centre c, radius r) past a plane through c with
    outward normal n: a spall knocked off the rock, leaving one flat
    oblique facet and a broken rim."""

    def __init__(self, c, n, r):
        n = np.asarray(n, dtype=np.float64)
        n = n / np.linalg.norm(n)
        super().__init__(c, [tuple(-n)], [0.0])
        self.r = float(r)
        self.lo = self.c - self.r
        self.hi = self.c + self.r

    def dist(self, X, Y, Z):
        plane = super().dist(X, Y, Z)
        ball = np.sqrt((X - self.c[0]) ** 2 + (Y - self.c[1]) ** 2 + (Z - self.c[2]) ** 2) - self.r
        return np.maximum(plane, ball)


def wedge(f, rng, c, n, r, k=0.08):
    """Knock a spall off the rock at c (on or just inside its surface): the
    big oblique fracture facets a weathered face shows."""
    f.sub(Lens(c, n, r), k)


def crest(f, W, H, D, rng, seed, peaks=2, lift=0.0, fall=0.35, rough=1.1):
    """Shape the top: a ridge falling back into the mountain, low shoulders
    at the ends, a few unequal peaks and notches, a broken jag along it."""
    X, Y, Z = _axes(f)
    nc = Noise(seed + 31)
    xs = np.sort(rng.uniform(-W * 0.36, W * 0.36, peaks))
    # Broad, low peaks (phase 2E review: tall narrow ones read as a skyline
    # of teeth from across the fissure).
    pk = [(c, H * rng.uniform(0.04, 0.09), W * rng.uniform(0.18, 0.3), W * rng.uniform(0.18, 0.3)) for c in xs]
    notches = [((xs[i] + xs[i + 1]) / 2 + rng.uniform(-1, 1), H * rng.uniform(0.05, 0.1), W * rng.uniform(0.04, 0.07))
               for i in range(len(xs) - 1) if rng.random() < 0.75]
    tilt = rng.uniform(-0.1, 0.1)
    yr = D * 0.45

    def z_of(Xa, Ya):
        t = np.clip(Xa / (W / 2), -1.3, 1.3)
        z = (H * (0.86 + lift)) * (1 - 0.16 * np.abs(t) ** 3) * (1 + tilt * t)
        for (c, a, wl, wr) in pk:
            w = np.where(Xa < c, wl, wr)
            z = z + a * np.maximum(0.0, 1 - ((Xa - c) / w) ** 2 - ((Ya - yr) / (1.2 * w)) ** 2)
        for (c, a, w) in notches:
            z = z - a * np.maximum(0.0, 1 - np.abs(Xa - c) / w)
        z = z + rough * (nc.ridged(Xa * 0.14, Ya * 0.12, 1.0, 2) - 0.5) + 0.8 * nc.fbm(Xa * 0.06, Ya * 0.06, 2.0, 2)
        # The brink at the front sits a little under the ridge, the back
        # falls away gently into the mountain.
        return z - np.maximum(0.0, yr - Ya) * fall - np.maximum(0.0, Ya - yr) * 0.15

    f.d = np.maximum(f.d, ((Z - z_of(X, Y)) * 0.6).astype(np.float32))


def weather(f, seed, amp=1.0, band=2.0, broad=0.9):
    """The mountain's own unevenness: a broad swell (no face is ever a plane),
    ridged fracture facets at medium frequency, a fine chatter."""
    n1, n2 = Noise(seed), Noise(seed + 5)
    f.displace(lambda X, Y, Z: broad * n2.fbm(X * 0.035 + 4.2, Y * 0.035, Z * 0.03, 2)
               + amp * (0.5 * n1.fbm(X * 0.07 + 1.7, Y * 0.07, Z * 0.05, 2)
                                      + 0.32 * (n1.ridged(X * 0.2, Y * 0.2, Z * 0.26, 2) - 0.45)
                                      + 0.07 * n2.fbm(X * 0.9, Y * 0.9, Z * 0.9, 2)), band=band)


def ground_on(f, x, y, z_top, z_bot=0.0, step=0.2):
    """The rock's top under (x, y) (None if it misses)."""
    zs = np.arange(z_top, z_bot, -step)
    P = np.stack([np.full_like(zs, x), np.full_like(zs, y), zs], axis=1)
    d = f.sample(P)
    hit = np.nonzero(d < 0)[0]
    return float(zs[hit[0]]) if len(hit) else None


def scree(p, f, rng, x0, x1, y0, y1, z_top, count, size=(0.4, 1.3), flat=0.5, z_min=1.0):
    """Stones fallen from the face, lying in heaps on its ledges and its
    crest wherever the rock lies flat (each set on the rock under it)."""
    placed = 0
    tries = 0
    while placed < count and tries < count * 8:
        tries += 1
        cx = float(rng.uniform(x0, x1))
        cy = float(rng.uniform(y0, y1))
        g = ground_on(f, cx, cy, z_top)
        if g is None or g < z_min:
            continue
        gx, gy = ground_on(f, cx + 0.8, cy, z_top), ground_on(f, cx, cy + 0.8, z_top)
        if gx is None or gy is None or max(abs(gx - g), abs(gy - g)) > flat:
            continue
        for j in range(int(rng.integers(2, 6))):
            x = cx + float(rng.uniform(-1.6, 1.6))
            y = cy + float(rng.uniform(-0.8, 0.8))
            gg = ground_on(f, x, y, z_top)
            if gg is None or abs(gg - g) > 1.2 or y < 0.3:
                continue
            s = float(rng.uniform(*size)) * (1.6 if j == 0 else 1.0)
            tone = (GRANITE, GRANITE_COOL, GRANITE_DARK, GRANITE_WARM)[int(rng.integers(0, 4))]
            crystal(p, (x, y, gg + s * 0.25), (s * 1.3, s * 1.05, s * 0.62), p.vary(tone, 0.06), n=12, boxy=0.5,
                    jitter=0.2, yaw=float(rng.uniform(0, TAU)), pitch=float(rng.uniform(-0.3, 0.3)), floor=gg - 0.15)
        placed += 1


# ---- the pieces -------------------------------------------------------------------------
def _segments(rng, W, wmin, wmax):
    """Split [-W/2, W/2] into unequal widths (a great slab beside narrow ones)."""
    xs = [-W / 2]
    while xs[-1] < W / 2 - wmin:
        xs.append(min(W / 2, xs[-1] + float(rng.uniform(wmin, wmax))))
    xs[-1] = W / 2
    return list(zip(xs[:-1], xs[1:]))


class Body(gs.Prim if hasattr(gs, 'Prim') else object):
    """The band's own mass: everything behind its front surface (a function
    of x and z), back to the depth D, above the foot."""

    def __init__(self, front, lo, hi, D, half=None):
        self.front = front
        self.D = D
        self.half = half
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        d = np.maximum((self.front(X, Z) - Y) * 0.75, Y - self.D)
        return d if self.half is None else np.maximum(d, np.abs(X) - self.half)

    def at(self, P):
        return self.dist(P[:, 0], P[:, 1], P[:, 2])


def rock_face(bpy, p, name, seed, W, H, D, beds=3, overhang=False, peaks=2, lift=0.0, wedges=0, target=4200,
              voxel=0.2, scree_n=4, ends=True, lean=0.06, relief=1.0, plate=(5.5, 13.0), thick=(2.8, 6.5),
              dip=0.14, key=None):
    """A band of the mountain's face (see the module doc): the band's own
    mass, its front a slow wave leaning back as it rises, and on it the
    plates of the granite's beds, stacked up the face, each broken to its
    own outline, dipping a little and overlapping its neighbours (never a
    grid: no two rows share a joint), standing out of the mass by up to a
    yard and a half; then cracks, an overhang, the crest and the weather.
    Returns p."""
    def build():
        rng = np.random.default_rng(seed)
        f = Sculpt((-W / 2 - 3.0, -2.0, -0.6), (W / 2 + 3.0, D + 2.0, H * 1.25 + 2.0), voxel)
        nf = Noise(seed + 3)

        def front_v(X, Z):
            # The face's line: wavy across, leaning back as it rises, the ends
            # turned back into the mountain.
            # (The ends turn right back to the body's back: a piece left at
            # the end of a run, or seen past a spur, shows rock falling away,
            # never a flat cut.)
            t = np.abs(X) / (W / 2)
            return (relief * (0.5 + 0.5 * nf.fbm(X * 0.09, X * 0.0, Z * 0.07, 2)) + Z * lean
                    + (np.maximum(0.0, t - 0.72) * 9.0 + np.maximum(0.0, t - 0.86) ** 1.5 * D * 9.0
                       if ends else 0.0))

        def front(x, z):
            return float(front_v(np.array(x), np.array(z)))

        f.put('body', Body(lambda X, Z: front_v(X, Z) + 1.1, (-W / 2 - 3.0, -2.0, -0.6),
                           (W / 2 + 3.0, D + 2.0, H * 1.25 + 2.0), D), 0.0)
        # The beds' dip: one way across the whole piece (strata run on), each
        # plate a breath off it.
        dip0 = float(rng.uniform(-dip, dip))
        z = -0.5
        row = 0
        while z < H * 1.12:
            t = float(rng.uniform(*thick)) * (1.25 if z < H * 0.3 else 1.0)
            bed = BED_TONES[int(rng.integers(0, len(BED_TONES)))]
            x = -W / 2 - 2.0 - float(rng.uniform(0, plate[0]))
            while x < W / 2 + 2.0:
                # A great slab now and then among the plates (big planes first).
                big = rng.random() < 0.28
                w = float(rng.uniform(plate[1], plate[1] * 1.6)) if big else float(rng.uniform(*plate))
                cx = x + w / 2
                th = t * float(rng.uniform(1.3, 2.0) if big else rng.uniform(0.8, 1.25))
                cz = z + th / 2 + float(rng.uniform(-0.9, 0.6))
                d = D * float(rng.uniform(0.35, 0.55))
                fy = front(cx, cz) + float(rng.uniform(-0.35, 0.9))
                # Turned and tipped each its own way (a weathered bed is
                # never a course of masonry), more the smaller it is.
                tip = 0.1 if big else 0.2
                R = gs.rot(rx=float(rng.uniform(-0.12, 0.06)), ry=dip0 + float(rng.uniform(-tip, tip)),
                           rz=float(rng.uniform(-tip, tip)))
                label = bed if rng.random() < 0.7 else BED_TONES[int(rng.integers(0, len(BED_TONES)))]
                # Now and then a plate is missing (fallen): the mass shows.
                if rng.random() > 0.1:
                    # Broken deep on every side (phase 2F: at 2E's shallow
                    # chamfers a plate read as a squared slab from the walks),
                    # blended into its neighbours where they meet.
                    f.put(label, block(rng, (cx, fy + d / 2, cz), (w, d, th), cuts=16, chamfer=(0.55, 0.9), R=R,
                                       top_tilt=0.3), 0.06)
                    # A second block across it, turned its own way: the
                    # plate's outline is never a rectangle.
                    if rng.random() < 0.6:
                        R2 = gs.rot(rx=float(rng.uniform(-0.15, 0.08)), ry=dip0 + float(rng.uniform(-0.3, 0.3)),
                                    rz=float(rng.uniform(-0.3, 0.3)))
                        cx2 = cx + w * float(rng.uniform(-0.35, 0.35))
                        cz2 = cz + th * float(rng.uniform(-0.3, 0.3))
                        # On the face's own line there (the ends turn back).
                        fy2 = front(cx2, cz2) + float(rng.uniform(-0.2, 0.6))
                        f.put(label, block(rng, (cx2, fy2 + d / 2, cz2),
                                           (w * float(rng.uniform(0.35, 0.65)), d, th * float(rng.uniform(0.6, 1.1))),
                                           cuts=12, chamfer=(0.55, 0.9), R=R2, top_tilt=0.35), 0.06)
                    if rng.random() < 0.45:
                        wedge(f, rng, (cx + float(rng.uniform(-w, w)) * 0.4, fy - 0.1,
                                       cz + th * float(rng.uniform(-0.2, 0.5))),
                              (float(rng.uniform(-0.6, 0.6)), -1.0, float(rng.uniform(-0.2, 0.9))),
                              float(rng.uniform(0.9, 2.0)))
                    # A crack across the bigger plates (no long straight edge
                    # survives the weather).
                    if w > 6.0 and rng.random() < 0.6:
                        sx = cx + float(rng.uniform(-w * 0.3, w * 0.3))
                        lean_c = float(rng.uniform(-0.6, 0.6))
                        f.groove(Polyline([(sx - lean_c * th * 0.5, fy - 0.05, cz - th * 0.55),
                                           (sx + lean_c * th * 0.5, fy - 0.05, cz + th * 0.55)], 0.04),
                                 0.3, 0.12)
                x += w * float(rng.uniform(0.6, 0.95))
            z += t * float(rng.uniform(0.72, 0.95))
            row += 1
        # Cracks down through the blocks.
        for _ in range(int(rng.integers(1, 3))):
            cx = float(rng.uniform(-W * 0.35, W * 0.35))
            pts = []
            z = H * float(rng.uniform(0.6, 1.0))
            z_end = H * float(rng.uniform(0.0, 0.35))
            while z > z_end:
                pts.append((cx, front(cx, z), z))
                cx += float(rng.uniform(-0.7, 0.7))
                z -= float(rng.uniform(1.0, 2.4))
            if len(pts) > 1:
                for dy in (0.4, 1.4, 2.4):
                    f.groove(Polyline([(x, y + dy, z) for (x, y, z) in pts], 0.06), 0.4, 0.15)
        # An overhang: a great slab of a bed jutting out over the face below
        # (its own shadow is the undercut).
        if overhang:
            ow = float(rng.uniform(W * 0.3, W * 0.45))
            ox = float(rng.uniform(-W / 2 + ow / 2, W / 2 - ow / 2))
            oz = H * float(rng.uniform(0.58, 0.72))
            fy = front(ox, oz)
            f.put('g4', block(rng, (ox, fy + 1.4, oz), (ow, 5.0, 2.2), cuts=12, chamfer=(0.7, 0.92),
                              R=gs.rot(rx=0.08, ry=dip0, rz=float(rng.uniform(-0.12, 0.12)))), 0.05)
        crest(f, W, H, D, rng, seed, peaks=peaks, lift=lift)
        weather(f, seed, amp=0.38)
        clamp_below(f, 0.0)
        return f

    f = _sculpt_once(key or name, build)
    rng = np.random.default_rng(seed + 77)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    if scree_n:
        scree(p, f, rng, -W / 2 + 1.5, W / 2 - 1.5, 0.6, D * 0.8, H * 1.3, scree_n)
    p.front_zero = front_of(f)
    p.open_back = True
    return p


def rock_lip(bpy, p, name, seed, W, H, D, out=0.3, target=1100, voxel=0.18, key=None, grain=1.0):
    """A module of a walk's side where it falls into the chasm (the rock
    under a floor's lip): the same granite plates on their mass, hanging
    from the lip (origin on it, z 0; nothing stands above z -0.12, so no
    stone is ever proud of the walk) down H yards, the face leaning OUT
    over the void by `out` yards per yard of drop (in front of the field's
    own flaring rock, toward -Y) and the body running back under the floor
    (+Y). The top lift is a worn brink; the beds dip a little across it."""
    def build():
        rng = np.random.default_rng(seed)
        lo = (-W / 2 - 2.5, -out * H - 3.0, -H - 0.6)
        hi = (W / 2 + 2.5, D + 1.5, 1.0)
        f = Sculpt(lo, hi, voxel)
        nf = Noise(seed + 3)

        def front_v(X, Z):
            # Out over the void as it falls (Z is negative under the lip),
            # wavy across, a slow swell down the face: from the brink (a
            # breath out past the walk's edge) it always stands in front of
            # the field's own rock, which flares out a fifth of a yard per
            # yard of drop.
            # The ends turn back under the walk (a module left at the end of
            # its run shows broken rock, never a cut side).
            return (Z * out - 0.8 + 0.7 * (0.5 + 0.5 * nf.fbm(X * 0.11, X * 0.0, Z * 0.06, 2))
                    + 0.5 * nf.fbm(X * 0.03 + 7.0, 0.0, Z * 0.025, 2)
                    + np.maximum(0.0, np.abs(X) - (W / 2 - 3.0)) * (2.2 - Z * out * 0.35))

        def front(x, z):
            return float(front_v(np.array(x), np.array(z)))

        # The mass stops short of the module's ends (the plates run past it,
        # so an end left open reads as broken rock, never a cut).
        f.put('body', Body(lambda X, Z: front_v(X, Z) + 0.5, lo, hi, D, half=W / 2 + 1.0), 0.0)
        dip0 = float(rng.uniform(-0.1, 0.1))
        z = 0.6
        while z > -H - 1.0:
            t = float(rng.uniform(2.6, 6.0)) * grain
            bed = BED_TONES[int(rng.integers(0, len(BED_TONES)))]
            x = -W / 2 - 1.5 - float(rng.uniform(0, 4.0))
            while x < W / 2 + 1.5:
                big = rng.random() < 0.25
                w = (float(rng.uniform(9.0, 14.0)) if big else float(rng.uniform(4.0, 9.0))) * grain
                cx = x + w / 2
                th = t * float(rng.uniform(1.2, 1.8) if big else rng.uniform(0.8, 1.2))
                cz = z - th / 2 + float(rng.uniform(-0.5, 0.6))
                d = float(rng.uniform(3.0, 5.0)) * max(grain, 0.7)
                fy = front(cx, cz) + float(rng.uniform(-0.3, 0.8)) * grain
                tip = 0.06 if big else 0.13
                R = gs.rot(rx=float(rng.uniform(-0.05, 0.12)), ry=dip0 + float(rng.uniform(-tip, tip)),
                           rz=float(rng.uniform(-tip, tip)))
                label = bed if rng.random() < 0.7 else BED_TONES[int(rng.integers(0, len(BED_TONES)))]
                if rng.random() > 0.08:
                    f.put(label, block(rng, (cx, fy + d / 2, cz), (w, d, th), cuts=14, chamfer=(0.6, 0.9), R=R,
                                       top_tilt=0.2), 0.02)
                x += w * float(rng.uniform(0.6, 0.95))
            z -= t * float(rng.uniform(0.72, 0.95))
        # Cracks down the face.
        for _ in range(int(rng.integers(1, 3))):
            cx = float(rng.uniform(-W * 0.35, W * 0.35))
            pts = []
            zz = -float(rng.uniform(0.5, 3.0))
            z_end = -H * float(rng.uniform(0.4, 0.9))
            while zz > z_end:
                pts.append((cx, front(cx, zz), zz))
                cx += float(rng.uniform(-0.6, 0.6))
                zz -= float(rng.uniform(1.0, 2.4))
            if len(pts) > 1:
                for dy in (0.3, 1.2):
                    f.groove(Polyline([(x, y + dy, z) for (x, y, z) in pts], 0.06), 0.35, 0.14)
        weather(f, seed, amp=0.32)
        # The brink: flat under the walk's top (never proud of it), the ends
        # square for the next module to meet, the foot open (the chasm).
        # (Phase 2F: 2E cut it flat at the walk's height, and from the play
        # camera the plates' cross-sections read as pale hooked slabs lying
        # beside the walk. The brink now rounds over and falls away out over
        # the void, a yard and a half per yard, so only rock face is seen.)
        _X, Y, Z = _axes(f)
        out_of = np.maximum(0.0, -Y - 0.2)
        top = -0.05 - 1.5 * out_of - 0.25 * out_of ** 2
        # Only the brink's first yards: lower down, the face leans out as
        # it falls and stays whole.
        cut = np.where(Z > -7.0, (Z - top) * 0.8, -50.0)
        f.d = smax(f.d, (cut + np.zeros_like(f.d)).astype(np.float32), 0.35)
        clamp_below(f, -H)
        return f

    f = _sculpt_once(key or name, build)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    p.open_back = True
    return p


def buttress(bpy, p, name, seed, W, H, D, target=3400, voxel=0.2, key=None, scree_n=2):
    """A rib of the mountain standing out of the face: tall sheets of the
    granite on edge, in two or three lifts, closing to a prow toward -Y (the
    front plane), each sheet its own width and tone, the joints between them
    deep; a ledge or two across it where a lift stops, wedges off its
    flanks, a broken crag on top."""
    def build():
        rng = np.random.default_rng(seed)
        f = Sculpt((-W / 2 - 2.5, -2.0, -0.6), (W / 2 + 2.5, D + 2.0, H * 1.2 + 2.0), voxel)
        # The rib's own mass behind its sheets, closing to its prow and
        # falling back into the mountain at its flanks (never a flat side).
        f.put('body', Body(lambda X, Z: (np.abs(X) / (W / 2)) ** 2 * D * 0.95 + 1.6 + Z * 0.02,
                           (-W / 2 - 2.5, -2.0, -0.6), (W / 2 + 2.5, D + 2.0, H * 1.2 + 2.0), D), 0.0)
        lifts = np.sort(rng.uniform(H * 0.3, H * 0.8, int(rng.integers(1, 3))))
        zs = [0.0, *lifts.tolist(), H * 1.1]
        for li in range(len(zs) - 1):
            z0, z1 = zs[li], zs[li + 1]
            x = -W / 2 - 0.5
            k = 0
            while x < W / 2 + 0.5:
                w = float(rng.uniform(2.2, 4.8))
                cx = x + w / 2
                t = cx / (W / 2)
                # The prow: the sheets close toward the middle, the flanks fall
                # back; each lift a step back from the one below.
                fy = abs(t) ** 1.4 * W * 0.55 + li * float(rng.uniform(0.6, 1.4)) + float(rng.uniform(0.0, 0.5))
                h = (z1 - z0) * float(rng.uniform(0.92, 1.12)) * (1 - 0.25 * abs(t))
                d = D * float(rng.uniform(0.55, 0.85))
                R = gs.rot(rx=float(rng.uniform(-0.06, 0.0)), rz=-t * 0.45 + float(rng.uniform(-0.06, 0.06)),
                           ry=float(rng.uniform(-0.05, 0.05)))
                f.put(BED_TONES[int(rng.integers(0, len(BED_TONES)))],
                      block(rng, (cx, fy + d / 2, z0 + h / 2), (w, d, h), cuts=8, chamfer=(0.8, 0.96), R=R,
                            top_tilt=0.4), 0.05)
                x += w * float(rng.uniform(0.75, 0.95))
                k += 1
        for _ in range(3):
            side = rng.choice([-1.0, 1.0])
            wedge(f, rng, (side * float(rng.uniform(0.5, W * 0.4)), float(rng.uniform(1.0, 3.0)),
                           float(rng.uniform(H * 0.3, H * 0.95))),
                  (side * float(rng.uniform(0.4, 1.0)), -float(rng.uniform(0.5, 1.0)), float(rng.uniform(0.0, 0.8))),
                  float(rng.uniform(2.5, 4.0)))
        crest(f, W, H, D, rng, seed, peaks=1, lift=0.08, fall=0.5, rough=1.6)
        weather(f, seed, amp=0.35)
        clamp_below(f, 0.0)
        return f

    f = _sculpt_once(key or name, build)
    rng = np.random.default_rng(seed + 77)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    if scree_n:
        scree(p, f, rng, -W / 2 + 1, W / 2 - 1, 0.6, D * 0.7, H * 1.25, scree_n)
    p.front_zero = front_of(f)
    p.open_back = True
    return p


def boulder(bpy, p, name, seed, size, target=420, voxel=0.08):
    """A boulder fallen from the face: a heavy faceted block, its corners
    knocked round, a fracture plane or two across it, sunk a little into the
    ground it lies on (origin at its foot's centre)."""
    rng = np.random.default_rng(seed)
    sx, sy, sz = size
    r = max(size) * 0.75 + 0.6
    f = Sculpt((-r, -r, -0.6), (r, r, sz + 0.8), voxel)
    f.put('g0', block(rng, (0, 0, sz * 0.42), (sx, sy, sz * 1.05), cuts=12, chamfer=(0.7, 0.92),
                      R=gs.rot(rz=float(rng.uniform(0, TAU)), rx=float(rng.uniform(-0.15, 0.15)))), 0.0)
    f.put('g5', block(rng, (sx * 0.15, -sy * 0.1, sz * 0.32), (sx * 0.8, sy * 0.85, sz * 0.75), cuts=9,
                      chamfer=(0.72, 0.92), R=gs.rot(rz=float(rng.uniform(0, TAU)))), 0.25)
    wedge(f, rng, (sx * 0.3, -sy * 0.3, sz * 0.8), (0.6, -0.7, 0.7), max(size) * 0.45, k=0.04)
    n1 = Noise(seed)
    f.displace(lambda X, Y, Z: 0.12 * n1.fbm(X * 0.4, Y * 0.4, Z * 0.4, 2)
               + 0.05 * (n1.ridged(X * 1.3, Y * 1.3, Z * 1.3, 2) - 0.45), band=0.6)
    clamp_below(f, 0.0)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    return p


def needle(bpy, p, name, seed, W, H, twin=False, target=3600, voxel=None):
    """A needle of the mountain's crest (phase 2F: the skyline had only
    broad low crests): a tall spire of the granite's beds stacked and
    narrowing, each bed a broken block turned its own way and set off the
    one under it (the spire leans and kinks, never a cone), shoulders of
    fallen beds at its foot, a split tip (two tips for `twin`), weathered.
    Origin at its foot's centre; it stands on the mountain's crest and is
    seen from every side, so it is closed all round."""
    rng = np.random.default_rng(seed)
    vox = voxel or max(0.3, H / 170)
    f = Sculpt((-W * 0.9, -W * 0.9, -1.0), (W * 0.9, W * 0.9, H * 1.08), vox)
    lean = np.array([float(rng.uniform(-0.12, 0.12)), float(rng.uniform(-0.12, 0.12))])
    z = -0.5
    cx, cy = 0.0, 0.0
    k = 0
    while z < H * 0.9:
        t = max(0.0, z) / H
        h = H * float(rng.uniform(0.07, 0.13))
        w = W * (1 - t) ** 0.85 * float(rng.uniform(0.85, 1.1)) + 1.2
        label = BED_TONES[k % len(BED_TONES)]
        f.put(label, block(rng, (cx, cy, z + h / 2), (w, w * float(rng.uniform(0.7, 0.95)), h * 1.3), cuts=14,
                           chamfer=(0.5, 0.86), R=gs.rot(rz=float(rng.uniform(0, TAU)),
                                                        rx=float(rng.uniform(-0.12, 0.12)),
                                                        ry=float(rng.uniform(-0.12, 0.12))), top_tilt=0.3), 0.6)
        cx += lean[0] * h + float(rng.uniform(-0.6, 0.6))
        cy += lean[1] * h + float(rng.uniform(-0.6, 0.6))
        z += h * 0.82
        k += 1
    tips = [(cx, cy)] if not twin else [(cx - W * 0.12, cy), (cx + W * 0.1, cy + W * 0.05)]
    for i, (tx, ty) in enumerate(tips):
        top = H * (1.0 if i == 0 else 0.86)
        f.put('g3', Polyline([(tx, ty, z - H * 0.08), (tx + float(rng.uniform(-1, 1)), ty, top)],
                             [max(1.4, W * 0.14), 0.25]), 0.8)
    # Shoulders: fallen beds heaped at its foot.
    for _ in range(5):
        a = float(rng.uniform(0, TAU))
        r = W * float(rng.uniform(0.35, 0.6))
        s = W * float(rng.uniform(0.25, 0.45))
        f.put(BED_TONES[int(rng.integers(0, len(BED_TONES)))],
              block(rng, (math.cos(a) * r, math.sin(a) * r, s * 0.35), (s, s * 0.8, s * 0.7), cuts=12,
                    chamfer=(0.5, 0.85), R=gs.rot(rz=a)), 0.8)
    for _ in range(3):
        cz = float(rng.uniform(H * 0.2, H * 0.7))
        a = float(rng.uniform(0, TAU))
        wedge(f, rng, (math.cos(a) * W * 0.3, math.sin(a) * W * 0.3, cz),
              (math.cos(a), math.sin(a), float(rng.uniform(-0.3, 0.5))), W * float(rng.uniform(0.18, 0.3)))
    weather(f, seed, amp=0.7, band=2.4)
    clamp_below(f, 0.0)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    return p


# ---- phase 2G: the calm mountain ---------------------------------------------------
# The owner's review of 2F: from the Ring and the Balcony the walls read as a
# wall of crumpled paper (hundreds of same-sized tilted plates, noise
# everywhere, no rest). The style guide's S5 (a few big parts), H2 (bend in one
# or two gentle arcs, never wiggle) and R2 (cluster detail, leave rest areas).
# The mountain is now built of a few great masses: tall faces split into two to
# four columns by deep vertical clefts, every column a broad plane turned its
# own way, the granite's beds running across the whole face in lifts that
# step back as they rise (a lit ledge on top of each, a dark drip-edge under
# it); great fracture planes knock oblique facets off the columns' corners; the
# small stuff (cracks, partings, scree) gathers round the clefts and nowhere
# else.

# The lifts' spacing in the kit's own yards: every lift line of every wall
# piece sits at a multiple of it above the piece's foot, so the runtime, which
# draws every piece at the same vertical scale on a foot set to the world's
# bed grid (heart_rock_plan_core.ts HEART_ROCK_STRATA), lines the beds up
# from piece to piece round the whole mountain.
ROCK_LIFT = 12.0


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _columns(rng, W, n):
    """Split [-W/2, W/2] into n columns of unequal width (one broad, the
    others narrower): their bounds."""
    w = rng.dirichlet(np.full(n, 2.2)) * 0.55 + 0.45 / n
    w = w / w.sum() * W
    xs = np.concatenate([[-W / 2], -W / 2 + np.cumsum(w)])
    return [(float(xs[i]), float(xs[i + 1])) for i in range(n)]


def rock_wall(bpy, p, name, seed, W, H, D, cols=3, clefts=None, lean=0.05, setback=(0.6, 1.6), lip=(0.45, 1.0),
              crown='shoulder', fall=0.4, detail=0, prow=0.0, target=3000, voxel=0.3, key=None,
              scree_n=4):
    """A great face of the mountain (see the phase 2G notes above): W across,
    H tall (a whole number of ROCK_LIFT lifts reads best), its body D deep.

    `cols` columns, each a broad plane turned a little its own way and
    rounded back at its edges; `clefts` (per inner bound: 1 full height, a
    fraction 0..1 a cleft from the crest down that far, 0 none) deep V cuts
    wandering in one gentle arc; every ROCK_LIFT the face steps back
    (`setback`) with a drip-edge (`lip`) over the lift below; `crown` the
    crest's character ('shoulder' rounded and falling back, 'tower' columns
    ending at their own heights, 'dome' one broad swell; every column's top
    a table tipped one way with a corner chopped off, and most columns a
    great fracture plane off one corner); `detail` (0, 1, 2) how much small
    work clusters round the clefts (cracks, partings); `prow` turns the
    outer columns back like a ship's prow (a buttress). Returns p."""
    def build():
        rng = np.random.default_rng(seed)
        lo = (-W / 2 - 3.0, -4.0, -0.6)
        hi = (W / 2 + 3.0, D + 2.0, H * 1.15 + 2.0)
        f = Sculpt(lo, hi, voxel)
        nf = Noise(seed + 3)
        bounds = _columns(rng, W, cols)
        cuts = [b[1] for b in bounds[:-1]]
        depth_of = clefts if clefts is not None else [1.0] * len(cuts)
        col = []
        for i, (a, b) in enumerate(bounds):
            c = (a + b) / 2
            t = (2 * i / max(1, cols - 1) - 1) if cols > 1 else 0.0
            hw = (b - a) / 2
            col.append(dict(a=a, b=b, c=c, hw=hw,
                            off=float(rng.uniform(0.0, 2.0)) + abs(t) * prow * hw,
                            tilt=float(rng.uniform(-0.17, 0.17)) + t * prow,
                            # The column's edges bevelled back in one plane
                            # each (chunky facets, never a rounded barrel).
                            bev=float(rng.uniform(0.78, 0.9)), bslope=float(rng.uniform(0.9, 1.6)),
                            top=float(rng.uniform(0.84, 1.0)) * H,
                            tslope=float(rng.uniform(0.12, 0.3)) * (-1.0 if rng.random() < 0.5 else 1.0),
                            shave=rng.random() < 0.65,
                            sside=-1.0 if rng.random() < 0.5 else 1.0,
                            tside=-1.0 if rng.random() < 0.5 else 1.0,
                            cside=-1.0 if rng.random() < 0.5 else 1.0,
                            bedk=float(rng.uniform(0.35, 1.4)),
                            chop=float(rng.uniform(0.0, 0.08)) * H,
                            cslope=float(rng.uniform(0.6, 1.1)),
                            sz=float(rng.uniform(0.3, 0.75)) * H,
                            sgx=float(rng.uniform(0.9, 1.6)), sgz=float(rng.uniform(0.18, 0.4)),
                            sdepth=float(rng.uniform(0.25, 0.5)) * hw))
        cleft = []
        cut_has = [((depth_of[k] if k < len(depth_of) else 1.0) > 0) for k in range(len(cuts))]
        for i, c in enumerate(col):
            c['bev_l'] = 1.0 if i == 0 or cut_has[i - 1] else 0.15
            c['bev_r'] = 1.0 if i == cols - 1 or cut_has[i] else 0.15
        for k, x0 in enumerate(cuts):
            dk = depth_of[k] if k < len(depth_of) else 1.0
            if dk <= 0:
                continue
            cleft.append(dict(x=x0, d=float(rng.uniform(3.6, 5.5)), w=float(rng.uniform(1.8, 3.0)),
                              arc=float(rng.uniform(-2.2, 2.2)), ph=float(rng.uniform(0, TAU)),
                              z_end=H * (1.0 - dk)))
        n_lift = int(math.ceil(H * 1.15 / ROCK_LIFT)) + 1
        # The lift lines: about half are strong beds (a ledge stepping back,
        # a drip-edge over the face below), the rest only in the paint (the
        # runtime's world beds, so the face is never banded like a barrel).
        strong = rng.random(n_lift) < 0.42
        steps = np.where(strong, rng.uniform(*setback, n_lift), 0.0)
        steps[0] = 0.0
        backs = np.cumsum(steps)
        lips = np.where(strong, rng.uniform(*lip, n_lift) * 0.2, 0.0)
        wave_ph = float(rng.uniform(0, TAU))

        def front_v(X, Z):
            # The face's line: one slow swell across (never a wiggle), a
            # gentle batter, the columns' planes, the beds stepping back lift
            # by lift, the clefts, the ends turned back.
            u = np.maximum(Z, 0.0) / ROCK_LIFT
            i = np.clip(np.floor(u).astype(np.int64), 0, n_lift - 1)
            fr = u - np.floor(u)
            out = 0.9 * np.sin(X / W * 3.4 + wave_ph) + 0.5 * nf.fbm(X * 0.03, 0.0, Z * 0.025, 2) + Z * lean * 0.4
            # Each line a step back over a short slope (a lit ledge), its
            # strong lines with a drip-edge just under them.
            beds = backs[i] + (steps[np.minimum(i + 1, n_lift - 1)]) * _sstep(0.93, 1.0, fr)
            beds = beds - lips[i] * _sstep(0.8, 0.9, fr) * (1.0 - _sstep(0.97, 1.0, fr))
            # Each column takes the beds its own way (a deep ledge on one, a
            # shallow one on the next: the line runs on, never a belt).
            bedk = np.ones_like(X)
            for c in col:
                bedk = np.where((X >= c['a'] - 1e-6) & (X <= c['b'] + 1e-6), c['bedk'], bedk)
            out = out + beds * bedk
            # The columns: a plane each, its edges bevelled back.
            colv = np.zeros_like(X)
            for c in col:
                inside = (X >= c['a'] - 1e-6) & (X <= c['b'] + 1e-6)
                e = np.abs(X - c['c']) / c['hw']
                # Bevelled back only toward a cleft or the piece's end (two
                # columns meeting without a cleft just crease, so the face
                # reads as one great mass, never a row of pillars).
                side_r = (X - c['c']) > 0
                bevel = np.where(side_r, c['bev_r'], c['bev_l'])
                v = (c['off'] + c['tilt'] * (X - c['c'])
                     + bevel * np.maximum(0.0, e - c['bev']) * c['hw'] * c['bslope'])
                if c['shave']:
                    # A great fracture plane taking one corner off from
                    # partway up (a crisp oblique facet catching the light).
                    edge = c['c'] + c['sside'] * c['hw']
                    cut = (c['sside'] * (X - edge) + c['sdepth']) * c['sgx'] + (Z - c['sz']) * c['sgz'] + c['off']
                    v = np.maximum(v, np.where(Z > c['sz'] - 6.0, cut, -1e3))
                colv = np.where(inside, v, colv)
            out = out + colv
            # The clefts: a deep V wandering in one gentle arc, widening up.
            for c in cleft:
                xc = c['x'] + c['arc'] * np.sin(Z / H * 2.2 + c['ph'])
                w = c['w'] * (0.7 + 0.6 * np.clip(Z / H, 0, 1))
                v = np.maximum(0.0, 1.0 - np.abs(X - xc) / w) ** 1.2
                out = out + c['d'] * v * _sstep(c['z_end'] - 4.0, c['z_end'] + 2.0, Z)
            # The ends turn back into the mountain (a piece left at a run's
            # end shows rock falling away, never a cut).
            # Gently at first, so a neighbour's face crosses it in a crease
            # (a dark notch at every join read as one more cleft).
            t = np.abs(X) / (W / 2)
            out = out + np.maximum(0.0, t - 0.78) * 4.0 + np.maximum(0.0, t - 0.9) ** 1.5 * D * 7.0
            return out

        def front(x, z):
            return float(front_v(np.array([x], dtype=np.float64), np.array([z], dtype=np.float64))[0])

        f.put('g0', Body(front_v, lo, hi, D), 0.0)
        # The crest: each column a table of its own, tipped one way, falling
        # back into the mountain (never a dome or a bullet), notched at the
        # clefts.
        yr = D * 0.55

        def top_v(X, Y):
            z = np.zeros_like(X) + col[0]['top']
            for c in col:
                inside = (X >= c['a'] - 1e-6) & (X <= c['b'] + 1e-6)
                e = np.clip(np.abs(X - c['c']) / c['hw'], 0, 1)
                if crown == 'dome':
                    zc = H * (0.97 - 0.16 * (X / (W / 2)) ** 2) + (c['top'] - H) * 0.25
                else:
                    # A table tipped one way (its brink a long gentle
                    # slope, never an arch), its far corner knocked off.
                    zc = c['top'] + c['tslope'] * (X - c['c'])
                    if crown == 'shoulder':
                        zc = zc - 0.12 * H * np.maximum(0.0, c['tside'] * (X - c['c']) / c['hw'] - 0.55)
                if crown != 'dome':
                    # A great chop off one corner of the column's top (an
                    # oblique facet: the crest reads broken and angular,
                    # never a pillow).
                    edge = c['c'] + c['cside'] * c['hw']
                    zc = np.minimum(zc, c['top'] - c['chop'] + c['cslope'] * (c['hw'] - c['cside'] * (X - c['c'])))
                z = np.where(inside, zc, z)
            for c in cleft:
                z = z - 0.045 * H * np.maximum(0.0, 1.0 - np.abs(X - c['x']) / (c['w'] * 4.5)) ** 1.5
            # The ends fall away in one straight chop each (never a rounded
            # shoulder).
            z = np.minimum(z, H * 0.7 + (W / 2 - np.abs(X)) * 1.6) + 0.6 * nf.fbm(X * 0.05 + 3.0, Y * 0.05, 1.0, 2)
            return z - np.maximum(0.0, yr - Y) * 0.02 - np.maximum(0.0, Y - yr) * fall

        X3, Y3, Z3 = _axes(f)
        Xa = X3 + 0 * Y3
        Ya = Y3 + 0 * X3
        f.d = np.maximum(f.d, ((Z3 - top_v(Xa, Ya)) * 0.6).astype(np.float32))
        # The small work, only round the clefts (the eye goes to the dark
        # cut; the planes between are left quiet).
        for c in cleft:
            for _ in range(detail):
                side = -1.0 if rng.random() < 0.5 else 1.0
                sx = c['x'] + side * float(rng.uniform(c['w'] + 0.8, c['w'] + 3.5))
                pts = []
                z = float(rng.uniform(0.45, 0.95)) * H
                z_end = max(c['z_end'], z - float(rng.uniform(10.0, 22.0)))
                while z > z_end:
                    pts.append((sx, front(sx, z) - 0.05, z))
                    sx += float(rng.uniform(-0.35, 0.35))
                    z -= float(rng.uniform(1.6, 3.0))
                if len(pts) > 1:
                    for dy in (0.3, 1.2):
                        f.groove(Polyline([(x, y + dy, zz) for (x, y, zz) in pts], 0.07), 0.35, 0.14)
            if detail > 1:
                # A short parting across a bed beside the cleft.
                for _ in range(2):
                    side = -1.0 if rng.random() < 0.5 else 1.0
                    li = int(rng.integers(1, max(2, int(H / ROCK_LIFT))))
                    pz = li * ROCK_LIFT - float(rng.uniform(3.0, 6.0))
                    x0 = c['x'] + side * (c['w'] + 0.5)
                    x1 = x0 + side * float(rng.uniform(4.0, 8.0))
                    f.groove(Polyline([(x0, front(x0, pz) - 0.05, pz),
                                       (x1, front(x1, pz + 0.3) - 0.05, pz + 0.3)], 0.05), 0.28, 0.12)
        weather(f, seed, amp=0.16, band=2.0, broad=0.45)
        clamp_below(f, 0.0)
        f.cleft_xs = [c['x'] for c in cleft]
        return f

    f = _sculpt_once(key or name, build)
    rng = np.random.default_rng(seed + 77)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    # Scree only at the clefts' feet, on the ledges (the detail clusters).
    if scree_n:
        for x in getattr(f, 'cleft_xs', [])[:3]:
            scree(p, f, rng, x - 4.0, x + 4.0, 0.6, 8.0, H * 1.2, scree_n, size=(0.6, 1.8))
    # A breath behind the plane (the far build's coarser mesh bulges a
    # little past the sculpt's own front).
    p.front_zero = front_of(f) - 0.15
    p.open_back = True
    return p


def rock_lip_calm(bpy, p, name, seed, W, H, D, out=0.38, target=1100, voxel=0.2, key=None):
    """A module of a walk's side where it falls into the chasm (phase 2G: the
    calm grammar of rock_wall). Hanging from the lip (origin on it, z 0;
    nothing above z -0.05), down H yards, the face leaning OUT over the void
    by `out` per yard of drop; in a few tall lifts, each stepping out from
    the one above (a lit ledge seen from the walk), one cleft at most, a
    great spall, a worn brink rounding over. Returns p."""
    def build():
        rng = np.random.default_rng(seed)
        lo = (-W / 2 - 2.5, -out * H - 4.0, -H - 0.6)
        hi = (W / 2 + 2.5, D + 1.5, 1.0)
        f = Sculpt(lo, hi, voxel)
        nf = Noise(seed + 3)
        lift = float(rng.uniform(8.0, 11.0))
        n_lift = int(math.ceil(H / lift)) + 1
        steps = np.concatenate([[0.0], np.cumsum(rng.uniform(0.5, 1.2, n_lift))])
        cx = float(rng.uniform(-W * 0.25, W * 0.25))
        has_cleft = rng.random() < 0.6
        cd = float(rng.uniform(2.0, 3.2))

        def front_v(X, Z):
            u = np.maximum(-Z, 0.0) / lift
            i = np.clip(np.floor(u).astype(np.int64), 0, n_lift - 1)
            v = (Z * out * 0.72 - 0.8 + 0.6 * np.sin(X / W * 3.0 + seed) + 0.5 * nf.fbm(X * 0.04, 0.0, Z * 0.03, 2)
                 - steps[i] + np.maximum(0.0, np.abs(X) - (W / 2 - 3.0)) * (2.2 - Z * out * 0.35))
            if has_cleft:
                xc = cx + 1.2 * np.sin(Z / H * 2.0 + seed)
                v = v + cd * np.maximum(0.0, 1.0 - np.abs(X - xc) / 1.8) ** 1.3
            return v

        f.put('g0', Body(lambda X, Z: front_v(X, Z) + 0.5, lo, hi, D, half=W / 2 + 1.0), 0.0)
        for _ in range(int(rng.integers(1, 3))):
            side = -1.0 if rng.random() < 0.5 else 1.0
            ex = side * float(rng.uniform(W * 0.15, W * 0.4))
            ez = -float(rng.uniform(4.0, H * 0.7))
            fy = float(front_v(np.array([ex]), np.array([ez]))[0])
            wedge(f, rng, (ex, fy - 0.2, ez), (side * 0.6, -1.0, float(rng.uniform(-0.6, 0.2))),
                  float(rng.uniform(2.5, 4.5)), k=0.12)
        weather(f, seed, amp=0.16, broad=0.45)
        _X, Y, Z = _axes(f)
        out_of = np.maximum(0.0, -Y - 0.2)
        top = -0.05 - 1.5 * out_of - 0.25 * out_of ** 2
        cut = np.where(Z > -7.0, (Z - top) * 0.8, -50.0)
        f.d = smax(f.d, (cut + np.zeros_like(f.d)).astype(np.float32), 0.35)
        clamp_below(f, -H)
        return f

    f = _sculpt_once(key or name, build)
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, ROCK_COLOURS, ROCK_KINDS, smooth=True)
    p.open_back = True
    return p
