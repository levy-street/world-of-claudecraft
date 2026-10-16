"""The Highwatch manor's painted surfaces: the hand-painted tiling maps of the painted Tidehold
town in Highwatch's Alpine slate look, the look the painted Highwatch buildings wear, laid on
the manor's own geometry by the Mirefen tavern's method (scripts/assets/mirefen_tavern/
tavern_texture.py). build_manor.py builds its parts as ManorPiece and calls paint_faces() before
the warm bake and the weathering.

  textures.json   the maps each painted material wears (unchanged copies in tex/: the harbour
                  colour set, the square slate pattern layout in that palette, and the default
                  set's neutral prop cloth), their repeat in yards (the town kit's own,
                  bl_town_lib.py K), roughness and normal strength, and the vertex colours'
                  headroom
  families()      the manor's palette families and the map each wears: the sage plaster outside
                  and the pale plaster inside the limewash; the oak, the dark frames, the dark oak
                  trim, the walnut and the sarking the timber, the blue shutters the timber
                  stained blue; the boards the floor; every stone (the coursed blocks and their
                  mortar, the dressed trims, the inner face of the stone storey, the flags) the
                  dressed granite, jointless, since the manor models its stone block by block;
                  the slates the square slate; the furnishings' textiles (the hold's blue, the
                  garnet, the linen, the sacks) the woven cloth

Every face is filed under its family when it is painted (ManorPiece.paint), from the part, the
material and the colour the builders give it, never face by face, so nothing in the builders
changes and flush faces of one material and one colour wear the same map and the same tint. A
colour no family claims (the lawn, the hedges, the flowers, the water, the soil, the food, the
books, the parchment, the candles and the antlers, the gilding on wood, the paintings, the
chimney pots) stays as it was on the plain untextured material (ManorPlain), and the metal, the
glass and the glows keep their own.

On a painted face the vertex colour becomes a tint over the map: the face's colour over its
family's reference colour, so the per-face tones, the dark frames and the blue shutters stay,
and the warm light and the weathering baked in afterwards land on top of the paint. The tint is
stored under textures.json's headroom (divided by it), so the light can lift the paint above
the map itself instead of only shifting its hue; the runtime multiplies the colour back
(vertex_colour_scale(), written by build.mjs into each painted material's extras). The cloth's
map is a neutral grey, so its family is measured from that grey and every textile keeps its own
colour under the weave.

UVs are planar per face at the kit's texel density: plaster, dressed stone, cloth and the slates
laid level (folds and slate rows run level, continuous across neighbouring faces), timber and
boards along their length (the grain runs down a beam; each timber starts its own stretch of the
map, from a stable hash of where it stands, so neighbours never repeat).
"""
import json
import math
import os

from mathutils import Vector

import manor_lib as L

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'textures.json'), encoding='utf8') as fh:
    CONFIG = json.load(fh)

# The material slots. The builders' thirteen keep their indices (manor_lib WOOD .. GLOW_CANDLE:
# shiplib's finish() reads GLOW at 4, the bakes read the emissive ones and the slate), so the
# wood, stone, plaster and slate slots are now painted ones (the stone the dressed granite); the
# painted floor and cloth and the plain one follow.
MATERIALS = ('ManorTimber', 'ManorMetal', 'ManorDressed', 'ManorPlaster', 'ManorGlow', 'ManorSlate',
             'ManorGlass', 'ManorGlassBlue', 'ManorGlassRed', 'ManorGlassGold', 'ManorGlowSoft',
             'ManorGlowLantern', 'ManorGlowCandle', 'ManorFloor', 'ManorCloth', 'ManorPlain')
TIMBER, DRESSED, PLASTER, SLATE = L.WOOD, L.STONE, L.PLASTER, L.SLATE
FLOOR, CLOTH, PLAIN = range(13, len(MATERIALS))
PAINTED = frozenset((TIMBER, DRESSED, PLASTER, SLATE, FLOOR, CLOTH))
# grain: the map's long axis runs down the solid (a beam, a board)
GRAIN = frozenset((TIMBER, FLOOR))
# the builders' materials a face keeps as it was: the metal, the glass and the glows
KEEP = frozenset((L.METAL,) + tuple(L.EMISSIVE))

