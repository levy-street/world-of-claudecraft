"""Ruin craft for the Hollow Crypt world entrance (build_crypt_entrance.py).

hckit's Piece (the pilot kit's primitives) plus what a believable ruin needs:

- stone(): a hand-hewn block, every corner chipped a little, its two faces
  pillowed (a raised centre vertex) so each stone is four facets that catch
  the light differently, with joint-dark corners and a paler face;
- wall(): irregular coursing (every row its own height, every stone its own
  length), proud and recessed stones, missing stones over a dark rubble core
  (two faces behind each run of stones, closed at a free end: it is what
  shows dark in every joint),
  a stepped broken top, openings cut by callables, and a deform hook for
  leaning and sagging runs; then a settling pass: no stone is left over a
  void (it is cut back to what carries it, or dropped), a ragged stone that
  carries another is brought back up to its bed, and a `dress` zone is cut
  and filled to its line (a gable's rake under its coping);
- arch(): moulded voussoir rings from an intrados polyline, bevelled;
- ivy(), grass(), litter(), leaf cards on a double-sided material;
- finish(): weathering baked into LINEAR vertex colour: a damp dark base,
  rain streaks, moss on tops and north faces, lichen, soot, and ray-cast
  ambient occlusion against the whole set piece and its terrain.

Colours are authored sRGB and converted once in finish(); the colour layer is
a FLOAT corner attribute, so the glTF exporter writes it unchanged.
Deterministic: every random draw comes from the piece's seeded rng, and no
set of bmesh elements is ever iterated.
"""
import math
import random
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import entrance_common as ec
import hckit

B = ec.B
TAU = math.tau

# Material slots.
STONE, LEAF, VOID = 0, 1, 2
# Weathering kinds (per face).
K_STONE, K_WOOD, K_METAL, K_LEAF, K_RAW, K_CLOTH, K_EARTH = 0, 1, 2, 3, 4, 5, 6

# Vale limestone, five tones (sRGB) and what grows on it.
LIME = (0.60, 0.60, 0.57)
LIME_WARM = (0.63, 0.59, 0.51)
LIME_COOL = (0.52, 0.55, 0.57)
LIME_DARK = (0.41, 0.41, 0.41)
LIME_PALE = (0.69, 0.69, 0.65)
LIME_ROSE = (0.56, 0.50, 0.47)
CORE = (0.2, 0.19, 0.18)
MOSS_DEEP = (0.21, 0.31, 0.14)
MOSS_BRIGHT = (0.38, 0.46, 0.19)
LICHEN_PALE = (0.74, 0.76, 0.66)
LICHEN_OCHRE = (0.74, 0.62, 0.22)
DAMP = (0.17, 0.2, 0.15)
IVY = ((0.11, 0.24, 0.10), (0.16, 0.31, 0.12), (0.08, 0.17, 0.08), (0.2, 0.34, 0.13))
IVY_TURN = ((0.36, 0.22, 0.11), (0.45, 0.33, 0.14))
GRASS = ((0.30, 0.46, 0.17), (0.38, 0.52, 0.20), (0.24, 0.38, 0.15))
GRASS_DRY = (0.62, 0.58, 0.30)
STEM = (0.22, 0.17, 0.12)


def srgb_to_linear(c):
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, k):
    return tuple(min(1.0, max(0.0, v * k)) for v in c)


