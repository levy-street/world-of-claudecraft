"""The Anvil of the World's wall landmarks (phase 2M, build_smith_heart_heart_kit.py):
one great formation of each element standing past the platform's rim at
the middle of its quarter, behind its altar, so the quarter reads at a
glance from anywhere in the room (the element lives on the edges; the floor
is one common stone).

  - Kit_LandmarkHeat: a molten outcrop of the Hearth's dark basalt, its
    columns heaved up and split, a crater of lava at its crown and lava
    spilling down its face to the lip and falling into the chasm.
  - Kit_LandmarkHammer: a formation of ochre granite blocks heaved into a
    stepped crag, great clusters of golden crystal bursting out of it.
  - Kit_LandmarkQuench: a frost-granite foot under a crown of great ice
    spires (the ice slot) leaning together, rime on every ledge, icicles,
    pale crystal glowing at their feet.
  - Kit_LandmarkBreath: storm stone wrung into tall twisted horns bored by
    the wind, violet crystal at their tips (the runtime's lightning arcs
    between them), veins of light spiralling up them.

Each stands wholly past the rim (r > 60.4: never over the walk; the altar at
its foot is the one solid a body meets), its foot buttressed down into the
platform's keel. Frames: every piece at the platform's centre on its walk
(Blender -Y the game's north), placed unturned, its formation at its own
bearing `LANDMARK_R` out (quarter_geom.LANDMARKS). Glow slot: pale grey the
runtime tints with the quarter's light and blazes when the quarter wakes.
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
from jaguar_head_sculpt import Ellipsoid, Polyline, rot
from mathutils import Vector
from quarter_pieces import ribbon, strip
from ring_sculpt import _weather
from shkit import PAINT, RAW, TAU

LANDMARK_COLOURS = dict(HEART_COLOURS)
LANDMARK_COLOURS.update({
    'lava_crust': (0.13, 0.1, 0.09), 'scorch': (0.32, 0.12, 0.06), 'gold_g': (0.6, 0.47, 0.3),
    'gold_g2': (0.5, 0.39, 0.26), 'frost_hi': (0.74, 0.79, 0.85), 'storm_v': (0.4, 0.37, 0.48),
    'storm_t': (0.32, 0.38, 0.42), 'base': (0.2, 0.18, 0.19), 'base2': (0.25, 0.22, 0.22),
})
LANDMARK_KINDS = dict(HEART_KINDS)
LANDMARK_KINDS.update({k: RAW for k in ('lava_crust', 'scorch', 'gold_g', 'gold_g2', 'frost_hi', 'storm_v',
                                        'storm_t', 'base', 'base2')})


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

    def yaw(self):
        """The plan angle of the frame's +u (for rot(rz=...))."""
        return math.atan2(self.oy, self.ox)


def _field(F, u0, u1, v, z0, z1, voxel):
    pts = [F.at(u, s, 0.0) for u in (u0, u1) for s in (-v, v)]
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    return Sculpt((min(xs), min(ys), z0), (max(xs), max(ys), z1), voxel)


