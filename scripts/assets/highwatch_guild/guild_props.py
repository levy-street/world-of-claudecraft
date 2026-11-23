"""Lantern Hall's painted props (guild_furnish.py and guild_yard.py hang and stand them): the
pieces that are real models rather than built here, each wearing its own painted texture packed
into the props' atlas (tex/GuildProps_Color.jpg, made by props/build_atlas.mjs from the sources
props/props.json lists). They were made the Mirefen tavern's way: front, side and back views of
each painted with ChatGPT's image generation in the tavern stag's style, built from them in
Tripo Studio (P2, multi-view image to 3D, Smart Mesh), then baked down to a few hundred
triangles (props/bake_low.py); the chandeliers, sconces, lanterns, candles, tankards, barrels and
crates are the tavern's own.

A wall piece hangs flat on its wall's inner face, its back a hand off the plaster; a standing
piece stands on what carries it. Each is on the props' material (guild_texture.PROPS) with the
UVs its atlas tile gives it, its corners welded so it shades smooth across its texture's seams,
and painted white: the warm light baked in afterwards is its only tint (guild_texture.py).
"""
import json
import math
import os

from mathutils import Vector
from shiplib import FLAT, P

HERE = os.path.dirname(os.path.abspath(__file__))
_DATA = os.path.join(HERE, 'props', 'props_data.json')
if os.path.exists(_DATA):
    with open(_DATA, encoding='utf8') as fh:
        PROPS = json.load(fh)['props']
else:
    # a checkout that has not packed the props yet builds the hall without them
    PROPS = {}

# the material slot the props wear (guild_texture.PROPS; kept here so the builders need not
# import the painter)
PROPS_SLOT = 16
# a hung piece's back stands this far off its wall's face (over the plaster's belly and the oak
# the inner walls are panelled with)
STANDOFF = 0.09


def has(name):
    return name in PROPS


def size(name):
    """A prop's own size (x across its face, y up, z out from its back), in its model's units."""
    return PROPS[name]['size']


def back_depth(name):
    """How far a wall piece's own back plate stands in front of its rearmost corner, in its
    model's units: the lowest depth among the corners over the middle of its face (a skull's
    horns that sweep back past its plate set the piece's back, but the plate is what seats on
    the board)."""
    prop = PROPS[name]
    sx, sy, _ = prop['size']
    mid = [z for (x, y, z) in prop['verts'] if abs(x) < 0.25 * sx and abs(y) < 0.3 * sy]
    return min(mid) if mid else 0.0


def height_for_width(name, width):
    """The height a prop stands at to be `width` wide across its face."""
    s = size(name)
    return width / s[0] * s[1]


def hang(p, name, centre, normal, height, lean=0.0, standoff=STANDOFF):
    """One prop on its wall: its face looking along the wall's normal into the room (normal is
    (nx, nz)), its back `standoff` off the wall's face, its middle at `centre` (x, y, z on the
    wall's face), `height` tall, turned `lean` off level about the normal. Returns where a point
    of its own frame lands (frame())."""
    prop = PROPS[name]
    f = Vector((normal[0], 0.0, normal[1])).normalized()
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    c, s = math.cos(lean), math.sin(lean)
    r2 = right * c + up * s
    u2 = up * c - right * s
    scale = height / prop['size'][1]
    origin = Vector(centre) + f * standoff - u2 * (prop['size'][1] / 2 * scale)
    at = frame(prop, origin, r2, u2, f, scale)
    _lay(p, prop, at)
    return at


def stand(p, name, foot, yaw, height):
    """One prop standing on what carries it: its foot's middle at `foot` (x, y, z), its face
    (+z) turned `yaw` about the vertical (0 faces +z, pi/2 faces +x), `height` tall. Returns
    where a point of its own frame lands."""
    prop = PROPS[name]
    f = Vector((math.sin(yaw), 0.0, math.cos(yaw)))
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    scale = height / prop['size'][1]
    # (the data's back is on z 0: stood, its middle goes over the foot instead)
    origin = Vector(foot) - f * (prop['size'][2] / 2 * scale)
    at = frame(prop, origin, right, up, f, scale)
    _lay(p, prop, at)
    return at


