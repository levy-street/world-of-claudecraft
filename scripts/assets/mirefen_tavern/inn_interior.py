"""The hall's inside frame (build_tavern.py calls build(B, parts)): every floor the sim walks,
the round hearth in its pit under the copper hood, the wall fire's stone breast, the bar on its
platform round its great oak post, the bard's stage, the hammer-beam trusses under the roof, and
the kitchen seen through the serving hatch.

  TavernFrame     never cut: the floors (the hall's boards, the hearth pit's flags and the curb
                  round it, the bar platform and the stage with their bevelled edges, the
                  threshold under the arch, the tower nook's flags, the wing's floor), the round
                  hearth and its embers, the copper hood on its chains and its flue up into the
                  roof, the wall fire's chimney breast, the bar's counters and the beam over them,
                  the stage's deck, step and hangings, the trusses, the purlins, the ridge beam,
                  the kitchen
  BarPillar       the bar's great octagonal oak post, its shelf ring and the bottles on it (it
                  cuts away for the camera indoors, its bottles with it: nothing of it reaches past
                  its reach or over the truss line, HALL['truss'], where the beam over the bar
                  sits on it)
  TavernLights    the stage's footlights
  TavernTrim      the bar's foot rail, the hood's rivets and the curtain irons (the racks of
                  tankards hung from the beam over the bar are the props': inn_props.py)
  TavernClutter   the mantel's odds and ends, the kitchen's pots, jars, herbs and bread

Every walking surface is laid at the height the sim's floor gives it (src/sim/
mirefen_tavern_floor.ts tavernLocalHeight): level boards on the ground floor, the pit one step
down with its ramp ring up to the rim, the bar platform and the stage half a yard up with their
open edges ramped (radially round the corner between them), the nook and the wing level. The
boards bow a little, never more than a hand off the walk height, and every ramp is drawn exactly
on the sim's slope, its round corners in enough wedges that no face strays from it.

Nothing crosses the common room between the tables and the camera's air top (TAVERN_HALL_AIR_TOP)
but what stands against the front and back walls (the trusses' wall posts and their knee braces),
the bar and the wall fire: the hood, its chains, the hammer beams and everything over them hang
higher. The roof runs along the road (inn_roof.py): its ridge along x, its eaves over the front
and back walls, its gables on the side walls; the trusses span it front to back at HALL['trusses']
and every roof timber keeps a hand under its sarking (Roof.under, the hall's ceiling).
"""
import math

from mathutils import Vector

import inn_furnish as Fu
import inn_kit as K
import inn_props as PR
from inn_kit import (CLOTH, DRESSED, DRESSED_T, FLOOR, GLOW, IRON, METAL, OAK, PLAIN, PLASTER, STONE,
                      STONE_T, TIMBER, Wall, hash01, jit, vnoise)
from inn_roof import Roof

# colours (tints over the painted maps: 1 is the map as painted; the plain ones are real colours)
OAK_PALE = (0.95, 0.9, 0.84)           # scrubbed and worn wood
BOARDS = (0.92, 0.86, 0.8)
STAGE_BOARDS = (0.8, 0.66, 0.6)
FLAG = (0.9, 0.86, 0.8)
MORTAR = (0.42, 0.38, 0.35)
GARNET = (0.95, 0.9, 0.9)
COPPER = (0.62, 0.4, 0.26)
COPPER_DARK = (0.44, 0.27, 0.17)
VERDIGRIS = (0.36, 0.5, 0.41)
BRASS = (0.72, 0.56, 0.3)
SOOT = (0.075, 0.06, 0.055)
SOOT_COPPER = (0.3, 0.17, 0.1)
ASH = (0.3, 0.27, 0.25)
CHAR = (0.3, 0.25, 0.23)
EMBER = (1.0, 0.46, 0.17)
FLAME = (1.0, 0.7, 0.36)
GOLD = (0.86, 0.64, 0.26)
GLASS = ((0.22, 0.42, 0.26), (0.55, 0.32, 0.12), (0.38, 0.12, 0.13), (0.2, 0.3, 0.38))
FOOTLIGHT_H = 0.34    # the stage's footlights: the props' candle cluster, this tall
CROCK = ((0.86, 0.8, 0.66), (0.52, 0.34, 0.22), (0.7, 0.56, 0.4))
HERB = ((0.36, 0.46, 0.2), (0.46, 0.5, 0.26), (0.5, 0.36, 0.42))

# the roof's frame (yards; the sarking is inn_roof.py Roof.under)
CLEAR = 0.06          # every roof timber's top keeps at least this far under the sarking
AIR_TOP = 9.0         # the camera's air over the room (render/mirefen_tavern_interior_core.ts)
BEAM_FLOOR = AIR_TOP + 0.07   # the hammer beams' undersides never come lower
WALL_ZONE = 1.15      # under the air's top only the wall posts and their knee braces stand, this
                      # near the front and back walls (the clear room stops 1.2 short of them)
HAMMER_REACH = 3.5    # how far the hammer beams reach out of the front and back walls
HAMMER_W, HAMMER_H = 0.46, 0.5
FOOT_BACK = 6.98      # the corbels' tops on the back wall (over the stage's hangings and the arch)
FOOT_FRONT = 9.0      # on the front, over the upper storey's windows (inn_hall.py, heads at 8.5)
PRINCIPAL = 0.44      # a principal rafter's depth under the sarking
PRINCIPAL_W = 0.36
COLLAR_Y = 15.5       # the trusses' collars' undersides
COLLAR_H = 0.46
RIDGE_W, RIDGE_H = 0.44, 0.46
PURLIN_W, PURLIN_H = 0.4, 0.42    # a purlin's breadth along its slope and its depth under it
SETOFF = 11.2         # the wall fire's breast steps back to its flue's breast here


def build(B, parts):
    Interior(B, parts).build()


def slope_z(R, x, z, e=0.2):
    """The sarking's rise per yard toward +z over (x, z)."""
    return (R.under(x, z + e) - R.under(x, z - e)) / (2 * e)


def under_line(R, x, z, h):
    """The highest a roof timber's centre may stand over (x, z): its section h deep, square to
    the slope, its top a hand (CLEAR) under the sarking. inn_lights.py hangs the chandelier from
    the front purlin by it (under_line(R, x, z, PURLIN_H) is that purlin's centre)."""
    s = slope_z(R, x, z)
    c = 1.0 / math.hypot(1.0, s)
    # the section's top face stands h/2 up its normal (-s, 1) c (in z, y); the sarking is convex
    # across its slope, so the face's edges along the tangent keep under it too
    return R.under(x, z - s * c * h / 2) - CLEAR - c * h / 2


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def roof_oak(*seed, k=0.88):
    """The roof timbers' oak: a shade lighter than the sarking they stand against, so the
    trusses read against the ceiling."""
    return K.tint(OAK, k, *seed, spread=0.07)


def lines(a, b, step, keep=()):
    """Grid lines from a to b about `step` apart through every line in `keep` between them: each
    stretch between two fixed lines is shared out evenly, so no sliver row is left by a kept line."""
    fixed = sorted({round(a, 4), round(b, 4)} | {round(k, 4) for k in keep if a + 1e-6 < k < b - 1e-6})
    out = []
    for u, v in zip(fixed, fixed[1:]):
        n = max(1, int(round((v - u) / step)))
        out += [round(u + (v - u) * i / n, 4) for i in range(n)]
    return out + [fixed[-1]]


def around(cx, cz, r, a):
    """The plan point at radius r and bearing a round (cx, cz) (a = atan2(dx, dz), 0 to the front)."""
    return (cx + math.sin(a) * r, cz + math.cos(a) * r)


def clip_z(poly, zmax):
    """A plan polygon cut back to z <= zmax (one Sutherland-Hodgman pass)."""
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ina, inb = a[1] <= zmax + 1e-9, b[1] <= zmax + 1e-9
        if ina:
            out.append(a)
        if ina != inb:
            t = (zmax - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * t, zmax))
    return out


