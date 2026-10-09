"""The Moonspawn's surfaces. Opaque, so the water is faked: clear cyan-silver
tide lit from inside, silver light running through it, foam-white at the
crests; the crescents pure nacre with a glowing rim.

  tide   the water body
  nacre  the crescents
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('tide', 'nacre')
GLOWS = {
    'glow_eye': ((0.85, 1.0, 1.0), 6.0, 'MoonspawnEyes'),
    'glow_teeth': ((0.7, 0.95, 1.0), 2.4, 'MoonspawnTeeth'),
    'glow_pool': ((0.3, 0.76, 0.95), 1.4, 'MoonspawnPool'),
}
EMIT_STRENGTH = 4.0


def uv_boost(obj, c):
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def shade(mat, k):
    t = NT(mat)
    if k == 'tide':
        z = _attr(t, 'RegZ')
        mouth = t.smooth(_attr(t, 'RegMouth'), 0.1, 0.8)
        flow = t.noise(t.scale_vec(1.0, 0.5, 1.0), scale=2.5, detail=3, dist=1.6)
        streak = t.smooth(flow, 0.6, 0.75)
        caus = t.smooth(t.voronoi(scale=5.0, feature='DISTANCE_TO_EDGE'), 0.04, 0.0)
        base = t.ramp(z, [(0.0, srgb((0.04, 0.3, 0.46))), (0.6, srgb((0.12, 0.56, 0.7))),
                          (1.0, srgb((0.5, 0.86, 0.94)))])
        color = t.mix(t.math('MULTIPLY', streak, 0.6), base, srgb((0.86, 0.95, 1.0)))
        color = t.mix(t.math('MULTIPLY', caus, 0.35), color, srgb((0.7, 0.98, 1.0)))
        edge = t.smooth(t.point, 0.52, 0.6)
        color = t.mix(t.math('MULTIPLY', edge, 0.6), color, srgb((0.92, 0.98, 1.0)))
        color = t.mix(mouth, color, srgb((0.05, 0.12, 0.3)))
        emit = t.mix(t.math('MULTIPLY', streak, 0.7), srgb((0.03, 0.16, 0.24)), srgb((0.7, 0.95, 1.0)))
        emit = t.mix(t.math('MULTIPLY', caus, 0.3), emit, srgb((0.4, 0.9, 1.0)))
        t.finish(color, 0.08, 0.0, t.bump(flow, 0.25, 0.004), emit=emit)
    elif k == 'nacre':
        edge = _attr(t, 'RegEdge')
        base = t.ramp(t.noise(scale=5.0, detail=4), [(0.3, srgb((0.9, 0.88, 0.92))), (0.7, srgb((0.99, 0.97, 0.99)))])
        play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                      [(0.2, srgb((1.0, 0.86, 0.94))), (0.42, srgb((1.0, 0.99, 0.98))), (0.62, srgb((0.82, 1.0, 0.98))),
                       (0.85, srgb((0.9, 0.9, 1.0)))])
        color = t.mix(0.7, base, play, 'MULTIPLY')
        color = cavity(t, color, dark=0.65, light=1.08)
        emit = t.mix(t.math('MULTIPLY', t.math('SUBTRACT', 1.0, edge), 0.5), srgb((0.08, 0.1, 0.12)),
                     srgb((0.7, 0.92, 1.0)))
        t.finish(color, 0.18, 0.0, t.bump(t.noise(scale=40, detail=2), 0.15, 0.002), emit=emit)
    else:
        raise ValueError(k)
    return mat
