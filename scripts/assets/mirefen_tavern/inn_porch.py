"""The porch before the door (build_tavern.py calls build(B, parts)): the flagged stone porch and
its low parapets, the broad steps down to the road laid in slabs no two alike, a striped canvas
awning over the porch from under the jetty out to two oak posts on the parapets' ends, the
lanterns either side of the door, and the inn's sign: a giant oak tankard, iron-hooped and
foaming over, swinging on chains from a scrolled iron arm out of the upper storey under the
eaves.

The porch, its parapets and the steps stand where the sim's floor and colliders put them
(src/sim/mirefen_tavern_floor.ts, mirefen_tavern.ts, layout porch): they never cut away, so
they go in TavernFrame; the awning and the sign hang on the front and fade with it as the
HallPorch part (src/render/mirefen_tavern_core.ts keeps its fade volumes: the canvas and its
valance within AWNING_X, y 4.55 to 5.5, z 14.9 to 16.6, the posts on the parapets' ends, and the
sign within x 8.1 to 11.4, y 4.7 to 8.75, z 14.9 to 19.2).
"""
import math

from mathutils import Vector

import inn_kit as K
import inn_props as PR
from inn_kit import (CLOTH, DRESSED, DRESSED_T, GLOW, IRON, METAL, OAK, PANE, PLASTER, STONE, STONE_T, TIMBER, jit,
                     vnoise)
from inn_roof import CROSS_HALF

# the sign: how far out the tankard swings, the arm's height and the top of the tankard's foam, a
# hand under the yoke (its arm leaves the upper storey on a post of its frame between its windows,
# under the eaves: sign_x())
SIGN_Z = 17.75
SIGN_ARM = 8.5
SIGN_TOP = 8.15

# the awning: its half width, its back edge on a batten under the jetty's joists, its front edge
# over the rail on the posts
AWNING_X = 4.4
AWNING_BACK = (15.0, 5.32)    # (z, y)
AWNING_FRONT = (16.45, 5.0)   # (high enough that a lens following a body in through the door
                              # passes under its valance: tests/mirefen_tavern_core.test.ts)
STRIPES = 8
GARNET = (1.0, 0.97, 0.97)    # the cloth's own garnet
CANVAS = (1.0, 0.95, 0.8)     # the cream stripes (limewashed canvas)

# the sign's tankard: the props' painted model (props/props.json `sign_tankard`, inn_props.py), at
# most this tall, and at most this reach either side of the arm at its upper hoop (its yoke, a
# hand and more wider, stays inside the sign's envelope above, x 8.1 to 11.4)
SIGN_TANKARD_H = 3.3
SIGN_REACH = 1.3


def _hoop():
    """The sign's tankard turned with its handle toward the wall (-z, wherever its model holds
    it) and sized (SIGN_TANKARD_H tall, or less so its upper hoop keeps within SIGN_REACH), and
    that hoop once it stands (its foot's middle on the base point): its turn, its height, the
    hoop's middle along the arm from the base point, its reach across and its height over the
    foot."""
    prop = PR.PROPS['sign_tankard']
    height = SIGN_TANKARD_H
    turn, mid, reach, y = _hoop_at(prop, height)
    if reach > SIGN_REACH:
        height *= SIGN_REACH / reach
        turn, mid, reach, y = _hoop_at(prop, height)
    return turn, height, mid, reach, y


