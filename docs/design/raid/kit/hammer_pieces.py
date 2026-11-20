"""The Hammer vein kit's built pieces (build_smith_heart_hammer_kit.py): the
quarry's columns and their sockets, the cut blocks, the derrick, the
scaffold, the chain hoist, the quarry faces and lips, the Slab and its
frame, the rubble. Crisp bmesh work (split faces stay flat, joints stay
sharp); the sculpted pieces live in hammer_sculpt.py.

Conventions as the kit's (yards, +Z up, front -Y, origin at the base centre
unless the piece says otherwise). Deterministic: every random draw is the
piece's own seeded rng.
"""
import math

from mathutils import Matrix, Vector

from gwkit import chain_link, chain_run, mix, crystal, hull, loft_z, loop_tube, rivets, rune_strokes, slab
from hckit import GLOW
from shkit import (
    BRONZE, BRONZE_DARK, DRESSED, DRESSED_SHADE, DRESSED_STONE, DUST, GRANITE_DARK, IRON, IRON_DARK, LEATHER,
    MASON_RED, METAL, PAINT, PI, QUARRY, QUARRY_DARK, QUARRY_DEEP, QUARRY_PALE, QUARRY_RED, RAW, ROPE, RUNE_OCHRE,
    SP, TAU, TIMBER, WOOD, TIMBER_DARK, TIMBER_GREY, VEIN, VEIN_DIM, beam, drill_line, light_chain, pole, rope,
)

CHAIN_IRON = (0.25, 0.235, 0.22)


def _rot_z(a):
    return Matrix.Rotation(a, 4, 'Z')


def runes_round(p, glyph, radius, z, unit, width, glow, sides=4, groove=QUARRY_DEEP, phase=0.0):
    """The same carved rune on `sides` faces round the Z axis (each face at
    distance `radius`, the first toward -Y)."""
    for k in range(sides):
        m = p.mark()
        rune_strokes(p, glyph, (-2 * unit, z), unit, width, -radius, glow=glow, groove=groove)
        p.turn(m, _rot_z(phase + TAU * k / sides))


# ===================================================================== the quarry
def pit_column():
    """One of the Quarry's five columns (Mountain's Wrath's cover, 13 yd,
    collider r 2.6): a plinth of quarried stone, a shaft of four octagonal
    drums set a hair askew (dressed, their joints dark), two bronze bands, the
    hammer rune cut on four faces with the vein's light in it, a squared
    capital under a bench-cut abacus. Made to sink into its socket."""
    p = SP('PitColumn', seed=101, ao_dist=2.4)
    with p.as_kind(RAW):
        slab(p, (0, 0, 0.45), (4.4, 4.4, 0.95), QUARRY_DARK, chamfer=0.05, jitter=0.03)
        drill_line(p, (-1.9, -2.21, 0.15), (1.9, -2.21, 0.15), 0.07, 0.42, out=(0, -1, 0))
        drill_line(p, (-2.21, -1.9, 0.15), (-2.21, 1.9, 0.15), 0.07, 0.42, out=(-1, 0, 0))
    with p.as_kind(DRESSED):
        p.box((0, 0, 1.15), (3.7, 3.7, 0.5), DRESSED_SHADE, bevel=0.08)
        z = 1.4
        for i, h in enumerate((2.6, 2.4, 2.7, 2.3)):
            r = 1.5 - i * 0.04
            dx, dy = p.rng.uniform(-0.04, 0.04), p.rng.uniform(-0.04, 0.04)
            twist = PI / 8 + p.rng.uniform(-0.03, 0.03)
            p.lathe((dx, dy, z), [(r * 0.95, 0), (r, 0.1), (r, h - 0.12), (r * 0.95, h)], 8,
                    p.vary(DRESSED_STONE, 0.04), phase=twist, smooth=False)
            z += h
        top = z
        p.box((0, 0, top + 0.35), (3.4, 3.4, 0.7), DRESSED_SHADE, bevel=0.12, taper=1.12)
        p.box((0, 0, top + 0.95), (3.9, 3.9, 0.5), p.vary(DRESSED_STONE, 0.03), bevel=0.1)
    with p.as_kind(METAL):
        for zz in (3.95, 9.35):
            loft_z(p, [(zz - 0.22, 0, 0, 1.58, 1.58, 2.8), (zz + 0.22, 0, 0, 1.56, 1.56, 2.8)], 16, BRONZE)
            rivets(p, [(math.cos(a) * 1.6, math.sin(a) * 1.6, zz) for a in [TAU * i / 8 for i in range(8)]], 0.1,
                   color=BRONZE_DARK)
    apothem = 1.46 * math.cos(PI / 8)
    runes_round(p, 'hammer', apothem, 5.4, 0.36, 0.14, VEIN, sides=4, phase=0.0)
    print('PitColumn top', top + 1.2)
    return p


