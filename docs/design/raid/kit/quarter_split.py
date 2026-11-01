"""The Anvil of the World cut along the sim's own quarters (Mythic's hidden phase,
docs/design/raid/smith_heart.md section 7.5): the kit's platform pieces as they were
built, split so a quarter can REALLY fall.

Run from build_smith_heart_heart_kit.py on the finished objects, so every surface
keeps its positions, normals and colours exactly (a cut interpolates the three on the
two sides of one shared point): whole, the pieces draw the old picture.

What it makes (every name a kit node, heart_collapse_rig.ts paints them):
  Kit_AnvilFloor            what stays: the bed under the ring
  Kit_AnvilFloor<Vein>      the bed, fascia, string course, balustrade, newels of a quarter
  Kit_AnvilKeel             what stays: the column under the ring and the root's tip
  Kit_AnvilKeel<Vein>       the keel's rock under a quarter (three great masses)
  Kit_HeartDais             what stays: the ring's rim, cut at the sim's lip
  Kit_HeartDaisFoot<Vein>   the rim's foot past the lip (its spurs over the floor)
  Kit_HeartRidgeA, B        a ridge cut down its line: A is quarter k's, B quarter k + 1's
  Kit_Quarter<Vein>         as before, cut into its break cells, with the broken rock

The exact cut (`Cutter`, where a body can stand): the sim's own test (quarter_geom.quarter_of,
ring lip RING_LIP, the same arithmetic as hiddenFallenAt, pinned by
tests/smith_heart_heart_collapse.test.ts on the shipped pieces) runs through the ridge's
line, the ring's rim and the bed. Past the rim a block of fascia stays whole (no walk
there). Everything else (the break cells, the keel's rock, nobody stands on those edges)
is shared out triangle by triangle (`assign`), so the broken line runs along the
surface's own edges and the surface is exactly the triangles it was.

Each vertex's alpha carries its tag, as a byte (class * 64 + chunk):
  chunk  0 stays when this quarter falls; 1 and up: its break cells (the same cell ids
         on all a quarter's pieces, so a cell's floor, rim and ridge go as one).
  class  0 the surface, drawn whole.
         1 broken rock this quarter's own fall shows.
         2 broken rock shown while this quarter stands and the one counter-clockwise
           of it has fallen; 3 the same for the clockwise one.
Pieces never cut keep the alpha of 1 (255: no tag). Broken rock is never drawn while the
floor it lies under is whole (heart_collapse_core.ts `heartFallRanges`), so it costs a
whole floor nothing and can show no seam.

The break cells are one plan turned for all four quarters (a ridge's two halves are
one piece each, turned a quarter per ridge). Deterministic: no clock, seeded jitter.
"""
import math
import random

import quarter_geom as qg

RING_LIP = 0.4  # FINAL_PHASES.ringLip
LIP_R = qg.RING_R + RING_LIP
FLOOR_TOP = 0.02  # the sheet (quarter_pieces.SHEET_Z)
SLAB_BOTTOM = -3.25  # the keel's top: the floor layer's rock runs down to it
KEEL_BAND_R = 38.0  # the keel's masses part here
ISLAND_CLIP = 6.0  # a loose shell narrower than this goes whole, never cut
KEEL_STEP = 2.6  # the keel's walls: a column every this many yards
RIDGE_STEP = 1.5
CHAIN_TOL = 0.14

TAG_NONE = 1.0


def tag_of(klass, chunk):
    return (klass * 64 + chunk) / 255.0


# ---- the break cells ------------------------------------------------------------------------
def _hash2(x, y):
    h = math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return h - math.floor(h)


def _vnoise(x, y):
    xi, yi = math.floor(x), math.floor(y)
    xf, yf = x - xi, y - yi
    u, v = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a, b = _hash2(xi, yi), _hash2(xi + 1, yi)
    c, d = _hash2(xi, yi + 1), _hash2(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v


def _cell_seeds():
    """Quarter 0's cells: rings of seeds (r, share of the unwound sector) from the rim
    in, big stones out at the wall, smaller and fewer round the ring."""
    rng = random.Random(7741)
    rows = ((54.5, 5), (42.0, 4), (30.5, 3), (21.0, 2))
    s0, s1 = qg.sector(0)
    out = []
    for r, n in rows:
        for k in range(n):
            f = (k + 0.5 + rng.uniform(-0.22, 0.22)) / n
            rr = r + rng.uniform(-3.0, 3.0)
            out.append(qg.bp(rr, qg.wind(s0 + (s1 - s0) * f, rr)))
    return out


CELL_SEEDS = _cell_seeds()
CELL_COUNT = len(CELL_SEEDS)


def _turn(x, y, i):
    """A point of quarter i turned back to quarter 0 (a bearing less 90 i)."""
    a = math.radians(-90.0 * i)
    # bp: x = r sin b, y = -r cos b; a turn of the bearing by a.
    return x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)