def _foot(f, F, rng):
    """Every landmark's foot: a heaved mass of the mountain's dark rock on
    the platform's rim, buttressed down into the keel."""
    f.put('base', Ellipsoid(F.at(68.5, 0.0, -2.2), (8.5, 11.5, 4.6), rot(rz=F.yaw())), 0.9)
    f.put('base2', Ellipsoid(F.at(66.0, -6.5, -1.2), (4.8, 4.6, 3.2), rot(rz=F.yaw() + 0.4)), 0.8)
    f.put('base2', Ellipsoid(F.at(66.5, 6.8, -1.0), (4.6, 4.8, 3.0), rot(rz=F.yaw() - 0.3)), 0.8)
    f.put('base', Polyline([F.at(67.0, 0.0, -4.0), F.at(61.0, 0.0, -14.0), F.at(54.0, 0.0, -24.0)],
                           [6.2, 4.4, 2.2]), 1.2)
    for s in (-1, 1):
        f.put('base2', Polyline([F.at(66.0, s * 6.0, -3.0), F.at(60.0, s * 5.0, -12.0), F.at(55.0, s * 3.0, -19.0)],
                                [3.0, 2.0, 1.0]), 0.9)
    # Heaved blocks of the mountain's rock round its shoulders and down its
    # flanks (broad planes and sharp breaks, never a smooth blob).
    for k in range(16):
        a = TAU * k / 16 + float(rng.uniform(-0.15, 0.15))
        u = 68.5 + math.cos(a) * 7.6
        v = math.sin(a) * 10.2
        z = float(rng.uniform(-3.5, -0.6))
        sz = (float(rng.uniform(2.6, 4.4)), float(rng.uniform(2.4, 4.0)), float(rng.uniform(2.0, 3.6)))
        f.put(('base', 'base2', 'g3')[k % 3], block(rng, F.at(u, v, z), sz, cuts=12, chamfer=(0.7, 0.94),
                                                    R=rot(rz=float(rng.uniform(0, TAU)), rx=float(rng.uniform(-0.3, 0.3)),
                                                          ry=float(rng.uniform(-0.3, 0.3)))), 0.35)
    for k in range(7):
        u = float(rng.uniform(63.0, 74.0))
        v = float(rng.uniform(-9.0, 9.0))
        z = float(rng.uniform(-9.0, -5.0))
        f.put('base2', block(rng, F.at(u, v, z), (float(rng.uniform(3.0, 5.0)), float(rng.uniform(3.0, 5.0)),
                                                   float(rng.uniform(3.0, 5.0))), cuts=12, chamfer=(0.7, 0.94),
                             R=rot(rz=float(rng.uniform(0, TAU)), rx=float(rng.uniform(-0.4, 0.4)))), 0.4)


def _finish(f, F, seed, amp=0.22):
    """Weather it, keep it off the walk and the air beyond its own."""
    _weather(f, seed, amp=amp, scale=0.32, band=0.9)
    _weather(f, seed + 7, amp=amp * 1.6, scale=0.11, band=1.2)
    X = f.axes[0][:, None, None]
    Y = f.axes[1][None, :, None]
    Z = f.axes[2][None, None, :]
    R = np.sqrt(X * X + Y * Y)
    # Never over the walk: past the rim's fascia only (its foot meets the
    # rim's outer face below the balustrade's coping).
    _clamp(f, np.where(R < qg.RIM_R + 0.4, Z - 0.2 + (qg.RIM_R + 0.4 - R) * 3.0, -1e3))
    f.cut_below(-26.0)


def _mesh(bpy, p, f, name, target):
    import gravewyrm_sculpt as gs
    from gwkit import add_sculpt
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, LANDMARK_COLOURS, LANDMARK_KINDS, smooth=False)


def _tree(p):
    from mathutils.bvhtree import BVHTree
    return BVHTree.FromBMesh(p.bm)


def _drape(tree, x, y, z_top=40.0):
    hit = tree.ray_cast(Vector((x, y, z_top)), Vector((0.0, 0.0, -1.0)), z_top + 40.0)
    return None if hit[0] is None else (hit[0], hit[1])


def _glow_line(p, pts, w, shade=1.0):
    """A line of light laid over a surface (pts with z), its faces up."""
    for q0, q1 in zip(pts, pts[1:]):
        strip(p, (q0[0], q0[1]), (q1[0], q1[1]), w, q0[2] + 0.03, (shade, shade, shade), slot=GLOW,
              z1=q1[2] + 0.03)


