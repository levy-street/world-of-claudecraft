"""The Moonmantle Ray's bake surfaces.

  mantle       the disc: on top pearl white with a silver sheen and a faint
               rose and aqua iridescence, the nine nacre plates brighter and
               glassier, each moon's lit part in pale moonlight (softly lit)
               and its carved outline in silver; the wings thinning out to an
               edge clear as water, aqua and lit cyan from inside; underneath
               deep turquoise strewn with points of light like stars; the
               cephalic lobes polished moon silver; the mouth and the gill
               slits deep sea-teal
  mantle_tail  the whip of the tail: silver above, turquoise under
  glass        the tide-glass at the tail's tip: clear turquoise sea-glass,
               frosted on its edges, lit from inside
  eye          small cold eyes of dark sea-glass
  silver       moon silver; pearl
No rust, no barnacles, no grey fog: even the shadows lean teal."""
from surface import NT, srgb

KINDS = ('mantle', 'mantle_tail', 'glass', 'eye', 'silver', 'pearl', 'heart')
GLOWS = {
    'glow_rim': ((0.42, 0.96, 1.0), 3.4, 'MantaWingLight'),
    # the heart pearl gone dark as it dies: a flat dull pearl (never baked:
    # it sits inside the living pearl, which would bake onto it)
    'glow_darkpearl': ((0.36, 0.42, 0.48), 0.15, 'MantaDarkPearl'),
    'glow_eye': ((0.72, 1.0, 1.0), 4.2, 'MantaEyeSlit'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)
TOP_A = (0.07, 0.24, 0.36)      # the moonlit deep: night-sea blue
TOP_B = (0.04, 0.17, 0.3)       # darker, toward the spine
TOP_C = (0.1, 0.3, 0.42)        # lighter turquoise drift
BELLY_A = (0.03, 0.24, 0.31)    # deep turquoise
BELLY_B = (0.07, 0.38, 0.44)
BELLY_PEARL = (0.78, 0.88, 0.9)  # the pale pearl heart of the belly
CLEAR = (0.16, 0.76, 0.9)       # the clear edge


def uv_boost(obj, c):
    n = obj.name
    if n.startswith(('L_Eye', 'R_Eye')):
        return 1.6
    if n.startswith('TideGlass'):
        return 1.4
    if n.startswith('Tail'):
        return 0.8
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _teal_cavity(t, color, dark=0.62, light=1.08):
    """Cavity shading that sinks toward sea-teal, never toward grey."""
    concave = t.smooth(t.point, 0.47, 0.39)
    convex = t.smooth(t.point, 0.53, 0.61)
    color = t.mix(concave, color, t.mix(1.0, color, srgb((dark * 0.55, dark * 0.85, dark * 0.92)), 'MULTIPLY'))
    color = t.mix(t.math('MULTIPLY', convex, 0.5), color,
                  t.mix(1.0, color, srgb((light, light, light)), 'MULTIPLY'))
    return color


def _pearl_top(t, span):
    """Pearl white drifting through silver-blue and rose nacre, with the fine
    growth lines of nacre running across the wings."""
    drift = t.noise(t.scale_vec(1.0, 1.0, 1.0), scale=0.9, detail=2, w=1.3)
    base = t.ramp(drift, [(0.3, srgb(TOP_B)), (0.5, srgb(TOP_A)), (0.72, srgb(TOP_C))])
    lines = t.noise(t.scale_vec(1.0, 7.0, 1.0), scale=3.0, detail=3, dist=0.6)
    base = t.mix(t.math('MULTIPLY', t.smooth(lines, 0.45, 0.62), 0.22), base, srgb((0.3, 0.52, 0.64)))
    # the wings lighten toward their tips into turquoise, then the clear edge
    base = t.mix(t.math('MULTIPLY', t.smooth(span, 0.35, 0.95), 0.75), base, srgb((0.12, 0.46, 0.56)))
    return base


def shade(mat, k):
    t = NT(mat)
    if k == 'mantle':
        rim = t.smooth(_attr(t, 'RegRim'), 0.0, 1.0)
        plate = t.smooth(_attr(t, 'RegPlate'), 0.05, 0.9)
        moon = t.smooth(_attr(t, 'RegMoon'), 0.05, 0.9)
        ring = t.smooth(_attr(t, 'RegRing'), 0.05, 0.9)
        disc = t.smooth(_attr(t, 'RegDisc'), 0.05, 0.9)
        lobe = t.smooth(_attr(t, 'RegLobe'), 0.05, 0.9)
        mouth = t.smooth(_attr(t, 'RegMouth'), 0.05, 0.9)
        gill = t.smooth(_attr(t, 'RegGill'), 0.05, 0.9)
        span = _attr(t, 'RegSpan')
        top = t.smooth(t.nz, -0.3, 0.3)
        under = t.math('SUBTRACT', 1.0, top)
        # top
        topc = _pearl_top(t, span)
        nac = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=4.0, detail=3, w=0.7, dist=1.2),
                     [(0.2, srgb((0.86, 0.74, 0.9))), (0.5, srgb((0.7, 0.86, 0.94))), (0.8, srgb((0.62, 0.9, 0.86)))])
        # fin rays: faint silver-blue lines running out along the wings
        rays = t.smooth(t.voronoi(t.scale_vec(0.35, 4.0, 1.0), scale=2.2, feature='DISTANCE_TO_EDGE'), 0.05, 0.0)
        rays = t.math('MULTIPLY', rays, t.math('MULTIPLY', t.smooth(span, 0.15, 0.4), 0.6))
        # cooler silver-blue toward the leading edges and the tips, warm pearl at the heart
        # pearl-silver chevrons on the shoulders, a manta's bright patches
        # made moonlight, framing the arc of plates
        chev = t.math('MULTIPLY', t.smooth(t.math('ABSOLUTE', t.math('SUBTRACT', t.math('ABSOLUTE', t.px), 0.75)),
                                           0.3, 0.12), t.smooth(t.math('ABSOLUTE', t.math('ADD', t.py, 0.55)), 0.45, 0.2))
        topc = t.mix(t.math('MULTIPLY', chev, 0.55), topc, srgb((0.62, 0.78, 0.86)))
        topc = t.mix(rays, topc, srgb((0.36, 0.62, 0.74)))
        topc = t.mix(plate, topc, nac)
        topc = t.mix(ring, topc, srgb((0.96, 0.98, 1.0)))
        # each moon: its dark part the night sea, its lit part moonlight
        night = t.ramp(t.noise(scale=14.0, detail=2), [(0.3, srgb((0.05, 0.2, 0.32))), (0.7, srgb((0.09, 0.3, 0.42)))])
        topc = t.mix(disc, topc, night)
        topc = t.mix(moon, topc, srgb((0.9, 0.99, 1.0)))
        # underneath: deep turquoise, mottled, strewn with stars
        mott = t.noise(scale=2.2, detail=3)
        belly = t.ramp(mott, [(0.35, srgb(BELLY_A)), (0.65, srgb(BELLY_B))])
        belly = t.mix(t.math('MULTIPLY', span, 0.5), belly, srgb((0.1, 0.46, 0.52)))
        pale = t.math('MULTIPLY', t.smooth(span, 0.42, 0.12), t.smooth(t.math('ABSOLUTE', t.math('ADD', t.py, 0.2)), 1.1, 0.5))
        belly = t.mix(pale, belly, srgb(BELLY_PEARL))
        st1 = t.smooth(t.voronoi(scale=11.0, feature='F1'), 0.06, 0.018)
        pick1 = t.smooth(t.voronoi(scale=11.0, feature='F1', out='Color'), 0.55, 0.62)
        st2 = t.smooth(t.voronoi(scale=27.0, feature='F1'), 0.07, 0.02)
        pick2 = t.smooth(t.voronoi(scale=27.0, feature='F1', out='Color'), 0.62, 0.7)
        stars = t.math('MAXIMUM', t.math('MULTIPLY', st1, pick1), t.math('MULTIPLY', t.math('MULTIPLY', st2, pick2), 0.7))
        stars = t.math('MULTIPLY', stars, t.math('MULTIPLY', under, t.math('SUBTRACT', 1.0, rim)))
        belly = t.mix(stars, belly, srgb((0.8, 1.0, 1.0)))
        color = t.mix(top, belly, topc)
        # the clear edge, like water: aqua over both faces
        clear = t.math('MULTIPLY', t.math('POWER', rim, 1.1), 0.95)
        color = t.mix(clear, color, srgb(CLEAR))
        color = t.mix(t.math('MULTIPLY', t.math('POWER', rim, 3.0), 0.35), color, srgb((0.45, 0.92, 1.0)))
        silver = t.ramp(t.noise(scale=7.0, detail=2), [(0.3, srgb((0.56, 0.62, 0.74))), (0.7, srgb((0.7, 0.76, 0.86)))])
        color = t.mix(lobe, color, silver)
        # the line engraved round the crescent holds a thread of moonlight
        etch = t.math('MULTIPLY', lobe, t.smooth(t.point, 0.485, 0.45))
        color = t.mix(etch, color, srgb((0.45, 0.9, 1.0)))
        color = t.mix(mouth, color, srgb((0.02, 0.11, 0.15)))
        color = t.mix(gill, color, srgb((0.01, 0.08, 0.12)))
        color = _teal_cavity(t, color)
        emit = t.mix(t.math('MULTIPLY', t.math('POWER', rim, 1.6), 0.9), (0, 0, 0, 1), srgb(CYAN))
        emit = t.mix(moon, emit, srgb((0.62, 0.92, 1.0)))
        emit = t.mix(t.math('MULTIPLY', lobe, 0.06), emit, srgb((0.7, 0.92, 1.0)))
        emit = t.mix(etch, emit, srgb((0.35, 0.9, 1.0)))
        emit = t.mix(t.math('MULTIPLY', ring, 0.16), emit, srgb((0.6, 0.9, 1.0)))
        emit = t.mix(stars, emit, srgb((0.62, 1.0, 1.0)))
        metal = t.math('MAXIMUM', t.math('MULTIPLY', lobe, 0.45), t.math('MULTIPLY', ring, 0.4))
        rough = t.fmix(plate, 0.34, 0.14)
        rough = t.fmix(rim, rough, 0.08)
        rough = t.fmix(lobe, rough, 0.22)
        rough = t.fmix(disc, rough, 0.3)
        h = t.math('MULTIPLY', t.noise(scale=26, detail=2), 0.12)
        h = t.math('ADD', h, t.math('MULTIPLY', moon, 0.35))
        t.finish(color, rough, metal, t.bump(h, 0.2, 0.002), emit=emit)
    elif k == 'mantle_tail':
        top = t.smooth(t.nz, -0.4, 0.4)
        topc = _pearl_top(t, 0.6)
        belly = t.ramp(t.noise(scale=4.0, detail=2), [(0.35, srgb(BELLY_A)), (0.65, srgb(BELLY_B))])
        color = t.mix(top, belly, topc)
        bands = t.smooth(t.noise(t.scale_vec(0.2, 9.0, 0.2), scale=2.0, detail=2), 0.6, 0.66)
        color = t.mix(t.math('MULTIPLY', bands, 0.4), color, srgb((0.78, 0.86, 0.96)))
        color = _teal_cavity(t, color)
        t.finish(color, 0.3, 0.1, t.bump(t.noise(scale=60, detail=2), 0.05, 0.001))
    elif k == 'glass':
        along = _attr(t, 'RegAlong')
        edge = t.smooth(t.point, 0.52, 0.6)
        depth = t.noise(t.scale_vec(1.0, 1.0, 0.5), scale=4.0, detail=4, dist=0.8)
        base = t.ramp(depth, [(0.25, srgb((0.03, 0.3, 0.38))), (0.55, srgb((0.1, 0.52, 0.56))),
                              (0.8, srgb((0.3, 0.72, 0.72)))])
        color = t.mix(t.math('MULTIPLY', edge, 0.8), base, srgb((0.8, 0.96, 0.96)))
        crack = t.smooth(t.voronoi(scale=9.0, feature='DISTANCE_TO_EDGE'), 0.03, 0.0)
        color = t.mix(t.math('MULTIPLY', crack, 0.6), color, srgb((0.6, 1.0, 1.0)))
        emit = t.mix(t.math('MULTIPLY', crack, 0.8), srgb((0.05, 0.3, 0.36)), srgb(CYAN))
        emit = t.mix(t.math('MULTIPLY', t.smooth(along, 0.5, 1.0), 0.6), emit, srgb((0.6, 1.0, 1.0)))
        t.finish(color, t.fmix(edge, 0.06, 0.3), 0.0, t.bump(crack, 0.25, 0.002), emit=emit)
    elif k == 'eye':
        iris = t.ramp(t.noise(scale=30.0, detail=2), [(0.3, srgb((0.01, 0.06, 0.09))), (0.7, srgb((0.03, 0.14, 0.18)))])
        emit = t.mix(t.smooth(t.noise(scale=12.0, detail=2), 0.6, 0.75), (0, 0, 0, 1), srgb((0.04, 0.2, 0.24)))
        t.finish(iris, 0.04, 0.0, None, emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.88, 0.95))), (0.7, srgb((0.95, 0.97, 1.0)))])
        color = _teal_cavity(t, base, dark=0.7, light=1.04)
        t.finish(color, 0.24, 0.3, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001), emit=srgb((0.1, 0.15, 0.18)))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.94, 0.9, 0.98))), (0.7, srgb((0.88, 0.97, 0.98)))])
        t.finish(base, 0.12, 0.0, None, emit=srgb((0.18, 0.22, 0.26)))
    elif k == 'heart':
        # a pearl with moonlight inside it: the face toward you glows
        # cyan-white from its core, the rim is pearl with a rose and aqua lustre
        front = t.smooth(_attr(t, 'RegFront'), 0.15, 0.95)
        lustre = t.ramp(t.noise(t.N, scale=1.2, detail=1), [(0.3, srgb((0.96, 0.86, 0.94))), (0.5, srgb((0.95, 0.96, 0.98))),
                                                            (0.7, srgb((0.78, 0.96, 0.98)))])
        color = t.mix(front, lustre, srgb((0.62, 0.94, 1.0)))
        groove = t.smooth(t.point, 0.48, 0.43)
        color = t.mix(t.math('MULTIPLY', groove, 0.7), color, srgb((0.3, 0.7, 0.86)))
        emit = t.mix(front, srgb((0.16, 0.24, 0.32)), srgb((0.3, 0.86, 0.98)))
        emit = t.mix(t.math('MULTIPLY', groove, 0.8), emit, srgb((0.45, 0.95, 1.0)))
        t.finish(color, 0.1, 0.0, None, emit=emit)
    else:
        raise ValueError(k)
    return mat
