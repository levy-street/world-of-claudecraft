"""The Wildheart Basin kit: every piece of the jungle caldera.

Run (background, one scene):
  blender -b --factory-startup --python build_wildheart_basin_kit.py -- \
      [--preview out.png] [--closeups DIR] [--pieces A,B] [--save out.blend]

Writes wildheart_basin_kit_components.glb next to this file (a full build only;
`--pieces` builds a subset for review renders and writes nothing); the shipping
build (scripts/assets/wildheart_basin_kit/build.mjs) validates, fingerprints and
meshopts it into public/models/props/wildheart_basin_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, see
src/render/wildheart_basin/basin_kit.ts). Game yards, +Z up, front -Y (the
game's +Z after the glTF export), origin at the base centre where the runtime
stands it. Edge pieces run along X with their OUTER (drop) side toward -Y.
Exceptions, by design: Kit_HangingVines hangs from its origin; Kit_PyramidTier
stands with its outer face on the origin line and its body behind it (+Y);
Kit_PyramidCorner has its outer corner on the origin; Kit_VineBridge's origin is
the deck's walking surface; Kit_WaterfallLip's origin is the lip the water
leaves from.

Palette (docs/design/dungeon-rework/wildheart_basin.md, section 7): jade canopy
#3F7D4E, moss #6C8A3A, wet basalt #3A3F3A, sunbone ochre #D9B26A, troll war red
#A3322A, waterfall white-cyan #DDF3F2, warm gold #F0C877; Zulgar's jade spirit
flame #5FE0A0 only as GLOW (the jaguar's eyes). Decoration never out-glows a
telegraph: the glow slot is coals, two eyes and thin gold inlay.

Weathering is per vertex and per face kind (BPiece.finish): stone and bark take
tone drift, rain streaks, damp grime at the foot, cavity darkening and worn
highlights from the local convexity, and jungle moss on the upward faces;
foliage takes a sunlit-top gradient; paint (hides, banners, cloth) keeps its
colour with a light drift only.
"""
import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hckit  # noqa: E402
from hckit import GLOW, STONE, Piece, _fbm, export_kit  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GLASS = hckit.SILK
TAU = math.tau
PI = math.pi

# ---- the jungle caldera palette (sRGB) ------------------------------------------
BASALT = (0.25, 0.27, 0.25)        # wet basalt #3A3F3A (lifted a touch: it reads at range)
BASALT_MID = (0.34, 0.36, 0.33)
BASALT_DRY = (0.47, 0.47, 0.43)
BASALT_DEEP = (0.17, 0.18, 0.17)
LIME = (0.71, 0.68, 0.58)          # the Court colony's limestone
LIME_WARM = (0.77, 0.71, 0.57)
LIME_GREY = (0.58, 0.59, 0.53)
JAG_STONE = (0.74, 0.65, 0.5)      # the jaguar head and the idol: warm weathered limestone
OCHRE = (0.85, 0.7, 0.42)          # sunbone ochre #D9B26A
OCHRE_DARK = (0.66, 0.5, 0.28)
WARRED = (0.64, 0.2, 0.165)        # troll war red #A3322A
WARRED_DARK = (0.42, 0.13, 0.1)
BONE = (0.9, 0.86, 0.74)
BONE_OLD = (0.76, 0.7, 0.56)
BARK = (0.47, 0.43, 0.37)
BARK_DARK = (0.33, 0.29, 0.24)
ROOT = (0.42, 0.35, 0.27)
JADE = (0.247, 0.49, 0.306)        # jade canopy #3F7D4E
JADE_DARK = (0.13, 0.29, 0.17)
JADE_DEEP = (0.09, 0.2, 0.12)
LEAF = (0.32, 0.53, 0.27)
LEAF_LIGHT = (0.45, 0.62, 0.29)
LEAF_YELLOW = (0.6, 0.67, 0.28)
MOSS_GREEN = (0.424, 0.541, 0.227)  # moss #6C8A3A
MOSS_DEEP = (0.29, 0.4, 0.16)
VINE = (0.3, 0.4, 0.17)
VINE_DARK = (0.22, 0.29, 0.13)
THORN = (0.09, 0.08, 0.08)
THORN_RED = (0.24, 0.07, 0.07)
BLOSSOM = (0.8, 0.12, 0.15)
BLOSSOM_PALE = (0.95, 0.72, 0.6)
HIDE = (0.64, 0.5, 0.34)
HIDE_PALE = (0.82, 0.72, 0.54)
BAMBOO = (0.66, 0.6, 0.34)
BAMBOO_DARK = (0.48, 0.43, 0.23)
TIMBER = (0.42, 0.31, 0.21)
ROPE = (0.6, 0.5, 0.31)
FEATHER = (0.16, 0.42, 0.36)
DARK = (0.05, 0.05, 0.045)
MAW_DARK = (0.09, 0.08, 0.07)
SUNLIT = (0.78, 0.8, 0.36)          # the warm top of a leaf in the gold light
# Light (glow slot, read as emissive colour).
GOLD = (0.94, 0.78, 0.47)          # warm gold #F0C877
GOLD_DIM = (0.62, 0.49, 0.26)
EMBER = (1.0, 0.5, 0.18)
EMBER_DIM = (0.55, 0.2, 0.06)
JADE_FLAME = (0.373, 0.878, 0.627)  # Zulgar's spirit flame #5FE0A0
SHEEN = (0.86, 0.95, 0.95)         # waterfall white-cyan #DDF3F2, as a wet sheen

FOLIAGE, PAINT = 1, 2


# ================================================================== the piece
class BPiece(Piece):
    """hckit's Piece with a face KIND (stone, foliage, paint) and the jungle
    weathering in finish()."""

    def __init__(self, name, seed=0, weather=1.0, moss=0.35):
        super().__init__(name, seed=seed, weather=weather, lichen=moss)
        self.kind = self.bm.faces.layers.int.new('kind')
        self.cur = 0

    def _paint(self, faces, color, mat):
        super()._paint(faces, color, mat)
        for f in faces:
            f[self.kind] = self.cur

    @contextmanager
    def as_kind(self, k):
        prev = self.cur
        self.cur = k
        try:
            yield
        finally:
            self.cur = prev

    def smooth(self, faces):
        for f in faces:
            f.smooth = True
        return faces

    def finish(self, materials, parent):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        bm.verts.index_update()
        floor = min(v.co.z for v in bm.verts) if bm.verts else 0.0
        top = max(v.co.z for v in bm.verts) if bm.verts else 1.0
        span = max(0.5, top - floor)
        # Local convexity per vertex: worn highlights on edges, damp in creases.
        conv = [0.0] * len(bm.verts)
        for v in bm.verts:
            if not v.link_edges:
                continue
            mean = Vector()
            length = 0.0
            for e in v.link_edges:
                mean += e.other_vert(v).co
                length += e.calc_length()
            n = len(v.link_edges)
            mean /= n
            length = max(1e-3, length / n)
            conv[v.index] = max(-1.0, min(1.0, (v.co - mean).dot(v.normal) / length * 1.6))
        for face in bm.faces:
            if face.material_index != STONE:
                continue
            kind = face[self.kind]
            n = face.normal
            for loop in face.loops:
                p = loop.vert.co
                r, g, b, _ = loop[self.col]
                height = p.z - floor
                if kind == FOLIAGE:
                    up = n.z * 0.5 + 0.5
                    k = (0.6 + 0.4 * up) * (0.84 + 0.32 * _fbm(p.x * 0.45, p.y * 0.45, p.z * 0.45))
                    h = min(1.0, height / span)
                    sun = max(0.0, n.z) * (0.1 + 0.16 * h) * self.weather
                    r, g, b = r * k, g * k, b * k
                    r += (SUNLIT[0] - r) * sun
                    g += (SUNLIT[1] - g) * sun
                    b += (SUNLIT[2] - b) * sun
                elif kind == PAINT:
                    k = (0.86 + 0.24 * _fbm(p.x * 1.3, p.y * 1.3, p.z * 1.3)) \
                        * (0.8 + 0.2 * min(1.0, height / 1.2))
                    if n.z < -0.3:
                        k *= 0.82
                    r, g, b = r * k, g * k, b * k
                else:
                    under = 0.8 if n.z < -0.3 else 1.0
                    ground = 0.66 + 0.34 * min(1.0, height / 1.8)
                    tone = 0.88 + 0.24 * _fbm(p.x * 0.5, p.y * 0.5, p.z * 0.5)
                    streak = 0.9 + 0.14 * _fbm(p.x * 2.2 + 7.1, p.y * 2.2 - 3.3, p.z * 0.2)
                    c = conv[loop.vert.index]
                    wear = 1.0 + 0.2 * max(0.0, c) - 0.3 * max(0.0, -c)
                    k = ground * under * tone * streak * wear
                    k = 1 - (1 - k) * self.weather
                    patch = _fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                    moss = max(0.0, n.z) ** 0.7 * self.lichen * max(0.0, patch * 1.9 - 0.5)
                    # Moss creeping down the walls in the damp patches.
                    if n.z > -0.25:
                        moss += self.lichen * 0.4 * max(0.0, _fbm(p.x * 0.35 - 3.0, p.y * 0.35, p.z * 0.6) * 2.4 - 1.35)
                    moss = min(0.92, moss)
                    mc = MOSS_GREEN if _fbm(p.x * 1.7, p.y * 1.7, p.z * 1.7) > 0.45 else MOSS_DEEP
                    r, g, b = r * k, g * k, b * k
                    r = r * (1 - moss) + mc[0] * moss * (0.85 + 0.15 * k)
                    g = g * (1 - moss) + mc[1] * moss * (0.85 + 0.15 * k)
                    b = b * (1 - moss) + mc[2] * moss * (0.85 + 0.15 * k)
                # The bmesh colour layer is a BYTE colour, stored in sRGB; the
                # glTF exporter linearizes it. So no conversion here (a second
                # one would crush every dark tone toward black).
                loop[self.col] = (min(1.0, max(0.0, r)), min(1.0, max(0.0, g)), min(1.0, max(0.0, b)), 1.0)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def P(name, **kw):
    return BPiece('Kit_' + name, **kw)


# ============================================================ modelling helpers
def _ring_faces(p, rings, color, mat, smooth, cap0=True, cap1=True):
    before = set(p.bm.faces)
    vs = [[p.bm.verts.new(Vector(c)) for c in ring] for ring in rings]
    n = len(vs[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            f = p.bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            f.smooth = smooth
    if cap0:
        p.bm.faces.new(list(reversed(vs[0])))
    if cap1:
        p.bm.faces.new(vs[-1])
    faces = p._new_faces(before)
    p._paint(faces, color, mat)
    return faces


def _se(a, rx, ry, e):
    c, s = math.cos(a), math.sin(a)
    return (rx * math.copysign(abs(c) ** (2 / e), c), ry * math.copysign(abs(s) ** (2 / e), s))


def loft_y(p, sections, sides, color, mat=STONE, smooth=True, jitter=0.0, phase=0.0, freq=0.25):
    """A solid lofted along Y through superellipse rings (y, cx, cz, rx, rz, e)
    in the XZ plane: muzzles, jaws, crania, palates."""
    rings = []
    for (y, cx, cz, rx, rz, e) in sections:
        ring = []
        for i in range(sides):
            dx, dz = _se(phase + TAU * i / sides, rx, rz, e)
            k = 1.0
            if jitter:
                k = 1 + jitter * (_fbm((cx + dx) * freq, y * freq, (cz + dz) * freq) - 0.5) * 2
            ring.append((cx + dx * k, y, cz + dz * k))
        rings.append(ring)
    return _ring_faces(p, rings, color, mat, smooth)


def loft_z(p, sections, sides, color, mat=STONE, smooth=True, jitter=0.0, phase=0.0, freq=0.2):
    """A solid lofted up Z through superellipse rings (z, cx, cy, rx, ry, e)."""
    rings = []
    for (z, cx, cy, rx, ry, e) in sections:
        ring = []
        for i in range(sides):
            dx, dy = _se(phase + TAU * i / sides, rx, ry, e)
            k = 1.0
            if jitter:
                k = 1 + jitter * (_fbm((cx + dx) * freq, (cy + dy) * freq, z * freq) - 0.5) * 2
            ring.append((cx + dx * k, cy + dy * k, z))
        rings.append(ring)
    return _ring_faces(p, rings, color, mat, smooth)


def hexcol(p, x, y, z0, h, r, color, joints=1, lean=(0.0, 0.0), phase=PI / 6, vary=0.06):
    """A basalt column: a hexagonal prism in drums with chamfered joints."""
    mark = p.mark()
    drums = joints + 1
    dh = h / drums
    for i in range(drums):
        z = i * dh
        ch = min(0.22, dh * 0.08, r * 0.18)
        p.lathe((0, 0, z), [(r * 0.93, 0), (r, ch), (r, dh - ch), (r * 0.9, dh)], 6,
                p.vary(color, vary), phase=phase, smooth=False)
    p.turn(mark, Matrix.Translation((x, y, z0)) @ Matrix.Rotation(lean[0], 4, 'X') @ Matrix.Rotation(lean[1], 4, 'Y'))


def blade(p, pts, widths, color, thick=0.05, vfold=0.12, up_hint=(0, 0, 1)):
    """A leaf, frond or cloth strip: a closed diamond section along a midrib
    (both faces lit), folded into a shallow V along the rib."""
    pts = [Vector(c) for c in pts]
    n = len(pts)
    before = set(p.bm.faces)
    up0 = Vector(up_hint)
    rings = []
    for i, c in enumerate(pts):
        ahead = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        if ahead.length < 1e-6:
            ahead = Vector((1, 0, 0))
        ahead.normalize()
        side = ahead.cross(up0)
        if side.length < 1e-4:
            side = ahead.cross(Vector((0, 1, 0)))
        side.normalize()
        up = side.cross(ahead).normalized()
        w = widths[i]
        rings.append([
            p.bm.verts.new(c - side * w - up * w * vfold),
            p.bm.verts.new(c + up * thick),
            p.bm.verts.new(c + side * w - up * w * vfold),
            p.bm.verts.new(c - up * thick),
        ])
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            p.bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    p.bm.faces.new(list(reversed(rings[0])))
    p.bm.faces.new(rings[-1])
    faces = p._new_faces(before)
    p._paint(faces, color, STONE)
    return faces


def frond(p, base, yaw, length, rise, droop, width, color, segs=9, serrate=True, thick=0.045, curl=0.0):
    """An arching frond: up from the base, out along `yaw`, drooping at the tip."""
    d = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-math.sin(yaw), math.cos(yaw), 0))
    base = Vector(base)
    pts = []
    widths = []
    for i in range(segs + 1):
        t = i / segs
        h = rise * math.sin(PI * t * 0.85) - droop * t * t
        pts.append(base + d * (length * t) + Vector((0, 0, h)) + side * (curl * t * t * length))
        w = width * math.sin(PI * min(1.0, t * 1.12 + 0.03)) ** 0.75
        if serrate and 0 < i < segs and i % 2 == 1:
            w *= 0.42
        widths.append(max(0.01, w))
    with p.as_kind(FOLIAGE):
        return blade(p, pts, widths, color, thick=thick)


def fern_tuft(p, center, radius, count, color, rise=None, yaw0=0.0):
    """A ring of fronds round a centre: ferns on ledges, under trees, on tops."""
    for k in range(count):
        yaw = yaw0 + TAU * k / count + p.rng.uniform(-0.25, 0.25)
        length = radius * p.rng.uniform(0.75, 1.1)
        frond(p, center, yaw, length, (rise or radius * 0.55) * p.rng.uniform(0.8, 1.2), radius * 0.7,
              radius * 0.16, p.vary(color, 0.12), segs=7)


