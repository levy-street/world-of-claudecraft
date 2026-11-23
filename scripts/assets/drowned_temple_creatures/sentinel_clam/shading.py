"""The Sentinel's bake surfaces.

  shell        a giant clam's valve: bone-white outside, faint rose and aqua in
               the wavy folds, growth rings, a pearl-white rim; inside, nacre;
               the back valve's carved moon lit cyan
  mantle       the soft body: a giant clam's iridescent mantle, deep blue to
               violet with turquoise sheen and glowing eye-spots, paler in the
               folds round the pearl
  coral        white branching coral blushing pale pink, fine pores
  stone        nacre stone (fists, feet, head): pale, faintly iridescent,
               worn; the head's slit of moonlight
  shell_shard  the scattered nacre
  silver       moon silver; pearl
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('shell', 'mantle', 'coral', 'stone', 'shell_shard', 'silver', 'pearl')
GLOWS = {
    'glow_pearl': ((0.9, 0.96, 1.0), 4.5, 'SentinelHeartPearl'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith('StoneHead'):
        return 1.6
    if n.startswith(('L_Fist', 'R_Fist')):
        return 1.2
    if n.startswith('Valve'):
        return 1.0
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _nacre(t):
    base = t.ramp(t.noise(scale=5.0, detail=4), [(0.3, srgb((0.88, 0.86, 0.9))), (0.7, srgb((0.97, 0.95, 0.97)))])
    play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                  [(0.2, srgb((1.0, 0.84, 0.92))), (0.42, srgb((1.0, 0.98, 0.98))), (0.62, srgb((0.8, 1.0, 0.97))),
                   (0.85, srgb((0.88, 0.88, 1.0)))])
    return t.mix(0.7, base, play, 'MULTIPLY')


def shade(mat, k):
    t = NT(mat)
    if k == 'shell':
        inside = _attr(t, 'RegIn')
        rim = t.smooth(_attr(t, 'RegRim'), 0.05, 0.8)
        ring = _attr(t, 'RegRing')
        fold = _attr(t, 'RegFold')
        glyph = t.smooth(_attr(t, 'RegGlyph'), 0.05, 0.8)
        bone = t.ramp(t.noise(scale=3.0, detail=4), [(0.3, srgb((0.84, 0.82, 0.78))), (0.7, srgb((0.94, 0.92, 0.88)))])
        blush = t.ramp(fold, [(0.2, srgb((0.86, 0.95, 0.94))), (0.5, srgb((0.95, 0.93, 0.9))),
                              (0.8, srgb((0.96, 0.86, 0.88)))])
        outer = t.mix(0.5, bone, blush, 'MULTIPLY')
        outer = t.mix(t.math('MULTIPLY', ring, 0.25), outer, srgb((0.7, 0.68, 0.66)))
        outer = t.mix(rim, outer, srgb((0.98, 0.97, 1.0)))
        outer = t.mix(glyph, outer, srgb((0.6, 0.98, 1.0)))
        color = t.mix(inside, outer, _nacre(t))
        color = cavity(t, color, dark=0.55, light=1.1)
        emit = t.mix(glyph, (0, 0, 0, 1), srgb(CYAN))
        emit = t.mix(t.math('MULTIPLY', inside, 0.08), emit, srgb((0.7, 0.9, 1.0)))
        rough = t.fmix(inside, 0.55, 0.18)
        h = t.math('ADD', t.math('MULTIPLY', ring, 0.3), t.math('MULTIPLY', t.noise(scale=30, detail=3), 0.3))
        t.finish(color, rough, 0.0, t.bump(h, 0.3, 0.006), emit=emit)
    elif k == 'mantle':
        spot = t.smooth(_attr(t, 'RegSpot'), 0.05, 0.6)
        fold = _attr(t, 'RegFold')
        swirl = t.noise(t.scale_vec(1.0, 1.0, 2.0), scale=4.0, detail=3, dist=2.0, w=1.0)
        color = t.ramp(swirl, [(0.25, srgb((0.06, 0.18, 0.5))), (0.45, srgb((0.08, 0.48, 0.62))),
                               (0.62, srgb((0.3, 0.2, 0.62))), (0.8, srgb((0.12, 0.6, 0.66)))])
        color = t.mix(t.math('MULTIPLY', fold, 0.5), color, srgb((0.7, 0.8, 0.95)))
        color = t.mix(spot, color, srgb((0.7, 1.0, 1.0)))
        color = cavity(t, color, dark=0.5, light=1.1)
        emit = t.mix(spot, srgb((0.02, 0.08, 0.16)), srgb((0.45, 0.95, 1.0)))
        t.finish(color, 0.25, 0.0, t.bump(swirl, 0.25, 0.004), emit=emit)
    elif k == 'coral':
        pink = t.smooth(_attr(t, 'RegPink'), 0.2, 0.9)
        pores = t.smooth(t.voronoi(scale=40.0, feature='F1'), 0.14, 0.0)
        base = t.ramp(t.noise(scale=6.0, detail=3), [(0.3, srgb((0.86, 0.88, 0.88))), (0.7, srgb((0.97, 0.96, 0.95)))])
        color = t.mix(t.math('MULTIPLY', pink, 0.7), base, srgb((0.96, 0.78, 0.82)))
        color = t.mix(t.math('MULTIPLY', pores, 0.4), color, srgb((0.56, 0.62, 0.7)))
        color = cavity(t, color, dark=0.5, light=1.08)
        t.finish(color, 0.62, 0.0, t.bump(t.math('ADD', pores, t.noise(scale=25, detail=3)), 0.35, 0.006))
    elif k in ('stone', 'shell_shard'):
        slit = t.smooth(_attr(t, 'RegSlit'), 0.05, 0.8) if k == 'stone' else 0.0
        worn = t.noise(scale=12.0, detail=4)
        color = t.mix(0.35, _nacre(t), t.ramp(worn, [(0.3, srgb((0.72, 0.74, 0.78))), (0.7, srgb((0.9, 0.9, 0.92)))]),
                      'MULTIPLY')
        color = t.mix(slit, color, srgb((0.8, 1.0, 1.0)))
        color = cavity(t, color, dark=0.5, light=1.1)
        emit = t.mix(slit, (0, 0, 0, 1), srgb((0.7, 1.0, 1.0)))
        t.finish(color, 0.32, 0.0, t.bump(worn, 0.3, 0.006), emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.6, light=1.06)
        t.finish(color, 0.28, 0.5, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    elif k == 'pearl':
        base = t.ramp(t.noise(scale=30, detail=2), [(0.3, srgb((0.86, 0.84, 0.9))), (0.7, srgb((0.8, 0.86, 0.88)))])
        t.finish(base, 0.18, 0.0, None)
    else:
        raise ValueError(k)
    return mat
