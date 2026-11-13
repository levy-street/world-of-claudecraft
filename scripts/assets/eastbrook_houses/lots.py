# The town's own lots: one new building for each of the release's town models, built to
# stand on the SAME walls, with the SAME doorway and floor height, so the town layout, its
# NPCs and its paths need no change. Each is whole: the outside, and a room inside you can
# walk into, with its own collision rows and indoor camera air written from the same numbers.
#
# A layout record's local axes map onto the kit as: kit x = -local x, kit y = local z (the
# front is -Y here and the model is turned half way round when it is finished). Heights in
# the kit are above the ground line; the models carry exactly one yard of footing below it.
import math

from kit import SIDES, UP, Frame, Model, side_frame, uv_part, uv_tile
from mathutils import Vector

WALL = 0.55
FLOOR = 0.45


# A doorway's head stands 1.4047 times its width over the floor (the painted door's own
# shape), and the game wants about five yards of door at the size a town stands a building
# (the chase camera follows a 2.6 yard player through it). So a lot's door WIDTH is what
# clears that rule: the shops open 2.32, the bank 2.68, the chapel 3.58, the guild 3.22.
def door_top(opening, floor=FLOOR):
    return (1132.0 - 653.0) * opening / 341.0 + floor


def lot(m, w, d, ground, upper, door, jetty=(0.5, 0.3, 0.1), floor=FLOOR, upper_kind="timber", wall="timber", back_door=None):
    """The shell every lot shares: stone ground floor with an open doorway, a jettied storey
    over it, and the room inside. `door` is (from, to) along the record's local x. Returns
    (storey rect, room rect, top of the doorway, the doorway's kit x range)."""
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    da, db = -door[1], -door[0]
    top = door_top(db - da, floor)
    m.stone_base(x0, x1, y0, y1, ground, batter=0.0, gap=(da, db, top), back_gap=back_door)
    m.doorway(Frame(((da + db) / 2, y0, 0.0), (1, 0, 0)), opening=db - da, lift=floor, depth=WALL)
    rect = (x0 - jetty[1], x1 + jetty[1], y0 - jetty[0], y1 + jetty[2])
    if upper > ground:
        m.storey(*rect, ground, upper, upper_kind, collide=False)
        m.soffit(rect, (x0, x1, y0, y1), ground + 0.01)
        count = max(2, round(w / 2.6) + 1)
        for c in range(count):
            m.corbel(m.base_frame("front", 0.42 + (w - 0.84) * c / (count - 1), ground - 0.02), size=0.3 + jetty[0] * 0.8)
    room = (x0 + WALL, x1 - WALL, y0 + WALL, y1 - WALL)
    m.room(*room, floor, ground - 0.3, door=(da, db, top), wall=wall, back_door=back_door)
    return rect, room, top, (da, db)


def furnish(made, m):
    """Adds the room's furniture (kit.Model.furnish notes each piece as it is built) to a
    lot's collision, in the record's axes (x = -kit x, z = kit y, heights from the bottom of
    the footing). A piece turned off the walls collides as the box that just holds it: the
    rows carry no turn of their own here, and a table set askew is still a table to walk
    round."""
    for cx, cy, z0, z1, along, across, turn in m.furniture:
        c, s = abs(math.cos(turn)), abs(math.sin(turn))
        made["boxes"].append({
            "x": -cx,
            "y": 1.0 + (z0 + z1) / 2,
            "z": cy,
            "hx": along * c + across * s,
            "hy": (z1 - z0) / 2,
            "hz": along * s + across * c,
        })
    return made


