# The palaces' own decor. Dawnhold Castle and the Last Keep are dungeon interiors, and their
# authored decor lists (src/sim/dungeon_layout.ts) name the Infernal Citadel's pieces: a
# demon statue, a hell forge standing in for a hearth, a slag cauldron, a bone throne. The
# citadel keeps those; a palace draws these instead (src/render/rift_decor.ts
# PALACE_DECOR_MODELS), each built in the castle kit. The game fits a decor model by its
# HEIGHT alone and centres it on its spot, so each is authored at true proportions and left
# as built.
import math

from kit import UP, Frame, Model, uv_band
from mathutils import Vector

from props import IRON, bar, tinted
from props_castle import ASHLAR, GOLD, LINEN, RED, STONE, block, candle, castle_rubble, heater, shrine, turned, wood
from props_heroes import horse_statue
from props_stations import cauldron

EMBER = (0.92, 0.36, 0.1)
SOOT = (0.1, 0.08, 0.08)


def brazier():
    """A standing brazier: an iron bowl on three legs. The game stands its flame at three
    quarters of the model's height, so the bowl's bed sits there and three prongs rise
    past it to hold the fire in."""
    m = Model("palace_brazier")
    with tinted(m, IRON):
        for i in range(3):
            a = math.tau * i / 3 + 0.4
            bar(m, (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.0), (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.96), 0.03, band="plaster", sides=5, caps=False)
        turned(m, 0.0, 0.0, 0.42, [(0.22, 0.0), (0.22, 0.05), (0.0, 0.05)], "plaster", sides=8, depth=0.2, smooth=False)
        turned(m, 0.0, 0.0, 0.9, [(0.0, 0.0), (0.16, 0.02), (0.36, 0.22), (0.41, 0.3), (0.35, 0.3), (0.0, 0.2)], "plaster", sides=8, depth=0.5)
        for i in range(3):
            a = math.tau * i / 3 + 0.4 + math.pi / 3
            bar(m, (math.cos(a) * 0.38, math.sin(a) * 0.38, 1.18), (math.cos(a) * 0.46, math.sin(a) * 0.46, 1.6), 0.02, band="plaster", sides=4)
    with tinted(m, EMBER):
        m.lathe(Frame((0.0, 0.0, 1.13), (1, 0, 0), UP, (0, 1, 0)), [(0.33, 0.0), (0.0, 0.06)], sides=8, skin=("band", "plaster", 0.4), smooth=False)
    return m


def hearth():
    """A palace fireplace: a pale stone breast with a fire burning in its arched mouth, an
    oak mantel and a shield on the hood above it."""
    from kit import uv_part

    m = Model("palace_hearth")
    block(m, -1.3, 1.3, -0.4, 0.5, 0.0, 1.76, ASHLAR)
    block(m, -1.42, 1.42, -0.5, 0.5, 0.0, 0.2, STONE, skip="b")
    wood(m, -1.5, 1.5, -0.6, 0.5, 1.76, 1.98, band="oak", axis="x")
    block(m, -1.0, 1.0, -0.3, 0.5, 1.98, 3.0, ASHLAR, shade=0.97)
    block(m, -1.1, 1.1, -0.36, 0.5, 3.0, 3.14, ASHLAR, shade=0.95)
    mouth = [(px / 100.0 * 1.5, py / 100.0 * 1.34 + 0.2) for px, py in ((-50, 0), (50, 0), (50, 60), (35, 85), (0, 100), (-35, 85), (-50, 60))]
    m.face([(px, -0.42, pz) for px, pz in mouth], [uv_part("lantern_glass", 0.5 + px / 1.6, 1.0 - (pz - 0.2) / 1.5) for px, pz in mouth], "parts_glow", 1.0, (0.0, -1.0, 0.0))
    with tinted(m, SOOT):
        for a, b in ((-0.86, -0.75), (0.75, 0.86)):
            block(m, a, b, -0.47, -0.4, 0.2, 1.3, ("band", "plaster", "y", 0.3))
    heater(m, 0.0, -0.31, 2.5, 0.5, 0.6, RED)
    for x in (-1.2, 1.2):
        candle(m, x, -0.2, 1.98, height=0.24, r=0.035)
    return m


