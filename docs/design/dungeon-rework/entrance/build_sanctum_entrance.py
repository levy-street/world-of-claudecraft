"""Gravewyrm Sanctum world entrance: the Smith's Seal Gate (Thornpeak Heights).

  blender -b --factory-startup --python build_sanctum_entrance.py -- --out DIR
      [--terrain DIR] [--renders all|quick|beauty|maps|none]

Two black stone pylons and a cracked lintel cut with the Smith's runes (a
faint clean blue), the empty keystone socket, the two great chains (one
hanging broken from its ring, one fallen in a frosted heap across the gate
plaza), the rock-cut gate tunnel running back into the mountain, a small
unlit Vigil cairn facing the gate, two clusters of old headstones by the
flanking ruin rings, the cult's debris (goad irons, a toppled brazier, a
sledge with one broken runner), and a render-only tongue of blue glacier ice
hanging in a notch of the ridge far overhead (Thornpeak side only).

Run from the repo: --out tmp/asset_src/sanctum_seal_gate --terrain <dir of the
probe's sanctum_heightgrid.json and sanctum_surroundings.json> (probe.mts beside
this file writes them), then node scripts/assets/sanctum_seal_gate/build.mjs.

Local game coords via ec.B(lx, lz, y): lx = x - 0 (+ WEST), lz = z - 858
(+ NORTH), y = y - terrainHeight(0, 858). The gate faces SOUTH (the plaza and
the road). Materials: KitStone (lit stone, iron, wood), KitGlow (unlit runes),
KitIce (lit glacier ice and icicles).

Three GLBs share ONE origin, the door at its terrain height:
  sanctum_seal_gate.glb        pylons, lintel, socket, runes, tunnel, chains
  sanctum_seal_gate_props.glb  chain heap, headstones, cairn, cult debris,
                               ground blend rubble
  sanctum_seal_gate_ice.glb    the ice tongue and its notch (render only)
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'kit'))     # hckit.py (the pilot kit library)
sys.path.insert(0, HERE)
import entrance_common as ec  # noqa: E402
import hckit  # noqa: E402
from hckit import GLOW, STONE  # noqa: E402

ICE = 2
B = ec.B
# Blender 5's bmesh loop colour layer is a BYTE colour attribute: a float
# written to it is stored as sRGB, and the glTF exporter linearises on export.
# hckit linearises first as well, which darkened every colour twice (a 0.6
# grey shipped as 0.095 linear). Write the authored sRGB values unchanged.
hckit.srgb_to_linear = lambda c: tuple(c)


def _ordered_edges(faces):
    """The faces' edges in a stable order (a set of BMEdges iterates by memory
    address, which made the bevel's output order, and so the GLB bytes,
    change from run to run)."""
    seen, out = set(), []
    for f in faces:
        for e in f.edges:
            if e not in seen:
                seen.add(e)
                out.append(e)
    return out


def _box(self, center, size, color, mat=STONE, bevel=0.0, yaw=0.0, pitch=0.0, roll=0.0, taper=1.0):
    """hckit.Piece.box with a deterministic bevel input (same geometry)."""
    before = set(self.bm.faces)
    made = bmesh.ops.create_cube(self.bm, size=1.0)
    verts = made['verts']
    for v in verts:
        k = taper if v.co.z > 0 else 1.0
        v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2]))
    rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
    for v in verts:
        v.co = rot @ v.co + Vector(center)
    faces = self._new_faces(before)
    self._paint(faces, color, mat)
    if bevel > 0:
        out = bmesh.ops.bevel(self.bm, geom=_ordered_edges(faces), offset=bevel, segments=1, affect='EDGES',
                              clamp_overlap=True)
        self._paint(out['faces'], color, mat)
    return faces


hckit.Piece.box = _box
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default


OUT = arg('--out', os.path.join(HERE, 'out'))
TERRAIN = arg('--terrain', os.path.join(HERE, '..', 'terreno'))
RENDERS = arg('--renders', 'all')
os.makedirs(OUT, exist_ok=True)
GR = ec.Ground(os.path.join(TERRAIN, 'sanctum_heightgrid.json'))
SURR = json.load(open(os.path.join(TERRAIN, 'sanctum_surroundings.json')))
gh = GR.h

# ---- palette (sRGB; hckit converts to linear at finish) -----------------------------
BLACK = (0.15, 0.16, 0.19)          # the Smith's black stone
BLACK_EDGE = (0.22, 0.23, 0.27)
BLACK_DEEP = (0.09, 0.095, 0.11)
SLATE = (0.29, 0.31, 0.345)         # bare rock slate #4A5058
SLATE_DARK = (0.2, 0.21, 0.235)
SLATE_PALE = (0.4, 0.42, 0.45)
MOUNTAIN = (0.6, 0.59, 0.58)       # the mountain's own rock (the terrain's rock tone)
MOUNTAIN_DARK = (0.44, 0.44, 0.45)
RIME = (0.9, 0.95, 0.98)            # snow and rime white #EEF6FA
FROST = (0.72, 0.8, 0.86)
IRON = (0.227, 0.239, 0.259)        # old iron chain #3A3D42
IRON_DARK = (0.14, 0.145, 0.155)
RUST = (0.34, 0.25, 0.19)
RUNE = (0.353, 0.722, 1.0)          # the Smith's rune and ember blue #5AB8FF
RUNE_DIM = (0.2, 0.42, 0.62)
ICE_C = (0.5, 0.77, 0.91)           # glacier blue #7FC4E8
ICE_DEEP = (0.18, 0.435, 0.62)      # deep ice #2E6F9E
ICE_WHITE = (0.82, 0.92, 0.97)
GRAVE = (0.62, 0.62, 0.63)
GRAVE_DARK = (0.47, 0.47, 0.5)
WOOD = (0.36, 0.27, 0.19)
WOOD_DARK = (0.24, 0.18, 0.13)
SOOT = (0.08, 0.075, 0.075)
VOID = (0.02, 0.022, 0.03)

COLLIDERS = []
FOOTINGS = []

# ---- layout (local; mirrored in src/sim/sanctum_seal_gate.ts) -----------------------
PLINTH = dict(x0=2.0, x1=5.3, z0=-1.3, z1=2.8, top=1.4)
SHAFT = dict(x0=2.4, x1=5.0, z0=-0.9, z1=2.4, y0=1.4, y1=10.4)
LINTEL = dict(x=8.0, y0=10.9, y1=13.3, z0=-1.4, z1=2.5)
SOCKET = dict(bot=0.75, top=1.3)      # half widths of the keystone gap
TUNNEL_HW = 3.6                       # inner half width of the rock-cut tunnel
TUNNEL_END = 28.0                     # the tunnel's dark far end (z 886)
ROCK_FRONT = 2.2
# Outcrop stations: (lz, west half width, east half width, top y, tunnel roof
# above the floor). East (-x) is bounded by the east ruin ring (-12, 862) and
# west (+x) by the west ring (12, 858): both rings stay, so the rock is narrow
# at the gate and widens only behind them.
STATIONS = [
    (2.2, 5.3, 5.3, 15.8, 9.6),
    (4.0, 5.9, 5.2, 16.6, 9.5),
    (6.0, 7.6, 5.4, 17.4, 9.3),
    (8.0, 9.4, 6.0, 18.0, 9.2),
    (10.5, 10.6, 8.0, 18.8, 9.0),
    (13.5, 11.4, 10.2, 19.6, 8.9),
    (17.0, 11.8, 11.2, 20.6, 8.8),
    (21.0, 11.6, 11.4, 21.8, 8.7),
    (25.0, 11.2, 11.2, 23.0, 8.6),
    (28.0, 11.0, 11.0, 24.0, 8.5),
    (32.0, 11.0, 11.2, 26.5, None),
    (36.0, 11.4, 11.6, 30.0, None),
    (40.0, 12.0, 12.0, 34.0, None),
    (44.0, 12.0, 12.0, 37.0, None),
]


def P(name, **kw):
    return hckit.Piece('Entrance_' + name, **kw)


def collider_obb(name, cx, cz, hw, hd, rot, top, note='', stand=None):
    row = {'name': name, 'type': 'obb', 'lx': round(cx, 3), 'lz': round(cz, 3), 'hw': round(hw, 3),
           'hd': round(hd, 3), 'rot': round(rot, 4), 'topLocalY': round(top, 2), 'note': note}
    if stand is not None:
        row['standTopLocalY'] = round(stand, 2)
    COLLIDERS.append(row)


def collider_circle(name, cx, cz, r, top, note='', stand=None):
    row = {'name': name, 'type': 'circle', 'lx': round(cx, 3), 'lz': round(cz, 3), 'r': round(r, 3),
           'topLocalY': round(top, 2), 'note': note}
    if stand is not None:
        row['standTopLocalY'] = round(stand, 2)
    COLLIDERS.append(row)


def footing(name, cx, cz, hw, hd, rot, bottom):
    FOOTINGS.append((name, cx, cz, hw, hd, rot, bottom))


def ground_min(cx, cz, hw, hd, rot=0.0):
    return GR.footprint_range(cx, cz, hw, hd, rot, 0.25)[0]


def hexa(p, corners, color, mat=STONE, bevel=0.0):
    """A hexahedron from 8 Blender-space corners: bottom 0..3 then top 4..7,
    both in the same winding."""
    before = set(p.bm.faces)
    v = [p.bm.verts.new(Vector(c)) for c in corners]
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        p.bm.faces.new([v[i] for i in idx])
    faces = p._new_faces(before)
    bmesh.ops.recalc_face_normals(p.bm, faces=faces)
    p._paint(faces, color, mat)
    if bevel > 0:
        out = bmesh.ops.bevel(p.bm, geom=_ordered_edges(faces), offset=bevel, segments=1, affect='EDGES',
                              clamp_overlap=True)
        p._paint(out['faces'], color, mat)
    return faces


def quad(p, corners, color, mat=STONE):
    """One quad facing south (Blender +Y), corners in Blender space."""
    before = set(p.bm.faces)
    v = [p.bm.verts.new(Vector(c)) for c in corners]
    f = p.bm.faces.new(v)
    f.normal_update()
    if f.normal.y < 0:
        f.normal_flip()
    faces = p._new_faces(before)
    p._paint(faces, color, mat)
    return faces


def finish_keep_normals(p, mats, parent):
    """hckit's finish without its global normal recalculation: the lofted
    open rock surfaces are wound outward by construction, and the heuristic
    can flip a whole open skin inward."""
    orig = bmesh.ops.recalc_face_normals
    # keep the winding, but still compute every face normal the weathering reads
    bmesh.ops.recalc_face_normals = lambda bm, faces=None: bm.normal_update()
    try:
        return p.finish(mats, parent)
    finally:
        bmesh.ops.recalc_face_normals = orig


def block(p, x0, x1, z0, z1, y0, y1, color, bevel=0.06, jitter=0.0):
    """An axis-aligned block from LOCAL game bounds (lx, lz, y)."""
    j = (lambda: (p.rng.random() - 0.5) * jitter) if jitter else (lambda: 0.0)
    c = [B(x0 + j(), z0 + j(), y0), B(x1 + j(), z0 + j(), y0), B(x1 + j(), z1 + j(), y0), B(x0 + j(), z1 + j(), y0),
         B(x0 + j(), z0 + j(), y1), B(x1 + j(), z0 + j(), y1), B(x1 + j(), z1 + j(), y1), B(x0 + j(), z1 + j(), y1)]
    return hexa(p, c, color, bevel=bevel)


def frost_top(p, x0, x1, z0, z1, y, color=RIME, th=0.06):
    """Rime crusted on an upward face: a few drifted, irregular patches that
    gather toward the edges, never a full white slab."""
    rng = random.Random(int(abs(x0 * 131 + z0 * 71 + y * 17)) + 3)
    w, d = x1 - x0, z1 - z0
    n = max(2, int(w * d / 4.0))
    for k in range(n):
        px = x0 + w * (0.15 + 0.7 * rng.random())
        pz = z0 + d * (0.15 + 0.7 * rng.random())
        sx = min(w * 0.45, 0.5 + rng.random() * 0.9)
        sz = min(d * 0.45, 0.4 + rng.random() * 0.8)
        p.rock(B(px, pz, y + th * 0.25), (sx, sz, th * 2.2), color, jitter=0.35, subdivisions=0, flat_bottom=True)


def icicles(p, x0, x1, lz, y, n, max_len=0.9, seed=0):
    rng = random.Random(seed)
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.2 + rng.random() * 0.6) / n
        ln = max_len * (0.3 + rng.random() * 0.7)
        r = 0.05 + rng.random() * 0.06
        p.prism(B(x, lz + (rng.random() - 0.5) * 0.15, y), 5, r, 0.0001, -ln, ICE_WHITE, mat=ICE,
                phase=rng.random())


# ---- the Smith's runes ------------------------------------------------------------------
# Each glyph is a set of strokes in a unit cell (u across, v up): a hammer, an
# anvil, a chain link, a mountain, a binding knot, the quench (three falling
# lines), the flame, the seal. Angular smith's marks, cut and lit from within.
GLYPHS = [
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.75), (0.85, 1.0)), ((0.5, 0.45), (0.85, 0.7)), ((0.5, 0.2), (0.18, 0.0))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.15, 0.55), (0.5, 0.85)), ((0.5, 0.85), (0.85, 0.55)), ((0.28, 0.12), (0.72, 0.3))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 1.0), (0.85, 0.8)), ((0.85, 0.8), (0.5, 0.6)), ((0.5, 0.35), (0.18, 0.15))],
    [((0.3, 0.0), (0.3, 1.0)), ((0.7, 0.0), (0.7, 1.0)), ((0.3, 0.85), (0.7, 0.55)), ((0.3, 0.45), (0.7, 0.15))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.95), (0.15, 0.65)), ((0.15, 0.65), (0.5, 0.35)), ((0.5, 0.35), (0.85, 0.1))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.5, 0.9), (0.82, 0.75)), ((0.5, 0.6), (0.82, 0.45)), ((0.5, 0.3), (0.82, 0.15))],
    [((0.35, 0.0), (0.35, 0.7)), ((0.35, 0.7), (0.68, 1.0)), ((0.35, 0.4), (0.75, 0.4)), ((0.75, 0.4), (0.75, 0.0))],
    [((0.5, 0.0), (0.5, 1.0)), ((0.2, 0.32), (0.8, 0.72)), ((0.2, 0.72), (0.5, 0.52)), ((0.5, 1.0), (0.2, 0.86))],
]


def rune(p, glyph, cx, y0, size, face_lz, lit=True, depth=0.07, width=0.075):
    """Cut one glyph into a south-facing face at local z face_lz: a dark
    incised groove with the lit stroke set into it."""
    for (u0, v0), (u1, v1) in GLYPHS[glyph % len(GLYPHS)]:
        ax, ay = cx + (u0 - 0.5) * size, y0 + v0 * size
        bx, by = cx + (u1 - 0.5) * size, y0 + v1 * size
        ln = math.hypot(bx - ax, by - ay)
        ang = math.atan2(by - ay, bx - ax)
        # A stroke is two south-facing quads on the face: the dark incised
        # groove and, just proud of it, the lit inlay (seen only from the front).
        ux, uy = (bx - ax) / max(ln, 1e-6), (by - ay) / max(ln, 1e-6)
        nx, ny = -uy, ux
        for (ext, wid, off, col, mat) in ((width * 0.8, width * 0.85, 0.012, BLACK_DEEP, STONE),
                                           (width * 0.2, width * 0.5, 0.026, RUNE if lit else RUNE_DIM,
                                            GLOW if lit else STONE)):
            pts = []
            for (su, sv) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                px = (ax if su < 0 else bx) + su * ux * ext + sv * nx * wid
                py = (ay if su < 0 else by) + su * uy * ext + sv * ny * wid
                pts.append(B(px, face_lz - off, py))
            quad(p, pts, col, mat)


# ================================================================ pylons and lintel
RING_X = 2.95       # the anchor rings sit on the pylon faces beside the opening
RING_Y = 9.6
RING_LZ = SHAFT['z0'] - 0.75
PANEL_X = 3.95      # the rune column's centre (|x|)


def pylons():
    p = P('Pylons', weather=0.55, lichen=0.0)
    for s in (-1, 1):
        tag = 'w' if s > 0 else 'e'
        # Plinth: two coursed footing rings of big blocks, buried into the rising
        # ground behind (the back stands on about +0.7, the front on -0.05).
        x0, x1 = PLINTH['x0'], PLINTH['x1']
        gx0, gx1 = (x0, x1) if s > 0 else (-x1, -x0)
        cx = (gx0 + gx1) / 2
        cz = (PLINTH['z0'] + PLINTH['z1']) / 2
        g_lo = ground_min(cx, cz, (x1 - x0) / 2, (PLINTH['z1'] - PLINTH['z0']) / 2)
        bottom = g_lo - 0.55
        footing(f'plinth_{tag}', cx, cz, (x1 - x0) / 2, (PLINTH['z1'] - PLINTH['z0']) / 2, 0.0, bottom)
        zs = [PLINTH['z0'], 0.15, 1.45, PLINTH['z1']]
        for a, b in zip(zs, zs[1:]):
            block(p, gx0, gx1, a + 0.01, b - 0.01, bottom, 0.62, p.vary(BLACK, 0.08), bevel=0.07)
        xs = [gx0 + 0.1, cx + 0.2 * s, gx1 - 0.1]
        for a, b in zip(xs, xs[1:]):
            block(p, a + 0.01, b - 0.01, PLINTH['z0'] + 0.12, PLINTH['z1'] - 0.12, 0.62, PLINTH['top'],
                  p.vary(BLACK, 0.07), bevel=0.08)
        p.box(B(cx, PLINTH['z0'] + 0.05, 1.3), (gx1 - gx0 - 0.1, 0.32, 0.16), BLACK_EDGE, bevel=0.04)
        frost_top(p, gx0 + 0.1, gx1 - 0.1, PLINTH['z0'] + 0.12, PLINTH['z1'] - 0.12, PLINTH['top'])
        # Shaft: six courses of the Smith's black ashlar, the outer face battered.
        y = SHAFT['y0']
        heights = [1.55, 1.45, 1.5, 1.5, 1.45, 1.55]
        sx0, sx1 = (SHAFT['x0'], SHAFT['x1']) if s > 0 else (-SHAFT['x1'], -SHAFT['x0'])
        for k, h in enumerate(heights):
            batter = 0.045 * k
            ox0 = sx0 + (batter if s < 0 else 0)
            ox1 = sx1 - (batter if s > 0 else 0)
            split = (ox0 + ox1) / 2 + (0.45 if k % 2 else -0.45) * s
            for a, b in ((ox0, split), (split, ox1)):
                block(p, a + 0.012, b - 0.012, SHAFT['z0'], SHAFT['z1'], y + 0.012, y + h - 0.012,
                      p.vary(BLACK, 0.07), bevel=0.07)
            if k < 3:
                frost_top(p, ox0 + 0.05, ox1 - 0.05, SHAFT['z0'] + 0.02, SHAFT['z1'] - 0.02, y + h - 0.004,
                          FROST, th=0.03)
            y += h
        # Raised fillets framing the rune column on the south face.
        pcx = PANEL_X * s
        for fx in (-0.72, 0.72):
            p.box(B(pcx + fx, SHAFT['z0'] - 0.06, 5.55), (0.16, 0.14, 7.1), BLACK_EDGE, bevel=0.03)
        # The rune column: five glyphs; the lowest is dead under the rime.
        for k in range(6):
            rune(p, (k * 3 + (0 if s > 0 else 1)) % 8, pcx, 2.3 + k * 1.12, 0.78, SHAFT['z0'], lit=k >= 1)
        # Capital: a heavy slab with corbel steps carrying the lintel overhang.
        block(p, sx0 - 0.25, sx1 + 0.25, SHAFT['z0'] - 0.3, SHAFT['z1'] + 0.25, SHAFT['y1'], LINTEL['y0'],
              p.vary(BLACK_EDGE, 0.05), bevel=0.08)
        for (ext, y0, y1) in ((0.75, 8.9, 9.65), (1.45, 9.65, 10.4)):
            ox = sx1 if s > 0 else sx0
            a, b = (ox - 0.2, ox + ext) if s > 0 else (ox - ext, ox + 0.2)
            block(p, a, b, SHAFT['z0'] + 0.15, SHAFT['z1'] - 0.15, y0, y1, p.vary(BLACK, 0.06), bevel=0.06)
        # The chain anchor: a riveted iron plate, a projecting staple and the ring.
        ax = RING_X * s
        p.box(B(ax, SHAFT['z0'] - 0.07, RING_Y + 0.15), (1.05, 0.12, 1.25), IRON_DARK, bevel=0.03)
        for rx in (-0.36, 0.36):
            for ry in (-0.42, 0.42):
                p.lathe(B(ax + rx, SHAFT['z0'] - 0.13, RING_Y + 0.15 + ry), [(0.07, 0), (0.06, 0.05), (0.0, 0.07)],
                        5, IRON)
        p.box(B(ax, (SHAFT['z0'] + RING_LZ) / 2, RING_Y + 0.12), (0.32, abs(RING_LZ - SHAFT['z0']) + 0.1, 0.24),
              IRON_DARK, bevel=0.03)
        anchor_ring(p, ax, RING_LZ, RING_Y)
    for s, tag in ((-1, 'e'), (1, 'w')):
        x0, x1 = PLINTH['x0'], PLINTH['x1']
        z0 = RING_LZ - 0.55
        collider_obb(f'pylon_{tag}', s * (x0 + x1) / 2, (z0 + PLINTH['z1']) / 2, (x1 - x0) / 2,
                     (PLINTH['z1'] - z0) / 2, 0.0, LINTEL['y1'] + 0.6,
                     'pylon plinth and shaft; its inner face is the lane edge (|x| 2.0); its front reaches '
                     'the anchor ring and the hanging chain')
    return p


def anchor_ring(p, cx, lz, y, r=0.62, bar=0.15):
    """The great iron ring, hanging flat against the pylon face from its staple."""
    pts = []
    for i in range(15):
        a = math.tau * i / 14
        pts.append(B(cx + math.sin(a) * r, lz, y - r + math.cos(a) * r))
    p.sweep(pts, bar, bar, IRON, sides=6, cap=False)


def lintel():
    p = P('Lintel', weather=0.5, lichen=0.0)
    L = LINTEL
    for s in (-1, 1):
        inner_b, inner_t = SOCKET['bot'], SOCKET['top']
        x_out = L['x'] * s

        def X(v, s=s):
            return v * s
        # One monolith per side, its inner end cut to the keystone's wedge.
        c = [B(X(inner_b), L['z0'], L['y0']), B(x_out, L['z0'], L['y0']), B(x_out, L['z1'], L['y0']),
             B(X(inner_b), L['z1'], L['y0']), B(X(inner_t), L['z0'], L['y1']), B(x_out, L['z0'], L['y1']),
             B(x_out, L['z1'], L['y1']), B(X(inner_t), L['z1'], L['y1'])]
        hexa(p, c, p.vary(BLACK, 0.05), bevel=0.09)
        # The end faces: a chamfered boss.
        p.box(B(x_out + 0.03 * s, (L['z0'] + L['z1']) / 2, (L['y0'] + L['y1']) / 2), (0.12, 2.6, 1.6),
              BLACK_EDGE, bevel=0.04)
        # Cornice: a projecting cap in two blocks per side, broken at the socket.
        for a, b in ((inner_t + 0.25, 4.3), (4.3, L['x'] + 0.35)):
            lo, hi = sorted((X(a), X(b)))
            block(p, lo, hi, L['z0'] - 0.22, L['z1'] + 0.2, L['y1'], L['y1'] + 0.55, p.vary(BLACK_EDGE, 0.05),
                  bevel=0.07)
            frost_top(p, lo + 0.05, hi - 0.05, L['z0'] - 0.18, L['z1'] + 0.16, L['y1'] + 0.55)
        # A soffit fillet under the lintel and the rune band across its face.
        p.box(B(s * (inner_b + L['x']) / 2, L['z0'] + 0.25, L['y0'] - 0.08), (L['x'] - inner_b - 0.4, 0.5, 0.18),
              BLACK_EDGE, bevel=0.03)
        for k in range(4):
            gx = s * (inner_t + 1.15 + k * 1.55)
            # The glyph nearest the broken socket is dead: the seal is broken.
            rune(p, (k * 5 + (2 if s > 0 else 6)) % 8, gx, L['y0'] + 0.65, 0.95, L['z0'], lit=k >= 1)
        icicles(p, s * (inner_b + 0.3), s * (L['x'] - 0.4), L['z0'] + 0.35, L['y0'] - 0.18, 9, 1.1, seed=31 + s)
    # The empty keystone socket: cracked faces, broken lips, shards still
    # caught in it, and a crack running away across the lintel's face.
    rng = random.Random(7)
    for s in (-1, 1):
        for k in range(4):
            t = (k + 0.5) / 4
            y = L['y0'] + (L['y1'] - L['y0']) * t
            w = SOCKET['bot'] + (SOCKET['top'] - SOCKET['bot']) * t
            p.box(B(s * (w + 0.04), L['z0'] + 0.5 + rng.random() * 1.8, y), (0.12, 0.5 + rng.random() * 0.6, 0.3),
                  BLACK_DEEP, roll=s * 0.2)
        for k in range(2):
            y = L['y0'] + 0.3 + rng.random() * 1.8
            p.rock(B(s * (SOCKET['bot'] + 0.15 + rng.random() * 0.2), L['z0'] + 0.3 + rng.random() * 2.0, y),
                   (0.4, 0.35, 0.3), BLACK_EDGE, jitter=0.3, subdivisions=0)
        x, y = SOCKET['bot'] * s, L['y0'] + 0.35
        for k in range(6):
            nx = x + s * (0.55 + rng.random() * 0.4)
            ny = y + (rng.random() - 0.35) * 0.45
            quad(p, [B(x, L['z0'] - 0.012, y - 0.04), B(nx, L['z0'] - 0.012, ny - 0.04),
                     B(nx, L['z0'] - 0.012, ny + 0.04), B(x, L['z0'] - 0.012, y + 0.04)], VOID)
            x, y = nx, ny
    return p


# ================================================================ the rock-cut tunnel
def _stations_fine(step=1.6):
    out = []
    for (a, b) in zip(STATIONS, STATIONS[1:]):
        n = max(1, int(round((b[0] - a[0]) / step)))
        for k in range(n):
            t = k / n
            lz = a[0] + (b[0] - a[0]) * t
            W = a[1] + (b[1] - a[1]) * t
            E = a[2] + (b[2] - a[2]) * t
            top = a[3] + (b[3] - a[3]) * t
            roof = None if a[4] is None or b[4] is None else a[4] + (b[4] - a[4]) * t
            if a[4] is not None and b[4] is None:
                roof = a[4] if k == 0 else None
            out.append((lz, W, E, top, roof))
    out.append(STATIONS[-1])
    return out


def _profile_outer(lz, W, E, top, n=34, seed=0.0):
    pts = []
    tame = min(1.0, 0.6 + max(0.0, lz - ROCK_FRONT) / 6.0)
    for i in range(n + 1):
        th = math.pi * (1 - i / n)            # pi (east, -x) .. 0 (west, +x)
        c = math.cos(th)
        half = W if c >= 0 else E
        x = c * half
        sn = max(0.0, math.sin(th))
        base = gh(x, lz) - 0.9
        # a crag, not a dome: steep flanks, a broken uneven crest
        crest = top + (ec.fbm2(x * 0.22 + 7, lz * 0.22) - 0.5) * 4.0 * tame
        y = base + (crest - base) * (sn ** 0.32)
        nrm = Vector((c, 0.0, sn)).normalized()
        d = (ec.fbm2(x * 0.3 + seed, lz * 0.3 + y * 0.2) - 0.5) * 2.2
        d += (ec.fbm2(x * 1.1 - 3 + seed, lz * 1.1 + y * 0.8) - 0.5) * 0.7
        # vertical ribs down the flanks
        d += 0.45 * math.sin(lz * 1.3 + y * 0.35 + c * 2.0) * (1 - sn)
        d *= tame
        if 0 < i < n:
            x += nrm.x * d
            y += nrm.z * d
            y = y - (y % 1.15) * 0.18          # strata ledges
            if lz < 10.5:                      # never into the ruin rings
                x = max(-(E + 0.3), min(W + 0.3, x))
        pts.append((x, y))
    return pts


def _profile_inner(lz, floor_c, roof, m=18):
    """The tunnel's cross-section: battered walls and a flattened cut vault."""
    pts = []
    for i in range(m + 1):
        th = math.pi * (1 - i / m)
        c = math.cos(th)
        x = c * TUNNEL_HW
        sn = math.sin(th)
        fl = gh(x, lz) - 0.6
        y = fl + (floor_c + roof - fl) * (sn ** 0.62)
        if 0 < i < m:
            jit = (ec.fbm2(x * 1.7 + lz * 0.9, y * 1.3) - 0.5) * 0.35
            x += c * jit
            y += sn * jit * 0.6
        pts.append((x, y))
    return pts


