"""The Gravewyrm Sanctum kit's modelling library (build_gravewyrm_sanctum_kit.py).

hckit's Piece with a face KIND and the Sanctum's own weathering in finish():
  ROCK   Thornpeak slate: tone drift, rain streaks, grime at the foot, worn
         highlights on edges, damp in creases, faint cleavage banding, rime
         on every upward face
  ICE    glacier ice: dense deep blue in the creases and low down (the core),
         clear blue on the faces, pale on the worn edges, vertical striation,
         faint dust bands, a white crust where the faces turn up
  SNOW   snow and rime: white, blue in the hollows and the undersides
  IRON   the Smith's iron and old chain: worn bright on the edges, dark in
         the creases, rime on top, a little cold rust
  PAINT  cloth, furs, hides, bone, timber: their own colour, light drift
  FLESH  the sculpted figures: their colours, cavity shading, rime on top
The glow (KitGlow) and glass (KitGlass) slots keep their painted colour.

Colours are sRGB in the bmesh BYTE colour layer: the glTF exporter linearizes
them once. (hckit.finish converts to linear itself, so its output is
linearized twice; this finish never converts, as the Wildheart kit's.)

Conventions (as every boss-room and dungeon kit): Blender units are game
yards, +Z up, a piece's front faces -Y (the game's +Z after the glTF export),
its origin is where the runtime stands it.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from hckit import GLOW, STONE, Piece, _fbm

GLASS = 2
TAU = math.tau
PI = math.pi

# ---- the palette (sRGB), docs/design/dungeon-rework/gravewyrm_sanctum.md section 8 ----
GLACIER = (0.498, 0.769, 0.910)      # glacier blue #7FC4E8
DEEP_ICE = (0.180, 0.435, 0.620)     # deep ice #2E6F9E
ICE_CORE = (0.10, 0.27, 0.45)
ICE_MID = (0.36, 0.62, 0.80)
ICE_PALE = (0.72, 0.87, 0.95)
ICE_FRESH = (0.55, 0.82, 0.96)       # a fresh break: clear and bright
RIME = (0.933, 0.965, 0.980)         # snow and rime #EEF6FA
SNOW_SHADE = (0.70, 0.79, 0.88)
SLATE = (0.290, 0.314, 0.345)        # bare rock slate #4A5058
SLATE_DARK = (0.19, 0.205, 0.23)
SLATE_DEEP = (0.12, 0.13, 0.15)
SLATE_LIGHT = (0.40, 0.42, 0.45)
SLATE_RUST = (0.36, 0.31, 0.28)
SEAL_STONE = (0.13, 0.135, 0.15)     # the seal pillars' black stone
SEAL_EDGE = (0.22, 0.23, 0.26)
CHAIN = (0.227, 0.239, 0.259)        # old iron chain #3A3D42
IRON_DARK = (0.14, 0.145, 0.16)
IRON_RUST = (0.33, 0.24, 0.19)
SOOT = (0.075, 0.07, 0.07)           # the cult's soot black
FUR = (0.42, 0.35, 0.27)
FUR_DARK = (0.24, 0.2, 0.17)
FUR_PALE = (0.62, 0.56, 0.47)
HIDE = (0.5, 0.4, 0.3)
LEATHER = (0.3, 0.22, 0.16)
TIMBER = (0.33, 0.26, 0.2)
TIMBER_DARK = (0.2, 0.16, 0.13)
ROPE = (0.5, 0.43, 0.32)
BONE = (0.78, 0.74, 0.65)
CULT_CLOTH = (0.22, 0.14, 0.26)      # violet robes under the furs
CULT_RED = (0.42, 0.1, 0.09)         # the goad-brand red
SKIN_RIMED = (0.66, 0.71, 0.76)      # the held dead: pale and rimed
SKIN_GIANT = (0.56, 0.6, 0.66)
ARMOUR = (0.36, 0.39, 0.43)
CLOTH_HELD = (0.27, 0.31, 0.38)
HAIR = (0.5, 0.52, 0.55)
WYRM_HIDE = (0.115, 0.125, 0.15)
WYRM_BELLY = (0.2, 0.2, 0.22)
WYRM_HORN = (0.36, 0.35, 0.34)
WYRM_MEMBRANE = (0.085, 0.09, 0.12)
DARK = (0.04, 0.045, 0.06)
# Light (glow slot, read as emissive colour). Decoration never out-glows a
# telegraph: runes, coals and cracks stay dim.
RUNE = (0.353, 0.722, 1.0)           # the Smith's rune blue #5AB8FF
RUNE_DIM = (0.2, 0.44, 0.66)
RUNE_DEAD = (0.12, 0.22, 0.32)
PYRE = (0.910, 0.525, 0.180)         # pyre orange #E8862E
EMBER = (0.78, 0.32, 0.1)
EMBER_DIM = (0.42, 0.14, 0.05)
SOUL = (0.561, 0.839, 0.627)         # soul violet-green #8FD6A0
SOUL_VIOLET = (0.478, 0.345, 0.722)  # #7A58B8
SHARD = (0.949, 0.722, 0.502)        # shard rose-gold #F2B880
SHARD_DIM = (0.62, 0.42, 0.3)
CRACK_GLOW = (0.5, 0.74, 0.88)       # light through a crack in the ice
GLASS_ICE = (0.5, 0.76, 0.92)        # the translucent shell
GLASS_DEEP = (0.24, 0.5, 0.74)
MELT = (0.34, 0.5, 0.58)             # running meltwater (glass)

ROCK, ICE, SNOW, IRON, PAINT, FLESH = 0, 1, 2, 3, 4, 5


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def sstep(a, b, v):
    t = max(0.0, min(1.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ================================================================== the piece
class GPiece(Piece):
    """hckit's Piece with a face KIND and the Sanctum weathering."""

    def __init__(self, name, seed=0, weather=1.0, frost=0.5, depth=1.0, ao=0.75, ao_dist=None):
        super().__init__(name, seed=seed, weather=weather, lichen=frost)
        self.ao = ao
        self.ao_dist = ao_dist
        self.kind = self.bm.faces.layers.int.new('kind')
        self.keep = self.bm.faces.layers.int.new('keep')
        self.cur = ROCK
        self.depth = depth

    def _paint(self, faces, color, mat):
        super()._paint(faces, color, mat)
        for f in faces:
            f[self.kind] = self.cur

    def as_kind(self, k):
        piece = self

        class _K:
            def __enter__(self):
                self.prev = piece.cur
                piece.cur = k

            def __exit__(self, *a):
                piece.cur = self.prev

        return _K()

    def smooth(self, faces):
        for f in faces:
            f.smooth = True
        return faces

    def facing(self, faces, direction):
        """Turn open faces toward `direction` (a vector, or a function of the
        face centre) and keep them so: finish() never re-winds them."""
        flip = []
        for f in faces:
            c = f.calc_center_median()
            d = direction(c) if callable(direction) else Vector(direction)
            f.normal_update()
            if f.normal.dot(d) < 0:
                flip.append(f)
            f[self.keep] = 1
        if flip:
            bmesh.ops.reverse_faces(self.bm, faces=flip)
        return faces

    def finish(self, materials, parent):
        bm = self.bm
        free = [f for f in bm.faces if not f[self.keep]]
        if free:
            bmesh.ops.recalc_face_normals(bm, faces=free)
        bm.normal_update()
        bm.verts.index_update()
        floor = min(v.co.z for v in bm.verts) if bm.verts else 0.0
        top = max(v.co.z for v in bm.verts) if bm.verts else 1.0
        span = max(0.5, top - floor)
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
        occ = self._bake_ao(span) if self.ao > 0 else None
        frost_amt = self.lichen
        for face in bm.faces:
            if face.material_index != STONE:
                continue
            kind = face[self.kind]
            fn = face.normal
            for loop in face.loops:
                # Smooth faces weather by the vertex normal, so a vertex keeps
                # one colour across its faces (no split vertices on export).
                n = loop.vert.normal if face.smooth else fn
                p = loop.vert.co
                c = conv[loop.vert.index]
                r, g, b, _ = loop[self.col]
                col = (r, g, b)
                height = p.z - floor
                h01 = min(1.0, max(0.0, height / span))
                up = max(0.0, n.z)
                if kind == ICE:
                    # The dense core low down and in the creases, clear faces,
                    # worn pale edges, vertical striation, faint dust bands.
                    deep = max(0.0, -c) * 0.75 + (1 - h01) * 0.3 * self.depth
                    if n.z < -0.35:
                        deep += 0.35
                    col = mix(col, ICE_CORE, min(0.8, deep))
                    col = mix(col, ICE_PALE, max(0.0, c) * 0.45)
                    stria = 0.9 + 0.16 * _fbm(p.x * 1.3 + p.y * 1.3, p.y * 0.4 - p.x * 0.4, p.z * 0.1)
                    col = tuple(ch * stria for ch in col)
                    # Dust bands: the glacier's old summers, thin grey lines across it.
                    band = sstep(0.6, 0.7, _fbm(p.x * 0.05, p.y * 0.05, p.z * 0.7 + 3.0))
                    col = mix(col, (0.5, 0.56, 0.62), band * 0.35 * self.depth)
                    crust = sstep(0.42, 0.8, n.z) * (0.75 + 0.25 * _fbm(p.x * 0.6, p.y * 0.6, p.z))
                    col = mix(col, RIME, min(1.0, crust * (0.6 + frost_amt * 0.6)))
                elif kind == SNOW:
                    shade = (1 - up) * 0.35 + max(0.0, -c) * 0.5
                    if n.z < -0.3:
                        shade += 0.3
                    col = mix(col, SNOW_SHADE, min(0.85, shade))
                    col = tuple(ch * (0.96 + 0.06 * _fbm(p.x * 2.2, p.y * 2.2, p.z * 2.2)) for ch in col)
                elif kind == IRON:
                    wear = max(0.0, c) * 0.55
                    col = mix(col, (0.46, 0.47, 0.5), wear)
                    col = tuple(ch * (1 - 0.35 * max(0.0, -c)) for ch in col)
                    rust = max(0.0, _fbm(p.x * 1.4 + 5, p.y * 1.4, p.z * 1.4) * 1.8 - 1.05) * (1 - up)
                    col = mix(col, IRON_RUST, min(0.5, rust))
                    col = mix(col, RIME, sstep(0.55, 0.95, n.z) * frost_amt * 0.85)
                elif kind in (PAINT, FLESH):
                    k = (0.88 + 0.22 * _fbm(p.x * 1.3, p.y * 1.3, p.z * 1.3))
                    if kind == FLESH:
                        k *= 1 - 0.45 * max(0.0, -c)
                        k *= 1 + 0.12 * max(0.0, c)
                    if n.z < -0.3:
                        k *= 0.82
                    col = tuple(ch * k for ch in col)
                    col = mix(col, RIME, sstep(0.5, 0.92, n.z) * frost_amt
                              * (0.6 + 0.4 * _fbm(p.x * 2.0, p.y * 2.0, p.z * 2.0)))
                else:
                    # Slate.
                    under = 0.8 if n.z < -0.3 else 1.0
                    ground = 0.7 + 0.3 * min(1.0, height / 1.8)
                    tone = 0.86 + 0.26 * _fbm(p.x * 0.45, p.y * 0.45, p.z * 0.45)
                    streak = 0.9 + 0.14 * _fbm(p.x * 2.2 + 7.1, p.y * 2.2 - 3.3, p.z * 0.2)
                    cleave = 0.94 + 0.1 * math.sin((p.z * 1.7 + p.x * 0.6 + p.y * 0.3) * 1.4
                                                    + _fbm(p.x * 0.3, p.y * 0.3, p.z * 0.3) * 4)
                    wear = 1.0 + 0.32 * max(0.0, c) - 0.32 * max(0.0, -c)
                    k = ground * under * tone * streak * cleave * wear
                    k = 1 - (1 - k) * self.weather
                    col = tuple(ch * k for ch in col)
                    patch = _fbm(p.x * 0.8 + 11.0, p.y * 0.8 - 5.0, p.z * 0.8)
                    rime = sstep(0.35, 0.85, n.z) * frost_amt * max(0.0, patch * 1.8 - 0.35)
                    rime += max(0.0, c) * frost_amt * 0.25 * up
                    col = mix(col, RIME, min(0.95, rime))
                if occ is not None:
                    o = occ[loop.vert.index] * self.ao
                    if kind == ICE:
                        # Occluded ice is the dense blue core, never grey;
                        # the open faces turn pale in the light.
                        col = mix(col, ICE_CORE, min(0.92, o * 1.6))
                        col = mix(col, ICE_PALE, max(0.0, 0.18 - o) * 1.2)
                    else:
                        col = tuple(ch * (1 - 0.8 * o) for ch in col)
                loop[self.col] = (min(1.0, max(0.0, col[0])), min(1.0, max(0.0, col[1])),
                                  min(1.0, max(0.0, col[2])), 1.0)
        if os.environ.get('GW_DEBUG'):
            cols = [loop[self.col][:3] for f_ in bm.faces for loop in f_.loops]
            lum = sorted(sum(c) / 3 for c in cols)
            print('DEBUG', self.name, 'occ', (sum(occ) / len(occ)) if occ else None, max(occ) if occ else None,
                  'lum p5', lum[len(lum) // 20], 'p50', lum[len(lum) // 2], 'p95', lum[len(lum) * 19 // 20])
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


def _hemisphere(n=14):
    """Cosine-weighted directions round +Z (fixed, so the bake is deterministic)."""
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        a = i * 2.39996
        r = math.sqrt(u)
        out.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(max(0.0, 1 - u)))))
    return out


