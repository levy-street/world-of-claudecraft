"""The Gravewyrm Sanctum kit: every piece of the Ice Tomb of the Wyrm.

Run (background, one scene):
  blender -b --factory-startup --python build_gravewyrm_sanctum_kit.py -- \
      [--preview out.png] [--closeups DIR] [--stages DIR] [--pieces A,B] [--save out.blend]

Writes gravewyrm_sanctum_kit_components.glb next to this file (a full build
only; `--pieces` builds a subset for review renders and writes nothing); the
shipping build (scripts/assets/gravewyrm_sanctum_kit/build.mjs) validates,
fingerprints and meshopts it into public/models/props/gravewyrm_sanctum_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, as
src/render/wildheart_basin/basin_kit.ts does). Game yards, +Z up, front -Y
(the game's +Z after the glTF export), origin at the base centre where the
runtime stands it, on the pilot's three material slots: KitStone (lit:
rock, ice, snow, iron, hide, the figures), KitGlow (emissive: runes, coals,
soulfire, crack light, the shard), KitGlass (translucent: clear ice shells,
meltwater). Edge pieces run along X with their OUTER (drop) side toward -Y.

Exceptions to "origin at the base centre", by design:
  - every Face* piece, Kit_WyrmSilhouette and Kit_WyrmHeart share the Calving
    Face's frame (gravewyrm_face.py): one transform places them all;
  - Kit_FaceChunkA to C: origin at the chunk's middle (the runtime tumbles it);
  - Kit_IceWall_A to G: the shards share the wall's frame (its base centre);
  - Kit_IceBridge and Kit_ChainBridge: origin on the walking deck's surface
    (the deck lies at z 0, the structure hangs below it);
  - Kit_CrevasseEdgeA to C and Kit_RockCliff: origin on the lip (z 0), the
    face drops to -64 toward -Y;
  - Kit_FrozenFall: origin on the rock lip the fall hangs from;
  - Kit_ChainBroken: origin at the hang point, the chain hangs down from it;
  - Kit_IceChunkA to C: origin at the waterline;
  - Kit_MeltChannel: origin on the ice surface at the channel's centre line;
  - Kit_ChainLink: origin at the link's middle (to instance along a run).

Palette (docs/design/dungeon-rework/gravewyrm_sanctum.md, section 8): glacier
blue #7FC4E8, deep ice #2E6F9E, snow and rime #EEF6FA, slate #4A5058, the
Smith's rune blue #5AB8FF, old iron chain #3A3D42, cult soot black and pyre
orange #E8862E, soul violet-green #8FD6A0 with #7A58B8, shard rose-gold
#F2B880. Decoration never out-glows a telegraph: the glow slot is runes,
coals, soulfire, crack light and the shard's heart, all held dim.

Weathering is per vertex and per face kind (gwkit.GPiece.finish). The
organic figures are SDF sculpts (gravewyrm_sculpt.py on the Wildheart
jaguar's primitives, jaguar_head_sculpt.py).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gravewyrm_face as gf  # noqa: E402
import gravewyrm_nature as gn  # noqa: E402
from gwkit import (  # noqa: E402
    BONE, CHAIN, CULT_CLOTH, CULT_RED, DARK, DEEP_ICE, EMBER, EMBER_DIM, FUR, FUR_DARK, FUR_PALE, GLACIER, GLASS,
    GLASS_ICE, GLOW, HIDE, ICE, ICE_CORE, ICE_FRESH, ICE_MID, ICE_PALE, IRON, IRON_DARK, LEATHER, MELT, PAINT, PI,
    PYRE, RIME, ROCK, ROPE, RUNE, RUNE_DEAD, RUNE_DIM, SEAL_EDGE, SEAL_STONE, SLATE, SLATE_DARK, SLATE_DEEP,
    SLATE_LIGHT, SLATE_RUST, SNOW, SOOT, SOUL, SOUL_VIOLET, STONE, TAU, TIMBER, TIMBER_DARK, P, _fbm, chain_link,
    chain_run, crystal, hull, icicles, link_loop, loft_x, loft_z, loop_tube, mix, rivets, rune_strokes, shard, slab,
    snowcap,
)
from hckit import export_kit  # noqa: E402
import gravewyrm_sculpt as gs  # noqa: E402
from gravewyrm_sculpt import rot  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


# ================================================================ the glacier
def _drift(p, x0, x1, crest_y, h, width, lean):
    """A wind-carved drift along X: a long gentle windward slope (-Y), a
    sharp crest and a steep lee face with an overhanging lip (+Y)."""
    rings = []
    for k in range(9):
        t = k / 8
        x = x0 + (x1 - x0) * t
        hh = h * math.sin(PI * t) ** 0.7 + 0.05
        w = width * (0.35 + 0.65 * math.sin(PI * t) ** 0.5)
        cy = crest_y + lean * math.sin(PI * t * 1.3)
        prof = [(cy - w, 0.0), (cy - w * 0.55, hh * 0.5), (cy - w * 0.15, hh * 0.92), (cy, hh),
                (cy + w * 0.1, hh * 0.95), (cy + w * 0.06, hh * 0.55), (cy + w * 0.16, 0.0)]
        rings.append([(x, y, z) for (y, z) in prof])
    from gwkit import _ring_faces
    with p.as_kind(SNOW):
        return p.smooth(_ring_faces(p, rings, RIME, STONE, True))


def snow_drift(variant):
    """Wind-carved snow: A one long drift (10 yd) with a sharp lee cornice;
    B three smaller drifts in echelon. Knee to waist high."""
    p = P('SnowDrift' + variant, frost=0.0, seed=ord(variant))
    if variant == 'A':
        _drift(p, -5.5, 5.5, 0.4, 1.6, 2.4, 0.4)
    else:
        for k, (dx, dy, L, h) in enumerate(((-3.0, -1.6, 5.0, 0.9), (0.6, 0.4, 6.0, 1.2), (3.4, 2.4, 4.0, 0.7))):
            _drift(p, dx - L / 2, dx + L / 2, dy, h, 1.4, 0.3 * (k - 1))
    return p


def sastrugi():
    """Low wind ridges for the floors (an 8 x 8 patch, under 0.4 tall):
    sharp-prowed ridges all aligned with the wind, some scoured to blue ice."""
    p = P('Sastrugi', frost=0.0, seed=21)
    for k in range(16):
        x = p.rng.uniform(-3.6, 3.6)
        y = p.rng.uniform(-3.6, 3.6)
        L = p.rng.uniform(1.2, 2.8)
        h = p.rng.uniform(0.12, 0.38)
        w = p.rng.uniform(0.25, 0.5)
        pts = [(x - L / 2, y, 0.0), (x - L / 2 + 0.2, y - w / 2, 0.0), (x - L / 2 + 0.2, y + w / 2, 0.0),
               (x + L / 2, y + w * 0.1, 0.0), (x + L * 0.3, y, h), (x - L * 0.1, y - w * 0.15, h * 0.7),
               (x + L * 0.45, y + 0.05, h * 0.6), (x + L / 2 + 0.15, y, h * 0.4)]
        with p.as_kind(SNOW):
            hull(p, pts, p.vary(RIME, 0.02))
    with p.as_kind(ICE):
        for k in range(3):
            p.prism((p.rng.uniform(-3, 3), p.rng.uniform(-3, 3), 0.0), 9, p.rng.uniform(0.5, 0.9),
                    p.rng.uniform(0.5, 0.9), 0.02, ICE_PALE, squash=0.6)
    return p


# ================================================================== the rock
def haul_road_kerb():
    """A 8 yd module of the cult's haul road (along X): two runner ruts worn
    dark in the packed snow, frozen slush in them, kerb stones along both
    edges (y +-3.6), soot dropped from the braziers."""
    p = P('HaulRoadKerb', frost=0.5, seed=37)
    with p.as_kind(PAINT):
        for y in (-1.1, 1.1):
            p.box((0, y, 0.025), (8.1, 0.75, 0.05), (0.52, 0.58, 0.64))
            p.box((0, y, 0.05), (8.1, 0.32, 0.02), (0.34, 0.43, 0.52))
        for k in range(5):
            p.box((p.rng.uniform(-3.5, 3.5), p.rng.uniform(-0.5, 0.5), 0.03), (p.rng.uniform(0.3, 0.8), 0.4, 0.02),
                  SOOT, yaw=p.rng.uniform(0, TAU))
    for s in (-1, 1):
        x = -3.7
        while x < 3.8:
            w = p.rng.uniform(0.7, 1.3)
            slab(p, (x + w / 2, s * 3.6, 0.22), (w, 0.8, 0.6), p.vary([SLATE, SLATE_DARK, SLATE_RUST][int(x * 7) % 3],
                                                                         0.06),
                 yaw=p.rng.uniform(-0.15, 0.15), chamfer=0.3)
            x += w + p.rng.uniform(0.05, 0.4)
        with p.as_kind(SNOW):
            p.smooth(crystal(p, (0, s * 4.4, 0.05), (8.2, 1.4, 0.5), RIME, n=12, boxy=0.9, floor=0.0))
    return p


# =================================================================== the Smith
SEAL_TOOLS = ('Hammer', 'Tongs', 'Anvil', 'Bellows')


def seal_pillar(tool, cracked):
    """A seal pillar of the Lock Terrace (12 yd, footprint 5.4): black stone
    in stepped plinth, a tapering shaft banded in the Smith's iron, a flared
    capital and an iron eye with a great ring on top (the chain's anchor);
    the pillar's tool cut as a blue rune on its front (-Y) and back, a band
    of small runes under the capital. Cracked: the rune broken and guttering,
    fissures through the stone, a corner of the capital fallen at its foot,
    the ring hanging askew."""
    name = ('SealPillarCracked_' if cracked else 'SealPillar_') + tool
    p = P(name, frost=0.55, seed=SEAL_TOOLS.index(tool) * 11 + (5 if cracked else 0), weather=0.7)
    S = SEAL_STONE
    p.box((0, 0, 0.4), (5.4, 5.4, 0.8), p.vary(SEAL_EDGE, 0.04), bevel=0.12)
    p.box((0, 0, 1.05), (4.4, 4.4, 0.55), p.vary(S, 0.04), bevel=0.1)
    loft_z(p, [(1.3, 0, 0, 1.68, 1.68, 5.0), (6.0, 0, 0, 1.6, 1.6, 5.0), (10.2, 0, 0, 1.44, 1.44, 5.0)], 16, S)
    p.box((0, 0, 10.6), (3.6, 3.6, 0.8), p.vary(S, 0.04), bevel=0.12, taper=1.12)
    if cracked:
        p.box((-0.5, 0.3, 11.3), (3.0, 3.6, 0.6), p.vary(SEAL_EDGE, 0.04), bevel=0.1, yaw=0.05, roll=0.06)
        slab(p, (2.6, -2.4, 0.5), (1.6, 1.4, 0.9), SEAL_EDGE, yaw=0.6, roll=0.4)
        for k in range(6):
            slab(p, (p.rng.uniform(-3, 3), p.rng.uniform(-3.2, -1.8), 0.15), (0.6, 0.5, 0.35), S,
                 yaw=p.rng.uniform(0, TAU))
    else:
        p.box((0, 0, 11.3), (4.0, 4.0, 0.6), p.vary(SEAL_EDGE, 0.04), bevel=0.1)
    # Iron bands and the eye.
    with p.as_kind(IRON):
        for z in (2.4, 9.5):
            loft_z(p, [(z - 0.25, 0, 0, 1.76, 1.76, 5.0), (z + 0.25, 0, 0, 1.74, 1.74, 5.0)], 16, IRON_DARK)
            rivets(p, [(math.cos(a) * 1.78, math.sin(a) * 1.78, z) for a in (0.0, PI / 2, PI, 3 * PI / 2,
                                                                             PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4)],
                   0.12)
        p.box((0, 0, 11.9), (1.4, 0.9, 0.6), IRON_DARK, bevel=0.08)
    ring_tilt = 0.5 if cracked else 0.0
    with p.as_kind(IRON):
        c = Vector((0, 0, 13.4))
        ring = [c + Vector((math.cos(a) * 1.35, math.sin(ring_tilt) * math.cos(a) * 0.6, math.sin(a) * 1.35))
                for a in [TAU * i / 20 for i in range(20)]]
        loop_tube(p, ring, 0.28, CHAIN, sides=8)
    # The tool's rune, front and back, and the band of small runes.
    glyph = tool.lower()
    unit, width = 0.5, 0.22
    broken = {1, 3} if cracked else None
    glow = RUNE_DIM if cracked else RUNE
    for out in (-1, 1):
        rune_strokes(p, glyph, (-1.0 if out < 0 else 1.0, 4.4), unit, width, out * 1.62, glow=glow, broken=broken,
                     out=out)
    for out in (-1, 1):
        for k in range(7):
            x = -1.05 + k * 0.35
            with p.as_kind(PAINT):
                p.box((x, out * 1.5, 9.0), (0.12, 0.06, 0.34), RUNE_DEAD if (cracked and k % 2) else RUNE_DIM,
                      mat=GLOW)
    if cracked:
        # Fissures down the shaft: dark splits with fresh pale lips.
        for (x0, z0, x1, z1) in ((-0.4, 10.2, 0.6, 6.4), (0.6, 6.4, -0.2, 2.2), (0.9, 8.2, 1.4, 7.0)):
            ang = math.atan2(z1 - z0, x1 - x0)
            L = math.hypot(x1 - x0, z1 - z0)
            for out in (-1, 1):
                p.box(((x0 + x1) / 2, out * 1.66, (z0 + z1) / 2), (L, 0.06, 0.16), DARK, roll=-ang)
                p.box(((x0 + x1) / 2 + 0.1, out * 1.65, (z0 + z1) / 2), (L, 0.05, 0.3), SEAL_EDGE, roll=-ang)
    snowcap(p, (0, 0, 11.75 if not cracked else 11.7), (3.4, 3.4, 0.5))
    snowcap(p, (0, 0, 1.4), (4.6, 4.6, 0.25))
    icicles(p, [(p.rng.uniform(-1.6, 1.6), -2.0, 10.25) for _ in range(5)] +
            [(p.rng.uniform(-1.6, 1.6), 2.0, 10.25) for _ in range(4)], 1.4, 0.1)
    return p


def seal_shackle():
    """The Seal Shackle at a pillar's foot (3.6 x 3, 2.2 tall; attackable in
    the fight): a great iron cuff hinged round the end of Korgath's chain,
    pinned by a rune-bolt to an anchor plate let into the rock, the Smith's
    blue in its band (the runtime flickers it to red as it takes damage)."""
    p = P('SealShackle', frost=0.45, seed=41)
    p.box((0, 0.6, 0.18), (3.4, 2.6, 0.36), SEAL_STONE, bevel=0.08)
    with p.as_kind(IRON):
        p.box((0, 0.9, 0.5), (2.6, 1.2, 0.35), IRON_DARK, bevel=0.06)
        rivets(p, [(x, y, 0.7) for x in (-1.1, 1.1) for y in (0.5, 1.3)], 0.13)
        p.box((0, 0.9, 1.1), (0.8, 0.9, 0.9), CHAIN, bevel=0.08)
        c = Vector((0, -0.4, 1.15))
        loop_tube(p, [c + Vector((math.cos(a) * 1.05, math.sin(a) * 0.15, math.sin(a) * 0.95))
                      for a in [TAU * i / 18 for i in range(18)]], 0.36, CHAIN, sides=8, squash=0.75)
        p.box((0, 0.35, 1.15), (0.5, 0.6, 0.5), IRON_DARK, bevel=0.05)
        p.prism((0, 0.95, 1.15), 8, 0.22, 0.22, 0.6, IRON_DARK, axis=(0, 1, 0))
    # The rune band round the cuff.
    with p.as_kind(PAINT):
        for k in range(8):
            a = PI * 0.15 + k * PI * 0.1
            p.box((math.cos(a) * 1.06, -0.4 - math.sin(a) * 0.18 - 0.2, 1.15 + math.sin(a) * 0.96),
                  (0.18, 0.06, 0.12), RUNE, mat=GLOW, roll=-a + PI / 2)
    chain_link(p, (0, -1.4, 2.2), (0, -0.4, 1), (1, 0, 0), 0.4, 0.7, 0.24)
    snowcap(p, (0, 0.6, 0.38), (3.0, 2.2, 0.15))
    return p


def smiths_hammer():
    """HERO: the Smith's own hammer, left on the terrace where he set it down
    (13 yd): a head as big as a cart lying on its side, octagonal striking
    faces, a forged collar banded in runes gone cold, the haft running out
    along -Y to a ringed pommel, a leather grip, rimed over, snow drifted
    against the head, icicles from the haft."""
    p = P('SmithsHammer', frost=0.85, seed=43, ao_dist=1.6)
    hz = 1.5
    gn.smiths_hammer_sculpt(bpy, p, hz)
    # The runes of the collar, gone cold (a faint blue).
    for s_ in (-1, 1):
        for k in range(5):
            with p.as_kind(PAINT):
                p.box((-0.48 + k * 0.24, s_ * 1.58, hz), (0.1, 0.05, 0.62), RUNE_DEAD, mat=GLOW)
    icicles(p, [(0, -3 - k * 1.7, 1.5 - k * 0.16 - 0.5) for k in range(5)] +
            [(x, -1.25, 0.25) for x in (-1.8, -0.9, 0.9, 1.8)], 0.8, 0.08)
    return p


def rune_wall():
    """HERO: the Anchor Ledge's rune wall (22 wide, 15 tall): a rock face of
    cleaved slate round a dressed panel cut with the Smith's three acts in
    runes the height of a man, one to a line from the top: heat (a flame
    over the hearth), the hammer (his tool rune, as on the seal pillars),
    quench (the work plunged into water). Each great rune stands in a
    cartouche, the three cartouches linked point to point, and a band of
    small runes runs out to either side between carved rules (the bellows
    with the heat, the anvil and the tongs with the hammer, the tongs with
    the quench).
    Pictures, never letters: no language is cut into the stone (the meaning
    reaches the player as a localized lore line). Each rune is a chiselled
    channel with his blue light in it; a frame of small ticks, snow on the
    ledges, icicles off the lintel."""
    p = P('RuneWall', frost=0.6, seed=45, ao_dist=3.0)
    blocks = [('rockd', (0, 3.6, 8), (25, 5.5, 17), None, 0.3, 0)]
    for k in range(6):
        for s_ in (-1, 1):
            x = s_ * (10.2 + k * 0.5)
            h = 17.5 - k * 1.6
            blocks.append((['rock', 'rockd', 'rustr'][k % 3], (x, 0.4 + k * 0.4, h / 2), (2.2, 3.4, h),
                           rot(ry=s_ * 0.05, rz=s_ * 0.1), 0.2, 5))
    for k in range(8):
        x = -8.4 + k * 2.4
        blocks.append((['rock', 'rockd'][k % 2], (x, 0.6, 14.6), (2.6, 3.2, 2.4), rot(ry=0.08 * (k % 3 - 1)), 0.2, 5))
        blocks.append(('rock', (x, 0.4, 0.3), (2.6, 3.0, 1.4), None, 0.2, 5))
    gn.slate_mass(bpy, p, 'RuneWallRock', 45, ((-14, -2, -1), (14, 7.5, 18)), 0.16, blocks, target=5000,
                  snow=[((0, 1.5, 16.2), (9, 2.4, 0.6), None)] + [((s_ * 10.6, 0.5, 17.5 - 1.0), (1.2, 1.4, 0.4), None)
                                                                   for s_ in (-1, 1)])
    # The dressed panel and its frame.
    p.box((0, -0.6, 7.0), (18.6, 1.0, 11.6), (0.24, 0.255, 0.28), bevel=0.06)
    p.box((0, -1.05, 12.95), (19.2, 0.6, 0.5), SEAL_EDGE, bevel=0.06)
    p.box((0, -1.05, 1.05), (19.2, 0.6, 0.5), SEAL_EDGE, bevel=0.06)
    # The three acts, top to bottom: (great rune, its band's two small runes,
    # the line's centre height). Great runes 0.38 a grid step (2.3 tall), the
    # band's 0.19; the cartouches (8 by 8.2 steps) all but meet point to point.
    unit, width, small, small_w = 0.38, 0.26, 0.19, 0.11
    for great, band, zc in (('heat', ('heat', 'bellows'), 10.15), ('hammer', ('anvil', 'tongs'), 6.7),
                            ('quench', ('tongs', 'quench'), 3.25)):
        origin = (-2 * unit, zc - 3 * unit)
        rune_strokes(p, great, origin, unit, width, -1.1, glow=RUNE)
        rune_strokes(p, 'cartouche', origin, unit, 0.16, -1.1, glow=RUNE_DIM)
        for s_ in (-1, 1):
            # The band's two carved rules, then four small runes alternating
            # outward from the cartouche.
            for dz in (-0.82, 0.82):
                p.box((s_ * 5.4, -1.13, zc + dz), (6.4, 0.1, 0.2), SLATE_DEEP)
                with p.as_kind(PAINT):
                    p.box((s_ * 5.4, -1.175, zc + dz), (6.4, 0.06, 0.08), RUNE_DIM, mat=GLOW)
            for k in range(4):
                cx = s_ * (3.15 + k * 1.5)
                rune_strokes(p, band[k % 2], (cx - 2 * small, zc - 3 * small), small, small_w, -1.1,
                             glow=RUNE_DIM)
    for k in range(30):
        x = -9.0 + k * 0.62
        for z in (12.6, 1.4):
            with p.as_kind(PAINT):
                p.box((x, -1.38, z), (0.1, 0.05, 0.22 if k % 3 else 0.32), RUNE_DIM, mat=GLOW)
    snowcap(p, (0, 0.5, 15.3), (21, 5, 0.9))
    snowcap(p, (0, -1.2, 13.25), (19, 0.9, 0.3))
    for x in (-10.5, 10.5):
        snowcap(p, (x, 0, 0.9), (3, 4, 1.2))
    icicles(p, [(p.rng.uniform(-9, 9), -1.4, 12.7) for _ in range(14)], 1.0, 0.09)
    return p


def chain_anchor():
    """HERO: one of the Smith's chain anchors on the Anchor Ledge (a block the
    size of a house: 10 x 8, 7 tall): black seal stone banded and strapped
    in his iron, set into the ledge with slate heaped round it; on its front
    a forged staple holds a great ring, and the first mast-thick links run
    out from it toward the gulf (-Y), rising. Runes along its brow."""
    p = P('ChainAnchor', frost=0.6, seed=47)
    p.box((0, 0, 3.5), (10, 8, 7), SEAL_STONE, bevel=0.3, taper=0.9)
    p.box((0, 0, 7.25), (8.6, 6.8, 0.6), SEAL_EDGE, bevel=0.15)
    with p.as_kind(IRON):
        for x in (-3.2, 0.0, 3.2):
            p.box((x, 0, 3.6), (0.8, 8.3, 7.4), IRON_DARK, bevel=0.05)
            rivets(p, [(x, -4.2, z) for z in (1.0, 2.6, 4.2, 5.8)] + [(x, 4.2, z) for z in (1.0, 2.6, 4.2, 5.8)],
                   0.16)
        p.box((0, -4.3, 3.3), (4.6, 0.8, 3.4), IRON_DARK, bevel=0.1)
        for x in (-1.3, 1.3):
            p.prism((x, -4.6, 3.3), 10, 0.55, 0.55, 2.2, CHAIN, axis=(0, -1, 0))
        loop_tube(p, [Vector((math.cos(a) * 2.3, -6.4, 3.3 + math.sin(a) * 2.3)) for a in
                      [TAU * i / 22 for i in range(22)]], 0.62, CHAIN, sides=10)
    q = Vector((0, -6.4, 3.3 - 2.3))
    u = Vector((0, -1, 0.32)).normalized()
    for i in range(3):
        c = q + u * (3.9 + i * 6.2)
        v = Vector((1, 0, 0)) if i % 2 == 0 else u.cross(Vector((1, 0, 0))).normalized()
        chain_link(p, c, u, v, 1.6, 1.8, 0.62, sides=10)
    for k in range(12):
        with p.as_kind(PAINT):
            p.box((-3.9 + k * 0.7, -4.05, 6.55), (0.16, 0.05, 0.42), RUNE_DIM, mat=GLOW)
    for k in range(16):
        a = TAU * k / 16
        s = p.rng.uniform(1.2, 2.6)
        slab(p, (math.cos(a) * 5.6, math.sin(a) * 4.8, s * 0.3), (s * 1.4, s, s * 0.9), p.vary(SLATE, 0.08),
             yaw=a + p.rng.uniform(-0.4, 0.4), roll=p.rng.uniform(-0.3, 0.3))
    snowcap(p, (0, 0.3, 7.7), (8.6, 7.2, 0.9))
    icicles(p, [(p.rng.uniform(-4.4, 4.4), -4.1, 6.9) for _ in range(9)], 1.6, 0.12)
    return p


LINK_HALF, LINK_RING, LINK_BAR = 1.875, 2.25, 0.75


def chain_link_tile():
    """One mast-thick link of the Smith's chain (9.25 long along X, 6 wide,
    the bar 1.5 thick), in the XZ plane, origin at its middle: instanced
    along a run, alternate links turned a quarter. Rime along its top."""
    p = P('ChainLink', frost=0.7, seed=49)
    chain_link(p, (0, 0, 0), (1, 0, 0), (0, 0, 1), LINK_HALF, LINK_RING, LINK_BAR, sides=8, segs=6)
    with p.as_kind(SNOW):
        for x in (-1.6, 0.4, 2.2):
            p.smooth(crystal(p, (x, 0, LINK_RING + 0.55), (1.4, 1.0, 0.4), RIME, n=8, boxy=0.9))
    return p


def chain_heap():
    """A fallen chain heaped where it dropped (14 x 12, 4 tall): nine
    mast-thick links in a tangle, rimed, snow drifted into it."""
    p = P('ChainHeap', frost=0.75, seed=51)
    spots = [(-4.0, -2.0, 0.8, 0.2, 0.1), (0.5, -3.0, 0.9, 1.4, 1.5), (4.5, -1.0, 0.8, 0.5, 0.0),
             (-2.0, 2.0, 1.4, 2.4, 0.6), (2.6, 2.6, 0.9, 0.9, 1.4), (-5.4, 2.8, 0.8, 1.9, 0.2),
             (0.0, 0.0, 2.6, 0.3, 0.9), (5.4, 3.6, 0.8, 2.6, 0.3), (-1.2, 5.0, 0.8, 1.2, 0.1)]
    for (x, y, z, yaw, tilt) in spots:
        u = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        v = side * math.cos(tilt) + Vector((0, 0, 1)) * math.sin(tilt)
        chain_link(p, (x, y, z + LINK_RING * math.sin(tilt) * 0.5), u, v, LINK_HALF, LINK_RING, LINK_BAR, sides=8,
                   segs=5)
    with p.as_kind(SNOW):
        p.smooth(crystal(p, (0, 0, 0.1), (15, 12, 1.4), RIME, n=16, boxy=0.9, floor=0.0))
        for k in range(5):
            p.smooth(crystal(p, (p.rng.uniform(-5, 5), p.rng.uniform(-4, 4), 1.2), (3, 2.2, 0.8), RIME, n=10,
                             boxy=0.9))
    return p


def chain_broken():
    """A hanging broken end of the Smith's chain (origin at the hang point,
    hanging 24 yd down -Z): links alternating, frost and icicles on them,
    the last link snapped open with its ends torn."""
    p = P('ChainBroken', frost=0.6, seed=53)
    pitch = 2 * (LINK_HALF + LINK_RING - LINK_BAR)
    for i in range(3):
        c = (0, 0, -(i + 0.5) * pitch - LINK_BAR)
        v = (1, 0, 0) if i % 2 == 0 else (0, 1, 0)
        chain_link(p, c, (0, 0, 1), v, LINK_HALF, LINK_RING, LINK_BAR, sides=8)
    # The snapped link: a C of iron, its ends torn and splayed.
    c = Vector((0, 0, -3.5 * pitch - LINK_BAR))
    pts = link_loop(c, (0, 0, 1), (0, 1, 0), LINK_HALF, LINK_RING, 6)
    keep = pts[2:-3]
    with p.as_kind(IRON):
        p.smooth(p.sweep(keep, LINK_BAR, LINK_BAR * 0.8, CHAIN, sides=8))
        for end, d in ((keep[0], Vector((0, -0.3, 0.6))), (keep[-1], Vector((0, 0.4, 0.5)))):
            p.spike(end, LINK_BAR * 0.8, 0.9, IRON_DARK, sides=6, lean=(d.y, d.z))
    icicles(p, [(p.rng.uniform(-0.4, 0.4), p.rng.uniform(-0.4, 0.4), -(i + 1) * pitch + 0.2) for i in range(4)
                for _ in range(2)], 1.8, 0.14)
    return p


def chain_bridge():
    """The Chain Bridge (a 12.5 yd module along X, 6 wide; tiles to span the
    gulf): the Smith's slack chain fallen across and pulled taut, frozen into
    a walkway. The walking deck lies at the origin (z 0, flat): a crust of
    packed rime and ice filling the flat links' eyes, the standing links'
    worn tops flush with it as iron strips; under it the chain hangs in
    rime and icicles."""
    p = P('ChainBridge', frost=0.6, seed=55)
    pitch = 6.25
    zc = -LINK_RING - LINK_BAR
    # The flat link (in XY) and the standing link (in XZ) of this module.
    chain_link(p, (-pitch / 2, 0, zc), (1, 0, 0), (0, 1, 0), LINK_HALF, LINK_RING, LINK_BAR, sides=8, segs=6)
    chain_link(p, (pitch / 2, 0, zc + 0.02), (1, 0, 0), (0, 0, 1), LINK_HALF, LINK_RING, LINK_BAR, sides=8, segs=6)
    gn.chain_bridge_crust(bpy, p, pitch, LINK_HALF + LINK_RING + LINK_BAR)
    icicles(p, [(p.rng.uniform(-6, 6), p.rng.uniform(-2.4, 2.4), zc - LINK_RING - 0.2) for _ in range(10)], 2.6,
            0.18)
    return p


def keystone_socket():
    """The inner face of the sealed gate, on the Keystone Court (22 wide, 19
    tall; opening 10 wide, 13 tall): massive jambs and a stepped lintel of
    seal stone in slate rock, and at the apex the empty socket where the
    keystone sat, its rim cracked, the rune bands round it dead and broken."""
    p = P('KeystoneSocket', frost=0.6, seed=57, ao_dist=3.0)
    blocks = [('rockd', (0, 3.4, 10), (26, 4, 21), None, 0.3, 0)]
    for s in (-1, 1):
        for k in range(4):
            h = 21 - k * 2.4
            blocks.append((['rock', 'rockd', 'rustr', 'rock'][k], (s * (9.8 + k * 1.1), 1.0, h / 2), (2.4, 4.0, h),
                           rot(ry=s * 0.04, rz=s * 0.12), 0.2, 5))
    for k in range(5):
        blocks.append((['rock', 'rockd'][k % 2], (-6 + k * 3, 1.0, 20.4), (3.2, 4.0, 2.6), rot(ry=0.06 * (k - 2)), 0.25, 5))
    opening = gs.RoundBox((0, 0, 6.5), (5.1, 6.0, 6.6), 0.2)
    vault = gs.Ellipsoid((0, 0, 13), (5.1, 6.0, 4.0))
    gn.slate_mass(bpy, p, 'KeystoneRock', 57, ((-15, -2.5, -1), (15, 6, 23)), 0.18, blocks, subs=(opening, vault),
                  target=4500, snow=[((0, 1.5, 21.8), (7.5, 2.0, 0.5), None)])
    for s in (-1, 1):
        p.box((s * 6.6, 0.4, 7.0), (3.2, 3.6, 14), SEAL_STONE, bevel=0.15)
        p.box((s * 6.6, 0.3, 0.5), (4.0, 4.4, 1.0), SEAL_EDGE, bevel=0.12)
    for k in range(9):
        a = PI * (k + 0.5) / 9
        p.box((math.cos(a) * 6.4, 0.2, 13 + math.sin(a) * 4.4), (2.6, 3.4, 1.8), p.vary(SEAL_STONE, 0.05),
              roll=-(a - PI / 2), bevel=0.1)
    p.box((0, 0.4, 18.4), (16, 3.6, 1.6), SEAL_EDGE, bevel=0.12)
    # The socket: an empty wedge, dark, its rim split.
    p.box((0, -0.6, 17.0), (2.6, 1.2, 2.6), DARK, taper=0.7)
    p.box((0, -1.25, 17.0), (3.4, 0.2, 3.4), SEAL_EDGE, taper=0.75)
    for (x0, z0, x1, z1) in ((0.0, 15.6, -1.4, 12.6), (1.2, 16.4, 3.6, 14.2), (-1.0, 18.0, -3.0, 19.2),
                             (0.4, 15.6, 0.8, 13.0)):
        ang = math.atan2(z1 - z0, x1 - x0)
        p.box(((x0 + x1) / 2, -1.45, (z0 + z1) / 2), (math.hypot(x1 - x0, z1 - z0), 0.05, 0.16), DARK, roll=-ang)
    for s in (-1, 1):
        for k in range(8):
            with p.as_kind(PAINT):
                p.box((s * 6.6, -1.42, 2.6 + k * 1.3), (0.5, 0.05, 0.14), RUNE_DEAD if k % 3 else RUNE_DIM,
                      mat=GLOW)
    snowcap(p, (0, 0.4, 19.4), (16, 3.6, 0.6))
    for s in (-1, 1):
        snowcap(p, (s * 6.6, 0.4, 14.2), (3.2, 3.6, 0.4))
    icicles(p, [(p.rng.uniform(-5, 5), -1.3, 12.6 + p.rng.uniform(0, 1.2)) for _ in range(10)], 1.4, 0.1)
    return p


def gate_tunnel():
    """The rock-cut tunnel mouth the group steps out of onto the Gate Landing
    (30 wide, 24 tall, 22 deep; the opening 12 wide, 11 tall, clear): a
    dressed portal of seal stone with a rune lintel in a mass of slate, the
    tunnel's walls and vault running back into the dark, icicles off the
    lintel, snow on every ledge and drifted at the mouth. Origin on the
    threshold's centre; the landing lies toward -Y."""
    p = P('GateTunnel', frost=0.6, seed=59, ao_dist=5.0)
    W, Hh, D = 6.0, 11.0, 22.0
    # The rock mass round it: cleaved slate, the tunnel carved through.
    blocks = [('rockd', (0, 12, 12), (32, 22, 26), None, 0.4, 0)]
    rng = __import__('random').Random(59)
    x = -16.0
    k = 0
    while x < 16.5:
        w = rng.uniform(2.2, 3.4)
        h = 26 - abs(x) * 0.5 + rng.uniform(-2, 2)
        blocks.append((['rock', 'rockd', 'rustr', 'rock'][k % 4], (x, rng.uniform(0.6, 2.4), h / 2), (w, 5, h),
                       rot(ry=rng.uniform(-0.06, 0.06), rz=rng.uniform(-0.12, 0.12)), 0.25, 5))
        x += w * 0.85
        k += 1
    for k in range(5):
        blocks.append(('rockl', (rng.uniform(-13, 13), -0.6, rng.uniform(14, 22)), (rng.uniform(2.5, 4), 2.2, 0.9),
                       rot(rz=rng.uniform(-0.2, 0.2)), 0.2, 5))
    bore = gs.RoundBox((0, D / 2 + 1, Hh * 0.33 - 0.05), (W, D / 2 + 4, Hh * 0.33 + 0.05), 0.15)
    vault = gs.RoundCone((0, -3.5, Hh / 2), (0, D + 4, Hh / 2), Hh / 2, Hh / 2)
    seat = gs.RoundBox((0, -1.0, Hh / 2 + 0.6), (W + 1.7, 1.6, Hh / 2 + 1.8), 0.1)
    gn.slate_mass(bpy, p, 'TunnelRock', 59, ((-18, -3.5, -1.2), (18, 24, 28)), 0.25, blocks,
                  subs=(bore, vault, seat), target=6500,
                  snow=[((rng.uniform(-12, 12), 1.0, 25.5), (4.0, 3.0, 0.7), None) for _ in range(4)])
    # The portal.
    for s in (-1, 1):
        p.box((s * (W + 0.8), -0.6, Hh / 2), (1.8, 1.4, Hh), SEAL_STONE, bevel=0.1)
    p.box((0, -0.7, Hh + 0.9), (W * 2 + 3.8, 1.6, 1.8), SEAL_EDGE, bevel=0.12)
    for k in range(13):
        with p.as_kind(PAINT):
            p.box((-W + 0.3 + k * 0.95, -1.52, Hh + 0.9), (0.16, 0.05, 0.6), RUNE_DIM if k % 2 else RUNE, mat=GLOW)
    end = p.box((0, D + 0.2, Hh / 2), (W * 2.2, 0.2, Hh * 1.1), DARK)
    for k in range(5):
        y = k * 4.5 + 2
        for s in (-1, 1):
            with p.as_kind(IRON):
                p.box((s * (W - 0.2), y, Hh * 0.7), (0.3, 0.3, 0.3), IRON_DARK)
    snowcap(p, (0, 1.0, Hh + 2.0), (W * 2 + 4, 3, 0.6))
    for x in (-12, -9, 9, 12):
        snowcap(p, (x, -0.8, 0.5), (3.4, 3, 1.2))
    with p.as_kind(SNOW):
        for s in (-1, 1):
            p.smooth(crystal(p, (s * (W - 0.8), -1.8, 0.1), (2.6, 3.2, 1.0), RIME, n=10, boxy=0.9, floor=0.0))
    icicles(p, [(p.rng.uniform(-W, W), -1.5, Hh) for _ in range(12)], 1.8, 0.12)
    return p