# ================================================================ the Heat
def landmark_heat(bpy):
    F = Frame(qg.LANDMARKS['heat'])
    p = HSP('Kit_LandmarkHeat', seed=6901, ao=0.5, ao_dist=2.0, dust=0.0)
    rng = np.random.default_rng(6901)
    f = _field(F, 56.0, 82.0, 15.0, -27.0, 17.0, 0.22)
    _foot(f, F, rng)
    # The outcrop: the Hearth's basalt columns heaved up in a crag, highest at
    # the back, broken and leaning outward, split round the crater.
    for (cu, cv) in _bundle_layout(rng, 9.0, 1.15, centre=(0.0, 0.0), jitter=0.22):
        u = 70.5 + cu * 0.9
        v = cv * 1.15
        if u < 62.5:
            continue
        back = (u - 62.0) / 18.0
        top = 3.0 + 10.5 * back + float(rng.uniform(-1.6, 1.6)) - 3.0 * max(0.0, 1.0 - abs(v) / 4.0) * 0.4
        lean = (float(rng.uniform(-0.08, 0.08)), float(rng.uniform(-0.08, 0.08)))
        c = F.at(u, v, 0.0)
        f.put(('basalt', 'basalt2', 'basalt')[int(rng.integers(0, 3))],
              hex_column((c[0], c[1]), float(rng.uniform(1.0, 1.25)), -4.0, max(2.0, top),
                         phase=float(rng.uniform(0, 1)), tilt=lean,
                         top_tilt=(float(rng.uniform(-0.35, 0.35)), float(rng.uniform(-0.35, 0.35)))), 0.08)
    # Heaved boulders of crust down its face toward the platform.
    for k in range(9):
        u = float(rng.uniform(62.0, 67.0))
        v = float(rng.uniform(-8.5, 8.5))
        f.put('lava_crust', block(rng, F.at(u, v, float(rng.uniform(0.2, 1.4))),
                                  (float(rng.uniform(2.0, 3.6)), float(rng.uniform(1.8, 3.2)),
                                   float(rng.uniform(1.6, 2.8))), cuts=12, chamfer=(0.7, 0.95),
                                  R=rot(rz=float(rng.uniform(0, TAU)), ry=float(rng.uniform(-0.3, 0.3)))), 0.3)
    # The crater at its crown and the channel the lava spills down.
    f.sub(Ellipsoid(F.at(71.0, 0.0, 9.0), (4.2, 5.0, 3.0)), 0.8)
    f.sub(Polyline([F.at(70.0, 0.5, 8.0), F.at(66.5, 1.0, 5.0), F.at(63.5, 0.0, 2.2), F.at(61.2, -0.5, 0.6)],
                   [1.4, 1.5, 1.3, 1.1]), 0.5)
    _finish(f, F, 6903, amp=0.26)
    _mesh(bpy, p, f, 'LandmarkHeat', 9000)
    tree = _tree(p)
    prng = p.rng
    # The lava: a pool in the crater, rivers down the channel and two lesser
    # runs, the lip's spill and the fall into the chasm (glow, its own grey
    # the runtime's heat).
    pool = []
    for k in range(28):
        a = TAU * k / 28
        q = F.at(71.0 + math.cos(a) * 3.0, math.sin(a) * 3.6, 0.0)
        pool.append(q)
    hit = _drape(tree, *F.at(71.0, 0.0, 0.0)[:2])
    zc = hit[0].z + 0.05 if hit else 7.0
    bm = p.bm
    centre = bm.verts.new((*F.at(71.0, 0.0, 0.0)[:2], zc))
    ring = [bm.verts.new((q[0], q[1], zc)) for q in pool]
    faces = [bm.faces.new((centre, ring[k], ring[(k + 1) % len(ring)])) for k in range(len(ring))]
    p._paint(faces, (1.0, 1.0, 1.0), GLOW)
    for fc in faces:
        for loop in fc.loops:
            g = 1.0 if loop.vert is centre else 0.7
            loop[p.col] = (g, g, g, 1.0)
    p.facing(faces, (0, 0, 1))
    runs = [[(70.0, 0.5), (68.0, 0.8), (66.5, 1.0), (65.0, 0.6), (63.5, 0.0), (62.2, -0.3), (61.0, -0.5)],
            [(69.0, -3.0), (67.0, -4.2), (65.0, -4.6), (63.0, -5.5), (61.2, -6.0)],
            [(69.5, 3.4), (67.6, 4.8), (65.4, 5.2), (63.3, 6.4), (61.3, 6.8)]]
    for j, run in enumerate(runs):
        pts = []
        for (u, v) in run:
            for t in range(4):
                uu = u - t * 0.4
                h = _drape(tree, *F.at(uu, v + float(prng.uniform(-0.12, 0.12)), 0.0)[:2])
                if h:
                    pts.append((h[0].x, h[0].y, h[0].z))
        if len(pts) > 2:
            w = 1.6 if j == 0 else 0.9
            ribbon(p, [(q[0], q[1]) for q in pts], w, lambda q, pts=pts: _z_near(pts, q) + 0.06, (1.0, 1.0, 1.0),
                   slot=GLOW, edge=(0.55, 0.55, 0.55), taper=False)
            # The spill over the lip and the fall down the keel.
            last = pts[-1]
            u_end = qg.RIM_R + 0.95
            top = F.at(u_end, run[-1][1], 0.0)
            fall = [(top[0], top[1], min(last[2], 0.3))]
            for k in range(1, 12):
                z = fall[0][2] - k * 1.9
                o = F.at(u_end + 0.25 * k ** 0.6, run[-1][1] + float(prng.uniform(-0.1, 0.1)), z)
                fall.append(o)
            _fall(p, fall, w * 1.1, F)
    # Fire crystal bursting out round the crater and between the columns.
    for k in range(10):
        a = float(prng.uniform(0, TAU))
        u = 71.0 + math.cos(a) * float(prng.uniform(3.4, 6.0))
        v = math.sin(a) * float(prng.uniform(3.8, 7.0))
        h = _drape(tree, *F.at(u, v, 0.0)[:2])
        if not h:
            continue
        d = (float(prng.uniform(-0.4, 0.4)), float(prng.uniform(-0.4, 0.4)), 1.0)
        with p.as_kind(PAINT):
            pale_crystal(p, (h[0].x, h[0].y, h[0].z - 0.3), d, float(prng.uniform(1.0, 2.6)),
                         float(prng.uniform(0.25, 0.5)), bright=0.2)
    # Ash on the column heads.
    with p.as_kind(PAINT):
        for k in range(16):
            u = float(prng.uniform(64.0, 78.0))
            v = float(prng.uniform(-9.0, 9.0))
            h = _drape(tree, *F.at(u, v, 0.0)[:2])
            if h and h[1].z > 0.8:
                crystal(p, (h[0].x, h[0].y, h[0].z + 0.02), (1.1, 0.9, 0.12), p.vary(ASH, 0.05), n=16, boxy=1.0,
                        jitter=0.05, yaw=float(prng.uniform(0, TAU)))
    return p


