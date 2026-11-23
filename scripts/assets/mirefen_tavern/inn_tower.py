"""The round tower over the nook (build_tavern.py calls build(B, parts)): a battered stone drum
round the nook's benches, open to the hall through the arch, its windows over each bench, a
dressed string course on the hall's jetty line and a ring of corbels under its eaves; and its
roof, a tall witch's hat of slates that kicks out at its eaves, twists a little as it climbs and
leans off true at its tip, crowned with an iron finial and a tankard weathervane.

The drum stands where the sim's ring of wall boxes stands (src/sim/mirefen_tavern.ts
tavernTowerWallSegments): from TOWER rIn to rOut round TOWER (x, z), over the angular runs in
layout towerWallRuns (radians, atan2(dx, dz): 0 looks out of the nook toward the hall). Its top
climbs inward under the hat's sarking, so the nook's walls meet the hat with no gap. The hat
stands whole: on the hall's side it rises out of the hall roof's back slope, every part of it
that would dip under those slates kept just under them (inside the hall roof's slab), so from
the hall nothing of it shows and from outside it grows out of the roof.
"""
import math

import inn_kit as K
from inn_roof import Roof
from inn_kit import (DRESSED, DRESSED_T, FLOOR, GLOW, IRON, METAL, OAK, PANE, PANE_DIM, PLASTER, PLASTER_IN,
                      ROOF, SARKING, SLATE, STONE, STONE_T, TIMBER, jit, vnoise)

# how far the hat's tip leans off the drum's axis (x, z)
LEAN = (0.85, -0.55)


def build(B, parts):
    Tower(B, parts).build()


