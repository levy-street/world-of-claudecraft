"""The hall's roof (build_tavern.py calls build(B, parts)): a steep slate roof running along the
road over the hall, its ridge sagged toward its middle and its eaves drooping between the gables
and kicking up at the corners; a cross gable over the door joining it in valleys; dormers on both
slopes; carved bargeboards and finials at every gable; the hearth's flue stack out of the slates
by the ridge; and the sarking under it all (the hall's ceiling between the trusses).

The main roof's profile across its ridge is build_tavern.roof_line (a bell-cast). It spans the
hall between its gable walls (x +-16) and runs on past them by ROOF_VERGE_OUT, and past the
jettied front and the back wall by ROOF_EAVE_OUT. The whole of it settles as one (the painted
world style guide's rule for code-built models): one surface function, top(), that every slate,
fascia, capper and dormer samples, and height() / under() hand the same surface to the walls and
the trusses. The cross gable has the same bell, narrower and steeper; its ridge runs back from
its gable over the door until it dies into the main roof, and the main slates run on under it
(hidden), so the two meet in valleys wherever they cross; over the door's bay the main eaves stop
either side of it, so the cross gable rises unbroken from the jetty to its finial. The wall
fire's stack climbs the right gable (inn_hall.py): the right verge is notched round it, its
bargeboards stopping either side.
"""
import math

from mathutils import Vector

import inn_kit as K
from inn_kit import (DRESSED, DRESSED_T, FLOOR, GLOW, IRON, METAL, OAK, PANE, PLASTER, PLASTER_T, ROOF,
                     SARKING, SLATE, STONE, STONE_T, TIMBER, jit, vnoise)

SAG = 0.7       # how far the ridge has sagged at its middle
DROOP = 0.3     # how far the eaves droop at their middle between the gables
KICK_UP = 0.3   # how far the eaves' corners kick up
# (x, slope: 1 the road's, -1 the back; the back slope's right half is the wing's, its middle the tower's)
DORMERS = ((12.4, 1), (-12.6, 1), (-12.3, -1))

# the cross gable over the door: its half width at its walls, its eaves past them, its ridge
CROSS_HALF = 6.5
CROSS_EAVE_OUT = 0.75
CROSS_RIDGE = 17.7
CROSS_VERGE_OUT = 1.0
CROSS_SAG = 0.12

# the right verge is notched round the wall fire's stack (inn_hall.py _chimney_stack's shaft)
NOTCH_HALF = 1.2

# the back eaves stop at the hall's back wall from here to the right verge: the tower's hat and the
# wing's roof take over from them there (inn_tower.py, inn_wing.py), and a board closes the slab
BACK_CUT = -8.5




def build(B, parts):
    Roof(B, parts).build()


