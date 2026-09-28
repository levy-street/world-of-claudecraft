"""The Mirefen tavern's furnishings, lights, trim and clutter (build_tavern.py calls
build(B, parts) with itself as B).

  TavernFurnishings  every piece of furniture the sim collides with, drawn at its collider:
                     the benches round the fire and round the nook, the tables, chairs and
                     stools, the high-backed settles of the booths and the fire, the barrel
                     racks behind the bar, the stage's chest, the kegs on the short counter,
                     the porch's bench and casks, the flower tubs at the steps' foot
  TavernLights       the lanterns hung under the hammer beams, the wheel chandelier over the
                     entry, the iron sconces, a candle on every table, the bar's candles, the
                     stage's footlights, the nook's crown, the hearth's fire (every tier)
  TavernTrim         medium and up: stretchers, iron bands and hoops, the candle cups
  TavernClutter      high and up: tankards and plates, bread and cheese, dice, cards, a game
                     board, the bard's lute, drum and stand, bottles on the racks, the kitchen's
                     pots and herbs, firewood, rugs, a broom, a sleeping cat

Every light and every hung thing over the common room stays over the camera's air (the
lanterns and the chandelier hang from the hammer beams and the collar, their undersides over
9.3 yards); nothing else stands higher than a settle's back away from the walls.
"""
import math


def build(B, parts):
    furnishings(B, parts['TavernFurnishings'], parts['TavernTrim'])
    lights(B, parts['TavernLights'], parts['TavernTrim'])
    clutter(B, parts['TavernClutter'])


def rot_xz(x, z, a):
    """A local offset turned by a yaw (three.js rotation.y)."""
    c, s = math.cos(a), math.sin(a)
    return (x * c + z * s, -x * s + z * c)


def piece_at(q, lx, lz):
    dx, dz = rot_xz(lx, lz, q['rot'])
    return q['x'] + dx, q['z'] + dz


def tbox(B, p, q, lx0, lx1, y0, y1, lz0, lz1, color, mat, bevel=0.0):
    """A box in a prop's own frame (turned by its yaw), y over the ground floor; bevelled
    (a chamfer on every edge that catches the light) when `bevel` is given."""
    if bevel > 0:
        cx, cz = piece_at(q, (lx0 + lx1) / 2, (lz0 + lz1) / 2)
        p.box((cx, (y0 + y1) / 2, cz), (lx1 - lx0, y1 - y0, lz1 - lz0), color, mat, bevel=bevel, yaw=q['rot'])
        return
    corners = []
    for (lx, lz) in ((lx0, lz0), (lx1, lz0), (lx1, lz1), (lx0, lz1)):
        corners.append(piece_at(q, lx, lz))
    pts = [(x, y0, z) for (x, z) in corners] + [(x, y1, z) for (x, z) in corners]
    B.hexa(p, pts, color, mat)


def leg(B, p, q, lx, lz, y0, y1, w, color):
    x, z = piece_at(q, lx, lz)
    B.post(p, x, z, y0, y1, w, color)


def turned_leg(B, p, x, z, y0, y1, r, color, ring_color):
    """A turned leg: a tapered shaft with a collar near its head and a foot."""
    p.cylinder((x, y0, z), (x, y1, z), r, color, B.WOOD, sides=6, r1=r * 0.8, caps=False)
    p.cylinder((x, y1 - 0.24, z), (x, y1 - 0.16, z), r * 1.25, ring_color, B.WOOD, sides=6)


# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------
def bench(B, p, trim, q):
    base, top = q['base'], q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    honey = B.PAL['honey']
    # a thick seat board on two slab ends
    tbox(B, p, q, -hw, hw, top - 0.14, top, -hd, hd, honey[1], B.WOOD)
    if hw > hd:
        for lx in (-hw + 0.22, hw - 0.22):
            tbox(B, p, q, lx - 0.08, lx + 0.08, base, top - 0.14, -hd + 0.03, hd - 0.03, B.PAL['beam'], B.WOOD)
        tbox(B, trim, q, -hw + 0.25, hw - 0.25, base + 0.25, base + 0.37, -0.05, 0.05, B.PAL['beam_dark'], B.WOOD)
    else:
        for lz in (-hd + 0.22, hd - 0.22):
            tbox(B, p, q, -hw + 0.03, hw - 0.03, base, top - 0.14, lz - 0.08, lz + 0.08, B.PAL['beam'], B.WOOD)
        tbox(B, trim, q, -0.05, 0.05, base + 0.25, base + 0.37, -hd + 0.25, hd - 0.25, B.PAL['beam_dark'], B.WOOD)
    # the fire's and the nook's benches wear garnet cushions
    if q['base'] < 0 or q.get('nook'):
        tbox(B, p, q, -hw + 0.12, hw - 0.12, top, top + 0.1, -hd + 0.06, hd - 0.06, B.PAL['garnet'], B.PLASTER)


def table(B, p, trim, q):
    base, top = q['base'], q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    long_x = hw >= hd
    # the top: planks along its long side, each its own tone, chamfered, a hairline between
    span = hd if long_x else hw
    n = max(2, int(round((span * 2 + 0.16) / 0.42)))
    for i in range(n):
        a = -span - 0.08 + (span * 2 + 0.16) * i / n + 0.006
        b = -span - 0.08 + (span * 2 + 0.16) * (i + 1) / n - 0.006
        col = B.pick(B.PAL['honey'], i * 3 + 2)
        if long_x:
            tbox(B, p, q, -hw - 0.08, hw + 0.08, top - 0.14, top, a, b, col, B.WOOD)
        else:
            tbox(B, p, q, a, b, top - 0.14, top, -hd - 0.08, hd + 0.08, col, B.WOOD)
    # the apron under it
    tbox(B, p, q, -hw + 0.05, hw - 0.05, top - 0.3, top - 0.14, -hd + 0.05, hd - 0.05, B.PAL['beam'], B.WOOD)
    if max(hw, hd) > min(hw, hd) * 1.5 and max(hw, hd) > 1.5:
        # a trestle table: two splayed trestles and a stretcher
        if long_x:
            for lx in (-hw + 0.45, hw - 0.45):
                tbox(B, p, q, lx - 0.14, lx + 0.14, base, base + 0.18, -hd + 0.1, hd - 0.1, B.PAL['beam_dark'],
                     B.WOOD)
                tbox(B, p, q, lx - 0.12, lx + 0.12, base + 0.18, top - 0.3, -0.12, 0.12, B.PAL['beam'], B.WOOD)
            tbox(B, trim, q, -hw + 0.45, hw - 0.45, base + 0.6, base + 0.76, -0.08, 0.08, B.PAL['beam_dark'], B.WOOD)
        else:
            for lz in (-hd + 0.45, hd - 0.45):
                tbox(B, p, q, -hw + 0.1, hw - 0.1, base, base + 0.18, lz - 0.14, lz + 0.14, B.PAL['beam_dark'],
                     B.WOOD)
                tbox(B, p, q, -0.12, 0.12, base + 0.18, top - 0.3, lz - 0.12, lz + 0.12, B.PAL['beam'], B.WOOD)
            tbox(B, trim, q, -0.08, 0.08, base + 0.6, base + 0.76, -hd + 0.45, hd - 0.45, B.PAL['beam_dark'], B.WOOD)
    else:
        for lx in (-hw + 0.2, hw - 0.2):
            for lz in (-hd + 0.2, hd - 0.2):
                x, z = piece_at(q, lx, lz)
                if hw == hd:
                    turned_leg(B, p, x, z, base, top - 0.3, 0.1, B.PAL['beam'], B.PAL['beam_dark'])
                else:
                    B.post(p, x, z, base, top - 0.3, 0.16, B.PAL['beam'])
        tbox(B, trim, q, -hw + 0.2, hw - 0.2, base + 0.3, base + 0.4, -0.05, 0.05, B.PAL['beam_dark'], B.WOOD)


