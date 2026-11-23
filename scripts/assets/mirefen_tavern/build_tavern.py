"""The Mirefen tavern: the walk-in inn on the Fenbridge road in Mirefen Marsh, raised in the
painted town's hand-built style.

  npx tsx scripts/assets/mirefen_tavern/layout.ts          (refresh layout.json from the sim)
  blender --background --python scripts/assets/mirefen_tavern/build_tavern.py -- \
      [--save FILE.blend --context TERRAIN.json [--render OUT_DIR]]

Writes mirefen_tavern_source.glb beside this file. `node scripts/assets/mirefen_tavern/build.mjs`
ships it (validate, fingerprint, maps, meshopt) to public/models/props/mirefen_tavern.glb, and
src/render/mirefen_tavern.ts places it on the ground floor at the tavern's origin.

Everything the player walks on or bumps into stands where the sim says it does
(src/sim/content/mirefen_tavern.ts through layout.json): the model frame IS the tavern's local
frame (yards, origin on the ground floor at the hall's middle, +x to the right of a player
walking in, +y up, +z out of the front door), and the terrain under the building comes with the
layout so the stone plinth runs down into the falling ground and the porch steps stop on it.

The look is the painted Eastbrook town's: a battered stone storey on a tall plinth, a
half-timbered storey jettied out over the front, bowed plaster between oak that sags and leans
off plumb, a slate roof that kicks up at its eaves over a sagging ridge, a round stone nook
under a witch's hat, and nothing anywhere quite straight (inn_kit.py). The geometry stays low;
the town's hand-painted tiling maps in Fenbridge's Fenrire look (textures.json, tex/) carry the
stones, the grain and the slates, laid on sheet by sheet so they run unbroken over every smooth
surface (tavern_texture.lay_sheet), and the vertex colours carry each piece's
tint and the warm light of the fires baked over the paint (paint_faces and bake_warm_light below,
tavern_texture.py).

Hierarchy (the runtime keeps or sheds these by graphics tier, and ghosts the shell parts for
the camera one by one; the sim collides with what the low tier keeps):

  MirefenTavern_ROOT      root, placed on the ground floor at the tavern's origin
    TavernFrame           never cut: the floors, the hearth pit and its round hearth, the copper
                          hood and its flue, the bar's platform and counters, the stage, the
                          trusses, the kitchen behind the hatch
    TavernFurnishings     tables, chairs, stools, benches, settles, the barrel racks, the chest
    TavernLights          lanterns, the wheel chandelier, sconces, candles, the fires
    HallWallFront/FrontLeft/FrontRight/Back/Left/Right, HallPorch, HallRoof,
    WingWallEast/Back/West, WingRoof, TowerWall, TowerRoof, BarPillar
                          the shell: each fades on its own, and whatever hangs on a wall goes
                          with it; the front is three parts (the door's bay and either side) and
                          the porch's awning and the tankard sign a fourth
    TavernTrim            medium tier and up: iron straps and rails, braces, the little things
                          on the walls
    TavernClutter         high tier and up: mugs, plates, bottles, firewood, sacks, rugs
    TavernGrounds         the forecourt and terrace, the stable, the lantern strings, the cart
    TavernDog             the dog asleep on the porch (its own part, so it can breathe)

There is no upper floor for players and no timber crosses the common room under the hammer
beams (HALL['truss']): the camera's air stays well under every roof timber.
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'eastbrook_ferry'))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from shiplib import FLAT, empty, scale_color, triangles  # noqa: E402,F401

import tavern_texture as TX  # noqa: E402

# the material slots the dog (tavern_dog.py, B.WOOD) and the bake (GLOW) name here
WOOD, GLOW = TX.TIMBER, TX.GLOW

with open(os.path.join(HERE, 'layout.json'), encoding='utf8') as fh:
    LAYOUT = json.load(fh)

HALL = LAYOUT['hall']
WING = LAYOUT['wing']
TOWER = LAYOUT['tower']

SHELL = ('HallWallFront', 'HallWallFrontLeft', 'HallWallFrontRight', 'HallWallBack', 'HallWallLeft',
         'HallWallRight', 'HallRoof', 'WingWallEast', 'WingWallBack', 'WingWallWest', 'WingRoof', 'TowerWall',
         'TowerRoof', 'HallPorch', 'BarPillar')
# the front wall's three parts meet this far either side of the door's middle
# (src/render/mirefen_tavern_core.ts TAVERN_FRONT_SPLIT)
FRONT_SPLIT = 3.2
# the grounds outside (the forecourt, the terrace, the stable, the cart, the woodpile) and the dog
# asleep on the porch, its own part so the runtime can make it breathe
CRITICAL = ('TavernFrame', 'TavernFurnishings', 'TavernLights', 'TavernGrounds', 'TavernDog') + SHELL
TRIM = ('TavernTrim',)
OPTIONAL = ('TavernClutter',)

# each part's shading in shiplib's finish(): (per-face wear, top-to-bottom gradient)
PART_SHADING = {name: (0.035, 0.06) for name in CRITICAL + TRIM + OPTIONAL}
# the walls are a few big bowed faces: a per-face wear would show as panels across them, so they
# take their variation from the painted maps and the warm bake instead
PART_SHADING.update({name: (0.008, 0.06) for name in SHELL if 'Wall' in name})
PART_SHADING.update({'HallRoof': (0.05, 0.03), 'WingRoof': (0.05, 0.03), 'TowerRoof': (0.05, 0.03),
                     'TavernLights': (0.01, 0.02), 'TavernClutter': (0.03, 0.04)})

# ---------------------------------------------------------------------------
# Terrain (heights over the ground floor, bilinear from the layout grid)
# ---------------------------------------------------------------------------
T = LAYOUT['terrain']


def ground(x, z):
    fx = min(max((x - T['x0']) / T['step'], 0.0), T['nx'] - 1.0001)
    fz = min(max((z - T['z0']) / T['step'], 0.0), T['nz'] - 1.0001)
    i, j = int(fx), int(fz)
    tx, tz = fx - i, fz - j
    h, n = T['h'], T['nx']
    a, b = h[j * n + i], h[j * n + i + 1]
    c, d = h[(j + 1) * n + i], h[(j + 1) * n + i + 1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz


# ---------------------------------------------------------------------------
# The hall's roof profile: the one surface the slates, the gables, the walls' tops, the trusses
# and the dormers all sample (inn_roof.py adds the ridge's sag and the eaves' droop to it). The
# roof runs along the road: its ridge along x over the hall's middle, its eaves over the jettied
# front and the back wall, its gables on the side walls, a cross gable over the door joining it
# in valleys. Across it the profile is a bell-cast: steep under the ridge, easing as it falls,
# running on flatter out to the eaves' edge with no break (the painted town's flare, the painted
# world style guide's S2 and 5.1). The eaves sit at the camera's air (TAVERN_HALL_AIR_TOP) with
# room to spare; the ridge stands under the tower's hat, which stays the tallest thing.
# ---------------------------------------------------------------------------
ROOF_FRONT = HALL['z1'] + LAYOUT['jetty']['out']   # the eave wall at the front: the jettied storey
ROOF_RIDGE_Z = (ROOF_FRONT + HALL['z0']) / 2       # the ridge line, between the two eave walls
ROOF_HALF = (ROOF_FRONT - HALL['z0']) / 2          # from the ridge line to either eave wall
ROOF_RIDGE = HALL['ridge']        # the ridge's height before it settles
ROOF_EAVE = HALL['eave'] + 0.3    # the slates' height over the eave walls (the wall plates under them)
ROOF_BELL = 0.72                  # the bell's linear share: the pitch at the walls, over the mean pitch
ROOF_EAVE_OUT = HALL['eaveOut']   # the eaves past the front and back walls
ROOF_VERGE_OUT = HALL['vergeOut']  # the verges past the gable walls
ROOF_THICK = 0.75      # slates over sarking over rafters
# the flare's pitch past the walls: the bell's own pitch where it reaches them, so no kink
ROOF_KICK = (ROOF_RIDGE - ROOF_EAVE) / ROOF_HALF * ROOF_BELL


def roof_line(d):
    """The roof's top surface at distance d across from its ridge line (before the ridge sags
    and the eaves droop)."""
    d = abs(d)
    if d <= ROOF_HALF:
        t = (ROOF_HALF - d) / ROOF_HALF
        return ROOF_EAVE + (ROOF_RIDGE - ROOF_EAVE) * (ROOF_BELL * t + (1.0 - ROOF_BELL) * t * t)
    return ROOF_EAVE - ROOF_KICK * (d - ROOF_HALF)


# ---------------------------------------------------------------------------
# The builders, in the order they raise the tavern
# ---------------------------------------------------------------------------
def builders():
    import inn_furnish
    import inn_grounds
    import inn_hall
    import inn_interior
    import inn_lights
    import inn_porch
    import inn_props
    import inn_roof
    import inn_tower
    import inn_wing
    import tavern_dog
    return [inn_hall, inn_roof, inn_tower, inn_wing, inn_porch, inn_interior, inn_props, inn_furnish, inn_lights,
            inn_grounds, tavern_dog]


# ---------------------------------------------------------------------------
# The paint: each face onto its material with its tint stored under the headroom, and the map
# laid on sheet by sheet at its repeat (tavern_texture.py)
# ---------------------------------------------------------------------------
# The painted maps carry the materials' own value (the style guide's "paint the form"): a tint
# only nudges it. The builders tint freely (an oak leg in shadow, a scrubbed table top); every
# tint is eased this far toward the map's own value as it is stored, so the darkest stays a
# shaded version of its material rather than a near-black one, and the warm light near a fire
# has room to lift the paint visibly above the map.
TINT_EASE = 0.6


def eased(tint):
    return tuple(1.0 - (1.0 - c) * TINT_EASE for c in tint)


class SheetShade:
    """shiplib's finish() shades every face on its own: a soft top-to-bottom gradient and a lift
    for faces turned up, both at the face's middle, and a wear drawn per face. On a painted sheet
    (a bowed wall, a slope of slates, a hewn beam's side) that cuts the map into panels, so the
    paint shades its sheets itself, the same three terms, at each corner (the gradient at the
    corner's height, the lift by the sheet's smooth normal there) and the wear drawn once per
    sheet, and tags their faces FLAT so finish() leaves them be. finish() shades a corner's
    gamma-encoded colour (encode_for_export), so the shade goes onto the stored colour raised
    to 2.2, as finish() would have laid it."""

    def __init__(self, piece):
        from shiplib import G
        ys = [G(v.co).y for v in piece.bm.verts]
        self.piece = piece
        self.lo = min(ys) if ys else 0.0
        self.span = max(0.5, (max(ys) - self.lo) if ys else 1.0)

    def __call__(self, sheet, normals):
        from mathutils import Vector
        from shiplib import EDGE, FLAT, G, smooth
        p = self.piece
        area = 0.0
        mid = Vector((0.0, 0.0, 0.0))
        for f in sheet:
            a = f.calc_area()
            mid += f.calc_center_median() * a
            area += a
        mid = mid / area if area > 1e-12 else sheet[0].calc_center_median()
        # (at the spread the mean of its faces' own draws would have: a block's face wears as it
        # did, a whole slope of slates no more than its faces did on average)
        wear = 1.0 + (p._noise(mid) - 0.5) * 2.0 * p.wear / math.sqrt(len(sheet))
        for f in sheet:
            tag = f[p.tag]
            if tag == FLAT:
                continue
            k_edge = 1.08 if tag == EDGE else 1.0
            for loop in f.loops:
                v = loop.vert
                n = G(normals[v])
                s = (1.0 - p.gradient) + p.gradient * smooth((G(v.co).y - self.lo) / self.span)
                if p.facing:
                    s *= 1.0 + 0.07 * max(0.0, n.y) - 0.12 * max(0.0, -n.y)
                k = (s * wear * k_edge) ** 2.2
                r, g, b, al = loop[p.col]
                loop[p.col] = (r * k, g * k, b * k, al)
            f[p.tag] = FLAT


def plain_stone_inside(parts):
    """The rubble indoors laid in the plain dressed stone: every face of the mossy wall stone
    (tavern_texture.STONE) that stands inside (_inside: the wall fire's breast, the nook's drum,
    the kitchen's range) takes the dressed stone's map instead, so the moss stays out on the walls
    and the chimney the weather reaches."""
    from shiplib import G as game
    for piece in parts.values():
        for f in piece.bm.faces:
            if f.material_index == TX.STONE and _inside(*game(f.calc_center_median())):
                f.material_index = TX.DRESSED


def paint_faces(parts):
    """Every painted face's colour (the builders' tint over the map) stored under the headroom,
    and the map laid on sheet by sheet: each smooth sheet of a solid (tavern_texture.sheets) wears
    one projection, its tint blended across it and its shading smooth over it, so nothing cuts
    it into panels. Each painted corner's smooth normal is kept for the warm bake
    (piece.corner_normals). Returns the faces per material (for the report)."""
    counts = [0] * len(TX.MATERIALS)
    for piece in parts.values():
        bm = piece.bm
        bm.normal_update()
        uv = bm.loops.layers.uv.verify()
        shade = SheetShade(piece)
        piece.corner_normals = {}
        for comp in TX.components(bm):
            frame = None
            for f in comp:
                if piece.name in TX.PLAIN_PARTS and f.material_index in TX.PAINTED:
                    # a part that keeps its own colours (the dog's coat) wears no map at all
                    f.material_index = TX.PLAIN
                slot = f.material_index
                counts[slot] += 1
                if slot not in TX.PAINTED:
                    continue
                for loop in f.loops:
                    # (a tint is at most the map itself: the corner colours are bytes in [0, 1])
                    tint = eased(TX.fit(loop[piece.col][:3]))
                    if slot == TX.ROOF:
                        # the slates tint by brightness alone (their lichen is in the map)
                        k = sum(tint) / 3
                        tint = (k, k, k)
                    loop[piece.col] = (*(c / TX.HEADROOM for c in tint), 1.0)
            for sheet in TX.sheets(comp, piece.soft):
                slot = sheet[0].material_index
                if slot not in TX.PAINTED:
                    continue
                normals = TX.vertex_normals(sheet)
                if slot in TX.ATLAS:
                    # (the props' atlas: its builder laid its UVs into it, and its paint carries its
                    # own light and shade, so finish() leaves its faces unshaded and the bake lights
                    # its sheets smoothly: a piece's corners stay one vertex to the exporter, not
                    # one per face, and it shows no facets)
                    for f in sheet:
                        f[piece.tag] = FLAT
                else:
                    if frame is None:
                        frame = TX.Frame(comp)
                    TX.lay_sheet(sheet, uv, slot, frame, piece.soft)
                    TX.blend_tints(sheet, piece.col)
                    shade(sheet, normals)
                for f in sheet:
                    for loop in f.loops:
                        piece.corner_normals[loop] = normals[loop.vert]
    return counts


# ---------------------------------------------------------------------------
# The warm light baked into the inside (the runtime's point lights are few and shared with the
# whole world: the vertex colours carry the glow of the fires)
# ---------------------------------------------------------------------------
def _warm_sources():
    """The warm lights the bake reads: ((x, y, z), strength, reach)."""
    pit, c = LAYOUT['pit'], LAYOUT['chandelier']
    fire = next(q for q in LAYOUT['props'] if q['kind'] == 'fireplace')
    counter = next(q for q in LAYOUT['props'] if q['kind'] == 'counter' and q['hw'] > q['hd'])
    st, hatch = LAYOUT['stage'], LAYOUT['hatch']
    src = [((pit['x'], 1.6, pit['z']), 1.25, 17.0),
           ((fire['x'] - 1.4, 1.2, fire['z']), 0.85, 10.0),
           ((c['x'], c['y'] - 0.3, c['z']), 0.55, 12.0),
           ((counter['x'], counter['base'] + counter['height'] + 0.4, counter['z']), 0.6, 7.5),
           (((st['x0'] + st['x1']) / 2, st['lift'] + 0.6, st['z1'] - 0.4), 0.75, 7.5),
           # the kitchen's range against its partition (inn_interior.py), its fire facing the hatch
           (((hatch['x0'] + hatch['x1']) / 2, 1.0, -19.3), 1.1, 6.5),
           ((TOWER['x'], 5.5, TOWER['z']), 0.55, 9.0)]
    for q in LAYOUT['lanterns']:
        src.append(((q['x'], q['y'], q['z']), 0.5 if q['lit'] else 0.3, 9.0))
    for q in LAYOUT['sconces']:
        src.append(((q['x'] + q['nx'] * 0.45, q['y'] + 0.3, q['z'] + q['nz'] * 0.45), 0.4, 4.5))
    for q in LAYOUT['props']:
        if q['kind'] in ('table', 'roundTable'):
            src.append(((q['x'], q['base'] + q['height'] + 0.5, q['z']), 0.32, 3.6))
    return src


WARM_GAIN = 1.2
# how much of the fires' warmth the textured props take (bake_warm_light)
PROPS_WARM = 0.35
_HALL_ROOF = []


def _inside(x, y, z):
    """Whether a point is indoors, where the fires' light reaches: the hall up under its sarking
    (never the dormers, the stacks or the slates over it), the kitchen behind the hatch, the
    nook up under the hat."""
    H, Tw = HALL, TOWER
    if not _HALL_ROOF:
        import inn_roof
        _HALL_ROOF.append(inn_roof.Roof(sys.modules[__name__], {}))
    if abs(x) <= H['x1'] - H['wall'] + 0.06 and H['z0'] + H['wall'] - 0.06 <= z <= H['z1'] - H['wall'] + 0.06 \
            and -1.0 <= y <= _HALL_ROOF[0].under(x, z) + 0.25:
        return True
    # the kitchen behind the hatch, back to its partition and the range against it
    if 4.8 <= x <= 15.2 and -21.5 <= z <= H['z0'] and -0.5 <= y <= 6.0:
        return True
    r = math.hypot(x - Tw['x'], z - Tw['z'])
    return r <= Tw['rIn'] + 0.06 and -0.5 <= y <= Tw['peak'] - (Tw['peak'] - Tw['wallTop']) * r / Tw['rIn'] + 0.3


def bake_warm_light(parts):
    """Warm the colours of every surface inside the tavern by the light that reaches it from the
    fires, lanterns and candles: brighter and warmer near a flame, a soft golden floor of light
    everywhere indoors, the far corners a little dim. A painted face's colour is its tint stored
    under the headroom, so the light lifts the paint above the map; a colour that would pass 1
    is brought back by its brightest channel, so near a flame it stays warm rather than white.
    The roofs' slates are outside and stay out of the bake."""
    from shiplib import G as game
    sources = _warm_sources()

    def light_at(c, n):
        light = 0.0
        for (lx, ly, lz), k, reach in sources:
            dx, dy, dz = lx - c.x, ly - c.y, lz - c.z
            d = math.sqrt(dx * dx + dy * dy + dz * dz)
            if d >= reach:
                continue
            facing = (dx * n.x + dy * n.y + dz * n.z) / max(d, 1e-4)
            fall = (1 - d / reach) ** 2
            light += k * fall * (0.35 + 0.65 * max(0.0, facing))
        # (a touch stronger than the light the old, denser model was lit with: the painted
        # rebuild's big faces carry fewer corners near each flame, and the room should glow as
        # warm as it did)
        return min(light * WARM_GAIN, 1.2)

    roofs = ('HallRoof', 'WingRoof', 'TowerRoof')
    for piece in parts.values():
        bm = piece.bm
        bm.normal_update()
        corners = getattr(piece, 'corner_normals', {})
        for f in bm.faces:
            # (slates indoors, the job board's little hood, take the light like the rest)
            if f.material_index == GLOW or (f.material_index == TX.ROOF and piece.name in roofs):
                continue
            c = game(f.calc_center_median())
            if not _inside(c.x, c.y, c.z):
                continue
            n = game(f.normal)
            painted = f.material_index in TX.PAINTED
            # lit at each corner, not once per face: a big wall takes the falloff as a smooth
            # gradient rather than a patchwork of flat panels, each painted corner by its sheet's
            # smooth normal there (paint_faces), so a bowed wall or the nook's drum takes it unbroken
            # (slates take the light by brightness alone, like their paint: the lichen is the map's)
            grey = f.material_index == TX.ROOF
            # (the props' paint carries its own light and colour: they take only a touch of the
            # fires' warmth, PROPS_WARM of it, or their painting cooks to one orange brown)
            touch = PROPS_WARM if f.material_index == TX.PROPS else 1.0
            for loop in f.loops:
                cn = corners.get(loop)
                light = light_at(game(loop.vert.co), game(cn) if cn is not None else n)
                mult = (0.95 + light * 0.55, 0.89 + light * 0.46, 0.8 + light * 0.34)
                if grey:
                    mult = (sum(mult) / 3,) * 3
                mult = tuple(1.0 + (m - 1.0) * touch for m in mult)
                r, g, b, a = loop[piece.col]
                lit = (r * mult[0], g * mult[1], b * mult[2])
                if painted:
                    lit = TX.fit(lit)
                loop[piece.col] = (min(1.0, lit[0]), min(1.0, lit[1]), min(1.0, lit[2]), a)


def encode_for_export(parts):
    """Hand the exporter the palette once linearized. shiplib's finish() linearizes every corner
    colour (**2.2) and the glTF exporter linearizes the colour attribute again, so the palette
    is pre-encoded here and the two steps net to one."""
    for piece in parts.values():
        for f in piece.bm.faces:
            for loop in f.loops:
                r, g, b, a = loop[piece.col]
                loop[piece.col] = (r ** (1 / 2.2), g ** (1 / 2.2), b ** (1 / 2.2), a)


def raise_parts(names=None, only=None):
    """Build the tavern's parts (all, or only those the given builder modules make), every closed
    solid's faces turned outward before anything reads a normal."""
    import bmesh
    from shiplib import Piece
    names = names or (CRITICAL + TRIM + OPTIONAL)
    this = sys.modules[__name__]
    parts = {name: Piece(name, wear=PART_SHADING[name][0], gradient=PART_SHADING[name][1]) for name in names}
    for mod in (builders() if only is None else only):
        mod.build(this, parts)
    # the solids (boxes, beams, lumps, sweeps) come out of their builders wound either way;
    # shiplib's finish() turns them outward, but the paint lays its UVs and the warm bake lights
    # each face by its normal before that, so they are turned here first
    for piece in parts.values():
        closed = [f for f in piece.closed if f.is_valid]
        if closed:
            bmesh.ops.recalc_face_normals(piece.bm, faces=closed)
    return parts


def build_scene():
    if not bpy.app.background:
        raise RuntimeError('build_scene() starts from an empty scene: run it headless (preview() is for a live session)')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = TX.make_materials()
    root = empty('MirefenTavern_ROOT', None, display='ARROWS', size=2.0)
    parts = raise_parts()
    plain_stone_inside(parts)
    faces = paint_faces(parts)
    for name, n in zip(TX.MATERIALS, faces):
        print(f'MATERIAL {name} faces {n}')
    bake_warm_light(parts)
    encode_for_export(parts)
    pieces = {}
    for name in CRITICAL + TRIM + OPTIONAL:
        if not parts[name].bm.faces:
            raise RuntimeError(f'part {name} is empty')
        # the dog's origin is where it lies, so the runtime breathes it round its own middle
        dog = LAYOUT['grounds']['dog']
        at = (dog['x'], 0.0, dog['z']) if name == 'TavernDog' else (0.0, 0.0, 0.0)
        pieces[name] = parts[name].finish(mats, root, location=at)
    root['mirefenTavern'] = {
        'layoutVersion': LAYOUT['version'],
        'tiers': {'low': list(CRITICAL), 'medium': list(TRIM), 'high': list(OPTIONAL)},
        'shell': list(SHELL),
        'hall': {'eave': HALL['eave'], 'ridge': HALL['ridge'], 'truss': HALL['truss']},
        'door': [LAYOUT['door']['width'], LAYOUT['door']['height']],
        'nookRadius': TOWER['rIn'],
    }
    return dict(root=root, pieces=pieces, mats=mats)


def preview(only=None, collection='INN_PREVIEW'):
    """Raise some of the tavern into the open scene (a live Blender session), painted and drawn
    at the game's brightness, to look at it as it goes up wall by wall. Never part of the
    shipped build: build_scene() is."""
    import importlib
    col = bpy.data.collections.get(collection)
    if col is None:
        col = bpy.data.collections.new(collection)
        bpy.context.scene.collection.children.link(col)
    for ob in list(col.objects):
        mesh = ob.data if ob.type == 'MESH' else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    # the builders as they stand on disk now (a live session keeps its first import otherwise),
    # the shared ones first
    order = ['inn_kit', 'tavern_texture', 'inn_roof', 'inn_hall']
    order += sorted(n for n in sys.modules if n.startswith('inn_') and n not in order) + ['tavern_dog']
    for n in order:
        if n in sys.modules:
            importlib.reload(sys.modules[n])
    _HALL_ROOF.clear()
    if only is not None:
        only = [sys.modules[m.__name__] for m in only]
    # the preview's own materials (never anyone else's of the same name)
    mats = [bpy.data.materials.get('INN_PREVIEW_' + name) for name in TX.MATERIALS]
    fresh = any(m is None for m in mats)
    if fresh:
        for m in mats:
            if m is not None:
                bpy.data.materials.remove(m)
        mats = TX.make_materials()
        for name, m in zip(TX.MATERIALS, mats):
            m.name = 'INN_PREVIEW_' + name
    parts = raise_parts(only=only)
    plain_stone_inside(parts)
    paint_faces(parts)
    bake_warm_light(parts)
    encode_for_export(parts)
    root = empty('INN_PREVIEW_ROOT', None, display='ARROWS', size=2.0)
    made = [root]
    dog = LAYOUT['grounds']['dog']
    for name, piece in parts.items():
        if not piece.bm.faces:
            piece.bm.free()
            continue
        at = (dog['x'], 0.0, dog['z']) if name == 'TavernDog' else (0.0, 0.0, 0.0)
        made.append(piece.finish(mats, root, location=at))
    for ob in made:
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        col.objects.link(ob)
    if fresh:
        TX.show_headroom(mats)
    tris = sum(triangles(o) for o in made if o.type == 'MESH')
    return {o.name: triangles(o) for o in made if o.type == 'MESH'}, tris


def report(objs):
    total = 0
    for name, obj in objs['pieces'].items():
        n = triangles(obj)
        total += n
        print(f'PIECE {name} triangles {n}')
    print(f'TRIANGLES total {total}')
    print(f"TRIANGLES low tier {sum(triangles(objs['pieces'][n]) for n in CRITICAL)}")
    return total


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    root = objs['root']
    root.select_set(True)
    for o in root.children_recursive:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    # the maps are not embedded here: build.mjs embeds them (textures.json) at each texture tier
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_morph=False,
        export_texcoords=True, export_image_format='NONE',
    )
    print('WROTE', path)


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


if __name__ == '__main__':
    objs = build_scene()
    report(objs)
    export(os.path.join(HERE, 'mirefen_tavern_source.glb'), objs)
    if arg('--save'):
        import tavern_scene  # noqa: E402

        # the review scene draws the painted colours at the game's own scale (after the export)
        TX.show_headroom(objs['mats'])
        tavern_scene.stage(objs, arg('--context'))
        tavern_scene.save(arg('--save'))
