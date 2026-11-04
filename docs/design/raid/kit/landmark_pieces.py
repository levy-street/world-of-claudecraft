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
  - Kit_LandmarkHammer: the Smith's great stone hammer driven into the crag
    where it fell (`_hammer_itself`), its haft standing up over the room; the
    crag round it as the quarry cut it, benches climbing back in level courses
    of worked blocks (`_hammer_benches`), stove in round the head, fractures
    running out with the vein's gold deep in them, golden crystal bursting out
    of the broken rock either side.
  - Kit_LandmarkQuench: one mass of frost granite under its snow and a forest
    of great ice spires (the ice slot), hung with frozen falls, each ONE sheet
    of ribbed ice running on down the keel into the chasm and ending in
    icicles (`_frozen_fall`, landmark_paint.ice_sheet).
  - Kit_LandmarkBreath: storm stone streaming along the wall in long
    wind-eaten lobes (`_swell`, `_shelves`), split down its middle by the
    storm, its great horns each wrung out of three strands, curling toward
    each other over the split (the runtime's lightning arcs between their
    tips), the storm's light in the grooves between the strands.

The Hammer's, the Quench's and the Breath's rock is painted by landmark_paint.py:
smooth shading with its hard breaks kept, each corner's colour a function of its
position and its normal, so a formation is one rock (never one colour per block).

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
import landmark_crag as lc
import quarter_geom as qg
from gravewyrm_sculpt import Sculpt, block
from gwkit import crystal, hull, mix, sstep
from heart_pieces import HEART_COLOURS, HEART_KINDS, HSP, ICE, ICE_BODY, ICE_DEEP, RIME, ASH, _clamp, pale_crystal
from heat_pieces import _bundle_layout, hex_column
from hckit import GLOW
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, rot
from landmark_paint import crystal_grade, hand_sculpt, ice_sheet, paint_faces, stone_shader, surface_ribbon
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
CLIFF = {'heat': (4.0, 20.0), 'hammer': (4.5, 23.0), 'quench': (3.5, 17.0), 'breath': (3.5, 17.0)}
VOXEL = 0.38
R_LIP = 61.0  # the cliff's foot at the lip (the rim's fascia under it)
R_BACK = 88.0


def smax_np(a, b, k):
    """A smooth maximum."""
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return b + (a - b) * h + k * h * (1.0 - h)


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


def _top_v(vein, D, R):
    """`_top` over arrays (the shared crag's crest, landmark_crag.crag)."""
    lo, hi = CLIFF[vein]
    d0, d1 = SPAN[vein]
    t = np.clip((R - R_LIP) / (R_BACK - 6.0 - R_LIP), 0.0, 1.0)
    a = np.clip((D - d0) / 14.0, 0.0, 1.0)
    b = np.clip((d1 - D) / 14.0, 0.0, 1.0)
    env = (a * a * (3 - 2 * a)) * (b * b * (3 - 2 * b))
    return (lo + (hi - lo) * t ** 0.8) * (0.4 + 0.6 * env)


def _crag(f, F, rng, vein, label, **kw):
    """The vein's cliff in the one grammar the four share (landmark_crag.crag)."""
    return lc.crag(f, F, rng, SPAN[vein], R_LIP, lambda D, R: _top_v(vein, D, R), label, **kw)


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


def _apron(f, seed, slope):
    """Lay the mass back from the lip on a slope (yards up per yard back, wandering), so
    it climbs away from the walk instead of standing over it in a cut wall. Before the
    strata, which then cut across it, and before anything that stands up out of it."""
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    R = np.sqrt(X * X + Y * Y)
    n = Noise(seed + 11)
    ang = np.arctan2(X, Y) * np.ones_like(R)
    wander = 1.4 * n.fbm(np.cos(ang) * 6.0, np.sin(ang) * 6.0, 0.0 * ang, 2)
    top = 1.2 + wander + np.maximum(0.0, R - qg.RIM_R) * slope
    cap = (Z - top) * 0.45
    f.d = np.where(Z > 0.0, smax_np(f.d, cap, 0.4), f.d).astype(np.float32)


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


def _swell(f, F, rng, vein, label, k, dep, along, lean=0.15, skip=None):
    """A formation's one mass: long overlapping swells of rock in rows climbing back
    from the lip, blended into each other (`k`), each `dep` deep and `along` long, leaning
    the same way along the wall. A skyline that rises and falls, never a row of blocks."""
    d0, d1 = SPAN[vein]
    sky = Noise(int(rng.integers(1, 1 << 20)))
    r = R_LIP + 2.4
    row = 0
    while r < R_BACK + 4.0:
        d = d0 + float(rng.uniform(0.0, 6.0))
        while d < d1:
            L = float(rng.uniform(*along))
            step = math.degrees(L * 0.62 / r)
            if skip is None or not skip(d, r):
                swell = 0.74 + 0.5 * float(sky.fbm(d * 0.07, r * 0.05, 0.3, 2) + 0.5)
                h = _top(vein, d, r) * swell * float(rng.uniform(0.82, 1.08))
                dp = float(rng.uniform(*dep))
                f.put(label, Ellipsoid(F.ad(d, r, h * 0.42 - 2.0), (dp, L / 2, h * 0.72 + 3.0),
                                       rot(rz=F.yaw(d) + float(rng.uniform(-0.12, 0.12)), rx=lean)), k)
            d += step
        r += float(rng.uniform(3.4, 4.8))
        row += 1


