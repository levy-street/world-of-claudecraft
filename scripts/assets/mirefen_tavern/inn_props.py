"""The tavern's textured props (build_tavern.py calls build(B, parts)): the pieces that are real
models rather than built here, each wearing its own painted texture packed into the props' atlas
(tex/TavernProps_Color.jpg, made by props/build_atlas.mjs from the sources listed in
props/props.json, a 512 tile apiece). This module hangs and stands the room's dressing: the
trophies (the great stag's head over the front door, the boar's head over the wall booth, the pike
over the nook's arch), three shields from the game's own armoury over the bard's stage, the stocked
wall shelves, the weapon rack, the fisherman's net, the copper pans, the eel trap, the fen's catch
drying on its line, the hams and sausages over the kitchen hatch, the wine rack over the barrels,
the inn's banners in the gable ends' storeys, the racks of tankards hung from the beam over the
bar, the ale cask and tankards on the counter and the cauldron on its tripod over the hearth; and
the big standing pieces the sim collides with (the dresser, the barrels and crates, the sacks, the
firewood: `dressing` records). The light fittings (the chandelier, the sconces and the lanterns:
inn_lights.py) and the things on the tables, racks and stage (the candle clusters, the bread
boards, the jugs and tankards, the bottles, the barrels in the racks, the bear's skin, the bard's
instruments and candelabra: inn_furnish.py) are placed by their own builders through hang() and
stand(), the flames of their candles on WICKS. A wall piece hangs flat on its wall's inner face,
inside the room's dressing reach (an arm's length off the wall, clear of the camera's air; only
the great stag reaches further); a standing piece stands on what carries it. Each is on the
props' material (tavern_texture.PROPS) with the UVs its atlas tile gives it, its corners welded
so it shades smooth across its texture's seams.

The dressing here goes in TavernTrim (medium tier and up): nothing collides with it, so the low
tier sheds it (src/render/mirefen_tavern_core.ts); the `dressing` records' models go in
TavernFurnishings with the furniture (every tier: their records are colliders). The light
fittings ride in TavernLights with their flames (every tier), the table things in TavernClutter.
"""
import json
import math
import os

from mathutils import Vector

import inn_kit as K
from inn_kit import IRON, METAL

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'props', 'props_data.json'), encoding='utf8') as fh:
    PROPS = json.load(fh)['props']