def _z_near(pts, q):
    best = None
    bd = 1e9
    for r in pts:
        d = (r[0] - q[0]) ** 2 + (r[1] - q[1]) ** 2
        if d < bd:
            bd, best = d, r
    return best[2]


def _fall(p, pts, w, F):
    """A sheet of lava falling down the keel's face (glow), facing in toward
    the platform's centre and out (two sided by its pair of faces)."""
    bm = p.bm
    faces = []
    shade = {}
    for side in (0, 1):
        rows = []
        for k, q in enumerate(pts):
            ww = w * 0.5 * (1.0 + 0.6 * k / len(pts))
            a = bm.verts.new((q[0] - F.sx * ww, q[1] - F.sy * ww, q[2]))
            b = bm.verts.new((q[0] + F.sx * ww, q[1] + F.sy * ww, q[2]))
            shade[a] = shade[b] = 0.95 - 0.5 * k / len(pts)
            rows.append((a, b) if side == 0 else (b, a))
        for k in range(len(rows) - 1):
            faces.append(bm.faces.new((rows[k][0], rows[k][1], rows[k + 1][1], rows[k + 1][0])))
    p._paint(faces, (1.0, 1.0, 1.0), GLOW)
    for fc in faces:
        for loop in fc.loops:
            g = shade[loop.vert]
            loop[p.col] = (g, g, g, 1.0)