# (roughness, metallic, emission strength, emission colour) of the materials that wear no map. A
# glTF material's emission cannot read the vertex colours, so each glowing material carries its
# own emission colour: the warm amber of lamplight behind glass and of candle flames, and a faint
# warm light through the coloured glass (whose colours are its vertex colours, lit by the room).
# The runtime lifts a weak emission to its bloom floor (render/eastbrook_placed_building.ts), so
# the colours here set the hue and the balance.
PLAIN_SPECS = {
    L.METAL: (0.42, 0.6, 0.0, None),
    L.GLOW: (0.5, 0.0, 1.0, (0.62, 0.34, 0.1)),
    L.GLASS: (0.3, 0.0, 1.0, (0.2, 0.15, 0.09)),
    # the stained glass's colours, lit from the room behind them at night
    L.GLASS_BLUE: (0.3, 0.0, 1.0, (0.08, 0.14, 0.42)),
    L.GLASS_RED: (0.3, 0.0, 1.0, (0.42, 0.06, 0.07)),
    L.GLASS_GOLD: (0.3, 0.0, 1.0, (0.6, 0.4, 0.1)),
    # honey lamplight (alternate windows), the brighter lanterns, the soft candle flames
    L.GLOW_SOFT: (0.5, 0.0, 1.0, (0.66, 0.46, 0.18)),
    L.GLOW_LANTERN: (0.5, 0.0, 1.0, (0.86, 0.5, 0.14)),
    L.GLOW_CANDLE: (0.5, 0.0, 1.0, (0.78, 0.6, 0.24)),
    PLAIN: (0.9, 0.0, 0.0, None),
}

# the parts whose blue and garnet on wood are textiles (rugs, banners, cushions, cloths); on
# every other part they are paint on wood (the shutters)
CLOTH_PARTS = frozenset(('G_INT_Furnishings',))

# how far (in chromaticity) a colour may sit from a family's swatch and still be one of it
TOLERANCE = 0.012

