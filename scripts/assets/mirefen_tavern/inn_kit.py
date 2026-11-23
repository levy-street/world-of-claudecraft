"""The painted inn's kit: the hand-built, never ruler-straight pieces the Mirefen tavern is
raised from (build_tavern.py and the inn_*.py builders call these).

Everything is authored in the tavern's game frame (yards, origin on the ground floor at the
hall's middle, +x to the right of a player walking in, +y up, +z out of the front door) and
handed to shiplib's Piece, which converts to Blender. Every wobble, sag and lean comes from a
stable hash of where a piece stands (no rng), so every build of the same source is identical.

The look is the painted town's: chunky stone that bellies and leans, plaster that bows
between its timbers, oak that sags under its load and leans off plumb, slates that kick up at
the eaves over a sagging ridge. Nothing here is detail for its own sake: the paint (the
town's hand-painted tiling maps, tavern_texture.py) carries the stones, the grain and the slates,
so the geometry stays low and only the silhouette and the light do the work.

  hash01, jit, vnoise   stable noise (a value in [0, 1), a jitter in [-amp, amp], smooth noise)
  Wall                  a straight wall line: u along it, v up, w out of it
  face                  one single-sided face, turned to face a given way
  skin                  a wall face as a grid that bows and bellies, with rectangular holes
  hewn                  a timber that sags, leans and wanders a little along its length
  block                 a closed lump (a stone, a quoin, a joist end) from eight corners
"""
import math

from mathutils import Vector
from shiplib import P

# the painted materials' slots (tavern_texture.MATERIALS order)
TIMBER, METAL, STONE, PLASTER, GLOW, ROOF, FLOOR, CLOTH, DRESSED, PLAIN, PROPS = range(11)

# face tags (shiplib): FLAT faces skip the soft gradient and the wear
PLAIN_TAG, EDGE, FLAT = 0, 1, 2

# ---------------------------------------------------------------------------
# The painted palette every builder shares: on a painted material a colour is a tint over the
# map (1 is the map as painted, never over 1: the corner colours are bytes), on the rest it is
# the colour itself
# ---------------------------------------------------------------------------
# (the maps are Fenbridge's: the Fenrire look the painted town's buildings there wear, and these
# tints keep the tavern on their palette, measured against those buildings' own baked maps:
# grey-brown weathered oak, mossy grey rubble, pale grey dressed stone, cream limewash, dark mossy
# slates)
OAK = (1.0, 0.96, 0.91)         # the frame's oak: the map's weathered grey-brown oak, a touch warm
OAK_DARK = (0.86, 0.8, 0.75)    # oak in shadow and soot
STONE_T = (1.0, 1.0, 0.97)      # the wall stone: the map's mossy rubble as painted
DRESSED_T = (0.98, 0.96, 0.92)  # quoins, sills, surrounds, flags
PLASTER_T = (1.0, 0.98, 0.95)   # the limewash outside: the map's, a shade toward cream
PLASTER_IN = (1.0, 0.98, 0.96)  # the limewash inside (the firelight's bake warms it)
SLATE = (0.96, 0.96, 0.96)      # the slates (grey: the roof tints by brightness alone)
SARKING = (0.62, 0.55, 0.5)     # the boards under the slates, seen from below
IRON = (0.2, 0.2, 0.22)
PANE = (1.0, 0.7, 0.36)         # a lit window's glow
PANE_DIM = (0.86, 0.55, 0.27)   # the same glow seen from inside


# ---------------------------------------------------------------------------
# Stable noise
# ---------------------------------------------------------------------------
def hash01(*k):
    """A stable pseudo-random number in [0, 1) from a few numbers."""
    v = math.sin(sum(x * (12.9898 + 7.233 * i) for i, x in enumerate(k)) + 0.5) * 43758.5453
    return v - math.floor(v)


def jit(amp, *k):
    """A stable jitter in [-amp, amp]."""
    return (hash01(*k) * 2.0 - 1.0) * amp


def _fade(t):
    return t * t * (3.0 - 2.0 * t)


def vnoise(x, y=0.0, seed=0.0):
    """Smooth value noise in [-1, 1]: the slow bow of a wall, the wander of a ridge."""
    xi, yi = math.floor(x), math.floor(y)
    tx, ty = _fade(x - xi), _fade(y - yi)
    a = hash01(xi, yi, seed)
    b = hash01(xi + 1, yi, seed)
    c = hash01(xi, yi + 1, seed)
    d = hash01(xi + 1, yi + 1, seed)
    top = a + (b - a) * tx
    bot = c + (d - c) * tx
    return (top + (bot - top) * ty) * 2.0 - 1.0


def tint(base, k, *seed, spread=0.06):
    """A colour scaled by k and nudged per piece (the per-board, per-stone variation)."""
    j = 1.0 + jit(spread, *seed)
    return tuple(max(0.0, c * k * j) for c in base)


