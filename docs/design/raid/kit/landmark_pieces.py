"""The Anvil of the World's wall landmarks (phases 2M and 2N,
build_smith_heart_heart_kit.py): one great formation of each element past
the platform's rim, so the quarter reads at a glance from anywhere in the
room (the element lives on the edges; the floor is one common stone).

Phase 2N made them the outer wall of their quarter: each runs along the rim
from just past the seam's horn behind it (`SPAN`, degrees round from its
altar's bearing) nearly to the next, its mountain rock heaved into a long
broken cliff (low at the lip, climbing back to the crown), its element
bursting out of it:

  - Kit_LandmarkHeat: a molten mass of the Hearth's dark basalt, columns
    heaved up in great bundles, a crater of lava at the tallest, lava
    running down its face in channels and falling into the chasm in five
    falls (three over the lip, one off each flank), veins of fire in the
    rock.
  - Kit_LandmarkHammer: a stepped cliff of ochre granite blocks split by
    four great clusters of golden crystal (the greatest bursting toward the
    platform behind the altar), gold seams down every face.
  - Kit_LandmarkQuench: a frost-granite cliff under a forest of great ice
    spires (the ice slot), its faces hung with frozen falls that run on
    down the keel into the chasm, rime on every ledge.
  - Kit_LandmarkBreath: storm stone split down its middle by the storm,
    the split's walls veined violet, its halves rising into great twisted
    horns curling toward each other over the split (the runtime's
    lightning arcs between their tips), lesser horns along the wall.

Each stands wholly past the rim (r > 60.4: never over the walk; the altar at
its foot is the one solid a body meets), its foot buttressed down into the
chasm under the platform's lip. Frames: every piece at the platform's centre
on its walk (Blender -Y the game's north), placed unturned, its formation
round its own bearing (quarter_geom.LANDMARKS). Glow slot: pale grey the
runtime tints with the quarter's light and blazes when the quarter wakes.
The signature spots and the Breath's horns are mirrored by
src/render/smith_heart/heart_landmarks_core.ts (the same numbers).
Deterministic: every draw is the piece's own seeded rng or a seeded noise.
"""
import math

import numpy as np
import quarter_geom as qg
from gravewyrm_sculpt import Sculpt, block
from gwkit import crystal, hull
from heart_pieces import HEART_COLOURS, HEART_KINDS, HSP, ICE, ICE_BODY, ICE_DEEP, RIME, ASH, _clamp, pale_crystal
from heat_pieces import _bundle_layout, hex_column
from hckit import GLOW
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, rot
from mathutils import Vector
from quarter_pieces import ribbon, strip
from ring_sculpt import _weather
from shkit import PAINT, TAU, RAW

LANDMARK_COLOURS = dict(HEART_COLOURS)
LANDMARK_COLOURS.update({
    'lava_crust': (0.13, 0.1, 0.09), 'scorch': (0.32, 0.12, 0.06), 'gold_g': (0.6, 0.47, 0.3),
    'gold_g2': (0.5, 0.39, 0.26), 'frost_hi': (0.74, 0.79, 0.85), 'storm_v': (0.4, 0.37, 0.48),
    'storm_t': (0.32, 0.38, 0.42), 'base': (0.2, 0.18, 0.19), 'base2': (0.25, 0.22, 0.22),
    'ember_rock': (0.24, 0.12, 0.08), 'ochre_hi': (0.7, 0.55, 0.34), 'frost_deep': (0.42, 0.47, 0.55),
    'storm_hi': (0.5, 0.47, 0.58),
})
LANDMARK_KINDS = dict(HEART_KINDS)
LANDMARK_KINDS.update({k: RAW for k in ('lava_crust', 'scorch', 'gold_g', 'gold_g2', 'frost_hi', 'storm_v',
                                        'storm_t', 'base', 'base2', 'ember_rock', 'ochre_hi', 'frost_deep',
                                        'storm_hi')})

# Each landmark's run along the rim (degrees round from its altar's bearing,
# clockwise +): from just past the seam's horn behind it (at -25) nearly to
# the next (at +65); the Hammer's stops short of the Heart Bridge (at +45).
SPAN = {'heat': (-18.0, 50.0), 'hammer': (-18.0, 35.0), 'quench': (-18.0, 50.0), 'breath': (-18.0, 50.0)}
# The cliff's top: at the lip and at the back (yards over the walk).
CLIFF = {'heat': (4.0, 20.0), 'hammer': (4.5, 23.0), 'quench': (3.0, 12.0), 'breath': (3.0, 11.0)}
VOXEL = 0.38
R_LIP = 61.0  # the cliff's foot at the lip (the rim's fascia under it)
R_BACK = 88.0


class Frame:
    """A landmark's frame: `u` yards out from the platform's centre along
    its bearing, `v` across (clockwise), `z` up."""

    def __init__(self, bearing):
        a = math.radians(bearing)
        self.ox, self.oy = math.sin(a), -math.cos(a)
        self.sx, self.sy = math.cos(a), math.sin(a)
        self.bearing = bearing

    def at(self, u, v, z):
        return (self.ox * u + self.sx * v, self.oy * u + self.sy * v, z)

    def vec(self, du, dv, dz):
        return (self.ox * du + self.sx * dv, self.oy * du + self.sy * dv, dz)

    def ad(self, d, r, z):
        """The point `r` out at `d` degrees round from the bearing."""
        a = math.radians(d)
        return self.at(r * math.cos(a), r * math.sin(a), z)

    def yaw(self, d=0.0):
        """The plan angle of the outward direction at `d` (for rot(rz=...))."""
        a = math.radians(self.bearing + d)
        return math.atan2(-math.cos(a), math.sin(a))