def _stitch(bm, A, Bv):
    """Triangulate the band between two open polylines of BMVerts (south facing
    when A runs over B east to west)."""
    la = [0.0]
    for a, b in zip(A, A[1:]):
        la.append(la[-1] + (a.co - b.co).length)
    lb = [0.0]
    for a, b in zip(Bv, Bv[1:]):
        lb.append(lb[-1] + (a.co - b.co).length)
    ta = [v / la[-1] for v in la]
    tb = [v / lb[-1] for v in lb]
    i = j = 0
    faces = []
    while i < len(A) - 1 or j < len(Bv) - 1:
        if j >= len(Bv) - 1 or (i < len(A) - 1 and ta[i + 1] <= tb[j + 1]):
            faces.append(bm.faces.new((A[i], A[i + 1], Bv[j])))
            i += 1
        else:
            faces.append(bm.faces.new((A[i], Bv[j + 1], Bv[j])))
            j += 1
    return faces


def floor_grid(p, step=0.9):
    bm = p.bm
    before = set(bm.faces)
    xs = [-TUNNEL_HW + 0.1 + i * (2 * TUNNEL_HW - 0.2) / 8 for i in range(9)]
    zs = []
    z = PLINTH['z0']
    while z < TUNNEL_END + 0.2:
        zs.append(z)
        z += step
    rows = []
    for lz in zs:
        lift = 0.03 if lz < 1.0 else min(0.12, 0.03 + (lz - 1.0) * 0.06)
        row = []
        for x in xs:
            xx = x if lz > PLINTH['z1'] else x * (PLINTH['x0'] - 0.02) / (TUNNEL_HW - 0.1)
            row.append(bm.verts.new(B(xx, lz, gh(xx, lz) + lift)))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for i in range(len(ra) - 1):
            bm.faces.new((ra[i], rb[i], rb[i + 1], ra[i + 1]))
    rng = random.Random(29)
    for f in [f for f in bm.faces if f not in before]:
        f.material_index = STONE
        k = 0.75 + rng.random() * 0.35
        for loop in f.loops:
            co = loop.vert.co
            lz = -co.y
            frost = max(0.0, 1 - (lz - PLINTH['z0']) / 8.0) * 0.8
            dark = min(1.0, max(0.0, (lz - 5.0) / 12.0))
            col = tuple(c * k for c in SLATE)
            col = tuple(c * (1 - frost) + r * frost for c, r in zip(col, FROST))
            col = tuple(c * (1 - 0.8 * dark) for c in col)
            loop[p.col] = (*col, 1.0)