HEMI = _hemisphere()


def _bake_ao(self, span):
    """Ambient occlusion per vertex, ray-cast against the piece itself: the
    creases, the undersides and the hollows darken (ice deepens to its core)."""
    from mathutils.bvhtree import BVHTree
    bm = self.bm
    tree = BVHTree.FromBMesh(bm)
    dist = self.ao_dist or max(1.0, min(8.0, span * 0.35))
    occ = [0.0] * len(bm.verts)
    for v in bm.verts:
        n = v.normal
        if n.length < 0.5:
            continue
        q = n.to_track_quat('Z', 'Y')
        o = v.co + n * 0.02
        hits = 0
        for d in HEMI:
            loc, _, _, _ = tree.ray_cast(o, q @ d, dist)
            if loc is not None:
                hits += 1
        occ[v.index] = hits / len(HEMI)
    return occ


GPiece._bake_ao = _bake_ao


def add_sculpt(p, field, verts, faces, colours, kinds, smooth=True):
    """Hand a meshed SDF to a piece: each face painted by its nearest
    labelled part (colours: label to sRGB; kinds: label to face kind, or
    (kind, slot))."""
    import numpy as np
    bm = p.bm
    vs = [bm.verts.new(Vector(v)) for v in verts]
    made = []
    for poly in faces:
        try:
            made.append(bm.faces.new([vs[i] for i in poly]))
        except ValueError:
            pass
    bm.normal_update()
    centres = np.array([tuple(m.calc_center_median()) for m in made])
    labels = field.classify(centres, default=next(iter(colours)))
    for m, lab in zip(made, labels):
        m.smooth = smooth
        kind = kinds.get(lab, ROCK)
        slot = STONE
        if isinstance(kind, tuple):
            kind, slot = kind
        c = colours.get(lab, next(iter(colours.values())))
        with p.as_kind(kind):
            p._paint([m], c, slot)
    return made