# a painted face's colour is stored divided by this (textures.json): room above the map for the
# warm light, which lifts a colour up to 1.5 times near a flame (build_manor.bake_warm_light)
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
    wears (`slot`; None keeps the builder's own material), and the colour its tint is measured
    from. `grey` tints by brightness alone (the slates' blue is in their map). `parts` limits
    it to those parts, `not_parts` keeps it off them; `tolerance` narrows how near a colour
    must sit to a swatch (TOLERANCE by default)."""

    def __init__(self, name, slot, mats, colours, ref, grey=False, parts=None, not_parts=(),
                 tolerance=None):
        self.name = name
        self.slot = slot
        self.mats = frozenset(mats)
        self.swatches = [(_chroma(c), max(_value(c), 1e-3)) for c in colours]
        self.ref = tuple(max(x, 1e-3) for x in ref)
        self.grey = grey
        self.parts = None if parts is None else frozenset(parts)
        self.not_parts = frozenset(not_parts)
        self.tolerance = TOLERANCE if tolerance is None else tolerance
        self.id = 0

    def fits(self, part):
        return (self.parts is None or part in self.parts) and part not in self.not_parts


def families():
    """The manor's palette families (manor_lib.PAL), in the order they are tried; ids start at 1
    (0 is a face nobody painted)."""
    PAL = L.PAL
    W, S, PL, SL = L.WOOD, L.STONE, L.PLASTER, L.SLATE
    cloth_grey = (CONFIG['materials']['ManorCloth']['neutral'],) * 3
    fams = [
        # the limewash: the sage panels outside at the map's own level, and the plaster of the
        # rooms, measured from the same sage, a warmer cast of it under the warm light
        Family('plaster', PLASTER, (PL,), PAL['plaster'] + PAL['plaster_in'], _mean(PAL['plaster'])),
        # the boards: the floors of the wings, the bay and the porch, a crate
        Family('boards', FLOOR, (W,), PAL['board'], _mean(PAL['board'])),
        # the timber: the oak joinery, trusses and furniture inside at the map's own level, and
        # darker than the oak as painted: the dark frames, posts, rails and braces outside, the
        # dark oak trim, the walnut and the sarking under the roofs
        Family('timber', TIMBER, (W,), PAL['oak'] + [PAL['oak_dark'], PAL['timber'], PAL['timber_dark'],
                                                     PAL['walnut'], PAL['sarking']], _mean(PAL['oak'])),
        # the furnishings' textiles (rugs, banners, cushions, shields, the table cloths, the sacks),
        # each in its own colour on the neutral woven map; held to their own swatches, so the
        # cream of the candles and the antlers (a hair from the linen's hue) stays plain
        Family('cloth', CLOTH, (W,), [PAL['blue'], PAL['blue_dark'], PAL['garnet'], PAL['garnet_dark'],
                                      PAL['linen'], PAL['sack']], cloth_grey, parts=CLOTH_PARTS,
               tolerance=0.004),
        # blue-painted wood (the shutters): the timber stained the hold's blue
        Family('blue_wood', TIMBER, (W,), [PAL['blue'], PAL['blue_dark']], (max(PAL['blue']),) * 3,
               not_parts=CLOTH_PARTS),
        # the ashlar: the coursed blocks of the plinths, the garden wall, the chimneys and the
        # piers, and the mortar between them, a shade under the dressed granite (the painted
        # buildings' wall stone sits there)
        Family('ashlar', DRESSED, (S,), PAL['ashlar'] + [PAL['mortar']], _toned(_mean(PAL['ashlar']), 0.75)),
        # the dressed trims: copings, quoins, voussoirs, surrounds, steps, kerbs and the stone
        # storey's inner face at the granite's own level, and the sills darker
        Family('dressed', DRESSED, (S,), [PAL['ashlar_hi'], PAL['stone_dark']], PAL['ashlar_hi']),
        # the flags: a little under the dressed granite, worn floor stone
        Family('flags', DRESSED, (S,), PAL['flag'], _toned(_mean(PAL['flag']), 0.9)),
        # the slates and the ridge cappers (and the slate caps on the garden wall's piers)
        Family('slates', SLATE, (SL, S), PAL['slate'] + [PAL['slate_ridge']], _mean(PAL['slate']),
               grey=True),
    ]
    # claimed by rule rather than by swatch (see classify)
    fams.append(Family('roof', SLATE, (SL,), [], _mean(PAL['slate']), grey=True))
    fams.append(Family('keep', None, (), [], (1, 1, 1)))
    fams.append(Family('plain', PLAIN, (), [], (1, 1, 1)))
    for i, f in enumerate(fams):
        f.id = i + 1
    return fams


class Painter:
    """Files faces under their families and paints them (one per build)."""

    def __init__(self):
        self.fams = families()
        self.by_id = {f.id: f for f in self.fams}
        self.by_name = {f.name: f for f in self.fams}
        self.unset = self.by_name['plain']

    def classify(self, part, mat, color):
        if mat in KEEP:
            return self.by_name['keep'].id
        c = _chroma(color)
        v = max(_value(color), 1e-3)
        best, best_d = None, math.inf
        for fam in self.fams:
            if mat not in fam.mats or not fam.fits(part):
                continue
            for (sc, sv) in fam.swatches:
                ratio = v / sv
                if not 0.4 < ratio < 2.2:
                    continue
                d = math.dist(c, sc)
                if d < fam.tolerance and d < best_d:
                    best, best_d = fam, d
        if best is not None:
            return best.id
        # a slate of any other colour is still the roof
        if mat == L.SLATE:
            return self.by_name['roof'].id
        return self.by_name['plain'].id

    def piece_class(self):
        """A shiplib Piece that files each painted face under its family and remembers the
        builder's own material (the bakes read it)."""
        from shiplib import Piece

        painter = self

        class ManorPiece(Piece):
            def __init__(self, name, **kw):
                super().__init__(name, **kw)
                self.fam = self.bm.faces.layers.int.new('fam')
                self.src = self.bm.faces.layers.int.new('src')

            def paint(self, faces, color, mat, tag=0):
                super().paint(faces, color, mat, tag)
                fam = painter.classify(self.name, mat, color)
                for f in faces:
                    f[self.fam] = fam
                    f[self.src] = mat
                return faces

        return ManorPiece

    def family_of(self, piece, face):
        return self.by_id.get(face[piece.fam], self.unset)

    def source_material(self, piece, face):
        """The material the builders gave a face (the weathering reads it: moss grows on the
        stone, the sun bleaches the slates, whatever map the face now wears)."""
        return face[piece.src]

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
                    fam = self.family_of(piece, f)
                    slot = fam.slot if fam.slot is not None else f[piece.src]
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

    def to_paint(self, piece, face, rgb):
        """An absolute colour (a weathering's grime, moss or sun) in a face's stored colour: on a
        painted face, over its family's reference and under the headroom (grey on a grey family),
        so a mix toward it weathers the paint as it weathered the palette; as it is elsewhere."""
        if face.material_index not in PAINTED:
            return rgb
        fam = self.family_of(piece, face)
        if fam.grey:
            k = _lum(rgb) / _lum(fam.ref) / HEADROOM
            return (k, k, k)
        return tuple(rgb[i] / fam.ref[i] / HEADROOM for i in range(3))

    def store(self, face, rgb):
        """A baked colour back into a face's corner: on a painted face brought under 1 by its
        brightest channel (warm stays warm), elsewhere clamped per channel as the palette was."""
        if face.material_index in PAINTED:
            rgb = fit(rgb)
        return (min(1.0, max(0.0, rgb[0])), min(1.0, max(0.0, rgb[1])), min(1.0, max(0.0, rgb[2])))


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
            rough, metal, emission, glow = PLAIN_SPECS[slot]
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
            if emission:
                bsdf.inputs['Emission Color'].default_value = (*glow, 1.0)
                bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


def show_headroom(mats):
    """For the review scene only (build_manor.py --save or --render, after the export): multiply
    each painted material's colour attribute by the runtime's vertex_colour_scale(), so Blender
    draws what the game draws. Never before the export: the exporter reads its vertex colours off
    this graph."""
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