class Roof:
    def __init__(self, B, parts):
        self.B = B
        self.p = parts.get('HallRoof')
        self.H = B.HALL
        self.rz = B.ROOF_RIDGE_Z
        self.half = B.ROOF_HALF
        self.edge = B.ROOF_HALF + B.ROOF_EAVE_OUT          # ridge line to the eaves' edge
        self.xv = self.H['x1'] + B.ROOF_VERGE_OUT          # the verges, either side
        fire = next(q for q in B.LAYOUT['props'] if q['kind'] == 'fireplace')
        self.notch_z = (fire['z'] - NOTCH_HALF, fire['z'] + NOTCH_HALF)
        self.cross_front = B.ROOF_FRONT + 0.3              # the cross gable's face (its own jetty)
        self.cross_edge = CROSS_HALF + CROSS_EAVE_OUT

    # =================================================================== surfaces
    def top(self, d, x):
        """The main slates at distance d across from the ridge line and x along it: the bell,
        the ridge sagged, the eaves drooping and kicked up at the corners, a slow belly."""
        y = self.B.roof_line(d)
        s = max(0.0, 1.0 - (x / self.xv) ** 2)
        out = min(1.2, d / self.edge)
        y -= SAG * s * max(0.0, 1.0 - out) ** 0.8
        y -= DROOP * s * out ** 3
        y += KICK_UP * (1.0 - s) ** 2 * out ** 4
        y += 0.045 * vnoise(d / 2.7, x / 3.1, 401)
        y += 0.06 * vnoise(x / 4.3, 0.0, 403) * out ** 3
        return y

    def thick(self, d):
        """The slab's depth: the full roof over the hall, thinning out over the eaves."""
        if d <= self.half:
            return self.B.ROOF_THICK
        t = (d - self.half) / (self.edge - self.half)
        return self.B.ROOF_THICK + (0.3 - self.B.ROOF_THICK) * min(1.0, t)

    def height(self, x, z):
        """The main slates over a game-frame point."""
        return self.top(abs(z - self.rz), x)

    def under(self, x, z):
        """The main roof's sarking over a game-frame point (the hall's ceiling)."""
        d = abs(z - self.rz)
        return self.top(d, x) - self.thick(d)

    def cross_top(self, xa, z):
        """The cross gable's slates at |x| from its ridge and z along it (front at cross_front)."""
        B = self.B
        if xa <= CROSS_HALF:
            t = (CROSS_HALF - xa) / CROSS_HALF
            y = B.ROOF_EAVE + (CROSS_RIDGE - B.ROOF_EAVE) * (B.ROOF_BELL * t + (1.0 - B.ROOF_BELL) * t * t)
        else:
            pitch = (CROSS_RIDGE - B.ROOF_EAVE) / CROSS_HALF * B.ROOF_BELL
            y = B.ROOF_EAVE - pitch * (xa - CROSS_HALF)
        span = self.cross_front + CROSS_VERGE_OUT - self.rz
        s = max(0.0, 1.0 - ((z - (self.rz + span / 2)) / (span / 2)) ** 2)
        y -= CROSS_SAG * s * max(0.0, 1.0 - xa / self.cross_edge)
        y += 0.035 * vnoise(xa / 2.1, z / 2.6, 407)
        return y

    # ===================================================================== build
    def build(self):
        self._main()
        self._ridge()
        for sx in (-1, 1):
            self._verge(sx)
        self._cross()
        for k, (x, side) in enumerate(DORMERS):
            self._dormer(x + jit(0.2, 410, k), side, seed=420 + k * 10)
        self._flue_stack()

    def _skip(self, side, x0, x1, d0, d1):
        """The right verge's notch round the wall fire's stack, the front eave's overhang over the
        door's bay (the cross gable's own roof covers it there), and the back eave's overhang
        where the tower and the wing stand against the back wall."""
        if d0 >= self.half - 1e-6:
            if side == 1 and x0 >= -CROSS_HALF - 1e-6 and x1 <= CROSS_HALF + 1e-6:
                return True
            if side == -1 and x0 >= BACK_CUT - 1e-6:
                return True
        if side != 1 or x0 < self.H['x1'] - 1e-6:
            return False
        z0, z1 = sorted((self.rz + d0, self.rz + d1))
        return z0 >= self.notch_z[0] - 1e-6 and z1 <= self.notch_z[1] + 1e-6

    def _main(self):
        """The two slopes, each a slab: slates over sarking, a fascia at the eaves, the ends
        boarded where the bargeboards hang, the notch round the stack boarded too."""
        p = self.p
        bm = p.bm
        H = self.H
        xs = K.breaks(-self.xv, self.xv, 2.3, keep=(-H['x1'], H['x1'], -CROSS_HALF, CROSS_HALF, BACK_CUT))
        for side in (1, -1):
            # the notch's edges across this slope, as distances from the ridge line
            nd = [abs(z - self.rz) for z in self.notch_z] if side == 1 else []
            ds = K.breaks(0.0, self.edge, 2.4, keep=[self.half, self.half + 0.8] + nd)
            top = [[bm.verts.new(K.P(x, self.top(d, x), self.rz + side * d)) for x in xs] for d in ds]
            under = [[bm.verts.new(K.P(x, self.top(d, x) - self.thick(d), self.rz + side * d)) for x in xs]
                     for d in ds]
            for grid, up, col, mat in ((top, 1.0, SLATE, ROOF), (under, -1.0, SARKING, FLOOR)):
                for j in range(len(ds) - 1):
                    for i in range(len(xs) - 1):
                        if self._skip(side, xs[i], xs[i + 1], ds[j], ds[j + 1]):
                            continue
                        k = 1.0 + jit(0.07 if mat == ROOF else 0.05, 430, side, i, j)
                        f = self._quad(p, [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]],
                                       (0.0, up, 0.0), tuple(c * k for c in col), mat)
                        if f is not None:
                            f[p.soft] = 1
            # the fascia along the eaves
            j = len(ds) - 1
            for i in range(len(xs) - 1):
                if self._skip(side, xs[i], xs[i + 1], ds[j - 1], ds[j]):
                    continue
                self._quad(p, [top[j][i], top[j][i + 1], under[j][i + 1], under[j][i]], (0.0, 0.0, side),
                           K.tint(OAK, 0.7, 432, side, i), TIMBER)
            # the back slab's end along the back wall where its eaves stop, and the eave's end there
            if side == -1:
                j = ds.index(round(self.half, 4))
                i0 = xs.index(round(BACK_CUT, 4))
                for i in range(i0, len(xs) - 1):
                    self._quad(p, [top[j][i], top[j][i + 1], under[j][i + 1], under[j][i]], (0.0, 0.0, -1.0),
                               K.tint(OAK, 0.7, 437, i), TIMBER)
                for j2 in range(j, len(ds) - 1):
                    self._quad(p, [top[j2][i0], top[j2 + 1][i0], under[j2 + 1][i0], under[j2][i0]], (1.0, 0.0, 0.0),
                               K.tint(OAK, 0.66, 438, j2), TIMBER)
            # the eave's ends either side of the door's bay, boarded where the cross gable rides over
            if side == 1:
                for sx in (-1, 1):
                    i = xs.index(round(sx * CROSS_HALF, 4))
                    for j in range(len(ds) - 1):
                        if ds[j] >= self.half - 1e-6:
                            self._quad(p, [top[j][i], top[j + 1][i], under[j + 1][i], under[j][i]], (-sx, 0.0, 0.0),
                                       K.tint(OAK, 0.66, 436, sx, j), TIMBER)
            # the slope's two ends at the verges (the bargeboards hang over them)
            for i, sx in ((0, -1.0), (len(xs) - 1, 1.0)):
                for j in range(len(ds) - 1):
                    if sx > 0 and self._skip(side, H['x1'], self.xv, ds[j], ds[j + 1]):
                        continue
                    self._quad(p, [top[j][i], top[j + 1][i], under[j + 1][i], under[j][i]], (sx, 0.0, 0.0),
                               K.tint(OAK, 0.66, 434, side, j), TIMBER)
            # the notch's sides round the stack, and its back against the gable
            if side == 1:
                i0 = xs.index(round(H['x1'], 4))
                for zn, face in ((self.notch_z[0], 1.0), (self.notch_z[1], -1.0)):
                    j = ds.index(round(abs(zn - self.rz), 4))
                    for i in range(i0, len(xs) - 1):
                        self._quad(p, [top[j][i], top[j][i + 1], under[j][i + 1], under[j][i]], (0.0, 0.0, face),
                                   K.tint(OAK, 0.7, 433, i, zn), TIMBER)
                for j in range(len(ds) - 1):
                    if self._skip(side, H['x1'], self.xv, ds[j], ds[j + 1]):
                        self._quad(p, [top[j][i0], top[j + 1][i0], under[j + 1][i0], under[j][i0]], (1.0, 0.0, 0.0),
                                   K.tint(OAK, 0.66, 435, j), TIMBER)

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

    def _ridge(self):
        """The ridge cappers: a run of slate saddles over the ridge, each laid a little off the
        line of the last, following its sag, their skirts down on the slates either side."""
        p = self.p
        n = 20
        for k in range(n):
            x0 = -self.xv - 0.1 + (2 * self.xv + 0.2) * k / n - 0.03
            x1 = -self.xv - 0.1 + (2 * self.xv + 0.2) * (k + 1) / n + 0.03
            zc = self.rz + jit(0.04, 440, k)
            self._saddle(p, [(x, zc) for x in (x0, x1)], lambda x, d: self.top(d, x), (1.0, 0.0, 0.0),
                         (0.0, 0.0, 1.0), tuple(v * (0.8 + jit(0.06, 441, k)) for v in SLATE))

    @staticmethod
    def _saddle(p, ends, surface, along, across, color, w=0.36):
        """One ridge capper between two points on a ridge line ((along, across) pairs: how far
        along the ridge, where its line stands across it), `surface(along, d)` the slates' height
        d out from the ridge: its skirts lie on the slates either side, its crown a little over
        the ridge."""
        (a0, c0), (a1, c1) = ends
        al, ax = Vector(along), Vector(across)

        def pt(a, c, d, y):
            q = al * a + ax * (c + d)
            return (q.x, y, q.z)

        bottom = [pt(a0, c0, -w, surface(a0, w) - 0.02), pt(a1, c1, -w, surface(a1, w) - 0.02),
                  pt(a1, c1, w, surface(a1, w) - 0.02), pt(a0, c0, w, surface(a0, w) - 0.02)]
        crown = [pt(a0, c0, -0.1, surface(a0, 0.0) + 0.17), pt(a1, c1, -0.1, surface(a1, 0.0) + 0.17),
                 pt(a1, c1, 0.1, surface(a1, 0.0) + 0.17), pt(a0, c0, 0.1, surface(a0, 0.0) + 0.17)]
        K.block(p, bottom + crown, color, ROOF)

    def _verge(self, sx):
        """A gable's carved bargeboards down both rakes, the finial at the apex and a pendant
        dropped under it."""
        p = self.p
        x = sx * (self.xv + 0.07)
        for side in (1, -1):
            # (the right verge's front rake is notched round the chimney: a board either side of it;
            # its back rake stops at the back wall, where the back eaves stop)
            gap = (abs(self.notch_z[0] - self.rz), abs(self.notch_z[1] - self.rz)) if sx > 0 and side > 0 else None
            end = self.half if sx > 0 and side < 0 else self.edge
            runs = [(0.0, gap[0]), (gap[1], end)] if gap else [(0.0, end)]
            for (d0, d1) in runs:
                n = max(1, int(round((d1 - d0) / (self.edge / 8))))
                pts = [(x, self.top(d0 + (d1 - d0) * i / n, sx * self.xv) - 0.32, self.rz + side * (d0 + (d1 - d0) * i / n))
                       for i in range(n + 1)]
                p.beam(pts, 0.16, 0.62, K.tint(OAK, 0.72, 450, sx, side, d0), TIMBER, up=(0.0, 1.0, 0.0))
            # the board's scalloped lower edge: a row of little teeth hung under it
            for i in range(1, 5):
                d = self.edge * (i + 0.5) / 5.2
                if (gap and gap[0] - 0.3 <= d <= gap[1] + 0.3) or d > end - 0.3:
                    continue
                y = self.top(d, sx * self.xv) - 0.68
                K.lump(p, (x, y, self.rz + side * d), (0.14, 0.22, 0.42), K.tint(OAK, 0.66, 451, i, sx, side), TIMBER,
                       seed=452 + i * 3 + sx + side * 0.5, rough=0.15)
        apex = self.top(0.0, sx * self.xv)
        p.cylinder((x, apex - 0.6, self.rz), (x + jit(0.05, 453, sx), apex + 1.25, self.rz + 0.02), 0.17,
                   K.tint(OAK, 0.7, 454, sx), TIMBER, sides=6, r1=0.1)
        K.lump(p, (x, apex + 0.55, self.rz), (0.42, 0.34, 0.42), K.tint(OAK, 0.66, 455, sx), TIMBER, seed=456 + sx,
               rough=0.1)
        p.cylinder((x, apex - 1.55, self.rz), (x, apex - 0.55, self.rz), 0.07, K.tint(OAK, 0.68, 457, sx), TIMBER,
                   sides=6, r1=0.15)

    # =============================================================== cross gable
    def valley(self, sx, z):
        """How far out from the cross ridge its slope on side sx runs at z: to its eaves' edge
        where it rides clear of the main slates, else only to the valley where it meets them."""
        def over(xa):
            return self.cross_top(xa, z) - self.height(sx * xa, z)

        if over(self.cross_edge) >= 0.0:
            return self.cross_edge
        if over(0.0) <= 0.0:
            return 0.0
        lo, hi = 0.0, self.cross_edge
        for _ in range(28):
            mid = (lo + hi) / 2
            if over(mid) > 0.0:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def cross_back(self):
        """Where the cross gable's ridge dies into the main roof (z)."""
        lo, hi = self.rz, self.cross_front
        for _ in range(32):
            mid = (lo + hi) / 2
            if self.cross_top(0.0, mid) > self.height(0.0, mid):
                hi = mid
            else:
                lo = mid
        return (lo + hi) / 2

    def _cross(self):
        """The cross gable's roof: two slopes from its ridge over the door back to where the ridge
        dies into the main roof, each running out to its eaves where it rides clear of the main
        slates and only to the valley where it meets them; its fascias, its front verge's
        bargeboards, its cappers and its finial."""
        p = self.p
        bm = p.bm
        zf = self.cross_front + CROSS_VERGE_OUT
        zb = self.cross_back()
        zs = K.breaks(zb, zf, 1.6, keep=(zf - 1.0,))
        ncol = 4

        def thick(xa):
            return 0.55 - 0.29 * min(1.0, max(0.0, (xa - CROSS_HALF) / (self.cross_edge - CROSS_HALF)))

        for sx in (-1, 1):
            reach = [self.valley(sx, z) for z in zs]
            cols = [[r * i / ncol for i in range(ncol + 1)] for r in reach]
            top = [[bm.verts.new(K.P(sx * xa, self.cross_top(xa, z), z)) for xa in row] for z, row in zip(zs, cols)]
            under = [[bm.verts.new(K.P(sx * xa, self.cross_top(xa, z) - thick(xa), z)) for xa in row]
                     for z, row in zip(zs, cols)]
            for grid, up, col, mat in ((top, 1.0, SLATE, ROOF), (under, -1.0, SARKING, FLOOR)):
                for j in range(len(zs) - 1):
                    for i in range(ncol):
                        k = 1.0 + jit(0.07 if mat == ROOF else 0.05, 460, sx, i, j)
                        if reach[j] < 1e-3:
                            # (where the ridge dies into the main roof the slope closes to a point)
                            quad = [grid[j][0], grid[j + 1][i + 1], grid[j + 1][i]]
                        else:
                            quad = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                        f = self._quad(p, quad, (0.0, up, 0.0), tuple(c * k for c in col), mat)
                        if f is not None:
                            f[p.soft] = 1
            # the fascia along its eaves, where they ride clear of the main roof
            for j in range(len(zs) - 1):
                if min(reach[j], reach[j + 1]) >= self.cross_edge - 1e-6:
                    self._quad(p, [top[j][ncol], top[j + 1][ncol], under[j + 1][ncol], under[j][ncol]], (sx, 0.0, 0.0),
                               K.tint(OAK, 0.7, 461, sx, j), TIMBER)
            j = len(zs) - 1
            for i in range(ncol):
                self._quad(p, [top[j][i], top[j][i + 1], under[j][i + 1], under[j][i]], (0.0, 0.0, 1.0),
                           K.tint(OAK, 0.66, 462, sx, i), TIMBER)
            # the bargeboard down this side of the front verge, its teeth under it
            pts = [(sx * self.cross_edge * i / 6, self.cross_top(self.cross_edge * i / 6, zf) - 0.3, zf + 0.07)
                   for i in range(7)]
            p.beam(pts, 0.15, 0.58, K.tint(OAK, 0.72, 463, sx), TIMBER, up=(0.0, 1.0, 0.0))
            for i in range(1, 5):
                xa = self.cross_edge * (i + 0.5) / 5.2
                K.lump(p, (sx * xa, self.cross_top(xa, zf) - 0.64, zf + 0.07), (0.4, 0.2, 0.13),
                       K.tint(OAK, 0.66, 464, sx, i), TIMBER, seed=465 + i + sx * 7, rough=0.15)
        # the ridge's cappers back to where it dies into the main roof, and the front finial
        n = 8
        for k in range(n):
            z0 = zf + 0.1 - (zf + 0.1 - zb - 0.5) * k / n + 0.03
            z1 = zf + 0.1 - (zf + 0.1 - zb - 0.5) * (k + 1) / n - 0.03
            xc = jit(0.03, 466, k)
            self._saddle(p, [(z, xc) for z in (z0, z1)], lambda z, d: self.cross_top(abs(d), z), (0.0, 0.0, 1.0),
                         (1.0, 0.0, 0.0), tuple(v * (0.8 + jit(0.06, 467, k)) for v in SLATE), w=0.3)
        apex = self.cross_top(0.0, zf)
        p.cylinder((0.0, apex - 0.55, zf + 0.07), (0.04, apex + 1.35, zf + 0.09), 0.16, K.tint(OAK, 0.7, 469), TIMBER,
                   sides=6, r1=0.09)
        K.lump(p, (0.0, apex + 0.62, zf + 0.08), (0.4, 0.33, 0.4), K.tint(OAK, 0.66, 470), TIMBER, seed=471, rough=0.1)
        p.cylinder((0.0, apex - 1.5, zf + 0.07), (0.0, apex - 0.5, zf + 0.07), 0.07, K.tint(OAK, 0.68, 472), TIMBER,
                   sides=6, r1=0.15)

    # =================================================================== dormers
    def _dormer(self, xc, side, seed):
        """A dormer on a slope: a little timbered gable with a lit casement, its cheeks hung with
        slates, its own small roof meeting the main one."""
        p = self.p
        df = self.half - 2.3        # its face, back up the slope from the eave wall
        hw = 1.55
        zf = self.rz + side * df
        sill = self.top(df, xc) + 0.05
        eave = sill + 2.3
        ridge = eave + 1.45
        out = (0.0, 0.0, side)

        def meet(y):
            """How far up the slope (a distance from the ridge line) the roof reaches height y."""
            lo, hi = 0.0, df
            for _ in range(30):
                mid = (lo + hi) / 2
                if self.top(mid, xc) > y:
                    lo = mid
                else:
                    hi = mid
            return (lo + hi) / 2

        de, dr = meet(eave), meet(ridge)
        ze, zr = self.rz + side * de, self.rz + side * dr
        # the face (plaster) and its gable, one fan of faces
        face = [(xc - hw, sill - 0.3, zf), (xc + hw, sill - 0.3, zf), (xc + hw, eave, zf), (xc, ridge - 0.1, zf),
                (xc - hw, eave, zf)]
        K.face(p, face, out, K.tint(PLASTER_T, 1.0, seed, 1), PLASTER)
        # its oak frame: corner posts, sill, wall plate, and a king post in the gable
        lean = jit(0.06, seed, 2)
        zo = zf + side * 0.07
        for dx in (-hw + 0.1, hw - 0.1):
            K.hewn(p, (xc + dx, sill - 0.25, zo), (xc + dx + lean, eave, zo), 0.22, 0.18, K.tint(OAK, 0.8, seed, 3, dx),
                   TIMBER, seed=seed + 4 + dx, segs=1, up=out)
        for y in (sill - 0.1, eave):
            K.hewn(p, (xc - hw - 0.1, y, zo), (xc + hw + 0.1, y, zo), 0.18, 0.2, K.tint(OAK, 0.8, seed, 5, y), TIMBER,
                   seed=seed + 6 + y, segs=1, sag=0.02)
        K.hewn(p, (xc, eave, zo), (xc, ridge - 0.25, zo), 0.18, 0.16, K.tint(OAK, 0.8, seed, 7), TIMBER, seed=seed + 8,
               segs=1, up=out)
        # the casement: a warm pane in an oak frame with its cross
        x0, x1, v0, v1 = xc - 0.62, xc + 0.62, sill + 0.35, eave - 0.3
        zp = zf + side * 0.08
        K.face(p, [(x0, v0, zp), (x1, v0, zp), (x1, v1, zp), (x0, v1, zp)], out,
               K.tint(PANE, 0.95, seed, 9, spread=0.06), GLOW, tag=K.FLAT)
        zq = zf + side * 0.12
        for (a, b) in (((x0, v0), (x1, v0)), ((x0, v1), (x1, v1)), ((x0, v0), (x0, v1)), ((x1, v0), (x1, v1)),
                       ((xc, v0), (xc, v1)), ((x0, (v0 + v1) / 2), (x1, (v0 + v1) / 2))):
            K.hewn(p, (a[0], a[1], zq), (b[0], b[1], zq), 0.1, 0.1, K.tint(OAK, 0.72, seed, 10, a[0], b[1]), TIMBER,
                   seed=seed + 11, segs=1, up=out)
        # the cheeks, hung with slates, back to the main roof
        for dx in (-hw, hw):
            tri = [(xc + dx, sill - 0.3, zf), (xc + dx, eave, zf), (xc + dx, eave, ze),
                   (xc + dx, self.top(de + 0.4, xc + dx) - 0.2, self.rz + side * (de + 0.4))]
            K.face(p, tri, (1.0 if dx > 0 else -1.0, 0.0, 0.0), K.tint(SLATE, 0.86, seed, 12, dx), ROOF)
        # its roof: two slopes from its ridge out over the cheeks, back into the main roof
        over = 0.35
        zfo = zf + side * over
        for dx in (-1, 1):
            q = [(xc, ridge, zfo), (xc + dx * (hw + over), eave - 0.12 + jit(0.05, seed, 13, dx), zfo),
                 (xc + dx * (hw + over), eave - 0.12, ze), (xc, ridge, zr)]
            K.face(p, q, (dx * 0.8, 1.0, 0.0), K.tint(SLATE, 0.95, seed, 14, dx), ROOF)
            K.face(p, list(reversed(q)), (-dx * 0.8, -1.0, 0.0), K.tint(SARKING, 0.8, seed, 15, dx), FLOOR)
            # the bargeboard down this side of its little gable
            K.hewn(p, (xc, ridge - 0.12, zfo + side * 0.05), (xc + dx * (hw + over), eave - 0.3, zfo + side * 0.05),
                   0.34, 0.1, K.tint(OAK, 0.7, seed, 16, dx), TIMBER, seed=seed + 17 + dx, segs=1)
        # its ridge capper and a small finial
        K.hewn(p, (xc, ridge + 0.08, zfo), (xc, ridge + 0.08, zr), 0.2, 0.3, K.tint(SLATE, 0.78, seed, 18), ROOF,
               seed=seed + 18, segs=2, sag=0.04)
        p.cylinder((xc, ridge - 0.2, zfo + side * 0.05), (xc, ridge + 0.7, zfo + side * 0.05), 0.09,
                   K.tint(OAK, 0.7, seed, 19), TIMBER, sides=5, r1=0.05)

    # ================================================================ flue stack
    def _flue_stack(self):
        """The hearth's flue comes up through the slates by the ridge into a stone stack, leaning
        a little, crowned with an iron cowl (the smoke curls out under it,
        src/render/mirefen_tavern_smoke_core.ts)."""
        p = self.p
        hood = self.B.LAYOUT['hood']
        pit = self.B.LAYOUT['pit']
        x, z = pit['x'], pit['z']
        top = hood['flueTop']
        # its foot sits in the roof's slab, each corner on the slope a little over the sarking
        # (from the hall the flue's copper pipe runs up into the boards, never a stone box under them)
        foot = [(dx, dz, self.under(x + dx, z + dz) + 0.08) for (dx, dz) in ((-0.98, -1.04), (0.98, -1.04),
                                                                               (0.98, 1.04), (-0.98, 1.04))]
        base = min(y for (_, _, y) in foot)
        prev = [(x + dx, y, z + dz) for (dx, dz, y) in foot]
        for k, (y, hx, hz) in enumerate(((top - 0.45, 0.84, 0.9), (top - 0.15, 0.84, 0.9))):
            dx = 0.12 * (y - base) / (top - base)
            ring = [(x - hx + dx, y, z - hz), (x + hx + dx, y, z - hz + jit(0.03, 480, k)),
                    (x + hx + dx, y, z + hz), (x - hx + dx, y, z + hz + jit(0.03, 481, k))]
            K.block(p, prev + ring, K.tint(STONE_T, 0.95, 482, k), STONE)
            prev = ring
        # a dressed band where it leaves the slates, the cap slab, the iron pipe and the cowl
        # (level, where the stack clears the slates on its high side toward the ridge)
        yb = max(self.height(x + dx, z + dz) for dx in (-1.0, 1.0) for dz in (-1.1, 1.1)) + 0.25
        K.lump(p, (x + 0.03, yb, z), (2.1, 0.26, 2.2), K.tint(DRESSED_T, 0.86, 483), DRESSED, seed=484, rough=0.06)
        K.lump(p, (x + 0.12, top - 0.06, z), (1.95, 0.24, 2.05), K.tint(DRESSED_T, 0.88, 485), DRESSED, seed=486,
               rough=0.05)
        p.cylinder((x + 0.12, top + 0.05, z), (x + 0.14, 22.0, z), 0.32, IRON, METAL, sides=8)
        for k in range(3):
            a = math.tau * k / 3 + 0.4
            p.cylinder((x + 0.12 + math.cos(a) * 0.3, 21.95, z + math.sin(a) * 0.3),
                       (x + 0.14 + math.cos(a) * 0.42, 22.45, z + math.sin(a) * 0.42), 0.035, IRON, METAL, sides=4)
        p.cylinder((x + 0.14, 22.35, z), (x + 0.16, 22.95, z), 0.78, IRON, METAL, sides=8, r1=0.08)