def _shelves(f, seed, amp, period):
    """Strata the wind or the frost has eaten back: each shelf cut in under the one above
    it to a clean overhang (a sawtooth up the height), wandering round the formation and
    fading out in long stretches, so a slope reads as beds of rock, never as stripes."""
    n = Noise(seed)

    def fn(X, Y, Z):
        w = Z + 4.2 * n.fbm(X * 0.035, Y * 0.035, Z * 0.02, 2) + 0.7 * n.fbm(X * 0.14, Y * 0.14, 0.0 * Z, 2)
        # Each bed its own thickness: the height itself is stretched in waves.
        w = w + 0.9 * np.sin(w * 0.37)
        saw = (w / period) % 1.0
        patch = np.clip(0.5 + 1.8 * n.fbm(X * 0.03 + 9.0, Y * 0.03, Z * 0.05, 2), 0.0, 1.0)
        return amp * patch * saw * saw * saw

    f.displace(fn, band=max(1.6, amp * 2.2))


def _flutes(f, seed, amp):
    """The wind's long grooves down a formation's faces, running down the slope and
    wandering, so its shoulders are carved and never a soft swell."""
    n = Noise(seed)

    def fn(X, Y, Z):
        a = np.arctan2(X, Y) * 42.0 + 1.3 * n.fbm(X * 0.06, Y * 0.06, Z * 0.04, 2)
        v = np.abs(np.sin(a))
        patch = np.clip(0.55 + 2.0 * n.fbm(X * 0.04 + 5.0, Y * 0.04, Z * 0.03, 2), 0.0, 1.0)
        return amp * patch * (1.0 - v) ** 3

    f.displace(fn, band=1.4)


def _glow_thread(p, pts, radii, shade):
    """A thin tube of light through the air of a carved crack (the crack's own walls hide
    all but its line), four sided, tapering."""
    bm = p.bm
    rings = []
    for k, q in enumerate(pts):
        d = Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])
        side = d.cross(Vector((0.0, 0.0, 1.0)))
        if side.length < 1e-4:
            side = Vector((1.0, 0.0, 0.0))
        side = side.normalized()
        up = side.cross(d).normalized()
        c = Vector(q)
        r = radii[k]
        rings.append([bm.verts.new(c + (side * math.cos(a) + up * math.sin(a)) * r)
                      for a in (0.0, TAU / 4, TAU / 2, 3 * TAU / 4)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for j in range(4):
            faces.append(bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j])))
    p._paint(faces, (shade, shade, shade), GLOW)


def _mul3(R, v):
    """A 3x3 rotation (numpy) on a vector."""
    return np.asarray(R, dtype=np.float64) @ np.asarray(v, dtype=np.float64)