# ---------------------------------------------------------------------------
# Walls
# ---------------------------------------------------------------------------
class Wall:
    """A straight wall line in the game frame. u runs along it from (x0, z0) to (x1, z1), v is
    the height over the ground floor, w points out of it (toward `out`, a game-frame (x, z)
    direction): pt(u, v, w) is a game-frame point."""

    def __init__(self, x0, z0, x1, z1, out, seed=0.0):
        self.o = Vector((x0, 0.0, z0))
        d = Vector((x1 - x0, 0.0, z1 - z0))
        self.length = d.length
        self.d = d / self.length
        n = Vector((out[0], 0.0, out[1]))
        # w is the wall's own normal, turned toward `out`
        self.n = Vector((-self.d.z, 0.0, self.d.x))
        if self.n.dot(n) < 0:
            self.n = -self.n
        self.seed = seed

    def pt(self, u, v, w=0.0):
        return Vector((self.o.x + self.d.x * u + self.n.x * w, v, self.o.z + self.d.z * u + self.n.z * w))

    def xz(self, u, w=0.0):
        p = self.pt(u, 0.0, w)
        return p.x, p.z


class Settled:
    """A wall line whose timbered storeys have settled over the years: from `v0` up, the middle
    has sagged (most at the bottom, under the load) and the face leans out as it rises (an old
    jettied front never stands plumb). Same interface as Wall, so anything built on it settles
    with it; `half` is the half-length over which the sag dies away to the corners."""

    def __init__(self, wall, v0, v1, sag, lean, half, mid=0.0):
        self.wall = wall
        self.n, self.d, self.length = wall.n, wall.d, wall.length
        self.v0, self.v1 = v0, v1
        self.sag, self.lean, self.half, self.mid = sag, lean, half, mid

    def pt(self, u, v, w=0.0):
        t = min(1.0, max(0.0, (v - self.v0) / (self.v1 - self.v0)))
        s = max(0.0, 1.0 - ((u - self.mid) / self.half) ** 2)
        dy = -self.sag * s * (1.0 - 0.55 * t) if v >= self.v0 - 1e-6 else 0.0
        dw = (self.lean * t + 0.05 * s * t) if v >= self.v0 - 1e-6 else 0.0
        return self.wall.pt(u, v + dy, w + dw)

    def xz(self, u, w=0.0):
        return self.wall.xz(u, w)


# ---------------------------------------------------------------------------
# Faces
# ---------------------------------------------------------------------------
def _uniq(verts):
    out = []
    for v in verts:
        if all((v.co - u.co).length > 1e-6 for u in out):
            out.append(v)
    return out


def face(p, pts, facing, color, mat, tag=PLAIN_TAG, soft=False):
    """One face through game-frame points, turned so it faces `facing` (a game-frame
    direction). Returns the face, or None for a degenerate one."""
    bm = p.bm
    verts = _uniq([bm.verts.new(P(*q)) for q in pts])
    if len(verts) < 3:
        return None
    try:
        f = bm.faces.new(verts)
    except ValueError:
        return None
    f.normal_update()
    if f.normal.dot(P(*facing)) < 0:
        f.normal_flip()
    p.paint([f], color, mat, tag)
    f[p.soft] = 1 if soft else 0
    return f


def skin(p, wall, us, vs, depth, facing, cell, hole=None, soft=True, top=None):
    """A wall face as a quad grid over the u breaks `us` and the v breaks `vs`.

    depth(u, v) is how far out of the wall line each corner stands (the bow, the belly, the
    batter at the foot); `facing` is +1 for a face looking out of the wall, -1 for one looking
    in; cell(i, j, u0, u1, v0, v1) paints a cell and returns (color, mat); hole(u0, u1, v0, v1)
    true leaves the cell out (a doorway). top(u), when given, pulls each column's top row down
    to that height (a gable's rake). The corners are shared, so a bowed face shades as one."""
    bm = p.bm
    grid = []
    for v in vs:
        row = []
        for u in us:
            vv = v
            if top is not None:
                # the column's rows spread evenly up to its own top (never below its foot)
                t = (v - vs[0]) / max(1e-6, vs[-1] - vs[0])
                vv = vs[0] + (max(vs[0], min(vs[-1], top(u))) - vs[0]) * t
            row.append(bm.verts.new(P(*wall.pt(u, vv, depth(u, vv)))))
        grid.append(row)
    out_dir = wall.n * facing
    faces = []
    for j in range(len(vs) - 1):
        for i in range(len(us) - 1):
            u0, u1, v0, v1 = us[i], us[i + 1], vs[j], vs[j + 1]
            if hole is not None and hole(u0, u1, v0, v1):
                continue
            quad = _uniq([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]])
            if len(quad) < 3:
                continue
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            f.normal_update()
            if f.normal.dot(P(*out_dir)) < 0:
                f.normal_flip()
            color, mat = cell(i, j, u0, u1, v0, v1)
            p.paint([f], color, mat)
            f[p.soft] = 1 if soft else 0
            faces.append(f)
    return faces


