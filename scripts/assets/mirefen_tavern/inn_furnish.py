"""The tavern's furniture (build_tavern.py calls build(B, parts)): every bench, settle, table,
stool and chair the sim seats a body on, the barrel racks behind the bar, the stage's chest and
the casks on the porch and by the terrace, each built on its record in layout.json
(src/sim/content/mirefen_tavern.ts TAVERN_PROPS), and the small things on and round them.

  TavernFurnishings  the furniture itself (every tier; the sim collides with its records)
  TavernTrim         medium and up: the iron bands over the chest, the hoops round the barrels
                     and casks, the stretchers and rungs low between the legs
  TavernClutter      high and up: tankards (some foaming), bread boards and plates of apples,
                     bottles and jugs, the cluster of candles on every table, the dice at the dice
                     table, the bard's instruments, the rugs

The candle clusters, the bread boards and the ale jugs on the tables, the barrels in the racks,
the bottles on them and the bard's instruments are real models with their own painted maps (the
props' atlas, inn_props.py), their candles unlit in the paint and a flame stood on every wick here
(light_wicks).

Every piece is authored in its record's own frame (x along its half width hw, z along its half
depth hd, y over the ground floor) and turned by the record's yaw, the sim's three.js rotation.y:
a local (x, z) stands at (x cos + z sin, -x sin + z cos) from the record's middle
(src/sim/content/mirefen_tavern_seats.ts axes()). Each stands inside its footprint (hw by hd, or
r) to within a few hundredths, on the floor its record names (`base`: the hearth's pit, the
stage, the bar's platform, or the terrain outside).

The seats (mirefen_tavern_seats.ts, src/sim/seat_anchor.ts) are derived from the same records,
so the seat tops here are the sim's: a plain board at base + height (the long table's benches,
the porch's bench, the chairs and the stools), a cushion BENCH_CUSHION over the board on the
hearth's and the nook's benches and SETTLE_CUSHION over it on the settles. A settle seats its
sitters facing its own +z, its back on -z, its board's lip out at hd + SETTLE_LIP; a chair faces
its +z (its table), its back on -z; the hearth's benches face the fire on their -z, the nook's
face the tower's middle on their -z with the stone behind their +z; the porch's faces the road.

The look is the painted town's: chunky, and a little off everywhere. Tops and seats are thick
slabs with their corners knocked off and their edges eased, legs are stout, splayed, bellied and
tapered, nothing quite square or plumb, and every wobble comes from a stable hash of where the
piece stands (inn_kit.py), so every build is the same. The paint carries the detail: the oak's
map runs down each solid's length (tavern_texture.py), so a top shows its planks and a barrel
its staves, and the cloth's map is the cushions' and the rugs' garnet weave.

The small wares are turned (lathe(): round where they are round, six to nine sides and smooth
shaded, a rim and a well on a plate, a shoulder, neck and cork on a bottle, a strap handle looped
off a tankard, a tallow candle tapering to a burnt dome with its wax run down it and a teardrop
flame on its wick), never boxes; inn_lights.py and inn_interior.py turn their candles, pots and
mugs with the same tools. Faces nobody can see (a board's sole on the floor, a carcass inside
its panels, a post's end buried in its shelf) are left off (open_lump, open_hewn, dropped), so
the triangles go where they show.

Nothing in the common room stands higher than CLEAR (a settle's capping rail tops out under it):
the camera's air over the room stays clear. Only the bar's racks, in the bar's own corner, stand
taller.
"""
import math

import bmesh
from mathutils import Vector

import inn_kit as K
import inn_props as PR
from inn_kit import CLOTH, GLOW, METAL, PLAIN, TIMBER, hash01, jit
from shiplib import G, P

# the sim's seats (src/sim/content/mirefen_tavern_seats.ts)
BENCH_CUSHION = 0.1    # the hearth's and the nook's benches: a cushion over the board
SETTLE_CUSHION = 0.13  # a settle's cushion over its board
SETTLE_LIP = 0.05      # a settle's board runs out past its hd by this at the front
CLEAR = 2.85           # nothing in the common room reaches higher (the camera's air from 2.9)
RACK_TRIO_H = 0.62     # the props' bottle trio on the racks' top shelves: its height
RACK_TRIO_EVERY = 2.6  # and a trio to about every this many yards of shelf
TABLE_CANDLES_H = 0.42  # the props' candle cluster on a table: its height (its tallest candle's top)
BREAD_BOARD_W = 0.56   # the props' bread board on a table: its width across
TANKARD_H = 0.36       # the props' tankard on a table: its height (its foam's top)
ALE_JUG_H = 0.46       # the props' ale jug on a table: its height (its cork's top)
# the props' bear's skin on the bard's stage before the stool, its head to the room: its middle
# (x, z) and its length
BEARSKIN = ((-11.1, -9.75), 2.0)
BARD_KIT_H = 1.3       # the props' lute, drum and pipe by the bard's stool: the lute's head's height
# the props' iron candelabra on the bard's stage, either side of the bard's corner and turned to
# the room: their feet (x, z) and their height over the deck (their candles' tops under CLEAR)
CANDELABRA = (((-10.1, -12.55), 2.15), ((-14.55, -9.15), 2.15))

# colours (tints over the painted maps: 1 is the map as painted)
# the furniture's oak: oiled by use, warm and brown. It wears the frame's map (the town's weathered
# oak, moss in its grain: tavern_texture.py), so its tint is a strong warm one that turns the
# moss to an amber grain indoors (a tint is eased toward the map's own value: build_tavern.eased)
OAK = (0.95, 0.66, 0.42)
WORN = (0.97, 0.7, 0.46)         # tops and seats rubbed pale by elbows, tankards and breeches
WEATHERED = (0.86, 0.85, 0.86)   # the porch's oak, greyed by the marsh's damp
GARNET = (1.0, 0.97, 0.97)       # the cloth's own garnet
# the colours of things that wear no map (metal, glow, plain)
IRON = (0.2, 0.2, 0.22)
BRASS = (0.74, 0.54, 0.24)
GOLD = (0.86, 0.66, 0.26)
PEWTER = (0.55, 0.55, 0.58)
FLAME = (1.0, 0.7, 0.36)
WAX = (0.93, 0.87, 0.72)
BREAD = (0.78, 0.52, 0.26)
CRUST = (0.62, 0.38, 0.17)
CHEESE = (0.95, 0.78, 0.34)
RIND = (0.82, 0.55, 0.2)
APPLES = ((0.74, 0.16, 0.1), (0.56, 0.68, 0.2), (0.8, 0.3, 0.12))
GLASS = ((0.16, 0.36, 0.22), (0.4, 0.21, 0.09), (0.56, 0.42, 0.14), (0.22, 0.3, 0.4))
CORK = (0.6, 0.45, 0.28)
BONE = (0.94, 0.9, 0.8)
PIP = (0.16, 0.1, 0.08)
LEATHER = (0.42, 0.25, 0.14)


def build(B, parts):
    Furnisher(B, parts).build()


# ---------------------------------------------------------------------------
# Frames and the shapes the pieces are made of
# ---------------------------------------------------------------------------
class Spot:
    """A record's own frame: x along its half width (hw), z along its half depth (hd), y over
    the ground floor, turned by its yaw (three.js rotation.y, the sim's own: a local (x, z)
    stands at (x cos + z sin, -x sin + z cos) from its middle)."""

    def __init__(self, x, z, yaw):
        self.x, self.z, self.yaw = x, z, yaw
        self.cos, self.sin = math.cos(yaw), math.sin(yaw)

    @classmethod
    def of(cls, q, spin=0.0, wobble=0.0):
        """A record's frame; `spin` turns it a further quarter so a piece authored along x can
        stand on a record that runs along z, `wobble` a hair off true (set down by hand)."""
        return cls(q['x'], q['z'], q['rot'] + spin + wobble)

    def pt(self, x, y, z):
        return Vector((self.x + x * self.cos + z * self.sin, y, self.z - x * self.sin + z * self.cos))

    def vec(self, x, y, z):
        return Vector((x * self.cos + z * self.sin, y, -x * self.sin + z * self.cos))

    def sub(self, x, z, yaw=0.0):
        """A frame inside this one: at its (x, z), turned a further `yaw`."""
        c = self.pt(x, 0.0, z)
        return Spot(c.x, c.z, self.yaw + yaw)


def seed_of(q):
    """A record's own stable seed, from where it stands and how it is turned."""
    return round(q['x'] * 7.31 + q['z'] * 3.77 + q['rot'] * 1.93, 3)


def solid(p, rings, color, mat, cap0=True, cap1=True, tip0=None, tip1=None, soft=True, tag=K.PLAIN_TAG):
    """A closed solid lofted through rings of game-frame points (equal counts round), each end
    closed flat or drawn to a tip (a cushion's crown, a flame, a sack's tied neck). Returns its
    sides and its two ends' faces."""
    bm = p.bm
    vs = [[bm.verts.new(P(*q)) for q in ring] for ring in rings]
    n = len(vs[0])
    sides, ends = [], ([], [])
    for i in range(len(vs) - 1):
        for k in range(n):
            f = bm.faces.new((vs[i][k], vs[i][(k + 1) % n], vs[i + 1][(k + 1) % n], vs[i + 1][k]))
            f[p.soft] = 1 if soft else 0
            sides.append(f)
    for j, (ring, tip, cap) in enumerate(((vs[0], tip0, cap0), (vs[-1], tip1, cap1))):
        if tip is not None:
            t = bm.verts.new(P(*tip))
            for k in range(n):
                f = bm.faces.new((ring[k], ring[(k + 1) % n], t))
                f[p.soft] = 1 if soft else 0
                ends[j].append(f)
        elif cap:
            ends[j].append(bm.faces.new(ring))
    p.paint(sides + ends[0] + ends[1], color, mat, tag)
    p.closed.extend(sides + ends[0] + ends[1])
    return sides, ends[0], ends[1]


def ring(f, cx, y, cz, rx, rz, n, phase=0.0, wob=0.0, seed=0.0):
    """n points round (cx, y, cz) in frame f, rx along its x and rz along its z, each pushed a
    little in or out (the same push for the same seed and point, so stacked rings agree)."""
    out = []
    for i in range(n):
        a = phase + math.tau * i / n
        k = 1.0 + (jit(wob, seed, i, 0.7) if wob else 0.0)
        out.append(f.pt(cx + math.cos(a) * rx * k, y, cz + math.sin(a) * rz * k))
    return out