def _lip_boulders(f, F, rng, vein, label, n):
    """Boulders fallen along the wall's foot, so the rock meets the walk in a broken line
    and never a clean cut face."""
    d0, d1 = SPAN[vein]
    for _ in range(n):
        d = float(rng.uniform(d0 + 1.0, d1 - 1.0))
        r = float(rng.uniform(62.4, 65.0))
        w = float(rng.uniform(1.4, 3.2))
        h = float(rng.uniform(1.0, 2.6))
        f.put(label, block(rng, F.ad(d, r, h * 0.3), (w * 1.1, w * 1.4, h + 1.0), cuts=10, chamfer=(0.74, 0.92),
                           R=rot(rz=float(rng.uniform(0, TAU)), ry=float(rng.uniform(-0.2, 0.2))), top_tilt=0.35), 0.35)


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
    # The third round: the shared crag (landmark_crag.py), no heap of blocks.
    _crag(f, F, rng, 'heat', 'basalt', cols=5, clefts=0.5)
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
    for _ in range(10):
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
    _finish(f, F, 6903, amp=0.22)
    # Painted like the other three (the shared kit stone's fracture turned its dark
    # basalt to pure black faces): warm dark basalt, ash settling on the tops, the
    # shadow a cool violet, the foot warmed by the lava's light.
    made = hand_sculpt(bpy, p, f, 'LandmarkHeat', 11800, sharp=40.0, colours=LANDMARK_COLOURS, kinds=LANDMARK_KINDS)

    def lava_warm(col, q, n, c):
        return mix(col, (0.42, 0.22, 0.15), sstep(5.0, -3.0, q.z) * 0.45)

    paint_faces(p, made, stone_shader(
        (0.21, 0.19, 0.19), (0.31, 0.28, 0.27), (0.47, 0.42, 0.38), (0.22, 0.2, 0.28),
        cap=(0.54, 0.5, 0.47), cap_at=(0.74, 0.97), edge=0.62, hollow=0.42, z_span=(-6.0, 24.0),
        extra=lava_warm))
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
    (-7.0, 65.0, 1.2, 9, 10.0, 1.7, (-0.25, -0.3)),
    (7.5, 65.0, 1.2, 9, 11.5, 1.8, (-0.25, 0.3)),
    (19.0, 71.0, 8.5, 8, 11.0, 1.6, (-0.4, 0.3)),
    (-13.5, 72.0, 7.5, 7, 10.0, 1.5, (-0.4, -0.35)),
    (29.0, 68.5, 4.5, 7, 9.0, 1.4, (-0.5, 0.25)),
)
# The quarry's benches climbing back from the lip: (front, back, top).
HAMMER_BENCHES = ((62.0, 66.6, 3.6), (66.2, 71.6, 7.8), (71.2, 77.2, 12.6), (76.8, 84.0, 18.0), (83.6, 94.0, 24.0))
# The Hammer itself: the Smith's great stone hammer, driven into the crag where it fell.
# Its head's centre (u, v, z in the frame), its half sizes (out, across, up), and the far
# end of its haft.
HAMMER_HEAD = (73.5, 0.0, 12.5)
HAMMER_HEAD_HALF = (5.0, 10.5, 5.0)
HAMMER_TILT = 0.42
HAMMER_HAFT_END = (92.0, 2.5, 47.0)
HAMMER_CRACKS = ((-14.0, 15.0), (-62.0, 13.0), (14.0, 15.0), (58.0, 13.0), (118.0, 8.0), (156.0, 13.0), (-124.0, 8.0),
                 (-162.0, 13.0))


def _hammer_benches(f, F, rng, voxel_gap=0.6):
    """The crag as the quarry cut it: great benches climbing back in level courses of
    long worked blocks, deep joints, a lift or two left proud (the approved Quarry's own
    language). Level, so the eye reads a cut wall, never a heap."""
    d0, d1 = SPAN['hammer']
    for (bi, (r0, r1, top)) in enumerate(HAMMER_BENCHES):
        rm = (r0 + r1) / 2
        d = d0 + float(rng.uniform(-2.0, 2.0))
        # One bench's courses run level along its whole length.
        courses = [-7.0, -0.5]
        z = float(rng.uniform(2.0, 3.0))
        while z < top - 1.4:
            courses.append(z)
            z += float(rng.uniform(2.8, 4.2))
        while d < d1:
            L = min(float(rng.uniform(8.0, 18.0)), math.radians(d1 - d) * rm)
            if L < 3.0:
                break
            deg = math.degrees(L / rm)
            dc = d + deg / 2
            h = top * (0.45 + 0.55 * _env('hammer', dc)) * float(rng.uniform(0.96, 1.03))
            proud = -0.5 if rng.random() < 0.14 else 0.0
            for k in range(len(courses)):
                z0 = courses[k]
                z1 = courses[k + 1] if k + 1 < len(courses) else h
                if z0 >= h:
                    break
                z1 = min(z1, h)
                # Its courses stagger: a joint here never lines up with the next.
                sub = 2 if (z1 - z0) < 5.0 and L > 11.0 and rng.random() < 0.5 else 1
                for q in range(sub):
                    ql = L / sub
                    qdc = d + math.degrees((q + 0.5) * ql / rm)
                    out = float(rng.uniform(-0.2, 0.2)) + proud
                    c = F.ad(qdc, rm + out, (z0 + z1) / 2)
                    f.put('ochre', block(rng, c, (r1 - r0, ql - voxel_gap, z1 - z0 - 0.08), cuts=4, chamfer=(0.95, 0.99),
                                         R=rot(rz=F.yaw(qdc) + float(rng.uniform(-0.012, 0.012))), top_tilt=0.012), 0.08)
            d += deg


def _hammer_rot(F):
    """The head's frame: its long axis across the wall, tilted back along its haft."""
    return rot(rz=F.yaw(0.0), ry=HAMMER_TILT)


