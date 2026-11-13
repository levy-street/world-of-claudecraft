"""The painted layer over shiplib, for the Eastbrook ferry and the harbours built beside it.

shiplib.py is shared: the harbours, the wharf, the route marker, the tavern and the guild
are built on it and fingerprint it, so it stays exactly as it is. Everything that makes
a model PAINTED lives here instead, as a `Piece` that extends shiplib's and a
`make_materials` that replaces it.

A model is painted like the town it stands in: small maps prepared from the Eastbrook
paintings (paint_ferry.py writes them to tex/) carry the plank lines, the brush strokes,
the sewn canvas, the rubble stone and the gilded carving, and the vertex colours TINT them.
The maps are light and nearly neutral, so the tint still decides whether a board is an
oxblood strake, a cream castle panel or a tarred pile. Each material slot wears one kind
of map (`Piece.KINDS`): the ferry's are planking, the fittings map (iron, gilding and the
carved figurehead) and canvas; a harbour's (`HarbourPiece`) planking, fittings and stone.
The rope and the glow wear no map.

Texture coordinates are worked out when a piece is finished (`Piece.finish`). On the ship:
planking at world scale with the courses running fore and aft, a spar or rail on one board
with the grain along it, iron as a riveted strap along its length, canvas flat across a
sail. On a harbour, which lies at any angle: every board, pile, post and beam on one
painted board with the grain along its own length, a wall's boards along the wall, stone
at world scale with its courses level. A face that wants something else (a gilded band
along a strake, a painted part) is given its coordinates when it is built and is left alone.
"""
import json
import math
import os

import bpy
import shiplib
from mathutils import Vector
from shiplib import CLOTH, IRON, PLAIN, WOOD, G, P

# how a face gets its texture coordinates: worked out at finish (AUTO, or UPRIGHT for
# planking that stands on end, a door), or GIVEN when the face was built
AUTO, GIVEN, UPRIGHT = 0, 1, 2

TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex')
with open(os.path.join(TEX, 'layout.json'), encoding='utf-8') as _fh:
    LAYOUT = json.load(_fh)
# the kinds of map a material slot can wear, and the file each is
TEXTURES = {'wood': 'ferry_wood.png', 'fittings': 'ferry_fittings.png', 'cloth': 'ferry_cloth.png',
            'stone': 'harbour_stone.png'}
WOOD_TILE = LAYOUT['wood']['tile']  # yards a repeat of the planking covers (the town's hull tile)
CLOTH_TILE = LAYOUT['cloth']['tile']
STONE_TILE = LAYOUT['stone']['tile']  # the town's stone tile
COURSES = LAYOUT['wood']['courses']  # each painted board of the wood tile, (v0, v1)
BANDS = LAYOUT['fittings']['bands']  # name: (v0, v1, sheet width / band height)
PARTS = LAYOUT['fittings']['parts']
WHITE = (1.0, 1.0, 1.0)