# wall pieces: (prop, centre on the wall's inner face (x, y, z), the wall's normal into the room
# (x, z), its height in yards, a lean off level in radians[, the most it may spread across the
# wall, its height given up first])
HUNG = (
    # the great stag over the front door, its plaque's foot a hand over the door's lintel (its top
    # at 5.49: inn_hall.py) and its antlers' tips under the wall plate, clear of the upper windows
    # either side; it reaches two yards into the room over the door, the one trophy past an arm's
    # length (tests/mirefen_tavern_asset.test.ts leaves its corner of the room's air to it)
    ('stag_head', (0.0, 7.75, 13.2), (0.0, -1.0), 4.3, 0.0),
    # three shields over the stage on the back wall: a kite either side, the round one higher
    # between them (clear of the truss's foot at x -11 and the stage's curtain under them)
    ('shield_kite_steel', (-14.45, 7.95, -13.2), (0.0, 1.0), 1.45, 0.04),
    ('shield_round_wood', (-13.35, 8.85, -13.2), (0.0, 1.0), 1.15, -0.06),
    ('shield_kite_crucible', (-12.25, 7.95, -13.2), (0.0, 1.0), 1.45, -0.03),
    # the fisherman's net on its pegs with the crossed oars behind it, on the right wall between
    # its low window and the wall fire's breast, over the sconce
    ('net_decor', (15.2, 6.9, -2.2), (-1.0, 0.0), 2.6, 0.0),
    # the copper pans and ladle on their rail on the right wall past the breast's far side, over
    # the sconce there
    ('copper_pans', (15.2, 6.1, 6.85), (-1.0, 0.0), 1.25, 0.0),
    # the wicker eel trap hung by its cord on the back wall right of the stage, over its sconce
    ('eel_trap', (-8.0, 5.8, -13.2), (0.0, 1.0), 0.8, 0.02),
    # the pike on its plaque over the nook's arch (layout arch: x -5.5 to 2.4, 5.4 high), clear of
    # the arch's stones
    ('pike_trophy', (-1.55, 7.35, -13.2), (0.0, 1.0), 1.55, 0.0),
    # stocked shelves of jars, bottles and cheeses between the window rows (the low windows'
    # inner heads at 4.0, the storey's sills at 6.8): two on the left wall, over the long table
    # and past the wall booth, and one on the front wall left of the door, between the door's
    # leaf swung back against the wall (out to x -4.62: inn_hall.py) and the low window at x -8.4
    ('wall_shelf', (-15.2, 5.2, 1.0), (1.0, 0.0), 1.72, 0.0),
    ('wall_shelf', (-15.2, 5.2, -7.3), (1.0, 0.0), 1.72, 0.02),
    ('wall_shelf', (-6.05, 5.1, 13.2), (0.0, -1.0), 1.72, -0.02, 2.6),
    # the weapon rack (an axe, a sword, a spear) on the left wall between its low windows over
    # the dice table and the long table, under the storey's windows
    ('weapon_rack', (-15.2, 5.0, 5.0), (1.0, 0.0), 2.0, 0.0),
    # the boar's head over the wall booth, over the low window behind it (its snout a yard off
    # the wall, short of the camera's air at x -14)
    ('boar_head', (-15.2, 5.0, -4.6), (1.0, 0.0), 1.2, 0.0),
    # the fen's catch drying on its line on the front wall right of the door, past its leaf
    # swung back (to x 4.62) and short of the low window at x 8.4, over the window booth's settle
    ('dried_fish', (6.05, 5.0, 13.2), (0.0, -1.0), 1.44, 0.0, 2.2),
    # the hams, the sausages and the garlic on their rail over the kitchen hatch, between the
    # barrel racks, over the keeper's head
    ('hanging_meats', (9.5, 4.65, -13.2), (0.0, 1.0), 1.3, 0.0),
    # the wine rack on the back wall over the right barrel rack (its top shelf at 4.1), its
    # bottles' necks to the room
    ('wine_rack', (13.05, 5.75, -13.2), (0.0, 1.0), 1.6, 0.0),
    # the inn's banners in the gable ends' storeys, between their windows (inn_hall.storey_windows:
    # the left's in its bays at z -8.75, -5.25, 5.25 and 8.75, the right's at -8.75 and 8.75):
    # on the left, either side of its lantern over the bays' middle; on the right, in the corner
    # bays over the bar's platform and over the dresser
    ('banner_red', (-15.2, 8.3, -1.75), (1.0, 0.0), 2.6, 0.0),
    ('banner_green', (-15.2, 8.3, 1.75), (1.0, 0.0), 2.6, 0.0),
    ('banner_green', (15.2, 8.3, -12.25), (-1.0, 0.0), 2.6, 0.0),
    ('banner_red', (15.2, 8.3, 12.25), (-1.0, 0.0), 2.6, 0.0),
)
# standing pieces: (prop, its foot's middle (x, y, z), its yaw (radians: its face, +z, turned
# about +y), its height in yards)
STOOD = (
    # the ale cask on its cradle at the open end of the long counter (inn_interior.bar: its top
    # slab at 2.15, z -7.5 to -6.14), its tap and tally to the drinkers, turned a little to the
    # room; its feet a hair into the slab's wander
    ('ale_cask', (12.05, 2.14, -6.82), -0.15, 0.95),
    # tankards set out on the counter before three of its stools (layout.json: x 6.4, 8.3, 10.2),
    # their handles every which way
    ('tankard', (6.45, 2.14, -6.5), 2.6, 0.36),
    ('tankard', (8.25, 2.14, -6.45), -0.5, 0.36),
    ('tankard', (10.25, 2.14, -6.55), 0.9, 0.36),
)
# the racks of tankards hung from the bar's beam (inn_interior.py: the beam the great post carries
# out into the right gable wall, its underside on the truss line, over the back of the long
# counter) on iron rods down to their own chains, a yard and more over the keeper's head: each
# rack's middle along it and its length, and the height of its chains' tops
TANKARD_RACKS = ((7.6, 2.6), (11.1, 2.6))
TANKARD_RACK_TOP = 5.4
# the cauldron hung from its tripod over the central hearth's fire (a cooking fire: its flames,
# src/render/mirefen_tavern.ts MIREFEN_TAVERN_FLAMES, lick round the pot): the tripod's height
# over the pit's floor, its top under the camera's air, and its turn
CAULDRON = (3.0, 0.4)
# the hung piece's back stands this far off the plaster: over its belly (inn_hall.plaster_depth's
# 0.03) and the oak the inner walls are framed and panelled with (inn_hall.py, at most 0.07 proud)
STANDOFF = 0.09
# the candle pieces' wicks, in each model's own frame and units (frame() scales them): the flame's
# height and width, and where each flame stands (found from the piece's own corners: round each
# candle the highest of them, the middle of its top's rim or the tip of the wick the model keeps,
# a hair down into it); inn_furnish.light_wicks stands a flame on each
WICKS = {
    'wheel_chandelier': (0.068, 0.016, (
        (0.4499, -0.088, 0.6756), (0.1943, -0.0876, 0.9266), (-0.1874, -0.0875, 0.9264),
        (-0.4452, -0.0874, 0.6755), (-0.4447, -0.1154, 0.3142), (-0.1863, -0.1354, 0.0557),
        (0.1926, -0.1377, 0.0574), (0.4471, -0.118, 0.3195), (-0.2846, -0.0945, 0.1818),
        (0.2887, -0.0994, 0.1829),
    )),
    'table_candles': (0.2, 0.05, (
        (0.1872, -0.0001, 0.6285), (-0.1785, 0.1724, 0.6126), (0.0259, 0.408, 0.3617),
    )),
    'wall_sconce': (0.17, 0.042, ((0.0104, 0.268, 0.5),)),
    'candelabrum': (0.055, 0.014, (
        (-0.2425, 0.4286, 0.1842), (-0.1237, 0.4303, 0.1881), (-0.0007, 0.4852, 0.1867),
        (0.1204, 0.4264, 0.1914), (0.2454, 0.4274, 0.1905),
    )),
}