def vigil_cairn():
    """A vigil cairn (2.4 yd): flat slate stones stacked by climbers, an old
    ice axe driven in beside it, a tattered pennant on a pole, rime over all."""
    p = P('VigilCairn', frost=0.6, seed=61)
    z = 0.0
    for k in range(7):
        s = 1.5 - k * 0.17
        th = 0.32 - k * 0.015
        slab(p, (p.rng.uniform(-0.08, 0.08), p.rng.uniform(-0.08, 0.08), z + th / 2), (s, s * 0.85, th),
             p.vary([SLATE, SLATE_DARK, SLATE_LIGHT][k % 3], 0.06), yaw=p.rng.uniform(0, TAU), chamfer=0.25)
        z += th
    slab(p, (0, 0, z + 0.2), (0.3, 0.22, 0.4), SLATE_LIGHT)
    with p.as_kind(PAINT):
        p.prism((0.75, 0.2, 0.0), 6, 0.035, 0.03, 2.4, TIMBER)
        from gwkit import CLOTH_HELD
        p.box((0.75, 0.48, 2.15), (0.03, 0.55, 0.32), CLOTH_HELD, pitch=0.05)
        p.box((0.75, 0.76, 2.08), (0.03, 0.18, 0.2), CLOTH_HELD, pitch=0.2)
        p.prism((-0.7, -0.3, 0.0), 6, 0.03, 0.03, 0.9, TIMBER, lean=(0.08, 0.0))
    with p.as_kind(IRON):
        p.box((-0.63, -0.3, 0.92), (0.45, 0.06, 0.08), IRON_DARK)
    snowcap(p, (0, 0, z + 0.05), (0.7, 0.6, 0.12))
    return p