def _luminance(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


# The maps are lighter than white paint would be dark: a tint is raised by its map's mean so
# a face lands on the colour it was given (never past white, and never off its hue). The
# gain is in linear light; shiplib shades a colour and then raises it to 2.2, so the tint
# itself is raised by the gain's 2.2th root.
TINT_GAIN = {
    'wood': (1.0 / _luminance(LAYOUT['wood']['mean_linear'])) ** (1 / 2.2),
    'cloth': (1.0 / _luminance(LAYOUT['cloth']['mean_linear'])) ** (1 / 2.2),
    'fittings': (1.0 / _luminance(LAYOUT['fittings']['iron_mean_linear'])) ** (1 / 2.2),
    'stone': (1.0 / _luminance(LAYOUT['stone']['mean_linear'])) ** (1 / 2.2),
}


def _balance(mean_linear):
    return tuple((1.0 / max(v, 1e-6)) ** (1 / 2.2) for v in mean_linear)


# The same gain channel by channel, for a model whose tints alone should set its hue (a
# harbour's: `HarbourPiece`). The planking map is warm on average (more red than blue), so
# a tint raised only by the map's brightness comes out redder than it was named; raised
# channel by channel it lands on its own colour, and the map adds drawing but no cast.
TINT_BALANCE = {
    'wood': _balance(LAYOUT['wood']['mean_linear']),
    'fittings': _balance(LAYOUT['fittings']['iron_mean_linear']),
    'stone': _balance(LAYOUT['stone']['mean_linear']),
}


def weathered(colour, grey=0.65, lift=1.2):
    """A timber colour (or a list of them) as harbour wood that has stood in sun and salt:
    `grey` of the way to a warm grey of its own weight, then `lift` times lighter. Fresh
    orange-brown boards come out a sun-bleached grey-brown; a lift under 1 darkens instead
    (a roof's shingles: a weathered red-brown)."""
    if isinstance(colour, list):
        return [weathered(c, grey, lift) for c in colour]
    lin = [v ** 2.2 for v in colour]
    weight = _luminance(lin)
    warm = (weight * 1.12, weight, weight * 0.86)
    return tuple(round(min(1.0, lift * (a + (w - a) * grey)) ** (1 / 2.2), 4) for a, w in zip(lin, warm))


def uv_band(name, s, t, depth):
    """A point on a fittings band: s yards along it, t across it (0 at its lower edge, 1 at
    its upper), `depth` the world width the band is seen at."""
    v0, v1, aspect = BANDS[name]
    return (s / (depth * aspect), v0 + (v1 - v0) * t)


def uv_part(name, fx, fy):
    """A point on a painted part: fx across it, fy DOWN from its top, both 0 to 1."""
    u0, v0, u1, v1 = PARTS[name]['uv']
    return (u0 + (u1 - u0) * fx, v1 - (v1 - v0) * fy)


class Piece(shiplib.Piece):
    """shiplib's piece, with a texture coordinate on every corner. This is the SHIP's: its
    planking runs fore and aft."""

    # the kind of map each material slot wears (a slot not named here wears none)
    KINDS = {WOOD: 'wood', IRON: 'fittings', CLOTH: 'cloth'}
    # steps to a repeat that a laid coordinate is rounded onto (None: left as laid)
    UV_GRID = None
    # whether a tint is raised channel by channel (TINT_BALANCE) or by brightness alone
    BALANCED = False

    def __init__(self, name, **kwargs):
        super().__init__(name, **kwargs)
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.uvmode = self.bm.faces.layers.int.new('uvmode')
        self.grain = AUTO  # the mode new faces take: set to UPRIGHT while building a door
        self.course = sum(ord(c) for c in name) % len(COURSES)

    # ------------------------------------------------------------ painting
    def paint(self, faces, color, mat, tag=PLAIN):
        super().paint(faces, color, mat, tag)
        for f in faces:
            if f[self.uvmode] != GIVEN:
                f[self.uvmode] = self.grain
        return faces

    def give_uv(self, face, uvs):
        """Fix a face's texture coordinates: {vert: (u, v)} or a list in loop order."""
        for k, loop in enumerate(face.loops):
            loop[self.uv].uv = uvs[loop.vert] if isinstance(uvs, dict) else uvs[k]
        face[self.uvmode] = GIVEN

    def face(self, pts, color, mat=WOOD, tag=PLAIN, uvs=None):
        f = super().face(pts, color, mat, tag)
        if uvs is not None:
            self.give_uv(f, uvs)
        return f

    def surface(self, rows, color_fn, mat=WOOD, outward=None, skip=None, tag=PLAIN, soft=True):
        """shiplib's quad grid, whose color_fn may also return (color, mat, lay) to lay the
        face's texture coordinates: lay is ('band', name, t0, t1, depth), a fittings band
        running along the row with the face spanning t0 to t1 of its height, or
        ('course', k, length), board k of the planking along the COLUMN (a deck board),
        `length` yards to a repeat."""
        laid = []

        def color(i, j):
            got = color_fn(i, j)
            lay = None
            if isinstance(got, tuple) and len(got) == 3 and isinstance(got[0], tuple) and isinstance(
                    got[2], tuple):
                got, lay = (got[0], got[1]), got[2]
            laid.append((i, j, lay))  # shiplib asks once per face it makes, in the order it makes them
            return got

        faces = super().surface(rows, color, mat, outward=outward, skip=skip, tag=tag, soft=soft)
        # yards run along each row, for a band laid along it
        runs = []
        for row in rows:
            run = [0.0]
            for a, b in zip(row, row[1:]):
                run.append(run[-1] + (Vector(b) - Vector(a)).length)
            runs.append(run)
        for f, (i, j, lay) in zip(faces, laid):
            if lay is None or not f.is_valid:
                continue
            corners = ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))
            where = [P(*rows[ci][cj]) for ci, cj in corners]
            uvs = []
            for loop in f.loops:
                ci, cj = corners[min(range(4), key=lambda k: (where[k] - loop.vert.co).length)]
                if lay[0] == 'band':
                    _, name, t0, t1, depth = lay
                    uvs.append(uv_band(name, runs[i][cj], t0 if ci == i else t1, depth))
                else:
                    _, k, length = lay
                    v0, v1 = COURSES[k % len(COURSES)]
                    # out to the ink line on either side of the board
                    uvs.append((rows[ci][cj][2] / length + 0.37 * k, v0 - 0.03 if cj == j else v1 + 0.03))
            self.give_uv(f, uvs)
        return faces

    def turn(self, mark, matrix):
        """shiplib's turn. Canvas built since `mark` is laid first, square to the ship as it
        was built, and keeps those coordinates: a sail braced round on its mast wears its
        seams straight down the cloth, not broken where the turn tips a face from one
        projection to the other."""
        self.bm.normal_update()
        for f in self.bm.faces:
            if self.KINDS.get(f.material_index) != 'cloth' or f[self.uvmode] == GIVEN:
                continue
            if all(v[self.gen] == 0 or v[self.gen] > mark for v in f.verts):
                self._lay(f)
                f[self.uvmode] = GIVEN
        super().turn(mark, matrix)

    # ------------------------------------------------- texture coordinates
    def _frame(self, f, pts, n):
        """A face's own frame: `along` its longest edge, `across` it in the face's plane.
        Returns None for a face too small to have one, else (ls, ws, length, width): each
        corner's reach along and across, and the face's extent each way."""
        along = max(((pts[(k + 1) % len(pts)] - pts[k]) for k in range(len(pts))), key=lambda d: d.length)
        if along.length <= 1e-6 or n.length <= 1e-6:
            return None
        along = along.normalized()
        across = n.cross(along)
        if across.length <= 1e-6:
            return None
        across.normalize()
        ls = [q.dot(along) for q in pts]
        ws = [q.dot(across) for q in pts]
        length, width = max(ls) - min(ls), max(ws) - min(ws)
        return (ls, ws, length, width) if width > 1e-5 else None

    def _lay(self, f):
        """Texture coordinates for a face nobody laid by hand (see the module header)."""
        uv = self.uv
        kind = self.KINDS.get(f.material_index)
        if kind is None:
            for loop in f.loops:
                loop[uv].uv = (0.0, 0.0)
            return
        n = G(f.normal)
        pts = [G(loop.vert.co) for loop in f.loops]
        if kind == 'cloth':
            self._lay_cloth(f, n, pts)
        elif kind == 'stone':
            self._lay_stone(f, n, pts)
        elif kind == 'fittings':
            self._lay_iron(f, n, pts)
        else:
            self._lay_wood(f, n, pts)

    def _lay_cloth(self, f, n, pts):
        uv = self.uv
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop, q in zip(f.loops, pts):
            if ax >= ay and ax >= az:
                loop[uv].uv = (q.z / CLOTH_TILE, q.y / CLOTH_TILE)
            elif az >= ay:
                loop[uv].uv = (q.x / CLOTH_TILE, q.y / CLOTH_TILE)
            else:
                loop[uv].uv = (q.x / CLOTH_TILE, q.z / CLOTH_TILE)

    def _lay_stone(self, f, n, pts):
        """Rubble at the town's scale, its courses level: a top lies flat on the world, a
        wall runs along its own foot."""
        uv = self.uv
        t = STONE_TILE
        if abs(n.y) >= abs(n.x) and abs(n.y) >= abs(n.z):
            for loop, q in zip(f.loops, pts):
                loop[uv].uv = (q.x / t, q.z / t)
            return
        run = Vector((n.z, 0.0, -n.x))
        run.normalize()
        for loop, q in zip(f.loops, pts):
            loop[uv].uv = (q.dot(run) / t, q.y / t)

    def _lay_iron(self, f, n, pts):
        uv = self.uv
        v0, v1, aspect = BANDS['iron']
        frame = self._frame(f, pts, n)
        if frame is None:
            for loop in f.loops:
                loop[uv].uv = (0.5, (v0 + v1) / 2)
            return
        ls, ws, _length, width = frame
        depth = max(width, 0.14)
        for loop, l, w in zip(f.loops, ls, ws):
            loop[uv].uv = (l / (depth * aspect), v0 + (v1 - v0) * (0.08 + 0.84 * (w - min(ws)) / width))

    def _lay_board(self, f, frame, course, limit=0.5):
        """One painted board on a narrow face, the grain along it. False when the face is
        not a narrow one (no frame, wider than `limit`, or not long for its width)."""
        if frame is None or f[self.uvmode] == UPRIGHT:
            return False
        ls, ws, length, width = frame
        if not (width < limit and length > 1.5 * width):
            return False
        uv = self.uv
        t = WOOD_TILE
        v0, v1 = COURSES[course]
        mid, room = (v0 + v1) / 2, (v1 - v0)
        scale = 1.0 / t if width / t <= room else room / width
        wm = (max(ws) + min(ws)) / 2
        for loop, l, w in zip(f.loops, ls, ws):
            loop[uv].uv = (l / t + 0.31 * course, mid + (w - wm) * scale)
        return True

    def _lay_wood(self, f, n, pts):
        uv = self.uv
        t = WOOD_TILE
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        # a spar, a rail, a post, a moulding: one board, the grain along it
        if self._lay_board(f, self._frame(f, pts, n), self.course):
            return
        upright = f[self.uvmode] == UPRIGHT
        for loop, q in zip(f.loops, pts):
            if ay >= ax and ay >= az:
                loop[uv].uv = (q.z / t, q.x / t)  # decks and tops: boards fore and aft
            elif upright:
                loop[uv].uv = (q.y / t, (q.z if ax >= az else q.x) / t)
            elif ax >= az:
                loop[uv].uv = (q.z / t, q.y / t)  # the ship's sides: strakes fore and aft
            else:
                loop[uv].uv = (q.x / t, q.y / t)  # athwartships: boards across the ship

    def _tidy(self, f):
        """Bring a face's coordinates home and round them onto a fine grid. The maps repeat,
        so whole turns are free, and a harbour's world-scale coordinates run to the hundreds:
        small round numbers pack several times smaller in the shipped file and land within a
        hair (a five-hundredth of a repeat) of where they were laid."""
        uv = self.uv
        grid = self.UV_GRID
        du = math.floor(min(loop[uv].uv.x for loop in f.loops))
        dv = math.floor(min(loop[uv].uv.y for loop in f.loops))
        for loop in f.loops:
            u, v = loop[uv].uv
            loop[uv].uv = (round((u - du) * grid) / grid, round((v - dv) * grid) / grid)

    # ------------------------------------------------------------- finish
    def finish(self, materials, parent, location=(0.0, 0.0, 0.0), smooth_shading=None):
        """Lay every face nobody laid by hand, raise each tint by its map's gain, then hand
        the piece to shiplib to shade, sort and link exactly as it always has."""
        self.bm.normal_update()
        for f in self.bm.faces:
            if f[self.uvmode] != GIVEN:
                self._lay(f)
                if self.UV_GRID:
                    self._tidy(f)
            kind = self.KINDS.get(f.material_index)
            if self.BALANCED and kind in TINT_BALANCE:
                gr, gg, gb = TINT_BALANCE[kind]
                for loop in f.loops:
                    r, g, b, a = loop[self.col]
                    r, g, b = r * gr, g * gg, b * gb
                    k = 1.0 / max(r, g, b, 1.0)
                    loop[self.col] = (r * k, g * k, b * k, a)
                continue
            gain = TINT_GAIN.get(kind)
            if gain is None:
                continue
            for loop in f.loops:
                r, g, b, a = loop[self.col]
                k = min(gain, 1.0 / max(r, g, b, 1e-6))
                loop[self.col] = (r * k, g * k, b * k, a)
        return super().finish(materials, parent, location=location, smooth_shading=smooth_shading)


