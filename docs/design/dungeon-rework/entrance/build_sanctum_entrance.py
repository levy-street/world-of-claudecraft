"""Gravewyrm Sanctum world entrance: the Smith's Seal Gate (Thornpeak Heights).

  blender -b --factory-startup --python build_sanctum_entrance.py -- --out DIR
      [--terrain DIR] [--renders all|quick|beauty|maps|none]

Two battered pylons of the Smith's black ashlar on stepped plinths, each with
a sunk relief of the Smith's tools (hammer and tongs over the anvil; the
bellows and the flame over the anvil) and a column of incised runes glowing a
faint clean blue; the lintel's two monoliths either side of the torn-out
keystone, a rune frieze, a cornice on dentils, and a stepped crown whose seal
disc and anvil capstone are split by the fissure the keystone left, the
seal's cold light deep in the crack; frost and rime on every ledge, icicles
off the cornice; the two great chains (one hanging broken from its ring, one
fallen across the plaza into a frozen heap); the mountain's spur of cleaved
slate with the tunnel bored through it; a small unlit Vigil cairn facing the
gate, two clusters of old Vigil headstones on frozen grave mounds by the
flanking ruin rings, the cult's debris (goad irons, a toppled brazier, a
sledge with one broken runner), rubble and drifts where stone meets ground;
and a render-only glacier icefall breaking down the ridge notch far overhead
(Thornpeak side only, under the crest). The masses are signed-distance
sculpts (sanctum_gate_sculpt.py).

Run from the repo: --out tmp/asset_src/sanctum_seal_gate --terrain <dir of the
probe's sanctum_heightgrid.json and sanctum_surroundings.json> (probe.mts beside
this file writes them), then node scripts/assets/sanctum_seal_gate/build.mjs.
Pass an ABSOLUTE --out when rendering (Blender resolves a relative render path
against the saved .blend).

Local game coords via ec.B(lx, lz, y): lx = x - 0 (+ WEST), lz = z - 858
(+ NORTH), y = y - terrainHeight(0, 858). The gate faces SOUTH (the plaza and
the road). Materials: KitStone (lit stone, iron, wood, snow), KitGlow (unlit
runes and the seal's light), KitIce (lit glacier ice and icicles).

Three GLBs share ONE origin, the door at its terrain height:
  sanctum_seal_gate.glb        pylons, lintel and crown, runes, spur and
                               tunnel, chains
  sanctum_seal_gate_props.glb  chain heap, headstones and mounds, cairn, cult
                               debris, rubble and drifts
  sanctum_seal_gate_ice.glb    the icefall in the ridge notch (render only)
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
import numpy as np  # noqa: E402
import sanctum_gate_sculpt as sg  # noqa: E402
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
IRON = (0.3, 0.31, 0.33)            # old iron chain, frost-greyed
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
GRAVE_STONE = (0.5, 0.5, 0.52)       # weathered grey headstone granite
GRAVE_STONE_DARK = (0.33, 0.34, 0.37)
LICHEN = (0.36, 0.4, 0.32)
SNOW_V = (0.88, 0.92, 0.96)
SNOW_SHADE = (0.62, 0.7, 0.8)
ASH = (0.16, 0.15, 0.15)
EARTH = (0.46, 0.42, 0.37)           # frozen grave earth
EARTH_DARK = (0.3, 0.27, 0.24)

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


# ================================================================ pylons and lintel
RING_X = 2.95       # the anchor rings sit on the pylon faces beside the opening
RING_Y = 9.6
RING_LZ = SHAFT['z0'] - 0.75
STONE_DARK = (0.3, 0.3, 0.32)       # the Smith's black stone, as carved (lit, weathered)
STONE_WORN = (0.52, 0.52, 0.54)     # its worn arrises
STONE_DEEP = (0.04, 0.04, 0.05)     # the dark down every joint and channel
RIME_V = (0.86, 0.91, 0.95)
FROST_V = (0.58, 0.66, 0.74)
PYLON_TRIS = 6400
LINTEL_TRIS = 9200


def tunnel_breath(P, N):
    """How much of the tunnel's cold breath reaches a point of the gate: the
    faces toward the lane and the mouth, low down, rime over first."""
    lx, lz, y = P[:, 0], -P[:, 1], P[:, 2]
    near = np.clip(1.0 - (np.abs(lx) - 2.0) / 2.2, 0.0, 1.0)
    low = np.clip(1.0 - y / 6.5, 0.0, 1.0)
    inward = np.clip(-np.sign(lx) * N[:, 0], 0.0, 1.0)
    return near * low * (0.4 + 0.6 * inward) * (0.6 + 0.4 * np.clip((lz + 1.5) / 3.0, 0, 1))


def pylon_icicles(p, s, rng):
    """Icicles hanging from the capital's front and the outer brackets."""
    for k in range(9):
        x = s * rng.uniform(2.3, 5.1)
        ln = rng.uniform(0.25, 1.0)
        p.prism(B(x, -1.38 + rng.uniform(0, 0.12), 10.46 - 0.02), 5, rng.uniform(0.04, 0.09), 0.0001, -ln, ICE_WHITE,
                mat=ICE, phase=rng.random())
    for k in range(5):
        x = s * rng.uniform(5.3, 6.1)
        p.prism(B(x, rng.uniform(-0.8, 1.8), 9.93), 5, rng.uniform(0.04, 0.08), 0.0001, -rng.uniform(0.3, 0.8),
                ICE_WHITE, mat=ICE, phase=rng.random())