def blob(p, center, size, color, subdivisions=1, jitter=0.2, flat=False, fronds=6, lumps=5):
    """A canopy mass: a faceted cauliflower of leafy lumps (never one smooth
    balloon), the lighter lumps on top, fronds drooping off its rim. `flat`
    makes one broad low lump (a skirt that knits neighbours together)."""
    cx, cy, cz = center
    sx, sy, sz = size
    with p.as_kind(FOLIAGE):
        if flat:
            return p.rock(center, size, color, jitter=jitter, subdivisions=subdivisions, flat_bottom=True)
        p.rock((cx, cy, cz), (sx * 0.72, sy * 0.72, sz * 0.8), p.vary(color, 0.06), jitter=jitter,
               subdivisions=subdivisions, flat_bottom=True)
        for k in range(lumps):
            a = TAU * k / lumps + p.rng.uniform(-0.4, 0.4)
            rr = p.rng.uniform(0.24, 0.34)
            up = p.rng.uniform(-0.1, 0.28)
            s = p.rng.uniform(0.42, 0.56)
            tone = LEAF_LIGHT if up > 0.15 else color
            p.rock((cx + math.cos(a) * sx * rr, cy + math.sin(a) * sy * rr, cz + sz * up),
                   (sx * s, sy * s, sz * s * 1.1), p.vary(tone if p.rng.random() < 0.5 else color, 0.08),
                   jitter=jitter, subdivisions=subdivisions)
        p.rock((cx + sx * 0.05, cy - sy * 0.05, cz + sz * 0.38), (sx * 0.42, sy * 0.42, sz * 0.5),
               p.vary(LEAF_LIGHT, 0.08), jitter=jitter, subdivisions=subdivisions)
    for k in range(fronds):
        a = TAU * k / max(1, fronds) + p.rng.uniform(-0.3, 0.3)
        base = (cx + math.cos(a) * sx * 0.38, cy + math.sin(a) * sy * 0.38, cz - sz * 0.05)
        frond(p, base, a, sx * 0.28, sz * 0.1, sz * 0.4, sx * 0.07, p.vary(LEAF, 0.12), segs=5)
    return None


def vine(p, top, length, sway, r, color=VINE, leaves=6, phase=0.0, leaf_color=LEAF):
    """A hanging vine from `top`, swaying in a slow S, leaves along it."""
    top = Vector(top)
    pts = []
    steps = 8
    for i in range(steps + 1):
        t = i / steps
        pts.append(top + Vector((math.sin(phase + t * 3.0) * sway * t, math.cos(phase + t * 2.3) * sway * 0.5 * t,
                                 -length * t)))
    with p.as_kind(FOLIAGE):
        p.sweep(pts, r, r * 0.6, p.vary(color, 0.1), sides=4)
    for k in range(leaves):
        t = (k + 0.6) / (leaves + 0.6)
        i = min(steps - 1, int(t * steps))
        c = pts[i].lerp(pts[i + 1], t * steps - i)
        yaw = phase + k * 2.4
        frond(p, c, yaw, 0.55 + p.rng.random() * 0.35, 0.1, 0.35, 0.16, p.vary(leaf_color, 0.15), segs=3,
              serrate=False, thick=0.025)


def root(p, pts, r0, r1, color=ROOT, sides=7):
    """A strangler or buttress root along a path (bark weathering, mossy tops),
    smooth shaded so it reads as wood, not as a beam."""
    return p.smooth(p.sweep(pts, r0, r1, p.vary(color, 0.08), sides=sides))


def lashing(p, center, axis, r, color=ROPE, turns=3, gap=0.1):
    """Rope turns round a pole or bone."""
    ax = Vector(axis).normalized()
    c = Vector(center)
    for i in range(turns):
        off = ax * ((i - (turns - 1) / 2) * gap)
        p.prism(c + off, 7, r * 1.22, r * 1.22, 0.07, p.vary(color, 0.08), axis=tuple(ax))


def horned_skull(p, pos, size, yaw=0.0, horn=BONE_OLD):
    """A great beast skull with swept horns (the Sunbone's trophies)."""
    pos = Vector(pos)
    mark = p.mark()
    p.skull((0, 0, 0), size, color=BONE)
    p.box((0, -size * 0.85, size * 0.25), (size * 0.5, size * 0.9, size * 0.32), BONE_OLD, taper=0.8)
    for s in (-1, 1):
        p.sweep([(s * size * 0.45, 0, size * 0.75), (s * size * 1.2, size * 0.1, size * 1.0),
                 (s * size * 1.7, -size * 0.2, size * 1.6), (s * size * 1.55, -size * 0.55, size * 2.2)],
                size * 0.2, size * 0.03, horn, sides=6)
    p.turn(mark, Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Z'))


def paint_band(p, center, size, color=WARRED, yaw=0.0, roll=0.0, pitch=0.0):
    """A stroke of troll paint on stone or wood (paint kind keeps its colour)."""
    with p.as_kind(PAINT):
        p.box(center, size, p.vary(color, 0.06), yaw=yaw, roll=roll, pitch=pitch)


def blossom(p, pos, size, color=BLOSSOM, petals=5, tilt=0.4):
    """A five-petal flower facing up and out."""
    pos = Vector(pos)
    with p.as_kind(PAINT):
        for k in range(petals):
            a = TAU * k / petals
            p.box(pos + Vector((math.cos(a) * size * 0.5, math.sin(a) * size * 0.5, 0)),
                  (size * 0.7, size * 0.45, size * 0.08), p.vary(color, 0.08), yaw=a, roll=-tilt)
        p.rock(pos + Vector((0, 0, size * 0.08)), (size * 0.35, size * 0.35, size * 0.3), OCHRE, jitter=0.05,
               subdivisions=1)


def bromeliad(p, pos, size):
    """An epiphyte rosette on a branch, a red heart."""
    pos = Vector(pos)
    for k in range(7):
        yaw = TAU * k / 7
        frond(p, pos, yaw, size, size * 0.6, size * 0.4, size * 0.16, p.vary(LEAF_LIGHT, 0.1), segs=3,
              serrate=False, thick=0.03)
    with p.as_kind(PAINT):
        p.rock(pos + Vector((0, 0, size * 0.25)), (size * 0.35, size * 0.35, size * 0.55), BLOSSOM, jitter=0.1,
               subdivisions=1)


def sun_disc(p, center, radius, axis=(0, -1, 0), stone=LIME_WARM, inlay=None):
    """A carved sun: a raised disc, a ring of rays, a boss (inlay may be GLOW)."""
    ax = Vector(axis).normalized()
    c = Vector(center)
    p.prism(c, 20, radius, radius, radius * 0.18, p.vary(stone, 0.04), axis=tuple(ax))
    p.prism(c + ax * radius * 0.18, 20, radius * 0.66, radius * 0.66, radius * 0.1, p.vary(OCHRE_DARK, 0.04),
            axis=tuple(ax))
    p.prism(c + ax * radius * 0.28, 12, radius * 0.3, radius * 0.24, radius * 0.12,
            inlay or p.vary(stone, 0.04), mat=GLOW if inlay else STONE, axis=tuple(ax))
    # Rays in the disc's plane.
    rot = ax.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    for k in range(10):
        a = TAU * k / 10
        mark = p.mark()
        p.box((0, radius * 1.18, radius * 0.05), (radius * 0.26, radius * 0.42, radius * 0.16),
              p.vary(stone, 0.05), taper=0.4)
        p.turn(mark, Matrix.Translation(c) @ rot @ Matrix.Rotation(a, 4, 'Z'))


def jaguar_mask(p, center, w, color=LIME, yaw=0.0, paint=True):
    """A carved jaguar mask relief facing -Y: brow, eyes, muzzle, fangs."""
    c = Vector(center)
    mark = p.mark()
    p.box((0, 0, w * 0.32), (w, w * 0.3, w * 0.22), p.vary(color, 0.05), bevel=w * 0.03, taper=0.85)
    for s in (-1, 1):
        p.box((s * w * 0.24, -w * 0.12, w * 0.12), (w * 0.26, w * 0.1, w * 0.14), DARK)
        p.box((s * w * 0.3, -w * 0.05, w * 0.24), (w * 0.34, w * 0.18, w * 0.08), p.vary(color, 0.05),
              roll=s * 0.25)
    p.box((0, -w * 0.08, -w * 0.12), (w * 0.62, w * 0.34, w * 0.36), p.vary(color, 0.05), bevel=w * 0.03,
          taper=0.8)
    p.box((0, -w * 0.27, -w * 0.02), (w * 0.24, w * 0.08, w * 0.12), DARK)
    for s in (-1, 1):
        p.spike((s * w * 0.18, -w * 0.22, -w * 0.28), w * 0.05, w * 0.2, BONE_OLD, sides=4, lean=(0, 0))
        p.box((s * w * 0.18, -w * 0.25, -w * 0.33), (w * 0.08, w * 0.06, w * 0.2), BONE_OLD, taper=0.3,
              pitch=PI)
    if paint:
        paint_band(p, (0, -w * 0.16, w * 0.32), (w * 0.9, w * 0.02, w * 0.05), WARRED)
    p.turn(mark, Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, 'Z'))


# ================================================================= hero pieces
def jaguar_head():
    """HERO: the colossal stone jaguar carved into the north rim behind the
    shrine terrace, 70 yd tall, its maw roaring open toward the terrace: one
    sculpted mass (jaguar_head_sculpt.py: a great cat's skull with sharp
    cheekbones, a brow driven down in fury, crossed fangs, snarl furrows, carved
    rosettes and cheek scrolls, eroded, cracked and chipped), the Sunbone's ochre
    and war red on its brow and cheeks, the jungle reclaiming it (roots down its
    cheeks, moss on every ledge, vines from its jaws). Its eyes are a separate
    node (Kit_JaguarEyes) the render lights during the hunt. Origin at the
    head's base; the plinth runs 60 yd down into the rim so it never floats."""
    import numpy as np  # Blender's bundled numpy

    import jaguar_head_sculpt as js

    p = P('JaguarHead', moss=0.5, seed=3)
    S = JAG_STONE
    # The rim it is carved from: rough basalt and rubble under and behind it.
    loft_z(p, [(-64, 0, 6, 40, 30, 2.2), (-48, 0, 5, 39, 29, 2.2), (-30, 0, 6, 37, 28, 2.2), (-12, 0, 5, 34, 25, 2.3),
               (2, 0, 6, 30, 22, 2.4), (6, 0, 10, 26, 18, 2.4)], 26, BASALT_MID, smooth=False, jitter=0.32,
           freq=0.12)
    for i in range(22):
        a = -PI + PI * (i + p.rng.uniform(0.1, 0.9)) / 22
        r = p.rng.uniform(26, 36)
        hexcol(p, math.cos(a) * r, math.sin(a) * r * 0.75 + 4, -62, p.rng.uniform(30, 66), p.rng.uniform(2.0, 4.0),
               p.vary(BASALT if i % 3 else BASALT_MID, 0.1), joints=4,
               lean=(p.rng.uniform(-0.05, 0.05), p.rng.uniform(-0.05, 0.05)), phase=p.rng.uniform(0, 1))
    for k in range(6):
        a = -PI + PI * (k + 0.5) / 6
        fern_tuft(p, (math.cos(a) * 30, math.sin(a) * 22 + 4, p.rng.uniform(-24, -4)), 3.0, 7, LEAF)
    # The sculpted head, as plain faces with a colour each.
    field = js.build_field()
    verts, faces = js.mesh_field(field, bpy)
    bm = p.bm
    vs = [bm.verts.new(Vector(v)) for v in verts]
    made = []
    for f in faces:
        try:
            made.append(bm.faces.new([vs[i] for i in f]))
        except ValueError:
            pass
    bm.normal_update()
    centres = np.array([tuple(f.calc_center_median()) for f in made])
    normals = np.array([tuple(f.normal) for f in made])
    kinds = js.face_kinds(field, centres, normals)
    colors = {
        'stone': S, 'throat': MAW_DARK, 'tooth': BONE_OLD, 'tongue': WARRED_DARK,
        'leather': BASALT_DEEP, 'lip': BASALT_DEEP, 'ochre': OCHRE, 'red': WARRED, 'rosette': BASALT_MID,
    }
    tone = js.Noise(23)
    for f, kind in zip(made, kinds):
        f.smooth = True
        c = colors[kind]
        if kind == 'stone':
            q = f.calc_center_median()
            k = 0.93 + 0.12 * float(tone.fbm(q.x * 0.06, q.y * 0.06, q.z * 0.06, 2))
            c = tuple(max(0.0, min(1.0, ch * k)) for ch in c)
        if kind in ('ochre', 'red'):
            with p.as_kind(PAINT):
                p._paint([f], c, STONE)
        else:
            p._paint([f], c, STONE)
    # The Court's sun on the brow, the sigil the trolls painted over.
    brow = field.snap([(0.0, -12.0, 63.0)], lift=0.15)[0]
    axis = field.gradient(np.array([brow]))[0]
    sun_disc(p, tuple(brow), 4.4, axis=tuple(axis))

    def on_surface(pts, lift):
        # Densify the path first, so a root hugs the carving between its marks.
        dense = []
        for i in range(len(pts) - 1):
            for t in (0.0, 0.25, 0.5, 0.75):
                dense.append(tuple(pts[i][k] + (pts[i + 1][k] - pts[i][k]) * t for k in range(3)))
        dense.append(tuple(pts[-1]))
        return [tuple(q) for q in field.snap(dense, lift=lift, steps=10)]

    # The jungle taking it back: roots down the cheeks, vines from the jaws and
    # the brow, ferns along the ledges.
    for s in (-1, 1):
        for k in range(3):
            y0 = -4 + k * 8
            pts = [(s * (6 + k * 5), y0 + 4, 69), (s * (15 + k * 2), y0 + 4, 64), (s * (21 + k * 0.6), y0 + 1, 52),
                   (s * (23 + k * 0.4), y0 - 1, 36), (s * (24 + k), y0 + 2, 18), (s * (25 + k * 2), y0, 4)]
            root(p, on_surface(pts, 0.9 - k * 0.15) + [(s * (32 + k * 2), y0 + 3, -10)], 1.3 - k * 0.2, 0.9, ROOT)
        for k in range(4):
            top = on_surface([(s * (4 + k * 3.4), -23.0 + k * 0.4, 29.2)], 0.2)[0]
            vine(p, top, 6 + k * 2.2, 0.8, 0.14, phase=k * 1.3 + s, leaves=5)
            top = on_surface([(s * (6 + k * 4.2), -17.0 + k * 0.6, 55.0)], 0.2)[0]
            vine(p, top, 4 + k * 1.6, 0.6, 0.12, phase=k * 0.7, leaves=4)
        fern_tuft(p, on_surface([(s * 13, -13.0, 59.0)], 0.1)[0], 2.6, 7, LEAF)
        fern_tuft(p, on_surface([(s * 14, 2, 70.0)], 0.1)[0], 2.6, 7, LEAF_LIGHT)
        fern_tuft(p, on_surface([(s * 15, -21.0, 41.0)], 0.1)[0], 2.0, 6, LEAF)
    fern_tuft(p, on_surface([(0, 6, 70.0)], 0.1)[0], 3.4, 9, LEAF)
    blob(p, on_surface([(12, 16, 66)], 1.0)[0], (12, 10, 6), JADE)
    blob(p, on_surface([(-13, 18, 65)], 1.0)[0], (10, 9, 5), JADE_DARK)
    return p