def pit_column_socket():
    """The column's socket in the quarry floor (flush, 0.2 tall): a square
    frame of dressed stone round the plinth, a dark gap all round where the
    column will sink, and the vein's seam glowing in the gap's floor."""
    p = SP('PitColumnSocket', seed=103, ao=0.4)
    with p.as_kind(DRESSED):
        for k in range(4):
            m = p.mark()
            p.box((0, -3.05, 0.09), (7.0, 1.3, 0.18), p.vary(DRESSED_SHADE, 0.05), bevel=0.05)
            for j in range(3):
                p.box((-2.2 + j * 2.2, -3.71, 0.05), (0.08, 0.04, 0.1), QUARRY_DEEP)
            p.turn(m, _rot_z(PI / 2 * k))
    with p.as_kind(RAW):
        for k in range(4):
            m = p.mark()
            p.box((0, -2.33, 0.02), (4.75, 0.16, 0.04), QUARRY_DEEP)
            p.turn(m, _rot_z(PI / 2 * k))
    with p.as_kind(PAINT):
        for k in range(4):
            m = p.mark()
            p.box((0, -2.33, 0.05), (4.5, 0.06, 0.04), VEIN_DIM, mat=GLOW)
            p.turn(m, _rot_z(PI / 2 * k))
    return p


def cut_block(variant):
    """A quarried block waiting to be hauled (collider 4.8 square, 7.4 tall).
    A: a block with a smaller one set on it, wedge slots along its top edge,
    the drill line it split on, a rope sling and an iron lifting dog. B: one
    great block on a timber sledge over rollers, chocked, a rope coil."""
    import bpy
    import hammer_cliff as hc
    p = SP('CutBlock' + variant, seed=110 + ord(variant), ao_dist=2.0)
    if variant == 'A':
        # The blocks sculpted as split stone (phase 2D: 2C's were boxes).
        hc.cut_stone(bpy, p, 'CutBlockA0', 1101, (0, 0, 2.3), (4.6, 4.5, 4.6))
        hc.cut_stone(bpy, p, 'CutBlockA1', 1103, (0.3, -0.2, 5.85), (3.2, 3.0, 2.5), yaw=0.42, drill=False,
                     target=900)
        with p.as_kind(RAW):
            for k in range(5):
                p.box((-1.6 + k * 0.8, -2.27, 4.45), (0.32, 0.06, 0.22), QUARRY_DEEP)
        with p.as_kind(METAL):
            for k in range(3):
                p.box((-0.8 + k * 0.8, -2.3, 4.5), (0.18, 0.12, 0.42), IRON_DARK, pitch=0.15)
            # The lifting dog: two hooks in the top block's sides, a ring, a chain up.
            c = Vector((0.3, -0.2, 7.3))
            for s in (-1, 1):
                p.sweep([c + Vector((s * 1.55, 0, -1.0)), c + Vector((s * 1.2, 0, 0.2)), c + Vector((0, 0, 0.9))],
                        0.09, 0.09, IRON, sides=6)
            loop_tube(p, [c + Vector((math.cos(a) * 0.35, 0, 1.15 + math.sin(a) * 0.35))
                          for a in [TAU * i / 12 for i in range(12)]], 0.08, IRON_DARK, normal=(0, 1, 0))
        for s in (-1, 1):
            rope(p, (s * 1.4, -1.55, 4.6), (s * 1.4, 1.5, 4.6), 0.08, sag=-0.05)
    else:
        hc.cut_stone(bpy, p, 'CutBlockB0', 1105, (0, 0, 3.45), (4.3, 4.6, 4.9))
        # The sledge: two runners upturned at the front, cross-ties, rollers under.
        for s in (-1, 1):
            beam(p, (s * 1.5, 2.6, 0.75), (s * 1.5, -2.2, 0.75), 0.45, 0.5, TIMBER)
            beam(p, (s * 1.5, -2.2, 0.75), (s * 1.5, -2.85, 1.25), 0.45, 0.45, TIMBER)
        for y in (-1.6, 0.0, 1.6):
            beam(p, (-1.95, y, 1.05), (1.95, y, 1.05), 0.4, 0.3, TIMBER_GREY)
        for y in (-1.4, 1.2):
            pole(p, (-2.1, y, 0.3), (2.1, y, 0.3), 0.3, TIMBER_DARK)
        rope(p, (-1.5, -2.85, 1.2), (-0.4, -3.1, 0.3), 0.08, sag=0.1)
        with p.as_kind(PAINT):
            loop_tube(p, [Vector((1.3 + math.cos(a) * 0.55, -2.9 + math.sin(a) * 0.45, 0.12))
                          for a in [TAU * i / 12 for i in range(12)]], 0.11, ROPE, normal=(0, 0, 1))
    return p


