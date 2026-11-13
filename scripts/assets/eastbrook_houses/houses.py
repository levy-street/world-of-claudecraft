# The Eastbrook houses. Each function assembles one building from the kit and returns the
# Model; build.py turns it into a GLB. Sizes are yards, the front is on -Y.
#
# The look they share: a chunky stone ground floor, timber
# storeys jettied out over it on carved brackets, a steep bell-cast slate roof whose gable
# leans out over the street like a prow, gold on every edge.
import math

import kit
import props
from kit import STOREY, UP, Frame, Model, side_frame
from mathutils import Vector


def shell(m, x0, x1, y0, y1, ground=4.0, storeys=1, jetty=(0.55, 0.3, 0.1), upper=0.7, corbels=True):
    """A stone ground floor with timber storeys jettied out over it. `jetty` is how far the
    first storey oversails the stone at the (front, sides, back); every storey above grows by
    `upper` times that again. Returns ([(rect, z0, z1) per storey], eave height)."""
    m.stone_base(x0, x1, y0, y1, ground)
    below = (x0 + 0.16, x1 - 0.16, y0 + 0.16, y1 - 0.16)
    rect = (x0, x1, y0, y1)
    z = ground
    floors = []
    for i in range(storeys):
        grow = 1.0 if i == 0 else upper
        front, side, back = (j * grow for j in jetty)
        rect = (rect[0] - side, rect[1] + side, rect[2] - front, rect[3] + back)
        m.storey(*rect, z, z + STOREY, "timber")
        if front > 0.01 or side > 0.01:
            m.soffit(rect, below, z + 0.01)
        if corbels and front > 0.2:
            if i == 0:
                top, span = m.base_frame("front", 0.0, z), x1 - x0
            else:
                top, span = side_frame("front", *below, z)
            count = max(2, round(span / 2.3) + 1)
            for c in range(count):
                m.corbel(top.at(0.42 + (span - 0.84) * c / (count - 1), -0.02, 0.0), size=0.28 + front * 0.8)
        floors.append((rect, z, z + STOREY))
        below = rect
        z += STOREY
    return floors, z


