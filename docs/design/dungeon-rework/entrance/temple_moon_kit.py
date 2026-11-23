"""Pearl-stone craft for the Drowned Temple world entrance
(build_temple_entrance.py): the Moon Stair, the moongate and the moon pool.

hckit's Piece (the pilot kit's primitives) plus what a drowned scrying house
needs:

- block(): a hand-hewn ashlar with chipped corners and pillowed faces;
- wedge(): the same craft as a voussoir of a ring (an arc block in the ring's
  own plane), with a moulded archivolt band on each face;
- tread(): a stair stone with a moulded nosing, a worn dip down its walking
  line and the odd chip out of its arris;
- loft(): a skin over cross-section rings (robes, hoods, sleeves, horns);
- phase_disc(): a lunar phase inlaid in silver: the tarnished disc and the lit
  part that still glows. A glowing face carries its place in the moonrise in
  its colour ALPHA (0 the stair's foot, 1 the gate's crown): the runtime lights
  the inlays one by one from that number;
- growth on a double-sided material: lily pads and their flowers, reed and
  sedge, hanging weed, moss cushions, a creeper with pale moonflowers;
- finish(): the water written into the stone by HEIGHT, baked into LINEAR
  vertex colour: pale dry pearl with lichen and moss above the old tide line,
  a nacre crust on that line, stained stone and dried weed in the band the
  mere has left, and green-black wet slime at and under the water that still
  stands; then ray-cast ambient occlusion against the whole set piece and its
  terrain. Faces under the standing water go to the glossy wet material.

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
K_STONE, K_LEAF, K_GLOW, K_SILVER, K_RAW, K_EARTH, K_FLOWER = range(7)

# Pearl stone (sRGB) and what the mere left on it.
PEARL = (0.74, 0.725, 0.69)
PEARL_WARM = (0.76, 0.72, 0.655)
PEARL_COOL = (0.655, 0.68, 0.70)
PEARL_PALE = (0.81, 0.80, 0.77)
PEARL_DARK = (0.56, 0.565, 0.56)
PEARL_ROSE = (0.75, 0.70, 0.685)
CORE = (0.20, 0.205, 0.20)
NACRE = (0.84, 0.82, 0.78)
NACRE_PINK = (0.80, 0.72, 0.72)
STAIN = (0.33, 0.39, 0.36)
WEED_DRY = (0.2, 0.26, 0.17)
WETC = (0.055, 0.085, 0.075)
SLIME = (0.085, 0.16, 0.10)
SLIME_BRIGHT = (0.20, 0.31, 0.13)
SILT = (0.27, 0.285, 0.24)
LICHEN_PALE = (0.76, 0.79, 0.70)
LICHEN_OCHRE = (0.68, 0.66, 0.44)
LICHEN_GREY = (0.52, 0.56, 0.55)
MOSS_DEEP = (0.14, 0.23, 0.11)
MOSS_BRIGHT = (0.30, 0.41, 0.16)
SOIL = (0.22, 0.20, 0.14)
SOIL_WET = (0.09, 0.085, 0.065)
SILVER_TARN = (0.33, 0.37, 0.375)
SILVER_DARK = (0.2, 0.24, 0.24)
SILVER_BRIGHT = (0.62, 0.67, 0.7)
VERDIGRIS = (0.30, 0.45, 0.40)
MOON = (0.80, 0.90, 1.0)
REED = ((0.36, 0.42, 0.20), (0.44, 0.47, 0.23), (0.29, 0.36, 0.17), (0.50, 0.49, 0.27))
REED_DRY = (0.62, 0.56, 0.36)
SEDGE = ((0.22, 0.34, 0.16), (0.28, 0.39, 0.18), (0.18, 0.28, 0.14))
WEED = ((0.09, 0.17, 0.09), (0.13, 0.22, 0.10), (0.18, 0.25, 0.11), (0.22, 0.21, 0.10))
LILY = ((0.16, 0.33, 0.17), (0.20, 0.38, 0.18), (0.13, 0.27, 0.16), (0.27, 0.40, 0.17), (0.33, 0.36, 0.15))
LILY_UNDER = (0.36, 0.20, 0.20)
PETAL = (0.93, 0.92, 0.88)
PETAL_BLUSH = (0.92, 0.80, 0.84)
PETAL_MOON = (0.80, 0.86, 0.97)
STAMEN = (0.90, 0.74, 0.30)
# The creeper's leaf: a dark blue-green, the mere's own colour, kept light
# enough to read as a leaf against pale stone by day and under the moon.
VINE = ((0.17, 0.42, 0.37), (0.21, 0.48, 0.39), (0.15, 0.37, 0.36), (0.26, 0.50, 0.38))
STEM = (0.17, 0.15, 0.10)


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


class Moon(hckit.Piece):
    def __init__(self, name, seed=0, water=None, tide=None, moss=1.0, wet_fn=None):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.gen = self.bm.verts.layers.int.new('gen')
        self.kindL = self.bm.faces.layers.int.new('kind')
        self.stamp = 0
        self.rng = random.Random(zlib.crc32(name.encode()) * 131 + seed)
        self.kind = K_STONE
        self.water = water
        self.tide = tide
        self.moss_k = moss
        self.wet_fn = wet_fn     # (x, y) -> whether the standing water reaches this point
        self.streaks = []    # (point, width, length, strength): wet green running down
        self.weather = 1.0
        self.lichen = 0.0

    # ------------------------------------------------------------ painting
    def _paint(self, faces, color, mat, alpha=1.0):
        for face in faces:
            face.material_index = mat
            face[self.kindL] = self.kind
            for loop in face.loops:
                loop[self.col] = (color[0], color[1], color[2], alpha)

    def as_kind(self, kind):
        piece = self

        class _K:
            def __enter__(self_):
                self_.prev = piece.kind
                piece.kind = kind

            def __exit__(self_, *a):
                piece.kind = self_.prev
        return _K()

    def tone(self, u=0.0, y=0.0, base=None):
        """One block's colour: the drifting base plus the odd warm, cool,
        pale, dark or rose block."""
        r = self.rng.random()
        drift = fbm(u * 0.23 + 3.1, y * 0.29 - 1.7, 0.5)
        c = mix(base or PEARL, PEARL_COOL, max(0.0, drift * 1.4 - 0.5))
        odd = None
        if r < 0.10:
            odd = PEARL_COOL
        elif r < 0.18:
            odd = PEARL_DARK
        elif r < 0.30:
            odd = PEARL_PALE
        elif r < 0.40:
            odd = PEARL_WARM
        elif r < 0.45:
            odd = PEARL_ROSE
        if odd is not None:
            c = mix(c, odd, 0.55)
        return self.vary(c, 0.03)

    def face(self, pts, color, mat=STONE, cols=None, want=None, centre=None, smooth_face=False, alpha=1.0):
        """A face from points (Blender space). Flipped to face `want` (a
        direction) or away from `centre` (a point) when one is given."""
        f = self.bm.faces.new([self.bm.verts.new(Vector(p)) for p in pts])
        if want is not None or centre is not None:
            f.normal_update()
            d = Vector(want) if want is not None else (f.calc_center_median() - Vector(centre))
            if f.normal.dot(d) < 0:
                f.normal_flip()
        f.material_index = mat
        f[self.kindL] = self.kind
        f.smooth = smooth_face
        for i, loop in enumerate(f.loops):
            c = cols[i] if cols is not None else color
            loop[self.col] = (c[0], c[1], c[2], alpha)
        return f

    def _orient(self, faces, centre):
        centre = Vector(centre)
        for f in faces:
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - centre) < 0:
                f.normal_flip()

    # hckit's turned and swept solids, with their faces made to look outward
    # (the stone material culls back faces in the engine)
    def _outward(self, faces):
        faces = [f for f in faces if f.is_valid]
        if faces:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return faces

    def lathe(self, *a, **kw):
        return self._outward(super().lathe(*a, **kw))

    def sweep(self, *a, **kw):
        return self._outward(super().sweep(*a, **kw))

    def prism(self, *a, **kw):
        return self._outward(super().prism(*a, **kw))

    # ------------------------------------------------------------- blocks
    def _hewn(self, cs, color, pillow=0.03, pillows=(0, 1, 2, 3, 4, 5), skip=(), joint=(), knock=0.12, bed=False,
              level=False, keep=None):
        """Faces of a hexahedron from its 8 corners (bottom ring 0..3, top
        ring 4..7, both counter-clockwise from above). Face ids: 0 south
        (0,1,5,4), 1 east (1,2,6,5), 2 north (2,3,7,6), 3 west (3,0,4,7),
        4 top, 5 bottom. Pillowed faces get a raised centre and four facets;
        joint faces are dark. A knocked bed corner breaks off in plan only, so
        the bed stays flat and the stone still sits on what carries it. `bed`
        gives a stone whose bottom is skipped a flat, shadowed bed face: for
        every stone that oversails its support, where a player below would
        otherwise look up into a hollow shell. `level` keeps the top true the
        same way (a stone that carries an inlay), and `keep` (a unit vector)
        keeps a knocked corner where it was along that axis: the corner breaks
        off round a face that carries an inlay, never back from it ('all' keeps
        the corner whole: a stone that carries mouldings to its very arris)."""
        rng = self.rng
        cs = [Vector(c) for c in cs]
        ctr = sum(cs, Vector()) / 8
        if rng.random() < knock:
            i = rng.choice((4, 5, 6, 7, 4, 5, 6, 7, 0, 1, 2, 3))
            k = 0.72 + 0.16 * rng.random()
            was = cs[i].copy()
            if i < 4:
                low = sum(cs[:4], Vector()) / 4
                cs[i] = low + (cs[i] - low) * k
            elif level:
                high = sum(cs[4:], Vector()) / 4
                cs[i] = high + (cs[i] - high) * k
            else:
                cs[i] = ctr + (cs[i] - ctr) * k
            if keep == 'all':
                cs[i] = was
            elif keep is not None:
                cs[i] += Vector(keep) * (was - cs[i]).dot(Vector(keep))
        m = min((cs[1] - cs[0]).length, (cs[3] - cs[0]).length, (cs[4] - cs[0]).length)
        quads = ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0))
        edge = scale(color, 0.86 + 0.06 * rng.random())
        lit = scale(color, 1.05)
        foot = scale(color, 0.74)
        chipped = rng.randrange(8) if rng.random() < 0.35 else -1
        made = []
        for fi, quad in enumerate(quads):
            if fi in skip:
                if fi == 5 and bed:
                    made.append(self.face([cs[i] for i in quad], scale(color, 0.6), centre=ctr))
                continue
            if fi in joint:
                jc = scale(color, 0.42)
                made.append(self.face([cs[i] for i in quad], jc, centre=ctr))
                continue
            pcs = [cs[i] for i in quad]
            vc = []
            for i in quad:
                if i == chipped:
                    vc.append(scale(color, 1.22))
                elif fi == 4:
                    vc.append(scale(color, 0.97))
                else:
                    vc.append(foot if i < 4 else edge)
            if fi in pillows and pillow > 0:
                n = (pcs[1] - pcs[0]).cross(pcs[3] - pcs[0])
                if n.length < 1e-9:
                    continue
                n.normalize()
                fc = sum(pcs, Vector()) / 4
                if n.dot(fc - ctr) < 0:
                    n = -n
                mid = fc + n * (pillow * m * (0.5 + rng.random())) + \
                    ((pcs[1] - pcs[0]) * (rng.random() - 0.5) + (pcs[3] - pcs[0]) * (rng.random() - 0.5)) * 0.3
                for k in range(4):
                    made.append(self.face((pcs[k], pcs[(k + 1) % 4], mid), color, centre=ctr,
                                          cols=(vc[k], vc[(k + 1) % 4], lit)))
            else:
                made.append(self.face(pcs, color, cols=vc, centre=ctr))
        return made

    def block(self, c, size, color, rot=None, M=None, chip=0.06, **kw):
        """A hewn block. Local frame: X length, Y depth, Z up."""
        rng = self.rng
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        m = min(size)
        cs = []
        for (i, j, k) in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                          (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
            q = chip * m
            p = Vector((i * (sx - q * rng.random() ** 2), j * (sy - q * rng.random() ** 2),
                        k * (sz - q * rng.random() ** 2)))
            if rot is not None:
                p = rot @ p
            p = p + Vector(c)
            cs.append(M @ p if M is not None else p)
        return self._hewn(cs, color, **kw)

    def wedge(self, centre, r0, r1, a0, a1, y0, y1, color, chip=0.05, gap=0.012, shift=(0.0, 0.0, 0.0), true_faces=False,
              sound=False, **kw):
        """A voussoir of a ring standing in the XZ plane about `centre`
        (Blender X across, Z up), from angle a0 to a1 (0 = +X, anticlockwise
        seen from -Y... the ring's south face is +Y), radii r0 to r1, depth
        y0 to y1 (Blender Y offsets from the centre). shift = (radial, along
        Y, twist): a slipped stone. true_faces keeps its two faces (the
        planes Y = y0 and y1) true: no chip back from them, and a knocked
        corner breaks round the face (a voussoir whose face carries an inlay).
        sound keeps every corner whole (one that carries mouldings)."""
        rng = self.rng
        cx, cy, cz = centre
        am = (a0 + a1) / 2
        q = chip * min(r1 - r0, y1 - y0)
        cs = []
        # bottom ring = inner radius, top ring = outer radius (its "up" is radial)
        for r in (r0, r1):
            for (a, y) in ((a0 + gap, y1), (a1 - gap, y1), (a1 - gap, y0), (a0 + gap, y0)):
                rr = r + (q if r == r0 else -q) * rng.random() ** 2 + shift[0]
                aa = a + (am - a) * (q / max(0.2, r * abs(a1 - a0))) * rng.random() ** 2 + shift[2]
                back = math.copysign(q * rng.random() ** 2, y - (y0 + y1) / 2)
                yy = y - (0.0 if true_faces else back) + shift[1]
                cs.append(Vector((cx + math.cos(aa) * rr, cy + yy, cz + math.sin(aa) * rr)))
        # _hewn face ids for this corner order: 0 = +Y face (south), 2 = -Y
        # face (north), 1 and 3 the joints, 4 the extrados, 5 the intrados.
        return self._hewn(cs, color, joint=(1, 3), keep='all' if sound else (0, 1, 0) if true_faces else None, **kw)

    def arc_band(self, centre, r0, r1, a0, a1, y, out, color, steps=2, mat=STONE, alpha=1.0, sink=0.0):
        """A raised moulding strip on a ring face: from radius r0 to r1 on
        the plane Y = y, standing `out` proud (signed along Y), chamfered. Its
        two feet go `sink` into the stone, so a chipped face never leaves it
        standing off the wall."""
        cx, cy, cz = centre
        ch = min(abs(out), (r1 - r0) * 0.3)
        foot = y - math.copysign(sink, out)
        prev = None
        for i in range(steps + 1):
            a = a0 + (a1 - a0) * i / steps
            c, s = math.cos(a), math.sin(a)
            cur = [Vector((cx + c * r, cy + yy, cz + s * r)) for (r, yy) in
                   ((r0, foot), (r0 + ch, y + out), (r1 - ch, y + out), (r1, foot))]
            if i in (0, steps):
                # the strip's two ends are closed: a moulding is a solid bar, seen end on too
                d = -1 if i == 0 else 1
                self.face(cur, scale(color, 0.78), mat=mat, want=(-s * d, 0, c * d), alpha=alpha)
            if prev is not None:
                for k in range(3):
                    shade = (0.82, 1.06, 0.9)[k]
                    self.face((prev[k], cur[k], cur[k + 1], prev[k + 1]), scale(color, shade), mat=mat,
                              want=(c * (k - 1) * 0.7, out, s * (k - 1) * 0.7), alpha=alpha)
            prev = cur

    def tread(self, x0, x1, yf, depth, top, bottom, color, segs=4, wear=0.035, nose=0.05, chips=1, ends=(True, True),
              tilt=0.0, sink=0.0, end_bottom=None, back=False):
        """A stair stone: its top from the back (Blender y = yf - depth) to
        the nosing at yf, a rolled nosing, and the riser down to `bottom`.
        x0..x1 across the stair. The walking line (the middle) is worn.
        `back` closes its back down to the ends' foot: a stone that stands
        out past the tread over it, where its back shows."""
        rng = self.rng
        st = []
        for i in range(segs + 1):
            u = i / segs
            x = x0 + (x1 - x0) * u
            mid = 1 - abs(u - 0.5) * 2
            dip = wear * mid * mid * (0.6 + 0.8 * rng.random()) if 0 < i < segs else 0.0
            t = top - dip - sink + tilt * (u - 0.5)
            nz = nose * (1 - 0.5 * mid * (wear > 0))
            notch = 0.0
            if chips and 0 < i < segs and rng.random() < 0.22 * chips:
                notch = 0.03 + 0.05 * rng.random()
            # (the back's small unevenness dies out at the stone's two ends: stones laid end to end meet)
            st.append((x, [Vector((x, yf - depth, t + 0.004 * (rng.random() - 0.5) * (0 < i < segs))),
                           Vector((x, yf - 0.02 - notch, t)),
                           Vector((x, yf + nz - notch, t - 0.028 - notch * 0.6)),
                           Vector((x, yf + nz - notch * 0.5, t - 0.088)),
                           Vector((x, yf, t - 0.122)),
                           Vector((x, yf, bottom))], mid))
        worn = scale(color, 1.1)
        for i in range(segs):
            (xa, pa, ma), (xb, pb, mb) = st[i], st[i + 1]
            shades = (1.0, 1.08, 0.86, 0.66, 0.80)
            for k in range(5):
                ca = scale(mix(color, worn, ma * 0.7 if k < 2 else 0.0), shades[k])
                cb = scale(mix(color, worn, mb * 0.7 if k < 2 else 0.0), shades[k])
                foot = 0.72 if k == 4 else 1.0
                self.face((pa[k], pb[k], pb[k + 1], pa[k + 1]), color, cols=(ca, cb, scale(cb, foot), scale(ca, foot)),
                          want=((0, 0.02, 1), (0, 0.5, 1), (0, 1, 0.2), (0, 1, -0.6), (0, 1, 0))[k])
        if back:
            eb = bottom if end_bottom is None else end_bottom
            self.face([p[0] for (_x, p, _m) in st] + [Vector((x1, yf - depth, eb)), Vector((x0, yf - depth, eb))],
                      scale(color, 0.6), want=(0, -1, 0))
        for (flag, (x, p, _m), sgn) in ((ends[0], st[0], -1), (ends[1], st[-1], 1)):
            if flag:
                eb = bottom if end_bottom is None else end_bottom
                self.face((p[0], p[1], p[2], p[3], p[4], Vector((x, yf, eb)), Vector((x, yf - depth, eb))),
                          scale(color, 0.62), want=(sgn, 0, 0))

    def loft(self, rings, color, closed=True, cap0=False, cap1=False, smooth_face=True, mat=STONE, cols=None,
             alpha=1.0, cap_color=None):
        """A skin over cross-section rings (lists of points, all the same
        length). cols(i, k) may give a per-vertex colour; cap_color is the
        caps' own (a bed that lies in a joint's shadow)."""
        vr = [[self.bm.verts.new(Vector(p)) for p in ring] for ring in rings]
        n = len(rings[0])
        cents = [sum((Vector(p) for p in ring), Vector()) / n for ring in rings]
        made = []
        for i in range(len(rings) - 1):
            mid = (cents[i] + cents[i + 1]) / 2
            for k in range(n if closed else n - 1):
                k1 = (k + 1) % n
                f = self.bm.faces.new((vr[i][k], vr[i][k1], vr[i + 1][k1], vr[i + 1][k]))
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - mid) < 0:
                    f.normal_flip()
                f.smooth = smooth_face
                f.material_index = mat
                f[self.kindL] = self.kind
                for loop in f.loops:
                    vi = loop.vert
                    ii = i if vi in vr[i] else i + 1
                    kk = (vr[ii].index(vi))
                    c = cols(ii, kk) if cols is not None else color
                    loop[self.col] = (c[0], c[1], c[2], alpha)
                made.append(f)
        for (flag, i, d) in ((cap0, 0, -1), (cap1, len(rings) - 1, 1)):
            if flag:
                f = self.bm.faces.new(vr[i])
                f.normal_update()
                axis = (cents[min(i + 1, len(rings) - 1)] - cents[max(i - 1, 0)]) * d
                if f.normal.dot(axis) < 0:
                    f.normal_flip()
                f.material_index = mat
                f[self.kindL] = self.kind
                cc = cap_color or color
                for loop in f.loops:
                    loop[self.col] = (cc[0], cc[1], cc[2], alpha)
                made.append(f)
        return made

    def disc(self, centre, normal, radius, color, sides=10, mat=STONE, up=None, alpha=1.0, squash=1.0):
        n = Vector(normal).normalized()
        t = Vector(up).normalized() if up is not None else n.orthogonal().normalized()
        u = n.cross(t)
        c = Vector(centre)
        pts = [c + (t * math.cos(TAU * i / sides) + u * math.sin(TAU * i / sides) * squash) * radius
               for i in range(sides)]
        return self.face(pts, color, mat=mat, want=n, alpha=alpha)

    def phase_disc(self, centre, normal, up, radius, phase, order, live=True, lift=0.012, waning=False):
        """A lunar phase inlaid in silver: the tarnished disc and, proud of it
        by `lift`, the lit part (phase 0 new, 0.5 half, 1 full). `up` is the
        direction of the disc's top; the lit limb is on the right, or the
        left when waning. A live inlay glows; its alpha is `order`."""
        n = Vector(normal).normalized()
        t = Vector(up).normalized()
        u = t.cross(n).normalized() * (-1 if waning else 1)
        c = Vector(centre)
        with self.as_kind(K_SILVER):
            self.disc(c, n, radius * 1.16, SILVER_TARN, sides=12, up=t)
        if phase <= 0.02:
            return
        k = 1 - 2 * phase      # terminator's x radius: 1 new, 0 half, -1 full
        steps = 7
        limb, term = [], []
        for i in range(steps + 1):
            a = -math.pi / 2 + math.pi * i / steps
            limb.append(c + n * lift + (u * math.cos(a) + t * math.sin(a)) * radius)
            term.append(c + n * lift + (u * math.cos(a) * k + t * math.sin(a)) * radius)
        kind = K_GLOW if live else K_SILVER
        col = MOON if live else scale(SILVER_TARN, 1.25)
        with self.as_kind(kind):
            for i in range(steps):
                if i == 0:
                    pts = (limb[0], limb[1], term[1])
                elif i == steps - 1:
                    pts = (limb[i], limb[i + 1], term[i])
                else:
                    pts = (limb[i], limb[i + 1], term[i + 1], term[i])
                if (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[-1]) - Vector(pts[0])).length < 1e-7:
                    continue
                self.face(pts, col, mat=GLOW if live else STONE, want=n, alpha=order if live else 1.0)

    def inlay(self, a, b, width, normal, order, live=True, lift=0.01):
        """A straight silver inlay strip from a to b on a face."""
        a, b, n = Vector(a), Vector(b), Vector(normal).normalized()
        s = (b - a).cross(n).normalized() * width / 2
        kind = K_GLOW if live else K_SILVER
        with self.as_kind(kind):
            self.face((a - s + n * lift, b - s + n * lift, b + s + n * lift, a + s + n * lift),
                      MOON if live else SILVER_TARN, mat=GLOW if live else STONE, want=n,
                      alpha=order if live else 1.0)

    # ------------------------------------------------------------- growth
    def _leaf(self, pts, cols):
        f = self.bm.faces.new([self.bm.verts.new(Vector(q)) for q in pts])
        f.material_index = LEAF
        f[self.kindL] = self.kind if self.kind in (K_LEAF, K_FLOWER) else K_LEAF
        for loop, c in zip(f.loops, cols):
            loop[self.col] = (c[0], c[1], c[2], 1.0)
        return f

    def blade(self, base, tip, width, color, bend=None, segs=2, tip_col=None, twist=0.0):
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
                    self._leaf((prev[0], prev[1], p), (prev[2], prev[2], c))
                else:
                    self._leaf((prev[0], prev[1], cur[1], cur[0]), (prev[2], prev[2], c, c))
            prev = cur

    def sedge(self, pos, radius=0.24, blades=9, height=0.6, dry=0.15):
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
            self.blade(base, tip, 0.022 + rng.random() * 0.014, self.vary(c, 0.12), bend=bend, segs=2,
                       twist=rng.uniform(-0.6, 0.6))

    def reeds(self, pos, radius=0.4, stems=7, height=1.8, heads=0.5, dry=0.2):
        """A stand of reed and bulrush: upright stems with close leaves and,
        on some, a dark velvet head."""
        rng = self.rng
        p0 = Vector(pos)
        for k in range(stems):
            a = rng.random() * TAU
            r = radius * math.sqrt(rng.random())
            base = p0 + Vector((math.cos(a) * r, math.sin(a) * r, -0.1))
            h = height * rng.uniform(0.6, 1.15)
            lean = Vector(((rng.random() - 0.5) * 0.24, (rng.random() - 0.5) * 0.24, 0)) * h
            c = REED_DRY if rng.random() < dry else REED[rng.randrange(len(REED))]
            c = self.vary(c, 0.1)
            top = base + Vector((0, 0, h)) + lean
            tw = rng.random() * 3
            self.blade(base, top, 0.02, scale(c, 0.85), bend=lean * 0.25, segs=2, twist=tw)
            self.blade(base, top, 0.02, scale(c, 0.85), bend=lean * 0.25, segs=2, twist=tw + 1.57)
            for j in range(rng.randrange(1, 3)):
                t = 0.25 + 0.25 * j + rng.random() * 0.1
                q = base + (top - base) * t
                la = rng.random() * TAU
                ln = h * rng.uniform(0.2, 0.34)
                d = Vector((math.cos(la), math.sin(la), 0))
                self.blade(q, q + d * ln * 0.3 + Vector((0, 0, ln * 0.95)), 0.03, c,
                           bend=d * ln * 0.45 - Vector((0, 0, ln * 0.3)), segs=2)
            if rng.random() < heads:
                hh = 0.2 + rng.random() * 0.1
                head = (0.34, 0.24, 0.14)
                for k3 in range(4):
                    a0, a1 = TAU * k3 / 4, TAU * (k3 + 1) / 4
                    q = [top + Vector((math.cos(a0) * 0.014, math.sin(a0) * 0.014, -0.03)),
                         top + Vector((math.cos(a1) * 0.014, math.sin(a1) * 0.014, -0.03)),
                         top + Vector((math.cos(a1) * 0.028, math.sin(a1) * 0.028, hh * 0.5)),
                         top + Vector((math.cos(a0) * 0.028, math.sin(a0) * 0.028, hh * 0.5))]
                    self._leaf(q, [head] * 4)
                    self._leaf((q[3], q[2], top + Vector((0, 0, hh))), [head, head, (0.42, 0.3, 0.17)])

    def weed(self, top, length, out, width=0.6, blades=7, blade=0.1):
        """Hanging weed: limp ribbons from `top` down a face (normal `out`)."""
        rng = self.rng
        top = Vector(top)
        out = Vector(out).normalized()
        side = Vector((0, 0, 1)).cross(out)
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        for b in range(blades):
            a = top + side * (rng.random() - 0.5) * width + out * (0.03 + rng.random() * 0.05) + \
                Vector((0, 0, rng.random() * 0.12))
            ln = length * (0.4 + 0.6 * rng.random())
            sway = (rng.random() - 0.5) * 0.3
            w0 = blade * (0.6 + 0.7 * rng.random())
            tw = rng.uniform(-1.2, 1.2)
            c = self.vary(WEED[rng.randrange(len(WEED))], 0.14)
            prev = None
            for i in range(4):
                t = i / 3
                p = a + Vector((0, 0, -ln * t)) + side * sway * ln * t * t + out * (0.05 * math.sin(t * 3.0 + b))
                d = side * math.cos(tw * t) + out * math.sin(tw * t)
                w = w0 * (1 - 0.6 * t * t)
                cur = (p - d * w, p + d * w, scale(c, 0.78 + 0.45 * t))
                if prev is not None:
                    if i == 3:
                        self._leaf((prev[0], prev[1], p), (prev[2], prev[2], cur[2]))
                    else:
                        self._leaf((prev[0], prev[1], cur[1], cur[0]), (prev[2], prev[2], cur[2], cur[2]))
                prev = cur

    def moss(self, pos, radius, color=None, normal=(0, 0, 1), height=0.07, lobes=5):
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
            k = 6
            ph = rng.random() * TAU
            ring = [c + (t * math.cos(ph + TAU * i / k) + u * math.sin(ph + TAU * i / k)) * rr * rng.uniform(0.8, 1.15)
                    - n * 0.015 for i in range(k)]
            top = c + n * hh
            col = self.vary(c0, 0.14)
            for i in range(k):
                self._leaf((ring[i], ring[(i + 1) % k], top), (scale(col, 0.62), scale(col, 0.62), scale(col, 1.2)))

    def lily(self, pos, radius, yaw=None, tilt=0.0, color=None):
        """A lily pad: a notched disc lying on the water, its rim a touch raised."""
        rng = self.rng
        yaw = rng.random() * TAU if yaw is None else yaw
        c = Vector(pos)
        col = self.vary(color or LILY[rng.randrange(len(LILY))], 0.1)
        k = 9
        notch = 0.42
        rim = []
        for i in range(k + 1):
            a = yaw + notch / 2 + (TAU - notch) * i / k
            rr = radius * (0.93 + 0.12 * rng.random())
            rim.append(c + Vector((math.cos(a) * rr, math.sin(a) * rr,
                                   0.012 * radius / 0.3 + tilt * math.cos(a - yaw) * radius)))
        hub = c + Vector((math.cos(yaw) * radius * 0.12, math.sin(yaw) * radius * 0.12, 0.0))
        for i in range(k):
            dark = scale(col, 0.72 if i % 2 else 0.86)
            self._leaf((hub, rim[i], rim[i + 1]), (scale(col, 1.18), dark, dark))

    def lotus(self, pos, size=0.2, color=None, petals=8):
        """A water lily in flower: two whorls of pointed petals and a gold heart."""
        rng = self.rng
        c = Vector(pos)
        col = color or (PETAL if rng.random() < 0.7 else PETAL_BLUSH)
        with self.as_kind(K_FLOWER):
            for (ring, rad, rise, n) in ((0, 1.0, 0.35, petals), (1, 0.62, 0.8, petals - 2)):
                ph = rng.random() * TAU
                for i in range(n):
                    a = ph + TAU * i / n
                    d = Vector((math.cos(a), math.sin(a), 0))
                    s = Vector((-math.sin(a), math.cos(a), 0))
                    base = c + d * size * 0.12 + Vector((0, 0, 0.02))
                    tip = c + d * size * rad + Vector((0, 0, size * rise))
                    midp = (base + tip) / 2 + Vector((0, 0, -size * 0.08))
                    w = size * 0.26
                    cc = self.vary(col, 0.04)
                    self._leaf((base, midp + s * w, tip, midp - s * w),
                               (scale(cc, 0.8), cc, scale(cc, 1.05), cc))
            for i in range(3):
                a = TAU * i / 3
                self._leaf((c + Vector((0, 0, size * 0.2)),
                            c + Vector((math.cos(a) * size * 0.16, math.sin(a) * size * 0.16, size * 0.42)),
                            c + Vector((math.cos(a + 2.1) * size * 0.16, math.sin(a + 2.1) * size * 0.16, size * 0.42))),
                           (STAMEN, STAMEN, STAMEN))

    def moonflower(self, pos, normal, size=0.13):
        """A pale five-petalled moonflower held off a face."""
        rng = self.rng
        n = Vector(normal).normalized()
        t = n.orthogonal().normalized()
        u = n.cross(t)
        c = Vector(pos) + n * 0.04
        ph = rng.random() * TAU
        col = self.vary(PETAL_MOON if rng.random() < 0.65 else PETAL, 0.04)
        with self.as_kind(K_FLOWER):
            for i in range(5):
                a = ph + TAU * i / 5
                d = t * math.cos(a) + u * math.sin(a)
                s = n.cross(d)
                tip = c + d * size + n * size * 0.25
                self._leaf((c, c + d * size * 0.55 + s * size * 0.36 + n * size * 0.1, tip,
                            c + d * size * 0.55 - s * size * 0.36 + n * size * 0.1),
                           (STAMEN, col, scale(col, 1.05), col))

    def creeper(self, pts, width=0.022, leaf=0.13, every=0.22, flowers=0.12, normals=None):
        """A creeper along a polyline (Blender points): a thin woody stem,
        heart leaves either side and pale moonflowers. normals(i) is the
        surface normal at point i (defaults to away from the Z axis)."""
        rng = self.rng
        pts = [Vector(p) for p in pts]
        acc = 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            n = Vector(normals(i)).normalized() if normals else Vector((a.x, a.y, 0)).normalized()
            d = (b - a)
            ln = d.length
            if ln < 1e-5:
                continue
            d = d / ln
            s = d.cross(n).normalized() * width
            col = scale(STEM, 0.9 + 0.3 * rng.random())
            self._leaf((a - s + n * 0.02, a + s + n * 0.02, b + s + n * 0.02, b - s + n * 0.02), [col] * 4)
            acc += ln
            while acc > every:
                acc -= every * (0.7 + 0.6 * rng.random())
                q = a + d * (ln * rng.random())
                sgn = 1 if rng.random() < 0.5 else -1
                out = (d.cross(n) * sgn * (0.6 + 0.4 * rng.random()) + d * (rng.random() - 0.3) * 0.6 + n * 0.25).normalized()
                sz = leaf * (0.7 + 0.7 * rng.random())
                w = n.cross(out).normalized() * sz * 0.42
                c = self.vary(VINE[rng.randrange(len(VINE))], 0.14)
                base = q + n * 0.025
                # a heart leaf folded on its midrib: two halves, their lobes
                # broad by the stalk and drawn to a point, the edges a touch
                # lower than the rib so the two halves take the light apart
                tip = base + out * sz + n * 0.004
                rib = (scale(c, 0.8), scale(c, 1.2))
                for (side, shade) in ((1, 1.0), (-1, 0.88)):
                    lobe = base + out * sz * 0.16 + w * side * 1.05 - n * 0.012
                    waist = base + out * sz * 0.62 + w * side * 0.72 - n * 0.012
                    f = self._leaf((base, lobe, waist, tip) if side > 0 else (base, tip, waist, lobe),
                                   (rib[0], scale(c, shade), scale(c, shade * 1.06), rib[1]) if side > 0 else
                                   (rib[0], rib[1], scale(c, shade * 1.06), scale(c, shade)))
                    f.normal_update()
                    if f.normal.dot(n) < 0:
                        f.normal_flip()
                if rng.random() < flowers:
                    self.moonflower(q + out * sz * 0.5, n, size=leaf * (0.8 + 0.5 * rng.random()))

    # ------------------------------------------------------------- finish
    def geometry(self, offset=0):
        """(verts, polys) of the solid (non-leaf) faces for the AO occluder."""
        self.bm.verts.index_update()
        verts = [v.co.copy() for v in self.bm.verts]
        polys = [[v.index + offset for v in f.verts] for f in self.bm.faces
                 if f[self.kindL] not in (K_LEAF, K_FLOWER)]
        return verts, polys

    def finish(self, materials, parent, ground=None, bvh=None, ao_dist=1.9):
        bm = self.bm
        bm.normal_update()
        rays = _hemisphere(9)
        gfn = ground or (lambda x, y: 0.0)
        W = self.water if self.water is not None else -1e9
        T = self.tide if self.tide is not None else -1e9
        for face in bm.faces:
            kind = face[self.kindL]
            n = face.normal
            ctr = face.calc_center_median()
            ao_face = None
            if bvh is not None and kind not in (K_RAW, K_GLOW):
                t = n.orthogonal().normalized()
                bt = n.cross(t)
                ao_face = [(t * d[0] + bt * d[1] + n * d[2]) for d in rays]
            up = max(0.0, n.z)
            reach = self.wet_fn is None or self.wet_fn(ctr.x, ctr.y)
            if reach and kind == K_STONE and face.material_index == STONE and \
                    max(v.co.z for v in face.verts) < W + 0.42 and ctr.z < W + 0.22:
                face.material_index = WET
            for loop in face.loops:
                p = loop.vert.co
                r, g, b, al = loop[self.col]
                c = (r, g, b)
                h = p.z - gfn(p.x, p.y)
                dw = (p.z - W) if reach else 9.0
                dt = p.z - (T + 0.30 * (fbm(p.x * 0.45 + 3.0, p.y * 0.45 - 7.0, 0.3) - 0.5)
                            + 0.12 * (fbm(p.x * 2.1, p.y * 2.1, 1.7) - 0.5))
                if kind == K_STONE:
                    drift = 0.90 + 0.20 * fbm(p.x * 0.33, p.y * 0.33, p.z * 0.33)
                    streak = 0.92 + 0.14 * fbm(p.x * 2.3 + 7.1, p.y * 2.3 - 3.3, p.z * 0.2)
                    c = scale(c, drift * streak)
                    # the band the mere has left: stained, dried weed, shell crust
                    drained = smooth(0.15, -0.5, dt)
                    if drained > 0:
                        st = mix(scale(c, 0.74), STAIN, 0.36 + 0.2 * fbm(p.x * 0.8, p.y * 0.8, p.z * 0.8))
                        c = mix(c, st, drained)
                        wd = drained * max(0.0, fbm(p.x * 1.3 + 5.0, p.y * 1.3, p.z * 0.7 + 2.0) * 2.4 - 0.95) * \
                            (0.5 + 0.7 * up)
                        c = mix(c, WEED_DRY, min(0.7, wd))
                        sp = drained * max(0.0, fbm(p.x * 4.3 + 9.0, p.y * 4.3, p.z * 4.3) * 2.6 - 1.55)
                        c = mix(c, NACRE if fbm(p.x * 0.9, p.y * 0.9 + 4, p.z * 0.9) > 0.45 else NACRE_PINK, min(0.7, sp))
                    # the old tide line itself: a pale crust
                    crust = smooth(-0.62, -0.12, dt) * smooth(0.2, -0.02, dt) * \
                        (0.5 + 0.5 * fbm(p.x * 3.1 + 9.0, p.y * 3.1, p.z * 3.1))
                    if crust > 0:
                        c = mix(c, mix(NACRE, LICHEN_GREY, 0.35 * fbm(p.x * 5.0, p.y * 5.0, p.z * 5.0)), min(0.82, crust * 1.25))
                    # at and under the standing water: wet, dark, slimed
                    wet = smooth(0.42, -0.05, dw)
                    if wet > 0:
                        c = mix(c, mix(scale(c, 0.42), WETC, 0.5), wet)
                        sl = wet * max(0.0, fbm(p.x * 1.1 + 5.0, p.y * 1.1, p.z * 0.8 + 2.0) * 2.4 - 0.55) * (0.7 + 0.5 * up)
                        c = mix(c, mix(SLIME, SLIME_BRIGHT, fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6) * smooth(-0.5, 0.3, dw)),
                                min(0.85, sl))
                        c = mix(c, SILT, 0.45 * smooth(-0.25, -0.9, dw) * fbm(p.x * 0.7, p.y * 0.7, 3.0))
                    # a green wet lip just over the water
                    lip = smooth(0.75, 0.3, dw) * smooth(0.0, 0.3, dw) * \
                        (0.4 + 0.6 * fbm(p.x * 2.0 + 1.0, p.y * 2.0, p.z * 1.2))
                    c = mix(c, SLIME_BRIGHT, min(0.6, lip * 0.75))
                    # above the old line: lichen, moss on the tops, rain marks
                    dry = smooth(0.2, 1.6, dt)
                    if dry > 0:
                        patch = fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                        m = (0.95 * up + 0.07) * max(0.0, patch * 2.0 - 0.82) * self.moss_k
                        m = min(0.78, m) * dry
                        if m > 0:
                            c = mix(c, mix(MOSS_DEEP, MOSS_BRIGHT, fbm(p.x * 1.9, p.y * 1.9, p.z * 1.9)), m)
                        li = max(0.0, fbm(p.x * 2.1 + 31.0, p.y * 2.1, p.z * 2.1 + 9.0) * 2.4 - 1.4 + 0.16 * up) * dry * (1 - m)
                        if li > 0:
                            lc = LICHEN_OCHRE if fbm(p.x * 0.4, p.y * 0.4 + 50, p.z * 0.4) > 0.7 else LICHEN_PALE
                            c = mix(c, lc, min(0.45, li))
                        rain = (1 - up) * max(0.0, fbm(p.x * 3.3 + 2.0, p.y * 3.3, p.z * 0.35) * 2.2 - 1.2) * dry
                        c = mix(c, scale(c, 0.6), min(0.5, rain))
                    for (q, wid, ln, st) in self.streaks:
                        dz = q.z - p.z
                        if -0.05 < dz < ln:
                            dxy = math.hypot(p.x - q.x, p.y - q.y)
                            wob = wid * (0.7 + 0.7 * fbm(p.x * 3.0, p.y * 3.0, p.z * 0.6)) * (1 + 0.2 * dz)
                            if dxy < wob:
                                k = st * smooth(wob, wob * 0.2, dxy) * (1 - max(0.0, dz) / ln) ** 0.7
                                c = mix(c, mix(SLIME, WETC, fbm(p.x * 4.0, p.y * 4.0, p.z * 1.5)), min(0.85, k))
                    soil = smooth(0.45, 0.0, h) * (0.45 + 0.55 * fbm(p.x * 1.3, p.y * 1.3, 0.0))
                    if soil > 0:
                        c = mix(c, mix(SOIL, SOIL_WET, 0.6 * wet + 0.1), 0.55 * soil)
                elif kind == K_SILVER:
                    v = fbm(p.x * 5.0 + 3.0, p.y * 5.0, p.z * 5.0)
                    c = mix(c, SILVER_DARK, min(0.6, max(0.0, v * 1.9 - 0.6)))
                    c = mix(c, VERDIGRIS, 0.5 * max(0.0, fbm(p.x * 2.2, p.y * 2.2 + 9.0, p.z * 2.2) * 2.2 - 1.2))
                    c = mix(c, mix(scale(c, 0.5), SLIME, 0.4), smooth(0.4, -0.05, dw))
                elif kind == K_LEAF:
                    c = scale(c, (0.82 + 0.34 * fbm(p.x * 0.8, p.y * 0.8, p.z * 0.8)))
                elif kind == K_EARTH:
                    c = scale(c, 0.8 + 0.4 * fbm(p.x * 1.1, p.y * 1.1, 0.0))
                    c = mix(c, SOIL_WET, 0.5 * smooth(0.5, 0.0, dw))
                if ao_face is not None:
                    o = p + (ctr - p) * 0.08 + n * 0.03
                    occ = 0.0
                    for dd in ao_face:
                        hit = bvh.ray_cast(o, dd, ao_dist)
                        if hit[0] is not None:
                            occ += 1.0 - hit[3] / ao_dist
                    ao = 1.0 - occ / len(ao_face)
                    k_ao = {K_LEAF: 0.38, K_FLOWER: 0.15, K_EARTH: 0.4, K_SILVER: 0.5}.get(kind, 0.70)
                    c = scale(c, 1.0 - k_ao * (1.0 - ao) ** 0.85)
                lr, lg, lb = srgb_to_linear((max(0.0, min(1.0, c[0])), max(0.0, min(1.0, c[1])),
                                             max(0.0, min(1.0, c[2]))))
                loop[self.col] = (lr, lg, lb, al if kind == K_GLOW else 1.0)
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


def occluder(pieces, gr, half=40.0, step=1.0):
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
    stone = ec.vertex_color_material('KitStone', rough=0.88)
    stone.use_backface_culling = True
    leaf = ec.vertex_color_material('KitLeaf', rough=0.8)
    leaf.use_backface_culling = False
    glow = ec.vertex_color_material('KitGlow', rough=0.5, emission=4.0)
    glow.use_backface_culling = True
    wet = ec.vertex_color_material('KitWet', rough=0.1)
    wet.use_backface_culling = True
    return [stone, leaf, glow, wet]
