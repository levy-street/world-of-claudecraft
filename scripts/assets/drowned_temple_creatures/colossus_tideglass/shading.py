"""The Colossus's bake surfaces. Opaque, so the glass is faked: every facet of
cut sea-glass takes its own tone (from its normal), deep teal in the body of
the glass to a clear pale aqua where the light strikes through, a hard bright
rim on every edge, cloudy inclusions deep inside, and the light that lives
in it breaking out of the seams between the blocks and along a few long
straight fractures. The spires are violet crystal, darker at the root, lit
toward their tips. The glossy roughness lets the scene's reflections run
across the planes in game.

  glass   the sea-glass body, fists and feet
  head    the same glass, two slanting slits of light, violet horns
  prism   the eye: faceted silver and violet, lit from inside
  shard   broken tideglass
  silver  moon silver; pearl
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('glass', 'head', 'prism', 'shard', 'silver', 'pearl')
GLOWS = {
    'glow_pool': ((0.3, 0.76, 0.92), 1.4, 'ColossusPool'),
}
EMIT_STRENGTH = 4.0
SEAM = (0.3, 0.82, 1.0)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith('CrystalHead'):
        return 1.6
    if n.startswith('PrismEye'):
        return 1.5
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _facet(t, scale=2.2):
    """One value per facet: noise over the normal, constant across a plane."""
    return t.noise(t.N, scale=scale, detail=1.0, rough=0.3)


def _glass(t, seam, geode, nacre):
    facet = _facet(t)
    edge = t.smooth(t.point, 0.515, 0.56)
    hollow = t.smooth(t.point, 0.49, 0.45)
    # facet tones: a teal glass, each plane its own depth
    base = t.ramp(facet, [(0.3, srgb((0.02, 0.2, 0.27))), (0.5, srgb((0.05, 0.38, 0.45))),
                          (0.66, srgb((0.16, 0.58, 0.62))), (0.78, srgb((0.42, 0.8, 0.8)))])
    # brighter toward the shoulders, the deep sea at the feet
    height = t.smooth(t.pz, 0.6, 5.2)
    base = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, height), 0.45), base, srgb((0.01, 0.1, 0.16)))
    # cloudy inclusions deep in the glass, and streaks along the planes
    cloud = t.smooth(t.noise(t.scale_vec(1.0, 1.0, 0.7), scale=2.6, detail=4, dist=0.4), 0.56, 0.74)
    color = t.mix(t.math('MULTIPLY', cloud, 0.4), base, srgb((0.55, 0.86, 0.88)))
    streak = t.smooth(t.noise(t.scale_vec(4.0, 4.0, 0.4), scale=3.0, detail=2), 0.6, 0.7)
    color = t.mix(t.math('MULTIPLY', streak, 0.2), color, srgb((0.7, 0.95, 0.95)))
    color = t.mix(t.math('MULTIPLY', hollow, 0.6), color, srgb((0.0, 0.07, 0.12)))
    # every edge a hard rim of light
    color = t.mix(t.math('MULTIPLY', edge, 0.85), color, srgb((0.82, 0.98, 1.0)))
    # long straight fractures (Voronoi edges, kept to a few by a mask)
    crack = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 0.55), scale=0.9, feature='DISTANCE_TO_EDGE'), 0.008, 0.0)
    few = t.smooth(t.noise(scale=0.7, detail=1), 0.56, 0.62)
    crack = t.math('MULTIPLY', crack, few)
    seam_l = t.math('MAXIMUM', seam, crack)
    color = t.mix(seam_l, color, srgb((0.36, 0.88, 1.0)))
    # the violet spires: dark at the root, lit at the tips
    tip = _facet(t, 3.4)
    geo = t.ramp(facet, [(0.3, srgb((0.08, 0.06, 0.34))), (0.5, srgb((0.22, 0.18, 0.7))),
                         (0.68, srgb((0.42, 0.4, 0.95))), (0.8, srgb((0.72, 0.74, 1.0)))])
    geo = t.mix(t.math('MULTIPLY', edge, 0.6), geo, srgb((0.86, 0.88, 1.0)))
    color = t.mix(geode, color, geo)
    nac = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                 [(0.2, srgb((0.42, 0.4, 0.7))), (0.45, srgb((0.78, 0.8, 0.9))), (0.7, srgb((0.4, 0.72, 0.8))),
                  (0.9, srgb((0.86, 0.76, 0.92)))])
    nac = t.mix(t.math('MULTIPLY', hollow, 0.7), nac, srgb((0.18, 0.2, 0.36)))
    color = t.mix(nacre, color, nac)
    # the light inside: a low glow through the glass, the seams and cracks blazing
    inner = t.math('MULTIPLY', t.math('ADD', t.math('MULTIPLY', cloud, 0.6), 0.25), t.math('ADD', height, 0.3))
    emit = t.mix(t.math('MULTIPLY', inner, 0.35), srgb((0.0, 0.03, 0.05)), srgb((0.12, 0.45, 0.55)))
    emit = t.mix(t.math('MULTIPLY', edge, 0.25), emit, srgb((0.3, 0.7, 0.8)))
    emit = t.mix(seam_l, emit, srgb(SEAM))
    gemit = t.mix(tip, srgb((0.06, 0.05, 0.3)), srgb((0.36, 0.32, 0.95)))
    emit = t.mix(t.math('MULTIPLY', geode, 0.8), emit, gemit)
    rough = t.fmix(edge, 0.1, 0.32)
    rough = t.fmix(geode, rough, 0.12)
    h = t.math('ADD', t.math('MULTIPLY', t.noise(scale=22, detail=3), 0.12), t.math('MULTIPLY', seam_l, -0.5))
    return color, rough, h, emit


def shade(mat, k):
    t = NT(mat)
    if k == 'glass':
        seam = t.smooth(_attr(t, 'RegSeam'), 0.15, 0.85)
        geode = t.smooth(_attr(t, 'RegGeode'), 0.2, 0.9)
        nacre = t.smooth(_attr(t, 'RegNacre'), 0.05, 0.8)
        color, rough, h, emit = _glass(t, seam, geode, nacre)
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.006), emit=emit)
    elif k == 'head':
        slit = t.smooth(_attr(t, 'RegSlit'), 0.05, 0.8)
        horn = t.smooth(_attr(t, 'RegHorn'), 0.1, 0.9)
        color, rough, h, emit = _glass(t, 0.0, horn, 0.0)
        color = t.mix(slit, color, srgb((0.6, 0.98, 1.0)))
        emit = t.mix(slit, emit, srgb((0.7, 1.0, 1.0)))
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.006), emit=emit)
    elif k == 'prism':
        facet = _facet(t, 3.0)
        edge = t.smooth(t.point, 0.51, 0.55)
        base = t.ramp(facet, [(0.3, srgb((0.22, 0.14, 0.62))), (0.5, srgb((0.5, 0.4, 0.92))),
                              (0.7, srgb((0.86, 0.86, 1.0)))])
        color = t.mix(t.math('MULTIPLY', edge, 0.8), base, srgb((1.0, 1.0, 1.0)))
        emit = t.ramp(facet, [(0.3, srgb((0.06, 0.04, 0.22))), (0.55, srgb((0.22, 0.16, 0.55))),
                              (0.75, srgb((0.45, 0.42, 0.85)))])
        emit = t.mix(t.math('MULTIPLY', edge, 0.7), emit, srgb((0.75, 0.78, 1.0)))
        t.finish(color, 0.06, 0.25, None, emit=emit)
    elif k == 'shard':
        color, rough, h, emit = _glass(t, 0.0, 0.0, 0.0)
        t.finish(color, rough, 0.0, t.bump(h, 0.25, 0.006), emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.8, 0.84, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.55, light=1.08)
        t.finish(color, 0.24, 0.6, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.94, 0.9, 0.98))), (0.7, srgb((0.88, 0.97, 0.98)))])
        t.finish(base, 0.12, 0.0, None, emit=srgb((0.25, 0.3, 0.35)))
    else:
        raise ValueError(k)
    return mat
