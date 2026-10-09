"""The Drowned Temple kit: every piece of the open-air lagoon temple.

Run (background, one scene):
  blender -b --factory-startup --python build_drowned_temple_kit.py -- [--preview out.png] [--save out.blend]

Writes drowned_temple_kit_components.glb next to this file; the shipping build
(scripts/assets/drowned_temple_kit/build.mjs) validates, fingerprints and meshopts
it into public/models/props/drowned_temple_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, see
src/render/drowned_temple/temple_kit.ts). Game yards, +Z up, front -Y (the
game's +Z after the glTF export). Shared modelling helpers: hckit.py.

Palette (docs/design/dungeon-rework/drowned_temple.md, "Environment"): pearl-white
stone (#E6E1D3) with blue-grey shadow (#5C6B80), lagoon teal and algae at the
waterline, silver moonlight glyphs, the choir's gold only on the Great Conch,
cold violet for the prism's enemy magic, bioluminescent cyan for life.
"""
import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hckit  # noqa: E402
from hckit import GLOW, STONE, Piece, export_kit  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
GLASS = hckit.SILK

# ---- the lagoon temple palette (sRGB) ------------------------------------------
PEARL = (0.9, 0.88, 0.83)          # pearl stone #E6E1D3
PEARL_WARM = (0.93, 0.9, 0.84)
PEARL_SHADE = (0.72, 0.74, 0.76)
SLATE_BLUE = (0.36, 0.42, 0.5)     # blue-grey shadow #5C6B80
MOONSTONE = (0.78, 0.82, 0.9)
NACRE = (0.9, 0.86, 0.9)
NACRE_PINK = (0.95, 0.8, 0.82)
ALGAE = (0.28, 0.44, 0.4)
ALGAE_DARK = (0.16, 0.28, 0.27)
TEAL = (0.18, 0.44, 0.47)          # lagoon teal #2F6F78
DEEP = (0.07, 0.15, 0.23)
SILVER = (0.87, 0.91, 0.96)        # moonlight #DDE8F5 (as light)
CYAN = (0.44, 0.89, 0.88)          # bioluminescence #6FE3E0 (as light)
GOLD = (0.89, 0.75, 0.42)          # choir gold #E3C06A
GOLD_LIGHT = (1.0, 0.84, 0.5)
VIOLET = (0.73, 0.65, 1.0)         # enemy magic #B9A6FF (as light)
CORAL = (0.86, 0.47, 0.5)
CORAL_DEEP = (0.62, 0.3, 0.42)
ROCK = (0.3, 0.32, 0.38)
ROCK_DARK = (0.17, 0.18, 0.23)
REED = (0.36, 0.44, 0.3)
LILY = (0.22, 0.4, 0.3)
GLASS_TINT = (0.78, 0.86, 0.96)
PALEFIRE = (0.76, 0.86, 1.0)


def P(name, **kw):
    return Piece('Kit_' + name, **kw)


