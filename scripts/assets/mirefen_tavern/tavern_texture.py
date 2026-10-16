"""The Mirefen tavern's painted surfaces: the hand-painted tiling maps of the painted Tidehold
town in the Fenrire (moss) look, the look the painted Fenbridge buildings wear, laid on the
tavern's own geometry. build_tavern.py builds its parts as TavernPiece and calls paint_faces()
before the warm bake.

  textures.json   the maps each painted material wears (unchanged copies of the Studio
                  library's Fenrire maps in tex/), their repeat in yards (the town kit's own,
                  bl_town_lib.py K), roughness and normal strength, and the vertex colours'
                  headroom
  families()      the tavern's palette families and the map each wears: the ochre plaster and
                  the damp on it the limewash, the honey, oak and dark timbers and the garnet
                  shutters the timber, the boards the floor, the blue-grey base, the river
                  stones and the cobbles the wall stone, the slates the roof, the garnet
                  textiles the cloth, the flags, the tower's ashlar and its mortar the dressed
                  stone

Every face is filed under its family when it is painted (TavernPiece.paint), from the material
and the colour the builders give it, so nothing in the builders changes. A colour no family
claims (glass, candles, food, flowers, leaves, moss, soil, the dog) stays as it was on the plain
untextured material (TavernPlain), and the metal and the glow keep their own.

On a painted face the vertex colour becomes a tint over the map: the face's colour over its
family's reference colour, so the per-face wear, the dark timbers and the garnet shutters stay,
and the warm light baked into the inside afterwards lands on top of the paint. The tint is
stored under textures.json's headroom (divided by it), so that light can lift the paint above
the map itself as it lifted the old palette, instead of only shifting its hue; the runtime
multiplies the colour back (vertex_colour_scale(), written by build.mjs into each painted
material's extras).

UVs are planar per face at the kit's texel density: plaster, stone, dressed stone, cloth and the
roof laid level (courses, folds and slate rows run level, continuous across neighbouring faces),
timber and boards along their length (the grain runs down a beam; each timber starts its own
stretch of the map, from a stable hash of where it stands, so neighbours never repeat).
"""
import json
import math
import os

from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'textures.json'), encoding='utf8') as fh:
    CONFIG = json.load(fh)

# The material slots. The first five keep the builders' own indices (build_tavern.py WOOD,
# METAL, STONE, PLASTER, GLOW; shiplib's finish() and the warm bake read GLOW at 4), the painted
# ones and the plain one follow.
MATERIALS = ('TavernTimber', 'TavernMetal', 'TavernStone', 'TavernPlaster', 'TavernGlow',
             'TavernRoof', 'TavernFloor', 'TavernCloth', 'TavernDressed', 'TavernPlain')
TIMBER, METAL, STONE, PLASTER, GLOW, ROOF, FLOOR, CLOTH, DRESSED, PLAIN = range(len(MATERIALS))
PAINTED = frozenset((TIMBER, STONE, PLASTER, ROOF, FLOOR, CLOTH, DRESSED))
# grain: the map's long axis runs down the solid (a beam, a board)
GRAIN = frozenset((TIMBER, FLOOR))
# (roughness, metallic, emission) of the materials that wear no map
PLAIN_SPECS = {METAL: (0.45, 0.55, 0.0), GLOW: (0.5, 0.0, 2.4), PLAIN: (0.9, 0.0, 0.0)}

# parts that keep their own colours whatever they are painted (the dog's coat)
PLAIN_PARTS = frozenset(('TavernDog',))
# the parts whose slates are the roof's (the hall, the wing, the tower, the porch's canopy and
# the stable on the grounds)
ROOF_PARTS = frozenset(('HallRoof', 'WingRoof', 'TowerRoof', 'HallPorch', 'TavernGrounds'))

# how far (in chromaticity) a colour may sit from a family's swatch and still be one of it
TOLERANCE = 0.012

# a painted face's colour is stored divided by this (textures.json): room above the map for the
# warm light, which lifts a colour up to 1.5 times near a flame (build_tavern.bake_warm_light)
HEADROOM = CONFIG['headroom']


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def vertex_colour_scale():
    """The linear factor that undoes the headroom at runtime. shiplib's finish() and the glTF
    exporter together ship a stored (gamma) colour v as COLOR_0 = srgbToLinear(v), so a tint of
    1 stored at 1 / HEADROOM draws as the map itself under this factor (build.mjs computes the
    same number for the painted materials' extras)."""
    return 1.0 / _srgb_to_linear(1.0 / HEADROOM)


