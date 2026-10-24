"""The Highwatch adventurers' guild (Lantern Hall): every dimension the build, the collision and
the runtime read.

Model frame (yards), the painted Tidehold buildings': origin on the ground line under the great hall's middle, +y
up, +x to the left of a visitor walking in, +z into the house; the front door looks out along
-z. The footing runs a yard under the ground line (y -1), the painted Tidehold convention the
town's placement buries (sim/placed_town_kit.ts). The town turns the model a quarter so the
door looks east, down the old stables road toward the square (sim/highwatch_layout.ts).

One storey everywhere (the Highwatch manor's lesson: two-storey interiors were cramped and fought the
camera): a great hall 28 x 20 inside with walls of 10.5 and an open timber roof to 19, the
contracts board on its left wall, the quartermaster's counter on its right, the recruitment
table and the guildmaster's hearth at the back; behind it, through a round arch, the trophy
hall with a plaque for each five-player dungeon; a columned porch, a lantern tower at the
front's left corner, and a paved yard where the road ends.
"""

FLOOR = 0.6          # the house floor over the ground line (a stone plinth under it)
FOOT = -1.0          # the footing's bottom

# --- the great hall ------------------------------------------------------------------------
HALL = dict(x0=-14.0, x1=14.0, z0=-10.0, z1=10.0, t=0.9,
            plate=FLOOR + 10.5,   # the wall plate
            ridge=FLOOR + 19.0,   # the ridge
            truss=FLOOR + 11.0)   # nothing of the open roof hangs lower than this
HALL['ox0'], HALL['ox1'] = HALL['x0'] - HALL['t'], HALL['x1'] + HALL['t']
HALL['oz0'], HALL['oz1'] = HALL['z0'] - HALL['t'], HALL['z1'] + HALL['t']
HALL_PITCH = (HALL['ridge'] - HALL['plate']) / HALL['oz1']   # rise per yard of the main roof
EAVE_OUT = 1.35       # the great roof's eaves past the walls (deep, the roof the hero)
VERGE_OUT = 0.85     # and past the gables
TRUSS_X = (-10.5, -3.5, 3.5, 10.5)
# the oak pilaster under each truss end, against the front and back walls, from a stone base on the
# floor up to the plate: its half width and depth, its base's, how high the base stands, and how far
# the pilaster stands off the wall's inner face
PILASTER = dict(half=0.32, depth=0.22, base_half=0.42, base_depth=0.3, base_h=0.45, off=0.14)

DOOR = dict(x0=-1.9, x1=1.9, head=FLOOR + 5.6)            # the front door: 3.8 x 5.6
ARCH_TROPHY = dict(x0=-4.2, x1=4.2, head=FLOOR + 8.0)     # the hall to the trophy hall

# --- the trophy hall behind the great hall -------------------------------------------------
TROPHY = dict(x0=-8.5, x1=8.5, z0=HALL['oz1'], z1=20.0, t=0.9, plate=FLOOR + 9.0)
TROPHY['ox0'], TROPHY['ox1'] = TROPHY['x0'] - TROPHY['t'], TROPHY['x1'] + TROPHY['t']
TROPHY['oz1'] = TROPHY['z1'] + TROPHY['t']
TROPHY_PITCH = 0.62
TROPHY_OUT = 0.8

# --- the hearths -----------------------------------------------------------------------------
# the guildmaster's fireplace in the great hall's right gable wall (-x), behind the counter
HEARTH = dict(z0=4.4, z1=8.8, depth=1.3, opening=FLOOR + 2.6, mantel=FLOOR + 3.4,
              hood_top=FLOOR + 9.6)
# the trophy hall's fireplace in its back wall, under the wyrm's skull
TROPHY_HEARTH = dict(x0=-2.6, x1=2.6, depth=1.2, opening=FLOOR + 2.4, mantel=FLOOR + 3.2,
                     hood_top=FLOOR + 8.4)