def _arc_field(F, d0, d1, r0, r1, z0, z1, voxel=VOXEL):
    pts = []
    for k in range(25):
        d = d0 + (d1 - d0) * k / 24
        for r in (r0, r1):
            pts.append(F.ad(d, r, 0.0))
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    return Sculpt((min(xs) - 4, min(ys) - 4, z0), (max(xs) + 4, max(ys) + 4, z1), voxel)


def _env(vein, d):
    """The cliff's swell along its run: low at both ends, full between."""
    d0, d1 = SPAN[vein]
    a = min(1.0, max(0.0, (d - d0) / 14.0))
    b = min(1.0, max(0.0, (d1 - d) / 14.0))
    return (a * a * (3 - 2 * a)) * (b * b * (3 - 2 * b))


def _top(vein, d, r):
    """The cliff's top at (d, r): low at the lip, climbing to the crown."""
    lo, hi = CLIFF[vein]
    t = min(1.0, max(0.0, (r - R_LIP) / (R_BACK - 6.0 - R_LIP)))
    return (lo + (hi - lo) * t ** 0.8) * (0.4 + 0.6 * _env(vein, d))


def _cliff(f, F, rng, vein, labels, step=4.4, skip=None, stepped=0.0, tilt=0.3):
    """The long broken cliff along the rim: a low core of the mountain's rock
    sunk under the walk, then great heaved blocks of every size, staggered
    in rows climbing back from the lip, leaning back from the platform, the
    skyline rising and falling along the run (never a fence of posts)."""
    d0, d1 = SPAN[vein]
    sky = Noise(int(rng.integers(1, 1 << 20)))
    d = d0 + 3.0
    while d < d1 - 2.0:
        h = _top(vein, d, 76.0)
        f.put(labels[0], Ellipsoid(F.ad(d, 75.0, -9.0), (11.5, 6.0, h * 0.45 + 7.0),
                                   rot(rz=F.yaw(d) + float(rng.uniform(-0.15, 0.15)))), 0.7)
        d += 5.0
    rows = []
    r = R_LIP + 1.4
    while r < R_BACK:
        rows.append(r)
        r += float(rng.uniform(2.6, 4.4))
    for (ri, r) in enumerate(rows):
        d = d0 + float(rng.uniform(0.0, 1.0)) * math.degrees(step / r)
        while d < d1:
            big = rng.random() < 0.22
            w = float(rng.uniform(3.0, 6.2)) * (1.6 if big else 1.0)
            dep = float(rng.uniform(2.8, 5.2)) * (1.4 if big else 1.0)
            if skip is None or not skip(d, r):
                swell = 0.72 + 0.56 * float(sky.fbm(d * 0.09, r * 0.05, 0.3, 2) + 0.5)
                h = _top(vein, d, r) * swell * float(rng.uniform(0.7, 1.08))
                if stepped:
                    h = max(stepped, round(h / stepped) * stepped + float(rng.uniform(-0.5, 0.5)))
                rr = r + float(rng.uniform(-0.9, 0.9))
                c = F.ad(d, rr, h / 2 - 3.0)
                lean = float(rng.uniform(0.02, 0.2))
                f.put(labels[int(rng.integers(0, len(labels)))],
                      block(rng, c, (dep, w, h + 6.0), cuts=14, chamfer=(0.68, 0.95),
                            R=rot(rz=F.yaw(d) + float(rng.uniform(-0.45, 0.45)), ry=lean,
                                  rx=float(rng.uniform(-0.18, 0.18))), top_tilt=tilt), 0.35)
            d += math.degrees(w * float(rng.uniform(0.6, 0.85)) / r)


def _foot(f, F, rng, vein):
    """The foot under the cliff: the mountain's dark rock heaved down past
    the platform's lip into the chasm in broad lobes, tapering to roots."""
    d0, d1 = SPAN[vein]
    d = d0 + 4.0
    k = 0
    while d < d1 - 3.0:
        lab = ('base', 'base2', 'g3')[k % 3]
        f.put(lab, Ellipsoid(F.ad(d, 66.0, -9.0), (7.5, 6.5, 8.0), rot(rz=F.yaw(d), ry=0.25)), 1.4)
        if k % 2 == 0:
            f.put(lab, Polyline([F.ad(d, 66.0, -12.0), F.ad(d, 63.0, -19.0),
                                 F.ad(d + float(rng.uniform(-3, 3)), 60.0, -27.0)], [5.0, 3.4, 1.4]), 1.4)
        for _ in range(2):
            u = float(rng.uniform(62.0, 72.0))
            z = float(rng.uniform(-12.0, -3.0))
            f.put(lab, block(rng, F.ad(d + float(rng.uniform(-3, 3)), u, z),
                             (float(rng.uniform(3.0, 5.0)), float(rng.uniform(3.0, 5.0)), float(rng.uniform(3.0, 5.0))),
                             cuts=12, chamfer=(0.7, 0.94),
                             R=rot(rz=float(rng.uniform(0, TAU)), rx=float(rng.uniform(-0.4, 0.4)))), 0.4)
        d += 6.0
        k += 1


def _finish(f, F, seed, amp=0.22):
    """Weather it, keep it off the walk and the air beyond its own."""
    _weather(f, seed, amp=amp, scale=0.3, band=0.9)
    _weather(f, seed + 7, amp=amp * 1.7, scale=0.1, band=1.3)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    R = np.sqrt(X * X + Y * Y)
    # Never over the walk: past the rim's fascia only (its foot meets the
    # rim's outer face; under the lip it tucks in on a slope).
    _clamp(f, np.where(R < qg.RIM_R + 0.7, Z + (qg.RIM_R + 0.7 - R) * 3.0, -1e3))
    f.cut_below(-30.0)


