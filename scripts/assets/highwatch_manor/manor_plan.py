"""The Highwatch manor's plan: every dimension the build, the collision and the runtime read.

Model frame (yards): origin on the ground line under the great hall's middle, +y up, +x west,
+z north; the front door looks south (-z). The model's footing runs a yard under the ground line
(y -1), the painted Tidehold convention the town's placement buries (placed_town_kit.ts).

The plan is option A of the approved proposal, "Salon en T con linterna": a great hall 26 x 20
inside with walls of 10.5 and an open timber roof to 19, a round hearth under a copper hood and
an octagonal glazed lantern on the ridge; a columned porch with a carved crest; a raised dais
bay with a stained-glass window; the west wing (dining hall, kitchen behind it with a serving
hatch) and the east wing (library, a small chapel behind it with a bellcote); a walled garden
with a gate, a fountain and four lamps. One storey everywhere: the lantern is exterior only.
"""

FLOOR = 0.6          # the house floor over the ground line (a stone plinth under it)
FOOT = -1.0          # the footing's bottom
DAIS = FLOOR + 0.4   # the raised dais

# --- the great hall ------------------------------------------------------------------------
HALL = dict(x0=-13.0, x1=13.0, z0=-10.0, z1=10.0, t=0.9,
            plate=FLOOR + 10.5,   # the wall plate
            ridge=FLOOR + 19.0,   # the ridge
            truss=FLOOR + 11.0)   # nothing of the open roof hangs lower than this
HALL['ox0'], HALL['ox1'] = HALL['x0'] - HALL['t'], HALL['x1'] + HALL['t']
HALL['oz0'], HALL['oz1'] = HALL['z0'] - HALL['t'], HALL['z1'] + HALL['t']
HALL_PITCH = (HALL['ridge'] - HALL['plate']) / HALL['oz1']   # rise per yard of the main roof
EAVE_OUT = 1.0
VERGE_OUT = 0.6

DOOR = dict(x0=-1.8, x1=1.8, head=FLOOR + 5.2)   # the front door: 3.6 x 5.2
ARCH_SIDE = dict(z0=-3.0, z1=3.0, head=FLOOR + 6.5)   # hall to each wing
ARCH_DAIS = dict(x0=-5.0, x1=5.0, head=FLOOR + 9.0)   # hall to the dais bay

HEARTH = dict(x=0.0, z=0.0, r=2.9, curb=FLOOR + 0.55, bed=2.25)
HOOD = dict(y0=FLOOR + 9.3, r0=3.3, y1=FLOOR + 12.6, r1=1.0, flue=0.75)
# the lantern on the ridge over the hearth
LANTERN = dict(x=0.0, z=0.0, r=2.7, base=HALL['ridge'] - 1.2, y0=HALL['ridge'] + 0.6,
               y1=HALL['ridge'] + 4.2, spire=HALL['ridge'] + 11.2, finial=HALL['ridge'] + 12.6)

# --- the dais bay behind the hall --------------------------------------------------------------
BAY = dict(x0=-6.0, x1=6.0, z0=HALL['oz1'], z1=17.4, t=0.9, plate=FLOOR + 9.6)
BAY['ox0'], BAY['ox1'], BAY['oz1'] = BAY['x0'] - BAY['t'], BAY['x1'] + BAY['t'], BAY['z1'] + BAY['t']
# the dais: the whole bay and a step out into the hall
DAIS_FRONT = HALL['z1'] - 1.4

# --- the wings ---------------------------------------------------------------------------
WING_T = 0.8
WEST = dict(x0=HALL['ox1'], x1=23.9, z0=-7.2, z1=7.8, plate=FLOOR + 8.4)        # the dining hall
KITCHEN = dict(x0=15.6, x1=23.9, z0=WEST['z1'] + WING_T, z1=14.6, plate=FLOOR + 7.4)
EAST = dict(x0=-23.9, x1=HALL['ox0'], z0=-7.2, z1=4.8, plate=FLOOR + 8.4)       # the library
CHAPEL = dict(x0=-22.0, x1=-15.6, z0=EAST['z1'] + WING_T, z1=12.4, plate=FLOOR + 7.6)
for room in (WEST, KITCHEN, EAST, CHAPEL):
    room['oz0'] = room['z0'] - WING_T
    room['oz1'] = room['z1'] + WING_T