def centre(rect):
    return (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2


def merchant_house():
    """A gable-fronted merchant's house: door and an arched window in the stone, two
    shuttered casements in the jettied storey, a wheel in the gable, a stack up one side."""
    m = Model("merchant_house")
    x0, x1, y0, y1 = -3.5, 3.5, -4.5, 4.5
    floors, eave = shell(m, x0, x1, y0, y1)
    rect, za, _zb = floors[0]
    m.door(m.base_frame("front", 2.25), width=3.3)
    m.arch_window(m.base_frame("front", 5.55, 1.35), width=1.6)
    m.lantern(m.base_frame("front", 4.3, 3.05), reach=0.75)
    m.arch_window(m.base_frame("left", 4.5, 1.35), width=1.6)
    m.arch_window(m.base_frame("right", 2.6, 1.35), width=1.6)
    m.net(m.base_frame("left", 7.3, 3.0), width=2.6)
    m.ivy(m.base_frame("left", 1.5, 0.5), width=2.4)
    front, width = side_frame("front", *rect, za)
    for along in (1.9, width - 1.9):
        m.casement(front.at(along, 1.3, 0.0), width=1.5)
    for side in ("left", "right"):
        fr, length = side_frame(side, *rect, za)
        m.casement(fr.at(length / 2 - 0.2, 1.3, 0.0), width=1.5, flowers=side == "left")
    m.hanging_sign(front.at(width - 0.2, 3.25, 0.0), width=2.0)
    m.banner(front.at(0.28, 3.3, 0.0), width=1.25)
    surface = m.swept_roof(*rect, eave, rise=5.6, ridge="y", prow=(1.8, 1.0), sweep=0.8, horn=(1.6, 1.1))
    cx, cy = centre(rect)
    m.dormer(surface, cx, cy, "y", along=-0.6, out=2.7, side=-1.0, width=2.2)
    gable = front.at(width / 2, STOREY, 0.0)
    m.arch_window(gable.at(0.0, 0.7, 0.0), width=1.5)
    m.relief(gable.at(0.0, 2.75, 0.0), "wheel", 1.25, 0.12, anchor=(0.5, 0.0))
    back, bwidth = side_frame("back", *rect, za)
    m.arch_window(back.at(bwidth / 2, STOREY + 0.7, 0.0), width=1.5, keystone=False)
    m.chimney(x1 + 0.35, 1.6, 1.0, 1.5, -3.0, 14.4, lean=(-0.12, 0.1), pots=3)
    m.collide(x1, x1 + 0.85, 0.85, 2.35, 0.0, 14.0)
    m.barrel(x1 - 0.55, y0 - 0.8, size=0.95)
    m.barrel(x1 + 0.25, y0 - 0.55, size=0.8, turn=0.6)
    m.crate(x0 + 0.1, y0 - 0.75, size=0.95, turn=0.2)
    m.crate(x0 + 0.05, y0 - 0.7, z=0.95, size=0.7, turn=-0.3)
    m.lean(0.028, -0.014, above=4.0)
    return m


def oriel_house():
    """A tall corner house, eaves to the street: a two-storey oriel bay with its own little
    roof, the great fish sign on the corner, a dormer over the door."""
    m = Model("oriel_house")
    x0, x1, y0, y1 = -3.9, 3.9, -4.2, 4.2
    floors, eave = shell(m, x0, x1, y0, y1, ground=4.2, storeys=2, jetty=(0.5, 0.25, 0.1), upper=0.0)
    (r1, za, _), (r2, zc, _zd) = floors
    m.door(m.base_frame("front", 2.15), width=3.2)
    m.arch_window(m.base_frame("front", 5.95, 1.45), width=1.6)
    m.lantern(m.base_frame("front", 4.25, 3.15), reach=0.75)
    m.net(m.base_frame("right", 2.7, 3.1), width=2.7)
    m.ivy(m.base_frame("left", 1.7, 0.5), width=2.6)
    m.arch_window(m.base_frame("left", 5.2, 1.45), width=1.6)
    m.arch_window(m.base_frame("right", 6.2, 1.45), width=1.6)
    front, width = side_frame("front", *r1, za)
    m.oriel(front.at(width - 2.6, 0.55, 0.0), width=3.0, storeys=2)
    for z in (1.3, STOREY + 1.3):
        m.casement(front.at(2.0, z, 0.0), width=1.5)
    for side in ("left", "right"):
        fr, length = side_frame(side, *r1, za)
        for z in (1.3, STOREY + 1.3):
            m.casement(fr.at(length / 2, z, 0.0), width=1.5, flowers=(z < 2.0) == (side == "left"))
    m.hanging_sign(front.at(width - 0.18, STOREY * 2 - 0.5, 0.0), width=2.3)
    m.banner(front.at(0.25, STOREY + 3.1, 0.0), width=1.3)
    surface = m.swept_roof(*r2, eave, rise=4.9, ridge="x", prow=1.25, sweep=0.6, horn=1.2, eave_out=1.05)
    cx, cy = centre(r2)
    m.dormer(surface, cx, cy, "x", along=-1.9, out=2.9, side=-1.0, width=2.3)
    m.dormer(surface, cx, cy, "x", along=2.0, out=2.9, side=1.0, width=2.2)
    for side in ("left", "right"):
        fr, length = side_frame(side, *r2, eave)
        m.arch_window(fr.at(length / 2, 0.6, 0.0), width=1.4)
    m.chimney(-1.4, y1 + 0.45, 1.6, 1.0, -3.0, eave + 6.3, lean=(0.1, -0.08), pots=3)
    m.collide(-2.2, -0.6, y1, y1 + 0.95, 0.0, eave + 6.0)
    m.barrel(x1 - 0.5, y0 - 0.85, size=1.0)
    m.barrel(x1 - 1.45, y0 - 0.7, size=0.85, turn=1.1)
    m.barrel(x1 - 0.95, y0 - 0.8, z=1.02, size=0.7, turn=0.4)
    m.crate(x1 + 0.75, y0 + 1.2, size=1.0, turn=0.15)
    m.lean(-0.022, -0.016, above=4.2)
    return m


def prow_hall():
    """The harbour hall: a broad stone ground floor under one enormous swept roof that
    leans out over its doors like the prow of a ship, a golden figurehead riding the peak."""
    m = Model("prow_hall")
    x0, x1, y0, y1 = -5.6, 5.6, -7.0, 7.0
    floors, eave = shell(m, x0, x1, y0, y1, ground=4.4, storeys=1, jetty=(0.6, 0.35, 0.15))
    rect, za, _zb = floors[0]
    m.door(m.base_frame("front", 5.6), width=4.1)
    for along in (1.7, 9.5):
        m.arch_window(m.base_frame("front", along, 1.5), width=1.7)
    for along in (3.0, 8.2):
        m.lantern(m.base_frame("front", along, 3.45), reach=0.8, size=1.15)
    for side in ("left", "right"):
        for along in (2.8, 7.0, 11.2):
            m.arch_window(m.base_frame(side, along, 1.5), width=1.6)
    m.net(m.base_frame("right", 4.9, 3.3), width=3.0)
    m.ivy(m.base_frame("left", 4.9, 0.5), width=2.8)
    m.ivy(m.base_frame("back", 3.0, 0.5), width=3.0)
    front, width = side_frame("front", *rect, za)
    for along in (2.2, width / 2, width - 2.2):
        m.casement(front.at(along, 1.3, 0.0), width=1.5)
    for side in ("left", "right"):
        fr, length = side_frame(side, *rect, za)
        for along in (2.6, length / 2, length - 2.6):
            m.casement(fr.at(along, 1.3, 0.0), width=1.5, flowers=along < length / 2 + 0.1)
    m.banner(front.at(0.3, 3.3, 0.0), width=1.5)
    m.banner(front.at(width - 0.3, 3.3, 0.0), width=1.5)
    surface = m.swept_roof(*rect, eave, rise=7.8, ridge="y", eave_out=1.35, eave_drop=0.7, prow=(3.0, 1.2), sweep=1.3, horn=(0.0, 1.8), gable="hull", board=0.62, thick=0.28)
    m.figurehead(0, width=3.6, thick=0.55, back=1.2, drop=0.75)
    gable = front.at(width / 2, STOREY, 0.0)
    m.arch_window(gable.at(0.0, 0.9, 0.0), width=2.0)
    m.relief(gable.at(0.0, 3.5, 0.0), "wheel", 1.7, 0.14, anchor=(0.5, 0.0))
    back, bwidth = side_frame("back", *rect, za)
    m.arch_window(back.at(bwidth / 2, STOREY + 0.9, 0.0), width=1.8, keystone=False)
    cx, cy = centre(rect)
    for side in (-1.0, 1.0):
        for along in (-3.4, 2.6):
            m.dormer(surface, cx, cy, "y", along=along, out=4.2, side=side, width=2.5)
    m.chimney(x0 + 1.4, y1 + 0.5, 1.8, 1.1, -3.0, eave + 9.3, lean=(0.14, -0.1), pots=4)
    m.collide(x0 + 0.5, x0 + 2.3, y1, y1 + 1.05, 0.0, eave + 9.0)
    m.barrel(x0 + 0.45, y0 - 0.85, size=1.05)
    m.barrel(x0 + 1.4, y0 - 0.7, size=0.9, turn=0.8)
    m.barrel(x0 + 0.9, y0 - 0.8, z=1.1, size=0.75, turn=0.3)
    m.crate(x1 - 0.7, y0 - 0.85, size=1.05, turn=-0.15)
    m.crate(x1 - 1.85, y0 - 0.8, size=0.85, turn=0.35)
    m.crate(x1 - 0.8, y0 - 0.8, z=1.05, size=0.7, turn=0.5)
    m.lean(0.0, -0.022, above=4.4)
    return m


def gable_bay(m, x0, x1, y0, y1, ground, storeys, rise, ground_floor, signs=(), dormer=None, upper=0.7, gable="window", prow=1.6):
    """One gable-fronted house of a row. `ground_floor` lists what stands in its stone front
    as (kind, yards along): "door", "window", "shop" (a window under an awning)."""
    floors, eave = shell(m, x0, x1, y0, y1, ground=ground, storeys=storeys, jetty=(0.55, 0.0, 0.1), upper=upper)
    for kind, along in ground_floor:
        if kind == "door":
            m.door(m.base_frame("front", along), width=3.1)
            m.lantern(m.base_frame("front", along + 2.0, 3.0), reach=0.7)
        elif kind == "window":
            m.arch_window(m.base_frame("front", along, 1.35), width=1.6)
        else:
            m.arch_window(m.base_frame("front", along, 1.25), width=1.7)
            m.awning(m.base_frame("front", along, 3.72), width=2.7, depth=1.45, drop=0.8)
    for rect, za, _zb in floors:
        front, width = side_frame("front", *rect, za)
        for along in (1.85, width - 1.85):
            m.casement(front.at(along, 1.3, 0.0), width=1.45)
    rect, za, _zb = floors[-1]
    front, width = side_frame("front", *rect, za)
    for kind in signs:
        if kind == "fish":
            m.hanging_sign(front.at(width - 0.2, 3.25, 0.0), width=2.1)
        elif kind == "banner":
            m.banner(front.at(0.28, 3.3, 0.0), width=1.3)
    surface = m.swept_roof(*rect, eave, rise=rise, ridge="y", prow=(prow, 0.9), sweep=0.75, horn=(1.5, 1.0), eave_out=0.8)
    apex = front.at(width / 2, STOREY, 0.0)
    if gable == "window":
        m.arch_window(apex.at(0.0, 0.7, 0.0), width=1.5)
    else:
        m.relief(apex.at(0.0, 1.0, 0.0), "wheel", 1.8, 0.14, anchor=(0.5, 0.0))
    back, bwidth = side_frame("back", *rect, za)
    m.arch_window(back.at(bwidth / 2, STOREY + 0.7, 0.0), width=1.4, keystone=False)
    m.casement(back.at(bwidth / 2, 1.3, 0.0), width=1.45, flowers=False)
    span = x1 - x0
    m.arch_window(m.base_frame("back", span * 0.28, 1.4), width=1.5)
    m.arch_window(m.base_frame("back", span * 0.72, 1.4), width=1.5)
    m.ivy(m.base_frame("back", span * 0.5, 0.3), width=2.6)
    if dormer:
        cx, cy = centre(rect)
        m.dormer(surface, cx, cy, "y", along=-0.4, out=2.6, side=dormer, width=2.2)
    return floors, eave


def gable_row():
    """Three gable-fronted houses shoulder to shoulder, the middle one a storey taller and
    a step forward: shop fronts under striped awnings, tall stacks between them."""
    m = Model("gable_row")
    gable_bay(m, -10.7, -3.7, -4.4, 4.4, 4.0, 1, 5.2, (("door", 2.0), ("shop", 5.3)), signs=("banner",), dormer=-1.0, gable="wheel")
    gable_bay(m, 3.3, 10.9, -4.1, 4.4, 4.0, 1, 5.4, (("shop", 2.2), ("door", 5.4)), signs=("fish",), dormer=1.0)
    gable_bay(m, -3.7, 3.3, -5.0, 4.4, 4.2, 2, 5.7, (("door", 3.5),), signs=("banner",), prow=2.0)
    m.lantern(m.base_frame("front", 1.3, 3.1), reach=0.7)
    m.chimney(-3.7, 1.6, 1.4, 1.4, 6.5, 17.6, lean=(-0.12, 0.08), pots=3)
    m.chimney(3.3, -0.4, 1.3, 1.3, 6.5, 18.6, lean=(0.1, 0.1), pots=4)
    m.net(Frame((-10.7, 1.5, 3.0), (0, -1, 0)), width=2.6)
    m.barrel(-3.2, -5.9, size=1.0)
    m.barrel(-2.3, -6.05, size=0.85, turn=0.7)
    m.crate(9.7, -5.0, size=1.0, turn=0.2)
    m.crate(9.6, -4.95, z=1.0, size=0.7, turn=-0.4)
    m.barrel(-10.2, -5.3, size=0.95, turn=0.3)
    m.crate(-6.6, -5.45, size=0.8, turn=0.5)
    return m


def spiral_tower():
    """The watch tower: a round stone drum with a stair winding up its outside to a high
    door, a leaning witch-hat roof, a crow's nest and a pennant on the mast above."""
    m = Model("spiral_tower")
    r0, r1, top = 3.3, 2.95, 11.6
    m.drum(0.0, 0.0, r0, r1, 0.0, top)
    # the stair climbs anticlockwise from beside the ground door to a landing at the west
    landing = 6.3
    m.spiral_stair(0.0, 0.0, r0, 1.35, 0.0, landing, -52.0, 217.0, steps=15, close=(True, False))
    m.spiral_stair(0.0, 0.0, r0, 1.35, landing, landing, 165.0, 30.0, steps=2, close=(False, True))
    m.collide(-r0 - 1.7, r0 + 1.7, -r0 - 0.4, r0 + 1.7, 0.0, 3.0)
    m.door(m.drum_frame(-90.0, 0.0), width=2.7, sink=0.3)
    m.door(m.drum_frame(180.0, landing), width=2.4, steps=0, sink=0.26)
    for degrees, height in ((-90.0, 5.4), (0.0, 7.0), (90.0, 5.0), (-150.0, 3.4), (-30.0, 8.6), (120.0, 8.6), (-120.0, 8.0)):
        m.arch_window(m.drum_frame(degrees, height), width=1.35, sink=0.12)
    m.lantern(m.drum_frame(-60.0, 3.2), reach=0.7)
    m.lantern(m.drum_frame(150.0, landing + 3.0), reach=0.7)
    m.banner(m.drum_frame(-120.0, 6.6), width=1.2)
    axis = Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0))
    # the corbelled head of the drum and its gold band
    m.lathe(axis, [(r1, top - 1.0), (r1 + 0.6, top - 0.15), (r1 + 0.6, top + 0.3)], sides=12, skin=("tile", "stone"), smooth=False, v0=2.0)
    m.lathe(axis, [(r1 + 0.63, top - 0.05), (r1 + 0.63, top + 0.3)], sides=12, skin=("band", "bargeboard", 0.35), smooth=False)
    # the witch hat, leaning as it climbs
    hat = [(r1 + 1.9, top - 0.45), (r1 + 0.75, top + 0.5), (r1 * 0.74, top + 2.6), (r1 * 0.42, top + 5.6), (r1 * 0.18, top + 8.4), (0.03, top + 10.4)]
    lean = [(0.0, 0.0), (0.0, 0.0), (0.12, 0.05), (0.5, 0.2), (1.25, 0.5), (2.1, 0.85)]
    m.lathe(axis, hat, sides=12, skin=("tile", "slate"), lean=lean)
    m.lathe(axis, [(r1 + 0.55, top + 0.3), (r1 + 1.9, top - 0.53)], sides=12, skin=("band", "planks", 0.6), smooth=False, shade=0.55)
    m.lathe(axis, [(r1 + 1.92, top - 0.56), (r1 + 1.92, top - 0.36)], sides=12, skin=("band", "gilded", 0.2), smooth=False)
    tip = Vector((2.1, 0.85, top + 10.4))
    m.sweep([tip - UP * 2.2 - Vector((0.75, 0.3, 0.0)), tip, tip + UP * 5.2], (0.18, 0.18), "oak", depth=0.2)
    nest = Frame(tip + UP * 2.0, (1, 0, 0), UP, (0, 1, 0))
    m.lathe(nest, [(0.0, 0.0), (0.55, 0.0), (0.98, 0.25), (1.08, 1.05), (0.92, 1.05), (0.86, 0.3), (0.0, 0.3)], sides=8, skin=("tile", "hull"), smooth=False)
    m.lathe(nest, [(1.1, 0.88), (1.1, 1.08)], sides=8, skin=("band", "gilded", 0.2), smooth=False)
    m.gem(tip + UP * 5.4, 0.14, stretch=1.8)
    m.cloth(Frame(tip + UP * 4.3, (1, 0.25, 0), UP), "pennant", 2.9, wave=0.16, cols=5, rows=1, anchor=(0.0, 0.5))
    m.barrel(-2.9, -3.6, size=1.0)
    m.barrel(-3.7, -3.0, size=0.85, turn=0.9)
    m.crate(-3.5, -4.2, size=0.9, turn=0.4)
    for degrees in (-75.0, 45.0, 165.0):
        a = math.radians(degrees)
        radial = Vector((math.cos(a), math.sin(a), 0.0))
        m.lantern(Frame(radial * (r1 + 1.3) + UP * (top - 0.5), Vector((-math.sin(a), math.cos(a), 0.0)), UP), reach=0.45, size=0.95)
    return m