def rows(w, d, wall_top, door, extra=(), floor=FLOOR, ceiling=None, back_gap=None):
    """Collision for a lot in the record's own axes (yards, heights from the bottom of the
    footing): the four walls with the doorway left open, any solid extras, the floor, the
    threshold and the step up to it."""
    top = door_top(door[1] - door[0], floor) + 1.0
    high = wall_top + 1.0
    boxes = []

    def box(x0, x1, y0, y1, z0, z1):
        boxes.append({"x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "z": (z0 + z1) / 2, "hx": (x1 - x0) / 2, "hy": (y1 - y0) / 2, "hz": (z1 - z0) / 2})

    box(-w / 2, door[0], 1.0, high, -d / 2, -d / 2 + WALL)
    box(door[1], w / 2, 1.0, high, -d / 2, -d / 2 + WALL)
    box(door[0], door[1], top, high, -d / 2, -d / 2 + WALL)
    if back_gap:
        box(-w / 2, back_gap[0], 1.0, high, d / 2 - WALL, d / 2)
        box(back_gap[1], w / 2, 1.0, high, d / 2 - WALL, d / 2)
        box(back_gap[0], back_gap[1], back_gap[2] + 1.0, high, d / 2 - WALL, d / 2)
    else:
        box(-w / 2, w / 2, 1.0, high, d / 2 - WALL, d / 2)
    box(-w / 2, -w / 2 + WALL, 1.0, high, -d / 2, d / 2)
    box(w / 2 - WALL, w / 2, 1.0, high, -d / 2, d / 2)
    for x0, x1, y0, y1, z0, z1 in extra:
        box(x0, x1, y0 + 1.0, y1 + 1.0, z0, z1)
    cx, half = (door[0] + door[1]) / 2, (door[1] - door[0]) / 2
    # The doorstep follows the stair kit.doorway() draws: a landing at floor height out to
    # 0.94 yd from the wall, then one tread every half yard down to the ground. The landing
    # reaches back through the threshold into the room's own floor, and the stair's ramp
    # runs UNDER the landing's edge, so the three sheets overlap: a crack between them (the
    # first cut left three centimetres) strands a body whose stride happens to end in it.
    steps = max(1, round(floor / 0.225))
    landing, foot = 0.94, 0.44 + 0.5 * steps + 0.3
    ramps = [
        {"x": 0.0, "z": 0.0, "hx": w / 2 - WALL, "hz": d / 2 - WALL, "y0": 1.0 + floor, "y1": 1.0 + floor},
        {"x": cx, "z": -d / 2 + (WALL + 0.05 - landing) / 2, "hx": half + 0.5, "hz": (WALL + 0.05 + landing) / 2, "y0": 1.0 + floor, "y1": 1.0 + floor},
        {"x": cx, "z": -d / 2 - (foot + landing - 0.06) / 2, "hx": (foot - landing + 0.06) / 2, "hz": half + 0.5, "y0": 1.0, "y1": 1.0 + floor, "ry": -1.5708},
    ]
    if back_gap:
        ramps.append({"x": (back_gap[0] + back_gap[1]) / 2, "z": d / 2 - WALL / 2, "hx": (back_gap[1] - back_gap[0]) / 2, "hz": WALL / 2 + 0.05, "y0": 1.0 + floor, "y1": 1.0 + floor})
    air = {
        "boxes": [
            [-w / 2 + WALL + 0.1, w / 2 - WALL - 0.1, floor, (ceiling if ceiling is not None else wall_top) - 0.1, -d / 2 + WALL + 0.1, d / 2 - WALL - 0.1],
            [door[0], door[1], floor, top - 1.0, -d / 2 - 0.1, -d / 2 + WALL + 0.9],
        ],
        "openings": [{"box": 1, "axis": 2, "side": -1}],
    }
    return {"boxes": boxes, "ramps": ramps, "air": air}


def sealed(w, d, wall_top, extra=()):
    """Collision for a lot with a shut door: its walls as one box and any solid extras, in
    the record's own axes (what the model collides on when it is stood as a placement)."""
    spans = [(-w / 2, w / 2, 0.0, wall_top, -d / 2, d / 2), *extra]
    boxes = [{"x": (x0 + x1) / 2, "y": (y0 + y1) / 2 + 1.0, "z": (z0 + z1) / 2, "hx": (x1 - x0) / 2, "hy": (y1 - y0) / 2, "hz": (z1 - z0) / 2} for x0, x1, y0, y1, z0, z1 in spans]
    return {"boxes": boxes, "ramps": [], "air": None}


def fronts(m, w, ground, rect, upper, windows=(), awnings=(), casements=(), lantern_at=()):
    """What a lot's street front wears. Positions are yards along the stone front from its
    left corner (and along the storey above for the casements)."""
    for along in windows:
        m.arch_window(m.base_frame("front", along, 1.55), width=1.9)
    for along in awnings:
        m.awning(m.base_frame("front", along, 4.75), width=3.0, depth=1.6, drop=0.9)
    for along in lantern_at:
        m.lantern(m.base_frame("front", along, 3.7), reach=0.8, size=1.15)
    front, width = side_frame("front", *rect, ground)
    for along in casements:
        m.casement(front.at(along if along >= 0 else width + along, (upper - ground) * 0.36, 0.0), width=1.6)
    return front, width


def sides(m, w, d, ground, rect, upper, back=True):
    """Windows on the other three sides, so no wall is left blank."""
    for side, length in (("left", d), ("right", d)) + ((("back", w),) if back else ()):
        count = max(1, round(length / 5.5))
        for i in range(count):
            m.arch_window(m.base_frame(side, length * (i + 0.5) / count, 1.55), width=1.8)
        if upper > ground:
            fr, span = side_frame(side, *rect, ground)
            for i in range(count):
                m.casement(fr.at(span * (i + 0.5) / count, (upper - ground) * 0.36, 0.0), width=1.5, flowers=i % 2 == 0)


def lit_room(m, room, floor, ceiling, hearth_side="left", windows=False, rugs=0, lamps=0, hearth_along=None, hearth_width=2.8):
    """What every room has: a fire, lanterns on its walls and a banner. Lit windows, rugs
    and a wheel of lamps can be asked for; all three were tried and dropped."""
    x0, x1, y0, y1 = room
    m.part = 1
    span = y1 - y0
    height = ceiling - floor
    m.hearth(m.inner_frame(*room, hearth_side, span / 2 if hearth_along is None else hearth_along, floor), width=hearth_width, height=height)
    for side, length in (("back", x1 - x0), ("front", x1 - x0)):
        spots = (0.2, 0.8) if length < 22.0 else (0.08, 0.3, 0.7, 0.92)
        for f in spots:
            m.lantern(m.inner_frame(*room, side, length * f, floor + min(height * 0.62, 4.2)), reach=0.55, size=1.0)
    m.banner(m.inner_frame(*room, "back", (x1 - x0) * 0.5, floor + height * 0.86), width=1.5, flat=True)
    if windows:
        # daylight through the panes, seen from inside: one window between each pair of lamps
        other = "right" if hearth_side == "left" else "left"
        for side, length, spots in (("back", x1 - x0, (0.34, 0.66)), (other, span, (0.3, 0.7))):
            for f in spots:
                m.arch_window(m.inner_frame(*room, side, length * f, floor + 1.1), width=1.5, sink=0.0)
    count = lamps if lamps is not None else max(1, round((x1 - x0) / 8.0))
    for i in range(count):
        m.chandelier(x0 + (x1 - x0) * (i + 0.5) / count, (y0 + y1) / 2 - 0.4, ceiling, drop=min(1.5, height * 0.3), size=min(2.3, height * 0.5))
    for i in range(rugs):
        m.rug(x0 + (x1 - x0) * (i + 0.5) / rugs, y0 + span * 0.34, floor, width=min(2.6, span * 0.3), turn=math.pi / 2)
    m.part = 0


def turret(m, tx, ty, radius, top, windows=(), sides=8, lean=(0.6, 0.2)):
    """A round stair turret under a leaning witch-hat spire, its gilded eave ring and a gem
    on its tip. `windows` are (bearing in degrees, height) pairs: -90 looks out of the front."""
    m.drum(tx, ty, radius + 0.15, radius, 0.0, top, sides=sides)
    for degrees, height in windows:
        m.arch_window(m.drum_frame(degrees, height), width=1.2, sink=0.2)
    axis = Frame((tx, ty, 0.0), (1, 0, 0), UP, (0, 1, 0))
    k = radius / 1.6
    eave = 2.6 * k
    hat = [(eave, top - 0.3), (1.85 * k, top + 0.6), (1.0 * k, top + 3.0 * k), (0.4 * k, top + 5.2 * k), (0.03, top + 7.0 * k)]
    m.lathe(axis, hat, sides=sides, skin=("tile", "slate"), lean=[(0, 0), (0, 0), (lean[0] * 0.13, lean[1] * 0.15), (lean[0] * 0.5, lean[1] * 0.5), lean])
    m.lathe(axis, [(radius + 0.02, top - 0.1), (eave, top - 0.38)], sides=sides, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(eave + 0.02, top - 0.42), (eave + 0.02, top - 0.24)], sides=sides, skin=("band", "gilded", 0.18), smooth=False)
    m.gem(Vector((tx + lean[0], ty + lean[1], top + 7.0 * k + 0.2)), 0.14, stretch=1.8)


def inn():
    """The inn: a long house under two prow gables, awnings over its front windows, and a
    taproom inside with a bar, a fire and long tables."""
    m = Model("tavern")
    w, d, ground, upper, door = 20.0, 13.0, 5.65, 9.65, (-1.5, 1.5)
    rect, room, _top, _gap = lot(m, w, d, ground, upper, door)
    front, width = fronts(m, w, ground, rect, upper, windows=(2.6, 6.2, 13.8, 17.4), awnings=(6.2, 13.8), casements=(2.4, 5.6, -5.6, -2.4), lantern_at=(7.9, 12.1))
    sides(m, w, d, ground, rect, upper)
    m.oriel(front.at(width / 2, 0.5, 0.0), width=3.2, storeys=1)
    m.swept_roof(*rect, upper, rise=6.6, ridge="x", prow=1.6, sweep=0.9, eave_out=1.0, horn=1.4)
    for xa, xb in ((-8.6, -2.9), (2.9, 8.6)):
        m.swept_roof(xa, xb, rect[2], 1.5, upper, rise=5.4, ridge="y", ends=(True, False), prow=(2.0, 0.0), horn=(1.6, 0.0), eave_out=0.55, gable="timber", collide=False)
        m.arch_window(Frame(((xa + xb) / 2, rect[2], upper + 0.8), (1, 0, 0)), width=1.6)
    m.hanging_sign(front.at(width - 0.2, (upper - ground) * 0.9, 0.0), width=2.3)
    m.banner(front.at(0.3, (upper - ground) * 0.9, 0.0), width=1.4)
    m.chimney(-6.4, 2.6, 1.5, 1.5, upper + 1.0, upper + 9.6, lean=(-0.12, 0.08), pots=4)
    m.chimney(7.2, -1.0, 1.3, 1.3, upper + 1.0, upper + 8.6, lean=(0.1, 0.1), pots=3)
    # the bench and the barrels the lot keeps outside
    m.bench(5.1, -7.25, 0.0, length=5.0)
    m.barrel(-10.9, -5.5, size=1.05)
    m.barrel(-10.9, -4.3, size=0.9, turn=0.7)
    # the taproom
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="right")
    m.part = 1
    m.counter(Frame((x0 + 1.2, y1 - 2.2, FLOOR), (1, 0, 0)), length=7.0)
    for i, bx in enumerate((x0 + 1.9, x0 + 3.1, x0 + 4.3)):
        m.barrel(bx, y1 - 0.7, FLOOR, size=1.0 if i != 1 else 0.85, turn=i * 0.7)
    for tx, ty in ((-2.0, -1.5), (4.2, -1.8), (4.6, 2.4)):
        m.table(tx, ty, FLOOR, length=2.8, width=1.1)
        m.bench(tx, ty - 0.95, FLOOR, length=2.6)
        m.bench(tx, ty + 0.95, FLOOR, length=2.6)
    m.crate(x1 - 3.0, y0 + 0.9, FLOOR, size=0.95, turn=0.2)
    m.crate(x1 - 4.1, y0 + 0.85, FLOOR, size=0.8, turn=-0.3)
    m.part = 0
    solid = [(-(x0 + 8.2), -(x0 + 1.2), 0.0, 1.6, y1 - 2.2, y1 - 1.4), (-5.1 - 2.6, -5.1 + 2.6, 0.0, 0.6, -7.5, -7.0), (10.4, 11.4, 0.0, 1.3, -6.1, -3.7)]
    return m, rows(w, d, upper, door, solid, ceiling=ceiling)


