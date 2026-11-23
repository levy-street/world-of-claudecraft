"""The Tidewisp's surfaces. Opaque, so the drop's clearness is faked: deep
turquoise at its edges, brightening toward a heart of moonlight, caustic
light lines through it, moonlight spilling round the crescent in its face.

  water  the drop of moon-water
No rust, no barnacles, no grey fog."""
from surface import NT, srgb

KINDS = ('water',)
GLOWS = {
    'glow_moon': ((0.9, 0.94, 1.0), 4.0, 'TidewispMoon'),
    'glow_core': ((0.78, 0.98, 1.0), 6.0, 'TidewispMoonPearl'),
    'glow_drop': ((0.42, 0.9, 1.0), 2.6, 'TidewispDrops'),
    'glow_frost': ((0.72, 0.96, 1.0), 4.0, 'TidewispFrost'),
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
    if k != 'water':
        raise ValueError(k)
    core = t.smooth(_attr(t, 'RegCore'), 0.0, 1.0)
    face = t.smooth(_attr(t, 'RegFace'), 0.0, 1.0)
    z = _attr(t, 'RegZ')
    caus = t.smooth(t.voronoi(t.scale_vec(1.0, 1.0, 0.7), scale=4.5, feature='DISTANCE_TO_EDGE'), 0.05, 0.0)
    swirl = t.smooth(t.noise(t.scale_vec(2.0, 2.0, 0.6), scale=2.2, detail=3, dist=1.5), 0.5, 0.72)
    color = t.ramp(z, [(0.0, srgb((0.01, 0.14, 0.32))), (0.6, srgb((0.03, 0.34, 0.54))),
                       (1.0, srgb((0.3, 0.78, 0.9)))])
    color = t.mix(t.math('MULTIPLY', core, 0.35), color, srgb((0.3, 0.8, 0.92)))
    color = t.mix(t.math('MULTIPLY', swirl, 0.3), color, srgb((0.7, 0.96, 1.0)))
    color = t.mix(t.math('MULTIPLY', caus, 0.18), color, srgb((0.7, 0.97, 1.0)))
    color = t.mix(t.math('MULTIPLY', face, 0.35), color, srgb((0.6, 0.85, 1.0)))
    glow = t.ramp(core, [(0.0, srgb((0.02, 0.14, 0.22))), (1.0, srgb((0.18, 0.56, 0.7)))])
    glow = t.mix(t.math('MULTIPLY', caus, 0.25), glow, srgb((0.3, 0.8, 1.0)))
    glow = t.mix(t.math('MULTIPLY', face, 0.6), glow, srgb((0.7, 0.9, 1.0)))
    h = t.math('MULTIPLY', swirl, 0.5)
    t.finish(color, 0.18, 0.0, t.bump(h, 0.3, 0.005), emit=glow)
    return mat
