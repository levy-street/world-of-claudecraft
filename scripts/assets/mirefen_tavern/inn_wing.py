"""The kitchen wing behind the hall (build_tavern.py calls build(B, parts)): the closed kitchen and
cellar under the keeper's floor, a stone storey and a timbered one over it, its own gable to the
back and its own roof, which runs on up over the hall roof's back slope until its ridge dies into
it, meeting it in valleys; and the kitchen's chimney stack out of its ridge. Players never go in;
the kitchen is seen through the hall's serving hatch (inn_interior.py furnishes it).

Its walls stand where the sim's wing boxes stand (src/sim/mirefen_tavern.ts tavernWingWalls):
the east wall on the hall's own line (x WING x1), the back wall at WING z0, and the west wall in
two runs either side of the tower, whose drum is the wall between them. Its north side is the
hall's back wall.
"""
import math

import inn_kit as K
from inn_hall import BRACE_W, POST_W, QUEEN, RAFTER, RAFTER_W, SILL_TOP, STRUT, STUD, TOP_STONE, Hall, Racked
from inn_roof import Roof
from inn_kit import (DRESSED, DRESSED_T, FLOOR, OAK, PLASTER, PLASTER_IN, ROOF, SARKING, SLATE, STONE, STONE_T,
                     TIMBER, Wall, jit, vnoise)

KICK = 0.36
THICK = 0.5
SAG = 0.16
# the timbered storey's girt (its casements' sills) and head rails: the wing stands lower than the
# hall, its storey under its own eaves
WING_SILL = 6.75
WING_HEAD = 8.05


def build(B, parts):
    Wing(B, parts).build()