def _hammer_crater(f, F, rng):
    """Where it fell: the crag's face stove in round the head, fractures running out
    across the benches, a few blocks thrown up and left leaning. Returns the fractures."""
    cu, cv, cz = HAMMER_HEAD
    f.sub(Ellipsoid(F.at(cu - 3.0, cv, cz - 1.0), (10.0, 14.5, 8.5), rot(rz=F.yaw(0.0))), 0.6)
    lines = []
    for (ang, L) in HAMMER_CRACKS:
        a = math.radians(ang)
        pts = []
        radii = []
        for k in range(7):
            t = k / 6
            wob = math.sin(t * 7.0 + ang) * 0.7 * t
            v = cv + math.cos(a) * (12.5 + L * t) + math.sin(a) * wob
            z = cz - 1.0 + math.sin(a) * (7.5 + L * t * 0.7) - math.cos(a) * wob
            u = cu - 7.0 + 0.42 * max(0.0, z)
            if z < -1.0:
                break
            pts.append(F.at(u, v, z))
            radii.append(0.85 * (1.0 - 0.8 * t) + 0.14)
        if len(pts) >= 3:
            f.sub(Polyline(pts, radii[:len(pts)]), 0.16)
            lines.append((pts, radii[:len(pts)]))
    for (v, z, tilt) in ((-15.0, 8.0, 0.28), (15.5, 7.0, -0.24), (-10.0, 3.0, 0.18), (11.0, 2.6, -0.2)):
        c = F.at(cu - 7.0 + 0.3 * z, cv + v, z)
        f.put('ochre', block(rng, c, (float(rng.uniform(4.0, 5.0)), float(rng.uniform(6.0, 8.0)),
                                      float(rng.uniform(3.0, 4.0))), cuts=12, chamfer=(0.7, 0.93),
                             R=rot(rz=F.yaw(0.0) + tilt, rx=tilt * 1.2, ry=0.16)), 0.12)
    return lines


def _hammer_itself(f, F):
    """The great hammer: the Smith's sledge of dark granite, its head a sculpted form
    (the weak-spots pass of 2026-11-04: a rounded box read as one dark block). A
    narrow eye block round the haft's socket, girt by a proud collar; cheeks that
    flare out toward both striking faces in stepped, chamfered courses, a worked lip
    round each face; the faces themselves domed and broken at their corners by the
    blow; fluting cut along its top and its front; a great crack down its front face
    where the fall split it (its gold thread laid after the mesh). The haft is bound
    in three places and ends in a pommel. Returns the head's centre, its long axis,
    the haft's ends and the crack's points."""
    from jaguar_head_sculpt import RoundBox
    cu, cv, cz = HAMMER_HEAD
    hu, hv, hz = HAMMER_HEAD_HALF
    R = _hammer_rot(F)
    c = F.at(cu, cv, cz)
    C = Vector(c)

    def L(o):
        q = _mul3(R, o)
        return (C.x + q[0], C.y + q[1], C.z + q[2])

    def on_face(o, into):
        """Local point `o` marched along local `into` onto the head's surface (a
        groove or a crack follows the stone, never the air past it)."""
        d = _mul3(R, into)
        q = np.asarray(L(o), dtype=np.float64) - d * 2.5
        for _ in range(140):
            if float(f.sample(q[None, :])[0]) <= 0.0:
                break
            q = q + d * 0.05
        return tuple(q)

    # The eye block and its collar.
    f.put('head', RoundBox(c, (hu * 0.84, 3.4, hz * 0.84), 1.3, R), 0.3)
    f.put('head', RoundBox(c, (hu * 0.84 + 0.6, 1.15, hz * 0.84 + 0.6), 0.8, R), 0.12)
    for s in (-1.0, 1.0):
        # The cheeks flaring toward the face, in three courses.
        for k, (y, g) in enumerate(((4.4, 0.9), (6.4, 0.98), (8.2, 1.05))):
            f.put('head', RoundBox(L((0.0, s * y, 0.0)), (hu * g, 1.25, hz * g), 1.15, R), 0.55)
        # The worked lip round the striking face, a hand proud.
        f.put('head', RoundBox(L((0.0, s * 9.0, 0.0)), (hu * 1.05 + 0.45, 0.62, hz * 1.05 + 0.45), 0.7, R), 0.1)
        # The striking face: broad, a little domed.
        f.put('head', Ellipsoid(L((0.0, s * 9.8, 0.0)), (hu * 1.0, 1.3, hz * 1.0), R), 0.35)
    for s in (-1.0, 1.0):
        # Fluting along its top and down its front, course to course, on the stone.
        for x in (-2.6, 0.0, 2.6):
            run = [on_face((x, s * y, hz * 1.1), (0.0, 0.0, -1.0)) for y in (3.9, 5.3, 6.7, 8.1)]
            f.groove(Polyline(run, 0.02), 0.45, 0.34)
        for z in (-2.4, 0.2, 2.6):
            run = [on_face((-hu * 1.1, s * y, z), (1.0, 0.0, 0.0)) for y in (3.9, 5.3, 6.7, 8.1)]
            f.groove(Polyline(run, 0.02), 0.45, 0.34)
    chips = np.random.default_rng(6917)
    # The blow broke the faces' corners.
    for _ in range(12):
        sy = float(chips.choice((-1.0, 1.0)))
        sx = float(chips.choice((-1.0, 1.0)))
        sz = float(chips.choice((-1.0, 1.0)))
        o = (sx * hu * float(chips.uniform(0.75, 1.05)), sy * float(chips.uniform(8.6, 10.6)),
             sz * hz * float(chips.uniform(0.75, 1.05)))
        f.sub(Ellipsoid(L(o), (float(chips.uniform(0.8, 1.6)), float(chips.uniform(0.7, 1.4)),
                               float(chips.uniform(0.7, 1.4))), R), 0.22)
    # The fall's crack down the front face, from the collar's shoulder to the foot.
    crack = []
    for k in range(9):
        t = k / 8
        crack.append(on_face((-hu * 1.2, 1.6 + 2.8 * t + 0.5 * math.sin(t * 9.0), hz * 0.9 - t * hz * 1.8),
                             (1.0, 0.0, 0.0)))
    f.groove(Polyline(crack, 0.02), 0.6, 0.42)
    # Its gold thread rides a little inside the crack's mouth.
    inward = _mul3(R, (1.0, 0.0, 0.0))
    crack = [tuple(np.asarray(q) + inward * 0.18) for q in crack]
    across = Vector((math.cos(math.radians(F.bearing)), math.sin(math.radians(F.bearing)), 0.0))
    # The haft.
    end = F.at(*HAMMER_HAFT_END)
    base = Vector(c)
    tip = Vector(end)
    pts = [tuple(base.lerp(tip, t)) for t in (0.0, 0.35, 0.7, 1.0)]
    f.put('haft', Polyline(pts, [2.3, 1.9, 1.7, 1.55]), 0.35)
    for t in (0.34, 0.5, 0.82):
        f.put('head', Ellipsoid(tuple(base.lerp(tip, t)), (2.5, 2.5, 1.0), None), 0.12)
    f.put('head', Ellipsoid(tuple(tip), (2.7, 2.7, 2.4), None), 0.25)
    return c, across, base, tip, crack