# The centre of the weekly vault's great round door, in yards over the ground line.
VAULT_DOOR_HEIGHT = 2.9


def vault_door(m, wall, radius=2.6):
    """The weekly vault's great round door, on a wall frame at the door's centre: a ring of
    dressed stone with a keystone, a leaf of the town's own iron-bound planks under a gilded
    rim and its studs, two strap hinges, and the handwheel that draws the bolts. The whole
    door is a named object (`V_GreatDoor`), so a test can find it in the shipped file."""
    out = Frame(wall.o, wall.r, wall.n, wall.u)  # the lathe's axis runs out of the wall
    ring_out, ring_in, proud, leaf = radius + 0.85, radius + 0.12, 0.5, 0.2
    part = m.part
    m.part = m.named_part("V_GreatDoor")
    # the stone ring: its outer wall, its face, and the reveal back to the leaf
    m.lathe(out, [(ring_out, -0.3), (ring_out, proud)], sides=32, skin=("tile", "stone"), smooth=False, shade=0.9)
    m.lathe(out, [(ring_out, proud), (ring_in, proud)], sides=32, skin=("part", "keystone", 32), smooth=False)
    m.lathe(out, [(ring_in, proud), (ring_in, leaf - 0.02)], sides=32, skin=("tile", "stone"), smooth=False, shade=0.7)
    # the leaf: a disc cut from the painted door, so its planks and iron match every door in town
    part_w = radius * 2.0 / 0.94
    part_h = part_w / kit.PARTS["door_leaf"]["aspect"]
    sides = 32
    rim = [(radius * math.cos(2.0 * math.pi * i / sides), radius * math.sin(2.0 * math.pi * i / sides)) for i in range(sides)]

    def leaf_uv(x, y):
        return kit.uv_part("door_leaf", 0.5 + x / part_w, 0.5 - y / part_h)

    for i in range(sides):
        (xa, ya), (xb, yb) = rim[i], rim[(i + 1) % sides]
        m.face([wall.p(0.0, 0.0, leaf), wall.p(xa, ya, leaf), wall.p(xb, yb, leaf)], [leaf_uv(0.0, 0.0), leaf_uv(xa, ya), leaf_uv(xb, yb)], "parts_solid", 1.0, wall.n)
    # the gilded rim over the leaf's edge, and twelve studs round it
    m.lathe(out, [(radius + 0.14, leaf - 0.02), (radius + 0.14, leaf + 0.16), (radius - 0.2, leaf + 0.16), (radius - 0.2, leaf)], sides=32, skin=("band", "gilded", 0.3), smooth=False)
    for i in range(12):
        a = 2.0 * math.pi * (i + 0.5) / 12
        m.gem(wall.p((radius - 0.03) * math.cos(a), (radius - 0.03) * math.sin(a), leaf + 0.2), 0.11, stretch=1.0)
    # two strap hinges reaching in from the ring's left
    for y in (-1.3, 1.3):
        edge = -math.sqrt(radius * radius - y * y)
        m.box(wall.at(edge - 0.55, y - 0.17, leaf), 0.0, 2.15, 0.0, 0.34, 0.0, 0.13, ("band", "gilded", "x", 0.34), skip="k", shade=0.86)
        m.gem(wall.p(edge - 0.2, y, leaf + 0.24), 0.14, stretch=1.0)
        m.gem(wall.p(edge + 1.45, y, leaf + 0.2), 0.09, stretch=1.0)
    # the handwheel: a gilded boss, a short axle, and the wheel standing proud of the leaf
    m.lathe(out, [(0.7, leaf), (0.7, leaf + 0.12), (0.0, leaf + 0.12)], sides=20, skin=("band", "gilded", 0.3), smooth=False)
    m.lathe(out, [(0.2, leaf + 0.12), (0.2, leaf + 0.3), (0.0, leaf + 0.3)], sides=10, skin=("band", "gilded", 0.2), smooth=False, shade=0.8)
    m.relief(wall.at(0.0, 0.0, leaf + 0.24), "wheel", 2.5, 0.14, back=True, anchor=(0.5, 0.5))
    # the keystone on the ring's crown and the worn threshold under the leaf
    m.relief(wall.at(0.0, ring_in - 0.1, proud - 0.02), "keystone", 1.05, 0.2, anchor=(0.5, 0.0))
    sill = -radius + 0.02
    half = math.sqrt(max(0.0, ring_in * ring_in - sill * sill)) - 0.05
    m.box(wall.at(-half, sill - 0.45, 0.0), 0.0, half * 2.0, 0.0, 0.45, 0.0, proud + 0.12, ("tile", "stone"), skip="k", shade=1.06)
    m.part = part
    return ring_out