def tunnel():
    p = P('Tunnel', weather=0.9, lichen=0.12)
    bm = p.bm
    before = set(bm.faces)
    outer_rings, inner_rings = [], []
    for k, (lz, W, E, top, roof) in enumerate(_stations_fine()):
        prof = _profile_outer(lz, W, E, top, seed=k * 0.37)
        outer_rings.append([bm.verts.new(B(x, lz, y)) for (x, y) in prof])
        if roof is not None:
            floor_c = gh(0, lz)
            inner_rings.append([bm.verts.new(B(x, lz, y)) for (x, y) in _profile_inner(lz, floor_c, roof)])
    # Winding (Blender: X = lx, Y = -lz): the outer skin faces out of the rock,
    # the inner skin faces into the tunnel.
    for ra, rb in zip(outer_rings, outer_rings[1:]):
        for i in range(len(ra) - 1):
            bm.faces.new((ra[i], rb[i], rb[i + 1], ra[i + 1]))
    for ra, rb in zip(inner_rings, inner_rings[1:]):
        for i in range(len(ra) - 1):
            bm.faces.new((ra[i], ra[i + 1], rb[i + 1], rb[i]))
    _stitch(bm, outer_rings[0], inner_rings[0])
    bm.faces.new(list(reversed(outer_rings[-1])))
    tun_faces = [f for f in bm.faces if f not in before]
    # new faces carry no normal until updated: the snow and crack tints read it
    bm.normal_update()
    for f in tun_faces:
        f.material_index = STONE
        for loop in f.loops:
            co = loop.vert.co
            lx, lz, y = co.x, -co.y, co.z
            inside = abs(lx) < TUNNEL_HW + 0.6 and lz < TUNNEL_END + 0.5 and y < gh(0, lz) + 9.9
            band = 0.86 + 0.14 * math.sin(y * 2.7 + ec.fbm2(lx * 0.5, lz * 0.5) * 3)
            tone = 0.85 + 0.3 * ec.fbm2(lx * 0.25 + 4, y * 0.3 + lz * 0.15)
            col = tuple(c * band * tone for c in (SLATE_DARK if inside else MOUNTAIN))
            if not inside and f.normal.z < 0.2:
                # cracks and overhangs read darker
                col = tuple(c * (0.75 + 0.25 * max(0.0, f.normal.z + 0.8)) for c in col)
            if inside:
                # The cold breathing out of the mouth rimes the first yards; the
                # depth swallows the rest.
                depth = max(0.0, 1 - (lz - ROCK_FRONT) / 9.0)
                fr = depth * max(0.0, 1 - (y - gh(lx, lz)) / 3.5) * 0.85
                col = tuple(c * (1 - fr) + f_ * fr for c, f_ in zip(col, FROST))
                dark = min(1.0, max(0.0, (lz - 5.0) / 12.0))
                col = tuple(c * (1 - 0.8 * dark) for c in col)
            else:
                # snow lodged on the outcrop's upward ledges
                up = max(0.0, f.normal.z)
                snow = max(0.0, up - 0.55) * 1.8 * ec.fbm2(lx * 0.6, lz * 0.6 + y)
                col = tuple(c * (1 - snow) + r * snow for c, r in zip(col, RIME))
            loop[p.col] = (*col, 1.0)
    # The tunnel's far end: the darkness the mist pours out of.
    cap = bm.faces.new(inner_rings[-1])
    p._paint([cap], VOID, STONE)
    # Rock-cut reveal blocks lining the mouth's first yards (tool-dressed).
    rng = random.Random(3)
    for s in (-1, 1):
        for k in range(3):
            lz0 = ROCK_FRONT + 0.2 + k * 1.6
            fl = gh(s * TUNNEL_HW, lz0 + 0.8)
            a, b = sorted((s * (TUNNEL_HW - 0.3), s * (TUNNEL_HW + 0.15)))
            block(p, a, b, lz0 + 0.04, lz0 + 1.56, fl - 0.5, fl + 2.4 + rng.random() * 0.6, p.vary(SLATE_DARK, 0.08),
                  bevel=0.05)
    # The tunnel floor: worn, frost-rimed flags over the ground, from the
    # threshold between the plinths back into the dark. 0.12 over the sim
    # ground inside (the render terrain's 1.2 yd lattice never pokes through),
    # 0.03 at the threshold, where the door pad is flat.
    floor_grid(p)
    for (lz, W, E, top, roof) in STATIONS[:10]:
        for s, half in ((1, W), (-1, E)):
            footing(f'outcrop_{"w" if s > 0 else "e"}_{lz:g}', s * half, lz, 0.4, 0.4, 0.0, gh(s * half, lz) - 0.9)
    return p