def breaks(a, b, step, keep=()):
    """Grid lines from a to b about `step` apart, plus every line in `keep` between them."""
    n = max(1, int(round((b - a) / step)))
    pts = {round(a + (b - a) * i / n, 4) for i in range(n + 1)}
    pts.update(round(k, 4) for k in keep if a - 1e-6 <= k <= b + 1e-6)
    return sorted(pts)


# ---------------------------------------------------------------------------
# Solids
# ---------------------------------------------------------------------------
def block(p, corners, color, mat, tag=PLAIN_TAG):
    """A closed six-sided lump from 8 game-frame corners: 0-3 the bottom ring, 4-7 the top
    ring over them, in the same order round."""
    bm = p.bm
    v = [bm.verts.new(P(*q)) for q in corners]
    faces = []
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        quad = _uniq([v[i] for i in idx])
        if len(quad) < 3:
            continue
        try:
            faces.append(bm.faces.new(quad))
        except ValueError:
            continue
    p.paint(faces, color, mat, tag)
    p.closed.extend(faces)
    return faces


def lump(p, c, size, color, mat, seed, rough=0.08, yaw=0.0, tag=PLAIN_TAG):
    """A box that is not quite a box: each corner pushed a little off true (a quoin, a hewn
    block, a joist end). size is (x, y, z) in the game frame before the yaw."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    cy, sy_ = math.cos(yaw), math.sin(yaw)
    pts = []
    for k, (dx, dy, dz) in enumerate(((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1),
                                      (-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1))):
        x = dx * sx + jit(rough * sx, seed, k, 1.3)
        y = dy * sy + jit(rough * sy, seed, k, 2.7)
        z = dz * sz + jit(rough * sz, seed, k, 4.1)
        pts.append((c[0] + x * cy + z * sy_, c[1] + y, c[2] - x * sy_ + z * cy))
    return block(p, pts, color, mat, tag)


def hewn(p, a, b, w, h, color, mat, seed, sag=0.0, wander=0.04, up=(0.0, 1.0, 0.0), segs=2,
         twist=0.0):
    """A hand-hewn timber from a to b: it sags by `sag` at its middle (a load on a span), its
    line wanders a little off straight, its section swells and thins along it, and it is
    twisted a touch about its own length."""
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(segs + 1):
        t = i / segs
        q = a.lerp(b, t)
        s = math.sin(math.pi * t)
        q.y -= sag * s
        if 0 < i < segs:
            q += Vector((jit(wander, seed, i, 0.1), jit(wander * 0.5, seed, i, 0.2), jit(wander, seed, i, 0.3)))
        pts.append(q)
    upv = Vector(up)
    if abs(twist) > 1e-6:
        axis = (b - a).normalized()
        from mathutils import Matrix
        upv = Matrix.Rotation(twist, 3, axis) @ upv
    k = 1.0 + jit(0.08, seed, 9.1)
    return p.beam(pts, w * k, h * (1.0 + jit(0.08, seed, 9.7)), color, mat, up=tuple(upv))


def lean(base, top, amount, seed):
    """A top point leaned a little off plumb from its base (a post, a chimney)."""
    return (top[0] + jit(amount, seed, 3.3), top[1], top[2] + jit(amount, seed, 5.9))


def disc(p, c, normal, r, color, mat, sides=10, depth=0.0, seed=0.0, rough=0.0, tag=PLAIN_TAG):
    """A flat round face (a rose window's glass, a plate) facing `normal`; a depth makes it
    a short drum instead."""
    n = Vector(normal).normalized()
    ref = Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.9 else Vector((1.0, 0.0, 0.0))
    u = n.cross(ref).normalized()
    w = n.cross(u).normalized()
    c = Vector(c)
    ring = []
    for i in range(sides):
        ang = math.tau * i / sides
        rr = r * (1.0 + jit(rough, seed, i))
        ring.append(c + u * math.cos(ang) * rr + w * math.sin(ang) * rr)
    if depth <= 0:
        return [face(p, ring, tuple(n), color, mat, tag)]
    back = [q - n * depth for q in ring]
    faces = [face(p, ring, tuple(n), color, mat, tag)]
    for i in range(sides):
        j = (i + 1) % sides
        mid = (ring[i] + ring[j]) / 2 - c
        faces.append(face(p, [ring[i], ring[j], back[j], back[i]], tuple(mid), color, mat, tag))
    return faces