class Tower:
    def __init__(self, B, parts):
        self.B = B
        self.T = B.TOWER
        self.wall = parts['TowerWall']
        self.roof = parts['TowerRoof']
        self.cx, self.cz = self.T['x'], self.T['z']
        self.a0, self.a1 = B.LAYOUT['towerWallRuns'][0]
        self.hall_roof = Roof(B, {})
        T = self.T
        # the hat's profile (radius, height of its slates), from its kicked-out eaves to its tip
        self.prof = [(T['rOut'] + T['eaveOut'] + 0.15, T['wallTop'] - 0.35), (7.0, T['wallTop'] + 0.35),
                     (6.0, 12.6), (4.8, 14.15), (3.6, 15.85), (2.45, 17.7), (1.35, 19.6), (0.55, 21.1),
                     (0.06, T['peak'])]

    def cone_y(self, r):
        """The hat's slates at radius r off its axis (its profile, before the twist and the lean)."""
        prof = self.prof
        if r >= prof[0][0]:
            return prof[0][1]
        for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
            if r1 <= r <= r0:
                return y0 + (y1 - y0) * (r0 - r) / (r0 - r1)
        return prof[-1][1]

    def cone_under(self, r):
        """The hat's sarking at radius r: the slab 0.42 deep over the drum, 0.25 at the eaves' edge."""
        r0, r1 = self.prof[0][0], self.prof[1][0]
        k = min(1.0, max(0.0, (r0 - r) / (r0 - r1)))
        return self.cone_y(r) - (0.25 + 0.17 * k)

    def under_hall_slates(self, x, z, y, depth):
        """A point of the hat over the hall's footprint kept no lower than `depth` under the hall
        roof's slates, so the hall roof's slab hides whatever of the hat would dip under them."""
        if z <= self.B.HALL['z0'] - 1e-6:
            return y
        return max(y, self.hall_roof.height(x, z) - depth)

    def drum_top(self, a, r):
        """The drum's top at angle a and radius r: up into the hat's slab, and where the drum's
        ends run into the hall's back wall, under the hall roof's slates."""
        x, _, z = self.at(a, r, 0.0)
        y = self.cone_under(r) + 0.18
        if z > self.B.HALL['z0'] - 1e-6:
            y = min(y, self.hall_roof.height(x, z) - 0.12)
        return y

    def at(self, a, r, y):
        return (self.cx + math.sin(a) * r, y, self.cz + math.cos(a) * r)

    def ground(self, a):
        x, _, z = self.at(a, self.T['rOut'] + 0.4, 0.0)
        return self.B.ground(x, z) - 0.7

    def build(self):
        self._drum()
        self._seal()
        self._windows()
        self._courses()
        self._cone()
        self._finial()

    # ---------------------------------------------------------------- the drum
    def _depth(self, a, v):
        g = self.ground(a)
        foot = max(0.0, 1.0 - (v - g) / 1.8)
        return 0.38 * K._fade(min(1.0, foot)) + 0.06 * vnoise(a * 2.6, v / 2.4, 501) + 0.025 * vnoise(a * 7, v, 503)

    def _drum(self):
        p = self.wall
        bm = p.bm
        T = self.T
        n = 28
        angs = [self.a0 + (self.a1 - self.a0) * i / n for i in range(n + 1)]
        vs = [None, 0.0, 1.4, 2.8, 4.2, 5.6, 7.0, 8.4, 9.8, 'top']
        # the outer face: each column's foot down to the ground under it, its top up in the hat
        grid = []
        for v in vs:
            row = []
            for a in angs:
                vv = self.ground(a) if v is None else (self.drum_top(a, T['rOut']) if v == 'top' else v)
                row.append(bm.verts.new(K.P(*self.at(a, T['rOut'] + self._depth(a, vv), vv))))
            grid.append(row)
        self._grid(p, grid, angs, outward=True,
                   cell=lambda i, j: (K.tint(STONE_T, 0.96 if j == 0 else 1.0, 510, i, j, spread=0.04), STONE))
        # the inner face: a dressed skirting under limewash, up under the cone
        vin = [0.0, 1.0, 2.6, 4.2, 5.9, 7.6, 9.4, 'top']
        grid = [[bm.verts.new(K.P(*self.at(a, T['rIn'] - 0.03 * vnoise(a * 3.1, 0.0 if v == 'top' else v, 511),
                                           self.drum_top(a, T['rIn']) if v == 'top' else v))) for a in angs]
                for v in vin]
        self._grid(p, grid, angs, outward=False,
                   cell=lambda i, j: ((K.tint(DRESSED_T, 0.92, 512, i, spread=0.03), DRESSED) if j == 0 else
                                      (K.tint(PLASTER_IN, 1.0, 513, i, j, spread=0.012), PLASTER)))
        # the wall's top up in the hat, and its two ends at the arch
        for i in range(n):
            q = [self.at(angs[i], T['rIn'], self.drum_top(angs[i], T['rIn'])),
                 self.at(angs[i + 1], T['rIn'], self.drum_top(angs[i + 1], T['rIn'])),
                 self.at(angs[i + 1], T['rOut'], self.drum_top(angs[i + 1], T['rOut'])),
                 self.at(angs[i], T['rOut'], self.drum_top(angs[i], T['rOut']))]
            K.face(p, q, (0.0, 1.0, 0.0), K.tint(DRESSED_T, 0.85, 514, i), DRESSED)
        for a, s in ((self.a0, -1.0), (self.a1, 1.0)):
            g = self.ground(a)
            q = [self.at(a, T['rIn'], 0.0), self.at(a, T['rOut'], g), self.at(a, T['rOut'], self.drum_top(a, T['rOut'])),
                 self.at(a, T['rIn'], self.drum_top(a, T['rIn']))]
            tang = (math.cos(a) * s, 0.0, -math.sin(a) * s)
            K.face(p, q, tang, K.tint(DRESSED_T, 0.9, 515, a), DRESSED)

    def _seal(self):
        """Over the hall's back wall, inside the hat: a plaster gable on the back wall's line from
        its eaves up under the hat's sarking, closing the nook's hat off from the hall roof's
        slates (from the nook it reads as the back wall climbing on into the hat). It is the hat's
        (TowerRoof): it stands inside it, so it fades with it."""
        p = self.roof
        B, R, T = self.B, self.hall_roof, self.T
        # (a hand behind the back wall's own face, so the two never fight where they meet)
        z0 = B.HALL['z0'] - 0.12
        dz = z0 - self.cz
        half = math.sqrt(T['rOut'] ** 2 - dz * dz)
        wall = K.Wall(0.0, z0, 1.0, z0, (0.0, 1.0))          # u = x, its face looking into the nook (-z)

        def top(u):
            return self.cone_under(math.hypot(u - self.cx, dz)) + 0.15

        def foot(u):
            return (R.height(u, B.HALL['z0']) + R.under(u, B.HALL['z0'])) / 2 - 0.1

        us = K.breaks(self.cx - half, self.cx + half, 1.4)
        v0 = min(foot(u) for u in us)
        K.skin(p, wall, us, K.breaks(v0, T['peak'], 1.6), lambda u, v: 0.0, -1,
               lambda i, j, a, b, c, d: (K.tint(PLASTER_IN, 0.9, 516, i, j, spread=0.015), PLASTER), top=top)
        # a tie beam along its foot, where the back wall's plate carries it
        K.hewn(p, wall.pt(self.cx - half + 0.3, v0 + 0.15, -0.12), wall.pt(self.cx + half - 0.3, v0 + 0.15, -0.12), 0.3,
               0.34, K.tint(OAK, 0.8, 517), TIMBER, seed=518, sag=0.05, segs=3)

    def _grid(self, p, grid, angs, outward, cell):
        bm = p.bm
        for j in range(len(grid) - 1):
            for i in range(len(angs) - 1):
                quad = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                try:
                    f = bm.faces.new(quad)
                except ValueError:
                    continue
                f.normal_update()
                am = (angs[i] + angs[i + 1]) / 2
                radial = K.P(math.sin(am), 0.0, math.cos(am))
                if (f.normal.dot(radial) < 0) == outward:
                    f.normal_flip()
                color, mat = cell(i, j)
                p.paint([f], color, mat)
                f[p.soft] = 1

    def _windows(self):
        """A round-headed window over each of the nook's benches (and two slits higher up), each
        a dressed surround round a warm pane, the same pane seen from inside."""
        p = self.wall
        T = self.T
        nook = self.B.LAYOUT['nook']
        wins = [(a, 2.3, 1.05, 1.5) for a in nook['benchAngles']]
        wins += [(math.radians(122), 7.6, 0.6, 1.3), (math.radians(238), 7.6, 0.6, 1.3)]
        for k, (a, sill, w, h) in enumerate(wins):
            seed = 520 + k * 7
            hw = w / 2
            ro = T['rOut'] + self._depth(a, sill + 1.0) + 0.02
            spring = sill + h

            def pt(du, v, r):
                # du is across the window along the wall's tangent, at radius r
                ang = a + du / r
                return self.at(ang, r, v)

            # the pane: a round-headed panel just proud of the stone
            pane = [pt(-hw, sill, ro + 0.03), pt(hw, sill, ro + 0.03)]
            for i in range(7):
                t = math.pi * i / 6
                pane.append(pt(hw * math.cos(t), spring + hw * 0.8 * math.sin(t), ro + 0.03))
            K.face(p, pane, (math.sin(a), 0.0, math.cos(a)), K.tint(PANE, 0.98, seed, spread=0.05), GLOW, tag=K.FLAT)
            # the dressed surround: sill, jambs, a ring of voussoirs over the head
            K.lump(p, pt(0.0, sill - 0.09, ro + 0.1), (0.3, 0.18, w + 0.5), K.tint(DRESSED_T, 0.95, seed, 1), DRESSED,
                   seed=seed + 1, rough=0.08, yaw=a)
            for s in (-1, 1):
                for j, (v0, v1) in enumerate(((sill, sill + h * 0.55), (sill + h * 0.55, spring))):
                    c = pt(s * (hw + 0.15), (v0 + v1) / 2, ro + 0.08)
                    K.lump(p, c, (0.24, v1 - v0 - 0.04, 0.28 if j == 0 else 0.22), K.tint(DRESSED_T, 1.0, seed, 2, s, j),
                           DRESSED, seed=seed + 2 + j + s * 3, rough=0.1, yaw=a)
            for i in range(4):
                t0, t1 = math.pi * i / 4, math.pi * (i + 1) / 4
                tm = (t0 + t1) / 2
                c = pt((hw + 0.12) * math.cos(tm), spring + (hw * 0.8 + 0.12) * math.sin(tm), ro + 0.09)
                K.lump(p, c, (0.22, 0.3, 0.42), K.tint(DRESSED_T, 1.0 + jit(0.05, seed, 3, i), seed, 4, i), DRESSED,
                       seed=seed + 5 + i, rough=0.12, yaw=a)
            # the pane seen from inside, in an oak frame
            ri = T['rIn'] - 0.06
            inner = [pt(-hw * 0.9, sill, ri), pt(hw * 0.9, sill, ri), pt(hw * 0.9, spring + hw * 0.5, ri),
                     pt(-hw * 0.9, spring + hw * 0.5, ri)]
            K.face(p, inner, (-math.sin(a), 0.0, -math.cos(a)), K.tint(PANE_DIM, 1.0, seed, 6, spread=0.05), GLOW,
                   tag=K.FLAT)
            for (du0, v0, du1, v1) in ((-hw, sill - 0.05, hw, sill - 0.05), (-hw, spring + hw * 0.55, hw, spring + hw * 0.55),
                                       (-hw, sill, -hw, spring + hw * 0.5), (hw, sill, hw, spring + hw * 0.5)):
                K.hewn(p, pt(du0, v0, ri - 0.05), pt(du1, v1, ri - 0.05), 0.14, 0.12, K.tint(OAK, 0.85, seed, 7, du0, v0),
                       TIMBER, seed=seed + 8, segs=1, up=(math.sin(a), 0.0, math.cos(a)))

    def _courses(self):
        """The dressed string course on the hall's jetty line, and the corbels under the eaves."""
        p = self.wall
        T = self.T
        n = 26
        for k in range(n):
            a = self.a0 + (self.a1 - self.a0) * (k + 0.5) / n
            ro = T['rOut'] + self._depth(a, 5.9)
            K.lump(p, self.at(a, ro + 0.08, 5.95 + jit(0.04, 530, k)), (0.32, 0.3, 1.55), K.tint(DRESSED_T, 0.95, 531, k),
                   DRESSED, seed=532 + k, rough=0.1, yaw=a)
            # (a corbel under every other stone of the course, under the hat's eave)
            ro = T['rOut'] + self._depth(a, 10.6)
            x, _, z = self.at(a, ro + 0.18, 0.0)
            if k % 2 or z > self.B.HALL['z0'] - 0.4:
                continue
            yc = self.cone_under(ro + 0.25) - 0.17
            K.lump(p, self.at(a, ro + 0.18, yc), (0.45, 0.42, 0.55), K.tint(DRESSED_T, 0.92, 533, k), DRESSED,
                   seed=534 + k, rough=0.14, yaw=a)

    # ---------------------------------------------------------------- the cone
    def _cone(self):
        """The witch's hat: rings from its kicked-out eaves up to its tip, each turned a little
        further round than the last and the whole leaning off true toward its top. Over the hall
        it rises out of the hall roof's back slope: whatever of it would dip under those slates
        stays just under them."""
        p = self.roof
        bm = p.bm
        prof = self.prof
        n = 24
        rmax = prof[0][0]

        def ring_pt(r, y, k, down=0.0):
            t = 1.0 - r / rmax
            twist = 0.65 * t * t
            ang = math.tau * k / n + twist
            lx, lz = LEAN[0] * t ** 2.5, LEAN[1] * t ** 2.5
            # (the radius wobbles less toward the eaves, where the drum's top meets the sarking)
            amp = 0.035 * min(1.0, (rmax - r) / 2.2)
            rr = r * (1.0 + amp * vnoise(k * 0.9, r, 540)) if r > 0.1 else r
            x = self.cx + lx + math.sin(ang) * rr
            z = self.cz + lz + math.cos(ang) * rr
            yy = y + 0.06 * vnoise(k * 1.3, 0.0, 541) * (r / rmax) ** 2 - down
            return (x, self.under_hall_slates(x, z, yy, 0.12 + down * 0.45), z)

        top = [[bm.verts.new(K.P(*ring_pt(r, y, k))) for k in range(n)] for (r, y) in prof]
        under = [[bm.verts.new(K.P(*ring_pt(r, y, k, down=0.42 if i > 0 else 0.25))) for k in range(n)]
                 for i, (r, y) in enumerate(prof)]
        for grid, up, col, mat in ((top, 1.0, SLATE, ROOF), (under, -1.0, SARKING, FLOOR)):
            for j in range(len(prof) - 1):
                for k in range(n):
                    quad = [grid[j][k], grid[j][(k + 1) % n], grid[j + 1][(k + 1) % n], grid[j + 1][k]]
                    uniq = []
                    for v in quad:
                        if all((v.co - u.co).length > 1e-5 for u in uniq):
                            uniq.append(v)
                    if len(uniq) < 3:
                        continue
                    try:
                        f = bm.faces.new(uniq)
                    except ValueError:
                        continue
                    f.normal_update()
                    am = math.tau * (k + 0.5) / n
                    want = K.P(math.sin(am) * up, 0.6 * up, math.cos(am) * up)
                    if f.normal.dot(want) < 0:
                        f.normal_flip()
                    kk = 1.0 + jit(0.06, 542, j, k) if mat == ROOF else 1.0
                    p.paint([f], tuple(c * kk for c in col), mat)
                    f[p.soft] = 1
        # the eaves' fascia between the slates and the sarking
        for k in range(n):
            quad = [top[0][k], top[0][(k + 1) % n], under[0][(k + 1) % n], under[0][k]]
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            f.normal_update()
            am = math.tau * (k + 0.5) / n
            if f.normal.dot(K.P(math.sin(am), 0.0, math.cos(am))) < 0:
                f.normal_flip()
            p.paint([f], K.tint(OAK, 0.7, 543, k), TIMBER)

    def _finial(self):
        """An iron finial out of the tip, a ball on it and a weathervane: an arrow and a little
        tankard turning in the wind."""
        p = self.roof
        T = self.T
        tip = (self.cx + LEAN[0], T['peak'] - 0.25, self.cz + LEAN[1])
        p.cylinder(tip, (tip[0] + 0.05, 24.15, tip[2]), 0.07, IRON, METAL, sides=5)
        K.lump(p, (tip[0] + 0.02, 22.75, tip[2]), (0.36, 0.34, 0.36), IRON, METAL, seed=550, rough=0.2)
        yv = 23.55
        p.cylinder((tip[0] - 0.9, yv, tip[2] + 0.2), (tip[0] + 0.95, yv, tip[2] - 0.2), 0.04, IRON, METAL, sides=4)
        K.lump(p, (tip[0] + 1.0, yv, tip[2] - 0.22), (0.3, 0.12, 0.1), IRON, METAL, seed=551, rough=0.1, yaw=0.22)
        # the tankard on the vane's tail: a little iron mug with its handle
        mug = (tip[0] - 0.75, yv + 0.25, tip[2] + 0.17)
        p.cylinder((mug[0], mug[1] - 0.2, mug[2]), (mug[0], mug[1] + 0.22, mug[2]), 0.17, IRON, METAL, sides=6,
                   r1=0.15)
        p.ring((mug[0] - 0.2, mug[1], mug[2]), 0.11, 0.035, IRON, segments=6, axis=(0.22, 0.0, 1.0), mat=METAL)
