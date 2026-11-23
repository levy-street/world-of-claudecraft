"""Ruin craft for the Sunken Bastion world entrance (build_bastion_entrance.py).

hckit's Piece (the pilot kit's primitives) plus what a drowned gatehouse needs:

- stone(): a hand-hewn ashlar, every corner chipped, its faces pillowed (a
  raised centre vertex) so each block is four facets that catch the light;
- wall(): irregular coursing (every row its own height, every block its own
  length), proud, recessed and slipped blocks, missing blocks over a dark
  rubble core, a stepped broken top, openings cut by callables, a deform hook;
- drum(): the same craft round a vertical axis: a coursed round tower with a
  battered foot, string courses, loops, a ragged truncated crown, a wedge that
  has dropped away along stepped cracks, and a lean applied to the whole;
- arch(): moulded voussoir rings from an intrados polyline, with slipped or
  missing stones;
- marsh growth on a double-sided material: reed and sedge clumps, hanging
  weed, moss mats, barnacle crust;
- finish(): the flood baked into LINEAR vertex colour by HEIGHT: dark wet
  stone, slime and barnacle crust under the tide line, a salt bloom on it,
  pale dry lichen above, rust bleeding from every iron fitting, peat splashed
  up from the ground, and ray-cast ambient occlusion against the whole set
  piece and its terrain.

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
STONE, LEAF, GLOW, WET = 0, 1, 2, 3
# Weathering kinds (per face).
K_STONE, K_WOOD, K_METAL, K_LEAF, K_RAW, K_CLOTH, K_EARTH, K_GLASS, K_WATER, K_CRUST, K_PAVE = range(11)

# Court ashlar (sRGB): cold, heavy, blue-grey; and what the flood left on it.
COURT = (0.39, 0.455, 0.50)
COURT_COOL = (0.32, 0.405, 0.475)
COURT_DARK = (0.255, 0.30, 0.345)
COURT_PALE = (0.50, 0.555, 0.58)
COURT_WARM = (0.42, 0.435, 0.415)
COURT_GREEN = (0.33, 0.42, 0.40)
CORE = (0.12, 0.135, 0.13)
WETC = (0.07, 0.095, 0.095)
SLIME = (0.12, 0.21, 0.11)
SLIME_BRIGHT = (0.27, 0.36, 0.14)
BARNACLE = (0.78, 0.76, 0.66)
BARNACLE_DARK = (0.45, 0.44, 0.38)
SALT = (0.72, 0.75, 0.74)
LICHEN_PALE = (0.64, 0.69, 0.62)
LICHEN_OCHRE = (0.50, 0.50, 0.27)
MOSS_DEEP = (0.15, 0.24, 0.12)
MOSS_BRIGHT = (0.31, 0.40, 0.17)
RUST = (0.40, 0.19, 0.09)
RUST_BRIGHT = (0.60, 0.31, 0.11)
IRON = (0.12, 0.115, 0.115)
PEAT = (0.15, 0.145, 0.115)
SILT = (0.30, 0.315, 0.28)
TURF = (0.21, 0.25, 0.14)
MUD = (0.20, 0.195, 0.155)
MUD_WET = (0.075, 0.07, 0.058)
TIMBER = (0.33, 0.30, 0.26)
TIMBER_GREY = (0.45, 0.44, 0.41)
TIMBER_DARK = (0.17, 0.145, 0.12)
REED = ((0.36, 0.40, 0.19), (0.44, 0.45, 0.22), (0.29, 0.34, 0.16), (0.52, 0.48, 0.27))
REED_DRY = (0.60, 0.53, 0.33)
SEDGE = ((0.22, 0.33, 0.15), (0.28, 0.38, 0.17), (0.18, 0.27, 0.13))
WEED = ((0.10, 0.17, 0.08), (0.14, 0.22, 0.09), (0.19, 0.24, 0.10), (0.24, 0.21, 0.09))
STEM = (0.16, 0.14, 0.09)
KELP = ((0.20, 0.25, 0.10), (0.27, 0.29, 0.12), (0.16, 0.22, 0.11), (0.30, 0.26, 0.11))


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


def arch_points(half, rise, steps=6):
    """Intrados of a round (or segmental) arch springing at (+-half, 0) with
    its apex at (0, rise), left to right."""
    return [(-math.cos(math.pi * i / (2 * steps)) * half, math.sin(math.pi * i / (2 * steps)) * rise)
            for i in range(2 * steps + 1)]


def arch_hole(half, spring, rise, cx=0.0):
    """hole(x, y) for a round-arched opening (x across the wall, y up)."""
    def hole(x, y):
        dx = abs(x - cx)
        if dx >= half:
            return False
        if y <= spring:
            return True
        k = (y - spring) / rise
        return k < 1 and dx < half * math.sqrt(max(0.0, 1 - k * k))
    return hole


class Ruin(hckit.Piece):
    def __init__(self, name, seed=0, tide=None, moss=1.0):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.kindL = self.bm.faces.layers.int.new('kind')
        self.stamp = 0
        self.rng = random.Random(zlib.crc32(name.encode()) * 131 + seed)
        self.kind = K_STONE
        self.tide = tide
        self.moss = moss
        self.soot = []       # (point, radius, strength): dark holes, drip stains
        self.streaks = []    # (point, width, length, strength): rust bleeding down
        self.collect = None
        self.weather = 1.0
        self.lichen = 0.0

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

    def tone(self, u=0.0, y=0.0):
        """One block's colour: the wall's drifting base plus the odd cool,
        dark, pale, warm or green-tinged block."""
        r = self.rng.random()
        drift = fbm(u * 0.21 + 3.1, y * 0.27 - 1.7, 0.5)
        base = mix(COURT, COURT_COOL, max(0.0, drift * 1.6 - 0.5))
        odd = None
        if r < 0.10:
            odd = COURT_COOL
        elif r < 0.22:
            odd = COURT_DARK
        elif r < 0.30:
            odd = COURT_PALE
        elif r < 0.35:
            odd = COURT_WARM
        elif r < 0.41:
            odd = COURT_GREEN
        if odd is not None:
            base = mix(base, odd, 0.5)
        return self.vary(base, 0.035)

    def quad(self, pts, color, mat=STONE, cols=None, want=None):
        """A face from points (Blender space), wound as given, or flipped to
        face `want` when a direction is passed."""
        f = self.bm.faces.new([self.bm.verts.new(Vector(p)) for p in pts])
        if want is not None:
            f.normal_update()
            if f.normal.dot(Vector(want)) < 0:
                f.normal_flip()
        f.material_index = mat
        f[self.kindL] = self.kind
        for i, loop in enumerate(f.loops):
            c = cols[i] if cols is not None else color
            loop[self.col] = (c[0], c[1], c[2], 1.0)
        if self.collect is not None:
            self.collect.extend(f.verts)
        return f

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

    def core(self, center, size, color):
        """The dark rubble core behind a run of blocks: its two faces and its
        top only (the ends and the bed are never seen)."""
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        vs = [self.bm.verts.new(Vector((cx + i * hx, cy + j * hy, cz + k * hz)))
              for (i, j, k) in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1),
                                (-1, 1, 1))]
        if self.collect is not None:
            self.collect.extend(vs)
        for quad in ((0, 1, 5, 4), (2, 3, 7, 6), (4, 5, 6, 7)):
            f = self.bm.faces.new([vs[i] for i in quad])
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
        """A rough hewn walling block. Local frame: X along the wall, Y through
        it (the pillowed faces), Z up."""
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
        edge = scale(color, 0.84 + 0.06 * rng.random())
        face = scale(color, 1.06)
        foot = scale(edge, 0.76)
        chipped = rng.randrange(8) if rng.random() < 0.4 else -1
        for (quad, mid) in (((0, 1, 5, 4), 8), ((2, 3, 7, 6), 9)):
            for k in range(4):
                i0, i1 = quad[k], quad[(k + 1) % 4]
                f = self.bm.faces.new((vs[i0], vs[i1], vs[mid]))
                f.material_index = STONE
                f[self.kindL] = self.kind
                ls = f.loops
                for (loop, i) in ((ls[0], i0), (ls[1], i1)):
                    c = scale(color, 1.3) if i == chipped else (foot if i < 4 else edge)
                    loop[self.col] = (*c, 1.0)
                ls[2][self.col] = (*face, 1.0)
        top = scale(color, 0.9)
        joint = scale(color, 0.4)
        quads = ([((1, 2, 6, 5), joint), ((3, 0, 4, 7), joint)] if ends else []) + [((4, 5, 6, 7), top)] + \
            ([((3, 2, 1, 0), joint)] if bottom else [])
        for (quad, c) in quads:
            f = self.bm.faces.new([vs[i] for i in quad])
            f.material_index = STONE
            f[self.kindL] = self.kind
            for loop in f.loops:
                loop[self.col] = (*c, 1.0)

    # --------------------------------------------------------------- walls
    def wall(self, a, b, depth, y0, top_fn, holes=(), course=(0.40, 0.66), unit=(1.2, 2.8), deform=None,
             missing=0.03, proud=0.05, chip=0.06, pillow=0.006, core=CORE, ragged=0.2, tone=None, slip=0.03,
             ground=None):
        """Coursed ashlar from a to b (local game (lx, lz)), bottom y0, top
        top_fn(t), t in [0, 1] from a. holes: callables (u, y) -> open.
        deform(u, n, y) -> (du, dn, dy) bends the finished run (a lean, a sag).
        Returns the top blocks as Blender-space (centre, width) pairs."""
        ax, az = a
        bx, bz = b
        L = math.hypot(bx - ax, bz - az)
        M = Matrix.Translation(B(ax, az, 0)) @ Matrix.Rotation(math.atan2(-(bz - az), bx - ax), 4, 'Z')
        rng = self.rng
        tone = tone or self.tone
        prev, self.collect = self.collect, []
        tmax = max(top_fn(k / 60) for k in range(61))
        tops = []
        y, row = y0, 0

        def buried(u, yy):
            # under the ground on both faces: never seen, never built
            if ground is None:
                return False
            a_ = M @ Vector((u, -depth / 2 - 0.05, yy))
            b_ = M @ Vector((u, depth / 2 + 0.05, yy))
            return yy < min(ground(a_.x, a_.y), ground(b_.x, b_.y)) - 0.12

        while y < tmax - 0.1 and row < 200:
            h = rng.uniform(*course) * (1.3 if row == 0 else 1.0)
            u = -rng.uniform(0.15, 0.9) * h
            runs_row = []
            cuts = [0.0]
            while True:
                u += h * rng.uniform(*unit)
                if u >= L - 0.28:
                    break
                if u > 0.28:
                    cuts.append(u)
            cuts.append(L)
            for (u0, u1) in zip(cuts, cuts[1:]):
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
                        if buried(r0, y + hh) and buried(r1, y + hh):
                            continue
                        runs_row.append((r0, r1, hh))
                        is_top = top - (y + hh) < 0.2
                        if row > 1 and not is_top and rng.random() < missing * 0.35:
                            continue
                        bh = hh - 0.02
                        if is_top:
                            bh *= 1 - rng.random() * ragged
                        off = (rng.random() - 0.5) * 2 * proud
                        tilt = 0.02
                        if row > 2 and rng.random() < slip:
                            # A slipped block: pushed out of the face and settled askew.
                            off += rng.choice((-1, 1)) * rng.uniform(0.07, 0.16)
                            tilt = 0.09
                        rot = Matrix.Rotation((rng.random() - 0.5) * (0.03 + tilt), 3, 'Z') @ \
                            Matrix.Rotation((rng.random() - 0.5) * (0.07 if is_top else tilt), 3, 'Y')
                        self.stone((((r0 + r1) / 2), off, y + bh / 2), (r1 - r0 - 0.024, depth * (0.96 + rng.random() * 0.1),
                                                                         bh), tone((r0 + r1) / 2 + ax * 0.7, y), rot=rot,
                                   chip=chip, pillow=pillow, knock=0.3 if is_top else 0.04, bottom=is_top,
                                   ends=is_top or r0 - u0 > 1e-6 or u1 - r1 > 1e-6 or u0 <= 1e-6 or u1 >= L - 1e-6)
                        if is_top:
                            tops.append((Vector(((r0 + r1) / 2, 0, y + bh)), r1 - r0))
            merged = []
            for (r0, r1, hh) in runs_row:
                if merged and r0 - merged[-1][1] < 0.02 and abs(merged[-1][2] - hh) < 1e-6:
                    merged[-1][1] = r1
                else:
                    merged.append([r0, r1, hh])
            with self.as_kind(K_RAW):
                for (r0, r1, hh) in merged:
                    self.core(((r0 + r1) / 2, 0, y + hh / 2 - 0.02), (r1 - r0, depth * 0.8, hh), core)
            y += h
            row += 1
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

    def drum(self, radius_fn, y0, top_fn, M=None, course=(0.40, 0.62), unit=(1.3, 2.5), depth=0.42, rim=0.95,
             holes=(), bands=(), missing=0.025, proud=0.04, chip=0.06, shift=None, tone=None, ragged=0.18,
             slip=0.02, core=CORE, core_sides=20, arc=None, inner=False, ground=None, lining=None):
        """Coursed ashlar round the local Z axis: blocks of the round tower.
        radius_fn(y) -> the face radius (a battered foot); top_fn(theta) -> the
        ragged crown; holes: callables (theta, y) -> open; bands: [(y, h, out,
        colour)] string courses standing `out` proud; shift(theta, y) -> (dr,
        dy, dth) for a wedge that has dropped away. M (the lean) is applied to
        everything last. Returns the crown blocks as (point, width) pairs."""
        rng = self.rng
        tone = tone or self.tone
        prev, self.collect = self.collect, []
        tmax = max(top_fn(TAU * k / 96) for k in range(96))
        tmin = min(top_fn(TAU * k / 96) for k in range(96))
        a0, a1 = arc if arc is not None else (0.0, TAU)
        rows = []
        y = y0
        pending = sorted(bands)
        while y < tmax - 0.1 and len(rows) < 240:
            h = rng.uniform(*course) * (1.25 if not rows else 1.0)
            band = None
            if pending and y + h > pending[0][0] - 0.12:
                if pending[0][0] - y > 0.22:
                    h = pending[0][0] - y
                else:
                    band = pending.pop(0)
                    h = band[1]
            rows.append((y, h, band))
            y += h
        tops = []
        for (y, h, band) in rows:
            r = radius_fn(y + h / 2) + (band[2] if band else 0.0)
            th = a0 - rng.uniform(0.1, 0.9) * h / r
            cuts = [a0]
            while True:
                th += min(0.40, h * rng.uniform(*unit) * (1.5 if band else 1.0) / r)
                if th >= a1 - 0.28 / r:
                    break
                if th > a0 + 0.28 / r:
                    cuts.append(th)
            cuts.append(a1)
            for (t0, t1) in zip(cuts, cuts[1:]):
                top = min(top_fn(t0), top_fn((t0 + t1) / 2), top_fn(t1))
                hh = min(h, top - y)
                if hh < 0.2:
                    continue
                n = max(2, int((t1 - t0) * r / 0.12))
                start = None
                for k in range(n + 1):
                    tt = t0 + (t1 - t0) * k / n
                    solid = not any(hole(tt, y + hh * 0.25) or hole(tt, y + hh * 0.75) for hole in holes)
                    if solid and start is None:
                        start = tt
                    if (not solid or k == n) and start is not None:
                        s0, s1, start = start, tt, None
                        if (s1 - s0) * r < 0.2:
                            continue
                        is_top = top - (y + hh) < 0.2
                        if ground is not None:
                            g_ = Vector((math.cos((s0 + s1) / 2) * (r + 0.1), math.sin((s0 + s1) / 2) * (r + 0.1), y + hh))
                            if M is not None:
                                g_ = M @ g_
                            if g_.z < ground(g_.x, g_.y) - 0.15:
                                continue
                        if not band and not is_top and y > y0 + 1.0 and rng.random() < missing * 0.35:
                            continue
                        bh = hh - 0.02
                        if is_top:
                            bh *= 1 - rng.random() * ragged
                        mid = (s0 + s1) / 2
                        dr, dy, dt = shift(mid, y) if shift else (0.0, 0.0, 0.0)
                        off = (rng.random() - 0.5) * 2 * proud + dr
                        if not band and y > y0 + 1.0 and rng.random() < slip:
                            off += rng.uniform(0.07, 0.15)
                            dy -= rng.uniform(0.0, 0.03)
                        gap = 0.012 / r
                        col = tone(mid * r, y) if not band else self.vary(band[3], 0.05)
                        dd = rim if (is_top or tmin - y < 1.2) else depth
                        crown = is_top or tmin - y < 1.2
                        self._drum_block(s0 + gap + dt, s1 - gap + dt, r + off, dd, y + dy, bh, col, chip,
                                         knock=0.3 if is_top else 0.03, inner=inner or crown, bottom=crown)
                        if is_top:
                            tops.append((Vector((math.cos(mid + dt) * (r + off - dd / 2), math.sin(mid + dt) * (r + off - dd / 2),
                                                 y + dy + bh)), (s1 - s0) * r))
        # The dark core behind the blocks: a turned shell that follows the
        # ragged crown angle by angle, and (lining) the dark inside of the
        # hollow top, so no gap between blocks ever shows the sky.
        with self.as_kind(K_RAW):
            ys = [y0] + [yy + hh for (yy, hh, _b) in rows]
            low = [v for v in ys if v < tmin - 0.3]
            ys = low[::3] + ([low[-1]] if low and (len(low) - 1) % 3 else []) + [v for v in ys if v >= tmin - 0.3]
            crown = [min(top_fn(TAU * (i + j / 4) / core_sides) for j in range(-4, 5)) - 0.34 for i in range(core_sides)]
            shells = [(-depth * 0.55, False)]
            if lining is not None:
                shells.append((-lining, True))
            for (dr_, inward) in shells:
                rings = []
                for yy in ys:
                    if inward and yy < tmin - 1.2:
                        continue
                    rr = radius_fn(yy) + dr_
                    rings.append([self.bm.verts.new(Vector((math.cos(TAU * i / core_sides) * rr,
                                                           math.sin(TAU * i / core_sides) * rr, min(yy, crown[i]))))
                                  for i in range(core_sides)])
                for ra, rb in zip(rings, rings[1:]):
                    for i in range(core_sides):
                        j = (i + 1) % core_sides
                        if rb[i].co.z - ra[i].co.z < 1e-4 and rb[j].co.z - ra[j].co.z < 1e-4:
                            continue
                        quad = (ra[j], ra[i], rb[i], rb[j]) if inward else (ra[i], ra[j], rb[j], rb[i])
                        f = self.bm.faces.new(quad)
                        f.material_index = STONE
                        f[self.kindL] = K_RAW
                        cc = scale(core, 2.2) if inward else core
                        for loop in f.loops:
                            loop[self.col] = (cc[0], cc[1], cc[2], 1.0)
                for ring in rings:
                    self.collect.extend(ring)
        out = []
        if M is not None:
            for v in self.collect:
                v.co = M @ v.co
            for (p, w) in tops:
                out.append((M @ p, w))
        else:
            out = tops
        self.collect = prev
        return out

    def _drum_block(self, t0, t1, r, depth, y, h, color, chip, knock=0.0, inner=False, bottom=False):
        """One block of a round wall: its face is BENT about its middle so it
        follows the drum (a long flat chord shows at the tower's edge as a
        scale standing off it), dark toward its joints, paler in the middle."""
        rng = self.rng
        q = chip * min(h, (t1 - t0) * r)
        tm = (t0 + t1) / 2
        vs = {}
        for yi in (0, 1):
            for ri in (0, 1):
                for ti in (0, 1, 2):
                    end = ti != 1
                    th = (t0, tm, t1)[ti] + ((1 if ti == 0 else -1) * q * rng.random() ** 2 / r if end else 0.0)
                    rad = (r - depth, r)[ri] - (q * 0.5 * rng.random() ** 2 if ri and end else 0.0)
                    yy = (y, y + h)[yi] + (1 if yi == 0 else -1) * q * rng.random() ** 2 * (1.0 if end else 0.4)
                    vs[(ti, ri, yi)] = Vector((math.cos(th) * rad, math.sin(th) * rad, yy))
        if rng.random() < knock:
            key = (rng.choice((0, 2)), 1, 1)
            ctr = sum(vs.values(), Vector()) / 12
            vs[key] = ctr + (vs[key] - ctr) * (0.6 + 0.2 * rng.random())
        bv = {key: self.bm.verts.new(p) for key, p in vs.items()}
        self.collect.extend(bv.values())
        edge = scale(color, 0.82 + 0.06 * rng.random())
        face = scale(color, 1.07)
        side = scale(color, 0.92)

        def poly(keys, cols):
            f = self.bm.faces.new([bv[key] for key in keys])
            f.material_index = STONE
            f[self.kindL] = self.kind
            for loop, c in zip(f.loops, cols):
                loop[self.col] = (*c, 1.0)

        foot, low = scale(edge, 0.76), scale(face, 0.86)
        chip_a = scale(color, 1.3) if rng.random() < 0.2 else edge
        chip_b = scale(color, 1.3) if rng.random() < 0.2 else edge
        joint = scale(color, 0.4)
        poly(((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)), (foot, low, face, chip_a))
        poly(((1, 1, 0), (2, 1, 0), (2, 1, 1), (1, 1, 1)), (low, foot, chip_b, face))
        poly(((0, 1, 1), (1, 1, 1), (2, 1, 1), (2, 0, 1), (1, 0, 1), (0, 0, 1)), (side,) * 6)
        poly(((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)), (joint,) * 4)
        poly(((2, 1, 0), (2, 0, 0), (2, 0, 1), (2, 1, 1)), (joint,) * 4)
        if bottom:
            poly(((0, 0, 0), (1, 0, 0), (2, 0, 0), (2, 1, 0), (1, 1, 0), (0, 1, 0)), (scale(color, 0.7),) * 6)
        if inner:
            poly(((2, 0, 0), (1, 0, 0), (0, 0, 0), (0, 0, 1), (1, 0, 1), (2, 0, 1)), (side,) * 6)

    def arch(self, pts, thick, depth, color, M, bevel=0.05, chip=0.05, skip=(), y_off=0.0, tone=0.08,
             depth_jit=0.05, center=None, drop=None):
        """A ring of voussoirs over an intrados polyline pts [(x, z)] in the
        wall plane (X across, Z up; Y through the wall, centred on y_off).
        drop: {index: (dx, dz, roll)} slips one stone out of the ring."""
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
            ddx, ddz, droll = (drop or {}).get(i, (0.0, 0.0, 0.0))
            R = Matrix.Rotation(droll, 4, 'Y')
            vs = []
            for yy in (-d / 2, d / 2):
                for (x, z) in quad:
                    q = Vector(((x - mx) * 0.97, yy, (z - mz) * 0.97))
                    q -= q * (chip * self.rng.random() ** 2)
                    q = R @ q + Vector((mx + ddx, y_off, mz + ddz))
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

    def mound(self, lx, lz, rx, rz, h, gfn, color, yaw=0.0, rings=2, segs=9, sink=0.22, kind=K_EARTH, jitter=0.2,
              flat=0.0):
        """A heap of peat lying on the ground: a low dome whose skirt dips
        under the terrain so its edge is never a clean line. gfn(lx, lz) is
        the terrain; `flat` in [0, 1) levels the crown (a puddle's bed)."""
        rng = self.rng
        cs, sn = math.cos(yaw), math.sin(yaw)

        def at(u, v, k):
            x, z = lx + u * rx * cs - v * rz * sn, lz + u * rx * sn + v * rz * cs
            rise = max(0.0, 1 - k * k) ** 1.4
            if flat > 0:
                rise = min(rise, 1 - flat) / (1 - flat)
            return B(x, z, gfn(x, z) + h * rise - sink * k ** 3)

        ring_v = [[self.bm.verts.new(at(0, 0, 0))]]
        for j in range(1, rings + 1):
            k = j / rings
            n = segs * j
            ring = []
            for i in range(n):
                a = TAU * i / n + (rng.random() - 0.5) * jitter
                kk = k * (1 + (rng.random() - 0.5) * jitter * (1.3 if j == rings else 0.6))
                ring.append(self.bm.verts.new(at(math.cos(a) * kk, math.sin(a) * kk, min(1.25, kk))))
            ring_v.append(ring)
        faces = []
        first = ring_v[1]
        for i in range(len(first)):
            faces.append(self.bm.faces.new((ring_v[0][0], first[i], first[(i + 1) % len(first)])))
        for j in range(1, rings):
            a, b = ring_v[j], ring_v[j + 1]
            na, nb = len(a), len(b)
            ia = ib = 0
            while ia < na or ib < nb:
                if ib * na <= ia * nb and ib < nb:
                    faces.append(self.bm.faces.new((a[ia % na], b[ib % nb], b[(ib + 1) % nb])))
                    ib += 1
                else:
                    faces.append(self.bm.faces.new((a[ia % na], b[ib % nb], a[(ia + 1) % na])))
                    ia += 1
        with self.as_kind(kind):
            for f in faces:
                f.smooth = True
                self._paint([f], self.vary(color, 0.08), STONE)
        if self.collect is not None:
            for ring in ring_v:
                self.collect.extend(ring)
        return faces

    # ------------------------------------------------------------- growth
    def blade(self, base, tip, width, color, bend=None, segs=2, tip_col=None, twist=0.0):
        """One reed or sedge blade: a tapering strip from base to tip that
        bows toward `bend`, dark at the root."""
        base, tip = Vector(base), Vector(tip)
        axis = tip - base
        side = axis.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        if twist:
            side = Matrix.Rotation(twist, 3, axis.normalized()) @ side
        bend = Vector(bend) if bend is not None else Vector()
        prev = None
        tc = tip_col or scale(color, 1.2)
        for i in range(segs + 1):
            t = i / segs
            p = base + axis * t + bend * (t * t)
            w = width * (1 - 0.82 * t)
            c = mix(scale(color, 0.5), tc, t)
            cur = (p - side * w, p + side * w, c)
            if prev is not None:
                if i == segs:
                    f = self.bm.faces.new([self.bm.verts.new(q) for q in (prev[0], prev[1], p)])
                    cols = (prev[2], prev[2], c)
                else:
                    f = self.bm.faces.new([self.bm.verts.new(q) for q in (prev[0], prev[1], cur[1], cur[0])])
                    cols = (prev[2], prev[2], c, c)
                f.material_index = LEAF
                f[self.kindL] = K_LEAF
                for loop, cc in zip(f.loops, cols):
                    loop[self.col] = (*cc, 1.0)
            prev = cur

    def sedge(self, pos, radius=0.24, blades=9, height=0.6, dry=0.15):
        """A sedge tussock: narrow arching blades from one crown."""
        rng = self.rng
        p0 = Vector(pos)
        for k in range(blades):
            a = TAU * k / blades + rng.uniform(-0.4, 0.4)
            r = radius * rng.uniform(0.0, 0.5)
            base = p0 + Vector((math.cos(a) * r, math.sin(a) * r, -0.06))
            h = height * rng.uniform(0.55, 1.25)
            out = rng.uniform(0.2, 0.7)
            tip = base + Vector((math.cos(a) * h * out * 0.5, math.sin(a) * h * out * 0.5, h))
            bend = Vector((math.cos(a) * h * out * 0.7, math.sin(a) * h * out * 0.7, -h * out * 0.45))
            c = REED_DRY if rng.random() < dry else SEDGE[rng.randrange(len(SEDGE))]
            self.blade(base, tip, 0.02 + rng.random() * 0.012, self.vary(c, 0.12), bend=bend, segs=2,
                       twist=rng.uniform(-0.6, 0.6))

    def reeds(self, pos, radius=0.4, stems=7, height=1.6, heads=0.5, dry=0.2):
        """A stand of marsh reed: thin upright stems, each with a couple of
        short narrow leaves held close to it and, on some, a dark seed head."""
        rng = self.rng
        p0 = Vector(pos)
        for k in range(stems):
            a = rng.random() * TAU
            r = radius * math.sqrt(rng.random())
            base = p0 + Vector((math.cos(a) * r, math.sin(a) * r, -0.08))
            h = height * rng.uniform(0.6, 1.15)
            lean = Vector(((rng.random() - 0.5) * 0.22, (rng.random() - 0.5) * 0.22, 0)) * h
            c = REED_DRY if rng.random() < dry else REED[rng.randrange(len(REED))]
            c = self.vary(c, 0.1)
            top = base + Vector((0, 0, h)) + lean
            tw = rng.random() * 3
            self.blade(base, top, 0.016, scale(c, 0.85), bend=lean * 0.25, segs=2, twist=tw)
            self.blade(base, top, 0.016, scale(c, 0.85), bend=lean * 0.25, segs=2, twist=tw + 1.57)
            for j in range(rng.randrange(1, 3)):
                t = 0.3 + 0.25 * j + rng.random() * 0.1
                q = base + (top - base) * t
                la = rng.random() * TAU
                ln = h * rng.uniform(0.16, 0.26)
                d = Vector((math.cos(la), math.sin(la), 0))
                self.blade(q, q + d * ln * 0.3 + Vector((0, 0, ln * 0.95)), 0.02, c,
                           bend=d * ln * 0.3 - Vector((0, 0, ln * 0.2)), segs=2)
            if rng.random() < heads:
                hh = 0.2 + rng.random() * 0.1
                for k3 in range(3):
                    a0, a1 = TAU * k3 / 3, TAU * (k3 + 1) / 3
                    q = [top + Vector((math.cos(a0) * 0.03, math.sin(a0) * 0.03, -0.02)),
                         top + Vector((math.cos(a1) * 0.03, math.sin(a1) * 0.03, -0.02)),
                         top + Vector((math.cos(a1) * 0.012, math.sin(a1) * 0.012, hh)),
                         top + Vector((math.cos(a0) * 0.012, math.sin(a0) * 0.012, hh))]
                    f = self.bm.faces.new([self.bm.verts.new(v) for v in q])
                    f.material_index = LEAF
                    f[self.kindL] = K_LEAF
                    for loop in f.loops:
                        loop[self.col] = (0.17, 0.11, 0.07, 1.0)

    def weed(self, top, length, out, width=0.5, strands=4, leaf=0.15, density=1.0):
        """Hanging weed: a curtain of small drooping leaf cards that follow
        thin strands down a face whose outward normal is `out`, thick at the
        top and thinning to a few trailing tips."""
        rng = self.rng
        top = Vector(top)
        out = Vector(out).normalized()
        side = Vector((0, 0, 1)).cross(out)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        for s in range(strands):
            a = top + side * (rng.random() - 0.5) * width + out * 0.03
            ln = length * (0.35 + 0.65 * rng.random())
            steps = max(2, int(ln / 0.2))
            b = a + Vector((0, 0, -ln)) + side * (rng.random() - 0.5) * 0.3 * ln + out * 0.012 * steps
            c = self.vary(WEED[rng.randrange(len(WEED))], 0.12)
            w = 0.007
            f = self.bm.faces.new([self.bm.verts.new(q) for q in (a - side * w, a + side * w, b + side * w, b - side * w)])
            f.material_index = LEAF
            f[self.kindL] = K_LEAF
            for loop in f.loops:
                loop[self.col] = (*scale(c, 0.5), 1.0)
            for i in range(steps):
                t = (i + rng.random()) / steps
                q = a + (b - a) * t
                for j in range(max(1, int(density * (3.0 - 1.6 * t) + rng.random()))):
                    sgn = 1 if (i + j) % 2 else -1
                    d = (side * sgn * (0.12 + rng.random() * 0.4) + Vector((0, 0, -1.0)) + out * (0.1 + rng.random() * 0.25)).normalized()
                    lp = q + side * sgn * rng.random() * 0.06 + Vector((0, 0, (rng.random() - 0.5) * 0.16))
                    sz = leaf * (1.3 + 0.9 * rng.random()) * (1.1 - 0.3 * t)
                    wv = d.cross(out).normalized() * leaf * (0.2 + 0.12 * rng.random())
                    pts4 = (lp, lp + d * sz * 0.3 + wv + out * 0.025, lp + d * sz, lp + d * sz * 0.3 - wv + out * 0.025)
                    f = self.bm.faces.new([self.bm.verts.new(v) for v in pts4])
                    f.material_index = LEAF
                    f[self.kindL] = K_LEAF
                    cc = self.vary(WEED[rng.randrange(len(WEED))], 0.14)
                    for k4, loop in enumerate(f.loops):
                        loop[self.col] = (*scale(cc, 0.62 if k4 == 0 else (1.2 if k4 == 2 else 0.95)), 1.0)

    def kelp(self, top, length, out, width=0.6, blades=7, blade=0.11):
        """A curtain of kelp: long limp ribbons hanging from `top` down a face
        whose outward normal is `out`, twisting a little, narrowing to a tip."""
        rng = self.rng
        top = Vector(top)
        out = Vector(out).normalized()
        side = Vector((0, 0, 1)).cross(out)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        for b in range(blades):
            a = top + side * (rng.random() - 0.5) * width + out * (0.03 + rng.random() * 0.06) + Vector((0, 0, rng.random() * 0.12))
            ln = length * (0.45 + 0.55 * rng.random())
            sway = (rng.random() - 0.5) * 0.3
            w0 = blade * (0.7 + 0.6 * rng.random())
            tw = rng.uniform(-1.2, 1.2)
            c = self.vary(KELP[rng.randrange(len(KELP))], 0.14)
            prev = None
            for i in range(4):
                t = i / 3
                p = a + Vector((0, 0, -ln * t)) + side * sway * ln * t * t + out * (0.05 * math.sin(t * 3.0 + b))
                d = side * math.cos(tw * t) + out * math.sin(tw * t)
                w = w0 * (1 - 0.6 * t * t)
                cur = (p - d * w, p + d * w, scale(c, 0.78 + 0.45 * t))
                if prev is not None:
                    pts = (prev[0], prev[1], p) if i == 3 else (prev[0], prev[1], cur[1], cur[0])
                    cols = (prev[2], prev[2], cur[2]) if i == 3 else (prev[2], prev[2], cur[2], cur[2])
                    f = self.bm.faces.new([self.bm.verts.new(q) for q in pts])
                    f.material_index = LEAF
                    f[self.kindL] = K_LEAF
                    for loop, cc in zip(f.loops, cols):
                        loop[self.col] = (*cc, 1.0)
                prev = cur

    def moss_mat(self, pos, radius, color=None, normal=(0, 0, 1), height=0.07, lobes=5):
        """A moss mat: a low many-lobed cushion lying on a surface."""
        rng = self.rng
        n = Vector(normal).normalized()
        t = n.orthogonal().normalized()
        u = n.cross(t)
        p0 = Vector(pos)
        c0 = color or mix(MOSS_DEEP, MOSS_BRIGHT, rng.random())
        for _ in range(lobes):
            a = rng.random() * TAU
            r = radius * 0.55 * math.sqrt(rng.random())
            c = p0 + (t * math.cos(a) + u * math.sin(a)) * r
            rr = radius * rng.uniform(0.3, 0.55)
            hh = height * rng.uniform(0.6, 1.3)
            ring = []
            k = 6
            ph = rng.random() * TAU
            for i in range(k):
                aa = ph + TAU * i / k
                ring.append(c + (t * math.cos(aa) + u * math.sin(aa)) * rr * rng.uniform(0.8, 1.15) - n * 0.015)
            top = c + n * hh
            col = self.vary(c0, 0.14)
            for i in range(k):
                f = self.bm.faces.new([self.bm.verts.new(q) for q in (ring[i], ring[(i + 1) % k], top)])
                f.material_index = LEAF
                f[self.kindL] = K_LEAF
                ls = f.loops
                ls[0][self.col] = (*scale(col, 0.62), 1.0)
                ls[1][self.col] = (*scale(col, 0.62), 1.0)
                ls[2][self.col] = (*scale(col, 1.2), 1.0)

    def barnacles(self, pos, out, radius=0.3, count=7):
        """A crust of barnacles: a cluster of small pale truncated cones
        standing off a face (outward normal `out`)."""
        rng = self.rng
        n = Vector(out).normalized()
        t = n.orthogonal().normalized()
        u = n.cross(t)
        p0 = Vector(pos)
        with self.as_kind(K_CRUST):
            for _ in range(count):
                a = rng.random() * TAU
                r = radius * math.sqrt(rng.random())
                c = p0 + (t * math.cos(a) + u * math.sin(a)) * r
                rr = rng.uniform(0.028, 0.095)
                hh = rr * rng.uniform(0.6, 1.3)
                col = self.vary(mix(BARNACLE_DARK, BARNACLE, rng.random()), 0.1)
                k = 5
                ph = rng.random() * TAU
                sq = rng.uniform(0.7, 1.0)
                lo = [c + (t * math.cos(ph + TAU * i / k) + u * math.sin(ph + TAU * i / k) * sq) * rr * rng.uniform(0.85, 1.15)
                      - n * 0.02 for i in range(k)]
                hi = [c + (t * math.cos(ph + TAU * i / k) + u * math.sin(ph + TAU * i / k) * sq) * rr * 0.5 + n * hh for i in range(k)]
                vl = [self.bm.verts.new(q) for q in lo]
                vh = [self.bm.verts.new(q) for q in hi]
                faces = [self.bm.faces.new((vl[i], vl[(i + 1) % k], vh[(i + 1) % k], vh[i])) for i in range(k)]
                faces.append(self.bm.faces.new(vh))
                self._paint(faces[:-1], col, STONE)
                self._paint(faces[-1:], scale(col, 0.55), STONE)

    # ------------------------------------------------------------- finish
    def geometry(self, offset=0):
        """(verts, polys) of the solid (non-leaf) faces for the AO occluder."""
        self.bm.verts.index_update()
        verts = [v.co.copy() for v in self.bm.verts]
        polys = [[v.index + offset for v in f.verts] for f in self.bm.faces if f[self.kindL] != K_LEAF]
        return verts, polys

    def finish(self, materials, parent, ground=None, bvh=None, ao_dist=1.8):
        bm = self.bm
        bm.normal_update()
        rays = _hemisphere(9)
        gfn = ground or (lambda x, y: 0.0)
        tide0 = self.tide
        for face in bm.faces:
            kind = face[self.kindL]
            n = face.normal
            ctr = face.calc_center_median()
            ao_face = None
            if bvh is not None and kind not in (K_RAW, K_WATER, K_GLASS):
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
                d = 9.0
                if tide0 is not None:
                    d = p.z - (tide0 + 0.34 * (fbm(p.x * 0.45 + 3.0, p.y * 0.45 - 7.0, 0.3) - 0.5)
                               + 0.14 * (fbm(p.x * 2.1, p.y * 2.1, 1.7) - 0.5))
                wet = smooth(0.18, -0.55, d)
                deep = smooth(-2.2, -4.6, d)
                if kind in (K_STONE, K_CRUST):
                    if kind == K_STONE:
                        drift = 0.88 + 0.24 * fbm(p.x * 0.33, p.y * 0.33, p.z * 0.33)
                        streak = 0.90 + 0.16 * fbm(p.x * 2.3 + 7.1, p.y * 2.3 - 3.3, p.z * 0.2)
                        c = scale(c, drift * streak)
                    # Under the line: dark wet stone, slime, the barnacle crust at the line.
                    c = mix(c, mix(scale(c, 0.52), WETC, 0.36), wet * (0.55 if kind == K_CRUST else 1.0) * (1 - 0.4 * deep))
                    if deep > 0 and kind == K_STONE:
                        c = mix(c, scale(SILT, 0.8 + 0.4 * fbm(p.x * 1.1, p.y * 1.1, p.z * 0.4)),
                                deep * (0.1 + 0.3 * fbm(p.x * 0.6 + 4.0, p.y * 0.6, p.z * 1.4)))
                    if kind == K_STONE:
                        sl = wet * (1 - 0.5 * deep) * max(0.0, fbm(p.x * 0.9 + 5.0, p.y * 0.9, p.z * 0.6 + 2.0) * 2.3 - 0.5) * \
                            (0.6 + 0.5 * north + 0.6 * up)
                        if sl > 0:
                            c = mix(c, mix(SLIME, SLIME_BRIGHT, fbm(p.x * 2.3, p.y * 2.3, p.z * 2.3) * smooth(-2.5, -0.2, d)),
                                    min(0.86, sl))
                        grain = max(0.0, min(1.0, fbm(p.x * 3.1 + 9.0, p.y * 3.1, p.z * 3.1) * 2.1 - 0.5))
                        band = smooth(-1.2, -0.5, d) * smooth(0.22, 0.02, d)
                        cr = band * (0.52 + 0.48 * grain) + 0.3 * smooth(-3.2, -1.2, d) * smooth(-0.4, -1.1, d) * grain
                        if cr > 0:
                            c = mix(c, mix(BARNACLE_DARK, BARNACLE, 0.35 + 0.65 * fbm(p.x * 5.0, p.y * 5.0, p.z * 5.0)), min(0.9, cr * 1.3))
                        salt = smooth(-0.02, 0.1, d) * smooth(1.0, 0.15, d) * \
                            max(0.0, fbm(p.x * 1.7, p.y * 1.7 + 20.0, p.z * 0.9) * 1.9 - 0.55)
                        if salt > 0:
                            c = mix(c, SALT, 0.42 * min(1.0, salt))
                        # Above it: rain streaks, pale lichen, moss on the tops.
                        dry = smooth(0.5, 2.6, d)
                        patch = fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                        m = (0.9 * up + 0.4 * north + 0.06) * max(0.0, patch * 2.0 - 0.75) * self.moss * (0.35 + 0.65 * dry)
                        m = min(0.8, m)
                        if m > 0 and d > 0:
                            c = mix(c, mix(MOSS_DEEP, MOSS_BRIGHT, fbm(p.x * 1.9, p.y * 1.9, p.z * 1.9)), m)
                        li = max(0.0, fbm(p.x * 2.1 + 31.0, p.y * 2.1, p.z * 2.1 + 9.0) * 2.4 - 1.42 + 0.6 * up) * dry * (1 - m)
                        if li > 0:
                            c = mix(c, LICHEN_OCHRE if fbm(p.x * 0.4, p.y * 0.4 + 50, p.z * 0.4) > 0.7 else LICHEN_PALE,
                                    min(0.62, li))
                    for (q, wid, ln, st) in self.streaks:
                        dz = q.z - p.z
                        if -0.05 < dz < ln:
                            dxy = math.hypot(p.x - q.x, p.y - q.y)
                            wob = wid * (0.7 + 0.7 * fbm(p.x * 3.0, p.y * 3.0, p.z * 0.6)) * (1 + 0.25 * dz)
                            if dxy < wob:
                                k = st * smooth(wob, wob * 0.2, dxy) * (1 - max(0.0, dz) / ln) ** 0.8
                                c = mix(c, mix(RUST, RUST_BRIGHT, fbm(p.x * 4.0, p.y * 4.0, p.z * 1.5)), min(0.85, k))
                    for (q, rad, s) in self.soot:
                        dq = math.hypot(p.x - q.x, p.y - q.y, max(0.0, (p.z - q.z)) * 0.6 + max(0.0, q.z - p.z) * 1.4)
                        if dq < rad:
                            c = mix(c, (0.03, 0.035, 0.035), s * smooth(rad, rad * 0.15, dq))
                    mud = smooth(0.55, 0.0, h) * (0.45 + 0.55 * fbm(p.x * 1.3, p.y * 1.3, 0.0))
                    if mud > 0:
                        c = mix(c, mix(MUD, MUD_WET, 0.3 * wet + 0.15), 0.6 * mud)
                elif kind == K_WOOD:
                    c = scale(c, 0.78 + 0.34 * fbm(p.x * 1.3, p.y * 1.3, p.z * 0.5))
                    c = mix(c, scale(c, 0.45), 0.8 * wet)
                    gr = max(0.0, fbm(p.x * 1.1 + 3.0, p.y * 1.1, p.z * 1.1) * 2.2 - 0.9) * (0.4 + 0.6 * up + 0.5 * wet)
                    c = mix(c, SLIME, min(0.7, gr))
                    c = mix(c, MUD, 0.6 * smooth(0.6, 0.0, h))
                elif kind == K_METAL:
                    v = fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6)
                    c = mix(c, mix(RUST, RUST_BRIGHT, fbm(p.x * 6.0, p.y * 6.0, p.z * 6.0) * 0.7), min(0.85, max(0.0, v * 1.7 - 0.45)))
                    c = scale(c, 0.72 + 0.4 * fbm(p.x * 0.9 + 4, p.y * 0.9, p.z * 0.9))
                    c = mix(c, scale(c, 0.5), 0.7 * wet)
                    c = mix(c, SLIME, 0.5 * wet * max(0.0, fbm(p.x * 1.7, p.y * 1.7, p.z * 1.7) * 2 - 0.9))
                elif kind == K_LEAF:
                    c = scale(c, (0.82 + 0.34 * fbm(p.x * 0.8, p.y * 0.8, p.z * 0.8)))
                elif kind == K_CLOTH:
                    c = scale(c, 0.8 + 0.3 * fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6))
                    c = mix(c, scale(c, 0.5), 0.6 * max(0.0, fbm(p.x * 0.9, p.y * 0.9, p.z * 2.5) * 2.0 - 1.0))
                elif kind == K_EARTH:
                    c = scale(c, 0.8 + 0.4 * fbm(p.x * 1.1, p.y * 1.1, 0.0))
                    c = mix(c, MUD_WET, 0.4 * max(0.0, fbm(p.x * 0.6 + 9, p.y * 0.6, 0.0) * 2 - 0.8))
                    # the heap's skirt goes back to turf: no edge against the grass
                    c = mix(c, scale(TURF, 0.8 + 0.4 * fbm(p.x * 2.0, p.y * 2.0, 1.0)), smooth(0.22, 0.02, h) * 0.85)
                elif kind == K_PAVE:
                    c = scale(c, 0.8 + 0.4 * fbm(p.x * 0.9, p.y * 0.9, 0.0))
                    c = mix(c, scale(c, 0.55), 0.7 * max(0.0, fbm(p.x * 0.5 + 3.0, p.y * 0.5, 2.0) * 2.2 - 0.9))
                    c = mix(c, mix(MOSS_DEEP, SLIME_BRIGHT, fbm(p.x * 2.6, p.y * 2.6, 0.0)),
                            min(0.7, max(0.0, fbm(p.x * 1.6 + 8.0, p.y * 1.6, 0.0) * 2.4 - 1.0)))
                    c = mix(c, MUD, 0.5 * smooth(0.04, -0.1, h))
                elif kind == K_GLASS:
                    c = scale(c, 0.85 + 0.3 * fbm(p.x * 5.0, p.y * 5.0, p.z * 5.0))
                if ao_face is not None:
                    o = p + (ctr - p) * 0.08 + n * 0.03
                    occ = 0.0
                    for dd in ao_face:
                        hit = bvh.ray_cast(o, dd, ao_dist)
                        if hit[0] is not None:
                            occ += 1.0 - hit[3] / ao_dist
                    ao = 1.0 - occ / len(ao_face)
                    k_ao = {K_LEAF: 0.4, K_GLASS: 0.3, K_EARTH: 0.4, K_PAVE: 0.35}.get(kind, 0.72)
                    c = scale(c, 1.0 - k_ao * (1.0 - ao) ** 0.85)
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
    glow = ec.vertex_color_material('KitGlow', rough=0.5, emission=5.0)
    glow.use_backface_culling = True
    wet = ec.vertex_color_material('KitWet', rough=0.12)
    wet.use_backface_culling = True
    return [stone, leaf, glow, wet]
