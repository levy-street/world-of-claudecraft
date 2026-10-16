"""The Highwatch manor: the lord's walk-in house on the north hill of Highwatch (option A of
the approved proposal, "Salon en T con linterna").

  blender --background --python scripts/assets/highwatch_manor/build_manor.py -- \
      [--save FILE.blend] [--render OUT_DIR]

Writes manor_source.glb and manor.collision.json beside this file.
`node scripts/assets/highwatch_manor/build.mjs` ships the GLB (validate, fingerprint, embed the
painted maps, KTX2, meshopt) to public/models/tidehold/highwatch/manor.glb and its texture
tiers, and merges the collision rows into data/asset_collision_overrides.json; the town stands
it like the painted buildings (src/sim/highwatch_layout.ts), so the model frame is the painted
set's: yards, origin on the ground line, a yard of footing under it, the door on the -z face.

Painted like the painted Highwatch buildings, by the Mirefen tavern's method: each palette
family wears one of the painted town's hand-painted tiling maps in Highwatch's Alpine slate look
(manor_texture.py, textures.json): the plaster the limewash, the timber, the boards, every stone
(blocks, mortar, trims, flags) the dressed granite, the slates the square slate, the textiles
the woven cloth; the vertex colours stay the tint, the warm light and the weathering over the
paint (stored under a headroom the runtime multiplies back, so the light can lift the paint).
The metal, the glass, the glows and whatever no family claims stay untextured.

Hierarchy (the town view draws the whole; G_INT* parts cast no shadow, the rule the painted
buildings follow, render/eastbrook_placed_building.ts):

  HighwatchManor_ROOT
    ManorShell            walls, floors, porch, dais bay, wings, chimney
    ManorRoof             the slate, the lantern, the ceilings under the roofs
    ManorTrim             gold, iron, the crest, the door's ironwork
    ManorGrounds          the walled garden: wall, gate, path, hedges, lamps, fountain, bench
    ManorGlow             lit glass, embers, candle flames (the runtime lifts its glow)
    G_INT_Timber          the hall's open roof: trusses, purlins, the hearth and its hood
    G_INT_Furnishings     everything that furnishes the rooms

Original procedural work for this project (shiplib + these modules); no imported meshes.
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
from manor_lib import EMISSIVE, SLATE, encode_for_export  # noqa: E402
from shiplib import empty, triangles  # noqa: E402

import manor_furnish as U  # noqa: E402
import manor_grounds as GR  # noqa: E402
import manor_plan as PL  # noqa: E402
import manor_shell as S  # noqa: E402
import manor_texture as TX  # noqa: E402
from manor_weather import bake_weather  # noqa: E402

PARTS = ('ManorShell', 'ManorRoof', 'ManorTrim', 'ManorGrounds', 'ManorGlow', 'G_INT_Timber',
         'G_INT_Furnishings')
# per part: the wear (per-face value jitter) and the top-to-bottom shading gradient
SHADING = {name: (0.04, 0.07) for name in PARTS}
SHADING.update({'ManorRoof': (0.05, 0.04), 'ManorGlow': (0.0, 0.0), 'ManorGrounds': (0.05, 0.08)})


# ---------------------------------------------------------------------------
# The warm light baked into the inside (the runtime adds a few point lights; the vertex
# colours carry the rest of the glow, the tavern's method)
# ---------------------------------------------------------------------------
def _sources():
    F = PL.FLOOR
    src = [((0.0, F + 1.4, 0.0), 1.3, 19.0),            # the hearth
           ((6.5, F + 10.2, 0.0), 0.55, 13.0), ((-6.5, F + 10.2, 0.0), 0.55, 13.0),   # chandeliers
           ((0.0, PL.HALL['ridge'] + 1.5, 0.0), 0.5, 12.0),   # the lantern's light down the well
           ((0.0, PL.DAIS + 1.8, 14.0), 0.6, 8.0),          # the high table's candles
           ((-5.2, PL.DAIS + 2.6, 12.6), 0.35, 5.0), ((5.2, PL.DAIS + 2.6, 12.6), 0.35, 5.0),
           ((18.9, F + 7.7, 0.2), 0.55, 11.0),              # the dining chandelier
           ((18.9, F + 1.6, 0.2), 0.45, 7.0),               # the table's candelabra
           ((20.3, F + 1.0, 13.4), 1.1, 9.0),               # the kitchen range
           ((-18.9, F + 7.7, -1.0), 0.5, 10.0),             # the library chandelier
           ((-18.4, F + 1.5, 1.0), 0.35, 4.5),              # the reading candle
           ((-18.8, F + 2.0, 11.0), 0.7, 6.5),              # the altar's candles
           ((0.0, F + 6.2, -14.4), 0.45, 7.0)]              # the porch lantern
    for sx in (1, -1):
        for zc in (-3.7, 3.7):
            src.append(((sx * 12.6, F + 4.6, zc), 0.3, 5.0))
    return src


ROOMS = (
    # x0, x1, y0, y1, z0, z1: where the warm bake applies (the inside of every room)
    (PL.HALL['x0'] - 0.1, PL.HALL['x1'] + 0.1, -0.5, PL.LANTERN['y1'] + 0.5, PL.HALL['z0'] - 0.1, PL.HALL['z1'] + 0.1),
    (PL.BAY['x0'] - 0.1, PL.BAY['x1'] + 0.1, -0.5, 18.0, PL.HALL['z1'], PL.BAY['z1'] + 0.1),
    (PL.WEST['x0'] - 0.1, PL.WEST['x1'] + 0.1, -0.5, 11.0, PL.WEST['z0'] - 0.1, PL.WEST['z1'] + 0.1),
    (PL.KITCHEN['x0'] - 0.1, PL.KITCHEN['x1'] + 0.1, -0.5, 10.0, PL.KITCHEN['z0'] - 0.1, PL.KITCHEN['z1'] + 0.1),
    (PL.EAST['x0'] - 0.1, PL.EAST['x1'] + 0.1, -0.5, 11.0, PL.EAST['z0'] - 0.1, PL.EAST['z1'] + 0.1),
    (PL.CHAPEL['x0'] - 0.1, PL.CHAPEL['x1'] + 0.1, -0.5, 14.0, PL.CHAPEL['z0'] - 0.1, PL.CHAPEL['z1'] + 0.1),
    (PL.PORCH['x0'] - 0.2, PL.PORCH['x1'] + 0.2, -0.5, PL.PORCH['beam'] + 0.9, PL.PORCH['z0'] - 1.0, PL.PORCH['z1']),
)


def _inside(x, y, z):
    return any(x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1 for (x0, x1, y0, y1, z0, z1) in ROOMS)


def bake_warm_light(parts):
    """Warm the colours of every surface inside the manor by the light that reaches it from the
    hearth, the chandeliers, the lantern and the candles. On a painted face the colour is
    already its tint over the map, stored under the headroom (manor_texture.py), so the light
    lifts the paint above the map as it lifted the old palette; should a colour still pass 1 it
    is brought back by its brightest channel, so near a flame it stays warm rather than clamping
    white. The slates (the painted roof) stay out of it: all outside."""
    from shiplib import G as game
    sources = _sources()
    for name, piece in parts.items():
        bm = piece.bm
        bm.normal_update()
        for f in bm.faces:
            if f.material_index in EMISSIVE or f.material_index == SLATE:
                continue
            c = game(f.calc_center_median())
            if not _inside(c.x, c.y, c.z):
                continue
            n = game(f.normal)
            light = 0.0
            for (lx, ly, lz), k, reach in sources:
                dx, dy, dz = lx - c.x, ly - c.y, lz - c.z
                d = math.sqrt(dx * dx + dy * dy + dz * dz)
                if d >= reach:
                    continue
                facing = (dx * n.x + dy * n.y + dz * n.z) / max(d, 1e-4)
                fall = (1 - d / reach) ** 2
                light += k * fall * (0.35 + 0.65 * max(0.0, facing))
            light = min(light, 1.1)
            # a warm floor of light indoors, brighter and warmer toward the flames
            mult = (0.92 + light * 0.55, 0.86 + light * 0.44, 0.76 + light * 0.3)
            painted = f.material_index in TX.PAINTED
            for loop in f.loops:
                r, g, b, a = loop[piece.col]
                lit = (r * mult[0], g * mult[1], b * mult[2])
                if painted:
                    lit = TX.fit(lit)
                loop[piece.col] = (min(1.0, lit[0]), min(1.0, lit[1]), min(1.0, lit[2]), a)


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = TX.make_materials()
    root = empty('HighwatchManor_ROOT', None, display='ARROWS', size=2.0)
    this = sys.modules[__name__]
    # every face is filed under its palette family as it is painted (manor_texture.py)
    painter = TX.Painter()
    piece = painter.piece_class()
    parts = {name: piece(name, wear=w, gradient=g) for name, (w, g) in SHADING.items()}
    shell_parts = {'ManorShell': parts['ManorShell'], 'ManorRoof': parts['ManorRoof'],
                   'ManorTimber': parts['G_INT_Timber'], 'ManorTrim': parts['ManorTrim'],
                   'ManorGlow': parts['ManorGlow']}
    S.build(this, shell_parts)
    U.build(this, parts)
    GR.build(this, parts)
    # the painted maps: each face onto its material, its colour a tint, its UVs laid; then the
    # warm light and the weathering over the paint
    faces = painter.paint_faces(parts)
    for name, n in zip(TX.MATERIALS, faces):
        print(f'MATERIAL {name} faces {n}')
    bake_warm_light(parts)
    bake_weather(parts, _inside, painter)
    encode_for_export(parts)
    pieces = {}
    for name in PARTS:
        if not parts[name].bm.faces:
            raise RuntimeError(f'part {name} is empty')
        pieces[name] = parts[name].finish(mats, root)
    root['highwatchManor'] = {
        'version': 1,
        'floor': PL.FLOOR,
        'door': [PL.DOOR['x1'] - PL.DOOR['x0'], PL.DOOR['head'] - PL.FLOOR],
        'hall': {'plate': PL.HALL['plate'], 'ridge': PL.HALL['ridge'], 'truss': PL.HALL['truss']},
        'lantern': [PL.LANTERN['x'], PL.HALL['ridge'] + 2.4, PL.LANTERN['z']],
    }
    return dict(root=root, pieces=pieces, mats=mats)


def bounds(objs):
    """The model's bounds in the model frame (glTF axes: x, y up, z)."""
    from shiplib import G as game
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    bpy.context.view_layer.update()
    for obj in objs['pieces'].values():
        mw = obj.matrix_world
        for v in obj.data.vertices:
            g = game(mw @ v.co)
            for i, c in enumerate((g.x, g.y, g.z)):
                lo[i] = min(lo[i], c)
                hi[i] = max(hi[i], c)
    return lo, hi