def bank():
    """The counting house: a broad front with a turret on its corner and a strongroom
    behind, and a hall inside with a gilded counter."""
    m = Model("bank")
    w, d, ground, upper, door = 18.0, 12.4923, 5.85, 9.6, (-1.34, 1.34)
    rect, room, _top, _gap = lot(m, w, d, ground, upper, door)
    front, width = fronts(m, w, ground, rect, upper, windows=(2.6, 5.9, 12.1, 15.4), casements=(2.4, 5.6, -5.6, -2.4), lantern_at=(7.0, 11.0))
    sides(m, w, d, ground, rect, upper, back=False)
    m.oriel(front.at(width / 2, 0.5, 0.0), width=3.2, storeys=1)
    m.swept_roof(*rect, upper, rise=6.4, ridge="x", prow=1.6, sweep=0.9, eave_out=1.0, horn=1.4)
    m.swept_roof(-3.6, 3.6, rect[2], 1.5, upper, rise=5.6, ridge="y", ends=(True, False), prow=(2.1, 0.0), horn=(1.7, 0.0), eave_out=0.55, gable="timber", collide=False)
    m.relief(Frame((0.0, rect[2], upper + 0.9), (1, 0, 0)), "wheel", 2.0, 0.14, anchor=(0.5, 0.0))
    m.banner(front.at(0.3, (upper - ground) * 0.9, 0.0), width=1.4)
    m.banner(front.at(width - 0.3, (upper - ground) * 0.9, 0.0), width=1.4)
    # the turret on the corner (record: -9.59, -6.85) and the strongroom behind (0, 8.2)
    tx, ty, top = 9.5923, -6.8462, 14.0
    m.drum(tx, ty, 1.75, 1.6, 0.0, top, sides=8)
    for degrees, height in ((-90.0, 6.5), (-90.0, 10.6), (0.0, 8.4)):
        m.arch_window(m.drum_frame(degrees, height), width=1.2, sink=0.2)
    axis = Frame((tx, ty, 0.0), (1, 0, 0), UP, (0, 1, 0))
    m.lathe(axis, [(2.6, top - 0.3), (1.85, top + 0.6), (1.0, top + 3.0), (0.4, top + 5.2), (0.03, top + 7.0)], sides=8, skin=("tile", "slate"), lean=[(0, 0), (0, 0), (0.08, 0.03), (0.3, 0.1), (0.6, 0.2)])
    m.lathe(axis, [(1.62, top - 0.1), (2.6, top - 0.38)], sides=8, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(2.62, top - 0.42), (2.62, top - 0.24)], sides=8, skin=("band", "gilded", 0.18), smooth=False)
    m.gem(Vector((tx + 0.6, ty + 0.2, top + 7.2)), 0.14, stretch=1.8)
    m.storey(-2.9, 2.9, d / 2 - 0.1, d / 2 + 3.9, -1.0, 4.4, "stone", sides=("right", "back", "left"), collide=False)
    m.shed_roof((2.9 + 0.35, d / 2 + 4.3, 4.3), (-2.9 - 0.35, d / 2 + 4.3, 4.3), (-2.9 - 0.35, d / 2, 5.6), (2.9 + 0.35, d / 2, 5.6))
    m.chimney(-6.0, 1.5, 1.4, 1.4, upper + 1.0, upper + 9.0, lean=(-0.1, 0.08), pots=3)
    m.barrel(-8.2, -6.9, size=1.0)
    m.crate(-7.1, -6.95, size=0.9, turn=0.3)
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="left")
    m.part = 1
    m.counter(Frame((x0 + 2.5, y1 - 3.0, FLOOR), (1, 0, 0)), length=x1 - x0 - 5.0, band="gilded")
    for cx in (x0 + 3.2, x1 - 3.2):
        m.lathe(Frame((cx, y0 + 3.4, FLOOR), (1, 0, 0), UP, (0, 1, 0)), [(0.5, 0.0), (0.42, 0.4), (0.36, ceiling - FLOOR - 0.6), (0.52, ceiling - FLOOR)], sides=8, skin=("tile", "stone"))
    for i, bx in enumerate((x0 + 1.0, x0 + 2.1, x1 - 1.0)):
        m.crate(bx, y1 - 0.85, FLOOR, size=0.95, turn=0.2 * i)
    m.barrel(x1 - 2.1, y1 - 0.8, FLOOR, size=1.0)
    m.relief(m.inner_frame(*room, "back", (x1 - x0) * 0.22, FLOOR + 2.4), "wheel", 1.6, 0.1, anchor=(0.5, 0.0))
    m.part = 0
    solid = [(-(x1 - 2.5), -(x0 + 2.5), 0.0, 1.6, y1 - 3.0, y1 - 2.2), (-9.5923 - 1.6, -9.5923 + 1.6, 0.0, 14.0, -6.8462 - 1.6, -6.8462 + 1.6), (-2.9, 2.9, 0.0, 5.0, d / 2, d / 2 + 3.9)]
    return m, rows(w, d, upper, door, solid, ceiling=ceiling)


def smithy():
    """The smithy: a gable-fronted forge house with an open shelter at its side, the forge
    stack rising through its roof, and the workshop inside."""
    m = Model("smithy")
    w, d, ground, upper, door = 11.0, 9.0, 5.25, 8.6, (-2.6, 0.2)
    rect, room, _top, _gap = lot(m, w, d, ground, upper, door)
    front, width = fronts(m, w, ground, rect, upper, windows=(2.3,), casements=(2.6, -2.6), lantern_at=(5.0,))
    sides(m, w, d, ground, rect, upper)
    m.swept_roof(*rect, upper, rise=5.6, ridge="y", prow=(2.0, 1.0), sweep=0.8, horn=(1.6, 1.1))
    m.relief(Frame((0.0, rect[2], upper + 1.2), (1, 0, 0)), "wheel", 1.8, 0.14, anchor=(0.5, 0.0))
    m.hanging_sign(front.at(width - 0.2, (upper - ground) * 0.92, 0.0), width=2.0)
    # the forge shelter (record: 9.12, -0.1, 7.23 x 9.6): posts, a shed roof, the forge
    sx0, sx1, sy0, sy1 = -12.74, -5.5, -4.9, 4.7
    m.box(Frame((sx0, sy0, 0.0), (1, 0, 0)), 0.0, sx1 - sx0, -1.0, 0.27, -(sy1 - sy0), 0.0, ("band", "planks", "x", 0.6), skip="b")
    for px, py in ((sx0 + 0.3, sy0 + 0.3), (sx0 + 0.3, sy1 - 0.3), (sx0 + 0.3, (sy0 + sy1) / 2), ((sx0 + sx1) / 2, sy0 + 0.3)):
        m.sweep([(px, py, 0.27), (px, py, 4.1)], (0.32, 0.32), "oak", depth=0.4, caps=False)
    m.shed_roof((sx0 - 0.5, sy0 - 0.4, 3.9), (sx0 - 0.5, sy1 + 0.4, 3.9), (sx1, sy1 + 0.4, 5.6), (sx1, sy0 - 0.4, 5.6))
    m.chimney(sx0 + 2.2, 2.4, 1.9, 1.9, -1.0, 10.6, lean=(0.08, -0.06), pots=2)
    forge = Frame((sx0 + 2.2, 2.4 - 0.96, 0.27), (1, 0, 0))
    mouth = [(-0.6, 0.45), (0.6, 0.45), (0.6, 1.2), (0.0, 1.55), (-0.6, 1.2)]
    # the fire in its mouth is the lantern's lit glass, found on the sheet by name (a bare
    # coordinate here once showed whatever sprite lay under it: an awning and a banner)
    m.face([forge.p(px, py, 0.02) for px, py in mouth], [uv_part("lantern_glass", 0.5 + px / 1.32, 1.0 - (py - 0.4) / 1.25) for px, py in mouth], "parts_glow", 1.0, forge.n)
    m.box(Frame((sx0 + 4.4, 0.4, 0.27), (1, 0, 0)), 0.0, 0.9, 0.0, 0.75, 0.0, 0.5, ("band", "oak", "x", 0.3), shade=0.55)
    m.barrel(sx0 + 1.0, sy0 + 1.2, 0.27, size=1.0)
    m.box(Frame((sx0 + 4.0, sy1 - 1.4, 0.27), (1, 0, 0)), 0.0, 2.0, 0.0, 0.6, 0.0, 0.8, ("band", "planks", "x", 0.5))
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="left")
    m.part = 1
    m.table(1.5, 1.2, FLOOR, length=2.6, width=1.1)
    m.box(Frame((x0 + 1.2, y0 + 1.6, FLOOR), (1, 0, 0)), 0.0, 0.9, 0.0, 0.8, 0.0, 0.5, ("band", "oak", "x", 0.3), shade=0.55)
    m.barrel(x1 - 0.9, y1 - 0.9, FLOOR, size=1.0)
    m.crate(x1 - 2.0, y1 - 0.85, FLOOR, size=0.9, turn=0.3)
    m.part = 0
    # the forge stack is solid, and so are the shelter's four posts (the record's axes mirror
    # the model's x): without them a walker cuts the corner of the boarded floor straight
    # through a post. The floor itself is ground a body walks onto.
    solid = [(10.54 - 0.95, 10.54 + 0.95, 0.0, 10.6, 2.4 - 0.95, 2.4 + 0.95)]
    for px, pz in ((12.44, -4.6), (12.44, 4.4), (12.44, -0.1), (9.12, -4.6)):
        solid.append((px - 0.2, px + 0.2, 0.27, 4.1, pz - 0.2, pz + 0.2))
    made = rows(w, d, upper, door, solid, ceiling=ceiling)
    # the boarded floor a body walks onto. Two millimetres under the boards it draws: at
    # Eastbrook's size 0.27 comes out at 0.3014 yards, a hair over the 0.3 yard step a walker
    # may take in one stride, and the release shelter stood at 0.3 exactly.
    made["ramps"].append({"x": 9.125, "z": -0.1, "hx": 3.615, "hz": 4.8, "y0": 1.268, "y1": 1.268})
    return m, made