# --- the lantern tower at the front's left corner ------------------------------------------
TOWER = dict(x0=HALL['ox1'], x1=HALL['ox1'] + 6.6, z0=HALL['oz0'], z1=HALL['oz0'] + 6.6,
             plate=FLOOR + 20.0, belfry=FLOOR + 24.2, spire=FLOOR + 31.5)
TOWER['cx'] = (TOWER['x0'] + TOWER['x1']) / 2
TOWER['cz'] = (TOWER['z0'] + TOWER['z1']) / 2

# --- the porch -------------------------------------------------------------------------------
PORCH = dict(x0=-6.5, x1=6.5, z0=-17.2, z1=HALL['oz0'], beam=FLOOR + 7.4, ridge=FLOOR + 12.4)
STEPS = dict(x0=-4.6, x1=4.6, z0=-19.0, z1=PORCH['z0'])
COLUMNS = [(-5.6, -16.4), (-2.9, -16.4), (2.9, -16.4), (5.6, -16.4)]
COLUMN_R = 0.5

# --- the yard ---------------------------------------------------------------------------------
YARD = dict(x0=-16.0, x1=TOWER['x1'] + 0.6, z0=-25.0, z1=HALL['oz0'])
# the right-hand lamp frames the steps; the left one gave way to the guild's gateway
YARD_LAMPS = [(9.0, -23.4)]
# The guild's gateway, where the spur road comes into the yard (the road crosses the yard's
# front edge about x -8): two oak posts on ashlar feet, a carved beam with iron straps, the
# name board hung under it on chains (render/highwatch_guild_sign.ts paints the localized
# name on both faces, at the text anchor below), the guild's seal standing on the beam, and an
# iron lantern at either end. The posts stand clear of the road's width; the board hangs
# well over head height.
GATE = dict(x=-8.0, z=-24.3, half=4.6, post=0.56, foot=1.15, foot_h=0.95, top=6.1,
            beam_y0=5.15, beam_y1=5.85, board_x=3.1, board_y0=3.35, board_y1=4.75, board_t=0.18,
            text_w=5.6, text_h=1.18, text_y=4.05, lantern_y=4.75)
HITCH = dict(x=-12.6, z0=-21.0, z1=-15.0)          # the old stable yard's hitching rail
TROUGH = dict(x=-12.6, z=-12.8, lx=1.3, lz=3.2)
CRATES = dict(x=14.0, z=-13.0)

# --- the furnishings the NPCs and the collision read ---------------------------------------
BOARD = dict(x=HALL['x1'], z0=-4.2, z1=4.2, y0=FLOOR + 1.3, y1=FLOOR + 6.7)   # left wall
BOARD_DESK = dict(x0=10.4, x1=11.6, z0=-1.4, z1=1.4)
COUNTER = dict(x0=-11.6, x1=-10.6, z0=-4.6, z1=3.4)                          # right side
RECRUIT_TABLE = dict(x0=4.2, x1=10.4, z0=4.6, z1=7.4)                       # back left
FRONT_TABLES = [(7.6, -5.4), (-6.4, -5.4)]

# --- the trophy plaques (render reads the node names; sim/highwatch_guild.ts the dungeons) ---
# dungeon id: (centre x, centre y, centre z, the wall's inward normal (dx, dz))
TROPHY_Y = FLOOR + 5.2
TROPHY_SLOTS = {
    'hollow_crypt': (TROPHY['x1'], TROPHY_Y, 13.4, (-1.0, 0.0)),
    'sunken_bastion': (TROPHY['x1'], TROPHY_Y, 17.4, (-1.0, 0.0)),
    'drowned_temple': (TROPHY['x0'], TROPHY_Y, 13.4, (1.0, 0.0)),
    'wildheart_basin': (TROPHY['x0'], TROPHY_Y, 17.4, (1.0, 0.0)),
    # on the face of the hearth's breast, over the mantel
    'gravewyrm_sanctum': (0.0, FLOOR + 6.4, TROPHY['z1'] - TROPHY_HEARTH['depth'], (0.0, -1.0)),
}