def derrick():
    """The derrick that lifted the blocks (collider r 2.6, 18 yd): a stone
    footing, an A of squared timbers to an iron-capped apex, a back stay, a
    boom hinged low reaching 13 yd over the pit (-Y), a sheave at its tip, a
    chain running down to a hoisted block in a rope sling, a windlass between
    the legs, guy ropes to iron pins."""
    p = SP('Derrick', seed=121, ao_dist=2.0)
    with p.as_kind(RAW):
        slab(p, (0, 0, 0.3), (3.2, 3.0, 0.6), QUARRY_DARK, chamfer=0.06)
    apex = Vector((0, 0.35, 17.0))
    for s in (-1, 1):
        beam(p, (s * 1.55, 0.2, 0.6), apex, 0.55, 0.55, TIMBER)
    beam(p, (0, 2.5, 0.4), apex, 0.5, 0.5, TIMBER_GREY)
    for z in (5.0, 10.0):
        t = z / 17.0
        beam(p, (-1.55 * (1 - t), 0.2 + 0.15 * t, z), (1.55 * (1 - t), 0.2 + 0.15 * t, z), 0.32, 0.32, TIMBER_GREY)
    hinge = Vector((0, -0.5, 2.6))
    tip = Vector((0, -13.0, 15.2))
    beam(p, hinge, tip, 0.6, 0.6, TIMBER)
    beam(p, hinge + Vector((0, 0, 0.5)), tip + Vector((0, 1.0, -0.4)), 0.25, 0.25, TIMBER_DARK)
    with p.as_kind(METAL):
        p.box(tuple(apex + Vector((0, 0, 0.25))), (0.9, 0.9, 0.6), IRON_DARK, bevel=0.06)
        for t in (0.15, 0.5, 0.85):
            q = hinge.lerp(tip, t)
            loft_z(p, [(q.z - 0.2, q.x, q.y, 0.42, 0.42, 3.0), (q.z + 0.2, q.x, q.y, 0.42, 0.42, 3.0)], 10, IRON)
        # The sheave at the tip.
        loop_tube(p, [tip + Vector((0, math.cos(a) * 0.55, math.sin(a) * 0.55 - 0.3))
                      for a in [TAU * i / 14 for i in range(14)]], 0.12, IRON, normal=(1, 0, 0))
    # The chain down from the sheave to the hoisted block.
    end = chain_run(p, tip + Vector((0, -0.55, -0.4)), tip + Vector((0, -0.55, -8.4)), 0.7, 0.32, 0.09,
                    color=CHAIN_IRON)
    with p.as_kind(RAW):
        slab(p, tuple(end + Vector((0, 0, -1.6))), (2.6, 2.4, 2.4), p.vary(QUARRY_PALE, 0.04), yaw=0.3,
             chamfer=0.05)
    for s in (-1, 1):
        rope(p, end + Vector((s * 1.1, 0, -0.4)), end + Vector((0, 0, 0.1)), 0.07)
    # The chain's other run, slack, back down the boom to the windlass.
    rope(p, tip + Vector((0, 0.3, -0.1)), (0, 0.7, 1.8), 0.06, sag=0.6)
    # The windlass: a drum between two posts, its spokes.
    for s in (-1, 1):
        beam(p, (s * 0.9, 0.7, 0.6), (s * 0.9, 0.7, 2.2), 0.3, 0.3, TIMBER_DARK)
    with p.as_kind(PAINT):
        p.prism((-0.8, 0.7, 1.8), 10, 0.42, 0.42, 1.6, ROPE, axis=(1, 0, 0))
    for k in range(4):
        a = TAU * k / 4 + 0.3
        beam(p, (1.05, 0.7, 1.8), (1.05, 0.7 + math.cos(a) * 1.0, 1.8 + math.sin(a) * 1.0), 0.12, 0.12, TIMBER_DARK)
    # Guy ropes from the apex to iron pins.
    for (x, y) in ((-2.7, 1.1), (2.7, 1.1)):
        rope(p, apex, (x, y, 0.45), 0.05, sag=0.4)
        with p.as_kind(METAL):
            p.prism((x, y, 0.25), 6, 0.1, 0.08, 0.45, IRON_DARK)
    return p


def scaffold():
    """Timber scaffolding against the Smith's carving (8 wide, 3 deep, 16
    tall, its back toward +Y on the stone): standards lashed to ledgers, plank
    decks at 5, 10 and 15, cross braces, ladders between the decks, a rope and
    pulley over the top, a bucket and a mallet left on the top deck."""
    p = SP('Scaffold', seed=131, ao_dist=1.6)
    xs = (-3.8, 0.0, 3.8)
    ys = (-1.4, 1.4)
    for x in xs:
        for y in ys:
            pole(p, (x, y, 0), (x + p.rng.uniform(-0.05, 0.05), y, 16.2), 0.16, TIMBER_GREY)
    for z in (5.0, 10.0, 15.0):
        for y in ys:
            pole(p, (-4.2, y, z), (4.2, y, z), 0.13, TIMBER)
        for x in xs:
            pole(p, (x, -1.6, z - 0.15), (x, 1.6, z - 0.15), 0.12, TIMBER)
        # The deck: planks across, a gap or two.
        for k in range(9):
            y = -1.25 + k * 0.32
            if p.rng.random() < 0.1:
                continue
            with p.as_kind(WOOD):
                p.box((p.rng.uniform(-0.1, 0.1), y, z + 0.2), (8.2, 0.3, 0.08), p.vary(TIMBER, 0.1),
                      yaw=p.rng.uniform(-0.01, 0.01))
    for (z0, z1) in ((0.2, 5.0), (5.0, 10.0), (10.0, 15.0)):
        pole(p, (-3.8, -1.45, z0), (0.0, -1.45, z1), 0.09, TIMBER_DARK)
        pole(p, (3.8, -1.45, z0), (0.0, -1.45, z1), 0.09, TIMBER_DARK)
    # Ladders (two rails, rungs).
    for i, (z0, z1, x) in enumerate(((0.0, 5.2, 2.2), (5.2, 10.2, -2.2), (10.2, 15.2, 2.2))):
        for s in (-0.3, 0.3):
            pole(p, (x + s, -1.75, z0), (x + s, -1.2, z1), 0.06, TIMBER)
        for k in range(1, 12):
            t = k / 12
            pole(p, (x - 0.3, -1.75 + 0.55 * t, z0 + (z1 - z0) * t), (x + 0.3, -1.75 + 0.55 * t, z0 + (z1 - z0) * t),
                 0.04, TIMBER_DARK)
    # Lashings at the joints.
    with p.as_kind(PAINT):
        for x in xs:
            for y in ys:
                for z in (5.0, 10.0, 15.0):
                    p.prism((x, y, z - 0.25), 6, 0.2, 0.2, 0.45, ROPE)
    # A gin pole over the top, its pulley and a rope down to a bucket.
    pole(p, (3.8, -1.4, 15.0), (3.8, -3.6, 18.0), 0.1, TIMBER_DARK)
    rope(p, (3.8, -3.6, 17.8), (3.8, -3.6, 6.5), 0.04)
    with p.as_kind(WOOD):
        p.prism((3.8, -3.6, 5.8), 8, 0.32, 0.38, 0.65, TIMBER_DARK)
        p.prism((-1.2, 0.4, 15.3), 8, 0.3, 0.34, 0.55, TIMBER_DARK)
        beam(p, (-2.4, -0.6, 15.35), (-1.6, -0.2, 15.35), 0.1, 0.1, TIMBER)
        p.box((-2.5, -0.65, 15.4), (0.35, 0.3, 0.3), TIMBER_DARK)
    return p