def _hoop_at(prop, height):
    """The tankard turned with its handle to the wall and stood `height` tall: its turn, its
    upper hoop's middle along the arm from the base point, its reach across, its height."""
    sx, sy, sz = prop['size']
    s = height / sy
    pts = [(x, y + sy / 2, z - sz / 2) for x, y, z in prop['verts']]
    cx = sorted(p[0] for p in pts)[len(pts) // 2]
    cz = sorted(p[2] for p in pts)[len(pts) // 2]
    # the handle: what reaches furthest from the mug's middle
    far = sorted(pts, key=lambda p: -math.hypot(p[0] - cx, p[2] - cz))[:max(8, len(pts) // 25)]
    turn = math.pi - math.atan2(sum(p[0] - cx for p in far), sum(p[2] - cz for p in far))
    c, sn = math.cos(turn), math.sin(turn)
    placed = [((x * c + z * sn) * s, y * s, (-x * sn + z * c) * s) for x, y, z in pts]
    band = [q for q in placed if 0.58 * height <= q[1] <= 0.75 * height]
    reach = max(abs(q[0]) for q in band)
    return turn, max(q[2] for q in band) - reach, reach, sum(q[1] for q in band) / len(band)


TANKARD_TURN, TANKARD_H, HOOP_Z, HOOP_REACH, HOOP_Y = _hoop()
SIGN_BASE = SIGN_TOP - TANKARD_H


def sign_x(B):
    """Where the sign's arm leaves the upper storey: on the post of its frame between the two
    windows right of the cross gable (the first of the three even bays out from the gable's
    corner, inn_hall.front_posts), so its bracket plate sits on timber."""
    return CROSS_HALF + (B.HALL['x1'] - CROSS_HALF) / 3


def build(B, parts):
    Porch(B, parts).build()


class Porch:
    def __init__(self, B, parts):
        self.B = B
        self.P = B.LAYOUT['porch']
        self.frame = parts['TavernFrame']
        self.porch = parts['HallPorch']
        self.lights = parts['TavernLights']

    def build(self):
        self._platform()
        self._steps()
        self._awning()
        self._lanterns()
        self._sign()

    # ------------------------------------------------------------- the porch
    def _platform(self):
        """The porch's flags at the ground floor, its stone flanks down into the ground, and the
        two low parapets with their dressed coping."""
        p, P, B = self.frame, self.P, self.B
        x0, x1, z0, z1 = P['x0'], P['x1'], P['z0'], P['z1']
        # the flags: a few big stones, their tops a hand's breadth apart in height at most
        cols = [x0 - 0.2, -2.3, -0.6, 1.2, 2.8, x1 + 0.2]
        rows = [z0, 15.25, z1]
        for i in range(len(cols) - 1):
            for j in range(len(rows) - 1):
                cx, cz = (cols[i] + cols[i + 1]) / 2, (rows[j] + rows[j + 1]) / 2
                w, d = cols[i + 1] - cols[i] - 0.04, rows[j + 1] - rows[j] - 0.04
                top = -0.005 + jit(0.012, 801, i, j)
                K.lump(p, (cx, top - 0.18, cz), (w, 0.36, d), K.tint(DRESSED_T, 0.92, 802, i, j, spread=0.05), DRESSED,
                       seed=803 + i * 5 + j, rough=0.025)
        # the plinth under the flags, down to the ground on both flanks and either side of the steps
        for sx in (-1, 1):
            x = sx * (x1 + 0.2)
            pts = []
            for k in range(4):
                z = z0 + (z1 - z0) * k / 3
                pts.append((z, B.ground(x + sx * 0.3, z) - 0.5))
            for k in range(3):
                (za, ga), (zb, gb) = pts[k], pts[k + 1]
                K.face(p, [(x, -0.36, za), (x, -0.36, zb), (x + sx * (0.08 + jit(0.04, 804, k)), gb, zb),
                           (x + sx * 0.1, ga, za)], (sx, 0.0, 0.0), K.tint(STONE_T, 0.95, 805, sx, k), STONE)
            # the front face beside the steps
            hw = P['stepHalfWidth']
            g = B.ground(sx * 3.9, z1 + 0.3) - 0.5
            K.face(p, [(sx * hw, -0.36, z1), (sx * (x1 + 0.2), -0.36, z1), (sx * (x1 + 0.3), g, z1 + 0.05),
                       (sx * hw, g, z1 + 0.05)], (0.0, 0.0, 1.0), K.tint(STONE_T, 0.95, 806, sx), STONE)
        # the parapets: a low stone wall each side, a dressed coping on top
        for sx in (-1, 1):
            xc = sx * x1
            n = 3
            for k in range(n):
                za = z0 + (z1 - z0) * k / n
                zb = z0 + (z1 - z0) * (k + 1) / n
                h = P['parapet'] - 0.16 + jit(0.03, 807, sx, k)
                K.lump(p, (xc + jit(0.02, 808, sx, k), h / 2, (za + zb) / 2), (0.38, h, zb - za + 0.02),
                       K.tint(STONE_T, 1.0, 809, sx, k), STONE, seed=810 + k + sx * 4, rough=0.06)
            for k in range(4):
                za = z0 + (z1 - z0) * k / 4
                zb = z0 + (z1 - z0) * (k + 1) / 4
                K.lump(p, (xc, P['parapet'] - 0.08 + jit(0.015, 811, sx, k), (za + zb) / 2), (0.5, 0.17, zb - za - 0.02),
                       K.tint(DRESSED_T, 0.96, 812, sx, k), DRESSED, seed=813 + k + sx * 5, rough=0.06)

    def _steps(self):
        """The steps from the porch down to the road: each tread on the sim's ramp at its middle,
        laid in three slabs a little apart in height and line, each slab run down into the
        ground."""
        p, P, B = self.frame, self.P, self.B
        hw = P['stepHalfWidth']
        slope = P['stepSlope']
        tread = 0.5
        k = 0
        while True:
            za = P['z1'] + tread * k
            zb = za + tread
            top = -slope * (za + tread / 2 - P['z1'])
            g = min(B.ground(-hw, zb), B.ground(0.0, zb), B.ground(hw, zb))
            if top < g - 0.05 or k > 16:
                break
            splits = [-hw, -hw / 3 + jit(0.4, 820, k), hw / 3 + jit(0.4, 821, k), hw]
            for s in range(3):
                xa, xb = splits[s], splits[s + 1]
                yt = top + jit(0.02, 822, k, s)
                bottom = g - 0.4
                K.lump(p, ((xa + xb) / 2, (yt + bottom) / 2, (za + zb) / 2 + jit(0.03, 823, k, s)),
                       (xb - xa - 0.03, yt - bottom, tread + 0.06), K.tint(DRESSED_T, 0.9, 824, k, s, spread=0.06),
                       DRESSED, seed=825 + k * 3 + s, rough=0.02, yaw=jit(0.015, 826, k, s))
            k += 1

    # ------------------------------------------------------------ the awning
    def _awning(self):
        """A striped canvas awning over the porch: garnet and cream, laced to a batten under the
        jetty's joists, laid over iron rods out to an oak rail on two posts standing on the
        parapets' ends, sagging a little between its rods, its front hung with a dagged valance."""
        p = self.porch
        bm = p.bm
        (zb, yb), (zf, yf) = AWNING_BACK, AWNING_FRONT
        xs = [-AWNING_X + 2 * AWNING_X * k / STRIPES for k in range(STRIPES + 1)]
        ts = (0.0, 0.35, 0.7, 1.0)

        def at(k, t):
            """The canvas over stripe edge k, t of the way out: on a rod at every other edge,
            sagged between them, more toward its middle, and stirring a little in the air."""
            x = xs[k]
            y = yb + (yf - yb) * t
            if k % 2:
                y -= 0.11 * math.sin(math.pi * min(1.0, t * 1.08))
            y += 0.025 * vnoise(x / 1.7, t * 2.0, 870)
            return (x, y, zb + (zf - zb) * t)

        top = [[bm.verts.new(K.P(*at(k, t))) for k in range(STRIPES + 1)] for t in ts]
        bot = [[bm.verts.new(K.P(*(lambda q: (q[0], q[1] - 0.02, q[2]))(at(k, t)))) for k in range(STRIPES + 1)]
               for t in ts]

        def stripe(k, j, shade):
            if k % 2 == 0:
                return K.tint(GARNET, shade, 871, k, j, spread=0.03), CLOTH
            return K.tint(CANVAS, shade, 872, k, j, spread=0.02), PLASTER

        for grid, up, shade in ((top, 1.0, 1.0), (bot, -1.0, 0.72)):
            for j in range(len(ts) - 1):
                for k in range(STRIPES):
                    q = [grid[j][k], grid[j][k + 1], grid[j + 1][k + 1], grid[j + 1][k]]
                    f = bm.faces.new(q)
                    f.normal_update()
                    if f.normal.dot(K.P(0.0, up, 0.3 * up)) < 0:
                        f.normal_flip()
                    col, mat = stripe(k, j, shade)
                    p.paint([f], col, mat)
                    f[p.soft] = 1
        # the valance: a dagged strip hung from the front edge, each stripe ending in a point
        for k in range(STRIPES):
            a, b = at(k, 1.0), at(k + 1, 1.0)
            drop = 0.28 + jit(0.02, 873, k)
            mid = ((a[0] + b[0]) / 2, min(a[1], b[1]) - drop - 0.13, zf + 0.02)
            q = [(a[0], a[1], zf + 0.02), (b[0], b[1], zf + 0.02), (b[0], b[1] - drop, zf + 0.02), mid,
                 (a[0], a[1] - drop, zf + 0.02)]
            for facing, shade in ((1.0, 1.0), (-1.0, 0.72)):
                col, mat = stripe(k, 9, shade)
                K.face(p, q, (0.0, 0.0, facing), col, mat)
        # the batten under the joists, the rods, the rail and its two posts
        K.hewn(p, (-AWNING_X - 0.15, yb + 0.06, zb - 0.02), (AWNING_X + 0.15, yb + 0.06, zb - 0.02), 0.2, 0.18,
               K.tint(OAK, 0.8, 874), TIMBER, seed=875, segs=3, sag=0.02)
        for k in range(0, STRIPES + 1, 2):
            a, b = at(k, 0.0), at(k, 1.0)
            p.cylinder((a[0], a[1] - 0.05, a[2] + 0.1), (b[0], b[1] - 0.06, b[2] - 0.12), 0.035, IRON, METAL, sides=4)
        rail_z, rail_y = zf - 0.2, yf + 0.0
        K.hewn(p, (-AWNING_X - 0.2, rail_y, rail_z), (AWNING_X + 0.2, rail_y + 0.02, rail_z), 0.18, 0.17,
               K.tint(OAK, 0.78, 876), TIMBER, seed=877, segs=3, sag=0.05)
        P = self.P
        for sx in (-1, 1):
            x = sx * P['x1']
            foot = (x, P['parapet'] - 0.02, rail_z - 0.02)
            head = (x + jit(0.05, 878, sx), rail_y - 0.05, rail_z + jit(0.03, 879, sx))
            K.hewn(p, foot, head, 0.24, 0.24, K.tint(OAK, 0.82, 880, sx), TIMBER, seed=881 + sx, segs=2,
                   up=(0.0, 0.0, 1.0), wander=0.03)
            # a curved knee from the post up under the rail, and an iron shoe at its foot
            K.hewn(p, (x, rail_y - 0.95, rail_z), (x - sx * 0.75, rail_y - 0.1, rail_z), 0.13, 0.13,
                   K.tint(OAK, 0.78, 882, sx), TIMBER, seed=883 + sx, segs=2, sag=-0.08)
            K.lump(p, (x, P['parapet'] + 0.06, rail_z - 0.02), (0.32, 0.12, 0.32), IRON, METAL, seed=884 + sx,
                   rough=0.06)

    def _lanterns(self):
        """An iron lantern either side of the door on a wall bracket, lit."""
        p = self.lights
        zw = self.B.HALL['z1']
        for sx in (-1, 1):
            x = sx * 2.95
            K.hewn(p, (x, 4.55, zw + 0.02), (x, 4.6, zw + 0.62), 0.07, 0.07, IRON, METAL, seed=850 + sx, segs=1)
            c = (x, 4.2, zw + 0.62)
            p.cylinder((c[0], c[1] - 0.32, c[2]), (c[0], c[1] + 0.3, c[2]), 0.2, PANE, GLOW, sides=6)
            p.cylinder((c[0], c[1] + 0.3, c[2]), (c[0], c[1] + 0.52, c[2]), 0.26, IRON, METAL, sides=6, r1=0.06)
            p.cylinder((c[0], c[1] - 0.42, c[2]), (c[0], c[1] - 0.3, c[2]), 0.23, IRON, METAL, sides=6)

    # --------------------------------------------------------------- the sign
    def _sign(self):
        """The inn's sign: a giant oak tankard, staved and iron-hooped, its handle out to one side
        and its foam spilling over the rim, hung on two chains from a scrolled iron arm out of the
        upper storey between its windows, under the eaves."""
        p = self.porch
        # (the upper storey's face: the jetty's, leaning out a touch as it rises, inn_hall.py)
        zw = self.B.HALL['z1'] + self.B.LAYOUT['jetty']['out'] + 0.1
        x, z = sign_x(self.B), SIGN_Z
        arm_y = SIGN_ARM
        # the arm out of the gable, a scrolled stay under it, a bracket plate on the wall
        p.beam([(x, arm_y, zw - 0.05), (x, arm_y + 0.04, z), (x, arm_y - 0.06, z + 1.15)], 0.12, 0.16, IRON, METAL)
        pts = []
        for k in range(9):
            t = k / 8
            pts.append((x, arm_y - 1.85 + 1.85 * math.sin(t * math.pi / 2) ** 1.3, zw + (z - 0.6 - zw) * t))
        p.beam(pts, 0.09, 0.09, IRON, METAL)
        p.ring((x, arm_y - 0.75, zw + 1.25), 0.32, 0.05, IRON, segments=8, axis=(1.0, 0.0, 0.0), mat=METAL)
        K.lump(p, (x, arm_y - 0.9, zw - 0.02), (0.5, 2.3, 0.12), IRON, METAL, seed=860, rough=0.05)
        # the yoke: a short iron bar hung across under the arm over the tankard's middle, and a chain
        # from each of its ends down to the outside of the tankard's upper hoop
        zc = z + HOOP_Z
        yk = arm_y - 0.32
        p.cylinder((x, arm_y - 0.05, zc), (x, yk + 0.02, zc), 0.045, IRON, METAL, sides=4)
        half = HOOP_REACH + 0.1
        p.beam([(x - half - 0.08, yk + 0.04, zc), (x, yk - 0.03, zc), (x + half + 0.08, yk + 0.04, zc)], 0.08, 0.1,
               IRON, METAL)
        hoop = SIGN_BASE + HOOP_Y
        for sx in (-1, 1):
            n = 4
            xa, xb = x + sx * half, x + sx * (HOOP_REACH + 0.03)
            for k in range(n):
                y0 = yk - 0.03 - (yk - 0.03 - hoop) * k / n
                y1 = yk - 0.03 - (yk - 0.03 - hoop) * (k + 1) / n
                xm = xa + (xb - xa) * (k + 0.5) / n
                if k % 2 == 0:
                    p.box((xm, (y0 + y1) / 2, zc), (0.07, y0 - y1 + 0.05, 0.16), IRON, METAL)
                else:
                    p.box((xm, (y0 + y1) / 2, zc), (0.16, y0 - y1 + 0.05, 0.07), IRON, METAL)
        # the tankard itself: the props' painted model, its handle toward the wall, on the frame
        # (never faded for the camera as the porch's shell is: its paint is the props' atlas)
        PR.stand(self.frame, PR.PROPS['sign_tankard'], Vector((x, SIGN_BASE, z)), TANKARD_TURN, TANKARD_H)
