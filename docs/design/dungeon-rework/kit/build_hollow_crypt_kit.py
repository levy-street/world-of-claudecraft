"""The Hollow Crypt kit: every piece of the open-air necropolis.

Run (background, one scene):
  blender -b --factory-startup --python build_hollow_crypt_kit.py -- [--preview out.png] [--save out.blend]

Writes hollow_crypt_kit_components.glb next to this file; the shipping build
(scripts/assets/hollow_crypt_kit/build.mjs) validates, fingerprints and meshopts
it into public/models/props/hollow_crypt_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, see
src/render/hollow_crypt/crypt_kit.ts). Game yards, +Z up, front -Y.
"""
import math
import os
import sys

import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hckit import (  # noqa: E402
    AMBER, BONE, BONE_OLD, CLOTH, GLOW, IRON, MOSS, RIME, SILK, SLATE, SOUL, STONE, STONE_BLUE,
    STONE_DARK, STONE_MID, STONE_PALE, TALLOW, TIMBER, UMBER, VIOLET, Piece, build_kit, export_kit,
)

HERE = os.path.dirname(os.path.abspath(__file__))


def P(name, **kw):
    return Piece('Kit_' + name, **kw)


# =============================================================== edge dressing
def balustrade():
    """A 4 yd carved balustrade on a plinth, outer (chasm) side toward -Y."""
    p = P('Balustrade')
    p.box((0, 0, 0.18), (4.0, 0.7, 0.36), p.vary(STONE_PALE), bevel=0.05)
    for i in range(6):
        x = -1.5 + i * 0.6
        p.lathe((x, 0, 0.36), [(0.13, 0), (0.09, 0.14), (0.18, 0.4), (0.1, 0.66), (0.14, 0.76)], 6,
                p.vary(STONE_PALE, 0.05))
    p.box((0, 0, 1.2), (4.0, 0.62, 0.2), p.vary(STONE_PALE), bevel=0.05)
    p.box((0, 0, 1.33), (4.05, 0.72, 0.08), p.vary(STONE_MID), bevel=0.03)
    for x in (-2.0, 2.0):
        p.box((x, 0, 0.72), (0.46, 0.8, 1.44), p.vary(STONE_MID), bevel=0.05)
        p.box((x, 0, 1.52), (0.56, 0.9, 0.18), p.vary(STONE_PALE), bevel=0.04)
    return p


def parapet():
    """A 4 yd crenellated parapet (masonry lip), outer side -Y."""
    p = P('Parapet')
    p.masonry(-2.0, 2.0, 0.0, 1.1, 0.8, 0.55, STONE_MID, y=0.0, bevel=False)
    for x in (-1.3, 0.4):
        p.masonry(x - 0.45, x + 0.45, 1.1, 1.9, 0.8, 0.4, STONE_MID, bevel=False)
    p.box((0, -0.05, 1.12), (4.0, 0.9, 0.08), p.vary(STONE_PALE), bevel=0.03)
    # A skull niche in the merlon's face.
    p.box((1.35, -0.35, 0.6), (0.6, 0.2, 0.55), (0.08, 0.07, 0.08))
    p.skull((1.35, -0.3, 0.38), 0.28)
    return p


def bone_rail():
    """A 4 yd rail of lashed femurs and ribs (the Bone Stair and bone bridges)."""
    p = P('BoneRail')
    for x in (-1.9, 0.0, 1.9):
        p.bone((x, 0, 0.0), (x + p.rng.uniform(-0.1, 0.1), 0, 1.35), 0.08)
        p.skull((x, -0.02, 1.35), 0.24, yaw=p.rng.uniform(-0.4, 0.4))
    p.sweep(p.bezier((-2.0, 0, 1.0), (0, 0.1, 1.2), (2.0, 0, 1.0), 8), 0.06, 0.06, BONE_OLD)
    for i in range(5):
        x = -1.6 + i * 0.8
        p.sweep(p.bezier((x, 0, 0.15), (x + 0.2, -0.25, 0.55), (x + 0.1, 0, 0.95), 6), 0.045, 0.03, p.vary(BONE))
    return p


def rubble():
    p = P('Rubble')
    for i in range(6):
        s = 0.3 + p.rng.random() * 0.55
        p.box((p.rng.uniform(-1.6, 1.6), p.rng.uniform(-0.3, 0.3), s * 0.35), (s * 1.3, s, s * 0.7),
              p.vary(STONE_MID, 0.15), bevel=0.05, yaw=p.rng.random() * 3, roll=p.rng.uniform(-0.3, 0.3))
    p.rock((0.4, 0.1, 0.2), (1.1, 0.8, 0.5), STONE_DARK)
    return p


# =============================================================== the gargoyle's rubble
# What is left of a Chapel Gargoyle (src/render/hollow_crypt/crypt_gargoyle_crumble_fx.ts):
# a low heap, well under a player's knee, and the two blocks that rain down to
# make it. Carved stone, so every break shows a flat, paler face.
# Warm greys: the crypt's moon and sky are blue, so a neutral grey reads as ice.
GARGOYLE_SKIN = (0.74, 0.71, 0.66)
GARGOYLE_SHADE = (0.58, 0.56, 0.53)
GARGOYLE_BREAK = (0.86, 0.83, 0.77)
GARGOYLE_HORN = (0.56, 0.53, 0.5)
GARGOYLE_TALON = (0.44, 0.42, 0.4)


def _scratch(p):
    """A scratch piece that draws on `p`'s random stream: cut it freely, then
    `_absorb` it (a plane cut on the shared mesh would slice its neighbours)."""
    scratch = Piece('scratch')
    scratch.rng = p.rng
    return scratch


def _absorb(p, scratch, matrix):
    """Move a scratch piece's geometry into `p` under `matrix`."""
    scratch.bm.verts.index_update()
    made = {}
    for face in scratch.bm.faces:
        verts = []
        for v in face.verts:
            if v.index not in made:
                made[v.index] = p.bm.verts.new(matrix @ v.co)
            verts.append(made[v.index])
        try:
            copy = p.bm.faces.new(verts)
        except ValueError:
            continue
        copy.material_index = face.material_index
        copy.smooth = face.smooth
        for loop, source in zip(copy.loops, face.loops):
            loop[p.col] = source[scratch.col]
    scratch.bm.free()


def _slice(scratch, normal, offset, break_color):
    """Cut everything beyond a plane off a scratch piece; the break is one flat face."""
    bm = scratch.bm
    cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5,
                                 plane_co=normal * offset, plane_no=normal, clear_outer=True)
    rim = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if len(rim) >= 3:
        filled = bmesh.ops.holes_fill(bm, edges=rim, sides=0)
        scratch._paint(filled['faces'], break_color, STONE)


def _fractured(p, center, size, color, cuts=3, jitter=0.2, subdivisions=1, yaw=0.0, pitch=0.0, roll=0.0,
               break_color=GARGOYLE_BREAK, deep=(0.3, 0.43), slab=False):
    """A broken block: a jittered boulder (or, `slab`, a dressed block with its
    chamfered arrises) sliced by `cuts` planes. The weathered skin keeps its
    colour; each fresh break is one flat, paler face."""
    scratch = _scratch(p)
    if slab:
        made = bmesh.ops.create_cube(scratch.bm, size=0.8)
        for v in made['verts']:
            v.co = Vector((v.co.x * (1 + (p.rng.random() - 0.5) * jitter),
                           v.co.y * (1 + (p.rng.random() - 0.5) * jitter),
                           v.co.z * (1 + (p.rng.random() - 0.5) * jitter)))
        bmesh.ops.bevel(scratch.bm, geom=scratch.bm.edges[:], offset=0.05, segments=1, affect='EDGES')
    else:
        made = bmesh.ops.create_icosphere(scratch.bm, subdivisions=subdivisions, radius=0.5)
        for v in made['verts']:
            v.co = v.co * (1 + (p.rng.random() - 0.5) * 2 * jitter)
    scratch._paint(scratch.bm.faces[:], color, STONE)
    for _ in range(cuts):
        normal = Vector((p.rng.uniform(-1, 1), p.rng.uniform(-1, 1), p.rng.uniform(-1, 1)))
        if normal.length < 1e-3:
            normal = Vector((0, 0, 1))
        offset = p.rng.uniform(*deep) * (0.72 if slab else 1.0)
        _slice(scratch, normal.normalized(), offset, p.vary(break_color, 0.05))
    _absorb(p, scratch, Matrix.Translation(Vector(center)) @ Matrix.Rotation(yaw, 4, 'Z')
            @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Y')
            @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))


def _gargoyle_horn(p, matrix, length=1.0, color=GARGOYLE_HORN, broken=True):
    """A ram horn: a ribbed curl, snapped off at the root with a pale break."""
    h = _scratch(p)
    pts = []
    for i in range(11):
        t = i / 10
        a = t * math.radians(215)
        r = 0.5 * (1 - 0.28 * t)
        pts.append(Vector((math.cos(a) * r - 0.5, t * 0.22, math.sin(a) * r)) * length)
    h.sweep(pts, 0.17 * length, 0.025 * length, color, sides=7)
    # The growth rings a ram horn carries, raised.
    for i in range(1, 8):
        t = i / 10
        ahead = (pts[i + 1] - pts[i - 1]).normalized()
        r = 0.19 * length * (1 - 0.72 * t)
        h.prism(pts[i] - ahead * 0.02 * length, 7, r, r, 0.04 * length, h.vary(color, 0.06), axis=ahead)
    if broken:
        back = (pts[0] - pts[1]).normalized()
        h.prism(pts[0] - back * 0.001, 7, 0.165 * length, 0.165 * length, 0.012, GARGOYLE_BREAK, axis=back)
    _absorb(p, h, matrix)


def _gargoyle_head(p, matrix):
    """Half the gargoyle's face, split from the crown down through the jaw: a
    heavy brow over one blind eye socket, the muzzle with a fang still in the
    lip, and the ram horn of that side still curled against the skull."""
    h = _scratch(p)
    skin = h.vary(GARGOYLE_SKIN, 0.04)
    # Skull, heavy brow ridge, the muzzle, its lip and chin.
    h.rock((0, 0.05, 0.0), (0.95, 1.05, 0.82), skin, jitter=0.06, subdivisions=2)
    h.box((0, -0.4, 0.2), (0.9, 0.3, 0.2), h.vary(GARGOYLE_SHADE, 0.04), bevel=0.05, pitch=-0.3)
    h.box((0, -0.66, -0.06), (0.52, 0.6, 0.36), skin, bevel=0.08, taper=0.78, pitch=0.12)
    h.box((0, -0.72, -0.28), (0.46, 0.46, 0.12), h.vary(GARGOYLE_SHADE, 0.05), bevel=0.03)
    h.box((0, -0.9, -0.02), (0.2, 0.1, 0.14), h.vary(GARGOYLE_SHADE, 0.05), bevel=0.02)
    for sx in (-1, 1):
        # The socket (its ember out) under the brow, and the cheek ridge.
        h.box((sx * 0.23, -0.5, 0.07), (0.2, 0.14, 0.13), (0.06, 0.055, 0.06))
        h.box((sx * 0.38, -0.3, -0.08), (0.14, 0.44, 0.18), h.vary(GARGOYLE_SKIN, 0.05), bevel=0.04, yaw=sx * 0.35)
        h.spike((sx * 0.17, -0.86, -0.24), 0.055, 0.22, (0.86, 0.84, 0.78), sides=4)
        h.spike((sx * 0.08, -0.92, -0.24), 0.035, 0.12, (0.86, 0.84, 0.78), sides=4)
    # A ridge of spurs over the crown.
    for k in range(3):
        h.prism((0.0, 0.05 + k * 0.2, 0.36 - k * 0.05), 5, 0.09, 0.02, 0.17, h.vary(GARGOYLE_SHADE), lean=(0, 0.08))
    # Split it: everything on one side of a slanted plane falls away.
    _slice(h, Vector((1.0, 0.12, 0.25)).normalized(), 0.13, GARGOYLE_BREAK)
    _absorb(p, h, matrix)
    # The horn of the side that is left, curling back and down round the ear.
    _gargoyle_horn(p, matrix @ Matrix.Translation((-0.42, 0.12, 0.2)) @ Matrix.Rotation(math.radians(100), 4, 'Z')
                   @ Matrix.Rotation(math.radians(74), 4, 'X') @ Matrix.Translation((0.5, 0, -0.5)), length=0.95,
                   broken=False)