class HarbourPiece(Piece):
    """The piece of a harbour, a wharf or a signpost: timber, fittings and stone (the
    builders' third slot is stone, where the ship's is cloth). Nothing here lies fore and
    aft, so a board's grain follows the board."""

    KINDS = {WOOD: 'wood', IRON: 'fittings', 2: 'stone'}
    UV_GRID = 512
    BALANCED = True

    def _lay_wood(self, f, n, pts):
        uv = self.uv
        t = WOOD_TILE
        frame = self._frame(f, pts, n)
        # a deck board, a pile, a post, a rail, a brace: one painted board of its own (which
        # one follows from where it lies, so the boards of a deck differ), the grain along it
        course = int(self._noise(f.calc_center_median()) * len(COURSES)) % len(COURSES)
        if self._lay_board(f, frame, course, limit=1.1):
            return
        if abs(n.y) >= abs(n.x) and abs(n.y) >= abs(n.z):
            # a broad top or soffit: planked along its own longest edge
            if frame is None:
                for loop, q in zip(f.loops, pts):
                    loop[uv].uv = (q.x / t, q.z / t)
                return
            ls, ws, _length, _width = frame
            for loop, l, w in zip(f.loops, ls, ws):
                loop[uv].uv = (l / t, w / t)
            return
        # a broad upright face: boards along the wall, or standing on end
        run = Vector((n.z, 0.0, -n.x))
        run.normalize()
        upright = f[self.uvmode] == UPRIGHT
        for loop, q in zip(f.loops, pts):
            loop[uv].uv = (q.y / t, q.dot(run) / t) if upright else (q.dot(run) / t, q.y / t)