def round_table(B, p, trim, q):
    base, top = q['base'], q['base'] + q['height']
    x, z, r = q['x'], q['z'], q['r']
    p.cylinder((x, top - 0.14, z), (x, top, z), r + 0.05, B.PAL['honey'][2], B.WOOD, sides=18)
    p.cylinder((x, top - 0.2, z), (x, top - 0.14, z), r - 0.05, B.PAL['beam'], B.WOOD, sides=18)
    p.cylinder((x, base + 0.3, z), (x, top - 0.2, z), 0.2, B.PAL['beam'], B.WOOD, sides=8, r1=0.16)
    p.cylinder((x, base + 0.45, z), (x, base + 0.55, z), 0.26, B.PAL['beam_dark'], B.WOOD, sides=8)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        B.beam(p, (x, base + 0.3, z), (x + math.sin(a) * r * 0.75, base + 0.05, z + math.cos(a) * r * 0.75), 0.2,
               0.16, B.PAL['beam_dark'])
    if r > 1.0:
        # a green baize circle for the dice
        p.cylinder((x, top, z), (x, top + 0.02, z), r - 0.2, (0.2, 0.36, 0.26), B.PLASTER, sides=18)


def chair(B, p, trim, q):
    base, seat = q['base'], q['base'] + q['height']
    r = q['r']
    tbox(B, p, q, -r, r, seat - 0.12, seat, -r, r, B.PAL['honey'][0], B.WOOD)
    for lx in (-r + 0.1, r - 0.1):
        for lz in (-r + 0.1, r - 0.1):
            leg(B, p, q, lx, lz, base, seat - 0.12, 0.12, B.PAL['beam'])
    # the back on the side away from the table (local -z), with a garnet slat
    for lx in (-r + 0.08, r - 0.08):
        leg(B, p, q, lx, -r + 0.08, seat, seat + 1.4, 0.13, B.PAL['beam'])
    tbox(B, p, q, -r, r, seat + 1.15, seat + 1.4, -r + 0.02, -r + 0.14, B.PAL['beam'], B.WOOD)
    tbox(B, p, q, -r + 0.12, r - 0.12, seat + 0.5, seat + 0.95, -r + 0.04, -r + 0.12, B.PAL['garnet'], B.PLASTER)
    tbox(B, trim, q, -r + 0.1, r - 0.1, base + 0.3, base + 0.38, r - 0.14, r - 0.06, B.PAL['beam_dark'], B.WOOD)


def stool(B, p, trim, q):
    base, seat = q['base'], q['base'] + q['height']
    x, z, r = q['x'], q['z'], q['r']
    p.cylinder((x, seat - 0.12, z), (x, seat, z), r, B.PAL['honey'][3], B.WOOD, sides=10)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.3
        B.beam(p, (x + math.sin(a) * r * 0.5, seat - 0.12, z + math.cos(a) * r * 0.5),
               (x + math.sin(a) * r * 0.85, base, z + math.cos(a) * r * 0.85), 0.1, 0.1, B.PAL['beam'])
    p.ring((x, base + 0.35, z), r * 0.72, 0.05, B.PAL['beam_dark'], segments=6, axis=(0, 1, 0), mat=B.WOOD)


def settle(B, p, trim, q):
    """A high-backed settle (the booths' seats and the one facing the wall fire): a plinth,
    a panelled apron under a chamfered seat board and a garnet cushion, a tall back framed
    in stiles and rails round fielded panels under a moulded capping rail, shaped arms."""
    base, seat = q['base'], q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    honey, beam, dark = B.PAL['honey'], B.PAL['beam'], B.PAL['beam_dark']
    back0, back1 = -hd - 0.12, -hd + 0.06
    top = seat + 1.8
    # the seat's body: a dark plinth, the carcass, the apron's panels on the front
    tbox(B, p, q, -hw, hw, base, base + 0.1, back1, hd - 0.02, dark, B.WOOD)
    tbox(B, p, q, -hw + 0.03, hw - 0.03, base + 0.1, seat - 0.1, back1, hd - 0.06, beam, B.WOOD)
    n = 3 if hw > 1.35 else 2
    for i in range(n):
        a = -hw + 0.14 + (2 * hw - 0.28) * i / n + 0.06
        b = -hw + 0.14 + (2 * hw - 0.28) * (i + 1) / n - 0.06
        tbox(B, p, q, a, b, base + 0.2, seat - 0.2, hd - 0.07, hd - 0.02, honey[1], B.WOOD)
    tbox(B, p, q, -hw, hw, seat - 0.1, seat, back1, hd + 0.05, honey[2], B.WOOD, bevel=0.025)
    tbox(B, p, q, -hw + 0.1, hw - 0.1, seat, seat + 0.13, back1 + 0.04, hd - 0.03, B.PAL['garnet'], B.PLASTER,
         bevel=0.035)
    # the back: a board, then stiles, rails and fielded panels on the seat's side
    tbox(B, p, q, -hw, hw, seat, top, back0, back1 - 0.04, honey[1], B.WOOD)
    m = 3 if hw > 1.35 else 2
    for i in range(m + 1):
        u = -hw + (2 * hw) * i / m
        tbox(B, p, q, max(-hw, u - 0.07), min(hw, u + 0.07), seat, top, back1 - 0.04, back1 + 0.02, beam, B.WOOD)
    for vv in (seat + 0.14, seat + 1.06, top - 0.1):
        tbox(B, p, q, -hw, hw, vv - 0.07, vv + 0.07, back1 - 0.04, back1 + 0.02, beam, B.WOOD)
    for i in range(m):
        a = -hw + (2 * hw) * i / m + 0.1
        b = -hw + (2 * hw) * (i + 1) / m - 0.1
        for (v0, v1) in ((seat + 0.24, seat + 0.96), (seat + 1.16, top - 0.2)):
            tbox(B, p, q, a, b, v0, v1, back1 - 0.04, back1 + 0.0, B.pick(honey, i + 1), B.WOOD)
    # the capping rail, moulded
    tbox(B, p, q, -hw - 0.06, hw + 0.06, top, top + 0.12, back0 - 0.06, back1 + 0.08, dark, B.WOOD, bevel=0.03)
    # the arms: a post and a shaped board at each end
    for lx in (-hw + 0.06, hw - 0.06):
        tbox(B, p, q, lx - 0.06, lx + 0.06, seat, seat + 0.62, hd - 0.2, hd - 0.06, dark, B.WOOD)
        tbox(B, p, q, lx - 0.08, lx + 0.08, seat + 0.62, seat + 0.72, back1, hd + 0.02, beam, B.WOOD)