def pylons():
    p = P('Pylons', weather=0.0, lichen=0.0)
    rng = random.Random(23)
    for s in (-1, 1):
        tag = 'w' if s > 0 else 'e'
        x0, x1 = PLINTH['x0'], PLINTH['x1']
        cx = s * (x0 + x1) / 2
        cz = (PLINTH['z0'] + PLINTH['z1']) / 2
        hw, hd = (x1 - x0) / 2, (PLINTH['z1'] - PLINTH['z0']) / 2
        footing(f'plinth_{tag}', cx, cz, hw, hd, 0.0, ground_min(cx, cz, hw, hd) - 0.55)
        # the sculpted plinth reaches the collider's front (lz -2.12): its
        # burial is measured under the whole of it
        lo = ground_min(cx, (-2.12 + PLINTH['z1']) / 2, hw, (PLINTH['z1'] + 2.12) / 2)
        f, info = sg.pylon_field(s, {'bottom': lo - 0.55}, random.Random(5 + s))
        paint = sg.stone_paint(f, STONE_DARK, STONE_WORN, STONE_DEEP, RIME_V, FROST_V, 13 + s, cold=tunnel_breath,
                               shade=sg.panel_floor_shade(s))
        sg.add_sculpt(p, f, 'pylon_' + tag, PYLON_TRIS, paint)
        # the rune column's lit inlay; the lowest glyph is dead under the rime
        for k, st in info['strokes']:
            lit = k >= 1
            sg.add_quads(p, sg.inlay_quads(info['frame'], st, 0.07, -0.035), RUNE if lit else RUNE_DIM,
                         GLOW if lit else STONE)
        # the chain anchor: a riveted iron plate on the face, the staple, the ring
        ax = RING_X * s
        face = sg.shaft_front_lz(RING_Y)
        p.box(B(ax, face - 0.05, RING_Y + 0.15), (1.05, 0.12, 1.25), IRON_DARK, bevel=0.03)
        for rx in (-0.36, 0.36):
            for ry in (-0.42, 0.42):
                p.lathe(B(ax + rx, face - 0.11, RING_Y + 0.15 + ry), [(0.07, 0), (0.06, 0.05), (0.0, 0.07)], 5, IRON)
        p.box(B(ax, (face + RING_LZ) / 2, RING_Y + 0.12), (0.32, abs(RING_LZ - face) + 0.1, 0.24), IRON_DARK,
              bevel=0.03)
        anchor_ring(p, ax, RING_LZ, RING_Y)
        pylon_icicles(p, s, rng)
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
    p = P('Lintel', weather=0.0, lichen=0.0)
    rng = random.Random(7)
    f, info = sg.lintel_field(rng)
    paint = sg.stone_paint(f, STONE_DARK, STONE_WORN, STONE_DEEP, RIME_V, FROST_V, 17)
    sg.add_sculpt(p, f, 'lintel', LINTEL_TRIS, paint)
    # the frieze's lit inlay: the glyph nearest the broken socket is dead
    for (s, k, st) in info['strokes']:
        lit = k >= 1
        sg.add_quads(p, sg.inlay_quads(info['front'], st, 0.065, -0.1), RUNE if lit else RUNE_DIM,
                     GLOW if lit else STONE)
    # the seal's cold light, deep in the fissure and the torn socket: a
    # faint blue seen through the crack, never a lamp
    cap = info['cap']
    fis = info['fissure']
    quads = []
    for (a, b) in zip(fis, fis[1:]):
        wa, wb = a[2] * 0.55, b[2] * 0.55
        quads.append([cap.at(a[0] - wa, a[1], -0.35), cap.at(a[0] + wa, a[1], -0.35),
                      cap.at(b[0] + wb, b[1], -0.35), cap.at(b[0] - wb, b[1], -0.35)])
    sg.add_quads(p, quads, SEAL_GLOW, GLOW)
    sock = []
    for (y0, y1, w0, w1, z) in ((10.95, 11.8, 0.42, 0.55, 1.2), (11.8, 12.6, 0.5, 0.36, 0.9), (12.6, 13.3, 0.4, 0.62,
                                                                                                1.4)):
        sock.append([B(w0, z, y0), B(-w0, z, y0), B(-w1, z, y1), B(w1, z, y1)])
    sg.add_quads(p, [[np.array(tuple(v)) for v in q] for q in sock], SEAL_GLOW, GLOW)
    # icicles along the cornice's front and under the torn socket
    for s in (-1, 1):
        for k in range(12):
            x = s * rng.uniform(1.7, 8.2)
            p.prism(B(x, sg.CORNICE['z0'] + 0.08 + rng.uniform(0, 0.1), sg.CORNICE['y0'] - 0.24 - 0.02), 5,
                    rng.uniform(0.04, 0.1), 0.0001, -rng.uniform(0.25, 1.15), ICE_WHITE, mat=ICE, phase=rng.random())
        for k in range(5):
            x = s * rng.uniform(0.85, 1.25)
            p.prism(B(x, rng.uniform(-1.2, 0.6), 10.9), 5, rng.uniform(0.05, 0.09), 0.0001, -rng.uniform(0.4, 1.2),
                    ICE_WHITE, mat=ICE, phase=rng.random())
    return p