def buttress(m, fr, top=7.7):
    """A buttress in two stages against a wall, centred on the frame at ground level: the
    deep lower stage, the slimmer upper one, each under a pale weathering course."""
    m.box(fr, -0.45, 0.45, -1.0, 4.3, 0.0, 0.8, ("tile", "stone"), skip="k", shade=0.9)
    m.box(fr, -0.5, 0.5, 4.3, 4.5, 0.0, 0.86, ("band", "plaster", "x", 0.3), skip="k", shade=0.94)
    m.box(fr, -0.36, 0.36, 4.5, top, 0.0, 0.48, ("tile", "stone"), skip="k", shade=0.94)
    m.box(fr, -0.41, 0.41, top, top + 0.18, 0.0, 0.54, ("band", "plaster", "x", 0.3), skip="k", shade=0.94)


def chapel():
    """The chapel: a tall stone nave under one steep prow roof, a rose window over
    its door, pointed lights of stained glass between the buttresses of its flanks and three
    more in its east wall, a square tower at its corner with an open belfry and a bell under
    a slate spire, and pews and an altar inside."""
    m = Model("hall")
    w, d, ground, door, floor = 12.0, 22.0, 9.3, (-1.79, 1.79), 0.9
    rect, room, _top, _gap = lot(m, w, d, ground, ground, door, floor=floor)
    # the tower (record: 8.25, -9, 5.4 square) stands against the front bay of the left flank
    tx0, tx1, ty0, ty1, top = -10.95, -5.55, -11.7, -6.3, 17.5
    bay = d / 4
    # The flanks: a pointed light of stained glass in every bay, a buttress in two stages
    # between the bays and a string course under the sills (a flank of bare rubble nine yards
    # high read as a blank wall from the street beside it). The walls stay the town's own
    # rubble: the same chapel in dressed courses looked no better, up close or from across
    # the square.
    for side in ("left", "right"):
        # a side runs from its left corner seen from outside: the left flank from the back
        clear = d / 2 - ty1 if side == "left" else d
        bays = 3 if side == "left" else 4
        for i in range(bays):
            m.lancet(m.base_frame(side, bay * (i + 0.5), 2.5), width=1.35, height=5.0)
        for i in range(bays + 1):
            along = min(max(bay * i, 0.45), d - 0.45)
            if along < clear - 1.2:
                buttress(m, m.base_frame(side, along, 0.0))
        m.box(m.base_frame(side, 0.0, 2.06), 0.0, clear, 0.0, 0.2, 0.0, 0.07, ("band", "plaster", "x", 0.4), skip="k", shade=0.94)
    # the east wall: three lights, the middle one taller
    for off, width, height in ((-2.35, 1.15, 4.4), (0.0, 1.4, 5.7), (2.35, 1.15, 4.4)):
        m.lancet(m.base_frame("back", w / 2 + off, 2.6), width=width, height=height)
    m.box(m.base_frame("back", 0.0, 2.16), 0.0, w, 0.0, 0.2, 0.0, 0.07, ("band", "plaster", "x", 0.4), skip="k", shade=0.94)
    for along in (0.45, w - 0.45):
        buttress(m, m.base_frame("back", along, 0.0))
    for along in (2.4, w - 2.4):
        m.lantern(m.base_frame("front", along, 4.2), reach=0.8, size=1.2)
        m.banner(m.base_frame("front", along, 8.4), width=1.5, flat=True)
    m.swept_roof(*rect, ground, rise=8.6, ridge="y", prow=(2.5, 1.0), sweep=1.2, eave_out=1.1, eave_drop=0.6, horn=(1.9, 1.3), gable="stone", board=0.6, thick=0.28)
    # the rose over the door, where the wall meets the gable
    m.rose(Frame((0.0, -d / 2, ground + 0.1), (1, 0, 0)), radius=1.75)
    # the tower: a plain shaft with one light a side, then the open belfry and its bell
    stage = 12.7
    m.storey(tx0, tx1, ty0, ty1, -1.0, stage, "stone", collide=False)
    cx, cy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    for side in SIDES:
        fr, span = side_frame(side, tx0, tx1, ty0, ty1, 0.0)
        if side != "right":
            m.lancet(fr.at(span / 2, 5.6, 0.0), width=0.95, height=3.2)
        m.box(fr.at(0.0, stage - 0.3, 0.0), -0.07, span + 0.07, 0.0, 0.3, 0.0, 0.08, ("band", "plaster", "x", 0.4), skip="k", shade=0.94)
        m.arched_wall(fr.at(0.0, stage, 0.0), span, top - stage, span=2.9, spring=2.3, thick=0.55)
    m.face([(tx0, ty0, stage + 0.02), (tx1, ty0, stage + 0.02), (tx1, ty1, stage + 0.02), (tx0, ty1, stage + 0.02)], [uv_tile("stone", px, py) for px, py in ((tx0, ty0), (tx1, ty0), (tx1, ty1), (tx0, ty1))], "stone", 0.5, UP)
    m.face([(tx0, ty0, top - 0.12), (tx1, ty0, top - 0.12), (tx1, ty1, top - 0.12), (tx0, ty1, top - 0.12)], [uv_tile("stone", px, py) for px, py in ((tx0, ty0), (tx1, ty0), (tx1, ty1), (tx0, ty1))], "stone", 0.34, -UP)
    m.box(Frame((tx0, cy, stage + 3.3), (1, 0, 0)), 0.0, tx1 - tx0, 0.0, 0.3, -0.15, 0.15, ("band", "oak", "x", 0.3), shade=0.8)
    m.bell(Vector((cx, cy, stage + 3.3)), size=1.0)
    axis = Frame((cx, cy, 0.0), (1, 0, 0), UP, (0, 1, 0))
    r = 2.7 * math.sqrt(2.0)
    m.lathe(axis, [(r + 1.1, top - 0.3), (r + 0.1, top + 0.9), (r * 0.5, top + 4.6), (r * 0.2, top + 8.0), (0.03, top + 10.4)], sides=4, skin=("tile", "slate"), smooth=False, lean=[(0, 0), (0, 0), (0.1, 0.05), (0.35, 0.15), (0.8, 0.3)])
    m.lathe(axis, [(r, top - 0.1), (r + 1.1, top - 0.4)], sides=4, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(r + 1.12, top - 0.44), (r + 1.12, top - 0.24)], sides=4, skin=("band", "gilded", 0.2), smooth=False)
    m.gem(Vector((cx + 0.8, cy + 0.3, top + 10.7)), 0.18, stretch=1.9)
    board = Frame((4.2 - 0.9, -11.8, 0.0), (1, 0, 0))
    for px in (0.1, 1.7):
        m.sweep([board.p(px, -1.0, 0.0), board.p(px, 2.3, 0.0)], (0.16, 0.16), "oak", depth=0.2, caps=False)
    m.box(board, 0.0, 1.8, 1.1, 2.2, -0.05, 0.05, ("band", "planks", "x", 0.6))
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    m.part = 1
    for i in range(6):
        py = y0 + 3.0 + i * 2.0
        for px in (-2.5, 2.5):
            m.bench(px, py, floor, length=3.2)
    m.box(Frame((-1.6, y1 - 2.4, floor), (1, 0, 0)), 0.0, 3.2, 0.0, 1.3, 0.0, 1.1, ("tile", "stone"), skip="b")
    m.box(Frame((-1.75, y1 - 2.45, floor + 1.3), (1, 0, 0)), 0.0, 3.5, 0.0, 0.14, 0.0, 1.2, ("band", "gilded", "x", 0.3))
    for side, length in (("left", y1 - y0), ("right", y1 - y0)):
        for f in (0.2, 0.5, 0.8):
            m.lantern(m.inner_frame(*room, side, length * f, floor + 3.6), reach=0.6, size=1.1)
            m.banner(m.inner_frame(*room, side, length * f + 1.6, floor + 6.6), width=1.4, flat=True)
    m.relief(m.inner_frame(*room, "back", (x1 - x0) / 2, floor + 3.2), "wheel", 2.6, 0.12, anchor=(0.5, 0.0))
    m.part = 0
    solid = [(1.6 - 1.6, 1.6 + 1.6, 0.0, 2.2, y1 - 2.4, y1 - 1.3), (5.55, 10.95, 0.0, 17.5, -11.7, -6.3), (-5.1, -3.3, 0.0, 2.3, -12.1, -11.5)]
    made = rows(w, d, ground, door, solid, floor=floor, ceiling=ceiling)
    return m, made