def yards(slot):
    return CONFIG['materials'][MATERIALS[slot]]['yards']


def _chroma(c):
    s = c[0] + c[1] + c[2]
    if s <= 1e-6:
        return (1 / 3, 1 / 3, 1 / 3)
    return (c[0] / s, c[1] / s, c[2] / s)


def _value(c):
    return (c[0] + c[1] + c[2]) / 3


def _mean(colours):
    n = len(colours)
    return tuple(sum(c[i] for c in colours) / n for i in range(3))


def _lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def _toned(ref, tone):
    """A reference that tints its family's own colour to `tone` (under 1: a shade darker)."""
    return tuple(x / tone for x in ref)


class Family:
    """One palette family: the colours that are it (any brightness of their hue), the map it
    wears, and the colour its tint is measured from. `grey` tints by brightness alone (the
    roof's moss and lichen tones are already in its map)."""

    def __init__(self, name, slot, mats, colours, ref, grey=False):
        self.name = name
        self.slot = slot
        self.mats = frozenset(mats)
        self.swatches = [(_chroma(c), max(_value(c), 1e-3)) for c in colours]
        self.ref = tuple(max(x, 1e-3) for x in ref)
        self.grey = grey
        self.id = 0


def families(B):
    """The tavern's palette families (B is build_tavern), in the order they are tried; ids
    start at 1 (0 is a face nobody painted)."""
    import tavern_grounds as GR
    import tavern_roofing as RF
    import tavern_weather as WX

    PAL = B.PAL
    W, S, PL = B.WOOD, B.STONE, B.PLASTER
    plaster = _mean(PAL['plaster'])
    stone = _mean(PAL['stone'])
    beam = PAL['beam']
    ashlar = _mean(PAL['ashlar'])
    garnet_grey = (max(PAL['garnet']),) * 3
    fams = [
        # the limewash: the ochre panels, their inside faces, the damp and streaks and the
        # broken rims on them (darker plaster)
        Family('plaster', PLASTER, (PL,), PAL['plaster'] + PAL['plaster_in'], plaster),
        Family('damp', PLASTER, (PL,), [WX.DAMP, WX.DAMP_DARK, WX.STREAK, WX.RIM], plaster),
        # the wet foot of the stone base (a decal on it)
        Family('wet_stone', STONE, (PL,), [WX.WET_STONE], stone),
        # the garnet textiles: cushions, the stage's curtain, banners, rugs, the sign's pennant
        Family('cloth', CLOTH, (PL,), [PAL['garnet'], PAL['garnet_dark']], PAL['garnet']),
        # the boards: the hall's floor, the platform and stage decks, the hatch's reveals,
        # crates, the cart, the stable's boarding
        Family('boards', FLOOR, (W,), PAL['board'], _mean(PAL['board'])),
        # the timber: honey joinery and furniture inside, oak frames, dark oak trim, the
        # sarking under the roofs (each darker than the oak, as painted)
        Family('honey', TIMBER, (W,), PAL['honey'], _mean(PAL['honey'])),
        Family('oak', TIMBER, (W,), [beam, PAL['beam_dark'], PAL['sarking']], beam),
        # garnet-painted wood (the shutters, a shield): the timber stained red
        Family('garnet_wood', TIMBER, (W,), [PAL['garnet'], PAL['garnet_dark']], garnet_grey),
        # the wall stone: the blue-grey base and hearth, the river stones of the chimney, the
        # forecourt's cobbles
        Family('stone', STONE, (S,), PAL['stone'] + [PAL['stone_dark']], stone),
        Family('river', STONE, (S,), PAL['river'], _mean(PAL['river'])),
        Family('cobbles', STONE, (S,), GR.COBBLE, _mean(GR.COBBLE)),
        # the forecourt's dark bed under its cobbles (on the low tier, the only forecourt)
        Family('bed', STONE, (S,), [GR.BED], stone),
        # the dressed stone: the flags (a shade under the pale limestone, as they were under the
        # ashlar: worn floor stone beside the dark boards), the tower's ashlar and its mortar
        Family('flags', DRESSED, (S,), PAL['flag'], _toned(_mean(PAL['flag']), 0.75)),
        Family('ashlar', DRESSED, (S,), PAL['ashlar'] + [PAL['ashlar_hi'], PAL['ashlar_dark']], ashlar),
        Family('mortar', DRESSED, (S,), [PAL['mortar']], ashlar),
        # the roof's slates and ridge cappers
        Family('slates', ROOF, (S,), RF.SLATE + PAL['slate'] + [PAL['slate_ridge'], (0.14, 0.23, 0.19)],
               _mean(RF.SLATE), grey=True),
    ]
    # fallbacks, claimed by rule rather than by swatch (see classify)
    fams.append(Family('roof_moss', ROOF, (S,), [], _mean(RF.SLATE), grey=True))
    fams.append(Family('wood', TIMBER, (W,), [], beam))
    fams.append(Family('metal', METAL, (), [], (1, 1, 1)))
    fams.append(Family('glow', GLOW, (), [], (1, 1, 1)))
    fams.append(Family('plain', PLAIN, (), [], (1, 1, 1)))
    for i, f in enumerate(fams):
        f.id = i + 1
    return fams