WEST['ox1'] = WEST['x1'] + WING_T
EAST['ox0'] = EAST['x0'] - WING_T
KITCHEN['ox0'] = KITCHEN['x0'] - WING_T
CHAPEL['ox0'], CHAPEL['ox1'] = CHAPEL['x0'] - WING_T, CHAPEL['x1'] + WING_T
SIDE_DOOR_H = FLOOR + 5.0
KITCHEN_DOOR = dict(x0=21.0, x1=23.4)     # dining to kitchen, in the wall between them
CHAPEL_DOOR = dict(x0=-20.1, x1=-17.5)    # library to chapel
HATCH = dict(x0=16.6, x1=19.8, y0=FLOOR + 1.35, y1=FLOOR + 3.0)   # the serving hatch

# --- the porch ---------------------------------------------------------------------------
PORCH = dict(x0=-6.5, x1=6.5, z0=-17.6, z1=HALL['oz0'], beam=FLOOR + 7.4, ridge=FLOOR + 12.6)
STEPS = dict(x0=-4.6, x1=4.6, z0=-19.4, z1=PORCH['z0'])
COLUMNS = [(-5.6, -16.8), (-2.9, -16.8), (2.9, -16.8), (5.6, -16.8)]
COLUMN_R = 0.5

# --- the garden --------------------------------------------------------------------------
GARDEN = dict(x0=-24.2, x1=24.2, z0=-28.0, t=0.7, h=1.5)
GATE = dict(x0=-2.6, x1=2.6, pier=0.95, pier_h=3.4)
LAMPS = [(-3.9, -25.6), (3.9, -25.6), (-3.9, -21.2), (3.9, -21.2)]
FOUNTAIN = dict(x=13.2, z=-18.0, r=2.4)
BENCH = dict(x=-13.6, z=-21.5, w=3.0)

# the whole model's ground extents (eaves included), for the sim's reach
REACH = dict(x0=-(WEST['ox1'] + 0.75), x1=WEST['ox1'] + 0.75, z0=GARDEN['z0'] - 0.1,
             z1=BAY['oz1'] + EAVE_OUT)