def waterline(p, radius, z0, z1, sides=16, cx=0.0, cy=0.0):
    """An algae and pearl crust band round a submerged foot between z0 and z1."""
    for k in range(sides):
        a = k / sides * math.tau + p.rng.random() * 0.2
        r = radius * p.rng.uniform(0.98, 1.06)
        h = p.rng.uniform(0.3, 1.0) * (z1 - z0)
        p.box((cx + math.cos(a) * r, cy + math.sin(a) * r, z0 + h / 2), (0.5, 0.18, h),
              p.vary(ALGAE if p.rng.random() < 0.7 else ALGAE_DARK, 0.12), yaw=a + math.pi / 2)
    for k in range(sides // 2):
        a = p.rng.random() * math.tau
        r = radius * 1.02
        z = z0 + (z1 - z0) * p.rng.random()
        s = p.rng.uniform(0.08, 0.18)
        p.rock((cx + math.cos(a) * r, cy + math.sin(a) * r, z), (s, s, s), NACRE, jitter=0.05, subdivisions=1)


def glyph_ring(p, radius, z, count, size, color=SILVER, cx=0.0, cy=0.0):
    """Glowing moon glyphs inlaid in a ring (crescents and bars)."""
    for k in range(count):
        a = k / count * math.tau
        x = cx + math.cos(a) * radius
        y = cy + math.sin(a) * radius
        if k % 2 == 0:
            p.box((x, y, z), (size, size * 0.3, 0.05), color, mat=GLOW, yaw=a + math.pi / 2)
        else:
            p.prism((x, y, z - 0.02), 8, size * 0.35, size * 0.35, 0.06, color, mat=GLOW)


def fluted_shaft(p, x, y, z0, z1, r, color, flutes=12):
    """A fluted column shaft: a smooth core and raised fillets between flutes."""
    p.lathe((x, y, z0), [(r * 0.96, 0), (r, 0.1), (r * 0.94, z1 - z0 - 0.1), (r * 0.9, z1 - z0)], 20,
            color)
    for k in range(flutes):
        a = k / flutes * math.tau
        p.box((x + math.cos(a) * r * 0.97, y + math.sin(a) * r * 0.97, (z0 + z1) / 2),
              (r * 0.16, r * 0.16, (z1 - z0) * 0.96), p.vary(color, 0.02), yaw=a)


# =================================================================== columns and ruins
def column():
    """A drowned temple column: stepped plinth half in the water, fluted pearl
    shaft 11 yd tall, a crescent capital, algae at the waterline."""
    p = P('Column', lichen=0.25)
    p.box((0, 0, -0.6), (3.2, 3.2, 1.6), p.vary(PEARL_SHADE), bevel=0.1)
    p.lathe((0, 0, 0.2), [(1.45, 0), (1.45, 0.35), (1.2, 0.6), (1.05, 0.8)], 20, PEARL)
    fluted_shaft(p, 0, 0, 0.8, 10.2, 1.0, PEARL)
    p.lathe((0, 0, 10.2), [(0.95, 0), (1.3, 0.5), (1.6, 0.9)], 20, PEARL_WARM)
    p.box((0, 0, 11.3), (3.4, 3.4, 0.5), p.vary(PEARL), bevel=0.08)
    # A crescent carved on the abacus faces, silver in the moon.
    for s in (-1, 1):
        p.box((0, s * 1.72, 11.3), (1.2, 0.05, 0.22), SILVER, mat=GLOW)
    waterline(p, 1.05, 0.8, 2.6)
    return p


def column_broken():
    """A column snapped at the third drum, its break jagged, drums at its foot."""
    p = P('ColumnBroken', lichen=0.45)
    p.box((0, 0, -0.6), (3.2, 3.2, 1.6), p.vary(PEARL_SHADE), bevel=0.1)
    p.lathe((0, 0, 0.2), [(1.45, 0), (1.45, 0.35), (1.2, 0.6), (1.05, 0.8)], 20, PEARL)
    fluted_shaft(p, 0, 0, 0.8, 4.6, 1.0, PEARL)
    for i in range(5):
        a = p.rng.random() * math.tau
        p.spike((math.cos(a) * 0.4, math.sin(a) * 0.4, 4.5), 0.5, p.rng.uniform(0.4, 1.1), PEARL, sides=4)
    p.lathe((2.2, 0.8, 0.0), [(0.95, 0), (1.0, 0.1), (0.95, 1.7), (0.9, 1.8)], 16, PEARL_SHADE)
    waterline(p, 1.05, 0.8, 2.4)
    return p


def column_fallen():
    """Two drums and a capital lying in the shallows."""
    p = P('ColumnFallen', lichen=0.6)
    for i, (x, rot) in enumerate(((-2.8, 0.05), (0.0, -0.08), (2.9, 0.12))):
        mark = p.mark()
        fluted_shaft(p, 0, 0, -1.2, 1.2, 0.95, p.vary(PEARL, 0.04), flutes=10)
        p.turn(mark, Matrix.Translation((x, 0, 0.9)) @ Matrix.Rotation(math.pi / 2 + rot, 4, 'Y'))
    p.box((5.3, 0.3, 0.8), (2.4, 2.4, 1.6), PEARL_WARM, bevel=0.1, yaw=0.3)
    waterline(p, 1.0, 0.0, 0.6, sides=10)
    return p


def statue(name, pose):
    """A drowned choir singer carved in pearl stone, 7 yd, knee-deep in the lagoon:
    hooded, robed, hands raised in song (sing), folded (pray) or holding a conch."""
    p = P(name, lichen=0.55)
    p.box((0, 0, -1.0), (2.6, 2.6, 2.0), p.vary(PEARL_SHADE), bevel=0.1)
    # The robe: a flared bell to the waist, then the chest.
    p.lathe((0, 0, 0.0), [(1.25, 0), (1.15, 1.2), (0.85, 3.0), (0.72, 3.6)], 18, PEARL)
    # Folds down the robe.
    for k in range(9):
        a = k / 9 * math.tau
        p.box((math.cos(a) * 1.0, math.sin(a) * 1.0, 1.5), (0.18, 0.18, 3.0), p.vary(PEARL, 0.04), yaw=a,
              taper=0.7)
    p.box((0, 0, 4.2), (1.45, 0.85, 1.4), PEARL, bevel=0.12, taper=0.85)
    # The hood and the face in its shadow (tilted up in song).
    tilt = 0.35 if pose == 'sing' else (-0.25 if pose == 'pray' else 0.1)
    mark = p.mark()
    p.lathe((0, 0, 0), [(0.55, 0), (0.62, 0.35), (0.55, 0.8), (0.3, 1.1), (0.0, 1.2)], 14, PEARL)
    p.box((0, -0.42, 0.45), (0.5, 0.25, 0.6), SLATE_BLUE)
    p.box((0, -0.5, 0.35), (0.16, 0.05, 0.1), DEEP)
    p.turn(mark, Matrix.Translation((0, 0.05, 4.95)) @ Matrix.Rotation(tilt, 4, 'X'))
    if pose == 'sing':
        for s in (-1, 1):
            p.sweep([(s * 0.7, 0, 4.5), (s * 1.3, -0.2, 5.3), (s * 1.5, -0.3, 6.4)], 0.26, 0.2, PEARL, sides=7)
            p.box((s * 1.55, -0.3, 6.65), (0.3, 0.2, 0.45), PEARL_WARM)
    elif pose == 'pray':
        for s in (-1, 1):
            p.sweep([(s * 0.7, 0, 4.5), (s * 0.5, -0.5, 4.1), (s * 0.08, -0.7, 4.5)], 0.24, 0.2, PEARL, sides=7)
        p.box((0, -0.75, 4.65), (0.3, 0.2, 0.5), PEARL_WARM)
    else:
        for s in (-1, 1):
            p.sweep([(s * 0.7, 0, 4.5), (s * 0.5, -0.6, 4.7), (s * 0.2, -0.8, 5.1)], 0.24, 0.2, PEARL, sides=7)
        # The conch at the lips.
        p.lathe((0.25, -1.0, 5.0), [(0.05, 0), (0.35, 0.3), (0.45, 0.6), (0.2, 1.0), (0.0, 1.05)], 10, GOLD)
    # The drowned: algae streaks and a pearl crust up the robe.
    waterline(p, 1.2, 0.0, 1.8)
    for k in range(6):
        a = p.rng.random() * math.tau
        z = p.rng.uniform(2.0, 4.6)
        p.box((math.cos(a) * 0.9, math.sin(a) * 0.9, z - 0.6), (0.16, 0.06, 1.2), ALGAE, yaw=a + math.pi / 2)
    return p


def statue_fallen():
    """A singer toppled face-down across the stepping stones."""
    p = P('StatueFallen', lichen=0.7)
    mark = p.mark()
    p.lathe((0, 0, 0), [(1.1, 0), (1.0, 1.2), (0.8, 3.0), (0.6, 3.6)], 14, PEARL)
    p.box((0, 0, 4.1), (1.3, 0.8, 1.2), PEARL, bevel=0.1)
    p.lathe((0, 0, 4.7), [(0.5, 0), (0.55, 0.35), (0.3, 0.9), (0.0, 1.0)], 12, PEARL)
    p.turn(mark, Matrix.Translation((0, 2.6, 0.7)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    waterline(p, 1.2, 0.0, 0.5, sides=8)
    return p


def ruined_arch():
    """A great processional arch standing out of the lagoon, 16 yd, its top broken."""
    p = P('RuinedArch', lichen=0.5)
    for s in (-1, 1):
        p.box((s * 7.0, 0, 3.0), (2.4, 2.4, 12.0), p.vary(PEARL_SHADE), bevel=0.1)
        fluted_shaft(p, s * 7.0, -1.4, -2.0, 11.0, 0.7, PEARL, flutes=8)
        waterline(p, 1.3, -2.0, 1.2, cx=s * 7.0)
    p.voussoir_arch(14.0, 9.0, 6.5, 1.4, 2.4, PEARL, pointed=False, blocks=15, broken=0.25)
    glyph_ring(p, 0.01, 15.0, 1, 0.8)
    return p


def moongate():
    """HERO: the Moongate on the crater rim. A great ring of pearl stone set on a
    stepped dais, crescent horns at its crown, silver runes round its face, the
    moon's own light filling the ring (the portal back)."""
    p = P('Moongate', lichen=0.15)
    p.box((0, 0, 0.25), (13.0, 4.2, 0.5), PEARL_SHADE, bevel=0.1)
    p.box((0, 0, 0.7), (11.0, 3.2, 0.4), PEARL, bevel=0.08)
    ring_r = 5.2
    blocks = 28
    for k in range(blocks):
        a0 = k / blocks * math.tau
        a1 = (k + 1) / blocks * math.tau
        am = (a0 + a1) / 2
        x = math.cos(am) * ring_r
        z = 6.0 + math.sin(am) * ring_r
        if z < 1.0:
            continue
        length = 2 * ring_r * math.sin((a1 - a0) / 2) * 1.04
        p.box((x, 0, z), (length, 1.6, 1.3), p.vary(PEARL, 0.04), bevel=0.06, roll=-(am + math.pi / 2))
        if k % 2 == 0:
            p.box((math.cos(am) * (ring_r - 0.72), -0.82, 6.0 + math.sin(am) * (ring_r - 0.72)),
                  (0.35, 0.05, 0.35), SILVER, mat=GLOW, roll=-am)
    # Crescent horns at the crown.
    for s in (-1, 1):
        p.sweep([(s * 1.2, 0, 11.0), (s * 2.4, 0, 12.6), (s * 2.0, 0, 14.0), (s * 1.0, 0, 14.6)], 0.5, 0.08,
                PEARL_WARM, sides=6)
    # The ring's light (the way home).
    p.prism((0, 0.05, 6.0), 24, ring_r - 0.7, ring_r - 0.7, 0.1, (0.34, 0.44, 0.78), mat=GLASS,
            axis=(0, 1, 0))
    return p


def great_conch():
    """HERO: the Great Conch behind the Choir Court's stage. A colossal spiral
    shell of stone and nacre 30 yd long, lying on its side in the lagoon with
    its flared mouth turned to the court, a spiral ridge of spines climbing to
    its spire, gold light breathing in its throat."""
    p = P('GreatConch', lichen=0.2)
    mark = p.mark()
    prof = [(0.25, 0.0), (1.6, 2.5), (3.4, 6.0), (5.4, 10.5), (7.4, 15.5), (9.0, 20.5), (9.6, 24.0),
            (8.8, 26.5), (7.4, 27.6)]
    p.lathe((0, 0, 0), prof, 22, PEARL_WARM)
    # The spiral suture and its spines, climbing from the spire to the shoulder.
    pts = []
    for i in range(80):
        t = i / 79
        z = 0.5 + t * 23.0
        r = 0.0
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            if z0 <= z <= z1:
                r = r0 + (r1 - r0) * (z - z0) / max(1e-3, z1 - z0)
        a = t * 4.2 * math.tau
        pts.append((math.cos(a) * (r + 0.3), math.sin(a) * (r + 0.3), z))
    p.sweep(pts, 0.7, 0.9, p.vary(PEARL, 0.04), sides=6)
    for i in range(6, 80, 5):
        x, y, z = pts[i]
        rr = math.hypot(x, y) or 1
        s_ = 0.6 + i / 80 * 1.8
        p.spike((x, y, z), s_ * 0.45, s_ * 2.2, PEARL_SHADE, sides=5, lean=(x / rr * s_ * 0.8, y / rr * s_ * 0.8))
    # The flared lip and the pink nacre throat.
    p.lathe((0, 0, 26.5), [(7.4, 0), (9.6, 0.7), (11.2, 1.6), (11.6, 2.2), (10.8, 2.6)], 26, NACRE_PINK)
    p.prism((0, 0, 25.6), 22, 6.8, 6.8, 0.2, (1.0, 0.78, 0.5), mat=GLOW)
    p.prism((0, 0, 24.0), 22, 4.5, 4.5, 0.2, GOLD_LIGHT, mat=GLOW)
    # Gold bands inlaid along the whorls.
    for k in range(3):
        z = 8.0 + k * 6.0
        r = 3.4 + k * 2.0
        p.lathe((0, 0, z), [(r + 0.15, 0), (r + 0.2, 0.35)], 22, GOLD, mat=GLOW)
    # Lie it on its side: spire north (Blender -Y), mouth toward the court (+Y).
    p.turn(mark, Matrix.Translation((0, -12.0, 7.0)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    waterline(p, 9.0, -1.0, 2.2, sides=26)
    return p


def amphi_tier():
    """A 30-degree arc of the amphitheater's seating: three stepped tiers of
    pearl benches rising out of the shallows (the inner edge at radius 0)."""
    p = P('AmphiTier', lichen=0.45)
    arc = math.radians(30)
    segs = 5
    for tier in range(3):
        r0 = 1.0 + tier * 3.2
        r1 = r0 + 3.2
        top = 1.4 + tier * 1.6
        for k in range(segs):
            a0 = -arc / 2 + arc * k / segs
            a1 = -arc / 2 + arc * (k + 1) / segs
            am = (a0 + a1) / 2
            rm = (r0 + r1) / 2 + 26.0
            chord = 2 * rm * math.sin((a1 - a0) / 2)
            x = math.sin(am) * rm
            y = math.cos(am) * rm - 26.0
            p.box((x, y, top / 2 - 1.0), (chord * 1.02, 3.2, top + 2.0), p.vary(PEARL, 0.05), bevel=0.08,
                  yaw=-am)
            # The bench lip.
            p.box((math.sin(am) * (r0 + 26.2), math.cos(am) * (r0 + 26.2) - 26.0, top + 0.1),
                  (chord * 1.02, 0.5, 0.25), PEARL_WARM, yaw=-am)
    waterline(p, 0.01, -1.0, 1.0, sides=6)
    return p


# ======================================================================= hero landmarks
def prism_tower():
    """HERO: the Prism Tower beside the terrace, a slender tapering spire of
    banded pearl stone 40 yd tall standing in the lagoon, crowned by the great
    faceted moon-lens of tideglass that the Colossus was made to guard."""
    p = P('PrismTower', lichen=0.3)
    p.lathe((0, 0, -3.0), [(6.5, 0), (6.5, 3.0), (5.2, 4.0), (4.6, 6.0)], 24, PEARL_SHADE)
    bands = 14
    for i in range(bands):
        z0 = 3.0 + i * 2.5
        ra = 4.4 - 2.2 * (i / bands)
        rb = 4.4 - 2.2 * ((i + 1) / bands)
        col = SLATE_BLUE if i % 4 == 3 else p.vary(PEARL, 0.03)
        p.lathe((0, 0, z0), [(ra, 0), (rb, 2.45), (rb * 0.96, 2.5)], 12, col)
    top = 3.0 + bands * 2.5
    # Buttress fins.
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        p.box((math.cos(a) * 4.2, math.sin(a) * 4.2, 8.0), (0.8, 3.0, 14.0), PEARL, yaw=a, taper=0.3)
    # The lens cradle and the prism.
    for k in range(6):
        a = k / 6 * math.tau
        p.sweep([(math.cos(a) * 2.3, math.sin(a) * 2.3, top), (math.cos(a) * 3.6, math.sin(a) * 3.6, top + 2.5),
                 (math.cos(a) * 2.8, math.sin(a) * 2.8, top + 5.0)], 0.3, 0.12, PEARL_WARM, sides=6)
    p.prism((0, 0, top + 1.0), 6, 0.2, 2.6, 3.0, GLASS_TINT, mat=GLASS)
    p.prism((0, 0, top + 4.0), 6, 2.6, 0.1, 3.4, GLASS_TINT, mat=GLASS)
    p.prism((0, 0, top + 2.4), 6, 1.2, 0.2, 2.4, VIOLET, mat=GLOW)
    glyph_ring(p, 4.6, 5.6, 16, 0.7, VIOLET)
    waterline(p, 6.5, -1.0, 1.5, sides=26)
    return p


def prism_plinth():
    """The Colossus's low plinth: a stepped disc with a ring of violet glyphs."""
    p = P('PrismPlinth', lichen=0.2)
    p.lathe((0, 0, -0.3), [(4.8, 0), (4.8, 0.32), (4.2, 0.36), (4.2, 0.42), (0.0, 0.42)], 36, PEARL_SHADE)
    glyph_ring(p, 3.6, 0.13, 20, 0.5, VIOLET)
    glyph_ring(p, 2.2, 0.13, 12, 0.4, SILVER)
    return p


def moon_altar():
    """HERO: the Moon Altar in the island's centre, a round drum of moonstone on
    three steps, crescent horns of silver-veined pearl arching over it, the
    drowned moon's sigil burning on its face."""
    p = P('MoonAltar', lichen=0.1)
    for i, r in enumerate((3.2, 2.7, 2.2)):
        p.lathe((0, 0, i * 0.3), [(r, 0), (r, 0.3)], 32, p.vary(PEARL_SHADE if i == 0 else PEARL, 0.02))
    p.lathe((0, 0, 0.9), [(1.8, 0), (1.9, 0.2), (1.7, 1.5), (2.0, 1.7), (2.0, 1.9)], 28, MOONSTONE)
    glyph_ring(p, 1.95, 1.6, 12, 0.35)
    p.prism((0, 0, 2.8), 28, 1.2, 1.2, 0.05, SILVER, mat=GLOW)
    # Two crescent horns sweeping over the altar.
    for s in (-1, 1):
        pts = [(s * 2.6, 0, 0.8)]
        for i in range(1, 9):
            t = i / 8
            a = t * math.pi * 0.8
            pts.append((s * (2.6 - math.sin(a) * 0.4 - t * 2.4), 0, 0.8 + math.sin(a) * 6.5 + t * 1.0))
        p.sweep(pts, 0.55, 0.1, PEARL_WARM, sides=7)
        for i in range(2, 8, 2):
            x, y, z = pts[i]
            p.box((x, -0.52, z), (0.25, 0.06, 0.25), SILVER, mat=GLOW)
    return p


def standing_stone():
    """A moonstone monolith of the altar ring, a crescent carved through it."""
    p = P('StandingStone', lichen=0.5)
    p.box((0, 0, 3.4), (1.7, 1.1, 7.0), MOONSTONE, bevel=0.15, taper=0.72)
    p.box((0, -0.56, 5.2), (0.7, 0.05, 0.9), SILVER, mat=GLOW)
    p.box((0, 0, -0.4), (2.4, 1.8, 1.0), PEARL_SHADE, bevel=0.1)
    return p


def sunken_temple():
    """HERO massing: the drowned temple itself, rising out of the lagoon behind
    the court: a stepped sanctuary of three pearl terraces, a colonnaded
    upper hall and a cracked moon dome, 64 yd across (render only, far out in
    the water)."""
    p = P('SunkenTemple', lichen=0.45)
    for i, (w, d, h) in enumerate(((64.0, 40.0, 6.0), (50.0, 30.0, 6.0), (36.0, 22.0, 6.0))):
        z0 = -4.0 + i * 6.0
        p.box((0, 0, z0 + h / 2), (w, d, h), p.vary(PEARL_SHADE if i == 0 else PEARL, 0.03), bevel=0.3)
        p.box((0, 0, z0 + h), (w + 1.2, d + 1.2, 0.6), PEARL_WARM, bevel=0.1)
        # A frieze band of silver glyphs on each terrace's face.
        for k in range(int(w / 5)):
            x = -w / 2 + 2.5 + k * 5.0
            p.box((x, -d / 2 - 0.3, z0 + h - 1.2), (1.6, 0.08, 0.35), SILVER, mat=GLOW)
    top = 14.6
    # The colonnade of the upper hall.
    for k in range(9):
        x = -16.0 + k * 4.0
        fluted_shaft(p, x, -9.0, top, top + 10.0, 0.8, PEARL, flutes=8)
        fluted_shaft(p, x, 9.0, top, top + 10.0, 0.8, PEARL, flutes=8)
    p.box((0, 0, top + 10.6), (38.0, 22.0, 1.2), PEARL_WARM, bevel=0.2)
    # The moon dome over the upper hall, a seam of moonlight cracked down it.
    prof = [(10.0 * math.cos(t * math.pi / 2), 10.0 * math.sin(t * math.pi / 2)) for t in (i / 10 for i in range(11))]
    p.lathe((0, 0, top + 11.2), [(r, z) for r, z in prof], 28, MOONSTONE)
    p.lathe((0, 0, top + 11.2), [(10.4, 0), (10.4, 0.8)], 28, PEARL_WARM)
    p.sweep([(math.cos(-1.0) * 9.9, math.sin(-1.0) * 9.9, top + 12.0), (math.cos(-1.0) * 8.4, math.sin(-1.0) * 8.4, top + 16.5),
             (math.cos(-0.9) * 5.0, math.sin(-0.9) * 5.0, top + 19.8)], 0.35, 0.15, SILVER, sides=5, mat=GLOW)
    # Light spilling from the crack.
    p.box((4.0, -7.0, top + 16.0), (3.0, 0.2, 5.0), SILVER, mat=GLOW, yaw=0.5)
    # The great stair down into the water on its front.
    for k in range(10):
        p.box((0, -22.0 - k * 1.2, 1.5 - k * 0.6), (14.0, 1.4, 0.6), p.vary(PEARL, 0.03))
    waterline(p, 30.0, -4.0, 0.5, sides=40)
    return p


# ======================================================================== small props
def balustrade():
    """A 4 yd balustrade segment along a terrace edge: turned pearl balusters
    under a moulded rail (outer side toward -Y)."""
    p = P('Balustrade', lichen=0.35)
    p.box((0, 0, 0.12), (4.0, 0.7, 0.24), PEARL_SHADE, bevel=0.04)
    for k in range(6):
        x = -1.75 + k * 0.7
        p.lathe((x, 0, 0.24), [(0.16, 0), (0.24, 0.2), (0.12, 0.45), (0.2, 0.75), (0.14, 0.9)], 10,
                p.vary(PEARL, 0.03))
    p.box((0, 0, 1.2), (4.1, 0.6, 0.22), PEARL_WARM, bevel=0.05)
    for s in (-1, 1):
        p.box((s * 2.0, 0, 0.65), (0.5, 0.6, 1.3), PEARL, bevel=0.05)
    return p


def kerb():
    """A low stone kerb for rock and masonry edges (4 yd)."""
    p = P('Kerb', lichen=0.5)
    p.box((0, 0, 0.2), (4.0, 0.8, 0.4), p.vary(PEARL_SHADE), bevel=0.06)
    p.box((0.8, -0.1, 0.45), (1.2, 0.5, 0.2), PEARL, bevel=0.04)
    return p


def brazier():
    """A pale-fire brazier: a fluted pearl pedestal holding a shallow silver bowl
    of cold moonfire (the flame is the runtime's)."""
    p = P('Brazier', lichen=0.1)
    p.box((0, 0, 0.1), (1.0, 1.0, 0.2), PEARL_SHADE, bevel=0.04)
    fluted_shaft(p, 0, 0, 0.2, 1.3, 0.22, PEARL, flutes=8)
    p.lathe((0, 0, 1.3), [(0.2, 0), (0.55, 0.2), (0.75, 0.42), (0.78, 0.5)], 16, MOONSTONE)
    p.rock((0, 0, 1.55), (1.0, 1.0, 0.18), PALEFIRE, mat=GLOW, jitter=0.2, subdivisions=1)
    return p


def lamp_pillar():
    """A tall lamp pillar: a pearl column holding a moon orb in a crescent cradle."""
    p = P('LampPillar', lichen=0.25)
    p.box((0, 0, 0.3), (1.6, 1.6, 0.6), PEARL_SHADE, bevel=0.06)
    fluted_shaft(p, 0, 0, 0.6, 5.2, 0.45, PEARL, flutes=10)
    p.lathe((0, 0, 5.2), [(0.45, 0), (0.7, 0.3), (0.72, 0.4)], 16, PEARL_WARM)
    for s in (-1, 1):
        p.sweep([(0, 0, 5.6), (s * 0.8, 0, 6.2), (s * 0.7, 0, 7.2), (s * 0.3, 0, 7.6)], 0.14, 0.04, PEARL_WARM,
                sides=6)
    p.rock((0, 0, 6.6), (0.9, 0.9, 0.9), SILVER, mat=GLOW, jitter=0.02, subdivisions=2)
    return p


def wayshrine():
    """The pilgrims' way-shrine: a pearl niche holding a moon disc and offerings."""
    p = P('Wayshrine', lichen=0.4)
    p.box((0, 0, 0.3), (2.4, 1.6, 0.6), PEARL_SHADE, bevel=0.06)
    p.box((0, 0.2, 2.2), (2.0, 1.0, 3.2), PEARL, bevel=0.1)
    p.box((0, -0.32, 2.2), (1.2, 0.2, 1.8), SLATE_BLUE)
    p.prism((0, -0.4, 2.3), 18, 0.55, 0.55, 0.06, SILVER, mat=GLOW, axis=(0, 1, 0))
    p.voussoir_arch(2.0, 3.8, 0.9, 0.35, 1.0, PEARL_WARM, pointed=True, blocks=7, center=(0, 0.2, 0))
    for k in range(5):
        x = -0.8 + k * 0.4
        p.rock((x, -0.9, 0.7), (0.22, 0.22, 0.22), NACRE, jitter=0.05, subdivisions=1)
    return p


def obelisk():
    """A broken obelisk of the causeway island, silver glyphs down its faces."""
    p = P('Obelisk', lichen=0.5)
    p.box((0, 0, 0.5), (3.0, 3.0, 1.0), PEARL_SHADE, bevel=0.1)
    p.box((0, 0, 5.5), (1.8, 1.8, 9.0), PEARL, bevel=0.1, taper=0.7)
    for i in range(5):
        p.box((0, -0.82 + i * 0.02, 2.4 + i * 1.6), (0.5, 0.05, 0.6), SILVER, mat=GLOW)
    for i in range(3):
        a = p.rng.random() * math.tau
        p.spike((math.cos(a) * 0.3, math.sin(a) * 0.3, 10.0), 0.4, p.rng.uniform(0.3, 0.9), PEARL, sides=4)
    p.box((2.2, 0.6, 0.5), (1.8, 1.4, 1.0), PEARL, bevel=0.1, yaw=0.6, roll=0.3)
    waterline(p, 1.6, 0.0, 1.2)
    return p


def tidepool_basin():
    """A round basin of glowing tide water ringed in pearl."""
    p = P('TidepoolBasin', lichen=0.4)
    p.lathe((0, 0, 0), [(2.6, 0), (2.6, 0.7), (2.3, 0.8), (2.2, 0.55)], 24, PEARL)
    p.prism((0, 0, 0.55), 24, 2.2, 2.2, 0.05, CYAN, mat=GLOW)
    for k in range(6):
        a = k / 6 * math.tau
        p.rock((math.cos(a) * 1.5, math.sin(a) * 1.5, 0.62), (0.3, 0.3, 0.15), CORAL, jitter=0.2,
               subdivisions=1)
    return p


def coral_cluster():
    """Coral branches and pearls grown over a rock, pink and bioluminescent cyan."""
    p = P('CoralCluster', lichen=0.0)
    p.rock((0, 0, 0.4), (2.6, 2.2, 1.0), ROCK, jitter=0.25, subdivisions=2)
    for k in range(9):
        a = p.rng.random() * math.tau
        r = p.rng.uniform(0.2, 1.0)
        base = (math.cos(a) * r, math.sin(a) * r, 0.7)
        col = CORAL if k % 3 else CORAL_DEEP
        top = (base[0] + p.rng.uniform(-0.4, 0.4), base[1] + p.rng.uniform(-0.4, 0.4), base[2] + p.rng.uniform(1.0, 2.4))
        p.sweep([base, ((base[0] + top[0]) / 2, (base[1] + top[1]) / 2, (base[2] + top[2]) / 2 + 0.2), top], 0.16,
                0.06, col, sides=5)
        if k % 2 == 0:
            p.rock(top, (0.2, 0.2, 0.2), CYAN, mat=GLOW, jitter=0.05, subdivisions=1)
    for k in range(4):
        a = p.rng.random() * math.tau
        p.rock((math.cos(a) * 1.1, math.sin(a) * 1.1, 0.9), (0.32, 0.32, 0.32), NACRE, jitter=0.02,
               subdivisions=2)
    return p


def lily_pads():
    """A raft of lily pads with two moon-lotus flowers glowing pale."""
    p = P('LilyPads', lichen=0.0)
    for k in range(9):
        a = p.rng.random() * math.tau
        r = p.rng.uniform(0.0, 2.6)
        s = p.rng.uniform(0.5, 0.9)
        p.prism((math.cos(a) * r, math.sin(a) * r, 0.02), 10, s, s, 0.04, p.vary(LILY, 0.15))
    for k in range(2):
        a = k * 2.4
        x, y = math.cos(a) * 1.2, math.sin(a) * 1.2
        for j in range(6):
            b = j / 6 * math.tau
            p.box((x + math.cos(b) * 0.18, y + math.sin(b) * 0.18, 0.2), (0.12, 0.3, 0.25), (0.92, 0.9, 1.0),
                  mat=GLOW, yaw=b, pitch=0.5)
    return p


def reeds():
    """A clump of reeds at the water's edge."""
    p = P('Reeds', lichen=0.0)
    for k in range(16):
        a = p.rng.random() * math.tau
        r = p.rng.uniform(0.0, 1.2)
        h = p.rng.uniform(1.4, 2.8)
        x, y = math.cos(a) * r, math.sin(a) * r
        p.box((x, y, h / 2 - 0.3), (0.06, 0.06, h), p.vary(REED, 0.15), roll=p.rng.uniform(-0.15, 0.15),
              pitch=p.rng.uniform(-0.15, 0.15))
        if k % 4 == 0:
            p.box((x, y, h - 0.2), (0.12, 0.12, 0.45), (0.3, 0.24, 0.16))
    return p


def pearls():
    """A heap of giant pearls in an opened shell."""
    p = P('Pearls', lichen=0.0)
    p.lathe((0, 0, 0), [(0.2, 0), (1.3, 0.25), (1.6, 0.5)], 14, NACRE_PINK)
    for k in range(7):
        a = k / 7 * math.tau
        r = 0.7 if k else 0.0
        p.rock((math.cos(a) * r, math.sin(a) * r, 0.55), (0.45, 0.45, 0.45), NACRE, jitter=0.01,
               subdivisions=2)
    return p


def ward_arch():
    """A slim pearl arch framing a warded passage (the Court Stairs, the Prism
    Ward, the Altar Ward), 9 yd, a moon crescent at its crown."""
    p = P('WardArch', lichen=0.25)
    for s in (-1, 1):
        p.box((s * 6.3, 0, 3.5), (1.4, 1.6, 7.0), p.vary(PEARL), bevel=0.1)
        p.box((s * 6.3, 0, 0.3), (1.9, 2.1, 0.6), PEARL_SHADE, bevel=0.08)
    p.voussoir_arch(12.6, 7.0, 3.2, 0.9, 1.5, PEARL_WARM, pointed=True, blocks=13)
    p.sweep([(-0.9, -0.8, 10.6), (0.0, -0.8, 11.4), (0.9, -0.8, 10.6)], 0.2, 0.05, SILVER, sides=5)
    return p


def veil_arch():
    """The Choir Veil's arch: a tall pearl portal over the Choir Stair, a lip of
    carved water-channels across its crown where the curtain falls from."""
    p = P('VeilArch', lichen=0.4)
    for s in (-1, 1):
        p.box((s * 7.8, 0, 6.0), (2.2, 2.4, 14.0), p.vary(PEARL), bevel=0.12)
        fluted_shaft(p, s * 7.8, -1.5, -1.0, 12.0, 0.7, PEARL, flutes=8)
    p.box((0, 0, 13.6), (18.0, 2.6, 1.6), PEARL_WARM, bevel=0.12)
    for k in range(9):
        x = -6.4 + k * 1.6
        p.box((x, -1.2, 12.8), (0.6, 0.6, 0.4), SLATE_BLUE)
    p.lathe((0, 0, 14.4), [(1.4, 0), (1.6, 0.6), (0.0, 2.2)], 16, PEARL_WARM)
    p.prism((0, -1.0, 15.2), 16, 0.8, 0.8, 0.05, GOLD, mat=GLOW, axis=(0, 1, 0))
    return p


def crater_spire():
    """A crag of the crater rim (dressing on the rim ring)."""
    p = P('CraterSpire', lichen=0.3, weather=0.8)
    p.rock((0, 0, 6.0), (9.0, 7.0, 16.0), ROCK, jitter=0.28, subdivisions=2, flat_bottom=True)
    p.rock((3.0, 1.0, 13.0), (4.0, 3.5, 9.0), ROCK_DARK, jitter=0.3, subdivisions=1)
    p.rock((-3.0, -1.0, 2.0), (5.0, 4.0, 5.0), ROCK, jitter=0.3, subdivisions=1)
    return p


def shells():
    """Giant scallop shells half sunk in the shallows."""
    p = P('Shells', lichen=0.0)
    for k in range(3):
        a = k * 2.1
        mark = p.mark()
        for j in range(9):
            b = -1.0 + j / 8 * 2.0
            p.box((math.sin(b) * 0.8, math.cos(b) * 0.8 - 0.4, 0.05), (0.28, 1.6, 0.12), p.vary(NACRE_PINK, 0.06),
                  yaw=-b)
        p.turn(mark, Matrix.Translation((math.cos(a) * 1.4, math.sin(a) * 1.4, 0.2)) @ Matrix.Rotation(a, 4, 'Z')
               @ Matrix.Rotation(0.4, 4, 'X'))
    return p


BUILDERS = [
    column, column_broken, column_fallen,
    lambda: statue('StatueSinger', 'sing'), lambda: statue('StatuePraying', 'pray'),
    lambda: statue('StatueConch', 'conch'), statue_fallen, ruined_arch, moongate, great_conch,
    amphi_tier, prism_tower, prism_plinth, moon_altar, standing_stone, sunken_temple,
    balustrade, kerb, brazier, lamp_pillar, wayshrine, obelisk, tidepool_basin, coral_cluster,
    lily_pads, reeds, pearls, ward_arch, veil_arch, crater_spire, shells,
]


def build_temple_kit(root_name, builders):
    """hckit.build_kit with this kit's material names (stone, glow, glass)."""
    import bpy
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
        print(f'PIECE {obj.name} triangles {tris} size {[round(d, 1) for d in obj.dimensions]}')
    print('KIT_TRIANGLES', total)
    return parts


def layout_preview(parts):
    x = 0.0
    row = 0.0
    width = 0.0
    for obj in parts:
        d = obj.dimensions
        if x > 150:
            x = 0.0
            row += width + 8
            width = 0.0
        obj.location = (x + d.x / 2, row, 0)
        x += d.x + 6
        width = max(width, d.y)


def render_preview(path):
    import bpy
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1100
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (80, -170, 110)
    cam.rotation_euler = (math.radians(55), 0, 0)
    cam_data.lens = 24
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    save = argv[argv.index('--save') + 1] if '--save' in argv else None
    parts = build_temple_kit('DrownedTempleKit_ROOT', BUILDERS)
    out = os.path.join(HERE, 'drowned_temple_kit_components.glb')
    export_kit(out)
    if save or preview:
        layout_preview(parts)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)
    if preview:
        render_preview(preview)


if __name__ == '__main__':
    main()