def P(name, **kw):
    return GPiece('Kit_' + name, **kw)


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


def loft_z(p, sections, sides, color, mat=STONE, smooth=False, jitter=0.0, phase=0.0, freq=0.2, cap0=True,
           cap1=True):
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
    return _ring_faces(p, rings, color, mat, smooth, cap0, cap1)


def loft_x(p, sections, sides, color, mat=STONE, smooth=False, jitter=0.0, phase=0.0, freq=0.25):
    """A solid lofted along X through superellipse rings (x, cy, cz, ry, rz, e)."""
    rings = []
    for (x, cy, cz, ry, rz, e) in sections:
        ring = []
        for i in range(sides):
            dy, dz = _se(phase + TAU * i / sides, ry, rz, e)
            k = 1.0
            if jitter:
                k = 1 + jitter * (_fbm(x * freq, (cy + dy) * freq, (cz + dz) * freq) - 0.5) * 2
            ring.append((x, cy + dy * k, cz + dz * k))
        rings.append(ring)
    return _ring_faces(p, rings, color, mat, smooth)


def hull(p, pts, color, mat=STONE, smooth=False):
    """The convex hull of points: faceted ice blocks, slate slabs, chunks."""
    bm = p.bm
    before = set(bm.faces)
    vs = [bm.verts.new(Vector(c)) for c in pts]
    out = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
    junk = list({g for g in out['geom_interior'] + out['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    faces = [f for f in bm.faces if f not in before]
    for f in faces:
        f.smooth = smooth
    p._paint(faces, color, mat)
    return faces


def _xform(pts, center, yaw=0.0, pitch=0.0, roll=0.0):
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') \
        @ Matrix.Rotation(roll, 4, 'Y')
    return [m @ Vector(q) for q in pts]


def crystal(p, center, size, color, n=16, yaw=0.0, pitch=0.0, roll=0.0, boxy=0.6, jitter=0.12, floor=None,
            mat=STONE):
    """A faceted block (hull of jittered points on a superellipsoid): ice
    blocks, seracs, chunks, boulders. `floor` clamps its foot flat."""
    pts = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * 2.39996 + p.rng.uniform(-0.35, 0.35)
        d = (math.cos(a) * r, math.sin(a) * r, z)
        k = 1 + p.rng.uniform(-jitter, jitter)
        q = tuple(math.copysign(abs(d[j]) ** boxy, d[j]) * size[j] * 0.5 * k for j in range(3))
        pts.append(q)
    pts = _xform(pts, center, yaw, pitch, roll)
    if floor is not None:
        pts = [Vector((q.x, q.y, max(floor, q.z))) for q in pts]
    return hull(p, pts, color, mat)


def shard(p, base, h, r, color, sides=6, lean=(0.0, 0.0), cut=0.35, jitter=0.2, yaw=0.0, squash=1.0, foot=0.0):
    """A tall faceted prism with a slanted broken top (an ice tower, a slate
    fin, a serac): rings at three heights and a cut top, hulled."""
    pts = []
    tilt = p.rng.uniform(0, TAU)
    for k, (z, rr) in enumerate(((-foot, 1.0), (h * 0.45, 0.97), (h * (1 - cut * 0.5), 0.9))):
        for i in range(sides):
            a = yaw + TAU * i / sides + p.rng.uniform(-0.25, 0.25)
            rj = r * rr * (1 + p.rng.uniform(-jitter, jitter))
            zz = z + (math.cos(a - tilt) * h * cut * 0.5 if k == 2 else 0.0)
            t = max(0.0, zz) / max(1e-3, h)
            pts.append((math.cos(a) * rj + lean[0] * t * h, math.sin(a) * rj * squash + lean[1] * t * h, zz))
    pts.append((lean[0] * h * 0.9 + p.rng.uniform(-r, r) * 0.3, lean[1] * h * 0.9, h))
    return hull(p, _xform(pts, base), color)


def slab(p, center, size, color, yaw=0.0, pitch=0.0, roll=0.0, chamfer=0.18, jitter=0.12):
    """An angular slate slab: a box with every corner knocked off unevenly
    (hull of the chamfer points)."""
    sx, sy, sz = (s * 0.5 for s in size)
    pts = []
    for cx in (-1, 1):
        for cy in (-1, 1):
            for cz in (-1, 1):
                for ax in range(3):
                    q = [cx * sx, cy * sy, cz * sz]
                    cut = min(size) * chamfer * p.rng.uniform(0.4, 1.6)
                    q[ax] -= [cx, cy, cz][ax] * cut
                    q = [v * (1 + p.rng.uniform(-jitter, jitter) * 0.3) for v in q]
                    pts.append(tuple(q))
    return hull(p, _xform(pts, center, yaw, pitch, roll), color)


def open_back(p, faces, centre, keep=0.3):
    """Cut the back off a clear shell (faces turned away from -Y), so the one
    layer of clear ice left shows what it holds: the runtime draws glass
    both-sided, two layers would bury it."""
    c = Vector(centre)
    drop = []
    for f in faces:
        f.normal_update()
        if f.is_valid and f.normal.y > keep and f.calc_center_median().y > c.y:
            drop.append(f)
    if drop:
        bmesh.ops.delete(p.bm, geom=drop, context='FACES_ONLY')
    return [f for f in faces if f.is_valid]


def snowcap(p, center, size, yaw=0.0, n=14):
    """A soft pillow of snow over a top (smooth shaded)."""
    with p.as_kind(SNOW):
        faces = crystal(p, center, size, p.vary(RIME, 0.03), n=n, yaw=yaw, boxy=0.9, jitter=0.08)
    return p.smooth(faces)


def icicles(p, pts, length, r, color=ICE_PALE, count=None, sides=5):
    """Icicles hanging from points (each a long cone down)."""
    with p.as_kind(ICE):
        for q in pts:
            L = length * p.rng.uniform(0.4, 1.0)
            rr = r * p.rng.uniform(0.6, 1.2)
            p.prism((q[0], q[1], q[2] + 0.02), sides, rr, 0.0001, -L, p.vary(color, 0.05),
                    lean=(p.rng.uniform(-0.04, 0.04), p.rng.uniform(-0.04, 0.04)))


def loop_tube(p, pts, r, color, sides=8, mat=STONE, squash=1.0, normal=None):
    """A closed tube along a loop of points (a ring, a chain link)."""
    pts = [Vector(q) for q in pts]
    n = len(pts)
    if normal is None:
        normal = (pts[1] - pts[0]).cross(pts[2] - pts[1]).normalized()
    else:
        normal = Vector(normal).normalized()
    before = set(p.bm.faces)
    rings = []
    for i, q in enumerate(pts):
        ahead = (pts[(i + 1) % n] - pts[(i - 1) % n]).normalized()
        side = ahead.cross(normal).normalized()
        rings.append([p.bm.verts.new(q + side * math.cos(TAU * k / sides) * r
                                     + normal * math.sin(TAU * k / sides) * r * squash) for k in range(sides)])
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(sides):
            p.bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    faces = p._new_faces(before)
    p._paint(faces, color, mat)
    return p.smooth(faces)


def link_loop(center, u, v, half, ring, segs=7):
    """The centre line of a chain link: a stadium in the plane (u, v)."""
    c, u, v = Vector(center), Vector(u).normalized(), Vector(v).normalized()
    pts = []
    for end in (1, -1):
        for i in range(segs + 1):
            a = -PI / 2 + PI * i / segs
            pts.append(c + u * (end * (half + math.cos(a) * ring)) + v * (end * math.sin(a) * ring))
    return pts


def chain_link(p, center, u, v, half, ring, bar, color=CHAIN, sides=8, segs=6, squash=1.0):
    """One forged link (iron kind)."""
    with p.as_kind(IRON):
        n = Vector(u).cross(Vector(v))
        return loop_tube(p, link_loop(center, u, v, half, ring, segs), bar, p.vary(color, 0.05), sides=sides,
                         normal=n, squash=squash)


def chain_run(p, a, b, pitch, ring, bar, color=CHAIN, sag=0.0, twist=0.0):
    """A chain from a to b (links alternate a quarter turn), sagging by `sag`."""
    a, b = Vector(a), Vector(b)
    length = (b - a).length
    count = max(1, int(length / pitch))
    half = pitch * 0.5 - ring + bar * 2.0
    prev = a
    for i in range(count):
        t0, t1 = i / count, (i + 1) / count
        q0 = a.lerp(b, t0) - Vector((0, 0, sag * 4 * t0 * (1 - t0)))
        q1 = a.lerp(b, t1) - Vector((0, 0, sag * 4 * t1 * (1 - t1)))
        u = (q1 - q0).normalized()
        side = u.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(u).normalized()
        ang = twist + (PI / 2 if i % 2 else 0.0)
        v = side * math.cos(ang) + up * math.sin(ang)
        chain_link(p, (q0 + q1) / 2, u, v, max(0.05, half), ring, bar, color)
        prev = q1
    return prev


def rivets(p, pts, r, color=IRON_DARK):
    with p.as_kind(IRON):
        for q in pts:
            p.rock(q, (r * 2, r * 2, r * 2), color, jitter=0.05, subdivisions=1)


# ------------------------------------------------------------- carved runes
# Angular stroke runes on a 4 by 6 grid (x right, y up). The Smith's runes are
# pictures, never letters: no language is cut into his stone (the meaning
# reaches the player as a localized lore line, never as baked text). The
# rune wall carries his three acts (heat, the hammer, quench); the pillars
# carry his four tools.
GLYPHS = {
    # Heat: a flame over the hearth's bowl.
    'heat': [((2, 6), (3.3, 4.0)), ((3.3, 4.0), (3.0, 2.2)), ((3.0, 2.2), (2, 1.5)), ((2, 1.5), (1.0, 2.2)),
             ((1.0, 2.2), (0.7, 4.0)), ((0.7, 4.0), (2, 6)), ((2, 2.3), (2, 4.2)), ((0.2, 0.5), (3.8, 0.5)),
             ((0.2, 0.5), (0.2, 1.1)), ((3.8, 0.5), (3.8, 1.1))],
    # Quench: the work plunged point first into rolling water.
    'quench': [((2, 6), (2, 2.5)), ((1.2, 3.4), (2, 2.5)), ((2.8, 3.4), (2, 2.5)),
               ((0, 1.7), (0.67, 2.1)), ((0.67, 2.1), (1.33, 1.7)), ((1.33, 1.7), (2, 2.1)),
               ((2, 2.1), (2.67, 1.7)), ((2.67, 1.7), (3.33, 2.1)), ((3.33, 2.1), (4, 1.7)),
               ((0, 0.4), (0.67, 0.8)), ((0.67, 0.8), (1.33, 0.4)), ((1.33, 0.4), (2, 0.8)),
               ((2, 0.8), (2.67, 0.4)), ((2.67, 0.4), (3.33, 0.8)), ((3.33, 0.8), (4, 0.4))],
    # The cartouche round each of the rune wall's great runes (centred on the
    # rune's own 4 by 6 cell: a long hexagon, its points up and down).
    'cartouche': [((2, 7.1), (6.0, 6.2)), ((6.0, 6.2), (6.0, -0.2)), ((6.0, -0.2), (2, -1.1)),
                  ((2, -1.1), (-2.0, -0.2)), ((-2.0, -0.2), (-2.0, 6.2)), ((-2.0, 6.2), (2, 7.1))],
    # The Smith's four tools.
    'hammer': [((2, 0), (2, 4.4)), ((0.4, 4.4), (3.6, 4.4)), ((0.4, 5.8), (3.6, 5.8)), ((0.4, 4.4), (0.4, 5.8)),
               ((3.6, 4.4), (3.6, 5.8)), ((1.4, 0.8), (2.6, 0.8))],
    'tongs': [((0.6, 0), (3.0, 4.4)), ((3.4, 0), (1.0, 4.4)), ((3.0, 4.4), (2.3, 6)), ((1.0, 4.4), (1.7, 6)),
              ((1.6, 2.2), (2.4, 2.2))],
    'anvil': [((0, 5), (4, 5)), ((0, 5), (1.3, 4.1)), ((4, 5), (3.6, 4.1)), ((1.3, 4.1), (1.6, 2.4)),
              ((3.6, 4.1), (2.9, 2.4)), ((1.6, 2.4), (2.9, 2.4)), ((0.6, 1.4), (3.8, 1.4)), ((1.6, 2.4), (0.6, 1.4)),
              ((2.9, 2.4), (3.8, 1.4))],
    'bellows': [((2, 0.2), (2, 1.4)), ((2, 1.4), (0.4, 3.6)), ((0.4, 3.6), (0.8, 5.4)), ((0.8, 5.4), (3.2, 5.4)),
                ((3.2, 5.4), (3.6, 3.6)), ((3.6, 3.6), (2, 1.4)), ((1.0, 3.7), (3.0, 3.7)), ((0.8, 5.4), (0.2, 6.3)),
                ((3.2, 5.4), (3.8, 6.3))],
}


def rune_strokes(p, glyph, origin, unit, width, y, glow=RUNE, groove=SLATE_DEEP, broken=None, out=-1):
    """Carve a glyph into a face toward -Y (y is the face's plane): a dark
    chiselled channel with the rune's light in it. `broken` drops strokes
    (a cracked seal). out -1 carves a face toward -Y, +1 one toward +Y
    (read from behind, so the glyph is mirrored to read true)."""
    ox, oz = origin
    for i, ((x0, z0), (x1, z1)) in enumerate(GLYPHS[glyph]):
        if broken and i in broken:
            continue
        sx = 1 if out < 0 else -1
        a = Vector((ox + sx * x0 * unit, y, oz + z0 * unit))
        b = Vector((ox + sx * x1 * unit, y, oz + z1 * unit))
        d = b - a
        L = d.length + width
        ang = math.atan2(d.z, d.x)
        mid = (a + b) / 2
        p.box((mid.x, y + out * 0.03, mid.z), (L + width * 0.5, 0.1, width * 1.9), groove, roll=-ang)
        with p.as_kind(PAINT):
            p.box((mid.x, y + out * 0.075, mid.z), (L, 0.06, width * 0.8), glow, mat=GLOW, roll=-ang)