def chest(B, p, trim, q):
    base, top = q['base'], q['base'] + q['height']
    hw, hd = q['hw'], q['hd']
    tbox(B, p, q, -hw, hw, base, top - 0.2, -hd, hd, B.PAL['honey'][1], B.WOOD)
    tbox(B, p, q, -hw - 0.03, hw + 0.03, top - 0.2, top, -hd - 0.03, hd + 0.03, B.PAL['beam'], B.WOOD, bevel=0.03)
    for lx in (-hw + 0.2, hw - 0.2):
        tbox(B, trim, q, lx - 0.05, lx + 0.05, base, top + 0.01, -hd - 0.04, hd + 0.04, B.PAL['iron'], B.METAL)
    tbox(B, trim, q, -0.1, 0.1, top - 0.35, top - 0.1, hd + 0.03, hd + 0.07, B.PAL['gold'], B.METAL)


def kegs(B, p, trim, q):
    """Two kegs on a cradle along the short counter behind the pillar."""
    x, z, top = q['x'], q['z'], q['base'] + q['height']
    for dz in (-0.3, 0.35):
        zz = z + dz
        tbox(B, p, dict(q, z=zz), -0.4, 0.4, top, top + 0.18, -0.08, 0.08, B.PAL['beam_dark'], B.WOOD)
        p.sweep([(x - 0.45, top + 0.5, zz), (x, top + 0.5, zz), (x + 0.45, top + 0.5, zz)], 0.34, 0.34,
                B.PAL['honey'][2], sides=10, radii=[0.3, 0.35, 0.3])
        for xx in (x - 0.3, x + 0.3):
            trim.ring((xx, top + 0.5, zz), 0.35, 0.06, B.PAL['iron'], segments=10, axis=(1, 0, 0), mat=B.METAL,
                      depth=0.04)
        p.cylinder((x + 0.45, top + 0.35, zz), (x + 0.62, top + 0.35, zz), 0.05, B.PAL['gold'], B.METAL, sides=6)


def barrel_end_on(B, p, trim, x, y, z0, z1, r, tone):
    """A barrel lying end-on to the room (its axis along z, its head at z1): bellied staves,
    two iron hoops, a darker head with its chime, a brass tap low on the head."""
    zm = (z0 + z1) / 2
    p.sweep([(x, y, z0), (x, y, zm), (x, y, z1)], r, r, tone, sides=10,
            radii=[r * 0.88, r, r * 0.88], color_fn=lambda i, k: B.scale_color(tone, 0.92 + 0.14 * (k % 2)))
    p.cylinder((x, y, z1 - 0.02), (x, y, z1 + 0.03), r * 0.8, B.scale_color(tone, 0.82), B.WOOD, sides=10)
    trim.ring((x, y, z1 - (z1 - z0) * 0.14), r * 0.93, 0.07, B.PAL['iron'], segments=10, axis=(0, 0, 1),
              mat=B.METAL, depth=0.04)
    p.cylinder((x, y - r * 0.5, z1), (x, y - r * 0.5, z1 + 0.18), 0.06, B.PAL['gold'], B.METAL, sides=5)
    p.box((x, y - r * 0.5 - 0.06, z1 + 0.16), (0.05, 0.12, 0.05), B.PAL['gold'], B.METAL)


def barrels(B, p, trim, q):
    """A barrel rack against the back wall behind the bar: an oak frame of uprights and
    cradles, two rows of barrels lying end-on to the room, a shelf board on top."""
    base, top = q['base'], q['base'] + q['height']
    x, z, hw, hd = q['x'], q['z'], q['hw'], q['hd']
    z0, z1 = z - hd, z + hd
    dark, beam = B.PAL['beam_dark'], B.PAL['beam']
    n = max(1, int((2 * hw - 0.3) / 1.35))
    bay = (2 * hw - 0.3) / n
    # the frame: uprights at the bays' edges, front and back, the cradle rails, the top board
    for i in range(n + 1):
        xp = x - hw + 0.15 + i * bay
        for zz in (z0 + 0.12, z1 - 0.12):
            B.abox(p, xp - 0.1, xp + 0.1, base, top - 0.12, zz - 0.1, zz + 0.1, beam, B.WOOD)
    rows = ((base + 0.78, 0.6), (base + 2.2, 0.56))
    for (yc, r) in rows:
        for zz in (z0 + 0.12, z1 - 0.12):
            B.abox(p, x - hw + 0.05, x + hw - 0.05, yc - r - 0.14, yc - r + 0.02, zz - 0.1, zz + 0.1, dark, B.WOOD)
    B.abox(p, x - hw, x + hw, top - 0.12, top, z0, z1 + 0.06, B.PAL['honey'][2], B.WOOD, bevel=0.02)
    B.abox(p, x - hw, x + hw, base, base + 0.12, z0, z1, dark, B.WOOD)
    # the back boards behind the barrels
    B.abox(p, x - hw, x + hw, base, top - 0.12, z0, z0 + 0.06, B.PAL['board'][3], B.WOOD)
    for j, (yc, r) in enumerate(rows):
        for i in range(n):
            xc = x - hw + 0.15 + (i + 0.5) * bay
            barrel_end_on(B, p, trim, xc, yc, z0 + 0.1, z1 + 0.02, min(r, bay / 2 - 0.05),
                          B.pick(B.PAL['honey'], i * 2 + j))


def cask(B, p, trim, q):
    """A barrel stood on its end (the porch's): bellied staves in two alternating tones; from
    medium up a darker head in its chime, two iron hoops and the bung on its belly turned by
    the prop's yaw, so no two in a row read alike."""
    base, top = q['base'], q['base'] + q['height']
    x, z, r, a = q['x'], q['z'], q['r'], q['rot']
    tone = B.pick(B.PAL['honey'], int(round(a * 5)))
    p.sweep([(x, base, z), (x, (base + top) / 2, z), (x, top, z)], r, r, tone, sides=10,
            radii=[r * 0.85, r, r * 0.85], phase=a,
            color_fn=lambda i, k: B.scale_color(tone, 0.9 + 0.16 * (k % 2)))
    trim.cylinder((x, top - 0.02, z), (x, top + 0.01, z), r * 0.74, B.scale_color(tone, 0.72), B.WOOD, sides=10,
                  phase=a)
    for f in (0.16, 0.84):
        rr = r * (0.85 + 0.15 * math.sin(math.pi * f)) + 0.012
        trim.ring((x, base + (top - base) * f, z), rr, 0.07, B.PAL['iron'], segments=10, axis=(0, 1, 0),
                  mat=B.METAL, depth=0.035)
    bx, bz = x + math.sin(a) * r, z + math.cos(a) * r
    trim.box((bx, (base + top) / 2, bz), (0.1, 0.1, 0.1), B.PAL['beam_dark'], B.WOOD, yaw=a)