def jaguar_eyes():
    """The jaguar head's eyes (glow, its own node): almond lenses in the
    sockets with slit pupils. Placed with the head's transform; the render
    drives their burn."""
    p = P('JaguarEyes', moss=0.0)
    for s in (-1, 1):
        mark = p.mark()
        # Narrow almonds, slanting up and out: a hunter's glare, not an owl's.
        p.rock((0, 0, 0), (8.4, 1.8, 3.6), JADE_FLAME, mat=GLOW, jitter=0.0, subdivisions=2)
        p.box((0, -0.86, 0), (0.9, 0.3, 3.2), (0.04, 0.12, 0.08), mat=GLOW, taper=0.35)
        p.turn(mark, Matrix.Translation((s * 12, -13.4, 49.2)) @ Matrix.Rotation(-s * 0.3, 4, 'Y'))
    return p


def idol_maw():
    """The inside of the Sunken Idol's jaw round the landing: the palate
    overhead with its fangs (every tip at least 9.5 yd up), the cheeks and
    molars plunging into the south wall outside the landing's disc, the dark
    throat the party walks out of, and the idol's carved face above, seen from
    across the caldera. Origin on the landing floor; front (-Y) north."""
    p = P('IdolMaw', moss=0.55, seed=5)
    S = LIME_GREY
    # The palate slab and its ridges, resting on the two pylons (top 14).
    loft_y(p, [(12, 0, 19, 19.5, 5, 3.0), (2, 0, 19, 19.0, 5, 3.0), (-8, 0, 19.2, 17.5, 4.8, 3.0),
               (-12.5, 0, 19.4, 15.5, 4.2, 3.0)], 22, p.vary(S, 0.03))
    for k in range(5):
        p.box((0, 8 - k * 4.2, 13.9), (22 - k * 1.2, 1.2, 0.7), WARRED_DARK, bevel=0.2)
    # The upper face of the idol over the maw (the outside, seen from the caldera).
    loft_y(p, [(12, 0, 34, 21, 12, 2.4), (2, 0, 34, 21.5, 12.5, 2.4), (-6, 0, 33, 20, 11.5, 2.5),
               (-10.5, 0, 32, 18, 10, 2.6)], 22, S)
    loft_y(p, [(12, 0, 52, 19, 9, 2.2), (2, 0, 52, 20, 10, 2.2), (-5, 0, 51, 18.5, 9, 2.3),
               (-8.5, 0, 50, 15.5, 7.5, 2.4)], 22, p.vary(S, 0.03))
    for s in (-1, 1):
        # Stone eyes under a heavy brow, blind and mossed (no glow: the idol sleeps).
        p.box((s * 8.5, -9.6, 47), (9, 3, 5.4), MAW_DARK)
        p.smooth(p.rock((s * 8.5, -10.4, 46.8), (7.4, 2.0, 4.0), p.vary(S, 0.05), jitter=0.04, subdivisions=2))
        p.box((s * 9, -11.4, 51.2), (11, 4, 3), p.vary(S, 0.04), bevel=0.5, roll=-s * 0.18)
        p.box((s * 3.4, -11.6, 38.6), (3.4, 1.2, 2.2), DARK)
        with p.as_kind(PAINT):
            p.box((s * 8.5, -12.0, 43.2), (9, 0.8, 0.8), OCHRE)
    p.box((0, -10.6, 39.6), (12, 4, 6), p.vary(S, 0.04), bevel=0.6, taper=0.7)
    # A stepped crown along its brow.
    for k in range(7):
        x = -12 + k * 4
        p.box((x, -4, 60.5 + (1.2 if k % 2 else 0)), (3.4, 6, 3.6 + (2.4 if k % 2 else 0)), p.vary(S, 0.05),
              bevel=0.3)
    sun_disc(p, (0, -6.8, 57.5), 3.4, axis=(0, -1, 0.3))
    # Fangs along the palate's front edge; side fangs over the void.
    for s in (-1, 1):
        p.sweep([(s * 11.5, -11.2, 15.0), (s * 11.8, -11.8, 12.6), (s * 11.4, -11.4, 10.6), (s * 11.0, -11.0, 9.6)],
                1.6, 0.1, BONE_OLD, sides=8)
        for k in range(3):
            x = s * (1.6 + k * 3.0)
            p.sweep([(x, -11.6, 14.6), (x, -12.0, 13.2), (x, -11.8, 12.2)], 0.8, 0.08, BONE_OLD, sides=6)
        for k in range(4):
            y = -7 + k * 4.5
            p.sweep([(s * 17.2, y, 15.0), (s * 17.0, y - 0.4, 12.6), (s * 16.6, y, 11.0)], 1.0, 0.08, BONE_OLD,
                    sides=6)
        # Lower canines rising out of the cliff outside the landing's rim.
        p.sweep([(s * 15.2, -10.6, -4), (s * 15.4, -11.4, 2), (s * 15.0, -11.2, 6.0), (s * 14.6, -10.8, 7.4)],
                1.4, 0.1, BONE_OLD, sides=8)
        for k in range(3):
            y = -6 + k * 4.2
            p.box((s * 16.6, y, 0.6), (1.6, 2.8, 2.6), BONE_OLD, taper=0.4, bevel=0.15)
        # The cheeks: carved masonry jowls on a basalt foot that plunges into
        # the south wall (outside the landing's disc).
        loft_z(p, [(-70, s * 26, 4, 11, 17, 2.2), (-34, s * 25, 4, 10, 16, 2.2), (-8, s * 24.5, 3, 9, 15, 2.3),
                   (-1, s * 24, 2, 8, 14, 2.4)], 16, BASALT_MID, jitter=0.22, freq=0.15)
        for k in range(9):
            hexcol(p, s * (16.5 + (k % 3) * 2.4 + p.rng.uniform(-0.4, 0.4)), -10 + (k // 3) * 3.4 + p.rng.uniform(-0.5, 0.5),
                   -70, 69.0 + p.rng.uniform(-3.0, -0.6), p.rng.uniform(1.3, 1.7), BASALT, joints=5)
        loft_z(p, [(-1.5, s * 22, 1, 6.5, 12.5, 3.2), (14, s * 21.5, 1.5, 6.0, 12, 3.2), (24, s * 21, 3, 6.4, 11, 3.0),
                   (34, s * 20, 4, 5.0, 9, 2.6)], 16, p.vary(S, 0.04))
        for k in range(6):
            z = 1.5 + k * 3.6
            p.box((s * 15.8, -1 + k * 0.1, z), (0.3, 22, 0.25), p.vary(LIME_GREY, 0.08))
        mark = p.mark()
        pts = []
        for i in range(22):
            t = i / 21
            a = PI * 0.5 + t * TAU * 1.3
            rr = 4.2 * (1 - t * 0.78)
            pts.append((0, math.cos(a) * rr, math.sin(a) * rr))
        p.sweep(pts, 0.7, 0.35, p.vary(LIME_WARM, 0.04), sides=6)
        p.turn(mark, Matrix.Translation((s * 27.6, -2, 22)))
        p.box((s * 19.2, -2, 1.0), (3.4, 18, 2.2), p.vary(S, 0.04), bevel=0.3)
        paint_band(p, (s * 18.9, -11.2, 1.6), (3.2, 0.4, 1.2), WARRED)
        # Vines curtaining the cheeks and the palate's lip.
        for k in range(4):
            vine(p, (s * (13 + k * 1.6), -12.6 + k * 1.2, 15.2), 2.6 + k * 0.9, 0.4, 0.1, phase=k + s, leaves=3)
        for k in range(3):
            vine(p, (s * (25 + k), -6 + k * 5, 30), 20 + k * 6, 1.2, 0.16, phase=k * 0.8, leaves=8)
        fern_tuft(p, (s * 14, -8, 24.3), 2.4, 7, LEAF)
        fern_tuft(p, (s * 9, -9, 42.4), 1.8, 6, LEAF_LIGHT)
    # The chin under the landing (below its floor: it carries the lip) and
    # the head's mass behind the mouth, and the mouth's inner walls.
    loft_y(p, [(16, 0, -16, 24, 13, 2.4), (2, 0, -15, 25, 13, 2.4), (-10, 0, -16, 21, 11, 2.4),
               (-15, 0, -18, 15, 8, 2.4)], 22, p.vary(S, 0.03), jitter=0.05)
    for k in range(5):
        p.box((-10 + k * 5, -14.6, -10.5), (3.6, 1.6, 2.4), p.vary(LIME_WARM, 0.05), bevel=0.3, taper=0.8,
              pitch=PI)
    loft_y(p, [(17, 0, 24, 31, 40, 2.6), (24, 0, 25, 31, 41, 2.6), (34, 0, 26, 28, 38, 2.4)], 24,
           p.vary(S, 0.03), jitter=0.06)
    for s in (-1, 1):
        p.box((s * 12.5, 10.5, 2.0), (7.5, 13.5, 24.0), p.vary(LIME_GREY, 0.04))
        for k in range(4):
            p.box((s * 8.9, 4.6 + k * 3.2, 0.9), (1.2, 2.6, 2.2), BONE_OLD, taper=0.5, bevel=0.12)
            p.box((s * 8.9, 4.6 + k * 3.2, 13.1), (1.2, 2.6, 2.0), BONE_OLD, taper=0.5, bevel=0.12, pitch=PI)
    # The throat: a dark passage back into the idol under a carved arch.
    p.box((0, 15.5, 6.5), (13.5, 2.0, 13), MAW_DARK)
    for s in (-1, 1):
        p.box((s * 8.2, 13.0, 6.5), (2.6, 4.0, 13), p.vary(LIME, 0.04), bevel=0.2)
    p.voussoir_arch(13.6, 9.8, 3.6, 1.2, 4.0, LIME, pointed=False, blocks=11, center=(0, 13.0, 0))
    paint_band(p, (0, 10.9, 14.6), (9, 0.4, 0.8), OCHRE)
    blob(p, (-6, 4, 63.8), (10, 9, 4), JADE)
    blob(p, (9, 6, 63.4), (8, 8, 3.5), JADE_DARK)
    return p


def maw_pylon():
    """A carved pylon under the idol's palate (14 yd, collider r 2.2): plinth,
    talud-tablero bands, a jaguar mask, glyph panels, a corbelled capital."""
    p = P('MawPylon', moss=0.45)
    S = LIME
    p.box((0, 0, 0.6), (3.6, 3.6, 1.2), p.vary(LIME_GREY), bevel=0.12)
    p.box((0, 0, 1.6), (3.2, 3.2, 0.8), p.vary(S), bevel=0.1, taper=0.9)
    p.box((0, 0, 7.2), (2.6, 2.6, 10.4), p.vary(S, 0.04), bevel=0.14)
    for z in (3.2, 9.0):
        p.box((0, 0, z), (3.0, 3.0, 0.5), p.vary(LIME_WARM), bevel=0.06)
    for k, (x, y, yaw) in enumerate(((0, -1.32, 0.0), (1.32, 0, PI / 2), (0, 1.32, PI), (-1.32, 0, -PI / 2))):
        mark = p.mark()
        if k == 0:
            jaguar_mask(p, (0, -0.1, 6.1), 2.2, S)
        else:
            for j in range(3):
                p.box((0, -0.05, 4.4 + j * 1.45), (1.5, 0.2, 1.05), p.vary(LIME_GREY, 0.05), bevel=0.05)
                p.box((0, -0.12, 4.4 + j * 1.45), (0.6, 0.12, 0.45), OCHRE_DARK if j % 2 else BASALT_MID)
        paint_band(p, (0, -0.08, 10.4), (2.4, 0.08, 0.3), WARRED)
        p.turn(mark, Matrix.Translation((x, y, 0)) @ Matrix.Rotation(yaw, 4, 'Z'))
    p.box((0, 0, 12.6), (3.2, 3.2, 0.8), p.vary(LIME_WARM), bevel=0.08)
    p.box((0, 0, 13.5), (3.8, 3.8, 1.0), p.vary(S), bevel=0.1)
    root(p, [(1.2, 1.2, 14), (1.5, 1.4, 10), (1.4, 1.45, 6), (1.5, 1.5, 2.5), (1.65, 1.6, 0.2)], 0.26, 0.2)
    root(p, [(-1.3, 1.25, 13.8), (-1.42, 1.2, 9), (-1.42, 1.42, 4), (-1.6, 1.6, 0.2)], 0.22, 0.16)
    fern_tuft(p, (0.6, 1.4, 14.0), 1.2, 5, LEAF)
    return p


# ============================================================== the pyramid
TIER_H = 12.0
TIER_LEN = 8.0
TIER_DEPTH = 6.0


def pyramid_tier():
    """One 8 yd bay of a stepped-pyramid tier (12 yd tall, 6 deep): a sloping
    talud of coursed blocks, a framed tablero with a sun disc and a jaguar mask
    in its panels, a two-step cornice, moss and roots over the lip. Outer face
    on the origin line (-Y outward), body behind it (+Y); tiles along X."""
    p = P('PyramidTier', moss=0.55)
    half = TIER_LEN / 2
    p.box((0, 3.7, 6.0), (TIER_LEN, 4.6, 12.0), p.vary(LIME_GREY, 0.03))
    mark = p.mark()
    p.masonry(-half, half, 0.0, 3.6, 1.0, 1.2, LIME, y=0.5, bevel=False, mortar=0.07)
    p.turn(mark, Matrix(((1, 0, 0, 0), (0, 1, 0.38, 0), (0, 0, 1, 0), (0, 0, 0, 1))))
    # The tablero: its frame proud of the recessed panels.
    p.box((0, 1.1, 3.9), (TIER_LEN, 1.2, 0.6), p.vary(LIME_WARM, 0.04), bevel=0.05)
    p.box((0, 1.1, 10.2), (TIER_LEN, 1.2, 0.6), p.vary(LIME_WARM, 0.04), bevel=0.05)
    for x in (-half + 0.3, 0.0, half - 0.3):
        p.box((x, 1.1, 7.05), (0.6, 1.2, 5.7), p.vary(LIME_WARM, 0.04), bevel=0.05)
    p.box((0, 1.55, 7.05), (TIER_LEN - 0.4, 0.3, 5.8), p.vary(LIME_GREY, 0.05))
    sun_disc(p, (-2.0, 1.35, 7.0), 1.5, axis=(0, -1, 0), stone=LIME_WARM)
    jaguar_mask(p, (2.0, 1.25, 7.4), 2.6, LIME)
    # Faded troll paint over the Court's carving.
    paint_band(p, (0, 0.47, 3.9), (TIER_LEN * 0.92, 0.04, 0.32), WARRED)
    paint_band(p, (-2.0, 0.6, 9.6), (2.6, 0.04, 0.22), OCHRE)
    # The cornice.
    p.box((0, 3.05, 11.0), (TIER_LEN + 0.02, 5.9, 1.0), p.vary(LIME, 0.04), bevel=0.08)
    p.box((0, 3.3, 11.8), (TIER_LEN + 0.02, 5.4, 0.6), p.vary(LIME_WARM, 0.04), bevel=0.06)
    # The jungle on the step: moss mats, fern tufts, a root over the lip.
    fern_tuft(p, (p.rng.uniform(-3, 3), 3.2, 12.1), 1.3, 4, p.vary(LEAF, 0.1))
    x = p.rng.uniform(-3, 3)
    root(p, [(x, 4.0, 12.2), (x + 0.3, 0.6, 12.1), (x + 0.4, -0.1, 11.0), (x + 0.2, 0.3, 8.0),
             (x - 0.2, 0.5, 4.5)], 0.22, 0.1, sides=5)
    vine(p, (x + 1.4, 0.1, 11.4), 6.5, 0.4, 0.1, phase=1.2, leaves=3)
    return p


def pyramid_corner():
    """A tier's corner ornament: a stacked-mask pilaster and a jaguar head
    gargoyle at the cornice. Outer corner on the origin; outer faces -X and -Y;
    the corner's diagonal points (-1, -1)."""
    p = P('PyramidCorner', moss=0.5)
    p.box((1.1, 1.1, 6.1), (2.3, 2.3, 12.2), p.vary(LIME, 0.04), bevel=0.1)
    for k in range(3):
        z = 3.2 + k * 3.0
        p.box((1.05, 1.05, z), (2.5, 2.5, 0.4), p.vary(LIME_WARM, 0.04), bevel=0.05)
        mark = p.mark()
        jaguar_mask(p, (0, 0, 0), 1.8, LIME_WARM, paint=k == 1)
        p.turn(mark, Matrix.Translation((-0.05, -0.05, z + 1.5)) @ Matrix.Rotation(-PI / 4, 4, 'Z'))
    mark = p.mark()
    loft_y(p, [(0.8, 0, 0, 1.1, 0.9, 2.6), (-1.0, 0, -0.1, 0.9, 0.75, 2.8), (-1.9, 0, -0.1, 0.6, 0.5, 2.8)], 12,
           LIME_WARM)
    for s in (-1, 1):
        p.box((s * 0.45, -1.4, 0.3), (0.3, 0.3, 0.28), DARK)
        p.spike((s * 0.42, -1.8, -0.6), 0.14, 0.5, BONE_OLD, sides=4)
    p.turn(mark, Matrix.Translation((-0.2, -0.2, 11.0)) @ Matrix.Rotation(-PI / 4, 4, 'Z'))
    return p


def shrine_altar():
    """Zulgar's altar under the jaguar (8 x 3.2 x 3): a stepped base, a
    talud-tablero body with jaguar-paw reliefs, a slab of sacrifice stained war
    red, skulls and bones, a bowl of jade spirit embers."""
    p = P('ShrineAltar', moss=0.25)
    p.box((0, 0, 0.3), (8.4, 3.6, 0.6), p.vary(LIME_GREY), bevel=0.08)
    p.box((0, 0, 1.4), (7.6, 2.8, 1.6), p.vary(LIME), bevel=0.1, taper=0.94)
    for s in (-1, 1):
        mark = p.mark()
        for k in range(4):
            a = -0.6 + k * 0.4
            p.smooth(p.rock((math.sin(a) * 0.7, 0, 0.55 + math.cos(a) * 0.5), (0.42, 0.3, 0.5), LIME_WARM, jitter=0.05,
                            subdivisions=1))
        p.smooth(p.rock((0, 0, 0), (1.3, 0.4, 1.0), LIME_WARM, jitter=0.05, subdivisions=1))
        p.turn(mark, Matrix.Translation((s * 2.4, -1.5, 1.3)))
    sun_disc(p, (0, -1.45, 1.45), 0.75, axis=(0, -1, 0), stone=LIME_WARM, inlay=GOLD_DIM)
    p.box((0, 0, 2.5), (8.0, 3.2, 0.5), p.vary(BASALT_MID), bevel=0.08)
    with p.as_kind(PAINT):
        p.box((0.6, 0.2, 2.76), (3.0, 1.8, 0.04), WARRED_DARK, yaw=0.2)
        p.box((-2.6, -1.62, 1.8), (0.5, 0.04, 1.4), WARRED_DARK)
    for k, x in enumerate((-3.2, -2.5, 3.0)):
        p.skull((x, 0.4 + k * 0.3, 2.75), 0.36, yaw=p.rng.uniform(-0.5, 0.5))
    p.bone((1.6, 0.9, 2.82), (3.0, 1.2, 2.84), 0.07)
    p.bone((1.4, 1.2, 2.84), (2.5, 0.4, 2.86), 0.06)
    p.lathe((-0.6, 0.4, 2.75), [(0.45, 0), (0.75, 0.25), (0.82, 0.42), (0.7, 0.48)], 12, p.vary(BASALT, 0.05))
    p.rock((-0.6, 0.4, 3.18), (1.1, 1.1, 0.24), JADE_FLAME, mat=GLOW, jitter=0.2, subdivisions=1)
    for k in range(3):
        a = k * 2.1
        p.rock((-0.6 + math.cos(a) * 0.3, 0.4 + math.sin(a) * 0.3, 3.26), (0.22, 0.22, 0.14), BASALT_DEEP,
               jitter=0.2, subdivisions=1)
    return p


def sun_glyph():
    """A sun glyph cut into the shrine floor (6 yd disc, a hand proud): a ring
    of rays and a boss with a thin, dim gold inlay (the render lights them)."""
    p = P('SunGlyph', moss=0.15, weather=0.6)
    p.lathe((0, 0, -0.12), [(3.0, 0), (3.0, 0.14), (2.86, 0.16), (0.0, 0.16)], 40, p.vary(LIME_WARM, 0.03))
    for k in range(24):
        a = TAU * k / 24
        p.box((math.cos(a) * 2.55, math.sin(a) * 2.55, 0.045), (0.62, 0.14, 0.02), GOLD_DIM, mat=GLOW,
              yaw=a + PI / 2)
    for k in range(8):
        a = TAU * k / 8 + PI / 8
        p.box((math.cos(a) * 1.75, math.sin(a) * 1.75, 0.045), (0.9, 0.22, 0.02), GOLD_DIM, mat=GLOW, yaw=a,
              taper=1.0)
    p.prism((0, 0, 0.04), 18, 0.7, 0.7, 0.02, GOLD_DIM, mat=GLOW)
    p.prism((0, 0, 0.04), 18, 1.15, 1.15, 0.008, p.vary(OCHRE_DARK, 0.04))
    return p


# ============================================================ basalt and rock
def basalt_columns():
    """A cluster of hexagonal basalt columns (collider r 2-3): seven packed
    drums-and-joints columns stepped like a stair, a fallen drum, ferns."""
    p = P('BasaltColumns', moss=0.6)
    r = 0.8
    d = r * math.sqrt(3)
    cells = [(0, 0, 6.4)] + [(math.cos(PI / 6 + TAU * k / 6) * d, math.sin(PI / 6 + TAU * k / 6) * d,
                              [5.4, 4.2, 3.0, 2.2, 3.6, 4.8][k]) for k in range(6)]
    for x, y, h in cells:
        hexcol(p, x, y, -0.6, h + 0.6, r * 0.98, BASALT, joints=max(1, int(h / 1.6)),
               lean=(p.rng.uniform(-0.02, 0.02), p.rng.uniform(-0.02, 0.02)))
    mark = p.mark()
    hexcol(p, 0, 0, 0, 1.6, 0.6, BASALT_MID, joints=1)
    p.turn(mark, Matrix.Translation((-1.4, -1.6, 0.5)) @ Matrix.Rotation(1.2, 4, 'Z') @ Matrix.Rotation(PI / 2, 4, 'Y'))
    fern_tuft(p, (1.1, -1.4, 0.0), 1.2, 6, LEAF)
    fern_tuft(p, (0.4, 0.4, 6.42), 0.9, 5, LEAF_LIGHT)
    return p


def basalt_cliff():
    """A module of the caldera wall (32 wide, 120 tall, 26 deep): a lower
    colonnade of giant hexagonal columns of every girth, broken into bays and
    stepped back, a blocky entablature with a mossy ledge of ferns and a young
    tree, an upper colonnade set back and leaning, wet streaks and moss
    curtains, the jungle on the rim and vines falling down the face. Front -Y
    faces the basin; tiles along X with neighbours overlapping."""
    p = P('BasaltCliff', moss=0.5, seed=11)
    p.box((0, 15, 60), (31, 22, 120), BASALT_DEEP)
    tones = [BASALT, BASALT_MID, BASALT, (0.29, 0.33, 0.27), BASALT_DRY]
    ledges = []
    x = -15.5
    k = 0
    while x < 15.5:
        r = p.rng.uniform(1.8, 3.4)
        y = p.rng.uniform(-1.4, 2.8)
        short = p.rng.random() < 0.22
        h = p.rng.uniform(30, 42) if short else p.rng.uniform(48, 57)
        hexcol(p, x, y, 0, h, r, p.vary(tones[k % 5], 0.08), joints=int(h / 16),
               lean=(p.rng.uniform(-0.02, 0.02), p.rng.uniform(-0.02, 0.02)), phase=p.rng.uniform(0, 1))
        if short:
            ledges.append((x, y, h, r))
        x += r * 1.7
        k += 1
    # Broken bays: scree, ferns and a sapling where columns snapped short.
    for (x, y, h, r) in ledges:
        p.rock((x, y - 0.5, h + 0.6), (r * 2.4, r * 2.0, 1.8), BASALT_MID, jitter=0.3, subdivisions=1)
        fern_tuft(p, (x, y - 0.8, h + 1.3), 2.2, 6, p.vary(LEAF, 0.1))
        if p.rng.random() < 0.6:
            blob(p, (x + 0.5, y + 0.5, h + 4.5), (5.0, 4.6, 4.0), p.vary(JADE, 0.08), fronds=2, lumps=3)
    # The entablature: a band of broken, blocky rock with the ledge on it.
    loft_y(p, [(-1.6, 0, 56.5, 16.4, 4.0, 2.6), (6, 0, 57, 16.6, 4.4, 2.6), (14, 0, 57, 16.6, 4.4, 2.6)], 14,
           BASALT_MID, jitter=0.22, freq=0.35)
    for k in range(6):
        p.box((-14 + k * 5.6 + p.rng.uniform(-1, 1), -1.4 + p.rng.uniform(0, 1.2), 55 + p.rng.uniform(-1, 1)),
              (p.rng.uniform(3, 5), p.rng.uniform(2, 3), p.rng.uniform(2.5, 4)), p.vary(BASALT, 0.1),
              bevel=0.2, yaw=p.rng.uniform(-0.2, 0.2), roll=p.rng.uniform(-0.15, 0.15))
    x = -15.5
    k = 0
    while x < 15.5:
        r = p.rng.uniform(1.5, 2.4)
        h = p.rng.uniform(52, 62)
        hexcol(p, x, p.rng.uniform(3.2, 6.0), 58, h, r, p.vary(tones[(k + 2) % 5], 0.08), joints=3,
               lean=(p.rng.uniform(-0.04, 0.03), p.rng.uniform(-0.03, 0.03)), phase=p.rng.uniform(0, 1))
        x += r * 1.7
        k += 1
    # Wet streaks and moss curtains down the face.
    for k in range(9):
        x = -15 + k * 3.7 + p.rng.uniform(-0.8, 0.8)
        z1 = p.rng.uniform(70, 116) if k % 2 else p.rng.uniform(30, 55)
        length = p.rng.uniform(12, 30)
        col = (0.16, 0.2, 0.15) if k % 3 else MOSS_DEEP
        with p.as_kind(PAINT):
            p.box((x, -2.2 + (3.5 if z1 > 58 else 0.0), z1 - length / 2), (p.rng.uniform(0.5, 1.4), 0.4, length),
                  col, taper=0.4)
    # The rim: weathered cap, then the jungle.
    loft_y(p, [(3.0, 0, 116.5, 16.3, 4.5, 2.6), (14, 0, 117, 16.5, 4.8, 2.6), (25, 0, 117, 16.5, 4.8, 2.6)], 14,
           BASALT_MID, jitter=0.25, freq=0.3)
    for k in range(5):
        x = -13 + k * 6.6 + p.rng.uniform(-1, 1)
        y = p.rng.uniform(5, 21)
        blob(p, (x, y, 122 + p.rng.uniform(0, 3)), (p.rng.uniform(10, 13), p.rng.uniform(10, 13), p.rng.uniform(6, 9)),
             p.vary([JADE, JADE_DARK, LEAF][k % 3], 0.08), fronds=2, lumps=3)
    for k in range(5):
        x = -13 + k * 6.5 + p.rng.uniform(-1.5, 1.5)
        frond(p, (x, 3.2, 119.5), -PI / 2 + p.rng.uniform(-0.4, 0.4), 6, 1.5, 4.5, 0.9, LEAF, segs=7)
    # The mid ledge: ferns and a young tree.
    for k in range(4):
        fern_tuft(p, (-13 + k * 8.4 + p.rng.uniform(-1, 1), p.rng.uniform(-0.5, 2.5), 60.6), 2.2, 5,
                  p.vary(LEAF, 0.1))
    root(p, [(6, 2.2, 60.4), (6.4, 2.0, 64.5), (6.0, 2.2, 66)], 0.5, 0.3, BARK)
    blob(p, (6, 2.0, 67.5), (7, 6, 4.5), JADE, fronds=3, lumps=4)
    # Vines down the face.
    for k in range(7):
        x = -14 + k * 4.6 + p.rng.uniform(-1, 1)
        vine(p, (x, -0.8, 117), p.rng.uniform(14, 40), 1.5, 0.24, phase=k * 1.1, leaves=4)
    for k in range(4):
        x = -12 + k * 8 + p.rng.uniform(-1, 1)
        vine(p, (x, -2.4, 58), p.rng.uniform(10, 26), 1.0, 0.2, phase=k * 0.6, leaves=3)
    return p


def basalt_edge():
    """A 4 yd basalt lip on a rock terrace's edge: hexagonal column tops paving
    the lip (barely proud), the outer row jagged and running down the cliff face
    eight yards. Outer (drop) side -Y; never more than 0.45 past the lip."""
    p = P('BasaltEdge', moss=0.55)
    r = 0.46
    d = r * math.sqrt(3)
    x = -2.0 + r * 0.6
    k = 0
    while x < 2.1:
        hexcol(p, x, -0.45, -8.0, 8.0 + p.rng.uniform(-0.25, 0.35), r, p.vary(BASALT, 0.1), joints=1,
               lean=(p.rng.uniform(-0.015, 0.015), 0))
        hexcol(p, x + d * 0.5, 0.3, -1.2, 1.2 + p.rng.uniform(0.02, 0.16), r, BASALT_MID, joints=0)
        x += d
        k += 1
    p.rock((p.rng.uniform(-1.4, 1.4), -0.85, -p.rng.uniform(3, 6)), (0.9, 0.5, 1.6), BASALT, jitter=0.2,
           subdivisions=1)
    return p


def masonry_edge():
    """A 4 yd lip of carved coping on the pyramid's stairs and landings: a
    step-fret band, faded ochre, coursed cladding down the face. Outer -Y."""
    p = P('MasonryEdge', moss=0.45)
    for k, x in enumerate((-1.0, 1.0)):
        p.box((x, -0.02, 0.2), (1.96, 0.76, 0.42), p.vary(LIME_WARM, 0.05), bevel=0.05)
    for k in range(5):
        x = -1.6 + k * 0.8
        p.box((x, -0.41, 0.2), (0.34, 0.06, 0.16), p.vary(LIME_GREY, 0.04))
        p.box((x + 0.17, -0.41, 0.08), (0.18, 0.06, 0.1), p.vary(LIME_GREY, 0.04))
    paint_band(p, (0, -0.4, 0.34), (3.9, 0.03, 0.07), OCHRE)
    p.masonry(-2.0, 2.0, -3.0, 0.0, 0.8, 0.75, LIME, y=0.0, bevel=False, mortar=0.05)
    return p


def bone_edge():
    """A 4 yd Sunbone rail of lashed bones (the Beast Pits, the causeway): femur
    posts, tusk spikes turned out, long-bone rails bound in ochre rope, red
    cloth, a horned skull on the middle post. Outer -Y; 1.4 yd tall."""
    p = P('BoneEdge', moss=0.15)
    for x in (-1.6, 0.0, 1.6):
        p.bone((x, 0, -0.1), (x + p.rng.uniform(-0.05, 0.05), 0, 1.25), 0.085)
        lashing(p, (x, 0, 0.55), (0, 0, 1), 0.09, turns=3)
        lashing(p, (x, 0, 1.05), (0, 0, 1), 0.09, turns=2)
        p.sweep([(x, -0.05, 0.85), (x, -0.45, 0.95), (x + 0.05, -0.75, 1.3)], 0.07, 0.01, BONE_OLD, sides=5)
    horned_skull(p, (0.0, -0.05, 1.42), 0.26, yaw=0.0)
    for z in (0.5, 1.02):
        p.bone((-2.0, 0.02, z), (2.0, 0.02, z + p.rng.uniform(-0.05, 0.05)), 0.055, knob=1.6)
    with p.as_kind(PAINT):
        blade(p, [(-0.8, -0.1, 1.02), (-0.75, -0.13, 0.7), (-0.8, -0.12, 0.35)], [0.12, 0.13, 0.06], WARRED,
              thick=0.015, up_hint=(0, 1, 0))
        blade(p, [(0.9, -0.1, 1.0), (0.95, -0.12, 0.72), (0.92, -0.1, 0.45)], [0.1, 0.11, 0.05], OCHRE,
              thick=0.015, up_hint=(0, 1, 0))
    return p


def river_stones():
    """Stepping stones of worn basalt in the ford's shallows (all under 0.6 yd),
    wet sheen rings round their feet where the current breaks."""
    p = P('RiverStones', moss=0.35)
    spots = [(-3.6, 0.2, 2.2), (-1.2, -0.4, 1.8), (1.2, 0.3, 2.0), (3.4, -0.3, 1.5), (0.2, 1.8, 1.1),
             (-2.4, -1.8, 0.9), (2.6, 1.9, 0.8)]
    for x, y, s in spots:
        p.smooth(p.rock((x, y, 0.05), (s * 1.3, s, 0.9 * min(1.0, s * 0.45) + 0.12), p.vary(BASALT_MID, 0.1),
                        jitter=0.14, subdivisions=2, flat_bottom=True))
        p.prism((x, y, 0.06), 14, s * 0.78, s * 0.7, 0.02, SHEEN, mat=GLASS)
    for k in range(9):
        a = p.rng.random() * TAU
        rr = p.rng.uniform(1.0, 4.5)
        p.rock((math.cos(a) * rr, math.sin(a) * rr * 0.6, 0.02), (0.35, 0.3, 0.16), BASALT_DRY, jitter=0.2,
               subdivisions=1)
    return p


def pool_rim():
    """Rim stones of the Weeping Falls' plunge pool (collider r 1.6, 2 yd):
    three rounded wet boulders on a rock foot that runs 30 yd down to the gorge."""
    p = P('PoolRim', moss=0.6)
    loft_z(p, [(-32, 0, 0, 2.2, 1.9, 2.2), (-12, 0, 0, 1.9, 1.7, 2.2), (-0.8, 0, 0, 1.6, 1.4, 2.2)], 10,
           BASALT_MID, jitter=0.2)
    for x, y, s in ((0.0, 0.0, 1.0), (-0.8, 0.6, 0.75), (0.85, -0.4, 0.7)):
        p.smooth(p.rock((x, y, s * 0.85), (s * 1.9, s * 1.6, s * 1.9), p.vary(BASALT, 0.1), jitter=0.12,
                        subdivisions=2))
    p.prism((0, 0, 0.18), 16, 1.9, 1.8, 0.02, SHEEN, mat=GLASS)
    fern_tuft(p, (0.3, 0.5, 1.75), 0.9, 5, LEAF)
    return p


def waterfall_lip():
    """The rock lip a fall leaves the rim from (16 yd channel): two mossy
    shoulders, a smooth worn channel with a wet sheen, the face below. Origin
    on the lip's centre at the water's edge."""
    p = P('WaterfallLip', moss=0.65, seed=2)
    loft_y(p, [(-1.5, 0, -0.9, 8.5, 1.2, 2.6), (4, 0, -0.6, 8.6, 1.3, 2.6), (12, 0, -0.2, 8.4, 1.2, 2.6)], 16,
           BASALT_MID, jitter=0.08, freq=0.6)
    p.box((0, 5, -0.05), (15.5, 13, 0.06), SHEEN, mat=GLASS)
    for s in (-1, 1):
        loft_z(p, [(-14, s * 10.5, 5, 3.4, 9, 2.2), (-2, s * 10.4, 5, 3.4, 8.6, 2.2), (3, s * 10, 5.5, 3.0, 7.6, 2.4),
                   (5.5, s * 10.3, 6, 2.0, 6.0, 2.4)], 14, BASALT, jitter=0.2)
        fern_tuft(p, (s * 10, 3, 5.6), 2.2, 7, LEAF)
        for k in range(3):
            vine(p, (s * (8.5 + k * 1.2), -3.0, 3.0), 6 + k * 3, 0.6, 0.14, phase=k + s, leaves=5)
    for k in range(5):
        x = -6 + k * 3
        hexcol(p, x, -0.6, -12, 11.4 + p.rng.uniform(-0.3, 0.2), 1.1, BASALT, joints=3)
    for k in range(4):
        p.smooth(p.rock((p.rng.uniform(-6, 6), p.rng.uniform(2, 11), 0.1), (1.4, 1.1, 0.7), BASALT_DRY,
                        jitter=0.15, subdivisions=1, flat_bottom=True))
    return p


# ================================================================ the jungle
def kapok(name, height, trunk_r, crown_r, buttresses, seed):
    p = P(name, moss=0.5, seed=seed)
    trunk_top = height * 0.68
    prof = [(trunk_r * 1.25, 0), (trunk_r * 1.08, 0.9), (trunk_r, 2.4), (trunk_r * 0.88, trunk_top * 0.5),
            (trunk_r * 0.74, trunk_top * 0.85), (trunk_r * 0.66, trunk_top)]
    p.lathe((0, 0, -0.4), prof, 14, BARK)
    # Bark ridges.
    for k in range(9):
        a = TAU * k / 9 + p.rng.uniform(-0.1, 0.1)
        p.sweep([(math.cos(a) * trunk_r * 1.02, math.sin(a) * trunk_r * 1.02, 0.6),
                 (math.cos(a) * trunk_r * 0.92, math.sin(a) * trunk_r * 0.92, trunk_top * 0.5),
                 (math.cos(a) * trunk_r * 0.7, math.sin(a) * trunk_r * 0.7, trunk_top * 0.95)],
                trunk_r * 0.13, trunk_r * 0.06, p.vary(BARK_DARK, 0.08), sides=4)
    # Buttress roots: tall thin fins that sweep out and down (low past r * 1.3).
    for k in range(buttresses):
        a = TAU * k / buttresses + p.rng.uniform(-0.2, 0.2)
        reach = trunk_r * p.rng.uniform(1.9, 2.2)
        pts = []
        for i in range(7):
            t = i / 6
            rr = trunk_r * 0.7 + (reach - trunk_r * 0.7) * t
            z = trunk_r * 3.4 * (1 - t) ** 2.6
            pts.append((math.cos(a) * rr, math.sin(a) * rr, z - 0.15))
        p.smooth(p.sweep(pts, trunk_r * 0.24, trunk_r * 0.06, p.vary(BARK, 0.06), sides=6, squash=2.6))
    # Lianas spiralling the trunk.
    for j in range(2):
        pts = []
        for i in range(16):
            t = i / 15
            a = j * PI + t * TAU * 1.6
            rr = trunk_r * (1.02 - 0.3 * t)
            pts.append((math.cos(a) * rr, math.sin(a) * rr, 0.3 + t * trunk_top))
        with p.as_kind(FOLIAGE):
            p.sweep(pts, 0.14, 0.1, VINE_DARK, sides=4)
    # Branches and the crown: broad tiers of canopy at the branch ends.
    nb = 5
    ends = []
    for k in range(nb):
        a = TAU * k / nb + p.rng.uniform(-0.3, 0.3)
        rr = crown_r * p.rng.uniform(0.55, 0.75)
        z1 = height * p.rng.uniform(0.8, 0.88)
        end = (math.cos(a) * rr, math.sin(a) * rr, z1)
        mid = (math.cos(a) * rr * 0.45, math.sin(a) * rr * 0.45, trunk_top + (z1 - trunk_top) * 0.75)
        p.sweep([(0, 0, trunk_top - 1.0), mid, end], trunk_r * 0.42, trunk_r * 0.16, p.vary(BARK, 0.06), sides=7)
        ends.append(end)
        if k % 2 == 0:
            bromeliad(p, mid, 0.9)
    tones = [JADE, JADE_DARK, LEAF, JADE, LEAF_LIGHT]
    for k, (x, y, z) in enumerate(ends):
        s = crown_r * p.rng.uniform(0.55, 0.7)
        blob(p, (x, y, z + 1.2), (s * 1.3, s * 1.3, s * 0.55), p.vary(tones[k % 5], 0.06), fronds=3, lumps=4)
        frond(p, (x, y, z + 0.4), math.atan2(y, x) + p.rng.uniform(-0.4, 0.4), s * 0.75, 0.4, s * 0.5, s * 0.2,
              LEAF, segs=6)
    blob(p, (0, 0, height * 0.92), (crown_r * 1.0, crown_r * 1.0, crown_r * 0.42), JADE, fronds=4, lumps=4)
    # Vines from the boughs (lowest tip well over a player's head).
    for k in range(6):
        x, y, z = ends[k % nb]
        t = 0.55 + 0.35 * p.rng.random()
        vine(p, (x * t, y * t, z - 0.5), (z - 0.5) - height * 0.4, 0.6, 0.09, phase=k, leaves=5)
    fern_tuft(p, (trunk_r * 1.9, trunk_r * 0.4, 0.0), 1.2, 5, LEAF)
    return p


def jungle_tree():
    """A kapok of the terraces (18 yd, trunk r 1.6): buttress fins that fall
    low within a stride of the trunk, ridged bark, lianas, a broad tiered crown,
    bromeliads in the boughs, vines high overhead."""
    return kapok('JungleTree', 18.5, 1.6, 9.0, 6, 21)


def jungle_tree_tall():
    """An emergent giant rising out of the gorge (28 yd), its umbrella crown
    level with the terraces."""
    return kapok('JungleTreeTall', 28.0, 2.0, 12.0, 7, 33)


def palm():
    """A dwarf palm of the walkways (no collider, so no trunk to walk through):
    a stout scaly bole a stride high, a fountain of arching fronds."""
    p = P('Palm', moss=0.3)
    for k in range(5):
        z = k * 0.3
        r = 0.55 - k * 0.04
        p.lathe((0, 0, z), [(r * 1.05, 0), (r * 1.12, 0.12), (r * 0.9, 0.3)], 9, p.vary(BARK, 0.1),
                phase=k * 0.4, smooth=False)
    for k in range(13):
        yaw = TAU * k / 13 + p.rng.uniform(-0.15, 0.15)
        frond(p, (0, 0, 1.45), yaw, p.rng.uniform(2.8, 3.6), p.rng.uniform(1.4, 2.1), 2.6, 0.55,
              p.vary(LEAF if k % 3 else LEAF_YELLOW, 0.1), segs=10)
    for k in range(4):
        yaw = TAU * k / 4 + 0.4
        frond(p, (0, 0, 1.5), yaw, 1.4, 1.6, 0.4, 0.3, LEAF_LIGHT, segs=5)
    return p


def palm_tall():
    """A tall palm leaning out of the gorge (16 yd): ringed trunk, a crown of
    long feathered fronds, a bunch of nuts."""
    p = P('PalmTall', moss=0.2, seed=4)
    pts = []
    for i in range(10):
        t = i / 9
        pts.append(Vector((1.8 * t * t, 0.4 * t, 16.0 * t)))
    for i in range(9):
        a, b = pts[i], pts[i + 1]
        mark = p.mark()
        d = b - a
        p.lathe((0, 0, 0), [(0.62 - i * 0.025, 0), (0.66 - i * 0.025, d.length * 0.25),
                            (0.55 - i * 0.025, d.length)], 9, p.vary(BARK, 0.08), smooth=True)
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        p.turn(mark, Matrix.Translation(a) @ rot)
    top = pts[-1]
    for k in range(14):
        yaw = TAU * k / 14 + p.rng.uniform(-0.15, 0.15)
        frond(p, top, yaw, p.rng.uniform(5.5, 6.8), p.rng.uniform(1.0, 1.8), 4.0, 0.75,
              p.vary(LEAF if k % 4 else LEAF_YELLOW, 0.1), segs=11)
    for k in range(5):
        a = TAU * k / 5
        p.rock(top + Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, -0.6)), (0.5, 0.5, 0.55), BARK_DARK, jitter=0.1,
               subdivisions=1)
    return p


