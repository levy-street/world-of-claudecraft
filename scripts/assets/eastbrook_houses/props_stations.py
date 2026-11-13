# The crafting stations and the fen's willow: the last generated scans standing in the towns'
# artisan rows, rebuilt in the same painted kit. Built by build_props.py over each release
# model's own path (see props.py).
#
# The game sizes every station by its HEIGHT alone (render/stations.ts and
# render/artisan_row_props.ts keep a target height per kind), so each one is authored at the
# height the game draws it and left as built: only its seat and its top matter. Stations are
# waist high, so their detail is bold and few.
import math
import random

from kit import UP, Frame, Model, uv_band
from mathutils import Vector

from props import ASH, IRON, ROPE, bar, striped, tinted
from props_castle import ASHLAR, GOLD, GREEN, LINEN, NAVY, RED, STONE, block, candle, turned, wood

HIDE = (0.74, 0.52, 0.32)
ROAST = (0.62, 0.32, 0.16)
ORE = (0.46, 0.48, 0.54)
BARK = (0.52, 0.44, 0.36)
LEAF = ((0.36, 0.6, 0.26), (0.27, 0.49, 0.22), (0.46, 0.67, 0.3))
HERBS = (GREEN, (0.34, 0.54, 0.2), (0.5, 0.32, 0.56), (0.66, 0.54, 0.2), (0.26, 0.46, 0.36))
Y_AXIS = Vector((0.0, 1.0, 0.0))


def fire_ring(m, r=0.3, flame=0.2):
    """A ring of hearth stones round crossed logs, a flame standing in them when asked."""
    for i in range(7):
        a = math.tau * i / 7
        fr = Frame((math.cos(a) * r, math.sin(a) * r, 0.0), (-math.sin(a), math.cos(a), 0.0), UP)
        m.box(fr, -0.09, 0.09, -0.02, 0.1 + 0.03 * (i % 2), -0.07, 0.07, STONE, skip="b", shade=0.92 + 0.05 * (i % 2))
    with tinted(m, ASH):
        m.lathe(Frame((0.0, 0.0, 0.0), (1, 0, 0), UP, (0, 1, 0)), [(r * 0.9, 0.02), (0.0, 0.03)], sides=7, skin=("band", "plaster", 0.6), smooth=False)
    for i in range(3):
        a = math.tau * i / 3 + 0.5
        bar(m, (math.cos(a) * r * 0.75, math.sin(a) * r * 0.75, 0.05), (-math.cos(a) * r * 0.25, -math.sin(a) * r * 0.25, 0.17), 0.04, band="oak", sides=6, shade=0.6)
    if flame:
        m.lathe(Frame((0.0, 0.0, 0.1), (1, 0, 0), UP, (0, 1, 0)), [(0.0, 0.0), (r * 0.5, flame * 0.3), (r * 0.3, flame * 0.7), (0.0, flame)], sides=6, skin=("tile", "glass"))


def legs(m, half_x, half_y, top, size=0.045, band="oak"):
    for x in (-half_x, half_x):
        for y in (-half_y, half_y):
            wood(m, x - size, x + size, y - size, y + size, 0.0, top, band=band, axis="y")


def cauldron():
    """The alchemist's cauldron: black iron on three legs over a ring of stones, a bright brew
    to its brim and a ladle left in it."""
    m = Model("alchemy_cauldron")
    fire_ring(m, r=0.34, flame=0.0)
    with tinted(m, IRON):
        for i in range(3):
            a = math.tau * i / 3 + 0.3
            bar(m, (math.cos(a) * 0.32, math.sin(a) * 0.32, 0.0), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.32), 0.03, band="plaster", sides=5, caps=False)
        turned(m, 0.0, 0.0, 0.22, [(0.0, 0.0), (0.2, 0.02), (0.34, 0.14), (0.38, 0.32), (0.33, 0.48), (0.37, 0.53), (0.37, 0.57), (0.3, 0.57)], "plaster", sides=10, depth=0.6)
    m.lathe(Frame((0.0, 0.0, 0.75), (1, 0, 0), UP, (0, 1, 0)), [(0.31, 0.0), (0.0, 0.0)], sides=10, skin=("band", "teal", 0.6), smooth=False)
    for x, y, s in ((0.1, 0.05, 0.05), (-0.12, -0.08, 0.04), (0.02, -0.16, 0.03)):
        m.gem(Vector((x, y, 0.77)), s, band="teal", stretch=1.0)
    bar(m, (0.16, 0.1, 0.72), (0.34, 0.24, 0.9), 0.02, band="oak", sides=5)
    return m