def planter(B, p, trim, q):
    """A dressed-stone flower tub on the terrain at the foot of the porch steps: an eight-
    sided bowl flaring to its lip, sunk into the ground (every tier); a darker lip, the soil
    and a mound of greens from medium up (the flowers are clutter, tavern_facade.py)."""
    base, top = q['base'], q['base'] + q['height']
    x, z, r, a = q['x'], q['z'], q['r'], q['rot']
    stone = B.pick(B.PAL['ashlar'], int(round(a * 5)))
    p.cylinder((x, base - 0.35, z), (x, top, z), r * 0.72, stone, B.STONE, sides=8, r1=r, phase=a)
    trim.cylinder((x, top - 0.12, z), (x, top + 0.02, z), r + 0.05, B.PAL['ashlar_dark'], B.STONE, sides=8,
                  phase=a)
    trim.cylinder((x, top + 0.02, z), (x, top + 0.05, z), r - 0.06, (0.24, 0.17, 0.11), B.PLASTER, sides=8,
                  phase=a)
    greens = [(0.25, 0.4, 0.2), (0.31, 0.47, 0.23), (0.21, 0.35, 0.19)]
    for k in range(3):
        b = a + k * 2.1
        trim.rock_blob((x + math.sin(b) * r * 0.35, top + 0.2, z + math.cos(b) * r * 0.35), (0.5, 0.42, 0.5),
                       greens[k], B.PLASTER, jitter=0.2, subdivisions=0)


FURNITURE = {
    'bench': bench, 'table': table, 'roundTable': round_table, 'chair': chair, 'stool': stool,
    'settle': settle, 'chest': chest, 'barrels': barrels, 'cask': cask, 'planter': planter,
}


def furnishings(B, p, trim):
    T = B.TOWER
    for q in B.LAYOUT['props']:
        fn = FURNITURE.get(q['kind'])
        if q['kind'] == 'bench' and math.hypot(q['x'] - T['x'], q['z'] - T['z']) < T['rIn']:
            q = dict(q, nook=True)
        if fn:
            fn(B, p, trim, q)
        elif q['kind'] == 'counter' and q['hd'] > q['hw']:
            kegs(B, p, trim, q)


# ---------------------------------------------------------------------------
# Lights (the landmarks: every tier)
# ---------------------------------------------------------------------------
def candle(B, p, x, y, z, h=0.32, r=0.06):
    p.cylinder((x, y, z), (x, y + h, z), r, B.PAL['cream'], B.PLASTER, sides=6)
    p.box((x, y + h + 0.08, z), (0.07, 0.16, 0.07), B.PAL['candle'], B.GLOW, taper=0.2)


def table_candle(B, p, trim, x, y, z):
    """A candle in a brass holder with a drip pan and a glass chimney, on a table."""
    p.cylinder((x, y, z), (x, y + 0.04, z), 0.16, B.PAL['gold'], B.METAL, sides=8)
    p.cylinder((x, y + 0.04, z), (x, y + 0.14, z), 0.05, B.PAL['gold'], B.METAL, sides=6)
    candle(B, p, x, y + 0.14, z, h=0.24, r=0.055)
    p.cylinder((x, y + 0.14, z), (x, y + 0.62, z), 0.11, B.PAL['lamp'], B.GLOW, sides=6, caps=False, r1=0.09)


def wall_sconce(B, p, trim, q):
    """An iron candle sconce on a wall: a backplate, a curled arm out, a drip pan, the candle."""
    x, z, y, nx, nz = q['x'], q['z'], q['y'], q['nx'], q['nz']
    yaw = math.atan2(nx, nz)
    p.box((x + nx * 0.03, y - 0.1, z + nz * 0.03), (0.24, 0.62, 0.05), B.PAL['iron'], B.METAL, yaw=yaw, taper=0.7)
    tip = (x + nx * 0.36, y - 0.02, z + nz * 0.36)
    p.sweep([(x + nx * 0.04, y - 0.3, z + nz * 0.04), (x + nx * 0.2, y - 0.26, z + nz * 0.2),
             (x + nx * 0.33, y - 0.14, z + nz * 0.33), tip], 0.03, 0.03, B.PAL['iron'], sides=4, mat=B.METAL)
    p.cylinder((tip[0], y - 0.02, tip[2]), (tip[0], y + 0.03, tip[2]), 0.13, B.PAL['iron'], B.METAL, sides=8)
    candle(B, p, tip[0], y + 0.03, tip[2], h=0.3, r=0.06)