def _mesh(bpy, p, f, name, target):
    import gravewyrm_sculpt as gs
    from gwkit import add_sculpt
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, LANDMARK_COLOURS, LANDMARK_KINDS, smooth=False)


def _tree(p):
    from mathutils.bvhtree import BVHTree
    return BVHTree.FromBMesh(p.bm)


def _drape(tree, x, y, z_top=60.0):
    hit = tree.ray_cast(Vector((x, y, z_top)), Vector((0.0, 0.0, -1.0)), z_top + 60.0)
    return None if hit[0] is None else (hit[0], hit[1])


def _glow_line(p, pts, w, shade=1.0):
    """A line of light laid over a surface (pts with z), its faces up."""
    for q0, q1 in zip(pts, pts[1:]):
        strip(p, (q0[0], q0[1]), (q1[0], q1[1]), w, q0[2] + 0.04, (shade, shade, shade), slot=GLOW,
              z1=q1[2] + 0.04)


def _vein_net(p, tree, F, rng, vein, n, w=(0.12, 0.22), shade=0.85, r=(63.0, 82.0)):
    """Veins of the element's light down the cliff's faces (draped lines
    wandering down toward the lip)."""
    d0, d1 = SPAN[vein]
    for _ in range(n):
        d = float(rng.uniform(d0 + 4, d1 - 4))
        rr = float(rng.uniform(*r))
        pts = []
        while rr > R_LIP + 0.6:
            h = _drape(tree, *F.ad(d, rr, 0.0)[:2])
            if h:
                pts.append((h[0].x, h[0].y, h[0].z))
            rr -= 0.5
            d += float(rng.uniform(-0.5, 0.5))
        if len(pts) > 5:
            _glow_line(p, pts, float(rng.uniform(*w)), shade)


def _keep_off_walk(foot, d, L, r_min=62.4):
    """A crystal's direction from `foot`, its lean toward the platform eased
    until its tip (and its girth) stays past the rim."""
    v = Vector(d).normalized()
    for _ in range(16):
        tip = Vector(foot) + v * L
        if math.hypot(tip.x, tip.y) >= r_min:
            break
        out = Vector((tip.x, tip.y, 0.0)).normalized()
        v = (v + out * 0.25).normalized()
    return tuple(v)


def _z_near(pts, q):
    best = None
    bd = 1e9
    for r in pts:
        dd = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2
        if dd < bd:
            bd, best = dd, r
    return best[2]


def _fall(p, pts, w, side, shade=0.95):
    """A sheet falling (lava or glowing ice-melt): its faces across `side`
    (a plan unit vector), drawn both ways."""
    bm = p.bm
    faces = []
    tone = {}
    sx, sy = side
    for s in (0, 1):
        rows = []
        for k, q in enumerate(pts):
            ww = w * 0.5 * (1.0 + 0.7 * k / len(pts))
            a = bm.verts.new((q[0] - sx * ww, q[1] - sy * ww, q[2]))
            b = bm.verts.new((q[0] + sx * ww, q[1] + sy * ww, q[2]))
            tone[a] = tone[b] = shade - 0.5 * k / len(pts)
            rows.append((a, b) if s == 0 else (b, a))
        for k in range(len(rows) - 1):
            faces.append(bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0])))
    p._paint(faces, (1.0, 1.0, 1.0), GLOW)
    for fc in faces:
        for loop in fc.loops:
            g = tone[loop.vert]
            loop[p.col] = (g, g, g, 1.0)


def _river(p, tree, F, path, w):
    """Lava down a channel: draped along `path` ((d, r) pairs), a ribbon of
    light; returns its last point."""
    pts = []
    for (d, r) in path:
        for t in range(3):
            rr = r - t * 0.45
            if rr < qg.RIM_R + 1.8:
                continue
            h = _drape(tree, *F.ad(d, rr, 0.0)[:2])
            if h:
                pts.append((h[0].x, h[0].y, h[0].z))
    if len(pts) < 3:
        return None
    ribbon(p, [(q[0], q[1]) for q in pts], w, lambda q, pts=pts: _z_near(pts, q) + 0.08, (1.0, 1.0, 1.0),
           slot=GLOW, edge=(0.55, 0.55, 0.55), taper=False)
    return pts[-1]


def _lip_fall(p, F, d, z_top, w, length=34.0):
    """A fall over the platform's lip, down the keel into the chasm."""
    u_end = qg.RIM_R + 0.9
    top = F.ad(d, u_end, 0.0)
    fall = [(top[0], top[1], z_top)]
    n = 18
    for k in range(1, n):
        z = z_top - k * length / n
        o = F.ad(d, u_end + 0.3 * k ** 0.6, z)
        fall.append(o)
    a = math.radians(F.bearing + d)
    _fall(p, fall, w, (math.cos(a), math.sin(a)))


def _flank_fall(p, F, d, r, z_top, w, out, length=36.0):
    """A fall off a flank into the chasm beside the platform: from (d, r)
    at z_top, leaping out `out` degrees round and dropping."""
    fall = []
    n = 18
    for k in range(n):
        t = k / (n - 1)
        fall.append(F.ad(d + out * min(1.0, t * 3.0), r + 1.5 * t, z_top - length * t ** 1.2))
    a = math.radians(F.bearing + d)
    _fall(p, fall, w, (math.sin(a), -math.cos(a)))


# ================================================================ the Heat
HEAT_BUNDLES = ((4.0, 74.0, 8.5, 25.0), (-9.0, 71.0, 6.0, 14.0), (21.0, 76.0, 7.5, 20.0), (37.0, 73.0, 6.5, 13.0))
HEAT_CRATER = (4.0, 74.0, 23.5)