def landmark_hammer(bpy):
    F = Frame(qg.LANDMARKS['hammer'])
    p = HSP('Kit_LandmarkHammer', seed=6911, ao=0.45, ao_dist=3.0, dust=0.0)
    rng = np.random.default_rng(6911)
    d0, d1 = SPAN['hammer']
    f = _arc_field(F, d0, d1, 59.0, 97.0, -31.0, 52.0, voxel=0.3)
    _foot(f, F, rng, 'hammer')
    # The third round: the shared crag (landmark_crag.py) where the quarry's level
    # courses of worked blocks read as flat brown slabs.
    _crag(f, F, rng, 'hammer', 'ochre', cols=4, clefts=0.7, setback=(0.8, 2.0))
    cracks = _hammer_crater(f, F, rng)
    for (cd, cr, cz, *_rest) in HAMMER_CLUSTERS[2:]:
        f.sub(Ellipsoid(F.ad(cd, cr, cz + 3.0), (3.6, 3.2, 6.0)), 0.6)
    head_c, across, h0, h1, head_crack = _hammer_itself(f, F)
    _finish(f, F, 6913, amp=0.2)
    made = hand_sculpt(bpy, p, f, 'LandmarkHammer', 11000, sharp=40.0, colours=LANDMARK_COLOURS, kinds=LANDMARK_KINDS)
    crag = stone_shader(
        (0.4, 0.36, 0.33), (0.56, 0.5, 0.43), (0.77, 0.69, 0.57), (0.31, 0.28, 0.34),
        cap=(0.66, 0.6, 0.5), cap_at=(0.84, 0.99), bed=(0.62, 0.5, 0.38), bed_scale=0.8, edge=0.62, hollow=0.45,
        z_span=(-8.0, 22.0))
    # The hammer: the Smith's own granite, darker and cooler than the crag but
    # lit like it (the weak-spots pass: its shade a violet slate, never black),
    # its worn arrises pale, dust settled on its top; its collar and its lips a
    # darker dressed course, so its rhythm reads from the room.
    dressed = stone_shader(
        (0.4, 0.37, 0.37), (0.56, 0.51, 0.47), (0.76, 0.69, 0.6), (0.36, 0.34, 0.44),
        cap=(0.7, 0.63, 0.52), cap_at=(0.78, 0.97), edge=1.0, hollow=0.55, z_span=(4.0, 22.0))
    course = stone_shader(
        (0.32, 0.29, 0.29), (0.43, 0.38, 0.35), (0.6, 0.53, 0.45), (0.3, 0.28, 0.37),
        edge=1.0, hollow=0.5, z_span=(4.0, 22.0))
    R0 = Vector(head_c)
    hd = (h1 - h0).normalized()
    hl = (h1 - h0).length

    def shade(q, n, c):
        o = q - R0
        a = o.dot(across)
        ac = abs(a)
        rad = (o - across * a).length
        t = o.dot(hd)
        haft = (o - hd * t).length < 3.2 and -1.0 < t < hl + 3.5
        head = ac < 11.4 and rad < 9.0
        if head and (ac < 1.4 or 8.4 < ac < 9.5):
            return course(q, n, c)
        return dressed(q, n, c) if head or haft else crag(q, n, c)

    paint_faces(p, made, shade)
    tree = _tree(p)
    prng = p.rng
    # The golden crystal, bursting out of the broken rock either side of the head and
    # where the benches split along the wall.
    for (cd, cr, cz, n, hh, rr, (lu, lv)) in HAMMER_CLUSTERS:
        base = F.ad(cd, cr, cz)
        a0 = math.radians(cd)
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
                faces = pale_crystal(p, foot, d, L, rr * (1.0 if k == 0 else float(prng.uniform(0.45, 0.7))),
                                     bright=0.15 if k == 0 else 0.0)
            crystal_grade(p, faces, foot, d, L)
    # Gold in the hammer's own crack, from its collar to its foot.
    _glow_thread(p, head_crack, [0.16 + 0.1 * math.sin(math.pi * k / 8) for k in range(9)], 0.95)
    # Gold down in the fractures: a thread of the vein's light deep in each.
    for (pts, radii) in cracks:
        out = Vector(pts[0]).normalized()
        out = Vector((out.x, out.y, 0.0)).normalized()
        run, rad = [], []
        for q, rr in zip(pts, radii):
            # Only where there is rock behind it: a thread never leaves the stone.
            q2 = Vector(q) + out * (rr * 0.25)
            if float(f.sample(np.array([tuple(q2)]))[0]) < rr * 1.15:
                run.append(tuple(q2))
                rad.append(max(0.07, rr * 0.3))
            else:
                if len(run) > 2:
                    _glow_thread(p, run, rad, 0.92)
                run, rad = [], []
        if len(run) > 2:
            _glow_thread(p, run, rad, 0.92)
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
    for j in range(3):
        a = float(prng.uniform(0, TAU))
        fb = base + side * math.cos(a) * w * 0.7 + fwd * math.sin(a) * w * 0.7
        dd = (d * 0.6 + side * math.cos(a) * 0.5 + fwd * math.sin(a) * 0.5).normalized()
        L = h * float(prng.uniform(0.16, 0.3))
        ww = w * 0.24
        sp = [fb + side * ww * math.cos(TAU * q / 5) + fwd * ww * math.sin(TAU * q / 5) for q in range(5)]
        sp.append(fb + dd * L)
        hull(p, [tuple(q) for q in sp], p.vary(ICE_BODY, 0.06), mat=ICE)


