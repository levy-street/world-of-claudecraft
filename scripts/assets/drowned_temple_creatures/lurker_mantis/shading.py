"""The Lurker's bake surfaces.

  shell       iridescent shell: turquoise to sea-green to violet across the
              plates (the "glimmerscale"), pearl at each plate's back edge, a
              carved crescent on each tergite lit cyan, a paler pearl-lilac belly,
              the clubs' heels a deep violet with a pearl sheen
  shell_thin  the antennae and their scales: the same shell, finer
  eye         compound eyes: dark sea-glass faceted, a glowing moonlit midband
  silver      moon silver; pearl
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('shell', 'shell_thin', 'eye', 'silver', 'pearl')
GLOWS = {
    'glow_pearl': ((0.86, 0.94, 1.0), 3.0, 'LurkerMoonPearl'),
    'glow_spot': ((0.4, 0.95, 1.0), 4.0, 'LurkerGlowSpots'),
    'glow_venom': ((0.45, 1.0, 0.82), 5.0, 'LurkerVenom'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith(('L_EyeMesh', 'R_EyeMesh')):
        return 1.6
    if n.startswith(('L_Ant', 'R_Ant')):
        return 0.6
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _irid(t, shift):
    """The glimmer: a hue that drifts turquoise, sea-green, violet over the shell."""
    n = t.noise(t.scale_vec(1.0, 0.5, 1.0), scale=1.3, detail=2, w=2.0)
    f = t.math('ADD', t.math('MULTIPLY', n, 0.9), t.math('MULTIPLY', shift, 0.35))
    return t.ramp(f, [(0.2, srgb((0.08, 0.56, 0.62))), (0.42, srgb((0.2, 0.7, 0.6))),
                      (0.62, srgb((0.22, 0.46, 0.8))), (0.85, srgb((0.52, 0.34, 0.82)))])


def shade(mat, k):
    t = NT(mat)
    if k in ('shell', 'shell_thin'):
        if k == 'shell':
            edge = t.smooth(_attr(t, 'RegEdge'), 0.05, 0.8)
            glyph = t.smooth(_attr(t, 'RegGlyph'), 0.05, 0.8)
            belly = _attr(t, 'RegBelly')
            seg = _attr(t, 'RegSeg')
            claw = t.smooth(_attr(t, 'RegClaw'), 0.0, 0.8)
        else:
            edge = glyph = belly = claw = 0.0
            seg = 0.5
        color = _irid(t, seg)
        pits = t.smooth(t.voronoi(scale=60.0, feature='F1'), 0.1, 0.0)
        color = t.mix(t.math('MULTIPLY', pits, 0.25), color, srgb((0.06, 0.2, 0.3)))
        # a mantis shrimp's mottling: darker spots and flecks over the shell
        mott = t.smooth(t.noise(scale=7.0, detail=3, dist=0.5), 0.6, 0.72)
        color = t.mix(t.math('MULTIPLY', mott, 0.55), color, srgb((0.03, 0.14, 0.24)))
        fleck = t.smooth(t.voronoi(scale=24.0, feature='F1'), 0.08, 0.02)
        color = t.mix(t.math('MULTIPLY', fleck, 0.35), color, srgb((0.7, 0.96, 0.95)))
        # every hard edge of the armour catches a pearl highlight
        ridge = t.smooth(t.point, 0.53, 0.6)
        color = t.mix(t.math('MULTIPLY', ridge, 0.55), color, srgb((0.8, 0.92, 0.98)))
        color = t.mix(belly, color, srgb((0.82, 0.8, 0.92)))
        color = t.mix(claw, color, srgb((0.36, 0.2, 0.6)))
        color = t.mix(edge, color, srgb((0.94, 0.92, 0.98)))
        color = t.mix(glyph, color, srgb((0.6, 0.98, 1.0)))
        color = cavity(t, color, dark=0.38, light=1.16)
        emit = t.mix(glyph, (0, 0, 0, 1), srgb(CYAN))
        emit = t.mix(t.math('MULTIPLY', edge, 0.12), emit, srgb((0.7, 0.9, 1.0)))
        rough = t.math('ADD', 0.3, t.math('MULTIPLY', pits, 0.15))
        h = t.math('ADD', t.math('MULTIPLY', pits, -0.25), t.math('MULTIPLY', glyph, -0.6))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.003), emit=emit)
    elif k == 'eye':
        mid = t.smooth(_attr(t, 'RegMid'), 0.05, 0.8)
        eye = _attr(t, 'RegEye')
        facets = t.smooth(t.voronoi(scale=90.0, feature='DISTANCE_TO_EDGE'), 0.06, 0.0)
        iris = t.ramp(t.noise(scale=4.0, detail=2, w=1.0), [(0.3, srgb((0.06, 0.3, 0.36))),
                                                             (0.7, srgb((0.2, 0.18, 0.42)))])
        color = t.mix(t.math('MULTIPLY', facets, 0.4), iris, srgb((0.5, 0.9, 0.95)))
        stalk = _irid(t, 0.4)
        color = t.mix(eye, stalk, color)
        color = t.mix(mid, color, srgb((0.8, 1.0, 1.0)))
        emit = t.mix(t.math('MULTIPLY', eye, 0.15), (0, 0, 0, 1), srgb((0.2, 0.7, 0.8)))
        emit = t.mix(mid, emit, srgb((0.7, 1.0, 1.0)))
        rough = t.fmix(eye, 0.3, 0.06)
        t.finish(color, rough, 0.0, t.bump(facets, 0.2, 0.002), emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.6, light=1.06)
        t.finish(color, 0.28, 0.5, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.94, 0.9, 0.98))), (0.7, srgb((0.88, 0.97, 0.98)))])
        t.finish(base, 0.12, 0.0, None, emit=srgb((0.25, 0.3, 0.35)))
    else:
        raise ValueError(k)
    return mat