def lights(B, p, trim):
    from tavern_shell import TRUSS_COLLAR, lantern

    H = B.HALL
    iron = B.PAL['iron']
    # the lanterns under the hammer beams' ends, on short chains
    for q in B.LAYOUT['lanterns']:
        x, z, y = q['x'], q['z'], q['y']
        B.chain(p, (x, H['truss'], z), (x, y + 0.45, z), links=3)
        lantern(B, p, x, y, z, 0.42)
    # the wheel chandelier over the entry: four chains to an iron ring, a rod up to the
    # collar of the truss beside it
    c = B.LAYOUT['chandelier']
    cx, cy, cz, r = c['x'], c['y'], c['z'], c['r']
    p.ring((cx, cy, cz), r, 0.18, B.PAL['beam_dark'], segments=16, axis=(0, 1, 0), mat=B.WOOD, depth=0.22)
    p.ring((cx, cy + 0.05, cz), r + 0.05, 0.06, iron, segments=16, axis=(0, 1, 0), mat=B.METAL, depth=0.26)
    for k in range(6):
        a = k * math.pi / 3
        B.beam(p, (cx, cy, cz), (cx + math.sin(a) * r, cy, cz + math.cos(a) * r), 0.1, 0.1, B.PAL['beam_dark'],
               B.WOOD)
    p.cylinder((cx, cy - 0.25, cz), (cx, cy + 0.2, cz), 0.25, B.PAL['beam_dark'], B.WOOD, sides=8)
    p.box((cx, cy - 0.32, cz), (0.2, 0.14, 0.2), B.PAL['gold'], B.METAL, taper=0.4)
    for k in range(10):
        a = (k + 0.5) * 2 * math.pi / 10
        x, z = cx + math.sin(a) * r, cz + math.cos(a) * r
        p.cylinder((x, cy + 0.12, z), (x, cy + 0.2, z), 0.12, iron, B.METAL, sides=6)
        candle(B, p, x, cy + 0.2, z, h=0.36, r=0.07)
    hub = (cx, cy + 1.9, cz)
    p.ring(hub, 0.14, 0.05, iron, segments=8, axis=(0, 0, 1), mat=B.METAL)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        B.chain(p, (cx + math.sin(a) * r * 0.95, cy + 0.15, cz + math.cos(a) * r * 0.95), hub, links=6)
    truss_z = min(H['trusses'], key=lambda t: abs(t - cz))
    B.beam(p, (cx, hub[1] + 0.1, cz), (cx, TRUSS_COLLAR - 0.22, truss_z), 0.07, 0.07, iron, B.METAL)
    # the candles along the bar's long counter, in three clusters
    counter = next(q for q in B.LAYOUT['props'] if q['kind'] == 'counter' and q['hw'] > q['hd'])
    top = counter['base'] + counter['height']
    for dx in (-2.6, 0.2, 2.9):
        x, z = counter['x'] + dx, counter['z'] - 0.15
        p.cylinder((x, top, z), (x, top + 0.06, z), 0.22, iron, B.METAL, sides=8)
        for (ox, oz, h) in ((0, 0, 0.42), (0.13, 0.08, 0.3), (-0.12, 0.07, 0.24)):
            candle(B, p, x + ox, top + 0.06, z + oz, h=h)
    # the iron sconces on the walls
    for q in B.LAYOUT['sconces']:
        wall_sconce(B, p, trim, q)
    # a candle on every table (the dice table's by its cards, clear of the dice)
    for q in B.LAYOUT['props']:
        if q['kind'] not in ('table', 'roundTable'):
            continue
        x, z = q['x'], q['z']
        if q['kind'] == 'roundTable':
            x, z = x - 0.45, z + (0.3 if q['r'] > 1.0 else 0.4)
        table_candle(B, p, trim, x, q['base'] + q['height'], z)
    # the stage's footlights: candles in iron cups along its lip, a brass reflector behind each
    st = B.LAYOUT['stage']
    for k in range(5):
        x = st['x0'] + 0.7 + (st['x1'] - st['x0'] - 1.4) * k / 4
        z = st['z1'] - 0.3
        y = st['lift']
        p.cylinder((x, y, z), (x, y + 0.1, z), 0.17, iron, B.METAL, sides=8, r1=0.2)
        candle(B, p, x, y + 0.1, z, h=0.26, r=0.065)
        p.cylinder((x, y + 0.08, z + 0.16), (x, y + 0.42, z + 0.2), 0.16, B.PAL['gold'], B.METAL, sides=6, caps=False,
                   r1=0.2)
    # the kitchen's lamp behind the hatch, hung from its ceiling
    from tavern_frame import KITCHEN
    k = KITCHEN
    kx, kz = (k['x0'] + k['x1']) / 2 + 1.4, k['z0'] + 2.2
    B.chain(p, (kx, k['ceil'], kz), (kx, 4.25, kz), links=4)
    lantern(B, p, kx, 3.8, kz, 0.36)
    # the nook's crown: an iron ring of candles hung high in the tower's cone
    T = B.TOWER
    ny = T['wallTop'] + 0.8
    p.ring((T['x'], ny, T['z']), 1.0, 0.08, iron, segments=12, axis=(0, 1, 0), mat=B.METAL, depth=0.1)
    for k in range(6):
        a = k * math.pi / 3
        x, z = T['x'] + math.sin(a) * 1.0, T['z'] + math.cos(a) * 1.0
        p.cylinder((x, ny + 0.04, z), (x, ny + 0.1, z), 0.1, iron, B.METAL, sides=6)
        candle(B, p, x, ny + 0.1, z, h=0.3, r=0.065)
        if k % 2 == 0:
            B.beam(p, (x, ny + 0.05, z), (T['x'], ny + 2.4, T['z']), 0.04, 0.04, iron, B.METAL)
    B.beam(p, (T['x'], ny + 2.4, T['z']), (T['x'], T['peak'] - 1.4, T['z']), 0.06, 0.06, iron, B.METAL)
    # the hearth's bed of embers under the logs (the live flames over them are the game's
    # campfire flame, render/mirefen_tavern.ts MIREFEN_TAVERN_FLAMES)
    pit = B.LAYOUT['pit']
    d = -pit['depth']
    p.cylinder((pit['x'], d + 0.3, pit['z']), (pit['x'], d + 0.42, pit['z']), 0.95, B.PAL['ember'], B.GLOW,
               sides=10)
    for k in range(5):
        a = k * 1.3
        p.rock_blob((pit['x'] + math.sin(a) * 0.55, d + 0.45, pit['z'] + math.cos(a) * 0.55), (0.3, 0.12, 0.26),
                    B.PAL['fire'], B.GLOW, jitter=0.2)


# ---------------------------------------------------------------------------
# Clutter (high and up): nothing here is solid, so it keeps to tables, walls and corners
# ---------------------------------------------------------------------------
def mug(B, p, x, y, z, a=0.0):
    p.cylinder((x, y, z), (x, y + 0.3, z), 0.13, B.PAL['honey'][1], B.WOOD, sides=7, caps=False)
    p.cylinder((x, y + 0.24, z), (x, y + 0.29, z), 0.14, B.PAL['iron'], B.METAL, sides=7, caps=False)
    hx, hz = x + math.sin(a) * 0.18, z + math.cos(a) * 0.18
    p.box((hx, y + 0.16, hz), (0.06, 0.2, 0.06), B.PAL['honey'][2], B.WOOD, yaw=a)
    p.cylinder((x, y + 0.28, z), (x, y + 0.35, z), 0.125, B.PAL['foam'], B.PLASTER, sides=7, r1=0.1)


def hung_mug(B, p, x, y, z):
    """A tankard hung upside down from a hook by its handle (its top at y)."""
    p.cylinder((x, y - 0.5, z), (x, y - 0.16, z), 0.13, B.PAL['honey'][1], B.WOOD, sides=7)
    p.cylinder((x, y - 0.42, z), (x, y - 0.37, z), 0.14, B.PAL['iron'], B.METAL, sides=7, caps=False)
    p.box((x + 0.17, y - 0.3, z), (0.06, 0.22, 0.06), B.PAL['honey'][2], B.WOOD)
    p.box((x + 0.08, y - 0.1, z), (0.2, 0.05, 0.05), B.PAL['iron'], B.METAL)


def plate(B, p, x, y, z, food=None):
    p.cylinder((x, y, z), (x, y + 0.04, z), 0.28, B.PAL['cream'], B.PLASTER, sides=10)
    if food == 'bread':
        p.rock_blob((x, y + 0.14, z), (0.36, 0.2, 0.22), (0.72, 0.5, 0.26), B.PLASTER, jitter=0.1)
    elif food == 'cheese':
        p.cylinder((x, y + 0.04, z), (x, y + 0.2, z), 0.2, (0.92, 0.76, 0.34), B.PLASTER, sides=8)
    elif food == 'pie':
        p.cylinder((x, y + 0.04, z), (x, y + 0.16, z), 0.22, (0.78, 0.52, 0.26), B.PLASTER, sides=10, r1=0.2)