def _fall_ramps(f, F):
    """What the frozen falls have smoothed: a long even ramp of rock under each, so the
    sheet lies on one surface and no ledge breaks through it."""
    for d in QUENCH_FALLS:
        pts = [F.ad(d, 72.0, 3.4), F.ad(d, 67.0, 0.2), F.ad(d, 62.4, -3.6)]
        f.put('frost', Polyline(pts, [6.0, 5.8, 5.4]), 0.9)


def _frozen_fall(p, prng, F, tree, d, width):
    """A frozen fall: ONE sheet of ice flowing down the cliff from its brow, over the lip
    and on down the keel into the chasm, ribbed by its old flow, hanging off in icicles of
    every length (`landmark_paint.ice_sheet`, the ice slot)."""
    half = math.degrees(width / 2 / 66.0)
    seed = float(prng.uniform(0, 40))
    L = 11.0 + float(prng.uniform(0.0, 11.0))

    def path(t, s):
        # Narrow at the brow where it seeps out from under the snow, spreading as it runs.
        wide = 0.34 + 0.66 * min(1.0, t / 0.34) ** 0.7
        dd = d + half * s * wide + 0.6 * math.sin(t * 5.0 + seed) * (1.0 - s * s)
        out = Vector((math.sin(math.radians(F.bearing + dd)), -math.cos(math.radians(F.bearing + dd)), 0.0))
        if t < 0.58:
            rr = 68.5 + (qg.RIM_R + 0.5 - 68.5) * (t / 0.58)
            hit = _drape(tree, *F.ad(dd, rr, 0.0)[:2])
            if hit:
                return hit[0].copy(), hit[1].copy()
            return Vector(F.ad(dd, rr, 0.5)), -out
        k = (t - 0.58) / 0.42
        edge = 1.0 - s * s
        return Vector(F.ad(dd, qg.RIM_R + 0.9 + 0.5 * k, 0.2 - L * k * (0.45 + 0.55 * edge))), -out

    def tips(s):
        return 1.0 + 3.6 * abs(math.sin(s * 17.0 + seed)) * (1.0 - 0.5 * abs(s))

    ice_sheet(p, tree, path, None, width, (max(6, int(width / 1.0)), 13), tips, ICE_DEEP, ICE_BODY, RIME, ICE,
              thick=0.7, seed=seed)


