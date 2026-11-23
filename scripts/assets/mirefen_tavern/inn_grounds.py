"""The grounds outside the hall (build_tavern.py calls build(B, parts)): the cobbled forecourt
draped over the falling ground inside its kerb, the terrace's trestle tables and benches, the
lantern posts and the strings of lanterns sagging between them and the front wall, the menu
chalkboard by the door, the open stable west of the hall with its trough, its hay and the hand
cart parked beside it, the crates at the front's right corner, and the woodpile under its slate
lean-to against the right wall.

Everything stands where the sim collides with it (src/sim/content/mirefen_tavern_grounds.ts
through layout.json grounds and props; the stable's walls and posts are tavernStableWalls and
tavernStablePosts in src/sim/mirefen_tavern_grounds.ts), each foot planted on the terrain under
it (B.ground). A prop's own frame is turned by its yaw the three.js way (rotation.y: its local
+x is (cos rot, -sin rot), its local +z is (sin rot, cos rot)); its footprint is hw by hd (or a
circle of r) round (x, z), and it stands from its `base` (the terrain under its middle) up
`height`. A terrace bench's top is its seat: content/mirefen_tavern_seats.ts seats two on it at
base + height (no cushion), so the seat board's top lies exactly there.

  TavernGrounds   the forecourt and its kerb, the terrace, the lantern posts, the strings, their
                  lanterns (warm GLOW panes) and their hooks on the front wall, the two terrace
                  lamps, the chalkboard, the tubs, the stable, the trough, the hay, the cart, the
                  crates, the woodpile
  TavernTrim      the chalk pictures on the board (a tankard, a loaf, a fish, a steaming bowl,
                  the prices as dots: never words), two puddles on the cobbles, the horseshoe
                  on the stable's front beam
  TavernClutter   straw on the stable's floor and round the hay, a saddle over the partition, a
                  pitchfork stuck in the stacked hay, sacks in the cart and on a crate, a bucket
                  on the other, tufts of grass along the kerb (nothing loose where the sim keeps
                  the ground clear)

The forecourt is drawn over the terrain, never a walk surface of its own (the feet walk the
terrain, content/mirefen_tavern_grounds.ts), so the paving rides a few hundredths over it on a
grid of the terrain's own yards; the porch and the run of its steps
(src/sim/mirefen_tavern_floor.ts: |x| <= stepHalfWidth from the porch's edge, falling
stepSlope a yard until they meet the ground) are the hall's and stay clear.

The look is the hall's (inn_kit.py): nothing ruler-straight, every lean, sag and wobble from a
stable hash of where a piece stands, and the paint (the town's maps) carrying the cobbles, the
grain and the slates while the geometry stays chunky and low.
"""
import math

import bmesh
from mathutils import Vector

import inn_kit as K
from inn_kit import (DRESSED, FLOOR, GLOW, IRON, METAL, OAK, OAK_DARK, PANE, PLAIN, ROOF, SARKING, SLATE,
                      STONE, TIMBER, hash01, jit, vnoise)
from shiplib import G

# colours: tints over the painted maps (1 is the map as painted) ...
BOARDS = (0.92, 0.88, 0.84)      # the stable's weathered cladding (the boards map)
TOPS = (0.96, 0.9, 0.84)         # the terrace's table tops and seats, scrubbed pale (the boards map)
COBBLE = (0.84, 0.82, 0.8)       # the forecourt's paving (the cobbles map)
RUBBLE = (0.86, 0.85, 0.86)      # the stable's footing
KERB = (0.76, 0.74, 0.7)         # the kerb, the pads, the trough (the dressed stone map)
HAY_PAINT = (0.95, 0.79, 0.4)    # a bale's straw: the dressed stone's streaks tinted gold
# ... and the real colours of what wears no map
ROPE = (0.55, 0.45, 0.3)
PANES = ((1.0, 0.7, 0.36), (1.0, 0.62, 0.3), (1.0, 0.77, 0.44), (0.98, 0.58, 0.3))
STRAW = ((0.85, 0.72, 0.38), (0.78, 0.64, 0.32), (0.9, 0.78, 0.46))
TWINE = (0.42, 0.33, 0.2)
WATER = (0.25, 0.38, 0.4)
PUDDLE = (0.42, 0.5, 0.56)       # the sky in the wet
SLATE_BOARD = (0.12, 0.13, 0.13)
CHALK = (0.9, 0.9, 0.86)
END_GRAIN = (0.78, 0.62, 0.42)
SACK = (0.68, 0.58, 0.4)
LEATHER = (0.38, 0.21, 0.11)
TUFT = (0.3, 0.44, 0.17)

# the stable's posts and its partition as the sim has them (src/sim/mirefen_tavern_grounds.ts
# tavernStablePosts: r 0.2 at z1 - r; tavernStableWalls: the partition 0.2 thick)
STABLE_POST_R = 0.2
PARTITION_HALF = 0.1
# the right wall's front window over the woodpile's end (inn_hall side(): low_wins 9.0)
RIGHT_WINDOW_Z = 9.0

# the paving rides this far over the terrain (and its grid follows the terrain's own yards)
PAVE_LIFT = 0.065
# how far the stable's roof slab is from slates to sarking, and its eaves' flatter kick
STABLE_THICK = 0.26
STABLE_KICK = 0.42
STABLE_SAG = 0.2


def build(B, parts):
    Grounds(B, parts).build()


def local(q, lx, lz):
    """A point in a prop's own frame (turned by its yaw, three.js rotation.y) on the grounds."""
    c, s = math.cos(q['rot']), math.sin(q['rot'])
    return q['x'] + lx * c + lz * s, q['z'] - lx * s + lz * c


def axis_x(q):
    """A prop's own +x in the tavern's frame."""
    return (math.cos(q['rot']), 0.0, -math.sin(q['rot']))


def seed_of(q):
    return round(q['x'] * 7.31 + q['z'] * 3.17, 3)


def spire(p, c, apex, r, color, mat, sides=4, phase=0.0):
    """A closed cone from a ring of `sides` round c up to its apex: a tuft of grass."""
    c, apex = Vector(c), Vector(apex)
    n = (apex - c).normalized()
    ref = Vector((1.0, 0.0, 0.0)) if abs(n.x) < 0.9 else Vector((0.0, 0.0, 1.0))
    u = n.cross(ref).normalized()
    w = n.cross(u).normalized()
    bm = p.bm
    ring = []
    for i in range(sides):
        a = phase + math.tau * i / sides
        ring.append(bm.verts.new(K.P(*(c + (u * math.cos(a) + w * math.sin(a)) * r))))
    tip = bm.verts.new(K.P(*apex))
    faces = [bm.faces.new((ring[i], ring[(i + 1) % sides], tip)) for i in range(sides)]
    faces.append(bm.faces.new(list(reversed(ring))))
    p.paint(faces, color, mat)
    p.closed.extend(faces)
    return faces


def quad(p, verts, facing, color, mat, soft=False):
    """One face through existing verts, turned to face `facing` (a game-frame direction)."""
    verts = K._uniq(verts)
    if len(verts) < 3:
        return None
    try:
        f = p.bm.faces.new(verts)
    except ValueError:
        return None
    f.normal_update()
    if f.normal.dot(K.P(*facing)) < 0:
        f.normal_flip()
    p.paint([f], color, mat)
    f[p.soft] = 1 if soft else 0
    return f