class Interior:
    def __init__(self, B, parts):
        self.B = B
        self.L = B.LAYOUT
        self.H = B.HALL
        self.frame = parts['TavernFrame']
        self.post = parts['BarPillar']
        self.lights = parts['TavernLights']
        self.trim = parts['TavernTrim']
        self.clutter = parts['TavernClutter']
        self.pit = self.L['pit']
        self.plat = self.L['platform']
        self.st = self.L['stage']
        props = self.L['props']
        self.fire = next(q for q in props if q['kind'] == 'fireplace')
        self.hearth_q = next(q for q in props if q['kind'] == 'hearth')
        self.pillar_q = next(q for q in props if q['kind'] == 'pillar')
        self.counters = [q for q in props if q['kind'] == 'counter']
        t = self.H['wall']
        self.ix = self.H['x1'] - t        # the gable (side) walls' inner faces (+-15.2)
        self.iz0 = self.H['z0'] + t       # the back wall's inner face (-13.2)
        self.iz1 = self.H['z1'] - t       # the front wall's inner face (13.2)
        # the roof's one surface (its sag and its eaves' droop): every timber stops under its sarking
        self.roof = Roof(B, {})
        self.collars = {}
        self.ridge_pts = []

    def build(self):
        self.hall_floor()
        self.pit_floor()
        self.deck(self.plat, -1, (0.8, 0.7, 0.64), 520.0)
        self.deck(self.st, 1, STAGE_BOARDS, 540.0)
        self.threshold()
        self.nook_floor()
        self.wing_floor()
        self.hearth()
        self.trusses()
        self.roof_timbers()
        self.hood()
        self.fireplace()
        self.bar()
        self.pillar()
        self.stage()
        self.kitchen()

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _fit(pts, allowed, n=12, rounds=8):
        """A timber's centre line lowered wherever it would stand over allowed(x, z): at its
        points and all along the chords between them (the bell-cast sags between them)."""
        pts = [Vector(q) for q in pts]
        for _ in range(rounds):
            moved = False
            for a, b in zip(pts, pts[1:]):
                worst = max(q.y - allowed(q.x, q.z) for q in (a.lerp(b, k / n) for k in range(n + 1)))
                if worst > 1e-4:
                    a.y -= worst
                    b.y -= worst
                    moved = True
            if not moved:
                break
        return [tuple(q) for q in pts]

    @staticmethod
    def _along(pts, z):
        """A centre line's height and its rise per yard at z (its points in order of z)."""
        for a, b in zip(pts, pts[1:]):
            if a[2] <= z <= b[2]:
                s = (b[1] - a[1]) / (b[2] - a[2])
                return a[1] + s * (z - a[2]), s
        a, b = (pts[0], pts[1]) if z < pts[0][2] else (pts[-2], pts[-1])
        s = (b[1] - a[1]) / (b[2] - a[2])
        return a[1] + s * (z - a[2]), s

    def _sheet(self, p, polys, height, tint, mat, cache=None, up=True, soft=True):
        """A surface laid through plan polygons, each corner at height(x, z) and tinted
        tint(x, z); the corners are shared (one solid: the map runs on unbroken across it).
        Faces turn up (a floor) or down (a ceiling)."""
        bm = p.bm
        cache = {} if cache is None else cache
        want = K.P(0.0, 1.0 if up else -1.0, 0.0)
        faces = []
        for poly in polys:
            vs = []
            for (x, z) in poly:
                key = (round(x, 4), round(z, 4))
                v = cache.get(key)
                if v is None:
                    v = bm.verts.new(K.P(x, height(x, z), z))
                    cache[key] = v
                if v not in vs:
                    vs.append(v)
            if len(vs) < 3:
                continue
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            f.normal_update()
            if f.normal.dot(want) < 0:
                f.normal_flip()
            p.paint([f], (1.0, 1.0, 1.0), mat)
            for loop in f.loops:
                co = loop.vert.co
                loop[p.col] = (*tint(co.x, -co.y), 1.0)
            f[p.soft] = 1 if soft else 0
            faces.append(f)
        return faces

    def _level(self, w, h, seed):
        """A hewn timber's section as K.hewn will cut it (its own swell), so a level beam can be
        hung with its underside exactly on a line."""
        return w * (1.0 + jit(0.08, seed, 9.1)), h * (1.0 + jit(0.08, seed, 9.7))

    def _stud(self, p, c, n, r, h, color):
        """A rivet head: a squat three-sided pyramid standing proud of a surface (n outward)."""
        c, n = Vector(c), Vector(n).normalized()
        ref = Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.9 else Vector((1.0, 0.0, 0.0))
        u = n.cross(ref).normalized()
        w = n.cross(u).normalized()
        base = [c + (u * math.cos(a) + w * math.sin(a)) * r - n * 0.01 for a in (0.3, 2.394, 4.489)]
        tip = c + n * h
        for i in range(3):
            q0, q1 = base[i], base[(i + 1) % 3]
            K.face(p, [q0, q1, tip], tuple((q0 + q1 + tip) / 3 - c), color, METAL)

    def _chain(self, p, a, b, link=0.44):
        """An iron chain from a to b: links of flat bar, each turned a quarter to the last."""
        a, b = Vector(a), Vector(b)
        d = b - a
        n = max(2, int(round(d.length / link)))
        axis = d.normalized()
        ref = Vector((1.0, 0.0, 0.0)) if abs(axis.x) < 0.9 else Vector((0.0, 0.0, 1.0))
        u1 = axis.cross(ref).normalized()
        u2 = axis.cross(u1).normalized()
        for i in range(n):
            s = a + d * (i / n) - axis * 0.04
            e = a + d * ((i + 1) / n) + axis * 0.04
            p.beam([tuple(s), tuple(e)], 0.15, 0.04, IRON, METAL, up=tuple(u1 if i % 2 == 0 else u2), caps=False)

    def _lathe(self, p, cx, cz, prof, sides, paint, mat, phase=0.0, dent=0.0, seed=0.0):
        """A turned shell round a vertical axis through (r, y) profile points, the last joined
        back to the first (closed); paint(k, i) colours the band from point k, side i. `dent`
        knocks each corner a little in or out (beaten copper)."""
        bm = p.bm
        rings = []
        for k, (r, y) in enumerate(prof):
            ring = []
            for i in range(sides):
                a = phase + math.tau * i / sides
                rr = r * (1.0 + jit(dent, seed, k, i)) if dent else r
                x, z = around(cx, cz, rr, a)
                ring.append(bm.verts.new(K.P(x, y, z)))
            rings.append(ring)
        faces = []
        for k in range(len(rings)):
            a, b = rings[k], rings[(k + 1) % len(rings)]
            for i in range(sides):
                j = (i + 1) % sides
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
                f[p.soft] = 1
                p.paint([f], paint(k, i), mat)
                faces.append(f)
        p.closed.extend(faces)
        return faces

    # ================================================================== floors
    def board_y(self, x, z):
        """The hall's boards: level, bowed a hand here and there, dead level where they meet
        the walls, the pit's curb, the platform's and the stage's bevels and the wall fire's
        hearthstone (so every seam meets true)."""
        pit, pl, st, fire = self.pit, self.plat, self.st, self.fire
        d = min(self.ix - abs(x), self.iz1 - abs(z))
        d = min(d, math.hypot(x - pit['x'], z - pit['z']) - pit['rim'] - 0.3)
        d = min(d, math.hypot(max(0.0, pl['x0'] - pl['rim'] - x), max(0.0, z - pl['z1'] - pl['rim'])))
        d = min(d, math.hypot(max(0.0, x - st['x1'] - st['rim']), max(0.0, z - st['z1'] - st['rim'])))
        fx = fire['x'] - fire['hw'] - 2.4
        d = min(d, math.hypot(max(0.0, fx - x), max(0.0, abs(z - fire['z']) - fire['hd'] - 0.6)))
        k = smooth(d / 1.2)
        if k <= 0.0:
            return 0.0
        return k * (0.024 * vnoise(x / 4.1, z / 3.6, 501.0) + 0.01 * vnoise(x / 1.6, z / 1.8, 503.0))

    def board_tint(self, x, z):
        """The boards' paint: paler where the feet go (in from the door, round the pit's curb,
        before the bar), darker into the corners."""
        pit = self.pit
        door = max(0.0, 1.0 - abs(x) / 3.4) * smooth((z + 1.0) / 7.0)
        curb = max(0.0, 1.0 - abs(math.hypot(x - pit['x'], z - pit['z']) - 6.9) / 1.7)
        bar = max(0.0, 1.0 - abs(z + 2.8) / 1.5) * smooth((x - 1.0) / 2.5)
        wear = min(1.0, door + 0.8 * curb + 0.7 * bar)
        edge = smooth(min(self.ix - abs(x), self.iz1 - abs(z)) / 3.5)
        k = (0.78 + 0.1 * edge + 0.1 * wear) * (1.0 + 0.07 * vnoise(x / 2.3, z / 2.9, 507.0))
        return tuple(min(1.0, c * k) for c in BOARDS)

    def hall_floor(self):
        """The common room's boards, wall to wall: a grid, lofted in round the hearth pit's curb
        (its inner ring hides under the curb's lip), stopping at the foot of the platform's and
        the stage's bevels and wrapping round their rounded corners."""
        pit, pl, st = self.pit, self.plat, self.st
        cx, cz = pit['x'], pit['z']
        e = 0.12
        px, pz = pl['x0'] - pl['rim'], pl['z1'] + pl['rim']        # the platform's bevels' foot
        sx, sz = st['x1'] + st['rim'], st['z1'] + st['rim']        # the stage's
        R = (cx - 7.4, cx + 7.4, pz, cz + 7.0)                     # the square round the pit
        xs = lines(-self.ix - e, self.ix + e, 2.2, (R[0], R[1], px, pl['x0'], st['x1'], sx))
        zs = lines(self.iz0 - e, self.iz1 + e, 2.2, (R[2], R[3], pl['z1'], pz, st['z1'], sz))
        polys = []
        for i in range(len(xs) - 1):
            for j in range(len(zs) - 1):
                xa, xb, za, zb = xs[i], xs[i + 1], zs[j], zs[j + 1]
                mx, mz = (xa + xb) / 2, (za + zb) / 2
                if R[0] < mx < R[1] and R[2] < mz < R[3]:
                    continue
                if mx > px and mz < pz:
                    continue
                if mx < sx and mz < sz:
                    continue
                polys.append([(xa, za), (xb, za), (xb, zb), (xa, zb)])
        # the loft from the square's edge in to the curb: a ring of quads on the grid's own
        # corners, so the boards run on unbroken
        edge = set()
        for x in xs:
            if R[0] - 1e-6 <= x <= R[1] + 1e-6:
                edge.update(((x, R[2]), (x, R[3])))
        for z in zs:
            if R[2] - 1e-6 <= z <= R[3] + 1e-6:
                edge.update(((R[0], z), (R[1], z)))
        ring = sorted(edge, key=lambda q: math.atan2(q[0] - cx, q[1] - cz))
        r0 = pit['rim'] + 0.09
        n = len(ring)
        for k in range(n):
            b0, b1 = ring[k], ring[(k + 1) % n]
            c0 = around(cx, cz, r0, math.atan2(b0[0] - cx, b0[1] - cz))
            c1 = around(cx, cz, r0, math.atan2(b1[0] - cx, b1[1] - cz))
            polys.append([c0, c1, b1, b0])
        # the boards round the foot of each raised deck's rounded corner
        for q, sgn in ((pl, -1.0), (st, 1.0)):
            qx = q['x0'] if sgn < 0 else q['x1']
            qz, rim = q['z1'], q['rim']
            arc = [(qx + sgn * math.cos(f) * rim, qz + math.sin(f) * rim)
                   for f in (math.pi / 2 * i / 6 for i in range(7))]
            corner = (qx + sgn * rim, qz + rim)
            for i in range(6):
                polys.append([corner, arc[i], arc[i + 1]])
        self._sheet(self.frame, polys, self.board_y, self.board_tint, FLOOR)

    def pit_floor(self):
        """The hearth pit: a mortar bed one step down, big flags laid round the hearth in three
        rings (no two alike, the joints wandering), and the ring of dressed blocks up its ramp to
        the rim, each block's lip lying out over the boards as the curb."""
        p = self.frame
        q = self.pit
        cx, cz, d = q['x'], q['z'], -q['depth']
        n = 24

        def at(r, a, y):
            x, z = around(cx, cz, r, a)
            return (x, y, z)

        # the mortar bed under the whole pit (the joints show it, never the ground)
        for i in range(n // 2):
            a0, a1 = math.tau * i / (n // 2), math.tau * (i + 1) / (n // 2)
            K.face(p, [(cx, d - 0.035, cz), at(q['r'] + 0.2, a0, d - 0.035), at(q['r'] + 0.2, a1, d - 0.035)],
                   (0, 1, 0), K.tint(MORTAR, 1.0, 600, i, spread=0.05), DRESSED)
        # the flags
        rings = [(1.5, 2.7, 11), (2.7, 3.95, 15), (3.95, q['r'] + 0.03, 20)]
        for ri, (ra, rb, m) in enumerate(rings):
            cuts = [math.tau * i / m + ri * 0.37 + jit(0.35 * math.tau / m, 610, ri, i) for i in range(m)]
            for i in range(m):
                a0, a1 = cuts[i], cuts[(i + 1) % m] + (math.tau if i == m - 1 else 0.0)
                g0, g1 = 0.022 / ra, 0.022 / rb
                pts = [at(ra + 0.02, a0 + g0, d + jit(0.012, 611, ri, i, 0)),
                       at(rb - 0.02, a0 + g1, d + jit(0.012, 611, ri, i, 1)),
                       at(rb - 0.02, a1 - g1, d + jit(0.012, 611, ri, i, 2)),
                       at(ra + 0.02, a1 - g0, d + jit(0.012, 611, ri, i, 3))]
                K.face(p, pts, (0, 1, 0), K.tint(FLAG, 0.9 - 0.06 * ri, 612, ri, i, spread=0.09), DRESSED)
        # the ramp ring and its curb: each block's slope from the pit's floor up to the rim (the
        # sim's ramp exactly), its lip flat over the boards, its outer edge down into them
        toe, rim, lip = q['r'] - 0.02, q['rim'], q['rim'] + 0.37
        for i in range(n):
            a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
            # the mortar under the blocks' joints down the slope (past the rim the boards run
            # on under the lips)
            K.face(p, [at(toe - 0.03, a0, d - 0.03), at(toe - 0.03, a1, d - 0.03), at(rim + 0.12, a1, -0.012),
                       at(rim + 0.12, a0, -0.012)], (0, 1, 0), K.tint(MORTAR, 0.9, 620, i, spread=0.05), DRESSED)
            j = 0.012 + 0.014 * hash01(622, i)
            b0, b1 = a0 + 0.024 / rim, a1 - 0.024 / rim
            col = K.tint(DRESSED_T, 0.86, 623, i, spread=0.07)
            K.face(p, [at(toe, b0, d + j), at(toe, b1, d + j), at(rim, b1, j), at(rim, b0, j)], (0, 1, 0), col, DRESSED)
            K.face(p, [at(rim, b0, j), at(rim, b1, j), at(lip, b1, j + 0.012), at(lip, b0, j + 0.012)], (0, 1, 0),
                   K.tint(col, 1.06, 624, i, spread=0.02), DRESSED)
            mid = around(0.0, 0.0, 1.0, (a0 + a1) / 2)
            K.face(p, [at(lip, b0, j + 0.012), at(lip, b1, j + 0.012), at(lip, b1, -0.04), at(lip, b0, -0.04)],
                   (mid[0], 0.0, mid[1]), K.tint(col, 0.92, 625, i, spread=0.02), DRESSED)

    def deck_h(self, q, sgn, x, z):
        """A raised deck's walk height (tavernHallHeight's platform and stage): its lift on the
        deck, falling radially from its corner over its rim off its two open edges (sgn: the
        side its open edge faces along x)."""
        ox = max(0.0, q['x0'] - x) if sgn < 0 else max(0.0, x - q['x1'])
        oz = max(0.0, z - q['z1'])
        return q['lift'] * max(0.0, 1.0 - math.hypot(ox, oz) / q['rim'])

    def deck(self, q, sgn, tone, seed):
        """A raised deck (the bar platform, the stage): boards at its lift running into the walls,
        and its two open edges bevelled down to the hall's boards in worn boards on the sim's own
        slope, fanned round the corner between them."""
        lift, rim = q['lift'], q['rim']
        e = 0.12
        if sgn < 0:
            xa, xb, ex = q['x0'], self.ix + e, q['x0']
        else:
            xa, xb, ex = -self.ix - e, q['x1'], q['x1']
        za, zb = self.iz0 - e, q['z1']

        def bow(x, z):
            k = smooth(min(abs(x - ex), abs(z - zb)) / 0.9)
            return lift + k * (0.012 * vnoise(x / 2.2, z / 1.9, seed) + 0.006)

        def tint(x, z):
            k = 0.86 + 0.08 * vnoise(x / 2.0, z / 2.4, seed + 1) + 0.06 * smooth(1.0 - abs(z - zb) / 2.0)
            return tuple(min(1.0, c * k) for c in tone)

        xs, zs = lines(xa, xb, 1.8), lines(za, zb, 1.8)
        polys = [[(xs[i], zs[j]), (xs[i + 1], zs[j]), (xs[i + 1], zs[j + 1]), (xs[i], zs[j + 1])]
                 for i in range(len(xs) - 1) for j in range(len(zs) - 1)]
        self._sheet(self.frame, polys, bow, tint, FLOOR)
        # the bevels: the side edge, the front edge and the fan between them, one solid
        foot = ex + sgn * rim
        polys = []
        # (the side bevel stops at the back wall's face: past it the platform's foot is the arch)
        zl = lines(self.iz0 if sgn < 0 else za, zb, 2.0)
        for j in range(len(zl) - 1):
            polys.append([(foot, zl[j]), (ex, zl[j]), (ex, zl[j + 1]), (foot, zl[j + 1])])
        if sgn < 0:
            K.face(self.frame, [(foot, 0.0, self.iz0), (ex, 0.0, self.iz0), (ex, lift, self.iz0)], (0.0, 0.0, -1.0),
                   K.tint(OAK_PALE, 0.6, seed, 3), FLOOR)
        xl = lines(ex, xb, 2.0) if sgn < 0 else lines(xa, ex, 2.0)
        for i in range(len(xl) - 1):
            polys.append([(xl[i], zb), (xl[i + 1], zb), (xl[i + 1], zb + rim), (xl[i], zb + rim)])
        for i in range(6):
            f0, f1 = math.pi / 2 * i / 6, math.pi / 2 * (i + 1) / 6
            polys.append([(ex, zb), (ex + sgn * math.cos(f0) * rim, zb + math.sin(f0) * rim),
                          (ex + sgn * math.cos(f1) * rim, zb + math.sin(f1) * rim)])

        def bevel_tint(x, z):
            # boards worn pale along the deck's lip, darker down at the foot
            k = 0.66 + 0.34 * self.deck_h(q, sgn, x, z) / lift + 0.05 * vnoise(x / 1.3, z / 1.3, seed + 2)
            return tuple(min(1.0, c * k) for c in OAK_PALE)

        self._sheet(self.frame, polys, lambda x, z: self.deck_h(q, sgn, x, z), bevel_tint, FLOOR, soft=False)

    def threshold(self):
        """The arch's threshold: big dressed slabs across the back wall's depth, a hand proud of
        the boards and the nook's flags either side, on a mortar bed."""
        p = self.frame
        a = self.L['arch']
        z0, z1 = self.H['z0'] - 0.06, self.iz0 + 0.06
        K.face(p, [(a['x0'] - 0.1, -0.025, z0), (a['x1'] + 0.1, -0.025, z0), (a['x1'] + 0.1, -0.025, z1),
                   (a['x0'] - 0.1, -0.025, z1)], (0, 1, 0), MORTAR, DRESSED)
        n = 5
        cuts = [a['x0'] - 0.1] + [a['x0'] + (a['x1'] - a['x0']) * k / n + jit(0.25, 640, k) for k in range(1, n)] + \
            [a['x1'] + 0.1]
        for k in range(n):
            xa, xb = cuts[k] + 0.02, cuts[k + 1] - 0.02
            top = [0.022 + jit(0.008, 641, k, i) for i in range(4)]
            pts = [(xa, -0.22, z0), (xb, -0.22, z0), (xb, -0.22, z1), (xa, -0.22, z1),
                   (xa + jit(0.03, 642, k), top[0], z0), (xb + jit(0.03, 643, k), top[1], z0),
                   (xb + jit(0.03, 644, k), top[2], z1 + jit(0.03, 645, k)),
                   (xa + jit(0.03, 646, k), top[3], z1 + jit(0.03, 647, k))]
            K.block(p, pts, K.tint(DRESSED_T, 0.86, 648, k, spread=0.06), DRESSED)

    def nook_floor(self):
        """The tower's nook: flags in rings round a two-tone stone rose, on a mortar bed, its
        hall side stopping at the back wall's line where the threshold takes over."""
        p = self.frame
        T = self.B.TOWER
        cx, cz = T['x'], T['z']
        wall = self.H['z0']
        R = T['rIn'] + 0.16
        n = 24
        for i in range(n):
            a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
            poly = clip_z([(cx, cz), around(cx, cz, R + 0.1, a0), around(cx, cz, R + 0.1, a1)], wall)
            if len(poly) >= 3:
                K.face(p, [(x, -0.03, z) for (x, z) in poly], (0, 1, 0), K.tint(MORTAR, 1.0, 650, i, spread=0.05),
                       DRESSED)
        rings = [(0.0, 1.25, 8), (1.25, 2.55, 11), (2.55, 4.0, 15), (4.0, R, 20)]
        for ri, (ra, rb, m) in enumerate(rings):
            cuts = [math.tau * i / m + ri * 0.29 + (jit(0.3 * math.tau / m, 651, ri, i) if ri else 0.0)
                    for i in range(m)]
            for i in range(m):
                a0, a1 = cuts[i], cuts[(i + 1) % m] + (math.tau if i == m - 1 else 0.0)
                gb = 0.022 / rb
                if ra <= 0.0:
                    poly = [(cx, cz), around(cx, cz, rb - 0.02, a0 + gb), around(cx, cz, rb - 0.02, (a0 + a1) / 2),
                            around(cx, cz, rb - 0.02, a1 - gb)]
                    # the rose: its petals pale and dark by turns
                    col = K.tint(DRESSED_T if i % 2 else (0.62, 0.58, 0.56), 0.92, 652, i, spread=0.04)
                else:
                    ga = 0.022 / ra
                    poly = [around(cx, cz, ra + 0.02, a0 + ga), around(cx, cz, rb - 0.02, a0 + gb),
                            around(cx, cz, rb - 0.02, a1 - gb), around(cx, cz, ra + 0.02, a1 - ga)]
                    col = K.tint(FLAG, 0.84 if ri == 1 else 0.92, 653, ri, i, spread=0.09)
                poly = clip_z(poly, wall)
                if len(poly) < 3:
                    continue
                pts = [(x, jit(0.008, 654, ri, i, k), z) for k, (x, z) in enumerate(poly)]
                K.face(p, pts, (0, 1, 0), col, DRESSED)

    def wing_floor(self):
        """The wing's floor, the kitchen's and the cellar's: worn cobbles, level."""
        W = self.B.WING
        x0, x1 = W['x0'] + W['wall'] - 0.05, W['x1'] - W['wall'] + 0.05
        z0, z1 = W['z0'] + W['wall'] - 0.05, self.H['z0'] + 0.08
        xs, zs = lines(x0, x1, 5.5), lines(z0, z1, 4.6)
        polys = [[(xs[i], zs[j]), (xs[i + 1], zs[j]), (xs[i + 1], zs[j + 1]), (xs[i], zs[j + 1])]
                 for i in range(len(xs) - 1) for j in range(len(zs) - 1)]

        def tint(x, z):
            k = 0.74 + 0.08 * vnoise(x / 2.1, z / 2.4, 660.0)
            return (k * 0.95, k * 0.92, k * 0.9)

        self._sheet(self.frame, polys, lambda x, z: 0.004 * vnoise(x / 1.7, z / 1.9, 661.0), tint, STONE)

    # ================================================================== hearth
    def hearth(self):
        """The round hearth in the middle of the pit: an open bowl of big rough stones, two
        courses and a coping that overhangs inward, sooted inside; the ash bed in it, embers
        heaped low and three charred logs under where the flames stand."""
        p = self.frame
        q = self.hearth_q
        cx, cz, R = q['x'], q['z'], q['r']
        base, top = q['base'], q['base'] + q['height']
        n = 8
        courses = ((base - 0.03, base + 0.56, R - 0.52, R + 0.09, R - 0.5, R + 0.0, 0.0),
                   (base + 0.54, top, R - 0.66, R + 0.08, R - 0.58, R + 0.0, 0.5))
        for c, (y0, y1, ri0, ro0, ri1, ro1, off) in enumerate(courses):
            for i in range(n):
                s = 630 + c * 40 + i
                a0 = math.tau * (i + off) / n + 0.035 + abs(jit(0.06, s, 1))
                a1 = math.tau * (i + 1 + off) / n - 0.035 - abs(jit(0.06, s, 2))
                corners = []
                for (yy, ri, ro, top_ring) in ((y0, ri0, ro0, False), (y1, ri1, ro1, True)):
                    lift = jit(0.06, s, 3) if top_ring else 0.0
                    for (r, a, kk) in ((ri, a0, 4), (ro, a0, 5), (ro, a1, 6), (ri, a1, 7)):
                        rr = r + jit(0.06, s, kk, yy)
                        # each top's edges knocked down: the coping rounds into the bowl and over
                        # its outer lip, the lower course's top sinks under the coping
                        dy = 0.0
                        if top_ring and c == 1:
                            dy = -0.09 if r == ri else -0.04
                        x, z = around(cx, cz, rr, a + jit(0.025, s, kk, 2))
                        corners.append((x, yy + lift + dy + jit(0.03, s, kk, 3), z))
                faces = K.block(p, corners, K.tint(DRESSED_T, 0.7 if c == 0 else 0.8, s, spread=0.1), DRESSED)
                # soot on the faces turned in to the fire
                mid = sum((Vector(v) for v in corners), Vector()) / 8
                for f in faces:
                    fc = sum((v.co for v in f.verts), Vector()) / len(f.verts)
                    gx, gz = fc.x - K.P(*mid).x, -fc.y + K.P(*mid).y
                    to_axis = (cx - mid.x) * gx + (cz - mid.z) * gz
                    if to_axis > 0.05:
                        p.paint([f], K.tint((0.3, 0.27, 0.25), 1.0, s, 9, spread=0.1), DRESSED)
        # the ash bed and the fire's heart: embers heaped low, three charred logs across them
        K.disc(p, (cx, base + 0.17, cz), (0, 1, 0), R - 0.42, ASH, PLAIN, sides=8, seed=660.0, rough=0.06)
        for k in range(5):
            a = k * 1.25 + 0.4
            rr = 0.15 + 0.55 * hash01(661, k)
            x, z = around(cx, cz, rr, a)
            K.lump(p, (x, base + 0.24, z), (0.5, 0.16, 0.42), K.tint(EMBER, 1.0, 662, k, spread=0.12), GLOW,
                   seed=663 + k, rough=0.35, yaw=a)
        for k, (a, ln) in enumerate(((0.45, 1.55), (2.15, 1.45), (-1.15, 1.35))):
            dx, dz = math.sin(a) * ln / 2, math.cos(a) * ln / 2
            y = base + 0.36 + k * 0.07
            p.cylinder((cx - dx, y, cz - dz), (cx + dx, y + 0.06 * (k - 1), cz + dz), 0.13,
                       K.tint(CHAR, 1.0, 664, k), TIMBER, sides=5, phase=k)

    # ================================================================== hood
    def hood(self):
        """The copper hood over the hearth: a beaten bell with a rolled rim and a riveted band,
        sooted inside and lit by the fire under it (the props' painted hood when the atlas has
        one, inn_props.py), hung on four iron chains from the collars of the two trusses either
        side of it, and its flue climbing from its crown up through the sarking into the stack's
        foot (the stack over the ridge is the roof's, inn_roof.py)."""
        p, trim = self.frame, self.trim
        h, pit = self.L['hood'], self.pit
        cx, cz = pit['x'], pit['z']
        y0, y1, r0, r1 = h['rimY'], h['topY'], h['rimR'], h['topR']

        def bell(y):
            t = (y - y0) / (y1 - y0)
            return r1 + (r0 - r1) * (1.0 - t) ** 1.4

        band = y0 + (y1 - y0) * 0.42
        outer = [(r0 + 0.08, y0 - 0.04), (r0 + 0.13, y0 + 0.2), (r0 - 0.04, y0 + 0.27),
                 (bell(band) + 0.09, band), (bell(band + 0.24) + 0.09, band + 0.24),
                 (bell(y1 - 0.5), y1 - 0.5), (r1 + 0.09, y1)]
        inner = [(r1 - 0.05, y1 - 0.02), (bell(band) - 0.1, band), (r0 - 0.1, y0 + 0.06)]
        prof = outer + inner

        def paint(k, i):
            if k >= len(outer) - 1:
                # inside: sooted, lit warm by the fire under it, darkest up the throat
                return K.tint(SOOT_COPPER, 1.0 + 0.9 * (k == len(prof) - 2), 900, k, i, spread=0.1)
            if k in (0, 1, 3):
                return K.tint(COPPER_DARK, 1.0, 901, k, i, spread=0.08)
            col = K.tint(COPPER, 1.0, 902, k, i, spread=0.12)
            if hash01(903, k, i) > 0.8:
                # a weep of verdigris down a panel
                col = tuple(a * 0.45 + b * 0.55 for a, b in zip(col, VERDIGRIS))
            return col

        if 'copper_hood' in PR.PROPS:
            # the props' painted hood (inn_props.py) in place of the turned one: as wide as the
            # bell's rim, or as tall as its rim to its crown if that is smaller, its crown at the
            # flue's foot, its skin laid inward too (the room looks up into it); the chains' lugs
            # on its own band
            prop = PR.PROPS['copper_hood']
            sx, sy, sz = prop['size']
            s = min((2 * r0 + 0.16) / max(sx, sz), (y1 - y0 + 0.04) / sy)
            foot = y1 - sy * s
            PR.stand(p, prop, Vector((cx, foot, cz)), 0.13, sy * s, inside=True)
            yb = (band - foot) / s - sy / 2
            near = [math.hypot(x, z - sz / 2) for x, y, z in prop['verts'] if abs(y - yb) < sy * 0.06]
            hug = max(near) * s if near else bell(band)
        else:
            self._lathe(p, cx, cz, prof, 12, paint, METAL, phase=0.13, dent=0.012, seed=904.0)
            hug = bell(band)
            # rivets round the band (trim)
            for k in range(14):
                a = math.tau * (k + 0.5) / 14 + 0.13
                x, z = around(cx, cz, bell(band) + 0.1, a)
                self._stud(trim, (x, band + 0.12, z), (math.sin(a), 0.15, math.cos(a)), 0.065, 0.055, BRASS)
        # the chains: from lugs on the band up into the undersides of the collars of the trusses
        # either side, two to each, splayed along it
        xs = self.H['trusses']
        for xt in (max(t for t in xs if t < cx), min(t for t in xs if t > cx)):
            yc, c0, c1 = self.collars[xt]
            for dz in (-1.0, 1.0):
                ax, ay, az = xt, yc + 0.08, min(c1 - 0.4, max(c0 + 0.4, cz + dz))
                a = math.atan2(ax - cx, az - cz)
                lx, lz = around(cx, cz, hug + 0.12, a)
                K.lump(p, (lx, band + 0.18, lz), (0.16, 0.3, 0.16), IRON, METAL, seed=905 + dz + xt, rough=0.1, yaw=a)
                self._chain(p, (lx, band + 0.3, lz), (ax, ay, az), link=0.72)
        # the flue: copper, banded, leaning a touch as it climbs up through the sarking (the roof
        # rises toward the ridge across it), its top cut to the roof's slope a hand up into the
        # slab, under the stack's foot (inn_roof.py _flue_stack) and never out through the slates
        R = self.roof
        axis = [(cx, y1 - 0.12, cz), (cx + 0.03, y1 + 2.2, cz - 0.02), (cx + 0.06, y1 + 4.6, cz + 0.02)]
        tx, tz = cx + 0.08, cz
        angs = [math.tau * k / 8 for k in range(8)]
        low = min(R.under(tx + math.cos(a) * 0.7, tz + math.sin(a) * 0.7) for a in angs)
        axis.append((tx, low - 0.3, tz))
        rings = []
        for i, (x, y, z) in enumerate(axis):
            r = 0.7 - 0.04 * i / len(axis)
            rings.append([(x + math.cos(a) * r, y, z + math.sin(a) * r) for a in angs])
        rings.append([(tx + math.cos(a) * 0.66, R.under(tx + math.cos(a) * 0.66, tz + math.sin(a) * 0.66) + 0.15,
                       tz + math.sin(a) * 0.66) for a in angs])
        p.loft(rings, lambda i, k: K.tint(COPPER, 0.95, 907, i, k, spread=0.1), mat=METAL)
        p.cylinder((cx + 0.03, y1 + 2.9, cz), (cx + 0.03, y1 + 3.1, cz), 0.76, COPPER_DARK, METAL, sides=8)

    # ================================================================== fireplace
    def _quoins(self, p, corner, na, nb, v0, v1, seed, course=0.86):
        """Dressed quoins up a corner of the breast: long and short by turns on each face (na,
        nb the two faces' outward normals in plan), each a little off true, a hand proud."""
        cx, cz = corner
        v, k = v0, 0
        while v < v1 - 0.15:
            h = min(course + jit(0.1, seed, k), v1 - v)
            if v1 - v - h < 0.3:
                h = v1 - v
            la, lb = (0.66, 0.4) if k % 2 == 0 else (0.4, 0.66)
            ox = cx + (na[0] + nb[0]) * 0.07
            oz = cz + (na[1] + nb[1]) * 0.07
            pts = []
            for yy in (v + 0.025, v + h - 0.025):
                pts.append((ox, yy, oz))
                pts.append((ox - nb[0] * la, yy, oz - nb[1] * la))
                pts.append((ox - nb[0] * la - na[0] * lb, yy, oz - nb[1] * la - na[1] * lb))
                pts.append((ox - na[0] * lb, yy, oz - na[1] * lb))
            pts = [(x + jit(0.035, seed, k, i), y + jit(0.02, seed, k, i, 3), z + jit(0.035, seed, k, i + 9))
                   for i, (x, y, z) in enumerate(pts)]
            K.block(p, pts, K.tint(DRESSED_T, 0.92, seed, k, spread=0.07), DRESSED)
            v += h
            k += 1

    def fireplace(self):
        """The wall fire's chimney breast inside the right gable wall: rubble stone with dressed
        quoins, stepping back over its mantel shelf, again over a dressed weathering at the
        hammer beams' line (SETOFF), and its flue's breast climbing the gable on up into the
        sarking. Its mouth is a shallow soot panel framed by dressed jambs under a flat-arched
        lintel, the hearthstone before it (src/render/mirefen_tavern_wall_fire_core.ts: the fire
        stands in the mouth, drawn by the runtime, and nothing stands between it and the room)."""
        p, clutter = self.frame, self.clutter
        R = self.roof
        f = self.fire
        face = f['x'] - f['hw']                  # the breast's face (TAVERN_WALL_FIRE_MOUTH.face)
        back = face + 0.05                       # the soot panel
        zc = f['z']
        z0, z1 = zc - f['hd'], zc + f['hd']
        m0, m1 = zc - 0.95, zc + 0.95            # the mouth's sides
        lintel, hearth = 1.85, 0.06
        xw = self.ix + 0.05
        shelf = 2.78                             # where the breast steps back over the mantel
        face2, za, zb = face + 0.22, z0 + 0.2, z1 - 0.2
        face3, za3, zb3 = face2 + 0.3, za + 0.35, zb - 0.35

        def top_at(x, z):
            # (a hand up into the roof's slab: no gap under the sarking, never out through the slates)
            return R.under(x, z) + 0.12

        crown = max(top_at(x, z) for x in (face3, xw) for z in (za3, zb3)) + 0.05

        def stone(seed, k=0.92, sooty=False):
            def cell(i, j, u0, u1, v0, v1):
                soot = 0.0
                if sooty and lintel - 0.1 <= v0 < 6.0 and m0 - 0.4 <= z0 + (u0 + u1) / 2 <= m1 + 0.4:
                    soot = 0.3 * (1.0 - (v0 - lintel) / 4.2)
                return K.tint(STONE_T, k * (1.0 - max(0.0, soot)), seed, i, j, spread=0.06), STONE
            return cell

        def bulge(seed):
            return lambda u, v: 0.022 * vnoise(u / 1.2, v / 1.1, seed)

        # the lower breast's face, round the mouth, and its two sides back to the wall
        front = Wall(face, z0, face, z1, (-1.0, 0.0))
        K.skin(p, front, lines(0.0, z1 - z0, 0.95, (m0 - z0, m1 - z0)), lines(0.0, shelf, 0.95, (lintel,)),
               bulge(670.0), 1, stone(671.0, sooty=True),
               hole=lambda a, b, c, d: a >= m0 - z0 - 1e-6 and b <= m1 - z0 + 1e-6 and d <= lintel + 1e-6)
        for zz, out in ((z0, -1.0), (z1, 1.0)):
            side = Wall(face, zz, xw, zz, (0.0, out))
            K.skin(p, side, lines(0.0, xw - face, 0.7), lines(0.0, shelf, 0.95), bulge(672.0 + out), 1,
                   stone(673.0 + out, 0.86))
        # the upper breast, a step back and narrower, up to the set-off
        front2 = Wall(face2, za, face2, zb, (-1.0, 0.0))
        K.skin(p, front2, lines(0.0, zb - za, 1.1), lines(shelf - 0.05, SETOFF, 1.5), bulge(674.0), 1,
               stone(675.0, sooty=True))
        for zz, out in ((za, -1.0), (zb, 1.0)):
            side = Wall(face2, zz, xw, zz, (0.0, out))
            K.skin(p, side, lines(0.0, xw - face2, 0.5), lines(shelf - 0.05, SETOFF, 1.5), bulge(676.0 + out), 1,
                   stone(677.0 + out, 0.86))
        # the set-off: a dressed weathering over the upper breast, sloping back to the flue's breast
        lip = SETOFF - 0.12
        K.block(p, [(face2 - 0.05, lip, za - 0.05), (xw, lip, za - 0.05), (xw, lip, zb + 0.05),
                    (face2 - 0.05, lip, zb + 0.05), (face3 - 0.02, SETOFF + 0.48, za3 - 0.02),
                    (xw, SETOFF + 0.48, za3 - 0.02), (xw, SETOFF + 0.48, zb3 + 0.02),
                    (face3 - 0.02, SETOFF + 0.48, zb3 + 0.02)], K.tint(DRESSED_T, 0.84, 1907), DRESSED)
        # the flue's breast up the gable into the sarking, its top following the roof's slope
        front3 = Wall(face3, za3, face3, zb3, (-1.0, 0.0))
        K.skin(p, front3, lines(0.0, zb3 - za3, 1.1), lines(SETOFF + 0.3, crown, 2.4), bulge(1901.0), 1,
               stone(1902.0, 0.9), top=lambda u: top_at(face3, za3 + u))
        for zz, out in ((za3, -1.0), (zb3, 1.0)):
            side = Wall(face3, zz, xw, zz, (0.0, out))
            K.skin(p, side, lines(0.0, xw - face3, 0.5), lines(SETOFF + 0.3, crown, 2.4), bulge(1903.0 + out), 1,
                   stone(1905.0 + out, 0.84), top=lambda u, zz=zz: top_at(face3 + u, zz))
        # quoins up the lower and upper breasts' corners
        self._quoins(p, (face, z0), (-1.0, 0.0), (0.0, -1.0), 0.0, shelf - 0.22, 680.0, course=0.84)
        self._quoins(p, (face, z1), (-1.0, 0.0), (0.0, 1.0), 0.0, shelf - 0.22, 681.0, course=0.84)
        self._quoins(p, (face2, za), (-1.0, 0.0), (0.0, -1.0), shelf + 0.05, lip - 0.02, 682.0, course=1.3)
        self._quoins(p, (face2, zb), (-1.0, 0.0), (0.0, 1.0), shelf + 0.05, lip - 0.02, 683.0, course=1.3)
        # the mouth: the soot panel, the jambs either side, the flat arch over it
        K.face(p, [(back, 0.0, m0), (back, 0.0, m1), (back, lintel + 0.02, m1), (back, lintel + 0.02, m0)],
               (-1, 0, 0), SOOT, PLAIN, tag=K.FLAT)
        for s, zz in ((-1, m0), (1, m1)):
            for k, (v0, v1) in enumerate(((hearth, 0.98 + jit(0.06, 684, s)), (0.98 + jit(0.06, 684, s), lintel))):
                wide = 0.46 if k == 0 else 0.34
                za_, zb_ = (zz - wide, zz) if s < 0 else (zz, zz + wide)
                y0 = v0 - 0.012 if k == 0 else v0 + 0.02
                pts = [(face - 0.09, y0, za_), (back + 0.06, y0, za_), (back + 0.06, y0, zb_),
                       (face - 0.09, y0, zb_), (face - 0.09, v1 - 0.02, za_), (back + 0.06, v1 - 0.02, za_),
                       (back + 0.06, v1 - 0.02, zb_), (face - 0.09, v1 - 0.02, zb_)]
                pts = [(x + (jit(0.02, 685, s, k, i) if x < face else 0.0), y, z + jit(0.025, 686, s, k, i))
                       for i, (x, y, z) in enumerate(pts)]
                faces = K.block(p, pts, K.tint(DRESSED_T, 0.9, 687, s, k, spread=0.05), DRESSED)
                for fc in faces:
                    cz_ = sum(-v.co.y for v in fc.verts) / len(fc.verts)
                    if abs(cz_ - zz) < 0.05:
                        p.paint([fc], K.tint((0.3, 0.27, 0.25), 1.0, 688, s, k), DRESSED)
        # the flat arch: two springers and a key, their joints leaning out
        springs = [(m0 - 0.5, m0 - 0.42, zc - 0.36, zc - 0.44), (zc - 0.36, zc - 0.44, zc + 0.36, zc + 0.44),
                   (zc + 0.36, zc + 0.44, m1 + 0.5, m1 + 0.42)]
        for k, (lo0, hi0, lo1, hi1) in enumerate(springs):
            yt = lintel + (0.66 if k == 1 else 0.56)
            dx = -0.12 if k == 1 else -0.1
            pts = [(face + dx, lintel, lo0), (back + 0.06, lintel, lo0), (back + 0.06, lintel, lo1),
                   (face + dx, lintel, lo1), (face + dx, yt, hi0), (back + 0.06, yt, hi0), (back + 0.06, yt, hi1),
                   (face + dx, yt, hi1)]
            faces = K.block(p, pts, K.tint(DRESSED_T, 0.9 if k != 1 else 0.96, 689, k, spread=0.04), DRESSED)
            p.paint([faces[0]], K.tint((0.24, 0.21, 0.2), 1.0, 690, k), DRESSED)
        # the hearthstone before the mouth (its top on the fire's hearth line, never over it)
        for k, (za_, zb_) in enumerate(((zc - 1.45, zc + 0.08), (zc + 0.12, zc + 1.45))):
            fx = face - 1.05 + jit(0.06, 691, k)
            pts = [(fx, -0.14, za_), (back, -0.14, za_), (back, -0.14, zb_), (fx + jit(0.05, 692, k), -0.14, zb_),
                   (fx + 0.03, hearth - 0.018, za_ + 0.02), (back, hearth, za_), (back, hearth, zb_),
                   (fx + 0.03 + jit(0.05, 692, k), hearth - 0.018, zb_ - 0.02)]
            K.block(p, pts, K.tint(DRESSED_T, 0.8, 693, k, spread=0.05), DRESSED)
        # the mantel shelf on two stone corbels
        my = shelf - 0.11
        K.hewn(p, (face - 0.1, my, z0 - 0.28), (face - 0.1, my, z1 + 0.28), 0.82, 0.22, K.tint(OAK, 0.66, 694), TIMBER,
               seed=695, sag=0.02, segs=2)
        for k, zz in enumerate((z0 + 0.3, z1 - 0.3)):
            K.lump(p, (face - 0.14, my - 0.36, zz), (0.42, 0.5, 0.36), K.tint(DRESSED_T, 0.88, 696, k), DRESSED,
                   seed=697 + k, rough=0.1)
        # on the mantel: a tankard of ale, two turned brass candlesticks with their candles lit, a pewter
        # plate stood on edge against the breast, its rim and its well to the room
        mt = my + 0.12
        Fu.tankard(clutter, Fu.Spot(face - 0.1, zc - 1.25, 0.6), 0.0, mt, 0.0, 696)
        for k, zz in enumerate((zc - 0.62, zc + 0.68)):
            foot = Vector((face - 0.1, mt, zz))
            Fu.lathe(clutter, foot, [(0.1, -0.004), (0.035, 0.07), (0.03, 0.22), (0.065, 0.25)], 6, BRASS, METAL,
                     tip1=0.235, phase=k)
            Fu.candle(clutter, foot + Vector((0.0, 0.23, 0.0)), 0.24 - 0.06 * k, 0.045, 697 + k, flame_h=0.15)
        Fu.lathe(clutter, (face + 0.09, mt + 0.27, zc + 1.2), [(0.19, -0.03), (0.26, 0.0), (0.21, 0.006)], 8,
                 (0.55, 0.56, 0.58), METAL, axis=(-1.0, 0.12, 0.05), tip1=-0.012)

    # ================================================================== trusses
    def trusses(self):
        """The hammer-beam trusses at the hall's bays (HALL['trusses'], along x), each spanning
        the hall from the back wall to the front under the roof that runs along the road: on each
        eave wall a stone corbel, a wall post up from it and a curved knee brace into the hammer
        beam's underside; the hammer beam thrown out of the wall from under the eaves' sarking to
        its carved end; the hammer post up from it to the principal rafter, an arched brace from
        there up to the collar under the ridge, and a king post from the collar to the ridge beam.
        Every timber keeps a hand under the sarking (CLEAR under Roof.under), and nothing crosses
        the room under the camera's air: the hammer beams' undersides stand over it (BEAM_FLOOR),
        and only the wall posts and knee braces under them come lower, within WALL_ZONE of the
        walls."""
        self.ridge_pts = self._ridge_line()
        for k, xt in enumerate(self.H['trusses']):
            self._truss(xt, 800.0 + 40 * k)

    def _ridge_line(self):
        """The ridge beam's centre line along the hall, gable to gable, its top edges tucked a
        hand under the sarking either side of the ridge, sagging with it."""
        R = self.roof
        xe = self.ix + 0.15

        def allowed(x, z):
            return min(R.under(x, z - RIDGE_W / 2), R.under(x, z + RIDGE_W / 2)) - CLEAR - RIDGE_H / 2

        pts = []
        for i, x in enumerate((-xe, -7.7, 0.0, 7.7, xe)):
            z = R.rz + (jit(0.03, 850, i) if 0 < i < 4 else 0.0)
            pts.append((x, allowed(x, z) - abs(jit(0.03, 851, i)), z))
        return self._fit(pts, allowed)

    def _ridge_at(self, x):
        """The ridge beam's centre height over x."""
        pts = self.ridge_pts
        for a, b in zip(pts, pts[1:]):
            if a[0] <= x <= b[0]:
                return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
        return pts[0][1] if x < pts[0][0] else pts[-1][1]

    def _truss(self, xt, seed):
        p = self.frame
        R = self.roof
        rz = R.rz

        # the principal rafters: one timber from wall to wall over the ridge, under the sarking
        # all along (lowered wherever the bell-cast sags between its points)
        def allowed(x, z):
            return min(under_line(R, x + dx, z, PRINCIPAL) for dx in (-PRINCIPAL_W / 2, PRINCIPAL_W / 2))

        zs = (self.iz0 - 0.06, -9.3, -4.4, rz, 5.4, 9.3, self.iz1 + 0.06)
        prin = self._fit([(xt, allowed(xt, z) - abs(jit(0.02, seed, 30, i)), z) for i, z in enumerate(zs)], allowed)
        p.beam(prin, PRINCIPAL, PRINCIPAL_W, roof_oak(seed, 8, k=0.78), TIMBER, up=(1.0, 0.0, 0.0))

        def prin_under(z):
            y, s = self._along(prin, z)
            return y - 0.5 * PRINCIPAL * math.hypot(1.0, s)

        # the collar, level under the ridge, its ends tucked up under the principals
        top = COLLAR_Y + COLLAR_H
        ends = []
        for o in (-1.0, 1.0):
            z = rz
            while abs(z - rz) < 9.0 and prin_under(z + o * 0.05) > top - 0.02:
                z += o * 0.05
            ends.append(z + o * 0.12)
        zc0, zc1 = ends
        K.hewn(p, (xt, COLLAR_Y + COLLAR_H / 2, zc0), (xt, COLLAR_Y + COLLAR_H / 2, zc1), 0.4, COLLAR_H,
               roof_oak(seed, 20, k=0.8), TIMBER, seed=seed + 20, sag=0.0, wander=0.015, segs=2)
        self.collars[xt] = (COLLAR_Y, zc0, zc1)
        # the king post from the collar up into the ridge beam
        K.hewn(p, (xt, top - 0.03, rz), (xt, self._ridge_at(xt) - RIDGE_H / 2 + 0.1, rz), 0.34, 0.34,
               roof_oak(seed, 21), TIMBER, seed=seed + 21, up=(1.0, 0.0, 0.0), segs=1)
        for side, zc in ((-1, zc0), (1, zc1)):
            self._truss_end(xt, side, seed + (side + 1) * 6, prin_under, zc)

    def _truss_end(self, xt, side, seed, prin_under, zc):
        """A truss's end on the back wall (side -1) or the front (1): the hammer beam out of the
        wall under the eaves' sarking, as deep as the sarking leaves over the room's air, its
        carved end; the corbel, the wall post and the knee brace under it against the wall; the
        hammer post up from its end into the principal, and the arched brace from there up to the
        collar's end (zc)."""
        p = self.frame
        R = self.roof
        zw = self.iz1 if side > 0 else self.iz0
        o = -float(side)                 # inward along z

        def z_at(u):
            return zw + o * u

        # the hammer beam: level, its top a hand under the sarking where it leaves the wall
        _, h = self._level(HAMMER_W, HAMMER_H, seed + 4)
        top = min(R.under(xt + dx, z_at(u)) for dx in (-0.3, 0.3) for u in (-0.12, 0.0)) - CLEAR - 0.012
        hb = min(h, top - BEAM_FLOOR)
        under = top - hb
        K.hewn(p, (xt, top - hb / 2, z_at(-0.12)), (xt, top - hb / 2, z_at(HAMMER_REACH)), HAMMER_W,
               HAMMER_H * hb / h, roof_oak(seed, 4, k=0.8), TIMBER, seed=seed + 4, segs=2, wander=0.02)
        # its carved end, standing proud over it (never under its underside)
        K.lump(p, (xt, under + 0.03 + (hb + 0.2) / 2, z_at(HAMMER_REACH - 0.1)), (0.56, hb + 0.2, 0.34),
               roof_oak(seed, 5, k=0.72), TIMBER, seed=seed + 5, rough=0.08)
        # the stone corbel, the wall post up from it into the beam, the knee brace curving from the
        # post up into the beam's underside
        foot = FOOT_FRONT if side > 0 else FOOT_BACK
        K.lump(p, (xt, foot - 0.2, z_at(0.15)), (0.62, 0.4, 0.5), K.tint(DRESSED_T, 0.86, seed, 1), DRESSED,
               seed=seed + 1, rough=0.12)
        K.hewn(p, (xt, foot - 0.06, z_at(0.2)), (xt, under + 0.1, z_at(0.2)), 0.4, 0.42, roof_oak(seed, 2), TIMBER,
               seed=seed + 2, up=(1.0, 0.0, 0.0), segs=1)
        ys = max(foot + 0.1, under - 1.25)
        pts = []
        for a in (0.0, 0.62, 1.15, math.pi / 2):
            u = WALL_ZONE - (WALL_ZONE - 0.36) * math.cos(a)
            pts.append((xt, ys + (under + 0.07 - ys) * math.sin(a), z_at(u)))
        p.beam(pts, 0.3, 0.28, roof_oak(seed, 3, k=0.84), TIMBER, up=(1.0, 0.0, 0.0))
        # the hammer post up from the beam's end into the principal
        uh = HAMMER_REACH - 0.32
        head = prin_under(z_at(uh))
        K.hewn(p, (xt, top - 0.03, z_at(uh)), (xt, head + 0.1, z_at(uh)), 0.36, 0.36, roof_oak(seed, 7), TIMBER,
               seed=seed + 7, up=(1.0, 0.0, 0.0), segs=1)
        # the arched brace from the hammer post's head up to the collar's end, bowed down into
        # the room (with its fellow from the other wall, the truss's great arch)
        a = Vector((z_at(uh + 0.1), head - 0.14))
        b = Vector((zc + o * 0.15, COLLAR_Y + 0.08))
        dn = Vector((-(b - a).y, (b - a).x)).normalized()
        if dn.y > 0:
            dn = -dn
        arc = []
        for t in (0.0, 0.3, 0.68, 1.0):
            q = a.lerp(b, t) + dn * (0.6 * math.sin(math.pi * t))
            arc.append((xt, q.y, q.x))
        p.beam(arc, 0.32, 0.3, roof_oak(seed, 9), TIMBER, up=(1.0, 0.0, 0.0))

    def roof_timbers(self):
        """The ridge beam and the purlins, gable to gable along the hall (their ends into the
        gable walls), each sagging with the roof a hand under its sarking: the ridge beam over the
        king posts, a purlin down each slope at the collars' ends, and one over the hammer posts'
        heads (the front one right over the chandelier, which hangs from it: inn_lights.py)."""
        p = self.frame
        R = self.roof
        xe = self.ix + 0.15
        p.beam(self.ridge_pts, RIDGE_W, RIDGE_H, roof_oak(852, k=0.74), TIMBER)
        ends = list(self.collars.values())
        cz = self.L['chandelier']['z']
        rows = (-cz, sum(c[1] for c in ends) / len(ends) - 0.15, sum(c[2] for c in ends) / len(ends) + 0.15, cz)

        def allowed(x, z):
            return under_line(R, x, z, PURLIN_H)

        for k, z in enumerate(rows):
            pts = []
            for i, x in enumerate((-xe, -7.7, 0.0, 7.7, xe)):
                # (dead on its line over the chandelier, x 0; wandering a little elsewhere)
                wob = i in (1, 3)
                zz = z + (jit(0.04, 853, k, i) if wob else 0.0)
                pts.append((x, allowed(x, zz) - (abs(jit(0.03, 854, k, i)) if wob else 0.0), zz))
            s = slope_z(R, 0.0, z)
            c = 1.0 / math.hypot(1.0, s)
            p.beam(self._fit(pts, allowed), PURLIN_W, PURLIN_H, roof_oak(855, k, k=0.76), TIMBER,
                   up=(0.0, c, -s * c))

    # ================================================================== the bar
    def bar(self):
        """The bar's two counters on the platform, either side of the great post: chunky oak on
        a dark plinth, a thick top slab overhanging the drinkers' side, the front framed in stiles
        and rails round raised fields; the iron foot rail along the long one (trim). Over the bar
        the beam the post carries runs out into the right gable wall on its own post and brace
        there, tankards hung from its hooks."""
        p, trim, clutter = self.frame, self.trim, self.clutter
        post = self.pillar_q
        for ci, q in enumerate(self.counters):
            seed = 720.0 + ci * 30
            x, z, base = q['x'], q['z'], q['base']
            top = base + q['height']
            long_x = q['hw'] >= q['hd']
            L = q['hw'] if long_x else q['hd']
            D = q['hd'] if long_x else q['hw']
            if long_x:
                def pt(u, y, w, x=x, z=z):
                    return (x + u, y, z + w)
                front = (0.0, 0.0, 1.0)
            else:
                def pt(u, y, w, x=x, z=z):
                    return (x - w, y, z + u)
                front = (-1.0, 0.0, 0.0)

            def size(su, sy, sw, long_x=long_x):
                return (su, sy, sw) if long_x else (sw, sy, su)

            # the ends: run into the post where they meet it
            ends = []
            for s in (-1, 1):
                ex, _, ez = pt(s * L, 0.0, 0.0)
                near = math.hypot(ex - post['x'], ez - post['z']) < post['r'] + 0.3
                ends.append(s * (L + (0.3 if near else 0.12)))
            K.lump(p, pt(0.0, base + 0.1, -0.02), size(2 * L - 0.08, 0.22, 2 * D - 0.06), K.tint(OAK, 0.5, seed, 1),
                   TIMBER, seed=seed + 1, rough=0.04)
            K.lump(p, pt(0.0, (base + 0.2 + top - 0.2) / 2, -0.06), size(2 * L - 0.18, top - base - 0.4, 2 * D - 0.24),
                   K.tint(OAK, 0.56, seed, 2), TIMBER, seed=seed + 2, rough=0.03)
            K.hewn(p, pt(ends[0], top - 0.11, 0.08), pt(ends[1], top - 0.11, 0.08), 2 * D + 0.36, 0.22,
                   K.tint(OAK, 0.86, seed, 3), TIMBER, seed=seed + 3, sag=0.012, wander=0.025, segs=2)
            # the front: stiles, rails and the raised fields between
            n = max(1, int(round(2 * L / 1.75)))
            us = [-L + 0.1 + (2 * L - 0.2) * i / n for i in range(n + 1)]
            for i, u in enumerate(us):
                K.hewn(p, pt(u, base + 0.2, D - 0.04), pt(u + jit(0.03, seed, 4, i), top - 0.22, D - 0.04), 0.24, 0.12,
                       K.tint(OAK, 0.74, seed, 5, i), TIMBER, seed=seed + 5 + i, up=front, segs=1)
            for k, y in enumerate((base + 0.32, top - 0.34)):
                K.hewn(p, pt(-L + 0.05, y, D - 0.03), pt(L - 0.05, y + jit(0.02, seed, 6, k), D - 0.03), 0.1, 0.2,
                       K.tint(OAK, 0.7, seed, 7, k), TIMBER, seed=seed + 7 + k, segs=1)
            for i in range(n):
                um = (us[i] + us[i + 1]) / 2
                K.lump(p, pt(um, (base + top) / 2 - 0.01, D - 0.06),
                       size(us[i + 1] - us[i] - 0.42, top - base - 0.98, 0.12),
                       K.tint(OAK, 0.86, seed, 8, i, spread=0.05), TIMBER, seed=seed + 8 + i, rough=0.05)
            if long_x:
                # the iron foot rail on the drinkers' side, on its brackets (trim)
                ry, rw = base + 0.3, D + 0.34
                trim.cylinder(pt(-L + 0.2, ry, rw), pt(L - 0.2, ry, rw), 0.05, IRON, METAL, sides=6)
                for i in range(4):
                    u = -L + 0.45 + (2 * L - 0.9) * i / 3
                    K.hewn(trim, pt(u, ry - 0.08, D - 0.02), pt(u, ry, rw), 0.06, 0.06, IRON, METAL, seed=seed + 12 + i,
                           segs=1)
        # the beam the post carries out into the right gable wall (the sarking stands far over it
        # there), its own wall post and brace under it on the wall
        tr = self.H['truss']
        zp = post['z']
        _, h = self._level(0.5, 0.58, 760)
        K.hewn(p, (post['x'] - 0.2, tr + h / 2, zp), (self.ix + 0.15, tr + h / 2, zp), 0.5, 0.58,
               K.tint(OAK, 0.6, 760), TIMBER, seed=760, sag=0.0, wander=0.02, segs=3)
        self._bar_foot(zp, tr, 770.0)
        # its hooks (trim) and the tankards on them, unless the props' racks of tankards hang from
        # it (inn_props.TANKARD_RACKS)
        for i, hx in enumerate(() if 'hanging_tankards' in PR.PROPS else (6.6, 8.4, 10.2, 12.0)):
            K.hewn(trim, (hx, tr + 0.02, zp + 0.05), (hx, tr - 0.3, zp + 0.08), 0.045, 0.045, IRON, METAL, seed=780 + i,
                   segs=1)
            if i == 1:
                continue
            ty = tr - 0.78 + jit(0.05, 781, i)
            col = (0.52, 0.53, 0.55) if i % 2 else K.tint(OAK, 0.7, 782, i)
            mat = METAL if i % 2 else TIMBER
            clutter.cylinder((hx, ty, zp + 0.1), (hx, ty + 0.42, zp + 0.1), 0.15, col, mat, sides=6, r1=0.13)
            K.hewn(clutter, (hx + 0.15, ty + 0.34, zp + 0.1), (hx + 0.24, ty + 0.12, zp + 0.1), 0.05, 0.05, col, mat,
                   seed=783 + i, segs=1)

    def _bar_foot(self, zp, under, seed):
        """The bar beam's foot on the right gable wall: a stone corbel, the wall post up from it
        into the beam, and a brace curving from the post out and up into the beam's underside."""
        p = self.frame
        xw = self.ix
        K.lump(p, (xw - 0.12, 6.06, zp), (0.56, 0.46, 0.62), K.tint(DRESSED_T, 0.86, seed, 1), DRESSED,
               seed=seed + 1, rough=0.12)
        K.hewn(p, (xw - 0.17, 6.26, zp), (xw - 0.17, under + 0.1, zp), 0.42, 0.4, roof_oak(seed, 2), TIMBER,
               seed=seed + 2, up=(1.0, 0.0, 0.0), segs=1)
        ys, reach = under - 2.3, 2.6
        pts = []
        for a in (0.0, 0.62, 1.15, math.pi / 2):
            u = reach - (reach - 0.34) * math.cos(a)
            pts.append((xw - u, ys + (under + 0.07 - ys) * math.sin(a), zp))
        p.beam(pts, 0.28, 0.32, roof_oak(seed, 3, k=0.84), TIMBER, up=(0.0, 0.0, 1.0))

    def pillar(self):
        """The bar's great post (BarPillar, cut away for the camera): an octagonal oak trunk on a
        dressed stone plinth, banded in iron, a shelf ring round it at head height on four
        brackets with its bottles (on the post's own part, so they go when it cuts away), and a
        flared capital and bolster under the beam it
        carries, everything within its reach and under the truss line (HALL['truss'])."""
        p = self.post
        q = self.pillar_q
        x, z, base = q['x'], q['z'], q['base']
        top = self.H['truss']
        oct_ = math.pi / 8
        p.cylinder((x, base - 0.04, z), (x, base + 0.55, z), 1.14, K.tint(DRESSED_T, 0.8, 700), DRESSED, sides=8,
                   r1=1.02, phase=oct_ + 0.06)
        # the trunk: eight hewn faces, pale and dark by turns, swelling a little at its foot and
        # leaning a touch as it climbs
        pts = [(x, base + 0.45, z), (x + jit(0.04, 701), base + 3.4, z + jit(0.04, 702)),
               (x + jit(0.05, 703), base + 6.3, z + jit(0.05, 704)), (x + 0.04, top - 0.8, z - 0.03)]
        p.sweep(pts, 0.94, 0.84, K.tint(OAK_PALE, 0.9, 705), sides=8, mat=TIMBER, up=(1.0, 0.0, 0.0), phase=oct_,
                radii=[0.96, 0.9, 0.87, 0.84], color_fn=lambda i, k: K.tint(OAK_PALE, 0.78 + 0.16 * (k % 2), 706, i, k))
        for y, r in ((base + 1.15, 0.96), (top - 1.3, 0.9)):
            p.cylinder((x, y, z), (x, y + 0.18, z), r, IRON, METAL, sides=8, phase=oct_)
        # the shelf ring at head height, on its brackets
        ys = base + 2.75
        prof = [(0.84, ys), (1.38, ys), (1.44, ys + 0.13), (0.84, ys + 0.13)]
        self._lathe(p, x, z, prof, 8, lambda k, i: K.tint(OAK, 0.92 if k == 2 else 0.8, 707, k, i), TIMBER,
                    phase=oct_)
        for k in range(4):
            a = math.pi / 2 * k + math.pi / 4
            ax, az = around(x, z, 0.86, a)
            bx, bz = around(x, z, 1.28, a)
            K.hewn(p, (ax, ys - 0.8, az), (bx, ys - 0.04, bz), 0.16, 0.2, K.tint(OAK, 0.72, 708, k), TIMBER,
                   seed=709 + k, segs=1, up=(0.0, 1.0, 0.0))
        # the capital and its bolster under the beam
        p.cylinder((x + 0.04, top - 0.82, z - 0.03), (x + 0.04, top - 0.3, z - 0.03), 0.86, K.tint(OAK, 0.8, 710),
                   TIMBER, sides=8, r1=1.2, phase=oct_)
        K.lump(p, (x + 0.04, top - 0.165, z - 0.03), (1.9, 0.27, 1.85), K.tint(OAK, 0.7, 711), TIMBER, seed=712,
               rough=0.05)
        # the bottles on the shelf, on the post's own part: they cut away with it (turned, corked,
        # smooth shaded, inn_furnish.bottle; every fourth a stoneware crock with its lid)
        c = p
        for k in range(8):
            a = math.tau * k / 8 + jit(0.14, 713, k)
            bx, bz = around(x, z, 1.16 + jit(0.06, 714, k), a)
            y0 = ys + 0.13
            hgt = 0.42 + 0.24 * hash01(715, k)
            r = 0.09 + 0.03 * hash01(716, k)
            if k % 4 == 3:
                Fu.lathe(c, (bx, y0, bz), [(r + 0.04, -0.003), (r + 0.05, hgt * 0.4), (r * 0.9, hgt * 0.66),
                                           (r * 0.95, hgt * 0.7)], 7, CROCK[k % 3], PLAIN, tip1=hgt * 0.72,
                         phase=k)
                continue
            Fu.bottle(c, Fu.Spot(bx, bz, 0.0), 0.0, y0, 0.0, 717 + k, GLASS[k % len(GLASS)], h=hgt, r=r, sides=7)

    # ================================================================== the stage
    def _curtain(self, p, wall, u0, u1, v0, v1, seed, pleat=0.5, deep=0.17):
        """A hanging on a wall: garnet cloth gathered in deep pleats, bellying a little as it
        falls and flaring at its hem, its head under a scalloped valance with a gold fringe, on
        an oak pole (the pole's iron brackets are trim)."""
        n = max(2, int(round((u1 - u0) / (pleat / 2))))
        us = [u0 + (u1 - u0) * i / n for i in range(n + 1)]
        vs = [v0, v0 + (v1 - v0) * 0.4, v1 - 0.55]

        def depth(u, v):
            i = int(round((u - u0) / ((u1 - u0) / n)))
            fold = deep if i % 2 else 0.03
            hem = 0.06 * max(0.0, 1.0 - (v - v0) / 1.2)
            return 0.06 + fold + hem + 0.05 * math.sin(math.pi * (v - v0) / (v1 - v0)) + 0.03 * jit(1.0, seed, i)

        def cell(i, j, a, b, c, d):
            return K.tint(GARNET, 0.94 if i % 2 else 0.78, seed, i, j, spread=0.04), CLOTH

        K.skin(p, wall, us, vs, depth, 1, cell, soft=True)
        # the valance: a scalloped band hung before the curtain's head, a gold fringe under it
        m = max(3, n // 2)
        hi, lo, fr = [], [], []
        for i in range(m + 1):
            u = u0 - 0.06 + (u1 - u0 + 0.12) * i / m
            dip = 0.22 * abs(math.sin(math.pi * max(1, round((u1 - u0) / 1.3)) * (u - u0) / (u1 - u0)))
            w = 0.36 + (0.05 if i % 2 else 0.0)
            hi.append(wall.pt(u, v1 + 0.05, w))
            lo.append(wall.pt(u, v1 - 0.6 - dip, w + 0.03))
            fr.append(wall.pt(u, v1 - 0.72 - dip, w + 0.04))
        for i in range(m):
            K.face(p, [hi[i], hi[i + 1], lo[i + 1], lo[i]], tuple(wall.n), K.tint(GARNET, 0.7, seed, 30, i), CLOTH,
                   soft=True)
            K.face(p, [lo[i], lo[i + 1], fr[i + 1], fr[i]], tuple(wall.n), GOLD, PLAIN)
        # the pole over it all, on two iron brackets
        a, b = wall.pt(u0 - 0.24, v1 + 0.14, 0.3), wall.pt(u1 + 0.24, v1 + 0.14 + jit(0.03, seed, 31), 0.3)
        K.hewn(p, a, b, 0.13, 0.13, K.tint(OAK, 0.6, seed, 31), TIMBER, seed=seed + 31, segs=1)
        for k, u in enumerate((u0 + 0.2, u1 - 0.2)):
            K.hewn(self.trim, tuple(wall.pt(u, v1 + 0.14, 0.0)), tuple(wall.pt(u, v1 + 0.14, 0.34)), 0.05, 0.05, IRON,
                   METAL, seed=seed + 34 + k, segs=1)

    def stage(self):
        """The bard's stage in the back left corner (its deck is laid with the floors): a step
        board along its front, garnet hangings on the two walls behind it (the left wall's
        either side of its window), and a row of footlights along its lip."""
        p = self.frame
        st = self.st
        x0, x1, z1, lift = st['x0'], st['x1'], st['z1'], st['lift']
        # the front step: an oak board laid on the bevel, its top half way up
        sy = 0.24
        zf = z1 + 0.41
        pts = [(x0 - 0.1, -0.03, z1 + 0.08), (x1 - 0.12, -0.03, z1 + 0.08), (x1 - 0.12, -0.03, zf),
               (x0 - 0.1, -0.03, zf + 0.02), (x0 - 0.1, sy, z1 + 0.08), (x1 - 0.12, sy + 0.01, z1 + 0.08),
               (x1 - 0.12 + jit(0.03, 550), sy + 0.012, zf - 0.02), (x0 - 0.1, sy - 0.01, zf)]
        K.block(p, pts, K.tint(OAK, 0.78, 551), TIMBER)
        # the hangings
        self._curtain(p, Wall(x0 + 0.95, self.iz0, x1 - 0.95, self.iz0, (0.0, 1.0)), 0.0, (x1 - 0.95) - (x0 + 0.95),
                      lift + 0.04, 6.1, 560.0)
        win = -10.8
        for k, (za, zb) in enumerate(((self.iz0 + 0.42, win - 0.95), (win + 0.95, z1 - 0.15))):
            self._curtain(p, Wall(-self.ix, za, -self.ix, zb, (1.0, 0.0)), 0.0, zb - za, lift + 0.04, 5.55,
                          570.0 + 10 * k, pleat=0.34)
        # the footlights: the props' cluster of candles on its iron dish (inn_props.py) at every
        # stride along the deck's lip, turned anyhow, a flame on every wick (every tier)
        L = self.lights
        n = 5
        for k in range(n):
            fx = x0 + 0.55 + (x1 - x0 - 1.1) * k / (n - 1)
            at = PR.stand(L, PR.PROPS['table_candles'], Vector((fx, lift, z1 - 0.26)), hash01(580, k) * math.tau,
                          FOOTLIGHT_H)
            Fu.light_wicks(L, 'table_candles', at, 581 + 4 * k)

    # ================================================================== kitchen
    def kitchen(self):
        """The kitchen behind the serving hatch, in the wing (whose walls are the shell's): its
        boarded ceiling (the keeper's floor) on joists, a plastered partition closing it off from
        the cellar, the stone range against it with its fire glowing toward the hatch and its
        breast up into the ceiling, the cook's table just inside the hatch, shelves of pots and
        jars, and herbs hung to dry."""
        p, trim, c = self.frame, self.trim, self.clutter
        W = self.B.WING
        hatch = self.L['hatch']
        x0, x1 = W['x0'] + W['wall'], W['x1'] - W['wall']
        zf = self.H['z0']
        zb = -21.4
        ceil = W['floor']
        hx = (hatch['x0'] + hatch['x1']) / 2
        # the ceiling: boards facing down over the whole wing, joists across the kitchen
        xs, zs = lines(x0 - 0.05, x1 + 0.05, 3.5), lines(W['z0'] + W['wall'] - 0.05, zf + 0.1, 3.5)
        polys = [[(xs[i], zs[j]), (xs[i + 1], zs[j]), (xs[i + 1], zs[j + 1]), (xs[i], zs[j + 1])]
                 for i in range(len(xs) - 1) for j in range(len(zs) - 1)]
        self._sheet(p, polys, lambda x, z: ceil + 0.02 * vnoise(x / 2.0, z / 2.0, 1000.0),
                    lambda x, z: (0.66, 0.58, 0.52), FLOOR, up=False)
        for k, jz in enumerate((-15.3, -17.4, -19.5)):
            K.hewn(p, (x0 - 0.05, ceil - 0.17, jz), (x1 + 0.05, ceil - 0.17 + jit(0.04, 1001, k, 1), jz), 0.3, 0.34,
                   K.tint(OAK, 0.58, 1001, k), TIMBER, seed=1002 + k, segs=1)
        # the partition: plaster between oak posts, a sill and a head rail
        wall = Wall(x0 - 0.05, zb, x1 + 0.05, zb, (0.0, 1.0))

        def cell(i, j, a, b, cc, d):
            # in the range's smoke and shadow: warmer and dimmer than the hall's limewash
            return K.tint((0.98, 0.9, 0.8), 0.7, 1003, i, j, spread=0.05), PLASTER

        K.skin(p, wall, lines(0.0, wall.length, 1.8), lines(0.0, ceil + 0.05, 1.5),
               lambda u, v: 0.025 * vnoise(u / 1.4, v / 1.2, 1004.0), 1, cell)
        for k, px in enumerate((x0 + 0.25, 7.4, 11.6)):
            K.hewn(p, (px, 0.0, zb + 0.06), (px + jit(0.06, 1005, k), ceil, zb + 0.06), 0.3, 0.16,
                   K.tint(OAK, 0.62, 1006, k), TIMBER, seed=1007 + k, up=(0.0, 0.0, 1.0), segs=1)
        for k, y in enumerate((0.16, ceil - 0.25)):
            K.hewn(p, (x0, y, zb + 0.07), (x1, y + jit(0.03, 1008, k), zb + 0.07), 0.14, 0.24,
                   K.tint(OAK, 0.6, 1009, k), TIMBER, seed=1010 + k, segs=1)
        # the range: a stone body, its iron top, the fire's arched mouth glowing at the hatch,
        # the breast over it up into the ceiling and a mantel beam across it
        rz0, rz1 = zb, zb + 1.55
        K.lump(p, (hx, 0.57, (rz0 + rz1) / 2), (3.0, 1.14, rz1 - rz0), K.tint(STONE_T, 0.72, 1011), STONE, seed=1012,
               rough=0.03)
        K.lump(p, (hx, 1.2, (rz0 + rz1) / 2 + 0.05), (3.2, 0.13, rz1 - rz0 + 0.12), IRON, METAL, seed=1013, rough=0.03)
        mw, mt = 0.56, 0.86
        K.face(p, [(hx - mw - 0.1, 0.12, rz1 + 0.035), (hx + mw + 0.1, 0.12, rz1 + 0.035),
                   (hx + mw + 0.1, mt + 0.12, rz1 + 0.035), (hx - mw - 0.1, mt + 0.12, rz1 + 0.035)], (0, 0, 1),
               SOOT, PLAIN)
        mouth = [(hx - mw, 0.16, rz1 + 0.05), (hx + mw, 0.16, rz1 + 0.05)]
        for i in range(6):
            a = math.pi * i / 5
            mouth.append((hx + mw * math.cos(a), mt - 0.22 + 0.22 * math.sin(a), rz1 + 0.05))
        K.face(p, mouth, (0, 0, 1), EMBER, GLOW, tag=K.FLAT)
        for i in range(5):
            a0, a1 = math.pi * i / 5, math.pi * (i + 1) / 5
            ring = []
            for dz in (rz1 - 0.04, rz1 + 0.12):
                for (r, a) in ((1.0, a0), (1.0, a1), (1.45, a1), (1.45, a0)):
                    ring.append((hx + (mw + 0.03) * r * math.cos(a), mt - 0.22 + 0.26 * r * math.sin(a) + 0.02, dz))
            K.block(p, ring, K.tint(DRESSED_T, 0.84, 1014, i, spread=0.05), DRESSED)
        K.lump(p, (hx, (1.26 + ceil) / 2 + 0.05, rz0 + 0.42), (2.3, ceil - 1.26 + 0.1, 0.84),
               K.tint(STONE_T, 0.78, 1015), STONE, seed=1016, rough=0.03)
        K.hewn(p, (hx - 1.55, 2.38, rz0 + 0.95), (hx + 1.55, 2.38, rz0 + 0.95), 0.26, 0.28, K.tint(OAK, 0.56, 1017),
               TIMBER, seed=1018, segs=1)
        # the cook's table just inside the hatch, scrubbed pale
        tz = zf - 1.75
        K.hewn(p, (hx - 1.3, 1.38, tz), (hx + 1.3, 1.38, tz), 1.1, 0.15, K.tint(OAK_PALE, 0.92, 1019), TIMBER,
               seed=1020, segs=1)
        for k, (sx, sz) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            K.hewn(p, (hx + sx * 1.08, 0.0, tz + sz * 0.4), (hx + sx * 1.08, 1.31, tz + sz * 0.4), 0.15, 0.15,
                   K.tint(OAK, 0.7, 1021, k), TIMBER, seed=1022 + k, up=(1.0, 0.0, 0.0), segs=1)
        K.hewn(p, (hx - 1.08, 0.36, tz), (hx + 1.08, 0.36, tz), 0.1, 0.12, K.tint(OAK, 0.66, 1026), TIMBER, seed=1027,
               segs=1)
        # on it, clear of the fire's mouth beyond: a cob loaf and a knife at one end, a crock of
        # flour and two onions at the other
        board = 1.455
        Fu.loaf(c, Fu.Spot(hx, tz, 0.0), -0.92, board, 0.08, 1028)
        K.hewn(c, (hx - 0.55, 1.47, tz + 0.3), (hx - 0.18, 1.47, tz + 0.42), 0.06, 0.02, (0.6, 0.62, 0.64), METAL,
               seed=1032, segs=1)
        Fu.lathe(c, (hx + 0.95, board, tz - 0.18), [(0.17, -0.004), (0.2, 0.22), (0.15, 0.33), (0.17, 0.37)], 6, CROCK[0],
                 PLAIN, tip1=0.3, paint=lambda k, i: ((0.93, 0.9, 0.84), PLAIN) if k == 3 else (CROCK[0], PLAIN))
        for k, (ox, oz) in enumerate(((0.58, 0.24),)):
            Fu.lathe(c, (hx + ox, board - 0.004, tz + oz), [(0.075, 0.07)], 5, (0.86, 0.68, 0.44), PLAIN, tip0=0.0,
                     tip1=0.17, axis=(jit(0.3, 1029, k), 1.0, jit(0.3, 1030, k)), phase=k)
        # the shelves either side of the range, on brackets, and what stands on them
        for side, (sa, sb) in enumerate(((x0 + 0.5, hx - 1.75), (hx + 1.75, x1 - 0.5))):
            sy = 2.9
            K.hewn(p, (sa, sy, zb + 0.28), (sb, sy + jit(0.03, 1033, side), zb + 0.28), 0.5, 0.08,
                   K.tint(OAK, 0.72, 1034, side), TIMBER, seed=1035 + side, segs=1)
            for k, bx in enumerate((sa + 0.3, sb - 0.3)):
                K.hewn(trim, (bx, sy - 0.45, zb + 0.03), (bx, sy - 0.05, zb + 0.46), 0.05, 0.06, IRON, METAL,
                       seed=1036 + side * 2 + k, segs=1)
            # a stoneware crock with its mouth drawn in, and a copper pot, its inside dark
            u = sb - 0.35 if side == 0 else sa + 0.35
            for k in range(2):
                r = 0.13 + 0.08 * hash01(1040, side, k)
                hgt = 0.3 + 0.3 * hash01(1041, side, k)
                at = (u, sy + 0.04, zb + 0.3)
                if k == 1:
                    Fu.lathe(c, at, [(r + 0.04, -0.003), (r + 0.09, hgt * 0.4), (r + 0.07, hgt * 0.6)], 7, COPPER, METAL,
                             tip1=hgt * 0.42, paint=lambda b, i: (COPPER_DARK, METAL) if b == 2 else (COPPER, METAL))
                else:
                    col = CROCK[(k + side) % 3]
                    Fu.lathe(c, at, [(r, -0.003), (r * 1.1, hgt * 0.62), (r * 0.78, hgt)], 6, col, PLAIN, tip1=hgt * 0.9,
                             phase=side, paint=lambda b, i, col=col: (Fu.shade(col, 0.45) if b == 2 else col, PLAIN))
                u += (-1 if side == 0 else 1) * (2 * r + 0.3 + 0.12 * hash01(1042, side, k))
        # two pans hung on the breast, a pot and a kettle on the range
        for k, (dx, r) in enumerate(((-0.62, 0.26), (0.6, 0.21))):
            y = 3.35 - r
            # (a pan's flared side and its dished face to the room, its back on the stone)
            Fu.lathe(c, (hx + dx, y, rz0 + 0.8), [(r * 0.78, 0.0), (r, 0.08)], 7, COPPER if k else COPPER_DARK, METAL,
                     axis=(0.0, 0.0, 1.0), tip1=0.025, phase=k)
            K.hewn(c, (hx + dx, y + r - 0.02, rz0 + 0.88), (hx + dx, y + r + 0.32, rz0 + 0.88), 0.05, 0.03, IRON, METAL,
                   seed=1045 + k, segs=1)
        # the pot: bellied copper, its rim rolled, two lugs to lift it by; the kettle: squat iron,
        # its spout up to the hatch's side and its bail arched over its lid
        px, pz = hx - 0.75, rz1 - 0.55
        Fu.lathe(c, (px, 1.265, pz), [(0.3, 0.0), (0.37, 0.24), (0.33, 0.5), (0.36, 0.53)], 7, COPPER, METAL, tip1=0.42,
                 paint=lambda b, i: (COPPER_DARK, METAL) if b == 3 else (COPPER, METAL))
        for sx in (-1.0, 1.0):
            c.beam([(px + sx * 0.3, 1.71, pz), (px + sx * 0.46, 1.69, pz), (px + sx * 0.33, 1.55, pz)], 0.04, 0.05, IRON,
                   METAL, up=(0.0, 0.0, 1.0), caps=False)
        kx, kz = hx + 0.8, rz1 - 0.5
        Fu.lathe(c, (kx, 1.265, kz), [(0.22, 0.0), (0.28, 0.12), (0.15, 0.3)], 7, IRON, METAL, tip1=0.37)
        Fu.lathe(c, (kx - 0.18, 1.39, kz + 0.08), [(0.055, 0.0), (0.025, 0.24)], 4, IRON, METAL,
                 axis=(-0.75, 0.62, 0.3), phase=0.4, soft=False)
        c.beam([(kx - 0.15, 1.53, kz), (kx - 0.1, 1.82, kz), (kx + 0.1, 1.82, kz), (kx + 0.15, 1.53, kz)], 0.035, 0.035,
               IRON, METAL, caps=False)
        # herbs hung to dry from the joists
        for k in range(2):
            bx = x0 + 2.4 + (x1 - x0 - 4.8) * k + jit(0.3, 1050, k)
            bz = -17.4 + (0.08 if k % 2 else -0.08)
            drop = 0.85 + 0.4 * hash01(1051, k)
            c.beam([(bx, ceil - 0.34, bz), (bx, ceil - 0.3 - drop, bz)], 0.025, 0.025, (0.5, 0.42, 0.3), PLAIN,
                   caps=False)
            # the bundle, its stalks tied at the top and its leafy head hung down
            Fu.lathe(c, (bx, ceil - 0.3 - drop, bz), [(0.04, 0.0), (0.15, 0.22), (0.11, 0.4)], 5, HERB[k % 3], PLAIN,
                     axis=(jit(0.1, 1053, k), -1.0, jit(0.1, 1054, k)), tip0=-0.03, tip1=0.5, phase=k,
                     push=lambda ring, i, k=k: (0.0, 0.04, 0.03)[ring] * jit(1.0, 1055, k, ring, i))