def giant_fern():
    """A giant tree-fern crown at ground level (3.5 yd): fourteen arching
    serrated fronds, unrolling fiddleheads in the heart."""
    p = P('GiantFern', moss=0.3)
    p.smooth(p.rock((0, 0, 0.15), (1.2, 1.2, 0.6), BARK_DARK, jitter=0.15, subdivisions=1))
    for k in range(14):
        yaw = TAU * k / 14 + p.rng.uniform(-0.15, 0.15)
        frond(p, (0, 0, 0.35), yaw, p.rng.uniform(2.8, 3.6), p.rng.uniform(1.8, 2.5), 2.6, 0.5,
              p.vary(LEAF if k % 3 else JADE, 0.1), segs=12)
    for k in range(4):
        a = TAU * k / 4 + 0.3
        pts = []
        for i in range(10):
            t = i / 9
            ang = t * TAU * 0.9
            rr = 0.35 * (1 - t * 0.7)
            pts.append((math.cos(a) * 0.2 + math.cos(a) * rr * math.sin(ang), math.sin(a) * 0.2 + math.sin(a) * rr
                        * math.sin(ang), 0.4 + t * 0.9 + rr * math.cos(ang) * 0.6))
        with p.as_kind(FOLIAGE):
            p.sweep(pts, 0.07, 0.03, LEAF_LIGHT, sides=4)
    return p


