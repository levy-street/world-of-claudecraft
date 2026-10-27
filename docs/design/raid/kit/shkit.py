"""The Smith's Heart kit's modelling library (build_smith_heart_hammer_kit.py).

The Gravewyrm Sanctum's piece (gwkit.GPiece: a face KIND per face, baked
ambient occlusion, the local convexity) with the Smith's Heart's own
weathering in finish(): the raid is warm, dry, dusty stone inside Stormcrag,
never rime or snow.

  RAW      quarried rock (the Hammer's ochre granite as it comes out of the
           mountain): broad tone drift, faint bedding, diagonal pick marks,
           cavity grime, worn edges, quarry dust settled on every upward face,
           and where a piece asks for it the masons' red-ochre guide lines
  DRESSED  the Smith's finished work (the colossi's carved bodies, the
           columns, the dressed jambs): paler and finer, the carving's
           hollows deepened so a face reads from across the pit, dust in
           the folds
  TIMBER   the scaffolds and the derrick: grain along the beam, dark joints,
           sun-greyed tops under dust
  METAL    the Smith's bronze and the hoists' iron: bright worn edges, dark
           creases, a little verdigris on bronze and rust on iron, dust
  PAINT    rope, leather and cloth: their own colour, light drift
The glow slot (KitGlow: the ochre vein light, the geodes, the runes) keeps
its painted colour.

Colours are sRGB in the bmesh BYTE colour layer (the glTF exporter linearizes
them once), as gwkit's. Conventions as every dungeon kit: Blender units are
game yards, +Z up, a piece's front faces -Y (the game's +Z after the glTF
export), its origin is where the runtime stands it. Edge pieces run along X
with their OUTER (drop) side toward -Y.

Deterministic: every random draw is seeded, nothing reads the clock.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.normpath(os.path.join(HERE, '..', '..', 'dungeon-rework', 'kit'))
if SHARED not in sys.path:
    sys.path.insert(0, SHARED)

from gwkit import GPiece, mix, sstep  # noqa: E402
from hckit import GLOW, STONE, _fbm  # noqa: E402

TAU = math.tau
PI = math.pi

# ---- face kinds ------------------------------------------------------------------
RAW, METAL, PAINT, DRESSED, WOOD = 0, 3, 4, 6, 7

# ---- the palette (sRGB) ------------------------------------------------------------
# The Hammer's stone (phase 2C): Stormcrag's COOL grey granite, a hint of
# blue in the shadowed beds, so the warm light reads against it: the low sun
# warms the lit faces, the sky's cool fill keeps the shadows grey-blue, and
# the vein's ochre (#C8903C) lives only in its light (the seams, the geodes,
# the runes, the rims), never painted flat on the rock. Value contrast is
# carried by the stone itself: pale fresh cuts and finished carving, mid
# granite, dark weathered beds and near-black crevices.
QUARRY = (0.42, 0.42, 0.43)
QUARRY_DARK = (0.27, 0.28, 0.3)
QUARRY_DEEP = (0.17, 0.16, 0.19)     # crevices, joints, drill holes (never black)
QUARRY_PALE = (0.66, 0.64, 0.6)      # a fresh cut face
QUARRY_RED = (0.52, 0.38, 0.28)      # iron-stained beds (sparing)
DRESSED_STONE = (0.72, 0.69, 0.64)   # the Smith's finished carving
DRESSED_SHADE = (0.58, 0.56, 0.53)
GRANITE_DARK = (0.22, 0.23, 0.25)    # the colossi's hammers, the plinths
DUST = (0.68, 0.64, 0.57)
GRIME = (0.16, 0.15, 0.17)
MASON_RED = (0.62, 0.19, 0.1)        # the masons' red-ochre lines
TIMBER = (0.47, 0.35, 0.24)
TIMBER_GREY = (0.52, 0.47, 0.4)
TIMBER_DARK = (0.27, 0.2, 0.14)
ROPE = (0.62, 0.52, 0.36)
LEATHER = (0.36, 0.25, 0.17)
IRON = (0.23, 0.22, 0.21)
IRON_DARK = (0.13, 0.125, 0.12)
RUST = (0.45, 0.26, 0.14)
BRONZE = (0.46, 0.34, 0.19)
BRONZE_DARK = (0.31, 0.22, 0.12)
VERDIGRIS = (0.33, 0.5, 0.42)
# Light (glow slot, read as emissive colour). Decoration never out-glows a
# telegraph: the vein light stays a deep amber, the geodes' hearts the only
# bright spots, small.
VEIN = (0.78, 0.47, 0.16)            # the Hammer's ochre light in a seam
VEIN_DIM = (0.44, 0.25, 0.08)
GEODE_BODY = (0.88, 0.56, 0.22)     # the crystals' lit body (stone slot)
GEODE_HEART = (1.0, 0.66, 0.26)
GEODE_TIP = (1.0, 0.84, 0.56)
GEODE_DEEP = (0.62, 0.32, 0.08)
RUNE_OCHRE = (0.86, 0.56, 0.22)
RUNE_COLD = (0.36, 0.22, 0.1)
COAL = (0.9, 0.42, 0.12)


class SPiece(GPiece):
    """GPiece with the Smith's Heart weathering. `marks` paints the masons'
    red-ochre guide lines over the raw rock (a quarry face still being
    worked); `dust` scales the quarry dust on every upward face."""

    def __init__(self, name, seed=0, weather=1.0, dust=1.0, marks=False, ao=0.75, ao_dist=None):
        super().__init__(name, seed=seed, weather=weather, frost=0.0, ao=ao, ao_dist=ao_dist)
        self.dust = dust
        self.marks = marks
        self.cur = RAW

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
        for face in bm.faces:
            if face.material_index != STONE:
                continue
            kind = face[self.kind]
            fn = face.normal
            for loop in face.loops:
                n = loop.vert.normal if face.smooth else fn
                p = loop.vert.co
                c = conv[loop.vert.index]
                r, g, b, _ = loop[self.col]
                col = (r, g, b)
                height = p.z - floor
                up = max(0.0, n.z)
                patch = _fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                if kind == WOOD:
                    # Grain runs along the beam: noise stretched every way but
                    # one reads as grain on whichever axis the beam takes.
                    grain = 0.84 + 0.22 * _fbm(p.x * 5.0 + p.y * 0.3, p.y * 0.4 + p.z * 0.3, p.z * 0.35 + p.x * 0.2)
                    k = grain * (1 - 0.45 * max(0.0, -c)) * (1 + 0.12 * max(0.0, c))
                    if n.z < -0.3:
                        k *= 0.78
                    col = tuple(ch * k for ch in col)
                    col = mix(col, TIMBER_GREY, sstep(0.4, 0.9, n.z) * 0.45)
                    col = mix(col, DUST, sstep(0.55, 0.95, n.z) * 0.32 * self.dust * (0.5 + 0.5 * patch))
                elif kind == METAL:
                    wear = max(0.0, c) * 0.6
                    bright = tuple(min(1.0, ch * 1.55 + 0.06) for ch in col)
                    col = mix(col, bright, wear)
                    col = tuple(ch * (1 - 0.4 * max(0.0, -c)) for ch in col)
                    stain = max(0.0, _fbm(p.x * 1.5 + 5, p.y * 1.5, p.z * 1.5) * 1.8 - 1.0) * (1 - up)
                    tint = VERDIGRIS if col[0] > col[2] * 1.6 else RUST
                    col = mix(col, tint, min(0.45, stain))
                    col = mix(col, DUST, sstep(0.6, 0.95, n.z) * 0.35 * self.dust)
                elif kind == PAINT:
                    k = 0.88 + 0.22 * _fbm(p.x * 1.3, p.y * 1.3, p.z * 1.3)
                    if n.z < -0.3:
                        k *= 0.82
                    col = tuple(ch * k for ch in col)
                    col = mix(col, DUST, sstep(0.6, 0.95, n.z) * 0.25 * self.dust)
                elif kind == DRESSED:
                    # Finished carving: fine drift, rain streaks, the hollows
                    # deepened (a face must read from across the pit), the
                    # crests a touch paler, dust lying in the folds.
                    tone = 0.9 + 0.2 * _fbm(p.x * 0.3, p.y * 0.3, p.z * 0.3)
                    streak = 0.93 + 0.1 * _fbm(p.x * 2.0 + 7.1, p.y * 2.0 - 3.3, p.z * 0.16)
                    k = tone * streak * (1 - 0.55 * max(0.0, -c)) * (1 + 0.22 * max(0.0, c))
                    if n.z < -0.35:
                        k *= 0.84
                    k = 1 - (1 - k) * self.weather
                    col = tuple(ch * k for ch in col)
                    fold = max(0.0, -c) * 0.6 + sstep(0.55, 0.95, n.z) * 0.5
                    col = mix(col, DUST, min(0.6, fold * 0.55 * self.dust * (0.55 + 0.45 * patch)))
                else:
                    # Raw quarried rock.
                    under = 0.8 if n.z < -0.3 else 1.0
                    ground = 0.72 + 0.28 * min(1.0, height / 1.6)
                    tone = 0.84 + 0.3 * _fbm(p.x * 0.33, p.y * 0.33, p.z * 0.33)
                    bed = 0.95 + 0.07 * math.sin(p.z * 2.1 + _fbm(p.x * 0.2, p.y * 0.2, p.z * 0.2) * 5.0)
                    pick = 0.93 + 0.12 * _fbm(p.x * 3.2 + p.z * 3.2, p.y * 3.2 - p.z * 3.2, p.x * 0.4)
                    # Worn crests pale, hollows and joints sink toward black
                    # (the value range the cool stone needs to read).
                    wear = 1.0 + 0.32 * max(0.0, c) - 0.5 * max(0.0, -c)
                    k = ground * under * tone * bed * pick * wear
                    k = 1 - (1 - k) * self.weather
                    col = tuple(ch * k for ch in col)
                    stain = sstep(0.64, 0.82, _fbm(p.x * 0.12 + 3.0, p.y * 0.12, p.z * 0.5))
                    col = mix(col, QUARRY_RED, stain * 0.22)
                    # Dust only where it settles (the upward faces, in drifts),
                    # never a coat over the whole stone.
                    dust = sstep(0.55, 0.92, n.z) * (0.3 + 0.7 * patch) + max(0.0, -c) * up * 0.25
                    col = mix(col, DUST, min(0.5, dust * 0.5 * self.dust))
                    if self.marks and abs(n.z) < 0.45:
                        # Guide lines snapped in red ochre across the face:
                        # the masons' measure, broken where the rock was cut.
                        line = min(abs(((p.z + 0.4) / 2.6) % 1.0 - 0.5),
                                   abs(((p.x + p.y * 0.5) / 3.4) % 1.0 - 0.5))
                        if line > 0.47 and _fbm(p.x * 0.5, p.y * 0.5, p.z * 0.5) > 0.42:
                            col = mix(col, MASON_RED, 0.7)
                if occ is not None:
                    o = occ[loop.vert.index] * self.ao
                    col = tuple(ch * (1 - 0.78 * o) for ch in col)
                loop[self.col] = (min(1.0, max(0.0, col[0])), min(1.0, max(0.0, col[1])),
                                  min(1.0, max(0.0, col[2])), 1.0)
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


def SP(name, **kw):
    return SPiece('Kit_' + name, **kw)


# ============================================================ modelling helpers
def beam(p, a, b, w, h, color=TIMBER, roll=0.0):
    """A squared timber from a to b, w across and h deep (a box laid along
    the segment)."""
    from mathutils import Matrix
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    mid = (a + b) / 2
    yaw = math.atan2(d.y, d.x)
    pitch = math.atan2(d.z, math.hypot(d.x, d.y))
    with p.as_kind(WOOD):
        faces = p.box((0, 0, 0), (L, w, h), p.vary(color, 0.08))
    m = Matrix.Translation(mid) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'Y')         @ Matrix.Rotation(roll, 4, 'X')
    for v in {v for f in faces for v in f.verts}:
        v.co = m @ v.co
    return faces


def pole(p, a, b, r, color=TIMBER, sides=7):
    """A round pole from a to b (scaffold standards, braces, the derrick's
    stays), slightly tapered."""
    with p.as_kind(WOOD):
        return p.sweep([a, b], r, r * 0.88, p.vary(color, 0.07), sides=sides)


def rope(p, a, b, r=0.06, sag=0.0, color=ROPE, steps=6):
    """A rope from a to b, sagging by `sag` at its middle."""
    a, b = Vector(a), Vector(b)
    pts = [a.lerp(b, i / steps) - Vector((0, 0, sag * 4 * (i / steps) * (1 - i / steps))) for i in range(steps + 1)]
    with p.as_kind(PAINT):
        return p.sweep(pts, r, r, p.vary(color, 0.05), sides=5)


def drill_line(p, a, b, r, spacing, color=QUARRY_DEEP, out=(0, -1, 0)):
    """A row of half-drilled holes along a split face (the plug-and-feather
    marks a quarryman leaves): dark slots from a to b, each `r` across,
    painted a hair proud of a face whose outward normal is `out`."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    n = max(1, int(L / spacing))
    o = Vector(out).normalized()
    size = [r * 2, r * 2, r * 2]
    axis = max(range(3), key=lambda i: abs(o[i]))
    size[axis] = 0.05
    for i in range(n + 1):
        q = a.lerp(b, i / n) + o * 0.02
        p.box(tuple(q), tuple(size), color)


def light_chain(p, a, b, pitch, ring, bar, color, sag=0.0):
    """A chain from a to b sagging by `sag`, its links a quarter turn apart
    and cut from few facets (a chain drawn by the dozen: a rail, a hoist's
    fall). Returns the last link's end."""
    from gwkit import chain_link
    a, b = Vector(a), Vector(b)
    count = max(1, int((b - a).length / pitch))
    half = pitch * 0.5 - ring + bar * 2.0
    q1 = a
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
        chain_link(p, (q0 + q1) / 2, u, up if i % 2 else side, max(0.05, half), ring, bar, color, sides=5, segs=3)
    return q1