def build(B, parts):
    p = parts['TavernTrim']
    for name, centre, normal, height, lean, *wide in HUNG:
        if name in PROPS:
            prop = PROPS[name]
            if wide:
                height = min(height, wide[0] / prop['size'][0] * prop['size'][1])
            hang(p, prop, Vector(centre), normal, height, lean)
    for name, foot, yaw, height in STOOD:
        if name in PROPS:
            stand(p, PROPS[name], Vector(foot), yaw, height)
    # the dressing the sim stands on the floor (layout.json `dressing` records, src/sim/content/
    # mirefen_tavern.ts TAVERN_PROPS): the record is its collider, so it draws on every tier with
    # the furniture, its model scaled to the record's height and standing in its footprint (a
    # piece slimmer than its box leaves a hand of the collider round it)
    for q in B.LAYOUT['props']:
        if q['kind'] == 'dressing':
            stand(parts['TavernFurnishings'], PROPS[q['model']], Vector((q['x'], q['base'], q['z'])), q['rot'],
                  q['height'])
    by = {}
    for q in B.LAYOUT['props']:
        by.setdefault(q['kind'], []).append(q)
    if 'hanging_tankards' in PROPS:
        prop = PROPS['hanging_tankards']
        post = by['pillar'][0]
        # its chains' tops: the highest corners at either end
        top = max(v[1] for v in prop['verts'])
        ends = [v[0] for v in prop['verts'] if v[1] > top - prop['size'][1] * 0.05]
        for x, length in TANKARD_RACKS:
            scale = length / prop['size'][0]
            h = prop['size'][1] * scale
            stand(p, prop, Vector((x, TANKARD_RACK_TOP - h, post['z'])), 0.0, h)
            for u in (min(ends), max(ends)):
                p.beam([(x + u * scale, TANKARD_RACK_TOP - 0.03, post['z']),
                        (x + u * scale, B.HALL['truss'] + 0.05, post['z'])], 0.045, 0.045, IRON, METAL, caps=False)
    if 'hearth_cauldron' in PROPS:
        pit = B.LAYOUT['pit']
        height, turn = CAULDRON
        stand(p, PROPS['hearth_cauldron'], Vector((pit['x'], -pit['depth'], pit['z'])), turn, height)