def landmark_quench(bpy):
    F = Frame(qg.LANDMARKS['quench'])
    p = HSP('Kit_LandmarkQuench', seed=6921, ao=0.42, ao_dist=3.0, dust=0.0)
    rng = np.random.default_rng(6921)
    d0, d1 = SPAN['quench']
    f = _arc_field(F, d0, d1, 59.0, 95.0, -31.0, 20.0)
    _foot(f, F, rng, 'quench')
    # The crag under the ice (the third round: the shared crag, landmark_crag.py,
    # where snow swells read as pillows): frost granite, snow on its ledges.
    _crag(f, F, rng, 'quench', 'frost', cols=5, clefts=0.5, setback=(0.6, 1.5))
    _lip_boulders(f, F, rng, 'quench', 'frost', 18)
    _fall_ramps(f, F)
    _finish(f, F, 6923, amp=0.2)
    made = hand_sculpt(bpy, p, f, 'LandmarkQuench', 8800, sharp=40.0, colours=LANDMARK_COLOURS, kinds=LANDMARK_KINDS)
    paint_faces(p, made, stone_shader(
        (0.32, 0.36, 0.43), (0.47, 0.51, 0.58), (0.66, 0.69, 0.74), (0.31, 0.36, 0.5),
        cap=(0.88, 0.91, 0.95), cap_at=(0.58, 0.86), edge=0.6, hollow=0.45, z_span=(-8.0, 18.0)))
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
        _frozen_fall(p, prng, F, tree, d, float(prng.uniform(9.0, 12.0)))
    # Icicles off the brows.
    for _ in range(22):
        h = _drape(tree, *F.ad(float(prng.uniform(d0 + 2, d1 - 2)), float(prng.uniform(62.0, 68.0)), 0.0)[:2])
        if not h or h[0].z < 0.8:
            continue
        x, y, z = h[0].x, h[0].y, h[0].z - 0.1
        L = float(prng.uniform(0.8, 2.4))
        hull(p, [(x - 0.16, y, z), (x + 0.16, y, z), (x, y - 0.14, z), (x, y + 0.14, z),
                 (x + float(prng.uniform(-0.04, 0.04)), y, z - L)], p.vary(ICE_BODY, 0.05), mat=ICE)
    # Pale crystal glowing at the spires' feet (the runtime's frost light).
    for (d, r, h, w, _l) in QUENCH_SPIRES:
        for _ in range(2):
            hit = _drape(tree, *F.ad(d + float(prng.uniform(-2.0, 2.0)), r + float(prng.uniform(-2.0, 0.5)), 0.0)[:2])
            if not hit:
                continue
            with p.as_kind(PAINT):
                foot = (hit[0].x, hit[0].y, hit[0].z - 0.2)
                dv = (float(prng.uniform(-0.5, 0.5)), float(prng.uniform(-0.5, 0.5)), 1.0)
                L = float(prng.uniform(0.8, 2.0))
                faces = pale_crystal(p, foot, dv, L, float(prng.uniform(0.16, 0.34)), bright=0.1)
            crystal_grade(p, faces, foot, dv, L)
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


def _breath_horn_axis(F, j, t):
    """A point on a horn's axis (its Blender and TS mirror's own curl)."""
    u, v, h, r, (cu, cv), _tw = BREATH_HORNS[j]
    bend = t * t
    return F.at(u + cu * h * bend, v + cv * h * bend + math.sin(t * 3.0 + j) * 0.5 * t, -3.0 + h * t)


def _breath_horn(f, F, rng, j):
    """A horn: the storm's stone wrung into one tall spire, three strands twisting round
    one another up its whole height, flared at its foot where it leaves the mass."""
    u, v, h, r, _c, twist = BREATH_HORNS[j]
    n = 18
    for s in range(3):
        pts = []
        radii = []
        for k in range(n + 1):
            t = k / n
            c = _breath_horn_axis(F, j, t)
            a = TAU * s / 3 + twist * 8.0 * t + j
            spread = r * 0.5 * (1.0 - 0.86 * t)
            pts.append((c[0] + math.cos(a) * spread, c[1] + math.sin(a) * spread, c[2]))
            radii.append(r * 0.5 * (1.0 - 0.86 * t) + 0.12)
        f.put('storm', Polyline(pts, radii), 0.22)
    foot = _breath_horn_axis(F, j, 0.08)
    f.put('storm', Ellipsoid(foot, (r * 1.5, r * 1.5, r * 1.4)), 2.0)