def outline(x0, x1, z0, z1, corner, inset=0.0):
    """A rectangle with its corners knocked off (eight points round), pulled in by `inset`."""
    a0, a1, b0, b1 = x0 + inset, x1 - inset, z0 + inset, z1 - inset
    c = max(0.01, min(corner, (a1 - a0) * 0.45, (b1 - b0) * 0.45))
    return [(a0 + c, b0), (a1 - c, b0), (a1, b0 + c), (a1, b1 - c), (a1 - c, b1), (a0 + c, b1), (a0, b1 - c),
            (a0, b0 + c)]


def slab(p, f, x0, x1, z0, z1, y0, y1, color, seed, mat=TIMBER, corner=0.1, wob=0.02, ease=0.035, lift=0.01,
         belly=True, soft=True):
    """A chunky slab (a table's top, a seat board, a shelf, a rug): its corners knocked off, its
    outline pulled a little off true at each corner, its top edge eased in (worn by hands and
    elbows) and its foot a touch in, its top not quite flat."""
    levels = ((y0, ease * 0.5), (y0 + (y1 - y0) * 0.55, 0.0), (y1, ease)) if belly else ((y0, 0.0), (y1, ease))
    rings = []
    for k, (y, inset) in enumerate(levels):
        pts = []
        for i, (x, z) in enumerate(outline(x0, x1, z0, z1, corner, inset)):
            dy = jit(lift, seed, i, 4.3) if k == len(levels) - 1 else 0.0
            pts.append(f.pt(x + jit(wob, seed, i, 1.7), y + dy, z + jit(wob, seed, i, 2.9)))
        rings.append(pts)
    return solid(p, rings, color, mat, soft=soft)


def planks(p, f, L, D, y0, y1, n, color, seed, corner=0.07, gap=0.024):
    """A top of n planks laid side by side along x, from -D to D across: each its own board (its
    own tone and length, a hair higher or lower than its neighbour, a dark gap between them)."""
    w = 2 * D / n
    for i in range(n):
        z0 = -D + w * i + (gap / 2 if i else 0.0)
        z1 = -D + w * (i + 1) - (gap / 2 if i < n - 1 else 0.0)
        dy = jit(0.012, seed, i, 1)
        slab(p, f, -L + 0.02 + jit(0.025, seed, i, 2), L - 0.02 + jit(0.025, seed, i, 3), z0, z1, y0 + dy, y1 + dy,
             K.tint(color, 1.0, seed, i, 4, spread=0.05), seed + i * 1.7, corner=corner, belly=False)


def lump(p, f, c, size, color, seed, mat=TIMBER, rough=0.08, yaw=0.0, skip=()):
    """inn_kit's lump in frame f (a box with its corners pushed a little off true), without the
    faces in `skip` that nobody sees (open_lump: 'bottom', 'top', '+x', '-x', '+z', '-z')."""
    return open_lump(p, tuple(f.pt(*c)), size, color, mat, seed, rough=rough, yaw=f.yaw + yaw, skip=skip)


def block(p, f, corners, color, seed, mat=TIMBER, rough=0.015, skip=()):
    """inn_kit's block in frame f, each corner pushed a little off true, without the faces in
    `skip` that nobody sees ('bottom', 'top', or the side looking most along f's '+x', '-x', '+z'
    or '-z')."""
    pts = [f.pt(x + jit(rough, seed, i, 0.3), y + jit(rough * 0.5, seed, i, 0.5), z + jit(rough, seed, i, 0.9))
           for i, (x, y, z) in enumerate(corners)]
    faces = K.block(p, pts, color, mat)
    if not skip:
        return faces
    bmesh.ops.recalc_face_normals(p.bm, faces=faces)
    dirs = {'bottom': (0.0, -1.0, 0.0), 'top': (0.0, 1.0, 0.0), '+x': f.vec(1.0, 0.0, 0.0), '-x': f.vec(-1.0, 0.0, 0.0),
            '+z': f.vec(0.0, 0.0, 1.0), '-z': f.vec(0.0, 0.0, -1.0)}
    return dropped(p, faces, [facing_most(faces, dirs[s]) for s in skip])


def leg(p, f, foot, head, r, color, seed, sides=4, swell=0.16, taper=0.8, at=0.35, mat=TIMBER):
    """A stout leg from its foot up to its head: thickest a third of the way up (the swell of a
    hand-turned or hand-hewn leg), tapering to its head, a touch twisted, never quite true in
    section. r is the corner's reach (a four-sided leg is r * 1.41 across). Its ends stay open:
    its foot stands on the floor and its head under what it carries."""
    rings = []
    twist = jit(0.16, seed, 7.1)
    for t, k in ((0.0, 1.0), (at, 1.0 + swell), (1.0, taper)):
        c = [foot[j] + (head[j] - foot[j]) * t for j in range(3)]
        pts = []
        for i in range(sides):
            a = math.tau * (i + 0.5) / sides + twist
            rr = r * k * (1.0 + jit(0.06, seed, i, t * 3.1))
            pts.append(f.pt(c[0] + math.cos(a) * rr, c[1], c[2] + math.sin(a) * rr))
        rings.append(pts)
    return solid(p, rings, color, mat, cap0=False, cap1=False, soft=sides > 4)


def along(seg, y):
    """The point on a leg's line (foot, head) at height y."""
    (fx, fy, fz), (hx, hy, hz) = seg
    t = (y - fy) / (hy - fy)
    return (fx + (hx - fx) * t, y, fz + (hz - fz) * t)


def cushion(p, to, hx, hz, h, color, seed, puff=0.05, mat=CLOTH, closed=False):
    """A stuffed cushion `h` thick over a hx by hz face, built in its own frame (x and z across
    it, y up out of it from 0 to h) and set in place by to(x, y, z): its sides bellied out, its
    corners poking, its crown just over h in the middle. Its underside stays open where it lies
    on a board (`closed` shuts it, for a pad seen from behind)."""
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    rings = []
    for k, (y, d) in enumerate(((0.0, -0.04), (h * 0.45, puff), (h * 0.88, -0.07))):
        rings.append([to(sx * (hx + d) + jit(0.025, seed, k, i), y, sz * (hz + d) + jit(0.025, seed, k, i, 1))
                      for i, (sx, sz) in enumerate(corners)])
    return solid(p, rings, color, mat, cap0=closed, tip1=to(jit(0.05, seed, 5), h + 0.004, jit(0.05, seed, 6)))


def seat_cushion(p, f, cx, cz, hx, hz, y0, y1, color, seed, yaw=0.0, puff=0.05):
    """A cushion laid on a board at y0, its crown at the seat's height y1."""
    g = f.sub(cx, cz, yaw + jit(0.03, seed, 1))
    return cushion(p, lambda x, y, z: g.pt(x, y0 + y, z), hx, hz, y1 - y0, color, seed, puff=puff)


