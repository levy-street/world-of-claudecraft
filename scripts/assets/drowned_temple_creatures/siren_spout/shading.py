"""The Siren's bake surfaces. Nothing here is alpha-blended (the game draws
creature GLBs opaque): every translucency is faked with colour and emission.

  skin     pale moonlit skin with a cool pearl sheen; fine nacre scales over
           the shoulders and flanks; narrow eyes whose slit glows moonlight;
           pale violet lips
  hair     long silver hair with a violet and aqua sheen, its tips turning to
           sea-glass light
  fin      sheer turquoise fin going violet at the tips, silver rays
  scales   the fish tail: small overlapping scales of turquoise nacre, a pearl
           belly, a violet blush low down; the fluke a sheer fin like the others
  nacre    carved pearl-white nacre with rose and aqua play, a moon glyph lit cyan
  water    the waterspout: clear moonlit sea-water lit from inside, its edges
           cresting into white foam
  coral    white coral with fine pores; silver bands
  silver   moon silver; pearl
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('skin', 'hair', 'fin', 'scales', 'nacre', 'water', 'coral', 'silver', 'pearl')
GLOWS = {
    'glow_pearl': ((0.8, 0.72, 1.0), 2.6, 'SirenMoonPearl'),
    'glow_flare': ((0.62, 0.92, 1.0), 6.0, 'SirenPearlFlare'),
    'glow_bubble': ((0.5, 0.92, 1.0), 2.4, 'SirenTideBubble'),
    'glow_pool': ((0.3, 0.74, 0.92), 1.4, 'SirenPool'),
    'glow_foam': ((0.82, 0.98, 1.0), 2.4, 'SirenFoam'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith('Head'):
        return 2.4
    if n.startswith(('L_Hand', 'R_Hand')):
        return 1.3
    if n.startswith(('Crown', 'Collar', 'Pendant', 'Girdle')):
        return 1.2
    if n.startswith('Bodice'):
        return 1.3
    if n.startswith(('HairCap', 'Fins')):
        return 1.2
    if n.startswith('Hair'):
        return 0.6
    if n.startswith('Tail'):
        return 1.0
    if n.startswith('VeilFins'):
        return 0.6
    if n.startswith('Spout'):
        return 0.5
    if n.startswith('Staff'):
        return 0.9
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _scales(t, scale):
    """A field of small overlapping scales: 0 in a scale's middle, 1 on its rim."""
    edge = t.voronoi(t.scale_vec(1.0, 1.0, 1.6), scale=scale, feature='DISTANCE_TO_EDGE')
    return t.smooth(edge, 0.08, 0.0)