def chain_hoist():
    """A hoist jutting from the rock over the void (origin where its beam
    meets the rock): an iron-strapped timber beam 5 yd out along -Y on an iron
    bracket, a sheave at its end, one chain hanging 14 yd to a hook and a
    block in a sling, a second chain hanging slack and broken."""
    p = SP('ChainHoist', seed=141, ao_dist=1.5)
    with p.as_kind(METAL):
        p.box((0, 0.1, 0), (1.6, 0.3, 2.4), IRON_DARK, bevel=0.06)
        rivets(p, [(x, -0.06, z) for x in (-0.55, 0.55) for z in (-0.8, 0.0, 0.8)], 0.1)
    beam(p, (0, 0.2, 0.0), (0, -5.2, 0.4), 0.6, 0.7, TIMBER)
    beam(p, (0, 0.2, -2.2), (0, -3.6, 0.0), 0.35, 0.35, TIMBER_DARK)
    with p.as_kind(METAL):
        for y in (-1.5, -3.5):
            p.box((0, y, 0.25), (0.7, 0.25, 0.85), IRON, bevel=0.03)
        tip = Vector((0, -5.0, 0.0))
        loop_tube(p, [tip + Vector((0, math.cos(a) * 0.5, math.sin(a) * 0.5 - 0.35))
                      for a in [TAU * i / 14 for i in range(14)]], 0.11, IRON, normal=(1, 0, 0))
    # Light chains (phase 2E: a hoist is hung by the dozen along the lips).
    end = light_chain(p, tip + Vector((0, -0.5, -0.5)), tip + Vector((0, -0.5, -13.5)), 0.66, 0.3, 0.085, CHAIN_IRON)
    with p.as_kind(METAL):
        p.sweep([end, end + Vector((0, 0, -0.6)), end + Vector((0, -0.4, -1.0)), end + Vector((0, -0.6, -0.6))],
                0.11, 0.08, IRON_DARK, sides=6)
    with p.as_kind(RAW):
        slab(p, tuple(end + Vector((0, -0.2, -2.6))), (2.2, 2.0, 1.9), p.vary(QUARRY_PALE, 0.04), yaw=0.5,
             chamfer=0.05)
    for s in (-1, 1):
        rope(p, end + Vector((s * 0.9, -0.2, -1.8)), end + Vector((0, -0.4, -0.9)), 0.07)
    light_chain(p, tip + Vector((0, 0.45, -0.5)), tip + Vector((0, 0.6, -7.5)), 0.66, 0.3, 0.085, CHAIN_IRON)
    return p


# ===================================================================== quarry faces
def _split_face(rng, x0, x1, z0, z1, min_w, min_h, depth=0, out=None):
    """Cut a face's rectangle into blocks the way a quarry gives them up:
    a recursive split, mostly across the longer side, so a face holds great
    monoliths beside clusters of smaller lifts (never one even grid of
    courses). Returns (x0, x1, z0, z1) boxes."""
    out = [] if out is None else out
    w, h = x1 - x0, z1 - z0
    stop = depth >= 5 or (w < min_w * 2 and h < min_h * 2) or (depth >= 2 and rng.random() < 0.2)
    if stop:
        out.append((x0, x1, z0, z1))
        return out
    vertical = (w / max(h, 1e-3)) * rng.uniform(0.55, 1.6) > 1.0
    if vertical and w >= min_w * 2:
        c = x0 + w * rng.uniform(0.3, 0.7)
        _split_face(rng, x0, c, z0, z1, min_w, min_h, depth + 1, out)
        _split_face(rng, c, x1, z0, z1, min_w, min_h, depth + 1, out)
    elif h >= min_h * 2:
        c = z0 + h * rng.uniform(0.32, 0.68)
        _split_face(rng, x0, x1, z0, c, min_w, min_h, depth + 1, out)
        _split_face(rng, x0, x1, c, z1, min_w, min_h, depth + 1, out)
    else:
        out.append((x0, x1, z0, z1))
    return out