# ================================================================== the cult
def _fur_panel(p, a, b, c, d, color, th=0.12):
    """A hide panel between four corners, thickened."""
    n = (Vector(b) - Vector(a)).cross(Vector(d) - Vector(a)).normalized()
    pts = [Vector(q) for q in (a, b, c, d)]
    with p.as_kind(PAINT):
        return hull(p, pts + [q + n * th for q in pts], color)


def cult_tent():
    """A Broodsworn tent (5 x 4, 4 tall): an A-frame of bone-lashed poles
    under overlapping furs and stitched hides, the front flaps tied back on a
    dark inside, a smoke-blackened ridge, fur rolls weighting the skirt, guy
    ropes to stakes, snow banked on the windward side."""
    p = P('CultTent', frost=0.5, seed=63, ao_dist=1.5)
    gn.cult_tent_sculpt(bpy, p)
    with p.as_kind(PAINT):
        for y in (-2.2, 0.0, 2.2):
            for s in (-1, 1):
                p.prism((s * 2.3, y, 0.0), 6, 0.08, 0.07, 4.5, TIMBER_DARK, lean=(-s * 0.55, 0.0))
        p.prism((0, -2.9, 4.0), 6, 0.08, 0.08, 5.8, TIMBER_DARK, axis=(0, 1, 0))
        for (x, y) in ((-3.4, -2.8), (3.4, -2.8), (-3.4, 2.8), (3.4, 2.8)):
            p.sweep([(x * 0.62, y * 0.82, 3.0), (x, y, 0.05)], 0.025, 0.025, ROPE, sides=4)
            p.prism((x, y, 0.0), 4, 0.06, 0.04, 0.5, TIMBER_DARK)
        hull(p, [(-0.9, -2.3, 0.0), (0.9, -2.3, 0.0), (0, -2.3, 2.5), (-0.9, -2.1, 0.0), (0.9, -2.1, 0.0),
                 (0, -2.1, 2.5)], SOOT)
        p.box((0, -2.75, 3.6), (0.5, 0.05, 0.7), CULT_CLOTH)
        p.box((0, -2.77, 3.45), (0.3, 0.04, 0.12), CULT_RED)
    with p.as_kind(SNOW):
        p.smooth(crystal(p, (-2.9, 0.4, 0.2), (1.4, 5.6, 1.0), RIME, n=12, boxy=0.9, floor=0.0))
    return p