SEAL_GLOW = (0.22, 0.5, 0.82)       # the seal's light, dimmer than the runes


# ================================================================ the rock-cut tunnel
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


SPUR_TRIS = 9000
ICEFALL_TRIS = 8400


def tunnel():
    p = P('Tunnel', weather=0.0, lichen=0.0)
    rng = random.Random(3)
    f, _ = sg.spur_field(GR, STATIONS, random.Random(11), tunnel_end=TUNNEL_END, rock_front=ROCK_FRONT)

    def inside(Pv):
        lx, lz, y = Pv[:, 0], -Pv[:, 1], Pv[:, 2]
        return ((np.abs(lx) < 4.2) & (lz < 28.5) & ((lz > 2.3) | (y < 1.5)) & (y < 11.5 + 0.25 * lz))

    def floor_y(Pv):
        return np.array([gh(float(x), float(-y)) for (x, y) in Pv[:, :2]])

    paint = sg.rock_paint(f, inside, MOUNTAIN, MOUNTAIN_DARK, SLATE_DARK, FROST, RIME, floor_fn=floor_y)
    sg.add_sculpt(p, f, 'spur', SPUR_TRIS, paint)
    # Rock-cut reveal blocks lining the mouth's first yards (tool-dressed).
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
def chain_link(p, center, axis, side, length=1.75, width=1.05, bar=0.22, color=IRON, broken=False, sides=7,
               n=16):
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
    for f in p.sweep(pts, bar, bar, color, sides=sides, cap=broken):
        f.smooth = True


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
    chain_heap(p, rng)