FERRY_MATERIALS = (
    # name, roughness, metallic, emission, double sided, the kind of map it wears
    ('FerryWood', 0.82, 0.0, 0.0, False, 'wood'),
    ('FerryIron', 0.55, 0.2, 0.0, False, 'fittings'),
    ('FerryCloth', 0.92, 0.0, 0.0, True, 'cloth'),
    ('FerryRope', 0.95, 0.0, 0.0, False, None),
    ('FerryGlow', 0.5, 0.0, 2.2, False, None),
)


def make_materials(specs=FERRY_MATERIALS):
    """The materials of a painted model (the ferry's five unless told otherwise), each
    wearing its kind of map under the vertex colour."""
    mats = []
    for name, rough, metal, emission, double, kind in specs:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        if kind is not None:
            # the painted map, tinted by the vertex colour (the runtime multiplies the two
            # the same way: src/render/transport_ship.ts, vertex_colour_glb_parts.ts)
            tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(os.path.join(TEX, TEXTURES[kind]), check_existing=True)
            tex.image.name = os.path.splitext(TEXTURES[kind])[0]
            mix = mat.node_tree.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = 1.0
            mat.node_tree.links.new(tex.outputs['Color'], mix.inputs[6])
            mat.node_tree.links.new(attr.outputs['Color'], mix.inputs[7])
            mat.node_tree.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        else:
            mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = not double
        mats.append(mat)
    return mats


def harbour_materials(specs, kinds=('wood', 'fittings', 'stone')):
    """A harbour builder's own (name, roughness, metallic, emission) rows, indexed like
    shiplib with stone in the third slot, made into painted materials: planking on the
    first, the fittings map on the second, stone on the third, none on the rest. A model
    with no stone passes ('wood', 'fittings', None)."""
    return make_materials(tuple(
        (name, rough, metal, emission, False, kinds[i] if i < len(kinds) else None)
        for i, (name, rough, metal, emission) in enumerate(specs)))