def bottle(B, p, x, y, z, col, s=1.0):
    p.cylinder((x, y, z), (x, y + 0.34 * s, z), 0.1 * s, col, B.METAL, sides=6)
    p.cylinder((x, y + 0.34 * s, z), (x, y + 0.5 * s, z), 0.045 * s, col, B.METAL, sides=6)


def jug(B, p, x, y, z, col):
    p.sweep([(x, y, z), (x, y + 0.22, z), (x, y + 0.5, z)], 0.16, 0.16, col, sides=7, radii=[0.13, 0.19, 0.08])


def rug(B, p, x, z, hw, hd, rot=0.0, y=0.0, field=None, border=None):
    """A woven rug: a dark border, a garnet field, a gold line round it and a lozenge in its
    middle, fringes on its short ends. (A few hundredths of a yard thick: never solid.)"""
    q = dict(x=x, z=z, rot=rot)
    field = field or B.PAL['garnet']
    border = border or B.PAL['garnet_dark']
    tbox(B, p, q, -hw, hw, y, y + 0.025, -hd, hd, border, B.PLASTER)
    tbox(B, p, q, -hw + 0.22, hw - 0.22, y + 0.025, y + 0.035, -hd + 0.22, hd - 0.22, B.PAL['gold'], B.PLASTER)
    tbox(B, p, q, -hw + 0.3, hw - 0.3, y + 0.035, y + 0.042, -hd + 0.3, hd - 0.3, field, B.PLASTER)
    # the lozenge
    cx, cz = x, z
    m = min(hw, hd) * 0.55
    pts = [piece_at(q, 0, -m * 1.3), piece_at(q, m, 0), piece_at(q, 0, m * 1.3), piece_at(q, -m, 0)]
    B.hexa(p, [(a, y + 0.042, b) for (a, b) in pts] + [(a, y + 0.05, b) for (a, b) in pts], B.PAL['cream'],
           B.PLASTER)
    m2 = m * 0.55
    pts = [piece_at(q, 0, -m2 * 1.3), piece_at(q, m2, 0), piece_at(q, 0, m2 * 1.3), piece_at(q, -m2, 0)]
    B.hexa(p, [(a, y + 0.05, b) for (a, b) in pts] + [(a, y + 0.056, b) for (a, b) in pts], B.PAL['garnet_dark'],
           B.PLASTER)
    # the fringes: a pale strip on each short end
    for sg in (-1, 1):
        if hw < hd:
            a, b = sorted((sg * hd, sg * (hd + 0.14)))
            tbox(B, p, q, -hw + 0.08, hw - 0.08, y, y + 0.014, a, b, B.PAL['cream'], B.PLASTER)
        else:
            a, b = sorted((sg * hw, sg * (hw + 0.14)))
            tbox(B, p, q, a, b, y, y + 0.014, -hd + 0.08, hd - 0.08, B.PAL['cream'], B.PLASTER)


def round_rug(B, p, x, z, r, y=0.0):
    p.cylinder((x, y, z), (x, y + 0.025, z), r, B.PAL['garnet_dark'], B.PLASTER, sides=20)
    p.cylinder((x, y + 0.025, z), (x, y + 0.035, z), r - 0.2, B.PAL['gold'], B.PLASTER, sides=20)
    p.cylinder((x, y + 0.035, z), (x, y + 0.042, z), r - 0.28, B.PAL['garnet'], B.PLASTER, sides=20)
    p.cylinder((x, y + 0.042, z), (x, y + 0.05, z), r * 0.35, B.PAL['cream'], B.PLASTER, sides=12)