def smooth(a, b, v):
    t = max(0.0, min(1.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


fbm = hckit._fbm


def _faces_of(verts):
    seen, out = set(), []
    for v in verts:
        for f in v.link_faces:
            if f not in seen:
                seen.add(f)
                out.append(f)
    return out


def _edges_of(faces):
    seen, out = set(), []
    for f in faces:
        for e in f.edges:
            if e not in seen:
                seen.add(e)
                out.append(e)
    return out


def arch_points(half, rise, steps=6, round_=False):
    """Intrados of an arch springing at (+-half, 0) with its apex at (0, rise),
    left to right: a two-centred pointed arch (rise >= half) or a round one."""
    if round_ or rise < half:
        return [(-math.cos(math.pi * i / (2 * steps)) * half, math.sin(math.pi * i / (2 * steps)) * rise)
                for i in range(2 * steps + 1)]
    R = (half * half + rise * rise) / (2 * half)
    top = math.asin(min(1.0, rise / R))
    right = [(half - R + R * math.cos(top * i / steps), R * math.sin(top * i / steps)) for i in range(steps + 1)]
    return [(-x, z) for (x, z) in right[:-1]] + [(0.0, rise)] + right[-2::-1]


def arch_hole(half, spring, rise, cx=0.0, round_=False):
    """hole(x, y) for an arched opening (x across the wall, y up)."""
    R = (half * half + rise * rise) / (2 * half) if rise >= half and not round_ else None

    def hole(x, y):
        dx = abs(x - cx)
        if dx >= half or y <= -5:
            return False
        if y <= spring:
            return True
        if R is None:
            k = (y - spring) / rise
            return k < 1 and dx < half * math.sqrt(max(0.0, 1 - k * k))
        return math.hypot(dx - (half - R), y - spring) < R and y < spring + rise
    return hole


class Ruin(hckit.Piece):
    def __init__(self, name, seed=0, moss=1.0, damp=1.0):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.kindL = self.bm.faces.layers.int.new('kind')
        self.stamp = 0
        self.rng = random.Random(zlib.crc32(name.encode()) * 131 + seed)
        self.kind = K_STONE
        self.moss = moss
        self.damp = damp
        self.soot = []
        self.streaks = []
        self.collect = None
        self.weather = 1.0
        self.lichen = 0.0
        self.walls = 0
        self.settled = {'cut back': 0, 'dropped': 0, 'raised': 0, 'dressed': 0, 'filled': 0}
        self._bvh = (None, -1)

    # ------------------------------------------------------------ painting
    def _paint(self, faces, color, mat):
        for face in faces:
            face.material_index = mat
            face[self.kindL] = self.kind
            for loop in face.loops:
                loop[self.col] = (color[0], color[1], color[2], 1.0)

    def _new_faces(self, before):
        return [f for f in self.bm.faces if f not in before]

    def as_kind(self, kind):
        piece = self

        class _K:
            def __enter__(self_):
                self_.prev = piece.kind
                piece.kind = kind

            def __exit__(self_, *a):
                piece.kind = self_.prev
        return _K()

    def ghost(self):
        """Run a block for its random draws only and throw away what it built.
        A part that was rebuilt keeps its first version inside ghost(), so every
        later draw of the piece is the one the approved build made, and the new
        version draws from side()."""
        piece = self

        class _G:
            def __enter__(self_):
                self_.mark = piece.mark()
                self_.lists = (len(piece.soot), len(piece.streaks))

            def __exit__(self_, *a):
                doomed = [v for v in piece.bm.verts if v[piece.gen] == 0 or v[piece.gen] > self_.mark]
                bmesh.ops.delete(piece.bm, geom=doomed, context='VERTS')
                del piece.soot[self_.lists[0]:]
                del piece.streaks[self_.lists[1]:]
        return _G()

    def side(self, tag):
        """A block that draws from a stream of its own (seeded by the piece and
        the tag), leaving the piece's stream where it was."""
        piece = self

        class _S:
            def __enter__(self_):
                self_.prev = piece.rng
                piece.rng = random.Random(zlib.crc32(f'{piece.name}|{tag}'.encode()))

            def __exit__(self_, *a):
                piece.rng = self_.prev
        return _S()

    def surface(self, x, y, top, floor):
        """The highest face of this piece under Blender (x, y) at or below
        `top`, never lower than `floor` (the ground there)."""
        n = (len(self.bm.verts), len(self.bm.faces))
        if self._bvh[1] != n:
            self._bvh = (BVHTree.FromBMesh(self.bm, epsilon=0.0), n)
        if top <= floor:
            return floor
        hit = self._bvh[0].ray_cast(Vector((x, y, top)), Vector((0, 0, -1)), top - floor)
        return hit[0].z if hit[0] is not None else floor

    def tone(self, u=0.0, y=0.0):
        """One stone's colour: the wall's drifting base plus the odd warm,
        cool, dark, pale or rose stone."""
        r = self.rng.random()
        drift = fbm(u * 0.21 + 3.1, y * 0.27 - 1.7, 0.5)
        base = mix(LIME, LIME_COOL, max(0.0, drift * 1.6 - 0.5))
        if r < 0.13:
            base = LIME_WARM
        elif r < 0.24:
            base = LIME_COOL
        elif r < 0.33:
            base = LIME_DARK
        elif r < 0.40:
            base = LIME_PALE
        elif r < 0.45:
            base = LIME_ROSE
        return self.vary(base, 0.06)

    # ---------------------------------------------------------- primitives
    def box(self, center, size, color, mat=STONE, bevel=0.0, yaw=0.0, pitch=0.0, roll=0.0, taper=1.0, M=None,
            chip=0.0, bottom=True):
        made = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = made['verts']
        rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
        m = min(size)
        for v in verts:
            k = taper if v.co.z > 0 else 1.0
            p = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2]))
            if chip:
                q = chip * m
                p = Vector((p.x - math.copysign(q * self.rng.random() ** 2, p.x),
                            p.y - math.copysign(q * self.rng.random() ** 2, p.y),
                            p.z - math.copysign(q * self.rng.random() ** 2, p.z)))
            p = rot @ p + Vector(center)
            v.co = M @ p if M is not None else p
        faces = _faces_of(verts)
        if not bottom:
            low = min(faces, key=lambda f: f.calc_center_median().z)
            bmesh.ops.delete(self.bm, geom=[low], context='FACES_ONLY')
            faces = [f for f in faces if f.is_valid]
        self._paint(faces, color, mat)
        if self.collect is not None:
            self.collect.extend(verts)
        if bevel > 0:
            out = bmesh.ops.bevel(self.bm, geom=_edges_of(faces), offset=bevel, segments=1, affect='EDGES',
                                  clamp_overlap=True)
            self._paint(out['faces'], color, mat)
            if self.collect is not None:
                self.collect.extend(v for v in out['verts'] if v not in verts)
        return faces

    def core(self, center, size, color, ends=(False, False)):
        """The dark rubble core behind a run of stones: its two faces (its top
        and its bed are never seen: the stones over and under it cover them),
        and an end, set a hand inside the last stone, where the run stops at
        open air. Without that end the bed joints of a wall's free end, seen
        from below, show the sky through the hollow stones."""
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        quads = [((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)), ((1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1))]
        inset = 1 - min(0.05, hx * 0.5) / hx
        if ends[0]:
            quads.append(((-inset, 1, -1), (-inset, -1, -1), (-inset, -1, 1), (-inset, 1, 1)))
        if ends[1]:
            quads.append(((inset, -1, -1), (inset, 1, -1), (inset, 1, 1), (inset, -1, 1)))
        for corners in quads:
            vs = [self.bm.verts.new(Vector((cx + i * hx, cy + j * hy, cz + k * hz))) for (i, j, k) in corners]
            if self.collect is not None:
                self.collect.extend(vs)
            f = self.bm.faces.new(vs)
            f.material_index = STONE
            f[self.kindL] = self.kind
            for loop in f.loops:
                loop[self.col] = (color[0], color[1], color[2], 1.0)

    def hewn(self, center, size, color, bevel=None, chip=0.08, **kw):
        """A dressed hero block: chipped corners, then a chamfer that catches light."""
        m = min(size)
        bev = min(0.07, m * 0.13) if bevel is None else bevel
        return self.box(center, size, color, bevel=bev, chip=chip, **kw)

    def stone(self, c, size, color, rot=None, chip=0.05, pillow=0.04, M=None, bottom=False, knock=0.1, ends=True):
        """A rough hewn walling stone (see the module docstring). Local frame:
        X along the wall, Y through it (the pillowed faces), Z up."""
        rng = self.rng
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        m = min(size)
        cs = []
        for (i, j, k) in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                          (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
            q = chip * m
            cs.append(Vector((i * (sx - q * rng.random() ** 2), j * (sy - q * 0.5 * rng.random() ** 2),
                              k * (sz - q * rng.random() ** 2))))
        if rng.random() < knock:
            i = rng.choice((4, 5, 6, 7, 4, 5, 6, 7, 0, 1))
            cs[i] = cs[i] * (0.62 + 0.2 * rng.random())
        mids = []
        for (quad, n) in (((0, 1, 5, 4), Vector((0, -1, 0))), ((2, 3, 7, 6), Vector((0, 1, 0)))):
            ctr = sum((cs[i] for i in quad), Vector()) / 4
            ctr += n * (pillow * m * (0.4 + rng.random())) + Vector(((rng.random() - 0.5) * sx * 0.5, 0,
                                                                      (rng.random() - 0.5) * sz * 0.5))
            mids.append(ctr)
        pts = cs + mids
        c = Vector(c)
        if rot is not None:
            pts = [rot @ p for p in pts]
        pts = [p + c for p in pts]
        if M is not None:
            pts = [M @ p for p in pts]
        vs = [self.bm.verts.new(p) for p in pts]
        if self.collect is not None:
            self.collect.extend(vs)
        edge = scale(color, 0.86 + 0.06 * rng.random())
        face = scale(color, 1.05)
        for (quad, mid) in (((0, 1, 5, 4), 8), ((2, 3, 7, 6), 9)):
            for k in range(4):
                f = self.bm.faces.new((vs[quad[k]], vs[quad[(k + 1) % 4]], vs[mid]))
                f.material_index = STONE
                f[self.kindL] = self.kind
                ls = f.loops
                ls[0][self.col] = (*edge, 1.0)
                ls[1][self.col] = (*edge, 1.0)
                ls[2][self.col] = (*face, 1.0)
        side = scale(color, 0.94)
        quads = ([(1, 2, 6, 5), (3, 0, 4, 7)] if ends else []) + [(4, 5, 6, 7)] + ([(3, 2, 1, 0)] if bottom else [])
        for quad in quads:
            self._stone_quad(vs, quad, side)
        return vs

    def _stone_quad(self, vs, quad, color):
        f = self.bm.faces.new([vs[i] for i in quad])
        f.material_index = STONE
        f[self.kindL] = self.kind
        for loop in f.loops:
            loop[self.col] = (*color, 1.0)

    # --------------------------------------------------------------- walls
    def wall(self, a, b, depth, y0, top_fn, holes=(), course=(0.42, 0.72), unit=(1.1, 2.7), deform=None,
             missing=0.025, proud=0.045, chip=0.05, pillow=0.04, core=CORE, ragged=0.3, tone=None, dress=(),
             bridge=None, open_ends=(False, False)):
        """Coursed rubble-and-ashlar from a to b (local game (lx, lz)), bottom
        y0, top top_fn(t), t in [0, 1] from a. holes: callables (u, y) -> open.
        deform(u, n, y) -> (du, dn, dy) bends the finished run (a lean, a sag).
        bridge: the openings something else carries the masonry over (an arch
        ring, a lintel); every hole by default. dress: zones (u0, u1, fn,
        breaks) whose top is cut and filled to the line fn(u) (absolute
        height; breaks are the u where it kinks or jumps). open_ends: whether
        the wall's start and its finish stand free in the air (not against
        another wall): their joints are then closed from behind like any
        broken edge's.
        Returns the top stones as Blender-space (centre, width) pairs."""
        ax, az = a
        bx, bz = b
        L = math.hypot(bx - ax, bz - az)
        M = Matrix.Translation(B(ax, az, 0)) @ Matrix.Rotation(math.atan2(-(bz - az), bx - ax), 4, 'Z')
        rng = self.rng
        tone = tone or self.tone
        prev, self.collect = self.collect, []
        tmax = max(top_fn(k / 60) for k in range(61))
        rows, order = [], []
        y, row = y0, 0
        while y < tmax - 0.1 and row < 200:
            h = rng.uniform(*course) * (1.3 if row == 0 else 1.0)
            u = -rng.uniform(0.15, 0.9) * h
            stones = []
            while u < L - 1e-3:
                w = h * rng.uniform(*unit)
                u0, u1 = max(0.0, u), min(L, u + w)
                u += w
                if u1 - u0 < 0.2:
                    continue
                top = min(top_fn(u0 / L), top_fn((u0 + u1) / (2 * L)), top_fn(u1 / L))
                hh = min(h, top - y)
                if hh < 0.2:
                    continue
                n = max(2, int((u1 - u0) / 0.1))
                start = None
                for k in range(n + 1):
                    uu = u0 + (u1 - u0) * k / n
                    solid = not any(hole(uu, y + hh * 0.25) or hole(uu, y + hh * 0.75) for hole in holes)
                    if solid and start is None:
                        start = uu
                    if (not solid or k == n) and start is not None:
                        r0, r1, start = start, uu, None
                        if r1 - r0 < 0.2:
                            continue
                        is_top = top - (y + hh) < 0.2
                        # one record per stone; a missing stone keeps its record (its dark core shows)
                        rec = {'r0': r0, 'r1': r1, 'y': y, 'h': h, 'hh': hh, 'core': hh, 'zl': hh - 0.016,
                               'zr': hh - 0.016, 'vs': None, 'top': is_top, 'ends': True, 'col': None, 'gone': False,
                               'row': row, 'capped': False}
                        stones.append(rec)
                        if row > 1 and not is_top and rng.random() < missing:
                            continue
                        bh = hh - 0.016
                        if is_top:
                            bh *= 1 - rng.random() * ragged
                        off = (rng.random() - 0.5) * 2 * proud
                        rot = Matrix.Rotation((rng.random() - 0.5) * 0.03, 3, 'Z') @ \
                            Matrix.Rotation((rng.random() - 0.5) * (0.07 if is_top else 0.02), 3, 'Y')
                        size = (r1 - r0 - 0.018, depth * (0.96 + rng.random() * 0.1), bh)
                        col = tone((r0 + r1) / 2 + ax * 0.7, y)
                        ends = is_top or r0 - u0 > 1e-6 or u1 - r1 > 1e-6 or u0 <= 1e-6 or u1 >= L - 1e-6
                        rec['vs'] = self.stone((((r0 + r1) / 2), off, y + bh / 2), size, col, rot=rot, chip=chip,
                                               pillow=pillow, knock=0.3 if is_top else 0.0, ends=ends)
                        rec.update(zl=bh, zr=bh, ends=ends, col=col)
                        if is_top:
                            # (the core behind a top stone stops under its ragged top: a
                            # core left at the course's height stands over it like a dark lid)
                            rec.update(core=bh + 0.012, capped=True)
                            order.append(rec)
            rows.append((y, h, stones))
            y += h
            row += 1
        self.walls += 1
        self._bvh = (None, -1)
        self._settle(rows, depth, holes, holes if bridge is None else bridge, dress, unit, proud, chip, pillow, tone, ax)
        # One dark core per solid run of a row (merged neighbours): it is what
        # shows in the joints. Stones of the course's full height share a core
        # of that height; top stones and cut ones share one that stops under
        # the lowest of them. A stone too low for a core is closed underneath
        # instead, or its bed joint would show the sky through it.
        with self.as_kind(K_RAW):
            for (y, h, stones) in rows:
                merged = []
                for s in sorted((s for s in stones if not s['gone'] and s['core'] >= 0.1), key=lambda s: s['r0']):
                    m = merged[-1] if merged else None
                    if m and s['r0'] - m[1] < 0.02 and m[3] == s['capped'] and (s['capped'] or abs(m[2] - s['core']) < 1e-6):
                        m[1], m[2] = s['r1'], min(m[2], s['core'])
                    else:
                        merged.append([s['r0'], s['r1'], s['core'], s['capped']])
                for i, (r0, r1, hh, _capped) in enumerate(merged):
                    # An end shows where no other run of the course carries on from
                    # it and the joint is over a walker's eyes (from above, the stone
                    # below closes it); the wall's own two ends only where the
                    # caller says they stand free.
                    high = y + hh > 1.6
                    lo = high and ((i == 0 or r0 - merged[i - 1][1] > 0.05) and (open_ends[0] or r0 > 0.05))
                    hi = high and ((i == len(merged) - 1 or merged[i + 1][0] - r1 > 0.05) and (open_ends[1] or r1 < L - 0.05))
                    self.core(((r0 + r1) / 2, 0, y + hh / 2 - 0.02), (r1 - r0, depth * 0.84, hh), core, ends=(lo, hi))
        for (y, h, stones) in rows:
            for s in stones:
                if not s['gone'] and s['vs'] is not None and s['core'] < 0.1:
                    self._stone_quad(s['vs'], (3, 2, 1, 0), scale(s['col'], 0.94))
        # The top stones, in the order they were laid (the growth pass draws once
        # per entry): a dropped stone hands its tuft to whatever now tops the wall there.
        tops = []
        for s in order:
            c = (s['r0'] + s['r1']) / 2
            if s['gone']:
                z = y0
                for (yy, _h, stones) in reversed(rows[:s['row']]):
                    under = [t for t in stones if not t['gone'] and t['vs'] is not None and t['r0'] <= c <= t['r1']]
                    if under:
                        z = yy + max(under[0]['zl'], under[0]['zr'])
                        break
                tops.append((Vector((c, 0, z)), min(s['r1'] - s['r0'], 0.6)))
            else:
                tops.append((Vector((c, 0, s['y'] + (s['zl'] + s['zr']) / 2)), s['r1'] - s['r0']))
        out = []
        dfn = deform or (lambda u, n, yy: (0.0, 0.0, 0.0))
        for v in self.collect:
            du, dn, dy = dfn(v.co.x, v.co.y, v.co.z)
            v.co = M @ Vector((v.co.x + du, v.co.y + dn, v.co.z + dy))
        for (p, w) in tops:
            du, dn, dy = dfn(p.x, p.y, p.z)
            out.append((M @ Vector((p.x + du, p.y + dn, p.z + dy)), w))
        self.collect = prev
        return out

    # ------------------------------------------------------- settling a wall
    _JOINT = 0.016

    def _set_top(self, s, zl, zr):
        """Move a stone's top to zl at its low-u end and zr at its high-u end
        (heights above its bed)."""
        dl, dr = zl - s['zl'], zr - s['zr']
        vs = s['vs']
        if vs is not None:
            for i in (4, 7):
                vs[i].co.z += dl
            for i in (5, 6):
                vs[i].co.z += dr
            for i in (8, 9):
                vs[i].co.z += (dl + dr) / 4
        s['zl'], s['zr'] = zl, zr
        s['core'], s['capped'] = min(zl, zr) + 0.012, True

    def _restretch(self, s, lo, hi):
        """Cut a stone back (or draw it out) to span lo..hi along the wall."""
        vs = s['vs']
        if vs is not None:
            k = (hi - lo - 0.018) / max(1e-6, s['r1'] - s['r0'] - 0.018)
            for v in vs:
                v.co.x = lo + 0.009 + (v.co.x - s['r0'] - 0.009) * k
            self._cap(s)
        s['r0'], s['r1'] = lo, hi

    def _cap(self, s, low=True, high=True):
        """Give a stone built without end faces its low-u and/or high-u end."""
        if s['vs'] is not None and not s['ends']:
            for (want, quad) in ((high, (1, 2, 6, 5)), (low, (3, 0, 4, 7))):
                if want:
                    self._stone_quad(s['vs'], quad, scale(s['col'], 0.94))
            s['ends'] = True

    def _drop(self, s):
        s['gone'] = True
        if s['vs'] is not None:
            keep = set(s['vs'])
            self.collect = [v for v in self.collect if v not in keep]
            bmesh.ops.delete(self.bm, geom=s['vs'], context='VERTS')
            s['vs'] = None

    def _settle(self, rows, depth, holes, bridge, dress, unit, proud, chip, pillow, tone, ax):
        """Bottom up, course by course: cut every stone back to what carries
        it (the full stones of the course below, or an opening an arch
        bridges), drop the ones nothing carries, raise a ragged stone that
        carries another, and cut and fill the dress zones to their line."""
        J = self._JOINT
        done = self.settled
        side = random.Random(zlib.crc32(f'{self.name}|wall|{self.walls}'.encode()))

        def full(t, h):
            return min(t['zl'], t['zr']) >= h - J - 0.012

        def new_stone(y, h, row, p0, p1, stones):
            keep, self.rng = self.rng, side
            size = (p1 - p0 - 0.018, depth * (0.96 + side.random() * 0.1), h - J)
            col = tone((p0 + p1) / 2 + ax * 0.7, y)
            off = (side.random() - 0.5) * 2 * proud
            vs = self.stone(((p0 + p1) / 2, off, y + (h - J) / 2), size, col,
                            rot=Matrix.Rotation((side.random() - 0.5) * 0.03, 3, 'Z'), chip=chip, pillow=pillow,
                            knock=0.0, ends=False)
            self.rng = keep
            rec = {'r0': p0, 'r1': p1, 'y': y, 'h': h, 'hh': h, 'core': h, 'zl': h - J, 'zr': h - J, 'vs': vs,
                   'top': False, 'ends': False, 'col': col, 'gone': False, 'row': row, 'capped': False}
            stones.append(rec)
            return rec

        def root(g, lo, hi):
            """Where g changes sign between lo and hi (bisection)."""
            glo = g(lo)
            for _ in range(40):
                mid = (lo + hi) / 2
                if (g(mid) > 0) == (glo > 0):
                    lo = mid
                else:
                    hi = mid
            return (lo + hi) / 2

        def to_line(s, y, h, row, fn, breaks, stones):
            """Cut one stone of a dress zone to the line: split it where the
            line leaves the course (or kinks), then slope each part's top."""
            def want(u):
                return min(h, fn(u) - y) - J

            cuts = [b for b in breaks if s['r0'] + 0.15 < b < s['r1'] - 0.15]
            parts, lo = [], s['r0']
            for c in sorted(cuts) + [s['r1']]:
                e0, e1 = lo + 1e-3, c - 1e-3
                a_full, b_full = want(e0) >= h - J - 1e-6, want(e1) >= h - J - 1e-6
                if a_full != b_full:
                    x = root(lambda u: fn(u) - y - h, e0, e1)
                    if lo + 0.04 < x < c - 0.04:      # (a part too short to lay is left out below)
                        parts.append((lo, x))
                        lo = x
                parts.append((lo, c))
                lo = c
            first = True
            for (p0, p1) in parts:
                # a part ends where the line comes down to its bed
                e0, e1 = p0 + 1e-3, p1 - 1e-3
                if want(e0) < 0.05 and want(e1) < 0.05:
                    continue
                if want(e0) < 0.05:
                    p0 = root(lambda u: want(u) - 0.05, e0, e1)
                elif want(e1) < 0.05:
                    p1 = root(lambda u: want(u) - 0.05, e0, e1)
                if p1 - p0 < 0.12:
                    continue
                if first:
                    t, first = s, False
                    if abs(p0 - s['r0']) > 1e-6 or abs(p1 - s['r1']) > 1e-6:
                        self._restretch(s, p0, p1)
                else:
                    t = new_stone(y, h, row, p0, p1, stones)
                zl, zr = max(0.05, want(p0 + 1e-3)), max(0.05, want(p1 - 1e-3))
                if abs(zl - t['zl']) > 0.004 or abs(zr - t['zr']) > 0.004:
                    self._set_top(t, zl, zr)
                    done['dressed'] += 1
            if first:
                self._drop(s)

        for ri, (y, h, stones) in enumerate(rows):
            if ri > 0:
                py, ph, pst = rows[ri - 1]
                car = [t for t in pst if not t['gone'] and (full(t, ph) or (t['vs'] is not None and t['top'] and
                                                                              t['hh'] >= ph - 1e-6))]

                def carried(u, car=car, py=py, ph=ph):
                    for t in car:
                        if t['r0'] - 0.02 <= u <= t['r1'] + 0.02:
                            return t
                    # over a bridged opening, or over the ring of voussoirs that
                    # bridges it (a ring is up to 0.6 thick)
                    return True if any(br(u, yy) for br in bridge
                                       for yy in (py + ph * 0.75, py + ph * 0.25, py - 0.3, py - 0.6)) else None

                for s in list(stones):
                    n = max(4, int(math.ceil((s['r1'] - s['r0']) / 0.04)))
                    step = (s['r1'] - s['r0']) / n
                    hit = [carried(s['r0'] + step * (k + 0.5)) for k in range(n)]
                    ok = [k for k in range(n) if hit[k]]
                    if len(ok) * step < 0.18:
                        done['dropped'] += s['vs'] is not None
                        self._drop(s)
                        continue
                    lo = max(s['r0'], s['r0'] + step * ok[0] - 0.08)
                    hi = min(s['r1'], s['r0'] + step * (ok[-1] + 1) + 0.08)
                    cut = lo > s['r0'] + 1e-6 or hi < s['r1'] - 1e-6
                    if hi - lo < (0.5 if cut else 0.22):      # (a stone cut back to a stub is not left standing)
                        done['dropped'] += s['vs'] is not None
                        self._drop(s)
                        continue
                    if cut:
                        done['cut back'] += s['vs'] is not None
                        self._restretch(s, lo, hi)
                    for t in {id(hit[k]): hit[k] for k in ok if isinstance(hit[k], dict)}.values():
                        if t['vs'] is not None and not full(t, ph) and \
                                min(t['r1'], s['r1']) - max(t['r0'], s['r0']) >= 0.1:
                            self._set_top(t, ph - J, ph - J)
                            done['raised'] += 1
            else:
                def carried(u):
                    return True
            # A missing stone is a dark pocket between two stones; at a free end
            # of its course it is simply not there (and carries nothing).
            for s in stones:
                if s['vs'] is None and not s['gone']:
                    sides = [any(t is not s and not t['gone'] and t['vs'] is not None and abs(e - f(t)) < 0.05
                                 for t in stones) or any(hole(e + d, y + s['hh'] * 0.5) for hole in holes)
                             for (e, f, d) in ((s['r0'], lambda t: t['r1'], -0.12), (s['r1'], lambda t: t['r0'], 0.12))]
                    if not all(sides):
                        self._drop(s)
            for (d0, d1, fn, breaks) in dress:
                for s in list(stones):
                    if not s['gone'] and s['vs'] is not None and d0 <= (s['r0'] + s['r1']) / 2 <= d1:
                        to_line(s, y, h, ri, fn, breaks, stones)
                # fill what is carried, under the line and still empty
                step = 0.02
                n = int((d1 - d0) / step)
                runs, start = [], None
                for k in range(n + 1):
                    u = d0 + step * (k + 0.5)
                    hh = min(h, fn(u) - y)
                    free = k < n and hh >= 0.05 + J and carried(u) and \
                        not any(not t['gone'] and t['r0'] - 0.01 <= u <= t['r1'] + 0.01 for t in stones) and \
                        not any(hole(u, y + hh * 0.25) or hole(u, y + hh * 0.75) for hole in holes)
                    if free and start is None:
                        start = u - step / 2
                    if not free and start is not None:
                        runs.append((start, u - step / 2))
                        start = None
                for (g0, g1) in runs:
                    if g1 - g0 < 0.15:
                        continue
                    p0 = g0
                    while p0 < g1 - 1e-6:
                        p1 = min(g1, p0 + h * side.uniform(max(unit[0], 0.75 * unit[1]), unit[1]))      # long stones
                        if g1 - p1 < 0.45:
                            p1 = g1
                        to_line(new_stone(y, h, ri, p0, p1, stones), y, h, ri, fn, breaks, stones)
                        done['filled'] += 1
                        p0 = p1
        # A stone built without end faces shows an end when no neighbour as
        # tall as itself stands against it (the neighbour is gone, or cut lower).
        for (y, h, stones) in rows:
            live = [s for s in stones if not s['gone']]
            for s in live:
                if s['vs'] is None or s['ends']:
                    continue
                left = any(t is not s and abs(t['r1'] - s['r0']) < 0.05 and t['zr'] >= s['zl'] - 0.03 for t in live)
                right = any(t is not s and abs(t['r0'] - s['r1']) < 0.05 and t['zl'] >= s['zr'] - 0.03 for t in live)
                if not (left and right):
                    self._cap(s, low=not left, high=not right)

    def arch(self, pts, thick, depth, color, M, bevel=0.045, chip=0.04, skip=(), y_off=0.0, tone=0.07,
             depth_jit=0.04, center=None):
        """A ring of voussoirs over an intrados polyline pts [(x, z)] in the
        wall plane (X across, Z up; Y through the wall, centred on y_off)."""
        n = len(pts) - 1
        cx = sum(p[0] for p in pts) / len(pts)
        cz = min(p[1] for p in pts)
        outer = []
        for i, (x, z) in enumerate(pts):
            x0, z0 = pts[max(0, i - 1)]
            x1, z1 = pts[min(n, i + 1)]
            tx, tz = x1 - x0, z1 - z0
            ln = math.hypot(tx, tz) or 1.0
            nx, nz = tz / ln, -tx / ln
            if center is not None:
                ln = math.hypot(x - center[0], z - center[1]) or 1.0
                nx, nz = (x - center[0]) / ln, (z - center[1]) / ln
            elif nx * (x - cx) + nz * (z - cz) < 0:
                nx, nz = -nx, -nz
            outer.append((x + nx * thick, z + nz * thick))
        for i in range(n):
            if i in skip:
                continue
            quad = [pts[i], pts[i + 1], outer[i + 1], outer[i]]
            mx = sum(q[0] for q in quad) / 4
            mz = sum(q[1] for q in quad) / 4
            d = depth * (1 + (self.rng.random() - 0.5) * depth_jit)
            vs = []
            for yy in (-d / 2, d / 2):
                for (x, z) in quad:
                    q = Vector((mx + (x - mx) * 0.975, y_off + yy, mz + (z - mz) * 0.975))
                    q += (Vector((mx, y_off, mz)) - q) * (chip * self.rng.random() ** 2)
                    vs.append(self.bm.verts.new(M @ q))
            faces = []
            for idx in ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                faces.append(self.bm.faces.new([vs[k] for k in idx]))
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
            col = self.vary(color, tone)
            self._paint(faces, col, STONE)
            if bevel > 0:
                out = bmesh.ops.bevel(self.bm, geom=_edges_of(faces), offset=bevel, segments=1, affect='EDGES',
                                      clamp_overlap=True)
                self._paint(out['faces'], col, STONE)
        return outer

    def roll(self, pts, r, color, M, y_off=0.0, sides=5, out=0.0):
        """A roll moulding swept along a polyline in the wall plane."""
        n = len(pts) - 1
        cx = sum(p[0] for p in pts) / len(pts)
        cz = min(p[1] for p in pts)
        path = []
        for i, (x, z) in enumerate(pts):
            x0, z0 = pts[max(0, i - 1)]
            x1, z1 = pts[min(n, i + 1)]
            tx, tz = x1 - x0, z1 - z0
            ln = math.hypot(tx, tz) or 1.0
            nx, nz = tz / ln, -tx / ln
            if nx * (x - cx) + nz * (z - cz) < 0:
                nx, nz = -nx, -nz
            path.append(M @ Vector((x + nx * out, y_off, z + nz * out)))
        return self.sweep(path, r, r, color, sides=sides)

    # ------------------------------------------------------------- foliage
    def leaf(self, pos, normal, size, color, spin=0.0, droop=0.15, n=1):
        """n round leaf cards fanned from one point: a five-point blade each
        (stem end, two shoulders, a blunt double tip), lying near the plane
        whose normal is `normal` and drooping at the tip."""
        nrm = Vector(normal).normalized()
        t = nrm.cross(Vector((0, 0, 1)))
        if t.length < 1e-3:
            t = nrm.cross(Vector((1, 0, 0)))
        t.normalize()
        u = t.cross(nrm).normalized()
        p0 = Vector(pos)
        rng = self.rng
        for k in range(n):
            a = spin + TAU * k / n + (rng.random() - 0.5) * (1.2 if n > 1 else 0.0)
            d = t * math.cos(a) + u * math.sin(a)
            w = t * -math.sin(a) + u * math.cos(a)
            ln = size * (0.8 + 0.4 * rng.random())
            sag = nrm * ln * droop
            pts = (p0 + nrm * 0.015, p0 + d * ln * 0.38 + w * ln * 0.42 - sag * 0.3, p0 + d * ln * 0.9 + w * ln * 0.2 - sag,
                   p0 + d * ln * 0.9 - w * ln * 0.2 - sag, p0 + d * ln * 0.38 - w * ln * 0.42 - sag * 0.3)
            f = self.bm.faces.new([self.bm.verts.new(q) for q in pts])
            f.material_index = LEAF
            f[self.kindL] = K_LEAF
            c = scale(color, 0.84 + 0.3 * rng.random())
            for i, loop in enumerate(f.loops):
                loop[self.col] = (*scale(c, 0.72 if i == 0 else (1.12 if i in (2, 3) else 0.95)), 1.0)

    def ivy(self, base, out, height, width, stems=4, density=7.0, size=0.17, alive=None, lean=0.0, hang=False,
            mass=0, top=None):
        """Ivy climbing from `base` (Blender space) up a face whose outward
        normal is `out` (or hanging down it): wandering stems, leaves along
        them, thick low and thinning toward the tips. top(point) is the
        wall's own broken top there: a hanging stem starts no higher."""
        rng = self.rng
        base = Vector(base)
        out = Vector(out).normalized()
        side = Vector((0, 0, 1)).cross(out)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        sgn = -1.0 if hang else 1.0
        for s in range(stems):
            off = (rng.random() - 0.5) * width
            p = base + side * off
            if top is not None:
                # a stem with no wall to hang from moves in toward the middle of the clump
                for near in (1.0, 0.75, 0.5, 0.25, 0.0):
                    p = base + side * off * near
                    cap = top(p)
                    if cap >= base.z - 0.5 * height:
                        break
                p.z = min(p.z, cap)
            ln = height * (0.45 + 0.55 * rng.random())
            drift = (rng.random() - 0.5) * 0.5 + lean
            steps = max(3, int(ln / 0.28))
            pts = [p + out * 0.04]
            for i in range(steps):
                drift += (rng.random() - 0.5) * 0.35
                drift *= 0.85
                p = p + Vector((0, 0, sgn * ln / steps)) + side * drift * 0.28
                if alive is not None and not alive(p):
                    break
                pts.append(p + out * (0.05 + 0.03 * rng.random()))
            if len(pts) < 3:
                continue
            with self.as_kind(K_WOOD):
                self.sweep(pts[::3] + [pts[-1]] if len(pts) > 6 else pts[::2] + [pts[-1]], 0.035, 0.012, STEM, sides=3,
                           cap=False)
            for i, q in enumerate(pts):
                t = i / (len(pts) - 1)
                # A cluster hugging the stem: leaves alternate off it, pointing down
                # and out (their weight), thick low and thinner toward the tip.
                for j in range(max(1, mass + int(density * 0.5 * (1.3 - 0.75 * t) + rng.random()))):
                    lp = q + side * (rng.random() - 0.5) * 0.3 * (1.15 - 0.4 * t) + \
                        Vector((0, 0, (rng.random() - 0.5) * 0.26)) + out * (0.03 + rng.random() * 0.07)
                    c = IVY[rng.randrange(len(IVY))] if rng.random() > 0.06 else IVY_TURN[rng.randrange(2)]
                    self.leaf(lp, out + Vector(((rng.random() - 0.5) * 0.45, (rng.random() - 0.5) * 0.45,
                                               0.2 + rng.random() * 0.3)),
                              size * (0.8 + 0.45 * rng.random()) * (1.08 - 0.25 * t), self.vary(c, 0.1),
                              spin=-math.pi / 2 + (1 if j % 2 else -1) * (0.5 + rng.random() * 0.7), droop=0.3)

    def grass(self, pos, radius=0.3, blades=7, height=0.45, dry=0.2):
        """A tuft: one tapering triangle per blade, dark at the root."""
        p0 = Vector(pos)
        rng = self.rng
        for k in range(blades):
            a = TAU * k / blades + rng.uniform(-0.5, 0.5)
            r = radius * rng.uniform(0.05, 0.7)
            base = p0 + Vector((math.cos(a) * r, math.sin(a) * r, -0.05))
            h = height * rng.uniform(0.55, 1.3)
            lean = rng.uniform(0.1, 0.65)
            tip = base + Vector((math.cos(a) * h * lean, math.sin(a) * h * lean, h))
            sd = Vector((-math.sin(a), math.cos(a), 0)) * (0.035 + rng.random() * 0.03)
            c = GRASS_DRY if rng.random() < dry else GRASS[rng.randrange(3)]
            c = self.vary(c, 0.1)
            f = self.bm.faces.new([self.bm.verts.new(q) for q in (base - sd, base + sd, tip)])
            f.material_index = LEAF
            f[self.kindL] = K_LEAF
            ls = f.loops
            ls[0][self.col] = (*scale(c, 0.6), 1.0)
            ls[1][self.col] = (*scale(c, 0.6), 1.0)
            ls[2][self.col] = (*scale(c, 1.15), 1.0)

    def litter(self, center, radius, count, yfn, colors):
        """Fallen leaves: small flat cards lying on yfn(x, y) (Blender XY)."""
        rng = self.rng
        cx, cy = center
        for _ in range(count):
            a = rng.random() * TAU
            r = radius * math.sqrt(rng.random())
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            s = 0.1 + rng.random() * 0.1
            n = Vector(((rng.random() - 0.5) * 0.5, (rng.random() - 0.5) * 0.5, 1.0))
            self.leaf(Vector((x, y, yfn(x, y) + 0.03)), n, s * 1.5, self.vary(colors[rng.randrange(len(colors))], 0.12),
                      spin=rng.random() * TAU, droop=0.0)

    # ------------------------------------------------------------- finish
    def geometry(self, offset=0):
        """(verts, polys) of the solid (non-leaf) faces for the AO occluder."""
        self.bm.verts.index_update()
        verts = [v.co.copy() for v in self.bm.verts]
        polys = [[v.index + offset for v in f.verts] for f in self.bm.faces if f[self.kindL] != K_LEAF]
        return verts, polys

    def finish(self, materials, parent, ground=None, bvh=None, ao_dist=1.7):
        bm = self.bm
        bm.normal_update()
        rays = _hemisphere(9)
        gfn = ground or (lambda x, y: 0.0)
        moss_k, damp_k = self.moss, self.damp
        for face in bm.faces:
            kind = face[self.kindL]
            n = face.normal
            ctr = face.calc_center_median()
            ao_face = None
            if bvh is not None and kind != K_RAW:
                t = n.orthogonal().normalized()
                bt = n.cross(t)
                ao_face = [(t * d[0] + bt * d[1] + n * d[2]) for d in rays]
            up = max(0.0, n.z)
            north = max(0.0, -n.y)
            for loop in face.loops:
                p = loop.vert.co
                r, g, b, _ = loop[self.col]
                c = (r, g, b)
                h = p.z - gfn(p.x, p.y)
                if kind == K_STONE:
                    drift = 0.9 + 0.2 * fbm(p.x * 0.33, p.y * 0.33, p.z * 0.33)
                    streak = 0.92 + 0.12 * fbm(p.x * 2.3 + 7.1, p.y * 2.3 - 3.3, p.z * 0.2)
                    c = scale(c, drift * streak)
                    edge = fbm(p.x * 1.3 + 2.0, p.y * 1.3, 4.0) * 0.9
                    dmp = smooth(2.3 + edge, 0.1, h) * damp_k
                    c = mix(scale(c, 1 - 0.42 * dmp), DAMP, 0.42 * dmp)
                    for (q, wid, ln, st) in self.streaks:
                        dz = q.z - p.z
                        if 0.0 < dz < ln:
                            dxy = math.hypot(p.x - q.x, p.y - q.y)
                            wob = wid * (0.7 + 0.6 * fbm(p.x * 3.0, p.y * 3.0, p.z * 0.6))
                            if dxy < wob:
                                c = mix(c, (0.06, 0.06, 0.065), st * smooth(wob, wob * 0.25, dxy) * (1 - dz / ln) ** 0.7)
                    patch = fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                    low = smooth(4.5, 0.0, h)
                    m = (0.8 * up + 0.55 * north + 0.12 + 0.3 * low) * max(0.0, patch * 2.0 - 0.8 + 0.3 * low) * moss_k
                    m = min(0.8, m * (0.5 + 1.0 * low))
                    if m > 0:
                        c = mix(c, mix(MOSS_DEEP, MOSS_BRIGHT, fbm(p.x * 1.9, p.y * 1.9, p.z * 1.9)), m)
                    li = max(0.0, fbm(p.x * 2.1 + 31.0, p.y * 2.1, p.z * 2.1 + 9.0) * 2.4 - 1.55 + 0.75 * up) * (1 - m)
                    if li > 0:
                        c = mix(c, LICHEN_OCHRE if fbm(p.x * 0.4, p.y * 0.4 + 50, p.z * 0.4) > 0.55 else LICHEN_PALE,
                                min(0.6, li))
                    for (q, rad, s) in self.soot:
                        d = math.hypot(p.x - q.x, p.y - q.y, max(0.0, (p.z - q.z)) * 0.45 + max(0.0, q.z - p.z) * 2.0)
                        if d < rad:
                            c = mix(c, (0.07, 0.065, 0.07), s * smooth(rad, rad * 0.15, d))
                elif kind == K_WOOD:
                    c = scale(c, 0.82 + 0.3 * fbm(p.x * 1.3, p.y * 1.3, p.z * 0.5))
                    c = mix(c, DAMP, 0.25 * smooth(0.9, 0.0, h) + 0.35 * up * max(0.0, fbm(p.x, p.y, p.z) * 2 - 0.9))
                elif kind == K_METAL:
                    v = fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6)
                    c = mix(c, (0.30, 0.50, 0.42), max(0.0, v * 2.2 - 0.8) * 0.75)
                    c = scale(c, 0.8 + 0.3 * fbm(p.x * 0.9 + 4, p.y * 0.9, p.z * 0.9))
                elif kind == K_LEAF:
                    c = scale(c, (0.85 + 0.3 * fbm(p.x * 0.8, p.y * 0.8, p.z * 0.8)))
                elif kind == K_CLOTH:
                    c = scale(c, 0.85 + 0.25 * fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6))
                    c = mix(c, DAMP, 0.3 * smooth(0.8, 0.0, h))
                elif kind == K_EARTH:
                    c = scale(c, 0.85 + 0.3 * fbm(p.x * 1.1, p.y * 1.1, 0.0))
                if ao_face is not None:
                    o = p + (ctr - p) * 0.08 + n * 0.03
                    occ = 0.0
                    for d in ao_face:
                        hit = bvh.ray_cast(o, d, ao_dist)
                        if hit[0] is not None:
                            occ += 1.0 - hit[3] / ao_dist
                    ao = 1.0 - occ / len(ao_face)
                    c = scale(c, 1.0 - (0.42 if kind == K_LEAF else 0.78) * (1.0 - ao) ** 0.85)
                lr, lg, lb = srgb_to_linear((max(0.0, min(1.0, c[0])), max(0.0, min(1.0, c[1])),
                                             max(0.0, min(1.0, c[2]))))
                loop[self.col] = (lr, lg, lb, 1.0)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def _hemisphere(n):
    """n cosine-weighted directions about +Z (a fixed spiral, no random stream)."""
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        a = i * 2.39996323
        r = math.sqrt(u)
        out.append((math.cos(a) * r, math.sin(a) * r, math.sqrt(max(0.0, 1 - u))))
    return out


def occluder(pieces, gr, half=38.0, step=1.0):
    """One BVH over every piece's solid faces plus the sampled terrain."""
    verts, polys = [], []
    for p in pieces:
        v, f = p.geometry(len(verts))
        verts.extend(v)
        polys.extend(f)
    n = int(2 * half / step) + 1
    base = len(verts)
    for j in range(n):
        for i in range(n):
            lx, lz = -half + i * step, -half + j * step
            verts.append(B(lx, lz, gr.h(lx, lz)))
    for j in range(n - 1):
        for i in range(n - 1):
            a = base + j * n + i
            polys.append([a, a + 1, a + n + 1, a + n])
    return BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)


def make_materials():
    stone = ec.vertex_color_material('KitStone', rough=0.9)
    stone.use_backface_culling = True
    leaf = ec.vertex_color_material('KitLeaf', rough=0.8)
    leaf.use_backface_culling = False
    void = ec.emissive_material('KitVoid', (0.0, 0.0, 0.0), strength=0.0)
    return [stone, leaf, void]