def apothecary():
    """The apothecary's shop: a tall house with a two-storey oriel, a stall counter under a
    striped awning beside its door, and the shop room inside."""
    m = Model("shop_a")
    w, d, ground, upper, door = 11.0, 8.4, 4.65, 11.4, (-2.76, -0.44)
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    rect, room, _top, _gap = lot(m, w, d, ground, 8.2, door)
    m.storey(*rect, 8.2, upper, "timber", collide=False)
    front, width = fronts(m, w, ground, rect, 8.2, windows=(3.1,), awnings=(3.1,), lantern_at=(8.9,))
    for z in (1.25, 8.2 - ground + 1.25):
        m.casement(front.at(width - 2.3, z, 0.0), width=1.5)
    m.oriel(front.at(3.3, 0.5, 0.0), width=3.0, storeys=2)
    for side, length in (("left", d), ("right", d), ("back", w)):
        m.arch_window(m.base_frame(side, length / 2, 1.5), width=1.7)
        fr, span = side_frame(side, *rect, ground)
        for z in (1.25, 8.2 - ground + 1.25):
            m.casement(fr.at(span / 2, z, 0.0), width=1.5, flowers=z < 2.0)
    surface = m.swept_roof(*rect, upper, rise=5.0, ridge="x", prow=1.3, sweep=0.6, horn=1.2, eave_out=1.05)
    m.dormer(surface, 0.0, (rect[2] + rect[3]) / 2, "x", along=2.2, out=3.0, side=-1.0, width=2.3)
    m.hanging_sign(front.at(width - 0.2, upper - ground - 0.6, 0.0), width=2.2)
    m.chimney(-3.0, y1 + 0.2, 1.5, 1.0, -1.0, upper + 6.5, lean=(0.1, -0.08), pots=3)
    # the stall counter (record: 2.38, -5.92) and its barrels (4.88, -5.76)
    m.counter(Frame((-2.3769 - 1.8, -5.9231 + 0.38, 0.0), (1, 0, 0)), length=3.6, depth=0.77)
    m.crate(-3.3, -5.9, 1.15, size=0.55, turn=0.3)
    m.barrel(-4.88, -6.3, size=0.95)
    m.barrel(-4.88, -5.2, size=0.8, turn=0.8)
    rx0, rx1, ry0, ry1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="right")
    m.part = 1
    m.counter(Frame((rx0 + 0.8, ry1 - 2.3, FLOOR), (1, 0, 0)), length=5.0)
    for i in range(3):
        m.box(m.inner_frame(*room, "back", 1.2 + i * 2.6, FLOOR + 1.6), 0.0, 2.2, 0.0, 0.1, 0.0, 0.4, ("band", "planks", "x", 0.4))
        m.barrel(rx0 + 1.4 + i * 2.6, ry1 - 0.6, FLOOR, size=0.7, turn=i)
    m.crate(rx1 - 1.0, ry0 + 0.9, FLOOR, size=0.9, turn=0.2)
    m.part = 0
    solid = [(-(rx0 + 5.8), -(rx0 + 0.8), 0.0, 1.6, ry1 - 2.3, ry1 - 1.5), (2.3769 - 1.8, 2.3769 + 1.8, 0.0, 1.2, -6.3, -5.55), (4.2, 5.6, 0.0, 1.3, -6.85, -4.7)]
    return m, rows(w, d, upper, door, solid, ceiling=ceiling)


def cottage():
    """The quay cottage: a low house under a long swept roof with dormers, nets on its
    wall and crates at its side. Its door is shut: the record is a sealed one."""
    m = Model("house_b")
    w, d, ground, upper = 12.7538, 8.5538, 4.4, 8.1
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    m.stone_base(x0, x1, y0, y1, ground)
    rect = (x0 - 0.3, x1 + 0.3, y0 - 0.5, y1 + 0.1)
    m.storey(*rect, ground, upper, "timber", collide=False)
    m.soffit(rect, (x0 + 0.16, x1 - 0.16, y0 + 0.16, y1 - 0.16), ground + 0.01)
    for c in range(6):
        m.corbel(m.base_frame("front", 0.45 + (w - 0.9) * c / 5, ground - 0.02), size=0.7)
    m.door(m.base_frame("front", w / 2), width=3.4)
    for along in (2.3, w - 2.3):
        m.arch_window(m.base_frame("front", along, 1.45), width=1.8)
    m.lantern(m.base_frame("front", w / 2 + 2.3, 3.4), reach=0.75)
    m.net(m.base_frame("front", w - 4.4, 3.6), width=2.6)
    front, width = side_frame("front", *rect, ground)
    for along in (2.3, width / 2, width - 2.3):
        m.casement(front.at(along, 1.3, 0.0), width=1.5)
    sides(m, w, d, ground, rect, upper)
    surface = m.swept_roof(*rect, upper, rise=5.2, ridge="x", prow=1.4, sweep=0.7, horn=1.3, eave_out=1.0)
    for along in (-3.2, 3.2):
        m.dormer(surface, 0.0, (rect[2] + rect[3]) / 2, "x", along=along, out=3.0, side=-1.0, width=2.2)
    m.chimney(x1 - 1.4, y1 + 0.3, 1.5, 1.0, -1.0, upper + 6.6, lean=(-0.1, -0.08), pots=3)
    m.banner(front.at(0.3, 3.2, 0.0), width=1.3)
    # the crates the lot keeps at its side (record: -7.03, -1.82)
    m.crate(7.03, -2.3, size=1.0, turn=0.1)
    m.crate(7.03, -1.3, size=0.95, turn=-0.2)
    m.crate(7.03, -1.8, 1.0, size=0.7, turn=0.5)
    return m, sealed(w, d, upper, [(-7.6, -6.45, 0.0, 1.6, -2.95, -0.7)])


def great_inn():
    """The great inn: a long hall under three prow gables, a round turret on its corner, a
    wall stack up its end, and a taproom inside with a long bar, a fire and rows of tables."""
    m = Model("tavern_b")
    w, d, ground, upper, door = 26.0, 15.0, 5.65, 9.65, (-3.5, -0.5)
    rect, room, _top, _gap = lot(m, w, d, ground, upper, door)
    front, width = fronts(m, w, ground, rect, upper, windows=(3.6, 7.0, 10.4, 19.8, 23.2), awnings=(7.0, 23.2), casements=(3.4, 6.6, 9.8, -9.8, -6.6, -3.4), lantern_at=(11.9, 18.1))
    sides(m, w, d, ground, rect, upper)
    m.oriel(front.at(width / 2 + 2.0, 0.5, 0.0), width=3.4, storeys=1)
    m.swept_roof(*rect, upper, rise=7.0, ridge="x", prow=1.7, sweep=0.9, eave_out=1.0, horn=1.5)
    for xa, xb in ((-11.4, -5.8), (-0.9, 4.9), (7.0, 12.4)):
        m.swept_roof(xa, xb, rect[2], 1.5, upper, rise=5.4, ridge="y", ends=(True, False), prow=(2.0, 0.0), horn=(1.6, 0.0), eave_out=0.55, gable="timber", collide=False)
        m.arch_window(Frame(((xa + xb) / 2, rect[2], upper + 0.8), (1, 0, 0)), width=1.6)
    m.hanging_sign(front.at(width - 0.2, (upper - ground) * 0.9, 0.0), width=2.5)
    m.banner(front.at(width * 0.36, (upper - ground) * 0.9, 0.0), width=1.4)
    # the turret at the front's corner (record: 13.5, -8.5) and the stack up the far end
    turret(m, -13.5, -8.5, 1.9, 15.2, windows=((-90.0, 6.6), (-90.0, 11.4), (180.0, 9.0)), lean=(-0.5, -0.2))
    m.chimney(13.47, -1.0, 1.0, 2.4, -1.0, upper + 8.8, lean=(0.06, 0.05), pots=3)
    m.chimney(-4.0, 3.0, 1.5, 1.5, upper + 1.0, upper + 10.0, lean=(-0.1, 0.08), pots=4)
    m.bench(-6.0, -8.3, 0.0, length=4.6)
    m.barrel(11.2, -8.4, size=1.05)
    m.barrel(12.3, -8.3, size=0.9, turn=0.7)
    m.crate(9.9, -8.4, size=0.9, turn=0.3)
    # the taproom
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="left")
    m.part = 1
    m.counter(Frame((x0 + 2.2, y1 - 2.4, FLOOR), (1, 0, 0)), length=10.0)
    for i, bx in enumerate((x0 + 2.9, x0 + 4.1, x0 + 5.3, x0 + 9.4, x0 + 10.6)):
        m.barrel(bx, y1 - 0.75, FLOOR, size=1.0 if i % 2 == 0 else 0.85, turn=i * 0.7)
    for tx, ty in ((-7.5, -2.6), (-7.5, 1.4), (5.4, 2.6), (9.4, -2.4), (9.6, 2.6)):
        m.table(tx, ty, FLOOR, length=2.8, width=1.1)
        m.bench(tx, ty - 0.95, FLOOR, length=2.6)
        m.bench(tx, ty + 0.95, FLOOR, length=2.6)
    m.crate(x1 - 1.1, y0 + 0.9, FLOOR, size=0.95, turn=0.2)
    m.crate(x1 - 2.2, y0 + 0.85, FLOOR, size=0.8, turn=-0.3)
    m.part = 0
    solid = [(-(x0 + 12.2), -(x0 + 2.2), 0.0, 1.6, y1 - 2.4, y1 - 1.6), (13.5 - 1.9, 13.5 + 1.9, 0.0, 15.2, -8.5 - 1.9, -8.5 + 1.9), (-13.97, -12.97, 0.0, 14.0, -2.2, 0.2)]
    return m, rows(w, d, upper, door, solid, ceiling=ceiling)