def _giant_face(p, rng, x0, x1, z_top, z_bot, depth, proud=(-0.9, 0.25), bench=0.55, crack=0.35, chisel=0.4,
                drill=0.22, wedge=0.0, pale=0.14, foot=True, overhang=0.25, min_w=1.6, min_h=1.1, front_max=None,
                rough=0.22):
    """A face cut by a giant: z_top (the lip) down to z_bot between x0 and
    x1, toward -Y, its body `depth` back. Blocks of every size (a recursive
    split), the lower lifts standing proud of the upper ones (`bench` yd a
    lift), a few jutting out under the lip as overhangs with a black
    underside, deep joints and long vertical cracks down to a near-black back
    mass, bands of chisel strokes across some blocks, drill lines down the
    splits, iron wedges left in a few, and (with `foot`) broken blocks and
    spoil fallen at its foot. `front_max` caps how far anything stands out
    (-Y) of the lip line (a rim over a walked floor)."""
    span = z_top - z_bot
    # The back mass: the near-black of every joint and crack.
    p.box(((x0 + x1) / 2, depth * 0.72, (z_top + z_bot) / 2), (x1 - x0, depth * 0.5, span), QUARRY_DEEP)
    limit = -1e9 if front_max is None else -front_max
    # Long cracks running down through several blocks: the blocks either side
    # stand apart there (a dark gap) and the crack is cut black down the face.
    n_cracks = 2 if rng.random() < crack * 0.5 else (1 if rng.random() < crack else 0)
    cracks = [rng.uniform(x0 + 1.0, x1 - 1.0) for _ in range(n_cracks)]
    for (a, b, zb, zt) in _split_face(rng, x0, x1, z_bot, z_top, min_w, min_h):
        if b - a < 0.35 or zt - zb < 0.35:
            continue
        lift = (z_top - (zt + zb) / 2) / max(span, 1e-3)          # 0 at the lip, 1 at the foot
        yo = -bench * lift * (span / 2.6) + rng.uniform(*proud)
        top_row = zt > z_top - 0.05
        hang = top_row and rng.random() < overhang
        if hang:
            yo = proud[0] - rng.uniform(0.2, 0.6)
        yo = max(yo, limit)
        gap = 0.06 + (0.24 if any(a - 0.2 < c < b + 0.2 for c in cracks) else 0.0) + rng.uniform(0.0, 0.06)
        aa, bb = a + gap / 2, b - gap / 2
        zz0, zz1 = zb + gap / 2, zt - (0.02 if top_row else gap / 2)
        d = depth * rng.uniform(0.8, 1.0)
        r = rng.random()
        if r < 0.5:
            tone = QUARRY
        elif r < 0.85:
            tone = mix(QUARRY, QUARRY_DARK, rng.uniform(0.35, 0.9))
        else:
            tone = mix(QUARRY, QUARRY_PALE, rng.uniform(0.35, 0.75))
        if rng.random() < pale * 0.6:
            tone = mix(tone, QUARRY_PALE, 0.55)
        if rng.random() < 0.08:
            tone = mix(tone, QUARRY_RED, 0.35)
        broken = rng.random() < rough and not hang
        cx, cz = (aa + bb) / 2, (zz0 + zz1) / 2
        w, h = bb - aa, zz1 - zz0
        if broken:
            # A split block: rough, its corners knocked off, its face uneven.
            crystal(p, (cx, yo + d / 2, cz), (w, d, h), p.vary(tone, 0.04), n=22, boxy=0.22, jitter=0.08)
        else:
            slab(p, (cx, yo + d / 2, cz), (w, d, h), p.vary(tone, 0.03),
                 chamfer=rng.uniform(0.02, 0.06), jitter=rng.uniform(0.02, 0.06),
                 yaw=rng.uniform(-0.015, 0.015), roll=rng.uniform(-0.012, 0.012))
        face_y = yo - 0.02
        # Chisel bands: a run of parallel strokes across part of the block
        # (the giant's point and claw), sometimes on the slant.
        if not broken and w > 1.2 and h > 0.9 and rng.random() < chisel:
            n = int(rng.uniform(3, 7))
            band_w = w * rng.uniform(0.45, 0.9)
            bx = cx + rng.uniform(-(w - band_w) / 2, (w - band_w) / 2)
            slant = rng.choice([0.0, 0.0, 0.5, -0.5])
            pitch_z = min(0.32, h / (n + 1))
            z0b = zz0 + rng.uniform(0.15, max(0.2, h - n * pitch_z - 0.15))
            for k in range(n):
                p.box((bx, face_y, z0b + k * pitch_z), (band_w, 0.04, 0.05), QUARRY_DEEP, roll=slant * 0.35)
        if rng.random() < drill:
            xx = aa + 0.14 if rng.random() < 0.5 else bb - 0.14
            drill_line(p, (xx, face_y, zz0 + 0.15), (xx, face_y, zz1 - 0.15), 0.07, 0.34, out=(0, -1, 0))
        if wedge and not top_row and rng.random() < wedge:
            with p.as_kind(METAL):
                for k in range(max(1, int(w / 0.8))):
                    p.box((aa + 0.4 + k * 0.8, face_y - 0.03, zz1 + 0.02), (0.18, 0.16, 0.38), IRON_DARK, pitch=0.25)
        if hang:
            # The overhang's underside: a black shadow line under the lip.
            p.box((cx, yo + 0.6, zz0 - 0.03), (w * 0.96, 1.0, 0.06), QUARRY_DEEP)
    for c in cracks:
        # The crack itself: a black wedge down the face, wider at the top.
        n = 5
        for k in range(n):
            za = z_top - span * k / n
            zb2 = z_top - span * (k + 1) / n
            xa = c + rng.uniform(-0.25, 0.25)
            yc = -0.06 if front_max is not None else -0.35
            p.box((xa, yc, (za + zb2) / 2), (0.16 + 0.12 * (n - k) / n, 0.4, za - zb2 + 0.05), QUARRY_DEEP,
                  roll=rng.uniform(-0.12, 0.12))
    if foot:
        # Spoil and broken blocks fallen at the foot (on the step below).
        y_foot = -bench * (span / 2.6) - 0.5
        for k in range(int(rng.uniform(4, 8))):
            s = rng.uniform(0.45, 1.6)
            x = rng.uniform(x0 + 0.5, x1 - 0.5)
            crystal(p, (x, y_foot - rng.uniform(0.2, 1.8), z_bot + s * 0.32), (s * 1.4, s, s * 0.75),
                    p.vary(QUARRY if k % 3 else QUARRY_PALE, 0.06), n=14, boxy=0.4, jitter=0.15,
                    yaw=rng.uniform(0, TAU), pitch=rng.uniform(-0.4, 0.4), floor=z_bot)
        # A talus of fine spoil along the foot.
        crystal(p, ((x0 + x1) / 2 + rng.uniform(-1, 1), y_foot - 0.6, z_bot + 0.1), ((x1 - x0) * 0.7, 2.2, 0.9),
                QUARRY_DARK, n=16, boxy=0.7, jitter=0.1, floor=z_bot)