def vault_house():
    """The weekly vault's strong-house: one massive battered stone storey with buttressed
    corners and a gilded cornice, small windows high under the eaves, a low timber loft and a
    prow roof over its great round door (`vault_door`), which is part of this model: the town
    draws nothing of its own here (render/eastbrook_weekly_vault.ts)."""
    m = Model("vault_house")
    x0, x1, y0, y1 = -6.75, 6.75, -5.7, 5.7
    w, d, ground, loft = x1 - x0, y1 - y0, 8.4, 11.0
    m.stone_base(x0, x1, y0, y1, ground, batter=0.2)
    for side, length in (("front", w), ("right", d), ("back", w), ("left", d)):
        for along in (0.0, length - 1.1):
            m.box(m.base_frame(side, along, -3.0), 0.0, 1.1, 0.0, 10.2, 0.0, 0.62, ("tile", "stone"), skip="k", shade=0.92)
        m.box(m.base_frame(side, 0.0, ground - 0.42), -0.12, length + 0.12, 0.0, 0.3, 0.0, 0.16, ("band", "gilded", "x", 0.3))
    for along in (2.0, w - 2.0):
        m.arch_window(m.base_frame("front", along, 5.0), width=1.3)
        m.lantern(m.base_frame("front", along, 3.6), reach=0.8, size=1.25)
    vault_door(m, m.base_frame("front", w / 2, VAULT_DOOR_HEIGHT))
    for side, length in (("left", d), ("right", d), ("back", w)):
        for i in range(3):
            m.arch_window(m.base_frame(side, length * (i + 0.5) / 3, 5.0), width=1.3)
    rect = (x0 - 0.3, x1 + 0.3, y0 - 0.5, y1 + 0.1)
    m.storey(*rect, ground, loft, "timber")
    m.soffit(rect, (x0 + 0.2, x1 - 0.2, y0 + 0.2, y1 - 0.2), ground + 0.01)
    for c in range(6):
        m.corbel(m.base_frame("front", 0.5 + (w - 1.0) * c / 5, ground - 0.02), size=0.7)
    front, width = side_frame("front", *rect, ground)
    for along in (2.3, width - 2.3):
        m.casement(front.at(along, 0.5, 0.0), width=1.3, flowers=False)
    m.banner(front.at(0.3, loft - ground - 0.2, 0.0), width=1.3)
    m.banner(front.at(width - 0.3, loft - ground - 0.2, 0.0), width=1.3)
    m.swept_roof(*rect, loft, rise=5.8, ridge="y", prow=(2.3, 1.0), sweep=0.85, horn=(1.9, 1.1))
    gable = front.at(width / 2, loft - ground, 0.0)
    m.relief(gable.at(0.0, 0.9, 0.0), "wheel", 2.1, 0.14, anchor=(0.5, 0.0))
    m.chimney(x1 - 1.6, y1 - 1.4, 1.4, 1.4, loft + 1.0, loft + 7.6, lean=(0.1, 0.06), pots=3)
    m.barrel(x1 + 0.9, y0 + 1.0, size=1.05)
    m.crate(x1 + 0.95, y0 + 2.2, size=0.9, turn=0.3)
    return m


HOUSES = {
    "merchant_house": merchant_house,
    "oriel_house": oriel_house,
    "prow_hall": prow_hall,
    "gable_row": gable_row,
    "spiral_tower": spiral_tower,
    "vault_house": vault_house,
    # the square's own dressing, stood as placements where the town's records stand it
    "market_stall_a": lambda: props.stall(0),
    "market_stall_b": lambda: props.stall(1),
    "square_bench": props.bench,
    "yard_fence": props.fence,
    # Fenbridge's square: its cistern and muster board (its provision stall is a market stall)
    "cistern": props.cistern,
    "muster_board": props.noticeboard,
}