class Wing:
    def __init__(self, B, parts):
        self.B = B
        self.W = B.WING
        self.parts = parts
        self.hall = Hall(B, parts)
        w = self.W
        self.mid = (w['x0'] + w['x1']) / 2
        self.half = (w['x1'] - w['x0']) / 2
        self.pitch = (w['ridge'] - w['eave']) / self.half
        self.edge = self.half + w['eaveOut']
        self.zb = w['z0'] - w['vergeOut']
        self.zf = w['z1']
        self.hall_roof = Roof(B, {})

    # ----------------------------------------------------------------- roof shape
    def top(self, d, z):
        """The wing roof's slates at distance d from its ridge line and z along it."""
        w = self.W
        if d <= self.half:
            y = w['ridge'] - self.pitch * d
        else:
            y = w['eave'] - KICK * (d - self.half)
        span = (self.zf - self.zb) / 2
        zm = (self.zf + self.zb) / 2
        s = max(0.0, 1.0 - ((z - zm) / span) ** 2)
        y -= SAG * s * max(0.0, 1.0 - d / self.edge)
        y += 0.04 * vnoise(d / 2.1, z / 2.7, 601) + 0.07 * vnoise(z / 1.8, 0.0, 603) * (d / self.edge) ** 3
        return y

    def thick(self, d):
        return THICK if d <= self.half else 0.22

    def valley(self, sx, z):
        """How far out from its ridge the wing's slope on side sx runs at z over the hall roof:
        to the valley where it meets the hall's slates."""
        def over(d):
            return self.top(d, z) - self.hall_roof.height(self.mid + sx * d, z)

        if over(self.edge) >= 0.0:
            return self.edge
        if over(0.0) <= 0.0:
            return 0.0
        lo, hi = 0.0, self.edge
        for _ in range(28):
            mid = (lo + hi) / 2
            if over(mid) > 0.0:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def west_reach(self, z):
        """How far out from its ridge the wing's west slope runs at z: to its eaves, except where
        the tower's drum stands in the way, where it stops against the drum's face (never into
        the nook)."""
        T = self.B.TOWER
        r = T['rOut'] + 0.05
        dz = z - T['z']
        if abs(dz) >= r:
            return self.edge
        return min(self.edge, self.mid - (T['x'] + (r * r - dz * dz) ** 0.5))

    def meet(self):
        """Where the wing's ridge dies into the hall roof's back slope (z)."""
        lo, hi = self.zf, self.hall_roof.rz
        for _ in range(32):
            mid = (lo + hi) / 2
            if self.top(0.0, mid) > self.hall_roof.height(self.mid, mid):
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    # ----------------------------------------------------------------- build
    def build(self):
        self._walls()
        self._roof()
        self._chimney()

    def face(self, out, u0, u1, seed):
        """A wall's timbered face over its stone: settled (its middle sagged a hair, leaning out a
        touch as it rises) and racked a hair through its storey, so its posts lean together."""
        W = self.W
        return Racked(K.Settled(out, TOP_STONE, W['ridge'], sag=0.06, lean=0.05, half=(u1 - u0) / 2 + 1.0,
                                mid=(u0 + u1) / 2), SILL_TOP, W['eave'], 0.012, seed)

    def _walls(self):
        """The wing's walls: a stone storey under a timbered one, framed as the hall's are
        (inn_hall.Hall.frame_storey): the eave walls in four even bays a side, their end bays
        braced, a casement in each of the middle two; the back wall in four under its gable, the
        gable's king post and the posts either side of it carried up from the storey's grid; the
        west wall's two runs either side of the tower's drum, the long one a window bay at the
        corner and a braced bay against the drum (a window there would shutter into it)."""
        B, W, H = self.B, self.W, self.hall
        t = W['wall']
        wall_top = W['eave'] - THICK - 0.1
        tw = B.TOWER
        half = math.sqrt(tw['rOut'] ** 2 - (W['x0'] + t - tw['x']) ** 2)
        tower_z0, tower_z1 = tw['z'] - half, tw['z'] + half
        east = Wall(W['x1'], 0.0, W['x1'], 1.0, (1.0, 0.0))    # u = z
        back = Wall(0.0, W['z0'], 1.0, W['z0'], (0.0, -1.0))    # u = x
        west = Wall(W['x0'], 0.0, W['x0'], 1.0, (-1.0, 0.0))    # u = z
        # the bays: four along each eave wall, four across the back (its middle post the gable's
        # king post)
        zs = [W['z0'] + (W['z1'] - W['z0']) * k / 4 for k in range(5)]
        xs = [W['x0'] + (W['x1'] - W['x0']) * k / 4 for k in range(5)]
        runs = [
            # (part, wall line, u0, u1, the inner face's u0 and u1, posts, upper windows (u, width),
            # lower windows, the braced bays, seed); the west wall stops at the tower's drum
            # on either side
            ('WingWallEast', east, W['z0'], W['z1'], W['z0'] + t, W['z1'],
             [W['z0'] + 0.15, zs[1], zs[2], zs[3], W['z1'] - 0.1],
             [((zs[1] + zs[2]) / 2, 1.25), ((zs[2] + zs[3]) / 2, 1.25)], (-25.8, -19.3), None, 610),
            ('WingWallBack', back, W['x0'], W['x1'], W['x0'] + t, W['x1'] - t,
             [W['x0'] - 0.15, xs[1], xs[2], xs[3], W['x1'] + 0.15],
             [((xs[1] + xs[2]) / 2, 1.25), ((xs[2] + xs[3]) / 2, 1.25)], (12.0,), None, 630),
            ('WingWallWest', west, W['z0'], tower_z0, W['z0'] + t, tower_z0,
             [W['z0'] + 0.15, zs[1], tower_z0 - 0.1], [((zs[0] + zs[1]) / 2, 1.25)], (), {1}, 650),
            ('WingWallWest', west, tower_z1, W['z1'], tower_z1, W['z1'],
             [tower_z1 + 0.1, W['z1'] - 0.1], [], (), set(), 660),
        ]
        for name, out, u0, u1, i0, i1, posts, wins, lows, braces, seed in runs:
            part = self.parts[name]

            def ground(u, out=out):
                x, z = out.xz(u, 0.4)
                return B.ground(x, z) - 0.7

            stone = H.stone_storey(part, out, u0, u1, ground, seed)
            H.sill_cap(part, out, u0, u1, seed + 2)
            face = self.face(out, u0, u1, seed + 7)
            if name == 'WingWallBack':
                # (its top is the gable's tie, laid with the gable)
                H.timber_storey(part, face, u0, u1, lambda u: wall_top, posts, wins, seed + 4, girt=WING_SILL,
                                head=WING_HEAD, plate=False, braces=braces, swing=45.0)
            else:
                # (the eave walls run up into the roof's slab over them, never stopping short of it)
                H.timber_storey(part, face, u0, u1, lambda u: self.top(self.half, u) - THICK / 2, posts, wins,
                                seed + 4, girt=WING_SILL, head=WING_HEAD, braces=braces, swing=45.0)
            for k, u in enumerate(lows):
                H.arched_window(part, out, u, 1.9, 1.3, stone, seed=seed + 20 + k)
            # the inside of the kitchen, up to its ceiling (the keeper's floor)
            inner = Wall(out.o.x - out.n.x * t, out.o.z - out.n.z * t, out.o.x - out.n.x * t + out.d.x,
                         out.o.z - out.n.z * t + out.d.z, (out.n.x, out.n.z))
            us = K.breaks(i0, i1, 2.0)
            K.skin(part, inner, us, K.breaks(0.0, W['floor'] + 0.1, 1.5, keep=(1.0,)),
                   lambda u, v: 0.0, -1,
                   lambda i, j, a, b, c, d: ((K.tint(DRESSED_T, 0.88, seed, 5, i), DRESSED) if d <= 1.0 + 1e-6 else
                                             (K.tint(PLASTER_IN, 0.95, seed, 6, i, j, spread=0.012), PLASTER)))
        # quoins up the two back corners
        for (cx, na, nb, name, seed) in ((W['x1'], (0.0, -1.0), (1.0, 0.0), 'WingWallEast', 670),
                                         (W['x0'], (0.0, -1.0), (-1.0, 0.0), 'WingWallWest', 680)):
            def ground(u):
                return B.ground(cx, W['z0'] - 0.4) - 0.7
            H.quoins(self.parts[name], (cx, W['z0']), nb, na, ground(0.0), TOP_STONE, seed=seed)
        self._gable(wall_top, xs)

    def _gable(self, wall_top, xs):
        """The back gable over the timbered storey, up under the roof: a king-post truss on the
        storey's grid. Its tie along the storey's top, its rafters up under the verge crossing at
        the apex, the king post on the middle line, a post either side on the storey's next bay
        lines up into the rafters, and a raking strut from the king post's foot up to each of
        those posts' heads, where they meet the rafters."""
        W, H = self.W, self.hall
        part = self.parts['WingWallBack']
        out = Wall(0.0, W['z0'], 1.0, W['z0'], (0.0, -1.0))
        face = self.face(out, W['x0'], W['x1'], 637)
        plaster = H.plaster_depth(690)

        def gable_top(u):
            return self.top(abs(u - self.mid), W['z0']) - 0.15

        K.skin(part, face, K.breaks(W['x0'], W['x1'], 1.5, keep=(self.mid,)), K.breaks(wall_top - 0.1, W['ridge'], 1.4),
               lambda u, v: plaster(u, v + 30), 1,
               lambda i, j, a, b, c, d: (K.tint((1.02, 1.0, 0.97), 0.98, 691, i, j, spread=0.02), PLASTER),
               top=gable_top)
        K.hewn(part, face.pt(W['x0'] - 0.2, wall_top, 0.08), face.pt(W['x1'] + 0.2, wall_top, 0.08), 0.32, 0.36,
               K.tint(OAK, 0.82, 692), TIMBER, seed=693, sag=0.05, segs=3)
        tie = wall_top + 0.18
        wf = POST_W

        def under(u):
            """The verge's slab's underside over the face (world)."""
            return self.top(abs(u - self.mid), W['z0']) - THICK

        def raf_c(u):
            return H.v_at(face, u, under(u) + 0.05 - RAFTER[0] / 2, wf)

        def raf_lo(u):
            return H.v_at(face, u, under(u) + 0.1 - RAFTER[0], wf)

        for sx in (-1, 1):
            # (the east one a hair proud of the west where they cross at the apex)
            H.rafter(part, face, self.mid + sx * (self.half + 0.1), self.mid, raf_c,
                     wf + RAFTER_W + (0.012 if sx > 0 else 0.0), 693 + sx, n=4)
        H.oak(part, face, (self.mid, tie - 0.04), (self.mid, raf_c(self.mid)), QUEEN, wf, 694, caps=False)
        for sx, u in ((-1, xs[1]), (1, xs[3])):
            H.oak(part, face, (u, tie - 0.04), (u, H.seat(raf_lo, u, STUD[0] / 2)), STUD, wf, 695 + sx, caps=False)
            H.oak(part, face, (self.mid + sx * (QUEEN[0] / 2 + 0.05), tie + 0.05),
                  (u - sx * (STUD[0] / 2 + 0.04), raf_lo(u) - 0.14), STRUT, BRACE_W, 697 + sx)

    def _roof(self):
        """Slates on the wing's own pitch, kicked at the eaves, the ridge sagged, carved boards
        down the back verge; from the hall's back wall it runs on up over the hall roof's back
        slope, each slope only as far as the valley where it meets the hall's slates, until its
        ridge dies into them."""
        p = self.parts['WingRoof']
        bm = p.bm
        ds = [0.0, 1.6, 3.2, 4.8, self.half, self.half + 0.45, self.edge]
        z_meet = self.meet()
        ncol = 6
        for sx in (-1, 1):
            # over the wing itself, out to its eaves; then over the hall roof, out to the valleys
            # (the west slope's rows close round the tower's drum, where its eaves are cut back)
            T = self.B.TOWER
            drum = [T['z'] + 1.6 * k for k in range(-3, 4)] if sx < 0 else []
            for zs, over_hall in ((K.breaks(self.zb, self.zf, 2.0, keep=drum), False),
                                  (K.breaks(self.zf, z_meet, 1.3), True)):
                if over_hall:
                    reach = [self.valley(sx, z) for z in zs]
                    rows = [[r * i / ncol for i in range(ncol + 1)] for r in reach]
                else:
                    reach = [self.west_reach(z) if sx < 0 else self.edge for z in zs]
                    rows = [[min(d, r) for d in ds] for r in reach]
                top = [[bm.verts.new(K.P(self.mid + sx * (d if over_hall else self._edge_d(d, z)), self.top(d, z), z))
                        for d in row] for z, row in zip(zs, rows)]
                under = [[bm.verts.new(K.P(self.mid + sx * (d if over_hall else self._edge_d(d, z)),
                                           self.top(d, z) - self.thick(d), z)) for d in row] for z, row in zip(zs, rows)]
                for grid, up, col, mat in ((top, 1.0, SLATE, ROOF), (under, -1.0, SARKING, FLOOR)):
                    for j in range(len(zs) - 1):
                        for i in range(len(rows[0]) - 1):
                            if rows[j][i + 1] - rows[j][i] < 1e-4 and rows[j + 1][i + 1] - rows[j + 1][i] < 1e-4:
                                continue   # (cut back against the tower's drum)
                            if reach[j + 1] < 1e-3:
                                # (where the ridge dies into the hall roof the slope closes to a point)
                                q = [grid[j][i], grid[j][i + 1], grid[j + 1][0]]
                            else:
                                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                            f = self._quad(p, q, (0.0, up, 0.0), tuple(c * (1.0 + jit(0.06, 700, sx, i, j, over_hall))
                                                                       for c in col), mat)
                            if f is not None:
                                f[p.soft] = 1
                if over_hall:
                    continue
                # the fascia along the eaves (where they run free of the tower), and the back verge's end
                i = len(ds) - 1
                for j in range(len(zs) - 1):
                    if min(reach[j], reach[j + 1]) < self.edge - 1e-6:
                        continue
                    self._quad(p, [top[j][i], top[j + 1][i], under[j + 1][i], under[j][i]], (sx, 0.0, 0.0),
                               K.tint(OAK, 0.7, 701, sx, j), TIMBER)
                for i in range(len(ds) - 1):
                    self._quad(p, [top[0][i], top[0][i + 1], under[0][i + 1], under[0][i]], (0.0, 0.0, -1.0),
                               K.tint(OAK, 0.66, 702, sx, i), TIMBER)
            # the bargeboard down the back verge
            pts = [(self.mid + sx * self._edge_d(self.edge * k / 6, self.zb), self.top(self.edge * k / 6, self.zb) - 0.26,
                    self.zb - 0.06) for k in range(7)]
            p.beam(pts, 0.14, 0.5, K.tint(OAK, 0.72, 703, sx), TIMBER, up=(0.0, 1.0, 0.0))
        # the ridge's cappers, from the back verge up to where it dies into the hall roof
        n = 16
        z_end = z_meet - 0.45
        for k in range(n):
            z0 = self.zb - 0.05 + (z_end - self.zb + 0.05) * k / n - 0.03
            z1 = self.zb - 0.05 + (z_end - self.zb + 0.05) * (k + 1) / n + 0.03
            xc = self.mid + jit(0.03, 704, k)
            Roof._saddle(p, [(z, xc) for z in (z0, z1)], lambda z, d: self.top(abs(d), z), (0.0, 0.0, 1.0),
                         (1.0, 0.0, 0.0), tuple(v * (0.8 + jit(0.05, 705, k)) for v in SLATE), w=0.3)
        apex = self.top(0.0, self.zb)
        p.cylinder((self.mid, apex - 0.4, self.zb - 0.06), (self.mid + 0.04, apex + 0.95, self.zb - 0.06), 0.13,
                   K.tint(OAK, 0.7, 707), TIMBER, sides=6, r1=0.08)

    def _edge_d(self, d, z):
        if d >= self.edge - 1e-6:
            return d + 0.1 * vnoise(z / 2.0, 0.0, 709)
        return d

    @staticmethod
    def _quad(p, verts, facing, color, mat):
        try:
            f = p.bm.faces.new(verts)
        except ValueError:
            return None
        f.normal_update()
        if f.normal.dot(K.P(*facing)) < 0:
            f.normal_flip()
        p.paint([f], color, mat)
        return f

    def _chimney(self):
        """The kitchen's stack, up out of the ridge over the range, leaning a little, two pots."""
        p = self.parts['WingRoof']
        x, z = self.mid + 0.4, -21.2
        base = self.top(0.5, z) - 0.5
        top = self.W['ridge'] + 2.3
        rings = [(base, 0.85, 0.95), (top - 0.3, 0.76, 0.84), (top, 0.76, 0.84)]
        prev = None
        for k, (y, hx, hz) in enumerate(rings):
            dx = -0.12 * (y - base) / (top - base)
            ring = [(x - hx + dx, y, z - hz), (x + hx + dx, y, z - hz + jit(0.03, 720, k)),
                    (x + hx + dx, y, z + hz), (x - hx + dx, y, z + hz + jit(0.03, 721, k))]
            if prev is not None:
                K.block(p, prev + ring, K.tint(STONE_T, 0.95, 722, k), STONE)
            prev = ring
        K.lump(p, (x - 0.12, top + 0.08, z), (1.8, 0.2, 1.95), K.tint(DRESSED_T, 0.88, 723), DRESSED, seed=724,
               rough=0.06)
        for k, dz in enumerate((-0.38, 0.4)):
            b = (x - 0.12 + jit(0.05, 725, k), top + 0.15, z + dz)
            t = K.lean(b, (b[0], top + 0.62 + jit(0.06, 726, k), b[2]), 0.08, 727 + k)
            p.cylinder(b, t, 0.22, K.tint(DRESSED_T, 0.7, 728, k), DRESSED, sides=7, r1=0.18)