def barrel(p, trim, a, b, r, color, seed, sides=8, hoops=(0.18, 0.82), sink=None, phase=0.0):
    """A barrel from its foot `a` to its head `b` (game-frame points): eight bellied staves (the
    oak's map runs down them), the head sunk inside its chime, iron hoops round its quarters
    (TavernTrim). `sink`: how far its staves run on down past its foot (a cask set into falling
    ground). Returns the head's middle and the axis."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    length = axis.length
    axis.normalize()
    ref = Vector((0.0, 1.0, 0.0)) if abs(axis.y) < 0.9 else Vector((1.0, 0.0, 0.0))
    u = axis.cross(ref).normalized()
    w = axis.cross(u).normalized()

    def surf(t):
        # the staves' line between the rings: the belly
        return r * (0.84 + 0.32 * min(t, 1.0 - t))

    def loop(c, rad, k):
        return [c + (u * math.cos(phase + math.tau * i / sides) + w * math.sin(phase + math.tau * i / sides))
                * rad * (1.0 + jit(0.012, seed, i, k)) for i in range(sides)]

    rings = []
    if sink:
        rings.append(loop(a - axis * sink, surf(0.0), 9))
    for k, t in enumerate((0.0, 0.5, 1.0)):
        rings.append(loop(a + axis * (length * t), surf(t), k))
    head = b - axis * 0.05
    rings.append(loop(head, r * 0.74, 3))
    # (its back end never shows: against the wall in a rack, in the ground under a cask)
    _, _, top = solid(p, rings, color, TIMBER, cap0=False)
    p.paint(top, K.tint(color, 0.8, seed, 4, spread=0.03), TIMBER)
    for k, t in enumerate(hoops):
        t0, t1 = t - 0.045, t + 0.045
        band = [loop(a + axis * (length * tt), surf(tt) + 0.026, 5 + k) for tt in (t0, t1)]
        solid(trim, band, IRON, METAL, cap0=False, cap1=False)
    return head, axis


def tap(p, at, out, seed):
    """A brass tap in a barrel's head: a round spout out of it, its nose bent down, and the key
    turned across its top."""
    at, out = Vector(at), Vector(out)
    down = Vector((0.0, -1.0, 0.0))
    p.sweep([at - out * 0.02, at + out * 0.13, at + out * 0.17 + down * 0.1], 0.042, 0.03, BRASS, sides=5, mat=METAL,
            up=tuple(out.cross(down)), phase=hash01(seed, 1))
    side = out.cross(down).normalized()
    key = at + out * 0.08 + Vector((0.0, 0.065, 0.0))
    lathe(p, key - side * 0.09, [(0.032, 0.09)], 4, GOLD, METAL, axis=tuple(side), tip0=0.0, tip1=0.18, phase=0.4)


# ---------------------------------------------------------------------------
# Faces nobody sees: a piece pressed to the floor, butted into a board or buried in its neighbour
# keeps only the faces a camera can reach (the trimmed solids are turned outward first, then
# leave the closed list: they are open now, and already face the right way)
# ---------------------------------------------------------------------------
def dropped(p, faces, gone):
    """A closed solid's faces turned outward, then `gone` (faces of it nobody can ever see)
    deleted; what is left of it leaves the closed list."""
    faces = [f for f in faces if f.is_valid]
    if not gone:
        return faces
    bmesh.ops.recalc_face_normals(p.bm, faces=faces)
    gone = [f for f in gone if f.is_valid]
    bmesh.ops.delete(p.bm, geom=gone, context='FACES')
    kept = [f for f in faces if f.is_valid]
    ks = set(kept)
    p.closed[:] = [f for f in p.closed if f.is_valid and f not in ks]
    return kept


def facing_most(faces, d):
    """The face of a solid looking most along game direction d."""
    d = Vector(d)
    return max(faces, key=lambda f: G(f.normal).dot(d))


def open_lump(p, c, size, color, mat, seed, rough=0.08, yaw=0.0, skip=()):
    """inn_kit's lump (the same corners pushed off true the same way) without the faces in `skip`:
    'bottom', 'top', '+x', '-x', '+z', '-z' in its own frame (x turned by yaw the three.js way)."""
    faces = K.lump(p, c, size, color, mat, seed=seed, rough=rough, yaw=yaw)
    if not skip:
        return faces
    bmesh.ops.recalc_face_normals(p.bm, faces=faces)
    X = Vector((math.cos(yaw), 0.0, -math.sin(yaw)))
    Z = Vector((math.sin(yaw), 0.0, math.cos(yaw)))
    Y = Vector((0.0, 1.0, 0.0))
    dirs = {'bottom': -Y, 'top': Y, '+x': X, '-x': -X, '+z': Z, '-z': -Z}
    return dropped(p, faces, [facing_most(faces, dirs[s]) for s in skip])


def open_hewn(p, a, b, w, h, color, mat, seed, open_ends=(True, True), **kw):
    """inn_kit's hewn timber with its end grain left off where it is buried (in a post, under a
    slab): open_ends says which of its two ends (a, b) go."""
    faces = K.hewn(p, a, b, w, h, color, mat, seed, **kw)
    gone = [f for f, o in zip(faces[-2:], open_ends) if o]
    return dropped(p, faces, gone)


# ---------------------------------------------------------------------------
# Turned wares (TavernClutter, and the candles of TavernLights): the cups, plates, bottles and
# candles are lathed round their axes, round where they are round (six to ten sides, smooth
# shaded), a lip where there is a lip, a well where there is a well, never a box; inn_lights.py
# and inn_interior.py turn their candles and pots here too
# ---------------------------------------------------------------------------
def axes(axis, ref=None):
    """An axis and two directions square to it (the first as near `ref` as it can be)."""
    a = Vector(axis).normalized()
    r = Vector(ref) if ref is not None else (Vector((1.0, 0.0, 0.0)) if abs(a.x) < 0.9 else Vector((0.0, 0.0, 1.0)))
    u = (r - a * r.dot(a)).normalized()
    return a, u, a.cross(u)


def lathe(p, c, prof, sides, color, mat, axis=(0.0, 1.0, 0.0), ref=None, phase=0.0, tip0=None, tip1=None, cap0=False,
          cap1=False, paint=None, push=None, squash=1.0, soft=True, tag=K.FLAT):
    """A turned shape round the axis through game point c. prof is its outline [(r, h), ...] from
    its foot (h along the axis) up its outside, over its lip and down into it as far as it goes;
    each end is left open (it stands on something, or is never seen), capped flat, or drawn to a
    point on the axis at h = tip0 or tip1 (a flame's tip, a dome, a liquid's middle). Every face
    looks out of the outline as it runs, so an open shape needs no turning after. paint(k, i)
    gives the (color, mat) of band k's side i (band k runs from outline point k to k + 1; the
    foot's fan is band -1, the top's len(prof) - 1); push(k, i) swells ring k's corner i (a run
    of wax, a spout). Its faces are FLAT (shiplib's finish() gives them no per-face wear or
    gradient), so their smooth shading carries their roundness unbroken."""
    c = Vector(c)
    a, u, w = axes(axis, ref)
    bm = p.bm
    angs = [phase + math.tau * i / sides for i in range(sides)]

    def radial(t):
        return u * math.cos(t) + w * (math.sin(t) * squash)

    rings = [[bm.verts.new(P(*(c + a * h + radial(t) * (r + (push(k, i) if push else 0.0)))))
              for i, t in enumerate(angs)] for k, (r, h) in enumerate(prof)]
    made = []

    def add(verts, band, i, want, smooth=True):
        try:
            f = bm.faces.new(verts)
        except ValueError:
            return
        f.normal_update()
        if f.normal.dot(P(*want)) < 0:
            f.normal_flip()
        f[p.soft] = 1 if soft and smooth else 0
        made.append((f, band, i))

    n = len(prof)
    for k in range(n - 1):
        (ra, ha), (rb, hb) = prof[k], prof[k + 1]
        for i in range(sides):
            j = (i + 1) % sides
            out = radial(phase + math.tau * (i + 0.5) / sides)
            add([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], k, i, out * (hb - ha) - a * (rb - ra))
    for first in (True, False):
        tip, cap = (tip0, cap0) if first else (tip1, cap1)
        ring = rings[0] if first else rings[-1]
        r, h = prof[0] if first else prof[-1]
        band = -1 if first else n - 1
        if tip is not None:
            t = bm.verts.new(P(*(c + a * tip)))
            for i in range(sides):
                j = (i + 1) % sides
                out = radial(phase + math.tau * (i + 0.5) / sides)
                add([ring[i], ring[j], t], band, i, out * (h - tip) - a * r if first else out * (tip - h) + a * r)
        elif cap:
            add(list(ring), band, 0, -a if first else a, smooth=False)
    for f, band, i in made:
        col, m = paint(band, i) if paint else (color, mat)
        p.paint([f], col, m, tag)
    return [f for f, _, _ in made]


def shade(c, k):
    return tuple(min(1.0, v * k) for v in c)


FLAME_HOT = (1.0, 0.92, 0.66)    # a flame's belly, near white
FLAME_TIP = (1.0, 0.63, 0.24)    # its tip


def flame(p, at, h, r, seed, sides=4, sway=0.06):
    """A flame on its wick at `at`: a teardrop of glow, its round belly low and its tip drawn up a
    hair off plumb (GLOW is unshaded: four sides keep its outline round from every side)."""
    h *= 1.0 + jit(0.1, seed, 1)
    axis = (jit(sway, seed, 2), 1.0, jit(sway, seed, 3))
    return lathe(p, at, [(r * 0.64, h * 0.1), (r, h * 0.32)], sides, FLAME_HOT, GLOW, axis=axis,
                 phase=hash01(seed, 4) * math.pi, tip0=-0.004, tip1=h,
                 paint=lambda k, i: (FLAME_TIP, GLOW) if k > 0 else (FLAME_HOT, GLOW))


def light_wicks(p, name, at, seed):
    """A flame on every wick of a candle piece from the props' atlas (inn_props.WICKS), placed by
    `at` (inn_props.frame()), its flames sized to the piece."""
    h, r, wicks = PR.WICKS[name]
    for k, wick in enumerate(wicks):
        flame(p, at(*wick), h * at.scale, r * at.scale, seed + k)


def candle(p, at, h, r, seed, sides=6, axis=(0.0, 1.0, 0.0), flame_h=None, dome=True, color=None, flame_sides=4):
    """A tallow candle stood at `at`: a touch narrower at its top, the top burnt down into a soft
    dome round its wick, a long run of wax down its side and a short one beside it, and its flame
    on the wick (the dome left off where it is never seen, high over the room). Returns the
    flame's foot."""
    at = Vector(at)
    a = Vector(axis).normalized()
    i0 = int(hash01(seed, 5) * sides) % sides
    i1 = (i0 + 2) % sides

    def push(k, i):
        if i == i0:
            return r * (0.2, 0.4)[k]
        if i == i1:
            return r * (0.0, 0.28)[k]
        return 0.0

    rise = r * 0.4 if dome else 0.0
    lathe(p, at, [(r, 0.0), (r * 0.88, h)], sides, color or K.tint(WAX, 1.0, seed, 6, spread=0.03), PLAIN, axis=a,
          phase=hash01(seed, 7) * math.tau, tip1=h + rise if dome else None, push=push)
    foot = at + a * (h + rise - 0.008)
    flame(p, foot, flame_h or r * 3.1, r * 0.7, seed + 3, sides=flame_sides)
    return foot


def bread_board(p, f, x, y, z, seed):
    """The props' round oak board with a crusty loaf, a wedge of cheese and a red apple on it
    (inn_props.py) set on a table at (x, z) in its frame f, turned anyhow."""
    prop = PR.PROPS['bread_board']
    PR.stand(p, prop, f.pt(x, y, z), f.yaw + hash01(seed, 1) * math.tau,
             BREAD_BOARD_W / prop['size'][0] * prop['size'][1])


def table_candles(p, f, x, y, z, seed):
    """The props' cluster of three candles melted onto an iron dish (inn_props.py) set on a table
    at (x, z) in its frame f, turned anyhow, a flame on every wick (TavernLights carry the room's
    light: these only glow)."""
    at = PR.stand(p, PR.PROPS['table_candles'], f.pt(x, y, z), f.yaw + hash01(seed, 1) * math.tau,
                  TABLE_CANDLES_H)
    light_wicks(p, 'table_candles', at, seed + 2)


def tankard(p, f, x, y, z, seed):
    """The props' oak tankard, its head of foam welling over the rim (inn_props.py), set at (x, z)
    in its frame f with its foot at y, its handle turned anyhow."""
    PR.stand(p, PR.PROPS['tankard'], f.pt(x, y, z), f.yaw + hash01(seed, 1) * math.tau, TANKARD_H)


def plate(p, f, x, y, z, seed, r=0.26, pewter=True):
    """A plate (pewter) or a trencher (oak): a broad rim turned up off its foot and the well sunk
    inside it. Returns the height its food sits at."""
    g = f.sub(x, z, hash01(seed, 1) * math.tau)
    color, mat = (PEWTER, METAL) if pewter else (K.tint(OAK, 0.98, seed, 2), TIMBER)
    well = shade(color, 0.9) if pewter else color
    lathe(p, g.pt(0.0, y, 0.0), [(r * 0.72, -0.003), (r, 0.032), (r * 0.8, 0.038)], 8, color, mat, tip1=0.014,
          phase=hash01(seed, 3), paint=lambda k, i: (well, mat) if k == 2 else (color, mat))
    return y + 0.014


