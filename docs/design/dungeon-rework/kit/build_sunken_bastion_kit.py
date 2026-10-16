"""The Sunken Bastion kit: every piece of the open-air sea fortress.

Run (background, one scene):
  blender -b --factory-startup --python build_sunken_bastion_kit.py -- [--preview out.png] [--save out.blend]

Writes sunken_bastion_kit_components.glb next to this file; the shipping build
(scripts/assets/sunken_bastion_kit/build.mjs) validates, fingerprints and meshopts
it into public/models/props/sunken_bastion_kit.glb.

Pieces are named Kit_* (the runtime bakes each by name, see
src/render/sunken_bastion/bastion_kit.ts). Game yards, +Z up, front -Y (the
game's +Z after the glTF export). Shared modelling helpers: hckit.py (the
Hollow Crypt kit's library; this kit adds its sea palette and a glass slot).

Palette (docs/design/dungeon-rework/sunken_bastion.md, "Environment"): wet
slate and weathered limestone for the fortress; barnacle bone, algae green and
rust iron for detail; the beacon's warm white is the only warm light.
"""
import math
import os
import sys

from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hckit  # noqa: E402
from hckit import GLOW, IRON, STONE, TIMBER, Piece, export_kit  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

# The third slot of this kit is glass and water (hckit's SILK index).
GLASS = hckit.SILK

# ---- the sea fortress palette (sRGB) ------------------------------------------
LIME = (0.66, 0.64, 0.56)          # weathered limestone #A9A38F
LIME_PALE = (0.76, 0.74, 0.66)
LIME_DARK = (0.5, 0.5, 0.45)
SLATE = (0.24, 0.29, 0.3)          # wet slate #3E4A4C
SLATE_ROOF = (0.2, 0.23, 0.26)
BARNACLE = (0.81, 0.78, 0.69)      # barnacle bone #CFC6B0
ALGAE = (0.37, 0.5, 0.31)          # algae green #5E7F4E
WEED = (0.22, 0.28, 0.16)
KELP = (0.24, 0.2, 0.11)
RUST = (0.48, 0.29, 0.18)          # rust iron #7A4A2E
IRON_WET = (0.19, 0.2, 0.2)
WOOD = (0.36, 0.28, 0.2)
WOOD_DARK = (0.22, 0.17, 0.12)
WOOD_BLEACH = (0.55, 0.5, 0.42)
SAIL = (0.62, 0.58, 0.48)
ROCK = (0.34, 0.35, 0.34)
ROCK_DARK = (0.2, 0.21, 0.21)
MUD = (0.2, 0.18, 0.14)
BEACON = (1.0, 0.91, 0.72)         # beacon warm white #FFE9B8 (as light)
FOGFIRE = (0.62, 0.88, 0.69)       # Vael's fog green #9FE0B0
EMBER = (1.0, 0.55, 0.22)
LANTERN = (1.0, 0.8, 0.5)
WATER = (0.14, 0.24, 0.23)
GLASS_TINT = (0.72, 0.8, 0.74)
CLOTH_COURT = (0.2, 0.3, 0.42)     # the Gleaming Court's faded sea-blue


def P(name, **kw):
    return Piece('Kit_' + name, **kw)


def barnacle_crust(p, x0, x1, y, z0, z1, density=1.0, face=-1):
    """Barnacles and mussels crusted on a face between z0 and z1 (face -1 = -Y)."""
    n = int(abs(x1 - x0) * (z1 - z0) * 3 * density)
    for _ in range(n):
        x = p.rng.uniform(x0, x1)
        z = z0 + (z1 - z0) * (p.rng.random() ** 1.6)
        r = p.rng.uniform(0.05, 0.13)
        if p.rng.random() < 0.3:
            p.box((x, y + face * r * 0.4, z), (r * 2.4, r * 1.2, r * 1.2), (0.12, 0.13, 0.16),
                  yaw=p.rng.random() * 3, roll=p.rng.random() * 3)
        else:
            p.prism((x, y + face * 0.01, z), 5, r, r * 0.45, r * 0.9, p.vary(BARNACLE, 0.1),
                    axis=(0, face, 0))


def weed_fringe(p, x0, x1, y, z, length=0.6, density=1.0, face=-1):
    """Weed and kelp hanging off a ledge at height z."""
    n = int(abs(x1 - x0) * 2.2 * density)
    for _ in range(n):
        x = p.rng.uniform(x0, x1)
        ln = length * p.rng.uniform(0.5, 1.3)
        p.box((x, y + face * 0.04, z - ln / 2), (p.rng.uniform(0.08, 0.2), 0.04, ln),
              p.vary(WEED if p.rng.random() < 0.6 else ALGAE, 0.15))


# =============================================================== edge dressing
def parapet():
    """A 4 yd crenellated sea-wall parapet; its sea face (-Y) wears the salt."""
    p = P('Parapet', lichen=0.5)
    p.masonry(-2.0, 2.0, 0.0, 1.0, 0.95, 0.5, LIME, y=0.0, bevel=True, spread=0.08)
    for x in (-1.05, 1.05):
        p.masonry(x - 0.6, x + 0.6, 1.0, 2.0, 0.95, 0.5, LIME, bevel=True, spread=0.08)
        p.box((x, 0, 2.05), (1.3, 1.05, 0.14), p.vary(LIME_PALE), bevel=0.04)
    p.box((0, 0, 1.03), (4.02, 1.05, 0.1), p.vary(LIME_PALE), bevel=0.03)
    # Salt streaks and algae on the sea face, darker at its foot.
    for x in (-1.6, -0.2, 0.9, 1.7):
        p.box((x + p.rng.uniform(-0.2, 0.2), -0.49, 0.45), (0.12, 0.03, 0.8), p.vary(ALGAE, 0.1))
    return p


def quay_rail():
    """A 4 yd quay rail: two stone posts and heavy iron chains sagging between."""
    p = P('QuayRail', lichen=0.4)
    for x in (-1.8, 1.8):
        p.box((x, 0, 0.55), (0.42, 0.42, 1.1), p.vary(LIME), bevel=0.06)
        p.lathe((x, 0, 1.1), [(0.24, 0), (0.27, 0.08), (0.12, 0.2), (0.0, 0.26)], 8, LIME_PALE)
        p.prism((x, -0.21, 0.9), 8, 0.08, 0.08, 0.04, RUST, axis=(0, -1, 0))
    for hgt in (0.95, 0.55):
        pts = []
        for i in range(17):
            t = i / 16
            x = -1.8 + 3.6 * t
            sag = math.sin(math.pi * t) * (0.28 if hgt > 0.9 else 0.22)
            pts.append((x, 0, hgt - sag))
        for i in range(len(pts) - 1):
            a, b = Vector(pts[i]), Vector(pts[i + 1])
            m = (a + b) / 2
            p.box(tuple(m), ((b - a).length * 0.9, 0.05, 0.1), IRON_WET,
                  roll=-math.atan2(b.z - a.z, b.x - a.x), yaw=(i % 2) * 1.57 * 0)
    return p


def shore_rocks():
    """Barnacled boulders at a raw rock lip, weed trailing into the drop."""
    p = P('ShoreRocks', lichen=0.1)
    for i in range(5):
        x = -1.8 + i * 0.9 + p.rng.uniform(-0.2, 0.2)
        s = p.rng.uniform(0.7, 1.3)
        p.rock((x, p.rng.uniform(-0.3, 0.3), s * 0.35), (s * 1.4, s * 1.2, s * 0.9),
               p.vary(ROCK, 0.12), jitter=0.28, subdivisions=1, flat_bottom=True)
    barnacle_crust(p, -2.0, 2.0, -0.7, 0.0, 0.5, density=1.5)
    weed_fringe(p, -2.0, 2.0, -0.8, 0.2, 0.5)
    return p