def tanning_rack():
    """The leatherworker's rack: a hide laced out flat between two leaning trestles."""
    m = Model("leatherworking_rack")
    for y in (-0.64, 0.64):
        bar(m, (-0.3, y, 0.0), (0.0, y, 1.5), 0.04, band="oak", sides=6)
        bar(m, (0.3, y, 0.0), (0.0, y, 1.42), 0.04, band="oak", sides=6)
        bar(m, (-0.2, y, 0.5), (0.2, y, 0.5), 0.025, band="oak", sides=5)
    bar(m, (0.0, -0.72, 1.4), (0.0, 0.72, 1.4), 0.035, band="oak", sides=6)
    bar(m, (0.0, -0.6, 0.34), (0.0, 0.6, 0.34), 0.03, band="oak", sides=6)
    hide = [(-0.42, 0.52), (-0.2, 0.44), (0.2, 0.46), (0.44, 0.54), (0.5, 0.9), (0.4, 1.26), (0.0, 1.31), (-0.4, 1.24), (-0.5, 0.88)]
    with tinted(m, HIDE):
        for side in (1.0, -1.0):
            pts = [(0.012 * side, y, z) for y, z in hide]
            m.face(pts, [uv_band("plaster", y, (z - 0.4) / 0.95, 1.0) for y, z in hide], "trim", 0.98 if side > 0 else 0.8, (side, 0.0, 0.0))
    with tinted(m, ROPE):
        for (y, z), (fy, fz) in (((-0.42, 0.52), (-0.56, 0.36)), ((0.44, 0.54), (0.56, 0.36)), ((0.4, 1.26), (0.58, 1.4)), ((-0.4, 1.24), (-0.58, 1.4)), ((0.0, 1.31), (0.0, 1.4)), ((0.0, 0.45), (0.0, 0.34))):
            bar(m, (0.0, y, z), (0.0, fy, fz), 0.009, band="plaster", sides=4, caps=False)
    return m


def loom():
    """The tailor's loom: an oak frame, a striped warp running up to its beam and a bolt of
    red cloth coming off the front."""
    m = Model("tailoring_loom")
    for y in (-0.62, 0.62):
        wood(m, -0.5, 0.5, y - 0.04, y + 0.04, 0.0, 0.08, band="oak")
        wood(m, -0.36, -0.28, y - 0.04, y + 0.04, 0.08, 1.3, band="oak", axis="y")
        wood(m, 0.26, 0.34, y - 0.04, y + 0.04, 0.08, 0.92, band="oak", axis="y")
        wood(m, -0.34, 0.34, y - 0.03, y + 0.03, 0.6, 0.67, band="oak")
    wood(m, -0.38, -0.26, -0.68, 0.68, 1.2, 1.3, band="oak")
    bar(m, (0.3, -0.66, 0.9), (0.3, 0.66, 0.9), 0.06, band="oak", sides=8)
    bar(m, (-0.32, -0.66, 0.5), (-0.32, 0.66, 0.5), 0.075, band="oak", sides=8)
    striped(m, [(0.3, -0.5, 0.96), (0.3, 0.5, 0.96), (-0.3, 0.5, 1.2), (-0.3, -0.5, 1.2)], 1.0, facing=(0.4, 0.0, 1.0))
    striped(m, [(0.3, 0.5, 0.955), (0.3, -0.5, 0.955), (-0.3, -0.5, 1.195), (-0.3, 0.5, 1.195)], 0.7, facing=(-0.4, 0.0, -1.0))
    wood(m, -0.04, 0.03, -0.6, 0.6, 1.02, 1.08, band="oak")
    with tinted(m, RED):
        for side in (1.0, -1.0):
            pts = [(0.37 + 0.006 * side, -0.46, 0.9), (0.37 + 0.006 * side, 0.46, 0.9), (0.4 + 0.006 * side, 0.46, 0.34), (0.4 + 0.006 * side, -0.46, 0.34)]
            m.face(pts, [uv_band("plaster", p[1], (p[2] - 0.34) / 0.56, 0.6) for p in pts], "trim", 1.0 if side > 0 else 0.75, (side, 0.0, 0.1))
    wood(m, 0.56, 0.8, -0.36, 0.36, 0.4, 0.46, band="planks")
    for y in (-0.3, 0.3):
        wood(m, 0.64, 0.72, y - 0.035, y + 0.035, 0.0, 0.4, band="oak", axis="y")
    return m