def tunnel_colliders():
    """Rock walls, per station interval and flank: an axis-aligned slab from the
    tunnel wall (or the axis, behind the tunnel) out to the narrower of the two
    station widths, plus a wedge OBB laid along the skirt line between them.
    0.35 inside the visual skirt, which the rock's noise lumps both ways."""
    for i in range(len(STATIONS) - 1):
        za, Wa, Ea, ta, ra = STATIONS[i]
        zb, Wb, Eb, tb, rb = STATIONS[i + 1]
        if za >= 36.0:
            break
        top = max(ta, tb)
        tunnel_here = ra is not None and rb is not None
        for s, ha, hb, tag in ((1, Wa, Wb, 'w'), (-1, Ea, Eb, 'e')):
            ha_, hb_ = ha - 0.35, hb - 0.35
            inner = TUNNEL_HW if tunnel_here else 0.0
            lo = min(ha_, hb_)
            if lo - inner > 0.2:
                collider_obb(f'rock_{tag}_{za:g}', s * (inner + lo) / 2, (za + zb) / 2, (lo - inner) / 2,
                             (zb - za) / 2 + 0.05, 0.0, top, 'outcrop flank slab (rock-cut tunnel wall)')
            if abs(hb_ - ha_) > 0.3:
                dx, dz = s * (hb_ - ha_), zb - za
                ln = math.hypot(dx, dz)
                rot = math.atan2(dx, dz)
                thick = abs(hb_ - ha_) * math.cos(rot) + 0.2
                mx = s * (ha_ + hb_) / 2 - s * (thick / 2) * math.cos(rot)
                mz = (za + zb) / 2 + s * (thick / 2) * math.sin(rot)
                collider_obb(f'rock_{tag}_{za:g}_skirt', mx, mz, thick / 2, ln / 2, rot, top,
                             'outcrop flank skirt wedge')
    collider_obb('tunnel_end', 0.0, TUNNEL_END + 0.6, TUNNEL_HW + 0.2, 0.7, 0.0, STATIONS[9][3],
                 'the tunnel\'s dark far end')