def loaf(p, f, x, y, z, seed):
    """A round cob loaf, its sides pale and its crown browned."""
    g = f.sub(x, z, hash01(seed, 2) * math.pi)
    k = 1.0 + jit(0.08, seed, 1)

    def paint(b, i):
        if b <= 0:
            return K.tint(BREAD, 1.0, seed, 3, spread=0.04), PLAIN
        return (CRUST if b == 1 else shade(CRUST, 0.9)), PLAIN

    lathe(p, g.pt(0.0, y - 0.004, 0.0), [(0.14 * k, 0.0), (0.165 * k, 0.05), (0.11 * k, 0.115)], 7, BREAD, PLAIN,
          tip1=0.15 * k, squash=0.8, phase=hash01(seed, 4), paint=paint)


def cheese(p, f, x, y, z, seed):
    """A wheel of cheese with a wedge cut out of it, and the wedge set down by it."""
    g = f.sub(x, z, hash01(seed, 1) * math.tau)
    r, h, gap, n = 0.17, 0.12, 0.85, 7
    arc = [gap / 2 + (math.tau - gap) * i / (n - 1) for i in range(n)]
    plan = [(0.0, 0.0)] + [(math.cos(t) * r, math.sin(t) * r) for t in arc]
    bm = p.bm
    lo = [bm.verts.new(P(*g.pt(a, y - 0.003, b))) for a, b in plan]
    hi = [bm.verts.new(P(*g.pt(a * 0.97, y + h, b * 0.97))) for a, b in plan]
    faces = [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
    for i in range(len(plan)):
        j = (i + 1) % len(plan)
        faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    p.paint(faces, CHEESE, PLAIN, K.FLAT)
    p.paint(faces[3:len(plan) + 1], RIND, PLAIN, K.FLAT)     # the rind round the wheel's edge
    faces = dropped(p, faces, [faces[0]])        # (its underside on the plate)
    for fc in faces:
        fc[p.soft] = 0
    # the wedge, lying on its side by the wheel
    w = g.sub(0.32, -0.05, 0.6)
    tri = [(0.0, -0.05), (0.0, 0.05), (0.15, 0.0)]
    lo = [bm.verts.new(P(*w.pt(a, y - 0.003, b))) for a, b in tri]
    hi = [bm.verts.new(P(*w.pt(a, y + 0.1, b))) for a, b in tri]
    wf = [bm.faces.new(lo[::-1]), bm.faces.new(hi)] + [bm.faces.new((lo[i], lo[(i + 1) % 3], hi[(i + 1) % 3], hi[i]))
                                                     for i in range(3)]
    p.paint(wf, CHEESE, PLAIN, K.FLAT)
    p.paint(wf[2:3], RIND, PLAIN, K.FLAT)
    dropped(p, wf, [wf[0]])


def apples(p, f, x, y, z, seed, n=3):
    """Apples heaped on a plate: round, a little squat, their tops dimpled round the stalk."""
    for k in range(n):
        a = math.tau * k / n + hash01(seed, k)
        rr = 0.065 * (1.0 + jit(0.1, seed, k, 1))
        up = 0.075 if k == n - 1 and n > 3 else 0.0
        at = f.pt(x + math.cos(a) * 0.09 * (0.0 if up else 1.0), y + up - 0.006, z + math.sin(a) * 0.09 * (0.0 if up else 1.0))
        col = APPLES[(k + int(seed)) % 3]
        lathe(p, at, [(rr, rr * 0.62), (rr * 0.55, rr * 1.3)], 5, col, PLAIN, tip0=rr * 0.02, tip1=rr * 1.14,
              axis=(jit(0.25, seed, k, 2), 1.0, jit(0.25, seed, k, 3)), phase=hash01(seed, k, 4) * math.tau,
              paint=lambda b, i, col=col: (shade(col, 1.18) if b >= 1 else col, PLAIN))


def bottle(p, f, x, y, z, seed, color, h=0.42, r=0.085, sides=6, lip=True):
    """A bottle: its body, its shoulder drawn in to a long neck, the lip rolled at its mouth and a
    cork stopping it."""
    g = f.sub(x, z, hash01(seed, 1) * math.tau)
    prof = [(r, -0.003), (r * 1.02, h * 0.56), (r * 0.36, h * 0.74), (r * 0.32, h * 0.9)]
    if lip:
        prof.append((r * 0.44, h * 0.92))
    n = len(prof)
    lathe(p, g.pt(0.0, y, 0.0), prof, sides, color, PLAIN, tip1=h, phase=hash01(seed, 2) * math.tau,
          paint=lambda k, i: (CORK, PLAIN) if k == n - 1 else (color, PLAIN))


def ale_jug(p, f, x, y, z, seed):
    """The props' stoneware ale jug, its glaze run down its belly and its cork in (inn_props.py),
    set on a table at (x, z) in its frame f, its handle turned anyhow."""
    PR.stand(p, PR.PROPS['ale_jug'], f.pt(x, y, z), f.yaw + hash01(seed, 1) * math.tau, ALE_JUG_H)


# ---------------------------------------------------------------------------
# The furniture
# ---------------------------------------------------------------------------
KINDS = {'bench': 'bench', 'roundTable': 'round_table', 'stool': 'stool', 'table': 'table', 'settle': 'settle',
         'chest': 'chest', 'chair': 'chair', 'barrels': 'barrels', 'cask': 'cask'}


class Furnisher:
    def __init__(self, B, parts):
        self.B = B
        self.L = B.LAYOUT
        self.f = parts['TavernFurnishings']
        self.t = parts['TavernTrim']
        self.c = parts['TavernClutter']

    def build(self):
        mine = [(p, len(p.closed)) for p in (self.f, self.t, self.c)]
        for q in self.L['props']:
            make = KINDS.get(q['kind'])
            if make:
                getattr(self, make)(q, seed_of(q))
        self.clutter()
        # every solid here faces out from the start (the kit's blocks and beams wind inward
        # until shiplib's finish() turns them): the paint lays its maps and the warm bake lights
        # each face by its normal before that
        for p, n in mine:
            faces = [f for f in p.closed[n:] if f.is_valid]
            if faces:
                bmesh.ops.recalc_face_normals(p.bm, faces=faces)

    # ================================================================ benches
    def bench(self, q, s):
        pit, T = self.L['pit'], self.B.TOWER
        if math.hypot(q['x'] - pit['x'], q['z'] - pit['z']) < pit['r']:
            self.hearth_bench(q, s)
        elif math.hypot(q['x'] - T['x'], q['z'] - T['z']) < T['rIn']:
            self.nook_bench(q, s)
        elif q['z'] > self.B.HALL['z1']:
            self.porch_bench(q, s)
        else:
            self.board_bench(q, s)

    def hearth_bench(self, q, s):
        """A bench round the fire (five ring the hearth in the pit): a thick oak board bowed to
        follow the ring, on two splayed slab ends with a stretcher through them (TavernTrim), and
        a garnet cushion for each of its two sitters. It faces the fire on its -z, its board at
        base + height and the cushions BENCH_CUSHION over it."""
        f = Spot.of(q, wobble=jit(0.012, s, 0.1))
        L, D = q['hw'], q['hd']
        b = q['base']
        board = b + q['height']
        seat = board + BENCH_CUSHION
        bow = 0.14

        def zc(u):
            # the bench's middle line, bowed round the fire: its ends come round toward the pit
            return bow * (0.5 - (u / L) ** 2)

        rings = []
        for k, u in enumerate((-L, -L / 3, L / 3, L)):
            d = D - 0.015 - (0.035 if k in (0, 3) else 0.0)
            uu = u + jit(0.03, s, k, 1)
            c = zc(u)
            y1 = board + jit(0.008, s, k, 2)
            rings.append([f.pt(uu, board - 0.13, c - d), f.pt(uu, board - 0.13, c + d), f.pt(uu, y1, c + d - 0.04),
                          f.pt(uu, y1, c - d + 0.04)])
        solid(self.f, rings, K.tint(WORN, 0.9, s, 1), TIMBER, soft=False)
        # the slab ends, splayed out under the board, a notch cut up between their two feet
        y0, y1 = b - 0.02, board - 0.13
        for sx in (-1, 1):
            prof = [(-0.34, y0), (-0.13, y0), (jit(0.03, s, 2, sx), y0 + 0.17), (0.13, y0), (0.34, y0), (0.27, y1),
                    (-0.27, y1)]
            rings = []
            for d in (-1, 1):
                pts = []
                for (w, y) in prof:
                    t = (y - y0) / (y1 - y0)
                    u = sx * (1.0 - 0.12 * t) + d * (0.09 - 0.015 * t)
                    pts.append(f.pt(u, y, zc(abs(u)) + w))
                rings.append(pts)
            sides, e0, e1 = solid(self.f, rings, K.tint(OAK, 0.82, s, 2, sx), TIMBER, soft=False)
            # (their feet's soles on the floor and their tops under the board are never seen)
            dropped(self.f, sides + e0 + e1, [sides[0], sides[3], sides[5]])
        # the stretcher through the ends, its tenons standing proud of them
        y = b + 0.3
        K.hewn(self.t, f.pt(-1.1, y, zc(0.95)), f.pt(1.1, y, zc(0.95)), 0.11, 0.13, K.tint(OAK, 0.62, s, 3), TIMBER,
               seed=s + 3, segs=1)
        for k, u in enumerate((-0.65, 0.65)):
            slope = -2.0 * bow * u / L ** 2
            seat_cushion(self.f, f, u + jit(0.04, s, 4, k), zc(u) - 0.03, 0.57, 0.32, board, seat,
                         K.tint(GARNET, 0.95, s, 5, k), s + 5 + k, yaw=-math.atan(slope))

    def nook_bench(self, q, s):
        """A run of the nook's bench round the tower (five runs, their backs to the stone): a
        thick board on a boarded front and two end boards, a cushion for each of its two sitters
        and a bolster at their backs against the wall. Its sitters face the tower's middle on its
        -z, the stone behind its +z; the cushions BENCH_CUSHION over the board."""
        f = Spot.of(q, wobble=jit(0.01, s, 0.1))
        L, D = q['hw'], q['hd']
        b = q['base']
        board = b + q['height']
        seat = board + BENCH_CUSHION
        slab(self.f, f, -L, L, -D, D - 0.03, board - 0.13, board, K.tint(OAK, 0.98, s, 1), s + 1, corner=0.07,
             belly=False)
        h = board - 0.13 - b
        # (inside the bench, on the floor and under the board, the boards show no faces)
        lump(self.f, f, (0.0, b + h / 2, -D + 0.11), (2 * L - 0.18, h, 0.1), K.tint(OAK, 0.74, s, 2), s + 2, rough=0.05,
             skip=('bottom', 'top', '+z', '-x', '+x'))
        # its front: a dark kick, and a raised panel under each sitter
        lump(self.f, f, (0.0, b + 0.05, -D + 0.08), (2 * L - 0.16, 0.1, 0.1), K.tint(OAK, 0.5, s, 12), s + 12,
             rough=0.05, skip=('bottom', '+z'))
        for k, u in enumerate((-0.88, 0.88)):
            lump(self.f, f, (u + jit(0.03, s, 13, k), b + 0.42, -D + 0.05), (1.45, h - 0.36, 0.05),
                 K.tint(OAK, 0.9, s, 14, k), s + 14 + k, rough=0.1, skip=('+z',))
        for sx in (-1, 1):
            lump(self.f, f, (sx * (L - 0.08), b + h / 2, 0.02), (0.13, h, 2 * D - 0.12), K.tint(OAK, 0.62, s, 3, sx),
                 s + 3 + sx, rough=0.06, skip=('bottom', 'top', '+x' if sx < 0 else '-x'))
        for k, u in enumerate((-0.85, 0.85)):
            seat_cushion(self.f, f, u + jit(0.05, s, 4, k), -0.05, 0.74, 0.31, board, seat,
                         K.tint(GARNET, 0.92, s, 5, k), s + 5 + k, yaw=jit(0.04, s, 6, k))
            # the bolster against the stone behind each sitter
            y = seat + 0.11
            a = f.pt(u - 0.56 + jit(0.04, s, 7, k), y, D - 0.15)
            c = f.pt(u + 0.56 + jit(0.04, s, 8, k), y + jit(0.025, s, 9, k), D - 0.15 + jit(0.03, s, 10, k))
            self.f.cylinder(tuple(a), tuple(c), 0.135, K.tint(GARNET, 0.78, s, 11, k), CLOTH, sides=5,
                            phase=hash01(s, k))

    def board_bench(self, q, s):
        """A bench at the long table: a thick plank on two pairs of splayed legs, a rail under the
        plank over each pair and a rung low between them (TavernTrim). Plain oak at the chairs'
        0.9 and backless: its sitters face the table beside it."""
        spin = 0.0 if q['hw'] >= q['hd'] else math.pi / 2
        f = Spot.of(q, spin=spin, wobble=jit(0.008, s, 0.1))
        L, D = max(q['hw'], q['hd']), min(q['hw'], q['hd'])
        b = q['base']
        top = b + q['height']
        slab(self.f, f, -L, L, -D, D, top - 0.15, top, K.tint(WORN, 0.9, s, 1), s + 1, corner=0.09)
        for k, su in enumerate((-1, 1)):
            u = su * (L - 0.5)
            legs = []
            for sw in (-1, 1):
                seg = ((u + su * 0.11, b - 0.01, sw * (D - 0.05)), (u, top - 0.2, sw * (D - 0.17)))
                leg(self.f, f, seg[0], seg[1], 0.1, K.tint(OAK, 0.84, s, 2, k, sw), s + 3 + k * 2 + sw)
                legs.append(seg)
            lump(self.f, f, (u, top - 0.2, 0.0), (0.15, 0.11, 2 * D - 0.1), K.tint(OAK, 0.68, s, 4, k), s + 5 + k,
                 rough=0.06, skip=('top',))
            y = b + 0.28
            a, c = along(legs[0], y), along(legs[1], y)
            K.hewn(self.t, f.pt(a[0], y, a[2] - 0.05), f.pt(c[0], y, c[2] + 0.05), 0.08, 0.1,
                   K.tint(OAK, 0.6, s, 6, k), TIMBER, seed=s + 6 + k, segs=1)

    def porch_bench(self, q, s):
        """The porch's bench against the front wall left of the door, facing the road: a split
        log of grey-weathered oak on four splayed pegs, plain at the chairs' 0.9."""
        f = Spot.of(q, wobble=jit(0.02, s, 0.1))
        L, D = q['hw'], q['hd']
        b = q['base']
        top = b + q['height']
        slab(self.f, f, -L, L, -D, D, top - 0.17, top, K.tint(WEATHERED, 0.9, s, 1), s + 1, corner=0.15, wob=0.03,
             ease=0.05)
        for k, (sx, sz) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            leg(self.f, f, (sx * (L - 0.08), b - 0.02, sz * (D - 0.07)), (sx * (L - 0.2), top - 0.15, sz * (D - 0.15)),
                0.07, K.tint(WEATHERED, 0.68, s, 2, k), s + 3 + k, sides=6, swell=0.08, taper=0.92)

    # ================================================================ settles
    def settle(self, q, s):
        """A high-backed settle (the booths' and the one facing the wall fire): a boxed carcass
        with a kick and raised panels across its front, a seat board between two shaped wings
        whose tops sweep down from the back into the arms, a long garnet cushion, and a back of
        upright boards leaning back a little under a heavy capping rail that rises to its middle.
        Its sitters face its +z, the board's lip out at hd + SETTLE_LIP, the cushion's crown
        SETTLE_CUSHION over the board; the rail tops out under CLEAR."""
        f = Spot.of(q, wobble=jit(0.006, s, 0.1))
        L, D = q['hw'], q['hd']
        b = q['base']
        board = b + q['height']
        seat = board + SETTLE_CUSHION
        lip = D + SETTLE_LIP
        wing = 0.13                       # the wings' thickness
        xi = L - wing                     # the wings' inner faces
        rail = min(b + 2.62, CLEAR - 0.23)  # the capping rail's line at its ends (its top under CLEAR)
        lean = 0.05                       # how far the back leans back by its top
        back = -D + 0.02                  # the back boards' rear face over the seat
        h = board - 0.13 - b
        # the carcass and its kick, the raised panels across its front
        # (the faces of them on the floor, under the seat, inside the wings and behind the panels
        # are never seen)
        lump(self.f, f, (0.0, b + h / 2, -0.03), (2 * xi + 0.02, h, 2 * D - 0.1), K.tint(OAK, 0.78, s, 1), s + 1,
             rough=0.03, skip=('bottom', 'top', '-x', '+x'))
        lump(self.f, f, (0.0, b + 0.055, D - 0.08), (2 * xi + 0.02, 0.11, 0.14), K.tint(OAK, 0.52, s, 2), s + 2,
             rough=0.05, skip=('bottom', '-z', '-x', '+x'))
        n = 2 if L < 1.4 else 3
        pw = (2 * xi - 0.1) / n
        for i in range(n):
            x = -xi + 0.05 + pw * (i + 0.5)
            lump(self.f, f, (x, b + 0.41, D - 0.06), (pw - 0.15, h - 0.36, 0.06), K.tint(OAK, 0.9, s, 3, i), s + 3 + i,
                 rough=0.1, skip=('-z',))
        # the seat board, its lip out over the front, and the cushion on it (its ends butt the wings)
        sides, e0, e1 = slab(self.f, f, -xi, xi, back + 0.06, lip, board - 0.13, board, K.tint(WORN, 0.86, s, 4), s + 4,
                             corner=0.05, belly=False)
        dropped(self.f, sides + e0 + e1, [sides[2], sides[6]])
        seat_cushion(self.f, f, jit(0.03, s, 5), 0.09, xi - 0.07, 0.35, board, seat, K.tint(GARNET, 0.95, s, 6), s + 6,
                     puff=0.04)
        # the back's upright boards, leaning back over the seat
        nb = 3 if L < 1.4 else 4
        bw = 2 * xi / nb
        for i in range(nb):
            x0, x1 = -xi + bw * i + 0.012, -xi + bw * (i + 1) - 0.012
            y0, y1 = board - 0.05, rail - 0.03 + jit(0.03, s, 7, i)
            z0, z1 = back, back + 0.12
            block(self.f, f, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1),
                              (x0, y1, z0 - lean), (x1, y1, z0 - lean), (x1, y1, z1 - lean), (x0, y1, z1 - lean)],
                  K.tint(OAK, 0.92 + jit(0.07, s, 8, i), s, 9, i), s + 9 + i, rough=0.012, skip=('bottom',))
        # two ledges nailed across the boards' backs (a booth's back is half the room's view of it)
        for k, v in enumerate((board + 0.32, rail - 0.4)):
            t = (v - board + 0.05) / (rail - board + 0.02)
            lump(self.f, f, (jit(0.03, s, 15, k), v, back - 0.025 - lean * t), (2 * xi - 0.14, 0.17, 0.05),
                 K.tint(OAK, 0.66, s, 16, k), s + 16 + k, rough=0.06, yaw=jit(0.005, s, 17, k), skip=('+z',))
        # the capping rail across the boards' tops, rising a little to its middle
        zr = back + 0.075 - lean
        K.hewn(self.f, f.pt(-L - 0.03, rail, zr), f.pt(L + 0.03, rail, zr), 0.2, 0.17, K.tint(OAK, 0.7, s, 10),
               TIMBER, seed=s + 10, sag=-0.04, segs=3, wander=0.015)
        # the wings: shaped side boards from the floor up to the rail, their tops sweeping down
        # from the back into the arms, a chunky cap on each arm
        arm = board + 0.5
        for sx in (-1, 1):
            xc = sx * (L - wing / 2)
            prof = [(back - 0.04, b), (lip, b), (lip, arm), (0.02, arm + 0.02), (-0.24, arm + 0.44),
                    (back + 0.06 - lean, rail - 0.12), (back - 0.04 - lean, rail + 0.02)]
            prof = [(z + (jit(0.015, s, 11, sx, k) if 1 < k < 6 else 0.0),
                     y + (jit(0.025, s, 12, sx, k) if k > 2 else 0.0)) for k, (z, y) in enumerate(prof)]
            rings = [[f.pt(xc + d, y, z) for (z, y) in prof] for d in (-wing / 2, wing / 2)]
            sides, e0, e1 = solid(self.f, rings, K.tint(OAK, 0.84, s, 13, sx), TIMBER, soft=False)
            # (its sole on the floor and the arm's top under its cap)
            dropped(self.f, sides + e0 + e1, [sides[0], sides[2]])
            lump(self.f, f, (xc, arm + 0.075, (lip + 0.01 - 0.04) / 2), (0.21, 0.11, lip + 0.05),
                 K.tint(OAK, 0.62, s, 14, sx), s + 14 + sx, rough=0.06)

    # ================================================================ tables
    def table(self, q, s):
        if max(q['hw'], q['hd']) > 1.5:
            self.trestle_table(q, s)
        else:
            self.leg_table(q, s)

    def trestle_table(self, q, s):
        """The long table by the left wall: a thick top of pale, worn oak on two trestles (a heavy
        foot, a bellied post, a bearer under the top), and a stretcher through the posts held by
        its wedges (TavernTrim)."""
        spin = 0.0 if q['hw'] >= q['hd'] else math.pi / 2
        f = Spot.of(q, spin=spin, wobble=jit(0.008, s, 0.1))
        L, D = max(q['hw'], q['hd']), min(q['hw'], q['hd'])
        b = q['base']
        top = b + q['height']
        planks(self.f, f, L, D, top - 0.2, top, 3, K.tint(WORN, 0.96, s, 1), s + 1, corner=0.1)
        ut = L - 0.7
        for k, su in enumerate((-1, 1)):
            u = su * ut
            block(self.f, f, [(u - 0.17, b - 0.01, -D + 0.05), (u + 0.17, b - 0.01, -D + 0.05),
                              (u + 0.17, b - 0.01, D - 0.05), (u - 0.17, b - 0.01, D - 0.05),
                              (u - 0.12, b + 0.25, -D + 0.25), (u + 0.12, b + 0.25, -D + 0.25),
                              (u + 0.12, b + 0.25, D - 0.25), (u - 0.12, b + 0.25, D - 0.25)],
                  K.tint(OAK, 0.66, s, 2, k), s + 2 + k, skip=('bottom',))
            leg(self.f, f, (u, b + 0.2, 0.0), (u + jit(0.03, s, 3, k), top - 0.33, jit(0.03, s, 4, k)), 0.18,
                K.tint(OAK, 0.84, s, 5, k), s + 5 + k, swell=0.12, taper=0.86, at=0.45)
            block(self.f, f, [(u - 0.11, top - 0.37, -D + 0.24), (u + 0.11, top - 0.37, -D + 0.24),
                              (u + 0.11, top - 0.37, D - 0.24), (u - 0.11, top - 0.37, D - 0.24),
                              (u - 0.11, top - 0.2, -D + 0.08), (u + 0.11, top - 0.2, -D + 0.08),
                              (u + 0.11, top - 0.2, D - 0.08), (u - 0.11, top - 0.2, D - 0.08)],
                  K.tint(OAK, 0.7, s, 6, k), s + 6 + k, skip=('top',))
        # the stretcher through the posts and the wedges that hold it
        y = b + 0.55
        K.hewn(self.t, f.pt(-ut - 0.26, y, 0.0), f.pt(ut + 0.26, y, 0.0), 0.12, 0.19, K.tint(OAK, 0.62, s, 7), TIMBER,
               seed=s + 7, segs=1)
        for k, su in enumerate((-1, 1)):
            lump(self.t, f, (su * (ut + 0.2), y + 0.03, 0.0), (0.07, 0.32, 0.1), K.tint(OAK, 0.5, s, 8, k), s + 8 + k,
                 rough=0.15)

    def leg_table(self, q, s):
        """A four-legged table (the booths', the square one by the door): a thick top, an apron
        rail along each long side under it, four stout legs splayed a little and bellied (turned
        on the square table), a stretcher low along each long side of a booth's (TavernTrim)."""
        square = abs(q['hw'] - q['hd']) < 1e-6
        spin = 0.0 if q['hw'] >= q['hd'] else math.pi / 2
        f = Spot.of(q, spin=spin, wobble=jit(0.01, s, 0.1))
        L, D = max(q['hw'], q['hd']), min(q['hw'], q['hd'])
        b = q['base']
        top = b + q['height']
        planks(self.f, f, L, D, top - 0.18, top, 3 if square else 2, K.tint(WORN, 0.94, s, 1), s + 1,
               corner=0.12 if square else 0.08)
        for k, sw in enumerate((-1, 1)):
            lump(self.f, f, (0.0, top - 0.26, sw * (D - 0.18)), (2 * L - 0.46, 0.17, 0.09), K.tint(OAK, 0.7, s, 2, k),
                 s + 2 + k, rough=0.05, skip=('top',))
        legs = []
        for k, (su, sw) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            seg = ((su * (L - 0.13), b - 0.01, sw * (D - 0.11)), (su * (L - 0.22), top - 0.17, sw * (D - 0.18)))
            if square:
                leg(self.f, f, seg[0], seg[1], 0.12, K.tint(OAK, 0.84, s, 3, k), s + 3 + k, sides=6, swell=0.32,
                    taper=0.78, at=0.28)
            else:
                leg(self.f, f, seg[0], seg[1], 0.13, K.tint(OAK, 0.84, s, 3, k), s + 3 + k, swell=0.15)
            legs.append(seg)
        if not square:
            y = b + 0.36
            for k, (i, j) in enumerate(((0, 1), (3, 2))):
                a, c = along(legs[i], y), along(legs[j], y)
                # (its ends are in the legs)
                open_hewn(self.t, f.pt(*a), f.pt(*c), 0.09, 0.11, K.tint(OAK, 0.6, s, 4, k), TIMBER, seed=s + 4 + k,
                          segs=1)

    def round_table(self, q, s):
        """A round table on a pedestal (the dice table by the door, the nook's two): a thick top,
        never quite round, its edge eased; a bellied pedestal on splayed feet, two bearers
        crossed under the top."""
        f = Spot.of(q, wobble=jit(0.3, s, 0.1))
        r, b = q['r'], q['base']
        top = b + q['height']
        n = 10 if r > 1.0 else 8
        rings = [ring(f, 0.0, y, 0.0, r + d, r + d, n, wob=0.02, seed=s) for (y, d) in
                 ((top - 0.2, -0.04), (top - 0.09, -0.005), (top, -0.05))]
        solid(self.f, rings, K.tint(WORN, 0.94, s, 1), TIMBER)
        col = [(b + 0.16, 0.25), (b + 0.5, 0.16), (b + 0.84, 0.22), (top - 0.27, 0.15)]
        sides, e0, e1 = solid(self.f, [ring(f, jit(0.02, s, 2, k), y, jit(0.02, s, 3, k), rr, rr, 6, 0.3, wob=0.05,
                                            seed=s + 1) for k, (y, rr) in enumerate(col)], K.tint(OAK, 0.84, s, 4), TIMBER)
        dropped(self.f, sides + e0 + e1, e0 + e1)     # (its foot on the floor, its head under the bearers)
        nf = 4 if r > 1.0 else 3
        reach = r * 0.8
        for k in range(nf):
            g = f.sub(0.0, 0.0, math.tau * (k + 0.5) / nf + jit(0.12, s, 5, k))
            block(self.f, g, [(0.05, b - 0.01, -0.14), (reach, b - 0.01, -0.1), (reach, b - 0.01, 0.1),
                              (0.05, b - 0.01, 0.14), (0.05, b + 0.38, -0.11), (reach, b + 0.17, -0.08),
                              (reach, b + 0.17, 0.08), (0.05, b + 0.38, 0.11)], K.tint(OAK, 0.66, s, 6, k), s + 6 + k,
                  skip=('bottom', '-x'))
        for k in range(2):
            lump(self.f, f, (0.0, top - 0.27, 0.0), (2 * r * 0.72, 0.12, 0.15), K.tint(OAK, 0.68, s, 7, k), s + 7 + k,
                 rough=0.08, yaw=k * math.pi / 2 + 0.4, skip=('top',))

    # ================================================================ stools, chairs
    def stool(self, q, s):
        """A stool: a thick round seat on splayed legs (three on the floor and the stage; four on
        the bar's tall ones, a footrest rung across the front and the back of them, TavernTrim).
        Its seat at base + height."""
        tall = q['height'] > 0.95
        f = Spot.of(q, wobble=jit(0.1 if tall else 0.5, s, 0.1))
        r, b = q['r'], q['base']
        seat = b + q['height']
        n = 4 if tall else 3
        rims = ((seat - 0.13, r - 0.025), (seat + jit(0.008, s, 1), r - 0.06))
        solid(self.f, [ring(f, 0.0, y, 0.0, rr, rr, 8, 0.2, wob=0.03, seed=s) for (y, rr) in rims],
              K.tint(WORN, 0.9, s, 2), TIMBER)
        legs = []
        for k in range(n):
            a = math.tau * (k + 0.5) / n + jit(0.15, s, 3, k)
            seg = ((math.cos(a) * (r - 0.085), b - 0.01, math.sin(a) * (r - 0.085)),
                   (math.cos(a) * 0.19, seat - 0.12, math.sin(a) * 0.19))
            leg(self.f, f, seg[0], seg[1], 0.095 if tall else 0.1, K.tint(OAK, 0.82, s, 4, k), s + 4 + k, swell=0.15)
            legs.append(seg)
        if tall:
            # the footrest: a rung across its front (toward the counter, where its sitter faces) and
            # one across its back
            y = b + 0.4
            for k in (0, 2):
                a, c = along(legs[k], y), along(legs[(k + 1) % n], y + jit(0.03, s, 5, k))
                open_hewn(self.t, f.pt(*a), f.pt(*c), 0.07, 0.08, K.tint(OAK, 0.6, s, 6, k), TIMBER, seed=s + 6 + k,
                          segs=1)

    def chair(self, q, s):
        """A chair at the square table: a thick seat, stout legs, the back legs running on up into
        posts raked back, an arched top rail and a garnet pad (or three slats) between the posts.
        Its sitter faces its +z (the table), its seat at base + height, its back on -z."""
        f = Spot.of(q, wobble=jit(0.025, s, 0.1))
        r, b = q['r'], q['base']
        seat = b + q['height']
        hs = r - 0.03
        slab(self.f, f, -hs, hs, -hs + 0.03, hs, seat - 0.13, seat, K.tint(WORN, 0.88, s, 1), s + 1, corner=0.14,
             belly=False)
        for k, sx in enumerate((-1, 1)):
            leg(self.f, f, (sx * (hs - 0.07), b - 0.01, hs - 0.07), (sx * (hs - 0.13), seat - 0.12, hs - 0.13), 0.095,
                K.tint(OAK, 0.82, s, 2, k), s + 2 + k, swell=0.18)
        # the back legs, on up into the posts
        for k, sx in enumerate((-1, 1)):
            line = [(sx * (hs - 0.07), b - 0.01, -hs + 0.08, 0.09), (sx * (hs - 0.12), seat - 0.12, -hs + 0.12, 0.1),
                    (sx * (hs - 0.11), seat + 0.55, -hs + 0.04, 0.085),
                    (sx * (hs - 0.1), seat + 1.2, -hs - 0.02, 0.075)]
            rings = []
            for j, (x, y, z, rr) in enumerate(line):
                rings.append([f.pt(x + math.cos(math.tau * (i + 0.5) / 4) * rr * (1.0 + jit(0.06, s, 3, k, j, i)), y,
                                   z + math.sin(math.tau * (i + 0.5) / 4) * rr) for i in range(4)])
            sides, e0, e1 = solid(self.f, rings, K.tint(OAK, 0.82, s, 4, k), TIMBER, soft=False)
            dropped(self.f, sides + e0 + e1, e0)     # (its foot on the floor)
        # the top rail, arched; under it a garnet pad, or (no two pairs of chairs from the same
        # hand) three slats leaning back with the posts
        K.hewn(self.f, f.pt(-hs - 0.02, seat + 1.13, -hs - 0.02), f.pt(hs + 0.02, seat + 1.13, -hs - 0.02), 0.13, 0.2,
               K.tint(OAK, 0.64, s, 5), TIMBER, seed=s + 5, sag=-0.06, segs=2, wander=0.01)
        if abs(math.sin(q['rot'])) > 0.5:
            for k, x in enumerate((-0.17, 0.0, 0.17)):
                x0, x1 = x - 0.055, x + 0.055
                y0, y1 = seat - 0.02, seat + 1.06
                z0, z1 = -hs + 0.07, -hs - 0.01
                block(self.f, f, [(x0, y0, z0 - 0.025), (x1, y0, z0 - 0.025), (x1, y0, z0 + 0.025),
                                  (x0, y0, z0 + 0.025), (x0, y1, z1 - 0.025), (x1, y1, z1 - 0.025),
                                  (x1, y1, z1 + 0.025), (x0, y1, z1 + 0.025)],
                      K.tint(OAK, 0.86, s, 6, k), s + 6 + k, rough=0.012, skip=('bottom', 'top'))
            return
        th = 0.1
        yc, zc = seat + 0.62, -hs + 0.05

        def to(x, y, z):
            return f.pt(x, yc + z * math.cos(th) + y * math.sin(th), zc - z * math.sin(th) + y * math.cos(th))

        cushion(self.f, to, hs - 0.17, 0.3, 0.09, K.tint(GARNET, 0.9, s, 6), s + 6, puff=0.03, closed=True)

    # ================================================================ the stage's chest
    def chest(self, q, s):
        """The costume chest on the stage: a dark plinth, an oak body, a domed lid, two iron
        bands over the lid and down its front and a brass lock (TavernTrim)."""
        f = Spot.of(q, wobble=jit(0.01, s, 0.1))
        hw, hd, b = q['hw'], q['hd'], q['base']
        top = b + q['height']
        seam = b + 0.6
        lump(self.f, f, (0.0, b + 0.05, 0.0), (2 * hw - 0.02, 0.1, 2 * hd - 0.02), K.tint(OAK, 0.5, s, 1), s + 1,
             rough=0.04, skip=('bottom',))
        block(self.f, f, [(-hw + 0.05, b + 0.08, -hd + 0.05), (hw - 0.05, b + 0.08, -hd + 0.05),
                          (hw - 0.05, b + 0.08, hd - 0.05), (-hw + 0.05, b + 0.08, hd - 0.05),
                          (-hw + 0.03, seam, -hd + 0.03), (hw - 0.03, seam, -hd + 0.03),
                          (hw - 0.03, seam, hd - 0.03), (-hw + 0.03, seam, hd - 0.03)], K.tint(OAK, 0.84, s, 2), s + 2,
              skip=('bottom', 'top'))
        prof = [(hd - 0.01, seam - 0.01), (hd - 0.01, seam + 0.1), (hd * 0.62, top - 0.08), (0.0, top),
                (-hd * 0.62, top - 0.08), (-hd + 0.01, seam + 0.1), (-hd + 0.01, seam - 0.01)]
        sides, e0, e1 = solid(self.f, [[f.pt(x, y, z) for (z, y) in prof] for x in (-hw + 0.01, hw - 0.01)],
                              K.tint(OAK, 0.78, s, 3), TIMBER)
        dropped(self.f, sides + e0 + e1, [sides[-1]])     # (its underside, down on the body)
        for x in (-hw * 0.56, hw * 0.56):
            band = [(z + z / hd * 0.025, y + (0.025 if y > seam + 0.05 else 0.0)) for (z, y) in prof]
            solid(self.t, [[f.pt(xx, y, z) for (z, y) in band] for xx in (x - 0.055, x + 0.055)], IRON, METAL,
                  soft=False)
        lump(self.t, f, (0.0, seam - 0.05, hd - 0.01), (0.17, 0.22, 0.05), BRASS, s + 6, mat=METAL, rough=0.1)

    # ================================================================ the bar's barrel racks
    def barrels(self, q, s):
        """A barrel rack against the back wall behind the bar: an oak frame (posts at its bays'
        edges, cradle rails under each tier, a heavy top shelf with a fascia under it, braced
        ends) holding two tiers of the props' painted barrel (inn_props.py) on their sides, their
        heads to the room, brass taps in the lower tier's (and the odd keg's), a pair of small kegs
        in place of a barrel in one bay of the top tier. Its back stands to the wall on -z; the
        barrels run on back into it."""
        f = Spot.of(q, wobble=jit(0.003, s, 0.1))
        hw, hd, b = q['hw'], q['hd'], q['base']
        top = b + q['height']
        n = max(1, int(round(2 * hw / 1.75)))
        bay = 2 * hw / n
        dark = K.tint(OAK, 0.6, s, 1)
        zf, zb = hd - 0.16, -hd + 0.12      # the front and the back posts' lines
        r_lo = min(0.64, bay / 2 - 0.12)
        y_rail = b + 0.32                   # the lower cradle rails' tops
        y_lo = y_rail + 0.86 * r_lo
        y_mid = y_lo + r_lo + 0.18          # the upper cradle rails' tops
        r_hi, r_keg = min(0.58, bay / 2 - 0.16), min(0.38, bay / 4 - 0.07)
        lump(self.f, f, (0.0, b + 0.1, 0.0), (2 * hw, 0.2, 2 * hd - 0.1), dark, s + 2, rough=0.03, skip=('bottom',))
        slab(self.f, f, -hw - 0.05, hw + 0.05, -hd + 0.02, hd + 0.05, top - 0.26, top, K.tint(OAK, 0.86, s, 3), s + 3,
             corner=0.08, ease=0.05)
        lump(self.f, f, (0.0, top - 0.37, zf + 0.08), (2 * hw - 0.08, 0.3, 0.08), K.tint(OAK, 0.7, s, 4), s + 4,
             rough=0.06)
        up = tuple(f.vec(0.0, 0.0, 1.0))
        for i in range(n + 1):
            x = -hw + bay * i + (0.11 if i == 0 else -0.11 if i == n else 0.0)
            head = f.pt(x + jit(0.05, s, 5, i), top - 0.24, zf + jit(0.03, s, 5.5, i))
            # (each post's foot is in the base and its head in the shelf)
            open_hewn(self.f, f.pt(x, b + 0.18, zf), head, 0.2, 0.2,
                      K.tint(OAK, 0.8, s, 6, i), TIMBER, seed=s + 6 + i, up=up, wander=0.02)
            if i in (0, n):
                open_hewn(self.f, f.pt(x, b + 0.18, zb), f.pt(x, top - 0.2, zb), 0.2, 0.2, K.tint(OAK, 0.66, s, 7, i),
                          TIMBER, seed=s + 7 + i, up=up, wander=0.02)
                # a brace across the end
                K.hewn(self.f, f.pt(x, b + 0.4, zb + 0.1), f.pt(x, y_mid - 0.1, zf - 0.1), 0.12, 0.16,
                       K.tint(OAK, 0.62, s, 8, i), TIMBER, seed=s + 8 + i, segs=1, up=tuple(f.vec(1.0, 0.0, 0.0)))
        for k, y in enumerate((y_rail, y_mid)):
            for j, z in enumerate((zf, zb + 0.06)):
                open_hewn(self.f, f.pt(-hw + 0.02, y - 0.07, z), f.pt(hw - 0.02, y - 0.07, z), 0.18, 0.15,
                          K.tint(OAK, 0.66, s, 9, k, j), TIMBER, seed=s + 9 + k * 2 + j, segs=2 - j, sag=0.02,
                          wander=0.015)
        z1 = hd - 0.16
        for i in range(n):
            xc = -hw + bay * (i + 0.5)
            dz = jit(0.04, s, 11, i)
            head, axis = self.rack_barrel(self.f, f, xc, y_lo + jit(0.02, s, 12, i), z1 + dz, r_lo, jit(0.04, s, 13, i))
            tap(self.f, head + Vector((0.0, -r_lo * 0.42, 0.0)), axis, s + 14 + i)
            # the chocks wedged under it on the front rail
            for j, sx in enumerate((-1, 1)):
                a0, a1 = xc + sx * r_lo * 0.5, xc + sx * r_lo * 0.88
                y0, y1 = y_rail - 0.01, y_rail + 0.17
                block(self.f, f, [(a0, y0, zf - 0.08), (a1, y0, zf - 0.08), (a1, y0, zf + 0.08), (a0, y0, zf + 0.08),
                                  (a0, y_rail + 0.02, zf - 0.07), (a1, y1, zf - 0.07), (a1, y1, zf + 0.07),
                                  (a0, y_rail + 0.02, zf + 0.07)],
                      K.tint(OAK, 0.6, s, 21, i, j), s + 21 + i * 2 + j, skip=('bottom',))
            # the top tier rides with the trim (medium and up): the low tier keeps the lower row
            if (i + n) % 2 == 0:
                for j, sx in enumerate((-1, 1)):
                    x = xc + sx * (r_keg + 0.03)
                    head, axis = self.rack_barrel(self.t, f, x, y_mid + 0.86 * r_keg, z1 + jit(0.06, s, 15, i, j), r_keg,
                                                  jit(0.05, s, 17, i, j))
                    if j == 1:
                        tap(self.t, head + Vector((0.0, -r_keg * 0.4, 0.0)), axis, s + 18 + i)
            else:
                self.rack_barrel(self.t, f, xc, y_mid + 0.86 * r_hi, z1 + dz - 0.02, r_hi, jit(0.04, s, 20, i))

    def rack_barrel(self, p, f, x, y, z, r, yaw):
        """The props' barrel (inn_props.py) lying on its side in a rack, its head to the room: its
        axis level at height y over (x) in the rack's frame f, its belly r round, its head's rim at
        z, turned `yaw` off square. Returns the middle of its head's face (sunk inside the rim) and
        its axis, for a tap."""
        prop = PR.PROPS['rack_barrel']
        sx, sy, sz = prop['size']
        scale = 2 * r / sx
        mid = sx / 2 - sy / 2         # the axis, over the model's middle (its bung stands proud on top)
        # its head's face: the nearest of the head's corners inside its chime's rim
        face = max(v[2] for v in prop['verts'] if math.hypot(v[0], v[1] - mid) < sx * 0.42)
        axis = Vector(f.vec(math.sin(yaw), 0.0, math.cos(yaw)))
        rim = Vector(f.pt(x, y, z))
        PR.stand(p, prop, rim - axis * (sz * scale / 2) - Vector((0.0, r, 0.0)), f.yaw + yaw, sy * scale)
        return rim - axis * ((sz - face) * scale), axis

    # ================================================================ casks
    def cask(self, q, s):
        """A cask stood on its end (the porch's, and those by the terrace on the falling ground,
        their staves run on down into it): bellied staves, the head sunk in its chime, two iron
        hoops (TavernTrim), never quite plumb."""
        r, b = q['r'], q['base']
        top = b + q['height']
        x, z = q['x'], q['z']
        g = min(self.B.ground(x + math.cos(a) * r, z + math.sin(a) * r) for a in
                (math.tau * i / 8 for i in range(8)))
        sink = max(0.02, b - g + 0.06) if b < -0.01 else 0.02
        lean = (jit(0.035, s, 1), jit(0.035, s, 2))
        barrel(self.f, self.t, (x, b, z), (x + lean[0], top, z + lean[1]), r * 0.985,
               K.tint(OAK, 0.9 if b >= 0 else 0.84, s, 3, spread=0.1), s + 3, hoops=(0.2, 0.8), sink=sink,
               phase=q['rot'])

    # ================================================================ clutter
    def clutter(self):
        """The small things on and round the furniture (TavernClutter)."""
        c = self.c
        by = {}
        for q in self.L['props']:
            by.setdefault(q['kind'], []).append(q)
        for q in by.get('table', []):
            self.table_things(q)
        for q in by.get('roundTable', []):
            self.round_things(q)
        self.stage_things(by)
        self.rack_things(by)
        # (the sacks of meal and malt by the right wall are the props' painted ones now, stood by
        # the sim's dressing records: inn_props.py)
        # a tankard left on the porch's tall cask
        cask = max((q for q in by.get('cask', []) if q['base'] >= 0), key=lambda q: q['height'], default=None)
        if cask is not None:
            tankard(c, Spot(cask['x'], cask['z'], 0.0), 0.08, cask['base'] + cask['height'] - 0.05, -0.1, 416)

    def table_things(self, q):
        """Tankards, plates and a candle on a table, set in its own frame (u along its length)."""
        c = self.c
        s = seed_of(q)
        spin = 0.0 if q['hw'] >= q['hd'] else math.pi / 2
        f = Spot.of(q, spin=spin)
        y = q['base'] + q['height']
        if max(q['hw'], q['hd']) > 1.5:
            # the long table: a tankard before each sitter, the board of bread and cheese, a jug,
            # the candles
            for k, (u, w) in enumerate(((1.3, 0.48), (-1.25, 0.46), (0.9, -0.5), (-0.95, -0.47))):
                tankard(c, f, u + jit(0.06, s, 1, k), y, w + jit(0.04, s, 2, k), s + 3 + k)
            bread_board(c, f, 0.62, y, 0.1, s + 9)
            ale_jug(c, f, -1.75, y, 0.1, s + 13)
            table_candles(c, f, 0.02, y, -0.12, s + 14)
        elif abs(q['hw'] - q['hd']) < 1e-6:
            # the square table: a tankard by each chair but one, the board of bread and cheese, a
            # bottle, the candles
            for k, (u, w) in enumerate(((0.05, 0.66), (-0.62, 0.1))):
                tankard(c, f, u, y, w, s + 3 + k)
            bread_board(c, f, 0.0, y, -0.32, s + 7)
            bottle(c, f, 0.42, y, -0.55, s + 9, GLASS[0])
            table_candles(c, f, -0.28, y, 0.22, s + 10)
        else:
            # a booth's table: tankards before two of its four sitters, the board of bread and
            # cheese, the candles
            for k, (u, w) in enumerate(((0.55, 0.36), (-0.55, -0.38))):
                tankard(c, f, u + jit(0.05, s, 1, k), y, w + jit(0.03, s, 2, k), s + 3 + k)
            bread_board(c, f, -0.38, y, -0.1, s + 7)
            table_candles(c, f, 0.12, y, 0.08, s + 9)

    def round_things(self, q):
        """The things on a round table: the dice table's game and drinks, the nook's candles."""
        c = self.c
        s = seed_of(q)
        f = Spot.of(q)
        y = q['base'] + q['height']
        if q['r'] > 1.0:
            # the dice table: three dice thrown (two showing a single pip), the cup upturned
            # beside them, a stack of coins and a couple loose, two tankards, the candle
            for k, (x, z) in enumerate(((0.12, 0.18), (-0.18, 0.02), (0.3, -0.16))):
                yaw = hash01(k, 21) * math.pi
                lump(c, f, (x, y + 0.055, z), (0.11, 0.11, 0.11), BONE, 22 + k, mat=PLAIN, rough=0.1, yaw=yaw)
                if k < 2:
                    g = f.sub(x, z, yaw)
                    K.face(c, [g.pt(-0.022, y + 0.114, -0.022), g.pt(0.022, y + 0.114, -0.022),
                               g.pt(0.022, y + 0.114, 0.022), g.pt(-0.022, y + 0.114, 0.022)], (0.0, 1.0, 0.0), PIP,
                           PLAIN, tag=K.FLAT)
            g = f.sub(-0.5, -0.32, 0.3)
            solid(c, [ring(g, 0.0, y - 0.003, 0.0, 0.12, 0.12, 6), ring(g, 0.0, y + 0.2, 0.0, 0.1, 0.1, 6)], LEATHER,
                  PLAIN, cap0=False)
            for k, (x, z) in enumerate(((0.62, 0.36), (0.2, -0.66))):
                g = f.sub(x, z, k)
                solid(c, [ring(g, 0.0, y - 0.003, 0.0, 0.065, 0.065, 6),
                          ring(g, 0.0, y + 0.04 + 0.03 * k, 0.0, 0.065, 0.065, 6)], GOLD, METAL, cap0=False, soft=False)
                K.disc(c, tuple(f.pt(x + 0.13, y + 0.006, z - 0.06)), (0.0, 1.0, 0.0), 0.06, GOLD, METAL, sides=6)
            tankard(c, f, 0.75, y, -0.2, 31)
            tankard(c, f, -0.62, y, 0.05, 32)
            table_candles(c, f, -0.12, y, -0.5, 33)
        else:
            # a nook table: the candles and a tankard; on one a jug, on the other the board of
            # bread and cheese
            tankard(c, f, 0.32, y, 0.22, s + 1)
            table_candles(c, f, -0.12, y, -0.1, s + 3)
            if q['x'] > self.B.TOWER['x']:
                ale_jug(c, f, -0.36, y, 0.3, s + 4)
            else:
                bread_board(c, f, -0.3, y, 0.3, s + 5)

    def stage_things(self, by):
        """The bard's things on the stage: the props' bear's skin before the bard's stool, the lute
        leaning on its drum with the pipe laid over it, stood by the stool toward the back wall and
        turned to the room, and the iron candelabra either side of the bard's corner (inn_props.py)."""
        c = self.c
        st = self.L['stage']
        lift = st['lift']
        # the bear's skin before the bard's stool, its head to the room (trim, medium and up), a
        # hair over the deck's boards
        prop = PR.PROPS['bearskin_rug']
        (bx, bz), length = BEARSKIN
        PR.stand(self.t, prop, Vector((bx, lift + 0.02, bz)), math.pi / 4, length / prop['size'][2] * prop['size'][1])
        stool = next((q for q in by.get('stool', []) if abs(q['base'] - lift) < 0.05), None)
        if stool is not None:
            # behind the runner's back edge, clear of the back wall's hangings
            PR.stand(c, PR.PROPS['bard_instruments'], Vector((stool['x'] + 1.3, lift, stool['z'] - 1.3)), 0.5,
                     BARD_KIT_H)
        # the candelabra framing the bard (trim, medium and up), a flame on every candle
        if 'candelabrum' in PR.PROPS:
            for k, ((x, z), height) in enumerate(CANDELABRA):
                at = PR.stand(self.t, PR.PROPS['candelabrum'], Vector((x, lift, z)), math.pi / 4, height)
                if 'candelabrum' in PR.WICKS:
                    light_wicks(self.t, 'candelabrum', at, 960 + 10 * k)

    def rack_things(self, by):
        """Bottles along the barrel racks' top shelves (in the bar's corner, over the keeper's
        head): the props' trio of a green bottle, an amber one and a stoneware jug (inn_props.py),
        a trio to every couple of yards of shelf, each set down a little askew facing the room."""
        c = self.c
        trio = PR.PROPS['bottle_trio']
        for j, q in enumerate(by.get('barrels', [])):
            f = Spot.of(q)
            y = q['base'] + q['height']
            n = max(1, int(2 * q['hw'] / RACK_TRIO_EVERY))
            for k in range(n):
                u = -q['hw'] + 2 * q['hw'] * (k + 0.5) / n + jit(0.15, j, k, 31)
                PR.stand(c, trio, f.pt(u, y, jit(0.05, j, k, 32)), f.yaw + jit(0.3, j, k, 33), RACK_TRIO_H)