# ================================================================ the Hammer
def landmark_hammer(bpy):
    F = Frame(qg.LANDMARKS['hammer'])
    p = HSP('Kit_LandmarkHammer', seed=6911, ao=0.5, ao_dist=2.0, dust=0.3)
    rng = np.random.default_rng(6911)
    f = _field(F, 56.0, 82.0, 15.0, -27.0, 18.0, 0.22)
    _foot(f, F, rng)
    # The crag: great blocks of ochre granite heaved up in steps, tallest at
    # the back, split and leaning as the crystal forced them apart.
    rows = [(63.5, 7, 2.2, 3.8), (67.0, 6, 4.0, 6.0), (70.5, 5, 6.5, 9.0), (74.0, 4, 9.5, 12.5), (77.0, 3, 12.0, 15.0)]
    for (u, n, h0, h1) in rows:
        span = 9.0 - (u - 63.5) * 0.25
        for k in range(n):
            v = -span + 2 * span * (k + float(rng.uniform(0.3, 0.7))) / n
            h = float(rng.uniform(h0, h1)) * (1.0 - 0.25 * (abs(v) / span) ** 2)
            w = float(rng.uniform(2.6, 3.8))
            d = float(rng.uniform(2.6, 3.4))
            f.put(('ochre', 'gold_g', 'ochre2', 'gold_g2')[int(rng.integers(0, 4))],
                  block(rng, F.at(u, v, h / 2 - 2.0), (d, w, h + 4.0), cuts=14, chamfer=(0.78, 0.96),
                        R=rot(rz=F.yaw() + float(rng.uniform(-0.25, 0.25)), ry=float(rng.uniform(-0.1, 0.1)),
                              rx=float(rng.uniform(-0.1, 0.1))), top_tilt=0.3), 0.18)
    # The crystal's split: a cleft through the crag where the biggest
    # cluster bursts out toward the platform.
    f.sub(Ellipsoid(F.at(66.0, 0.5, 4.0), (3.0, 2.4, 4.6)), 0.5)
    f.sub(Ellipsoid(F.at(72.0, -4.5, 9.0), (2.0, 1.8, 3.0)), 0.4)
    f.sub(Ellipsoid(F.at(71.0, 5.0, 7.5), (2.0, 1.9, 2.8)), 0.4)
    _finish(f, F, 6913, amp=0.18)
    _mesh(bpy, p, f, 'LandmarkHammer', 9000)
    tree = _tree(p)
    prng = p.rng
    # The golden crystal clusters: the great one out of the cleft toward the
    # platform, two on the shoulders, lesser ones between the blocks.
    clusters = [((66.0, 0.5, 1.0), 14, (5.5, 9.5), (0.8, 1.5), (-0.75, 0.0, 0.85)),
                ((72.0, -4.5, 6.6), 9, (3.4, 6.2), (0.55, 1.0), (-0.4, -0.5, 0.9)),
                ((71.0, 5.0, 5.2), 9, (3.2, 6.0), (0.55, 1.0), (-0.4, 0.5, 0.9)),
                ((76.0, -1.0, 11.5), 6, (2.4, 4.4), (0.4, 0.8), (-0.2, 0.0, 1.0))]
    for (c, n, hh, rr, lean) in clusters:
        base = F.at(*c)
        dl = F.vec(*lean)
        for k in range(n):
            a = TAU * k / n + float(prng.uniform(-0.3, 0.3))
            spread = 0.0 if k == 0 else 0.55
            d = (dl[0] + math.cos(a) * spread, dl[1] + math.sin(a) * spread, dl[2] + (0.3 if k == 0 else 0.0))
            off = F.vec(float(prng.uniform(-0.6, 0.6)), float(prng.uniform(-0.6, 0.6)), 0.0)
            with p.as_kind(PAINT):
                pale_crystal(p, (base[0] + off[0], base[1] + off[1], base[2]), d,
                             float(prng.uniform(*hh)) * (1.0 if k == 0 else 0.62),
                             float(prng.uniform(*rr)) * (1.0 if k == 0 else 0.7), bright=0.15 if k == 0 else 0.0)
    for k in range(14):
        u = float(prng.uniform(63.0, 78.0))
        v = float(prng.uniform(-9.0, 9.0))
        h = _drape(tree, *F.at(u, v, 0.0)[:2])
        if not h or h[0].z < 1.0:
            continue
        d = (float(prng.uniform(-0.5, 0.5)), float(prng.uniform(-0.5, 0.5)), 1.0)
        with p.as_kind(PAINT):
            pale_crystal(p, (h[0].x, h[0].y, h[0].z - 0.2), d, float(prng.uniform(0.8, 2.0)),
                         float(prng.uniform(0.18, 0.38)))
    # Gold seams down the blocks' faces (the vein's light in the stone).
    for k in range(10):
        v = float(prng.uniform(-8.0, 8.0))
        pts = []
        u = float(prng.uniform(70.0, 77.0))
        while u > 62.0:
            h = _drape(tree, *F.at(u, v, 0.0)[:2])
            if h:
                pts.append((h[0].x, h[0].y, h[0].z))
            u -= 0.45
            v += float(prng.uniform(-0.25, 0.25))
        if len(pts) > 4:
            _glow_line(p, pts, float(prng.uniform(0.12, 0.2)), 0.85)
    return p