def cell_of(x, y, i):
    """Quarter i's break cell (1 up) at a plan point: the nearest seed, in a warped
    plan so the borders wander like a break."""
    cx, cy = _turn(x, y, i)
    wx = cx + (_vnoise(cx * 0.11 + 3.1, cy * 0.11 - 7.7) - 0.5) * 7.0 + (_vnoise(cx * 0.55, cy * 0.55 + 19.0) - 0.5) * 1.6
    wy = cy + (_vnoise(cx * 0.11 - 11.0, cy * 0.11 + 5.3) - 0.5) * 7.0 + (_vnoise(cx * 0.55 + 31.0, cy * 0.55) - 0.5) * 1.6
    best, at = 1e18, 0
    for k, (sx, sy) in enumerate(CELL_SEEDS):
        d = (wx - sx) ** 2 + (wy - sy) ** 2
        if d < best:
            best, at = d, k
    return at + 1


def quarter_at(x, y):
    """The quarter index of a plan point past the lip (the sim's arithmetic), else -1."""
    if math.hypot(x, y) < LIP_R:
        return -1
    return qg.quarter_of(x, y)


def region_quarter(x, y):
    i = quarter_at(x, y)
    return -1 if i < 0 else i * 100


def keel_mass(x, y, i):
    """A keel's great masses: the outer rock in two, the inner in one."""
    r, b = qg.polar_of(x, y)
    if r < KEEL_BAND_R:
        return 3
    s0 = qg.sector(i)[0]
    f = ((qg.unwind(b, r) - s0) % 360.0) / 90.0
    return 1 if f < 0.5 else 2


def region_keel(x, y):
    i = quarter_at(x, y)
    return -1 if i < 0 else i * 100 + keel_mass(x, y, i)