# =============================================================== walls and gates
def curtain_wall(broken=False):
    """A 6 yd curtain wall module, 11 tall on a battered plinth. Its sea face
    (-Y) carries arrow slits, salt streaks and a barnacle crust at the foot; the
    plinth runs 2.6 below its origin to meet the flats under it."""
    p = P('CurtainWallBroken' if broken else 'CurtainWall', lichen=0.45)
    half = 3.0
    # Battered plinth (wider at the foot).
    for i, (z0, z1, d) in enumerate(((-2.6, -1.0, 3.4), (-1.0, 0.6, 3.1), (0.6, 1.6, 2.85))):
        p.masonry(-half, half, z0, z1, d, 0.8, SLATE if i == 0 else LIME_DARK, spread=0.06)
    top = 8.2 if broken else 10.0
    p.masonry(-half, half, 1.6, top, 2.6, 1.05, LIME, ruin=0.35 if broken else 0.0, spread=0.07)
    if not broken:
        # Wall-walk coping and merlons on the sea side, a low lip on the bailey side.
        p.box((0, 0, 10.1), (6.02, 2.7, 0.2), p.vary(LIME_PALE), bevel=0.04)
        for x in (-2.1, 0.0, 2.1):
            p.masonry(x - 0.65, x + 0.65, 10.2, 11.4, 0.7, 0.6, LIME, y=-0.95, spread=0.07)
            p.box((x, -0.95, 11.46), (1.4, 0.8, 0.14), p.vary(LIME_PALE), bevel=0.03)
        p.box((0, 1.05, 10.55), (6.0, 0.45, 0.7), p.vary(LIME), bevel=0.04)
        # Arrow slits.
        for x in (-1.5, 1.5):
            p.box((x, -1.31, 6.4), (0.24, 0.08, 1.6), (0.04, 0.04, 0.05))
            p.box((x, -1.31, 6.4), (0.7, 0.06, 0.24), (0.04, 0.04, 0.05))
    else:
        for i in range(9):
            p.box((p.rng.uniform(-2.5, 2.5), p.rng.uniform(-1.8, 1.8), top + 0.3 + p.rng.random() * 0.6),
                  (p.rng.uniform(0.5, 1.2), p.rng.uniform(0.4, 0.9), p.rng.uniform(0.3, 0.6)),
                  p.vary(LIME), yaw=p.rng.random() * 3, bevel=0.06)
    barnacle_crust(p, -half, half, -1.72, -2.4, 0.4, density=1.2)
    weed_fringe(p, -half, half, -1.75, 0.3, 0.9)
    return p


def drum_tower(p, cx, cy, r, h, roof=True, slits=4, base=-2.5):
    """A round drum tower of coursed stone blocks (every course offset half a
    block, a battered foot of wet slate) with a machicolated parapet and a
    crenellated or slate-roofed top, standing at (cx, cy)."""
    course = 0.85
    rows = max(4, int((h - base) / course))
    for i in range(rows):
        z0 = base + (h - base) * i / rows
        ch = (h - base) / rows
        rr = r * (1.1 - 0.1 * min(1.0, max(0.0, (z0 - base) / 2.5)))
        n = max(10, int(round(math.tau * rr / 1.35)))
        off = (i % 2) * 0.5
        col = SLATE if z0 < 0.6 else LIME
        for k in range(n):
            a = (k + off) / n * math.tau + p.rng.uniform(-0.02, 0.02)
            w = math.tau * rr / n * p.rng.uniform(0.9, 1.0)
            d = rr * 0.18
            push = p.rng.uniform(-0.03, 0.05)
            p.box((cx + math.cos(a) * (rr - d / 2 + push), cy + math.sin(a) * (rr - d / 2 + push), z0 + ch / 2),
                  (w - 0.06, d, ch - 0.06), p.vary(col, 0.07), yaw=a + math.pi / 2,
                  bevel=0.05 if z0 < 5.0 else 0.0)
        # The core behind the blocks (no gaps to see through).
        p.lathe((cx, cy, z0), [(rr * 0.84, 0), (rr * 0.84, ch)], 12, (0.08, 0.08, 0.08))
    # Machicolation ring: corbels under an overhanging parapet.
    for k in range(18):
        a = k / 18 * math.tau
        p.box((cx + math.cos(a) * (r + 0.25), cy + math.sin(a) * (r + 0.25), h - 0.6), (0.5, 0.5, 0.9),
              p.vary(LIME_DARK), yaw=a, bevel=0.04)
    p.lathe((cx, cy, h), [(r + 0.55, 0), (r + 0.55, 0.9), (r + 0.4, 1.0), (0.0, 1.0)], 24, LIME_PALE)
    if roof:
        p.lathe((cx, cy, h + 1.0), [(r + 0.2, 0), (r * 0.6, 2.8), (0.12, 6.6), (0.0, 6.8)], 16, SLATE_ROOF,
                smooth=False)
        p.lathe((cx, cy, h + 7.6), [(0.08, 0), (0.08, 1.4), (0.0, 1.5)], 6, IRON_WET)
        # A torn Court pennant.
        p.box((cx + 0.45, cy, h + 8.6), (0.8, 0.03, 0.45), CLOTH_COURT)
    else:
        for k in range(10):
            a = k / 10 * math.tau
            p.box((cx + math.cos(a) * (r + 0.3), cy + math.sin(a) * (r + 0.3), h + 1.6), (1.0, 0.55, 1.2),
                  p.vary(LIME), yaw=a + math.pi / 2, bevel=0.05)
    for k in range(slits):
        a = k / slits * math.tau + 0.4
        for z in (h * 0.45, h * 0.75):
            p.box((cx + math.cos(a) * (r + 0.02), cy + math.sin(a) * (r + 0.02), z), (0.2, 0.2, 1.3),
                  (0.03, 0.03, 0.04), yaw=a)
    # Salt and weed round the drowned foot.
    for k in range(int(r * 6)):
        a = p.rng.random() * math.tau
        z = p.rng.uniform(base + 0.2, 1.4)
        p.prism((cx + math.cos(a) * r * 1.12, cy + math.sin(a) * r * 1.12, z), 5, 0.09, 0.04, 0.12,
                p.vary(BARNACLE, 0.1), axis=(math.cos(a), math.sin(a), 0))


def sea_gate():
    """HERO: the Sea Gate. Two drum towers either side of a gate block spanning
    the ramp (a 15 yd arch the portcullis rises into), the Gleaming Court's sun
    on the keystone. Towers at +-12.4 (their colliders), sea face -Y."""
    p = P('SeaGate', lichen=0.45)
    for side in (-1, 1):
        drum_tower(p, side * 12.4, 0.0, 4.3, 17.0, roof=True, slits=5)
    # The gate block: two thick jambs and a lintel mass over the arch.
    for side in (-1, 1):
        p.masonry(side * 7.9 - 1.0, side * 7.9 + 1.0, -2.5, 14.0, 5.0, 0.8, LIME, spread=0.06)
    p.masonry(-8.9, 8.9, 10.2, 15.5, 5.0, 0.75, LIME, spread=0.06)
    # The arch ring (voussoirs) on both faces.
    for y in (-2.55, 2.55):
        m = p.mark()
        p.voussoir_arch(15.4, 6.0, 4.4, 0.9, 0.6, LIME_PALE, pointed=False, blocks=15)
        p.turn(m, Matrix.Translation((0, y, 0)))
    # Crenellated top with a covered hoarding over the gate.
    p.box((0, 0, 15.6), (18.0, 5.4, 0.3), p.vary(LIME_PALE), bevel=0.05)
    for x in range(-8, 9, 2):
        p.masonry(x - 0.55, x + 0.55, 15.7, 16.9, 0.7, 0.6, LIME, y=-2.35, spread=0.05)
    p.box((0, 2.2, 16.6), (18.0, 0.8, 1.8), p.vary(LIME), bevel=0.05)
    # The Court's sun on the keystone: a stone disc and rays, salt-bleached.
    p.prism((0, -2.9, 11.6), 16, 1.1, 1.1, 0.25, BARNACLE, axis=(0, -1, 0))
    for k in range(12):
        a = k / 12 * math.tau
        p.box((math.cos(a) * 1.7, -2.85, 11.6 + math.sin(a) * 1.7), (0.7, 0.18, 0.22), BARNACLE,
              roll=-a)
    # The portcullis slot and its chains' pulleys up in the block.
    p.box((0, 0, 10.6), (15.2, 0.6, 0.4), (0.05, 0.05, 0.06))
    for side in (-1, 1):
        p.lathe((side * 6.0, 0.8, 13.6), [(0.5, 0), (0.5, 0.4), (0.0, 0.42)], 10, IRON_WET)
    # Barnacles on the drowned sea face of the jambs.
    for side in (-1, 1):
        barnacle_crust(p, side * 7.9 - 1.0, side * 7.9 + 1.0, -2.55, -2.4, 1.0, density=1.4)
    weed_fringe(p, -8.9, 8.9, -2.6, 0.9, 1.0)
    return p


def gatehouse_arch():
    """A gatehouse arch over a 12.6 yd passage, its piers at +-6.7 running 12
    yards down below the origin into the rock or the cliff under it."""
    p = P('GatehouseArch', lichen=0.45)
    for side in (-1, 1):
        p.masonry(side * 6.7 - 1.25, side * 6.7 + 1.25, -12.0, 11.0, 2.6, 0.8, LIME, spread=0.06)
        p.box((side * 6.7, 0, 11.1), (2.8, 2.9, 0.3), p.vary(LIME_PALE), bevel=0.05)
    m = p.mark()
    p.voussoir_arch(10.9, 7.0, 3.2, 0.9, 2.4, LIME_PALE, pointed=True, blocks=13)
    p.turn(m, Matrix.Translation((0, 0, 0)))
    p.masonry(-5.5, 5.5, 9.4, 11.0, 2.4, 0.8, LIME, spread=0.06)
    p.box((0, 0, 11.1), (13.4, 2.6, 0.25), p.vary(LIME_PALE), bevel=0.05)
    for x in (-5.0, -2.5, 0.0, 2.5, 5.0):
        p.masonry(x - 0.5, x + 0.5, 11.2, 12.3, 0.6, 0.55, LIME, y=-1.0, spread=0.05)
    return p