def canopy_clump():
    """A mound of jungle canopy for the gorge floor (16 yd wide, 9 tall): a
    broad dark skirt that knits with its neighbours into one roof, round
    crowns in four greens, a few fronds breaking the silhouette."""
    p = P('CanopyClump', moss=0.0, seed=8)
    blob(p, (0, 0, 0.6), (17, 15, 3.6), JADE_DEEP, subdivisions=1, jitter=0.15, flat=True)
    tones = [JADE, JADE_DARK, LEAF, JADE, LEAF_LIGHT]
    with p.as_kind(FOLIAGE):
        for k in range(6):
            a = TAU * k / 6 + p.rng.uniform(-0.3, 0.3)
            rr = p.rng.uniform(2.5, 4.8) if k else 0.0
            s = p.rng.uniform(5.5, 8.0)
            p.rock((math.cos(a) * rr, math.sin(a) * rr, 3.0 + p.rng.uniform(0.5, 3.0)), (s, s, s * 0.8),
                   p.vary(tones[k % 5], 0.08), jitter=0.22, subdivisions=1)
    for k in range(4):
        yaw = TAU * k / 4 + 0.3
        frond(p, (math.cos(yaw) * 4, math.sin(yaw) * 4, 6.0), yaw, 4.0, 1.2, 3.0, 0.8, LEAF_LIGHT, segs=5)
    return p