# ---- a mesh as triangles --------------------------------------------------------------------
class Tri:
    __slots__ = ('p', 'n', 'c', 'm', 'tag')

    def __init__(self, p, n, c, m, tag=TAG_NONE):
        self.p, self.n, self.c, self.m, self.tag = p, n, c, m, tag

    def centre(self):
        p = self.p
        return ((p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3,
                (p[0][2] + p[1][2] + p[2][2]) / 3)


def read_mesh(mesh):
    """Every triangle of a built piece, with its corner normals and colours."""
    mesh.calc_loop_triangles()
    co = [tuple(v.co) for v in mesh.vertices]
    normals = [tuple(n.vector) for n in mesh.corner_normals]
    data = mesh.color_attributes[0].data
    colours = [tuple(d.color) for d in data]
    tris = []
    loops = mesh.loops
    for lt in mesh.loop_triangles:
        ls = lt.loops
        tris.append(Tri(tuple(co[loops[k].vertex_index] for k in ls), tuple(normals[k] for k in ls),
                        tuple(colours[k][:3] for k in ls), lt.material_index))
    return tris


def write_mesh(bpy, name, tris, materials, parent):
    """A kit object from triangles (corner normals kept, the tag in the alpha)."""
    keys = {}
    verts = []
    faces = []
    nor = []
    col = []
    for t in tris:
        f = []
        for k in range(3):
            q = t.p[k]
            key = (round(q[0] * 2000), round(q[1] * 2000), round(q[2] * 2000))
            at = keys.get(key)
            if at is None:
                at = keys[key] = len(verts)
                verts.append(q)
            f.append(at)
            nor.append(t.n[k])
            c = t.c[k]
            col.extend((c[0], c[1], c[2], t.tag))
        if f[0] == f[1] or f[1] == f[2] or f[0] == f[2]:
            # A sliver welded flat: keep the corner lists in step, drop the face.
            del nor[-3:]
            del col[-12:]
            continue
        faces.append(f)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for mat in materials:
        mesh.materials.append(mat)
    kept = [t for t in tris if len({(round(q[0] * 2000), round(q[1] * 2000), round(q[2] * 2000)) for q in t.p}) == 3]
    mesh.polygons.foreach_set('material_index', [t.m for t in kept])
    attr = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    attr.data.foreach_set('color', col)
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = 0
    mesh.update()
    mesh.normals_split_custom_set(nor)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj


def _key(q):
    return (round(q[0] * 400), round(q[1] * 400), round(q[2] * 400))


def islands(tris):
    """The loose shells of a piece (shared points, the normals' splits ignored)."""
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for t in tris:
        ks = [_key(q) for q in t.p]
        for k in ks:
            parent.setdefault(k, k)
        ra = find(ks[0])
        for k in ks[1:]:
            rb = find(k)
            if rb != ra:
                parent[rb] = ra
    out = {}
    for t in tris:
        out.setdefault(find(_key(t.p[0])), []).append(t)
    return list(out.values())


def _lerp(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def _lerp_n(a, b, t):
    v = _lerp(a, b, t)
    d = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / d, v[1] / d, v[2] / d)


class Cutter:
    """Cuts triangles along a plan `region` function, both sides sharing one exact point
    on every cut edge; `edges` remembers the cut for the broken rock."""

    def __init__(self, region):
        self.region = region
        self.memo = {}
        self.cross = {}
        self.edges = {}

    def at(self, q):
        k = _key(q)
        v = self.memo.get(k)
        if v is None:
            v = self.memo[k] = self.region(q[0], q[1])
        return v

    def crossing(self, a, b):
        """Where the segment a to b leaves a's region (one answer whichever way round)."""
        ka, kb = _key(a), _key(b)
        flip = kb < ka
        k = (kb, ka) if flip else (ka, kb)
        t = self.cross.get(k)
        if t is None:
            p, q = (b, a) if flip else (a, b)
            start = self.region(p[0], p[1])
            lo, hi = 0.0, 1.0
            for _ in range(14):
                mid = (lo + hi) / 2
                m = _lerp(p, q, mid)
                if self.region(m[0], m[1]) == start:
                    lo = mid
                else:
                    hi = mid
            t = self.cross[k] = (lo + hi) / 2
        return 1.0 - t if flip else t

    def note(self, r_self, r_other, a, b, inside):
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        self.edges.setdefault((r_self, r_other), []).append((a, b, (inside[0] - mx, inside[1] - my)))

    def cut(self, t, out):
        rs = [self.at(q) for q in t.p]
        if rs[0] == rs[1] == rs[2]:
            out.setdefault(rs[0], []).append(t)
            return

        def point(i, j):
            u = self.crossing(t.p[i], t.p[j])
            return (_lerp(t.p[i], t.p[j], u), _lerp_n(t.n[i], t.n[j], u), _lerp(t.c[i], t.c[j], u))

        def emit(region, corners):
            for k in range(1, len(corners) - 1):
                c = (corners[0], corners[k], corners[k + 1])
                out.setdefault(region, []).append(
                    Tri(tuple(v[0] for v in c), tuple(v[1] for v in c), tuple(v[2] for v in c), t.m, t.tag))

        v = [(t.p[k], t.n[k], t.c[k]) for k in range(3)]
        if rs[0] != rs[1] and rs[1] != rs[2] and rs[0] != rs[2]:
            ab, bc, ca = point(0, 1), point(1, 2), point(2, 0)
            g = (t.centre(), _lerp_n(_lerp_n(t.n[0], t.n[1], 0.5), t.n[2], 1 / 3),
                 tuple((t.c[0][k] + t.c[1][k] + t.c[2][k]) / 3 for k in range(3)))
            emit(rs[0], [v[0], ab, g, ca])
            emit(rs[1], [v[1], bc, g, ab])
            emit(rs[2], [v[2], ca, g, bc])
            self.note(rs[0], rs[1], ab[0], g[0], t.p[0])
            self.note(rs[1], rs[0], ab[0], g[0], t.p[1])
            self.note(rs[1], rs[2], bc[0], g[0], t.p[1])
            self.note(rs[2], rs[1], bc[0], g[0], t.p[2])
            self.note(rs[2], rs[0], ca[0], g[0], t.p[2])
            self.note(rs[0], rs[2], ca[0], g[0], t.p[0])
            return
        # One corner apart: turn it to the front.
        lone = 0 if rs[1] == rs[2] else (1 if rs[0] == rs[2] else 2)
        i, j, k = lone, (lone + 1) % 3, (lone + 2) % 3
        ij, ki = point(i, j), point(k, i)
        emit(rs[i], [v[i], ij, ki])
        emit(rs[j], [ij, v[j], v[k], ki])
        self.note(rs[i], rs[j], ij[0], ki[0], t.p[i])
        self.note(rs[j], rs[i], ij[0], ki[0], t.p[j])

    def split(self, tris, out, clip_big=ISLAND_CLIP):
        """Cut a piece's big shells; a small shell goes whole with its middle."""
        for shell in islands(tris):
            xs = [q[0] for t in shell for q in t.p]
            ys = [q[1] for t in shell for q in t.p]
            if max(max(xs) - min(xs), max(ys) - min(ys)) < clip_big:
                c = (sum(xs) / len(xs), sum(ys) / len(ys))
                out.setdefault(self.region(c[0], c[1]), []).extend(shell)
            else:
                for t in shell:
                    self.cut(t, out)


def assign(tris, region, out, clip_big=ISLAND_CLIP):
    """Share a piece out without cutting a triangle: a small shell whole by its middle, a
    big one triangle by triangle (the break runs along its edges, a broken line, and
    the surface stays the very triangles it was)."""
    for shell in islands(tris):
        xs = [q[0] for t in shell for q in t.p]
        ys = [q[1] for t in shell for q in t.p]
        if max(max(xs) - min(xs), max(ys) - min(ys)) < clip_big:
            c = (sum(xs) / len(xs), sum(ys) / len(ys))
            out.setdefault(region(c[0], c[1]), []).extend(shell)
        else:
            for t in shell:
                c = t.centre()
                out.setdefault(region(c[0], c[1]), []).append(t)


def broken_edges(parts, keep=None):
    """Every edge shared by two triangles of different regions: {(region, other): [(a, b,
    (plan direction into the rock))]}."""
    seen = {}
    edges = {}
    for region, part in parts.items():
        for t in part:
            if keep and not keep(t):
                continue
            for i, j, k in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
                ka, kb = _key(t.p[i]), _key(t.p[j])
                e = (ka, kb) if ka < kb else (kb, ka)
                other = seen.get(e)
                if other is None:
                    seen[e] = (region, t.p[i], t.p[j], t.p[k])
                elif other[0] != region:
                    a, b = t.p[i], t.p[j]
                    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                    edges.setdefault((region, other[0]), []).append((a, b, (t.p[k][0] - mx, t.p[k][1] - my)))
                    edges.setdefault((other[0], region), []).append(
                        (other[1], other[2], (other[3][0] - mx, other[3][1] - my)))
    return edges


# ---- the broken rock ------------------------------------------------------------------------
GLOW = 1  # the kit's glow slot
def _srgb(c):
    return tuple(ch ** 2.2 for ch in c)


FRESH = _srgb((0.66, 0.6, 0.53))
ROCK = _srgb((0.42, 0.38, 0.35))
ROCK_DARK = _srgb((0.17, 0.16, 0.17))
ROCK_DEEP = _srgb((0.3, 0.2, 0.15))
VEIN_LIGHT = (1.0, 0.62, 0.22)


def _mix(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def rock_colour(x, y, z):
    """The rock a break shows: fresh and pale in the first yard, then bedded granite
    darkening down the keel."""
    n = _vnoise(x * 0.5 + z * 0.2, y * 0.5 - z * 0.2)
    bed = 0.5 + 0.5 * math.sin(z * 1.35 + _vnoise(x * 0.1, y * 0.1) * 6.0)
    bed = bed * bed * (3 - 2 * bed)
    # Warm low down: the heart's light far below catches it.
    deep = max(0.0, min(1.0, (-z - 8.0) / 30.0))
    c = _mix(ROCK, ROCK_DARK, 0.2 + 0.8 * bed)
    c = _mix(c, ROCK_DEEP, deep * deep * 0.7)
    # A faceted rock, face by face.
    c = tuple(ch * (0.72 + 0.56 * _hash2(round(x * 1.4) + 0.3, round(y * 1.4) + round(z * 1.4) * 1.7)) for ch in c)
    fresh = max(0.0, min(1.0, 1.0 + z / 1.4)) * (0.55 + 0.45 * n)
    c = _mix(c, FRESH, fresh)
    k = 0.82 + 0.36 * n
    return tuple(ch * k for ch in c)


def _flat(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    d = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / d, ny / d, nz / d)


def rock_tri(a, b, c, m, tag):
    n = _flat(a, b, c)
    return Tri((a, b, c), (n, n, n), (rock_colour(*a), rock_colour(*b), rock_colour(*c)), m, tag)


def strip(path, tops, bottoms, out_dir, m, tag, rows=2, jag=0.5, salt=0.0, close=False, veins=0):
    """A wall of broken rock under a plan path. `out_dir(mid)` is the plan direction out
    of the rock at a mid point: the wall faces it, and its inner rows only ever fall back
    INTO the rock, so the exact edge at the top stays exact. `close`: its last row back
    on the plan path too (it meets a shell of rock there). `veins`: seams of crystal
    running down it, a hair proud."""
    n = len(path)
    out = []
    if n < 2:
        return out
    grid = []
    for k in range(n):
        x, y = path[k]
        a = path[max(0, k - 1)]
        b = path[min(n - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / d, dx / d
        o = out_dir(((x + (b[0] if k < n - 1 else a[0])) / 2, (y + (b[1] if k < n - 1 else a[1])) / 2))
        if nx * o[0] + ny * o[1] < 0:
            nx, ny = -nx, -ny
        col = []
        for j in range(rows + 1):
            f = j / rows
            z = tops[k] + (bottoms[k] - tops[k]) * f
            back = 0.0
            if 0 < j < rows:
                # No two rows level: beds and breaks, never a ruled course.
                z += (_hash2(x * 3.1 + j, y * 2.3 - j) - 0.5) * abs(bottoms[k] - tops[k]) / rows * 0.7
            if 0 < j and not (close and j == rows):
                # Great ledges and a fine break on them.
                a = _vnoise(x * 0.17 + salt + j * 0.7, y * 0.17 - j * 0.4)
                b = _vnoise(x * 0.8 + salt + j * 3.1, y * 0.8 - j * 1.7)
                c = _hash2(round(x * 2.0) + j * 7.0 + salt, round(y * 2.0) - j * 3.0)
                back = jag * (0.08 + 0.42 * a + 0.12 * b + 0.38 * c)
            col.append((x - nx * back, y - ny * back, z))
        grid.append(col)
    for k in range(n - 1):
        for j in range(rows):
            a, b = grid[k][j], grid[k + 1][j]
            c, d = grid[k][j + 1], grid[k + 1][j + 1]
            # The wall faces out: the triangle's normal against out_dir.
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            o = out_dir(mid)
            test = _flat(a, c, b)
            if test[0] * o[0] + test[1] * o[1] >= 0:
                out.append(rock_tri(a, c, b, m, tag))
                out.append(rock_tri(b, c, d, m, tag))
            else:
                out.append(rock_tri(a, b, c, m, tag))
                out.append(rock_tri(b, d, c, m, tag))
    for v in range(veins):
        out.extend(_vein(grid, rows, tag, salt + v * 11.0, out_dir))
    return out


def _vein(grid, rows, tag, salt, out_dir):
    """A seam of crystal down a wall: from a column near the top it wanders from row to
    row, a thin ribbon a hair proud of the rock (the kit's glow slot, the keel's own)."""
    n = len(grid)
    if n < 4:
        return []
    k = int(_hash2(salt, 3.3) * (n - 2)) + 1
    out = []
    for j in range(rows):
        step = -1 if _hash2(salt + j, 7.1) < 0.5 else 1
        k2 = max(0, min(n - 1, k + step))
        a, b = grid[k][j], grid[k2][j + 1]
        o = out_dir((a[0], a[1]))
        w = 0.34 * (1.0 - j / (rows + 1.0))
        ax, ay = b[0] - a[0], b[1] - a[1]
        d = math.hypot(ax, ay) or 1.0
        tx, ty = ax / d * w, ay / d * w
        p = (0.16 * o[0], 0.16 * o[1])
        q0 = (a[0] + p[0] - tx, a[1] + p[1] - ty, a[2] + w)
        q1 = (a[0] + p[0] + tx, a[1] + p[1] + ty, a[2] - w)
        q2 = (b[0] + p[0] + tx * 0.7, b[1] + p[1] + ty * 0.7, b[2] - w * 0.7)
        q3 = (b[0] + p[0] - tx * 0.7, b[1] + p[1] - ty * 0.7, b[2] + w * 0.7)
        for tri in ((q0, q1, q2), (q0, q2, q3)):
            n0 = _flat(*tri)
            if n0[0] * o[0] + n0[1] * o[1] < 0:
                tri = (tri[0], tri[2], tri[1])
                n0 = _flat(*tri)
            out.append(Tri(tri, (n0, n0, n0), (VEIN_LIGHT, VEIN_LIGHT, VEIN_LIGHT), GLOW, tag))
        k = k2
    return out


def _chains(edges):
    """Cut edges joined into plan polylines."""
    nexts = {}
    for a, b, _in in edges:
        ka, kb = _key((a[0], a[1], 0)), _key((b[0], b[1], 0))
        if ka == kb:
            continue
        nexts.setdefault(ka, []).append((kb, b))
        nexts.setdefault(kb, []).append((ka, a))
    used = set()
    out = []
    pos = {}
    for a, b, _in in edges:
        pos[_key((a[0], a[1], 0))] = a
        pos[_key((b[0], b[1], 0))] = b
    # Start from the ends, then whatever loops are left.
    starts = [k for k, v in nexts.items() if len(v) == 1] + list(nexts)
    for s in starts:
        k = s
        chain = [pos[k]]
        while True:
            step = None
            for other, _p in nexts[k]:
                e = (k, other) if k < other else (other, k)
                if e not in used:
                    used.add(e)
                    step = other
                    break
            if step is None:
                break
            chain.append(pos[step])
            k = step
        if len(chain) > 1:
            out.append(chain)
    return out


def _simplify(line, tol):
    if len(line) < 3:
        return line
    a, b = line[0], line[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = math.hypot(dx, dy)
    worst, at = -1.0, 0
    for k in range(1, len(line) - 1):
        q = line[k]
        if d < 1e-6:
            e = math.hypot(q[0] - a[0], q[1] - a[1])
        else:
            e = abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / d
        if e > worst:
            worst, at = e, k
    if worst <= tol:
        return [a, b]
    return _simplify(line[:at + 1], tol)[:-1] + _simplify(line[at:], tol)


def _out_of(edges):
    """The plan direction out of the rock near a point: the nearest cut edge's own."""
    pts = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -ins[0], -ins[1]) for a, b, ins in edges]

    def out_dir(q):
        best, at = 1e18, None
        for p in pts[::max(1, len(pts) // 40)]:
            d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
            if d < best:
                best, at = d, p
        return (at[2], at[3])

    return out_dir


def floor_walls(edges, m, tag):
    """The floor layer's broken rock under a sheet's cut: chained, simplified, down to
    the keel's top."""
    out = []
    out_dir = _out_of(edges)
    for chain in _chains(edges):
        line = _simplify([(q[0], q[1]) for q in chain], CHAIN_TOL)
        tops = [FLOOR_TOP - 0.02] * len(line)
        bottoms = [SLAB_BOTTOM] * len(line)
        out.extend(strip(line, tops, bottoms, out_dir, m, tag, rows=1, jag=0.7))
    return out


def _radius(q):
    return math.hypot(q[0], q[1])


def _bearing_param(edges):
    """Yards round the room along a cut, from the cut's own middle (never across the wrap
    of the bearings)."""
    sx = sum(e[0][0] for e in edges)
    sy = sum(e[0][1] for e in edges)
    mid = qg.polar_of(sx, sy)[1]

    def param(q):
        d = (qg.polar_of(q[0], q[1])[1] - mid + 180.0) % 360.0 - 180.0
        return math.radians(d) * LIP_R

    return param


def bucket_wall(edges, param, step, z_bottom, m, tag, rows=1, jag=0.4, salt=0.0, reach=0.0, z_top=None, close=False,
                veins=0):
    """A wall under a cut with height in it (a ridge's spine, the keel's section): a
    column every `step` along `param`, from `z_top` (or the highest cut point there) down
    to `z_bottom` (a number) or the lowest cut point less `reach`."""
    pts = [q for a, b, _in in edges for q in (a, b)]
    if not pts:
        return []
    ss = [param(q) for q in pts]
    lo, hi = min(ss), max(ss)
    n = max(1, int(math.ceil((hi - lo) / step)))
    cols = [[] for _ in range(n + 1)]
    for q, s in zip(pts, ss):
        cols[int(round((s - lo) / (hi - lo + 1e-9) * n))].append(q)
    line, tops, bottoms = [], [], []
    for c in cols:
        if not c:
            continue
        line.append((sum(q[0] for q in c) / len(c), sum(q[1] for q in c) / len(c)))
        tops.append(z_top if z_top is not None else max(q[2] for q in c))
        bottoms.append(z_bottom if z_bottom is not None else min(q[2] for q in c) - reach)
    if len(line) < 2:
        return []
    return strip(line, tops, bottoms, _out_of(edges), m, tag, rows=rows, jag=jag, salt=salt, close=close, veins=veins)


def underside(tris, z, m, tag, spokes=9):
    """A cell's underside: a fan under its sheet's outline (seen only as it tumbles)."""
    xs = [q for t in tris for q in t.p]
    cx = sum(q[0] for q in xs) / len(xs)
    cy = sum(q[1] for q in xs) / len(xs)
    reach = [None] * spokes
    for q in xs:
        a = math.atan2(q[1] - cy, q[0] - cx) % math.tau
        k = int(a / math.tau * spokes) % spokes
        d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2
        if reach[k] is None or d > reach[k][0]:
            reach[k] = (d, q)
    ring = [(r[1][0], r[1][1], z) for r in reach if r]
    out = []
    centre = (cx, cy, z - 0.8)
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        # Facing down.
        t = rock_tri(centre, b, a, m, tag)
        if t.n[0][2] > 0:
            t = rock_tri(centre, a, b, m, tag)
        out.append(t)
    return out


# ---- the pieces -----------------------------------------------------------------------------
STONE = 0
VEINS = qg.ORDER


def _name(base, i):
    return base + VEINS[i].capitalize()


def _neighbour_class(i, other):
    """The class of the rock quarter i shows when quarter `other` falls."""
    if other == (i + 3) % 4:
        return 2
    if other == (i + 1) % 4:
        return 3
    return 1


def split_quarter_floor(tris, i):
    """Kit_Quarter<Vein> cut into its cells, each with its broken rock and underside."""
    out = {}
    assign(tris, lambda x, y: cell_of(x, y, i), out)
    sheet_edges = broken_edges(out, lambda t: t.m == STONE and all(abs(q[2] - FLOOR_TOP) < 0.004 for q in t.p))
    final = []
    for cell, part in out.items():
        for t in part:
            t.tag = tag_of(0, cell)
        final.extend(part)
    # The sheet's own edge round the ring: rock there too.
    open_edges = {}
    for t in tris:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if abs(t.p[a][2] - FLOOR_TOP) > 0.004 or abs(t.p[b][2] - FLOOR_TOP) > 0.004:
                continue
            ka, kb = _key(t.p[a]), _key(t.p[b])
            k = (ka, kb) if ka < kb else (kb, ka)
            if k in open_edges:
                open_edges[k] = None
            else:
                open_edges[k] = (t.p[a], t.p[b], t.p[3 - a - b])
    by_cell = {}
    for v in open_edges.values():
        if v is None or max(_radius(v[0]), _radius(v[1])) > qg.RING_R + 1.0:
            continue
        cell = cell_of((v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2, i)
        mx, my = (v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2
        by_cell.setdefault(cell, []).append((v[0], v[1], (v[2][0] - mx, v[2][1] - my)))
    grouped = {}
    for (self_cell, _other), edges in sheet_edges.items():
        grouped.setdefault(self_cell, []).extend(edges)
    for cell, edges in by_cell.items():
        grouped.setdefault(cell, []).extend(edges)
    for cell, edges in grouped.items():
        if edges:
            final.extend(floor_walls(edges, STONE, tag_of(1, cell)))
    for cell, part in out.items():
        sheet = [t for t in part if abs(t.p[0][2] - FLOOR_TOP) < 0.004 and t.m == STONE]
        if sheet:
            final.extend(underside(sheet, SLAB_BOTTOM, STONE, tag_of(1, cell)))
    return final


def split_rim(tris):
    """Kit_AnvilFloor: the bed cut at the sim's edges (its triangles take their cell by
    their middle: it lies hidden under the sheet), the rim's blocks whole in the cell
    they lie in, their faces against the walk dropped (never seen). Returns (the piece
    that stays, {quarter: tris})."""
    bed = []
    rest = []
    for t in tris:
        if all(abs(q[2] + 0.06) < 0.006 for q in t.p):
            bed.append(t)
            continue
        c = t.centre()
        r = _radius(c)
        n = t.n[0]
        # A face against the walk: inward, under it, at the lip.
        if t.m == STONE and 59.9 < r < 61.5 and max(q[2] for q in t.p) <= 0.02 and r > 0:
            if (n[0] * c[0] + n[1] * c[1]) / r < -0.6:
                continue
        # The balustrade base's top under its coping, the fascia's under the string course
        # (the bridge's own opening keeps its).
        if t.m == STONE and n[2] > 0.9 and 59.9 < r < 60.85:
            z = c[2]
            bridge = abs((qg.polar_of(c[0], c[1])[1] - 225.0 + 180.0) % 360.0 - 180.0) < 12.0
            if 0.55 < z < 0.67 or (-0.06 < z < 0.0 and not bridge):
                continue
        rest.append(t)
    cutter = Cutter(region_quarter)
    out = {}
    for t in bed:
        cutter.cut(t, out)
    stays = out.pop(-1, [])
    quarters = {i: [] for i in range(4)}
    for key, part in out.items():
        i = key // 100
        for t in part:
            c = t.centre()
            t.tag = tag_of(0, cell_of(c[0], c[1], i))
        quarters[i].extend(part)
    for shell in islands(rest):
        xs = [q[0] for t in shell for q in t.p]
        ys = [q[1] for t in shell for q in t.p]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        i = quarter_at(cx, cy)
        if i < 0:
            stays.extend(shell)
            continue
        cell = cell_of(cx, cy, i)
        for t in shell:
            t.tag = tag_of(0, cell)
        quarters[i].extend(shell)
    return stays, quarters


def split_keel(tris):
    """Kit_AnvilKeel: the column under the ring stays; each quarter's rock three masses,
    every cut walled in rock."""
    # The shell's flat top (a few vast triangles right across the disc) gives way to each
    # mass's own (`_keel_top`): whole, the floor lies over it and nothing sees it.
    tris = [t for t in tris if not all(q[2] > SLAB_BOTTOM - 0.2 for q in t.p)]
    out = {}
    assign(tris, region_keel, out)
    # The rock's own shell only: a crystal on it never walls anything.
    rock_edges = broken_edges(out, lambda t: t.m == STONE)
    stays = out.pop(-1, [])
    quarters = {i: [] for i in range(4)}
    for key, part in out.items():
        i, mass = key // 100, key % 100
        for t in part:
            t.tag = tag_of(0, mass)
        quarters[i].extend(part)
    for (rs, ro), edges in rock_edges.items():
        if rs < 0:
            continue
        i, mass = rs // 100, rs % 100
        salt = i * 13.0 + mass
        if ro < 0:
            # The ring's column as this quarter's rock is gone (chunk 0: stays), and the
            # mass's own face against it.
            quarters[i].extend(_ring_face(edges, i, mass, salt))
            continue
        other = ro // 100
        if other != i:
            # What stands after the neighbour has gone: the whole section of the rock.
            quarters[i].extend(bucket_wall(edges, _radius, KEEL_STEP, None, STONE, tag_of(_neighbour_class(i, other), mass),
                                           rows=6, jag=4.2, salt=salt, reach=0.3, z_top=SLAB_BOTTOM, close=True, veins=3))
        else:
            # The masses' own borders: round the band, or out along the middle.
            rs_mid = [_radius(e[0]) for e in edges]
            param = _bearing_param(edges) if max(rs_mid) - min(rs_mid) < 1.5 else _radius
            quarters[i].extend(bucket_wall(edges, param, KEEL_STEP * 1.5, None, STONE, tag_of(1, mass), rows=2, jag=1.2,
                                           salt=salt, reach=0.3, z_top=SLAB_BOTTOM, close=True))
    for i in range(4):
        for mass in (1, 2, 3):
            quarters[i].extend(_keel_top(i, mass))
    return stays, quarters


def _keel_top(i, mass):
    """A mass's flat top (the keel's own shell stops short of it), seen only as it goes."""
    rows = (KEEL_BAND_R, qg.RIM_R) if mass < 3 else (LIP_R, KEEL_BAND_R)
    s0 = qg.sector(i)[0]
    a0, a1 = (0.0, 45.0) if mass == 1 else ((45.0, 90.0) if mass == 2 else (0.0, 90.0))
    grid = []
    for ring in range(4):
        r = rows[0] + (rows[1] - rows[0]) * ring / 3
        grid.append([qg.bp(r, qg.wind(s0 + a0 + (a1 - a0) * k / 5, r)) + (SLAB_BOTTOM,) for k in range(6)])
    out = []
    tag = tag_of(1, mass)
    for ring in range(3):
        for k in range(5):
            a, b, c, d = grid[ring][k], grid[ring][k + 1], grid[ring + 1][k], grid[ring + 1][k + 1]
            for tri in ((a, c, b), (b, c, d)):
                t = rock_tri(*tri, STONE, tag)
                if t.n[0][2] < 0:
                    t = rock_tri(tri[0], tri[2], tri[1], STONE, tag)
                out.append(t)
    return out


def _ring_face(edges, i, mass, salt):
    """The two faces of the cut at the ring's lip under quarter i: the column left
    standing (chunk 0, facing out) and the falling mass's (facing in)."""
    param = _bearing_param(edges)
    out = bucket_wall(edges, param, KEEL_STEP * 1.5, None, STONE, tag_of(1, mass), rows=2, jag=1.2, salt=salt,
                      reach=0.3, z_top=SLAB_BOTTOM, close=True)
    # The column's face: the same cut seen from the other side.
    flipped = [(a, b, (-ins[0], -ins[1])) for a, b, ins in edges]
    out.extend(bucket_wall(flipped, param, KEEL_STEP, None, STONE, tag_of(1, 0), rows=7, jag=3.0, salt=salt + 40.0,
                           reach=0.3, z_top=-0.25, close=True, veins=2))
    return out


def split_dais(tris):
    """Kit_HeartDais cut at the sim's lip: its foot past it goes with the quarter, a face
    of rock left on the ring (chunk 0 of the foot's piece, shown once that quarter falls)."""
    cutter = Cutter(region_quarter)
    out = {}
    # Where bodies stand: nothing whole across the sim's line, however small.
    cutter.split(tris, out, clip_big=0.0)
    stays = out.pop(-1, [])
    quarters = {i: [] for i in range(4)}
    for key, part in out.items():
        i = key // 100
        for t in part:
            c = t.centre()
            t.tag = tag_of(0, cell_of(c[0], c[1], i))
        quarters[i].extend(part)
    for (rs, ro), edges in cutter.edges.items():
        if rs >= 0 and ro < 0:
            i = rs // 100
            flipped = [(a, b, (-ins[0], -ins[1])) for a, b, ins in edges]
            quarters[i].extend(bucket_wall(flipped, _bearing_param(edges), RIDGE_STEP, -0.3, STONE, tag_of(1, 0), rows=1,
                                           jag=0.15, salt=i * 7.0))
    return stays, quarters


def split_ridge(tris):
    """Kit_HeartRidge (ridge 0, between quarters 0 and 1) cut down its line: halves A
    (quarter 0) and B (quarter 1), their cells' rock and the seam's own wall (class 3 on
    A, class 2 on B: shown when the other side has fallen)."""
    cutter = Cutter(region_quarter)
    out = {}
    # Where bodies stand: nothing whole across the sim's line, however small.
    cutter.split(tris, out, clip_big=0.0)
    a, b = [], []
    for key, part in out.items():
        if key < 0:
            # The tail under the ring's rim: half each, it stays.
            for t in part:
                t.tag = tag_of(0, 0)
                c = t.centre()
                (a if qg.quarter_of(c[0], c[1]) == 0 else b).append(t)
            continue
        i = key // 100
        for t in part:
            c = t.centre()
            t.tag = tag_of(0, cell_of(c[0], c[1], i))
        (a if i == 0 else b).extend(part)
    # The seam's own wall, cell by cell: the rock the other side's fall leaves showing.
    groups = {}
    for (rs, ro), edges in cutter.edges.items():
        if rs < 0 or ro < 0 or ro // 100 == rs // 100:
            continue
        i = rs // 100
        for e in edges:
            m = ((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2)
            groups.setdefault((i, cell_of(m[0], m[1], i)), []).append(e)
    for (i, cell), edges in groups.items():
        sink = a if i == 0 else b
        sink.extend(bucket_wall(edges, _radius, RIDGE_STEP, SLAB_BOTTOM, STONE, tag_of(3 if i == 0 else 2, cell), rows=2,
                                jag=0.5, salt=cell * 5.0))
    return a, b


def split_kit(bpy, materials, root):
    """Replace the built platform pieces with their cut ones. Returns the new objects."""
    made = []

    def take(name):
        obj = bpy.data.objects[name]
        tris = read_mesh(obj.data)
        mesh = obj.data
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(mesh)
        return tris

    def put(name, tris):
        obj = write_mesh(bpy, name, tris, materials, root)
        made.append(obj)
        print(f'SPLIT {name} triangles {len(tris)}', flush=True)

    stays, quarters = split_rim(take('Kit_AnvilFloor'))
    put('Kit_AnvilFloor', stays)
    for i in range(4):
        put(_name('Kit_AnvilFloor', i), quarters[i])
    stays, quarters = split_keel(take('Kit_AnvilKeel'))
    put('Kit_AnvilKeel', stays)
    for i in range(4):
        put(_name('Kit_AnvilKeel', i), quarters[i])
    stays, quarters = split_dais(take('Kit_HeartDais'))
    put('Kit_HeartDais', stays)
    for i in range(4):
        put(_name('Kit_HeartDaisFoot', i), quarters[i])
    a, b = split_ridge(take('Kit_HeartRidge'))
    put('Kit_HeartRidgeA', a)
    put('Kit_HeartRidgeB', b)
    for i in range(4):
        name = _name('Kit_Quarter', i)
        put(name, split_quarter_floor(take(name), i))
    return made