def collision_rows(lo, hi):
    """The plan's boxes and decks as placed-asset collision rows: stored in multiples of the
    model's largest dimension over the placed target height (2.2), heights over the model's
    lowest point (sim/town_walk_in.ts, sim/colliders_authored/placement_colliders.ts)."""
    size = max(h - l for h, l in zip(hi, lo))
    k = 2.2 / size
    base = lo[1]
    r4 = lambda v: round(v, 4)  # noqa: E731
    boxes = []
    for (_, x0, x1, y0, y1, z0, z1) in PL.collision_boxes():
        boxes.append({'x': r4((x0 + x1) / 2 * k), 'y': r4(((y0 + y1) / 2 - base) * k), 'z': r4((z0 + z1) / 2 * k),
                      'hx': r4((x1 - x0) / 2 * k), 'hy': r4((y1 - y0) / 2 * k), 'hz': r4((z1 - z0) / 2 * k)})
    ramps = []
    for (_, x0, x1, z0, z1, ya, yb, axis) in PL.decks():
        row = {'x': r4((x0 + x1) / 2 * k), 'z': r4((z0 + z1) / 2 * k), 'y0': r4((ya - base) * k),
               'y1': r4((yb - base) * k)}
        if axis == 'z':
            # the deck's own +x runs up the slope along the model's +z
            row.update({'hx': r4((z1 - z0) / 2 * k), 'hz': r4((x1 - x0) / 2 * k), 'ry': r4(-math.pi / 2)})
        else:
            row.update({'hx': r4((x1 - x0) / 2 * k), 'hz': r4((z1 - z0) / 2 * k)})
        ramps.append(row)
    return {'size': size, 'min': lo, 'max': hi, 'rows': {'mode': 'baked', 'boxes': boxes, 'ramps': ramps}}


def report(objs):
    total = 0
    for name, obj in objs['pieces'].items():
        n = triangles(obj)
        total += n
        print(f'PIECE {name} triangles {n}')
    print(f'TRIANGLES total {total}')
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
    lo, hi = bounds(objs)
    print('BOUNDS', [round(v, 3) for v in lo], [round(v, 3) for v in hi])
    export(os.path.join(HERE, 'manor_source.glb'), objs)
    coll = collision_rows(lo, hi)
    with open(os.path.join(HERE, 'manor.collision.json'), 'w', encoding='utf8', newline='\n') as fh:
        json.dump(coll, fh, indent=1)
        fh.write('\n')
    print('COLLISION', len(coll['rows']['boxes']), 'boxes', len(coll['rows']['ramps']), 'decks, size',
          round(coll['size'], 4))
    if arg('--save') or arg('--render'):
        import manor_scene  # noqa: E402

        # the review scene draws the painted colours at the game's own scale (after the export)
        TX.show_headroom(objs['mats'])
        manor_scene.stage(objs)
        if arg('--save'):
            manor_scene.save(arg('--save'))
        if arg('--render'):
            manor_scene.render_all(arg('--render'), only=arg('--only'))