def quarry_face(variant):
    """A module of the quarry's terrace risers (8.8 yd along X, ends run 0.4
    past to overlap): origin on the lip, the face dropping 7.4 to the step
    beneath, toward -Y; its body 3 yd back under the step above. Sculpted as
    a giant cut it (hammer_cliff.py: benches, blocks of every size, deep
    joints and cracks, an overhang, chisel bands and drill channels), spoil
    fallen at its foot. A: a long crack. B: a block pulled out and another
    jutting. C: a seam of the Hammer's light across a fresh face, a red-ochre
    guide line snapped across."""
    import bpy
    import hammer_cliff as hc
    seeds = {'A': 151, 'B': 157, 'C': 163}
    p = SP('QuarryFace' + variant, seed=seeds[variant], marks=variant == 'C', ao_dist=2.0)
    vein = None
    if variant == 'C':
        # In the lip's own bench (never pulled out): the seam can't hang in a notch.
        vein = [(-4.9, -0.12, -1.1), (-2.0, -0.15, -0.8), (0.4, -0.15, -1.3), (2.6, -0.15, -0.9), (4.9, -0.12, -1.2)]
    hc.sculpt_face(bpy, p, 'QuarryFace' + variant, seeds[variant], -4.4, 4.4, -0.02, -7.4, 3.0, target=2200,
                   crack=0.9 if variant == 'A' else 0.4, notch=0.8 if variant == 'B' else 0.3,
                   overhang=0.45 if variant == 'B' else 0.25, vein=vein, wmin=4.5, wmax=11.0)
    return p


def quarry_rim(variant):
    """A module for the pit's own rim, where a walked floor meets the
    terrace above (8.8 yd along X, 7.4 tall): the giant's benches, joints,
    cracks and tool marks, but nothing standing out over the floor below
    (origin on the lip, the face toward -Y, never more than 0.25 yd proud)."""
    import bpy
    import hammer_cliff as hc
    seeds = {'A': 211, 'B': 217}
    p = SP('QuarryRim' + variant, seed=seeds[variant], marks=variant == 'B', ao_dist=1.6)
    hc.sculpt_face(bpy, p, 'QuarryRim' + variant, seeds[variant], -4.4, 4.4, -0.02, -7.4, 3.0, target=2000,
                   foot=False, bench=0.08, proud=0.12, overhang=0.0, notch=0.4, front_max=0.25, wmin=2.8,
                   wmax=7.5)
    return p


def great_cliff(variant):
    """A crown of the quarry's back wall (hammer_cliff.great_cliff)."""
    import bpy
    import hammer_cliff as hc
    p = SP('GreatCliff' + variant, seed=400 + ord(variant), ao_dist=6.0)
    return hc.great_cliff(bpy, p, variant)


def rubble_pile():
    """A heap of quarry spoil off the walks (6 across, 1.8 tall): split chips,
    a few spalls, dust drifted round its foot."""
    p = SP('RubblePile', seed=181, ao_dist=1.2)
    rng = p.rng
    with p.as_kind(RAW):
        crystal(p, (0, 0, 0.1), (5.4, 4.6, 1.4), DUST, n=18, boxy=0.9, jitter=0.1, floor=0.0)
        for k in range(26):
            a = rng.uniform(0, TAU)
            r = rng.uniform(0, 2.6) ** 0.8
            s = rng.uniform(0.35, 1.2) * (1.2 - r / 3.5)
            slab(p, (math.cos(a) * r, math.sin(a) * r, 0.5 + (2.6 - r) * 0.35), (s * 1.3, s, s * 0.7),
                 p.vary(QUARRY if k % 3 else QUARRY_PALE, 0.08), yaw=rng.uniform(0, TAU), pitch=rng.uniform(-0.4, 0.4),
                 roll=rng.uniform(-0.4, 0.4), chamfer=0.12, jitter=0.12)
    return p