def rock_arch():
    """A rough arch of fallen rock and old masonry over a cleft passage 17 wide,
    the grate's iron runners bolted to its face."""
    p = P('RockArch', lichen=0.2)
    for side in (-1, 1):
        for i in range(6):
            z = -4.0 + i * 2.8
            p.rock((side * (9.6 + p.rng.uniform(-0.6, 0.6)), p.rng.uniform(-0.6, 0.6), z),
                   (3.8, 4.2, 3.6), p.vary((0.46, 0.45, 0.4), 0.1), jitter=0.22, subdivisions=2)
        p.box((side * 8.7, -1.9, 4.5), (0.3, 0.3, 9.0), RUST)
    for i in range(9):
        a = math.pi * i / 8
        p.rock((math.cos(a) * 9.4, p.rng.uniform(-0.4, 0.4), 11.0 + math.sin(a) * 4.0),
               (3.6, 4.0, 3.0), p.vary((0.4, 0.4, 0.36) if i % 2 else (0.5, 0.49, 0.43), 0.1), jitter=0.25,
               subdivisions=2)
    p.masonry(-4.0, 4.0, 11.5, 13.0, 1.4, 0.7, LIME_DARK, y=-1.6, ruin=0.4, spread=0.08)
    weed_fringe(p, -8.0, 8.0, -2.0, 10.5, 1.4, 0.6)
    return p


def bartizan():
    """A round bartizan corbelled out over the sea off a tower's rim: origin on
    the rim at the floor, body hanging out along -Y (the sea)."""
    p = P('Bartizan', lichen=0.4)
    cy = -1.9
    for i in range(5):
        r = 0.6 + i * 0.35
        p.lathe((0, cy, -3.4 + i * 0.7), [(r, 0), (r + 0.3, 0.7)], 14, p.vary(LIME_DARK, 0.05))
    p.lathe((0, cy, 0.0), [(2.1, 0), (2.1, 5.2), (2.25, 5.4), (2.25, 6.0)], 16, LIME)
    for k in range(6):
        a = k / 6 * math.tau
        p.box((math.cos(a) * 2.12, cy + math.sin(a) * 2.12, 3.0), (0.16, 0.16, 1.0), (0.03, 0.03, 0.04), yaw=a)
    p.lathe((0, cy, 6.0), [(2.4, 0), (1.3, 2.2), (0.1, 4.8), (0, 5.0)], 12, SLATE_ROOF, smooth=False)
    p.lathe((0, cy, 11.0), [(0.07, 0), (0.07, 1.2), (0, 1.3)], 6, IRON_WET)
    # A tattered Court banner hanging off its landward side.
    p.box((0, cy + 2.2, 3.4), (1.1, 0.04, 2.6), CLOTH_COURT)
    p.box((0, cy + 2.22, 2.0), (1.1, 0.04, 0.3), p.vary(CLOTH_COURT, 0.2))
    return p


# =============================================================== the keep
def keep():
    """HERO: the Bastion's keep behind its court. A great hall 30 long with two
    drum towers and a tall square donjon, lancet windows lit by Vael's fog-fire,
    slate roofs; front (-Y) on the court. Origin at its foot on the rock."""
    p = P('Keep', lichen=0.5)
    # Rock plinth it stands on.
    for i in range(7):
        p.rock((p.rng.uniform(-15, 15), p.rng.uniform(-6, 6), -2.0), (12, 10, 7), p.vary(ROCK, 0.1),
               jitter=0.25, subdivisions=2)
    # The great hall.
    p.masonry(-15.0, 15.0, 0.0, 16.0, 14.0, 1.1, LIME, spread=0.07, bevel=False)
    # Buttresses along the court face.
    for x in (-10.5, -3.5, 3.5, 10.5):
        p.masonry(x - 0.9, x + 0.9, 0.0, 13.0, 1.8, 0.9, LIME_DARK, y=-7.6, spread=0.06)
        p.box((x, -8.0, 13.2), (1.6, 1.0, 1.2), p.vary(LIME_PALE), pitch=0.5, bevel=0.05)
    # Tall lancet windows between them, faint fog-fire behind the tracery.
    for x in (-7.0, 0.0, 7.0):
        p.box((x, -7.02, 8.0), (2.2, 0.12, 7.0), (0.04, 0.05, 0.05))
        p.box((x, -6.98, 7.4), (1.7, 0.05, 5.8), FOGFIRE, mat=GLOW)
        p.box((x, -7.08, 8.0), (0.16, 0.1, 7.0), LIME_PALE)
        p.voussoir_arch(2.4, 11.2, 1.4, 0.35, 0.4, LIME_PALE, pointed=True, blocks=7, center=(x, -7.1, 0))
    # Slate roof over the hall.
    for side in (-1, 1):
        p.box((0, side * 3.6, 19.2), (30.6, 8.2, 0.5), SLATE_ROOF, pitch=side * -0.72)
    p.box((0, 0, 22.0), (30.6, 0.5, 0.5), IRON_WET)
    # Two drum towers at the hall's ends.
    for side in (-1, 1):
        drum_tower(p, side * 16.5, -3.0, 5.0, 26.0, roof=True, slits=6, base=-1.0)
    # The donjon: a tall square tower rising behind the hall's centre.
    p.masonry(-5.0, 5.0, 0.0, 34.0, 10.0, 1.1, LIME_DARK, y=4.0, spread=0.06, bevel=False)
    p.box((0, 4.0, 34.2), (11.0, 11.0, 0.4), p.vary(LIME_PALE), bevel=0.05)
    for k in range(4):
        m = p.mark()
        for x in (-4.0, -1.35, 1.35, 4.0):
            p.masonry(x - 0.55, x + 0.55, 34.4, 35.8, 0.8, 0.7, LIME, y=-5.2, spread=0.05)
        p.box((0, -5.05, 27.0), (1.0, 0.1, 3.2), FOGFIRE, mat=GLOW)
        p.turn(m, Matrix.Translation((0, 4.0, 0)) @ Matrix.Rotation(k * math.pi / 2, 4, 'Z'))
    # The great door on the court face.
    p.box((0, -7.1, 2.8), (3.6, 0.2, 5.6), WOOD_DARK)
    p.voussoir_arch(4.0, 5.2, 1.8, 0.5, 0.6, LIME_PALE, pointed=True, blocks=9, center=(0, -7.2, 0))
    for z in (1.2, 3.6):
        p.box((0, -7.25, z), (3.4, 0.08, 0.16), RUST)
    # Fog-fire stains weeping down from the high windows.
    for x in (-7.0, 0.0, 7.0):
        p.box((x + 0.3, -7.05, 3.0), (0.3, 0.03, 4.0), p.vary((0.3, 0.42, 0.34), 0.1))
    return p