def clutter(B, p):
    props = B.LAYOUT['props']
    by = {}
    for q in props:
        by.setdefault(q['kind'], []).append(q)
    T = B.TOWER
    # the long table: tankards, plates of bread and cheese, a rug under it
    t = next(q for q in by['table'] if q['hd'] > 2)
    top = t['base'] + t['height']
    for i, dz in enumerate((-1.6, -0.6, 0.5, 1.5)):
        mug(B, p, t['x'] + (0.35 if i % 2 else -0.35), top, t['z'] + dz, a=1.57 if i % 2 else -1.57)
    plate(B, p, t['x'], top, t['z'] - 1.1, 'bread')
    plate(B, p, t['x'], top, t['z'] + 1.1, 'cheese')
    rug(B, p, t['x'], t['z'], 2.2, 2.8)
    # the square table: tankards and a plate, a rug under it
    t = next(q for q in by['table'] if q['hd'] == q['hw'])
    top = t['base'] + t['height']
    for (dx, dz, a) in ((-0.5, 0.4, 3.1), (0.5, -0.3, 0.2), (0.45, 0.55, 1.2)):
        mug(B, p, t['x'] + dx, top, t['z'] + dz, a)
    plate(B, p, t['x'] - 0.3, top, t['z'] - 0.45, 'bread')
    rug(B, p, t['x'], t['z'], 1.9, 1.9, field=B.PAL['garnet_dark'], border=B.PAL['beam_dark'])
    # the booths' tables: tankards, a plate each, a runner under each booth
    for t in by['table']:
        if t['hd'] > 2 or t['hd'] == t['hw']:
            continue
        top = t['base'] + t['height']
        x, z = t['x'], t['z']
        if t['hw'] > t['hd']:
            mug(B, p, x - 0.75, top, z - 0.25, 0.8)
            mug(B, p, x + 0.75, top, z + 0.25, 2.4)
            plate(B, p, x - 0.45, top, z + 0.3, 'pie')
            rug(B, p, x + 0.2, z, 1.7, 2.3, field=B.PAL['garnet_dark'], border=B.PAL['beam_dark'])
        else:
            mug(B, p, x - 0.28, top, z - 0.75, 0.8)
            mug(B, p, x + 0.28, top, z + 0.8, 2.4)
            plate(B, p, x + 0.2, top, z - 0.45, 'bread')
            rug(B, p, x, z - 0.3, 2.2, 1.3, field=B.PAL['garnet_dark'], border=B.PAL['beam_dark'])
    # the dice table: dice, a cup, a stack of coins, cards, a round rug under it
    d = next(q for q in by['roundTable'] if q['r'] > 1.0)
    top = d['base'] + d['height'] + 0.02
    for k, (dx, dz) in enumerate(((0.1, 0.2), (-0.25, 0.05), (0.3, -0.25))):
        p.box((d['x'] + dx, top + 0.08, d['z'] + dz), (0.16, 0.16, 0.16), B.PAL['bone'], B.PLASTER, yaw=k * 0.6)
    p.cylinder((d['x'] - 0.55, top, d['z'] - 0.3), (d['x'] - 0.55, top + 0.4, d['z'] - 0.3), 0.16,
               B.PAL['beam_dark'], B.WOOD, sides=8, r1=0.18)
    for k in range(5):
        p.cylinder((d['x'] + 0.55, top + k * 0.04, d['z'] + 0.3), (d['x'] + 0.55, top + k * 0.04 + 0.035,
                   d['z'] + 0.3), 0.09, B.PAL['gold'], B.METAL, sides=8)
    for k in range(3):
        p.box((d['x'] - 0.2 + k * 0.25, top + 0.01, d['z'] + 0.62), (0.2, 0.01, 0.3), B.PAL['cream'], B.PLASTER,
              yaw=k * 0.4 - 0.4)
    mug(B, p, d['x'] + 0.1, top - 0.02, d['z'] - 0.7, 0.0)
    round_rug(B, p, d['x'], d['z'], 2.3)
    # the nook's tables: a game board with its pieces, a pipe and an open book
    nook_tables = [q for q in by['roundTable'] if math.hypot(q['x'] - T['x'], q['z'] - T['z']) < T['rIn']]
    for i, t in enumerate(nook_tables):
        top = t['base'] + t['height']
        if i == 0:
            bx, bz = t['x'] + 0.15, t['z'] - 0.2
            p.box((bx, top + 0.03, bz), (0.9, 0.06, 0.9), B.PAL['beam_dark'], B.WOOD, bevel=0.015)
            for a in range(4):
                for b in range(4):
                    if (a + b) % 2 == 0:
                        p.box((bx - 0.33 + a * 0.22, top + 0.065, bz - 0.33 + b * 0.22), (0.2, 0.01, 0.2),
                              B.PAL['cream'], B.PLASTER)
            for (a, b, c) in ((0, 0, 0), (1, 2, 0), (3, 1, 1), (2, 3, 1), (0, 3, 1)):
                col = B.PAL['garnet'] if c else B.PAL['bone']
                p.cylinder((bx - 0.33 + a * 0.22, top + 0.07, bz - 0.33 + b * 0.22),
                           (bx - 0.33 + a * 0.22, top + 0.2, bz - 0.33 + b * 0.22), 0.07, col, B.PLASTER, sides=6,
                           r1=0.04)
            mug(B, p, t['x'] + 0.5, top, t['z'] + 0.45, 2.0)
        else:
            p.box((t['x'] + 0.1, top + 0.05, t['z'] - 0.25), (0.62, 0.08, 0.44), B.PAL['garnet_dark'], B.WOOD,
                  yaw=0.4)
            p.box((t['x'] + 0.1, top + 0.1, t['z'] - 0.25), (0.56, 0.03, 0.4), B.PAL['parchment'], B.PLASTER,
                  yaw=0.4)
            p.cylinder((t['x'] + 0.4, top, t['z'] + 0.3), (t['x'] + 0.4, top + 0.22, t['z'] + 0.3), 0.09,
                       B.PAL['cream'], B.PLASTER, sides=8)
            B.beam(p, (t['x'] - 0.05, top + 0.03, t['z'] + 0.25), (t['x'] + 0.2, top + 0.06, t['z'] + 0.45), 0.04,
                   0.04, B.PAL['beam_dark'])
    # the bar: tankards along the long counter, bottles at its end, tankards hung from the
    # beam over it
    c = next(q for q in by['counter'] if q['hw'] > q['hd'])
    top = c['base'] + c['height']
    for dx in (-3.0, -1.3, 1.1, 3.4):
        mug(B, p, c['x'] + dx, top, c['z'] + 0.25, 3.1)
    for k, dx in enumerate((-3.4, -3.2, -3.0)):
        bottle(B, p, c['x'] + dx, top, c['z'] - 0.25, (B.PAL['verdigris'], B.PAL['glass'], B.PAL['garnet_dark'])[k])
    pillar = by['pillar'][0]
    for i in range(6):
        hung_mug(B, p, pillar['x'] + 2.0 + i * 1.5 - 0.08, B.HALL['truss'] - 0.28, pillar['z'])
    # bottles, jugs and crocks along the barrel racks' top shelves
    for q in by['barrels']:
        y = q['base'] + q['height']
        x = q['x'] - q['hw'] + 0.3
        k = 0
        while x < q['x'] + q['hw'] - 0.3:
            col = (B.PAL['verdigris'], B.PAL['glass'], B.PAL['garnet_dark'], B.PAL['cream'])[k % 4]
            if k % 4 == 3:
                jug(B, p, x, y, q['z'] + 0.1, B.PAL['cream'])
            else:
                bottle(B, p, x, y, q['z'] + 0.15 * ((k % 3) - 1), col, 1.0 + 0.15 * (k % 2))
            x += 0.36 + (k % 3) * 0.08
            k += 1
    # the bard's stage: a lute leaning on the stool, a songbook on it, a music stand, a frame
    # drum on the chest, a runner down the deck
    st = B.LAYOUT['stage']
    s = next(q for q in by['stool'] if q['base'] > 0.3)
    lx, ly, lz = s['x'] - 0.3, s['base'] + 0.9, s['z'] + 0.55
    p.rock_blob((lx, ly - 0.1, lz), (0.55, 0.7, 0.2), B.PAL['honey'][2], B.WOOD, jitter=0.04)
    p.cylinder((lx, ly - 0.1, lz + 0.11), (lx, ly - 0.1, lz + 0.12), 0.12, B.PAL['soot'], B.WOOD, sides=8)
    B.beam(p, (lx, ly + 0.2, lz), (lx + 0.1, ly + 1.2, lz - 0.05), 0.1, 0.06, B.PAL['beam_dark'])
    p.box((lx + 0.12, ly + 1.3, lz - 0.06), (0.14, 0.24, 0.08), B.PAL['beam_dark'], B.WOOD, roll=0.1)
    for k in range(4):
        B.beam(p, (lx - 0.02 + k * 0.012, ly + 0.25, lz + 0.1), (lx + 0.08 + k * 0.012, ly + 1.15, lz + 0.03), 0.008,
               0.008, B.PAL['bone'])
    p.box((s['x'] + 0.05, s['base'] + s['height'] + 0.04, s['z']), (0.42, 0.08, 0.32), B.PAL['garnet_dark'], B.WOOD,
          yaw=0.3)
    mx, mz = s['x'] + 1.3, s['z'] + 0.9
    B.post(p, mx, mz, st['lift'], st['lift'] + 1.9, 0.07, B.PAL['iron'], B.METAL)
    p.box((mx, st['lift'] + 2.05, mz), (0.7, 0.5, 0.06), B.PAL['beam'], B.WOOD, pitch=-0.4)
    p.box((mx, st['lift'] + 2.08, mz + 0.03), (0.55, 0.38, 0.02), B.PAL['parchment'], B.PLASTER, pitch=-0.4)
    for k in range(3):
        a = k * 2 * math.pi / 3
        B.beam(p, (mx, st['lift'] + 0.4, mz), (mx + math.sin(a) * 0.35, st['lift'], mz + math.cos(a) * 0.35), 0.05,
               0.05, B.PAL['iron'], B.METAL)
    ch = by['chest'][0]
    dy = ch['base'] + ch['height']
    p.cylinder((ch['x'], dy, ch['z']), (ch['x'], dy + 0.22, ch['z']), 0.42, B.PAL['honey'][0], B.WOOD, sides=12)
    p.cylinder((ch['x'], dy + 0.22, ch['z']), (ch['x'], dy + 0.24, ch['z']), 0.4, B.PAL['cream'], B.PLASTER,
               sides=12)
    rug(B, p, (st['x0'] + st['x1']) / 2 + 0.3, (st['z0'] + st['z1']) / 2 + 0.2, 2.0, 1.4, y=st['lift'])
    # the hearth rug before the wall fire
    fire = by['fireplace'][0]
    rug(B, p, fire['x'] - fire['hw'] - 1.4, fire['z'], 0.9, 1.6, field=B.PAL['garnet_dark'],
        border=B.PAL['beam_dark'])
    # firewood stacked by the wall fire and at the pit's edge
    fx = fire['x'] - fire['hw'] - 0.55
    for row in range(3):
        for k in range(4 - row):
            zz = fire['z'] + fire['hd'] + 0.55
            y = 0.18 + row * 0.3
            xx = fx - 0.15 + (k + row * 0.5) * 0.3 - 0.45
            p.cylinder((xx, y, zz - 0.45), (xx, y, zz + 0.45), 0.14, B.PAL['beam'], B.WOOD, sides=6)
    pit = B.LAYOUT['pit']
    for k in range(3):
        a = math.radians(-140 + k * 12)
        x, z = pit['x'] + math.sin(a) * (pit['r'] - 0.35), pit['z'] + math.cos(a) * (pit['r'] - 0.35)
        p.cylinder((x - 0.4, -pit['depth'] + 0.15, z), (x + 0.4, -pit['depth'] + 0.15, z), 0.14, B.PAL['beam'],
                   B.WOOD, sides=6)
    # a cat asleep on the warm flags by the hearth
    a = math.radians(150)
    cx, cz = pit['x'] + math.sin(a) * 2.35, pit['z'] + math.cos(a) * 2.35
    cy = -pit['depth']
    p.rock_blob((cx, cy + 0.2, cz), (0.75, 0.38, 0.5), (0.86, 0.52, 0.24), B.PLASTER, jitter=0.05)
    p.rock_blob((cx + 0.34, cy + 0.28, cz + 0.12), (0.3, 0.28, 0.3), (0.86, 0.52, 0.24), B.PLASTER, jitter=0.05)
    p.sweep([(cx - 0.35, cy + 0.12, cz), (cx - 0.2, cy + 0.08, cz + 0.4), (cx + 0.15, cy + 0.08, cz + 0.45)], 0.07,
            0.05, (0.8, 0.46, 0.2), sides=5, mat=B.PLASTER)
    # the kitchen behind the hatch: a copper pot on the range, pans on the breast, jars on a
    # shelf, herbs from the joists, a loaf and a knife on the cook's table
    from tavern_frame import KITCHEN
    k = KITCHEN
    xm = (k['x0'] + k['x1']) / 2
    p.cylinder((xm - 0.6, 1.36, k['z0'] + 0.55), (xm - 0.6, 1.9, k['z0'] + 0.55), 0.34, B.PAL['copper'], B.METAL,
               sides=10, r1=0.3)
    p.cylinder((xm + 0.6, 1.36, k['z0'] + 0.55), (xm + 0.6, 1.62, k['z0'] + 0.55), 0.28, B.PAL['iron'], B.METAL,
               sides=10)
    for i, dx in enumerate((-0.9, -0.3, 0.3, 0.9)):
        x = xm + dx
        p.cylinder((x, 3.0 - 0.3 * (i % 2), k['z0'] + 0.76), (x, 3.0 - 0.3 * (i % 2), k['z0'] + 0.8), 0.24 - 0.03 * i,
                   B.PAL['copper_dark'] if i % 2 else B.PAL['copper'], B.METAL, sides=10)
        p.box((x, 3.35 - 0.15 * (i % 2), k['z0'] + 0.78), (0.05, 0.5 - 0.2 * (i % 2), 0.03), B.PAL['iron'], B.METAL)
    for side, xs in ((1, k['x0'] + 0.25), (-1, k['x1'] - 0.25)):
        B.abox(p, xs - 0.25, xs + 0.25, 2.6, 2.66, k['z0'] + 0.4, k['z1'] - 0.2, B.PAL['beam'], B.WOOD)
        zz = k['z0'] + 0.7
        j = 0
        while zz < k['z1'] - 0.4:
            jug(B, p, xs, 2.66, zz, (B.PAL['cream'], B.PAL['verdigris'], B.PAL['river'][0])[j % 3])
            zz += 0.9
            j += 1
    for i in range(5):
        x = k['x0'] + 1.2 + i * 1.3
        B.beam(p, (x, k['ceil'], -15.2), (x, k['ceil'] - 1.0, -15.2), 0.04, 0.04, B.PAL['beam_dark'])
        p.rock_blob((x, k['ceil'] - 1.15, -15.2), (0.3, 0.4, 0.3), (0.42, 0.52, 0.28), B.PLASTER, jitter=0.25)
    tz = k['z0'] + 2.55
    p.rock_blob((xm - 0.3, 1.52, tz), (0.5, 0.24, 0.3), (0.72, 0.5, 0.26), B.PLASTER, jitter=0.1)
    p.box((xm + 0.4, 1.44, tz + 0.1), (0.5, 0.03, 0.08), B.PAL['iron_hi'], B.METAL, yaw=0.5)
    # a broom and a bucket by the door, sacks by the bar's end
    B.beam(p, (-5.6, 0.0, 12.7), (-5.3, 2.4, 13.05), 0.06, 0.06, B.PAL['beam'])
    p.box((-5.65, 0.3, 12.65), (0.4, 0.6, 0.25), (0.72, 0.6, 0.3), B.PLASTER, taper=0.6)
    p.cylinder((-5.0, 0.0, 12.75), (-5.0, 0.5, 12.75), 0.24, B.PAL['beam'], B.WOOD, sides=8, r1=0.28)
    for k_, (x, z) in enumerate(((14.4, -3.4), (14.7, -2.7))):
        p.rock_blob((x, 0.45, z), (0.7, 0.9, 0.6), (0.72, 0.62, 0.44), B.PLASTER, jitter=0.08)
    # outside by the porch: a crate against the stone base (the casks stand on the porch,
    # the sim's TAVERN_PROPS)
    g = B.ground(-5.8, 14.9)
    p.box((-5.8, g + 0.55, 14.9), (1.1, 1.1, 1.1), B.PAL['honey'][2], B.WOOD, yaw=0.3)
    p.box((-5.6, g + 1.45, 14.8), (0.7, 0.7, 0.7), B.PAL['honey'][0], B.WOOD, yaw=-0.2)