def hanging_vines():
    """A curtain of lianas hanging from its origin (4 yd wide, to 12 down), for
    cliff lips and the undersides of the terraces."""
    p = P('HangingVines', moss=0.0)
    for k in range(5):
        x = -2.0 + k * 1.0 + p.rng.uniform(-0.2, 0.2)
        vine(p, (x, p.rng.uniform(-0.2, 0.2), 0.0), p.rng.uniform(5, 12), 0.7, p.rng.uniform(0.09, 0.15),
             color=VINE if k % 2 else VINE_DARK, phase=k * 0.9, leaves=4)
    with p.as_kind(FOLIAGE):
        p.sweep([(-2.2, 0, 0.1), (0, 0.1, -0.3), (2.2, 0, 0.1)], 0.16, 0.16, VINE_DARK, sides=5)
    return p


def strangler_roots():
    """A strangler fig devouring a colony stele (collider r 2.6, 8 yd): a
    carved column in a lattice of roots that flare to the ground, its young
    crown on top, aerial roots hanging."""
    p = P('StranglerRoots', moss=0.5, seed=6)
    p.box((0, 0, 0.4), (2.2, 2.2, 0.8), p.vary(LIME_GREY), bevel=0.08)
    p.box((0, 0, 4.0), (1.5, 1.5, 6.6), p.vary(LIME, 0.04), bevel=0.1, taper=0.85)
    for j in range(3):
        p.box((0, -0.72, 2.2 + j * 1.9), (1.0, 0.1, 1.3), p.vary(LIME_GREY, 0.06), bevel=0.04)
        p.box((0, -0.77, 2.2 + j * 1.9), (0.45, 0.06, 0.55), DARK if j == 1 else OCHRE_DARK)
    for k in range(9):
        a0 = TAU * k / 9
        pts = []
        for i in range(9):
            t = i / 8
            a = a0 + t * (1.8 if k % 2 else -1.6)
            rr = 0.95 + 0.25 * math.sin(t * PI) + (1.4 * max(0.0, t - 0.75) / 0.25) ** 1.3
            pts.append((math.cos(a) * rr, math.sin(a) * rr, 8.2 - t * 8.3))
        root(p, pts, 0.24, 0.32, ROOT)
    for k in range(4):
        a = TAU * k / 4 + 0.4
        root(p, [(math.cos(a) * 0.8, math.sin(a) * 0.8, 6.2), (math.cos(a) * 1.4, math.sin(a) * 1.4, 4.0),
                 (math.cos(a) * 1.0, math.sin(a) * 1.0, 2.0)], 0.2, 0.18)
    root(p, [(0, 0, 7.6), (0, 0, 9.4)], 0.6, 0.4, BARK)
    blob(p, (0.3, 0.2, 10.4), (5.2, 4.8, 3.2), JADE)
    blob(p, (-1.2, 0.8, 11.2), (3.4, 3.2, 2.4), LEAF)
    for k in range(5):
        a = TAU * k / 5
        vine(p, (math.cos(a) * 1.8, math.sin(a) * 1.8, 9.4), p.rng.uniform(3.0, 4.6), 0.3, 0.06, color=ROOT,
             phase=k, leaves=0)
    fern_tuft(p, (1.8, -1.2, 0.0), 1.1, 5, LEAF)
    return p


# ============================================================ the colony ruins
def ruin_arch():
    """A Court colony arch (10 wide, 9 tall, collider 10 x 2): coursed piers,
    a round arch of voussoirs with its keystone sigil, half its crown fallen,
    roots and vines over it."""
    p = P('RuinArch', moss=0.55, seed=9)
    for s in (-1, 1):
        p.masonry(s * 4.2 - 0.85, s * 4.2 + 0.85, 0.0, 6.2, 1.8, 0.8, LIME, y=0.0, bevel=False)
        p.box((s * 4.2, 0, 6.35), (2.1, 2.1, 0.32), p.vary(LIME_WARM), bevel=0.06)
        p.box((s * 4.2, 0, 0.25), (2.2, 2.2, 0.5), p.vary(LIME_GREY), bevel=0.06)
    p.voussoir_arch(6.7, 6.5, 2.6, 1.0, 1.8, LIME, pointed=False, blocks=13, broken=0.22)
    p.box((-0.6, -0.95, 9.0), (0.8, 0.1, 0.8), OCHRE_DARK)
    for k in range(3):
        p.box((p.rng.uniform(1.0, 3.0), p.rng.uniform(-1.6, -0.6), 0.25), (1.0, 0.7, 0.5), p.vary(LIME, 0.08),
              bevel=0.05, yaw=p.rng.random() * 3)
    root(p, [(-3.2, 0.6, 9.4), (-2.0, 0.2, 9.0), (-4.0, 1.1, 6.6), (-5.0, 1.0, 3.0), (-5.3, 1.4, 0.0)], 0.3, 0.22)
    root(p, [(-1.4, 0.4, 9.2), (-3.4, 0.9, 7.4), (-4.4, 1.0, 5.0)], 0.2, 0.14)
    blob(p, (-2.6, 0.4, 9.6), (3.6, 2.6, 1.8), JADE)
    for k in range(4):
        vine(p, (-3.0 + k * 0.9, -0.95, 8.7 - k * 0.3), 2.6 + k * 0.7, 0.3, 0.07, phase=k, leaves=4)
    fern_tuft(p, (4.2, -1.3, 0.0), 1.2, 5, LEAF)
    return p


def ruin_column(broken):
    """A Court colony column (7.5 yd, plinth within r 1.2), ivy up its shaft;
    or its broken stump (4.5 yd) with a drum at its foot."""
    p = P('RuinColumnBroken' if broken else 'RuinColumn', moss=0.55, seed=12 if broken else 0)
    p.column((0, 0, 0), 7.5 if not broken else 7.0, 0.72, LIME, sides=16, broken=0.42 if broken else 0.0)
    pts = []
    for i in range(14):
        t = i / 13
        a = t * TAU * 1.2
        pts.append((math.cos(a) * 0.82, math.sin(a) * 0.82, 0.2 + t * (6.2 if not broken else 3.4)))
    with p.as_kind(FOLIAGE):
        p.sweep(pts, 0.07, 0.05, VINE_DARK, sides=4)
    for i in range(1, 13, 2):
        x, y, z = pts[i]
        frond(p, (x, y, z), math.atan2(y, x), 0.5, 0.15, 0.3, 0.2, LEAF, segs=3, serrate=False, thick=0.02)
    if broken:
        mark = p.mark()
        p.lathe((0, 0, 0), [(0.7, 0), (0.72, 0.1), (0.7, 1.4), (0.68, 1.5)], 16, p.vary(LIME, 0.03))
        p.turn(mark, Matrix.Translation((1.0, -1.6, 0.68)) @ Matrix.Rotation(0.5, 4, 'Z') @ Matrix.Rotation(PI / 2, 4, 'Y'))
        fern_tuft(p, (0.2, 0.2, 4.4), 0.9, 5, LEAF_LIGHT)
    else:
        fern_tuft(p, (0.1, 0.1, 7.52), 0.8, 5, LEAF)
    return p


def ruin_wall():
    """A broken colony wall (12 x 1.6, 4 yd): coursed limestone with a ragged
    top, a window niche, roots over its crown, fallen blocks at its foot."""
    p = P('RuinWall', moss=0.55, seed=13)
    p.masonry(-6.0, 6.0, 0.0, 4.2, 1.5, 0.7, LIME, y=0.0, ruin=0.55, bevel=False)
    p.box((2.4, -0.7, 2.4), (1.4, 0.3, 1.8), MAW_DARK)
    p.voussoir_arch(1.6, 3.1, 0.6, 0.35, 0.4, LIME_WARM, pointed=False, blocks=7, center=(2.4, -0.62, 0))
    p.box((0, 0, 0.18), (12.2, 1.8, 0.36), p.vary(LIME_GREY), bevel=0.05)
    for k in range(4):
        p.box((p.rng.uniform(-5, 5), p.rng.choice((-1.2, 1.2)), 0.25), (0.9, 0.6, 0.5), p.vary(LIME, 0.1),
              bevel=0.05, yaw=p.rng.random() * 3, roll=p.rng.uniform(-0.2, 0.2))
    for k in range(3):
        x = -4 + k * 3.6
        root(p, [(x, 0.4, 4.3), (x + 0.6, -0.85, 3.9), (x + 0.8, -0.85, 2.0), (x + 1.1, -0.9, 0.0)], 0.2, 0.15)
        vine(p, (x + 1.8, -0.62, 3.6), 2.4, 0.2, 0.06, phase=k, leaves=0)
    blob(p, (-3.4, 0.1, 4.0), (3.4, 1.3, 1.5), JADE, fronds=0)
    fern_tuft(p, (1.0, 0.0, 3.0), 1.0, 5, LEAF)
    return p


def rooted_statue():
    """A Court colonist, eight yards of carved limestone on a plinth (collider
    r 2.4): robed, crowned, a sun staff in hand, the other arm broken and
    lying at its feet, a fig's roots wrapping it and a crown of leaves on its
    shoulder."""
    p = P('RootedStatue', moss=0.6, seed=14)
    p.box((0, 0, 0.6), (3.2, 3.2, 1.2), p.vary(LIME_GREY), bevel=0.1)
    p.box((0, 0, 1.35), (2.6, 2.6, 0.3), p.vary(LIME_WARM), bevel=0.06)
    mark = p.mark()
    p.lathe((0, 0, 1.5), [(1.05, 0), (1.0, 1.0), (0.82, 2.6), (0.7, 3.4)], 16, p.vary(LIME, 0.03))
    for k in range(10):
        a = TAU * k / 10
        p.box((math.cos(a) * 0.9, math.sin(a) * 0.9, 3.0), (0.14, 0.14, 2.8), p.vary(LIME, 0.03), yaw=a, taper=0.75)
    p.box((0, 0, 5.6), (1.6, 0.9, 1.7), p.vary(LIME, 0.03), bevel=0.14, taper=0.85)
    p.box((0, -0.1, 6.6), (2.1, 0.9, 0.35), p.vary(LIME_WARM), bevel=0.1)
    p.lathe((0, 0, 6.7), [(0.3, 0), (0.32, 0.3)], 10, LIME)
    p.smooth(p.rock((0, -0.05, 7.35), (0.8, 0.85, 1.0), p.vary(LIME, 0.03), jitter=0.04, subdivisions=2))
    p.box((0, -0.45, 7.3), (0.5, 0.15, 0.5), p.vary(LIME_GREY, 0.04))
    p.lathe((0, 0.05, 7.7), [(0.5, 0), (0.62, 0.35), (0.42, 0.9), (0.0, 1.05)], 10, p.vary(LIME_WARM))
    # The staff arm and the sun staff.
    p.sweep([(0.85, 0, 6.4), (1.15, -0.35, 5.6), (1.0, -0.6, 4.9)], 0.24, 0.2, LIME, sides=7)
    p.lathe((1.0, -0.65, 1.55), [(0.11, 0), (0.12, 6.4)], 7, LIME_WARM)
    sun_disc(p, (1.0, -0.7, 8.4), 0.55, axis=(0, -1, 0))
    p.sweep([(-0.85, 0, 6.4), (-1.0, -0.1, 5.8)], 0.24, 0.22, LIME, sides=7)
    p.turn(mark, Matrix.Rotation(0.06, 4, 'Y'))
    p.sweep([(-1.9, -1.4, 0.2), (-1.0, -1.7, 0.25)], 0.22, 0.2, LIME, sides=7)
    for k in range(7):
        a0 = TAU * k / 7
        pts = []
        for i in range(10):
            t = i / 9
            a = a0 + t * (2.4 if k % 2 else -2.0)
            rr = 0.85 + 0.25 * math.sin(t * PI * 2) + max(0.0, t - 0.8) * 4.0
            pts.append((math.cos(a) * rr, math.sin(a) * rr, 7.0 - t * 7.1))
        root(p, pts, 0.18, 0.26)
    blob(p, (-0.8, 0.5, 7.4), (2.4, 2.2, 1.8), JADE)
    blob(p, (0.2, 0.9, 8.3), (1.8, 1.6, 1.4), LEAF)
    for k in range(3):
        vine(p, (-1.0 + k * 0.4, -0.4, 6.8), 2.2 + k * 0.6, 0.25, 0.05, phase=k, leaves=3)
    fern_tuft(p, (1.3, 1.3, 1.2), 0.9, 5, LEAF)
    return p


# ============================================================ the Sunbone works
def sunbone_totem():
    """A Sunbone totem (collider r 0.9, 7 yd): a jaguar mask at the foot, a
    tusked troll face, a sun-bird spreading its wings at the top; ochre and war
    red over carved wood, bone tusks, feathers and fetishes."""
    p = P('SunboneTotem', moss=0.2, seed=15)
    p.lathe((0, 0, -0.2), [(0.62, 0), (0.58, 0.4), (0.55, 4.7), (0.5, 4.8)], 10, p.vary(TIMBER, 0.05))
    p.box((0, 0, 0.1), (1.6, 1.6, 0.5), p.vary(BASALT_MID), bevel=0.06)
    # The jaguar.
    p.box((0, -0.05, 1.3), (1.3, 1.25, 1.4), p.vary(OCHRE_DARK, 0.04), bevel=0.1, taper=0.9)
    jaguar_mask(p, (0, -0.62, 1.4), 1.25, OCHRE, paint=False)
    paint_band(p, (0, -0.66, 0.75), (1.2, 0.04, 0.12), WARRED)
    # The troll face.
    p.box((0, -0.05, 3.25), (1.35, 1.25, 1.8), p.vary(TIMBER, 0.05), bevel=0.1, taper=0.92)
    p.box((0, -0.7, 3.8), (1.2, 0.2, 0.3), p.vary(TIMBER), bevel=0.04)
    for s in (-1, 1):
        p.box((s * 0.32, -0.68, 3.5), (0.32, 0.1, 0.22), DARK)
        p.box((s * 0.32, -0.69, 3.5), (0.42, 0.06, 0.32), WARRED)
        p.sweep([(s * 0.3, -0.7, 2.75), (s * 0.55, -0.95, 3.0), (s * 0.7, -1.0, 3.5)], 0.11, 0.02, BONE, sides=6)
        p.box((s * 0.75, -0.05, 3.5), (0.4, 0.3, 0.6), p.vary(TIMBER), taper=0.4, roll=s * 0.8)
    p.box((0, -0.85, 3.25), (0.3, 0.45, 0.7), p.vary(TIMBER), taper=0.5)
    paint_band(p, (0, -0.68, 2.65), (1.0, 0.06, 0.1), OCHRE)
    p.box((0, -0.66, 2.55), (0.8, 0.08, 0.2), DARK)
    # The sun-bird.
    p.box((0, -0.05, 5.2), (1.1, 1.0, 1.3), p.vary(OCHRE, 0.04), bevel=0.08, taper=0.85)
    p.smooth(p.rock((0, -0.15, 6.15), (0.95, 1.0, 0.85), p.vary(OCHRE, 0.04), jitter=0.04, subdivisions=2))
    mark = p.mark()
    p.prism((0, 0, 0), 4, 0.28, 0.02, 1.2, BONE_OLD, axis=(0, -1, -0.35))
    p.turn(mark, Matrix.Translation((0, -0.55, 6.0)))
    for s in (-1, 1):
        p.box((s * 0.3, -0.58, 6.3), (0.18, 0.08, 0.16), DARK)
        p.box((s * 0.3, -0.6, 6.3), (0.3, 0.05, 0.26), WARRED)
    for s in (-1, 1):
        p.box((s * 0.25, -0.5, 5.45), (0.16, 0.08, 0.16), DARK)
        for k in range(5):
            x = s * (0.75 + k * 0.38)
            p.box((x, 0.0, 5.45 + k * 0.1), (0.4, 0.22, 0.95 - k * 0.1), p.vary(OCHRE if k % 2 else WARRED, 0.06),
                  roll=s * (0.15 + k * 0.05), bevel=0.03)
        for x, top, bot in ((1.6, 5.75, 5.3), (1.1, 5.6, 5.35)):
            p.sweep([(s * x, 0.0, top), (s * x, -0.05, bot)], 0.012, 0.012, ROPE, sides=3)
            p.bone((s * x, -0.05, bot), (s * x * 1.01, -0.05, bot - 0.5), 0.03, knob=1.5)
    for k in range(5):
        a = -0.6 + k * 0.3
        with p.as_kind(PAINT):
            p.box((math.sin(a) * 0.35, 0.25, 6.75 + math.cos(a) * 0.35), (0.12, 0.05, 0.7),
                  WARRED if k % 2 else FEATHER, roll=a, taper=0.4)
    root(p, [(0.5, 0.4, 0.0), (0.55, 0.35, 0.6), (0.4, 0.5, 1.2)], 0.08, 0.04, VINE_DARK)
    fern_tuft(p, (0.6, 0.6, 0.0), 0.8, 5, LEAF)
    return p