# =============================================================== bailey
def drowned_chapel():
    """HERO: the Drowned Chapel on its island. A roofless nave (16 x 24) of
    sea-worn stone: broken roof ribs arching overhead, tall lancets, a bell-cote
    on the south gable with its bell gone green, a collapsed corner and weed
    hanging from every sill. Long axis along Y (the game's Z)."""
    p = P('DrownedChapel', lichen=0.6)
    hw, hd = 7.6, 11.6
    wall = 1.0
    # Side walls with lancets (ruined toward the north-east corner).
    for side in (-1, 1):
        m = p.mark()
        p.masonry(-hd, hd, 0.0, 12.0, wall, 1.0, LIME, ruin=0.25 if side > 0 else 0.1, spread=0.08,
                  bevel=False)
        p.turn(m, Matrix.Translation((side * hw, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
        for y in (-6.5, 0.0, 6.5):
            p.box((side * (hw + 0.02), y, 6.2), (0.3, 1.8, 5.2), (0.04, 0.05, 0.05))
    # Gables (south with the door and bell-cote, north broken).
    for gy, broken in ((-hd, False), (hd, True)):
        p.masonry(-hw - 0.5, hw + 0.5, 0.0, 12.0, wall, 1.0, LIME, y=gy, ruin=0.45 if broken else 0.0,
                  spread=0.08, bevel=False)
        if not broken:
            for k in range(6):
                t = k / 6
                w = (hw + 0.5) * (1 - t)
                p.masonry(-w, w, 12.0 + k * 1.0, 13.0 + k * 1.0, wall, 0.85, LIME, y=gy, spread=0.08)
    # The south door: a pointed arch and a drowned oak door, half open.
    p.box((0, -hd - 0.05, 2.6), (3.2, 0.3, 5.2), (0.04, 0.04, 0.05))
    p.voussoir_arch(3.6, 5.0, 1.8, 0.5, 1.3, LIME_PALE, pointed=True, blocks=9, center=(0, -hd, 0))
    p.box((-1.2, -hd - 0.9, 2.5), (1.5, 0.15, 5.0), WOOD_DARK, yaw=0.7)
    # The rose window over it, its tracery broken.
    p.prism((0, -hd - 0.52, 9.6), 16, 1.9, 1.9, 0.12, (0.04, 0.05, 0.05), axis=(0, -1, 0))
    for k in range(8):
        a = k / 8 * math.tau
        p.box((math.cos(a) * 0.95, -hd - 0.58, 9.6 + math.sin(a) * 0.95), (1.9, 0.16, 0.16), LIME_PALE,
              roll=-a)
    # The bell-cote and its green bronze bell.
    p.masonry(-1.4, 1.4, 17.8, 21.0, 1.1, 0.7, LIME_PALE, y=-hd, spread=0.05)
    p.box((0, -hd, 19.3), (1.4, 1.2, 2.0), (0.03, 0.03, 0.04))
    p.lathe((0, -hd, 18.6), [(0.6, 0), (0.62, 0.1), (0.45, 0.6), (0.3, 1.1), (0.0, 1.2)], 14, (0.33, 0.47, 0.4))
    p.prism((0, -hd, 21.0), 4, 1.9, 0.1, 2.0, SLATE_ROOF, phase=math.pi / 4)
    # Broken roof ribs arching across the nave (stone), three still whole.
    for y in (-8.0, -3.0, 2.0, 7.0):
        whole = y < 5
        m = p.mark()
        p.voussoir_arch(2 * hw, 11.5, 5.5, 0.55, 0.7, LIME_PALE, pointed=True, blocks=13,
                        broken=0.0 if whole else 0.45)
        p.turn(m, Matrix.Translation((0, y, 0)))
    # Fallen ribs and roof slates in the nave.
    for i in range(10):
        p.box((p.rng.uniform(-5, 5), p.rng.uniform(-9, 9), 0.3), (p.rng.uniform(0.8, 2.2), 0.6, 0.5),
              p.vary(LIME, 0.1), yaw=p.rng.random() * 3, bevel=0.06)
    for i in range(14):
        p.box((p.rng.uniform(-6, 6), p.rng.uniform(-10, 10), 0.08), (0.7, 0.45, 0.06), SLATE_ROOF,
              yaw=p.rng.random() * 3, pitch=p.rng.uniform(-0.2, 0.2))
    # The altar and a drowned saint in the apse wall niche.
    p.box((0, hd - 2.2, 0.6), (3.4, 1.4, 1.2), p.vary(LIME_PALE), bevel=0.08)
    # Barnacles and weed at the foot all round.
    for side in (-1, 1):
        m = p.mark()
        barnacle_crust(p, -hd, hd, -0.52, 0.0, 1.2, density=0.8)
        p.turn(m, Matrix.Translation((side * hw, 0, 0)) @ Matrix.Rotation(side * math.pi / 2, 4, 'Z'))
    return p


def cistern():
    """The east yard's round cistern: a stone drum brim-full of rainwater, a
    pump frame over it."""
    p = P('Cistern', lichen=0.5)
    p.lathe((0, 0, 0), [(4.2, 0), (4.2, 1.9), (4.45, 2.0), (4.45, 2.25), (3.7, 2.25), (3.7, 2.0)], 24, LIME)
    p.prism((0, 0, 1.75), 24, 3.7, 3.7, 0.05, WATER, mat=GLASS)
    for x in (-2.8, 2.8):
        p.box((x, 0, 3.3), (0.35, 0.35, 2.4), WOOD, bevel=0.03)
    p.box((0, 0, 4.5), (6.0, 0.3, 0.3), WOOD, bevel=0.03)
    p.lathe((0, 0, 4.0), [(0.3, 0), (0.3, 0.8), (0.0, 0.82)], 8, IRON_WET)
    barnacle_crust(p, -3.0, 3.0, -4.25, 0.0, 0.9, density=0.8)
    return p


def cargo_stack():
    """Salvaged cargo on the bailey: crates, barrels and a coiled hawser."""
    p = P('CargoStack', lichen=0.2)
    for x, y, z, s in ((-1.3, 0.2, 0.55, 1.1), (0.0, -0.1, 0.55, 1.1), (-0.7, 0.1, 1.65, 1.0)):
        p.box((x, y, z), (s, s, s), p.vary(WOOD, 0.08), bevel=0.05, yaw=p.rng.uniform(-0.2, 0.2))
        p.box((x, y - s / 2 - 0.01, z), (s * 0.95, 0.02, 0.12), WOOD_DARK)
    for x in (1.2, 1.9):
        p.lathe((x, 0.6, 0), [(0.4, 0), (0.46, 0.45), (0.4, 0.9)], 12, p.vary(WOOD, 0.08))
        p.lathe((x, 0.6, 0.18), [(0.47, 0), (0.47, 0.06)], 12, RUST)
        p.lathe((x, 0.6, 0.66), [(0.47, 0), (0.47, 0.06)], 12, RUST)
    for k in range(3):
        p.lathe((1.4, -0.9, 0.08 + k * 0.14), [(0.55, 0), (0.55, 0.12), (0.3, 0.12), (0.3, 0)], 14,
                (0.5, 0.42, 0.3))
    return p


def anchor():
    """A great iron anchor half-sunk in the bailey stones, its chain trailing."""
    p = P('Anchor', lichen=0.1)
    p.box((0, 0, 1.5), (0.35, 0.35, 3.2), RUST, bevel=0.04, roll=0.35)
    p.box((0.5, 0, 3.0), (1.8, 0.3, 0.3), RUST, bevel=0.03, roll=0.35)
    arc = p.bezier((-1.6, 0, 0.2), (0.0, 0, -0.9), (1.6, 0, 0.3), steps=8)
    p.sweep(arc, 0.18, 0.18, RUST, sides=6)
    for end in (arc[0], arc[-1]):
        p.spike(tuple(end), 0.3, 0.6, RUST, sides=4)
    p.lathe((-0.6, 0, 3.4), [(0.35, 0), (0.35, 0.1)], 10, RUST)
    for k in range(8):
        p.box((-0.9 - k * 0.3, 0.3 * math.sin(k), 0.1), (0.3, 0.1, 0.18), IRON_WET, yaw=(k % 2) * 1.57)
    return p


def cannon():
    """An iron cannon on a salt-grey carriage, pointed out to sea (-Y)."""
    p = P('Cannon', lichen=0.1)
    p.box((0, 0, 0.35), (1.3, 2.6, 0.45), WOOD_BLEACH, bevel=0.05)
    for x in (-0.55, 0.55):
        for y in (-0.9, 0.9):
            p.lathe((x, y, 0.32), [(0.32, 0), (0.32, 0.12)], 10, WOOD_DARK)
    m = p.mark()
    p.lathe((0, 0.3, 0.9), [(0.34, 0), (0.3, 0.6), (0.24, 2.3), (0.3, 2.4), (0.0, 2.45)], 12, IRON_WET)
    p.turn(m, Matrix.Translation((0, 0.3, 0.9)) @ Matrix.Rotation(math.pi / 2 + 0.08, 4, 'X')
           @ Matrix.Translation((0, -0.3, -0.9)))
    p.lathe((0, 1.2, 0.9), [(0.36, 0), (0.0, 0.3)], 10, IRON_WET)
    return p


def buttress(state='intact'):
    """Olen's buttresses on the Breach Bastion rim: a stepped stone mass 4.8
    square and 11 tall, battered at the foot. Cracked: fissures up its face.
    Broken: its top half fallen into a heap."""
    name = {'intact': 'Buttress', 'cracked': 'ButtressCracked', 'broken': 'ButtressBroken'}[state]
    p = P(name, lichen=0.45)
    tops = (11.0, 11.0, 5.5)[['intact', 'cracked', 'broken'].index(state)]
    p.masonry(-2.4, 2.4, -3.0, 2.0, 4.8, 0.85, LIME_DARK, y=0, spread=0.06)
    p.masonry(-2.1, 2.1, 2.0, min(tops, 7.0), 4.2, 0.8, LIME, y=0, ruin=0.4 if state == 'broken' else 0,
              spread=0.07)
    if tops > 7.0:
        p.masonry(-1.8, 1.8, 7.0, tops, 3.6, 0.8, LIME, y=0, spread=0.07)
        p.box((0, 0, tops + 0.2), (4.0, 4.0, 0.4), p.vary(LIME_PALE), bevel=0.06, pitch=0.12)
    if state in ('cracked', 'broken'):
        for face in (-1, 1):
            for k in range(3):
                x = p.rng.uniform(-1.4, 1.4)
                z = 1.5 + k * 2.4
                for s in range(4):
                    p.box((x + s * 0.18 * (1 if k % 2 else -1), face * 2.12, z + s * 0.55), (0.14, 0.12, 0.7),
                          (0.03, 0.03, 0.035), roll=0.3 * (1 if s % 2 else -1))
    if state == 'broken':
        for i in range(12):
            p.box((p.rng.uniform(-3.5, 3.5), p.rng.uniform(-3.5, 3.5), p.rng.uniform(0.3, 1.2)),
                  (p.rng.uniform(0.6, 1.4), p.rng.uniform(0.5, 1.1), p.rng.uniform(0.4, 0.8)),
                  p.vary(LIME, 0.1), yaw=p.rng.random() * 3, bevel=0.06)
    barnacle_crust(p, -2.4, 2.4, -2.42, -3.0, 0.6, density=1.0)
    return p


# =============================================================== the gaol
def flooded_well():
    """The gaol's flooded well: a stone ring to the brim with black water, a
    winch post and a rope going down."""
    p = P('FloodedWell', lichen=0.5)
    p.lathe((0, 0, 0), [(3.2, 0), (3.2, 1.3), (3.35, 1.35), (3.35, 1.6), (2.6, 1.6), (2.6, 1.3)], 22, LIME_DARK)
    p.prism((0, 0, 1.35), 22, 2.6, 2.6, 0.04, WATER, mat=GLASS)
    for x in (-2.2, 2.2):
        p.box((x, 0, 2.6), (0.3, 0.3, 2.4), WOOD_DARK, bevel=0.03)
    p.lathe((0, 0, 3.6), [(0.35, 0), (0.35, 0.0)], 8, WOOD)
    p.box((0, 0, 3.7), (4.6, 0.25, 0.25), WOOD, bevel=0.03)
    p.box((0.4, 0, 2.6), (0.05, 0.05, 2.1), (0.5, 0.42, 0.3))
    return p


def gibbet_post():
    """A tall gibbet post with its arm and a hanging iron cage (a bleached
    skeleton inside), the cage swinging high over the yard."""
    p = P('GibbetPost', lichen=0.2)
    p.box((0, 0, 4.6), (0.5, 0.5, 9.2), WOOD_DARK, bevel=0.04)
    p.box((1.4, 0, 8.9), (3.4, 0.4, 0.4), WOOD_DARK, bevel=0.04)
    p.box((0.6, 0, 8.1), (0.3, 0.3, 1.8), WOOD_DARK, bevel=0.03, roll=0.8)
    for k in range(6):
        p.box((2.8, 0, 8.6 - k * 0.3), (0.1, 0.06, 0.24), IRON_WET, yaw=(k % 2) * 1.57)
    cz = 5.4
    for k in range(8):
        a = k / 8 * math.tau
        p.box((2.8 + math.cos(a) * 0.55, math.sin(a) * 0.55, cz), (0.06, 0.06, 2.0), IRON_WET)
    for z in (cz - 1.0, cz, cz + 1.0):
        p.lathe((2.8, 0, z), [(0.58, 0), (0.58, 0.06)], 8, IRON_WET)
    p.skull((2.8, 0.0, cz + 0.2), 0.22, yaw=0.4)
    p.bone((2.7, 0.1, cz - 0.9), (2.9, -0.1, cz - 0.1), 0.05)
    return p


def gaol_cells():
    """A row of three cells cut into the cleft's rock wall: barred openings on
    black cells, a door hanging open, chains, and a fog-fire sconce between.
    Depth 0.6 (flush against the cliff), front -Y."""
    p = P('GaolCells', lichen=0.5)
    p.masonry(-6.0, 6.0, 0.0, 5.0, 0.6, 0.8, SLATE, y=0.1, spread=0.06)
    for x in (-4.0, 0.0, 4.0):
        p.box((x, -0.22, 1.7), (2.4, 0.2, 3.3), (0.02, 0.025, 0.03))
        p.voussoir_arch(2.8, 3.3, 1.0, 0.35, 0.7, LIME_DARK, pointed=False, blocks=7, center=(x, -0.2, 0))
        open_door = x > 3
        for k in range(6):
            bx = x - 1.0 + k * 0.4
            if open_door:
                p.box((x - 1.0 + 0.2, -0.9 - k * 0.12, 1.7), (0.06, 0.06, 3.2), IRON_WET)
            else:
                p.box((bx, -0.35, 1.7), (0.07, 0.07, 3.2), IRON_WET)
        for z in (0.6, 2.8):
            p.box((x, -0.35 if not open_door else -1.1, z), (2.2 if not open_door else 0.2, 0.08, 0.1), RUST)
    # The fog-fire sconces (Vael's green, a sick light in the cells).
    for x in (-2.0, 2.0):
        p.box((x, -0.35, 2.4), (0.3, 0.3, 0.2), IRON_WET)
        p.prism((x, -0.55, 2.55), 6, 0.14, 0.02, 0.4, FOGFIRE, mat=GLOW)
    for x in (-5.4, 5.4):
        for k in range(5):
            p.box((x, -0.35, 3.6 - k * 0.3), (0.12, 0.06, 0.26), IRON_WET, yaw=(k % 2) * 1.57)
    weed_fringe(p, -6.0, 6.0, -0.35, 4.9, 0.8, 0.8)
    return p


def chain_span():
    """A heavy chain strung 60 yd across the cleft high over the yard, sagging,
    with a gibbet cage hung at its middle. Origin at the span's mid-height."""
    p = P('ChainSpan', lichen=0.0)
    n = 60
    pts = []
    for i in range(n + 1):
        t = i / n
        x = -30 + 60 * t
        pts.append((x, 0, -math.sin(math.pi * t) * 4.5))
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        m = (a + b) / 2
        p.box(tuple(m), ((b - a).length * 0.95, 0.12, 0.24), IRON_WET,
              roll=-math.atan2(b.z - a.z, b.x - a.x), pitch=(i % 2) * 1.2)
    cz = -7.5
    for k in range(4):
        p.box((0, 0, -4.5 - k * 0.5), (0.1, 0.06, 0.4), IRON_WET)
    for k in range(8):
        a = k / 8 * math.tau
        p.box((math.cos(a) * 0.6, math.sin(a) * 0.6, cz), (0.06, 0.06, 2.2), IRON_WET)
    p.lathe((0, 0, cz - 1.1), [(0.62, 0), (0.62, 0.08)], 8, IRON_WET)
    p.lathe((0, 0, cz + 1.1), [(0.62, 0), (0.0, 0.5)], 8, IRON_WET)
    return p


def drowning_winch():
    """HERO: the Drowning Winch over its flooded cage pit. A stone curb ring
    round black water, a gantry of great timbers, the capstan drum wound with
    anchor chain, and the iron cage hanging half into the pit."""
    p = P('DrowningWinch', lichen=0.3)
    r = 4.2
    p.lathe((0, 0, -0.2), [(r, 0), (r, 0.9), (r + 0.2, 1.0), (r + 0.2, 1.2), (r - 0.9, 1.2), (r - 0.9, 0.9)], 28,
            LIME_DARK)
    p.prism((0, 0, 0.25), 28, r - 0.9, r - 0.9, 0.04, (0.05, 0.1, 0.1), mat=GLASS)
    for k in range(12):
        a = k / 12 * math.tau
        p.box((math.cos(a) * (r + 0.05), math.sin(a) * (r + 0.05), 1.1), (0.5, 0.18, 0.18), RUST, yaw=a + 1.57)
    # The gantry: two A-frames of great timbers and the beam.
    for side in (-1, 1):
        for lean in (-1, 1):
            p.box((side * 3.4 + lean * 0.9, 0, 4.4), (0.55, 0.55, 9.2), WOOD_DARK, roll=lean * 0.2, bevel=0.05)
        p.box((side * 3.4, 0, 3.0), (2.6, 0.45, 0.45), WOOD, bevel=0.04)
    p.box((0, 0, 9.0), (8.6, 0.7, 0.7), WOOD_DARK, bevel=0.05)
    # The drum wound with chain on the beam.
    m = p.mark()
    p.lathe((0, 0, 0), [(1.3, -1.6), (1.3, 1.6)], 16, WOOD, phase=0.1)
    for k in range(14):
        p.lathe((0, 0, 0), [(1.42, -1.5 + k * 0.22), (1.42, -1.4 + k * 0.22)], 12, IRON_WET)
    p.turn(m, Matrix.Translation((0, 0, 9.0)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    # Capstan spokes.
    for k in range(6):
        a = k / 6 * math.tau
        p.box((4.0, math.cos(a) * 1.3, 9.0 + math.sin(a) * 1.3), (0.2, 0.2, 2.6), WOOD, roll=0, pitch=a)
    # The chain down to the cage and the cage itself, half-drowned.
    for k in range(14):
        p.box((0, 0, 8.0 - k * 0.42), (0.14, 0.08, 0.36), IRON_WET, yaw=(k % 2) * 1.57)
    cz = 1.4
    for k in range(10):
        a = k / 10 * math.tau
        p.box((math.cos(a) * 1.1, math.sin(a) * 1.1, cz), (0.1, 0.1, 3.0), IRON_WET)
    for z in (cz - 1.4, cz, cz + 1.4):
        p.lathe((0, 0, z), [(1.14, 0), (1.14, 0.1)], 12, RUST)
    p.lathe((0, 0, cz + 1.5), [(1.2, 0), (0.0, 0.7)], 12, IRON_WET)
    # Chains running out across the floor toward the mooring posts.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        for s in range(8):
            d = r + 0.3 + s * 0.45
            p.box((math.cos(a) * d, math.sin(a) * d, 0.08), (0.36, 0.1, 0.1), IRON_WET, yaw=a + (s % 2) * 1.57)
    barnacle_crust(p, -r, r, -r - 0.1, -0.1, 0.8, density=0.7)
    return p


def mooring_post():
    """An iron mooring post bolted into the yard: a squat post, a heavy ring,
    and a caged lamp on top (dark until the fight lights it)."""
    p = P('MooringPost', lichen=0.15)
    p.lathe((0, 0, 0), [(0.7, 0), (0.62, 0.25), (0.42, 0.4), (0.42, 2.0), (0.55, 2.15), (0.55, 2.3)], 14,
            IRON_WET)
    m = p.mark()
    p.lathe((0, 0, 0), [(0.5, -0.06), (0.5, 0.06)], 12, RUST)
    p.turn(m, Matrix.Translation((0, -0.45, 1.3)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        p.box((math.cos(a) * 0.28, math.sin(a) * 0.28, 2.75), (0.06, 0.06, 0.8), IRON_WET)
    p.prism((0, 0, 2.35), 8, 0.26, 0.26, 0.8, GLASS_TINT, mat=GLASS)
    p.lathe((0, 0, 3.15), [(0.4, 0), (0.0, 0.35)], 8, IRON_WET)
    barnacle_crust(p, -0.6, 0.6, -0.6, 0.0, 0.5, density=2.0)
    return p


# =============================================================== the keep court and crown
def court_fountain():
    """The keep court's dry fountain: a tiered basin and a sea-serpent spout."""
    p = P('CourtFountain', lichen=0.6)
    p.lathe((0, 0, 0), [(3.4, 0), (3.4, 0.7), (3.55, 0.8), (3.55, 1.0), (2.9, 1.0), (2.9, 0.5)], 24, LIME)
    p.prism((0, 0, 0.5), 24, 2.9, 2.9, 0.02, (0.1, 0.12, 0.1), mat=GLASS)
    p.lathe((0, 0, 0.5), [(0.8, 0), (0.6, 1.2), (1.4, 1.5), (1.4, 1.7), (0.3, 1.8), (0.25, 2.8)], 16, LIME_PALE)
    arc = p.bezier((0, 0, 2.6), (0.6, -0.3, 3.8), (0.2, -1.0, 3.2), steps=8)
    p.sweep(arc, 0.28, 0.12, (0.4, 0.52, 0.45), sides=7)
    return p


def court_statue():
    """A drowned knight of the Court on a plinth, head bowed over his sword."""
    p = P('CourtStatue', lichen=0.7)
    p.box((0, 0, 0.6), (1.9, 1.9, 1.2), p.vary(LIME_DARK), bevel=0.08)
    p.box((0, 0, 1.3), (1.6, 1.6, 0.2), p.vary(LIME_PALE), bevel=0.05)
    p.box((0, 0, 2.5), (0.9, 0.55, 2.2), LIME, bevel=0.1, taper=1.15)
    p.box((0, 0, 4.0), (1.3, 0.65, 0.9), LIME, bevel=0.1)
    p.lathe((0, 0.05, 4.4), [(0.32, 0), (0.36, 0.3), (0.3, 0.62), (0.0, 0.7)], 10, LIME)
    p.box((0, -0.45, 2.9), (0.18, 0.1, 2.9), LIME_PALE)
    p.box((0, -0.45, 3.8), (0.8, 0.14, 0.14), LIME_PALE)
    for s in (-1, 1):
        p.box((s * 0.55, -0.25, 3.5), (0.3, 0.3, 1.2), LIME, roll=s * 0.3)
    p.box((0, 0.35, 3.3), (1.2, 0.12, 2.6), (0.5, 0.55, 0.5))
    return p


def fogbeacon():
    """HERO: the Fogbeacon. A tapering sea-light of banded stone (pale limestone
    and wet slate) 36 yd tall on a battered plinth, its gallery ringed in iron,
    the glazed lantern room crowned with a copper dome gone green, the great lamp
    burning inside, and Vael's fog weeping green down from the glass."""
    p = P('Fogbeacon', lichen=0.35)
    r0 = 6.5
    # Plinth.
    p.lathe((0, 0, 0), [(r0 + 0.8, 0), (r0 + 0.8, 0.6), (r0 + 0.4, 1.2), (r0, 2.0)], 28, SLATE)
    # The shaft in bands.
    bands = 18
    for i in range(bands):
        z0 = 2.0 + i * 1.9
        z1 = z0 + 1.9
        ra = r0 - (r0 - 4.0) * (i / bands)
        rb = r0 - (r0 - 4.0) * ((i + 1) / bands)
        col = (0.46, 0.47, 0.43) if (i % 5 == 2) else p.vary(LIME_PALE, 0.03)
        p.lathe((0, 0, z0), [(ra, 0), (rb * 1.002, 1.86), (rb * 0.99, 1.9)], 24, col)
    # Windows up the stair.
    for i in range(6):
        a = i * 2.2
        z = 6.0 + i * 4.8
        rr = r0 - (r0 - 4.0) * ((z - 2) / 34.2)
        p.box((math.cos(a) * rr, math.sin(a) * rr, z), (0.5, 0.5, 1.4), (0.03, 0.03, 0.035), yaw=a)
        p.box((math.cos(a) * (rr - 0.1), math.sin(a) * (rr - 0.1), z), (0.35, 0.35, 1.1), LANTERN, mat=GLOW, yaw=a)
    top = 36.2
    # Gallery: corbel ring, deck, iron railing.
    for k in range(24):
        a = k / 24 * math.tau
        p.box((math.cos(a) * 4.3, math.sin(a) * 4.3, top - 0.8), (0.6, 0.45, 1.2), LIME_DARK, yaw=a, bevel=0.04)
    p.lathe((0, 0, top), [(5.4, 0), (5.4, 0.35), (0.0, 0.35)], 28, LIME_PALE)
    for k in range(32):
        a = k / 32 * math.tau
        p.box((math.cos(a) * 5.25, math.sin(a) * 5.25, top + 0.9), (0.07, 0.07, 1.1), IRON_WET)
    p.lathe((0, 0, top + 1.4), [(5.3, 0), (5.3, 0.08)], 32, IRON_WET)
    # The lantern room: iron mullions, glazing, the lamp.
    lr = 3.0
    for k in range(10):
        a = k / 10 * math.tau
        p.box((math.cos(a) * lr, math.sin(a) * lr, top + 3.3), (0.16, 0.16, 5.6), IRON_WET)
    p.prism((0, 0, top + 0.5), 10, lr - 0.05, lr - 0.05, 5.6, GLASS_TINT, mat=GLASS)
    p.lathe((0, 0, top + 0.35), [(lr + 0.2, 0), (lr + 0.2, 0.4), (0, 0.4)], 20, LIME_PALE)
    # The great lamp: a brass lens on its stand (glow at 41.5 above the origin).
    p.lathe((0, 0, top + 0.75), [(0.6, 0), (0.4, 1.5), (0.8, 1.8)], 12, (0.55, 0.42, 0.2))
    p.lathe((0, 0, top + 2.6), [(0.9, 0), (1.4, 0.9), (1.4, 2.2), (0.9, 3.0), (0.0, 3.1)], 16, BEACON, mat=GLOW)
    # Copper dome gone green, a ball finial and a weather vane.
    p.lathe((0, 0, top + 6.1), [(lr + 0.4, 0), (lr + 0.2, 0.5), (2.2, 1.9), (0.9, 3.0), (0.0, 3.3)], 20,
            (0.3, 0.5, 0.42))
    p.lathe((0, 0, top + 9.4), [(0.3, 0), (0.35, 0.3), (0.0, 0.62)], 10, (0.62, 0.52, 0.28))
    p.box((0.6, 0, top + 10.6), (1.4, 0.05, 0.5), IRON_WET)
    p.box((0, 0, top + 10.2), (0.06, 0.06, 1.2), IRON_WET)
    # Vael's fog weeping green down from the glazing.
    for k in range(9):
        a = k / 9 * math.tau + 0.3
        rr = 4.05
        ln = p.rng.uniform(4, 10)
        p.box((math.cos(a) * rr, math.sin(a) * rr, top - 1.0 - ln / 2), (0.5, 0.04, ln), (0.36, 0.5, 0.4),
              yaw=a + math.pi / 2)
    # The door and its step on the crown.
    p.box((0, -r0 + 0.05, 1.9), (1.8, 0.3, 3.4), WOOD_DARK)
    p.voussoir_arch(2.2, 3.6, 1.0, 0.4, 0.6, LIME_PALE, pointed=True, blocks=7, center=(0, -r0 + 0.1, 0))
    return p


def crown_merlon():
    """A broken merlon on the Beacon Crown's rim."""
    p = P('CrownMerlon', lichen=0.5)
    p.masonry(-0.9, 0.9, 0.0, 2.4, 1.1, 0.6, LIME, ruin=0.3, spread=0.08)
    return p


# =============================================================== lights and small props
def brazier():
    """An iron fire basket on a tripod, glowing coals (the flame is the runtime's)."""
    p = P('Brazier', lichen=0.0)
    for k in range(3):
        a = k / 3 * math.tau
        p.box((math.cos(a) * 0.45, math.sin(a) * 0.45, 0.6), (0.08, 0.08, 1.3), IRON_WET, roll=0.25 * math.cos(a),
              pitch=0.25 * math.sin(a))
    p.lathe((0, 0, 1.15), [(0.25, 0), (0.62, 0.3), (0.66, 0.4)], 12, IRON_WET)
    for k in range(10):
        a = k / 10 * math.tau
        p.box((math.cos(a) * 0.6, math.sin(a) * 0.6, 1.5), (0.06, 0.06, 0.35), IRON_WET)
    p.rock((0, 0, 1.4), (0.9, 0.9, 0.3), EMBER, mat=GLOW, jitter=0.3, subdivisions=1)
    return p


def lantern_post():
    """An iron post with a ship's lantern hung off its arm (flame at 0, 3.3, 1.0
    in game axes: the arm reaches -Y here)."""
    p = P('LanternPost', lichen=0.0)
    p.lathe((0, 0, 0), [(0.3, 0), (0.25, 0.3), (0.1, 0.4), (0.09, 3.9), (0.14, 4.0)], 10, IRON_WET)
    p.box((0, -0.55, 3.85), (0.07, 1.1, 0.07), IRON_WET)
    p.box((0, -0.8, 3.6), (0.05, 0.05, 0.5), IRON_WET, pitch=0.6)
    p.box((0, -1.0, 3.75), (0.04, 0.04, 0.25), IRON_WET)
    p.lathe((0, -1.0, 2.95), [(0.2, 0), (0.25, 0.1), (0.25, 0.6), (0.3, 0.7), (0.0, 0.85)], 8, RUST)
    p.prism((0, -1.0, 3.05), 8, 0.22, 0.22, 0.5, LANTERN, mat=GLASS)
    return p


def bollard():
    """A squat iron bollard on the quay."""
    p = P('Bollard', lichen=0.0)
    p.lathe((0, 0, 0), [(0.55, 0), (0.45, 0.2), (0.38, 0.9), (0.55, 1.05), (0.55, 1.2), (0.0, 1.25)], 12, IRON_WET)
    for k in range(3):
        p.lathe((0, 0, 0.35 + k * 0.08), [(0.4, 0), (0.4, 0.05)], 12, (0.5, 0.42, 0.3))
    return p


def kelp():
    """A mat of wrack and kelp stranded on the mud or wet stone (ankle-low): flat
    olive-brown lobes with a few curled strands."""
    p = P('Kelp', lichen=0.0, weather=0.3)
    for k in range(6):
        a = k / 6 * math.tau + p.rng.uniform(-0.3, 0.3)
        d = p.rng.uniform(0.1, 0.45)
        s_ = p.rng.uniform(0.35, 0.7)
        p.rock((math.cos(a) * d, math.sin(a) * d, 0.03), (s_ * 1.4, s_, 0.07),
               p.vary(KELP if k % 2 else (0.3, 0.3, 0.14), 0.15), jitter=0.35, subdivisions=1, flat_bottom=True)
    for k in range(3):
        a = p.rng.random() * math.tau
        pts = [(math.cos(a) * t * 0.9, math.sin(a) * t * 0.9, 0.06) for t in (0.2, 0.5, 0.8)]
        p.sweep(pts, 0.05, 0.02, p.vary(WEED, 0.15), sides=3, squash=0.4)
    return p


def barnacles():
    """A barnacle and mussel crust on a flat stone (ankle-low)."""
    p = P('Barnacles', lichen=0.0, weather=0.3)
    p.rock((0, 0, 0.05), (0.8, 0.6, 0.18), p.vary(ROCK, 0.1), jitter=0.2, subdivisions=1, flat_bottom=True)
    for k in range(10):
        x, y = p.rng.uniform(-0.35, 0.35), p.rng.uniform(-0.25, 0.25)
        if k % 3 == 0:
            p.box((x, y, 0.14), (0.16, 0.07, 0.06), (0.1, 0.11, 0.14), yaw=p.rng.random() * 3)
        else:
            p.prism((x, y, 0.1), 5, 0.06, 0.025, 0.07, p.vary(BARNACLE, 0.1))
    return p


def stake():
    """A weathered fish-weir stake standing in the water (3 yd tall)."""
    p = P('Stake', lichen=0.0)
    p.box((0, 0, 1.6), (0.26, 0.22, 3.2), p.vary(WOOD_BLEACH, 0.1), bevel=0.03, roll=0.05)
    p.spike((0, 0, 3.2), 0.13, 0.35, WOOD_BLEACH, sides=4)
    barnacle_crust(p, -0.13, 0.13, -0.12, 0.2, 1.3, density=6.0)
    weed_fringe(p, -0.12, 0.12, -0.13, 1.6, 0.6, 3.0)
    return p


# =============================================================== the flats
def wreck_hull():
    """HERO: a Court galley wrecked on the flats, heeled on its side. Keel,
    exposed ribs, a run of planking still whole, the stump of its mast, and
    barnacles to the waterline. Long axis along Y (the game's Z), 20 long."""
    p = P('WreckHull', lichen=0.15, weather=0.8)
    L = 20.0
    heel = Matrix.Rotation(0.55, 4, 'Y')
    m = p.mark()
    # Keel and stem.
    p.box((0, 0, 0.6), (0.6, L, 0.7), WOOD_DARK, bevel=0.05)
    arc = p.bezier((0, L / 2 - 0.5, 0.6), (0, L / 2 + 1.0, 3.5), (0, L / 2 + 0.2, 6.0), steps=6)
    p.sweep(arc, 0.35, 0.3, WOOD_DARK, sides=4)
    # Ribs.
    for i in range(12):
        y = -L / 2 + 1.2 + i * (L - 2.4) / 11
        w = 3.4 * math.sin(math.pi * (i + 1) / 13) + 0.4
        for side in (-1, 1):
            rib = p.bezier((0, y, 0.7), (side * w * 1.1, y, 1.2), (side * w, y, 5.5), steps=6)
            if side > 0 and i % 3 == 1:
                rib = rib[:4]
            p.sweep(rib, 0.16, 0.14, p.vary(WOOD, 0.1), sides=4)
    # Planking on the lower side, a hole torn through it.
    for k in range(7):
        z = 1.0 + k * 0.7
        for i in range(11):
            y = -L / 2 + 1.6 + i * 1.6
            if k in (3, 4) and 2 <= i <= 5:
                continue
            w = 3.4 * math.sin(math.pi * (i + 1.5) / 13) + 0.45
            p.box((-w - 0.05, y, z), (0.12, 1.62, 0.66), p.vary(WOOD, 0.12), roll=-0.15)
    # Deck beams and the mast stump.
    for i in range(6):
        p.box((0, -L / 2 + 3 + i * 2.8, 5.2), (6.6, 0.3, 0.3), WOOD_DARK)
    p.lathe((0, 1.0, 5.2), [(0.45, 0), (0.42, 4.5), (0.3, 5.0)], 8, WOOD)
    p.turn(m, heel)
    barnacle_crust(p, -2.0, 2.0, -3.2, 0.0, 2.2, density=0.6)
    for i in range(6):
        p.rock((p.rng.uniform(-4, 4), p.rng.uniform(-10, 10), 0.1), (1.4, 1.0, 0.4), MUD, subdivisions=1,
               flat_bottom=True)
    return p


def wreck_mast():
    """A fallen mast across the flats, its yard and a torn sail in the mud."""
    p = P('WreckMast', lichen=0.0)
    m = p.mark()
    p.lathe((0, -8, 0.6), [(0.55, 0), (0.45, 16.0)], 10, WOOD)
    p.turn(m, Matrix.Translation((0, -8, 0.6)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
           @ Matrix.Translation((0, 8, -0.6)))
    m = p.mark()
    p.lathe((0, 0, 0), [(0.25, -4), (0.25, 4)], 8, WOOD_DARK)
    p.turn(m, Matrix.Translation((0, 3.0, 0.9)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    for k in range(6):
        p.box((p.rng.uniform(-2.5, 2.5), 3.0 + p.rng.uniform(-1, 3), 0.08), (1.6, 1.8, 0.05), p.vary(SAIL, 0.1),
              yaw=p.rng.random() * 3, pitch=p.rng.uniform(-0.2, 0.2))
    for k in range(4):
        rope = p.bezier((p.rng.uniform(-1, 1), p.rng.uniform(-6, 6), 0.9), (p.rng.uniform(-3, 3), 0, 0.1),
                        (p.rng.uniform(-4, 4), p.rng.uniform(-6, 6), 0.05), steps=6)
        p.sweep(rope, 0.04, 0.04, (0.45, 0.38, 0.28), sides=3)
    return p


def rowboat():
    """A clinker rowboat (5 long), an oar across the thwarts."""
    p = P('Rowboat', lichen=0.1)
    for k in range(4):
        z = 0.15 + k * 0.2
        w = 0.7 + k * 0.18
        prof = [(0, -2.5, z), (w * 0.7, -1.6, z), (w, 0, z), (w * 0.8, 1.7, z), (0, 2.5, z)]
        for side in (-1, 1):
            pts = [(side * x, y, zz) for (x, y, zz) in prof]
            p.sweep(pts, 0.1, 0.1, p.vary(WOOD, 0.1), sides=4, squash=0.6)
    p.box((0, 0, 0.1), (0.3, 5.0, 0.2), WOOD_DARK)
    for y in (-0.8, 0.8):
        p.box((0, y, 0.65), (1.5, 0.3, 0.08), WOOD)
    p.box((0.3, 0, 0.8), (0.1, 3.6, 0.08), WOOD_BLEACH, yaw=0.3)
    return p


def outwork_ruin():
    """A broken round outwork stump on the flats: its seaward side fallen away,
    rubble spilling into the mud."""
    p = P('OutworkRuin', lichen=0.5)
    r = 5.3
    for i in range(12):
        z0 = -1.0 + i * 0.85
        cut = max(0.0, (i - 4) / 7)
        segs = 24
        for k in range(segs):
            a = k / segs * math.tau
            if math.sin(a) < -0.2 + cut * 0.9 and i > 3:
                continue
            p.box((math.cos(a) * r, math.sin(a) * r, z0 + 0.42), (1.45, 1.4, 0.82),
                  p.vary(LIME if i > 1 else SLATE, 0.08), yaw=a + math.pi / 2, bevel=0.05)
    for i in range(16):
        a = p.rng.uniform(-2.6, -0.6)
        d = p.rng.uniform(r, r + 4)
        p.box((math.cos(a) * d, math.sin(a) * d, 0.35), (p.rng.uniform(0.6, 1.5), 1.0, 0.7), p.vary(LIME, 0.1),
              yaw=p.rng.random() * 3, bevel=0.06)
    barnacle_crust(p, -r, r, -r - 0.7, -1.0, 1.0, density=0.5)
    return p


def tide_rocks(variant):
    """A barnacled outcrop on the flats."""
    p = P('TideRocks' + variant, lichen=0.2)
    n = 4 if variant == 'A' else 3
    for i in range(n):
        a = i / n * math.tau
        s = p.rng.uniform(1.4, 2.6)
        p.rock((math.cos(a) * 1.6, math.sin(a) * 1.4, s * 0.4), (s * 1.6, s * 1.3, s * 1.2), p.vary(ROCK, 0.12),
               jitter=0.3, subdivisions=2, flat_bottom=True)
    barnacle_crust(p, -3.0, 3.0, -2.2, 0.0, 1.0, density=0.8)
    weed_fringe(p, -3.0, 3.0, -2.4, 0.9, 0.8)
    return p


def wreck_debris():
    """Planks, a stove-in barrel, a broken crate and rope strewn on the mud."""
    p = P('WreckDebris', lichen=0.0)
    for k in range(9):
        p.box((p.rng.uniform(-3, 3), p.rng.uniform(-3, 3), 0.08), (p.rng.uniform(1.2, 2.8), 0.28, 0.08),
              p.vary(WOOD_BLEACH, 0.15), yaw=p.rng.random() * 3)
    m = p.mark()
    p.lathe((1.2, -1.0, 0), [(0.4, 0), (0.46, 0.45), (0.4, 0.9)], 10, WOOD)
    p.turn(m, Matrix.Translation((1.2, -1.0, 0.4)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
           @ Matrix.Translation((-1.2, 1.0, -0.4)))
    p.box((-1.4, 1.2, 0.35), (0.9, 0.9, 0.7), WOOD, yaw=0.5, bevel=0.04)
    return p


def net_pile():
    """Fishing nets heaped over a barrel, with cork floats (on the landing)."""
    p = P('NetPile', lichen=0.0)
    p.lathe((0, 0, 0), [(0.4, 0), (0.46, 0.45), (0.4, 0.9)], 10, WOOD)
    p.rock((0.4, 0.2, 0.3), (2.0, 1.6, 0.7), (0.3, 0.28, 0.22), jitter=0.2, subdivisions=2, flat_bottom=True)
    for k in range(7):
        p.lathe((p.rng.uniform(-0.8, 1.4), p.rng.uniform(-0.6, 0.9), 0.55), [(0.12, 0), (0.12, 0.14)], 8,
                (0.62, 0.45, 0.25))
    return p


def grave_markers():
    """The drowned garrison's graves: driftwood crosses and stones, knee-high."""
    p = P('GraveMarkers', lichen=0.5)
    for i in range(4):
        x = -2.4 + i * 1.6
        if i % 2:
            p.box((x, 0, 0.45), (0.12, 0.12, 0.9), WOOD_BLEACH)
            p.box((x, 0, 0.7), (0.5, 0.1, 0.1), WOOD_BLEACH)
        else:
            p.box((x, 0, 0.35), (0.55, 0.18, 0.7), p.vary(LIME, 0.1), bevel=0.06, roll=0.1)
        p.rock((x, -0.5, 0.05), (0.6, 1.0, 0.15), MUD, subdivisions=1, flat_bottom=True)
    return p


def rubble():
    """Loose masonry on a ruined lip."""
    p = P('Rubble', lichen=0.4)
    for k in range(7):
        p.box((p.rng.uniform(-1.6, 1.6), p.rng.uniform(-0.6, 0.6), 0.25), (p.rng.uniform(0.5, 1.1),
              p.rng.uniform(0.4, 0.8), p.rng.uniform(0.3, 0.6)), p.vary(LIME, 0.1), yaw=p.rng.random() * 3,
              bevel=0.05)
    return p


BUILDERS = [
    parapet, quay_rail, shore_rocks,
    lambda: curtain_wall(False), lambda: curtain_wall(True), sea_gate, gatehouse_arch, rock_arch, bartizan,
    keep,
    drowned_chapel, cistern, cargo_stack, anchor, cannon,
    lambda: buttress('intact'), lambda: buttress('cracked'), lambda: buttress('broken'),
    flooded_well, gibbet_post, gaol_cells, chain_span, drowning_winch, mooring_post,
    court_fountain, court_statue, fogbeacon, crown_merlon,
    brazier, lantern_post, bollard, kelp, barnacles, stake,
    wreck_hull, wreck_mast, rowboat, outwork_ruin, lambda: tide_rocks('A'), lambda: tide_rocks('B'),
    wreck_debris, net_pile, grave_markers, rubble,
]


def build_bastion_kit(root_name, builders):
    """hckit.build_kit with this kit's material names (stone, glow, glass)."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission, alpha in (('KitStone', 0.0, 1.0), ('KitGlow', 4.0, 1.0), ('KitGlass', 0.0, 0.5)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85
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
    """Spread the pieces on a grid for a contact-sheet render."""
    x = 0.0
    row = 0.0
    width = 0.0
    for obj in parts:
        d = obj.dimensions
        if x > 120:
            x = 0.0
            row += width + 6
            width = 0.0
        obj.location = (x + d.x / 2, row, 0)
        x += d.x + 5
        width = max(width, d.y)


def main():
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    save = argv[argv.index('--save') + 1] if '--save' in argv else None
    parts = build_bastion_kit('SunkenBastionKit_ROOT', BUILDERS)
    out = os.path.join(HERE, 'sunken_bastion_kit_components.glb')
    export_kit(out)
    if save or preview:
        layout_preview(parts)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=save)
    if preview:
        render_preview(preview)


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
    cam.location = (60, -140, 90)
    cam.rotation_euler = (math.radians(55), 0, 0)
    cam_data.lens = 24
    scene.camera = cam
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 3.5
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.4, 0.42, 1)
    scene.world = world
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
