"""The Snapper's bake surfaces.

  shell     a nautilus shell: pearl-white with wavy turquoise tiger stripes
            from the navel out, fading toward the aperture; the aperture's
            lip and its inside pure nacre that glows; carved moons on the keel
  flesh     the animal: wet, leathery sea-blue going pearl, the hood darker
            with a nacre bloom; faint glowing freckles
  tentacle  pale wet flesh, turquoise toward the tips, glowing suckers' rims
  beak      blue-black bone, polished at the hook
  eye       a dark glassy lens with a slit of moonlight and a glowing ring
  silver    moon silver
No rust, no barnacles, no grey fog."""
from surface import NT, cavity, srgb

KINDS = ('shell', 'flesh', 'tentacle', 'beak', 'eye', 'silver')
GLOWS = {
    'glow_pearl': ((0.86, 0.95, 1.0), 3.6, 'SnapperNavelPearl'),
}
EMIT_STRENGTH = 4.0
CYAN = (0.35, 0.95, 1.0)


def uv_boost(obj, c):
    n = obj.name
    if n.startswith(('L_Eye', 'R_Eye')):
        return 1.4
    if n.startswith('Tentacles'):
        return 0.6
    return 1.0


def _attr(t, name):
    n = t.node('ShaderNodeAttribute')
    n.attribute_name = name
    return n.outputs['Fac']


def _nacre(t):
    base = t.ramp(t.noise(scale=5.0, detail=4), [(0.3, srgb((0.88, 0.86, 0.9))), (0.7, srgb((0.98, 0.96, 0.98)))])
    play = t.ramp(t.noise(t.scale_vec(1.0, 1.0, 3.0), scale=3.0, detail=3, w=1.5, dist=1.2),
                  [(0.2, srgb((1.0, 0.84, 0.92))), (0.42, srgb((1.0, 0.98, 0.98))), (0.62, srgb((0.8, 1.0, 0.97))),
                   (0.85, srgb((0.88, 0.88, 1.0)))])
    return t.mix(0.7, base, play, 'MULTIPLY')


def shade(mat, k):
    t = NT(mat)
    if k == 'shell':
        stripe = t.smooth(_attr(t, 'RegStripe'), 0.1, 0.8)
        rim = t.smooth(_attr(t, 'RegRim'), 0.05, 0.8)
        glyph = t.smooth(_attr(t, 'RegGlyph'), 0.1, 0.8)
        base = t.ramp(t.noise(scale=4.0, detail=4), [(0.3, srgb((0.9, 0.88, 0.84))), (0.7, srgb((0.97, 0.96, 0.93)))])
        color = t.mix(stripe, base, srgb((0.1, 0.5, 0.56)))
        color = t.mix(rim, color, _nacre(t))
        color = t.mix(glyph, color, srgb((0.6, 0.98, 1.0)))
        color = cavity(t, color, dark=0.6, light=1.08)
        emit = t.mix(t.math('MULTIPLY', rim, 0.35), (0, 0, 0, 1), srgb((0.7, 0.92, 1.0)))
        emit = t.mix(glyph, emit, srgb(CYAN))
        rough = t.fmix(rim, 0.35, 0.12)
        t.finish(color, rough, 0.0, t.bump(t.noise(scale=40, detail=3), 0.2, 0.003), emit=emit)
    elif k == 'flesh':
        hood = _attr(t, 'RegHood')
        freck = t.smooth(t.voronoi(scale=26.0, feature='F1'), 0.08, 0.0)
        base = t.ramp(t.noise(scale=3.0, detail=3), [(0.3, srgb((0.18, 0.34, 0.5))), (0.7, srgb((0.36, 0.5, 0.62)))])
        color = t.mix(t.math('MULTIPLY', hood, 0.6), base, srgb((0.12, 0.22, 0.38)))
        color = t.mix(t.math('MULTIPLY', freck, 0.5), color, srgb((0.7, 0.9, 0.95)))
        color = cavity(t, color, dark=0.5, light=1.12)
        emit = t.mix(t.math('MULTIPLY', freck, 0.3), (0, 0, 0, 1), srgb(CYAN))
        t.finish(color, 0.3, 0.0, t.bump(t.noise(scale=30, detail=3), 0.3, 0.004), emit=emit)
    elif k == 'tentacle':
        rings = t.smooth(t.math('SINE', t.math('MULTIPLY', t.pz, 40.0)), 0.6, 0.95)
        base = t.ramp(t.math('SUBTRACT', 1.0, t.math('MULTIPLY', t.pz, 1.2)),
                      [(0.2, srgb((0.82, 0.86, 0.9))), (0.8, srgb((0.3, 0.7, 0.78)))])
        color = t.mix(t.math('MULTIPLY', rings, 0.3), base, srgb((0.95, 1.0, 1.0)))
        emit = t.mix(t.math('MULTIPLY', rings, 0.15), (0, 0, 0, 1), srgb(CYAN))
        t.finish(color, 0.25, 0.0, None, emit=emit)
    elif k == 'beak':
        base = t.ramp(t.noise(scale=8.0, detail=3), [(0.3, srgb((0.04, 0.05, 0.1))), (0.7, srgb((0.1, 0.14, 0.24)))])
        color = cavity(t, base, dark=0.6, light=1.3)
        t.finish(color, 0.2, 0.0, t.bump(t.noise(scale=50, detail=2), 0.1, 0.002))
    elif k == 'eye':
        slit = t.smooth(_attr(t, 'RegSlit'), 0.05, 0.8)
        ring = t.smooth(_attr(t, 'RegRing'), 0.05, 0.8)
        lens = t.ramp(t.noise(scale=5.0, detail=2), [(0.3, srgb((0.02, 0.06, 0.1))), (0.7, srgb((0.06, 0.12, 0.2)))])
        color = t.mix(ring, lens, srgb((0.5, 0.9, 1.0)))
        color = t.mix(slit, color, srgb((0.85, 1.0, 1.0)))
        emit = t.mix(t.math('MAXIMUM', slit, t.math('MULTIPLY', ring, 0.6)), (0, 0, 0, 1), srgb((0.7, 1.0, 1.0)))
        t.finish(color, 0.05, 0.0, None, emit=emit)
    elif k == 'silver':
        base = t.ramp(t.noise(scale=6, detail=3), [(0.3, srgb((0.82, 0.86, 0.92))), (0.7, srgb((0.95, 0.96, 1.0)))])
        color = cavity(t, base, dark=0.6, light=1.06)
        t.finish(color, 0.28, 0.5, t.bump(t.noise(scale=80, detail=2), 0.06, 0.001))
    else:
        raise ValueError(k)
    return mat