def stand_fit(p, name, foot, yaw, width, depth, height):
    """A standing prop scaled to fill a footprint `width` across its face by `depth` deep and
    `height` tall (each axis its own scale: the record's box is the collider it stands in)."""
    prop = PROPS[name]
    sx, sy, sz = (width / prop['size'][0], height / prop['size'][1], depth / prop['size'][2])
    f = Vector((math.sin(yaw), 0.0, math.cos(yaw)))
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    origin = Vector(foot) - f * (prop['size'][2] / 2 * sz)
    lift = prop['size'][1] / 2

    def at(x, y, z):
        return origin + right * (x * sx) + up * ((y + lift) * sy) + f * (z * sz)

    at.scale = sy
    _lay(p, prop, at)
    return at


def frame(prop, origin, right, up, f, scale):
    """Where a point of the prop's own frame (props_data.json: x across its face from its
    middle, y up from its middle, z out from its back) lands in the hall: its x along `right`,
    its y (from its foot) along `up`, its z along `f`, from `origin`."""
    lift = prop['size'][1] / 2

    def at(x, y, z):
        return origin + right * (x * scale) + up * ((y + lift) * scale) + f * (z * scale)

    at.scale = scale
    return at


def _lay(p, prop, at):
    """The prop's corners into the part, placed by `at` (frame()); welded by position so it
    shades smooth across its texture's seams, its UVs kept per corner."""
    bm = p.bm
    uv = bm.loops.layers.uv.verify()
    welded = {}
    verts = []
    for x, y, z in prop['verts']:
        key = (x, y, z)
        if key not in welded:
            q = at(x, y, z)
            welded[key] = bm.verts.new(P(q.x, q.y, q.z))
        verts.append(welded[key])
    faces = []
    for tri in prop['faces']:
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
    p.paint(faces, (1.0, 1.0, 1.0), PROPS_SLOT, FLAT)
    return faces


# the candle pieces' wicks (the Mirefen tavern's measures, scripts/assets/mirefen_tavern/
# inn_props.py WICKS: the same models, so the same corners), in each model's own frame and units
# (frame() scales them): the flame's height and width, and where each flame stands
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
FLAME = (0.95, 0.66, 0.3)
GLOW_CANDLE_SLOT = 12


def flame(glow, foot, h, r, turn=0.0):
    """A candle flame on a wick: a four-sided teardrop, its foot on the wick, widest a third of
    the way up, drawn to a point (the glow part: its colour is lit, the runtime lifts it)."""
    from guild_lib import flat_face
    x, y, z = foot.x, foot.y, foot.z
    mid = y + h * 0.33
    ring = [(x + math.cos(turn + k * math.pi / 2) * r, mid, z + math.sin(turn + k * math.pi / 2) * r) for k in range(4)]
    bottom, top = (x, y, z), (x, y + h, z)
    for k in range(4):
        a, b = ring[k], ring[(k + 1) % 4]
        out = ((a[0] + b[0]) / 2 - x, 0.0, (a[2] + b[2]) / 2 - z)
        flat_face(glow, [a, b, top], FLAME, GLOW_CANDLE_SLOT, (out[0], 0.4, out[2]))
        flat_face(glow, [b, a, bottom], FLAME, GLOW_CANDLE_SLOT, (out[0], -0.4, out[2]))


def light_wicks(glow, name, at):
    """A flame on every wick of a candle piece, placed by `at` (frame()), sized to the piece."""
    h, r, wicks = WICKS[name]
    for k, wick in enumerate(wicks):
        flame(glow, at(*wick), h * at.scale, r * at.scale, turn=0.4 * k)


def hang_fit(p, name, centre, normal, width, height, depth=None, standoff=STANDOFF):
    """A wall piece scaled to fill `width` across its face and `height` up (and `depth` out, or
    its own depth at the height's scale), its middle at `centre` on the wall's face."""
    prop = PROPS[name]
    sx, sy = width / prop['size'][0], height / prop['size'][1]
    sz = depth / prop['size'][2] if depth else sy
    f = Vector((normal[0], 0.0, normal[1])).normalized()
    up = Vector((0.0, 1.0, 0.0))
    right = up.cross(f).normalized()
    origin = Vector(centre) + f * standoff - up * (height / 2)
    lift = prop['size'][1] / 2

    def at(x, y, z):
        return origin + right * (x * sx) + up * ((y + lift) * sy) + f * (z * sz)

    at.scale = sy
    _lay(p, prop, at)
    return at