def throne():
    """The keep's high seat: carved oak on a stone step, a red cushion and back, gilt on its
    finials."""
    m = Model("palace_throne")
    block(m, -0.9, 0.9, -0.8, 0.7, 0.0, 0.16, ASHLAR, skip="b")
    wood(m, -0.5, 0.5, -0.4, 0.4, 0.16, 0.66, band="planks", axis="x")
    block(m, -0.52, 0.52, -0.42, -0.38, 0.3, 0.6, ("band", "bargeboard", "x", 0.3))
    for x in (-0.56, 0.56):
        wood(m, x - 0.07, x + 0.07, -0.42, 0.42, 0.16, 1.02, band="oak", axis="y")
        m.gem(Vector((x, -0.38, 1.08)), 0.07)
    wood(m, -0.56, 0.56, 0.3, 0.46, 0.16, 2.3, band="oak", axis="y")
    for x in (-0.5, 0.5):
        m.gem(Vector((x, 0.38, 2.4)), 0.09)
    m.gem(Vector((0.0, 0.38, 2.5)), 0.13, stretch=1.8)
    with tinted(m, RED):
        block(m, -0.44, 0.44, -0.36, 0.3, 0.66, 0.76, ("band", "plaster", "x", 0.3))
        block(m, -0.4, 0.4, 0.24, 0.3, 0.8, 2.0, ("band", "plaster", "y", 0.8))
    block(m, -0.42, 0.42, 0.22, 0.3, 2.0, 2.08, ("band", "gilded", "x", 0.08))
    return m


def cage():
    """An iron cage on a ring foot: the keep's undercroft holds its prisoners in these."""
    m = Model("palace_cage")
    with tinted(m, IRON):
        turned(m, 0.0, 0.0, 0.0, [(0.5, 0.0), (0.5, 0.1), (0.0, 0.1)], "plaster", sides=8, depth=0.3, smooth=False)
        for i in range(8):
            a = math.tau * i / 8
            x, y = math.cos(a) * 0.45, math.sin(a) * 0.45
            bar(m, (x, y, 0.1), (x, y, 1.7), 0.022, band="plaster", sides=4, caps=False)
            bar(m, (x, y, 1.7), (0.0, 0.0, 2.1), 0.02, band="plaster", sides=4, caps=False)
        for z in (0.7, 1.3, 1.7):
            turned(m, 0.0, 0.0, z, [(0.47, 0.0), (0.47, 0.05), (0.42, 0.05), (0.42, 0.0)], "plaster", sides=8, depth=0.2, smooth=False)
        bar(m, (0.0, 0.0, 2.1), (0.0, 0.0, 2.4), 0.03, band="plaster", sides=5)
    return m


PALACE_PROPS = {
    "biome/kcas_decor_statue": dict(make=lambda: horse_statue(False), fit=False, like="props/infernal_statue"),
    "biome/kcas_decor_hearth": dict(make=hearth, fit=False, like="props/hell_forge"),
    "biome/kcas_decor_cauldron": dict(make=cauldron, fit=False, like="props/slag_cauldron"),
    "biome/kcas_decor_brazier": dict(make=brazier, fit=False, like="props/infernal_brazier"),
    "biome/kcas_decor_throne": dict(make=throne, fit=False, like="props/bone_throne"),
    "biome/kcas_decor_cage": dict(make=cage, fit=False, like="props/hanging_cage"),
    "biome/kcas_decor_altar": dict(make=shrine, fit=False, like="props/infernal_altar"),
    "biome/kcas_decor_rubble": dict(make=lambda: castle_rubble(True), fit=False, like="props/bone_pile"),
}