def hang(p, prop, centre, normal, height, lean):
    """One prop on its wall: its face looking along the wall's normal into the room, its back on
    the plaster, `height` tall, turned `lean` off level about the normal. Returns where a point of
    its own frame lands (frame())."""
    f = Vector((normal[0], 0.0, normal[1])).normalized()
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    c, s = math.cos(lean), math.sin(lean)
    r2 = right * c + up * s
    u2 = up * c - right * s
    scale = height / prop['size'][1]
    origin = centre + f * STANDOFF - u2 * (prop['size'][1] / 2 * scale)
    at = frame(prop, origin, r2, u2, f, scale)
    _lay(p, prop, at)
    return at


def stand(p, prop, foot, yaw, height, inside=False):
    """One prop standing on what carries it: its foot's middle at `foot`, its face (+z) turned
    `yaw` about the vertical, `height` tall; `inside` lays its faces a second time turned inward,
    for a shell seen from within (a hood looked up into). Returns where a point of its own frame
    lands."""
    f = Vector((math.sin(yaw), 0.0, math.cos(yaw)))
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    scale = height / prop['size'][1]
    # (the data's back is on z 0: stood, its middle goes over the foot instead)
    origin = foot - f * (prop['size'][2] / 2 * scale)
    at = frame(prop, origin, right, up, f, scale)
    _lay(p, prop, at)
    if inside:
        _lay(p, prop, at, inward=True)
    return at


def frame(prop, origin, right, up, f, scale):
    """Where a point of the prop's own frame (props_data.json: x across its face from its
    middle, y up from its middle, z out from its back) lands in the tavern: its x along `right`,
    its y (from its foot) along `up`, its z along `f`, from `origin`."""
    lift = prop['size'][1] / 2

    def at(x, y, z):
        return origin + right * (x * scale) + up * ((y + lift) * scale) + f * (z * scale)

    # (its scale rides along, for the sizes given in the model's own units: WICKS)
    at.scale = scale
    return at


def _lay(p, prop, at, inward=False):
    """The prop's corners into the part, placed by `at` (frame()); welded by position so it
    shades smooth across its texture's seams, its UVs kept per corner. `inward`: every face
    wound the other way, on corners of its own (so the two skins shade apart)."""
    bm = p.bm
    uv = bm.loops.layers.uv.verify()
    welded = {}
    verts = []
    for x, y, z in prop['verts']:
        key = (x, y, z)
        if key not in welded:
            welded[key] = bm.verts.new(K.P(*at(x, y, z)))
        verts.append(welded[key])
    faces = []
    for tri in prop['faces']:
        if inward:
            tri = tri[::-1]
        corners = [verts[i] for i in tri]
        if len({id(v) for v in corners}) < 3:
            continue
        try:
            face = bm.faces.new(corners)
        except ValueError:
            continue
        for loop, i in zip(face.loops, tri):
            loop[uv].uv = prop['uvs'][i]
        face[p.soft] = 1
        faces.append(face)
    p.paint(faces, (1.0, 1.0, 1.0), K.PROPS)
    return faces
