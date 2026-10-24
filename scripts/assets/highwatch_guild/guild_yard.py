"""The guild's yard: the old stable yard where the road ends, paved in flags round the porch,
a lamp, the guild's gateway over the road with its name board and crest, the old hitching rail and trough kept
from the stables, crates and barrels by the tower. Part: GuildYard (and GuildGlow for the
lamps' panes)."""
import math

from guild_kit import _ball, finial, hanging_lantern
from guild_lib import LAYER, METAL, PAL, STONE, WOOD, abox, cyl, flat_face, hashf, pick, tone
from guild_pieces import PAVE, barrel, lamp

from guild_plan import CRATES, GATE, HITCH, PORCH, STEPS, TOWER, TROUGH, YARD, YARD_LAMPS
from guild_props import hang, has, stand, stand_fit

# the gateway's crest: its height, and the gap each of its two faces keeps off the beam's middle
CREST_H = 2.0
CREST_GAP = 0.02


def _paving(p, x0, x1, z0, z1, seed=0):
    """Flags on a mortar bed at the paving height, staggered rows."""
    flat_face(p, [(x0, PAVE - LAYER, z0), (x1, PAVE - LAYER, z0), (x1, PAVE - LAYER, z1), (x0, PAVE - LAYER, z1)],
              PAL['mortar'], STONE, (0, 1, 0))
    z = z0
    row = 0
    while z < z1 - 0.05:
        zb = min(z1, z + 1.0 + 0.4 * hashf(row, seed))
        x = x0 - (0.7 if row % 2 else 0.0)
        while x < x1 - 0.05:
            xb = min(x1, x + 1.2 + 0.5 * hashf(x, row, seed))
            xa = max(x0, x)
            if xb - xa > 0.15:
                flat_face(p, [(xa + 0.035, PAVE, z + 0.035), (xb - 0.035, PAVE, z + 0.035), (xb - 0.035, PAVE, zb - 0.035),
                              (xa + 0.035, PAVE, zb - 0.035)],
                          tone(pick(PAL['flag'], int(hashf(xa, row, seed) * 4)), xa, row, spread=0.18), STONE, (0, 1, 0))
            x = xb
        z = zb
        row += 1


def paving(p):
    Y = YARD
    # round the porch and the steps: the strips either side of them, then the yard in front
    _paving(p, Y['x0'], PORCH['x0'] - 0.05, STEPS['z0'], Y['z1'], seed=1)
    _paving(p, PORCH['x1'] + 0.05, Y['x1'], STEPS['z0'], Y['z1'], seed=2)
    _paving(p, Y['x0'], Y['x1'], Y['z0'], STEPS['z0'] - 0.05, seed=3)
    # a kerb round the yard's open edges
    for (a, b, c, d) in ((Y['x0'] - 0.25, Y['x1'] + 0.25, Y['z0'] - 0.25, Y['z0']),
                         (Y['x0'] - 0.25, Y['x0'], Y['z0'], Y['z1']),
                         (Y['x1'], Y['x1'] + 0.25, Y['z0'], TOWER['z0'])):
        abox(p, a, b, -0.15, PAVE + 0.1, c, d, PAL['ashlar_hi'], STONE)