# ================================================================ chains
def chain_link(p, center, axis, side, length=1.75, width=1.05, bar=0.22, color=IRON, broken=False, sides=6,
               n=14):
    """One great link: a stadium loop swept in its own plane. axis is the link's
    long direction, side its width direction (Blender vectors). A broken link
    is open at the -axis end (the snapped end)."""
    center, axis, side = Vector(center), Vector(axis).normalized(), Vector(side).normalized()
    a = (length - width) / 2
    rr = width / 2 - bar * 0.4
    pts = []
    for i in range(n + 1):
        ang = math.tau * i / n
        u = math.cos(ang) * rr + (a if math.cos(ang) >= 0 else -a)
        v = math.sin(ang) * rr
        pts.append(center + axis * u + side * v)
    if broken:
        h = n // 2
        pts = pts[h + 2:] + pts[1:h - 1]
    p.sweep(pts, bar, bar, color, sides=sides, cap=broken)


PITCH = 1.34


def hanging_chain(p, x, lz, top_y, links, broken_last=True, sway=0.03):
    y = top_y - 0.875 + 0.33
    for k in range(links):
        side = Vector((1, 0, 0)) if k % 2 else Vector((0, 1, 0))
        cen = B(x + sway * k, lz - sway * 0.5 * k, y)
        chain_link(p, cen, Vector((0, 0, 1)), side, broken=broken_last and k == links - 1,
                   color=RUST if k == 1 else p.vary(IRON, 0.1))
        p.rock(cen + Vector((0, 0, 0.66)), (0.34, 0.34, 0.1), RIME, jitter=0.2, subdivisions=0)
        y -= PITCH


def chains():
    p = P('Chains', weather=0.4, lichen=0.0)
    ring_bottom = RING_Y - 2 * 0.62
    # The east chain: broken, three links and a snapped fourth still hanging.
    hanging_chain(p, -RING_X, RING_LZ, ring_bottom, 4)
    # The west ring's stub: a link and a half; the rest lies in the plaza.
    hanging_chain(p, RING_X, RING_LZ, ring_bottom, 2, sway=-0.02)
    return p


# ================================================================ props
def _resample(path, step):
    out = []
    acc = 0.0
    for (x0, z0), (x1, z1) in zip(path, path[1:]):
        L = math.hypot(x1 - x0, z1 - z0)
        t = acc
        while t < L:
            out.append((x0 + (x1 - x0) * t / L, z0 + (z1 - z0) * t / L, math.atan2(x1 - x0, z1 - z0)))
            t += step
        acc = t - L
    return out


CHAIN_PATH = [(3.1, -2.4), (4.1, -3.7), (4.9, -5.3), (5.0, -6.9), (4.7, -8.3)]
HEAP = (5.2, -10.0)


def fallen_chain(p):
    """The west chain fell when the cult broke the seal: it lies from the west
    pylon's foot across the plaza and ends in a frost-covered heap."""
    rng = random.Random(19)
    for k, (x, z, yaw) in enumerate(_resample(CHAIN_PATH, PITCH)):
        g = gh(x, z)
        axis = Vector((math.sin(yaw), -math.cos(yaw), 0.0))
        if k % 2:
            side, cy = Vector((0, 0, 1)), g + 0.45
        else:
            side, cy = axis.cross(Vector((0, 0, 1))), g + 0.18
        chain_link(p, B(x, z, cy), axis, side, color=p.vary(IRON, 0.12))
        p.rock(B(x, z, cy + (0.5 if k % 2 else 0.2)), (0.5, 0.4, 0.08), RIME, jitter=0.25, subdivisions=0)
    hx, hz = HEAP
    g = gh(hx, hz)
    for k in range(10):
        a = rng.random() * math.tau
        r = 0.35 + rng.random() * 1.05
        x, z = hx + math.cos(a) * r, hz + math.sin(a) * r
        lift = max(0.0, 0.85 - r * 0.55)
        yaw = rng.random() * math.tau
        tilt = (rng.random() - 0.5) * 1.2
        axis = Vector((math.cos(yaw), math.sin(yaw), tilt * 0.3)).normalized()
        side = axis.cross(Vector((0, 0, 1))).normalized()
        side = (side * math.cos(tilt) + Vector((0, 0, 1)) * math.sin(tilt)).normalized()
        chain_link(p, B(x, z, gh(x, z) + 0.22 + lift), axis, side, color=p.vary(IRON, 0.12))
    for k in range(6):
        a = rng.random() * math.tau
        r = rng.random() * 1.1
        x, z = hx + math.cos(a) * r, hz + math.sin(a) * r
        p.rock(B(x, z, gh(x, z) + 0.05), (1.2 - r * 0.3, 1.0 - r * 0.3, 0.35 + (1.2 - r) * 0.35), RIME,
               jitter=0.25, subdivisions=1, flat_bottom=True)
    collider_circle('chain_heap', hx, hz, 1.7, g + 1.3, 'the fallen chain\'s frosted heap (standable)', stand=g + 1.1)
    footing('chain_heap', hx, hz, 1.5, 1.5, 0.0, g - 0.05)