def sunbone_banner():
    """A Sunbone war banner (collider r 0.5, 6 yd): a bamboo pole, a cross-bar,
    a stretched hide painted with the red sun and three claw rakes, a tattered
    hem, a horned skull and feathers at the top."""
    p = P('SunboneBanner', moss=0.15, seed=16)
    for k in range(5):
        z = -0.2 + k * 1.3
        p.lathe((0, 0, z), [(0.13, 0), (0.15, 0.06), (0.12, 0.12), (0.12, 1.24), (0.14, 1.3)], 7,
                p.vary(BAMBOO, 0.06))
    p.box((0, 0, 0.12), (0.9, 0.9, 0.3), p.vary(BASALT_MID), bevel=0.05)
    mark = p.mark()
    p.lathe((0, 0, 0), [(0.08, 0), (0.08, 2.8)], 6, BAMBOO_DARK)
    p.turn(mark, Matrix.Translation((-1.4, -0.14, 5.4)) @ Matrix.Rotation(PI / 2, 4, 'Y'))
    lashing(p, (0, -0.14, 5.4), (1, 0, 0), 0.1, turns=3)
    # The hide, hanging in a gentle curve, tattered at the hem.
    with p.as_kind(PAINT):
        for k in range(6):
            x0 = -1.2 + k * 0.4
            pts = [(x0 + 0.2, -0.2, 5.35), (x0 + 0.2, -0.26 + 0.04 * math.sin(k), 4.0),
                   (x0 + 0.2, -0.22, 2.7 - (0.35 if k % 2 else 0.0))]
            blade(p, pts, [0.21, 0.21, 0.12 if k % 2 else 0.2], p.vary(HIDE_PALE, 0.05), thick=0.02, vfold=0.0,
                  up_hint=(0, 1, 0))
        p.prism((0, -0.31, 4.25), 16, 0.62, 0.62, 0.03, WARRED, axis=(0, -1, 0))
        for k in range(8):
            a = TAU * k / 8
            p.box((math.cos(a) * 0.86, -0.31, 4.25 + math.sin(a) * 0.86), (0.12, 0.03, 0.26), WARRED,
                  roll=-a + PI / 2, taper=0.3)
        for k in range(3):
            p.box((-0.5 + k * 0.5, -0.32, 3.2), (0.1, 0.03, 0.55), DARK, roll=0.25)
    horned_skull(p, (0, -0.05, 6.4), 0.3)
    for k in range(4):
        with p.as_kind(PAINT):
            p.box((-1.2 + k * 0.8, -0.18, 5.0), (0.06, 0.04, 0.5), FEATHER if k % 2 else WARRED, taper=0.3)
    return p


def brazier():
    """A Sunbone brazier (collider r 0.7): three lashed long bones holding a
    carved basalt bowl of glowing coals (emissive; the render owns any flame)."""
    p = P('Brazier', moss=0.1)
    for k in range(3):
        a = TAU * k / 3
        p.bone((math.cos(a) * 0.62, math.sin(a) * 0.62, 0.0), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.25), 0.07,
               knob=1.6)
    lashing(p, (0, 0, 0.75), (0, 0, 1), 0.42, turns=2, gap=0.12)
    p.lathe((0, 0, 1.15), [(0.25, 0), (0.55, 0.15), (0.7, 0.4), (0.74, 0.55), (0.66, 0.58)], 14,
            p.vary(BASALT_MID, 0.05))
    for k in range(6):
        a = TAU * k / 6
        p.box((math.cos(a) * 0.71, math.sin(a) * 0.71, 1.5), (0.08, 0.2, 0.1), OCHRE, yaw=a)
    p.rock((0, 0, 1.62), (1.1, 1.1, 0.28), EMBER, mat=GLOW, jitter=0.25, subdivisions=1)
    for k in range(5):
        a = TAU * k / 5 + 0.3
        p.rock((math.cos(a) * 0.3, math.sin(a) * 0.3, 1.72), (0.25, 0.22, 0.16), BASALT_DEEP, jitter=0.2,
               subdivisions=1)
    p.rock((0.1, -0.1, 1.74), (0.3, 0.3, 0.12), EMBER_DIM, mat=GLOW, jitter=0.2, subdivisions=1)
    return p


def bone_post():
    """A Sunbone bone post (collider r 0.8, 5 yd): a stone foot, a spine of
    stacked vertebrae on a pole, a great horned beast skull, red cloth."""
    p = P('BonePost', moss=0.15)
    p.box((0, 0, 0.3), (1.4, 1.4, 0.6), p.vary(BASALT_MID), bevel=0.06)
    p.lathe((0, 0, 0.6), [(0.16, 0), (0.15, 3.9)], 7, TIMBER)
    for k in range(10):
        z = 0.8 + k * 0.36
        p.lathe((0, 0, z), [(0.2, 0), (0.3, 0.07), (0.3, 0.2), (0.22, 0.28)], 8, p.vary(BONE, 0.05))
        p.box((0, 0.26, z + 0.14), (0.12, 0.2, 0.12), BONE_OLD)
    horned_skull(p, (0, -0.1, 4.6), 0.55)
    lashing(p, (0, 0, 4.4), (0, 0, 1), 0.2, turns=3)
    for s in (-1, 1):
        p.sweep([(s * 0.2, -0.1, 2.6), (s * 0.7, -0.25, 2.9), (s * 0.9, -0.3, 3.4)], 0.09, 0.015, BONE, sides=6)
    with p.as_kind(PAINT):
        blade(p, [(0.25, -0.2, 4.25), (0.3, -0.24, 3.6), (0.26, -0.22, 3.0)], [0.16, 0.17, 0.08], WARRED,
              thick=0.015, vfold=0.0, up_hint=(0, 1, 0))
    return p


def bone_fence():
    """An 8 yd fence round the Beast Pits (collider 8 x 0.8, 2.6 yd): femur
    posts, two lashed rails, rib arches between the posts, tusks turned out."""
    p = P('BoneFence', moss=0.1, seed=17)
    for k in range(5):
        x = -4.0 + k * 2.0
        p.bone((x, 0, -0.1), (x + p.rng.uniform(-0.04, 0.04), 0, 2.4), 0.11)
        lashing(p, (x, 0, 0.9), (0, 0, 1), 0.12, turns=2)
        lashing(p, (x, 0, 1.9), (0, 0, 1), 0.12, turns=2)
        if k % 2 == 0:
            p.skull((x, -0.05, 2.55), 0.3, yaw=p.rng.uniform(-0.3, 0.3))
        p.sweep([(x, -0.06, 1.5), (x - 0.1, -0.5, 1.7), (x - 0.05, -0.85, 2.15)], 0.08, 0.01, BONE_OLD, sides=5)
    for z in (0.9, 1.9):
        p.bone((-4.1, 0.03, z), (4.1, 0.03, z + p.rng.uniform(-0.06, 0.06)), 0.07, knob=1.5)
    for k in range(4):
        x0 = -4.0 + k * 2.0
        for j in range(3):
            xa = x0 + 0.5 + j * 0.5
            p.sweep(p.bezier((xa, 0.02, 0.1), (xa + 0.1, -0.25, 1.0), (xa, 0.02, 1.85), 6), 0.045, 0.03,
                    p.vary(BONE, 0.05), sides=5)
    with p.as_kind(PAINT):
        for x in (-3.0, 1.0):
            blade(p, [(x, -0.08, 1.88), (x + 0.05, -0.1, 1.4), (x, -0.08, 0.95)], [0.14, 0.15, 0.07], WARRED,
                  thick=0.015, vfold=0.0, up_hint=(0, 1, 0))
    return p


def beast_cage():
    """A beast cage of the pits (collider 4 x 4, 3.5 yd): a bone-cornered frame
    of logs, lashed bamboo bars, a roof of crossed poles under a hide."""
    p = P('BeastCage', moss=0.15, seed=18)
    h = 3.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.bone((sx * 1.85, sy * 1.85, -0.05), (sx * 1.85, sy * 1.85, h + 0.2), 0.14)
    for z in (0.2, h):
        for s in (-1, 1):
            for (a, b) in (((-1.9, s * 1.85), (1.9, s * 1.85)), ((s * 1.85, -1.9), (s * 1.85, 1.9))):
                mark = p.mark()
                d = Vector((b[0] - a[0], b[1] - a[1], 0))
                p.lathe((0, 0, 0), [(0.13, 0), (0.13, d.length)], 7, p.vary(TIMBER, 0.06))
                rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
                p.turn(mark, Matrix.Translation((a[0], a[1], z)) @ rot)
    for side in range(4):
        for k in range(7):
            t = -1.45 + k * (2.9 / 6)
            x, y = [(t, -1.85), (1.85, t), (t, 1.85), (-1.85, t)][side]
            p.lathe((x, y, 0.2), [(0.065, 0), (0.07, 0.04), (0.06, 1.4), (0.07, 1.45), (0.06, h - 0.2)], 6,
                    p.vary(BAMBOO, 0.08))
        lashing(p, ((-1.85, -1.85, 1.6), (1.85, -1.85, 1.6), (1.85, 1.85, 1.6), (-1.85, 1.85, 1.6))[side],
                (0, 0, 1), 0.16, turns=2)
    with p.as_kind(PAINT):
        p.box((0.2, 0.1, h + 0.25), (3.6, 3.4, 0.08), p.vary(HIDE, 0.05), roll=0.08, pitch=-0.05)
        p.box((-0.6, -1.4, h + 0.2), (2.0, 1.2, 0.06), HIDE_PALE, roll=0.12)
    for k in range(3):
        p.bone((-1.5 + k * 1.0, -1.0 + k * 0.6, 0.08), (-0.8 + k * 1.0, -0.6 + k * 0.5, 0.1), 0.05, knob=1.5)
    return p


def judging_stone():
    """The raised judging stone at the pits' north rim (collider r 2.2, 3 yd):
    a carved basalt drum on a plinth, steps cut into its face, claw rakes and
    ochre hands on its top, skulls round its rim."""
    p = P('JudgingStone', moss=0.35)
    p.lathe((0, 0, -0.2), [(2.2, 0), (2.2, 0.5), (2.0, 0.6)], 20, p.vary(BASALT_MID, 0.04))
    p.lathe((0, 0, 0.4), [(1.9, 0), (1.85, 1.9), (2.0, 2.0), (2.0, 2.3), (1.8, 2.4)], 20, p.vary(BASALT, 0.04))
    for k in range(3):
        p.box((0, -1.75 - k * 0.0, 0.5 + k * 0.62), (1.6, 0.9 - k * 0.2, 0.6), p.vary(BASALT_MID, 0.05), bevel=0.04)
    p.lathe((0, 0, 1.4), [(1.88, 0), (1.94, 0.1), (1.94, 0.3), (1.88, 0.4)], 20, OCHRE_DARK)
    with p.as_kind(PAINT):
        for k in range(3):
            p.box((-0.4 + k * 0.4, 0.3, 2.82), (0.08, 1.2, 0.03), WARRED_DARK, yaw=0.2)
        for k in range(2):
            p.box((0.9 - k * 1.7, -0.6 + k * 0.9, 2.82), (0.35, 0.45, 0.03), OCHRE, yaw=k * 1.2)
    for k in range(5):
        a = PI * 0.2 + k * PI * 0.15
        p.skull((math.cos(a) * 1.75, math.sin(a) * 1.75, 2.8), 0.3, yaw=a + PI / 2)
    return p


def hide_rack():
    """A drying rack of the hunters (collider 4.8 x 1.2, 3 yd): two bamboo
    A-frames, a cross pole, three hides stretched on hoops, one a jaguar's."""
    p = P('HideRack', moss=0.1, seed=19)
    for s in (-1, 1):
        for sy in (-1, 1):
            p.sweep([(s * 2.2, sy * 0.55, -0.05), (s * 2.2, sy * 0.05, 2.9)], 0.08, 0.07, p.vary(BAMBOO, 0.06),
                    sides=6)
        lashing(p, (s * 2.2, 0, 2.75), (0, 0, 1), 0.1, turns=2)
    mark = p.mark()
    p.lathe((0, 0, 0), [(0.07, 0), (0.07, 4.8)], 6, BAMBOO_DARK)
    p.turn(mark, Matrix.Translation((-2.4, 0, 2.75)) @ Matrix.Rotation(PI / 2, 4, 'Y'))
    for k, x in enumerate((-1.4, 0.0, 1.4)):
        mark = p.mark()
        pts = []
        for i in range(13):
            a = TAU * i / 12
            pts.append((math.cos(a) * 0.6, 0, 1.75 + math.sin(a) * 0.85))
        p.sweep(pts, 0.035, 0.035, BAMBOO, sides=4, cap=False)
        col = HIDE if k != 1 else OCHRE
        with p.as_kind(PAINT):
            p.prism((0, 0, 1.75), 12, 0.58, 0.58, 0.03, p.vary(col, 0.05), axis=(0, -1, 0))
            if k == 1:
                for j in range(9):
                    a = j * 2.3
                    rr = 0.15 + (j % 3) * 0.14
                    p.prism((math.cos(a) * rr, -0.04, 1.75 + math.sin(a) * rr * 1.3), 6, 0.06, 0.06, 0.01, DARK,
                            axis=(0, -1, 0))
        p.sweep([(0, 0, 2.6), (0, 0, 2.75)], 0.02, 0.02, ROPE, sides=4)
        p.turn(mark, Matrix.Translation((x, 0, 0)))
    for k in range(3):
        p.bone((-1.6 + k * 1.3, 0.6, 0.06), (-1.0 + k * 1.3, 0.4, 0.08), 0.05, knob=1.4)
    return p