def workbench():
    """The engineer's bench: a stout planked bench with a vice, a brass gear, a hammer and a
    rolled drawing, a candle to work by."""
    m = Model("engineering_workbench")
    wood(m, -0.36, 0.36, -0.56, 0.56, 0.74, 0.82, band="planks")
    legs(m, 0.3, 0.5, 0.74)
    wood(m, -0.3, 0.3, -0.5, 0.5, 0.2, 0.25, band="planks", shade=0.85)
    block(m, -0.33, 0.33, -0.53, 0.53, 0.63, 0.74, ("band", "bargeboard", "z", 0.11))
    with tinted(m, IRON):
        block(m, -0.1, 0.1, -0.52, -0.38, 0.82, 0.96, ("band", "plaster", "x", 0.2))
        bar(m, (-0.2, -0.45, 0.9), (0.2, -0.45, 0.9), 0.015, band="plaster", sides=5)
        block(m, -0.24, -0.12, 0.2, 0.28, 0.82, 0.9, ("band", "plaster", "x", 0.1))
    with tinted(m, GOLD):
        turned(m, 0.14, 0.14, 0.82, [(0.0, 0.0), (0.14, 0.0), (0.14, 0.04), (0.0, 0.04)], "plaster", sides=8, depth=0.2, smooth=False)
        turned(m, 0.14, 0.14, 0.86, [(0.05, 0.0), (0.05, 0.05), (0.0, 0.05)], "plaster", sides=6, depth=0.2, smooth=False)
    bar(m, (-0.18, 0.24, 0.86), (-0.18, -0.08, 0.86), 0.016, band="oak", sides=5)
    with tinted(m, LINEN):
        bar(m, (0.22, -0.2, 0.855), (0.22, 0.42, 0.855), 0.03, band="plaster", sides=6)
    candle(m, -0.26, 0.44, 0.82, height=0.12, r=0.022)
    return m


def cooking_spit():
    """The cook's spit: a roast turning on an iron bar between two forked posts, over a fire."""
    m = Model("cooking_spit")
    fire_ring(m, r=0.26, flame=0.24)
    for y in (-0.4, 0.4):
        bar(m, (0.0, y, 0.0), (0.0, y, 0.7), 0.035, band="oak", sides=6)
        bar(m, (0.0, y, 0.66), (0.08, y, 0.85), 0.022, band="oak", sides=5)
        bar(m, (0.0, y, 0.66), (-0.08, y, 0.85), 0.022, band="oak", sides=5)
    with tinted(m, IRON):
        bar(m, (0.0, -0.52, 0.74), (0.0, 0.52, 0.74), 0.014, band="plaster", sides=5)
        bar(m, (0.0, 0.52, 0.74), (0.0, 0.52, 0.6), 0.012, band="plaster", sides=4)
    with tinted(m, ROAST):
        m.lathe(Frame((0.0, -0.2, 0.74), (1, 0, 0), Y_AXIS), [(0.0, 0.0), (0.09, 0.05), (0.12, 0.2), (0.09, 0.35), (0.0, 0.4)], sides=8, skin=("band", "plaster", 0.4))
    return m