def soul_flame(p, base, height, radius, tongues=7):
    """Soulfire: curling tongues of violet-green light over coals, each one
    swept up a bent path and tapering to a point, a pale core inside."""
    bx, by, bz = base
    with p.as_kind(PAINT):
        for k in range(tongues + 3):
            a = TAU * k / (tongues + 3) + p.rng.uniform(-0.3, 0.3)
            r = radius * p.rng.uniform(0.3, 0.85)
            h = height * p.rng.uniform(0.45, 1.0)
            twist = p.rng.uniform(-2.0, 2.0)
            pts = []
            for j in range(7):
                t = j / 6
                ang = a + twist * t
                rr = r * (1 - 0.6 * t) + radius * 0.25 * math.sin(PI * t) * 0.5
                pts.append((bx + math.cos(ang) * rr, by + math.sin(ang) * rr, bz + h * t))
            col = SOUL if k % 3 else mix(SOUL, SOUL_VIOLET, 0.7)
            faces = p.sweep(pts, radius * p.rng.uniform(0.42, 0.6), 0.004, col, sides=5, mat=GLOW)
            p.smooth(faces)
        core = [(bx, by, bz), (bx + radius * 0.25, by, bz + height * 0.35),
                (bx - radius * 0.2, by + radius * 0.15, bz + height * 0.7),
                (bx + radius * 0.1, by - radius * 0.1, bz + height * 0.95)]
        p.smooth(p.sweep(core, radius * 0.28, 0.004, mix(SOUL, (1, 1, 1), 0.35), sides=6, mat=GLOW))