def square(c, half, y, yaw):
    """The four corners of a square of half-width `half` round the column at c (x, z) at
    height y, turned by yaw (three.js rotation.y), in the order inn_kit.block wants."""
    cy, sy = math.cos(yaw), math.sin(yaw)
    return [(c[0] + dx * half * cy + dz * half * sy, y, c[1] - dx * half * sy + dz * half * cy)
            for (dx, dz) in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def frustum(p, c, half0, half1, y0, y1, yaw, color, mat):
    """A four-sided block from a square of half-width half0 at y0 to one of half1 at y1 round
    the column at c (x, z), turned by yaw: a lantern's body."""
    return K.block(p, square(c, half0, y0, yaw) + square(c, half1, y1, yaw), color, mat)


def pyramid(p, c, half, y0, y1, yaw, color, mat):
    """A four-sided pyramid from a square at y0 to its point at y1 (over it, or under it for
    a drop): a lantern's hood, a post's cap."""
    bm = p.bm
    ring = [bm.verts.new(K.P(*q)) for q in square(c, half, y0, yaw)]
    tip = bm.verts.new(K.P(c[0], y1, c[1]))
    faces = [bm.faces.new((ring[i], ring[(i + 1) % 4], tip)) for i in range(4)]
    faces.append(bm.faces.new(list(reversed(ring))))
    p.paint(faces, color, mat)
    p.closed.extend(faces)
    return faces


def lantern(p, top, size, seed, glow=PANE, drop=False):
    """A small iron lantern hung by its hood's tip at `top`: a pyramid hood, four warm panes
    over an iron floor, and maybe an iron drop under that. Turned and sized a touch
    differently each, so a string of them never reads as one lantern stamped over and over."""
    x, y, z = top
    yaw = hash01(seed, 1.7) * math.pi / 2
    s = size * (1.0 + jit(0.07, seed, 2.3))
    hood, body, w = 0.12 * s, 0.24 * s, 0.11 * s
    yb = y - hood
    pyramid(p, (x, z), w * 1.32, yb, y, yaw, IRON, METAL)
    faces = frustum(p, (x, z), w * 0.84, w, yb - body, yb, yaw, K.tint(glow, 1.0, seed, 3.1, spread=0.04), GLOW)
    # the floor and the lid are iron
    p.paint(faces[:2], IRON, METAL)
    if drop:
        pyramid(p, (x, z), w * 0.8, yb - body, yb - body - 0.1 * s, yaw, IRON, METAL)
    return yb - body


def blob(p, c, size, color, mat, seed, jitter=0.12, flat=0.0):
    """A soft lump (a sack, a bush): an icosahedron stretched to `size`, each corner pushed a
    little in or out, its underside flattened by `flat` (a sack slumped where it lies)."""
    made = bmesh.ops.create_icosphere(p.bm, subdivisions=1, radius=0.5)
    verts = made['verts']
    for i, v in enumerate(verts):
        g = G(v.co)
        k = 1.0 + jit(jitter, seed, i)
        y = g.y * size[1] * k
        if g.y < 0:
            y *= 1.0 - flat
        v.co = K.P(c[0] + g.x * size[0] * k, c[1] + y, c[2] + g.z * size[2] * k)
    p.bm.faces.index_update()
    faces = sorted({f for v in verts for f in v.link_faces}, key=lambda f: f.index)
    p.paint(faces, color, mat)
    for f in faces:
        f[p.soft] = 1
    p.closed.extend(faces)
    return faces


def log(p, a, b, r, phase, bark, end, sides=3, seed=0.0):
    """A log from a (its back, buried in the stack) to b (its face): a round one (five sides)
    or a split one (three), its bark round it and its pale end out; the back end is left open
    (hidden in the stack)."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0.0, 1.0, 0.0)) if abs(d.y) < 0.9 else Vector((1.0, 0.0, 0.0))
    u = d.cross(ref).normalized()
    w = d.cross(u).normalized()
    angs = [phase + math.tau * i / sides for i in range(sides)]
    radii = [r * (1.0 + jit(0.12, seed, i)) for i in range(sides)]
    bm = p.bm
    rings = [[bm.verts.new(K.P(*(c + (u * math.cos(t) + w * math.sin(t)) * rr))) for t, rr in zip(angs, radii)]
             for c in (a, b)]
    for i in range(sides):
        j = (i + 1) % sides
        mid = u * (math.cos(angs[i]) + math.cos(angs[j])) + w * (math.sin(angs[i]) + math.sin(angs[j]))
        quad(p, [rings[0][i], rings[0][j], rings[1][j], rings[1][i]], tuple(mid), bark, TIMBER, soft=sides > 3)
    return quad(p, rings[1], tuple(d), end, PLAIN)


class Drape:
    """A sheet laid over the terrain a few hundredths over it (the forecourt's paving, the
    stable's floor): its corners shared by where they stand, each a hair off the ground's line."""

    def __init__(self, B, p, seed):
        self.B, self.p, self.seed = B, p, seed
        self.verts = {}

    def vert(self, x, z):
        key = (round(x, 3), round(z, 3))
        v = self.verts.get(key)
        if v is None:
            y = self.B.ground(x, z) + PAVE_LIFT + 0.012 * vnoise(x / 1.3, z / 1.3, self.seed)
            v = self.p.bm.verts.new(K.P(x, y, z))
            self.verts[key] = v
        return v


class Grounds:
    def __init__(self, B, parts):
        self.B = B
        self.g = parts['TavernGrounds']
        self.trim = parts['TavernTrim']
        self.clutter = parts['TavernClutter']
        self.G = B.LAYOUT['grounds']
        self.H = B.HALL
        self.porch = B.LAYOUT['porch']
        self.props = B.LAYOUT['props']
        self._meets = {}

    def build(self):
        self.forecourt()
        makers = {'terraceTable': self.terrace_table, 'terraceBench': self.terrace_bench,
                  'post': self.lantern_post, 'crate': self.crate,
                  'trough': self.trough, 'hay': self.hay, 'cart': self.cart, 'woodpile': self.woodpile}
        for q in self.props:
            make = makers.get(q['kind'])
            if make is not None:
                make(q)
        self.strings()
        self.terrace_lamps()
        self.chalkboard()
        self.stable()

    # ------------------------------------------------------------------ helpers
    def ground(self, x, z):
        return self.B.ground(x, z)

    def plump(self, p, q, lx, y, lz, size, color, mat, seed, rough=0.08, turn=0.0):
        """A lump in a prop's own frame, its middle at (lx, lz) and height y."""
        x, z = local(q, lx, lz)
        return K.lump(p, (x, y, z), size, color, mat, seed, rough=rough, yaw=q['rot'] + turn)

    def footed(self, p, q, lx0, lx1, lz0, lz1, top, color, mat, seed, sink=0.12, splay=(0.0, 0.0), rough=0.025):
        """A block in a prop's frame from under the ground at each of its corners up to `top` (a
        bench's slab end, a trestle's foot), its foot splayed out by `splay` (along its own x
        and z), every corner a touch off true."""
        mx, mz = (lx0 + lx1) / 2, (lz0 + lz1) / 2
        bottom, upper = [], []
        for k, (a, b) in enumerate(((lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1))):
            fa = a + math.copysign(splay[0], a - mx) if abs(a - mx) > 1e-6 else a
            fb = b + math.copysign(splay[1], b - mz) if abs(b - mz) > 1e-6 else b
            x, z = local(q, fa + jit(rough, seed, k, 1), fb + jit(rough, seed, k, 2))
            bottom.append((x, self.ground(x, z) - sink, z))
            x, z = local(q, a + jit(rough, seed, k, 3), b + jit(rough, seed, k, 4))
            upper.append((x, top + jit(rough * 0.6, seed, k, 5), z))
        return K.block(p, bottom + upper, color, mat)

    # ================================================================ forecourt
    def _steps_meet(self, x):
        """How far out the porch's steps run at x before they meet the ground
        (src/sim/mirefen_tavern_floor.ts: they fall stepSlope a yard from the porch's edge, at
        most TAVERN_STEPS_MAX_RUN)."""
        key = round(x, 3)
        if key not in self._meets:
            q = self.porch
            z = q['z1']
            while z < q['z1'] + 8.0 and -(z - q['z1']) * q['stepSlope'] > self.ground(x, z):
                z += 0.05
            self._meets[key] = z
        return self._meets[key]

    def _paved(self, x, z):
        """Whether (x, z) is open forecourt: in a rect, off the hall, the porch and its steps."""
        q, H = self.porch, self.H
        if not any(r[0] - 1e-6 <= x <= r[1] + 1e-6 and r[2] - 1e-6 <= z <= r[3] + 1e-6 for r in self.G['forecourt']):
            return False
        if abs(x) <= H['x1'] + 0.3 and z < H['z1']:
            return False
        if abs(x) < q['x1'] + 0.3 and z < q['z1'] + 0.1:
            return False
        if abs(x) < q['stepHalfWidth'] + 0.05 and z < self._steps_meet(x) + 0.3:
            return False
        return True

    def _intervals(self, x):
        """The paved stretches of z along the line x (in the forecourt's rects, less the porch
        and the run of its steps), as (z0, z1) pairs; the steps' end is found at x itself."""
        q = self.porch
        spans = sorted((r[2], r[3]) for r in self.G['forecourt'] if r[0] - 1e-6 <= x <= r[1] + 1e-6)
        merged = []
        for a, b in spans:
            if merged and a <= merged[-1][1] + 1e-6:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        cut = None
        if abs(x) < q['x1'] + 0.3 - 1e-6:
            cut = q['z1'] + 0.1
        if abs(x) < q['stepHalfWidth'] + 0.05 - 1e-6:
            cut = max(cut or 0.0, self._steps_meet(x) + 0.3)
        out = []
        for a, b in merged:
            if cut is not None:
                a = max(a, cut)
            if b - a > 0.25:
                out.append((a, b))
        return out

    def forecourt(self):
        """The forecourt's paving: one sheet draped over the falling ground on a grid of the
        terrain's own yards (columns two yards wide), the painted cobbles laid level across it;
        its tone wanders, darker and damp under the walls, worn paler where the feet go from
        the steps' foot along the front; puddles in its low spots, and a kerb round its open
        edges."""
        g, q = self.g, self.porch
        rects = self.G['forecourt']
        lo, hi = min(r[0] for r in rects), max(r[1] for r in rects)
        keep = {r[0] for r in rects} | {r[1] for r in rects}
        for e in (q['x1'] + 0.3, q['stepHalfWidth'] + 0.05):
            keep |= {e, -e}
        xs = sorted({round(v, 4) for v in keep} | {float(i) for i in range(math.ceil(lo), math.floor(hi) + 1)
                                                     if i % 2 == 0 and lo < i < hi})
        vert = Drape(self.B, g, 501).vert

        def tone(x, z):
            k = 0.9 + 0.08 * vnoise(x / 3.7, z / 3.1, 503) + 0.03 * vnoise(x / 1.1, z / 1.3, 504)
            # damp and mossy along the hall's foot
            k -= 0.1 * max(0.0, 1.0 - (z - self.H['z1']) / 1.6)
            # worn paler down the middle from the steps' foot and along the front of the terrace
            k += 0.07 * max(0.0, 1.0 - abs(x) / 5.5) * max(0.0, min(1.0, (z - 19.5) / 1.5))
            return K.tint(COBBLE, k, x, z, spread=0.025)

        for i in range(len(xs) - 1):
            xa, xb = xs[i], xs[i + 1]
            xm = (xa + xb) / 2
            ea, eb = self._intervals(xa + 1e-4), self._intervals(xb - 1e-4)
            em = self._intervals(xm)
            if not (len(ea) == len(eb) == len(em)):
                ea = eb = em
            for (a0, a1), (b0, b1) in zip(ea, eb):
                # rows on the terrain's own yards between the column's two ends
                rows = [float(z) for z in range(math.ceil(max(a0, b0) + 0.2), math.floor(min(a1, b1) - 0.2) + 1)]
                left = [a0] + rows + [a1]
                right = [b0] + rows + [b1]
                for j in range(len(left) - 1):
                    pts = [vert(xa, left[j]), vert(xb, right[j]), vert(xb, right[j + 1]), vert(xa, left[j + 1])]
                    zc = (left[j] + left[j + 1]) / 2
                    quad(g, pts, (0.0, 1.0, 0.0), tone(xm, zc), STONE, soft=True)
        self._kerb()
        self._puddles()

    def _outline(self):
        """The forecourt's open edges, where it meets the grass: each rect's sides less where
        another rect runs on past them, the hall's front, the porch and the run of its steps.
        Returns (a, b, n) runs, n pointing out of the forecourt."""
        runs = []
        step = 0.05
        for (x0, x1, z0, z1) in self.G['forecourt']:
            for (a, b, n) in (((x0, z1), (x1, z1), (0.0, 1.0)), ((x1, z0), (x0, z0), (0.0, -1.0)),
                              ((x0, z0), (x0, z1), (-1.0, 0.0)), ((x1, z1), (x1, z0), (1.0, 0.0))):
                L = math.dist(a, b)
                k = int(L / step)
                start = None
                for i in range(k + 1):
                    t = i / k
                    x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    ox, oz = x + n[0] * 0.08, z + n[1] * 0.08
                    inner = self._paved(x - n[0] * 0.08, z - n[1] * 0.08)
                    open_ = inner and not self._paved(ox, oz) and not self._built(ox, oz)
                    if open_ and start is None:
                        start = (x, z)
                    if (not open_ or i == k) and start is not None:
                        end = (x, z)
                        if math.dist(start, end) > 0.4:
                            runs.append((start, end, n))
                        start = None
        return runs

    def _built(self, x, z):
        """Whether (x, z) is under the hall, the porch or the run of its steps (no kerb there)."""
        q, H = self.porch, self.H
        if abs(x) <= H['x1'] + 0.3 and z < H['z1'] + 0.05:
            return True
        if abs(x) < q['x1'] + 0.3 and z < q['z1'] + 0.1:
            return True
        return abs(x) < q['stepHalfWidth'] + 0.3 and z < self._steps_meet(x) + 0.3

    def _kerb(self):
        """Long dressed kerb stones round the forecourt's open edges, each its own length, set a
        little off the line and off level into the ground, their tops a hand over the paving."""
        g = self.g
        for r, (a, b, n) in enumerate(self._outline()):
            L = math.dist(a, b)
            d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
            count = max(1, int(round(L / 1.75)))
            cuts = [0.0] + [L * (k + jit(0.18, 601, r, k)) / count for k in range(1, count)] + [L]
            for k in range(count):
                s0, s1 = cuts[k] + 0.03, cuts[k + 1] - 0.03
                w = 0.4 + jit(0.06, 602, r, k)
                off = jit(0.06, 603, r, k)
                corners = []
                for i, (s, side) in enumerate(((s0, -1), (s1, -1), (s1, 1), (s0, 1))):
                    across = off + side * w / 2 + jit(0.035, 604, r, k, i)
                    corners.append((a[0] + d[0] * s + n[0] * across, a[1] + d[1] * s + n[1] * across))
                bottom = [(x, self.ground(x, z) - 0.18, z) for (x, z) in corners]
                rise = 0.16 + jit(0.04, 605, r, k)
                upper = [(x, self.ground(x, z) + rise + jit(0.035, 606, r, k, i), z)
                         for i, (x, z) in enumerate(corners)]
                # the top's inner edge rounded down a little toward the paving
                upper = [(x, y - (0.03 if i in (0, 1) else 0.0), z) for i, (x, y, z) in enumerate(upper)]
                K.block(g, bottom + upper, K.tint(KERB, 1.0, 607, r, k, spread=0.08), DRESSED)
                # a tuft of grass in the odd joint (high tier)
                if hash01(608, r, k) < 0.3 and k > 0:
                    x, z = a[0] + d[0] * cuts[k] + n[0] * 0.24, a[1] + d[1] * cuts[k] + n[1] * 0.24
                    y = self.ground(x, z)
                    spire(self.clutter, (x, y - 0.02, z), (x + jit(0.06, 609, r, k), y + 0.24, z), 0.13,
                          K.tint(TUFT, 1.0, 610, r, k, spread=0.1), PLAIN, sides=3, phase=hash01(611, r, k) * 3)

    def _puddles(self):
        """Two puddles in the forecourt's low spots near the road, a hair over the paving
        (medium tier up), each left out if a piece outside stands over it."""
        for k, (x, z, r) in enumerate(((-9.6, 20.2, 0.62), (11.6, 20.3, 0.5))):
            if not self._paved(x, z) or any(math.hypot(q['x'] - x, q['z'] - z) < r + 0.9
                                            for q in self.props if 'base' in q and q['z'] > self.H['z1']):
                continue
            ring = []
            for i in range(9):
                a = math.tau * i / 9 + jit(0.15, 620, k, i)
                rr = r * (1.0 + 0.22 * vnoise(i * 0.9, k, 621))
                px, pz = x + math.cos(a) * rr, z + math.sin(a) * rr * 0.7
                ring.append((px, self.ground(px, pz) + PAVE_LIFT + 0.03, pz))
            K.face(self.trim, ring, (0.0, 1.0, 0.0), PUDDLE, PLAIN, tag=K.FLAT)

    # ================================================================ terrace
    def terrace_table(self, q):
        """A trestle table: three thick planks of worn boards (none quite the length or the level
        of its neighbour) on a splayed X trestle at each end standing in a foot board, a
        stretcher between them; its top at base + height over its footprint."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        n = 3
        for i in range(n):
            a, b = -hd + 2 * hd * i / n, -hd + 2 * hd * (i + 1) / n
            th = 0.13 + jit(0.015, seed, i)
            length = 2 * hw - 0.02 + jit(0.04, seed, i, 1)
            self.plump(g, q, jit(0.025, seed, i, 2), top - th / 2 + jit(0.01, seed, i, 3), (a + b) / 2,
                       (length, th, (b - a) - 0.025), K.tint(TOPS, 1.0, seed, i, spread=0.06), FLOOR, seed + i,
                       rough=0.02, turn=jit(0.01, seed, i, 4))
        ax = Vector(axis_x(q))
        under = top - 0.12
        for e, lx in enumerate((-hw + 0.38, hw - 0.38)):
            lx += jit(0.04, seed, 10, e)
            # the X: two legs crossing under the planks, each from a foot board's end
            for s in (-1, 1):
                fx, fz = local(q, lx, s * (hd - 0.1))
                hx, hz = local(q, lx + jit(0.03, seed, 11, e, s), -s * (hd - 0.12))
                K.hewn(g, (fx, self.ground(fx, fz) + 0.08, fz), (hx, under, hz), 0.14, 0.13,
                       K.tint(OAK, 0.8, seed, 12, e, s), TIMBER, seed=seed + 13 + e * 2 + s, segs=1,
                       up=tuple(ax), wander=0.0)
            # the foot board the X stands in, along the table's depth
            fa, fb = local(q, lx, -hd + 0.03), local(q, lx, hd - 0.03)
            ya, yb = self.ground(*fa), self.ground(*fb)
            K.hewn(g, (fa[0], ya + 0.05, fa[1]), (fb[0], yb + 0.05, fb[1]), 0.17, 0.16,
                   K.tint(OAK, 0.66, seed, 16, e), TIMBER, seed=seed + 17 + e, segs=1, up=(0.0, 1.0, 0.0))
        # the stretcher from trestle to trestle, where the legs cross
        a, b = local(q, -hw + 0.3, 0.0), local(q, hw - 0.3, 0.0)
        ym = (self.ground(*a) + self.ground(*b)) / 2
        cross = ym + (under - ym) * 0.5
        K.hewn(g, (a[0], cross, a[1]), (b[0], cross, b[1]), 0.12, 0.14, K.tint(OAK, 0.72, seed, 20), TIMBER,
               seed=seed + 21, segs=1, sag=0.02)

    def terrace_bench(self, q):
        """A plank bench: a thick seat board whose top is the seat (base + height, where
        content/mirefen_tavern_seats.ts sits two), on two slab ends splayed a little at the foot,
        a stretcher between them."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        th = 0.14
        # the board: its top level at the seat, its underside and its ends a little off true
        pts = []
        for y in (top - th, top):
            for k, (a, b) in enumerate(((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))):
                ea = a + (jit(0.04, seed, k, 1) if y < top else jit(0.025, seed, k, 2))
                eb = b + (jit(0.02, seed, k, 3) if y < top else 0.0)
                x, z = local(q, ea, eb)
                pts.append((x, y + (jit(0.015, seed, k, 4) if y < top else 0.0), z))
        K.block(g, pts, K.tint(TOPS, 0.92, seed, spread=0.06), FLOOR)
        for e, lx in enumerate((-hw + 0.3, hw - 0.3)):
            lx += jit(0.04, seed, 5, e)
            self.footed(g, q, lx - 0.075, lx + 0.075, -hd + 0.03, hd - 0.03, top - th, K.tint(OAK, 0.78, seed, 6, e),
                        TIMBER, seed + 7 + e, splay=(0.0, 0.05))
        a, b = local(q, -hw + 0.36, 0.0), local(q, hw - 0.36, 0.0)
        y = (self.ground(*a) + self.ground(*b)) / 2 + 0.36
        K.hewn(g, (a[0], y, a[1]), (b[0], y + jit(0.03, seed, 8), b[1]), 0.09, 0.12, K.tint(OAK, 0.7, seed, 9), TIMBER,
               seed=seed + 10, segs=1)

    def lantern_post(self, q):
        """A lantern post: a squared oak post a hair off plumb on a dressed stone pad, a pointed
        cap, and an iron collar under it where the strings are tied on (their ends meet at its
        top, LAYOUT grounds.strings)."""
        g = self.g
        x, z = q['x'], q['z']
        top = q['base'] + q['height']
        yg = self.ground(x, z)
        seed = seed_of(q)
        turn = jit(0.4, seed, 1)
        K.lump(g, (x, yg + 0.02, z), (0.5, 0.26, 0.5), K.tint(KERB, 0.88, seed, 2), DRESSED, seed + 2, rough=0.12,
               yaw=turn + 0.3)
        foot = (x + jit(0.03, seed, 3), yg - 0.1, z + jit(0.03, seed, 4))
        K.hewn(g, foot, (x, top + 0.06, z), 0.28, 0.28, K.tint(OAK, 0.8, seed, 5), TIMBER, seed=seed + 5, segs=2,
               wander=0.02, up=(0.0, 0.0, 1.0), twist=turn)
        pyramid(g, (x, z), 0.2, top + 0.05, top + 0.36, turn, K.tint(OAK, 0.62, seed, 7), TIMBER)
        K.lump(g, (x, top - 0.16, z), (0.35, 0.09, 0.35), IRON, METAL, seed + 8, rough=0.04, yaw=turn)

    # ================================================================ the strings
    def strings(self):
        """The lantern strings: a rope from each end sagging by its `sag` at the middle, with its
        `lanterns` hung evenly along it; an end on the front wall hooks onto a small iron
        bracket there."""
        g = self.g
        hooks = {}
        wall = self.H['z1'] + 0.5
        for k, s in enumerate(self.G['strings']):
            ends = []
            for e in (s['a'], s['b']):
                if e[2] < wall:
                    key = (round(e[0], 2), round(e[1], 2))
                    if key not in hooks:
                        hooks[key] = self.wall_hook(e)
                    ends.append(hooks[key])
                else:
                    ends.append(Vector(e))
            a, b = ends
            L = (b - a).length
            n = max(6, int(L / 1.05))

            def at(t, a=a, b=b, sag=s['sag']):
                q = a.lerp(b, t)
                q.y -= sag * 4.0 * t * (1.0 - t)
                return q

            g.sweep([tuple(at(i / n)) for i in range(n + 1)], 0.03, 0.03, ROPE, sides=3, mat=PLAIN,
                    phase=hash01(k, 7.7) * 2.0)
            m = s['lanterns']
            for i in range(m):
                t = (i + 0.5) / m + jit(0.12 / m, 701, k, i)
                hp = at(t)
                glow = PANES[int(hash01(702, k, i) * len(PANES))]
                lantern(g, (hp.x, hp.y - 0.015, hp.z), 1.0, seed=703 + k * 17 + i, glow=glow)

    def wall_hook(self, e):
        """A strings' iron bracket on the front wall under the jetty: a plate on the stone and a
        hooked arm out of it the rope hangs from. Returns the hook's end."""
        g = self.g
        x, y = e[0], e[1]
        seed = 711 + x
        # the stone's face here is bowed a hand in or out of the wall line, the corners' quoins
        # proud of it (inn_hall front()): the plate runs from behind the one out past the other
        face = self.H['z1'] + (0.1 if abs(x) > self.H['x1'] - 1.1 else 0.03)
        back = self.H['z1'] - 0.07
        K.lump(g, (x, y + 0.08, (back + face + 0.08) / 2), (0.17, 0.32, face + 0.08 - back), IRON, METAL, seed,
               rough=0.06)
        tip = Vector((x + jit(0.02, seed, 1), y + 0.02, max(e[2], face + 0.17)))
        g.beam([(x, y + 0.16, face), (tip.x, y + 0.14, tip.z), tuple(tip)], 0.05, 0.05, IRON, METAL, caps=False)
        return tip

    def terrace_lamps(self):
        """The two warm lamps over the terrace (LAYOUT grounds.terraceLights: the runtime's
        lights, high over each side's tables): each a lantern on a short iron crook standing on
        the trestle table under its light, as near under it as the table's top allows."""
        tables = [q for q in self.props if q['kind'] == 'terraceTable']
        if not tables:
            return
        g = self.g
        for k, (lx_, _, lz_) in enumerate(self.G['terraceLights']):
            q = min(tables, key=lambda t: math.hypot(t['x'] - lx_, t['z'] - lz_))
            c, s = math.cos(q['rot']), math.sin(q['rot'])
            dx, dz = lx_ - q['x'], lz_ - q['z']
            # into the table's own frame, kept on its top clear of its edges
            u = max(-q['hw'] + 0.3, min(q['hw'] - 0.3, dx * c - dz * s))
            v = max(-q['hd'] + 0.18, min(q['hd'] - 0.18, dx * s + dz * c))
            x, z = local(q, u, v)
            top = q['base'] + q['height']
            seed = 721 + k * 13
            K.lump(g, (x, top + 0.035, z), (0.28, 0.07, 0.28), IRON, METAL, seed, rough=0.1, yaw=q['rot'])
            head = (x + jit(0.02, seed, 1), top + 1.0, z + jit(0.02, seed, 2))
            g.cylinder((x, top + 0.04, z), head, 0.035, IRON, METAL, sides=4, caps=False)
            # the crook: out over the table's middle line and down to the lantern's ring
            out = (math.copysign(0.28, -v) * s, math.copysign(0.28, -v) * c) if abs(v) > 0.05 else (0.28 * c, -0.28 * s)
            hook = (head[0] + out[0], head[1] - 0.06, head[2] + out[1])
            g.beam([head, (head[0] + out[0] * 0.6, head[1] + 0.06, head[2] + out[1] * 0.6), hook], 0.045, 0.045, IRON,
                   METAL, caps=False)
            lantern(g, (hook[0], hook[1] - 0.02, hook[2]), 1.55, seed + 3, drop=True)

    # ================================================================ chalkboard
    def chalkboard(self):
        """The menu chalkboard on the front wall right of the door, over the porch's casks
        (LAYOUT grounds.chalkboard): a dark slate in an oak frame, hung a touch off level by a
        cord from an iron spike, standing out over the door's jamb stones (inn_hall _door_arch)
        that its left side covers; on it (medium tier up) chalk pictures and their prices as
        dots, never words."""
        c = self.G['chalkboard']
        g, trim = self.g, self.trim
        x, y0, y1, w = c['x'], c['y0'], c['y1'], c['width']
        zb = self.H['z1'] + 0.23
        roll = math.radians(-1.6)
        cx, cy = x, (y0 + y1) / 2
        cr, sr = math.cos(roll), math.sin(roll)

        def pt(u, v, d=0.0):
            return (cx + u * cr - v * sr, cy + u * sr + v * cr, zb + d)

        hw, hh = w / 2, (y1 - y0) / 2
        # the slate
        corners = [pt(a, b, d) for d in (0.0, 0.05) for (a, b) in ((-hw + 0.05, -hh + 0.05), (hw - 0.05, -hh + 0.05),
                                                                      (hw - 0.05, hh - 0.05), (-hw + 0.05, hh - 0.05))]
        K.block(g, corners, SLATE_BOARD, PLAIN)
        # its frame: four oak bars lapped at the corners
        for k, ((ua, va), (ub, vb)) in enumerate((((-hw - 0.04, -hh + 0.04), (hw + 0.04, -hh + 0.04)),
                                                  ((-hw - 0.04, hh - 0.04), (hw + 0.04, hh - 0.04)),
                                                  ((-hw + 0.04, -hh - 0.03), (-hw + 0.04, hh + 0.03)),
                                                  ((hw - 0.04, -hh - 0.03), (hw - 0.04, hh + 0.03)))):
            K.hewn(g, pt(ua, va, 0.04), pt(ub, vb, 0.04), 0.1, 0.1, K.tint(OAK, 0.82, 731, k), TIMBER, seed=732 + k,
                   segs=1, up=(0.0, 0.0, 1.0), wander=0.0)
        # the chalk ledge under it, a stub of chalk on it
        a, b = pt(-hw + 0.05, -hh - 0.1, 0.09), pt(hw - 0.05, -hh - 0.1, 0.09)
        K.hewn(g, a, b, 0.07, 0.16, K.tint(OAK, 0.7, 733), TIMBER, seed=734, segs=1, up=(0.0, 0.0, 1.0))
        stub = pt(hw - 0.25, -hh - 0.05, 0.12)
        K.lump(trim, stub, (0.12, 0.035, 0.035), CHALK, PLAIN, 735, rough=0.1, yaw=0.2)
        # the spike in the wall over it and the cord from the frame's top corners
        spike = (x + 0.02, y1 + 0.3, zb + 0.06)
        K.hewn(g, (x + 0.02, y1 + 0.3, self.H['z1'] - 0.05), spike, 0.05, 0.05, IRON, METAL, seed=736, segs=1)
        for s in (-1, 1):
            g.cylinder(pt(s * (hw - 0.12), hh + 0.04, 0.05), spike, 0.014, ROPE, PLAIN, sides=3, caps=False)
        # the chalk: a tankard, a loaf, a fish, a steaming bowl, a row of price dots by each
        zc = 0.054

        def line(points, wid=0.024):
            for (ua, va), (ub, vb) in zip(points, points[1:]):
                L = math.hypot(ub - ua, vb - va) or 1.0
                nu, nv = -(vb - va) / L * wid / 2, (ub - ua) / L * wid / 2
                K.face(trim, [pt(ua + nu, va + nv, zc), pt(ub + nu, vb + nv, zc), pt(ub - nu, vb - nv, zc),
                              pt(ua - nu, va - nv, zc)], (0.0, 0.0, 1.0), CHALK, PLAIN, tag=K.FLAT)

        def arc(u, v, ru, rv, a0, a1, n):
            return [(u + math.cos(a0 + (a1 - a0) * i / n) * ru, v + math.sin(a0 + (a1 - a0) * i / n) * rv)
                    for i in range(n + 1)]

        rows = 4
        step = (2 * hh - 0.24) / rows
        for r in range(rows):
            v = hh - 0.16 - step * (r + 0.5)
            u = -hw + 0.27 + jit(0.02, 740, r)
            if r == 0:
                # a tankard and its handle, froth over the brim
                line([(u - 0.08, v + 0.08), (u - 0.07, v - 0.1), (u + 0.07, v - 0.1), (u + 0.08, v + 0.08)])
                line(arc(u + 0.1, v, 0.05, 0.055, -1.4, 1.4, 3))
                line(arc(u, v + 0.09, 0.09, 0.035, 0.0, math.pi, 4))
            elif r == 1:
                # a loaf, slashed over its crust
                line(arc(u, v - 0.04, 0.12, 0.1, 0.0, math.pi, 5) + [(u - 0.12, v - 0.04), (u + 0.12, v - 0.04)])
                for d in (-0.05, 0.02):
                    line([(u + d - 0.015, v - 0.0), (u + d + 0.025, v + 0.04)], wid=0.018)
            elif r == 2:
                # a fish
                line(arc(u, v, 0.1, 0.045, 0.3, math.tau - 0.3, 6) + [(u + 0.17, v + 0.05), (u + 0.17, v - 0.05),
                                                                        (u + 0.095, v - 0.014)])
            else:
                # a bowl, steaming
                line(arc(u, v - 0.02, 0.11, 0.08, math.pi, math.tau, 4) + [(u - 0.11, v - 0.02)])
                for d in (-0.035, 0.035):
                    line([(u + d, v + 0.01), (u + d + 0.02, v + 0.05), (u + d, v + 0.1)], wid=0.018)
            for i in range(1 + (r * 2 + 1) % 3):
                du = u + 0.27 + i * 0.075
                line([(du - 0.016, v - 0.02), (du + 0.016, v - 0.016)], wid=0.03)

    # ================================================================ props
    def crate(self, q):
        """A plank crate on the ground (the planks are the oak map), a darker lid over it and two
        iron straps round it, all a hair off square; a sack slumped on the bigger one, a bucket
        on the smaller."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        yg = min(self.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.06
        h = top - 0.08 - yg
        self.plump(g, q, 0.0, yg + h / 2, 0.0, (2 * hw - 0.04, h, 2 * hd - 0.04), K.tint(OAK, 0.98, seed, spread=0.06),
                   TIMBER, seed, rough=0.04)
        self.plump(g, q, jit(0.02, seed, 1), top - 0.045, jit(0.02, seed, 2), (2 * hw + 0.04, 0.09, 2 * hd + 0.04),
                   K.tint(OAK, 0.7, seed, 3), TIMBER, seed + 3, rough=0.06, turn=jit(0.05, seed, 4))
        for k, y in enumerate((yg + 0.3, top - 0.24)):
            self.plump(g, q, 0.0, y, 0.0, (2 * hw + 0.03, 0.07, 2 * hd + 0.03), IRON, METAL, seed + 5 + k, rough=0.03)
        # on the bigger one a sack slumped, on the smaller a bucket (high tier)
        if q['hw'] >= 0.45:
            px, pz = local(q, 0.08, -0.05)
            blob(self.clutter, (px, top + 0.17, pz), (0.66, 0.4, 0.5), K.tint(SACK, 1.0, seed, 8), PLAIN, seed + 8,
                 jitter=0.14, flat=0.5)
        else:
            px, pz = local(q, -0.06, 0.05)
            self.bucket(px, top - 0.005, pz, seed + 9)

    def trough(self, q):
        """A stone horse trough: a dressed basin on a footing sunk into the ground, its walls a
        hand thick, the water a hand under the rim."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        yg = min(self.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.12
        floor = q['base'] + 0.2
        stone = K.tint(KERB, 0.8, seed, spread=0.05)
        self.plump(g, q, 0.0, (yg + floor) / 2, 0.0, (2 * hw - 0.04, floor - yg, 2 * hd - 0.04), stone, DRESSED, seed,
                   rough=0.05)
        t = 0.16
        wall = top - floor
        for k, (lx, lz, sx, sz) in enumerate(((0.0, -hd + t / 2, 2 * hw, t), (0.0, hd - t / 2, 2 * hw - 0.06, t),
                                              (-hw + t / 2, 0.0, t, 2 * hd - 2 * t + 0.03),
                                              (hw - t / 2, 0.0, t, 2 * hd - 2 * t + 0.03))):
            self.plump(g, q, lx, floor + wall / 2 - 0.01, lz, (sx, wall + jit(0.04, seed, 5, k), sz),
                       K.tint(KERB, 0.86, seed, k, spread=0.07), DRESSED, seed + 1 + k, rough=0.1,
                       turn=jit(0.02, seed, 6, k))
        pts = [local(q, a, b) for (a, b) in ((-hw + t, -hd + t), (hw - t, -hd + t), (hw - t, hd - t),
                                             (-hw + t, hd - t))]
        K.face(g, [(px, top - 0.13, pz) for (px, pz) in pts], (0.0, 1.0, 0.0), WATER, PLAIN, tag=K.FLAT)

    def bale(self, p, c, size, yaw, seed):
        """A hay bale: a block of straw along its own x with its long edges eased off (an
        octagon through it), a little out of true, the straw the dressed stone's streaks
        tinted gold; two twine bands over it."""
        sx, sy, sz = size
        x, y, z = c
        ca, sa = math.cos(yaw), math.sin(yaw)

        def at(lx, ly, lz):
            return (x + lx * ca + lz * sa, y + ly, z - lx * sa + lz * ca)

        e = min(sy, sz) * 0.2
        hy, hz = sy / 2, sz / 2
        octo = ((-hz + e, -hy), (hz - e, -hy), (hz, -hy + e), (hz, hy - e), (hz - e, hy), (-hz + e, hy), (-hz, hy - e),
                (-hz, -hy + e))
        rings = []
        for s in (-1, 1):
            ring = []
            for i, (lz, ly) in enumerate(octo):
                ring.append(at(s * sx / 2 + jit(0.03, seed, s, i), ly + jit(0.025, seed, s, i, 1),
                               lz + jit(0.025, seed, s, i, 2)))
            rings.append(ring)
        # the top a touch paler than the sides
        faces = p.loft(rings, lambda j, i: K.tint(HAY_PAINT, 0.98 if i in (4, 5) else 0.9, seed, i, spread=0.04),
                       mat=DRESSED)
        p.paint(faces[-2:], K.tint(HAY_PAINT, 0.84, seed, 9), DRESSED)
        o = 0.03
        for f in (-0.27, 0.27):
            lx = f * sx
            ring = [at(lx, ly, lz) for (lz, ly) in ((-hz - o, -hy + 0.1), (-hz - o, hy - e), (-hz + e, hy + o),
                                                    (hz - e, hy + o), (hz + o, hy - e), (hz + o, -hy + 0.1))]
            for i in range(len(ring) - 1):
                a, b = ring[i], ring[i + 1]
                mid = ((a[0] + b[0]) / 2 - x, (a[1] + b[1]) / 2 - y, (a[2] + b[2]) / 2 - z)
                d = 0.035
                pts = [(a[0] - d * ca, a[1], a[2] + d * sa), (a[0] + d * ca, a[1], a[2] - d * sa),
                       (b[0] + d * ca, b[1], b[2] - d * sa), (b[0] - d * ca, b[1], b[2] + d * sa)]
                K.face(p, pts, mid, TWINE, PLAIN)

    def hay(self, q):
        """Hay: a single bale at the stable's door; a stack of three in its back stall (two on
        the floor, one across them) where the footprint is big enough for it."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        yg = min(self.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) - 0.04
        if q['height'] < 1.2:
            x, z = local(q, 0.0, 0.0)
            self.bale(g, (x, (yg + top) / 2, z), (2 * hw, top - yg, 2 * hd), q['rot'], seed)
        else:
            # two bales side by side along the footprint's depth, a third laid across them
            h = (top - yg) / 2
            for k, s in enumerate((-1, 1)):
                x, z = local(q, s * hw / 2, jit(0.05, seed, k))
                self.bale(g, (x, yg + h / 2, z), (2 * hd - 0.04, h, hw - 0.04),
                          q['rot'] + math.pi / 2 + jit(0.05, seed, 1, k), seed + k)
            x, z = local(q, jit(0.1, seed, 2), -hd * 0.25)
            self.bale(g, (x, yg + h * 1.5 - 0.03, z), (2 * hw - 0.3, h, hd + 0.15), q['rot'] + jit(0.08, seed, 3),
                      seed + 3)
            # a pitchfork left stuck in the top bale, leaning back over the stack
            fx, fz = local(q, hw * 0.3, -hd * 0.2)
            hx, hz = local(q, hw * 0.05, -hd * 0.75)
            y = yg + h * 2.0 - 0.15
            self.pitchfork((hx, y + 1.75, hz), (fx, y + 0.05, fz))
        # loose straw round its foot (high tier)
        for k in range(3):
            a = q['rot'] + k * 2.2 + jit(0.4, seed, 4, k)
            rr = max(hw, hd) + 0.12
            px, pz = q['x'] + math.sin(a) * rr, q['z'] + math.cos(a) * rr
            self.straw(px, pz, 0.36, seed + 5 + k)

    def straw(self, x, z, r, seed):
        """A loose drift of straw on the ground (high tier): a ragged star of a face a hair over
        the terrain, its points the stalks sticking out of it."""
        p = self.clutter
        ring = []
        n = 9
        for i in range(n):
            a = math.tau * i / n + jit(0.3, seed, i)
            rr = r * (0.45 + 0.75 * hash01(seed, i, 1)) * (1.25 if hash01(seed, i, 2) < 0.3 else 1.0)
            px, pz = x + math.cos(a) * rr, z + math.sin(a) * rr * (0.7 + 0.3 * hash01(seed, 3))
            ring.append((px, self.ground(px, pz) + PAVE_LIFT + 0.02, pz))
        K.face(p, ring, (0.0, 1.0, 0.0), K.tint(STRAW[int(hash01(seed, 9) * 3)], 0.86, seed, spread=0.05), PLAIN)

    def cart(self, q):
        """A hand cart parked tipped forward onto its handles: a planked bed with low sides on an
        axle, two big spoked wheels, the handles resting on the ground, sacks in the bed (high
        tier). Its local z runs from the bed's tail to the handles' grips (all within hd), its
        wheels stand inside hw."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        seed = seed_of(q)
        R = 0.6                      # the wheels' radius
        wz = -0.55                   # the axle along the cart
        wx = hw - 0.13               # the wheels' middle planes either side
        ax = Vector(axis_x(q))
        # the wheels stand on the ground under them, the axle level across them
        ws = [local(q, s * wx, wz) for s in (-1, 1)]
        gy = sum(self.ground(*w) for w in ws) / 2
        axle_y = gy + R
        tip_z = hd - 0.03
        tip = local(q, 0.0, tip_z)
        tip_y = self.ground(*tip) + 0.07
        bed_lift = 0.12             # the bed's floor over the axle at rest

        # tip the cart forward about the axle so the handles' grips come down to the ground
        def pos(cx, cy, cz, th):
            dy, dz = cy, cz - wz
            yy = dy * math.cos(th) - dz * math.sin(th)
            zz = wz + dy * math.sin(th) + dz * math.cos(th)
            x, z = local(q, cx, zz)
            return (x, axle_y + yy, z)

        lo, hi = -0.2, 0.9
        for _ in range(30):
            th = (lo + hi) / 2
            if pos(0.0, bed_lift, tip_z, th)[1] > tip_y:
                lo = th
            else:
                hi = th
        th = (lo + hi) / 2

        def at(cx, cy, cz):
            return pos(cx, cy, cz, th)

        bw = wx - 0.14               # the bed's half width, inside the wheels
        b0, b1 = -hd + 0.02, 0.55    # the bed's tail and front along the cart
        # the bed's floor: a slab of boards
        corners = [at(a, bed_lift + d, b) for d in (0.0, 0.1) for (a, b) in ((-bw, b0), (bw, b0), (bw, b1), (-bw, b1))]
        K.block(g, corners, K.tint(OAK, 0.92, seed, spread=0.06), TIMBER)
        # its low sides and tail board, each a board a little off the line of the last
        for k, ((ua, za), (ub, zb)) in enumerate((((-bw, b0), (-bw, b1)), ((bw, b0), (bw, b1)), ((-bw, b0), (bw, b0)))):
            y = bed_lift + 0.32 + jit(0.03, seed, 1, k)
            K.hewn(g, at(ua, y, za), at(ub, y + jit(0.03, seed, 2, k), zb), 0.08, 0.42,
                   K.tint(OAK, 0.82, seed, 3, k, spread=0.06), TIMBER, seed=seed + 4 + k, segs=1, wander=0.0)
        # the stakes holding the sides up
        for k, (ua, za) in enumerate(((-bw, b0 + 0.1), (bw, b0 + 0.1), (-bw, b1 - 0.12), (bw, b1 - 0.12))):
            K.hewn(g, at(ua * 1.03, bed_lift - 0.05, za), at(ua * 1.06, bed_lift + 0.6, za), 0.09, 0.09,
                   K.tint(OAK, 0.62, seed, 5, k), TIMBER, seed=seed + 6 + k, segs=1, wander=0.0)
        # the handles: from under the bed out to the grips on the ground, a bar across them
        for s in (-1, 1):
            K.hewn(g, at(s * (bw - 0.06), bed_lift - 0.06, b0 + 0.2), at(s * (bw - 0.16), bed_lift - 0.04, tip_z),
                   0.11, 0.12, K.tint(OAK, 0.72, seed, 7, s), TIMBER, seed=seed + 8 + s, segs=1, wander=0.02)
        K.hewn(g, at(-bw + 0.1, bed_lift - 0.02, b1 + 0.3), at(bw - 0.1, bed_lift - 0.02, b1 + 0.3), 0.08, 0.08,
               K.tint(OAK, 0.66, seed, 9), TIMBER, seed=seed + 10, segs=1)
        # the axle and the wheels (they stay upright: the cart tips about the axle)
        a0 = local(q, -wx - 0.08, wz)
        a1 = local(q, wx + 0.08, wz)
        g.cylinder((a0[0], axle_y, a0[1]), (a1[0], axle_y, a1[1]), 0.07, K.tint(OAK, 0.55, seed, 11), TIMBER, sides=4)
        for e, s in enumerate((-1, 1)):
            cx, cz = local(q, s * wx, wz)
            c = Vector((cx, axle_y, cz))
            spin = jit(0.6, seed, 12, e)
            g.ring(tuple(c), R - 0.06, 0.12, K.tint(OAK, 0.78, seed, 13, e), segments=8, axis=tuple(ax), mat=TIMBER,
                   depth=0.1)
            g.cylinder(tuple(c - ax * 0.11), tuple(c + ax * 0.11), 0.12, K.tint(OAK, 0.6, seed, 14, e), TIMBER, sides=6,
                       phase=spin)
            up = Vector((0.0, 1.0, 0.0))
            side = ax.cross(up).normalized()
            for k in range(6):
                a = spin + math.tau * k / 6
                d = side * math.cos(a) + up * math.sin(a)
                g.cylinder(tuple(c + d * 0.1), tuple(c + d * (R - 0.1)), 0.035, K.tint(OAK, 0.7, seed, 15, e, k),
                           TIMBER, sides=4, caps=False, phase=a)
        # sacks slumped in the bed (high tier)
        for k, (u, cz) in enumerate(((-0.18, -1.15), (0.2, -0.55), (-0.1, 0.0))):
            px, py, pz = at(u, bed_lift + 0.32, cz)
            blob(self.clutter, (px, py, pz), (0.56, 0.46, 0.66), K.tint(SACK, 0.95, seed, 16, k, spread=0.08), PLAIN,
                 seed + 17 + k, jitter=0.14, flat=0.4)

    def woodpile(self, q):
        """Logs stacked against the hall's right wall, round ones and the odd split one, their
        pale ends out and no two quite in line, on two sleepers that level them over the
        ground rising away from the wall, under a little slate lean-to hung off the wall on a
        ledger and carried at its front on two posts."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        seed = seed_of(q)
        x0, x1 = q['x'] - hw, q['x'] + hw
        z0, z1 = q['z'] - hd, q['z'] + hd
        # the sleepers: blocks from the ground up to one level line over its highest corner
        base = max(self.ground(*local(q, a, b)) for a in (-hw, hw) for b in (-hd, hd)) + 0.1
        for k, lz in enumerate((-hd + 0.35, hd - 0.35)):
            self.footed(g, q, -hw + 0.03, hw - 0.03, lz - 0.08, lz + 0.08, base, K.tint(OAK, 0.6, seed, k), TIMBER,
                        seed + k, sink=0.08)
        za, zb = self._lean_to_span(q)
        r = 0.25
        row_h = r * 1.6
        rows = max(1, int(round((top - base - r * 0.2) / row_h)))
        for row in range(rows):
            y = base + r * 0.9 + row * row_h
            zz = z0 + r + 0.04 + ((r * 0.86) if row % 2 else 0.0)
            # the top rows stop under the lean-to's end, and the very top one short of that, so
            # the stack's top steps down rather than running dead straight
            end = z1 - r
            if row >= rows - 2:
                end = min(end, zb - 0.15)
            if row == rows - 1:
                end -= 0.3 + hash01(seed, row) * 0.5
            k = 0
            while zz <= end + 1e-6:
                s = seed + row * 31 + k
                rr = r * (0.86 + 0.26 * hash01(s, 2))
                front = x1 - 0.03 + jit(0.08, s, 3)
                yy = y + jit(0.035, s, 4)
                # round logs, now and then a split one among them
                sides = 3 if hash01(s, 9) < 0.22 else 5
                grain = K.tint(END_GRAIN, 0.74 + 0.28 * hash01(s, 8), s, 10, spread=0.06)
                log(g, (x0 + 0.08, yy, zz + jit(0.03, s, 5)), (front, yy + jit(0.025, s, 6), zz),
                    rr * (1.0 if sides == 5 else 1.12), hash01(s, 7) * math.tau, K.tint(OAK_DARK, 0.86, s, spread=0.1),
                    grain, sides=sides, seed=s)
                zz += rr * 1.85
                k += 1
        self._lean_to(q, seed, za, zb)

    def _lean_to_span(self, q):
        """How far along the wall the woodpile's lean-to runs: from just clear of the wall
        fire's chimney stack (inn_hall _chimney_stack: the fireplace's half-depth and 0.45 more
        either side at its foot) to just short of the right wall's front window's jamb stones
        (inn_hall side(): the window at z 9, its jambs out to 1.1 either side), so neither
        is cut."""
        hd = q['hd']
        za, zb = q['z'] - hd - 0.12, q['z'] + hd + 0.15
        fire = next((f for f in self.props if f['kind'] == 'fireplace'), None)
        if fire is not None and fire['x'] > 0:
            za = max(za, fire['z'] + fire['hd'] + 0.45 + 0.08)
        return za, min(zb, RIGHT_WINDOW_Z - 1.12)

    def _lean_to(self, q, seed, za, zb):
        """The woodpile's lean-to: a ledger on the wall, two rafters down to a front beam on two
        posts, and a small slate roof over them (a slab of slates over boards)."""
        g = self.g
        hw, hd = q['hw'], q['hd']
        top = q['base'] + q['height']
        wall_x = self.H['x1']
        # the front beam over the stack's face; the eave no further out than a hand past the
        # footprint (it hangs at a walker's head height, so it stays over the stack)
        xo = q['x'] + hw - 0.1
        xa, xb = wall_x + 0.02, q['x'] + hw + 0.08
        pitch = 0.36
        th = 0.13
        y_eave = top + 0.42                # the slates' top at the front edge

        def y_at(xx, zz):
            return y_eave + pitch * (xb - xx) + 0.03 * vnoise(zz / 1.1, xx, seed)

        def under(xx):
            """The boards' underside at xx (less the slates' wobble)."""
            return y_at(xx, 0.0) - th - 0.035 - 0.03 * vnoise(0.0, xx, seed)

        # the posts at the front corners, on the ground inside the footprint, the front beam on
        # them, the ledger on the wall and two rafters between, all under the boards
        p0, p1 = max(q['z'] - hd + 0.1, za + 0.12), min(q['z'] + hd - 0.1, zb - 0.12)
        yb = under(xo) - 0.1
        for k, zz in enumerate((p0, p1)):
            K.hewn(g, (xo + jit(0.03, seed, 20, k), self.ground(xo, zz) - 0.1, zz), (xo, yb - 0.05, zz), 0.16, 0.16,
                   K.tint(OAK, 0.66, seed, 21, k), TIMBER, seed=seed + 22 + k, segs=1, up=(0.0, 0.0, 1.0))
        K.hewn(g, (xo, yb, za + 0.05), (xo, yb, zb - 0.05), 0.18, 0.18, K.tint(OAK, 0.62, seed, 23),
               TIMBER, seed=seed + 24, segs=2, sag=0.03)
        K.hewn(g, (wall_x + 0.1, under(wall_x + 0.1) - 0.11, za), (wall_x + 0.1, under(wall_x + 0.1) - 0.11, zb), 0.18,
               0.2, K.tint(OAK, 0.62, seed, 25), TIMBER, seed=seed + 26, segs=1)
        for k, zz in enumerate((za + 0.12, zb - 0.12)):
            K.hewn(g, (wall_x + 0.05, under(wall_x + 0.05) - 0.07, zz), (xo + 0.1, under(xo + 0.1) - 0.07, zz), 0.12,
                   0.14, K.tint(OAK, 0.66, seed, 27, k), TIMBER, seed=seed + 28 + k, segs=1)
        # the roof slab: slates on top, boards under, an edge all round
        zs = [za, (za + zb) / 2, zb]

        bm = g.bm
        topv = [[bm.verts.new(K.P(xx, y_at(xx, zz), zz)) for xx in (xa, xb)] for zz in zs]
        underv = [[bm.verts.new(K.P(xx, y_at(xx, zz) - th, zz)) for xx in (xa, xb)] for zz in zs]
        for j in range(len(zs) - 1):
            quad(g, [topv[j][0], topv[j][1], topv[j + 1][1], topv[j + 1][0]], (0.0, 1.0, 0.0),
                 K.tint(SLATE, 0.9, seed, 30, j), ROOF, soft=True)
            quad(g, [underv[j][0], underv[j][1], underv[j + 1][1], underv[j + 1][0]], (0.0, -1.0, 0.0),
                 K.tint(SARKING, 0.9, seed, 31, j), FLOOR, soft=True)
            quad(g, [topv[j][1], topv[j + 1][1], underv[j + 1][1], underv[j][1]], (1.0, 0.0, 0.0),
                 K.tint(OAK, 0.62, seed, 32, j), TIMBER)
        for j, f in ((0, -1.0), (len(zs) - 1, 1.0)):
            quad(g, [topv[j][0], topv[j][1], underv[j][1], underv[j][0]], (0.0, 0.0, f), K.tint(OAK, 0.62, seed, 33, j),
                 TIMBER)

    # ================================================================ the stable
    def stable(self):
        """The open stable west of the hall: a rubble footing under weathered board walls on an
        oak frame (back and both gable ends), the stall partition, three posts along its open
        front carrying the front beam on knee braces, tie beams and a ridge beam, and a slate
        roof with its ridge along x (the front eave over the open front), sagging a little and
        kicking up flatter at its eaves. Walls and posts stand on the sim's boxes and circles."""
        s = self.G['stable']
        self.s = s
        g = self.g
        x0, x1, z0, z1, t = s['x0'], s['x1'], s['z0'], s['z1'], s['wall']
        floor = s['baseY']
        eave = floor + s['eave']
        px = s['partitionX']
        zf = z1 - STABLE_POST_R           # the front posts' line
        zb = z0 + t / 2                   # the back wall's middle line
        zr = (zf + zb) / 2                # the ridge
        self.zf, self.zb, self.zr = zf, zb, zr
        self.eave_y = eave
        self.ridge_y = floor + s['ridge']
        # the footing's top: level, a hand over the highest ground along the walls
        walls = [(x0, z0, x1, z0), (x0, z0, x0, z1), (x1, z0, x1, z1)]
        high = max(self.ground(xa + (xb - xa) * i / 8, za + (zb_ - za) * i / 8)
                   for (xa, za, xb, zb_) in walls for i in range(9))
        sill = max(floor + 0.35, high + 0.25)
        self.sill = sill
        seed = 800
        # ---- the footings
        back = K.Wall(x0, z0, x1, z0, (0.0, -1.0))
        left = K.Wall(x0, z0, x0, z1, (-1.0, 0.0))
        right = K.Wall(x1, z0, x1, z1, (1.0, 0.0))
        self._footing(back, -0.04, back.length + 0.04, 0.04, -t - 0.04, sill, seed)
        self._footing(left, t + 0.02, z1 - z0 - 0.05, 0.04, -t - 0.04, sill, seed + 1)
        self._footing(right, t + 0.02, z1 - z0 - 0.05, 0.04, -t - 0.04, sill, seed + 2)
        # ---- the board walls: the back up under its plate, the gable ends up under the roof
        plate = eave - 0.3
        self._boards(back, 0.0, back.length, sill + 0.12, lambda u: plate, t, seed + 3)
        for k, w in enumerate((left, right)):
            self._boards(w, 0.0, zf - z0, sill + 0.12, lambda u: self.roof_top(z0 + u) - 0.06, t, seed + 4 + k)
        # ---- the frame
        oak = lambda *k: K.tint(OAK, 0.78, seed, *k, spread=0.06)  # noqa: E731
        # sole plates along the footings
        for k, (a, b) in enumerate((((x0 - 0.05, zb), (x1 + 0.05, zb)), ((x0 + t / 2, z0), (x0 + t / 2, z1 - 0.1)),
                                    ((x1 - t / 2, z0), (x1 - t / 2, z1 - 0.1)))):
            K.hewn(g, (a[0], sill + 0.06, a[1]), (b[0], sill + 0.06, b[1]), 0.36, 0.16, oak(10, k), TIMBER,
                   seed=seed + 10 + k, segs=2, wander=0.02)
        # the posts: the three along the front (the sim's), the back corners, a middle post in
        # each wall
        front = [(x0 + t / 2, zf), (px, zf), (x1 - t / 2, zf)]
        for k, (x, z) in enumerate(front):
            yg = self.ground(x, z)
            if k == 1:
                K.lump(g, (x, yg + 0.06, z), (0.62, 0.34, 0.62), K.tint(KERB, 0.85, seed, 20), DRESSED, seed + 20,
                       rough=0.14, yaw=0.3)
                y0 = yg + 0.2
            else:
                y0 = sill
            K.hewn(g, (x + jit(0.03, seed, 21, k), y0, z), (x, eave - 0.34, z + jit(0.03, seed, 22, k)), 0.36, 0.36,
                   oak(23, k), TIMBER, seed=seed + 23 + k, segs=2, wander=0.025, up=(0.0, 0.0, 1.0))
        for k, (x, z) in enumerate(((x0 + t / 2, zb), (x1 - t / 2, zb), (px, zb), (x0 + t / 2, zr), (x1 - t / 2, zr))):
            K.hewn(g, (x, sill + 0.12, z), (x + jit(0.04, seed, 24, k), plate, z), 0.38, 0.38, oak(25, k), TIMBER,
                   seed=seed + 25 + k, segs=1, up=(0.0, 0.0, 1.0))
        # the front beam on the posts, the back plate, the tie beams across at the eave
        K.hewn(g, (x0 - 0.3, eave - 0.17, zf), (x1 + 0.3, eave - 0.17, zf), 0.36, 0.34, oak(30), TIMBER,
               seed=seed + 30, segs=3, sag=0.07)
        K.hewn(g, (x0 - 0.2, plate + 0.15, zb), (x1 + 0.2, plate + 0.15, zb), 0.36, 0.3, oak(31), TIMBER,
               seed=seed + 31, segs=2, sag=0.03)
        for k, x in enumerate((x0 + t / 2, px, x1 - t / 2)):
            K.hewn(g, (x, plate + 0.12, zb - 0.1), (x, eave - 0.2, zf + 0.1), 0.42 if k != 1 else 0.3, 0.3, oak(32, k),
                   TIMBER, seed=seed + 32 + k, segs=2, sag=0.05 if k == 1 else 0.02)
        # the gables' king posts up to the ridge, and the ridge beam under the roof
        for k, x in enumerate((x0 + t / 2, x1 - t / 2)):
            K.hewn(g, (x, eave, zr), (x + jit(0.04, seed, 34, k), self.roof_top(zr) - 0.3, zr), 0.4, 0.3, oak(35, k),
                   TIMBER, seed=seed + 35 + k, segs=1, up=(0.0, 0.0, 1.0))
        pts = [(x0 - 0.3 + (x1 - x0 + 0.6) * i / 4, 0.0, zr) for i in range(5)]
        pts = [(x, self.roof_top(zr, x) - STABLE_THICK - 0.16, z) for (x, _, z) in pts]
        g.beam(pts, 0.3, 0.32, oak(36), TIMBER)
        # knee braces from the front posts up to the front beam (over a walker's head)
        for k, (x, d) in enumerate(((x0 + t / 2, 1), (px, -1), (px, 1), (x1 - t / 2, -1))):
            K.hewn(g, (x, eave - 0.85, zf), (x + d * 0.75, eave - 0.3, zf), 0.18, 0.2, oak(37, k), TIMBER,
                   seed=seed + 37 + k, segs=1, sag=0.03, up=(0.0, 0.0, 1.0))
        # a rail along the outside of each wall
        for k, (w, u0, u1) in enumerate(((back, 0.1, back.length - 0.1), (left, 0.2, zf - z0 - 0.2),
                                         (right, 0.2, zf - z0 - 0.2))):
            K.hewn(g, w.pt(u0, sill + 1.55, 0.02), w.pt(u1, sill + 1.55 + jit(0.04, seed, 38, k), 0.02), 0.1, 0.18,
                   oak(39, k), TIMBER, seed=seed + 39 + k, segs=2, sag=0.03, wander=0.015)
        self._partition(s, seed + 40)
        self._stable_roof(seed + 50)
        self._stable_floor(s, seed + 60)
        self._stable_things(s, seed + 70)

    def _stable_floor(self, s, seed):
        """The stable's floor inside its walls: old cobbles draped on the ground (the feet still
        walk the terrain), darker than the forecourt's, out to the drip line of its front eave."""
        g = self.g
        x0, x1 = s['x0'] + s['wall'] - 0.05, s['x1'] - s['wall'] + 0.05
        z0, z1 = s['z0'] + s['wall'] - 0.05, s['z1'] + 0.35
        vert = Drape(self.B, g, seed).vert
        xs = sorted({x0, x1} | {float(i) for i in range(math.ceil(x0), math.floor(x1) + 1) if i % 2 == 0})
        zs = sorted({z0, z1} | {float(i) for i in range(math.ceil(z0 + 0.2), math.floor(z1 - 0.2) + 1)})
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                xa, xb, za, zb = xs[i], xs[i + 1], zs[j], zs[j + 1]
                k = 0.66 + 0.08 * vnoise(xa / 2.1, za / 1.7, seed) - 0.06 * max(0.0, (zb - s['z1']) / 0.35)
                quad(g, [vert(xa, za), vert(xb, za), vert(xb, zb), vert(xa, zb)], (0.0, 1.0, 0.0),
                     K.tint(COBBLE, k, seed, i, j, spread=0.03), STONE, soft=True)

    def roof_top(self, z, x=None):
        """The stable's slates at z (and x): the pitch from the ridge down to the front posts'
        line or the back wall, then the eaves' flatter kick out past them, the ridge sagged a
        little toward its middle."""
        s = self.s
        zr = self.zr
        if z >= zr:
            run, d = self.zf - zr, z - zr
        else:
            run, d = zr - self.zb, zr - z
        eave_top = self.eave_y + STABLE_THICK
        pitch = (self.ridge_y - eave_top) / run
        y = self.ridge_y - pitch * min(d, run) - STABLE_KICK * max(0.0, d - run)
        if x is not None:
            half = (s['x1'] - s['x0']) / 2 + 0.5
            xm = (s['x0'] + s['x1']) / 2
            y -= STABLE_SAG * max(0.0, 1.0 - ((x - xm) / half) ** 2) * max(0.0, 1.0 - d / (run + s['eaveOut']))
        return y

    def _footing(self, wall, u0, u1, w_out, w_in, top, seed):
        """A rubble footing along a wall line from u0 to u1: from under the ground up to its
        level top, its outer face at w_out and its inner at w_in (out of the wall line), bellied
        a little and its top a touch off level."""
        g = self.g
        bm = g.bm
        us = K.breaks(u0, u1, 1.3)
        cols = []
        for i, u in enumerate(us):
            bow = 0.03 * vnoise(u / 1.2, 0.0, seed)
            xo, zo = wall.xz(u, w_out)
            xi, zi = wall.xz(u, w_in)
            bot = min(self.ground(xo, zo), self.ground(xi, zi)) - 0.25
            yt = top + jit(0.035, seed, i)
            # battered: a little wider at its foot (under the ground) than at its top
            pts = [wall.pt(u, bot, w_out + 0.06 + bow), wall.pt(u, yt, w_out + bow), wall.pt(u, yt, w_in - bow * 0.5),
                   wall.pt(u, bot, w_in - 0.06 - bow * 0.5)]
            cols.append([bm.verts.new(K.P(*q)) for q in pts])
        out, up = tuple(wall.n), (0.0, 1.0, 0.0)
        inn = tuple(-wall.n)
        for i in range(len(us) - 1):
            a, b = cols[i], cols[i + 1]
            c = K.tint(RUBBLE, 0.9, seed, i, spread=0.05)
            quad(g, [a[0], b[0], b[1], a[1]], out, c, STONE, soft=True)
            quad(g, [a[1], b[1], b[2], a[2]], up, K.tint(RUBBLE, 0.82, seed, i, 1), STONE, soft=True)
            quad(g, [a[2], b[2], b[3], a[3]], inn, K.tint(RUBBLE, 0.78, seed, i, 2), STONE, soft=True)
        for col, facing in ((cols[0], tuple(-wall.d)), (cols[-1], tuple(wall.d))):
            quad(g, list(col), facing, K.tint(RUBBLE, 0.85, seed, 9), STONE)

    def _boards(self, wall, u0, u1, v0, top, t, seed):
        """A boarded wall on a wall line between u0 and u1, from v0 up to top(u): the outer face
        on the wall's box (its line) and the inner face t in (the sim's wall box between them),
        bowed a hair between the frame's posts; the boards are the painted map's."""
        g = self.g
        us = K.breaks(u0, u1, 1.7)
        vtop = max(top(u) for u in us)
        vs = K.breaks(v0, vtop, 1.45)

        def bow(k):
            return lambda u, v: 0.025 * vnoise(u / 1.1, v / 1.3, seed + k)

        for k, (facing, w0) in enumerate(((1, 0.0), (-1, -t))):
            def cell(i, j, a, b, c, d, k=k):
                return K.tint(BOARDS, 1.0 if k == 0 else 0.84, seed, k, i, j, spread=0.04), FLOOR

            depth = (lambda u, v, w0=w0, b=bow(k): w0 + b(u, v)) if k == 0 else \
                (lambda u, v, w0=w0, b=bow(k): w0 - b(u, v))
            K.skin(g, wall, us, vs, depth, facing, cell, top=top)

    def _partition(self, s, seed):
        """The stall partition: boards on both faces from the back wall out partitionTo, a cap
        rail along its top and a post at its end (the sim's box, 0.2 thick)."""
        g = self.g
        px = s['partitionX']
        za = s['z0'] + s['wall']
        zb = za + s['partitionTo']
        yt = self.s['baseY'] + 1.75
        wall = K.Wall(px, za, px, zb, (1.0, 0.0))
        us = K.breaks(0.0, zb - za - 0.15, 1.6)
        for k, sx in enumerate((1, -1)):
            bm = g.bm
            row = []
            for u in us:
                x, z = wall.xz(u, sx * (PARTITION_HALF - 0.03))
                row.append((bm.verts.new(K.P(x, self.ground(x, z) - 0.1, z)),
                            bm.verts.new(K.P(x, yt + jit(0.03, seed, u, k), z))))
            for i in range(len(us) - 1):
                quad(g, [row[i][0], row[i + 1][0], row[i + 1][1], row[i][1]], (sx, 0.0, 0.0),
                     K.tint(BOARDS, 0.8, seed, k, i, spread=0.05), FLOOR, soft=True)
        K.hewn(g, (px, yt + 0.04, za - 0.05), (px, yt + 0.06, zb - 0.05), 2 * PARTITION_HALF, 0.12,
               K.tint(OAK, 0.74, seed, 3), TIMBER, seed=seed + 3, segs=2, sag=0.02)
        K.hewn(g, (px, self.ground(px, zb - 0.12) - 0.1, zb - 0.12), (px + jit(0.03, seed, 4), yt + 0.3, zb - 0.12),
               2 * PARTITION_HALF, 0.24, K.tint(OAK, 0.7, seed, 5), TIMBER, seed=seed + 5, segs=1, up=(0.0, 0.0, 1.0))

    def _stable_roof(self, seed):
        """The stable's slate roof: a slab of slates over boarded sarking on each slope, eaves
        that wander, a fascia, the verges closed with bargeboards and the ridge capped."""
        g = self.g
        s = self.s
        xa, xb = s['x0'] - 0.45, s['x1'] + 0.45
        xs = K.breaks(xa, xb, 1.75)
        bm = g.bm
        for side, (ze, edge) in enumerate(((self.zf, s['z1'] + s['eaveOut']), (self.zb, s['z0'] - s['eaveOut']))):
            zs = [self.zr, (self.zr + ze) / 2, ze, edge]

            def pt(x, z, down=0.0, edge=edge):
                y = self.roof_top(z, x) - down
                zz = z
                if abs(z - edge) < 1e-6:
                    y += 0.09 * vnoise(x / 1.4, side, seed)
                    zz = z + math.copysign(0.1 * vnoise(x / 1.7, side + 3, seed), edge - self.zr)
                return (x, y, zz)

            def thick(z):
                d = abs(z - self.zr) / abs(edge - self.zr)
                return STABLE_THICK * (1.0 - 0.35 * max(0.0, d - 0.8) / 0.2)

            top = [[bm.verts.new(K.P(*pt(x, z))) for x in xs] for z in zs]
            under = [[bm.verts.new(K.P(*pt(x, z, thick(z)))) for x in xs] for z in zs]
            out = 1.0 if side == 0 else -1.0
            for j in range(len(zs) - 1):
                for i in range(len(xs) - 1):
                    quad(g, [top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]], (0.0, 1.0, out * 0.5),
                         K.tint(SLATE, 1.0 + jit(0.07, seed, side, i, j), seed, side, i, j, spread=0.0), ROOF,
                         soft=True)
                    quad(g, [under[j][i], under[j][i + 1], under[j + 1][i + 1], under[j + 1][i]], (0.0, -1.0, 0.0),
                         K.tint(SARKING, 1.0, seed, 1, side, i, j, spread=0.05), FLOOR, soft=True)
            last = len(zs) - 1
            for i in range(len(xs) - 1):
                quad(g, [top[last][i], top[last][i + 1], under[last][i + 1], under[last][i]], (0.0, 0.0, out),
                     K.tint(OAK, 0.66, seed, 2, side, i), TIMBER)
            for i, f in ((0, -1.0), (len(xs) - 1, 1.0)):
                for j in range(len(zs) - 1):
                    quad(g, [top[j][i], top[j + 1][i], under[j + 1][i], under[j][i]], (f, 0.0, 0.0),
                         K.tint(OAK, 0.62, seed, 3, side, i, j), TIMBER)
                # the bargeboard down this verge
                pts = [pt(xs[i] + f * 0.07, z, 0.18) for z in zs]
                g.beam(pts, 0.12, 0.42, K.tint(OAK, 0.66, seed, 4, side, i), TIMBER, up=(0.0, 1.0, 0.0))
        # the ridge cappers, a little off the line of each other
        n = 6
        for k in range(n):
            x = xa - 0.1 + (xb - xa + 0.2) * (k + 0.5) / n
            y = self.roof_top(self.zr, x) + 0.08
            K.lump(g, (x, y, self.zr + jit(0.03, seed, 5, k)), ((xb - xa + 0.2) / n + 0.08, 0.3, 0.56),
                   K.tint(SLATE, 0.78 + jit(0.06, seed, 6, k), seed, 7, k, spread=0.0), ROOF, seed + 8 + k, rough=0.08,
                   yaw=jit(0.04, seed, 9, k))

    def _stable_things(self, s, seed):
        """What the stable holds: a hay rack flat along the back wall of the right stall, a
        lantern close on the middle post's face over the yard, a horseshoe on the front beam
        beside it (medium tier up); straw on the floor, a saddle over the partition and a
        pitchfork stuck in the stacked hay (high tier). Nothing stands loose on its floor: the
        sim keeps the stalls clear."""
        g, trim, clutter = self.g, self.trim, self.clutter
        x0, x1, z0 = s['x0'], s['x1'], s['z0']
        t, px = s['wall'], s['partitionX']
        floor = s['baseY']
        zi = z0 + t                       # the back wall's inner face
        # the hay rack: a rail along the wall, slats leaning out a hand from it, hay in them
        ra, rb = px + 0.35, x1 - t - 0.3
        yr = floor + 1.55
        K.hewn(g, (ra, yr, zi + 0.04), (rb, yr, zi + 0.04), 0.1, 0.14, K.tint(OAK, 0.72, seed), TIMBER, seed=seed,
               segs=1)
        K.hewn(g, (ra, yr + 0.6, zi + 0.075), (rb, yr + 0.6, zi + 0.075), 0.05, 0.06, K.tint(OAK, 0.62, seed, 1),
               TIMBER, seed=seed + 1, segs=1)
        for k in range(6):
            x = ra + 0.1 + (rb - ra - 0.2) * k / 5
            g.cylinder((x, yr + 0.05, zi + 0.04), (x + jit(0.02, seed, 2, k), yr + 0.62, zi + 0.075), 0.022,
                       K.tint(OAK, 0.6, seed, 3, k), TIMBER, sides=3, caps=False)
        K.lump(g, ((ra + rb) / 2, yr + 0.4, zi + 0.03), (rb - ra - 0.15, 0.46, 0.1), K.tint(HAY_PAINT, 0.9, seed, 4),
               DRESSED, seed + 4, rough=0.25)
        # the lantern on the middle post's face, up under the eave in front of the front beam
        # and close in (over a head walking past the post's circle)
        zf = self.zf
        face = zf + STABLE_POST_R
        yl = floor + s['eave'] - 0.2
        K.lump(g, (px, yl - 0.12, face + 0.01), (0.13, 0.3, 0.05), IRON, METAL, seed + 5, rough=0.1)
        arm1 = (px + 0.02, yl + 0.0, face + 0.15)
        K.hewn(g, (px, yl - 0.14, face), arm1, 0.045, 0.045, IRON, METAL, seed=seed + 6, segs=1)
        lantern(g, (arm1[0], arm1[1] - 0.02, arm1[2]), 1.05, seed + 7, drop=True)
        # a horseshoe nailed on the front beam beside the middle post, points up for luck
        hx, hy, hz = px - 0.55, self.eave_y - 0.2, zf + 0.19
        pts = [(hx + math.cos(a) * 0.11, hy - 0.04 + math.sin(a) * 0.13, hz)
               for a in (math.radians(d) for d in (25, -30, -90, -150, 155))]
        trim.beam(pts, 0.035, 0.03, (0.3, 0.3, 0.32), METAL, up=(0.0, 0.0, 1.0))
        # straw over the floor of both stalls (where in each, as fractions of the stable inside)
        for k, (fx, fz, r) in enumerate(((0.25, 0.55, 1.1), (0.12, 0.82, 0.8), (0.73, 0.33, 1.2), (0.86, 0.68, 0.9),
                                         (0.52, 0.88, 0.7))):
            sx = x0 + t + 0.4 + (x1 - x0 - 2 * t - 0.8) * fx
            sz = z0 + t + 0.4 + (zf - z0 - t - 0.8) * fz
            self.straw(sx, sz, r, seed + 10 + k)
        # a saddle over the partition's cap, a blanket under it, hanging no wider than the
        # partition's box and a hand
        sz_ = z0 + t + 1.5
        ys = floor + 1.75
        K.lump(clutter, (px, ys - 0.02, sz_), (0.36, 0.36, 0.62), (0.44, 0.18, 0.14), PLAIN, seed + 20, rough=0.08)
        K.lump(clutter, (px, ys + 0.2, sz_), (0.32, 0.2, 0.52), LEATHER, PLAIN, seed + 21, rough=0.15)

    def pitchfork(self, base, head):
        """A pitchfork from its butt to its head: an ash shaft, three iron tines past a crossbar
        (high tier)."""
        p = self.clutter
        base, head = Vector(base), Vector(head)
        d = (head - base).normalized()
        side = d.cross(Vector((0.0, 1.0, 0.0)))
        side = side.normalized() if side.length > 1e-4 else Vector((1.0, 0.0, 0.0))
        p.cylinder(tuple(base), tuple(head), 0.035, K.tint(OAK, 0.95, 851), TIMBER, sides=4)
        p.cylinder(tuple(head - side * 0.11), tuple(head + side * 0.11), 0.022, IRON, METAL, sides=3, caps=False)
        for k in (-1, 0, 1):
            a = head + side * (0.09 * k)
            p.cylinder(tuple(a), tuple(a + d * 0.34 + side * 0.03 * k), 0.016, IRON, METAL, sides=3, caps=False)

    def bucket(self, x, y, z, seed):
        """An oak bucket with an iron hoop, water in it (high tier)."""
        p = self.clutter
        faces = p.cylinder((x, y, z), (x, y + 0.34, z), 0.15, K.tint(OAK, 0.82, seed), TIMBER, sides=6, r1=0.19,
                           phase=hash01(seed, 1))
        p.paint(faces[-1:], WATER, PLAIN)
        p.cylinder((x, y + 0.23, z), (x, y + 0.28, z), 0.185, IRON, METAL, sides=6, caps=False, phase=hash01(seed, 1))