def potion_shop():
    """The potion shop: a tall gabled house with a round turret on its corner and a shop
    room inside, the counter under shelves of jars."""
    m = Model("shop_b")
    w, d, ground, mid, upper, door = 9.4, 9.0, 4.65, 8.0, 11.2, (-1.86, 0.46)
    rect, room, _top, _gap = lot(m, w, d, ground, mid, door)
    m.storey(*rect, mid, upper, "timber", collide=False)
    front, width = fronts(m, w, ground, rect, mid, windows=(8.1,), awnings=(8.1,), lantern_at=(3.0,))
    for z in (1.25, mid - ground + 1.25):
        m.casement(front.at(2.7, z, 0.0), width=1.5)
    m.oriel(front.at(width - 3.0, 0.5, 0.0), width=2.8, storeys=2)
    for side, length in (("left", d), ("right", d), ("back", w)):
        m.arch_window(m.base_frame(side, length / 2, 1.5), width=1.7)
        fr, span = side_frame(side, *rect, ground)
        for z in (1.25, mid - ground + 1.25):
            m.casement(fr.at(span / 2, z, 0.0), width=1.5, flowers=z < 2.0)
    m.swept_roof(*rect, upper, rise=5.4, ridge="y", prow=(1.9, 0.9), sweep=0.7, horn=(1.5, 1.0), eave_out=0.95)
    m.arch_window(Frame((0.6, rect[2], upper + 0.9), (1, 0, 0)), width=1.5)
    m.hanging_sign(front.at(width - 0.2, upper - ground - 0.7, 0.0), width=2.1)
    # the turret on the corner (record: 5.19, -4.99)
    turret(m, -5.19, -4.99, 1.33, upper + 1.8, windows=((-90.0, 6.2), (-90.0, 10.2), (180.0, 8.2)), lean=(-0.45, -0.15))
    m.chimney(2.6, d / 2 + 0.2, 1.4, 1.0, -1.0, upper + 6.8, lean=(0.08, -0.08), pots=3)
    m.barrel(4.0, -5.3, size=0.9)
    m.crate(2.9, -5.3, size=0.8, turn=0.3)
    rx0, rx1, ry0, ry1 = room
    ceiling = ground - 0.3
    lit_room(m, room, FLOOR, ceiling, hearth_side="right")
    m.part = 1
    m.counter(Frame((rx0 + 0.8, ry1 - 2.3, FLOOR), (1, 0, 0)), length=4.6, band="gilded")
    for i in range(3):
        m.box(m.inner_frame(*room, "back", 0.9 + i * 2.4, FLOOR + 1.7), 0.0, 2.0, 0.0, 0.1, 0.0, 0.4, ("band", "planks", "x", 0.4))
        m.barrel(rx0 + 1.3 + i * 2.2, ry1 - 0.6, FLOOR, size=0.7, turn=i)
    m.crate(rx1 - 1.0, ry0 + 0.9, FLOOR, size=0.9, turn=0.2)
    m.part = 0
    solid = [(-(rx0 + 5.4), -(rx0 + 0.8), 0.0, 1.6, ry1 - 2.3, ry1 - 1.5), (5.19 - 1.33, 5.19 + 1.33, 0.0, upper + 1.8, -4.99 - 1.33, -4.99 + 1.33)]
    return m, rows(w, d, upper, door, solid, ceiling=ceiling)


def small_cottage():
    """The small cottage: one room wide, its gable and prow to the street, a dormer on its
    slope. Its door is shut: the record is a sealed one."""
    m = Model("house_a")
    w, d, ground, upper = 9.36, 7.96, 4.2, 7.7
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    m.stone_base(x0, x1, y0, y1, ground)
    rect = (x0 - 0.3, x1 + 0.3, y0 - 0.5, y1 + 0.1)
    m.storey(*rect, ground, upper, "timber", collide=False)
    m.soffit(rect, (x0 + 0.16, x1 - 0.16, y0 + 0.16, y1 - 0.16), ground + 0.01)
    for c in range(5):
        m.corbel(m.base_frame("front", 0.45 + (w - 0.9) * c / 4, ground - 0.02), size=0.7)
    m.door(m.base_frame("front", w / 2 + 1.4), width=3.1)
    m.arch_window(m.base_frame("front", 2.1, 1.45), width=1.8)
    m.awning(m.base_frame("front", 2.1, 4.1), width=2.6, depth=1.3, drop=0.8)
    m.lantern(m.base_frame("front", w / 2 - 0.55, 3.3), reach=0.75)
    front, width = side_frame("front", *rect, ground)
    for along in (2.2, width - 2.4):
        m.casement(front.at(along, 1.3, 0.0), width=1.5)
    sides(m, w, d, ground, rect, upper)
    surface = m.swept_roof(*rect, upper, rise=5.0, ridge="y", prow=(1.8, 0.9), sweep=0.7, horn=(1.5, 1.0), eave_out=0.95)
    m.arch_window(Frame((0.0, rect[2], upper + 0.8), (1, 0, 0)), width=1.5)
    m.dormer(surface, (rect[0] + rect[1]) / 2, 0.0, "y", along=0.6, out=2.6, side=1.0, width=2.0)
    m.chimney(x0 + 1.5, y1 + 0.3, 1.4, 1.0, -1.0, upper + 6.4, lean=(0.1, -0.08), pots=3)
    m.banner(front.at(width - 0.3, 3.0, 0.0), width=1.2)
    m.barrel(x1 + 0.7, -2.4, size=1.0)
    m.crate(x1 + 0.75, -1.2, size=0.85, turn=0.4)
    return m, sealed(w, d, upper)


def tower_house():
    """The tower house: a deep, narrow house of three storeys with its gable to the street
    and a round tower at its back corner rising over the roof. Its door is shut."""
    m = Model("house_c")
    w, d, ground, mid, upper = 8.56, 11.96, 4.6, 8.0, 11.3
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    m.stone_base(x0, x1, y0, y1, ground)
    rect = (x0 - 0.3, x1 + 0.3, y0 - 0.5, y1 + 0.1)
    m.storey(*rect, ground, mid, "timber", collide=False)
    m.storey(*rect, mid, upper, "timber", collide=False)
    m.soffit(rect, (x0 + 0.16, x1 - 0.16, y0 + 0.16, y1 - 0.16), ground + 0.01)
    for c in range(4):
        m.corbel(m.base_frame("front", 0.45 + (w - 0.9) * c / 3, ground - 0.02), size=0.7)
    m.door(m.base_frame("front", w / 2 + 1.6), width=3.0)
    m.arch_window(m.base_frame("front", 1.9, 1.5), width=1.7)
    m.lantern(m.base_frame("front", w / 2 - 0.35, 3.5), reach=0.75)
    front, width = side_frame("front", *rect, ground)
    m.oriel(front.at(2.5, 0.5, 0.0), width=2.7, storeys=2)
    for z in (1.25, mid - ground + 1.25):
        m.casement(front.at(width - 2.2, z, 0.0), width=1.5)
    for side, length in (("left", d), ("right", d)):
        for f in (0.28, 0.72):
            m.arch_window(m.base_frame(side, length * f, 1.5), width=1.7)
            fr, span = side_frame(side, *rect, ground)
            for z in (1.25, mid - ground + 1.25):
                m.casement(fr.at(span * f, z, 0.0), width=1.5, flowers=z < 2.0)
    m.arch_window(m.base_frame("back", w * 0.62, 1.5), width=1.7)
    m.swept_roof(*rect, upper, rise=6.0, ridge="y", prow=(2.1, 1.0), sweep=0.8, horn=(1.7, 1.1), eave_out=0.95)
    m.arch_window(Frame((0.0, rect[2], upper + 1.0), (1, 0, 0)), width=1.5)
    m.banner(front.at(width - 0.3, upper - ground - 0.6, 0.0), width=1.3)
    # the tower at the back corner (record: 4.61, 6.31)
    turret(m, -4.61, 6.31, 1.4, upper + 5.4, windows=((180.0, 7.0), (180.0, 12.0), (90.0, 14.6), (-90.0, 14.6)), lean=(-0.5, 0.25))
    m.chimney(x1 - 1.3, 1.5, 1.3, 1.3, upper + 1.0, upper + 8.4, lean=(0.1, 0.06), pots=3)
    m.barrel(x1 + 0.7, -4.6, size=1.0)
    m.crate(x1 + 0.75, -3.4, size=0.9, turn=0.3)
    return m, sealed(w, d, upper, [(4.61 - 1.4, 4.61 + 1.4, 0.0, upper + 5.4, 6.31 - 1.4, 6.31 + 1.4)])