class Painter:
    """Files faces under their families and paints them (one per build)."""

    def __init__(self, B):
        self.B = B
        self.fams = families(B)
        self.by_id = {f.id: f for f in self.fams}
        self.by_name = {f.name: f for f in self.fams}
        self.unset = self.by_name['plain']

    def classify(self, part, mat, color, tag):
        B = self.B
        if part in PLAIN_PARTS:
            return self.by_name['plain'].id
        if mat == B.METAL:
            return self.by_name['metal'].id
        if mat == B.GLOW:
            return self.by_name['glow'].id
        c = _chroma(color)
        v = max(_value(color), 1e-3)
        best, best_d = None, TOLERANCE
        for fam in self.fams:
            if mat not in fam.mats:
                continue
            for (sc, sv) in fam.swatches:
                ratio = v / sv
                if not 0.4 < ratio < 2.2:
                    continue
                d = math.dist(c, sc)
                if d < best_d:
                    best, best_d = fam, d
        if best is not None:
            return best.id
        r, g, b = color
        # the moss and lichen worked into the slates, and the dark wet ones (greener than blue:
        # the trough's water is not a slate)
        if mat == B.STONE and part in ROOF_PARTS and g >= r - 0.02 and g >= b and v < 0.62:
            return self.by_name['roof_moss'].id
        # any other brown wood (the grounds' timbers, ropes and tools)
        if mat == B.WOOD and r >= g >= b and 0.06 < v < 0.8 and (r - b) > 0.08:
            return self.by_name['wood'].id
        return self.by_name['plain'].id

    def piece_class(self):
        """A shiplib Piece that files each painted face under its family."""
        from shiplib import Piece

        painter = self

        class TavernPiece(Piece):
            def __init__(self, name, **kw):
                super().__init__(name, **kw)
                self.fam = self.bm.faces.layers.int.new('fam')

            def paint(self, faces, color, mat, tag=0):
                super().paint(faces, color, mat, tag)
                fam = painter.classify(self.name, mat, color, tag)
                for f in faces:
                    f[self.fam] = fam
                return faces

        return TavernPiece

    # ------------------------------------------------------------------ the paint
    def paint_faces(self, parts):
        """Every face onto its material, its colour turned to a tint over its family's
        reference (stored under the headroom), and its UVs laid. Returns the faces per material
        (for the report)."""
        counts = [0] * len(MATERIALS)
        for piece in parts.values():
            bm = piece.bm
            bm.normal_update()
            uv = bm.loops.layers.uv.verify()
            for comp in _components(bm):
                frame = None
                for f in comp:
                    fam = self.by_id.get(f[piece.fam], self.unset)
                    slot = fam.slot
                    f.material_index = slot
                    counts[slot] += 1
                    if slot not in PAINTED:
                        continue
                    for loop in f.loops:
                        tint = _tint(loop[piece.col][:3], fam)
                        loop[piece.col] = (*(c / HEADROOM for c in tint), 1.0)
                    if frame is None:
                        frame = _Frame(comp)
                    _lay_uvs(f, uv, slot, frame)
        return counts


def _tint(rgb, fam):
    if fam.grey:
        k = min(1.0, _lum(rgb) / _lum(fam.ref))
        return (k, k, k)
    t = [rgb[i] / fam.ref[i] for i in range(3)]
    return fit(t)


def fit(t):
    """A tint brought under 1 by its brightest channel, so its hue survives (a per-channel
    clamp turns a warm tint white)."""
    m = max(t)
    if m > 1.0:
        return (t[0] / m, t[1] / m, t[2] / m)
    return (max(0.0, t[0]), max(0.0, t[1]), max(0.0, t[2]))


def _components(bm):
    """The connected solids of a part (faces sharing a vertex), in face order."""
    seen = set()
    comps = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, comp = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            comp.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        comps.append(comp)
    return comps