# the whole model's ground extents (eaves included), for the sim's reach
REACH = dict(x0=-16.2, x1=TOWER['x1'] + 0.8, z0=YARD['z0'] - 0.1,
             z1=TROPHY['oz1'] + TROPHY_OUT + 0.1)


def collision_boxes():
    """The solid boxes a player bumps into, in model yards over the ground line:
    (name, x0, x1, y0, y1, z0, z1). Walls run from the footing to the plate; the floor is the
    decks', never a box."""
    H, T, W = HALL, TROPHY, TOWER
    out = []

    def add(name, x0, x1, y0, y1, z0, z1):
        out.append((name, x0, x1, y0, y1, z0, z1))

    # the great hall: the front wall either side of the door and its lintel
    add('hall_front_l', DOOR['x1'], H['ox1'], FOOT, H['plate'], H['oz0'], H['z0'])
    add('hall_front_r', H['ox0'], DOOR['x0'], FOOT, H['plate'], H['oz0'], H['z0'])
    add('hall_door_lintel', DOOR['x0'], DOOR['x1'], DOOR['head'], H['plate'], H['oz0'], H['z0'])
    # the back wall either side of the trophy arch, and over it
    add('hall_back_l', ARCH_TROPHY['x1'], H['ox1'], FOOT, H['plate'], H['z1'], H['oz1'])
    add('hall_back_r', H['ox0'], ARCH_TROPHY['x0'], FOOT, H['plate'], H['z1'], H['oz1'])
    add('hall_arch_head', ARCH_TROPHY['x0'], ARCH_TROPHY['x1'], ARCH_TROPHY['head'], H['plate'],
        H['z1'], H['oz1'])
    # the gable walls
    add('hall_side_l', H['x1'], H['ox1'], FOOT, H['plate'], H['z0'], H['z1'])
    add('hall_side_r', H['ox0'], H['x0'], FOOT, H['plate'], H['z0'], H['z1'])
    # the guildmaster's hearth, its breast proud of the back wall
    add('hall_hearth', H['x0'], H['x0'] + HEARTH['depth'], FOOT, HEARTH['hood_top'], HEARTH['z0'], HEARTH['z1'])
    # the trophy hall
    add('trophy_l', T['x1'], T['ox1'], FOOT, T['plate'], H['oz1'], T['oz1'])
    add('trophy_r', T['ox0'], T['x0'], FOOT, T['plate'], H['oz1'], T['oz1'])
    add('trophy_back', T['ox0'], T['ox1'], FOOT, T['plate'], T['z1'], T['oz1'])
    add('trophy_hearth', TROPHY_HEARTH['x0'], TROPHY_HEARTH['x1'], FOOT, TROPHY_HEARTH['hood_top'],
        T['z1'] - TROPHY_HEARTH['depth'], T['z1'])
    # the lantern tower: solid, the front's left corner
    add('tower', W['x0'], W['x1'], FOOT, W['plate'], W['z0'], W['z1'])
    # the truss pilasters on their bases, against the front and back walls (the pair at the trophy
    # arch stands in its mouth, where a player walks past it): body-high, what a player bumps,
    # while the camera's air keeps its own clearance off the walls above
    P = PILASTER
    for x in TRUSS_X:
        for sz in (1, -1):
            zf = sz * (H['z1'] - P['off'])
            zb = zf - sz * P['base_depth']
            add('hall_pilaster', x - P['base_half'], x + P['base_half'], FOOT, FLOOR + 2.0, min(zf, zb), max(zf, zb))
    # the two chimney stacks outside the walls (the hearth's up the right gable, the trophy
    # hall's behind its back wall)
    hz = (HEARTH['z0'] + HEARTH['z1']) / 2
    add('hall_chimney', H['ox0'] - 1.6, H['ox0'], FOOT, H['plate'], hz - 1.3, hz + 1.3)
    add('trophy_chimney', -1.1, 1.1, FOOT, T['plate'], T['oz1'], T['oz1'] + 1.4)
    # the furnishings a player would walk into
    add('board_desk', BOARD_DESK['x0'], BOARD_DESK['x1'], FOOT, FLOOR + 1.2, BOARD_DESK['z0'], BOARD_DESK['z1'])
    add('counter', COUNTER['x0'], COUNTER['x1'], FOOT, FLOOR + 1.25, COUNTER['z0'], COUNTER['z1'])
    add('recruit_table', RECRUIT_TABLE['x0'], RECRUIT_TABLE['x1'], FOOT, FLOOR + 1.0, RECRUIT_TABLE['z0'],
        RECRUIT_TABLE['z1'])
    for i, (fx, fz) in enumerate(FRONT_TABLES):
        add(f'front_table_{i}', fx - 2.6, fx + 2.6, FOOT, FLOOR + 1.0, fz - 0.8, fz + 0.8)
    add('qm_shelves', H['x0'], H['x0'] + 0.8, FOOT, FLOOR + 4.2, -4.6, 3.4)
    add('racks_front_l', 9.0, H['x1'], FOOT, FLOOR + 2.2, H['z0'], H['z0'] + 0.8)
    add('racks_front_r', H['x0'], -9.0, FOOT, FLOOR + 2.2, H['z0'], H['z0'] + 0.8)
    # the porch's columns
    for i, (cx, cz) in enumerate(COLUMNS):
        add(f'column_{i}', cx - COLUMN_R, cx + COLUMN_R, FOOT, PORCH['beam'], cz - COLUMN_R, cz + COLUMN_R)
    # the yard: lamps, the signpost, the hitching rail, the trough, the crates
    for i, (lx, lz) in enumerate(YARD_LAMPS):
        add(f'yard_lamp_{i}', lx - 0.3, lx + 0.3, FOOT, 4.2, lz - 0.3, lz + 0.3)
    g = GATE
    for i, sx in enumerate((-1, 1)):
        px = g['x'] + sx * g['half']
        add(f'gate_post_{i}', px - g['foot'] / 2, px + g['foot'] / 2, FOOT, g['top'], g['z'] - g['foot'] / 2,
            g['z'] + g['foot'] / 2)
    add('hitch_rail', HITCH['x'] - 0.2, HITCH['x'] + 0.2, FOOT, 1.2, HITCH['z0'], HITCH['z1'])
    add('trough', TROUGH['x'] - TROUGH['lx'] / 2, TROUGH['x'] + TROUGH['lx'] / 2, FOOT, 0.9,
        TROUGH['z'] - TROUGH['lz'] / 2, TROUGH['z'] + TROUGH['lz'] / 2)
    add('crates', CRATES['x'] - 1.4, CRATES['x'] + 1.4, FOOT, 1.6, CRATES['z'] - 1.2, CRATES['z'] + 1.2)
    return out


def decks():
    """The walkable floors: (name, x0, x1, z0, z1, y_low, y_high, axis) where a sloped deck
    rises from y_low to y_high along `axis` ('z' rises toward +z)."""
    H, T = HALL, TROPHY
    return [
        ('hall', H['ox0'], H['ox1'], H['oz0'], H['oz1'], FLOOR, FLOOR, None),
        ('trophy_hall', T['ox0'], T['ox1'], H['oz1'], T['oz1'], FLOOR, FLOOR, None),
        ('porch', PORCH['x0'], PORCH['x1'], PORCH['z0'], PORCH['z1'], FLOOR, FLOOR, None),
        ('steps', STEPS['x0'], STEPS['x1'], STEPS['z0'], STEPS['z1'], 0.0, FLOOR, 'z'),
    ]