# ================================================================ the Quench
def landmark_quench(bpy):
    F = Frame(qg.LANDMARKS['quench'])
    p = HSP('Kit_LandmarkQuench', seed=6921, ao=0.45, ao_dist=2.0, dust=0.0)
    rng = np.random.default_rng(6921)
    f = _field(F, 56.0, 82.0, 15.0, -27.0, 8.0, 0.22)
    _foot(f, F, rng)
    # The frost granite foot: heaved slabs, cracked by the cold.
    for k in range(10):
        u = float(rng.uniform(62.5, 76.0))
        v = float(rng.uniform(-9.0, 9.0))
        hgt = 1.4 + (u - 62.0) * 0.22
        f.put(('frost', 'frost2', 'frost_hi')[int(rng.integers(0, 3))],
              block(rng, F.at(u, v, hgt * 0.3 - 0.4), (float(rng.uniform(3.4, 5.2)), float(rng.uniform(3.0, 4.6)), hgt),
                    cuts=14, chamfer=(0.66, 0.92), R=rot(rz=float(rng.uniform(0, TAU)), ry=float(rng.uniform(-0.3, 0.3)),
                                                         rx=float(rng.uniform(-0.3, 0.3))), top_tilt=0.35),
              0.3)
    _finish(f, F, 6923, amp=0.18)
    _mesh(bpy, p, f, 'LandmarkQuench', 7000)
    tree = _tree(p)
    prng = p.rng
    # The ice: great spires leaning together, tallest at the back, a few
    # broken; deep blue at their hearts (the ice slot).
    spires = [(72.0, 0.0, 15.0, 3.0, (-0.15, 0.0)), (69.5, -4.5, 11.0, 2.4, (-0.12, -0.2)),
              (69.0, 4.8, 12.0, 2.5, (-0.15, 0.22)), (75.5, -6.0, 9.0, 2.2, (0.0, -0.28)),
              (75.5, 6.5, 10.0, 2.2, (0.05, 0.3)), (66.0, -1.5, 6.5, 1.8, (-0.35, -0.1)),
              (65.5, 2.5, 5.5, 1.6, (-0.4, 0.15)), (78.0, 0.5, 8.0, 2.4, (0.15, 0.0))]
    for (u, v, h, w, (lu, lv)) in spires:
        hit = _drape(tree, *F.at(u, v, 0.0)[:2])
        z0 = (hit[0].z if hit else 2.0) - 1.2
        base = Vector(F.at(u, v, z0))
        d = Vector(F.vec(lu, lv, 1.0)).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        fwd = d.cross(side).normalized()
        # A great faceted spire: an uneven hexagonal shaft, its waist and
        # shoulder stepped, a slanted break or a point at its head.
        broken = prng.random() < 0.3
        sides = 6
        rings = ((0.0, 1.0), (0.38, 0.92), (0.7, 0.72), (0.86 if not broken else 0.93, 0.48 if not broken else 0.6))
        pts = []
        tw = float(prng.uniform(0, TAU))
        for (t, k) in rings:
            c = base + d * h * t
            for j in range(sides):
                a = tw + TAU * j / sides + float(prng.uniform(-0.12, 0.12))
                rr = w * 0.5 * k * float(prng.uniform(0.86, 1.12))
                pts.append(c + side * math.cos(a) * rr + fwd * math.sin(a) * rr)
        if broken:
            top = base + d * h * 0.97
            for j in range(3):
                pts.append(top + side * float(prng.uniform(-0.3, 0.3)) * w + fwd * float(prng.uniform(-0.3, 0.3)) * w
                           + Vector((0, 0, float(prng.uniform(-0.5, 0.4)))))
        else:
            pts.append(base + d * h + side * float(prng.uniform(-0.15, 0.15)))
        hull(p, [tuple(q) for q in pts], p.vary(ICE_BODY if prng.random() < 0.6 else ICE_DEEP, 0.05), mat=ICE)
        # Shards clustered round its foot.
        for j in range(4):
            a = float(prng.uniform(0, TAU))
            fb = base + side * math.cos(a) * w * 0.7 + fwd * math.sin(a) * w * 0.7
            dd = (d * 0.6 + side * math.cos(a) * 0.5 + fwd * math.sin(a) * 0.5).normalized()
            L = h * float(prng.uniform(0.18, 0.32))
            ww = w * 0.22
            sp = [fb + side * ww * math.cos(TAU * q / 5) + fwd * ww * math.sin(TAU * q / 5) for q in range(5)]
            sp.append(fb + dd * L)
            hull(p, [tuple(q) for q in sp], p.vary(ICE_BODY, 0.06), mat=ICE)
    # Rime on the ledges and icicles off the front.
    with p.as_kind(PAINT):
        for k in range(26):
            u = float(prng.uniform(62.0, 78.0))
            v = float(prng.uniform(-9.5, 9.5))
            hit = _drape(tree, *F.at(u, v, 0.0)[:2])
            if hit and hit[1].z > 0.7:
                crystal(p, (hit[0].x, hit[0].y, hit[0].z + 0.02), (1.4, 1.1, 0.14), p.vary(RIME, 0.03), n=16,
                        boxy=1.0, jitter=0.05, yaw=float(prng.uniform(0, TAU)))
    for k in range(22):
        u = float(prng.uniform(62.0, 66.0))
        v = float(prng.uniform(-8.0, 8.0))
        hit = _drape(tree, *F.at(u, v, 0.0)[:2])
        if not hit or hit[0].z < 0.8:
            continue
        x, y, z = hit[0].x, hit[0].y, hit[0].z - 0.1
        L = float(prng.uniform(0.6, 1.8))
        hull(p, [(x - 0.14, y, z), (x + 0.14, y, z), (x, y - 0.12, z), (x, y + 0.12, z),
                 (x + float(prng.uniform(-0.04, 0.04)), y, z - L)], p.vary(ICE_BODY, 0.05), mat=ICE)
    # Pale crystal glowing at the spires' feet (the runtime's frost light).
    for (u, v, h, w, _l) in spires:
        for k in range(4):
            hit = _drape(tree, *F.at(u + float(prng.uniform(-1.6, 0.4)), v + float(prng.uniform(-1.4, 1.4)), 0.0)[:2])
            if not hit:
                continue
            with p.as_kind(PAINT):
                pale_crystal(p, (hit[0].x, hit[0].y, hit[0].z - 0.2),
                             (float(prng.uniform(-0.5, 0.5)), float(prng.uniform(-0.5, 0.5)), 1.0),
                             float(prng.uniform(0.7, 1.6)), float(prng.uniform(0.15, 0.3)), bright=0.1)
    # Frost veins of light down the granite.
    for k in range(8):
        v = float(prng.uniform(-8.0, 8.0))
        pts = []
        u = float(prng.uniform(68.0, 74.0))
        while u > 62.0:
            hit = _drape(tree, *F.at(u, v, 0.0)[:2])
            if hit:
                pts.append((hit[0].x, hit[0].y, hit[0].z))
            u -= 0.4
            v += float(prng.uniform(-0.3, 0.3))
        if len(pts) > 4:
            _glow_line(p, pts, float(prng.uniform(0.1, 0.16)), 0.8)
    return p