def brazier(p, base, h=1.7, plinth=3.0):
    """A warm brazier of the Smith's (the Cleft's welcome): a dressed
    octagonal pedestal (its plinth run `plinth` yd down into the rock, so it
    stands on any ledge), a bronze bowl on three lion-less claws, a bed of the
    vein's coals glowing in it and low tongues of fire (the glow slot: the
    light itself is the budgeted point light over it)."""
    from shkit import COAL, DRESSED, GEODE_TIP, METAL
    bx, by, bz = base
    with p.as_kind(DRESSED):
        p.prism((bx, by, bz - plinth), 8, 0.85, 0.85, plinth, p.vary(DRESSED_SHADE, 0.04))
        p.prism((bx, by, bz), 8, 0.7, 0.6, h * 0.2, DRESSED_STONE)
        p.prism((bx, by, bz + h * 0.2), 8, 0.42, 0.4, h * 0.55, p.vary(DRESSED_STONE, 0.04))
        p.prism((bx, by, bz + h * 0.72), 8, 0.5, 0.62, h * 0.1, DRESSED_SHADE)
    with p.as_kind(METAL):
        p.lathe((bx, by, bz + h * 0.8), [(0.35, 0.0), (0.75, 0.18), (0.95, 0.5), (0.98, 0.58), (0.86, 0.6)], 12,
                BRONZE, smooth=False)
        for k in range(3):
            a = TAU * k / 3
            p.sweep([(bx + math.cos(a) * 0.55, by + math.sin(a) * 0.55, bz + h * 0.82),
                     (bx + math.cos(a) * 0.95, by + math.sin(a) * 0.95, bz + h * 1.05)], 0.07, 0.04, BRONZE_DARK,
                    sides=5)
    with p.as_kind(PAINT):
        crystal(p, (bx, by, bz + h * 0.8 + 0.42), (1.5, 1.5, 0.35), COAL, n=14, boxy=0.6, jitter=0.2, mat=GLOW)
        for k in range(5):
            a = TAU * k / 5 + 0.3
            r = 0.35 if k else 0.0
            tip = (bx + math.cos(a) * r * 0.6, by + math.sin(a) * r * 0.6, bz + h * 0.8 + 0.6 + p.rng.uniform(0.5, 0.95))
            p.sweep([(bx + math.cos(a) * r, by + math.sin(a) * r, bz + h * 0.8 + 0.5), tip], 0.18, 0.02,
                    GEODE_TIP if k == 0 else COAL, sides=5, mat=GLOW)