def gateway(p, glow):
    """The guild's gateway over the spur road: two chamfered oak posts on coursed ashlar feet,
    iron bands and a gilded finial on each, a heavy beam with carved stepped ends, a gilded
    moulding and iron straps, knee braces, the name board on chains (a dark blue board in a
    gilded moulding; the localized name is painted on at the text anchor), the guild's painted
    crest standing on the beam (facing both ways), and an iron lantern hung from either end of the
    beam."""
    g = GATE
    z = g['z']
    zt = g['post'] / 2
    for sx in (-1, 1):
        x = g['x'] + sx * g['half']
        f = g['foot'] / 2
        # the foot: a coursed plinth and a moulded cap
        abox(p, x - f, x + f, -0.25, g['foot_h'] - 0.18, z - f, z + f, tone(PAL['ashlar'][1], sx), STONE)
        abox(p, x - f - 0.06, x + f + 0.06, g['foot_h'] - 0.18, g['foot_h'], z - f - 0.06, z + f + 0.06,
             PAL['ashlar_hi'], STONE)
        for k in range(2):
            yy = 0.12 + k * 0.34
            abox(p, x - f - LAYER, x + f + LAYER, yy, yy + 0.04, z - f - LAYER, z + f + LAYER, PAL['mortar'], STONE)
        # the post, its arrises chamfered: an octagonal prism
        p.prism((x, g['foot_h'], z), 8, zt * 1.08, zt, g['top'] - g['foot_h'] - 0.3, PAL['oak_dark'], WOOD,
                axis=(0, 1, 0), phase=math.pi / 8)
        # iron bands, low and under the beam
        for yy in (g['foot_h'] + 0.35, g['beam_y0'] - 0.4):
            p.prism((x, yy, z), 8, zt * 1.16, zt * 1.16, 0.12, PAL['iron'], METAL, axis=(0, 1, 0), phase=math.pi / 8)
        # the cap and the gilded finial
        p.prism((x, g['top'] - 0.3, z), 4, zt * 1.5, zt * 0.9, 0.3, PAL['iron'], METAL, axis=(0, 1, 0),
                phase=math.pi / 4)
        finial(p, x, g['top'], z, h=1.0, r=0.17)
        # the knee brace in to the beam
        p.beam([(x - sx * 0.05, g['beam_y0'] - 1.25, z), (x - sx * 1.25, g['beam_y0'] - 0.02, z)], 0.2, 0.22,
               PAL['oak_dark'], WOOD)
    # the beam: past both posts, its ends cut in carved steps, a gilded moulding, iron straps
    bx0, bx1 = g['x'] - g['half'] - 1.25, g['x'] + g['half'] + 1.25
    by0, by1 = g['beam_y0'], g['beam_y1']
    abox(p, bx0 + 0.3, bx1 - 0.3, by0, by1, z - 0.3, z + 0.3, PAL['oak_dark'], WOOD)
    for sx, e in ((-1, bx0), (1, bx1)):
        for k, (dx, dy) in enumerate(((0.3, 0.0), (0.18, 0.12), (0.06, 0.26))):
            a, b = (e + 0.3 - dx, e + 0.3) if sx < 0 else (e - 0.3, e - 0.3 + dx)
            abox(p, a, b, by0 + dy, by1 - dy * 0.4, z - 0.28, z + 0.28, tone(PAL['oak_dark'], k), WOOD)
    for sz in (-1, 1):
        w = z + sz * 0.3
        za, zb = (w - LAYER, w) if sz < 0 else (w, w + LAYER)
        abox(p, bx0 + 0.4, bx1 - 0.4, by0 + 0.08, by0 + 0.16, za, zb, PAL['gold_dark'], METAL)
        abox(p, bx0 + 0.4, bx1 - 0.4, by1 - 0.16, by1 - 0.08, za, zb, PAL['gold_dark'], METAL)
    for sx in (-1, 1):
        x = g['x'] + sx * g['half']
        abox(p, x - 0.22, x + 0.22, by0 - 0.04, by1 + 0.04, z - 0.32, z + 0.32, PAL['iron'], METAL)
        for sz in (-1, 1):
            _ball(p, x, (by0 + by1) / 2, z + sz * 0.36, 0.06)
    # the name board on two chains: a dark blue board in a gilded moulding
    hx = g['board_x']
    y0, y1, t = g['board_y0'], g['board_y1'], g['board_t'] / 2
    for cx in (g['x'] - hx + 0.5, g['x'] + hx - 0.5):
        for k in range(4):
            yy = y1 + 0.14 + k * 0.1
            p.ring((cx, yy, z), 0.05, 0.02, PAL['iron'], 6, axis=(1, 0, 0) if k % 2 else (0, 0, 1), mat=METAL)
        p.cylinder((cx, y1 + 0.5, z), (cx, by0, z), 0.03, PAL['iron'], METAL, sides=4)
        abox(p, cx - 0.08, cx + 0.08, y1 + 0.1, y1 + 0.16, z - 0.05, z + 0.05, PAL['iron'], METAL)
    abox(p, g['x'] - hx, g['x'] + hx, y0, y1, z - t, z + t, PAL['blue_dark'], WOOD)
    for (a, b, c, d) in ((-hx - 0.1, hx + 0.1, y1, y1 + 0.1), (-hx - 0.1, hx + 0.1, y0 - 0.1, y0),
                         (-hx - 0.1, -hx, y0, y1), (hx, hx + 0.1, y0, y1)):
        abox(p, g['x'] + a, g['x'] + b, c, d, z - t - 0.03, z + t + 0.03, PAL['gold'], METAL)
    # the guild's crest standing on the beam: the painted crest the porch gable wears
    # (guild_kit.guild_crest), two of it back to back so the road and the yard both read it, on a
    # gilded stem
    if has('guild_crest'):
        cy = by1 + 0.2 + CREST_H / 2
        abox(p, g['x'] - 0.2, g['x'] + 0.2, by1, cy - CREST_H * 0.3, z - 0.1, z + 0.1, PAL['gold_dark'], METAL)
        for sz in (-1.0, 1.0):
            hang(p, 'guild_crest', (g['x'], cy, z), (0.0, sz), CREST_H, standoff=CREST_GAP)
    # an iron lantern hung from either end of the beam
    for sx in (-1, 1):
        lx = g['x'] + sx * (g['half'] + 0.85)
        hanging_lantern(p, glow, lx, by0, z, drop=0.25, size=0.42)