def ward_post():
    """A ward post of the Convergence Stair (collider r 1, 7 yd): a carved
    limestone post of stacked glyph blocks under a jaguar head finial whose
    eyes hold a thin jade gleam (the gate draws the ward itself)."""
    p = P('WardPost', moss=0.45)
    p.box((0, 0, 0.35), (1.9, 1.9, 0.7), p.vary(LIME_GREY), bevel=0.08)
    p.box((0, 0, 3.2), (1.3, 1.3, 5.0), p.vary(LIME, 0.04), bevel=0.08, taper=0.92)
    for k in range(4):
        z = 1.3 + k * 1.15
        p.box((0, 0, z), (1.42, 1.42, 0.16), p.vary(LIME_WARM, 0.04), bevel=0.03)
        for j, (x, y, yaw) in enumerate(((0, -0.64, 0.0), (0.64, 0, PI / 2), (0, 0.64, PI), (-0.64, 0, -PI / 2))):
            mark = p.mark()
            p.box((0, -0.02, 0.55), (0.62, 0.06, 0.62), DARK if (k + j) % 3 == 0 else OCHRE_DARK)
            p.box((0, -0.05, 0.55), (0.32, 0.05, 0.32), p.vary(LIME, 0.04))
            p.turn(mark, Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z'))
    p.box((0, 0, 5.9), (1.6, 1.6, 0.35), p.vary(LIME_WARM), bevel=0.05)
    mark = p.mark()
    loft_y(p, [(0.6, 0, 0, 0.75, 0.6, 2.6), (-0.4, 0, 0.05, 0.7, 0.55, 2.6), (-1.0, 0, -0.1, 0.5, 0.36, 2.8)], 12,
           LIME_WARM)
    for s in (-1, 1):
        p.box((s * 0.32, -0.55, 0.2), (0.24, 0.12, 0.14), JADE_FLAME, mat=GLOW)
        p.smooth(p.rock((s * 0.5, 0.3, 0.6), (0.4, 0.2, 0.42), LIME_WARM, jitter=0.03, subdivisions=1))
        p.spike((s * 0.18, -0.95, -0.3), 0.08, 0.3, BONE_OLD, sides=4)
    p.turn(mark, Matrix.Translation((0, 0, 6.6)))
    paint_band(p, (0, -0.67, 5.0), (1.2, 0.04, 0.12), WARRED)
    return p


def vine_anchor():
    """A vine bridge's anchor (collider r 1, 5 yd): a carved bollard with a
    gnarled post through it, coils of rope-vine wound round both and the
    bridge cable running off toward -Y."""
    p = P('VineAnchor', moss=0.5, seed=20)
    p.lathe((0, 0, -0.2), [(1.0, 0), (1.0, 0.6), (0.8, 0.8), (0.8, 1.6), (0.95, 1.8), (0.9, 2.0)], 14,
            p.vary(BASALT_MID, 0.04))
    pts = []
    for i in range(9):
        t = i / 8
        pts.append((0.15 * math.sin(t * 5), 0.12 * math.cos(t * 4), 1.6 + t * 3.4))
    root(p, pts, 0.42, 0.26, BARK)
    for j in range(3):
        cp = []
        for i in range(20):
            t = i / 19
            a = t * TAU * 2.2 + j
            rr = 0.48 - 0.1 * t
            cp.append((math.cos(a) * rr, math.sin(a) * rr, 2.4 + j * 0.8 + t * 0.6))
        with p.as_kind(FOLIAGE):
            p.sweep(cp, 0.09, 0.09, VINE, sides=4)
    with p.as_kind(FOLIAGE):
        p.sweep([(0.0, -0.4, 3.0), (0.0, -1.0, 1.4), (0.0, -1.6, 0.3), (0.0, -2.0, -0.1)], 0.14, 0.12, VINE_DARK,
                sides=5)
    for k in range(5):
        frond(p, (0.3 * math.cos(k), 0.3 * math.sin(k), 3.3 + k * 0.35), k * 1.3, 0.7, 0.2, 0.4, 0.22, LEAF, segs=3,
              serrate=False, thick=0.025)
    p.skull((0, -0.45, 4.9), 0.3, color=BONE)
    paint_band(p, (0, -0.82, 1.2), (0.9, 0.04, 0.2), WARRED)
    return p


def vine_bridge():
    """A segment of a woven vine bridge (4 yd along X, 8 wide): a deck of
    woven vine mats on rope stringers, twisted vine posts every two yards with
    sagging rope-vine handrails, ties, leaves sprouting and tendrils hanging
    below. Origin on the deck's walking surface; tiles along X."""
    p = P('VineBridge', moss=0.0, seed=22)
    with p.as_kind(FOLIAGE):
        for k in range(9):
            x = -2.0 + 0.22 + k * 0.445
            p.box((x, 0, -0.11), (0.42, 8.2, 0.2), p.vary(VINE_DARK if k % 2 else VINE, 0.08),
                  roll=p.rng.uniform(-0.03, 0.03))
        for j in range(5):
            y = -3.6 + j * 1.8
            p.sweep([(-2.05, y, -0.22), (0, y, -0.26), (2.05, y, -0.22)], 0.13, 0.13, p.vary(ROOT, 0.06), sides=5)
        for s in (-1, 1):
            p.sweep([(-2.05, s * 4.08, -0.15), (0, s * 4.08, -0.12), (2.05, s * 4.08, -0.15)], 0.18, 0.18,
                    VINE_DARK, sides=6)
            for x in (-1.0, 1.0):
                pts = [(x, s * 4.1, -0.2), (x + 0.06, s * 4.12, 0.6), (x - 0.04, s * 4.1, 1.35)]
                p.sweep(pts, 0.11, 0.08, p.vary(ROOT, 0.06), sides=5)
                for t in range(3):
                    a = t * 2.1
                    p.sweep([(x + math.cos(a) * 0.12, s * 4.1 + math.sin(a) * 0.12, 0.0),
                             (x + math.cos(a + 1.5) * 0.12, s * 4.1 + math.sin(a + 1.5) * 0.12, 0.6),
                             (x + math.cos(a + 3) * 0.1, s * 4.1 + math.sin(a + 3) * 0.1, 1.25)], 0.04, 0.03, VINE,
                            sides=4)
            p.sweep(p.bezier((-2.05, s * 4.12, 1.3), (0, s * 4.16, 1.0), (2.05, s * 4.12, 1.3), 8), 0.08, 0.08, VINE,
                    sides=5)
            p.sweep(p.bezier((-2.05, s * 4.1, 0.75), (0, s * 4.14, 0.5), (2.05, s * 4.1, 0.75), 6), 0.05, 0.05,
                    VINE_DARK, sides=4)
            for x in (-1.6, -0.4, 0.4, 1.6):
                p.sweep([(x, s * 4.1, 1.15), (x + 0.1, s * 4.05, 0.55), (x, s * 4.0, 0.0)], 0.03, 0.03, VINE, sides=4)
    for k in range(6):
        s = 1 if k % 2 else -1
        x = -1.7 + k * 0.7
        frond(p, (x, s * 4.1, 1.25), s * PI / 2 + p.rng.uniform(-0.6, 0.6), 0.6, 0.2, 0.35, 0.2, LEAF, segs=3,
              serrate=False, thick=0.025)
    for k in range(4):
        x = -1.5 + k * 1.0
        y = p.rng.uniform(-3.5, 3.5)
        vine(p, (x, y, -0.3), p.rng.uniform(1.5, 3.5), 0.2, 0.05, phase=k, leaves=2)
    return p


def thorn_wall():
    """A 4 yd segment of a thorn wall (5 yd tall): a tangled hedge of black
    bramble canes looping out of the ground and back, knotted into a dense
    mass with dark leaves, hooked thorns along every cane, red blossoms.
    Tiles along X (the canes stay inside x = -2.2 to 2.2)."""
    p = P('ThornWall', moss=0.0, seed=23)
    canes = []

    def cane(a, b, apex, bulge, r):
        pts = []
        for i in range(11):
            t = i / 10
            q = Vector(a).lerp(Vector(b), t)
            q.z += apex * math.sin(PI * t) ** 0.8
            q.y += bulge * math.sin(PI * t)
            pts.append(q)
        canes.append(pts)
        with p.as_kind(PAINT):
            p.sweep(pts, r, r * 0.55, p.vary(THORN if p.rng.random() < 0.8 else THORN_RED, 0.2), sides=5)

    # Big arching loops from the ground and back to it, crossing each other.
    for k in range(14):
        x0 = p.rng.uniform(-2.2, 2.2)
        x1 = x0 - math.copysign(p.rng.uniform(1.2, 2.6), x0)
        x1 = max(-2.2, min(2.2, x1))
        y = p.rng.uniform(-0.9, 0.9)
        cane((x0, y, -0.3), (x1, y + p.rng.uniform(-0.5, 0.5), -0.3), p.rng.uniform(2.4, 4.4),
             p.rng.uniform(-0.6, 0.6), p.rng.uniform(0.1, 0.15))
    # Low tangles knitting the mass at waist and chest height.
    for k in range(10):
        z = p.rng.uniform(0.6, 3.4)
        x0 = p.rng.uniform(-2.2, -0.4)
        x1 = p.rng.uniform(0.4, 2.2)
        y = p.rng.uniform(-0.8, 0.8)
        cane((x0, y, z), (x1, y + p.rng.uniform(-0.4, 0.4), z + p.rng.uniform(-0.8, 0.8)), p.rng.uniform(0.4, 1.2),
             p.rng.uniform(-0.8, 0.8), p.rng.uniform(0.07, 0.1))
    # Dark leaf masses in the heart of the hedge.
    with p.as_kind(FOLIAGE):
        for k in range(10):
            x = -1.9 + k * 0.42 + p.rng.uniform(-0.2, 0.2)
            p.rock((x, p.rng.uniform(-0.4, 0.4), p.rng.uniform(0.6, 3.0)), (0.9, 0.8, 1.0),
                   p.vary(JADE_DEEP if k % 2 else JADE_DARK, 0.12), jitter=0.35, subdivisions=1)
    # Hooked thorns along the canes, turned every way.
    for pts in canes:
        for i in range(1, len(pts) - 1):
            q = pts[i]
            d = (pts[i + 1] - pts[i - 1]).normalized()
            side = d.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            up = side.cross(d).normalized()
            ang = i * 2.1
            out = side * math.cos(ang) + up * math.sin(ang)
            with p.as_kind(PAINT):
                p.sweep([q, q + out * 0.22, q + out * 0.36 + d * 0.16], 0.07, 0.005, THORN, sides=3)
    for k in range(9):
        pts = canes[p.rng.randrange(len(canes))]
        q = pts[p.rng.randrange(2, len(pts) - 2)]
        blossom(p, q + Vector((0, -0.2, 0.12)), p.rng.uniform(0.38, 0.55), BLOSSOM if k % 4 else BLOSSOM_PALE)
    for k in range(12):
        pts = canes[k % len(canes)]
        q = pts[3 + k % 5]
        frond(p, q, p.rng.random() * TAU, 0.55, 0.12, 0.3, 0.2, JADE_DARK, segs=3, serrate=False, thick=0.02)
    return p


BUILDERS = {
    'JaguarHead': jaguar_head,
    'JaguarEyes': jaguar_eyes,
    'IdolMaw': idol_maw,
    'MawPylon': maw_pylon,
    'PyramidTier': pyramid_tier,
    'PyramidCorner': pyramid_corner,
    'ShrineAltar': shrine_altar,
    'SunGlyph': sun_glyph,
    'BasaltColumns': basalt_columns,
    'BasaltCliff': basalt_cliff,
    'BasaltEdge': basalt_edge,
    'MasonryEdge': masonry_edge,
    'BoneEdge': bone_edge,
    'RiverStones': river_stones,
    'PoolRim': pool_rim,
    'WaterfallLip': waterfall_lip,
    'JungleTree': jungle_tree,
    'JungleTreeTall': jungle_tree_tall,
    'Palm': palm,
    'PalmTall': palm_tall,
    'GiantFern': giant_fern,
    'CanopyClump': canopy_clump,
    'HangingVines': hanging_vines,
    'StranglerRoots': strangler_roots,
    'RuinArch': ruin_arch,
    'RuinColumn': lambda: ruin_column(False),
    'RuinColumnBroken': lambda: ruin_column(True),
    'RuinWall': ruin_wall,
    'RootedStatue': rooted_statue,
    'SunboneTotem': sunbone_totem,
    'SunboneBanner': sunbone_banner,
    'Brazier': brazier,
    'BonePost': bone_post,
    'BoneFence': bone_fence,
    'BeastCage': beast_cage,
    'JudgingStone': judging_stone,
    'HideRack': hide_rack,
    'WardPost': ward_post,
    'VineAnchor': vine_anchor,
    'VineBridge': vine_bridge,
    'ThornWall': thorn_wall,
}


# ===================================================================== build
def build_basin_kit(root_name, builders):
    """hckit.build_kit with this kit's material names (stone, glow, glass)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitGlass', 0.0, 0.5)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.8
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        if alpha < 1.0:
            bsdf.inputs['Alpha'].default_value = alpha
        materials.append(mat)
    root = bpy.data.objects.new(root_name, None)
    bpy.context.scene.collection.objects.link(root)
    parts = []
    total = 0
    for builder in builders:
        obj = builder().finish(materials, root)
        parts.append(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        tris = len(mesh.loop_triangles)
        total += tris
        bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = [round(min(v[i] for v in bb), 1) for i in range(3)]
        hi = [round(max(v[i] for v in bb), 1) for i in range(3)]
        print(f'PIECE {obj.name} triangles {tris} min {lo} max {hi}')
    print('KIT_TRIANGLES', total)
    return parts


def layout_preview(parts):
    x = 0.0
    row = 0.0
    width = 0.0
    for obj in parts:
        d = obj.dimensions
        if x > 160:
            x = 0.0
            row += width + 8
            width = 0.0
        obj.location = (x + d.x / 2, row, 0)
        x += d.x + 6
        width = max(width, d.y)


def _setup_render(path, res=(1800, 1100)):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.view_settings.view_transform = 'Standard'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.show_cavity = True
    scene.display.shading.show_shadows = True
    scene.display.shading.shadow_intensity = 0.35
    scene.display.shading.background_type = 'VIEWPORT'
    scene.display.shading.background_color = (0.55, 0.6, 0.55)
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]
    scene.render.filepath = path
    return scene


def render_preview(path):
    scene = _setup_render(path)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (85, -190, 150)
    cam.rotation_euler = (math.radians(52), 0, 0)
    cam_data.lens = 22
    cam_data.clip_end = 2000
    scene.camera = cam
    bpy.ops.render.render(write_still=True)


def render_closeups(parts, folder, partner=None):
    """One framed render per piece (front three-quarter view, a 2.6 yd figure
    beside it for scale). `partner` maps a piece to another drawn with it."""
    os.makedirs(folder, exist_ok=True)
    scene = _setup_render('', res=(1100, 1100))
    cam_data = bpy.data.cameras.new('closeup')
    cam_data.lens = 40
    cam_data.clip_end = 3000
    cam = bpy.data.objects.new('closeup', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = bpy.data.objects.new('target', None)
    scene.collection.objects.link(target)
    track = cam.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    # A player for scale: a 2.6 yd capsule.
    bpy.ops.mesh.primitive_cylinder_add(radius=0.45, depth=2.6, location=(0, 0, 1.3))
    figure = bpy.context.active_object
    figure.name = 'ScaleFigure'
    names = {o.name: o for o in parts}
    for obj in parts:
        for o in parts:
            o.hide_render = True
            o.location = (0, 0, 0)
        obj.hide_render = False
        friend = names.get(partner.get(obj.name)) if partner else None
        if friend:
            friend.hide_render = False
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = (hi - lo).length
        figure.location = (lo.x - 1.2, lo.y - 0.5, 1.3)
        target.location = centre
        cam.location = centre + Vector((-0.55, -1.15, 0.42)).normalized() * size * 1.15
        scene.render.filepath = os.path.join(folder, obj.name + '.png')
        bpy.ops.render.render(write_still=True)
    for o in parts:
        o.hide_render = False


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    preview = arg('--preview')
    closeups = arg('--closeups')
    save = arg('--save')
    only = arg('--pieces')
    names = list(BUILDERS)
    if only:
        names = [n for n in names if n in only.split(',')]
    parts = build_basin_kit('WildheartBasinKit_ROOT', [BUILDERS[n] for n in names])
    if not only:
        export_kit(os.path.join(HERE, 'wildheart_basin_kit_components.glb'))
    if closeups:
        render_closeups(parts, closeups, partner={'Kit_JaguarHead': 'Kit_JaguarEyes'})
    if save or preview:
        layout_preview(parts)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)
    if preview:
        render_preview(preview)


if __name__ == '__main__':
    main()