def headstone(p, x, z, w, h, yaw, lean, seed, cross=False):
    rng = random.Random(seed)
    lo = ground_min(x, z, w / 2 + 0.05, 0.2, yaw)
    hi = GR.footprint_range(x, z, w / 2 + 0.05, 0.2, yaw, 0.25)[1]
    bury = 0.35
    bottom = lo - bury
    thick = 0.2 + rng.random() * 0.08
    col = p.vary(GRAVE if rng.random() < 0.6 else GRAVE_DARK, 0.08)
    # Built at its own origin, bottom at 0: the stone's top stands h above the
    # HIGHEST ground under it, so on a slope it is sunk on the uphill side.
    hh = (hi - lo) + bury + h
    m = p.mark()
    p.box((0, 0, hh / 2), (w, thick, hh), col, bevel=0.035)
    if cross:
        p.box((0, 0, hh + 0.42), (0.18, thick * 0.9, 0.9), col, bevel=0.03)
        p.box((0, 0, hh + 0.55), (0.7, thick * 0.9, 0.17), col, bevel=0.03)
        top = hh + 0.87
    else:
        p.prism((0, thick / 2, hh), 8, w / 2, w / 2, thick, col, axis=(0, -1, 0))
        top = hh + w / 2
    # The Vigil's mark, a worn open-eye chevron on the south face, and rime.
    for r in (0.5, -0.5):
        p.box((0, thick / 2 + 0.006, hh * 0.78), (w * 0.42, 0.02, 0.06), GRAVE_DARK, roll=r)
    p.box((0, 0, top - 0.02), (w * 0.75 if not cross else 0.75, thick + 0.04, 0.05), RIME)
    p.turn(m, Matrix.Translation(B(x, z, bottom)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(lean, 4, 'X'))
    footing(f'headstone_{x:g}_{z:g}', x, z, w / 2, thick / 2, yaw, bottom)
    collider_obb(f'headstone_{x:g}_{z:g}', x, z, w / 2 + 0.05, 0.2, yaw, hi + h + 0.3, 'old Vigil headstone')
    # a frosted grave mound in front (south) of each stone
    mx, mz = x - math.sin(yaw) * 1.15, z - math.cos(yaw) * 1.15
    p.rock(B(mx, mz, gh(mx, mz) - 0.06), (w + 0.35, 1.6, 0.3), (0.31, 0.35, 0.27), jitter=0.2, subdivisions=1,
           flat_bottom=True)


# The two graveyard clusters, by the flanking ruin rings (both kept): the
# watchers who kept this post. (lx, lz, width, height, yaw, lean, cross)
GRAVES = [
    # east cluster, outside the east ring (-12, 862), on its far (east) side
    (-19.4, 1.2, 0.85, 1.25, 0.25, 0.05, False),
    (-20.8, 4.2, 0.75, 1.05, 0.1, -0.12, True),
    (-19.6, 7.6, 0.9, 1.3, -0.15, 0.08, False),
    (-21.9, 9.6, 0.7, 0.95, 0.35, 0.2, False),
    (-17.8, 10.8, 0.8, 1.15, -0.3, -0.06, False),
    (-22.6, 2.0, 0.7, 0.85, 0.5, 0.28, False),
    # west cluster, south-west of the west ring (12, 858)
    (13.2, -8.6, 0.85, 1.2, -0.2, 0.06, False),
    (15.6, -9.8, 0.75, 1.0, -0.4, -0.1, True),
    (12.4, -11.6, 0.9, 1.3, 0.05, 0.04, False),
    (16.4, -12.8, 0.7, 0.9, -0.55, 0.22, False),
    (14.2, -14.2, 0.8, 1.15, -0.25, -0.05, False),
]


def graveyard(p):
    for k, (x, z, w, h, yaw, lean, cross) in enumerate(GRAVES):
        headstone(p, x, z, w, h, yaw, lean, 100 + k, cross)


CAIRN = (-4.0, -16.5)


def cairn(p):
    """The Vigil cairn: a small unlit beacon of stacked stones facing the gate,
    older than Highwatch remembers. A cold iron fire-basket on top, never lit."""
    cx, cz = CAIRN
    rng = random.Random(41)
    lo = ground_min(cx, cz, 1.0, 1.0)
    y = lo - 0.3
    footing('cairn', cx, cz, 0.9, 0.9, 0.0, y)
    for course, (r, h, n) in enumerate(((1.05, 0.55, 8), (0.88, 0.5, 7), (0.7, 0.45, 6), (0.5, 0.4, 5))):
        for k in range(n):
            a = math.tau * (k + rng.random() * 0.3) / n + course * 0.4
            p.rock(B(cx + math.cos(a) * r * 0.62, cz + math.sin(a) * r * 0.62, y + h * 0.5),
                   (r * 0.85, r * 0.7, h * 1.15), p.vary(SLATE_PALE if k % 3 else GRAVE, 0.1), jitter=0.22,
                   subdivisions=1)
        y += h * 0.92
    p.rock(B(cx, cz, y + 0.1), (0.9, 0.9, 0.4), SLATE, jitter=0.2, subdivisions=1)
    for k in range(4):
        a = math.tau * k / 4 + 0.4
        bx, bz = cx + math.cos(a) * 0.32, cz + math.sin(a) * 0.32
        p.sweep([B(bx, bz, y + 0.2), B(bx + math.cos(a) * 0.16, bz + math.sin(a) * 0.16, y + 1.0)], 0.04, 0.04,
                IRON, sides=5)
    ring = [B(cx + math.cos(math.tau * i / 12) * 0.5, cz + math.sin(math.tau * i / 12) * 0.5, y + 1.0)
            for i in range(13)]
    p.sweep(ring, 0.05, 0.05, IRON, sides=5, cap=False)
    p.rock(B(cx, cz, y + 0.45), (0.55, 0.55, 0.3), SOOT, jitter=0.3, subdivisions=1)
    p.rock(B(cx, cz, y + 0.62), (0.45, 0.45, 0.12), RIME, jitter=0.3, subdivisions=0)
    # A worn face-stone toward the gate with the Vigil's open eye.
    p.box(B(cx, cz + 0.95, lo + 0.55), (0.75, 0.2, 1.1), GRAVE, bevel=0.04, pitch=0.12)
    for r in (0.5, -0.5):
        p.box(B(cx, cz + 1.07, lo + 0.75), (0.32, 0.02, 0.05), GRAVE_DARK, roll=r)
    collider_circle('vigil_cairn', cx, cz, 1.05, y + 1.1, 'the Vigil cairn')


GOADS = [(-7.8, -12.8, 0.4, 3.4, 0.0), (-11.0, -7.4, 1.7, 3.0, 0.0), (7.0, -10.9, 0.2, 3.2, 1.0),
         (-3.2, -15.0, -2.2, 3.0, 0.55)]
BRAZIER = (6.3, -2.9)
SLEDGE = (-9.6, -10.2, -0.45)


def cult_debris(p):
    rng = random.Random(53)
    # Goad irons: long hooked iron rods, two thrown down by the sledge, one
    # driven into the ground by the heap, one leaning by the cairn.
    for (x, z, yaw, length, stand) in GOADS:
        g = gh(x, z)
        dirx, dirz = math.sin(yaw), math.cos(yaw)
        if stand:
            a = B(x, z, g - 0.4)
            b = B(x + dirx * length * (1 - stand) * 0.6, z + dirz * length * (1 - stand) * 0.6,
                  g - 0.4 + length * (0.4 + stand * 0.55))
        else:
            a = B(x - dirx * length / 2, z - dirz * length / 2, gh(x - dirx * length / 2, z - dirz * length / 2) + 0.07)
            b = B(x + dirx * length / 2, z + dirz * length / 2, gh(x + dirx * length / 2, z + dirz * length / 2) + 0.07)
        p.sweep([a, a.lerp(b, 0.5), b], 0.055, 0.045, IRON_DARK, sides=5)
        d = (b - a).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        p.sweep([b, b + d * 0.25 + side * 0.15, b + d * 0.12 + side * 0.36], 0.05, 0.02, IRON_DARK, sides=5)
        p.prism(a, 6, 0.08, 0.07, 0.35, WOOD_DARK, axis=tuple(d))
    # The toppled brazier: a cold iron bowl on its side, its tripod bent, soot
    # and the cult's burnt offerings spilled across the frost.
    bx, bz = BRAZIER
    g = gh(bx, bz)
    m = p.mark()
    p.lathe((0, 0, 0), [(0.15, -0.35), (0.55, -0.2), (0.75, 0.15), (0.78, 0.3), (0.7, 0.3), (0.5, 0.0),
                        (0.12, -0.25)], 12, IRON, smooth=True)
    p.lathe((0, 0, 0), [(0.82, 0.26), (0.86, 0.33), (0.0, 0.33)], 12, IRON_DARK)
    p.turn(m, Matrix.Translation(B(bx, bz, g + 0.62)) @ Matrix.Rotation(1.35, 4, 'X') @ Matrix.Rotation(0.6, 4, 'Z'))
    for k in range(3):
        a = 0.6 + k * 2.1
        p.sweep([B(bx + math.cos(a) * 0.3, bz + math.sin(a) * 0.3, g + 0.75),
                 B(bx + math.cos(a) * 0.9, bz + math.sin(a) * 0.5 - 0.3, g + 0.5 + k * 0.2),
                 B(bx + math.cos(a) * 1.3, bz + math.sin(a) * 0.2 - 0.6, gh(bx + math.cos(a) * 1.3,
                                                                            bz + math.sin(a) * 0.2 - 0.6) + 0.04)],
                0.05, 0.04, IRON_DARK, sides=5)
    for k in range(5):
        x = bx + 0.4 + rng.random() * 1.2
        z = bz - 0.8 + rng.random() * 1.6
        p.rock(B(x, z, gh(x, z) + 0.02), (0.6 + rng.random() * 0.5, 0.5, 0.08), SOOT, jitter=0.3,
               subdivisions=1, flat_bottom=True)
    for k in range(4):
        x = bx + 0.3 + rng.random() * 0.9
        z = bz - 0.5 + rng.random()
        p.rock(B(x, z, gh(x, z) + 0.1), (0.25, 0.18, 0.15), (0.3, 0.12, 0.06), jitter=0.3, subdivisions=0)
    collider_circle('toppled_brazier', bx, bz, 0.85, g + 1.4, 'the toppled brazier')
    footing('toppled_brazier', bx, bz, 0.45, 0.45, 0.0, g + 0.62 - 0.8)
    # The sledge: a heavy timber haul sledge with one runner snapped, its cold
    # soul-cage lashed to the bed, pointing up at the gate.
    sx, sz, yaw = SLEDGE
    sw, sl = 0.75, 1.9
    gl = ground_min(sx, sz, sw + 0.2, sl + 0.3, yaw)
    m = p.mark()
    for s in (-1, 1):
        runner = [(s * sw, -sl, 0.32), (s * sw, -sl + 0.4, 0.08), (s * sw, sl - 0.5, 0.08),
                  (s * sw, sl - 0.1, 0.25), (s * sw, sl + 0.15, 0.55)]
        if s > 0:
            runner = runner[:3] + [(s * sw + 0.2, sl - 0.6, 0.02)]
        p.sweep([Vector(r) for r in runner], 0.11, 0.1, WOOD_DARK, sides=5)
        for k in range(3):
            p.box((s * sw, -sl + 0.7 + k * 1.2, 0.32), (0.12, 0.12, 0.42), WOOD_DARK)
    for k in range(7):
        p.box((0, -sl + 0.35 + k * 0.55, 0.58), (sw * 2 + 0.35, 0.42, 0.1), p.vary(WOOD, 0.12), bevel=0.02)
    p.box((0, sl - 0.2, 0.62), (sw * 2 + 0.4, 0.14, 0.4), WOOD_DARK, bevel=0.02)
    for k in range(4):
        a = k * math.pi / 4
        ring = [Vector((math.cos(t) * 0.55 * math.cos(a), math.cos(t) * 0.55 * math.sin(a), 1.2 + math.sin(t) * 0.55))
                for t in [math.pi * i / 8 for i in range(9)]]
        p.sweep(ring, 0.035, 0.035, IRON, sides=4, cap=False)
    p.box((0, 0, 0.67), (1.2, 1.2, 0.06), IRON_DARK)
    p.rock((0.0, -0.8, 0.82), (1.3, 0.9, 0.12), RIME, jitter=0.25, subdivisions=1)
    # Seated on its ground: the bed is level across, so the sledge sits on its
    # lowest corner and its runners sink into the uphill side.
    p.turn(m, Matrix.Translation(B(sx, sz, gl - 0.05)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-0.08, 4, 'Y'))
    collider_obb('sledge', sx, sz, sw + 0.35, sl + 0.25, yaw, gl + 1.8, 'the cult\'s haul sledge (standable bed)',
                 stand=gl + 0.68)
    footing('sledge', sx, sz, sw, sl - 0.2, yaw, gl - 0.05 - 0.02)


def ground_blend(p):
    """Rubble and frosted scree where stone meets ground: at the plinths' feet,
    along the outcrop's skirt and at the mountain's foot."""
    rng = random.Random(61)
    spots = []
    for s in (-1, 1):
        spots += [(s * 5.5, -1.0, 0.7), (s * 5.45, 2.2, 0.8)]
    for (lz, W, E, top, roof) in STATIONS[2:9]:
        spots += [(W + 0.2, lz + rng.random(), 1.1), (-E - 0.2, lz + rng.random(), 1.1)]
    for (x, z, r) in spots:
        for k in range(2):
            ox = x + (rng.random() - 0.5) * r
            oz = z + (rng.random() - 0.5) * r
            sz = r * (0.6 + rng.random() * 0.6)
            p.rock(B(ox, oz, gh(ox, oz) + sz * 0.1), (sz * 1.3, sz, sz * 0.55), p.vary(SLATE if k else SLATE_PALE, 0.1),
                   jitter=0.3, subdivisions=1, flat_bottom=True)
        p.rock(B(x, z, gh(x, z) + r * 0.3), (r * 0.9, r * 0.7, r * 0.14), RIME, jitter=0.25, subdivisions=0)


def props():
    p = P('PlazaProps', weather=0.8, lichen=0.2)
    fallen_chain(p)
    cult_debris(p)
    cairn(p)
    return p


def graves_piece():
    p = P('Graveyard', weather=1.0, lichen=0.55)
    graveyard(p)
    return p


def blend_piece():
    p = P('GroundBlend', weather=1.0, lichen=0.25)
    ground_blend(p)
    return p


# ================================================================ the ice tongue
ICE_CX = -18.0
ICE_LZ = (43.0, 53.0)


def ice_tongue():
    """A tongue of blue glacier ice spilling through a notch in the ridge, high
    on the Thornpeak (south) face, east of the gate: the Quench showing over
    the rim. Its top stays well under the crest, so the ridge hides it from the
    Veiled Hollow behind. Render only, no collider."""
    p = P('IceTongue', weather=0.0, lichen=0.0)
    rng = random.Random(77)
    cx = ICE_CX
    n_st = 14
    stations = []
    for k in range(n_st + 1):
        lz = ICE_LZ[0] + (ICE_LZ[1] - ICE_LZ[0]) * k / n_st
        stations.append((lz, gh(cx, lz)))
    crest = max(gh(cx + dx, 56 + i) for i in range(16) for dx in (-6, 0, 6))
    # The notch: two buttresses of the mountain's own rock flank the ice, cut
    # as jagged slabs leaning back into the face.
    for k in (3, 7, 10, 12, 14):
        lz, y = stations[k]
        t = k / n_st
        w = 3.2 + 6.0 * t ** 1.6 - 0.6
        for s in (-1, 1):
            h = 5.0 + rng.random() * 3.0
            # seated on its own column of the face and pushed into it, so a
            # cheek never hangs off the snow as a loose boulder
            rx = cx + s * (w + 1.4)
            p.rock(B(rx, lz + 0.8, gh(rx, lz) - 0.2), (3.4 + rng.random(), 3.6, h),
                   p.vary(MOUNTAIN, 0.08), jitter=0.28, subdivisions=1)
    # The ice body: a broad sheet hugging the face, proud of it by 0.8 to 2.2
    # yd and sunk 4 yd into it (the far terrain LOD drops detail on this face).
    rings = []
    bm = p.bm
    before = set(bm.faces)
    n = 12
    for k, (lz, y) in enumerate(stations):
        t = k / n_st
        w = 3.2 + 6.0 * t ** 1.6
        # proud at the snout, flattening into the face where it fills the notch
        proud = 0.4 + 1.9 * math.sin(min(1.0, t * 1.15) * math.pi) ** 0.7 + (1.0 - t) * 0.6
        ring = []
        for i in range(n + 1):
            a = math.pi * i / n
            x = cx + math.cos(a) * w * (1 + (rng.random() - 0.5) * 0.1)
            bulge = math.sin(a) ** 0.6
            dz = -bulge * proud * (1 + (rng.random() - 0.5) * 0.2)
            ring.append(bm.verts.new(B(x, lz + dz - 0.15, gh(x, lz) + 0.25 + bulge * 0.4)))
        for i in range(n, -1, -1):
            a = math.pi * i / n
            x = cx + math.cos(a) * w * 0.9
            ring.append(bm.verts.new(B(x, lz + 4.0, gh(x, lz) - 4.0)))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        m = len(ra)
        for i in range(m):
            bm.faces.new((ra[i], ra[(i + 1) % m], rb[(i + 1) % m], rb[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    faces = [f for f in bm.faces if f not in before]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    top_lz, top_y = stations[-1]
    for f in faces:
        f.material_index = ICE
        for loop in f.loops:
            co = loop.vert.co
            k = ec.fbm2(co.x * 0.4, co.z * 0.5)
            # crevasse bands across the flow, deep blue in the cracks
            band = max(0.0, math.sin(co.z * 1.25 + k * 3.0)) ** 3
            col = tuple(a * (1 - band * 0.7) + b * band * 0.7 for a, b in zip(ICE_C, ICE_DEEP))
            # old snow on the upper reach and on every upward face
            snow = max(0.0, min(1.0, (co.z - (top_y - 12.0)) / 10.0))
            if f.normal.z > 0.5:
                snow = max(snow, 0.55)
            col = tuple(a * (1 - snow * 0.75) + b * snow * 0.75 for a, b in zip(col, ICE_WHITE))
            loop[p.col] = (*col, 1.0)
    # Seracs breaking over the lip, and long icicle curtains under the snout.
    for k in range(7):
        x = cx + (rng.random() - 0.5) * 9.0
        lz = top_lz - 1.0 - rng.random() * 2.5
        p.prism(B(x, lz - 1.8, gh(x, lz) + 0.2), 5, 0.8 + rng.random() * 0.6, 0.2, 2.0 + rng.random() * 2.0,
                ICE_WHITE, mat=ICE, phase=rng.random(), lean=(0.2, 0.6))
    lz0, y0 = stations[0]
    for k in range(11):
        x = cx + (rng.random() - 0.5) * 3.6
        p.prism(B(x, lz0 - 0.9 - rng.random() * 0.4, gh(x, lz0) + 0.4), 5, 0.2 + rng.random() * 0.22, 0.0001,
                -(2.0 + rng.random() * 5.0), ICE_C, mat=ICE, phase=rng.random())
    top_world = max(v.co.z for v in bm.verts)
    return p, {'tongue_top_y': round(top_world, 2), 'crest_y': round(crest, 2), 'centre_lx': cx,
               'lz_range': [stations[0][0], top_lz], 'snout_y': round(y0, 2)}


# ================================================================ VFX reference and main
def sockets(root):
    out = {}
    for (name, loc) in (('Socket_MouthMist', B(0, 1.2, 0.2)),
                        ('Socket_MistFilm', B(0, ROCK_FRONT + 0.4, 4.9)),
                        ('Socket_RuneLight', B(0, -2.2, 11.6)),
                        ('Socket_Sound_Wind', B(0, 2.0, 6.0)),
                        ('Socket_Sound_Breath', B(0, 14.0, 3.0))):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.4
        e.location = loc
        bpy.context.scene.collection.objects.link(e)
        e.parent = root
        out[name] = [round(loc[0], 3), round(loc[2], 3), round(-loc[1], 3)]
    return out


def vfx_reference():
    objs = []
    rng = random.Random(11)
    mist = bpy.data.materials.new('VFX_ColdMist')
    mist.use_nodes = True
    bs = mist.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.75, 0.86, 0.95, 1)
    bs.inputs['Alpha'].default_value = 0.14
    bs.inputs['Emission Color'].default_value = (0.4, 0.6, 0.85, 1)
    bs.inputs['Emission Strength'].default_value = 0.25
    try:
        mist.surface_render_method = 'BLENDED'
    except Exception:
        pass
    for i in range(26):
        t = rng.random()
        z = 1.5 - t * 13.0
        x = (rng.random() - 0.5) * (3.2 + t * 12.0)
        q = Vector(B(x, z, gh(x, z) + 0.25 + rng.random() * 0.3))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=16, ring_count=8, location=q)
        s = bpy.context.active_object
        bpy.ops.object.shade_smooth()
        s.scale = (1.0 + rng.random() * 1.4, 1.0 + rng.random() * 1.4, 0.22)
        s.name = f'VFX_Mist{i}'
        s.data.materials.append(mist)
        objs.append(s)
    film = ec.emissive_material('VFX_MistFilm', (0.45, 0.62, 0.8), strength=0.6, alpha=0.32)
    bpy.ops.mesh.primitive_plane_add(size=1, location=B(0, ROCK_FRONT + 0.4, 5.0))
    f = bpy.context.active_object
    f.name = 'VFX_MistFilm'
    f.scale = (7.0, 10.2, 1)
    f.rotation_euler = (math.pi / 2, 0, 0)
    f.data.materials.append(film)
    objs.append(f)
    rime = ec.emissive_material('VFX_RimeFan', (0.85, 0.92, 0.98), strength=0.5, alpha=0.4)
    bm = bmesh.new()
    n = 14
    rows = []
    for j in range(8):
        r = 0.6 + j * 1.6
        row = []
        for i in range(n + 1):
            a = -1.0 + 2.0 * i / n
            x = math.sin(a) * r * 1.1
            z = -0.6 - math.cos(a) * r
            row.append(bm.verts.new(B(x, z, gh(x, z) + 0.04)))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for i in range(n):
            bm.faces.new((ra[i], ra[i + 1], rb[i + 1], rb[i]))
    me = bpy.data.meshes.new('VFX_RimeFan')
    bm.to_mesh(me)
    bm.free()
    ro = bpy.data.objects.new('VFX_RimeFan', me)
    bpy.context.scene.collection.objects.link(ro)
    me.materials.append(rime)
    objs.append(ro)
    ld = bpy.data.lights.new('VFX_RuneLight', 'POINT')
    ld.energy = 140
    ld.color = (0.35, 0.72, 1.0)
    ld.shadow_soft_size = 0.4
    lo = bpy.data.objects.new('VFX_RuneLight', ld)
    lo.location = B(0, -2.2, 11.6)
    bpy.context.scene.collection.objects.link(lo)
    objs.append(lo)
    coll = bpy.data.collections.new('VFX_Reference')
    bpy.context.scene.collection.children.link(coll)
    for o in objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        coll.objects.link(o)


def existing_world_proxies(mats):
    """Render-only stand-ins for what the world already places here: the two
    ruin rings' columns and fallen blocks, and the quest pickups (never exported)."""
    p = P('EXISTING_RuinRings_proxy', weather=1.0, lichen=0.6)
    for c in SURR['colliders']:
        lx, lz = c['x'] - GR.dx, c['z'] - GR.dz
        if abs(lx) > 26 or abs(lz) > 20:
            continue
        if abs(lx) < 2 and abs(lz) < 1:
            continue                     # the generic jambs this entrance replaces
        if c['type'] == 'circle' and abs(c.get('r', 0) - 0.6) < 1e-3:
            top = c['cameraTopY'] - GR.dy
            p.column(B(lx, lz, gh(lx, lz) - 0.1), max(1.0, top - gh(lx, lz) + 0.1), 0.42, (0.62, 0.6, 0.57),
                     sides=10, broken=0.3 if c.get('standable') else 0.0)
        elif c['type'] == 'circle' and c.get('r', 0) < 1.0:
            p.rock(B(lx, lz, gh(lx, lz) + 0.25), (1.2, 1.0, 0.6), (0.6, 0.58, 0.55), jitter=0.2, subdivisions=1)
        elif c['type'] == 'obb' and c['hw'] > 1.0:
            p.box(B(lx, lz, gh(lx, lz) + 0.4), (c['hw'] * 2, c['hd'] * 2, 0.8), (0.62, 0.6, 0.57), yaw=c['rot'])
    for f in SURR['feats']:
        if f['kind'] != 'groundObject':
            continue
        lx, lz = f['x'] - GR.dx, f['z'] - GR.dz
        col = (0.55, 0.85, 1.0) if f['itemId'] == 'sanctum_key_shard' else (0.6, 0.95, 0.6)
        p.box(B(lx, lz, gh(lx, lz) + 0.35), (0.35, 0.35, 0.7), col, mat=GLOW, yaw=0.6)
    obj = p.finish(mats, None)
    coll = bpy.data.collections.new('EXISTING_World_Proxies')
    bpy.context.scene.collection.children.link(coll)
    for cc in obj.users_collection:
        cc.objects.unlink(obj)
    coll.objects.link(obj)


def make_materials():
    return [ec.vertex_color_material('KitStone', rough=0.85),
            ec.vertex_color_material('KitGlow', rough=0.85, emission=1.4),
            ec.vertex_color_material('KitIce', rough=0.25)]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    roots = {}
    for name in ('SanctumSealGate_ROOT', 'SanctumSealGateProps_ROOT', 'SanctumIceTongue_ROOT'):
        r = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(r)
        roots[name] = r
    main_parts = [pylons().finish(mats, roots['SanctumSealGate_ROOT']),
                  lintel().finish(mats, roots['SanctumSealGate_ROOT']),
                  finish_keep_normals(tunnel(), mats, roots['SanctumSealGate_ROOT']),
                  chains().finish(mats, roots['SanctumSealGate_ROOT'])]
    tunnel_colliders()
    sk = sockets(roots['SanctumSealGate_ROOT'])
    prop_parts = [props().finish(mats, roots['SanctumSealGateProps_ROOT']),
                  graves_piece().finish(mats, roots['SanctumSealGateProps_ROOT']),
                  blend_piece().finish(mats, roots['SanctumSealGateProps_ROOT'])]
    ice_p, ice_info = ice_tongue()
    ice_parts = [ice_p.finish(mats, roots['SanctumIceTongue_ROOT'])]
    stats = {
        'door': GR.door,
        'main_tris': ec.count_tris(main_parts),
        'main_parts': {o.name: ec.count_tris([o]) for o in main_parts},
        'props_tris': {o.name: ec.count_tris([o]) for o in prop_parts},
        'ice_tris': {o.name: ec.count_tris([o]) for o in ice_parts},
        'ice': ice_info,
        'sockets': sk, 'colliders': COLLIDERS,
        'footings': ec.gap_report(GR, FOOTINGS),
        'footings_raw': [list(f) for f in FOOTINGS],
        'stations': STATIONS,
        'layout': {'plinth': PLINTH, 'shaft': SHAFT, 'lintel': LINTEL, 'socket': SOCKET, 'tunnelHalfWidth': TUNNEL_HW,
                   'tunnelEnd': TUNNEL_END, 'rockFront': ROCK_FRONT, 'chainPath': CHAIN_PATH, 'heap': HEAP,
                   'cairn': CAIRN, 'brazier': BRAZIER, 'sledge': SLEDGE, 'graves': GRAVES, 'goads': GOADS},
    }
    raw = os.path.join(OUT, 'glb_raw')
    os.makedirs(raw, exist_ok=True)
    main_root = roots['SanctumSealGate_ROOT']
    # The sockets stay in the .blend and stats.json (the runtime reads its
    # anchors from src/render/sanctum_seal_gate_core.ts), never in the GLB.
    ec.export_glb([main_root] + main_parts, os.path.join(raw, 'sanctum_seal_gate.glb'))
    ec.export_glb([roots['SanctumSealGateProps_ROOT']] + prop_parts, os.path.join(raw, 'sanctum_seal_gate_props.glb'))
    ec.export_glb([roots['SanctumIceTongue_ROOT']] + ice_parts, os.path.join(raw, 'sanctum_seal_gate_ice.glb'))
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    print('STATS', json.dumps({k: stats[k] for k in ('main_tris', 'main_parts', 'props_tris', 'ice_tris', 'ice')}))
    bad = [f for f in stats['footings'] if not f['ok']]
    print('FOOTINGS_BAD', json.dumps(bad))
    if RENDERS == 'none':
        return
    road = [(0.0, -60.0), (0.0, 2.0)]
    ec.build_terrain(GR, 'thornpeak', paths=[(road, 1.6)])
    ec.import_knight(GR, -0.6, -6.5, yaw_deg=0, name='Knight_Plaza')
    ec.import_knight(GR, 1.2, -1.6, yaw_deg=10, name='Knight_AtGate')
    vfx_reference()
    existing_world_proxies(mats)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'sanctum_seal_gate_entrance.blend'))
    import sanctum_renders
    sanctum_renders.run(OUT, GR, SURR, COLLIDERS, RENDERS, road)


if __name__ == '__main__':
    main()