def hitching_rail(p):
    """The old stable yard's hitching rail, a water trough beside it."""
    x, z0, z1 = HITCH['x'], HITCH['z0'], HITCH['z1']
    for zz in (z0 + 0.2, (z0 + z1) / 2, z1 - 0.2):
        abox(p, x - 0.13, x + 0.13, -0.3, 1.25, zz - 0.13, zz + 0.13, PAL['oak_dark'], WOOD)
        p.prism((x, 1.25, zz), 4, 0.18, 0.04, 0.12, PAL['oak_dark'], WOOD, axis=(0, 1, 0), phase=math.pi / 4)
    abox(p, x - 0.1, x + 0.1, 1.0, 1.16, z0, z1, PAL['oak'][1], WOOD)
    for zz in (z0 + 1.4, z1 - 1.6):
        p.ring((x + 0.12, 0.9, zz), 0.1, 0.025, PAL['iron'], 8, axis=(1, 0, 0), mat=METAL)
    T = TROUGH
    tx0, tx1 = T['x'] - T['lx'] / 2, T['x'] + T['lx'] / 2
    tz0, tz1 = T['z'] - T['lz'] / 2, T['z'] + T['lz'] / 2
    for (a, b, c, d) in ((tx0, tx1, tz0, tz0 + 0.18), (tx0, tx1, tz1 - 0.18, tz1), (tx0, tx0 + 0.18, tz0, tz1),
                         (tx1 - 0.18, tx1, tz0, tz1)):
        abox(p, a, b, -0.2, 0.85, c, d, tone(PAL['ashlar'][2], a, c), STONE)
    flat_face(p, [(tx0 + 0.18, 0.7, tz0 + 0.18), (tx1 - 0.18, 0.7, tz0 + 0.18), (tx1 - 0.18, 0.7, tz1 - 0.18),
                  (tx0 + 0.18, 0.7, tz1 - 0.18)], PAL['water'], STONE, (0, 1, 0))


def crates(p):
    x, z = CRATES['x'], CRATES['z']
    for (dx, dz, s, h) in ((-0.7, -0.5, 1.1, 1.0), (0.6, -0.6, 1.0, 0.9), (-0.1, 0.6, 1.2, 1.1)):
        x0, x1, z0, z1 = x + dx - s / 2, x + dx + s / 2, z + dz - s / 2, z + dz + s / 2
        abox(p, x0, x1, PAVE, PAVE + h, z0, z1, tone(PAL['oak'][1], dx, dz), WOOD)
        for (a, b) in ((x0 - 0.03, x0 + 0.1), (x1 - 0.1, x1 + 0.03)):
            abox(p, a, b, PAVE, PAVE + h + 0.02, z0 - 0.03, z1 + 0.03, PAL['oak_dark'], WOOD)
    abox(p, x - 0.6, x + 0.2, PAVE + 1.1, PAVE + 1.7, z + 0.2, z + 0.9, tone(PAL['oak'][2], 3), WOOD)
    barrel(p, x + 0.9, z + 0.9, y=PAVE, h=1.0, r=0.4)


def yard_props(p, glow):
    """The yard's painted props where the built pieces stood (their collision boxes unchanged):
    the old stables' hitching rail and its granite trough, and the crates and barrels stacked by
    the tower; a built piece stands in for any prop not packed. The lamp by the steps."""
    # (the lamp by the steps stays built: its panes are lit glass that glows at night, as the
    # gateway's lanterns do)
    for (lx, lz) in YARD_LAMPS:
        lamp(p, glow, lx, lz)
    x, z0, z1 = HITCH['x'], HITCH['z0'], HITCH['z1']
    if has('hitching_rail') and has('water_trough'):
        stand_fit(p, 'hitching_rail', (x, PAVE, (z0 + z1) / 2), math.pi / 2, z1 - z0, 0.42, 1.3)
        T = TROUGH
        stand_fit(p, 'water_trough', (T['x'], PAVE, T['z']), math.pi / 2, T['lz'], T['lx'], 0.9)
    else:
        hitching_rail(p)
    if has('crate_stack') and has('barrel_stack'):
        cx, cz = CRATES['x'], CRATES['z']
        stand(p, 'crate_stack', (cx - 0.4, PAVE, cz - 0.3), -0.35, 1.55)
        stand(p, 'barrel_stack', (cx + 0.9, PAVE, cz + 0.9), -1.2, 1.45)
        if has('grain_sacks'):
            stand(p, 'grain_sacks', (cx - 0.5, PAVE, cz + 0.85), -0.8, 0.85)
    else:
        crates(p)


def build(parts):
    y, glow = parts['GuildYard'], parts['GuildGlow']
    paving(y)
    gateway(y, glow)
    yard_props(y, glow)
    _ = cyl