def landmark_heat(bpy):
    F = Frame(qg.LANDMARKS['heat'])
    p = HSP('Kit_LandmarkHeat', seed=6901, ao=0.5, ao_dist=2.2, dust=0.0)
    rng = np.random.default_rng(6901)
    d0, d1 = SPAN['heat']
    f = _arc_field(F, d0, d1, 59.0, 92.0, -31.0, 31.0)
    _foot(f, F, rng, 'heat')
    _cliff(f, F, rng, 'heat', ('basalt', 'basalt2', 'lava_crust', 'ember_rock'))
    # The basalt heaved up in great bundles of columns, tallest at the
    # crater, leaning out and broken.
    for (bd, br, rad, top) in HEAT_BUNDLES:
        a = math.radians(bd)
        cu, cv = br * math.cos(a), br * math.sin(a)
        for (lu, lv) in _bundle_layout(rng, rad, 1.25, centre=(0.0, 0.0), jitter=0.22):
            u = cu + lu
            v = cv + lv
            if math.hypot(*F.at(u, v, 0.0)[:2]) < 62.0:
                continue
            k = 1.0 - math.hypot(lu, lv) / rad
            hgt = top * (0.45 + 0.55 * k) + float(rng.uniform(-1.8, 1.4))
            c = F.at(u, v, 0.0)
            f.put(('basalt', 'basalt2', 'basalt', 'ember_rock')[int(rng.integers(0, 4))],
                  hex_column((c[0], c[1]), float(rng.uniform(1.05, 1.35)), -6.0, max(2.5, hgt),
                             phase=float(rng.uniform(0, 1)),
                             tilt=(float(rng.uniform(-0.1, 0.1)), float(rng.uniform(-0.1, 0.1))),
                             top_tilt=(float(rng.uniform(-0.4, 0.4)), float(rng.uniform(-0.4, 0.4)))), 0.08)
    # Crusted boulders heaved down the face toward the lip.
    for _ in range(18):
        d = float(rng.uniform(d0 + 4, d1 - 4))
        f.put('lava_crust', block(rng, F.ad(d, float(rng.uniform(62.5, 67.0)), float(rng.uniform(0.2, 2.0))),
                                  (float(rng.uniform(2.2, 3.8)), float(rng.uniform(2.0, 3.4)),
                                   float(rng.uniform(1.8, 3.0))), cuts=12, chamfer=(0.7, 0.95),
                                  R=rot(rz=float(rng.uniform(0, TAU)), ry=float(rng.uniform(-0.3, 0.3)))), 0.3)
    # The crater and the channels the lava runs down.
    cd, cr, cz = HEAT_CRATER
    f.sub(Ellipsoid(F.ad(cd, cr, cz + 1.0), (5.2, 6.2, 3.4)), 0.9)
    channels = [[(4.0, 72.0, 21.0), (2.5, 68.0, 12.0), (1.0, 64.5, 5.0), (0.0, 61.2, 0.6)],
                [(6.5, 72.0, 21.0), (9.0, 68.0, 11.0), (11.0, 64.5, 4.5), (12.0, 61.2, 0.6)],
                [(1.5, 73.5, 21.0), (-4.0, 70.0, 11.0), (-8.0, 66.0, 5.0), (-10.0, 61.2, 0.6)],
                [(21.0, 74.0, 17.0), (23.0, 69.0, 9.0), (24.0, 64.5, 4.0), (25.0, 61.2, 0.6)]]
    for ch in channels:
        f.sub(Polyline([F.ad(*q) for q in ch], [1.6, 1.7, 1.5, 1.2]), 0.5)
    _finish(f, F, 6903, amp=0.26)
    _mesh(bpy, p, f, 'LandmarkHeat', 11800)
    tree = _tree(p)
    prng = p.rng
    # The crater's pool.
    hit = _drape(tree, *F.ad(cd, cr, 0.0)[:2])
    zc = hit[0].z + 0.06 if hit else cz
    bm = p.bm
    centre = bm.verts.new((*F.ad(cd, cr, 0.0)[:2], zc))
    ring = []
    for k in range(32):
        a = TAU * k / 32
        q = F.at(cr * math.cos(math.radians(cd)) + math.cos(a) * 3.6,
                 cr * math.sin(math.radians(cd)) + math.sin(a) * 4.4, 0.0)
        ring.append(bm.verts.new((q[0], q[1], zc)))
    faces = [bm.faces.new((centre, ring[k], ring[(k + 1) % len(ring)])) for k in range(len(ring))]
    p._paint(faces, (1.0, 1.0, 1.0), GLOW)
    for fc in faces:
        for loop in fc.loops:
            g = 1.0 if loop.vert is centre else 0.72
            loop[p.col] = (g, g, g, 1.0)
    p.facing(faces, (0, 0, 1))
    # The rivers down the channels to the lip, each falling into the chasm.
    for j, ch in enumerate(channels):
        path = [(ch[0][0] + (ch[-1][0] - ch[0][0]) * t / 14.0, ch[0][1] + (ch[-1][1] - ch[0][1]) * t / 14.0)
                for t in range(15)]
        last = _river(p, tree, F, path, 2.2 if j < 2 else 1.6)
        if last:
            _lip_fall(p, F, ch[-1][0], min(last[2], 0.4), 2.6 if j < 2 else 1.9)
    # The flanks: lava pouring off each end of the mass into the chasm.
    for (d, out) in ((d0 + 4.0, -3.0), (d1 - 4.0, 3.0)):
        path = [(d + out * 0.1 * t, 70.0 - t * 0.6) for t in range(10)]
        last = _river(p, tree, F, path, 1.6)
        z = last[2] if last else 3.0
        _flank_fall(p, F, d + out * 0.9, 64.5, z, 2.4, out * 0.5)
    _vein_net(p, tree, F, prng, 'heat', 18, w=(0.14, 0.26), shade=0.8)
    # Fire crystal bursting out round the crater and between the bundles.
    for _ in range(16):
        bd, br, rad, top = HEAT_BUNDLES[int(prng.randrange(len(HEAT_BUNDLES)))]
        a = float(prng.uniform(0, TAU))
        d = bd + math.degrees(math.cos(a) * rad * 0.8 / br)
        r = br + math.sin(a) * rad * 0.8
        h = _drape(tree, *F.ad(d, r, 0.0)[:2])
        if not h:
            continue
        with p.as_kind(PAINT):
            pale_crystal(p, (h[0].x, h[0].y, h[0].z - 0.3),
                         (float(prng.uniform(-0.4, 0.4)), float(prng.uniform(-0.4, 0.4)), 1.0),
                         float(prng.uniform(1.2, 3.2)), float(prng.uniform(0.3, 0.6)), bright=0.2)
    # Ash on the column heads.
    with p.as_kind(PAINT):
        for _ in range(26):
            h = _drape(tree, *F.ad(float(prng.uniform(d0 + 4, d1 - 4)), float(prng.uniform(64.0, 84.0)), 0.0)[:2])
            if h and h[1].z > 0.8:
                crystal(p, (h[0].x, h[0].y, h[0].z + 0.02), (1.2, 1.0, 0.12), p.vary(ASH, 0.05), n=16, boxy=1.0,
                        jitter=0.05, yaw=float(prng.uniform(0, TAU)))
    return p