def _gargoyle_hand(p, matrix):
    """A taloned hand broken off at the wrist, its fingers still hooked."""
    mark = p.mark()
    skin = p.vary(GARGOYLE_SKIN, 0.04)
    _fractured(p, (0, 0.02, 0.0), (0.5, 0.62, 0.3), skin, cuts=1, jitter=0.1, subdivisions=2, deep=(0.36, 0.44))
    p.prism((0, 0.27, 0), 7, 0.19, 0.17, 0.16, p.vary(GARGOYLE_SHADE), axis=(0, 1, 0))
    p.prism((0, 0.42, 0), 7, 0.165, 0.15, 0.03, GARGOYLE_BREAK, axis=(0, 1, 0))
    for x, reach in ((-0.17, 0.92), (0.0, 1.0), (0.17, 0.9)):
        knuckle = Vector((x, -0.22, 0.05))
        mid = Vector((x * 1.3, -0.22 - 0.26 * reach, 0.2))
        tip = Vector((x * 1.4, -0.22 - 0.44 * reach, 0.07))
        p.rock(knuckle, (0.17, 0.17, 0.15), p.vary(GARGOYLE_SHADE), jitter=0.05, subdivisions=1)
        p.sweep([knuckle, mid], 0.085, 0.07, skin, sides=6)
        p.rock(mid, (0.16, 0.16, 0.15), p.vary(GARGOYLE_SHADE), jitter=0.05, subdivisions=1)
        p.sweep([mid, tip], 0.07, 0.055, skin, sides=6)
        p.sweep(p.bezier(tip, tip + Vector((0, -0.13, -0.01)), tip + Vector((0, -0.17, -0.15)), 4), 0.055, 0.006,
                GARGOYLE_TALON, sides=5)
    thumb = Vector((0.22, -0.02, 0.02))
    bend = thumb + Vector((0.2, -0.14, 0.1))
    end = thumb + Vector((0.27, -0.3, 0.0))
    p.sweep([thumb, bend], 0.085, 0.065, skin, sides=6)
    p.sweep([bend, end], 0.065, 0.05, skin, sides=6)
    p.sweep(p.bezier(end, end + Vector((0.02, -0.1, -0.02)), end + Vector((0.0, -0.15, -0.13)), 4), 0.05, 0.006,
            GARGOYLE_TALON, sides=5)
    p.turn(mark, matrix)


def _gargoyle_wing(p, matrix):
    """A span of wing: three stone finger ribs fanned from the wrist, knuckled
    and bowed, and the web between them, scalloped along its trailing edge and
    torn through."""
    mark = p.mark()
    root = Vector((0, 0, 0.07))
    tips = (Vector((1.6, -0.25, 0.03)), Vector((1.5, 0.7, 0.03)), Vector((0.85, 1.35, 0.03)))
    for tip in tips:
        side = Vector((-(tip.y - root.y), tip.x - root.x, 0)).normalized()
        knuckle = root.lerp(tip, 0.52) + Vector((0, 0, 0.11)) + side * 0.09
        p.sweep(p.bezier(root, root.lerp(knuckle, 0.5) + Vector((0, 0, 0.05)), knuckle, 4), 0.1, 0.07,
                p.vary(GARGOYLE_SHADE, 0.05), sides=6)
        p.rock(knuckle, (0.22, 0.22, 0.17), p.vary(GARGOYLE_SHADE, 0.05), jitter=0.06, subdivisions=1)
        p.sweep(p.bezier(knuckle, knuckle.lerp(tip, 0.5) - side * 0.05, tip, 4), 0.065, 0.02,
                p.vary(GARGOYLE_SHADE, 0.05), sides=6)
    web = p.vary(GARGOYLE_SKIN, 0.05)
    for k in range(2):
        a, b = tips[k], tips[k + 1]
        edge = []
        for i in range(7):
            t = i / 6
            # The scallop of a bat wing: the web sags back toward the wrist between two ribs.
            sag = 1 - 0.3 * math.sin(math.pi * t)
            if k == 1 and i in (2, 3):
                sag -= 0.24  # the tear
            edge.append(root.lerp(a.lerp(b, t), 0.95 * sag))
        lower = [Vector((v.x, v.y, 0.03)) for v in [root] + edge]
        upper = [Vector((v.x, v.y, 0.06)) for v in [root] + edge]
        for i in range(1, len(lower) - 1):
            p.plane((upper[0], upper[i], upper[i + 1]), web)
            p.plane((lower[0], lower[i + 1], lower[i]), web)
            p.plane((lower[i], lower[i + 1], upper[i + 1], upper[i]), GARGOYLE_BREAK)
    _fractured(p, root, (0.42, 0.4, 0.3), p.vary(GARGOYLE_SKIN), cuts=2)
    p.turn(mark, matrix)


def gargoyle_rubble():
    """The heap a Chapel Gargoyle crumbles into: broken blocks in a low mound
    (0.6 yd at its highest, a player's knee is higher) inside a 2.2 yd scatter,
    with what can still be told apart lying on it: half the horned face, the
    other horn, a taloned hand, a span of wing."""
    p = P('GargoyleRubble', lichen=0.08, weather=0.4)
    # The core of the mound: big blocks leaning on each other, half sunk in grit.
    core = (
        ((-0.35, 0.3, 0.2), (1.35, 1.1, 0.6), 0.4, 0.15, -0.1, False),
        ((0.7, 0.4, 0.19), (1.1, 1.2, 0.56), 1.7, -0.2, 0.12, True),
        ((0.3, -0.7, 0.17), (1.15, 0.95, 0.5), 2.6, 0.1, 0.2, False),
        ((-0.95, -0.4, 0.16), (1.0, 0.95, 0.5), 0.9, 0.2, -0.15, True),
        ((-0.75, 1.0, 0.15), (1.0, 0.85, 0.46), 2.1, -0.12, 0.1, False),
        ((1.0, -0.5, 0.14), (0.9, 0.8, 0.44), 0.2, 0.18, 0.16, True),
        ((0.1, 0.5, 0.36), (0.85, 0.72, 0.4), 1.1, -0.1, 0.25, True),
        ((-0.2, -0.15, 0.34), (0.8, 0.7, 0.36), 2.0, 0.2, -0.2, False),
        ((1.25, 0.55, 0.13), (0.8, 0.7, 0.4), 0.7, -0.15, 0.1, True),
        ((-1.35, 0.35, 0.13), (0.8, 0.72, 0.4), 2.9, 0.12, 0.18, False),
    )
    for center, size, yaw, pitch, roll, slab in core:
        _fractured(p, center, size, p.vary(GARGOYLE_SKIN, 0.07), cuts=3 if slab else 4, yaw=yaw, pitch=pitch,
                   roll=roll, slab=slab)
    # The ring round it: smaller blocks that rolled a little way.
    for i in range(14):
        a = math.tau * i / 14 + p.rng.uniform(-0.2, 0.2)
        r = p.rng.uniform(1.45, 2.0)
        s = p.rng.uniform(0.32, 0.58)
        tone = GARGOYLE_SHADE if i % 3 == 0 else GARGOYLE_SKIN
        _fractured(p, (math.cos(a) * r, math.sin(a) * r, s * 0.24), (s * 1.25, s, s * 0.72), p.vary(tone, 0.08),
                   cuts=3, yaw=p.rng.uniform(0, 3.1), pitch=p.rng.uniform(-0.25, 0.25),
                   roll=p.rng.uniform(-0.25, 0.25), slab=i % 2 == 0)
    # Scree out to the edge of the scatter, and grit between the blocks.
    for i in range(40):
        a = p.rng.uniform(0, math.tau)
        r = math.sqrt(p.rng.random()) * 2.3
        s = p.rng.uniform(0.1, 0.24) * (1.2 if r < 1.2 else 1.0)
        _fractured(p, (math.cos(a) * r, math.sin(a) * r, s * 0.3), (s * 1.3, s, s * 0.75),
                   p.vary(GARGOYLE_SKIN if i % 2 else GARGOYLE_BREAK, 0.1), cuts=2, yaw=p.rng.uniform(0, 3.1),
                   roll=p.rng.uniform(-0.4, 0.4), slab=i % 3 == 0)
    # What is still a gargoyle. The face lies on its broken side on top of the
    # mound, looking up past whoever comes to loot it.
    _gargoyle_head(p, Matrix.Translation((0.05, -0.3, 0.42)) @ Matrix.Rotation(0.5, 4, 'Z')
                   @ Matrix.Rotation(-1.15, 4, 'X') @ Matrix.Rotation(-0.3, 4, 'Y')
                   @ Matrix.Diagonal((0.52, 0.52, 0.52, 1)))
    _gargoyle_horn(p, Matrix.Translation((-1.45, -1.25, 0.17)) @ Matrix.Rotation(2.4, 4, 'Z')
                   @ Matrix.Rotation(math.pi / 2 - 0.12, 4, 'X') @ Matrix.Translation((0.5, 0, 0)), length=0.8)
    _gargoyle_hand(p, Matrix.Translation((1.55, -1.3, 0.15)) @ Matrix.Rotation(-0.9, 4, 'Z')
                   @ Matrix.Rotation(0.12, 4, 'Y') @ Matrix.Diagonal((0.82, 0.82, 0.82, 1)))
    _gargoyle_wing(p, Matrix.Translation((0.45, 1.25, 0.02)) @ Matrix.Rotation(0.8, 4, 'Z'))
    # Settled: nothing stands over 0.6 yd (the runtime pins it, GARGOYLE_RUBBLE.height).
    top = max(v.co.z for v in p.bm.verts)
    if top > 0.6:
        for v in p.bm.verts:
            v.co.z *= 0.6 / top
    return p


def gargoyle_chunk():
    """One falling block of the gargoyle (drawn many times, scaled and turned):
    about a yard across, centred on its own middle so it tumbles true."""
    p = P('GargoyleChunk', lichen=0.0, weather=0.35)
    _fractured(p, (0, 0, 0), (1.25, 1.05, 0.9), GARGOYLE_SKIN, cuts=4, jitter=0.3, slab=True)
    return p


def gargoyle_shard():
    """One falling splinter (a wing rib, a horn, a talon): long and tapered,
    centred on its own middle."""
    p = P('GargoyleShard', lichen=0.0, weather=0.35)
    pts = p.bezier((-0.75, 0, -0.05), (0.0, 0, 0.2), (0.75, 0, -0.08), 6)
    p.sweep(pts, 0.2, 0.035, GARGOYLE_SHADE, sides=6)
    back = (pts[0] - pts[1]).normalized()
    p.prism(pts[0], 6, 0.2, 0.2, 0.012, GARGOYLE_BREAK, axis=back)
    _fractured(p, (-0.5, 0.0, 0.0), (0.5, 0.42, 0.4), GARGOYLE_SKIN, cuts=3, deep=(0.18, 0.3))
    return p


