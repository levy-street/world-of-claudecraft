"""The Templeguard's bake surfaces: polished pearl-white nacre with a lilac and
sea-green play of colour, turquoise in every seam and ring, hairline cracks lit
cyan from inside and moon glyphs cut through the plate; white coral at the
joints (porous, turquoise in its hollows); the scallop shield's ribbed shell; the
trident's twisted coral shaft; moon silver, pearls, and a deep turquoise sea-silk
tabard with the moon on it. No rust, no barnacles, no grey."""
import numpy as np

from surface import NT, cavity, srgb

KINDS = ('coral', 'nacre', 'shell', 'trident', 'silver', 'pearl', 'silk')
GLOWS = {
    'glow_eye': ((0.72, 0.97, 1.0), 6.0, 'TempleguardEyes'),
    'glow_pearl': ((0.84, 0.97, 1.0), 6.0, 'TempleguardMoonPearl'),
    'glow_water': ((0.3, 0.86, 1.0), 2.4, 'TempleguardWater'),
    'glow_burst': ((0.45, 0.95, 1.0), 4.0, 'TempleguardDeathLight'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)


def uv_boost(obj, c):
    n = obj.name
    c = np.asarray(c)
    if n.startswith('Head'):
        return 1.7
    if 'Gauntlet' in n:
        return 1.2
    if n.startswith('Cuirass') or 'Pauldron' in n:
        return 1.2
    if n.startswith(('Heap', 'Thrown')):
        return 0.35
    if n.startswith('Trident'):
        return 1.0
    if n.startswith('Shield'):
        return 1.0
    if c[2] < 0.5:
        return 0.7
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _cracks(t, scale=5.0, amount=0.5):
    """Hairline cracks: thin voronoi seams kept only where a slow noise allows."""
    v = t.scale_vec(1.0, 1.0, 1.4)
    edge = t.voronoi(v, scale=scale, feature='DISTANCE_TO_EDGE', rnd=0.9)
    line = t.smooth(edge, 0.022, 0.006)
    keep = t.smooth(t.noise(scale=1.6, detail=3, w=4.0), 0.66 - 0.2 * amount, 0.73 - 0.2 * amount)
    fine = t.smooth(t.voronoi(t.scale_vec(1, 1, 1.4), scale=scale * 2.6, feature='DISTANCE_TO_EDGE', rnd=1.0), 0.016, 0.004)
    keep2 = t.smooth(t.noise(scale=2.4, detail=2, w=7.0), 0.66, 0.74)
    return t.math('MAXIMUM', t.math('MULTIPLY', line, keep), t.math('MULTIPLY', fine, t.math('MULTIPLY', keep, keep2)))


def _nacre(t, base_lo=(0.9, 0.81, 0.75), base_hi=(0.98, 0.9, 0.83), crack_amt=0.5, gloss=0.2):
    base = t.ramp(t.noise(scale=4.0, detail=4), [(0.3, srgb(base_lo)), (0.7, srgb(base_hi))])
    # mother-of-pearl: bands of blue-lilac, aqua and pale gold drifting over the plate
    play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=2.2, detail=3, w=1.5, dist=1.4),
                  [(0.2, srgb((1.0, 0.82, 0.85))), (0.42, srgb((1.0, 0.97, 0.93))), (0.6, srgb((0.8, 1.0, 0.94))),
                   (0.82, srgb((1.0, 0.94, 0.82)))])
    color = t.mix(0.7, base, play, 'MULTIPLY')
    # turquoise deep in the seams between the rings, pearl on the ridges
    concave = t.smooth(t.point, 0.485, 0.42)
    color = t.mix(t.math('MULTIPLY', concave, 0.85), color, srgb((0.12, 0.55, 0.56)))
    convex = t.smooth(t.point, 0.52, 0.6)
    color = t.mix(t.math('MULTIPLY', convex, 0.6), color, srgb((1.0, 0.97, 0.93)))
    cr = _cracks(t, amount=crack_amt)
    color = t.mix(cr, color, srgb((0.5, 0.97, 1.0)))
    emit = t.mix(cr, (0, 0, 0, 1), srgb(CYAN))
    rough = t.math('ADD', gloss, t.math('MULTIPLY', t.noise(scale=9, detail=2), 0.12))
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=45, detail=2), 0.15), t.math('MULTIPLY', cr, -0.6))
    return color, emit, rough, h