def lectern():
    """The scribe's lectern: a turned oak stand, a sloped desk and an open book, a quill
    standing in it."""
    m = Model("inscription_lectern")
    turned(m, 0.0, 0.0, 0.0, [(0.24, 0.0), (0.24, 0.05), (0.1, 0.1), (0.06, 0.2), (0.06, 0.7), (0.1, 0.78), (0.0, 0.78)], "oak", sides=8, depth=0.4)
    m.gem(Vector((0.0, 0.0, 0.46)), 0.075, band="gilded", stretch=0.7)
    # the desk leans toward the reader at the front (-Y): its normal tips forward
    normal = Vector((0.0, -0.6, 0.8))
    desk = Frame((0.0, 0.0, 0.84), (1, 0, 0), normal)
    m.box(desk, -0.27, 0.27, 0.0, 0.05, -0.2, 0.2, ("band", "planks", "x", 0.4))
    m.box(desk, -0.27, 0.27, 0.05, 0.1, 0.2, 0.24, ("band", "oak", "x", 0.1))
    with tinted(m, RED):
        m.box(desk, -0.23, 0.23, 0.05, 0.062, -0.16, 0.17, ("band", "plaster", "x", 0.3))
    with tinted(m, LINEN):
        m.box(desk, -0.21, -0.006, 0.062, 0.09, -0.14, 0.15, ("band", "plaster", "x", 0.3))
        m.box(desk, 0.006, 0.21, 0.062, 0.09, -0.14, 0.15, ("band", "plaster", "x", 0.3))
        bar(m, (0.2, 0.1, 0.96), (0.26, 0.18, 1.1), 0.009, band="plaster", sides=4)
    return m


def altar():
    """The enchanter's altar: a pale stone pedestal banded in gilt, a teal crystal standing in
    a dark bowl, four candles at its corners."""
    m = Model("enchanting_altar")
    block(m, -0.27, 0.27, -0.27, 0.27, 0.0, 0.1, STONE, skip="b")
    block(m, -0.2, 0.2, -0.2, 0.2, 0.1, 0.52, ASHLAR)
    block(m, -0.212, 0.212, -0.212, 0.212, 0.34, 0.41, ("band", "gilded", "x", 0.07))
    block(m, -0.27, 0.27, -0.27, 0.27, 0.52, 0.6, ASHLAR, shade=0.97)
    with tinted(m, NAVY):
        turned(m, 0.0, 0.0, 0.6, [(0.0, 0.0), (0.12, 0.01), (0.17, 0.07), (0.14, 0.07), (0.0, 0.03)], "plaster", sides=8, depth=0.2)
    m.gem(Vector((0.0, 0.0, 0.84)), 0.1, band="teal", stretch=1.9)
    m.gem(Vector((0.09, 0.03, 0.72)), 0.045, band="teal", stretch=1.6)
    for x, y in ((-0.21, -0.21), (0.21, -0.21), (0.21, 0.21), (-0.21, 0.21)):
        candle(m, x, y, 0.6, height=0.1, r=0.02)
    return m


def jewel_bench():
    """The jeweller's bench: a small bench with a carved drawer, a dark tray of cut stones, a
    little anvil and a rack behind for the finished work."""
    m = Model("jewelcrafting_bench")
    wood(m, -0.24, 0.24, -0.38, 0.38, 0.62, 0.68, band="planks")
    legs(m, 0.2, 0.33, 0.62, size=0.03)
    block(m, -0.22, 0.22, -0.365, -0.33, 0.48, 0.62, ("band", "bargeboard", "x", 0.14))
    m.gem(Vector((0.0, -0.375, 0.55)), 0.022)
    with tinted(m, NAVY):
        block(m, -0.17, 0.1, -0.12, 0.24, 0.68, 0.7, ("band", "plaster", "x", 0.2))
    for x, y, colour in ((-0.1, 0.0, RED), (0.0, 0.08, (0.2, 0.62, 0.5)), (-0.06, 0.17, GOLD), (0.04, -0.05, (0.52, 0.3, 0.7)), (-0.12, 0.1, LINEN)):
        with tinted(m, colour):
            m.gem(Vector((x, y, 0.735)), 0.032, band="plaster", stretch=1.0)
    with tinted(m, IRON):
        block(m, 0.11, 0.2, 0.1, 0.22, 0.68, 0.75, ("band", "plaster", "x", 0.1))
    candle(m, 0.17, -0.27, 0.68, height=0.1, r=0.02)
    wood(m, -0.24, 0.24, 0.34, 0.38, 0.68, 0.9, band="planks")
    for x in (-0.14, 0.0, 0.14):
        m.gem(Vector((x, 0.33, 0.82)), 0.03, band="gilded", stretch=1.2)
    return m