# =============================================================== walls and gates
def curtain_wall(broken=False):
    p = P('CurtainWallBroken' if broken else 'CurtainWall', seed=7 if broken else 0)
    p.masonry(-3.0, 3.0, 0.0, 8.0, 2.4, 0.8, STONE_MID, ruin=0.45 if broken else 0.0, bevel=False)
    if not broken:
        p.box((0, 0, 8.1), (6.0, 2.6, 0.22), p.vary(STONE_PALE), bevel=0.05)
        for x in (-2.2, 0.0, 2.2):
            p.masonry(x - 0.55, x + 0.55, 8.2, 9.6, 2.2, 0.7, STONE_MID, bevel=False)
    # A buttress on the inner face and grime runs.
    p.masonry(-0.7, 0.7, 0.0, 5.5, 1.2, 0.6, STONE_DARK, y=1.6)
    p.box((0, 1.6, 5.6), (1.4, 1.2, 0.6), p.vary(STONE_MID), bevel=0.05, taper=0.6)
    for x in (-2.5, 2.4):
        p.rock((x, -1.3, 0.3), (1.2, 0.8, 0.7), STONE_DARK)
    return p


# =============================================================== the landing
def lychgate():
    """The roofed lychgate over the exit: stone piers, timber frame, slate roof."""
    p = P('Lychgate')
    for x in (-3.4, 3.4):
        p.masonry(x - 0.7, x + 0.7, 0, 3.4, 1.4, 0.42, STONE_MID)
        p.box((x, 0, 3.55), (1.6, 1.6, 0.3), p.vary(STONE_PALE), bevel=0.05)
        p.skull((x, -0.72, 2.2), 0.3)
    for y in (-0.9, 0.9):
        p.box((0, y, 3.9), (8.6, 0.28, 0.36), TIMBER, bevel=0.03)
    for x in (-3.4, -1.1, 1.1, 3.4):
        p.box((x, 0, 4.5), (0.24, 2.2, 0.24), TIMBER, bevel=0.02, pitch=0.0)
        p.box((x, -0.55, 4.55), (0.2, 1.3, 0.2), TIMBER, pitch=-0.6)
        p.box((x, 0.55, 4.55), (0.2, 1.3, 0.2), TIMBER, pitch=0.6)
    for side in (-1, 1):
        for i in range(9):
            x = -4.2 + i * 1.05
            p.box((x, side * 1.05, 4.62 - 0.0), (1.1, 1.6, 0.08), p.vary(SLATE, 0.18), pitch=side * 0.62, bevel=0.02)
    p.box((0, 0, 5.2), (8.8, 0.3, 0.3), TIMBER)
    # A hanging lantern under the ridge.
    p.box((0, 0, 4.3), (0.05, 0.05, 0.8), IRON)
    p.box((0, 0, 3.7), (0.45, 0.45, 0.55), IRON, bevel=0.03)
    p.box((0, 0, 3.7), (0.3, 0.3, 0.4), AMBER, mat=GLOW)
    return p


def mourner_statue():
    """A hooded mourner, head bowed, on a plinth (4 yd)."""
    p = P('MournerStatue', lichen=0.5)
    p.box((0, 0, 0.5), (1.9, 1.9, 1.0), p.vary(STONE_MID), bevel=0.08)
    p.box((0, 0, 1.08), (1.6, 1.6, 0.16), p.vary(STONE_PALE), bevel=0.05)
    # Robe: a tapered, slightly bent prism.
    p.prism((0, 0, 1.15), 9, 0.8, 0.42, 2.5, p.vary(STONE_PALE, 0.05), lean=(0, -0.12))
    p.prism((0, -0.12, 3.62), 9, 0.46, 0.2, 0.9, p.vary(STONE_PALE, 0.05), lean=(0, -0.28))
    # Hood and bowed head.
    p.rock((0, -0.28, 3.85), (0.7, 0.72, 0.8), p.vary(STONE_PALE, 0.05), jitter=0.05)
    p.box((0, -0.55, 3.7), (0.38, 0.2, 0.44), (0.12, 0.12, 0.14))
    # Hands clasped over a wreath.
    p.rock((0, -0.55, 2.8), (0.45, 0.35, 0.3), p.vary(STONE_PALE))
    p.sweep([(0.35, -0.3, 3.2), (0.25, -0.55, 2.95), (0.05, -0.62, 2.8)], 0.11, 0.09, STONE_PALE)
    p.sweep([(-0.35, -0.3, 3.2), (-0.25, -0.55, 2.95), (-0.05, -0.62, 2.8)], 0.11, 0.09, STONE_PALE)
    return p


