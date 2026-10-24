"""The Acolyte's bake surfaces. Nothing here is alpha-blended (the game draws
creature GLBs opaque): every translucency is faked with colour and emission.

  bell      milky moon jelly lit from within: a cool white glow brightest on
            the dome, the four nacre-pink rings and the cyan canals and sense
            spots glowing through it; its underside a deep luminous teal
  skin      pale moonlit skin with a cool pearl sheen, faint rose on the cheeks
            and lips, a lilac shadow on the closed lids, a dark lash line
  nacre     carved pearl-white nacre with rose and aqua play, a moon glyph lit cyan
  silk      milky sea-silk with a lavender-cyan sheen; the tentacles' light seen
            through it as faint threads; a glowing hem
  veil      the same silk, sheerer: paler, cooler, more of the light through it
  frill     the oral arms: pearl-white ruffles going rose and glowing at the edges
  tentacle  milky jelly strands going cyan and glowing toward their tips
  silver    moon silver; pearl
No rust, no barnacles, no grey fog."""
import numpy as np

from surface import NT, cavity, srgb

KINDS = ('skin', 'bell', 'nacre', 'silk', 'veil', 'frill', 'tentacle', 'silver', 'pearl')
GLOWS = {
    'glow_dart': ((0.62, 0.96, 1.0), 6.0, 'AcolyteFrostDart'),
    'glow_light': ((0.82, 1.0, 1.0), 7.0, 'AcolyteMendLight'),
    'glow_mend': ((0.36, 0.92, 1.0), 4.0, 'AcolyteMendRings'),
    'glow_pool': ((0.32, 0.78, 0.95), 1.6, 'AcolytePool'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)
RING = (1.0, 0.68, 0.86)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith('Head'):
        return 2.4
    if n.startswith(('L_Hand', 'R_Hand')):
        return 1.3
    if n.startswith(('Circlet', 'BrowPearl', 'Pendant')):
        return 1.4
    if n.startswith('Bell'):
        return 1.15
    if n.startswith('Bodice'):
        return 1.3
    if n.startswith('Veil'):
        return 0.55
    if n.startswith('Skirt'):
        return 0.75
    if n.startswith('Tentacles'):
        return 0.45
    if n.startswith('Frills'):
        return 0.8
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def shade(mat, k):
    t = NT(mat)
    if k == 'skin':
        lip = t.smooth(_attr(t, 'RegLip'), 0.05, 0.6)
        lash = _attr(t, 'RegLash')
        brow = _attr(t, 'RegBrow')
        lid = t.smooth(_attr(t, 'RegLid'), 0.0, 0.8)
        cheek = _attr(t, 'RegCheek')
        base = t.ramp(t.noise(scale=6.0, detail=3), [(0.3, srgb((0.86, 0.9, 0.95))), (0.7, srgb((0.93, 0.95, 0.98)))])
        # a pearly sheen drifting over the skin: the water's change
        play = t.ramp(t.noise(t.scale_vec(1, 1, 2.5), scale=2.5, detail=2, w=3.0),
                      [(0.3, srgb((0.96, 0.92, 1.0))), (0.55, srgb((1.0, 1.0, 1.0))), (0.8, srgb((0.9, 1.0, 0.99)))])
        color = t.mix(0.6, base, play, 'MULTIPLY')
        color = t.mix(t.math('MULTIPLY', cheek, 0.35), color, srgb((0.98, 0.8, 0.86)))
        color = t.mix(t.math('MULTIPLY', lid, 0.55), color, srgb((0.7, 0.68, 0.9)))
        color = t.mix(lip, color, srgb((0.86, 0.52, 0.66)))
        color = t.mix(brow, color, srgb((0.5, 0.56, 0.72)))
        color = t.mix(lash, color, srgb((0.06, 0.07, 0.16)))
        color = cavity(t, color, dark=0.72, light=1.04)
        # moonlight under the skin, never on the lash line
        emit = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, lash), 0.06), (0, 0, 0, 1), srgb((0.75, 0.9, 1.0)))
        rough = t.math('ADD', t.fmix(lip, 0.48, 0.3), t.math('MULTIPLY', t.noise(scale=30, detail=2), 0.06))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=120, detail=2), 0.1), t.math('MULTIPLY', lash, -0.4))
        t.finish(color, rough, 0.0, t.bump(h, 0.2, 0.0015), emit=emit)
    elif k == 'bell':
        ring = t.smooth(_attr(t, 'RegRing'), 0.05, 0.75)
        canal = t.smooth(_attr(t, 'RegCanal'), 0.1, 0.8)
        rhop = _attr(t, 'RegRhop')
        inner = _attr(t, 'RegIn')
        top = _attr(t, 'RegTop')
        # milky jelly: cooler and clearer toward the margin, whiter on the dome
        jelly = t.ramp(top, [(0.0, srgb((0.72, 0.88, 0.95))), (0.45, srgb((0.9, 0.95, 0.99))),
                             (1.0, srgb((0.97, 0.98, 1.0)))])
        cloud = t.smooth(t.noise(scale=3.5, detail=4, w=2.0), 0.35, 0.75)
        jelly = t.mix(t.math('MULTIPLY', cloud, 0.25), jelly, srgb((0.98, 0.98, 1.0)))
        # the deep glowing teal of the underside
        color = t.mix(inner, jelly, srgb((0.12, 0.42, 0.52)))
        color = t.mix(t.math('MULTIPLY', canal, 0.45), color, srgb((0.6, 0.94, 1.0)))
        color = t.mix(ring, color, srgb(RING))
        color = t.mix(rhop, color, srgb((0.7, 1.0, 1.0)))
        # milky light from within: a soft cloud of glow through the whole dome
        glow = t.mix(t.math('MULTIPLY', top, 0.5), srgb((0.3, 0.42, 0.5)), srgb((0.5, 0.56, 0.62)))
        glow = t.mix(t.math('MULTIPLY', cloud, 0.4), glow, srgb((0.62, 0.66, 0.72)))
        glow = t.mix(inner, glow, srgb((0.06, 0.32, 0.42)))
        glow = t.mix(t.math('MULTIPLY', canal, 0.35), glow, srgb(CYAN))
        glow = t.mix(ring, glow, srgb((1.0, 0.5, 0.82)))
        glow = t.mix(rhop, glow, srgb((0.8, 1.0, 1.0)))
        rough = t.fmix(inner, 0.14, 0.3)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=26, detail=2), 0.12), t.math('MULTIPLY', ring, 0.25))
        t.finish(color, rough, 0.0, t.bump(h, 0.15, 0.003), emit=glow)
    elif k == 'nacre':
        glyph = _attr(t, 'RegGlyph')
        band = _attr(t, 'RegBand')
        base = t.ramp(t.noise(scale=5.0, detail=4), [(0.3, srgb((0.9, 0.86, 0.88))), (0.7, srgb((0.98, 0.95, 0.96)))])
        play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                      [(0.2, srgb((1.0, 0.84, 0.9))), (0.42, srgb((1.0, 0.98, 0.97))), (0.62, srgb((0.82, 1.0, 0.97))),
                       (0.85, srgb((0.9, 0.9, 1.0)))])
        color = t.mix(0.7, base, play, 'MULTIPLY')
        concave = t.smooth(t.point, 0.485, 0.42)
        color = t.mix(t.math('MULTIPLY', concave, 0.8), color, srgb((0.3, 0.6, 0.7)))
        color = t.mix(band, color, srgb((0.88, 0.9, 0.96)))
        color = t.mix(glyph, color, srgb((0.62, 0.98, 1.0)))
        emit = t.mix(glyph, (0, 0, 0, 1), srgb((0.4, 0.95, 1.0)))
        color = cavity(t, color, dark=0.6, light=1.06)
        rough = t.math('ADD', 0.2, t.math('MULTIPLY', t.noise(scale=9, detail=2), 0.1))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=45, detail=2), 0.12), t.math('MULTIPLY', glyph, -0.6))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.003), emit=emit)
    elif k in ('silk', 'veil'):
        hem = _attr(t, 'RegHem')
        thread = _attr(t, 'RegThread')
        z = _attr(t, 'RegZ')
        sheer = k == 'veil'
        # pale moon silk at the waist deepening to the sea's own blue-violet at
        # the hem: the body above reads against it, and the jelly's light glows
        # through it as threads
        if sheer:
            top_lo, top_hi = (0.5, 0.64, 0.84), (0.64, 0.78, 0.92)
            deep = (0.16, 0.3, 0.55)
        else:
            top_lo, top_hi = (0.74, 0.74, 0.9), (0.88, 0.88, 0.97)
            deep = (0.2, 0.26, 0.55)
        base = t.ramp(t.noise(t.scale_vec(3, 3, 0.6), scale=1.5, detail=3), [(0.3, srgb(top_lo)), (0.7, srgb(top_hi))])
        crest = t.smooth(t.point, 0.51, 0.58)
        hollow = t.smooth(t.point, 0.49, 0.43)
        color = t.mix(t.math('MULTIPLY', hollow, 0.55), base, srgb((0.36, 0.4, 0.7)))
        color = t.mix(t.math('MULTIPLY', crest, 0.3), color, srgb((0.86, 0.96, 1.0)))
        low = t.smooth(z, 0.7 if not sheer else 0.85, 0.15)
        color = t.mix(t.math('MULTIPLY', low, 0.85), color, srgb(deep))
        color = t.mix(t.math('MULTIPLY', thread, t.math('ADD', 0.2, t.math('MULTIPLY', low, 0.5))), color,
                      srgb((0.5, 0.9, 1.0)))
        color = t.mix(hem, color, srgb((0.82, 0.96, 1.0)))
        emit = t.mix(t.math('MULTIPLY', thread, t.math('MULTIPLY', low, 0.4)), (0, 0, 0, 1), srgb((0.25, 0.75, 0.95)))
        emit = t.mix(t.math('MULTIPLY', hem, 0.55), emit, srgb((0.4, 0.9, 1.0)))
        weave = t.noise(t.scale_vec(220, 220, 220), scale=1.0, detail=1)
        rough = t.math('ADD', 0.42, t.math('MULTIPLY', crest, -0.12))
        h = t.math('ADD', t.math('MULTIPLY', weave, 0.25), t.math('MULTIPLY', hem, 0.3))
        t.finish(color, rough, 0.0, t.bump(h, 0.15, 0.002), emit=emit)
    elif k == 'frill':
        edge = t.smooth(_attr(t, 'RegEdge'), 0.0, 0.9)
        z = _attr(t, 'RegZ')
        base = t.ramp(t.noise(scale=4.0, detail=3), [(0.3, srgb((0.8, 0.72, 0.9))), (0.7, srgb((0.92, 0.84, 0.96)))])
        color = t.mix(t.math('MULTIPLY', edge, 0.8), base, srgb((0.98, 0.7, 0.86)))
        hollow = t.smooth(t.point, 0.49, 0.42)
        color = t.mix(t.math('MULTIPLY', hollow, 0.5), color, srgb((0.4, 0.5, 0.78)))
        color = t.mix(t.math('MULTIPLY', t.smooth(z, 0.7, 0.1), 0.7), color, srgb((0.3, 0.42, 0.7)))
        emit = t.mix(t.math('MULTIPLY', edge, 0.55), (0, 0, 0, 1), srgb((1.0, 0.6, 0.85)))
        emit = t.mix(t.math('MULTIPLY', t.smooth(t.noise(scale=18, detail=1), 0.62, 0.7), 0.4), emit, srgb(CYAN))
        rough = t.fmix(edge, 0.36, 0.24)
        t.finish(color, rough, 0.0, t.bump(t.noise(scale=60, detail=2), 0.12, 0.002), emit=emit)
    elif k == 'tentacle':
        tz = _attr(t, 'RegT')
        base = t.ramp(tz, [(0.0, srgb((0.78, 0.88, 0.98))), (0.5, srgb((0.4, 0.62, 0.88))),
                           (1.0, srgb((0.36, 0.8, 0.96)))])
        # the stinging cells: a beading of brighter dots down each strand
        beads = t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 60.0)), 0.7, 0.95)
        color = t.mix(t.math('MULTIPLY', beads, 0.4), base, srgb((0.95, 1.0, 1.0)))
        emit = t.mix(t.math('ADD', t.math('MULTIPLY', tz, 0.3), t.math('MULTIPLY', beads, 0.25)), (0, 0, 0, 1),
                     srgb(CYAN))
        t.finish(color, 0.2, 0.0, None, emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.6, light=1.06)
        rough = t.math('ADD', 0.26, t.math('MULTIPLY', t.noise(scale=12, detail=2), 0.1))
        t.finish(color, rough, 0.5, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.94, 0.9, 0.96))), (0.7, srgb((0.88, 0.97, 0.98)))])
        t.finish(base, 0.12, 0.0, None, emit=srgb((0.25, 0.3, 0.35)))
    else:
        raise ValueError(k)
    return mat