def ore_cart():
    """The miner's cart: a planked tub bound in iron on four iron wheels, heaped with ore and
    a few bright nuggets."""
    m = Model("mining_ore_cart")
    wood(m, -0.5, 0.5, -0.3, 0.3, 0.3, 0.37, band="planks", shade=0.8)
    for y in (-0.31, 0.31):
        wood(m, -0.56, 0.56, y - 0.03, y + 0.03, 0.33, 0.8, band="planks", axis="x")
    for x in (-0.53, 0.53):
        wood(m, x - 0.03, x + 0.03, -0.28, 0.28, 0.33, 0.8, band="planks", axis="z")
    with tinted(m, IRON):
        for y in (-0.345, 0.345):
            block(m, -0.57, 0.57, y - 0.012, y + 0.012, 0.73, 0.8, ("band", "plaster", "x", 0.07))
            block(m, -0.57, 0.57, y - 0.012, y + 0.012, 0.36, 0.42, ("band", "plaster", "x", 0.07))
        for x in (-0.36, 0.36):
            for y in (-0.39, 0.34):
                m.lathe(Frame((x, y, 0.17), (1, 0, 0), Y_AXIS), [(0.0, 0.0), (0.17, 0.0), (0.17, 0.05), (0.0, 0.05)], sides=10, skin=("band", "plaster", 0.3), smooth=False)
            bar(m, (x, -0.4, 0.17), (x, 0.4, 0.17), 0.025, band="plaster", sides=5, caps=False)
    bar(m, (0.56, -0.2, 0.7), (0.78, -0.2, 0.86), 0.02, band="oak", sides=5)
    bar(m, (0.56, 0.2, 0.7), (0.78, 0.2, 0.86), 0.02, band="oak", sides=5)
    bar(m, (0.78, -0.24, 0.86), (0.78, 0.24, 0.86), 0.022, band="oak", sides=5)
    rng = random.Random(7)
    with tinted(m, ORE):
        for _ in range(11):
            x, y = rng.uniform(-0.4, 0.4), rng.uniform(-0.2, 0.2)
            m.gem(Vector((x, y, 0.78 + 0.2 * (1.0 - abs(x) / 0.45))), rng.uniform(0.09, 0.14), band="plaster", stretch=0.8, shade=rng.uniform(0.8, 1.0))
    for x, y in ((-0.12, 0.08), (0.2, -0.1), (0.02, -0.02)):
        m.gem(Vector((x, y, 1.0)), 0.05, band="gilded", stretch=0.9)
    return m


def drying_rack():
    """The herbalist's rack: two rails of bundled herbs hung head down to dry, a basket at
    its foot."""
    m = Model("herbalism_drying_rack")
    for y in (-0.7, 0.7):
        wood(m, -0.3, 0.3, y - 0.035, y + 0.035, 0.0, 0.07, band="oak")
        wood(m, -0.035, 0.035, y - 0.035, y + 0.035, 0.07, 1.4, band="oak", axis="y")
        bar(m, (-0.26, y, 0.07), (0.0, y, 0.5), 0.02, band="oak", sides=5)
        bar(m, (0.26, y, 0.07), (0.0, y, 0.5), 0.02, band="oak", sides=5)
    for z in (1.32, 0.86):
        bar(m, (0.0, -0.74, z), (0.0, 0.74, z), 0.025, band="oak", sides=6)
    for row, z in enumerate((1.32, 0.86)):
        for i in range(5):
            y = -0.52 + i * 0.26 + (0.06 if row else 0.0)
            with tinted(m, HERBS[(i + row * 2) % len(HERBS)]):
                m.lathe(Frame((0.0, y, z - 0.36), (1, 0, 0), UP, (0, 1, 0)), [(0.0, 0.0), (0.09, 0.04), (0.07, 0.16), (0.02, 0.3), (0.0, 0.3)], sides=6, skin=("band", "plaster", 0.3), smooth=False)
            with tinted(m, ROPE):
                bar(m, (0.0, y, z - 0.07), (0.0, y, z), 0.01, band="plaster", sides=4, caps=False)
    turned(m, 0.2, 0.0, 0.0, [(0.0, 0.0), (0.13, 0.0), (0.17, 0.2), (0.15, 0.2), (0.12, 0.03), (0.0, 0.03)], "planks", sides=8, depth=0.2, smooth=False)
    with tinted(m, HERBS[1]):
        m.gem(Vector((0.2, 0.0, 0.16)), 0.1, band="plaster", stretch=0.6)
    return m