def chapel_ruin():
    """The broken parish chapel the party climbs out of: gable with an empty rose
    window, broken side walls, a fallen bell-cote. Front (-Y) faces the landing."""
    p = P('ChapelRuin', lichen=0.45)
    # Gable wall.
    p.masonry(-8, 8, 0, 11, 1.4, 1.1, STONE_MID, y=0, ruin=0.0, bevel=False)
    for i in range(8):
        w = 16.0 - i * 2.0
        p.masonry(-w / 2, w / 2, 11.0 + i * 0.9, 11.9 + i * 0.9, 1.4, 0.9, STONE_MID, bevel=False)
    p.box((0, 0, 18.6), (1.2, 1.6, 1.6), p.vary(STONE_PALE), bevel=0.08)
    p.box((0, 0, 19.9), (0.35, 0.35, 1.4), STONE_PALE)
    p.box((0, 0, 20.1), (1.1, 0.35, 0.3), STONE_PALE)
    # The empty rose window: a ring of voussoirs and radial mullions.
    for i in range(16):
        a = math.tau * i / 16
        p.box((math.cos(a) * 3.2, -0.2, 9.0 + math.sin(a) * 3.2), (1.3, 1.7, 0.5), p.vary(STONE_PALE, 0.08),
              bevel=0.05, roll=-a + math.pi / 2)
    for i in range(8):
        a = math.tau * i / 8
        if i in (2, 3):
            continue  # broken tracery
        p.box((math.cos(a) * 1.6, -0.2, 9.0 + math.sin(a) * 1.6), (3.0, 0.3, 0.25), STONE_PALE, roll=-a)
    p.box((0, -0.3, 9.0), (0.9, 0.9, 0.9), p.vary(STONE_PALE), bevel=0.08, yaw=0.785)
    # The doorway the party emerges from.
    p.box((0, -0.4, 2.3), (3.2, 0.3, 4.6), (0.05, 0.05, 0.07))
    p.voussoir_arch(3.8, 3.0, 2.2, 0.6, 1.6, STONE_PALE, blocks=11, center=(0, 0, 0))
    # Broken side walls running back and a fallen bell-cote.
    for side in (-1, 1):
        mark = p.mark()
        p.masonry(0.0, 12.0, 0.0, 7.5 if side < 0 else 5.0, 1.2, 1.0, STONE_MID, ruin=0.55, bevel=False)
        p.turn(mark, Matrix.Translation((side * 7.4, 0.6, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    p.rock((5, 6, 0.15), (4, 3, 1.8), STONE_DARK, flat_bottom=True)
    p.rock((-4, 9, 0.1), (3, 2.4, 1.3), STONE_DARK, flat_bottom=True)
    p.box((-3.2, 3.2, 0.9), (2.2, 1.6, 1.8), p.vary(STONE_MID), bevel=0.1, yaw=0.5, roll=0.4)
    return p


def rock_pillar():
    """A rock column dropping into the mist, its top levelled into a flat cap
    (radius 11.5) that carries the chapel ruin; origin at the cap's surface."""
    p = P('RockPillar', weather=0.5, lichen=0.2)
    p.prism((0, 0, -2.4), 12, 12.0, 11.5, 2.4, p.vary(STONE_DARK, 0.05), phase=0.13)
    z = -1.5
    r = 11.6
    for i in range(10):
        h = 7.0
        p.rock((p.rng.uniform(-0.5, 0.5), p.rng.uniform(-0.5, 0.5), z - h / 2),
               (r * 2.0, r * 1.9, h * 1.3), p.vary(STONE_DARK, 0.1), jitter=0.12, subdivisions=2)
        z -= h * 0.95
        r *= 0.88
    return p


def candle_cluster():
    p = P('CandleCluster')
    p.box((0, 0, 0.15), (1.4, 1.0, 0.3), p.vary(STONE_MID), bevel=0.05)
    for i in range(7):
        a = p.rng.random() * math.tau
        rr = p.rng.random() * 0.45
        p.candle((math.cos(a) * rr, math.sin(a) * rr * 0.7, 0.3), 0.25 + p.rng.random() * 0.55, 0.07 + p.rng.random() * 0.04)
    p.skull((0.45, -0.1, 0.3), 0.22, yaw=0.3)
    return p


def brazier():
    """A standing iron brazier: three splayed legs, a riveted bowl of coals
    (glow) at 1.3 yd; the runtime lights its flame in the bowl."""
    p = P('Brazier', lichen=0.0)
    p.prism((0, 0, 0), 8, 0.62, 0.55, 0.12, p.vary(STONE_DARK), phase=0.2)
    for i in range(3):
        a = math.tau * i / 3 + 0.3
        foot = (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.1)
        knee = (math.cos(a) * 0.32, math.sin(a) * 0.32, 0.75)
        top = (math.cos(a) * 0.42, math.sin(a) * 0.42, 1.12)
        p.sweep(p.bezier(foot, knee, top, 6), 0.05, 0.045, IRON, sides=5)
        p.box(foot, (0.16, 0.16, 0.08), IRON)
    p.prism((0, 0, 0.62), 8, 0.1, 0.1, 0.5, IRON)
    p.lathe((0, 0, 1.05), [(0.18, 0), (0.5, 0.12), (0.62, 0.3), (0.64, 0.36), (0.58, 0.36)], 12, IRON)
    for i in range(8):
        a = math.tau * i / 8
        p.box((math.cos(a) * 0.62, math.sin(a) * 0.62, 1.28), (0.07, 0.07, 0.07), (0.35, 0.33, 0.32))
    for i in range(9):
        a = p.rng.random() * math.tau
        r = p.rng.random() * 0.4
        p.rock((math.cos(a) * r, math.sin(a) * r, 1.32), (0.26, 0.26, 0.16), AMBER, mat=GLOW, jitter=0.2,
               subdivisions=1)
    p.rock((0, 0, 1.3), (0.9, 0.9, 0.12), (0.1, 0.08, 0.07), jitter=0.1, subdivisions=1)
    return p


def skull_pile():
    p = P('SkullPile')
    for i in range(14):
        a = p.rng.random() * math.tau
        r = p.rng.random() * 0.9
        z = max(0.0, 0.7 - r) * 0.9 + p.rng.random() * 0.1
        p.skull((math.cos(a) * r, math.sin(a) * r, z), 0.26 + p.rng.random() * 0.08, yaw=p.rng.random() * 6)
    for i in range(6):
        a = p.rng.random() * math.tau
        p.bone((math.cos(a) * 0.9, math.sin(a) * 0.9, 0.08), (math.cos(a + 0.8) * 0.3, math.sin(a + 0.8) * 0.3, 0.2), 0.05)
    return p


def coffin_stack():
    p = P('CoffinStack')
    for i, (x, y, z, yaw) in enumerate(((0, 0, 0.35, 0.0), (0.2, 0.1, 1.05, 0.12), (-0.1, -0.05, 1.75, -0.2))):
        mark = p.mark()
        p.box((0, 0, 0), (0.9, 2.3, 0.7), p.vary(TIMBER, 0.15), bevel=0.04, taper=0.92)
        p.box((0, 0, 0.36), (0.95, 2.35, 0.08), p.vary(TIMBER, 0.2), bevel=0.02)
        p.box((0, -0.3, 0.41), (0.12, 0.9, 0.04), IRON)
        p.box((0, -0.5, 0.41), (0.5, 0.12, 0.04), IRON)
        p.turn(mark, Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, 'Z'))
    return p


# =============================================================== the cloister
def cloister_column(broken=False):
    p = P('CloisterColumnBroken' if broken else 'CloisterColumn', seed=3 if broken else 0, lichen=0.4)
    p.column((0, 0, 0), 9.0, 0.55, STONE_PALE, sides=10, broken=0.42 if broken else 0.0)
    if broken:
        mark = p.mark()
        p.lathe((0, 0, 0), [(0.55, 0), (0.55, 1.6)], 10, STONE_PALE)
        p.turn(mark, Matrix.Translation((1.8, -0.8, 0.55)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    return p


ARCADE_SPAN = 10.2
ARCADE_SPRING = 9.05  # the lowest voussoir face sits exactly on the 9 yd capitals
ARCADE_BLOCKS = 15


def fallen_voussoirs(p, x0, x1, count):
    """Voussoirs and chips lying in the grass under a broken bay (ground level)."""
    for i in range(count):
        t = (i + 0.5) / count
        x = x0 + (x1 - x0) * t + p.rng.uniform(-0.5, 0.5)
        y = p.rng.uniform(-1.4, 1.4)
        yaw = p.rng.uniform(-0.9, 0.9)
        on_edge = p.rng.random() < 0.3
        h = 1.25 if on_edge else 0.75
        p.box((x, y, h / 2 - 0.05), (1.25, 0.75 if on_edge else 1.3, h), p.vary(STONE_PALE, 0.08), bevel=0.06,
              yaw=yaw, roll=p.rng.uniform(-0.08, 0.08))
    for i in range(count + 2):
        s_ = 0.25 + p.rng.random() * 0.35
        p.box((x0 + (x1 - x0) * p.rng.random(), p.rng.uniform(-1.8, 1.8), s_ * 0.3 - 0.02), (s_, s_ * 0.8, s_ * 0.6),
              p.vary(STONE_MID, 0.12), bevel=0.04, yaw=p.rng.random() * 3)


def arcade_arch(variant='whole'):
    """An arcade bay between two cloister columns 10 yd apart (feet at +-5.1 on
    their capitals at 9). `broken` keeps both springers and drops the crown in
    the grass; `springer` keeps only the -X springer (its column stands, the
    other fell); `fallen` is only the stones on the ground."""
    name = {'whole': 'ArcadeArch', 'broken': 'ArcadeArchBroken', 'springer': 'ArcadeArchSpringer',
            'fallen': 'ArcadeArchFallen'}[variant]
    p = P(name, seed={'whole': 0, 'broken': 5, 'springer': 9, 'fallen': 13}[variant], lichen=0.5)
    n = ARCADE_BLOCKS - 1
    keep = {
        'whole': None,
        'broken': set(range(0, 4)) | set(range(n - 4, n)),
        'springer': set(range(0, 4)),
        'fallen': set(),
    }[variant]
    if keep is None or keep:
        p.voussoir_arch(ARCADE_SPAN, ARCADE_SPRING, 4.4, 0.75, 1.3, STONE_PALE, blocks=ARCADE_BLOCKS, keep=keep)
    if variant == 'whole':
        p.masonry(-5.1, 5.1, 14.0, 15.0, 1.2, 0.5, STONE_MID)
        p.box((0, 0, 15.1), (10.4, 1.5, 0.22), p.vary(STONE_PALE), bevel=0.04)
        for x in (-3.8, 3.8):
            p.masonry(x - 1.1, x + 1.1, 9.8, 14.0, 1.1, 0.5, STONE_MID, ruin=0.3)
    elif variant == 'broken':
        fallen_voussoirs(p, -2.4, 2.4, 6)
    elif variant == 'springer':
        fallen_voussoirs(p, -1.5, 4.2, 9)
    else:
        fallen_voussoirs(p, -4.0, 4.0, 12)
    return p


def ossuary_monument():
    """The cloister's heart: a stepped octagonal ossuary drum with skull niches,
    candles, and a broken spire. Radius 5 (its collider)."""
    p = P('OssuaryMonument', lichen=0.45)
    for i, (r, h) in enumerate(((5.0, 0.5), (4.3, 0.5), (3.6, 0.5))):
        p.prism((0, 0, i * 0.5), 8, r, r, h, p.vary(STONE_MID, 0.05), phase=math.pi / 8)
    # The drum of skull niches.
    p.prism((0, 0, 1.5), 8, 3.0, 3.0, 4.0, p.vary(STONE_PALE, 0.05), phase=math.pi / 8)
    for i in range(8):
        a = math.tau * (i + 0.5) / 8
        for row in range(3):
            z = 2.1 + row * 1.2
            cx, cy = math.cos(a) * 2.95, math.sin(a) * 2.95
            mark = p.mark()
            p.box((0, 0, 0), (1.4, 0.3, 0.9), (0.06, 0.05, 0.06))
            p.skull((-0.35, 0.02, -0.4), 0.3)
            p.skull((0.35, 0.02, -0.4), 0.3)
            p.turn(mark, Matrix.Translation((cx, cy, z)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z'))
    p.prism((0, 0, 5.5), 8, 3.3, 3.3, 0.35, p.vary(STONE_PALE), phase=math.pi / 8)
    # Buttress ribs and the broken spire.
    for i in range(8):
        a = math.tau * i / 8
        p.box((math.cos(a) * 3.1, math.sin(a) * 3.1, 3.5), (0.6, 0.6, 4.2), p.vary(STONE_MID), bevel=0.05, yaw=a)
        p.spike((math.cos(a) * 3.1, math.sin(a) * 3.1, 5.85), 0.35, 1.4, STONE_PALE, sides=4)
    p.prism((0, 0, 5.85), 8, 2.4, 0.6, 5.5, p.vary(STONE_MID, 0.05), phase=math.pi / 8)
    p.spike((0.2, 0, 11.3), 0.5, 1.2, STONE_PALE, sides=4, lean=(0.3, 0.1))
    # Candles on the lowest step.
    for i in range(16):
        a = math.tau * i / 16 + 0.1
        p.candle((math.cos(a) * 4.0, math.sin(a) * 4.0, 1.0), 0.3 + (i % 3) * 0.2, 0.08)
    return p


def sarcophagus():
    p = P('Sarcophagus', lichen=0.4)
    p.box((0, 0, 0.12), (2.5, 5.3, 0.24), p.vary(STONE_MID), bevel=0.05)
    p.box((0, 0, 0.75), (2.1, 4.9, 1.0), p.vary(STONE_PALE, 0.05), bevel=0.08, taper=0.95)
    for x in (-1.06, 1.06):
        for i in range(4):
            p.box((x, -1.8 + i * 1.2, 0.75), (0.08, 0.8, 0.55), STONE_MID)
    p.box((0, 0, 1.36), (2.3, 5.1, 0.22), p.vary(STONE_PALE), bevel=0.06)
    # The effigy on the lid.
    p.prism((0, 0.6, 1.47), 8, 0.55, 0.42, 0.35, STONE_PALE, squash=2.8)
    p.rock((0, -1.7, 1.72), (0.6, 0.6, 0.55), STONE_PALE, jitter=0.05)
    p.box((0, -0.6, 1.72), (0.45, 0.4, 0.3), STONE_PALE, bevel=0.05)
    return p


# =============================================================== the processional
def shrine_pillar():
    """A tall square shrine pillar with a candle niche and a pyramid cap (12 yd)."""
    p = P('ShrinePillar', lichen=0.4)
    p.box((0, 0, 0.5), (2.6, 2.6, 1.0), p.vary(STONE_MID), bevel=0.08)
    p.masonry(-1.0, 1.0, 1.0, 9.0, 2.0, 0.6, STONE_PALE)
    p.box((0, -1.02, 4.5), (1.1, 0.3, 1.5), (0.05, 0.04, 0.05))
    p.voussoir_arch(1.3, 5.2, 0.6, 0.2, 0.4, STONE_PALE, blocks=7, center=(0, -1.0, 0))
    for x in (-0.3, 0.0, 0.3):
        p.candle((x, -0.95, 3.8), 0.3 + abs(x), 0.07)
    p.box((0, 0, 9.2), (2.5, 2.5, 0.4), p.vary(STONE_PALE), bevel=0.06)
    p.prism((0, 0, 9.4), 4, 1.7, 0.05, 2.8, p.vary(STONE_MID), phase=math.pi / 4)
    return p


def wing_arch():
    """The ruined gateway at each wing causeway (spans 12 along X)."""
    p = P('WingArch', lichen=0.45)
    for x in (-7.2, 7.2):
        p.masonry(x - 1.2, x + 1.2, 0, 13.0 if x < 0 else 10.5, 2.4, 0.6, STONE_MID, ruin=0.25)
    p.voussoir_arch(12.0, 9.0, 5.5, 1.0, 2.2, STONE_PALE, blocks=17, broken=0.25)
    p.skull((-7.2, -1.25, 8.0), 0.45)
    p.skull((7.2, -1.25, 7.0), 0.45)
    return p


def banner():
    """A tattered Gravecaller banner on an iron rod (hangs from a pillar face)."""
    p = P('Banner')
    p.box((0, -1.4, 7.5), (0.08, 0.08, 2.4), IRON, pitch=math.pi / 2)
    p.box((0, -2.6, 7.5), (1.8, 0.06, 0.06), IRON)
    for i in range(10):
        z = 7.4 - i * 0.55
        w = 1.6 * (1 - i * 0.03)
        p.box((p.rng.uniform(-0.05, 0.05), -2.6, z), (w, 0.05, 0.56), p.vary(CLOTH, 0.2), bevel=0.0,
              roll=p.rng.uniform(-0.05, 0.05))
    p.box((0, -2.63, 5.5), (0.7, 0.04, 0.7), p.vary(VIOLET, 0.1), yaw=0.0)
    return p


# =============================================================== the sexton's yard
def headstone(variant):
    p = P('Headstone' + variant, seed=ord(variant), lichen=0.6)
    lean = p.rng.uniform(-0.18, 0.18)
    if variant == 'A':
        p.box((0, 0, 0.8), (1.0, 0.24, 1.6), p.vary(STONE_PALE, 0.1), bevel=0.05, roll=lean)
        p.prism((0, 0, 1.6), 10, 0.5, 0.5, 0.24, STONE_PALE, axis=(0, 1, 0))
    elif variant == 'B':
        p.box((0, 0, 1.0), (0.26, 0.26, 2.0), p.vary(STONE_PALE, 0.1), bevel=0.04, roll=lean)
        p.box((0, 0, 1.45), (1.1, 0.26, 0.26), p.vary(STONE_PALE, 0.1), bevel=0.04, roll=lean)
    elif variant == 'C':
        p.box((0, 0, 0.55), (1.2, 0.3, 1.1), p.vary(STONE_MID, 0.1), bevel=0.06, pitch=lean)
        p.box((0, -0.18, 0.62), (0.7, 0.06, 0.5), STONE_DARK)
    else:
        p.box((0, 0, 0.45), (0.9, 0.24, 0.9), p.vary(STONE_PALE, 0.1), bevel=0.05, roll=lean * 2)
        p.box((0.6, -0.4, 0.12), (0.7, 0.24, 0.5), p.vary(STONE_PALE, 0.1), yaw=0.6, pitch=1.3)
    p.rock((0, -0.9, 0.05), (1.3, 2.0, 0.32), UMBER, flat_bottom=True)
    return p


def lantern_post():
    p = P('LanternPost')
    p.box((0, 0, 0.2), (0.6, 0.6, 0.4), p.vary(STONE_MID), bevel=0.05)
    p.prism((0, 0, 0.4), 6, 0.1, 0.08, 3.6, IRON)
    p.sweep(p.bezier((0, 0, 3.9), (0, -0.2, 4.4), (0, -0.9, 4.2), 6), 0.06, 0.05, IRON)
    p.box((0, -0.9, 3.55), (0.04, 0.04, 0.6), IRON)
    p.box((0, -0.9, 3.0), (0.5, 0.5, 0.6), IRON, bevel=0.03)
    p.box((0, -0.9, 3.0), (0.36, 0.36, 0.46), AMBER, mat=GLOW)
    p.prism((0, -0.9, 3.3), 4, 0.36, 0.05, 0.35, IRON, phase=math.pi / 4)
    return p


def dead_tree():
    p = P('DeadTree', lichen=0.2)
    trunk = [(0, 0, 0), (0.2, 0.1, 2.5), (-0.3, 0.2, 5.0), (0.4, -0.1, 7.5), (0.1, 0.3, 9.5)]
    p.sweep(trunk, 0.7, 0.18, (0.2, 0.17, 0.15), sides=7)
    for i in range(7):
        base = Vector(trunk[1 + i % 3]) + Vector((0, 0, p.rng.random()))
        a = p.rng.random() * math.tau
        tip = base + Vector((math.cos(a) * 3.2, math.sin(a) * 3.2, 1.5 + p.rng.random() * 2))
        mid = base.lerp(tip, 0.5) + Vector((0, 0, 0.8))
        p.sweep(p.bezier(base, mid, tip, 5), 0.2, 0.03, (0.19, 0.16, 0.14), sides=5)
    for i in range(4):
        a = i * 1.6
        p.sweep([(0, 0, 0.4), (math.cos(a) * 1.2, math.sin(a) * 1.2, 0.1), (math.cos(a) * 2.0, math.sin(a) * 2.0, -0.2)], 0.35, 0.08, (0.18, 0.15, 0.13))
    return p


def bell_tower():
    """HERO: the collapsed parish bell tower on its rock massif. Origin at the
    chasm floor under it (the runtime stands it on the void); the Bell Yard is 48
    above. The broken bell beam reaches +X toward the arena with the Burial Bell."""
    p = P('BellTower', lichen=0.35)
    # Rock massif rising from the mist to the yard's level.
    z = 0.0
    r = 12.0
    for i in range(8):
        h = 7.0
        p.rock((p.rng.uniform(-1, 1), p.rng.uniform(-1, 1), z + h / 2), (r * 2, r * 1.8, h * 1.35),
               p.vary(STONE_DARK, 0.1), jitter=0.25, subdivisions=2)
        z += h * 0.92
        r = max(7.0, r * 0.94)
    base = 48.0
    # The tower: masonry shaft with buttresses and lancet openings.
    mark = p.mark()
    for side in range(4):
        m2 = p.mark()
        # A tight tone spread: at hero scale a wide one reads as a checkerboard.
        p.masonry(-4.5, 4.5, 0, 26.0 if side != 1 else 21.0, 1.6, 1.5, STONE_MID, ruin=0.18 if side == 1 else 0.05,
                  bevel=False, spread=0.05)
        p.turn(m2, Matrix.Rotation(side * math.pi / 2, 4, 'Z') @ Matrix.Translation((0, -4.5, 0)))
    for side in range(4):
        a = side * math.pi / 2 + math.pi / 4
        m3 = p.mark()
        p.masonry(-0.9, 0.9, 0, 16.0, 1.6, 1.4, STONE_DARK, bevel=False, spread=0.05)
        p.turn(m3, Matrix.Translation((math.cos(a) * 6.2, math.sin(a) * 6.2, 0)) @ Matrix.Rotation(a, 4, 'Z'))
    for side in range(4):
        m4 = p.mark()
        p.box((0, 0, 0), (2.2, 1.0, 5.5), (0.03, 0.03, 0.04))
        p.voussoir_arch(2.6, 2.8, 1.6, 0.5, 1.2, STONE_PALE, blocks=9)
        p.turn(m4, Matrix.Rotation(side * math.pi / 2, 4, 'Z') @ Matrix.Translation((0, -4.6, 18.0)))
    p.turn(mark, Matrix.Translation((0, 0, base)))
    # The broken belfry top and the beam that carries the bell over the yard.
    top = base + 26.0
    p.box((0, 0, top + 0.3), (9.6, 9.6, 0.6), p.vary(STONE_PALE), bevel=0.1)
    for x, y in ((-4, -4), (4, -4), (-4, 4)):
        p.box((x, y, top + 3.2), (1.2, 1.2, 5.6), p.vary(STONE_MID), bevel=0.08)
    p.spike((-4, -4, top + 6.0), 0.9, 3.2, STONE_PALE, sides=4)
    p.box((9.0, 0, top + 4.8), (20.0, 1.1, 1.2), TIMBER, bevel=0.05, roll=0.08)
    p.box((1.0, 0, top + 2.6), (0.8, 0.8, 4.6), TIMBER, bevel=0.04, roll=-0.5)
    # The Burial Bell: 3 yd bronze on a chain from the beam's end.
    bx = 17.5
    p.sweep([(bx, 0, top + 4.2 - i * 0.6) for i in range(9)], 0.12, 0.12, IRON, sides=5)
    bell_top = top - 0.8
    p.lathe((bx, 0, bell_top - 3.2), [(1.75, 0), (1.9, 0.25), (1.55, 0.8), (1.15, 2.0), (1.0, 2.8), (0.7, 3.2), (0.0, 3.4)], 16, (0.36, 0.27, 0.18))
    p.lathe((bx, 0, bell_top - 3.35), [(1.95, 0), (1.95, 0.25)], 16, (0.3, 0.22, 0.14))
    p.rock((bx, 0, bell_top - 3.5), (0.6, 0.6, 0.6), (0.2, 0.16, 0.12))
    # Fallen masonry on the massif shoulder.
    for i in range(5):
        p.box((p.rng.uniform(-8, 8), p.rng.uniform(-8, 8), base + 0.5), (1.6, 1.2, 1.0), p.vary(STONE_MID), yaw=p.rng.random() * 3, bevel=0.08)
    return p


def open_grave():
    p = P('OpenGrave', weather=0.6)
    p.box((0, 0, -0.02), (1.3, 2.3, 0.08), (0.04, 0.03, 0.03))
    for side in (-1, 1):
        p.rock((side * 1.2, 0.2, 0.2), (0.9, 2.2, 0.55), UMBER, jitter=0.2, flat_bottom=True)
    p.rock((0, 1.6, 0.25), (1.6, 0.9, 0.6), UMBER, jitter=0.2, flat_bottom=True)
    p.box((1.6, 1.4, 0.8), (0.08, 0.08, 1.6), TIMBER, roll=0.4)
    p.box((1.9, 1.4, 0.12), (0.35, 0.05, 0.45), IRON, roll=0.4)
    return p


def grave_mound():
    p = P('GraveMound', weather=0.6)
    p.rock((0, 0, 0.1), (1.4, 2.6, 0.55), UMBER, flat_bottom=True, jitter=0.15)
    p.box((0, -1.2, 0.6), (0.9, 0.2, 1.2), p.vary(STONE_PALE), bevel=0.05, roll=0.15)
    return p


def dead_grass():
    """A tuft of pale dead grass (instanced by the hundred over the graves)."""
    p = P('DeadGrass', weather=0.2, lichen=0.0)
    for i in range(11):
        a = p.rng.random() * math.tau
        r = p.rng.random() * 0.35
        h = 0.35 + p.rng.random() * 0.5
        lean = (math.cos(a) * 0.25, math.sin(a) * 0.25)
        p.spike((math.cos(a) * r, math.sin(a) * r, 0), 0.05, h, p.vary((0.55, 0.52, 0.4), 0.2), sides=3, lean=lean)
    return p


def grave_fence():
    p = P('GraveFence')
    for i in range(9):
        a = math.tau * i / 9
        x, y = math.cos(a) * 1.3, math.sin(a) * 2.0
        p.box((x, y, 0.6), (0.06, 0.06, 1.2), IRON, roll=p.rng.uniform(-0.2, 0.2))
        p.spike((x, y, 1.2), 0.06, 0.2, IRON, sides=4)
    p.sweep([(math.cos(math.tau * i / 16) * 1.3, math.sin(math.tau * i / 16) * 2.0, 0.95) for i in range(13)], 0.03, 0.03, IRON, sides=4)
    p.rock((0, 0, 0.05), (1.8, 3.2, 0.35), UMBER, flat_bottom=True)
    return p


# =============================================================== the widow's gallery
def web_column():
    """A broken rime-crusted column swathed in frost silk: guy strands from its
    broken top to the ground, two silk drapes slung from the top to the floor,
    and a drained body hung from the broken capital on a short strand."""
    p = P('WebColumn', lichen=0.0)
    p.column((0, 0, 0), 12.0, 0.7, STONE_BLUE, sides=10, broken=0.35)
    top = 7.4
    for i in range(6):
        z0 = 1.5 + i * 1.0
        p.sweep([(math.cos(a) * 0.78, math.sin(a) * 0.78, z0 + a * 0.25) for a in [j * 0.6 for j in range(11)]],
                0.05, 0.05, RIME, mat=SILK, sides=4)
    for i in range(9):
        a = i * 0.7
        t = (math.cos(a) * 0.6, math.sin(a) * 0.6, top - (i % 3) * 0.5)
        foot = (math.cos(a) * 3.4, math.sin(a) * 3.4, 0.05)
        p.sweep(p.bezier(t, ((t[0] + foot[0]) / 2, (t[1] + foot[1]) / 2, 2.6), foot, 6), 0.03, 0.02, RIME,
                mat=SILK, sides=3)
    # Two drapes: a fan of strands from the top down to a line on the ground.
    for a0 in (0.4, 3.3):
        for k in range(14):
            a = a0 + k * 0.07
            t = (math.cos(a) * 0.6, math.sin(a) * 0.6, top - 0.2 - (k % 4) * 0.12)
            foot = (math.cos(a) * 3.1 + math.cos(a + 1.57) * (k - 7) * 0.18,
                    math.sin(a) * 3.1 + math.sin(a + 1.57) * (k - 7) * 0.18, 0.04)
            mid = ((t[0] + foot[0]) / 2 * 1.1, (t[1] + foot[1]) / 2 * 1.1, 3.4 - (k % 3) * 0.3)
            p.sweep(p.bezier(t, mid, foot, 7), 0.022, 0.02, RIME, mat=SILK, sides=3)
    # The hung cocoon: a strand from the broken lip, the body clear of the floor.
    cx, cy = 1.15, -0.2
    p.sweep([(0.55, -0.1, top - 0.1), (0.9, -0.15, top - 0.5), (cx, cy, top - 1.2)], 0.035, 0.03, RIME,
            mat=SILK, sides=3)
    p.rock((cx, cy, top - 2.4), (0.8, 0.7, 2.0), (0.82, 0.88, 0.92), mat=SILK, jitter=0.1, subdivisions=2)
    for i in range(8):
        a = p.rng.random() * math.tau
        p.spike((math.cos(a) * 0.6, math.sin(a) * 0.6, top + 0.2), 0.1, -(0.4 + p.rng.random() * 0.7), RIME, sides=4)
    return p


def egg_cluster():
    p = P('EggCluster')
    for i in range(9):
        a = p.rng.random() * math.tau
        r = p.rng.random() * 1.1
        s = 0.55 + p.rng.random() * 0.35
        p.rock((math.cos(a) * r, math.sin(a) * r, s * 0.5), (s, s, s * 1.3), (0.62, 0.72, 0.8), mat=SILK, jitter=0.06, subdivisions=2)
        p.rock((math.cos(a) * r, math.sin(a) * r, s * 0.5), (s * 0.45, s * 0.45, s * 0.6), (0.35, 0.6, 0.75), mat=GLOW, jitter=0.1, subdivisions=1)
    p.rock((0, 0, 0.1), (2.8, 2.8, 0.4), RIME, mat=SILK, flat_bottom=True)
    return p


def great_web():
    """HERO: the Great Web strung between two colossal rime pillars that rise
    out of the chasm (their feet on the chasm floor 34 yd below the arena) on
    either side of the arena's north lip. Origin on the arena floor, web in the
    XZ plane; every strand is anchored on a pillar."""
    p = P('GreatWeb', lichen=0.0)
    px = 16.0
    for x in (-px, px):
        z = -34.0
        r = 3.4
        while z < 14.0:
            h = 6.0
            p.rock((x + p.rng.uniform(-0.3, 0.3), p.rng.uniform(-0.3, 0.3), z + h / 2), (r * 2, r * 1.8, h * 1.25),
                   p.vary(STONE_BLUE, 0.08), jitter=0.12, subdivisions=2)
            z += h * 0.85
            r = max(1.7, r * 0.93)
        p.rock((x, 0, 16.0), (3.6, 3.2, 4.6), RIME, jitter=0.18, subdivisions=2)
        for i in range(7):
            a = p.rng.random() * math.tau
            p.spike((x + math.cos(a) * 1.0, math.sin(a) * 1.0, 17.5), 0.45, 1.6 + p.rng.random() * 2.2, RIME, sides=4,
                    lean=(math.cos(a) * 0.5, math.sin(a) * 0.5))
    cx, cz = 0.0, 9.5
    ax = px - 1.4
    anchors = [(-ax, 0, 15.2), (ax, 0, 14.6), (-ax, 0, 1.6), (ax, 0, 1.3), (-ax, 0, 8.5), (ax, 0, 8.0),
               (-ax, 0, 4.8), (ax, 0, 11.6)]
    for x_, y_, z_ in anchors:
        p.sweep(p.bezier((cx, 0, cz), ((cx + x_) / 2, 0.4, (cz + z_) / 2 - 0.4), (x_, y_, z_), 6), 0.07, 0.05, RIME,
                mat=SILK, sides=4)
    spokes = 18
    for i in range(spokes):
        a = math.tau * i / spokes
        p.sweep([(cx + math.cos(a) * 0.4, 0, cz + math.sin(a) * 0.4),
                 (cx + math.cos(a) * 9.6, 0.05, cz + math.sin(a) * 7.8)], 0.05, 0.035, RIME, mat=SILK, sides=4)
    r = 1.0
    while r < 9.2:
        pts = []
        for i in range(spokes + 1):
            a = math.tau * i / spokes
            sag = 0.25 * math.sin(i * 1.3 + r)
            pts.append((cx + math.cos(a) * r * (1.0 - 0.04 * sag), 0.05, cz + math.sin(a) * r * 0.81 - sag * 0.2))
        p.sweep(pts, 0.03, 0.03, RIME, mat=SILK, sides=3, cap=False)
        r += 0.55 + r * 0.06
    for (x, z, s_) in ((-5, 12, 1.0), (4.5, 6.5, 1.2), (6.0, 13.0, 0.8), (-3.5, 5.0, 0.9)):
        p.rock((x, -0.2, z), (0.9 * s_, 0.8 * s_, 2.0 * s_), (0.82, 0.88, 0.92), mat=SILK, jitter=0.12, subdivisions=2)
    for i in range(30):
        a = p.rng.random() * math.tau
        rr = p.rng.random() * 8.5
        p.rock((cx + math.cos(a) * rr, -0.1, cz + math.sin(a) * rr * 0.81), (0.12, 0.12, 0.12), (0.7, 0.9, 1.0),
               mat=GLOW, subdivisions=1)
    return p


# =============================================================== the choir ruin
def choir_pillar():
    p = P('ChoirPillar', lichen=0.2)
    p.column((0, 0, 0), 14.0, 0.8, STONE_MID, sides=10)
    for ring in range(7):
        z = 1.9 + ring * 1.45
        for i in range(8):
            a = math.tau * i / 8 + ring * 0.3
            p.bone((math.cos(a) * 0.95, math.sin(a) * 0.95, z - 0.5), (math.cos(a) * 0.95, math.sin(a) * 0.95, z + 0.5), 0.07, color=BONE if ring % 2 else BONE_OLD)
    for i in range(8):
        a = math.tau * i / 8
        p.skull((math.cos(a) * 1.15, math.sin(a) * 1.15, 12.2), 0.34, yaw=a + math.pi / 2)
    return p


def bone_organ():
    """HERO: the Bone Organ. Console, stepped femur pipes up to 16 yd, skull
    ornaments and violet soul-light in its throat. Front -Y."""
    p = P('BoneOrgan', lichen=0.1)
    p.masonry(-9, 9, 0, 3.5, 2.8, 0.7, STONE_MID)
    p.box((0, -0.6, 3.6), (18.4, 3.6, 0.3), p.vary(STONE_PALE), bevel=0.05)
    p.box((0, -1.9, 2.4), (6.0, 1.4, 1.2), TIMBER, bevel=0.06, pitch=-0.25)
    for i in range(24):
        p.box((-2.8 + i * 0.24, -2.45, 2.95), (0.2, 0.5, 0.08), BONE if i % 3 else (0.1, 0.08, 0.07), pitch=-0.25)
    # Pipes: femurs stacked into columns, tallest at the centre.
    for i in range(29):
        x = -8.4 + i * 0.6
        t = 1 - abs(x) / 9.0
        h = 4.0 + t * t * 11.5 + (i % 2) * 0.8
        r = 0.18 + 0.06 * t
        y = 0.3 + (i % 2) * 0.35
        p.lathe((x, y, 3.75), [(r * 1.4, 0), (r, 0.5), (r, h - 0.6), (r * 1.3, h - 0.3), (r * 1.5, h)], 7, p.vary(BONE, 0.06))
        p.box((x, y - r * 0.9, 4.6), (r * 1.3, 0.1, r * 1.6), (0.06, 0.03, 0.08))
    # Crown of skulls and the violet throat.
    for i in range(9):
        x = -6 + i * 1.5
        p.skull((x, -0.3, 3.9 + (1 - abs(x) / 9) * 12.8), 0.5, yaw=0)
    for i in range(5):
        p.box((-2.4 + i * 1.2, -0.05, 6.0 + (i % 2) * 0.8), (0.35, 0.1, 2.2), (0.32, 0.2, 0.45), mat=GLOW)
    for side in (-1, 1):
        p.masonry(side * 9.6 - 0.8, side * 9.6 + 0.8, 0, 12.0, 2.4, 0.7, STONE_MID, ruin=0.3)
        p.spike((side * 9.6, 0, 12.2), 0.8, 2.4, STONE_PALE, sides=4)
    return p


def pew():
    """A broken choir pew (3 yd), toppled bone-and-oak."""
    p = P('Pew', lichen=0.2)
    p.box((0, 0, 0.5), (3.0, 0.6, 0.12), p.vary(TIMBER, 0.15), bevel=0.02)
    p.box((0, 0.3, 0.95), (3.0, 0.1, 0.9), p.vary(TIMBER, 0.15), bevel=0.02, roll=0.03)
    for x in (-1.4, 1.4):
        p.box((x, 0.05, 0.5), (0.12, 0.7, 1.0), p.vary(TIMBER, 0.2))
    p.box((0.8, -0.2, 0.2), (1.1, 0.4, 0.1), TIMBER, yaw=0.4, roll=0.3)
    p.skull((-0.6, 0.0, 0.56), 0.22, yaw=0.5)
    return p


def nave_column():
    p = P('NaveColumn', lichen=0.35)
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        p.column((math.cos(ang) * 0.5, math.sin(ang) * 0.5, 0), 13.0, 0.42, STONE_PALE, sides=8, capital=False, plinth=False)
    p.column((0, 0, 0), 14.0, 0.75, STONE_PALE, sides=10)
    return p


def tracery_window():
    """HERO: the choir's great broken tracery window, standing on the loft's
    back lip, framing the crag and the soul column beyond."""
    p = P('TraceryWindow', lichen=0.4)
    for side in (-1, 1):
        p.masonry(side * 8.2 - 1.6, side * 8.2 + 1.6, 0, 17.0, 2.2, 0.7, STONE_MID, ruin=0.12)
    p.voussoir_arch(13.4, 11.0, 9.0, 1.1, 1.9, STONE_PALE, blocks=21, broken=0.0)
    # Mullions and tracery rings; two lancets fallen.
    for x in (-3.4, 0.0, 3.4):
        h = 13.0 if x else 15.5
        p.box((x, 0, h / 2), (0.4, 0.5, h), p.vary(STONE_PALE), bevel=0.04)
    for (cx, cz, r) in ((-1.7, 14.2, 1.5), (1.7, 14.2, 1.5), (0, 17.6, 1.9)):
        for i in range(14):
            a = math.tau * i / 14
            if cx > 0 and i in (3, 4, 5):
                continue
            p.box((cx + math.cos(a) * r, 0, cz + math.sin(a) * r), (r * 0.5, 0.4, 0.2), STONE_PALE, roll=-a + math.pi / 2)
    p.box((0, 0, 0.3), (13.4, 1.9, 0.6), p.vary(STONE_MID), bevel=0.05)
    return p


def candelabrum():
    p = P('Candelabrum')
    p.lathe((0, 0, 0), [(0.6, 0), (0.5, 0.2), (0.12, 0.4), (0.1, 3.4), (0.16, 3.6)], 8, IRON)
    for i in range(5):
        a = math.tau * i / 5
        p.sweep(p.bezier((0, 0, 3.4), (math.cos(a) * 0.3, math.sin(a) * 0.3, 3.3), (math.cos(a) * 0.9, math.sin(a) * 0.9, 3.8), 5), 0.05, 0.04, IRON)
        p.candle((math.cos(a) * 0.9, math.sin(a) * 0.9, 3.8), 0.5 + 0.1 * i, 0.09)
    p.candle((0, 0, 3.65), 0.8, 0.1)
    return p


# =============================================================== the rite ring
def _flame(p, base, height, radius, sides=8):
    """A flame as a teardrop of light: white-hot at the wick, amber through its
    belly, ember-red at the tip (the glow slot is unlit, so the colour is all
    of it)."""
    x, y, z = base
    profile = ((0.0, 0.28), (0.07, 0.86), (0.2, 1.0), (0.36, 0.9), (0.55, 0.62), (0.76, 0.3), (0.92, 0.1))
    hot, belly, tip = (1.0, 0.93, 0.7), AMBER, (0.95, 0.36, 0.1)
    rings = []
    for t, k in profile:
        lean = 0.07 * radius * math.sin(t * 2.6)
        rings.append([p.bm.verts.new(Vector((x + lean + math.cos(math.tau * i / sides) * radius * k,
                                             y + math.sin(math.tau * i / sides) * radius * k, z + height * t)))
                      for i in range(sides)])
    apex = p.bm.verts.new(Vector((x + 0.05 * radius, y, z + height)))

    def tone(t):
        if t < 0.3:
            return tuple(a + (b - a) * (t / 0.3) for a, b in zip(hot, belly))
        return tuple(a + (b - a) * min(1.0, (t - 0.3) / 0.6) for a, b in zip(belly, tip))

    faces = []
    for k in range(len(rings) - 1):
        for i in range(sides):
            faces.append((p.bm.faces.new((rings[k][i], rings[k][(i + 1) % sides], rings[k + 1][(i + 1) % sides],
                                          rings[k + 1][i])), (profile[k][0], profile[k][0], profile[k + 1][0],
                                                              profile[k + 1][0])))
    for i in range(sides):
        faces.append((p.bm.faces.new((rings[-1][i], rings[-1][(i + 1) % sides], apex)),
                      (profile[-1][0], profile[-1][0], 1.0)))
    faces.append((p.bm.faces.new(list(reversed(rings[0]))), (0.0,) * sides))
    for face, ts in faces:
        face.material_index = GLOW
        face.smooth = True
        for loop, t in zip(face.loops, ts):
            loop[p.col] = (*tone(t), 1.0)


def _hoop(p, z, radius, bar, color, segments=24, sides=4):
    """A wrought-iron hoop round the candle's axis."""
    ring = [(math.cos(math.tau * i / segments) * radius, math.sin(math.tau * i / segments) * radius, z)
            for i in range(segments + 1)]
    p.sweep(ring, bar, bar, color, sides=sides, cap=False)


def _wax(p, faces):
    for face in faces:
        face.smooth = True


def _wax_run(p, top, end, thick, color, bulge):
    """A run of wax down the pillar: a soft rivulet thickening to the bead it
    ends in (smooth shaded: wax has no arrises)."""
    mid = top.lerp(end, 0.55) + bulge
    pts = p.bezier(top, mid, end, 3)
    _wax(p, p.sweep(pts, thick * 0.8, thick, color, sides=6))
    _wax(p, p.rock(end - Vector((0, 0, thick * 0.2)), (thick * 2.1, thick * 2.1, thick * 2.7), color, jitter=0.03,
                   subdivisions=1))


def remembrance_candle():
    """A Remembrance Candle of the Rite Ring: a fat tallow pillar run with wax
    on a carved plinth of names, standing in a wrought-iron reliquary cage
    whose ribs close over the flame in a pointed crown, 6.5 yd to its finial
    (a player stands 2.6). Votive ribbons are tied round its ribs and little
    votive lights burn at its foot.

    What the runtime reads off it (src/render/hollow_crypt/morthen_rite_fx_core.ts,
    crypt_plan_core.ts KIT_FLAME_SOCKETS): the wick at 3.55 yd on the axis, the
    flame's tip at 5.22, the tallow 0.95 yd in radius. EVERYTHING on the glow
    slot (the flame, the molten well, the names, the votive lights) is one
    batch instance the Rite hides when it gutters the candle, so a dark candle
    is iron, cold wax and blank names on every graphics tier.
    """
    p = P('RemembranceCandle', lichen=0.12)
    # Wrought iron, a shade lifted: black iron is lost against the night sky.
    iron = (0.31, 0.3, 0.33)
    iron_worn = (0.42, 0.4, 0.42)
    # ---- the plinth: a step, a die carved with the names, a wax-pooled cap.
    p.prism((0, 0, 0), 8, 1.42, 1.36, 0.2, p.vary(STONE_PALE, 0.07), phase=math.pi / 8)
    p.prism((0, 0, 0.2), 8, 1.2, 1.14, 0.5, p.vary(STONE_PALE, 0.04), phase=math.pi / 8)
    p.prism((0, 0, 0.7), 8, 1.27, 1.2, 0.1, p.vary(STONE_PALE, 0.04), phase=math.pi / 8)
    apothem = 1.17 * math.cos(math.pi / 8)
    for i in range(8):
        a = math.tau * i / 8
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        face = out * apothem
        if i % 2 == 0:
            # A dark slate tablet, and the names cut in it: pale in the stone,
            # and (on the glow slot, a hair proud) alight while the candle burns.
            p.box(face + out * 0.02 + Vector((0, 0, 0.45)), (0.6, 0.05, 0.34), p.vary(SLATE, 0.05), yaw=a + math.pi / 2,
                  bevel=0.015)
            for row in range(3):
                width = (0.46, 0.38, 0.3)[(row + i) % 3]
                zz = 0.56 - row * 0.11
                p.box(face + out * 0.05 + Vector((0, 0, zz)) + side * (0.03 * (row - 1)), (width, 0.012, 0.035),
                      (0.62, 0.6, 0.56), yaw=a + math.pi / 2)
                p.box(face + out * 0.062 + Vector((0, 0, zz)) + side * (0.03 * (row - 1)), (width * 0.94, 0.008, 0.022),
                      AMBER, mat=GLOW, yaw=a + math.pi / 2)
        else:
            # A niche with a skull of the remembered, every other face.
            p.box(face + out * 0.005 + Vector((0, 0, 0.44)), (0.36, 0.05, 0.36), (0.09, 0.085, 0.1), yaw=a + math.pi / 2)
            mark = p.mark()
            p.skull((0, 0, 0), 0.19)
            p.turn(mark, Matrix.Translation(face + out * 0.09 + Vector((0, 0, 0.29))) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z'))
    # ---- the tallow: a fat pillar, waisted by years of burning, its crown
    # melted into a well round the wick.
    foot = 0.8
    wick = 3.55
    tall = wick - foot
    tallow = (0.95, 0.9, 0.74)
    tallow_run = (0.97, 0.93, 0.8)
    tallow_aged = (0.88, 0.8, 0.6)
    p.lathe((0, 0, foot), [(1.0, 0.0), (0.97, 0.12), (0.93, 0.4), (0.9, tall * 0.55), (0.88, tall * 0.9),
                           (0.9, tall * 0.97), (0.84, tall + 0.02), (0.62, tall - 0.06), (0.2, tall - 0.12),
                           (0.0001, tall - 0.12)], 16, p.vary(tallow, 0.02))
    p.box((0, 0, wick - 0.02), (0.07, 0.07, 0.22), (0.07, 0.06, 0.05), roll=0.18)
    # The rim: melted unevenly, slumped where the wax ran over.
    for i in range(8):
        a = math.tau * i / 8 + p.rng.uniform(-0.15, 0.15)
        s = p.rng.uniform(0.26, 0.4)
        _wax(p, p.rock((math.cos(a) * 0.82, math.sin(a) * 0.82, wick - 0.02 + p.rng.uniform(-0.03, 0.05)),
                       (s * 1.3, s * 1.3, s * 0.75), p.vary(tallow_run, 0.03), jitter=0.05, subdivisions=1))
    # Wax runs: long rivulets down the flanks, each ending in a bead.
    for i in range(11):
        a = math.tau * i / 11 + p.rng.uniform(-0.2, 0.2)
        # Short fat drips and long thin runs.
        long_run = i % 3 != 1
        length = tall * (p.rng.uniform(0.45, 0.92) if long_run else p.rng.uniform(0.14, 0.3))
        thick = p.rng.uniform(0.06, 0.09) if long_run else p.rng.uniform(0.1, 0.14)
        out = Vector((math.cos(a), math.sin(a), 0))
        top = out * 0.86 + Vector((0, 0, wick - 0.03))
        drift = p.rng.uniform(-0.06, 0.06)
        end = Vector((math.cos(a + drift) * 0.93, math.sin(a + drift) * 0.93, wick - length))
        _wax_run(p, top, end, thick, p.vary(tallow_run if i % 3 else tallow_aged, 0.03), out * 0.03)
    # The melt gathered on the cap in soft folds, and the drips hanging off its lip.
    for i in range(9):
        a = math.tau * i / 9 + p.rng.uniform(-0.2, 0.2)
        r = p.rng.uniform(0.96, 1.12)
        s = p.rng.uniform(0.2, 0.36)
        _wax(p, p.rock((math.cos(a) * r, math.sin(a) * r, 0.81), (s * 1.6, s * 1.6, s * 0.55), p.vary(tallow_aged, 0.05),
                       jitter=0.06, subdivisions=1))
        if i % 3 == 0:
            lip = Vector((math.cos(a) * 1.24, math.sin(a) * 1.24, 0.8))
            _wax_run(p, lip, lip - Vector((0, 0, 0.16 + 0.5 * s)), 0.04, p.vary(tallow_aged, 0.05), Vector((0, 0, 0)))
    # ---- the reliquary cage: four iron ribs up from the plinth, closing over
    # the flame in a pointed crown; two hoops hold them and the candle.
    spring = 4.55
    crown = 6.02
    for i in range(4):
        a = math.pi / 4 + math.tau * i / 4
        out = Vector((math.cos(a), math.sin(a), 0))
        post = [out * 1.3 + Vector((0, 0, 0.78)), out * 1.34 + Vector((0, 0, 2.6)), out * 1.3 + Vector((0, 0, spring))]
        arch = p.bezier(out * 1.3 + Vector((0, 0, spring)), out * 1.22 + Vector((0, 0, 5.75)),
                        out * 0.3 + Vector((0, 0, crown)), 8)
        p.sweep(p.bezier(post[0], post[1], post[2], 6) + arch[1:], 0.09, 0.065, iron, sides=4)
        # A forged foot on the cap, and a collar where the rib springs.
        p.box(out * 1.3 + Vector((0, 0, 0.84)), (0.24, 0.2, 0.1), iron_worn, yaw=a, bevel=0.02)
        p.box(out * 1.3 + Vector((0, 0, spring)), (0.2, 0.2, 0.12), iron_worn, yaw=a, bevel=0.02)
        # A thorn on the rib's shoulder (the crown's crockets).
        p.spike(out * 1.24 + Vector((0, 0, 5.35)), 0.06, 0.42, iron, sides=4, lean=(out.x * 0.2, out.y * 0.2))
    _hoop(p, 1.55, 1.31, 0.065, iron)
    _hoop(p, spring, 1.3, 0.075, iron)
    _hoop(p, crown, 0.3, 0.06, iron_worn, segments=12)
    # Pointed arches between the ribs, under the crown: the cage's windows.
    for i in range(4):
        a0 = math.pi / 4 + math.tau * i / 4
        a1 = a0 + math.tau / 4
        am = (a0 + a1) / 2
        apex = Vector((math.cos(am) * 1.22, math.sin(am) * 1.22, spring + 0.78))
        for an in (a0, a1):
            start = Vector((math.cos(an) * 1.3, math.sin(an) * 1.3, spring))
            turn = an + (am - an) * 0.45
            bend = Vector((math.cos(turn) * 1.34, math.sin(turn) * 1.34, spring + 0.62))
            p.sweep(p.bezier(start, bend, apex, 5), 0.045, 0.04, iron, sides=4)
        p.spike(apex - Vector((0, 0, 0.02)), 0.045, 0.3, iron, sides=4)
        # A thorn hanging in each window off the lower hoop too.
        low = Vector((math.cos(am) * 1.31, math.sin(am) * 1.31, 1.55))
        p.prism(low - Vector((0, 0, 0.26)), 4, 0.0001, 0.05, 0.26, iron)
    # The finial: a collar, a long spike, four barbs.
    p.prism((0, 0, crown - 0.04), 6, 0.2, 0.14, 0.2, iron_worn)
    p.spike((0, 0, crown + 0.14), 0.1, 0.56, iron, sides=4)
    for i in range(4):
        a = math.tau * i / 4
        p.spike((math.cos(a) * 0.12, math.sin(a) * 0.12, crown + 0.1), 0.045, 0.3, iron, sides=4,
                lean=(math.cos(a) * 0.22, math.sin(a) * 0.22))
    # ---- the remembrances: ribbons tied to the ribs, a bone tablet on a chain.
    # Tied round the ribs, below the flame: nothing hangs across the light a
    # player has to read. Plum, not violet: under the crypt's blue moon a
    # violet cloth turns plain blue.
    linen = (0.8, 0.76, 0.66)
    mourning = (0.46, 0.25, 0.34)
    quarter = math.tau / 4
    ribbons = ((math.pi / 4 + 0.07, mourning, 1.45, 3.3), (math.pi / 4 - 0.09, linen, 1.0, 3.05),
               (math.pi / 4 + quarter - 0.06, linen, 1.35, 3.25), (math.pi / 4 + 2 * quarter + 0.08, mourning, 1.1, 3.4),
               (math.pi / 4 + 2 * quarter - 0.08, linen, 1.5, 3.15), (math.pi / 4 + 3 * quarter + 0.05, mourning, 1.3, 3.2),
               (math.pi / 4 + 3 * quarter - 0.1, linen, 0.9, 2.9))
    for a, color, length, tied in ribbons:
        out = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-math.sin(a), math.cos(a), 0))
        # The knot sits on the rib and the cloth sways along it, never out from
        # it: the whole candle stays inside the plinth (the collider, 1.3 yd, and
        # a step: tests/hollow_crypt_remembrance_candle.test.ts pins the reach).
        top = out * 1.38 + Vector((0, 0, tied))
        p.box(top, (0.22, 0.14, 0.12), p.vary(color, 0.06), yaw=a + math.pi / 2)
        segments = 6
        drift = p.rng.uniform(-0.12, 0.12)
        for k in range(segments):
            t0, t1 = k / segments, (k + 1) / segments
            sway0 = math.sin(t0 * 3.1) * 0.05
            sway1 = math.sin(t1 * 3.1) * 0.05
            w0 = 0.1 * (1 - 0.3 * t0)
            w1 = 0.1 * (1 - 0.3 * t1)
            c0 = top - Vector((0, 0, length * t0)) + out * sway0 + side * drift * t0
            c1 = top - Vector((0, 0, length * t1)) + out * sway1 + side * drift * t1
            tone = p.vary(color, 0.08)
            p.plane((c0 - side * w0, c0 + side * w0, c1 + side * w1, c1 - side * w1), tone)
            p.plane((c0 + side * w0 - out * 0.012, c0 - side * w0 - out * 0.012, c1 - side * w1 - out * 0.012,
                     c1 + side * w1 - out * 0.012), tone)
    for a in (1.55, 4.15):
        out = Vector((math.cos(a), math.sin(a), 0))
        hang = out * 1.33 + Vector((0, 0, spring - 0.04))
        p.sweep([hang, hang - Vector((0, 0, 0.55))], 0.018, 0.018, iron_worn, sides=4)
        p.box(hang - Vector((0, 0, 0.78)), (0.28, 0.035, 0.42), p.vary(BONE_OLD, 0.05), yaw=a + math.pi / 2, bevel=0.012)
        for row in range(3):
            p.box(hang - Vector((0, 0, 0.66 + row * 0.1)) + out * 0.022, (0.18, 0.008, 0.025), (0.2, 0.17, 0.14),
                  yaw=a + math.pi / 2)
    # ---- the votive lights left at its foot (their flames go out with the candle).
    for i in range(6):
        a = math.tau * i / 6 + p.rng.uniform(-0.25, 0.25)
        r = p.rng.uniform(1.24, 1.33)
        h = p.rng.uniform(0.16, 0.42)
        p.candle((math.cos(a) * r, math.sin(a) * r, 0.2), h, 0.06, drips=2)
    # ---- the light (all on the glow slot): the flame, and the molten well it stands in.
    p.prism((0, 0, wick - 0.07), 12, 0.4, 0.4, 0.012, (1.0, 0.7, 0.34), mat=GLOW)
    _flame(p, (0, 0, wick), 1.67, 0.46, sides=10)
    return p


def rite_altar():
    """The altar at the ring's centre: a stone slab on bone legs, the lectern
    and the open Ledger of Names glowing soul-green."""
    p = P('RiteAltar', lichen=0.1)
    p.prism((0, 0, 0), 12, 2.8, 2.8, 0.15, p.vary(STONE_DARK), phase=0.1)
    p.box((0, 0, 1.1), (3.6, 1.8, 0.35), p.vary(STONE_PALE), bevel=0.06)
    for x in (-1.4, 1.4):
        for y in (-0.6, 0.6):
            p.bone((x, y, 0.15), (x, y, 0.95), 0.1)
    p.skull((0, -0.95, 0.55), 0.35)
    p.box((0, 1.4, 0.9), (0.2, 0.2, 1.7), IRON)
    p.box((0, 1.4, 1.8), (1.0, 0.7, 0.08), TIMBER, pitch=0.5)
    p.box((0, 1.35, 1.87), (0.9, 0.6, 0.05), (0.35, 0.8, 0.6), mat=GLOW, pitch=0.5)
    for x in (-1.5, 1.5):
        p.candle((x, 0.3, 1.28), 0.5, 0.1)
    return p


def sarcophagus_alcove():
    p = P('SarcophagusAlcove', lichen=0.4)
    p.masonry(-2.6, 2.6, 0, 5.2, 1.0, 0.55, STONE_MID, y=1.2)
    p.voussoir_arch(4.4, 3.6, 1.9, 0.5, 1.4, STONE_PALE, blocks=11, center=(0, 0.6, 0))
    for x in (-2.35, 2.35):
        p.box((x, 0.4, 1.8), (0.5, 1.4, 3.6), p.vary(STONE_PALE), bevel=0.05)
    mark = p.mark()
    sar = sarcophagus_into(p)
    _ = sar
    p.turn(mark, Matrix.Translation((0, 0.2, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Diagonal((0.8, 0.8, 0.8, 1)))
    return p


def sarcophagus_into(p):
    p.box((0, 0, 0.12), (2.5, 5.3, 0.24), p.vary(STONE_MID), bevel=0.05)
    p.box((0, 0, 0.75), (2.1, 4.9, 1.0), p.vary(STONE_PALE, 0.05), bevel=0.08, taper=0.95)
    p.box((0, 0, 1.36), (2.3, 5.1, 0.22), p.vary(STONE_PALE), bevel=0.06)
    return True


def ring_stone():
    p = P('RingStone', lichen=0.5)
    p.box((0, 0, 2.4), (1.4, 0.9, 4.8), p.vary(STONE_DARK, 0.1), bevel=0.15, taper=0.75, roll=p.rng.uniform(-0.06, 0.06))
    for i in range(4):
        p.box((0, -0.46, 1.2 + i * 0.85), (0.5, 0.05, 0.12), SOUL, mat=GLOW)
    p.rock((0, 0, 0.1), (2.0, 1.6, 0.5), STONE_DARK, flat_bottom=True)
    return p


def bone_crown():
    """HERO: four colossal ribs rising out of the chasm beside the ring's rim and arching
    inward to a bone halo 38 yd over the altar; the soul column rises through it."""
    p = P('BoneCrown', lichen=0.0)
    # Four ribs on the diagonals, behind the four sarcophagus alcoves: clear of
    # the choir loft to the south and the Bone Stair's mouth to the north.
    ribs = 4
    for i in range(ribs):
        a = math.tau * (i + 0.5) / ribs
        # The rib rises out of the chasm floor (64 yd under the ring) beside
        # the rim, then arches in over the altar.
        root = Vector((math.cos(a) * 33, math.sin(a) * 33, -64.0))
        foot = Vector((math.cos(a) * 31, math.sin(a) * 31, -2.0))
        knee = Vector((math.cos(a) * 27, math.sin(a) * 27, 22))
        top = Vector((math.cos(a) * 7.5, math.sin(a) * 7.5, 38))
        shaft = [root.lerp(foot, t / 8) for t in range(8)]
        pts = shaft + p.bezier(foot, knee, top, 18)
        color = p.vary(BONE, 0.04)
        p.sweep(pts, 2.1, 0.55, color, sides=10)
        # Vertebra-like knuckles, same bone, so the rib reads as one piece.
        for k in range(3, len(pts) - 1, 4):
            q = Vector(pts[k])
            p.rock(q, (2.1, 2.1, 1.2), color, jitter=0.08, subdivisions=1)
    ring = []
    for i in range(25):
        a = math.tau * i / 24
        ring.append((math.cos(a) * 8.0, math.sin(a) * 8.0, 38.5))
    p.sweep(ring, 0.9, 0.9, BONE, sides=8, cap=False)
    for i in range(12):
        a = math.tau * i / 12
        p.skull((math.cos(a) * 8.4, math.sin(a) * 8.4, 37.2), 0.9, yaw=a + math.pi / 2)
    return p


def distant_spire():
    """A far ruined spire on a rock spike: silhouette only (scaled up at runtime)."""
    p = P('DistantSpire', weather=0.3, lichen=0.0)
    # Overlapping spike rocks up into the spire foot: no gap may open between
    # them at runtime scale (a gap reads as a block floating in the sky).
    for i in range(6):
        p.rock((0, 0, i * 4.2), (9 - i, 8 - i, 8), STONE_DARK, jitter=0.15, subdivisions=1)
    p.prism((0, 0, 19), 6, 3.4, 2.4, 19, STONE_DARK)
    p.prism((0, 0, 38), 6, 2.6, 0.2, 8, STONE_DARK)
    p.box((2.5, 0, 30), (1.0, 1.0, 5), STONE_DARK, roll=0.3)
    return p


BUILDERS = (
    balustrade, parapet, bone_rail, rubble, gargoyle_rubble, gargoyle_chunk, gargoyle_shard,
    lambda: curtain_wall(False), lambda: curtain_wall(True),
    lychgate, mourner_statue, chapel_ruin, rock_pillar, candle_cluster, brazier, skull_pile, coffin_stack,
    lambda: cloister_column(False), lambda: cloister_column(True),
    lambda: arcade_arch('whole'), lambda: arcade_arch('broken'), lambda: arcade_arch('springer'),
    lambda: arcade_arch('fallen'),
    ossuary_monument, sarcophagus, shrine_pillar, wing_arch, banner,
    lambda: headstone('A'), lambda: headstone('B'), lambda: headstone('C'), lambda: headstone('D'),
    lantern_post, dead_tree, bell_tower, open_grave, grave_mound, grave_fence, dead_grass,
    web_column, egg_cluster, great_web,
    choir_pillar, bone_organ, pew, nave_column, tracery_window, candelabrum,
    remembrance_candle, rite_altar, sarcophagus_alcove, ring_stone, bone_crown, distant_spire,
)


def preview(parts, out_png):
    """A review sheet: every piece in a grid under a cold moon and a warm fill."""
    import bpy
    scene = bpy.context.scene
    cols = 8
    cell = 30.0
    for i, obj in enumerate(parts):
        obj.location = ((i % cols) * cell, -(i // cols) * cell, 0)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.03, 0.035, 0.06, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    scene.world = world
    moon = bpy.data.objects.new('moon', bpy.data.lights.new('moon', 'SUN'))
    moon.data.energy = 2.5
    moon.data.color = (0.7, 0.78, 1.0)
    moon.rotation_euler = (0.9, 0.2, 2.6)
    scene.collection.objects.link(moon)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 0.8
    fill.data.color = (1.0, 0.7, 0.45)
    fill.rotation_euler = (1.1, 0.0, -0.8)
    scene.collection.objects.link(fill)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 28
    scene.collection.objects.link(cam)
    scene.camera = cam
    rows = (len(parts) + cols - 1) // cols
    center = Vector(((cols - 1) * cell / 2, -(rows - 1) * cell / 2, 8))
    cam.location = center + Vector((0, -230, 190))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [v.name for v in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Standard'
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 1400
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out_png)


if __name__ == '__main__':
    parts = build_kit('HollowCryptKit_ROOT', BUILDERS)
    export_kit(os.path.join(HERE, 'hollow_crypt_kit_components.glb'))
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--preview' in argv:
        preview(parts, argv[argv.index('--preview') + 1])
    if '--save' in argv:
        import bpy
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--save') + 1])
        print('SAVED')
