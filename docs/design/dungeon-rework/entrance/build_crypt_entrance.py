"""The Hollow Crypt world entrance: the Fallen Chapel and its crypt stair.

  blender -b --factory-startup --python build_crypt_entrance.py -- --out DIR
      [--terrain DIR] [--renders all|quick|beauty|maps|none] [--tag NAME]

The roofless mother church of the Chapel of the Sleep (Eastbrook Vale, door
(80, 90)): the south gable with its empty rose window and empty bellcote, the
broken nave walls round the existing column ring, a low apse, and at the door
the vaulted crypt stair the altar stood over, a dead yew clutching it, two
weathered mourners flanking its portal; the dragged altar slab, the fallen
cracked bell, the ledger lectern, the vestry nook, the shrouded font, the
headstones, the lychgate and the stepping flags of the approach.

Run from the repo: --out tmp/asset_src/hollow_crypt_entrance --terrain <dir of
the probe's crypt_heightgrid.json and crypt_surroundings.json> (probe.mts
beside this file writes them: `npx tsx probe.mts crypt 80 90 <dir> 40 120`),
then support_audit.py on the saved .blend (it lists every piece that hangs in
the air: the list must be empty), then
node scripts/assets/hollow_crypt_entrance/build.mjs.

Nothing here may float. Walls settle themselves (crypt_ruin_kit.Ruin.wall);
fallen stones are laid on what is under them (lie()); a coping lies on stones
cut to its rake; slates lie on battens; and a part that was rebuilt after the
model was approved keeps its first version inside ghost(), run only for its
random draws, so everything the piece builds afterwards is unchanged.

Local game coords via ec.B(lx, lz, y): lx = x - 80 (+ WEST), lz = z - 90
(+ NORTH), y = y - terrainHeight(80, 90). In Blender that is X = lx, Y = -lz
(so SOUTH is +Y), Z = y. Four GLBs share ONE origin, the door at its terrain
height:
  hollow_crypt_entrance.glb         the gable, the stair-house, the details
  hollow_crypt_entrance_walls.glb   the nave walls, the chancel and the apse
  hollow_crypt_entrance_props.glb   headstones, lychgate, yard walls, the yew
  hollow_crypt_entrance_growth.glb  ivy, grass, bramble, moss, fallen leaves
Materials: KitStone (lit, vertex colour), KitLeaf (lit, double sided),
KitVoid (unlit black: the dark of the stair behind the engine's portal).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'kit'))
sys.path.insert(0, HERE)
import crypt_ruin_kit as rk  # noqa: E402
import entrance_common as ec  # noqa: E402
from crypt_ruin_kit import (K_CLOTH, K_EARTH, K_LEAF, K_METAL, K_RAW, K_STONE, K_WOOD, LEAF, LIME, LIME_COOL,  # noqa: E402
                            LIME_DARK, LIME_PALE, LIME_WARM, STONE, TAU, VOID, B, Ruin, arch_hole, arch_points)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


OUT = arg('--out', os.path.join(HERE, 'out'))
TERRAIN = arg('--terrain', os.path.join(OUT, 'terreno'))
RENDERS = arg('--renders', 'none')
TAG = arg('--tag', '')
os.makedirs(OUT, exist_ok=True)
GR = ec.Ground(os.path.join(TERRAIN, 'crypt_heightgrid.json'))
SURR = json.load(open(os.path.join(TERRAIN, 'crypt_surroundings.json')))
gh = GR.h

BRONZE = (0.45, 0.33, 0.17)
TIMBER = (0.62, 0.53, 0.42)
TIMBER_GREY = (0.68, 0.64, 0.56)
SLATE = (0.5, 0.49, 0.47)
IRON = (0.20, 0.19, 0.19)
TALLOW = (0.86, 0.80, 0.62)
TALLOW_OLD = (0.70, 0.62, 0.44)
CLOTH_W = (0.80, 0.78, 0.71)
CLOTH_G = (0.50, 0.53, 0.50)
BARK = (0.27, 0.19, 0.15)
BARK_PALE = (0.42, 0.36, 0.30)
YEW = ((0.11, 0.21, 0.11), (0.15, 0.27, 0.13), (0.09, 0.16, 0.09))
EARTH = (0.24, 0.2, 0.15)
FLAG = (0.5, 0.5, 0.46)
LITTER = ((0.62, 0.42, 0.14), (0.52, 0.28, 0.10), (0.40, 0.26, 0.12), (0.70, 0.58, 0.20))
VOIDC = (0.0, 0.0, 0.0)
COLLIDERS = []
FOOTINGS = []
SOCKETS = {}
CANDLES = []          # (lx, y, lz, height): every wick, for the engine's flames
TOPS = []             # wall tops (Blender point, width) for the growth pass

# Layout (door-local). The footprint, the door lane, the quest objects' clear
# ground and the socket spots are the approved v1 placement.
NAVE_X = 9.0
GABLE_Z = -22.0
NAVE_END_Z = -2.5
CHANCEL_X = 7.8
APSE_C = (0.0, 2.5)
APSE_R = 7.8
LANE = 1.3            # half width of the open portal lane
SH = dict(hw=3.4, z0=-0.75, z1=5.3)
QUEST = [(4, -2), (-4, 2), (-2, -6), (3, -2), (6, 2), (-2, -4)]
EXIT_DROP = (0.0, -4.0)


def collider_obb(name, cx, cz, hw, hd, rot, top, stand=None):
    row = {'name': name, 'type': 'obb', 'lx': round(cx, 3), 'lz': round(cz, 3), 'hw': round(hw, 3),
           'hd': round(hd, 3), 'rot': round(rot, 4), 'top': round(top, 2)}
    if stand is not None:
        row['standTop'] = round(stand, 2)
    COLLIDERS.append(row)


def collider_circle(name, cx, cz, r, top, stand=None):
    row = {'name': name, 'type': 'circle', 'lx': round(cx, 3), 'lz': round(cz, 3), 'r': round(r, 3),
           'top': round(top, 2)}
    if stand is not None:
        row['standTop'] = round(stand, 2)
    COLLIDERS.append(row)


def footing(name, cx, cz, hw, hd, rot, bottom):
    FOOTINGS.append((name, cx, cz, hw, hd, rot, bottom))


def base_y(points, bury=0.45):
    return min(gh(x, z) for (x, z) in points) - bury


def gb(x, y):
    """Ground height at a Blender XY."""
    return gh(x, -y)


def P(name, **kw):
    return Ruin('Entrance_' + name, **kw)


def south_plane(lz):
    """A wall plane facing south at lz: plane coords (x across, y south, z up)."""
    return Matrix.Translation(B(0, lz, 0))


def stack(p, lx, lz, w, d, y0, y1, course=(0.55, 0.8), color=None, yaw=0.0, bevel=None, taper=0.0, ragged=False):
    """A pier of dressed blocks, one per course."""
    y = y0
    k = 0
    while y < y1 - 0.12:
        h = min(p.rng.uniform(*course), y1 - y)
        s = 1.0 - taper * (y - y0) / max(0.1, y1 - y0)
        jw = 1.0 + (0.05 if k % 2 else -0.02) + (p.rng.random() - 0.5) * 0.04
        top = ragged and y + h >= y1 - 0.12
        p.hewn(B(lx, lz, y + h / 2), (w * s * jw, d * s * (2.0 - jw), h - 0.03), color or p.tone(lx + k, y), bevel=bevel,
               yaw=yaw + (p.rng.random() - 0.5) * (0.12 if top else 0.025), roll=(p.rng.random() - 0.5) * (0.1 if top else 0.0))
        y += h
        k += 1


def pier(p, lx, lz, w, d, y0, y1, course=(0.42, 0.7), ragged=False):
    """A coursed buttress or pier (w across x, d along z): one to three rough
    stones a course along its long side, the joints breaking from course to
    course, its long faces pillowed."""
    rng = p.rng
    along_z = d >= w
    long_, short = (d, w) if along_z else (w, d)
    y = y0
    k = 0
    while y < y1 - 0.1:
        h = min(rng.uniform(*course), y1 - y)
        n = 1 if long_ < 1.15 else (2 if long_ < 2.1 else 3)
        cuts = [0.0] + sorted(rng.uniform(0.3, 0.7) if n == 2 else (0.22 + 0.2 * rng.random() + 0.33 * i)
                              for i in range(n - 1)) + [1.0]
        last = y + h >= y1 - 0.1
        for i in range(n):
            if last and ragged and rng.random() < 0.4:
                continue
            c0, c1 = cuts[i] * long_ - long_ / 2, cuts[i + 1] * long_ - long_ / 2
            bh = (h - 0.016) * (1 - (rng.random() * 0.3 if last and ragged else 0.0))
            ctr = B(lx, lz + (c0 + c1) / 2, y + bh / 2) if along_z else B(lx + (c0 + c1) / 2, lz, y + bh / 2)
            rot = Matrix.Rotation((math.pi / 2 if along_z else 0.0) + (rng.random() - 0.5) * 0.03, 3, 'Z')
            p.stone(ctr, (c1 - c0 - 0.018, short * (0.97 + 0.07 * rng.random()), bh), p.tone(lx + k, y), rot=rot,
                    knock=0.3 if last else 0.12)
        y += h
        k += 1


def candle(p, lx, lz, y, h, r=0.055, lean=0.0):
    """A Gravecaller tallow candle with its melt pool and drips (the flame is
    the engine's, at the wick recorded in CANDLES)."""
    c = p.vary(TALLOW if p.rng.random() < 0.6 else TALLOW_OLD, 0.06)
    with p.as_kind(K_RAW):
        p.lathe(B(lx, lz, y - 0.01), [(r * 2.4, 0), (r * 2.0, 0.03), (r * 1.15, 0.05), (r, h * 0.9), (r * 0.8, h)], 7, c)
        for _ in range(2):
            a = p.rng.random() * TAU
            dh = h * (0.3 + p.rng.random() * 0.5)
            p.prism(B(lx + math.cos(a) * r, lz + math.sin(a) * r, y + h - dh), 4, r * 0.3, r * 0.2, dh, TALLOW_OLD)
        p.box(B(lx, lz, y + h + 0.025), (0.012, 0.012, 0.05), (0.05, 0.04, 0.04))
    CANDLES.append((round(lx, 3), round(y + h + 0.05, 3), round(lz, 3), round(h, 3)))


def candle_cluster(p, lx, lz, y, n, spread=0.3, tall=0.5):
    for k in range(n):
        a = p.rng.random() * TAU
        r = spread * math.sqrt(p.rng.random())
        candle(p, lx + math.cos(a) * r, lz + math.sin(a) * r, y, 0.12 + p.rng.random() * tall)
    p.soot.append((Vector(B(lx, lz, y + 0.4)), 1.5, 0.5))


LIE = 0.45      # how much of its tumble a fallen stone keeps once it has come to rest


def lie(p, x, z, rot, dims, reach=0.0, sink=0.03):
    """The centre height at which a fallen stone at local game (x, z) comes to
    rest. On the ground: bedded, every corner of its bed under the turf. With
    reach > 0 (how far above the ground a heap may already stand there): on
    whatever of this piece lies under it, two of its bed's four corners sunk
    in that, never lower than its bed in the ground."""
    c = B(x, z, 0)
    bed = [rot @ Vector((i * dims[0] / 2, j * dims[1] / 2, -dims[2] / 2)) for (i, j) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ground = min(gb(c.x + q.x, c.y + q.y) - q.z for q in bed) - sink
    if reach <= 0:
        return ground
    on = sorted(p.surface(c.x + q.x, c.y + q.y, gb(c.x + q.x, c.y + q.y) + reach, gb(c.x + q.x, c.y + q.y)) - q.z
                for q in bed)
    return max(ground, (on[1] + on[2]) / 2 - sink - 0.06)


def rubble(p, lx, lz, radius, count, size=(0.25, 0.7), lift=0.0):
    """Fallen walling stones and broken lumps, half sunk in the ground. With
    lift, a heap: each stone comes to rest on the ones that fell before it
    (lift is how high the heap may stand), never held up by nothing."""
    rng = p.rng
    reach = 2 * lift + 1.0 if lift > 0 else 0.0
    for _ in range(count):
        a = rng.random() * TAU
        r = radius * math.sqrt(rng.random())
        x, z = lx + math.cos(a) * r, lz + math.sin(a) * r
        s = rng.uniform(*size)
        # One that would land inside standing masonry is not there (its draws
        # are still made, so the rest of the piece comes out as before).
        g, c = gh(x, z), B(x, z, 0)
        buried = p.surface(c.x, c.y, g + 14.0, g) > g + max(reach, 0.9) + 0.4
        with (p.ghost() if buried else p.as_kind(p.kind)):
            if rng.random() < 0.65:
                rot = Matrix.Rotation(rng.random() * TAU, 3, 'Z') @ \
                    Matrix.Rotation(rng.uniform(-0.35, 0.35) * LIE, 3, 'X') @ Matrix.Rotation(rng.uniform(-0.3, 0.3) * LIE, 3, 'Y')
                dims = (s * rng.uniform(1.2, 1.9), s * rng.uniform(0.8, 1.2), s * rng.uniform(0.55, 0.8))
                col = p.tone(x, z)
                seat = lie(p, x, z, rot, dims, reach)
                # (one lifted onto the heap shows its bed from below: close it)
                p.stone(B(x, z, seat), dims, col, rot=rot, chip=0.12, knock=0.5,
                        bottom=seat > lie(p, x, z, rot, dims) + 0.01)
            else:
                col = p.tone(x, z)
                dims = (s * 1.3, s, s * 0.7)
                seat = lie(p, x, z, Matrix.Identity(3), (dims[0] * 0.6, dims[1] * 0.6, 0.0), reach, sink=0.0)
                # (on a heap a lump beds deeper: its underside is a point)
                p.rock(B(x, z, seat + s * (0.04 if reach > 0 else 0.15)), dims, col, jitter=0.3, subdivisions=1)


def earth_skirt(p, a, b, width=1.0, step=1.7):
    """Bare trodden earth along a wall foot (a to b, local game): low ragged
    fans of soil draped on the ground, so stone never meets clean grass."""
    rng = p.rng
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(L / step))
    with p.as_kind(K_EARTH):
        for i in range(n):
            if rng.random() < 0.22:
                continue
            t = (i + 0.5 + (rng.random() - 0.5) * 0.5) / n
            cx, cz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            r = width * rng.uniform(0.65, 1.25)
            col = p.vary(EARTH if rng.random() < 0.7 else (0.2, 0.24, 0.15), 0.12)
            ctr = p.bm.verts.new(B(cx, cz, gh(cx, cz) + 0.07))
            ring = []
            for k in range(7):
                ang = TAU * k / 7 + rng.random() * 0.5
                rr = r * rng.uniform(0.6, 1.1)
                x, z = cx + math.cos(ang) * rr * 1.25, cz + math.sin(ang) * rr
                ring.append(p.bm.verts.new(B(x, z, gh(x, z) + 0.012)))
            for k in range(7):
                f = p.bm.faces.new((ctr, ring[k], ring[(k + 1) % 7]))
                f.material_index = STONE
                f[p.kindL] = K_EARTH
                f.smooth = True
                ls = f.loops
                ls[0][p.col] = (*col, 1.0)
                ls[1][p.col] = (*rk.scale(col, 1.25), 1.0)
                ls[2][p.col] = (*rk.scale(col, 1.25), 1.0)


def sunk_blocks(p, a, b, count, off=1.1):
    """Fallen walling stones lying where they dropped along a wall, half sunk."""
    rng = p.rng
    for _ in range(count):
        t = rng.random()
        side = rng.choice((-1, 1)) * rng.uniform(0.7, off + 1.2)
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1.0
        x = a[0] + dx * t - dz / L * side
        z = a[1] + dz * t + dx / L * side
        sz = rng.uniform(0.3, 0.62)
        rot = Matrix.Rotation(rng.random() * TAU, 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 3, 'X')
        dims = (sz * rng.uniform(1.3, 2.0), sz * rng.uniform(0.9, 1.3), sz * 0.75)
        col = p.tone(x, z)
        # (its tilted bed never shows a corner over the turf)
        p.stone(B(x, z, min(gh(x, z) + sz * 0.12, lie(p, x, z, rot, dims))), dims, col, rot=rot, chip=0.14, knock=0.6)


def moss_pad(p, pos, size):
    """A cushion of moss: a low smooth dome (size = (radius, _, height))."""
    with p.as_kind(K_RAW):
        r, h = size[0] * 0.5, size[2]
        p.lathe(Vector(pos) - Vector((0, 0, 0.03)), [(r, 0), (r * 0.62, h * 0.72), (0.0001, h)], 6,
                p.vary(rk.MOSS_DEEP if p.rng.random() < 0.6 else rk.MOSS_BRIGHT, 0.12), phase=p.rng.random())


# ================================================================ the gable
def bellcote(p, by, half):
    """The empty bellcote, one coursed mass standing on the gable's squared
    apex: the base slab, the two piers and the spandrels over the pointed
    opening built as a single wall, the impost band, the arch ring, the west
    rake of its little gable still under its coping (the east rake has fallen
    away in steps), the bare iron yoke let into the jambs and a frayed end of
    rope. No bell: it lies cracked beside the crypt stair."""
    M = south_plane(GABLE_Z)
    hw = half - 0.12
    spring, rise, open_ = by + 2.3, 0.85, 0.66      # (the ring stands a full course under the little gable)
    crown = by + 4.22
    p.hewn(B(0, GABLE_Z, by + 0.22), (2 * half, 1.5, 0.52), LIME_PALE, bevel=0.08)      # (bedded a little into the apex)

    def line(u):
        x = u - hw
        if x >= -0.25:
            return crown - 0.7 * max(0.0, x)
        return crown - 0.3 - 1.2 * rk.smooth(-0.25, -1.45, x)

    p.wall((-hw, GABLE_Z), (hw, GABLE_Z), 1.3, by + 0.48, lambda t: line(t * 2 * hw),
           holes=(arch_hole(open_, spring, rise, hw),), course=(0.48, 0.66), unit=(1.0, 1.9), missing=0.0, ragged=0.0,
           dress=((hw - 0.25, 2 * hw, line, (hw,)),), open_ends=(True, True))
    for sx in (-1, 1):
        p.hewn(B(sx * 1.1, GABLE_Z, spring - 0.1), (1.06, 1.44, 0.22), LIME_PALE, bevel=0.06)
    bp = [(x, spring + z) for (x, z) in arch_points(open_, rise, 3)]
    p.arch(bp, 0.4, 1.4, LIME_PALE, M, bevel=0.04, chip=0.04)
    # The west rake's coping: two stones bedded on the cut masonry, and the saddle.
    for k in range(2):
        x0, x1 = 0.22 + (hw - 0.22) * k / 2, 0.22 + (hw - 0.22) * (k + 1) / 2
        z0, z1 = line(hw + x0), line(hw + x1)
        ln = math.hypot(x1 - x0, z1 - z0)
        up = Vector((-(z1 - z0), 0, x1 - x0)) / ln
        up = up if up.z > 0 else -up
        p.hewn(Vector(B((x0 + x1) / 2, GABLE_Z, (z0 + z1) / 2)) + up * 0.1, (ln - 0.03, 1.46, 0.22),
               p.vary(LIME_PALE, 0.05), roll=-math.atan2(z1 - z0, x1 - x0), bevel=0.05)
    q = B(-0.02, GABLE_Z, 0)
    p.hewn(B(-0.02, GABLE_Z, p.surface(q.x, q.y, crown + 1.0, by) + 0.13), (0.5, 1.5, 0.34), LIME_PALE, bevel=0.06, roll=0.04)
    with p.as_kind(K_METAL):
        p.sweep([M @ Vector((-0.7, 0, spring + 0.16)), M @ Vector((0.7, 0, spring + 0.16))], 0.07, 0.07, IRON, sides=5)
    with p.as_kind(K_CLOTH):
        p.sweep([M @ Vector((0.0, 0, spring + 0.1)), M @ Vector((0.04, 0.03, spring - 0.5)),
                 M @ Vector((-0.07, 0.07, spring - 1.15))], 0.04, 0.06, (0.42, 0.37, 0.27), sides=4)


def gable():
    p = P('Gable', moss=1.0)
    L = 2 * NAVE_X + 1.2
    a, b = (-L / 2, GABLE_Z), (L / 2, GABLE_Z)
    y0 = base_y([(x, GABLE_Z) for x in range(-10, 11)])
    eave, apex = 7.6, 17.6
    rose_y, rose_r = 11.2, 2.8
    door_hw, door_spring, door_rise = 1.75, 3.1, 2.3
    M = south_plane(GABLE_Z)

    def top_fn(t):
        x = t * L - L / 2
        rake = eave + (apex - eave) * max(0.0, 1 - abs(x) / (L / 2))
        if -9.05 < x < -3.5:      # the east shoulder has fallen in
            k = math.sin(math.pi * (x + 9.05) / 5.55) ** 0.6
            rake -= 0.5 + 4.4 * k
        if x <= -9.05:
            rake = 5.1
        return rake

    door = arch_hole(door_hw, door_spring, door_rise, L / 2)
    lancets = [arch_hole(0.46, 5.1, 1.05, L / 2 + sx * 5.7) for sx in (-1, 1)]

    def holes(u, y):
        if door(u, y):
            return True
        if math.hypot(u - L / 2, y - rose_y) < rose_r + 0.1:
            return True
        return y > 2.7 and (lancets[0](u, y) or lancets[1](u, y))

    def lean(u, n, y):       # the wounded east side leans a hand's breadth south
        x = u - L / 2
        k = rk.smooth(-2.0, -8.5, x) * max(0.0, y - 2.0)
        return (0.0, 0.022 * k, -0.012 * k * rk.smooth(-5.0, -8.5, x))

    # Where the gable still wears its coping (the whole west rake, the top of
    # the east one) its stones are cut to the rake, and under the bellcote the
    # apex is built up square to carry it: nothing lies on a stepped edge.
    by = apex - 0.1
    cote = 1.7      # half width of the bellcote's base

    def rake_line(u):
        x = u - L / 2
        return by if abs(x) <= cote else eave + (apex - eave) * (1 - abs(x) / (L / 2))

    TOPS.extend(p.wall(a, b, 1.15, y0 + 0.5, top_fn, holes=(holes,), course=(0.45, 0.78), unit=(1.1, 2.7), deform=lean,
                       missing=0.03, dress=((L / 2 - 3.3, L, rake_line, (L / 2 - cote, L / 2 + cote)),)))
    # The plinth course, proud of both faces.
    x = -L / 2
    while x < L / 2 - 0.2:
        w = min(p.rng.uniform(1.3, 2.3), L / 2 - x)
        if not (x + w > -door_hw - 0.5 and x < door_hw + 0.5):
            p.hewn(B(x + w / 2, GABLE_Z, y0 + 0.36), (w - 0.04, 1.5, 0.72), p.vary(LIME_DARK, 0.07), bevel=0.07)
        x += w
    footing('gable_wall', 0, GABLE_Z, L / 2, 0.6, 0.0, y0)
    # The south doorway: two orders, dressed jambs, impost blocks, a hood mould.
    pts = [(x, door_spring + z) for (x, z) in arch_points(door_hw, door_rise, 6)]
    p.arch(pts, 0.5, 1.36, LIME_PALE, M)
    inner = [(x, door_spring + z) for (x, z) in arch_points(door_hw - 0.3, door_rise - 0.32, 5)]
    p.arch(inner, 0.3, 0.62, LIME, M, bevel=0.0)
    p.roll(pts, 0.1, p.vary(LIME_PALE, 0.04), M, y_off=0.66, out=0.62)
    for sx in (-1, 1):
        stack(p, sx * (door_hw + 0.27), GABLE_Z, 0.56, 1.36, y0 + 0.2, door_spring - 0.2, color=None)
        stack(p, sx * (door_hw - 0.15), GABLE_Z, 0.3, 0.62, y0 + 0.2, door_spring - 0.2, bevel=0.0)
        p.hewn(B(sx * (door_hw + 0.14), GABLE_Z, door_spring - 0.1), (0.92, 1.46, 0.24), LIME_PALE, bevel=0.06)
    # The lancets' heads and sills.
    for sx in (-1, 1):
        lp = [(sx * 5.7 + x, 5.1 + z) for (x, z) in arch_points(0.46, 1.05, 3)]
        p.arch(lp, 0.26, 1.24, LIME_PALE, M, bevel=0.0)
        p.hewn(B(sx * 5.7, GABLE_Z, 2.6), (1.5, 1.34, 0.22), LIME_PALE, bevel=0.05)
    # The rose window: a ring of voussoirs, an inner order, a hood over its
    # upper half, and what is left of the tracery.
    n = 22
    ring = [(math.cos(TAU * i / n) * rose_r, rose_y + math.sin(TAU * i / n) * rose_r) for i in range(n + 1)]
    p.arch(ring, 0.6, 1.34, LIME_PALE, M, center=(0, rose_y))
    inner = [(math.cos(TAU * i / 16) * (rose_r - 0.2), rose_y + math.sin(TAU * i / 16) * (rose_r - 0.2))
             for i in range(17)]
    p.arch(inner, 0.2, 0.56, LIME, M, bevel=0.0, center=(0, rose_y))
    hood = [(math.cos(math.pi * (1.08 - 1.16 * i / 14)) * (rose_r + 0.72),
             rose_y + math.sin(math.pi * (1.08 - 1.16 * i / 14)) * (rose_r + 0.72)) for i in range(15)]
    p.roll(hood, 0.1, p.vary(LIME_PALE, 0.04), M, y_off=0.66)
    with p.as_kind(K_STONE):
        p.prism(M @ Vector((0, -0.24, rose_y)), 8, 0.5, 0.5, 0.48, LIME_PALE, axis=(0, 1, 0))
        snapped = (2, 5)

        def rp(ang, rad):
            return M @ Vector((math.cos(ang) * rad, 0, rose_y + math.sin(ang) * rad))

        for k in range(8):
            a0 = TAU * k / 8 + 0.39
            r1 = rose_r - 0.16
            for (ra, rb) in (((0.45, 0.95), (r1 - 0.45, r1)) if k in snapped else ((0.45, r1),)):
                p.sweep([rp(a0, ra), rp(a0, rb)], 0.12, 0.1, p.vary(LIME_PALE if k not in snapped else LIME, 0.05), sides=6)
            am = a0 + TAU / 16
            if k not in (1, 2, 5):      # a small oculus between two spokes, out by the ring
                rc, ro = rose_r * 0.696, rose_r * 0.21      # (bedded in the ring, fused to the spokes beside it)
                ring = [M @ Vector((math.cos(am) * rc + math.cos(b) * ro, 0, rose_y + math.sin(am) * rc + math.sin(b) * ro))
                        for b in (TAU * i / 8 for i in range(9))]
                p.sweep(ring, 0.07, 0.07, p.vary(LIME_PALE, 0.05), sides=4, cap=False)
            if k not in snapped and (k + 1) % 8 not in snapped:      # the foil ring round the hub
                arc = [rp(a0 + TAU / 8 * i / 4, rose_r * 0.37 + 0.13 * math.sin(math.pi * i / 4)) for i in range(5)]
                p.sweep(arc, 0.08, 0.08, p.vary(LIME_PALE, 0.05), sides=4, cap=False)
    # The string course under the gable, lost where the shoulder fell.
    x = -L / 2 + 0.2
    while x < L / 2 - 0.3:
        w = min(p.rng.uniform(1.4, 2.2), L / 2 - x)
        if x > -3.6 and not (abs(x + w / 2) < 0.2):
            p.hewn(B(x + w / 2, GABLE_Z - 0.04, eave - 0.05), (w - 0.04, 1.36, 0.2), LIME_PALE, bevel=0.05)
        x += w
    # The coping and the bellcote were rebuilt to sit on the masonry; their
    # first version still runs, unseen, for its random draws (ghost()), so the
    # buttresses, the earth and the rubble below come out as they were.
    with p.ghost():
        # Coping on the rakes (whole on the west, three stones left on the east).
        for s in (-1, 1):
            for k in range(9):
                t0, t1 = k / 9, (k + 1) / 9
                x0, x1 = s * (L / 2) * (1 - t0), s * (L / 2) * (1 - t1)
                z0 = eave + (apex - eave) * t0
                z1 = eave + (apex - eave) * t1
                if s < 0 and k < 6:
                    continue
                if s > 0 and k == 5:
                    continue
                p.hewn(B((x0 + x1) / 2, GABLE_Z, (z0 + z1) / 2 + 0.2), (abs(x1 - x0) * 1.1, 1.5, 0.3), p.vary(LIME_PALE, 0.05),
                       roll=-math.atan2(z1 - z0, x1 - x0), bevel=0.06)
        p.hewn(B(L / 2 - 0.1, GABLE_Z, eave + 0.05), (1.1, 1.6, 0.5), LIME_PALE, bevel=0.07)
        # The empty bellcote: two thick piers, a heavy pointed arch, what is left of
        # its little gable, the bare iron yoke and a frayed end of rope. No bell:
        # it lies cracked beside the crypt stair.
        p.hewn(B(0, GABLE_Z, by + 0.24), (3.4, 1.5, 0.48), LIME_PALE, bevel=0.08)
        for sx in (-1, 1):
            pier(p, sx * 1.12, GABLE_Z, 0.9, 1.3, by + 0.48, by + 2.5, course=(0.4, 0.6))
            p.hewn(B(sx * 1.1, GABLE_Z, by + 2.6), (1.06, 1.44, 0.22), LIME_PALE, bevel=0.06)
        bp = [(x, by + 2.7 + z) for (x, z) in arch_points(0.66, 0.85, 3)]
        p.arch(bp, 0.5, 1.3, LIME_PALE, M, bevel=0.05, chip=0.07)
        p.hewn(B(0.92, GABLE_Z, by + 3.72), (1.75, 1.46, 0.4), p.vary(LIME, 0.05), roll=0.72, bevel=0.06, chip=0.12)
        p.hewn(B(-1.2, GABLE_Z, by + 3.3), (0.95, 1.4, 0.4), p.vary(LIME, 0.05), roll=-0.72, bevel=0.06, chip=0.16)
        p.stone(B(-0.5, GABLE_Z, by + 3.8), (0.7, 1.2, 0.45), p.tone(0, by), chip=0.14, knock=0.7, bottom=True,
                rot=Matrix.Rotation(-0.5, 3, 'Y'))
        with p.as_kind(K_METAL):
            p.sweep([M @ Vector((-0.7, 0, by + 2.86)), M @ Vector((0.7, 0, by + 2.86))], 0.07, 0.07, IRON, sides=5)
        with p.as_kind(K_CLOTH):
            p.sweep([M @ Vector((0.0, 0, by + 2.8)), M @ Vector((0.04, 0.03, by + 2.2)), M @ Vector((-0.07, 0.07, by + 1.55))],
                    0.04, 0.06, (0.42, 0.37, 0.27), sides=4)
    with p.side('coping'):
        # Coping on the rakes (whole on the west but one stone, the top two left
        # on the east): each stone as long as its stretch of the rake, bedded on
        # the cut stones, dying against the bellcote's base.
        for s in (-1, 1):
            for k in range(8):
                if (s < 0 and k < 6) or (s > 0 and k == 5):
                    continue
                x0 = s * (L / 2) * (1 - k / 9)
                x1 = s * max(cote + 0.02, (L / 2) * (1 - (k + 1) / 9))
                z0, z1 = rake_line(L / 2 + x0), eave + (apex - eave) * (1 - abs(x1) / (L / 2))
                ln = math.hypot(x1 - x0, z1 - z0)
                up = Vector((-(z1 - z0), 0, x1 - x0)) / ln
                up = up if up.z > 0 else -up
                p.hewn(Vector(B((x0 + x1) / 2, GABLE_Z, (z0 + z1) / 2)) + up * 0.135, (ln - 0.03, 1.5, 0.3),
                       p.vary(LIME_PALE, 0.05), roll=-math.atan2(z1 - z0, x1 - x0), bevel=0.06)
        p.hewn(B(L / 2 - 0.1, GABLE_Z, eave + 0.05), (1.1, 1.6, 0.5), LIME_PALE, bevel=0.07)
    with p.side('bellcote'):
        bellcote(p, by, cote)
    # Corner buttresses: three stages with weathered offsets; the east one broke.
    for sx in (-1, 1):
        x = sx * (NAVE_X + 0.25)
        byy = base_y([(x, GABLE_Z - 2.6), (x, GABLE_Z)])
        stages = ((2.5, 4.0), (1.9, 6.8), (1.3, 9.2)) if sx > 0 else ((2.5, 4.0), (1.9, 5.6))
        prev = byy
        for (d, h) in stages:
            pier(p, x, GABLE_Z - 0.4 - d / 2, 1.3, d, prev, h, ragged=(sx < 0 and h > 4.5))
            p.hewn(B(x, GABLE_Z - 0.4 - d + 0.22, h + 0.02), (1.36, 0.7, 0.3), LIME_PALE, pitch=-0.6, bevel=0.05)
            prev = h - 0.25
        footing(f'gable_buttress_{"w" if sx > 0 else "e"}', x, GABLE_Z - 1.65, 0.65, 1.25, 0.0, byy)
        collider_obb(f'gable_buttress_{"w" if sx > 0 else "e"}', x, GABLE_Z - 1.55, 0.7, 1.4, 0.0, stages[-1][1])
    for sx in (-1, 1):
        w = (L / 2 - door_hw - 0.5) / 2
        collider_obb(f'gable_wall_{"w" if sx > 0 else "e"}', sx * (door_hw + 0.5 + w), GABLE_Z, w, 0.68, 0.0,
                     apex if sx > 0 else 12.0)
    earth_skirt(p, (-L / 2, GABLE_Z - 0.9), (-door_hw - 0.6, GABLE_Z - 0.9))
    earth_skirt(p, (door_hw + 0.6, GABLE_Z - 0.9), (L / 2, GABLE_Z - 0.9))
    earth_skirt(p, (-L / 2, GABLE_Z + 0.9), (L / 2, GABLE_Z + 0.9), width=0.8)
    earth_skirt(p, (-1.4, GABLE_Z - 2.6), (1.4, GABLE_Z + 2.4), width=1.5, step=1.2)
    sunk_blocks(p, (-L / 2, GABLE_Z), (L / 2, GABLE_Z), 12, off=1.6)
    rubble(p, -6.5, GABLE_Z - 2.2, 2.6, 9, size=(0.3, 0.75), lift=0.25)
    rubble(p, -5.5, GABLE_Z + 2.0, 2.2, 6, size=(0.3, 0.7), lift=0.2)
    for k in range(9):
        a0 = math.pi * (1.12 + 0.76 * k / 8)
        for face in (0.6, -0.6):
            p.streaks.append((M @ Vector((math.cos(a0) * (rose_r + 0.55), face, rose_y + math.sin(a0) * (rose_r + 0.55))),
                              0.22 + 0.2 * p.rng.random(), 2.2 + 2.6 * p.rng.random(), 0.75))
    for sx in (-1, 1):
        for face in (0.6, -0.6):
            p.streaks.append((M @ Vector((sx * 5.7, face, 2.55)), 0.5, 2.2, 0.6))
            p.streaks.append((M @ Vector((sx * (door_hw + 0.5), face, door_spring + 0.3)), 0.4, 3.4, 0.55))
    p.soot.append((M @ Vector((0, 0.3, door_spring + door_rise - 0.3)), 2.4, 0.5))
    p.soot.append((M @ Vector((0, 0.0, rose_y - rose_r)), 1.6, 0.35))
    SOCKETS['rose'] = [0.0, rose_y, GABLE_Z]
    SOCKETS['rose_radius'] = rose_r
    return p


# ================================================================== the nave
def lancet(p, M, u, sill, spring, rise, half, depth, head=True, stands=(True, True), ledge=(True, True)):
    """A lancet's head and sill. stands: whether the wall still stands to the
    springing on its low-u and its high-u side; the half of the head over a
    jamb that fell is gone with it (half an arch does not hang from its crown).
    ledge: whether the wall still comes up under each end of the sill; an end
    with nothing under it is broken off at the jamb."""
    if head:
        lp = [(u + x, spring + z) for (x, z) in arch_points(half, rise, 3)]
        if all(stands):
            p.arch(lp, 0.26, depth + 0.1, LIME_PALE, M, bevel=0.0)
        else:
            with p.ghost():      # the whole head, for its random draws
                p.arch(lp, 0.26, depth + 0.1, LIME_PALE, M, bevel=0.0)
            n = len(lp) - 1
            with p.side(f'lancet {u:.2f}'):
                p.arch(lp, 0.26, depth + 0.1, LIME_PALE, M, bevel=0.0,
                       skip=tuple(i for i in range(n) if not stands[0 if i < n / 2 else 1]))
    lo, hi = (half + (0.3 if on else 0.02) for on in ledge)
    p.hewn(Vector((u + (hi - lo) / 2, 0, sill - 0.1)), (lo + hi, depth + 0.16, 0.2), LIME_PALE, bevel=0.05, M=M)


def nave():
    p = P('Nave', moss=1.1)
    rng = p.rng
    for sx in (-1, 1):
        x = sx * (NAVE_X - 0.5)
        a, b = (x, GABLE_Z + 0.55), (x, NAVE_END_Z)
        L = b[1] - a[1]
        y0 = base_y([(x, z) for z in range(int(a[1]), int(b[1]) + 1)])
        breaches = [(0.37, 0.47), (0.71, 0.80)] if sx > 0 else [(0.45, 0.55), (0.84, 0.92)]
        wins = (0.12, 0.27) if sx > 0 else (0.13, 0.30)

        def top_fn(t, sx=sx, breaches=breaches):
            base = 8.6 * (1 - t) ** 1.25 + 1.3
            wob = 0.8 * math.sin(t * 17 + sx) * math.sin(t * 5.3 + 1.0)
            for (b0, b1) in breaches:
                if b0 < t < b1:
                    return 0.3
                edge = min(abs(t - b0), abs(t - b1)) * L
                if edge < 1.6:
                    base = min(base, 0.9 + edge * 1.9)
            return max(0.5, base + wob)

        hs = [arch_hole(0.5, 4.5, 1.0, w * L) for w in wins]

        def holes(u, y, hs=hs):
            return y > 2.3 and any(h(u, y) for h in hs)

        def bend(u, n, y, sx=sx, breaches=breaches, L=L):
            k = 0.0
            for (b0, b1) in breaches:
                d = min(abs(u - b0 * L), abs(u - b1 * L))
                k = max(k, math.exp(-(d / 2.2) ** 2))
            out = -1.0 if sx < 0 else 1.0     # local +Y is west
            return (0.0, out * 0.03 * k * max(0.0, y - 0.8), -0.09 * k * min(1.0, y / 2.0))

        heads = [top_fn(w) > 6.0 for w in wins]
        # A window's head carries masonry only over a jamb that still stands: the
        # wall keeps the springing's height for a good stone's length beyond it.
        stands = [tuple(min(top_fn(w + e * (0.5 + d) / L) for d in (0.1, 0.5, 0.9, 1.3)) >= 4.7 for e in (-1, 1))
                  for w in wins]

        def headed(u, y, hs=hs, heads=heads, stands=stands, wins=wins, L=L):
            return y > 2.3 and any(h(u, y) and head and st[0 if u < w * L else 1]
                                   for (h, head, st, w) in zip(hs, heads, stands, wins))

        TOPS.extend(p.wall(a, b, 0.98, y0, top_fn, holes=(holes,), course=(0.48, 0.84), unit=(1.1, 2.7), deform=bend,
                           missing=0.035, bridge=(headed,), open_ends=(True, False)))      # (its south end tops the gable)
        Mw = Matrix.Translation(B(x, a[1], 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for (w, head, st) in zip(wins, heads, stands):
            # (does the built wall come up to the sill a little beyond each jamb?)
            ledge = tuple(p.surface(x, -(a[1] + w * L + e * 0.72), 20.0, 0.0) >= 2.3 - 0.35 for e in (-1, 1))
            lancet(p, Mw, w * L, 2.3, 4.5, 1.0, 0.5, 0.98, head=head, stands=st, ledge=ledge)
        # Buttresses outside, between the breaches.
        for t in (0.2, 0.62, 0.96):
            if any(b0 - 0.05 < t < b1 + 0.05 for (b0, b1) in breaches):
                continue
            z = a[1] + L * t
            bx = x + sx * 1.0
            byy = base_y([(bx, z)])
            h = max(1.2, top_fn(t) - 0.9)
            pier(p, bx, z, 1.05, 1.15, byy, h * 0.62)
            pier(p, bx - sx * 0.15, z, 0.75, 1.0, h * 0.62 - 0.1, h, ragged=True)
            p.hewn(B(bx + sx * 0.2, z, h * 0.62 + 0.05), (0.7, 1.14, 0.26), LIME_PALE, roll=sx * 0.6, bevel=0.05)
            collider_circle(f'nave_buttress_{"w" if sx > 0 else "e"}_{int(t * 100)}', bx + sx * 0.1, z, 0.6, h)
        # Rubble spilled through the breaches, inside and out.
        for (b0, b1) in breaches:
            zc = a[1] + L * (b0 + b1) / 2
            rubble(p, x, zc, 1.9, 9, size=(0.28, 0.72), lift=0.45)
            rubble(p, x + sx * 1.6, zc + 0.6, 1.6, 4, size=(0.25, 0.6))
        cuts = [0.0] + [v for br in breaches for v in br] + [1.0]
        for k in range(0, len(cuts), 2):
            t0, t1 = cuts[k], cuts[k + 1]
            z0, z1 = a[1] + L * t0, a[1] + L * t1
            collider_obb(f'nave_wall_{"w" if sx > 0 else "e"}_{k // 2}', x, (z0 + z1) / 2, 0.58, (z1 - z0) / 2, 0.0,
                         max(top_fn((t0 + t1) / 2), 1.2))
        footing(f'nave_wall_{"w" if sx > 0 else "e"}', x, (a[1] + b[1]) / 2, 0.5, L / 2, 0.0, y0)
        for off in (-0.85, 0.85):
            earth_skirt(p, (x + off, a[1]), (x + off, b[1]), width=0.85)
        sunk_blocks(p, a, b, 9)
    # The nave arcade: six piers of the chapel's own masonry, each broken at its
    # own height, and one more lying where it fell along the aisle.
    for i, (px, pz, ph) in enumerate(((4.6, -17.6, 2.0), (4.6, -12.6, 4.8), (4.6, -7.6, 1.3), (-4.6, -17.6, 3.5),
                                      (-4.6, -12.6, 1.6), (-4.6, -7.6, 5.6))):
        g = gh(px, pz)
        p.hewn(B(px, pz, g + 0.12), (1.7, 1.7, 0.5), LIME_DARK, bevel=0.07)
        pier(p, px, pz, 1.25, 1.25, g + 0.34, ph, ragged=ph < 4)
        if ph > 4:
            p.hewn(B(px, pz, ph + 0.1), (1.5, 1.5, 0.24), LIME_PALE, bevel=0.06, chip=0.12, roll=0.03)
        collider_circle(f'nave_pier_{i}', px, pz, 0.85, ph + 0.2, stand=(ph if ph < 2.3 else None))
        footing(f'nave_pier_{i}', px, pz, 0.6, 0.6, 0.0, g - 0.13)
        rubble(p, px, pz, 1.4, 1, size=(0.25, 0.55))
        earth_skirt(p, (px - 0.6, pz), (px + 0.6, pz), width=1.1, step=1.2)
    for k in range(4):
        fx_, fz_ = -3.9 + k * 0.82, -16.2 + k * 0.42
        p.stone(B(fx_, fz_, gh(fx_, fz_) + 0.42), (0.86, 1.2, 1.15), p.tone(fx_, fz_), chip=0.1, knock=0.5, bottom=True,
                rot=Matrix.Rotation(0.47 + (rng.random() - 0.5) * 0.3, 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.2, 0.2), 3, 'X'))
    collider_obb('fallen_pier', -2.67, -15.57, 1.7, 0.62, -0.47, 1.05, stand=1.0)
    footing('fallen_pier', -2.67, -15.57, 1.4, 0.4, -0.47, gh(-2.67, -15.57) - 0.15)
    # Chancel shoulders.
    for sx in (-1, 1):
        a, b = (sx * (NAVE_X - 0.5), NAVE_END_Z), (sx * CHANCEL_X, NAVE_END_Z)
        y0 = base_y([a, b])
        TOPS.extend(p.wall(a, b, 0.92, y0, lambda t: 2.6 - t * 0.9, course=(0.45, 0.75), unit=(1.0, 2.0)))
        a, b = (sx * CHANCEL_X, NAVE_END_Z), (sx * CHANCEL_X, APSE_C[1])
        y0 = base_y([a, b])
        TOPS.extend(p.wall(a, b, 0.92, y0, lambda t, sx=sx: 1.5 + 0.7 * math.sin(t * 5 + sx) + (1.6 * t if sx > 0 else 0),
                           course=(0.45, 0.78), unit=(1.0, 2.3)))
        collider_obb(f'chancel_wall_{"w" if sx > 0 else "e"}', sx * CHANCEL_X, (NAVE_END_Z + APSE_C[1]) / 2, 0.52,
                     (APSE_C[1] - NAVE_END_Z) / 2, 0.0, 2.4)
        footing(f'chancel_wall_{"w" if sx > 0 else "e"}', sx * CHANCEL_X, (NAVE_END_Z + APSE_C[1]) / 2, 0.46,
                (APSE_C[1] - NAVE_END_Z) / 2, 0.0, y0)
    # The apse: nine short runs; the north-west one still stands to its window.
    segs = 9
    heights = (2.6, 3.4, 5.9, 4.6, 0.45, 1.3, 2.4, 1.6, 1.2)
    for k in range(segs):
        a0 = math.pi * k / segs
        a1 = math.pi * (k + 1) / segs
        pa = (APSE_C[0] + math.cos(a0) * APSE_R, APSE_C[1] + math.sin(a0) * APSE_R)
        pb = (APSE_C[0] + math.cos(a1) * APSE_R, APSE_C[1] + math.sin(a1) * APSE_R)
        y0 = base_y([pa, pb])
        hgt = heights[k]
        Lk = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        hole = arch_hole(0.45, 3.9, 0.95, Lk / 2) if k in (2, 3) else None
        cut = ((lambda u, y, hole=hole: y > 2.2 and hole(u, y)),) if hole else ()
        TOPS.extend(p.wall(pa, pb, 0.9, y0, lambda t, h=hgt, k=k: h + 0.5 * math.sin(t * 7 + k * 2.1), holes=cut,
                           course=(0.48, 0.82), unit=(1.0, 2.2), missing=0.03, bridge=cut if k == 2 else ()))
        if hole:
            ang = math.atan2(-(pb[1] - pa[1]), pb[0] - pa[0])
            Mk = Matrix.Translation(B(pa[0], pa[1], 0)) @ Matrix.Rotation(ang, 4, 'Z')
            lancet(p, Mk, Lk / 2, 2.2, 3.9, 0.95, 0.45, 0.9, head=(k == 2))
        footing(f'apse_{k}', (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, Lk / 2, 0.4, math.atan2(-(pb[1] - pa[1]), pb[0] - pa[0]),
                y0)
    # Four runs, open at the low north breach behind the stair-house (the run
    # of the wall that fell to a step): the apse is never a sealed pocket.
    for k, (d0, d1) in enumerate(((0, 45), (45, 80), (100, 135), (135, 180))):
        a0, a1 = math.radians(d0), math.radians(d1)
        pa = (APSE_C[0] + math.cos(a0) * APSE_R, APSE_C[1] + math.sin(a0) * APSE_R)
        pb = (APSE_C[0] + math.cos(a1) * APSE_R, APSE_C[1] + math.sin(a1) * APSE_R)
        dx, dz = pb[0] - pa[0], pb[1] - pa[1]
        collider_obb(f'apse_wall_{k}', (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, math.hypot(dx, dz) / 2, 0.5,
                     math.atan2(-dz, dx), 4.0)
    for k in range(8):
        a0, a1 = math.pi * k / 8, math.pi * (k + 1) / 8
        for rr in (APSE_R - 0.9, APSE_R + 0.9):
            earth_skirt(p, (APSE_C[0] + math.cos(a0) * rr, APSE_C[1] + math.sin(a0) * rr),
                        (APSE_C[0] + math.cos(a1) * rr, APSE_C[1] + math.sin(a1) * rr), width=0.8, step=1.6)
    sunk_blocks(p, (-CHANCEL_X, 3.0), (CHANCEL_X, 9.5), 7, off=1.5)
    rubble(p, 0.0, APSE_C[1] + APSE_R - 0.2, 2.4, 10, size=(0.3, 0.8), lift=0.5)
    return p


# ========================================================= the stair-house
def mourner(p, lx, lz, y, facing, broken=False):
    """A weathered hooded mourner on a pedestal: the round cowl bowed over a
    shadowed face, hands clasped at the breast, the robe falling to a flared
    hem, a veil down her back."""
    with p.as_kind(K_STONE):
        col = p.vary(LIME_COOL, 0.04)
        p.hewn(B(lx, lz, y + 0.13), (0.9, 0.9, 0.26), LIME_DARK, bevel=0.06)
        p.hewn(B(lx, lz, y + 0.7), (0.64, 0.64, 0.9), p.tone(lx, y), bevel=0.05)
        p.hewn(B(lx, lz, y + 1.2), (0.8, 0.8, 0.14), LIME_PALE, bevel=0.05)
        top = y + 1.27
        m = p.mark()
        prof = [(0.42, 0.0), (0.36, 0.3), (0.27, 1.02), (0.3, 1.32), (0.38, 1.56), (0.3, 1.68), (0.15, 1.77)]
        p.lathe((0, 0, 0), prof, 8, col, phase=math.pi / 8, smooth=False)
        for sx in (-1, 1):
            p.sweep([Vector((sx * 0.34, 0.0, 1.56)), Vector((sx * 0.4, 0.22, 1.2)), Vector((sx * 0.06, 0.4, 1.36))], 0.11, 0.08,
                    p.vary(col, 0.04), sides=5)
        p.box((0, 0.42, 1.38), (0.22, 0.15, 0.17), p.vary(col, 0.05), bevel=0.03)
        p.box((0, -0.22, 1.3), (0.52, 0.14, 0.86), p.vary(col, 0.04), taper=0.8)
        if not broken:
            p.rock((0, 0.07, 1.98), (0.56, 0.6, 0.62), col, jitter=0.05, subdivisions=1)
            with p.as_kind(K_RAW):
                p.box((0, 0.31, 1.92), (0.27, 0.16, 0.32), (0.1, 0.1, 0.11), pitch=0.25)
        else:
            p.rock((0.03, 0.0, 1.76), (0.34, 0.34, 0.14), p.vary(LIME, 0.05), jitter=0.3, subdivisions=1)
        p.turn(m, Matrix.Translation(B(lx, lz, top)) @ Matrix.Rotation(facing, 4, 'Z') @
               Matrix.Rotation(0.07 if not broken else -0.03, 4, 'X') @ Matrix.Diagonal((1.14, 0.92, 1.14, 1.0)))
        if broken:      # her head lies at her feet
            hx, hz = lx - 0.85, lz - 0.6
            p.rock(B(hx, hz, gh(hx, hz) + 0.24), (0.62, 0.66, 0.6), col, jitter=0.05, subdivisions=1)


def stair_house():
    """The surviving bay of the chancel over the crypt stair: a gabled portal
    front with a moulded pointed arch (the door lane, x +-1.3), thick side
    walls, three vault ribs (the webbing mostly fallen), rubble on its
    shoulders, and inside it the stair going down (the dark and the steps are
    the engine's portal; the KitVoid box only backs it)."""
    p = P('StairHouse', moss=0.9)
    hw, z0, z1 = SH['hw'], SH['z0'], SH['z1']
    y0 = base_y([(x, z) for x in (-hw, 0, hw) for z in (z0, (z0 + z1) / 2, z1)], 0.5)
    footing('stairhouse', 0, (z0 + z1) / 2, hw, (z1 - z0) / 2, 0.0, y0)
    front_z = z0 + 0.65
    M = south_plane(front_z)
    spring, rise = 2.75, 2.45
    eave, apex = 5.7, 8.5

    def front_top(t):
        x = t * 2 * hw - hw
        top = eave + (apex - eave) * max(0.0, 1 - abs(x) / hw)
        if x < -1.2:      # the east rake is broken away in steps
            top -= 0.4 + 1.5 * rk.smooth(-1.2, -3.0, x)
        return top

    hole = arch_hole(LANE + 0.3, spring, rise + 0.1, hw)

    def rake_line(u):      # the surviving rake, cut to its line under the coping
        return eave + (apex - eave) * max(0.0, 1 - abs(u - hw) / hw)

    TOPS.extend(p.wall((-hw, front_z), (hw, front_z), 1.3, y0, front_top, holes=(hole,), course=(0.46, 0.8),
                       unit=(1.0, 2.3), missing=0.02, dress=((hw - 1.2, 2 * hw, rake_line, (hw,)),)))
    # Side walls, falling toward the back; the back wall is a stump under rubble.
    for sx in (-1, 1):
        def side_top(t, sx=sx):
            return 5.6 - 1.7 * t + 0.4 * math.sin(t * 9 + sx) - (0.6 if (sx < 0 and t > 0.5) else 0.0)

        TOPS.extend(p.wall((sx * (hw - 0.875), front_z + 0.6), (sx * (hw - 0.875), z1), 1.75, y0, side_top,
                           course=(0.46, 0.82), unit=(1.0, 2.4), missing=0.03))
    # The portal: three orders and a hood, on dressed jambs with engaged shafts.
    a = LANE
    pts = [(x, spring + z) for (x, z) in arch_points(a + 0.3, rise + 0.1, 6)]
    p.arch(pts, 0.56, 1.5, LIME_PALE, M, bevel=0.05)
    mid = [(x, spring + z) for (x, z) in arch_points(a + 0.02, rise - 0.12, 6)]
    p.arch(mid, 0.3, 1.0, LIME, M, bevel=0.0, y_off=0.05)
    inn = [(x, spring + z) for (x, z) in arch_points(a - 0.02, rise - 0.16, 5)]
    p.roll(inn, 0.09, p.vary(LIME_PALE, 0.03), M, y_off=0.56)
    p.roll(pts, 0.11, p.vary(LIME_PALE, 0.04), M, y_off=0.74, out=0.7)
    for sx in (-1, 1):
        stack(p, sx * (a + 0.6), front_z, 0.62, 1.5, y0 + 0.2, spring - 0.26, course=(0.5, 0.74))
        stack(p, sx * (a + 0.17), front_z + 0.05, 0.32, 1.0, y0 + 0.2, spring - 0.26, course=(0.5, 0.74), bevel=0.0)
        # The engaged shaft: base, drum, bell capital.
        sxp, szp = sx * (a + 0.3), front_z - 0.84
        p.hewn(B(sxp, szp, gh(sxp, szp) + 0.16), (0.46, 0.46, 0.36), LIME_PALE, bevel=0.05)
        p.lathe(B(sxp, szp, gh(sxp, szp) + 0.34), [(0.2, 0), (0.2, 0.08), (0.15, 0.16), (0.14, spring - 1.08),
                                                     (0.17, spring - 0.98), (0.26, spring - 0.72)], 8, p.vary(LIME, 0.04))
        p.hewn(B(sx * (a + 0.49), front_z - 0.14, spring - 0.13), (0.92, 1.84, 0.26), LIME_PALE, bevel=0.06)
    # The Chapel's sign over the arch: the closed eye of the Sleep, in relief.
    sy = spring + rise + 1.15
    p.hewn(M @ Vector((0, 0.62, sy)), (1.5, 0.22, 1.05), LIME_PALE, bevel=0.05)
    eye = [(math.cos(math.pi * (0.16 + 0.68 * i / 6)) * 0.52, sy + 0.1 - math.sin(math.pi * (0.16 + 0.68 * i / 6)) * 0.3)
           for i in range(7)]
    p.sweep([M @ Vector((x, 0.76, z)) for (x, z) in eye], 0.045, 0.045, p.vary(LIME_DARK, 0.04), sides=4)
    for k in range(5):
        x, z = eye[k + 1]
        p.box(M @ Vector((x * 1.12, 0.76, z - 0.13)), (0.05, 0.06, 0.2), LIME_DARK, roll=-(x * 0.9))
    p.soot.append((M @ Vector((0, 0.7, spring + rise - 0.2)), 2.6, 0.7))
    for k in range(7):
        x = -2.6 + 5.2 * k / 6
        p.streaks.append((M @ Vector((x, 0.66, 6.0 + 0.5 * p.rng.random())), 0.28 + 0.2 * p.rng.random(),
                          2.0 + 2.4 * p.rng.random(), 0.7))
    # Coping on the surviving west rake and a kneeler. (First version, kept
    # unseen for its random draws: see ghost().)
    with p.ghost():
        for k in range(4):
            t0, t1 = k / 4, (k + 1) / 4
            x0, x1 = hw * (1 - t0), hw * (1 - t1)
            zz0, zz1 = eave + (apex - eave) * t0, eave + (apex - eave) * t1
            if k == 2:
                continue
            p.hewn(B((x0 + x1) / 2, front_z, (zz0 + zz1) / 2 + 0.18), (abs(x1 - x0) * 1.1, 1.6, 0.26),
                   p.vary(LIME_PALE, 0.05), roll=-math.atan2(zz1 - zz0, x1 - x0), bevel=0.06)
        p.hewn(B(0.1, front_z, apex + 0.1), (0.6, 1.5, 0.5), LIME_PALE, bevel=0.06, roll=0.06)
    with p.side('coping'):
        # Each stone as long as its stretch of the rake and bedded on the cut
        # masonry (one is gone); the saddle stone sits astride the apex.
        for k in range(4):
            if k == 2:
                continue
            x0, x1 = hw * (1 - k / 4), max(0.32, hw * (1 - (k + 1) / 4))
            zz0, zz1 = rake_line(hw + x0), rake_line(hw + x1)
            ln = math.hypot(x1 - x0, zz1 - zz0)
            up = Vector((-(zz1 - zz0), 0, x1 - x0)) / ln
            up = up if up.z > 0 else -up
            p.hewn(Vector(B((x0 + x1) / 2, front_z, (zz0 + zz1) / 2)) + up * 0.115, (ln - 0.03, 1.6, 0.26),
                   p.vary(LIME_PALE, 0.05), roll=-math.atan2(zz1 - zz0, x1 - x0), bevel=0.06)
        p.hewn(B(0.02, front_z, apex + 0.06), (0.62, 1.5, 0.5), LIME_PALE, bevel=0.06, roll=0.04)
    # The stair's own barrel vault still stands (it is why the stair can be
    # used): rings of voussoir slabs on the cheeks, closed at the back by an
    # end wall under the fallen chancel's rubble. What collapsed is everything
    # above it.
    v_half, v_spring, v_rise = LANE, 3.7, 1.65
    vz0, vz1 = front_z + 0.62, z1 - 0.5
    rings = 5
    for i in range(rings):
        lz = vz0 + (i + 0.5) * (vz1 - vz0) / rings
        rp = [(x, v_spring + z) for (x, z) in arch_points(v_half, v_rise, 4)]
        p.arch(rp, 0.36, (vz1 - vz0) / rings - 0.02, LIME if i % 2 else LIME_COOL, south_plane(lz), bevel=0.0, chip=0.07,
               tone=0.09, depth_jit=0.0)
    vault = arch_hole(v_half + 0.3, v_spring, v_rise + 0.34, hw - 1.1)

    def end_line(u):      # the end wall closes the vault to its point: cut to that line
        return v_spring + 0.2 + (v_rise + 0.25) * max(0.0, 1 - abs(u / (2 * hw - 2.2) - 0.5) * 2) ** 0.8

    TOPS.extend(p.wall((-hw + 1.1, z1 - 0.2), (hw - 1.1, z1 - 0.2), 0.7, y0,
                       lambda t: v_spring + 0.2 + (v_rise + 0.25) * max(0.0, 1 - abs(t - 0.5) * 2) ** 0.8, unit=(1.0, 2.2),
                       missing=0.0, dress=((0.0, 2 * hw - 2.2, end_line, (hw - 1.1,)),)))
    del vault
    # The chancel arch's west respond still climbs from the corner and throws
    # three voussoirs at the sky; its east twin is a stump under the yew.
    pier(p, 2.85, front_z - 0.05, 1.25, 1.5, y0, 7.0)
    p.hewn(B(2.8, front_z - 0.05, 7.08), (1.5, 1.74, 0.26), LIME_PALE, bevel=0.07)
    big = [(-0.35 + x, 7.2 + z) for (x, z) in arch_points(2.75, 3.3, 6)]
    p.arch(big, 0.66, 1.2, LIME_PALE, south_plane(front_z - 0.05), bevel=0.06, skip=tuple(range(0, 9)), chip=0.07)
    pier(p, -2.85, front_z - 0.05, 1.25, 1.5, y0, 3.3, ragged=True)
    # Rubble heaped on the vault's back and shoulders, and the earth that has
    # crept over it from the fallen apse.
    for (lx, lz, y, s) in ((2.3, 2.4, 4.9, 0.8), (-2.3, 1.5, 5.1, 0.7), (2.2, 4.2, 4.3, 0.9), (-2.1, 4.0, 4.1, 0.8),
                           (0.5, 3.2, 5.75, 0.8), (-0.6, 4.4, 5.3, 0.9), (3.0, 0.9, 5.3, 0.6), (0.2, 1.6, 5.9, 0.6),
                           (1.2, 4.9, 4.6, 0.8), (-1.3, 2.6, 5.5, 0.6)):
        # (y is only where to look from: each lump lies on what is under it)
        if p.rng.random() < 0.45:
            col = p.tone(lx, lz)
            seat = lie(p, lx, lz, Matrix.Identity(3), (s * 0.8, s * 0.6, 0.0), reach=y + 1.2 - gh(lx, lz), sink=0.0)
            p.rock(B(lx, lz, seat + s * 0.18), (s * 1.4, s, s * 0.7), col, jitter=0.28, subdivisions=1)
        else:
            col = p.tone(lx, lz)
            rot = Matrix.Rotation(p.rng.random() * 3, 3, 'Z') @ Matrix.Rotation(0.3 * LIE, 3, 'X')
            dims = (s * 1.5, s * 0.9, s * 0.6)
            p.stone(B(lx, lz, lie(p, lx, lz, rot, dims, reach=y + 1.2 - gh(lx, lz))), dims, col, chip=0.12, knock=0.6,
                    bottom=True, rot=rot)
    with p.as_kind(K_EARTH):
        for (lx, lz, sx_, sy_, sz_) in ((0.4, z1 + 0.9, 5.6, 3.4, 2.6), (-2.2, z1 + 0.3, 3.2, 3.0, 2.0),
                                        (2.6, z1 + 0.5, 3.0, 2.6, 1.7), (0.0, z1 + 1.3, 3.6, 2.2, 3.0)):
            fs = p.rock(B(lx, lz, gh(lx, lz) + 0.1), (sx_, sy_, sz_ * 2.0), (0.33, 0.37, 0.2), jitter=0.2, subdivisions=1,
                        flat_bottom=True)
            for f in fs:
                f.smooth = True
    rubble(p, 0.3, z1 + 0.6, 2.8, 10, size=(0.35, 0.85), lift=1.3)
    # The threshold: a worn sill under the arch, hollowed by feet, and the
    # flush landing flags in front of it.
    sill = max(gh(x, front_z) for x in (-1.2, 0, 1.2)) + 0.2
    for (x, w, dip) in ((-0.92, 0.84, 0.0), (0.0, 1.0, 0.055), (0.92, 0.84, 0.01)):
        p.hewn(B(x, front_z - 0.02, (sill - dip + y0) / 2), (w - 0.03, 1.36, sill - dip - y0), LIME_PALE, bevel=0.05)
    # The dark behind the portal: side cheeks, a back and a floor of nothing
    # (the engine draws the stair inside this well).
    well_y = sill - 0.14
    SOCKETS['well'] = {'x0': -LANE, 'x1': LANE, 'z0': round(front_z + 0.68, 3), 'z1': round(z1 - 1.12, 3),
                       'y': round(well_y, 3), 'spring': v_spring, 'apex': v_spring + v_rise - 0.05}
    with p.as_kind(K_RAW):
        zb = z1 - 1.1
        p.box(B(0, (front_z + 0.66 + zb) / 2, well_y - 0.08), (2 * LANE + 0.3, zb - front_z - 0.66, 0.1), VOIDC, mat=VOID)
        p.box(B(0, zb + 0.08, 1.9), (2 * LANE + 0.3, 0.1, 3.8), VOIDC, mat=VOID)
    # Inner cheeks of the stairwell: dressed faces going down into it.
    for sx in (-1, 1):
        p.wall((sx * (LANE + 0.19), front_z + 0.66), (sx * (LANE + 0.19), z1 - 0.5), 0.38, 0.8, lambda t: 3.72,
               course=(0.4, 0.62), unit=(1.0, 2.2), missing=0.0, proud=0.02, ragged=0.0)
    for sx in (-1, 1):
        earth_skirt(p, (sx * (hw + 0.8), z0 - 0.4), (sx * (hw + 0.8), z1), width=0.9, step=1.5)
    earth_skirt(p, (-hw, z0 - 1.9), (hw, z0 - 1.9), width=1.1, step=1.3)
    sunk_blocks(p, (-hw - 0.6, z0 - 1.0), (-hw - 0.6, z1), 4, off=0.8)
    sunk_blocks(p, (hw + 0.6, z0 - 1.0), (hw + 0.6, z1), 4, off=0.8)
    # Mourners flanking the portal; the east one has lost her head.
    mourner(p, 2.05, front_z - 1.05, gh(2.05, front_z - 1.05) - 0.1, 0.12)
    mourner(p, -2.05, front_z - 1.05, gh(-2.05, front_z - 1.05) - 0.1, -0.16, broken=True)
    for sx in (-1, 1):
        collider_obb(f'mourner_{"w" if sx > 0 else "e"}', sx * 2.05, front_z - 1.05, 0.42, 0.42, 0.0, 3.3)
        footing(f'mourner_{"w" if sx > 0 else "e"}', sx * 2.05, front_z - 1.05, 0.45, 0.45, 0.0,
                gh(sx * 2.05, front_z - 1.05) - 0.1)
    # Gravecaller candles: by the jambs, on the pedestals' steps, on the sill ends.
    for sx in (-1, 1):
        candle_cluster(p, sx * 1.5, front_z - 1.82, gh(sx * 1.5, front_z - 1.82), 4, spread=0.17, tall=0.42)
        candle(p, sx * 1.67, front_z - 0.67, gh(sx * 2.05, front_z - 1.05) + 0.18, 0.3)
        candle(p, sx * 1.18, front_z - 0.5, sill, 0.16 + 0.2 * p.rng.random())
        candle(p, sx * 1.02, front_z - 0.36, sill, 0.34)
    for sx in (-1, 1):
        collider_obb(f'stairhouse_{"w" if sx > 0 else "e"}', sx * (LANE + (hw - LANE) / 2), (z0 + z1) / 2, (hw - LANE) / 2,
                     (z1 - z0) / 2, 0.0, 7.2)
    collider_obb('stairhouse_back', 0, (front_z + 1.2 + z1) / 2, LANE, (z1 - front_z - 1.2) / 2, 0.0, 4.2)
    SOCKETS['stair_mouth'] = [0.0, round(sill + 1.6, 3), round(front_z + 0.2, 3)]
    SOCKETS['soul_light'] = [0.0, round(sill + 0.9, 3), round(front_z + 1.4, 3)]
    SOCKETS['mist'] = [0.0, round(sill + 0.1, 3), round(front_z - 0.6, 3)]
    SOCKETS['sill'] = round(sill, 3)
    SOCKETS['arch'] = {'half': LANE, 'spring': spring, 'rise': rise, 'z': round(front_z, 3)}
    return p, sill


# =============================================================== the details
def details(sill):
    p = P('Details', moss=0.8)
    rng = p.rng
    # The altar slab, dragged aside and left tilted on a broken corner.
    ax_, az_ = -4.7, 4.3
    g = gh(ax_, az_)
    p.hewn(B(ax_, az_, g + 0.52), (1.25, 2.7, 0.42), LIME_PALE, bevel=0.07, roll=0.13, yaw=0.35)
    p.hewn(B(ax_ + 0.1, az_ - 0.2, g + 0.14), (0.9, 1.7, 0.4), LIME_DARK, bevel=0.05, yaw=0.3)
    for k in (-0.42, 0.42):     # the drag scars in the turf
        with p.as_kind(K_EARTH):
            p.box(B(-3.4, 2.7 + k, gh(-3.4, 2.7) + 0.015), (2.5, 0.12, 0.03), EARTH, yaw=0.75)
    candle_cluster(p, ax_ + 0.15, az_ - 0.5, g + 0.66, 3, spread=0.25, tall=0.3)
    footing('altar_slab', ax_ + 0.1, az_ - 0.2, 0.4, 0.8, 0.3, g - 0.06)
    # Marrow's bell, fallen and cracked, a third sunk in the turf, its clapper
    # thrown clear.
    bx, bz = 4.9, 4.5
    g = gh(bx, bz)
    with p.as_kind(K_METAL):
        m = p.mark()
        prof = [(0.06, 1.72), (0.5, 1.7), (0.7, 1.5), (0.8, 1.0), (0.92, 0.5), (1.14, 0.16), (1.3, 0.04), (1.26, 0.0),
                (1.08, 0.1), (0.84, 0.55), (0.7, 1.05), (0.55, 1.5), (0.06, 1.56)]
        p.lathe((0, 0, 0), prof, 14, BRONZE)
        for (r, z) in ((1.2, 0.16), (0.86, 0.8), (0.72, 1.45)):
            p.lathe((0, 0, z), [(r, 0), (r + 0.045, 0.04), (r, 0.09)], 14, p.vary(BRONZE, 0.1))
        p.box((0, 0, 1.86), (0.34, 0.2, 0.34), BRONZE, bevel=0.04)
        with p.as_kind(K_RAW):
            p.box((0.86, 0.02, 0.62), (0.16, 0.05, 1.0), (0.03, 0.03, 0.03), roll=0.22)     # the crack
            p.box((0.99, -0.02, 0.2), (0.2, 0.05, 0.36), (0.03, 0.03, 0.03), roll=-0.25)
        p.turn(m, Matrix.Translation(B(bx, bz, g - 0.42)) @ Matrix.Rotation(1.22, 4, 'Y') @ Matrix.Rotation(0.5, 4, 'Z'))
        p.sweep([B(bx - 1.9, bz - 1.2, g + 0.1), B(bx - 2.3, bz - 1.5, g + 0.14)], 0.07, 0.16, p.vary(BRONZE, 0.1), sides=6)
    with p.as_kind(K_EARTH):
        p.rock(B(bx - 0.5, bz - 0.2, g + 0.02), (2.2, 1.9, 0.42), EARTH, jitter=0.25, subdivisions=1, flat_bottom=True)
    footing('fallen_bell', bx, bz, 0.7, 0.7, 0.0, g - 0.4)
    collider_circle('fallen_bell', bx + 0.2, bz, 1.15, 1.5)
    collider_obb('altar_slab', ax_, az_, 0.72, 1.42, 0.35, 1.0)
    # The ledger lectern: a stone desk, chained, its book rests empty.
    lx, lz = 5.6, -4.3
    g = gh(lx, lz)
    p.hewn(B(lx, lz, g + 0.08), (0.95, 0.95, 0.3), LIME_DARK, bevel=0.06)
    p.lathe(B(lx, lz, g + 0.2), [(0.3, 0), (0.3, 0.1), (0.19, 0.2), (0.16, 1.05), (0.22, 1.15), (0.3, 1.25)], 8, LIME)
    p.hewn(B(lx, lz - 0.06, g + 1.56), (1.15, 0.8, 0.13), LIME_PALE, bevel=0.04, pitch=-0.42)
    p.hewn(B(lx, lz - 0.36, g + 1.42), (1.1, 0.07, 0.09), LIME, pitch=-0.42)
    with p.as_kind(K_METAL):
        pts = [B(lx + 0.5, lz + 0.1, g + 1.36), B(lx + 0.72, lz + 0.2, g + 0.7), B(lx + 0.78, lz + 0.42, g + 0.07),
               B(lx + 1.3, lz + 0.62, g + 0.05)]
        p.sweep(pts, 0.035, 0.035, IRON, sides=4)
        p.box(B(lx + 1.36, lz + 0.64, g + 0.06), (0.2, 0.2, 0.12), IRON)
    candle_cluster(p, lx - 0.1, lz + 0.62, g, 3, spread=0.2, tall=0.3)
    collider_circle('lectern', lx, lz, 0.55, 1.75)
    footing('lectern', lx, lz, 0.45, 0.45, 0.0, g - 0.07)
    # The vestry nook, open toward the nave: two low walls, a bench, a niche.
    vx, vz = -5.6, -4.6
    yv = base_y([(vx - 1.4, vz - 1.7), (vx - 1.4, vz + 1.7), (vx + 0.2, vz - 1.7)])
    TOPS.extend(p.wall((vx - 1.4, vz - 1.75), (vx - 1.4, vz + 1.75), 0.62, yv, lambda t: 2.3 - 1.0 * t + 0.3 * math.sin(t * 9),
                       course=(0.4, 0.62), unit=(1.0, 2.2), pillow=0.04))
    TOPS.extend(p.wall((vx - 1.1, vz + 1.75), (vx + 0.6, vz + 1.75), 0.62, yv, lambda t: 1.5 - 1.0 * t,
                       course=(0.4, 0.62), unit=(1.0, 2.0), pillow=0.04))
    with p.as_kind(K_WOOD):
        p.box(B(vx - 0.8, vz, gh(vx - 0.8, vz) + 0.42), (0.5, 1.9, 0.1), TIMBER_GREY, roll=0.16, bevel=0.02)
        p.box(B(vx - 0.86, vz - 0.7, gh(vx - 0.8, vz) + 0.2), (0.42, 0.14, 0.4), TIMBER)
        p.box(B(vx - 0.72, vz + 0.75, gh(vx - 0.8, vz) + 0.12), (0.42, 0.14, 0.26), TIMBER, roll=0.3)
    candle_cluster(p, vx - 0.9, vz + 1.2, gh(vx - 0.9, vz + 1.2), 4, spread=0.22, tall=0.35)
    collider_obb('vestry_wall', vx - 1.4, vz, 0.4, 1.85, 0.0, 2.4)
    collider_obb('vestry_return', vx - 0.25, vz + 1.75, 0.95, 0.4, 0.0, 1.5)
    footing('vestry_wall', vx - 1.4, vz, 0.31, 1.75, 0.0, yv)
    # The dry font, its basin shrouded with mirror cloths tied down (the Vale
    # custom at a wake).
    fx, fz = 5.4, -19.4
    g = gh(fx, fz)
    p.hewn(B(fx, fz, g + 0.06), (1.5, 1.5, 0.3), LIME_DARK, bevel=0.07)
    p.lathe(B(fx, fz, g + 0.2), [(0.52, 0), (0.52, 0.16), (0.3, 0.3), (0.26, 0.82), (0.5, 0.98), (0.8, 1.12), (0.84, 1.42),
                                 (0.66, 1.44)], 8, LIME)
    with p.as_kind(K_CLOTH):
        p.lathe(B(fx, fz, g + 1.42), [(0.86, -0.3), (0.88, 0.02), (0.6, 0.14), (0.2, 0.2), (0.0001, 0.2)], 10, CLOTH_W)
        for k in range(6):
            a = TAU * k / 6 + 0.3
            p.sweep([B(fx + math.cos(a) * 0.84, fz + math.sin(a) * 0.84, g + 1.2),
                     B(fx + math.cos(a) * 0.95, fz + math.sin(a) * 0.95, g + 0.8),
                     B(fx + math.cos(a + 0.2) * 0.9, fz + math.sin(a + 0.2) * 0.9, g + 0.36)], 0.12, 0.05,
                    p.vary(CLOTH_G if k % 2 else CLOTH_W, 0.06), sides=4, squash=0.3)
        p.sweep([B(fx + math.cos(a) * 0.9, fz + math.sin(a) * 0.9, g + 1.24) for a in (TAU * i / 12 for i in range(13))],
                0.025, 0.025, (0.36, 0.27, 0.18), sides=4, cap=False)
    collider_circle('font', fx, fz, 0.9, 1.7)
    footing('font', fx, fz, 0.7, 0.7, 0.0, g - 0.09)
    # What is left of the nave floor: worn flags down the aisle and in front of
    # the stair, their joints full of grass (kept off the six quest spots).
    def flag_ok(x, z, r):
        return all(math.hypot(x - qx, z - qz) > 1.0 + r for (qx, qz) in QUEST) and \
            math.hypot(x, z + 12) < 30 and not (abs(x - 0.1) < 0.9 and abs(z + 16.3) < 0.9)

    for (x0, x1, z0, z1, keep) in ((-1.5, 1.5, -21.0, -6.2, 0.62), (-3.2, 3.2, -3.4, -1.0, 0.92), (-4.2, -1.7, -20, -8, 0.14),
                                   (1.7, 4.2, -20, -8, 0.14)):
        z = z0
        while z < z1:
            d = rng.uniform(0.75, 1.15)
            x = x0
            while x < x1:
                w = rng.uniform(0.8, 1.4)
                cx_, cz_ = x + w / 2, z + d / 2
                if rng.random() < keep and flag_ok(cx_, cz_, max(w, d) / 2) and x + w <= x1 + 0.3:
                    with p.as_kind(K_EARTH):
                        p.box(B(cx_, cz_, gh(cx_, cz_) + 0.005), (w - 0.07, d - 0.07, 0.13),
                              p.vary(FLAG if rng.random() < 0.7 else (0.36, 0.42, 0.3), 0.1), chip=0.12,
                              yaw=(rng.random() - 0.5) * 0.08, roll=(rng.random() - 0.5) * 0.05,
                              pitch=(rng.random() - 0.5) * 0.05, bottom=False)
                x += w
            z += d
    # Fallen voussoirs, a toppled drum, tumbled blocks in the nave (walk-over).
    for (x, z, s, yaw) in ((-3.6, -10.6, 0.9, 0.4), (4.9, -15.0, 1.0, 1.2), (-6.6, -17.6, 0.85, 2.2), (2.2, -20.3, 0.7, 0.9),
                           (6.9, -9.6, 0.8, 0.2), (-6.9, -11.4, 0.7, 1.7)):
        p.hewn(B(x, z, gh(x, z) + 0.17), (s, 0.62, 0.46), p.tone(x, z), bevel=0.05, yaw=yaw, pitch=0.12, roll=0.08, chip=0.14)
    SOCKETS['bell'] = [bx, 1.0, bz]
    return p


# =================================================== outside: graves, lychgate
def headstone(p, x, z, kind, w, h, lean, yaw):
    g = gh(x, z)
    c = p.tone(x, z)
    m = p.mark()
    if kind == 0:       # round head
        p.hewn((0, 0, h / 2 - 0.35), (w, 0.2, h), c, bevel=0.04)
        fs = p.prism((0, -0.1, h - 0.35), 8, w / 2, w / 2, 0.2, c, axis=(0, 1, 0))
        del fs
    elif kind == 1:     # a wheel cross on a shaft
        p.hewn((0, 0, h / 2 - 0.35), (w * 0.42, 0.2, h), c, bevel=0.04, taper=0.8)
        p.hewn((0, 0, h - 0.5), (w, 0.2, w * 0.36), c, bevel=0.04)
        p.prism((0, -0.09, h - 0.5), 8, w * 0.42, w * 0.42, 0.18, p.vary(c, 0.05), axis=(0, 1, 0))
    elif kind == 2:     # shouldered slab
        p.hewn((0, 0, h * 0.4 - 0.35), (w, 0.22, h * 0.8), c, bevel=0.04)
        p.hewn((0, 0, h * 0.9 - 0.35), (w * 0.62, 0.22, h * 0.24), c, bevel=0.05)
    else:               # a broken stump
        p.hewn((0, 0, h * 0.22 - 0.3), (w, 0.22, h * 0.5), c, bevel=0.03, chip=0.2, roll=0.07)
    p.turn(m, Matrix.Translation(B(x, z, g)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(lean, 4, 'X') @
           Matrix.Rotation(lean * 0.4, 4, 'Y'))
    if kind == 3:
        p.hewn(B(x + 0.5 * math.cos(yaw), z - 0.7, g + 0.1), (w, h * 0.5, 0.2), c, bevel=0.03, yaw=yaw + 0.4, pitch=0.08)
    footing(f'headstone_{x:.1f}_{z:.1f}', x, z, w / 2 - 0.05, 0.1, yaw, g - 0.35)
    collider_obb(f'headstone_{x:.1f}_{z:.1f}', x, z, w / 2 + 0.05, 0.22, yaw, g + h - 0.3)


def yew(p, lx, lz):
    """The dead yew behind the stair: a split leaning trunk, roots over the
    rubble and into the stair-house wall, long bare boughs over the vault and
    the portal, and its last living sprays of needles."""
    rng = p.rng
    g = gh(lx, lz)
    base = Vector(B(lx, lz, g - 0.3))
    up = Vector((0, 0, 1))
    with p.as_kind(K_WOOD):
        trunk = [base + Vector(v) for v in ((0, 0, 0), (0.2, 0.1, 1.5), (0.6, 0.45, 3.1), (1.15, 0.95, 4.7), (1.6, 1.5, 6.1),
                                            (1.9, 2.1, 7.3))]
        p.sweep(trunk, 0.82, 0.26, BARK, sides=8)
        limb = [base + Vector(v) for v in ((-0.25, -0.1, 1.0), (-0.85, -0.3, 2.9), (-1.4, 0.2, 4.7), (-1.6, 0.9, 6.3))]
        p.sweep(limb, 0.46, 0.16, p.vary(BARK, 0.08), sides=7)
        for (dx, dy, ln, r) in ((1.6, 0.9, 3.2, 0.3), (0.9, 1.9, 2.8, 0.24), (-1.5, 0.4, 2.4, 0.24), (-0.5, -1.6, 2.2, 0.2),
                                (1.9, -0.4, 2.6, 0.24), (0.2, 2.2, 2.2, 0.2)):
            d = Vector((dx, dy, 0)).normalized()
            pts = [base + Vector((0, 0, 0.7)) + d * 0.35]
            for i in range(1, 5):
                q = base + d * (ln * i / 4) + Vector((-d.y, d.x, 0)) * math.sin(i * 1.7 + dx) * 0.25
                q.z = gb(q.x, q.y) + 0.2 * (1 - i / 4) + 0.02
                pts.append(q)
            p.sweep(pts, r, 0.05, p.vary(BARK, 0.1), sides=5)
        tips = []
        boughs = ((trunk[5], (0.5, 0.85), 4.6, 0.24, 0.9), (trunk[5], (0.95, 0.3), 4.0, 0.2, 1.4),
                  (trunk[4], (0.1, 1.0), 4.4, 0.22, 0.2), (trunk[4], (1.0, -0.15), 3.8, 0.2, 0.7),
                  (trunk[3], (0.75, 0.65), 3.4, 0.2, -0.1), (limb[3], (-0.5, 0.85), 3.8, 0.18, 0.8),
                  (limb[3], (-0.95, 0.1), 3.4, 0.16, 1.0), (limb[2], (-0.6, -0.7), 3.0, 0.16, 0.4),
                  (trunk[5], (0.2, -0.9), 3.2, 0.17, 1.2), (trunk[5], (-0.3, 0.6), 3.0, 0.16, 1.9))
        for (o, d2, ln, r, rise) in boughs:
            d = Vector((d2[0], d2[1], 0)).normalized()
            side = Vector((-d.y, d.x, 0))
            wob = rng.uniform(-0.4, 0.4)
            pts = [o - up * 0.2, o + d * ln * 0.33 + up * (rise * 0.6 + 0.3) + side * wob,
                   o + d * ln * 0.68 + up * (rise + 0.2) - side * wob * 0.6, o + d * ln + up * (rise - 0.6)]
            p.sweep(pts, r, 0.035, p.vary(BARK_PALE, 0.08), sides=5)
            tips.append(pts[3])
            for k in range(3):
                t0 = pts[1 + k % 2].lerp(pts[2 + k % 2], rng.random() * 0.6)
                td = (d * rng.uniform(0.2, 1.0) + side * rng.uniform(-1, 1) + up * rng.uniform(-0.35, 0.6)).normalized() * \
                    rng.uniform(0.9, 1.7)
                p.sweep([t0, t0 + td * 0.55 + up * 0.1, t0 + td - up * 0.12], 0.06, 0.012, BARK_PALE, sides=4)
                tips.append(t0 + td)
    for tip in tips[::3][:9]:
        for _ in range(8):
            # (close on the twig's end: a spray two hands off its twig hangs in the air)
            q = tip + Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(-0.5, 0.2))) * 0.2
            p.leaf(q, Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0.5)), rng.uniform(0.3, 0.5),
                   p.vary(YEW[rng.randrange(3)], 0.1), spin=rng.random() * TAU, droop=0.35, n=3)
    collider_circle('yew', lx, lz, 0.85, 9.5)
    footing('yew', lx, lz, 0.4, 0.4, 0.0, g - 0.3)


def outside():
    p = P('Outside', moss=1.25)
    rng = p.rng
    # Two clusters of leaning headstones (the yard of the quests).
    k = 0
    for (cx, cz, n) in ((-14.5, -9.0, 8), (14.2, -16.5, 7)):
        placed = []
        tries = 0
        while len(placed) < n and tries < 200:
            tries += 1
            x = cx + (rng.random() - 0.5) * 6.4
            z = cz + (rng.random() - 0.5) * 5.6
            if any(math.hypot(x - a, z - b) < 1.5 for (a, b) in placed):
                continue
            placed.append((x, z))
            headstone(p, x, z, (0, 1, 2, 0, 3, 2, 0, 1)[k % 8], 0.7 + rng.random() * 0.35, 1.5 + rng.random() * 0.8,
                      (rng.random() - 0.5) * 0.5, (rng.random() - 0.5) * 0.6)
            k += 1
        # One table tomb in each cluster, its lid slid askew.
        tx, tz = cx + 0.4, cz - 0.3 if not placed else cz + 3.6
        g = gh(tx, tz)
        p.hewn(B(tx, tz, g + 0.3), (1.0, 2.0, 0.7), p.tone(tx, tz), bevel=0.06, yaw=0.2)
        p.hewn(B(tx + 0.12, tz + 0.1, g + 0.74), (1.2, 2.2, 0.2), LIME_PALE, bevel=0.06, yaw=0.32, roll=0.04)
        collider_obb(f'table_tomb_{k}', tx, tz, 0.62, 1.12, 0.2, g + 0.9, stand=g + 0.84)
        footing(f'table_tomb_{k}', tx, tz, 0.5, 1.0, 0.2, g - 0.05)
    # The lychgate on the approach, south of the gable: stone cheek walls, four
    # oak posts, a sagging slate roof with slates missing, its little cross.
    lx0, lz0 = -2.5, -31.0
    g = min(gh(lx0 + dx, lz0 + dz) for dx in (-2.2, 2.2) for dz in (-1.3, 1.3))
    for sx in (-1, 1):
        yw = g - 0.4
        TOPS.extend(p.wall((lx0 + sx * 2.35, lz0 - 1.3), (lx0 + sx * 2.35, lz0 + 1.3), 0.7, yw, lambda t: 1.45,
                           course=(0.36, 0.56), unit=(1.0, 2.2), pillow=0.04, ragged=0.1))
        p.hewn(B(lx0 + sx * 2.35, lz0, 1.55 + g), (0.86, 2.8, 0.16), LIME_PALE, bevel=0.05)
        footing(f'lychgate_wall_{"w" if sx > 0 else "e"}', lx0 + sx * 2.35, lz0, 0.35, 1.3, 0.0, yw)
        collider_obb(f'lychgate_wall_{"w" if sx > 0 else "e"}', lx0 + sx * 2.35, lz0, 0.45, 1.4, 0.0, 4.6)
    with p.as_kind(K_WOOD):
        for sx in (-1, 1):
            for sz in (-1, 1):
                p.box(B(lx0 + sx * 2.3, lz0 + sz * 1.05, g + 2.55), (0.3, 0.3, 2.1), TIMBER, bevel=0.04,
                      roll=sx * 0.02 * sz)
            p.box(B(lx0 + sx * 2.3, lz0, g + 3.62), (0.3, 2.9, 0.26), TIMBER, bevel=0.03)
            # the pole plate over the tie beams' ends: the rafters' feet bear on it
            p.box(B(lx0 + sx * 2.3, lz0, g + 3.87), (0.22, 3.1, 0.24), TIMBER_GREY, bottom=False)
            for sz in (-1, 1):   # braces
                p.box(B(lx0 + sx * 1.78, lz0 + sz * 1.05, g + 3.25), (1.1, 0.16, 0.16), TIMBER_GREY, roll=sx * 0.8)
        for sz in (-1, 0, 1):
            p.box(B(lx0, lz0 + sz * 1.05, g + 3.78), (5.0, 0.24, 0.24), TIMBER, bevel=0.03, roll=0.012 * sz)
        ridge = g + 5.25
        pitch = 0.52
        # Four pairs of rafters (the outer pairs under the roof's ends), and
        # the slating battens nailed across them: an eaves fillet and one
        # batten under the head of each course of slates.
        for sz in (-1.38, -0.46, 0.46, 1.38):
            for sx in (-1, 1):
                p.box(B(lx0 + sx * 1.42, lz0 + sz, (g + 3.9 + ridge) / 2), (3.2, 0.14, 0.18), TIMBER_GREY, roll=sx * pitch)
        p.box(B(lx0, lz0, ridge + 0.02), (0.22, 3.4, 0.22), TIMBER, bevel=0.03, pitch=0.012)

        def on_roof(across, lift):
            """Height of a point `lift` above the rafters' backs, `across` from the ridge line."""
            return (g + 3.9 + ridge) / 2 + (1.42 - across) * math.tan(pitch) + (0.09 + lift) / math.cos(pitch)

        LATH = 0.045
        heads = [2.95 - 2.85 * (r + 0.5) / 5 - 0.32 * math.cos(pitch) for r in range(5)]      # each course's head batten
        for sx in (-1, 1):
            for across in [2.76] + heads:
                p.box(B(lx0 + sx * across, lz0, on_roof(across, LATH / 2)), (0.075, 3.34, LATH), TIMBER_GREY,
                      roll=sx * pitch)      # (a batten shows its underside from the path: all six faces)
    # What is left of the slates: the eaves course and a few strays (an open
    # roof: the approach camera looks straight through the rafters). Every
    # slate hangs from its head batten and lies on the batten below, or on the
    # head of the slate under it where that one is still there.
    for sx in (-1, 1):
        below = []
        for r in range(5):
            t = (r + 0.5) / 5
            across = 2.95 - 2.85 * t
            zz = lz0 - 1.7
            course = []
            while zz < lz0 + 1.7:
                w = rng.uniform(0.42, 0.62)
                if rng.random() < (0.7 if r == 0 else (0.2 if sx > 0 else 0.1)):
                    col = p.vary(SLATE, 0.14)
                    jit, yaw = (rng.random() - 0.5) * 0.02, (rng.random() - 0.5) * 0.05
                    lapped = any(min(z1, zz + w) - max(z0, zz) > 0.08 for (z0, z1) in below)
                    tilt = math.atan2(0.055, 0.66) if lapped else 0.0      # its tail up on the slate below
                    p.box(B(lx0 + sx * across, zz + w / 2, on_roof(across, LATH + 0.026) + 0.37 * math.sin(tilt)),
                          (0.74, w - 0.03, 0.05), col, roll=sx * (pitch - tilt + jit), yaw=yaw, bottom=True)
                    course.append((zz, zz + w))
                zz += w
            below = course
    p.hewn(B(lx0, lz0 - 1.55, ridge + 0.5), (0.14, 0.14, 0.8), LIME_PALE, bevel=0.03)
    p.hewn(B(lx0, lz0 - 1.55, ridge + 0.62), (0.5, 0.14, 0.14), LIME_PALE, bevel=0.03)
    # The churchyard wall: tumbled runs either side of the lychgate.
    for (a, b, hh) in (((lx0 + 2.9, lz0), (lx0 + 9.5, lz0 + 0.8), 1.25), ((lx0 - 2.9, lz0), (lx0 - 8.5, lz0 + 1.2), 1.1),
                       ((lx0 + 11.2, lz0 + 1.1), (lx0 + 14.5, lz0 + 2.6), 0.8)):
        yw = base_y([a, b], 0.35)
        TOPS.extend(p.wall(a, b, 0.66, yw, lambda t, hh=hh: hh * (0.55 + 0.45 * math.sin(t * 3.0 + 0.3) ** 2) + 0.15,
                           course=(0.34, 0.54), unit=(1.0, 2.4), pillow=0.045, ragged=0.4, missing=0.0))
        dx, dz = b[0] - a[0], b[1] - a[1]
        collider_obb(f'yard_wall_{a[0]:.0f}', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, math.hypot(dx, dz) / 2, 0.38,
                     math.atan2(-dz, dx), hh + 0.3, stand=hh + 0.2)
        footing(f'yard_wall_{a[0]:.0f}', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, math.hypot(dx, dz) / 2, 0.3,
                math.atan2(-dz, dx), yw)
        rubble(p, b[0], b[1], 1.3, 5, size=(0.22, 0.5))
    # The approach: stepping flags sunk in the turf, from the road side through
    # the lychgate to the gable door.
    path = [(-9.5, -47.0), (-6.5, -40.0), (-2.5, -31.0), (-0.6, -26.0), (0.0, -23.0)]
    for (pa, pb) in zip(path, path[1:]):
        n = max(2, int(math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 1.15))
        for i in range(n):
            t = (i + 0.5) / n
            x = pa[0] + (pb[0] - pa[0]) * t + (rng.random() - 0.5) * 0.5
            z = pa[1] + (pb[1] - pa[1]) * t + (rng.random() - 0.5) * 0.2
            if z < -41 and rng.random() < 0.35:
                continue
            if z > -30 and rng.random() < 0.7:      # a second, broken flag beside it near the door
                with p.as_kind(K_EARTH):
                    p.box(B(x + rng.choice((-1, 1)) * 0.95, z + 0.2, gh(x, z)), (0.7, 0.55, 0.13), p.vary(FLAG, 0.12),
                          chip=0.2, yaw=rng.random() * 1.2, roll=(rng.random() - 0.5) * 0.12, bottom=False)
            w, d = rng.uniform(0.8, 1.35), rng.uniform(0.6, 0.95)
            with p.as_kind(K_EARTH):
                p.box(B(x, z, gh(x, z) + 0.0), (w, d, 0.14), p.vary(FLAG if rng.random() < 0.65 else (0.36, 0.42, 0.3), 0.1),
                      chip=0.14, yaw=rng.random() * 0.6 - 0.3, roll=(rng.random() - 0.5) * 0.07,
                      pitch=(rng.random() - 0.5) * 0.07, bottom=False)
    yew(p, -3.9, 6.3)
    return p


# ================================================================ the growth
def growth(sill, furnishings, walls, stair):
    """Everything green and fallen: one render-only GLB on the leaf material
    (plus stems and moss pads in stone), so the engine can shed it whole.
    `furnishings` is the details piece (the bell and the altar slab the moss
    pads grow on); `walls` and `stair` are the nave and the stair-house (a
    curtain of ivy hangs from where a broken top really is, not from the air
    over it)."""
    p = P('Growth')
    rng = p.rng
    S = Vector((0, 1, 0))     # south
    N = Vector((0, -1, 0))
    # Ivy up the gable's standing west half, over the broken east shoulder,
    # through the rose window and down the nave face.
    gy = -GABLE_Z + 0.6       # Blender Y of the gable's south face
    p.ivy((6.6, gy + 0.03, gh(6.6, GABLE_Z - 0.6)), S, 9.4, 4.6, stems=7, density=2.2, mass=1)
    p.ivy((-6.2, gy + 0.03, gh(-6.2, GABLE_Z - 0.6)), S, 5.2, 4.4, stems=6, density=1.8, mass=1)
    p.ivy((-1.2, gy + 0.08, 14.1), S, 5.0, 3.8, stems=7, density=2.3, hang=True, lean=0.15, mass=2, size=0.2)
    p.ivy((2.2, gy + 0.08, 14.05), S, 2.6, 1.6, stems=5, density=2.1, hang=True, mass=2, size=0.2)
    p.ivy((1.2, -GABLE_Z - 0.62, 13.9), N, 4.6, 3.4, stems=6, density=1.8, hang=True)
    p.ivy((-5.6, -GABLE_Z - 0.62, gh(-5.6, GABLE_Z + 0.7)), N, 4.4, 3.6, stems=4, density=1.8)
    # The stair-house: ivy on its west cheek and over the front's broken rake.
    fz = SH['z0'] + 0.65
    p.ivy((2.9, -(fz - 0.68), gh(2.9, fz - 0.7)), S, 5.6, 1.5, stems=5, density=2.2, lean=-0.15, mass=1)
    def front_top(q):      # the stair-house front's own top, a hand under it
        return stair.surface(q.x, q.y - 0.5, 20.0, 0.0) - 0.15

    p.ivy((-2.6, -(fz - 0.68), 4.9), S, 3.0, 1.7, stems=5, density=1.8, hang=True, top=front_top)
    p.ivy((0.2, -(fz - 0.82), 6.5), S, 2.3, 3.4, stems=7, density=2.2, hang=True, mass=2, size=0.2, top=front_top)
    p.ivy((1.4, -(fz - 0.82), 7.4), S, 2.0, 1.4, stems=4, density=2.0, hang=True, mass=2, size=0.2, top=front_top)
    p.ivy((SH['hw'] + 0.03, -3.0, gh(SH['hw'], 3.0)), Vector((1, 0, 0)), 4.2, 3.2, stems=4, density=1.8)
    p.ivy((-SH['hw'] - 0.03, -2.2, 4.6), Vector((-1, 0, 0)), 3.2, 3.0, stems=3, density=1.8, hang=True)
    # The nave walls: a curtain on the east wall's tall end, tufts at every foot.
    p.ivy((-(NAVE_X - 0.5) - 0.52, -(GABLE_Z + 3.4), gh(-9.0, GABLE_Z + 3.4)), Vector((-1, 0, 0)), 5.8, 4.6, stems=6,
          density=1.8)
    p.ivy(((NAVE_X - 0.5) - 0.52, -(GABLE_Z + 4.6), 6.4), Vector((-1, 0, 0)), 4.6, 3.8, stems=4, density=1.8,
          hang=True, top=lambda q: walls.surface(q.x + 0.45, q.y, 20.0, 0.0) - 0.2)
    p.ivy((-2.5 + 2.35 + 0.38, 31.0, gh(0, -31) + 0.1), Vector((1, 0, 0)), 2.3, 2.2, stems=3, density=1.8, size=0.3)
    # Grass and weeds on every broken wall top, with moss pads and loose stones.
    for (pos, w) in TOPS:
        r = rng.random()
        if r < 0.09:
            p.grass(pos + Vector((rng.uniform(-0.3, 0.3) * w, rng.uniform(-0.2, 0.2), 0.02)), radius=0.24, blades=6,
                    height=0.42, dry=0.35)
        elif r < 0.18:
            moss_pad(p, pos + Vector((0, 0, 0.0)), (min(1.3, w) * rng.uniform(0.6, 1.0), 0.8, 0.2))
    # Tufts along the feet of the walls and round the fallen things.
    def foot(lx, lz, n, spread, h=0.5):
        for _ in range(n):
            x, z = lx + rng.uniform(-spread, spread), lz + rng.uniform(-spread, spread)
            p.grass(B(x, z, gh(x, z)), radius=0.34, blades=6, height=h * rng.uniform(0.7, 1.4), dry=0.22)

    for (lx, lz, n, s) in ((4.9, 4.5, 6, 1.5), (-4.7, 4.3, 4, 1.2), (5.6, -4.3, 2, 0.7), (5.4, -19.4, 3, 1.0), (-5.6, -4.6, 3, 1.4),
                           (0, 10.2, 6, 2.4), (-14.5, -9.0, 6, 3.4), (14.2, -16.5, 6, 3.2), (-2.5, -31.0, 4, 2.6),
                           (3.4, -0.9, 2, 0.4), (-3.4, -0.9, 2, 0.4), (-3.9, 6.3, 4, 1.4), (-6.5, -24.2, 5, 2.2)):
        foot(lx, lz, n, s)
    # Bramble at the wall feet: arching canes with a few leaves.
    for (lx, lz, yaw, n) in ((-9.6, -14.0, 1.4, 3), (9.7, -8.0, -1.5, 3), (8.6, 1.2, -1.0, 3), (-7.6, 8.0, 2.4, 3),
                             (6.0, -23.6, 0.2, 3), (-10.6, -20.4, 1.0, 3)):
        for k in range(n):
            a = yaw + rng.uniform(-0.9, 0.9)
            ln = rng.uniform(1.4, 2.6)
            b0 = Vector(B(lx + rng.uniform(-0.5, 0.5), lz + rng.uniform(-0.5, 0.5), 0))
            b0.z = gb(b0.x, b0.y)
            d = Vector((math.cos(a), math.sin(a), 0))
            pts = [b0 + d * (ln * t) + Vector((0, 0, math.sin(math.pi * min(1.0, t * 1.15)) * ln * 0.5)) for t in
                   (0, 0.25, 0.5, 0.75, 1.0)]
            with p.as_kind(K_WOOD):
                p.sweep(pts, 0.035, 0.014, (0.33, 0.16, 0.14), sides=3, cap=False)
            for q in pts[1:]:
                for _ in range(2):
                    p.leaf(q + Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0.05)),
                           Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 1.0)), rng.uniform(0.22, 0.34),
                           p.vary(rk.IVY[rng.randrange(4)] if rng.random() > 0.2 else rk.IVY_TURN[0], 0.1),
                           spin=rng.random() * TAU, n=3)
    # Fallen leaves: drifted against the sill, on the landing, under the yew,
    # on the flags inside the gable door.
    p.litter((0.0, -(fz - 1.2)), 1.9, 36, gb, LITTER)
    p.litter((-3.2, -5.2), 2.6, 30, gb, LITTER)
    p.litter((0.0, -(GABLE_Z + 2.0)), 2.4, 27, gb, LITTER)
    p.litter((2.5, 31.0), 2.2, 18, gb, LITTER)
    p.litter((4.9, -4.5), 1.6, 12, gb, LITTER)
    # Moss on the bell's upturned flank, the altar slab and the sill ends.
    for (lx, lz, size) in ((4.7, 4.9, (0.9, 0.7, 0.2)), (-4.7, 4.9, (0.8, 1.0, 0.16))):
        q = B(lx, lz, 0)
        moss_pad(p, B(lx, lz, furnishings.surface(q.x, q.y, gh(lx, lz) + 3.0, gh(lx, lz))), size)
    return p