def willow():
    """The fen's weeping willow: a leaning grey trunk under a broad low crown, its fronds
    hanging in curtains almost to the water. Authored at the size the fen draws it and
    scaled into the release tree's bounds."""
    m = Model("willow_tree")
    with tinted(m, BARK):
        bar(m, (0.0, 0.0, 0.0), (0.25, 0.0, 1.8), 0.5, band="oak", sides=8, r1=0.4, caps=False)
        bar(m, (0.25, 0.0, 1.8), (0.7, 0.1, 3.4), 0.4, band="oak", sides=8, r1=0.32, caps=False)
        bar(m, (0.7, 0.1, 3.4), (0.4, 0.0, 5.2), 0.32, band="oak", sides=8, r1=0.2, caps=False)
        for end in ((-2.6, 0.5, 5.6), (2.8, -0.4, 5.5), (0.2, 2.0, 5.7), (0.6, -1.9, 5.6)):
            bar(m, (0.6, 0.1, 3.3), end, 0.2, band="oak", sides=6, r1=0.08, caps=False)
    # the crown: a clump of low domes, so the tree is broad and lumpy the way a willow is
    lumps = ((-2.0, 0.3, 2.4, 2.4), (1.9, -0.3, 2.5, 2.3), (0.0, 0.9, 2.5, 2.9), (0.2, -0.9, 2.4, 2.7), (-0.4, 0.0, 2.2, 3.5))
    for i, (cx, cy, r, top) in enumerate(lumps):
        with tinted(m, LEAF[i % 3]):
            m.lathe(Frame((cx, cy, 4.9), (1, 0, 0), UP, (0, 1, 0)), [(0.0, 0.5), (r * 0.95, 0.2), (r, 1.0), (r * 0.82, top * 0.66), (r * 0.5, top * 0.92), (0.0, top)], sides=7, skin=("band", "plaster", 3.0), smooth=False, phase=0.17 * i)
    # the weeping curtains: thin tapering strips hung from the crown, an outer ring that
    # nearly reaches the ground and a shorter inner one, so the trunk shows between them
    for ring, (count, reach, drop) in enumerate(((30, 1.0, 0.4), (14, 0.6, 2.2))):
        for k in range(count):
            a = math.tau * (k + 0.5 * ring) / count
            rx, ry = 4.5 * reach, 3.1 * reach
            top = Vector((0.1 + math.cos(a) * rx * 0.94, math.sin(a) * ry * 0.94, 5.6))
            foot = Vector((0.1 + math.cos(a) * rx * 1.04, math.sin(a) * ry * 1.04, drop + 0.9 * ((k * 7) % 5) / 5.0))
            out = Vector((math.cos(a) / rx, math.sin(a) / ry, 0.0)).normalized()
            side = Vector((-out.y, out.x, 0.0)) * 0.36
            with tinted(m, LEAF[(k + ring) % 3]):
                for sign in (1.0, -1.0):
                    shift = out * (0.01 * sign)
                    pts = [top - side + shift, top + side + shift, foot + side * 0.3 + shift, foot - side * 0.3 + shift]
                    uvs = [uv_band("plaster", 0.0, 1.0, 1.0), uv_band("plaster", 0.7, 1.0, 1.0), uv_band("plaster", 0.6, 0.0, 1.0), uv_band("plaster", 0.1, 0.0, 1.0)]
                    m.face(pts, uvs, "trim", 1.0 if sign > 0 else 0.7, out * sign)
    return m


STATION_PROPS = {
    "props/alchemy_cauldron": dict(make=cauldron, fit=False),
    "props/leatherworking_rack": dict(make=tanning_rack, fit=False),
    "props/tailoring_loom": dict(make=loom, fit=False),
    "props/engineering_workbench": dict(make=workbench, fit=False),
    "props/cooking_spit": dict(make=cooking_spit, fit=False),
    "props/inscription_lectern": dict(make=lectern, fit=False),
    "props/enchanting_altar": dict(make=altar, fit=False),
    "props/jewelcrafting_bench": dict(make=jewel_bench, fit=False),
    "props/mining_ore_cart": dict(make=ore_cart, fit=False),
    "props/herbalism_drying_rack": dict(make=drying_rack, fit=False),
    "props/willow_tree": dict(make=willow, fit="inside"),
}