# ================================================================ the Hammer
HAMMER_CLUSTERS = (  # (d, r, z, n, main height, main radius, lean (radial, across))
    (0.0, 68.0, 1.5, 14, 16.0, 2.3, (-0.3, 0.0)),
    (17.0, 72.0, 10.5, 10, 11.0, 1.6, (-0.4, 0.3)),
    (-10.0, 73.0, 9.0, 9, 10.0, 1.5, (-0.4, -0.35)),
    (29.0, 69.5, 6.5, 9, 9.0, 1.4, (-0.5, 0.25)),
)


def landmark_hammer(bpy):
    F = Frame(qg.LANDMARKS['hammer'])
    p = HSP('Kit_LandmarkHammer', seed=6911, ao=0.5, ao_dist=2.2, dust=0.3)
    rng = np.random.default_rng(6911)
    d0, d1 = SPAN['hammer']
    f = _arc_field(F, d0, d1, 59.0, 92.0, -31.0, 30.0)
    _foot(f, F, rng, 'hammer')
    # The crag: great blocks of ochre granite heaved up in steps, tallest at
    # the back, split where the crystal forced them apart.
    _cliff(f, F, rng, 'hammer', ('ochre', 'gold_g', 'ochre2', 'gold_g2', 'ochre_hi'), step=4.8, stepped=3.2,
           tilt=0.22)
    for (cd, cr, cz, *_rest) in HAMMER_CLUSTERS:
        f.sub(Ellipsoid(F.ad(cd, cr, cz + 3.0), (3.6, 3.2, 6.0)), 0.6)
    _finish(f, F, 6913, amp=0.18)
    _mesh(bpy, p, f, 'LandmarkHammer', 11800)
    tree = _tree(p)
    prng = p.rng
    # The golden crystal clusters: the great one out of the cleft toward the
    # platform behind the altar, three more along the wall.
    for (cd, cr, cz, n, hh, rr, (lu, lv)) in HAMMER_CLUSTERS:
        base = F.ad(cd, cr, cz)
        a0 = math.radians(cd)
        # The lean, turned into the frame at the cluster's bearing.
        dl = (lu * math.cos(a0) - lv * math.sin(a0), lu * math.sin(a0) + lv * math.cos(a0))
        dlw = F.vec(dl[0], dl[1], 0.9)
        for k in range(n):
            a = TAU * k / n + float(prng.uniform(-0.3, 0.3))
            spread = 0.0 if k == 0 else 0.6
            d = (dlw[0] + math.cos(a) * spread, dlw[1] + math.sin(a) * spread, dlw[2] + (0.3 if k == 0 else 0.0))
            off = (float(prng.uniform(-0.8, 0.8)), float(prng.uniform(-0.8, 0.8)))
            L = hh * (1.0 if k == 0 else float(prng.uniform(0.4, 0.7)))
            foot = (base[0] + off[0], base[1] + off[1], base[2])
            d = _keep_off_walk(foot, d, L)
            with p.as_kind(PAINT):
                pale_crystal(p, foot, d, L, rr * (1.0 if k == 0 else float(prng.uniform(0.45, 0.7))),
                             bright=0.15 if k == 0 else 0.0)
    for _ in range(28):
        h = _drape(tree, *F.ad(float(prng.uniform(d0 + 3, d1 - 3)), float(prng.uniform(62.5, 84.0)), 0.0)[:2])
        if not h or h[0].z < 1.0:
            continue
        with p.as_kind(PAINT):
            pale_crystal(p, (h[0].x, h[0].y, h[0].z - 0.2),
                         (float(prng.uniform(-0.5, 0.5)), float(prng.uniform(-0.5, 0.5)), 1.0),
                         float(prng.uniform(1.0, 2.6)), float(prng.uniform(0.2, 0.42)))
    # Gold seams down the blocks' faces (the vein's light in the stone).
    _vein_net(p, tree, F, prng, 'hammer', 18, w=(0.12, 0.2), shade=0.85)
    return p