# ================================================================ the Breath
def landmark_breath(bpy):
    F = Frame(qg.LANDMARKS['breath'])
    p = HSP('Kit_LandmarkBreath', seed=6931, ao=0.45, ao_dist=2.0, dust=0.0)
    rng = np.random.default_rng(6931)
    f = _field(F, 56.0, 82.0, 15.0, -27.0, 21.0, 0.22)
    _foot(f, F, rng)
    # The horns: storm stone wrung into tall twisted spires, curling inward
    # over the platform, bored through by the wind.
    horns = [((72.0, 0.0), 19.0, 3.0, (-0.35, 0.0), 0.9), ((69.0, -6.0), 14.0, 2.4, (-0.25, 0.35), -0.8),
             ((69.5, 6.2), 15.0, 2.5, (-0.25, -0.35), 0.8), ((76.0, -3.2), 11.0, 2.0, (0.1, 0.2), 0.6),
             ((76.0, 4.0), 12.0, 2.0, (0.1, -0.25), -0.6)]
    tips = []
    for j, ((u, v), h, r, (cu, cv), twist) in enumerate(horns):
        pts = []
        radii = []
        n = 9
        for k in range(n + 1):
            t = k / n
            bend = t * t
            q = F.at(u + cu * h * bend, v + cv * h * bend + math.sin(t * 3.0 + j) * 0.5 * t, -3.0 + h * t)
            pts.append(q)
            radii.append(r * (1.0 - 0.82 * t) + 0.12)
        f.put(('storm', 'storm_v', 'storm2', 'storm_t')[j % 4], Polyline(pts, radii), 0.7)
        # The wind's twist: blocks wrapped round it, turning as they rise.
        z = -1.0
        k = 0
        while z < h * 0.75:
            t = (z + 3.0) / h
            bend = t * t
            c = F.at(u + cu * h * bend, v + cv * h * bend, z)
            bw = r * 2.1 * (1.0 - 0.75 * t)
            f.put(('storm', 'storm2', 'storm_v')[k % 3], block(rng, c, (bw, bw * 0.8, 1.6), cuts=8,
                                                             chamfer=(0.8, 0.96), R=rot(rz=twist * k * 0.5)), 0.35)
            z += 1.5
            k += 1
        tips.append(pts[-1])
        # Bored by the wind.
        for k in range(2):
            t = float(rng.uniform(0.25, 0.6))
            c = F.at(u + cu * h * t * t, v + cv * h * t * t, -3.0 + h * t)
            f.sub(Ellipsoid(c, (r * 1.6, r * 0.45, r * 0.5), rot(rz=float(rng.uniform(0, TAU)))), 0.12)
    _finish(f, F, 6933, amp=0.2)
    _mesh(bpy, p, f, 'LandmarkBreath', 9000)
    tree = _tree(p)
    prng = p.rng
    # Violet crystal crowning each horn (the lightning's anchors).
    for q in tips:
        for k in range(5):
            a = TAU * k / 5 + float(prng.uniform(-0.3, 0.3))
            lean = 0.0 if k == 0 else 0.55
            with p.as_kind(PAINT):
                pale_crystal(p, (q[0], q[1], q[2] - 0.4), (math.cos(a) * lean, math.sin(a) * lean, 1.0),
                             float(prng.uniform(1.2, 2.2)) * (1.0 if k == 0 else 0.55),
                             float(prng.uniform(0.25, 0.4)) * (1.0 if k == 0 else 0.7), bright=0.25 if k == 0 else 0)
    # Veins of light spiralling up each horn.
    for j, ((u, v), h, r, (cu, cv), twist) in enumerate(horns):
        pts = []
        for k in range(60):
            t = 0.05 + 0.85 * k / 60
            bend = t * t
            cx, cy, cz = F.at(u + cu * h * bend, v + cv * h * bend, -3.0 + h * t)
            a = twist * 9.0 * t + j
            rr = r * (1.0 - 0.82 * t) + 0.18
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, cz))
        for q0, q1 in zip(pts, pts[1:]):
            _riser(p, q0, q1, 0.16, 0.85)
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


__all__ = ['landmark_heat', 'landmark_hammer', 'landmark_quench', 'landmark_breath']