def collision_boxes():
    """The solid boxes a player bumps into, in model yards over the ground line:
    (name, x0, x1, y0, y1, z0, z1). Walls run from the footing to the plate; the floor is the
    decks', never a box."""
    H, B, W, K, E, C = HALL, BAY, WEST, KITCHEN, EAST, CHAPEL
    out = []

    def add(name, x0, x1, y0, y1, z0, z1):
        out.append((name, x0, x1, y0, y1, z0, z1))

    # the great hall: the front wall either side of the door and its lintel
    add('hall_front_w', DOOR['x1'], H['ox1'], FOOT, H['plate'], H['oz0'], H['z0'])
    add('hall_front_e', H['ox0'], DOOR['x0'], FOOT, H['plate'], H['oz0'], H['z0'])
    add('hall_door_lintel', DOOR['x0'], DOOR['x1'], DOOR['head'], H['plate'], H['oz0'], H['z0'])
    # the back wall either side of the dais arch
    add('hall_back_w', ARCH_DAIS['x1'], H['ox1'], FOOT, H['plate'], H['z1'], H['oz1'])
    add('hall_back_e', H['ox0'], ARCH_DAIS['x0'], FOOT, H['plate'], H['z1'], H['oz1'])
    # the gable walls either side of the arches into the wings
    add('hall_side_w_s', H['x1'], H['ox1'], FOOT, H['plate'], H['z0'], ARCH_SIDE['z0'])
    add('hall_side_w_n', H['x1'], H['ox1'], FOOT, H['plate'], ARCH_SIDE['z1'], H['z1'])
    add('hall_side_e_s', H['ox0'], H['x0'], FOOT, H['plate'], H['z0'], ARCH_SIDE['z0'])
    add('hall_side_e_n', H['ox0'], H['x0'], FOOT, H['plate'], ARCH_SIDE['z1'], H['z1'])
    # the round hearth's stone ring (its inscribed square), standing to a man's chest so no one
    # steps up onto the curb into the fire
    r = HEARTH['r'] * 0.86
    add('hearth', -r, r, FOOT, FLOOR + 2.0, -r, r)
    # the dais bay
    add('bay_w', B['x1'], B['ox1'], FOOT, B['plate'], H['oz1'], B['oz1'])
    add('bay_e', B['ox0'], B['x0'], FOOT, B['plate'], H['oz1'], B['oz1'])
    add('bay_back', B['ox0'], B['ox1'], FOOT, B['plate'], B['z1'], B['oz1'])
    add('high_table', -4.4, 4.4, FOOT, DAIS + 1.0, 13.3, 15.75)
    # the hall's long tables with their benches, and the chests and weapon racks on its back wall
    for sx, name in ((1, 'w'), (-1, 'e')):
        a, b = sorted((sx * 5.1, sx * 11.4))
        add(f'hall_table_{name}', a, b, FOOT, FLOOR + 1.0, -7.75, -5.05)
        a, b = sorted((sx * 6.6, sx * 11.9))
        add(f'hall_racks_{name}', a, b, FOOT, FLOOR + 2.0, 8.75, H['z1'])
    # the west wing: the dining hall and the kitchen behind it
    add('dining_front', H['ox1'], W['ox1'], FOOT, W['plate'], W['oz0'], W['z0'])
    add('west_outer', W['x1'], W['ox1'], FOOT, W['plate'], W['oz0'], K['oz1'])
    add('dining_back_e', K['ox0'], KITCHEN_DOOR['x0'], FOOT, W['plate'], W['z1'], K['z0'])
    add('dining_back_w', KITCHEN_DOOR['x1'], W['x1'], FOOT, W['plate'], W['z1'], K['z0'])
    add('dining_back_h', H['ox1'], K['ox0'], FOOT, W['plate'], W['z1'], K['z0'])
    add('kitchen_back', K['ox0'], W['x1'], FOOT, K['plate'], K['z1'], K['oz1'])
    add('kitchen_side', K['ox0'], K['x0'], FOOT, K['plate'], K['z0'], K['z1'])
    add('feast_table', 16.7, 21.1, FOOT, FLOOR + 1.0, -5.5, 5.9)
    add('sideboard', 23.1, W['x1'], FOOT, FLOOR + 1.6, -4.2, 2.6)
    add('kitchen_hearth', 17.8, 22.8, FOOT, K['plate'], 13.25, K['z1'])
    add('kitchen_barrels', 21.9, W['x1'], FOOT, FLOOR + 1.1, 12.3, K['z1'])
    add('kitchen_sacks', K['x0'], 17.6, FOOT, FLOOR + 0.9, 12.9, K['z1'])
    add('kitchen_table', 17.4, 21.0, FOOT, FLOOR + 1.0, 10.2, 11.6)
    add('kitchen_dresser', K['x0'], K['x0'] + 0.8, FOOT, FLOOR + 3.0, 9.6, 12.8)
    add('kitchen_chimney', 18.4, 22.2, FOOT, K['plate'], K['oz1'], K['oz1'] + 1.0)
    # the east wing: the library and the chapel behind it
    add('library_front', E['ox0'], H['ox0'], FOOT, E['plate'], E['oz0'], E['z0'])
    add('east_outer', E['ox0'], E['x0'], FOOT, E['plate'], E['oz0'], E['oz1'])
    add('library_back_e', E['x0'], CHAPEL_DOOR['x0'], FOOT, E['plate'], E['z1'], C['z0'])
    add('library_back_w', CHAPEL_DOOR['x1'], H['ox0'], FOOT, E['plate'], E['z1'], C['z0'])
    add('chapel_e', C['ox0'], C['x0'], FOOT, C['plate'], C['z0'], C['oz1'])
    add('chapel_w', C['x1'], C['ox1'], FOOT, C['plate'], C['z0'], C['oz1'])
    add('chapel_back', C['ox0'], C['ox1'], FOOT, C['plate'], C['z1'], C['oz1'])
    add('shelves_east', E['x0'], E['x0'] + 0.9, FOOT, FLOOR + 6.2, -6.6, 4.2)
    add('shelves_north', CHAPEL_DOOR['x1'] + 0.5, H['ox0'] - 0.3, FOOT, FLOOR + 6.2, E['z1'] - 0.8, E['z1'])
    add('reading_desk', -19.6, -17.2, FOOT, FLOOR + 1.3, -1.5, 1.4)
    add('altar', -20.0, -17.6, FOOT, FLOOR + 1.5, 11.0, 12.0)
    add('pews_e', -21.6, -19.8, FOOT, FLOOR + 1.1, 7.5, 9.5)
    add('pews_w', -17.8, -16.0, FOOT, FLOOR + 1.1, 7.5, 9.5)
    # the porch's columns
    for i, (cx, cz) in enumerate(COLUMNS):
        add(f'column_{i}', cx - COLUMN_R, cx + COLUMN_R, FOOT, PORCH['beam'], cz - COLUMN_R, cz + COLUMN_R)
    # the garden: the front wall either side of the gate (its piers included), the side walls,
    # the lamps, the fountain, the bench
    G = GARDEN
    add('garden_front_e', G['x0'], GATE['x0'], FOOT, G['h'], G['z0'], G['z0'] + G['t'])
    add('garden_front_w', GATE['x1'], G['x1'], FOOT, G['h'], G['z0'], G['z0'] + G['t'])
    add('garden_side_e', G['x0'], G['x0'] + G['t'], FOOT, G['h'], G['z0'], E['oz0'])
    add('garden_side_w', G['x1'] - G['t'], G['x1'], FOOT, G['h'], G['z0'], W['oz0'])
    for i, (lx, lz) in enumerate(LAMPS):
        add(f'lamp_{i}', lx - 0.28, lx + 0.28, FOOT, 3.9, lz - 0.28, lz + 0.28)
    fr = FOUNTAIN['r'] * 0.9
    add('fountain', FOUNTAIN['x'] - fr, FOUNTAIN['x'] + fr, FOOT, 0.75, FOUNTAIN['z'] - fr, FOUNTAIN['z'] + fr)
    add('bench', BENCH['x'] - BENCH['w'] / 2, BENCH['x'] + BENCH['w'] / 2, FOOT, 0.55, BENCH['z'] - 0.35,
        BENCH['z'] + 0.35)
    return out


def decks():
    """The walkable floors: (name, x0, x1, z0, z1, y_low, y_high, axis) where a sloped deck
    rises from y_low to y_high along `axis` ('z' rises toward +z)."""
    H, B = HALL, BAY
    return [
        ('hall', H['ox0'], H['ox1'], H['oz0'], H['oz1'], FLOOR, FLOOR, None),
        ('west_wing', H['ox1'], WEST['ox1'], WEST['oz0'], KITCHEN['oz1'], FLOOR, FLOOR, None),
        ('east_wing', EAST['ox0'], H['ox0'], EAST['oz0'], CHAPEL['oz1'], FLOOR, FLOOR, None),
        ('dais_bay', B['ox0'], B['ox1'], H['oz1'], B['oz1'], DAIS, DAIS, None),
        ('dais_step', B['x0'], B['x1'], DAIS_FRONT, H['oz1'], DAIS, DAIS, None),
        ('porch', PORCH['x0'], PORCH['x1'], PORCH['z0'], PORCH['z1'], FLOOR, FLOOR, None),
        ('steps', STEPS['x0'], STEPS['x1'], STEPS['z0'], STEPS['z1'], 0.0, FLOOR, 'z'),
    ]