def coals(p, center, radius, color=EMBER_DIM, count=9):
    with p.as_kind(PAINT):
        for k in range(count):
            a = p.rng.uniform(0, TAU)
            r = radius * math.sqrt(p.rng.random()) * 0.85
            crystal(p, (center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, center[2]),
                    (radius * 0.35,) * 3, mix(color, SOUL_VIOLET, 0.35) if k % 3 == 0 else color, n=8, mat=GLOW)


def _brazier(p, c, scale=1.0, flame=1.0):
    x, y, z = c
    s = scale
    with p.as_kind(IRON):
        for k in range(3):
            a = TAU * k / 3 + 0.4
            p.sweep([(x + math.cos(a) * 0.62 * s, y + math.sin(a) * 0.62 * s, z),
                     (x + math.cos(a) * 0.4 * s, y + math.sin(a) * 0.4 * s, z + 0.5 * s),
                     (x + math.cos(a) * 0.45 * s, y + math.sin(a) * 0.45 * s, z + 0.9 * s)], 0.05 * s, 0.045 * s,
                    IRON_DARK, sides=5)
        p.lathe((x, y, z + 0.8 * s), [(0.18 * s, 0.0), (0.55 * s, 0.18 * s), (0.66 * s, 0.42 * s),
                                      (0.62 * s, 0.46 * s), (0.5 * s, 0.25 * s), (0.0, 0.26 * s)], 10, CHAIN)
        for k in range(8):
            a = TAU * k / 8
            p.spike((x + math.cos(a) * 0.64 * s, y + math.sin(a) * 0.64 * s, z + 1.22 * s), 0.05 * s, 0.22 * s,
                    IRON_DARK, sides=4)
    coals(p, (x, y, z + 1.12 * s), 0.5 * s)
    if flame:
        soul_flame(p, (x, y, z + 1.15 * s), 1.1 * s * flame, 0.42 * s)


def soul_brazier():
    """A Soul Brazier (1.6 tall + flame): an iron bowl on bowed tripod legs,
    spiked rim, a bed of coals and soulfire twisting violet-green over it."""
    p = P('SoulBrazier', frost=0.25, seed=65)
    _brazier(p, (0, 0, 0))
    return p


def sledge():
    """The cult's sledge (7.6 long, 3 wide), separable from the Sledge Tusker
    that drags it: two runners curling up at the front (-Y), lashed
    cross-members, a plank deck sooted black, side rails on posts, a
    harness bar with its traces, crates and bundles lashed down, and three
    soul braziers burning on the deck."""
    p = P('Sledge', frost=0.35, seed=67)
    with p.as_kind(PAINT):
        for s in (-1, 1):
            pts = [(s * 1.3, 3.6, 0.12), (s * 1.3, 0.0, 0.12), (s * 1.3, -2.8, 0.14), (s * 1.3, -3.6, 0.5),
                   (s * 1.3, -3.9, 1.1), (s * 1.3, -3.7, 1.5)]
            p.smooth(p.sweep(pts, 0.14, 0.12, TIMBER_DARK, sides=6, squash=0.7))
            for y in (-2.6, -0.6, 1.4, 3.2):
                p.prism((s * 1.3, y, 0.12), 5, 0.08, 0.07, 0.55, TIMBER_DARK)
        for y in (-2.6, -0.6, 1.4, 3.2):
            p.box((0, y, 0.6), (2.9, 0.22, 0.16), TIMBER_DARK)
        for k in range(13):
            y = -2.9 + k * 0.52
            p.box((0, y, 0.74), (2.8, 0.48, 0.1), p.vary(mix(TIMBER, SOOT, 0.45), 0.1))
        for s in (-1, 1):
            p.box((s * 1.42, 0.3, 1.25), (0.1, 6.4, 0.12), TIMBER)
            for y in (-2.6, -0.6, 1.4, 3.2):
                p.prism((s * 1.42, y, 0.7), 5, 0.06, 0.05, 0.62, TIMBER)
        p.box((0, -4.0, 1.1), (3.1, 0.14, 0.14), TIMBER)
        for s in (-1, 1):
            p.sweep([(s * 1.4, -4.0, 1.1), (s * 1.0, -5.6, 0.9), (s * 0.6, -7.2, 1.1)], 0.05, 0.05, LEATHER, sides=4)
        # Cargo at the back.
        p.box((-0.7, 2.6, 1.15), (1.1, 1.1, 0.8), TIMBER, bevel=0.04, yaw=0.1)
        p.box((0.6, 2.9, 1.05), (1.0, 0.9, 0.6), TIMBER_DARK, bevel=0.04, yaw=-0.15)
        p.smooth(p.rock((0.5, 2.0, 1.25), (1.2, 0.9, 0.9), FUR, jitter=0.1, subdivisions=1))
        for x in (-0.7, 0.6):
            p.box((x, 2.75, 1.2), (0.06, 1.2, 0.9), ROPE)
        p.box((0, -3.0, 0.95), (1.6, 0.5, 0.3), CULT_CLOTH)
    with p.as_kind(IRON):
        p.box((0, -3.95, 1.1), (0.8, 0.18, 0.3), IRON_DARK)
    for (x, y) in ((-0.65, -1.9), (0.65, -0.4), (-0.4, 1.1)):
        _brazier(p, (x, y, 0.79), scale=0.72)
    return p


def thaw_pyre():
    """HERO: a great thaw pyre of the Ritual Vault (the pool rim 7 yd round,
    the pyre 8 tall): four leaning iron uprights bound in chain hold a grate
    over a heap of black coals and soulfire roaring violet-green; soul cages
    hang from the uprights; three cult standards stand on the rim, which is a
    broken ring of ice and black stones, knee high at most (the meltwater
    inside it is the runtime's). Collider r 2.6 round the pyre."""
    p = P('ThawPyre', frost=0.3, seed=69)
    for k in range(44):
        a = TAU * k / 44 + p.rng.uniform(-0.04, 0.04)
        r = 7.0 + p.rng.uniform(-0.35, 0.35)
        if k % 4:
            with p.as_kind(ICE):
                crystal(p, (math.cos(a) * r, math.sin(a) * r, 0.16), (p.rng.uniform(1.4, 2.2), 1.1, p.rng.uniform(0.4, 0.6)),
                        p.vary([GLACIER, ICE_PALE, ICE_MID][k % 3], 0.06), n=10, yaw=a + PI / 2, floor=-0.3)
        else:
            slab(p, (math.cos(a) * r, math.sin(a) * r, 0.24), (1.3, 1.0, 0.6), p.vary(SEAL_STONE, 0.08), yaw=a)
    for k in range(8):
        a = TAU * k / 8 + 0.2
        slab(p, (math.cos(a) * 2.0, math.sin(a) * 2.0, 0.5), (1.4, 1.1, 1.1), p.vary(SEAL_STONE, 0.06), yaw=a)
    with p.as_kind(IRON):
        for k in range(4):
            a = TAU * k / 4 + PI / 4
            base = (math.cos(a) * 2.4, math.sin(a) * 2.4, 0.0)
            top = (math.cos(a) * 1.6, math.sin(a) * 1.6, 6.6)
            p.smooth(p.sweep([base, ((base[0] + top[0]) / 2 * 1.06, (base[1] + top[1]) / 2 * 1.06, 3.4), top], 0.2,
                             0.15, IRON_DARK, sides=6))
            p.spike(top, 0.16, 1.1, IRON_DARK, sides=5)
            # A soul cage hanging from each upright.
            hc = (math.cos(a) * 2.6, math.sin(a) * 2.6, 4.2)
            p.sweep([(top[0], top[1], 6.2), (hc[0], hc[1], hc[2] + 0.8)], 0.03, 0.03, CHAIN, sides=4)
            for j in range(5):
                b = TAU * j / 5
                p.sweep([(hc[0] + math.cos(b) * 0.3, hc[1] + math.sin(b) * 0.3, hc[2] - 0.5),
                         (hc[0] + math.cos(b) * 0.38, hc[1] + math.sin(b) * 0.38, hc[2]),
                         (hc[0], hc[1], hc[2] + 0.75)], 0.03, 0.03, IRON_DARK, sides=4)
            with p.as_kind(PAINT):
                crystal(p, hc, (0.4, 0.4, 0.55), mix(SOUL, SOUL_VIOLET, 0.4), n=8, mat=GLOW)
        chain_run(p, (2.1, 0, 2.2), (0, 2.1, 2.2), 0.7, 0.16, 0.06)
        chain_run(p, (0, 2.1, 2.2), (-2.1, 0, 2.2), 0.7, 0.16, 0.06)
        chain_run(p, (-2.1, 0, 2.2), (0, -2.1, 2.2), 0.7, 0.16, 0.06)
        chain_run(p, (0, -2.1, 2.2), (2.1, 0, 2.2), 0.7, 0.16, 0.06)
        p.lathe((0, 0, 1.4), [(0.6, 0.0), (2.1, 0.4), (2.3, 0.9), (2.1, 1.0), (0.0, 0.7)], 14, CHAIN)
    with p.as_kind(ROCK):
        p.smooth(p.rock((0, 0, 2.25), (3.6, 3.6, 1.4), SOOT, jitter=0.2, subdivisions=2))
    coals(p, (0, 0, 2.7), 1.6, count=16)
    soul_flame(p, (0, 0, 2.7), 4.4, 1.5, tongues=11)
    # Three cult standards on the rim.
    for k in range(3):
        a = TAU * k / 3 + 0.5
        x, y = math.cos(a) * 7.6, math.sin(a) * 7.6
        with p.as_kind(PAINT):
            p.prism((x, y, 0.0), 6, 0.08, 0.07, 5.4, TIMBER_DARK)
            p.box((x - math.sin(a) * 0.0, y, 4.4), (0.06, 1.3, 1.8), CULT_CLOTH, yaw=a)
            p.box((x, y, 3.5), (0.05, 1.1, 0.25), CULT_RED, yaw=a)
        with p.as_kind(IRON):
            for s in (-1, 1):
                p.sweep([(x, y, 5.3), (x + math.cos(a + s * 1.2) * 0.4, y + math.sin(a + s * 1.2) * 0.4, 5.7),
                         (x + math.cos(a + s * 1.4) * 0.5, y + math.sin(a + s * 1.4) * 0.5, 6.2)], 0.06, 0.01,
                        IRON_DARK, sides=4)
    return p