def shade(mat, k):
    t = NT(mat)
    if k == 'coral':
        # white coral: porous, each pore a polyp cup; turquoise deep in the hollows
        v = t.scale_vec(1, 1, 1)
        pore = t.voronoi(v, scale=38.0, feature='F1')
        cup = t.smooth(pore, 0.22, 0.08)
        # pale turquoise coral, white at the tips of its branches, deep teal in its pores
        base = t.ramp(t.noise(scale=3.0, detail=4), [(0.3, srgb((0.36, 0.72, 0.74))), (0.7, srgb((0.52, 0.82, 0.82)))])
        tips = t.smooth(t.point, 0.53, 0.62)
        color = t.mix(t.math('MULTIPLY', tips, 0.8), base, srgb((0.9, 0.95, 0.94)))
        hollow = t.smooth(t.point, 0.49, 0.42)
        color = t.mix(t.math('MULTIPLY', hollow, 0.9), color, srgb((0.03, 0.32, 0.38)))
        color = t.mix(t.math('MULTIPLY', cup, 0.6), color, srgb((0.08, 0.4, 0.46)))
        color = cavity(t, color, dark=0.55, light=1.08)
        glow = t.math('MULTIPLY', t.smooth(t.point, 0.44, 0.38), 0.35)
        emit = t.mix(glow, (0, 0, 0, 1), srgb((0.1, 0.5, 0.6)))
        rough = t.math('ADD', 0.62, t.math('MULTIPLY', cup, 0.2))
        h = t.math('ADD', t.math('MULTIPLY', cup, -0.8), t.math('MULTIPLY', t.noise(scale=30, detail=3), 0.4))
        t.finish(color, rough, 0.0, t.bump(h, 0.4, 0.006), emit=emit)
    elif k == 'nacre':
        color, emit, rough, h = _nacre(t)
        glyph = _attr(t, 'RegGlyph')
        inlay = t.smooth(_attr(t, 'RegInlay'), 0.2, 0.7)
        color = t.mix(inlay, color, srgb((0.06, 0.42, 0.46)))
        emit = t.mix(t.math('MULTIPLY', inlay, 0.25), emit, srgb((0.2, 0.75, 0.8)))
        h = t.math('ADD', h, t.math('MULTIPLY', inlay, -0.5))
        color = t.mix(glyph, color, srgb((0.62, 0.98, 1.0)))
        emit = t.mix(glyph, emit, srgb((0.4, 0.95, 1.0)))
        h = t.math('ADD', h, t.math('MULTIPLY', glyph, -0.6))
        color = cavity(t, color, dark=0.6, light=1.06)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.005), emit=emit)
    elif k == 'shell':
        rib = _attr(t, 'RegRib')
        rad = _attr(t, 'RegRad')
        color, emit, rough, h = _nacre(t, (0.9, 0.83, 0.77), (0.98, 0.92, 0.85), crack_amt=0.25, gloss=0.25)
        # turquoise in the grooves between the ribs, deepening toward the hinge
        groove = t.smooth(rib, 0.45, 0.1)
        color = t.mix(t.math('MULTIPLY', groove, 0.75), color, srgb((0.1, 0.5, 0.56)))
        # growth bands across the fan
        band = t.smooth(t.math('SINE', t.math('MULTIPLY', rad, 44.0)), 0.6, 0.95)
        color = t.mix(t.math('MULTIPLY', band, 0.3), color, srgb((0.62, 0.84, 0.86)))
        hinge = t.smooth(rad, 0.3, 0.05)
        color = t.mix(t.math('MULTIPLY', hinge, 0.6), color, srgb((0.1, 0.42, 0.5)))
        rim = t.smooth(rad, 0.9, 0.99)
        color = t.mix(t.math('MULTIPLY', rim, 0.7), color, srgb((0.86, 0.86, 1.0)))
        color = cavity(t, color, dark=0.55, light=1.08)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004), emit=emit)
    elif k == 'trident':
        cor = t.smooth(_attr(t, 'RegCoral'), 0.2, 0.8)
        color, emit, rough, h = _nacre(t, crack_amt=0.2, gloss=0.16)
        twist = t.ramp(t.noise(scale=20, detail=3), [(0.3, srgb((0.86, 0.92, 0.91))), (0.7, srgb((0.97, 0.98, 0.97)))])
        hollow = t.smooth(t.point, 0.49, 0.42)
        cc = t.mix(t.math('MULTIPLY', hollow, 0.9), twist, srgb((0.08, 0.48, 0.54)))
        color = t.mix(cor, color, cc)
        emit = t.mix(cor, emit, (0, 0, 0, 1))
        rough = t.fmix(cor, rough, 0.55)
        color = cavity(t, color, dark=0.55, light=1.08)
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.004), emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.8, 0.84, 0.9))), (0.7, srgb((0.92, 0.94, 0.98)))])
        color = cavity(t, base, dark=0.55, light=1.06)
        rough = t.math('ADD', 0.3, t.math('MULTIPLY', t.noise(scale=12, detail=2), 0.12))
        t.finish(color, rough, 0.35, t.bump(t.noise(scale=80, detail=2), 0.08, 0.002))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.9, 0.89, 0.95))), (0.7, srgb((0.86, 0.95, 0.95)))])
        t.finish(base, 0.12, 0.0)
    elif k == 'silk':
        glyph = _attr(t, 'RegGlyph')
        hem = _attr(t, 'RegHem')
        weave = t.noise(t.scale_vec(160, 160, 160), scale=1.0, detail=2)
        base = t.ramp(t.noise(scale=2.5, detail=4), [(0.3, srgb((0.03, 0.24, 0.3))), (0.7, srgb((0.06, 0.36, 0.42)))])
        sheen = t.smooth(t.noise(t.scale_vec(4, 4, 0.8), scale=1.0, detail=2), 0.55, 0.75)
        base = t.mix(t.math('MULTIPLY', sheen, 0.4), base, srgb((0.18, 0.55, 0.6)))
        color = t.mix(hem, base, srgb((0.82, 0.86, 0.92)))
        color = t.mix(glyph, color, srgb((0.86, 0.94, 1.0)))
        emit = t.mix(t.math('MULTIPLY', glyph, 0.35), (0, 0, 0, 1), srgb((0.5, 0.9, 1.0)))
        color = cavity(t, color, dark=0.5, light=1.1)
        rough = t.fmix(t.math('MAXIMUM', glyph, hem), 0.48, 0.3)
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.4), t.math('MULTIPLY', t.math('MAXIMUM', glyph, hem), 0.5))
        t.finish(color, rough, t.math('MULTIPLY', hem, 0.5), t.bump(h, 0.3, 0.003), emit=emit)
    else:
        raise ValueError(k)
    return mat