def shade(mat, k):
    t = NT(mat)
    if k == 'skin':
        lip = t.smooth(_attr(t, 'RegLip'), 0.05, 0.6)
        lash = _attr(t, 'RegLash')
        brow = _attr(t, 'RegBrow')
        lid = t.smooth(_attr(t, 'RegLid'), 0.0, 0.8)
        cheek = _attr(t, 'RegCheek')
        sc = t.smooth(_attr(t, 'RegScale'), 0.05, 0.6)
        base = t.ramp(t.noise(scale=6.0, detail=3), [(0.3, srgb((0.82, 0.88, 0.95))), (0.7, srgb((0.9, 0.94, 0.98)))])
        play = t.ramp(t.noise(t.scale_vec(1, 1, 2.5), scale=2.5, detail=2, w=3.0),
                      [(0.3, srgb((0.94, 0.92, 1.0))), (0.55, srgb((1.0, 1.0, 1.0))), (0.8, srgb((0.88, 1.0, 0.99)))])
        color = t.mix(0.6, base, play, 'MULTIPLY')
        # the scales: rims of aqua nacre, centres catching violet and pearl
        rim = _scales(t, 70.0)
        sheen = t.ramp(t.noise(scale=9.0, detail=2, w=1.0),
                       [(0.3, srgb((0.62, 0.9, 0.95))), (0.55, srgb((0.86, 0.84, 1.0))), (0.8, srgb((0.7, 0.95, 0.92)))])
        scaled = t.mix(t.math('MULTIPLY', rim, 0.7), sheen, srgb((0.36, 0.62, 0.72)))
        color = t.mix(t.math('MULTIPLY', sc, 0.85), color, scaled)
        color = t.mix(t.math('MULTIPLY', cheek, 0.25), color, srgb((0.9, 0.82, 0.96)))
        color = t.mix(t.math('MULTIPLY', lid, 0.6), color, srgb((0.64, 0.68, 0.9)))
        color = t.mix(lip, color, srgb((0.7, 0.56, 0.82)))
        color = t.mix(brow, color, srgb((0.78, 0.82, 0.92)))
        color = t.mix(lash, color, srgb((0.8, 1.0, 1.0)))
        color = cavity(t, color, dark=0.72, light=1.04)
        emit = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, lash), 0.05), (0, 0, 0, 1), srgb((0.75, 0.9, 1.0)))
        emit = t.mix(t.math('MULTIPLY', sc, t.math('MULTIPLY', rim, 0.25)), emit, srgb(CYAN))
        emit = t.mix(lash, emit, srgb((0.8, 1.0, 1.0)))
        rough = t.math('ADD', t.fmix(lip, 0.46, 0.3), t.math('MULTIPLY', sc, -0.18))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=120, detail=2), 0.1),
                   t.math('MULTIPLY', t.math('MULTIPLY', rim, sc), 0.35))
        t.finish(color, rough, 0.0, t.bump(h, 0.2, 0.0015), emit=emit)
    elif k == 'hair':
        tip = t.smooth(_attr(t, 'RegTip'), 0.1, 1.0)
        strands = t.noise(t.scale_vec(1.0, 1.0, 1.0), scale=90.0, detail=2)
        base = t.ramp(t.noise(scale=4.0, detail=3, w=2.0),
                      [(0.25, srgb((0.8, 0.84, 0.92))), (0.5, srgb((0.93, 0.95, 1.0))), (0.75, srgb((0.84, 0.82, 0.96)))])
        color = t.mix(t.math('MULTIPLY', t.smooth(strands, 0.45, 0.7), 0.35), base, srgb((0.6, 0.66, 0.84)))
        hollow = t.smooth(t.point, 0.49, 0.42)
        color = t.mix(t.math('MULTIPLY', hollow, 0.6), color, srgb((0.34, 0.4, 0.64)))
        color = t.mix(t.math('MULTIPLY', tip, 0.75), color, srgb((0.5, 0.9, 0.96)))
        emit = t.mix(t.math('MULTIPLY', tip, 0.45), (0, 0, 0, 1), srgb((0.35, 0.85, 1.0)))
        rough = t.math('ADD', 0.3, t.math('MULTIPLY', strands, 0.15))
        t.finish(color, rough, 0.0, t.bump(strands, 0.25, 0.002), emit=emit)
    elif k == 'fin':
        ray = t.smooth(_attr(t, 'RegRay'), 0.05, 0.8)
        tip = _attr(t, 'RegTip')
        base = t.ramp(tip, [(0.0, srgb((0.56, 0.9, 0.94))), (0.55, srgb((0.48, 0.74, 0.95))),
                            (1.0, srgb((0.66, 0.54, 0.96)))])
        hollow = t.smooth(t.point, 0.49, 0.42)
        color = t.mix(t.math('MULTIPLY', hollow, 0.5), base, srgb((0.22, 0.4, 0.66)))
        color = t.mix(t.math('MULTIPLY', ray, 0.85), color, srgb((0.9, 0.94, 1.0)))
        emit = t.mix(t.math('ADD', 0.12, t.math('MULTIPLY', tip, 0.25)), (0, 0, 0, 1), srgb((0.4, 0.8, 1.0)))
        emit = t.mix(t.math('MULTIPLY', ray, 0.3), emit, srgb((0.8, 0.95, 1.0)))
        rough = t.fmix(ray, 0.3, 0.2)
        t.finish(color, rough, t.math('MULTIPLY', ray, 0.4), t.bump(t.noise(scale=50, detail=2), 0.1, 0.002),
                 emit=emit)
    elif k == 'scales':
        fluke = t.smooth(_attr(t, 'RegFluke'), 0.05, 0.9)
        ray = t.smooth(_attr(t, 'RegRay'), 0.05, 0.8)
        belly = t.smooth(_attr(t, 'RegBelly'), 0.0, 1.0)
        z = _attr(t, 'RegZ')
        rim = _scales(t, 30.0)
        back = t.ramp(z, [(0.15, srgb((0.34, 0.42, 0.78))), (0.45, srgb((0.28, 0.66, 0.78))),
                          (0.9, srgb((0.52, 0.84, 0.88)))])
        sheen = t.ramp(t.noise(scale=6.0, detail=2, w=4.0),
                       [(0.3, srgb((0.7, 0.98, 0.96))), (0.55, srgb((0.86, 0.82, 1.0))), (0.8, srgb((0.62, 0.9, 1.0)))])
        color = t.mix(0.45, back, sheen, 'MULTIPLY')
        color = t.mix(t.math('MULTIPLY', belly, 0.8), color, srgb((0.9, 0.92, 0.97)))
        color = t.mix(t.math('MULTIPLY', rim, 0.75), color, srgb((0.14, 0.3, 0.46)))
        # the fluke: sheer fin, silver rays, violet tips
        fin = t.ramp(t.smooth(z, 0.18, 0.0), [(0.0, srgb((0.5, 0.86, 0.94))), (1.0, srgb((0.66, 0.54, 0.96)))])
        fin = t.mix(t.math('MULTIPLY', ray, 0.8), fin, srgb((0.9, 0.94, 1.0)))
        color = t.mix(fluke, color, fin)
        color = cavity(t, color, dark=0.6, light=1.06)
        emit = t.mix(t.math('MULTIPLY', t.math('MULTIPLY', rim, 0.3), t.math('SUBTRACT', 1.0, fluke)), (0, 0, 0, 1),
                     srgb(CYAN))
        emit = t.mix(t.math('MULTIPLY', fluke, 0.25), emit, srgb((0.45, 0.75, 1.0)))
        rough = t.math('ADD', 0.22, t.math('MULTIPLY', rim, 0.15))
        h = t.math('ADD', t.math('MULTIPLY', t.math('SUBTRACT', 1.0, rim), t.math('SUBTRACT', 1.0, fluke)),
                   t.math('MULTIPLY', ray, 0.3))
        t.finish(color, rough, 0.0, t.bump(h, 0.35, 0.004), emit=emit)
    elif k == 'nacre':
        glyph = _attr(t, 'RegGlyph')
        band = _attr(t, 'RegBand')
        base = t.ramp(t.noise(scale=5.0, detail=4), [(0.3, srgb((0.9, 0.86, 0.9))), (0.7, srgb((0.98, 0.96, 0.98)))])
        play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                      [(0.2, srgb((0.92, 0.84, 1.0))), (0.42, srgb((1.0, 0.98, 0.98))), (0.62, srgb((0.8, 1.0, 0.97))),
                       (0.85, srgb((0.9, 0.9, 1.0)))])
        color = t.mix(0.7, base, play, 'MULTIPLY')
        concave = t.smooth(t.point, 0.485, 0.42)
        color = t.mix(t.math('MULTIPLY', concave, 0.8), color, srgb((0.28, 0.56, 0.7)))
        color = t.mix(band, color, srgb((0.88, 0.9, 0.96)))
        color = t.mix(glyph, color, srgb((0.62, 0.98, 1.0)))
        emit = t.mix(glyph, (0, 0, 0, 1), srgb((0.4, 0.95, 1.0)))
        color = cavity(t, color, dark=0.6, light=1.06)
        rough = t.math('ADD', 0.2, t.math('MULTIPLY', t.noise(scale=9, detail=2), 0.1))
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=45, detail=2), 0.12), t.math('MULTIPLY', glyph, -0.6))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.003), emit=emit)
    elif k == 'water':
        edge = t.smooth(_attr(t, 'RegEdge'), 0.0, 0.9)
        inner = _attr(t, 'RegIn')
        z = _attr(t, 'RegZ')
        caus = t.voronoi(t.scale_vec(1.0, 1.0, 0.45), scale=6.0, feature='DISTANCE_TO_EDGE')
        caus = t.smooth(caus, 0.05, 0.0)
        streak = t.smooth(t.noise(t.scale_vec(6.0, 6.0, 0.8), scale=2.0, detail=2), 0.55, 0.75)
        # clear sea-water lit from inside: deep turquoise low, aqua high
        deep = t.ramp(z, [(0.0, srgb((0.04, 0.32, 0.46))), (0.5, srgb((0.06, 0.5, 0.62))),
                          (1.0, srgb((0.24, 0.74, 0.84)))])
        color = t.mix(t.math('MULTIPLY', streak, 0.3), deep, srgb((0.3, 0.8, 0.9)))
        color = t.mix(t.math('MULTIPLY', caus, 0.32), color, srgb((0.45, 0.9, 0.98)))
        color = t.mix(t.math('MULTIPLY', inner, 0.7), color, srgb((0.02, 0.2, 0.32)))
        color = t.mix(edge, color, srgb((0.9, 0.98, 1.0)))
        glow = t.ramp(z, [(0.0, srgb((0.01, 0.1, 0.16))), (1.0, srgb((0.04, 0.24, 0.32)))])
        glow = t.mix(t.math('MULTIPLY', caus, 0.35), glow, srgb((0.25, 0.75, 0.95)))
        glow = t.mix(t.math('MULTIPLY', edge, 0.6), glow, srgb((0.55, 0.9, 1.0)))
        rough = t.fmix(edge, 0.05, 0.35)
        h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=14, detail=3), 0.4), t.math('MULTIPLY', edge, 0.3))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.006), emit=glow)
    elif k == 'coral':
        silver = t.smooth(_attr(t, 'RegSilver'), 0.1, 0.8)
        pores = t.smooth(t.voronoi(scale=180.0, feature='F1'), 0.12, 0.0)
        base = t.ramp(t.noise(scale=8.0, detail=3), [(0.3, srgb((0.88, 0.9, 0.92))), (0.7, srgb((0.98, 0.97, 0.96)))])
        color = t.mix(t.math('MULTIPLY', pores, 0.35), base, srgb((0.6, 0.7, 0.78)))
        color = cavity(t, color, dark=0.62, light=1.06)
        sil = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = t.mix(silver, color, sil)
        rough = t.fmix(silver, 0.55, 0.25)
        t.finish(color, rough, t.math('MULTIPLY', silver, 0.6),
                 t.bump(t.math('ADD', t.math('MULTIPLY', pores, 0.5), t.noise(scale=40, detail=2)), 0.25, 0.003))
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.6, light=1.06)
        rough = t.math('ADD', 0.26, t.math('MULTIPLY', t.noise(scale=12, detail=2), 0.1))
        t.finish(color, rough, 0.5, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.94, 0.9, 0.98))), (0.7, srgb((0.88, 0.97, 0.98)))])
        t.finish(base, 0.12, 0.0, None, emit=srgb((0.25, 0.3, 0.35)))
    else:
        raise ValueError(k)
    return mat