def pyre():
    """A small soul pyre of the Thaw Works (2.6 tall): an iron tripod cage over
    stacked black stones, coals and a soulfire."""
    p = P('Pyre', frost=0.3, seed=71)
    for k in range(6):
        a = TAU * k / 6
        slab(p, (math.cos(a) * 0.9, math.sin(a) * 0.9, 0.25), (0.8, 0.6, 0.5), p.vary(SEAL_STONE, 0.06), yaw=a)
    with p.as_kind(IRON):
        for k in range(3):
            a = TAU * k / 3
            p.sweep([(math.cos(a) * 1.0, math.sin(a) * 1.0, 0), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.6),
                     (0, 0, 2.3)], 0.06, 0.05, IRON_DARK, sides=5)
        p.lathe((0, 0, 0.5), [(0.3, 0.0), (0.8, 0.2), (0.85, 0.42), (0.0, 0.32)], 10, CHAIN)
    coals(p, (0, 0, 0.82), 0.6)
    soul_flame(p, (0, 0, 0.82), 1.6, 0.55)
    return p


def melt_channel():
    """A melt channel cut in the glacier (an 8 yd module along X): two cut ice
    banks with tool scars, the ice surface at z 0 on both sides (3 yd), the
    channel 2.4 wide and 1.2 deep with running meltwater (glass) in it,
    slush and broken ice riding the water."""
    p = P('MeltChannel', frost=0.5, seed=73, ao_dist=1.5)
    gn.melt_banks(bpy, p)
    with p.as_kind(PAINT):
        p.box((0, 0, -0.95), (8.4, 2.5, 0.04), MELT, mat=GLASS)
    with p.as_kind(ICE):
        for k in range(6):
            crystal(p, (p.rng.uniform(-3.6, 3.6), p.rng.uniform(-0.8, 0.8), -0.95), (0.6, 0.5, 0.2), ICE_PALE, n=8,
                    yaw=p.rng.uniform(0, TAU))
    return p


def goad_rack():
    """A Goadsmith's rack (3 wide, 2.2 tall): a sooted timber A-frame holding
    goad irons with hooked tips, their ends glowing in a trough of coals
    beneath, a hide apron hung on its end, leather straps."""
    p = P('GoadRack', frost=0.3, seed=75)
    with p.as_kind(PAINT):
        for s in (-1, 1):
            p.prism((s * 1.4, -0.4, 0.0), 6, 0.07, 0.06, 2.3, TIMBER_DARK, lean=(0, 0.2))
            p.prism((s * 1.4, 0.4, 0.0), 6, 0.07, 0.06, 2.3, TIMBER_DARK, lean=(0, -0.2))
        p.box((0, 0.0, 2.1), (3.0, 0.14, 0.14), TIMBER_DARK)
        p.box((0, 0.0, 1.2), (3.0, 0.12, 0.12), TIMBER)
        p.box((1.55, 0.0, 1.4), (0.05, 0.8, 1.1), HIDE)
    with p.as_kind(IRON):
        for k in range(6):
            x = -1.1 + k * 0.44
            p.sweep([(x, -0.05, 0.4), (x, -0.08, 2.15), (x + 0.12, -0.14, 2.35), (x + 0.2, -0.05, 2.25)], 0.035,
                    0.03, IRON_DARK, sides=4)
        p.box((0, -0.05, 0.25), (2.8, 0.7, 0.5), CHAIN, bevel=0.04)
    with p.as_kind(PAINT):
        for k in range(6):
            x = -1.1 + k * 0.44
            p.prism((x, -0.05, 0.42), 5, 0.045, 0.04, 0.3, PYRE, mat=GLOW)
    coals(p, (0, -0.05, 0.5), 0.4, color=EMBER, count=10)
    return p


def ritual_circle():
    """The Gravecallers' thawing circle carved into the ice (12 across, flat):
    two concentric grooves and a ring of rune ticks with soul-light low in
    them, six spokes to a hollow centre, iron stakes with short chains at the
    rim. Everything but the stakes lies within a few inches of the floor."""
    p = P('RitualCircle', frost=0.2, seed=77)
    glow = mix(SOUL, (0.2, 0.3, 0.3), 0.45)
    for r, w in ((5.6, 0.22), (4.6, 0.14), (1.4, 0.16)):
        seg = int(r * 5)
        for k in range(seg):
            a0 = TAU * k / seg
            a1 = TAU * (k + 1) / seg
            x0, y0, x1, y1 = math.cos(a0) * r, math.sin(a0) * r, math.cos(a1) * r, math.sin(a1) * r
            ang = math.atan2(y1 - y0, x1 - x0)
            L = math.hypot(x1 - x0, y1 - y0) + 0.02
            p.box(((x0 + x1) / 2, (y0 + y1) / 2, 0.015), (L, w * 2.2, 0.03), (0.16, 0.26, 0.36), yaw=ang)
            with p.as_kind(PAINT):
                p.box(((x0 + x1) / 2, (y0 + y1) / 2, 0.035), (L, w, 0.02), glow, yaw=ang, mat=GLOW)
    for k in range(6):
        a = TAU * k / 6
        mid = (math.cos(a) * 3.0, math.sin(a) * 3.0, 0.015)
        p.box(mid, (3.2, 0.32, 0.03), (0.16, 0.26, 0.36), yaw=a)
        with p.as_kind(PAINT):
            p.box((mid[0], mid[1], 0.035), (3.2, 0.12, 0.02), glow, yaw=a, mat=GLOW)
    for k in range(24):
        a = TAU * k / 24
        with p.as_kind(PAINT):
            p.box((math.cos(a) * 5.1, math.sin(a) * 5.1, 0.035), (0.14, 0.42, 0.02), SOUL_VIOLET if k % 2 else glow,
                  yaw=a, mat=GLOW)
    with p.as_kind(IRON):
        for k in range(6):
            a = TAU * k / 6 + PI / 6
            x, y = math.cos(a) * 6.2, math.sin(a) * 6.2
            p.prism((x, y, 0.0), 6, 0.07, 0.05, 1.0, IRON_DARK)
            p.prism((x, y, 0.95), 6, 0.12, 0.12, 0.08, IRON_DARK)
            chain_run(p, (x, y, 0.85), (x * 0.92, y * 0.92, 0.02), 0.2, 0.06, 0.018)
    return p


# ================================================================== the lake
def _plate_outline(p, r, n=12):
    out = []
    for k in range(n):
        a = TAU * k / n + (PI / 6 if k % 2 else 0) * 0
        rr = r * (1.0 if k % 2 == 0 else 0.9) * (1 + p.rng.uniform(-0.05, 0.05))
        out.append((math.cos(a) * rr, math.sin(a) * rr))
    return out


def ice_plate(cracked):
    """A plate of the lake (about 18 across, hexagon-ish, matte, 1.2 thick):
    the top flat at z 0 and finely mottled (clear blue patches, frost dust,
    faint shadows of what lies under the ice), its edges bevelled and pale.
    Cracked: a fracture web glowing ember-orange (fire cracked it) over the
    same plate, flush with the top."""
    p = P('IcePlateCracked' if cracked else 'IcePlate', frost=0.0, seed=81 if cracked else 79)
    outline = _plate_outline(p, 9.2)
    bm = p.bm
    n = len(outline)
    rings = []
    for t in (0.0, 0.35, 0.68, 0.94, 1.0):
        rings.append([bm.verts.new(Vector((x * t, y * t, 0.0))) for (x, y) in outline] if t > 0 else
                     [bm.verts.new(Vector((0, 0, 0.0)))])
    bot = [bm.verts.new(Vector((x * 0.97, y * 0.97, -1.2))) for (x, y) in outline]
    lip = [bm.verts.new(Vector((x * 1.01, y * 1.01, -0.35))) for (x, y) in outline]
    faces = []
    for k in range(n):
        faces.append(bm.faces.new((rings[0][0], rings[1][k], rings[1][(k + 1) % n])))
    for a, b in zip(rings[1:], rings[2:]):
        for k in range(n):
            faces.append(bm.faces.new((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n])))
    sides = []
    for k in range(n):
        sides.append(bm.faces.new((rings[-1][k], lip[k], lip[(k + 1) % n], rings[-1][(k + 1) % n])))
        sides.append(bm.faces.new((lip[k], bot[k], bot[(k + 1) % n], lip[(k + 1) % n])))
    bottom = bm.faces.new(list(reversed(bot)))
    with p.as_kind(PAINT):
        for f in faces:
            c = f.calc_center_median()
            k = _fbm(c.x * 0.18 + 3, c.y * 0.18, 1.0)
            col = mix((0.74, 0.86, 0.93), (0.56, 0.76, 0.88), max(0.0, k * 1.6 - 0.55))
            col = mix(col, (0.86, 0.92, 0.96), max(0.0, _fbm(c.x * 0.4, c.y * 0.4, 5.0) * 1.8 - 1.0))
            p._paint([f], col, STONE)
    p.facing(faces, (0, 0, 1))
    with p.as_kind(ICE):
        p._paint(sides, ICE_PALE, STONE)
        p._paint([bottom], DEEP_ICE, STONE)
    p.facing(sides, lambda c: Vector((c.x, c.y, 0)))
    p.facing([bottom], (0, 0, -1))
    if cracked:
        _fracture_web(p)
    return p