UP = Vector((0.0, 0.0, 1.0))  # Blender's up (the game's +y)
LEVEL = Vector((1.0, 0.0, 0.0))


def _canon(a):
    """An axis turned so its largest component is positive (a stable sign)."""
    k = max(range(3), key=lambda i: abs(a[i]))
    return -a if a[k] < 0 else a


class _Frame:
    """A solid's long axis, its second axis (principal axes of its corners) and the stretch of
    the map it starts at."""

    def __init__(self, comp):
        import numpy as np

        verts = {v for f in comp for v in f.verts}
        pts = np.array([v.co[:] for v in verts], dtype=float)
        c = pts.mean(axis=0)
        x = pts - c
        w, vecs = np.linalg.eigh(x.T @ x)
        self.long = _canon(Vector(vecs[:, 2].tolist()).normalized())
        self.second = _canon(Vector(vecs[:, 1].tolist()).normalized())
        h = math.sin(round(c[0], 2) * 12.9898 + round(c[1], 2) * 78.233 + round(c[2], 2) * 37.719) * 43758.5453
        h -= math.floor(h)
        k = math.sin(round(c[0], 2) * 93.989 + round(c[1], 2) * 67.345 + round(c[2], 2) * 11.135) * 24634.6345
        k -= math.floor(k)
        self.offset = (h, k)


def _in_plane(a, n):
    u = a - n * a.dot(n)
    return u.normalized() if u.length > 1e-4 else None


def _axes(slot, n, frame):
    """The map's (u, v) directions on a face of normal n: u the map's rows (level, or down the
    grain), v = n x u, so the map is never mirrored seen from the front."""
    u = None
    if slot in GRAIN:
        for a in (frame.long, frame.second):
            if abs(a.dot(n)) < 0.7:
                u = _in_plane(a, n)
                if u is not None:
                    break
    elif abs(n.z) < 0.97:
        u = UP.cross(n).normalized()
    if u is None:
        # a level face (a floor, a rug, a tread): the map's rows along the world x
        u = _in_plane(LEVEL, n) or _in_plane(Vector((0.0, 1.0, 0.0)), n)
    return u, n.cross(u)


def _lay_uvs(f, uv, slot, frame):
    n = f.normal.normalized()
    u, v = _axes(slot, n, frame)
    k = 1.0 / yards(slot)
    ou, ov = frame.offset if slot == TIMBER else (0.0, 0.0)
    for loop in f.loops:
        p = loop.vert.co
        loop[uv].uv = (p.dot(u) * k + ou, p.dot(v) * k + ov)


# ---------------------------------------------------------------------------
# Materials (the Blender side: what the scene review renders; the glTF export carries the
# factors, build.mjs embeds the maps)
# ---------------------------------------------------------------------------
def make_materials():
    import bpy

    mats = []
    for slot, name in enumerate(MATERIALS):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        spec = CONFIG['materials'].get(name)
        if spec:
            bsdf.inputs['Roughness'].default_value = spec['roughness']
            bsdf.inputs['Metallic'].default_value = 0.0
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(os.path.join(HERE, spec['color']), check_existing=True)
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], mix.inputs[6])
            nt.links.new(attr.outputs['Color'], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            if spec.get('normal'):
                tn = nt.nodes.new('ShaderNodeTexImage')
                tn.image = bpy.data.images.load(os.path.join(HERE, spec['normal']), check_existing=True)
                tn.image.colorspace_settings.name = 'Non-Color'
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nm.inputs['Strength'].default_value = spec['normalStrength']
                nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
                nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            rough, metal, emission = PLAIN_SPECS[slot]
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
            if emission:
                nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
                bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


def show_headroom(mats):
    """For the review scene only (build_tavern.py --save, after the export): multiply each painted
    material's colour attribute by the runtime's vertex_colour_scale(), so Blender draws what the
    game draws. Never before the export: the exporter reads its vertex colours off this graph."""
    scale = vertex_colour_scale()
    for mat in mats:
        if mat.name not in CONFIG['materials']:
            continue
        nt = mat.node_tree
        attr = next(n for n in nt.nodes if n.type == 'VERTEX_COLOR')
        mix = next(n for n in nt.nodes if n.type == 'MIX')
        up = nt.nodes.new('ShaderNodeVectorMath')
        up.operation = 'SCALE'
        up.inputs['Scale'].default_value = scale
        nt.links.new(attr.outputs['Color'], up.inputs[0])
        nt.links.new(up.outputs['Vector'], mix.inputs[7])