# ================================================================ the Quench
QUENCH_SPIRES = (  # (d, r, height, width, lean (radial, across))
    (2.0, 73.0, 30.0, 4.2, (0.06, 0.0)), (-4.0, 70.0, 22.0, 3.4, (-0.04, -0.14)),
    (8.0, 70.5, 24.0, 3.6, (-0.04, 0.16)), (-11.0, 74.0, 17.0, 3.0, (0.05, -0.2)),
    (14.0, 75.0, 19.0, 3.2, (0.08, 0.22)), (4.0, 79.0, 26.0, 3.8, (0.12, 0.0)),
    (-1.0, 66.5, 11.0, 2.4, (-0.22, -0.08)), (6.0, 66.0, 12.0, 2.5, (-0.24, 0.1)),
    (31.0, 74.0, 21.0, 3.4, (0.05, -0.12)), (37.0, 71.0, 16.0, 2.9, (-0.05, 0.16)),
    (26.0, 70.0, 13.0, 2.6, (-0.12, -0.15)), (43.0, 75.0, 14.0, 2.8, (0.1, 0.2)),
    (34.0, 79.0, 19.0, 3.2, (0.12, 0.0)), (-15.0, 69.0, 9.0, 2.2, (0.0, -0.22)),
)
QUENCH_FALLS = (-12.0, 16.0, 30.0, 45.0)


def _spire(p, prng, base, d, h, w):
    """A great faceted ice spire: an uneven hexagonal shaft, its waist and
    shoulder stepped, a slanted break or a point at its head; shards round
    its foot."""
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    fwd = d.cross(side).normalized()
    broken = prng.random() < 0.25
    rings = ((0.0, 1.0), (0.32, 0.94), (0.62, 0.74), (0.84 if not broken else 0.93, 0.5 if not broken else 0.62))
    pts = []
    tw = float(prng.uniform(0, TAU))
    for (t, k) in rings:
        c = base + d * h * t
        for j in range(6):
            a = tw + TAU * j / 6 + float(prng.uniform(-0.12, 0.12))
            rr = w * 0.5 * k * float(prng.uniform(0.86, 1.12))
            pts.append(c + side * math.cos(a) * rr + fwd * math.sin(a) * rr)
    if broken:
        top = base + d * h * 0.97
        for j in range(3):
            pts.append(top + side * float(prng.uniform(-0.3, 0.3)) * w + fwd * float(prng.uniform(-0.3, 0.3)) * w
                       + Vector((0, 0, float(prng.uniform(-0.6, 0.5)))))
    else:
        pts.append(base + d * h + side * float(prng.uniform(-0.15, 0.15)))
    hull(p, [tuple(q) for q in pts], p.vary(ICE_BODY if prng.random() < 0.6 else ICE_DEEP, 0.05), mat=ICE)
    for j in range(5):
        a = float(prng.uniform(0, TAU))
        fb = base + side * math.cos(a) * w * 0.7 + fwd * math.sin(a) * w * 0.7
        dd = (d * 0.6 + side * math.cos(a) * 0.5 + fwd * math.sin(a) * 0.5).normalized()
        L = h * float(prng.uniform(0.16, 0.3))
        ww = w * 0.24
        sp = [fb + side * ww * math.cos(TAU * q / 5) + fwd * ww * math.sin(TAU * q / 5) for q in range(5)]
        sp.append(fb + dd * L)
        hull(p, [tuple(q) for q in sp], p.vary(ICE_BODY, 0.06), mat=ICE)


def _frozen_fall(p, prng, F, tree, d, width=7.0):
    """A frozen fall: a curtain of long icicles side by side down the
    cliff's face from its brow, over the lip and on down the keel into the
    chasm (the ice slot), a bright seam of melt in its heart (glow)."""
    n = int(width / 0.8)
    a = math.radians(F.bearing + d)
    for k in range(n):
        t = (k + 0.5) / n
        dd = d + math.degrees((t - 0.5) * width / 64.0)
        mid = 1.0 - abs(t - 0.5) * 2.0
        hit = _drape(tree, *F.ad(dd, 65.5, 0.0)[:2])
        z_top = (hit[0].z if hit else 6.0) + 0.3
        # Down the face to the lip, then hanging down the keel.
        top = Vector(F.ad(dd, 64.6, z_top))
        lip = Vector(F.ad(dd, qg.RIM_R + 0.75, 0.2))
        L = 10.0 + 22.0 * mid * float(prng.uniform(0.6, 1.0))
        bot = Vector(F.ad(dd, qg.RIM_R + 1.1, -L))
        ww = float(prng.uniform(0.45, 0.8)) * (0.7 + 0.5 * mid)
        s = Vector((math.cos(a), math.sin(a), 0.0)) * ww
        o = Vector((math.sin(a), -math.cos(a), 0.0)) * ww * 0.8
        hull(p, [tuple(top + s), tuple(top - s), tuple(top + o), tuple(lip + s * 0.9), tuple(lip - s * 0.9),
                 tuple(lip + o)], p.vary(ICE_BODY if prng.random() < 0.7 else RIME, 0.05), mat=ICE)
        hull(p, [tuple(lip + s * 0.9), tuple(lip - s * 0.9), tuple(lip + o), tuple(lip - o * 0.3),
                 tuple(bot + Vector((float(prng.uniform(-0.1, 0.1)), float(prng.uniform(-0.1, 0.1)), 0.0)))],
             p.vary(ICE_BODY if prng.random() < 0.6 else ICE_DEEP, 0.05), mat=ICE)
    # The melt's light in its heart.
    pts = [F.ad(d, 64.4 - 0.25 * k, 6.0 - k * 0.8) for k in range(5)]
    for k in range(1, 16):
        pts.append(F.ad(d, qg.RIM_R + 1.4, 0.4 - k * 1.9))
    _fall(p, pts, 0.5, (math.cos(a), math.sin(a)), shade=0.6)