def _fracture_web(p):
    """Glowing fractures over a plate's top: radial cracks from an impact and
    rings between them, each a dark lip with its light inside."""
    cx, cy = p.rng.uniform(-2, 2), p.rng.uniform(-2, 2)
    spokes = 9
    ends = []
    glow = mix(PYRE, EMBER, 0.45)

    def strip(a, b, w, lift, col, mat, kind):
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        L = math.hypot(b[0] - a[0], b[1] - a[1]) + w * 0.6
        with p.as_kind(kind):
            p.box(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, lift), (L, w, 0.02), col, yaw=ang, mat=mat)

    for k in range(spokes):
        a = TAU * k / spokes + p.rng.uniform(-0.2, 0.2)
        pts = [(cx, cy)]
        r = 0.0
        while r < 8.2:
            r += p.rng.uniform(1.2, 2.2)
            rr = min(r, 8.3)
            ang = a + p.rng.uniform(-0.18, 0.18)
            pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
        ends.append(pts)
        for q0, q1 in zip(pts, pts[1:]):
            strip(q0, q1, 0.24, 0.012, (0.1, 0.16, 0.24), STONE, PAINT)
            strip(q0, q1, 0.09, 0.03, glow, GLOW, PAINT)
    for ring in (2, 4):
        for k in range(spokes):
            a, b = ends[k], ends[(k + 1) % spokes]
            if len(a) > ring and len(b) > ring and p.rng.random() < 0.8:
                strip(a[ring], b[ring], 0.16, 0.012, (0.1, 0.16, 0.24), STONE, PAINT)
                strip(a[ring], b[ring], 0.06, 0.03, glow, GLOW, PAINT)


def pressure_ridge():
    """An old pressure line between plates (an 18 yd module along X, under
    0.7 tall): slabs of lake ice shoved up on edge and jumbled, the gaps
    blue, rime drifted along its lee."""
    p = P('PressureRidge', frost=0.3, seed=83)
    with p.as_kind(ICE):
        x = -9.0
        while x < 9.0:
            w = p.rng.uniform(0.8, 1.8)
            crystal(p, (x + w / 2, p.rng.uniform(-0.3, 0.3), 0.15), (w, p.rng.uniform(0.3, 0.6), p.rng.uniform(0.6, 1.1)),
                    p.vary([ICE_PALE, GLACIER, ICE_FRESH][int(x * 3) % 3], 0.05), n=10, yaw=p.rng.uniform(-0.4, 0.4),
                    roll=p.rng.uniform(-0.5, 0.5), pitch=p.rng.uniform(-0.5, 0.5), boxy=0.35, floor=-0.2)
            x += w * 0.8
    with p.as_kind(SNOW):
        for k in range(5):
            p.smooth(crystal(p, (-7.2 + k * 3.6, 0.6, 0.0), (3.8, 1.0, 0.35), RIME, n=10, boxy=0.9, floor=-0.05))
    return p


# ================================================================== the gates
ICE_WALL_HALF, ICE_WALL_H, ICE_WALL_TH = 7.0, 9.0, 2.4
ICE_WALL_SEEDS = [(-4.6, 2.2), (-1.4, 1.6), (2.2, 2.4), (5.2, 1.4), (-3.6, 6.4), (0.6, 5.6), (4.2, 6.8)]


def _voronoi_cell(i):
    """The cell of seed i in the wall's front rectangle, as a convex polygon."""
    poly = [(-ICE_WALL_HALF, 0.0), (ICE_WALL_HALF, 0.0), (ICE_WALL_HALF, ICE_WALL_H), (-ICE_WALL_HALF, ICE_WALL_H)]
    sx, sz = ICE_WALL_SEEDS[i]
    for j, (tx, tz) in enumerate(ICE_WALL_SEEDS):
        if j == i:
            continue
        mx, mz = (sx + tx) / 2, (sz + tz) / 2
        nx, nz = tx - sx, tz - sz

        def inside(q):
            return (q[0] - mx) * nx + (q[1] - mz) * nz <= 0

        out = []
        for k in range(len(poly)):
            a, b = poly[k], poly[(k + 1) % len(poly)]
            ia, ib = inside(a), inside(b)
            if ia:
                out.append(a)
            if ia != ib:
                da = (a[0] - mx) * nx + (a[1] - mz) * nz
                db = (b[0] - mx) * nx + (b[1] - mz) * nz
                t = da / (da - db)
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        poly = out
    return poly


def chain_gate():
    """The Chain Stair's grate (10 wide, 8 tall, origin at its foot closed):
    forged square bars on a riveted frame, three flat bands, spiked feet,
    a top beam with two lifting eyes (x +-4.4) for the chains, rimed."""
    p = P('ChainGate', frost=0.6, seed=95)
    with p.as_kind(IRON):
        for k in range(13):
            x = -4.8 + k * 0.8
            p.box((x, 0, 3.9), (0.24, 0.24, 7.8), IRON_DARK, bevel=0.03)
            p.spike((x, 0, 0.0), 0.16, -0.5, IRON_DARK, sides=4)
        for z in (0.8, 3.6, 6.4):
            p.box((0, -0.05, z), (10.0, 0.34, 0.36), CHAIN, bevel=0.04)
            rivets(p, [(-4.8 + k * 0.8, -0.24, z) for k in range(13)], 0.07)
        p.box((0, 0, 7.95), (10.4, 0.55, 0.55), CHAIN, bevel=0.06)
        for x in (-4.4, 4.4):
            loop_tube(p, [Vector((x + math.cos(a) * 0.38, 0, 8.6 + math.sin(a) * 0.38)) for a in
                          [TAU * i / 12 for i in range(12)]], 0.11, IRON_DARK, sides=6)
    with p.as_kind(SNOW):
        p.box((0, 0, 8.28), (10.2, 0.5, 0.12), RIME)
        for z in (0.98, 3.78, 6.58):
            p.box((0, -0.05, z), (9.8, 0.32, 0.05), RIME)
    icicles(p, [(-4.8 + k * 0.8, -0.2, 6.2) for k in range(0, 13, 2)], 0.6, 0.05)
    return p


def chain_gate_post():
    """A post of the Chain Stair's gate (2.2 square, 11 tall, origin at its
    base centre): seal stone with an iron chain-wheel on its -X face
    (toward the opening) at the top, a chain hanging from the wheel. Place
    one either side, the other mirrored."""
    p = P('ChainGatePost', frost=0.6, seed=97)
    p.box((0, 0, 0.4), (2.8, 2.8, 0.8), SEAL_EDGE, bevel=0.1)
    loft_z(p, [(0.8, 0, 0, 1.05, 1.05, 5.0), (10.2, 0, 0, 0.95, 0.95, 5.0)], 16, SEAL_STONE)
    p.box((0, 0, 10.6), (2.5, 2.5, 0.8), SEAL_EDGE, bevel=0.1)
    with p.as_kind(IRON):
        # The chain wheel, its axle along X: a drum between two flanges.
        p.prism((-1.05, 0, 9.4), 14, 0.6, 0.6, -0.9, CHAIN, axis=(1, 0, 0))
        for x in (-1.05, -1.95):
            p.prism((x, 0, 9.4), 14, 0.95, 0.95, -0.12, IRON_DARK, axis=(1, 0, 0))
        p.box((-0.95, 0, 9.4), (0.5, 0.5, 0.5), IRON_DARK)
    chain_run(p, (-1.3, -0.9, 9.0), (-1.3, -0.9, 4.0), 0.55, 0.22, 0.08)
    with p.as_kind(PAINT):
        for k in range(5):
            p.box((-1.08, 0, 2.6 + k * 1.2), (0.05, 0.4, 0.12), RUNE_DIM, mat=GLOW)
    snowcap(p, (0, 0, 11.05), (2.4, 2.4, 0.4))
    return p


# ===================================================================== registry
HELD_CACHE = {}


def _held_cache(name):
    if name not in HELD_CACHE:
        field, verts, faces, surface = gf.held_dead_mesh(bpy, name, target=900)
        HELD_CACHE[name] = (field, verts, faces, surface)
    return HELD_CACHE[name]


BUILDERS = {
    # The glacier.
    'GlacierWallA': lambda: gn.glacier_wall(bpy, 'A'),
    'GlacierWallB': lambda: gn.glacier_wall(bpy, 'B'),
    'IceFall': lambda: gn.ice_fall(bpy),
    'SeracS': lambda: gn.serac(bpy, 'S'),
    'SeracM': lambda: gn.serac(bpy, 'M'),
    'SeracL': lambda: gn.serac(bpy, 'L'),
    'IceBridge': lambda: gn.ice_bridge(bpy),
    'CrevasseEdgeA': lambda: gn.crevasse_edge(bpy, 'A'),
    'CrevasseEdgeB': lambda: gn.crevasse_edge(bpy, 'B'),
    'CrevasseEdgeC': lambda: gn.crevasse_edge(bpy, 'C'),
    'FrozenFall': lambda: gn.frozen_fall(bpy),
    'SnowDriftA': lambda: snow_drift('A'),
    'SnowDriftB': lambda: snow_drift('B'),
    'Sastrugi': sastrugi,
    # The rock.
    'ThornpeakRockA': lambda: gn.thornpeak_rock(bpy, 'A'),
    'ThornpeakRockB': lambda: gn.thornpeak_rock(bpy, 'B'),
    'ThornpeakRockC': lambda: gn.thornpeak_rock(bpy, 'C'),
    'ThornpeakCrag': lambda: gn.thornpeak_crag(bpy),
    'MoraineRocks': lambda: gn.moraine_rocks(bpy),
    'RockCliff': lambda: gn.rock_cliff(bpy),
    'HaulRoadKerb': haul_road_kerb,
    # The Smith.
    **{f'SealPillar_{t}': (lambda t=t: seal_pillar(t, False)) for t in SEAL_TOOLS},
    **{f'SealPillarCracked_{t}': (lambda t=t: seal_pillar(t, True)) for t in SEAL_TOOLS},
    'SealShackle': seal_shackle,
    'SmithsHammer': smiths_hammer,
    'RuneWall': rune_wall,
    'ChainAnchor': chain_anchor,
    'ChainLink': chain_link_tile,
    'ChainHeap': chain_heap,
    'ChainBroken': chain_broken,
    'ChainBridge': chain_bridge,
    'KeystoneSocket': keystone_socket,
    'GateTunnel': gate_tunnel,
    'VigilCairn': vigil_cairn,
    # The held.
    **{f'HeldGiant{k}': (lambda k=k: gf.held_giant(bpy, k)) for k in 'ABC'},
    **{f'HeldDead{k}': (lambda k=k: gf.held_dead(bpy, k)) for k in 'ABCDEF'},
    'VaultWall': lambda: gf.vault_wall(bpy, _held_cache),
    # The cult.
    'CultTent': cult_tent,
    'Sledge': sledge,
    'SoulBrazier': soul_brazier,
    'ThawPyre': thaw_pyre,
    'Pyre': pyre,
    'MeltChannel': melt_channel,
    'GoadRack': goad_rack,
    'RitualCircle': ritual_circle,
    # The lake.
    'IcePlate': lambda: ice_plate(False),
    'IcePlateCracked': lambda: ice_plate(True),
    'IceChunkA': lambda: gn.ice_chunk(bpy, 'A'),
    'IceChunkB': lambda: gn.ice_chunk(bpy, 'B'),
    'IceChunkC': lambda: gn.ice_chunk(bpy, 'C'),
    'PressureRidge': pressure_ridge,
    # The gates.
    **{f'IceWall_{"ABCDEFG"[i]}': (lambda i=i: gn.ice_wall_shard(bpy, i, ICE_WALL_SEEDS, _voronoi_cell, ICE_WALL_HALF,
                                                                  ICE_WALL_H, ICE_WALL_TH)) for i in range(7)},
    'ChainGate': chain_gate,
    'ChainGatePost': chain_gate_post,
    # The showpiece.
    'CalvingFace': lambda: gf._face(False),
    'FaceCalved': lambda: gf._face(True),
    'FaceCrack_0': gf.face_crack_0,
    'FaceCrack_1': gf.face_crack_1,
    'FacePlateFallen': gf.face_plate_fallen,
    **{f'FaceCrack_2{"abcd"[i]}': (lambda i=i: gf.face_crack_2(i)) for i in range(4)},
    'FaceCrack_3': gf.face_crack_3,
    'FaceChunkA': lambda: gn.face_chunk(bpy, 'FaceChunkA', (14, 10, 12), 1),
    'FaceChunkB': lambda: gn.face_chunk(bpy, 'FaceChunkB', (9, 8, 10), 2),
    'FaceChunkC': lambda: gn.face_chunk(bpy, 'FaceChunkC', (6, 5, 7), 3),
    'WyrmSilhouette': lambda: gf.wyrm_silhouette(bpy),
    'WyrmHeart': gf.wyrm_heart,
}