def landmark_breath(bpy):
    F = Frame(qg.LANDMARKS['breath'])
    p = HSP('Kit_LandmarkBreath', seed=6931, ao=0.42, ao_dist=3.0, dust=0.0)
    rng = np.random.default_rng(6931)
    d0, d1 = SPAN['breath']
    f = _arc_field(F, d0, d1, 59.0, 95.0, -31.0, 34.0)
    _foot(f, F, rng, 'breath')

    def split(d, r):
        return abs(d - BREATH_SPLIT) < math.degrees(3.4 / r)

    # The massif (the third round: the shared crag, landmark_crag.py, where its
    # wind-eaten lobes and their shelves' overhangs read as a lilac blob with black
    # slits): storm slate, its faces grooved by the wind.
    _crag(f, F, rng, 'breath', 'storm', cols=5, clefts=0.6, lean=0.4)
    _flutes(f, 6939, 0.35)
    for j in range(len(BREATH_HORNS)):
        _breath_horn(f, F, rng, j)
    # The split: the storm's stroke down the middle of the rock.
    f.sub(Polyline([F.ad(BREATH_SPLIT, 61.0, 2.0), F.ad(BREATH_SPLIT + 0.5, 70.0, 6.0),
                    F.ad(BREATH_SPLIT - 0.5, 80.0, 10.0), F.ad(BREATH_SPLIT, 90.0, 14.0)], [1.6, 2.2, 2.6, 3.0]), 0.6)
    _lip_boulders(f, F, rng, 'breath', 'storm', 18)
    _finish(f, F, 6933, amp=0.2)
    made = hand_sculpt(bpy, p, f, 'LandmarkBreath', 10800, sharp=40.0, colours=LANDMARK_COLOURS, kinds=LANDMARK_KINDS)
    paint_faces(p, made, stone_shader(
        (0.24, 0.23, 0.3), (0.37, 0.35, 0.45), (0.55, 0.52, 0.63), (0.25, 0.22, 0.36),
        cap=(0.6, 0.58, 0.68), cap_at=(0.8, 0.98), bed=(0.42, 0.38, 0.52), bed_scale=1.0, edge=0.62,
        hollow=0.42, z_span=(-6.0, 26.0)))
    tree = _tree(p)
    prng = p.rng
    # Violet crystal crowning each horn (the lightning's anchors).
    tips = [F.at(s[0] + s[4][0] * s[2], s[1] + s[4][1] * s[2] + math.sin(3.0 + j) * 0.5, -3.0 + s[2])
            for j, s in enumerate(BREATH_HORNS)]
    for q in tips:
        for k in range(4):
            a = TAU * k / 4 + float(prng.uniform(-0.3, 0.3))
            lean = 0.0 if k == 0 else 0.55
            foot = (q[0], q[1], q[2] - 0.5)
            d = (math.cos(a) * lean, math.sin(a) * lean, 1.0)
            L = float(prng.uniform(1.4, 2.6)) * (1.0 if k == 0 else 0.55)
            with p.as_kind(PAINT):
                faces = pale_crystal(p, foot, d, L, float(prng.uniform(0.3, 0.48)) * (1.0 if k == 0 else 0.7),
                                     bright=0.25 if k == 0 else 0)
            crystal_grade(p, faces, foot, d, L, lo=0.35)
    # The storm's light climbing each horn in the grooves between its strands (found on
    # the rock by rays, so no line of it ever hangs free).
    for j, (u, v, h, r, _c, twist) in enumerate(BREATH_HORNS):
        for s in range(2 if j < 2 else 1):
            rays = []
            for k in range(36):
                t = 0.1 + 0.8 * k / 36
                c = Vector(_breath_horn_axis(F, j, t))
                a = TAU * s / 3 + twist * 8.0 * t + j + TAU / 6
                out = Vector((math.cos(a), math.sin(a), 0.0))
                rays.append((c + out * (r * 1.5 + 1.0), c))
            surface_ribbon(p, tree, rays, 0.3 * (1.0 + r * 0.08), 0.85, reach=12.0, gap=1.8)
    # The split's walls veined with the storm's light (laid on each wall by a ray across).
    for side in (-1.0, 1.0):
        for k in range(2):
            rays = []
            for st in range(30):
                r = 61.5 + st * 0.85
                z = 1.5 + st * 0.42 + 2.6 * k + float(prng.uniform(-0.25, 0.25))
                o = Vector(F.ad(BREATH_SPLIT, r, z))
                tgt = Vector(F.ad(BREATH_SPLIT + side * math.degrees(6.0 / r), r, z))
                rays.append((o, tgt))
            surface_ribbon(p, tree, rays, 0.34, 0.95, reach=7.0, gap=2.0)
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
           'HEAT_CRATER', 'HAMMER_CLUSTERS', 'HAMMER_HEAD', 'QUENCH_SPIRES', 'QUENCH_FALLS', 'BREATH_SPLIT']