# Lantern Hall's name board: height of its centre over the ground line, and the width and
# height of the lettering the game paints on it (render/highwatch_guild_sign.ts).
GUILD_SIGN = (7.9, 7.0, 1.477)


def guild():
    """Lantern Hall, the adventurers' guild: a great stone hall under a jettied timber storey
    and one long prow roof, a gable with a golden figurehead over its doors, a lantern tower
    burning at its corner and a trophy hall behind. Inside, the great hall keeps its hearth,
    the quartermaster's counter, the clerk's desk and board and the map table where the
    residents stand, and an arch leads through to the trophy hall."""
    m = Model("guild")
    w, d, ground, upper, door, floor = 29.8, 21.8, 10.4, 13.6, (-1.61, 1.61), 0.6
    arch = (-2.8, 2.8, 6.6)
    rect, room, _top, _gap = lot(m, w, d, ground, upper, door, floor=floor, back_door=arch)
    x0, x1, y0, y1 = room
    ceiling = ground - 0.3
    # the street front: tall windows, lamps and banners either side of the doors
    for along in (3.6, 7.6, 22.2, 26.2):
        m.arch_window(m.base_frame("front", along, 1.8), width=2.6)
        m.arch_window(m.base_frame("front", along, 6.0), width=2.0)
    for along in (11.2, 18.6):
        m.lantern(m.base_frame("front", along, 4.4), reach=0.85, size=1.3)
    # the banners hang clear of the name board between them
    for along in (9.75, 20.05):
        m.banner(m.base_frame("front", along, 9.4), width=1.6, flat=True)
    for side in ("left", "right"):
        for i in range(3):
            along = d * (i + 0.5) / 3
            if side == "left" and i == 0:
                continue
            m.arch_window(m.base_frame(side, along, 1.8), width=2.6)
            m.arch_window(m.base_frame(side, along, 6.0), width=2.0)
            m.box(m.base_frame(side, along + d / 6 - 0.45, -1.0), 0.0, 0.9, 0.0, 8.6, 0.0, 0.7, ("tile", "stone"), skip="k", shade=0.92)
    for along in (2.6, w - 2.6):
        m.arch_window(m.base_frame("back", along, 2.2), width=2.4)
    front, width = side_frame("front", *rect, ground)
    for along in (3.0, 6.4, 9.8, -9.8, -6.4, -3.0):
        m.casement(front.at(along if along >= 0 else width + along, (upper - ground) * 0.36, 0.0), width=1.6)
    for side, length in (("left", d), ("right", d), ("back", w)):
        fr, span = side_frame(side, *rect, ground)
        count = max(2, round(length / 5.0))
        for i in range(count):
            m.casement(fr.at(span * (i + 0.5) / count, (upper - ground) * 0.36, 0.0), width=1.5, flowers=i % 2 == 0)
    m.oriel(front.at(width / 2, 0.4, 0.0), width=3.6, storeys=1)
    m.swept_roof(*rect, upper, rise=9.0, ridge="x", prow=2.0, sweep=1.1, eave_out=1.1, horn=1.8)
    for xa, xb in ((-12.4, -7.4), (7.4, 12.4)):
        m.swept_roof(xa, xb, rect[2], 1.5, upper, rise=5.0, ridge="y", ends=(True, False), prow=(1.9, 0.0), horn=(1.5, 0.0), eave_out=0.5, gable="timber", collide=False)
        m.arch_window(Frame(((xa + xb) / 2, rect[2], upper + 0.7), (1, 0, 0)), width=1.5)
    m.swept_roof(-5.4, 5.4, rect[2], 2.5, upper, rise=7.6, ridge="y", ends=(True, False), prow=(2.6, 0.0), horn=(2.0, 0.0), eave_out=0.6, gable="timber", collide=False)
    m.figurehead(0, width=3.6, thick=0.55, back=1.2, drop=0.75)
    m.relief(Frame((0.0, rect[2], upper + 1.0), (1, 0, 0)), "wheel", 2.6, 0.16, anchor=(0.5, 0.0))
    m.hanging_sign(front.at(width - 0.2, (upper - ground) * 0.9, 0.0), width=2.6)
    # The name board over the doors: an oak board in a gilded frame, fixed to the wall between
    # the doors' arch and the jetty. The game paints the guild's name on its face
    # (render/highwatch_guild_sign.ts HIGHWATCH_GUILD_SIGN, pinned to this board by
    # tests/highwatch_guild_sign.test.ts), so the lettering always sits on the hall itself.
    board = m.base_frame("front", w / 2, GUILD_SIGN[0])
    bw, bh, bt, rim = GUILD_SIGN[1] / 2 + 0.12, GUILD_SIGN[2] / 2 + 0.12, 0.18, 0.13
    m.part = m.named_part("G_SignBoard")
    m.box(board, -bw, bw, -bh, bh, 0.0, bt, ("band", "planks", "x", 0.6), skip="k", shade=0.7)
    for u0, u1 in ((bh, bh + rim), (-bh - rim, -bh)):
        m.box(board, -bw - rim, bw + rim, u0, u1, 0.0, bt + 0.1, ("band", "gilded", "x", 0.2), skip="k")
    for r0, r1 in ((-bw - rim, -bw), (bw, bw + rim)):
        m.box(board, r0, r1, -bh, bh, 0.0, bt + 0.1, ("band", "gilded", "y", 0.2), skip="k")
    m.part = 0
    # the lantern tower at the front's corner (record: 18.2, -7.6, 6.6 square)
    tx0, tx1, ty0, ty1, top = -21.5, -14.9, -10.9, -4.3, 21.0
    m.storey(tx0, tx1, ty0, ty1, -1.0, top, "stone", collide=False)
    for side in ("front", "left", "back"):
        fr, span = side_frame(side, tx0, tx1, ty0, ty1, 0.0)
        for height in (5.0, 11.0, 16.4):
            m.arch_window(fr.at(span / 2, height, 0.0), width=1.9)
    cx, cy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    axis = Frame((cx, cy, 0.0), (1, 0, 0), UP, (0, 1, 0))
    half = (tx1 - tx0) / 2
    r = half * math.sqrt(2.0)
    m.lathe(axis, [(r, top - 0.1), (r + 0.7, top + 0.25)], sides=4, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(r + 0.72, top + 0.2), (r + 0.72, top + 0.42)], sides=4, skin=("band", "gilded", 0.2), smooth=False)
    # the lantern itself: a glazed stage that burns all night
    inset = 0.55
    m.storey(tx0 + inset, tx1 - inset, ty0 + inset, ty1 - inset, top + 0.3, top + 3.9, "glass", collide=False)
    for px in (tx0 + inset, tx1 - inset):
        for py in (ty0 + inset, ty1 - inset):
            m.sweep([(px, py, top + 0.3), (px, py, top + 3.9)], (0.34, 0.34), "oak", depth=0.4, caps=False)
    rg = (half - inset) * math.sqrt(2.0)
    crown = top + 3.9
    m.lathe(axis, [(rg + 1.3, crown - 0.3), (rg + 0.1, crown + 0.9), (rg * 0.5, crown + 4.4), (rg * 0.2, crown + 7.6), (0.03, crown + 9.8)], sides=4, skin=("tile", "slate"), smooth=False, lean=[(0, 0), (0, 0), (-0.1, -0.05), (-0.35, -0.15), (-0.8, -0.3)])
    m.lathe(axis, [(rg, crown - 0.1), (rg + 1.3, crown - 0.4)], sides=4, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(rg + 1.32, crown - 0.44), (rg + 1.32, crown - 0.24)], sides=4, skin=("band", "gilded", 0.2), smooth=False)
    m.gem(Vector((cx - 0.8, cy - 0.3, crown + 10.1)), 0.2, stretch=1.9)
    # the trophy hall behind (record: 0, 15.9, 18.8 x 10) and the two stacks
    hx, hy0, hy1, htop = 9.4, d / 2, d / 2 + 10.0, 8.0
    m.storey(-hx, hx, hy0, hy1, -1.0, htop, "stone", sides=("right", "back", "left"), collide=False)
    m.swept_roof(-hx - 0.3, hx + 0.3, hy0, hy1 + 0.3, htop, rise=6.2, ridge="y", ends=(False, True), prow=(0.0, 1.7), horn=(0.0, 1.5), eave_out=0.9, gable="stone", collide=False)
    for side_x in (-hx, hx):
        for py in (hy0 + 2.8, hy0 + 7.0):
            m.arch_window(Frame((side_x, py, 1.8), (0.0, 1.0 if side_x > 0 else -1.0, 0.0)), width=2.0)
    m.chimney(15.7, 6.6, 1.6, 2.6, -1.0, upper + 9.4, lean=(0.06, 0.05), pots=4)
    m.chimney(0.0, hy1 + 0.7, 2.2, 1.4, -1.0, htop + 9.0, lean=(0.05, 0.06), pots=3)
    m.barrel(11.0, y0 - 1.5, size=1.1)
    m.barrel(12.2, y0 - 1.4, size=0.95, turn=0.7)
    m.crate(-9.6, y0 - 1.5, size=1.0, turn=0.2)
    # the great hall: hearth on the wall the guildmaster stands by (record x -14, z 6.6)
    lit_room(m, room, floor, ceiling, hearth_side="right", rugs=0, lamps=0, hearth_along=y1 - 6.6, hearth_width=3.8)
    m.part = 1
    # the quartermaster's counter (he stands at record -12.4, -0.6), the clerk's desk and
    # the contracts board (12.6, 0), the recruiter's map table (7.3, 8.6)
    m.counter(Frame((10.4, -3.4, floor), (0.0, 1.0, 0.0)), length=5.6, band="gilded")
    m.table(-10.4, 0.0, floor, length=2.8, width=1.2, turn=math.pi / 2)
    board = m.inner_frame(*room, "left", -y0 - 1.6, floor + 1.5)
    m.box(board, 0.0, 3.2, 0.0, 2.3, 0.0, 0.12, ("band", "planks", "x", 0.6))
    m.box(board, -0.12, 3.32, 2.3, 2.5, 0.0, 0.2, ("band", "gilded", "x", 0.2))
    m.table(-7.3, 6.6, floor, length=3.2, width=1.8)
    for tx, ty in ((-3.6, -5.4), (3.6, -5.4)):
        m.table(tx, ty, floor, length=3.0, width=1.1)
        m.bench(tx, ty - 0.95, floor, length=2.8)
        m.bench(tx, ty + 0.95, floor, length=2.8)
    for side, length in (("left", y1 - y0), ("right", y1 - y0)):
        for f in (0.18, 0.82):
            m.banner(m.inner_frame(*room, side, length * f, floor + 8.2), width=1.5, flat=True)
    m.part = 0
    # the arch through the back wall and the trophy hall beyond it
    m.passage(arch[0], arch[1], y1, hy0, floor, arch[2])
    trophy = (-hx + WALL, hx - WALL, hy0, hy1 - WALL)
    tceil = htop - 0.3
    m.room(*trophy, floor, tceil, door=arch)
    m.part = 1
    tx0r, tx1r, ty0r, ty1r = trophy
    m.hearth(m.inner_frame(*trophy, "back", (tx1r - tx0r) / 2, floor), width=3.4, height=tceil - floor)
    for side, length in (("left", ty1r - ty0r), ("right", ty1r - ty0r)):
        for f in (0.2, 0.8):
            m.lantern(m.inner_frame(*trophy, side, length * f, floor + 3.4), reach=0.55, size=1.0)
    # The five dungeon plaques: two a side wall and one on the chimney breast over the fire.
    # Each plaque is part of the room; its trophy and its gilt frame are objects of their own
    # that the game shows to a player who has cleared that dungeon (the names are
    # render/highwatch_guild_trophies_core.ts guildTrophyNodeNames; the order is
    # GUILD_TROPHY_DUNGEONS there).
    side_length = ty1r - ty0r
    breast = m.inner_frame(*trophy, "back", (tx1r - tx0r) / 2, floor + 2.7).at(0.0, 0.0, 0.9)
    plaques = (
        ("hollow_crypt", "keystone", m.inner_frame(*trophy, "left", side_length * 0.38, floor + 2.5)),
        ("sunken_bastion", "wheel", m.inner_frame(*trophy, "left", side_length * 0.62, floor + 2.5)),
        ("drowned_temple", "finial", m.inner_frame(*trophy, "right", side_length * 0.38, floor + 2.5)),
        ("wildheart_basin", "corbel", m.inner_frame(*trophy, "right", side_length * 0.62, floor + 2.5)),
        ("gravewyrm_sanctum", "figurehead", breast),
    )
    for dungeon, emblem, fr in plaques:
        m.part = 1
        m.box(fr, -0.75, 0.75, 0.0, 1.5, 0.0, 0.08, ("band", "planks", "x", 0.5), skip="k")
        m.part = m.named_part("G_INT_Trophy_" + dungeon)
        m.relief(fr.at(0.0, 0.2, 0.08), emblem, 1.1, 0.14, anchor=(0.5, 0.0))
        m.part = m.named_part("G_INT_TrophyGilt_" + dungeon)
        m.box(fr, -0.87, 0.87, 1.5, 1.62, 0.0, 0.14, ("band", "gilded", "x", 0.2), skip="k")
        m.box(fr, -0.87, 0.87, -0.12, 0.0, 0.0, 0.14, ("band", "gilded", "x", 0.2), skip="k")
        m.box(fr, -0.87, -0.75, 0.0, 1.5, 0.0, 0.14, ("band", "gilded", "y", 0.2), skip="k")
        m.box(fr, 0.75, 0.87, 0.0, 1.5, 0.0, 0.14, ("band", "gilded", "y", 0.2), skip="k")
    m.part = 1
    for f in (0.2, 0.8):
        m.banner(m.inner_frame(*trophy, "back", (tx1r - tx0r) * f, floor + 6.2), width=1.4, flat=True)
    m.crate(tx0r + 1.0, ty1r - 1.0, floor, size=1.0, turn=0.2)
    m.barrel(tx1r - 1.0, ty1r - 1.0, floor, size=1.0)
    m.part = 0
    solid = [
        (-11.2, -10.4, 0.0, 1.6, -3.4, 2.2),
        (9.8, 11.0, 0.0, 1.0, -1.4, 1.4),
        (5.7, 8.9, 0.0, 1.0, 5.7, 7.5),
        (14.9, 21.5, 0.0, 25.0, -10.9, -4.3),
        (-16.5, -14.9, 0.0, 14.0, 5.3, 7.9),
        (-1.1, 1.1, 0.0, 14.0, hy1, hy1 + 1.4),
        (-hx, -hx + WALL, 0.0, htop, hy0, hy1),
        (hx - WALL, hx, 0.0, htop, hy0, hy1),
        (-hx, hx, 0.0, htop, hy1 - WALL, hy1),
    ]
    made = rows(w, d, upper, door, solid, floor=floor, ceiling=ceiling, back_gap=arch)
    made["ramps"].append({"x": 0.0, "z": (hy0 + hy1 - WALL) / 2, "hx": hx - WALL, "hz": (hy1 - WALL - hy0) / 2, "y0": 1.0 + floor, "y1": 1.0 + floor})
    made["air"]["boxes"].append([arch[0], arch[1], floor, arch[2] - 0.35, d / 2 - WALL - 0.9, d / 2 + 0.9])
    made["air"]["boxes"].append([-hx + WALL + 0.25, hx - WALL - 0.25, floor, tceil - 0.35, d / 2 + 0.25, hy1 - WALL - 1.2])
    return m, made


LOTS = {
    "tavern": inn,
    "bank": bank,
    "smithy": smithy,
    "hall": chapel,
    "shop_a": apothecary,
    "house_b": cottage,
    "tavern_b": great_inn,
    "shop_b": potion_shop,
    "house_a": small_cottage,
    "house_c": tower_house,
    "guild": guild,
}