def landmark_quench(bpy):
    F = Frame(qg.LANDMARKS['quench'])
    p = HSP('Kit_LandmarkQuench', seed=6921, ao=0.45, ao_dist=2.2, dust=0.0)
    rng = np.random.default_rng(6921)
    d0, d1 = SPAN['quench']
    f = _arc_field(F, d0, d1, 59.0, 92.0, -31.0, 18.0)
    _foot(f, F, rng, 'quench')
    _cliff(f, F, rng, 'quench', ('frost', 'frost2', 'frost_hi', 'frost_deep'), tilt=0.38)
    _finish(f, F, 6923, amp=0.2)
    _mesh(bpy, p, f, 'LandmarkQuench', 10000)
    tree = _tree(p)
    prng = p.rng
    # The ice: a forest of great spires leaning together, tallest behind the
    # altar, a second crown down the wall.
    for (d, r, h, w, (lu, lv)) in QUENCH_SPIRES:
        hit = _drape(tree, *F.ad(d, r, 0.0)[:2])
        z0 = (hit[0].z if hit else 2.0) - 1.6
        base = Vector(F.ad(d, r, z0))
        a = math.radians(d)
        dl = (lu * math.cos(a) - lv * math.sin(a), lu * math.sin(a) + lv * math.cos(a))
        dv = Vector(F.vec(dl[0], dl[1], 1.0)).normalized()
        _spire(p, prng, base, dv, h, w)
    for d in QUENCH_FALLS:
        _frozen_fall(p, prng, F, tree, d, width=float(prng.uniform(9.0, 12.0)))
    # Rime on the ledges and icicles off the brows.
    with p.as_kind(PAINT):
        for _ in range(48):
            h = _drape(tree, *F.ad(float(prng.uniform(d0 + 2, d1 - 2)), float(prng.uniform(62.0, 84.0)), 0.0)[:2])
            if h and h[1].z > 0.7:
                crystal(p, (h[0].x, h[0].y, h[0].z + 0.02), (1.6, 1.2, 0.16), p.vary(RIME, 0.03), n=16,
                        boxy=1.0, jitter=0.05, yaw=float(prng.uniform(0, TAU)))
    for _ in range(40):
        h = _drape(tree, *F.ad(float(prng.uniform(d0 + 2, d1 - 2)), float(prng.uniform(62.0, 68.0)), 0.0)[:2])
        if not h or h[0].z < 0.8:
            continue
        x, y, z = h[0].x, h[0].y, h[0].z - 0.1
        L = float(prng.uniform(0.8, 2.4))
        hull(p, [(x - 0.16, y, z), (x + 0.16, y, z), (x, y - 0.14, z), (x, y + 0.14, z),
                 (x + float(prng.uniform(-0.04, 0.04)), y, z - L)], p.vary(ICE_BODY, 0.05), mat=ICE)
    # Pale crystal glowing at the spires' feet (the runtime's frost light).
    for (d, r, h, w, _l) in QUENCH_SPIRES:
        for _ in range(3):
            hit = _drape(tree, *F.ad(d + float(prng.uniform(-2.0, 2.0)), r + float(prng.uniform(-2.0, 0.5)), 0.0)[:2])
            if not hit:
                continue
            with p.as_kind(PAINT):
                pale_crystal(p, (hit[0].x, hit[0].y, hit[0].z - 0.2),
                             (float(prng.uniform(-0.5, 0.5)), float(prng.uniform(-0.5, 0.5)), 1.0),
                             float(prng.uniform(0.8, 2.0)), float(prng.uniform(0.16, 0.34)), bright=0.1)
    _vein_net(p, tree, F, prng, 'quench', 12, w=(0.1, 0.17), shade=0.8)
    return p


# ================================================================ the Breath
# The horns: foot (u, v) in the frame, height, and the curl (per yard of
# height) toward their tips; the first two rise either side of the split
# and curl toward each other over it (the lightning's great arc).
BREATH_HORNS = (
    (71.73, 6.28, 31.0, 5.2, (-0.12, 0.13), 0.9),
    (69.81, 21.34, 29.0, 4.9, (-0.12, -0.13), -0.9),
    (73.29, -10.3, 22.0, 4.0, (-0.1, 0.1), 0.7),
    (64.29, 38.63, 24.0, 4.1, (-0.05, -0.12), -0.7),
    (50.35, 48.63, 16.0, 3.2, (0.0, -0.1), 0.6),
    (64.72, -17.32, 14.0, 3.0, (0.0, 0.08), -0.6),
)
BREATH_SPLIT = 11.0  # the split's bearing (degrees round from the altar's)