# ===================================================================== build
def build_sanctum_kit(root_name, names):
    """hckit.build_kit with this kit's material names (stone, glow, glass)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitGlass', 0.0, 0.4)):
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
    for n in names:
        obj = BUILDERS[n]().finish(materials, root)
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
    return parts, materials


# ==================================================================== review
FACE_FRAME = {'Kit_CalvingFace', 'Kit_FaceCalved', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FacePlateFallen'}


def preview_materials(materials):
    """Swap the export materials' nodes for review renders: glow emissive,
    glass unlit and translucent as the runtime draws it (opacity 0.38)."""
    stone, glow, glass = materials
    for mat in (glow, glass):
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        col = nt.nodes.new('ShaderNodeVertexColor')
        col.layer_name = 'Col'
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(col.outputs['Color'], em.inputs['Color'])
        if mat is glow:
            em.inputs['Strength'].default_value = 2.2
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        else:
            em.inputs['Strength'].default_value = 1.0
            tr = nt.nodes.new('ShaderNodeBsdfTransparent')
            mix_ = nt.nodes.new('ShaderNodeMixShader')
            mix_.inputs['Fac'].default_value = 0.38
            nt.links.new(tr.outputs['BSDF'], mix_.inputs[1])
            nt.links.new(em.outputs['Emission'], mix_.inputs[2])
            nt.links.new(mix_.outputs['Shader'], out.inputs['Surface'])
            mat.surface_render_method = 'BLENDED'
            mat.use_backface_culling = False


def _setup_render(path, res=(1400, 1000)):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = path
    for attr, value in (('taa_render_samples', 24), ('use_shadows', True), ('use_raytracing', True),
                        ('fast_gi_method', 'GLOBAL_ILLUMINATION'), ('use_fast_gi', True)):
        try:
            setattr(scene.eevee, attr, value)
        except (AttributeError, TypeError):
            pass
    world = bpy.data.worlds.get('Dusk') or bpy.data.worlds.new('Dusk')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.2, 0.27, 0.42, 1)
    bg.inputs['Strength'].default_value = 1.1
    scene.world = world
    if not bpy.data.objects.get('KeySun'):
        sun = bpy.data.objects.new('KeySun', bpy.data.lights.new('KeySun', 'SUN'))
        sun.data.energy = 3.2
        sun.data.color = (0.86, 0.92, 1.0)
        sun.rotation_euler = (math.radians(52), 0, math.radians(-38))
        scene.collection.objects.link(sun)
        rim = bpy.data.objects.new('RimSun', bpy.data.lights.new('RimSun', 'SUN'))
        rim.data.energy = 1.2
        rim.data.color = (1.0, 0.8, 0.62)
        rim.rotation_euler = (math.radians(70), 0, math.radians(150))
        scene.collection.objects.link(rim)
    return scene


def _camera(name, lens=40):
    cam = bpy.data.objects.get(name)
    if cam:
        return cam
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 4000
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    return cam


def _look(cam, loc, target):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_closeups(parts, folder):
    """One framed render per piece (front three-quarter, a 2 yd figure beside
    it for scale)."""
    os.makedirs(folder, exist_ok=True)
    scene = _setup_render('', res=(1000, 1000))
    cam = _camera('closeup')
    scene.camera = cam
    bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=2.0, location=(0, 0, 1.0))
    figure = bpy.context.active_object
    figure.name = 'ScaleFigure'
    for obj in parts:
        for o in parts:
            o.hide_render = True
        obj.hide_render = False
        if obj.name.startswith('Kit_FaceCrack') or obj.name in ('Kit_WyrmHeart', 'Kit_FacePlateFallen'):
            base = bpy.data.objects.get('Kit_CalvingFace')
            if base:
                base.hide_render = False
        if obj.name == 'Kit_WyrmHeart':
            w = bpy.data.objects.get('Kit_WyrmSilhouette')
            if w:
                w.hide_render = False
        bb = [Vector(c) for c in obj.bound_box]
        lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        centre = (lo + hi) / 2
        size = max(4.0, (hi - lo).length)
        figure.location = (lo.x - 1.2, lo.y - 0.6, 1.0 + (lo.z if lo.z > -3 else 0))
        cam.data.lens = 40
        _look(cam, centre + Vector((-0.5, -1.2, 0.45)).normalized() * size * 1.15, centre)
        scene.render.filepath = os.path.join(folder, obj.name + '.png')
        bpy.ops.render.render(write_still=True)
    for o in parts:
        o.hide_render = False
    figure.hide_render = True


def render_stages(folder):
    """The showpiece: the face and the wyrm from the lake, stage by stage, and
    a hero shot."""
    os.makedirs(folder, exist_ok=True)
    scene = _setup_render('', res=(1600, 1000))
    cam = _camera('stage', lens=28)
    scene.camera = cam
    names = {o.name: o for o in bpy.data.objects}
    stages = [
        ('stage0', ['Kit_CalvingFace', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FaceCrack_0']),
        ('stage1', ['Kit_CalvingFace', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FaceCrack_0', 'Kit_FaceCrack_1',
                    'Kit_FacePlateFallen']),
        ('stage2', ['Kit_CalvingFace', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FaceCrack_0', 'Kit_FaceCrack_1',
                    'Kit_FacePlateFallen', 'Kit_FaceCrack_2a', 'Kit_FaceCrack_2b', 'Kit_FaceCrack_2c',
                    'Kit_FaceCrack_2d']),
        ('stage3', ['Kit_CalvingFace', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FaceCrack_0', 'Kit_FaceCrack_1',
                    'Kit_FacePlateFallen', 'Kit_FaceCrack_2a', 'Kit_FaceCrack_2b', 'Kit_FaceCrack_2c',
                    'Kit_FaceCrack_2d', 'Kit_FaceCrack_3']),
        ('stage4', ['Kit_FaceCalved', 'Kit_WyrmSilhouette', 'Kit_WyrmHeart', 'Kit_FacePlateFallen']),
    ]
    for o in bpy.data.objects:
        if o.name.startswith('Kit_'):
            o.location = (0, 0, 0)
    for name, show in stages:
        for o in bpy.data.objects:
            if o.name.startswith('Kit_'):
                o.hide_render = o.name not in show
        _look(cam, (0, -150, 38), (0, 0, 44))
        scene.render.filepath = os.path.join(folder, f'face_{name}.png')
        bpy.ops.render.render(write_still=True)
    for o in bpy.data.objects:
        if o.name.startswith('Kit_'):
            o.hide_render = o.name not in stages[0][1]
    cam.data.lens = 35
    _look(cam, (-30, -70, 14), (-6, 10, 28))
    scene.render.filepath = os.path.join(folder, 'face_hero.png')
    bpy.ops.render.render(write_still=True)
    for o in bpy.data.objects:
        if o.name.startswith('Kit_'):
            o.hide_render = o.name not in stages[4][1]
    _look(cam, (-34, -46, 20), (-16, 8, 28))
    scene.render.filepath = os.path.join(folder, 'face_calved_hero.png')
    bpy.ops.render.render(write_still=True)
    for o in bpy.data.objects:
        o.hide_render = False


def layout_preview(parts, path):
    """Every piece laid out in rows (the face apart), one overview render."""
    x = 0.0
    row = 0.0
    width = 0.0
    for obj in parts:
        if obj.name in FACE_FRAME or obj.name.startswith('Kit_FaceCrack') or obj.name.startswith('Kit_IceWall_'):
            obj.location = (0, 260, 0) if not obj.name.startswith('Kit_IceWall_') else (-40, -30, 0)
            continue
        d = obj.dimensions
        if x > 170:
            x = 0.0
            row += width + 8
            width = 0.0
        obj.location = (x + d.x / 2, row, 0)
        x += d.x + 6
        width = max(width, d.y)
    scene = _setup_render(path, res=(1900, 1100))
    cam = _camera('overview', lens=22)
    scene.camera = cam
    _look(cam, (90, -170, 150), (90, 90, 0))
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

    def arg(flag):
        return argv[argv.index(flag) + 1] if flag in argv else None

    preview = arg('--preview')
    closeups = arg('--closeups')
    stages = arg('--stages')
    save = arg('--save')
    only = arg('--pieces')
    names = list(BUILDERS)
    if only:
        want = only.split(',')
        names = [n for n in names if n in want]
    parts, materials = build_sanctum_kit('GravewyrmSanctumKit_ROOT', names)
    if not only:
        export_kit(os.path.join(HERE, 'gravewyrm_sanctum_kit_components.glb'))
    if closeups or stages or preview:
        preview_materials(materials)
    if stages:
        render_stages(stages)
    if closeups:
        render_closeups(parts, closeups)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)
    if preview:
        layout_preview(parts, preview)


if __name__ == '__main__':
    main()