def floor_crack(variant):
    """Cracks in the quarry's bedrock floor (inlaid flat, under 0.05 tall:
    the floor's telegraphs always draw over them): a main fissure wandering
    across with its branches, dark and wide where the stone parted, narrowing
    to hairlines, pale crumbs and spalls lifted along its lips. A: a long
    fissure (about 9 yd). B: a star of cracks from a struck point."""
    p = SP('FloorCrack' + variant, seed=191 + ord(variant), ao=0.0)
    rng = p.rng

    def run(x, y, ang, length, w, depth=0):
        seg = 0.45
        n = max(2, int(length / seg))
        for i in range(n):
            # A fracture runs straight and kinks (never a wandering worm).
            ang += rng.uniform(-0.12, 0.12) + (rng.choice([-1, 1]) * rng.uniform(0.4, 0.8) if rng.random() < 0.15 else 0)
            nx, ny = x + math.cos(ang) * seg, y + math.sin(ang) * seg
            ww = w * (1 - i / n * 0.8)
            # Paper thin (phase 2D): at 2C's 0.036 the sides caught the low sun
            # and the cracks read as sticks lying on the floor.
            with p.as_kind(PAINT):
                p.box(((x + nx) / 2, (y + ny) / 2, 0.006), (seg * 1.08, max(0.03, ww), 0.012),
                      mix(QUARRY_DARK, QUARRY_DEEP, 0.75), yaw=ang)
            if ww > 0.06 and rng.random() < 0.25:
                side = rng.choice([-1, 1])
                ox, oy = -math.sin(ang) * side * (ww + 0.12), math.cos(ang) * side * (ww + 0.12)
                with p.as_kind(RAW):
                    p.box((x + ox, y + oy, 0.012), (rng.uniform(0.12, 0.3), rng.uniform(0.1, 0.22), 0.024),
                          p.vary(QUARRY_PALE, 0.06), yaw=rng.uniform(0, TAU))
            if depth < 1 and rng.random() < 0.08:
                run(nx, ny, ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1), length * rng.uniform(0.25, 0.45),
                    ww * 0.6, depth + 1)
            x, y = nx, ny

    if variant == 'A':
        run(-4.5, 0.0, 0.0, 9.5, 0.1)
    else:
        for k in range(3):
            run(0.0, 0.0, TAU * k / 3 + rng.uniform(-0.5, 0.5), rng.uniform(2.0, 5.0), 0.09)
        with p.as_kind(RAW):
            crystal(p, (0, 0, 0.015), (0.9, 0.8, 0.03), p.vary(QUARRY_DARK, 0.04), n=12, boxy=0.5, jitter=0.2)
    # Centre the cracks on the origin (the walk wanders off its start).
    xs = [v.co.x for v in p.bm.verts]
    ys = [v.co.y for v in p.bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    for v in p.bm.verts:
        v.co.x -= cx
        v.co.y -= cy
    return p


def chip_scatter():
    """Chips and dust on a walked floor (5 across, flat: under a hand tall)."""
    p = SP('ChipScatter', seed=187, ao=0.0)
    rng = p.rng
    with p.as_kind(RAW):
        for k in range(30):
            a = rng.uniform(0, TAU)
            r = rng.uniform(0, 2.4)
            s = rng.uniform(0.12, 0.38)
            slab(p, (math.cos(a) * r, math.sin(a) * r, s * 0.18), (s * 1.4, s, s * 0.3),
                 p.vary(QUARRY_PALE if k % 2 else QUARRY, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.2, jitter=0.15)
    return p


# ===================================================================== the Slab
SLAB_W, SLAB_H, SLAB_T = 15.2, 9.0, 2.2
# The split down the slab (x at each height), shared by both halves.
SPLIT = [(0.2, 0.0), (-0.45, 1.4), (0.35, 2.9), (-0.2, 4.1), (0.55, 5.6), (-0.3, 7.0), (0.25, 8.2), (-0.1, 9.0)]


def _prism_poly(p, outline, y0, y1, color):
    """A flat polygon (x, z points, counter-clockwise seen from -Y) extruded
    from y0 to y1."""
    bm = p.bm
    before = set(bm.faces)
    front = [bm.verts.new((x, y0, z)) for x, z in outline]
    back = [bm.verts.new((x, y1, z)) for x, z in outline]
    n = len(outline)
    bm.faces.new(list(reversed(front)))
    bm.faces.new(back)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    faces = [f for f in bm.faces if f not in before]
    p._paint(faces, color, 0)
    return faces


def slab_half(side):
    """One half of the Slab (both in the shut slab's frame: its base centre).
    Living stone: a dressed border, the field inside pick-dressed, the Hammer's
    rune of the vein cut across both halves with the light in it, the split
    jagged down the middle. side -1 the west half (L), +1 the east (R)."""
    name = 'SlabHalfL' if side < 0 else 'SlabHalfR'
    p = SP(name, seed=191 if side < 0 else 193, ao_dist=1.6)
    import bpy
    import hammer_cliff as hc
    # The great hammer rune of the vein across both halves (the handle and
    # its grip on the west half, the head spanning the split); the sculpt
    # cuts every stroke and the split keeps each half's share.
    strokes = [((-1.3, 1.2), (-1.3, 5.6)), ((-4.0, 5.6), (3.0, 5.6)), ((-4.0, 7.8), (3.0, 7.8)),
               ((-4.0, 5.6), (-4.0, 7.8)), ((3.0, 5.6), (3.0, 7.8)), ((-2.3, 2.0), (-0.3, 2.0))]
    hc.slab_half_sculpt(bpy, p, side, SPLIT, SLAB_W, SLAB_H, SLAB_T, strokes)
    return p


def slab_frame():
    """The Slab's frame over the stair (origin on the stair at the slab's
    line, the frame 2 yd north of it, toward -Y: the Balcony side): two dressed monoliths rising out of
    the fissure from -20 to 14 at x +-9.6 (clear of the stair), banded and
    cut with the Smith's four tools, a lintel 22 yd across with the vein's
    hammer rune, a cornice over it, the split already showing through it."""
    import bpy
    import hammer_cliff as hc
    p = SP('SlabFrame', seed=197, ao_dist=3.0)
    y = -2.0
    hc.slab_frame_sculpt(bpy, p, y)
    with p.as_kind(RAW):
        for s in (-1, 1):
            crystal(p, (s * 9.7, y + 0.4, -18.0), (5.0, 5.0, 8.0), QUARRY_DARK, n=16, boxy=0.4)
    # The tools on the jambs, the hammer on the lintel.
    for s, glyph in ((-1, 'tongs'), (1, 'anvil')):
        m = p.mark()
        rune_strokes(p, glyph, (-1.0, 8.6), 0.5, 0.18, -1.62, glow=RUNE_OCHRE, groove=QUARRY_DEEP)
        p.turn(m, Matrix.Translation((s * 9.7, y, 0)))
    m = p.mark()
    rune_strokes(p, 'hammer', (-1.3, 14.4), 0.42, 0.18, -1.82, glow=RUNE_OCHRE, groove=QUARRY_DEEP)
    p.turn(m, Matrix.Translation((0, y, 0)))
    # The split through the lintel's middle, glowing faintly.
    with p.as_kind(PAINT):
        for (x0, z0, x1, z1) in ((0.3, 14.0, -0.2, 15.4), (-0.2, 15.4, 0.25, 16.8)):
            ang = math.atan2(z1 - z0, x1 - x0)
            p.box(((x0 + x1) / 2, y - 1.83, (z0 + z1) / 2), (math.hypot(x1 - x0, z1 - z0), 0.06, 0.1), VEIN_DIM,
                  mat=GLOW, roll=-ang)
    return p


def slab_chunk(variant):
    """Debris of the breaking Slab (origin at its middle, tumbled by the
    runtime): a dressed face on one side, raw split faces elsewhere."""
    sizes = {'A': (2.2, 1.8, 1.6), 'B': (1.4, 1.2, 1.0), 'C': (0.8, 0.7, 0.6)}
    p = SP('SlabChunk' + variant, seed=200 + ord(variant), ao=0.5)
    with p.as_kind(DRESSED):
        crystal(p, (0, 0, 0), sizes[variant], p.vary(DRESSED_SHADE, 0.05), n=20, boxy=0.3, jitter=0.2)
    return p