# ================================================================ main
def existing_world_proxies(mats):
    """Render-only stand-ins for what the world already places here: the ruin
    ring's six remaining columns (the seventh, on the door lane, is dropped by
    the integration) and its fallen relics. Never exported."""
    p = Ruin('EXISTING_RuinRing_proxy')
    white = (0.86, 0.87, 0.9)
    with p.as_kind(K_RAW):
        for i in range(1, 7):
            ang = TAU * i / 7
            lx, lz = math.sin(ang) * 7, -12 + math.cos(ang) * 7
            intact = i % 4 == 1
            sy = 3.5 + (i % 2) * 0.5 if intact else 1.7 + (i % 3) * 0.85
            hgt = sy if intact else 0.65 * sy
            p.column(B(lx, lz, gh(lx, lz) - 0.1), hgt, 0.5, white, sides=10, capital=intact, broken=0.0 if intact else 0.05)
        for (lx, lz, s) in ((-2.4, -14.7, 1.3), (0.1, -16.3, 0.8)):
            p.rock(B(lx, lz, gh(lx, lz) + 0.3), (s, s, s * 0.7), white, jitter=0.15, subdivisions=1)
        p.box(B(-3.2, -17.2, gh(-3.2, -17.2) + 0.45), (3.2, 0.96, 0.9), white, yaw=0.49)
    obj = p.finish(mats, None)
    coll = bpy.data.collections.new('EXISTING_World_Proxies')
    bpy.context.scene.collection.children.link(coll)
    for cc in obj.users_collection:
        cc.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def new_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = rk.make_materials()
    sh, sill = stair_house()
    pieces = {'main': [gable(), sh, details(sill)], 'walls': [nave()], 'props': [outside()]}
    pieces['growth'] = [growth(sill, pieces['main'][2], pieces['walls'][0], sh)]
    allp = [p for group in pieces.values() for p in group]
    print('SETTLED', json.dumps({p.name: p.settled for p in allp}))
    bvh = None if '--no-ao' in argv else rk.occluder(allp, GR)
    roots = {'main': 'CryptEntrance_ROOT', 'walls': 'CryptEntranceWalls_ROOT', 'props': 'CryptEntranceProps_ROOT',
             'growth': 'CryptEntranceGrowth_ROOT'}
    files = {'main': 'hollow_crypt_entrance.glb', 'walls': 'hollow_crypt_entrance_walls.glb',
             'props': 'hollow_crypt_entrance_props.glb', 'growth': 'hollow_crypt_entrance_growth.glb'}
    raw = os.path.join(OUT, 'glb_raw')
    os.makedirs(raw, exist_ok=True)
    stats = {'tris': {}, 'total_tris': 0}
    objs_all = []
    for key, group in pieces.items():
        root = new_root(roots[key])
        objs = [p.finish(mats, root, ground=gb, bvh=bvh) for p in group]
        objs_all.extend(objs)
        for o in objs:
            n = ec.count_tris([o])
            stats['tris'][o.name] = n
            stats['total_tris'] += n
        ec.export_glb([root] + objs, os.path.join(raw, files[key]))
    stats.update({'sill': round(sill, 3), 'sockets': SOCKETS, 'candles': CANDLES, 'colliders': COLLIDERS,
                  'footings': ec.gap_report(GR, FOOTINGS), 'door': GR.door, 'quest': QUEST})
    stats['footingsShort'] = [f['name'] for f in stats['footings'] if not f['ok']]
    stats['footingRows'] = [{'name': n, 'cx': round(cx, 3), 'cz': round(cz, 3), 'hw': round(hw, 3), 'hd': round(hd, 3),
                             'rot': round(rot, 4), 'bottom': round(b, 3)} for (n, cx, cz, hw, hd, rot, b) in FOOTINGS]
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    print('STATS', json.dumps({'tris': stats['tris'], 'total': stats['total_tris'], 'short': stats['footingsShort'],
                               'candles': len(CANDLES), 'colliders': len(COLLIDERS)}))
    path = [(-9.5, -47.0), (-6.5, -40.0), (-2.5, -31.0), (-0.6, -26.0), (0.0, -23.0), (0.0, -4.0)]
    ec.build_terrain(GR, 'vale', paths=[(path, 0.9)])
    import crypt_renders
    for (kx, kz, yaw, nm) in ((-1.3, -6.2, 8, 'InNave'), (-4.6, -34.0, -20, 'AtLychgate'), (1.5, -3.0, 20, 'AtStair')):
        crypt_renders.figure(GR, kx, kz, yaw, 'Knight_' + nm)
    crypt_renders.vfx_reference(SOCKETS, CANDLES, sill)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hollow_crypt_entrance_v2.blend'))
    if RENDERS != 'none':
        crypt_renders.run(OUT, GR, SURR, COLLIDERS, RENDERS, path, TAG)


if __name__ == '__main__':
    main()