def landmark_breath(bpy):
    F = Frame(qg.LANDMARKS['breath'])
    p = HSP('Kit_LandmarkBreath', seed=6931, ao=0.45, ao_dist=2.2, dust=0.0)
    rng = np.random.default_rng(6931)
    d0, d1 = SPAN['breath']
    f = _arc_field(F, d0, d1, 59.0, 92.0, -31.0, 34.0)
    _foot(f, F, rng, 'breath')

    def split(d, r):
        return abs(d - BREATH_SPLIT) < math.degrees(2.6 / r)

    _cliff(f, F, rng, 'breath', ('storm', 'storm_v', 'storm2', 'storm_t', 'storm_hi'), skip=split, tilt=0.4)
    # The horns: storm stone wrung into tall twisted spires.
    tips = []
    for j, (u, v, h, r, (cu, cv), twist) in enumerate(BREATH_HORNS):
        pts = []
        radii = []
        n = 10
        for k in range(n + 1):
            t = k / n
            bend = t * t
            q = F.at(u + cu * h * bend, v + cv * h * bend + math.sin(t * 3.0 + j) * 0.5 * t, -3.0 + h * t)
            pts.append(q)
            radii.append(r * (1.0 - 0.82 * t) + 0.14)
        f.put(('storm', 'storm_v', 'storm2', 'storm_t', 'storm_hi')[j % 5], Polyline(pts, radii), 0.8)
        z = -1.0
        k = 0
        while z < h * 0.78:
            t = (z + 3.0) / h
            bend = t * t
            c = F.at(u + cu * h * bend, v + cv * h * bend, z)
            bw = r * 2.1 * (1.0 - 0.75 * t)
            f.put(('storm', 'storm2', 'storm_v')[k % 3], block(rng, c, (bw, bw * 0.8, 1.7), cuts=8,
                                                             chamfer=(0.8, 0.96), R=rot(rz=twist * k * 0.5)), 0.38)
            z += 1.6
            k += 1
        tips.append(pts[-1])
        # Bored through by the wind, high up where the horn stands free.
        for k in range(2):
            t = float(rng.uniform(0.46, 0.72))
            c = F.at(u + cu * h * t * t, v + cv * h * t * t, -3.0 + h * t)
            f.sub(Ellipsoid(c, (r * 1.1, r * 0.32, r * 0.36), rot(rz=float(rng.uniform(0, TAU)))), 0.12)
    # The split: the storm's stroke down the middle of the rock.
    f.sub(Polyline([F.ad(BREATH_SPLIT, 61.0, 2.0), F.ad(BREATH_SPLIT + 0.5, 70.0, 6.0),
                    F.ad(BREATH_SPLIT - 0.5, 80.0, 10.0), F.ad(BREATH_SPLIT, 90.0, 14.0)], [1.6, 2.2, 2.6, 3.0]), 0.6)
    _finish(f, F, 6933, amp=0.2)
    _mesh(bpy, p, f, 'LandmarkBreath', 11800)
    tree = _tree(p)
    prng = p.rng
    # Violet crystal crowning each horn (the lightning's anchors).
    for q in tips:
        for k in range(6):
            a = TAU * k / 6 + float(prng.uniform(-0.3, 0.3))
            lean = 0.0 if k == 0 else 0.55
            with p.as_kind(PAINT):
                pale_crystal(p, (q[0], q[1], q[2] - 0.4), (math.cos(a) * lean, math.sin(a) * lean, 1.0),
                             float(prng.uniform(1.4, 2.6)) * (1.0 if k == 0 else 0.55),
                             float(prng.uniform(0.3, 0.48)) * (1.0 if k == 0 else 0.7), bright=0.25 if k == 0 else 0)
    # Veins of light spiralling up each horn.
    for j, (u, v, h, r, (cu, cv), twist) in enumerate(BREATH_HORNS):
        pts = []
        for k in range(70):
            t = 0.05 + 0.85 * k / 70
            bend = t * t
            cx, cy, cz = F.at(u + cu * h * bend, v + cv * h * bend, -3.0 + h * t)
            a = twist * 9.0 * t + j
            rr = r * (1.0 - 0.82 * t) + 0.2
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, cz))
        for q0, q1 in zip(pts, pts[1:]):
            _riser(p, q0, q1, 0.18, 0.85)
    # The split's walls veined with the storm's light, top to bottom (laid
    # on each wall where a ray across the split meets it).
    for side in (-1.0, 1.0):
        for k in range(5):
            pts = []
            for st in range(44):
                r = 61.5 + st * 0.6
                z = 1.2 + st * 0.3 + 1.6 * k + float(prng.uniform(-0.25, 0.25))
                o = Vector(F.ad(BREATH_SPLIT, r, z))
                tgt = Vector(F.ad(BREATH_SPLIT + side * math.degrees(6.0 / r), r, z))
                hit = tree.ray_cast(o, (tgt - o).normalized(), 7.0)
                if hit[0] is not None:
                    pts.append(tuple(hit[0] - (tgt - o).normalized() * 0.06))
                elif len(pts) > 1:
                    break
            for q0, q1 in zip(pts, pts[1:]):
                if (Vector(q1) - Vector(q0)).length < 1.4:
                    _riser(p, q0, q1, 0.24, 0.95)
    _vein_net(p, tree, F, prng, 'breath', 10, w=(0.1, 0.17), shade=0.75)
    return p


def _riser(p, a, b, w, shade):
    """A thin quad of light between two points in space (a vein climbing a
    horn), turned to face out from the horn's axis."""
    bm = p.bm
    d = Vector(b) - Vector(a)
    if d.length < 1e-4:
        return
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side = side.normalized() * (w / 2)
    vs = [bm.verts.new(Vector(a) - side), bm.verts.new(Vector(b) - side), bm.verts.new(Vector(b) + side),
          bm.verts.new(Vector(a) + side)]
    fa = bm.faces.new(vs)
    fb = bm.faces.new([bm.verts.new(v.co.copy()) for v in reversed(vs)])
    p._paint([fa, fb], (shade, shade, shade), GLOW)


__all__ = ['landmark_heat', 'landmark_hammer', 'landmark_quench', 'landmark_breath', 'SPAN', 'BREATH_HORNS',
           'HEAT_CRATER', 'HAMMER_CLUSTERS', 'QUENCH_SPIRES', 'QUENCH_FALLS', 'BREATH_SPLIT']