def headstone(p, x, z, w, h, yaw, lean, seed, cross=False):
    rng = random.Random(seed)
    lo = ground_min(x, z, w / 2 + 0.05, 0.2, yaw)
    hi = GR.footprint_range(x, z, w / 2 + 0.05, 0.2, yaw, 0.25)[1]
    bury = 0.35
    bottom = lo - bury
    thick = 0.2 + rng.random() * 0.08
    # Built at its own origin, bottom at 0: the stone's top stands h above the
    # HIGHEST ground under it, so on a slope it is sunk on the uphill side.
    hh = (hi - lo) + bury + h
    m = p.mark()
    f, top = sg.headstone_field(rng, w, hh, thick, cross)
    dark = rng.random() < 0.4
    paint = sg.grave_paint(f, GRAVE_STONE_DARK if dark else GRAVE_STONE,
                           tuple(c * 0.7 for c in (GRAVE_STONE_DARK if dark else GRAVE_STONE)), LICHEN, SNOW_V,
                           seed)
    sg.add_sculpt(p, f, 'grave', 220 if not cross else 260, paint)
    p.turn(m, Matrix.Translation(B(x, z, bottom)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(lean, 4, 'X'))
    footing(f'headstone_{x:g}_{z:g}', x, z, w / 2, thick / 2, yaw, bottom)
    collider_obb(f'headstone_{x:g}_{z:g}', x, z, w / 2 + 0.05, 0.2, yaw, hi + h + 0.3, 'old Vigil headstone')
    # a snow-covered grave mound in front (south) of each stone, and a drift
    # banked against the stone's back
    mx, mz = x - math.sin(yaw) * 1.15, z - math.cos(yaw) * 1.15
    bx, bz = x + math.sin(yaw) * 0.32, z + math.cos(yaw) * 0.32
    mf = sg.mound_field(GR, [(mx, mz, (w + 0.3) * 0.58, 0.95, 0.14, -yaw),
                             (mx + 0.12, mz - 0.35, w * 0.42, 0.55, 0.1, -yaw),
                             (bx, bz, w * 0.5, 0.26, 0.14, -yaw)], voxel=0.06)
    sg.add_sculpt(p, mf, 'mound', 110, sg.earth_paint(mf, EARTH, EARTH_DARK, SNOW_V, seed + 1))


def cairn(p):
    """The Vigil cairn: a small unlit beacon of stacked stones facing the gate,
    older than Highwatch remembers. A cold iron fire-basket on top, never lit."""
    cx, cz = CAIRN
    rng = random.Random(41)
    lo = ground_min(cx, cz, 1.0, 1.0)
    footing('cairn', cx, cz, 0.9, 0.9, 0.0, lo - 0.3)
    f, y = sg.cairn_field(GR, cx, cz, rng)
    paint = sg.stone_paint(f, SLATE_PALE, (0.55, 0.57, 0.6), (0.08, 0.08, 0.09), RIME_V, FROST_V, 41,
                           snow_up=0.55)
    sg.add_sculpt(p, f, 'cairn', 1300, paint)
    for k in range(4):
        a = math.tau * k / 4 + 0.4
        bx, bz = cx + math.cos(a) * 0.32, cz + math.sin(a) * 0.32
        p.sweep([B(bx, bz, y + 0.0), B(bx + math.cos(a) * 0.16, bz + math.sin(a) * 0.16, y + 0.8)], 0.04, 0.04,
                IRON, sides=5)
    ring = [B(cx + math.cos(math.tau * i / 16) * 0.5, cz + math.sin(math.tau * i / 16) * 0.5, y + 0.8)
            for i in range(17)]
    p.sweep(ring, 0.05, 0.05, IRON, sides=6, cap=False)
    ring = [B(cx + math.cos(math.tau * i / 16) * 0.38, cz + math.sin(math.tau * i / 16) * 0.38, y + 0.4)
            for i in range(17)]
    p.sweep(ring, 0.035, 0.035, IRON_DARK, sides=5, cap=False)
    # cold ash in the basket, snow over it
    af = sg.Sculpt((cx - 0.8, -(cz + 0.8), y - 0.2), (cx + 0.8, -(cz - 0.8), y + 0.6), 0.05)
    af.put('snow', sg.Ellipsoid(sg.G(cx, cz, y + 0.16), (0.36, 0.36, 0.13)), 0.05)
    sg.add_sculpt(p, af, 'ash', 80, sg.snow_paint(af, SNOW_V, ASH, 43))
    collider_circle('vigil_cairn', cx, cz, 1.05, y + 0.9, 'the Vigil cairn')


def chain_heap(p, rng):
    """The fallen chain's end, frozen into a heap of frost and old snow, the
    links breaking out of it."""
    hx, hz = HEAP
    g = gh(hx, hz)
    blobs = [(hx, hz, 1.45, 1.3, 0.62, 0.3)]
    for k in range(5):
        a = rng.random() * math.tau
        r = rng.uniform(0.4, 1.0)
        blobs.append((hx + math.cos(a) * r, hz + math.sin(a) * r, rng.uniform(0.5, 0.9), rng.uniform(0.4, 0.8),
                      rng.uniform(0.35, 0.7), rng.random() * 3))
    mf = sg.mound_field(GR, blobs, voxel=0.07, bury=0.3)
    sg.add_sculpt(p, mf, 'heap', 700, sg.snow_paint(mf, SNOW_V, SNOW_SHADE, 19))
    collider_circle('chain_heap', hx, hz, 1.7, g + 1.3, 'the fallen chain\'s frosted heap (standable)', stand=g + 1.1)
    footing('chain_heap', hx, hz, 1.5, 1.5, 0.0, g - 0.05)


def plinth_drifts(p):
    """Snow banked against the pylons' plinths, the cairn's foot and the
    outcrop's skirt by the gate: low drifts, walk-over (never over a shin)."""
    blobs = []
    for s in (-1, 1):
        blobs += [(s * 3.9, -2.55, 1.5, 0.45, 0.26, 0.0), (s * 5.65, -0.4, 0.45, 1.4, 0.3, 0.0),
                  (s * 5.6, 1.8, 0.55, 0.9, 0.34, 0.0)]
    mf = sg.mound_field(GR, blobs, voxel=0.07, bury=0.25)
    sg.add_sculpt(p, mf, 'drifts', 900, sg.snow_paint(mf, SNOW_V, SNOW_SHADE, 71))


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
    """Split stones and frozen scree where stone meets ground: at the plinths'
    feet, along the outcrop's skirt and at the mountain's foot; snow banked
    against the plinths."""
    rng = random.Random(61)
    spots = []
    for s in (-1, 1):
        spots += [(s * 5.75, -1.3, 0.7), (s * 5.7, 2.4, 0.8)]
    for (lz, W, E, top, roof) in STATIONS[2:9]:
        spots += [(W + 0.35, lz + rng.random(), 1.0), (-E - 0.35, lz + rng.random(), 1.0)]
    f = sg.rubble_field(GR, spots, rng)
    paint = sg.stone_paint(f, SLATE, SLATE_PALE, (0.07, 0.07, 0.08), RIME_V, FROST_V, 61, snow_up=0.5)
    sg.add_sculpt(p, f, 'rubble', 2600, paint)
    plinth_drifts(p)


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


# ================================================================ the icefall
ICE_DEEP_V = (0.08, 0.26, 0.46)      # the deep core down a crevasse
ICE_CLEAR_V = (0.36, 0.62, 0.8)      # clear glacier blue on the faces
ICE_PALE_V = (0.66, 0.84, 0.93)      # thin ice at the arrises
ICE_CRUST_V = (0.9, 0.94, 0.97)      # the old snow crust


def ice_tongue():
    """The glacier tongue breaking down the Thornpeak (south) face through a
    notch of the ridge, east of the gate and high over it: the Quench showing
    over the rim. Its top stays under the crest, so the ridge hides it from
    the Veiled Hollow behind. Render only, no collider."""
    p = P('IceTongue', weather=0.0, lichen=0.0)
    rng = random.Random(77)
    f, lips = sg.icefall_field(GR, rng)
    paint = sg.ice_paint(f, ICE_DEEP_V, ICE_CLEAR_V, ICE_PALE_V, ICE_CRUST_V, MOUNTAIN, MOUNTAIN_DARK)

    def mat_of(C):
        return np.where(f.classify(C, default='ice') == 'rock', STONE, ICE)

    sg.add_sculpt(p, f, 'icefall', ICEFALL_TRIS, paint, mat_of=mat_of)
    # icicle fringes under every serac lip
    for (c, w) in lips:
        n = max(3, int(w * 1.6))
        for k in range(n):
            x = c[0] + (k + rng.uniform(0.2, 0.8)) / n * w - w / 2
            p.prism((x, c[1] + rng.uniform(-0.2, 0.2), c[2]), 5, rng.uniform(0.12, 0.28), 0.0001,
                    -rng.uniform(1.0, 3.6), ICE_PALE_V, mat=ICE, phase=rng.random())
    zs = [v.co.z for v in p.bm.verts]
    lx = [v.co.x for v in p.bm.verts]
    # the ridge must hide it from the Veiled Hollow behind: no vertex may
    # stand over the terrain anywhere north of it, up to the crest
    proud = 0
    worst = (0.0, None)
    for v in list(p.bm.verts)[::7]:
        x, lz, y = v.co.x, -v.co.y, v.co.z
        ridge = max(gh(x, lz + d) for d in (2, 4, 6, 8, 10, 14))
        if y > ridge:
            proud += 1
            if y - ridge > worst[0]:
                worst = (round(y - ridge, 2), [round(x, 1), round(lz, 1), round(y, 1)])
    crest = max(gh(sg.ICEFALL['cx'] + dx, 56 + i) for i in range(8) for dx in (-6, 0, 6))
    return p, {'tongue_top_y': round(max(zs), 2), 'crest_y': round(crest, 2), 'centre_lx': sg.ICEFALL['cx'],
               'lx_range': [round(min(lx), 2), round(max(lx), 2)], 'snout_lz': sg.ICEFALL['snout'],
               'over_ridge_samples': proud, 'over_ridge_worst': worst}


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
